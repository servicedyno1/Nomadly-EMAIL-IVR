// Main menu: "📱 USA eSIM" replaces Marketplace (which moves under ➕ More); eSIM shows Unlimited data/calls/SMS, never MB/minutes.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const CHAT = 990000119, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2500)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).pop() || ''
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const [lang, esim, mp, unl] of [['en', '📱 USA eSIM', '🏪 Marketplace', 'Unlimited data · Unlimited calls · Unlimited SMS'], ['fr', '📱 eSIM USA', '🏪 Marché', 'Données illimitées']]) {
    const t = require(`../lang/${lang}.js`)[lang]
    const kb = JSON.stringify(t.o?.reply_markup?.keyboard || [])
    ok(kb.includes(esim) && !kb.includes(mp), `${lang}: main keyboard has ${esim}, not Marketplace`)
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { action: 'none', userLanguage: lang } }, { upsert: true })
    await tg(esim)
    const out = lastOut(), s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok(s.action === 'esim-bot-home' && out.includes(unl) && !/\d+\s?MB|min calls/.test(out), `${lang}: eSIM opens from the main menu and says unlimited (no MB/minutes)`)
    await tg('↩️ Back')
    ok((await db.collection('state').findOne({ _id: String(CHAT) })).action !== 'esim-bot-home' && !lastOut().includes('dpEsim'), `${lang}: Back returns to the main menu`)
    await tg(t.user.more)
    ok(lastOut().includes(mp), `${lang}: Marketplace is under ➕ More`)
  }
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
