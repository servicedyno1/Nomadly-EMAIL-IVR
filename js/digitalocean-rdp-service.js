'use strict'
/**
 * digitalocean-rdp-service.js — Windows RDP on DigitalOcean, ported from the
 * standalone RDP-DIGITALOCEAN FastAPI backend (do_client.py + provisioning.py +
 * database.py catalog) into Nomadly's provider interface.
 *
 * WHY: DigitalOcean has no native Windows. This provider creates an Ubuntu
 * droplet and runs a cloud-init script (js/rdp-scripts/convert_to_windows.sh +
 * autounattend.xml.tmpl) that QEMU-installs Windows Server, enables RDP with a
 * unique Administrator password, and reports progress via a token-gated
 * callback (POST {SELF_URL}/provision/callback → Node /provision/callback).
 * A faster "golden image" snapshot path is used automatically when available.
 *
 * It implements the SAME interface every other VPS/RDP provider exposes
 * (js/vps-provider.js + reseller-api.js vps*Handlers):
 *   PROVIDER, listProducts, getProduct, calculatePrice,
 *   createInstance / createInstanceWithFallback, getInstance,
 *   startInstance, stopInstance, restartInstance, shutdownInstance,
 *   cancelInstance, getSecretPassword.
 *
 * State lives in Mongo `doRdpServers` (droplet id, callback token, status,
 * progress, logs, expiry). The reseller API stores the returned instanceId
 * (our server_id) on vpsPlansOf; every action resolves droplet_id from here.
 */

const axios = require('axios')
const crypto = require('crypto')
const net = require('net')
const fs = require('fs')
const path = require('path')

const secretStore = require('./vps-secret-store')
// Live DigitalOcean size catalogue (GET /v2/sizes, refreshed every 15 min, persisted to Mongo).
const sizeCatalog = require('./do-size-catalog')

const log = (...a) => console.log('[DO-RDP]', ...a)
const PROVIDER = 'digitalocean-rdp'
// Bot-facing instance ids carry an `rdp-` prefix so vps-provider.js can route them here
// (bare UUIDs would be mistaken for Vultr). Internally doRdpServers.server_id stays the bare UUID.
const ID_PREFIX = 'rdp-'
const normId = (id) => String(id || '').replace(/^rdp-/i, '')
const extId = (id) => (id ? ID_PREFIX + normId(id) : id)
const DO_BASE = 'https://api.digitalocean.com/v2'
const SCRIPTS_DIR = path.join(__dirname, 'rdp-scripts')

// ─────────────────────────────────────────────────────────────
// Catalog (imported verbatim from the repo's database.py)
// ─────────────────────────────────────────────────────────────
const DURATIONS = [1, 2, 3]

// Sellable tiers. RDPs run ONLY on DigitalOcean Premium AMD droplets (AMD EPYC + NVMe) — owner
// decision 2026-10-14: Premium Intel and Basic shared-CPU droplets are too slow for Windows, so they
// are never used (not even as a fallback). Prices track the AMD monthly cost × months × 2 (see
// sellPrice): Standard $56/mo, Pro $112/mo, Power $224/mo.
// Speed lever 2: the 1vCPU/2GB "Starter" was retired 2026-09 (below Windows Server's memory
// floor → always slow). It lives in LEGACY_TIERS only, so servers already provisioned on it
// still render a name/spec; it is NOT sold anymore.
const TIERS = [
  { slug: 'standard', name: 'Standard', vcpu: 2, ram_gb: 4,  disk_gb: 80,  do_size_slug: 's-2vcpu-4gb-amd',  monthly_do_cost: 28 },
  { slug: 'pro',      name: 'Pro',      vcpu: 4, ram_gb: 8,  disk_gb: 160, do_size_slug: 's-4vcpu-8gb-amd',  monthly_do_cost: 56 },
  { slug: 'power',    name: 'Power',    vcpu: 8, ram_gb: 16, disk_gb: 320, do_size_slug: 's-8vcpu-16gb-amd', monthly_do_cost: 112 },
]
// Retired tiers — NOT sold, kept only so existing servers still resolve a name/spec.
const LEGACY_TIERS = [
  { slug: 'starter', name: 'Starter (legacy)', vcpu: 1, ram_gb: 2, disk_gb: 50, do_size_slug: 's-1vcpu-2gb', monthly_do_cost: 12 },
]
const TIER_BY_SLUG = new Map([...TIERS, ...LEGACY_TIERS].map(t => [t.slug, t]))

// ── LIVE, spec-based AMD size selection (2026-10-14) ─────────────────────────────────────────
// Until 2026-10-14 the size families sold per region were HARDCODED; DigitalOcean silently changed
// nyc3 and every New York order failed with 422 (memory/RDP_NYC3_SIZE_UNAVAILABLE_RCA_2026-10-14.md).
// Now DigitalOcean's live catalogue (js/do-size-catalog.js, refreshed every 15 min) decides:
//   • a tier is its SPEC — exact vCPU + RAM, disk ≥ the plan's, AMD CPU only;
//   • the chosen datacenter first, then other datacenters in the SAME city (nyc3 → nyc1/nyc2);
//   • a same-spec AMD size costing up to MAX_SIZE_COST_FACTOR × the tier's cost (+15%) may be
//     used — the extra cost is PASSED ON in the price quoted before payment (quoteFor);
//   • sizes DO just refused with 422 are skipped for 30 min (sizeCatalog.markRefused).
// With no catalogue at all (cold start + DigitalOcean unreachable + nothing in Mongo) the tier's AMD
// slug is tried in each same-city datacenter and the 422 walk decides.
const MAX_SIZE_COST_FACTOR = Math.max(1, Number(process.env.DO_RDP_MAX_SIZE_COST_FACTOR) || 1.15)
const round2 = (n) => Math.round(n * 100) / 100
// Accepts a tier, a product (slug = tier slug), a server doc (tier_slug), a tier slug or a plan_id.
function _tierOf(x) {
  if (!x) return null
  if (typeof x === 'string') return TIER_BY_SLUG.get(x) || TIER_BY_SLUG.get(x.replace(/-\d+m$/, '')) || null
  return TIER_BY_SLUG.get(x.slug || x.tier_slug) || null
}
const _isAmd = (s) => /-amd$/i.test(s.slug) || /\bAMD\b/i.test(s.description || '')
function _specMatch(t, s, cap) {
  return _isAmd(s) && s.vcpus === t.vcpu && s.memory === t.ram_gb * 1024 && s.disk >= t.disk_gb
    && s.price_monthly > 0 && s.price_monthly <= cap + 1e-9
}
// AMD sizes for a tier in ONE datacenter, cheapest first: [{ slug, cost }]. cap = max DO $/month.
function _sizeOptions(t, region, cap) {
  const r = String(region || '')
  if (!sizeCatalog.isLoaded()) return t.do_size_slug && !sizeCatalog.isRefused(t.do_size_slug, r) && t.monthly_do_cost <= cap + 1e-9 ? [{ slug: t.do_size_slug, cost: t.monthly_do_cost }] : []
  return sizeCatalog.sizesAvailableIn(r).filter(s => _specMatch(t, s, cap))
    .sort((a, b) => a.price_monthly - b.price_monthly || (b.slug === t.do_size_slug) - (a.slug === t.do_size_slug) || a.disk - b.disk || a.slug.localeCompare(b.slug))
    .map(s => ({ slug: s.slug, cost: s.price_monthly }))
}
// Ordered AMD size slugs for a tier in ONE datacenter (in-place resize / plan change). Default cap =
// the tier's own cost, so a resize never lands on a pricier size than the plan is billed at.
function sizeCandidatesFor(tier, regionSlug, { maxCost } = {}) {
  const t = _tierOf(tier)
  if (!t) return []
  return _sizeOptions(t, regionSlug, maxCost != null ? maxCost : t.monthly_do_cost).map(o => o.slug)
}
// Every (datacenter, AMD size) that can build this tier for a customer who chose `regionInput`:
// cheapest first; on equal cost the chosen datacenter wins. Default cap = tier cost × 1.15.
function buildOptions(tier, regionInput, { maxCost } = {}) {
  const t = _tierOf(tier)
  if (!t || !t.monthly_do_cost) return []
  const region = regionToSlug(regionInput)
  const cap = maxCost != null ? Number(maxCost) : t.monthly_do_cost * MAX_SIZE_COST_FACTOR
  const out = []
  ;[region, ...sizeCatalog.sameCityOf(region)].forEach((r, order) => {
    for (const o of _sizeOptions(t, r, cap)) out.push({ region: r, size: o.slug, cost: o.cost, order })
  })
  return out.sort((a, b) => a.cost - b.cost || a.order - b.order)
}
// Can this plan be built for a customer in `regionInput` right now — where, on what, at what DO cost?
function quoteFor(product, regionInput) {
  const t = _tierOf(product)
  const region = regionToSlug(regionInput)
  if (!t) return { region, in_stock: false, build_region: null, size_slug: null, do_cost: null, price_factor: 1, same_city: false }
  const best = buildOptions(t, region)[0] || null
  return {
    region, in_stock: !!best, build_region: best ? best.region : null, size_slug: best ? best.size : null,
    do_cost: best ? best.cost : t.monthly_do_cost, price_factor: best ? Math.round(best.cost / t.monthly_do_cost * 10000) / 10000 : 1,
    same_city: !!best && best.region !== region,
  }
}
// Display-only product shape for retired tiers (e.g. legacy 'starter' servers still running).
function legacyProductFor(s) {
  const t = TIER_BY_SLUG.get(s && s.tier_slug)
  if (!t) return null
  const m = s.duration_months || 1
  return { productId: `${t.slug}-${m}m`, slug: t.slug, cpuCores: t.vcpu, vcpus: t.vcpu, ramGb: t.ram_gb, ramMb: t.ram_gb * 1024, diskGb: t.disk_gb, diskMb: t.disk_gb * 1024, durationMonths: m, do_size_slug: t.do_size_slug }
}

const VIRTIO = 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso'
const OS_OPTIONS = {
  ws2019: { id: 'ws2019', name: 'Windows Server 2019', image_name: 'Windows Server 2019 SERVERSTANDARD', virtio_dir: '2k19', iso_url: 'https://go.microsoft.com/fwlink/p/?linkid=2195167&clcid=0x409&culture=en-us&country=US', virtio_url: VIRTIO, install_method: 'qemu', image_url: '' },
  ws2022: { id: 'ws2022', name: 'Windows Server 2022', image_name: 'Windows Server 2022 SERVERSTANDARD', virtio_dir: '2k22', iso_url: 'https://go.microsoft.com/fwlink/p/?LinkID=2195280&clcid=0x409&culture=en-us&country=US', virtio_url: VIRTIO, install_method: 'qemu', image_url: '' },
  // WS2025 (24H2) first boot is slower: the per-order password lands ~2-3 min AFTER 3389 opens (measured 2026-09-23),
  // so it gets a longer no-callback grace and an honest ETA.
  ws2025: { id: 'ws2025', name: 'Windows Server 2025', image_name: 'Windows Server 2025 SERVERSTANDARD', virtio_dir: '2k25', iso_url: 'https://go.microsoft.com/fwlink/?linkid=2293312&clcid=0x409&culture=en-us&country=US', virtio_url: VIRTIO, install_method: 'qemu', image_url: '', fast_eta_min: 5, boot_grace_ms: 300000 },
}
const fastEta = (o) => (o && o.fast_eta_min) || 3
const bootGraceMs = (o) => (o && o.boot_grace_ms) || T.callbackGraceMs
const DEFAULT_OS_ID = String(process.env.DO_RDP_DEFAULT_OS || 'ws2022').toLowerCase()

// Reseller region codes → DigitalOcean region slugs. Also accepts a raw DO slug.
const REGION_TO_DO = {
  EU: 'fra1', DE: 'fra1', NL: 'ams3', UK: 'lon1', GB: 'lon1',
  US: 'nyc3', USA: 'nyc3', 'US-EAST': 'nyc3', 'US-WEST': 'sfo3',
  CA: 'tor1', IN: 'blr1', SG: 'sgp1', SGP: 'sgp1', AU: 'syd1', SYD: 'syd1',
}
function regionToSlug(region) {
  const r = String(region || '').trim()
  if (/^[a-z]{3}\d$/i.test(r)) return r.toLowerCase() // already a DO slug e.g. nyc3
  return REGION_TO_DO[r.toUpperCase()] || 'nyc3'
}

// Golden-image build droplet: needs >=4 GB RAM for the QEMU install AND a 50 GB
// disk — a small 50 GB build keeps the snapshot's min_disk_size low so it fits
// EVERY sellable tier (smallest is now Standard = 80 GB after Starter was retired).
// gd-2vcpu-8gb = dedicated 2 vCPU / 8 GB / 50 GB (~$0.10/h; a build is ~1 h).
const BUILD_SIZE = process.env.DO_RDP_BUILD_SIZE || 'gd-2vcpu-8gb'
// Same 50 GB disk, tried in order when DO reports "Size is not available in this region" (capacity fluctuates).
// Golden-image BUILD droplet only (admin template prep) — customer RDPs are AMD-only via _sizeOptions.
const BUILD_SIZE_FALLBACKS = ['c-4', 'm-2vcpu-16gb', 'm-2vcpu-16gb-intel', 'c-4-intel', 'c2-2vcpu-4gb']
const BUILD_DISK_GB = 50
const BUILD_REGION = process.env.DO_RDP_BUILD_REGION || 'nyc3'
const GOLDEN_ALL_REGIONS = [...new Set(Object.values(REGION_TO_DO))]
const UBUNTU_IMAGE = process.env.DO_UBUNTU_IMAGE || 'ubuntu-22-04-x64'

// Poll timings (ms / min) — exported as _timing so tests can shrink them.
const T = { bootPoll: 5000, rdpPoll: 30000, actionPoll: 15000, offPoll: 10000, rdpPort: 3389, rdpMaxMin: 90, transferMaxMin: 90, buildMaxMin: 120, importPoll: 30000, importMaxMin: 240, importRetryMin: 150, importRetries: 2, importSlotMaxMin: 480, callbackGraceMs: 90000, fastTargetMs: 180000, digestMs: 24 * 60 * 60 * 1000, commandWaitMs: 150000, commandPoll: 2000, agentStaleMs: 10 * 60 * 1000, rebuildMaxMin: 20, graceDays: Number(process.env.RDP_GRACE_DAYS || 2),
  // Late-failure safety net: a first build still unfinished after stuckBuildMin is failed (→ refund); failed orders
  // the purchase flow still owned are re-checked once they are failedRecheckMs old. Sweep runs every reconcileMs.
  stuckBuildMin: Math.max(120, Number(process.env.DO_RDP_STUCK_BUILD_MIN) || 180), failedRecheckMs: 30 * 60000, reconcileMs: 10 * 60000 }

