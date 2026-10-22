#!/usr/bin/env node
// Probe: (a) Back from services then forward → old panel still live? (b) English menu label typed by a fr user on brand step.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let uid = 9_800_000 + Math.floor(Math.random() * 100000)
async function text(chat, t, wait = 1800) { const n = uid++; await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim' }, text: t } }); await sleep(wait) }
async function cb(chat, data, mid) { const n = uid++; const s = Date.now(); await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(chat), is_bot: false, first_name: 'Sim' }, message: { message_id: mid, chat: { id: Number(chat), type: 'private' } }, data } }); await sleep(1500); return (await axios.get(`${MOCK}/_calls?since=${s}`)).data }
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const U = '990400095', V = '990400096'
  const clean = async () => { for (const c of ['state', 'walletOf']) await db.collection(c).deleteMany({ _id: { $in: [U, V] } }); await db.collection('resellerApplications').deleteMany({ chatId: { $in: [U, V] } }) }
  try {
    await clean()
    await db.collection('state').insertOne({ _id: U, userLanguage: 'en', action: 'none' })
    for (const t of ['💼 Reseller', '📝 Apply Now', '⏭ Skip', 'EdgeBrand', '🤖 Own white-label bot', '1–10', '🌐 Website']) await text(U, t)
    await text(U, 'Under 1k', 2500)
    const p1 = (await db.collection('resellerApplications').findOne({ chatId: U, status: 'draft' })).panelMsgId
    const s = Date.now(); await text(U, '⬅️ Back'); const cleared = (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=${s}&method=editMessageReplyMarkup`)).data
    console.log('(a) Back from services clears old panel?', cleared.some(x => String(x.raw?.message_id) === String(p1)))
    await text(U, 'Under 1k', 2500)
    const p2 = (await db.collection('resellerApplications').findOne({ chatId: U, status: 'draft' })).panelMsgId
    const r = await cb(U, 'rsa:t:ivr', p1)
    const d = await db.collection('resellerApplications').findOne({ chatId: U, status: 'draft' })
    console.log(`(a) p1=${p1} p2=${p2}; tap on OLD panel p1 →`, r.map(x => x.method + ':' + (x.raw?.message_id || '') + ':' + JSON.stringify(x.raw?.text || '').slice(0, 30)), 'services now', d.answers.services)
    await db.collection('state').insertOne({ _id: V, userLanguage: 'fr', action: 'none' })
    for (const t of ['💼 Revendeur', '📝 Postuler', '⏭ Passer']) await text(V, t)
    await text(V, '👛 Wallet')
    const dv = await db.collection('resellerApplications').findOne({ chatId: V }, { sort: { updatedAt: -1 } })
    console.log('(b) fr user types EN "👛 Wallet" on brand → status', dv.status, 'brand', dv.answers.brand)
  } catch (e) { console.log('ERR', e.message) } finally { await clean(); await mc.close(); process.exit(0) }
})()
