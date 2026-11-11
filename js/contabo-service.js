/**
 * contabo-service.js — Contabo API v1 wrapper
 *
 * Handles: OAuth2 auth, products catalog, regions, images,
 *          instance CRUD, secrets (SSH keys), pricing with markup.
 *
 * Replaces the dead Nameword intermediary.
 */

require('dotenv').config()
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')

// ─── Contabo OAuth2 credentials ───────────────────────────────────────────
const AUTH_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token'
const API_BASE = 'https://api.contabo.com/v1'

const CLIENT_ID     = process.env.CONTABO_CLIENT_ID
const CLIENT_SECRET = process.env.CONTABO_CLIENT_SECRET
const API_USER      = process.env.CONTABO_API_USER
const API_PASSWORD  = process.env.CONTABO_API_PASSWORD

const MARKUP_PERCENT = parseFloat(process.env.VPS_MARKUP_PERCENT || '50')

// ─── Windows license costs per tier (real Contabo API prices, USD) ───
// Windows Server 2025 Datacenter pricing varies by VPS tier.
// Source: Contabo /products API — addon "Windows Server 2025 Datacenter"
const WINDOWS_LICENSE_BY_TIER = {
  1: 9.30,   // V91/V92 — Cloud VPS 10 (8 GB)
  2: 19.10,  // V94/V95 — Cloud VPS 20 (12 GB)
  3: 32.00,  // V97/V98 — Cloud VPS 30 (24 GB)
  4: 32.00,  // V100/V101 — Cloud VPS 40 (48 GB)  (estimated, same as tier 3)
  5: 32.00,  // V103/V104 — Cloud VPS 50 (64 GB)
  6: 32.00,  // V106/V107 — Cloud VPS 60 (96 GB)
}

// ─── Token cache ──────────────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 }
let _tokenInflight = null

// ─── Auth circuit breaker (getAccessToken) ────────────────────────────────
// Prod log (48h): keycloak returns `invalid_client` 101× and every downstream
// caller (VPS self-heal, fetchVPSDetails) then logs its own failure — ~200
// noise lines/48h for a credential problem no retry can fix. When auth fails
// we trip this breaker: subsequent getAccessToken() calls fast-fail WITHOUT
// hitting keycloak or logging, until CONTABO_AUTH_COOLDOWN_MIN (default 30m)
// elapses, at which point one probe is allowed through. The reason is logged
// exactly ONCE per open window.
const _authFail = { openUntil: 0, lastError: null, loggedForWindow: false }

function _authCooldownMs() {
  const m = parseInt(process.env.CONTABO_AUTH_COOLDOWN_MIN || '30', 10)
  return (Number.isFinite(m) && m > 0 ? m : 30) * 60 * 1000
}

function _makeAuthError() {
  const e = new Error('VPS provider authentication failed')
  e.code = 'VPS_AUTH_DOWN'
  return e
}

/**
 * Public: is Contabo AUTH currently healthy (or at least not in a known-broken
 * back-off window)? Callers (e.g. the VPS self-heal sweep) use this to skip a
 * whole batch instead of failing per-instance.
 */
function isAuthHealthy() {
  if (Date.now() < _authFail.openUntil) {
    return { healthy: false, reason: 'VPS_AUTH_DOWN', lastError: _authFail.lastError, minutesLeft: Math.ceil((_authFail.openUntil - Date.now()) / 60000) }
  }
  return { healthy: true, reason: null, lastError: null }
}

// ─── Provisioning circuit breaker (createInstance) ────────────────────────
// 2026-06-08: Contabo started returning HTTP 500 in ~3ms on POST /compute/instances
// for our account while every other endpoint (auth, READs, /secrets POST) keeps
// returning 2xx. This is a vendor-side block we cannot fix in code.
//
// To stop the debit→500→refund loop the bot was creating, we trip a circuit
// breaker after 2 consecutive 5xx from createInstance. While the breaker is
// open, createInstance throws a typed `VPS_PROVISIONING_PAUSED` error WITHOUT
// hitting Contabo, and the bot's vps-plan-pay handler checks isProvisioningHealthy()
// before debiting the wallet (so the user is informed and not charged at all).
//
// The breaker auto-probes every PROBE_INTERVAL_MS (a lightweight READ via
// listInstances). When that succeeds we don't auto-close — Contabo could still
// reject CREATE. We only auto-close after a successful createInstance call
// completes naturally (i.e. a real customer purchase succeeds), or via the
// admin reset endpoint /admin/contabo-circuit-reset.
const _circuit = {
  open: false,
  consecutive500: 0,
  openedAt: null,
  lastError: null,
  lastErrorAt: null,
  // How many consecutive 5xx from createInstance trip the breaker
  threshold: 2,
  // Probe interval — used by the bot scheduler to inform admin/users
  probeIntervalMs: 5 * 60 * 1000,
  // Callback fired exactly once when the breaker opens (set from bot init)
  onOpen: null,
}

function _trackCreateResult(ok, err) {
  if (ok) {
    if (_circuit.consecutive500 > 0 || _circuit.open) {
      console.log(`[Contabo] createInstance recovered after ${_circuit.consecutive500} failures — circuit closed`)
    }
    _circuit.consecutive500 = 0
    _circuit.open = false
    _circuit.openedAt = null
    _circuit.lastError = null
    _circuit.lastErrorAt = null
    return
  }
  // Only 5xx counts toward breaker. 4xx are client-side (bad request, quota, etc.)
  // and should not trip the breaker on legitimate edge cases (e.g., invalid image).
  const status = err?.status || err?.response?.status || 0
  if (status >= 500 && status < 600) {
    _circuit.consecutive500 += 1
    _circuit.lastError = err?.message || err?.raw?.message || 'Internal Server Error'
    _circuit.lastErrorAt = new Date()
    if (!_circuit.open && _circuit.consecutive500 >= _circuit.threshold) {
      _circuit.open = true
      _circuit.openedAt = new Date()
      console.error(`[Contabo] 🔌 CIRCUIT OPEN — createInstance failed ${_circuit.consecutive500}× with 5xx. New VPS purchases paused.`)
      try { _circuit.onOpen && _circuit.onOpen(getCircuitState()) } catch (_) { /* onOpen handler failures must not block circuit logic */ }
    }
  } else {
    // 4xx — most are input/product-specific (e.g. invalid image for a product)
    // and should NOT trip the breaker. BUT a *systemic* "no offer / product not
    // orderable" 400 means EVERY purchase of that generation will fail (the
    // account's active offer list doesn't include our catalog's product IDs) —
    // e.g. Contabo: "No offer was found for product ID 'V91' and period '1'".
    // Left unchecked this created a debit→provision-fail→refund loop for the
    // customer on every retry. Treat it like an outage so isProvisioningHealthy()
    // flips false and the bot's pre-flight guard stops charging.  (Added 2026-09.)
    const msg = String(err?.message || err?.raw?.message || '').toLowerCase()
    const systemic = /no offer was found|no offer found|not orderable|product .*not available/.test(msg)
    if (systemic) {
      _circuit.consecutive500 += 1
      _circuit.lastError = err?.message || err?.raw?.message || 'No purchasable offer for product (catalog/account mismatch)'
      _circuit.lastErrorAt = new Date()
      if (!_circuit.open && _circuit.consecutive500 >= _circuit.threshold) {
        _circuit.open = true
        _circuit.openedAt = new Date()
        console.error(`[Contabo] 🔌 CIRCUIT OPEN — createInstance rejected ${_circuit.consecutive500}× with a systemic 400 ("${_circuit.lastError}"). New VPS/RDP purchases paused (customers will NOT be charged).`)
        try { _circuit.onOpen && _circuit.onOpen(getCircuitState()) } catch (_) { /* onOpen handler failures must not block circuit logic */ }
      }
    } else {
      // Genuinely input/product-specific failure — reset the counter.
      _circuit.consecutive500 = 0
    }
  }
}

