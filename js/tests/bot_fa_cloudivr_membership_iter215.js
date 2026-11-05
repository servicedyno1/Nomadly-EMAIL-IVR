#!/usr/bin/env node
// iter215: Farsi Cloud IVR deep walk + Farsi Membership (stop BEFORE paying) against the REAL bot via mock Telegram (:5099).
// Flags silence, "Unrecognized message" fallback, exceptions; checks Persian text on Cloud IVR screens and membership prices.
// Requires mock_telegram_api.js on :5099 and bot started with TELEGRAM_API_BASE_URL=http://127.0.0.1:5099, logging to BOT_LOG.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const fs = require('fs'), axios = require('axios')
const { MongoClient } = require('mongodb')
const BOT_LOG = process.env.BOT_LOG || '/tmp/bot.log'
const ID = '990215301'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const FA = /[\u0600-\u06FF]/
const results = []
const check = (name, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(d).slice(0, 500)}`) }
let uid = 9_100_000 + Math.floor(Math.random() * 100000)
async function say(text, wait = 4500) {
  const since = Date.now(), off = fs.statSync(BOT_LOG).size, n = uid++
  await axios.post('http://localhost:5000/telegram/webhook', { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(ID), type: 'private', first_name: 'Sim' }, from: { id: Number(ID), is_bot: false, first_name: 'Sim', username: 'sim' + ID }, text } }, { timeout: 15000 })
  await sleep(wait)
  const cs = (await axios.get(`http://127.0.0.1:5099/_calls?${new URLSearchParams({ chat_id: ID, since: String(since) })}`)).data
  const b = Buffer.alloc(fs.statSync(BOT_LOG).size - off); const fd = fs.openSync(BOT_LOG, 'r'); fs.readSync(fd, b, 0, b.length, off); fs.closeSync(fd)
  const lg = b.toString().split('\n').filter(l => l.includes(ID) || /TypeError|ReferenceError|Cannot read|is not a function/.test(l))
  const msgs = cs.filter(c => /^send|^edit/.test(c.method) && (c.text || c.caption))
  return { text: msgs.map(c => strip(c.text || c.caption)).join(' | '), btns: cs.flatMap(c => c.buttons || []), n: msgs.length,
    unrec: lg.some(l => /Unrecognized message from/.test(l)), err: lg.filter(l => /TypeError|ReferenceError|Cannot read|is not a function/.test(l)) }
}
const ok = r => r.n > 0 && !r.unrec && !r.err.length
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL), db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion', 'phoneNumbersOf']) await db.collection(c).deleteMany({ _id: ID })
    await db.collection('resumableSessions').deleteMany({ _id: 'resume_' + ID })
  }
  await cleanup()
  try {
    await db.collection('state').insertOne({ _id: ID, userLanguage: 'fa', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: ID, usdIn: 0, usdOut: 0 })
    await say('/start', 3000)
    let r = await say('📞 Cloud IVR + SIP')
    check('A1 fa hub opens in Persian with Persian buttons', ok(r) && FA.test(r.text) && r.btns.includes('🛒 انتخاب پلن'), r.text.slice(0, 200) + JSON.stringify(r.btns))
    r = await say('🛒 انتخاب پلن')
    check('A2 plan list Persian, 3 plans', ok(r) && /انتخاب پلن/.test(r.text) && r.btns.filter(b => /\/ماه$/.test(b)).length === 3, JSON.stringify(r.btns))
    const pro = r.btns.find(b => /^⭐ Pro/.test(b))
    r = await say(pro)
    check('A3 pick Pro → country list (Persian prompt)', ok(r) && /کشور/.test(r.text) && r.btns.includes('🇬🇧 United Kingdom'), r.text)
    r = await say('🇬🇧 United Kingdom')
    check('A4 UK → number type (Persian)', ok(r) && /نوع شماره/.test(r.text) && r.btns.some(b => FA.test(b) && /^📱/.test(b)), r.text + JSON.stringify(r.btns))
    r = await say('Back')
    check('A5 Back from type → country list', ok(r) && r.btns.includes('🇬🇧 United Kingdom'), r.text)
    await say('🇬🇧 United Kingdom')
    r = await say('📱 شماره موبایل', 15000)
    const hasList = r.btns.includes('1')
    check('A6 mobile → number list (Persian header)', ok(r) && /شماره‌های موجود|هیچ شماره‌ای/.test(r.text), r.text.slice(0, 300))
    if (hasList) {
      r = await say('1', 6000)
      check('A7 pick #1 → Persian order summary, $75, payment options (NOT paying)', ok(r) && /خلاصه سفارش/.test(r.text) && /\$75/.test(r.text) && r.btns.some(b => /Deposit|واریز/.test(b)), r.text.slice(0, 300) + JSON.stringify(r.btns))
      r = await say('🎟️ اعمال کوپن')
      check('A8 coupon prompt answers (no fallback)', ok(r), r.text)
      r = await say('Back')
      check('A9 Back from coupon → order summary', ok(r) && /خلاصه سفارش/.test(r.text), r.text.slice(0, 200))
      r = await say('Back')
      check('A10 Back from summary → plan picker', ok(r) && r.btns.some(b => /^⭐ Pro/.test(b)), r.text.slice(0, 200))
    } else console.log('INFO no UK numbers returned by provider — A7..A10 skipped')
    // Hub entry screens, each followed by Back
    for (const [b, re] of [['📢 تماس سریع IVR — ۱ رایگان', /تماس سریع IVR/], ['🆓 امتحان رایگان SIP', /SIP/], ['📋 پلن‌های من', /شماره/], ['📊 مصرف و صورت‌حساب', /شماره|مصرف/], ['❓ چگونه کار می‌کند', /چطور کار می‌کند/], ['📖 راهنمای SIP', /راهنمای/], ['📞 کمپین IVR انبوه', /کمپین/], ['🎵 کتابخانه صوتی', /کتابخانه/]]) {
      await say('/start', 2500); await say('📞 Cloud IVR + SIP', 3500)
      r = await say(b)
      check(`B ${b} → Persian screen, no fallback`, ok(r) && re.test(r.text) && FA.test(r.text) && !/لطفاً یک گزینه انتخاب کنید\.$/.test(r.text), r.text.slice(0, 200))
      const back = await say(r.btns.find(x => /^↩️ Back$|^Back$/.test(x)) || 'Back', 3000)
      check(`B ${b} → Back answers`, ok(back), back.text.slice(0, 120))
    }
    // Membership (fa): prices + reach payment options, stop before paying
    for (const [plan, price] of [['روزانه', 50], ['هفتگی', 100], ['ماهانه', 200]]) {
      await say('/start', 2500)
      r = await say('⭐ عضویت')
      check(`C ${plan} membership list shows plan buttons`, ok(r) && r.btns.includes(plan), JSON.stringify(r.btns))
      r = await say(plan)
      check(`C ${plan} → price $${price} + coupon prompt`, ok(r) && new RegExp(`\\$${price}\\.00`).test(r.text), r.text)
      r = await say('رد شدن')
      check(`C ${plan} skip → payment options $${price}`, ok(r) && new RegExp(`\\$${price}`).test(r.text) && r.btns.some(b => /Deposit|واریز/.test(b)), r.text.slice(0, 200) + JSON.stringify(r.btns))
    }
    r = await say('⭐ عضویت')
    console.log(`INFO membership text Persian? ${FA.test(r.text.split('|')[0])} :: ${r.text.slice(0, 80)}`)
    check('C usdOut still 0 (nothing paid)', !((await db.collection('walletOf').findOne({ _id: ID }))?.usdOut > 0))
  } catch (e) { check('script error', false, e.stack) } finally {
    await cleanup(); await mc.close()
    console.log(`\nRESULT ${results.filter(Boolean).length}/${results.length} passed`); process.exit(0)
  }
})()
