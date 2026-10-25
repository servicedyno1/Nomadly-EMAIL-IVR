'use strict'
// Telnyx signs every webhook with Ed25519 over `${telnyx-timestamp}|${raw body}`; the account key is in Mission Control →
// Keys & Credentials → Public Key (TELNYX_PUBLIC_KEY, base64 of the 32 raw bytes). Unsigned, forged or stale events are refused.
const crypto = require('crypto')

const MAX_SKEW_S = 300
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function keyFrom(b64) {
  const raw = Buffer.from(String(b64 || '').trim(), 'base64')
  if (raw.length !== 32) throw new Error(`TELNYX_PUBLIC_KEY must decode to 32 bytes (got ${raw.length})`)
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

const one = (v) => (Array.isArray(v) ? v[0] : v)

function verify({ headers = {}, rawBody }, key, nowMs = Date.now()) {
  const sig = one(headers['telnyx-signature-ed25519'])
  const ts = String(one(headers['telnyx-timestamp']) || '')
  if (!sig || !/^\d{1,12}$/.test(ts) || !rawBody?.length) return false
  if (Math.abs(nowMs / 1000 - Number(ts)) > MAX_SKEW_S) return false
  const s = Buffer.from(String(sig), 'base64')
  if (s.length !== 64) return false
  try {
    return crypto.verify(null, Buffer.concat([Buffer.from(`${ts}|`), rawBody]), key, s)
  } catch (_) {
    return false
  }
}

// Express middleware. Passes everything (and says so once at boot) without TELNYX_PUBLIC_KEY (brands not set up yet) or in
// dry-run previews, where no real Telnyx traffic arrives and the test suites post simulated events.
function middleware(log = console.log) {
  if (!process.env.TELNYX_PUBLIC_KEY || process.env.WEB_CLOUDIVR_DRY_RUN === 'true') {
    log(`[TelnyxSig] ⚠️ Telnyx webhooks are NOT signature-checked (${process.env.TELNYX_PUBLIC_KEY ? 'dry-run preview' : 'TELNYX_PUBLIC_KEY not set'})`)
    return (req, res, next) => next()
  }
  const key = keyFrom(process.env.TELNYX_PUBLIC_KEY)
  log('[TelnyxSig] Telnyx webhook signatures enforced')
  return (req, res, next) => {
    if (verify(req, key)) return next()
    log(`[TelnyxSig] refused ${req.path}: missing, stale or invalid Telnyx signature`)
    res.status(403).json({ error: 'invalid_signature' })
  }
}

module.exports = { verify, keyFrom, middleware, MAX_SKEW_S }
