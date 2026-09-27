/* global process */
/**
 * store-payment-verify.js — pure DynoPay webhook/status classification for the
 * public storefront (store-routes.js).
 *
 * Extracted 2026-06 to fix a SILENT-DROP bug: the storefront webhook only
 * accepted gateway statuses ['completed','confirmed','settled','paid'] and
 * rejected DynoPay's 'received' status, dropping fully-paid orders with NO
 * admin alert — while the WORKING wallet-deposit path (authDyno in _index.js)
 * trusts the webhook event directly and only skips pending/failed/underpaid.
 * This module brings the store path to parity and adds a network-fee
 * underpayment tolerance so a fee-shaved payment (e.g. $67.31 of a $69 order)
 * still provisions.
 *
 * Pure + side-effect free (except reading process.env for the tolerance).
 */

const crypto = require('crypto')

// Statuses that mean "funds arrived" (normalized, 'payment.' prefix stripped).
const PAID = new Set([
  'completed', 'complete', 'confirmed', 'settled', 'paid', 'success',
  'received', 'received_unconfirmed',
])
// Statuses that DEFINITIVELY mean "not paid (yet)" → never provision.
// (2026-06) `refunded` added — funds were returned to the sender.
const UNPAID = new Set([
  'pending', 'failed', 'expired', 'cancelled', 'canceled', 'waiting',
  'underpaid', 'declined', 'refunded',
])

const DEFAULT_STORE_UNDERPAY_TOLERANCE = 0.90

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase().replace(/^payment\./, '')
}
function isPaidStatus(s) { return PAID.has(normalizeStatus(s)) }
function isUnpaidStatus(s) { return UNPAID.has(normalizeStatus(s)) }

/**
 * Decide what to do with a store crypto webhook that has ALREADY passed the
 * pending/failed skip.
 *
 * SECURITY MODEL (2026-06 — forged-webhook exploit fix):
 * The webhook body is UNTRUSTED. The authoritative signal is the server-to-server
 * DynoPay status (getPaymentStatusById / getCryptoTransaction) and/or a VALID
 * webhook HMAC signature (X-Dynopay-Signature-V2). We only fulfill when at least
 * one authoritative source confirms payment. Previously this trusted the webhook
 * event even when the gateway CONTRADICTED it ('unverified-fulfill' on a
 * gateway-says-waiting reply), which let an attacker POST a forged
 * "completed / base_amount:9999" body and self-credit — that path is now HELD.
 *
 * Rules:
 *  - empty / definitively-unpaid webhook event  → hold
 *  - gateway reachable & says PAID              → fulfill (authoritative)
 *  - gateway reachable & says UNPAID (contradicts) → hold  (EXPLOIT FIX)
 *  - gateway reachable & unknown status         → signatureValid ? fulfill : hold
 *  - gateway UNREACHABLE                         → signatureValid ? unverified-fulfill : hold
 *
 * The network-fee underpayment check in isStoreUnderpaid() remains the
 * money-amount safety gate applied AFTER this decision. The credited amount is
 * always taken from the authoritative gateway response (or the invoiced
 * order.amountUsd) — NEVER from the webhook body.
 *
 * @param {Object} p
 * @param {string}  p.event          - webhook body event/status
 * @param {boolean} p.gatewayReached - did the DynoPay status API return data?
 * @param {string} [p.gatewayStatus] - the gateway's reported status (when reached)
 * @param {boolean}[p.signatureValid]- was a DynoPay webhook HMAC signature present AND valid?
 * @returns {{action:'fulfill'|'unverified-fulfill'|'hold', reason:string}}
 */
