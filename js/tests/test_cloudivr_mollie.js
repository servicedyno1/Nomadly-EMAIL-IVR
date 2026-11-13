// Mollie top-ups for CloudIVR web with Mollie's API stubbed: options per currency, hosted checkout,
// webhook credits the USD amount exactly once, mismatch / canceled never credit. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.MOLLIE_API_KEY = 'test_stubbed'
const Module = require('module'), realAxios = require('axios')
const calls = [], pay = {}
const fake = async (o) => {
  calls.push(o)
  if (o.method === 'get' && o.url.includes('/methods')) { const cur = /currency(?:%5D|\])=(\w+)/.exec(o.url)?.[1]; return { data: { _embedded: { methods: cur === 'USD' ? [{ id: 'creditcard', description: 'Card' }, { id: 'paypal', description: 'PayPal' }] : cur === 'EUR' ? [{ id: 'creditcard', description: 'Card' }, { id: 'ideal', description: 'iDEAL' }] : [] } } } }
  if (o.method === 'post' && o.url.endsWith('/payments')) { const p = { id: `tr_${Object.keys(pay).length + 1}x`, status: 'open', amount: o.data.amount, _links: { checkout: { href: 'https://www.mollie.com/checkout/test' } } }; pay[p.id] = p; return { data: p } }
  if (o.method === 'get' && o.url.includes('/payments/')) return { data: pay[o.url.split('/payments/')[1]] }
  throw new Error(`unexpected ${o.method} ${o.url}`)
}
fake.get = async (url) => (url.includes('frankfurter') ? { data: { rates: { EUR: 0.9, GBP: 0.8 } } } : realAxios.get(url))
const load = Module._load; Module._load = function (req, ...a) { return req === 'axios' ? fake : load.call(this, req, ...a) }
const express = require('express'), { MongoClient } = require('mongodb'), { createMollie } = require('../cloudivr-web/mollie')
Module._load = load
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), CHAT = 'web-qa-mollie-1'
  const alerts = [], pushes = []
  const mol = createMollie(db, { log: () => {}, notifyAdmin: (t) => alerts.push(t), push: async (id, t) => pushes.push(t) })
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: true }))
  const h = (fn) => (req, res) => fn(req, res).catch(e => res.status(500).json({ error: e.message }))
  mol.publicRoutes(app, { h }); app.use((req, _r, next) => { req.webChatId = CHAT; next() }); mol.routes(app, { h })
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`
  const ax = (m, p, d, hd) => realAxios({ method: m, url: base + p, data: d, headers: hd, validateStatus: () => true })
  await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('webDeposits').deleteMany({ chatId: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT })
  try {
    let r = await ax('get', '/wallet/mollie/options?amountUsd=20')
    const curs = r.data.currencies?.map(c => c.currency)
    ok('options: only currencies with enabled methods (USD, EUR), test mode', r.data.enabled && r.data.mode === 'test' && curs.join() === 'USD,EUR', JSON.stringify(curs))
    ok('EUR price converted at the day rate ($20 × 0.9 = 18.00)', r.data.currencies.find(c => c.currency === 'EUR').amount === '18.00')
    r = await ax('post', '/wallet/mollie/pay', { amountUsd: 20, currency: 'EUR', method: 'ideal', returnUrl: 'https://app.example.com/app/wallet' }, { Origin: 'https://app.example.com' })
    const create = calls.find(c => c.method === 'post')
    ok('pay → hosted checkout URL, EUR 18.00, idempotency key, webhook + return URLs', r.status === 201 && r.data.checkoutUrl && create.data.amount.value === '18.00' && create.headers['Idempotency-Key'] && /\/cloudivr-web\/mollie\/webhook$/.test(create.data.webhookUrl) && create.data.redirectUrl.includes(`mollie=${r.data.ref}`), JSON.stringify(r.data))
    ok('return URL from another site is refused', (await ax('post', '/wallet/mollie/pay', { amountUsd: 20, currency: 'USD', returnUrl: 'https://evil.example/x' }, { Origin: 'https://app.example.com' })).status === 400)
    ok('method not on for that currency is refused', (await ax('post', '/wallet/mollie/pay', { amountUsd: 20, currency: 'USD', method: 'ideal', returnUrl: 'https://app.example.com/app/wallet' }, { Origin: 'https://app.example.com' })).status === 400)
    const ref = r.data.ref, dep = await db.collection('webDeposits').findOne({ ref }), pid = dep.molliePaymentId
    ok('still open → nothing credited', (await ax('get', `/wallet/mollie/${ref}`)).data.status === 'open' && !(await db.collection('walletOf').findOne({ _id: CHAT })))
    pay[pid].status = 'paid'; pay[pid].method = 'ideal'
    await ax('post', '/mollie/webhook', 'id=' + pid, { 'Content-Type': 'application/x-www-form-urlencoded' })
    await ax('post', '/mollie/webhook', 'id=' + pid, { 'Content-Type': 'application/x-www-form-urlencoded' })
    await ax('get', `/wallet/mollie/${ref}`)
    const w = await db.collection('walletOf').findOne({ _id: CHAT }), tx = await db.collection('transactions').find({ chatId: CHAT, type: 'wallet-topup' }).toArray()
    ok('paid → wallet +$20 exactly once (2 webhooks + status poll)', w?.usdIn === 20 && tx.length === 1 && tx[0].metadata.psp === 'mollie' && tx[0].metadata.ref === ref, `${w?.usdIn} / ${tx.length}`)
    ok('customer + admin told', pushes.some(t => /\$20\.00 was added/.test(t)) && alerts.some(t => /Mollie · TEST/.test(t)))
    // mismatch never credits
    r = await ax('post', '/wallet/mollie/pay', { amountUsd: 30, currency: 'USD', returnUrl: 'https://app.example.com/app/wallet' }, { Origin: 'https://app.example.com' })
    const p2 = (await db.collection('webDeposits').findOne({ ref: r.data.ref })).molliePaymentId
    Object.assign(pay[p2], { status: 'paid', amount: { currency: 'USD', value: '1.00' } })
    await ax('post', '/mollie/webhook', { id: p2 })
    ok('amount mismatch → not credited, admin alerted', (await db.collection('walletOf').findOne({ _id: CHAT })).usdIn === 20 && alerts.some(t => /amount mismatch/.test(t)))
    r = await ax('post', '/wallet/mollie/pay', { amountUsd: 15, currency: 'USD', returnUrl: 'https://app.example.com/app/wallet' }, { Origin: 'https://app.example.com' })
    const p3 = (await db.collection('webDeposits').findOne({ ref: r.data.ref })).molliePaymentId; pay[p3].status = 'canceled'
    ok('canceled → status canceled, nothing credited', (await ax('get', `/wallet/mollie/${r.data.ref}`)).data.status === 'canceled' && (await db.collection('walletOf').findOne({ _id: CHAT })).usdIn === 20)
    ok('forged webhook id is ignored', (await ax('post', '/mollie/webhook', { id: 'tr_unknown' })).status === 200 && (await db.collection('walletOf').findOne({ _id: CHAT })).usdIn === 20)
    delete process.env.MOLLIE_API_KEY
    ok('no key → Mollie hidden', (await ax('get', '/wallet/mollie/options?amountUsd=20')).data.enabled === false)
  } finally {
    await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('webDeposits').deleteMany({ chatId: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT })
    srv.close()
  }
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
