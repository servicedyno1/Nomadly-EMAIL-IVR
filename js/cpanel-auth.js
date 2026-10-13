/* global process */
/**
 * cPanel Authentication & Encryption Service
 * - AES-256-GCM encryption for cPanel passwords
 * - PIN generation & hashing
 * - JWT session management for panel frontend
 * - Rate limiting for login attempts
 */

const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

// Standalone scripts/tests may require this before config-setup — load the real secret first
if (!process.env.SESSION_SECRET) require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') })
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
// Security: Use SESSION_SECRET for encryption key, warn loudly if missing
if (!process.env.SESSION_SECRET) {
  console.error('⚠️ CRITICAL: SESSION_SECRET not set! cPanel password encryption using random key — passwords will be lost on restart!')
}
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')).digest()
const JWT_EXPIRY = '24h'
const PIN_LENGTH = 6
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// In-memory rate limiter (resets on restart — acceptable for this use case)
const loginAttempts = new Map()

// ─── Encryption ─────────────────────────────────────────

function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return { encrypted, iv: iv.toString('hex'), tag: tag.toString('hex') }
}

function decrypt(data) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(data.iv, 'hex')
  )
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'))
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ─── PIN ────────────────────────────────────────────────

function generatePin() {
  // 6-digit numeric PIN (100000–999999)
  return String(crypto.randomInt(100000, 999999))
}

async function hashPin(pin) {
  return bcrypt.hash(pin, 10)
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(pin, hash)
}

// ─── JWT ────────────────────────────────────────────────

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY })
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

// ─── Rate Limiting ──────────────────────────────────────

function checkRateLimit(username) {
  const key = username.toLowerCase()
  const record = loginAttempts.get(key)
  if (!record) return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS }

  // Check if lockout expired
  if (record.lockedUntil && Date.now() > record.lockedUntil) {
    loginAttempts.delete(key)
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS }
  }

  if (record.lockedUntil) {
    const msLeft = record.lockedUntil - Date.now()
    const minsLeft = Math.ceil(msLeft / 60000)
    return {
      allowed: false,
      remaining: 0,
      lockedMinutes: minsLeft,
      lockedSeconds: Math.ceil(msLeft / 1000),
      lockedUntil: record.lockedUntil,
    }
  }

  return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - record.attempts }
}

function recordFailedAttempt(username) {
  const key = username.toLowerCase()
  const record = loginAttempts.get(key) || { attempts: 0 }
  record.attempts++
  if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000
  }
  loginAttempts.set(key, record)
}

function clearAttempts(username) {
  loginAttempts.delete(username.toLowerCase())
}

// ─── Credential Storage ─────────────────────────────────

/**
 * Store cPanel credentials in MongoDB (encrypted)
 * @param {Collection} cpanelAccountsCol - MongoDB collection
 * @param {object} data - { cpUser, cpPass, chatId, email?, domain, plan }
 * @returns {{ pin: string }} - The generated PIN (plaintext, for delivery)
 */
async function storeCredentials(cpanelAccountsCol, data) {
  const pin = generatePin()
  const pinHash = await hashPin(pin)
  const encPass = encrypt(data.cpPass)

  const doc = {
    _id: data.cpUser.toLowerCase(),
    cpUser: data.cpUser,
    cpPass_encrypted: encPass.encrypted,
    cpPass_iv: encPass.iv,
    cpPass_tag: encPass.tag,
    pinHash,
    chatId: data.chatId,
    email: data.email || null,
    domain: data.domain,
    plan: data.plan,
    whmHost: process.env.WHM_HOST || null,
    expiryDate: data.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    lastLogin: null,
    // Price-lock fields — auto-renew uses these so a customer who bought at a
    // promo price isn't billed the higher list price at renewal (the bug that
    // suspended 12 accounts in the 21-day RCA window). See HOSTING_3WEEK_RCA.md
    // and hosting-scheduler.js:getPlanPrice for the consumer side.
    ...(typeof data.priceUsd === 'number' ? {
      priceUsd: data.priceUsd,
      renewalPriceUsd: data.priceUsd,
      priceLockedAt: new Date(),
    } : {}),
  }

  await cpanelAccountsCol.updateOne(
    { _id: doc._id },
    { $set: doc },
    { upsert: true }
  )

  return { pin }
}

/**
 * Validate login and return decrypted cPanel password
 * @param {Collection} cpanelAccountsCol
 * @param {string} username
 * @param {string} pin
 * @returns {{ success, token?, cpUser?, cpPass?, error? }}
 */
async function login(cpanelAccountsCol, username, pin) {
  const rateCheck = checkRateLimit(username)
  if (!rateCheck.allowed) {
    return {
      success: false,
      rateLimited: true,
      lockedSeconds: rateCheck.lockedSeconds,
      lockedMinutes: rateCheck.lockedMinutes,
      lockedUntil: rateCheck.lockedUntil,
      error: `Too many attempts. Try again in ${rateCheck.lockedMinutes} minute(s).`,
    }
  }

  const account = await cpanelAccountsCol.findOne({ _id: username.toLowerCase() })
  if (!account) {
    recordFailedAttempt(username)
    const after = checkRateLimit(username)
    return {
      success: false,
      error: 'Invalid username or PIN.',
      attemptsRemaining: after.remaining,
      ...(after.lockedSeconds ? { rateLimited: true, lockedSeconds: after.lockedSeconds, lockedMinutes: after.lockedMinutes, lockedUntil: after.lockedUntil } : {}),
    }
  }

  const pinValid = await verifyPin(pin, account.pinHash)
  if (!pinValid) {
    recordFailedAttempt(username)
    const after = checkRateLimit(username)
    return {
      success: false,
      error: 'Invalid username or PIN.',
      attemptsRemaining: after.remaining,
      ...(after.lockedSeconds ? { rateLimited: true, lockedSeconds: after.lockedSeconds, lockedMinutes: after.lockedMinutes, lockedUntil: after.lockedUntil } : {}),
    }
  }

  // Success — clear rate limit, create session
  clearAttempts(username)

  const cpPass = decrypt({
    encrypted: account.cpPass_encrypted,
    iv: account.cpPass_iv,
    tag: account.cpPass_tag,
  })

  const token = createToken({
    cpUser: account.cpUser,
    domain: account.domain,
    chatId: account.chatId,
  })

  // Update last login
  await cpanelAccountsCol.updateOne(
    { _id: account._id },
    { $set: { lastLogin: new Date() } }
  )

  return { success: true, token, cpUser: account.cpUser, cpPass, domain: account.domain, plan: account.plan || '' }
}

/**
 * Reset PIN for a cPanel account
 */
async function resetPin(cpanelAccountsCol, cpUser) {
  const pin = generatePin()
  const pinHash = await hashPin(pin)
  await cpanelAccountsCol.updateOne(
    { _id: cpUser.toLowerCase() },
    { $set: { pinHash } }
  )
  return { pin }
}

module.exports = {
  encrypt,
  decrypt,
  generatePin,
  hashPin,
  verifyPin,
  createToken,
  verifyToken,
  storeCredentials,
  login,
  resetPin,
}