// ─────────────────────────────────────────────────────────────
// Admin alerts (Telegram via the bot's notifyAdmin, injected by _index.js init)
// ─────────────────────────────────────────────────────────────
let _notifyAdmin = null
let _onOrderFailed = null
let _onReinstallEvent = null // ({ type: 'started'|'failed', server_id, instanceId, osId, osName, password?, etaMinutes?, reason?, source })
const _alertSeen = new Map()
const _xfer = new Map()          // `${imageId}@${region}` → in-flight transfer promise (one copy per image+datacenter)
const _xferFailedAt = new Map()  // same key → last failure (auto-copy backs off 6 h)
const COPY_ETA_MIN = 20          // typical DigitalOcean image copy between datacenters (~9-14 GB)
function alertAdmin(key, message) {
  const now = Date.now()
  for (const [k, t] of _alertSeen) if (now - t > 10 * 60 * 1000) _alertSeen.delete(k)
  if (key && _alertSeen.has(key)) return false
  if (key) _alertSeen.set(key, now)
  log(`ADMIN ALERT: ${message.replace(/\n/g, ' | ')}`)
  if (!_notifyAdmin) return false
  try { const r = _notifyAdmin(`🖥 DO-RDP\n${message}`); if (r && r.catch) r.catch(() => {}) } catch (_) {}
  return true
}
const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`)
const orderRef = (s) => `${(s.server_id || '').slice(0, 8)} (${s.os_id || '?'}, ${s.region || '?'}, ${s.tier_slug || '?'}${s.label ? `, "${s.label}"` : ''})`

// ─────────────────────────────────────────────────────────────
// Products (tier × duration). productId encodes both, so it slots into the
// generic reseller vps flow (which has no duration param). Price = repo's
// monthly_do_cost × months × 2, then a multi-month bundle discount (2mo −10%, 3mo −15%).
// ─────────────────────────────────────────────────────────────
// Multi-month bundle discount: 2-month = 10% off, 3-month = 15% off (1-month = no discount).
// Base = monthly_do_cost × months × 2; discount applied on top as a multi-month incentive.
const BUNDLE_DISCOUNT = { 1: 0, 2: 0.10, 3: 0.15 }
function bundleDiscount(months) { return BUNDLE_DISCOUNT[Number(months)] || 0 }
// doCost = the DO $/month of the AMD size the order will run on (defaults to the tier's own cost).
function sellPrice(tier, months, doCost = tier.monthly_do_cost) {
  const base = doCost * months * 2
  return Math.round(base * (1 - bundleDiscount(months)) * 100) / 100
}

function _pricing(t, m, doCost) {
  const price = sellPrice(t, m, doCost)
  const basePrice = sellPrice(t, m)
  return { base: price, markup: 0, totalWithMarkup: price, basePriceUsd: price, regionSurcharge: round2(price - basePrice), windowsLicense: 0, totalBeforeMarkup: price, currency: 'usd', durationMonths: m, discountPct: Math.round(bundleDiscount(m) * 100) }
}
function _products() {
  const out = []
  TIERS.forEach((t, tierIdx) => {
    for (const m of DURATIONS) {
      out.push({
        productId: `${t.slug}-${m}m`,
        slug: t.slug,
        durationMonths: m,
        name: `${t.name} — Windows RDP (${m} month${m > 1 ? 's' : ''})`,
        botName: `${t.name} — Windows RDP`,
        vcpus: t.vcpu, ramGb: t.ram_gb, diskGb: t.disk_gb,
        // bot / vm-instance-setup compat fields
        cpuCores: t.vcpu, ramMb: t.ram_gb * 1024, diskMb: t.disk_gb * 1024, diskType: 'nvme', bandwidthTb: 4, portSpeedMbps: 1000, tier: tierIdx + 1,
        do_size_slug: t.do_size_slug,
        pricing: _pricing(t, m, t.monthly_do_cost),
      })
    }
  })
  return out
}
const PRODUCTS = _products()
const PRODUCT_BY_ID = new Map(PRODUCTS.map(p => [p.productId, p]))

// The product as sold in one region RIGHT NOW: stock (live, same-city aware) + the price for the AMD
// size it will run on (a pricier same-spec size raises the price; regionSurcharge shows the extra).
function productInRegion(product, regionSlug) {
  const p = typeof product === 'string' ? getProduct(product) : (getProduct(product && product.productId) || product)
  const t = _tierOf(p)
  if (!p || !t) return null
  const q = quoteFor(t, regionSlug)
  const pricing = q.do_cost === t.monthly_do_cost ? p.pricing : _pricing(t, p.durationMonths || 1, q.do_cost)
  return { ...p, pricing, inStock: q.in_stock, quote: q }
}
// Bot purchase flow is monthly: hide the 2/3-month bundles there (the reseller API still sells them).
// Out-of-stock plans are left out unless includeOutOfStock (reseller GET /rdp/plans shows them flagged).
function listProducts(regionSlug = 'EU', isWindows = true, _diskPreference, { monthlyOnly = false, includeOutOfStock = false } = {}) {
  if (isWindows === false) return [] // this provider is RDP-only
  const out = (monthlyOnly ? PRODUCTS.filter(p => p.durationMonths === 1) : PRODUCTS).map(p => productInRegion(p, regionSlug))
  return includeOutOfStock ? out : out.filter(p => p.inStock)
}
function getProduct(planId) { return PRODUCT_BY_ID.get(String(planId || '')) || null }
function calculatePrice(product, regionSlug, _isWindows) {
  const p = typeof product === 'string' ? getProduct(product) : product
  if (!p || !p.pricing) return null
  if (!regionSlug) return p.pricing
  const r = productInRegion(p, regionSlug)
  return r ? r.pricing : p.pricing
}
// Live stock gate used before taking payment (bot) and by the reseller API (409 out_of_stock).
function isProductAvailable(planId, regionSlug) {
  const p = getProduct(planId)
  return !!p && quoteFor(p, regionSlug).in_stock
}
// RDP stock per sellable region × tier (reseller GET /rdp/availability, admin stock alerts).
// datacenters = every datacenter of the city and which plans DigitalOcean will build there right now
// (matches DigitalOcean's control panel, e.g. New York: nyc3 none · nyc1 + nyc2 all plans).
function availability() {
  return listRegions().map(r => ({
    region: r.code, region_slug: r.regionSlug, label: r.display.label, emoji: r.display.emoji,
    plans: TIERS.map(t => {
      const q = quoteFor(t, r.regionSlug)
      return { plan: t.slug, name: t.name, in_stock: q.in_stock, build_region: q.build_region, same_city_fallback: q.same_city, size_slug: q.size_slug, price_usd: sellPrice(t, 1, q.do_cost), base_price_usd: sellPrice(t, 1), surcharge_pct: Math.round((q.price_factor - 1) * 1000) / 10 }
    }),
    datacenters: [r.regionSlug, ...sizeCatalog.sameCityOf(r.regionSlug)].map(dc => ({
      datacenter: dc, plans_in_stock: TIERS.filter(t => _sizeOptions(t, dc, t.monthly_do_cost * MAX_SIZE_COST_FACTOR).length).map(t => t.slug),
    })),
  }))
}
function formatSpecs(p) { return p ? `${p.cpuCores || p.vcpus} vCPU · ${p.ramGb} GB RAM · ${p.diskGb} GB NVMe · Windows Server` : '' }
// Renewal price for an EXISTING server, RE-CHECKED at every renewal (owner decisions 2026-10-14): what this
// plan costs in the server's city right now (live AMD stock — a pricier same-spec size raises it, restored
// stock lowers it), clamped to [plan base, base +15%]. No AMD stock anywhere in the city right now → the
// normal plan price (the server keeps running). null = not a sellable-tier DO-RDP server (callers keep theirs).
async function renewalPrice(instanceId, months = 1) {
  const s = _servers ? await _servers.findOne({ server_id: normId(instanceId) }) : null
  const t = s && TIERS.find(x => x.slug === s.tier_slug)
  if (!t) return null
  const m = Math.min(3, Math.max(1, parseInt(months, 10) || 1))
  const q = quoteFor(t, s.requested_region || s.region)
  const source = q.in_stock ? 'live_quote' : 'base_no_stock'
  const raw = q.in_stock ? q.do_cost : t.monthly_do_cost
  const cost = round2(Math.min(Math.max(raw, t.monthly_do_cost), t.monthly_do_cost * MAX_SIZE_COST_FACTOR))
  const price = sellPrice(t, m, cost)
  const base = sellPrice(t, m)
  return { months: m, price_usd: price, base_price_usd: base, surcharge_usd: round2(price - base), surcharge_pct: Math.round((cost / t.monthly_do_cost - 1) * 1000) / 10, do_monthly_cost: cost, price_source: source, checked_at: new Date().toISOString(), size_slug: s.do_size_slug || null, datacenter: s.region || null, tier: t.slug }
}

// Speed lever 4: a ready-made .rdp connection file tuned for a fast/LAN-like experience so the
// customer isn't stuck on laggy client defaults (bitmap caching ON, wallpaper/animations OFF,
// full 32-bit colour, high-speed connection profile). Returns null without a valid IP.
function buildRdpFile(ip, username = 'Administrator') {
  if (!ip || typeof ip !== 'string') return null
  const lines = [
    `full address:s:${ip}:3389`,
    `username:s:${username || 'Administrator'}`,
    'screen mode id:i:2',            // full screen
    'session bpp:i:32',              // 32-bit colour
    'compression:i:1',               // enable compression
    'bitmapcachepersistenable:i:1',  // persist bitmap cache across sessions
    'connection type:i:6',           // LAN (10 Mbps+) high-speed profile
    'networkautodetect:i:0',         // trust the LAN profile, skip auto-detect
    'bandwidthautodetect:i:1',
    'disable wallpaper:i:1',
    'disable menu anims:i:1',
    'disable full window drag:i:1',
    'allow font smoothing:i:1',
    'audiomode:i:2',                 // do not play remote audio (less bandwidth)
    'redirectclipboard:i:1',
    'authentication level:i:2',
    'prompt for credentials:i:0',
    'administrative session:i:0',
  ]
  return lines.join('\r\n') + '\r\n'
}

// Regions for the bot's country step (same 9 datacenters the reseller API maps to).
const REGION_DISPLAY = {
  nyc3: { emoji: '🇺🇸', label: 'United States (New York)', code: 'US' },
  sfo3: { emoji: '🇺🇸', label: 'United States (San Francisco)', code: 'US-WEST' },
  tor1: { emoji: '🇨🇦', label: 'Canada (Toronto)', code: 'CA' },
  lon1: { emoji: '🇬🇧', label: 'United Kingdom (London)', code: 'UK' },
  fra1: { emoji: '🇩🇪', label: 'Germany (Frankfurt)', code: 'EU' },
  ams3: { emoji: '🇳🇱', label: 'Netherlands (Amsterdam)', code: 'NL' },
  blr1: { emoji: '🇮🇳', label: 'India (Bangalore)', code: 'IN' },
  sgp1: { emoji: '🇸🇬', label: 'Singapore', code: 'SG' },
  syd1: { emoji: '🇦🇺', label: 'Australia (Sydney)', code: 'AU' },
}
function listRegions() { return Object.entries(REGION_DISPLAY).map(([slug, d]) => ({ regionSlug: slug, code: d.code, display: { emoji: d.emoji, label: d.label } })) }
// Default Windows edition for a plan when the customer did not pick one: the fastest ready one (prefers 2022).
async function getDefaultWindowsImageId(_productId) {
  const opts = await listOsOptions()
  const fast = opts.filter(o => o.fast_deploy)
  return (fast.find(o => o.id === DEFAULT_OS_ID) || fast[0] || opts.find(o => o.id === DEFAULT_OS_ID) || opts[0]).id
}

// ─────────────────────────────────────────────────────────────
// DigitalOcean v2 client (token stays server-side)
// ─────────────────────────────────────────────────────────────
function _token() { return process.env.DIGITALOCEAN_API_TOKEN || '' }
async function doRequest(method, urlPath, body) {
  const token = _token()
  if (!token) throw new Error('DIGITALOCEAN_API_TOKEN not configured')
  const res = await axios({
    method, url: `${DO_BASE}${urlPath}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body || undefined, timeout: 60000, validateStatus: () => true,
  })
  if (res.status >= 400) {
    const detail = (res.data && res.data.message) || (typeof res.data === 'string' ? res.data.slice(0, 300) : `HTTP ${res.status}`)
    const err = new Error(`DigitalOcean API error ${res.status}: ${detail}`)
    err.status = res.status
    throw err
  }
  return res.data || {}
}
const doCreateDroplet = (b) => doRequest('POST', '/droplets', b)
const doGetDroplet = (id) => doRequest('GET', `/droplets/${id}`)
const doDropletAction = (id, b) => doRequest('POST', `/droplets/${id}/actions`, b)
const doDeleteDroplet = (id) => doRequest('DELETE', `/droplets/${id}`)
const doGetAction = (id) => doRequest('GET', `/actions/${id}`)
const doGetImage = (id) => doRequest('GET', `/images/${id}`)
const doDeleteImage = (id) => doRequest('DELETE', `/images/${id}`)
const doImageAction = (id, b) => doRequest('POST', `/images/${id}/actions`, b)
const doListPrivateImages = () => doRequest('GET', '/images?private=true&per_page=200')
const doCreateCustomImage = (b) => doRequest('POST', '/images', b)
const doListSshKeys = () => doRequest('GET', '/account/keys?per_page=200')
const doCreateSshKey = (b) => doRequest('POST', '/account/keys', b)

// Droplets from custom images MUST be created with an SSH key (DO: "does not use root passwords").
// Windows ignores it — apply.ps1 sets the per-order Administrator password — so one throwaway
// ed25519 public key per account is registered once and reused.
const SSH_KEY_NAME = 'nomadly-rdp-golden'
let _sshKeyId = null
async function ensureSshKeyId() {
  if (process.env.DO_RDP_SSH_KEY_ID) return Number(process.env.DO_RDP_SSH_KEY_ID)
  if (_sshKeyId) return _sshKeyId
  const found = (((await doListSshKeys()).ssh_keys) || []).find(k => k.name === SSH_KEY_NAME)
  if (found) return (_sshKeyId = found.id)
  const raw = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const field = (buf) => Buffer.concat([Buffer.from([0, 0, 0, buf.length]), buf])
  const wire = Buffer.concat([field(Buffer.from('ssh-ed25519')), field(raw)]).toString('base64')
  const created = (await doCreateSshKey({ name: SSH_KEY_NAME, public_key: `ssh-ed25519 ${wire} ${SSH_KEY_NAME}` })).ssh_key || {}
  if (!created.id) throw new Error('could not register the golden-image SSH key on DigitalOcean')
  return (_sshKeyId = created.id)
}
const doListDropletsByTag = (tag) => doRequest('GET', `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=200`)
const doCreateVolume = (b) => doRequest('POST', '/volumes', b)
const doDeleteVolume = (id) => doRequest('DELETE', `/volumes/${id}`)
const doVolumeAction = (id, b) => doRequest('POST', `/volumes/${id}/actions`, b)
const doListVolumesByName = (name, region) => doRequest('GET', `/volumes?name=${encodeURIComponent(name)}&region=${encodeURIComponent(region)}`)
const doListRegions = () => doRequest('GET', '/regions?per_page=200')

// Build sizes in preference order, the ones DO currently offers in this region first.
async function buildSizeCandidates(region) {
  const all = [...new Set([BUILD_SIZE, ...BUILD_SIZE_FALLBACKS])]
  let avail = null
  try { avail = ((((await doListRegions()).regions) || []).find(r => r.slug === region) || {}).sizes || null } catch (_) {}
  if (!avail) return all
  return [...all.filter(s => avail.includes(s)), ...all.filter(s => !avail.includes(s))]
}

// Windows is installed onto a block-storage volume (then dd'd over the boot disk)
// so Ubuntu's disk - which holds the ISOs - is never overwritten mid-install.
const CONVERT_VOLUME_GB = Number(process.env.DO_RDP_CONVERT_VOLUME_GB || 32)

// Create the install-target volume, then the Ubuntu droplet with it attached.
async function launchConversion({ name, region, size, doc, osOption, tags }) {
  const volName = `${name}-win`
  let vol = null
  try { vol = (((await doListVolumesByName(volName, region)).volumes) || [])[0] || null } catch (_) {}
  if (!vol) vol = (await doCreateVolume({ size_gigabytes: CONVERT_VOLUME_GB, name: volName, region, description: 'Windows RDP conversion target (auto-deleted)' })).volume
  const targetDisk = `/dev/disk/by-id/scsi-0DO_Volume_${volName}`
  try {
    const d = (await doCreateDroplet({ name, region, size, image: UBUNTU_IMAGE, user_data: buildUserData(doc, osOption, targetDisk), tags, volumes: [vol.id] })).droplet || {}
    if (!d.id) throw new Error('DigitalOcean returned no droplet id')
    return { dropletId: d.id, volumeId: vol.id }
  } catch (e) {
    try { await doDeleteVolume(vol.id) } catch (_) {}
    throw e
  }
}

