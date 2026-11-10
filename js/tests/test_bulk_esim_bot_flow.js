require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
const CHAT = 990000111, sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0
const tg = async (msg) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 1000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), ...msg } }); await sleep(1800) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  if (!(await db.collection('bsEsims').countDocuments())) { for (let i = 0; i < 5; i++) await B.provisionOne('qa'); await B.healthCheck() }
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'none' } }, { upsert: true })
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
  const steps = [['🛰 eSIM BulkSMS (USA/Canada)', 'bse-home'], ['📤 New campaign', 'bse-contacts'], [Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n'), 'bse-consent'], ['✅ Yes, they all agreed', 'bse-content'], ['x'.repeat(139), 'bse-content'], ['Hi from QA\n---\nHello from QA', 'bse-review'], ['✅ Use these versions', 'bse-test'],
    ['🧪 Send a test SMS', 'bse-test-add'], ['+12125550999', 'bse-test-code'], ['<CODE>', 'bse-test-to'], ['+12125550999', 'bse-test'], ['➡️ Continue: choose when', 'bse-when'], ['📅 Schedule (cheaper)', 'bse-day'],
    [new Date(Date.now() + 86400000).toISOString().slice(0, 10), 'bse-hour'], ['18:00 · x free', 'bse-pay'], ['💰 Pay from wallet', 'bse-home'], ['📅 My bookings', 'bse-home'], ['📊 Daily usage', 'bse-home']]
  const cidQ = `${require('../bulk-esim/bot').brand()}:${CHAT}`; await db.collection('bsCustomers').updateOne({ _id: cidQ }, { $unset: { testNumbers: 1, testVerify: 1 } })
  for (let [text, want] of steps) { if (text === '<CODE>') text = (await db.collection('bsCustomers').findOne({ _id: cidQ }))?.testVerify?.code || 'nocode'; await tg({ text }); const a = (await st()).action; console.log(a === want ? '✅' : '❌', JSON.stringify(text.slice(0, 30)), '→', a) }
  const bk = await db.collection('bsBookings').findOne({ cid: `${require('../bulk-esim/bot').brand()}:${CHAT}` })
  console.log('test charge', (await db.collection('bsCampaigns').findOne({ _id: bk?.campaignId }))?.testCharges, 'refund notice', await db.collection('bsNotify').countDocuments({ key: 'n_test_refund', chatId: String(CHAT) }))
  console.log('booking', bk?.status, bk?.volume, bk?.price, 'wallet out', (await db.collection('walletOf').findOne({ _id: String(CHAT) }))?.usdOut)
  console.log('queued', await db.collection('bsMessages').countDocuments({ bookingId: bk?._id }), 'test msgs', await db.collection('bsMessages').countDocuments({ test: true, cid: bk?.cid }))
  await cl.close(); process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
