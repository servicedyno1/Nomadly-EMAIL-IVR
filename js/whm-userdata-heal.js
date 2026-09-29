/**
 * whm-userdata-heal.js
 * --------------------
 * Self-heal for the "domain still exists in WHM userdata after our DB says
 * the account is deleted" bug class.
 *
 * ROOT CAUSE (2026-08-29 RCA — user @Devils_gods report):
 *   `hosting-scheduler.js` grace-period + startup-enforcement paths call
 *   `whmService.terminateAccount(cpUser)` but IGNORE its return value — they
 *   flip `deleted:true` in Mongo regardless. When WHM `/removeacct` returns
 *   false (transient network / license / disk-full / mid-restart / race),
 *   the cPanel account (and every domain it owns in the userdata layer)
 *   stays on the WHM box FOREVER. Our Mongo says the account is gone; WHM
 *   disagrees. The user hits this the next time they buy hosting and try
 *   to attach one of their OWN previously-registered domains as either
 *   an addon or a new primary — cPanel returns
 *   `"the domain X already exists in the userdata"` and both flows fail.
 *
 * FIX:
 *   Whenever `terminateAccount` returns false, callers should now set
 *   `whmTerminatePending: true` on the row (in ADDITION to `deleted:true`)
 *   so we know the account still needs cleanup on WHM.
 *
 *   Two mechanisms consume that flag:
 *     1. `runSelfHealSweep()` — a periodic worker (registered by the
 *        hosting-scheduler) that retries `/removeacct` on every stuck row
 *        and clears the flag once WHM confirms the account is gone.
 *     2. `attemptUserdataRelease()` — invoked on-demand by the addon-flow
 *        and the change-primary handler when cPanel rejects with the
 *        "already exists in the userdata" reason. It looks up the stale
 *        account, verifies it belongs to the SAME chatId (never
 *        cross-user), retries `/removeacct` on it, and — if that succeeds —
 *        the caller can retry the failing operation once.
 *
 * SECURITY / ABUSE:
 *   - `attemptUserdataRelease` NEVER releases a domain across users.
 *     The stale account MUST have the same `chatId` as the requesting
 *     chatId. Cross-user release would allow a fresh account to swipe a
 *     domain from someone else's deleted plan.
 *   - Both mechanisms only touch rows already marked `deleted:true` in
 *     Mongo. They cannot terminate a live account.
 *   - The `blockedDomains` collection (checked before this helper runs) is
 *     the *actual* platform-level abuse gate for domains that should never
 *     be attachable regardless of who owns them.
 */

const { log } = require('console')

const RETRY_CAP = 6           // give up + loud admin alert after this many sweep passes
const STALE_MATCH_REASON_RX = /already exists in the userdata|domain.*already exists|Domain\s+".*"\s+already exists/i

/**
 * Does an addon / change-primary error reason match the "already in userdata"
 * cPanel/WHM rejection we self-heal? Case-insensitive, defensive.
 */
function isStaleUserdataError(reasonText) {
  if (!reasonText) return false
  return STALE_MATCH_REASON_RX.test(String(reasonText))
}

/**
 * Retry WHM `/removeacct` on a single deleted cpanelAccount row that still
 * has `whmTerminatePending: true`. Idempotent + no-op if already cleared.
 *
 * @returns {Promise<{ ok: boolean, cleared?: boolean, retriesUsed?: number, reason?: string }>}
 */
