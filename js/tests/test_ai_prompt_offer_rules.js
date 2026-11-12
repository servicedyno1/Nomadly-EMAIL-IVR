// AI support: no NGN / bank when HIDE_BANK_PAYMENT=true; no old BulkSMS app when HIDE_SMS_APP=true; BulkSMS 🇺🇸🇨🇦 never "subscription".
// Run: node js/tests/test_ai_prompt_offer_rules.js
process.env.HIDE_BANK_PAYMENT = 'true'; process.env.HIDE_SMS_APP = 'true'
const p = require('../ai-support')._promptBase()
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const lines = (re) => p.split('\n').filter(l => re.test(l) && !/NEVER mention/.test(l) && !/NOT accepted/.test(l))
ok('no NGN / Naira / bank-pay offers', lines(/NGN|₦|Naira|Bank Transfer/i).length === 0, lines(/NGN|₦|Naira|Bank Transfer/i).slice(0, 3).join(' | '))
ok('payment = Wallet or Crypto', /Pay via Wallet or Crypto/.test(p))
ok('explicit rule: only wallet + crypto', /ONLY Wallet and Crypto/.test(p))
ok('no BulkSMS Android app / trial', lines(/BulkSMS Android app|BulkSMS -Trial|BulkSMS App access|BulkSMS App:/).length === 0, lines(/BulkSMS Android app|BulkSMS -Trial/).slice(0, 2).join(' | '))
ok('subscriptions do not include BulkSMS', !/URL Shortener \+ .*BulkSMS/.test(p) && /NOT part of any subscription/.test(p))
ok('new BulkSMS 🇺🇸🇨🇦 still in menu knowledge', /📲 BulkSMS 🇺🇸🇨🇦/.test(p))
ok('other sections intact (Email Blast, deposit)', /### 📧 Email Blast/.test(p) && /How do I deposit money/.test(p))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
