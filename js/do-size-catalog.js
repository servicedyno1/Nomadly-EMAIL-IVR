'use strict'
/**
 * do-size-catalog.js — LIVE DigitalOcean droplet-size catalogue.
 *
 * WHY (2026-10-14 RCA, memory/RDP_NYC3_SIZE_UNAVAILABLE_RCA_2026-10-14.md): the RDP service
 * hardcoded which size families DigitalOcean sells per region. DO silently changed nyc3
 * (it now sells ONLY Premium AMD there), so every New York RDP order walked two dead size
 * slugs and failed with 422 "Size is not available in this region".
 *
 * This module makes DigitalOcean itself the source of truth:
 *   • GET /v2/sizes (paginated) → per size: vcpus, memory, disk, price, `available` and the
 *     `regions` where creates are allowed RIGHT NOW; GET /v2/regions → which datacenters are up.
 *   • Refreshed every 15 min (DO_SIZE_CATALOG_REFRESH_MS) and persisted to Mongo
 *     `doSizeCatalog` (_id 'live'), so a restart while DigitalOcean is unreachable still uses the
 *     last good copy. If DO can't be reached the previous copy is KEPT (never wiped).
 *   • "Refused" marks: when DO answers 422 not-available for a size+region (capacity blips can
 *     happen even when the catalogue lists it), callers mark it and it is skipped for 30 min
 *     (DO_SIZE_REFUSED_TTL_MS) — and a fresh catalogue pull is triggered.
 *
 * No writes to DigitalOcean — read-only GETs, safe on every pod.
 */
const axios = require('axios')

const log = (...a) => console.log('[DO-Catalog]', ...a)
const DO_BASE = 'https://api.digitalocean.com/v2'
const T = {
  refreshMs: Math.max(60000, Number(process.env.DO_SIZE_CATALOG_REFRESH_MS) || 15 * 60000),
  refusedTtlMs: Math.max(1000, Number(process.env.DO_SIZE_REFUSED_TTL_MS) || 30 * 60000),
  // A catalogue older than this is reported stale (refresh keeps failing). It is still USED.
  staleMs: 2 * 60 * 60000,
  // Never hammer DO: a 422-triggered refresh is skipped if one ran this recently.
  minForcedGapMs: 60000,
}

let _col = null
let _state = null // { sizes: Map<slug, size>, regionsUp: Set|null, fetchedAt: Date, source: 'live'|'db'|'test' }
let _lastError = null
let _lastErrorAt = null
let _lastAttemptAt = null
let _refreshing = null
let _timer = null
const _refused = new Map() // `${slug}@${region}` → { until: ms, reason }
const _listeners = new Set()

function _token() { return process.env.DIGITALOCEAN_API_TOKEN || '' }

async function _get(urlPath) {
  const res = await axios({
    method: 'get', url: `${DO_BASE}${urlPath}`,
    headers: { Authorization: `Bearer ${_token()}`, 'Content-Type': 'application/json' },
    timeout: 30000, validateStatus: () => true,
  })
  if (!res || res.status >= 400) {
    const detail = (res && res.data && res.data.message) || `HTTP ${res && res.status}`
    const err = new Error(`DigitalOcean API error ${res && res.status}: ${detail}`)
    err.status = res && res.status
    throw err
  }
  return res.data || {}
}

// Serializable, trimmed size record (what we persist + what callers read).
function _slim(s) {
  return {
    slug: String(s.slug), vcpus: Number(s.vcpus) || 0, memory: Number(s.memory) || 0, disk: Number(s.disk) || 0,
    price_monthly: Number(s.price_monthly) || 0, description: String(s.description || ''),
    available: s.available !== false, regions: Array.isArray(s.regions) ? s.regions.map(String) : [],
  }
}

