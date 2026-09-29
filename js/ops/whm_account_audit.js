#!/usr/bin/env node
/* Read-only: cross-reference every live WHM account against cpanelAccounts in
 * one or more brand DBs. Usage (on the droplet):
 *   node whm_account_audit.js /opt/nomadly/shared/app-main/backend.env /opt/nomadly/shared/app-wl/backend.env
 * Prints a classification table + JSON to stdout. Never mutates anything. */
const fs = require('fs')
const axios = require('axios')
const { MongoClient } = require('mongodb')

const parseEnv = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))

const envs = process.argv.slice(2).map(p => ({ path: p, env: parseEnv(p) }))
if (!envs.length) { console.error('usage: whm_account_audit.js <backend.env> [...]'); process.exit(1) }
const E0 = envs[0].env
const BASE = `${E0.WHM_API_URL.replace(/\/+$/, '')}/json-api`
const AUTH = `whm ${E0.WHM_USERNAME || 'root'}:${E0.WHM_TOKEN}`
const DAY = 86400000

;(async () => {
  const r = await axios.get(`${BASE}/listaccts`, { params: { 'api.version': 1 }, headers: { Authorization: AUTH }, timeout: 60000 })
  const live = r.data?.data?.acct || []
  const rows = {}
  for (const { path, env } of envs) {
    const brand = env.DB_NAME
    const cl = await MongoClient.connect(env.MONGO_URL)
    const col = cl.db(brand).collection('cpanelAccounts')
    const docs = await col.find({}, { projection: { cpUser: 1, domain: 1, chatId: 1, plan: 1, expiryDate: 1, deleted: 1, deletedAt: 1, deletedBy: 1, terminatedOnWhm: 1, whmTerminatePending: 1, whmTerminateRetryCount: 1, suspended: 1, autoRenew: 1, archived: 1, createdAt: 1, addonDomains: 1, graceEndDate: 1, gracePeriodEnd: 1 } }).toArray()
    for (const d of docs) if (d.cpUser) (rows[d.cpUser.toLowerCase()] ||= []).push({ brand, ...d })
    await cl.close()
  }
  const now = Date.now()
  const out = []
  for (const a of live) {
    const u = a.user.toLowerCase()
    const matches = rows[u] || []
    // prefer non-deleted, most recent
    const active = matches.filter(m => !m.deleted && !m.terminatedOnWhm && !m.archived)
    const m = active[0] || matches.sort((x, y) => new Date(y.createdAt || 0) - new Date(x.createdAt || 0))[0]
    let cls, note = ''
    if (!m) { cls = 'ORPHAN_NOT_IN_DB' }
    else if (m.deleted || m.terminatedOnWhm) { cls = 'DELETED_IN_DB_STILL_ON_WHM'; note = `deletedBy=${m.deletedBy || '?'} at=${m.deletedAt ? new Date(m.deletedAt).toISOString().slice(0, 10) : '?'} pending=${!!m.whmTerminatePending} retries=${m.whmTerminateRetryCount || 0}` }
    else {
      const exp = m.expiryDate ? new Date(m.expiryDate).getTime() : null
      if (!exp) { cls = 'ACTIVE_NO_EXPIRY' }
      else if (exp > now) { cls = 'ACTIVE_PAID'; note = `expires in ${Math.ceil((exp - now) / DAY)}d` }
      else { cls = 'EXPIRED_NOT_RENEWED'; note = `expired ${Math.floor((now - exp) / DAY)}d ago autoRenew=${m.autoRenew}` }
    }
    if (m && m.domain && m.domain.toLowerCase() !== a.domain.toLowerCase()) note += ` DOMAIN_MISMATCH db=${m.domain}`
    out.push({ user: a.user, domain: a.domain, whmSuspended: a.suspended === 1, disk: a.diskused, brand: m?.brand || '-', chatId: m?.chatId || '-', plan: m?.plan || a.plan, cls, note, expiryDate: m?.expiryDate || null })
  }
  const order = ['ACTIVE_PAID', 'ACTIVE_NO_EXPIRY', 'EXPIRED_NOT_RENEWED', 'DELETED_IN_DB_STILL_ON_WHM', 'ORPHAN_NOT_IN_DB']
  out.sort((x, y) => order.indexOf(x.cls) - order.indexOf(y.cls) || x.domain.localeCompare(y.domain))
  for (const o of out) console.log([o.cls.padEnd(27), o.user.padEnd(10), o.domain.padEnd(40), o.brand.padEnd(7), String(o.chatId).padEnd(11), (o.whmSuspended ? 'SUSP' : '    '), o.disk.padEnd(6), o.note].join(' '))
  console.log('\nsummary:', order.map(k => `${k}=${out.filter(o => o.cls === k).length}`).join(' '), `total=${out.length}`)
  console.log('\nJSON:' + JSON.stringify(out))
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
