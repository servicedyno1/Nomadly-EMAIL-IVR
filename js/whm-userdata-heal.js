/* global process */
/**
 * whm-userdata-heal.js — self-heal for domains stranded in WHM's userdata layer
 * after a silent /removeacct failure.
 *
 * RCA
 *   The scheduler's grace-period + startup-enforcement paths used to flip
 *   `deleted:true` unconditionally, even when WHM `/removeacct` returned false
 *   (transient net / license / disk / mid-restart / race). Mongo said the
 *   account was gone; WHM disagreed. Every domain that account held in WHM's
 *   `userdata` layer stayed on the box forever, so the SAME user's next hosting
 *   purchase could not `addaddondomain` ("already exists in the userdata") or
 *   `modifyacct` change-primary (XID 6ekdqc Modify.pm:972).
 *
 * This module retries the WHM termination for such rows — but ONLY for the
 * requesting user's OWN previously-deleted plans (same-chatId guardrail lives
 * INSIDE the Mongo query so it can never be dropped in a refactor). It never
 * touches the blockedDomains abuse gate, and callers must NOT do targeted
 * per-user manual terminations — reach stuck rows only through the automated
 * sweep or the chatId-scoped on-demand rescue.
 */

const RETRY_CAP = 6 // give up + fire a one-time admin alert after this many sweep passes

// Matches the cPanel/WHM reject strings that indicate a stale-userdata collision.
const STALE_MATCH_REASON_RX = /already exists in the userdata|domain.*already exists|Domain\s+".*"\s+already exists/i

/**
 * True if the cPanel/WHM reject text indicates a stale-userdata collision.
 * Case-insensitive. Returns false for empty/null/undefined.
 */
function isStaleUserdataError(reasonText) {
  if (!reasonText) return false
  return STALE_MATCH_REASON_RX.test(String(reasonText))
}

/**
 * Retry the WHM termination for a single already-deleted account row.
 *
 * Guards:
 *   - Refuses if the row is not `deleted` (never terminate a live plan).
 *   - Short-circuits if `terminatedOnWhm === true` (already gone on WHM).
 *     CRITICAL: guard on `terminatedOnWhm !== true`, NOT `whmTerminatePending`
 *     — historical rows deleted before this fix never got the pending flag, and
 *     guarding on the pending flag would permanently strand them.
 *
 * @returns {{ ok:boolean, cleared?:boolean, retriesUsed?:number, reason?:string }}
 */
async function attemptStaleTerminate({ db, whmService, account, notifyAdmin }) {
  if (!account || !account.deleted) return { ok: false, reason: 'not-deleted' }
  if (account.terminatedOnWhm === true) {
    return { ok: true, cleared: false, reason: 'already-terminated' }
  }

  const cpanelAccounts = db.collection('cpanelAccounts')

  let terminated = false
  try {
    terminated = await whmService.terminateAccount(account.cpUser)
  } catch (_) {
    terminated = false // a throw is just another failure
  }

  if (terminated) {
    await cpanelAccounts.updateOne(
      { _id: account._id },
      {
        $set: { terminatedOnWhm: true, whmTerminatedAt: new Date() },
        $unset: { whmTerminatePending: '', whmTerminateRetryCount: '' },
      }
    )
    return { ok: true, cleared: true, retriesUsed: account.whmTerminateRetryCount || 0 }
  }

  // Still failing — bump the retry counter and keep it flagged.
  const retriesUsed = (account.whmTerminateRetryCount || 0) + 1
  await cpanelAccounts.updateOne(
    { _id: account._id },
    {
      $set: { whmTerminatePending: true, whmTerminateLastAttemptAt: new Date() },
      $inc: { whmTerminateRetryCount: 1 },
    }
  )

  if (retriesUsed === RETRY_CAP && typeof notifyAdmin === 'function') {
    try {
      notifyAdmin(
        `🛑 <b>WHM self-heal gave up</b>\n` +
        `cPanel: <code>${account.cpUser}</code>\n` +
        `Domain: <b>${account.domain || '(unknown)'}</b>\n` +
        `Retries: ${retriesUsed}\n\n` +
        `<i>/removeacct still failing after ${RETRY_CAP} passes — needs a manual look at the WHM box.</i>`
      )
    } catch (_) {}
  }

  return { ok: false, retriesUsed, reason: 'whm-still-failing' }
}

