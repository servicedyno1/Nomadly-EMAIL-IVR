#!/usr/bin/env node
// iter207: simulated BlockBee crypto callback for a bot eSIM digitalOrder → fulfillPaid → esimLines + delivered order; replay safety.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CR = '990206081'
const VALUE = process.env.VALUE_COIN || '76'
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const results = []
const check = (name, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 700) : ''}`) }
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf']) await db.collection(c).deleteMany({ _id: CR })
    await db.collection('esimLines').deleteMany({ chatId: CR })
    await db.collection('digitalOrders').deleteMany({ chatId: CR })
    await db.collection('transactions').deleteMany({ chatId: CR })
  }
  await cleanup()
  await db.collection('state').insertOne({ _id: CR, userLanguage: 'en', action: 'none' })
  await db.collection('walletOf').insertOne({ _id: CR, usdIn: 0, usdOut: 0 })
  const orderId = 'IT207' + Math.floor(Math.random() * 1000)
  await db.collection('digitalOrders').insertOne({ orderId, chatId: CR, product: 'USA T-Mobile eSIM', productKey: 'esim_spenza', price: 75, currency: 'crypto', paymentMethod: 'crypto_USDT (TRC20)', esim: { imei: '356938035643809', zipcode: '10001', email: null, autoRenew: false, planId: 'SPENZA_001' }, status: 'pending_payment', createdAt: new Date() })
  const ref = 'iter207w' + Date.now()
  await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: CR, price: 75, product: 'USA T-Mobile eSIM', orderId } } }, { upsert: true })
  try {
    const since = Date.now()
    const r = await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=${VALUE}`, { timeout: 30000 }).catch(e => e.response)
    await sleep(5000)
    const cs = (await axios.get(`${MOCK}/_calls?chat_id=${CR}&since=${since}`)).data
    const t = cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join('\n---\n')
    console.log('INFO status', r?.status, 'replies:', t)
    const line = await db.collection('esimLines').findOne({ chatId: CR })
    const o = await db.collection('digitalOrders').findOne({ orderId })
    const w = await db.collection('walletOf').findOne({ _id: CR })
    console.log('INFO wallet', JSON.stringify(w), 'order', o?.status, o?.esimLineId)
    check('line created source telegram, autoRenew off, qrEmail null, zip', line && line.source === 'telegram' && line.autoRenew === false && line.qrEmail === null && line.zipcode === '10001' && line.price === 75, JSON.stringify(line))
    check('order delivered + esimLineId', o?.status === 'delivered' && o?.esimLineId === line?._id, JSON.stringify(o))
    check('wallet: only the overpay remains', w && Math.abs((w.usdIn - w.usdOut)) < 2.5, JSON.stringify(w))
    check('Paid $75 message', /Paid \$75/.test(t), t)
    await axios.get(`http://localhost:5000/crypto-pay-digital-product?a=b&ref=${ref}&coin=trc20_usdt&value_coin=${VALUE}`, { timeout: 30000 }).catch(e => e.response)
    await sleep(2000)
    check('replay → still one line', (await db.collection('esimLines').countDocuments({ chatId: CR })) === 1)
  } finally {
    await db.collection('chatIdOfPayment').deleteOne({ _id: ref })
    await db.collection('payments').deleteOne({ _id: ref })
    await cleanup(); await mc.close()
  }
  console.log(`${results.filter(Boolean).length}/${results.length} passed`)
})().catch(e => { console.error(e.stack); process.exit(1) })
