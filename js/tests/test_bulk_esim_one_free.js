// "Send one SMS": opt-out line is the sender's choice, 2 free per user, then the button is hidden.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('../../scripts/lib/tg_sim')
const { btn } = require('../bulk-esim/i18n')
const CHAT = '990000204', L = btn('en')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const bdb = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME), M = bdb.collection('bsMessages')
  const cid = `Nomadly:${CHAT}`
  await M.deleteMany({ cid })
  const CF = bdb.collection('bsConfig'), prevFree = (await CF.findOne({ _id: 'settings' }))?.values?.freeOneSends
  await CF.updateOne({ _id: 'settings' }, { $set: { 'values.freeOneSends': 2 } }, { upsert: true }) // legacy 2-free mode (default is now unlimited + abuse guard)
  const E = bdb.collection('bsEsims'), seeded = !(await E.findOne({ role: 'tester', status: 'available', health: 'healthy' }))
  if (seeded) await E.insertOne({ _id: 'ESIM-QA-ONE', role: 'tester', status: 'available', health: 'healthy', msisdn: '+15550001234', account: null, stats: {}, createdAt: new Date() })
  await db.collection('state').replaceOne({ _id: CHAT }, { _id: CHAT, action: 'bse-home', userLanguage: 'en', history: [] }, { upsert: true })
  await bdb.collection('bsCustomers').updateOne({ _id: cid }, { $set: { status: 'active' }, $setOnInsert: { brand: 'Nomadly', chatId: CHAT, createdAt: new Date() } }, { upsert: true })
  const sim = makeSim(CHAT), say = async (v) => { const r = await sim.step({ kind: 'text', v }); return { out: r.msgs.map(m => strip(m.text)).join('\n'), kb: r.msgs.flatMap(m => (m.reply_markup?.keyboard || m.kb || []).flat()).map(String) } }
  const one = async (opt, text) => { await say(L.one); const a = await say('+14155550100'); const b = await say(opt ? L.one_opt_yes : L.one_opt_no); const c = await say(text); return { a, b, c } }
  const r1 = await one(false, 'hello plain')
  ok(/opt out/i.test(r1.a.out), 'after the number, the opt-out choice is asked', r1.a.out.slice(0, 80))
  ok(/Your text:/.test(r1.b.out) && !/is added/.test(r1.b.out), 'no opt-out → prompt says nothing is added')
  const m1 = await M.findOne({ cid, body: /hello plain/ })
  ok(m1 && m1.body === 'hello plain', 'no opt-out → text sent exactly as typed', m1?.body)
  ok(/1 free single text left/.test(r1.c.out), 'tells how many free single texts are left', r1.c.out.slice(0, 90))
  const r2 = await one(true, 'hello with stop')
  const m2 = await M.findOne({ cid, body: /hello with stop/ })
  ok(m2 && /Reply STOP to opt out/.test(m2.body), 'opt-out → line added', m2?.body)
  ok(/last free single text/.test(r2.c.out), 'second text says it was the last free one')
  ok(!r2.c.kb.includes(L.one), '"Send one SMS" disappears after 2', JSON.stringify(r2.c.kb))
  const r3 = await say(L.one)
  ok(/used your 2 free single texts/.test(r3.out), 'a third try is refused with a clear message', r3.out.slice(0, 90))
  await bdb.collection('bsCustomers').deleteOne({ _id: cid }); await M.deleteMany({ cid }); if (seeded) await E.deleteOne({ _id: 'ESIM-QA-ONE' }); await db.collection('state').deleteOne({ _id: CHAT })
  await CF.updateOne({ _id: 'settings' }, prevFree === undefined ? { $unset: { 'values.freeOneSends': 1 } } : { $set: { 'values.freeOneSends': prevFree } }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
