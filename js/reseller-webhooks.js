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

const RETRIES = Math.max(0, Number(process.env.RESELLER_WEBHOOK_RETRIES || 3))
const TIMEOUT_MS = Math.max(1000, Number(process.env.RESELLER_WEBHOOK_TIMEOUT_MS || 10000))
// Backoff before each retry (ms); index clamps to the last entry.
const BACKOFF_MS = [2000, 6000, 12000]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function isHttpUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' }
  catch (_) { return false }
}

// POST once. Never throws — returns the axios response (validateStatus off).
// axios is resolved lazily so tests that stub the axios module still reach it.
function _post(url, body) {
  return require('axios')({
    method: 'POST', url, data: body, timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Nomadly-Reseller-Webhook/1' },
    validateStatus: () => true,
  })
}

// Deliver with retry/backoff. Any 2xx = success.
async function deliver(url, body) {
  let lastErr = null
  const attempts = RETRIES + 1
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)])
    try {
      const res = await _post(url, body)
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, attempts: i + 1 }
      lastErr = `HTTP ${res.status}`
    } catch (e) { lastErr = e.message }
  }
  return { ok: false, error: lastErr, attempts }
}

// Emit an event to every enabled reseller key owned by chatId that has a webhookUrl.
// Best-effort: never throws. Returns { delivered, skipped }.
async function emit(db, { chatId, event, instanceId, payload = {}, log = () => {} } = {}) {
  if (!db || typeof db.collection !== 'function' || !chatId || !event) return { delivered: 0, skipped: 0 }
  let keys = []
  try {
    keys = await db.collection('resellerApiKeys').find({ ownerChatId: String(chatId), enabled: true, webhookUrl: { $exists: true, $ne: null } }).toArray()
  } catch (e) { log(`[ResellerWebhook] key lookup failed: ${e.message}`); return { delivered: 0, skipped: 0 } }
  if (!keys.length) return { delivered: 0, skipped: 0 }

  const deliveries = db.collection('resellerWebhookDeliveries')
  const body = { event, occurred_at: new Date().toISOString(), data: { id: instanceId || null, ...payload } }
  let delivered = 0, skipped = 0

  for (const k of keys) {
    if (!isHttpUrl(k.webhookUrl)) { skipped++; continue }
    const dedupId = `${k._id}:${event}:${instanceId || ''}`
    // Claim the delivery first so the scheduler + safety-net sweep can't both send it.
    try {
      await deliveries.insertOne({ _id: dedupId, keyId: k._id, ownerChatId: String(chatId), event, instanceId: instanceId || null, url: k.webhookUrl, createdAt: new Date(), status: 'sending' })
    } catch (e) {
      if (e && e.code === 11000) { skipped++; continue } // already claimed/sent by another engine
      log(`[ResellerWebhook] dedup insert failed: ${e.message}`); continue
    }
    const r = await deliver(k.webhookUrl, body)
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

module.exports = { emit, deliver, isHttpUrl, RETRIES, TIMEOUT_MS }
