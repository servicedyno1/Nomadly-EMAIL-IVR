'use strict'
// Short-link analytics + smart routing (reseller shortener). Click events are aggregated into
// per-day buckets in `shortenerClickStats` (TTL 90 days): total + per-country / per-device /
// per-referrer counters. Smart routing picks a destination by visitor country or device.
// Reused by the redirect handler (app.get('/:id')) and the reseller API stats/QR endpoints.
const COLLECTION = 'shortenerClickStats'
const RETENTION_DAYS = 90
const MAX_REFERRERS_RETURNED = 20
const _indexed = new WeakSet()
const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10)

function ensureIndexes(db) {
  if (!db || _indexed.has(db)) return
  _indexed.add(db)
  const c = db.collection(COLLECTION)
  c.createIndex({ at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400, name: 'ttl_at' }).catch(() => { _indexed.delete(db) })
  c.createIndex({ key: 1, dayStr: 1 }).catch(() => {})
}

// A Mongo field key can't contain '.' or start with '$' — store them as fullwidth look-alikes, decode on read.
const safeKey = (s) => String(s || '').slice(0, 80).replace(/\./g, '\uFF0E').replace(/\$/g, '\uFF04')
const fromKey = (s) => String(s).replace(/\uFF0E/g, '.').replace(/\uFF04/g, '$')

function deviceFromUA(ua) {
  const s = String(ua || '').toLowerCase()
  if (!s) return 'unknown'
  if (/bot|crawl|spider|slurp|facebookexternalhit|curl|wget|python-requests|headless/.test(s)) return 'bot'
  if (/ipad|tablet|playbook|silk|kindle/.test(s)) return 'tablet'
  if (/mobi|iphone|android.*mobile|windows phone|blackberry/.test(s)) return 'mobile'
  if (/android/.test(s)) return 'tablet'
  return 'desktop'
}

function refHost(referer) {
  if (!referer) return 'direct'
  try { const hn = new URL(referer).hostname.toLowerCase().replace(/^www\./, ''); return hn || 'direct' }
  catch (_) { return 'direct' }
}

// Extract {country, device, referrer} from an Express request (CF edge headers when present).
function parseClick(req) {
  const h = (req && req.headers) || {}
  const country = String(h['cf-ipcountry'] || h['x-vercel-ip-country'] || h['x-country-code'] || '').toUpperCase().slice(0, 2)
  return { country: /^[A-Z]{2}$/.test(country) ? country : 'XX', device: deviceFromUA(h['user-agent']), referrer: refHost(h['referer'] || h['referrer']) }
}

// Record one click into today's bucket. Best-effort, never throws.
async function recordClick(db, key, req, now = new Date()) {
  try {
    if (!db || !key) return
    ensureIndexes(db)
    const { country, device, referrer } = parseClick(req || {})
    const dayStr = day(now)
    await db.collection(COLLECTION).updateOne(
      { _id: `${key}|${dayStr}` },
      {
        $setOnInsert: { key, dayStr, at: now },
        $inc: { total: 1, [`country.${safeKey(country)}`]: 1, [`device.${safeKey(device)}`]: 1, [`referrer.${safeKey(referrer)}`]: 1 },
      },
      { upsert: true },
    )
  } catch (_) { /* best-effort */ }
}

// Smart routing: pick a destination for this visitor. rules = { targets:[{country?,device?,url}], default? }.
// First matching target wins. Returns a URL string or null (caller falls back to the link's base url).
function resolveRouting(rules, click) {
  if (!rules || !Array.isArray(rules.targets) || !rules.targets.length) return null
  const country = String(click && click.country || '').toUpperCase()
  const device = String(click && click.device || '').toLowerCase()
  for (const t of rules.targets) {
    if (!t || !t.url) continue
    const wantC = t.country ? String(t.country).toUpperCase() : null
    const wantD = t.device ? String(t.device).toLowerCase() : null
    if (wantC && wantC !== country) continue
    if (wantD && wantD !== device) continue
    if (wantC || wantD) return t.url
  }
  return rules.default || null
}

