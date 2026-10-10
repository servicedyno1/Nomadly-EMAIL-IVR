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

console.log('\n=== Hosting upgrade receipt + failure messages — translations ===')
const RECEIPT_KEYS = ['upgradeSuccessTitle', 'upgradeSuccessOldPlan', 'upgradeSuccessNewPlan', 'upgradeSuccessNewExpiry', 'upgradeSuccessFooter', 'upgradeFailTerminated', 'upgradeFailReactivate', 'upgradeFailServer', 'domainLabel', 'chargedLabel', 'remainingBalanceLabel']
const enT = require('../lang/en.js').en.t
for (const lang of LANGS) {
  const raw = require(`../lang/${lang}.js`)[lang]
  t(`[${lang}] receipt + failure keys exist natively`, () => {
    for (const k of RECEIPT_KEYS) assert.ok(raw.t[k] !== undefined, `missing t.${k}`)
  })
  t(`[${lang}] receipt texts are translated (differ from English)`, () => {
    if (lang === 'en') return
    for (const k of ['upgradeSuccessTitle', 'upgradeSuccessOldPlan', 'upgradeSuccessNewPlan', 'upgradeSuccessFooter', 'upgradeFailTerminated', 'upgradeFailReactivate', 'upgradeFailServer']) {
      const a = translation(`t.${k}`, lang, 'x', 'y', 'z')
      const b = typeof enT[k] === 'function' ? enT[k]('x', 'y', 'z') : enT[k]
      assert.notStrictEqual(a, b, `t.${k} is still English in ${lang}`)
    }
  })
  t(`[${lang}] new expiry shows localized date`, () => {
    const s = translation('t.upgradeSuccessNewExpiry', lang, DATE)
    assert.ok(s.includes(EXPECTED_DATE[lang]) && !/Invalid Date|undefined/.test(s), s)
  })
  t(`[${lang}] footer differs for Golden vs Premium`, () => {
    assert.notStrictEqual(translation('t.upgradeSuccessFooter', lang, 'goldenCpanel'), translation('t.upgradeSuccessFooter', lang, 'premiumCpanel'))
  })
  t(`[${lang}] failure messages carry refund, reason and the localized button label`, () => {
    const btn = translation('user.getSupport', lang)
    const host = translation('user.hostingDomainsRedirect', lang)
    const term = translation('t.upgradeFailTerminated', lang, '62.50', host)
    assert.ok(term.includes('$62.50') && term.includes(host), term)
    const re = translation('t.upgradeFailReactivate', lang, '62.50', btn)
    assert.ok(re.includes('$62.50') && re.includes(btn), re)
    const sv = translation('t.upgradeFailServer', lang, 'package not found', '62.50', btn)
    assert.ok(sv.includes('$62.50') && sv.includes(btn) && sv.includes('package not found'), sv)
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
t('upgrade success message is fully translated and shows the renewal price', () => {
  const i = src.indexOf("let summary = trans('t.upgradeSuccessTitle')")
  assert.ok(i > 0, 'receipt not built from t.upgradeSuccessTitle')
  const body = src.slice(i, i + 1200)
  for (const k of ['upgradeSuccessOldPlan', 'upgradeSuccessNewPlan', 'domainLabel', 'upgradeConfirmListPrice', 'upgradeConfirmCredit', 'chargedLabel', 'upgradeSuccessNewExpiry', 'upgradeConfirmRenewsAt', 'remainingBalanceLabel', 'upgradeSuccessFooter']) {
    assert.ok(body.includes(`trans('t.${k}'`), `receipt missing t.${k}`)
  }
  assert.ok(!/Plan Upgraded Successfully|<b>Old Plan:|now available\. Anti-Red/.test(body), 'hard-coded English left in receipt')
})
t('upgrade failure messages (terminated / reactivate / server rejected) are translated', () => {
  const i = src.indexOf('if (action === a.confirmUpgradeHostingPay) {')
  const body = src.slice(i, i + 9000)
  assert.ok(body.includes("trans('t.upgradeFailTerminated', upgradePrice.toFixed(2), user.hostingDomainsRedirect)"))
  assert.ok(body.includes("trans('t.upgradeFailReactivate', upgradePrice.toFixed(2), user.getSupport)"))
  assert.ok(body.includes("trans('t.upgradeFailServer', whmErrText, upgradePrice.toFixed(2), user.getSupport)"))
  assert.ok(!/Upgrade not completed|has been <b>terminated<\/b>/.test(body), 'hard-coded English failure text left')
})
t('VPS/RDP options save term_ends_at and the summary receives it', () => {
  assert.ok(src.includes("await saveInfo('doPlanTermEndsAt', po.term_ends_at)"))
  assert.ok(src.includes('!!info.doPlanResizeDisk, usdBal, info.doPlanTermEndsAt)'))
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
