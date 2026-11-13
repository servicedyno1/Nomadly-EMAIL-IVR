// One free test per Telegram chat id across all bots (username or brand changes don't reset it); no daily free-test cap by default.
// Run from /app: node js/tests/test_bulk_esim_freetest_identity.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsMessages', 'bsTests', 'bsCampaigns', 'bsCustomers', 'bsFreeTests', 'bsBookings', 'bsLocks', 'bsNotify', 'bsAudit', 'bsIncidents', 'bsEsimDaily']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, f) => Array.from({ length: n }, (_, i) => `+1212555${f + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} }); await B.bootstrap(); await B.healthCheck()
  await B.setConfig({ testSends: 2 }, 'test') // legacy one-free-test mode (default is now unlimited free tests)
  ok('default: no daily free-test cap', (await B.cfg()).freeTestsPerDay === 0)
  const a = (await B.customer('Nomadly', '4242'))._id, cp = (await B.createCampaign(a, { content: 'Hello there friends', contacts: nums(500, 1000), consent: true })).campaign
  const r1 = await B.testSend(a, cp._id, '+13105550301')
  ok('first free test on NomadlyBot', r1.ok && r1.free, JSON.stringify(r1))
  const b = (await B.customer('PROSHOP', '4242'))._id, cp2 = (await B.createCampaign(b, { content: 'Hello there friends', contacts: nums(500, 3000), consent: true })).campaign
  ok('same chat id on another bot → no second free test', (await B.testOffer(b)).free === false)
  const k = await B.testCheck(b, cp2._id, '+13105550302')
  ok('…and its test is not free', !k.free, JSON.stringify(k))
  const c = (await B.customer('Nomadly', '4243'))._id
  ok('a different chat id still gets its free test', (await B.testOffer(c)).free === true)
  for (let i = 0; i < 60; i++) await db.collection('bsFreeTests').insertOne({ _id: `+1310555${4000 + i}`, cid: `Nomadly:${9000 + i}`, at: new Date() })
  const cp3 = (await B.createCampaign(c, { content: 'Hello there friends', contacts: nums(500, 5000), consent: true })).campaign
  ok('60 free tests today → still free for a new user (no cap)', (await B.testCheck(c, cp3._id, '+13105550399')).free === true)
  console.log(`\n${pass} passed, ${fail} failed`)
  for (const x of COLS) await db.collection(x).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
