/* Unit test: discount + membership-tier aware profit/payout math (no DB). */
process.env.SALES_FLAT_MARGIN_PCT = '30'
const assert = require('assert')
const { normalizeTxn, buildReport } = require('../routes/sales.js')

const now = new Date()
const docs = [
  // Silver member buys a $30 domain (5% loyalty discount → paid $28.50)
  { _id: 't1', chatId: 'u1', type: 'domain', amount: 28.5, currency: 'USD', status: 'completed', createdAt: now,
    metadata: { domain: 'a.com', listPrice: 30, loyaltyDiscount: 1.5, couponDiscount: 0, loyaltyTier: 'silver' } },
  // Bronze member, $5 coupon on a $50 hosting → paid $45
  { _id: 't2', chatId: 'u2', type: 'hosting', amount: 45, currency: 'USD', status: 'completed', createdAt: now,
    metadata: { plan: 'gold', listPrice: 50, loyaltyDiscount: 0, couponDiscount: 5, couponCode: 'SAVE5', loyaltyTier: 'bronze' } },
  // Old-style VPS sale with NO discount metadata → list falls back to amount ($90)
  { _id: 't3', chatId: 'u3', type: 'vps', amount: 90, currency: 'USD', status: 'completed', createdAt: now,
    metadata: { plan: 'vps-1' } },
  // Welcome bonus — must NOT touch profit
  { _id: 'b1', chatId: 'u1', type: 'welcome-bonus', amount: 5, currency: 'USD', status: 'completed', createdAt: now, metadata: {} },
  // Admin credit — REAL money (deposit), must NOT be profit
  { _id: 'd1', chatId: 'u2', type: 'admin-credit', amount: 100, currency: 'USD', status: 'completed', createdAt: now, metadata: {} },
]

const rows = docs.map(normalizeTxn)
const usage = { byCat: {}, byDay: {}, total: 0 }
const rep = buildReport(rows, usage, new Date(0), new Date(Date.now() + 86400000))
const s = rep.summary

const approx = (a, b, m) => assert.ok(Math.abs(a - b) < 0.001, `${m}: got ${a}, expected ${b}`)

// Revenue = net paid; list = pre-discount; discounts break down
approx(s.grossRevenue, 163.5, 'net revenue')
approx(s.grossListSales, 170, 'gross list sales')
approx(s.loyaltyDiscounts, 1.5, 'loyalty discounts')
approx(s.couponDiscounts, 5, 'coupon discounts')
approx(s.totalDiscounts, 6.5, 'total discounts')
approx(s.grossListSales - s.totalDiscounts, s.grossRevenue, 'waterfall balances (list − discounts = net)')

// Cost anchored to LIST → discounts come out of profit
approx(s.totalCost, 119, 'total cost (list×70%)')      // 21 + 35 + 63
approx(s.netProfit, 44.5, 'profit')                    // 163.5 − 119
approx(s.payout, 44.5, 'payout == profit')

// Profit on the Silver domain reflects discount: 7.50 (NOT flat 30% of net = 8.55)
const silver = rep.byTier.find((t) => t.tier === 'silver')
const bronze = rep.byTier.find((t) => t.tier === 'bronze')
approx(silver.profit, 7.5, 'silver profit reflects discount')
approx(silver.discount, 1.5, 'silver discount')
approx(bronze.profit, 37, 'bronze profit (hosting 10 + vps 27)')
approx(bronze.revenue, 135, 'bronze revenue')

// Bonuses & deposits excluded from profit
approx(s.bonuses, 5, 'welcome bonus tracked separately')
approx(s.deposits, 100, 'admin credit counted as deposit (real money)')
approx(s.adminCredits, 100, 'admin credit surfaced in deposits breakdown')
assert.ok(s.netProfit === s.grossProfit, 'profit excludes bonuses')

console.log('✅ ALL DISCOUNT/TIER/PAYOUT MATH CHECKS PASSED')
console.log(JSON.stringify({ revenue: s.grossRevenue, listSales: s.grossListSales, discounts: s.totalDiscounts, cost: s.totalCost, profit: s.netProfit, payout: s.payout, byTier: rep.byTier.map(t => ({ tier: t.tier, rev: t.revenue, disc: t.discount, profit: t.profit })) }, null, 2))
