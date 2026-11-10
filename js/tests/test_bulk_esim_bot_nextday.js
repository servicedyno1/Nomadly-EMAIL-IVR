// Bot flow: the day the customer picks is full → bot offers the next day with room as a one-tap button → tapping it continues to the hour list.
// Run from /app with the nodejs service RUNNING: node js/tests/test_bulk_esim_bot_nextday.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
const CHAT = 990000222, sleep = (ms) => new Promise(r => setTimeout(r, ms)), d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
let n = 0, pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const tg = async (text) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 2000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }); await sleep(1800) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  for (const c of ['bsBookings', 'bsDemand', 'bsEsims', 'bsEsimDaily', 'bsTests', 'bsMessages', 'bsDaily', 'bsCampaigns']) await db.collection(c).deleteMany({})
  await db.collection('bsConfig').deleteMany({ _id: { $in: ['settings', 'esimSeq'] } })
  await B.setConfig({ autoProvision: false, manualApproval: true, testerEsims: 0, monitorEsims: 0, quietStart: 0, quietEnd: 24 }, 'qa')
  for (let i = 0; i < 2; i++) await B.provisionOne('qa'); await B.healthCheck()
  const brand = require('../bulk-esim/bot').brand(), other = await B.customer(brand, '990000333')
  const filler = await B.createBooking(other._id, { date: d(1), hour: 10, volume: 600 }); await B.confirmBooking(filler.booking._id, {})
  ok('tomorrow is filled by another customer (640/day, 600 booked)', (await B.availability(d(1))).dayFree === 40)
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'none' } }, { upsert: true })
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
  const steps = [['🛰 eSIM BulkSMS (USA/Canada)', 'bse-home'], ['📤 New campaign', 'bse-name'], ['QA next day', 'bse-type'], ['📝 Text only', 'bse-optout'], ['✅ Add “Reply STOP to opt out”', 'bse-content'], ['Hi from QA', 'bse-variants'], ['➡️ Keep my text only', 'bse-contacts'],
    [Array.from({ length: 510 }, (_, i) => `+1212555${6000 + i}`).join('\n'), 'bse-consent'], ['✅ Yes, they all agreed', 'bse-test'], ['➡️ Continue to booking', 'bse-replies'], ['🚫 No replies', 'bse-when'], ['📅 Schedule (cheaper)', 'bse-day']]
  for (const [text, want] of steps) { await tg(text); const a = (await st()).action; ok(`"${text.slice(0, 28)}" → ${want}`, a === want, a) }
  await tg(d(1))
  ok('full day → stays on the day step', (await st()).action === 'bse-day')
  await tg(d(2))
  ok('tapping the offered next day → hour list', (await st()).action === 'bse-hour' && (await st()).bseDay === d(2), (await st()).action)
  console.log(`\n${pass} passed, ${fail} failed`)
  await db.collection('bsBookings').deleteMany({}); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