/**
 * On-demand rescue: release a domain stuck in WHM userdata under the SAME
 * user's previously-deleted plan, then report whether it was cleared.
 *
 * The same-chatId guardrail lives INSIDE the query (never a post-hoc check) so a
 * cross-user release is structurally impossible.
 *
 * @returns {{ released:boolean, staleCpUser?:string, staleAccountId?:any, reason?:string }}
 */
async function attemptUserdataRelease({ db, whmService, domain, chatId, notifyAdmin }) {
  if (!db || !whmService || !domain || chatId === undefined || chatId === null) {
    return { released: false, reason: 'missing-args' }
  }

  const wantedDomain = String(domain).toLowerCase()
  const wantedChatId = String(chatId)

  const staleAccount = await db.collection('cpanelAccounts').findOne({
    chatId: wantedChatId,           // ← same-user guardrail, INSIDE the query
    deleted: true,
    $or: [{ domain: wantedDomain }, { addonDomains: wantedDomain }],
  })

  if (!staleAccount) {
    return { released: false, reason: 'no-stale-owner-under-same-chatid' }
  }

  const result = await attemptStaleTerminate({ db, whmService, account: staleAccount, notifyAdmin })
  if (result.cleared) {
    return { released: true, staleCpUser: staleAccount.cpUser, staleAccountId: staleAccount._id }
  }
  return {
    released: false,
    staleCpUser: staleAccount.cpUser,
    staleAccountId: staleAccount._id,
    reason: result.reason || 'whm-still-failing',
  }
}

/**
 * Background sweep — reclaims WHM license slots held by accounts our DB already
 * considers deleted but that were never actually removed from the WHM box.
 * Covers whmTerminatePending rows AND historical deleted rows whose /removeacct
 * was mis-recorded as success (flag never set) — the class that silently filled
 * the cPanel license and blocked all new provisioning (2026-09 RCA). ONE
 * listAccounts() read per pass: still-on-WHM -> /removeacct; already-gone ->
 * reconcile terminatedOnWhm. Defers if WHM is unreachable.
 * @returns {{ scanned:number, cleared:number, reconciled:number, stillPending:number, gaveUp:number }}
 */
async function runSelfHealSweep({ db, whmService, notifyAdmin, limit = 200 }) {
  const cpanelAccounts = db.collection('cpanelAccounts')
  const candidates = await cpanelAccounts.find({
    deleted: true,
    terminatedOnWhm: { $ne: true },
    cpUser: { $exists: true, $nin: [null, ''] },
  }).limit(limit).toArray()

  if (!candidates.length) return { scanned: 0, cleared: 0, reconciled: 0, stillPending: 0, gaveUp: 0 }

  let liveUsers = null
  try {
    const accts = await whmService.listAccounts()
    if (Array.isArray(accts)) liveUsers = new Set(accts.map(a => String(a.user || '').toLowerCase()).filter(Boolean))
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`[whm-userdata-heal] sweep: listAccounts failed (${e.message}) - deferring`)
    return { scanned: candidates.length, cleared: 0, reconciled: 0, stillPending: candidates.length, gaveUp: 0, deferred: true }
  }
  if (!liveUsers) return { scanned: candidates.length, cleared: 0, reconciled: 0, stillPending: candidates.length, gaveUp: 0, deferred: true }

  let cleared = 0, reconciled = 0, stillPending = 0, gaveUp = 0
  for (const account of candidates) {
    const u = String(account.cpUser).toLowerCase()
    if (!liveUsers.has(u)) {
      await cpanelAccounts.updateOne(
        { _id: account._id },
        { $set: { terminatedOnWhm: true, whmTerminatedAt: new Date(), whmTerminateReconciled: true }, $unset: { whmTerminatePending: '', whmTerminateRetryCount: '' } }
      )
      reconciled++
      continue
    }
    const r = await attemptStaleTerminate({ db, whmService, account, notifyAdmin })
    if (r.cleared) cleared++
    else {
      stillPending++
      if (r.retriesUsed >= RETRY_CAP) gaveUp++
    }
  }

  if (candidates.length) {
    // eslint-disable-next-line no-console
    console.log(`[whm-userdata-heal] sweep: scanned=${candidates.length} terminated=${cleared} reconciled=${reconciled} stillPending=${stillPending} gaveUp=${gaveUp}`)
  }

  return { scanned: candidates.length, cleared, reconciled, stillPending, gaveUp }
}

module.exports = {
  RETRY_CAP,
  STALE_MATCH_REASON_RX,
  isStaleUserdataError,
  attemptStaleTerminate,
  attemptUserdataRelease,
  runSelfHealSweep,
}
