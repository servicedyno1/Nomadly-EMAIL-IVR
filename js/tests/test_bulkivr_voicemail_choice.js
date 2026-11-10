// Bot Bulk IVR "When voicemail answers": Leave my message (first, recommended) uses the campaign audio; Hang up clears it; localized.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000116, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).pop() || ''
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const st = () => db.collection('state').findOne({ _id: String(CHAT) })
  const base = { callerId: '+13346972125', provider: 'telnyx', audioUrl: 'https://x/main.mp3', audioName: 'Spring promo', leads: [{ number: '+14155550100' }] }
  for (const [lang, leave, hang, title] of [['en', '📩 Leave my message (recommended)', '📵 Hang up (no message)', 'When voicemail answers'], ['fr', '📩 Laisser mon message (conseillé)', '📵 Raccrocher (aucun message)', 'Si la messagerie répond']]) {
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkSetConcurrency', userLanguage: lang, bulkData: base } }, { upsert: true })
    await tg('5')
    let o = lastOut()
    ok((await st()).action === 'bulkSelectVoicemail' && o.includes(title) && o.indexOf(leave) > -1 && o.indexOf(leave) < o.indexOf(hang) && o.includes('Spring promo'), `${lang}: voicemail question shown, "Leave my message" first, names the campaign audio`)
    await tg(leave)
    let s = await st()
    ok(s.action === 'bulkConfirm' && s.bulkData.voicemailAudioUrl === base.audioUrl && s.bulkData.voicemailAudioName === 'Spring promo', `${lang}: Leave my message → campaign audio left on voicemail`)
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkSelectVoicemail' } })
    await tg(hang); s = await st()
    ok(s.action === 'bulkConfirm' && !s.bulkData.voicemailAudioUrl, `${lang}: Hang up → nothing left`)
  }
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
