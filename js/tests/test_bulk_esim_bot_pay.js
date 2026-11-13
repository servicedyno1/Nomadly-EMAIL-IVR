require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot')
const CHAT = 990000113
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME); await B.init({ db, log: () => {} })
  if (!(await db.collection('bsEsims').countDocuments({ status: 'available' }))) { await B.setConfig({ monitorEsims: 0, testerEsims: 0 }, 'test'); for (let i = 0; i < 5; i++) await B.provisionOne('qa'); await B.healthCheck() }
  await B.creditWatch()
  const cid = B.cidOf(BOT.brand(), CHAT); await B.customer(BOT.brand(), String(CHAT)); const cr = await B.createCampaign(cid, { name: 'Pay', content: 'x', consent: true, contacts: Array.from({ length: 500 }, (_, i) => `+1212555${3000 + i}`) }), cp = cr.campaign
  if (!cp) throw new Error(`createCampaign: ${JSON.stringify(cr)}`)
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), { slots } = await B.availability(date), hour = slots.find(x => x.free >= 500)?.hour
  const br = await B.createBooking(cid, { date, hour, volume: 500, campaignId: cp._id }), bk = br.booking
  if (!bk) throw new Error(`createBooking: ${JSON.stringify(br)}`)
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bse-pay', bseBookingId: bk._id, userLanguage: 'en' } }, { upsert: true })
  await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: 5, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text: '💳 Pay with crypto / bank' } })
  await new Promise(r => setTimeout(r, 2500))
  const s = await db.collection('state').findOne({ _id: String(CHAT) })
  ok('crypto / bank → shared checkout with the booking price', s.action === 'digital-product-pay' && s.dpProductKey === 'bulk-esim-sms' && s.dpPrice === bk.price, `${s.action} ${s.dpProductKey} ${s.dpPrice}`)
  ok('500 SMS scheduled 2 days ahead = $50 −10% = $45', bk.price === 45, String(bk.price))
  const r = await BOT.paid(CHAT, { bseBookingId: bk._id }, bk.price, 'crypto'); const st = (await db.collection('bsBookings').findOne({ _id: bk._id })).status
  ok('crypto payment confirms the booking (scheduled)', r.ok && st === 'scheduled', `${r.ok} ${st}`)
  await B.cancelBooking(bk._id, { by: 'admin' }); for (const c of ['bsBookings', 'bsCampaigns', 'bsMessages', 'bsPayments', 'bsDaily']) await db.collection(c).deleteMany({ cid })
  await db.collection('bsNotify').deleteMany({ chatId: String(CHAT) }); await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
