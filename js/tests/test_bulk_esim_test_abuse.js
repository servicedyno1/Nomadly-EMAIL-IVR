// eSIM BulkSMS: test-text abuse controls — verified own numbers (SMS code), per-campaign + account quota, paid tests refunded on
// booking, tested text frozen. Run from /app: node js/tests/test_bulk_esim_test_abuse.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsAiVariants']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  process.env.BULK_ESIM_WORKER = ''
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 10000, esimPerMin: 10000, monitorEsims: 0, scheduleDiscountPct: 0 }, 'test')
  const M = db.collection('bsMessages'), CU = db.collection('bsCustomers')
  await B.provisionMany(2, 'test', 'test'); await B.provisionOne('test', 'test', 'tester'); await B.healthCheck()
  ok('2 service lines + tester ready', (await db.collection('bsEsims').countDocuments({ status: 'available', role: 'service' })) === 2 && (await db.collection('bsEsims').countDocuments({ status: 'available', role: 'tester' })) === 1)
  const cid = (await B.customer('Nomadly', '901'))._id
  const cp = (await B.createCampaign(cid, { name: 'Abuse', content: 'Hello there', contacts: nums(500, 1000), consent: true })).campaign
  const own = '+12125550777'

  // ---- verified numbers ----
  ok('test to an unverified number refused', (await B.testCheck(cid, cp._id, own)).error === 'err_test_unverified')
  ok('bad number refused', (await B.requestTestNumber(cid, '+1555')).error === 'err_number')
  const rq = await B.requestTestNumber(cid, own)
  const code = (await CU.findOne({ _id: cid })).testVerify?.code
  ok('code requested → 6-digit code stored, verification text queued (system, test → tester line)', rq.ok && /^\d{6}$/.test(code || '') && (await M.countDocuments({ cid: 'system:verify', to: own, test: true, system: true })) === 1, JSON.stringify(rq))
  ok('second request within a minute refused', (await B.requestTestNumber(cid, own)).error === 'err_code_wait')
  await B.claimWorker(); await B.tick()
  const vm = await M.findOne({ cid: 'system:verify', to: own })
  ok('verification text sent through the TESTER line', vm.status === 'sent' && (await db.collection('bsEsims').findOne({ _id: vm.esimId })).role === 'tester', `${vm.status} ${vm.esimId}`)
  ok('wrong code → err_code_bad with attempts left', (await B.verifyTestNumber(cid, '000000')).error === 'err_code_bad')
  const vr = await B.verifyTestNumber(cid, code)
  ok('right code → number verified', vr.ok && (await B.testNumbers(cid)).includes(own) && !(await CU.findOne({ _id: cid })).testVerify)
  ok('expired/no pending code → err_code_expired', (await B.verifyTestNumber(cid, code)).error === 'err_code_expired')
  ok('already verified number → ok immediately, no new code', (await B.requestTestNumber(cid, own)).verified === true)
  for (const p of ['+12125550778', '+12125550779']) { await CU.updateOne({ _id: cid }, { $unset: { testVerify: 1 } }); await B.requestTestNumber(cid, p); await B.verifyTestNumber(cid, (await CU.findOne({ _id: cid })).testVerify.code) }
  ok('max 3 verified numbers', (await B.testNumbers(cid)).length === 3 && (await B.requestTestNumber(cid, '+12125550780')).error === 'err_test_max')

  // ---- charge, per-campaign limit, account quota ----
  const k = await B.testCheck(cid, cp._id, own)
  ok('testCheck ok: charge = unit price of one text ($0.10), 2 left', k.ok && k.charge === 0.1 && k.left === 2, JSON.stringify(k))
  const t1 = await B.testSend(cid, cp._id, own, { charge: k.charge }), t2 = await B.testSend(cid, cp._id, '+12125550778', { charge: k.charge })
  ok('two tests sent, charges recorded, tested text frozen (hash)', t1.ok && t2.ok && t2.left === 0 && (await db.collection('bsCampaigns').findOne({ _id: cp._id })).testCharges === 0.2 && !!(await db.collection('bsCampaigns').findOne({ _id: cp._id })).testedHash)
  ok('third test on the same campaign refused', (await B.testSend(cid, cp._id, own)).error === 'err_tests_used')
  ok('test to a stranger\'s number refused even with tests left', (await B.testSend(cid, (await B.createCampaign(cid, { name: 'X', content: 'Hi', contacts: nums(500, 2000), consent: true })).campaign._id, '+13105551234')).error === 'err_test_unverified')
  await B.setConfig({ testsPerDay: 3 }, 'test')
  const cp2 = (await B.createCampaign(cid, { name: 'Draft2', content: 'Hi again', contacts: nums(500, 3000), consent: true })).campaign
  const t3 = await B.testSend(cid, cp2._id, own, { charge: 0.1 })
  ok('account quota: 3rd test of the day ok, 4th refused across drafts', t3.ok && (await B.testSend(cid, cp2._id, own)).error === 'err_test_quota', JSON.stringify(await B.testQuota(cid, await B.cfg())))
  const lcp = (await B.createCampaign(cid, { name: 'Link', content: 'See www.nomadly.com', contacts: nums(500, 4000), withLinks: true, consent: true })).campaign
  await B.setConfig({ testsPerDay: 10 }, 'test')
  ok('link campaign test costs the link unit ($0.15)', (await B.testCheck(cid, lcp._id, own)).charge === 0.15)

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

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
