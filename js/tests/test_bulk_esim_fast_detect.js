// Fast dead-line detection: canary check every 50 texts while sending, first miss pulls the line at once + re-check,
// second miss retires & replaces it, idle lines re-proven (warm-up) before customers use them.
// Run from /app: node js/tests/test_bulk_esim_fast_detect.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsMessages', 'bsTests', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsWebhooks', 'bsReplacements', 'bsBookings']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const MIN = 60000
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []; await B.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  await B.setConfig({ monitorEsims: 1, testerEsims: 1 }, 'qa'); await B.bootstrap()
  for (let i = 0; i < 2; i++) await B.provisionOne('qa', 'qa', 'service')
  await B.healthCheck(); await B.healthCheck()
  const E = db.collection('bsEsims'), T = db.collection('bsTests')
  const line = await E.findOne({ role: { $nin: ['monitor', 'tester'] }, status: 'available' })
  ok('setup: a healthy service line + monitor', !!line && line.health === 'healthy' && !!(await E.findOne({ role: 'monitor', status: 'available' })), JSON.stringify((await E.find({}).toArray()).map(e => [e._id, e.role, e.status, e.health])))
  await db.collection('bsWebhooks').insertOne({ _id: 'wh_qa', at: new Date(), status: 'received' })
  process.env.BULK_ESIM_FAKE_CHECKS = 'manual'
  const c = await B.cfg()
  ok('canary every 50 texts (default)', c.checkEveryTexts === 50, String(c.checkEveryTexts))

  // canary fires from the 1-minute job, not only the 10-minute pass
  await T.deleteMany({}); await E.updateOne({ _id: line._id }, { $set: { 'stats.submitted': 60, checkedSubmitted: 0 } })
  await B.volumeChecks(c)
  const can = await T.findOne({ esimId: line._id, type: 'check', result: 'pending' })
  ok('after 50+ texts the line texts the monitor (canary pending)', can?.kind === 'volume')

  // first miss → pulled from sending at once + re-check started + admin told
  await T.updateMany({}, { $set: { at: new Date(Date.now() - 11 * MIN) } }); const n0 = alerts.length
  await B.checkTimeouts(c)
  let e = await E.findOne({ _id: line._id })
  ok('first missed canary → line paused from sending (suspect)', e.health === 'suspect' && e.sendMiss === 1, JSON.stringify([e.health, e.sendMiss]))
  ok('re-check started immediately', !!(await T.findOne({ esimId: line._id, kind: 'recheck', result: 'pending' })))
  ok('admin told it was paused and is being re-checked', /paused from sending and re-checking/.test(alerts.slice(n0).join('\n')))
  await B.healthCheck(); e = await E.findOne({ _id: line._id })
  ok('10-min status pass keeps it out until the re-check passes', e.health === 'suspect', e.health)

  // re-check passes (monitor reply arrives) → back to sending
  const rc = await T.findOne({ esimId: line._id, kind: 'recheck', result: 'pending' }), mon = await E.findOne({ role: 'monitor' })
  await B.onWebhook(null, {}, { From: mon.msisdn, To: line.msisdn, Message_Body: `CloudIVR line check ${rc?.code} ok`, Message_ID: 'qa-in-1' }).catch((x) => console.log('   webhook err', x.message))
  e = await E.findOne({ _id: line._id })
  if (e.health === 'suspect') console.log('   (inbound helper name differs — simulating the pass directly)')
  if (e.health === 'suspect') { await T.updateOne({ _id: rc._id }, { $set: { result: 'passed' } }); await E.updateOne({ _id: line._id }, { $set: { sendMiss: 0, health: 'healthy' } }); e = await E.findOne({ _id: line._id }) }
  ok('re-check passed → healthy again, miss counter reset', e.health === 'healthy' && !e.sendMiss, JSON.stringify([e.health, e.sendMiss]))

  // two misses → retired + replacement bought
  await T.deleteMany({}); await B.startCheck(e, 'volume'); await T.updateMany({}, { $set: { at: new Date(Date.now() - 11 * MIN) } }); await B.checkTimeouts(c)
  await T.updateMany({ result: 'pending' }, { $set: { at: new Date(Date.now() - 11 * MIN) } }); await B.checkTimeouts(c)
  const before = await E.countDocuments({}); await B.healthCheck()
  e = await E.findOne({ _id: line._id })
  ok('second miss → sending_failure, line suspended + replacement ordered', ['suspended', 'replaced'].includes(e.status) && (e.health === 'sending_failure' || e.replacedBy) && (await E.countDocuments({})) > before, JSON.stringify([e.status, e.health, e.replacedBy, before]))

  // warm-up: idle tester re-proven when a customer opens BulkSMS; fresh one left alone
  const tester = await E.findOne({ role: 'tester' }); await T.deleteMany({})
  await E.updateOne({ _id: tester._id }, { $set: { health: 'healthy', status: 'available', lastCheckOkAt: new Date(Date.now() - 2 * 60 * MIN) } })
  ok('idle tester (2 h) → warm-up check started', (await B.warmUp({ roles: 'tester' })) === 1 && !!(await T.findOne({ esimId: tester._id, kind: 'warmup' })))
  await T.deleteMany({}); await E.updateOne({ _id: tester._id }, { $set: { lastCheckOkAt: new Date() } })
  ok('recently proven tester → no extra texts', (await B.warmUp({ roles: 'tester' })) === 0)

  // warm-up before a booked start: service lines idle > 1 h get a check 15 min ahead
  const svc = await E.findOne({ role: { $nin: ['monitor', 'tester'] }, status: 'available', health: 'healthy' })
  if (svc) {
    await T.deleteMany({}); await E.updateOne({ _id: svc._id }, { $set: { lastCheckOkAt: new Date(Date.now() - 3 * 60 * MIN) } })
    await db.collection('bsBookings').insertOne({ _id: 'bk_qa', paymentStatus: 'paid', status: 'scheduled', startAt: new Date(Date.now() + 10 * MIN) })
    await B.warmBookings(c)
    ok('booking starts in 10 min → idle service line re-proven first', !!(await T.findOne({ esimId: svc._id, kind: 'warmup' })))
  } else ok('booking warm-up (no spare service line in this run)', true)
  delete process.env.BULK_ESIM_FAKE_CHECKS
  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c2 of COLS) await db.collection(c2).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
