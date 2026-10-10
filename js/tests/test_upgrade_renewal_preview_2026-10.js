/* eslint-disable no-console */
// Renewal price + date on the bot's upgrade confirm screens (2026-10).
//   • Hosting "Confirm Upgrade" screen fully translated (en/fr/hi/zh) + shows renewal price & next renewal date
//   • VPS/RDP "Plan change summary" shows the next renewal DATE (term end) next to the price
//   • Translated 💵 pay buttons are matched by the hosting upgrade + renew pay handlers (hi/zh were missed)
// Run: node js/tests/test_upgrade_renewal_preview_2026-10.js
'use strict'
const fs = require('fs')
const assert = require('assert')
const { translation } = require('../translation')

let passed = 0
let failed = 0
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`) }
}
const LANGS = ['en', 'fr', 'hi', 'zh']
const DATE = new Date('2026-11-09T12:00:00Z')
const EXPECTED_DATE = { en: 'Nov 9, 2026', fr: '9 nov. 2026', hi: '2026', zh: '2026年11月9日' }
const KEYS = ['upgradeConfirmTitle', 'upgradeConfirmTo', 'upgradeConfirmListPrice', 'upgradeConfirmCredit', 'upgradeConfirmYouPay', 'upgradeConfirmRenewsAt', 'upgradeConfirmNextRenewal']
const src = fs.readFileSync(require('path').resolve(__dirname, '../_index.js'), 'utf8')

console.log('\n=== Hosting upgrade confirm screen — translations ===')
for (const lang of LANGS) {
  const raw = require(`../lang/${lang}.js`)[lang]
  t(`[${lang}] all confirm-screen keys exist natively (no en fallback)`, () => {
    for (const k of KEYS) assert.ok(raw.t[k] !== undefined, `missing t.${k}`)
  })
  t(`[${lang}] renews-at shows price + 30 days`, () => {
    const s = translation('t.upgradeConfirmRenewsAt', lang, '100.00', 30)
    assert.ok(s.includes('$100.00') && s.includes('30'), s)
  })
  t(`[${lang}] next renewal shows localized date`, () => {
    const s = translation('t.upgradeConfirmNextRenewal', lang, DATE, 30)
    assert.ok(s.includes(EXPECTED_DATE[lang]) && !/Invalid Date|undefined/.test(s), s)
  })
  t(`[${lang}] list price / credit / you-pay / upgrade-to render values`, () => {
    assert.ok(translation('t.upgradeConfirmListPrice', lang, '100.00').includes('$100.00'))
    assert.ok(translation('t.upgradeConfirmCredit', lang, '15.00').includes('-$15.00'))
    assert.ok(translation('t.upgradeConfirmYouPay', lang, '85.00').includes('$85.00'))
    assert.ok(translation('t.upgradeConfirmTo', lang, 'Golden Anti-Red HostPanel (30 Days)').includes('Golden Anti-Red HostPanel (30 Days)'))
  })
  t(`[${lang}] pay button starts with 💵 and deposit button does not`, () => {
    assert.ok(translation('t.renewModalPayButton', lang, '85.00').startsWith('💵'))
    assert.ok(!translation('u.deposit', lang).startsWith('💵'))
  })
}

console.log('\n=== VPS/RDP plan change summary — renewal date ===')
const cur = { name: 'Basic 1 GB', monthly_price_usd: 12, disk_gb: 25 }
const opt = { name: 'Basic 2 GB', monthly_price_usd: 24, disk_gb: 50, charge_now_usd: 6, direction: 'upgrade', renewal_price_usd: 24 }
for (const lang of LANGS) {
  t(`[${lang}] summary shows $24 + term-end date`, () => {
    const s = translation('vp.doPlanSummary', lang, 'srv-1', cur, opt, false, 50, '2026-11-09T12:00:00.000Z')
    assert.ok(s.includes('$24') && s.includes(EXPECTED_DATE[lang]), s)
  })
  t(`[${lang}] summary without a date (old session) has no Invalid Date/undefined`, () => {
    const s = translation('vp.doPlanSummary', lang, 'srv-1', cur, opt, false, 50, undefined)
    assert.ok(s.includes('$24') && !/Invalid Date|undefined/.test(s), s)
  })
}

console.log('\n=== Bot wiring (static) ===')
t('confirm screen uses the same renewal price + 30-day term as the payment step', () => {
  const i = src.indexOf('if (action === a.confirmUpgradeHosting) {')
  const body = src.slice(i, i + 3000)
  assert.ok(body.includes("require('./hosting-scheduler').getPlanPrice(selected.name)"))
  assert.ok(body.includes('30 * 24 * 60 * 60 * 1000'))
  assert.ok(body.includes("trans('t.upgradeConfirmRenewsAt'") && body.includes("trans('t.upgradeConfirmNextRenewal'"))
  assert.ok(body.includes("trans('t.renewModalPayButton', upgradePrice.toFixed(2))"))
  assert.ok(!body.includes('Confirm payment below:'), 'hard-coded English left on confirm screen')
})
t('hosting upgrade pay handler accepts translated 💵 buttons', () => {
  const i = src.indexOf('if (action === a.confirmUpgradeHostingPay) {')
  assert.ok(src.slice(i, i + 400).includes("message.startsWith('💵')"))
})
t('hosting renew pay handler accepts translated 💵 buttons (hi/zh fix)', () => {
  const i = src.indexOf('if (action === a.confirmRenewNow) {')
  const body = src.slice(i, i + 900)
  assert.ok(body.includes("message.startsWith('💵')") && !body.includes("startsWith('💵 Pay')"))
})
t('upgrade success message shows the renewal price', () => {
  assert.ok(src.includes('`<b>Renews at:</b> $${newRenewalPrice.toFixed(2)} every 30 days\\n`'))
})
t('VPS/RDP options save term_ends_at and the summary receives it', () => {
  assert.ok(src.includes("await saveInfo('doPlanTermEndsAt', po.term_ends_at)"))
  assert.ok(src.includes('!!info.doPlanResizeDisk, usdBal, info.doPlanTermEndsAt)'))
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
