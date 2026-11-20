'use strict'
// CRM calling API: access rules, add-on billing, keys, call start + every step reaching the webhook (stubbed engine).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const http = require('http')
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`✅ ${n}`) } else { fail++; console.log(`❌ ${n} ${x}`) } }

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_crmapi_test`)
  const ids = ['5000000000000999', '5000000000000998']
  const clean = () => Promise.all(['phoneNumbersOf', 'walletOf', 'webPrefs', 'apiAccess'].map(c => db.collection(c).deleteMany({ _id: { $in: ids } })).concat(['apiKeys', 'apiCalls', 'transactions', 'webhookDeliveries'].map(c => db.collection(c).deleteMany({ chatId: { $in: ids } }))))
  await clean()
  const events = require('../cloudivr-web/events')
  events._allowPrivateForTests(true)
  const got = []
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d }); req.on('end', () => { got.push({ sig: req.headers['x-cloudivr-signature'], body: JSON.parse(b) }); res.end('ok') }) }).listen(0)
  const port = srv.address().port
  const R = () => { const routes = {}; const add = (m) => (p, ...fns) => { routes[`${m} ${p}`] = fns }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} } }
  const h = (fn) => fn
  const call = async (r, m, p, { body = {}, chatId, headers = {}, params = {} } = {}) => {
    const fns = r.routes[`${m} ${p}`]; let out = { status: 200, body: null }
    const res = { status(s) { out.status = s; return res }, json(b) { out.body = b; return res } }
    const req = { body, headers, params, webChatId: chatId }
    for (const f of fns) { let nextCalled = false; await f(req, res, () => { nextCalled = true }); if (!nextCalled) break }
    return out
  }
  const chat = '5000000000000999', biz = '5000000000000998'
  await db.collection('phoneNumbersOf').insertMany([
    { _id: chat, val: { numbers: [{ phoneNumber: '+14155550100', status: 'active', plan: 'enterprise', provider: 'retell' }] } },
    { _id: biz, val: { numbers: [{ phoneNumber: '+14155550200', status: 'active', plan: 'business', provider: 'retell' }] } },
  ])
  await db.collection('walletOf').insertMany([{ _id: chat, usdIn: 50, usdOut: 0 }, { _id: biz, usdIn: 120, usdOut: 0 }])
  const started = []
  const voiceService = { getIvrCallRate: () => 0.15, initiateOutboundIvrCall: async (p) => { started.push(p); return { callControlId: 'cc1' } } }
  const numbersApi = { findMine: async (id, p) => ((await db.collection('phoneNumbersOf').findOne({ _id: String(id) }))?.val?.numbers || []).find(n => n.phoneNumber === p) || null }
  const ev = R(); events.routes(ev, { db, h })
  const api = require('../cloudivr-web/crm-api')
  api.init({ db, voiceService, numbersApi, notify: { push: async () => {} }, log: () => {} })
  const pub = R(), set = R(); api.publicRoutes(pub, { h }); api.routes(set, { h })

  let r = await call(set, 'GET', '/api-access', { chatId: chat })
  ok('Enterprise: API included', r.body.access.on && r.body.access.via === 'enterprise')
  r = await call(set, 'GET', '/api-access', { chatId: biz })
  ok('Business: off, can buy for $99', !r.body.access.on && r.body.access.canBuy && r.body.access.price === 99)
  r = await call(set, 'POST', '/api-keys', { chatId: biz })
  ok('Business without add-on cannot make keys', r.status === 403)
  r = await call(set, 'POST', '/api-access/addon', { chatId: biz })
  const w = await db.collection('walletOf').findOne({ _id: biz })
  const tx = await db.collection('transactions').findOne({ chatId: biz, type: 'api-access' })
  ok('Business add-on: $99 charged with a ledger record, access on', r.body.access.on && r.body.access.via === 'addon' && w.usdOut === 99 && tx?.amount === 99)
  await db.collection('apiAccess').updateOne({ _id: biz }, { $set: { until: new Date(Date.now() - 1000) } })
  await api.tick()
  ok('renewal with $21 left → lapses (no overdraft)', (await db.collection('apiAccess').findOne({ _id: biz })).autoRenew === false && (await db.collection('walletOf').findOne({ _id: biz })).usdOut === 99)

  r = await call(set, 'POST', '/api-keys', { chatId: chat, body: { name: 'HubSpot' } })
  const key = r.body.key
  ok('key made once, stored hashed', /^civr_live_/.test(key) && !(await db.collection('apiKeys').findOne({ hash: key })))
  r = await call(pub, 'POST', '/v1/calls', { headers: { authorization: 'Bearer civr_live_wrong' }, body: {} })
  ok('wrong key → 401', r.status === 401)
  const auth = { authorization: `Bearer ${key}` }
  r = await call(pub, 'POST', '/v1/calls', { headers: auth, body: { to: '+14155550123', connectTo: '+18005550100' } })
  ok('no from and no default → 400 invalid_from', r.status === 400 && r.body.error === 'invalid_from')
  await call(set, 'PUT', '/api-access/defaults', { chatId: chat, body: { from: '+14155550100', connectTo: '+18005550100', machine: 'hangup' } })
  await call(ev, 'PUT', '/webhooks', { chatId: chat, body: { enabled: true, url: `https://127.0.0.1:${port}/hook`, events: ['call.ended'] } }).catch(() => {})
  await db.collection('webPrefs').updateOne({ _id: chat }, { $set: { 'webhook.url': `http://127.0.0.1:${port}/hook`, 'webhook.enabled': true } })
  r = await call(pub, 'POST', '/v1/calls', { headers: auth, body: { to: '+14155550123', connectTo: '+18005550100', metadata: { leadId: 'L-1' } } })
  const p = started[0]
  ok('call started: 201, connect on answer, default from, voicemail hang-up', r.status === 201 && p.connectOnAnswer === true && p.machinePolicy === 'hangup' && p.callerId === '+14155550100' && p.ivrNumber === '+18005550100' && p.api.id === r.body.id, JSON.stringify(r.body))
  r = await call(pub, 'POST', '/v1/calls', { headers: auth, body: { to: '+14155550124', connectTo: '+18005550100', machine: 'connect' } })
  ok('machine: connect per request', started[1]?.machinePolicy === 'connect')
  await require('../ai-agent').store.init?.(db)
  const id = started[0].api.id
  for (const [s, d] of [['ringing'], ['answered', { answeredBy: 'human' }], ['connected'], ['completed', { outcome: 'connected', duration: 64, connectedDuration: 60 }]]) await api.onEvent({ id }, s, d)
  await new Promise(r => setTimeout(r, 800))
  const types = got.map(g => g.body.type)
  ok('webhook got ringing → answered → connected → completed (even with only call.ended ticked)', ['api_call.ringing', 'api_call.answered', 'api_call.connected', 'api_call.completed'].every(t => types.includes(t)), JSON.stringify(types))
  const last = got.find(g => g.body.type === 'api_call.completed')
  const hook = (await db.collection('webPrefs').findOne({ _id: chat })).webhook
  ok('completed carries outcome, durations, metadata; signed', last?.body.data.outcome === 'connected' && last.body.data.connectedDuration === 60 && last.body.data.metadata?.leadId === 'L-1' && last.sig === events.sign(hook.secret, JSON.stringify(last.body)))
  r = await call(pub, 'GET', '/v1/calls/:id', { headers: auth, params: { id } })
  ok('GET /v1/calls/:id → completed', r.body.status === 'completed' && r.body.duration === 64)
  srv.close(); await clean(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
