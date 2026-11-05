'use strict'
// "Show as" caller IDs: a customer proves they own an outside number (Telnyx Verified Numbers, code by SMS or call), pays once, then calls can display it.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps } = require('./wallet')

const PRICE = Number(process.env.RATE_CALLER_ID_VERIFY || 25)
const MAX_SENDS_PER_DAY = 25
const MAX_BATCH = 10
const MAX_PRESETS = 10
const MAX_TRIES = 5
const PENDING_MS = 15 * 60000
const DRY_CODE = '123456'
const BASE = 'https://api.telnyx.com/v2/verified_numbers'
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const E164 = /^\+[1-9]\d{7,14}$/
const clean = (n) => { const d = String(n || '').replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : `+${d}` }
const tx = (method, path = '', data) => axios({ method, url: `${BASE}${path}`, data, timeout: 20000, headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' } })
const txErr = (e) => e.response?.data?.errors?.[0]?.detail || e.message

let col = null
let dbRef = null

// The verified number this account may show, or null for "use the CloudIVR number". Throws on a number they haven't verified.
async function resolve(chatId, showAs) {
  if (!showAs) return null
  const n = clean(showAs)
  const doc = col && await col.findOne({ _id: n, chatId: String(chatId), status: 'verified' })
  if (!doc) { const e = new Error('Add that number under My numbers → Your own caller IDs before calling from it.'); e.code = 'invalid_show_as'; throw e }
  if (doc.method === 'attested' && !(await hasPaidPlan(chatId))) { const e = new Error('Showing any caller ID is a Business plan feature.'); e.code = 'invalid_show_as'; throw e }
  return n
}
const isVerified = (chatId, n) => resolve(chatId, n).then(() => true, () => false)

async function requestCode(n, method) {
  if (dry()) return
  const body = { phone_number: n, verification_method: method }
  try { await tx('post', '', body) } catch (e) {
    // Left verified on the Telnyx account (an earlier owner removed it here): clear it so a fresh code proves ownership.
    if (![409, 422].includes(e.response?.status)) throw new Error(txErr(e))
    await tx('delete', `/${encodeURIComponent(n)}`).catch(() => {})
    await tx('post', '', body).catch(e2 => { throw new Error(txErr(e2)) })
  }
}
const checkCode = async (n, code) => {
  if (dry()) return code === DRY_CODE
  return tx('post', `/${encodeURIComponent(n)}/actions/verify`, { verification_code: code }).then(() => true, () => false)
}
// Press-1 call: no code — Telnyx marks the number verified once they press 1.
const checkPressed = async (n) => {
  if (dry()) return true
  return tx('get', `/${encodeURIComponent(n)}`).then(r => !!r.data?.data?.verified_at, () => false)
}

// US mobile number bought in CloudIVR: we text ourselves the code and read it from the inbound webhook (free).
async function autoVerify(db, chatId, n) {
  const c = db.collection('webCallerIds')
  const cur = await c.findOne({ _id: n })
  if (cur?.status === 'verified' && cur.chatId === String(chatId)) return 'verified'
  if (dry()) { await c.replaceOne({ _id: n }, { _id: n, chatId: String(chatId), status: 'verified', method: 'auto', charged: 0, createdAt: Date.now(), verifiedAt: new Date() }, { upsert: true }); return 'verified' }
  await requestCode(n, 'sms')
  await c.replaceOne({ _id: n }, { _id: n, chatId: String(chatId), status: 'pending', method: 'auto', auto: true, tries: 0, createdAt: Date.now() }, { upsert: true })
  return 'pending'
}
async function autoCode(db, n, text) {
  const c = db.collection('webCallerIds')
  const d = await c.findOne({ _id: n, status: 'pending', auto: true })
  if (!d || Date.now() - d.createdAt > PENDING_MS || d.tries >= MAX_TRIES) return null
  const code = (String(text).match(/\b(\d{4,8})\b/) || [])[1]
  if (!code) return null
  if (!(await checkCode(n, code))) { await c.updateOne({ _id: n }, { $inc: { tries: 1 } }); return 'wrong' }
  await c.updateOne({ _id: n }, { $set: { status: 'verified', verifiedAt: new Date(), charged: 0 } })
  return 'verified'
}

function routes(router, { db, h, numbersApi }) {
  col = db.collection('webCallerIds')
  dbRef = db
  const sends = db.collection('webCallerIdSends')
  sends.createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {})
  col.createIndex({ chatId: 1 }).catch(() => {})
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const view = (d) => ({ number: d._id, status: d.status, method: d.method, note: d.note || null, label: d.label || null, verifiedAt: d.verifiedAt || null })

  router.get('/caller-ids', h(async (req, res) => {
    const items = (await col.find({ chatId: req.webChatId }).toArray()).sort(byOrder)
    const used = await usage30(req.webChatId)
    res.json({ price: PRICE, dryRun: dry(), items: items.filter(d => d.status === 'verified' || d.status === 'review' || Date.now() - d.createdAt < PENDING_MS).map(d => ({ ...view(d), uses30: used[d._id]?.n || 0, lastUsedAt: used[d._id]?.last || null })) })
  }))

  // Admin-review path: show a number the customer owns but can't receive a code on (main line, toll-free, call center).
  // No code; the customer attests they are authorized and an admin approves. Telnyx still filters the actual call.
  router.post('/caller-ids/request', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.body.number)
    if (!E164.test(n)) return bad(res, 400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    if (req.body.authorized !== true) return bad(res, 400, 'not_authorized', 'Confirm you are authorized to use this number as your caller ID.')
    if (await numbersApi.findMine(chatId, n)) return bad(res, 400, 'own_number', 'That is already one of your CloudIVR numbers — pick it as “Call from” instead.')
    const cur = await col.findOne({ _id: n })
    if (cur?.chatId === chatId && (cur.status === 'verified' || cur.status === 'review')) return bad(res, 400, 'already_added', cur.status === 'review' ? 'This number is already waiting for approval.' : 'This number is already on your account.')
    if (cur && cur.chatId !== chatId && (cur.status === 'verified' || cur.status === 'review' || Date.now() - cur.createdAt < PENDING_MS)) return bad(res, 409, 'number_taken', 'This number is in use on another account. Contact support if it is yours.')
    if (!(await w.debit(chatId, PRICE))) return bad(res, 402, 'insufficient_balance', `Adding a caller ID for review costs $${PRICE.toFixed(2)}, refunded if we can’t approve it. Top up your wallet first.`)
    await col.replaceOne({ _id: n }, { _id: n, chatId, status: 'review', method: 'review', charged: PRICE, note: String(req.body.note || '').slice(0, 300), createdAt: Date.now() }, { upsert: true })
    res.status(201).json({ number: n, status: 'review', charged: PRICE, message: 'Thanks — we’ll review this number and email you. It usually takes a business day.' })
  }))

  router.post('/caller-ids', h(async (req, res) => {
    const chatId = req.webChatId
    const method = ['call', 'dtmf'].includes(req.body.method) ? req.body.method : 'sms'
    const list = [...new Set((Array.isArray(req.body.numbers) ? req.body.numbers : [req.body.number]).map(clean))].filter(n => n !== '+')
    if (!list.length) return bad(res, 400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    if (list.length > MAX_BATCH) return bad(res, 400, 'too_many_numbers', `Up to ${MAX_BATCH} numbers at a time.`)
    const bal = await w.balance(chatId)
    if (bal < PRICE) return bad(res, 402, 'insufficient_balance', `Verifying a caller ID costs $${PRICE.toFixed(2)}, charged once the code is accepted. Your balance is $${bal.toFixed(2)} — top up first.`)
    const results = []
    for (const n of list) results.push({ number: n, ...(await sendOne(chatId, n, method)) })
    const sent = results.filter(r => r.ok)
    if (list.length === 1 && !sent.length) return bad(res, results[0].status, results[0].error, results[0].message)
    res.status(sent.length ? 201 : 400).json({
      number: sent[0]?.number, method, dryRun: dry(), results,
      message: method === 'dtmf' ? `We’re calling ${sent.length > 1 ? 'those numbers' : 'that number'} now — answer and press 1, then tap “I pressed 1”.` : dry() ? `Preview mode: no code was sent. Enter ${DRY_CODE}.` : sent.length > 1 ? `Codes sent to ${sent.length} numbers.` : method === 'call' ? 'We’re calling that number now — listen for the code.' : 'We texted a code to that number.',
    })
  }))

  async function sendOne(chatId, n, method) {
    const no = (status, error, message) => ({ ok: false, status, error, message })
    if (!E164.test(n)) return no(400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    if (await numbersApi.findMine(chatId, n)) return no(400, 'own_number', 'That is already one of your CloudIVR numbers — pick it as “Call from” instead.')
    const cur = await col.findOne({ _id: n })
    if (cur?.chatId === chatId && cur.status === 'verified') return no(400, 'already_verified', 'This number is already verified on your account.')
    if (cur && cur.chatId !== chatId && (cur.status === 'verified' || Date.now() - cur.createdAt < PENDING_MS)) return no(409, 'number_taken', 'This number is in use on another account. Contact support if it is yours.')
    if (await sends.countDocuments({ chatId }) >= MAX_SENDS_PER_DAY) return no(429, 'too_many_codes', 'Too many codes sent today. Try again tomorrow.')
    try { await requestCode(n, method) } catch (e) { return no(424, 'send_failed', `We couldn’t send the code: ${e.message}`) }
    await sends.insertOne({ chatId, number: n, at: new Date() })
    await col.replaceOne({ _id: n }, { _id: n, chatId, status: 'pending', method, tries: 0, createdAt: Date.now() }, { upsert: true })
    return { ok: true }
  }

  router.post('/caller-ids/verify', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.body.number), code = String(req.body.code || '').replace(/\D/g, '')
    const doc = await col.findOne({ _id: n, chatId, status: 'pending' })
    if (!doc || Date.now() - doc.createdAt > PENDING_MS) return bad(res, 400, 'no_pending', 'That code expired. Send a new one.')
    if (doc.tries >= MAX_TRIES) return bad(res, 429, 'too_many_tries', 'Too many wrong codes. Send a new one.')
    const press = doc?.method === 'dtmf'
    if (!press && !code) return bad(res, 400, 'invalid_code', 'Enter the code you received.')
    if (!(await w.debit(chatId, PRICE))) return bad(res, 402, 'insufficient_balance', `Verifying a caller ID costs $${PRICE.toFixed(2)}. Top up your wallet first.`)
    if (!(await (press ? checkPressed(n) : checkCode(n, code)))) {
      await w.credit(chatId, PRICE)
      await col.updateOne({ _id: n }, { $inc: { tries: 1 } })
      return bad(res, 400, press ? 'not_pressed' : 'wrong_code', press ? 'We haven’t seen the 1 press yet. Answer our call and press 1, then try again — or send a new call.' : 'That code didn’t match. Check it and try again.')
    }
    await col.updateOne({ _id: n }, { $set: { status: 'verified', verifiedAt: new Date(), charged: PRICE } })
    await db.collection('transactions').insertOne({ _id: `caller-id-verify-${crypto.randomUUID()}`, chatId: String(chatId), type: 'caller-id-verify', amount: PRICE, currency: 'USD', status: 'completed', metadata: { number: n, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
    res.json({ number: n, status: 'verified', charged: PRICE })
  }))

  router.delete('/caller-ids/:number', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.params.number)
    const doc = await col.findOne({ _id: n, chatId })
    if (!doc) return bad(res, 404, 'not_found', 'That caller ID isn’t on your account.')
    if (doc.status === 'review' && doc.charged) await w.credit(chatId, doc.charged) // cancelled before review → refund
    if (!dry() && doc.status !== 'review') await tx('delete', `/${encodeURIComponent(n)}`).catch(() => {})
    await col.deleteOne({ _id: n })
    await db.collection('bulkCallCampaigns').updateMany({ chatId, showAs: n }, { $unset: { showAs: '' } }).catch(() => {})
    await db.collection('callerIdDefaults').deleteMany({ chatId, showAs: n }).catch(() => {})
    await db.collection('scheduledCalls').updateMany({ chatId, 'ivrObData.displayCallerId': n }, { $set: { 'ivrObData.displayCallerId': null } }).catch(() => {})
    res.json({ ok: true })
  }))

  // Business users can show any number they state they have the right to use (no code). Admin alert.
  router.post('/caller-ids/attest', h(async (req, res) => {
    if (req.body.authorized !== true) return bad(res, 400, 'not_authorized', 'Confirm you have the right to use this number as your caller ID.')
    const r = await attest(req.webChatId, req.body.number, { who: req.webUser?.email || '', channel: 'web', label: req.body.label })
    if (!r.ok) return bad(res, r.status, r.error, r.message)
    res.status(201).json({ number: r.number, status: 'verified', method: 'attested' })
  }))
  // Rename a saved caller ID (max 24 chars; empty clears it).
  router.put('/caller-ids/:number/label', h(async (req, res) => {
    const n = clean(req.params.number)
    const label = String(req.body.label || '').trim().slice(0, 24)
    const d = await col.findOne({ _id: n, chatId: req.webChatId, status: 'verified' })
    if (!d) return bad(res, 404, 'not_found', 'That caller ID isn’t on your account.')
    await col.updateOne({ _id: n }, label ? { $set: { label } } : { $unset: { label: '' } })
    res.json({ number: n, label: label || null })
  }))
  // One-tap move to Business for the price gap only, so the user can show any caller ID.
  router.post('/caller-ids/upgrade', h(async (req, res) => {
    const mine = await numbersApi.myNumbers(req.webChatId)
    const order = ['starter', 'pro', 'business']
    const ok = mine.filter(x => x.status === 'active' && !x.isSubNumber && !x.replacedBy && [0, 1].includes(order.indexOf(x.plan))).sort((a, b) => order.indexOf(b.plan) - order.indexOf(a.plan))
    const n = req.body.number ? ok.find(x => x.phoneNumber === clean(req.body.number)) : ok[0]
    if (!n) return bad(res, 404, 'not_found', 'You have no number that can be upgraded to Business.')
    const q = numbersApi.upgradeQuote(n, 'business', 0, true)
    if (q.error) return bad(res, q.error.status, q.error.error, q.error.message)
    if (req.body.confirm !== true) return res.json({ number: n.phoneNumber, plan: n.plan, quote: q })
    const r = await numbersApi.upgradeNumber(req.webChatId, n, 'business', null, 0, true)
    res.status(r.status).json({ number: n.phoneNumber, ...r.body })
  }))
  router.get('/caller-ids/presets', h(async (req, res) => res.json({ items: await presets(req.webChatId), max: MAX_PRESETS, last: req.query?.from ? await lastFor(req.webChatId, clean(req.query.from)) : null })))
  // Hand order for saved caller IDs: numbers in the order the user wants them.
  router.put('/caller-ids/order', h(async (req, res) => {
    const list = (Array.isArray(req.body.numbers) ? req.body.numbers : []).map(clean)
    const mine = new Set((await col.find({ chatId: req.webChatId, status: 'verified' }).toArray()).map(d => d._id))
    if (!list.length || list.some(n => !mine.has(n))) return bad(res, 400, 'invalid_order', 'Send the numbers of your saved caller IDs in the order you want.')
    await Promise.all(list.map((n, i) => col.updateOne({ _id: n, chatId: req.webChatId }, { $set: { pos: i } })))
    res.json({ items: await presets(req.webChatId) })
  }))
  // Default caller ID for one of your numbers — used by SIP softphone calls (softphones can't pick a caller ID per call).
  router.get('/caller-ids/defaults', h(async (req, res) => {
    const items = await db.collection('callerIdDefaults').find({ chatId: req.webChatId }).toArray()
    res.json({ items: items.map(d => ({ number: d._id, showAs: d.showAs })) })
  }))
  router.put('/caller-ids/default', h(async (req, res) => {
    const own = clean(req.body.number)
    if (!(await numbersApi.findMine(req.webChatId, own))) return bad(res, 404, 'not_found', 'That isn’t one of your CloudIVR numbers.')
    try { await setDefault(req.webChatId, own, req.body.showAs || null) } catch (e) { return bad(res, 400, 'invalid_show_as', e.message) }
    res.json({ number: own, showAs: req.body.showAs ? clean(req.body.showAs) : null })
  }))
}

