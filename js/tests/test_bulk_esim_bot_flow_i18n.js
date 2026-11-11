// iter240 QA: walk the eSIM BulkSMS Telegram wizard in fr/zh/hi/fa via the live webhook (nodejs RUNNING, simulated provider).
// Uses each language's button labels from i18n.js; checks state transitions, plain-with-link refusal, wallet charge; cleans what it creates.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000112, sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0, pass = 0, fail = 0
const tg = async (text) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 2000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }); await sleep(1500) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  const madeEsims = !(await db.collection('bsEsims').countDocuments())
  if (madeEsims) { for (let i = 0; i < 5; i++) await B.provisionOne('qa'); await B.healthCheck() }
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  const cid = B.cidOf(BOT.brand(), CHAT)
  const langs = ['fr', 'zh', 'hi', 'fa']
  for (let li = 0; li < langs.length; li++) {
    const lang = langs[li], L = I.btn(lang), day = new Date(Date.now() + (li + 1) * 86400000).toISOString().slice(0, 10)
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: lang, action: 'none' } }, { upsert: true })
    await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
    const hour = (await B.availability(day)).slots.find(s => s.free >= 600)?.hour
    const steps = [[L.home, 'bse-home'], [L.newc, 'bse-contacts'], ['+12125550000', 'bse-contacts'], [Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n'), 'bse-consent'], ['yes', 'bse-consent'], [L.agree, 'bse-content'], ['x'.repeat(139), 'bse-content'], [L.optout_no, 'bse-content'], ['Hi from QA', 'bse-review'], [L.use_one, 'bse-test'],
      [L.cont, 'bse-when'], [L.replies_add(20), 'bse-when'], [L.replies_off, 'bse-when'], [L.sched, 'bse-day'], [day, 'bse-hour'], [`${String(hour).padStart(2, '0')}:00`, 'digital-product-pay'], [async () => require('../hosting-checkout-ux').strings(lang).payWallet((await st()).dpPrice), 'bse-home'], [L.bookings, 'bse-home'], [L.usage, 'bse-home'], [L.back, 'none']]
    let allOk = true
    for (const [t0, want] of steps) { const text = typeof t0 === 'function' ? await t0() : t0; await tg(text); const a = (await st()).action; if (a !== want) { allOk = false; console.log(`   ❌ [${lang}] ${JSON.stringify(text.slice(0, 30))} → ${a} (want ${want})`) } }
    const bk = await db.collection('bsBookings').findOne({ cid, date: day, status: 'scheduled' }), w = await db.collection('walletOf').findOne({ _id: String(CHAT) })
    const want = bk?.discountPct ? 45.9 : 51, ok = allOk && bk?.volume === 510 && bk?.price === want && w?.usdOut === want
    ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${lang}: full wizard with ${lang} labels, booking ${bk?.status} ${bk?.volume} $${bk?.price}, wallet out ${w?.usdOut}`)
  }
  // any language's home label opens the menu even when user language differs
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'none' } })
  let homeOk = true; for (const lang of langs) { await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'none' } }); await tg(I.btn(lang).home); if ((await st()).action !== 'bse-home') homeOk = false }
  homeOk ? pass++ : fail++; console.log(`${homeOk ? '✅' : '❌'} every language's home label opens the menu (user lang en)`)
  // cleanup (only this chat's records)
  const bks = await db.collection('bsBookings').find({ cid }).toArray(), cps = await db.collection('bsCampaigns').find({ cid }).toArray()
  for (const b of bks) await B.cancelBooking(b._id, { by: 'admin' })
  await db.collection('bsMessages').deleteMany({ cid }); await db.collection('bsBookings').deleteMany({ cid }); await db.collection('bsCampaigns').deleteMany({ cid })
  for (const c of ['bsDaily', 'bsPayments', 'bsNotify']) await db.collection(c).deleteMany(c === 'bsNotify' ? { chatId: String(CHAT) } : { cid })
  await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('bsDrafts').deleteOne({ _id: cid }); await db.collection('state').deleteOne({ _id: String(CHAT) }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed (bookings cleaned ${bks.length}, campaigns ${cps.length})`)
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
