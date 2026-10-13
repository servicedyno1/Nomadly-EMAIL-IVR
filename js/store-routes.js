/* global process */
/**
 * store-routes.js — Public Web Storefront (Phase 1: account + wallet + crypto top-up)
 * Mounted at /store (reached via /api/store/* through the FastAPI proxy).
 *
 * Independent of the Telegram bot. Uses SEPARATE collections so the bot's
 * wallet/accounting (walletOf, etc.) is never touched:
 *   - webUsers       : { _id, email, passwordHash, walletUsd, createdAt, lastLogin }
 *   - webWalletTxns  : ledger of every balance change
 *   - webOrders      : crypto top-up / purchase intents (durable; survives restarts)
 *
 * Crypto: DynoPay primary, BlockBee fallback. Min top-up $10 (USDT-TRC20 $20).
 */

const express = require('express')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { log } = require('console')

const { getDynopayCryptoAddress, getDynopayCryptoPaymentStatus, getDynopayPaymentStatusById } = require('./pay-dynopay')
const { getCryptoDepositAddress, convert } = require('./pay-blockbee')
const { isPaidStatus, classifyStoreWebhook, isStoreUnderpaid, storeUnderpayTolerance, verifyDynopayWebhook, diagnoseDynopaySignature } = require('./store-payment-verify')

const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const JWT_EXPIRY = '30d'

// Supported coins + min top-up (USD). USDT-TRC20 has a higher floor per requirement.
const COINS = [
  { code: 'BTC', name: 'Bitcoin', min: 10, bbTicker: 'btc' },
  { code: 'ETH', name: 'Ethereum', min: 10, bbTicker: 'eth' },
  { code: 'LTC', name: 'Litecoin', min: 10, bbTicker: 'ltc' },
  { code: 'DOGE', name: 'Dogecoin', min: 10, bbTicker: 'doge' },
  { code: 'USDT-TRC20', name: 'USDT (TRC20)', min: 20, bbTicker: 'trc20_usdt' },
  { code: 'USDT-ERC20', name: 'USDT (ERC20)', min: 10, bbTicker: 'erc20_usdt' },
  { code: 'BCH', name: 'Bitcoin Cash', min: 10, bbTicker: 'bch' },
  { code: 'TRX', name: 'TRON', min: 10, bbTicker: 'trx' },
]
const coinByCode = (c) => COINS.find(x => x.code === String(c || '').toUpperCase())

const uuid = () => crypto.randomUUID()
const now = () => new Date()

function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY }) }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET) } catch { return null } }

// ─── Bot → Web auto-login token (HMAC, short-lived, single-use) ───
// Used by the Telegram bot to issue a deep-link that auto-signs the user
// into the web storefront without typing credentials. Token format:
//   base64url(JSON{c:chatId, e:expUnix, n:nonce}) + "." + hex(hmac-sha256(payload, key))
// The single-use guarantee is enforced at /auth/bot-login by tracking the
// nonce in MongoDB collection `webBotLoginConsumed`.
const BOT_LINK_KEY = crypto.createHmac('sha256', JWT_SECRET).update('store-bot-link-v1').digest()
const BOT_LINK_TTL_SEC = 5 * 60   // 5 minutes
const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uDecode = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function mintBotLoginToken(chatId) {
  const cid = String(chatId || '').trim()
  if (!cid) throw new Error('chatId required')
  const payload = { c: cid, e: Math.floor(Date.now() / 1000) + BOT_LINK_TTL_SEC, n: crypto.randomBytes(8).toString('hex') }
  const body = b64u(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', BOT_LINK_KEY).update(body).digest('hex')
  return `${body}.${sig}`
}

function verifyBotLoginToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 2) return { ok: false, error: 'malformed' }
  const [body, sig] = parts
  const expected = crypto.createHmac('sha256', BOT_LINK_KEY).update(body).digest('hex')
  // Timing-safe compare
  if (sig.length !== expected.length) return { ok: false, error: 'bad_signature' }
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return { ok: false, error: 'bad_signature' }
  }
  let payload
  try { payload = JSON.parse(b64uDecode(body).toString('utf8')) } catch { return { ok: false, error: 'bad_payload' } }
  if (!payload?.c || !payload?.e || !payload?.n) return { ok: false, error: 'bad_payload' }
  if (Math.floor(Date.now() / 1000) > Number(payload.e)) return { ok: false, error: 'expired' }
  return { ok: true, chatId: String(payload.c), nonce: payload.n, exp: payload.e }
}

/**
 * @param {object} deps
 * @param {Function} deps.getDb  - returns the connected Mongo db handle
 * @param {string}   deps.selfUrl - webhook base (already includes /api)
 * @param {Function} [deps.notifyAdmin]
 */
