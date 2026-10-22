// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cloud Phone Scheduler — Expiry, Renewal & Usage Tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const schedule = require('node-schedule')
const axios = require('axios')
const { log } = require('console')
const { get, set, atomicIncrement } = require('./db.js')
const { getBalance, smartWalletDeduct } = require('./utils.js')
const { formatPhone, maskPhone, shortDate, plans, OVERAGE_RATE_SMS, OVERAGE_RATE_MIN } = require('./phone-config.js')
const phoneConfig = require('./phone-config.js')
const telnyxApi = require('./telnyx-service.js')
const twilioService = require('./twilio-service.js')
const { translation } = require('./translation.js')

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_BASE = 'https://api.telnyx.com/v2'

const telnyxHeaders = () => ({
  'Authorization': `Bearer ${TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
})

let _bot = null
let _phoneNumbersOf = null
let _phoneTransactions = null
let _phoneLogs = null
let _walletOf = null
let _payments = null
let _nameOf = null
let _stateOf = null
let _notifyGroup = null
let _maskName = null
let _nanoid = null
let _db = null

function initPhoneScheduler(deps) {
  _bot = deps.bot
  _db = deps.db || null
  _phoneNumbersOf = deps.phoneNumbersOf
  _phoneTransactions = deps.phoneTransactions
  _phoneLogs = deps.phoneLogs
  _walletOf = deps.walletOf
  _payments = deps.payments
  _nameOf = deps.nameOf
  _stateOf = deps.stateOf
  _notifyGroup = deps.notifyGroup
  _maskName = deps.maskName
  _nanoid = deps.nanoid

  // ── Hourly: Check expiry, send reminders, auto-renew ──
  schedule.scheduleJob('0 * * * *', async () => {
    log('[PhoneScheduler] Running hourly expiry check...')
    await runExpiryCheck()
  })

  // ── Daily at 3:00 AM UTC: Pull usage from Telnyx CDR ──
  schedule.scheduleJob('0 3 * * *', async () => {
    log('[PhoneScheduler] Running daily usage tracking...')
    await runUsageTracking()
  })

  // ── Daily at 0:05 AM UTC: Reset monthly counters on billing date ──
  schedule.scheduleJob('5 0 * * *', async () => {
    log('[PhoneScheduler] Running monthly counter reset check...')
    await runMonthlyReset()
  })

  // ── Daily at 0:30 AM UTC: Pricing reconciliation ──
  // Scans phoneNumbersOf for plan/price drift (mismatched planPrice for the
  // stored plan tier) and pings admin. Catches Apr-30-style audit-trail
  // holes and silent grandfathered prices within 24h instead of weeks.
  schedule.scheduleJob('30 0 * * *', async () => {
    log('[PhoneScheduler] Running daily pricing reconciliation...')
    await runPricingReconciler()
  })

  // ── Every 6 hours: Remove numbers inactive_released for >48h ──
  // Numbers silently released by the provider (detected by phone-monitor)
  // get a 48h grace window. After that, this job cleans them up.
  schedule.scheduleJob('0 */6 * * *', async () => {
    log('[PhoneScheduler] Running inactive-released cleanup...')
    await runInactiveReleasedCleanup()
  })

  log('[PhoneScheduler] Scheduled: expiry check (hourly), usage tracking (daily 3AM), monthly reset (daily 0:05AM), pricing reconciler (daily 0:30AM), inactive-released cleanup (every 6h)')
}

async function _getUserLang(chatId) {
  try {
    if (!_stateOf) return 'en'
    const info = await get(_stateOf, chatId)
    return info?.userLanguage || 'en'
  } catch { return 'en' }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPIRY CHECK — Reminders + Auto-Renew
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runExpiryCheck() {
  try {
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    const now = new Date()
    let remindersSent = 0
    let autoRenewed = 0
    let suspended = 0
    let heldForMigration = 0

    for (const user of allUsers) {
      const chatId = user._id
      const numbers = user.val?.numbers || []
      let modified = false

      for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i]
        if (num.status !== 'active' && num.status !== 'suspended') continue

        // ── Twilio paused (TWILIO_ENABLED=false — account suspended) ──
        // Dead Twilio numbers are HELD for migration to Telnyx: no renewal
        // reminders, no auto-renew wallet charge, no release. The plan keeps its
        // expiresAt; the migration tool moves it to a Telnyx number with the same
        // expiry. Flip TWILIO_ENABLED back to true and normal processing resumes.
        if (num.provider === 'twilio' && !phoneConfig.isTwilioEnabled()) {
          heldForMigration++
          continue
        }

        const expiresAt = new Date(num.expiresAt)
        const msUntilExpiry = expiresAt.getTime() - now.getTime()
        const daysUntilExpiry = msUntilExpiry / (1000 * 60 * 60 * 24)

        // ── 3-day reminder ──
        if (daysUntilExpiry > 2.5 && daysUntilExpiry <= 3.0 && !num._reminder3Sent) {
          const { usdBal } = await getBalance(_walletOf, chatId)
          const plan = plans[num.plan] || { name: num.plan, price: num.planPrice }
          const msg = buildReminderMsg(num, 3, plan, usdBal)
          sendToUser(chatId, msg)
          numbers[i]._reminder3Sent = true
          modified = true
          remindersSent++
          log(`[PhoneScheduler] 3-day reminder sent: ${chatId} ${num.phoneNumber}`)
        }

        // ── 1-day reminder ──
        if (daysUntilExpiry > 0.5 && daysUntilExpiry <= 1.0 && !num._reminder1Sent) {
          const { usdBal } = await getBalance(_walletOf, chatId)
          const plan = plans[num.plan] || { name: num.plan, price: num.planPrice }
          const msg = buildFinalWarningMsg(num, plan, usdBal)
          sendToUser(chatId, msg)
          numbers[i]._reminder1Sent = true
          modified = true
          remindersSent++
          log(`[PhoneScheduler] 1-day warning sent: ${chatId} ${num.phoneNumber}`)
        }

        // ── Expired — attempt auto-renew or release immediately ──
        if (msUntilExpiry <= 0 && num.status === 'active') {
          if (num.autoRenew) {
            // ━━━ Grace-period fast-path (2026-07-16 log-noise fix) ━━━
            // If number is already in an active grace period, do a cheap
            // wallet read first. If the balance still can't cover the
            // renewal price, skip the whole attemptAutoRenew call — it
            // would fail identically and produce two redundant log lines
            // per hour ("Auto-renew failed …insufficient funds" and
            // "…still in grace period, skipping release"). Two phones in
            // grace hit the Railway 500 logs/sec rate limit on
            // 2026-07-14T03:33 (54 messages dropped).
            //
            // The user was already notified when grace started. We keep
            // hourly ticks so a wallet top-up is caught promptly: when
            // usdBal crosses the price threshold, we fall through to
            // attemptAutoRenew and renew immediately.
            const graceUntilIso = num._graceUntil
            if (graceUntilIso) {
              const graceUntilDate = new Date(graceUntilIso)
              if (graceUntilDate > new Date()) {
                try {
                  const { usdBal } = await getBalance(_walletOf, chatId)
                  const needed = Number(num.planPrice) || 0
                  if (Number.isFinite(usdBal) && Number.isFinite(needed) && usdBal < needed) {
                    // Wallet still insufficient — skip silently. Numbers
                    // array untouched, no set() call, no log line, no DB
                    // charge attempt. The grace-expired branch will run
                    // when graceUntil passes.
                    continue
                  }
                  // else: wallet has crossed the threshold — fall through
                  // to attemptAutoRenew and renew now.
                } catch (_e) {
                  // Balance read failed — fall through to the normal path
                  // (safer than silently skipping).
                }
              }
            }

            const result = await attemptAutoRenew(chatId, num, i, numbers)
            const outcome = (result && typeof result === 'object') ? result.outcome : (result === true ? 'renewed' : 'error')

            if (outcome === 'renewed') {
              autoRenewed++
              modified = true
            } else if (outcome === 'already_renewed_elsewhere' || outcome === 'duplicate_prevented') {
              // Another pod successfully renewed this number — leave it alone.
              // Reload the fresh DB state into our local copy so we don't
              // accidentally overwrite it with stale data in the final set().
              try {
                const fresh = await _phoneNumbersOf.findOne({ _id: chatId })
                const f = fresh?.val?.numbers?.find(n => n.phoneNumber === num.phoneNumber)
                if (f) {
                  numbers[i] = f
                }
              } catch (_) { /* best-effort refresh */ }
              log(`[PhoneScheduler] Skipped release for ${num.phoneNumber}: another pod already renewed (outcome=${outcome})`)
            } else if (outcome === 'insufficient_funds') {
              // ━━━ FINAL SAFETY: re-fetch and verify before releasing ━━━
              // Even after returning 'insufficient_funds', another pod might
              // have funded+renewed in the gap. Never delete a number whose
              // freshly-fetched expiresAt is in the future.
              const freshDoc = await _phoneNumbersOf.findOne({ _id: chatId })
              const freshN = freshDoc?.val?.numbers?.find(n => n.phoneNumber === num.phoneNumber)
              if (freshN && new Date(freshN.expiresAt) > new Date()) {
                log(`[PhoneScheduler] ABORT release for ${num.phoneNumber}: fresh DB shows expiresAt in future (${freshN.expiresAt}, status ${freshN.status})`)
                const name = await get(_nameOf, chatId).catch(() => null)
                _notifyGroup?.(
                  `🛡️ <b>Release ABORTED (safety):</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${maskPhone(num.phoneNumber)} appeared expired locally but DB shows future expiresAt (${freshN.expiresAt}). Likely race with another pod — kept the number.`,
                  `🛡️ <b>Release ABORTED (safety):</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} appeared expired locally but DB shows future expiresAt (${freshN.expiresAt}). Likely race with another pod — kept the number.`
                )
                numbers[i] = freshN
                modified = true
              } else {
                // ━━━ 24-HOUR GRACE PERIOD before releasing ━━━
                // Instead of immediately destroying the number, give the user
                // 24h to top up their wallet. The next hourly check will
                // auto-renew if funds appear, or release once grace expires.
                const graceUntil = num._graceUntil ? new Date(num._graceUntil) : null
                const graceExpired = graceUntil && graceUntil <= new Date()
                const shortfall = (result.needed || num.planPrice) - (result.usdBal || 0)

                if (!graceUntil) {
                  // ── First insufficient-funds hit: START grace period ──
                  const graceDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000)
                  numbers[i]._graceUntil = graceDeadline.toISOString()
                  numbers[i].status = 'active' // keep active during grace
                  modified = true
                  const userLang = await _getUserLang(chatId)
                  sendToUser(chatId, buildGracePeriodMsg(num, shortfall, graceDeadline, userLang))
                  const name = await get(_nameOf, chatId).catch(() => null)
                  _notifyGroup?.(
                    `⏳ <b>Grace Period Started:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${maskPhone(num.phoneNumber)} — insufficient funds ($${(result.usdBal || 0).toFixed(2)} / $${result.needed || num.planPrice} needed). 24h grace until ${graceDeadline.toISOString().slice(0, 16)} UTC.`,
                    `⏳ <b>Grace Period Started:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} — insufficient funds ($${(result.usdBal || 0).toFixed(2)} / $${result.needed || num.planPrice} needed). 24h grace until ${graceDeadline.toISOString().slice(0, 16)} UTC.`
                  )
                  log(`[PhoneScheduler] Grace period started for ${num.phoneNumber}: deposit $${shortfall.toFixed(2)} by ${graceDeadline.toISOString()}`)
                } else if (!graceExpired) {
                  // ── Still within grace period — skip, wait for next check ──
                  log(`[PhoneScheduler] ${num.phoneNumber} still in grace period (until ${graceUntil.toISOString()}), skipping release`)
                } else {
                  // ── Grace period expired — release from provider ──
                  numbers[i].status = 'released'
                  numbers[i]._reminder3Sent = false
                  numbers[i]._reminder1Sent = false
                  numbers[i]._released = true
                  numbers[i]._graceUntil = null
                  numbers[i]._releasedAfterGrace = true
                  modified = true
                  suspended++
                  await releaseFromProvider(num, user.val, chatId)
                  const userLang = await _getUserLang(chatId)
                  sendToUser(chatId, buildAutoRenewFailedMsg(num, userLang))
                  const name = await get(_nameOf, chatId)
                  _notifyGroup?.(
                    `❌ <b>Grace Expired + Released:</b> ${_maskName?.(name)} lost ${maskPhone(num.phoneNumber)} (grace period ended, still insufficient balance)`,
                    `❌ <b>Grace Expired + Released:</b> ${_maskName?.(name)} lost ${formatPhone(num.phoneNumber)} (grace period ended, still insufficient balance)`
                  )
                  log(`[PhoneScheduler] Grace expired, released from provider: ${chatId} ${num.phoneNumber}`)
                }
              }
            } else {
              // outcome ∈ { 'invalid_price', 'not_found', 'error' }
              // Do NOT release the number — the issue is operational, not
              // a payment failure. Alert admin and leave the number active.
              const name = await get(_nameOf, chatId).catch(() => null)
              _notifyGroup?.(
                `⚠️ <b>Auto-Renew Deferred (no release):</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${maskPhone(num.phoneNumber)} — outcome=<code>${outcome}</code>. Number kept active for manual review.`,
                `⚠️ <b>Auto-Renew Deferred (no release):</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} — outcome=<code>${outcome}</code>. Number kept active for manual review.`
              )
              log(`[PhoneScheduler] Auto-renew deferred for ${num.phoneNumber}: outcome=${outcome} — number NOT released`)
            }
          } else {
            // No auto-renew — release from provider immediately
            numbers[i].status = 'released'
            numbers[i]._reminder3Sent = false
            numbers[i]._reminder1Sent = false
            numbers[i]._released = true
            modified = true
            suspended++
            await releaseFromProvider(num, user.val, chatId)
            const userLang = await _getUserLang(chatId)
            sendToUser(chatId, buildSuspendedMsg(num, userLang))
            const name = await get(_nameOf, chatId)
            _notifyGroup?.(
              `📤 <b>Expired + Released:</b> ${_maskName?.(name)} lost ${maskPhone(num.phoneNumber)} (no auto-renew)`,
              `📤 <b>Expired + Released:</b> ${_maskName?.(name)} lost ${formatPhone(num.phoneNumber)} (no auto-renew)`
            )
            log(`[PhoneScheduler] Expired, released from provider (no auto-renew): ${chatId} ${num.phoneNumber}`)
          }
        }
      }

      if (modified) {
        await set(_phoneNumbersOf, chatId, { numbers })
      }
    }

    log(`[PhoneScheduler] Expiry check complete: ${remindersSent} reminders, ${autoRenewed} auto-renewed, ${suspended} released${heldForMigration ? `, ${heldForMigration} Twilio held for migration (TWILIO_ENABLED=false)` : ''}`)
  } catch (e) {
    log(`[PhoneScheduler] Expiry check error: ${e.message}`)
  }
}

// Release number from provider (Telnyx or Twilio) to stop billing.
// `chatId` is optional and only used for self-heal persistence of a rotated
// Twilio sub-account token.
async function releaseFromProvider(num, userData, chatId) {
  const phoneNumber = num.phoneNumber || num
  const provider = num.provider || 'telnyx'

  try {
    if (provider === 'twilio') {
      // Release from Twilio — MUST use sub-account, never main account
      const twilioNumberSid = num.twilioNumberSid
      const subSid = num.twilioSubAccountSid || userData?.twilioSubAccountSid
      let subToken = num.twilioSubAccountToken || userData?.twilioSubAccountToken

      // Auto-resolve sub-account token if SID exists but token is missing
      if (subSid && !subToken) {
        try {
          const subAcct = await twilioService.getSubAccount(subSid)
          if (subAcct?.authToken) {
            subToken = subAcct.authToken
            log(`[PhoneScheduler] Resolved sub-account token for ${subSid}`)
          }
        } catch (e) { log(`[PhoneScheduler] Sub-account token resolve error: ${e.message}`) }
      }

      if (twilioNumberSid && subSid && subToken) {
        const result = await twilioService.releaseNumber(twilioNumberSid, subSid, subToken)
        // ━━━ Persist rotated token if self-heal kicked in ━━━
        if (result?.tokenRotated && result?.liveToken && chatId && _phoneNumbersOf) {
          try {
            await _phoneNumbersOf.updateOne(
              { _id: chatId },
              { $set: {
                'val.twilioSubAccountToken': result.liveToken,
                'val._twilioSubTokenRefreshedAt': new Date().toISOString(),
                'val._twilioSubTokenRefreshedBy': 'phone-scheduler.releaseFromProvider self-heal',
              } }
            )
            log(`[PhoneScheduler] Persisted rotated sub-account token for chatId ${chatId} sub ${subSid}`)
            _notifyGroup?.(`🔑 <b>Twilio sub-token rotated</b> for <code>${chatId}</code> sub <code>${subSid}</code> — auto-refreshed in DB on release path.`)
          } catch (persistErr) {
            log(`[PhoneScheduler] FAILED to persist rotated token for ${chatId}: ${persistErr.message}`)
          }
        }
        if (result?.success) return log(`[PhoneScheduler] Released Twilio number: ${phoneNumber} (sid=${twilioNumberSid})${result.tokenRotated ? ' [self-healed]' : ''}`)
        log(`[PhoneScheduler] Twilio release by SID failed for ${phoneNumber}: ${result?.error || 'unknown error'}`)
      } else if (twilioNumberSid && subSid) {
        // ━━━ SECURITY: Try release via parent account's sub-account API (no main-account fallback) ━━━
        try {
          const client = twilioService.getClient()
          await client.api.v2010.accounts(subSid).incomingPhoneNumbers(twilioNumberSid).remove()
          return log(`[PhoneScheduler] Released Twilio number via parent→sub API: ${phoneNumber}`)
        } catch (e2) {
          log(`[PhoneScheduler] Could not release Twilio number ${phoneNumber} via parent→sub API: ${e2.message}`)
        }
      } else {
        log(`[PhoneScheduler] SKIPPED Twilio release for ${phoneNumber}: missing sub-account credentials (subSid=${!!subSid}, subToken=${!!subToken})`)
      }
    } else {
      // Release from Telnyx
      const telnyxOrderId = num.telnyxOrderId || num
      if (telnyxOrderId && typeof telnyxOrderId === 'string') {
        const ok = await telnyxApi.releaseNumber(telnyxOrderId)
        if (ok) return log(`[PhoneScheduler] Released Telnyx number by orderId: ${telnyxOrderId}`)
      }
      const ok2 = await telnyxApi.releaseByPhoneNumber(phoneNumber)
      if (ok2) return log(`[PhoneScheduler] Released Telnyx number by phone: ${phoneNumber}`)
      log(`[PhoneScheduler] Could not release Telnyx number ${phoneNumber}`)
    }
  } catch (e) {
    log(`[PhoneScheduler] Provider release error for ${phoneNumber}: ${e.message}`)
  }
}

async function attemptAutoRenew(chatId, num, index, numbers) {
  try {
    // ━━━ Pricing guard (added 2026-05-25) ━━━
    // Root-cause fix for the @johngambino incident: auto-renew used to read
    // `num.planPrice` verbatim. When an admin "restoration" or legacy import
    // left a parent number with planPrice=$15 on a Pro tier, every renewal
    // silently charged $15 instead of $75 — for months. We now compute the
    // canonical price from phoneConfig and self-heal the doc on mismatch,
    // unless the number is explicitly grandfathered.
    const storedPrice = Number(num.planPrice)
    const planTier = (num.plan || '').toLowerCase()
    const canonicalPlanPrice = phoneConfig.plans?.[planTier]?.price
    const isSub = !!num.isSubNumber
    const isGrandfathered = num.grandfathered === true
    let price = storedPrice

    if (isSub) {
      // Sub-numbers vary by Twilio cost (base $25 + 50% markup). Enforce min
      // to catch corrupt zeros / nulls.
      if (!Number.isFinite(storedPrice) || storedPrice < phoneConfig.SUB_NUMBER_BASE_PRICE) {
        const fixed = phoneConfig.SUB_NUMBER_BASE_PRICE
        _notifyGroup?.(
          `⚠️ <b>Sub-number planPrice anomaly</b>\n` +
          `👤 chat=<code>${chatId}</code>\n` +
          `📞 ${maskPhone(num.phoneNumber)}\n` +
          `💰 stored=$${storedPrice} → using min $${fixed} for renewal\n` +
          `<i>Verify the parent provisioning. Auto-renew continues.</i>`,
          `⚠️ <b>Sub-number planPrice anomaly</b>\n` +
          `👤 chat=<code>${chatId}</code>\n` +
          `📞 ${num.phoneNumber}\n` +
          `💰 stored=$${storedPrice} → using min $${fixed} for renewal\n` +
          `<i>Verify the parent provisioning. Auto-renew continues.</i>`
        )
        price = fixed
      }
    } else if (Number.isFinite(canonicalPlanPrice) && storedPrice !== canonicalPlanPrice && !isGrandfathered) {
      // Parent number with mismatched price — alert + self-heal + charge canonical
      const name = await get(_nameOf, chatId).catch(() => null)
      _notifyGroup?.(
        `🚨 <b>PlanPrice MISMATCH — corrected at renewal</b>\n` +
        `👤 ${_maskName?.(name) || ''} <code>${chatId}</code>\n` +
        `📞 ${maskPhone(num.phoneNumber)} · plan=<b>${planTier}</b>\n` +
        `💰 stored=$${storedPrice} → charged canonical <b>$${canonicalPlanPrice}</b>\n` +
        `<i>phoneNumbersOf.planPrice has been self-healed. If this was an intentional grandfather, set <code>grandfathered:true</code> on the number doc.</i>`,
        `🚨 <b>PlanPrice MISMATCH — corrected at renewal</b>\n` +
        `👤 ${_maskName?.(name) || ''} <code>${chatId}</code>\n` +
        `📞 ${num.phoneNumber} · plan=<b>${planTier}</b>\n` +
        `💰 stored=$${storedPrice} → charged canonical <b>$${canonicalPlanPrice}</b>\n` +
        `<i>phoneNumbersOf.planPrice has been self-healed. If this was an intentional grandfather, set <code>grandfathered:true</code> on the number doc.</i>`
      )
      try {
        await _phoneNumbersOf.updateOne(
          { _id: chatId, 'val.numbers.phoneNumber': num.phoneNumber },
          { $set: {
            'val.numbers.$.planPrice': canonicalPlanPrice,
            'val.numbers.$._priceHealedAt': new Date().toISOString(),
            'val.numbers.$._priceHealedFrom': storedPrice,
          } }
        )
        log(`[PhoneScheduler] Self-healed planPrice for ${chatId}/${num.phoneNumber}: $${storedPrice} → $${canonicalPlanPrice}`)
      } catch (healErr) {
        log(`[PhoneScheduler] planPrice self-heal failed for ${num.phoneNumber}: ${healErr.message}`)
      }
      price = canonicalPlanPrice
      num.planPrice = canonicalPlanPrice
    } else if (!Number.isFinite(storedPrice) || storedPrice <= 0) {
      // No canonical match and stored is broken — alert and abort
      _notifyGroup?.(
        `🚨 <b>Auto-renew ABORTED — invalid planPrice</b>\n` +
        `👤 chat=<code>${chatId}</code>\n` +
        `📞 ${maskPhone(num.phoneNumber)} · plan=<b>${planTier}</b>\n` +
        `💰 stored=<code>${storedPrice}</code> · canonical=<code>${canonicalPlanPrice}</code>\n` +
        `<i>Renewal blocked. Manual admin action required.</i>`,
        `🚨 <b>Auto-renew ABORTED — invalid planPrice</b>\n` +
        `👤 chat=<code>${chatId}</code>\n` +
        `📞 ${num.phoneNumber} · plan=<b>${planTier}</b>\n` +
        `💰 stored=<code>${storedPrice}</code> · canonical=<code>${canonicalPlanPrice}</code>\n` +
        `<i>Renewal blocked. Manual admin action required.</i>`
      )
      log(`[PhoneScheduler] Auto-renew aborted for ${num.phoneNumber}: invalid planPrice=${storedPrice} plan=${planTier}`)
      return { outcome: 'invalid_price', storedPrice, canonical: canonicalPlanPrice }
    }
    // (else: storedPrice matches canonical or grandfathered — use stored)

    // ━━━ LAYER 1: Fresh-read idempotency guard ━━━
    // Re-read from DB to catch renewals completed by another pod (Railway vs preview)
    const freshDoc = await _phoneNumbersOf.findOne({ _id: chatId })
    const freshNum = freshDoc?.val?.numbers?.find(n => n.phoneNumber === num.phoneNumber)
    if (!freshNum) {
      log(`[PhoneScheduler] Skipped ${num.phoneNumber} — number no longer exists in DB`)
      return { outcome: 'not_found' }
    }
    if (new Date(freshNum.expiresAt) > new Date()) {
      log(`[PhoneScheduler] Skipped ${num.phoneNumber} — already renewed by another process (expires ${freshNum.expiresAt})`)
      return { outcome: 'already_renewed_elsewhere', expiresAt: freshNum.expiresAt }
    }

    const result = await smartWalletDeduct(_walletOf, chatId, price)

    if (!result.success) {
      log(`[PhoneScheduler] Auto-renew failed for ${num.phoneNumber}: insufficient funds (USD: $${(result.usdBal || 0).toFixed(2)}, needed: $${price})`)
      return { outcome: 'insufficient_funds', usdBal: result.usdBal || 0, needed: price }
    }

    // Wallet charged — extend expiry
    const newExpiry = new Date(num.expiresAt)
    newExpiry.setMonth(newExpiry.getMonth() + 1)

    // ━━━ LAYER 2: Atomic claim — only extend if expiresAt is still the old value ━━━
    // Prevents double-charge when two pods both pass Layer 1 within milliseconds
    // NOTE: `includeResultMetadata: false` is required — without it the mongo v5
    // driver returns a wrapper that is always truthy on no-match, so the
    // "DUPLICATE RENEWAL PREVENTED" branch never fired. See utils.js:smartWalletDeduct
    // for the root-cause writeup (2026-05-30).
    const claimResult = await _phoneNumbersOf.findOneAndUpdate(
      {
        _id: chatId,
        'val.numbers': {
          $elemMatch: {
            phoneNumber: num.phoneNumber,
            expiresAt: num.expiresAt  // must still be the old (expired) value
          }
        }
      },
      {
        $set: {
          'val.numbers.$.expiresAt': newExpiry.toISOString(),
          'val.numbers.$.status': 'active',
          'val.numbers.$.smsUsed': 0,
          'val.numbers.$.minutesUsed': 0,
          'val.numbers.$._reminder3Sent': false,
          'val.numbers.$._reminder1Sent': false,
          'val.numbers.$._graceUntil': null,
        }
      },
      { returnDocument: 'after', includeResultMetadata: false }
    )

    if (!claimResult) {
      log(`[PhoneScheduler] ⚠️ DUPLICATE RENEWAL PREVENTED: ${num.phoneNumber} already renewed by another pod — refunding $${price} to chatId ${chatId}`)
      await _walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: -price } })
      return { outcome: 'duplicate_prevented', refunded: price }
    }

    numbers[index].expiresAt = newExpiry.toISOString()
    numbers[index].status = 'active'
    numbers[index].smsUsed = 0
    numbers[index].minutesUsed = 0
    numbers[index]._reminder3Sent = false
    numbers[index]._reminder1Sent = false
    numbers[index]._graceUntil = null

    const name = await get(_nameOf, chatId)
    const ref = _nanoid?.() || `ar_${Date.now()}`
    if (_payments) set(_payments, ref, `AutoRenew,CloudPhone,$${price},${chatId},${name},${new Date()}`)

    await _phoneTransactions?.insertOne({
      chatId,
      phoneNumber: num.phoneNumber,
      action: 'auto_renew',
      plan: num.plan,
      amount: price,
      paymentMethod: 'wallet_usd',
      timestamp: new Date().toISOString(),
    })
    if (_db) {
      await require('./transaction-id').logTransaction(_db, {
        chatId,
        type: 'cloudphone-subscription',
        amount: Number(price),
        currency: 'USD',
        status: 'completed',
        metadata: { action: 'auto_renew', phoneNumber: num.phoneNumber, plan: num.plan, paymentMethod: 'wallet_usd', newExpiry: newExpiry.toISOString() },
      })
    }

    const { usdBal: newUsd } = await getBalance(_walletOf, chatId)
    sendToUser(chatId, buildAutoRenewSuccessMsg(num, newExpiry, price, 0).replace(/\$[\d.]+\s*remaining/, `$${newUsd.toFixed(2)} remaining`))

    _notifyGroup?.(
      `✅ <b>Auto-Renewed:</b> ${_maskName?.(name)} → ${maskPhone(num.phoneNumber)} ($${price})`,
      `✅ <b>Auto-Renewed:</b> ${_maskName?.(name)} → ${formatPhone(num.phoneNumber)} ($${price})`
    )

    log(`[PhoneScheduler] Auto-renewed: ${chatId} ${num.phoneNumber} until ${newExpiry.toISOString()} — charged $${price}`)
    return { outcome: 'renewed', newExpiry: newExpiry.toISOString(), charged: price }
  } catch (e) {
    log(`[PhoneScheduler] Auto-renew error: ${e.message}`)
    return { outcome: 'error', error: e.message }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// USAGE TRACKING — Pull from Telnyx CDR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runUsageTracking() {
  try {
    if (!TELNYX_API_KEY) return log('[PhoneScheduler] No TELNYX_API_KEY, skipping usage tracking')

    const allUsers = await _phoneNumbersOf.find({}).toArray()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const startDate = yesterday.toISOString().split('T')[0] + 'T00:00:00Z'
    const endDate = yesterday.toISOString().split('T')[0] + 'T23:59:59Z'

    let totalCallsTracked = 0
    let totalSmsTracked = 0

    for (const user of allUsers) {
      const chatId = user._id
      const numbers = user.val?.numbers || []
      let modified = false

      // Resolve user language once per user for localised usage alerts.
      let userLang = 'en'
      try {
        const userState = await _stateOf?.findOne?.({ _id: String(chatId) })
        userLang = userState?.userLanguage || 'en'
      } catch (_) { /* fallback to en */ }

      for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i]
        if (num.status !== 'active') continue
        const cleanNumber = num.phoneNumber.replace(/[^+\d]/g, '')

        // ── Pull Call Events ──
        try {
          const callRes = await axios.get(`${TELNYX_BASE}/call_events`, {
            headers: telnyxHeaders(),
            params: {
              'filter[call_leg_id][exists]': true,
              'filter[type]': 'call.hangup',
              'page[size]': 100,
            }
          })
          const callEvents = callRes.data?.data || []
          // Filter for this number and count duration
          const relevantCalls = callEvents.filter(e => {
            const payload = e.payload || {}
            const to = (payload.to || '').replace(/[^+\d]/g, '')
            const from = (payload.from || '').replace(/[^+\d]/g, '')
            return to === cleanNumber || from === cleanNumber
          })

          if (relevantCalls.length > 0) {
            let totalDurationSec = 0
            for (const call of relevantCalls) {
              const dur = call.payload?.duration_secs || call.payload?.duration || 0
              totalDurationSec += dur
            }
            const totalMinutes = Math.ceil(totalDurationSec / 60)
            numbers[i].minutesUsed = (numbers[i].minutesUsed || 0) + totalMinutes
            modified = true
            totalCallsTracked += relevantCalls.length
          }
        } catch (e) {
          // Call events API may not be available for all accounts
          log(`[PhoneScheduler] Call CDR fetch error for ${cleanNumber}: ${e.response?.status || e.message}`)
        }

        // ── Pull SMS usage from our own logs (more reliable than Telnyx CDR) ──
        try {
          const smsCount = await _phoneLogs?.countDocuments({
            phoneNumber: cleanNumber,
            type: 'sms',
            timestamp: { $gte: startDate, $lte: endDate }
          }) || 0

          if (smsCount > 0) {
            numbers[i].smsUsed = (numbers[i].smsUsed || 0) + smsCount
            modified = true
            totalSmsTracked += smsCount
          }
        } catch (e) {
          log(`[PhoneScheduler] SMS log count error for ${cleanNumber}: ${e.message}`)
        }

        // ── Check usage limits & send alerts ──
        const plan = plans[num.plan]
        if (plan) {
          const smsLimit = plan.sms
          const smsUsed = numbers[i].smsUsed || 0
          const smsPercent = Math.round((smsUsed / smsLimit) * 100)

          // 80% SMS usage alert
          if (smsPercent >= 80 && smsPercent < 100 && !numbers[i]._smsAlert80) {
            sendToUser(chatId, buildUsageAlertMsg(num, 'SMS', smsUsed, smsLimit, smsPercent, userLang))
            numbers[i]._smsAlert80 = true
            modified = true
          }
          // 100% SMS usage alert
          if (smsPercent >= 100 && !numbers[i]._smsAlert100) {
            sendToUser(chatId, buildUsageLimitMsg(num, 'SMS', smsUsed, smsLimit, userLang))
            numbers[i]._smsAlert100 = true
            modified = true
          }

          // Minutes alert (skip for unlimited)
          if (plan.minutes !== 'Unlimited') {
            const minLimit = plan.minutes
            const minUsed = numbers[i].minutesUsed || 0
            const minPercent = Math.round((minUsed / minLimit) * 100)

            if (minPercent >= 80 && minPercent < 100 && !numbers[i]._minAlert80) {
              sendToUser(chatId, buildUsageAlertMsg(num, 'Minutes', minUsed, minLimit, minPercent, userLang))
              numbers[i]._minAlert80 = true
              modified = true
            }
            if (minPercent >= 100 && !numbers[i]._minAlert100) {
              sendToUser(chatId, buildUsageLimitMsg(num, 'Minutes', minUsed, minLimit, userLang))
              numbers[i]._minAlert100 = true
              modified = true
            }
          }
        }
      }

      if (modified) {
        await set(_phoneNumbersOf, chatId, { numbers })
      }
    }

    log(`[PhoneScheduler] Usage tracking complete: ${totalCallsTracked} calls, ${totalSmsTracked} SMS tracked`)
  } catch (e) {
    log(`[PhoneScheduler] Usage tracking error: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MONTHLY RESET — Reset counters on billing date
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runMonthlyReset() {
  try {
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    const today = new Date()
    const todayDay = today.getDate()
    let resetCount = 0

    for (const user of allUsers) {
      const chatId = user._id
      const numbers = user.val?.numbers || []
      let modified = false

      for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i]
        if (num.status !== 'active') continue

        // Reset on purchase anniversary day
        const purchaseDay = new Date(num.purchaseDate).getDate()
        if (todayDay === purchaseDay) {
          numbers[i].smsUsed = 0
          numbers[i].minutesUsed = 0
          numbers[i]._smsAlert80 = false
          numbers[i]._smsAlert100 = false
          numbers[i]._minAlert80 = false
          numbers[i]._minAlert100 = false
          numbers[i]._smsLimitNotified = false
          numbers[i]._minLimitNotified = false
          modified = true
          resetCount++
          log(`[PhoneScheduler] Monthly reset: ${chatId} ${num.phoneNumber}`)
        }
      }

      if (modified) {
        await set(_phoneNumbersOf, chatId, { numbers })
      }
    }

    log(`[PhoneScheduler] Monthly reset complete: ${resetCount} numbers reset`)
  } catch (e) {
    log(`[PhoneScheduler] Monthly reset error: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESSAGE BUILDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildReminderMsg(num, days, plan, balance) {
  const price = num.planPrice
  const surcharge = num.numberSurcharge || 0
  const lowBal = balance < price
  let priceText = `$${price}/mo`
  if (surcharge > 0) priceText = `$${(price - surcharge).toFixed(2)} plan + $${surcharge.toFixed(2)} number = $${price}/mo`
  return `🔔 <b>Renewal Reminder</b>

Your Cloud Phone number ${formatPhone(num.phoneNumber)} (${plan.name} Plan) expires in <b>${days} days</b> (${shortDate(num.expiresAt)}).

Auto-Renew: ${num.autoRenew ? '✅ ON' : '❌ OFF'}
Wallet Balance: $${balance.toFixed(2)}
Renewal Cost: ${priceText}${lowBal ? `

⚠️ Insufficient balance! Deposit at least $${(price - balance).toFixed(2)} to renew.
If not renewed, your number will be <b>permanently deleted</b> and cannot be recovered.` : ''}${num.autoRenew && !lowBal ? `

✅ Your number will auto-renew from your wallet.` : ''}`
}

function buildFinalWarningMsg(num, plan, balance) {
  const price = num.planPrice
  return `🚨 <b>FINAL Renewal Warning</b>

Your number ${formatPhone(num.phoneNumber)} expires <b>TOMORROW</b> (${shortDate(num.expiresAt)}).

If not renewed, your number will be:
• <b>Permanently deleted</b> from our system
• Calls, SMS forwarding & SIP will stop
• The number <b>cannot be recovered</b>

⚠️ This is irreversible — renew now to keep your number.

Wallet: $${balance.toFixed(2)} | Need: $${price}`
}

function buildGracePeriodMsg(num, shortfall, graceDeadline, lang) {
  const plan = plans[num.plan] || { name: num.plan }
  const deadlineStr = graceDeadline.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const msgs = {
    en: `⏳ <b>URGENT: Your number is about to be released</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} Plan)

