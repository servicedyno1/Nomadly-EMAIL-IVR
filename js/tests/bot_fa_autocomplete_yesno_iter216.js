#!/usr/bin/env node
// iter216: Farsi Yes/No matcher (بله/خیر) + fa auto-complete-after-deposit on the domain flow (DRY RUN only).
// Requires mock_telegram_api.js on :5099 and the bot started with TELEGRAM_API_BASE_URL=http://127.0.0.1:5099.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ID = '990213145', ALL = [ID]
let uid = 9_100_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, d = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 700) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 3000) {
  const since = Date.now(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const txt = cs => cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join('\n---\n')
const btns = cs => cs.flatMap(c => c.buttons || [])
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('userConversion').deleteMany({ chatId: { $in: ALL } })
    await db.collection('welcomeBonuses').deleteMany({ chatId: { $in: ALL } })
    await db.collection('resumableSessions').deleteMany({ _id: { $in: ALL.map(c => 'resume_' + c) } })
    await db.collection('transactions').deleteMany({ chatId: { $in: ALL } })
    await db.collection('domainsOf').deleteMany({ _id: { $in: ALL } }).catch(() => {})
    await db.collection('chatIdOfPayment').deleteMany({ _id: /^iter216/ })
    await db.collection('payments').deleteMany({ _id: /^iter216/ })
  }
  await cleanup()
  try {
    if (!require('../domain-dry-run').isDomainDryRun()) { console.log('SKIP — domain dry run OFF'); return }
    await db.collection('state').insertOne({ _id: ID, userLanguage: 'fa', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: ID, usdIn: 0, usdOut: 0 })
    await db.collection('userConversion').updateOne({ chatId: ID }, { $set: { chatId: ID, firstDepositBonusAwarded: true } }, { upsert: true })
    const dom = `iter216fa${Date.now() % 100000}.com`
    await say(ID, '🌐 دامنه‌های ضدضربه', 2500)
    await say(ID, '🛒🌐 خرید دامنه', 2500)
    let cs = await say(ID, dom, 15000)
    check('1a.fa shortener question shows ✅ بله / ❌ خیر', btns(cs).includes('✅ بله') && btns(cs).includes('❌ خیر'), JSON.stringify(btns(cs)))
    cs = await say(ID, '❌ خیر', 5000)
    const dep = btns(cs).find(b => /^💵 Deposit \$/.test(b))
    check('1b.❌ خیر → payment screen (not "option not available")', !!dep && !/در حال حاضر در دسترس نیست/.test(txt(cs)), txt(cs))
    cs = await say(ID, '↩️ Back', 4000)  // domain-pay Back → back to the shortener Yes/No question
    cs = await say(ID, '✅ بله', 5000)
    check('1c.✅ بله → payment screen', btns(cs).some(b => /^💵 Deposit \$/.test(b)), txt(cs))
    cs = await say(ID, '↩️ Back', 4000); cs = await say(ID, '❌ خیر', 5000)
    cs = await say(ID, btns(cs).find(b => /^💵 Deposit \$/.test(b)), 3000)
    const sess = await db.collection('resumableSessions').findOne({ _id: 'resume_' + ID })
    check('2a.balance wall → resumable session saved', sess?.step === 'domain-pay' && sess?.data?.price > 0, JSON.stringify(sess))
    const ref = 'iter216' + ID + Date.now()
    await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: ID } } }, { upsert: true })
    const since = Date.now()
    await axios.get(`http://localhost:5000/crypto-wallet?ref=${ref}&coin=trc20_usdt&value_coin=${sess.data.price + 1}`, { timeout: 30000 }).catch(e => e.response)
    let w
    for (let i = 0; i < 25; i++) { await sleep(3000); w = await db.collection('walletOf').findOne({ _id: ID }); if ((w.usdOut || 0) > 0) break }
    await sleep(8000)
    w = await db.collection('walletOf').findOne({ _id: ID })
    const all = txt(await calls(ID, since))
    console.log('INFO wallet', JSON.stringify(w), '\nINFO msgs:\n' + all.slice(0, 1500))
    check('2b.fa auto-complete charged once (<= price)', (w.usdOut || 0) > 0 && w.usdOut <= sess.data.price + 0.01, JSON.stringify(w))
    check('2c.fa domain confirmation once', (all.match(/متعلق به شماست/g) || []).length === 1, all.slice(0, 600))
    check('2d.no "option not available" fallback', !/در حال حاضر در دسترس نیست/.test(all), all.slice(0, 600))
  } catch (e) { check('script error', false, e.stack) } finally {
    await cleanup(); await mc.close()
    console.log(`\nRESULT ${results.filter(r => r.ok).length}/${results.length} passed`); process.exit(0)
  }
})()
