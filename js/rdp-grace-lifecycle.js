'use strict'
// ============================================================
// DO VPS/RDP 2-day grace lifecycle — state machine + executor.
// ============================================================
// The bot VPS scheduler (js/_index.js) OWNS the DigitalOcean Windows-RDP grace
// lifecycle, because only the bot has the user's Telegram chat / language and can
// send the grace-start + deletion notifications. This module holds that logic as
// a small, dependency-injected state machine so it can be unit-tested WITHOUT
// booting the whole bot (the scheduler is hard-guarded off when SKIP_WEBHOOK_SYNC=true).
//
// Lifecycle for an un-renewed DO-RDP subscription:
//   active → (end_time)          power OFF + status EXPIRED_GRACE, grace_until = end_time + N days
//          → (grace_until − 24h)  optional final reminder
//          → (grace_until)        DESTROY the droplet (DO bills powered-off droplets hourly)
//   A renewal at any point clears the grace fields and powers the box back on.
//
// Grace fields are mirrored onto BOTH vpsPlansOf (customer catalog) and
// doRdpServers (via the RDP service) so the reseller API + the service safety-net
// sweep read a consistent state.
//
// This module performs NO i18n itself: the caller passes a `notifyUser(chatId, msgKey, args)`
// callback and resolves the user's language + translation on its side.

const { detectProviderByInstanceId } = require('./vps-provider')

const GRACE_DAYS = Math.max(0, Number(process.env.RDP_GRACE_DAYS || 2))
// Send the "about to be deleted" reminder this long before the grace deadline.
// Configurable via RDP_GRACE_REMINDER_LEAD_HOURS (default 24h).
const REMINDER_LEAD_HOURS = Math.max(0, Number(process.env.RDP_GRACE_REMINDER_LEAD_HOURS || 24))
const REMINDER_LEAD_MS = REMINDER_LEAD_HOURS * 60 * 60 * 1000

function _ms(d) { return d == null ? null : (d instanceof Date ? d.getTime() : new Date(d).getTime()) }
function _fmtDate(d) { try { return new Date(d).toLocaleDateString() } catch (_) { return String(d) } }
function _iso(d) { try { return new Date(d).toISOString().slice(0, 10) } catch (_) { return String(d) } }

// Is this vpsPlansOf record a DigitalOcean Windows-RDP instance?
function isDigitalOceanRdp(vpsPlan) {
  if (!vpsPlan) return false
  const explicit = String(vpsPlan.provider || '').toLowerCase()
  if (explicit === 'digitalocean-rdp') return true
  return detectProviderByInstanceId(instanceIdOf(vpsPlan)) === 'digitalocean-rdp'
}

// Provider instance id. Reseller-API records keep it in `instanceId` (their vpsId is a bare uuid).
function instanceIdOf(vpsPlan) {
  return vpsPlan.contaboInstanceId || vpsPlan.instanceId || vpsPlan.vpsId
}

// After this many failed destroys, retry only every DESTROY_BACKOFF_MS (was every 5-min tick forever).
const DESTROY_FAST_RETRIES = 10
const DESTROY_BACKOFF_MS = 6 * 3600 * 1000

// grace_until = subscription end + graceDays (grace clock starts at end of subscription).
function graceUntil(endTime, graceDays = GRACE_DAYS) {
  const base = _ms(endTime)
  return new Date((base == null ? Date.now() : base) + graceDays * 86400000)
}

// Pure decision for ONE DO-RDP record — no side effects.
//   { action: 'none' | 'enter_grace' | 'wait' | 'remind' | 'destroy', grace_until?, expired_at? }
function decideRdpGrace(vpsPlan, opts = {}) {
  const graceDays = opts.graceDays == null ? GRACE_DAYS : opts.graceDays
  const nowMs = _ms(opts.now) || Date.now()
  const status = String(vpsPlan.status || '')
  const endMs = _ms(vpsPlan.end_time)
  const graceMs = _ms(vpsPlan.grace_until)

  // Already torn down — nothing to do.
  if (['CANCELLED', 'DESTROYED', 'destroyed'].includes(status)) return { action: 'none' }

  const inGrace = status === 'EXPIRED_GRACE' || graceMs != null
  if (inGrace) {
    const deadline = graceMs != null ? graceMs : graceUntil(vpsPlan.end_time, graceDays).getTime()
    if (nowMs >= deadline) return { action: 'destroy', grace_until: new Date(deadline) }
    if (nowMs >= deadline - REMINDER_LEAD_MS && !vpsPlan._graceReminderSent) return { action: 'remind', grace_until: new Date(deadline) }
    return { action: 'wait', grace_until: new Date(deadline) }
  }

  // Not yet in grace: enter it once the subscription is past its end_time.
  if (endMs != null && nowMs >= endMs) {
    return { action: 'enter_grace', expired_at: new Date(nowMs), grace_until: graceUntil(vpsPlan.end_time, graceDays) }
  }
  return { action: 'none' }
}

