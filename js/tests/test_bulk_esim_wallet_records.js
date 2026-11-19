// Every BulkSMS wallet movement (wallet payment, validation refund, cancel refund) leaves a billing record the wallet audit matches.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n'), { unexplained } = require('../wallet-audit')
const CHAT = 990000779, L = I.btn('en')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const all = Array.from({ length: 510 }, (_, i) => `+1212555${5000 + i}`)
  await BOT.init({ db, log: () => {}, notifyAdmin: () => {}, sendMessage: async () => {}, validate: async (phones) => phones.slice(0, 350) })
  if (!(await B.ready()).send) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() }
  const cid = B.cidOf(BOT.brand(), CHAT), info = { action: 'none', userLanguage: 'en' }
  const ctx = (message) => ({ chatId: CHAT, msg: { text: message, from: { id: CHAT, first_name: 'Qa' } }, message, info, state: {}, set: async (_s, _c, k, v) => { info[k] = v }, saveInfo: async (k, v) => { info[k] = v }, send: async () => true, goto: { 'digital-product-pay': async () => {}, submenu7: async () => {} }, bot: null })
  const say = (m) => BOT.handle(ctx(m))
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: String(CHAT) }); return (w?.usdIn || 0) - (w?.usdOut || 0) }
  const deltas = [], step = async (fn) => { const a = await bal(); await fn(); const d = Math.round((await bal() - a) * 100) / 100; if (d) deltas.push({ amt: d, at: new Date() }) }
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 200, usdOut: 0 } }, { upsert: true })
  try {
    await say(L.home); await say(L.newc); await say(L.validate_first); await say(all.join('\n'))
    await say(L.agree); await say('Hi from QA audit'); await say(L.use_one); await say(L.test_skip)
    const when = await B.whenOptions(cid, info.bseCampaign); ok('booking options available', !when.error, when.error)
    await say(when.now ? L.now : `${L.later} ${String(when.later.hour).padStart(2, '0')}:00`)
    ok('booking created with validation fee', !!info.bseBookingId && info.dpPrice > 0, `${info.bseBookingId} $${info.dpPrice}`)
    await step(async () => { const r = await BOT.paidFromWallet(CHAT, info, info.dpPrice); ok('wallet payment accepted', r.ok, r.text) })
    await step(() => new Promise(r => setTimeout(r, 3000))) // validation runs in the background → refund
    const b = await db.collection('bsBookings').findOne({ _id: info.bseBookingId })
    ok('validation re-priced the booking', b?.status !== 'awaiting_payment', `${b?.status} $${b?.price}`)
    const fakeBot = { sendMessage: async () => ({}) }
    await step(async () => { const cr = await B.cancelBooking(b._id, { by: 'admin' }); ok('cancel refunded', cr.ok && cr.refunded > 0, JSON.stringify(cr)); BOT.startNotices(fakeBot, db); await new Promise(r => setTimeout(r, 5000)) })
    console.log('   wallet changes:', deltas.map(d => d.amt).join(', '))
    ok('three wallet changes like the alert (pay, validation refund, cancel refund)', deltas.length === 3 && deltas[0].amt < 0 && deltas[1].amt > 0 && deltas[2].amt > 0, JSON.stringify(deltas.map(d => d.amt)))
    const tx = await db.collection('transactions').find({ chatId: String(CHAT), type: /^bulksms-/ }).toArray()
    console.log('   records:', tx.map(t => `${t.type} $${t.amount}`).join(', '))
    const left = unexplained(deltas, tx.map(t => ({ a: Math.abs(Math.round(t.amount * 100) / 100), at: t.createdAt })))
    ok('wallet audit finds no unrecorded change', left.length === 0, JSON.stringify(left))
    ok('net wallet change is zero after cancel', Math.abs(deltas.reduce((s, d) => s + d.amt, 0)) < 0.011)
  } catch (e) { fail++; console.log('❌ exception', e.stack) }
  for (const c of ['bsMessages', 'bsBookings', 'bsCampaigns', 'bsDaily', 'bsPayments', 'bsReviews', 'bsLists']) await db.collection(c).deleteMany({ cid })
  await db.collection('transactions').deleteMany({ chatId: String(CHAT) }); await db.collection('bsNotify').deleteMany({ chatId: String(CHAT) }); await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('bsDrafts').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
