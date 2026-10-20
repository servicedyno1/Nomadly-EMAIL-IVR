// Sandbox: hosting loyalty/coupon discounts and upgrade credits come out of profit (cost = 70% of LIST).
// RUNTIME: real hostingTxnRecord (main) + real WhiteLabel sales.js (WL_SALES) against sandbox Mongo 127.0.0.1:27999.
const Module = require('module')
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p5_sandbox'
process.env.SALES_FLAT_MARGIN_PCT = '30'
process.env.PREMIUM_ANTIRED_WEEKLY_PRICE = '30'
process.env.PREMIUM_ANTIRED_CPANEL_PRICE = '75'
process.env.GOLDEN_ANTIRED_CPANEL_PRICE = '100'
const sp = require.resolve('node-schedule')
require.cache[sp] = Object.assign(new Module(sp), { filename: sp, loaded: true, exports: { scheduleJob: () => null } })
const { MongoClient } = require('mongodb')
const { hostingTxnRecord } = require('../cr-register-domain-&-create-cpanel.js')
const sales = require(process.env.WL_SALES || '/root/wl/js/routes/sales.js')

const PREMIUM = 'Premium Anti-Red HostPanel (1-Month)'
const results = []
const check = (id, ok, detail) => { results.push(ok); console.log(`| ${id} | ${ok ? 'PASS' : 'FAIL'} | ${detail}`) }
const near = (a, b) => Math.abs(a - b) < 0.005

