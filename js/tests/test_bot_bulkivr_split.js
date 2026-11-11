// Bot Bulk IVR split lists (no dialing): >500 numbers → confirm screen shows the split plan + two launch choices;
// launch is blocked when the wallet can't cover all parts; "Start part" button refuses a part that isn't ready.
// Run: cd /tmp && node /app/js/tests/test_bot_bulkivr_split.js
require('/app/node_modules/dotenv').config({ path: '/app/backend/.env' })
const axios = require('/app/node_modules/axios'), { MongoClient } = require('/app/node_modules/mongodb'), fs = require('fs')
const CHAT = 990000177, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => wait(1500))
const cb = (data) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), callback_query: { id: String(Date.now()), from: { id: CHAT, is_bot: false, first_name: 'Qa' }, message: { message_id: 1, chat: { id: CHAT, type: 'private' } }, data } }).then(() => wait(1500))
const outs = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const st = () => db.collection('state').findOne({ _id: String(CHAT) })
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 3, usdOut: 0 } }, { upsert: true })
  const leads = Array.from({ length: 1240 }, (_, i) => ({ number: `+1555010${String(i).padStart(4, '0')}` }))
  const base = { callerId: '+13346972125', provider: 'telnyx', audioUrl: 'https://x/main.mp3', audioName: 'Spring promo', mode: 'report_only', leads }
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkSelectVoicemail', userLanguage: 'en', bulkData: base } }, { upsert: true })
  const n0 = outs().length
  await tg('📵 Hang up (no message)')
  const o = outs().slice(n0).join('\n')
  ok((await st()).action === 'bulkConfirm', 'reaches the confirm screen')
  ok(o.includes('1,240 numbers → 3 parts'), 'confirm shows "1,240 numbers → 3 parts"')
  ok(o.includes('start each part automatically') && o.includes('ask me before each part') && !o.includes('"🚀 Launch Campaign"'), 'two launch choices instead of a single Launch')
  const n1 = outs().length
  await tg('🚀 Launch — ask me before each part'); await wait(1500)
  const o2 = outs().slice(n1).join('\n')
  ok(/must cover all 3 parts/.test(o2), 'low wallet → "must cover all 3 parts" and nothing created')
  ok(!(await db.collection('bulkCallCampaigns').countDocuments({ chatId: String(CHAT) })) && !(await db.collection('bulkCallCampaigns').countDocuments({ chatId: CHAT })), 'no campaign created')
  const n2 = outs().length
  await cb('bcnext:not-a-real-part')
  ok(outs().slice(n2).join('\n').includes('not ready to start'), '"Start part" on a part that isn\'t ready → refused')
  // small list keeps the single Launch button
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'bulkSelectVoicemail', bulkData: { ...base, leads: leads.slice(0, 20) } } })
  const n3 = outs().length
  await tg('📵 Hang up (no message)')
  const o3 = outs().slice(n3).join('\n')
  ok(o3.includes('🚀 Launch Campaign') && !o3.includes('parts'), '≤500 numbers → normal single Launch')
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
