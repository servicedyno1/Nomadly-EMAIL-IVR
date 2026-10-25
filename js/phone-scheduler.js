// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cloud Phone Scheduler — Expiry, Renewal & Usage Tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const schedule = require('node-schedule')
const { log } = require('console')
const { get, set, atomicIncrement } = require('./db.js')
const { getBalance, smartWalletDeduct } = require('./utils.js')
const { formatPhone, maskPhone, shortDate, plans, OVERAGE_RATE_SMS, OVERAGE_RATE_MIN } = require('./phone-config.js')
const phoneConfig = require('./phone-config.js')
const telnyxApi = require('./telnyx-service.js')
const twilioService = require('./twilio-service.js')
const { translation } = require('./translation.js')
const lifecycle = require('./plan-lifecycle.js')

let _bot = null
let _phoneNumbersOf = null
let _phoneTransactions = null
let _phoneLogs = null
let _walletOf = null
let _payments = null
let _nameOf = null
let _stateOf = null
let _notifyGroup = null
let _notifyAdmin = null
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
  // Internal alerts (pricing, safety, ops) go to the admin chat only — never to groups.
  _notifyAdmin = deps.notifyAdmin || null
  _maskName = deps.maskName
  _nanoid = deps.nanoid

  // Dev-pod safety switch (same as hosting / VPS): these jobs charge wallets and release real numbers.
  const live = () => process.env.SKIP_WEBHOOK_SYNC !== 'true'

  // ── Hourly: Check expiry, send reminders, auto-renew, then start new usage cycles ──
  schedule.scheduleJob('0 * * * *', async () => {
    if (!live()) return
    log('[PhoneScheduler] Running hourly expiry check...')
    await runExpiryCheck()
    await runMonthlyReset()
  })

  // ── Daily at 3:00 AM UTC: 80% / 100% usage alerts (usage itself is counted live per call / SMS) ──
  schedule.scheduleJob('0 3 * * *', async () => {
    if (!live()) return
    log('[PhoneScheduler] Running daily usage alerts...')
    await runUsageTracking()
  })

  // ── Daily at 0:30 AM UTC: Pricing reconciliation ──
  // Scans phoneNumbersOf for plan/price drift (mismatched planPrice for the
  // stored plan tier) and pings admin. Catches Apr-30-style audit-trail
  // holes and silent grandfathered prices within 24h instead of weeks.
  schedule.scheduleJob('30 0 * * *', async () => {
    if (!live()) return
    log('[PhoneScheduler] Running daily pricing reconciliation...')
    await runPricingReconciler()
  })

  // ── Every 6 hours: Remove numbers inactive_released for >48h ──
  // Numbers silently released by the provider (detected by phone-monitor)
  // get a 48h grace window. After that, this job cleans them up.
  schedule.scheduleJob('0 */6 * * *', async () => {
    if (!live()) return
    log('[PhoneScheduler] Running inactive-released cleanup...')
    await runInactiveReleasedCleanup()
  })

  log(`[PhoneScheduler] Scheduled: expiry check + usage-cycle reset (hourly), usage alerts (daily 3AM), pricing reconciler (daily 0:30AM), inactive-released cleanup (every 6h)${live() ? '' : ' — PAUSED on this pod (SKIP_WEBHOOK_SYNC=true)'}`)
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

