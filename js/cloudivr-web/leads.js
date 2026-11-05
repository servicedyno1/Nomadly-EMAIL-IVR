'use strict'
// Lead list check ($0.015/number: active line, mobile/landline, carrier, owner name) and the Quick IVR owner-name lookup.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps } = require('./wallet')
const { listLeads } = require('./contacts')

const RATE = Number(process.env.RATE_LEAD_VALIDATOR || 0.015)
const CNAM_RATE = Number(process.env.RATE_CNAM || 0.015)
const MAX = 2000
const KEEP_MS = 30 * 864e5
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const money = (n) => Math.round(n * 10000) / 10000
const GENERIC = ['wireless caller', 'unknown', 'unavailable', 'no name', 'caller', 'n/a', 'private']
const clean = (n) => { const d = String(n || '').replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : `+${d}` }
const titleName = (raw) => {
  const t = String(raw || '').trim()
  if (t.length < 2 || GENERIC.some(g => t.toLowerCase().startsWith(g))) return null
  return t.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}
// Throws when the lookup itself fails (so the caller can refund); null = no name listed.
const cnam = async (phone) => {
  if (dry()) return ['Jane Doe', 'Sam Lee', null][parseInt(phone.slice(-1), 10) % 3]
  return titleName(await require('../cnam-service.js').lookupCnam(phone))
}
const LINE = { WIRELESS: 'mobile', LANDLINE: 'landline', VOIP: 'voip' }

// One number → { phone, status: active|invalid|unchecked, line, carrier, name }
async function checkOne(phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { phone, status: 'invalid', reason: 'Not a full phone number' }
  const name = (p) => cnam(p).catch(() => null)
  if (dry()) {
    const k = parseInt(phone.slice(-2), 10) % 10
    if (k === 0) return { phone, status: 'invalid', reason: 'Disconnected' }
    return { phone, status: 'active', line: k % 3 ? 'mobile' : 'landline', carrier: k % 2 ? 'T-Mobile' : 'Verizon', name: phone.startsWith('+1') ? await name(phone) : null }
  }
  if (phone.startsWith('+1')) {
    const r = await axios.get(`http://api.east.alcazarnetworks.com/api/2.2/lrn?tn=${phone.slice(1)}&extended=true&output=json&key=${process.env.API_ALCAZAR}`, { timeout: 15000 }).then(x => x.data).catch(() => undefined)
    if (r === undefined || typeof r === 'string' || r?.error || r?.Error) return { phone, status: 'unchecked' }
    if (!r?.LINETYPE) return { phone, status: 'invalid', reason: 'Not an active line' }
    return { phone, status: 'active', line: LINE[r.LINETYPE] || r.LINETYPE.toLowerCase(), carrier: r.LEC || '', name: await name(phone) }
  }
  const ok = await require('../validatePhoneNeutrino.js')(phone.slice(1)).catch(() => undefined)
  if (ok === undefined) return { phone, status: 'unchecked' }
  return ok ? { phone, status: 'active' } : { phone, status: 'invalid', reason: 'Not a valid number' }
}