function _build(rawSizes, rawRegions, { fetchedAt = new Date(), source = 'live' } = {}) {
  const sizes = new Map()
  for (const s of rawSizes || []) if (s && s.slug) { const x = _slim(s); sizes.set(x.slug, { ...x, regionSet: new Set(x.regions) }) }
  let regionsUp = null
  const cities = new Map() // region slug → city name ("New York 3" → "new york")
  if (Array.isArray(rawRegions) && rawRegions.length) {
    regionsUp = new Set(rawRegions.filter(r => r && r.slug && r.available !== false).map(r => String(r.slug)))
    for (const r of rawRegions) if (r && r.slug && r.name) cities.set(String(r.slug), _cityName(r.name))
  }
  return { sizes, regionsUp, cities, fetchedAt: new Date(fetchedAt), source }
}
function _cityName(name) { return String(name || '').replace(/\s*\d+\s*$/, '').trim().toLowerCase() }

async function _fetchAllSizes() {
  let out = []
  for (let page = 1; page <= 10; page++) {
    const d = await _get(`/sizes?per_page=200&page=${page}`)
    out = out.concat(d.sizes || [])
    if (!(d.links && d.links.pages && d.links.pages.next)) break
  }
  return out
}

function _emit() {
  for (const fn of _listeners) { try { const r = fn(getState()); if (r && r.catch) r.catch(() => {}) } catch (_) { /* listener errors never break refresh */ } }
}

/** Pull a fresh catalogue from DigitalOcean. On failure the last good copy is kept. */
function refresh({ force = false } = {}) {
  if (_refreshing) return _refreshing
  if (!_token()) return Promise.resolve(false)
  if (!force && _lastAttemptAt && Date.now() - _lastAttemptAt < T.minForcedGapMs) return Promise.resolve(false)
  _lastAttemptAt = Date.now()
  _refreshing = (async () => {
    try {
      const sizes = await _fetchAllSizes()
      if (!sizes.length) throw new Error('DigitalOcean returned an empty size list')
      let regions = null
      try { regions = (await _get('/regions?per_page=200')).regions || null } catch (e) { log(`regions fetch failed (sizes still applied): ${e.message}`) }
      _state = _build(sizes, regions, { source: 'live' })
      _lastError = null; _lastErrorAt = null
      if (_col) {
        _col.updateOne({ _id: 'live' }, { $set: {
          sizes: sizes.map(_slim),
          regions: Array.isArray(regions) ? regions.map(r => ({ slug: String(r.slug), name: String(r.name || ''), available: r.available !== false })) : null,
          fetched_at: _state.fetchedAt,
        } }, { upsert: true }).catch(e => log(`persist warn: ${e.message}`))
      }
      _emit()
      return true
    } catch (e) {
      _lastError = e.message; _lastErrorAt = new Date()
      log(`refresh failed — keeping ${_state ? `the ${_state.source} copy from ${_state.fetchedAt.toISOString()}` : 'static fallback (no catalogue yet)'}: ${e.message}`)
      _emit()
      return false
    } finally { _refreshing = null }
  })()
  return _refreshing
}

async function _loadFromDb() {
  if (!_col || _state) return false
  try {
    const doc = await _col.findOne({ _id: 'live' })
    if (doc && Array.isArray(doc.sizes) && doc.sizes.length && !_state) {
      _state = _build(doc.sizes, doc.regions, { fetchedAt: doc.fetched_at || new Date(0), source: 'db' })
      log(`loaded last good catalogue from DB (${doc.sizes.length} sizes, fetched ${_state.fetchedAt.toISOString()})`)
      return true
    }
  } catch (e) { log(`DB load warn: ${e.message}`) }
  return false
}

/**
 * init(db, { autoRefresh }) — idempotent. Loads the persisted copy, then (autoRefresh) pulls a
 * fresh one now + every 15 min. Returns a promise that resolves once the DB copy is loaded.
 */
function init(db, { autoRefresh = true } = {}) {
  if (db && typeof db.collection === 'function' && !_col) _col = db.collection('doSizeCatalog')
  const loaded = _loadFromDb()
  if (autoRefresh && _token() && !_timer) {
    setTimeout(() => { refresh({ force: true }).catch(() => {}) }, 2000).unref?.()
    _timer = setInterval(() => { refresh({ force: true }).catch(() => {}) }, T.refreshMs)
    if (_timer.unref) _timer.unref()
  }
  return loaded
}

function isLoaded() { return !!(_state && _state.sizes && _state.sizes.size) }

