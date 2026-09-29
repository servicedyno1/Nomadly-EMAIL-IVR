/* global process */
/**
 * Daily cPanel Account Digest
 *
 * Once a day (default 08:00 UTC) DMs the brand admin a summary of the WHM
 * server's cPanel account usage:
 *   • Total accounts on WHM (shared server) vs the cPanel license limit
 *   • Active vs suspended split
 *   • Per-brand breakdown — how many of the WHM accounts belong to THIS bot's
 *     brand (cross-referenced against this brand's cpanelAccounts collection)
 *     vs other brands / shared.
 *   • A "near license limit" warning line when usage crosses the threshold.
 *
 * Both bots (app-main = Nomadly, app-wl = Smadav) run this same code with their
 * own TELEGRAM_ADMIN_CHAT_ID + brand DB but share ONE WHM server, so each admin
 * gets its own daily message (the total matches; the brand breakdown differs).
 *
 * Production-only — the dev sandbox (BOT_ENVIRONMENT != production, or
 * SKIP_WEBHOOK_SYNC=true) skips the scheduler entirely so it never DMs the real
 * admin from a dev bot.
 */

const { log } = require('console')

const DAY_MS = 24 * 60 * 60 * 1000

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * ms until the next occurrence of hour:min UTC (strictly in the future).
 * Pure — `now` is injectable for tests.
 */
function msUntilNextRun(hourUTC, minUTC, now = new Date()) {
  const next = new Date(now.getTime())
  next.setUTCHours(hourUTC, minUTC, 0, 0)
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

/**
 * Compute the digest stats. Pure.
 * @param {Array<{user:string,suspended?:number}>} whmAccounts  from WHM listaccts
 * @param {Set<string>|Array<string>} brandCpUsers  lowercased cpUsers owned by this brand (active)
 * @param {{licenseLimit:number, warnAt:number}} opts
 */
function computeStats(whmAccounts, brandCpUsers, opts = {}) {
  const licenseLimit = Number.isFinite(opts.licenseLimit) ? opts.licenseLimit : 30
  const warnAt = Number.isFinite(opts.warnAt) ? opts.warnAt : Math.max(1, licenseLimit - 3)
  const brandSet = brandCpUsers instanceof Set
    ? brandCpUsers
    : new Set((brandCpUsers || []).map(u => String(u).toLowerCase()))

  const total = whmAccounts.length
  const suspended = whmAccounts.filter(a => a.suspended === 1 || a.suspended === '1' || a.suspended === true).length
  const active = total - suspended
  const brandCount = whmAccounts.filter(a => brandSet.has(String(a.user).toLowerCase())).length
  const otherCount = total - brandCount
  const remaining = licenseLimit - total

  return {
    total,
    active,
    suspended,
    brandCount,
    otherCount,
    licenseLimit,
    warnAt,
    remaining,
    atOrOverLimit: total >= licenseLimit,
    nearLimit: total >= warnAt,
  }
}

/**
 * Build the Telegram HTML digest message. Pure.
 */
function buildDigestMessage(stats, meta = {}) {
  const brand = meta.brandName || 'Brand'
  const host = meta.whmHost || 'WHM'
  const lines = []
  lines.push(`📊 <b>Daily cPanel Report — ${_esc(brand)}</b>`)
  lines.push('')
  lines.push(`🖥 WHM server: <code>${_esc(host)}</code>`)
  lines.push(`📦 Total accounts: <b>${stats.total} / ${stats.licenseLimit}</b> (license)`)
  lines.push(`   ├ Active: ${stats.active}`)
  lines.push(`   └ Suspended: ${stats.suspended}`)
  lines.push('')
  lines.push(`🏷 Brand breakdown:`)
  lines.push(`   ├ ${_esc(brand)} (this brand): <b>${stats.brandCount}</b>`)
  lines.push(`   └ Other / shared: ${stats.otherCount}`)

  if (stats.atOrOverLimit) {
    lines.push('')
    lines.push(`🛑 <b>License limit reached</b> — ${stats.total} of ${stats.licenseLimit} used. New cPanel accounts will fail until you upgrade the license.`)
  } else if (stats.nearLimit) {
    lines.push('')
    const left = stats.remaining
    lines.push(`⚠️ <b>Near license limit</b> — ${stats.total} of ${stats.licenseLimit} used (${left} slot${left === 1 ? '' : 's'} left). Consider upgrading soon.`)
  }
  return lines.join('\n')
}

/**
 * Fetch the live WHM account list. Uses the raw axios instance so we can tell a
 * genuine 0 from an error (listAccounts() swallows errors and returns []).
 */
async function fetchWhmAccounts(whmService) {
  try {
    const resp = await whmService._whmApi.get('/listaccts', { params: { 'api.version': 1 }, timeout: 20000 })
    const ok = resp.data?.metadata?.result === 1
    return { ok, accounts: resp.data?.data?.acct || [], httpStatus: resp.status, reason: resp.data?.metadata?.reason || null }
  } catch (err) {
    return { ok: false, accounts: [], httpStatus: err.response?.status || 0, reason: err.message }
  }
}

/**
 * Read the set of cpUsers this brand still owns (active — not deleted /
 * terminated / archived), lowercased, for cross-referencing against WHM.
 */
async function loadBrandCpUsers(db) {
  const docs = await db.collection('cpanelAccounts').find(
    { deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true } },
    { projection: { cpUser: 1 } }
  ).toArray()
  const set = new Set()
  for (const d of docs) if (d.cpUser) set.add(String(d.cpUser).toLowerCase())
  return set
}