module.exports = { routes, resolve, isVerified, autoVerify, autoCode, PRICE, DRY_CODE }

// ── Attested caller IDs: a paid-plan user states they have the right to use a number (no code). Logged + admin alert. ──
const EMERGENCY = new Set(['911', '112', '999', '000', '110', '119', '933', '1911', '1112', '1999'])
const HOTLINES = { '+18008291040': 'IRS', '+18007721213': 'Social Security', '+18772758743': 'FDIC', '+18773275342': 'FDIC', '+18006334227': 'Medicare', '+18003755283': 'USCIS', '+12023243000': 'FBI', '+18009359935': 'Chase', '+18004321000': 'Bank of America', '+18008693557': 'Wells Fargo', '+18009504600': 'Citi', '+18002274825': 'Capital One', '+18888425636': 'Navy Federal', '+18889367354': 'PayPal', '+18882804331': 'Amazon', '+18002752273': 'Apple', '+18557202000': 'Zelle', '+18559667686': 'Venmo' }
const isEmergency = (raw) => EMERGENCY.has(String(raw || '').replace(/\D/g, ''))
const hasPaidPlan = async (chatId) => {
  const d = await dbRef.collection('phoneNumbersOf').findOne({ _id: String(chatId) })
  return (d?.val?.numbers || []).some(n => n.status === 'active' && n.plan === 'business')
}

