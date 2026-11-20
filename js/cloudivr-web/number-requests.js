'use strict'
// "On request" countries: customer pays now, we order a number from MultiTEL (local, else national/mobile),
// retrying every tick; full refund if none can be supplied within 3 days. Older Infobip requests are moved here too.
const crypto = require('crypto')
const ibc = require('../infobip/countries')
const mtc = require('../multitel/countries')
const { endUser } = require('./legal-profile')

const GIVE_UP_MS = 3 * 86400000
const TYPES = ['local', 'national', 'mobile']
const round2 = (n) => Math.round(n * 100) / 100

function createNumberRequests({ db, h, phoneConfig, numbersApi, walletOps, notify, notifyAdmin = () => {}, log = console.log, dryRun = () => false }) {
  const col = db.collection('numberRequests')
  const accounts = db.collection('webAccounts')
  const w = walletOps(db)
  const mt = () => require('../multitel')
  const pub = (r) => ({ id: r._id, country: r.country, countryName: r.countryName, plan: r.plan, price: r.price, status: r.status, phoneNumber: r.phoneNumber || null, note: r.note || null, createdAt: r.createdAt, updatedAt: r.updatedAt })
  const typesOf = (cc) => TYPES.filter(t => mtc.offer(cc, t))

  function routes(r) {
    r.post('/numbers/request', h(async (req, res) => {
      const country = String(req.body?.country || '').toUpperCase()
      const cfg = ibc.requestOf(country)
      const planKey = String(req.body?.plan || '')
      const plan = phoneConfig.plans[planKey]
      if (!cfg || !mt().selling()) return res.status(400).json({ error: 'invalid_country', message: 'Pick a country from the list.' })
      if (!plan || !phoneConfig.isPlanAvailable(planKey)) return res.status(400).json({ error: 'invalid_plan', message: 'That plan is not available.' })
      const price = round2(plan.price + phoneConfig.planAddon(planKey, country, 'local', require('../number-addons').get(country, 'local')))
      if (!(await w.debit(req.webChatId, price))) return res.status(402).json({ error: 'insufficient_balance', message: `This number costs $${price.toFixed(2)}. Your wallet has $${(await w.balance(req.webChatId)).toFixed(2)}.`, cost: price })
      const doc = { _id: `nr_${crypto.randomUUID().slice(0, 12)}`, chatId: req.webChatId, email: req.webUser.email, country, countryName: cfg.name, plan: planKey, price, autoRenew: req.body?.autoRenew !== false, status: 'submitted', provider: 'multitel', endUser: endUser(req.webUser), createdAt: new Date(), updatedAt: new Date() }
      await col.insertOne(doc)
      notifyAdmin(`🌐 CloudIVR number request${dryRun() ? ' (DRY RUN)' : ''}: ${cfg.name} for ${req.webChatId} (${req.webUser.email}) — paid $${price}, ordering from MultiTEL`)
      res.status(202).json({ request: pub(doc), balance: await w.balance(req.webChatId) })
      fulfil(doc).catch(e => log(`[NumberRequest] ${doc._id} first try: ${e.message}`))
    }))
    r.get('/numbers/requests', h(async (req, res) => res.json({ requests: (await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(20).toArray()).map(pub) })))
  }

  async function refund(r, why) {
    const u = await col.updateOne({ _id: r._id, status: { $nin: ['active', 'refunded', 'needs_attention'] } }, { $set: { status: 'refunded', note: why, updatedAt: new Date() } })
    if (u.modifiedCount !== 1) return
    await w.credit(r.chatId, r.price)
    await notify?.push(r.chatId, `We couldn't get a ${r.countryName} number from the carrier (${why}). We refunded $${r.price.toFixed(2)} to your wallet.`, null, { kind: 'billing' }).catch(() => {})
    notifyAdmin(`↩️ CloudIVR number request ${r._id} (${r.countryName}, ${r.email}) refunded $${r.price}: ${why}`)
    log(`[NumberRequest] ${r._id} refunded $${r.price}: ${why}`)
  }

  // Buys the first number MultiTEL can supply in that country: { order, hit, type } or null.
  async function buyFromMultitel(cc) {
    for (const type of typesOf(cc)) {
      if (dryRun()) return { order: { id: `dryrun-${crypto.randomUUID().slice(0, 8)}`, _provider: 'multitel' }, hit: { phone_number: `+99${String(Date.now()).slice(-9)}`, _capabilities: { voice: true } }, type }
      for (const hit of await mt().searchNumbers(cc, type, null, 3)) {
        const order = await mt().buyNumber(hit.phone_number)
        if (order) return { order, hit, type }
        if (mt().wasNoFunds(hit.phone_number)) throw new Error('MultiTEL balance too low')
      }
    }
    return null
  }

  async function fulfil(r) {
    // Claim it first so overlapping ticks / pods never buy for the same request twice.
    const claimed = await col.findOneAndUpdate({ _id: r._id, status: { $in: ['submitted', 'in_review', 'approved'] } }, { $set: { status: 'activating', provider: 'multitel', updatedAt: new Date() } })
    if (!(claimed?.value ?? claimed)) return
    const release = (note) => col.updateOne({ _id: r._id, status: 'activating' }, { $set: { status: 'submitted', note, updatedAt: new Date() }, $inc: { tries: 1 } })
    if (!typesOf(r.country).length) { await release(null); return refund(r, 'no numbers available in this country') }
    let got
    try { got = await buyFromMultitel(r.country) } catch (e) {
      await release(null)
      if (/balance/i.test(e.message) && !r.fundsAlerted) { await col.updateOne({ _id: r._id }, { $set: { fundsAlerted: true } }); notifyAdmin(`⚠️ MultiTEL balance too low to fill ${r.countryName} number request ${r._id} (${r.email}). Top up MultiTEL — it retries every 10 min.`) }
      return log(`[NumberRequest] ${r._id} MultiTEL: ${e.message}`)
    }
    if (!got) {
      await release(null)
      if (Date.now() - new Date(r.createdAt) > GIVE_UP_MS) return refund(r, 'none available for 3 days')
      return log(`[NumberRequest] ${r._id} no ${r.country} number at MultiTEL yet`)
    }
    const { order, hit, type } = got
    const phone = order._retriedNumber || hit.phone_number
    const caps = hit._capabilities || { voice: true }
    const acc = await accounts.findOne({ _id: r.chatId })
    const out = await numbersApi.purchase({ chatId: r.chatId, email: acc?.email || r.email, phone, planKey: r.plan, country: r.country, type, areaCode: null, autoRenew: r.autoRenew,
      hit: { provider: 'multitel', capabilities: { voice: true, sms: !!caps.sms, mms: false, fax: false }, surcharge: require('../number-addons').get(r.country, type), cost: null },
      prepaid: { amount: r.price }, presetOrder: order })
    if (out.status >= 300) {
      // The number is bought at MultiTEL but not attached: a person must finish it (a retry would buy a second one).
      await col.updateOne({ _id: r._id }, { $set: { status: 'needs_attention', phoneNumber: phone, note: out.body?.message || 'activation failed', updatedAt: new Date() } })
      notifyAdmin(`🚨 CloudIVR number request ${r._id}: bought ${phone} at MultiTEL but activation failed (${out.body?.message}). Customer ${r.email} paid $${r.price} — attach or refund manually.`)
      return log(`[NumberRequest] ${r._id} activation failed: ${out.body?.message}`)
    }
    await col.updateOne({ _id: r._id }, { $set: { status: 'active', phoneNumber: phone, updatedAt: new Date() } })
    await notify?.push(r.chatId, `Your ${r.countryName} number ${phone} is ready. Set up how it answers in My numbers.`, null, { kind: 'billing' }).catch(() => {})
    notifyAdmin(`✅ CloudIVR number request ${r._id}: ${phone} (${r.countryName}) active for ${r.email}`)
    log(`[NumberRequest] ${r._id} → ${phone} active for ${r.chatId}`)
  }

  async function tick() {
    for (const r of await col.find({ status: { $in: ['submitted', 'in_review', 'approved'] } }).limit(50).toArray()) {
      try { await fulfil(r) } catch (e) { log(`[NumberRequest] ${r._id} check failed: ${e.message}`) }
    }
  }

  return { routes, tick, fulfil }
}

module.exports = { createNumberRequests }