/**
 * Public: is Contabo CREATE currently healthy enough to accept purchases?
 * Returns { healthy: boolean, reason: string|null, openedAt, lastError }.
 *
 * The bot calls this BEFORE debiting the wallet for a VPS purchase so users
 * are never charged when the vendor is in a known-broken state.
 */
function isProvisioningHealthy() {
  if (!_circuit.open) return { healthy: true, reason: null, openedAt: null, lastError: null }
  return {
    healthy: false,
    reason: 'VPS_PROVISIONING_PAUSED',
    openedAt: _circuit.openedAt,
    lastError: _circuit.lastError,
    minutesOpen: _circuit.openedAt ? Math.round((Date.now() - _circuit.openedAt.getTime()) / 60000) : 0,
  }
}

/** Snapshot of current circuit state — for admin /status views */
function getCircuitState() {
  return {
    open: _circuit.open,
    consecutive500: _circuit.consecutive500,
    openedAt: _circuit.openedAt,
    lastError: _circuit.lastError,
    lastErrorAt: _circuit.lastErrorAt,
    threshold: _circuit.threshold,
  }
}

/** Admin: force-close the breaker after Contabo support confirms fix */
function resetProvisioningCircuit() {
  const wasOpen = _circuit.open
  _circuit.open = false
  _circuit.consecutive500 = 0
  _circuit.openedAt = null
  _circuit.lastError = null
  _circuit.lastErrorAt = null
  console.log(`[Contabo] 🔌 Circuit manually reset (was ${wasOpen ? 'open' : 'closed'})`)
  return { closed: true, wasOpen }
}

/** Register a one-shot "circuit opened" callback (bot uses this to alert admin) */
function onProvisioningCircuitOpen(cb) {
  _circuit.onOpen = cb
}

/**
 * Get a valid OAuth2 access token. Caches & auto-refreshes 60s before expiry.
 * - De-duplicates concurrent refreshes via _tokenInflight to avoid two
 *   callers racing the same keycloak endpoint and invalidating each other.
 * - Retries once on transient `invalid_grant` (Contabo's keycloak
 *   occasionally 401s under load and a 1.5s-later retry succeeds).
 */
async function getAccessToken() {
  const now = Date.now()
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60000) {
    return _tokenCache.token
  }
  // Contabo is not in use right now → fail fast and silently (no keycloak call, no log). CONTABO_ENABLED=true re-enables it.
  if (process.env.CONTABO_ENABLED !== 'true') throw _makeAuthError()
  // Auth breaker open → fast-fail without touching keycloak or logging.
  if (now < _authFail.openUntil) {
    throw _makeAuthError()
  }
  if (_tokenInflight) return _tokenInflight

  _tokenInflight = (async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const params = new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          username:      API_USER,
          password:      API_PASSWORD,
          grant_type:    'password'
        })

        const res = await axios.post(AUTH_URL, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000
        })

        _tokenCache = {
          token:     res.data.access_token,
          expiresAt: Date.now() + (res.data.expires_in * 1000)
        }
        // Recovered — clear any open auth breaker.
        _authFail.openUntil = 0
        _authFail.lastError = null
        _authFail.loggedForWindow = false

        console.log(`[Contabo] Token acquired (attempt ${attempt}), expires in ${res.data.expires_in}s`)
        return _tokenCache.token
      } catch (err) {
        const grantErr = err?.response?.data?.error === 'invalid_grant'
        if (attempt === 2 || !grantErr) {
          // Terminal auth failure — open the breaker and log the reason ONCE
          // per cooldown window (was logging on every single call before).
          const detail = err?.response?.data || err.message
          _authFail.lastError = typeof detail === 'string' ? detail : (detail?.error || 'auth failed')
          const alreadyOpen = Date.now() < _authFail.openUntil
          _authFail.openUntil = Date.now() + _authCooldownMs()
          if (!alreadyOpen || !_authFail.loggedForWindow) {
            _authFail.loggedForWindow = true
            console.error(
              `[Contabo] 🔌 Auth circuit OPEN — token fetch failed:`,
              detail,
              `— suppressing further attempts for ${Math.round(_authCooldownMs() / 60000)}m`
            )
          }
          throw _makeAuthError()
        }
        // Transient invalid_grant — brief backoff before the one retry.
        console.error(`[Contabo] Token fetch failed (attempt ${attempt}): invalid_grant — retrying`)
        await new Promise(r => setTimeout(r, 1500))
      }
    }
  })().finally(() => { _tokenInflight = null })

  return _tokenInflight
}

/**
 * Make an authenticated request to the Contabo API.
 */
