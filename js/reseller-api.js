// ============================================================
// Reseller API  (js/reseller-api.js)
// ------------------------------------------------------------
// Public, API-key-authenticated REST API that lets a reseller
// programmatically resell:
//   • Domains        (search / register / list)
//   • DNS management (records CRUD + nameservers)  — free, no wallet charge
//   • VPS  (Linux)   (plans / create / list / actions / destroy / creds)
//   • RDP  (Windows) (plans / create / list / actions / destroy / creds)
//   • cPanel hosting (plans / create / list / suspend / terminate / login)
//
// Design decisions (confirmed with product owner):
//   1. Billing → debits the existing wallet system (walletOf, usdOut) via the
//      atomic, overdraft-safe db.atomicIncrement(). The API key is bound to a
//      single owner account (chatId) whose wallet funds every provisioning call.
//   2. API keys → seeded via scripts/seed_reseller_key.js into `resellerApiKeys`
//      (sha256-hashed). One key = full access (no per-product scopes).
//   3. Safety → provisioning only runs LIVE when RESELLER_API_LIVE=true AND
//      SKIP_WEBHOOK_SYNC!=='true'. On a dev/sandbox pod (SKIP_WEBHOOK_SYNC=true)
//      the API ALWAYS runs in dry-run: it validates input, prices the order,
//      checks the wallet balance, but NEVER calls a provider or debits funds.
//
// Mounted in _index.js:
//   app.use('/reseller/v1', createResellerApi({ getDb: () => db, log, notifyAdmin }))
// External URL (FastAPI strips /api): https://<host>/api/reseller/v1/*
// ============================================================

const express = require('express')
const crypto = require('crypto')

const { atomicIncrement } = require('./db')
const { getBalance } = require('./utils')

const domainService = require('./domain-service')
const whmService = require('./whm-service')
const vpsProvider = require('./vps-provider')
const hostingScheduler = require('./hosting-scheduler')       // getPlanPrice / getPlanDuration (bot-accurate)
const upgradeCredit = require('./hosting-upgrade-credit')     // getUpgradeTargets / computeUpgradeQuote (loyalty credit)
const antiRed = require('./anti-red-service')                 // resolveDomainCfState / setDomainChallengeBypass
const addonFlow = require('./addon-domain-flow')              // attachAddonDomain
const cpanelAuth = require('./cpanel-auth')                   // resetPin (reveal = reset, prod mutation)
const { registerHostingMgmtRoutes } = require('./reseller-hosting-mgmt') // in-account cPanel mgmt (reuses cpanel-proxy + services, no duplication)

// Customer-facing HostPanel URL (same one the Telegram bot shows).
function panelUrl() {
  const pd = process.env.PANEL_DOMAIN
  const raw = pd
    ? (pd.startsWith('http') ? pd : `https://${pd}`)
    : String(process.env.SELF_URL_PROD || process.env.SELF_URL || '').replace('/api', '')
  if (!raw) return null
  return `${raw.replace(/\/+$/, '').replace(/\/panel$/i, '')}/panel`
}
const serverIp = () => process.env.WHM_HOST || process.env.WHM_SERVER_IP || null

// Parse WHM /accountsummary acct object into clean disk + bandwidth usage.
function parseHostingUsage(acct) {
  if (!acct || typeof acct !== 'object') return null
  const toNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null }
  const isUnl = (v) => /unlimited/i.test(String(v))
  const diskUsedMb = toNum(acct.diskused)
  const diskLimitMb = isUnl(acct.disklimit) ? null : toNum(acct.disklimit)
  // WHM reports bandwidth used as totalbytes (bytes) on most versions; bwlimit is in MB.
  const bwUsedMb = acct.totalbytes != null ? Math.round((toNum(acct.totalbytes) || 0) / (1024 * 1024) * 10) / 10
    : (acct.bwused != null ? toNum(acct.bwused) : null)
  const bwLimitMb = isUnl(acct.bwlimit) ? null : toNum(acct.bwlimit)
  return {
    disk_used_mb: diskUsedMb,
    disk_limit_mb: diskLimitMb,
    disk_limit: isUnl(acct.disklimit) ? 'unlimited' : diskLimitMb,
    disk_used_pct: (diskUsedMb != null && diskLimitMb) ? Math.round((diskUsedMb / diskLimitMb) * 1000) / 10 : null,
    bandwidth_used_mb: bwUsedMb,
    bandwidth_limit_mb: bwLimitMb,
    bandwidth_limit: isUnl(acct.bwlimit) ? 'unlimited' : bwLimitMb,
    inodes_used: toNum(acct.inodesused),
    inodes_limit: isUnl(acct.inodeslimit) ? 'unlimited' : toNum(acct.inodeslimit),
    email_accounts: toNum(acct.email_accounts) != null ? toNum(acct.email_accounts) : undefined,
    suspended: acct.suspended === 1 || acct.suspended === '1' || acct.suspended === true || undefined,
  }
}

// Addon-domain quota per hosting tier (mirrors bot gating).
function addonQuota(plan) {
  const n = String(plan || '').toLowerCase()
  if (n.includes('golden')) return 'unlimited'
  if (n.includes('premium') && !n.includes('week')) return 5
  if (n.includes('week')) return 1
  return 0
}
// hostingPlans() plan_id → hosting-upgrade-credit target.key
const UPGRADE_ID_TO_KEY = { 'premium-monthly': 'premiumCpanel', 'golden-monthly': 'goldenCpanel' }

// ── Hosting plan catalog (prices from prod .env, mirrors store-routes) ──
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d }
function hostingPlans() {
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
const hostingPlanById = (id) => hostingPlans().find(p => p.id === id)

const domainOk = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(d || '').trim())
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

