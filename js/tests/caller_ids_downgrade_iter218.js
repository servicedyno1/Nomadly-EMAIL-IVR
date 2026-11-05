#!/usr/bin/env node
// iter218: caller-ids resolve()/isVerified reject attested numbers after Business→Pro downgrade; SIP default falls back to own number.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const cid = require('../cloudivr-web/caller-ids')
const sw = require('../scam-watch')
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + JSON.stringify(d)}`) }
const U = 'T218_down', N = '+14155550981', OWN = '+18336110218', CODEN = '+14155550982'
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  sw.setNotifier(() => {})
  cid.routes({ get() {}, post() {}, put() {}, delete() {} }, { db, h: f => f, numbersApi: { findMine: async () => null } })
  const P = db.collection('phoneNumbersOf')
  const cleanup = async () => {
    await P.deleteOne({ _id: U })
    await db.collection('webCallerIds').deleteMany({ _id: { $in: [N, CODEN] }, chatId: U })
    await db.collection('callerIdDefaults').deleteMany({ chatId: U })
    await db.collection('callerIdUses').deleteMany({ chatId: U })
  }
  // mirror of voice-service.js ~3480 outFrom selection
  const sipFrom = async () => {
    const def = await cid.defaultFor(U, OWN).catch(() => null)
    return def && await cid.isVerified(U, def).catch(() => false) ? def : OWN
  }
  try {
    await cleanup()
    await P.replaceOne({ _id: U }, { _id: U, val: { numbers: [{ phoneNumber: OWN, plan: 'business', status: 'active', provider: 'telnyx' }] } }, { upsert: true })
    const r = await cid.attest(U, N, { channel: 'bot' }); ok('business attest ok', r.ok, r)
    await cid.setDefault(U, OWN, N)
    ok('business isVerified true', await cid.isVerified(U, N) === true)
    ok('business SIP shows attested', await sipFrom() === N)
    // code-verified (non-attested) number should survive downgrade
    await db.collection('webCallerIds').replaceOne({ _id: CODEN }, { _id: CODEN, chatId: U, status: 'verified', method: 'code', createdAt: Date.now() }, { upsert: true })
    // downgrade
    await P.updateOne({ _id: U }, { $set: { 'val.numbers.0.plan': 'pro' } })
    ok('pro isVerified false (attested)', await cid.isVerified(U, N) === false)
    let err = null; try { await cid.resolve(U, N) } catch (e) { err = e }
    ok('pro resolve throws invalid_show_as', err && err.code === 'invalid_show_as', err && err.message)
    ok('pro SIP default falls back to own', await sipFrom() === OWN)
    ok('code-verified still valid on pro', await cid.isVerified(U, CODEN) === true)
    // expired business
    await P.updateOne({ _id: U }, { $set: { 'val.numbers.0.plan': 'business', 'val.numbers.0.status': 'expired' } })
    ok('expired business isVerified false', await cid.isVerified(U, N) === false)
    await P.updateOne({ _id: U }, { $set: { 'val.numbers.0.status': 'active' } })
    ok('re-upgraded isVerified true', await cid.isVerified(U, N) === true)
  } catch (e) { ok('no exception', false, e.stack) } finally {
    await cleanup(); await mc.close()
    console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1)
  }
})()
