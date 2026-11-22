'use strict'
// 2Chat setup watcher: held as "setting up" → admin alerted → Bird check armed → live once Bird's call landed.
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const tc = require('../twochat')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(`test_twochat_${Date.now()}`)
  const col = db.collection('phoneNumbersOf'), v = db.collection('birdCallerIdVerify')
  const admin = [], told = [], armed = []
  await col.insertOne({ _id: '5000000000000099', val: { numbers: [
    { phoneNumber: '+442000000001', provider: '2chat', status: 'active', plan: 'business', landingNumber: '+17630000001', purchaseDate: new Date().toISOString() },
    { phoneNumber: '+442000000002', provider: '2chat', status: 'active', landingNumber: '+17630000002', forwardSetup: { doneAt: new Date() } },
  ] } })
  tc.init.call(null, { db, notifyAdmin: (t) => admin.push(t), adminEmail: () => {}, tellCustomer: async (id, p) => told.push(p),
    birdVerify: () => ({ arm: async (n, o) => { armed.push(n); await v.updateOne({ _id: n }, { $set: { status: 'calling', expiresAt: new Date(Date.now() + o.ttlMs) } }, { upsert: true }); return { status: 'pending' } } }) })

  await tc.tick()
  let n = (await col.findOne({})).val.numbers
  ok(n[0].status === 'provisioning' && n[0].awaitingForward === true, 'new 2Chat number held as setting up')
  ok(n[1].status === 'active', 'already-confirmed number untouched')
  ok(admin.length === 1 && admin[0].includes('+17630000001') && admin[0].includes('+442000000001'), 'admin told which forward number to enter')
  ok(armed.length === 1 && armed[0] === '+442000000001', 'Bird check armed for the waiting number only')

  await tc.tick()
  ok(armed.length === 1 && admin.length === 1, 'no repeat call or alert before the next try is due')

  await v.updateOne({ _id: '+442000000001' }, { $set: { status: 'verified', verifiedAt: new Date(Date.now() + 1000) } })
  await tc.tick()
  n = (await col.findOne({})).val.numbers
  ok(n[0].status === 'active' && !n[0].awaitingForward && !!n[0].forwardSetup?.doneAt, 'goes live once Bird\'s call arrived')
  ok(told.includes('+442000000001'), 'customer told it is ready')
  ok(admin.some(t => t.includes('is live')), 'admin told it is live')

  await tc.tick()
  ok((await col.findOne({})).val.numbers[0].status === 'active' && armed.length === 1, 'live number left alone afterwards')

  // Bird's call came through the forward but Bird rejected the code → still live (Bird linking retries separately).
  await col.updateOne({ _id: '5000000000000099' }, { $push: { 'val.numbers': { phoneNumber: '+442000000003', provider: '2chat', status: 'active', landingNumber: '+17630000003', purchaseDate: new Date().toISOString() } } })
  await tc.tick()
  await v.updateOne({ _id: '+442000000003' }, { $set: { status: 'calling', lastCode: '326699', error: 'E21034 The verification code has expired.' } })
  await tc.tick()
  ok((await col.findOne({})).val.numbers[2].status === 'active' && told.includes('+442000000003'), 'call through the forward with a rejected code still goes live')

  await db.dropDatabase(); await c.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
