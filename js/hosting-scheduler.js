/* global process */
/**
 * Hosting Auto-Renew Scheduler
 *
 * Runs hourly checks on all cPanel hosting accounts:
 * 1. 24h advance notification — warns user their plan is about to expire
 * 2. Auto-renew — charges wallet and extends plan (all plans, if enabled & funds available)
 * 3. Immediate suspension — cPanel account suspended the moment plan expires (website goes offline)
 * 4. Delete — terminates cPanel account after 48h grace period if not renewed
 *
 * Depends on: cpanelAccounts collection, users collection, WHM service, Telegram bot
 */

require('dotenv').config()
const { log } = require('console')

const PREMIUM_ANTIRED_WEEKLY_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE) || 50
const PREMIUM_ANTIRED_CPANEL_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_CPANEL_PRICE) || 75
const GOLDEN_ANTIRED_CPANEL_PRICE = parseFloat(process.env.GOLDEN_ANTIRED_CPANEL_PRICE) || 100

const GRACE_PERIOD_HOURS = 48
const ADVANCE_NOTIFY_HOURS = 24
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Check if a plan is a weekly plan (determines renewal duration: 7 vs 30 days)
 */
function isWeeklyPlan(planName) {
  const name = (planName || '').toLowerCase()
  return name.includes('week') || name.includes('1-week')
}

/**
 * Get renewal price for an account.
 * Prefers the price-locked `renewalPriceUsd` field on the account (snapshotted
 * at purchase time so promo/discount customers don't get billed the higher
 * list price at renewal — see HOSTING_3WEEK_RCA.md for the bug background).
 * Falls back to the plan-name → env-driven map for legacy accounts that
 * haven't been back-filled yet.
 *
 * @param {string|object} planOrAccount - Either a plan-name string (legacy
 *   call sites) or a full cpanelAccount document (preferred).
 */
function getPlanPrice(planOrAccount) {
  // Account-object call: use locked renewal price if present.
  if (planOrAccount && typeof planOrAccount === 'object') {
    if (typeof planOrAccount.renewalPriceUsd === 'number' && planOrAccount.renewalPriceUsd > 0) {
      return planOrAccount.renewalPriceUsd
    }
    // No locked price — fall through to plan-name lookup
    planOrAccount = planOrAccount.plan
  }
  const name = (planOrAccount || '').toLowerCase()
  if (name.includes('golden')) return GOLDEN_ANTIRED_CPANEL_PRICE
  if (name.includes('premium') && name.includes('hostpanel')) return PREMIUM_ANTIRED_CPANEL_PRICE
  if (name.includes('premium') && name.includes('week')) return PREMIUM_ANTIRED_WEEKLY_PRICE
  if (name.includes('business')) return GOLDEN_ANTIRED_CPANEL_PRICE
  if (name.includes('pro')) return PREMIUM_ANTIRED_CPANEL_PRICE
  if (name.includes('starter')) return PREMIUM_ANTIRED_WEEKLY_PRICE
  return 0
}

/**
 * Get renewal duration in days for a plan
 */
function getPlanDuration(planName) {
  const name = (planName || '').toLowerCase()
  if (name.includes('week') || name.includes('1-week')) return 7
  return 30
}

/**
 * Initialize the scheduler
 * @param {object} deps - { bot, db, whmService }
 */
