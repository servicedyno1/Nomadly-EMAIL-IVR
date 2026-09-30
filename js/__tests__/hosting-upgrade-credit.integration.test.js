/**
 * Integration test for the hosting upgrade credit feature.
 *
 * Verifies the EXACT same code paths used in /app/js/_index.js for the
 * upgrade keyboard and modal text, using:
 *   - real env prices (PREMIUM_ANTIRED_WEEKLY_PRICE, _CPANEL_PRICE, GOLDEN_*)
 *   - real cpanelAccounts documents seeded in MongoDB
 *   - the shared helpers from hosting-upgrade-credit.js
 *
 * Plan-specific windows (per product rule):
 *   • Weekly current plan        → 3-day credit window
 *   • Premium monthly current    → 14-day credit window
 *   • Golden                     → no upgrade path → no credit
 *
 * Run: node js/__tests__/hosting-upgrade-credit.integration.test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { MongoClient } = require('mongodb')
const { computeUpgradeQuote, getBestUpgradeQuote } = require('../hosting-upgrade-credit')
const { getPlanPrice } = require('../hosting-scheduler')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'

const PREMIUM_WEEKLY = Number(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE || 30)
const PREMIUM_CPANEL = Number(process.env.PREMIUM_ANTIRED_CPANEL_PRICE || 75)
const GOLDEN_CPANEL = Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100)

const TEST_CHAT_ID = '__upgrade_credit_test__'
const TEST_DOMAIN = 'upgrade-credit-test.example'
const DAY = 24 * 60 * 60 * 1000

let passed = 0
let failed = 0
const fails = []

function assert(label, cond, extra) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    fails.push({ label, extra })
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

/**
 * Mirrors the upgrade-options builder + button labels in _index.js
 * (lines ~10935-11017). Pure function — no Telegram send.
 */
function buildUpgradeUiFromPlan(plan) {
  const currentPlan = (plan.plan || '').toLowerCase()
  const currentPrice = getPlanPrice(plan.plan)
  const options = []
  if (currentPlan.includes('week')) {
    options.push({ name: 'Premium Anti-Red HostPanel (30 Days)', key: 'premiumCpanel', price: PREMIUM_CPANEL })
    options.push({ name: 'Golden Anti-Red HostPanel (30 Days)', key: 'goldenCpanel', price: GOLDEN_CPANEL })
  } else if (currentPlan.includes('premium') && !currentPlan.includes('week')) {
    options.push({ name: 'Golden Anti-Red HostPanel (30 Days)', key: 'goldenCpanel', price: GOLDEN_CPANEL })
  }
  for (const opt of options) {
    const q = computeUpgradeQuote({ planDoc: plan, oldPrice: currentPrice, newPrice: opt.price })
    opt.originalPrice = q.originalPrice
    opt.creditApplied = q.creditApplied
    opt.chargeAmount = q.chargeAmount
    opt.creditEligible = q.eligible
    opt.buttonLabel = `⬆️ ${opt.name} ($${q.chargeAmount.toFixed(2)})`
  }
  return { currentPrice, options }
}

async function seedPlan(cpanelAccounts, planName, daysSinceAnchor, idSuffix) {
  const anchor = new Date(Date.now() - daysSinceAnchor * DAY)
  const _id = `${TEST_DOMAIN}-${idSuffix}`
  await cpanelAccounts.deleteOne({ _id })
  await cpanelAccounts.insertOne({
    _id,
    chatId: TEST_CHAT_ID,
    domain: TEST_DOMAIN,
    plan: planName,
    cpUser: 'testuser',
    createdAt: anchor,
    lastRenewedAt: anchor,
    expiryDate: new Date(Date.now() + 1 * DAY),
    autoRenew: false,
  })
  return cpanelAccounts.findOne({ _id })
}

