// Mollie in-app checkout (Checkout Sessions) with Mollie stubbed: session start, webhook credits via metadata.ref once,
// status poll finds the payment from a completed session, failed session start offers the hosted fallback. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.MOLLIE_API_KEY = 'test_stubbed'
const Module = require('module'), realAxios = require('axios')
const calls = [], pay = {}
let failSession = false
const fake = async (o) => {
  calls.push(o)
  if (o.method === 'get' && o.url.includes('/methods')) return { data: { _embedded: { methods: [{ id: 'creditcard', description: 'Card' }] } } }
  if (o.method === 'post' && o.url.endsWith('/sessions')) { if (failSession) { const e = new Error('x'); e.response = { data: { detail: "The redirect URL doesn't match your profile URL" } }; throw e } return { data: { id: 'sess_1', status: 'open', clientAccessToken: 'tok_abc' } } }
  if (o.method === 'get' && o.url.includes('/sessions/')) return { data: { id: 'sess_2', status: 'completed' } }
  if (o.method === 'get' && o.url.includes('/payments?limit')) return { data: { _embedded: { payments: Object.values(pay) } } }
  if (o.method === 'get' && o.url.includes('/payments/')) return { data: pay[o.url.split('/payments/')[1]] }
  throw new Error(`unexpected ${o.method} ${o.url}`)
}
fake.get = async (url) => (url.includes('frankfurter') ? { data: { rates: { EUR: 0.9 } } } : realAxios.get(url))
const load = Module._load; Module._load = function (req, ...a) { return req === 'axios' ? fake : load.call(this, req, ...a) }
const express = require('express'), { MongoClient } = require('mongodb'), { createMollie } = require('../cloudivr-web/mollie')
Module._load = load
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), CHAT = 'web-qa-mollie-sess'
  const alerts = []
  const mol = createMollie(db, { log: () => {}, notifyAdmin: (t) => alerts.push(t), push: async () => {} })
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: true }))
  const h = (fn) => (req, res) => fn(req, res).catch(e => res.status(500).json({ error: e.message }))
  mol.publicRoutes(app, { h }); app.use((req, _r, next) => { req.webChatId = CHAT; next() }); mol.routes(app, { h })
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`, O = 'https://app.example.org'
  const ax = (m, p, d) => realAxios({ method: m, url: base + p, data: d, headers: { Origin: O }, validateStatus: () => true })
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: CHAT }); return (w?.usdIn || 0) - (w?.usdOut || 0) }
  const clean = async () => { await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('webDeposits').deleteMany({ chatId: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT }) }
  await clean()
  try {
    let r = await ax('post', '/wallet/mollie/session', { amountUsd: 20, currency: 'USD', returnUrl: `${O}/cloudivr/app/wallet` })
    const sent = calls.find(c => c.url.endsWith('/sessions'))
    ok('session started, client token returned', r.status === 201 && r.data.clientAccessToken === 'tok_abc' && r.data.ref)
    ok('session has one digital line equal to amount', sent.data.lines.length === 1 && sent.data.lines[0].totalAmount.value === '20.00' && sent.data.amount.value === '20.00')
    ok('webhook + ref in metadata', sent.data.payment.webhookUrl.endsWith('/cloudivr-web/mollie/webhook') && sent.data.metadata.ref === r.data.ref && sent.data.redirectUrl.includes(`mollie=${r.data.ref}`))
    const ref = r.data.ref
    pay.tr_9 = { id: 'tr_9', status: 'paid', method: 'creditcard', amount: { currency: 'USD', value: '20.00' }, metadata: { ref } }
    await ax('post', '/mollie/webhook', { id: 'tr_9' })
    ok('webhook credits via metadata.ref', await bal() === 20)
    await ax('post', '/mollie/webhook', { id: 'tr_9' })
    r = await ax('get', `/wallet/mollie/${ref}`)
    ok('credited once, status paid', await bal() === 20 && r.data.status === 'paid')
    // poll path: completed session, no webhook yet
    r = await ax('post', '/wallet/mollie/session', { amountUsd: 15, currency: 'USD', returnUrl: `${O}/cloudivr/app/wallet` })
    const ref2 = r.data.ref
    await db.collection('webDeposits').updateOne({ ref: ref2 }, { $set: { mollieSessionId: 'sess_2' } })
    pay.tr_10 = { id: 'tr_10', status: 'paid', method: 'applepay', amount: { currency: 'USD', value: '15.00' }, metadata: { ref: ref2 } }
    r = await ax('get', `/wallet/mollie/${ref2}`)
    ok('status poll finds payment of completed session', r.data.status === 'paid' && await bal() === 35)
    failSession = true
    r = await ax('post', '/wallet/mollie/session', { amountUsd: 10, currency: 'USD', returnUrl: `${O}/cloudivr/app/wallet` })
    ok('domain not approved → 424 with fallback + admin told', r.status === 424 && r.data.fallback === true && alerts.some(a => a.includes('Website profiles')))
    r = await ax('post', '/wallet/mollie/session', { amountUsd: 10, currency: 'USD', returnUrl: 'https://evil.example/x' })
    ok('foreign return URL refused', r.status === 400)
  } finally {
    await clean(); srv.close(); await cl.close()
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
  }
})()
