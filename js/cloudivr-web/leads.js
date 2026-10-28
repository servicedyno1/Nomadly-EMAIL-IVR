'use strict'
// Lead list check ($0.015/number: active line, mobile/landline, carrier, owner name) and the Quick IVR owner-name lookup.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps } = require('./wallet')

const RATE = Number(process.env.RATE_LEAD_VALIDATOR || 0.015)
const CNAM_RATE = Number(process.env.RATE_CNAM || 0.015)
const MAX = 2000
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const GENERIC = ['wireless caller', 'unknown', 'unavailable', 'no name', 'caller', 'n/a', 'private']
const clean = (n) => { const d = String(n || '').replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : `+${d}` }
const titleName = (raw) => {
  const t = String(raw || '').trim()
  if (t.length < 2 || GENERIC.some(g => t.toLowerCase().startsWith(g))) return null
  return t.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}
const cnam = async (phone) => {
  if (dry()) return ['Jane Doe', 'Sam Lee', null][parseInt(phone.slice(-1), 10) % 3]
  try { return titleName(await require('../cnam-service.js').lookupCnam(phone)) } catch { return null }
}
const LINE = { WIRELESS: 'mobile', LANDLINE: 'landline', VOIP: 'voip' }

// One number → { phone, status: active|invalid|unchecked, line, carrier, name }
async function checkOne(phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { phone, status: 'invalid', reason: 'Not a full phone number' }
  if (dry()) {
    const k = parseInt(phone.slice(-2), 10) % 10
    if (k === 0) return { phone, status: 'invalid', reason: 'Disconnected' }
    return { phone, status: 'active', line: k % 3 ? 'mobile' : 'landline', carrier: k % 2 ? 'T-Mobile' : 'Verizon', name: phone.startsWith('+1') ? await cnam(phone) : null }
  }
  if (phone.startsWith('+1')) {
    const r = await axios.get(`http://api.east.alcazarnetworks.com/api/2.2/lrn?tn=${phone.slice(1)}&extended=true&output=json&key=${process.env.API_ALCAZAR}`, { timeout: 15000 }).then(x => x.data).catch(() => undefined)
    if (r === undefined || typeof r === 'string' || r?.error || r?.Error) return { phone, status: 'unchecked' }
    if (!r?.LINETYPE) return { phone, status: 'invalid', reason: 'Not an active line' }
    return { phone, status: 'active', line: LINE[r.LINETYPE] || r.LINETYPE.toLowerCase(), carrier: r.LEC || '', name: await cnam(phone) }
  }
  const ok = await require('../validatePhoneNeutrino.js')(phone.slice(1)).catch(() => undefined)
  if (ok === undefined) return { phone, status: 'unchecked' }
  return ok ? { phone, status: 'active' } : { phone, status: 'invalid', reason: 'Not a valid number' }
}

function routes(router, { db, h }) {
  const jobs = db.collection('webLeadChecks')
  const cache = db.collection('webCnamCache')
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const listOf = (body) => [...new Set((Array.isArray(body.numbers) ? body.numbers : String(body.numbers || '').split(/[\s,;]+/)).map(clean).filter(x => x.length > 4))]

  router.post('/leads/quote', h(async (req, res) => {
    const list = listOf(req.body)
    res.json({ count: list.length, rate: RATE, price: +(list.length * RATE).toFixed(2), max: MAX })
  }))
  router.post('/leads/check', h(async (req, res) => {
    const list = listOf(req.body)
    if (!list.length) return bad(res, 400, 'empty', 'Add at least one number.')
    if (list.length > MAX) return bad(res, 400, 'too_many', `Check up to ${MAX} numbers at a time.`)
    const price = +(list.length * RATE).toFixed(2)
    if (!(await w.debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `Checking ${list.length} numbers costs $${price.toFixed(2)}. Top up your wallet first.`)
    const id = crypto.randomUUID()
    await jobs.insertOne({ _id: id, chatId: req.webChatId, status: 'running', total: list.length, done: 0, charge: price, results: [], createdAt: new Date() })
    res.json({ id, total: list.length, charge: price })
    ;(async () => {
      const out = []
      for (let i = 0; i < list.length; i += 8) {
        out.push(...await Promise.all(list.slice(i, i + 8).map(p => checkOne(p).catch(() => ({ phone: p, status: 'unchecked' })))))
        await jobs.updateOne({ _id: id }, { $set: { done: out.length } })
      }
      const refund = +(out.filter(r => r.status === 'unchecked').length * RATE).toFixed(2)
      if (refund > 0) await w.credit(req.webChatId, refund)
      await jobs.updateOne({ _id: id }, { $set: { status: 'done', results: out, refund, charge: +(price - refund).toFixed(2), finishedAt: new Date() } })
    })().catch(() => jobs.updateOne({ _id: id }, { $set: { status: 'failed' } }))
  }))
  router.get('/leads/check/:id', h(async (req, res) => {
    const j = await jobs.findOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!j) return bad(res, 404, 'not_found', 'Check not found.')
    res.json({ id: j._id, status: j.status, total: j.total, done: j.done, charge: j.charge, refund: j.refund || 0, results: j.results })
  }))

  // Quick IVR: owner name for a US/Canada number. $0.015, charged once per number (cached 30 days).
  router.post('/cnam', h(async (req, res) => {
    const phone = clean(req.body.phone)
    if (!/^\+1\d{10}$/.test(phone)) return res.json({ phone, name: null, charged: 0, supported: false })
    const key = `${req.webChatId}:${phone}`
    const hit = await cache.findOne({ _id: key })
    if (hit && Date.now() - new Date(hit.at).getTime() < 30 * 864e5) return res.json({ phone, name: hit.name, charged: 0, supported: true })
    if (!(await w.debit(req.webChatId, CNAM_RATE))) return bad(res, 402, 'insufficient_balance', `An owner-name lookup costs $${CNAM_RATE.toFixed(3)}. Top up your wallet first.`)
    const name = await cnam(phone)
    await cache.updateOne({ _id: key }, { $set: { name, at: new Date() } }, { upsert: true })
    res.json({ phone, name, charged: CNAM_RATE, supported: true })
  }))
}

module.exports = { routes, RATE, CNAM_RATE }