function _refusedKey(slug, region) { return `${slug}@${region}` }
function isRefused(slug, region) {
  const k = _refusedKey(slug, region)
  const r = _refused.get(k)
  if (!r) return false
  if (Date.now() > r.until) { _refused.delete(k); return false }
  return true
}
/** DO just refused this size in this region (422 not available) → skip it for 30 min + re-pull. */
function markRefused(slug, region, reason) {
  if (!slug || !region) return
  _refused.set(_refusedKey(slug, region), { until: Date.now() + T.refusedTtlMs, reason: reason || null, at: new Date() })
  refresh().catch(() => {})
}
function refusedList() {
  const out = []
  for (const [k, v] of _refused) { if (Date.now() <= v.until) { const [slug, region] = k.split('@'); out.push({ slug, region, until: new Date(v.until), reason: v.reason }) } }
  return out
}

function isRegionUp(region) { return !(_state && _state.regionsUp) || _state.regionsUp.has(String(region)) }

// Other datacenters in the SAME city (nyc3 → nyc1, nyc2), from DigitalOcean's live region names
// ("New York 1/2/3"); a static map is used until a region list has been fetched. Down regions are dropped.
const STATIC_SAME_CITY = { nyc1: ['nyc2', 'nyc3'], nyc2: ['nyc1', 'nyc3'], nyc3: ['nyc1', 'nyc2'], sfo2: ['sfo3'], sfo3: ['sfo2'] }
function sameCityOf(region) {
  const r = String(region || '')
  const cities = _state && _state.cities
  let out
  if (cities && cities.size && cities.has(r)) {
    const city = cities.get(r)
    out = [...cities.entries()].filter(([slug, c]) => slug !== r && c === city).map(([slug]) => slug).sort()
  } else out = STATIC_SAME_CITY[r] || []
  return out.filter(isRegionUp)
}

/** Is this exact size creatable in this region right now? null = unknown (no catalogue yet). */
function isAvailable(slug, region) {
  if (isRefused(slug, region)) return false
  if (!isLoaded()) return null
  const s = _state.sizes.get(String(slug))
  return !!(s && s.available && s.regionSet.has(String(region)) && isRegionUp(region))
}

/** Every size DigitalOcean will create in `region` right now (minus refused ones). [] when unknown. */
function sizesAvailableIn(region) {
  if (!isLoaded()) return []
  const r = String(region || '')
  if (!isRegionUp(r)) return []
  const out = []
  for (const s of _state.sizes.values()) if (s.available && s.regionSet.has(r) && !isRefused(s.slug, r)) out.push(s)
  return out
}

function getSize(slug) { return isLoaded() ? (_state.sizes.get(String(slug)) || null) : null }

function getState() {
  const fetchedAt = _state ? _state.fetchedAt : null
  const age = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 1000) : null
  return {
    loaded: isLoaded(),
    source: _state ? _state.source : 'none', // live = pulled this process · db = last good copy from Mongo · none = static fallback
    fetched_at: fetchedAt ? fetchedAt.toISOString() : null,
    age_seconds: age,
    stale: age == null ? true : age * 1000 > T.staleMs,
    sizes: _state ? _state.sizes.size : 0,
    refresh_interval_seconds: Math.round(T.refreshMs / 1000),
    last_error: _lastError, last_error_at: _lastErrorAt ? _lastErrorAt.toISOString() : null,
    refused: refusedList().length,
  }
}

function onRefresh(fn) { if (typeof fn === 'function') _listeners.add(fn); return () => _listeners.delete(fn) }

// ── test hooks ──
function _setForTest(rawSizes, rawRegions, opts = {}) { _state = rawSizes ? _build(rawSizes, rawRegions, { source: 'test', ...opts }) : null }
function _resetForTest() {
  _state = null; _lastError = null; _lastErrorAt = null; _lastAttemptAt = null; _refreshing = null; _refused.clear()
  if (_timer) { clearInterval(_timer); _timer = null }
  _col = null
}

module.exports = {
  init, refresh, isLoaded, isAvailable, sizesAvailableIn, getSize, getState, isRegionUp, sameCityOf,
  markRefused, isRefused, refusedList, onRefresh,
  _timing: T, _setForTest, _resetForTest, _loadFromDb,
}
