'use strict'
// Free test call from the landing page. The visitor confirms their email with a 6-digit code, then gets ONE
// 60-second call per email (we ring their phone with a demo menu, or they call from the browser).
// Abuse limits: 3 calls per day per device or network, one demo call per destination every 30 days.
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const phoneConfig = require('../phone-config')
const { normPhone, E164 } = require('./numbers')
const { secret, clientIp, sendMail, normEmail, EMAIL_RE } = require('./auth')

// WEB_TRYCALL_LIVE=true places real demo calls (and emails real codes) even on a dry-run preview.
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true' && process.env.WEB_TRYCALL_LIVE !== 'true'
const MAX_SECONDS = 60
const RING_SECONDS = 30
const DAILY_LIMIT = 3
const CODE_TTL_MS = 10 * 60000
const TRY_ID_BASE = 8e15 // inside the web chatId range, so engine messages for demo calls stay off Telegram
const GREETING = 'Hi, this is the CloudIVR demo line. Press 1 to hear how call forwarding works. Press 2 for voicemail. Press 3 for outbound campaigns.'
const MENU = {
  1: { action: 'message', label: 'Forwarding', message: 'With call forwarding, this caller would now ring your phone, your team, or your SIP line, anywhere in the world. Thanks for trying CloudIVR. Goodbye.' },
  2: { action: 'message', label: 'Voicemail', message: 'With voicemail, callers leave a message after your greeting and the recording lands in your CloudIVR inbox and your email. Thanks for trying CloudIVR. Goodbye.' },
  3: { action: 'message', label: 'Campaigns', message: 'With outbound campaigns, CloudIVR calls a whole list for you, plays your message, and shows you who pressed which key, live. Thanks for trying CloudIVR. Goodbye.' },
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const trySecret = () => sha(`try:${secret()}`)
const deviceOf = (req) => { const d = String(req.headers['x-civr-device'] || req.body?.deviceId || ''); return /^[a-z0-9-]{8,64}$/i.test(d) ? d : null }
const bad = (res, status, error, message) => res.status(status).json({ error, message })

function routes(router, { db, h, voiceService, telnyxApi, getTelnyxResources = () => ({}), log = console.log }) {
  const codes = db.collection('webTryCodes')
  const calls = db.collection('webTryCalls')
  const creds = db.collection('testCredentials')
  codes.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  codes.createIndex({ email: 1, createdAt: -1 }).catch(() => {})
  calls.createIndex({ email: 1 }, { unique: true }).catch(() => {})
  calls.createIndex({ ip: 1, createdAt: -1 }).catch(() => {})
  calls.createIndex({ deviceId: 1, createdAt: -1 }).catch(() => {})
  calls.createIndex({ to: 1, createdAt: -1 }).catch(() => {})

  const nextChatId = async () => {
    const r = await db.collection('webCounters').findOneAndUpdate({ _id: 'webTryId' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
    return String(TRY_ID_BASE + Number((r && r.value !== undefined ? r.value : r).seq))
  }
  const emailOf = (req) => {
    try { const c = jwt.verify(String(req.body?.token || ''), trySecret()); return c.k === 'try' ? c.email : null } catch (_) { return null }
  }

  async function limit(req, email, to) {
    if (email && await calls.findOne({ email }, { projection: { _id: 1 } })) return [409, 'already_used', 'This email has already had its free test call. Get your own number to keep calling.']
    const since = new Date(Date.now() - 86400000), device = deviceOf(req)
    const byNet = await calls.countDocuments({ ip: clientIp(req), createdAt: { $gt: since } })
    const byDevice = device ? await calls.countDocuments({ deviceId: device, createdAt: { $gt: since } }) : 0
    if (byNet >= DAILY_LIMIT || byDevice >= DAILY_LIMIT) return [429, 'daily_limit', `This device or network has used today's ${DAILY_LIMIT} free test calls. Try again tomorrow.`]
    if (to && await calls.findOne({ to, createdAt: { $gt: new Date(Date.now() - 30 * 86400000) } }, { projection: { _id: 1 } })) return [409, 'number_used', 'That phone number already had a free test call this month. Use a different number.']
    return null
  }
  function destination(raw) {
    const s = String(raw || '').trim()
    // Must start with + or 00: guessing the country of a bare number could ring someone abroad.
    const to = /^(\+|00)/.test(s) ? normPhone(s.replace(/^00/, '+')) : ''
    if (!E164.test(to)) return { err: 'Enter the phone number with + and country code, e.g. +14155550100.' }
    if (phoneConfig.isBlockedPrefix(to) || voiceService.getIvrCallRate(to) > 0.5) return { err: 'Free test calls go to standard mobile and landline numbers only.' }
    return { to }
  }
  const record = async (req, email, kind, to, extra) => {
    const doc = { _id: crypto.randomUUID(), email, kind, to, ip: clientIp(req), deviceId: deviceOf(req), dryRun: dryRun(), createdAt: new Date(), ...extra }
    try { await calls.insertOne(doc) } catch (e) { if (e.code === 11000) return null; throw e }
    return doc
  }

  router.post('/public/try/send-code', h(async (req, res) => {
    const email = normEmail(req.body.email), ip = clientIp(req)
    if (!EMAIL_RE.test(email)) return bad(res, 400, 'invalid_email', 'Enter a valid email address.')
    const lim = await limit(req, email)
    if (lim) return bad(res, ...lim)
    const hour = new Date(Date.now() - 3600000)
    if (await codes.countDocuments({ ip, createdAt: { $gt: hour } }) >= 6 || await codes.countDocuments({ email, createdAt: { $gt: hour } }) >= 3) {
      return bad(res, 429, 'too_many_codes', 'Too many codes requested. Wait a few minutes and try again.')
    }
    const code = String(crypto.randomInt(100000, 1000000)), now = Date.now()
    await codes.insertOne({ email, ip, hash: sha(`${email}:${code}`), attempts: 0, used: false, createdAt: new Date(now), expiresAt: new Date(now + CODE_TTL_MS), purgeAt: new Date(now + 3600000) })
    const sent = await sendMail(email, `Your CloudIVR code: ${code}`, `<p>Your code for a free CloudIVR test call is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>`)
      .catch(e => { log(`[CloudIVR-Web] try code email failed: ${e.message}`); return false })
    if (!sent && !dryRun()) return bad(res, 503, 'email_failed', 'We could not send the code right now. Try again in a minute.')
    res.json({ sent: true, email, ...(dryRun() ? { previewCode: code } : {}) })
  }))

  router.post('/public/try/verify', h(async (req, res) => {
    const email = normEmail(req.body.email), code = String(req.body.code || '').trim()
    const doc = await codes.findOne({ email, used: false, expiresAt: { $gt: new Date() } }, { sort: { createdAt: -1 } })
    if (!doc || doc.attempts >= 5) return bad(res, 400, 'code_expired', 'That code has expired. Request a new one.')
    if (doc.hash !== sha(`${email}:${code}`)) {
      await codes.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } })
      return bad(res, 400, 'wrong_code', 'That code is not right. Check the email and try again.')
    }
    await codes.updateOne({ _id: doc._id }, { $set: { used: true } })
    res.json({ token: jwt.sign({ email, k: 'try' }, trySecret(), { expiresIn: '20m' }), email, maxSeconds: MAX_SECONDS })
  }))

  router.post('/public/try/call-me', h(async (req, res) => {
    const email = emailOf(req)
    if (!email) return bad(res, 401, 'verify_email', 'Confirm your email first.')
    const d = destination(req.body.to)
    if (d.err) return bad(res, 400, 'invalid_number', d.err)
    const lim = await limit(req, email, d.to)
    if (lim) return bad(res, ...lim)
    const callerId = process.env.TELNYX_DEFAULT_ANI
    if (!dryRun() && !callerId) return bad(res, 503, 'unavailable', 'Free test calls are paused right now. Try again later.')
    const doc = await record(req, email, 'call_me', d.to, { chatId: await nextChatId() })
    if (!doc) return bad(res, 409, 'already_used', 'This email has already had its free test call.')
    if (!dryRun()) {
      const r = await voiceService.initiateOutboundIvrCall({ chatId: doc.chatId, callerId, targetNumber: d.to, greetingText: GREETING, menu: MENU, activeKeys: Object.keys(MENU), isTrial: true, templateName: 'CloudIVR demo', provider: 'telnyx' })
      if (r?.error || !r?.callControlId) {
        await calls.deleteOne({ _id: doc._id })
        log(`[CloudIVR-Web] free test call to ${d.to} failed: ${r?.error || 'no call id'}`)
        return bad(res, 424, 'call_failed', 'We could not place the call right now. Try again in a minute.')
      }
      await calls.updateOne({ _id: doc._id }, { $set: { callControlId: r.callControlId } })
      setTimeout(() => { Promise.resolve(telnyxApi.hangupCall(r.callControlId)).catch(() => {}) }, (RING_SECONDS + MAX_SECONDS) * 1000).unref?.()
    }
    log(`[CloudIVR-Web] free test call (we call you) → ${d.to} for ${email}${dryRun() ? ' (DRY RUN)' : ''}`)
    res.status(201).json({ id: doc._id, kind: 'call_me', to: d.to, maxSeconds: MAX_SECONDS, dryRun: dryRun() })
  }))

  router.post('/public/try/browser', h(async (req, res) => {
    const email = emailOf(req)
    if (!email) return bad(res, 401, 'verify_email', 'Confirm your email first.')
    const d = destination(req.body.to)
    if (d.err) return bad(res, 400, 'invalid_number', d.err)
    const answer = (doc, c) => ({ id: doc._id, kind: 'browser', to: doc.to, maxSeconds: MAX_SECONDS, dryRun: !!doc.dryRun, ...(c ? { login: c.sipUsername, password: c.sipPassword, callerNumber: process.env.TELNYX_DEFAULT_ANI || null } : {}) })
    // Same email reconnecting (mic prompt, page reload): hand back its unused line instead of a new one.
    const prev = await calls.findOne({ email, kind: 'browser', to: d.to, createdAt: { $gt: new Date(Date.now() - 30 * 60000) } })
    if (prev) {
      if (prev.dryRun) return res.json(answer(prev))
      const c = await creds.findOne({ sipUsername: prev.sipUsername, expired: false, callsMade: 0 })
      if (c) return res.json(answer(prev, c))
    }
    const lim = await limit(req, email, d.to)
    if (lim) return bad(res, ...lim)
    const tr = getTelnyxResources() || {}
    if (!dryRun() && !tr.sipConnectionId) return bad(res, 503, 'unavailable', 'Browser test calls are paused right now. Try the "we call you" option.')
    const chatId = await nextChatId()
    let cred = null
    if (!dryRun()) {
      const made = await telnyxApi.createSIPCredential(tr.sipConnectionId, `try_${crypto.randomBytes(6).toString('hex')}`, crypto.randomBytes(16).toString('hex'))
      if (!made?.sip_username) return bad(res, 424, 'call_failed', 'We could not set up the browser line. Try again in a minute.')
      cred = { chatId, sipUsername: made.sip_username, sipPassword: made.sip_password, credentialId: made.id || made.sip_username, callsMade: 0, maxCalls: 1, expired: false, webTest: true, allowedTo: d.to, createdAt: new Date() }
    }
    const doc = await record(req, email, 'browser', d.to, { chatId, sipUsername: cred?.sipUsername || null })
    if (!doc) return bad(res, 409, 'already_used', 'This email has already had its free test call.')
    if (cred) {
      await creds.insertOne(cred)
      if (voiceService.registerRecentTestCredential) voiceService.registerRecentTestCredential(cred.sipUsername, chatId)
    }
    log(`[CloudIVR-Web] free test call (browser) → ${d.to} for ${email}${dryRun() ? ' (DRY RUN)' : ''}`)
    res.status(201).json(answer(doc, cred))
  }))

  // Live view of a "we call you" demo: ringing → connected → ended, plus the keys pressed.
  router.get('/public/try/calls/:id', h(async (req, res) => {
    const c = await calls.findOne({ _id: String(req.params.id) })
    if (!c) return bad(res, 404, 'not_found', 'Call not found.')
    const age = (Date.now() - new Date(c.createdAt).getTime()) / 1000
    let phase, digits = []
    if (c.dryRun) {
      phase = age < 4 ? 'ringing' : age < 4 + 20 ? 'connected' : 'ended'
      if (age > 11) digits = ['1']
    } else {
      const p = c.callControlId && voiceService.getOutboundIvrPhase ? voiceService.getOutboundIvrPhase(c.callControlId) : null
      phase = !p ? (c.callControlId ? 'ended' : 'ringing') : (['initiated', 'ringing'].includes(p) ? 'ringing' : 'connected')
      const presses = await db.collection('ivrAnalytics').find({ chatId: c.chatId, direction: 'outbound' }).sort({ timestamp: 1 }).limit(10).toArray()
      digits = presses.map(x => String(x.digit))
    }
    if (age > RING_SECONDS + MAX_SECONDS + 15) phase = 'ended'
    res.json({ id: c._id, kind: c.kind, to: c.to, phase, digits, menu: Object.fromEntries(Object.entries(MENU).map(([k, v]) => [k, v.label])), dryRun: !!c.dryRun })
  }))
}

module.exports = { routes, MENU, GREETING, TRY_ID_BASE, MAX_SECONDS }
