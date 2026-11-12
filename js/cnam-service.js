// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CNAM Lookup Service — Resolve caller/sender names
// Priority: Telnyx (primary) → Multitel (fallback) → SignalWire (last resort)
// Results cached in MongoDB to avoid repeat lookups
// Circuit breaker: auto-skips exhausted/down providers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const axios = require('axios')
const { log } = require('console')

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const MULTITEL_USERNAME = process.env.MULTITEL_USERNAME
const MULTITEL_PASSWORD = process.env.MULTITEL_PASSWORD
// SignalWire is the live CNAM provider: build Basic auth from the current project/token and use the current space URL.
const SW_HOST = String(process.env.SIGNALWIRE_SPACE_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const SW_AUTH = (process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN)
  ? Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString('base64')
  : (process.env.TOKEN_SIGNALWIRE || null)
const SIGNALWIRE_ON = !!(SW_HOST && SW_AUTH)

let _cnamCache = null // MongoDB collection

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Circuit Breaker — per-provider failure tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BREAKER_STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' }

// Thresholds
const CONSECUTIVE_FAIL_THRESHOLD = 3        // trip after N general failures
const CREDIT_FAIL_THRESHOLD = 1             // trip immediately on credit/auth error
const COOLDOWN_CREDIT_MS = 60 * 60 * 1000   // 1 hour for credit/auth exhaustion
const COOLDOWN_TRANSIENT_MS = 5 * 60 * 1000 // 5 minutes for transient errors

const circuitBreakers = {
  telnyx:    { state: BREAKER_STATES.CLOSED, failures: 0, lastFailure: 0, cooldownMs: 0, lastError: '' },
  multitel:  { state: BREAKER_STATES.CLOSED, failures: 0, lastFailure: 0, cooldownMs: 0, lastError: '' },
  signalwire:{ state: BREAKER_STATES.CLOSED, failures: 0, lastFailure: 0, cooldownMs: 0, lastError: '' },
}

/**
 * Check if a provider's circuit allows a request through.
 * Returns true if the call should proceed, false if it should be skipped.
 */
function circuitAllows(provider) {
  const cb = circuitBreakers[provider]
  if (!cb) return true

  if (cb.state === BREAKER_STATES.CLOSED) return true

  if (cb.state === BREAKER_STATES.OPEN) {
    const elapsed = Date.now() - cb.lastFailure
    if (elapsed >= cb.cooldownMs) {
      // Cooldown expired → half-open: allow one test request
      cb.state = BREAKER_STATES.HALF_OPEN
      log(`[CNAM:CB] ${provider} circuit → HALF_OPEN (cooldown expired, testing one request)`)
      return true
    }
    // Still in cooldown — skip this provider
    return false
  }

  // HALF_OPEN — allow the single test request
  if (cb.state === BREAKER_STATES.HALF_OPEN) return true

  return true
}

/**
 * Record a successful call — reset the circuit breaker.
 */
function circuitSuccess(provider) {
  const cb = circuitBreakers[provider]
  if (!cb) return

  if (cb.state !== BREAKER_STATES.CLOSED) {
    log(`[CNAM:CB] ${provider} circuit → CLOSED (success after ${cb.failures} prior failures)`)
  }
  cb.state = BREAKER_STATES.CLOSED
  cb.failures = 0
  cb.lastFailure = 0
  cb.cooldownMs = 0
  cb.lastError = ''
}

/**
 * Record a failed call — potentially trip the circuit.
 * @param {Error} err - The error from the API call
 */
function circuitFailure(provider, err) {
  const cb = circuitBreakers[provider]
  if (!cb) return

  cb.failures++
  cb.lastFailure = Date.now()

  const status = err?.response?.status
  const isCreditOrAuth = status === 402 || status === 403 || status === 401
  const detail = err?.response?.data?.errors?.[0]?.detail || err?.response?.data?.status?.msg || err.message || ''
  cb.lastError = `${status || 'network'}: ${detail}`

  if (isCreditOrAuth) {
    // Credit/auth errors → trip immediately
    cb.state = BREAKER_STATES.OPEN
    cb.cooldownMs = COOLDOWN_CREDIT_MS
    log(`[CNAM:CB] ${provider} circuit → OPEN (credit/auth error ${status}). Cooldown: ${COOLDOWN_CREDIT_MS / 60000}min. Detail: ${detail}`)
  } else if (cb.failures >= CONSECUTIVE_FAIL_THRESHOLD) {
    // Transient errors → trip after threshold
    cb.state = BREAKER_STATES.OPEN
    cb.cooldownMs = COOLDOWN_TRANSIENT_MS
    log(`[CNAM:CB] ${provider} circuit → OPEN (${cb.failures} consecutive failures). Cooldown: ${COOLDOWN_TRANSIENT_MS / 60000}min. Last: ${cb.lastError}`)
  } else if (cb.state === BREAKER_STATES.HALF_OPEN) {
    // Half-open test failed → re-trip
    cb.state = BREAKER_STATES.OPEN
    // Keep the same cooldown type
    cb.cooldownMs = cb.cooldownMs || COOLDOWN_TRANSIENT_MS
    log(`[CNAM:CB] ${provider} circuit → OPEN (half-open test failed). Re-cooldown: ${cb.cooldownMs / 60000}min. Error: ${cb.lastError}`)
  }
  // else: still accumulating failures, stays CLOSED
}

/**
 * Get human-readable circuit breaker status for all providers.
 */
function getCircuitStatus() {
  const now = Date.now()
  return Object.entries(circuitBreakers).map(([provider, cb]) => {
    const remaining = cb.state === BREAKER_STATES.OPEN
      ? Math.max(0, Math.ceil((cb.cooldownMs - (now - cb.lastFailure)) / 1000))
      : 0
    return {
      provider,
      state: cb.state,
      failures: cb.failures,
      lastError: cb.lastError || '—',
      cooldownRemainingSec: remaining,
    }
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider Init
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function initCnamService(deps) {
  _cnamCache = deps.cnamCache
  const providers = []
  if (SIGNALWIRE_ON) providers.push('SignalWire')
  if (TELNYX_API_KEY) providers.push('Telnyx')
  if (MULTITEL_USERNAME) providers.push('Multitel')
  log(`[CnamService] Initialized — priority: ${providers.join(' → ')} + MongoDB cache + circuit breaker`)
}

// ── Telnyx Caller Name lookup (primary) ──
async function lookupTelnyx(phone) {
  const clean = phone.replace(/[^+\d]/g, '')
  const formatted = clean.startsWith('+') ? clean : `+${clean}`
  const res = await axios({
    method: 'get',
    url: `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(formatted)}`,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    params: { type: 'caller-name' },
    timeout: 8000,
  })
  const data = res?.data?.data
  return data?.caller_name?.caller_name || null
}

// ── Multitel CNAM lookup (fallback) ──
async function lookupMultitel(phone) {
  const clean = phone.replace(/[^0-9]/g, '')
  const res = await axios({
    method: 'get',
    url: `https://api.multitel.net/v3/cnam/${clean}`,
    auth: { username: MULTITEL_USERNAME, password: MULTITEL_PASSWORD },
    timeout: 8000,
  })
  if (res?.data?.status?.code !== 200) {
    throw new Error(res?.data?.status?.msg || 'Multitel lookup failed')
  }
  return res?.data?.response?.name || null
}

// ── SignalWire CNAM lookup (primary — live provider) ──
async function lookupSignalwire(phone) {
  const clean = phone.replace(/[^0-9]/g, '')
  const res = await axios({
    method: 'get',
    url: `https://${SW_HOST}/api/relay/rest/lookup/phone_number/%2B${clean}?include=carrier,cnam`,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${SW_AUTH}`,
    },
    timeout: 8000,
  })
  return res?.data?.cnam?.caller_id || null
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main CNAM lookup with caching + circuit breaker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function lookupCnam(phoneNumber) {
  const clean = phoneNumber.replace(/[^+\d]/g, '')
  if (!clean || clean.length < 7) return null

  // Check cache first
  if (_cnamCache) {
    try {
      const cached = await _cnamCache.findOne({ phone: clean })
      if (cached && cached.name) {
        // Cache hit — return if less than 30 days old
        const age = Date.now() - new Date(cached.updatedAt).getTime()
        if (age < 30 * 24 * 60 * 60 * 1000) {
          return cached.name
        }
      }
    } catch (e) { /* cache miss */ }
  }

  let name = null

  // 1. SignalWire first (live provider; returns caller_id owner name)
  if (SIGNALWIRE_ON && circuitAllows('signalwire')) {
    try {
      name = await lookupSignalwire(clean)
      circuitSuccess('signalwire')
    } catch (e) {
      circuitFailure('signalwire', e)
      log(`[CNAM] SignalWire failed for ${clean}: ${e.message}`)
    }
  }

  // 2. Telnyx (automatic backup if the account recovers)
  if (!name && TELNYX_API_KEY && circuitAllows('telnyx')) {
    try {
      name = await lookupTelnyx(clean)
      circuitSuccess('telnyx')
    } catch (e) {
      circuitFailure('telnyx', e)
      const status = e.response?.status
      const detail = e.response?.data?.errors?.[0]?.detail || e.message
      log(`[CNAM] Telnyx failed for ${clean} (${status || 'network'}): ${detail}`)
    }
  }

  // 3. Multitel (last resort)
  if (!name && MULTITEL_USERNAME && MULTITEL_PASSWORD && circuitAllows('multitel')) {
    try {
      name = await lookupMultitel(clean)
      circuitSuccess('multitel')
    } catch (e) {
      circuitFailure('multitel', e)
      log(`[CNAM] Multitel failed for ${clean}: ${e.message}`)
    }
  }

  // Cache result
  if (_cnamCache && name) {
    try {
      await _cnamCache.updateOne(
        { phone: clean },
        { $set: { phone: clean, name: name, source: name ? 'lookup' : 'miss', updatedAt: new Date().toISOString() } },
        { upsert: true }
      )
    } catch (e) {
      log(`[CNAM] Cache write error: ${e.message}`)
    }
  }

  return name
}

// ── Batch CNAM lookup for multiple numbers ──
async function batchLookupCnam(phoneNumbers) {
  const results = {}
  // Process in parallel, max 5 concurrent
  const chunks = []
  for (let i = 0; i < phoneNumbers.length; i += 5) {
    chunks.push(phoneNumbers.slice(i, i + 5))
  }
  for (const chunk of chunks) {
    const promises = chunk.map(async phone => {
      const name = await lookupCnam(phone)
      results[phone] = name
    })
    await Promise.allSettled(promises)
  }
  return results
}

module.exports = {
  initCnamService,
  lookupCnam,
  batchLookupCnam,
  getCircuitStatus,
}
