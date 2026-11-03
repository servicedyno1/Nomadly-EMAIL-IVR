#!/usr/bin/env node
// iter209 retest via the REAL bot + mock Telegram (:5099):
//  L) wallet pay-first, age the line's createdAt by 2 days, then send IMEI via My eSIMs → line must NOT fail/refund;
//     provisionStartedAt set; simulated line becomes active ~20s after the IMEI (not instantly); digitalOrders → delivered.
//  C) BlockBee crypto pay-first → digitalOrders paid_awaiting_imei (deliveredAt null) → IMEI → delivered.
//  R) BlockBee crypto pay-first, aged 8 days → 7-day refund via live tick → digitalOrders refunded_no_imei.
//  Also: My eSIMs label for waiting line reads '📱 📟 Paid — waiting for your IMEI · xxxxxx'.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const L = '990209001', C = '990209002', R = '990209003'
const ALL = [L, C, R]
let uid = 9_100_000 + Math.floor(Math.random() * 100000)
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
  for (const [id, usd] of [[L, 100], [C, 0], [R, 0]]) {
    await db.collection('state').insertOne({ _id: id, userLanguage: 'en', action: 'submenu6' })
    await db.collection('walletOf').insertOne({ _id: id, usdIn: usd, usdOut: 0 })
  }
  const bal = async id => { const w = await db.collection('walletOf').findOne({ _id: id }); return (w.usdIn || 0) - (w.usdOut || 0) }
  const cryptoPay = async (chat) => {
    const planId = (await db.collection('esimLines').findOne({ chatId: L }))?.planId
    await db.collection('state').updateOne({ _id: chat }, { $set: { action: 'none' } })
    const orderId = 'IT209' + chat.slice(-1) + Math.floor(Math.random() * 1000)
    await db.collection('digitalOrders').insertOne({ orderId, chatId: chat, product: 'USA T-Mobile eSIM', productKey: 'esim_spenza', price: 75, currency: 'crypto', paymentMethod: 'crypto_USDT (TRC20)', esim: { zipcode: null, email: null, autoRenew: true, planId }, status: 'pending_payment', createdAt: new Date() })
    const ref = 'iter209' + chat.slice(-1) + Date.now(); refs.push(ref)
    await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: chat, price: 75, product: 'USA T-Mobile eSIM', orderId } } }, { upsert: true })
    await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=77`, { timeout: 30000 }).catch(e => e.response)
    await sleep(5000)
    return orderId
  }
  try {
    // ── L. late IMEI via the bot ──
    await say(L, '📱 USA T-Mobile eSIM — $75/month')
    await say(L, '🛒 Buy eSIM — $75/month')
    await say(L, '⏭ Skip'); await say(L, '⏭ Skip')
    let cs = await say(L, '✅ Auto-renew on (recommended)', 3000)
    const wb = btns(cs).find(b => /^👛 /.test(b))
    cs = await say(L, wb, 4000)
    let line = await db.collection('esimLines').findOne({ chatId: L })
    check('L1.paid → awaiting_imei, wallet $25', line?.status === 'awaiting_imei' && (await bal(L)) === 25, JSON.stringify({ s: line?.status, b: await bal(L) }))
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000)
    await db.collection('esimLines').updateOne({ _id: line._id }, { $set: { createdAt: twoDaysAgo } })
    await db.collection('digitalOrders').updateOne({ esimLineId: line._id }, { $set: { createdAt: twoDaysAgo } })
    await say(L, '↩️ Back')
    cs = await say(L, '📋 My eSIMs')
    const lb = btns(cs).find(b => b.endsWith(line._id.slice(-6)))
    console.log('INFO list label:', lb)
    check('L2.My eSIMs label = 📱 📟 Paid — waiting for your IMEI · xxxxxx', lb === `📱 📟 Paid — waiting for your IMEI · ${line._id.slice(-6)}`, lb)
    cs = await say(L, lb)
    cs = await say(L, '📟 Send IMEI')
    const tImei = Date.now()
    cs = await say(L, GOOD, 4000)
    line = await db.collection('esimLines').findOne({ _id: line._id })
    check('L3.IMEI accepted → being set up', /being set up/.test(txt(cs)) && line.imei === GOOD, txt(cs))
    check('L3.provisionStartedAt set (≈ now), createdAt unchanged', line.provisionStartedAt && Math.abs(new Date(line.provisionStartedAt).getTime() - tImei) < 10000 && new Date(line.createdAt).getTime() === twoDaysAgo.getTime(), JSON.stringify({ p: line.provisionStartedAt, c: line.createdAt }))
    const ord = await db.collection('digitalOrders').findOne({ esimLineId: line._id })
    check('L3.digitalOrders → delivered + deliveredAt', ord?.status === 'delivered' && !!ord?.deliveredAt, JSON.stringify(ord))
    await sleep(8000) // one+ tick, still <20s since IMEI
    line = await db.collection('esimLines').findOne({ _id: line._id })
    check('L4.not instantly active/failed (20s simulated delay from provisionStartedAt)', line.status === 'provisioning', line.status)
    await sleep(25000)
    line = await db.collection('esimLines').findOne({ _id: line._id })
    const lcs = await calls(L, tImei)
    check('L5.line becomes active (not failed), no refund', line.status === 'active' && (await bal(L)) === 25, JSON.stringify({ s: line.status, err: line.providerError, b: await bal(L) }))
    check('L5.no refund message to user', !/refunded/.test(txt(lcs)), txt(lcs))

    // ── C. crypto pay-first digitalOrders lifecycle ──
    const oC = await cryptoPay(C)
    let co = await db.collection('digitalOrders').findOne({ orderId: oC })
    const cl = await db.collection('esimLines').findOne({ chatId: C })
    check('C1.crypto → digitalOrders paid_awaiting_imei, deliveredAt null, esimLineId', co?.status === 'paid_awaiting_imei' && !co.deliveredAt && co.esimLineId === cl?._id, JSON.stringify(co))
    cs = await say(C, GOOD, 4000)
    co = await db.collection('digitalOrders').findOne({ orderId: oC })
    check('C2.after IMEI → delivered + deliveredAt', co?.status === 'delivered' && !!co.deliveredAt, JSON.stringify(co))

    // ── R. crypto pay-first, 7-day refund ──
    const oR = await cryptoPay(R)
    const rl = await db.collection('esimLines').findOne({ chatId: R })
    const bR0 = await bal(R)
    check('R0.crypto line awaiting_imei', rl?.status === 'awaiting_imei', JSON.stringify(rl))
    await db.collection('esimLines').updateOne({ _id: rl._id }, { $set: { createdAt: new Date(Date.now() - 8 * 86400000) } })
    await sleep(20000)
    const rl2 = await db.collection('esimLines').findOne({ _id: rl._id })
    const ro = await db.collection('digitalOrders').findOne({ orderId: oR })
    check('R1.line cancelled + $75 refunded', rl2.status === 'cancelled' && (await bal(R)) - bR0 === 75, JSON.stringify({ s: rl2.status, d: (await bal(R)) - bR0 }))
    check('R1.digitalOrders → refunded_no_imei + refundedAt', ro?.status === 'refunded_no_imei' && !!ro.refundedAt, JSON.stringify(ro))
  } finally {
    for (const ref of refs) { await db.collection('chatIdOfPayment').deleteOne({ _id: ref }); await db.collection('payments').deleteOne({ _id: ref }) }
    await cleanup(); await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.name).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})().catch(e => { console.error(e.stack); process.exit(1) })
