'use strict'
// Travel eSIM shop (Bird eSIM API): data plans for 187 countries, sold at 3x Bird's price from the wallet.
// Catalog cached 6h. Orders: debit → Bird order (Idempotency-Key) → poll → credentials (QR / install links) stored
// per order; failed orders are refunded. Preview (WEB_CLOUDIVR_DRY_RUN=true) never buys — it simulates an order.
const axios = require('axios')
const crypto = require('crypto')
const BASE = 'https://us1.platform.bird.com/v1/esim'
const MARKUP = Number(process.env.TRAVEL_ESIM_MARKUP || 3)
const hdr = () => ({ Authorization: `Bearer ${process.env.BIRD_API_KEY}` })
const bird = (method, path, data, headers = {}) => axios({ method, url: `${BASE}${path}`, data, headers: { ...hdr(), ...headers }, timeout: 30000 }).then(r => r.data)
const sell = (cost) => Math.ceil(cost * MARKUP * 100) / 100
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const zoneOf = (name) => String(name).split(/ \d/)[0]

let cache = { at: 0, zones: [] }
async function catalog() {
  if (Date.now() - cache.at < 6 * 3600000 && cache.zones.length) return cache.zones
  const all = []
  let cursor = null
  for (let i = 0; i < 30; i++) {
    const d = await bird('get', `/offers?limit=100${cursor ? `&starting_after=${cursor}` : ''}`)
    const rows = d.data || []
    all.push(...rows)
    if (!rows.length || !d.next_cursor) break
    cursor = d.next_cursor
  }
  const zoneCountries = {}
  cursor = null
  for (let i = 0; i < 10; i++) {
    const d = await bird('get', `/zones?limit=100${cursor ? `&starting_after=${cursor}` : ''}`).catch(() => ({}))
    for (const z of d.data || []) zoneCountries[z.id] = z.countries || []
    if (!(d.data || []).length || !d.next_cursor) break
    cursor = d.next_cursor
  }
  const zones = {}
  for (const o of all) {
    if (o.status !== 'active' || o.pricing?.type !== 'bundle') continue
    const z = zoneOf(o.name), cost = Number(o.pricing.price.amount)
    ;(zones[z] = zones[z] || { zone: z, code: (zoneCountries[o.zone_id] || o.zone?.countries || []).length === 1 ? (zoneCountries[o.zone_id] || o.zone.countries)[0] : null, offers: [] }).offers.push({ id: o.id, name: o.name, gb: Math.round(o.pricing.data.amount_bytes / 1.024e8) / 10, days: o.pricing.validity.value, price: sell(cost), cost, speed: o.speed })
  }
  const list = Object.values(zones).map(z => ({ ...z, offers: z.offers.sort((a, b) => a.price - b.price), from: Math.min(...z.offers.map(o => o.price)) })).sort((a, b) => a.zone.localeCompare(b.zone))
  cache = { at: Date.now(), zones: list }
  return list
}
const findOffer = async (id) => { for (const z of await catalog()) { const o = z.offers.find(x => x.id === id); if (o) return { ...o, zone: z.zone, code: z.code } } return null }

