'use strict'
// VPS/RDP expiry + auto-renew scheduler (moved out of _index.js so it can run against a test database).
// Every 5 min: 1 auto-renew at T-24h · 1.1 retry failed / late renewals once the wallet covers them ·
// 1.5 Contabo pre-emptive cancel · 1.6 admin countdown · 2-DO DigitalOcean power-off → grace → delete ·
// 2 delete unpaid non-DO boxes at expiry · 3 stale RUNNING past expiry · 4 3-day reminder.
const vpsProvider = require('./vps-provider')
const rdpGrace = require('./rdp-grace-lifecycle')
const resellerWebhooks = require('./reseller-webhooks')

const RENEW_LOCK_MS = 10 * 60 * 1000
const VPS_GRACE_DAYS = Math.max(0, Number(process.env.VPS_GRACE_DAYS || 2))
const RETRY_CANCEL_REASONS = ['wallet_deduct_failed', 'pre_emptive_no_payment']

// Renewal length = the prepaid period the customer bought (DO RDP: 1/2/3 months; everything else monthly).
const renewalMonths = (p) => Math.max(1, Number(p.durationMonths) || 1)
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x }
const inGrace = (p) => String(p.status) === 'EXPIRED_GRACE' || !!p.grace_until || !!p.expired_at
const instOf = (p) => p.contaboInstanceId || p.instanceId
const isDoRdp = (p) => rdpGrace.isDigitalOceanRdp(p)
function isDoVps(p) {
  if (isDoRdp(p)) return false
  if (String(p.provider || '').toLowerCase() === 'digitalocean') return true
  return vpsProvider.detectProviderByInstanceId(p.contaboInstanceId || p.instanceId || p.vpsId) === 'digitalocean'
}
// DO VPS + DO-RDP run the power-off → grace → destroy lifecycle (Phase 2-DO).
const isGraceManaged = (p) => isDoRdp(p) || isDoVps(p)
// DigitalOcean / Vultr / Azure bill hourly and cancelInstance destroys instantly → never cancel before end_time.
function isPAYG(p) {
  const name = vpsProvider.detectProviderByInstanceId(p.contaboInstanceId) || String(p.provider || '').toLowerCase()
  return name === 'vultr' || name === 'digitalocean' || name === 'digitalocean-rdp' || name === 'azure'
}

// Claim the current term → charge → extend. The claim (same end_time + no live lock) means two overlapping runs
// can never charge twice for one term; a renewal clears every grace/cancel flag and re-arms the next auto-renew.
async function renewFromWallet(p, price, d, now) {
  const { vpsPlansOf, walletOf, smartWalletDeduct, log } = d
  const claimed = await vpsPlansOf.findOneAndUpdate(
    { _id: p._id, end_time: p.end_time, _renewLockUntil: { $not: { $gt: now } } },
    { $set: { _renewLockUntil: new Date(now.getTime() + RENEW_LOCK_MS) } },
    { returnDocument: 'after', includeResultMetadata: false },
  )
  if (!claimed) return { outcome: 'locked' }
  const deduct = await smartWalletDeduct(walletOf, claimed.chatId, Number(price))
  if (!deduct.success) {
    await vpsPlansOf.updateOne({ _id: claimed._id }, { $unset: { _renewLockUntil: '' } })
    return { outcome: 'insufficient_funds', usdBal: deduct.usdBal || 0 }
  }
  const months = renewalMonths(claimed)
  const newEnd = addMonths(new Date(Math.max(new Date(claimed.end_time).getTime(), now.getTime())), months)
  const wasInGrace = inGrace(claimed)
  const wasEarlyCancelled = !!claimed._contaboCancelledEarly
  const set = { end_time: newEnd, status: 'RUNNING', _autoRenewAttempted: false, _reminder3DaySent: false, _reminder1DaySent: false, lastAutoRenewAt: now }
  if (Number(price) !== Number(claimed.planPrice)) set.planPrice = Number(price)
  const unset = { _renewLockUntil: '', expired_at: '', grace_until: '', _graceReminderSent: '', _adminNotifyHistory: '', deleteRetryCount: '', lastDeleteError: '', lastDeleteAlertAt: '', lastDeleteAttemptAt: '' }
  // Contabo cannot un-cancel by API: same as a manual renewal, flag it so admin taps "Resume Subscription".
  if (wasEarlyCancelled) {
    Object.assign(unset, { _contaboCancelledEarly: '', cancelReason: '', cancelledAt: '' })
    Object.assign(set, { _uncancelPending: true, _uncancelPendingSince: now })
  }
  await vpsPlansOf.updateOne({ _id: claimed._id }, { $set: set, $unset: unset })

  const inst = instOf(claimed)
  const provider = inst ? (d.providerForRecord || vpsProvider.getProviderForRecord)(claimed) : null
  if (provider) {
    // DO-RDP renewInstance also powers the box back on and clears its own grace fields.
    try { if (typeof provider.renewInstance === 'function') await provider.renewInstance(inst, months) } catch (e) { log(`[VPS Scheduler] provider renewInstance failed for ${claimed.vpsId}: ${e.message}`) }
    if (wasInGrace && isDoVps(claimed) && typeof provider.startInstance === 'function') {
      try { await provider.startInstance(inst) } catch (e) { log(`[VPS Scheduler] power-on after renewal failed for ${claimed.vpsId}: ${e.message}`) }
    }
  }
  return { outcome: 'renewed', months, newEnd, deduct, wasEarlyCancelled, wasInGrace }
}

