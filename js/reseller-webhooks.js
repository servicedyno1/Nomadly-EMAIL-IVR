'use strict'
// ============================================================
// Reseller push webhooks (js/reseller-webhooks.js)
// ------------------------------------------------------------
// The reseller REST API is pull-based; this adds an OPTIONAL push channel so a
// reseller who set a webhook_url on their API key receives RDP lifecycle events
// instead of polling GET /renewals.
//
// Scope (owner-approved 2026-06): PLAIN POST (no signature) + auto-retry/backoff.
// Events: rdp.grace_start (subscription expired → powered off, 3-day grace begins)
//         rdp.deleted     (droplet permanently deleted after grace ended unrenewed)
//
// Idempotent per (keyId, event, instanceId) via the resellerWebhookDeliveries
// collection, so the bot scheduler (owner of the grace lifecycle) and the
// RDP-service safety-net sweep never double-send the same event.
// ============================================================

const crypto = require('crypto')

const RETRIES = Math.max(0, Number(process.env.RESELLER_WEBHOOK_RETRIES || 3))
const TIMEOUT_MS = Math.max(1000, Number(process.env.RESELLER_WEBHOOK_TIMEOUT_MS || 10000))
// Backoff before each retry (ms); index clamps to the last entry.
const BACKOFF_MS = [2000, 6000, 12000]

// Every lifecycle event we can push. `.deleted` is consistent across products so
// a receiver can mark a customer's service dead on hosting.deleted / vps.deleted /
// rdp.deleted with the same handler. Surfaced on GET /account/webhook.
const EVENTS = [
  'hosting.provisioned', 'hosting.provision_failed',
  'hosting.grace_start', 'hosting.suspended', 'hosting.deleted', 'hosting.auto_renew_failed',
  'vps.provisioned', 'vps.provision_failed', 'vps.grace_start', 'vps.deleted',
  'rdp.provisioned', 'rdp.provision_failed', 'rdp.grace_start', 'rdp.deleted',
  // Branded nameservers (ns1/ns2.hosta.sh) lifecycle for reseller-registered domains
  'domain.nameservers_branded', 'domain.nameservers_reverted', 'domain.nameservers_branding_failed',
]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function isHttpUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' }
  catch (_) { return false }
}

// Per-key signing secret handed to the reseller so they can verify deliveries.
function newWebhookSecret() { return 'whsec_' + crypto.randomBytes(24).toString('hex') }
function _signature(secret, raw) {
  return 'sha256=' + crypto.createHmac('sha256', String(secret)).update(raw, 'utf8').digest('hex')
}

// POST once. Never throws — returns the axios response (validateStatus off).
// axios is resolved lazily so tests that stub the axios module still reach it.
function _post(url, raw, extraHeaders) {
  return require('axios')({
    method: 'POST', url, data: raw, timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Nomadly-Reseller-Webhook/1', ...(extraHeaders || {}) },
    validateStatus: () => true,
  })
}

// Deliver with retry/backoff. Any 2xx = success. When `secret` is set we sign the
// EXACT raw JSON body with HMAC-SHA256 and send it in X-Nomadly-Signature (format
// "sha256=<hex>") so the receiver can verify the event came from us — this defends
// against a spoofed *.deleted that would otherwise kill a real customer's service.
async function deliver(url, body, secret) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = {}
  if (secret) { headers['X-Nomadly-Signature'] = _signature(secret, raw); headers['X-Nomadly-Signature-Version'] = 'v1' }
  let lastErr = null
  const attempts = RETRIES + 1
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)])
    try {
      const res = await _post(url, raw, headers)
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, attempts: i + 1 }
      lastErr = `HTTP ${res.status}`
    } catch (e) { lastErr = e.message }
  }
  return { ok: false, error: lastErr, attempts }
}

// Emit an event to every enabled reseller key owned by chatId that has a webhookUrl.
// `dedupKey` (optional) overrides the idempotency discriminator while `instanceId` stays the
// payload id — used so a per-cycle event (hosting.grace_start / hosting.auto_renew_failed) can
// re-fire on the NEXT billing cycle, while a terminal event (*.deleted) stays once-per-resource.
// Best-effort: never throws. Returns { delivered, skipped }.
async function emit(db, { chatId, event, instanceId, dedupKey, payload = {}, log = () => {} } = {}) {
  if (!db || typeof db.collection !== 'function' || !chatId || !event) return { delivered: 0, skipped: 0 }
  let keys = []
  try {
    keys = await db.collection('resellerApiKeys').find({ ownerChatId: String(chatId), enabled: true, webhookUrl: { $exists: true, $ne: null } }).toArray()
  } catch (e) { log(`[ResellerWebhook] key lookup failed: ${e.message}`); return { delivered: 0, skipped: 0 } }
  if (!keys.length) return { delivered: 0, skipped: 0 }

  const deliveries = db.collection('resellerWebhookDeliveries')
  // Top-level `product` (hosting|vps|rdp) + occurred_at; `data` carries id, product,
  // domain, reason plus any event-specific fields passed in `payload`.
  const product = String(event).split('.')[0]
  const body = { event, product, occurred_at: new Date().toISOString(), data: { id: instanceId || null, product, ...payload } }
  let delivered = 0, skipped = 0

  for (const k of keys) {
    if (!isHttpUrl(k.webhookUrl)) { skipped++; continue }
    const dedupId = `${k._id}:${event}:${dedupKey || instanceId || ''}`
    // Claim the delivery first so the scheduler + safety-net sweep can't both send it.
    try {
      await deliveries.insertOne({ _id: dedupId, keyId: k._id, ownerChatId: String(chatId), event, instanceId: instanceId || null, url: k.webhookUrl, createdAt: new Date(), status: 'sending' })
    } catch (e) {
      if (e && e.code === 11000) { skipped++; continue } // already claimed/sent by another engine
      log(`[ResellerWebhook] dedup insert failed: ${e.message}`); continue
    }
    const r = await deliver(k.webhookUrl, body, k.webhookSecret)
    try {
      await deliveries.updateOne({ _id: dedupId }, { $set: r.ok
        ? { status: 'delivered', attempts: r.attempts, httpStatus: r.status, deliveredAt: new Date() }
        : { status: 'failed', attempts: r.attempts, lastError: r.error, failedAt: new Date() } })
    } catch (_) { /* status update best-effort */ }
    if (r.ok) { delivered++; log(`[ResellerWebhook] ${event} → ${k.webhookUrl} delivered (${r.attempts} attempt(s))`) }
    else { skipped++; log(`[ResellerWebhook] ${event} → ${k.webhookUrl} FAILED after ${r.attempts}: ${r.error}`) }
  }
  return { delivered, skipped }
}

module.exports = { emit, deliver, isHttpUrl, newWebhookSecret, EVENTS, RETRIES, TIMEOUT_MS }
