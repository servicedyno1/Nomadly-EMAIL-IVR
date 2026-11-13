// eSIM BulkSMS: every Spenza failure reaches the admin bot; a failed number replacement orders a new line.
// Run from /app: node js/tests/test_bulk_esim_spenza_failures.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), P = require('../bulk-esim/provider-spenza'), BOT = require('../bulk-esim/bot')
const COLS = ['bsLineQueue', 'bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = [], last = () => alerts[alerts.length - 1] || '', since = (n) => alerts.slice(n).join('\n')
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1 }, 'test') // LEGACY_DEFAULTS: this suite covers the floor / spare-reserve / monitor paths
  await B.setConfig({ monitorEsims: 0, testerEsims: 0, autoProvision: false, manualApproval: true }, 'test')
  await B.provisionMany(3, 'test', 'test'); await B.healthCheck()
  const E = db.collection('bsEsims'), live = () => E.countDocuments({ status: { $nin: ['replaced', 'failed', 'expired', 'retired'] } })
  ok('3 lines in the pool', (await E.countDocuments({ status: 'available' })) === 3)

  // ---- replacement fails → admin told + new line ordered (even with auto-buy off) ----
  const a = await E.findOne({ status: 'available' }); process.env.BULK_ESIM_FAKE_RENEW_FAIL = a.iccid
  let n0 = alerts.length; const r1 = await B.replaceEsim(a._id, 'test: number blocked', 'admin:1')
  const bought = r1.bought && await E.findOne({ _id: r1.bought })
  ok('replace failed → result ok:false with the new line id', r1.ok === false && !!r1.bought, JSON.stringify(r1))
  ok('admin alerted: Spenza could not replace + ordering a new line', /could not replace the number of/.test(since(n0)) && /Ordering a new line instead/.test(since(n0)) && /New line .* ordered/.test(since(n0)), since(n0))
  ok('new line is the same role, same account, waiting for its check', bought && bought.role === (a.role || 'service') && bought.account === a.account && ['testing', 'provisioning'].includes(bought.status))
  ok('pool size kept (3 live lines)', (await live()) === 3, String(await live()))
  ok('replacement record + incident logged', (await db.collection('bsReplacements').findOne({ oldEsimId: a._id }))?.boughtEsimId === r1.bought && !!(await db.collection('bsIncidents').findOne({ type: 'replace_failed' })))

  // ---- replacement fails AND ordering fails (no credit) ----
  const b = await E.findOne({ status: 'available' }); process.env.BULK_ESIM_FAKE_RENEW_FAIL = b.iccid; process.env.BULK_ESIM_FAKE_PROVISION_FAIL = 'credit'; P.resetFakeFails()
  n0 = alerts.length; const r2 = await B.replaceEsim(b._id, 'test', 'system')
  ok('both fail → order QUEUED until the balance allows, admin told', r2.ok === false && !r2.bought && /Line order QUEUED/.test(since(n0)) && /Spenza could not order a new line/.test(since(n0)) && !!(await db.collection('bsLineQueue').findOne({ replaces: b._id, status: 'waiting' })), since(n0))
  ok('credit refusal → admin told to top up; account parked for orders only', /Top up Spenza/.test(since(n0)) && (await db.collection('bsAccounts').findOne({ _id: 'spenza1' })).orderBlockedBal === 500)
  delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL; process.env.BULK_ESIM_FAKE_CREDIT = '600'; n0 = alerts.length; await B.creditWatch()
  ok('balance goes up → orders unparked + queued replacement ordered', /ordering the missing line/.test(since(n0)) && (await db.collection('bsAccounts').findOne({ _id: 'spenza1' })).orderBlockedBal === null && (await db.collection('bsLineQueue').findOne({ replaces: b._id }))?.status === 'ordered', since(n0).slice(0, 600))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; await db.collection('bsAccounts').updateMany({}, { $set: { orderBlockedBal: null } })
  delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL

  // ---- admin /bulkreplace shows the outcome ----
  const c3 = await E.findOne({ status: 'available' }); process.env.BULK_ESIM_FAKE_RENEW_FAIL = c3.iccid
  const said = []; await BOT.admin(1, `/bulkreplace ${c3._id} manual`, (t) => said.push(t))
  ok('/bulkreplace failure → admin sees "new line … ordered instead"', /could not replace the number — new line .* ordered instead/.test(said[0] || ''), said[0])
  delete process.env.BULK_ESIM_FAKE_RENEW_FAIL

  // ---- auto path (suspended line) uses the same fallback once ----
  const d = await E.findOne({ status: { $in: ['available', 'testing'] }, iccid: { $ne: null } }); process.env.BULK_ESIM_FAKE_RENEW_FAIL = d.iccid
  await B.setConfig({ autoReplace: true, maxReplacesPerDay: 10 }, 'test')
  const before = await E.countDocuments({}); await B.autoReplace(d, 'suspended by provider (TEST)', await B.cfg())
  ok('auto-replace failure → exactly one new line ordered (no double buy)', (await E.countDocuments({})) === before + 2, `${before} → ${await E.countDocuments({})}`)
  delete process.env.BULK_ESIM_FAKE_RENEW_FAIL

  // ---- provisioning: temporary error retried once; persistent error alerted with the reason ----
  process.env.BULK_ESIM_FAKE_PROVISION_FAIL = 'temporary:1'; P.resetFakeFails(); n0 = alerts.length
  const p1 = await B.provisionOne('test retry', 'test')
  ok('temporary Spenza error → retried once and the line is bought, no failure alert', p1.ok && !/could not order/.test(since(n0)), JSON.stringify(p1))
  process.env.BULK_ESIM_FAKE_PROVISION_FAIL = 'temporary'; P.resetFakeFails(); n0 = alerts.length
  const p2 = await B.provisionOne('test down', 'test')
  ok('Spenza down → admin told why (HTTP 503, reason, account)', !!p2.error && /could not order a new line .*test down.*HTTP 503/.test(since(n0)), since(n0))
  process.env.BULK_ESIM_FAKE_PROVISION_FAIL = 'permanent'; n0 = alerts.length
  await B.provisionOne('test bad', 'test')
  ok('permanent error → alert says /bulkprovision once fixed', /\/bulkprovision to try again once fixed/.test(since(n0)))
  delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL

  // ---- balance + SIM list failures ----
  process.env.BULK_ESIM_FAKE_CREDIT = 'fail'; n0 = alerts.length; await B.creditWatch(); await B.creditWatch()
  ok('balance read fails → one alert per hour', (since(n0).match(/Could not read the Spenza/g) || []).length === 1, since(n0))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'
  process.env.BULK_ESIM_FAKE_SYNC_FAIL = '1'; n0 = alerts.length; await B.syncInventory(); await B.syncInventory()
  ok('SIM list fails → one alert per hour', (since(n0).match(/Could not list the SIMs/g) || []).length === 1, since(n0))
  delete process.env.BULK_ESIM_FAKE_SYNC_FAIL

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
