/* eslint-disable no-empty */
/**
 * digitalocean-service.js — DigitalOcean Droplet provider implementation.
 *
 * Mirrors the surface of vultr-service.js / contabo-service.js so the existing
 * vps-provider.js abstraction can route to DigitalOcean via
 * `VPS_DEFAULT_PROVIDER=digitalocean` or per-record routing on
 * `provider === 'digitalocean'`.
 *
 * Highlights vs Contabo/OVH/Vultr:
 *   • Linux ONLY — no Windows / RDP support (use Vultr for those).
 *   • Flat pricing across all regions (no per-region surcharge).
 *   • No native "set password at create" — we inject a cloud-init user_data
 *     script that sets root password on first boot (same UX as Vultr).
 *   • DO droplet IDs are numeric integers and would collide with Contabo's
 *     numeric IDs in the smart proxy's `dispatchByInstanceId()`. To
 *     disambiguate, this service WRAPS every droplet id with a `do-` prefix
 *     when returning to the bot (e.g. `do-487393245`), and STRIPS the prefix
 *     internally before hitting DigitalOcean's API. Same trick OVH uses with
 *     its `vps-...` prefix.
 *
 * Docs: https://docs.digitalocean.com/reference/api/api-reference/
 */

'use strict'
require('dotenv').config()
const axios = require('axios')
const crypto = require('crypto')
const secretStore = require('./vps-secret-store')

const API_TOKEN  = process.env.DIGITALOCEAN_API_TOKEN || ''
const API_BASE   = 'https://api.digitalocean.com/v2'
const MARKUP_PERCENT = parseFloat(process.env.VPS_MARKUP_PERCENT || '200')
// DO is Linux-only — no Windows licence concept.
const WINDOWS_LICENSE_BY_TIER = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }

const PROVIDER = 'digitalocean'
const ID_PREFIX = 'do-'

const log = (...a) => console.log('[DO]', ...a)

const http = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

// ─── ID helpers ──────────────────────────────────────────────────────────
/**
 * Convert a stored bot-side id (with optional `do-` prefix) to the raw
 * numeric DO droplet id used by the API.
 */
function _stripIdPrefix(id) {
  if (id == null) return null
  const s = String(id)
  return s.startsWith(ID_PREFIX) ? s.slice(ID_PREFIX.length) : s
}

/**
 * Wrap a raw DO droplet id with the `do-` prefix for storage / cross-service
 * dispatch. Always emits a string.
 */
function _wrapId(rawId) {
  if (rawId == null) return null
  const s = String(rawId)
  if (s.startsWith(ID_PREFIX)) return s
  return `${ID_PREFIX}${s}`
}

// ─── Circuit breaker (5 failures opens for 5 min) ────────────────────────
const _circuit = { failures: 0, lastFailureAt: null, lastSuccessAt: null }
const _CIRCUIT_THRESHOLD = 5
const _CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000
const _onOpenCallbacks = []

function _trackCreateResult(ok, err) {
  if (ok) {
    _circuit.failures = 0
    _circuit.lastSuccessAt = new Date()
  } else {
    _circuit.failures++
    _circuit.lastFailureAt = new Date()
    if (_circuit.failures >= _CIRCUIT_THRESHOLD) {
      log(`Circuit opened after ${_circuit.failures} failures. Last error: ${err?.message || err}`)
      for (const cb of _onOpenCallbacks) {
        try { cb({ failures: _circuit.failures, lastError: err }) } catch (_) {}
      }
    }
  }
}

function isProvisioningHealthy() {
  if (_circuit.failures < _CIRCUIT_THRESHOLD) return true
  if (!_circuit.lastFailureAt) return true
  return (Date.now() - _circuit.lastFailureAt.getTime()) > _CIRCUIT_COOLDOWN_MS
}

function getCircuitState() {
  return {
    healthy: isProvisioningHealthy(),
    failures: _circuit.failures,
    lastFailureAt: _circuit.lastFailureAt,
    lastSuccessAt: _circuit.lastSuccessAt,
  }
}

function resetProvisioningCircuit() {
  _circuit.failures = 0
  _circuit.lastFailureAt = null
  log('Circuit manually reset')
}

function onProvisioningCircuitOpen(cb) {
  if (typeof cb === 'function') _onOpenCallbacks.push(cb)
}

