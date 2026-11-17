'use strict'
// CloudIVR web app API (mounted at /cloudivr-web → external /api/cloudivr-web). Web-only accounts drive the
// bot's existing phone engine through a reserved chatId range; see notify.js.
const express = require('express')
const multer = require('multer')
const notify = require('./notify')
const { createAuth } = require('./auth')
const wallet = require('./wallet')
const numbers = require('./numbers')
const verification = require('./verification')
const audio = require('./audio')
const calls = require('./calls')
const contacts = require('./contacts')
const orders = require('./orders')
const trycall = require('./trycall')
const publicStats = require('./public-stats')
const notes = require('./notes')
const outbound = require('./outbound')
const extras = require('./extras')
const onboarding = require('./onboarding')
const leads = require('./leads')
const support = require('./support')
const ai = require('./ai')
const referrals = require('./referrals')
const suggestions = require('./suggestions')
const relay = require('./relay')
const incoming = require('./incoming')
const smsReplyMod = require('./sms-reply')
const textTriggers = require('./text-triggers')
const ringGroup = require('./ring-group')
const webhooks = require('./events')
const aiSummary = require('./ai-summary')
const { sendMail } = require('./auth')
const { createEmails } = require('./emails')
const { createOffers } = require('./offers')
const { scrubProviderNames } = require('../sanitize-provider')

// API messages (top level, and per-call errors in results / calls lists) never name the carrier or registrar.
const MSG_KEYS = ['message', 'error', 'detail']
function scrubBody(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b
  for (const k of MSG_KEYS) if (typeof b[k] === 'string') b[k] = scrubProviderNames(b[k])
  for (const list of [b.results, b.calls]) if (Array.isArray(list)) for (const x of list) if (x && typeof x.error === 'string') x.error = scrubProviderNames(x.error)
  return b
}