// Detach (best effort) + delete the conversion volume; retried because DO needs a moment after detach.
async function releaseVolume(volumeId, dropletId) {
  if (!volumeId) return false
  try { if (dropletId) await doVolumeAction(volumeId, { type: 'detach', droplet_id: dropletId }) } catch (_) {}
  for (let i = 0; i < 8; i++) {
    try { await doDeleteVolume(volumeId); return true } catch (e) { if (e.status === 404) return true }
    await sleep(T.offPoll)
  }
  log(`releaseVolume(${volumeId}) could not delete the volume - remove it manually`)
  return false
}

// ─────────────────────────────────────────────────────────────
// Mongo state (doRdpServers, doRdpOsOptions, doRdpImageBuilds) — initialised once from _index.js
// ─────────────────────────────────────────────────────────────
let _servers = null
let _osCol = null
let _builds = null
let _agentMetrics = null
let _db = null
function init(db, { notifyAdmin, onOrderFailed, onReinstallEvent } = {}) {
  try {
    if (!db || typeof db.collection !== 'function') return false
    if (typeof notifyAdmin === 'function') _notifyAdmin = notifyAdmin
    if (typeof onOrderFailed === 'function') _onOrderFailed = onOrderFailed
    if (typeof onReinstallEvent === 'function') _onReinstallEvent = onReinstallEvent
    _db = db
    _servers = db.collection('doRdpServers')
    _osCol = db.collection('doRdpOsOptions')
    _builds = db.collection('doRdpImageBuilds')
    _agentMetrics = db.collection('doRdpAgentMetrics')
    _agentMetrics.createIndex({ server_id: 1, at: 1 }).catch(() => {})
    _agentMetrics.createIndex({ at: 1 }, { expireAfterSeconds: 31 * 86400 }).catch(() => {})
    _servers.createIndex({ server_id: 1 }, { unique: true }).catch(() => {})
    _servers.createIndex({ status: 1, expires_at: 1 }).catch(() => {})
    _builds.createIndex({ build_id: 1 }, { unique: true }).catch(() => {})
    // Seed golden-image state rows for each OS (idempotent).
    for (const id of Object.keys(OS_OPTIONS)) {
      _osCol.updateOne(
        { _id: id },
        { $setOnInsert: { _id: id, golden_status: 'none', golden_image_id: null, golden_regions: [], golden_min_disk_gb: 0 } },
        { upsert: true },
      ).catch(() => {})
    }
    log('initialised (collections=doRdpServers, doRdpOsOptions, doRdpImageBuilds)')
    // Expiry sweep + daily deploy digest — NEVER on a dev sandbox (would power off real servers / spam admin).
    if (process.env.SKIP_WEBHOOK_SYNC !== 'true') {
      setInterval(() => { processExpiries().catch(e => log('expiry sweep error:', e.message)) }, 60 * 60 * 1000)
      setInterval(() => { sendDailyDigest().catch(e => log('digest error:', e.message)) }, T.digestMs)
      setInterval(() => { reconcileOrders().catch(e => log('order reconcile error:', e.message)) }, T.reconcileMs).unref()
      // Keep every Windows image in every datacenter an order could be built in (re-checked after each stock refresh).
      if (_token() && process.env.DO_RDP_GOLDEN_AUTOCOPY !== 'false') {
        sizeCatalog.onRefresh(() => { ensureGoldenAtBuildSites().catch(e => log('golden auto-copy error:', e.message)) })
      }
    } else {
      log('SKIP_WEBHOOK_SYNC=true — expiry sweep + daily digest DISABLED (dev sandbox)')
    }
    // Golden images: DO snapshots are the source of truth (read-only sync, safe on
    // every pod) and any build interrupted by a restart is resumed at its phase.
    if (_token() && process.env.DO_RDP_GOLDEN_AUTOSYNC !== 'false') {
      setTimeout(() => {
        syncGoldenFromDO().then(r => log('golden sync:', JSON.stringify(r))).catch(e => log('golden sync error:', e.message))
        resumeBuilds().catch(e => log('resumeBuilds error:', e.message))
        resumeQueuedReinstalls().catch(e => log('resumeQueuedReinstalls error:', e.message))
      }, 15000)
      setInterval(() => { syncGoldenFromDO().catch(e => log('golden sync error:', e.message)) }, 6 * 60 * 60 * 1000)
    }
    return true
  } catch (e) {
    log('init failed:', e.message || e)
    return false
  }
}

async function getOsOption(osId) {
  const base = OS_OPTIONS[osId] || OS_OPTIONS[DEFAULT_OS_ID]
  let golden = null
  try { if (_osCol) golden = await _osCol.findOne({ _id: base.id }) } catch (_) {}
  const { _id, ...g } = golden || {}
  return { ...base, golden_status: 'none', golden_image_id: null, golden_regions: [], golden_min_disk_gb: 0, ...g }
}

// Fast deploy (~3 min) only when the datacenter an order would be BUILT in right now holds the golden image:
// a same-city fallback (New York nyc3 → nyc1) without it is a full Windows install (~45 min).
function _fastIn(o, slug) {
  if (!(o.golden_status === 'available' && o.golden_image_id)) return false
  const t = TIERS[0]
  const first = _attemptsFor({ tier_slug: t.slug, requested_region: slug, region: slug, disk_gb: t.disk_gb, max_do_cost: t.monthly_do_cost * MAX_SIZE_COST_FACTOR }, o)[0]
  return first ? first.fast : (o.golden_regions || []).includes(slug)
}

// Reseller-facing OS list: which editions deploy in ~3 min (golden image) and where.
async function listOsOptions() {
  const all = await Promise.all(Object.keys(OS_OPTIONS).map(getOsOption))
  return all.map(o => {
    const fast = o.golden_status === 'available' && !!o.golden_image_id
    return {
      id: o.id, name: o.name, default: o.id === DEFAULT_OS_ID,
      fast_deploy: fast, eta_minutes: fast ? fastEta(o) : 45,
      fast_deploy_regions: fast ? Object.entries(REGION_TO_DO).filter(([, slug]) => _fastIn(o, slug)).map(([code]) => code) : [],
    }
  })
}

// Bot-facing: editions with fast-deploy readiness for ONE region (bot regions are DO slugs or reseller codes).
async function listOsOptionsForRegion(region) {
  const slug = regionToSlug(region)
  const all = await Promise.all(Object.keys(OS_OPTIONS).map(getOsOption))
  return all.map(o => {
    const golden = o.golden_status === 'available' && !!o.golden_image_id
    const fast = _fastIn(o, slug)
    return { id: o.id, name: o.name, default: o.id === DEFAULT_OS_ID, golden, fast_deploy: fast, eta_minutes: fast ? fastEta(o) : 45 }
  })
}

function goldenFastPathOk(server, osOption) {
  const goldenReady = osOption.golden_status === 'available' && !!osOption.golden_image_id
  const diskOk = (server.disk_gb || 0) >= (osOption.golden_min_disk_gb || 1e9)
  const regionReady = (osOption.golden_regions || []).includes(server.region)
  return { goldenReady, diskOk, regionReady, ok: goldenReady && diskOk && regionReady }
}

// ─────────────────────────────────────────────────────────────
// Helpers ported from provisioning.py
// ─────────────────────────────────────────────────────────────
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*()-_=+'
function genPassword(n = 18) {
  let s = ''
  for (let i = 0; i < n; i++) s += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)]
  return s
}
function genToken() { return crypto.randomBytes(24).toString('base64url') }
function callbackBase() { return String(process.env.SELF_URL || '').replace(/\/+$/, '') } // already ends with /api

/** Windows Setup FirstLogonCommands: RDP on, copy apply.ps1 from the answer disc (attached as a
 *  CD during the QEMU first boot), register it as a boot task, then shut Windows down (the build
 *  host verifies the baked files offline and ships the disk). No network, no certutil. */
function firstLogonCommandsXml() {
  const cmds = [
    'cmd /c reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f',
    'cmd /c reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" /v UserAuthentication /t REG_DWORD /d 1 /f',
    'cmd /c netsh advfirewall firewall set rule group="remote desktop" new enable=Yes',
    'cmd /c mkdir C:\\cloudinit',
    'cmd /c for %d in (D E F G H I) do if exist %d:\\cloudinit\\apply.ps1 copy /y %d:\\cloudinit\\apply.ps1 C:\\cloudinit\\apply.ps1',
    'cmd /c schtasks /create /tn CloudInitApply /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\cloudinit\\apply.ps1" /sc onstart /ru SYSTEM /rl HIGHEST /f',
    'cmd /c shutdown /s /t 20 /f /d p:4:1 /c "Windows image build complete"',
  ]
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return cmds.map((c, i) => `        <SynchronousCommand wcm:action="add">\n          <Order>${i + 1}</Order>\n          <CommandLine>${esc(c)}</CommandLine>\n        </SynchronousCommand>`).join('\n')
}

/** Build the Ubuntu→Windows conversion cloud-init user-data (full path). */
function buildUserData(server, osOption, targetDisk) {
  let script = fs.readFileSync(path.join(SCRIPTS_DIR, 'convert_to_windows.sh'), 'utf8')
  let answer = fs.readFileSync(path.join(SCRIPTS_DIR, 'autounattend.xml.tmpl'), 'utf8')
  const base = callbackBase()
  answer = answer.split('{{ADMIN_PASSWORD}}').join(server.admin_password)
  answer = answer.split('{{IMAGE_NAME}}').join(osOption.image_name)
  answer = answer.split('{{FIRST_LOGON_COMMANDS}}').join(firstLogonCommandsXml())
  const answerB64 = Buffer.from(answer, 'utf8').toString('base64')
  const repl = {
    '{{ISO_URL}}': osOption.iso_url,
    '{{VIRTIO_URL}}': osOption.virtio_url,
    '{{INSTALL_METHOD}}': osOption.install_method || 'qemu',
    '{{IMAGE_URL}}': osOption.image_url || '',
    '{{VIRTIO_DIR}}': osOption.virtio_dir || '2k22',
    '{{APPLY_SHA256}}': crypto.createHash('sha256').update(fs.readFileSync(path.join(SCRIPTS_DIR, 'apply.ps1'))).digest('hex'),
    '{{APPLY_PS1_B64}}': fs.readFileSync(path.join(SCRIPTS_DIR, 'apply.ps1')).toString('base64'),
    '{{CALLBACK_URL}}': `${base}/provision/callback`,
    '{{CALLBACK_TOKEN}}': server.callback_token,
    '{{SERVER_ID}}': server.server_id,
    '{{TARGET_DISK}}': targetDisk || '',
    '{{VNC_PASSWORD}}': server.vnc_password || '',
    '{{BUILD_MODE}}': server.build_mode || 'direct',
    '{{IMAGE_TOKEN}}': server.image_token || '',
    '{{AUTOUNATTEND_B64}}': answerB64,
  }
  for (const [k, v] of Object.entries(repl)) script = script.split(k).join(v)
  return script
}

/** Plain KEY=VALUE user-data read by the baked apply.ps1 on golden droplets. */
function buildMetadataUserData(server) {
  const base = callbackBase()
  return `ADMIN_PASSWORD=${server.admin_password}\n` +
         `CALLBACK_URL=${base}/provision/callback\n` +
         `CALLBACK_TOKEN=${server.callback_token}\n` +
         `SERVER_ID=${server.server_id}\n`
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function addLog(serverId, stage, message, progress, status) {
  if (!_servers) return
  const set = { updated_at: new Date() }
  if (progress != null) set.progress = progress
  if (status != null) set.status = status
  try {
    await _servers.updateOne({ server_id: serverId },
      { $push: { logs: { ts: new Date(), stage, message } }, $set: set })
  } catch (e) { log(`addLog(${serverId}) warn: ${e.message}`) }
  if (status === 'failed') {
    const s = await _servers.findOne({ server_id: serverId }).catch(() => null) || { server_id: serverId }
    alertAdmin(`fail:${serverId}`, `❌ RDP order ${orderRef(s)} FAILED after ${fmtSecs((Date.now() - new Date(s.created_at || Date.now())) / 1000)}\n${message}${s.ip_address ? `\nIP ${s.ip_address}` : ''}${s.do_droplet_id ? ` · droplet ${s.do_droplet_id}` : ''}`)
    handleFailedOrder(serverId).catch(e => log(`handleFailedOrder(${serverId}) error: ${e.message}`))
  }
}

// A FIRST build that ended 'failed' → the bot's refund/notify handler (once; reinstall failures of a live
// server and servers created before this existed are never refunded). retry = the purchase flow still owns it.
const _reasonCode = (m) => (/no AMD capacity|out of stock/i.test(m || '') ? 'out_of_stock' : /not reachable|did not finish|timed? ?out/i.test(m || '') ? 'provisioning_timeout' : 'provision_failed')
async function handleFailedOrder(serverId) {
  if (!_onOrderFailed || !_servers) return null
  const s = await _servers.findOne({ server_id: serverId })
  if (!s || s.status !== 'failed' || s.activated_at || s.failure_handled_at || s.refund_on_failure !== true) return null
  const last = (s.logs || []).filter(l => l.stage === 'failed').slice(-1)[0]
  const reason = (last && last.message) || 'Provisioning failed'
  const r = await _onOrderFailed({ instanceId: extId(serverId), serverId, reason, reasonCode: _reasonCode(reason), createdAt: s.created_at || null })
  if (r && r.retry) return r
  await _servers.updateOne({ server_id: serverId }, { $set: { failure_handled_at: new Date(), failure_outcome: (r && r.action) || null } })
  return r
}

// Safety net (every 10 min, production): a first build that never finished (e.g. its poller died in a restart)
// is failed after stuckBuildMin unless RDP already answers, and failed orders not yet handled are retried.
async function reconcileOrders({ now = new Date() } = {}) {
  if (!_servers) return { stuck: 0, handled: 0 }
  let stuck = 0, handled = 0
  const stuckCutoff = new Date(now.getTime() - T.stuckBuildMin * 60000)
  const building = await _servers.find({ status: { $in: ['queued', 'creating', 'booting', 'installing', 'converting', 'rdp_up'] }, activated_at: null, refund_on_failure: true, created_at: { $lt: stuckCutoff } }).limit(50).toArray()
  for (const s of building) {
    if (s.ip_address && await tcpOpen(s.ip_address, T.rdpPort)) {
      await applyActivation(s)
      await addLog(s.server_id, 'rdp_ready', `RDP reachable at ${s.ip_address}:3389 (found by the stuck-build check). Server is active.`, 100, 'active')
      continue
    }
    await addLog(s.server_id, 'failed', `Windows setup did not finish within ${Math.round(T.stuckBuildMin / 60)} h (last status: ${s.status}).`, null, 'failed')
    stuck++
  }
  const failed = await _servers.find({ status: 'failed', activated_at: null, refund_on_failure: true, failure_handled_at: { $exists: false }, created_at: { $lt: new Date(now.getTime() - T.failedRecheckMs) } }).limit(50).toArray()
  for (const s of failed) { const r = await handleFailedOrder(s.server_id).catch(() => null); if (r && !r.retry) handled++ }
  return { stuck, handled }
}

// Fast-path promise = RDP-ready in ~3 min. Alert the admin once if an order is still provisioning past the target.
function watchFastTarget(serverId, targetMs = T.fastTargetMs) {
  setTimeout(async () => {
    const s = _servers ? await _servers.findOne({ server_id: serverId }).catch(() => null) : null
    if (!s || ['active', 'failed', 'destroyed', 'suspended', 'expired'].includes(s.status)) return
    const last = (s.logs || []).slice(-1)[0] || {}
    alertAdmin(`slow:${serverId}`, `⏱ RDP order ${orderRef(s)} missed the ${Math.round(targetMs / 60000)}-min fast-deploy target\nstatus=${s.status} progress=${s.progress || 0}% stage=${last.stage || '-'}\n${last.message || ''}${s.ip_address ? `\nIP ${s.ip_address}` : ''}`)
  }, targetMs).unref()
}

function tcpOpen(ip, port = 3389, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy() } catch (_) {} resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
    try { sock.connect(port, ip) } catch (_) { finish(false) }
  })
}

