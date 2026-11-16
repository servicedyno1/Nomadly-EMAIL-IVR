// Dead-number guard (2026-06): keeps phoneNumbersOf free of dead-number cruft that can confuse routing/billing/audits.
//
// Released/expired/cancelled numbers are already ignored by routing, /sip-auth and the renewal charger, but they can
// linger with a stale SIP login or auto-renew left on. This daily guard:
//   1. Neutralises every dead number immediately — strips its SIP login and turns auto-renew off.
//   2. Stamps `_deadSince` the first time a dead number is seen (uses its real release date when present).
//   3. HARD-DELETES dead numbers whose dead-age exceeds the retention window (default 30 days), so history stays
//      available for disputes for a while, then the record is purged.
// A short Telegram summary goes to the admin whenever it neutralises or deletes anything.
'use strict'
const DEAD_STATUSES = ['released', 'expired', 'cancelled', 'canceled', 'deleted']
const isDead = (n) => DEAD_STATUSES.includes(String(n.status || '').toLowerCase())
const RETENTION_DAYS = () => Math.max(1, Number(process.env.DEAD_NUMBER_RETENTION_DAYS) || 30)
const PERIOD_MS = 24 * 60 * 60 * 1000
const FIRST_RUN_MS = 2 * 60 * 1000
const ms = (d) => (d ? new Date(d).getTime() : 0)

async function runOnce(phoneNumbersOf, { log, notifyAdmin } = {}) {
  const now = Date.now(), cutoff = now - RETENTION_DAYS() * 24 * 60 * 60 * 1000
  const r = { scanned: 0, neutralised: 0, stamped: 0, deleted: 0 }
  for (const d of await phoneNumbersOf.find({ 'val.numbers.status': { $in: DEAD_STATUSES } }).toArray()) {
    const toDelete = []
    for (const n of d.val?.numbers || []) {
      if (!isDead(n)) continue
      r.scanned++
      // 1) neutralise: strip any leftover SIP login + turn auto-renew off
      const unset = {}, set = {}
      if (n.telnyxSipUsername || n.sipUsername || n.telnyxSipPassword || n.sipPassword || n.telnyxCredentialId) {
        for (const k of ['telnyxSipUsername', 'sipUsername', 'telnyxSipPassword', 'sipPassword', 'telnyxCredentialId']) if (n[k] != null) unset[`val.numbers.$[n].${k}`] = ''
      }
      if (n.autoRenew !== false) set['val.numbers.$[n].autoRenew'] = false
      // 2) stamp _deadSince (prefer a real release date)
      const deadSince = n._deadSince || n.releasedAt || n.releaseAt || n._releasedAt || null
      if (!deadSince) set['val.numbers.$[n]._deadSince'] = new Date(now).toISOString()
      if (Object.keys(set).length || Object.keys(unset).length) {
        const upd = {}; if (Object.keys(set).length) upd.$set = set; if (Object.keys(unset).length) upd.$unset = unset
        await phoneNumbersOf.updateOne({ _id: d._id }, upd, { arrayFilters: [{ 'n.phoneNumber': n.phoneNumber, 'n.status': { $in: DEAD_STATUSES } }] })
        r.neutralised++
        if (set[`val.numbers.$[n]._deadSince`]) r.stamped++
      }
      // 3) delete once past retention
      const age = ms(n._deadSince || n.releasedAt || n.releaseAt || n._releasedAt)
      if (age && age <= cutoff) toDelete.push(n.phoneNumber)
    }
    if (toDelete.length) {
      await phoneNumbersOf.updateOne({ _id: d._id }, { $pull: { 'val.numbers': { phoneNumber: { $in: toDelete }, status: { $in: DEAD_STATUSES } } } })
      r.deleted += toDelete.length
    }
  }
  if (log) log(`[DeadNumberGuard] scanned=${r.scanned} neutralised=${r.neutralised} stamped=${r.stamped} deleted=${r.deleted} (retention ${RETENTION_DAYS()}d)`)
  if (notifyAdmin && (r.neutralised || r.deleted)) {
    try { notifyAdmin(`🧹 <b>Dead-number guard</b>\n${r.neutralised ? `neutralised ${r.neutralised} (stripped SIP + auto-renew off)\n` : ''}${r.deleted ? `hard-deleted ${r.deleted} past ${RETENTION_DAYS()}-day retention` : ''}`.trim()) } catch (_) {}
  }
  return r
}

function start(phoneNumbersOf, opts = {}) {
  if (!phoneNumbersOf) return
  const run = () => runOnce(phoneNumbersOf, opts).catch(e => opts.log?.(`[DeadNumberGuard] run failed: ${e.message}`))
  setTimeout(run, FIRST_RUN_MS).unref?.()
  setInterval(run, PERIOD_MS).unref?.()
  opts.log?.(`[DeadNumberGuard] started (first run in 2m, then daily, retention ${RETENTION_DAYS()}d)`)
}

module.exports = { start, runOnce }