// Validate a routing payload → { ok, rules } or { ok:false, error, message }.
const DEVICES = new Set(['mobile', 'tablet', 'desktop', 'bot'])
function parseRouting(body) {
  if (body == null) return { ok: true, rules: null }
  if (typeof body !== 'object' || !Array.isArray(body.targets)) return { ok: false, error: 'invalid_routing', message: 'routing must be { targets: [ { country|device, url } ], default? }.' }
  if (body.targets.length > 50) return { ok: false, error: 'too_many_targets', message: 'A link can have at most 50 routing targets.' }
  const urlOk = (u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(u || '')) && String(u).length <= 2048
  const targets = []
  for (const t of body.targets) {
    if (!t || typeof t !== 'object' || !urlOk(t.url)) return { ok: false, error: 'invalid_target', message: 'Each target needs a valid http(s) url and a country (2-letter) and/or device.' }
    const country = t.country ? String(t.country).toUpperCase() : null
    const device = t.device ? String(t.device).toLowerCase() : null
    if (!country && !device) return { ok: false, error: 'invalid_target', message: 'Each target needs a country and/or a device to match on.' }
    if (country && !/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'invalid_country', message: `country must be a 2-letter ISO code (got "${t.country}").` }
    if (device && !DEVICES.has(device)) return { ok: false, error: 'invalid_device', message: `device must be one of: ${[...DEVICES].join(', ')}.` }
    targets.push({ ...(country ? { country } : {}), ...(device ? { device } : {}), url: String(t.url) })
  }
  if (body.default != null && !urlOk(body.default)) return { ok: false, error: 'invalid_default', message: 'routing.default must be a valid http(s) url.' }
  return { ok: true, rules: { targets, ...(body.default != null ? { default: String(body.default) } : {}) } }
}

const topN = (obj, n) => Object.entries(obj || {}).map(([k, v]) => ({ name: k, clicks: v })).sort((a, b) => b.clicks - a.clicks).slice(0, n)

// Aggregate stats for a set of keys since `since` (Date|null). Returns a map key → summary.
async function statsForKeys(db, keys, since = null) {
  const out = {}
  for (const k of keys) out[k] = { total: 0, by_day: [], by_country: {}, by_device: {}, by_referrer: {} }
  if (!db || !keys.length) return out
  const q = { key: { $in: keys } }
  if (since) q.dayStr = { $gte: day(since) }
  const docs = await db.collection(COLLECTION).find(q).toArray()
  for (const d of docs) {
    const s = out[d.key]; if (!s) continue
    s.total += d.total || 0
    s.by_day.push({ day: d.dayStr, clicks: d.total || 0 })
    for (const [grp, dst] of [['country', s.by_country], ['device', s.by_device], ['referrer', s.by_referrer]]) {
      for (const [k, n] of Object.entries(d[grp] || {})) { const name = fromKey(k); dst[name] = (dst[name] || 0) + n }
    }
  }
  for (const k of keys) {
    const s = out[k]
    s.by_day.sort((a, b) => a.day.localeCompare(b.day))
    s.by_country = topN(s.by_country, 100)
    s.by_device = topN(s.by_device, 10)
    s.by_referrer = topN(s.by_referrer, MAX_REFERRERS_RETURNED)
  }
  return out
}

// Move a link's daily buckets to a new key (slug rename). Best-effort.
async function renameKey(db, oldKey, newKey) {
  try {
    const c = db.collection(COLLECTION)
    const docs = await c.find({ key: oldKey }).toArray()
    if (!docs.length) return 0
    await c.insertMany(docs.map((d) => ({ ...d, _id: `${newKey}|${d.dayStr}`, key: newKey })), { ordered: false }).catch(() => {})
    await c.deleteMany({ key: oldKey })
    return docs.length
  } catch (_) { return 0 }
}

const deleteKey = (db, key) => db.collection(COLLECTION).deleteMany({ key }).catch(() => null)

module.exports = { recordClick, resolveRouting, parseRouting, parseClick, statsForKeys, renameKey, deleteKey, deviceFromUA, refHost, ensureIndexes, COLLECTION, RETENTION_DAYS }
