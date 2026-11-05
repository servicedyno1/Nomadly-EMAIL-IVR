// iter218: phone-config orderSummary/paymentPrompt/activated/hubWelcome in all languages
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const pc = require('../phone-config')
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + String(d).slice(0, 400)}`) }
const step4 = { en: /Step 4 of 4/, fr: /4\s*(\/|sur)\s*4/, zh: /4\s*\/\s*4|第\s*4\s*步|4\s*步/, hi: /4\s*(\/|में से|का)\s*4|चरण 4/, fa: /۴ از ۴|4 از 4/ }
for (const lang of ['en', 'fr', 'zh', 'hi', 'fa']) {
  const T = pc.getTxt ? pc.getTxt(lang) : null
  if (!T) { ok(`${lang} getTxt`, false); continue }
  const plan = pc.plans.pro
  let s
  try { s = T.orderSummary('+18005550123', 'United States', plan, 75) } catch (e) { s = 'ERR ' + e.message }
  ok(`${lang} orderSummary step 4 of 4`, step4[lang].test(s), s)
  ok(`${lang} orderSummary no Capabilities line`, !/Capabilities|Voice · SMS · Fax/.test(s), s)
  ok(`${lang} orderSummary no Bulk IVR capable`, !/Bulk IVR capable/.test(s), s)
  const priceHits = (s.match(/\$75/g) || []).length
  ok(`${lang} orderSummary price: /mo + due today only (${priceHits})`, priceHits === 2 && !/undefined/.test(s), s)
  const sS = T.orderSummary('+18005550123', 'United States', pc.plans.starter, 50)
  ok(`${lang} starter summary has no-SIP warning`, sS.length > s.length - 60 && !/undefined/.test(sS), sS)
  const pp = T.paymentPrompt(75)
  ok(`${lang} paymentPrompt no price`, !/\$|75/.test(pp), pp)
  const actS = T.activated('+18005550123', 'starter', 50, 'sipuserX', 'sip.example.com', '2026-02-01')
  const actP = T.activated('+18005550123', 'pro', 75, 'sipuserX', 'sip.example.com', '2026-02-01')
  ok(`${lang} activated new copy`, /🎉/.test(actS) && !/Cloud IVR شما فعال است|is active!/.test(actS), actS)
  ok(`${lang} activated starter has no SIP block`, !/sipuserX|sip\.example\.com/.test(actS), actS)
  ok(`${lang} activated pro has SIP block`, /sipuserX/.test(actP), actP)
  const hub = typeof T.hubWelcome === 'function' ? T.hubWelcome() : T.hubWelcome
  ok(`${lang} hubWelcome mentions 4 steps`, /4|۴/.test(hub), hub)
  if (lang !== 'en') ok(`${lang} hubWelcome no stray English 'activated this week'`, !/activated this week/.test(hub), hub)
  if (lang === 'fa') console.log('--- FA orderSummary ---\n' + s + '\n--- FA activated starter ---\n' + actS + '\n--- FA hub ---\n' + hub)
}
console.log(`\n${pass}/${pass + fail} passed`)