function createTravelEsim({ db, h, walletOps, notify, notifyAdmin = () => {}, log = console.log }) {
  const w = walletOps(db), col = db.collection('travelEsims')
  const bad = (res, s, error, message) => res.status(s).json({ error, message })
  const pub = ({ _id, chatId, cost, idemKey, ...d }) => ({ id: _id, ...d })

  async function settle(d) {
    if (d.status !== 'processing' || d.dryRun) return d
    const o = await bird('get', `/orders/${d.orderId}`).catch(() => null)
    if (!o) return d
    if (o.status === 'completed') {
      const c = await bird('get', `/sims/${o.esim_id}/credentials`).catch(() => null)
      const set = { status: 'active', esimId: o.esim_id, packageId: o.package_id, completedAt: new Date(), ...(c ? { install: { qr: c.qr_code_url, activationCode: c.activation_code, smdp: c.smdp_address, ios: c.ios_install_url, android: c.android_install_url, apn: c.apn || null, roaming: !!c.data_roaming_required } } : {}) }
      await col.updateOne({ _id: d._id, status: 'processing' }, { $set: set })
      notify?.push(d.chatId, `Your ${d.name} travel eSIM is ready. Open Travel eSIM to install it.`, null, { kind: 'billing' }).catch(() => {})
      return { ...d, ...set }
    }
    if (o.status === 'failed') {
      const r = await col.updateOne({ _id: d._id, status: 'processing' }, { $set: { status: 'failed', failure: o.failure_reason || o.failure_code || 'failed' } })
      if (r.modifiedCount) {
        await w.credit(d.chatId, d.price)
        await db.collection('transactions').insertOne({ _id: `travel-esim-refund-${d._id}`, chatId: d.chatId, type: 'travel-esim-refund', amount: -d.price, currency: 'USD', status: 'completed', ref: d._id, createdAt: new Date() })
        notifyAdmin(`🚨 [TravelESIM] Bird order ${d.orderId} failed (${o.failure_code}) — ${d.chatId} refunded $${d.price}`)
      }
      return { ...d, status: 'failed' }
    }
    return d
  }

  function routes(r) {
    r.get('/travel-esim/plans', h(async (req, res) => res.json({ zones: await catalog(), markup: MARKUP })))
    r.get('/travel-esim/orders', h(async (req, res) => {
      const rows = await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(50).toArray()
      res.json({ orders: (await Promise.all(rows.map(settle))).map(pub) })
    }))
    const busy = new Set()
    r.post('/travel-esim/orders', h(async (req, res) => {
      if (busy.has(req.webChatId)) return bad(res, 409, 'busy', 'Your last order is still going through. Wait a moment.')
      busy.add(req.webChatId)
      try { await order(req, res) } finally { busy.delete(req.webChatId) }
    }))
    async function order(req, res) {
      const offer = await findOffer(String(req.body?.offerId || ''))
      if (!offer) return bad(res, 404, 'offer_not_found', 'That plan isn’t available any more. Pick another one.')
      const quote = dryRun() ? { offer_revision: 0, price: { amount: String(offer.cost), currency_code: 'USD' } } : (await bird('get', `/offers/${offer.id}/checkout`)).one_time
      const cost = Number(quote?.price?.amount), price = sell(cost)
      if (!(cost > 0)) return bad(res, 409, 'price_changed', 'This plan can’t be bought right now. Try another one.')
      if (!(await w.debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `This plan costs $${price}. Top up your wallet first.`)
      const id = `tes_${crypto.randomUUID().slice(0, 12)}`, idemKey = `cloudivr-${id}`
      const doc = { _id: id, chatId: req.webChatId, offerId: offer.id, name: offer.name, zone: offer.zone, code: offer.code || null, gb: offer.gb, days: offer.days, price, cost, idemKey, status: 'processing', createdAt: new Date(), ...(dryRun() ? { dryRun: true } : {}) }
      await col.insertOne(doc)
      await db.collection('transactions').insertOne({ _id: `travel-esim-${id}`, chatId: String(req.webChatId), type: 'travel-esim', amount: price, currency: 'USD', status: 'completed', ref: offer.name, createdAt: new Date() })
      if (dryRun()) {
        const set = { status: 'active', completedAt: new Date(), install: { qr: null, activationCode: 'LPA:1$preview.example$PREVIEW-ONLY', smdp: 'preview.example', ios: null, android: null, apn: null, roaming: true } }
        await col.updateOne({ _id: id }, { $set: set })
        return res.json(pub({ ...doc, ...set }))
      }
      try {
        const o = await bird('post', '/orders', { offer_id: offer.id, offer_revision: quote.offer_revision, expected_price: quote.price }, { 'Idempotency-Key': idemKey, 'Content-Type': 'application/json' })
        await col.updateOne({ _id: id }, { $set: { orderId: o.id } })
        let d = { ...doc, orderId: o.id }
        for (let i = 0; i < 10 && d.status === 'processing'; i++) { await new Promise(r => setTimeout(r, 2000)); d = await settle(d) }
        log(`[TravelESIM] ${req.webChatId} bought ${offer.name} $${price} (cost $${cost}) → ${d.status}`)
        res.json(pub(d))
      } catch (e) {
        await col.updateOne({ _id: id }, { $set: { status: 'failed', failure: e.response?.data?.error?.message || e.message } })
        await w.credit(req.webChatId, price)
        await db.collection('transactions').insertOne({ _id: `travel-esim-refund-${id}`, chatId: String(req.webChatId), type: 'travel-esim-refund', amount: -price, currency: 'USD', status: 'completed', ref: id, createdAt: new Date() })
        notifyAdmin(`🚨 [TravelESIM] order for ${offer.name} failed: ${e.response?.data?.error?.message || e.message} — refunded`)
        bad(res, 502, 'order_failed', 'The eSIM couldn’t be ordered right now. You weren’t charged.')
      }
    }
  }
  return { routes }
}

module.exports = { createTravelEsim, catalog, sell }
