// Bulk IVR (bot): rejected lines summed up in the user's language + "Schedule for later" localized with the auto-notify line.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000115, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).slice(-3).join('\n')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const set = (o) => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: o }, { upsert: true })
  for (const [lang, word, sched] of [['en', 'Which country are they from', 'automatically when it starts'], ['fr', 'De quel pays viennent-ils', 'automatiquement un message']]) {
    await set({ action: 'bulkUploadLeads', userLanguage: lang, bulkData: { callerId: '+13346972125', provider: 'telnyx', callerType: 'owned' } })
    await tg('+14155550100\n4155550101\n4155550102')
    const out = lastOut()
    ok(out.includes(word) && out.includes('4155550101') && (lang === 'en' || out.includes('Autre pays')), `${lang}: numbers without country code → country picker in ${lang}`)
    await set({ action: 'bulkUploadLeads', userLanguage: lang, bulkData: { callerId: '+13346972125' } })
    await tg('4155550101')
    ok(lastOut().includes(word), `${lang}: all-countryless list → country picker in ${lang}`)
    await set({ action: 'bulkConfirm', userLanguage: lang, bulkData: { callerId: '+13346972125', audioUrl: 'https://x/a.mp3', leads: [{ number: '+14155550100' }] } })
    await tg('⏰ Schedule for later')
    ok((await db.collection('state').findOne({ _id: String(CHAT) })).action === 'bulkScheduleTime' && lastOut().includes(sched), `${lang}: schedule prompt says start/finish are messaged automatically`)
  }
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