function createResellerApi(deps = {}) {
  const getDb = deps.getDb || (() => null)
  const log = deps.log || console.log
  const notifyAdmin = deps.notifyAdmin || (async () => {})
  const router = express.Router()

  const col = (name) => {
    const db = getDb()
    if (!db) throw new Error('Database not ready')
    return db.collection(name)
  }

  // ── Mode: are we allowed to actually provision + charge? ──
  // Hard safety: a dev/sandbox pod (SKIP_WEBHOOK_SYNC=true) shares production
  // provider accounts + Mongo, so it must NEVER create real resources.
  function isLive() {
    return process.env.RESELLER_API_LIVE === 'true' && process.env.SKIP_WEBHOOK_SYNC !== 'true'
  }
  const mode = () => (isLive() ? 'live' : 'dry_run')

  // ── Wallet helpers (bound to the API key's owner account) ──
  async function walletBalance(chatId) {
    try {
      const { usdBal } = await getBalance(col('walletOf'), String(chatId))
      return Math.round((Number(usdBal) || 0) * 100) / 100
    } catch (e) { log(`[ResellerAPI] walletBalance error: ${e.message}`); return 0 }
  }
  async function chargeWallet(chatId, amountUsd) {
    // atomic + overdraft-safe: returns false if balance insufficient
    return await atomicIncrement(col('walletOf'), String(chatId), 'usdOut', Math.round(amountUsd * 100) / 100)
  }
  async function refundWallet(chatId, amountUsd) {
    return await atomicIncrement(col('walletOf'), String(chatId), 'usdIn', Math.round(amountUsd * 100) / 100)
  }

  async function recordOrder(doc) {
    try { await col('resellerApiOrders').insertOne({ _id: crypto.randomUUID(), createdAt: new Date(), ...doc }) }
    catch (e) { log(`[ResellerAPI] recordOrder error: ${e.message}`) }
  }

  // ── API-key auth middleware ──
  async function apiKeyAuth(req, res, next) {
    try {
      let raw = null
      const authHeader = req.headers.authorization || ''
      if (authHeader.startsWith('Bearer ')) raw = authHeader.slice(7).trim()
      if (!raw && req.headers['x-api-key']) raw = String(req.headers['x-api-key']).trim()
      if (!raw) return res.status(401).json({ error: 'missing_api_key', message: 'Provide your key via "Authorization: Bearer <key>" or "X-API-Key: <key>".' })

      const keyDoc = await col('resellerApiKeys').findOne({ keyHash: sha256(raw), enabled: true })
      if (!keyDoc) return res.status(401).json({ error: 'invalid_api_key', message: 'API key not recognised or disabled.' })

      req.reseller = { keyId: keyDoc._id, ownerChatId: String(keyDoc.ownerChatId), label: keyDoc.label || null, webhookUrl: keyDoc.webhookUrl || null }
      // best-effort usage tracking (never blocks the request)
      col('resellerApiKeys').updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() }, $inc: { requestCount: 1 } }).catch(() => {})
      next()
    } catch (e) {
      log(`[ResellerAPI] auth error: ${e.message}`)
      return res.status(500).json({ error: 'auth_error', message: e.message })
    }
  }

  // ── Central billed-provision wrapper ──
  // In dry-run: validate + price + balance check, return simulation (no charge).
  // In live: atomic charge → provision → refund-on-failure.
  async function billedProvision(req, res, { product, action, priceUsd, request, provision }) {
    const chatId = req.reseller.ownerChatId
    const price = Math.round(Number(priceUsd) * 100) / 100
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'pricing_failed', message: 'Could not determine a valid price for this order.' })
    }
    const balance = await walletBalance(chatId)

    // ── Universal wallet guard (applies in BOTH dry_run and live) ──
    // An API order is NEVER processed — neither simulated nor provisioned —
    // when the bot wallet bound to the API key cannot cover the price. This
    // makes the "insufficient balance ⇒ order refused" guarantee identical on
    // every pod. In live mode the atomic chargeWallet() below adds a second,
    // race-safe overdraft check.
    if (balance < price) {
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: mode(), status: 'rejected_insufficient_balance' })
      return res.status(402).json({
        error: 'insufficient_wallet_balance',
        message: `Wallet balance $${balance.toFixed(2)} is below the order price $${price.toFixed(2)}. Top up your wallet and retry.`,
        product, action,
        price_usd: price,
        wallet_balance_usd: balance,
        shortfall_usd: Math.round((price - balance) * 100) / 100,
        mode: mode(),
      })
    }

    if (!isLive()) {
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: 'dry_run', status: 'simulated' })
      return res.json({
        mode: 'dry_run',
        product, action,
        price_usd: price,
        wallet_balance_usd: balance,
        sufficient_balance: true,
        would_provision: request,
        note: 'Dry-run: balance is sufficient; no resource was created and no funds were charged. Set RESELLER_API_LIVE=true on a production pod to go live.',
      })
    }

    // ── LIVE ── (balance already confirmed sufficient; charge stays atomic + overdraft-safe against concurrent spend)
    const charged = await chargeWallet(chatId, price)
    if (!charged) {
      return res.status(402).json({ error: 'insufficient_wallet_balance', message: 'Wallet debit was declined (insufficient funds / concurrent spend).', price_usd: price, wallet_balance_usd: balance })
    }

    let result
    try {
      result = await provision()
    } catch (err) {
      await refundWallet(chatId, price)
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: 'live', status: 'failed', error: err.message })
      try { await notifyAdmin(`❌ <b>Reseller API ${product}/${action} FAILED</b>\nKey: ${req.reseller.label || req.reseller.keyId}\nRefunded $${price.toFixed(2)}\nError: ${err.message}`) } catch (_) { /* notify best-effort */ }
      return res.status(502).json({ error: 'provisioning_failed', message: err.message, refunded: true, refund_usd: price })
    }

    if (result && result.success === false) {
      await refundWallet(chatId, price)
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: 'live', status: 'failed', error: result.error || 'provision_failed' })
      return res.status(502).json({ error: 'provisioning_failed', message: result.error || 'Provider could not fulfil the request.', refunded: true, refund_usd: price })
    }

    const balanceAfter = await walletBalance(chatId)
    await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: 'live', status: 'provisioned', result })
    return res.json({ mode: 'live', product, action, charged_usd: price, wallet_balance_usd: balanceAfter, result })
  }

  // Small async wrapper so route handlers can throw
  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    log(`[ResellerAPI] ${req.method} ${req.path} error: ${e.message}`)
    if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: e.message })
  })

  // ════════════════════════════════════════════════════════
  // META
  // ════════════════════════════════════════════════════════
  router.get('/health', (req, res) => res.json({
    ok: true, service: 'reseller-api', version: 'v1', mode: mode(),
    products: ['domains', 'dns', 'vps', 'rdp', 'hosting'],
  }))

  router.get('/account', apiKeyAuth, h(async (req, res) => {
    const balance = await walletBalance(req.reseller.ownerChatId)
    res.json({ owner_chat_id: req.reseller.ownerChatId, label: req.reseller.label, wallet_balance_usd: balance, currency: 'usd', webhook_url: req.reseller.webhookUrl || null, mode: mode() })
  }))

  // ── Push webhooks (optional): register a URL to receive RDP lifecycle events
  // (rdp.grace_start, rdp.deleted) instead of polling /renewals. Plain POST, no signature.
  const resellerWebhooks = require('./reseller-webhooks')
  router.get('/account/webhook', apiKeyAuth, h(async (req, res) => {
    const keyDoc = await col('resellerApiKeys').findOne({ _id: req.reseller.keyId }, { projection: { webhookUrl: 1 } })
    res.json({ webhook_url: (keyDoc && keyDoc.webhookUrl) || null, events: ['rdp.grace_start', 'rdp.deleted'], delivery: 'POST (no signature), auto-retry with backoff' })
  }))
  router.put('/account/webhook', apiKeyAuth, h(async (req, res) => {
    const raw = req.body?.webhook_url
    // null / '' clears the webhook.
    if (raw === null || raw === '' || raw === undefined) {
      await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $unset: { webhookUrl: '' } })
      return res.json({ webhook_url: null, cleared: true })
    }
    const url = String(raw).trim()
    if (!resellerWebhooks.isHttpUrl(url)) return res.status(400).json({ error: 'invalid_webhook_url', message: 'Provide a valid http(s) URL, or null to clear.' })
    await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $set: { webhookUrl: url } })
    res.json({ webhook_url: url, events: ['rdp.grace_start', 'rdp.deleted'], delivery: 'POST (no signature), auto-retry with backoff' })
  }))

  // ── Bot pricing catalog (the same prices the Telegram bot charges) ──
  // One call returns every sellable product's price plus your wallet balance,
  // so a reseller can compute margins without hitting each product endpoint.
  router.get('/pricing', apiKeyAuth, h(async (req, res) => {
    const region = String(req.query.region || 'EU').toUpperCase()
    const balance = await walletBalance(req.reseller.ownerChatId)

    const mapPlans = (prov, isRDP) => (prov.listProducts(region, isRDP) || []).map(p => ({
      plan_id: p.productId, name: p.name || p.productId,
      vcpus: p.vcpus || p.vCpus || null, ram_gb: p.ramGb || null, disk_gb: p.diskGb || null,
      ...hwFromProduct(p),
      duration_months: p.durationMonths || 1, discount_pct: (p.pricing && p.pricing.discountPct) || 0,
      price_usd: p.pricing ? p.pricing.totalWithMarkup : null,
    }))
    let vpsPlans = [], rdpPlans = [], vpsProviderName = process.env.VPS_DEFAULT_PROVIDER, rdpProviderName = process.env.VPS_RDP_PROVIDER
    try { const pv = vpsProvider.getProvider(); vpsProviderName = pv.PROVIDER || vpsProviderName; vpsPlans = mapPlans(pv, false) } catch (e) { log(`[ResellerAPI] pricing vps warn: ${e.message}`) }
    try { const pr = vpsProvider.getRdpProvider(); rdpProviderName = pr.PROVIDER || rdpProviderName; rdpPlans = mapPlans(pr, true) } catch (e) { log(`[ResellerAPI] pricing rdp warn: ${e.message}`) }

    res.json({
      mode: mode(),
      currency: 'usd',
      wallet_balance_usd: balance,
      region,
      domains: {
        note: 'Domain prices are per-name and set live by the registrar (identical to bot pricing). Call GET /domains/search?domain=<name> for an exact, wallet-billable quote.',
        min_price_usd: num(process.env.MIN_DOMAIN_PRICE, 30),
      },
      hosting: hostingPlans().map(p => ({ plan_id: p.id, name: p.name, tier: p.tier, price_usd: p.priceUsd, duration_days: p.durationDays, addon_domains: p.addons, features: p.features })),
      vps: { provider: vpsProviderName, region, plans: vpsPlans },
      rdp: { provider: rdpProviderName, region, plans: rdpPlans },
    })
  }))

  // ════════════════════════════════════════════════════════
  // DOMAINS
  // ════════════════════════════════════════════════════════
  router.get('/domains/search', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain, e.g. ?domain=mysite.com' })
    const r = await domainService.checkDomainPrice(domain, getDb())
    res.json({ domain, available: !!r.available, price_usd: r.available ? Number(r.price) : 0, registrar: r.registrar || null, message: r.message || '' })
  }))

  router.post('/domains/register', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain in body: { "domain": "mysite.com" }' })
    const customNS = Array.isArray(req.body?.nameservers) ? req.body.nameservers : null
    const nsChoice = customNS ? 'custom' : (req.body?.ns_choice || 'cloudflare')

    const priceInfo = await domainService.checkDomainPrice(domain, getDb())
    if (!priceInfo.available) return res.status(409).json({ error: 'domain_unavailable', message: priceInfo.message || 'That domain is not available.' })
    const registrar = priceInfo.registrar || 'ConnectReseller'

    return billedProvision(req, res, {
      product: 'domain', action: 'register', priceUsd: Number(priceInfo.price),
      request: { domain, registrar, ns_choice: nsChoice, nameservers: customNS },
      provision: async () => {
        const r = await domainService.registerDomain(domain, registrar, nsChoice, getDb(), req.reseller.ownerChatId, customNS)
        if (r && r.success === false) return { success: false, error: r.error || r.message }
        return { success: true, domain, registrar, nameservers: r?.nameservers || customNS || [], detail: r || null }
      },
    })
  }))

  router.get('/domains', apiKeyAuth, h(async (req, res) => {
    const docs = await col('domainsOf').find({ chatId: String(req.reseller.ownerChatId) }).limit(500).toArray()
    // GAP-5 FIX (2026-09): the delegated (Cloudflare) nameservers live in the registeredDomains
    // collection (val.cfNameservers), not in domainsOf — so GET /domains reported []. Batch-load
    // registeredDomains for these domains and fill NS from there when the domainsOf doc lacks them.
    const names = docs.map(d => String(d.domainName || '').toLowerCase()).filter(Boolean)
    const nsMap = {}
    if (names.length) {
      try {
        const regs = await col('registeredDomains').find({ _id: { $in: names } }).toArray()
        for (const rd of regs) {
          const v = rd.val || {}
          const ns = v.cfNameservers || v.nameservers || rd.nameservers || []
          if (Array.isArray(ns) && ns.length) nsMap[String(rd._id).toLowerCase()] = ns
        }
      } catch (_) { /* best-effort enrichment */ }
    }
    res.json({ domains: docs.map(d => {
      const rawExp = d.expiresAt || d.expiryDate || d.renewalDate || d.expiry || (d.val && (d.val.expiresAt || d.val.expiryDate)) || null
      const exp = rawExp ? new Date(rawExp) : null
      const localNs = d.nameservers || (d.val && (d.val.cfNameservers || d.val.nameservers)) || []
      const nameservers = (Array.isArray(localNs) && localNs.length) ? localNs : (nsMap[String(d.domainName || '').toLowerCase()] || [])
      return {
        domain: d.domainName,
        registrar: d.registrar || null,
        nameserver_type: d.nameserverType || null,
        nameservers,
        registered_at: d.registeredAt || null,
        expires_at: (exp && !isNaN(exp)) ? exp.toISOString() : null,
        dns_records_url: `/dns/${d.domainName}/records`,
        nameservers_url: `/dns/${d.domainName}/nameservers`,
      }
    }) })
  }))

  // ════════════════════════════════════════════════════════
  // DNS management (free — no wallet charge)
  // ════════════════════════════════════════════════════════
  router.get('/dns/:domain/records', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const r = await domainService.viewDNSRecords(domain, getDb())
    res.json({ domain, records: r?.records || r || [], source: r?.source || null })
  }))

  router.post('/dns/:domain/records', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const { type, name, value, priority, ttl } = req.body || {}
    if (!type || value == null) return res.status(400).json({ error: 'invalid_record', message: 'Body must include { type, name, value }.' })
    const r = await domainService.addDNSRecord(domain, String(type).toUpperCase(), value, name || '@', getDb(), priority, ttl ? { ttl } : undefined)
    if (r && r.success === false) return res.status(502).json({ error: 'dns_add_failed', message: r.error || r.message })
    res.json({ domain, added: { type, name: name || '@', value, priority: priority || null, ttl: ttl || null }, detail: r || null })
  }))

  router.put('/dns/:domain/records', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const recordData = req.body?.record || req.body
    if (!recordData || typeof recordData !== 'object') return res.status(400).json({ error: 'invalid_record', message: 'Body must include the record object to update (from GET records).' })
    const r = await domainService.updateDNSRecord(domain, recordData, getDb())
    if (r && r.success === false) return res.status(502).json({ error: 'dns_update_failed', message: r.error || r.message })
    res.json({ domain, updated: true, detail: r || null })
  }))

  router.delete('/dns/:domain/records', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const recordData = req.body?.record || req.body
    if (!recordData || typeof recordData !== 'object') return res.status(400).json({ error: 'invalid_record', message: 'Body must include the record object to delete (from GET records).' })
    const r = await domainService.deleteDNSRecord(domain, recordData, getDb())
    if (r && r.success === false) return res.status(502).json({ error: 'dns_delete_failed', message: r.error || r.message })
    res.json({ domain, deleted: true, detail: r || null })
  }))

  router.put('/dns/:domain/nameservers', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const ns = req.body?.nameservers
    if (!Array.isArray(ns) || ns.length < 2) return res.status(400).json({ error: 'invalid_nameservers', message: 'Provide at least 2 nameservers: { "nameservers": ["ns1...","ns2..."] }' })
    const r = await domainService.updateAllNameservers(domain, ns, getDb())
    if (r && r.success === false) return res.status(502).json({ error: 'ns_update_failed', message: r.error || r.message })
    res.json({ domain, nameservers: ns, updated: true, detail: r || null })
  }))

  // ════════════════════════════════════════════════════════
  // VPS (Linux) + RDP (Windows) — share the provider interface
  // ════════════════════════════════════════════════════════
  function providerFor(isRDP) { return isRDP ? vpsProvider.getRdpProvider() : vpsProvider.getProvider() }

  // DO-RDP lifecycle ops (get / password-reset / reinstall) must route by the RECORD, not the
  // statically-configured VPS_RDP_PROVIDER. A golden-image DO-RDP instance (provider
  // 'digitalocean-rdp' or an rdp-* id) has to reach the DO-RDP service even when VPS_RDP_PROVIDER
  // is azure/other; anything else falls back to the configured RDP provider. Matches the design
  // note: "per-record / per-instanceId ops route by the ID prefix on the record".
  function rdpProviderForRecord(rec) {
    const explicit = String((rec && rec.provider) || '').toLowerCase()
    const idIsRdp = /^rdp-/i.test(String((rec && rec.instanceId) || ''))
    if (explicit === 'digitalocean-rdp' || idIsRdp) {
      try {
        const p = vpsProvider.getProviderForRecord({ ...rec, provider: 'digitalocean-rdp' })
        if (p) return p
      } catch (_) { /* fall through to configured RDP provider */ }
    }
    return providerFor(true)
  }

  // ── Customer-facing hardware fields (CPU vendor + storage media) ──
  // storage_type comes from the provider catalog's diskType ('nvme'→"NVMe SSD", 'ssd'→"SSD").
  // cpu is read from the size identifier: DigitalOcean slugs end -amd / -intel; Azure Dasv/Dadsv SKUs
  // are AMD, Dsv/Ddsv are Intel; anything with no vendor marker is reported as "Standard".
  // DO note: the -amd/-intel Premium sizes are NVMe-backed; a plain "Basic" fallback slug is SSD.
  function _cpuVendor(sizeId) {
    const s = String(sizeId || '').toLowerCase()
    if (!s) return 'Standard'
    if (s.endsWith('-amd') || /d\d+ad?s_v\d/.test(s) || /\bepyc\b/.test(s)) return 'AMD'
    if (s.endsWith('-intel') || /d\d+d?s_v[45678]\b/.test(s)) return 'Intel'
    return 'Standard'
  }
  function _storageLabel(diskType) {
    const d = String(diskType || '').toLowerCase()
    return d === 'nvme' ? 'NVMe SSD' : d === 'ssd' ? 'SSD' : null
  }
  // From a catalog product (has do_size_slug for DO, azureSku for Azure, diskType for every provider).
  function hwFromProduct(p) {
    const slug = String((p && p.do_size_slug) || '').toLowerCase()
    if (slug.endsWith('-amd')) return { cpu: 'AMD', storage_type: 'NVMe SSD' }
    if (slug.endsWith('-intel')) return { cpu: 'Intel', storage_type: 'NVMe SSD' }
    if (slug) return { cpu: 'Standard', storage_type: 'SSD' } // plain DO Basic size = SSD
    return { cpu: _cpuVendor((p && (p.azureSku || p.productId)) || ''), storage_type: _storageLabel(p && p.diskType) }
  }
  // From a stored instance record: prefer the EXACT size slug the droplet got, else the catalog default.
  function hwFromRecord(prov, rec) {
    const slug = String((rec && rec.do_size_slug) || '').toLowerCase()
    if (slug.endsWith('-amd')) return { cpu: 'AMD', storage_type: 'NVMe SSD' }
    if (slug.endsWith('-intel')) return { cpu: 'Intel', storage_type: 'NVMe SSD' }
    if (slug) return { cpu: 'Standard', storage_type: 'SSD' }
    let prod = null
    try { if (prov && typeof prov.getProduct === 'function') prod = prov.getProduct((rec && rec.productId) || (rec && rec.plan)) } catch (_) { /* unknown product */ }
    return hwFromProduct(prod || {})
  }

  async function vpsPlansHandler(req, res, isRDP) {
    const region = String(req.query.region || 'EU').toUpperCase()
    const prov = providerFor(isRDP)
    const products = prov.listProducts(region, isRDP) || []
    const out = {
      product: isRDP ? 'rdp' : 'vps',
      provider: prov.PROVIDER || (isRDP ? process.env.VPS_RDP_PROVIDER : process.env.VPS_DEFAULT_PROVIDER),
      region,
      plans: products.map(p => ({
        plan_id: p.productId, name: p.name || p.productId,
        vcpus: p.vcpus || p.vCpus || null, ram_gb: p.ramGb || null, disk_gb: p.diskGb || null,
        ...hwFromProduct(p),
        duration_months: p.durationMonths || 1, discount_pct: (p.pricing && p.pricing.discountPct) || 0,
        price_usd: p.pricing ? p.pricing.totalWithMarkup : null,
      })),
    }
    // Windows editions + fast-deploy (golden image) readiness per region code.
    if (isRDP && typeof prov.listOsOptions === 'function') {
      try { out.default_os = prov.DEFAULT_OS_ID || null; out.os_options = await prov.listOsOptions() }
      catch (e) { log(`[ResellerAPI] listOsOptions warn: ${e.message}`) }
    }
    res.json(out)
  }

  async function vpsCreateHandler(req, res, isRDP) {
    const region = String(req.body?.region || 'EU').toUpperCase()
    const planId = req.body?.plan_id
    const hostname = req.body?.hostname || null
    const prov = providerFor(isRDP)
    const product = prov.getProduct ? prov.getProduct(planId) : null
    if (!product) return res.status(400).json({ error: 'invalid_plan', message: 'Unknown plan_id. Call GET plans first.' })
    const pricing = prov.calculatePrice(product, region, isRDP)
    if (!pricing) return res.status(400).json({ error: 'unavailable', message: `Plan not available in region ${region}.` })
    // RDP: optional Windows edition (ws2019 | ws2022 | ws2025) when the provider exposes OS options.
    let osId = null
    if (isRDP && prov.OS_OPTIONS) {
      osId = String(req.body?.os || prov.DEFAULT_OS_ID || '').toLowerCase()
      if (!prov.OS_OPTIONS[osId]) return res.status(400).json({ error: 'invalid_os', message: `Unknown os "${req.body?.os}". Valid values: ${Object.keys(prov.OS_OPTIONS).join(', ')} (see os_options in GET /rdp/plans).` })
    }

    return billedProvision(req, res, {
      product: isRDP ? 'rdp' : 'vps', action: 'create', priceUsd: pricing.totalWithMarkup,
      request: { plan_id: planId, region, hostname, os: isRDP ? (osId || 'windows') : (req.body?.os || 'ubuntu') },
      provision: async () => {
        const createFn = (isRDP && prov.createInstanceWithFallback) ? prov.createInstanceWithFallback.bind(prov) : prov.createInstance.bind(prov)
        const inst = await createFn({ productId: planId, regionSlug: region, isWindows: isRDP, osId: osId || undefined, label: hostname || undefined })
        // Persist a record so GET /vps|/rdp lists it for this owner
        const vpsId = crypto.randomUUID()
        try {
          await col('vpsPlansOf').insertOne({
            _id: vpsId, chatId: String(req.reseller.ownerChatId), vpsId,
            provider: prov.PROVIDER, instanceId: inst.instanceId || null, host: inst.mainIp || null,
            region, productId: planId, plan: product.name || planId, planPrice: pricing.totalWithMarkup,
            osType: isRDP ? 'windows' : 'linux', osId: osId || null, isRDP: !!isRDP, status: inst.status || 'provisioning',
            rootPasswordSecretId: inst.passwordSecretId || null, source: 'reseller_api',
            start_time: new Date(), timestamp: new Date(),
          })
        } catch (e) { log(`[ResellerAPI] vpsPlansOf insert warn: ${e.message}`) }
        const out = { success: true, id: vpsId, instance_id: inst.instanceId || null, ip: inst.mainIp || null, status: inst.status || 'provisioning', default_password: inst.defaultPassword || null }
        if (osId) { out.os = osId; out.fast_deploy = !!inst.fastDeploy; out.eta_minutes = inst.etaMinutes || null }
        return out
      },
    })
  }

  async function vpsListHandler(req, res, isRDP) {
    const docs = await col('vpsPlansOf').find({ chatId: String(req.reseller.ownerChatId), isRDP: !!isRDP }).limit(500).toArray()
    res.json({ [isRDP ? 'rdp' : 'vps']: docs.map(d => ({
      id: d.vpsId || d._id, instance_id: d.instanceId || d.contaboInstanceId || null, ip: d.host || null,
      plan: d.plan || null, region: d.region || null, os: d.osType || null, os_id: d.osId || null, status: d.status || null,
      ...hwFromRecord(isRDP ? rdpProviderForRecord(d) : providerFor(false), d),
      created_at: d.start_time || d.timestamp || null,
    })) })
  }

  async function loadOwnedVps(req, id, isRDP) {
    return col('vpsPlansOf').findOne({ $or: [{ vpsId: id }, { _id: id }], chatId: String(req.reseller.ownerChatId), isRDP: !!isRDP })
  }

  async function vpsGetHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    let live = null
    if (rec.instanceId) { try { const prov = isRDP ? rdpProviderForRecord(rec) : providerFor(false); live = await prov.getInstance(rec.instanceId) } catch (e) { live = { error: e.message } } }
    if (live && (live.mainIp || live.status) && (live.mainIp !== rec.host || live.status !== rec.status)) {
      col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { ...(live.mainIp ? { host: live.mainIp } : {}), ...(live.status ? { status: live.status } : {}) } }).catch(() => {})
    }
    const out = { id: rec.vpsId || rec._id, instance_id: rec.instanceId || null, plan: rec.plan, region: rec.region, os: rec.osType, os_id: rec.osId || null, ...hwFromRecord(isRDP ? rdpProviderForRecord(rec) : providerFor(false), rec), status: live?.status || rec.status, ip: live?.mainIp || rec.host || null, live }
    // RDP only: whether the in-guest management agent (used by password-reset) has checked in recently.
    if (isRDP) out.agent_online = live ? !!live.agentOnline : null
    // RDP 3-day grace: surface pending-deletion so a polling reseller sees the box is expired-but-not-yet-deleted.
    if (isRDP) {
      const graceUntil = rec.grace_until ? new Date(rec.grace_until) : null
      const destroyedByGrace = rec.cancelReason === 'expired_grace' || rec.destroy_reason === 'expired_grace'
      if (destroyedByGrace || out.status === 'destroyed') {
        out.status = 'destroyed'
        if (destroyedByGrace) out.destroy_reason = 'expired_grace'
      } else if (graceUntil && !isNaN(graceUntil.getTime())) {
        const daysRemaining = Math.max(0, Math.ceil((graceUntil.getTime() - Date.now()) / 86400000))
        out.grace = { in_grace: true, expired_at: rec.expired_at || null, delete_at: graceUntil.toISOString(), days_remaining: daysRemaining }
      }
    }
    if (live && live.provisioning) {
      out.provisioning = live.provisioning
      out.credentials_ready = !!live.provisioning.credentials_ready
      out.credentials_url = live.provisioning.credentials_ready ? `/api/reseller/v1/${isRDP ? 'rdp' : 'vps'}/${out.id}/credentials` : null
    }
    res.json(out)
  }

  async function vpsActionHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const action = String(req.body?.action || '').toLowerCase()
    const map = { start: 'startInstance', stop: 'stopInstance', reboot: 'restartInstance', restart: 'restartInstance', shutdown: 'shutdownInstance' }
    const fnName = map[action]
    if (!fnName) return res.status(400).json({ error: 'invalid_action', message: 'action must be one of: start, stop, reboot, shutdown' })
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, action, note: 'Dry-run: no action sent to provider.' })
    const prov = providerFor(isRDP)
    if (!rec.instanceId || typeof prov[fnName] !== 'function') return res.status(501).json({ error: 'not_supported' })
    const r = await prov[fnName](rec.instanceId)
    res.json({ mode: 'live', id: rec.vpsId || rec._id, action, detail: r || null })
  }

  async function vpsDestroyHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, note: 'Dry-run: instance not destroyed.' })
    const prov = providerFor(isRDP)
    if (rec.instanceId && typeof prov.cancelInstance === 'function') { try { await prov.cancelInstance(rec.instanceId) } catch (e) { log(`[ResellerAPI] cancelInstance warn: ${e.message}`) } }
    await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { status: 'destroyed', end_time: new Date() } })
    res.json({ mode: 'live', id: rec.vpsId || rec._id, destroyed: true })
  }

  async function vpsCredsHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    let password = null
    if (isLive() && rec.rootPasswordSecretId) { try { const prov = providerFor(isRDP); password = await prov.getSecretPassword(rec.rootPasswordSecretId) } catch (e) { log(`[ResellerAPI] getSecretPassword warn: ${e.message}`) } }
    // RDP orders are created with ip=null; resolve the live IP once provisioning assigned one.
    let ip = rec.host || null
    if (!ip && rec.instanceId) { try { ip = (await providerFor(isRDP).getInstance(rec.instanceId))?.mainIp || null; if (ip) await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { host: ip } }) } catch (_) {} }
    const out = { id: rec.vpsId || rec._id, ip, username: isRDP ? 'Administrator' : 'root', password: password || (isLive() ? null : '••• (revealed only in live mode)'), mode: mode() }
    // Speed lever 4: ship a ready-tuned .rdp connection file (LAN preset, bitmap cache on,
    // wallpaper/animations off) so the customer connects fast without touching client settings.
    if (isRDP && ip) {
      try { const prov = providerFor(true); if (typeof prov.buildRdpFile === 'function') { const f = prov.buildRdpFile(ip, 'Administrator'); if (f) out.rdp_file = f } } catch (_) {}
    }
    res.json(out)
  }

  // ── RDP-only lifecycle: password reset (in-place, agent) + reinstall (DO rebuild) ──
  // vpsActionHandler only maps power actions (start/stop/reboot/shutdown); these two
  // need dedicated routes because they take an os edition / return a fresh password.

  // POST /rdp/:id/password-reset → in-place Administrator password change via the in-guest
  // agent (apply.ps1 -Agent). Data preserved, no reinstall. Requires agent_online=true.
  async function rdpPasswordResetHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, true)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, username: 'Administrator', method: 'agent', note: 'Dry-run: no password reset sent to provider.' })
    const prov = rdpProviderForRecord(rec)
    if (!rec.instanceId || typeof prov.resetPassword !== 'function') return res.status(501).json({ error: 'not_supported' })
    try {
      const r = await prov.resetPassword(rec.instanceId)
      // Persist the new secret id so GET /rdp/:id/credentials reveals the new password.
      if (r && r.secretId && r.secretId !== rec.rootPasswordSecretId) {
        await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { rootPasswordSecretId: r.secretId } })
      }
      res.json({ mode: 'live', id: rec.vpsId || rec._id, password: r.password, username: 'Administrator', method: 'agent', data_preserved: true })
    } catch (e) {
      // Agent offline / server not started / apply-timeout — client-actionable, not a 5xx.
      res.status(409).json({ error: 'password_reset_failed', message: e.message })
    }
  }

  // POST /rdp/:id/reinstall {os} → DO rebuild of the SAME droplet from the chosen golden image
  // (IP kept, disk wiped, ~3 min). Returns { os, ip, eta_minutes, password } and updates the record.
  async function rdpReinstallHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, true)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const prov = rdpProviderForRecord(rec)
    const osId = String(req.body?.os || rec.osId || prov.DEFAULT_OS_ID || '').toLowerCase()
    if (prov.OS_OPTIONS && !prov.OS_OPTIONS[osId]) {
      return res.status(400).json({ error: 'invalid_os', message: `Unknown os "${req.body?.os}". Valid values: ${Object.keys(prov.OS_OPTIONS).join(', ')} (see os_options in GET /rdp/plans).` })
    }
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, os: osId, note: 'Dry-run: no reinstall sent to provider.' })
    if (!rec.instanceId || typeof prov.reinstallInstance !== 'function') return res.status(501).json({ error: 'not_supported' })
    try {
      const r = await prov.reinstallInstance(rec.instanceId, { osId })
      await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: {
        osId: r.osId || osId,
        status: 'reinstalling',
        ...(r.secretId ? { rootPasswordSecretId: r.secretId } : {}),
        ...(r.ip ? { host: r.ip } : {}),
      } })
      res.json({ mode: 'live', id: rec.vpsId || rec._id, os: r.osId || osId, os_name: r.osName || null, ip: r.ip || rec.host || null, eta_minutes: r.etaMinutes || 3, password: r.password })
    } catch (e) {
      res.status(409).json({ error: 'reinstall_failed', message: e.message })
    }
  }

  // POST /rdp/:id/renew {months} → extend the paid period (1/2/3 months, bundle-discounted),
  // power the box back on if it was expired/in grace, and CLEAR the 3-day grace state so the
  // RDP-service safety-net sweep + the bot scheduler stop counting it down for deletion.
  // Billed against the API key's wallet (mirrors GET /rdp/plans pricing).
  async function rdpRenewHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, true)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const destroyedByGrace = rec.cancelReason === 'expired_grace' || rec.destroy_reason === 'expired_grace'
    if (destroyedByGrace || ['destroyed', 'DESTROYED', 'CANCELLED', 'DELETED'].includes(String(rec.status))) {
      return res.status(409).json({ error: 'already_destroyed', message: 'This RDP was permanently deleted (grace period ended) and cannot be renewed. Order a new one.' })
    }
    const prov = rdpProviderForRecord(rec)
    const months = Math.min(3, Math.max(1, parseInt(req.body?.months, 10) || 1))
    // Price the renewal for the record's tier at the requested month count (bundle discount applies).
    const slug = String(rec.productId || '').replace(/-\d+m$/i, '')
    const product = (slug && typeof prov.getProduct === 'function') ? prov.getProduct(`${slug}-${months}m`) : null
    if (!product || !product.pricing) {
      return res.status(400).json({ error: 'pricing_failed', message: 'Could not determine a renewal price for this RDP plan. Contact support.' })
    }
    if (!rec.instanceId || typeof prov.renewInstance !== 'function') return res.status(501).json({ error: 'not_supported' })

    return billedProvision(req, res, {
      product: 'rdp', action: 'renew', priceUsd: product.pricing.totalWithMarkup,
      request: { id: rec.vpsId || rec._id, months, plan: rec.plan || product.name },
      provision: async () => {
        const r = await prov.renewInstance(rec.instanceId, months)
        const base = (rec.end_time && new Date(rec.end_time) > new Date()) ? new Date(rec.end_time) : new Date()
        const newExpiry = r?.expires_at ? new Date(r.expires_at) : new Date(base.getTime() + 30 * months * 86400000)
        // Mirror onto vpsPlansOf: back to good standing + clear every grace/cancel field so
        // neither the bot scheduler nor the RDP-service sweep destroys the box.
        await col('vpsPlansOf').updateOne({ _id: rec._id }, {
          $set: { status: 'RUNNING', end_time: newExpiry, renewed_at: new Date() },
          $unset: { expired_at: '', grace_until: '', _graceReminderSent: '', cancelReason: '', cancelledAt: '', deleteRetryCount: '', lastDeleteError: '', lastDeleteAlertAt: '' },
        })
        return { success: true, id: rec.vpsId || rec._id, months, plan: rec.plan || product.name, expires_at: newExpiry.toISOString() }
      },
    })
  }

  // VPS routes
  router.get('/vps/plans', apiKeyAuth, h((req, res) => vpsPlansHandler(req, res, false)))
  router.post('/vps', apiKeyAuth, h((req, res) => vpsCreateHandler(req, res, false)))
  router.get('/vps', apiKeyAuth, h((req, res) => vpsListHandler(req, res, false)))
  router.get('/vps/:id', apiKeyAuth, h((req, res) => vpsGetHandler(req, res, false)))
  router.post('/vps/:id/action', apiKeyAuth, h((req, res) => vpsActionHandler(req, res, false)))
  router.delete('/vps/:id', apiKeyAuth, h((req, res) => vpsDestroyHandler(req, res, false)))
  router.get('/vps/:id/credentials', apiKeyAuth, h((req, res) => vpsCredsHandler(req, res, false)))

  // RDP routes (Windows)
  router.get('/rdp/plans', apiKeyAuth, h((req, res) => vpsPlansHandler(req, res, true)))
  router.post('/rdp', apiKeyAuth, h((req, res) => vpsCreateHandler(req, res, true)))
  router.get('/rdp', apiKeyAuth, h((req, res) => vpsListHandler(req, res, true)))
  router.get('/rdp/:id', apiKeyAuth, h((req, res) => vpsGetHandler(req, res, true)))
  router.post('/rdp/:id/action', apiKeyAuth, h((req, res) => vpsActionHandler(req, res, true)))
  router.post('/rdp/:id/password-reset', apiKeyAuth, h((req, res) => rdpPasswordResetHandler(req, res)))
  router.post('/rdp/:id/reinstall', apiKeyAuth, h((req, res) => rdpReinstallHandler(req, res)))
  router.post('/rdp/:id/renew', apiKeyAuth, h((req, res) => rdpRenewHandler(req, res)))
  router.delete('/rdp/:id', apiKeyAuth, h((req, res) => vpsDestroyHandler(req, res, true)))
  router.get('/rdp/:id/credentials', apiKeyAuth, h((req, res) => vpsCredsHandler(req, res, true)))

  // ════════════════════════════════════════════════════════
  // cPanel HOSTING
  // ════════════════════════════════════════════════════════
  router.get('/hosting/plans', apiKeyAuth, h(async (req, res) => {
    res.json({
      platform: {
        hosting_trial_on: process.env.HOSTING_TRIAL_PLAN_ON === 'true',
        offshore_hosting_on: process.env.OFFSHORE_HOSTING_ON === 'true',
        gold_price_usd: num(process.env.GOLDEN_ANTIRED_CPANEL_PRICE, 100),
      },
      plans: hostingPlans().map(p => ({
        plan_id: p.id, name: p.name, tier: p.tier, price_usd: p.priceUsd,
        duration_days: p.durationDays, addon_domains: p.addons,
        visitor_captcha_available: p.tier === 'gold',
        features: p.features,
      })),
    })
  }))

  router.post('/hosting', apiKeyAuth, h(async (req, res) => {
    const plan = hostingPlanById(req.body?.plan_id)
    if (!plan) return res.status(400).json({ error: 'invalid_plan', message: 'Unknown plan_id. Call GET /hosting/plans.' })
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain.' })
    const domainMode = req.body?.domain_mode === 'buy' ? 'buy' : 'byo'
    const email = req.body?.email || null

    // duplicate guard (mirrors store provisioning)
    const dup = await col('cpanelAccounts').findOne({ domain, deleted: { $ne: true } })
    if (dup) return res.status(409).json({ error: 'domain_in_use', message: 'That domain already has an active hosting plan.' })

    let domainPrice = 0, registrar = null
    if (domainMode === 'buy') {
      const dp = await domainService.checkDomainPrice(domain, getDb())
      if (!dp.available) return res.status(409).json({ error: 'domain_unavailable', message: dp.message || 'Domain not available to register.' })
      domainPrice = Number(dp.price) || 0
      registrar = dp.registrar || 'ConnectReseller'
    }
    const total = Math.round((plan.priceUsd + domainPrice) * 100) / 100

    return billedProvision(req, res, {
      product: 'hosting', action: 'create', priceUsd: total,
      request: { plan_id: plan.id, plan: plan.name, domain, domain_mode: domainMode, hosting_usd: plan.priceUsd, domain_usd: domainPrice },
      provision: async () => {
        const { registerDomainAndCreateCpanel } = require('./cr-register-domain-&-create-cpanel.js')
        const info = {
          _id: `reseller_${crypto.randomUUID()}`, website_name: domain, plan: plan.name, email,
          userLanguage: 'en', price: total, hostingPrice: plan.priceUsd, registrar, source: 'reseller_api',
          ownerChatId: String(req.reseller.ownerChatId),
          // GAP-1 FIX (2026-09): bulletproof/anti-red hosting is ALWAYS Cloudflare-fronted.
          // The Telegram-bot flow persists `nameserver:'cloudflare'` in session state, which is
          // what makes registerDomainAndCreateCpanel run createHostingDNSRecords (root+www CNAME →
          // Cloudflare Tunnel, origin IP hidden). The API/web-store paths omitted it, so
          // `isCloudflareNS` was false and the CF zone was left with ONLY NS records → site never
          // resolved. Passing it here makes the API provision DNS identically to the bot.
          nameserver: 'cloudflare', nsChoice: 'cloudflare',
        }
        if (domainMode === 'byo') { info.existingDomain = true; info.connectExternalDomain = true }
        const r = await registerDomainAndCreateCpanel(() => {}, info, [], col('state'), null)
        if (!r || r.success === false) return { success: false, error: r?.error || 'Provisioning failed' }
        // tag the account with the reseller owner for listing
        if (r.username) { try { await col('cpanelAccounts').updateOne({ _id: String(r.username).toLowerCase() }, { $set: { chatId: String(req.reseller.ownerChatId), source: 'reseller_api', ownerEmail: email } }) } catch (_) { /* tag best-effort */ } }
        return {
          success: true, domain, plan: plan.name,
          cpanel_username: r.username || null,
          panel_url: panelUrl(),
          server_ip: serverIp(),
          nameservers: r.nameservers || [],
          queued: !!r.queued,
          credentials_url: r.username ? `/hosting/${String(r.username).toLowerCase()}/credentials` : null,
          note: 'Call GET /hosting/{username}/credentials to reveal the panel PIN (live mode only).',
        }
      },
    })
  }))

  router.get('/hosting', apiKeyAuth, h(async (req, res) => {
    const docs = await col('cpanelAccounts').find({ chatId: String(req.reseller.ownerChatId), deleted: { $ne: true } }).limit(500).toArray()
    // ?usage=true adds a quick disk summary per account (live WHM read, capped
    // fan-out). Off by default so the plain list stays fast.
    const wantUsage = String(req.query.usage || '') === 'true'
    const diskByUser = {}
    const liveSuspendedByUser = {}
    if (wantUsage) {
      await Promise.all(docs.slice(0, 50).map(async (d) => {
        const u = d.cpUser || d._id
        try {
          const info = await whmService.getAccountInfo(u)
          if (info && info.success && info.data) {
            const full = parseHostingUsage(info.data)
            diskByUser[u] = full ? { disk_used_mb: full.disk_used_mb, disk_limit: full.disk_limit, disk_used_pct: full.disk_used_pct } : null
            // GAP-7 FIX (2026-09): capture the live WHM suspended state so ?usage=true reflects the
            // same truth as GET /hosting/:user, and self-heal the DB flag when it has drifted.
            const live = full ? (full.suspended === true) : false
            liveSuspendedByUser[d._id] = live
            if (live !== !!d.suspended) {
              col('cpanelAccounts').updateOne({ _id: d._id }, { $set: { suspended: live, suspendedSyncedAt: new Date() } }).catch(() => {})
            }
          }
        } catch (_) { /* best-effort per account */ }
      }))
    }
    res.json({
      panel_url: panelUrl(),
      server_ip: serverIp(),
      usage_included: wantUsage,
      accounts: docs.map(d => {
        const u = d._id || d.username
        const suspended = Object.prototype.hasOwnProperty.call(liveSuspendedByUser, d._id) ? liveSuspendedByUser[d._id] : !!d.suspended
        return {
          username: u,
          domain: d.domain,
          plan: d.plan || null,
          suspended,
          created_at: d.createdAt || null,
          expires_at: d.expiryDate ? new Date(d.expiryDate).toISOString() : null,
          credentials_url: `/hosting/${u}/credentials`,
          ...(wantUsage ? { usage: diskByUser[d.cpUser || u] || null } : {}),
        }
      }),
    })
  }))

  async function loadOwnedCpanel(req, username) {
    return col('cpanelAccounts').findOne({ _id: String(username).toLowerCase(), chatId: String(req.reseller.ownerChatId) })
  }

  router.post('/hosting/:user/suspend', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: account not suspended.' })
    const r = await whmService.suspendAccount(acct._id, req.body?.reason || 'Suspended via reseller API')
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: true } })
    res.json({ mode: 'live', username: acct._id, suspended: true, detail: r || null })
  }))

  router.post('/hosting/:user/unsuspend', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: account not unsuspended.' })
    const r = await whmService.unsuspendAccount(acct._id)
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: false, suspendedReason: null } })
    res.json({ mode: 'live', username: acct._id, suspended: false, detail: r || null })
  }))

  // ── Unified site online/offline (adds Maintenance mode on top of suspend) ──
  // GET  → current status: 'online' | 'suspended' | 'maintenance'
  // POST → { action:'take_offline'|'bring_online', mode?:'suspended'|'maintenance' }
  //   • take_offline + mode 'suspended'   → WHM suspend (blocks HTTP/FTP/mail/DB)
  //   • take_offline + mode 'maintenance' → friendly 503 maintenance page (mail/FTP stay up)
  //   • bring_online                      → auto-reverses whichever mode is active
  router.get('/hosting/:user/site-status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const siteStatus = require('./site-status-service')
    res.json({
      username: acct._id,
      domain: acct.domain,
      status: siteStatus.readStatus(acct),
      plan: acct.plan || null,
      expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
      suspended_at: acct.suspendedAt ? new Date(acct.suspendedAt).toISOString() : null,
      maintenance_mode_at: acct.maintenanceModeAt ? new Date(acct.maintenanceModeAt).toISOString() : null,
      last_brought_online_at: acct.lastBroughtOnlineAt ? new Date(acct.lastBroughtOnlineAt).toISOString() : null,
    })
  }))

  router.post('/hosting/:user/site-status', apiKeyAuth, h(async (req, res) => {
    const { action, mode } = req.body || {}
    if (action !== 'take_offline' && action !== 'bring_online') {
      return res.status(400).json({ error: 'action must be take_offline or bring_online' })
    }
    if (action === 'take_offline' && mode !== 'maintenance' && mode !== 'suspended') {
      return res.status(400).json({ error: 'mode must be maintenance or suspended' })
    }
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (acct.deleted) return res.status(409).json({ error: 'account_terminated' })

    const siteStatus = require('./site-status-service')
    const before = siteStatus.readStatus(acct)
    const cpCol = col('cpanelAccounts')

    if (action === 'take_offline') {
      if (before !== 'online') return res.status(409).json({ error: `already_${before}` })
      if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: `Dry-run: site not taken offline (${mode}).` })
      let result
      try {
        result = (mode === 'suspended')
          ? await siteStatus.suspend(acct, 'Taken offline via reseller API')
          : await siteStatus.enableMaintenanceMode(acct)
      } catch (err) { result = { ok: false, error: err.message } }
      if (!result?.ok) return res.status(502).json({ error: result?.error || 'failed_take_offline' })
      const update = (mode === 'suspended')
        ? { suspended: true, suspendedAt: new Date(), suspendedBy: 'reseller_api', maintenanceMode: false }
        : { maintenanceMode: true, maintenanceModeAt: new Date(), maintenanceModeBy: 'reseller_api', suspended: false }
      await cpCol.updateOne({ _id: acct._id }, { $set: update })
      return res.json({ mode: 'live', username: acct._id, status: mode })
    }

    // action === 'bring_online'
    if (before === 'online') return res.status(409).json({ error: 'already_online' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: site not brought online.' })
    let result
    try {
      result = (before === 'suspended')
        ? await siteStatus.unsuspend(acct)
        : await siteStatus.disableMaintenanceMode(acct)
    } catch (err) { result = { ok: false, error: err.message } }
    if (!result?.ok) return res.status(502).json({ error: result?.error || 'failed_bring_online' })
    await cpCol.updateOne({ _id: acct._id }, { $set: { suspended: false, maintenanceMode: false, lastBroughtOnlineAt: new Date() } })
    return res.json({ mode: 'live', username: acct._id, status: 'online' })
  }))

  router.delete('/hosting/:user', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: account not terminated.' })
    // GAP-6 FIX (2026-09): terminate HONESTLY. whmService.terminateAccount() returns a boolean
    // (WHM removeacct result===1). WHM commonly refuses to remove a SUSPENDED account, so if the
    // first attempt fails we unsuspend and retry once, then VERIFY the account is actually gone via
    // accountsummary. Only mark the DB row deleted (which hides it from GET /hosting) when WHM
    // confirms removal — otherwise the account becomes a ghost (hidden from us, alive on the server).
    let ok = await whmService.terminateAccount(acct._id)
    if (!ok) {
      try { await whmService.unsuspendAccount(acct._id) } catch (_) { /* best-effort — WHM may refuse a suspended account */ }
      ok = await whmService.terminateAccount(acct._id)
    }
    let stillExists = false
    try { const info = await whmService.getAccountInfo(acct._id); stillExists = !!(info && info.success) } catch (_) { stillExists = false }
    if (!ok || stillExists) {
      return res.status(502).json({
        error: 'terminate_failed',
        message: 'WHM did not remove the account (it may still be suspended or held by the server). Unsuspend and retry, or terminate at the panel.',
        username: acct._id, terminated: false, whm_result: ok, still_exists: stillExists,
      })
    }
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { deleted: true, deletedAt: new Date() } })
    res.json({ mode: 'live', username: acct._id, terminated: true })
  }))

  router.get('/hosting/:user/login', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: login URL generated only in live mode.' })
    const session = await whmService.createUserSession(acct._id)
    res.json({ mode: 'live', username: acct._id, login_url: session?.url || session || null })
  }))

  // Resolve a reseller-owned cPanel account by domain (main OR addon domain).
  async function findOwnedAccountByDomain(req, domain) {
    const chatId = String(req.reseller.ownerChatId)
    const rx = new RegExp('^' + String(domain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    let acct = await col('cpanelAccounts').findOne({ chatId, deleted: { $ne: true }, domain: { $regex: rx } })
    if (!acct) acct = await col('cpanelAccounts').findOne({ chatId, deleted: { $ne: true }, addonDomains: { $elemMatch: { domain: { $regex: rx } } } })
    return acct
  }

  // Resolve the customer-facing nameservers for a hosting account's domain
  // (Cloudflare NS the customer must point their domain at).
  async function resolveNameservers(acct) {
    if (Array.isArray(acct?.nameservers) && acct.nameservers.length) return acct.nameservers
    try {
      const rd = await col('registeredDomains').findOne({ _id: String(acct?.domain || '').toLowerCase() })
      const v = rd?.val || {}
      return v.cfNameservers || v.nameservers || rd?.nameservers || []
    } catch (_) { return [] }
  }

  // Non-secret hosting deliverables (safe in any mode). The PIN is revealed
  // ONLY by GET /hosting/:user/credentials (reveal = PIN reset = prod write).
  function hostingDeliverables(acct, nameservers) {
    return {
      cpanel_username: acct.cpUser || acct._id || null,
      panel_url: panelUrl(),
      server_ip: serverIp(),
      nameservers: nameservers || [],
      credentials_url: `/hosting/${acct.cpUser || acct._id}/credentials`,
    }
  }

  // ════════════════════════════════════════════════════════
  // RENEWAL ALERTS — upcoming expiries across every product the
  // reseller owns (hosting + domains + VPS + RDP), one call.
  // ?days=N filters to items expiring within N days (default 30);
  // already-expired items are always included.
  // ════════════════════════════════════════════════════════
  router.get('/renewals', apiKeyAuth, h(async (req, res) => {
    const chatId = String(req.reseller.ownerChatId)
    const withinDays = num(req.query.days, 30)
    const nowMs = Date.now()
    const DAY = 86400000
    const bucket = (days) => (days < 0 ? 'expired' : (days <= 3 ? 'expiring_soon' : 'upcoming'))
    const items = []

    // Hosting (cpanelAccounts.expiryDate)
    try {
      const hosting = await col('cpanelAccounts').find({ chatId, deleted: { $ne: true } }).limit(500).toArray()
      for (const hp of hosting) {
        if (!hp.expiryDate) continue
        const exp = new Date(hp.expiryDate); if (isNaN(exp)) continue
        const days = Math.ceil((exp.getTime() - nowMs) / DAY)
        items.push({ product: 'hosting', id: hp._id || hp.username, domain: hp.domain || null, plan: hp.plan || null, expires_at: exp.toISOString(), days_until_expiry: days, status: bucket(days), suspended: !!hp.suspended, auto_renew: hp.autoRenew !== false })
      }
    } catch (e) { log(`[ResellerAPI] renewals hosting warn: ${e.message}`) }

    // Domains (domainsOf — read whatever expiry field is present)
    try {
      const domains = await col('domainsOf').find({ chatId }).limit(1000).toArray()
      for (const d of domains) {
        const raw = d.expiresAt || d.expiryDate || d.renewalDate || d.expiry || (d.val && (d.val.expiresAt || d.val.expiryDate)) || null
        if (!raw) continue
        const exp = new Date(raw); if (isNaN(exp)) continue
        const days = Math.ceil((exp.getTime() - nowMs) / DAY)
        items.push({ product: 'domain', id: d.domainName || d._id, domain: d.domainName || null, registrar: d.registrar || null, expires_at: exp.toISOString(), days_until_expiry: days, status: bucket(days) })
      }
    } catch (e) { log(`[ResellerAPI] renewals domains warn: ${e.message}`) }

    // VPS + RDP (reseller-owned flat docs)
    try {
      const vpsDocs = await col('vpsPlansOf').find({ chatId, status: { $ne: 'destroyed' } }).limit(500).toArray()
      const TERMINAL = ['CANCELLED', 'DESTROYED', 'destroyed', 'DELETED']
      for (const v of vpsDocs) {
        const raw = v.end_time || v.expiresAt || v.subscriptionEnd || (v.subscription && v.subscription.subscriptionEnd) || null
        if (!raw) continue
        const exp = new Date(raw); if (isNaN(exp)) continue
        const days = Math.ceil((exp.getTime() - nowMs) / DAY)
        const item = { product: v.isRDP ? 'rdp' : 'vps', id: v.vpsId || v._id, plan: v.plan || null, region: v.region || null, expires_at: exp.toISOString(), days_until_expiry: days, status: bucket(days) }
        // RDP 3-day grace: an expired-but-not-yet-deleted box is powered off and pending
        // permanent deletion at grace_until. Surface it so a polling reseller can renew in time.
        const graceUntil = v.grace_until ? new Date(v.grace_until) : null
        if (v.isRDP && graceUntil && !isNaN(graceUntil.getTime()) && !TERMINAL.includes(String(v.status))) {
          item.status = 'grace'
          item.in_grace = true
          item.expired_at = v.expired_at ? new Date(v.expired_at).toISOString() : null
          item.delete_at = graceUntil.toISOString()
          item.days_until_deletion = Math.max(0, Math.ceil((graceUntil.getTime() - nowMs) / DAY))
        }
        items.push(item)
      }
    } catch (e) { log(`[ResellerAPI] renewals vps warn: ${e.message}`) }

    const filtered = items.filter(i => i.days_until_expiry <= withinDays).sort((a, b) => a.days_until_expiry - b.days_until_expiry)
    res.json({
      within_days: withinDays,
      count: filtered.length,
      summary: {
        expired: filtered.filter(i => i.status === 'expired').length,
        expiring_soon: filtered.filter(i => i.status === 'expiring_soon').length,
        upcoming: filtered.filter(i => i.status === 'upcoming').length,
        in_grace: filtered.filter(i => i.status === 'grace').length,
      },
      renewals: filtered,
    })
  }))

  // ════════════════════════════════════════════════════════
  // VISITOR CAPTCHA (Golden Anti-Red HostPanel only) — read + set
  // ════════════════════════════════════════════════════════
  router.get('/hosting/captcha/:domain', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const goldPrice = num(process.env.GOLDEN_ANTIRED_CPANEL_PRICE, 100)
    const acct = await findOwnedAccountByDomain(req, domain)
    if (!acct) return res.status(404).json({ error: 'not_found', message: 'No hosting account for that domain under your account.' })
    const isGold = /golden[\s-]*anti[\s-]*red/i.test(acct.plan || '')
    const cf = await antiRed.resolveDomainCfState(domain, getDb())
    res.json({
      domain,
      cpanel_username: acct._id || acct.username,
      plan: acct.plan || null,
      gold_plan: isGold,
      eligible: isGold && cf.hasCloudflare,
      has_cloudflare: cf.hasCloudflare,
      visitor_captcha_enabled: isGold ? !cf.isOff : false,
      gold_price_usd: goldPrice,
      ...(isGold ? {} : { note: `Visitor Captcha is exclusive to the Golden Anti-Red HostPanel ($${goldPrice}/mo). Upgrade to enable it.` }),
    })
  }))

  router.post('/hosting/captcha/:domain', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const enabled = req.body?.enabled
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'invalid_body', message: 'Body must include { "enabled": true|false }.' })
    const goldPrice = num(process.env.GOLDEN_ANTIRED_CPANEL_PRICE, 100)
    const acct = await findOwnedAccountByDomain(req, domain)
    if (!acct) return res.status(404).json({ error: 'not_found', message: 'No hosting account for that domain under your account.' })
    if (!/golden[\s-]*anti[\s-]*red/i.test(acct.plan || '')) {
      return res.status(403).json({ error: 'gold_plan_required', message: `Visitor Captcha is exclusive to the Golden Anti-Red HostPanel ($${goldPrice}/mo).`, gold_price_usd: goldPrice })
    }
    const cf = await antiRed.resolveDomainCfState(domain, getDb())
    if (!cf.hasCloudflare) return res.status(409).json({ error: 'no_cloudflare', message: 'Domain is not on Cloudflare; Visitor Captcha cannot be toggled.' })
    if (!isLive()) return res.json({ mode: 'dry_run', domain, visitor_captcha_enabled: enabled, note: 'Dry-run: no change applied to production Cloudflare / KV.' })
    // captcha ON  → bypass OFF (challenge shown), visitorCaptchaOff cleared
    // captcha OFF → bypass ON  (challenge skipped), visitorCaptchaOff=true
    await antiRed.setDomainChallengeBypass(domain, !enabled)
    await col('registeredDomains').updateOne({ _id: domain }, { $set: { 'val.visitorCaptchaOff': enabled ? '' : true } }, { upsert: true })
    res.json({ mode: 'live', domain, visitor_captcha_enabled: enabled })
  }))

  // ════════════════════════════════════════════════════════
  // HONEYPOT TRAPS (Monthly plans — Premium or Golden) — read + set
  // Turning traps off only suppresses the hidden decoy markup via the CF
  // Worker KV flag. Visitor Captcha, scanner cloaking, IP bans and WAF stay on.
  // ════════════════════════════════════════════════════════
  router.get('/hosting/honeypot/:domain', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const acct = await findOwnedAccountByDomain(req, domain)
    if (!acct) return res.status(404).json({ error: 'not_found', message: 'No hosting account for that domain under your account.' })
    const { isWeeklyPlan } = require('./hosting-scheduler')
    const isMonthly = !isWeeklyPlan(acct.plan || '')
    const cf = await antiRed.resolveDomainCfState(domain, getDb())
    res.json({
      domain,
      cpanel_username: acct._id || acct.username,
      plan: acct.plan || null,
      is_monthly: isMonthly,
      eligible: isMonthly && cf.hasCloudflare,
      has_cloudflare: cf.hasCloudflare,
      honeypot_enabled: isMonthly ? !cf.honeypotOff : false,
      ...(isMonthly ? {} : { note: 'Honeypot Traps management is available on Monthly plans (Premium or Golden). Upgrade to manage it.' }),
    })
  }))

  router.post('/hosting/honeypot/:domain', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const enabled = req.body?.enabled
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'invalid_body', message: 'Body must include { "enabled": true|false }.' })
    const acct = await findOwnedAccountByDomain(req, domain)
    if (!acct) return res.status(404).json({ error: 'not_found', message: 'No hosting account for that domain under your account.' })
    const { isWeeklyPlan } = require('./hosting-scheduler')
    if (isWeeklyPlan(acct.plan || '')) {
      return res.status(403).json({ error: 'monthly_plan_required', message: 'Honeypot Traps management is available on Monthly plans (Premium or Golden).' })
    }
    const cf = await antiRed.resolveDomainCfState(domain, getDb())
    if (!cf.hasCloudflare) return res.status(409).json({ error: 'no_cloudflare', message: 'Domain is not on Cloudflare; Honeypot Traps cannot be toggled.' })
    if (!isLive()) return res.json({ mode: 'dry_run', domain, honeypot_enabled: enabled, note: 'Dry-run: no change applied to production Cloudflare / KV.' })
    // honeypot ON  → off flag OFF (traps injected), val.honeypotOff cleared
    // honeypot OFF → off flag ON  (traps skipped), val.honeypotOff=true
    await antiRed.setDomainHoneypot(domain, !enabled)
    await col('registeredDomains').updateOne({ _id: domain }, enabled ? { $unset: { 'val.honeypotOff': '' } } : { $set: { 'val.honeypotOff': true } }, { upsert: true })
    res.json({ mode: 'live', domain, honeypot_enabled: enabled })
  }))

  // ════════════════════════════════════════════════════════
  // DOMAIN RENEWAL (pricing/simulation; live renewal not yet wired)
  // ════════════════════════════════════════════════════════
  router.post('/domains/:domain/renew', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const owned = await col('domainsOf').findOne({ chatId: String(req.reseller.ownerChatId), domainName: domain })
    if (!owned) return res.status(404).json({ error: 'not_found', message: 'That domain is not registered under your account.' })
    const dp = await domainService.checkDomainPrice(domain, getDb())
    const price = Number(dp?.price) || 0
    if (!price) return res.status(502).json({ error: 'pricing_failed', message: 'Could not fetch a renewal price for this domain.' })
    if (isLive()) {
      // No registrar renewal path exists in the codebase yet — refuse BEFORE charging.
      return res.status(501).json({ error: 'not_implemented', message: 'Live domain renewal via API is not yet available. Renew at the registrar or via the Telegram bot. Dry-run pricing is available on sandbox pods.', price_usd: price })
    }
    return billedProvision(req, res, { product: 'domain', action: 'renew', priceUsd: price, request: { domain, renew_usd: price }, provision: async () => ({ success: true, domain }) })
  }))

  // ════════════════════════════════════════════════════════
  // HOSTING — details, renew, upgrade, addon domains
  // ════════════════════════════════════════════════════════
  router.post('/hosting/:user/renew', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const price = hostingScheduler.getPlanPrice(acct)
    const durationDays = hostingScheduler.getPlanDuration(acct.plan)
    if (!price || price <= 0) return res.status(502).json({ error: 'pricing_failed', message: 'Could not determine a renewal price for this plan.' })
    return billedProvision(req, res, {
      product: 'hosting', action: 'renew', priceUsd: price,
      request: { username: acct._id, domain: acct.domain, plan: acct.plan, duration_days: durationDays },
      provision: async () => {
        const base = (acct.expiryDate && new Date(acct.expiryDate) > new Date()) ? new Date(acct.expiryDate) : new Date()
        const newExpiry = new Date(base.getTime() + durationDays * 86400000)
        await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { expiryDate: newExpiry, lastRenewedAt: new Date(), renewalPriceUsd: price, suspended: false, suspendedReason: null, autoRenewLastError: null } })
        if (acct.suspended) { try { await whmService.unsuspendAccount(acct._id) } catch (e) { log(`[ResellerAPI] renew unsuspend warn: ${e.message}`) } }
        return { success: true, username: acct._id, domain: acct.domain, plan: acct.plan, new_expiry: newExpiry.toISOString() }
      },
    })
  }))

  router.post('/hosting/:user/upgrade', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const targets = upgradeCredit.getUpgradeTargets(acct.plan)
    if (!targets.length) return res.status(409).json({ error: 'no_upgrade_path', message: 'This plan has no higher tier to upgrade to.' })
    const wantKey = UPGRADE_ID_TO_KEY[req.body?.plan_id] || req.body?.plan_id
    const target = targets.find(t => t.key === wantKey || t.name === req.body?.plan_id)
    if (!target) {
      const idFor = (key) => Object.keys(UPGRADE_ID_TO_KEY).find(k => UPGRADE_ID_TO_KEY[k] === key) || key
      return res.status(400).json({ error: 'invalid_upgrade_target', message: 'plan_id must be one of the available upgrade targets.', available: targets.map(t => ({ plan_id: idFor(t.key), name: t.name, price_usd: t.price })) })
    }
    const oldPrice = hostingScheduler.getPlanPrice(acct)
    const quote = upgradeCredit.computeUpgradeQuote({ planDoc: acct, oldPrice, newPrice: target.price })
    return billedProvision(req, res, {
      product: 'hosting', action: 'upgrade', priceUsd: quote.chargeAmount,
      request: { username: acct._id, domain: acct.domain, from_plan: acct.plan, to_plan: target.name, sticker_price_usd: target.price, loyalty_credit_usd: quote.creditApplied, charge_usd: quote.chargeAmount },
      provision: async () => {
        try { if (typeof whmService.changePackage === 'function') await whmService.changePackage(acct._id, target.name) }
        catch (e) { return { success: false, error: `WHM changePackage failed: ${e.message}` } }
        await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { plan: target.name, renewalPriceUsd: target.price, upgradedAt: new Date() } })
        return { success: true, username: acct._id, domain: acct.domain, plan: target.name }
      },
    })
  }))

  router.get('/hosting/:user/addons', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const addons = Array.isArray(acct.addonDomains) ? acct.addonDomains : []
    const quota = addonQuota(acct.plan)
    res.json({ username: acct._id, plan: acct.plan || null, addon_quota: quota, addon_count: addons.length, addons: addons.map(a => ({ domain: a.domain || a, created_at: a.createdAt || a.addedAt || null })) })
  }))

  router.post('/hosting/:user/addons', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid addon domain.' })
    const addons = Array.isArray(acct.addonDomains) ? acct.addonDomains : []
    if (addons.some(a => (a.domain || a) === domain)) return res.status(409).json({ error: 'addon_exists', message: 'That domain is already an addon on this account.' })
    const quota = addonQuota(acct.plan)
    if (quota !== 'unlimited' && addons.length >= Number(quota)) {
      return res.status(409).json({ error: 'addon_quota_exceeded', message: `Your ${acct.plan} plan allows ${quota} addon domain(s).`, addon_quota: quota, addon_count: addons.length })
    }
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, addon_domain: domain, addon_quota: quota, note: 'Dry-run: quota check passed; addon not created on cPanel/Cloudflare.' })
    let cpPass = acct.cpPass || acct.password || null
    if (!cpPass && acct.cpPass_encrypted && acct.cpPass_iv && acct.cpPass_tag) {
      // Accounts store the cPanel password AES-256-GCM-encrypted (cpanel-auth),
      // NOT in plaintext — decrypt it the same way the HostPanel does. Without
      // this the live addon-create always failed with 501 no_credentials.
      try { cpPass = cpanelAuth.decrypt({ encrypted: acct.cpPass_encrypted, iv: acct.cpPass_iv, tag: acct.cpPass_tag }) }
      catch (e) { log(`[ResellerAPI] addon decrypt cpPass failed for ${acct._id}: ${e.message}`) }
    }
    if (!cpPass) return res.status(501).json({ error: 'no_credentials', message: 'cPanel password is not on file for this account; cannot create the addon via API.' })
    const r = await addonFlow.attachAddonDomain({ account: { cpUser: acct._id, ...acct }, cpPass, domain, db: getDb() })
    if (!r || r.ok === false) return res.status(502).json({ error: 'addon_failed', message: r?.error || 'Addon creation failed.', kind: r?.errorKind || null })
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $push: { addonDomains: { domain, createdAt: new Date() } } })
    res.json({ mode: 'live', username: acct._id, addon_domain: domain, created: true })
  }))

  // Full hosting deliverables incl. PIN (reveal = reset) + direct cPanel SSO.
  // Live-only for the secret parts, mirroring the bot's "reveal credentials"
  // (PIN reset is a real prod mutation → not run on the dry-run sandbox).
  router.get('/hosting/:user/credentials', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const nameservers = await resolveNameservers(acct)
    const base = {
      username: acct.cpUser || acct._id,
      domain: acct.domain || null,
      plan: acct.plan || null,
      panel_url: panelUrl(),
      server_ip: serverIp(),
      nameservers,
      expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
      mode: mode(),
    }
    if (!isLive()) {
      return res.json({ ...base, panel_pin: null, direct_cpanel_login_url: null, note: 'Revealing the PIN RESETS it (a production write), and direct cPanel SSO are available only in live mode. Username, panel URL, server IP and nameservers above are ready to use now.' })
    }
    const { pin } = await cpanelAuth.resetPin(col('cpanelAccounts'), acct.cpUser || acct._id)
    let loginUrl = null
    try { const s = await whmService.createUserSession(acct._id); loginUrl = s?.url || s || null }
    catch (e) { log(`[ResellerAPI] credentials createUserSession warn: ${e.message}`) }
    res.json({ ...base, panel_pin: pin, direct_cpanel_login_url: loginUrl, note: 'This PIN was freshly generated — the previous PIN is now invalid.' })
  }))

  // ════════════════════════════════════════════════════════
  // IN-ACCOUNT cPANEL MANAGEMENT (email / mysql / subdomains / files /
  // domains / ssl / stats / security / geo / analytics). Registered BEFORE the
  // 2-segment GET /hosting/:user catch-all below so the multi-segment literal
  // routes win first. Reuses cpanel-proxy.js + services (no duplicated logic).
  // ════════════════════════════════════════════════════════
  registerHostingMgmtRoutes({ router, apiKeyAuth, h, col, getDb, loadOwnedCpanel, isLive, mode, log })

  // Account details/usage — 2-segment dynamic route registered LAST so the
  // literal 3-segment routes above (renew/upgrade/addons/login/…) win first.
  router.get('/hosting/:user', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const addons = Array.isArray(acct.addonDomains) ? acct.addonDomains : []
    const nameservers = await resolveNameservers(acct)
    // Live disk/bandwidth usage from WHM (/accountsummary — a READ, safe on any
    // pod). Best-effort: null if WHM is unreachable or the account is unknown.
    let usage = null
    try {
      const info = await whmService.getAccountInfo(acct.cpUser || acct._id)
      if (info && info.success) usage = parseHostingUsage(info.data)
      else if (info && info.error) usage = { error: info.error }
      else usage = { error: 'account_summary_unavailable' }
      // Merge real bandwidth (WHM /showbw — accountsummary has no bandwidth).
      if (usage && !usage.error) {
        try {
          const bw = await whmService.getAccountBandwidth(acct.cpUser || acct._id)
          if (bw && bw.success && bw.data) {
            const usedBytes = Number(bw.data.totalbytes) || 0
            const limitBytes = Number(bw.data.limit) || 0
            usage.bandwidth_used_mb = Math.round((usedBytes / 1048576) * 10) / 10
            usage.bandwidth_limit_mb = limitBytes > 0 ? Math.round(limitBytes / 1048576) : null
            usage.bandwidth_limit = limitBytes > 0 ? Math.round(limitBytes / 1048576) : 'unlimited'
            usage.bandwidth_used_pct = limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 1000) / 10 : null
            usage.bandwidth_period = 'current_month'
          }
        } catch (_) { /* bandwidth best-effort */ }
      }
    } catch (e) { usage = { error: e.message } }
    // GAP-7 FIX (2026-09): the DB `suspended` flag can drift from the live WHM state (WHM
    // auto-suspends for overdue/expiry without our flag being updated), which is why the fast
    // DB-only list and this live-reading detail view could disagree. When the live WHM read
    // succeeded, trust it as the source of truth and self-heal the DB flag so the list converges.
    // (parseHostingUsage maps WHM suspended:1 → true and suspended:0 → undefined, so on a healthy
    //  read `usage.suspended === true` means suspended and anything else means active.)
    const liveRead = !!(usage && !usage.error)
    const liveSuspended = liveRead ? (usage.suspended === true) : null
    const suspended = (liveSuspended !== null) ? liveSuspended : !!acct.suspended
    if (liveSuspended !== null && liveSuspended !== !!acct.suspended) {
      col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: liveSuspended, suspendedSyncedAt: new Date() } }).catch(() => {})
    }
    res.json({
      username: acct._id || acct.username,
      domain: acct.domain || null,
      plan: acct.plan || null,
      price_usd: hostingScheduler.getPlanPrice(acct),
      duration_days: hostingScheduler.getPlanDuration(acct.plan),
      suspended,
      // GAP-4 FIX (2026-09): surface WHY the account is suspended / why auto-renew didn't run, so an
      // integrator can act (e.g. auto_renew_last_error 'insufficient_funds' → top up wallet, then
      // POST /hosting/:user/renew). Populated by the hosting scheduler's expiry/auto-renew sweep.
      suspended_reason: acct.suspendedReason || null,
      suspended_at: acct.suspendedAt ? new Date(acct.suspendedAt).toISOString() : null,
      auto_renew: acct.autoRenew !== false,
      auto_renew_last_error: acct.autoRenewLastError || null,
      auto_renew_last_attempt_at: acct.autoRenewLastAttemptAt ? new Date(acct.autoRenewLastAttemptAt).toISOString() : null,
      created_at: acct.createdAt || null,
      expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
      deliverables: hostingDeliverables(acct, nameservers),
      addon_quota: addonQuota(acct.plan),
      addon_domain_count: addons.length,
      addon_domains: addons.map(a => a.domain || a),
      usage,
      mode: mode(),
    })
  }))


  log(`[ResellerAPI] mounted at /reseller/v1 (mode=${mode()})`)
  return router
}

module.exports = { createResellerApi, hostingPlans }
