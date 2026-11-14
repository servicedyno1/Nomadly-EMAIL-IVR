'use strict'
// Infobip request-based countries: customer pays now, we submit a Resource Request (with their saved details where the
// country needs them), poll it, then activate the assigned number — or refund in full if Infobip declines.
const crypto = require('crypto')
const ibc = require('../infobip/countries')
const { endUser } = require('./legal-profile')

const OK = /COMPLET|FULFIL|APPROV|DONE|SUCCESS/i
const NO = /REJECT|EXPIR|CANCEL|FAIL|DECLIN/i
const round2 = (n) => Math.round(n * 100) / 100

function createNumberRequests({ db, h, phoneConfig, numbersApi, walletOps, notify, notifyAdmin = () => {}, log = console.log, dryRun = () => false }) {
  const col = db.collection('numberRequests')
  const accounts = db.collection('webAccounts')
  const w = walletOps(db)
  const ib = () => require('../infobip')
  const pub = (r) => ({ id: r._id, country: r.country, countryName: r.countryName, plan: r.plan, price: r.price, status: r.status, phoneNumber: r.phoneNumber || null, note: r.note || null, createdAt: r.createdAt, updatedAt: r.updatedAt })

  function requirements(cfg, eu) {
    const v = { companyName: eu.name, companyAddress: eu.address, contactPerson: eu.contact }
    return cfg.keys.map(k => ({ key: k, value: v[k] }))
  }

  async function submit(r, cfg, eu) {
    if (dryRun()) return `dry-${crypto.randomUUID().slice(0, 8)}`
    const body = { type: 'NUMBER_PURCHASE', quantity: 1, numberType: 'VIRTUAL_LONG_NUMBER', capabilities: ['VOICE'], countryCode: r.country, requirements: requirements(cfg, eu), ...(cfg.clientType ? { clientType: cfg.clientType } : {}) }
    const d = (await ib().http().post('/resources/1/requests', body)).data
    return d.id
  }

  function routes(r) {
    r.post('/numbers/request', h(async (req, res) => {
      const country = String(req.body?.country || '').toUpperCase()
      const cfg = ibc.requestOf(country)
      const planKey = String(req.body?.plan || '')
      const plan = phoneConfig.plans[planKey]
      if (!cfg || !ib().enabled()) return res.status(400).json({ error: 'invalid_country', message: 'Pick a country from the list.' })
      if (!plan || !phoneConfig.isPlanAvailable(planKey)) return res.status(400).json({ error: 'invalid_plan', message: 'That plan is not available.' })
      const eu = endUser(req.webUser)
      const price = round2(plan.price)
      if (!(await w.debit(req.webChatId, price))) return res.status(402).json({ error: 'insufficient_balance', message: `This number costs $${price.toFixed(2)}. Your wallet has $${(await w.balance(req.webChatId)).toFixed(2)} — top up first.` })
      const doc = { _id: `nr_${crypto.randomUUID().slice(0, 12)}`, chatId: req.webChatId, email: req.webUser.email, country, countryName: cfg.name, plan: planKey, price, autoRenew: req.body?.autoRenew !== false, status: 'submitted', endUser: eu, createdAt: new Date(), updatedAt: new Date() }
      try { doc.ibRequestId = await submit(doc, cfg, eu) } catch (e) {
        await w.credit(req.webChatId, price)
        const msg = e.response?.data?.description || e.message
        log(`[NumberRequest] Infobip refused ${country} for ${req.webChatId}: ${msg} — refunded $${price}`)
        return res.status(424).json({ error: 'request_failed', message: `Infobip could not take a ${cfg.name} order right now. You were refunded $${price.toFixed(2)}.` })
      }
      await col.insertOne(doc)
      notifyAdmin(`🌐 CloudIVR number request${dryRun() ? ' (DRY RUN)' : ''}: ${cfg.name} for ${req.webChatId} (${req.webUser.email}) — paid $${price}, Infobip request ${doc.ibRequestId}`)
      res.status(202).json({ request: pub(doc), balance: await w.balance(req.webChatId) })
    }))
    r.get('/numbers/requests', h(async (req, res) => res.json({ requests: (await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(20).toArray()).map(pub) })))
  }

  async function refund(r, why) {
    const u = await col.updateOne({ _id: r._id, status: { $nin: ['active', 'refunded', 'activating'] } }, { $set: { status: 'refunded', note: why, updatedAt: new Date() } })
    if (u.modifiedCount !== 1) return
    await w.credit(r.chatId, r.price)
    await notify?.push(r.chatId, `Your ${r.countryName} number request was declined by the carrier (${why}). We refunded $${r.price.toFixed(2)} to your wallet.`, null, { kind: 'billing' }).catch(() => {})
    log(`[NumberRequest] ${r._id} refunded $${r.price}: ${why}`)
  }

  // A newly owned Infobip number in that country that nobody holds yet.
  async function assignedNumber(r) {
    if (dryRun()) return `+${r.country === 'AU' ? '61' : '99'}${String(Date.now()).slice(-9)}`
    const held = new Set()
    for (const d of await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers.phoneNumber': 1 } }).toArray()) for (const n of d.val?.numbers || []) held.add(n.phoneNumber)
    const list = (await ib().http().get('/numbers/1/numbers', { params: { limit: 1000 } })).data?.numbers || []
    const n = list.find(x => x.country === r.country && !held.has(`+${String(x.number).replace(/^\+/, '')}`))
    if (!n) return null
    await ib().http().post(`/numbers/2/numbers/${n.numberKey}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: ib().configId() } })
    if ((n.capabilities || []).includes('SMS')) await ib().routeSms(n.numberKey)
    return { phone: `+${String(n.number).replace(/^\+/, '')}`, key: n.numberKey, caps: n.capabilities || [] }
  }

  async function activate(r) {
    // Claim it first so overlapping ticks / pods never activate the same request twice.
    const claimed = await col.findOneAndUpdate({ _id: r._id, status: { $in: ['submitted', 'in_review', 'approved'] } }, { $set: { status: 'activating', updatedAt: new Date() } })
    if (!(claimed?.value ?? claimed)) return
    const release = () => col.updateOne({ _id: r._id, status: 'activating' }, { $set: { status: 'approved', updatedAt: new Date() } })
    const a = await assignedNumber(r).catch(e => { log(`[NumberRequest] ${r._id} number lookup failed: ${e.message}`); return null })
    if (!a) { await release(); return log(`[NumberRequest] ${r._id} approved but no new ${r.country} number found yet`) }
    const phone = typeof a === 'string' ? a : a.phone
    const caps = typeof a === 'string' ? ['VOICE'] : a.caps
    const acc = await accounts.findOne({ _id: r.chatId })
    const out = await numbersApi.purchase({ chatId: r.chatId, email: acc?.email || r.email, phone, planKey: r.plan, country: r.country, type: 'local', areaCode: null, autoRenew: r.autoRenew,
      hit: { capabilities: { voice: true, sms: caps.includes('SMS'), mms: caps.includes('MMS'), fax: false }, surcharge: 0, cost: null },
      prepaid: { amount: r.price }, presetOrder: { id: typeof a === 'string' ? `dryrun-${r._id}` : `ib:${a.key}`, _provider: 'infobip' } })
    if (out.status >= 300) { await release(); return log(`[NumberRequest] ${r._id} activation failed: ${out.body?.message}`) }
    await col.updateOne({ _id: r._id }, { $set: { status: 'active', phoneNumber: phone, updatedAt: new Date() } })
    await notify?.push(r.chatId, `Your ${r.countryName} number ${phone} is ready. Set up how it answers in My numbers.`, null, { kind: 'billing' }).catch(() => {})
    log(`[NumberRequest] ${r._id} → ${phone} active for ${r.chatId}`)
  }

  async function tick() {
    for (const r of await col.find({ status: { $in: ['submitted', 'in_review', 'approved'] } }).limit(50).toArray()) {
      try {
        if (dryRun()) { if (Date.now() - r.createdAt > 60000) await activate(r); continue }
        const d = (await ib().http().get(`/resources/1/requests/${r.ibRequestId}`)).data || {}
        const st = String(d.status || '')
        if (NO.test(st)) await refund(r, String(d.note || st).slice(0, 160).toLowerCase())
        else if (OK.test(st)) { await col.updateOne({ _id: r._id }, { $set: { status: 'approved', ibStatus: st, updatedAt: new Date() } }); await activate(r) }
        else if (st && st !== r.ibStatus) await col.updateOne({ _id: r._id }, { $set: { status: 'in_review', ibStatus: st, updatedAt: new Date() } })
      } catch (e) { log(`[NumberRequest] ${r._id} check failed: ${e.response?.data?.description || e.message}`) }
    }
  }

  return { routes, tick }
}

module.exports = { createNumberRequests }
