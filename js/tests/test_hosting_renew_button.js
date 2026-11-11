// Hosting renew: "🔄 Renew Now" on the plan from 14 days before expiry (and after), renew rows in My Hosting Plans,
// one-tap "🔄 Renew <domain>" from reminders and the panel deep link (/start renew_<base64url domain>).
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('../../scripts/lib/tg_sim')
const CHAT = '990000205'
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}${x ? ` — ${x}` : ''}`) }
const DAY = 86400000
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), A = db.collection('cpanelAccounts'), st = db.collection('state')
  await A.deleteMany({ chatId: CHAT })
  await A.insertMany([
    { _id: 'qa-renew-soon', chatId: CHAT, domain: 'qa-renew-soon.com', plan: 'Premium Anti-Red HostPanel (30 Days)', cpUser: 'qasoon', expiryDate: new Date(Date.now() + 5 * DAY), autoRenew: false, createdAt: new Date() },
    { _id: 'qa-renew-later', chatId: CHAT, domain: 'qa-renew-later.com', plan: 'Premium Anti-Red HostPanel (30 Days)', cpUser: 'qalater', expiryDate: new Date(Date.now() + 40 * DAY), autoRenew: true, createdAt: new Date() },
  ])
  const sim = makeSim(CHAT)
  const say = async (v, fields) => { if (fields) await st.replaceOne({ _id: CHAT }, { _id: CHAT, userLanguage: 'en', history: [], ...fields }, { upsert: true }); const r = await sim.step({ kind: 'text', v }); return { out: r.msgs.map(m => strip(m.text)).join('\n'), kb: (r.screen?.kb || r.msgs.flatMap(m => m.kb || [])).flat().map(String) } }
  let r = await say('🔍 qa-renew-soon.com', { action: 'myHostingPlans' })
  ok(r.kb.includes('🔄 Renew Now'), 'plan expiring in 5 days shows 🔄 Renew Now', JSON.stringify(r.kb.slice(0, 3)))
  r = await say('🔍 qa-renew-later.com', { action: 'myHostingPlans' })
  ok(!r.kb.includes('🔄 Renew Now'), 'plan with 40 days left has no Renew button')
  r = await say('🔄 Renew qa-renew-soon.com', { action: 'none' })
  ok(/Renew Plan/.test(r.out), 'reminder button "🔄 Renew <domain>" opens the renew screen from anywhere', r.out.slice(0, 80))
  const key = Buffer.from('qa-renew-soon.com').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  r = await say(`/start renew_${key}`, { action: 'none' })
  ok(/Renew Plan/.test(r.out), 'panel deep link opens that plan\'s renew screen', r.out.slice(0, 80))
  await A.deleteMany({ chatId: CHAT }); await st.deleteOne({ _id: CHAT }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
