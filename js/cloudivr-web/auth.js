'use strict'
const net = require('net')
// CloudIVR web accounts: email + password (bcrypt), Google sign-in (own OAuth client id), httpOnly JWT cookie sessions,
// lockout after repeated failures, emailed password reset. Accounts are web-only (not linked to Telegram).
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const axios = require('axios')
const nodemailer = require('nodemailer')
const { WEB_ID_BASE } = require('./notify')
const { appPathPrefix } = require('./domain-guard')

const COOKIE = 'civr_session'
const SESSION_DAYS = 7
const LOCK = { max: 5, windowMs: 15 * 60000, lockMs: 15 * 60000 }
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i

const secret = () => {
  const s = process.env.WEB_SESSION_SECRET || process.env.SESSION_SECRET
  if (!s) throw new Error('WEB_SESSION_SECRET / SESSION_SECRET is not configured')
  return crypto.createHash('sha256').update(`cloudivr-web:${s}`).digest('hex')
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const normEmail = (e) => String(e || '').trim().toLowerCase()
const PRIVATE_IP = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10|127)\.|::ffff:192\.168\.)/i
// Cloudflare edge ranges (cloudflare.com/ips). Cloudflare appends the real visitor to X-Forwarded-For just before its own hop.
const CF_EDGE = new net.BlockList()
for (const c of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [a, bits] = c.split('/')
  CF_EDGE.addSubnet(a, Number(bits), a.includes(':') ? 'ipv6' : 'ipv4')
}
const isCfEdge = (ip) => { try { return net.isIP(ip) > 0 && CF_EDGE.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4') } catch (_) { return false } }
// Real visitor IP. Left-most X-Forwarded-For entries are whatever the client sent, so they are never trusted:
// via Cloudflare → the hop just left of its right-most edge hop (CF-Connecting-IP if a proxy dropped that hop);
// otherwise the right-most public hop.
const clientIp = (req) => {
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean)
  const cf = String(req.headers['cf-connecting-ip'] || '').trim()
  if (!hops.length) return cf || String(req.ip || '')
  let i = hops.length - 1
  while (i >= 0 && !isCfEdge(hops[i])) i--
  if (i >= 0) {
    while (i >= 0 && isCfEdge(hops[i])) i--
    return i >= 0 ? hops[i] : (cf || hops[0])
  }
  for (let j = hops.length - 1; j >= 0; j--) if (!PRIVATE_IP.test(hops[j])) return hops[j]
  return String(req.ip || '')
}
const isHttps = (req) => req.secure || /https/i.test(String(req.headers['x-forwarded-proto'] || '')) || /^https:/i.test(String(req.headers.origin || ''))

function parseCookies(req) {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function setSession(req, res, acc) {
  const token = jwt.sign({ sub: acc._id, v: acc.tokenVersion || 0 }, secret(), { expiresIn: `${SESSION_DAYS}d` })
  const secure = isHttps(req)
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`)
}
function clearSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`)
}

const publicAccount = (a) => ({ id: String(a._id), email: a.email, name: a.name || '', hasPassword: !!a.passwordHash, google: !!a.googleSub, createdAt: a.createdAt })

let mailer = null
function sendMail(to, subject, html) {
  if (!process.env.MAIL_DOMAIN) return Promise.resolve(false)
  if (!mailer) {
    const port = Number(process.env.MAIL_PORT) || 2525
    mailer = nodemailer.createTransport({ host: process.env.MAIL_DOMAIN, port, secure: port === 465, requireTLS: port !== 465, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000, auth: { user: process.env.MAIL_AUTH_USER, pass: process.env.MAIL_AUTH_PASSWORD } })
  }
  const brand = process.env.CHAT_BOT_BRAND || 'Nomadly'
  return mailer.sendMail({ from: `${brand} CloudIVR <${process.env.MAIL_SENDER}>`, to, subject, html }).then(() => true)
}

function createAuth(db, { log = console.log } = {}) {
  const accounts = db.collection('webAccounts')
  const counters = db.collection('webCounters')
  const attempts = db.collection('webLoginAttempts')
  const resets = db.collection('webPasswordResets')
  accounts.createIndex({ email: 1 }, { unique: true }).catch(() => {})
  // googleSub is only stored for Google accounts; the partial index ignores email-only accounts.
  accounts.dropIndex('googleSub_1').catch(() => {}).then(() => accounts.updateMany({ googleSub: null }, { $unset: { googleSub: '' } }))
    .then(() => accounts.createIndex({ googleSub: 1 }, { unique: true, name: 'googleSub_partial', partialFilterExpression: { googleSub: { $type: 'string' } } })).catch(e => log(`[CloudIVR-Web] googleSub index: ${e.message}`))
  attempts.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {})
  resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})

  async function nextChatId() {
    const r = await counters.findOneAndUpdate({ _id: 'webChatId' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
    const doc = r && r.value !== undefined ? r.value : r
    return WEB_ID_BASE + Number(doc.seq)
  }

  async function createAccount({ email, name, passwordHash = null, googleSub = null }) {
    const _id = await nextChatId()
    const acc = { _id, email, name: String(name || '').trim().slice(0, 80), passwordHash, ...(googleSub ? { googleSub } : {}), tokenVersion: 0, createdAt: new Date(), lastLoginAt: new Date() }
    await accounts.insertOne(acc)
    await db.collection('walletOf').updateOne({ _id: String(_id) }, { $setOnInsert: { usdIn: 0, usdOut: 0 } }, { upsert: true })
    await db.collection('state').updateOne({ _id: String(_id) }, { $setOnInsert: { userLanguage: 'en', webAccount: true } }, { upsert: true })
    await db.collection('nameOf').updateOne({ _id: String(_id) }, { $setOnInsert: { val: acc.name || email.split('@')[0] } }, { upsert: true })
    log(`[CloudIVR-Web] account created ${_id} (${googleSub ? 'google' : 'email'})`)
    return acc
  }

  async function lockState(key) {
    const a = await attempts.findOne({ _id: key })
    return a && a.lockedUntil && a.lockedUntil > new Date() ? a.lockedUntil : null
  }
  async function recordFailure(key, max = LOCK.max) {
    const now = new Date()
    const a = await attempts.findOne({ _id: key })
    const fresh = !a || now - a.firstAt > LOCK.windowMs
    const count = fresh ? 1 : a.count + 1
    const set = { count, firstAt: fresh ? now : a.firstAt, updatedAt: now }
    if (count >= max) set.lockedUntil = new Date(now.getTime() + LOCK.lockMs)
    await attempts.updateOne({ _id: key }, { $set: set }, { upsert: true })
  }

  // Express middleware: req.webUser = account, req.webChatId = engine chatId
  async function requireUser(req, res, next) {
    try {
      const token = parseCookies(req)[COOKIE]
      if (!token) return res.status(401).json({ error: 'not_signed_in' })
      const claims = jwt.verify(token, secret())
      const acc = await accounts.findOne({ _id: Number(claims.sub) })
      if (!acc || (acc.tokenVersion || 0) !== claims.v || acc.disabled) return res.status(401).json({ error: 'session_expired' })
      req.webUser = acc
      req.webChatId = String(acc._id) // bot convention: chatIds are strings in every collection
      next()
    } catch (_) { return res.status(401).json({ error: 'session_expired' }) }
  }

  function routes(router, h) {
    router.get('/auth/config', (req, res) => res.json({ googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null, brand: process.env.CHAT_BOT_BRAND || 'Nomadly' }))

    router.post('/auth/register', h(async (req, res) => {
      const email = normEmail(req.body.email), password = String(req.body.password || '')
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' })
      if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'weak_password', message: 'Password must be 8–128 characters.' })
      const ipKey = `reg|${clientIp(req)}`
      if (await lockState(ipKey)) return res.status(429).json({ error: 'too_many_attempts', message: 'Too many sign-ups from this network. Try again later.' })
      if (await accounts.findOne({ email })) return res.status(409).json({ error: 'email_taken', message: 'An account with this email already exists. Sign in instead.' })
      await recordFailure(ipKey, 15) // counts sign-ups per IP (15 per 15 min)
      const acc = await createAccount({ email, name: req.body.name, passwordHash: await bcrypt.hash(password, 12) })
      setSession(req, res, acc)
      res.status(201).json({ account: publicAccount(acc) })
    }))

    router.post('/auth/login', h(async (req, res) => {
      const email = normEmail(req.body.email), password = String(req.body.password || '')
      const key = `login|${email}|${clientIp(req)}`, emailKey = `login|${email}` // per-email lock can't be dodged by spoofing the IP
      const until = (await lockState(key)) || (await lockState(emailKey))
      if (until) return res.status(429).json({ error: 'locked', message: `Too many failed attempts. Try again after ${until.toISOString().slice(11, 16)} UTC.` })
      const acc = await accounts.findOne({ email })
      const ok = acc && acc.passwordHash && !acc.disabled && await bcrypt.compare(password, acc.passwordHash)
      if (!ok) {
        await recordFailure(key)
        await recordFailure(emailKey, 10)
        return res.status(401).json({ error: 'invalid_credentials', message: acc && !acc.passwordHash ? 'This account uses Google sign-in. Continue with Google or reset your password.' : 'Wrong email or password.' })
      }
      await attempts.deleteMany({ _id: { $in: [key, emailKey] } })
      await accounts.updateOne({ _id: acc._id }, { $set: { lastLoginAt: new Date() } })
      setSession(req, res, acc)
      res.json({ account: publicAccount(acc) })
    }))

    router.post('/auth/google', h(async (req, res) => {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
      if (!clientId) return res.status(503).json({ error: 'google_not_configured', message: 'Google sign-in is not available yet.' })
      let info
      try { info = (await axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { id_token: String(req.body.credential || '') }, timeout: 10000 })).data } catch (_) { info = null }
      if (!info || info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss) || String(info.email_verified) !== 'true') {
        return res.status(401).json({ error: 'google_invalid', message: 'Google sign-in could not be verified. Try again.' })
      }
      const email = normEmail(info.email)
      let acc = await accounts.findOne({ googleSub: info.sub }) || await accounts.findOne({ email })
      if (acc && !acc.googleSub) await accounts.updateOne({ _id: acc._id }, { $set: { googleSub: info.sub } })
      if (!acc) acc = await createAccount({ email, name: info.name, googleSub: info.sub })
      if (acc.disabled) return res.status(403).json({ error: 'disabled' })
      await accounts.updateOne({ _id: acc._id }, { $set: { lastLoginAt: new Date() } })
      setSession(req, res, acc)
      res.json({ account: publicAccount({ ...acc, googleSub: info.sub }) })
    }))

    router.post('/auth/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }) })

    router.post('/auth/forgot', h(async (req, res) => {
      const email = normEmail(req.body.email)
      const ipKey = `forgot|${clientIp(req)}`
      if (await lockState(ipKey)) return res.json({ ok: true })
      await recordFailure(ipKey)
      const acc = EMAIL_RE.test(email) ? await accounts.findOne({ email }) : null
      if (acc) {
        const token = crypto.randomBytes(32).toString('hex')
        await resets.insertOne({ _id: sha(token), chatId: acc._id, expiresAt: new Date(Date.now() + 30 * 60000), used: false })
        const base = String(process.env.WEB_APP_URL || req.headers.origin || '').replace(/\/+$/, '')
        const link = `${base}${appPathPrefix(base)}/reset-password?token=${token}`
        sendMail(email, 'Reset your CloudIVR password', `<p>Someone asked to reset the password for your CloudIVR account.</p><p><a href="${link}">Choose a new password</a> (link valid for 30 minutes).</p><p>If this wasn't you, ignore this email.</p>`)
          .catch(e => log(`[CloudIVR-Web] reset email failed: ${e.message}`))
      }
      res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' })
    }))

    router.post('/auth/reset', h(async (req, res) => {
      const password = String(req.body.password || '')
      if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'weak_password', message: 'Password must be 8–128 characters.' })
      const r = await resets.findOneAndUpdate({ _id: sha(req.body.token || ''), used: false, expiresAt: { $gt: new Date() } }, { $set: { used: true } })
      const doc = r && r.value !== undefined ? r.value : r
      if (!doc) return res.status(400).json({ error: 'invalid_token', message: 'This reset link is invalid or expired. Request a new one.' })
      await accounts.updateOne({ _id: doc.chatId }, { $set: { passwordHash: await bcrypt.hash(password, 12) }, $inc: { tokenVersion: 1 } })
      const acc = await accounts.findOne({ _id: doc.chatId })
      setSession(req, res, acc)
      res.json({ account: publicAccount(acc) })
    }))

    router.get('/auth/me', requireUser, (req, res) => res.json({ account: publicAccount(req.webUser) }))

    router.post('/auth/change-password', requireUser, h(async (req, res) => {
      const acc = req.webUser, next = String(req.body.newPassword || '')
      if (acc.passwordHash && !(await bcrypt.compare(String(req.body.currentPassword || ''), acc.passwordHash))) return res.status(400).json({ error: 'wrong_password', message: 'Current password is wrong.' })
      if (next.length < 8 || next.length > 128) return res.status(400).json({ error: 'weak_password', message: 'Password must be 8–128 characters.' })
      await accounts.updateOne({ _id: acc._id }, { $set: { passwordHash: await bcrypt.hash(next, 12) }, $inc: { tokenVersion: 1 } })
      setSession(req, res, await accounts.findOne({ _id: acc._id }))
      res.json({ ok: true })
    }))

    router.patch('/auth/profile', requireUser, h(async (req, res) => {
      const name = String(req.body.name || '').trim().slice(0, 80)
      await accounts.updateOne({ _id: req.webUser._id }, { $set: { name } })
      res.json({ account: publicAccount({ ...req.webUser, name }) })
    }))
  }

  return { requireUser, routes }
}

module.exports = { createAuth, parseCookies, COOKIE, secret, clientIp, sendMail, normEmail, EMAIL_RE }