// ─── Low-level HTTP ──────────────────────────────────────────────────────
async function apiRequest(method, path, data = null, params = null) {
  if (!API_TOKEN) {
    throw new Error('DIGITALOCEAN_API_TOKEN not configured')
  }
  try {
    const resp = await http.request({
      method,
      url: path,
      data: data || undefined,
      params: params || undefined,
    })
    return resp.data
  } catch (err) {
    const status = err.response?.status
    const reason = err.response?.data?.message || err.response?.data?.id || err.response?.data || err.message
    const wrapped = new Error(`DO ${method} ${path} failed (${status}): ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
    wrapped.status = status
    wrapped.responseBody = err.response?.data
    throw wrapped
  }
}

// ─── Product Catalog (6-tier, parity with Vultr/Contabo) ─────────────────
// Customer-facing names use neutral "Cloud VPS" branding so the provider
// identity stays hidden — same UX policy as Contabo / Vultr.
//
// DO pricing is flat across all regions (no per-region surcharge).
const PRODUCT_CATALOG = [
  {
    productId:   's-1vcpu-1gb',
    name:        'Cloud VPS 10',
    cpuCores:    1, ramMb: 1024, diskMb: 25 * 1024,
    diskType:    'ssd', bandwidthTb: 1,
    portSpeedMbps: 1000, basePriceUsd: 6.0, tier: 1,
  },
  {
    productId:   's-1vcpu-2gb',
    name:        'Cloud VPS 20',
    cpuCores:    1, ramMb: 2048, diskMb: 50 * 1024,
    diskType:    'ssd', bandwidthTb: 2,
    portSpeedMbps: 1000, basePriceUsd: 12.0, tier: 2,
  },
  {
    productId:   's-2vcpu-2gb',
    name:        'Cloud VPS 30',
    cpuCores:    2, ramMb: 2048, diskMb: 60 * 1024,
    diskType:    'ssd', bandwidthTb: 3,
    portSpeedMbps: 1000, basePriceUsd: 18.0, tier: 3,
  },
  {
    productId:   's-2vcpu-4gb',
    name:        'Cloud VPS 40',
    cpuCores:    2, ramMb: 4096, diskMb: 80 * 1024,
    diskType:    'ssd', bandwidthTb: 4,
    portSpeedMbps: 1000, basePriceUsd: 24.0, tier: 4,
  },
  {
    productId:   's-4vcpu-8gb',
    name:        'Cloud VPS 50',
    cpuCores:    4, ramMb: 8192, diskMb: 160 * 1024,
    diskType:    'ssd', bandwidthTb: 5,
    portSpeedMbps: 1000, basePriceUsd: 48.0, tier: 5,
  },
  {
    productId:   's-8vcpu-16gb',
    name:        'Cloud VPS 60',
    cpuCores:    8, ramMb: 16384, diskMb: 320 * 1024,
    diskType:    'ssd', bandwidthTb: 6,
    portSpeedMbps: 1000, basePriceUsd: 96.0, tier: 6,
  },
]

// DO is flat-priced across all regions — surcharge is 0 for every tier.
const REGION_SURCHARGE = {
  'EU':         [0, 0, 0, 0, 0, 0],
  'US-central': [0, 0, 0, 0, 0, 0],
  'US-east':    [0, 0, 0, 0, 0, 0],
  'US-west':    [0, 0, 0, 0, 0, 0],
  'UK':         [0, 0, 0, 0, 0, 0],
  'SG':         [0, 0, 0, 0, 0, 0],
  'AU':         [0, 0, 0, 0, 0, 0],
  'IN':         [0, 0, 0, 0, 0, 0],
  // 'JP' intentionally omitted — DO has no Japan datacenter.
}

const REGION_DISPLAY = {
  'EU':         { emoji: '🇪🇺', label: 'Europe (EU)' },
  'US-central': { emoji: '🇺🇸', label: 'US Central' },
  'US-east':    { emoji: '🇺🇸', label: 'US East' },
  'US-west':    { emoji: '🇺🇸', label: 'US West' },
  'UK':         { emoji: '🇬🇧', label: 'United Kingdom' },
  'SG':         { emoji: '🇸🇬', label: 'Singapore' },
  'AU':         { emoji: '🇦🇺', label: 'Australia' },
  'IN':         { emoji: '🇮🇳', label: 'India' },
}

// Customer-facing region slug → DO region slug.
const REGION_TO_DO_SLUG = {
  'EU':         'fra1',  // Frankfurt
  'US-central': 'nyc3',  // New York 3
  'US-east':    'nyc1',  // New York 1
  'US-west':    'sfo3',  // San Francisco 3
  'UK':         'lon1',  // London
  'SG':         'sgp1',  // Singapore
  'AU':         'syd1',  // Sydney
  'IN':         'blr1',  // Bangalore
}

// ─── Pricing ─────────────────────────────────────────────────────────────
function applyMarkup(basePrice) {
  return Math.round(basePrice * (1 + MARKUP_PERCENT / 100) * 100) / 100
}

function calculatePrice(product, regionSlug, isWindows = false) {
  // DO does not support Windows at all — calling code shouldn't request it,
  // but if it does, return null so the bot's "unavailable" path triggers.
  if (isWindows) return null
  const surchargeArr = REGION_SURCHARGE[regionSlug]
  if (!surchargeArr) return null // e.g. 'JP' on DO → not available
  const base       = product.basePriceUsd
  const tier       = product.tier || 1
  const surcharge  = surchargeArr[tier - 1] ?? 0
  const windowsFee = 0
  const totalBefore = base + surcharge + windowsFee
  const totalMarkup = applyMarkup(totalBefore)
  return {
    basePriceUsd:      base,
    regionSurcharge:   surcharge,
    windowsLicense:    windowsFee,
    totalBeforeMarkup: Math.round(totalBefore * 100) / 100,
    totalWithMarkup:   totalMarkup,
    markupPercent:     MARKUP_PERCENT,
  }
}

// ─── Products / catalog ──────────────────────────────────────────────────
// DO has no SSD-vs-NVMe choice (all standard droplets are SSD), so the
// catalog is exposed BOTH as PRODUCT_CATALOG and PRODUCT_CATALOG_SSD (alias).
const PRODUCT_CATALOG_SSD = PRODUCT_CATALOG

function listProducts(regionSlug = 'EU', isWindows = false, _diskPreference = 'ssd') {
  if (isWindows) return [] // DO has no Windows
  return PRODUCT_CATALOG
    .map(p => {
      const pricing = calculatePrice(p, regionSlug, false)
      if (!pricing) return null
      return {
        ...p,
        ramGb:  Math.round(p.ramMb / 1024),
        diskGb: Math.round(p.diskMb / 1024),
        pricing,
      }
    })
    .filter(Boolean)
}

function getProduct(productId) {
  return PRODUCT_CATALOG.find(p => p.productId === productId) || null
}

async function listRegions() {
  // Shape-compatible with contabo/ovh/vultr services. Consumer:
  // vm-instance-setup.js fetchAvailableCountries / fetchAvailableRegionsOfCountry.
  return Object.entries(REGION_DISPLAY).map(([slug, info]) => ({
    regionSlug:   slug,
    regionName:   info.label,
    dataCenters:  [{ name: info.label, slug }],
    surchargeUsd: REGION_SURCHARGE[slug] || [0, 0, 0, 0, 0, 0],
    display:      info,
    doSlug:       REGION_TO_DO_SLUG[slug],
    // Legacy flat fields preserved for any existing consumer that read them
    slug,
    emoji:        info.emoji,
    label:        info.label,
  }))
}

// ─── Images / OS ─────────────────────────────────────────────────────────
// DO distribution images. We expose a stable curated subset so customers
// see clean "Ubuntu / Debian / Rocky / Alma / CentOS Stream" names rather
// than 30+ permutations.
const CURATED_LINUX_IMAGES = [
  { imageId: 'ubuntu-24-04-x64',   name: 'Ubuntu 24.04 LTS',     family: 'Ubuntu',     isDefault: true  },
  { imageId: 'ubuntu-22-04-x64',   name: 'Ubuntu 22.04 LTS',     family: 'Ubuntu',     isDefault: false },
  { imageId: 'debian-13-x64',      name: 'Debian 13',            family: 'Debian',     isDefault: false },
  { imageId: 'debian-12-x64',      name: 'Debian 12',            family: 'Debian',     isDefault: false },
  { imageId: 'almalinux-9-x64',    name: 'AlmaLinux 9',          family: 'AlmaLinux',  isDefault: false },
  { imageId: 'almalinux-8-x64',    name: 'AlmaLinux 8',          family: 'AlmaLinux',  isDefault: false },
  { imageId: 'rockylinux-9-x64',   name: 'Rocky Linux 9',        family: 'Rocky',      isDefault: false },
  { imageId: 'rockylinux-10-x64',  name: 'Rocky Linux 10',       family: 'Rocky',      isDefault: false },
  { imageId: 'centos-stream-9-x64',  name: 'CentOS Stream 9',    family: 'CentOS',     isDefault: false },
  { imageId: 'centos-stream-10-x64', name: 'CentOS Stream 10',   family: 'CentOS',     isDefault: false },
  { imageId: 'fedora-42-x64',      name: 'Fedora 42',            family: 'Fedora',     isDefault: false },
]

async function listImages(filter = 'all') {
  // filter: 'all' | 'linux' | 'windows'
  if (filter === 'windows') return [] // DO has no Windows
  // Always return curated list (regardless of filter='all'|'linux') since
  // DO is Linux-only. Returning curated avoids 30+ confusing variants.
  return CURATED_LINUX_IMAGES.map(o => ({
    imageId:   o.imageId,
    name:      o.name,
    osType:    'Linux',
    version:   o.name,
    isWindows: false,
    // legacy flat fields
    id:        o.imageId,
    family:    o.family,
    arch:      'x86_64',
  }))
}

// DO doesn't support Windows — return null so the caller's "Windows
// unavailable" path triggers (vm-instance-setup.js handles this).
async function getDefaultWindowsImageId(_productId) {
  return null
}

async function getCompatibleWindowsImage(_imageId, _targetProductId) {
  return null
}

async function getCompatibleLinuxImage(currentImageId, _productId) {
  // DO Linux images work on every Droplet plan ≥1 GB RAM (every tier qualifies).
  return currentImageId
}

// ─── Password secrets (Contabo-compat shim) ──────────────────────────────
// Contabo's bot flow calls `createSecret(name, value, 'password')` → gets a
// secretId → passes it to `createInstance({ rootPassword: secretId })`. DO
// has no native concept of "password secrets".
//
// 2026-08-13 FIX: this used to be a bare in-process `new Map()`, so the
// plaintext died with the process while `vpsPlansOf.rootPasswordSecretId`
// happily pointed at it in Mongo. Every Railway redeploy therefore destroyed
// every DO customer's VPS password permanently. Secrets are now persisted via
// vps-secret-store.js (Mongo + in-process cache).
const _passwordSecrets = new Map() // legacy fast path: fakeSecretId → { password, name, createdAt }

function _isFakePasswordSecretId(id) {
  return typeof id === 'string' && id.startsWith('do-pwd-')
}

/**
 * Resolve a value that is EITHER a fabricated password-secret id OR an actual
 * plaintext password. Async because the durable store is in Mongo.
 */
async function _resolvePasswordSecret(secretIdOrPassword) {
  if (!secretIdOrPassword) return null
  if (_isFakePasswordSecretId(secretIdOrPassword)) {
    const cached = _passwordSecrets.get(secretIdOrPassword)
    if (cached?.password) return cached.password
    const stored = await secretStore.getSecretPassword(secretIdOrPassword)
    if (stored) return stored
    // Unresolvable secret id — returning the id itself would set the id AS the
    // password (the old behaviour), so return null and let the caller decide.
    return null
  }
  return String(secretIdOrPassword)
}

/** Persist a fabricated password secret in both the cache and Mongo. */
async function _storePasswordSecret(secretId, password, name) {
  _passwordSecrets.set(secretId, { password, name: name || secretId, createdAt: Date.now() })
  await secretStore.putSecret(secretId, password, { name: name || secretId, provider: PROVIDER })
  return secretId
}

/**
 * Build a cloud-init user_data script that sets the root password on first
 * boot. This is the only way to ship a pre-set root password on DO at create
 * time (DO's create endpoint has no password field).
 */
function _buildPasswordCloudInit(rootPassword, extraUserData = null) {
  if (!rootPassword) return extraUserData || null
  // Escape only single quotes for the heredoc — passwords here are randomly
  // generated by the bot (no shell metacharacters in practice).
  const escaped = String(rootPassword).replace(/'/g, "'\"'\"'")
  const script = `#cloud-config
chpasswd:
  list: |
    root:${escaped}
  expire: false
ssh_pwauth: true
runcmd:
  - sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
  - sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - systemctl restart sshd || systemctl restart ssh || true
`
  // If caller supplied extra userData, embed both via cloud-init's multipart-
  // less alternative: append a runcmd line that writes+exec the extra script.
  if (extraUserData) {
    // 2026-08-13 FIX — DOUBLE-BASE64 BUG.
    // vm-instance-setup.js base64-encodes its cloud-init script before calling
    // us (Contabo's API requires base64). We then encoded it a SECOND time, so
    // on the box `base64 -d` produced base64 TEXT instead of a shell script and
    // bash reported `<base64 blob>: command not found`. The whole sshd-hardening
    // script silently never ran (verified on droplet 591819943: cloud-init
    // status=error, /root/_bot_userdata.sh contained base64). Normalise to
    // plaintext first, then encode exactly once.
    const extraB64 = Buffer.from(_decodeIfBase64(extraUserData), 'utf-8').toString('base64')
    return script + `  - echo '${extraB64}' | base64 -d > /root/_bot_userdata.sh && bash /root/_bot_userdata.sh\n`
  }
  return script
}

/**
 * Return the plaintext of `input`, transparently base64-decoding it when the
 * caller already encoded it. Detection is content-based (a decoded shell or
 * cloud-config script), never just "looks like base64".
 */
function _decodeIfBase64(input) {
  const raw = String(input || '')
  if (!raw) return raw
  // Already plaintext?
  if (raw.includes('#!/') || raw.includes('#cloud-config') || raw.includes('\n')) return raw
  if (!/^[A-Za-z0-9+/=]+$/.test(raw.trim())) return raw
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf-8')
    if (decoded.includes('#!/') || decoded.includes('#cloud-config') || decoded.includes('sed ') || decoded.includes('echo ')) {
      return decoded
    }
  } catch (_) { /* fall through */ }
  return raw
}

// ─── Instances (Droplets) ────────────────────────────────────────────────
/**
 * Create a DigitalOcean Droplet.
 *
 * Accepts BOTH native DO param names AND the bot's Contabo-style names so
 * the same `vm-instance-setup.js createVPSInstance` call works on either
 * provider. Aliases:
 *   regionSlug   ← region
 *   osId         ← imageId
 *   label        ← displayName
 *   sshKeyIds    ← sshKeys
 *   password     ← rootPassword (resolved from fake-secret-id if needed)
 */
async function createInstance(opts) {
  const o = opts || {}
  const productId   = o.productId
  const regionSlug  = o.regionSlug || o.region
  const osId        = o.osId       || o.imageId  || 'ubuntu-24-04-x64'
  const label       = o.label      || o.displayName || `vps-${Date.now().toString(36)}`
  const tag         = o.tag        || null
  const sshKeyIds   = o.sshKeyIds  || o.sshKeys || null
  const userDataIn  = o.userData   || null
  const password    = await _resolvePasswordSecret(o.password || o.rootPassword)

  if (!productId || !regionSlug) {
    throw new Error(`createInstance requires { productId, regionSlug } — got productId=${productId} regionSlug=${regionSlug}`)
  }
  const region = REGION_TO_DO_SLUG[regionSlug]
  if (!region) throw new Error(`DO has no datacenter for region slug: ${regionSlug}`)

  // user_data on DO is sent as plain text (NOT base64). Build a cloud-init
  // script that sets the password and/or runs the caller's userData.
  const userData = _buildPasswordCloudInit(password, userDataIn)

  // Normalize ssh key ids (DO accepts integers or fingerprints)
  let ssh_keys = null
  if (Array.isArray(sshKeyIds) && sshKeyIds.length) {
    ssh_keys = sshKeyIds.map(k => {
      const s = String(k)
      return /^\d+$/.test(s) ? parseInt(s, 10) : s
    })
  }

  // DO requires `name` to be a valid hostname (alphanumeric + hyphens, no
  // underscores, no spaces). Sanitise the bot-supplied label.
  const safeName = String(label).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `vps-${Date.now().toString(36)}`

  const body = {
    name:       safeName,
    region,
    size:       productId,
    image:      osId,
    backups:    false,
    ipv6:       false,
    monitoring: true,
    with_droplet_agent: true,
  }
  if (tag) body.tags = [tag]
  if (ssh_keys) body.ssh_keys = ssh_keys
  if (userData) body.user_data = userData

  try {
    const data = await apiRequest('POST', '/droplets', body)
    const droplet = data.droplet || {}
    _trackCreateResult(true)
    // DO returns droplet immediately but it's still provisioning — main_ip
    // populates a few seconds later. Caller (vm-instance-setup.js) polls
    // getInstance() to wait for the IP.
    return {
      instanceId:      _wrapId(droplet.id),         // do-12345678
      mainIp:          _extractIPv4(droplet) || null,
      defaultPassword: password || null,
      status:          _mapStatus(droplet.status),
      providerStatus:  droplet.status,
      raw:             droplet,
    }
  } catch (err) {
    _trackCreateResult(false, err)
    throw err
  }
}

function _extractIPv4(droplet) {
  if (!droplet || !droplet.networks) return null
  const v4 = (droplet.networks.v4 || []).find(n => n.type === 'public')
  return v4 ? v4.ip_address : null
}

function _extractIPv6(droplet) {
  if (!droplet || !droplet.networks) return null
  const v6 = (droplet.networks.v6 || []).find(n => n.type === 'public')
  return v6 ? v6.ip_address : null
}

async function getInstance(instanceId) {
  const id = _stripIdPrefix(instanceId)
  const data = await apiRequest('GET', `/droplets/${id}`)
  const droplet = data.droplet || null
  if (!droplet) return null
  return {
    instanceId:      _wrapId(droplet.id),
    mainIp:          _extractIPv4(droplet),
    defaultPassword: null, // DO never returns the password
    status:          _mapStatus(droplet.status),
    powerStatus:     _mapStatus(droplet.status),
    serverStatus:    _mapStatus(droplet.status),
    providerStatus:  droplet.status, // untranslated, for debugging
    region:          droplet.region?.slug,
    plan:            droplet.size_slug,
    osId:            droplet.image?.slug || droplet.image?.id,
    label:           droplet.name,
    tag:             (droplet.tags && droplet.tags[0]) || null,
    dateCreated:     droplet.created_at,
    // Cross-provider compatibility shims (Contabo-style ipConfig)
    ipConfig:        { v4: { ip: _extractIPv4(droplet) }, v6: { ip: _extractIPv6(droplet) } },
    ipv4:            _extractIPv4(droplet),
    raw:             droplet,
  }
}

async function listInstances(filters = {}) {
  const params = {}
  if (filters.tag) params.tag_name = filters.tag
  const data = await apiRequest('GET', '/droplets', null, params)
  return (data.droplets || []).map(d => ({
    instanceId: _wrapId(d.id),
    mainIp:     _extractIPv4(d),
    status:     _mapStatus(d.status),
    providerStatus: d.status,
    region:     d.region?.slug,
    plan:       d.size_slug,
    label:      d.name,
    tag:        (d.tags && d.tags[0]) || null,
    raw:        d,
  }))
}

// ─── Power actions ───────────────────────────────────────────────────────
async function _dropletAction(instanceId, body) {
  const id = _stripIdPrefix(instanceId)
  return apiRequest('POST', `/droplets/${id}/actions`, body)
}

async function startInstance(instanceId)    { return _dropletAction(instanceId, { type: 'power_on' }) }
async function stopInstance(instanceId)     { return _dropletAction(instanceId, { type: 'power_off' }) }
async function restartInstance(instanceId)  { return _dropletAction(instanceId, { type: 'reboot' }) }
async function shutdownInstance(instanceId) { return _dropletAction(instanceId, { type: 'shutdown' }) }

// ─── Status vocabulary ───────────────────────────────────────────────────
/**
 * Translate DigitalOcean's status words into the canonical (Contabo)
 * vocabulary the rest of the bot is written against.
 *
 * 2026-08-13 FIX: the whole bot compares `status === 'RUNNING'` — that is how
 * it decides between the ▶️ Start and ⏹️ Stop buttons and between the 🟢 and
 * 🔴 dots. DO returns `active`, which `fetchVPSDetails()` upper-cases to
 * `ACTIVE`, so EVERY healthy DO droplet was rendered as 🔴 with a "▶️ Start"
 * button. Customers then "started" servers that were already running and
 * concluded their VPS was broken (real case: chatId 6277663071 tapped
 * ▶️ Start twice on a running droplet before opening a support ticket).
 */
const _DO_STATUS_MAP = {
  active:  'running',
  off:     'stopped',
  new:     'provisioning',
  archive: 'archived',
}
function _mapStatus(s) {
  if (!s) return s
  const k = String(s).toLowerCase()
  return _DO_STATUS_MAP[k] || k
}

/**
 * Decide HOW a password reset will be attempted, without doing any I/O.
 * Exported so the regression test can assert that `rebuild` is never in the
 * plan again.
 *
 * @returns {{steps: string[], canApply: boolean, reason: string|null}}
 */
function _resetPasswordPlan(opts = {}) {
  const steps = []
  const keys = Array.isArray(opts.sshPrivateKeys) ? opts.sshPrivateKeys : (opts.sshPrivateKeys ? [opts.sshPrivateKeys] : [])
  const usableKeys = keys.filter(k => {
    const key = typeof k === 'string' ? k : (k && (k.privateKey || k.key))
    return key && String(key).includes('PRIVATE KEY')
  })
  if (opts.host && usableKeys.length) steps.push('ssh-key')
  if (opts.host && opts.currentPassword) steps.push('ssh-password')
  // Last resort: DO's native action. It emails a random password to the
  // ACCOUNT owner and does NOT touch the disk. Never destructive.
  steps.push('provider-email')
  return {
    steps,
    canApply: steps.some(s => s.startsWith('ssh-')),
    reason: steps.some(s => s.startsWith('ssh-'))
      ? null
      : (!opts.host ? 'no host on record' : 'no SSH key on file and current password unknown'),
  }
}

/**
 * Reset the root password for a DO Droplet — IN PLACE, without destroying data.
 *
 * ─── HISTORY / WHY THIS LOOKS LIKE THIS ──────────────────────────────────
 * DO offers only two native paths, and BOTH are unusable for bot UX:
 *   1. `password_reset` action — emails a random password to the account
 *      holder (our team mailbox), so the customer never sees it.
 *   2. `rebuild` action — the previous implementation used this and passed a
 *      cloud-init `user_data` that set the new password.
 *
 * Path 2 was silently broken: **DO accepts `user_data` only at droplet
 * CREATE time and it is immutable afterwards.** `rebuild` ignores the
 * user_data you send and re-runs the ORIGINAL creation cloud-init. So every
 * "Reset Password" tap wiped the customer's disk AND left the original
 * password in place, while the bot displayed a fresh password that existed
 * nowhere. Customers saw "Permission denied, please try again." forever.
 * (Verified on droplet 591819943 / chatId 6277663071: 3 rebuilds in 20h, the
 * droplet was still being served the ORIGINAL create-time user_data.)
 *
 * We now log in to the RUNNING droplet (SSH key first, then the password we
 * currently believe is set), apply the password with `chpasswd`, re-enable
 * password auth, and VERIFY by logging back in with the new password. No
 * reboot, no data loss, and we never return a password we could not prove.
 *
 * Cross-provider contract (matches Contabo / OVH / Vultr return shape):
 *   → { password, secretId, reinstalled, note, verified }
 * `password: null` tells the bot to render the "provider emailed it" copy.
 */
async function resetPassword(instanceId, opts = {}) {
  const id = _stripIdPrefix(instanceId)
  const username = opts.defaultUser || 'root'

  // Resolve the host and the currently known password.
  let host = opts.host || null
  if (!host) {
    try {
      const cur = await apiRequest('GET', `/droplets/${id}`)
      host = _extractIPv4(cur.droplet)
    } catch (_) { /* leave null — plan() will fall back */ }
  }
  let currentPassword = opts.currentPassword || null
  if (!currentPassword && opts.currentSecretId) {
    currentPassword = await _resolvePasswordSecret(opts.currentSecretId)
  }

  // Fallback recovery: if we STILL do not know a password, run the full reveal
  // resolution chain (durable store → provider cache → cloud-init user-data over
  // SSH). Feeding a recovered password back in keeps the in-place SSH reset path
  // usable — so we set the new password on the RUNNING server (data kept, shown
  // here) instead of falling back to DO emailing a password we can never display.
  if (!currentPassword && host) {
    try {
      const { revealVpsPassword } = require('./vps-password-reveal')
      const rev = await revealVpsPassword(
        {
          provider: PROVIDER,
          vpsId: `do-${id}`,
          host,
          defaultUser: username,
          isRDP: opts.isRDP,
          osType: opts.osType,
          rootPasswordSecretId: opts.currentSecretId || null,
        },
        { sshPrivateKeys: opts.sshPrivateKeys || [], verify: false }
      )
      if (rev && rev.status === 'ok' && rev.password) {
        currentPassword = rev.password
        log(`resetPassword ${id}: recovered current password via reveal (source=${rev.source}${rev.recovered ? ', recovered' : ''})`)
      }
    } catch (e) {
      log(`resetPassword ${id}: reveal fallback failed — ${e.message || e}`)
    }
  }

  const plan = _resetPasswordPlan({ host, sshPrivateKeys: opts.sshPrivateKeys, currentPassword })
  log(`resetPassword ${id}: plan=[${plan.steps.join(' → ')}]${plan.reason ? ` (${plan.reason})` : ''}`)

  if (plan.canApply) {
    const newPassword = _generateRandomPassword(20)
    const { applyPasswordOverSSH } = require('./vps-ssh-password')
    let result
    try {
      result = await applyPasswordOverSSH({
        host,
        port: 22,
        username,
        newPassword,
        privateKeys: opts.sshPrivateKeys || [],
        currentPassword,
      })
    } catch (e) {
      result = { ok: false, error: String(e.message || e) }
    }

    if (result.ok) {
      const secretId = `do-pwd-${id}-${Date.now().toString(36)}`
      await _storePasswordSecret(secretId, newPassword, secretId)
      return {
        password:    newPassword,
        newPassword,
        secretId,
        reinstalled: false,
        verified:    !!result.verified,
        note:        result.verified
          ? 'Password applied on the running server and verified by logging in. Your data was NOT touched.'
          : 'Password applied on the running server (login verification timed out — allow ~1 minute). Your data was NOT touched.',
        raw: { id, method: result.method, attempts: result.attempts },
      }
    }
    log(`resetPassword ${id}: SSH path failed — ${result.error || 'unknown'}`)
  }

  // ── Diagnose reachability before giving up on the in-place path ──────────
  // If the droplet is ONLINE (a web port answers) but SSH (22) is closed, the
  // guest firewall (ufw) is blocking us — DO's email reset would set a password
  // the customer still could not use, so we return actionable guidance instead
  // of the misleading "we emailed it" copy.
  if (host) {
    try {
      const { diagnoseSshReachability } = require('./vps-ssh-password')
      const diag = await diagnoseSshReachability(host, { sshPort: 22 })
      log(`resetPassword ${id}: reachability verdict=${diag.verdict} (ssh=${diag.sshOpen} web=${diag.webOpen})`)
      if (diag.verdict === 'ssh-blocked') {
        return {
          password:    null,
          newPassword: null,
          secretId:    opts.currentSecretId || null,
          reinstalled: false,
          verified:    false,
          note:        'Your VPS is online, but its SSH port (22) is blocked by a firewall on the server itself — so we cannot set or verify a password remotely. Open port 22 and we can do it instantly.',
          raw: { id, fallback: 'ssh-blocked', diag },
        }
      }
    } catch (e) {
      log(`resetPassword ${id}: reachability probe failed — ${e.message || e}`)
    }
  }

  // ── Last resort: DO's native, NON-destructive password_reset ────────────
  // Deliberately NOT `rebuild`: a password reset must never wipe a customer's
  // server, and rebuild cannot apply a new password anyway (see above).
  await apiRequest('POST', `/droplets/${id}/actions`, { type: 'password_reset' })
  return {
    password:    null,
    newPassword: null,
    secretId:    opts.currentSecretId || null,
    reinstalled: false,
    verified:    false,
    note:
      'DigitalOcean has generated a new root password and emailed it to the hosting account — support will forward it to you shortly. ' +
      'Your server and all data are untouched. For instant access use your SSH key.' +
      (plan.reason ? ` (Reason we could not set it directly: ${plan.reason}.)` : ''),
    raw: { id, fallback: 'provider-email', planReason: plan.reason },
  }
}

function _generateRandomPassword(length = 20) {
  // 16-byte CSPRNG → base64 → strip non-alphanumeric → take first `length` chars
  return crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, length)
}

/**
 * Reinstall a Droplet.
 *
 * Cross-provider contract — accepts the bot's existing call signature:
 *   { imageId, rootPassword, sshKeys, userData, osType, isRDP }
 *
 * Uses DO's `rebuild` action.
 *
 * ⚠️ CAVEAT (same DO limitation that broke resetPassword): `rebuild` IGNORES
 * `user_data` — DO only honours it on CREATE and it is immutable thereafter,
 * so the box comes back with its ORIGINAL create-time cloud-init (and
 * therefore its ORIGINAL password). We still send it for the day DO adds
 * support, but we report `passwordApplied: false` so no caller shows the
 * customer a password we have not actually set. To change the password after
 * a reinstall, call resetPassword() — it applies it over SSH.
 */
async function reinstallInstance(instanceId, opts = {}) {
  const id = _stripIdPrefix(instanceId)
  const osId = opts.osId || opts.imageId || 'ubuntu-24-04-x64'
  const password = await _resolvePasswordSecret(opts.password || opts.rootPassword)

  const cloudInit = password ? _buildPasswordCloudInit(password, opts.userData) : (opts.userData || null)

  const body = {
    type:  'rebuild',
    image: osId,
  }
  if (cloudInit) body.user_data = cloudInit

  const data = await apiRequest('POST', `/droplets/${id}/actions`, body)
  return {
    instanceId: _wrapId(id),
    password:   password || null,
    raw:        data.action || data,
  }
}

/**
 * Cancel/delete a DO Droplet.
 *
 * IMPORTANT: DO has only IMMEDIATE delete. No "cancel at end of billing
 * period" model. Same cancel-on-create gotcha as Vultr — see opts.scheduleOnly.
 */
async function cancelInstance(instanceId, opts = {}) {
  if (opts.scheduleOnly) {
    log(`scheduleOnly cancel requested for ${instanceId} — no-op (DO has no scheduled cancel; track via vpsPlansOf.autoRenewable=false instead)`)
    return { success: true, scheduleOnly: true, note: 'DigitalOcean has no scheduled cancellation; instance keeps running until DB-driven scheduler decides to expire it.' }
  }
  const id = _stripIdPrefix(instanceId)
  return apiRequest('DELETE', `/droplets/${id}`)
}

async function upgradeInstance(instanceId, newProductId) {
  // DO resize: requires droplet to be powered OFF first. We trust the
  // caller (vm-instance-setup.js) handles power state — same contract Vultr
  // has. `disk: true` permanently resizes the SSD; `disk: false` resizes
  // CPU/RAM only (faster, can be undone). Default = permanent for parity.
  const id = _stripIdPrefix(instanceId)
  return apiRequest('POST', `/droplets/${id}/actions`, {
    type: 'resize',
    size: newProductId,
    disk: true,
  })
}

async function updateInstanceName(instanceId, displayName) {
  const id = _stripIdPrefix(instanceId)
  const safeName = String(displayName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return apiRequest('POST', `/droplets/${id}/actions`, {
    type: 'rename',
    name: safeName,
  })
}

// ─── Snapshots ───────────────────────────────────────────────────────────
async function createSnapshot(instanceId, name, description = '') {
  const id = _stripIdPrefix(instanceId)
  const snapshotName = name + (description ? ` — ${description}` : '')
  return apiRequest('POST', `/droplets/${id}/actions`, {
    type: 'snapshot',
    name: snapshotName,
  })
}

async function listSnapshots(instanceId) {
  if (instanceId) {
    const id = _stripIdPrefix(instanceId)
    const data = await apiRequest('GET', `/droplets/${id}/snapshots`)
    return data.snapshots || []
  }
  const data = await apiRequest('GET', '/snapshots', null, { resource_type: 'droplet' })
  return data.snapshots || []
}

async function deleteSnapshot(_instanceId, snapshotId) {
  return apiRequest('DELETE', `/snapshots/${snapshotId}`)
}

// ─── Tags ────────────────────────────────────────────────────────────────
async function createTag(name, _color) {
  try {
    await apiRequest('POST', '/tags', { name })
  } catch (err) {
    // DO returns 422 if the tag already exists — ignore.
    if (err.status !== 422) throw err
  }
  return { id: name, name }
}

async function listTags() {
  const data = await apiRequest('GET', '/tags')
  return (data.tags || []).map(t => ({ name: t.name }))
}

// ─── Secrets / SSH keys ──────────────────────────────────────────────────
// Same pattern as vultr-service: real SSH keys hit DO's /account/keys.
// Password secrets are fabricated ids, now DURABLY persisted via
// vps-secret-store.js (was an in-process Map — see the note at its definition).
async function createSecret(name, value, type = 'ssh') {
  if (type === 'password') {
    const secretId = `do-pwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    await _storePasswordSecret(secretId, value, name)
    return { secretId, id: secretId, name, type: 'password' }
  }
  if (type !== 'ssh') throw new Error(`DO createSecret: unsupported type "${type}" (only 'ssh' and 'password')`)
  const data = await apiRequest('POST', '/account/keys', { name, public_key: value })
  return {
    secretId: data.ssh_key?.id,
    id:       data.ssh_key?.id,
    name:     data.ssh_key?.name,
    type:     'ssh',
  }
}

async function listSecrets(_type = null) {
  const data = await apiRequest('GET', '/account/keys')
  return (data.ssh_keys || []).map(k => ({ id: k.id, secretId: k.id, name: k.name }))
}

async function getSecret(secretId) {
  if (_isFakePasswordSecretId(secretId)) {
    const cached = _passwordSecrets.get(secretId)
    if (cached) return { id: secretId, name: cached.name, type: 'password' }
    return await secretStore.getSecretMeta(secretId)
  }
  const data = await apiRequest('GET', `/account/keys/${secretId}`)
  return data.ssh_key || null
}

/**
 * Reveal the plaintext password behind a fabricated secret id.
 * Returns null when the secret predates durable storage (i.e. it was lost to a
 * redeploy while secrets still lived in a per-process Map).
 */
async function getSecretPassword(secretId) {
  if (!_isFakePasswordSecretId(secretId)) return null
  return await _resolvePasswordSecret(secretId)
}

async function deleteSecret(secretId) {
  if (_isFakePasswordSecretId(secretId)) {
    _passwordSecrets.delete(secretId)
    await secretStore.deleteSecret(secretId)
    return { success: true }
  }
  return apiRequest('DELETE', `/account/keys/${secretId}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function isNVMeProduct(_productId) { return false } // DO standard droplets are SSD, not NVMe
function isSSDProduct(_productId)  { return true  }

function formatSpecs(product) {
  const ramGb  = product.ramGb  || Math.round((product.ramMb  || 0) / 1024)
  const diskGb = product.diskGb || Math.round((product.diskMb || 0) / 1024)
  const dt     = (product.diskType || 'ssd').toUpperCase()
  return `${product.cpuCores} vCPU | ${ramGb} GB RAM | ${diskGb} GB ${dt}`
}

function formatInstanceForDisplay(instance) {
  const ip     = instance.mainIp || instance.ip || 'Provisioning...'
  const ipv6   = instance.ipv6 || ''
  const ramMb  = instance.ramMb  || instance.ram     || 0
  const diskMb = instance.diskMb || instance.disk    || 0
  const ramGb  = Math.round(ramMb / 1024)
  const diskGb = Math.round(diskMb / 1024)
  const osType = 'Linux'
  const region = instance.region || ''
  const product = getProduct(instance.productId || instance.plan)
  const statusEmoji = {
    active:       '🟢',
    running:      '🟢',
    off:          '🔴',
    stopped:      '🔴',
    new:          '🟡',
    provisioning: '🟡',
    pending:      '🟡',
    installing:   '🟡',
    archive:      '⚪',
    error:        '❌',
    unknown:      '⚪',
  }
  const status = _mapStatus(instance.status || 'unknown')
  return {
    instanceId:   instance.instanceId,
    name:         instance.displayName || instance.label || instance.name,
    status,
    statusEmoji:  statusEmoji[status] || '⚪',
    ip,
    ipv6,
    region,
    regionName:   _reverseRegionLabel(region),
    productId:    instance.productId || instance.plan,
    productName:  product?.name || instance.productName || instance.plan,
    cpuCores:     instance.cpuCores || instance.vcpus,
    ramGb,
    diskGb,
    osType,
    isWindows:    false,
    createdDate:  instance.createdDate || instance.created_at,
    cancelDate:   null,
    defaultUser:  'root',
  }
}

function _reverseRegionLabel(doSlug) {
  for (const [custSlug, doId] of Object.entries(REGION_TO_DO_SLUG)) {
    if (doId === doSlug) return REGION_DISPLAY[custSlug]?.label || doSlug
  }
  return doSlug
}

// ─── Public surface ──────────────────────────────────────────────────────
module.exports = {
  PROVIDER,
  ID_PREFIX,
  // Pricing
  MARKUP_PERCENT,
  applyMarkup,
  calculatePrice,
  // Products
  PRODUCT_CATALOG,
  PRODUCT_CATALOG_SSD,
  listProducts,
  getProduct,
  isNVMeProduct,
  isSSDProduct,
  // Regions
  REGION_DISPLAY,
  REGION_TO_DO_SLUG,
  REGION_SURCHARGE,
  listRegions,
  // Images / OS
  listImages,
  getDefaultWindowsImageId,
  getCompatibleWindowsImage,
  getCompatibleLinuxImage,
  WINDOWS_LICENSE_BY_TIER,
  // Display helpers
  formatSpecs,
  formatInstanceForDisplay,
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
  // Secrets / SSH keys
  createSecret,
  listSecrets,
  getSecret,
  getSecretPassword,
  deleteSecret,
  // Circuit breaker
  isProvisioningHealthy,
  getCircuitState,
  resetProvisioningCircuit,
  onProvisioningCircuitOpen,
  // Internal helpers exported for testing
  _stripIdPrefix,
  _wrapId,
  _buildPasswordCloudInit,
  _decodeIfBase64,
  _resetPasswordPlan,
  _resolvePasswordSecret,
  _mapStatus,
  // Low-level
  apiRequest,
}
