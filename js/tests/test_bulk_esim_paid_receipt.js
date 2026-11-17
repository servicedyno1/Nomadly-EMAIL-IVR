// Paid single texts: receipt line after each paid send; top-up button once the balance drops below $20; blocked below $20.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('../../scripts/lib/tg_sim')
const { btn } = require('../bulk-esim/i18n')
const CHAT = '990000377', L = btn('en')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const bdb = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME), M = bdb.collection('bsMessages'), W = db.collection('walletOf')
  const cid = `Nomadly:${CHAT}`
  await M.deleteMany({ cid })
  const E = bdb.collection('bsEsims'), seeded = !(await E.findOne({ role: 'tester', status: 'available', health: 'healthy' }))
  if (seeded) await E.insertOne({ _id: 'ESIM-QA-PAID', role: 'tester', status: 'available', health: 'healthy', msisdn: '+15550001299', account: null, stats: {}, createdAt: new Date() })
  await db.collection('state').replaceOne({ _id: CHAT }, { _id: CHAT, action: 'bse-home', userLanguage: 'en', history: [] }, { upsert: true })
  await bdb.collection('bsCustomers').updateOne({ _id: cid }, { $set: { status: 'active', smsPaid: true }, $setOnInsert: { brand: 'Nomadly', chatId: CHAT, createdAt: new Date() } }, { upsert: true })
  await W.replaceOne({ _id: CHAT }, { _id: CHAT, usdIn: 21, usdOut: 0 }, { upsert: true })
  const sim = makeSim(CHAT), say = async (v) => { const r = await sim.step({ kind: 'text', v }); return { out: r.msgs.map(m => strip(m.text)).join('\n'), inline: r.msgs.flatMap(m => m.inline || []).map(b => ({ callback_data: b.d, text: b.t })) } }
  const one = async (to, text) => { await say(L.one); await say(to); await say(L.one_opt_no); return say(text) }
  const bal = async () => { const w = await W.findOne({ _id: CHAT }); return (w.usdIn || 0) - (w.usdOut || 0) }

  const a = await one('+14155550141', 'paid hello one')
  ok(/\$1 charged · balance \$20/.test(a.out), 'receipt shows the charge and remaining balance', a.out.slice(-80))
  ok(!/free single text/.test(a.out), 'no "free texts left" line for paid users')
  ok(!a.inline.some(b => b.callback_data === 'wallet_topup_quick'), 'no top-up button while balance is still $20+')
  ok(await bal() === 20, 'wallet debited $1')

  const b = await one('+14155550142', 'paid hello two')
  ok(/\$1 charged · balance \$19/.test(b.out), 'second receipt: balance $19', b.out.slice(-120))
  ok(b.inline.some(x => x.callback_data === 'wallet_topup_quick') && /Keep at least \$20/.test(b.out), 'below $20 → top-up button + hint', JSON.stringify(b.inline))

  const sentBefore = await M.countDocuments({ cid })
  const c = await one('+14155550143', 'paid hello three')
  ok(/needs at least \$20/.test(c.out) && c.inline.some(x => x.callback_data === 'wallet_topup_quick'), 'under $20 → blocked with top-up button', c.out.slice(0, 100))
  ok(await M.countDocuments({ cid }) === sentBefore && await bal() === 19, 'blocked send: no text, no charge')

  await bdb.collection('bsCustomers').deleteOne({ _id: cid }); await M.deleteMany({ cid }); if (seeded) await E.deleteOne({ _id: 'ESIM-QA-PAID' })
  await db.collection('state').deleteOne({ _id: CHAT }); await W.deleteOne({ _id: CHAT }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
