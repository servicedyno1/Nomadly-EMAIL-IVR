#!/usr/bin/env node
// iter217: unit checks for js/cloudivr-web/caller-ids.js attest / setDefault / defaultFor / logUse against local Mongo (no network).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const cid = require('../cloudivr-web/caller-ids')
const sw = require('../scam-watch')
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + JSON.stringify(d)}`) }
const BIZ = 'T217_biz', PRO = 'T217_pro', STA = 'T217_starter', OTHER = 'T217_biz2', NONE = 'T217_none'
const N1 = '+14155550917', N2 = '+14155550918', OWN = '+18336110999'
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const alerts = []; sw.setNotifier(t => alerts.push(t))
  cid.routes({ get() {}, post() {}, put() {}, delete() {} }, { db, h: f => f, numbersApi: { findMine: async () => null } })
  const P = db.collection('phoneNumbersOf')
  const mk = (id, plan) => P.replaceOne({ _id: id }, { _id: id, val: { numbers: [{ phoneNumber: OWN.replace('999', id.length + '0' + plan.length), plan, status: 'active', provider: 'telnyx' }] } }, { upsert: true })
  const ids = [BIZ, PRO, STA, OTHER, NONE]
  const cleanup = async () => {
    await P.deleteMany({ _id: { $in: ids } })
    await db.collection('webCallerIds').deleteMany({ _id: { $in: [N1, N2] } })
    await db.collection('callerIdDefaults').deleteMany({ chatId: { $in: ids } })
    await db.collection('callerIdUses').deleteMany({ chatId: { $in: ids } })
  }
  try {
    await cleanup()
    await mk(BIZ, 'business'); await mk(PRO, 'pro'); await mk(STA, 'starter'); await mk(OTHER, 'business')
    let r
    for (const e of ['911', '112', '999', '+911']) { r = await cid.attest(BIZ, e); ok(`emergency ${e}`, r.error === 'emergency_number', r) }
    r = await cid.attest(BIZ, '12'); ok('invalid format', r.error === 'invalid_number', r)
    r = await cid.attest(BIZ, 'abc'); ok('invalid letters', !r.ok && r.error === 'invalid_number', r)
    r = await cid.attest(PRO, N1); ok('pro refused plan_required', r.error === 'plan_required' && r.status === 403, r)
    r = await cid.attest(STA, N1); ok('starter refused plan_required', r.error === 'plan_required', r)
    r = await cid.attest(NONE, N1); ok('no numbers refused', r.error === 'plan_required', r)
    await P.updateOne({ _id: OTHER }, { $set: { 'val.numbers.0.status': 'suspended' } })
    r = await cid.attest(OTHER, N2); ok('business but not active refused', r.error === 'plan_required', r)
    await P.updateOne({ _id: OTHER }, { $set: { 'val.numbers.0.status': 'active' } })
    const before = alerts.length
    r = await cid.attest(BIZ, N1, { who: 'qa@x', channel: 'bot' }); ok('business attest ok', r.ok && r.number === N1, r)
    const doc = await db.collection('webCallerIds').findOne({ _id: N1 })
    ok('stored verified/attested', doc?.status === 'verified' && doc?.method === 'attested' && doc?.chatId === BIZ && doc?.channel === 'bot', doc)
    ok('admin alert fired', alerts.length === before + 1 && alerts.at(-1).includes(N1), alerts.at(-1))
    r = await cid.attest(BIZ, '4155550917'); ok('10-digit re-attest same user idempotent', r.ok && r.number === N1, r)
    r = await cid.attest(OTHER, N1); ok('number_taken on other account', r.error === 'number_taken' && r.status === 409, r)
    r = await cid.attest(BIZ, '+18008291040'); ok('hotline attest flags 🚩', r.ok && alerts.at(-1).includes('IRS'), alerts.at(-1))
    await db.collection('webCallerIds').deleteOne({ _id: '+18008291040' })
    ok('resolve verified', (await cid.resolve(BIZ, N1)) === N1)
    let thrown = null; try { await cid.resolve(OTHER, N1) } catch (e) { thrown = e.code } ok('resolve other user throws invalid_show_as', thrown === 'invalid_show_as', thrown)
    await cid.setDefault(BIZ, OWN, N1); ok('defaultFor after setDefault', (await cid.defaultFor(BIZ, OWN)) === N1)
    ok('defaultFor wrong chat null', (await cid.defaultFor(OTHER, OWN)) === null)
    thrown = null; try { await cid.setDefault(OTHER, '+18336110777', N1) } catch (e) { thrown = e.code } ok('setDefault unverified throws', thrown === 'invalid_show_as', thrown)
    await cid.setDefault(BIZ, OWN, null); ok('setDefault null clears', (await cid.defaultFor(BIZ, OWN)) === null)
    cid.logUse(BIZ, N1, 'test', '+14155550100'); await new Promise(r => setTimeout(r, 400))
    const u = await db.collection('callerIdUses').findOne({ chatId: BIZ }); ok('logUse inserted', u?.showAs === N1 && u?.via === 'test' && u?.to === '+14155550100', u)
  } catch (e) { ok('exception', false, e.stack) }
  await cleanup(); await mc.close()
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1)
})()