// Write back only the fields this run changed, number by number — never the whole val (a stale copy undid
// concurrent edits and wiped the saved Twilio sub-account login / addresses).
async function persistChanges(chatId, before, numbers) {
  const patches = []
  for (const n of numbers) {
    const old = before.find(b => b.phoneNumber === n.phoneNumber && b.status !== 'released')
    if (!old) continue
    const set = {}
    for (const k of new Set([...Object.keys(old), ...Object.keys(n)])) {
      if (JSON.stringify(n[k]) !== JSON.stringify(old[k])) set[k] = n[k] === undefined ? null : n[k]
    }
    if (Object.keys(set).length) patches.push({ phoneNumber: n.phoneNumber, set })
  }
  if (patches.length) await lifecycle.applyDb(_phoneNumbersOf, chatId, patches)
}

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
      const before = JSON.parse(JSON.stringify(numbers))
      let modified = false

      for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i]
        if (num.status !== 'active' && num.status !== 'suspended') continue
        // Internal test lines (e.g. the live-call test number) never expire on their own.
        if (lifecycle.isInternalTest(num)) continue

        // ── Twilio paused (TWILIO_ENABLED=false — account suspended) ──
        // Dead Twilio numbers are HELD for migration to Telnyx: no renewal
        // reminders, no auto-renew wallet charge, no release. The plan keeps its
        // expiresAt; the migration tool moves it to a Telnyx number with the same
        // expiry. Flip TWILIO_ENABLED back to true and normal processing resumes.
        if (num.provider === 'twilio' && !phoneConfig.isTwilioEnabled()) {
          heldForMigration++
          continue
        }

        // ── Suspended plan on hold: no reminders or renewals; released for good once the hold ends ──
        if (lifecycle.onHold(num)) {
          if (lifecycle.holdOver(num, now)) {
            await releaseFromProvider(num, user.val, chatId)
            lifecycle.applyLocal(numbers, [lifecycle.releasePatch(num)])
            modified = true
            suspended++
            sendToUser(chatId, lifecycle.releasedAfterHoldMsg(num, await _getUserLang(chatId)))
            const name = await get(_nameOf, chatId).catch(() => null)
            _notifyGroup?.(
              `📤 <b>Released after ${lifecycle.HOLD_DAYS}-day hold:</b> ${_maskName?.(name) || ''} lost ${maskPhone(num.phoneNumber)}`,
              `📤 <b>Released after ${lifecycle.HOLD_DAYS}-day hold:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> lost ${formatPhone(num.phoneNumber)}`
            )
            log(`[PhoneScheduler] Hold ended, released: ${chatId} ${num.phoneNumber}`)
          }
          continue
        }

        // ── Line lost its main line → suspended; restorable as a main line at the plan price ──
        if (lifecycle.isOrphan(numbers, num)) {
          const fromPrice = num.planPrice
          lifecycle.applyLocal(numbers, lifecycle.orphanToMain(num, now))
          modified = true
          suspended++
          const price = lifecycle.renewalPrice(num)
          sendToUser(chatId, lifecycle.orphanSuspendedMsg(num, price, await _getUserLang(chatId)))
          const name = await get(_nameOf, chatId).catch(() => null)
          _notifyGroup?.(
            `⏸️ <b>Main line ended — extra line suspended:</b> ${_maskName?.(name) || ''} ${maskPhone(num.phoneNumber)}. Restores as a main line for $${price}.`,
            `⏸️ <b>Main line ended — extra line suspended:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} (was extra of ${formatPhone(num.formerSubNumberOf || '')}, $${fromPrice}). Restores as a ${num.plan} main line for $${price}; hold until ${num._holdUntil.slice(0, 16)} UTC.`
          )
          log(`[PhoneScheduler] Orphan extra line suspended: ${chatId} ${num.phoneNumber} ($${fromPrice} → restore $${price})`)
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
                _notifyAdmin?.(
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
                  _notifyAdmin?.(
                    `⏳ <b>Grace Period Started:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} — insufficient funds ($${(result.usdBal || 0).toFixed(2)} / $${result.needed || num.planPrice} needed). 24h grace until ${graceDeadline.toISOString().slice(0, 16)} UTC.`
                  )
                  log(`[PhoneScheduler] Grace period started for ${num.phoneNumber}: deposit $${shortfall.toFixed(2)} by ${graceDeadline.toISOString()}`)
                } else if (!graceExpired) {
                  // ── Still within grace period — skip, wait for next check ──
                  log(`[PhoneScheduler] ${num.phoneNumber} still in grace period (until ${graceUntil.toISOString()}), skipping release`)
                } else if (!num.isSubNumber) {
                  // ── Grace period expired — main line + extras suspended and held ──
                  await suspendMainLine(chatId, numbers, num, 'grace ended, insufficient balance')
                  modified = true
                  suspended++
                } else {
                  // ── Grace period expired (extra line) — release from provider ──
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
              _notifyAdmin?.(
                `⚠️ <b>Auto-Renew Deferred (no release):</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)} — outcome=<code>${outcome}</code>. Number kept active for manual review.`
              )
              log(`[PhoneScheduler] Auto-renew deferred for ${num.phoneNumber}: outcome=${outcome} — number NOT released`)
            }
          } else if (!num.isSubNumber) {
            // No auto-renew — main line + extras suspended and held for a restore
            await suspendMainLine(chatId, numbers, num, 'no auto-renew')
            modified = true
            suspended++
          } else {
            // No auto-renew (extra line) — release from provider immediately
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

      if (modified) await persistChanges(chatId, before, numbers)
    }

    log(`[PhoneScheduler] Expiry check complete: ${remindersSent} reminders, ${autoRenewed} auto-renewed, ${suspended} suspended/released${heldForMigration ? `, ${heldForMigration} Twilio held for migration (TWILIO_ENABLED=false)` : ''}`)
  } catch (e) {
    log(`[PhoneScheduler] Expiry check error: ${e.message}`)
  }
}

