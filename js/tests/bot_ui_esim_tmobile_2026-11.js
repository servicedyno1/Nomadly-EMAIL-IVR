#!/usr/bin/env node
// Bot USA T-Mobile eSIM end-to-end against the REAL bot via the mock Telegram API (preview: simulated Spenza order).
// Pre-req: node js/tests/mock_telegram_api.js on :5099 and the bot started with TELEGRAM_API_BASE_URL=http://127.0.0.1:5099.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const EN = '990206001', FR = '990206002', POOR = '990206003'
const ALL = [EN, FR, POOR]
let uid = 8_000_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + String(detail).slice(0, 600) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 2500) {
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
    await db.collection('esimLines').deleteMany({ chatId: { $in: ALL } })
    await db.collection('digitalOrders').deleteMany({ chatId: { $in: ALL.map(Number).concat(ALL) } })
    await db.collection('transactions').deleteMany({ chatId: { $in: ALL } })
  }
  await cleanup()
  for (const [id, lang, usd] of [[EN, 'en', 100], [FR, 'fr', 100], [POOR, 'en', 5]]) {
    await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'submenu6' })
    await db.collection('walletOf').insertOne({ _id: id, usdIn: usd, usdOut: 0 })
  }
  try {
    // 1. Digital Products menu: only the T-Mobile eSIM, at $75/month
    let cs = await say(EN, '/start', 3000)
    await db.collection('state').updateOne({ _id: EN }, { $set: { action: 'submenu6' } })
    const { en } = require('../lang/en.js')
    cs = await say(EN, '↩️ Back', 2000)
    await db.collection('state').updateOne({ _id: EN }, { $set: { action: 'none' } })
    cs = await say(EN, en.user?.digitalProducts || '🛒 Digital Products', 3000)
    const menu = btns(cs)
    check('1.menu has USA T-Mobile eSIM $75/month', menu.includes('📱 USA T-Mobile eSIM — $75/month'), JSON.stringify(menu))
    check('1.menu has no Airvoice / other eSIM', !menu.some(b => /airvoice|AT&T/i.test(b)) && menu.filter(b => /esim/i.test(b)).length === 1, JSON.stringify(menu))
    // 2. eSIM home
    cs = await say(EN, '📱 USA T-Mobile eSIM — $75/month')
    check('2.home explains product + two-way SMS + IMEI', /\$75\/month/.test(txt(cs)) && /Two-way SMS/.test(txt(cs)) && /\*#06#/.test(txt(cs)) && /Pay first/.test(txt(cs)), txt(cs))
    check('2.home buy button', btns(cs).includes('🛒 Buy eSIM — $75/month'), JSON.stringify(btns(cs)))
    // 3. Pay-first: Buy goes straight to the optional ZIP (no IMEI before payment)
    cs = await say(EN, '🛒 Buy eSIM — $75/month')
    check('3.buy asks ZIP (not IMEI) with Skip', /ZIP code/.test(txt(cs)) && !/15-digit IMEI/.test(txt(cs)) && btns(cs).includes('⏭ Skip'), txt(cs))
    cs = await say(EN, '10001')
    check('5.asks optional email, encouraged', /Optional, but we recommend it/.test(txt(cs)) && btns(cs).includes('⏭ Skip'), txt(cs))
    cs = await say(EN, '⏭ Skip')
    check('6.asks auto-renew', btns(cs).includes('✅ Auto-renew on (recommended)') && btns(cs).includes('⏹ Auto-renew off'), JSON.stringify(btns(cs)))
    cs = await say(EN, '✅ Auto-renew on (recommended)', 3000)
    const pay = btns(cs)
    check('7.checkout summary (IMEI after paying)', /USA T-Mobile eSIM/.test(txt(cs)) && /\$75\/month/.test(txt(cs)) && /Auto-renew: on/.test(txt(cs)) && /Email: none/.test(txt(cs)) && /IMEI: you send it after paying/.test(txt(cs)), txt(cs))
    check('7.pay by wallet or crypto only (no bank)', pay.some(b => /^👛 .*\$75/.test(b)) && pay.some(b => /crypto/i.test(b)) && !pay.some(b => /bank|naira|NGN/i.test(b)), JSON.stringify(pay))
    cs = await say(EN, pay.find(b => /^👛 /.test(b)), 4000)
    check('8.wallet paid → asks IMEI', /Paid \$75/.test(txt(cs)) && /15-digit IMEI/.test(txt(cs)), txt(cs))
    cs = await say(EN, '123')
    check('8.bad IMEI rejected', /isn’t a valid IMEI/.test(txt(cs)), txt(cs))
    cs = await say(EN, '356938035643809', 4000)
    check('8.IMEI sent → setting up message', /being set up/.test(txt(cs)) && /QR code here/.test(txt(cs)), txt(cs))
    const line = await db.collection('esimLines').findOne({ chatId: EN })
    const w = await db.collection('walletOf').findOne({ _id: EN })
    check('8.Spenza line created like the web (source telegram, autoRenew on, $75, no email)', line && line.source === 'telegram' && line.autoRenew === true && line.price === 75 && line.qrEmail === null && line.imei === '356938035643809' && line.zipcode === '10001', JSON.stringify(line))
    check('8.wallet charged $75 once', w.usdOut === 75, JSON.stringify(w))
    // 9. simulated provisioning finishes after ~20 s → QR photo in chat
    await db.collection('esimLines').updateOne({ _id: line._id }, { $set: { createdAt: new Date(Date.now() - 60000) } })
    const since = Date.now()
    let ready = []
    for (let i = 0; i < 10 && !ready.some(c => c.method === 'sendPhoto'); i++) { await sleep(3000); ready = await calls(EN, since) }
    check('9.QR photo sent to chat', ready.some(c => c.method === 'sendPhoto'), JSON.stringify(ready.map(c => c.method)))
    check('9.ready notice in chat', /eSIM is ready/.test(txt(ready)), txt(ready))
    // 10. My eSIMs management
    await db.collection('state').updateOne({ _id: EN }, { $set: { action: 'submenu6' } })
    cs = await say(EN, '📱 USA T-Mobile eSIM — $75/month')
    check('10.home shows My eSIMs', btns(cs).includes('📋 My eSIMs'), JSON.stringify(btns(cs)))
    cs = await say(EN, '📋 My eSIMs')
    const lb = btns(cs).find(b => b.startsWith('📱 +1'))
    check('10.list shows the line', !!lb, JSON.stringify(btns(cs)))
    cs = await say(EN, lb)
    check('11.line details show auto-renew on + toggle', /Auto-renew: on/.test(txt(cs)) && btns(cs).includes('⏹ Turn auto-renew off') && btns(cs).includes('📷 Show QR code'), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(EN, '⏹ Turn auto-renew off')
    check('12.auto-renew turned off', /Auto-renew is off/.test(txt(cs)) && (await db.collection('esimLines').findOne({ _id: line._id })).autoRenew === false && btns(cs).includes('✅ Turn auto-renew on'), txt(cs))
    cs = await say(EN, '✅ Turn auto-renew on')
    check('12.auto-renew back on', (await db.collection('esimLines').findOne({ _id: line._id })).autoRenew === true, txt(cs))
    cs = await say(EN, '📷 Show QR code', 3000)
    check('13.show QR sends photo', cs.some(c => c.method === 'sendPhoto'), JSON.stringify(cs.map(c => c.method)))
    // 14. short wallet → deposit button, no order
    await db.collection('state').updateOne({ _id: POOR }, { $set: { action: 'submenu6' } })
    await say(POOR, '📱 USA T-Mobile eSIM — $75/month', 1500)
    await say(POOR, '🛒 Buy eSIM — $75/month', 1500)
    await say(POOR, '⏭ Skip', 1500)
    await say(POOR, 'poor@example.com', 1500)
    cs = await say(POOR, '⏹ Auto-renew off', 3000)
    check('14.short wallet shows deposit + crypto', btns(cs).some(b => /^💵 Deposit/.test(b)) && btns(cs).some(b => /crypto/i.test(b)) && /Email: poor@example.com/.test(txt(cs)) && /Auto-renew: off/.test(txt(cs)), txt(cs) + JSON.stringify(btns(cs)))
    // 15. French labels
    await db.collection('state').updateOne({ _id: FR }, { $set: { action: 'submenu6' } })
    cs = await say(FR, '📱 eSIM USA T-Mobile — 75 $/mois')
    check('15.French home', /SMS dans les deux sens/.test(txt(cs)) && btns(cs).includes('🛒 Acheter l’eSIM — 75 $/mois'), txt(cs))
  } finally {
    await cleanup()
    await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed`)
  process.exit(f.length ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
