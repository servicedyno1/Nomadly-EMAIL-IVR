// Final Bulk IVR report leads with "📩 N voicemails left" when a voicemail drop was left (user's language).
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const svc = require('../bulk-call-service')
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const sent = []; const bot = { sendMessage: async (id, t) => { sent.push(t); return {} }, sendDocument: async () => ({}) }
  await svc.initBulkCallService(db, bot, null, null, null)
  for (const [lang, chat, word] of [['en', '990000117', '12 voicemails left'], ['fr', '990000118', '12 message(s) vocal(aux)']]) {
    await db.collection('state').updateOne({ _id: chat }, { $set: { userLanguage: lang } }, { upsert: true })
    const _id = `qa_vm_${chat}`
    await db.collection('bulkCallCampaigns').deleteOne({ _id })
    await db.collection('bulkCallCampaigns').insertOne({ _id, id: _id, chatId: chat, status: 'completed', provider: 'telnyx', callerId: '+13346972125', audioName: 'Promo', voicemailAudioUrl: 'https://x/a.mp3', voicemailAudioName: 'Promo', startedAt: new Date(Date.now() - 60000), completedAt: new Date(), leads: [], stats: { total: 40, completed: 40, answered: 10, keyPressed: 2, noAnswer: 10, hungUp: 2, voicemail: 15, voicemailLeft: 12, busy: 1, failed: 0 } })
    sent.length = 0; await svc.sendFinalReport(_id).catch(e => console.log('  err', e.message))
    const first = (sent[0] || '').split('\n').slice(0, 4).join(' | ')
    ok(first.includes(word), `${lang}: report highlights voicemails left near the top — ${first.slice(0, 140)}`)
    await db.collection('bulkCallCampaigns').deleteOne({ _id }); await db.collection('state').deleteOne({ _id: chat })
  }
  await cl.close(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
