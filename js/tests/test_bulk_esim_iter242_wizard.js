// iter242: Telegram wizard over HTTP (preview app :5000) — opt-out choice, one-SMS limit, replies (+$20), send now vs schedule (−10%).
// Run from /app: node js/tests/test_bulk_esim_iter242_wizard.js   (second run uses ONE real Claude call for AI variants)
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot')
const CHAT = 990000333, sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0, pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const tg = async (text, wait = 1800) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 3000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }); await sleep(wait) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  const cid = B.cidOf(BOT.brand(), CHAT), had = await db.collection('bsConfig').findOne({ _id: 'settings' })
  await B.setConfig({ quietStart: 0, quietEnd: 24, monitorEsims: 0, testerEsims: 0, scheduleDiscountPct: 10 }, 'qa-iter242')
  if ((await db.collection('bsEsims').countDocuments({ status: 'available', role: 'service' })) < 3) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); await B.healthCheck() }
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'none' } }, { upsert: true })
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 200, usdOut: 0 } }, { upsert: true })
  const contacts = (from) => Array.from({ length: 510 }, (_, i) => `+1212555${String(from + i).padStart(4, '0')}`).join('\n')
  const walk = async (label, steps) => { for (const [text, want, wait] of steps) { await tg(text, wait); const a = (await st()).action; ok(`${label}: ${JSON.stringify(String(text).slice(0, 28))} → ${want}`, a === want, a) } }

  // Run 1: text only, no opt-out, 161 refused / 160 ok, keep text, replies yes, send now → $71
  await walk('run1', [['🛰 eSIM BulkSMS (USA/Canada)', 'bse-home'], ['📤 New campaign', 'bse-name'], ['TEST_iter242 now', 'bse-type'], ['📝 Text only', 'bse-optout'], ['✖️ No opt-out line', 'bse-content'],
    ['a'.repeat(161), 'bse-content'], ['a'.repeat(160), 'bse-variants'], ['➡️ Keep my text only', 'bse-contacts'], [contacts(4000), 'bse-consent', 2500], ['✅ Yes, they all agreed', 'bse-test', 2500],
    ['➡️ Continue to booking', 'bse-replies'], ['💬 Yes, route replies to me (+$20)', 'bse-when'], ['🚀 Send now', 'bse-pay']])
  const s1 = await st(), b1 = await db.collection('bsBookings').findOne({ _id: s1.bseBookingId }), cp1 = await db.collection('bsCampaigns').findOne({ _id: s1.bseCampaign })
  ok('run1 campaign optOut=false replies=true content 160 chars', cp1?.optOut === false && cp1.replies === true && cp1.content[0].length === 160, JSON.stringify([cp1?.optOut, cp1?.replies]))
  ok('run1 booking mode now, replyFee 20, price 71, no discount', b1?.mode === 'now' && b1.replyFee === 20 && b1.price === 71 && b1.discountPct === 0 && b1.hour === new Date().getUTCHours(), JSON.stringify(b1 && [b1.mode, b1.replyFee, b1.price, b1.discountPct, b1.hour]))
  await walk('run1 pay', [['💰 Pay from wallet', 'bse-home', 3000]])
  const w1 = await db.collection('walletOf').findOne({ _id: String(CHAT) }), b1b = await db.collection('bsBookings').findOne({ _id: b1?._id })
  ok('run1 wallet debited 71, booking scheduled/paid', w1.usdOut === 71 && b1b?.paymentStatus === 'paid', JSON.stringify([w1.usdOut, b1b?.status, b1b?.paymentStatus]))
  const q1 = await db.collection('bsMessages').findOne({ bookingId: b1?._id })
  ok('run1 queued texts have no opt-out line', q1 && q1.body === 'a'.repeat(160), q1?.body?.length)

  // Run 2: text only + opt-out, real AI variants (1 Claude call), pick "1 3", no replies, schedule 2 days ahead → $45.9
  const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await walk('run2', [['🛰 eSIM BulkSMS (USA/Canada)', 'bse-home'], ['📤 New campaign', 'bse-name'], ['TEST_iter242 sched', 'bse-type'], ['📝 Text only', 'bse-optout'], ['✅ Add “Reply STOP to opt out”', 'bse-content'],
    ['a'.repeat(139), 'bse-content'], ['Spring sale at Nomadly: 20% off all eSIM plans this week.', 'bse-variants'], ['✨ 5 AI variants', 'bse-variants-pick', 25000], ['1 3', 'bse-contacts']])
  const s2a = await st()
  ok('run2 content = original + 2 picked AI variants, each fits one SMS w/ opt-out', s2a.bseContent?.length === 3 && s2a.bseContent.every(v => !B.checkContent(v, false, true).error), JSON.stringify(s2a.bseContent))
  const av = await db.collection('bsAiVariants').findOne({ cid }, { sort: { at: -1 } })
  ok('run2 bsAiVariants logged with model claude-opus-5-5', av?.model === 'claude-opus-5-5' && av.variants.length >= 1, JSON.stringify([av?.model, av?.variants?.length, av?.raw?.length]))
  await walk('run2b', [[contacts(6000), 'bse-consent', 2500], ['✅ Yes, they all agreed', 'bse-test', 2500], ['➡️ Continue to booking', 'bse-replies'], ['🚫 No replies', 'bse-when'], ['📅 Schedule (cheaper)', 'bse-day'], [d2, 'bse-hour', 2500]])
  await walk('run2c', [['12:00 · x free', 'bse-pay', 2500]])
  const s2 = await st(), b2 = await db.collection('bsBookings').findOne({ _id: s2.bseBookingId })
  ok('run2 booking scheduled, 10% off: price 45.9, list 51, unit 0.09, replyFee 0', b2?.mode === 'scheduled' && b2.price === 45.9 && b2.listPrice === 51 && b2.unitPrice === 0.09 && b2.replyFee === 0 && b2.discountPct === 10, JSON.stringify(b2 && [b2.mode, b2.price, b2.listPrice, b2.unitPrice, b2.replyFee, b2.discountPct]))
  await tg('🛰 eSIM BulkSMS (USA/Canada)')

  console.log(`\n${pass} passed, ${fail} failed`)
  // cleanup: only this chat's data + restore settings
  const bks = (await db.collection('bsBookings').find({ cid }).toArray()).map(b => b._id)
  await db.collection('bsMessages').deleteMany({ $or: [{ cid }, { bookingId: { $in: bks } }] })
  console.log('cleanup', (await db.collection('bsBookings').deleteMany({ cid })).deletedCount, (await db.collection('bsCampaigns').deleteMany({ cid })).deletedCount)
  for (const c of ['bsDaily', 'bsPayments', 'bsNotify', 'bsAiVariants', 'bsSessions', 'bsDemand']) await db.collection(c).deleteMany({ $or: [{ cid }, { _id: new RegExp(`^${cid}:`) }, { chatId: String(CHAT) }] })
  await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  if (had) await db.collection('bsConfig').replaceOne({ _id: 'settings' }, had); else await db.collection('bsConfig').deleteOne({ _id: 'settings' })
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
