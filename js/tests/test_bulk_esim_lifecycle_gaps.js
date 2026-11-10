// Lifecycle gaps: inbound texts not arriving must not retire lines (no buy loop); an auth pause lifts itself once Spenza answers.
// Run from /app: node js/tests/test_bulk_esim_lifecycle_gaps.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsMessages', 'bsTests', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsWebhooks', 'bsReplacements']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []; await B.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  await B.bootstrap(); await B.healthCheck()
  const E = db.collection('bsEsims'), T = db.collection('bsTests'), tester = await E.findOne({ role: 'tester' })
  process.env.BULK_ESIM_FAKE_CHECKS = 'manual'
  await T.deleteMany({}); const r = await B.startCheck(tester, 'periodic')
  await T.updateMany({}, { $set: { at: new Date(Date.now() - 11 * 60000) } })
  const n0 = alerts.length; await B.checkTimeouts(await B.cfg())
  const t = await T.findOne({ esimId: tester._id }), e = await E.findOne({ _id: tester._id })
  ok('no inbound for 6 h → check voided as inbound_down, line not blamed', r === 'pending' && t.result === 'inbound_down' && !(e.sendMiss || 0), JSON.stringify({ r, res: t?.result, miss: e.sendMiss }))
  ok('admin told incoming texts are not arriving; lines not retired', /No incoming texts have reached the platform/.test(alerts.slice(n0).join('\n')) && e.status === 'available')
  await db.collection('bsWebhooks').insertOne({ _id: 'wh_qa', at: new Date(), status: 'received' })
  await T.deleteMany({}); await B.startCheck(tester, 'periodic'); await T.updateMany({}, { $set: { at: new Date(Date.now() - 11 * 60000) } })
  await B.checkTimeouts(await B.cfg())
  ok('with recent inbound traffic a missed check still counts against the line', (await T.findOne({ esimId: tester._id })).result === 'no_delivery' && (await E.findOne({ _id: tester._id })).sendMiss === 1)
  delete process.env.BULK_ESIM_FAKE_CHECKS
  await B.pause('provider_auth', 'qa 401'); ok('auth pause set', (await B.state()).reasons.includes('provider_auth'))
  const n1 = alerts.length; await B.creditWatch()
  ok('Spenza answers again → auth pause lifted automatically + admin told', !(await B.state()).reasons.includes('provider_auth') && /accepts our credentials again/.test(alerts.slice(n1).join('\n')))
  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
