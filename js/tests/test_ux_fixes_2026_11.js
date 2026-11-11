// Prod-log UX fixes: old BulkSMS app button → new BulkSMS, home FAQ, support chase → human, eSIM instant delivery (no IMEI pre-pay).
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000120, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
const outs = (n = 4) => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).slice(-n).join('\n')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const st = async (o) => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: o }, { upsert: true })
  await st({ action: 'none', userLanguage: 'en' })
  await tg('📱🆓 BulkSMS — 100 Free SMS')
  let s = await db.collection('state').findOne({ _id: String(CHAT) })
  ok(s.action === 'bse-home' && !/Android|100 Free/.test(outs(2)), `old "100 Free SMS" button opens the new simless BulkSMS (action=${s.action})`)
  ok(/can’t pick one/.test(outs(2)), 'BulkSMS home answers "can I pick the sender / send more per day"')
  await st({ action: 'none', userLanguage: 'en' }); await tg('📱 USA eSIM')
  const e = outs(2)
  ok(/Instant delivery/.test(e) && !/IMEI|\*#06#/.test(e), 'eSIM intro shows instant delivery and no IMEI before payment')
  await st({ action: 'none', userLanguage: 'fr' }); await tg('📱 eSIM USA')
  ok(/Livraison instantanée/.test(outs(2)) && !/IMEI/.test(outs(2)), 'fr: eSIM intro instant delivery, no IMEI')
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
