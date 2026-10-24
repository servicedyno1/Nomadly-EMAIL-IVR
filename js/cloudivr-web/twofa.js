'use strict'
// Two-step sign-in for web accounts: authenticator app (TOTP, RFC 6238) or a 6-digit code by email, 8 one-time
// backup codes, and "remember this browser for 30 days" (trusted-browser cookie, revoked by trustVersion).
const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const TRUST_COOKIE = 'civr_trust'
const TRUST_DAYS = 30
const CHALLENGE_MIN = 10
const EMAIL_CODE_MIN = 10
const MAX_TRIES = 5
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const digits = (s) => String(s || '').replace(/\D/g, '')

function b32encode(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) {
    val = ((val << 8) | b) & 0xffff; bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  return bits > 0 ? out + B32[(val << (5 - bits)) & 31] : out
}
function b32decode(s) {
  let bits = 0, val = 0
  const out = []
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = ((val << 5) | B32.indexOf(c)) & 0xffff; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
function hotp(key, counter) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', key).update(b).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0')
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
// Time step the code belongs to (±30 s drift allowed), or null.
function totpStep(secretB32, code, now = Date.now()) {
  const c = digits(code)
  if (c.length !== 6) return null
  const key = b32decode(secretB32), t = Math.floor(now / 30000)
  for (const d of [0, -1, 1]) if (same(hotp(key, t + d), c)) return t + d
  return null
}