;(async () => {
  const c = await MongoClient.connect(URL); const db = c.db('p5_sandbox')
  await db.dropDatabase()
  const t0 = Date.now() - 86400000
  const at = (i) => new Date(t0 + i * 3600000)
  const ht = [], tx = []
  const order = (i, chatId, priceUsd, couponDiscount, txRow) => {
    ht.push({ chatId, domain: `d${i}.com`, plan: PREMIUM, priceUsd, outcome: 'success', paymentMethod: 'wallet_usd', couponApplied: couponDiscount > 0, couponDiscount, timestamp: at(i) })
    if (txRow) tx.push({ _id: `T${i}`, chatId, type: 'hosting', currency: 'USD', status: 'completed', createdAt: at(i), ...txRow, metadata: { domain: `d${i}.com`, plan: PREMIUM, ...(txRow.metadata || {}) } })
  }
  // L1 legacy partial row carrying the recorded silver loyalty ($105 list → $99.75)
  order(1, 'u1', 99.75, 0, { amount: 30, metadata: { listPrice: 35.25, loyaltyTier: 'silver', loyaltyDiscount: 5.25 } })
  // L2 legacy partial row with no loyalty metadata, gold rate (inferred from plan $75 + domain $30)
  order(2, 'u2', 94.5, 0, { amount: 30 })
  // N1 Phase 3 row written by the real hostingTxnRecord after a silver wallet checkout
  const n1 = hostingTxnRecord({ chargedUsd: 99.75, chargedVia: { paymentMethod: 'wallet_usd' }, plan: PREMIUM, hostingPrice: 75, domainPrice: 30, loyaltyApplied: { step: 'hosting-pay', key: 'totalPrice', from: 105, to: 99.75 }, loyaltyDiscount: 5.25 }, 'd3.com', 'cpu3')
  order(3, 'u3', 99.75, 0, n1)
  // N2 coupon only: 10% coupon on $105 → $94.50
  const n2 = hostingTxnRecord({ chargedUsd: 94.5, plan: PREMIUM, hostingPrice: 75, domainPrice: 30, couponApplied: true, couponDiscount: 10.5, couponCode: 'TEN' }, 'd4.com', 'cpu4')
  order(4, 'u4', 94.5, 10.5, n2)
  // N3 coupon $5 then silver 5% on $100 → $95
  const n3 = hostingTxnRecord({ chargedUsd: 95, plan: PREMIUM, hostingPrice: 75, domainPrice: 30, couponApplied: true, couponDiscount: 5, couponCode: 'FIVE', loyaltyApplied: { step: 'hosting-pay', key: 'newPrice', from: 100, to: 95 }, loyaltyDiscount: 5 }, 'd5.com', 'cpu5')
  order(5, 'u5', 95, 5, n3)
  // N4 bronze, no discount
  order(6, 'u6', 105, 0, hostingTxnRecord({ chargedUsd: 105, plan: PREMIUM, hostingPrice: 75, domainPrice: 30 }, 'd6.com', 'cpu6'))
  // Upgrades with the 14-day credit (rows as written by main _index.js)
  tx.push({ _id: 'U1', chatId: 'u7', type: 'hosting-upgrade', amount: 85, currency: 'USD', status: 'completed', createdAt: at(7), metadata: { domain: 'd7.com', fromPlan: PREMIUM, toPlan: 'Golden', listPrice: 105, creditApplied: 20, paymentMethod: 'wallet_usd' } })
  tx.push({ _id: 'U2', chatId: 'u8', type: 'cloudphone-upgrade', amount: 40, currency: 'USD', status: 'completed', createdAt: at(8), metadata: { phoneNumber: '+1555', oldPlan: 'starter', newPlan: 'pro', listPrice: 50, credit: 10, eligibleForCredit: true } })
  await db.collection('hostingTransactions').insertMany(ht)
  await db.collection('transactions').insertMany(tx)

  const raw = await sales.loadSalesTxns(db)
  const rows = raw.map(sales.normalizeTxn).filter((r) => r.group === 'sale')
  const by = (chatId) => rows.find((r) => r.chatId === chatId)
  const exp = [
    ['JRN-46 silver legacy (recorded)', 'u1', 105, 5.25, 0, 0, 26.25, 'silver'],
    ['JRN-46 gold legacy (inferred)', 'u2', 105, 10.5, 0, 0, 21, 'gold'],
    ['JRN-47 silver new row (writer)', 'u3', 105, 5.25, 0, 0, 26.25, 'silver'],
    ['JRN-48 coupon only', 'u4', 105, 0, 10.5, 0, 21, 'bronze'],
    ['JRN-48 coupon + silver', 'u5', 105, 5, 5, 0, 21.5, 'silver'],
    ['JRN-46 no discount', 'u6', 105, 0, 0, 0, 31.5, 'bronze'],
    ['JRN-49 hosting-upgrade credit', 'u7', 105, 0, 0, 20, 11.5, 'bronze'],
    ['JRN-49 cloudphone-upgrade credit', 'u8', 50, 0, 0, 10, 5, 'bronze'],
  ]
  for (const [id, chat, list, loy, cpn, upg, profit, tier] of exp) {
    const r = by(chat)
    const ok = r && near(r.listUsd, list) && near(r.loyaltyDiscount, loy) && near(r.couponDiscount, cpn) && near(r.upgradeCredit || 0, upg) && near(r.profit, profit) && r.loyaltyTier === tier
    check(id, !!ok, r ? `paid ${r.amountUsd} list ${r.listUsd} loy ${r.loyaltyDiscount} ${r.loyaltyTier} cpn ${r.couponDiscount} upg ${r.upgradeCredit} profit ${Math.round(r.profit * 100) / 100}` : 'row missing')
  }
  check('one row per hosting order', rows.filter((r) => r.type === 'hosting').length === 6, `${rows.filter((r) => r.type === 'hosting').length} hosting rows`)
  check('writer metadata (N1)', n1.metadata.listPrice === 105 && n1.metadata.loyaltyDiscount === 5.25 && n1.metadata.loyaltyTier === 'silver' && n1.metadata.couponDiscount === 0, JSON.stringify({ listPrice: n1.metadata.listPrice, loyaltyDiscount: n1.metadata.loyaltyDiscount, loyaltyTier: n1.metadata.loyaltyTier }))
  check('writer ignores a stale loyalty from another step', hostingTxnRecord({ chargedUsd: 105, plan: PREMIUM, loyaltyApplied: { step: 'domain-pay', to: 28.5 }, loyaltyDiscount: 1.5 }, 'x.com', 'cpx').metadata.loyaltyDiscount === 0, 'domain-pay loyalty not applied to hosting')
  const s = sales.buildReport(rows, { byCat: {}, byDay: {}, total: 0 }, new Date(0), new Date(Date.now() + 86400000)).summary
  check('waterfall balances', near(s.grossListSales - s.loyaltyDiscounts - s.couponDiscounts - s.upgradeCredits, s.grossRevenue), `list ${s.grossListSales} − loy ${s.loyaltyDiscounts} − cpn ${s.couponDiscounts} − upg ${s.upgradeCredits} = net ${s.grossRevenue}`)
  check('total profit', near(s.netProfit, 26.25 + 21 + 26.25 + 21 + 21.5 + 31.5 + 11.5 + 5), `netProfit ${s.netProfit}`)
  await db.dropDatabase(); await c.close()
  const pass = results.filter(Boolean).length
  console.log(`RESULT ${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