function createCloudIvrWeb(deps) {
  const { getDb, log = console.log } = deps
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
  const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } })
  const h = (fn) => async (req, res, next) => {
    try { await fn(req, res, next) } catch (e) {
      log(`[CloudIVR-Web] ${req.method} ${req.path} failed: ${e.stack || e.message}`)
      if (!res.headersSent) res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again — if it keeps happening, message support.' })
    }
  }

  function build(db) {
    const r = express.Router()
    const auth = createAuth(db, { log, notifyAdmin: deps.notifyAdmin })
    auth.routes(r, h)
    require('./statement').start(db, { log })
    require('../ivr-live-data').init({ db, log, notify: (chatId, text) => require('./notify').push(chatId, text, null, { kind: 'call' }).catch(() => {}) })
    require('./ivr-connections').publicRoutes(r, { h })
    r.get('/public/catalog', h(async (req, res) => { const c = numbers.catalog(); res.json({
      ...c, cardPayments: c.cardPayments || mollie.cardsLive(req), paymentMethods: await mollie.publicMethods(req).catch(() => []), coins: deps.coins || [], minTopup: wallet.MIN_TOPUP_USD, supportLink: support.supportLink(), channelLink: String(process.env.CLOUDIVR_CHANNEL_LINK || '').trim(),
    }) }))
    trycall.routes(r, { ...deps, db, h })
    publicStats.routes(r, { db, h })
    onboarding.publicRoutes(r, { db, h })
    support.publicRoutes(r, { db, h, log })
    const emails = createEmails(db, { log })
    emails.publicRoutes(r, { h })
    emails.start()
    ai.publicRoutes(r, { h })
    // Resend inbound email webhook (no auth — Resend calls this)
    const inboundEmail = require('./inbound-email').createInboundEmail(db)
    // Owner admin dashboard (own sign-in, before the customer session check).
    const adminAuth = require('./admin-auth').createAdminAuth(db, { log })
    adminAuth.routes(r, h)
    require('./admin').createAdmin(db, { log, bulkCallService: deps.bulkCallService, adminAuth }).routes(r, h)
    inboundEmail.routes(r, h, adminAuth.require)
    require('../sms-optout').init(db)
    require('../number-addons').init(db)
    const compliance = require('./compliance').createCompliance({ db, h, adminRequire: adminAuth.require, notifyAdmin: deps.notifyAdmin, notify: require('./notify'), log })
    compliance.adminRoutes(r)
    const tenDlc = require('./ten-dlc').createTenDlc({ db, h, adminRequire: adminAuth.require, notify: require('./notify'), notifyAdmin: deps.notifyAdmin, walletOps: require('./wallet').walletOps, log })
    tenDlc.adminRoutes(r)
    const tollFree = require('./tollfree').createTollFree({ db, h, adminRequire: adminAuth.require, notify: require('./notify'), notifyAdmin: deps.notifyAdmin, log })
    tollFree.adminRoutes(r)
    const invoices = require('./invoices').createInvoices({ db, h, adminRequire: adminAuth.require, log })
    invoices.adminRoutes(r)
    // Country add-ons: our monthly cost per country/type (cheapest provider) next to the add-on the admin charges.
    r.get('/admin/number-addons', adminAuth.require, h(async (req, res) => {
      const cat = require('../number-catalog'), add = require('../number-addons')
      const items = Object.entries(cat.sold()).flatMap(([cc, types]) => types.map(t => { const b = cat.best(cc, t); return b && b.cost < 99 ? { country: cc, name: cat.nameOf(cc), type: t, provider: b.provider, cost: b.cost, level: b.level, addon: add.get(cc, t) } : null }).filter(Boolean))
      res.json({ items: items.sort((a, b) => b.cost - a.cost) })
    }))
    r.put('/admin/number-addons', adminAuth.require, h(async (req, res) => {
      const { country, type, amount } = req.body || {}
      if (!/^[A-Z]{2}$/i.test(country || '') || !['local', 'mobile', 'national', 'toll_free'].includes(type)) return res.status(400).json({ error: 'invalid', message: 'Pick a country and number type.' })
      res.json({ addon: await require('../number-addons').set(country, type, amount) })
    }))
    require('../active-slot').singletonInterval('cloudivr-10dlc', () => tenDlc.tick().catch(e => log(`[10DLC] tick: ${e.message}`)), 60 * 60000)
    require('../active-slot').singletonInterval('cloudivr-tollfree', () => tollFree.tick().catch(e => log(`[TollFree] tick: ${e.message}`)), 60 * 60000)
    module.exports.stripeWebhook = compliance.webhook
    require('./esim').publicRoutes(r, { db, h, log, A: adminAuth.require })
    require('./media').publicRoutes(r, { db, h })
    require('./fax').publicRoutes(r, { db, h })
    require('../ivr-outbound').setPickLogDb(db)
    let offersRef = null, cardCheckRef = null
    // Runs a saved order as its owner (card payment settled / ID check released).
    const replay = async (chatId, a) => { const cookie = await auth.replayCookie(chatId); const r = await require('axios')({ method: a.method, url: `http://127.0.0.1:${process.env.PORT}/cloudivr-web${a.path}`, data: a.body, headers: { cookie, 'x-card-replay': '1' }, validateStatus: () => true, timeout: 60000 }); return { status: r.status, message: r.data?.message || null, data: r.data } }
    const mollie = require('./mollie').createMollie(db, { log, notifyAdmin: deps.notifyAdmin, getOffers: () => offersRef, getCardCheck: () => cardCheckRef, replay, push: (id, text) => notify.push(id, text, null, { kind: 'payment' }) })
    mollie.publicRoutes(r, { h })
    const cardCheck = cardCheckRef = require('./card-check').createCardCheck(db, { log, notifyAdmin: deps.notifyAdmin, push: (id, text) => notify.push(id, text, null, { kind: 'payment' }), refundPayment: mollie.refund, replay, retrieveSession: compliance.retrieveSession, applySession: compliance.applySession })
    compliance.hooks.onIdentity = cardCheck.onIdentity
    cardCheck.adminRoutes(r, h, adminAuth.require)
    require('../active-slot').singletonInterval('cloudivr-card-check', () => cardCheck.tick().catch(e => log(`[CardCheck] tick: ${e.message}`)), 5 * 60000)
    require('./journey').createJourney({ db, h, accountOf: (req) => new Promise(ok => auth.requireUser(req, { status: () => ({ json: () => ok(null) }) }, () => ok(req.webChatId))) }).routes(r)
    r.use(auth.requireUser)
    // Checkout paid by card while the money is held for the ID check: save the order, run it once released.
    r.use(h(async (req, res, next) => {
      const ref = String(req.headers['x-card-hold-ref'] || '')
      if (!ref || !['POST', 'PUT', 'PATCH'].includes(req.method) || req.headers['x-card-replay']) return next()
      const dep = await db.collection('webDeposits').findOne({ ref, chatId: req.webChatId, provider: 'mollie', idHold: true })
      if (!dep) return next()
      // Wallet part of a wallet + card checkout: set aside so it can't be spent before the order runs.
      const reserved = await cardCheck.reserve(req.webChatId, req.headers['x-card-hold-reserve'])
      await db.collection('webDeposits').updateOne({ _id: dep._id }, { $push: { pendingActions: { method: req.method, path: req.path, body: req.body || {}, at: new Date() } }, $inc: { reservedUsd: reserved } })
      log(`[CardCheck] ${req.webChatId} order ${req.method} ${req.path} saved until ${ref} is released${reserved ? ` ($${reserved} wallet part set aside)` : ''}`)
      res.status(202).json({ queued: true, message: 'Payment received. Your order is saved and goes through automatically as soon as your ID check is approved.' })
    }))
    invoices.routes(r)
    // Admin alert when web content is named after a bank / FDIC / IRS (alert only).
    r.use((req, _res, next) => {
      if ((req.method === 'POST' || req.method === 'PUT') && /^\/(ai-agents|calls\/(quick|presets|trial)|campaigns|audio\/tts|outbound)/.test(req.path))
        require('../scam-watch').watch({ chatId: req.webChatId, who: req.webUser?.email, where: `CloudIVR web ${req.method} ${req.path}`, data: req.body })
      next()
    })
    // Personal / business details: required before any number checkout.
    const legalProfile = require('./legal-profile').createLegalProfile(db, { log })
    legalProfile.routes(r, h)
    r.post(['/numbers/buy', '/numbers/checkout', '/numbers/:phone/extra-checkout', '/numbers/:phone/extra', '/numbers/:phone/replace', '/fax-numbers', '/mobile-numbers', '/esim', '/numbers/request'], legalProfile.gate)
    r.post(['/calls/quick', '/calls/trial', '/calls/callback', '/calls/history/:id/redial', '/campaigns', '/campaigns/:id/start', '/campaigns/:id/followup', '/relay/calls', '/ai-agents/:id/test'], legalProfile.callGate)
    // Permission to call: confirmed on every campaign, once per account for Quick IVR — each confirmation is logged.
    const perms = db.collection('callPermissions')
    const permission = (kind) => h(async (req, res, next) => {
      const b = req.body || {}, acc = req.webUser
      if (kind === 'quick' && acc?.quickIvrPermissionAt) return next()
      if (kind === 'campaign' && b.validateOnly) return next()
      if (b.permissionConfirmed !== true) return res.status(428).json({ error: 'permission_required', kind, message: kind === 'quick' ? 'Confirm you have permission to call the numbers you call with Quick IVR. We ask this once.' : 'Confirm you have permission to call every number in this campaign.' })
      // Logged only once the call / campaign is accepted, so a rejected form doesn't use up the confirmation.
      res.on('finish', () => {
        if (res.statusCode >= 300) return
        const at = new Date(), leads = typeof b.leads === 'string' ? b.leads.split(/[\s,;]+/).filter(Boolean).length : Array.isArray(b.leads) ? b.leads.length : null
        perms.insertOne({ chatId: req.webChatId, kind, campaign: kind === 'campaign' ? { name: String(b.name || '').slice(0, 120), mode: b.mode || 'ivr', numbers: leads ?? (b.listId ? `list:${b.listId}` : null), scheduleAt: b.scheduledFor || null } : undefined, ip: req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200), at }).catch(e => log(`[Permission] log failed: ${e.message}`))
        if (kind === 'quick') db.collection('webAccounts').updateOne({ _id: acc._id }, { $set: { quickIvrPermissionAt: at } }).catch(() => {})
      })
      next()
    })
    r.post('/campaigns', permission('campaign'))
    r.post('/calls/quick', permission('quick'))
    require('./esim').routes(r, { h, legalProfile })
    const offers = createOffers(db, { log })
    offers.routes(r, { h })
    offersRef = offers
    mollie.routes(r, { h })
    cardCheck.routes(r, h)
    wallet.routes(r, { db, h, coins: deps.coins, createCryptoDeposit: deps.createCryptoDeposit, offers, cryptoPerUsd: deps.cryptoPerUsd })
    // Orders go first so /numbers/orders is not caught by /numbers/:phone; numbersApi is filled in right after.
    const numbersApi = {}
    // Infobip request-based countries (pay now, number assigned after Infobip approves; refund if declined).
    const numberRequests = require('./number-requests').createNumberRequests({ db, h, phoneConfig: require('../phone-config'), numbersApi, walletOps: require('./wallet').walletOps, notify: require('./notify'), notifyAdmin: deps.notifyAdmin, log, dryRun: () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true' })
    numberRequests.routes(r)
    require('../active-slot').singletonInterval('cloudivr-number-requests', () => numberRequests.tick().catch(e => log(`[NumberRequest] tick: ${e.message}`)), process.env.WEB_CLOUDIVR_DRY_RUN === 'true' ? 60000 : 10 * 60000)
    orders.routes(r, { ...deps, db, h, numbersApi, sendMail, offers })
    // MultiTEL countries that need documents: upload before buying, emailed to MultiTEL after, approval watched.
    const numberDocs = require('./number-docs').createNumberDocs({ db, h, sendMail, legalProfile, notify: require('./notify'), notifyAdmin: deps.notifyAdmin, walletOps: require('./wallet').walletOps, log })
    numberDocs.routes(r)
    compliance.routes(r)
    tenDlc.routes(r)
    tollFree.routes(r)
    require('./lookup').createLookup({ db, h, walletOps: require('./wallet').walletOps, log }).routes(r)
    require('./travel-esim').createTravelEsim({ db, h, walletOps: require('./wallet').walletOps, notify: require('./notify'), notifyAdmin: deps.notifyAdmin, log }).routes(r)
    require('../active-slot').singletonInterval('cloudivr-number-docs', () => numberDocs.tick().catch(e => log(`[NumberDocs] tick: ${e.message}`)), 30 * 60000)
    Object.assign(numbersApi, numbers.routes(r, { ...deps, db, h, offers, legalProfile, numberDocs, compliance }))
    verification.routes(r, { ...deps, db, h, upload })
    audio.routes(r, { ...deps, db, h, upload })
    outbound.routes(r, { ...deps, db, h, numbersApi })
    contacts.routes(r, { db, h, upload })
    require('./hosted').routes(r, { db, h, upload, log, notifyAdmin: deps.notifyAdmin })
    calls.routes(r, { ...deps, db, h, numbersApi })
    notes.routes(r, { db, h, numbersApi })
    ai.routes(r, { h, numbersApi })
    require('./assist').routes(r, { h })
    require('./ivr-connections').routes(r, { h })
    extras.routes(r, { ...deps, db, h, numbersApi, offers })
    onboarding.routes(r, { db, h, numbersApi })
    require('./templates').routes(r, { db, h })
    leads.routes(r, { db, h })
    require('./caller-ids').routes(r, { db, h, numbersApi })
    // Caller-ID guard (financial-institution blocklist + AI detection)
    const cidGuard = require('./cid-guard')
    cidGuard.init(db, { notifyAdmin: deps.notifyAdmin, log })
    cidGuard.loadCustomBlocks().catch(e => log(`[CID-Guard] loadCustomBlocks: ${e.message}`))
    cidGuard.adminApi(r, h, adminAuth.require)
    support.routes(r, { ...deps, db, h, numbersApi })
    referrals.routes(r, { db, h })
    suggestions.routes(r, { ...deps, db, h })
    relay.routes(r, { ...deps, h, numbersApi })
    const smsReply = smsReplyMod.createSmsReply({ db, voiceService: deps.voiceService, log })
    smsReplyMod.routes(r, { db, h, numbersApi, smsReply })
    require('./missed-textback').init({ db, smsReply, numbersApi, log })
    require('./missed-textback').routes(r, { h, numbersApi })
    const messages = require('./messages').routes(r, { db, h, numbersApi, smsReply })
    require('./media').routes(r, { db, h, upload: mediaUpload })
    notify.routes(r, { h, numbersApi, smsReply })
    incoming.routes(r, { ...deps, db, h, numbersApi, smsReply })
    textTriggers.routes(r, { ...deps, db, h, numbersApi })
    ringGroup.routes(r, { h, numbersApi })
    require('./fax').routes(r, { db, h, upload, numbersApi, notifyAdmin: deps.notifyAdmin, legalProfile })
    webhooks.routes(r, { db, h, log })
    aiSummary.routes(r, { ...deps, db, h, numbersApi })
    emails.routes(r, { h })
    r.get('/dashboard', h(async (req, res) => {
      const id = req.webChatId
      const [nums, mobile, texting] = await Promise.all([numbersApi.myNumbers(id), numbers.mobileLines(db, id), numbers.textingLines(db, id)])
      const all = [...nums, ...mobile, ...texting], now = Date.now()
      const [balance, unread, campaigns, pendingVerification, trial, liveCampaigns, messagesUnread, textsThisMonth] = await Promise.all([
        wallet.walletOps(db).balance(id),
        db.collection('webNotifications').countDocuments({ chatId: id, read: false }),
        db.collection('bulkCallCampaigns').countDocuments({ chatId: id, status: { $in: ['running', 'paused', 'scheduled'] } }),
        db.collection('telnyxRegSessions').countDocuments({ chatId: id, status: 'collecting' }),
        outbound.trialStatus(db, numbersApi, id).catch(() => ({ available: false })),
        db.collection('bulkCallCampaigns').countDocuments({ chatId: id, status: 'running' }),
        messages.unreadCount(id).catch(() => 0),
        messages.textCount(id, new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))).catch(() => null),
      ])
      const soon = now + 7 * 86400000
      res.json({
        balance, unread, messagesUnread, activeCampaigns: campaigns, liveCampaigns, pendingVerification, ivrTrial: !!trial.available,
        numbers: { total: all.length, active: all.filter(n => n.status === 'active').length, expiringSoon: all.filter(n => { const t = n.expiresAt ? new Date(n.expiresAt).getTime() : NaN; return n.status === 'active' && t > now && t < soon }).length, mobile: mobile.length, texting: texting.length },
        minutesUsed: nums.reduce((s, n) => s + (n.minutesUsed || 0), 0), smsUsed: nums.reduce((s, n) => s + (n.smsUsed || 0), 0), textsThisMonth,
      })
    }))
    return r
  }

  let ready = null
  const boot = () => { if (!ready) { const db = getDb(); if (db) ready = build(db) } return ready }
  // Build as soon as the DB is up so background work (crypto order pickup) runs without waiting for a visitor.
  const bootTimer = setInterval(() => { if (boot()) clearInterval(bootTimer) }, 5000)
  if (bootTimer.unref) bootTimer.unref()
  const router = express.Router()
  // Every "not enough in your wallet" reply also says how much is there and how much more is needed, so the app can
  // open a pay-the-difference checkout (crypto or Mollie) and then finish the same action by itself.
  const SHORT_CODES = new Set(['insufficient_balance', 'start_failed', 'series_funds'])
  const withShortfall = async (req, body) => {
    const bal = await wallet.walletOps(getDb()).balance(req.webChatId).catch(() => null)
    if (bal == null) return body
    const m = String(body.message || '').replace(/,/g, '')
    const add = m.match(/\b(?:add|top up) \$(\d+(?:\.\d+)?)/i)
    const cost = Number(body.cost) || Number((m.match(/\b(?:costs?|needs?|at least)\s+(?:about\s+)?\$(\d+(?:\.\d+)?)/i) || [])[1])
    const need = Number(body.need) || (add ? Number(add[1]) : cost > bal ? cost - bal : 0)
    return { ...body, balance: wallet.round2(bal), ...(need > 0 ? { need: Math.ceil(need * 100) / 100 } : {}) }
  }
  router.use((req, res, next) => {
    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode === 402 && SHORT_CODES.has(body?.error) && req.webChatId && (body.error === 'insufficient_balance' || /wallet|balance/i.test(body.message || ''))) {
        withShortfall(req, body).then(b => json(scrubBody(b)), () => json(scrubBody(body)))
        return res
      }
      return json(scrubBody(body))
    }
    next()
  })
  router.use((req, res, next) => {
    boot()
    if (!ready) return res.status(503).json({ error: 'starting', message: 'Service is starting. Try again in a moment.' })
    ready(req, res, next)
  })
  router.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'upload_failed', message: err.code === 'LIMIT_FILE_SIZE' ? 'Files must be under 10 MB.' : 'Upload failed.' })
    log(`[CloudIVR-Web] unhandled: ${err.message}`)
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again — if it keeps happening, message support.' })
  })
  return router
}

// Telnyx message.finalized → status of a web-sent text. Handled 3 s later so the send route has saved its copies first.
function smsDelivery(db, payload, log = console.log) {
  const t = setTimeout(() => smsReplyMod.applyDeliveryReport({ db, notify, log }, payload).catch(e => log(`[SmsReply] delivery report failed: ${e.message}`)), 3000)
  if (t.unref) t.unref()
}

module.exports = { createCloudIvrWeb, notify, makeDownloader: verification.makeDownloader, smsDelivery }
