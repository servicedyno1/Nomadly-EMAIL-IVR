#!/usr/bin/env node
// iter224 retest: bot preset buttons follow hand order (pos); Quick IVR / Bulk IVR auto-apply the remembered caller ID per VoIP
// number with a '📞 Use my own number' button that removes it + clears memory. REAL bot via mock Telegram (:5099), bot :5000.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const BIZ = '990224101'
const LINE = '+18336224101', LINE2 = '+18336224102'
const A = '+14155552441', B = '+14155552442', C = '+14155552443'
let uid = 8_300_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 900) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 3500) {
  const since = Date.now(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const txt = cs => cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join('\n---\n')
const btns = cs => cs.flatMap(c => c.buttons || [])
const exp = new Date(Date.now() + 25 * 864e5).toISOString()
const num = (phoneNumber, plan, planPrice) => ({ phoneNumber, plan, planPrice, provider: 'telnyx', status: 'active', autoRenew: true, purchaseDate: new Date().toISOString(), expiresAt: exp, capabilities: { voice: true, sms: true }, features: {} })
const OWN = '📞 Use my own number'

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'phoneNumbersOf', 'userConversion']) await db.collection(c).deleteMany({ _id: BIZ })
    await db.collection('webCallerIds').deleteMany({ _id: { $in: [A, B, C] }, chatId: BIZ })
    await db.collection('callerIdLast').deleteMany({ chatId: BIZ })
    await db.collection('callerIdDefaults').deleteMany({ chatId: BIZ })
    await db.collection('callerIdUses').deleteMany({ chatId: BIZ })
  }
  await cleanup()
  try {
    await db.collection('state').insertOne({ _id: BIZ, userLanguage: 'en', action: 'none' })
    await db.collection('nameOf').insertOne({ _id: BIZ, val: 'sim' + BIZ })
    await db.collection('walletOf').insertOne({ _id: BIZ, usdIn: 100, usdOut: 0 })
    await db.collection('phoneNumbersOf').insertOne({ _id: BIZ, val: { numbers: [num(LINE, 'business', 120), num(LINE2, 'business', 120)] } })
    const base = { chatId: BIZ, status: 'verified', method: 'attested', attested: true, charged: 0, createdAt: Date.now() - 864e5 }
    // C most recently used, but hand order is B, A, C
    await db.collection('webCallerIds').insertMany([
      { _id: A, ...base, label: 'Alpha', pos: 1, verifiedAt: new Date(Date.now() - 5 * 864e5) },
      { _id: B, ...base, label: 'Beta', pos: 0, verifiedAt: new Date(Date.now() - 4 * 864e5) },
      { _id: C, ...base, pos: 2, verifiedAt: new Date(Date.now() - 3 * 864e5), lastUsedAt: new Date() },
    ])

    // 1. hand order on bot buttons
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'ivrObSelectCallerId' } })
    let cs = await say(BIZ, '📞 New Call', 4000)
    let b = btns(cs)
    console.log('   buttons:', JSON.stringify(b))
    const iB = b.indexOf(`🎭 Beta · ${B}`), iA = b.indexOf(`🎭 Alpha · ${A}`), iC = b.indexOf(`🎭 ${C}`)
    check('1a.bot preset buttons follow hand order B,A,C', iB >= 0 && iA > iB && iC > iA, JSON.stringify(b))

    // 2. no memory → pick line → unchanged flow
    cs = await say(BIZ, LINE, 3500)
    let s = await db.collection('state').findOne({ _id: BIZ })
    check('2a.no remembered ID: enter target, no displayCallerId, no own button', s?.action === 'ivrObEnterTarget' && !s?.ivrObData?.displayCallerId && !btns(cs).includes(OWN), JSON.stringify({ a: s?.action, d: s?.ivrObData, b: btns(cs) }))

    // 3. tap preset (bot) → NOT remembered and lastUsedAt NOT set (only a real call does that)
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'ivrObSelectCallerId' } })
    await say(BIZ, '📞 New Call', 3000)
    cs = await say(BIZ, `🎭 Alpha · ${A}`, 3500)
    await sleep(800)
    s = await db.collection('state').findOne({ _id: BIZ })
    const mem = await db.collection('callerIdLast').findOne({ _id: `${BIZ}:${LINE}` })
    const aDoc = await db.collection('webCallerIds').findOne({ _id: A })
    check('3a.bot preset tap applies displayCallerId', s?.ivrObData?.displayCallerId === A, JSON.stringify(s?.ivrObData))
    check('3b.bot preset tap does NOT remember default', !mem?.showAs, JSON.stringify(mem))
    check('3c.bot preset tap does NOT set lastUsedAt', !aDoc?.lastUsedAt, JSON.stringify(aDoc))
    check('3d.no logUse rows from tap', (await db.collection('callerIdUses').countDocuments({ chatId: BIZ })) === 0)

    // 4. seeded memory → auto applied with own button
    await db.collection('callerIdLast').replaceOne({ _id: `${BIZ}:${LINE}` }, { _id: `${BIZ}:${LINE}`, chatId: BIZ, from: LINE, showAs: A, at: new Date() }, { upsert: true })
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'ivrObSelectCallerId' } })
    await say(BIZ, '📞 New Call', 3000)
    cs = await say(BIZ, LINE, 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    check('4a.remembered: enter target with displayCallerId', s?.action === 'ivrObEnterTarget' && s?.ivrObData?.displayCallerId === A, JSON.stringify({ a: s?.action, d: s?.ivrObData }))
    check('4b.own button shown', btns(cs).includes(OWN), JSON.stringify(btns(cs)))
    const a2 = await db.collection('webCallerIds').findOne({ _id: A })
    check('4c.auto-apply does NOT set lastUsedAt', !a2?.lastUsedAt, JSON.stringify(a2))
    // 5. own → removes for this call; memory only changes on a placed call
    cs = await say(BIZ, OWN, 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    await sleep(500)
    const mem2 = await db.collection('callerIdLast').findOne({ _id: `${BIZ}:${LINE}` })
    check('5a.own: displayCallerId removed, still enter target', s?.action === 'ivrObEnterTarget' && !s?.ivrObData?.displayCallerId, JSON.stringify({ a: s?.action, d: s?.ivrObData }))
    console.log('   memory after own (no call placed):', JSON.stringify(mem2?.showAs))
    check('5b.own: reply shows own line', txt(cs).includes(LINE), txt(cs))
    // 6. bulk remembered
    await db.collection('callerIdLast').replaceOne({ _id: `${BIZ}:${LINE2}` }, { _id: `${BIZ}:${LINE2}`, chatId: BIZ, from: LINE2, showAs: B, at: new Date() }, { upsert: true })
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'bulkSelectCaller', bulkData: {}, bulkCallerIds: [{ phoneNumber: LINE, label: LINE, type: 'owned_telnyx', provider: 'telnyx' }, { phoneNumber: LINE2, label: LINE2, type: 'owned_telnyx', provider: 'telnyx' }] } })
    cs = await say(BIZ, LINE2, 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    check('6a.bulk remembered: showAs applied + own button', s?.action === 'bulkUploadLeads' && s?.bulkData?.showAs === B && btns(cs).includes(OWN), JSON.stringify({ a: s?.action, d: s?.bulkData, b: btns(cs) }))
    const bDoc = await db.collection('webCallerIds').findOne({ _id: B })
    check('6b.bulk auto-apply does NOT set lastUsedAt', !bDoc?.lastUsedAt, JSON.stringify(bDoc))
  } catch (e) {
    console.log('ERROR', e.stack || e.message)
    results.push(false)
  } finally {
    await cleanup()
    await mc.close()
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
    process.exit(0)
  }
})()