// Resolves { ip } once the droplet is active, { ip: null } on timeout, { gone: true } if DO
// deleted it (a "create" action that errored — e.g. an image DO cannot provision).
async function waitBootIp(dropletId, tries = 72) {
  for (let i = 0; i < tries; i++) {
    await sleep(T.bootPoll)
    let d
    try { d = (await doGetDroplet(dropletId)).droplet || {} } catch (e) { if (e.status === 404) return { ip: null, gone: true }; continue }
    if (d.status === 'active') {
      const v4 = (d.networks && d.networks.v4) || []
      const pub = v4.find(n => n.type === 'public')
      if (pub && pub.ip_address) return { ip: pub.ip_address }
    }
  }
  return { ip: null }
}

async function applyActivation(server) {
  const activated = new Date()
  const set = { status: 'active', progress: 100 }
  if (server.expires_at) {
    // Reinstall of an already-activated server: the paid period is untouched.
    set.reinstalled_at = activated
  } else {
    set.activated_at = activated
    set.expires_at = new Date(activated.getTime() + 30 * (server.duration_months || 1) * 86400000)
    set.time_to_active_s = server.created_at ? Math.round((activated - new Date(server.created_at)) / 1000) : null
  }
  // Keep the first activation timestamp if the port probe and the callback both fire.
  await _servers.updateOne({ server_id: server.server_id, status: { $ne: 'active' } }, { $set: set })
}

// Renewal hook (bot auto-renew / manual renew): push the paid period; wake an expired server.
async function renewInstance(instanceId, months = 1) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s) throw new Error('unknown RDP server')
  const m = Math.max(1, Number(months) || 1)
  const base = s.expires_at && new Date(s.expires_at) > new Date() ? new Date(s.expires_at) : new Date()
  const expires = new Date(base.getTime() + 30 * m * 86400000)
  const set = { expires_at: expires, renewed_at: new Date() }
  // A renewal always clears any grace state — the server is back in good standing.
  set.expired_at = null
  set.grace_until = null
  if (s.status === 'expired' || s.status === 'suspended') {
    try { if (s.do_droplet_id) await doDropletAction(s.do_droplet_id, { type: 'power_on' }) } catch (_) {}
    set.status = 'active'
  }
  await _servers.updateOne({ server_id: id }, { $set: set, $unset: { destroy_reason: '', destroyed_at: '', delete_retry_count: '' } })
  await addLog(id, 'renewed', `Renewed for ${m} month${m > 1 ? 's' : ''} - now expires ${expires.toISOString().slice(0, 10)}.`, null, null)
  return { instanceId: extId(id), expires_at: expires, months: m }
}

async function pollRdp(serverId, ip, minutes = 90, { callbackGraceMs = 0 } = {}) {
  let waited = 0, rdpUpSince = 0
  const interval = 30000, deadline = minutes * 60000
  const done = async () => {
    const s = await _servers.findOne({ server_id: serverId }, { projection: { volume_id: 1, do_droplet_id: 1 } }).catch(() => null)
    if (s && s.volume_id) { await releaseVolume(s.volume_id, s.do_droplet_id); await _servers.updateOne({ server_id: serverId }, { $set: { volume_id: null } }) }
  }
  while (waited < deadline) {
    await sleep(interval); waited += interval
    let s
    try { s = await _servers.findOne({ server_id: serverId }, { projection: { status: 1 } }) } catch (_) { s = null }
    if (!s || ['destroyed', 'failed', 'active', 'suspended', 'expired'].includes(s.status)) return done()
    if (await tcpOpen(ip, T.rdpPort)) {
      // Golden path: apply.ps1 confirms the per-order password via callback (→ active). Give it a
      // grace period after 3389 opens before declaring active on the port probe alone.
      if (!rdpUpSince) { rdpUpSince = Date.now(); if (callbackGraceMs) await addLog(serverId, 'rdp_up', `RDP port open at ${ip}:3389 - waiting for the password confirmation from the server...`, 90) }
      if (callbackGraceMs && Date.now() - rdpUpSince < callbackGraceMs) continue
      const srv = await _servers.findOne({ server_id: serverId })
      await applyActivation(srv)
      await addLog(serverId, 'rdp_ready', callbackGraceMs ? `RDP reachable at ${ip}:3389 (no password callback received - verify credentials). Server is active.` : `RDP reachable at ${ip}:3389. Server is active.`, 100, 'active')
      return done()
    }
  }
  await addLog(serverId, 'failed', `RDP not reachable at ${ip}:3389 after ${minutes} min. Windows conversion did not complete.`, null, 'failed')
  return done()
}

const _notAvailable = (e) => e && e.status === 422 && /not available|invalid size|unavailable|capacity/i.test(e.message || '')
const _cityLabel = (region) => (REGION_DISPLAY[region] && REGION_DISPLAY[region].label) || region

// Ordered build attempts for an order: AMD sizes within the cost the customer was quoted, the chosen
// datacenter first then its same-city siblings (on equal cost: chosen DC, then golden-image holders).
function _attemptsFor(server, osOption, conversionOnly) {
  const t = TIER_BY_SLUG.get(server.tier_slug)
  const requested = server.requested_region || server.region
  const cap = server.max_do_cost || (t && t.monthly_do_cost) || 0
  const fastIn = (r) => !conversionOnly && goldenFastPathOk({ ...server, region: r }, osOption).ok
  const rank = (o) => (o.region === requested ? 0 : o.fast ? 1 : 2)
  return buildOptions(t, requested, { maxCost: cap }).map(o => ({ ...o, fast: fastIn(o.region) }))
    .sort((a, b) => a.cost - b.cost || rank(a) - rank(b) || a.order - b.order)
}

// Create the droplet (golden image when the datacenter holds it, else the full conversion), walking
// the attempts on 422 "not available". Persists where + on what it was actually built.
async function createDroplet(server, osOption, name, { conversionOnly = false } = {}) {
  const requested = server.requested_region || server.region
  const attempts = _attemptsFor(server, osOption, conversionOnly)
  const tried = []
  let lastErr = null
  for (const at of attempts) {
    try {
      let out
      if (at.fast) {
        const sshKeyId = await ensureSshKeyId()
        const data = await doCreateDroplet({ name, region: at.region, size: at.size, image: osOption.golden_image_id, ssh_keys: [sshKeyId], user_data: buildMetadataUserData(server), tags: ['rdp-reseller'] })
        out = { dropletId: data.droplet && data.droplet.id, volumeId: null }
      } else {
        out = await launchConversion({ name, region: at.region, size: at.size, doc: server, osOption, tags: ['rdp-reseller'] })
      }
      server.region = at.region; server.do_size_slug = at.size; server.fast_deploy = at.fast
      await _servers.updateOne({ server_id: server.server_id }, { $set: {
        region: at.region, do_size_slug: at.size, do_monthly_cost: at.cost, fast_deploy: at.fast,
        eta_minutes: at.fast ? fastEta(osOption) : 45, golden_image_id: at.fast ? osOption.golden_image_id : null,
      } })
      if (at.region !== requested) await addLog(server.server_id, 'info', `${requested} has no AMD capacity for this plan right now - built in ${at.region} (same city).`)
      const g = goldenFastPathOk(server, osOption)
      if (!at.fast && g.goldenReady && g.diskOk && !g.regionReady) {
        transferGoldenImage(osOption.golden_image_id, at.region, osOption.id).catch(e => log(`on-demand transfer ${osOption.id}→${at.region} failed: ${e.message}`))
        await addLog(server.server_id, 'info', `Golden image not in ${at.region} yet - using full conversion this time (image transfer started for future orders).`, 5)
      }
      return { ...out, fast: at.fast }
    } catch (e) {
      if (!_notAvailable(e)) throw e
      lastErr = e
      sizeCatalog.markRefused(at.size, at.region, e.message)
      tried.push(`${at.size}@${at.region}`)
      await addLog(server.server_id, 'info', `${at.size} is not available in ${at.region} right now - trying the next option...`)
    }
  }
  const tier = TIER_BY_SLUG.get(server.tier_slug)
  alertAdmin(`oos:${server.tier_slug}:${requested}`, `🔴 RDP out of stock: ${tier ? tier.name : server.tier_slug} in ${_cityLabel(requested)} - no AMD size DigitalOcean will build (${tried.length ? `refused: ${tried.join(', ')}` : 'none in the live catalogue'}). Order ${orderRef(server)} cannot be built.`)
  const err = new Error(`no AMD capacity for this plan in ${_cityLabel(requested)} right now (${tried.length ? `tried ${tried.join(', ')}` : 'out of stock'})${lastErr ? ` - ${lastErr.message}` : ''}`)
  err.code = 'out_of_stock'
  throw err
}

// Fire-and-forget provisioning orchestrator (golden fast-path → conversion fallback).
async function provisionServer(serverId) {
  try {
    const server = await _servers.findOne({ server_id: serverId })
    if (!server) return
    // The per-order Administrator password lives only in the secret store (never in doRdpServers).
    server.admin_password = await getSecretPassword(serverId)
    if (!server.admin_password) throw new Error('per-order Administrator password not found in the secret store')
    const osOption = await getOsOption(server.os_id)
    const name = `rdp-${serverId.slice(0, 8)}`
    const first = _attemptsFor(server, osOption)[0]

    if (first && first.fast) {
      watchFastTarget(serverId, Math.max(T.fastTargetMs, fastEta(osOption) * 60000))
      await addLog(serverId, 'creating', 'Creating droplet from golden image (fast, ~2-3 min)...', 10, 'creating')
    } else {
      await addLog(serverId, 'creating', 'Creating DigitalOcean droplet + install volume...', 5, 'creating')
    }
    let made = await createDroplet(server, osOption, name)
    if (made.fast) {
      const dropletId = made.dropletId
      await _servers.updateOne({ server_id: serverId }, { $set: { do_droplet_id: dropletId } })
      await addLog(serverId, 'booting', `Droplet ${dropletId} created from image. Booting...`, 30, 'booting')
      const boot = await waitBootIp(dropletId)
      if (!boot.gone) {
        if (boot.ip) {
          await _servers.updateOne({ server_id: serverId }, { $set: { ip_address: boot.ip } })
          await addLog(serverId, 'installing', `Booted from image at ${boot.ip}. Applying config + password.`, 60, 'installing')
          pollRdp(serverId, boot.ip, 20, { callbackGraceMs: bootGraceMs(osOption) }).catch(() => {})
        } else {
          await addLog(serverId, 'installing', 'Droplet active; awaiting first boot.', 60, 'installing')
        }
        return
      }
      // DO deleted the droplet = its create action errored. Fall back to the full conversion.
      await _servers.updateOne({ server_id: serverId }, { $set: { do_droplet_id: null, fast_deploy: false, eta_minutes: 45 } })
      await addLog(serverId, 'info', `DigitalOcean could not provision droplet ${dropletId} from golden image ${osOption.golden_image_id} (create action errored) - falling back to a full Windows conversion (20-45 min).`, 5)
      log(`fast path failed for ${serverId}: droplet ${dropletId} from image ${osOption.golden_image_id} vanished`)
      alertAdmin(`fallback:${serverId}`, `⚠️ RDP order ${orderRef(server)}: DigitalOcean errored the create from golden image ${osOption.golden_image_id} (droplet ${dropletId} vanished) - falling back to the 20-45 min conversion. Check the image with rdp_golden_build.js status.`)
      await addLog(serverId, 'creating', 'Creating DigitalOcean droplet + install volume...', 5, 'creating')
      made = await createDroplet(server, osOption, name, { conversionOnly: true })
    }

    // Full Ubuntu → Windows conversion (onto an attached volume, then dd'd to the boot disk).
    const { dropletId, volumeId } = made
    await _servers.updateOne({ server_id: serverId }, { $set: { do_droplet_id: dropletId, volume_id: volumeId } })
    await addLog(serverId, 'booting', `Droplet ${dropletId} created. Waiting for boot...`, 10, 'booting')
    const { ip } = await waitBootIp(dropletId)
    if (ip) {
      await _servers.updateOne({ server_id: serverId }, { $set: { ip_address: ip } })
      await addLog(serverId, 'converting', `Ubuntu booted at ${ip}. Windows conversion running on host (20-45 min).`, 15, 'converting')
      pollRdp(serverId, ip).catch(() => {})
    } else {
      await addLog(serverId, 'converting', 'Droplet active; awaiting Windows conversion callbacks.', 15, 'converting')
    }
  } catch (e) {
    await addLog(serverId, 'failed', `Provisioning error: ${e.message}`, null, 'failed')
  }
}

// ─────────────────────────────────────────────────────────────
// Golden images (doRdpImageBuilds) — bake Windows ONCE per edition, then every
// order boots from the image in ~2-3 min instead of a 20-45 min conversion.
// The build droplet installs Windows under QEMU, verifies the baked boot task
// offline, packages the disk as qcow2 and serves it; DigitalOcean imports it as
// a CUSTOM IMAGE (distribution "Unknown"). Plain droplet snapshots of a Windows
// disk are NOT usable: DO treats them as Ubuntu and the create action errors.
// runBuild() is a resumable phase machine (creating → booting → converting →
// importing → registering → transferring → done); state lives in Mongo so a
// Node restart mid-build re-enters at the stored phase (resumeBuilds()).
// ─────────────────────────────────────────────────────────────
// Accepts an optional manual re-import suffix, e.g. golden-ws2025-1790110923-r2
const goldenSnapRe = (osId) => new RegExp(`^golden-${osId}-\\d+(-[a-z0-9]+)?$`)
const goldenAnyRe = /^golden-ws\d{4}-\d+(-[a-z0-9]+)?$/
const imageIdNum = (id) => (/^\d+$/.test(String(id)) ? Number(id) : id)

function publicBuild(b) {
  if (!b) return null
  const { callback_token, admin_password, _id, ...rest } = b
  return { ...rest, logs: (rest.logs || []).slice(-15) }
}

async function addBuildLog(buildId, stage, message, progress, status) {
  if (!_builds) return
  const set = { updated_at: new Date() }
  if (progress != null) set.progress = progress
  if (status != null) set.status = status
  try { await _builds.updateOne({ build_id: buildId }, { $push: { logs: { ts: new Date(), stage, message } }, $set: set }) }
  catch (e) { log(`addBuildLog(${buildId}) warn: ${e.message}`) }
  log(`[golden ${buildId}] ${stage}: ${message}`)
}
const setBuild = (buildId, set) => _builds.updateOne({ build_id: buildId }, { $set: { ...set, updated_at: new Date() } })

async function waitAction(actionId, minutes) {
  const deadline = Date.now() + minutes * 60000
  while (Date.now() < deadline) {
    await sleep(T.actionPoll)
    let a
    try { a = (await doGetAction(actionId)).action || {} } catch (_) { continue }
    if (a.status === 'completed') return true
    if (a.status === 'errored') return false
  }
  return false
}

// Wait for the build droplet to report the packaged qcow2 URL (callback stage image_ready);
// abort early if the on-droplet script reported failure / admin cancelled.
async function waitBuildImage(buildId) {
  const deadline = Date.now() + T.buildMaxMin * 60000
  while (Date.now() < deadline) {
    await sleep(T.rdpPoll)
    const b = await _builds.findOne({ build_id: buildId }, { projection: { status: 1, conv_error: 1, image_url: 1 } })
    if (!b || b.status !== 'building') throw new Error(b && b.conv_error ? `conversion failed on droplet: ${b.conv_error}` : 'build cancelled')
    if (b.image_url) return b.image_url
  }
  return null
}