async function attemptStaleTerminate({ db, whmService, account, notifyAdmin }) {
  if (!account || !account._id) return { ok: false, reason: 'no account' }
  if (!account.deleted) {
    // NEVER retry-terminate a live account. Only stuck-deleted rows.
    return { ok: false, reason: 'not-deleted' }
  }
  if (account.terminatedOnWhm === true) {
    // Already confirmed removed on WHM by an earlier sweep / rescue — no-op.
    // (This is the cheap short-circuit; the previous `whmTerminatePending`
    // guard was too strict — it blocked historical stuck rows that were
    // deleted BEFORE this fix landed and therefore never got the flag.
    // Those rows are exactly the ones legit users hit today, and the
    // on-demand rescue in addon-flow / change-primary now handles them
    // by retrying `/removeacct` directly. The sweep still only touches
    // pre-flagged rows via its own query filter.)
    return { ok: true, cleared: false, reason: 'already-terminated' }
  }

  const retries = (account.whmTerminateRetryCount || 0) + 1

  let terminated = false
  try {
    terminated = await whmService.terminateAccount(account.cpUser)
  } catch (e) {
    terminated = false
    log(`[WhmUserdataHeal] terminateAccount threw for ${account.cpUser}: ${e.message}`)
  }

  const cpanelAccounts = db.collection('cpanelAccounts')

  if (terminated) {
    await cpanelAccounts.updateOne(
      { _id: account._id },
      {
        $set: {
          terminatedOnWhm: true,
          whmTerminatedAt: new Date(),
        },
        $unset: {
          whmTerminatePending: '',
          whmTerminateRetryCount: '',
        },
      }
    )
    log(`[WhmUserdataHeal] ✅ Released stale userdata for ${account.cpUser} (${account.domain}) after ${retries} attempt(s)`)
    return { ok: true, cleared: true, retriesUsed: retries }
  }

  // Still failing — record retry, alert admin at the cap.
  await cpanelAccounts.updateOne(
    { _id: account._id },
    {
      $set: {
        whmTerminatePending: true,
        whmTerminateLastAttemptAt: new Date(),
      },
      $inc: { whmTerminateRetryCount: 1 },
    }
  )
  if (retries === RETRY_CAP && typeof notifyAdmin === 'function') {
    try {
      notifyAdmin(
        `⚠️ <b>WHM /removeacct persistently failing</b>\n` +
        `cPanel: <code>${account.cpUser}</code>\n` +
        `Domain: <b>${account.domain}</b>\n` +
        `Retries: <b>${retries}</b>\n\n` +
        `<i>Manual /removeacct required on WHM — user's domain(s) can't be re-attached to any new plan until this clears.</i>`
      )
    } catch (_) { /* noop */ }
  }
  log(`[WhmUserdataHeal] ❌ WHM /removeacct still failing for ${account.cpUser} (${account.domain}) — retry ${retries}/${RETRY_CAP}`)
  return { ok: false, retriesUsed: retries, reason: 'whm-still-failing' }
}

/**
 * On-demand rescue: called by addon-flow / change-primary when cPanel
 * rejects with "already exists in the userdata". Finds the stuck deleted
 * account that still owns the domain, verifies it belongs to the SAME
 * chatId, and retries `/removeacct`. Only returns `released:true` when the
 * caller may safely retry the failing operation.
 *
 * @param {object} opts
 * @param {object} opts.db           - Mongo db handle
 * @param {object} opts.whmService   - `require('./whm-service')`
 * @param {string} opts.domain       - the domain that couldn't be attached
 * @param {string|number} opts.chatId - REQUESTING user's chatId (guardrail)
 * @param {function} [opts.notifyAdmin]
 * @returns {Promise<{
 *   released: boolean,
 *   staleCpUser?: string,
 *   staleAccountId?: string,
 *   reason?: string,
 * }>}
 */
async function attemptUserdataRelease({ db, whmService, domain, chatId, notifyAdmin }) {
  if (!db || !whmService || !domain || !chatId) {
    return { released: false, reason: 'missing-args' }
  }
  const wantedDomain = String(domain).toLowerCase()
  const wantedChatId = String(chatId)

  // Find deleted-in-Mongo accounts that STILL claim this domain (primary or addon).
  // We require SAME chatId — never cross-user rescue.
  const stale = await db.collection('cpanelAccounts').findOne({
    chatId: wantedChatId,
    deleted: true,
    $or: [
      { domain: wantedDomain },
      { addonDomains: wantedDomain },
    ],
  })

  if (!stale) {
    // No stale row → the "already in userdata" is coming from a row that
    // isn't ours (or is under a different chatId). We must NOT release.
    return { released: false, reason: 'no-stale-owner-under-same-chatid' }
  }

  // Extra guardrail: never touch a still-active account. `deleted:true`
  // is already enforced by the query above but double-check defensively.
  if (!stale.deleted) return { released: false, reason: 'stale-not-deleted' }

  log(`[WhmUserdataHeal] on-demand: chatId=${wantedChatId} domain=${wantedDomain} — retrying /removeacct on stale account ${stale.cpUser}`)

  const res = await attemptStaleTerminate({
    db, whmService, account: stale, notifyAdmin,
  })

  if (res.ok && res.cleared) {
    return { released: true, staleCpUser: stale.cpUser, staleAccountId: stale._id }
  }
  return { released: false, staleCpUser: stale.cpUser, staleAccountId: stale._id, reason: res.reason || 'terminate-failed' }
}