function classifyStoreWebhook({ event, gatewayReached, gatewayStatus, signatureValid } = {}) {
  const ev = normalizeStatus(event)

  // Never provision on an empty or definitively-unpaid webhook event.
  if (!ev) return { action: 'hold', reason: 'webhook-event-empty' }
  if (isUnpaidStatus(ev)) return { action: 'hold', reason: `webhook-event-unpaid:${ev}` }

  if (gatewayReached) {
    // Authoritative gateway confirmation → fulfill.
    if (isPaidStatus(gatewayStatus)) {
      return { action: 'fulfill', reason: `gateway-confirmed:${normalizeStatus(gatewayStatus)}` }
    }
    // Gateway explicitly contradicts a "paid" webhook → HOLD (this is the
    // forged-webhook exploit path; the customer has NOT paid).
    if (isUnpaidStatus(gatewayStatus)) {
      return { action: 'hold', reason: `gateway-contradicts:${normalizeStatus(gatewayStatus)}` }
    }
    // Gateway reachable but reported an unknown/transitional status → only
    // trust the webhook if it carried a valid DynoPay signature.
    return signatureValid
      ? { action: 'fulfill', reason: `webhook-paid:${ev}(gateway-unknown:${normalizeStatus(gatewayStatus)},signed)` }
      : { action: 'hold', reason: `gateway-unknown:${normalizeStatus(gatewayStatus)}(unsigned)` }
  }

  // Gateway UNREACHABLE. Historically this "trusted the webhook" (wallet-deposit
  // parity), which is exactly the forgery window. Now we only fulfill if the
  // webhook is cryptographically authentic (valid HMAC signature); otherwise
  // HOLD for admin reconcile so a paid order is never silently dropped OR
  // fraudulently credited.
  return signatureValid
    ? { action: 'unverified-fulfill', reason: `webhook-paid:${ev}(gateway-unreachable,signed)` }
    : { action: 'hold', reason: `gateway-unreachable:${ev}(unsigned)` }
}

// ─── DynoPay webhook signature verification (2026-06) ───────────────────────
// DynoPay signs webhooks ONLY when the endpoint has a signing secret (whsec_…).
// Prefer V2 (HMAC-SHA256 over "<t>.<rawBody>", the exact bytes on the wire) with
// a ±toleranceSec replay window; fall back to the legacy V1 (HMAC over a
// re-serialised JSON body). Returns a state so the caller can reject a
// present-but-invalid signature and treat "no signature" separately.

function _parseSigV2(header) {
  const out = {}
  for (const kv of String(header || '').split(',')) {
    const [k, v] = kv.split('=')
    if (k && v != null) out[k.trim()] = v.trim()
  }
  return out
}

function verifyDynopayWebhookV2(rawBody, headerV2, secret, toleranceSec = 300) {
  if (!secret || !headerV2 || rawBody == null) return false
  const { t, v1 } = _parseSigV2(headerV2)
  const tNum = Number(t)
  if (!tNum) return false
  // Tolerate millisecond epoch timestamps (some gateways send ms, not s) for
  // the FRESHNESS window only — the HMAC message still uses the exact `t`
  // string as delivered, since that is what the sender signed.
  const tsSec = tNum > 1e12 ? Math.floor(tNum / 1000) : tNum
  if (Math.abs(Date.now() / 1000 - tsSec) > toleranceSec) return false
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  const got = Buffer.from(String(v1 || ''), 'hex')
  const exp = Buffer.from(expected, 'hex')
  return got.length === exp.length && crypto.timingSafeEqual(got, exp)
}

/**
 * Non-verifying DIAGNOSTIC: given a real inbound webhook, compute the sender's
 * v1 against EVERY plausible signing construction and report which (if any)
 * matches. Used to pin down DynoPay's exact scheme without guessing. Returns a
 * plain object safe to log (signatures truncated).
 */