async function runVpsExpiryCheck(d) {
  const {
    vpsPlansOf, state, walletOf, payments, nameOf, db, bot, send, translation, asKind, isRdpRecord, vpsRenewalPrice,
    deleteVPSinstance, getBalance, set, get, nanoid, adminUserTag, adminMsgOpts, adminChatId, log,
  } = d
  const providerForRecord = d.providerForRecord || vpsProvider.getProviderForRecord
  const now = d.now instanceof Date ? d.now : new Date()
  const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const displayNameOf = (p) => p.label || p.name || (isRdpRecord(p) ? 'RDP' : 'VPS')
  const langOf = async (chatId) => (await state.findOne({ _id: String(chatId) }))?.userLanguage || 'en'
  const notifyResellerVps = (p, event, reason) => {
    require('./reseller-activity').record(db, { ownerChatId: p.chatId, resourceType: p.isRDP ? 'rdp' : 'vps', resourceId: p.vpsId || p._id, action: event.endsWith('.deleted') ? 'delete' : 'suspend', actor: 'system', details: { reason: reason || null } })
    try {
      resellerWebhooks.emit(db, { chatId: p.chatId, event, instanceId: p.vpsId || p._id, payload: { plan: p.plan || null, region: p.region || null, reason: reason || null }, log }).catch(() => {})
    } catch (_) { /* best-effort */ }
  }
  // Renewal receipt to the customer + payment row (+ Contabo resume request to admin when it was cancelled early).
  async function afterRenewal(p, price, r, late) {
    const chatId = p.chatId
    const lang = await langOf(chatId)
    const displayName = displayNameOf(p)
    const chargedDisplay = r.deduct.currency === 'ngn' ? `₦${Number(r.deduct.chargedNgn).toFixed(2)} (≈ $${price})` : `$${price}`
    set(payments, nanoid(), `Wallet,VPSAutoRenew,${r.months === 1 ? 'Monthly' : `${r.months} Months`},$${price},${chatId},${new Date()},${r.deduct.currency}`)
    const { usdBal: usd } = await getBalance(walletOf, chatId)
    const msg = late
      ? translation('t.util_6', lang, displayName, chargedDisplay, r.newEnd.toLocaleDateString(), usd.toFixed(2), '0.00')
      : translation('t.util_2', lang, displayName, chargedDisplay, String(r.deduct.currency || 'usd').toUpperCase(), r.newEnd.toLocaleDateString(), usd.toFixed(2), '0.00')
    try { send(chatId, asKind(msg, isRdpRecord(p))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
    if (r.wasEarlyCancelled) {
      bot?.sendMessage(adminChatId, `🔄 <b>Contabo Resume Subscription needed</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nInstance: <code>${p.contaboInstanceId || p.vpsId}</code>\nAction: auto-renewal charged after an early cancel.\n\nPlease open my.contabo.com → Resume Subscription so the box is not removed.`, adminMsgOpts({ chatId }))?.catch?.(() => {})
    }
    log(`[VPS Scheduler] ${late ? 'Late auto-renewed' : 'Auto-renewed'} ${displayName} for ${chatId}, charged $${price} → ${r.newEnd.toISOString()}${r.wasInGrace ? ' (was in grace — restored)' : ''}`)
  }

  try {
    // ═══ Phase 1: AUTO-RENEW — 1 day before expiry (first attempt for this term) ═══
    const dueForRenewal = await vpsPlansOf.find({
      end_time: { $lte: oneDayFromNow, $gt: now },
      status: { $in: ['RUNNING', 'running'] },
      // In-place plan change (resize) running → renew on the next run, at the NEW plan price.
      'planChange.status': { $nin: ['running', 'reconciling'] },
    }).toArray()

    for (const vpsPlan of dueForRenewal) {
      const { chatId, _id, vpsId, autoRenewable } = vpsPlan
      // RDP: re-priced on live AMD stock in its city (base … +15%); everything else renews at planPrice.
      const planPrice = await vpsRenewalPrice(vpsPlan)
      const lang = await langOf(chatId)
      const displayName = displayNameOf(vpsPlan)
      const expiryDate = new Date(vpsPlan.end_time).toLocaleDateString()

      if (!autoRenewable) {
        await vpsPlansOf.updateOne({ _id }, { $set: { status: 'PENDING_CANCELLATION', _autoRenewAttempted: true } })
        try { send(chatId, asKind(translation('t.util_1', lang, displayName, expiryDate), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
        log(`[VPS Scheduler] ${displayName} marked PENDING_CANCELLATION for ${chatId} — auto-renew disabled`)
        // PAYG keeps running until end_time (grace window); DO boxes emit their own grace_start from Phase 2-DO.
        if (isPAYG(vpsPlan) && !isGraceManaged(vpsPlan)) notifyResellerVps(vpsPlan, 'vps.grace_start', 'auto_renew_disabled')
        // Contabo pre-bills the next period → cancel now (cancelDate = end_time). PAYG is destroyed in Phase 2.
        if (!vpsPlan._contaboCancelledEarly && !isPAYG(vpsPlan)) {
          try {
            const cancelResult = await deleteVPSinstance(chatId, vpsId)
            if (cancelResult && cancelResult.success) {
              await vpsPlansOf.updateOne({ _id }, { $set: { _contaboCancelledEarly: true, status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'auto_renew_disabled', contaboCancelDate: cancelResult.cancelDate } })
              log(`[VPS Scheduler] EARLY CANCEL on Contabo for ${displayName} (auto-renew off) — cancelDate=${cancelResult.cancelDate}`)
            } else {
              log(`[VPS Scheduler] EARLY CANCEL non-success for ${displayName}: ${(cancelResult && cancelResult.error) || 'unknown'}`)
            }
          } catch (cancelErr) { log(`[VPS Scheduler] EARLY CANCEL crash for ${displayName}: ${cancelErr.message}`) }
        }
        continue
      }

      const r = await renewFromWallet(vpsPlan, planPrice, d, now)
      if (r.outcome === 'locked') continue
      if (r.outcome === 'renewed') { await afterRenewal(vpsPlan, planPrice, r, false); continue }

      // Wallet short — pending cancellation; Phase 1.1 retries on every run once the wallet covers it.
      await vpsPlansOf.updateOne({ _id }, { $set: { status: 'PENDING_CANCELLATION', _autoRenewAttempted: true } })
      const usdBal = r.usdBal || 0
      try { send(chatId, asKind(translation('t.util_3', lang, displayName, usdBal.toFixed(2), planPrice, expiryDate), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
      send(adminChatId, `⚠️ <b>VPS Renewal Failed</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nPrice: $${planPrice}\nBalance: $${usdBal.toFixed(2)}`, adminMsgOpts({ chatId }))
      log(`[VPS Scheduler] ${displayName} PENDING_CANCELLATION for ${chatId} — balance insufficient ($${usdBal} < $${planPrice})`)
      if (isPAYG(vpsPlan) && !isGraceManaged(vpsPlan)) notifyResellerVps(vpsPlan, 'vps.grace_start', 'insufficient_funds')
      if (!vpsPlan._contaboCancelledEarly && !isPAYG(vpsPlan)) {
        try {
          const cancelResult = await deleteVPSinstance(chatId, vpsId)
          if (cancelResult && cancelResult.success) {
            await vpsPlansOf.updateOne({ _id }, { $set: { _contaboCancelledEarly: true, status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'wallet_deduct_failed', contaboCancelDate: cancelResult.cancelDate } })
            log(`[VPS Scheduler] EARLY CANCEL on Contabo for ${displayName} (wallet fail) — cancelDate=${cancelResult.cancelDate}`)
          } else {
            log(`[VPS Scheduler] EARLY CANCEL (wallet fail) non-success for ${displayName}: ${(cancelResult && cancelResult.error) || 'unknown'} — Phase 1.5 will retry`)
          }
        } catch (cancelErr) { log(`[VPS Scheduler] EARLY CANCEL (wallet fail) crash for ${displayName}: ${cancelErr.message} — Phase 1.5 will retry`) }
      }
    }

    // ═══ Phase 1.1: RETRY — auto-renew ON but not renewed yet (wallet was short, or the run was missed) ═══
    // Charged as soon as the wallet covers it: before expiry, at expiry, or during a DigitalOcean grace period
    // (the box is powered back on). Contabo boxes cancelled early on wallet-fail are retried until end_time.
    const retryable = await vpsPlansOf.find({
      autoRenewable: true,
      deleted: { $ne: true },
      'planChange.status': { $nin: ['running', 'reconciling'] },
      $or: [
        { status: 'PENDING_CANCELLATION' },
        { status: 'EXPIRED_GRACE' },
        { status: { $in: ['RUNNING', 'running'] }, end_time: { $lte: now } },
        { status: 'CANCELLED', _contaboCancelledEarly: true, cancelReason: { $in: RETRY_CANCEL_REASONS }, end_time: { $gt: now } },
      ],
    }).toArray()
    for (const vpsPlan of retryable) {
      const planPrice = await vpsRenewalPrice(vpsPlan)
      const { usdBal } = await getBalance(walletOf, vpsPlan.chatId)
      if (usdBal < Number(planPrice)) continue
      const late = new Date(vpsPlan.end_time) <= now
      const r = await renewFromWallet(vpsPlan, planPrice, d, now)
      if (r.outcome === 'renewed') await afterRenewal(vpsPlan, planPrice, r, late)
    }

    // ═══ Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION — 5 hours before expiry (PAYG excluded) ═══
    const fiveHoursFromNow = new Date(now.getTime() + 5 * 60 * 60 * 1000)
    const urgentCancellations = await vpsPlansOf.find({
      end_time: { $lte: fiveHoursFromNow, $gt: now },
      status: 'PENDING_CANCELLATION',
      _contaboCancelledEarly: { $ne: true },
    }).toArray()

    for (const vpsPlan of urgentCancellations) {
      if (isPAYG(vpsPlan)) continue
      const { chatId, _id, vpsId, contaboInstanceId, planPrice } = vpsPlan
      const displayName = displayNameOf(vpsPlan)
      const hoursLeft = ((new Date(vpsPlan.end_time).getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1)
      const lang = await langOf(chatId)
      try {
        const cancelResult = await deleteVPSinstance(chatId, vpsId)
        if (cancelResult.success) {
          await vpsPlansOf.updateOne({ _id }, { $set: { _contaboCancelledEarly: true, status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'pre_emptive_no_payment' } })
          try { send(chatId, asKind(translation('t.util_4', lang, displayName), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
          bot?.sendMessage(adminChatId, `🛑 <b>VPS Pre-emptive Cancel</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nContabo ID: ${contaboInstanceId || vpsId}\nHours before expiry: ${hoursLeft}h\nPrice: $${planPrice}/mo\n\n✅ Cancelled on Contabo to prevent their billing.`, adminMsgOpts({ chatId }))?.catch?.(() => {})
          log(`[VPS Scheduler] PRE-EMPTIVE CANCEL: ${displayName} for ${chatId} — ${hoursLeft}h before expiry`)
        } else {
          bot?.sendMessage(adminChatId, `🚨🚨 <b>URGENT: VPS Cancel FAILED — ${hoursLeft}h to Contabo billing!</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nContabo ID: ${contaboInstanceId || vpsId}\nError: ${cancelResult.error}\n\n⚠️ <b>MANUAL ACTION REQUIRED on Contabo dashboard to prevent billing!</b>`, adminMsgOpts({ chatId }))?.catch?.(err => log(`[VPS] CRITICAL: Failed to notify admin about VPS cancel failure for ${chatId}: ${err.message}`))
          log(`[VPS Scheduler] PRE-EMPTIVE CANCEL FAILED: ${displayName} — ${cancelResult.error}`)
        }
      } catch (err) {
        bot?.sendMessage(adminChatId, `🚨🚨 <b>URGENT: VPS Cancel CRASH — ${hoursLeft}h to Contabo billing!</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nContabo ID: ${contaboInstanceId || vpsId}\nError: ${err.message}\n\n⚠️ <b>MANUAL ACTION REQUIRED!</b>`, adminMsgOpts({ chatId }))?.catch?.(e2 => log(`[VPS] CRITICAL: Failed to notify admin about VPS cancel crash for ${chatId}: ${e2.message}`))
        log(`[VPS Scheduler] PRE-EMPTIVE CANCEL CRASH: ${displayName} — ${err.message}`)
      }
    }

    // ═══ Phase 1.6: ESCALATING ADMIN NOTIFICATIONS — 24h / 12h / 6h before expiry for unpaid boxes ═══
    const pendingVps = await vpsPlansOf.find({
      end_time: { $lte: oneDayFromNow, $gt: fiveHoursFromNow },
      status: 'PENDING_CANCELLATION',
    }).toArray()

    for (const vpsPlan of pendingVps) {
      const { chatId, _id, contaboInstanceId, planPrice, end_time } = vpsPlan
      const displayName = displayNameOf(vpsPlan)
      const hoursLeft = (new Date(end_time).getTime() - now.getTime()) / (1000 * 60 * 60)
      const notifySent = vpsPlan._adminNotifyHistory || []
      const tiers = [{ hours: 24, key: '24h', emoji: '⏰' }, { hours: 12, key: '12h', emoji: '⚠️' }, { hours: 6, key: '6h', emoji: '🚨' }]
      for (const tier of tiers) {
        if (hoursLeft <= tier.hours && !notifySent.includes(tier.key)) {
          const { usdBal } = await getBalance(walletOf, chatId)
          const shortfall = (planPrice - usdBal).toFixed(2)
          bot?.sendMessage(adminChatId,
            `${tier.emoji} <b>VPS Renewal Alert — ${tier.key} remaining</b>\n` +
            `\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nContabo ID: ${contaboInstanceId || vpsPlan.vpsId}\n` +
            `Price: $${planPrice}/mo\nUser balance: $${usdBal.toFixed(2)} (short: $${shortfall})\n` +
            `Expires: ${new Date(end_time).toLocaleString()}\n` +
            `\n${hoursLeft <= 6 ? '🛑 <b>Will be auto-cancelled on Contabo at 5h mark if unpaid!</b>' : '💡 User has been notified. No action needed yet.'}`,
            adminMsgOpts({ chatId }),
          )?.catch?.(() => {})
          await vpsPlansOf.updateOne({ _id }, { $push: { _adminNotifyHistory: tier.key } })
          log(`[VPS Scheduler] Admin ${tier.key} notification for ${displayName} (${chatId}) — ${hoursLeft.toFixed(1)}h left`)
          break
        }
      }
    }

    // ═══ Phase 2-DO: DigitalOcean VPS + Windows-RDP power-off → grace → DESTROY (this scheduler owns it) ═══
    try {
      const rdpSvc = d.rdpSvc || require('./digitalocean-rdp-service')
      const doCandidates = await vpsPlansOf.find({
        status: { $nin: ['CANCELLED', 'DESTROYED', 'destroyed', 'DELETED'] },
        $or: [
          { provider: 'digitalocean-rdp' },
          { provider: 'digitalocean' },
          { contaboInstanceId: { $regex: '^rdp-', $options: 'i' } },
          { contaboInstanceId: { $regex: '^do-', $options: 'i' } },
        ],
      }).toArray()
      for (const vpsPlan of doCandidates) {
        if (!isGraceManaged(vpsPlan)) continue
        const isRdpBox = isDoRdp(vpsPlan)
        const graceDays = isRdpBox ? rdpGrace.GRACE_DAYS : VPS_GRACE_DAYS
        const decision = rdpGrace.decideRdpGrace(vpsPlan, { now, graceDays })
        if (decision.action === 'none' || decision.action === 'wait') continue
        const lang = await langOf(vpsPlan.chatId)
        const provider = providerForRecord(vpsPlan)
        await rdpGrace.applyRdpGrace(vpsPlan, decision, {
          now,
          product: isRdpBox ? 'rdp' : 'vps',
          msgKeys: isRdpBox
            ? { graceStart: 't.rdpGraceStart', graceReminder: 't.rdpGraceReminder', deletedAfterGrace: 't.rdpDeletedAfterGrace' }
            : { graceStart: 't.vpsGraceStart', graceReminder: 't.vpsGraceReminder', deletedAfterGrace: 't.vpsDeletedAfterGrace' },
          powerOff: (inst) => (provider && typeof provider.stopInstance === 'function') ? provider.stopInstance(inst) : Promise.resolve(),
          destroy: (cid, vid) => deleteVPSinstance(cid, vid),
          updatePlan: (planId, fields) => vpsPlansOf.updateOne({ _id: planId }, { $set: fields }),
          mirrorGrace: isRdpBox ? ((inst, fields) => (typeof rdpSvc.markGrace === 'function') ? rdpSvc.markGrace(inst, fields) : Promise.resolve()) : null,
          mirrorDestroy: isRdpBox ? ((inst) => (typeof rdpSvc.markGraceDestroy === 'function') ? rdpSvc.markGraceDestroy(inst) : Promise.resolve()) : null,
          notifyUser: (cid, key, args) => { try { send(cid, translation(key, lang, ...(args || []))) } catch (e) { log(`[DO Grace] notify failed: ${e.message}`) } },
          notifyReseller: (event, payload) => { try { resellerWebhooks.emit(db, { chatId: vpsPlan.chatId, event, instanceId: vpsPlan.vpsId || vpsPlan._id, payload, log }).catch(() => {}) } catch (_) { /* noop */ } },
          notifyAdmin: (text) => { try { send(adminChatId, text, adminMsgOpts({ chatId: vpsPlan.chatId })) } catch (_) { /* noop */ } },
          log,
        })
      }
    } catch (rdpErr) {
      log(`[RDP Grace] pass error: ${rdpErr.message}`)
    }

    // ═══ Phase 2: DELETE non-DO boxes past expiry with a failed / disabled renewal ═══
    const pastDeadline = await vpsPlansOf.find({ end_time: { $lte: now }, status: 'PENDING_CANCELLATION' }).toArray()

    for (const vpsPlan of pastDeadline) {
      if (isGraceManaged(vpsPlan)) continue
      const { chatId, _id, vpsId, contaboInstanceId, planPrice, lastDeleteAlertAt, deleteRetryCount } = vpsPlan
      const displayName = displayNameOf(vpsPlan)
      const lang = await langOf(chatId)
      // Throttled admin alert: attempt 1, then every 6h, none after 10 retries.
      const recordFailure = async (error, title) => {
        const retries = (deleteRetryCount || 0) + 1
        const lastAlertAgeMs = lastDeleteAlertAt ? (Date.now() - new Date(lastDeleteAlertAt).getTime()) : Infinity
        const shouldAlert = retries === 1 || (retries <= 10 && lastAlertAgeMs >= 6 * 3600 * 1000)
        await vpsPlansOf.updateOne({ _id }, { $set: { deleteRetryCount: retries, lastDeleteError: error, ...(shouldAlert ? { lastDeleteAlertAt: new Date() } : {}) } })
        log(`[VPS Scheduler] ${title} ${displayName} (attempt ${retries}): ${error}${shouldAlert ? '' : ' — admin alert throttled'}`)
        if (shouldAlert) send(adminChatId, `🚨 <b>${title}</b> ${retries === 1 ? '' : `(retry ${retries})`}\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName} (vpsId: ${vpsId})\nInstance ID: ${contaboInstanceId}\nError: ${error}\n\n⚠️ Manual deletion required to prevent provider billing! ${retries >= 10 ? '\n\n🛑 Auto-retries exhausted — no further alerts on this instance.' : '(next alert in ≥6h)'}`, adminMsgOpts({ chatId }))
      }
      try {
        const deleteResult = await deleteVPSinstance(chatId, vpsId)
        if (deleteResult.success) {
          await vpsPlansOf.updateOne({ _id }, { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: deleteResult.alreadyGone ? 'auto_renewal_failed_already_gone' : 'auto_renewal_failed' } })
          notifyResellerVps(vpsPlan, 'vps.deleted', deleteResult.alreadyGone ? 'already_gone' : 'auto_renewal_failed')
          try { send(chatId, asKind(translation('t.util_5', lang, displayName), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
          if (!deleteResult.alreadyGone) send(adminChatId, `🗑️ <b>VPS Auto-Deleted</b>\nUser: ${adminUserTag(await get(nameOf, chatId), chatId)}\nVPS: ${displayName}\nReason: Renewal failed, deadline passed\nPrice was: $${planPrice}/mo`, adminMsgOpts({ chatId }))
          log(`[VPS Scheduler] DELETED ${displayName} for ${chatId} — deadline passed${deleteResult.alreadyGone ? ' (already gone)' : ''}`)
        } else {
          await recordFailure(deleteResult.error, 'VPS DELETE FAILED')
        }
      } catch (err) {
        await recordFailure(err.message, 'VPS Delete Crash')
      }
    }

    // ═══ Phase 3: RUNNING but past expiry and not renewed in Phase 1.1 (non-DO; DO enters Phase 2-DO) ═══
    const staleExpired = await vpsPlansOf.find({ end_time: { $lte: now }, status: { $in: ['RUNNING', 'running'] } }).toArray()

    for (const vpsPlan of staleExpired) {
      if (isGraceManaged(vpsPlan)) continue
      const { chatId, _id } = vpsPlan
      const displayName = displayNameOf(vpsPlan)
      const lang = await langOf(chatId)
      await vpsPlansOf.updateOne({ _id }, { $set: { status: 'PENDING_CANCELLATION', _autoRenewAttempted: true } })
      const { usdBal } = await getBalance(walletOf, chatId)
      try { send(chatId, asKind(translation('t.util_7', lang, displayName, (usdBal).toFixed(2)), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
      log(`[VPS Scheduler] ${displayName} marked PENDING_CANCELLATION (stale) for ${chatId}`)
    }

    // ═══ Phase 4: 3-day reminder with wallet balance (the only VPS 3-day reminder) ═══
    const soonExpiring = await vpsPlansOf.find({ end_time: { $lte: threeDaysFromNow, $gt: oneDayFromNow }, status: { $in: ['RUNNING', 'running'] } }).toArray()

    for (const vpsPlan of soonExpiring) {
      const { chatId, _id, end_time } = vpsPlan
      const displayName = displayNameOf(vpsPlan)
      const daysLeft = (new Date(end_time).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      if (!(daysLeft > 2.5 && daysLeft <= 3.1) || vpsPlan._reminder3DaySent) continue
      const lang = await langOf(chatId)
      const planPrice = await vpsRenewalPrice(vpsPlan)
      const { usdBal } = await getBalance(walletOf, chatId)
      const sufficient = usdBal >= planPrice
      const renewNote = vpsPlan.autoRenewable
        ? (sufficient ? 'Auto-renewal will be attempted 1 day before expiry.' : 'Insufficient balance — top up or renew manually to keep your server!')
        : 'Auto-renew is OFF — renew manually to keep your server!'
      try { send(chatId, asKind(translation('t.util_8', lang, displayName, new Date(end_time).toLocaleDateString(), planPrice, usdBal.toFixed(2), sufficient ? '✅' : '⚠️', renewNote), isRdpRecord(vpsPlan))) } catch (e) { log(`[VPS Scheduler] notify failed: ${e.message}`) }
      await vpsPlansOf.updateOne({ _id }, { $set: { _reminder3DaySent: true } })
      log(`[VPS Scheduler] 3-day reminder sent to ${chatId} for ${displayName}`)
    }
  } catch (error) {
    console.error('[VPS Scheduler] Error:', error.message || error)
  }
}

module.exports = { runVpsExpiryCheck, renewFromWallet, renewalMonths, isGraceManaged, VPS_GRACE_DAYS }
