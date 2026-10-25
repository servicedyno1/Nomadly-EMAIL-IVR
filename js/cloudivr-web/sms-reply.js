'use strict'
// "Text back": a short SMS from the owner's CloudIVR number to someone whose call was missed or declined.
// Only to people who actually called (a missed/voicemail log of the last 7 days, or a call ringing now) — so it can't be
// used to text strangers — and once per missed call. Counts as one SMS of the plan, then OVERAGE_RATE_SMS from the wallet.
const axios = require('axios')
const crypto = require('crypto')
const { ObjectId } = require('mongodb')
const phoneConfig = require('../phone-config')
const { walletOps } = require('./wallet')

const MAX = 160
const REPLY_DAYS = 7
const REPLYABLE = ['missed', 'voicemail']
const E164 = /^\+[1-9]\d{7,14}$/
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim()
const recent = (l) => Date.now() - new Date(l.timestamp).getTime() < REPLY_DAYS * 86400000
const STALE_CLAIM_MS = 120000
// A reply that is still "sending" after 2 min (crashed mid-send) no longer blocks a new one.
const replied = (l) => !!l.reply && !(l.reply.status === 'sending' && Date.now() - new Date(l.reply.at).getTime() > STALE_CLAIM_MS)
const canReply = (l) => REPLYABLE.includes(l.type) && !replied(l) && E164.test(String(l.from || '')) && recent(l)
// Which missed call each text answered: Text back stores replyTo (the call's id); "Decline with a text message" is sent
// around the time that call's log is written, so it belongs to the closest call from that caller within 2 min.
function markReplied(calls, texts) {
  const byCall = new Map()
  for (const t of texts) {
    if (t.type !== 'sms_out') continue
    if (t.replyTo) { byCall.set(String(t.replyTo), t); continue }
    const at = new Date(t.timestamp).getTime()
    let best = null, gap = STALE_CLAIM_MS + 1
    for (const l of calls) {
      if (!REPLYABLE.includes(l.type) || l.phoneNumber !== t.phoneNumber || l.from !== t.to) continue
      const g = Math.abs(new Date(l.timestamp).getTime() - at)
      if (g < gap) { gap = g; best = l }
    }
    if (best && !byCall.has(String(best._id))) byCall.set(String(best._id), t)
  }
  return calls.map(l => {
    if (replied(l)) return l
    const t = byCall.get(String(l._id))
    return { ...l, reply: t ? { text: t.body, at: t.timestamp, status: t.status } : null }
  })
}
const textsTo = (phoneLogs, phones, since, callers) => phoneLogs.find({ phoneNumber: { $in: phones }, type: 'sms_out', timestamp: { $gte: since }, ...(callers ? { to: { $in: callers } } : {}) }).toArray()
// Telnyx refuses unregistered US long codes (10DLC) and unverified toll-free numbers.
const NOT_REGISTERED = /10dlc|not registered|campaign|unverified|toll.?free verification|40010|40011|40012|40013/i

