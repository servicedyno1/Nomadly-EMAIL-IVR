// Spenza plan stuck PENDING (SIM INACTIVE, prod ESIM-0004/0005 2026-11-12): line stays out of the pool, admin told at 2 h,
// retired + pending plan cancelled + replacement bought at 24 h. Run: node js/tests/test_bulk_esim_never_activated.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`qa_pending_${Date.now()}`), alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  await B.setConfig({ autoProvision: true, manualApproval: false }, 'test'); await B.bootstrap(); await B.healthCheck()
  const iccid = '89012400000000004806'
  await db.collection('bsEsims').insertOne({ _id: 'ESIM-0904', role: 'service', status: 'testing', health: 'unknown', msisdn: '+16316900316', iccid, account: 'spenza1', createdAt: new Date(Date.now() - 3 * 3600e3), updatedAt: new Date() })
  process.env.BULK_ESIM_FAKE_PENDING = iccid
  await B.healthCheck()
  let e = await db.collection('bsEsims').findOne({ _id: 'ESIM-0904' })
  ok('PENDING plan → health "activating", not technically failed, stays testing', e.health === 'activating' && e.status === 'testing' && !(e.apiFails > 0), `${e.health}/${e.status}`)
  ok('admin told after 2 h', alerts.some(a => /has not activated its plan after 3 h/.test(a)))
  const before = await db.collection('bsEsims').countDocuments({ role: 'service' })
  await db.collection('bsEsims').updateOne({ _id: 'ESIM-0904' }, { $set: { createdAt: new Date(Date.now() - 25 * 3600e3) } })
  await B.healthCheck()
  e = await db.collection('bsEsims').findOne({ _id: 'ESIM-0904' })
  ok('24 h → retired (failed) + replacement bought', e.status === 'failed' && (await db.collection('bsEsims').countDocuments({ role: 'service' })) === before + 1 && alerts.some(a => /never activated its plan in 24 h/.test(a)), e.status)
  delete process.env.BULK_ESIM_FAKE_PENDING
  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