// Returns { ok, number } or { ok:false, status, error, message }.
async function attest(chatId, raw, { who = '', channel = 'web', label = '' } = {}) {
  chatId = String(chatId)
  if (isEmergency(raw)) return { ok: false, status: 400, error: 'emergency_number', message: 'Emergency numbers can’t be used as a caller ID.' }
  const n = clean(raw)
  const lbl = String(label || '').trim().slice(0, 24)
  if (!E164.test(n)) return { ok: false, status: 400, error: 'invalid_number', message: 'Enter the full number with country code, e.g. +14155550100.' }
  if (!(await hasPaidPlan(chatId))) return { ok: false, status: 403, error: 'plan_required', message: 'Showing any caller ID is a Business plan feature. Upgrade to Business to use it.' }
  const cur = await col.findOne({ _id: n })
  if (cur?.chatId === chatId && cur.status === 'verified') { if (lbl) await col.updateOne({ _id: n }, { $set: { label: lbl } }); return { ok: true, number: n } }
  if (cur && cur.chatId !== chatId && (cur.status === 'verified' || cur.status === 'review')) return { ok: false, status: 409, error: 'number_taken', message: 'This number is in use on another account. Contact support if it is yours.' }
  if (await col.countDocuments({ chatId, status: 'verified' }) >= MAX_PRESETS) return { ok: false, status: 400, error: 'too_many_presets', message: `You can save up to ${MAX_PRESETS} caller IDs. Remove one to add another.` }
  await col.replaceOne({ _id: n }, { _id: n, chatId, status: 'verified', method: 'attested', attested: true, attestedAt: new Date(), channel, charged: 0, ...(lbl ? { label: lbl } : {}), createdAt: Date.now(), verifiedAt: new Date() }, { upsert: true })
  const flag = HOTLINES[n]
  require('../scam-watch').alert(`${flag ? '🚩' : '🎭'} <b>Custom caller ID added</b>${flag ? ` — matches <b>${flag}</b> hotline` : ''}\n👤 ${String(who || chatId).replace(/[<>&]/g, '')} (${chatId})\n📞 ${n} · via ${channel}\n<i>User attested they have the right to use it. Alert only.</i>`)
  return { ok: true, number: n }
}

