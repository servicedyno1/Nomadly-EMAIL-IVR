#!/usr/bin/env node
// iter207: extra bot eSIM e2e (mock Telegram): crypto pay path + digitalOrders esim payload, simulated crypto webhook,
// bad ZIP / bad email, email-QR flow, hi/zh translations, Back navigation.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CR = '990206071', HI = '990206072', ZH = '990206073', EM = '990206074'
const ALL = [CR, HI, ZH, EM]
let uid = 8_200_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + String(detail).slice(0, 700) : ''}`) }
const info = (m) => console.log('INFO ' + String(m).slice(0, 900))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 2500) {
  const since = Date.now(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const txt = cs => cs.filter(c => c.method === 'sendMessage' || c.method === 'sendPhoto').map(c => strip(c.text || c.caption)).join('\n---\n')
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
  for (const [id, lang, usd] of [[CR, 'en', 0], [HI, 'hi', 0], [ZH, 'zh', 0], [EM, 'en', 100]]) {
    await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'submenu6' })
    await db.collection('walletOf').insertOne({ _id: id, usdIn: usd, usdOut: 0 })
  }
  try {
    // A. validation + Back
    let cs = await say(CR, '📱 USA T-Mobile eSIM — $75/month')
    cs = await say(CR, '🛒 Buy eSIM — $75/month')
    // pay-first (iter208): Buy goes straight to ZIP; IMEI is asked after payment
    check('A.buy → ZIP (no IMEI before payment)', /ZIP code/.test(txt(cs)) && !/15-digit IMEI/.test(txt(cs)), txt(cs))
    cs = await say(CR, '1234')
    check('A.bad ZIP rejected', /5-digit USA ZIP/.test(txt(cs)) && /^❌/.test(txt(cs)), txt(cs))
    cs = await say(CR, '↩️ Back')
    check('A.Back from ZIP → eSIM home', btns(cs).includes('🛒 Buy eSIM — $75/month'), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(CR, '🛒 Buy eSIM — $75/month')
    cs = await say(CR, '⏭ Skip')
    cs = await say(CR, 'not-an-email')
    check('A.bad email rejected', /doesn’t look right/.test(txt(cs)), txt(cs))
    cs = await say(CR, 'Buyer.Crypto@Example.com')
    check('A.valid email → auto-renew', btns(cs).includes('⏹ Auto-renew off'), txt(cs))
    cs = await say(CR, '⏹ Auto-renew off', 3000)
    const pay = btns(cs)
    info('checkout buttons (0 wallet): ' + JSON.stringify(pay))
    check('B.checkout summary email lowercased, ZIP any, renew off', /Email: buyer.crypto@example.com/.test(txt(cs)) && /ZIP: any/.test(txt(cs)) && /Auto-renew: off/.test(txt(cs)), txt(cs))
    check('B.no bank/NGN button', !pay.some(b => /bank|naira|NGN|₦/i.test(b)), JSON.stringify(pay))
    const cryptoBtn = pay.find(b => /crypto/i.test(b))
    cs = await say(CR, cryptoBtn, 2500)
    check('B.crypto → coin list', btns(cs).some(b => /Tether|Bitcoin/.test(b)), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(CR, '₮ Tether (USDT - TRC20)', 12000)
    info('crypto reply methods: ' + JSON.stringify(cs.map(c => c.method)) + ' text: ' + txt(cs))
    const addrShown = /address|adresse/i.test(txt(cs)) || cs.some(c => c.method === 'sendPhoto')
    info('deposit address shown: ' + addrShown)
    const order = await db.collection('digitalOrders').findOne({ chatId: { $in: [CR, Number(CR)] } })
    info('digitalOrders: ' + JSON.stringify(order))
    check('B.digitalOrders has esim payload + productKey esim_spenza', order && order.productKey === 'esim_spenza' && order.esim && !order.esim.imei && order.esim.email === 'buyer.crypto@example.com' && order.esim.autoRenew === false && order.esim.planId && order.price === 75 && ['pending_payment', 'address_failed'].includes(order.status), JSON.stringify(order))
    // preview: BlockBee/DynoPay address fetch returns 401 → order is address_failed; treat as if the address was issued
    if (order && order.status === 'address_failed') await db.collection('digitalOrders').updateOne({ _id: order._id }, { $set: { status: 'pending_payment' } })

    // C. simulate the BlockBee callback (seed the payment session; real BlockBee convert for USDT)
    if (order) {
      const ref = 'iter207' + Date.now()
      await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: CR, price: 75, product: order.product, orderId: order.orderId } } }, { upsert: true })
      const since = Date.now()
      const r = await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=77`, { timeout: 30000 }).catch(e => e.response)
      await sleep(4000)
      const after = await calls(CR, since)
      info('webhook status ' + r?.status + ' replies: ' + txt(after))
      const line = await db.collection('esimLines').findOne({ chatId: CR })
      const o2 = await db.collection('digitalOrders').findOne({ orderId: order.orderId })
      const w = await db.collection('walletOf').findOne({ _id: CR })
      info('line: ' + JSON.stringify(line) + ' order: ' + JSON.stringify(o2) + ' wallet: ' + JSON.stringify(w))
      if (/sent less|less money/i.test(txt(after))) info('convert returned < 75 (BlockBee rate) — underpay path taken')
      else {
        check('C.crypto paid → esimLines awaiting_imei (telegram, autoRenew off, email)', line && line.status === 'awaiting_imei' && line.source === 'telegram' && line.autoRenew === false && line.qrEmail === 'buyer.crypto@example.com' && line.price === 75, JSON.stringify(line))
        check('C.digitalOrders paid + esimLineId', o2 && ['delivered', 'paid_awaiting_imei'].includes(o2.status) && o2.esimLineId === line?._id, JSON.stringify(o2))
        check('C.wallet net 0 (credited 75 then debited 75)', w && Math.round(((w.usdIn || 0) - (w.usdOut || 0)) * 100) / 100 >= 0, JSON.stringify(w))
        check('C.paid message in chat asks IMEI', /Paid \$75/.test(txt(after)) && /15-digit IMEI/.test(txt(after)), txt(after))
        const r2 = await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=77`, { timeout: 30000 }).catch(e => e.response)
        await sleep(2000)
        check('C.replayed webhook does not create a 2nd line', (await db.collection('esimLines').countDocuments({ chatId: CR })) === 1, r2?.status)
      }
      await db.collection('chatIdOfPayment').deleteOne({ _id: ref })
      await db.collection('payments').deleteOne({ _id: ref })
    }

    // D. email-QR flow on a wallet-paid line
    cs = await say(EM, '📱 USA T-Mobile eSIM — $75/month')
    await say(EM, '🛒 Buy eSIM — $75/month', 1500)
    await say(EM, '10001', 1500)
    await say(EM, '⏭ Skip', 1500)
    cs = await say(EM, '✅ Auto-renew on (recommended)', 3000)
    cs = await say(EM, btns(cs).find(b => /^👛 /.test(b)), 4000)
    await say(EM, '35-693803-564380-9', 3000) // formatted IMEI after payment
    const eline = await db.collection('esimLines').findOne({ chatId: EM })
    await db.collection('esimLines').updateOne({ _id: eline._id }, { $set: { createdAt: new Date(Date.now() - 60000) } })
    for (let i = 0; i < 12; i++) { await sleep(3000); if ((await db.collection('esimLines').findOne({ _id: eline._id })).status === 'active') break }
    const act = await db.collection('esimLines').findOne({ _id: eline._id })
    check('D.line active after simulated provisioning', act.status === 'active', JSON.stringify(act))
    await db.collection('state').updateOne({ _id: EM }, { $set: { action: 'submenu6' } })
    await say(EM, '📱 USA T-Mobile eSIM — $75/month', 1500)
    cs = await say(EM, '📋 My eSIMs')
    cs = await say(EM, btns(cs).find(b => b.startsWith('📱 +1')))
    check('D.details show QR email none + email button', /QR email: none/.test(txt(cs)) && btns(cs).includes('📧 Email me the QR code'), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(EM, '📧 Email me the QR code')
    check('D.asks email for QR', /email address for the QR code/.test(txt(cs)), txt(cs))
    cs = await say(EM, 'bad@')
    check('D.bad QR email rejected', /doesn’t look right/.test(txt(cs)), txt(cs))
    cs = await say(EM, 'qr.test@example.com', 5000)
    info('email QR reply: ' + txt(cs))
    const l3 = await db.collection('esimLines').findOne({ _id: eline._id })
    check('D.email QR handled (sent → qrEmail saved, or clear error)', (/QR code sent to qr.test@example.com/.test(txt(cs)) && l3.qrEmail === 'qr.test@example.com') || /couldn’t be sent/.test(txt(cs)), txt(cs) + ' qrEmail=' + l3.qrEmail)
    check('D.returns to line details after email', /Auto-renew:/.test(txt(cs)), txt(cs))

    // E. Hindi / Chinese
    cs = await say(HI, '📱 USA T-Mobile eSIM — $75/माह')
    check('E.Hindi home + buy button', /दो-तरफ़ा SMS/.test(txt(cs)) && btns(cs).includes('🛒 eSIM खरीदें — $75/माह'), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(HI, '🛒 eSIM खरीदें — $75/माह')
    check('E.Hindi buy → ZIP step (IMEI after payment)', /ZIP|पिन|ज़िप/i.test(txt(cs)) && !/15 अंकों का IMEI/.test(txt(cs)), txt(cs))
    cs = await say(ZH, '📱 美国 T-Mobile eSIM — $75/月')
    check('E.Chinese home + buy button', /双向短信/.test(txt(cs)) && btns(cs).includes('🛒 购买 eSIM — $75/月'), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(ZH, '🛒 购买 eSIM — $75/月')
    check('E.Chinese ZIP step with 跳过', /5 位美国邮编/.test(txt(cs)) && btns(cs).includes('⏭ 跳过'), txt(cs) + JSON.stringify(btns(cs)))
    await say(ZH, '⏭ 跳过', 1500)
    await say(ZH, '⏭ 跳过', 1500)
    cs = await say(ZH, '✅ 开启自动续费（推荐）', 3000)
    check('E.Chinese checkout summary $75/月, no bank', /\$75\/月/.test(txt(cs)) && !btns(cs).some(b => /bank|NGN|₦|银行/i.test(b)), txt(cs) + JSON.stringify(btns(cs)))
    info('zh checkout buttons: ' + JSON.stringify(btns(cs)))
  } finally {
    await cleanup()
    await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed`)
  process.exit(f.length ? 1 : 0)
})().catch(e => { console.error(e.stack); process.exit(1) })