function initScheduler(deps) {
  const { bot, db, whmService } = deps
  const cpanelAccounts = db.collection('cpanelAccounts')
  const walletOf = db.collection('walletOf')
  const stateCol = db.collection('state')

  let antiRedService = null
  try {
    antiRedService = require('./anti-red-service')
  } catch (_) {
    log('[HostingScheduler] Anti-Red service not available')
  }

  const { smartWalletDeduct, usdToNgn, getBalance } = require('./utils')
  const { translation } = require('./translation')

  log('[HostingScheduler] Initialized — checking every hour')
  log('[HostingScheduler] Policy: all plans auto-renew if enabled by user')

  /**
   * Resolve the user's preferred language from the `state` collection.
   * Falls back to 'en' on any failure.
   */
  async function getUserLang(chatId) {
    try {
      const userState = await stateCol.findOne({ _id: String(chatId) })
      return userState?.userLanguage || 'en'
    } catch (_) {
      return 'en'
    }
  }

  /**
   * Localized translation helper bound to a chatId.
   */
  async function tFor(chatId, key, ...args) {
    const lang = await getUserLang(chatId)
    return translation(`t.${key}`, lang, ...args)
  }

  /**
   * Send Telegram notification
   */
  function notify(chatId, message) {
    if (!bot) return
    bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
      log(`[HostingScheduler] Notify error for ${chatId}: ${err.message}`)
    })
  }

  /**
   * Best-effort admin notifier (Telegram) — used by the WHM userdata self-heal
   * when /removeacct persistently fails. Silent no-op if bot or admin chatId
   * are unavailable so scheduler paths NEVER throw on notify failure.
   */
  function notifyAdmin(message) {
    if (!bot) return
    const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID
    if (!adminId) return
    bot.sendMessage(adminId, message, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => { /* noop */ })
  }

  /**
   * Suspend a cPanel account via WHM
   */
  async function suspendAccount(cpUsername, reason) {
    if (!whmService) return { success: false }
    try {
      return await whmService.suspendAccount(cpUsername, reason)
    } catch (err) {
      log(`[HostingScheduler] Suspend error for ${cpUsername}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Unsuspend a cPanel account via WHM
   */
  async function unsuspendAccount(cpUsername) {
    if (!whmService) return { success: false }
    try {
      return await whmService.unsuspendAccount(cpUsername)
    } catch (err) {
      log(`[HostingScheduler] Unsuspend error for ${cpUsername}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Terminate/delete a cPanel account via WHM
   */
  async function terminateAccount(cpUsername) {
    if (!whmService) return false
    try {
      const result = await whmService.terminateAccount(cpUsername)
      log(`[HostingScheduler] Terminated cPanel account: ${cpUsername} — result: ${result}`)
      return result
    } catch (err) {
      log(`[HostingScheduler] Terminate error for ${cpUsername}: ${err.message}`)
      return false
    }
  }

  /**
   * Remove anti-red worker routes for a domain (cleanup on deletion)
   */
  async function cleanupAntiRed(domain) {
    if (!antiRedService) return
    try {
      if (typeof antiRedService.removeWorkerRoute === 'function') {
        await antiRedService.removeWorkerRoute(domain)
        log(`[HostingScheduler] Anti-Red cleanup done for ${domain}`)
      }
    } catch (_) {
      // Non-blocking — cleanup is best-effort
    }
  }

  /**
   * Main check — run hourly
   */
  async function runCheck() {
    try {
      const now = new Date()
      const in24h = new Date(now.getTime() + ADVANCE_NOTIFY_HOURS * 60 * 60 * 1000)
      const gracePeriodAgo = new Date(now.getTime() - GRACE_PERIOD_HOURS * 60 * 60 * 1000)

      const allAccounts = await cpanelAccounts.find({ expiryDate: { $exists: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true } }).toArray()

      let renewed = 0, notified = 0, suspended = 0, deleted = 0

      for (const account of allAccounts) {
        const expiry = new Date(account.expiryDate)
        const chatId = account.chatId
        const domain = account.domain
        const plan = account.plan
        const weekly = isWeeklyPlan(plan)

        // All plans can auto-renew if the user has it enabled
        const isAutoRenew = account.autoRenew !== false

        // ── Case 1: Expiring within 24h — send advance notification ──
        if (expiry > now && expiry <= in24h && !account.expiryNotified) {
          const price = getPlanPrice(account)
          const lang = await getUserLang(chatId)
          const tt = (key, ...args) => translation(`t.${key}`, lang, ...args)

          let renewText
          if (isAutoRenew) {
            renewText = `Your wallet will be auto-charged <b>$${price}</b> on expiry.`
          } else {
            renewText = tt('schedRenewTextOff', GRACE_PERIOD_HOURS)
          }

          notify(chatId,
            tt('schedExpiryWarningTitle') + '\n\n'
            + tt('schedExpiryWarningBody', plan, domain) + '\n\n'
            + `${renewText}\n\n`
            + tt('schedRenewTextWalletHint') + '\n'
            + tt('schedRenewTextToggleHint', domain)
          )

          await cpanelAccounts.updateOne(
            { _id: account._id },
            { $set: { expiryNotified: true } }
          )
          notified++
          log(`[HostingScheduler] Notified ${chatId} — ${domain} (${plan}) expiring soon`)
        }

        // ── Case 2: Expired — attempt auto-renew (monthly only) or grace period ──
        if (expiry <= now && !account.deleted) {
          const price = getPlanPrice(account)
          const duration = getPlanDuration(plan)

          // Only attempt auto-renew for monthly plans with auto-renew enabled
          if (isAutoRenew && price > 0) {
            // ━━━ LAYER 1: Fresh-read idempotency guard (prevents duplicate renewal across pods) ━━━
            const freshAccount = await cpanelAccounts.findOne({ _id: account._id })
            if (freshAccount && new Date(freshAccount.expiryDate) > now) {
              log(`[HostingScheduler] Skipped ${domain} — already renewed by another process (expires ${freshAccount.expiryDate})`)
              continue
            }

            const result = await smartWalletDeduct(walletOf, chatId, price)

            if (result.success) {
              // Auto-renew: wallet charged — extend expiry
              const newExpiry = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000)

              // ━━━ LAYER 2: Atomic claim — only extend if still expired ━━━
              // CRITICAL: `includeResultMetadata: false` — without it the v5 mongo
              // driver returns the wrapper `{value, lastErrorObject, ok}` even on
              // no-match (which is truthy), so the `if (!claimResult)` "duplicate
              // renewal prevented" branch never fired. See utils.js:smartWalletDeduct
              // for the full root-cause writeup (2026-05-30).
              const claimResult = await cpanelAccounts.findOneAndUpdate(
                {
                  _id: account._id,
                  expiryDate: { $lte: now }  // must still be expired
                },
                {
                  $set: {
                    expiryDate: newExpiry,
                    expiryNotified: false,
                    lastRenewedAt: now,
                    suspended: false,
                    renewalCount: (account.renewalCount || 0) + 1,
                    // GAP-4 (2026-09): clear any prior auto-renew failure state on success.
                    autoRenewLastError: null,
                    autoRenewLastAttemptAt: now,
                    suspendedReason: null,
                  },
                },
                { returnDocument: 'after', includeResultMetadata: false }
              )

              if (!claimResult) {
                log(`[HostingScheduler] ⚠️ DUPLICATE RENEWAL PREVENTED: ${domain} already renewed — refunding $${price} to chatId ${chatId}`)
                await walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: -price } })
                continue
              }

              if (antiRedService) {
                try {
                  await antiRedService.deployFullProtection(account.cpUser, domain, plan)
                } catch (_) {}
              }

              if (account.suspended) {
                await unsuspendAccount(account.cpUser)
              }

              const { usdBal: remUsd } = await getBalance(walletOf, chatId)

              const langA = await getUserLang(chatId)
              const ttA = (key, ...args) => translation(`t.${key}`, langA, ...args)
              notify(chatId,
                ttA('schedAutoRenewedTitle') + '\n\n'
                + ttA('schedAutoRenewedBody',
                  plan,
                  domain,
                  price,
                  newExpiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  remUsd.toFixed(2))
              )
              renewed++
              log(`[HostingScheduler] Auto-renewed ${domain} (${plan}) for ${chatId} — charged $${price}`)
              continue
            } else {
              // GAP-4 (2026-09): record WHY auto-renew didn't run so the reseller API can surface it
              // (GET /hosting/:user → auto_renew_last_error). Recorded even if already suspended; the
              // next attempt is the next hourly sweep. Cleared on a successful renew (above).
              try {
                await cpanelAccounts.updateOne(
                  { _id: account._id },
                  { $set: { autoRenewLastError: 'insufficient_funds', autoRenewLastAttemptAt: now } }
                )
              } catch (_) { /* best-effort */ }
              if (!account.suspended) {
                const { usdBal } = result
                const langB = await getUserLang(chatId)
                const ttB = (key, ...args) => translation(`t.${key}`, langB, ...args)
                notify(chatId,
                  ttB('schedAutoRenewFailedTitle') + '\n\n'
                  + ttB('schedAutoRenewFailedBody',
                    plan,
                    domain,
                    price,
                    (usdBal || 0).toFixed(2),
                    GRACE_PERIOD_HOURS)
                )
                log(`[HostingScheduler] Auto-renew failed (low funds) for ${domain} — USD: $${(usdBal || 0).toFixed(2)}, needed: $${price}`)
              }
            }
          }

          // ── Immediate suspension on expiry — website goes offline right away ──
          if (!account.suspended) {
            // GAP-4 (2026-09): capture a machine-readable suspension reason for the reseller API.
            const suspendReason = (isAutoRenew && price > 0) ? 'auto_renew_insufficient_funds' : 'plan_expired'
            await suspendAccount(account.cpUser, 'Plan expired — hosting suspended')

            await cpanelAccounts.updateOne(
              { _id: account._id },
              { $set: { suspended: true, suspendedAt: now, suspendedReason: suspendReason } }
            )

            suspended++
            log(`[HostingScheduler] SUSPENDED ${domain} (${plan}) for ${chatId} — plan expired, immediate suspension`)
          }

          // ── Grace period check — delete after 48h if still not renewed ──
          if (expiry <= gracePeriodAgo && account.suspended && !account.deleted) {
            const terminated = await terminateAccount(account.cpUser)

            // Cleanup anti-red routes
            await cleanupAntiRed(domain)

            // If WHM /removeacct silently failed (transient network / disk /
            // license / mid-restart), the domains this account owns stay in
            // WHM's userdata layer forever. Flag the row so `runSelfHealSweep`
            // (below) retries automatically — otherwise the user hits
            // "domain already exists in the userdata" on their NEXT hosting
            // purchase when they try to attach or re-primary one of these
            // same domains. Root-caused via @Devils_gods report 2026-08-29.
            const updateFields = { deleted: true, deletedAt: now }
            if (!terminated) {
              updateFields.whmTerminatePending = true
              updateFields.whmTerminateLastAttemptAt = now
              try { notifyAdmin && notifyAdmin(`⚠️ <b>WHM /removeacct failed (grace-period)</b>\nUser: ${chatId}\ncPanel: <code>${account.cpUser}</code>\nDomain: <b>${domain}</b>\n\n<i>Row flagged whmTerminatePending — self-heal will retry hourly.</i>`) } catch (_) {}
            }
            await cpanelAccounts.updateOne(
              { _id: account._id },
              { $set: updateFields }
            )

            const langD = await getUserLang(chatId)
            const ttD = (key, ...args) => translation(`t.${key}`, langD, ...args)
            notify(chatId,
              ttD('schedDeletedTitle') + '\n\n'
              + ttD('schedDeletedBody', domain, plan)
            )
            deleted++
            log(`[HostingScheduler] DELETED cPanel for ${domain} (${plan}), user ${chatId} — WHM terminate: ${terminated}${terminated ? '' : ' (flagged whmTerminatePending for retry)'}`)
          }
        }
      }

      if (renewed || notified || suspended || deleted) {
        log(`[HostingScheduler] Check complete: ${renewed} renewed, ${notified} notified, ${suspended} suspended, ${deleted} deleted`)
      }
    } catch (err) {
      log(`[HostingScheduler] Error during check: ${err.message}`)
    }
  }

  /**
   * Startup enforcement — catch-up sweep for any accounts that expired while bot was offline.
   * 1. Tries auto-renew first (for all plans with auto-renew enabled and sufficient funds)
   * 2. Suspends all expired-but-unsuspended accounts
   * 3. Deletes all past-grace-period accounts that weren't auto-renewed
   */
  async function startupEnforcement() {
    try {
      const now = new Date()
      const gracePeriodAgo = new Date(now.getTime() - GRACE_PERIOD_HOURS * 60 * 60 * 1000)

      const expiredNotDeleted = await cpanelAccounts.find({
        expiryDate: { $lte: now },
        deleted: { $ne: true },
        terminatedOnWhm: { $ne: true },
        archived: { $ne: true },
      }).toArray()

      if (expiredNotDeleted.length === 0) {
        log(`[HostingScheduler] Startup enforcement: no expired accounts need action`)
        return
      }

      let enforcedSuspend = 0, enforcedDelete = 0, enforcedRenew = 0

      for (const account of expiredNotDeleted) {
        const expiry = new Date(account.expiryDate)
        const domain = account.domain || account.cpUser
        const plan = account.plan
        const chatId = account.chatId
        const hoursExpired = ((now - expiry) / 3600000).toFixed(1)

        // ── Step 0: Try auto-renew if enabled and user has funds ──
        const isAutoRenew = account.autoRenew !== false
        const price = getPlanPrice(account)
        const duration = getPlanDuration(plan)

        if (isAutoRenew && price > 0) {
          const result = await smartWalletDeduct(walletOf, chatId, price)
          if (result.success) {
            const newExpiry = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000)
            const claimResult = await cpanelAccounts.findOneAndUpdate(
              { _id: account._id, expiryDate: { $lte: now } },
              {
                $set: {
                  expiryDate: newExpiry,
                  expiryNotified: false,
                  lastRenewedAt: now,
                  suspended: false,
                  renewalCount: (account.renewalCount || 0) + 1,
                },
                $unset: {
                  suspendedAt: '',
                  expiryUserNotified: '',
                },
              },
              { returnDocument: 'after', includeResultMetadata: false }
            )

            if (!claimResult) {
              log(`[HostingScheduler] STARTUP: Duplicate renewal prevented for ${domain} — refunding $${price}`)
              await walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: -price } })
              continue
            }

            // Unsuspend on WHM if it was suspended
            if (account.suspended) {
              await unsuspendAccount(account.cpUser)
            }

            if (antiRedService) {
              try { await antiRedService.deployFullProtection(account.cpUser, domain, plan) } catch (_) {}
            }

            const { usdBal: remUsd } = await getBalance(walletOf, chatId)
            const langR = await getUserLang(chatId)
            const ttR = (key, ...args) => translation(`t.${key}`, langR, ...args)
            notify(chatId,
              ttR('schedAutoRenewedTitle') + '\n\n'
              + ttR('schedAutoRenewedBody', plan, domain, price,
                newExpiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                remUsd.toFixed(2))
            )
            enforcedRenew++
            log(`[HostingScheduler] STARTUP ENFORCE: Auto-renewed ${domain} (${plan}) for ${chatId} — charged $${price}`)
            continue // Successfully renewed — skip suspend/delete
          }
        }

        // ── Step 1: Suspend if not already suspended ──
        if (!account.suspended) {
          const result = await suspendAccount(account.cpUser, 'Plan expired — startup enforcement')

          await cpanelAccounts.updateOne(
            { _id: account._id },
            { $set: { suspended: true, suspendedAt: now } }
          )

          const langE = await getUserLang(chatId)
          const ttE = (key, ...args) => translation(`t.${key}`, langE, ...args)
          notify(chatId,
            ttE('schedSuspendedTitle') + '\n\n'
            + ttE('schedSuspendedBody', domain, plan, hoursExpired, GRACE_PERIOD_HOURS)
          )

          enforcedSuspend++
          log(`[HostingScheduler] STARTUP ENFORCE: Suspended ${domain} (${plan}) for ${chatId} — expired ${hoursExpired}h ago, was NOT suspended`)
        }

        // ── Step 2: Delete if past grace period and suspended ──
        if (expiry <= gracePeriodAgo && !account.deleted) {
          // Ensure it's suspended before deleting (should be by now)
          if (!account.suspended) {
            await suspendAccount(account.cpUser, 'Plan expired — pre-delete suspension')
            await cpanelAccounts.updateOne(
              { _id: account._id },
              { $set: { suspended: true, suspendedAt: now } }
            )
          }

          const terminated = await terminateAccount(account.cpUser)
          await cleanupAntiRed(domain)

          // Same self-heal flag as the hourly path — don't lose the domain
          // in WHM userdata if /removeacct hiccups (2026-08-29 fix).
          const updateFields2 = { deleted: true, deletedAt: now }
          if (!terminated) {
            updateFields2.whmTerminatePending = true
            updateFields2.whmTerminateLastAttemptAt = now
            try { notifyAdmin && notifyAdmin(`⚠️ <b>WHM /removeacct failed (startup-enforce)</b>\nUser: ${chatId}\ncPanel: <code>${account.cpUser}</code>\nDomain: <b>${domain}</b>\n\n<i>Row flagged whmTerminatePending — self-heal will retry hourly.</i>`) } catch (_) {}
          }
          await cpanelAccounts.updateOne(
            { _id: account._id },
            { $set: updateFields2 }
          )

          const langF = await getUserLang(chatId)
          const ttF = (key, ...args) => translation(`t.${key}`, langF, ...args)
          notify(chatId,
            ttF('schedDeletedTitle') + '\n\n'
            + ttF('schedDeletedBodyHours', domain, plan, hoursExpired, GRACE_PERIOD_HOURS)
          )

          enforcedDelete++
          log(`[HostingScheduler] STARTUP ENFORCE: Deleted ${domain} (${plan}) for ${chatId} — expired ${hoursExpired}h ago, past ${GRACE_PERIOD_HOURS}h grace`)
        }
      }

      log(`[HostingScheduler] Startup enforcement complete: ${enforcedRenew} renewed, ${enforcedSuspend} suspended, ${enforcedDelete} deleted (of ${expiredNotDeleted.length} expired accounts)`)
    } catch (err) {
      log(`[HostingScheduler] Startup enforcement error: ${err.message}`)
    }
  }

  // ── Dev-sandbox safety guard (2026-08-31) ────────────────────────────
  // startupEnforcement() and runCheck() deduct REAL wallet balances (auto-renew),
  // suspend/delete REAL cPanel accounts, and cascade into AntiRed worker deploys.
  // A dev pod shares the PRODUCTION Mongo, so these MUST NOT auto-fire here or the
  // sandbox will charge/suspend real users on every boot. Parity with CF-Sync,
  // the AntiRed worker upgrade, and whm-userdata-heal, which are all dev-gated.
  // (Regression this closes: a dev-pod boot charged sequeldex.de's owner $75 via
  //  startupEnforcement auto-renew before this guard existed.)
  const _isDevSandbox = String(process.env.SKIP_WEBHOOK_SYNC || '').toLowerCase() === 'true'
  let interval = null
  if (_isDevSandbox) {
    log('[HostingScheduler] DEV SANDBOX (SKIP_WEBHOOK_SYNC=true) — startup enforcement + hourly expiry sweep SKIPPED (must not charge/suspend/delete real users from a dev pod)')
  } else {
    // Run startup enforcement first (10s), then regular hourly checks (30s+)
    setTimeout(startupEnforcement, 10000)
    // Run immediately on startup, then every hour
    setTimeout(runCheck, 30000) // 30s after startup
    interval = setInterval(runCheck, CHECK_INTERVAL_MS)
  }

  // WHM userdata self-heal — retries /removeacct on rows still flagged
  // `whmTerminatePending: true`. Runs 45s after boot (offset from runCheck),
  // then hourly. Prevents domains from staying stuck in WHM userdata after
  // a transient /removeacct failure, so users can re-attach their OWN
  // previously-registered domains to a fresh hosting plan (2026-08-29 fix).
  //
  // Gated to BOT_ENVIRONMENT=production — the sweep mutates WHM state
  // (real /removeacct calls) and Mongo (`terminatedOnWhm:true` / clears
  // `whmTerminatePending`) so it must never run from dev pods that share
  // the production Mongo (parity with CF-Sync / AntiRed worker upgrade).
  const { runSelfHealSweep } = require('./whm-userdata-heal')
  const _healEnabled = String(process.env.BOT_ENVIRONMENT || '').toLowerCase() === 'production'
  async function safeRunSelfHeal() {
    if (!_healEnabled) return
    try {
      await runSelfHealSweep({ db, whmService, notifyAdmin })
    } catch (e) {
      log(`[HostingScheduler] whm-userdata-heal sweep error: ${e.message}`)
    }
  }
  let healInterval = null
  if (_healEnabled) {
    setTimeout(safeRunSelfHeal, 45000)
    healInterval = setInterval(safeRunSelfHeal, CHECK_INTERVAL_MS)
    log(`[HostingScheduler] Scheduled: expiry check (every ${CHECK_INTERVAL_MS / 60000} min), whm-userdata-heal sweep (every ${CHECK_INTERVAL_MS / 60000} min)`)
  } else {
    log(`[HostingScheduler] Scheduled: expiry check (every ${CHECK_INTERVAL_MS / 60000} min); whm-userdata-heal sweep SKIPPED (BOT_ENVIRONMENT!=production — dev pod must not mutate prod WHM)`)
  }

  return {
    runCheck,
    runSelfHeal: safeRunSelfHeal,
    stop: () => { clearInterval(interval); if (healInterval) clearInterval(healInterval) },
    getPlanPrice,
    getPlanDuration,
    isWeeklyPlan,
  }
}

module.exports = { initScheduler, getPlanPrice, getPlanDuration, isWeeklyPlan }