/**
 * Periodic sweep — reclaims WHM license slots held by accounts our DB already
 * considers deleted but that were never actually removed from the WHM box.
 *
 * Covers TWO classes:
 *   1. Rows explicitly flagged `whmTerminatePending:true` (transient /removeacct
 *      failure recorded by the scheduler).
 *   2. HISTORICAL rows marked `deleted:true` whose `/removeacct` was mis-recorded
 *      as success (flag never set) OR that were re-populated by a WHM migration/
 *      restore. These silently occupied the 30-account cPanel license and blocked
 *      ALL new provisioning ("would exceed the number of licensed users") until
 *      manually cleared — 2026-09 RCA. The old sweep only saw class (1), so these
 *      lingered forever.
 *
 * Strategy: ONE `listAccounts()` read per pass (the WHM box is slow — never N
 * calls). Rows still present on WHM → real `/removeacct` to free the slot. Rows
 * already gone → just reconcile `terminatedOnWhm:true` (no WHM call, no false
 * "still failing" alerts). If WHM is unreachable, bail and retry next pass — we
 * must not assume accounts are gone (would wrongly clear flags).
 *
 * Returns summary counts for logging / dev endpoints.
 */
async function runSelfHealSweep({ db, whmService, notifyAdmin, limit = 200 }) {
  const cpanelAccounts = db.collection('cpanelAccounts')
  const candidates = await cpanelAccounts
    .find({ deleted: true, terminatedOnWhm: { $ne: true }, cpUser: { $exists: true, $nin: [null, ''] } })
    .limit(limit)
    .toArray()

  if (!candidates.length) return { scanned: 0, cleared: 0, reconciled: 0, stillPending: 0, gaveUp: 0 }

  // Resolve the set of accounts that ACTUALLY still exist on WHM (one read).
  let liveUsers = null
  try {
    const accts = await whmService.listAccounts()
    if (Array.isArray(accts)) {
      liveUsers = new Set(accts.map(a => String(a.user || '').toLowerCase()).filter(Boolean))
    }
  } catch (e) {
    log(`[WhmUserdataHeal] sweep: listAccounts failed (${e.message}) — deferring to next pass`)
    return { scanned: candidates.length, cleared: 0, reconciled: 0, stillPending: candidates.length, gaveUp: 0, deferred: true }
  }
  if (!liveUsers) {
    log('[WhmUserdataHeal] sweep: could not resolve live WHM accounts — deferring')
    return { scanned: candidates.length, cleared: 0, reconciled: 0, stillPending: candidates.length, gaveUp: 0, deferred: true }
  }

  let cleared = 0, reconciled = 0, stillPending = 0, gaveUp = 0
  for (const acct of candidates) {
    const u = String(acct.cpUser).toLowerCase()
    if (!liveUsers.has(u)) {
      // Already gone from WHM (or removed out-of-band) — reconcile the flag only.
      await cpanelAccounts.updateOne(
        { _id: acct._id },
        {
          $set: { terminatedOnWhm: true, whmTerminatedAt: new Date(), whmTerminateReconciled: true },
          $unset: { whmTerminatePending: '', whmTerminateRetryCount: '' },
        }
      )
      reconciled++
      continue
    }
    // Still on WHM → actually terminate to reclaim the license slot.
    const res = await attemptStaleTerminate({ db, whmService, account: acct, notifyAdmin })
    if (res.ok && res.cleared) cleared++
    else if (res.retriesUsed && res.retriesUsed >= RETRY_CAP) gaveUp++
    else stillPending++
  }

  if (candidates.length) {
    log(`[WhmUserdataHeal] sweep: scanned=${candidates.length} terminated=${cleared} reconciled=${reconciled} stillPending=${stillPending} gaveUp=${gaveUp}`)
  }
  return { scanned: candidates.length, cleared, reconciled, stillPending, gaveUp }
}

module.exports = {
  isStaleUserdataError,
  attemptStaleTerminate,
  attemptUserdataRelease,
  runSelfHealSweep,
  RETRY_CAP,
}
