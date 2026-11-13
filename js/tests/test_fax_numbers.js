// Fax-only numbers (Telnyx fax account) with the Telnyx API stubbed: fax-only search, wallet buy on the Fax Application,
// refund on failed order, fax-only send eligibility, no voice switch, renewal / past-due / release, lookup key. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.TELNYX_FAX_API_KEY = 'KEY_fax_stub'
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
process.env.SKIP_WEBHOOK_SYNC = 'true'
const Module = require('module')
const calls = []
let failOrder = false
const fake = async (o) => {
  calls.push(o)
  if (o.url.includes('/available_phone_numbers')) return { data: { data: [
    { phone_number: '+12125550101', features: [{ name: 'voice' }, { name: 'fax' }], region_information: [{ region_name: 'NY' }] },
    { phone_number: '+12125550102', features: [{ name: 'voice' }, { name: 'sms' }] },
    { phone_number: '+12125550103', features: [{ name: 'fax' }] },
  ] } }
  if (o.url.includes('/number_orders')) { if (failOrder) { const e = new Error('order failed'); e.response = { status: 422, data: {} }; throw e } return { data: { data: { id: 'ord_1' } } } }
  if (o.method === 'get' && o.url.includes('/phone_numbers')) return { data: { data: [{ id: 'pn_1' }] } }
  if (o.method === 'delete') return { data: {} }
  if (o.url.includes('/number_lookup/')) return { data: { data: { valid_number: true, carrier: { type: 'mobile', name: 'T-Mobile' } } } }
  throw new Error(`unexpected ${o.method} ${o.url}`)
}
const realAxios = require('axios')
for (const m of ['get', 'delete']) fake[m] = (url, o = {}) => fake({ ...o, method: m, url })
for (const m of ['post', 'patch']) fake[m] = (url, data, o = {}) => fake({ ...o, method: m, url, data })
fake.create = realAxios.create
const load = Module._load; Module._load = function (req, ...a) { return req === 'axios' ? fake : load.call(this, req, ...a) }
const { MongoClient } = require('mongodb')
const acct = require('../telnyx-fax-account')
const fax = require('../fax-service')
const { create } = require('../fax-numbers')
Module._load = load
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), CHAT = 'web-qa-faxnum-1'
  const brandKey = `${String(process.env.CHAT_BOT_BRAND || 'Nomadly').trim() || 'Nomadly'} Fax|fax-account`
  const clean = async () => { await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('faxNumbers').deleteMany({ chatId: CHAT }); await db.collection('faxNumberSearch').deleteOne({ _id: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT }) }
  await clean()
  const saved = await db.collection('faxConfig').findOne({ _id: brandKey })
  await db.collection('faxConfig').updateOne({ _id: brandKey }, { $set: { appId: 'faxapp_1' } }, { upsert: true })
  fax.init({ db, log: () => {} })
  const alerts = [], pushes = []
  const F = create(db, { log: () => {}, notifyAdmin: (t) => alerts.push(t), push: async (id, t) => pushes.push(t) })
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: CHAT }); return (w?.usdIn || 0) - (w?.usdOut || 0) }
  try {
    const s = await F.search(CHAT, 'US', '212')
    ok('search shows fax-capable numbers only', s.numbers.length === 2 && s.numbers.every(n => n.capabilities.fax && !n.capabilities.voice && !n.capabilities.sms), JSON.stringify(s.numbers.map(n => n.phoneNumber)))
    ok('search uses the fax account key', calls[0].headers.Authorization === 'Bearer KEY_fax_stub')
    let e = await F.search(CHAT, 'GB').catch(x => x)
    ok('non USA/Canada refused', e.code === 'invalid_country')
    e = await F.buy(CHAT, { phoneNumber: '+12125550101' }).catch(x => x)
    ok('empty wallet → insufficient_balance', e.code === 'insufficient_balance' && e.status === 402)
    await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: 40, usdOut: 0 } }, { upsert: true })
    failOrder = true
    e = await F.buy(CHAT, { phoneNumber: '+12125550101' }).catch(x => x)
    ok('failed order refunds', e.code === 'purchase_failed' && await bal() === 40)
    failOrder = false
    const r = await F.buy(CHAT, { phoneNumber: '+12125550101' })
    const order = calls.filter(c => c.url.includes('/number_orders')).pop()
    ok('bought on the Fax Application (fax-only)', r.number.faxOnly && order.data.connection_id === 'faxapp_1' && !order.data.messaging_profile_id)
    ok('wallet debited $15', await bal() === 25 && r.balance === 25)
    ok('admin alerted', alerts.some(a => a.includes('+12125550101')))
    const doc = await db.collection('faxNumbers').findOne({ _id: '+12125550101' })
    ok('fax-only number can fax', fax.eligible(doc) && fax.lineOn(doc))
    const own = await fax.findMine(CHAT, '+12125550101')
    ok('fax service finds the number', own?.faxOnly === true)
    e = await fax.setLine({ chatId: CHAT, num: doc, enabled: false }).catch(x => x)
    ok('cannot be switched to voice', e.code === 'fax_only')
    e = await F.search(CHAT, 'US', '212')
    ok('bought number hidden from search', !e.numbers.some(n => n.phoneNumber === '+12125550101'))
    // renewal
    await db.collection('faxNumbers').updateOne({ _id: '+12125550101' }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
    await F.renewDue()
    let d2 = await db.collection('faxNumbers').findOne({ _id: '+12125550101' })
    ok('renews from wallet', d2.status === 'active' && new Date(d2.expiresAt) > new Date() && await bal() === 10)
    await db.collection('faxNumbers').updateOne({ _id: '+12125550101' }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
    await F.renewDue()
    d2 = await db.collection('faxNumbers').findOne({ _id: '+12125550101' })
    ok('short wallet → past due, paused', d2.status === 'past_due' && !fax.eligible(d2) && pushes.some(p => p.includes('could not renew')))
    await F.renewDue(new Date(Date.now() + 4 * 86400000))
    d2 = await db.collection('faxNumbers').findOne({ _id: '+12125550101' })
    ok('released after 3 days unpaid', d2.status === 'released' && calls.some(c => c.method === 'delete'))
    const lk = await acct.lookup('+14155550100')
    ok('number lookup on fax account', lk.type === 'mobile' && calls.pop().headers.Authorization === 'Bearer KEY_fax_stub')
  } finally {
    await clean()
    if (saved) await db.collection('faxConfig').replaceOne({ _id: brandKey }, saved); else await db.collection('faxConfig').deleteOne({ _id: brandKey })
    await cl.close()
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  }
})()