const defaultFor = async (chatId, ownNumber) => (await dbRef?.collection('callerIdDefaults').findOne({ _id: String(ownNumber), chatId: String(chatId) }))?.showAs || null
async function setDefault(chatId, ownNumber, showAs) {
  const c = dbRef.collection('callerIdDefaults')
  if (!showAs) return c.deleteOne({ _id: String(ownNumber), chatId: String(chatId) })
  await resolve(chatId, showAs)
  return c.replaceOne({ _id: String(ownNumber) }, { _id: String(ownNumber), chatId: String(chatId), showAs: clean(showAs), at: new Date() }, { upsert: true })
}
const logUse = (chatId, showAs, via, to) => { dbRef?.collection('callerIdUses').insertOne({ chatId: String(chatId), showAs, via, to: String(to || ''), at: new Date() }).catch(() => {}); touch(chatId, showAs) }
// Last caller ID picked for calls from one VoIP number (null = its own number), so the next call starts with it.
function rememberLast(chatId, from, showAs) { dbRef?.collection('callerIdLast').replaceOne({ _id: `${chatId}:${from}` }, { _id: `${chatId}:${from}`, chatId: String(chatId), from: String(from), showAs: showAs || null, at: new Date() }, { upsert: true }).catch(() => {}) }
async function lastFor(chatId, from) {
  const d = await dbRef?.collection('callerIdLast').findOne({ _id: `${chatId}:${from}` })
  if (!d?.showAs) return null
  return (await presets(chatId)).some(p => p.number === d.showAs) ? d.showAs : null
}
// Per caller ID: calls in the last 30 days and the latest call → { '+1…': { n, last } }.
async function usage30(chatId) {
  const since = new Date(Date.now() - 30 * 86400000)
  const rows = await dbRef.collection('callerIdUses').aggregate([{ $match: { chatId: String(chatId) } }, { $group: { _id: '$showAs', n: { $sum: { $cond: [{ $gte: ['$at', since] }, 1, 0] } }, last: { $max: '$at' } } }]).toArray()
  return Object.fromEntries(rows.map(r => [r._id, { n: r.n, last: r.last }]))
}
// Hand order wins once set (pos); otherwise most recently used first.
const recent = (d) => new Date(d.lastUsedAt || d.verifiedAt || d.createdAt || 0).getTime()
const byOrder = (a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity) || recent(b) - recent(a)
const touch = (chatId, number) => { col?.updateOne({ _id: clean(number), chatId: String(chatId) }, { $set: { lastUsedAt: new Date() } }).catch(() => {}) }
// Saved caller IDs this account can pick with one tap right now (no-code ones only while on Business). Most recently used first.
async function presets(chatId) {
  if (!col) return []
  const docs = await col.find({ chatId: String(chatId), status: 'verified' }).toArray()
  const biz = docs.some(d => d.method === 'attested') && await hasPaidPlan(chatId)
  return docs.filter(d => d.method !== 'attested' || biz)
    .sort(byOrder).slice(0, MAX_PRESETS).map(d => ({ number: d._id, label: d.label || null, lastUsedAt: d.lastUsedAt || null }))
}

