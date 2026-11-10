// Bot "Rotate caller IDs" works from its translated label (fr/zh/hi/fa) and replies in the user's language.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000113, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2000)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).pop() || ''
const L = { fr: ['🔁 Alterner les ID appelant', 'Alterner les ID appelant', '✅ Terminé'], zh: ['🔁 轮换来电显示', '轮换来电显示', '✅ 完成'], hi: ['🔁 कॉलर ID बदलते रहें', 'कॉलर ID बदलते रहें', '✅ हो गया'], fa: ['🔁 چرخش شناسه‌های تماس‌گیرنده', 'چرخش شناسه‌های تماس‌گیرنده', '✅ انجام شد'] }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const [lang, [btn, title, done]] of Object.entries(L)) {
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkUploadLeads', userLanguage: lang, bulkData: { callerId: '+13346972125', provider: 'telnyx', callerType: 'owned' }, bulkCallerIds: [{ phoneNumber: '+13346972125' }, { phoneNumber: '+18037534921' }] } }, { upsert: true })
    await tg(btn)
    let s = await db.collection('state').findOne({ _id: String(CHAT) }), out = lastOut()
    ok(s.action === 'bulkRotateCids' && out.includes(title) && out.includes(done), `${lang}: translated button opens the picker in ${lang}`)
    await tg('➕ +18037534921')
    s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok((s.bulkData.callerPool || []).length === 1, `${lang}: tapping a number adds it to the rotation`)
    await tg(done)
    s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok(s.action === 'bulkUploadLeads' && lastOut().includes(btn), `${lang}: Done returns to the upload step with the translated button`)
  }
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