// Main line's plan ended → suspend it with its extra lines (held HOLD_DAYS) and tell the owner how to restore.
async function suspendMainLine(chatId, numbers, num, why) {
  const patches = lifecycle.suspendPlan(numbers, num)
  lifecycle.applyLocal(numbers, patches)
  const extras = patches.slice(1).map(p => numbers.find(x => x.phoneNumber === p.phoneNumber))
  const price = lifecycle.renewalPrice(num)
  sendToUser(chatId, lifecycle.planSuspendedMsg(num, extras, price, await _getUserLang(chatId)))
  const name = await get(_nameOf, chatId).catch(() => null)
  const more = extras.length ? ` (+${extras.length} extra line${extras.length > 1 ? 's' : ''})` : ''
  _notifyGroup?.(
    `⏸️ <b>Plan expired — suspended:</b> ${_maskName?.(name) || ''} ${maskPhone(num.phoneNumber)}${more} · ${why}. ${lifecycle.HOLD_DAYS}-day hold to restore.`,
    `⏸️ <b>Plan expired — suspended:</b> ${_maskName?.(name) || ''} <code>${chatId}</code> ${formatPhone(num.phoneNumber)}${extras.length ? ` + ${extras.map(e => formatPhone(e.phoneNumber)).join(', ')}` : ''} · ${why}. Hold until ${num._holdUntil.slice(0, 16)} UTC, restore $${price}.`
  )
  log(`[PhoneScheduler] Plan expired, suspended (${why}): ${chatId} ${num.phoneNumber}${extras.length ? ` + ${extras.length} extra` : ''}`)
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
            _notifyAdmin?.(`🔑 <b>Twilio sub-token rotated</b> for <code>${chatId}</code> sub <code>${subSid}</code> — auto-refreshed in DB on release path.`)
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
    const canonicalPlanPrice = lifecycle.canonicalPrice(num) ?? undefined
    const isSub = !!num.isSubNumber
    const isGrandfathered = num.grandfathered === true
    let price = storedPrice

    if (isSub) {
      // Sub-numbers vary by Twilio cost (base $25 + 50% markup). Enforce min
      // to catch corrupt zeros / nulls.
      if (!Number.isFinite(storedPrice) || storedPrice < phoneConfig.SUB_NUMBER_BASE_PRICE) {
        const fixed = phoneConfig.SUB_NUMBER_BASE_PRICE
        _notifyAdmin?.(
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
      _notifyAdmin?.(
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
      _notifyAdmin?.(
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

    // Wallet charged — extend expiry one month from the old expiry; if that is still in the past (number held for
    // months, e.g. Twilio paused), from now — otherwise every hourly run would charge again until it caught up.
    const newExpiry = new Date(num.expiresAt)
    newExpiry.setMonth(newExpiry.getMonth() + 1)
    if (!(newExpiry > new Date())) { newExpiry.setTime(Date.now()); newExpiry.setMonth(newExpiry.getMonth() + 1) }

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
  // Usage is counted live (every call minute and SMS, see voice-service / sms-service); this job only sends the
  // 80% / 100% alerts on each main line's SHARED allowance (main line + extra lines). It used to re-add yesterday's
  // SMS and the last 100 Telnyx calls on top of the live count, so customers hit their limit at about half.
  try {
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    let alerts = 0
    for (const user of allUsers) {
      const chatId = user._id
      const numbers = user.val?.numbers || []
      let userLang = null
      for (const num of numbers) {
        if (num.status !== 'active' || num.isSubNumber || lifecycle.isInternalTest(num)) continue
        const u = lifecycle.poolUsage(numbers, num)
        const flags = {}
        const check = (type, used, limit, k80, k100) => {
          if (!(limit > 0) || limit === Infinity) return
          const percent = Math.round((used / limit) * 100)
          if (percent >= 100 && !num[k100]) flags[k100] = { type, used, limit, percent, full: true }
          else if (percent >= 80 && percent < 100 && !num[k80]) flags[k80] = { type, used, limit, percent, full: false }
        }
        check('SMS', u.smsUsed, u.smsLimit, '_smsAlert80', '_smsAlert100')
        check('Minutes', u.minutesUsed, u.minuteLimit, '_minAlert80', '_minAlert100')
        if (!Object.keys(flags).length) continue
        userLang = userLang || await _getUserLang(chatId)
        for (const a of Object.values(flags)) {
          sendToUser(chatId, a.full ? buildUsageLimitMsg(num, a.type, a.used, a.limit, userLang) : buildUsageAlertMsg(num, a.type, a.used, a.limit, a.percent, userLang))
          alerts++
        }
        await lifecycle.applyDb(_phoneNumbersOf, chatId, [{ phoneNumber: num.phoneNumber, set: Object.fromEntries(Object.keys(flags).map(k => [k, true])) }])
      }
    }
    log(`[PhoneScheduler] Usage alerts complete: ${alerts} sent`)
  } catch (e) {
    log(`[PhoneScheduler] Usage tracking error: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// USAGE CYCLE RESET — one reset per paid month of each main line
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runMonthlyReset() {
  // A main line's usage cycle is the month that ends at its expiresAt. When a new cycle starts (renewal), the
  // shared counters and alert flags of the main line AND its extra lines reset together — no more skipped months
  // for numbers bought on the 29th–31st, and no second reset when the renewal day drifted.
  try {
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    const now = new Date()
    let resetCount = 0
    for (const user of allUsers) {
      const numbers = user.val?.numbers || []
      for (const num of numbers) {
        const patches = lifecycle.usageResetPatches(numbers, num, now)
        if (!patches.length) continue
        await lifecycle.applyDb(_phoneNumbersOf, user._id, patches)
        if ('smsUsed' in patches[0].set) {
          resetCount++
          log(`[PhoneScheduler] Usage cycle reset: ${user._id} ${num.phoneNumber}${patches.length > 1 ? ` (+${patches.length - 1} extra)` : ''}`)
        }
      }
    }
    if (resetCount) log(`[PhoneScheduler] Usage cycle reset complete: ${resetCount} plans reset`)
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
${num.isSubNumber ? 'If not renewed, your number will be <b>permanently deleted</b> and cannot be recovered.' : `If not renewed, this number and its extra lines will be <b>suspended</b>. You'll then have ${lifecycle.HOLD_DAYS} days to restore them before they are released for good.`}` : ''}${num.autoRenew && !lowBal ? `

✅ Your number will auto-renew from your wallet.` : ''}`
}

function buildFinalWarningMsg(num, plan, balance) {
  const price = num.planPrice
  if (!num.isSubNumber) return `🚨 <b>FINAL Renewal Warning</b>

Your number ${formatPhone(num.phoneNumber)} expires <b>TOMORROW</b> (${shortDate(num.expiresAt)}).

If not renewed:
• The number and all its extra lines are <b>suspended</b>
• Calls, SMS forwarding & SIP stop
• After ${lifecycle.HOLD_DAYS} days without a restore, they are <b>released for good</b>

Wallet: $${balance.toFixed(2)} | Need: $${price}`
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
  const H = lifecycle.HOLD_DAYS
  // Main lines are suspended (with their extra lines) and held for a restore; extra lines are released.
  const after = num.isSubNumber ? {
    en: 'After that, the number will be <b>permanently released</b> and cannot be recovered.',
    fr: 'Après quoi, le numéro sera <b>définitivement libéré</b>.',
    zh: '逾期号码将被<b>永久释放</b>，无法恢复。',
    hi: 'उसके बाद नंबर <b>स्थायी रूप से रिलीज़</b> हो जाएगा।',
  } : {
    en: `After that, the number and its extra lines are <b>suspended</b>, and released for good if not restored within ${H} days.`,
    fr: `Après quoi, le numéro et ses lignes supplémentaires sont <b>suspendus</b>, puis libérés définitivement s'ils ne sont pas rétablis sous ${H} jours.`,
    zh: `逾期号码及其附加号码将被<b>暂停</b>，${H} 天内未恢复将被永久释放。`,
    hi: `उसके बाद नंबर और उसकी अतिरिक्त लाइनें <b>निलंबित</b> होंगी, और ${H} दिनों में बहाल न होने पर स्थायी रूप से रिलीज़ होंगी।`,
  }
  const msgs = {
    en: `⏳ <b>URGENT: Your number is about to be ${num.isSubNumber ? 'released' : 'suspended'}</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} Plan)

Auto-renewal failed — your wallet is <b>$${shortfall.toFixed(2)} short</b>.

You have <b>24 hours</b> (until ${deadlineStr}) to deposit funds. ${after.en}

👉 Tap /start → 💰 Deposit to add funds now.

Your number stays active during this grace period — calls and SMS continue working.`,

    fr: `⏳ <b>URGENT : Votre numéro va être ${num.isSubNumber ? 'libéré' : 'suspendu'}</b>

📞 ${formatPhone(num.phoneNumber)} (Forfait ${plan.name})

Le renouvellement automatique a échoué — il manque <b>$${shortfall.toFixed(2)}</b> dans votre portefeuille.

Vous avez <b>24 heures</b> (jusqu'au ${deadlineStr}) pour déposer des fonds. ${after.fr}

👉 Tapez /start → 💰 Dépôt pour recharger maintenant.`,

    zh: `⏳ <b>紧急：您的号码即将被${num.isSubNumber ? '释放' : '暂停'}</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} 套餐)

自动续费失败 — 钱包余额不足 <b>$${shortfall.toFixed(2)}</b>。

您有 <b>24小时</b>（截止 ${deadlineStr}）充值。${after.zh}

👉 点击 /start → 💰 充值 立即充值。`,

    hi: `⏳ <b>अर्जेंट: आपका नंबर ${num.isSubNumber ? 'रिलीज़' : 'निलंबित'} होने वाला है</b>

📞 ${formatPhone(num.phoneNumber)} (${plan.name} प्लान)

ऑटो-रिन्यूअल विफल — वॉलेट में <b>$${shortfall.toFixed(2)}</b> कम है।

फंड जमा करने के लिए <b>24 घंटे</b> (${deadlineStr} तक) हैं। ${after.hi}

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
// drift is reported to the admin chat only (never groups) as a single digest message.
//
// Recognised exceptions:
//   - isSubNumber:true      → variable pricing (≥ SUB_NUMBER_BASE_PRICE)
//   - grandfathered:true    → explicit admin opt-out (e.g. comped customer)
//   - e2eTest/internalTest  → our own free live-call test lines
//
// Output: one admin digest per run, with up to 30 anomalies inline
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
        if (lifecycle.isInternalTest(n)) continue
        const planTier = (n.plan || '').toLowerCase()
        const stored = Number(n.planPrice)
        const canonical = lifecycle.canonicalPrice(n) ?? undefined
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
    // Admin chat only: this report lists full numbers and user IDs.
    _notifyAdmin?.(
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

      // Atomic $pull of just these entries — never rewrite the numbers array from a stale copy.
      await _phoneNumbersOf.updateOne(
        { _id: chatId },
        { $pull: { 'val.numbers': { $or: toRemove.map(r => ({ phoneNumber: r.num.phoneNumber, status: 'inactive_released', _inactiveSince: r.num._inactiveSince })) } } }
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
        _notifyAdmin?.(
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
