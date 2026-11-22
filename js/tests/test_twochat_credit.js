'use strict'
// 2Chat credit watch: NO_CREDIT → one admin alert; calls go through again → Bird linking + forward checks restarted.
const axios = require('axios')
let cdrs = []
axios.create = () => ({ get: async () => ({ data: { cdrs } }) })
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.TWOCHAT_API_KEY = 'test'
const tc = require('../twochat')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
const realNow = Date.now

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(`test_twochat_credit_${Date.now()}`)
  const admin = []
  await db.collection('phoneNumbersOf').insertOne({ _id: '1', val: { numbers: [{ phoneNumber: '+442000000001', provider: '2chat', status: 'active', landingNumber: '+1763', forwardSetup: { doneAt: new Date() } }] } })
  await db.collection('birdCallerIdVerify').insertOne({ _id: '+442000000001', status: 'failed', rounds: 30, gaveUpAt: new Date() })
  tc.init({ db, notifyAdmin: (t) => admin.push(t), adminEmail: () => {}, tellCustomer: async () => {}, birdVerify: () => ({ arm: async () => ({}) }) })
  const pass5min = () => { const t = Date.now() + 6 * 60000; Date.now = () => t }

  cdrs = [{ created_at: new Date().toISOString(), status: 'NO_CREDIT', received_on_number: '+442000000001' }]
  await tc.tick()
  ok(admin.filter(t => /out of credit/.test(t)).length === 1, 'admin alerted when 2Chat runs out of credit')
  pass5min(); await tc.tick()
  ok(admin.filter(t => /out of credit/.test(t)).length === 1, 'not repeated within the hour')

  cdrs = [{ created_at: new Date(realNow()).toISOString(), status: 'COMPLETED', received_on_number: '+442000000001' }, ...cdrs]
  pass5min(); await tc.tick()
  const v = await db.collection('birdCallerIdVerify').findOne({ _id: '+442000000001' })
  ok(admin.some(t => /credit is back/.test(t)), 'admin told credit is back')
  ok(v.rounds === 0 && !v.gaveUpAt, 'Bird caller-ID linking restarted after the credit gap')

  Date.now = realNow
  await db.dropDatabase(); await c.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
