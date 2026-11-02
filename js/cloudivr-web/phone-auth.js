'use strict'
// Phone sign-up / sign-in: a one-time code by SMS (or a voice call reading it) through Telesign Verify.
// One account per phone number. Preview (dry run) numbers +1555xxxxxxx are simulated and return the code.
const crypto = require('crypto')
const axios = require('axios')

const E164 = /^\+[1-9]\d{7,14}$/
const TTL_MS = 5 * 60000
const MAX_TRIES = 5
const normPhone = (p) => { const s = String(p || '').replace(/[\s().-]/g, '').replace(/^00/, '+'); return E164.test(s) ? s : null }
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const simulated = (phone) => process.env.WEB_CLOUDIVR_DRY_RUN === 'true' && /^\+1555\d{7}$/.test(phone)
const configured = () => !!(process.env.TELESIGN_CUSTOMER_ID && process.env.TELESIGN_API_KEY)

function telesign(path, form) {
  const auth = Buffer.from(`${process.env.TELESIGN_CUSTOMER_ID}:${process.env.TELESIGN_API_KEY}`).toString('base64')
  return axios.post(`https://rest-ww.telesign.com${path}`, new URLSearchParams(form).toString(), { timeout: 15000, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }).then(r => r.data)
}

// Voice codes need Telesign's call product; a bad-number probe answers 401 when it's off (nothing is sent or charged).
let voiceCache = { at: 0, on: false }
async function voiceEnabled() {
  if (!configured()) return false
  if (Date.now() - voiceCache.at < 3600000) return voiceCache.on
  let on = false
  try { await telesign('/v1/verify/call', { phone_number: '1555', verify_code: '12345' }) } catch (e) { on = e.response?.status === 400 }
  voiceCache = { at: Date.now(), on }
  return on
}

