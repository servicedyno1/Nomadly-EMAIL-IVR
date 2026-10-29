'use strict'
// "Show as" caller IDs: a customer proves they own an outside number (Telnyx Verified Numbers, code by SMS or call), pays once, then calls can display it.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps } = require('./wallet')

const PRICE = Number(process.env.RATE_CALLER_ID_VERIFY || 25)
const MAX_SENDS_PER_DAY = 25
const MAX_BATCH = 10
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

// The verified number this account may show, or null for "use the CloudIVR number". Throws on a number they haven't verified.
async function resolve(chatId, showAs) {
  if (!showAs) return null
  const n = clean(showAs)
  const doc = col && await col.findOne({ _id: n, chatId: String(chatId), status: 'verified' })
  if (!doc) { const e = new Error('Verify that number under My numbers → Your own caller IDs before calling from it.'); e.code = 'invalid_show_as'; throw e }
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

function routes(router, { db, h, numbersApi }) {
  col = db.collection('webCallerIds')
  const sends = db.collection('webCallerIdSends')
  sends.createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {})
  col.createIndex({ chatId: 1 }).catch(() => {})
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const view = (d) => ({ number: d._id, status: d.status, method: d.method, note: d.note || null, verifiedAt: d.verifiedAt || null })

  router.get('/caller-ids', h(async (req, res) => {
    const items = await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).toArray()
    res.json({ price: PRICE, dryRun: dry(), items: items.filter(d => d.status === 'verified' || d.status === 'review' || Date.now() - d.createdAt < PENDING_MS).map(view) })
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
    await db.collection('scheduledCalls').updateMany({ chatId, 'ivrObData.displayCallerId': n }, { $set: { 'ivrObData.displayCallerId': null } }).catch(() => {})
    res.json({ ok: true })
  }))
}

module.exports = { routes, resolve, isVerified, PRICE, DRY_CODE }

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
