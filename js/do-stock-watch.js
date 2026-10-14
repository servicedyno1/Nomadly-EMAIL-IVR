'use strict'
// do-stock-watch.js — Telegram admin alerts when a DigitalOcean RDP plan or VPS size goes OUT OF
// STOCK in a city, or comes BACK (2026-10-14). Runs after every live catalogue refresh (15 min).
// The last stock state lives in Mongo doSizeCatalog {_id:'stock_state'} so a restart never re-alerts,
// and an atomic hash swap makes sure only ONE pod sends each change. Also warns once when the
// DigitalOcean catalogue can't be refreshed for 2 h+ (orders keep using the last good copy).
const crypto = require('crypto')
const sizeCatalog = require('./do-size-catalog')

const log = (...a) => console.log('[DO-Stock]', ...a)
const MAX_SLUGS = 6

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

function _lines(keys) {
  const rdp = require('./digitalocean-rdp-service')
  const vps = require('./digitalocean-service')
  const out = []
  const vpsBy = new Map()
  for (const k of keys) {
    const [kind, region, item] = k.split('|')
    if (kind === 'rdp') {
      const d = rdp.REGION_DISPLAY[region] || {}
      const t = (rdp.TIERS || []).find(x => x.slug === item)
      out.push(`• RDP <b>${t ? t.name : item}</b> — ${d.emoji || ''} ${d.label || region}`)
    } else {
      if (!vpsBy.has(region)) vpsBy.set(region, [])
      vpsBy.get(region).push(item)
    }
  }
  for (const [region, slugs] of vpsBy) {
    const d = (vps.REGION_DISPLAY || {})[region] || {}
    const shown = slugs.slice(0, MAX_SLUGS).join(', ') + (slugs.length > MAX_SLUGS ? ` (+${slugs.length - MAX_SLUGS} more)` : '')
    out.push(`• VPS ${d.emoji || ''} ${d.label || region}: ${shown}`)
  }
  return out
}

function changeMessage(wentOut, cameBack) {
  const parts = ['📦 <b>DigitalOcean stock changed</b>']
  if (wentOut.length) parts.push('', '🔴 <b>Out of stock now</b> (orders blocked before payment):', ..._lines(wentOut))
  if (cameBack.length) parts.push('', '🟢 <b>Back in stock</b>:', ..._lines(cameBack))
  parts.push('', 'RDP = AMD only, any datacenter in the same city counts. Live catalogue, refreshed every 15 min.')
  return parts.join('\n')
}

function baselineMessage(cur) {
  const out = Object.keys(cur).filter(k => !cur[k])
  if (!out.length) return null
  return ['📦 <b>DigitalOcean stock check started</b>', '', '🔴 <b>Currently out of stock</b> (orders blocked before payment):', ..._lines(out),
    '', 'You will be alerted here when anything goes out of stock or comes back.'].join('\n')
}

async function check({ col, notify, onBackInStock, now = new Date() } = {}) {
  const st = sizeCatalog.getState()
  if (!col || !st.loaded || st.source !== 'live' || st.last_error) return { skipped: 'no_live_catalogue' }
  const cur = snapshot()
  const hash = hashOf(cur)
  const prev = await col.findOne({ _id: 'stock_state' })
  if (!prev) {
    try { await col.insertOne({ _id: 'stock_state', matrix: cur, hash, at: now }) } catch (_) { return { skipped: 'other_pod' } }
    const message = baselineMessage(cur)
    if (message && notify) notify(message)
    return { baseline: true, message }
  }
  if (prev.hash === hash) return { changed: 0 }
  const was = prev.matrix || {}
  const wentOut = Object.keys(cur).filter(k => was[k] === true && !cur[k])
  const cameBack = Object.keys(cur).filter(k => was[k] === false && cur[k])
  const r = await col.updateOne({ _id: 'stock_state', hash: prev.hash }, { $set: { matrix: cur, hash, at: now } })
  if (!r.modifiedCount) return { skipped: 'other_pod' }
  if (!wentOut.length && !cameBack.length) return { changed: 0 }
  const message = changeMessage(wentOut, cameBack)
  if (notify) notify(message)
  // Only the pod that won the hash swap gets here → each restoration is pushed once (reseller back_in_stock webhooks).
  if (cameBack.length && typeof onBackInStock === 'function') {
    try { const p = onBackInStock(cameBack, now); if (p && p.catch) p.catch(e => log(`back-in-stock hook error: ${e.message}`)) } catch (e) { log(`back-in-stock hook error: ${e.message}`) }
  }
  log(`stock changed: ${wentOut.length} out, ${cameBack.length} back`)
  return { wentOut, cameBack, message }
}

let _staleAlerted = false
function staleCheck(notify) {
  const st = sizeCatalog.getState()
  if (st.last_error && st.stale) {
    if (_staleAlerted) return null
    _staleAlerted = true
    const msg = `⚠️ <b>DigitalOcean catalogue unreachable</b>\nCould not refresh sizes/stock (${st.last_error}). Orders keep using the last good copy (${st.fetched_at || 'none — static AMD sizes'}), so stock shown may be out of date.`
    if (notify) notify(msg)
    return msg
  }
  if (!st.last_error && _staleAlerted) {
    _staleAlerted = false
    const msg = '✅ <b>DigitalOcean catalogue reachable again</b> — live stock is up to date.'
    if (notify) notify(msg)
    return msg
  }
  return null
}

let _started = false
function start(db, { notify, onBackInStock } = {}) {
  if (_started || !db || typeof db.collection !== 'function' || typeof notify !== 'function') return false
  _started = true
  const col = db.collection('doSizeCatalog')
  sizeCatalog.onRefresh(() => {
    staleCheck(notify)
    check({ col, notify, onBackInStock }).catch(e => log(`check error: ${e.message}`))
  })
  log('started (alerts on stock changes after each catalogue refresh)')
  return true
}

function _resetForTest() { _started = false; _staleAlerted = false }

module.exports = { start, check, staleCheck, snapshot, changeMessage, baselineMessage, _resetForTest }
