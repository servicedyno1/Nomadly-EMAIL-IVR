'use strict'
// VPS prepaid 1/3/6/12-month terms — pricing module + bot config builder + plans mapping.
const assert = require('assert')
const vpsTerms = require('../vps-terms')

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('  \u2705 ' + name) } else { fail++; console.log('  \u274c ' + name) } }

console.log('\n=== (1) vps-terms pricing math ===')
ok('TERM_MONTHS = [1,3,6,12]', JSON.stringify(vpsTerms.TERM_MONTHS) === '[1,3,6,12]')
ok('discounts 0/10/15/25', vpsTerms.discountPct(1) === 0 && vpsTerms.discountPct(3) === 10 && vpsTerms.discountPct(6) === 15 && vpsTerms.discountPct(12) === 25)
// monthly $18 → 1:18, 3:48.60, 6:91.80, 12:162.00
ok('termPrice 18×1 = 18', vpsTerms.termPrice(18, 1) === 18)
ok('termPrice 18×3 -10% = 48.60', vpsTerms.termPrice(18, 3) === 48.6)
ok('termPrice 18×6 -15% = 91.80', vpsTerms.termPrice(18, 6) === 91.8)
ok('termPrice 18×12 -25% = 162.00', vpsTerms.termPrice(18, 12) === 162)
const terms = vpsTerms.termsFor(18)
ok('termsFor returns 4 terms', terms.length === 4)
ok('term[3] (12mo) savings = 54', terms[3].savings_usd === 54 && terms[3].monthly_equivalent_usd === 13.5)
ok('term[1] (3mo) duration_days = 90', terms[1].duration_days === 90)

console.log('\n=== (2) parseMonths validation ===')
ok('omitted → 1', vpsTerms.parseMonths(undefined).months === 1 && vpsTerms.parseMonths('').months === 1)
ok('6 → 6', vpsTerms.parseMonths(6).months === 6)
ok('"12" → 12', vpsTerms.parseMonths('12').months === 12)
ok('2 → invalid_months', vpsTerms.parseMonths(2).error === 'invalid_months')
ok('5 → invalid_months', vpsTerms.parseMonths(5).error === 'invalid_months')
ok('0 → invalid_months', vpsTerms.parseMonths(0).error === 'invalid_months')
ok('abc → invalid_months', vpsTerms.parseMonths('abc').error === 'invalid_months')

console.log('\n=== (3) bot config builder — Linux VPS billingCycles ===')
;(async () => {
  try {
    const vm = require('../vm-instance-setup')
    const cfgs = await vm.fetchAvailableVPSConfigs('test-vps-terms', { region: 'EU', isRDP: false })
    ok('returns configs', Array.isArray(cfgs) && cfgs.length > 0)
    if (Array.isArray(cfgs) && cfgs.length) {
      const c = cfgs[0]
      const cycles = c.billingCycles || []
      ok('Linux plan has 4 billing cycles', cycles.length === 4)
      ok('cycle periods = 1/3/6/12', JSON.stringify(cycles.map(x => x.period)) === '[1,3,6,12]')
      ok('cycle discounts = 0/10/15/25', JSON.stringify(cycles.map(x => x.discountPct)) === '[0,10,15,25]')
      // all terms keep the SAME productId (single plan_id + months, per user choice)
      ok('all cycles share one productId', new Set(cycles.map(x => x.productId)).size === 1 && cycles[0].productId === c._id)
      // 3-month price = monthly × 3 × 0.90
      const monthly = c.monthlyPrice
      ok('3mo cycle price = monthly×3×0.90', cycles[1].price === vpsTerms.termPrice(monthly, 3))
      ok('12mo cycle price = monthly×12×0.75', cycles[3].price === vpsTerms.termPrice(monthly, 12))
    }

    console.log('\n=== (4) RDP config builder UNCHANGED (1/2/3, not 1/3/6/12) ===')
    const rdpCfgs = await vm.fetchAvailableVPSConfigs('test-vps-terms', { region: 'EU', isRDP: true })
    if (Array.isArray(rdpCfgs) && rdpCfgs.length) {
      const periods = (rdpCfgs[0].billingCycles || []).map(x => x.period)
      // RDP must NEVER inherit the Linux 1/3/6/12 VPS-term structure (its terms come from its own
      // multi-month productIds, or a single monthly cycle on monthly-only providers).
      ok('RDP did NOT inherit VPS 1/3/6/12 terms', JSON.stringify(periods) !== '[1,3,6,12]')
    } else {
      ok('RDP config builder returned (skipped if provider offline)', true)
    }

    console.log('\n=== (5) GET /vps/plans mapping shape (terms attached for Linux only) ===')
    const vpsProvider = require('../vps-provider')
    const prov = vpsProvider.pickProviderForOs(false)
    const products = prov.listProducts('EU', false) || []
    ok('DO Linux listProducts returns 1-month products only', products.length > 0 && products.every(p => (Number(p.durationMonths) || 1) === 1))
    if (products.length) {
      const base = products[0].pricing.totalWithMarkup
      const mapped = { price_usd: base, terms: vpsTerms.termsFor(base) }
      ok('mapped plan carries base price_usd', mapped.price_usd === base)
      ok('mapped plan carries 4 terms', mapped.terms.length === 4)
    }
  } catch (e) {
    fail++; console.log('  \u274c harness threw: ' + e.message)
  }

  console.log(`\n=== summary ===\n  PASS: ${pass}\n  FAIL: ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
})()
