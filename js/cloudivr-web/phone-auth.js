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

function createPhoneAuth(db, { accounts, createAccount, finishLogin, lockState, recordFailure, clientIp, countryOf, referrerFor, log }) {
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

  function routes(router, h) {
    router.post('/auth/phone/start', h(async (req, res) => {
      const phone = normPhone(req.body.phone), channel = req.body.channel === 'voice' ? 'voice' : 'sms'
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
      await challenges.insertOne({ _id: id, phone, channel, ref: s.ref, codeHash: s.codeHash || null, tries: 0, used: false, expiresAt: new Date(Date.now() + TTL_MS), createdAt: new Date() })
      res.json({ challenge: id, channel, expiresIn: TTL_MS / 1000, ...(s.previewCode ? { previewCode: s.previewCode } : {}) })
    }))

    router.post('/auth/phone/verify', h(async (req, res) => {
      const code = String(req.body.code || '').replace(/\D/g, '')
      if (code.length < 3 || code.length > 10) return bad(res, 400, 'invalid_code', 'Enter the code we sent you.')
      const c = await challenges.findOneAndUpdate({ _id: String(req.body.challenge || ''), used: false, tries: { $lt: MAX_TRIES }, expiresAt: { $gt: new Date() } }, { $inc: { tries: 1 } }, { returnDocument: 'before' }).then(r => (r && r.value !== undefined ? r.value : r))
      if (!c) return bad(res, 400, 'code_expired', 'This code has expired. Ask for a new one.')
      const ok = sha(code) === c.codeHash
      if (!ok) return bad(res, 401, 'wrong_code', c.tries + 1 >= MAX_TRIES ? 'Wrong code. Ask for a new one.' : 'Wrong code. Try again.')
      const r = await challenges.findOneAndUpdate({ _id: c._id, used: false }, { $set: { used: true } })
      if (!(r && r.value !== undefined ? r.value : r)) return bad(res, 400, 'code_expired', 'This code was already used. Ask for a new one.')
      const ip = clientIp(req)
      let acc = await accounts.findOne({ phone: c.phone })
      if (!acc) {
        try { acc = await createAccount({ phone: c.phone, name: req.body.name, referredBy: await referrerFor(req.body.ref, ip), ip, country: countryOf(req) }) } catch (e) {
          if (e.code !== 11000) throw e
          acc = await accounts.findOne({ phone: c.phone })
        }
      }
      if (acc.disabled) return bad(res, 403, 'disabled', 'This account is disabled.')
      await accounts.updateOne({ _id: acc._id }, { $set: { lastLoginAt: new Date(), lastIp: ip, phoneVerifiedAt: new Date() } })
      return finishLogin(req, res, acc, { remember: !!req.body.remember })
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