// Poll a custom-image import: NEW → pending → available (or deleted + error_message).
async function waitImageAvailable(imageId, minutes) {
  const deadline = Date.now() + minutes * 60000
  while (Date.now() < deadline) {
    await sleep(T.importPoll)
    let img
    try { img = (await doGetImage(imageId)).image || {} } catch (e) { if (e.status === 404) return { ok: false, error: 'image disappeared during import' }; continue }
    if (img.status === 'available') return { ok: true, image: img }
    if (img.status === 'deleted' || img.error_message) return { ok: false, error: img.error_message || `status ${img.status}` }
  }
  return { ok: false, error: `import not finished within ${minutes} min` }
}

async function waitImageInRegion(imageId, region, minutes) {
  const deadline = Date.now() + minutes * 60000
  while (Date.now() < deadline) {
    await sleep(T.importPoll)
    try { if ((((await doGetImage(imageId)).image || {}).regions || []).includes(region)) return true } catch (_) {}
  }
  return false
}

// One copy per image+datacenter at a time: concurrent callers (auto-copy, an order, a reinstall) share it.
// `after` (optional promise) runs the copy only once that one settled (sequential batches stay registered).
function transferGoldenImage(imageId, region, osId, after = null) {
  const key = `${imageIdNum(imageId)}@${region}`
  if (_xfer.has(key)) return _xfer.get(key)
  const p = (after || Promise.resolve()).then(() => _transferGoldenImage(imageId, region, osId))
    .then(ok => { if (ok) _xferFailedAt.delete(key); else _xferFailedAt.set(key, Date.now()); return ok })
    .catch(e => { _xferFailedAt.set(key, Date.now()); throw e })
    .finally(() => _xfer.delete(key))
  _xfer.set(key, p)
  return p
}
async function _transferGoldenImage(imageId, region, osId) {
  let img = {}
  try { img = (await doGetImage(imageId)).image || {} } catch (_) {}
  let ok = (img.regions || []).includes(region)
  if (!ok) {
    let act = {}
    try { act = (await doImageAction(imageId, { type: 'transfer', region })).action || {} } catch (e) { log(`transfer ${imageId}→${region} request failed: ${e.message}`) }
    ok = !!act.id && await waitAction(act.id, T.transferMaxMin)
    // DO rejects a second transfer while one is already running (resumed build / admin) - that one still lands.
    if (!ok) ok = await waitImageInRegion(imageId, region, Math.min(T.transferMaxMin, 30))
  }
  if (ok && _osCol) await _osCol.updateOne({ _id: osId, golden_image_id: imageIdNum(imageId) }, { $addToSet: { golden_regions: region } })
  return ok
}

// Every private image (custom import or legacy droplet snapshot) named golden-<os>-<ts>.
async function listGoldenImages() {
  return (((await doListPrivateImages()).images) || []).filter(i => goldenAnyRe.test(String(i.name || '')))
}

async function deleteSupersededImages(osId, keepId) {
  const old = (await listGoldenImages()).filter(i => goldenSnapRe(osId).test(i.name) && String(i.id) !== String(keepId))
  const removed = []
  for (const i of old) {
    try { await doDeleteImage(i.id); removed.push(imageIdNum(i.id)) } catch (e) { log(`delete old golden image ${i.id} warn: ${e.message}`) }
  }
  return removed
}

async function startGoldenBuild({ osId, region, targetRegions, keepOnFailure } = {}) {
  if (!_builds || !_osCol) throw new Error('DO-RDP service not initialised')
  if (!_token()) throw new Error('DIGITALOCEAN_API_TOKEN not configured')
  const id = String(osId || '').toLowerCase()
  if (!OS_OPTIONS[id]) throw new Error(`unknown os_id "${osId}" (valid: ${Object.keys(OS_OPTIONS).join(', ')})`)
  const existing = await _builds.findOne({ os_id: id, status: 'building' })
  if (existing) return { started: false, reason: 'already_building', build: publicBuild(existing) }
  const buildRegion = regionToSlug(region || BUILD_REGION)
  const extra = targetRegions === 'all' ? GOLDEN_ALL_REGIONS : (Array.isArray(targetRegions) ? targetRegions.map(regionToSlug) : [])
  const build = {
    build_id: `build-${crypto.randomBytes(6).toString('hex')}`, os_id: id, region: buildRegion,
    target_regions: [...new Set([buildRegion, ...extra])], status: 'building', phase: 'creating', progress: 0, logs: [],
    callback_token: genToken(), admin_password: genPassword(), vnc_password: crypto.randomBytes(6).toString('base64url').slice(0, 8),
    image_token: crypto.randomBytes(12).toString('hex'), image_url: null, import_image_id: null,
    do_droplet_id: null, volume_id: null, ip_address: null,
    snapshot_name: null, snapshot_action_id: null, snapshot_image_id: null, transferred_regions: [],
    keep_on_failure: !!keepOnFailure, created_at: new Date(), updated_at: new Date(), finished_at: null,
  }
  await _builds.insertOne(build)
  // Keep serving an existing image while a rebuild runs; only a first build flips the row to "building".
  const cur = await _osCol.findOne({ _id: id })
  const keepServing = !!(cur && cur.golden_status === 'available' && cur.golden_image_id)
  await _osCol.updateOne({ _id: id }, { $set: { golden_status: keepServing ? 'available' : 'building', golden_build_id: build.build_id, golden_error: null } }, { upsert: true })
  runBuild(build.build_id).catch(e => log(`runBuild(${build.build_id}) error: ${e.message}`))
  return { started: true, build: publicBuild(build) }
}

async function runBuild(buildId) {
  let b = await _builds.findOne({ build_id: buildId })
  if (!b || b.status !== 'building') return
  const fresh = async () => {
    b = await _builds.findOne({ build_id: buildId })
    if (!b || b.status !== 'building') throw new Error(b && b.conv_error ? `conversion failed on droplet: ${b.conv_error}` : 'build cancelled')
  }
  try {
    const osOption = await getOsOption(b.os_id)
    const dropletName = `golden-${b.os_id}-${b.build_id.slice(-6)}`
    if (b.phase === 'creating') {
      // Adopt the droplet/volume this build already created if the process died before the ids were saved.
      let d = null
      try { d = (((await doListDropletsByTag('golden-build')).droplets) || []).find(x => x.name === dropletName) || null } catch (_) {}
      let dropletId, volumeId = null
      if (d) {
        dropletId = d.id
        try { volumeId = (((await doListVolumesByName(`${dropletName}-win`, b.region)).volumes) || [{}])[0].id || null } catch (_) {}
      } else {
        const pseudo = { server_id: buildId, admin_password: b.admin_password, callback_token: b.callback_token, vnc_password: b.vnc_password, build_mode: 'golden', image_token: b.image_token }
        let lastErr = null
        for (const size of await buildSizeCandidates(b.region)) {
          await addBuildLog(buildId, 'creating', `Creating build droplet ${size} + ${CONVERT_VOLUME_GB} GB install volume in ${b.region} for ${osOption.name}...`, 5)
          try {
            ;({ dropletId, volumeId } = await launchConversion({ name: dropletName, region: b.region, size, doc: pseudo, osOption, tags: ['golden-build'] }))
            await setBuild(buildId, { build_size: size }); lastErr = null; break
          } catch (e) {
            if (!(e.status === 422 && /not available/i.test(e.message))) throw e
            lastErr = e
            await addBuildLog(buildId, 'creating', `${size} is not available in ${b.region} right now - trying the next build size...`)
          }
        }
        if (lastErr) throw lastErr
      }
      await setBuild(buildId, { do_droplet_id: dropletId, volume_id: volumeId, phase: 'booting' })
      await addBuildLog(buildId, 'booting', `Droplet ${dropletId} (${dropletName}) created. Waiting for boot...`, 10)
      await fresh()
    }
    if (b.phase === 'booting') {
      const ip = b.ip_address || (await waitBootIp(b.do_droplet_id)).ip
      if (!ip) throw new Error('build droplet never got a public IP')
      await setBuild(buildId, { ip_address: ip, phase: 'converting' })
      await addBuildLog(buildId, 'converting', `Ubuntu booted at ${ip}. Unattended Windows install running under QEMU/KVM (~30-45 min; VNC ${ip}:5901 during Setup)...`, 20)
      await fresh()
    }
    if (b.phase === 'converting') {
      const url = await waitBuildImage(buildId)
      if (!url) throw new Error(`build droplet did not deliver a Windows image within ${T.buildMaxMin} min`)
      if (b.volume_id) { await releaseVolume(b.volume_id, b.do_droplet_id); await setBuild(buildId, { volume_id: null }) }
      // One DO import at a time per account: concurrent imports stalled in "pending" for hours (2026-09-22).
      const slotDeadline = Date.now() + T.importSlotMaxMin * 60000
      let announced = false
      while (Date.now() < slotDeadline) {
        const other = await _builds.findOne({ build_id: { $ne: buildId }, status: 'building', phase: 'importing' }, { projection: { build_id: 1, os_id: 1 } })
        if (!other) break
        if (!announced) { announced = true; await addBuildLog(buildId, 'converting', `qcow2 ready - waiting for the DigitalOcean import slot (${other.build_id} / ${other.os_id} is importing; imports run one at a time).`, 72) }
        await sleep(T.importPoll)
      }
      const imgName = `golden-${b.os_id}-${Math.floor(Date.now() / 1000)}`
      const created = (await doCreateCustomImage({ name: imgName, url, distribution: 'Unknown', region: b.region, description: `Nomadly Windows RDP golden image - ${osOption.name}`, tags: ['golden-rdp'] })).image || {}
      if (!created.id) throw new Error('custom image import was not accepted by DigitalOcean')
      await setBuild(buildId, { snapshot_name: imgName, import_image_id: imageIdNum(created.id), phase: 'importing' })
      await addBuildLog(buildId, 'importing', `DigitalOcean is importing "${imgName}" (custom image ${created.id}) from the build droplet - this takes 20-90 min...`, 75)
      await fresh()
    }
    if (b.phase === 'importing') {
      // DO's importer normally flips pending→available well within ~2 h of downloading the file. A pending entry that
      // never completes is a stuck job on their side: delete it and re-submit the same URL (the build droplet still
      // serves the qcow2). Deadline is DB-based so restarts do not extend the wait.
      const startedAt = b.import_started_at ? new Date(b.import_started_at).getTime() : Date.now()
      if (!b.import_started_at) await setBuild(buildId, { import_started_at: new Date(startedAt) })
      let attempt = b.import_attempts || 0
      let r = await waitImageAvailable(b.import_image_id, Math.max((T.importPoll * 2) / 60000, T.importRetryMin - (Date.now() - startedAt) / 60000))
      while (!r.ok && /not finished/.test(r.error) && attempt < T.importRetries) {
        attempt++
        await addBuildLog(buildId, 'importing', `Custom image ${b.import_image_id} still pending after ${T.importRetryMin} min - the DigitalOcean import looks stuck. Deleting it and re-submitting the same qcow2 (attempt ${attempt}/${T.importRetries})...`, 75)
        try { await doDeleteImage(b.import_image_id) } catch (e) { log(`delete stuck import ${b.import_image_id}: ${e.message}`) }
        const created = (await doCreateCustomImage({ name: `${b.snapshot_name}-r${attempt}`, url: b.image_url, distribution: 'Unknown', region: b.region, description: `Nomadly Windows RDP golden image - ${osOption.name}`, tags: ['golden-rdp'] })).image || {}
        if (!created.id) throw new Error('custom image re-import was not accepted by DigitalOcean')
        await setBuild(buildId, { import_image_id: imageIdNum(created.id), import_attempts: attempt, import_started_at: new Date() })
        await fresh()
        r = await waitImageAvailable(b.import_image_id, T.importRetryMin)
      }
      if (!r.ok) throw new Error(`custom image import failed: ${r.error}${attempt ? ` (after ${attempt} re-import${attempt > 1 ? 's' : ''})` : ''}`)
      await setBuild(buildId, { snapshot_image_id: imageIdNum(b.import_image_id), phase: 'registering' })
      await fresh()
    }
    if (b.phase === 'registering') {
      let img = {}
      try { img = (await doGetImage(b.snapshot_image_id)).image || {} } catch (_) {}
      const regions = (img.regions && img.regions.length) ? img.regions : [b.region]
      const minDisk = img.min_disk_size || BUILD_DISK_GB
      await _osCol.updateOne({ _id: b.os_id }, { $set: {
        golden_status: 'available', golden_image_id: b.snapshot_image_id, golden_region: b.region, golden_regions: regions,
        golden_min_disk_gb: minDisk, golden_built_at: new Date(), golden_build_id: buildId, golden_error: null,
      } }, { upsert: true })
      await addBuildLog(buildId, 'registered', `Golden image ${b.snapshot_image_id} registered for ${b.os_id} (min disk ${minDisk} GB). Fast-path LIVE in ${regions.join(', ')}.`, 85)
      try { await doDeleteDroplet(b.do_droplet_id); await addBuildLog(buildId, 'cleanup', `Build droplet ${b.do_droplet_id} destroyed.`) }
      catch (e) { await addBuildLog(buildId, 'cleanup', `Could not destroy build droplet ${b.do_droplet_id}: ${e.message}`) }
      const removed = await deleteSupersededImages(b.os_id, b.snapshot_image_id)
      if (removed.length) await addBuildLog(buildId, 'cleanup', `Deleted superseded golden image(s): ${removed.join(', ')}.`)
      await setBuild(buildId, { transferred_regions: regions, phase: 'transferring' })
      await fresh()
    }
    if (b.phase === 'transferring') {
      const pending = (b.target_regions || []).filter(r => !(b.transferred_regions || []).includes(r))
      for (const region of pending) {
        await addBuildLog(buildId, 'transferring', `Transferring image ${b.snapshot_image_id} to ${region}...`)
        let ok = false
        try { ok = await transferGoldenImage(b.snapshot_image_id, region, b.os_id) } catch (e) { log(`transfer ${b.os_id}→${region} error: ${e.message}`) }
        await addBuildLog(buildId, 'transferring', ok ? `Image available in ${region}.` : `Transfer to ${region} FAILED (retry: admin transfer).`)
        if (ok) await _builds.updateOne({ build_id: buildId }, { $addToSet: { transferred_regions: region } })
        else alertAdmin(`xfer:${b.os_id}:${region}`, `🌍 Golden image ${b.snapshot_image_id} (${b.os_id}) could not be copied to ${region} - orders there fall back to the slow conversion.\nRetry: node js/ops/rdp_golden_build.js transfer --os ${b.os_id} --regions ${region}`)
        await fresh()
      }
      await setBuild(buildId, { phase: 'done', status: 'available', progress: 100, finished_at: new Date() })
      await addBuildLog(buildId, 'done', `Golden image build complete for ${b.os_id}.`, 100, 'available')
    }
  } catch (e) {
    // Cancelled while we were still creating → the droplet id landed after failBuild ran; make sure it is gone.
    const cur = await _builds.findOne({ build_id: buildId }).catch(() => null)
    if (cur && cur.finished_at && cur.do_droplet_id && !cur.keep_on_failure && !['transferring', 'done'].includes(cur.phase)) {
      try { await doDeleteDroplet(cur.do_droplet_id) } catch (_) {}
      if (cur.volume_id) await releaseVolume(cur.volume_id, cur.do_droplet_id)
    }
    await failBuild(buildId, e.message)
  }
}