function diagnoseDynopaySignature({ rawBody, headers = {}, secret } = {}) {
  const h = {}
  for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = headers[k]
  const v2 = h['x-dynopay-signature-v2']
  const v1hdr = h['x-dynopay-signature']
  const tsHdr = h['x-dynopay-timestamp']
  const raw = rawBody == null ? '' : (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody))
  const parsed = _parseSigV2(v2)
  const t = parsed.t != null ? parsed.t : tsHdr
  const provided = String(parsed.v1 || v1hdr || '').toLowerCase()
  const tNum = Number(t)
  const tsSec = Number.isFinite(tNum) ? (tNum > 1e12 ? Math.floor(tNum / 1000) : tNum) : NaN
  const keyFull = secret || ''
  const keyNoPrefix = keyFull.replace(/^whsec_/, '')
  let keyB64 = null; try { keyB64 = Buffer.from(keyNoPrefix, 'base64') } catch { keyB64 = null }
  const hmac = (key, msg, enc = 'hex') => { try { return crypto.createHmac('sha256', key).update(msg).digest(enc) } catch { return null } }
  const cand = {
    A_full_t_raw_hex: hmac(keyFull, `${t}.${raw}`),
    B_full_raw_hex: hmac(keyFull, raw),
    C_noprefix_t_raw_hex: hmac(keyNoPrefix, `${t}.${raw}`),
    D_b64key_t_raw_hex: keyB64 ? hmac(keyB64, `${t}.${raw}`) : null,
    E_b64key_t_raw_b64: keyB64 ? hmac(keyB64, `${t}.${raw}`, 'base64') : null,
    F_full_t_raw_b64: hmac(keyFull, `${t}.${raw}`, 'base64'),
    G_b64key_raw_b64: keyB64 ? hmac(keyB64, raw, 'base64') : null,
  }
  const norm = s => String(s || '').toLowerCase().replace(/=+$/, '')
  const matched = Object.keys(cand).find(k => cand[k] && provided && norm(cand[k]) === norm(provided)) || null
  const trunc = s => s ? (String(s).slice(0, 14) + '…' + String(s).slice(-4)) : null
  return {
    hasV2: !!v2, hasV1Legacy: !!v1hdr, tsHeader: tsHdr || null,
    t, tsUnit: tNum > 1e12 ? 'ms' : 's', tsDeltaSec: Number.isFinite(tsSec) ? Math.round(Date.now() / 1000 - tsSec) : null,
    rawLen: raw.length, rawSha16: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
    providedV1: trunc(provided),
    matchedScheme: matched,
    candidates: Object.fromEntries(Object.entries(cand).map(([k, v]) => [k, trunc(v)])),
  }
}

function verifyDynopayWebhookV1(bodyObjOrRaw, headerV1, secret) {
  if (!secret || !headerV1) return false
  // Legacy V1 signs HMAC-SHA256 over JSON.stringify(parsedBody).
  const payload = (typeof bodyObjOrRaw === 'string' || Buffer.isBuffer(bodyObjOrRaw))
    ? String(bodyObjOrRaw)
    : JSON.stringify(bodyObjOrRaw || {})
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const got = Buffer.from(String(headerV1), 'hex')
  const exp = Buffer.from(expected, 'hex')
  return got.length === exp.length && crypto.timingSafeEqual(got, exp)
}

/**
 * Classify the signature state of an inbound DynoPay webhook.
 * @returns {'valid'|'invalid'|'unsigned'} — 'unsigned' when no signature header
 *   is present (secret not configured on the DynoPay endpoint yet).
 */
function verifyDynopayWebhook({ rawBody, bodyObj, headers = {}, secret, toleranceSec = 300 } = {}) {
  const h = {}
  for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = headers[k]
  const v2 = h['x-dynopay-signature-v2']
  const v1 = h['x-dynopay-signature']
  if (!secret) return 'unsigned'          // we cannot verify without a secret
  if (!v2 && !v1) return 'unsigned'       // DynoPay sent no signature
  if (v2 && verifyDynopayWebhookV2(rawBody, v2, secret, toleranceSec)) return 'valid'
  if (v1 && verifyDynopayWebhookV1(rawBody != null ? rawBody : bodyObj, v1, secret)) return 'valid'
  return 'invalid'
}

function storeUnderpayTolerance() {
  const t = parseFloat(process.env.STORE_UNDERPAY_TOLERANCE)
  return Number.isFinite(t) && t > 0 && t <= 1 ? t : DEFAULT_STORE_UNDERPAY_TOLERANCE
}

/**
 * @returns {boolean} true if the received USD is below the acceptable tolerance
 * of the invoiced total (→ do NOT provision; refund/hold).
 */
function isStoreUnderpaid(usdIn, totalUsd, tolerance) {
  const tol = Number.isFinite(tolerance) && tolerance > 0 && tolerance <= 1 ? tolerance : storeUnderpayTolerance()
  if (!Number.isFinite(usdIn) || usdIn <= 0) return true
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return false
  return usdIn < totalUsd * tol
}

module.exports = {
  PAID, UNPAID, DEFAULT_STORE_UNDERPAY_TOLERANCE,
  normalizeStatus, isPaidStatus, isUnpaidStatus,
  classifyStoreWebhook, storeUnderpayTolerance, isStoreUnderpaid,
  verifyDynopayWebhook, verifyDynopayWebhookV2, verifyDynopayWebhookV1, diagnoseDynopaySignature,
}
