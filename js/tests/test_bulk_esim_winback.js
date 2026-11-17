// Win-back: paid users quiet 7+ days get 2 free single texts (valid 14 days, at most every 30 days); $20 minimum still applies.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('../../scripts/lib/tg_sim')
const { btn } = require('../bulk-esim/i18n')
const B = require('../bulk-esim/core')
const CHAT = '990000388', QUIET2 = '990000389', L = btn('en'), DAY = 86400000
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const bdb = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME), M = bdb.collection('bsMessages'), W = db.collection('walletOf'), CU = bdb.collection('bsCustomers')
  B.init({ db: bdb, log: () => {}, notifyAdmin: () => {} })
  const cid = `Nomadly:${CHAT}`, cid2 = `Nomadly:${QUIET2}`
  for (const c of [cid, cid2]) { await M.deleteMany({ cid: c }); await CU.deleteOne({ _id: c }) }
  const old = new Date(Date.now() - 8 * DAY)
  await CU.insertOne({ _id: cid, brand: 'Nomadly', chatId: CHAT, status: 'active', smsPaid: true, createdAt: old })
  await CU.insertOne({ _id: cid2, brand: 'Nomadly', chatId: QUIET2, status: 'active', smsPaid: true, createdAt: old })
  await M.insertOne({ _id: `wb_old_${CHAT}`, cid, to: '+14155550160', direction: 'out', status: 'sent', createdAt: old })
  await M.insertOne({ _id: `wb_new_${QUIET2}`, cid: cid2, to: '+14155550161', direction: 'out', status: 'sent', createdAt: new Date(Date.now() - 2 * DAY) })

  const due = await B.dueWinbacks('Nomadly')
  ok(due.some(d => d.cid === cid && d.texts === 2 && d.days === 14), 'quiet 8 days → offered 2 free texts for 14 days')
  ok(!due.some(d => d.cid === cid2), 'sent 2 days ago → not offered')
  ok(!(await B.dueWinbacks('Nomadly')).some(d => d.cid === cid), 'not offered twice within 30 days')
  await CU.updateOne({ _id: cid }, { $set: { winbackAt: new Date(Date.now() - 31 * DAY) } })
  ok((await B.dueWinbacks('Nomadly')).some(d => d.cid === cid), 'offered again after 30 days')

  // Free sends through the bot
  const E = bdb.collection('bsEsims'), seeded = !(await E.findOne({ role: 'tester', status: 'available', health: 'healthy' }))
  if (seeded) await E.insertOne({ _id: 'ESIM-QA-WB', role: 'tester', status: 'available', health: 'healthy', msisdn: '+15550001288', account: null, stats: {}, createdAt: new Date() })
  await db.collection('state').replaceOne({ _id: CHAT }, { _id: CHAT, action: 'bse-home', userLanguage: 'en', history: [] }, { upsert: true })
  await W.replaceOne({ _id: CHAT }, { _id: CHAT, usdIn: 25, usdOut: 0 }, { upsert: true })
  const sim = makeSim(CHAT), say = async (v) => { const r = await sim.step({ kind: 'text', v }); return r.msgs.map(m => strip(m.text)).join('\n') }
  const one = async (to, text) => { await say(L.one); await say(to); await say(L.one_opt_no); return say(text) }
  const bal = async () => { const w = await W.findOne({ _id: CHAT }); return (w.usdIn || 0) - (w.usdOut || 0) }
  const a = await one('+14155550171', 'winback one')
  ok(/Free text · 1 free left · balance \$25/.test(a) && await bal() === 25, '1st send is free, receipt shows 1 left', a.slice(-70))
  const b = await one('+14155550172', 'winback two')
  ok(/Free text · 0 free left/.test(b) && await bal() === 25, '2nd send is free too')
  const c = await one('+14155550173', 'winback three')
  ok(/\$1 charged · balance \$24/.test(c), 'after the 2 free texts, normal $1 charge resumes', c.slice(-60))
  await CU.updateOne({ _id: cid }, { $set: { winback: { left: 2, expiresAt: new Date(Date.now() - 1000) } } })
  const d = await one('+14155550174', 'winback expired')
  ok(/\$1 charged/.test(d), 'expired offer → charged normally')
  await CU.updateOne({ _id: cid }, { $set: { winback: { left: 2, expiresAt: new Date(Date.now() + DAY) } } }); await W.updateOne({ _id: CHAT }, { $set: { usdIn: 10, usdOut: 0 } })
  const e = await one('+14155550175', 'winback low bal')
  ok(/needs at least \$20/.test(e) && (await CU.findOne({ _id: cid })).winback.left === 2, 'under $20 → still blocked, free texts kept')

  for (const c2 of [cid, cid2]) { await M.deleteMany({ cid: c2 }); await CU.deleteOne({ _id: c2 }) }
  if (seeded) await E.deleteOne({ _id: 'ESIM-QA-WB' }); await db.collection('state').deleteOne({ _id: CHAT }); await W.deleteOne({ _id: CHAT }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
