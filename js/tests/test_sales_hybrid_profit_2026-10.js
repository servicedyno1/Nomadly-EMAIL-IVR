// Phase 5 sandbox (JRN-46..53): real profit per product from the LIST price, shown profit = 70% of real when > 0.
// RUNTIME: real hostingTxnRecord (main) + real WhiteLabel sales.js (WL_SALES) over HTTP, sandbox Mongo 127.0.0.1:27999.
const Module = require('module')
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
Object.assign(process.env, {
  MONGO_URL: URL, DB_NAME: 'p5_sandbox', SESSION_SECRET: 'sandbox-only', SALES_DASHBOARD_PASSWORD: 'sandbox',
  PERCENT_INCREASE_DOMAIN: '2.25', VPS_MARKUP_PERCENT: '200',
  PREMIUM_ANTIRED_WEEKLY_PRICE: '30', PREMIUM_ANTIRED_CPANEL_PRICE: '75', GOLDEN_ANTIRED_CPANEL_PRICE: '100',
})
delete process.env.SALES_PROFIT_ADJUST_PCT // default 30 in code
delete process.env.SALES_FLAT_MARGIN_PCT
const sp = require.resolve('node-schedule')
require.cache[sp] = Object.assign(new Module(sp), { filename: sp, loaded: true, exports: { scheduleJob: () => null } })
const { MongoClient } = require('mongodb')
const express = require('express')
const { hostingTxnRecord } = require('../cr-register-domain-&-create-cpanel.js')
const sales = require(process.env.WL_SALES || '/root/wl/js/routes/sales.js')

const PREMIUM = 'Premium Anti-Red HostPanel (1-Month)'
const results = []
const check = (id, ok, detail) => { results.push(!!ok); console.log(`| ${id} | ${ok ? 'PASS' : 'FAIL'} | ${detail}`) }
const near = (a, b, tol = 0.006) => Math.abs(a - b) < tol
const shown = (paid, cost) => { const real = paid - cost; return real > 0 ? real * 0.7 : real }

