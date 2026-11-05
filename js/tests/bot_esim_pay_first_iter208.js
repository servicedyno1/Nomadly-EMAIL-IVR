#!/usr/bin/env node
// iter208: Telegram eSIM pay-first (IMEI after payment) e2e against the REAL bot via mock Telegram API (:5099).
// Covers: wallet pay → awaiting_imei + state; Back → My eSIMs → Send IMEI; second IMEI refused; BlockBee crypto pay-first;
// imeiChase reminder (once/day) + 7-day refund through the live 15s tick.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const A = '990208001', CR = '990208002', CH = '990208003'
const ALL = [A, CR, CH]
let uid = 9_000_000 + Math.floor(Math.random() * 100000)
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
const GOOD = '356938035643809'

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const refs = []
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('esimLines').deleteMany({ chatId: { $in: ALL } })
    await db.collection('digitalOrders').deleteMany({ chatId: { $in: ALL.map(Number).concat(ALL) } })
    await db.collection('transactions').deleteMany({ chatId: { $in: ALL } })
  }
  await cleanup()
  for (const [id, usd] of [[A, 100], [CR, 0], [CH, 0]]) {
    await db.collection('state').insertOne({ _id: id, userLanguage: 'en', action: 'submenu6' })
    await db.collection('walletOf').insertOne({ _id: id, usdIn: usd, usdOut: 0 })
  }
  const bal = async id => { const w = await db.collection('walletOf').findOne({ _id: id }); return (w.usdIn || 0) - (w.usdOut || 0) }
  try {
    // ── A. Wallet pay-first ──
    let cs = await say(A, '📱 USA T-Mobile eSIM — $75/month')
    cs = await say(A, '🛒 Buy eSIM — $75/month')
    check('A1.buy → ZIP step first (no IMEI)', /ZIP/.test(txt(cs)) && !/15-digit IMEI/.test(txt(cs)) && btns(cs).includes('⏭ Skip'), txt(cs))
    cs = await say(A, '⏭ Skip')
    check('A2.ZIP skip → email step with Skip', /email/i.test(txt(cs)) && btns(cs).includes('⏭ Skip'), txt(cs))
    cs = await say(A, '⏭ Skip')
    check('A3.email skip → auto-renew', btns(cs).includes('✅ Auto-renew on (recommended)'), JSON.stringify(btns(cs)))
    cs = await say(A, '✅ Auto-renew on (recommended)', 3000)
    check('A4.summary: IMEI after paying, ZIP any', /IMEI: you send it after paying/.test(txt(cs)) && /ZIP: any/.test(txt(cs)), txt(cs))
    const wb = btns(cs).find(b => /^👛 /.test(b))
    cs = await say(A, wb, 4000)
    check('A5.wallet pay → Paid $75 + one last step IMEI', /Paid \$75\. One last step: send your phone’s 15-digit IMEI/.test(txt(cs)), txt(cs))
    check('A5.keyboard only Back', JSON.stringify(btns(cs)) === JSON.stringify(['↩️ Back']), JSON.stringify(btns(cs)))
    let st = await db.collection('state').findOne({ _id: A })
    let line = await db.collection('esimLines').findOne({ chatId: A })
    const ord = await db.collection('digitalOrders').findOne({ chatId: { $in: [A, Number(A)] } })
    check('A6.state action esim-bot-imei + esimPendingLine', st.action === 'esim-bot-imei' && st.esimPendingLine === line?._id, JSON.stringify({ a: st.action, p: st.esimPendingLine }))
    check('A6.line awaiting_imei, source telegram, no imei, zip null', line && line.status === 'awaiting_imei' && line.source === 'telegram' && !line.imei && line.zipcode === null, JSON.stringify(line))
    check('A6.digitalOrders paid_awaiting_imei + esimLineId', ord?.status === 'paid_awaiting_imei' && ord?.esimLineId === line?._id, JSON.stringify(ord))
    check('A6.wallet charged once ($25 left)', (await bal(A)) === 25, await bal(A))
    cs = await say(A, '12345')
    check('A7.invalid IMEI rejected, still waiting', /isn’t a valid IMEI/.test(txt(cs)) && (await db.collection('esimLines').findOne({ _id: line._id })).status === 'awaiting_imei' && (await db.collection('state').findOne({ _id: A })).action === 'esim-bot-imei', txt(cs))
    cs = await say(A, '356938035643808') // Luhn-invalid
    check('A7.Luhn-invalid IMEI rejected', /isn’t a valid IMEI/.test(txt(cs)), txt(cs))
    // Back → line stays waiting
    cs = await say(A, '↩️ Back')
    line = await db.collection('esimLines').findOne({ _id: line._id })
    check('A8.Back → line still awaiting_imei', line.status === 'awaiting_imei', line.status)
    cs = await say(A, '📋 My eSIMs')
    const lb = btns(cs).find(b => b.endsWith(line._id.slice(-6)))
    check('A9.My eSIMs lists the waiting line', !!lb, JSON.stringify(btns(cs)))
    cs = await say(A, lb)
    check('A10.line shows Paid — waiting for your IMEI + Send IMEI button', /Paid — waiting for your IMEI/.test(txt(cs)) && btns(cs).includes('📟 Send IMEI'), txt(cs) + JSON.stringify(btns(cs)))
    check('A10.no auto-renew toggle/QR for waiting line', !btns(cs).some(b => /auto-renew|QR/i.test(b)), JSON.stringify(btns(cs)))
    console.log('INFO list label:', lb)
    cs = await say(A, '📟 Send IMEI')
    check('A11.Send IMEI asks for IMEI', /15-digit IMEI/.test(txt(cs)), txt(cs))
    cs = await say(A, GOOD, 4000)
    line = await db.collection('esimLines').findOne({ _id: line._id })
    check('A12.valid IMEI → being set up', /being set up/.test(txt(cs)), txt(cs))
    check('A12.line provisioning simulated with IMEI', ['provisioning', 'active'].includes(line.status) && line.imei === GOOD && line.simulated === true, JSON.stringify(line))
    check('A12.no extra charge', (await bal(A)) === 25, await bal(A))
    check('A12.state reset', (await db.collection('state').findOne({ _id: A })).action !== 'esim-bot-imei')
    // Second IMEI for the same line is refused
    await db.collection('state').updateOne({ _id: A }, { $set: { action: 'esim-bot-imei', esimPendingLine: line._id } })
    cs = await say(A, '490154203237518')
    check('A13.second IMEI refused', /no longer waiting/.test(txt(cs)) && (await db.collection('esimLines').findOne({ _id: line._id })).imei === GOOD, txt(cs))
    const o2 = await db.collection('digitalOrders').findOne({ chatId: { $in: [A, Number(A)] } })
    console.log('INFO digitalOrder status after IMEI sent:', o2?.status)

    // ── B. BlockBee crypto pay-first ──
    await db.collection('state').updateOne({ _id: CR }, { $set: { action: 'none' } })
    const orderId = 'IT208' + Math.floor(Math.random() * 1000)
    await db.collection('digitalOrders').insertOne({ orderId, chatId: CR, product: 'USA T-Mobile eSIM', productKey: 'esim_spenza', price: 75, currency: 'crypto', paymentMethod: 'crypto_USDT (TRC20)', esim: { zipcode: null, email: null, autoRenew: true, planId: (await db.collection('esimLines').findOne({ _id: line._id })).planId }, status: 'pending_payment', createdAt: new Date() })
    const ref = 'iter208w' + Date.now(); refs.push(ref)
    await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: CR, price: 75, product: 'USA T-Mobile eSIM', orderId } } }, { upsert: true })
    let since = Date.now()
    const r = await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=77`, { timeout: 30000 }).catch(e => e.response)
    await sleep(5000)
    cs = await calls(CR, since)
    const cl = await db.collection('esimLines').findOne({ chatId: CR })
    st = await db.collection('state').findOne({ _id: CR })
    const co = await db.collection('digitalOrders').findOne({ orderId })
    console.log('INFO crypto http', r?.status, 'order status', co?.status, 'wallet', await bal(CR))
    check('B1.crypto → line awaiting_imei, source telegram', cl && cl.status === 'awaiting_imei' && cl.source === 'telegram' && !cl.imei, JSON.stringify(cl))
    check('B1.state esim-bot-imei + esimPendingLine', st.action === 'esim-bot-imei' && st.esimPendingLine === cl?._id, JSON.stringify(st))
    check('B1.message asks for IMEI', /Paid \$75/.test(txt(cs)) && /15-digit IMEI/.test(txt(cs)), txt(cs))
    check('B1.wallet credited then charged (only overpay left)', (await bal(CR)) >= 0 && (await bal(CR)) < 3, await bal(CR))
    check('B1.digitalOrders status', co?.status === 'paid_awaiting_imei', `status=${co?.status} (wallet path uses paid_awaiting_imei)`)
    cs = await say(CR, GOOD, 4000)
    check('B2.IMEI after crypto → being set up', /being set up/.test(txt(cs)) && (await db.collection('esimLines').findOne({ _id: cl._id })).imei === GOOD, txt(cs))

    // ── C. imeiChase via live tick ──
    const plan = cl.planId
    const mk = (id, ageDays) => ({ _id: id, chatId: CH, planId: plan, price: 75, imei: null, zipcode: null, simId: 'x', qrEmail: null, autoRenew: true, status: 'awaiting_imei', callsTo: 'device', source: 'telegram', lang: 'en', createdAt: new Date(Date.now() - ageDays * 86400000), updatedAt: new Date() })
    await db.collection('esimLines').insertMany([mk('es_it208rem', 2), mk('es_it208ref', 8), mk('es_it208new', 0.2)])
    since = Date.now()
    await sleep(20000)
    cs = await calls(CH, since)
    const rem = await db.collection('esimLines').findOne({ _id: 'es_it208rem' })
    const rf = await db.collection('esimLines').findOne({ _id: 'es_it208ref' })
    const nw = await db.collection('esimLines').findOne({ _id: 'es_it208new' })
    check('C1.2-day line reminded (imeiRemindedAt set, still waiting)', rem.status === 'awaiting_imei' && !!rem.imeiRemindedAt, JSON.stringify(rem))
    check('C1.reminder message (5 days left)', /waiting for your phone’s IMEI/.test(txt(cs)) && /within 5 day/.test(txt(cs)), txt(cs))
    check('C2.8-day line cancelled + refund $75', rf.status === 'cancelled' && (await bal(CH)) === 75, JSON.stringify({ s: rf.status, b: await bal(CH) }))
    check('C2.refund message', /cancelled because no IMEI was sent within 7 days\. \$75 was refunded/.test(txt(cs)), txt(cs))
    check('C3.fresh line not reminded', !nw.imeiRemindedAt && nw.status === 'awaiting_imei', JSON.stringify(nw))
    const n1 = (txt(cs).match(/waiting for your phone’s IMEI/g) || []).length
    since = Date.now()
    await sleep(17000)
    cs = await calls(CH, since)
    check('C4.only one reminder per day / one refund', n1 === 1 && !/IMEI|refunded/.test(txt(cs)) && (await bal(CH)) === 75, `first=${n1} later=${txt(cs)}`)
  } finally {
    for (const ref of refs) { await db.collection('chatIdOfPayment').deleteOne({ _id: ref }); await db.collection('payments').deleteOne({ _id: ref }) }
    await cleanup(); await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.name).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})().catch(e => { console.error(e.stack); process.exit(1) })
