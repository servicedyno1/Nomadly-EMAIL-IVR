#!/usr/bin/env node
// iter210: return to a paid eSIM order and send the IMEI later (REAL bot + mock Telegram :5099).
//  A) wallet pay → Back at IMEI prompt → eSIM home shows waiting note + top button → Main Menu → /imei → IMEI → provisioning;
//     eSIM home afterwards has no note/button.
//  B) wallet pay → Main Menu at IMEI prompt → Digital Products → eSIM → top button → IMEI prompt → IMEI → provisioning.
//  M) two paid lines waiting → /imei and top button open My eSIMs list; pick line → 📟 Send IMEI → IMEI works (path c).
//  N) none waiting → /imei → 'no paid eSIM waiting' + eSIM home without note/button.
//  T) texts: paidAskImei + imeiRemind mention /imei; fr/hi/zh sendImeiPaid/waitingNote/noneWaiting exist.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const esimBot = require('../esim-bot')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const A = '990210001', B = '990210002', M = '990210003', N = '990210004'
const ALL = [A, B, M, N]
let uid = 9_300_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, d = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 700) : ''}`) }
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
const GOOD = '356938035643809', GOOD2 = '490154203237518'
const es = esimBot.s('en')
const ESIM_BTN = '📱 USA T-Mobile eSIM — $75/month'
const NOTE = /Your paid eSIM is waiting for your IMEI/
const ASK = /Send your phone’s 15-digit IMEI/

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
  for (const [id, usd] of [[A, 100], [B, 100], [M, 200], [N, 100]]) {
    await db.collection('state').insertOne({ _id: id, userLanguage: 'en', action: 'submenu6' })
    await db.collection('walletOf').insertOne({ _id: id, usdIn: usd, usdOut: 0 })
  }
  const toSubmenu6 = id => db.collection('state').updateOne({ _id: id }, { $set: { action: 'submenu6' } })
  const payWallet = async (chat) => {
    await toSubmenu6(chat)
    await say(chat, ESIM_BTN)
    await say(chat, es.buy(75))
    await say(chat, '⏭ Skip'); await say(chat, '⏭ Skip')
    let cs = await say(chat, '✅ Auto-renew on (recommended)', 3000)
    const wb = btns(cs).find(b => /^👛 /.test(b))
    return say(chat, wb, 4000)
  }
  try {
    // ── A. Back at prompt → home note → Main Menu → /imei ──
    let cs = await payWallet(A)
    let line = await db.collection('esimLines').findOne({ chatId: A })
    check('A1.paid → awaiting_imei', line?.status === 'awaiting_imei', JSON.stringify(line))
    check('A1.post-payment prompt mentions /imei + My eSIMs', /You can also send it later: type \/imei or open 📋 My eSIMs/.test(txt(cs)), txt(cs))
    cs = await say(A, '↩️ Back')
    check('A2.Back → eSIM home starts with waiting note', NOTE.test(txt(cs).split('\n')[0]), txt(cs))
    check('A2.top button is Send IMEI for my paid eSIM', btns(cs)[0] === es.sendImeiPaid, JSON.stringify(btns(cs)))
    cs = await say(A, '🏠 Main Menu')
    const st = await db.collection('state').findOne({ _id: A })
    console.log('INFO action after Main Menu:', st?.action)
    cs = await say(A, '/imei')
    check('A3./imei from main menu → IMEI prompt', ASK.test(txt(cs)), txt(cs))
    check('A3.state esim-bot-imei + pending line', (await db.collection('state').findOne({ _id: A }))?.action === 'esim-bot-imei', '')
    cs = await say(A, GOOD, 4000)
    line = await db.collection('esimLines').findOne({ _id: line._id })
    check('A4.IMEI → being set up, line provisioning', /being set up/.test(txt(cs)) && line.imei === GOOD && ['provisioning', 'active'].includes(line.status), JSON.stringify({ t: txt(cs), s: line.status }))
    await toSubmenu6(A)
    cs = await say(A, ESIM_BTN)
    check('A5.after IMEI: eSIM home has no note/button', !NOTE.test(txt(cs)) && !btns(cs).includes(es.sendImeiPaid) && btns(cs).includes(es.mine), JSON.stringify({ t: txt(cs).slice(0, 120), b: btns(cs) }))

    // ── B. Main Menu at prompt → Digital Products → eSIM → top button ──
    cs = await payWallet(B)
    cs = await say(B, '🏠 Main Menu')
    console.log('INFO B Main Menu reply:', txt(cs).slice(0, 80))
    await toSubmenu6(B)
    cs = await say(B, ESIM_BTN)
    check('B1.eSIM home note + top button', NOTE.test(txt(cs)) && btns(cs)[0] === es.sendImeiPaid, JSON.stringify({ t: txt(cs).slice(0, 120), b: btns(cs) }))
    cs = await say(B, es.sendImeiPaid)
    check('B2.top button → IMEI prompt (with Back)', ASK.test(txt(cs)) && btns(cs).includes('↩️ Back'), JSON.stringify({ t: txt(cs), b: btns(cs) }))
    cs = await say(B, GOOD, 4000)
    const lb = await db.collection('esimLines').findOne({ chatId: B })
    check('B3.IMEI → being set up', /being set up/.test(txt(cs)) && lb?.imei === GOOD && lb.status !== 'awaiting_imei', JSON.stringify({ t: txt(cs), s: lb?.status }))

    // ── M. two waiting lines ──
    await payWallet(M); await say(M, '↩️ Back')
    await payWallet(M)
    const ml = await db.collection('esimLines').find({ chatId: M }).toArray()
    check('M0.two lines awaiting_imei, wallet $50', ml.length === 2 && ml.every(l => l.status === 'awaiting_imei'), JSON.stringify(ml.map(l => l.status)))
    await say(M, '🏠 Main Menu')
    cs = await say(M, '/imei')
    const waitLbl = `📱 ${es.status.awaiting_imei}`
    check('M1./imei with 2 waiting → My eSIMs list with both', /My eSIMs/.test(txt(cs)) && btns(cs).filter(b => b.startsWith(waitLbl)).length === 2 && !ASK.test(txt(cs)), JSON.stringify({ t: txt(cs), b: btns(cs) }))
    await say(M, '↩️ Back') // back to eSIM home
    cs = await say(M, es.sendImeiPaid)
    check('M2.top button with 2 waiting → list', /My eSIMs/.test(txt(cs)) && btns(cs).filter(b => b.startsWith(waitLbl)).length === 2, JSON.stringify({ t: txt(cs), b: btns(cs) }))
    const pick = btns(cs).find(b => b.endsWith(ml[0]._id.slice(-6)))
    await say(M, pick)
    cs = await say(M, es.sendImei)
    check('M3.line → 📟 Send IMEI → prompt (path c)', ASK.test(txt(cs)), txt(cs))
    cs = await say(M, GOOD2, 4000)
    const m0 = await db.collection('esimLines').findOne({ _id: ml[0]._id }), m1 = await db.collection('esimLines').findOne({ _id: ml[1]._id })
    check('M4.only the picked line got the IMEI', m0.imei === GOOD2 && m0.status !== 'awaiting_imei' && m1.status === 'awaiting_imei', JSON.stringify({ a: [m0.status, m0.imei], b: [m1.status, m1.imei] }))
    cs = await say(M, '/imei')
    check('M5.one left → /imei goes straight to prompt', ASK.test(txt(cs)), txt(cs))
    cs = await say(M, '🏠 Main Menu')
    check('M5.Main Menu at /imei prompt → main menu (global handler), line still waiting', /Select an option|Choose a service/.test(txt(cs)), txt(cs).slice(0, 150))

    // ── N. none waiting ──
    await db.collection('state').updateOne({ _id: N }, { $set: { action: 'none' } })
    cs = await say(N, '/imei')
    check('N1./imei none → noneWaiting text', /You have no paid eSIM waiting for an IMEI\./.test(txt(cs)), txt(cs))
    check('N1.then eSIM home without note/button', /USA T-Mobile eSIM — \$75\/month/.test(txt(cs)) && !NOTE.test(txt(cs)) && !btns(cs).includes(es.sendImeiPaid) && btns(cs).includes(es.buy(75)), JSON.stringify(btns(cs)))
    check('N1.state esim-bot-home', (await db.collection('state').findOne({ _id: N }))?.action === 'esim-bot-home', '')

    // ── T. texts ──
    for (const lg of ['fr', 'hi', 'zh']) {
      const x = esimBot.s(lg)
      check(`T.${lg} sendImeiPaid/waitingNote/noneWaiting exist & differ from en`, x.sendImeiPaid && x.waitingNote && x.noneWaiting && x.sendImeiPaid !== es.sendImeiPaid && x.waitingNote.includes('/imei') && x.waitingNote.includes(x.sendImeiPaid), lg)
      check(`T.${lg} paidAskImei + imeiRemind mention /imei`, x.paidAskImei(75).includes('/imei') && esimBot.notice(lg, 'imeiRemind', 3, 75).includes('/imei'), lg)
    }
    check('T.en imeiRemind text', /Type \/imei \(or open 📋 My eSIMs/.test(esimBot.notice('en', 'imeiRemind', 3, 75)), esimBot.notice('en', 'imeiRemind', 3, 75))
  } finally {
    await cleanup(); await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.name).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})().catch(e => { console.error(e.stack); process.exit(1) })
