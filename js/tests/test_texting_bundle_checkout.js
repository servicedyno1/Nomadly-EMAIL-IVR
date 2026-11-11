// Business Line + Texting Number bundle checkout (wallet and crypto). Run: node js/tests/test_texting_bundle_checkout.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const ES = require('../spenza.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${m}`) }

;(async () => {
  const cli = await MongoClient.connect(process.env.MONGO_URL)
  const db = cli.db('civr_bundle_test'); await db.dropDatabase()
  const bought = []
  let available = true
  ES.mobileOffer = async () => ({ available, price: 75, bundlePrice: 67.5, bundlePct: 10 })
  const walletOps = require('../cloudivr-web/wallet').walletOps(db)
  ES.buyMobile = async (chatId, o) => { if (!(await walletOps.debit(chatId, o.charge))) return { error: 'no funds' }; bought.push({ chatId, ...o }); return { item: { id: 'line1' } } }
  const routes = {}
  const router = { post: (p, f) => { routes[p] = f }, get: (p, f) => { routes['GET ' + p] = f } }
  const numbersApi = {
    pickFromSearch: async () => ({ hit: { phoneNumber: '+15550001111', surcharge: 0 }, country: 'US', type: 'local', areaCode: '555' }),
    purchase: async ({ chatId, phone, planKey }) => { const price = require('../phone-config').plans[planKey].price; if (!(await walletOps.debit(chatId, price))) return { status: 402, body: { message: 'low' } }; return { status: 201, body: { number: { phoneNumber: phone }, charged: price } } },
    checkCoupon: async () => ({ error: true, message: 'x' }),
  }
  const { routes: attach } = require('../cloudivr-web/orders')
  attach(router, { db, h: (f) => f, numbersApi, coins: ['USDT'], log: () => {} })
  const call = async (path, body, chatId = 'u1') => {
    let out = { status: 200 }
    const res = { status(s) { out.status = s; return this }, json(b) { out.body = b; return this } }
    await routes[path]({ body, webChatId: chatId, webUser: { email: 'a@b.c' }, params: body.params || {} }, res)
    return out
  }
  const fund = (id, usd) => db.collection('walletOf').updateOne({ _id: id }, { $set: { usdIn: usd, usdOut: 0 } }, { upsert: true })
  const plan = 'starter', line = require('../phone-config').plans.starter.price

  await fund('u1', line + 67.5 - 1)
  let r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'wallet', texting: { zipcode: '10011' } })
  ok(r.status === 402 && /Business Line and the Texting Number/.test(r.body.message) && !bought.length, 'wallet short for both → 402 before buying anything')
  r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'wallet', texting: { zipcode: '1001' } })
  ok(r.status === 400 && /5-digit/.test(r.body.message), 'bad ZIP rejected')
  available = false
  r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'wallet', texting: { zipcode: '10011' } })
  ok(r.status === 400 && /temporarily unavailable/.test(r.body.message), 'offer unavailable → clear error')
  available = true
  await fund('u1', line + 67.5)
  r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'wallet', texting: { zipcode: '10011' } })
  ok(r.status === 201 && r.body.texting?.item && bought[0]?.charge === 67.5 && bought[0].zipcode === '10011', 'wallet: line + Texting Number at bundle price')
  ok((await walletOps.balance('u1')) === 0, 'wallet charged line + $67.50 exactly')
  r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'wallet' })
  ok(r.status === 402 && bought.length === 1, 'no add-on → plain line checkout unchanged')

  r = await call('/numbers/checkout', { phoneNumber: '+15550001111', plan, method: 'crypto', coin: 'USDT', texting: { zipcode: '94105' } }, 'u2')
  ok(r.status === 201 && r.body.order.price === line + 67.5 && r.body.order.texting?.charge === 67.5, 'crypto: one invoice for line + Texting Number')
  r = await call('/numbers/orders/:id/simulate-payment', { params: { id: r.body.order.id } }, 'u2')
  ok(r.body.order.status === 'active' && bought[1]?.chatId === 'u2' && bought[1].zipcode === '94105' && /Texting Number is being set up/.test(r.body.order.message || ''), 'crypto paid → line active and Texting Number ordered')
  ok((await walletOps.balance('u2')) === 0, 'crypto payment fully used')
  await db.dropDatabase(); await cli.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