Auto-renewal failed — your wallet is <b>$${shortfall.toFixed(2)} short</b>.

You have <b>24 hours</b> (until ${deadlineStr}) to deposit funds. After that, the number will be <b>permanently released</b> and cannot be recovered.

👉 Tap /start → 💰 Deposit to add funds now.

Your number stays active during this grace period — calls and SMS continue working.`,

    fr: `⏳ <b>URGENT : Votre numéro va être libéré</b>

📞 ${formatPhone(num.phoneNumber)} (Forfait ${plan.name})

Le renouvellement automatique a échoué — il manque <b>$${shortfall.toFixed(2)}</b> dans votre portefeuille.

Vous avez <b>24 heures</b> (jusqu'au ${deadlineStr}) pour déposer des fonds. Après quoi, le numéro sera <b>définitivement libéré</b>.

👉 Tapez /start → 💰 Dépôt pour recharger maintenant.`,

    zh: `⏳ <b>紧急：您的号码即将被释放</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} 套餐)

自动续费失败 — 钱包余额不足 <b>$${shortfall.toFixed(2)}</b>。

您有 <b>24小时</b>（截止 ${deadlineStr}）充值。逾期号码将被<b>永久释放</b>，无法恢复。

👉 点击 /start → 💰 充值 立即充值。`,

    hi: `⏳ <b>अर्जेंट: आपका नंबर रिलीज़ होने वाला है</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} प्लान)

