'use strict'
// Missed-call text-back (opt-in per number): when a call is missed, the caller gets one text from the business number.
// Sent through sms-reply, so the normal rules apply (texting approved on the number, 10DLC, STOP list, plan texts / wallet).
// At most one text per caller per number per 24 h.
const { isWebChatId } = require('./notify')
const DEFAULT_TEXT = 'Sorry we missed your call. We’ll call you back as soon as we can.'
const E164 = /^\+[1-9]\d{7,14}$/
let ctx = null

function init({ db, smsReply, numbersApi, log = console.log }) {
  ctx = { db, smsReply, numbersApi, log, col: db.collection('missedTextBacks') }
  ctx.col.createIndex({ at: 1 }, { expireAfterSeconds: 86400 }).catch(() => {})
}

async function onMissed({ chatId, num, from }) {
  const cfg = num?.features?.missedTextBack
  if (!ctx || !cfg?.enabled || !isWebChatId(chatId) || !E164.test(String(from || ''))) return null
  const key = `${num.phoneNumber}|${from}`
  try { await ctx.col.insertOne({ _id: key, chatId: String(chatId), at: new Date() }) } catch (e) { if (e.code === 11000) return null; throw e }
  const r = await ctx.smsReply.send({ chatId: String(chatId), num, to: from, text: cfg.text || DEFAULT_TEXT })
  if (r.error) {
    ctx.log(`[TextBack] ${num.phoneNumber} → ${from} not sent: ${r.error[2]}`)
    const day = new Date().toISOString().slice(0, 10)
    const first = await ctx.col.insertOne({ _id: `fail|${num.phoneNumber}|${day}`, chatId: String(chatId), at: new Date() }).then(() => true, () => false)
    if (first) await ctx.db.collection('webNotifications').insertOne({ chatId: String(chatId), text: `Missed-call text to ${from} wasn’t sent: ${r.error[2]}`, kind: 'sms', read: false, createdAt: new Date() }).catch(() => {})
    return r
  }
  ctx.log(`[TextBack] ${num.phoneNumber} → ${from} sent`)
  return r
}

function routes(router, { h, numbersApi }) {
  router.put('/numbers/:phone/missed-text-back', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return res.status(404).json({ error: 'not_found', message: 'Number not found on your account.' })
    if (num.capabilities?.sms === false) return res.status(400).json({ error: 'no_sms', message: 'This number can’t send texts.' })
    const text = String(req.body?.text || '').trim().slice(0, 300)
    const value = { enabled: !!req.body?.enabled, text: text || DEFAULT_TEXT }
    await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.missedTextBack', value)
    res.json({ missedTextBack: value })
  }))
}

module.exports = { init, onMissed, routes, DEFAULT_TEXT }
