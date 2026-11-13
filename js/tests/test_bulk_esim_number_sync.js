// A line renumbered outside the engine (Spenza renew-number by hand): the 5-min SIM sync adopts the new number. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), E = db.collection('bsEsims'), alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  const id = 'ESIM-0951', icc = '8901240397145742442'
  await E.deleteOne({ _id: id }); await E.insertOne({ _id: id, role: 'tester', status: 'available', health: 'healthy', msisdn: '+16317901824', iccid: icc, account: 'spenza1', replacedBy: null, createdAt: new Date(), updatedAt: new Date() })
  try {
    await B.syncInventory()
    ok('same number at Spenza → nothing changes', (await E.findOne({ _id: id })).msisdn === '+16317901824')
    process.env.BULK_ESIM_FAKE_MDN = JSON.stringify({ [icc]: '+17062464661' })
    const n0 = alerts.length; await B.syncInventory()
    const e = await E.findOne({ _id: id })
    ok('renumbered at Spenza → new number adopted, old kept', e.msisdn === '+17062464661' && e.prevMsisdn === '+16317901824' && !!e.numberChangedAt, `${e.msisdn} prev ${e.prevMsisdn}`)
    ok('admin told old → new', alerts.slice(n0).some(a => /Spenza now reports \+17062464661 \(was \+16317901824\)/.test(a)))
    ok('still the test line', e.role === 'tester')
  } finally { delete process.env.BULK_ESIM_FAKE_MDN; await E.deleteOne({ _id: id }) }
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