async function apiRequest(method, path, data = null, params = null) {
  const token = await getAccessToken()
  const headers = {
    'Authorization': `Bearer ${token}`,
    'x-request-id':  uuidv4(),
  }
  // Only set Content-Type when actually sending a body. Contabo rejects
  // bodyless DELETE/GET requests that still carry `Content-Type: application/json`
  // with 400 "Body cannot be empty when content-type is set to 'application/json'".
  if (data !== null && data !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const config = {
    method,
    url: `${API_BASE}${path}`,
    headers,
    timeout: 30000
  }
  if (data)   config.data   = data
  if (params) config.params = params

  try {
    const res = await axios(config)
    return res.data
  } catch (err) {
    const errData = err?.response?.data || err.message
    const status  = err?.response?.status || 'unknown'
    console.error(`[Contabo] API ${method} ${path} failed (${status}):`, JSON.stringify(errData))
    throw { status, message: errData?.message || errData, raw: errData }
  }
}

// ─── Product Catalog (Contabo current "Core VPS" generation — verified live via
//     GET /v1/products on the production account, 2026-09) ──────────────────────
// Prices are Contabo's current monthly USD prices (no setup fee).
//
// WHY THIS CHANGED (2026-09): the older V91/V92…V107 generation is no longer
// orderable on this account — createInstance returned 400 "No offer was found for
// product ID 'V91' and period '1'", causing every VPS/RDP purchase to fail+refund.
// The account's live catalog is the "Core VPS" line, named by vCPU count:
//   Cloud VPS 4/6/8/12/16/18  →  SSD ids V153-V158,  NVMe ids V165-V170.
// (Confirmed anchor: running instance 203508080 uses productId V153 = 4 vCPU / 8 GB
//  / 100 GB SSD.) NVMe Core exists only for tiers 4→16 (V165-V169) — there is NO
// standalone "Cloud VPS 18 NVMe" offer, so the NVMe list has 5 tiers, SSD has 6.
// NVMe disk = half the SSD capacity (Contabo's standard Core NVMe convention).
// Bot tier labels (Cloud VPS 10/20/…) are kept for branding; specs/ids/prices are
// the real current products underneath.
const PRODUCT_CATALOG = [
  {
    productId:   'V165',   // Contabo "Cloud VPS 4 NVMe"
    name:        'Cloud VPS 10',
    cpuCores:    4,
    ramMb:       8192,
    diskMb:      51200,    // 50 GB NVMe
    diskType:    'nvme',
    bandwidthTb: 32,
    portSpeedMbps: 200,
    basePriceUsd: 7.20,
    tier: 1
  },
  {
    productId:   'V166',   // Contabo "Cloud VPS 6 NVMe"
    name:        'Cloud VPS 20',
    cpuCores:    6,
    ramMb:       12288,
    diskMb:      102400,   // 100 GB NVMe
    diskType:    'nvme',
    bandwidthTb: 32,
    portSpeedMbps: 300,
    basePriceUsd: 9.90,
    tier: 2
  },
  {
    productId:   'V167',   // Contabo "Cloud VPS 8 NVMe"
    name:        'Cloud VPS 30',
    cpuCores:    8,
    ramMb:       24576,
    diskMb:      153600,   // 150 GB NVMe
    diskType:    'nvme',
    bandwidthTb: 32,
    portSpeedMbps: 600,
    basePriceUsd: 18.50,
    tier: 3
  },
  {
    productId:   'V168',   // Contabo "Cloud VPS 12 NVMe"
    name:        'Cloud VPS 40',
    cpuCores:    12,
    ramMb:       49152,
    diskMb:      204800,   // 200 GB NVMe
    diskType:    'nvme',
    bandwidthTb: 32,
    portSpeedMbps: 800,
    basePriceUsd: 33.00,
    tier: 4
  },
  {
    productId:   'V169',   // Contabo "Cloud VPS 16 NVMe"
    name:        'Cloud VPS 50',
    cpuCores:    16,
    ramMb:       65536,
    diskMb:      256000,   // 250 GB NVMe
    diskType:    'nvme',
    bandwidthTb: 32,
    portSpeedMbps: 1000,
    basePriceUsd: 49.00,
    tier: 5
  }
]

// SSD variants — the full 6-tier Core line (Cloud VPS 4→18 = V153→V158).
// Contabo Core defaults to SSD; disk sizes are Contabo's official Core specs.
const PRODUCT_CATALOG_SSD = [
  { productId: 'V153', name: 'Cloud VPS 10 SSD', cpuCores: 4,  ramMb: 8192,  diskMb: 102400, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 200,  basePriceUsd: 6.60,  tier: 1 },
  { productId: 'V154', name: 'Cloud VPS 20 SSD', cpuCores: 6,  ramMb: 12288, diskMb: 204800, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 300,  basePriceUsd: 9.00,  tier: 2 },
  { productId: 'V155', name: 'Cloud VPS 30 SSD', cpuCores: 8,  ramMb: 24576, diskMb: 307200, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 600,  basePriceUsd: 16.80, tier: 3 },
  { productId: 'V156', name: 'Cloud VPS 40 SSD', cpuCores: 12, ramMb: 49152, diskMb: 409600, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 800,  basePriceUsd: 30.00, tier: 4 },
  { productId: 'V157', name: 'Cloud VPS 50 SSD', cpuCores: 16, ramMb: 65536, diskMb: 512000, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 1000, basePriceUsd: 44.50, tier: 5 },
  { productId: 'V158', name: 'Cloud VPS 60 SSD', cpuCores: 18, ramMb: 98304, diskMb: 614400, diskType: 'ssd', bandwidthTb: 32, portSpeedMbps: 1000, basePriceUsd: 58.80, tier: 6 }
]

// Region surcharges (monthly USD) — from Contabo /v1/products API (April 2026)
// Per-tier surcharges — null = region not available for that tier
const REGION_SURCHARGE = {
  //                    tier1   tier2   tier3   tier4   tier5   tier6
  'EU':         [      0,      0,      0,      0,      0,      0     ],
  'US-central': [   1.20,   0.45,   0.92,   2.60,   4.80,   7.62   ],
  'US-east':    [   1.80,   2.80,   5.50,   9.70,  14.30,  18.90   ],
  'US-west':    [   1.50,   2.30,   4.50,   8.10,  11.90,  15.80   ],
  'UK':         [   1.20,   0.45,   0.92,   2.60,   4.80,   7.62   ],
  // Region slugs MUST match Contabo's /data-centers regionSlug values exactly,
  // otherwise createInstance throws "Entry Region not found by region = X".
  // Contabo uses SIN/JPN/AUS/IND (NOT SG/JP/AU/IN). Fixed 2026-09 after a
  // customer's Australia order failed with "Region not found by region = AU".
  'SIN':        [   2.90,   2.20,   4.40,   9.42,  16.24,  24.56   ],
  'JPN':        [   2.90,   2.25,   4.50,   9.60,  16.59,  25.12   ],
  'AUS':        [   2.40,   1.85,   3.75,   7.98,  13.79,  20.88   ],
  'IND':        [   2.70,   2.10,   4.15,   8.82,  15.26,  23.04   ]
}

const REGION_DISPLAY = {
  'EU':         { emoji: '🇪🇺', label: 'Europe (EU)' },
  'US-central': { emoji: '🇺🇸', label: 'US Central' },
  'US-east':    { emoji: '🇺🇸', label: 'US East' },
  'US-west':    { emoji: '🇺🇸', label: 'US West' },
  'UK':         { emoji: '🇬🇧', label: 'United Kingdom' },
  'SIN':        { emoji: '🇸🇬', label: 'Singapore' },
  'JPN':        { emoji: '🇯🇵', label: 'Japan' },
  'AUS':        { emoji: '🇦🇺', label: 'Australia' },
  'IND':        { emoji: '🇮🇳', label: 'India' }
}

// ─── Pricing ──────────────────────────────────────────────────────────────

/**
 * Apply markup % to a base price. Returns number rounded to 2 decimals.
 */
function applyMarkup(basePrice) {
  return Math.round(basePrice * (1 + MARKUP_PERCENT / 100) * 100) / 100
}

/**
 * Calculate total monthly price for a plan + region + optional Windows license.
 * Returns { basePrice, regionSurcharge, windowsLicense, totalBeforeMarkup, totalWithMarkup }
 */
function calculatePrice(product, regionSlug, isWindows = false) {
  const base          = product.basePriceUsd
  const tier          = product.tier || 1
  const surchargeArr  = REGION_SURCHARGE[regionSlug]
  const surcharge     = surchargeArr ? (surchargeArr[tier - 1] ?? null) : 0
  if (surcharge === null) return null  // Region not available for this tier
  const windowsFee    = isWindows ? (WINDOWS_LICENSE_BY_TIER[tier] || WINDOWS_LICENSE_BY_TIER[2]) : 0
  const totalBefore   = base + surcharge + windowsFee
  const totalMarkedUp = applyMarkup(totalBefore)

  return {
    basePriceUsd:       base,
    regionSurcharge:    surcharge,
    windowsLicense:     windowsFee,
    totalBeforeMarkup:  Math.round(totalBefore * 100) / 100,
    totalWithMarkup:    totalMarkedUp,
    markupPercent:      MARKUP_PERCENT
  }
}

// ─── Products ─────────────────────────────────────────────────────────────

/**
 * List available VPS products with pricing for a given region.
 * @param {string} regionSlug - e.g. 'EU', 'US-east'
 * @param {boolean} isWindows - true = RDP, adds Windows license fee
 * @param {string} diskPreference - 'nvme' or 'ssd'
 */
function listProducts(regionSlug = 'EU', isWindows = false, diskPreference = 'nvme') {
  const catalog = diskPreference === 'ssd' ? PRODUCT_CATALOG_SSD : PRODUCT_CATALOG
  return catalog
    .map(p => {
      const pricing = calculatePrice(p, regionSlug, isWindows)
      if (!pricing) return null  // Region not available for this tier
      return {
        ...p,
        ramGb:     Math.round(p.ramMb / 1024),
        diskGb:    Math.round(p.diskMb / 1024),
        pricing
      }
    })
    .filter(Boolean)
}

/**
 * Get a single product by productId.
 */
function getProduct(productId) {
  return PRODUCT_CATALOG.find(p => p.productId === productId) ||
         PRODUCT_CATALOG_SSD.find(p => p.productId === productId) || null
}

/**
 * NVMe ↔ SSD product fallback mapping (Contabo current "Core VPS" generation).
 * Each Cloud VPS tier has an SSD id (V153-V158) and, for tiers 1-5, an NVMe id
 * (V165-V169). Tier 6 (Cloud VPS 18 / V158) is SSD-only — Contabo has no NVMe
 * offer for it — so it has no NVMe fallback (returns null → stays SSD).
 * Updated 2026-09 (was the deprecated V91-V107 generation).
 */
const NVME_TO_SSD_FALLBACK = { V165: 'V153', V166: 'V154', V167: 'V155', V168: 'V156', V169: 'V157' }
const SSD_TO_NVME_FALLBACK = { V153: 'V165', V154: 'V166', V155: 'V167', V156: 'V168', V157: 'V169' }

function getProductFallback(productId) {
  return NVME_TO_SSD_FALLBACK[productId] || SSD_TO_NVME_FALLBACK[productId] || null
}

// ─── Regions ──────────────────────────────────────────────────────────────

/**
 * List available regions with surcharges. Fetches from API and enriches with local data.
 */
async function listRegions() {
  try {
    // Fetch live data centers from Contabo
    const page1 = await apiRequest('GET', '/data-centers', null, { size: 50 })
    const dataCenters = page1.data || []

    // Group by region slug and deduplicate
    const regionMap = {}
    for (const dc of dataCenters) {
      if (!dc.capabilities.includes('VPS')) continue
      const slug = dc.regionSlug
      if (!regionMap[slug]) {
        regionMap[slug] = {
          regionSlug:  slug,
          regionName:  dc.regionName,
          dataCenters: [],
          surchargeUsd: REGION_SURCHARGE[slug] || [0,0,0,0,0,0],
          display: REGION_DISPLAY[slug] || { emoji: '🌍', label: dc.regionName }
        }
      }
      regionMap[slug].dataCenters.push({ name: dc.name, slug: dc.slug })
    }

    return Object.values(regionMap)
  } catch (err) {
    console.error('[Contabo] listRegions failed, using fallback:', err.message || err)
    // Fallback to hardcoded regions
    return Object.entries(REGION_DISPLAY).map(([slug, disp]) => ({
      regionSlug:   slug,
      regionName:   disp.label,
      dataCenters:  [],
      surchargeUsd: REGION_SURCHARGE[slug] || 0,
      display:      disp
    }))
  }
}

// ─── Images ───────────────────────────────────────────────────────────────

// ── Windows image edition rules ──
// As of 2026-02 (incident @davion419/V94 + Contabo POST cred rotation),
// Contabo rejects Standard Edition (SE) Windows images on BOTH V94 (NVMe)
// AND V95 (SSD) with `cannot use this image with selected product`. Only
// Datacenter Edition (DE) is accepted on tier-2 products.
//
// Probe matrix run 2026-02 against US-west:
//   V94 + 2025-se: ✗ rejected     V94 + 2025-de: ✓ accepted
//   V94 + 2022-se: ✗ rejected     V94 + 2022-de: ✓ accepted
//   V95 + 2025-se: ✗ rejected     V95 + 2025-de: ✓ accepted
//   V95 + 2022-se: ✗ rejected     V95 + 2022-de: ✓ accepted
//
// Until we can probe the other tiers (V91/V97/V100/V103/V106 NVMe and
// V92/V98/V101/V104/V107 SSD), we default to **DE for everything** — DE
// images are accepted on every product we've ever seen, while SE has
// product-specific restrictions. This is the same convention as the old
// "DEFAULT_WINDOWS_IMAGE = DEFAULT_WINDOWS_IMAGE_SSD" fallback that was
// already labelled "safe for both when NVMe is unavailable".
//
// The NVME_PRODUCT_IDS / SSD_PRODUCT_IDS sets are kept because other
// fallback logic (NVMe↔SSD product downgrade) still depends on them.
// Updated 2026-09 to the current Core VPS generation (SSD V153-V158,
// NVMe V165-V169; Cloud VPS 18 / V158 is SSD-only — no NVMe variant).
const NVME_PRODUCT_IDS = new Set(['V165', 'V166', 'V167', 'V168', 'V169'])
const SSD_PRODUCT_IDS  = new Set(['V153', 'V154', 'V155', 'V156', 'V157', 'V158'])

function isNVMeProduct(productId) { return NVME_PRODUCT_IDS.has(productId) }
function isSSDProduct(productId)  { return SSD_PRODUCT_IDS.has(productId) }

// Preferred Windows image — DE works on all currently-tested products
const DEFAULT_WINDOWS_IMAGE_DE = 'windows-server-2025-de'
const DEFAULT_WINDOWS_IMAGE    = DEFAULT_WINDOWS_IMAGE_DE

/**
 * List available OS images from Contabo API.
 * @param {string} filter - 'all', 'linux', 'windows', 'rdp'
 */
async function listImages(filter = 'all') {
  const res = await apiRequest('GET', '/compute/images', null, { size: 100 })
  let images = (res.data || [])

  // Filter out Plesk/cPanel variants for cleaner display (unless showing all)
  if (filter !== 'all') {
    images = images.filter(img => !img.name.includes('plesk') && !img.name.includes('cpanel'))
  }

  if (filter === 'linux') {
    images = images.filter(img => img.osType === 'Linux')
  } else if (filter === 'windows' || filter === 'rdp') {
    images = images.filter(img => img.osType === 'Windows')
  }

  return images.map(img => ({
    imageId:   img.imageId,
    name:      img.name,
    osType:    img.osType,
    version:   img.version,
    isWindows: img.osType === 'Windows'
  }))
}

/**
 * Get the default Windows image ID for RDP deployments.
 * @param {string} [productId] - Product ID (informational only — see comment
 *   on DEFAULT_WINDOWS_IMAGE_DE: Contabo currently rejects SE on tier-2
 *   products, so we always select DE.)
 */
async function getDefaultWindowsImageId(productId) {
  const images = await listImages('windows')
  const preferredName = DEFAULT_WINDOWS_IMAGE_DE

  console.log(`[Contabo] Selecting Windows image: product=${productId || 'unknown'}, edition=de, preferred=${preferredName}`)

  // Prefer the exact preferred image
  const preferred = images.find(img => img.name === preferredName)
  if (preferred) return preferred.imageId

  // Fallback: older DE images, then any non-plesk
  const fallback = images.find(img => img.name.includes('2025') && img.name.endsWith('-de')) ||
                   images.find(img => img.name.includes('2022') && img.name.endsWith('-de')) ||
                   images.find(img => img.name.includes('2019') && img.name.endsWith('-de')) ||
                   images.find(img => img.name.includes('2025') && !img.name.includes('plesk')) ||
                   images.find(img => img.name.includes('2022') && !img.name.includes('plesk')) ||
                   images[0]
  return fallback ? fallback.imageId : null
}

/**
 * Swap a Windows image when falling back between products.
 *
 * As of 2026-02 (see comment on DEFAULT_WINDOWS_IMAGE_DE), Contabo rejects
 * SE on V94/V95. We always target DE — both for the originally-selected
 * product and any fallback product. The function then walks down older
 * Windows years (2025 → 2022 → 2019 → 2016) until it finds an accepted
 * image.
 *
 * @param {string} imageId - Current image ID (only used for logging)
 * @param {string} targetProductId - The fallback product we're switching to
 * @returns {Promise<string>} - Compatible image ID for the target product
 */
async function getCompatibleWindowsImage(imageId, targetProductId) {
  const images = await listImages('windows')
  const currentImage = images.find(img => img.imageId === imageId)
  const currentName = currentImage?.name || imageId

  // Always target DE — SE is rejected on tier-2 products and DE is broadly
  // accepted. If the current image is already a DE in a different year, try
  // older DE images first; otherwise, swap straight to DE of the same year
  // before walking down.
  const yearOrder = ['2025', '2022', '2019', '2016']
  const currentYear = yearOrder.find(y => currentName.includes(y))

  // Reorder candidates: start from current year (if known), then walk down
  const candidates = currentYear
    ? [currentYear, ...yearOrder.filter(y => y !== currentYear)]
    : yearOrder

  for (const year of candidates) {
    const targetName = `windows-server-${year}-de`
    const candidate = images.find(img => img.name === targetName)
    if (candidate) {
      if (currentName !== targetName) {
        console.log(`[Contabo] Swapped Windows image: ${currentName} → ${targetName} for product ${targetProductId}`)
      }
      return candidate.imageId
    }
  }

  // Final fallback: get default for the target product type
  return await getDefaultWindowsImageId(targetProductId)
}

/**
 * Get a compatible Linux image for a given product.
 * Tries: Ubuntu 24.04 → Ubuntu 22.04 → Debian 13 → Debian 12 → any available Linux.
 * @param {string} currentImageId - The image that failed
 * @param {string} [productId] - Target product ID (for logging)
 * @returns {Promise<string|null>} - Compatible Linux image ID, or null
 */
async function getCompatibleLinuxImage(currentImageId, productId) {
  const images = await listImages('linux')
  // Preference order: stable Ubuntu LTS → Debian stable → anything
  const preferred = [
    'ubuntu-24.04',
    'ubuntu-22.04',
    'debian-13',
    'debian-12',
    'ubuntu-26.04',
    'almalinux-9',
    'rockylinux-9',
  ]
  for (const name of preferred) {
    const img = images.find(i => i.name === name && i.imageId !== currentImageId)
    if (img) {
      console.log(`[Contabo] Compatible Linux image: ${name} (${img.imageId}) for product ${productId || 'unknown'}`)
      return img.imageId
    }
  }
  // Last resort: any Linux image that isn't the broken one
  const any = images.find(i => i.imageId !== currentImageId)
  if (any) {
    console.log(`[Contabo] Fallback Linux image: ${any.name} (${any.imageId})`)
    return any.imageId
  }
  return null
}

// ─── Secrets (SSH Keys & Passwords) ───────────────────────────────────────

/**
 * Create a secret (SSH public key or password).
 * @param {string} name - Secret name
 * @param {string} value - SSH public key string or password
 * @param {string} type - 'ssh' or 'password'
 */
async function createSecret(name, value, type = 'ssh') {
  // Fix #6: Guard against empty/short values that Contabo rejects
  if (!value || (type === 'password' && value.length < 8)) {
    throw new Error(`Secret value too short (${value?.length || 0} chars, min 8 for passwords)`)
  }
  const res = await apiRequest('POST', '/secrets', { name, value, type })
  return res.data?.[0] || res.data
}

/**
 * List all secrets, optionally filtered by type.
 */
async function listSecrets(type = null) {
  const res = await apiRequest('GET', '/secrets', null, { size: 100 })
  let secrets = res.data || []
  if (type) secrets = secrets.filter(s => s.type === type)
  return secrets
}

/**
 * Get a single secret by ID.
 */
async function getSecret(secretId) {
  const res = await apiRequest('GET', `/secrets/${secretId}`)
  return res.data?.[0] || res.data
}

/**
 * Delete a secret by ID.
 */
async function deleteSecret(secretId) {
  await apiRequest('DELETE', `/secrets/${secretId}`)
  return true
}

// ─── Instances ────────────────────────────────────────────────────────────

/**
 * Create a new VPS instance.
 * @param {Object} opts
 * @param {string} opts.productId   - e.g. 'V91' (NVMe) or 'V92' (SSD)
 * @param {string} opts.region      - e.g. 'EU', 'US-east'
 * @param {string} opts.imageId     - OS image UUID
 * @param {string} [opts.displayName] - Friendly name
 * @param {number[]} [opts.sshKeys]   - Array of secret IDs for SSH keys
 * @param {number} [opts.rootPassword] - Secret ID for root password
 * @param {string} [opts.userData]   - cloud-init user data
 * @param {number} [opts.period]     - Billing period in months (1=monthly)
 */
async function createInstance(opts) {
  // Pre-flight: if the breaker is open, refuse without making the HTTP call.
  // The bot is expected to check isProvisioningHealthy() BEFORE debiting,
  // so this throw is the last-line defense for code paths that bypass that
  // (admin tools, retries, race conditions during a probe).
  if (_circuit.open) {
    const minutes = _circuit.openedAt ? Math.round((Date.now() - _circuit.openedAt.getTime()) / 60000) : 0
    const err = new Error(`VPS_PROVISIONING_PAUSED: vendor returning 5xx — paused ${minutes}m ago. Last error: ${_circuit.lastError || 'unknown'}`)
    err.code = 'VPS_PROVISIONING_PAUSED'
    err.circuit = getCircuitState()
    throw err
  }

  const body = {
    imageId:   opts.imageId,
    productId: opts.productId,
    region:    opts.region,
    period:    opts.period || 1  // monthly billing
  }

  if (opts.displayName)  body.displayName = opts.displayName
  if (opts.sshKeys?.length) body.sshKeys  = opts.sshKeys
  if (opts.rootPassword) body.rootPassword = opts.rootPassword
  if (opts.userData)     body.userData     = opts.userData

  console.log(`[Contabo] Creating instance: productId=${opts.productId}, region=${opts.region}, image=${opts.imageId}`)
  try {
    const res = await apiRequest('POST', '/compute/instances', body)
    const instance = res.data?.[0] || res.data
    console.log(`[Contabo] Instance created: id=${instance?.instanceId}, name=${instance?.name}`)
    instance._actualProductId = body.productId
    instance._actualImageId = body.imageId
    _trackCreateResult(true)
    return instance
  } catch (err) {
    // Fix #4: If product is unavailable, try the fallback (NVMe ↔ SSD)
    const errMsg = err.message || ''
    if (errMsg.includes('is not available') || errMsg.includes('Product')) {
      const fallbackId = getProductFallback(opts.productId)
      if (fallbackId) {
        console.log(`[Contabo] Product ${opts.productId} unavailable — trying fallback ${fallbackId}`)
        body.productId = fallbackId
        // Fix #7: When switching NVMe↔SSD, also swap Windows image edition (SE↔DE)
        if (opts.imageId) {
          try {
            const compatImage = await getCompatibleWindowsImage(opts.imageId, fallbackId)
            if (compatImage && compatImage !== opts.imageId) {
              console.log(`[Contabo] Also swapping image for fallback: ${opts.imageId} → ${compatImage}`)
              body.imageId = compatImage
            }
          } catch (imgErr) {
            console.log(`[Contabo] Image swap failed, keeping original: ${imgErr.message}`)
          }
        }
        try {
          const res = await apiRequest('POST', '/compute/instances', body)
          const instance = res.data?.[0] || res.data
          console.log(`[Contabo] Instance created via fallback: id=${instance?.instanceId}, product=${fallbackId}`)
          instance._actualProductId = body.productId
          instance._actualImageId = body.imageId
          _trackCreateResult(true)
          return instance
        } catch (fallbackErr) {
          console.log(`[Contabo] Product fallback also failed: ${fallbackErr.message}`)
          // fall through to outer rethrow with original error tracking
        }
      }
    }
    // Fix #7b: If image is incompatible with product, try compatible image
    if (errMsg.includes('cannot use this image') || errMsg.includes('image')) {
      console.log(`[Contabo] Image incompatible — trying compatible image for product ${body.productId}`)
      
      // Detect if this is a Linux or Windows image to use the right fallback
      const isWindowsImage = await (async () => {
        try {
          const winImages = await listImages('windows')
          return winImages.some(i => i.imageId === opts.imageId)
        } catch { return false }
      })()
      
      try {
        let compatImage
        if (isWindowsImage) {
          compatImage = await getCompatibleWindowsImage(opts.imageId, body.productId)
        } else {
          compatImage = await getCompatibleLinuxImage(opts.imageId, body.productId)
        }
        if (compatImage && compatImage !== body.imageId) {
          console.log(`[Contabo] Retrying with compatible image: ${body.imageId} → ${compatImage}`)
          body.imageId = compatImage
          const res = await apiRequest('POST', '/compute/instances', body)
          const instance = res.data?.[0] || res.data
          console.log(`[Contabo] Instance created with compatible image: id=${instance?.instanceId}`)
          instance._actualProductId = body.productId
          instance._actualImageId = body.imageId
          _trackCreateResult(true)
          return instance
        }
      } catch (imgErr) {
        console.log(`[Contabo] Compatible image retry also failed: ${imgErr.message}`)
      }
      // Fix #7c: If ALL images fail on this product, try NVMe↔SSD product fallback with correct image
      const fallbackId = getProductFallback(opts.productId)
      if (fallbackId) {
        console.log(`[Contabo] All images rejected on ${body.productId} — trying product fallback ${fallbackId}`)
        body.productId = fallbackId
        try {
          let fallbackImage
          if (isWindowsImage) {
            fallbackImage = await getCompatibleWindowsImage(opts.imageId, fallbackId)
          } else {
            fallbackImage = await getCompatibleLinuxImage(opts.imageId, fallbackId)
          }
          if (fallbackImage) body.imageId = fallbackImage
          console.log(`[Contabo] Retrying with product=${fallbackId}, image=${body.imageId}`)
          const res = await apiRequest('POST', '/compute/instances', body)
          const instance = res.data?.[0] || res.data
          console.log(`[Contabo] Instance created via product+image fallback: id=${instance?.instanceId}, product=${fallbackId}`)
          instance._actualProductId = body.productId
          instance._actualImageId = body.imageId
          _trackCreateResult(true)
          return instance
        } catch (fallbackErr) {
          console.log(`[Contabo] Product+image fallback also failed: ${fallbackErr.message}`)
        }
      }
    }
    _trackCreateResult(false, err)
    throw err // Re-throw if no fallback available or fallback also failed
  }
}

/**
 * Get instance details by ID.
 */
async function getInstance(instanceId) {
  const res = await apiRequest('GET', `/compute/instances/${instanceId}`)
  return res.data?.[0] || res.data
}

/**
 * List all instances on the account.
 * @param {Object} [filters] - Optional filters like { status, name, region }
 */
async function listInstances(filters = {}) {
  const params = { size: 100, ...filters }
  const res = await apiRequest('GET', '/compute/instances', null, params)
  return res.data || []
}

/**
 * Start an instance.
 */
async function startInstance(instanceId) {
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/actions/start`, {})
  return res.data?.[0] || res.data
}

/**
 * Stop an instance.
 */
async function stopInstance(instanceId) {
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/actions/stop`, {})
  return res.data?.[0] || res.data
}