async function failBuild(buildId, reason) {
  const b = await _builds.findOne({ build_id: buildId })
  if (!b || b.finished_at) return
  await addBuildLog(buildId, 'failed', `Build failed: ${reason}`, null, b.status === 'cancelled' ? 'cancelled' : 'failed')
  await setBuild(buildId, { finished_at: new Date() })
  if (b.status !== 'cancelled') alertAdmin(`build:${buildId}`, `🧱 Golden image build ${buildId} (${b.os_id}, ${b.region}) FAILED at phase ${b.phase}${b.conv_progress != null ? ` (droplet ${b.conv_progress}%)` : ''}\n${String(reason).slice(0, 600)}\nRetry: node js/ops/rdp_golden_build.js build --os ${b.os_id}`)
  // Revert the OS row — keep serving an older golden image if one exists.
  const cur = await _osCol.findOne({ _id: b.os_id })
  if (cur && cur.golden_status === 'building') {
    await _osCol.updateOne({ _id: b.os_id }, { $set: { golden_status: cur.golden_image_id ? 'available' : 'failed', golden_error: reason } })
  }
  if (b.do_droplet_id && b.phase !== 'transferring' && b.phase !== 'done') {
    if (b.import_image_id && !b.snapshot_image_id) { try { await doDeleteImage(b.import_image_id) } catch (_) {} }
    if (b.keep_on_failure) await addBuildLog(buildId, 'cleanup', `Build droplet ${b.do_droplet_id} KEPT for inspection (keep_on_failure) — delete it (and its volume) manually.`)
    else {
      try { await doDeleteDroplet(b.do_droplet_id); await addBuildLog(buildId, 'cleanup', `Build droplet ${b.do_droplet_id} destroyed.`) } catch (e) { if (e.status !== 404) await addBuildLog(buildId, 'cleanup', `Could not destroy build droplet: ${e.message}`) }
      if (b.volume_id) { const ok = await releaseVolume(b.volume_id, b.do_droplet_id); await addBuildLog(buildId, 'cleanup', ok ? `Install volume ${b.volume_id} deleted.` : `Install volume ${b.volume_id} could NOT be deleted — remove manually.`) }
    }
  } else if (b.volume_id && !b.keep_on_failure) {
    await releaseVolume(b.volume_id, b.do_droplet_id)
  }
}

async function cancelBuild(buildId) {
  const b = _builds ? await _builds.findOne({ build_id: buildId }) : null
  if (!b) throw new Error('build not found')
  if (b.status !== 'building') return { cancelled: false, status: b.status }
  await setBuild(buildId, { status: 'cancelled', conv_error: 'cancelled by admin' })
  await failBuild(buildId, 'cancelled by admin')
  return { cancelled: true }
}

async function resumeBuilds() {
  if (!_builds) return 0
  const active = await _builds.find({ status: 'building' }).toArray()
  for (const b of active) {
    log(`resuming golden build ${b.build_id} (${b.os_id}, phase=${b.phase})`)
    runBuild(b.build_id).catch(e => log(`resume ${b.build_id} error: ${e.message}`))
  }
  return active.length
}

// DO custom images named golden-<os>-<ts> are the source of truth → register the
// newest per edition. Read-only against DO; lets a production pod pick up images
// built from another pod/DB automatically. Legacy droplet snapshots are ignored
// (DO cannot create droplets from a Windows snapshot).
async function syncGoldenFromDO() {
  if (!_osCol || !_token()) return null
  const imgs = (await listGoldenImages()).filter(i => i.type === 'custom')
  const out = {}
  for (const osId of Object.keys(OS_OPTIONS)) {
    const cur = await _osCol.findOne({ _id: osId })
    if (cur && cur.golden_status === 'building') { out[osId] = { status: 'building', build_id: cur.golden_build_id }; continue }
    const mine = imgs.filter(s => goldenSnapRe(osId).test(s.name) && s.status === 'available').sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    if (!mine.length) {
      if (cur && cur.golden_status === 'available') await _osCol.updateOne({ _id: osId }, { $set: { golden_status: 'none', golden_image_id: null, golden_regions: [], golden_synced_at: new Date() } })
      out[osId] = { status: 'none' }
      continue
    }
    const s = mine[0]
    await _osCol.updateOne({ _id: osId }, { $set: {
      golden_status: 'available', golden_image_id: imageIdNum(s.id), golden_regions: s.regions || [],
      golden_min_disk_gb: s.min_disk_size || BUILD_DISK_GB, golden_synced_at: new Date(),
    } }, { upsert: true })
    out[osId] = { status: 'available', image_id: imageIdNum(s.id), regions: s.regions || [] }
  }
  return out
}

// Copy an available golden image to more regions (background, sequential).
async function transferGolden(osId, regions) {
  const o = await getOsOption(String(osId || '').toLowerCase())
  if (!(o.golden_status === 'available' && o.golden_image_id)) throw new Error(`no golden image available for ${osId}`)
  const wanted = regions === 'all' || !regions ? GOLDEN_ALL_REGIONS : regions.map(regionToSlug)
  const targets = [...new Set(wanted)].filter(r => !(o.golden_regions || []).includes(r))
  // One after the other, but every target is registered in-flight right away (no duplicate queueing).
  let prev = null
  for (const r of targets) {
    const p = transferGoldenImage(o.golden_image_id, r, o.id, prev)
    prev = p.catch(() => false)
    prev.then((ok) => {
      log(`transfer ${o.id}→${r}: ${ok ? 'ok' : 'FAILED'}`)
      if (!ok) alertAdmin(`xfer:${o.id}:${r}`, `🌍 Golden image ${o.golden_image_id} (${o.id}) could not be copied to ${r} - orders there fall back to the slow conversion.\nRetry: node js/ops/rdp_golden_build.js transfer --os ${o.id} --regions ${r}`)
    })
  }
  return { os_id: o.id, image_id: o.golden_image_id, queued_regions: targets }
}

// Every datacenter an order of a sold city could be BUILT in right now (the city's own + same-city fallbacks
// that sell at least one AMD tier). Owner decision 2026-10-14: each holds a copy of every Windows image
// (~$0.06/GB-month per datacenter) so a same-city fallback (New York nyc3 → nyc1) still deploys in ~3 min.
function goldenBuildSites() {
  const out = new Set()
  for (const r of listRegions()) {
    for (const dc of [r.regionSlug, ...sizeCatalog.sameCityOf(r.regionSlug)]) {
      if (TIERS.some(t => _sizeOptions(t, dc, t.monthly_do_cost * MAX_SIZE_COST_FACTOR).length)) out.add(dc)
    }
  }
  return [...out]
}
// Copy each ready golden image to the build sites that lack it (production; after every catalogue refresh,
// so it follows DigitalOcean when AMD capacity moves). Failed copies are retried after 6 h (admin alerted).
async function ensureGoldenAtBuildSites() {
  if (!_osCol || !_token() || !sizeCatalog.isLoaded()) return { sites: [], queued: [] }
  const sites = goldenBuildSites()
  const queued = []
  for (const id of Object.keys(OS_OPTIONS)) {
    const o = await getOsOption(id)
    if (!(o.golden_status === 'available' && o.golden_image_id)) continue
    const missing = sites.filter(r => {
      const key = `${imageIdNum(o.golden_image_id)}@${r}`
      return !(o.golden_regions || []).includes(r) && !_xfer.has(key) && !(Date.now() - (_xferFailedAt.get(key) || 0) < 6 * 3600000)
    })
    if (!missing.length) continue
    await transferGolden(id, missing)
    queued.push(...missing.map(r => `${id}@${r}`))
  }
  if (queued.length) log(`golden auto-copy queued: ${queued.join(', ')}`)
  return { sites, queued }
}

async function goldenStatus() {
  const os = await Promise.all(Object.keys(OS_OPTIONS).map(getOsOption))
  const builds = _builds ? await _builds.find({}).sort({ created_at: -1 }).limit(20).toArray() : []
  const activeFor = (osId) => (builds.find(b => b.os_id === osId && b.status === 'building') || {}).build_id || null
  return {
    build_size: BUILD_SIZE, build_region: BUILD_REGION, all_regions: GOLDEN_ALL_REGIONS,
    os_options: os.map(o => ({
      id: o.id, name: o.name, golden_status: o.golden_status, golden_image_id: o.golden_image_id, golden_regions: o.golden_regions,
      golden_min_disk_gb: o.golden_min_disk_gb, golden_built_at: o.golden_built_at || null, golden_build_id: o.golden_build_id || null,
      golden_error: o.golden_error || null, fast_deploy: o.golden_status === 'available' && !!o.golden_image_id, active_build_id: activeFor(o.id),
    })),
    builds: builds.map(publicBuild),
  }
}

// ─────────────────────────────────────────────────────────────
// Provider interface (consumed by reseller-api vps*Handlers)
// ─────────────────────────────────────────────────────────────
async function createInstance(opts = {}) {
  const product = getProduct(opts.productId)
  if (!product) throw new Error(`createInstance: unknown plan_id "${opts.productId}"`)
  // Accepts both the reseller shape {regionSlug, osId, label} and the bot's vm-instance-setup shape
  // {region, imageId, displayName, rootPassword: <secretId>}.
  const region = regionToSlug(opts.regionSlug || opts.region)
  const osId = String(opts.osId || opts.imageId || DEFAULT_OS_ID).toLowerCase()
  if (!OS_OPTIONS[osId]) throw new Error(`createInstance: unknown os "${opts.osId || opts.imageId}"`)
  const serverId = crypto.randomUUID()
  const adminPassword = (opts.rootPassword && await getSecretPassword(opts.rootPassword)) || opts.adminPassword || genPassword()
  const callbackToken = genToken()
  const label = opts.label || opts.displayName || null

  // Where + on which AMD size: the cheapest live option within what the customer was quoted
  // (maxDoCost from the checkout quote; default = the tier's own cost, so we never absorb a pricier size).
  const tier = _tierOf(product)
  const maxDoCost = Number(opts.maxDoCost) > 0 ? Number(opts.maxDoCost) : tier.monthly_do_cost
  const osOpt = await getOsOption(osId)
  const pick = _attemptsFor({ tier_slug: product.slug, region, max_do_cost: maxDoCost, disk_gb: product.diskGb }, osOpt)[0]
  if (!pick) {
    const err = new Error(`${product.botName} is out of stock in ${_cityLabel(region)} right now (no AMD capacity in ${[region, ...sizeCatalog.sameCityOf(region)].join(', ')}).`)
    err.code = 'out_of_stock'
    throw err
  }
  const fast = pick.fast

  const doc = {
    server_id: serverId, os_id: osId, tier_slug: product.slug,
    duration_months: product.durationMonths, region: pick.region, requested_region: region, do_size_slug: pick.size,
    do_monthly_cost: pick.cost, max_do_cost: maxDoCost, fast_deploy: fast, eta_minutes: fast ? fastEta(osOpt) : 45,
    disk_gb: product.diskGb, do_droplet_id: null, volume_id: null, ip_address: null,
    admin_username: 'Administrator', callback_token: callbackToken, vnc_password: crypto.randomBytes(6).toString('base64url').slice(0, 8),
    status: 'queued', progress: 0, logs: [], label, product_id: product.productId, refund_on_failure: true,
    created_at: new Date(), activated_at: null, expires_at: null, commands: [], agent_seen_at: null,
  }
  if (_servers) await _servers.insertOne(doc)
  // Store the password durably so /rdp/:id/credentials can reveal it later.
  await secretStore.putSecret(serverId, adminPassword, { name: `rdp-${serverId.slice(0, 8)}`, provider: PROVIDER })

  // Kick off provisioning asynchronously; return immediately.
  provisionServer(serverId).catch(e => log(`provisionServer(${serverId}) error: ${e.message}`))

  return {
    instanceId: extId(serverId),
    serverId,
    name: label || `rdp-${serverId.slice(0, 8)}`, displayName: label || `rdp-${serverId.slice(0, 8)}`,
    mainIp: null, ipConfig: { v4: { ip: null } },
    status: 'provisioning',
    region: pick.region, requestedRegion: region, sizeSlug: pick.size, productId: product.productId, imageId: osId, osType: 'Windows', defaultUser: 'Administrator',
    passwordSecretId: opts.rootPassword || serverId,
    defaultPassword: adminPassword,
    osId,
    fastDeploy: fast,
    etaMinutes: fast ? fastEta(osOpt) : 45,
  }
}
// No cross-provider fallback for DO-RDP (golden→conversion fallback is internal).
async function createInstanceWithFallback(opts) { return createInstance(opts) }
// vm-instance-setup.js stores the generated root password through the provider before createInstance.
async function createSecret(name, value, type = 'password') {
  const secretId = String(name || `pwd-${crypto.randomUUID()}`)
  await secretStore.putSecret(secretId, String(value), { name: secretId, provider: PROVIDER, type })
  return { secretId, name: secretId, type }
}

// Reseller-facing provisioning status (GET /rdp/:id): stage, progress, ETA countdown, credentials readiness.
const STAGE_LABELS = {
  queued: 'Order received', creating: 'Creating the server', booting: 'Server booting', installing: 'Windows starting - applying network + password',
  converting: 'Installing Windows (full unattended install)', rdp_up: 'RDP port open - confirming password', rdp_ready: 'Windows is ready',
  password_failed: 'Password could not be applied', failed: 'Provisioning failed', info: 'Provisioning',
  reinstall: 'Reinstalling Windows from the golden image', reinstalling: 'Reinstalling Windows', password_reset: 'Administrator password changed', power: 'Power action',
}
function provisioningStatus(s) {
  const now = Date.now()
  const last = (s.logs || []).slice(-1)[0] || {}
  const reinstall = s.reinstall_started_at && (!s.created_at || new Date(s.reinstall_started_at) > new Date(s.created_at))
  const created = reinstall ? new Date(s.reinstall_started_at).getTime() : (s.created_at ? new Date(s.created_at).getTime() : now)
  const done = ['active', 'destroyed', 'suspended', 'expired'].includes(s.status)
  const failed = s.status === 'failed'
  const etaMin = s.eta_minutes || (s.fast_deploy ? 3 : 45)
  const finishedAt = reinstall ? s.reinstalled_at : s.activated_at
  const endMs = finishedAt ? new Date(finishedAt).getTime() : now
  const elapsed = Math.max(0, Math.round((endMs - created) / 1000))
  const etaSeconds = done || failed ? 0 : Math.max(0, Math.round((created + etaMin * 60000 - now) / 1000))
  const order = ['creating', 'booting', s.fast_deploy ? 'installing' : 'converting', 'rdp_ready']
  const logs = reinstall ? (s.logs || []).filter(l => new Date(l.ts) >= new Date(s.reinstall_started_at)) : (s.logs || [])
  const seen = new Set(logs.map(l => l.stage === 'rdp_up' ? (s.fast_deploy ? 'installing' : 'converting') : (l.stage === 'reinstall' ? 'creating' : l.stage)))
  const reached = Math.max(-1, ...order.map((k, i) => (seen.has(k) || s.status === k || (k === 'rdp_ready' && s.status === 'active')) ? i : -1))
  return {
    status: s.status, stage: last.stage || s.status, stage_label: STAGE_LABELS[last.stage] || STAGE_LABELS[s.status] || 'Provisioning',
    message: last.message || null, progress: s.status === 'active' ? 100 : (s.progress || 0),
    fast_deploy: !!s.fast_deploy, os: s.os_id, eta_minutes: etaMin, eta_seconds: etaSeconds,
    eta_at: done || failed ? null : new Date(created + etaMin * 60000).toISOString(), elapsed_seconds: elapsed,
    time_to_active_s: reinstall ? (s.reinstalled_at ? elapsed : null) : (s.time_to_active_s ?? (s.activated_at ? Math.round((new Date(s.activated_at) - created) / 1000) : null)),
    credentials_ready: s.status === 'active', password_confirmed: s.password_confirmed ?? null,
    reinstall: !!reinstall,
    reinstall_queued: s.pending_reinstall ? { os: s.pending_reinstall.os_id, phase: 'copying_image', queued_at: s.pending_reinstall.queued_at, eta_minutes: s.pending_reinstall.eta_minutes } : null,
    steps: order.map((k, i) => ({ key: k, label: STAGE_LABELS[k], done: i <= reached, current: i === reached + 1 && !done && !failed })),
    logs: (s.logs || []).slice(-10).map(l => ({ ts: l.ts, stage: l.stage, message: l.message })),
  }
}

