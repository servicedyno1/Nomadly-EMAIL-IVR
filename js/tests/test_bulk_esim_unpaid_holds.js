// Unpaid booking holds (pending / awaiting_payment) must never make the autoscaler buy eSIMs; paid ones do.
// Prod 2026-11-12: two unpaid holds (1,001 SMS) bought 4 lines ($40) "below minimum inventory". Run: node js/tests/test_bulk_esim_unpaid_holds.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`qa_unpaid_${Date.now()}`)
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  await B.setConfig({ autoProvision: true, manualApproval: false }, 'test'); await B.bootstrap(); await B.healthCheck()
  const svc = () => db.collection('bsEsims').countDocuments({ role: 'service' })
  const before = await svc(), d = new Date(Date.now() + 86400e3).toISOString().slice(0, 10)
  await db.collection('bsBookings').insertOne({ _id: 'bk_hold', cid: 'Nomadly:1', type: 'paid', date: d, hour: 14, volume: 1001, allocation: { [`${d}T14`]: 1001 }, status: 'awaiting_payment', paymentStatus: 'unpaid', holdUntil: new Date(Date.now() + 600e3), price: 135 })
  ok('unpaid hold still reserves slot capacity', (await B.linesShort(d, await B.cfg())) > 0)
  ok('unpaid hold → no lines short for provisioning', (await B.linesShort(d, await B.cfg(), { paidOnly: true })) === 0)
  await B.autoscale()
  ok('unpaid hold → autoscaler buys nothing', (await svc()) === before && !alerts.some(a => /📈 Bought/.test(a)), `${before} → ${await svc()}`)
  await db.collection('bsBookings').updateOne({ _id: 'bk_hold' }, { $set: { status: 'provisioning', paymentStatus: 'paid' } })
  await B.autoscale()
  ok('once paid → lines are bought', (await svc()) > before && alerts.some(a => /📈 Bought/.test(a)), `${before} → ${await svc()} ${alerts.filter(a => /Bought/.test(a)).join(' | ').slice(0, 120)}`)
  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