/**
 * Restart an instance.
 */
async function restartInstance(instanceId) {
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/actions/restart`, {})
  return res.data?.[0] || res.data
}

/**
 * Shutdown an instance gracefully.
 */
async function shutdownInstance(instanceId) {
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/actions/shutdown`, {})
  return res.data?.[0] || res.data
}

/**
 * Reset the root/admin password for an instance.
 * Creates a password secret and applies it.
 * For Linux instances with non-root defaultUser (e.g., Ubuntu 24.04 'admin'),
 * this reinstalls the OS with the new password + cloud-init to ensure both
 * root and admin have the same working password.
 * For Windows instances, ALWAYS uses the standard resetPassword API — never
 * a reinstall — because the Linux bash cloud-init below is incompatible and
 * Contabo coerces the imageId to Ubuntu when bash userData is supplied,
 * silently turning a Windows box into Linux.
 * Returns the new password.
 */
async function resetPassword(instanceId, opts = {}) {
  const crypto = require('crypto')
  const newPassword = crypto.randomBytes(16).toString('base64url').slice(0, 20)

  // Create a secret for the password
  const secret = await createSecret(`pwd-${instanceId}-${Date.now()}`, newPassword, 'password')
  const secretId = secret.secretId

  // Decide reinstall vs. plain reset.
  // Reinstall path is LINUX-ONLY (bash cloud-init). For Windows, ALWAYS use the
  // plain resetPassword endpoint — even when defaultUser is 'admin' — otherwise
  // the OS gets coerced to Ubuntu (see contabo-service bug fixed 2026-04-25).
  const isWindows = opts.osType === 'Windows' || opts.isRDP === true
  const needsReinstall = !isWindows && opts.defaultUser && opts.defaultUser !== 'root'

  if (needsReinstall) {
    console.log(`[Contabo] Instance ${instanceId} has defaultUser=${opts.defaultUser} (Linux) — using reinstall with cloud-init`)

    // Cloud-init script to unlock root and sync password
    const cloudInitScript = [
      '#!/bin/bash',
      '# Nomadly password reset — enable password auth + unlock root',
      'sed -i "s/^#*PasswordAuthentication.*/PasswordAuthentication yes/" /etc/ssh/sshd_config',
      'sed -i "s/^#*PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config',
      '# Ensure settings exist even if sed missed commented lines',
      'grep -q "^PermitRootLogin yes" /etc/ssh/sshd_config || echo "PermitRootLogin yes" >> /etc/ssh/sshd_config',
      'grep -q "^PasswordAuthentication yes" /etc/ssh/sshd_config || echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config',
      '# Fix ALL drop-in configs (60-cloudimg-settings.conf often overrides)',
      'for f in /etc/ssh/sshd_config.d/*.conf; do',
      '  [ -f "$f" ] && sed -i "s/^PasswordAuthentication no/PasswordAuthentication yes/" "$f"',
      '  [ -f "$f" ] && sed -i "s/^PermitRootLogin prohibit-password/PermitRootLogin yes/" "$f"',
      '  [ -f "$f" ] && sed -i "s/^PermitRootLogin no/PermitRootLogin yes/" "$f"',
      'done',
      'passwd -u root 2>/dev/null',
      '# Bi-directional password sync: ensure BOTH root and default user can login',
      'ROOT_HASH=$(getent shadow root | cut -d: -f2)',
      'DEFAULT_USER=$(grep -E "^[^:]+:\\$" /etc/shadow | grep -v "root\\|nobody\\|systemd" | head -1 | cut -d: -f1)',
      'ROOT_VALID=false',
      'case "$ROOT_HASH" in "!"*|"*"|""|"!") ;; *"$"*) ROOT_VALID=true ;; esac',
      'if [ "$ROOT_VALID" = "true" ]; then',
      '  # Root has valid hash — copy root hash to default user',
      '  if [ -n "$DEFAULT_USER" ] && [ "$DEFAULT_USER" != "root" ]; then',
      '    usermod -p "$ROOT_HASH" "$DEFAULT_USER" 2>/dev/null',
      '  fi',
      'elif [ -n "$DEFAULT_USER" ] && [ "$DEFAULT_USER" != "root" ]; then',
      '  # Root is locked but default user has valid hash — copy default user hash to root',
      '  DEF_HASH=$(getent shadow "$DEFAULT_USER" | cut -d: -f2)',
      '  case "$DEF_HASH" in *"$"*)',
      '    usermod -p "$DEF_HASH" root 2>/dev/null',
      '    passwd -u root 2>/dev/null',
      '  ;; esac',
      'fi',
      'systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null',
    ].join('\n')
    const userData = Buffer.from(cloudInitScript).toString('base64')

    const imageId = opts.imageId || 'd64d5c6c-9dda-4e38-8174-0ee282474d8a' // default Ubuntu 24.04
    const res = await apiRequest('PUT', `/compute/instances/${instanceId}`, {
      imageId,
      rootPassword: secretId,
      sshKeys: [],
      userData
    })
    return { password: newPassword, secretId, response: res.data?.[0] || res.data, reinstalled: true }
  }

  // Standard root/admin password reset (works for Linux root + ALL Windows instances)
  console.log(`[Contabo] Instance ${instanceId} (osType=${opts.osType || 'unknown'}, defaultUser=${opts.defaultUser || 'root'}) — using standard resetPassword (no reinstall)`)
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/actions/resetPassword`, {
    sshKeys: [],
    rootPassword: secretId
  })

  return { password: newPassword, secretId, response: res.data?.[0] || res.data }
}

/**
 * Reinstall an instance with a new OS image.
 * Note: Contabo rejects `sshKeys` (even empty []) for Windows images with
 * "Bad Request Cloud Init for Windows is not supporting SSH Keys", so we only
 * include sshKeys when the array has at least one entry.
 */
async function reinstallInstance(instanceId, opts = {}) {
  const body = {}
  if (opts.imageId)      body.imageId      = opts.imageId
  if (Array.isArray(opts.sshKeys) && opts.sshKeys.length > 0) body.sshKeys = opts.sshKeys
  if (opts.rootPassword) body.rootPassword  = opts.rootPassword
  if (opts.userData)     body.userData      = opts.userData

  const res = await apiRequest('PUT', `/compute/instances/${instanceId}`, body)
  return res.data?.[0] || res.data
}

/**
 * Cancel (terminate) an instance.
 * Contabo REJECTS POST bodies that are null/empty when Content-Type is
 * application/json, so we must always send at least `{}`. Without this
 * every cancel call returns 400 "Body cannot be empty" and the instance
 * keeps billing silently — which is the exact bug that leaked €30+/mo.
 */
async function cancelInstance(instanceId) {
  console.log(`[Contabo] Cancelling instance ${instanceId}`)
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/cancel`, {})
  console.log(`[Contabo] Instance ${instanceId} cancelled`)
  return res.data?.[0] || res.data
}