function createTwoFactor({ db, secret, sendMail, setSession, publicAccount, lockState, recordFailure, isHttps, parseCookies, log = console.log }) {
  const accounts = db.collection('webAccounts')
  const codes = db.collection('webTwoFactorCodes')
  codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  const key = () => crypto.createHash('sha256').update(`cloudivr-2fa:${secret()}`).digest()
  const seal = (txt) => {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv)
    const d = Buffer.concat([c.update(txt, 'utf8'), c.final()])
    return [iv, c.getAuthTag(), d].map(x => x.toString('base64')).join('.')
  }
  const unseal = (s) => {
    const [iv, tag, d] = String(s).split('.').map(x => Buffer.from(x, 'base64'))
    const c = crypto.createDecipheriv('aes-256-gcm', key(), iv)
    c.setAuthTag(tag)
    return Buffer.concat([c.update(d), c.final()]).toString('utf8')
  }
  const cookie = (req, name, value, days) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(days * 86400)}${isHttps(req) ? '; Secure' : ''}`
  const addCookie = (res, c) => { const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), c]) }
  const brand = () => process.env.CHAT_BOT_BRAND || 'CloudIVR'

  const trusted = (req, acc) => {
    try {
      const c = jwt.verify(parseCookies(req)[TRUST_COOKIE] || '', secret())
      return c.typ === 'trust' && Number(c.sub) === acc._id && c.tv === (acc.trustVersion || 0)
    } catch (_) { return false }
  }
  const trustBrowser = (req, res, acc) => {
    const t = jwt.sign({ sub: acc._id, tv: acc.trustVersion || 0, typ: 'trust' }, secret(), { expiresIn: `${TRUST_DAYS}d` })
    addCookie(res, cookie(req, TRUST_COOKIE, t, TRUST_DAYS))
  }

  // Emails a fresh 6-digit code for `purpose` (login | setup). Preview mode also returns it (no real email needed).
  async function emailCode(acc, purpose) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    await codes.updateOne({ _id: `${purpose}|${acc._id}` }, { $set: { codeHash: sha(code), tries: 0, expiresAt: new Date(Date.now() + EMAIL_CODE_MIN * 60000) } }, { upsert: true })
    sendMail(acc.email, `Your ${brand()} CloudIVR code: ${code}`, `<p>Your CloudIVR sign-in code is</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It works for ${EMAIL_CODE_MIN} minutes. If you did not try to sign in, change your password.</p>`)
      .catch(e => log(`[CloudIVR-Web] 2FA email failed: ${e.message}`))
    return dryRun() ? code : null
  }
  async function emailCodeOk(acc, purpose, code) {
    const id = `${purpose}|${acc._id}`
    const doc = await codes.findOne({ _id: id })
    if (!doc || doc.expiresAt < new Date() || doc.tries >= MAX_TRIES) return false
    if (!same(doc.codeHash, sha(digits(code)))) { await codes.updateOne({ _id: id }, { $inc: { tries: 1 } }); return false }
    await codes.deleteOne({ _id: id })
    return true
  }
  const newBackupCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'))

  // Code from the account's method, or a backup code (used once). true when accepted.
  async function codeOk(acc, code) {
    const tf = acc.twoFactor || {}
    if (tf.method === 'totp') {
      const step = totpStep(unseal(tf.secretEnc), code)
      if (step !== null && step > (tf.lastStep || 0)) { await accounts.updateOne({ _id: acc._id }, { $set: { 'twoFactor.lastStep': step } }); return true }
    }
    if (tf.method === 'email' && digits(code).length === 6 && await emailCodeOk(acc, 'login', code)) return true
    const h = sha(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    if ((tf.backupCodes || []).includes(h)) { await accounts.updateOne({ _id: acc._id }, { $pull: { 'twoFactor.backupCodes': h } }); return true }
    return false
  }

  // After the password (or Google) check: straight in when 2FA is off or this browser is trusted, else a code step.
  async function finishLogin(req, res, acc, { remember = false, status = 200 } = {}) {
    if (!acc.twoFactor?.method || trusted(req, acc)) {
      setSession(req, res, acc, remember ? TRUST_DAYS : undefined)
      return res.status(status).json({ account: publicAccount(acc) })
    }
    const challenge = jwt.sign({ sub: acc._id, typ: 'mfa', r: !!remember }, secret(), { expiresIn: `${CHALLENGE_MIN}m` })
    const previewCode = acc.twoFactor.method === 'email' ? await emailCode(acc, 'login') : null
    const [u, d] = acc.email.split('@')
    res.json({ twoFactor: { method: acc.twoFactor.method, challenge, emailHint: `${u.slice(0, 2)}•••@${d}`, ...(previewCode ? { previewCode } : {}) } })
  }

  const fromChallenge = async (token) => {
    try {
      const c = jwt.verify(String(token || ''), secret())
      if (c.typ !== 'mfa') return null
      const acc = await accounts.findOne({ _id: Number(c.sub) })
      return acc && !acc.disabled && acc.twoFactor?.method ? { acc, remember: !!c.r } : null
    } catch (_) { return null }
  }

  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  function routes(router, h, requireUser) {
    router.post('/auth/2fa/verify', h(async (req, res) => {
      const ch = await fromChallenge(req.body.challenge)
      if (!ch) return bad(res, 401, 'challenge_expired', 'This sign-in step expired. Sign in again.')
      const lk = `mfa|${ch.acc._id}`
      const until = await lockState(lk)
      if (until) return bad(res, 429, 'locked', `Too many wrong codes. Try again after ${until.toISOString().slice(11, 16)} UTC.`)
      if (!(await codeOk(ch.acc, req.body.code))) { await recordFailure(lk); return bad(res, 400, 'invalid_code', 'That code is not right. Check it and try again.') }
      const remember = req.body.remember === undefined ? ch.remember : !!req.body.remember
      await accounts.updateOne({ _id: ch.acc._id }, { $set: { lastLoginAt: new Date() } })
      const acc = await accounts.findOne({ _id: ch.acc._id })
      setSession(req, res, acc, remember ? TRUST_DAYS : undefined)
      if (remember) trustBrowser(req, res, acc)
      res.json({ account: publicAccount(acc), backupCodesLeft: (acc.twoFactor?.backupCodes || []).length })
    }))

    router.post('/auth/2fa/resend', h(async (req, res) => {
      const ch = await fromChallenge(req.body.challenge)
      if (!ch || ch.acc.twoFactor.method !== 'email') return bad(res, 400, 'not_email', 'There is no email code to resend.')
      const doc = await codes.findOne({ _id: `login|${ch.acc._id}` })
      if (doc && doc.expiresAt - Date.now() > (EMAIL_CODE_MIN * 60 - 30) * 1000) return bad(res, 429, 'slow_down', 'Wait 30 seconds before asking for another code.')
      const previewCode = await emailCode(ch.acc, 'login')
      res.json({ sent: true, ...(previewCode ? { previewCode } : {}) })
    }))

    router.get('/auth/2fa', requireUser, (req, res) => {
      const tf = req.webUser.twoFactor || {}
      res.json({ enabled: !!tf.method, method: tf.method || null, backupCodesLeft: (tf.backupCodes || []).length, enabledAt: tf.enabledAt || null })
    })

    // Setup: app = new secret shown as a QR code; email = a code sent to the account's address.
    router.post('/auth/2fa/setup', requireUser, h(async (req, res) => {
      const acc = req.webUser, method = String(req.body.method || '')
      if (acc.twoFactor?.method) return bad(res, 400, 'already_on', 'Two-step sign-in is already on. Turn it off first to switch method.')
      if (method === 'totp') {
        const secretB32 = b32encode(crypto.randomBytes(20))
        await accounts.updateOne({ _id: acc._id }, { $set: { twoFactorPending: { secretEnc: seal(secretB32), at: new Date() } } })
        const label = encodeURIComponent(`CloudIVR:${acc.email}`)
        return res.json({ method, secret: secretB32, otpauthUrl: `otpauth://totp/${label}?secret=${secretB32}&issuer=CloudIVR&algorithm=SHA1&digits=6&period=30` })
      }
      if (method === 'email') {
        const previewCode = await emailCode(acc, 'setup')
        return res.json({ method, sentTo: acc.email, ...(previewCode ? { previewCode } : {}) })
      }
      bad(res, 400, 'invalid_method', 'Pick authenticator app or email.')
    }))

    router.post('/auth/2fa/enable', requireUser, h(async (req, res) => {
      const acc = req.webUser, method = String(req.body.method || '')
      if (acc.twoFactor?.method) return bad(res, 400, 'already_on', 'Two-step sign-in is already on.')
      const lk = `mfa-setup|${acc._id}`
      if (await lockState(lk)) return bad(res, 429, 'locked', 'Too many wrong codes. Try again in 15 minutes.')
      let tf
      if (method === 'totp') {
        const pend = acc.twoFactorPending
        const step = pend ? totpStep(unseal(pend.secretEnc), req.body.code) : null
        if (step === null) { await recordFailure(lk); return bad(res, 400, 'invalid_code', 'That code does not match. Use the 6-digit code your app shows now.') }
        tf = { method, secretEnc: pend.secretEnc, lastStep: step }
      } else if (method === 'email') {
        if (!(await emailCodeOk(acc, 'setup', req.body.code))) { await recordFailure(lk); return bad(res, 400, 'invalid_code', 'That code is not right or has expired.') }
        tf = { method }
      } else return bad(res, 400, 'invalid_method', 'Pick authenticator app or email.')
      const backup = newBackupCodes()
      await accounts.updateOne({ _id: acc._id }, { $set: { twoFactor: { ...tf, enabledAt: new Date(), backupCodes: backup.map(c => sha(c.replace(/-/g, ''))) } }, $unset: { twoFactorPending: '' }, $inc: { trustVersion: 1 } })
      log(`[CloudIVR-Web] 2FA (${method}) turned on for ${acc._id}`)
      res.json({ enabled: true, method, backupCodes: backup })
    }))

    // Turning it off needs the password (or, for Google-only accounts, a current code).
    router.post('/auth/2fa/disable', requireUser, h(async (req, res) => {
      const acc = req.webUser
      if (!acc.twoFactor?.method) return res.json({ enabled: false })
      const bcrypt = require('bcryptjs')
      const ok = acc.passwordHash ? await bcrypt.compare(String(req.body.password || ''), acc.passwordHash) : await codeOk(acc, req.body.code)
      if (!ok) return bad(res, 400, acc.passwordHash ? 'wrong_password' : 'invalid_code', acc.passwordHash ? 'Password is wrong.' : 'That code is not right.')
      await accounts.updateOne({ _id: acc._id }, { $unset: { twoFactor: '', twoFactorPending: '' }, $inc: { trustVersion: 1 } })
      log(`[CloudIVR-Web] 2FA turned off for ${acc._id}`)
      res.json({ enabled: false })
    }))

    // Signs every remembered browser out of the 30-day skip (this one included).
    router.post('/auth/2fa/forget-browsers', requireUser, h(async (req, res) => {
      await accounts.updateOne({ _id: req.webUser._id }, { $inc: { trustVersion: 1 } })
      res.setHeader('Set-Cookie', cookie(req, TRUST_COOKIE, '', 0))
      res.json({ ok: true })
    }))
  }

  return { finishLogin, routes }
}

module.exports = { createTwoFactor, totpStep, hotp, b32encode, b32decode, TRUST_COOKIE, TRUST_DAYS }