// Bot-facing status vocabulary (vm-instance-setup upper-cases it: RUNNING shows Stop/Restart, else Start).
function botStatus(s) {
  if (s === 'active') return 'running'
  if (s === 'suspended' || s === 'expired') return 'stopped'
  if (s === 'failed') return 'error'
  if (s === 'destroyed') return 'deleted'
  return 'provisioning'
}
// True ONLY when we can confirm the backing DO droplet no longer exists (404). Used by the
// reseller API to reconcile an RDP box whose droplet was deleted out-of-band — its doRdpServers
// status can otherwise lag at 'active'. Returns false for unknown servers, already-terminal
// records, and transient errors so a blip never destroys a live box.
async function isInstanceGone(instanceId) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s || !s.do_droplet_id) return false
  if (['destroyed', 'DESTROYED', 'cancelled', 'CANCELLED', 'deleted', 'DELETED'].includes(String(s.status))) return false
  try { await doGetDroplet(s.do_droplet_id); return false }
  catch (e) { return !!(e && e.status === 404) }
}
async function getInstance(instanceId) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s) return { status: 'unknown', mainIp: null }
  // Best-effort live refresh of IP from DO.
  if (s.do_droplet_id && !s.ip_address) {
    try {
      const d = (await doGetDroplet(s.do_droplet_id)).droplet || {}
      const pub = ((d.networks && d.networks.v4) || []).find(n => n.type === 'public')
      if (pub && pub.ip_address) { s.ip_address = pub.ip_address; await _servers.updateOne({ server_id: id }, { $set: { ip_address: pub.ip_address } }) }
    } catch (_) {}
  }
  const product = getProduct(s.product_id) || PRODUCTS.find(p => p.slug === s.tier_slug && p.durationMonths === (s.duration_months || 1)) || legacyProductFor(s) || null
  const osName = (OS_OPTIONS[s.os_id] || {}).name || 'Windows Server'
  return {
    // reseller API fields
    status: s.status, mainIp: s.ip_address || null, progress: s.progress, expires_at: s.expires_at || null, logs: (s.logs || []).slice(-10), provisioning: provisioningStatus(s),
    // bot / smart-proxy compat fields (contabo-service shape)
    instanceId: extId(id), name: s.label || `rdp-${id.slice(0, 8)}`, displayName: s.label || `rdp-${id.slice(0, 8)}`,
    ipConfig: { v4: { ip: s.ip_address || null } }, ipv4: s.ip_address || null,
    botStatus: botStatus(s.status), region: s.region, productId: product ? product.productId : `${s.tier_slug}-${s.duration_months || 1}m`,
    cpuCores: product && product.cpuCores, ramMb: product && product.ramMb, diskMb: product && product.diskMb,
    osType: 'Windows', imageId: s.os_id, osName, defaultUser: 'Administrator', provider: PROVIDER, durationMonths: s.duration_months || 1,
    agentOnline: !!(s.agent_seen_at && Date.now() - new Date(s.agent_seen_at) < T.agentStaleMs), agentSeenAt: s.agent_seen_at || null,
  }
}

// ─────────────────────────────────────────────────────────────
// In-guest management agent (apply.ps1 -Agent polls every minute)
// ─────────────────────────────────────────────────────────────
async function queueCommand(serverId, type, payload) {
  const cmd = { id: crypto.randomBytes(8).toString('hex'), type, payload, status: 'pending', created_at: new Date(), finished_at: null, result: null }
  await _servers.updateOne({ server_id: serverId }, { $push: { commands: cmd } })
  return cmd.id
}
async function waitCommand(serverId, cmdId, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await sleep(T.commandPoll)
    const s = await _servers.findOne({ server_id: serverId }, { projection: { commands: 1 } })
    const c = ((s && s.commands) || []).find(x => x.id === cmdId)
    if (c && c.status !== 'pending') return c
  }
  return null
}
const AGENT_SAMPLE_MS = 5 * 60000
// Usage snapshot sent by the agent on its poll query string; null unless at least one value is valid.
function parseAgentMetrics(q = {}) {
  const n = (v, max) => { const x = Number(v); return v !== undefined && v !== '' && isFinite(x) && x >= 0 && x <= max ? x : null }
  const m = { cpu_percent: n(q.cpu, 100), mem_total: n(q.mem_total, 1e13), mem_free: n(q.mem_free, 1e13), disk_total: n(q.disk_total, 1e14), disk_free: n(q.disk_free, 1e14) }
  if (m.mem_total != null && m.mem_free != null && m.mem_free > m.mem_total) m.mem_free = null
  if (m.disk_total != null && m.disk_free != null && m.disk_free > m.disk_total) m.disk_free = null
  return Object.values(m).some((v) => v != null) ? m : null
}
function agentAge(s) { return s && s.agent_seen_at ? Date.now() - new Date(s.agent_seen_at).getTime() : Infinity }

// In-place Administrator password change through the agent (no reinstall, data preserved).
async function resetPassword(instanceId, opts = {}) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s) throw new Error('unknown RDP server')
  if (!['active', 'installing', 'booting', 'reinstalling'].includes(s.status)) throw new Error(`server is ${s.status} - start it first`)
  if (agentAge(s) > T.agentStaleMs) throw new Error(`the management agent on this server has not checked in${s.agent_seen_at ? ` for ${fmtSecs(agentAge(s) / 1000)}` : ' yet'} - restart the server (or reinstall Windows) and try again`)
  const password = (opts.rootPassword && await getSecretPassword(opts.rootPassword)) || genPassword()
  const cmdId = await queueCommand(id, 'set_password', { password })
  const r = await waitCommand(id, cmdId, T.commandWaitMs)
  if (!r) throw new Error('the server did not confirm the password change in time - try again in a minute')
  if (r.status !== 'done') throw new Error(`the server could not apply the password: ${r.result || 'unknown error'}`)
  const secretId = opts.rootPassword || `pwd-reset-${id.slice(0, 8)}-${Date.now()}`
  await secretStore.putSecret(id, password, { name: `rdp-${id.slice(0, 8)}`, provider: PROVIDER })
  if (secretId !== id) await secretStore.putSecret(secretId, password, { name: secretId, provider: PROVIDER, type: 'password' })
  await _servers.updateOne({ server_id: id }, { $set: { password_confirmed: true, password_reset_at: new Date() } })
  await addLog(id, 'password_reset', 'Administrator password changed (in place, agent confirmed).', null, null)
  return { password, secretId, reinstalled: false, verified: true, raw: { method: 'agent', adminUser: 'Administrator' }, note: null }
}

// Reinstall Windows (optionally another edition) = DO rebuild of the SAME droplet from the golden image:
// IP kept, disk wiped, ~3 min. The new password is queued for the agent so it lands right after first boot.
// Image not in this server's datacenter yet (owner decision 2026-10-14): copy it there in the background,
// then reinstall automatically. The server keeps running UNCHANGED until the copy lands; the new password
// is only created when the rebuild starts and is announced through onReinstallEvent (bot DM / reseller webhook).
async function reinstallInstance(instanceId, opts = {}) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s || !s.do_droplet_id) throw new Error('server has no droplet yet')
  if (['creating', 'booting', 'reinstalling', 'converting'].includes(s.status)) throw new Error(`server is ${s.status} - wait for the current operation to finish`)
  if (s.pending_reinstall) throw new Error(`a reinstall (${s.pending_reinstall.os_id}) is already queued - its image is being copied to ${s.region}`)
  const osId = String(opts.osId || opts.imageId || s.os_id).toLowerCase()
  if (!OS_OPTIONS[osId]) throw new Error(`unknown Windows edition "${opts.osId || opts.imageId}"`)
  const osOption = await getOsOption(osId)
  if (!(osOption.golden_status === 'available' && osOption.golden_image_id)) throw new Error(`${osOption.name} has no ready image yet - choose another edition`)
  if (!(osOption.golden_regions || []).includes(s.region)) {
    const eta = COPY_ETA_MIN + fastEta(osOption)
    await _servers.updateOne({ server_id: id }, {
      $set: { pending_reinstall: { os_id: osId, root_password: opts.rootPassword || null, source: opts.source || null, queued_at: new Date(), eta_minutes: eta } },
      $push: { logs: { ts: new Date(), stage: 'info', message: `Reinstall of ${osOption.name} queued: copying its image to ${s.region} first (~${COPY_ETA_MIN} min). The server keeps running unchanged until then.` } },
    })
    _runQueuedReinstall(id).catch(e => log(`queued reinstall ${id} error: ${e.message}`))
    return { success: true, queued: true, phase: 'copying_image', instanceId: extId(id), osId, osName: osOption.name, ip: s.ip_address, password: null, secretId: null, etaMinutes: eta, copyMinutes: COPY_ETA_MIN }
  }
  return _rebuildNow(s, osOption, opts)
}

async function _rebuildNow(s, osOption, opts = {}) {
  const id = s.server_id
  const osId = osOption.id
  const password = (opts.rootPassword && await getSecretPassword(opts.rootPassword)) || genPassword()
  const secretId = opts.rootPassword || id
  await _servers.updateOne({ server_id: id }, {
    $set: { status: 'reinstalling', progress: 5, os_id: osId, fast_deploy: true, eta_minutes: fastEta(osOption), golden_image_id: osOption.golden_image_id, password_confirmed: null, agent_seen_at: null, commands: [], reinstall_started_at: new Date() },
    $push: { logs: { ts: new Date(), stage: 'reinstall', message: `Reinstalling ${osOption.name} from golden image ${osOption.golden_image_id} (disk wiped, IP ${s.ip_address || ''} kept)...` } },
  })
  await queueCommand(id, 'set_password', { password })
  await secretStore.putSecret(id, password, { name: `rdp-${id.slice(0, 8)}`, provider: PROVIDER })
  if (secretId !== id) await secretStore.putSecret(secretId, password, { name: secretId, provider: PROVIDER, type: 'password' })
  const act = (await doDropletAction(s.do_droplet_id, { type: 'rebuild', image: osOption.golden_image_id })).action || {}
  ;(async () => {
    try {
      const ok = !!act.id && await waitAction(act.id, T.rebuildMaxMin)
      if (!ok) { await addLog(id, 'failed', `DigitalOcean could not rebuild droplet ${s.do_droplet_id} from image ${osOption.golden_image_id}.`, null, 'failed'); return }
      await addLog(id, 'booting', `Droplet rebuilt from the ${osOption.name} golden image. Windows booting...`, 30, 'booting')
      watchFastTarget(id, Math.max(T.fastTargetMs, fastEta(osOption) * 60000))
      await pollRdp(id, s.ip_address, T.rdpMaxMin, { callbackGraceMs: bootGraceMs(osOption) })
    } catch (e) { await addLog(id, 'failed', `Reinstall failed: ${e.message}`, null, 'failed') }
  })()
  return { success: true, instanceId: extId(id), osId, osName: osOption.name, imageId: osOption.golden_image_id, password, secretId, ip: s.ip_address, etaMinutes: fastEta(osOption) }
}

const _emitReinstall = (ev) => { try { if (_onReinstallEvent) Promise.resolve(_onReinstallEvent(ev)).catch(e => log(`onReinstallEvent error: ${e.message}`)) } catch (e) { log(`onReinstallEvent error: ${e.message}`) } }

async function _runQueuedReinstall(id) {
  const s = await _servers.findOne({ server_id: id })
  const p = s && s.pending_reinstall
  if (!p) return
  const o = await getOsOption(p.os_id)
  let ok = false
  try { ok = !!o.golden_image_id && await transferGoldenImage(o.golden_image_id, s.region, o.id) } catch (e) { log(`queued reinstall ${id}: copy error ${e.message}`) }
  // Claim the queued reinstall exactly once (a resumed run after a restart may race the original one).
  const claim = await _servers.findOneAndUpdate({ server_id: id, 'pending_reinstall.queued_at': p.queued_at }, { $unset: { pending_reinstall: '' } })
  const cur = claim && (claim.value !== undefined ? claim.value : claim)
  if (!cur || !cur.server_id) return
  const base = { server_id: id, instanceId: extId(id), osId: o.id, osName: o.name, source: p.source || null, rootPassword: p.root_password || null }
  if (!cur.do_droplet_id || ['destroyed', 'expired', 'suspended', 'failed'].includes(cur.status)) {
    await addLog(id, 'info', `Queued reinstall of ${o.name} dropped: the server is ${cur.status || 'gone'}.`, null, null)
    return _emitReinstall({ ...base, type: 'failed', reason: `server_${cur.status || 'gone'}` })
  }
  if (!ok) {
    await addLog(id, 'info', `Reinstall of ${o.name} cancelled: its image could not be copied to ${s.region}. The server was not changed.`, null, null)
    alertAdmin(`xfer:${o.id}:${s.region}`, `🌍 Queued reinstall of ${o.name} on ${orderRef(cur)} cancelled: image ${o.golden_image_id} could not be copied to ${s.region}. Server untouched.\nRetry: node js/ops/rdp_golden_build.js transfer --os ${o.id} --regions ${s.region}`)
    return _emitReinstall({ ...base, type: 'failed', reason: 'image_copy_failed' })
  }
  try {
    const r = await _rebuildNow(cur, await getOsOption(o.id), { rootPassword: p.root_password || undefined })
    _emitReinstall({ ...base, type: 'started', password: r.password, secretId: r.secretId, ip: r.ip, etaMinutes: r.etaMinutes })
  } catch (e) {
    await addLog(id, 'info', `Reinstall of ${o.name} could not start: ${e.message}. The server was not changed.`, null, null)
    _emitReinstall({ ...base, type: 'failed', reason: e.message })
  }
}
// A restart during the copy must not lose the customer's reinstall.
async function resumeQueuedReinstalls() {
  if (!_servers) return 0
  const rows = await _servers.find({ pending_reinstall: { $exists: true } }, { projection: { server_id: 1 } }).toArray()
  for (const r of rows) _runQueuedReinstall(r.server_id).catch(e => log(`resume queued reinstall ${r.server_id}: ${e.message}`))
  return rows.length
}

// Reinstall edition picker for ONE server: ETA from where THAT droplet lives (image there → ~3-5 min,
// image elsewhere → copy first ~20 min + boot). Editions without a ready image are left out.
async function reinstallOptions(instanceId) {
  const s = _servers ? await _servers.findOne({ server_id: normId(instanceId) }) : null
  const all = await Promise.all(Object.keys(OS_OPTIONS).map(getOsOption))
  return all.filter(o => o.golden_status === 'available' && o.golden_image_id).map(o => {
    const here = !!s && (o.golden_regions || []).includes(s.region)
    return { id: o.id, name: o.name, default: o.id === DEFAULT_OS_ID, golden: true, fast_deploy: here, copy_first: !here, eta_minutes: here ? fastEta(o) : COPY_ETA_MIN + fastEta(o), current: !!s && s.os_id === o.id }
  })
}

// Daily admin digest of the last 24 h of RDP orders (only when there were any).
async function sendDailyDigest() {
  if (!_servers) return null
  const since = new Date(Date.now() - T.digestMs)
  const rows = await _servers.find({ created_at: { $gte: since } }).toArray()
  if (!rows.length) return null
  const fast = rows.filter(r => r.fast_deploy), slow = rows.filter(r => !r.fast_deploy)
  const tta = (list) => { const v = list.map(r => r.time_to_active_s).filter(x => Number.isFinite(x)); return v.length ? `${fmtSecs(v.reduce((a, b) => a + b, 0) / v.length)} avg / ${fmtSecs(Math.max(...v))} max (${v.length})` : 'n/a' }
  const failed = rows.filter(r => r.status === 'failed'), missed = fast.filter(r => Number.isFinite(r.time_to_active_s) && r.time_to_active_s > T.fastTargetMs / 1000)
  const byOs = Object.entries(rows.reduce((m, r) => { m[r.os_id] = (m[r.os_id] || 0) + 1; return m }, {})).map(([k, v]) => `${k}:${v}`).join(' ')
  const msg = `📊 RDP orders last 24h: ${rows.length} (${byOs})\n⚡ fast path ${fast.length} - time to active ${tta(fast)}${missed.length ? ` - ${missed.length} over the 3-min target` : ''}\n🐢 full conversion ${slow.length} - ${tta(slow)}\n❌ failed ${failed.length}${failed.length ? ': ' + failed.map(orderRef).join(', ') : ''}`
  alertAdmin(null, msg)
  return msg
}

