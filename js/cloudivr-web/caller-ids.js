'use strict'
// "Show as" caller IDs: a customer proves they own an outside number (Telnyx Verified Numbers, code by SMS or call), pays once, then calls can display it.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps } = require('./wallet')

const PRICE = Number(process.env.RATE_CALLER_ID_VERIFY || 25)
const MAX_SENDS_PER_DAY = 8
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

function routes(router, { db, h, numbersApi }) {
  col = db.collection('webCallerIds')
  const sends = db.collection('webCallerIdSends')
  sends.createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {})
  col.createIndex({ chatId: 1 }).catch(() => {})
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const view = (d) => ({ number: d._id, status: d.status, method: d.method, verifiedAt: d.verifiedAt || null })

  router.get('/caller-ids', h(async (req, res) => {
    const items = await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).toArray()
    res.json({ price: PRICE, dryRun: dry(), items: items.filter(d => d.status === 'verified' || Date.now() - d.createdAt < PENDING_MS).map(view) })
  }))

  router.post('/caller-ids', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.body.number)
    const method = req.body.method === 'call' ? 'call' : 'sms'
    if (!E164.test(n)) return bad(res, 400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    if (await numbersApi.findMine(chatId, n)) return bad(res, 400, 'own_number', 'That is already one of your CloudIVR numbers — pick it as “Call from” instead.')
    const cur = await col.findOne({ _id: n })
    if (cur?.chatId === chatId && cur.status === 'verified') return bad(res, 400, 'already_verified', 'This number is already verified on your account.')
    if (cur && cur.chatId !== chatId && (cur.status === 'verified' || Date.now() - cur.createdAt < PENDING_MS)) return bad(res, 409, 'number_taken', 'This number is in use on another account. Contact support if it is yours.')
    const bal = await w.balance(chatId)
    if (bal < PRICE) return bad(res, 402, 'insufficient_balance', `Verifying a caller ID costs $${PRICE.toFixed(2)}, charged once the code is accepted. Your balance is $${bal.toFixed(2)} — top up first.`)
    if (await sends.countDocuments({ chatId }) >= MAX_SENDS_PER_DAY) return bad(res, 429, 'too_many_codes', 'Too many codes sent today. Try again tomorrow.')
    try { await requestCode(n, method) } catch (e) { return bad(res, 424, 'send_failed', `We couldn’t send the code: ${e.message}`) }
    await sends.insertOne({ chatId, number: n, at: new Date() })
    await col.replaceOne({ _id: n }, { _id: n, chatId, status: 'pending', method, tries: 0, createdAt: Date.now() }, { upsert: true })
    res.status(201).json({ number: n, method, dryRun: dry(), message: dry() ? `Preview mode: no code was sent. Enter ${DRY_CODE}.` : method === 'call' ? 'We’re calling that number now — listen for the code.' : 'We texted a code to that number.' })
  }))

  router.post('/caller-ids/verify', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.body.number), code = String(req.body.code || '').replace(/\D/g, '')
    const doc = await col.findOne({ _id: n, chatId, status: 'pending' })
    if (!doc || Date.now() - doc.createdAt > PENDING_MS) return bad(res, 400, 'no_pending', 'That code expired. Send a new one.')
    if (doc.tries >= MAX_TRIES) return bad(res, 429, 'too_many_tries', 'Too many wrong codes. Send a new one.')
    if (!code) return bad(res, 400, 'invalid_code', 'Enter the code you received.')
    if (!(await w.debit(chatId, PRICE))) return bad(res, 402, 'insufficient_balance', `Verifying a caller ID costs $${PRICE.toFixed(2)}. Top up your wallet first.`)
    if (!(await checkCode(n, code))) {
      await w.credit(chatId, PRICE)
      await col.updateOne({ _id: n }, { $inc: { tries: 1 } })
      return bad(res, 400, 'wrong_code', 'That code didn’t match. Check it and try again.')
    }
    await col.updateOne({ _id: n }, { $set: { status: 'verified', verifiedAt: new Date(), charged: PRICE } })
    await db.collection('transactions').insertOne({ _id: `caller-id-verify-${crypto.randomUUID()}`, chatId: String(chatId), type: 'caller-id-verify', amount: PRICE, currency: 'USD', status: 'completed', metadata: { number: n, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
    res.json({ number: n, status: 'verified', charged: PRICE })
  }))

  router.delete('/caller-ids/:number', h(async (req, res) => {
    const chatId = req.webChatId, n = clean(req.params.number)
    const doc = await col.findOne({ _id: n, chatId })
    if (!doc) return bad(res, 404, 'not_found', 'That caller ID isn’t on your account.')
    if (!dry()) await tx('delete', `/${encodeURIComponent(n)}`).catch(() => {})
    await col.deleteOne({ _id: n })
    await db.collection('bulkCallCampaigns').updateMany({ chatId, showAs: n }, { $unset: { showAs: '' } }).catch(() => {})
    await db.collection('scheduledCalls').updateMany({ chatId, 'ivrObData.displayCallerId': n }, { $set: { 'ivrObData.displayCallerId': null } }).catch(() => {})
    res.json({ ok: true })
  }))
}

module.exports = { routes, resolve, isVerified, PRICE, DRY_CODE }