/**
 * Run one digest cycle: fetch WHM accounts, compute stats, DM the admin.
 * Exported for tests (deps injected).
 * @param {object} deps { db, whmService, notifyAdmin }
 */
async function runDigest(deps) {
  const { db, whmService, notifyAdmin } = deps
  const brandName = process.env.CHAT_BOT_NAME || 'Brand'
  const licenseLimit = parseInt(process.env.WHM_LICENSE_LIMIT, 10) || 30
  const warnAt = parseInt(process.env.WHM_LICENSE_WARN_AT, 10) || Math.max(1, licenseLimit - 3)
  const whmHost = process.env.WHM_HOST || 'WHM'

  const res = await fetchWhmAccounts(whmService)
  if (!res.ok) {
    log(`[WhmAccountDigest] WHM unreachable (HTTP ${res.httpStatus}) — sending failure note`)
    notifyAdmin(`📊 <b>Daily cPanel Report — ${_esc(brandName)}</b>\n\n⚠️ Couldn't reach WHM to count accounts today (HTTP <code>${res.httpStatus || 'n/a'}</code>).`)
    return { sent: true, ok: false }
  }

  const brandCpUsers = await loadBrandCpUsers(db)
  const stats = computeStats(res.accounts, brandCpUsers, { licenseLimit, warnAt })
  const msg = buildDigestMessage(stats, { brandName, whmHost })
  notifyAdmin(msg)
  log(`[WhmAccountDigest] Sent — total=${stats.total}/${stats.licenseLimit} suspended=${stats.suspended} brand=${stats.brandCount}`)
  return { sent: true, ok: true, stats }
}

/**
 * Initialise the daily scheduler. Wired from _index.js startup.
 * @param {object} deps { bot?, db, whmService, notifyAdmin }
 */
function initScheduler(deps) {
  const { db, whmService, notifyAdmin } = deps
  if (process.env.BOT_ENVIRONMENT !== 'production' || process.env.SKIP_WEBHOOK_SYNC === 'true') {
    log('[WhmAccountDigest] Skipping — dev sandbox (not production)')
    return null
  }
  if (!db || !whmService || !whmService._whmApi || typeof notifyAdmin !== 'function') {
    log('[WhmAccountDigest] Skipping — missing deps (db/whmService/notifyAdmin)')
    return null
  }

  const hourUTC = parseInt(process.env.WHM_DIGEST_HOUR_UTC, 10)
  const minUTC = parseInt(process.env.WHM_DIGEST_MIN_UTC, 10)
  const H = Number.isFinite(hourUTC) ? hourUTC : 8
  const M = Number.isFinite(minUTC) ? minUTC : 0

  let timer = null
  const arm = () => {
    const delay = msUntilNextRun(H, M)
    timer = setTimeout(async () => {
      await runDigest({ db, whmService, notifyAdmin }).catch(e => log(`[WhmAccountDigest] run error: ${e.message}`))
      arm()
    }, delay)
    if (timer.unref) timer.unref()
    log(`[WhmAccountDigest] Next run in ${(delay / 3600000).toFixed(1)}h (daily at ${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')} UTC)`)
  }
  arm()
  return { stop: () => timer && clearTimeout(timer) }
}

module.exports = {
  initScheduler,
  runDigest,
  computeStats,
  buildDigestMessage,
  msUntilNextRun,
  fetchWhmAccounts,
  loadBrandCpUsers,
  DAY_MS,
}
