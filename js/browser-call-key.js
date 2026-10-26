'use strict'
// Signed SIP header the CloudIVR browser phone adds to its calls. Plans with the browser phone but no SIP apps (Starter)
// can call from the browser while desk phones and softphone apps on the same login are refused.
const crypto = require('crypto')

const HEADER = 'X-Civr-Browser'
const TTL_MS = 24 * 3600000

const secret = () => {
  const s = process.env.WEB_SESSION_SECRET || process.env.SESSION_SECRET
  if (!s) throw new Error('WEB_SESSION_SECRET / SESSION_SECRET is not configured')
  return crypto.createHash('sha256').update(`civr-browser-call:${s}`).digest()
}
const digits = (p) => String(p || '').replace(/\D/g, '')
const sign = (phone, exp) => crypto.createHmac('sha256', secret()).update(`${digits(phone)}.${exp}`).digest('hex').slice(0, 32)

function mint(phone, now = Date.now()) {
  const exp = now + TTL_MS
  return { name: HEADER, value: `${exp}.${sign(phone, exp)}`, expiresAt: new Date(exp).toISOString() }
}

function valid(phone, value, now = Date.now()) {
  const [exp, sig] = String(value || '').split('.')
  const e = Number(exp)
  if (!sig || !Number.isFinite(e) || e < now || e > now + TTL_MS + 60000) return false
  const want = sign(phone, e)
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))
}

// Telnyx call.initiated lists the INVITE's X- headers as custom_headers [{ name, value }].
const fromPayload = (payload) => (payload?.custom_headers || []).find(h => String(h?.name || '').toLowerCase() === HEADER.toLowerCase())?.value || null

module.exports = { HEADER, TTL_MS, mint, valid, fromPayload }