function routes(router, { db, h }) {
  const jobs = db.collection('webLeadChecks')
  const cache = db.collection('webCnamCache')
  const known = db.collection('webLeadResults')
  const tx = db.collection('transactions')
  const w = walletOps(db)
  const inFlight = new Set()
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const log = (chatId, type, amount, metadata) => tx.insertOne({ _id: `${type}-${crypto.randomUUID()}`, chatId: String(chatId), type, amount: money(amount), currency: 'USD', status: 'completed', metadata: { ...metadata, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})

  // Numbers to check: pasted list, a saved contact list, or every contact.
  const listOf = async (req) => {
    const b = req.body
    let raw
    if (b.scope === 'contacts') raw = (await db.collection('webContacts').find({ chatId: String(req.webChatId) }, { projection: { phone: 1 } }).limit(MAX + 1).toArray()).map(c => c.phone)
    else if (b.listId) raw = (await listLeads(db, req.webChatId, b.listId)).leads.map(l => l.number)
    else raw = Array.isArray(b.numbers) ? b.numbers : String(b.numbers || '').split(/[\s,;]+/)
    return [...new Set(raw.map(clean).filter(x => x.length > 4))]
  }
  // Results from the last 30 days are reused for free (unless the user asks to check again).
  const split = async (chatId, list, recheck) => {
    if (recheck) return { fresh: list, old: [] }
    const rows = await known.find({ _id: { $in: list.map(p => `${chatId}:${p}`) }, at: { $gt: new Date(Date.now() - KEEP_MS) } }).toArray()
    const old = rows.map(r => ({ ...r.result, cached: true, checkedAt: r.at }))
    const seen = new Set(old.map(r => r.phone))
    return { fresh: list.filter(p => !seen.has(p)), old }
  }

  router.post('/leads/quote', h(async (req, res) => {
    const list = await listOf(req)
    const { fresh } = await split(req.webChatId, list, !!req.body.recheck)
    res.json({ count: list.length, fresh: fresh.length, cached: list.length - fresh.length, rate: RATE, price: money(fresh.length * RATE), max: MAX })
  }))
  router.post('/leads/check', h(async (req, res) => {
    const chatId = req.webChatId
    const list = await listOf(req)
    if (!list.length) return bad(res, 400, 'empty', 'Add at least one number.')
    if (list.length > MAX) return bad(res, 400, 'too_many', `Check up to ${MAX} numbers at a time.`)
    const { fresh, old } = await split(chatId, list, !!req.body.recheck)
    const price = money(fresh.length * RATE)
    if (!(await w.debit(chatId, price))) return bad(res, 402, 'insufficient_balance', `Checking ${fresh.length} numbers costs $${price}. Top up your wallet first.`)
    if (price > 0) await log(chatId, 'lead-check', price, { count: fresh.length })
    const id = crypto.randomUUID()
    const done = !fresh.length
    await jobs.insertOne({ _id: id, chatId, status: done ? 'done' : 'running', total: list.length, done: old.length, charge: price, refund: 0, cached: old.length, results: done ? old : [], createdAt: new Date() })
    res.json({ id, total: list.length, charge: price, cached: old.length, status: done ? 'done' : 'running' })
    if (done) return
    ;(async () => {
      const out = []
      for (let i = 0; i < fresh.length; i += 8) {
        out.push(...await Promise.all(fresh.slice(i, i + 8).map(p => checkOne(p).catch(() => ({ phone: p, status: 'unchecked' })))))
        await jobs.updateOne({ _id: id }, { $set: { done: old.length + out.length } })
      }
      const now = new Date()
      const ok = out.filter(r => r.status !== 'unchecked')
      if (ok.length) await known.bulkWrite(ok.map(r => ({ updateOne: { filter: { _id: `${chatId}:${r.phone}` }, update: { $set: { chatId, result: r, at: now } }, upsert: true } })))
      const refund = money((out.length - ok.length) * RATE)
      if (refund > 0) { await w.credit(chatId, refund); await log(chatId, 'lead-check-refund', refund, { count: out.length - ok.length }) }
      await jobs.updateOne({ _id: id }, { $set: { status: 'done', results: [...old, ...out], refund, charge: money(price - refund), finishedAt: now } })
    })().catch(() => jobs.updateOne({ _id: id }, { $set: { status: 'failed' } }))
  }))
  router.get('/leads/check/:id', h(async (req, res) => {
    const j = await jobs.findOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!j) return bad(res, 404, 'not_found', 'Check not found.')
    res.json({ id: j._id, status: j.status, total: j.total, done: j.done, charge: j.charge, refund: j.refund || 0, cached: j.cached || 0, results: j.results })
  }))
  // Contacts: delete the contacts a finished check found dead.
  router.post('/leads/check/:id/delete-dead', h(async (req, res) => {
    const j = await jobs.findOne({ _id: String(req.params.id), chatId: req.webChatId, status: 'done' })
    if (!j) return bad(res, 404, 'not_found', 'Check not found.')
    const dead = (j.results || []).filter(r => r.status === 'invalid').map(r => r.phone)
    const r = dead.length ? await db.collection('webContacts').deleteMany({ chatId: String(req.webChatId), phone: { $in: dead } }) : { deletedCount: 0 }
    res.json({ deleted: r.deletedCount })
  }))

  // Quick IVR: owner name for a US/Canada number when the user taps "Look up". $0.015, free again for 30 days.
  router.post('/cnam', h(async (req, res) => {
    const chatId = req.webChatId
    const phone = clean(req.body.phone)
    if (!/^\+1\d{10}$/.test(phone)) return res.json({ phone, name: null, charged: 0, supported: false })
    const key = `${chatId}:${phone}`
    const hit = await cache.findOne({ _id: key })
    if (hit && Date.now() - new Date(hit.at).getTime() < KEEP_MS) return res.json({ phone, name: hit.name, charged: 0, supported: true, cached: true })
    if (inFlight.has(key)) return bad(res, 409, 'in_progress', 'Already looking up this number — one moment.')
    inFlight.add(key)
    try {
      if (!(await w.debit(chatId, CNAM_RATE))) return bad(res, 402, 'insufficient_balance', `An owner-name lookup costs $${CNAM_RATE}. Top up your wallet first.`)
      let name
      try { name = await cnam(phone) } catch {
        await w.credit(chatId, CNAM_RATE)
        return bad(res, 502, 'lookup_failed', 'We couldn’t look up this number right now. You were not charged — try again in a minute.')
      }
      await log(chatId, 'cnam-lookup', CNAM_RATE, { phoneNumber: phone })
      await cache.updateOne({ _id: key }, { $set: { name, at: new Date() } }, { upsert: true })
      res.json({ phone, name, charged: CNAM_RATE, supported: true })
    } finally { inFlight.delete(key) }
  }))
}

module.exports = { routes, RATE, CNAM_RATE }