function createStoreRoutes(deps = {}) {
  const router = express.Router()
  const getDb = deps.getDb
  const SELF_URL = deps.selfUrl || process.env.SELF_URL
  const notifyAdmin = typeof deps.notifyAdmin === 'function' ? deps.notifyAdmin : (() => {})
  // Injectable DynoPay status lookups (real by default; overridden in tests).
  const dynoStatusById = typeof deps.dynoStatusById === 'function' ? deps.dynoStatusById : getDynopayPaymentStatusById
  const dynoStatusByAddress = typeof deps.dynoStatusByAddress === 'function' ? deps.dynoStatusByAddress : getDynopayCryptoPaymentStatus
  // DynoPay webhook signing secret (whsec_…). When set, a present-but-invalid
  // signature is rejected outright and a valid signature lets a gateway-
  // unreachable webhook still fulfill. When unset, DynoPay sends the payload
  // unsigned and we rely purely on the server-to-server status re-verify.
  const webhookSecret = () => (deps.webhookSecret || process.env.DYNO_PAY_WEBHOOK_SECRET || '')

  const col = (name) => {
    const db = getDb && getDb()
    if (!db) throw new Error('DB not ready')
    return db.collection(name)
  }

  // ── Authoritative DynoPay status for an order. UNTRUSTED webhook bodies must
  // never be the source of truth — this fetches the real status/amount from
  // DynoPay server-to-server. Prefers the immutable payment_id endpoint
  // (recommended, survives address expiry); falls back to the address lookup.
  async function fetchAuthoritativeStatus(order) {
    let st = null
    if (order.paymentId) { try { st = await dynoStatusById(order.paymentId) } catch (_) { st = null } }
    if ((!st || st.status == null) && order.payAddress) { try { st = await dynoStatusByAddress(order.payAddress) } catch (_) { st = null } }
    return (st && st.status != null) ? st : null
  }

  // Authoritative USD amount from a DynoPay status response. Uses ONLY the USD
  // base-currency fields (never the crypto amount, never the webhook body).
  function authoritativeUsd(st) {
    if (!st) return null
    const cand = (st.amount_received_base != null ? st.amount_received_base
      : (st.base_amount != null ? st.base_amount : null))
    const n = cand != null ? parseFloat(cand) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // ── Auth middleware ──
  function webAuth(req, res, next) {
    const h = req.headers.authorization || ''
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const decoded = verifyToken(h.slice(7))
    if (!decoded?.webUserId) return res.status(401).json({ error: 'Session expired. Please log in again.' })
    req.webUserId = decoded.webUserId
    req.webEmail = decoded.email
    next()
  }

  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

  async function publicUser(uId) {
    const u = await col('webUsers').findOne({ _id: uId })
    if (!u) return null
    return {
      id: u._id,
      email: u.email,
      walletUsd: Number(u.walletUsd || 0),
      tgChatId: u.tgChatId ? String(u.tgChatId) : null,
      tgDisplay: u.tgDisplay || '',
      tgLinked: !!u.tgChatId,
    }
  }

  // ─── Account linking helpers ────────────────────────────────────────
  // The bot and the web storefront can both create user records; users may
  // hop between channels (signed up on web, later opens the Telegram bot,
  // or vice-versa). We use `cpanelAccounts.email` as the shared fingerprint
  // — it's set whenever a user buys hosting on either channel — to auto-link
  // the two records without prompting.

  // Find distinct chatIds that have ever purchased hosting under `email`.
  async function chatIdsKnownByEmail(email) {
    if (!email) return []
    const rows = await col('cpanelAccounts').aggregate([
      { $match: {
        email: String(email).trim().toLowerCase(),
        chatId: { $exists: true, $ne: null },
        deleted: { $ne: true },
      } },
      { $group: { _id: '$chatId' } },
    ]).toArray()
    return rows.map(r => String(r._id)).filter(Boolean)
  }

  // Find distinct emails that this chatId has ever used to buy hosting.
  async function emailsKnownByChatId(chatId) {
    if (!chatId) return []
    const rows = await col('cpanelAccounts').aggregate([
      { $match: {
        chatId: Number(chatId),
        email: { $exists: true, $nin: [null, ''] },
        deleted: { $ne: true },
      } },
      { $group: { _id: '$email' } },
    ]).toArray()
    return rows.map(r => String(r._id).trim().toLowerCase()).filter(emailOk)
  }

  // Idempotent: set tgChatId on a webUser (if not already set) AND reverse-link
  // any orphaned cpanelAccounts to that webUser. Safe to call multiple times.
  async function linkWebUserToChatId(webUserId, chatId, displayName) {
    if (!webUserId || !chatId) return { linked: false }
    const cid = String(chatId)
    const update = { lastLinkedAt: now() }
    const u = await col('webUsers').findOne({ _id: webUserId })
    if (!u) return { linked: false }
    if (!u.tgChatId) {
      update.tgChatId = cid
      update.linkedAt = now()
      if (displayName && !u.tgDisplay) update.tgDisplay = displayName
    } else if (String(u.tgChatId) !== cid) {
      // Refuse to overwrite an existing different link — protects against
      // shared-device hijack where someone with a different chatId tries to
      // claim an already-linked email.
      return { linked: false, conflict: true, currentChatId: String(u.tgChatId) }
    }
    await col('webUsers').updateOne({ _id: webUserId }, { $set: update })
    // Reverse-link orphaned cpanel accounts (this chatId, no webUserId yet)
    let cpLinked = 0
    try {
      const r = await col('cpanelAccounts').updateMany(
        { chatId: Number(cid), deleted: { $ne: true }, $or: [{ webUserId: { $exists: false } }, { webUserId: null }] },
        { $set: { webUserId } }
      )
      cpLinked = r.modifiedCount || 0
    } catch (e) { log(`[Store] cpanel reverse-link warning: ${e.message}`) }
    log(`[Store] linked webUser=${webUserId} ↔ tgChatId=${cid} (cpanel rows linked: ${cpLinked})`)
    return { linked: true, cpanelLinked: cpLinked }
  }

  // Best-effort: after web email-login or signup, attempt to auto-link to a
  // chatId — only if exactly ONE chatId matches (ambiguous matches are skipped).
  async function autoLinkByEmail(webUser) {
    if (!webUser || webUser.tgChatId) return { attempted: false, alreadyLinked: !!webUser.tgChatId }
    const chatIds = await chatIdsKnownByEmail(webUser.email)
    if (chatIds.length === 0) return { attempted: false, reason: 'no_cpanel_email_match' }
    if (chatIds.length > 1) return { attempted: false, reason: 'ambiguous', candidates: chatIds.length }
    const r = await linkWebUserToChatId(webUser._id, chatIds[0])
    return { attempted: true, ...r, chatId: chatIds[0] }
  }

  // ─────────────────────────── AUTH ───────────────────────────
  router.post('/auth/signup', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase()
      const password = String(req.body?.password || '')
      if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required.' })
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

      const existing = await col('webUsers').findOne({ email })
      if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please log in.' })

      const passwordHash = await bcrypt.hash(password, 10)
      const doc = { _id: uuid(), email, passwordHash, walletUsd: 0, createdAt: now(), lastLogin: now() }
      await col('webUsers').insertOne(doc)
      // Link any prior GUEST purchases made with this email so they show under "My Plans".
      try {
        await col('cpanelAccounts').updateMany(
          { ownerEmail: email, deleted: { $ne: true }, $or: [{ webUserId: { $exists: false } }, { webUserId: null }, { webUserId: { $regex: '^guest_' } }] },
          { $set: { webUserId: doc._id } }
        )
      } catch (e) { log(`[Store] signup guest-link warning: ${e.message}`) }
      // Seamless link to a Telegram chatId if any bot-purchased cpanelAccount
      // shares this email (single chatId match → auto-link).
      const linkRes = await autoLinkByEmail(doc)
      const fresh = await publicUser(doc._id)
      const token = signToken({ webUserId: doc._id, email })
      log(`[Store] signup ${email} (${doc._id})${linkRes.linked ? ` ↔ chatId=${linkRes.chatId}` : ''}`)
      return res.json({ token, user: fresh, link: linkRes })
    } catch (err) {
      log(`[Store] signup error: ${err.message}`)
      return res.status(500).json({ error: 'Could not create account. Try again shortly.' })
    }
  })

  router.post('/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase()
      const password = String(req.body?.password || '')
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })
      const u = await col('webUsers').findOne({ email })
      if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
        return res.status(401).json({ error: 'Invalid email or password.' })
      }
      await col('webUsers').updateOne({ _id: u._id }, { $set: { lastLogin: now() } })
      // Seamless account linking: if this email is also known to the bot
      // (via any cpanelAccount with the same email), auto-link to that chatId
      // so future bot↔web hops don't create a second user record.
      const linkRes = await autoLinkByEmail(u)
      const fresh = await publicUser(u._id)
      const token = signToken({ webUserId: u._id, email })
      return res.json({ token, user: fresh, link: linkRes })
    } catch (err) {
      log(`[Store] login error: ${err.message}`)
      return res.status(500).json({ error: 'Login failed. Try again shortly.' })
    }
  })

  router.get('/auth/me', webAuth, async (req, res) => {
    const u = await publicUser(req.webUserId)
    if (!u) return res.status(404).json({ error: 'Account not found' })
    res.json({ user: u })
  })

  // Bot → Web auto-login: exchange a one-time HMAC token (?bt=…) for a web JWT.
  // The bot mints these via mintBotLoginToken(chatId) and DMs the user a link
  // like {storefrontUrl}?bt=<token>. Token is valid 5 min, single-use.
  router.post('/auth/bot-login', async (req, res) => {
    try {
      const bt = String(req.body?.bt || req.query?.bt || '').trim()
      if (!bt) return res.status(400).json({ error: 'bt is required' })
      const v = verifyBotLoginToken(bt)
      if (!v.ok) return res.status(401).json({ error: v.error === 'expired' ? 'This link has expired. Please request a new one from the bot.' : 'Invalid login link.' })

      // Single-use enforcement (idempotent insert keyed by nonce).
      try {
        await col('webBotLoginConsumed').insertOne({ _id: v.nonce, chatId: v.chatId, consumedAt: now(), exp: new Date(v.exp * 1000) })
      } catch (err) {
        if (err.code === 11000) {
          return res.status(401).json({ error: 'This login link has already been used. Please request a new one from the bot.' })
        }
        throw err
      }

      // Pull the Telegram display name (if available) to make the dashboard prettier
      let display = ''
      try {
        const nm = await col('nameOf').findOne({ _id: Number(v.chatId) }) || await col('nameOf').findOne({ _id: v.chatId })
        if (nm?.val) display = String(nm.val)
      } catch { /* nameOf collection may not exist in this DB */ }

      // 1) Already-linked webUser?
      let u = await col('webUsers').findOne({ tgChatId: v.chatId })

      // 2) Seamless link: find any webUser whose email matches a cpanelAccount
      //    owned by this chatId. Preferred over creating a duplicate synthetic
      //    account when the same person signed up on the web first.
      if (!u) {
        const emails = await emailsKnownByChatId(v.chatId)
        for (const em of emails) {
          const existing = await col('webUsers').findOne({ email: em })
          if (existing) {
            const link = await linkWebUserToChatId(existing._id, v.chatId, display)
            if (link.linked) {
              u = await col('webUsers').findOne({ _id: existing._id })
              log(`[Store] bot-login linked existing webUser ${existing._id} (${em}) ↔ tgChatId=${v.chatId} (cpanel: ${link.cpanelLinked || 0})`)
              break
            }
          }
        }
      }

      // 3) No existing record found → create a synthetic user.
      if (!u) {
        const synthEmail = `tg-${v.chatId}@bot.local`
        const doc = {
          _id: uuid(),
          email: synthEmail,
          tgChatId: v.chatId,
          tgDisplay: display,
          // No passwordHash — bot-link auth only. The /auth/login email+password
          // path will reject because compare(any, undefined) returns false.
          passwordHash: '',
          walletUsd: 0,
          createdAt: now(),
          lastLogin: now(),
          authSource: 'telegram',
        }
        await col('webUsers').insertOne(doc)
        u = doc
        // Link any existing hosting accounts owned by this chatId.
        try {
          await col('cpanelAccounts').updateMany(
            { chatId: Number(v.chatId), deleted: { $ne: true }, $or: [{ webUserId: { $exists: false } }, { webUserId: null }] },
            { $set: { webUserId: doc._id } }
          )
        } catch (e) { log(`[Store] bot-login cpanel-link warning: ${e.message}`) }
        log(`[Store] bot-login created webUser for tgChatId=${v.chatId} (${doc._id})`)
      } else {
        await col('webUsers').updateOne({ _id: u._id }, { $set: { lastLogin: now() } })
      }

      const token = signToken({ webUserId: u._id, email: u.email })
      return res.json({
        token,
        user: await publicUser(u._id),
      })
    } catch (err) {
      log(`[Store] bot-login error: ${err.message}`)
      return res.status(500).json({ error: 'Could not sign you in. Please try again.' })
    }
  })

  // Public storefront config — exposes the Telegram bot username so the
  // landing page can render the "Continue with Telegram" QR / deep-link.
  router.get('/config', (req, res) => {
    const smsBrand = require('./sms-app-brand.js')
    const brandName = process.env.STORE_BRAND_NAME || smsBrand.brandName()
    res.json({
      botUsername: process.env.TELEGRAM_BOT_USERNAME || smsBrand.botUsername(),
      botStartPayload: 'web-login',
      brandName,
      brandSlug: smsBrand.brandSlug(),
      logoUrl: '/brand/wordmark.png',
      markUrl: '/brand/mark.png',
      accent: smsBrand.brandSlug() === 'smadav' ? '#3b82f6' : '#10d9a0',
    })
  })

  // ─────────────────────────── WALLET ───────────────────────────
  router.get('/wallet', webAuth, async (req, res) => {
    try {
      const u = await publicUser(req.webUserId)
      if (!u) return res.status(404).json({ error: 'Account not found' })
      const txns = await col('webWalletTxns').find({ webUserId: req.webUserId })
        .sort({ createdAt: -1 }).limit(25).toArray()
      res.json({
        balanceUsd: u.walletUsd,
        coins: COINS.map(c => ({ code: c.code, name: c.name, min: c.min })),
        txns: txns.map(t => ({
          id: t._id, type: t.type, amountUsd: t.amountUsd, balanceAfter: t.balanceAfter,
          coin: t.coin || null, status: t.status || 'done', note: t.note || '', createdAt: t.createdAt,
        })),
      })
    } catch (err) {
      log(`[Store] wallet error: ${err.message}`)
      res.status(500).json({ error: 'Could not load wallet.' })
    }
  })

  // Create a crypto top-up intent → returns a deposit address to send funds to.
  router.post('/wallet/topup', webAuth, async (req, res) => {
    try {
      const amountUsd = Number(req.body?.amountUsd)
      const coin = coinByCode(req.body?.coin)
      if (!coin) return res.status(400).json({ error: 'Unsupported coin.' })
      if (!Number.isFinite(amountUsd)) return res.status(400).json({ error: 'A valid amount is required.' })
      if (amountUsd < coin.min) {
        return res.status(400).json({ error: `Minimum top-up for ${coin.name} is $${coin.min}.`, min: coin.min })
      }

      const orderId = uuid()
      const webhookUrl = `${SELF_URL}/store/crypto-webhook`
      const order = {
        _id: orderId, webUserId: req.webUserId, kind: 'wallet_topup',
        amountUsd, coin: coin.code, provider: 'dynopay', status: 'pending',
        payAddress: null, paymentId: null, usdCredited: 0, createdAt: now(), updatedAt: now(),
      }

      // 1) DynoPay (primary)
      let address = null
      try {
        const dyno = await getDynopayCryptoAddress(amountUsd, coin.code, webhookUrl, {
          product_name: 'wallet_topup', refId: orderId, kind: 'wallet_topup', webUserId: req.webUserId,
        })
        if (dyno && !dyno.error && (dyno.address || dyno.wallet_address)) {
          address = dyno.address || dyno.wallet_address
          order.paymentId = dyno.payment_id || dyno.id || null
        } else {
          log(`[Store] DynoPay topup failed (${JSON.stringify(dyno).slice(0,160)}) — trying BlockBee`)
        }
      } catch (e) { log(`[Store] DynoPay topup threw: ${e.message} — trying BlockBee`) }

      // 2) BlockBee (fallback) — callback carries orderId in query string
      if (!address) {
        try {
          const bbCb = `/store/blockbee-webhook?order=${orderId}&`
          const bb = await getCryptoDepositAddress(coin.bbTicker, orderId, SELF_URL, bbCb)
          if (bb?.address) { address = bb.address; order.provider = 'blockbee' }
        } catch (e) { log(`[Store] BlockBee fallback threw: ${e.message}`) }
      }

      if (!address) {
        return res.status(502).json({ error: 'Payment provider unavailable right now. Please try again shortly.' })
      }

      order.payAddress = address
      await col('webOrders').insertOne(order)
      log(`[Store] topup order ${orderId} ${coin.code} $${amountUsd} via ${order.provider} addr=${String(address).slice(0,12)}…`)
      return res.json({
        orderId, coin: coin.code, amountUsd, provider: order.provider,
        address, status: 'pending',
      })
    } catch (err) {
      log(`[Store] topup error: ${err.message}`)
      res.status(500).json({ error: 'Could not start top-up. Try again shortly.' })
    }
  })

  // Poll a top-up's status (webhook is primary; this is a fallback the UI polls).
  router.get('/wallet/topup/:orderId', webAuth, async (req, res) => {
    try {
      const order = await col('webOrders').findOne({ _id: req.params.orderId, webUserId: req.webUserId })
      if (!order) return res.status(404).json({ error: 'Order not found' })
      // Best-effort live check for DynoPay if still pending
      if (order.status === 'pending' && order.provider === 'dynopay' && (order.payAddress || order.paymentId)) {
        try {
          const st = await fetchAuthoritativeStatus(order)
          if (st && isPaidStatus(st.status)) {
            await creditTopup(order, authoritativeUsd(st), st.fee_payer, order.paymentId || st.payment_id, 'poll')
          }
        } catch (_) {}
      }
      const fresh = await col('webOrders').findOne({ _id: req.params.orderId })
      const u = await publicUser(req.webUserId)
      res.json({ orderId: fresh._id, status: fresh.status, usdCredited: fresh.usdCredited || 0, balanceUsd: u?.walletUsd || 0 })
    } catch (err) {
      log(`[Store] topup status error: ${err.message}`)
      res.status(500).json({ error: 'Could not fetch status.' })
    }
  })

  // ── Shared credit routine (idempotent) ──
  async function creditTopup(order, baseAmount, feePayer, paymentId, source) {
    // Idempotency: only credit a pending order once.
    const claim = await col('webOrders').findOneAndUpdate(
      { _id: order._id, status: 'pending' },
      { $set: { status: 'crediting', paymentId: paymentId || order.paymentId, updatedAt: now() } },
      { returnDocument: 'after' }
    )
    const claimed = claim && (claim.value || claim) // driver version compat
    if (!claimed || (claimed.status && claimed.status !== 'crediting')) {
      log(`[Store] creditTopup ${order._id}: already processed (${source}) — skipping`)
      return false
    }

    // USD to credit: trust DynoPay's confirmed USD (base_amount) when company pays fees;
    // otherwise fall back to the order's requested amount (wallet top-up = credit what's owed).
    let usdIn
    if (baseAmount && (feePayer === 'company' || feePayer == null)) usdIn = parseFloat(baseAmount)
    if (!Number.isFinite(usdIn) || usdIn <= 0) usdIn = Number(order.amountUsd)
    usdIn = Math.round(usdIn * 100) / 100

    const upd = await col('webUsers').findOneAndUpdate(
      { _id: order.webUserId },
      { $inc: { walletUsd: usdIn } },
      { returnDocument: 'after' }
    )
    const userDoc = upd && (upd.value || upd)
    const balanceAfter = Number(userDoc?.walletUsd || 0)

    await col('webWalletTxns').insertOne({
      _id: uuid(), webUserId: order.webUserId, type: 'topup', amountUsd: usdIn,
      balanceAfter, coin: order.coin, provider: order.provider, orderId: order._id,
      status: 'done', note: `Crypto top-up (${source})`, createdAt: now(),
    })
    await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'credited', usdCredited: usdIn, updatedAt: now() } })
    log(`[Store] CREDITED $${usdIn} to ${order.webUserId} (order ${order._id}, ${source}). Balance=$${balanceAfter}`)
    try { notifyAdmin(`💰 <b>Web wallet top-up</b>\nUser: ${order.webUserId}\nAmount: $${usdIn} (${order.coin})\nProvider: ${order.provider}`) } catch {}
    return true
  }

  // ── Shared hosting provisioner (used by wallet purchase AND direct-crypto purchase) ──
  async function provisionHosting({ webUserId, email, planName, hostingPrice, total, domain, domainMode, registrar }) {
    const stateCol = col('state')
    const info = {
      _id: webUserId, website_name: domain, plan: planName, email: email || null,
      userLanguage: 'en', price: total, hostingPrice, registrar: registrar || null, source: 'web',
      // GAP-1 FIX (2026-09): match the bot — set Cloudflare NS so registerDomainAndCreateCpanel
      // creates the web DNS (root+www CNAME → tunnel). Without this the CF zone was left with only
      // NS records and the customer's site never resolved after a web-store purchase.
      nameserver: 'cloudflare', nsChoice: 'cloudflare',
    }
    if (domainMode === 'byo') { info.existingDomain = true; info.connectExternalDomain = true }
    let result
    try {
      const { registerDomainAndCreateCpanel } = require('./cr-register-domain-&-create-cpanel.js')
      result = await registerDomainAndCreateCpanel(() => {}, info, [], stateCol, null)
    } catch (e) {
      log(`[Store] provisionHosting threw: ${e.message}`)
      result = { success: false, error: e.message }
    }
    if (result?.success) {
      try {
        await col('cpanelAccounts').updateOne(
          { _id: String(result.username).toLowerCase() },
          { $set: { webUserId, source: 'web', ownerEmail: email || null } }
        )
      } catch (e) { log(`[Store] link cpanelAccount warning: ${e.message}`) }
    }
    return result
  }

  // ── Fulfil a DIRECT-CRYPTO hosting order on payment confirmation (idempotent). ──
  // Handles BOTH guest orders (no webUserId) and logged-in orders.
  async function fulfillHostingOrder(order, baseAmount, feePayer, paymentId, source) {
    const claim = await col('webOrders').findOneAndUpdate(
      { _id: order._id, status: 'pending' },
      { $set: { status: 'fulfilling', paymentId: paymentId || order.paymentId, updatedAt: now() } },
      { returnDocument: 'after' }
    )
    const claimed = claim && (claim.value || claim)
    if (!claimed || (claimed.status && claimed.status !== 'fulfilling')) {
      log(`[Store] fulfillHostingOrder ${order._id}: already processed (${source})`); return false
    }

    const isGuest = !order.webUserId
    let usdIn
    if (baseAmount && (feePayer === 'company' || feePayer == null)) usdIn = parseFloat(baseAmount)
    if (!Number.isFinite(usdIn) || usdIn <= 0) usdIn = Number(order.amountUsd)
    usdIn = Math.round(usdIn * 100) / 100
    const total = Number(order.amountUsd)

    const creditWallet = async (amt, type, note) => {
      if (isGuest) return
      await col('webUsers').updateOne({ _id: order.webUserId }, { $inc: { walletUsd: amt } })
      const u = await publicUser(order.webUserId)
      await col('webWalletTxns').insertOne({ _id: uuid(), webUserId: order.webUserId, type, amountUsd: amt, balanceAfter: u?.walletUsd || 0, coin: order.coin, provider: order.provider, orderId: order._id, status: 'done', note, createdAt: now() })
    }

    // Underpaid beyond the network-fee tolerance → don't provision. A minor
    // fee-shave (e.g. $67.31 of a $69 order) is WITHIN tolerance and provisions.
    if (isStoreUnderpaid(usdIn, total)) {
      if (isGuest) {
        await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'failed', note: 'underpaid', usdCredited: usdIn, updatedAt: now() } })
        try { notifyAdmin(`⚠️ <b>Guest hosting UNDERPAID</b>\nOrder: ${order._id}\nGot $${usdIn} / $${total}\nEmail: ${order.email}\nDomain: ${order.domain}\n→ manual refund needed`) } catch {}
      } else {
        await creditWallet(usdIn, 'topup', `Underpaid hosting order → credited to wallet (${source})`)
        await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'failed', usdCredited: usdIn, note: 'underpaid', updatedAt: now() } })
      }
      log(`[Store] hosting order ${order._id} UNDERPAID ($${usdIn} < $${total} × tol ${storeUnderpayTolerance()})`)
      return false
    }

    const ownerId = order.webUserId || ('guest_' + order._id)
    const result = await provisionHosting({
      webUserId: ownerId, email: order.email, planName: order.plan,
      hostingPrice: order.hostingPrice, total, domain: order.domain, domainMode: order.domainMode, registrar: order.registrar,
    })

    // ── WHM down at provisioning time → order is COMMITTED; the background
    // cpanel-job-queue worker finishes the moment WHM recovers. Parity with the
    // bot, which shows "being prepared" and NEVER refunds. Covers BOTH queued
    // shapes the provisioner returns: {success:true,queued} (WHM down before
    // domain registration) and {success:false,queued,deferred,code:'CPANEL_DOWN'}
    // (WHM down AFTER the domain was already registered — refunding here would
    // be wrong because the domain purchase already happened).
    if (result?.queued) {
      if (!isGuest) {
        const overpay = Math.round((usdIn - total) * 100) / 100
        if (overpay >= 0.01) await creditWallet(overpay, 'topup', `Overpayment credited to wallet (${order.domain})`)
        await creditWallet(-total, 'purchase', `Hosting (crypto): ${order.plan} — ${order.domain}`)
      }
      await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'provisioning', usdCredited: usdIn, note: 'whm_down_queued', updatedAt: now() } })
      log(`[Store] hosting order ${order._id} QUEUED (WHM down) — worker will finish provisioning (guest=${isGuest})`)
      try { notifyAdmin(`⏳ <b>Web hosting QUEUED (WHM down)</b>\nOrder: <code>${order._id}</code>\n${isGuest ? 'GUEST ' + order.email : order.webUserId}\nDomain: ${order.domain}\nPaid $${usdIn} — background worker will provision on WHM recovery`) } catch {}
      return true
    }

    if (!result?.success) {
      if (isGuest) {
        await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'failed', usdCredited: usdIn, updatedAt: now() } })
        try { notifyAdmin(`❌ <b>Guest hosting provision FAILED</b>\nOrder: ${order._id}\nEmail: ${order.email}\nDomain: ${order.domain}\nPaid $${usdIn} → manual refund needed`) } catch {}
      } else {
        await creditWallet(usdIn, 'refund', `Refund — provisioning failed (${order.domain})`)
        await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'failed', usdCredited: usdIn, updatedAt: now() } })
      }
      log(`[Store] hosting order ${order._id} provision FAILED (guest=${isGuest})`)
      return false
    }

    // Success — store creds on the order; for logged-in, credit overpayment + log purchase.
    if (!isGuest) {
      const overpay = Math.round((usdIn - total) * 100) / 100
      if (overpay >= 0.01) await creditWallet(overpay, 'topup', `Overpayment credited to wallet (${order.domain})`)
      await creditWallet(-total, 'purchase', `Hosting (crypto): ${order.plan} — ${order.domain}`)
    }
    await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'provisioned', username: result.username, pin: result.pin, nameservers: result.nameservers || [], usdCredited: usdIn, updatedAt: now() } })
    log(`[Store] hosting order ${order._id} PROVISIONED → ${result.username}@${order.domain} (guest=${isGuest})`)
    try { notifyAdmin(`🆕 <b>Web hosting purchase (crypto)</b>\n${isGuest ? 'GUEST' : order.webUserId}\nPlan: ${order.plan}\nDomain: ${order.domain}\ncpUser: ${result.username}`) } catch {}
    return true
  }

  // ── DynoPay webhook (durable, DB-backed) ──
  router.post('/crypto-webhook', async (req, res) => {
    try {
      const event = req.body?.event || req.body?.status
      const paymentId = req.body?.payment_id
      const refId = req.body?.meta_data?.refId

      // ── Signature gate. DynoPay signs webhooks (X-Dynopay-Signature-V2 =
      // HMAC-SHA256 over "<t>.<rawBody>") ONLY when a whsec_ secret is
      // configured on the endpoint. If we hold a secret and a signature is
      // present but INVALID → reject outright (kills forged callbacks). If no
      // secret is configured, DynoPay sends the payload unsigned and we fall
      // back to the server-to-server status re-verify below.
      const secret = webhookSecret()
      const sigState = verifyDynopayWebhook({
        rawBody: req.rawBody, bodyObj: req.body, headers: req.headers, secret,
      })
      // Signature scheme diagnostic: on ANY invalid signature (the anomaly we're
      // chasing) — or whenever DYNO_PAY_WEBHOOK_SIG_DEBUG=true — log the sender's
      // v1 vs every plausible HMAC construction, so we can pin down DynoPay's
      // exact scheme (key form / encoding / ts unit / raw vs canonical body) from
      // the next real webhook. Safe: signatures are truncated in the output.
      if (secret && (sigState === 'invalid' || process.env.DYNO_PAY_WEBHOOK_SIG_DEBUG === 'true')) {
        try { log(`[Store][SIGDEBUG] ${JSON.stringify(diagnoseDynopaySignature({ rawBody: req.rawBody, headers: req.headers, secret }))}`) } catch (_) {}
      }
      // Graduated enforcement: by default an INVALID signature is logged +
      // admin-alerted but NOT hard-rejected — it falls through to the
      // authoritative server-to-server re-verify (which already holds on any
      // unpaid/unreachable state), so a DynoPay signing-format quirk can never
      // reject a genuinely-paid order. Flip DYNO_PAY_WEBHOOK_SIG_ENFORCE=true
      // to 401 outright once prod logs confirm real webhooks show sig=valid.
      const enforceSig = process.env.DYNO_PAY_WEBHOOK_SIG_ENFORCE === 'true'
      if (secret && sigState === 'invalid') {
        log(`[Store] crypto-webhook INVALID signature (ref=${refId}, pid=${paymentId}) enforce=${enforceSig}`)
        try { notifyAdmin(`🚫 <b>Store crypto webhook — INVALID signature</b>\nRef: <code>${refId || '—'}</code>\nPaymentId: ${paymentId || '—'}\nEvent: ${event}\nEnforce: ${enforceSig}\n${enforceSig ? '(REJECTED 401)' : '(not enforced — falling through to gateway re-verify; possible spoof OR signing-format mismatch — check logs)'}`) } catch {}
        if (enforceSig) return res.status(401).send('invalid signature')
      }
      const signatureValid = sigState === 'valid'

      // pending: just record the paymentId→order mapping
      if (event === 'payment.pending' || req.body?.status === 'pending') {
        if (refId && paymentId) {
          await col('webOrders').updateOne({ _id: refId }, { $set: { paymentId, updatedAt: now() } }).catch(() => {})
        }
        return res.send('OK')
      }
      // created (new DynoPay lifecycle event) / any non-paid informational
      // event → record the paymentId→order mapping only; DON'T run the credit
      // path (avoids spurious "HELD" admin alerts before the customer has paid).
      if (event === 'payment.created' || req.body?.status === 'created') {
        if (refId && paymentId) {
          await col('webOrders').updateOne({ _id: refId }, { $set: { paymentId, updatedAt: now() } }).catch(() => {})
        }
        return res.send('OK')
      }
      if (event === 'payment.failed') {
        if (refId) await col('webOrders').updateOne({ _id: refId, status: 'pending' }, { $set: { status: 'failed', updatedAt: now() } }).catch(() => {})
        return res.send('OK')
      }

      // confirmed / settled / underpaid(with funds) → credit
      let order = null
      if (refId) order = await col('webOrders').findOne({ _id: refId })
      if (!order && paymentId) order = await col('webOrders').findOne({ paymentId })
      if (!order) { log(`[Store] webhook: no matching order (ref=${refId}, pid=${paymentId})`); return res.send('OK') }

      if (order.status === 'credited' || order.status === 'provisioned') { log(`[Store] webhook dup for ${order._id}`); return res.send('OK') }

      // ── Re-verify with DynoPay server-to-server. The webhook body is
      // UNTRUSTED — both the paid DECISION and the credited AMOUNT come from the
      // authoritative gateway status (or the invoiced order.amountUsd), NEVER
      // from req.body.base_amount / req.body.status. A valid webhook signature
      // (signatureValid) is an additional authenticity signal that lets a
      // gateway-unreachable webhook still fulfill. (Dev bypass:
      // STORE_DEV_TRUST_WEBHOOK=true — credits the INVOICED amount only.)
      const trustBody = process.env.STORE_DEV_TRUST_WEBHOOK === 'true'
      let authSt = null
      if (!trustBody && order.provider === 'dynopay') {
        authSt = await fetchAuthoritativeStatus(order)
        const gatewayReached = !!authSt
        const gatewayStatus = gatewayReached ? authSt.status : null
        const decision = classifyStoreWebhook({ event, gatewayReached, gatewayStatus, signatureValid })
        log(`[Store] webhook ${order._id}: decision=${decision.action} (${decision.reason}) sig=${sigState}`)
        if (decision.action === 'hold') {
          try { notifyAdmin(`⚠️ <b>Store crypto webhook HELD</b>\nOrder: <code>${order._id}</code>\nKind: ${order.kind}\nDomain: ${order.domain || '—'}\nCustomer: ${order.email || order.webUserId || '—'}\nAmount: $${order.amountUsd} (${order.coin})\nEvent: ${event}\nSignature: ${sigState}\nReason: ${decision.reason}\n→ verify in DynoPay; if genuinely paid, reconcile via /api/store/admin/reconcile-order/${order._id}`) } catch {}
          return res.send('OK')
        }
        if (decision.action === 'unverified-fulfill') {
          try { notifyAdmin(`ℹ️ <b>Store crypto order fulfilling on SIGNED webhook (gateway unreachable)</b>\nOrder: <code>${order._id}</code>\nDomain: ${order.domain || '—'}\nCustomer: ${order.email || order.webUserId || '—'}\nAmount: $${order.amountUsd} (${order.coin})\nReason: ${decision.reason} — crediting invoiced amount; verify in DynoPay`) } catch {}
        }
      }

      // Authoritative amount: gateway-confirmed USD when reachable, else the
      // invoiced order.amountUsd (passed as null → creditTopup falls back).
      const authAmount = authSt ? authoritativeUsd(authSt) : null
      const authFeePayer = authSt ? (authSt.fee_payer != null ? authSt.fee_payer : 'company') : null

      if (order.kind === 'hosting') {
        await fulfillHostingOrder(order, authAmount, authFeePayer, paymentId, `dynopay:${event}`)
      } else {
        await creditTopup(order, authAmount, authFeePayer, paymentId, `dynopay:${event}`)
      }
      return res.send('OK')
    } catch (err) {
      log(`[Store] crypto-webhook error: ${err.message}`)
      return res.status(200).send('OK') // never make the provider retry-storm on our bug
    }
  })

  // ── BlockBee webhook (fallback). BlockBee calls back via GET with query params. ──
  async function handleBlockbee(req, res) {
    try {
      const orderId = req.query.order || req.query.orderId
      const valueCoin = req.query.value_coin || req.query.value
      const confirmations = Number(req.query.confirmations || 0)
      if (!orderId) return res.send('*ok*')
      const order = await col('webOrders').findOne({ _id: orderId })
      if (!order) return res.send('*ok*')
      if (order.status === 'credited') return res.send('*ok*')
      // Require at least 1 confirmation
      if (confirmations < 1) return res.send('*ok*')
      // Convert received coin value → USD
      let usd = order.amountUsd
      try { const c = await convert(valueCoin, coinByCode(order.coin)?.bbTicker || 'btc', 'usd'); if (Number.isFinite(c) && c > 0) usd = c } catch (_) {}
      if (order.kind === 'hosting') {
        await fulfillHostingOrder(order, usd, 'company', `bb_${orderId}`, 'blockbee')
      } else {
        await creditTopup({ ...order, amountUsd: usd }, usd, 'company', `bb_${orderId}`, 'blockbee')
      }
      return res.send('*ok*')
    } catch (err) {
      log(`[Store] blockbee-webhook error: ${err.message}`)
      return res.send('*ok*')
    }
  }
  router.get('/blockbee-webhook', handleBlockbee)
  router.post('/blockbee-webhook', handleBlockbee)

  // ── ADMIN: force-reconcile a stuck crypto order (provisions / credits). ──
  // Gated by the admin key (first 16 chars of SESSION_SECRET). Because this
  // registers a REAL domain + creates a REAL cPanel (or credits a wallet), it
  // is a two-step call: without ?confirm=true it only PREVIEWS the order.
  //   POST /api/store/admin/reconcile-order/<id>?key=<adminKey>            (preview)
  //   POST /api/store/admin/reconcile-order/<id>?key=<adminKey>&confirm=true[&amountUsd=67.31][&feePayer=company]
  router.post('/admin/reconcile-order/:orderId', async (req, res) => {
    if (req.query.key !== (process.env.SESSION_SECRET || '').slice(0, 16)) {
      return res.status(403).json({ error: 'forbidden' })
    }
    try {
      const order = await col('webOrders').findOne({ _id: req.params.orderId })
      if (!order) return res.status(404).json({ error: 'order not found' })
      if (order.status === 'provisioned' || order.status === 'credited') {
        return res.json({ ok: true, alreadyDone: true, status: order.status, username: order.username || null, domain: order.domain || null })
      }
      if (req.query.confirm !== 'true') {
        return res.json({
          ok: false, wouldReconcile: true,
          order: { id: order._id, kind: order.kind, status: order.status, domain: order.domain, email: order.email || order.webUserId, amountUsd: order.amountUsd, coin: order.coin },
          hint: 'add &confirm=true to actually provision/credit (optionally &amountUsd=<received>&feePayer=company)',
        })
      }
      // Reset to pending so the atomic claim in fulfillHostingOrder succeeds.
      if (['failed', 'fulfilling'].includes(order.status)) {
        await col('webOrders').updateOne({ _id: order._id }, { $set: { status: 'pending', updatedAt: now() } })
        order.status = 'pending'
      }
      const amountOverride = req.query.amountUsd != null ? parseFloat(req.query.amountUsd) : order.amountUsd
      const feePayer = req.query.feePayer || 'company'
      let result
      if (order.kind === 'hosting') {
        result = await fulfillHostingOrder(order, amountOverride, feePayer, order.paymentId, 'admin-reconcile')
      } else {
        result = await creditTopup(order, amountOverride, feePayer, order.paymentId, 'admin-reconcile')
      }
      const fresh = await col('webOrders').findOne({ _id: order._id })
      log(`[Store] admin-reconcile ${order._id}: result=${!!result} status=${fresh?.status}`)
      return res.json({ ok: !!result, status: fresh?.status, username: fresh?.username || null, domain: fresh?.domain || null, note: fresh?.note || null })
    } catch (err) {
      log(`[Store] reconcile-order error: ${err.message}`)
      return res.status(500).json({ error: err.message })
    }
  })

  // health/info
  router.get('/health', (req, res) => res.json({ ok: true, coins: COINS.map(c => c.code) }))

  // ═══════════════════════ PHASE 2: STOREFRONT (plans + buy hosting from wallet) ═══════════════════════

  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
  function plansCatalog() {
    return [
      {
        id: 'premium-weekly', name: 'Premium Anti-Red (1-Week)', tier: 'premium',
        priceUsd: num(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE, 30), durationDays: 7, addons: 1,
        features: ['Anti-Red protection', '1 addon domain', 'HostPanel + File Manager', '7 days'],
      },
      {
        id: 'premium-monthly', name: 'Premium Anti-Red HostPanel (1-Month)', tier: 'premium',
        priceUsd: num(process.env.PREMIUM_ANTIRED_CPANEL_PRICE, 75), durationDays: 30, addons: 5,
        features: ['Anti-Red protection', '5 addon domains', 'MySQL databases', '30 days'],
      },
      {
        id: 'golden-monthly', name: 'Golden Anti-Red HostPanel (1-Month)', tier: 'gold',
        priceUsd: num(process.env.GOLDEN_ANTIRED_CPANEL_PRICE, 100), durationDays: 30, addons: 'unlimited',
        features: ['Anti-Red protection', 'Unlimited addon domains', 'Visitor Captcha + Geo', '30 days'],
      },
    ]
  }
  const planById = (id) => plansCatalog().find(p => p.id === id)
  const domainOk = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(d || '').trim())

  router.get('/plans', (req, res) => res.json({ plans: plansCatalog() }))

  // Domain availability + price (public — guests can price domains at checkout)
  router.get('/domain/search', async (req, res) => {
    try {
      const domain = String(req.query.domain || '').trim().toLowerCase()
      if (!domainOk(domain)) return res.status(400).json({ error: 'Enter a valid domain (e.g. mysite.com).' })
      const ds = require('./domain-service')
      const r = await ds.checkDomainPrice(domain, getDb && getDb())
      return res.json({ domain, available: !!r.available, priceUsd: r.available ? Number(r.price) : 0, registrar: r.registrar || null, message: r.message || '' })
    } catch (err) {
      log(`[Store] domain search error: ${err.message}`)
      return res.status(500).json({ error: 'Domain lookup failed. Try again shortly.' })
    }
  })

  // Buy a hosting plan, paid from wallet. domainMode: 'byo' (bring your own) | 'buy' (register new).
  router.post('/hosting/purchase', webAuth, async (req, res) => {
    const planId = req.body?.planId
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    const domainMode = req.body?.domainMode === 'buy' ? 'buy' : 'byo'
    const plan = planById(planId)
    if (!plan) return res.status(400).json({ error: 'Unknown plan.' })
    if (!domainOk(domain)) return res.status(400).json({ error: 'Enter a valid domain (e.g. mysite.com).' })

    try {
      // One active hosting account per domain (mirrors provisioning idempotency guard)
      const dup = await col('cpanelAccounts').findOne({ domain, deleted: { $ne: true } })
      if (dup) return res.status(409).json({ error: 'That domain already has an active hosting plan.' })

      // Price the order
      let domainPrice = 0
      let registrar = null
      if (domainMode === 'buy') {
        const ds = require('./domain-service')
        const dp = await ds.checkDomainPrice(domain, getDb && getDb())
        if (!dp.available) return res.status(409).json({ error: dp.message || 'That domain is not available — try another.' })
        domainPrice = Number(dp.price) || 0
        registrar = dp.registrar || null
      }
      const total = Math.round((Number(plan.priceUsd) + domainPrice) * 100) / 100

      // Atomically debit the wallet ONLY if balance is sufficient (prevents races/overspend)
      const debit = await col('webUsers').findOneAndUpdate(
        { _id: req.webUserId, walletUsd: { $gte: total } },
        { $inc: { walletUsd: -total } },
        { returnDocument: 'after' }
      )
      const debited = debit && (debit.value || debit)
      if (!debited || typeof debited.walletUsd !== 'number') {
        const u = await publicUser(req.webUserId)
        return res.status(402).json({
          error: `Insufficient wallet balance. This order is $${total}; your balance is $${u?.walletUsd || 0}. Please top up.`,
          needTopup: true, required: total, balanceUsd: u?.walletUsd || 0,
        })
      }
      const balanceAfter = Number(debited.walletUsd)
      await col('webWalletTxns').insertOne({
        _id: uuid(), webUserId: req.webUserId, type: 'purchase', amountUsd: -total, balanceAfter,
        coin: null, provider: 'wallet', orderId: null, status: 'done',
        note: `Hosting: ${plan.name} — ${domain}${domainMode === 'buy' ? ' (+domain)' : ''}`, createdAt: now(),
      })

      // Provision via the proven pipeline (registers domain when domainMode='buy', else BYO)
      const user = await col('webUsers').findOne({ _id: req.webUserId })
      const stateCol = col('state')
      const noop = () => {}
      const info = {
        _id: req.webUserId,            // acts as the owner id (chatId slot)
        website_name: domain,
        plan: plan.name,
        email: user?.email || null,
        userLanguage: 'en',
        price: total,
        hostingPrice: plan.priceUsd,
        domainPrice,
        registrar,
        source: 'web',
        // GAP-1 FIX (2026-09): Cloudflare NS so the web DNS (root+www CNAME → tunnel) is created,
        // matching the bot. Omitting it left the CF zone with only NS records → site never resolved.
        nameserver: 'cloudflare',
        nsChoice: 'cloudflare',
      }
      if (domainMode === 'byo') { info.existingDomain = true; info.connectExternalDomain = true }

      let result
      try {
        const { registerDomainAndCreateCpanel } = require('./cr-register-domain-&-create-cpanel.js')
        result = await registerDomainAndCreateCpanel(noop, info, [], stateCol, null)
      } catch (e) {
        log(`[Store] provision threw: ${e.message}`)
        result = { success: false, error: e.message }
      }

      if (!result?.success) {
        // Refund the wallet — provisioning failed, user keeps their funds.
        const ref = await col('webUsers').findOneAndUpdate(
          { _id: req.webUserId }, { $inc: { walletUsd: total } }, { returnDocument: 'after' }
        )
        const refDoc = ref && (ref.value || ref)
        await col('webWalletTxns').insertOne({
          _id: uuid(), webUserId: req.webUserId, type: 'refund', amountUsd: total,
          balanceAfter: Number(refDoc?.walletUsd || balanceAfter + total), coin: null, provider: 'wallet',
          orderId: null, status: 'done', note: `Refund — provisioning failed (${domain})`, createdAt: now(),
        })
        log(`[Store] purchase provision FAILED for ${domain} — refunded $${total} to ${req.webUserId}`)
        return res.status(502).json({ error: 'We could not set up your hosting right now and have refunded your wallet. Please try again shortly.' })
      }

      // Link the new cPanel account to this web identity so it shows under "My Plans".
      try {
        await col('cpanelAccounts').updateOne(
          { _id: String(result.username).toLowerCase() },
          { $set: { webUserId: req.webUserId, source: 'web', ownerEmail: user?.email || null } }
        )
      } catch (e) { log(`[Store] link cpanelAccount warning: ${e.message}`) }

      log(`[Store] PURCHASE ok — ${req.webUserId} bought ${plan.name} on ${domain} (cpUser=${result.username})`)
      return res.json({
        success: true, username: result.username, pin: result.pin, domain, plan: plan.name,
        balanceUsd: balanceAfter, nameservers: result.nameservers || [],
      })
    } catch (err) {
      log(`[Store] purchase error: ${err.message}`)
      return res.status(500).json({ error: 'Purchase failed. If your wallet was charged it will be auto-refunded — contact support if not.' })
    }
  })

  // List the hosting plans owned by this web account.
  router.get('/my-plans', webAuth, async (req, res) => {
    try {
      const accts = await col('cpanelAccounts').find({ webUserId: req.webUserId, deleted: { $ne: true } })
        .project({ cpUser: 1, domain: 1, plan: 1, expiryDate: 1, addonDomains: 1, suspended: 1 }).toArray()
      res.json({
        plans: accts.map(a => ({
          cpUser: a.cpUser || a._id, domain: a.domain, plan: a.plan,
          expiryDate: a.expiryDate || null, addonCount: (a.addonDomains || []).length,
          suspended: !!a.suspended,
        })),
      })
    } catch (err) {
      log(`[Store] my-plans error: ${err.message}`)
      res.status(500).json({ error: 'Could not load your plans.' })
    }
  })

  // Bridge: mint a HostPanel JWT for a plan this web user owns (no PIN needed —
  // they're already authenticated as the owner). The existing panel uses this token.
  router.post('/open-panel', webAuth, async (req, res) => {
    try {
      const cpUser = String(req.body?.cpUser || '').toLowerCase()
      if (!cpUser) return res.status(400).json({ error: 'cpUser is required' })
      const acct = await col('cpanelAccounts').findOne({ _id: cpUser, webUserId: req.webUserId, deleted: { $ne: true } })
      if (!acct) return res.status(404).json({ error: 'Plan not found for your account.' })
      const cpAuth = require('./cpanel-auth')
      const token = cpAuth.createToken({ cpUser: acct.cpUser, domain: acct.domain, chatId: acct.chatId })
      return res.json({ token, cpUser: acct.cpUser, domain: acct.domain })
    } catch (err) {
      log(`[Store] open-panel error: ${err.message}`)
      res.status(500).json({ error: 'Could not open panel.' })
    }
  })

  // ── Direct crypto payment for a plan (logged-in OR guest) ──
  async function createHostingCryptoOrder({ webUserId, email, planId, domain, domainMode, coin }) {
    const plan = planById(planId)
    if (!plan) return { error: 'Unknown plan.', code: 400 }
    if (!domainOk(domain)) return { error: 'Enter a valid domain (e.g. mysite.com).', code: 400 }
    const c = coinByCode(coin)
    if (!c) return { error: 'Unsupported coin.', code: 400 }
    const dup = await col('cpanelAccounts').findOne({ domain, deleted: { $ne: true } })
    if (dup) return { error: 'That domain already has an active hosting plan.', code: 409 }

    let domainPrice = 0, registrar = null
    if (domainMode === 'buy') {
      const ds = require('./domain-service')
      const dp = await ds.checkDomainPrice(domain, getDb && getDb())
      if (!dp.available) return { error: dp.message || 'That domain is not available — try another.', code: 409 }
      domainPrice = Number(dp.price) || 0; registrar = dp.registrar || null
    }
    const total = Math.round((Number(plan.priceUsd) + domainPrice) * 100) / 100
    const orderId = uuid()
    const webhookUrl = `${SELF_URL}/store/crypto-webhook`
    const order = {
      _id: orderId, webUserId: webUserId || null, email, kind: 'hosting',
      planId, plan: plan.name, hostingPrice: plan.priceUsd, domainPrice,
      domain, domainMode, registrar, amountUsd: total, coin: c.code, provider: 'dynopay',
      status: 'pending', payAddress: null, paymentId: null, createdAt: now(), updatedAt: now(),
    }

    let address = null
    try {
      const dyno = await getDynopayCryptoAddress(total, c.code, webhookUrl, { product_name: 'hosting', refId: orderId, kind: 'hosting', webUserId: webUserId || 'guest' })
      if (dyno && !dyno.error && (dyno.address || dyno.wallet_address)) { address = dyno.address || dyno.wallet_address; order.paymentId = dyno.payment_id || dyno.id || null }
    } catch (e) { log(`[Store] hosting pay-crypto DynoPay threw: ${e.message}`) }
    if (!address) {
      try { const bb = await getCryptoDepositAddress(c.bbTicker, orderId, SELF_URL, `/store/blockbee-webhook?order=${orderId}&`); if (bb?.address) { address = bb.address; order.provider = 'blockbee' } } catch (_) {}
    }
    if (!address) return { error: 'Payment provider unavailable right now. Please try again shortly.', code: 502 }

    order.payAddress = address
    await col('webOrders').insertOne(order)
    log(`[Store] hosting crypto order ${orderId} ${plan.name} ${domain} $${total} ${c.code} via ${order.provider} (${webUserId ? 'user' : 'GUEST'})`)
    return { orderId, address, coin: c.code, amountUsd: total, plan: plan.name, domain }
  }

  router.post('/hosting/pay-crypto', webAuth, async (req, res) => {
    const r = await createHostingCryptoOrder({
      webUserId: req.webUserId, email: req.webEmail, planId: req.body?.planId,
      domain: String(req.body?.domain || '').toLowerCase().trim(),
      domainMode: req.body?.domainMode === 'buy' ? 'buy' : 'byo', coin: req.body?.coin,
    })
    if (r.error) return res.status(r.code || 400).json({ error: r.error })
    res.json(r)
  })

  // GUEST checkout — no account needed. Email required (credentials are emailed + shown).
  router.post('/guest/checkout', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required to receive your login details.' })
    const r = await createHostingCryptoOrder({
      webUserId: null, email, planId: req.body?.planId,
      domain: String(req.body?.domain || '').toLowerCase().trim(),
      domainMode: req.body?.domainMode === 'buy' ? 'buy' : 'byo', coin: req.body?.coin,
    })
    if (r.error) return res.status(r.code || 400).json({ error: r.error })
    res.json(r)
  })

  // Public order status (the unguessable orderId is the access token). Reveals
  // credentials once provisioned — used by both guest + logged-in crypto checkout.
  router.get('/order/:orderId', async (req, res) => {
    try {
      const o = await col('webOrders').findOne({ _id: req.params.orderId })
      if (!o || o.kind !== 'hosting') return res.status(404).json({ error: 'Order not found' })
      if (o.status === 'pending' && o.provider === 'dynopay' && (o.payAddress || o.paymentId)) {
        try {
          const st = await fetchAuthoritativeStatus(o)
          if (st && isPaidStatus(st.status)) {
            await fulfillHostingOrder(o, authoritativeUsd(st), st.fee_payer, o.paymentId || st.payment_id, 'poll')
          }
        } catch (_) {}
      }
      const f = await col('webOrders').findOne({ _id: req.params.orderId })
      const resp = { orderId: f._id, status: f.status, domain: f.domain, plan: f.plan, amountUsd: f.amountUsd, coin: f.coin, address: f.payAddress }
      if (f.status === 'provisioned') { resp.username = f.username; resp.pin = f.pin; resp.nameservers = f.nameservers || [] }
      res.json(resp)
    } catch (err) {
      log(`[Store] order status error: ${err.message}`)
      res.status(500).json({ error: 'Could not fetch order.' })
    }
  })

  return router
}

module.exports = { createStoreRoutes, mintBotLoginToken, verifyBotLoginToken }