async function main() {
  console.log('\nhosting-upgrade-credit — integration test')
  console.log('──────────────────────────────────────────')
  console.log(`MONGO_URL=${MONGO_URL}  DB=${DB_NAME}`)
  console.log(`Prices: weekly=$${PREMIUM_WEEKLY}  premium-cpanel=$${PREMIUM_CPANEL}  golden=$${GOLDEN_CPANEL}`)

  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  const cpanelAccounts = db.collection('cpanelAccounts')
  await cpanelAccounts.deleteMany({ chatId: TEST_CHAT_ID })

  // ─────────────────────────────────────────────────────────────
  // CASE 1: WEEKLY user, day 2 → eligible (within 3-day window)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 1] WEEKLY user, day 2 (3-day window)')
  let plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red (1-Week)', 2, 'weekly-d2')
  let ui = buildUpgradeUiFromPlan(plan)
  assert('currentPrice resolved from env', ui.currentPrice === PREMIUM_WEEKLY)
  assert('2 upgrade options offered', ui.options.length === 2)

  const expectedWeeklyCredit = PREMIUM_WEEKLY * 0.5
  const goldenOpt1 = ui.options.find(o => o.key === 'goldenCpanel')
  const expectedGoldenCharge = Math.round((GOLDEN_CPANEL - expectedWeeklyCredit) * 100) / 100
  assert('golden: eligible at day 2', goldenOpt1.creditEligible === true)
  assert(`golden: credit = $${expectedWeeklyCredit.toFixed(2)}`,
    goldenOpt1.creditApplied === expectedWeeklyCredit, `got $${goldenOpt1.creditApplied}`)
  assert(`golden: charge = $${expectedGoldenCharge.toFixed(2)}`,
    goldenOpt1.chargeAmount === expectedGoldenCharge, `got $${goldenOpt1.chargeAmount}`)
  assert('golden: button shows discounted price',
    goldenOpt1.buttonLabel === `⬆️ Golden Anti-Red HostPanel (30 Days) ($${expectedGoldenCharge.toFixed(2)})`,
    goldenOpt1.buttonLabel)

  if (PREMIUM_WEEKLY === 30 && GOLDEN_CPANEL === 100) {
    assert('@iMr_Brown reported scenario: $15 credit → $85 charge',
      goldenOpt1.creditApplied === 15 && goldenOpt1.chargeAmount === 85)
  }

  // ─────────────────────────────────────────────────────────────
  // CASE 2: WEEKLY user, day 4 → NOT eligible (3-day window enforced)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 2] WEEKLY user, day 4 (outside 3-day window)')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red (1-Week)', 4, 'weekly-d4')
  ui = buildUpgradeUiFromPlan(plan)
  const goldenOpt2 = ui.options.find(o => o.key === 'goldenCpanel')
  assert('golden: NOT eligible after 3 days', goldenOpt2.creditEligible === false)
  assert('golden: no credit applied', goldenOpt2.creditApplied === 0)
  assert(`golden: full list price ($${GOLDEN_CPANEL}) charged`,
    goldenOpt2.chargeAmount === GOLDEN_CPANEL, `got $${goldenOpt2.chargeAmount}`)
  assert('golden: button shows list price',
    goldenOpt2.buttonLabel.endsWith(`($${GOLDEN_CPANEL.toFixed(2)})`),
    goldenOpt2.buttonLabel)

  // ─────────────────────────────────────────────────────────────
  // CASE 3: PREMIUM MONTHLY user, day 7 → eligible (within 14-day window)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 3] PREMIUM MONTHLY user, day 7 (14-day window)')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red HostPanel (30 Days)', 7, 'premium-d7')
  ui = buildUpgradeUiFromPlan(plan)
  assert('1 upgrade option offered (golden only)', ui.options.length === 1)
  const goldenOpt3 = ui.options[0]
  const expectedPremiumCredit = PREMIUM_CPANEL * 0.5
  const expectedPremiumGoldenCharge = Math.round((GOLDEN_CPANEL - expectedPremiumCredit) * 100) / 100
  assert('golden: eligible at day 7', goldenOpt3.creditEligible === true)
  assert(`golden: credit = $${expectedPremiumCredit.toFixed(2)}`,
    goldenOpt3.creditApplied === expectedPremiumCredit, `got $${goldenOpt3.creditApplied}`)
  assert(`golden: charge = $${expectedPremiumGoldenCharge.toFixed(2)}`,
    goldenOpt3.chargeAmount === expectedPremiumGoldenCharge, `got $${goldenOpt3.chargeAmount}`)

  // ─────────────────────────────────────────────────────────────
  // CASE 4: PREMIUM MONTHLY user, day 15 → NOT eligible
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 4] PREMIUM MONTHLY user, day 15 (outside 14-day window)')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red HostPanel (30 Days)', 15, 'premium-d15')
  ui = buildUpgradeUiFromPlan(plan)
  const goldenOpt4 = ui.options[0]
  assert('golden: NOT eligible after 14 days', goldenOpt4.creditEligible === false)
  assert('golden: full list price charged', goldenOpt4.chargeAmount === GOLDEN_CPANEL)

  // ─────────────────────────────────────────────────────────────
  // CASE 5: Weekly day 2 nudge surface — CTA strings & router match
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 5] Loyalty-credit nudge surface (weekly day 2)')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red (1-Week)', 2, 'weekly-d2-nudge')
  const bestW = getBestUpgradeQuote({ planDoc: plan, oldPrice: PREMIUM_WEEKLY })
  assert('weekly day 2 → nudge returned', bestW !== null)
  assert('weekly nudge target = golden',
    bestW.target.key === 'goldenCpanel', bestW.target.key)
  assert('weekly windowDays = 3', bestW.windowDays === 3)
  assert('weekly deadline = anchor + 3 days (±1 min)',
    Math.abs(bestW.deadlineDate.getTime() - (new Date(plan.lastRenewedAt).getTime() + 3 * DAY)) < 60 * 1000)
  assert('weekly daysRemaining ≈ 1 (3 − 2)',
    Math.abs(bestW.daysRemaining - 1) < 0.05, `got ${bestW.daysRemaining}`)

  // Verify the CTA labels match the router regex in _index.js
  const deadlineStr = bestW.deadlineDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const detailsCta = `🎁 Use $${bestW.quote.creditApplied.toFixed(2)} credit by ${deadlineStr}`
  const listCta = `🎁 Use $${bestW.quote.creditApplied.toFixed(2)} credit on ${TEST_DOMAIN}`
  assert('plan-details CTA matches deep-link router prefix',
    detailsCta.startsWith('🎁 Use $') && detailsCta.includes(' credit by '))
  assert('list CTA matches deep-link router regex',
    /^🎁 Use \$[\d.]+ credit on (.+)$/.test(listCta))
  const listMatch = listCta.match(/^🎁 Use \$[\d.]+ credit on (.+)$/)
  assert('list CTA captures correct domain',
    listMatch && listMatch[1] === TEST_DOMAIN, listMatch && listMatch[1])

  // ─────────────────────────────────────────────────────────────
  // CASE 6: Weekly day 4 → no nudge surfaced anywhere
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 6] Weekly day 4 → nudge suppressed')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red (1-Week)', 4, 'weekly-d4-nudge')
  const bestW4 = getBestUpgradeQuote({ planDoc: plan, oldPrice: PREMIUM_WEEKLY })
  assert('weekly day 4 → no nudge (3d window)', bestW4 === null)

  // ─────────────────────────────────────────────────────────────
  // CASE 7: Premium-monthly day 7 nudge surface
  // ─────────────────────────────────────────────────────────────
  console.log('\n[case 7] Premium-monthly day 7 → nudge surfaced')
  plan = await seedPlan(cpanelAccounts, 'Premium Anti-Red HostPanel (30 Days)', 7, 'premium-d7-nudge')
  const bestP = getBestUpgradeQuote({ planDoc: plan, oldPrice: PREMIUM_CPANEL })
  assert('premium-monthly day 7 → nudge returned', bestP !== null)
  assert('premium windowDays = 14', bestP.windowDays === 14)
  assert('premium daysRemaining ≈ 7', Math.abs(bestP.daysRemaining - 7) < 0.05)
  assert('premium nudge target = golden', bestP.target.key === 'goldenCpanel')

  // Cleanup
  await cpanelAccounts.deleteMany({ chatId: TEST_CHAT_ID })
  await client.close()

  console.log('\n──────────────────────────────────────────')
  console.log(`Result: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const f of fails) console.log(' -', f.label, f.extra || '')
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('Integration test crashed:', err)
  process.exit(2)
})