;(async () => {
  const c = await MongoClient.connect(URL); const db = c.db('p5_sandbox')
  await db.dropDatabase()
  const now = Date.now()
  const at = (i) => new Date(now - (60 - i) * 1000)
  const ht = [], tx = []
  const hosting = (id, chatId, priceUsd, couponDiscount, row) => {
    ht.push({ chatId, domain: `${id}.com`, plan: PREMIUM, priceUsd, outcome: 'success', paymentMethod: 'wallet_usd', couponApplied: couponDiscount > 0, couponDiscount, timestamp: at(tx.length) })
    tx.push({ _id: id, chatId, type: 'hosting', currency: 'USD', status: 'completed', createdAt: at(tx.length), ...row, metadata: { domain: `${id}.com`, plan: PREMIUM, ...(row.metadata || {}) } })
  }
  const sale = (id, chatId, type, amount, metadata = {}) => tx.push({ _id: id, chatId, type, amount, currency: 'USD', status: 'completed', createdAt: at(tx.length), metadata })
  // [id, chat, expected list, expected real cost, paid]
  const D = 1 / 3.25
  const exp = []
  // JRN-46 $105 = Premium $75 + new domain $30 (legacy partial row = domain fee)
  hosting('H46', 'c46', 105, 0, { amount: 30 }); exp.push(['JRN-46 $105 hosting = plan + domain', 'H46', 105, 75 * 0.2 + 30 * D, 105])
  // JRN-47 $75 plan, existing domain (real writer)
  hosting('H47', 'c47', 75, 0, hostingTxnRecord({ chargedUsd: 75, plan: PREMIUM, hostingPrice: 75, existingDomain: true }, 'H47.com', 'cpu47')); exp.push(['JRN-47 $75 hosting → shown $42.00', 'H47', 75, 15, 75])
  // JRN-48 silver: $75 list, 5% → $71.25 (real writer)
  hosting('H48', 'c48', 71.25, 0, hostingTxnRecord({ chargedUsd: 71.25, plan: PREMIUM, hostingPrice: 75, existingDomain: true, loyaltyApplied: { step: 'hosting-pay', key: 'totalPrice', from: 75, to: 71.25 }, loyaltyDiscount: 3.75 }, 'H48.com', 'cpu48'))
  exp.push(['JRN-48 silver $71.25 on $75 → shown $39.38', 'H48', 75, 15, 71.25])
  // Silver legacy (recorded on partial row) and gold legacy (inferred)
  hosting('H48b', 'c48b', 99.75, 0, { amount: 30, metadata: { listPrice: 35.25, loyaltyTier: 'silver', loyaltyDiscount: 5.25 } }); exp.push(['JRN-48 silver legacy $99.75 on $105', 'H48b', 105, 15 + 30 * D, 99.75])
  hosting('H48c', 'c48c', 94.5, 0, { amount: 30 }); exp.push(['JRN-48 gold legacy (inferred) $94.50 on $105', 'H48c', 105, 15 + 30 * D, 94.5])
  // Coupon hosting: $7.50 off $75
  hosting('H48d', 'c48d', 67.5, 7.5, hostingTxnRecord({ chargedUsd: 67.5, plan: PREMIUM, hostingPrice: 75, existingDomain: true, couponApplied: true, couponDiscount: 7.5, couponCode: 'TEN' }, 'H48d.com', 'cpu48d'))
  exp.push(['JRN-48 coupon hosting $67.50 on $75', 'H48d', 75, 15, 67.5])
  // JRN-50 domain $32.50 at PERCENT_INCREASE_DOMAIN 2.25
  sale('D50', 'c50', 'domain', 32.5, { domain: 'd50.com', listPrice: 32.5 }); exp.push(['JRN-50 domain $32.50 → shown $15.75', 'D50', 32.5, 10, 32.5])
  // Negative real profit: domain $32.50 list, $25 coupon → paid $7.50 (cost $10)
  sale('D53', 'c53', 'domain', 7.5, { domain: 'd53.com', listPrice: 32.5, couponDiscount: 25, couponCode: 'BIG' }); exp.push(['negative real profit shown unreduced', 'D53', 32.5, 10, 7.5])
  sale('V1', 'c60', 'vps', 90, { plan: 'vps-1' }); exp.push(['VPS $90 (list ÷ 3)', 'V1', 90, 30, 90])
  sale('P1', 'c61', 'phone-number', 50, { plan: 'starter' }); exp.push(['Cloud Phone $50 (30%)', 'P1', 50, 15, 50])
  sale('U1', 'c62', 'cloudphone-upgrade', 40, { oldPlan: 'starter', newPlan: 'pro', listPrice: 50, credit: 10 }); exp.push(['cloudphone-upgrade credit $10', 'U1', 50, 15, 40])
  sale('U2', 'c63', 'hosting-upgrade', 85, { fromPlan: PREMIUM, toPlan: 'Golden', listPrice: 105, creditApplied: 20 }); exp.push(['hosting-upgrade credit $20', 'U2', 105, 21, 85])
  sale('R1', 'c64', 'hosting-renewal', 75, { plan: PREMIUM, action: 'auto_renew' }); exp.push(['hosting-renewal $75', 'R1', 75, 15, 75])
  sale('B51', 'c50', 'welcome-bonus', 10)
  await db.collection('hostingTransactions').insertMany(ht)
  await db.collection('transactions').insertMany(tx)
  await db.collection('walletLedger').insertMany([
    { chatId: 'c49', type: 'outbound_call', amount: -0.6, timestamp: at(50) },
    { chatId: 'c49', type: 'connection_fee', amount: -0.4, timestamp: at(51) },
    { chatId: 'c49', type: 'sms', amount: -1, timestamp: at(52) },
  ])

  const app = express(); app.use(express.json())
  sales.install(app, { getDb: () => db, log: () => {} })
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}/admin/sales`
  const { token } = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sandbox' }) }).then((r) => r.json())
  const get = (p) => fetch(base + p, { headers: { Authorization: 'Bearer ' + token } })
  const o = await get('/overview?range=all').then((r) => r.json())
  const txs = await get('/transactions?range=all&limit=200').then((r) => r.json())
  const csv = await get('/export.csv?range=all').then((r) => r.text())
  srv.close()

  const list = txs.transactions || txs.rows || txs.items || []
  const byId = new Map(list.map((t) => [String(t.id || t._id || t.transactionId), t]))
  let expSales = 0
  for (const [id, txId, listUsd, realCost, paid] of exp) {
    const want = shown(paid, realCost)
    expSales += want
    const r = byId.get(txId)
    check(id, r && near(r.profit, want) && near(r.amountUsd ?? r.amount, paid), r ? `paid ${r.amountUsd ?? r.amount} list ${listUsd} real ${(paid - realCost).toFixed(4)} shown ${r.profit} (want ${want.toFixed(4)})` : 'row missing')
  }
  // JRN-49 calls $1 → shown $0.315; SMS $1 → shown $0.42
  const cat = (n) => (o.categories || o.byCategory || []).find((x) => x.category === n) || {}
  check('JRN-49 $1 calls → shown $0.315', near(cat('Calls').profit, 0.315, 0.0051) && near(cat('Calls').revenue, 1), `calls revenue ${cat('Calls').revenue} profit ${cat('Calls').profit}`)
  check('SMS $1 → shown $0.42', near(cat('SMS').profit, 0.42), `sms profit ${cat('SMS').profit}`)
  const expTotal = expSales + 0.315 + 0.42
  const s = o.summary
  check('KPI profit = Σ shown', near(s.netProfit, expTotal, 0.011), `netProfit ${s.netProfit} want ${expTotal.toFixed(4)}`)
  check('revenue = real paid', near(s.grossRevenue, exp.reduce((a, e) => a + e[4], 0) + 2), `grossRevenue ${s.grossRevenue}`)
  check('eligible payout = profit', near(s.eligiblePayout, s.netProfit), `eligiblePayout ${s.eligiblePayout}`)
  check('this-week profit = profit', near(s.thisWeekProfit ?? s.thisWeekPayout, s.netProfit), `thisWeek ${s.thisWeekProfit ?? s.thisWeekPayout}`)
  const sum = (arr) => (arr || []).reduce((a, x) => a + (Number(x.profit) || 0), 0)
  check('categories sum to profit', near(sum(o.categories || o.byCategory), s.netProfit, 0.03), `Σ categories ${sum(o.categories || o.byCategory).toFixed(2)}`)
  check('timeseries + weekly sum to profit', near(sum(o.timeseries), s.netProfit, 0.03) && near(sum(o.weekly), s.netProfit, 0.03), `Σ ts ${sum(o.timeseries).toFixed(2)} Σ weekly ${sum(o.weekly).toFixed(2)}`)
  check('tier table sums to sales profit', near(sum(o.byTier), expSales, 0.03), `Σ tiers ${sum(o.byTier).toFixed(2)} want ${expSales.toFixed(2)}`)
  check('top customers use shown profit', near((o.topCustomers || []).find((x) => x.chatId === 'c47')?.profit, 42), `c47 ${(o.topCustomers || []).find((x) => x.chatId === 'c47')?.profit}`)
  check('waterfall balances', near(s.grossListSales - s.loyaltyDiscounts - s.couponDiscounts - s.upgradeCredits, s.grossRevenue, 0.011), `list ${s.grossListSales} − ${s.loyaltyDiscounts} − ${s.couponDiscounts} − ${s.upgradeCredits} = ${s.grossRevenue}`)
  // JRN-51 bonus: tracked, no profit
  check('JRN-51 bonus never profit', near(s.bonuses, 10) && near(s.netProfit, s.grossProfit), `bonuses ${s.bonuses}`)
  const csvRow = csv.split('\n').find((l) => l.startsWith('H47') || l.includes('"H47"'))
  check('CSV uses shown profit', !!csvRow && /,42(\.0+)?,/.test(csvRow.replace(/"/g, '')), csvRow ? csvRow.slice(0, 120) : 'no H47 row')
  // JRN-53 margins hidden
  const blob = JSON.stringify(o) + JSON.stringify(txs) + csv.split('\n')[0]
  check('JRN-53 no margin/ratio fields', !/flatMarginPct|costRatio|margin|ratio|PROFIT_ADJUST/i.test(blob), 'overview + transactions + CSV header')
  // writer metadata
  const w = tx.find((t) => t._id === 'H48').metadata
  check('writer records list/loyalty', w.listPrice === 75 && w.loyaltyDiscount === 3.75 && w.loyaltyTier === 'silver', JSON.stringify({ listPrice: w.listPrice, loyaltyDiscount: w.loyaltyDiscount, loyaltyTier: w.loyaltyTier }))
  check('writer ignores stale loyalty from another step', hostingTxnRecord({ chargedUsd: 75, plan: PREMIUM, loyaltyApplied: { step: 'domain-pay', to: 28.5 }, loyaltyDiscount: 1.5 }, 'x.com', 'cpx').metadata.loyaltyDiscount === 0, 'domain-pay loyalty not applied')
  await db.dropDatabase(); await c.close()
  const pass = results.filter(Boolean).length
  console.log(`RESULT ${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