function createPhoneAuth(db, { accounts, createAccount, finishLogin, lockState, recordFailure, clientIp, countryOf, referrerFor, log, publicAccount, sendMail, normEmail, EMAIL_RE, onEmailChange }) {
  const challenges = db.collection('webPhoneChallenges')
  challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  accounts.createIndex({ phone: 1 }, { unique: true, name: 'phone_partial', partialFilterExpression: { phone: { $type: 'string' } } }).catch(e => log(`[CloudIVR-Web] phone index: ${e.message}`))
  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  async function start(phone, channel) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
    if (simulated(phone)) return { ref: null, codeHash: sha(code), previewCode: code }
    const r = await telesign(channel === 'voice' ? '/v1/verify/call' : '/v1/verify/sms', { phone_number: phone.slice(1), verify_code: code })
    return { ref: r?.reference_id || null, codeHash: sha(code) }
  }

  // Sends a code to a phone and stores the challenge (extra: { linkTo } when adding a phone to a signed-in account).
  async function sendPhoneCode(req, res, phone, channel, extra = {}) {
    if (!phone) return bad(res, 400, 'invalid_phone', 'Enter your number with the country code, like +44 7700 900123.')
    if (!configured() && !simulated(phone)) return bad(res, 503, 'phone_not_configured', 'Phone sign-in is not available yet. Use email or Google.')
    if (channel === 'voice' && !simulated(phone) && !(await voiceEnabled())) return bad(res, 400, 'voice_unavailable', 'Calls with the code aren’t available yet. Tap “Text me again” instead.')
    const ipKey = `phone-send|${clientIp(req)}`, phoneKey = `phone-send|${phone}`
    if ((await lockState(ipKey)) || (await lockState(phoneKey))) return bad(res, 429, 'too_many_codes', 'Too many codes asked for. Wait 15 minutes and try again.')
    await recordFailure(ipKey, 30)
    await recordFailure(phoneKey, 5)
    let s
    try { s = await start(phone, channel) } catch (e) {
      log(`[CloudIVR-Web] Telesign ${channel} failed: ${e.response?.status || ''} ${JSON.stringify(e.response?.data?.status || e.message)}`)
      return bad(res, 502, 'send_failed', channel === 'voice' ? 'We couldn’t place the call. Check the number and try again.' : 'We couldn’t send the text. Check the number, or ask for a call instead.')
    }
    const id = crypto.randomBytes(16).toString('hex')
    await challenges.insertOne({ _id: id, phone, channel, ref: s.ref, codeHash: s.codeHash, ...extra, tries: 0, used: false, expiresAt: new Date(Date.now() + TTL_MS), createdAt: new Date() })
    res.json({ challenge: id, channel, expiresIn: TTL_MS / 1000, ...(s.previewCode ? { previewCode: s.previewCode } : {}) })
  }

  // Checks a code once (tries counted atomically). Returns the used challenge, or sends the error and returns null.
  async function useCode(req, res, filter) {
    const code = String(req.body.code || '').replace(/\D/g, '')
    if (code.length < 3 || code.length > 10) { bad(res, 400, 'invalid_code', 'Enter the code we sent you.'); return null }
    const c = await challenges.findOneAndUpdate({ _id: String(req.body.challenge || ''), ...filter, used: false, tries: { $lt: MAX_TRIES }, expiresAt: { $gt: new Date() } }, { $inc: { tries: 1 } }, { returnDocument: 'before' }).then(r => (r && r.value !== undefined ? r.value : r))
    if (!c) { bad(res, 400, 'code_expired', 'This code has expired. Ask for a new one.'); return null }
    if (sha(code) !== c.codeHash) { bad(res, 401, 'wrong_code', c.tries + 1 >= MAX_TRIES ? 'Wrong code. Ask for a new one.' : 'Wrong code. Try again.'); return null }
    const r = await challenges.findOneAndUpdate({ _id: c._id, used: false }, { $set: { used: true } })
    if (!(r && r.value !== undefined ? r.value : r)) { bad(res, 400, 'code_expired', 'This code was already used. Ask for a new one.'); return null }
    return c
  }
  const takenBy = async (field, value, me) => { const o = await accounts.findOne({ [field]: value }, { projection: { _id: 1 } }); return o && String(o._id) !== String(me) }

  function routes(router, h, requireUser) {
    router.post('/auth/phone/start', h(async (req, res) => sendPhoneCode(req, res, normPhone(req.body.phone), req.body.channel === 'voice' ? 'voice' : 'sms')))

    router.post('/auth/phone/verify', h(async (req, res) => {
      const c = await useCode(req, res, { linkTo: { $exists: false }, phone: { $exists: true } })
      if (!c) return
      const ip = clientIp(req)
      let acc = await accounts.findOne({ phone: c.phone })
      if (!acc) {
        try { acc = await createAccount({ phone: c.phone, name: String(req.body.name || '').trim() || null, referredBy: await referrerFor(req.body.ref, ip), ip, country: countryOf(req) }) } catch (e) {
          if (e.code !== 11000) throw e
          acc = await accounts.findOne({ phone: c.phone })
        }
      }
      if (acc.disabled) return bad(res, 403, 'disabled', 'This account is disabled.')
      await accounts.updateOne({ _id: acc._id }, { $set: { lastLoginAt: new Date(), lastIp: ip, phoneVerifiedAt: new Date() } })
      return finishLogin(req, res, acc, { remember: !!req.body.remember })
    }))

    // Signed in: add (or change) the account's phone — a code proves it, then it works for phone sign-in.
    router.post('/account/phone/start', requireUser, h(async (req, res) => {
      const phone = normPhone(req.body.phone)
      if (phone && await takenBy('phone', phone, req.webChatId)) return bad(res, 409, 'phone_taken', 'This number is already used by another CloudIVR account.')
      return sendPhoneCode(req, res, phone, req.body.channel === 'voice' ? 'voice' : 'sms', { linkTo: String(req.webChatId) })
    }))
    router.post('/account/phone/verify', requireUser, h(async (req, res) => {
      const c = await useCode(req, res, { linkTo: String(req.webChatId), phone: { $exists: true } })
      if (!c) return
      if (await takenBy('phone', c.phone, req.webChatId)) return bad(res, 409, 'phone_taken', 'This number is already used by another CloudIVR account.')
      await accounts.updateOne({ _id: req.webUser._id }, { $set: { phone: c.phone, phoneVerifiedAt: new Date() } })
      res.json({ account: publicAccount(await accounts.findOne({ _id: req.webUser._id })) })
    }))

    // Signed in without an email (phone accounts): add one. A code is emailed; the eSIM provider record moves to it.
    router.post('/account/email/start', requireUser, h(async (req, res) => {
      const email = normEmail(req.body.email)
      if (!EMAIL_RE.test(email)) return bad(res, 400, 'invalid_email', 'Enter a valid email address.')
      if (await takenBy('email', email, req.webChatId)) return bad(res, 409, 'email_taken', 'This email is already used by another CloudIVR account.')
      const key = `email-link|${req.webChatId}`
      if (await lockState(key)) return bad(res, 429, 'too_many_codes', 'Too many codes asked for. Wait 15 minutes and try again.')
      await recordFailure(key, 5)
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
      const preview = process.env.WEB_CLOUDIVR_DRY_RUN === 'true' && /@example\.(com|org|net)$/.test(email)
      if (!preview && !(await sendMail(email, 'Your CloudIVR email code', `<p>Your code to add this email to CloudIVR is <b style="font-size:20px;letter-spacing:3px">${code}</b>.</p><p>It expires in 5 minutes. If you didn’t ask for it, ignore this email.</p>`).catch(() => false))) return bad(res, 502, 'send_failed', 'We couldn’t send the email right now. Try again in a few minutes.')
      const id = crypto.randomBytes(16).toString('hex')
      await challenges.insertOne({ _id: id, email, linkTo: String(req.webChatId), codeHash: sha(code), tries: 0, used: false, expiresAt: new Date(Date.now() + TTL_MS), createdAt: new Date() })
      res.json({ challenge: id, expiresIn: TTL_MS / 1000, ...(preview ? { previewCode: code } : {}) })
    }))
    router.post('/account/email/verify', requireUser, h(async (req, res) => {
      const c = await useCode(req, res, { linkTo: String(req.webChatId), email: { $exists: true } })
      if (!c) return
      if (await takenBy('email', c.email, req.webChatId)) return bad(res, 409, 'email_taken', 'This email is already used by another CloudIVR account.')
      await accounts.updateOne({ _id: req.webUser._id }, { $set: { email: c.email, emailVerifiedAt: new Date() } })
      onEmailChange(req.webChatId).catch(e => log(`[CloudIVR-Web] email change sync: ${e.message}`))
      res.json({ account: publicAccount(await accounts.findOne({ _id: req.webUser._id })) })
    }))
  }

  return { routes, voiceEnabled }
}

// Plain text message (e.g. renewal reminders for phone-only accounts). Preview never sends.
async function sendText(phone, message) {
  if (process.env.WEB_CLOUDIVR_DRY_RUN === 'true' || !configured()) return false
  await telesign('/v1/messaging', { phone_number: String(phone).replace(/^\+/, ''), message, message_type: 'ARN' })
  return true
}

module.exports = { createPhoneAuth, normPhone, voiceEnabled, sendText }
