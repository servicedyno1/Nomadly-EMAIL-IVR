// New main-menu BulkSMS button opens eSIM BulkSMS; a one-time intro (free test rule + next-day discount); old labels still work.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios'), { MongoClient } = require('mongodb')
const CHAT = 990000777
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), S = db.collection('state')
  await S.deleteOne({ _id: String(CHAT) }); await S.insertOne({ _id: String(CHAT), userLanguage: 'en', action: 'none' })
  const tg = async (text) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'QA' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).catch(() => {}); await new Promise(r => setTimeout(r, 2200)); return S.findOne({ _id: String(CHAT) }) }
  const en = require('../lang/en.js'), u = en.en?.user || en.user
  ok('main keyboard label', u?.bulkSmsNew === '📲 BulkSMS 🇺🇸🇨🇦', u?.bulkSmsNew)
  let s = await tg('📲 BulkSMS 🇺🇸🇨🇦')
  ok('new button opens eSIM BulkSMS home + intro shown once', s.action === 'bse-home' && !!s.bseIntroAt, JSON.stringify([s.action, s.bseIntroAt]))
  const first = s.bseIntroAt; await tg('↩️ Back'); s = await tg('📲 BulkSMS 🇺🇸🇨🇦')
  ok('second open: no new intro', s.action === 'bse-home' && s.bseIntroAt === first)
  await tg('↩️ Back'); s = await tg('🛰 eSIM BulkSMS (USA/Canada)')
  ok('old label on older keyboards still opens it', s.action === 'bse-home')
  await S.updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'fa', action: 'none' } }); s = await tg('📲 پیامک انبوه 🇺🇸🇨🇦')
  ok('fa label works', s.action === 'bse-home')
  await S.deleteOne({ _id: String(CHAT) }); await db.collection('bsCustomers').deleteMany({ _id: { $regex: String(CHAT) } })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