/**
 * Upgrade an instance to a higher plan.
 * Contabo API supports in-place upgrades!
 */
async function upgradeInstance(instanceId, newProductId) {
  console.log(`[Contabo] Upgrading instance ${instanceId} to ${newProductId}`)
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/upgrade`, {
    productId: newProductId
  })
  console.log(`[Contabo] Instance ${instanceId} upgraded to ${newProductId}`)
  return res.data?.[0] || res.data
}

/**
 * Update instance display name.
 */
async function updateInstanceName(instanceId, displayName) {
  const res = await apiRequest('PATCH', `/compute/instances/${instanceId}`, { displayName })
  return res.data?.[0] || res.data
}

// ─── Snapshots ────────────────────────────────────────────────────────────

async function createSnapshot(instanceId, name, description = '') {
  const res = await apiRequest('POST', `/compute/instances/${instanceId}/snapshots`, {
    name, description
  })
  return res.data?.[0] || res.data
}

async function listSnapshots(instanceId) {
  const res = await apiRequest('GET', `/compute/instances/${instanceId}/snapshots`)
  return res.data || []
}

async function deleteSnapshot(instanceId, snapshotId) {
  await apiRequest('DELETE', `/compute/instances/${instanceId}/snapshots/${snapshotId}`)
  return true
}

// ─── Tags (for user-instance mapping) ─────────────────────────────────────

async function createTag(name, color = '#0d6efd') {
  const res = await apiRequest('POST', '/tags', { name, color })
  return res.data?.[0] || res.data
}

async function listTags() {
  const res = await apiRequest('GET', '/tags', null, { size: 100 })
  return res.data || []
}

async function deleteTag(tagId) {
  await apiRequest('DELETE', `/tags/${tagId}`)
  return true
}

// ─── Utility / Formatting ─────────────────────────────────────────────────

/**
 * Format instance data for display in Telegram bot.
 */
function formatInstanceForDisplay(instance) {
  const ip      = instance.ipConfig?.v4?.ip || 'Provisioning...'
  const ipv6    = instance.ipConfig?.v6?.ip || ''
  const product = getProduct(instance.productId)
  const ramGb   = Math.round((instance.ramMb || 0) / 1024)
  const diskGb  = Math.round((instance.diskMb || 0) / 1024)
  const statusEmoji = {
    running:      '🟢',
    stopped:      '🔴',
    provisioning: '🟡',
    installing:   '🟡',
    error:        '❌',
    unknown:      '⚪'
  }

  return {
    instanceId:   instance.instanceId,
    name:         instance.displayName || instance.name,
    status:       instance.status,
    statusEmoji:  statusEmoji[instance.status] || '⚪',
    ip,
    ipv6,
    region:       instance.region,
    regionName:   instance.regionName || REGION_DISPLAY[instance.region]?.label || instance.region,
    productId:    instance.productId,
    productName:  product?.name || instance.productName || instance.productId,
    cpuCores:     instance.cpuCores,
    ramGb,
    diskGb,
    osType:       instance.osType,
    isWindows:    instance.osType === 'Windows',
    createdDate:  instance.createdDate,
    cancelDate:   instance.cancelDate,
    defaultUser:  instance.defaultUser || (instance.osType === 'Windows' ? 'Administrator' : 'root')
  }
}

/**
 * Format specs for display message.
 */
function formatSpecs(product) {
  const ramGb  = Math.round(product.ramMb / 1024)
  const diskGb = Math.round(product.diskMb / 1024)
  return `${product.cpuCores} vCPU | ${ramGb} GB RAM | ${diskGb} GB ${product.diskType?.toUpperCase() || 'NVMe'}`
}

/**
 * Quick health check — verifies token + lists instances.
 */
async function healthCheck() {
  try {
    await getAccessToken()
    const instances = await listInstances()
    return {
      ok: true,
      message: 'VPS API connected',
      instanceCount: instances.length,
      tokenValid: true
    }
  } catch (err) {
    return { ok: false, message: err.message || 'VPS API connection failed', tokenValid: false }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────
module.exports = {
  // Auth
  getAccessToken,

  // Products & Pricing
  listProducts,
  getProduct,
  getProductFallback,
  calculatePrice,
  applyMarkup,
  PRODUCT_CATALOG,
  PRODUCT_CATALOG_SSD,
  REGION_SURCHARGE,
  REGION_DISPLAY,
  MARKUP_PERCENT,
  WINDOWS_LICENSE_BY_TIER,

  // Regions
  listRegions,

  // Images
  listImages,
  getDefaultWindowsImageId,
  getCompatibleWindowsImage,
  getCompatibleLinuxImage,
  DEFAULT_WINDOWS_IMAGE,

  // Secrets
  createSecret,
  listSecrets,
  getSecret,
  deleteSecret,

  // Instances
  createInstance,
  getInstance,
  listInstances,
  startInstance,
  stopInstance,
  restartInstance,
  shutdownInstance,
  resetPassword,
  reinstallInstance,
  cancelInstance,
  upgradeInstance,
  updateInstanceName,

  // Snapshots
  createSnapshot,
  listSnapshots,
  deleteSnapshot,

  // Tags
  createTag,
  listTags,
  deleteTag,

  // Utility
  formatInstanceForDisplay,
  formatSpecs,
  healthCheck,

  // Circuit breaker (provisioning health)
  isProvisioningHealthy,
  getCircuitState,
  resetProvisioningCircuit,
  onProvisioningCircuitOpen,
  // Auth circuit breaker (credential health) — lets callers skip a whole batch
  // instead of failing (and logging) per-instance when creds are rejected.
  isAuthHealthy,
  // Test hook (read-only diagnostics): simulate a createInstance failure so a
  // dev self-check can assert the systemic-400 breaker behaviour without a real
  // paid order. Always paired with resetProvisioningCircuit() by the caller.
  __simulateCreateError: (status, message) => _trackCreateResult(false, { status, message }),

  // Test hook: exercise the auth breaker without the full apiRequest stack.
  __getAccessTokenForTest: getAccessToken,

  // Low-level
  apiRequest
}
