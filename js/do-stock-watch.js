'use strict'
// do-stock-watch.js — Telegram admin alerts when a DigitalOcean RDP plan or VPS size goes OUT OF
// STOCK in a city, or comes BACK (2026-10-14). Runs after every live catalogue refresh (15 min).
//
// CONFIRMED CHANGES ONLY (2026-10-14 RCA): DigitalOcean's catalogue flaps — e.g. all 15 Premium Intel
// sizes in New York (nyc2) are listed, then dropped, then listed again, sometimes between two calls a few
// seconds apart. Alerting on every pull produced a stream of "out" / "back" pairs that reversed within
// 2-35 min (Nomadly 11, Smadav 4, Voodoo 2 on 2026-10-14 — none of them about RDP). Now a change is only
// announced once it has held on EVERY pull for CONFIRM_MS (30 min, DO_STOCK_CONFIRM_MIN). While a change
// is unconfirmed the catalogue is re-pulled every RECHECK_MS (5 min, DO_STOCK_RECHECK_MIN) so even an
// idle bot samples densely; one pull showing the old state drops it as a blip.
// Order-time stock gates are NOT affected — they always read the live catalogue (do-size-catalog).
//
// State: Mongo doSizeCatalog {_id:'stock_state', matrix (confirmed), pending {key:{val,since}}, rev, hash}
// so a restart never re-alerts, and an atomic rev swap makes sure only ONE pod sends each change. Also warns
// once when the DigitalOcean catalogue can't be refreshed for 2 h+ (orders keep using the last good copy).
const crypto = require('crypto')
const sizeCatalog = require('./do-size-catalog')

const log = (...a) => console.log('[DO-Stock]', ...a)
const envMin = (k, d) => { const v = process.env[k]; const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d }
const T = {
  confirmMs: envMin('DO_STOCK_CONFIRM_MIN', 30) * 60000,
  recheckMs: Math.max(60000, envMin('DO_STOCK_RECHECK_MIN', 5) * 60000),
}
// A pull can land a few seconds before since + confirmMs (timer + request jitter) — still counts.
const slackOf = (confirmMs) => Math.min(60000, confirmMs)

