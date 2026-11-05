#!/usr/bin/env node
// iter208: what the 'Cancel' / '🏠 Main Menu' buttons do on the post-payment IMEI step (esim-bot-imei).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const X = '990208009'
let uid = 9_500_000 + Math.floor(Math.random() * 100000)
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
async function say(text) {
  const since = Date.now(), n = uid++
  await axios.post('http://localhost:5000/telegram/webhook', { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(X), type: 'private', first_name: 'S' }, from: { id: Number(X), is_bot: false, first_name: 'S' }, text } })
  await sleep(2500)
  const cs = (await axios.get(`http://127.0.0.1:5099/_calls?chat_id=${X}&since=${since}`)).data
  return { t: cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join(' | ').slice(0, 300), b: cs.flatMap(c => c.buttons || []) }
}
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const clean = async () => { for (const k of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(k).deleteMany({ _id: X }); await db.collection('esimLines').deleteMany({ chatId: X }) }
  await clean()
  await db.collection('esimLines').insertOne({ _id: 'es_it208cxl', chatId: X, planId: 'SPENZA_001', price: 75, imei: null, status: 'awaiting_imei', source: 'telegram', lang: 'en', createdAt: new Date(), updatedAt: new Date() })
  try {
    for (const btn of ['Cancel', '🏠 Main Menu']) {
      await db.collection('state').updateOne({ _id: X }, { $set: { userLanguage: 'en', action: 'esim-bot-imei', esimPendingLine: 'es_it208cxl' } }, { upsert: true })
      const r = await say(btn)
      const st = await db.collection('state').findOne({ _id: X })
      console.log(`${btn} → action=${st.action} reply="${r.t}" buttons=${JSON.stringify(r.b).slice(0, 200)}`)
    }
  } finally { await clean(); await mc.close() }
})()
