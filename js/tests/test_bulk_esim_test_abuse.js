// eSIM BulkSMS: test-text controls — one free test for customers who never paid, then wallet-gated paid tests to any USA/Canada
// number, per-campaign + account quota, paid tests refunded on booking, tested text frozen. Run from /app: node js/tests/test_bulk_esim_test_abuse.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsAiVariants']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  process.env.BULK_ESIM_WORKER = ''
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 10000, esimPerMin: 10000, monitorEsims: 0, scheduleDiscountPct: 0, testSends: 2 }, 'test') // legacy paid-test mode (default is now unlimited free tests)
  const M = db.collection('bsMessages'), CU = db.collection('bsCustomers')
  await B.provisionMany(2, 'test', 'test'); await B.provisionOne('test', 'test', 'tester'); await B.healthCheck()
  ok('2 service lines + tester ready', (await db.collection('bsEsims').countDocuments({ status: 'available', role: 'service' })) === 2 && (await db.collection('bsEsims').countDocuments({ status: 'available', role: 'tester' })) === 1)
  const cid = (await B.customer('Nomadly', '901'))._id
  const cp = (await B.createCampaign(cid, { name: 'Abuse', content: 'Hello there', contacts: nums(500, 1000), consent: true })).campaign
  const own = '+12125550777', any = '+13105551234'

  // ---- first-time customer: ONE free test to any number, no wallet ----
  ok('never paid → first-time, free test offered', JSON.stringify(await B.testOffer(cid)) === JSON.stringify({ firstTime: true, free: true }))
  ok('bad number refused', (await B.testCheck(cid, cp._id, '+1555')).error === 'err_number')
  const f0 = await B.testCheck(cid, cp._id, any)
  ok('free test: any USA/Canada number, charge 0', f0.ok && f0.free === true && f0.charge === 0, JSON.stringify(f0))
  const f1 = await B.testSend(cid, cp._id, any)
  ok('free test sent, customer marked, tested text frozen', f1.ok && f1.free && !!(await CU.findOne({ _id: cid })).freeTestAt && !!(await db.collection('bsCampaigns').findOne({ _id: cp._id })).testedHash && (await M.countDocuments({ cid, test: true, to: any })) === 1)
  ok('free test only once (testOffer.free false, still firstTime)', JSON.stringify(await B.testOffer(cid)) === JSON.stringify({ firstTime: true, free: false }))
  const k = await B.testCheck(cid, cp._id, own)
  ok('after the free test: paid test = unit price ($0.10), 2 campaign tests left', k.ok && k.free === false && k.charge === 0.1 && k.left === 2, JSON.stringify(k))
  ok('opted-out number refused', (await db.collection('bsSuppression').insertOne({ cid: '*', phone: '+12125550666', at: new Date() })) && (await B.testCheck(cid, cp._id, '+12125550666')).error === 'err_opted')

  // ---- charge, per-campaign limit, account quota ----
  const t1 = await B.testSend(cid, cp._id, own, { charge: k.charge }), t2 = await B.testSend(cid, cp._id, '+12125550778', { charge: k.charge })
  ok('two paid tests sent, charges recorded', t1.ok && t2.ok && t2.left === 0 && (await db.collection('bsCampaigns').findOne({ _id: cp._id })).testCharges === 0.2)
  ok('third paid test on the same campaign refused', (await B.testSend(cid, cp._id, own)).error === 'err_tests_used')
  await B.setConfig({ testsPerDay: 4 }, 'test')
  const cp2 = (await B.createCampaign(cid, { name: 'Draft2', content: 'Hi again', contacts: nums(500, 3000), consent: true })).campaign
  const t3 = await B.testSend(cid, cp2._id, own, { charge: 0.1 })
  ok('account quota: 4th test of the day (free one counts) ok, 5th refused across drafts', t3.ok && (await B.testSend(cid, cp2._id, own)).error === 'err_test_quota', JSON.stringify(await B.testQuota(cid, await B.cfg())))
  const lcp = (await B.createCampaign(cid, { name: 'Link', content: 'See www.nomadly.com', contacts: nums(500, 4000), consent: true })).campaign
  await B.setConfig({ testsPerDay: 10 }, 'test')
  ok('link campaign test costs the same unit as plain text ($0.10)', (await B.testCheck(cid, lcp._id, own)).charge === 0.1)

  // ---- frozen text + refund on booking ----
  await db.collection('bsCampaigns').updateOne({ _id: cp._id }, { $set: { content: ['Hello there friend'] } })
  ok('text changed after the test → booking refused (err_content_changed)', (await B.createBooking(cid, { campaignId: cp._id, now: true })).error === 'err_content_changed')
  await db.collection('bsCampaigns').updateOne({ _id: cp._id }, { $set: { content: ['Hello there'] } })
  const bk = await B.createBooking(cid, { campaignId: cp._id, now: true })
  ok('original text → booking ok', !!bk.booking, JSON.stringify(bk.error))
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  const rf = await db.collection('bsNotify').findOne({ type: 'refund', key: 'n_test_refund', campaignId: cp._id })
  ok('paid booking → $0.20 of test charges credited back (refund notice), only once', rf && rf.amount === 0.2 && (await db.collection('bsCampaigns').findOne({ _id: cp._id })).testRefunded && (await db.collection('bsNotify').countDocuments({ key: 'n_test_refund', campaignId: cp._id })) === 1, JSON.stringify(rf?.amount))
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  ok('confirm again → no second refund', (await db.collection('bsNotify').countDocuments({ key: 'n_test_refund', campaignId: cp._id })) === 1)
  ok('after a paid campaign → no longer first-time, no free test', JSON.stringify(await B.testOffer(cid)) === JSON.stringify({ firstTime: false, free: false }))
  const cu2 = (await B.customer('Nomadly', '902'))._id, cp3 = (await B.createCampaign(cu2, { name: 'New', content: 'Hello', contacts: nums(500, 5000), consent: true })).campaign
  await B.testSend(cu2, cp3._id, any); await db.collection('bsBookings').insertOne({ _id: 'bk_fake', cid: cu2, paymentStatus: 'paid', status: 'completed', createdAt: new Date() })
  ok('another new customer: free test, then paid booking → regular rules', JSON.stringify(await B.testOffer(cu2)) === JSON.stringify({ firstTime: false, free: false }) && (await B.testCheck(cu2, cp3._id, any)).charge === 0.1)

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
