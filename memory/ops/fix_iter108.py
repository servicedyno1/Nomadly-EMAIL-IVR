# --- telnyx-regulatory.js ---
p='/app/js/telnyx-regulatory.js'
s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (p, old[:100], s.count(old))
    s=s.replace(old,new)

# 1. validate: Telnyx answers an invalid address with HTTP 422 + body → read it instead of throwing
rep("""  try {
    const r = await http().post('/addresses/actions/validate', {
      street_address: a.street, locality: a.city, administrative_area: a.region || a.city,
      postal_code: a.postal || undefined, country_code: a.country,
    })
    const d = r.data?.data || {}
    const sug = d.suggested ? {
      street: d.suggested.street_address, city: d.suggested.locality,
      region: d.suggested.administrative_area, postal: d.suggested.postal_code, country: a.country,
    } : null
    const errors = (d.errors || []).map(e => `• ${e.detail || e.title || e.code || ''}`).filter(x => x.length > 2).join('\\n')
    return { result: d.result === 'invalid' ? 'invalid' : 'valid', suggested: d.result === 'invalid' ? sug : null, errors }
  } catch (e) {""",
"""  try {
    const r = await http().post('/addresses/actions/validate', {
      street_address: a.street, locality: a.city, administrative_area: a.region || a.city,
      postal_code: a.postal || undefined, country_code: a.country,
    }, { validateStatus: st => st < 500 })
    const d = r.data?.data || {}
    const g = d.suggested || {}
    const sug = (g.street_address || g.locality || g.postal_code) ? {
      street: g.street_address, city: g.locality, region: g.administrative_area, postal: g.postal_code, country: a.country,
    } : null
    const errs = [...(d.errors || []), ...(r.data?.errors || [])]
    const errors = errs.map(e => `• ${e.detail || e.title || e.code || ''}`).filter(x => x.length > 2).join('\\n')
    const invalid = d.result === 'invalid' || r.status === 422
    if (r.status >= 400 && !invalid) throw new Error(errors || `HTTP ${r.status}`)
    return { result: invalid ? 'invalid' : 'valid', suggested: invalid ? sug : null, errors }
  } catch (e) {""")

# 2. never write a closed session back to 'collecting'
rep("""  const reply = async (extra = {}) => {
    s.updatedAt = new Date()
    await sessions.replaceOne({ _id: s._id }, s)
    const p = prompt(s, lang)""",
"""  const reply = async (extra = {}) => {
    s.updatedAt = new Date()
    const w = await sessions.replaceOne({ _id: s._id, status: 'collecting' }, s)
    if (!w.matchedCount) return { text: '', closed: true }
    const p = prompt(s, lang)""")
rep("""    const closed = await closeSession(s._id, 'cancelled', { cancelledAt: new Date() })
    return { text: t.cancelled(fmtAmount(s.payment?.refund)), cancelled: true, session: closed || s, refundable: !!closed }""",
"""    const closed = await closeSession(s._id, 'cancelled', { cancelledAt: new Date() })
    if (!closed) return { text: '', closed: true }
    return { text: t.cancelled(fmtAmount(s.payment?.refund)), cancelled: true, session: closed, refundable: true }""")

# 3. number-gone retry re-uses the address + documents already created
rep("""    if (a.address) {
      addressId = await createAddress(s)
      if (!addressId) throw new Error('address creation returned no id')""",
"""    if (a.address) {
      addressId = s._addressId || await createAddress(s)
      if (!addressId) throw new Error('address creation returned no id')
      s._addressId = addressId""")
rep("""      const id = await uploadDocument(s, f)
      if (!id) throw new Error(`document upload returned no id (${r.name})`)
      docIds[r.id] = id""",
"""      const id = s._docIds?.[r.id] || await uploadDocument(s, f)
      if (!id) throw new Error(`document upload returned no id (${r.name})`)
      docIds[r.id] = id
      s._docIds = { ...(s._docIds || {}), [r.id]: id }""")

# 4. sessions stuck in 'submitting' (crash mid-submit) → admin alert once
rep("""  const remind = await sessions.find({ ...base, reminded: { $ne: true }, updatedAt: { $lt: new Date(now - remindMs), $gte: new Date(now - expireMs) } }).limit(25).toArray()
  return { remind, expire }""",
"""  const remind = await sessions.find({ ...base, reminded: { $ne: true }, updatedAt: { $lt: new Date(now - remindMs), $gte: new Date(now - expireMs) } }).limit(25).toArray()
  const stuck = await sessions.find({ status: 'submitting', stuckAlerted: { $ne: true }, updatedAt: { $lt: new Date(now - 30 * 60e3) } }).limit(25).toArray()
  return { remind, expire, stuck }""")
