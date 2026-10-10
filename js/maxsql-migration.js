/* eslint-env node */
/**
 * One-shot startup migrations that raise the WHM MySQL quota (MAXSQL) on a package
 * + on every existing account of that plan, so the per-plan database limits in
 * whm-service.js PLAN_MYSQL_LIMITS also apply to accounts created before them.
 *   v1 (2026-06): Premium Monthly → 5 databases (storefront promised MySQL, package had 0).
 *   weekly v1 (2026-10): Premium Weekly → 2 databases (MySQL opened to the weekly plan).
 *
 * Idempotent — completion is recorded per migration in the `migrations` collection.
 * Pods that cannot reach WHM (CF Access 403) log warnings and don't set the marker,
 * so the migration retries on the next startup once WHM is reachable.
 */
const axios = require('axios')

const MIGRATIONS = [
  { id: 'raise_maxsql_premium_monthly_v1', pkg: 'Premium-Anti-Red-HostPanel-1-Month', maxsql: 5, plan: /^Premium Anti-Red HostPanel \(1-Month\)$/i },
  { id: 'raise_maxsql_premium_weekly_v1', pkg: 'Premium-Anti-Red-1-Week', maxsql: 2, plan: /^Premium Anti-Red \(1-Week\)$/i },
]
const MIGRATION_ID = MIGRATIONS[0].id

function buildWhmClient() {
  const WHM_BASE = process.env.WHM_API_URL
  const WHM_TOKEN = process.env.WHM_TOKEN
  const WHM_USER = process.env.WHM_USER || 'root'
  if (!WHM_BASE || !WHM_TOKEN) return null
  const headers = { Authorization: `whm ${WHM_USER}:${WHM_TOKEN}` }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  return axios.create({
    baseURL: WHM_BASE.replace(/\/+$/, '') + '/json-api',
    headers,
    timeout: 30000,
    validateStatus: () => true,
  })
}

async function runOne(db, whm, m, log, warn) {
  const migrations = db.collection('migrations')
  const existing = await migrations.findOne({ _id: m.id }).catch(() => null)
  if (existing?.completedAt) {
    log(`${m.id} already complete (${new Date(existing.completedAt).toISOString()}) — skipping`)
    return
  }

  // 1) modifypkg — raise the package default so future accounts auto-inherit.
  let pkgOk = false
  try {
    const r = await whm.get('/modifypkg', { params: { 'api.version': 1, name: m.pkg, MAXSQL: m.maxsql } })
    if (r.status === 403) { warn(`${m.id}: modifypkg 403 (CF Access blocked); will retry on next startup`); return }
    if (r.data?.metadata?.result === 1) {
      pkgOk = true
      log(`modifypkg ${m.pkg} MAXSQL=${m.maxsql} → OK`)
    } else {
      warn(`modifypkg ${m.pkg} rejected: ${r.data?.metadata?.reason || JSON.stringify(r.data).slice(0, 200)}`)
    }
  } catch (e) {
    warn(`modifypkg ${m.pkg} threw: ${e.message}`)
    if (e.response?.status === 403) return
  }

  // 2) modifyacct for every existing account on that plan.
  const accounts = await db.collection('cpanelAccounts').find({
    plan: m.plan,
    deleted: { $ne: true },
    __seedTestAccount: { $ne: true },
  }).project({ _id: 1, cpUser: 1, domain: 1 }).toArray()
  log(`${m.id}: found ${accounts.length} account(s) to update`)

  const stats = { ok: 0, fail: 0, accounts: accounts.length, pkgOk }
  for (const a of accounts) {
    const user = a.cpUser || a._id
    try {
      const r = await whm.get('/modifyacct', { params: { 'api.version': 1, user, MAXSQL: m.maxsql } })
      if (r.status === 403) { warn(`modifyacct ${user} → 403 (CF Access); aborting & deferring`); return }
      if (r.data?.metadata?.result === 1) stats.ok++
      else { stats.fail++; warn(`modifyacct ${user} rejected: ${r.data?.metadata?.reason || ''}`) }
    } catch (e) {
      stats.fail++
      warn(`modifyacct ${user} threw: ${e.message}`)
    }
  }

  await migrations.updateOne(
    { _id: m.id },
    { $set: { completedAt: new Date(), stats, notes: `raised MAXSQL to ${m.maxsql} on package ${m.pkg} + ${stats.ok} cpanel account(s)` } },
    { upsert: true },
  )
  log(`✅ migration ${m.id} complete: ${stats.ok} ok, ${stats.fail} failed, ${accounts.length} total`)
}

async function runMaxsqlMigration(getDb) {
  const log = (...args) => console.log('[MaxsqlMigration]', ...args)
  const warn = (...args) => console.warn('[MaxsqlMigration]', ...args)
  const db = getDb && getDb()
  if (!db) { warn('skip — getDb() returned null'); return }
  const whm = buildWhmClient()
  if (!whm) { warn('skip — WHM_API_URL or WHM_TOKEN missing'); return }
  for (const m of MIGRATIONS) await runOne(db, whm, m, log, warn)
}

module.exports = { runMaxsqlMigration, MIGRATION_ID, MIGRATIONS }
