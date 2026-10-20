/* Unit test: discount + membership-tier aware profit/payout math (no DB). */
process.env.PERCENT_INCREASE_DOMAIN = '2.25'
process.env.VPS_MARKUP_PERCENT = '200'
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

const approx = (a, b, m) => assert.ok(Math.abs(a - b) < 0.006, `${m}: got ${a}, expected ${b}`)

// Revenue = net paid; list = pre-discount; discounts break down
approx(s.grossRevenue, 163.5, 'net revenue')
approx(s.grossListSales, 170, 'gross list sales')
approx(s.loyaltyDiscounts, 1.5, 'loyalty discounts')
approx(s.couponDiscounts, 5, 'coupon discounts')
approx(s.totalDiscounts, 6.5, 'total discounts')
approx(s.grossListSales - s.totalDiscounts, s.grossRevenue, 'waterfall balances (list − discounts = net)')

// Real cost from LIST (domain list/3.25, hosting 20%, VPS list/3), shown profit = 70% of real when > 0
approx(s.totalCost, 83.511538, 'total cost')            // 15.011538 + 20.5 + 48
approx(s.netProfit, 79.988462, 'profit')                // 13.488462 + 24.5 + 42
approx(s.payout, 79.988462, 'payout == profit')

// Silver domain: list 30 → cost 9.230769, paid 28.50 → real 19.269231 → shown 13.488462
const silver = rep.byTier.find((t) => t.tier === 'silver')
const bronze = rep.byTier.find((t) => t.tier === 'bronze')
approx(silver.profit, 13.488462, 'silver profit reflects discount')
approx(silver.discount, 1.5, 'silver discount')
approx(bronze.profit, 66.5, 'bronze profit (hosting 24.5 + vps 42)')
approx(bronze.revenue, 135, 'bronze revenue')

// Bonuses & deposits excluded from profit
approx(s.bonuses, 5, 'welcome bonus tracked separately')
approx(s.deposits, 100, 'admin credit counted as deposit (real money)')
approx(s.adminCredits, 100, 'admin credit surfaced in deposits breakdown')
assert.ok(s.netProfit === s.grossProfit, 'profit excludes bonuses')

console.log('✅ ALL DISCOUNT/TIER/PAYOUT MATH CHECKS PASSED')
console.log(JSON.stringify({ revenue: s.grossRevenue, listSales: s.grossListSales, discounts: s.totalDiscounts, cost: s.totalCost, profit: s.netProfit, payout: s.payout, byTier: rep.byTier.map(t => ({ tier: t.tier, rev: t.revenue, disc: t.discount, profit: t.profit })) }, null, 2))
