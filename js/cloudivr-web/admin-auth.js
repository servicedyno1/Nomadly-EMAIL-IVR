'use strict'
// CloudIVR admin dashboard sign-in: one owner account (CIVR_ADMIN_EMAIL + bcrypt hash in CIVR_ADMIN_PASSWORD_HASH_B64)
// → 6-digit code emailed to that address → 12 h httpOnly session cookie. 5 wrong tries per IP / 15 min → locked.
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { parseCookies, clientIp, sendMail } = require('./auth')

const COOKIE = 'civr_admin'
const SESSION_MS = 12 * 3600e3
const CODE_MS = 10 * 60e3
const LOCK_MS = 15 * 60e3
const MAX_FAILS = 5
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const adminEmail = () => String(process.env.CIVR_ADMIN_EMAIL || '').trim().toLowerCase()
const adminHash = () => Buffer.from(String(process.env.CIVR_ADMIN_PASSWORD_HASH_B64 || ''), 'base64').toString('utf8')
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'

function createAdminAuth(db, { log = console.log } = {}) {
  const sessions = db.collection('adminSessions')
  const codes = db.collection('adminCodes')
  const fails = db.collection('adminLoginFails')
  sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  fails.createIndex({ at: 1 }, { expireAfterSeconds: LOCK_MS / 1000 }).catch(() => {})
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const locked = async (ip) => (await fails.countDocuments({ ip, at: { $gt: new Date(Date.now() - LOCK_MS) } })) >= MAX_FAILS
  const fail = (ip, why) => { log(`[Admin] sign-in failed from ${ip}: ${why}`); return fails.insertOne({ ip, why, at: new Date() }).catch(() => {}) }
  const https = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')

  async function require(req, res, next) {
    const tok = parseCookies(req)[COOKIE]
    const s = tok && await sessions.findOne({ _id: sha(tok), expiresAt: { $gt: new Date() } })
    if (!s || s.email !== adminEmail()) return bad(res, 401, 'admin_signin', 'Sign in to the admin dashboard.')
    req.admin = { email: s.email, ip: clientIp(req) }
    next()
  }

  function routes(r, h) {
    r.post('/admin/login', h(async (req, res) => {
      const ip = clientIp(req)
      if (await locked(ip)) return bad(res, 429, 'locked', 'Too many attempts. Try again in 15 minutes.')
      const email = String(req.body?.email || '').trim().toLowerCase()
      const hash = adminHash()
      const ok = !!adminEmail() && hash.startsWith('$2') && email === adminEmail() && await bcrypt.compare(String(req.body?.password || ''), hash)
      if (!ok) { await fail(ip, 'password'); return bad(res, 401, 'wrong_login', 'Wrong email or password.') }
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
      const challenge = crypto.randomBytes(18).toString('base64url')
      await codes.insertOne({ _id: sha(challenge), codeHash: sha(code), tries: 0, ip, expiresAt: new Date(Date.now() + CODE_MS) })
      const sent = await sendMail(adminEmail(), 'Your CloudIVR admin sign-in code', `<p>Your CloudIVR admin sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. Requested from IP ${ip}. If this wasn’t you, change the admin password.</p>`).catch(e => { log(`[Admin] code email failed: ${e.message}`); return false })
      if (sent === false && !dry()) return bad(res, 502, 'email_failed', 'We couldn’t email the sign-in code. Try again in a minute.')
      res.json({ challenge, sentTo: adminEmail().replace(/^(.).*(@.*)$/, '$1•••$2'), ...(dry() ? { devCode: code } : {}) })
    }))
    r.post('/admin/verify', h(async (req, res) => {
      const ip = clientIp(req)
      if (await locked(ip)) return bad(res, 429, 'locked', 'Too many attempts. Try again in 15 minutes.')
      const c = await codes.findOne({ _id: sha(req.body?.challenge || ''), expiresAt: { $gt: new Date() } })
      if (!c) return bad(res, 400, 'expired', 'The code expired. Sign in again.')
      if (c.codeHash !== sha(String(req.body?.code || '').replace(/\D/g, ''))) {
        await fail(ip, 'code')
        if (c.tries >= 4) await codes.deleteOne({ _id: c._id }); else await codes.updateOne({ _id: c._id }, { $inc: { tries: 1 } })
        return bad(res, 401, 'wrong_code', 'That code isn’t right.')
      }
      await codes.deleteOne({ _id: c._id })
      const tok = crypto.randomBytes(32).toString('base64url')
      await sessions.insertOne({ _id: sha(tok), email: adminEmail(), ip, createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) })
      res.cookie(COOKIE, tok, { httpOnly: true, secure: https(req), sameSite: 'lax', path: '/', maxAge: SESSION_MS })
      await db.collection('adminAudit').insertOne({ at: new Date(), admin: adminEmail(), action: 'sign_in', ip }).catch(() => {})
      res.json({ ok: true, email: adminEmail() })
    }))
    r.post('/admin/logout', h(async (req, res) => {
      const tok = parseCookies(req)[COOKIE]
      if (tok) await sessions.deleteOne({ _id: sha(tok) })
      res.clearCookie(COOKIE, { path: '/' })
      res.json({ ok: true })
    }))
    r.get('/admin/me', require, (req, res) => res.json({ email: req.admin.email }))
  }

  return { routes, require }
}

module.exports = { createAdminAuth, COOKIE }
