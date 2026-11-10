// Booking → the shared one-screen invoice (wallet + crypto coins) opens directly; Back returns to BulkSMS home.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot')
const CHAT = 990000112
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME); await B.init({ db, log: () => {} })
  if (!(await db.collection('bsEsims').countDocuments({ status: 'available' }))) { await B.setConfig({ monitorEsims: 0, testerEsims: 0 }, 'test'); for (let i = 0; i < 5; i++) await B.provisionOne('qa'); await B.healthCheck() }
  await B.creditWatch()
  const cid = B.cidOf(BOT.brand(), CHAT); await B.customer(BOT.brand(), String(CHAT))
  const cp = (await B.createCampaign(cid, { name: 'Direct', content: 'x', consent: true, contacts: Array.from({ length: 500 }, (_, i) => `+1212555${4000 + i}`) })).campaign
  let date, hour
  for (let dd = 1; dd <= 10 && hour == null; dd++) { date = new Date(Date.now() + dd * 86400000).toISOString().slice(0, 10); hour = (await B.availability(date)).slots.find(x => x.free >= 500)?.hour }
  if (hour == null) throw new Error('no free 500-SMS slot in the next 10 days (preview pool)')
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bse-hour', bseDay: date, bseCampaign: cp._id, userLanguage: 'en' } }, { upsert: true })
  await tg(`${String(hour).padStart(2, '0')}:00`)
  let s = await db.collection('state').findOne({ _id: String(CHAT) })
  ok(s.action === 'digital-product-pay', `booking opens the shared invoice directly (action=${s.action})`)
  ok(s.dpProductKey === BOT.PRODUCT_KEY && s.dpPrice > 0 && !!s.bseBookingId, `invoice carries the BulkSMS booking ($${s.dpPrice})`)
  ok(/Booking/.test(s.bseSummary || '') && !/wallet \$/.test(s.bseSummary || ''), 'invoice shows the booking summary once (balance shown by the invoice footer)')
  await tg('↩️ Back')
  s = await db.collection('state').findOne({ _id: String(CHAT) })
  ok(s.action === 'bse-home', `Back returns to BulkSMS home (action=${s.action})`)
  await cl.close(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
