#!/usr/bin/env node
// iter223: hand order (pos wins over last-used), 30-day usage counts, last caller ID per VoIP number. Local Mongo, no network.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const cid = require('../cloudivr-web/caller-ids')
const sw = require('../scam-watch')
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + JSON.stringify(d)}`) }
const BIZ = 'T223_biz', OWN = '+18336112230'
const N = ['+14155552301', '+14155552302', '+14155552303']
const wait = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  sw.setNotifier(() => {})
  const routes = {}
  const router = { get: (p, f) => (routes['GET ' + p] = f), post: (p, f) => (routes['POST ' + p] = f), put: (p, f) => (routes['PUT ' + p] = f), delete() {} }
  cid.routes(router, { db, h: f => f, numbersApi: { findMine: async () => null } })
  const call = async (key, body = {}, query = {}) => { const out = { status: 200 }; const r = { status(s) { out.status = s; return this }, json(b) { out.body = b; return this } }; await routes[key]({ webChatId: BIZ, body, query, params: {} }, r); return out }
  const cleanup = async () => {
    await db.collection('phoneNumbersOf').deleteMany({ _id: BIZ }); await db.collection('webCallerIds').deleteMany({ _id: { $in: N } })
    await db.collection('callerIdUses').deleteMany({ chatId: BIZ }); await db.collection('callerIdLast').deleteMany({ chatId: BIZ })
  }
  try {
    await cleanup()
    await db.collection('phoneNumbersOf').insertOne({ _id: BIZ, val: { numbers: [{ phoneNumber: OWN, plan: 'business', status: 'active' }] } })
    for (const n of N) { await cid.attest(BIZ, n); await wait(20) }
    cid.logUse(BIZ, N[0], 'ivr', '+1'); cid.logUse(BIZ, N[0], 'ivr', '+1'); await wait(200)
    let p = await cid.presets(BIZ); ok('last used first before hand order', p[0].number === N[0], p)
    const o = await call('PUT /caller-ids/order', { numbers: [N[2], N[1], N[0]] }); ok('order saved', o.status === 200 && o.body.items[0].number === N[2], o.body)
    cid.logUse(BIZ, N[0], 'ivr', '+1'); await wait(200)
    p = await cid.presets(BIZ); ok('hand order wins over last use', p.map(x => x.number).join() === [N[2], N[1], N[0]].join(), p)
    const bad = await call('PUT /caller-ids/order', { numbers: ['+19999999999'] }); ok('order rejects foreign number', bad.status === 400, bad.body)
    const g = await call('GET /caller-ids'); const row = g.body.items.find(i => i.number === N[0])
    ok('usage: 3 calls in 30 days + lastUsedAt', row?.uses30 === 3 && !!row?.lastUsedAt, row)
    ok('manager list follows hand order', g.body.items[0].number === N[2], g.body.items.map(i => i.number))
    await db.collection('callerIdUses').insertOne({ chatId: BIZ, showAs: N[1], via: 'ivr', at: new Date(Date.now() - 40 * 86400000) })
    ok('old uses excluded from 30 days', ((await cid.usage30(BIZ))[N[1]] || 0) === 0)
    await cid.resolve(BIZ, N[1], OWN); await wait(150)
    ok('resolve remembers last per VoIP number', (await cid.lastFor(BIZ, OWN)) === N[1])
    const pr = await call('GET /caller-ids/presets', {}, { from: OWN }); ok('presets?from returns last', pr.body.last === N[1], pr.body)
    await cid.resolve(BIZ, '', OWN); await wait(150)
    ok('own number clears last', (await cid.lastFor(BIZ, OWN)) === null)
    cid.rememberLast(BIZ, OWN, N[2]); await wait(150)
    await db.collection('webCallerIds').deleteOne({ _id: N[2] })
    ok('removed caller ID is not offered as last', (await cid.lastFor(BIZ, OWN)) === null)
  } catch (e) { ok('exception', false, e.stack) }
  await cleanup(); await mc.close()
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1)
})()
