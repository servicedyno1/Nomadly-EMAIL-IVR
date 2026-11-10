// eSIM BulkSMS full automation: account swap mid-campaign continues where it stopped + lines bought on the new account;
// low balance pauses everything and a top-up resumes sending AND orders the missing lines. Run from /app: node js/tests/test_bulk_esim_automation.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = [], since = (n) => alerts.slice(n).join('\n')
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1 }, 'test') // LEGACY_DEFAULTS: this suite covers the floor / spare-reserve / monitor paths
  await B.bootstrap()
  await B.setConfig({ quietStart: 0, quietEnd: 24, monitorEsims: 0, testerEsims: 0, autoProvision: true, manualApproval: false, minEsims: 2, platformPerMin: 10000, esimPerMin: 10000 }, 'test')
  await B.provisionMany(2, 'test', 'test'); await B.healthCheck()
  const E = db.collection('bsEsims'), M = db.collection('bsMessages'), usable = () => E.countDocuments({ role: { $nin: ['monitor', 'tester'] }, status: 'available' })
  const cid = (await B.customer('Nomadly', '951'))._id
  const cp = (await B.createCampaign(cid, { content: 'Spring sale this week', contacts: nums(500, 1000), consent: true })).campaign
  const bk = (await B.createBooking(cid, { campaignId: cp._id, now: true })).booking; await B.confirmBooking(bk._id, { method: 'wallet' })
  await M.updateMany({ campaignId: cp._id }, { $set: { nextAt: new Date(Date.now() + 3600000) } }) // keep them queued
  await M.updateMany({ campaignId: cp._id, to: { $in: nums(100, 1000) } }, { $set: { status: 'sent' } }) // 100 already out
  ok('campaign half way: 100 sent, 400 queued, 2 lines', (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 400 && (await usable()) === 2)

  // ---- Spenza account replaced (new credentials on redeploy) ----
  await db.collection('bsAccounts').updateOne({ _id: 'spenza1' }, { $set: { keyHash: 'old-credentials' } })
  let n0 = alerts.length; const r = await B.bootstrap()
  ok('old account lines retired (2 service + tester)', r.retired >= 2 && (await E.countDocuments({ status: 'retired' })) === r.retired, JSON.stringify(r))
  ok('needed lines ordered on the new credentials at once (no admin step)', (await E.countDocuments({ status: { $in: ['testing', 'provisioning', 'purchasing', 'available'] }, role: 'service' })) >= 2 && /Bought \d+ eSIM/.test(since(n0)), since(n0).slice(0, 400))
  await M.updateMany({ campaignId: cp._id, status: 'queued' }, { $set: { expireAt: new Date(Date.now() - 60000) } }) // deadline passes during the swap
  await db.collection('bsConfig').updateOne({ _id: 'state' }, { $set: { outageSince: new Date(Date.now() - 3 * 3600000) } })
  await E.updateMany({ status: 'testing' }, { $set: { status: 'provisioning' } }) // new lines not usable yet
  await B.finishCampaigns()
  ok('no usable line → queued texts are NOT expired or refunded', (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 400 && (await M.countDocuments({ campaignId: cp._id, status: 'expired' })) === 0)
  await E.updateMany({ status: 'provisioning' }, { $set: { status: 'testing' } }); await B.healthCheck()
  ok('new lines pass their checks and join the pool', (await usable()) >= 2)
  n0 = alerts.length; await B.finishCampaigns()
  const q = await M.findOne({ campaignId: cp._id, status: 'queued' })
  ok('lines back → the 400 texts continue where they stopped, deadline moved ~3 h', (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 400 && q.expireAt > new Date(Date.now() + 2.5 * 3600000) && /continue exactly where they stopped/.test(since(n0)), since(n0))
  ok('100 already-sent texts untouched (no resend)', (await M.countDocuments({ campaignId: cp._id, status: 'sent' })) === 100)

  // ---- low balance: pause, lines can't be bought; top-up resumes and orders what is missing ----
  await E.updateMany({ status: 'available' }, { $set: { status: 'failed' } })
  process.env.BULK_ESIM_FAKE_CREDIT = '5'; n0 = alerts.length; await B.creditWatch()
  ok('balance under the floor → sending paused, admin told', (await B.state()).reasons.includes('provider_credit') && /PAUSED/.test(since(n0)))
  await B.autoscale()
  ok('lines needed but blocked by credit → nothing bought, admin told', (await E.countDocuments({ status: { $in: ['testing', 'available'] } })) === 0 && /blocked|not bought/i.test(since(n0)), since(n0).slice(-300))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; n0 = alerts.length; await B.creditWatch()
  ok('top-up → sending resumes automatically', !(await B.state()).reasons.length && /Sending resumed|cleared/.test(since(n0)))
  ok('top-up → missing lines ordered automatically for the 400 waiting texts', (await E.countDocuments({ status: { $in: ['testing', 'available'] }, role: 'service' })) >= 1 && /Bought \d+ eSIM/.test(since(n0)), since(n0).slice(0, 400))
  await B.healthCheck(); await B.finishCampaigns()
  ok('waiting texts still queued and sendable (not expired during the pause)', (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 400 && (await usable()) >= 1)

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
