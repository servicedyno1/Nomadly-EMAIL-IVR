// Bot Bulk IVR paste: "Name 5619298395" / "15713310731 - Name" lines, long pastes split by Telegram into several messages,
// and the "Add +1" offer for numbers without a country code. Needs the nodejs service on :5000.
// Run: cd /app && node js/tests/test_bot_bulkivr_paste.js
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), fs = require('fs')
const { MongoClient } = require('mongodb')
const CHAT = 990000178, LOG = '/var/log/supervisor/nodejs.out.log'
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const post = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + Math.floor(Math.random() * 1000), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } })
const outs = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`))
let pass = 0, fail = 0
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${n}${x ? ` — ${x}` : ''}`) }
const names = ['Lynn Melso', 'Carol Wood', 'Lucretia Durden', 'Nenita Quiros', 'Jean Peiffer', 'William Teears']
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const st = () => db.collection('state').findOne({ _id: String(CHAT) })
  const reset = () => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkUploadLeads', userLanguage: 'en', bulkData: { callerId: '+14155551001', provider: 'telnyx' } } }, { upsert: true })

  // 1) 11-digit "1XXXXXXXXXX - Name", sent as 3 messages a moment apart (Telegram split)
  await reset()
  const lines = Array.from({ length: 300 }, (_, i) => `1${['561', '989', '216'][i % 3]}${String(2000000 + i * 7).padStart(7, '0')} - ${names[i % 6]} ${i}`)
  let n0 = outs().length
  for (let p = 0; p < 3; p++) { post(lines.slice(p * 130, p * 130 + 130).join('\n')); await wait(250) }
  await wait(3500)
  let o = outs().slice(n0)
  const s1 = await st()
  ok(o.length === 1, 'a paste split into 3 messages gets ONE reply', `${o.length} replies`)
  ok(s1.action === 'bulkSelectAudio' && s1.bulkData.leads.length === 300, "11-digit numbers with names: all 300 read", `${s1.action} ${s1.bulkData?.leads?.length}`)
  ok(s1.bulkData.leads[0].name === 'Lynn Melso 0' && s1.bulkData.leads[0].number.startsWith('+1561'), 'name and number split correctly', JSON.stringify(s1.bulkData.leads[0]))

  // 2) "Name 5619298395" (no country code) → asks to add +1
  await reset()
  n0 = outs().length
  await post(names.map((nm, i) => `${nm} ${['5619298395', '9893975355', '2162782261', '9518509442', '7178777097', '9544789273'][i]}`).join('\n')); await wait(3000)
  o = outs().slice(n0).join('\n')
  ok(/look like USA\/Canada numbers/.test(o) && o.includes('Add +1 (USA/Canada)'), 'no country code → offers "Add +1"', o.slice(0, 200))
  ok(!/No valid phone numbers found/.test(o), 'no "no phone column" error any more')
  n0 = outs().length
  await post('🇺🇸 Add +1 (USA/Canada)'); await wait(3000)
  const s2 = await st()
  ok(s2.action === 'bulkSelectAudio' && s2.bulkData.leads.length === 6 && s2.bulkData.leads[0].number === '+15619298395' && s2.bulkData.leads[0].name === 'Lynn Melso', 'after "Add +1" all 6 numbers are read with names', JSON.stringify(s2.bulkData?.leads?.[0]))
  ok(!s2.bulkData.pendingLeads, 'pending paste cleared')

  // 3) mixed: some with +1, some without → can continue without them
  await reset()
  await post('+15619298395 Ann\nBob 9893975355\nCy 2162782261'); await wait(3000)
  n0 = outs().length
  await post('➡️ Continue without them'); await wait(3000)
  const s3 = await st()
  ok(s3.action === 'bulkSelectAudio' && s3.bulkData.leads.length === 1, '"Continue without them" keeps only the numbers that had a country code', `${s3.action} ${s3.bulkData?.leads?.length}`)

  // 4) non-US no-code numbers → no +1 offer, clear error as before
  await reset()
  n0 = outs().length
  await post('Ann 07911123456\nBob 07911123457'); await wait(3000)
  o = outs().slice(n0).join('\n')
  ok(!o.includes('Add +1') && /no country code/.test(o), 'UK-style numbers → no +1 offer, explains the missing country code')

  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