Object.assign(module.exports, { attest, isEmergency, defaultFor, setDefault, logUse, presets, touch, rememberLast, lastFor, usage30, hasPaidPlan, HOTLINES, MAX_PRESETS })

// Admin: approve (→ verified) or reject (→ refund + remove) a review request. Returns the affected doc or null.
function adminApi(db) {
  const c = db.collection('webCallerIds')
  const w = walletOps(db)
  const list = async () => (await c.find({ status: { $in: ['review', 'verified'] } }).sort({ createdAt: -1 }).limit(200).toArray())
    .map(d => ({ number: d._id, chatId: d.chatId, status: d.status, method: d.method || null, note: d.note || null, charged: d.charged || 0, adminApproved: !!d.adminApproved, at: new Date(d.createdAt || d.verifiedAt || Date.now()).toISOString() }))
  const approve = async (number) => {
    const d = await c.findOne({ _id: number, status: 'review' })
    if (!d) return null
    await c.updateOne({ _id: number }, { $set: { status: 'verified', adminApproved: true, verifiedAt: new Date() } })
    return d
  }
  const reject = async (number) => {
    const d = await c.findOne({ _id: number, status: 'review' })
    if (!d) return null
    if (d.charged) await w.credit(d.chatId, d.charged)
    await c.deleteOne({ _id: number })
    return d
  }
  return { list, approve, reject }
}
module.exports.adminApi = adminApi