// key → in stock? · rdp|<do region>|<tier> (city-level, AMD only) · vps|<customer region>|<size slug>
function snapshot() {
  const rdp = require('./digitalocean-rdp-service')
  const vps = require('./digitalocean-service')
  const items = {}
  for (const r of rdp.availability()) for (const p of r.plans) items[`rdp|${r.region_slug}|${p.plan}`] = !!p.in_stock
  const products = [...(vps.PRODUCT_CATALOG_SSD || []), ...(vps.PRODUCT_CATALOG_NVME || [])]
  for (const region of Object.keys(vps.REGION_TO_DO_SLUG || {})) {
    for (const p of products) items[`vps|${region}|${p.productId}`] = !!vps.isProductAvailable(p.productId, region)
  }
  return items
}
const hashOf = (m) => crypto.createHash('sha1').update(JSON.stringify(Object.keys(m).sort().map(k => [k, m[k]]))).digest('hex')
const pendingSig = (p) => JSON.stringify(Object.keys(p || {}).sort().map(k => [k, !!p[k].val, new Date(p[k].since).getTime()]))
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Short message lines ──────────────────────────────────────────────────────────────────────────
// One line per (direction, kind, what changed); regions with the same change share a line:
//   🔴 RDP Toronto, Frankfurt: all plans · 🟢 VPS US Central, US East: all Intel
const _rdpPlace = (label) => { const m = /\(([^)]+)\)/.exec(label || ''); return m ? m[1] : (label || '') } // "Germany (Frankfurt)" → Frankfurt
const _vpsPlace = (label) => String(label || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim()                   // "Europe (EU)" → Europe
const _family = (slug) => (/-amd$/i.test(slug) ? 'AMD' : /-intel$/i.test(slug) ? 'Intel' : 'Basic')
const _short = (slug) => String(slug).replace(/^s-/, '').replace(/-(amd|intel)$/i, '')

function _describeRdp(tiers) {
  const rdp = require('./digitalocean-rdp-service')
  const all = (rdp.TIERS || []).map(t => t.slug)
  if (all.length && all.every(s => tiers.includes(s))) return 'all plans'
  return all.filter(s => tiers.includes(s)).concat(tiers.filter(s => !all.includes(s)))
    .map(s => { const t = (rdp.TIERS || []).find(x => x.slug === s); return t ? t.name : s }).join(', ')
}
function _describeVps(slugs) {
  const vps = require('./digitalocean-service')
  const products = [...(vps.PRODUCT_CATALOG_SSD || []), ...(vps.PRODUCT_CATALOG_NVME || [])].map(p => p.productId)
  const parts = []
  for (const fam of ['AMD', 'Intel', 'Basic']) {
    const mine = slugs.filter(s => _family(s) === fam)
    if (!mine.length) continue
    const total = products.filter(s => _family(s) === fam).length
    parts.push(mine.length === total ? `all ${fam}` : mine.length <= 2 ? `${fam} ${mine.map(_short).join(', ')}` : `${mine.length} ${fam}`)
  }
  return parts.join(' · ')
}

function _lines(keys, sign) {
  const rdp = require('./digitalocean-rdp-service')
  const vps = require('./digitalocean-service')
  const byRegion = { rdp: new Map(), vps: new Map() }
  for (const k of keys) {
    const [kind, region, item] = String(k).split('|')
    if (!byRegion[kind] || !region || !item) continue
    if (!byRegion[kind].has(region)) byRegion[kind].set(region, [])
    byRegion[kind].get(region).push(item)
  }
  const out = []
  for (const kind of ['rdp', 'vps']) {
    const groups = new Map() // description → [place]
    for (const [region, items] of byRegion[kind]) {
      const desc = kind === 'rdp' ? _describeRdp(items) : _describeVps(items)
      const place = kind === 'rdp' ? _rdpPlace((rdp.REGION_DISPLAY[region] || {}).label || region) : _vpsPlace(((vps.REGION_DISPLAY || {})[region] || {}).label || region)
      if (!groups.has(desc)) groups.set(desc, [])
      groups.get(desc).push(place)
    }
    for (const [desc, places] of groups) out.push(`${sign} ${kind.toUpperCase()} ${esc(places.join(', '))}: ${esc(desc)}`)
  }
  return out
}

function changeMessage(wentOut, cameBack) {
  return ['📦 <b>Stock change</b>', ..._lines(wentOut || [], '🔴'), ..._lines(cameBack || [], '🟢')].join('\n')
}

function baselineMessage(cur) {
  const out = Object.keys(cur).filter(k => !cur[k])
  if (!out.length) return null
  return ['📦 <b>Stock watch on</b> — sold out now:', ..._lines(out, '🔴')].join('\n')
}

// ── Check (after every live catalogue refresh) ───────────────────────────────────────────────────
async function check({ col, notify, onBackInStock, now = new Date(), confirmMs = T.confirmMs } = {}) {
  const st = sizeCatalog.getState()
  if (!col || !st.loaded || st.source !== 'live' || st.last_error) return { skipped: 'no_live_catalogue' }
  const cur = snapshot()
  const prev = await col.findOne({ _id: 'stock_state' })
  if (!prev) {
    try { await col.insertOne({ _id: 'stock_state', matrix: cur, hash: hashOf(cur), pending: {}, rev: 1, at: now }) } catch { return { skipped: 'other_pod' } }
    const message = baselineMessage(cur)
    if (message && notify) notify(message)
    return { baseline: true, message, pending: 0 }
  }
  const t = now.getTime()
  const slack = slackOf(confirmMs)
  const was = prev.matrix || {}
  const oldPending = prev.pending || {}
  const matrix = {}, pending = {}
  const wentOut = [], cameBack = []
  let blips = 0
  for (const k of Object.keys(cur)) {
    const v = cur[k]
    // New key (product/region added) → adopt silently. Unchanged → any unconfirmed flip was a blip.
    if (!(k in was) || was[k] === v) {
      matrix[k] = (k in was) ? was[k] : v
      if (oldPending[k]) blips++
      continue
    }
    const p = oldPending[k]
    const since = p && !!p.val === v && p.since ? new Date(p.since).getTime() : t
    if (t - since >= confirmMs - slack) { matrix[k] = v; (v ? cameBack : wentOut).push(k) } else { matrix[k] = was[k]; pending[k] = { val: v, since: new Date(since) } }
  }
  // Keys no longer in the snapshot (product retired) are dropped silently.
  const hash = hashOf(matrix)
  const nPending = Object.keys(pending).length
  if (hash === hashOf(was) && pendingSig(pending) === pendingSig(oldPending)) return { changed: 0, pending: nPending }
  const r = await col.updateOne({ _id: 'stock_state', rev: prev.rev == null ? null : prev.rev }, { $set: { matrix, hash, pending, rev: (Number(prev.rev) || 0) + 1, at: now } })
  if (!r.modifiedCount) return { skipped: 'other_pod' }
  const newPending = Object.keys(pending).filter(k => !oldPending[k] || !!oldPending[k].val !== pending[k].val).length
  if (newPending || blips) log(`unconfirmed: ${nPending} change(s) waiting ${Math.round(confirmMs / 60000)} min (${newPending} new)${blips ? `, ${blips} blip(s) dropped — DigitalOcean flipped back` : ''}`)
  if (!wentOut.length && !cameBack.length) return { changed: 0, pending: nPending, blips }
  const message = changeMessage(wentOut, cameBack)
  if (notify) notify(message)
  // Only the pod that won the rev swap gets here → each confirmed restoration is pushed once (reseller back_in_stock webhooks).
  if (cameBack.length && typeof onBackInStock === 'function') {
    try { const p = onBackInStock(cameBack, now); if (p && p.catch) p.catch(e => log(`back-in-stock hook error: ${e.message}`)) } catch (e) { log(`back-in-stock hook error: ${e.message}`) }
  }
  log(`stock changed (held ${Math.round(confirmMs / 60000)} min): ${wentOut.length} out, ${cameBack.length} back`)
  return { wentOut, cameBack, message, pending: nPending, blips }
}

let _staleAlerted = false
function staleCheck(notify) {
  const st = sizeCatalog.getState()
  if (st.last_error && st.stale) {
    if (_staleAlerted) return null
    _staleAlerted = true
    const err = String(st.last_error || '').slice(0, 120)
    const msg = `⚠️ <b>DigitalOcean unreachable</b> 2h+ — stock may be out of date (${esc(err)})`
    if (notify) notify(msg)
    return msg
  }
  if (!st.last_error && _staleAlerted) {
    _staleAlerted = false
    const msg = '✅ <b>DigitalOcean reachable again</b>'
    if (notify) notify(msg)
    return msg
  }
  return null
}

// While a change is unconfirmed, pull the catalogue again in RECHECK_MS (one timer at a time).
let _recheck = null
function _scheduleRecheck(ms = T.recheckMs) {
  if (_recheck) return false
  _recheck = setTimeout(() => { _recheck = null; sizeCatalog.refresh().catch(() => {}) }, ms)
  if (_recheck.unref) _recheck.unref()
  return true
}

let _started = false
function start(db, { notify, onBackInStock } = {}) {
  if (_started || !db || typeof db.collection !== 'function' || typeof notify !== 'function') return false
  _started = true
  const col = db.collection('doSizeCatalog')
  sizeCatalog.onRefresh(() => {
    staleCheck(notify)
    check({ col, notify, onBackInStock })
      .then(r => { if (r && r.pending) _scheduleRecheck() })
      .catch(e => log(`check error: ${e.message}`))
  })
  log(`started (alerts once a stock change holds ${Math.round(T.confirmMs / 60000)} min; re-checks every ${Math.round(T.recheckMs / 60000)} min while unconfirmed)`)
  return true
}

function _resetForTest() { _started = false; _staleAlerted = false; if (_recheck) { clearTimeout(_recheck); _recheck = null } }

module.exports = { start, check, staleCheck, snapshot, changeMessage, baselineMessage, _scheduleRecheck, _timing: T, _resetForTest }
