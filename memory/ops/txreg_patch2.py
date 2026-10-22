p='/app/js/telnyx-regulatory.js'
s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (old[:90], s.count(old))
    s=s.replace(old,new)

rep("""//  2. startSession / handleInput — BEFORE payment the bot collects the user's
//     contact details, address and (when required) ID / proof-of-address files.
//     Files are kept as Telegram file_ids and only uploaded to Telnyx at order
//     time (Telnyx deletes unlinked documents after ~30 min).
//  3. placeRegulatedOrder        — after payment: create address, upload docs,
//     POST /number_orders with per-number regulatory_requirements (or a
//     requirement group for countries that mandate one, e.g. IE).""",
"""//  2. startSession / handleInput — AFTER payment (same as the Twilio flow) the bot
//     collects contact details, address and (when required) ID / proof-of-address
//     files. Session carries the payment so cancel / 48h abandonment refunds it.
//     Files are kept as Telegram file_ids and only uploaded to Telnyx at order
//     time (Telnyx deletes unlinked documents after ~30 min).
//  3. placeRegulatedOrder        — on submit: create address, upload docs,
//     POST /number_orders with per-number regulatory_requirements (or a
//     requirement group for countries that mandate one, e.g. IE).""")

rep("""    sessions.createIndex({ status: 1, updatedAt: 1 }).catch(() => {})""",
"""    sessions.createIndex({ status: 1, updatedAt: 1 }).catch(() => {})
    sessions.createIndex({ chatId: 1, status: 1 }).catch(() => {})""")

rep("""async function startSession(chatId, { countryCode, numberType, countryName, selectedNumber, reqs, lang = 'en' }) {
  const t = T(lang)
  const a = analyze(reqs)
  const cname = countryName || countryLabel(countryCode)
  if (!a.supported) return { ok: false, text: t.unsupported(esc(cname)) }
  const now = new Date()
  const session = {
    _id: String(chatId), chatId: String(chatId), countryCode, numberType, countryName: cname, selectedNumber,
    status: 'collecting', reqs, steps: buildSteps(reqs), idx: 0, profile: {}, address: {}, values: {}, docs: {},
    addressScope: a.addressScope, lang, createdAt: now, updatedAt: now,
  }
  if (a.addressScope !== 'worldwide') session.address.country = countryCode
  await advance(session)
  await sessions.replaceOne({ _id: session._id }, session, { upsert: true })
  return {
    ok: true,
    intro: t.intro(esc(stripFlag(cname)), TYPE_LABEL[numberType] || numberType, a.localOnly),
    prompt: prompt(session, lang),
  }
}

async function getSession(chatId) { return sessions ? sessions.findOne({ _id: String(chatId) }) : null }
async function getReadySession(chatId, selectedNumber) {
  if (!sessions) return null
  return sessions.findOne({ _id: String(chatId), status: 'ready', selectedNumber })
}
async function clearSession(chatId) { if (sessions) await sessions.deleteOne({ _id: String(chatId), status: { $in: ['collecting', 'ready', 'cancelled'] } }) }
""",
"""const fmtAmount = r => (r?.currency === 'ngn' ? `₦${Number(r.amount || 0).toLocaleString()}` : `$${Number(r?.amount || 0).toFixed(2)}`)

// payment: { planKey, price, refund:{currency,amount}, paymentMethod, capabilities, areaCode }
async function startSession(chatId, { countryCode, numberType, countryName, selectedNumber, reqs, lang = 'en', payment = null }) {
  const t = T(lang)
  const a = analyze(reqs)
  const cname = countryName || countryLabel(countryCode)
  if (!a.supported) return { ok: false, text: t.unsupported(esc(cname)) }
  const now = new Date()
  const session = {
    _id: `${chatId}:${now.getTime()}`, chatId: String(chatId), countryCode, numberType, countryName: cname, selectedNumber,
    status: 'collecting', reqs, steps: buildSteps(reqs), idx: 0, profile: {}, address: {}, values: {}, docs: {},
    addressScope: a.addressScope, lang, payment, price: Number(payment?.price) || 0, createdAt: now, updatedAt: now,
  }
  if (a.addressScope !== 'worldwide') session.address.country = countryCode
  await advance(session)
  await sessions.insertOne(session)
  return {
    ok: true,
    session,
    intro: t.intro(esc(stripFlag(cname)), TYPE_LABEL[numberType] || numberType, a.localOnly, payment ? fmtAmount(payment.refund) : ''),
    prompt: prompt(session, lang),
  }
}

async function getSession(chatId) {
  return sessions ? sessions.findOne({ chatId: String(chatId), status: 'collecting' }, { sort: { updatedAt: -1 } }) : null
}
const getIncompleteSession = getSession

// Atomic collecting → <status>. Returns the session when THIS call made the transition (refund exactly once).
async function closeSession(id, status, extra = {}) {
  const r = await sessions.findOneAndUpdate({ _id: id, status: 'collecting' }, { $set: { status, ...extra, updatedAt: new Date() } }, { returnDocument: 'after' })
  return r?.value !== undefined ? r.value : r
}
async function cancelSession(chatId) {
  const s = await getSession(chatId)
  return s ? closeSession(s._id, 'cancelled', { cancelledAt: new Date() }) : null
}
async function setStatus(id, status, extra = {}) {
  await sessions.updateOne({ _id: id }, { $set: { status, ...extra, updatedAt: new Date() } })
}

async function resumePrompt(chatId, lang) {
  const s = await getSession(chatId)
  if (!s) return null
  const l = lang || s.lang
  const p = prompt(s, l)
  return { session: s, text: `${T(l).resumeHead(esc(stripFlag(s.countryName)))}\\n\\n${p.text}`, keyboard: p.keyboard }
}
async function restartSession(chatId, lang) {
  const s = await getSession(chatId)
  if (!s) return null
  s.idx = 0; s.profile = {}; s.values = {}; s.docs = {}; s.addrCheck = null
  s.address = s.addressScope !== 'worldwide' ? { country: s.countryCode } : {}
  await advance(s)
  s.updatedAt = new Date()
  await sessions.replaceOne({ _id: s._id, status: 'collecting' }, s)
  const p = prompt(s, lang || s.lang)
  return { session: s, text: p.text, keyboard: p.keyboard }
}

// Paid sessions left unfinished: remind once after remindMs idle, expire (caller refunds) after expireMs idle.
async function findAbandoned({ remindMs = 6 * 3600e3, expireMs = 48 * 3600e3 } = {}) {
  if (!sessions) return { remind: [], expire: [] }
  const now = Date.now()
  const base = { status: 'collecting', payment: { $ne: null } }
  const expire = await sessions.find({ ...base, updatedAt: { $lt: new Date(now - expireMs) } }).limit(25).toArray()
  const remind = await sessions.find({ ...base, reminded: { $ne: true }, updatedAt: { $lt: new Date(now - remindMs), $gte: new Date(now - expireMs) } }).limit(25).toArray()
  return { remind, expire }
}
async function markReminded(id) { await sessions.updateOne({ _id: id }, { $set: { reminded: true } }) }

// Pre-payment summary line: what the user will be asked for after paying.
function prePayNote(reqs, countryName, lang = 'en') {
  const t = T(lang)
  const a = analyze(reqs)
  const items = []
  if (a.address || a.textual.length) items.push(t.itemContact)
  if (a.address) items.push(a.addressScope === 'worldwide' ? t.itemAddress : t.itemAddressIn(esc(stripFlag(countryName))))
  if (a.docs.length) items.push(t.itemDocs(a.docs.length))
  return items.length ? t.prePay(items.join(', ')) : ''
}
""")