rep("""async function markReminded(id) { await sessions.updateOne({ _id: id }, { $set: { reminded: true } }) }""",
"""async function markReminded(id) { await sessions.updateOne({ _id: id }, { $set: { reminded: true } }) }
async function markStuckAlerted(id) { await sessions.updateOne({ _id: id }, { $set: { stuckAlerted: true } }) }""")
rep("""findAbandoned, markReminded, prePayNote""", """findAbandoned, markReminded, markStuckAlerted, prePayNote""")
open(p,'w',encoding='utf-8').write(s)

# --- _index.js ---
p='/app/js/_index.js'
s=open(p,encoding='utf-8').read()

# helper: does this Telnyx number need verification (cached live requirements)
rep("""async function refundTelnyxVerification(chatId, refund, lang) {""",
"""// Cached live requirements → true when the paid order will go through verification (skip "Purchasing…" text)
async function telnyxNeedsVerification(provider, countryCode, numberType) {
  if (!isTelnyxIntl(provider || 'telnyx', countryCode)) return false
  const rq = await txReg.getRequirements(countryCode, numberType || 'local')
  return !!(rq.ok && rq.reqs.length)
}

async function refundTelnyxVerification(chatId, refund, lang) {""")

# handleInput closed race → silent
rep("""  const r = await txReg.handleInput(chatId, input, lang)
  if (!r) { await set(state, chatId, 'action', 'none'); return false }""",
"""  const r = await txReg.handleInput(chatId, input, lang)
  if (!r) { await set(state, chatId, 'action', 'none'); return false }
  if (r.closed) { await set(state, chatId, 'action', 'none'); return true }""")

# submit: unexpected throw → refund (before order) / alert (after order)
rep("""async function submitTelnyxVerification(session) {
  const chatId = session.chatId""",
"""async function submitTelnyxVerification(session) {
  try { return await _submitTelnyxVerification(session) } catch (e) {
    log(`[TelnyxVerify] submit crashed for ${session.chatId}: ${e.message}`)
    const s = await txReg.getSessionById(session._id)
    if (s?.status === 'submitting') {
      await txReg.setStatus(session._id, 'refunded', { reason: `crash: ${e.message}` })
      await refundTelnyxVerification(session.chatId, session.payment?.refund, session.lang)
      send(session.chatId, txReg.T(session.lang).orderFailed(txReg.fmtAmount(session.payment?.refund)), translation('o', session.lang || 'en'))
    }
    notifyAdmin(`🚨 [TelnyxVerify] submit crashed (${s?.status || 'unknown'})\\nchatId: ${session.chatId}\\nnumber: ${session.selectedNumber}\\nerror: ${e.message}`)
  }
}
async function _submitTelnyxVerification(session) {
  const chatId = session.chatId""")
rep("""  try {
    await telnyxPendingOrders.insertOne(doc)
  } catch (e) {
    notifyAdmin(`🚨 [TelnyxVerify] Order ${r.order.id} placed but NOT tracked (${e.message}) — check manually\\nchatId: ${chatId}\\nnumber: ${session.selectedNumber}`)
    return
  }""",
"""  try {
    await telnyxPendingOrders.insertOne(doc)
  } catch (e) {
    await txReg.setStatus(session._id, 'ordered_untracked', { trackError: e.message })
    notifyAdmin(`🚨 [TelnyxVerify] Order ${r.order.id} placed but NOT tracked (${e.message}) — check manually\\nchatId: ${chatId}\\nnumber: ${session.selectedNumber}`)
    return
  }""")

# sweeper: stuck submitting alert
rep("""  const { remind, expire } = await txReg.findAbandoned()""",
"""  const { remind, expire, stuck } = await txReg.findAbandoned()
  for (const s of stuck) {
    await txReg.markStuckAlerted(s._id)
    notifyAdmin(`⚠️ [TelnyxVerify] Session stuck in 'submitting' for 30+ min — check Telnyx orders, then refund or activate manually\\nchatId: ${s.chatId}\\nnumber: ${s.selectedNumber}\\nsession: ${s._id}\\npaid: ${txReg.fmtAmount(s.payment?.refund)}`)
  }""")

