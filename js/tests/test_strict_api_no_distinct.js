// T1 iter258: production Mongo uses serverApi strict:true (distinct() rejected). Verify the replacements work on a strict client:
// db.distinctValues, statement.build, oneGuard (via B.testCheck), SignalWire reserved-callers aggregate — and that distinct() really is rejected.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient, ServerApiVersion } = require('mongodb')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } }), db = cl.db(process.env.DB_NAME)
  try {
    let rejected = false; try { await db.collection('bsMessages').distinct('to', {}) } catch (e) { rejected = /apiStrict/.test(e.message) }
    ok('strict client rejects distinct() (repro of prod error)', rejected)
    const { distinctValues } = require('../db')
    const v = await distinctValues(db.collection('bsMessages'), 'cid', {}); ok('distinctValues works on strict client', Array.isArray(v), `${v.length} values`)
    const S = require('../cloudivr-web/statement'), now = new Date()
    const d = await S.build(db, '990000999', new Date(now - 30 * 864e5), now); ok('statement.build works on strict client', !!d, Object.keys(d || {}).join(','))
    const r = await db.collection('phoneNumbersOf').aggregate([{ $match: { 'val.numbers.provider': 'signalwire' } }, { $unwind: '$val.numbers' }, { $match: { 'val.numbers.provider': 'signalwire' } }, { $group: { _id: '$val.numbers.phoneNumber' } }]).toArray()
    ok('SignalWire reserved-callers aggregate works on strict client', Array.isArray(r), `${r.length}`)
    const B = require('../bulk-esim/core'); await B.init({ db, log: () => {} })
    const cid = B.cidOf('Nomadly', 990000778)
    const cp = await B.createCampaign(cid, { name: 'TEST_strict', content: ['Hi strict QA'], contacts: Array.from({ length: 500 }, (_, i) => `+1212555${3000 + i}`), skip: [], optOut: true, consent: true })
    const k = cp.campaign ? await B.testCheck(cid, cp.campaign._id, '+13104567891') : { error: cp.error }
    ok('oneGuard via testCheck on strict client (no distinct error)', !k.error || !/apiStrict/.test(String(k.error)), JSON.stringify(k).slice(0, 120))
    for (const c of ['bsCampaigns', 'bsMessages', 'bsReviews']) await db.collection(c).deleteMany({ cid }); await db.collection('bsCustomers').deleteOne({ _id: cid })
  } catch (e) { fail++; console.log('❌ exception', e.message) }
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})()