// Execute a decision. All side effects go through injected deps so the whole thing
// is unit-testable with spies.
//
// deps = {
//   now: Date,
//   powerOff(instanceId)            -> stop the droplet (customer access ends)
//   destroy(chatId, vpsId)          -> deleteVPSinstance; returns { success, error?, alreadyGone? }
//   updatePlan(planId, set)         -> vpsPlansOf.updateOne({_id: planId}, {$set: set})
//   mirrorGrace(instanceId, fields) -> RDP service markGrace (doRdpServers -> expired + grace fields)
//   mirrorDestroy(instanceId)       -> RDP service markGraceDestroy (doRdpServers -> destroyed/expired_grace)
//   notifyUser(chatId, msgKey, args)-> localized Telegram send (caller resolves lang)
//   notifyReseller(event, payload)  -> push webhook to the reseller API key owner (best-effort)
//   notifyAdmin(text)               -> admin Telegram alert (destroy failures)
//   log(msg)
// }
async function applyRdpGrace(vpsPlan, decision, deps = {}) {
  const now = deps.now instanceof Date ? deps.now : new Date()
  const log = deps.log || (() => {})
  // product + msgKeys let the SAME state machine drive both DO-RDP and DO Linux VPS
  // (the scheduler passes product:'vps' + VPS message keys for Linux boxes).
  const product = deps.product === 'vps' ? 'vps' : 'rdp'
  const mk = deps.msgKeys || { graceStart: 't.rdpGraceStart', graceReminder: 't.rdpGraceReminder', deletedAfterGrace: 't.rdpDeletedAfterGrace' }
  const displayName = vpsPlan.label || vpsPlan.name || (product === 'vps' ? 'VPS' : 'Windows RDP')
  const chatId = vpsPlan.chatId
  const vpsId = vpsPlan.vpsId || vpsPlan._id
  const inst = instanceIdOf(vpsPlan)

  switch (decision.action) {
    case 'enter_grace': {
      const graceUntilD = decision.grace_until
      const expiredAt = decision.expired_at || now
      try { if (deps.powerOff) await deps.powerOff(inst) } catch (e) { log(`[RDP Grace] power-off failed for ${vpsId}: ${e.message}`) }
      if (deps.updatePlan) await deps.updatePlan(vpsPlan._id, { status: 'EXPIRED_GRACE', expired_at: expiredAt, grace_until: graceUntilD, _graceReminderSent: false })
      if (deps.mirrorGrace) { try { await deps.mirrorGrace(inst, { expired_at: expiredAt, grace_until: graceUntilD }) } catch (e) { log(`[RDP Grace] mirror(grace) failed: ${e.message}`) } }
      if (deps.notifyUser) { try { deps.notifyUser(chatId, mk.graceStart, [displayName, _fmtDate(graceUntilD)]) } catch (_) {} }
      if (deps.notifyReseller) { try { const _graceHours = Math.max(0, Math.round((new Date(graceUntilD).getTime() - new Date(expiredAt).getTime()) / 3600000)); deps.notifyReseller(`${product}.grace_start`, { plan: vpsPlan.plan || null, region: vpsPlan.region || null, expired_at: new Date(expiredAt).toISOString(), delete_at: new Date(graceUntilD).toISOString(), grace_hours: _graceHours }) } catch (_) {} }
      log(`[RDP Grace] ${displayName} (${vpsId}) powered off — grace until ${_iso(graceUntilD)}`)
      return { action: 'enter_grace', grace_until: graceUntilD }
    }
    case 'remind': {
      if (deps.updatePlan) await deps.updatePlan(vpsPlan._id, { _graceReminderSent: true })
      if (deps.notifyUser) { try { deps.notifyUser(chatId, mk.graceReminder, [displayName, _fmtDate(decision.grace_until)]) } catch (_) {} }
      log(`[RDP Grace] final reminder sent for ${displayName} (${vpsId})`)
      return { action: 'remind' }
    }
    case 'destroy': {
      const lastTry = vpsPlan.lastDeleteAttemptAt ? new Date(vpsPlan.lastDeleteAttemptAt).getTime() : 0
      if ((vpsPlan.deleteRetryCount || 0) >= DESTROY_FAST_RETRIES && now.getTime() - lastTry < DESTROY_BACKOFF_MS) {
        return { action: 'destroy', destroyed: false, skipped: 'backoff' }
      }
      let result = null
      try { result = deps.destroy ? await deps.destroy(chatId, vpsId) : { success: false, error: 'no destroy fn' } }
      catch (e) { result = { success: false, error: e.message } }
      if (result && result.success) {
        if (deps.updatePlan) await deps.updatePlan(vpsPlan._id, { status: 'CANCELLED', cancelledAt: now, cancelReason: 'expired_grace' })
        if (deps.mirrorDestroy) { try { await deps.mirrorDestroy(inst) } catch (e) { log(`[RDP Grace] mirror(destroy) failed: ${e.message}`) } }
        if (deps.notifyUser) { try { deps.notifyUser(chatId, mk.deletedAfterGrace, [displayName]) } catch (_) {} }
        if (deps.notifyReseller) { try { deps.notifyReseller(`${product}.deleted`, { plan: vpsPlan.plan || null, region: vpsPlan.region || null, reason: 'expired_grace' }) } catch (_) {} }
        log(`[RDP Grace] ${displayName} (${vpsId}) DELETED after the ${GRACE_DAYS}-day grace period`)
        return { action: 'destroy', destroyed: true }
      }
      // Destroy failed → throttled admin alert + retry counter (alert on attempt 1, then every 6h,
      // up to 10 alerts). After 10 failures the destroy itself backs off to once per 6h.
      const retries = (vpsPlan.deleteRetryCount || 0) + 1
      const lastAlertAgeMs = vpsPlan.lastDeleteAlertAt ? (now.getTime() - new Date(vpsPlan.lastDeleteAlertAt).getTime()) : Infinity
      const shouldAlert = retries === 1 || (retries <= 10 && lastAlertAgeMs >= 6 * 3600 * 1000)
      if (deps.updatePlan) await deps.updatePlan(vpsPlan._id, { deleteRetryCount: retries, lastDeleteAttemptAt: now, lastDeleteError: (result && result.error) || 'destroy failed', ...(shouldAlert ? { lastDeleteAlertAt: now } : {}) })
      if (shouldAlert && deps.notifyAdmin) {
        try {
          deps.notifyAdmin(`🚨 <b>RDP grace-delete FAILED</b>${retries === 1 ? '' : ` (retry ${retries})`}\n${displayName} (vpsId ${vpsId}, inst ${inst})\nError: ${(result && result.error) || 'unknown'}${retries >= 10 ? '\n🛑 Auto-retries exhausted — manual deletion required to stop DO billing.' : ' (next alert in ≥6h)'}`)
        } catch (_) {}
      }
      log(`[RDP Grace] destroy FAILED for ${displayName} (attempt ${retries}): ${(result && result.error) || 'unknown'}${shouldAlert ? '' : ' — admin alert throttled'}`)
      return { action: 'destroy', destroyed: false, error: (result && result.error) || 'destroy failed', retries }
    }
    default:
      return { action: decision.action || 'none' }
  }
}

// Convenience: run decide+apply over a list of records with a single deps object.
// Used by the unit test; the real scheduler loops itself (per-record language).
async function runRdpGracePass(records, deps = {}) {
  const out = []
  for (const rec of (records || [])) {
    if (!isDigitalOceanRdp(rec)) { out.push({ id: rec.vpsId || rec._id, action: 'skip_not_rdp' }); continue }
    const decision = decideRdpGrace(rec, { now: deps.now, graceDays: deps.graceDays })
    const r = await applyRdpGrace(rec, decision, deps)
    out.push({ id: rec.vpsId || rec._id, ...r })
  }
  return out
}

module.exports = {
  GRACE_DAYS,
  REMINDER_LEAD_HOURS,
  REMINDER_LEAD_MS,
  isDigitalOceanRdp,
  instanceIdOf,
  DESTROY_FAST_RETRIES,
  DESTROY_BACKOFF_MS,
  graceUntil,
  decideRdpGrace,
  applyRdpGrace,
  runRdpGracePass,
}
