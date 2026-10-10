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
const activeSlot = require('./active-slot')

const domainService = require('./domain-service')
const whmService = require('./whm-service')
const vpsProvider = require('./vps-provider')
const hostingScheduler = require('./hosting-scheduler')       // getPlanPrice / getPlanDuration (bot-accurate)
const hostingPlanChange = require('./hosting-plan-change')   // hosting upgrade/downgrade pro-rata quote
const hostingTerms = require('./hosting-terms')               // prepaid 1/3/6/12-month hosting terms + discounts
const domainAutoRenew = require('./domain-auto-renew')        // per-domain wallet auto-renew (OpenProvider)
const opService = require('./op-service')                     // OpenProvider reads (expiry, renewal price)
const doPlanChange = require('./do-plan-change')             // DigitalOcean VPS/RDP in-place resize engine
const planChangeHistory = require('./plan-change-history')   // plan-change history (hosting + VPS + RDP) for GET …/plan-changes
const doUsage = require('./do-usage')                         // DigitalOcean VPS/RDP usage metrics
const antiRed = require('./anti-red-service')                 // resolveDomainCfState / setDomainChallengeBypass
const addonFlow = require('./addon-domain-flow')              // attachAddonDomain
const cpanelAuth = require('./cpanel-auth')                   // resetPin (reveal = reset, prod mutation)
const { registerHostingMgmtRoutes } = require('./reseller-hosting-mgmt') // in-account cPanel mgmt (reuses cpanel-proxy + services, no duplication)
const { teardownHostingDomain } = require('./hosting-dns-teardown') // ownership-safe DNS/worker-route teardown
const hostingDnsRepair = require('./hosting-dns-repair')          // POST /hosting/:user/dns/repair
const { registerShortenerRoutes } = require('./reseller-shortener')      // URL shortener: buy/connect domain + link CRUD (reuses fullUrlOf/linksOf/clicksOn)
const brandedNs = require('./branded-ns')                     // branded nameservers (ns1/ns2.hosta.sh) — reseller API default
const activity = require('./reseller-activity')               // GET /activity (per-service change log)
const { apiRecorder } = require('./reseller-activity-api')    // records successful API mutations (actor "api")
const alerts = require('./reseller-alerts')                   // expiry / renewal / low-balance webhooks + sweeps
const siteHealth = require('./reseller-site-health')          // GET /hosting/:user/health + uptime monitor
const usageAlerts = require('./reseller-usage-alerts')        // usage-threshold levels (documented on GET /account/alerts)

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
  router.use(apiRecorder(getDb))

  const col = (name) => {
    const db = getDb()
    if (!db) throw new Error('Database not ready')
    return db.collection(name)
  }

  // ── Mode: are we allowed to actually provision + charge? ──
  // Live provisioning is gated SOLELY on RESELLER_API_LIVE=true. This lets the
  // reseller API run live on a dev pod while SKIP_WEBHOOK_SYNC=true continues to
  // keep the phone health monitor, Telnyx/Twilio webhook sync, AntiRed worker
  // upgrade and Cloudflare Discovery Worker sync safely DISABLED.
  // NOTE: this pod shares the production provider accounts + Mongo, so with
  // RESELLER_API_LIVE=true reseller calls WILL create real resources and debit
  // the real wallet. Keep RESELLER_API_LIVE unset on any pod that must stay dry-run.
  function isLive() {
    return process.env.RESELLER_API_LIVE === 'true'
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

  // account.low_balance right after a debit (the 10-minute sweep is the safety net). Best-effort.
  function lowBalanceCheck(chatId) {
    try { alerts.checkLowBalance(getDb(), chatId, { log }).catch((e) => log(`[ResellerAPI] low-balance check: ${e.message}`)) } catch (_) { /* best-effort */ }
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
    lowBalanceCheck(chatId)

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

  // ── Lifecycle / renewability helpers (shared by reads, /renewals, renew pre-flight) ──
  // Hosting grace = the window between expiry-suspension and permanent deletion. The
  // hosting scheduler suspends the moment a plan expires and deletes HOSTING_GRACE_HOURS
  // later, so delete_at = expiryDate + HOSTING_GRACE_HOURS. Hosting grace is 48h (shorter
  // than the 72h / 3-day VPS+RDP grace) — kept in sync with hosting-scheduler.GRACE_PERIOD_HOURS.
  const HOSTING_GRACE_HOURS = 48

  function hostingGraceInfo(acct, nowMs) {
    const exp = acct.expiryDate ? new Date(acct.expiryDate) : null
    if (!exp || isNaN(exp.getTime())) return null
    const deleteAtMs = exp.getTime() + HOSTING_GRACE_HOURS * 3600000
    return {
      in_grace: true,
      expired_at: exp.toISOString(),
      delete_at: new Date(deleteAtMs).toISOString(),
      grace_hours: HOSTING_GRACE_HOURS,
      days_remaining: Math.max(0, Math.ceil((deleteAtMs - nowMs) / 86400000)),
      hours_remaining: Math.max(0, Math.ceil((deleteAtMs - nowMs) / 3600000)),
      _deleteAtMs: deleteAtMs,
    }
  }

  // state ∈ online | suspended | grace | terminated. `suspended` is forced false when
  // terminated so the legacy boolean never lies. Pass price/duration to resolve renewable.
  function hostingLifecycle(acct, { price, duration, liveSuspended } = {}) {
    const nowMs = Date.now()
    const terminated = !!(acct.deleted || acct.terminatedOnWhm)
    const exp = acct.expiryDate ? new Date(acct.expiryDate) : null
    const expired = !!(exp && !isNaN(exp.getTime()) && exp.getTime() <= nowMs)
    const suspended = terminated ? false : (liveSuspended != null ? liveSuspended : !!acct.suspended)

    let state = 'online'
    let grace = null
    if (terminated) {
      state = 'terminated'
    } else if (expired && suspended) {
      const g = hostingGraceInfo(acct, nowMs)
      if (g && nowMs < g._deleteAtMs) { state = 'grace'; delete g._deleteAtMs; grace = g }
      else state = 'suspended'
    } else if (suspended) {
      state = 'suspended'
    }

    let renewable = true, reason = null, renewAvailableAt = null
    if (terminated) { renewable = false; reason = 'account_terminated' }
    else if (price != null && duration != null && (!(price > 0) || !(duration > 0))) { renewable = false; reason = 'pricing_unavailable' }
    else if (duration != null) {
      // Weekly plans renew one week at a time, only once 7 days or fewer are left.
      const wb = hostingPlanChange.weeklyRenewBlock(acct, { durationDays: duration })
      if (wb) { renewable = false; reason = wb.renew_blocked_reason; renewAvailableAt = wb.renew_available_at || null }
    }
    return { state, terminated, suspended, grace, renewable, renew_blocked_reason: reason, renew_available_at: renewAvailableAt }
  }

  const VPS_TERMINAL = ['CANCELLED', 'DESTROYED', 'destroyed', 'DELETED']
  function vpsRenewability(rec, isRDP, prov) {
    const st = String(rec.status || '')
    if (st === 'provisioning' || st === 'PROVISIONING') return { renewable: false, renew_blocked_reason: 'provisioning' }
    if (st === 'failed' || st === 'FAILED' || rec.provisionState === 'failed') return { renewable: false, renew_blocked_reason: 'provision_failed' }
    const destroyedByGrace = rec.cancelReason === 'expired_grace' || rec.destroy_reason === 'expired_grace'
    if (destroyedByGrace || VPS_TERMINAL.includes(st)) return { renewable: false, renew_blocked_reason: 'already_destroyed' }
    if (isRDP) {
      const canProviderRenew = !!rec.instanceId && prov && typeof prov.renewInstance === 'function'
      if (!canProviderRenew) return { renewable: false, renew_blocked_reason: 'not_supported' }
    }
    return { renewable: true, renew_blocked_reason: null }
  }

  // ════════════════════════════════════════════════════════
  // ASYNC CREATE — jobs persisted in `resellerProvisionJobs` so a slow (or
  // deploy-interrupted) build can't make the reseller time out and orphan an
  // account. POST create returns a fast 202 handle; a singleton worker runs the
  // real provisioning, charges-up-front / refunds-on-failure, and emits the
  // *.provisioned / *.provision_failed webhooks. Reads report state
  // provisioning|active|failed meanwhile. client_ref makes retries idempotent.
  // ════════════════════════════════════════════════════════
  const PROVISION_STUCK_MS = Math.max(300000, Number(process.env.RESELLER_PROVISION_STUCK_MS) || 30 * 60000)
  const provisionJobs = () => col('resellerProvisionJobs')

  function emitEvent(ownerChatId, event, instanceId, payload, dedupKey) {
    try { require('./reseller-webhooks').emit(getDb(), { chatId: ownerChatId, event, instanceId, dedupKey, payload, log }).catch(() => {}) } catch (_) { /* best-effort */ }
  }

  // Up-front wallet guard + charge for an async create. On insufficient funds sends 402 and
  // returns {ok:false}. In dry_run it validates the balance but never charges.
  async function chargeForAsync(req, res, { product, action, priceUsd, request }) {
    const chatId = req.reseller.ownerChatId
    const price = Math.round(Number(priceUsd) * 100) / 100
    if (!Number.isFinite(price) || price < 0) { res.status(400).json({ error: 'pricing_failed', message: 'Could not determine a valid price for this order.' }); return { ok: false } }
    const balance = await walletBalance(chatId)
    if (balance < price) {
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: chatId, product, action, request, priceUsd: price, mode: mode(), status: 'rejected_insufficient_balance' })
      res.status(402).json({ error: 'insufficient_wallet_balance', message: `Wallet balance $${balance.toFixed(2)} is below the order price $${price.toFixed(2)}. Top up your wallet and retry.`, product, action, price_usd: price, wallet_balance_usd: balance, shortfall_usd: Math.round((price - balance) * 100) / 100, mode: mode() })
      return { ok: false }
    }
    let charged = false
    if (isLive()) {
      charged = await chargeWallet(chatId, price)
      if (!charged) { res.status(402).json({ error: 'insufficient_wallet_balance', message: 'Wallet debit was declined (insufficient funds / concurrent spend).', price_usd: price, wallet_balance_usd: balance }); return { ok: false } }
      lowBalanceCheck(chatId)
    }
    return { ok: true, balance, charged, price }
  }

  // Idempotency: a retry with the same (owner, client_ref) returns the SAME job.
  async function findJobByClientRef(ownerChatId, clientRef) {
    if (!clientRef) return null
    return provisionJobs().findOne({ ownerChatId: String(ownerChatId), clientRef: String(clientRef) })
  }

  // Coarse, product-aware ETA (seconds) for an async build — powers the storefront "setting up…"
  // countdown. Hosting ≈ WHM createacct + DNS; VPS ≈ droplet boot; RDP depends on the Windows
  // edition (fast_deploy golden image ≈ 3-5 min, full unattended install ≈ 45 min).
  function estimateEtaSeconds(product, request) {
    if (product === 'hosting') return 120
    if (product === 'vps') return 180
    const os = String((request && request.osId) || '').toLowerCase()
    if (os === 'ws2025') return 300
    if (os === 'ws2019' || os === 'ws2022') return 180
    return 2700 // full unattended Windows install
  }

  // Live progress snapshot for a job: status + a 0-100 progress bar + an ETA countdown, all derived
  // from product + elapsed time (the build itself is opaque). done→100, failed→0.
  function jobProgress(job) {
    const status = jobStatusLabel(job)
    const createdMs = job.createdAt ? new Date(job.createdAt).getTime() : Date.now()
    const elapsed = Math.max(0, Math.round((Date.now() - createdMs) / 1000))
    const eta = Number(job.etaSeconds) || estimateEtaSeconds(job.product, job.request)
    if (status === 'provisioned') return { status, progress: 100, stage: 'ready', stage_label: 'Ready', eta_seconds: 0, eta_at: null, elapsed_seconds: elapsed }
    if (status === 'failed') return { status, progress: 0, stage: 'failed', stage_label: 'Provisioning failed', eta_seconds: 0, eta_at: null, elapsed_seconds: elapsed }
    const remaining = Math.max(0, eta - elapsed)
    const frac = eta > 0 ? Math.min(0.95, elapsed / eta) : 0.5
    const progress = Math.max(5, Math.min(95, Math.round(10 + frac * 85)))
    const label = job.product === 'hosting' ? 'Registering domain & creating your cPanel account'
      : (job.request && job.request.isRDP) ? 'Deploying your Windows server'
        : 'Creating your server'
    return { status, progress, stage: 'provisioning', stage_label: label, eta_seconds: remaining, eta_at: new Date(Date.now() + remaining * 1000).toISOString(), elapsed_seconds: elapsed }
  }

  // Map a provision job → the canonical status/handle shape (used by the 202 create, an idempotent
  // client_ref re-hit, and GET /jobs/:job_id). Carries the live progress + ETA. status ∈
  // provisioning | provisioned | failed.
  function jobStatusLabel(job) {
    return job.status === 'done' ? 'provisioned' : (job.status === 'failed' ? 'failed' : 'provisioning')
  }
  function jobHandle(job) {
    const r = job.request || {}
    const base = {
      ...jobProgress(job), mode: job.mode, job_id: job._id, price_usd: job.priceUsd,
      created_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    }
    if (job.product === 'hosting') {
      return {
        ...base, product: 'hosting',
        username: job.username, id: job.username, domain: r.domain || null, plan: r.plan || null,
        poll_url: `/hosting/${job.username}`, credentials_url: `/hosting/${job.username}/credentials`,
        ...(job.status === 'failed' ? { error: job.error || 'provision_failed', provision_failed_reason: job.error || 'provision_failed', refunded: !!job.refunded } : {}),
      }
    }
    const isRDP = !!r.isRDP
    return {
      ...base, product: isRDP ? 'rdp' : 'vps',
      id: job.vpsId, plan: r.plan || r.plan_id || null, region: r.region || null,
      poll_url: `/${isRDP ? 'rdp' : 'vps'}/${job.vpsId}`, credentials_url: `/${isRDP ? 'rdp' : 'vps'}/${job.vpsId}/credentials`,
      ...(r.osId ? { os: r.osId } : {}),
      ...(job.status === 'failed' ? { error: job.error || 'provision_failed', provision_failed_reason: job.error || 'provision_failed', refunded: !!job.refunded } : {}),
    }
  }

  // ── Hosting job runner ──
  async function runHostingJob(job) {
    const owner = String(job.ownerChatId)
    const r = job.request
    const termMonths = hostingTerms.isTerm(r.term_months) ? Number(r.term_months) : 1
    const durationDays = (Number(hostingScheduler.getPlanDuration(r.plan)) || 30) * termMonths
    if (job.mode === 'dry_run') {
      const expiry = new Date(Date.now() + durationDays * 86400000)
      await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { provisionState: 'active', expiryDate: expiry, termMonths, autoRenew: durationDays >= 30 }, $unset: { provisionFailedReason: '' } })
      await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), simulated: true, result: { username: job.username } } })
      emitEvent(owner, 'hosting.provisioned', job.username, { domain: r.domain, plan: r.plan, cpanel_username: job.username, username: job.username, term_months: termMonths, expires_at: expiry.toISOString(), simulated: true })
      return
    }
    const { registerDomainAndCreateCpanel } = require('./cr-register-domain-&-create-cpanel.js')
    const info = {
      _id: `reseller_${crypto.randomUUID()}`, website_name: r.domain, plan: r.plan, email: r.email || null,
      userLanguage: 'en', price: job.priceUsd, hostingPrice: r.hostingPrice, registrar: r.registrar || null,
      source: 'reseller_api', ownerChatId: owner, customUsername: job.username,
      nameserver: 'cloudflare', nsChoice: 'cloudflare',
    }
    if (r.domain_mode === 'existing') info.existingDomain = true
    else if (r.domain_mode === 'external') info.connectExternalDomain = true
    let result
    try { result = await registerDomainAndCreateCpanel(() => {}, info, [], col('state'), null) }
    catch (e) { result = { success: false, error: e.message } }

    // WHM temporarily down → defer: keep the job pending for the worker to retry (do NOT refund yet).
    if (result && result.deferred) {
      if ((job.attempts || 0) >= 5) {
        if (job.charged) await refundWallet(owner, job.priceUsd)
        await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { provisionState: 'failed', provisionFailedReason: 'provider_unavailable' } })
        await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date(), error: 'provider_unavailable', refunded: !!job.charged } })
        emitEvent(owner, 'hosting.provision_failed', job.username, { domain: r.domain, plan: r.plan, username: job.username, reason: 'provider_unavailable', refunded: !!job.charged })
        return
      }
      await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'pending', leaseAt: null, deferredAt: new Date() } })
      return
    }
    if (!result || result.success === false) {
      if (job.charged) await refundWallet(owner, job.priceUsd)
      await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { provisionState: 'failed', provisionFailedReason: (result && result.error) || 'provision_failed' } })
      await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date(), error: (result && result.error) || 'provision_failed', refunded: !!job.charged } })
      emitEvent(owner, 'hosting.provision_failed', job.username, { domain: r.domain, plan: r.plan, username: job.username, reason: (result && result.error) || 'provision_failed', refunded: !!job.charged })
      return
    }
    const finalUser = String(result.username || job.username).toLowerCase()
    const expiry = new Date(Date.now() + durationDays * 86400000)
    // Persist the generated cPanel password (encrypted) into the reseller DB so every
    // /hosting/:user/* management endpoint (files, subdomains, ssl, stats, addon, mysql…)
    // can authenticate to cPanel. The provisioning helper stores creds via its own
    // process.env.MONGO_URL client; when the reseller API runs on a dedicated DB
    // connection that differs from MONGO_URL, those creds never reach the DB the API
    // reads from → HTTP 501 no_credentials. Idempotent on production (same DB).
    const credSet = {}
    try {
      if (result.password) {
        const enc = cpanelAuth.encrypt(result.password)
        credSet.cpUser = result.username || finalUser
        credSet.cpPass_encrypted = enc.encrypted
        credSet.cpPass_iv = enc.iv
        credSet.cpPass_tag = enc.tag
        credSet.whmHost = result.whmHost || process.env.WHM_HOST || null
      } else {
        log(`[ResellerAPI] WARN: no cPanel password returned for ${finalUser}; management endpoints may 501`)
      }
    } catch (e) { log(`[ResellerAPI] credential persist failed for ${finalUser}: ${e.message}`) }
    await col('cpanelAccounts').updateOne({ _id: finalUser }, { $set: {
      chatId: owner, source: 'reseller_api', ownerEmail: r.email || null, domain: r.domain, plan: r.plan,
      provisionState: 'active', provisionJobId: job._id, clientRef: job.clientRef || null,
      expiryDate: expiry, renewalPriceUsd: r.hostingPrice, termMonths, autoRenew: durationDays >= 30,
      ...credSet,
    } }, { upsert: true })
    if (finalUser !== job.username) {
      await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { supersededBy: finalUser, deleted: true, deletedAt: new Date(), deletedBy: 'superseded_final_username' } })
    }
    // Branded nameservers for a newly bought domain: it was registered on the CF-assigned names
    // (needed for Cloudflare activation); queue the automatic switch to ns1/ns2.hosta.sh.
    let nsView = { nameservers: result.nameservers || [] }
    if (r.domain_mode === 'buy' && r.ns_choice === 'branded') {
      try {
        await brandedNs.enqueue(getDb(), { domain: r.domain, ownerChatId: owner, source: 'hosting', registrar: r.registrar || null, cfNameservers: result.nameservers || [], username: finalUser })
        nsView = brandedNs.displayFromDoc({ status: 'activating', brandedNs: brandedNs.brandedNameservers(), cfNameservers: result.nameservers || [] })
      } catch (e) {
        log(`[ResellerAPI] branded-ns enqueue failed for ${r.domain}: ${e.message}`)
        try { await notifyAdmin(`⚠️ <b>Branded NS</b> enqueue failed for <code>${r.domain}</code> (stays on Cloudflare names): ${e.message}`) } catch (_) { /* best-effort */ }
      }
    }
    await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), username: finalUser, result: { username: finalUser, nameservers: nsView.nameservers || [], ...(nsView.nameserver_mode ? { nameserver_mode: nsView.nameserver_mode, nameserver_status: nsView.nameserver_status, current_nameservers: nsView.current_nameservers } : {}) } } })
    emitEvent(owner, 'hosting.provisioned', finalUser, { domain: r.domain, plan: r.plan, cpanel_username: finalUser, username: finalUser, term_months: termMonths, expires_at: expiry.toISOString(), nameservers: nsView.nameservers || [], ...(nsView.nameserver_mode ? { nameserver_mode: nsView.nameserver_mode, nameserver_status: nsView.nameserver_status, current_nameservers: nsView.current_nameservers } : {}), panel_url: panelUrl(), server_ip: serverIp() })
  }

  // ── VPS / RDP job runner ──
  async function runVpsJob(job) {
    const owner = String(job.ownerChatId)
    const r = job.request
    const isRDP = !!r.isRDP
    const okEvent = isRDP ? 'rdp.provisioned' : 'vps.provisioned'
    const failEvent = isRDP ? 'rdp.provision_failed' : 'vps.provision_failed'
    if (job.mode === 'dry_run') {
      await col('vpsPlansOf').updateOne({ _id: job.vpsId }, { $set: { status: 'RUNNING', provisionState: 'active', host: '203.0.113.10', end_time: new Date(Date.now() + 30 * 86400000) } })
      await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), simulated: true } })
      emitEvent(owner, okEvent, job.vpsId, { plan: r.plan, region: r.region, id: job.vpsId, simulated: true })
      return
    }
    const prov = providerFor(isRDP)
    // Linux VPS: pre-generate a strong root password + durable secret so it is set at
    // first boot (cloud-init) and retrievable later via GET /vps/:id/credentials. Launch
    // with any reseller-supplied SSH keys so the box is reachable immediately. (RDP keeps
    // its own agent-driven password handling inside the provider's create.)
    let vpsPasswordSecretId = null
    const createOpts = { productId: r.plan_id, regionSlug: r.region, isWindows: isRDP, osId: r.osId || undefined, label: r.hostname || undefined }
    if (!isRDP) {
      try {
        if (typeof prov.createSecret === 'function') {
          const pw = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
          const sec = await prov.createSecret(`vps-${String(job.vpsId).slice(0, 8)}`, pw, 'password')
          vpsPasswordSecretId = (sec && (sec.secretId || sec.id)) || null
          if (vpsPasswordSecretId) createOpts.rootPassword = vpsPasswordSecretId
        }
      } catch (e) { log(`[ResellerAPI] vps password secret create failed for ${job.vpsId}: ${e.message}`) }
      if (Array.isArray(r.ssh_key_ids) && r.ssh_key_ids.length) createOpts.sshKeys = r.ssh_key_ids
    }
    let inst
    try {
      const createFn = (isRDP && prov.createInstanceWithFallback) ? prov.createInstanceWithFallback.bind(prov) : prov.createInstance.bind(prov)
      inst = await createFn(createOpts)
    } catch (e) { inst = { success: false, error: e.message } }
    if (!inst || inst.success === false) {
      if (job.charged) await refundWallet(owner, job.priceUsd)
      await col('vpsPlansOf').updateOne({ _id: job.vpsId }, { $set: { status: 'failed', provisionState: 'failed', provisionFailedReason: (inst && inst.error) || 'provision_failed' } })
      await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date(), error: (inst && inst.error) || 'provision_failed', refunded: !!job.charged } })
      emitEvent(owner, failEvent, job.vpsId, { plan: r.plan, region: r.region, id: job.vpsId, reason: (inst && inst.error) || 'provision_failed', refunded: !!job.charged })
      return
    }
    await col('vpsPlansOf').updateOne({ _id: job.vpsId }, { $set: {
      instanceId: inst.instanceId || null, host: inst.mainIp || null, status: inst.status || 'RUNNING',
      provisionState: 'active', rootPasswordSecretId: inst.passwordSecretId || vpsPasswordSecretId || null,
      end_time: new Date(Date.now() + 30 * 86400000),
    } })
    await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), result: { id: job.vpsId, instance_id: inst.instanceId || null, ip: inst.mainIp || null } } })
    emitEvent(owner, okEvent, job.vpsId, { plan: r.plan, region: r.region, id: job.vpsId, ip: inst.mainIp || null, instance_id: inst.instanceId || null })
  }

  // Atomically claim + run one job. Safe against double-processing (worker + request path).
  async function processJob(jobId) {
    let job
    try {
      job = await provisionJobs().findOneAndUpdate(
        { _id: jobId, status: 'pending' },
        { $set: { status: 'processing', leaseAt: new Date() }, $inc: { attempts: 1 } },
        { returnDocument: 'after', includeResultMetadata: false },
      )
    } catch (e) { log(`[ResellerAPI] processJob claim error: ${e.message}`); return }
    if (!job) return
    try {
      if (job.product === 'hosting') await runHostingJob(job)
      else await runVpsJob(job)
    } catch (e) {
      log(`[ResellerAPI] processJob ${jobId} crashed: ${e.message}`)
      try {
        if (job.charged) await refundWallet(String(job.ownerChatId), job.priceUsd)
        const isHosting = job.product === 'hosting'
        const key = isHosting ? job.username : job.vpsId
        await col(isHosting ? 'cpanelAccounts' : 'vpsPlansOf').updateOne({ _id: key }, { $set: { provisionState: 'failed', status: 'failed', provisionFailedReason: e.message } })
        await provisionJobs().updateOne({ _id: jobId }, { $set: { status: 'failed', finishedAt: new Date(), error: e.message, refunded: !!job.charged } })
        emitEvent(String(job.ownerChatId), isHosting ? 'hosting.provision_failed' : (job.request.isRDP ? 'rdp.provision_failed' : 'vps.provision_failed'), key, { reason: e.message, refunded: !!job.charged })
      } catch (_) { /* best-effort */ }
    }
  }

  // Worker: process stragglers + reconcile stale 'processing' jobs (the slot that owned the
  // job died mid-build — e.g. a deploy flip). Never blindly re-runs a half-done build.
  async function provisionWorkerTick() {
    try {
      const pend = await provisionJobs().find({ status: 'pending' }).limit(10).toArray()
      for (const j of pend) await processJob(j._id)
      if (!isLive()) return
      await doPlanChange.reconcileStale({
        vpsPlansOf: col('vpsPlansOf'), walletOf: col('walletOf'), log,
        onDone: (r) => { if (r.change.via === 'api') emitPlanChange(r.change.kind === 'rdp', r.rec, r) },
      }).catch((e) => log(`[ResellerAPI] plan-change reconcile error: ${e.message}`))
      const cutoff = new Date(Date.now() - PROVISION_STUCK_MS)
      const stale = await provisionJobs().find({ status: 'processing', leaseAt: { $lt: cutoff } }).limit(10).toArray()
      for (const job of stale) {
        const owner = String(job.ownerChatId)
        if (job.product === 'hosting') {
          let exists = false
          try { const i = await whmService.getAccountInfo(job.username); exists = !!(i && i.success) } catch (_) {}
          if (exists) {
            const termMonths = hostingTerms.isTerm(job.request.term_months) ? Number(job.request.term_months) : 1
            const durationDays = (Number(hostingScheduler.getPlanDuration(job.request.plan)) || 30) * termMonths
            const expiry = new Date(Date.now() + durationDays * 86400000)
            await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { chatId: owner, source: 'reseller_api', domain: job.request.domain, plan: job.request.plan, provisionState: 'active', expiryDate: expiry, renewalPriceUsd: job.request.hostingPrice, termMonths, autoRenew: durationDays >= 30 } })
            await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), reconciled: true } })
            emitEvent(owner, 'hosting.provisioned', job.username, { domain: job.request.domain, plan: job.request.plan, cpanel_username: job.username, username: job.username, term_months: termMonths, expires_at: expiry.toISOString(), reconciled: true })
          } else {
            if (job.charged) await refundWallet(owner, job.priceUsd)
            await col('cpanelAccounts').updateOne({ _id: job.username }, { $set: { provisionState: 'failed', provisionFailedReason: 'provisioning_interrupted' } })
            await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date(), error: 'provisioning_interrupted', refunded: !!job.charged, reconciled: true } })
            emitEvent(owner, 'hosting.provision_failed', job.username, { domain: job.request.domain, plan: job.request.plan, username: job.username, reason: 'provisioning_interrupted', refunded: !!job.charged })
          }
        } else {
          if (job.charged) await refundWallet(owner, job.priceUsd)
          await col('vpsPlansOf').updateOne({ _id: job.vpsId }, { $set: { status: 'failed', provisionState: 'failed', provisionFailedReason: 'provisioning_interrupted' } })
          await provisionJobs().updateOne({ _id: job._id }, { $set: { status: 'failed', finishedAt: new Date(), error: 'provisioning_interrupted', refunded: !!job.charged, reconciled: true } })
          emitEvent(owner, job.request.isRDP ? 'rdp.provision_failed' : 'vps.provision_failed', job.vpsId, { plan: job.request.plan, id: job.vpsId, reason: 'provisioning_interrupted', refunded: !!job.charged })
        }
      }
    } catch (e) { log(`[ResellerAPI] provisionWorkerTick error: ${e.message}`) }
  }

  // ════════════════════════════════════════════════════════
  // META
  // ════════════════════════════════════════════════════════
  router.get('/health', (req, res) => res.json({
    ok: true, service: 'reseller-api', version: 'v1', mode: mode(),
    products: ['domains', 'dns', 'vps', 'rdp', 'hosting', 'shortener'],
  }))

  router.get('/account', apiKeyAuth, h(async (req, res) => {
    const balance = await walletBalance(req.reseller.ownerChatId)
    res.json({ owner_chat_id: req.reseller.ownerChatId, label: req.reseller.label, wallet_balance_usd: balance, currency: 'usd', webhook_url: req.reseller.webhookUrl || null, mode: mode() })
  }))

  // ── Provisioning job status ──
  // Poll an async create (POST /hosting | /vps | /rdp returns a job_id) for live progress + ETA,
  // so a storefront can render a "setting up your service…" bar without hammering the resource read.
  // Owner-scoped. status ∈ provisioning (progress ramps, eta_seconds counts down) | provisioned
  // (progress 100 — read the resource at poll_url) | failed (wallet auto-refunded, refunded:true).
  router.get('/jobs/:job_id', apiKeyAuth, h(async (req, res) => {
    const job = await provisionJobs().findOne({ _id: String(req.params.job_id), ownerChatId: String(req.reseller.ownerChatId) })
    if (!job) return res.status(404).json({ error: 'not_found', message: 'No provisioning job with that job_id for this account.' })
    res.json({ ...jobHandle(job), mode: mode() })
  }))

  // ── Push webhooks (optional): register a URL to receive RDP lifecycle events
  // (rdp.grace_start, rdp.deleted) instead of polling /renewals. Plain POST, no signature.
  const resellerWebhooks = require('./reseller-webhooks')
  const WEBHOOK_DELIVERY_NOTE = 'POST signed with HMAC-SHA256. Header X-Nomadly-Signature: "sha256=<hex of HMAC(webhook_secret, raw_request_body)>" (verify it before acting on any *.deleted). Auto-retried with backoff and de-duplicated per server+event.'
  const listedEvents = () => (brandedNs.isEnabled() ? resellerWebhooks.EVENTS : resellerWebhooks.EVENTS.filter((e) => !e.startsWith('domain.nameservers_')))
  router.get('/account/webhook', apiKeyAuth, h(async (req, res) => {
    const keyDoc = await col('resellerApiKeys').findOne({ _id: req.reseller.keyId }, { projection: { webhookUrl: 1, webhookSecret: 1 } })
    res.json({ webhook_url: (keyDoc && keyDoc.webhookUrl) || null, webhook_secret: (keyDoc && keyDoc.webhookSecret) || null, events: listedEvents(), delivery: WEBHOOK_DELIVERY_NOTE })
  }))
  router.put('/account/webhook', apiKeyAuth, h(async (req, res) => {
    const raw = req.body?.webhook_url
    // null / '' clears the URL (the signing secret is KEPT so re-enabling reuses it).
    if (raw === null || raw === '' || raw === undefined) {
      await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $unset: { webhookUrl: '' } })
      return res.json({ webhook_url: null, cleared: true })
    }
    const url = String(raw).trim()
    if (!resellerWebhooks.isHttpUrl(url)) return res.status(400).json({ error: 'invalid_webhook_url', message: 'Provide a valid http(s) URL, or null to clear.' })
    // Mint a signing secret on first set so the reseller can verify deliveries.
    const keyDoc = await col('resellerApiKeys').findOne({ _id: req.reseller.keyId }, { projection: { webhookSecret: 1 } })
    const secret = (keyDoc && keyDoc.webhookSecret) || resellerWebhooks.newWebhookSecret()
    await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $set: { webhookUrl: url, webhookSecret: secret } })
    res.json({ webhook_url: url, webhook_secret: secret, events: listedEvents(), delivery: WEBHOOK_DELIVERY_NOTE })
  }))

  // ── Alerts: low-balance threshold (per key) + the fixed reminder / monitor / usage settings ──
  const ALERT_EVENTS = ['hosting.expiring', 'vps.expiring', 'rdp.expiring', 'domain.expiring', 'domain.expired', 'hosting.renewed', 'vps.renewed', 'rdp.renewed', 'domain.renewed', 'hosting.unsuspended', 'hosting.site_down', 'hosting.site_recovered', 'hosting.usage_threshold', 'vps.usage_threshold', 'rdp.usage_threshold', 'account.low_balance']
  async function alertsView(req) {
    const k = await col('resellerApiKeys').findOne({ _id: req.reseller.keyId }, { projection: { alerts: 1, webhookUrl: 1 } })
    const a = (k && k.alerts) || {}
    const threshold = Number(a.lowBalanceUsd) > 0 ? Number(a.lowBalanceUsd) : null
    const balance = await walletBalance(req.reseller.ownerChatId)
    return {
      low_balance_usd: threshold,
      wallet_balance_usd: balance,
      below_threshold: threshold != null && balance < threshold,
      low_balance_alerted_at: a.lowBalanceAlertedAt ? new Date(a.lowBalanceAlertedAt).toISOString() : null,
      webhook_configured: !!(k && k.webhookUrl),
      expiry_reminder_days: alerts.STAGES,
      health_check: { interval_minutes: 5, failures_before_site_down: siteHealth.FAIL_THRESHOLD, auto_dns_repair: true },
      usage_thresholds: {
        hosting: { disk_pct: usageAlerts.HOSTING_LEVELS.disk, bandwidth_pct: usageAlerts.HOSTING_LEVELS.bandwidth, inodes_pct: usageAlerts.HOSTING_LEVELS.inodes, check_interval_minutes: 60 },
        vps_rdp: { cpu_pct: usageAlerts.SERVER_LEVELS.cpu[0], cpu_window_minutes: 15, memory_pct: usageAlerts.SERVER_LEVELS.memory[0], disk_pct: usageAlerts.SERVER_LEVELS.disk[0], check_interval_minutes: 15 },
      },
      events: ALERT_EVENTS,
    }
  }
  router.get('/account/alerts', apiKeyAuth, h(async (req, res) => res.json(await alertsView(req))))
  router.put('/account/alerts', apiKeyAuth, h(async (req, res) => {
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'low_balance_usd')) {
      return res.status(400).json({ error: 'nothing_to_update', message: 'Body: { "low_balance_usd": <number> } — or null / 0 to turn the low-balance alert off.' })
    }
    const raw = req.body.low_balance_usd
    if (raw === null || raw === 0 || raw === '0') {
      await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $unset: { 'alerts.lowBalanceUsd': '', 'alerts.lowBalanceAlertedAt': '' } })
      return res.json(await alertsView(req))
    }
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN)
    if (!Number.isFinite(n) || n < 0 || n > 1000000) return res.status(400).json({ error: 'invalid_low_balance_usd', message: 'low_balance_usd must be a number between 0 and 1000000 (USD), or null to turn the alert off.' })
    await col('resellerApiKeys').updateOne({ _id: req.reseller.keyId }, { $set: { 'alerts.lowBalanceUsd': Math.round(n * 100) / 100 }, $unset: { 'alerts.lowBalanceAlertedAt': '' } })
    lowBalanceCheck(req.reseller.ownerChatId)
    res.json(await alertsView(req))
  }))

  // ── Per-service change-activity log (api | bot | system), newest first, kept 90 days ──
  router.get('/activity', apiKeyAuth, h(async (req, res) => {
    let f
    try { f = activity.parseFilters(req.query) } catch (e) {
      if (!(e instanceof activity.ActivityQueryError)) throw e
      return res.status(e.status).json({ error: e.code, message: e.message })
    }
    const pg = await activity.list(getDb(), req.reseller.ownerChatId, f)
    res.json({
      filters: { resource_type: f.resourceType || null, resource_id: f.resourceId || null, actor: f.actor || null, action: f.action || null, since: f.since ? f.since.toISOString() : null, until: f.until ? f.until.toISOString() : null, limit: f.limit },
      retention_days: activity.RETENTION_DAYS,
      count: pg.items.length, has_more: pg.has_more, next_cursor: pg.next_cursor,
      activity: pg.items,
    })
  }))

  // ── Bot pricing catalog (the same prices the Telegram bot charges) ──
  // One call returns every sellable product's price plus your wallet balance,
  // so a reseller can compute margins without hitting each product endpoint.
  router.get('/pricing', apiKeyAuth, h(async (req, res) => {
    const region = String(req.query.region || 'EU').toUpperCase()
    const balance = await walletBalance(req.reseller.ownerChatId)

    const mapPlans = (prov, isRDP) => (prov.listProducts(region, isRDP) || []).map(p => ({
      plan_id: p.productId, name: p.name || p.productId,
      vcpus: p.vcpus || p.vCpus || p.cpuCores || null, ram_gb: p.ramGb || null, disk_gb: p.diskGb || null,
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
    // Nameserver selection (validated BEFORE any price lookup / charge):
    //   default "branded" → ns1/ns2.hosta.sh (registered on CF names, auto-switched after activation)
    //   "cloudflare" → CF-assigned names | "registrar" → registrar default | nameservers[] → custom
    const nsSel = brandedNs.resolveNsChoice({ ns_choice: req.body?.ns_choice, nameservers: req.body?.nameservers })
    if (!nsSel.ok) return res.status(400).json({ error: nsSel.code || 'invalid_nameservers', message: nsSel.error })
    const customNS = nsSel.customNS
    const nsChoice = nsSel.registerChoice

    const priceInfo = await domainService.checkDomainPrice(domain, getDb())
    if (!priceInfo.available) return res.status(409).json({ error: 'domain_unavailable', message: priceInfo.message || 'That domain is not available.' })
    const registrar = priceInfo.registrar || 'ConnectReseller'

    return billedProvision(req, res, {
      product: 'domain', action: 'register', priceUsd: Number(priceInfo.price),
      request: { domain, registrar, ns_choice: nsSel.mode, nameservers: customNS || (nsSel.mode === 'branded' ? brandedNs.brandedNameservers() : null) },
      provision: async () => {
        const r = await domainService.registerDomain(domain, registrar, nsChoice, getDb(), req.reseller.ownerChatId, customNS)
        if (r && r.success === false) return { success: false, error: r.error || r.message }
        if (r && r.error && !r.success) return { success: false, error: r.error }
        // ISSUE-9 FIX (2026-10): also write the BOT's ownership map so the domain
        // shows up in Telegram "📂 My Domain Names" for the key owner. The bot reads
        // domainsOf as a per-chatId doc keyed by _id=chatId with each owned domain as a
        // (dot→@ sanitised) boolean field (see _index.js getPurchasedDomains). registerDomain
        // only wrote the {domainName,chatId} doc (for GET /domains) + registeredDomains — not
        // this map — so API-registered domains were invisible in the bot. Best-effort.
        try {
          const owner = String(req.reseller.ownerChatId)
          const domainKey = domain.replace(/\./g, '@')
          await col('domainsOf').updateOne({ _id: owner }, { $set: { [domainKey]: true } }, { upsert: true })
        } catch (e) { log(`[ResellerAPI] domains/register ownership-map warn: ${e.message}`) }
        // Branded nameservers: domain was registered on the CF-assigned names (required for
        // Cloudflare activation); queue the automatic switch to ns1/ns2.hosta.sh.
        if (nsSel.mode === 'branded') {
          try {
            await brandedNs.enqueue(getDb(), { domain, ownerChatId: req.reseller.ownerChatId, source: 'domains/register', registrar: r?.registrar || registrar, cfZoneId: r?.cfZoneId || null, cfNameservers: r?.nameservers || [] })
          } catch (e) {
            log(`[ResellerAPI] branded-ns enqueue failed for ${domain}: ${e.message}`)
            try { await notifyAdmin(`⚠️ <b>Branded NS</b> enqueue failed for <code>${domain}</code> (stays on Cloudflare names): ${e.message}`) } catch (_) { /* best-effort */ }
          }
          const view = brandedNs.displayFromDoc({ status: 'activating', brandedNs: brandedNs.brandedNameservers(), cfNameservers: r?.nameservers || [] })
          return { success: true, domain, registrar: r?.registrar || registrar, ...view, detail: r || null }
        }
        return { success: true, domain, registrar: r?.registrar || registrar, nameserver_mode: nsSel.mode, nameservers: r?.nameservers || customNS || [], detail: r || null }
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
    const regMap = {}
    if (names.length) {
      try {
        const regs = await col('registeredDomains').find({ _id: { $in: names } }).toArray()
        for (const rd of regs) {
          const v = rd.val || {}
          const ns = v.cfNameservers || v.nameservers || rd.nameservers || []
          if (Array.isArray(ns) && ns.length) nsMap[String(rd._id).toLowerCase()] = ns
          if (v.registrar || v.provider) regMap[String(rd._id).toLowerCase()] = v.registrar || v.provider
        }
      } catch (_) { /* best-effort enrichment */ }
    }
    const brandedView = await brandedNs.displayMap(getDb(), names)
    res.json({ domains: docs.map(d => {
      const rawExp = d.expiresAt || d.expiryDate || d.renewalDate || d.expiry || (d.val && (d.val.expiresAt || d.val.expiryDate)) || null
      const exp = rawExp ? new Date(rawExp) : null
      const localNs = d.nameservers || (d.val && (d.val.cfNameservers || d.val.nameservers)) || []
      const nameservers = (Array.isArray(localNs) && localNs.length) ? localNs : (nsMap[String(d.domainName || '').toLowerCase()] || [])
      const bv = brandedView[String(d.domainName || '').toLowerCase()] || null
      const ar = domainAutoRenew.view(d, d.registrar || regMap[String(d.domainName || '').toLowerCase()] || null)
      return {
        domain: d.domainName,
        registrar: ar.registrar,
        nameserver_type: d.nameserverType || null,
        nameservers: bv ? bv.nameservers : nameservers,
        ...(bv ? { nameserver_mode: bv.nameserver_mode, nameserver_status: bv.nameserver_status, current_nameservers: bv.current_nameservers } : {}),
        registered_at: d.registeredAt || null,
        expires_at: (exp && !isNaN(exp)) ? exp.toISOString() : null,
        auto_renew: ar.auto_renew,
        auto_renew_supported: ar.auto_renew_supported,
        renewal_price_usd: ar.renewal_price_usd,
        next_charge_at: ar.next_charge_at,
        auto_renew_last_error: ar.auto_renew_last_error,
        auto_renew_next_attempt_at: ar.auto_renew_next_attempt_at,
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
    const { type, name, value, priority, ttl, proxied } = req.body || {}
    if (!type || value == null) return res.status(400).json({ error: 'invalid_record', message: 'Body must include { type, name, value }.' })
    // Honor an explicit proxied flag (default stays proxied for A/AAAA/CNAME on
    // Cloudflare zones). Pass it through `opts` (8th arg) — NOT extraData — so
    // addDNSRecord's `opts.proxied !== false` check sees it. A shortener/origin
    // A-record that must resolve directly to the origin IP should be created
    // with proxied:false; a Cloudflare-fronted host should stay proxied:true.
    const opts = {}
    if (proxied !== undefined) opts.proxied = (proxied === true || proxied === 'true')
    const extraData = (ttl !== undefined && ttl !== null) ? { ttl } : undefined
    const r = await domainService.addDNSRecord(domain, String(type).toUpperCase(), value, name || '@', getDb(), priority, extraData, Object.keys(opts).length ? opts : undefined)
    if (r && r.success === false) return res.status(502).json({ error: 'dns_add_failed', message: r.error || r.message })
    res.json({ domain, added: { type, name: name || '@', value, priority: priority || null, ttl: ttl || null, proxied: (proxied !== undefined ? opts.proxied : null) }, detail: r || null })
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

  // Current delegation for a domain on this account (incl. branded-nameserver status).
  router.get('/dns/:domain/nameservers', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const owner = String(req.reseller.ownerChatId)
    const [own, acct, bdoc] = await Promise.all([
      col('domainsOf').findOne({ domainName: domain, chatId: owner }),
      col('cpanelAccounts').findOne({ domain, chatId: owner, deleted: { $ne: true } }),
      brandedNs.getDoc(getDb(), domain),
    ])
    if (!own && !acct && !(bdoc && String(bdoc.ownerChatId) === owner)) {
      return res.status(404).json({ error: 'domain_not_found', message: 'That domain is not on this account.' })
    }
    const rd = await col('registeredDomains').findOne({ _id: domain })
    const v = rd?.val || {}
    const stored = (own?.nameservers && own.nameservers.length) ? own.nameservers : (v.nameservers || v.cfNameservers || [])
    const nsType = own?.nameserverType || v.nameserverType || null
    const bv = brandedNs.displayFromDoc(bdoc)
    if (bv) return res.json({ domain, nameserver_type: nsType, ...bv })
    const mode = brandedNs.isBrandedSet(stored) ? 'branded'
      : nsType === 'cloudflare' ? 'cloudflare'
        : nsType === 'custom' ? 'custom'
          : (nsType === 'provider_default' || nsType === 'registrar') ? 'registrar' : (nsType || null)
    res.json({ domain, nameserver_type: nsType, nameserver_mode: mode, nameservers: stored, current_nameservers: stored })
  }))

  router.put('/dns/:domain/nameservers', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const v = brandedNs.validateNameservers(req.body?.nameservers)
    if (!v.ok) return res.status(400).json({ error: 'invalid_nameservers', message: `${v.error} Body: { "nameservers": ["ns1...","ns2..."] }` })
    const ns = v.nameservers
    const owner = String(req.reseller.ownerChatId)

    if (brandedNs.isBrandedSet(ns) && !brandedNs.isEnabled()) {
      // Branded nameservers are switched off → fall back to the Cloudflare-assigned names.
      const zone = await require('./cf-service').getZoneByName(domain)
      const r = zone?.name_servers?.length
        ? await domainService.updateAllNameservers(domain, zone.name_servers, getDb())
        : await domainService.switchToCloudflare(domain, getDb())
      if (r && (r.success === false || r.error)) return res.status(502).json({ error: 'ns_update_failed', message: r.error || r.message })
      await brandedNs.cancel(getDb(), domain, 'branded_ns_disabled').catch(() => {})
      const cfNs = zone?.name_servers?.length ? zone.name_servers : (r?.nameservers || [])
      return res.json({ domain, updated: true, nameserver_mode: 'cloudflare', nameservers: cfNs, current_nameservers: cfNs, detail: r || null })
    }

    // Branded set (ns1/ns2.hosta.sh): only valid while the domain's DNS is on our Cloudflare
    // account. If the zone is not ACTIVE yet, keep the registrar on the CF-assigned names and
    // queue the automatic switch (a pending zone would expose the origin IP).
    if (brandedNs.isBrandedSet(ns)) {
      const cfSvc = require('./cf-service')
      const zone = await cfSvc.getZoneByName(domain)
      if (!zone) return res.status(409).json({ error: 'branded_requires_cloudflare', message: 'Branded nameservers need the domain\'s DNS on Cloudflare. Set the Cloudflare nameservers first (or register with ns_choice "branded").' })
      const cfNs = zone.name_servers || []
      if (zone.status !== 'active') {
        const r0 = await domainService.updateAllNameservers(domain, cfNs, getDb())
        if (r0 && (r0.success === false || r0.error)) return res.status(502).json({ error: 'ns_update_failed', message: r0.error || r0.message })
        await brandedNs.enqueue(getDb(), { domain, ownerChatId: owner, source: 'dns/nameservers', cfZoneId: zone.id, cfNameservers: cfNs })
        return res.json({ domain, updated: true, ...brandedNs.displayFromDoc({ status: 'activating', brandedNs: ns, cfNameservers: cfNs }) })
      }
      const r = await domainService.updateAllNameservers(domain, ns, getDb())
      if (r && (r.success === false || r.error)) return res.status(502).json({ error: 'ns_update_failed', message: r.error || r.message })
      // Start per-domain protection monitoring (worker sees the branded set and moves to 'branded').
      await brandedNs.enqueue(getDb(), { domain, ownerChatId: owner, source: 'dns/nameservers', cfZoneId: zone.id, cfNameservers: cfNs })
      return res.json({ domain, updated: true, nameserver_mode: 'branded', nameserver_status: 'branded', nameservers: ns, current_nameservers: ns, detail: r || null })
    }

    const r = await domainService.updateAllNameservers(domain, ns, getDb())
    if (r && (r.success === false || r.error)) return res.status(502).json({ error: 'ns_update_failed', message: r.error || r.message })
    // Owner chose other nameservers → stop branded management (never fight the owner).
    await brandedNs.cancel(getDb(), domain, 'owner_set_nameservers').catch(() => {})
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
    const storage = String(req.query.storage || '').toLowerCase()
    if (storage && !['nvme', 'ssd'].includes(storage)) return res.status(400).json({ error: 'invalid_storage', message: 'storage must be "nvme" or "ssd" (omit for both).' })
    const prov = providerFor(isRDP)
    const products = prov.listProducts(region, isRDP) || []
    const plans = products.map(p => ({
      plan_id: p.productId, name: p.name || p.productId,
      vcpus: p.vcpus || p.vCpus || p.cpuCores || null, ram_gb: p.ramGb || null, disk_gb: p.diskGb || null,
      ...hwFromProduct(p),
      duration_months: p.durationMonths || 1, discount_pct: (p.pricing && p.pricing.discountPct) || 0,
      price_usd: p.pricing ? p.pricing.totalWithMarkup : null,
    }))
    const out = {
      product: isRDP ? 'rdp' : 'vps',
      provider: prov.PROVIDER || (isRDP ? process.env.VPS_RDP_PROVIDER : process.env.VPS_DEFAULT_PROVIDER),
      region,
      plans: storage ? plans.filter(p => (p.storage_type === 'NVMe SSD') === (storage === 'nvme')) : plans,
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
    if (typeof prov.isProductAvailable === 'function' && !prov.isProductAvailable(planId, region)) {
      return res.status(409).json({ error: 'out_of_stock', message: `Plan ${planId} is temporarily out of stock in region ${region}. Call GET plans for what can be ordered right now.` })
    }
    // RDP: optional Windows edition (ws2019 | ws2022 | ws2025) when the provider exposes OS options.
    let osId = null
    if (isRDP && prov.OS_OPTIONS) {
      osId = String(req.body?.os || prov.DEFAULT_OS_ID || '').toLowerCase()
      if (!prov.OS_OPTIONS[osId]) return res.status(400).json({ error: 'invalid_os', message: `Unknown os "${req.body?.os}". Valid values: ${Object.keys(prov.OS_OPTIONS).join(', ')} (see os_options in GET /rdp/plans).` })
    }

    // ── Async create: return a fast 202 with a stable id; the real provider build runs in the
    // background (runVpsJob), auto-refunds + emits *.provision_failed on failure. client_ref dedupes.
    const owner = String(req.reseller.ownerChatId)
    const clientRef = req.body?.client_ref ? String(req.body.client_ref).slice(0, 128) : null
    if (clientRef) {
      const prior = await findJobByClientRef(owner, clientRef)
      if (prior && (prior.product === 'vps' || prior.product === 'rdp')) return res.status(202).json({ ...jobHandle(prior), idempotent: true })
    }
    const planName = product.name || planId
    const request = { plan_id: planId, plan: planName, region, hostname, isRDP: !!isRDP, osId: osId || null, os: isRDP ? (osId || 'windows') : (req.body?.os || 'ubuntu') }

    // Optional: launch a Linux VPS with reseller-supplied SSH public key(s) pre-installed
    // (uploaded to the provider account; referenced as ssh_keys at droplet create).
    if (!isRDP) {
      const rawKeys = req.body?.ssh_keys || req.body?.ssh_key || null
      const keyList = (Array.isArray(rawKeys) ? rawKeys : (rawKeys ? [rawKeys] : [])).map(k => String(k).trim()).filter(Boolean)
      if (keyList.length) {
        if (typeof prov.createSecret !== 'function') return res.status(400).json({ error: 'ssh_keys_unsupported', message: 'This provider cannot register SSH keys.' })
        const ids = []
        for (const pub of keyList) {
          if (!/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-)/.test(pub)) return res.status(400).json({ error: 'invalid_ssh_key', message: 'Each ssh_keys entry must be an OpenSSH public key (e.g. "ssh-ed25519 AAAA...").' })
          try { const s = await prov.createSecret(`reseller-${owner}-${Date.now().toString(36)}`, pub, 'ssh'); if (s && (s.secretId || s.id)) ids.push(s.secretId || s.id) }
          catch (e) { return res.status(400).json({ error: 'invalid_ssh_key', message: `Could not register SSH key: ${e.message}` }) }
        }
        if (ids.length) request.ssh_key_ids = ids
      }
    }

    const charge = await chargeForAsync(req, res, { product: isRDP ? 'rdp' : 'vps', action: 'create', priceUsd: pricing.totalWithMarkup, request })
    if (!charge.ok) return // chargeForAsync already sent the 402/400

    const vpsId = crypto.randomUUID()
    const jobId = crypto.randomUUID()
    const jobDoc = {
      _id: jobId, product: isRDP ? 'rdp' : 'vps', ownerChatId: owner, clientRef,
      vpsId, priceUsd: charge.price, charged: charge.charged, mode: mode(),
      status: 'pending', attempts: 0, createdAt: new Date(), etaSeconds: estimateEtaSeconds(isRDP ? 'rdp' : 'vps', request), request,
    }
    await provisionJobs().insertOne(jobDoc)
    // Placeholder record so GET /vps|/rdp + GET /:id report status:'provisioning' immediately.
    await col('vpsPlansOf').insertOne({
      _id: vpsId, chatId: owner, vpsId,
      provider: prov.PROVIDER, instanceId: null, host: null,
      region, productId: planId, plan: planName, planPrice: pricing.totalWithMarkup,
      osType: isRDP ? 'windows' : 'linux', osId: osId || null, isRDP: !!isRDP,
      status: 'provisioning', provisionState: 'provisioning', provisionJobId: jobId, clientRef,
      source: 'reseller_api', start_time: new Date(), timestamp: new Date(),
    })
    await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product: isRDP ? 'rdp' : 'vps', action: 'create', request, priceUsd: charge.price, mode: mode(), status: 'provisioning', jobId })

    processJob(jobId).catch(() => {}) // kick the build now; worker tick is the straggler safety-net

    return res.status(202).json({
      ...jobHandle(jobDoc),
      wallet_balance_usd: Math.round((charge.balance - (charge.charged ? charge.price : 0)) * 100) / 100,
      note: `Provisioning started. Poll GET /jobs/${jobId} for live progress + ETA, or GET /${isRDP ? 'rdp' : 'vps'}/{id} until status="RUNNING", or subscribe to the ${isRDP ? 'rdp' : 'vps'}.provisioned / ${isRDP ? 'rdp' : 'vps'}.provision_failed webhooks. Reuse client_ref to make retries idempotent.`,
    })
  }

  async function vpsListHandler(req, res, isRDP) {
    const docs = await col('vpsPlansOf').find({ chatId: String(req.reseller.ownerChatId), isRDP: !!isRDP }).limit(500).toArray()
    res.json({ [isRDP ? 'rdp' : 'vps']: docs.map(d => ({
      id: d.vpsId || d._id, instance_id: d.instanceId || d.contaboInstanceId || null, ip: d.host || null,
      plan: d.plan || null, region: d.region || null, os: d.osType || null, os_id: d.osId || null, status: d.status || null,
      provision_state: d.provisionState || null,
      ...(d.provisionState === 'failed' ? { provision_failed_reason: d.provisionFailedReason || 'provision_failed' } : {}),
      ...hwFromRecord(isRDP ? rdpProviderForRecord(d) : providerFor(false), d),
      ...vpsRenewability(d, isRDP, isRDP ? rdpProviderForRecord(d) : null),
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
    out.provision_state = rec.provisionState || null
    if (rec.provisionState === 'failed') out.provision_failed_reason = rec.provisionFailedReason || 'provision_failed'
    // While our async job is still building (no provider block yet), surface the job ETA/progress so a
    // storefront can show a countdown. Once the provider reports its own `provisioning` block (RDP), that
    // richer, stage-accurate data below takes precedence.
    if (rec.provisionState === 'provisioning' && rec.provisionJobId) {
      const job = await provisionJobs().findOne({ _id: rec.provisionJobId })
      if (job) {
        const prog = jobProgress(job)
        out.job_id = rec.provisionJobId
        out.job_status_url = `/jobs/${rec.provisionJobId}`
        out.progress = prog.progress; out.stage = prog.stage; out.stage_label = prog.stage_label
        out.eta_seconds = prog.eta_seconds; out.eta_at = prog.eta_at; out.elapsed_seconds = prog.elapsed_seconds
      }
    }
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
    // Renewability so a storefront can disable a dead "Renew" button without a charge→409 round-trip.
    const _prov = isRDP ? rdpProviderForRecord(rec) : (() => { try { return vpsProvider.getProviderForRecord(rec) } catch (_) { return null } })()
    const rn = vpsRenewability({ ...rec, status: out.status }, isRDP, _prov)
    out.renewable = rn.renewable
    out.renew_blocked_reason = rn.renew_blocked_reason
    out.plan_change = doPlanChange.publicView(rec.planChange)
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
    let providerRemoved = true
    if (rec.instanceId && typeof prov.cancelInstance === 'function') { try { await prov.cancelInstance(rec.instanceId) } catch (e) { providerRemoved = false; log(`[ResellerAPI] cancelInstance warn for ${rec._id}: ${e.message}`) } }
    // Mark a TERMINAL state the lifecycle scheduler will never re-touch: 'destroyed' is excluded
    // by the RDP-grace query and is neither RUNNING (Phase 1) nor PENDING_CANCELLATION (Phase 2),
    // so no phase matches it. Crucially, do NOT rewrite end_time to now — an "expired" end_time on
    // the shared prod DB let the production auto-renew scheduler flip a just-deleted box back to
    // PENDING_CANCELLATION. Keep the original end_time and flag the record deleted.
    await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { status: 'destroyed', deleted: true, _autoRenewAttempted: true, autoRenew: false, cancelledAt: new Date() } })
    res.json({ mode: 'live', id: rec.vpsId || rec._id, destroyed: true, provider_removed: providerRemoved })
  }

  async function vpsCredsHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    let password = null
    if (isLive() && rec.rootPasswordSecretId) { try { const prov = providerFor(isRDP); password = await prov.getSecretPassword(rec.rootPasswordSecretId) } catch (e) { log(`[ResellerAPI] getSecretPassword warn: ${e.message}`) } }
    // RDP orders are created with ip=null; resolve the live IP once provisioning assigned one.
    let ip = rec.host || null
    if (!ip && rec.instanceId) { try { ip = (await providerFor(isRDP).getInstance(rec.instanceId))?.mainIp || null; if (ip) await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { host: ip } }) } catch (_) {} }
    // VPS fallback: if no stored secret resolved, run the full reveal chain
    // (durable store -> provider cache -> cloud-init-over-SSH) so legacy VPS still
    // surface a password. (RDP uses its own agent-backed secret, already handled above.)
    if (!password && !isRDP && isLive() && ip) {
      try {
        const { revealVpsPassword } = require('./vps-password-reveal')
        const rev = await revealVpsPassword({ provider: rec.provider || 'digitalocean', vpsId: rec.instanceId || rec.vpsId, host: ip, defaultUser: 'root', osType: rec.osType, rootPasswordSecretId: rec.rootPasswordSecretId || null }, { verify: false })
        if (rev && rev.status === 'ok' && rev.password) password = rev.password
      } catch (e) { log(`[ResellerAPI] vps reveal warn: ${e.message}`) }
    }
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

  // POST /vps/:id/renew and /rdp/:id/renew {months} → extend the paid period, power the box back
  // on if it was expired/in grace, and CLEAR the grace/cancel state so neither the bot scheduler
  // nor the VPS/RDP-service safety-net sweep counts it down for deletion. Billed to the API key's
  // wallet (mirrors GET /vps|/rdp/plans pricing). Shared handler, isRDP selects the provider.
  async function vpsRenewHandler(req, res, isRDP) {
    const label = isRDP ? 'RDP' : 'VPS'
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const destroyedByGrace = rec.cancelReason === 'expired_grace' || rec.destroy_reason === 'expired_grace'
    if (destroyedByGrace || ['destroyed', 'DESTROYED', 'CANCELLED', 'DELETED'].includes(String(rec.status))) {
      return res.status(409).json({ error: 'already_destroyed', renew_blocked_reason: 'already_destroyed', message: `This ${label} was permanently deleted (grace period ended) and cannot be renewed. Order a new one.` })
    }
    const prov = isRDP ? rdpProviderForRecord(rec) : vpsProvider.getProviderForRecord(rec)
    const months = Math.min(isRDP ? 3 : 12, Math.max(1, parseInt(req.body?.months, 10) || 1))
    // Pricing differs by product model:
    //   RDP → month-bundled products (1m/2m/3m) with term discounts (getProduct('slug-Nm')).
    //   VPS → single-term (monthly) product; renew = stored monthly price × months, mirroring the
    //         bot's VPS auto-renew which charges record.planPrice for the plan's native duration.
    let priceUsd = null
    let planName = rec.plan
    if (isRDP) {
      const slug = String(rec.productId || '').replace(/-\d+m$/i, '')
      const product = (slug && typeof prov.getProduct === 'function') ? prov.getProduct(`${slug}-${months}m`) : null
      if (!product || !product.pricing) {
        return res.status(400).json({ error: 'pricing_failed', renew_blocked_reason: 'pricing_unavailable', message: `Could not determine a renewal price for this RDP plan${months > 1 ? ` at ${months} month(s)` : ''}. Contact support.` })
      }
      priceUsd = product.pricing.totalWithMarkup
      planName = rec.plan || product.name
    } else {
      let unit = Number(rec.planPrice)
      if (!unit && typeof prov.getProduct === 'function') { const p = prov.getProduct(rec.productId); if (p && p.pricing) { unit = p.pricing.totalWithMarkup; planName = rec.plan || p.name } }
      if (!unit) return res.status(400).json({ error: 'pricing_failed', renew_blocked_reason: 'pricing_unavailable', message: 'Could not determine a renewal price for this VPS. Contact support.' })
      priceUsd = +(unit * months).toFixed(2)
    }
    const canProviderRenew = !!rec.instanceId && typeof prov.renewInstance === 'function'
    // RDP must power the box back on + cancel its pending deletion via the provider. VPS on PAYG
    // providers (DigitalOcean/Vultr/Azure) has no provider "renew" op — the box keeps running and
    // renewal is just the wallet charge + expiry extension (mirrors the bot's _syncProviderRenewal).
    if (isRDP && !canProviderRenew) return res.status(501).json({ error: 'not_supported', renew_blocked_reason: 'not_supported', message: 'This RDP cannot be renewed automatically. Contact support.' })

    // No-charge pre-flight: {"dry_run":true} returns price + renewability WITHOUT any charge or
    // write (works on a LIVE key too). Blocked items 409/400/501 above before we ever reach this.
    if (req.body?.dry_run === true) {
      const balance = await walletBalance(req.reseller.ownerChatId)
      return res.json({
        dry_run: true, product: isRDP ? 'rdp' : 'vps', action: 'renew',
        id: rec.vpsId || rec._id, renewable: true, renew_blocked_reason: null,
        months, plan: planName, price_usd: priceUsd,
        wallet_balance_usd: balance, sufficient_balance: balance >= priceUsd,
        note: 'Pre-flight only: nothing was charged and no state changed. Re-send without dry_run to renew.',
      })
    }

    return billedProvision(req, res, {
      product: isRDP ? 'rdp' : 'vps', action: 'renew', priceUsd,
      request: { id: rec.vpsId || rec._id, months, plan: planName },
      provision: async () => {
        const r = canProviderRenew ? await prov.renewInstance(rec.instanceId, months) : null
        const base = (rec.end_time && new Date(rec.end_time) > new Date()) ? new Date(rec.end_time) : new Date()
        const newExpiry = r?.expires_at ? new Date(r.expires_at) : new Date(base.getTime() + 30 * months * 86400000)
        // Mirror onto vpsPlansOf: back to good standing + clear every grace/cancel field so
        // neither the bot scheduler nor the VPS/RDP-service sweep destroys the box.
        await col('vpsPlansOf').updateOne({ _id: rec._id }, {
          $set: { status: 'RUNNING', end_time: newExpiry, renewed_at: new Date() },
          $unset: { expired_at: '', grace_until: '', _graceReminderSent: '', cancelReason: '', cancelledAt: '', deleteRetryCount: '', lastDeleteError: '', lastDeleteAlertAt: '' },
        })
        return { success: true, id: rec.vpsId || rec._id, months, plan: planName, expires_at: newExpiry.toISOString() }
      },
    })
  }

  // ── VPS-only lifecycle: in-place password reset + SSH key management ──
  // Mirrors the RDP handlers but for Linux VPS. The provider's resetPassword /
  // applyBackfillOverSSH log in to the RUNNING droplet over SSH (no wipe) and
  // require the box reachable with a known credential (stored key / recoverable
  // password). A box created without any credential returns a clear 409.

  // POST /vps/:id/password-reset → in-place root password change over SSH.
  async function vpsPasswordResetHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, false)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, username: 'root', method: 'ssh', note: 'Dry-run: no password reset sent to provider.' })
    const prov = vpsProvider.getProviderForRecord(rec)
    if (!rec.instanceId || !prov || typeof prov.resetPassword !== 'function') return res.status(501).json({ error: 'not_supported' })
    try {
      const r = await prov.resetPassword(rec.instanceId, { host: rec.host || null, currentSecretId: rec.rootPasswordSecretId || null, defaultUser: 'root', osType: rec.osType })
      if (r && r.secretId && r.secretId !== rec.rootPasswordSecretId) {
        await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: { rootPasswordSecretId: r.secretId } })
      }
      if (r && r.password) return res.json({ mode: 'live', id: rec.vpsId || rec._id, username: 'root', password: r.password, verified: !!r.verified, data_preserved: true, note: r.note || null })
      // Could not set it in place (locked out / ssh-blocked / provider-emailed) — surface guidance.
      return res.status(409).json({ error: 'password_not_set_in_place', id: rec.vpsId || rec._id, username: 'root', password: null, note: (r && r.note) || 'Could not set the password in place; the server may be unreachable or was created without a credential.' })
    } catch (e) {
      res.status(409).json({ error: 'password_reset_failed', message: e.message })
    }
  }

  // POST /vps/:id/ssh-key { public_key } → append an OpenSSH public key to the
  // running droplet's root authorized_keys (idempotent, in place, no wipe).
  async function vpsSetSshKeyHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, false)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const publicKey = String(req.body?.public_key || req.body?.ssh_key || '').trim()
    if (!publicKey || !/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-)/.test(publicKey)) {
      return res.status(400).json({ error: 'invalid_public_key', message: 'Provide an OpenSSH public key string in { public_key } (e.g. "ssh-ed25519 AAAA... user@host").' })
    }
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, installed: false, note: 'Dry-run: no SSH key injected.' })
    if (!rec.host) return res.status(409).json({ error: 'no_host', message: 'VPS has no IP yet — try again once provisioning completes.' })
    let currentPassword = null
    if (rec.rootPasswordSecretId) { try { const prov = vpsProvider.getProviderForRecord(rec); if (prov && typeof prov.getSecretPassword === 'function') currentPassword = await prov.getSecretPassword(rec.rootPasswordSecretId) } catch (_) {} }
    try {
      const { applyBackfillOverSSH } = require('./vps-ssh-password')
      const r = await applyBackfillOverSSH({ host: rec.host, username: 'root', publicKey, privateKeys: [], currentPassword })
      if (!r || !r.ok) return res.status(409).json({ error: 'ssh_key_apply_failed', message: (r && r.error) || 'could not reach the server with a known credential', attempts: (r && r.attempts) || [] })
      return res.json({ mode: 'live', id: rec.vpsId || rec._id, username: 'root', installed: true, method: r.method, note: 'Public key appended to root authorized_keys (idempotent); SSH access ensured.' })
    } catch (e) {
      res.status(409).json({ error: 'ssh_key_apply_failed', message: e.message })
    }
  }

  // GET /vps/:id/ssh-keys → best-effort read of the droplet's root authorized_keys.
  async function vpsSshKeysListHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, false)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, keys: [], note: 'Dry-run: not read from the server.' })
    if (!rec.host) return res.status(409).json({ error: 'no_host', message: 'VPS has no IP yet.' })
    let currentPassword = null
    if (rec.rootPasswordSecretId) { try { const prov = vpsProvider.getProviderForRecord(rec); if (prov && typeof prov.getSecretPassword === 'function') currentPassword = await prov.getSecretPassword(rec.rootPasswordSecretId) } catch (_) {} }
    try {
      const { execOverSSH } = require('./vps-ssh-password')
      const r = await execOverSSH({ host: rec.host, port: 22, username: 'root', script: 'cat /root/.ssh/authorized_keys 2>/dev/null || true', password: currentPassword || null })
      const keys = String(r.stdout || '').split('\n').map(s => s.trim()).filter(l => /^(ssh-|ecdsa-)/.test(l))
      return res.json({ mode: 'live', id: rec.vpsId || rec._id, username: 'root', keys, count: keys.length })
    } catch (e) {
      return res.status(409).json({ error: 'ssh_keys_read_failed', message: e.message, note: 'Could not read authorized_keys — the server may be unreachable or has no known credential.' })
    }
  }

  // POST /vps/:id/reinstall { os?, confirm } → DESTRUCTIVE OS reinstall (DO rebuild from a
  // chosen image: disk wiped, IP kept, ~3 min). DO's rebuild re-runs the droplet's ORIGINAL
  // create-time cloud-init, so a VPS created via POST /vps (which set a stored root password at
  // create) comes back with that SAME password — we keep rootPasswordSecretId and return it.
  // Legacy boxes with no stored secret come back with an unknown password (call password-reset).
  async function vpsReinstallHandler(req, res) {
    const rec = await loadOwnedVps(req, req.params.id, false)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const prov = vpsProvider.getProviderForRecord(rec)
    const osId = String(req.body?.os || rec.osId || 'ubuntu-24-04-x64').toLowerCase()
    let images = []
    try { if (prov && typeof prov.listImages === 'function') images = await prov.listImages('linux') } catch (_) {}
    if (images.length && !images.some(i => String(i.imageId || i.id).toLowerCase() === osId)) {
      return res.status(400).json({ error: 'invalid_os', message: `Unknown os "${req.body?.os}". Valid values: ${images.map(i => i.imageId || i.id).join(', ')}.`, valid_os: images.map(i => ({ id: i.imageId || i.id, name: i.name })) })
    }
    // Destructive — require explicit confirmation so a reinstall is never accidental.
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required', id: rec.vpsId || rec._id, os: osId, message: 'Reinstall WIPES the disk — all data is destroyed (the IP is kept). Re-send with {"confirm": true} to proceed.' })
    }
    if (!isLive()) return res.json({ mode: 'dry_run', id: rec.vpsId || rec._id, os: osId, note: 'Dry-run: no reinstall sent to provider.' })
    if (!rec.instanceId || !prov || typeof prov.reinstallInstance !== 'function') return res.status(501).json({ error: 'not_supported' })
    try {
      // Pass the EXISTING password secret so the re-run of the create-time cloud-init keeps a known
      // root password (DO rebuild ignores freshly-sent user_data but re-applies the original).
      const r = await prov.reinstallInstance(rec.instanceId, { osId, rootPassword: rec.rootPasswordSecretId || undefined })
      const set = { osId, osType: 'linux', status: 'reinstalling', provisionState: 'active' }
      if (r && r.secretId && r.secretId !== rec.rootPasswordSecretId) set.rootPasswordSecretId = r.secretId
      await col('vpsPlansOf').updateOne({ _id: rec._id }, { $set: set })
      // Resolve the password we can show (the stored secret the cloud-init re-applies).
      let password = null
      const sid = (r && r.secretId) || rec.rootPasswordSecretId || null
      if (sid && typeof prov.getSecretPassword === 'function') { try { password = await prov.getSecretPassword(sid) } catch (_) {} }
      return res.json({
        mode: 'live', id: rec.vpsId || rec._id, os: osId, ip: (r && r.ip) || rec.host || null,
        eta_minutes: (r && r.etaMinutes) || 3, username: 'root', password: password || null, data_preserved: false,
        note: password
          ? 'Reinstall started (disk wiped, IP kept). Your original root password is re-applied by cloud-init once the server finishes booting (~3 min).'
          : 'Reinstall started (disk wiped, IP kept). This box has no stored password — once it is back online, call POST /vps/:id/password-reset (or use your SSH key).',
      })
    } catch (e) {
      res.status(409).json({ error: 'reinstall_failed', message: e.message })
    }
  }

  // ── VPS/RDP plan change (DigitalOcean only): in-place resize, pro-rata upgrades, no-refund downgrades.
  // POST returns 202 while the resize runs in the background; GET /vps|rdp/:id → plan_change tracks it.
  const PLAN_CHANGE_POLICY = {
    upgrade: 'Applies immediately. Charged now: (new monthly price - current monthly price) x days left in the term / 30.',
    downgrade: 'Applies immediately. No refund or credit for the current term.',
    renewal: 'The new plan price applies from the next renewal. The term end date does not change.',
    disk: 'By default only CPU/RAM change (reversible). resize_disk:true also grows the disk to the plan size; this is permanent and blocks any later move to a plan with a smaller disk.',
    downtime: 'The server is powered off during the resize (usually 2-5 minutes, longer for large disks).',
  }
  const noSlug = ({ size_slug, ...rest }) => rest
  function planChangeError(res, e, rec) {
    if (!(e instanceof doPlanChange.PlanChangeError)) throw e
    return res.status(e.status).json({ error: e.code, message: e.message, ...(e.code === 'plan_change_in_progress' ? { plan_change: doPlanChange.publicView(rec && rec.planChange) } : {}) })
  }
  function emitPlanChange(isRDP, rec, r) {
    const c = r.change
    emitEvent(c.chat_id, `${isRDP ? 'rdp' : 'vps'}.${r.success ? 'plan_changed' : 'plan_change_failed'}`, rec.vpsId || rec._id, {
      change_id: c.id, direction: c.direction, from_plan: c.from.plan_id, to_plan: c.to.plan_id, to_plan_name: c.to.name,
      charged_usd: c.charged_usd, resize_disk: c.resize_disk,
      ...(r.success ? { disk_gb: (r.result && r.result.disk_gb) || null } : { reason: r.error || 'plan_change_failed', refunded: !!r.refunded, refund_usd: r.refund_usd || 0 }),
    }, c.id)
  }

  async function vpsPlanOptionsHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    let po
    try { po = await doPlanChange.planOptions(rec) } catch (e) { return planChangeError(res, e, rec) }
    res.json({
      id: rec.vpsId || rec._id, product: isRDP ? 'rdp' : 'vps', current: noSlug(po.current),
      term_ends_at: po.term_ends_at, remaining_days: po.remaining_days, policy: PLAN_CHANGE_POLICY,
      last_plan_change: doPlanChange.publicView(rec.planChange), options: po.options.map(noSlug),
    })
  }

  async function vpsPlanChangeHandler(req, res, isRDP) {
    const product = isRDP ? 'rdp' : 'vps'
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const id = rec.vpsId || rec._id
    const planId = String(req.body?.plan_id || '').trim()
    if (!planId) return res.status(400).json({ error: 'missing_plan_id', message: `Provide plan_id (see GET /${product}/${id}/plan-options).` })
    const rd = req.body?.resize_disk
    if (rd !== undefined && typeof rd !== 'boolean') return res.status(400).json({ error: 'invalid_resize_disk', message: 'resize_disk must be true or false.' })
    let q
    try { q = await doPlanChange.quote(rec, planId, { resizeDisk: rd === true }) } catch (e) { return planChangeError(res, e, rec) }
    const owner = req.reseller.ownerChatId
    const charge = q.option.charge_now_usd
    const balance = await walletBalance(owner)
    const quoteView = { ...noSlug(q.option), from: noSlug(q.ctx.current), remaining_days: Math.round(q.ctx.remainingDays * 100) / 100, term_ends_at: q.ctx.end.toISOString() }
    const request = { id, from_plan: q.ctx.current.plan_id, to_plan: planId, direction: q.option.direction, resize_disk: q.option.resize_disk, charge_usd: charge }
    if (req.body?.dry_run === true) {
      return res.json({ dry_run: true, product, action: 'plan_change', id, quote: quoteView, wallet_balance_usd: balance, sufficient_balance: balance >= charge, note: 'Pre-flight only: nothing was charged and the server was not touched. Re-send without dry_run to change the plan.' })
    }
    if (balance < charge) {
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product, action: 'plan_change', request, priceUsd: charge, mode: mode(), status: 'rejected_insufficient_balance' })
      return res.status(402).json({ error: 'insufficient_wallet_balance', message: `Wallet balance $${balance.toFixed(2)} is below the pro-rata charge $${charge.toFixed(2)}. Top up your wallet and retry.`, price_usd: charge, wallet_balance_usd: balance, shortfall_usd: Math.round((charge - balance) * 100) / 100, mode: mode() })
    }
    if (!isLive()) {
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product, action: 'plan_change', request, priceUsd: charge, mode: 'dry_run', status: 'simulated' })
      return res.json({ mode: 'dry_run', product, action: 'plan_change', id, quote: quoteView, wallet_balance_usd: balance, note: 'Dry-run: balance is sufficient; the server was not resized and no funds were charged.' })
    }
    let started
    try {
      started = await doPlanChange.start({
        vpsPlansOf: col('vpsPlansOf'), walletOf: col('walletOf'), rec, planId, resizeDisk: rd === true, via: 'api', log,
        onDone: async (r) => {
          emitPlanChange(isRDP, rec, r)
          await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product, action: 'plan_change', request: { ...request, change_id: r.change.id }, priceUsd: r.change.charged_usd, mode: 'live', status: r.success ? 'plan_changed' : 'failed', ...(r.success ? {} : { error: r.error, refunded: !!r.refunded }) })
          if (!r.success) await notifyAdmin(`❌ <b>Reseller API ${product} plan change FAILED</b>\nKey: ${req.reseller.label || req.reseller.keyId}\n${id}: ${r.change.from.plan_id} → ${r.change.to.plan_id}\n${r.refunded ? `Refunded $${r.refund_usd.toFixed(2)}` : 'No charge'}\nError: ${r.error}`).catch(() => {})
        },
      })
    } catch (e) { return planChangeError(res, e, rec) }
    await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product, action: 'plan_change', request: { ...request, change_id: started.change.id }, priceUsd: started.change.charged_usd, mode: 'live', status: 'running' })
    return res.status(202).json({
      mode: 'live', product, action: 'plan_change', id, status: 'running',
      plan_change: doPlanChange.publicView(started.change), quote: quoteView,
      charged_usd: started.change.charged_usd, wallet_balance_usd: await walletBalance(owner), poll_url: `/${product}/${id}`,
      note: `Resize started. Poll GET /${product}/${id} until plan_change.status is "completed" or "failed" (a failed change is refunded automatically), or subscribe to the ${product}.plan_changed / ${product}.plan_change_failed webhooks.`,
    })
  }

  // ── VPS/RDP usage (DigitalOcean only): CPU, memory, disk, load, bandwidth for a period. Read-only.
  async function vpsUsageHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    const period = String(req.query.period || '24h').toLowerCase()
    if (!doUsage.PERIODS[period]) return res.status(400).json({ error: 'invalid_period', message: `period must be one of: ${Object.keys(doUsage.PERIODS).join(', ')}.` })
    if (!doPlanChange.isDoRecord(rec)) return res.status(501).json({ error: 'not_supported', message: 'Usage metrics are available for DigitalOcean servers only.' })
    const st = String(rec.status || '').toUpperCase()
    if (rec.deleted || rec.provisionState === 'provisioning' || ['PROVISIONING', 'FAILED', 'DELETED', 'DESTROYED'].includes(st)) {
      return res.status(409).json({ error: 'not_active', message: `This server is ${String(rec.status || 'not active').toLowerCase()}; usage is available once it is running.` })
    }
    let u
    try { u = await (isRDP ? doUsage.rdpUsage(rec, period) : doUsage.vpsUsage(rec, period)) } catch (e) { return planChangeError(res, e, rec) }
    res.json({ id: rec.vpsId || rec._id, product: isRDP ? 'rdp' : 'vps', ...u })
  }

  // VPS routes
  router.get('/vps/plans', apiKeyAuth, h((req, res) => vpsPlansHandler(req, res, false)))
  router.post('/vps', apiKeyAuth, h((req, res) => vpsCreateHandler(req, res, false)))
  router.get('/vps', apiKeyAuth, h((req, res) => vpsListHandler(req, res, false)))
  router.get('/vps/:id', apiKeyAuth, h((req, res) => vpsGetHandler(req, res, false)))
  router.post('/vps/:id/action', apiKeyAuth, h((req, res) => vpsActionHandler(req, res, false)))
  router.delete('/vps/:id', apiKeyAuth, h((req, res) => vpsDestroyHandler(req, res, false)))
  router.get('/vps/:id/credentials', apiKeyAuth, h((req, res) => vpsCredsHandler(req, res, false)))
  router.post('/vps/:id/renew', apiKeyAuth, h((req, res) => vpsRenewHandler(req, res, false)))
  router.post('/vps/:id/password-reset', apiKeyAuth, h((req, res) => vpsPasswordResetHandler(req, res)))
  router.post('/vps/:id/ssh-key', apiKeyAuth, h((req, res) => vpsSetSshKeyHandler(req, res)))
  // Plural alias so POST /vps/:id/ssh-keys works too (GET on the same path lists keys).
  router.post('/vps/:id/ssh-keys', apiKeyAuth, h((req, res) => vpsSetSshKeyHandler(req, res)))
  router.get('/vps/:id/ssh-keys', apiKeyAuth, h((req, res) => vpsSshKeysListHandler(req, res)))
  router.post('/vps/:id/reinstall', apiKeyAuth, h((req, res) => vpsReinstallHandler(req, res)))
  router.get('/vps/:id/usage', apiKeyAuth, h((req, res) => vpsUsageHandler(req, res, false)))
  router.get('/vps/:id/plan-options', apiKeyAuth, h((req, res) => vpsPlanOptionsHandler(req, res, false)))
  router.post('/vps/:id/upgrade', apiKeyAuth, h((req, res) => vpsPlanChangeHandler(req, res, false)))
  router.post('/vps/:id/change-plan', apiKeyAuth, h((req, res) => vpsPlanChangeHandler(req, res, false)))

  // RDP routes (Windows)
  router.get('/rdp/plans', apiKeyAuth, h((req, res) => vpsPlansHandler(req, res, true)))
  router.post('/rdp', apiKeyAuth, h((req, res) => vpsCreateHandler(req, res, true)))
  router.get('/rdp', apiKeyAuth, h((req, res) => vpsListHandler(req, res, true)))
  router.get('/rdp/:id', apiKeyAuth, h((req, res) => vpsGetHandler(req, res, true)))
  router.post('/rdp/:id/action', apiKeyAuth, h((req, res) => vpsActionHandler(req, res, true)))
  router.post('/rdp/:id/password-reset', apiKeyAuth, h((req, res) => rdpPasswordResetHandler(req, res)))
  router.post('/rdp/:id/reinstall', apiKeyAuth, h((req, res) => rdpReinstallHandler(req, res)))
  router.post('/rdp/:id/renew', apiKeyAuth, h((req, res) => vpsRenewHandler(req, res, true)))
  router.delete('/rdp/:id', apiKeyAuth, h((req, res) => vpsDestroyHandler(req, res, true)))
  router.get('/rdp/:id/credentials', apiKeyAuth, h((req, res) => vpsCredsHandler(req, res, true)))
  router.get('/rdp/:id/usage', apiKeyAuth, h((req, res) => vpsUsageHandler(req, res, true)))
  router.get('/rdp/:id/plan-options', apiKeyAuth, h((req, res) => vpsPlanOptionsHandler(req, res, true)))
  router.post('/rdp/:id/upgrade', apiKeyAuth, h((req, res) => vpsPlanChangeHandler(req, res, true)))
  router.post('/rdp/:id/change-plan', apiKeyAuth, h((req, res) => vpsPlanChangeHandler(req, res, true)))

  // ── Plan-change HISTORY (hosting + VPS + RDP): completed, failed (refunded) and running changes,
  //    from the API and the Telegram bot (via), plus best-effort legacy entries (legacy:true). ──
  function historyQueryError(res, e) {
    if (!(e instanceof planChangeHistory.HistoryQueryError)) throw e
    return res.status(e.status).json({ error: e.code, message: e.message })
  }
  const historyPayload = (pg) => ({ count: pg.items.length, total: pg.total, has_more: pg.has_more, next_cursor: pg.next_cursor, plan_changes: pg.items })
  async function vpsPlanHistoryHandler(req, res, isRDP) {
    const rec = await loadOwnedVps(req, req.params.id, isRDP)
    if (!rec) return res.status(404).json({ error: 'not_found' })
    let f
    try { f = planChangeHistory.parseFilters({ ...req.query, product: '' }) } catch (e) { return historyQueryError(res, e) }
    const pg = planChangeHistory.page(planChangeHistory.serverEntries(rec), f)
    res.json({ product: isRDP ? 'rdp' : 'vps', id: rec.vpsId || rec._id, plan: rec.plan || null, ...historyPayload(pg) })
  }
  router.get('/vps/:id/plan-changes', apiKeyAuth, h((req, res) => vpsPlanHistoryHandler(req, res, false)))
  router.get('/rdp/:id/plan-changes', apiKeyAuth, h((req, res) => vpsPlanHistoryHandler(req, res, true)))

  router.get('/plan-changes', apiKeyAuth, h(async (req, res) => {
    let f
    try { f = planChangeHistory.parseFilters(req.query) } catch (e) { return historyQueryError(res, e) }
    const owner = String(req.reseller.ownerChatId)
    const want = (p) => !f.products || f.products.includes(p)
    const entries = []
    if (want('hosting')) {
      const accts = await col('cpanelAccounts').find(
        { chatId: owner, $or: [{ 'planChangeHistory.0': { $exists: true } }, { upgradedAt: { $exists: true } }, { downgradedAt: { $exists: true } }] },
        { projection: { _id: 1, domain: 1, plan: 1, planChangeHistory: 1, upgradedAt: 1, upgradedFrom: 1, downgradedAt: 1, downgradedFrom: 1, upgradeChargedAmount: 1, upgradeCreditApplied: 1 } },
      ).toArray()
      for (const a of accts) entries.push(...planChangeHistory.hostingEntries(a))
    }
    if (want('vps') || want('rdp')) {
      const q = { chatId: owner, $or: [{ 'planChangeHistory.0': { $exists: true } }, { 'planChange.id': { $exists: true } }] }
      if (!want('vps')) q.isRDP = true
      else if (!want('rdp')) q.isRDP = { $ne: true }
      const recs = await col('vpsPlansOf').find(q, { projection: { _id: 1, vpsId: 1, isRDP: 1, plan: 1, planChangeHistory: 1, planChange: 1 } }).toArray()
      for (const r of recs) entries.push(...planChangeHistory.serverEntries(r))
    }
    const pg = planChangeHistory.page(entries, f)
    res.json({
      filters: { product: f.products, since: f.since ? f.since.toISOString() : null, until: f.until ? f.until.toISOString() : null, status: f.status, via: f.via, limit: f.limit },
      ...historyPayload(pg),
    })
  }))

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
        // Prepaid terms (pass `months` on POST /hosting or POST /hosting/:user/renew). Weekly: none.
        terms: p.durationDays === hostingTerms.MONTH_DAYS ? hostingTerms.TERM_MONTHS.map(m => hostingTerms.termQuote(p.priceUsd, m)) : [],
      })),
      term_discounts_pct: Object.fromEntries(hostingTerms.TERM_MONTHS.map(m => [String(m), hostingTerms.discountPct(m)])),
      terms_note: 'Monthly plans can be prepaid for 1, 3, 6 or 12 months (30 days per month) at the discount shown. Pass months on POST /hosting or POST /hosting/:user/renew. Auto-renew repeats the same term at the same discount. The weekly plan is 1 week at a time.',
    })
  }))

  router.post('/hosting', apiKeyAuth, h(async (req, res) => {
    const plan = hostingPlanById(req.body?.plan_id)
    if (!plan) return res.status(400).json({ error: 'invalid_plan', message: 'Unknown plan_id. Call GET /hosting/plans.' })
    const pm = hostingTerms.parseMonths(req.body?.months, plan.durationDays)
    if (pm.error) return res.status(400).json({ error: pm.error, message: pm.message })
    const termMonths = pm.months || 1
    const hostingUsd = hostingTerms.termPrice(plan.priceUsd, termMonths)
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain.' })
    // ISSUE-7 FIX (2026-10): domain_mode no longer conflates the bot's two distinct
    // BYO paths. Accept:
    //   'buy'      → register a brand-new domain in the same call
    //   'existing' → link a domain already registered on THIS platform (already on
    //                Cloudflare — "Use Existing Domain")
    //   'external' → connect a domain held at an OUTSIDE registrar (needs an NS
    //                change at the registrar — "Connect External Domain")
    // Legacy 'byo' (the documented default) maps to 'external' — that is the
    // behaviour byo callers already received (external NS-update path), minus the
    // bug where BOTH existingDomain+connectExternalDomain were set at once.
    const dmRaw = String(req.body?.domain_mode || 'byo').toLowerCase()
    let domainMode
    if (dmRaw === 'buy') domainMode = 'buy'
    else if (dmRaw === 'existing') domainMode = 'existing'
    else if (dmRaw === 'external' || dmRaw === 'byo') domainMode = 'external'
    else return res.status(400).json({ error: 'invalid_domain_mode', message: 'domain_mode must be one of: buy, existing, external (legacy "byo" = external).' })
    // Nameservers for a NEW domain (domain_mode=buy): "branded" (default, ns1/ns2.hosta.sh — switched
    // automatically after Cloudflare activates the zone) or "cloudflare" (CF-assigned names).
    // existing/external modes keep their current delegation behaviour.
    let nsMode = null
    if (domainMode === 'buy') {
      const sel = brandedNs.resolveNsChoice({ ns_choice: req.body?.ns_choice, nameservers: req.body?.nameservers, forHosting: true })
      if (!sel.ok) return res.status(400).json({ error: sel.code || 'invalid_ns_choice', message: sel.error })
      nsMode = sel.mode
    }
    const email = req.body?.email || null
    const owner = String(req.reseller.ownerChatId)
    const clientRef = req.body?.client_ref ? String(req.body.client_ref).slice(0, 128) : null

    // Idempotency: a retry with the same (owner, client_ref) echoes the SAME provisioning handle —
    // never a second charge, never a second account.
    if (clientRef) {
      const prior = await findJobByClientRef(owner, clientRef)
      if (prior && prior.product === 'hosting') return res.status(202).json({ ...jobHandle(prior), idempotent: true })
    }

    // duplicate guard (mirrors store provisioning). A prior FAILED provision (wallet already
    // refunded) frees the domain so the reseller can immediately retry.
    const dup = await col('cpanelAccounts').findOne({ domain, deleted: { $ne: true }, provisionState: { $ne: 'failed' } })
    if (dup) return res.status(409).json({ error: 'domain_in_use', message: 'That domain already has an active hosting plan.' })

    let domainPrice = 0, registrar = null
    if (domainMode === 'buy') {
      const dp = await domainService.checkDomainPrice(domain, getDb())
      if (!dp.available) return res.status(409).json({ error: 'domain_unavailable', message: dp.message || 'Domain not available to register.' })
      domainPrice = Number(dp.price) || 0
      registrar = dp.registrar || 'ConnectReseller'
    }
    const total = Math.round((hostingUsd + domainPrice) * 100) / 100
    const request = { plan_id: plan.id, plan: plan.name, domain, domain_mode: domainMode, email, hostingPrice: plan.priceUsd, hosting_usd: hostingUsd, term_months: termMonths, term_discount_pct: hostingTerms.discountPct(termMonths), duration_days: plan.durationDays * termMonths, domain_usd: domainPrice, registrar, ...(nsMode ? { ns_choice: nsMode } : {}) }

    // Up-front wallet guard + charge (handles 402 + dry_run balance-only check; response already sent on failure).
    const charge = await chargeForAsync(req, res, { product: 'hosting', action: 'create', priceUsd: total, request })
    if (!charge.ok) return

    // cPanel username is generated NOW so the reseller gets a stable handle in the 202 (before the
    // slow WHM build). createAccount receives it as customUsername so the account lands on this name.
    const username = whmService.generateUsername(domain)
    const jobId = crypto.randomUUID()
    const jobDoc = {
      _id: jobId, product: 'hosting', ownerChatId: owner, clientRef,
      username, priceUsd: charge.price, charged: charge.charged, mode: mode(),
      status: 'pending', attempts: 0, createdAt: new Date(), etaSeconds: estimateEtaSeconds('hosting', request), request,
    }
    await provisionJobs().insertOne(jobDoc)
    // Placeholder account so GET /hosting/{username} reports state:'provisioning' immediately and the
    // domain is reserved against concurrent creates.
    await col('cpanelAccounts').updateOne({ _id: username }, { $set: {
      _id: username, chatId: owner, source: 'reseller_api', ownerEmail: email,
      domain, plan: plan.name, provisionState: 'provisioning', provisionJobId: jobId, clientRef, createdAt: new Date(),
    } }, { upsert: true })
    await recordOrder({ keyId: req.reseller.keyId, ownerChatId: owner, product: 'hosting', action: 'create', request, priceUsd: charge.price, mode: mode(), status: 'provisioning', jobId })

    processJob(jobId).catch(() => {}) // kick the build now; worker tick is the straggler safety-net

    return res.status(202).json({
      ...jobHandle(jobDoc),
      term_months: termMonths, term_discount_pct: hostingTerms.discountPct(termMonths), hosting_usd: hostingUsd, domain_usd: domainPrice,
      ...(nsMode ? { nameserver_mode: nsMode, ...(nsMode === 'branded' ? { nameservers: brandedNs.brandedNameservers() } : {}) } : {}),
      wallet_balance_usd: Math.round((charge.balance - (charge.charged ? charge.price : 0)) * 100) / 100,
      note: `Provisioning started. Poll GET /jobs/${jobId} for live progress + ETA, or GET /hosting/{username} until state="online", or subscribe to the hosting.provisioned / hosting.provision_failed webhooks. Reuse client_ref to make retries idempotent.`,
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
        const liveSusp = Object.prototype.hasOwnProperty.call(liveSuspendedByUser, d._id) ? liveSuspendedByUser[d._id] : null
        const provisioning = d.provisionState === 'provisioning'
        const provFailed = d.provisionState === 'failed'
        const lc = hostingLifecycle(d, { price: hostingScheduler.getPlanPrice(d), duration: hostingScheduler.getPlanDuration(d.plan), liveSuspended: liveSusp })
        const rc = hostingScheduler.getRenewalCharge(d)
        return {
          id: u,
          username: u,
          domain: d.domain,
          plan: d.plan || null,
          term_months: rc.months,
          renewal_price_usd: rc.priceUsd,
          suspended: (provisioning || provFailed) ? false : lc.suspended,
          state: provisioning ? 'provisioning' : (provFailed ? 'failed' : lc.state),
          grace: (provisioning || provFailed) ? null : lc.grace,
          renewable: (provisioning || provFailed) ? false : lc.renewable,
          renew_blocked_reason: provisioning ? 'provisioning' : (provFailed ? 'provision_failed' : lc.renew_blocked_reason),
          renew_available_at: (provisioning || provFailed) ? null : lc.renew_available_at,
          ...(provisioning || provFailed ? { provision_state: d.provisionState } : {}),
          ...(provFailed ? { provision_failed_reason: d.provisionFailedReason || 'provision_failed' } : {}),
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
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: true, suspendedAt: new Date(), suspendedBy: 'reseller_api', suspendedReason: req.body?.reason || 'reseller_api_manual' } })
    res.json({ mode: 'live', username: acct._id, suspended: true, detail: r || null })
  }))

  router.post('/hosting/:user/unsuspend', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: account not unsuspended.' })
    const r = await whmService.unsuspendAccount(acct._id)
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: false, suspendedReason: null, suspendedAt: null } })
    res.json({ mode: 'live', username: acct._id, suspended: false, detail: r || null })
  }))

  // ── Unified site online/offline (adds Maintenance mode on top of suspend) ──
  // GET  → current status: 'online' | 'suspended' | 'maintenance'
  // POST → { action:'take_offline'|'bring_online', mode?:'suspended'|'maintenance' }
  //   • take_offline + mode 'suspended'   → WHM suspend (blocks HTTP/FTP/mail/DB)
  //   • take_offline + mode 'maintenance' → friendly 503 maintenance page (mail/FTP stay up)
  //   • bring_online                      → auto-reverses whichever mode is active
  // ISSUE-6 FIX (2026-10): single implementation registered at BOTH the documented
  // `/hosting/:user/site-status` and the legacy `/hosting/:user/account/site-status`
  // (the mgmt-module duplicate has been removed) so the two can never drift apart.
  const siteStatusGet = h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const siteStatus = require('./site-status-service')
    res.json({
      username: acct._id,
      domain: acct.domain,
      status: siteStatus.readStatus(acct),
      plan: acct.plan || null,
      auto_renew: acct.autoRenew !== false,
      expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
      suspended_at: acct.suspendedAt ? new Date(acct.suspendedAt).toISOString() : null,
      maintenance_mode_at: acct.maintenanceModeAt ? new Date(acct.maintenanceModeAt).toISOString() : null,
      last_brought_online_at: acct.lastBroughtOnlineAt ? new Date(acct.lastBroughtOnlineAt).toISOString() : null,
    })
  })

  const siteStatusPost = h(async (req, res) => {
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
  })

  router.get('/hosting/:user/site-status', apiKeyAuth, siteStatusGet)
  router.post('/hosting/:user/site-status', apiKeyAuth, siteStatusPost)
  // Legacy alias — same handler, no duplicated logic.
  router.get('/hosting/:user/account/site-status', apiKeyAuth, siteStatusGet)
  router.post('/hosting/:user/account/site-status', apiKeyAuth, siteStatusPost)

  // ── Auto-Renew toggle (ISSUE-5 FIX, 2026-10) ──
  // The bot lets a user flip auto-renew on a hosting plan; the reseller API had no
  // equivalent. Body { enabled:true|false } sets it explicitly; omit `enabled` to
  // toggle (bot behaviour: autoRenew===false ? true : false). Free, works in any mode.
  router.post('/hosting/:user/auto-renew', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (acct.deleted) return res.status(409).json({ error: 'account_terminated', message: 'This hosting plan has been cancelled.' })
    const raw = req.body?.enabled
    let newAutoRenew
    if (typeof raw === 'boolean') newAutoRenew = raw
    else if (raw === undefined || raw === null) newAutoRenew = acct.autoRenew === false ? true : false
    else return res.status(400).json({ error: 'invalid_body', message: 'Optional body { "enabled": true|false }; omit to toggle.' })
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { autoRenew: newAutoRenew } })
    const rc = hostingScheduler.getRenewalCharge(acct)
    res.json({ username: acct._id, domain: acct.domain, auto_renew: newAutoRenew, term_months: rc.months, renewal_price_usd: rc.priceUsd, renewal_days: rc.days })
  }))

  // ── Manual hosting renew ──
  // Extend a hosting plan by its native billing period(s), charged to the API key's wallet at the
  // plan's renewal price (getPlanPrice × periods). Mirrors the bot's renew flow: verifies the WHM
  // account still exists, pushes expiry out, unsuspends if suspended and re-deploys anti-red.
  // Body { periods?: 1..12 } (default 1). Billed (dry-run on a sandbox pod).
  router.post('/hosting/:user/renew', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (acct.deleted || acct.terminatedOnWhm) return res.status(409).json({ error: 'account_terminated', renew_blocked_reason: 'account_terminated', message: 'This hosting account was terminated and cannot be renewed. Order a new plan.' })
    const { getPlanPrice, getPlanDuration } = require('./hosting-scheduler')
    const monthlyPrice = Number(getPlanPrice(acct))
    const cycleDays = Number(getPlanDuration(acct.plan))
    if (!monthlyPrice || !cycleDays) return res.status(400).json({ error: 'pricing_failed', renew_blocked_reason: 'pricing_unavailable', message: 'Could not determine a renewal price/duration for this plan. Contact support.' })
    // `months` (1 | 3 | 6 | 12, monthly plans only) renews one prepaid term at its discount and becomes
    // the account's auto-renew term. Without it the account's current term is renewed `periods` times.
    const pm = hostingTerms.parseMonths(req.body?.months, cycleDays)
    if (pm.error) return res.status(400).json({ error: pm.error, message: pm.message })
    const rawPeriods = parseInt(req.body?.periods, 10)
    if (pm.months && Number.isFinite(rawPeriods) && rawPeriods > 1) return res.status(400).json({ error: 'invalid_body', message: 'Send months (1, 3, 6 or 12) OR periods, not both.' })
    const termMonths = pm.months ? (cycleDays === hostingTerms.MONTH_DAYS ? pm.months : 1) : hostingTerms.termMonthsOf(acct, cycleDays)
    const unitPrice = hostingTerms.termPrice(monthlyPrice, termMonths)
    const duration = cycleDays * termMonths
    const periods = pm.months ? 1 : Math.min(Math.max(1, Math.floor(12 / termMonths)), Math.max(1, rawPeriods || 1))
    // Weekly plans: one week at a time, only once 7 days or fewer are left (blocked BEFORE any charge,
    // dry_run included) — a weekly account therefore never holds more than ~14 days.
    const weeklyBlock = hostingPlanChange.weeklyRenewBlock(acct, { durationDays: cycleDays, periods: Number.isFinite(rawPeriods) ? rawPeriods : 1 })
    if (weeklyBlock) {
      const { status, ...body } = weeklyBlock
      return res.status(status).json({ ...body, id: acct._id, username: acct._id, plan: acct.plan, expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null })
    }
    const priceUsd = +(unitPrice * periods).toFixed(2)
    const termInfo = { term_months: termMonths, term_discount_pct: hostingTerms.discountPct(termMonths), monthly_price_usd: cycleDays === hostingTerms.MONTH_DAYS ? monthlyPrice : null }

    // No-charge pre-flight (works on a LIVE key too): report price + renewability, change nothing.
    if (req.body?.dry_run === true) {
      const balance = await walletBalance(req.reseller.ownerChatId)
      const now = new Date()
      const base = (acct.expiryDate && new Date(acct.expiryDate) > now) ? new Date(acct.expiryDate) : now
      const wouldExpireAt = new Date(base.getTime() + duration * periods * 86400000)
      return res.json({
        dry_run: true, product: 'hosting', action: 'renew',
        id: acct._id, username: acct._id, domain: acct.domain, plan: acct.plan,
        renewable: true, renew_blocked_reason: null,
        periods, ...termInfo, duration_days: duration * periods, price_usd: priceUsd,
        wallet_balance_usd: balance, sufficient_balance: balance >= priceUsd,
        would_expire_at: wouldExpireAt.toISOString(),
        note: 'Pre-flight only: nothing was charged and no state changed. Re-send without dry_run to renew.',
      })
    }

    return billedProvision(req, res, {
      product: 'hosting', action: 'renew', priceUsd,
      request: { id: acct._id, username: acct._id, domain: acct.domain, plan: acct.plan, periods, months: termMonths },
      provision: async () => {
        // Make sure the underlying WHM account still exists before extending (else it was terminated).
        const whm = require('./whm-service')
        const info = await whm.getAccountInfo(acct.cpUser).catch(() => ({ success: false }))
        if (!info || info.success === false) {
          await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { terminatedOnWhm: true, terminatedAt: new Date(), terminationNote: 'WHM account not found during reseller-API renew' } })
          return { success: false, error: 'The underlying hosting account no longer exists on the server (terminated). Order a new plan.' }
        }
        const now = new Date()
        const currentExpiry = acct.expiryDate ? new Date(acct.expiryDate) : now
        const base = currentExpiry > now ? currentExpiry : now
        const newExpiry = new Date(base.getTime() + duration * periods * 86400000)
        // Compare-and-set: only extend if the expiry AND plan are still what we priced. A concurrent
        // renewal / plan change that landed first makes this a no-op → {success:false} → auto-refund
        // (prevents "charged twice, extended once" and renewing a just-changed plan at the old price).
        const upd = await col('cpanelAccounts').updateOne({ _id: acct._id, expiryDate: acct.expiryDate, plan: acct.plan }, {
          $set: { expiryDate: newExpiry, expiryNotified: false, lastRenewedAt: now, suspended: false, termMonths, renewalCount: (acct.renewalCount || 0) + periods },
          $unset: { suspendedAt: '', deleted: '', deletedAt: '', cancelledByUser: '', deletedBy: '', expiryUserNotified: '' },
        })
        if (!upd || upd.matchedCount === 0) {
          return { success: false, error: 'This account was just renewed or changed by another request, so this renewal was not applied (refunded). Re-read GET /hosting/:user and retry if still needed.' }
        }
        if (acct.suspended) { try { await whm.unsuspendAccount(acct.cpUser) } catch (_) {} }
        try { require('./anti-red-service').deployFullProtection(acct.cpUser, acct.domain, acct.plan).catch(() => {}) } catch (_) {}
        return { success: true, id: acct._id, username: acct._id, domain: acct.domain, plan: acct.plan, periods, ...termInfo, duration_days: duration * periods, expires_at: newExpiry.toISOString() }
      },
    })
  }))

  router.delete('/hosting/:user', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: account not terminated.' })
    // ISSUE-4 FIX (2026-10): mirror the bot's cancel flow exactly.
    //  1) Check the WHM account still exists.
    //  2) If it does, try terminate; if WHM refuses (suspended/frozen/license), unsuspend + retry,
    //     and if it STILL refuses, SOFT-DELETE the row + flag whmTerminatePending=true so the
    //     self-heal queue finishes it — never strand the user (21-day RCA: docxsndr.com).
    //  3) Cloudflare cleanup (worker routes + hosting DNS) for the PRIMARY and EVERY addon domain.
    //  4) Mark the row deleted/cancelled, autoRenew off.
    let terminated = false
    let softDeleteFallback = false
    let alreadyGone = false
    try {
      const acctCheck = await whmService.getAccountInfo(acct._id)
      if (acctCheck && acctCheck.success) {
        terminated = await whmService.terminateAccount(acct._id)
        if (!terminated) {
          try { await whmService.unsuspendAccount(acct._id) } catch (_) { /* WHM may refuse a suspended account */ }
          terminated = await whmService.terminateAccount(acct._id)
        }
        if (!terminated) {
          // WHM still refuses — don't strand the user. Soft-delete + queue admin/self-heal.
          log(`[ResellerAPI] cancel: WHM terminateAccount refused for ${acct._id} — soft-delete + whmTerminatePending`)
          softDeleteFallback = true
          terminated = true
        }
      } else {
        // Already gone on WHM — just clean up locally.
        alreadyGone = true
        terminated = true
      }
    } catch (e) {
      log(`[ResellerAPI] cancel WHM step error for ${acct._id}: ${e.message}`)
      // Fall through to CF cleanup + soft delete so the row doesn't get stuck active.
      softDeleteFallback = true
      terminated = true
    }

    // Cloudflare cleanup for primary + every addon domain (addonDomains = strings;
    // tolerate any legacy {domain} objects too). CF doesn't depend on WHM uptime.
    // Skipped per domain when another live account still uses it (2026-10 namewords.sbs RCA:
    // deleting a FAILED duplicate record wiped the live account's tunnel CNAMEs).
    const addonList = (acct.addonDomains || []).map(a => (typeof a === 'string' ? a : (a && a.domain) || '')).filter(Boolean)
    const allDomains = [acct.domain, ...addonList].filter(Boolean)
    const seen = new Set()
    const cfCleanup = []
    for (const d of allDomains) {
      const key = (d || '').toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      try {
        const r = await teardownHostingDomain({ col: col('cpanelAccounts'), domain: d, excludeId: acct._id, tag: 'ResellerAPI' })
        cfCleanup.push({ domain: r.domain, result: r.removed ? 'removed' : (r.skipped === 'in_use' ? 'kept_in_use_by_another_account' : r.skipped) })
      } catch (cfErr) {
        log(`[ResellerAPI] cancel: CF cleanup warning for ${d}: ${cfErr.message}`)
        cfCleanup.push({ domain: key, result: 'error' })
      }
    }

    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: {
      deleted: true, deletedAt: new Date(), deletedBy: 'reseller_api', cancelledByUser: true, autoRenew: false,
      ...(softDeleteFallback ? { whmTerminatePending: true } : {}),
    } })
    res.json({
      mode: 'live', username: acct._id, terminated: true,
      whm_terminate_pending: softDeleteFallback,
      cloudflare_cleanup: cfCleanup,
      note: softDeleteFallback
        ? 'WHM refused removal right now — the account is cancelled in our records and queued for server-side termination + verification.'
        : (alreadyGone ? 'Account was already gone on the server; cleaned up records + Cloudflare.' : 'Account terminated and Cloudflare cleaned up.'),
    })
  }))

  // Self-heal: re-create missing apex/www web DNS (proxied CNAME → Cloudflare Tunnel) for the
  // account's primary + addon domains. Existing records are never touched. Body {dry_run:true} = report only.
  router.post('/hosting/:user/dns/repair', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!hostingDnsRepair.isLiveAccount(acct)) {
      return res.status(409).json({ error: 'account_not_live', message: 'Only provisioned, non-terminated accounts can be repaired.' })
    }
    const apply = isLive() && req.body?.dry_run !== true
    const r = await hostingDnsRepair.repairAccount(acct, { apply })
    res.json({ mode: apply ? 'live' : 'dry_run', username: r.username, domains: r.domains.map(({ zone_id, ...d }) => d) })
  }))

  // Live origin health (probed through the tunnel, not the decoy) + the uptime monitor's state. Read-only:
  // the background monitor (every 5 min) is what auto-repairs DNS and fires site_down / site_recovered.
  router.get('/hosting/:user/health', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const lc = hostingLifecycle(acct)
    const notLive = acct.provisionState === 'provisioning' || acct.provisionState === 'failed' || lc.state === 'terminated'
    if (notLive) return res.status(409).json({ error: 'account_not_live', state: acct.provisionState === 'provisioning' || acct.provisionState === 'failed' ? acct.provisionState : lc.state, message: 'Health is available for provisioned, non-terminated accounts.' })
    if (lc.suspended || acct.maintenanceMode) return res.status(409).json({ error: lc.suspended ? 'account_suspended' : 'maintenance_mode', state: lc.suspended ? lc.state : 'maintenance', message: 'The site is intentionally offline; bring it online first.' })
    const [hc, mon] = await Promise.all([siteHealth.checkHealth(acct, { deep: true }), col(siteHealth.MONITOR).findOne({ _id: acct._id })])
    if (hc.dns.apex === false || hc.dns.www === false) {
      try { const r = await siteHealth.probes.inspectDomain(hc.domain); hc.dns.cloudflare = { status: r.status, missing: r.missing || [] } } catch (e) { hc.dns.cloudflare = { status: 'error', error: e.message } }
      hc.dns.repair_url = `/hosting/${acct._id}/dns/repair`
    }
    res.json({ username: acct._id, ...hc, monitor: { enabled: true, interval_minutes: 5, failures_before_site_down: siteHealth.FAIL_THRESHOLD, ...(siteHealth.monitorView(mon) || { status: 'unknown', consecutive_failures: 0, down_since: null, last_ok_at: null, last_checked_at: null, last_dns_repair_at: null }) } })
  }))

  router.get('/hosting/:user/login', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    if (!isLive()) return res.json({ mode: 'dry_run', username: acct._id, note: 'Dry-run: login URL generated only in live mode.' })
    const session = await whmService.createUserSession(acct._id)
    res.json({ mode: 'live', username: acct._id, login_url: session?.url || session || null })
  }))

  // Resolve a reseller-owned cPanel account by domain (main OR addon domain).
  // Failed provisioning records (e.g. duplicate_provisioning_prevented) never match, so a
  // domain always resolves to the live account (namewords.sbs → name65fb, not failed nameb594).
  async function findOwnedAccountByDomain(req, domain) {
    const chatId = String(req.reseller.ownerChatId)
    const rx = new RegExp('^' + String(domain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    let acct = await col('cpanelAccounts').findOne({ chatId, deleted: { $ne: true }, provisionState: { $ne: 'failed' }, domain: { $regex: rx } })
    // ISSUE-1 FIX (2026-10): addonDomains is canonically an array of lowercase STRINGS
    // (bot/panel/scheduler/addon-flow). Older reseller-API writes left some as
    // {domain,createdAt} objects. Match BOTH shapes so captcha/honeypot lookups by an
    // addon domain never miss a bot-attached addon.
    if (!acct) acct = await col('cpanelAccounts').findOne({
      chatId, deleted: { $ne: true }, provisionState: { $ne: 'failed' },
      $or: [
        { addonDomains: { $regex: rx } },                                // string element
        { addonDomains: { $elemMatch: { domain: { $regex: rx } } } },    // legacy {domain} object
      ],
    })
    return acct
  }

  // Resolve the customer-facing nameservers for a hosting account's domain
  // (Cloudflare NS the customer must point their domain at).
  async function brandedViewFor(acct) {
    try { return acct?.domain ? brandedNs.displayFromDoc(await brandedNs.getDoc(getDb(), String(acct.domain).toLowerCase())) : null } catch (_) { return null }
  }

  async function resolveNameservers(acct) {
    const bv = await brandedViewFor(acct)
    if (bv && Array.isArray(bv.nameservers) && bv.nameservers.length) return bv.nameservers
    if (Array.isArray(acct?.nameservers) && acct.nameservers.length) return acct.nameservers
    try {
      const rd = await col('registeredDomains').findOne({ _id: String(acct?.domain || '').toLowerCase() })
      const v = rd?.val || {}
      return v.cfNameservers || v.nameservers || rd?.nameservers || []
    } catch (_) { return [] }
  }

  // Non-secret hosting deliverables (safe in any mode). The PIN is revealed
  // ONLY by GET /hosting/:user/credentials (reveal = PIN reset = prod write).
  function hostingDeliverables(acct, nameservers, nsView = null) {
    return {
      cpanel_username: acct.cpUser || acct._id || null,
      panel_url: panelUrl(),
      server_ip: serverIp(),
      nameservers: nameservers || [],
      ...(nsView ? { nameserver_mode: nsView.nameserver_mode, nameserver_status: nsView.nameserver_status, current_nameservers: nsView.current_nameservers } : {}),
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
    // Default /renewals returns only ACTIONABLE items (upcoming / expiring_soon / grace). Terminated
    // items are opt-in via ?include_terminated=true and bounded to the last 90 days so the payload
    // can't grow unbounded for a high-churn reseller. Per-item `renewable` + the *.deleted webhooks
    // cover real-time reconciliation without this list.
    const includeTerminated = String(req.query.include_terminated || '') === 'true'
    const nowMs = Date.now()
    const DAY = 86400000
    const TERMINATED_WINDOW_MS = 90 * DAY
    const bucket = (days) => (days < 0 ? 'expired' : (days <= 3 ? 'expiring_soon' : 'upcoming'))
    const VPS_TERM = ['CANCELLED', 'DESTROYED', 'destroyed', 'DELETED']
    const items = []

    // Hosting (cpanelAccounts.expiryDate)
    try {
      const q = includeTerminated ? { chatId } : { chatId, deleted: { $ne: true } }
      const hosting = await col('cpanelAccounts').find(q).limit(500).toArray()
      for (const hp of hosting) {
        const terminated = !!(hp.deleted || hp.terminatedOnWhm)
        if (terminated) {
          if (!includeTerminated) continue
          const tAt = hp.deletedAt || hp.terminatedAt || null
          const tMs = tAt ? new Date(tAt).getTime() : null
          if (tMs && (nowMs - tMs) > TERMINATED_WINDOW_MS) continue
          items.push({
            product: 'hosting', id: hp._id || hp.username, domain: hp.domain || null, plan: hp.plan || null,
            expires_at: hp.expiryDate ? new Date(hp.expiryDate).toISOString() : null,
            days_until_expiry: hp.expiryDate ? Math.ceil((new Date(hp.expiryDate).getTime() - nowMs) / DAY) : null,
            status: 'terminated', state: 'terminated', terminated: true,
            terminated_at: tMs ? new Date(tMs).toISOString() : null,
            suspended: false, auto_renew: false, renewable: false, renew_blocked_reason: 'account_terminated',
          })
          continue
        }
        if (!hp.expiryDate) continue
        const exp = new Date(hp.expiryDate); if (isNaN(exp)) continue
        const days = Math.ceil((exp.getTime() - nowMs) / DAY)
        const lc = hostingLifecycle(hp, { price: hostingScheduler.getPlanPrice(hp), duration: hostingScheduler.getPlanDuration(hp.plan) })
        const rc = hostingScheduler.getRenewalCharge(hp)
        const item = {
          product: 'hosting', id: hp._id || hp.username, domain: hp.domain || null, plan: hp.plan || null,
          expires_at: exp.toISOString(), days_until_expiry: days,
          status: lc.state === 'grace' ? 'grace' : bucket(days),
          state: lc.state, suspended: lc.suspended, auto_renew: hp.autoRenew !== false,
          term_months: rc.months, renewal_price_usd: rc.priceUsd,
          renewable: lc.renewable, renew_blocked_reason: lc.renew_blocked_reason, renew_available_at: lc.renew_available_at,
        }
        if (lc.grace) { item.in_grace = true; item.expired_at = lc.grace.expired_at; item.delete_at = lc.grace.delete_at; item.days_until_deletion = lc.grace.days_remaining }
        items.push(item)
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
        items.push({ product: 'domain', id: d.domainName || d._id, domain: d.domainName || null, registrar: d.registrar || null, expires_at: exp.toISOString(), days_until_expiry: days, status: bucket(days), auto_renew: d.autoRenew === true, renewal_price_usd: typeof d.autoRenewPriceUsd === 'number' ? d.autoRenewPriceUsd : null })
      }
    } catch (e) { log(`[ResellerAPI] renewals domains warn: ${e.message}`) }

    // VPS + RDP (reseller-owned flat docs)
    try {
      const q = includeTerminated ? { chatId } : { chatId, status: { $nin: VPS_TERM } }
      const vpsDocs = await col('vpsPlansOf').find(q).limit(500).toArray()
      for (const v of vpsDocs) {
        const terminalV = VPS_TERM.includes(String(v.status)) || v.cancelReason === 'expired_grace' || v.destroy_reason === 'expired_grace'
        if (terminalV) {
          if (!includeTerminated) continue
          const tAt = v.cancelledAt || v.end_time || null
          const tMs = tAt ? new Date(tAt).getTime() : null
          if (tMs && (nowMs - tMs) > TERMINATED_WINDOW_MS) continue
          items.push({
            product: v.isRDP ? 'rdp' : 'vps', id: v.vpsId || v._id, plan: v.plan || null, region: v.region || null,
            expires_at: v.end_time ? new Date(v.end_time).toISOString() : null,
            days_until_expiry: v.end_time ? Math.ceil((new Date(v.end_time).getTime() - nowMs) / DAY) : null,
            status: 'terminated', state: 'terminated', terminated: true,
            terminated_at: tMs ? new Date(tMs).toISOString() : null,
            renewable: false, renew_blocked_reason: 'already_destroyed',
          })
          continue
        }
        const raw = v.end_time || v.expiresAt || v.subscriptionEnd || (v.subscription && v.subscription.subscriptionEnd) || null
        if (!raw) continue
        const exp = new Date(raw); if (isNaN(exp)) continue
        const days = Math.ceil((exp.getTime() - nowMs) / DAY)
        const rn = vpsRenewability(v, v.isRDP, v.isRDP ? rdpProviderForRecord(v) : null)
        const item = { product: v.isRDP ? 'rdp' : 'vps', id: v.vpsId || v._id, plan: v.plan || null, region: v.region || null, expires_at: exp.toISOString(), days_until_expiry: days, status: bucket(days), renewable: rn.renewable, renew_blocked_reason: rn.renew_blocked_reason }
        // RDP 3-day grace: an expired-but-not-yet-deleted box is powered off and pending
        // permanent deletion at grace_until. Surface it so a polling reseller can renew in time.
        const graceUntil = v.grace_until ? new Date(v.grace_until) : null
        if (v.isRDP && graceUntil && !isNaN(graceUntil.getTime()) && !VPS_TERM.includes(String(v.status))) {
          item.status = 'grace'
          item.in_grace = true
          item.expired_at = v.expired_at ? new Date(v.expired_at).toISOString() : null
          item.delete_at = graceUntil.toISOString()
          item.days_until_deletion = Math.max(0, Math.ceil((graceUntil.getTime() - nowMs) / DAY))
        }
        items.push(item)
      }
    } catch (e) { log(`[ResellerAPI] renewals vps warn: ${e.message}`) }

    // Keep actionable items within the window PLUS every (opt-in) terminated item.
    const filtered = items
      .filter(i => i.terminated === true || (i.days_until_expiry != null && i.days_until_expiry <= withinDays))
      .sort((a, b) => (a.days_until_expiry == null ? 1e9 : a.days_until_expiry) - (b.days_until_expiry == null ? 1e9 : b.days_until_expiry))
    res.json({
      within_days: withinDays,
      include_terminated: includeTerminated,
      count: filtered.length,
      summary: {
        expired: filtered.filter(i => i.status === 'expired').length,
        expiring_soon: filtered.filter(i => i.status === 'expiring_soon').length,
        upcoming: filtered.filter(i => i.status === 'upcoming').length,
        in_grace: filtered.filter(i => i.status === 'grace').length,
        terminated: filtered.filter(i => i.status === 'terminated').length,
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

  // ── Per-domain auto-renew (OpenProvider domains only) ──
  // Off by default. When on, the hourly sweep (domain-auto-renew.js) charges the wallet and renews
  // 1 year from 7 days before expiry, retrying daily until the expiry date. Body { enabled } sets it;
  // omit to toggle. Free, any mode. Re-enabling clears a failed attempt so the next sweep retries.
  router.post('/domains/:domain/auto-renew', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const owned = await col('domainsOf').findOne({ chatId: String(req.reseller.ownerChatId), domainName: domain })
    if (!owned) return res.status(404).json({ error: 'not_found', message: 'That domain is not registered under your account.' })
    const raw = req.body?.enabled
    let enabled
    if (typeof raw === 'boolean') enabled = raw
    else if (raw === undefined || raw === null) enabled = owned.autoRenew !== true
    else return res.status(400).json({ error: 'invalid_body', message: 'Optional body { "enabled": true|false }; omit to toggle.' })
    const registrar = await domainAutoRenew.registrarOf(getDb(), owned)
    if (enabled && !domainAutoRenew.isOpenProvider(registrar)) {
      return res.status(501).json({ error: 'auto_renew_not_supported', domain, registrar: registrar || null, auto_renew: false, message: `Auto-renew is available for OpenProvider-registered domains only for now${registrar ? ` (this domain is registered with ${registrar})` : ''}. Renew it at the registrar or via the Telegram bot.` })
    }
    const set = { autoRenew: enabled, autoRenewUpdatedAt: new Date() }
    if (enabled) {
      // Registrar READS only (safe on any pod): pin the real expiry + quote the 1-year renewal price.
      const [info, quote] = await Promise.all([opService.getDomainInfo(domain).catch(() => null), opService.getRenewPrice(domain).catch(() => null)])
      const exp = info && info.expiresAt ? new Date(info.expiresAt) : null
      if (exp && !isNaN(exp.getTime())) set.expiresAt = exp
      if (quote && quote.price > 0) set.autoRenewPriceUsd = Math.round(quote.price * 100) / 100
      Object.assign(set, { autoRenewLastError: null, autoRenewNextAttemptAt: null })
    }
    await col('domainsOf').updateOne({ _id: owned._id }, { $set: set })
    const balance = await walletBalance(req.reseller.ownerChatId)
    const v = domainAutoRenew.view({ ...owned, ...set }, registrar)
    res.json({ ...v, wallet_balance_usd: balance, sufficient_balance: v.renewal_price_usd != null ? balance >= v.renewal_price_usd : null, mode: mode() })
  }))

  // ════════════════════════════════════════════════════════
  // HOSTING — details, upgrade, addon domains
  // (manual renew lives above at POST /hosting/:user/renew — the periods-aware,
  //  dry-run-capable handler; the earlier duplicate here was dead code and removed.)
  // ════════════════════════════════════════════════════════
  // Plan change rules (see hosting-plan-change.js):
  //   • Premium Monthly <-> Golden Monthly: upgrade charges the pro-rata difference for the days left,
  //     downgrade is free with no refund; the expiry date never moves; new price from next renewal.
  //   • Weekly -> Monthly: unused weekly days are credited, the rest of the monthly price is charged
  //     now and a fresh 30-day term starts today.
  //   • Monthly -> Weekly: never allowed (hidden from plan-options, 409 weekly_downgrade_not_allowed).
  // Expired accounts must renew first; suspended accounts must be unsuspended first.
  const HOSTING_PLAN_CHANGE_POLICY = {
    upgrade: 'Premium Monthly -> Golden Monthly. Applies immediately. Charged now: (new monthly price - current monthly price) x days left / 30. On a prepaid 3/6/12-month term both monthly prices are taken at that term\'s discount (10% / 15% / 25%). The expiry date does not change.',
    downgrade: 'Golden Monthly -> Premium Monthly. Applies immediately. No refund or credit for the current term. The expiry date does not change. Blocked while the account has more addon domains than the target plan allows.',
    weekly_to_monthly: 'Weekly -> Premium Monthly or Golden Monthly. Applies immediately. The unused weekly days are credited (weekly price x days left / 7), the rest of the monthly price is charged now (monthly price - credit) and a fresh 30-day term starts today.',
    monthly_to_weekly: 'Never allowed. A monthly plan cannot be switched to the weekly plan (409 weekly_downgrade_not_allowed).',
    renewal: 'Renewals always use the plan the account is on at renewal time: monthly plans renew for the account\'s term (1, 3, 6 or 12 months; term_months) at renewal_price_usd = the term price after its discount. Weekly plans renew one week at a time, once 7 days or fewer are left.',
  }
  const HOSTING_PLAN_LOCK_MS = 10 * 60000
  function hostingPlanChangeError(res, e) {
    if (!(e instanceof hostingPlanChange.HostingPlanChangeError)) throw e
    return res.status(e.status).json({ error: e.code, message: e.message })
  }
  // Atomic per-account lock so two concurrent change requests can never both charge. A lock older
  // than HOSTING_PLAN_LOCK_MS (crashed request) is considered stale and can be taken over.
  async function lockHostingPlanChange(id) {
    const now = new Date()
    const lockId = crypto.randomUUID()
    const doc = await col('cpanelAccounts').findOneAndUpdate(
      { _id: id, $or: [{ planChangeLock: { $exists: false } }, { planChangeLock: null }, { 'planChangeLock.at': { $lt: new Date(now.getTime() - HOSTING_PLAN_LOCK_MS) } }] },
      { $set: { planChangeLock: { id: lockId, at: now } } },
      { returnDocument: 'after', includeResultMetadata: false },
    )
    return doc ? { doc, lockId } : null
  }
  const unlockHostingPlanChange = (id, lockId) => col('cpanelAccounts').updateOne({ _id: id, 'planChangeLock.id': lockId }, { $unset: { planChangeLock: '' } }).catch(() => {})

  router.get('/hosting/:user/plan-options', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    let po
    try { po = hostingPlanChange.hostingPlanOptions(acct, hostingPlans()) } catch (e) { return hostingPlanChangeError(res, e) }
    res.json({ username: acct._id, domain: acct.domain, product: 'hosting', ...po, policy: HOSTING_PLAN_CHANGE_POLICY })
  }))

  async function hostingPlanChangeHandler(req, res) {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    let q
    try { q = hostingPlanChange.hostingQuote(acct, hostingPlans(), req.body?.plan_id) } catch (e) { return hostingPlanChangeError(res, e) }
    if (acct.suspended) return res.status(409).json({ error: 'account_suspended', message: 'Unsuspend the account first (POST /hosting/:user/unsuspend), then change the plan.' })
    if (req.body?.dry_run === true) {
      const balance = await walletBalance(req.reseller.ownerChatId)
      return res.json({ dry_run: true, product: 'hosting', action: q.option.direction, username: acct._id, current: q.current, remaining_days: q.remaining_days, term_ends_at: q.term_ends_at, quote: q.option, wallet_balance_usd: balance, sufficient_balance: balance >= q.option.charge_now_usd, note: 'Pre-flight only: nothing was charged and the account was not changed.' })
    }

    // ── Lock, then re-quote on the freshly-locked record (no stale price/expiry) ──
    const lock = await lockHostingPlanChange(acct._id)
    if (!lock) return res.status(409).json({ error: 'plan_change_in_progress', message: 'Another plan change for this account is already running. Wait a few seconds and re-read GET /hosting/:user/plan-options.' })
    try {
      const cur = lock.doc
      try { q = hostingPlanChange.hostingQuote(cur, hostingPlans(), req.body?.plan_id) } catch (e) { return hostingPlanChangeError(res, e) }
      if (cur.suspended) return res.status(409).json({ error: 'account_suspended', message: 'Unsuspend the account first (POST /hosting/:user/unsuspend), then change the plan.' })
      const opt = q.option
      const target = hostingPlanById(opt.plan_id)
      const prevExpiry = q.term_ends_at
      const request = { username: cur._id, domain: cur.domain, from_plan: cur.plan, to_plan: target.name, direction: opt.direction, billing: opt.billing, charge_usd: opt.charge_now_usd, unused_credit_usd: opt.unused_credit_usd, remaining_days: q.remaining_days, previous_expires_at: prevExpiry, expires_at: opt.expires_at }
      const provision = async () => {
        try {
          const info = await whmService.getAccountInfo(cur._id)
          if (!info || !info.success) return { success: false, error: 'WHM account not found — cannot change the plan of a terminated/missing account.' }
        } catch (e) { return { success: false, error: `WHM account check failed: ${e.message}` } }
        let cr
        try { cr = await whmService.changePackage(cur._id, target.name) }
        catch (e) { return { success: false, error: `WHM changePackage failed: ${e.message}` } }
        if (!cr || cr.success === false) return { success: false, error: `WHM refused the plan change: ${cr?.error || 'unknown error'}` }
        const at = new Date()
        const set = { plan: target.name, renewalPriceUsd: target.priceUsd, planChangedAt: at, ...(opt.direction === 'upgrade' ? { upgradedAt: at, upgradedFrom: cur.plan } : { downgradedAt: at, downgradedFrom: cur.plan }) }
        // Weekly → monthly starts a fresh term: new expiry + reset the expiry-reminder flags for it.
        if (opt.expiry_changes) Object.assign(set, { expiryDate: new Date(opt.expires_at), expiryNotified: false, termMonths: opt.term_months })
        await col('cpanelAccounts').updateOne({ _id: cur._id }, {
          $set: set,
          ...(opt.expiry_changes ? { $unset: { expiryUserNotified: '' } } : {}),
          $push: { planChangeHistory: { id: crypto.randomUUID(), at, status: 'completed', from: cur.plan, to: target.name, direction: opt.direction, billing: opt.billing, charged_usd: opt.charge_now_usd, unused_credit_usd: opt.unused_credit_usd, previous_expires_at: prevExpiry, expires_at: opt.expires_at, renewal_price_usd: opt.renewal_price_usd, term_months: opt.term_months, via: 'api' } },
        })
        try {
          require('./anti-red-service').deployFullProtection(cur._id, cur.domain, target.name)
            .catch(e => log(`[ResellerAPI] plan-change anti-red redeploy warn for ${cur.domain}: ${e.message}`))
        } catch (_) { /* best-effort */ }
        return {
          success: true, username: cur._id, domain: cur.domain, plan: target.name, plan_id: target.id, previous_plan: cur.plan, previous_plan_id: q.current.plan_id,
          direction: opt.direction, billing: opt.billing, unused_credit_usd: opt.unused_credit_usd,
          expires_at: opt.expires_at, previous_expires_at: prevExpiry, expiry_changed: !!opt.expiry_changes,
          renewal_price_usd: opt.renewal_price_usd, renewal_days: opt.renewal_days, term_months: opt.term_months, term_discount_pct: opt.term_discount_pct, refund_usd: 0,
        }
      }
      const emitChanged = (r, chargedUsd) => emitEvent(req.reseller.ownerChatId, 'hosting.plan_changed', cur._id, {
        username: cur._id, domain: cur.domain, direction: opt.direction, billing: opt.billing,
        from_plan: q.current.plan_id, from_plan_name: cur.plan, to_plan: target.id, to_plan_name: target.name,
        charged_usd: chargedUsd, unused_credit_usd: opt.unused_credit_usd, refund_usd: 0,
        previous_expires_at: prevExpiry, expires_at: r.expires_at, renewal_price_usd: opt.renewal_price_usd, term_months: opt.term_months, via: 'api',
      }, `${cur._id}:${Date.now()}`)

      if (opt.charge_now_usd > 0) {
        // billedProvision: wallet check → atomic debit → provision → auto-refund on failure.
        let provisioned = null
        const out = await billedProvision(req, res, { product: 'hosting', action: opt.direction, priceUsd: opt.charge_now_usd, request, provision: async () => { const r = await provision(); if (r && r.success) provisioned = r; return r } })
        if (provisioned && isLive()) emitChanged(provisioned, opt.charge_now_usd)
        return out
      }
      // Nothing to charge (downgrade / credit covers the new term): no wallet movement, no refund.
      const balance = await walletBalance(req.reseller.ownerChatId)
      if (!isLive()) return res.json({ mode: 'dry_run', product: 'hosting', action: opt.direction, price_usd: 0, wallet_balance_usd: balance, would_provision: request, note: 'Dry-run: the plan was not changed.' })
      const r = await provision().catch(e => ({ success: false, error: e.message }))
      await recordOrder({ keyId: req.reseller.keyId, ownerChatId: req.reseller.ownerChatId, product: 'hosting', action: opt.direction, request, priceUsd: 0, mode: 'live', status: r.success ? 'provisioned' : 'failed', ...(r.success ? { result: r } : { error: r.error }) })
      if (!r.success) return res.status(502).json({ error: 'plan_change_failed', message: r.error })
      emitChanged(r, 0)
      return res.json({ mode: 'live', product: 'hosting', action: opt.direction, charged_usd: 0, wallet_balance_usd: balance, result: r })
    } finally {
      await unlockHostingPlanChange(acct._id, lock.lockId)
    }
  }
  router.post('/hosting/:user/upgrade', apiKeyAuth, h(hostingPlanChangeHandler))
  router.post('/hosting/:user/change-plan', apiKeyAuth, h(hostingPlanChangeHandler))

  router.get('/hosting/:user/plan-changes', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    let f
    try { f = planChangeHistory.parseFilters({ ...req.query, product: '' }) } catch (e) { return historyQueryError(res, e) }
    const pg = planChangeHistory.page(planChangeHistory.hostingEntries(acct), f)
    res.json({ product: 'hosting', username: acct._id, domain: acct.domain || null, plan: acct.plan || null, ...historyPayload(pg) })
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
    // ISSUE-1 FIX (2026-10): do NOT push a {domain,createdAt} object here.
    // attachAddonDomain already persisted the addon as a lowercase STRING via
    // `$addToSet: { addonDomains: domain }` (addon-domain-flow.js). The extra object
    // push created a DUPLICATE entry (quota double-counted) and a mixed-shape array
    // that crashed the bot's "Unlink a Domain" / cancel-cleanup on `.toLowerCase()`.
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

  // URL Shortener — activate domains (buy/existing/external) + full link CRUD. Buying a domain
  // reuses domain pricing (billed); activation + links are FREE. Reuses the existing self-hosted
  // shortener (fullUrlOf/linksOf/clicksOn/expiryOf) so links resolve through app.get('/:id').
  registerShortenerRoutes({ router, apiKeyAuth, h, col, getDb, isLive, mode, log, billedProvision })

  // Account details/usage — 2-segment dynamic route registered LAST so the
  // literal 3-segment routes above (renew/upgrade/addons/login/…) win first.
  router.get('/hosting/:user', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct) return res.status(404).json({ error: 'not_found' })
    const addons = Array.isArray(acct.addonDomains) ? acct.addonDomains : []
    const nameservers = await resolveNameservers(acct)
    const nsView = await brandedViewFor(acct)
    // Terminated short-circuit: a cancelled/removed account has nothing on the server, so skip the
    // WHM read and null out credentials/deliverables. Keep identifying metadata (domain/plan/
    // expires_at/terminated_at) so a storefront can reconcile its catalog and render
    // "Terminated — order a new plan." The legacy `suspended` boolean is forced false.
    if (acct.deleted || acct.terminatedOnWhm) {
      return res.json({
        id: acct._id || acct.username,
        username: acct._id || acct.username,
        domain: acct.domain || null,
        plan: acct.plan || null,
        price_usd: hostingScheduler.getPlanPrice(acct),
        duration_days: hostingScheduler.getPlanDuration(acct.plan),
        state: 'terminated',
        terminated: true,
        terminated_at: (acct.deletedAt || acct.terminatedAt) ? new Date(acct.deletedAt || acct.terminatedAt).toISOString() : null,
        termination_reason: acct.terminationNote || acct.suspendedReason || 'account_terminated',
        suspended: false,
        grace: null,
        renewable: false,
        renew_blocked_reason: 'account_terminated',
        suspended_reason: acct.suspendedReason || null,
        suspended_at: null,
        auto_renew: false,
        auto_renew_last_error: acct.autoRenewLastError || null,
        auto_renew_last_attempt_at: acct.autoRenewLastAttemptAt ? new Date(acct.autoRenewLastAttemptAt).toISOString() : null,
        auto_renew_next_attempt_at: null,
        created_at: acct.createdAt || null,
        expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
        panel_url: null,
        server_ip: null,
        deliverables: null,
        credentials_url: null,
        addon_quota: addonQuota(acct.plan),
        addon_domain_count: addons.length,
        addon_domains: addons.map(a => a.domain || a),
        usage: null,
        note: 'This hosting account was terminated — order a new plan. Identifying metadata is retained for reconciliation only.',
        mode: mode(),
      })
    }
    // Provisioning / failed short-circuit: the async create returned a 202 and the real WHM build
    // runs in the background. Until it finishes there is no account on WHM to read, so report the
    // job state instead of hammering WHM with a 404.
    if (acct.provisionState === 'provisioning' || acct.provisionState === 'failed') {
      const failed = acct.provisionState === 'failed'
      const job = acct.provisionJobId ? await provisionJobs().findOne({ _id: acct.provisionJobId }) : null
      const prog = job ? jobProgress(job) : null
      return res.json({
        id: acct._id, username: acct._id, domain: acct.domain || null, plan: acct.plan || null,
        price_usd: hostingScheduler.getPlanPrice(acct), duration_days: hostingScheduler.getPlanDuration(acct.plan),
        state: failed ? 'failed' : 'provisioning',
        terminated: false,
        provision_state: acct.provisionState,
        provision_failed_reason: failed ? (acct.provisionFailedReason || 'provision_failed') : null,
        job_id: acct.provisionJobId || null,
        job_status_url: acct.provisionJobId ? `/jobs/${acct.provisionJobId}` : null,
        progress: prog ? prog.progress : (failed ? 0 : null),
        stage: prog ? prog.stage : null,
        stage_label: prog ? prog.stage_label : null,
        eta_seconds: prog ? prog.eta_seconds : null,
        eta_at: prog ? prog.eta_at : null,
        elapsed_seconds: prog ? prog.elapsed_seconds : null,
        suspended: false, grace: null,
        renewable: false, renew_blocked_reason: failed ? 'provision_failed' : 'provisioning',
        auto_renew: false,
        created_at: acct.createdAt || null,
        expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
        panel_url: failed ? null : panelUrl(),
        server_ip: failed ? null : serverIp(),
        deliverables: null,
        credentials_url: failed ? null : `/hosting/${acct._id}/credentials`,
        usage: null,
        note: failed
          ? 'Provisioning failed — the wallet was auto-refunded. Retry the create (optionally with a fresh client_ref).'
          : 'Provisioning in progress. Poll GET /jobs/{job_id} for live progress + ETA, or this endpoint until state="online", or subscribe to the hosting.provisioned webhook.',
        mode: mode(),
      })
    }
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
    if (liveSuspended !== null && liveSuspended !== !!acct.suspended) {
      col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: liveSuspended, suspendedSyncedAt: new Date() } }).catch(() => {})
    }
    const rc = hostingScheduler.getRenewalCharge(acct)
    const price = rc.priceUsd
    const duration = rc.days
    const lc = hostingLifecycle(acct, { price, duration, liveSuspended })
    res.json({
      id: acct._id || acct.username,
      username: acct._id || acct.username,
      domain: acct.domain || null,
      plan: acct.plan || null,
      // price_usd / duration_days = one renewal of the account's prepaid term (term_months 1 | 3 | 6 | 12).
      price_usd: price,
      duration_days: duration,
      term_months: rc.months,
      term_discount_pct: rc.discountPct,
      monthly_price_usd: rc.days === rc.months * hostingTerms.MONTH_DAYS ? rc.monthlyUsd : null,
      // Full lifecycle so a storefront never has to infer state from suspended+expiry:
      //   online | suspended | grace | terminated.  `grace` (when state==='grace') carries
      //   delete_at (= expiry + 48h) + days/hours_remaining so you can message the customer.
      state: lc.state,
      terminated: false,
      suspended: lc.suspended,
      grace: lc.grace,
      renewable: lc.renewable,
      renew_blocked_reason: lc.renew_blocked_reason,
      renew_available_at: lc.renew_available_at,
      // GAP-4 FIX (2026-09): surface WHY the account is suspended / why auto-renew didn't run, so an
      // integrator can act (e.g. auto_renew_last_error 'insufficient_funds' → top up wallet, then
      // POST /hosting/:user/renew). Populated by the hosting scheduler's expiry/auto-renew sweep.
      suspended_reason: acct.suspendedReason || null,
      suspended_at: acct.suspendedAt ? new Date(acct.suspendedAt).toISOString() : null,
      auto_renew: acct.autoRenew !== false,
      auto_renew_last_error: acct.autoRenewLastError || null,
      auto_renew_last_attempt_at: acct.autoRenewLastAttemptAt ? new Date(acct.autoRenewLastAttemptAt).toISOString() : null,
      auto_renew_next_attempt_at: acct.autoRenewNextAttemptAt ? new Date(acct.autoRenewNextAttemptAt).toISOString() : null,
      created_at: acct.createdAt || null,
      expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
      panel_url: panelUrl(),
      server_ip: serverIp(),
      deliverables: hostingDeliverables(acct, nameservers, nsView),
      addon_quota: addonQuota(acct.plan),
      addon_domain_count: addons.length,
      addon_domains: addons.map(a => a.domain || a),
      usage,
      mode: mode(),
    })
  }))


  // Background provisioning worker: picks up stragglers (a pending job whose inline processJob never
  // ran — e.g. a crash right after the 202) and reconciles 'processing' jobs orphaned by a deploy
  // flip (checks WHM for the account → provisioned, else refund + provision_failed). Active-slot only
  // so the standby slot can't double-provision/double-refund.
  const PROVISION_WORKER_MS = Math.max(15000, Number(process.env.RESELLER_PROVISION_WORKER_MS) || 30000)
  try {
    activeSlot.singletonInterval('reseller-provision-worker', () => { provisionWorkerTick().catch((e) => log(`[ResellerAPI] worker tick: ${e.message}`)) }, PROVISION_WORKER_MS)
  } catch (e) { log(`[ResellerAPI] provision worker init warn: ${e.message}`) }
  // Expiry / renewal / low-balance, uptime and usage alert sweeps (production + active slot only).
  try { alerts.start({ getDb, log }) } catch (e) { log(`[ResellerAPI] alert sweeps init warn: ${e.message}`) }
  // Per-domain wallet auto-renew (OpenProvider) — production + active slot only.
  try { domainAutoRenew.start({ getDb, log }) } catch (e) { log(`[ResellerAPI] domain auto-renew init warn: ${e.message}`) }

  log(`[ResellerAPI] mounted at /reseller/v1 (mode=${mode()})`)
  return router
}

module.exports = { createResellerApi, hostingPlans, parseHostingUsage }
