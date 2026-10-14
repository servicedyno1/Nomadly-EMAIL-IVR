'use strict'
// do-stock-alerts.js — "Notify me when it's back" for a sold-out VPS / RDP (bot customers) and the
// reseller *.back_in_stock webhook payloads (2026-10-14).
//   • Customer alert: Mongo doStockAlerts, one per (chat, product, region, plan|any). After every live
//     catalogue refresh each active alert whose plan can be ordered again is claimed atomically and sent
//     ONCE. Alerts expire quietly after 14 days (no message); a TTL index removes them a week later.
//   • Reseller webhook: do-stock-watch reports what came back (one pod per change) → backInStockEvents()
//     turns each `kind|region|plan` key into one event per city + plan.
const sizeCatalog = require('./do-size-catalog')

const log = (...a) => console.log('[DO-StockAlerts]', ...a)
const TTL_DAYS = 14
const DAY_MS = 86400000
const KINDS = ['rdp', 'vps']

const alertId = (chatId, kind, region, plan) => `${chatId}:${kind}:${region}:${plan || '*'}`

// Is the alert's target orderable in this stock snapshot (do-stock-watch.snapshot())? plan null = any plan in the region.
function inStock(alert, snap) {
  const prefix = `${alert.kind}|${alert.region}|`
  if (alert.plan) return snap[prefix + alert.plan] === true
  return Object.keys(snap).some(k => k.startsWith(prefix) && snap[k] === true)
}

async function subscribe(col, { chatId, kind, region, plan = null, lang = 'en', now = new Date() } = {}) {
  if (!col || !chatId || !KINDS.includes(kind) || !region) throw new Error('subscribe: chatId, kind (rdp|vps) and region are required')
  const _id = alertId(chatId, kind, region, plan)
  const expiresAt = new Date(now.getTime() + TTL_DAYS * DAY_MS)
  await col.updateOne({ _id }, {
    $set: { chatId: String(chatId), kind, region: String(region), plan: plan || null, lang, status: 'active', createdAt: now, expiresAt },
    $unset: { sentAt: '' },
  }, { upsert: true })
  return { _id, expiresAt }
}

// Send every due alert once. notify(alert) does the Telegram message; a failed send is retried next refresh.
async function notifyDue({ col, snap, notify, now = new Date() } = {}) {
  if (!col || !snap || typeof notify !== 'function') return { sent: 0, expired: 0 }
  const exp = await col.updateMany({ status: 'active', expiresAt: { $lte: now } }, { $set: { status: 'expired' } })
  const due = (await col.find({ status: 'active', expiresAt: { $gt: now } }).toArray()).filter(a => inStock(a, snap))
  let sent = 0
  for (const a of due) {
    const claim = await col.updateOne({ _id: a._id, status: 'active' }, { $set: { status: 'sent', sentAt: now } })
    if (!claim.modifiedCount) continue // another pod sent it
    try { await notify(a); sent++ } catch (e) {
      log(`send failed for ${a._id}: ${e.message}`)
      await col.updateOne({ _id: a._id, status: 'sent' }, { $set: { status: 'active' }, $unset: { sentAt: '' } }).catch(() => {})
    }
  }
  return { sent, expired: exp.modifiedCount || 0 }
}

// Display names for a stock key part (used by the bot message and the webhook payload).
function describe(kind, region, plan) {
  if (kind === 'rdp') {
    const rdp = require('./digitalocean-rdp-service')
    const d = rdp.REGION_DISPLAY[region] || {}
    const t = (rdp.TIERS || []).find(x => x.slug === plan)
    return { place: `${d.emoji || ''} ${d.label || region}`.trim(), regionLabel: d.label || region, code: d.code || null, planName: t ? t.name : (plan || null) }
  }
  const vps = require('./digitalocean-service')
  const d = (vps.REGION_DISPLAY || {})[region] || {}
  const p = plan ? vps.getProduct(plan) : null
  return { place: `${d.emoji || ''} ${d.label || region}`.trim(), regionLabel: d.label || region, code: region, planName: p ? (p.botName || p.name) : (plan || null) }
}

// cameBack keys (`rdp|nyc3|pro`, `vps|US-central|s-2vcpu-4gb`) → [{ event, instanceId, dedupKey, payload }].
function backInStockEvents(keys, at = new Date()) {
  const rdp = require('./digitalocean-rdp-service')
  const vps = require('./digitalocean-service')
  const iso = new Date(at).toISOString()
  const out = []
  for (const k of keys || []) {
    const [kind, region, plan] = String(k).split('|')
    if (!KINDS.includes(kind) || !region || !plan) continue
    const d = describe(kind, region, plan)
    const base = { region: d.code, region_label: d.regionLabel, plan_name: d.planName, restored_at: iso }
    if (kind === 'rdp') {
      const av = (rdp.availability().find(r => r.region_slug === region) || { plans: [] }).plans.find(p => p.plan === plan) || {}
      out.push({ event: 'rdp.back_in_stock', instanceId: `${region}:${plan}`, dedupKey: `${region}:${plan}:${iso}`, payload: { ...base, region_slug: region, plan, plan_ids: (rdp.DURATIONS || [1, 2, 3]).map(m => `${plan}-${m}m`), cpu: 'AMD', build_region: av.build_region || null, same_city_fallback: !!av.same_city_fallback, price_usd: av.price_usd ?? null, base_price_usd: av.base_price_usd ?? null, surcharge_pct: av.surcharge_pct ?? 0 } })
    } else {
      const p = vps.getProduct(plan)
      const price = p ? vps.calculatePrice(p, region) : null
      const builds = vps.buildRegionsFor(plan, region)
      out.push({ event: 'vps.back_in_stock', instanceId: `${region}:${plan}`, dedupKey: `${region}:${plan}:${iso}`, payload: { ...base, plan_id: plan, build_region: builds[0] || null, same_city_fallback: !!builds[0] && builds[0] !== (vps.REGION_TO_DO_SLUG || {})[region], price_usd: price ? price.totalWithMarkup : null } })
    }
  }
  return out
}

let _started = false
function start(db, { notify, snapshot } = {}) {
  if (_started || !db || typeof db.collection !== 'function' || typeof notify !== 'function') return false
  _started = true
  const col = db.collection('doStockAlerts')
  col.createIndex({ status: 1, expiresAt: 1 }).catch(() => {})
  col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 }).catch(() => {})
  const snap = snapshot || (() => require('./do-stock-watch').snapshot())
  sizeCatalog.onRefresh((st) => {
    if (!st || !st.loaded || st.source !== 'live' || st.last_error) return
    notifyDue({ col, snap: snap(), notify }).then(r => { if (r.sent) log(`sent ${r.sent} back-in-stock alert(s)`) }).catch(e => log(`notify error: ${e.message}`))
  })
  log('started (customer back-in-stock alerts after each catalogue refresh)')
  return true
}
function _resetForTest() { _started = false }

module.exports = { subscribe, notifyDue, inStock, describe, backInStockEvents, alertId, start, TTL_DAYS, _resetForTest }
