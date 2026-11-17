// Paid single text blocked by a low wallet is saved, then sent by itself once the wallet is topped up (24 h window).
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip, sleep } = require('../../scripts/lib/tg_sim')
const { btn } = require('../bulk-esim/i18n')
const CHAT = '990000399', L = btn('en')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const bdb = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME), M = bdb.collection('bsMessages'), W = db.collection('walletOf'), CU = bdb.collection('bsCustomers')
  const cid = `Nomadly:${CHAT}`
  await M.deleteMany({ cid }); await CU.deleteOne({ _id: cid })
  const E = bdb.collection('bsEsims'), seeded = !(await E.findOne({ role: 'tester', status: 'available', health: 'healthy' }))
  if (seeded) await E.insertOne({ _id: 'ESIM-QA-PEND', role: 'tester', status: 'available', health: 'healthy', msisdn: '+15550001277', account: null, stats: {}, createdAt: new Date() })
  await db.collection('state').replaceOne({ _id: CHAT }, { _id: CHAT, action: 'bse-home', userLanguage: 'en', history: [] }, { upsert: true })
  await CU.insertOne({ _id: cid, brand: 'Nomadly', chatId: CHAT, status: 'active', smsPaid: true, createdAt: new Date() })
  await W.replaceOne({ _id: CHAT }, { _id: CHAT, usdIn: 10, usdOut: 0 }, { upsert: true })
  const sim = makeSim(CHAT), say = async (v) => { const r = await sim.step({ kind: 'text', v }); return r.msgs.map(m => strip(m.text)).join('\n') }
  await say(L.one); await say('+14155550181'); await say(L.one_opt_no)
  const out = await say('saved text please send later')
  ok(/needs at least \$20/.test(out) && /goes out automatically/.test(out), 'low wallet → told the text is saved', out.slice(-90))
  const pt = (await CU.findOne({ _id: cid })).pendingText
  ok(pt?.to === '+14155550181' && pt.message === 'saved text please send later' && new Date(pt.expiresAt) > new Date(Date.now() + 23 * 3600000), 'text saved for 24 hours')
  ok(await M.countDocuments({ cid }) === 0, 'nothing sent yet')

  await sleep(31000)
  ok(!!(await CU.findOne({ _id: cid })).pendingText, 'still waiting while the wallet is under $20')

  await W.updateOne({ _id: CHAT }, { $set: { usdIn: 30 } })
  let sent = false
  for (let i = 0; i < 25 && !sent; i++) { await sleep(2000); sent = !(await CU.findOne({ _id: cid })).pendingText }
  const w = await W.findOne({ _id: CHAT })
  ok(sent && await M.countDocuments({ cid, to: '+14155550181' }) === 1, 'after the top-up the saved text is sent by itself')
  ok((w.usdIn - w.usdOut) === 29, 'charged $1 once', `${w.usdIn - w.usdOut}`)

  await CU.updateOne({ _id: cid }, { $set: { pendingText: { to: '+14155550182', message: 'old', expiresAt: new Date(Date.now() - 1000), savedAt: new Date() } } })
  let gone = false
  for (let i = 0; i < 25 && !gone; i++) { await sleep(2000); gone = !(await CU.findOne({ _id: cid })).pendingText }
  ok(gone && await M.countDocuments({ cid, to: '+14155550182' }) === 0, 'expired after 24 hours → dropped, not sent, not charged')

  await M.deleteMany({ cid }); await CU.deleteOne({ _id: cid }); if (seeded) await E.deleteOne({ _id: 'ESIM-QA-PEND' })
  await db.collection('state').deleteOne({ _id: CHAT }); await W.deleteOne({ _id: CHAT }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
