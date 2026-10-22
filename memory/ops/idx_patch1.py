p='/app/js/_index.js'
s=open(p,encoding='utf-8').read()
start=s.index("/**\n * Single Telnyx purchase entry point for every payment path")
end=s.index("// Approved by the carrier → configure + save the number exactly like a normal purchase.")
new='''/**
 * Telnyx purchase entry point for every payment path (wallet / bank / BlockBee / DynoPay), AFTER payment.
 *  • US/CA + intl countries without requirements → telnyxApi.buyNumber (instant, unchanged)
 *  • Countries with requirements → pay-first verification chat (same as the Twilio flow);
 *    returns { _verification: true } → caller stops (no refund, no activation now).
 * Returns null on failure → caller refunds exactly as before.
 */
async function telnyxPaidCheckout(chatId, selectedNumber, ctx = {}) {
  const { countryCode = 'US', numberType = 'local', areaCode = null } = ctx
  const retry = { countryCode, numberType, areaCode }
  if (!isTelnyxIntl('telnyx', countryCode)) {
    return telnyxApi.buyNumber(selectedNumber, telnyxResources.sipConnectionId, telnyxResources.messagingProfileId, retry)
  }
  const mpId = ctx.capabilities?.sms === false ? null : telnyxResources.messagingProfileId
  const rq = await txReg.getRequirements(countryCode, numberType)
  if (!rq.ok) { log(`[TelnyxCheckout] requirements lookup failed for ${countryCode}/${numberType} — not ordering`); return null }
  if (!rq.reqs.length) return telnyxApi.buyNumber(selectedNumber, telnyxResources.sipConnectionId, mpId, retry)
  const lang = ctx.lang || 'en'
  if (ctx.isSubNumber) { send(chatId, txReg.T(lang).subNotSupported, { parse_mode: 'HTML' }); return null }
  const payment = {
    planKey: ctx.planKey || 'starter', price: Number(ctx.price) || 0, paymentMethod: ctx.paymentMethod || 'unknown',
    refund: ctx.refund || { currency: 'usd', amount: Number(ctx.price) || 0 },
    capabilities: ctx.capabilities || { voice: true, sms: mpId !== null, fax: false }, areaCode,
  }
  const st = await txReg.startSession(chatId, { countryCode, numberType, countryName: ctx.countryName, selectedNumber, reqs: rq.reqs, lang, payment })
  if (!st.ok) { send(chatId, st.text, { parse_mode: 'HTML' }); return null }
  await set(state, chatId, 'action', 'cpTxReg')
  await send(chatId, st.intro, { parse_mode: 'HTML' })
  send(chatId, st.prompt.text, { parse_mode: 'HTML', reply_markup: { keyboard: st.prompt.keyboard, resize_keyboard: true } })
  notifyAdmin(`🛂 [Telnyx] Paid — collecting verification details\\nchatId: ${chatId}\\nnumber: ${selectedNumber}\\ncountry: ${countryCode}/${numberType}\\npaid: ${txReg.fmtAmount(payment.refund)} (${payment.paymentMethod})`)
  if (cartRecovery) cartRecovery.recordPaymentCompleted(String(chatId))
  if (userConversion) userConversion.markPurchased(chatId)
  return { _verification: true, sessionId: st.session._id }
}

async function refundTelnyxVerification(chatId, refund, lang) {
  const cur = refund?.currency === 'ngn' ? 'ngn' : 'usd'
  const amt = Number(refund?.amount) || 0
  try { if (amt > 0) await addFundsTo(walletOf, chatId, cur, amt, lang || 'en') } catch (e) {
    notifyAdmin(`🚨 CRITICAL [TelnyxVerify] refund failed\\nchatId: ${chatId}\\namount: ${amt} ${cur}\\nerror: ${e.message}`)
  }
}

// /cancel, "Cancel & Refund" from the resume menu → close the paid session + refund once.
async function cancelTelnyxVerification(chatId, lang) {
  const s = await txReg.cancelSession(chatId)
  if (!s) return false
  const l = lang || s.lang || 'en'
  await set(state, chatId, 'action', 'none')
  await refundTelnyxVerification(chatId, s.payment?.refund, l)
  send(chatId, txReg.T(l).cancelled(txReg.fmtAmount(s.payment?.refund)), translation('o', l))
  notifyAdmin(`↩️ [TelnyxVerify] Cancelled by user → refunded ${txReg.fmtAmount(s.payment?.refund)}\\nchatId: ${chatId}\\nnumber: ${s.selectedNumber}\\ncountry: ${s.countryCode}/${s.numberType}`)
  return true
}

// One user message (text / photo / document) for the active verification. Returns false when no session.
async function handleTelnyxVerificationInput(chatId, input, lang) {
  const r = await txReg.handleInput(chatId, input, lang)
  if (!r) { await set(state, chatId, 'action', 'none'); return false }
  if (r.cancelled) {
    await set(state, chatId, 'action', 'none')
    if (r.refundable) {
      await refundTelnyxVerification(chatId, r.session?.payment?.refund, lang)
      notifyAdmin(`↩️ [TelnyxVerify] Cancelled by user → refunded ${txReg.fmtAmount(r.session?.payment?.refund)}\\nchatId: ${chatId}\\nnumber: ${r.session?.selectedNumber}`)
    }
    send(chatId, r.text, translation('o', lang))
    return true
  }
  if (r.done) {
    await set(state, chatId, 'action', 'none')
    await send(chatId, r.text, { reply_markup: { remove_keyboard: true } })
    await submitTelnyxVerification(r.session)
    return true
  }
  send(chatId, r.text, { parse_mode: 'HTML', reply_markup: { keyboard: r.keyboard, resize_keyboard: true } })
  return true
}

const TELNYX_NUMBER_GONE = /recognize|did you first search|not available|no longer available|already (been )?(reserved|ordered|purchased)/i

// User tapped Submit → order with the collected details. Active → activate now; pending → review poller.
async function submitTelnyxVerification(session) {
  const chatId = session.chatId
  const lang = session.lang || 'en'
  const p = session.payment || {}
  const t = txReg.T(lang)
  const opts = {
    connectionId: telnyxResources.sipConnectionId,
    messagingProfileId: p.capabilities?.sms === false ? null : telnyxResources.messagingProfileId,
    customerReference: `nomadly-${chatId}`,
  }
  let r = await txReg.placeRegulatedOrder(session, opts)
  if (!r.ok && TELNYX_NUMBER_GONE.test(r.error || '')) {
    const fresh = (await telnyxApi.searchNumbers(session.countryCode, session.numberType, p.areaCode || null, 3)).find(n => n.phone_number !== session.selectedNumber)
    if (fresh) {
      log(`[TelnyxVerify] ${session.selectedNumber} no longer available — retrying with ${fresh.phone_number} for ${chatId}`)
      await txReg.setStatus(session._id, 'submitting', { selectedNumber: fresh.phone_number, replacedNumber: session.selectedNumber })
      session.selectedNumber = fresh.phone_number
      r = await txReg.placeRegulatedOrder(session, opts)
    }
  }
  if (!r.ok || r.state === 'failed') {
    const reason = String(r.error || r.order?.status || 'failed').slice(0, 300)
    await txReg.setStatus(session._id, 'refunded', { reason })
    await refundTelnyxVerification(chatId, p.refund, lang)
    send(chatId, t.orderFailed(txReg.fmtAmount(p.refund)), translation('o', lang))
    notifyAdmin(`❌ [TelnyxVerify] Regulated order failed — user refunded ${txReg.fmtAmount(p.refund)}\\nchatId: ${chatId}\\nnumber: ${session.selectedNumber}\\ncountry: ${session.countryCode}/${session.numberType}\\nerror: ${reason}`)
    return
  }
  const doc = {
    _id: r.order.id, orderId: r.order.id, chatId: String(chatId), phoneNumber: session.selectedNumber, sessionId: session._id,
    countryCode: session.countryCode, countryName: session.countryName || session.countryCode, numberType: session.numberType,
    planKey: p.planKey || 'starter', price: Number(p.price) || 0, paymentMethod: p.paymentMethod || 'unknown',
    refund: p.refund || { currency: 'usd', amount: Number(p.price) || 0 },
    capabilities: p.capabilities || { voice: true, sms: false, fax: false },
    lang, status: 'under_review', checks: 0, createdAt: new Date(), nextCheckAt: new Date(Date.now() + 2 * 60 * 1000),
  }
  try {
    await telnyxPendingOrders.insertOne(doc)
  } catch (e) {
    notifyAdmin(`🚨 [TelnyxVerify] Order ${r.order.id} placed but NOT tracked (${e.message}) — check manually\\nchatId: ${chatId}\\nnumber: ${session.selectedNumber}`)
    return
  }
  if (r.state === 'active') { await activateTelnyxReviewedOrder(doc); return }
  send(chatId, t.underReview(session.selectedNumber, doc.countryName), translation('o', lang))
  notifyAdmin(`🛂 [Telnyx] Number under regulatory review\\nchatId: ${chatId}\\nnumber: ${session.selectedNumber}\\ncountry: ${session.countryCode}/${session.numberType}\\norder: ${r.order.id}\\npaid: ${txReg.fmtAmount(doc.refund)} (${doc.paymentMethod})`)
}

// Paid but unfinished verifications: one reminder after 6h idle, auto-refund after 48h idle.
async function sweepTelnyxVerifications() {
  const { remind, expire } = await txReg.findAbandoned()
  for (const s of expire) {
    const closed = await txReg.closeSession(s._id, 'expired', { expiredAt: new Date() })
    if (!closed) continue
    const l = s.lang || 'en'
    const amt = txReg.fmtAmount(s.payment?.refund)
    await refundTelnyxVerification(s.chatId, s.payment?.refund, l)
    const st = await get(state, s.chatId)
    if (st?.action === 'cpTxReg') await set(state, s.chatId, 'action', 'none')
    send(s.chatId, txReg.T(l).expired(String(s.countryName || s.countryCode), amt), translation('o', l))
    notifyAdmin(`⌛ [TelnyxVerify] Not completed in 48h → refunded ${amt}\\nchatId: ${s.chatId}\\nnumber: ${s.selectedNumber}`)
  }
  for (const s of remind) {
    await txReg.markReminded(s._id)
    send(s.chatId, txReg.T(s.lang || 'en').reminder(String(s.countryName || s.countryCode), txReg.fmtAmount(s.payment?.refund)), { parse_mode: 'HTML' })
  }
  return { reminded: remind.length, expired: expire.length }
}

'''
s=s[:start]+new+s[end:]
old="""    singletonInterval('telnyx-review-poller', () => { pollTelnyxPendingOrders().catch(e => log(`[TelnyxReview] poll error: ${e.message}`)) }, 5 * 60 * 1000)"""
assert s.count(old)==1
s=s.replace(old,"""    singletonInterval('telnyx-review-poller', () => {
      pollTelnyxPendingOrders().catch(e => log(`[TelnyxReview] poll error: ${e.message}`))
        .then(() => sweepTelnyxVerifications()).catch(e => log(`[TelnyxVerify] sweep error: ${e.message}`))
    }, 5 * 60 * 1000)""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
