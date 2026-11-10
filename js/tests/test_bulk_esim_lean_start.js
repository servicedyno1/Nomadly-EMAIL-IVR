// eSIM BulkSMS lean start: 3 eSIMs (tester + 2 service, no monitor), no balance floor; an order refused for credit alerts the admin
// with the top-up needed and is retried automatically after the top-up. Run from /app: node js/tests/test_bulk_esim_lean_start.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '30'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), P = require('../bulk-esim/provider-spenza')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = [], since = (n) => alerts.slice(n).join('\n')
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  const E = db.collection('bsEsims'), live = (q = {}) => E.countDocuments({ status: { $nin: ['replaced', 'failed', 'expired', 'retired'] }, ...q })
  const c0 = await B.cfg()
  ok('defaults: no monitor, 1 tester, 2 service minimum, no balance floor, no spare reserve', c0.monitorEsims === 0 && c0.testerEsims === 1 && c0.minEsims === 2 && c0.minCredit === 0 && c0.reserveBooking === false)
  ok('Spenza limit 30/min → we send at most 28/min per account (2 below), ceiling ≈ 13,440 SMS/day', c0.accounts[0].perMin === 28 && c0.accounts[0].limitPerMin === 30)
  process.env.BULK_ESIM_FAKE_RATE = '30,2,40'
  ok('header pacing stops with 2 sends still left in Spenza’s window', (await B.cfg()) && B.acctOpen(await B.cfg(), 'spenza1') === false)
  process.env.BULK_ESIM_FAKE_RATE = '30,3,40'
  ok('…and keeps going at 3 left', B.acctOpen(await B.cfg(), 'spenza1') === true)
  delete process.env.BULK_ESIM_FAKE_RATE
  const r = await B.bootstrap()
  ok('go-live: only the tester line is bought', r.testers === 1 && (await live()) === 1, JSON.stringify(r))
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test'); await B.healthCheck()
  const cid = (await B.customer('Nomadly', '961'))._id
  const cp = (await B.createCampaign(cid, { content: 'Spring sale this week', contacts: nums(500), consent: true })).campaign
  const bk = await B.createBooking(cid, { campaignId: cp._id, date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), hour: 16 })
  ok('first booking allowed with a small balance (no floor)', !!bk.booking, bk.error)
  await B.confirmBooking(bk.booking._id, { method: 'wallet' }); await B.autoscale()
  ok('first paid campaign → 2 service lines, no monitor = 3 eSIMs total', (await live({ role: { $nin: ['tester', 'monitor'] } })) === 2 && (await live({ role: 'monitor' })) === 0 && (await live()) === 3, String(await live()))
  await B.healthCheck()
  ok('service lines check each other (no monitor needed) and join the pool', (await E.countDocuments({ role: { $nin: ['tester', 'monitor'] }, status: 'available' })) === 2)

  // ---- growth: more lines needed, Spenza refuses for credit ----
  process.env.BULK_ESIM_FAKE_CREDIT = '3'; await B.creditWatch()
  ok('$3 balance: sending NOT paused (no floor)', !(await B.state()).reasons.length)
  process.env.BULK_ESIM_FAKE_PROVISION_FAIL = 'credit'; P.resetFakeFails()
  let n0 = alerts.length; const p1 = await B.provisionOne('growth test', 'test')
  ok('order refused for credit → admin told to top up, with the line price', !!p1.error && /Top up Spenza .* to buy lines: balance \$3/.test(since(n0)) && /ordered automatically as soon as the balance goes up/.test(since(n0)), since(n0))
  ok('account parked for orders only (lines keep sending)', !(await db.collection('bsAccounts').findOne({ _id: 'spenza1' })).low && (await db.collection('bsAccounts').findOne({ _id: 'spenza1' })).orderBlockedBal === 3)
  n0 = alerts.length; const p2 = await B.provisionOne('growth test 2', 'test')
  ok('no retry loop while the balance has not changed', !!p2.error && !/Top up Spenza/.test(since(n0)) && (await E.countDocuments({ status: 'purchasing' })) === 0)
  delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL
  const cid2 = (await B.customer('Nomadly', '962'))._id, cp2 = (await B.createCampaign(cid2, { content: 'Second wave', contacts: nums(1500, 3000), consent: true })).campaign
  const bk2 = await B.createBooking(cid2, { campaignId: cp2._id, date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), hour: 17 })
  if (bk2.booking) await B.confirmBooking(bk2.booking._id, { method: 'wallet' })
  const before = await live(); n0 = alerts.length; await B.autoscale()
  ok('bookings grow → admin told how much to top up for the extra lines', /Bookings need \d+ more line\(s\)/.test(since(n0)) && /Top up about/.test(since(n0)) && (await live()) === before, since(n0).slice(0, 300))
  process.env.BULK_ESIM_FAKE_CREDIT = '200'; n0 = alerts.length; await B.creditWatch()
  ok('top-up → missing lines ordered automatically', /topped up \(\$200\) — ordering the missing line/.test(since(n0)) && (await live()) > before && /Bought \d+ eSIM/.test(since(n0)), since(n0).slice(0, 300))

  // ---- balance actually gone → pause; top-up → resume ----
  process.env.BULK_ESIM_FAKE_CREDIT = '0'; await B.creditWatch()
  ok('$0 → sending paused', (await B.state()).reasons.includes('provider_credit'))
  process.env.BULK_ESIM_FAKE_CREDIT = '40'; await B.creditWatch()
  ok('top-up → sending resumes', !(await B.state()).reasons.length)

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