async function _dropletActionByServer(instanceId, actionBody, newStatus) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (!s || !s.do_droplet_id) throw new Error('server has no droplet yet')
  const r = await doDropletAction(s.do_droplet_id, actionBody)
  if (newStatus) await _servers.updateOne({ server_id: id }, { $set: { status: newStatus } })
  await addLog(id, 'power', `${actionBody.type} requested`, null, null)
  return { action: r.action || null, instanceId: extId(id), status: newStatus || s.status }
}
const startInstance    = (id) => _dropletActionByServer(id, { type: 'power_on' }, 'active')
const stopInstance     = (id) => _dropletActionByServer(id, { type: 'power_off' }, 'suspended')
const shutdownInstance = (id) => _dropletActionByServer(id, { type: 'shutdown' }, 'suspended')
const restartInstance  = (id) => _dropletActionByServer(id, { type: 'reboot' }, null)

async function cancelInstance(instanceId, opts = {}) {
  const id = normId(instanceId)
  const s = _servers ? await _servers.findOne({ server_id: id }) : null
  if (s && s.do_droplet_id) { try { await doDeleteDroplet(s.do_droplet_id) } catch (e) { if (e.status !== 404) throw e } }
  if (s && s.volume_id) await releaseVolume(s.volume_id, s.do_droplet_id)
  const set = { status: 'destroyed', ip_address: null, do_droplet_id: null, volume_id: null }
  if (opts && opts.reason) { set.destroy_reason = opts.reason; set.destroyed_at = new Date() }
  if (_servers) await _servers.updateOne({ server_id: id }, { $set: set })
  try { await secretStore.deleteSecret(id) } catch (_) {}
  return { destroyed: true, instanceId: extId(id) }
}

// ─────────────────────────────────────────────────────────────
// 2-day (48h) grace lifecycle helpers.
// The bot VPS scheduler (js/_index.js) OWNS the DO-RDP grace lifecycle and
// mirrors the grace state onto doRdpServers via these helpers so this service's
// safety-net sweep + the reseller API read a consistent state.
// ─────────────────────────────────────────────────────────────
// Mirror a grace/lifecycle change onto the customer-facing vpsPlansOf record.
// RDP records use contaboInstanceId = vpsId = extId(server_id) (vm-instance-setup.js).
async function _mirrorVpsPlan(serverId, set) {
  if (!_db || typeof _db.collection !== 'function') return
  try {
    await _db.collection('vpsPlansOf').updateOne(
      { $or: [{ contaboInstanceId: extId(serverId) }, { vpsId: extId(serverId) }] },
      { $set: set },
    )
  } catch (e) { log(`_mirrorVpsPlan(${serverId}) warn: ${e.message}`) }
}

// Best-effort reseller webhook from the SAFETY-NET sweep. The bot scheduler owns the
// grace lifecycle and normally emits these; the resellerWebhookDeliveries dedup makes
// this a no-op if the scheduler already sent the same (keyId,event,instanceId).
async function _emitResellerWebhook(serverId, event, extra = {}) {
  if (!_db || typeof _db.collection !== 'function') return
  try {
    const plan = await _db.collection('vpsPlansOf').findOne({ $or: [{ contaboInstanceId: extId(serverId) }, { vpsId: extId(serverId) }] })
    if (!plan || !plan.chatId) return
    const webhooks = require('./reseller-webhooks')
    await webhooks.emit(_db, { chatId: plan.chatId, event, instanceId: plan.vpsId || plan._id, payload: { plan: plan.plan || null, region: plan.region || null, ...extra }, log })
  } catch (e) { log(`_emitResellerWebhook(${serverId}) warn: ${e.message}`) }
}

// Enter grace on doRdpServers (called by the bot scheduler after it powers the box off).
async function markGrace(instanceId, { expired_at, grace_until } = {}) {
  if (!_servers) return false
  const id = normId(instanceId)
  const set = { status: 'expired' }
  if (expired_at) set.expired_at = expired_at
  if (grace_until) set.grace_until = grace_until
  const r = await _servers.updateOne({ server_id: id }, { $set: set })
  return !!(r && (r.matchedCount || r.modifiedCount))
}

// Mark the doRdpServers row as destroyed-by-grace (called after the scheduler destroys the droplet).
async function markGraceDestroy(instanceId) {
  if (!_servers) return false
  const id = normId(instanceId)
  const r = await _servers.updateOne({ server_id: id }, { $set: { status: 'destroyed', destroy_reason: 'expired_grace', destroyed_at: new Date() } })
  return !!(r && (r.matchedCount || r.modifiedCount))
}

async function getSecretPassword(secretId) {
  try { return await secretStore.getSecretPassword(secretId) } catch (_) { return null }
}

// Hourly sweep (production only). Two passes:
//   Sweep-1: an ACTIVE subscription that just expired → power OFF + enter the 2-day (48h) grace
//            (set expired_at / grace_until) and mirror it onto vpsPlansOf. Customer loses
//            access but the box (and its data) survive for grace before deletion.
//   Sweep-2 (SAFETY NET): an EXPIRED box whose grace deadline has passed → DESTROY the droplet
//            so DigitalOcean stops billing us (DO bills powered-off droplets per hour).
//            The bot VPS scheduler normally owns this destroy (it can notify the user); the
//            sweep only fires for records the scheduler missed.
async function processExpiries() {
  if (!_servers) return []
  const now = new Date()
  const suspended = []
  const destroyed = []
  // Sweep-1 — active → expired (enter grace).
  const cursor = _servers.find({ status: 'active', expires_at: { $lte: now } })
  for await (const s of cursor) {
    try { if (s.do_droplet_id) await doDropletAction(s.do_droplet_id, { type: 'power_off' }) } catch (_) {}
    const graceUntil = new Date(new Date(s.expires_at || now).getTime() + T.graceDays * 86400000)
    await _servers.updateOne({ server_id: s.server_id }, { $set: { status: 'expired', expired_at: now, grace_until: graceUntil } })
    await _mirrorVpsPlan(s.server_id, { status: 'EXPIRED_GRACE', expired_at: now, grace_until: graceUntil })
    _emitResellerWebhook(s.server_id, 'rdp.grace_start', { expired_at: now.toISOString(), delete_at: graceUntil.toISOString(), grace_hours: T.graceDays * 24 }).catch(() => {})
    suspended.push(s.server_id)
  }
  // Sweep-2 — expired past the grace deadline → destroy (safety net).
  const graceCursor = _servers.find({ status: 'expired', do_droplet_id: { $ne: null }, grace_until: { $lte: now } })
  for await (const s of graceCursor) {
    try {
      await cancelInstance(s.server_id, { reason: 'expired_grace' })
      await _mirrorVpsPlan(s.server_id, { status: 'CANCELLED', cancelledAt: now, cancelReason: 'expired_grace' })
      _emitResellerWebhook(s.server_id, 'rdp.deleted', { reason: 'expired_grace' }).catch(() => {})
      destroyed.push(s.server_id)
    } catch (e) { log(`processExpiries: grace-destroy error for ${s.server_id}: ${e.message}`) }
  }
  if (suspended.length) log(`processExpiries: powered off ${suspended.length} expired server(s) into ${T.graceDays}-day grace`)
  if (destroyed.length) log(`processExpiries: DESTROYED ${destroyed.length} server(s) past grace (safety net)`)
  return suspended
}

// ─────────────────────────────────────────────────────────────
// Callback + bootscript router (mounted at /provision by _index.js)
// The on-droplet script posts progress here; token-gated by callback_token.
// ─────────────────────────────────────────────────────────────
function provisionRouter() {
  const express = require('express')
  const router = express.Router()
  router.get('/bootscript', (req, res) => {
    try { res.type('text/plain').send(fs.readFileSync(path.join(SCRIPTS_DIR, 'apply.ps1'), 'utf8')) }
    catch (e) { res.status(500).send(`# bootscript unavailable: ${e.message}`) }
  })
  router.post('/callback', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const { server_id, token, stage, message, progress, status } = req.body || {}
      if (!server_id || !token) return res.status(400).json({ error: 'missing server_id/token' })
      const s = _servers ? await _servers.findOne({ server_id }) : null
      if (!s) {
        // Golden-image build droplets report here too (server_id = build_id).
        const b = _builds ? await _builds.findOne({ build_id: server_id }) : null
        if (!b || b.callback_token !== token) return res.status(403).json({ error: 'Invalid callback token' })
        const set = { updated_at: new Date() }
        if (progress != null && Number.isFinite(Number(progress))) set.conv_progress = Number(progress)
        if (stage === 'failed' && b.status === 'building') { set.status = 'failed'; set.conv_error = message || 'conversion failed on droplet' }
        const { image_url, image_bytes } = req.body || {}
        if (stage === 'image_ready' && /^https?:\/\/[\w.:-]+\/[\w-]+\/windows\.qcow2$/.test(String(image_url || ''))) {
          set.image_url = String(image_url)
          if (Number.isFinite(Number(image_bytes))) set.image_bytes = Number(image_bytes)
          if (b.image_url === set.image_url) { await _builds.updateOne({ build_id: server_id }, { $set: set }); return res.json({ ok: true }) } // droplet re-announces every 10 min
        }
        await _builds.updateOne({ build_id: server_id }, { $push: { logs: { ts: new Date(), stage: `droplet:${stage || 'progress'}`, message: message || '' } }, $set: set })
        log(`[golden ${server_id}] droplet:${stage} ${progress != null ? progress + '% ' : ''}${message || ''}`)
        return res.json({ ok: true })
      }
      if (s.callback_token !== token) return res.status(403).json({ error: 'Invalid callback token' })
      if (stage === 'rdp_ready' || (progress != null && Number(progress) >= 100)) {
        await applyActivation(s)
        // After a reinstall the boot script applies the ORIGINAL user-data password first; the new one is
        // still queued for the agent - don't advertise it as confirmed yet.
        const pendingPw = (s.commands || []).some(c => c.type === 'set_password' && c.status === 'pending')
        if (!pendingPw) await _servers.updateOne({ server_id }, { $set: { password_confirmed: true } })
        await addLog(server_id, 'rdp_ready', message || 'Windows is live.', 100, 'active')
      } else if (stage === 'failed') {
        await addLog(server_id, 'failed', message || 'Conversion failed.', progress, 'failed')
      } else if (stage === 'password_failed') {
        await _servers.updateOne({ server_id }, { $set: { password_confirmed: false } })
        await addLog(server_id, 'password_failed', message || 'The per-order password could not be applied.', null, null)
        alertAdmin(`pw:${server_id}`, `🔑 RDP order ${orderRef(s)}: Windows booted but the per-order Administrator password could NOT be applied (${message || 'no detail'}). Customer cannot log in - check C:\\cloudinit\\apply.log on ${s.ip_address || 'the droplet'}.`)
      } else {
        await addLog(server_id, stage || 'converting', message || stage || 'progress', progress, status || 'converting')
      }
      res.json({ ok: true })
    } catch (e) { log(`callback error: ${e.message}`); res.status(500).json({ error: 'callback_error' }) }
  })
  // In-guest agent (apply.ps1 -Agent, every minute): pending commands + results. Token-gated like /callback.
  // The poll also carries a usage snapshot (cpu %, memory + C: bytes) → agent_metrics + 5-min samples.
  const agentAuth = async (server_id, token) => {
    if (!server_id || !token || !_servers) return null
    const s = await _servers.findOne({ server_id: normId(server_id) })
    return s && s.callback_token === token ? s : null
  }
  router.get('/commands', async (req, res) => {
    try {
      const s = await agentAuth(req.query.server_id, req.query.token)
      if (!s) return res.status(403).json({ error: 'Invalid token' })
      const now = new Date()
      const set = { agent_seen_at: now }
      const m = parseAgentMetrics(req.query)
      if (m) {
        set.agent_metrics = { ...m, at: now }
        if (!s.agent_metrics_sampled_at || now - new Date(s.agent_metrics_sampled_at) >= AGENT_SAMPLE_MS) {
          set.agent_metrics_sampled_at = now
          try { await _agentMetrics.insertOne({ server_id: s.server_id, at: now, ...m }) } catch (_) {}
        }
      }
      await _servers.updateOne({ server_id: s.server_id }, { $set: set })
      res.json({ commands: (s.commands || []).filter(c => c.status === 'pending').map(c => ({ id: c.id, type: c.type, payload: c.payload })) })
    } catch (e) { log(`commands error: ${e.message}`); res.status(500).json({ error: 'commands_error' }) }
  })
  router.post('/commands/result', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { server_id, token, id, ok, message } = req.body || {}
      const s = await agentAuth(server_id, token)
      if (!s) return res.status(403).json({ error: 'Invalid token' })
      const cmd = (s.commands || []).find(c => c.id === id)
      if (!cmd) return res.status(404).json({ error: 'unknown command' })
      const set = { 'commands.$.status': ok ? 'done' : 'failed', 'commands.$.finished_at': new Date(), 'commands.$.result': String(message || ''), agent_seen_at: new Date() }
      if (cmd.type === 'set_password' && ok) set.password_confirmed = true
      await _servers.updateOne({ server_id: s.server_id, 'commands.id': id }, { $set: set })
      log(`agent ${s.server_id.slice(0, 8)}: ${cmd.type} ${id} → ${ok ? 'ok' : 'FAILED'} ${message || ''}`)
      res.json({ ok: true })
    } catch (e) { log(`commands/result error: ${e.message}`); res.status(500).json({ error: 'commands_error' }) }
  })
  return router
}

module.exports = {
  PROVIDER,
  init,
  // catalog / pricing
  listProducts, getProduct, calculatePrice, formatSpecs, buildRdpFile, listRegions, REGION_DISPLAY, getDefaultWindowsImageId, sizeCandidatesFor,
  // live stock (AMD only, same-city fallback, +15% cap passed on in the price)
  isProductAvailable, quoteFor, buildOptions, productInRegion, availability, renewalPrice, MAX_SIZE_COST_FACTOR,
  // lifecycle
  createInstance, createInstanceWithFallback, getInstance, isInstanceGone,
  startInstance, stopInstance, restartInstance, shutdownInstance,
  cancelInstance, getSecretPassword, createSecret, resetPassword, reinstallInstance, renewInstance,
  // grace lifecycle mirror helpers (bot scheduler owns the grace lifecycle; these keep doRdpServers in sync)
  markGrace, markGraceDestroy,
  // ops
  processExpiries, provisionRouter, sendDailyDigest, provisioningStatus, reconcileOrders, handleFailedOrder,
  // golden images
  startGoldenBuild, cancelBuild, resumeBuilds, syncGoldenFromDO, transferGolden, goldenStatus, listOsOptions, listOsOptionsForRegion,
  goldenBuildSites, ensureGoldenAtBuildSites, reinstallOptions, resumeQueuedReinstalls, COPY_ETA_MIN,
  // exported for tests / internal use
  _buildUserData: buildUserData, _buildMetadataUserData: buildMetadataUserData,
  serversCollection: () => _servers,
  agentMetricsCollection: () => _agentMetrics,
  parseAgentMetrics,
  _products: () => PRODUCTS, regionToSlug, _genPassword: genPassword, getOsOption, _timing: T, _runBuild: runBuild, _provisionServer: provisionServer, _watchFastTarget: watchFastTarget, normId, extId,
  DURATIONS, TIERS, OS_OPTIONS, DEFAULT_OS_ID, BUILD_SIZE, BUILD_REGION, GOLDEN_ALL_REGIONS,
}
