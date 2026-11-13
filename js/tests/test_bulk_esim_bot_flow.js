// Full English wizard through the live webhook: numbers → message → guided test ("Did it arrive?") → schedule → shared checkout (wallet).
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), L = require('../bulk-esim/i18n').btn('en')
const CHAT = 990000111, sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0, pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const tg = async (text) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 1000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }); await sleep(1200) }
const until = async (get, want) => { for (let i = 0; i < 50; i++) { const a = await get(); if (a === want) return a; await sleep(500) } return get() }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  if (!(await B.ready()).send || !(await B.ready()).test) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() } // other suites leave the shared preview DB with test-only lines
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}, cid = B.cidOf(BOT.brand(), CHAT)
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10), hour = (await B.availability(day)).slots.find(s => s.free >= 600)?.hour
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'none' } }, { upsert: true })
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
  const steps = [[L.home, 'bse-home'], [L.newc, 'bse-contacts'], [Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n'), 'bse-consent'], [L.agree, 'bse-content'], ['x'.repeat(139), 'bse-content'], ['Hi from QA\n---\nHello from QA', 'bse-review'], [L.use_these, 'bse-test'],
    [L.test, 'bse-test-to'], ['+13104567890', 'bse-test-check'], [L.arrived_no, 'bse-test-check'], [async () => { await db.collection('bsMessages').updateMany({ cid, test: true }, { $set: { createdAt: new Date(Date.now() - 3 * 60000) } }); return L.arrived_no }, 'bse-test-check'], [L.test_again, 'bse-test-to'], ['+13104567890', 'bse-test-check'], [L.arrived_yes, 'bse-when'], [L.sched, 'bse-day'], [day, 'bse-hour'], [`${String(hour).padStart(2, '0')}:00 · x`, 'digital-product-pay'],
    [async () => require('../hosting-checkout-ux').strings('en').payWallet((await st()).dpPrice), 'bse-home'], [L.bookings, 'bse-home'], [L.usage, 'bse-home'], [L.back, 'none']]
  for (const [t0, want] of steps) { const text = typeof t0 === 'function' ? await t0() : t0; await tg(text); const a = await until(async () => (await st()).action, want); ok(`${JSON.stringify(String(text).slice(0, 30))} → ${want}`, a === want, a) }
  const bk = await db.collection('bsBookings').findOne({ cid, date: day, status: 'scheduled' }), w = await db.collection('walletOf').findOne({ _id: String(CHAT) }), cp = bk && await db.collection('bsCampaigns').findOne({ _id: bk.campaignId })
  const want = bk?.discountPct ? 45.9 : 51
  ok('booking scheduled, 510 SMS, wallet charged the flat $50/500 price', bk?.volume === 510 && bk?.price === want && w?.usdOut === want, `${bk?.status} ${bk?.volume} $${bk?.price} out ${w?.usdOut}`)
  ok('2 free tests sent, answer "arrived" saved on the campaign', (await db.collection('bsMessages').countDocuments({ cid, test: true })) === 2 && cp?.testArrived === true)
  ok('"No" right away = still on its way; "No" after 2 min = a not-arrived report', (await db.collection('bsReviews').countDocuments({ cid, kind: 'test', arrived: 'no' })) === 1)
  // cleanup (only this chat's records)
  for (const b of await db.collection('bsBookings').find({ cid }).toArray()) await B.cancelBooking(b._id, { by: 'admin' })
  for (const c of ['bsMessages', 'bsBookings', 'bsCampaigns', 'bsDaily', 'bsPayments', 'bsReviews']) await db.collection(c).deleteMany({ cid })
  await db.collection('bsNotify').deleteMany({ chatId: String(CHAT) }); await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('bsDrafts').deleteOne({ _id: cid }); await db.collection('state').deleteOne({ _id: String(CHAT) }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
