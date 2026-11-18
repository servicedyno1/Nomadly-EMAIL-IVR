// Digital Products: no Twilio / Telnyx / sub-accounts / new-domain items; renamed Google & Zoho; eSIM at $50.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000121, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).pop() || ''
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const t = require('../lang/en.js').en
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'none', userLanguage: 'en' } }, { upsert: true })
  await tg(t.user.digitalProducts || '🛒 Digital Products')
  const out = lastOut()
  ok(!/Twilio|Telnyx|Sub-Account|Sub —|New Domain/.test(out), 'no Twilio, Telnyx, sub-accounts or new-domain items')
  ok(out.includes('Google Cloud Account') && out.includes('Google Workspace Account') && out.includes('Zoho Mail Account') && out.includes('AWS Main Account'), 'kept items with new names')
  ok(out.includes('$50/month') && !out.includes('$75'), 'eSIM shows $50/month')
  await tg(JSON.parse(out.slice(out.indexOf('{'))).kb.find(x => x.startsWith('🌐 Google Cloud Account')))
  ok((await db.collection('state').findOne({ _id: String(CHAT) })).dpProductName === 'Google Cloud Account' || lastOut().includes('Google Cloud Account'), 'Google Cloud Account opens checkout')
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