rep("""  if (text && isBtn(text, 'btnCancel')) {
    await sessions.updateOne({ _id: s._id }, { $set: { status: 'cancelled', updatedAt: new Date() } })
    return { text: t.cancelled, cancelled: true }
  }""",
"""  if (text && isBtn(text, 'btnCancel')) {
    const closed = await closeSession(s._id, 'cancelled', { cancelledAt: new Date() })
    return { text: t.cancelled(fmtAmount(s.payment?.refund)), cancelled: true, session: closed || s, refundable: !!closed }
  }""")

rep("""      if (isBtn(text, 'btnContinue')) {
        s.status = 'ready'; s.updatedAt = new Date()
        await sessions.replaceOne({ _id: s._id }, s)
        return { text: '', done: true }
      }""",
"""      if (isBtn(text, 'btnContinue')) {
        const closed = await closeSession(s._id, 'submitting', { submittedAt: new Date() })
        if (!closed) return null
        return { text: t.submitting, done: true, session: closed }
      }""")

rep("""module.exports = {
  init, getRequirements, analyze, buildSteps, startSession, handleInput, getSession, getReadySession, clearSession,
  placeRegulatedOrder, getOrder, classifyOrder, isMissingInfo, parseCountry, autoValue, T,
  REQUIREMENT_GROUP_COUNTRIES, _reqCache: reqCache,
}""",
"""module.exports = {
  init, getRequirements, analyze, buildSteps, startSession, handleInput, getSession, getIncompleteSession,
  cancelSession, closeSession, setStatus, resumePrompt, restartSession, findAbandoned, markReminded, prePayNote, fmtAmount,
  placeRegulatedOrder, getOrder, classifyOrder, isMissingInfo, parseCountry, autoValue, T, isBtn,
  REQUIREMENT_GROUP_COUNTRIES, _reqCache: reqCache,
}""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