ऑटो-रिन्यूअल विफल — वॉलेट में <b>$${shortfall.toFixed(2)}</b> कम है।

फंड जमा करने के लिए <b>24 घंटे</b> (${deadlineStr} तक) हैं। उसके बाद नंबर <b>स्थायी रूप से रिलीज़</b> हो जाएगा।

👉 /start → 💰 जमा करें पर टैप करें।`,
  }
  return msgs[lang] || msgs.en
}


function buildAutoRenewSuccessMsg(num, newExpiry, oldBal, newBal) {
  const plan = plans[num.plan] || { name: num.plan }
  const surcharge = num.numberSurcharge || 0
  let chargeText = `$${num.planPrice}`
  if (surcharge > 0) chargeText = `$${num.planPrice} ($${(num.planPrice - surcharge).toFixed(2)} plan + $${surcharge.toFixed(2)} number)`
  return `✅ <b>Auto-Renewal Successful</b>

📞 ${formatPhone(num.phoneNumber)}
📦 Plan: ${plan.name}
💰 Charged: ${chargeText} from wallet
📅 New expiry: ${shortDate(newExpiry.toISOString())}

Wallet: $${oldBal.toFixed(2)} → $${newBal.toFixed(2)}`
}

function buildAutoRenewFailedMsg(num, lang) {
  const plan = plans[num.plan] || { name: num.plan }
  const buyLabel = phoneConfig.getBtnLabel('buyPhoneNumber', lang || 'en')
  return translation('t.phoneAutoRenewFailedTitle', lang || 'en')
    + '\n\n'
    + translation('t.phoneAutoRenewFailedBody', lang || 'en',
      formatPhone(num.phoneNumber),
      plan.name,
      num.planPrice,
      buyLabel)
}

function buildSuspendedMsg(num, lang) {
  const buyLabel = phoneConfig.getBtnLabel('buyPhoneNumber', lang || 'en')
  return translation('t.phoneSuspendedTitle', lang || 'en')
    + '\n\n'
    + translation('t.phoneSuspendedBody', lang || 'en',
      formatPhone(num.phoneNumber),
      buyLabel)
}

function buildUsageAlertMsg(num, type, used, limit, percent, lang) {
  const rate = type === 'SMS' ? OVERAGE_RATE_SMS : OVERAGE_RATE_MIN
  const unit = type === 'SMS' ? 'SMS' : 'min'
  return translation('t.phoneUsageAlertTitle', lang || 'en')
    + '\n\n'
    + translation('t.phoneUsageAlertBody', lang || 'en',
      formatPhone(num.phoneNumber),
      used,
      limit,
      type,
      percent,
      rate,
      unit)
}

function buildUsageLimitMsg(num, type, used, limit, lang) {
  const rate = type === 'SMS' ? OVERAGE_RATE_SMS : OVERAGE_RATE_MIN
  const unit = type === 'SMS' ? 'SMS' : 'min'
  return translation('t.phoneUsageLimitTitle', lang || 'en', type)
    + '\n\n'
    + translation('t.phoneUsageLimitBody', lang || 'en',
      formatPhone(num.phoneNumber),
      type,
      limit,
      rate,
      unit)
}

function sendToUser(chatId, text) {
  _bot?.sendMessage(chatId, text, { parse_mode: 'HTML' })?.catch(e => {
    log(`[PhoneScheduler] Send error to ${chatId}: ${e.message}`)
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICING RECONCILER — daily integrity check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Walks every active phoneNumbersOf entry and verifies that the stored
// planPrice matches the canonical price for the stored plan tier. Any
// drift is reported to the admin group as a single digest message.
//
// Recognised exceptions:
//   - isSubNumber:true      → variable pricing (≥ SUB_NUMBER_BASE_PRICE)
//   - grandfathered:true    → explicit admin opt-out (e.g. comped customer)
//
// Output: one notifyGroup() digest per run, with up to 30 anomalies inline
// and a count of any overflow. Runs daily at 0:30 UTC.
async function runPricingReconciler() {
  try {
    if (!_phoneNumbersOf?.find) return
    const all = await _phoneNumbersOf.find({}).toArray()
    const anomalies = []
    let scanned = 0
    for (const doc of all) {
      const chatId = doc._id
      const nums = doc?.val?.numbers || []
      for (const n of nums) {
        if (!n || typeof n !== 'object') continue
        if (n.status && n.status !== 'active' && n.status !== 'suspended') continue
        scanned++
        const planTier = (n.plan || '').toLowerCase()
        const stored = Number(n.planPrice)
        const canonical = phoneConfig.plans?.[planTier]?.price
        const isSub = !!n.isSubNumber
        const grandfathered = n.grandfathered === true
        if (grandfathered) continue
        if (isSub) {
          if (!Number.isFinite(stored) || stored < phoneConfig.SUB_NUMBER_BASE_PRICE) {
            anomalies.push({ chatId, phone: n.phoneNumber, plan: planTier, isSub, stored, canonical: phoneConfig.SUB_NUMBER_BASE_PRICE, reason: 'sub below floor' })
          }
        } else if (Number.isFinite(canonical) && stored !== canonical) {
          anomalies.push({ chatId, phone: n.phoneNumber, plan: planTier, isSub, stored, canonical, reason: 'parent price mismatch' })
        } else if (!Number.isFinite(stored) || stored <= 0) {
          anomalies.push({ chatId, phone: n.phoneNumber, plan: planTier, isSub, stored, canonical, reason: 'invalid stored price' })
        }
      }
    }
    log(`[PhoneScheduler] Pricing reconciler scanned=${scanned} anomalies=${anomalies.length}`)
    if (anomalies.length === 0) {
      // Quiet success — only ping admin when there's something to see.
      return
    }
    const lines = anomalies.slice(0, 30).map(a =>
      `• <code>${a.chatId}</code> ${a.phone} · ${a.plan}${a.isSub ? ' (sub)' : ''} · stored=$${a.stored} → canonical=$${a.canonical} <i>(${a.reason})</i>`
    )
    const overflow = anomalies.length > 30 ? `\n…and ${anomalies.length - 30} more` : ''
    _notifyGroup?.(
      `🧾 <b>Daily pricing reconciler</b>\n` +
      `Scanned: <b>${scanned}</b> active number(s)\n` +
      `Anomalies: <b>${anomalies.length}</b>\n\n` +
      lines.join('\n') + overflow + `\n\n` +
      `<i>Numbers above will be self-healed at next auto-renew (canonical price charged + alert). To grandfather a customer at a custom price, set <code>grandfathered:true</code> on the number doc.</i>`
    )
  } catch (e) {
    log(`[PhoneScheduler] runPricingReconciler error: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INACTIVE-RELEASED CLEANUP — remove numbers 48h after provider release
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Numbers marked `inactive_released` by phone-monitor (detected gone from
// the provider) get a 48-hour grace window for support intervention.
// After that, this job removes the number from the user's array, logs
// a phoneTransaction, and sends a final notification.

async function runInactiveReleasedCleanup() {
  try {
    if (!_phoneNumbersOf?.find) return
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    const GRACE_MS = 48 * 60 * 60 * 1000 // 48 hours
    const now = Date.now()
    let removed = 0
    let skipped = 0

    for (const user of allUsers) {
      const chatId = user._id
      const numbers = user.val?.numbers || []
      const toRemove = []

      for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i]
        if (num.status !== 'inactive_released') continue

        const inactiveSince = num._inactiveSince ? new Date(num._inactiveSince).getTime() : 0
        if (!inactiveSince) { skipped++; continue }

        const elapsed = now - inactiveSince
        if (elapsed < GRACE_MS) {
          skipped++
          continue
        }

        // Past 48-hour grace — schedule for removal
        toRemove.push({ index: i, num })
      }

      if (toRemove.length === 0) continue

      // Remove from array (iterate in reverse to keep indices stable)
      const updatedNumbers = numbers.filter((n, idx) =>
        !toRemove.some(r => r.index === idx)
      )

      await _phoneNumbersOf.updateOne(
        { _id: chatId },
        { $set: { 'val.numbers': updatedNumbers } }
      )

      for (const { num } of toRemove) {
        removed++

        // Log the transaction
        await _phoneTransactions?.insertOne({
          chatId,
          phoneNumber: num.phoneNumber,
          action: 'inactive_released_cleanup',
          plan: num.plan,
          amount: 0,
          timestamp: new Date().toISOString(),
          _inactiveSince: num._inactiveSince,
        })

        // Resolve user language
        let userLang = 'en'
        try {
          const userState = await _stateOf?.findOne?.({ _id: String(chatId) })
          userLang = userState?.userLanguage || 'en'
        } catch (_) { /* fallback */ }

        // Notify user — final removal message
        const userMsgs = {
          en: `🗑️ <b>Number Removed</b>\n\n📞 ${formatPhone(num.phoneNumber)} has been removed from your account after being inactive for 48+ hours.\n\nThis number was released by the provider and could no longer make or receive calls.\n\nYou can purchase a new number anytime from the Cloud IVR menu.`,
          fr: `🗑️ <b>Numéro Supprimé</b>\n\n📞 ${formatPhone(num.phoneNumber)} a été supprimé de votre compte après 48h+ d'inactivité.\n\nCe numéro a été libéré par le fournisseur.\n\nVous pouvez acheter un nouveau numéro depuis le menu Cloud IVR.`,
          zh: `🗑️ <b>号码已移除</b>\n\n📞 ${formatPhone(num.phoneNumber)} 在不活跃超过48小时后已从您的账户中移除。\n\n此号码已被运营商释放。\n\n您可以随时从 Cloud IVR 菜单购买新号码。`,
          hi: `🗑️ <b>नंबर हटाया गया</b>\n\n📞 ${formatPhone(num.phoneNumber)} 48+ घंटे निष्क्रिय रहने के बाद आपके खाते से हटा दिया गया है।\n\nयह नंबर प्रदाता द्वारा जारी किया गया था।\n\nआप Cloud IVR मेनू से कभी भी नया नंबर खरीद सकते हैं।`,
        }
        sendToUser(chatId, userMsgs[userLang] || userMsgs.en)

        // Notify admin
        const name = await get(_nameOf, chatId).catch(() => null)
        _notifyGroup?.(
          `🗑️ <b>Inactive number auto-removed:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${maskPhone(num.phoneNumber)} — was inactive_released since ${num._inactiveSince}`,
          `🗑️ <b>Inactive number auto-removed:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} — was inactive_released since ${num._inactiveSince}`
        )

        log(`[PhoneScheduler] Auto-removed inactive_released number: ${chatId} ${num.phoneNumber} (inactive since ${num._inactiveSince})`)
      }
    }

    log(`[PhoneScheduler] Inactive-released cleanup complete: ${removed} removed, ${skipped} still in grace period`)
  } catch (e) {
    log(`[PhoneScheduler] runInactiveReleasedCleanup error: ${e.message}`)
  }
}

module.exports = {
  initPhoneScheduler,
  runExpiryCheck,
  runUsageTracking,
  runMonthlyReset,
  runPricingReconciler,
  runInactiveReleasedCleanup,
  attemptAutoRenew,
}