function createSmsReply({ db, voiceService, log = console.log }) {
  const phoneLogs = db.collection('phoneLogs')
  const phoneTransactions = db.collection('phoneTransactions')
  const w = walletOps(db)

  async function deliver(from, to, text) {
    try {
      const r = await axios.post('https://api.telnyx.com/v2/messages', { from, to, text, ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}) },
        { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 })
      return { id: r.data?.data?.id || null }
    } catch (e) {
      const err = e.response?.data?.errors?.[0] || {}
      log(`[SmsReply] ${from} → ${to} failed: ${err.code || ''} ${err.detail || e.message}`)
      return { error: NOT_REGISTERED.test(`${err.code} ${err.title} ${err.detail}`) ? 'This number isn’t registered for business texting yet (US numbers need 10DLC registration), so texts can’t be sent from it.' : 'The text couldn’t be sent right now. Try again in a minute.' }
    }
  }

  // → { log } | { error: [status, code, message] }
  async function send({ chatId, num, to, text, simulated = false, replyTo = null }) {
    const body = clean(text)
    if (!body) return { error: [400, 'empty', 'Type a reply or pick one.'] }
    if (body.length > MAX) return { error: [400, 'too_long', `Keep it to ${MAX} characters (one text).`] }
    if (!E164.test(String(to || ''))) return { error: [400, 'invalid_number', 'This caller’s number can’t receive texts.'] }
    if (num.capabilities?.sms === false) return { error: [400, 'no_sms', 'This number can’t send texts.'] }
    if (num.status !== 'active') return { error: [409, 'not_active', 'This number is suspended. Renew it to send texts again.'] }
    const preview = simulated || dryRun() || !!num.dryRun
    const overage = voiceService.isSmsLimitReached(num) ? phoneConfig.OVERAGE_RATE_SMS : 0
    if (overage && !(await w.debit(chatId, overage))) return { error: [402, 'insufficient_balance', `Your plan texts are used up; each extra text costs $${overage.toFixed(2)}. Top up first.`] }
    const out = preview ? { id: `preview-${crypto.randomUUID()}` } : await deliver(num.phoneNumber, to, body)
    if (out.error) { if (overage) await w.credit(chatId, overage); return { error: [424, 'sms_failed', out.error] } }
    await voiceService.incrementSmsUsed(chatId, num.phoneNumber)
    if (overage) await phoneTransactions.insertOne({ chatId, phoneNumber: num.phoneNumber, action: 'sms_reply', amount: overage, paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
    const doc = { phoneNumber: num.phoneNumber, from: num.phoneNumber, to, type: 'sms_out', direction: 'outbound', body, messageId: out.id, status: preview ? 'preview' : 'sent', webReply: true, ...(replyTo ? { replyTo } : {}), timestamp: new Date().toISOString() }
    await phoneLogs.insertOne(doc)
    log(`[SmsReply] ${num.phoneNumber} → ${to}${preview ? ' (PREVIEW)' : ''}${overage ? ` $${overage}` : ''}`)
    return { log: doc, charge: overage }
  }

  return { send, canReply, MAX }
}

function routes(router, { db, h, numbersApi, smsReply }) {
  const phoneLogs = db.collection('phoneLogs')
  const view = (l) => ({ id: String(l._id), phone: l.phoneNumber, from: l.from, type: l.type, timestamp: l.timestamp, reply: l.reply || null, canReply: canReply(l) })

  router.get('/missed-calls', h(async (req, res) => {
    const phones = (await numbersApi.myNumbers(req.webChatId)).map(n => n.phoneNumber)
    const since = new Date(Date.now() - REPLY_DAYS * 86400000).toISOString()
    const rows = phones.length ? await phoneLogs.find({ phoneNumber: { $in: phones }, type: { $in: REPLYABLE }, timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(30).toArray() : []
    const texts = rows.length ? await textsTo(phoneLogs, phones, since, [...new Set(rows.map(r => r.from))]) : []
    res.json({ calls: markReplied(rows, texts).map(view), maxLength: MAX, overageRate: phoneConfig.OVERAGE_RATE_SMS })
  }))

  router.post('/missed-calls/:id/reply', h(async (req, res) => {
    let _id
    try { _id = new ObjectId(String(req.params.id)) } catch (_) { return bad(res, 404, 'not_found', 'Call not found.') }
    const l = await phoneLogs.findOne({ _id })
    const num = l && await numbersApi.findMine(req.webChatId, l.phoneNumber)
    if (!num) return bad(res, 404, 'not_found', 'Call not found.')
    // Same caller's other calls around then, so a "decline with text" is matched to the right call.
    const t0 = new Date(l.timestamp).getTime()
    const near = await phoneLogs.find({ phoneNumber: l.phoneNumber, from: l.from, type: { $in: REPLYABLE }, timestamp: { $gte: new Date(t0 - 2 * STALE_CLAIM_MS).toISOString() } }).toArray()
    const texts = await textsTo(phoneLogs, [l.phoneNumber], new Date(t0 - STALE_CLAIM_MS).toISOString(), [l.from])
    const marked = markReplied(near.some(x => String(x._id) === String(_id)) ? near : [...near, l], texts).find(x => String(x._id) === String(_id))
    if (marked.reply) return bad(res, 409, 'already_replied', 'You already texted this caller back.')
    if (!canReply(l)) return bad(res, 400, 'cannot_reply', `You can text back missed callers for ${REPLY_DAYS} days.`)
    // Claim first so two tabs can't both send.
    const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
    const claim = await phoneLogs.updateOne({ _id, $or: [{ reply: { $exists: false } }, { reply: null }, { 'reply.status': 'sending', 'reply.at': { $lt: stale } }] }, { $set: { reply: { status: 'sending', at: new Date().toISOString() } } })
    if (!claim.modifiedCount) return bad(res, 409, 'already_replied', 'You already texted this caller back.')
    const r = await smsReply.send({ chatId: req.webChatId, num, to: l.from, text: req.body?.text, replyTo: String(_id) })
    if (r.error) { await phoneLogs.updateOne({ _id }, { $unset: { reply: '' } }); return bad(res, ...r.error) }
    const reply = { text: r.log.body, at: r.log.timestamp, status: r.log.status }
    await phoneLogs.updateOne({ _id }, { $set: { reply } })
    res.json({ reply, charge: r.charge })
  }))
}

module.exports = { createSmsReply, routes, canReply, markReplied, clean, MAX }
