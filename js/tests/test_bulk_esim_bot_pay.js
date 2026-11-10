require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot')
const CHAT = 990000111
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME); await B.init({ db, log: () => {} })
  const cid = B.cidOf(BOT.brand(), CHAT), cr = await B.createCampaign(cid, { name: 'Pay', content: 'x', consent: true, contacts: Array.from({ length: 500 }, (_, i) => `+1212555${3000 + i}`) }), cp = cr.campaign
  if (!cp) throw new Error(`createCampaign: ${JSON.stringify(cr)}`)
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), { slots } = await B.availability(date), hour = slots.find(x => x.free >= 500)?.hour
  const br = await B.createBooking(cid, { date, hour, volume: 500, campaignId: cp._id }), bk = br.booking
  if (!bk) throw new Error(`createBooking: ${JSON.stringify(br)}`)
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bse-pay', bseBookingId: bk._id } })
  await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: 5, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text: '💳 Pay with crypto / bank' } })
  await new Promise(r => setTimeout(r, 2500))
  const s = await db.collection('state').findOne({ _id: String(CHAT) })
  console.log('checkout action:', s.action, '| dpProductKey:', s.dpProductKey, '| dpPrice:', s.dpPrice)
  const r = await BOT.paid(CHAT, { bseBookingId: bk._id }, bk.price, 'crypto'); console.log('crypto confirm:', r.ok, (await db.collection('bsBookings').findOne({ _id: bk._id })).status)
  console.log('test msg:', (await db.collection('bsMessages').findOne({ cid, test: true }))?.status, '| notices delivered:', await db.collection('bsNotify').countDocuments({ chatId: String(CHAT), sent: true }), 'pending:', await db.collection('bsNotify').countDocuments({ chatId: String(CHAT), sent: false }))
  await cl.close(); process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
