#!/usr/bin/env node
// Smoke: 💼 Reseller in-bot application (Standard → admin approve; Priority → wallet pay) via the REAL bot + mock Telegram (:5099).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const ADMIN = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
let uid = 9_100_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' :: ' + String(detail).slice(0, 400) : ''}`) }
const calls = async (chat, since, method) => (await axios.get(`${MOCK}/_calls?${chat ? 'chat_id=' + chat + '&' : ''}since=${since}${method ? '&method=' + method : ''}`)).data
async function text(chat, t, wait = 2200) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text: t } }, { timeout: 20000 })
  await sleep(wait)
  return (await calls(chat, since)).filter(c => c.method === 'sendMessage')
}
async function cb(chat, data, wait = 1800, fromId = chat) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(fromId), is_bot: false, first_name: 'Adm', username: 'adm' }, message: { message_id: 77, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' } }, data } }, { timeout: 20000 })
  await sleep(wait)
  return { all: await calls(null, since), n }
}
const last = cs => cs.slice(-1)[0] || {}

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const U1 = '990400001', U2 = '990400002'
  const clean = async () => {
    for (const c of ['state', 'walletOf', 'nameOf']) await db.collection(c).deleteMany({ _id: { $in: [U1, U2] } })
    await db.collection('resellerApplications').deleteMany({ chatId: { $in: [U1, U2] } })
  }
  try {
    await clean()
    await db.collection('state').insertMany([{ _id: U1, userLanguage: 'en', action: 'none' }, { _id: U2, userLanguage: 'en', action: 'none' }])
    await db.collection('walletOf').insertOne({ _id: U2, usdIn: 500, usdOut: 0 })

    // ── Standard path ──
    let r = await text(U1, '💼 Reseller')
    check('home screen with Apply Now', /Become a .* Reseller/.test(strip(last(r).text)) && (last(r).buttons || []).includes('📝 Apply Now'), JSON.stringify(last(r)))
    r = await text(U1, '📝 Apply Now')
    check('step 1 email (optional, Skip)', /Step 1 of 9/.test(strip(last(r).text)) && (last(r).buttons || []).includes('⏭ Skip'), JSON.stringify(last(r)))
    r = await text(U1, 'not-an-email')
    check('bad email re-prompt', /doesn't look like an email/.test(strip(last(r).text)))
    r = await text(U1, '⏭ Skip')
    check('step 2 brand', /Step 2 of 9/.test(strip(last(r).text)))
    r = await text(U1, 'NovaTel')
    check('step 3 sell mode buttons', /Step 3 of 9/.test(strip(last(r).text)) && (last(r).buttons || []).includes('🤖 Own white-label bot'))
    r = await text(U1, '⬅️ Back')
    check('Back returns to brand', /Step 2 of 9/.test(strip(last(r).text)))
    r = await text(U1, 'NovaTel')
    r = await text(U1, '🤖 Own white-label bot')
    check('step 4 volume', /Step 4 of 9/.test(strip(last(r).text)) && (last(r).buttons || []).includes('11–50'))
    r = await text(U1, '11–50')
    r = await text(U1, '📣 Telegram channel or group')
    check('step 6 audience size', /Step 6 of 9/.test(strip(last(r).text)))
    r = await text(U1, '10k–50k', 3000)
    check('step 7 services: header + inline panel', r.length >= 2 && /Step 7 of 9/.test(strip(r[r.length - 2].text)) && /Selected/.test(strip(last(r).text)) && (last(r).buttons || []).some(b => /Cloud IVR/.test(b)), JSON.stringify(r.map(x => [strip(x.text).slice(0, 40), x.buttons])))
    let c = await cb(U1, 'rsa:c')
    const ack = c.all.find(x => x.method === 'answerCallbackQuery')
    check('Continue with none selected → alert', ack && /at least one/i.test(JSON.stringify(ack.raw || ack)), JSON.stringify(ack))
    c = await cb(U1, 'rsa:t:ivr')
    const ed = c.all.find(x => x.method === 'editMessageText')
    check('toggle edits the panel in place', ed && /✅ 📞 Cloud IVR/.test(JSON.stringify(ed.raw || ed)), JSON.stringify(c.all.map(x => x.method)))
    await cb(U1, 'rsa:t:sms')
    await cb(U1, 'rsa:t:hosting'); await cb(U1, 'rsa:t:hosting')
    let d = await db.collection('resellerApplications').findOne({ chatId: U1, status: 'draft' })
    check('services stored (toggle twice removes)', JSON.stringify(d?.answers?.services) === JSON.stringify(['ivr', 'sms']), JSON.stringify(d?.answers))
    c = await cb(U1, 'rsa:c', 2500)
    const notePrompt = c.all.filter(x => x.method === 'sendMessage' && String(x.chat_id) === U1).slice(-1)[0]
    check('Continue → step 8 Note to Admin', notePrompt && /Step 8 of 9 — Note to Admin/.test(strip(notePrompt.text)), JSON.stringify(notePrompt))
    r = await text(U1, 'I run a 20k Telegram channel.')
    check('step 9 setup speed (Standard / Priority)', /Step 9 of 9/.test(strip(last(r).text)) && (last(r).buttons || []).some(b => /Priority — \$200/.test(b)))
    r = await text(U1, '🕐 Standard — Free (3–5 days)')
    const rev = strip(last(r).text)
    check('review summary', /Review your application/.test(rev) && /NovaTel/.test(rev) && /Cloud IVR \+ SIP, 💬 Bulk SMS/.test(rev) && /Note to Admin: I run a 20k/.test(rev), rev)
    const since = Date.now()
    r = await text(U1, '✅ Submit Application', 3000)
    check('submitted (Standard) confirmation', /Application received/.test(strip(last(r).text)))
    const adm = (await calls(ADMIN, since, 'sendMessage')).find(m => /Reseller Application/.test(strip(m.text)))
    check('admin alert with Approve/Reject', adm && (adm.buttons || []).includes('✅ Approve') && (adm.buttons || []).includes('❌ Reject'), JSON.stringify(adm))
    d = await db.collection('resellerApplications').findOne({ chatId: U1 }, { sort: { createdAt: -1 } })
    check('status pending, tier standard', d.status === 'pending' && d.tier === 'standard' && d.username === 'sim' + U1, JSON.stringify(d))
    r = await text(U1, '💼 Reseller')
    check('reopen shows under review', /Application under review/.test(strip(last(r).text)))
    c = await cb(U1, `rsa:ok:${d._id}`)
    check('non-admin cannot approve', (await db.collection('resellerApplications').findOne({ _id: d._id })).status === 'pending')
    c = await cb(ADMIN, `rsa:ok:${d._id}`, 2500, ADMIN)
    const appr = c.all.find(x => x.method === 'sendMessage' && String(x.chat_id) === U1)
    check('admin approve → applicant notified', appr && /Approved!/.test(strip(appr.text)) && /3–5 business days/.test(strip(appr.text)), JSON.stringify(c.all.map(x => x.method + ':' + x.chat_id)))
    check('admin message edited with decision', c.all.some(x => x.method === 'editMessageText' && /Approved<\/b> by/.test(JSON.stringify(x.raw || x))))
    c = await cb(ADMIN, `rsa:no:${d._id}`, 1500, ADMIN)
    check('second decision refused', (await db.collection('resellerApplications').findOne({ _id: d._id })).status === 'approved')

    // ── Priority path, wallet ──
    await text(U2, '💼 Reseller'); await text(U2, '📝 Apply Now')
    await text(U2, 'boss@example.com'); await text(U2, 'ShadowHost'); await text(U2, '🔌 Reseller API'); await text(U2, '200+')
    await text(U2, '🌐 Website'); await text(U2, '50k+', 3000)
    await cb(U2, 'rsa:t:vps'); await cb(U2, 'rsa:c', 2500)
    await text(U2, '⏭ Skip')
    await text(U2, '⚡ Priority — $200 (24h)')
    r = await text(U2, '✅ Submit Application', 3500)
    const co = last(r)
    const payBtn = (co.buttons || []).find(b => /^👛 /.test(b))
    check('Priority → checkout with wallet/crypto/bank + Switch to Standard', /Priority Reseller Setup — \$200/.test(strip(co.text)) && payBtn && (co.buttons || []).includes('🕐 Switch to Standard (Free)'), JSON.stringify(co))
    d = await db.collection('resellerApplications').findOne({ chatId: U2 }, { sort: { createdAt: -1 } })
    check('status pending_payment before paying', d.status === 'pending_payment')
    const s2 = Date.now()
    r = await text(U2, payBtn, 4000)
    const w = await db.collection('walletOf').findOne({ _id: U2 })
    check('wallet charged $200', Math.abs((w.usdOut || 0) - 200) < 0.01, JSON.stringify(w))
    check('Priority confirmed message', r.some(m => /Priority confirmed/.test(strip(m.text))), r.map(m => strip(m.text).slice(0, 60)).join(' | '))
    d = await db.collection('resellerApplications').findOne({ _id: d._id })
    check('status pending, tier priority, paid', d.status === 'pending' && d.tier === 'priority' && d.payment?.status === 'paid' && d.payment?.method === 'wallet_usd', JSON.stringify(d.payment))
    const adm2 = (await calls(ADMIN, s2, 'sendMessage')).find(m => /PRIORITY/.test(strip(m.text)))
    check('admin alert shows PRIORITY paid', adm2 && /paid \$200 via wallet_usd/.test(strip(adm2.text)), JSON.stringify(adm2))
    r = await text(U2, payBtn, 2500)
    const w2 = await db.collection('walletOf').findOne({ _id: U2 })
    check('second pay tap does not charge again', Math.abs((w2.usdOut || 0) - 200) < 0.01, JSON.stringify(w2))
  } catch (e) { console.log('ERROR', e.message, e.stack) } finally {
    if (!process.env.KEEP) await clean()
    await mc.close()
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  }
})()
