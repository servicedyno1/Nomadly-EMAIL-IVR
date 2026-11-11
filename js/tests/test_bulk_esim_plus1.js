// BulkSMS bot: numbers without +1 → "Add +1 (USA/Canada)" offer (never silent), names on the line are fine.
// Needs the nodejs service on :5000. Run: cd /app && node js/tests/test_bulk_esim_plus1.js
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), fs = require('fs'), { MongoClient } = require('mongodb')
const CHAT = 990000179, LOG = '/var/log/supervisor/nodejs.out.log', sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 3000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } })
const outs = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`))
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  const reset = () => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'bse-contacts', bseRaw: null } }, { upsert: true })
  const area = ['212', '310', '415', '305', '646']
  const noCc = Array.from({ length: 510 }, (_, i) => `Person ${i} ${area[i % 5]}555${String(1000 + i).padStart(4, '0')}`).join('\n')
  await reset()
  let n0 = outs().length
  await tg(noCc); await sleep(5000)
  let o = outs().slice(n0).join('\n')
  ok(/no country code/.test(o) && o.includes('Add +1 (USA/Canada)') && (await st()).action === 'bse-contacts', '510 numbers without +1 → asks to add +1', o.slice(0, 200))
  n0 = outs().length
  await tg('🇺🇸 Add +1 (USA/Canada)'); await sleep(6000)
  o = outs().slice(n0).join('\n')
  const s1 = await st()
  ok(s1.action === 'bse-consent' && /Added \+1 to 510/.test(o), 'after "Add +1" → list accepted with all 510', `${s1.action} ${o.slice(0, 160)}`)
  ok(!s1.bseRaw, 'pending list cleared')

  // mixed: 510 fine + 3 without code → can continue without them
  await reset()
  const mixed = Array.from({ length: 510 }, (_, i) => `+1${area[i % 5]}555${String(3000 + i).padStart(4, '0')}`).join('\n') + '\n2125559001\n2125559002\n2125559003'
  n0 = outs().length
  await tg(mixed); await sleep(5000)
  o = outs().slice(n0).join('\n')
  ok(o.includes('Continue without them') && /510 other number/.test(o), 'mixed list → offers add +1 or continue without them', o.slice(0, 200))
  n0 = outs().length
  await tg('➡️ Continue without them'); await sleep(6000)
  o = outs().slice(n0).join('\n')
  ok((await st()).action === 'bse-consent' && /3 number\(s\) left out/.test(o), 'continue without them → 510 kept, 3 left out', o.slice(0, 200))

  // non-US 10-digit → +1 makes them invalid → left out, never forced
  await reset()
  await tg(Array.from({ length: 5 }, (_, i) => `011555${String(1000 + i)}`).join('\n')); await sleep(3000)
  n0 = outs().length
  await tg('🇺🇸 Add +1 (USA/Canada)'); await sleep(3000)
  ok((await st()).action === 'bse-contacts', 'numbers that aren’t valid with +1 are not accepted')

  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