# no "Purchasing your number..." before the verification intro
rep("""      send(chatId, phoneConfig.getMsg(info?.userLanguage).purchasingNumber)

      let orderResult, sipUsername, sipPassword""",
"""      if (!(await telnyxNeedsVerification(provider, countryCode, info?.cpNumberType))) send(chatId, phoneConfig.getMsg(info?.userLanguage).purchasingNumber)

      let orderResult, sipUsername, sipPassword""")
rep("""    // ── TELNYX PURCHASE ──
    sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)
    let orderResult = await telnyxPaidCheckout(""",
"""    // ── TELNYX PURCHASE ──
    if (!(await telnyxNeedsVerification(provider, countryCode, info?.cpNumberType))) sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)
    let orderResult = await telnyxPaidCheckout(""")
rep("""  // ── TELNYX (BlockBee crypto path) ──
  sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)""",
"""  // ── TELNYX (BlockBee crypto path) ──
  if (!(await telnyxNeedsVerification(provider, countryCode, info?.cpNumberType))) sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)""")
rep("""  // ── TELNYX ──
  sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)
  const orderResult = await telnyxPaidCheckout(""",
"""  // ── TELNYX ──
  if (!(await telnyxNeedsVerification(provider, countryCode, info?.cpNumberType))) sendMessage(chatId, phoneConfig.getMsg(lang).purchasingNumber)
  const orderResult = await telnyxPaidCheckout(""")

# DynoPay verification audit trail
rep("""    refund: { currency: 'usd', amount: Number(price) }, paymentMethod: 'crypto_dynopay_' + coin, lang,
  })
  if (orderResult?._verification) {
    if (excessUsd > 0)""",
"""    refund: { currency: 'usd', amount: Number(price) }, paymentMethod: 'crypto_dynopay_' + coin, lang,
  })
  if (orderResult?._verification) {
    await auditCryptoTx(chatId, 'phone-number', price, { phoneNumber: selectedNumber, plan: planKey, countryCode, provider: 'telnyx', coin, value, ref, verification: true }, 'dynopay')
    if (excessUsd > 0)""")

# bank: excess is credited up-front → every later refund returns only what the order cost
b0 = s.index("  '/bank-pay-phone': async (req, res, ngnIn) => {")
b1 = s.index("  '/bank-pay-leads': async (req, res, ngnIn) => {")
blk = s[b0:b1]
old_ex = """    if (ngnIn > ngnPrice) {
      addFundsTo(walletOf, chatId, 'ngn', ngnIn - ngnPrice, lang)
      sendMessage(chatId, translation('t.sentMoreMoney', lang, `${ngnPrice} NGN`, `${ngnIn} NGN`))
    }
"""
assert blk.count(old_ex)==1
head, tail = blk.split(old_ex)
n_ref = tail.count("addFundsTo(walletOf, chatId, 'ngn', ngnIn, lang)")
assert n_ref == 5, n_ref
tail = tail.replace("addFundsTo(walletOf, chatId, 'ngn', ngnIn, lang)", "addFundsTo(walletOf, chatId, 'ngn', ngnPaid, lang)")
tail = tail.replace("refund: { currency: 'ngn', amount: Math.min(Number(ngnIn) || 0, Number(ngnPrice) || Number(ngnIn) || 0) }", "refund: { currency: 'ngn', amount: ngnPaid }")
blk = head + old_ex + "    const ngnPaid = Math.min(Number(ngnIn) || 0, Number(ngnPrice) || Number(ngnIn) || 0) // excess already credited above\n" + tail
s = s[:b0] + blk + s[b1:]

# sub-number: block regulated countries at selection (before payment)
rep("""    await saveInfo('cpSelectedCapabilities', caps)
    const numberType = info?.cpNumberType || 'local'
    const countryCode = info?.cpCountryCode || 'US'
    const subPrice = getSubNumberPrice(countryCode, numberType, selectedProvider)""",
"""    await saveInfo('cpSelectedCapabilities', caps)
    const numberType = info?.cpNumberType || 'local'
    const countryCode = info?.cpCountryCode || 'US'
    if (await telnyxNeedsVerification(selectedProvider, countryCode, numberType)) return send(chatId, txReg.T(lang).subNotSupported, { parse_mode: 'HTML' })
    const subPrice = getSubNumberPrice(countryCode, numberType, selectedProvider)""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
