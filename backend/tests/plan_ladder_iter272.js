// iter272: 5-plan ladder bot config + price lock unit checks (node). Prints PASS/FAIL per check.
process.env.NODE_ENV = process.env.NODE_ENV || 'test'
const pc = require('/app/js/phone-config.js')
const lc = require('/app/js/plan-lifecycle.js')
let fail = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!cond) fail++ }

ok('plans order', JSON.stringify(Object.keys(pc.plans)) === JSON.stringify(['starter', 'standard', 'pro', 'business']), JSON.stringify(Object.keys(pc.plans)))
const P = pc.plans
ok('prices', P.starter.price === 50 && P.standard.price === 75 && P.pro.price === 100 && P.business.price === 120, [P.starter.price, P.standard.price, P.pro.price, P.business.price].join(','))
ok('names', P.starter.name === 'Basic' && P.standard.name === 'Starter' && P.pro.name === 'Pro' && P.business.name === 'Business', [P.starter.name, P.standard.name, P.pro.name, P.business.name].join(','))
for (const f of ['voicemail', 'sipCredentials', 'callRecording']) ok(`standard can ${f}`, pc.canAccessFeature('standard', f) === true)
for (const f of ['ivr', 'bulkCall', 'otpCollection']) ok(`standard cannot ${f}`, pc.canAccessFeature('standard', f) === false)
for (const f of ['voicemail', 'sipCredentials', 'callRecording']) ok(`starter cannot ${f}`, pc.canAccessFeature('starter', f) === false)
for (const f of ['ivr', 'voicemail', 'callRecording']) ok(`pro can ${f}`, pc.canAccessFeature('pro', f) === true)
const u1 = pc.upgradeMessage('voicemail', 'starter', 'en'); ok('upgradeMessage voicemail starter mentions Starter', /Starter/.test(u1), JSON.stringify(u1).slice(0, 200))
const u2 = pc.upgradeMessage('ivr', 'standard', 'en'); ok('upgradeMessage ivr standard mentions Pro', /Pro/.test(u2), JSON.stringify(u2).slice(0, 200))
const src = require('fs').readFileSync('/app/js/phone-config.js', 'utf8')
ok('NEXT_PLAN (source)', /NEXT_PLAN = \{ starter: 'standard', standard: 'pro', pro: 'business' \}/.test(src))
if (pc.NEXT_PLAN) ok('NEXT_PLAN', pc.NEXT_PLAN ? (pc.NEXT_PLAN.starter === 'standard' && pc.NEXT_PLAN.standard === 'pro' && pc.NEXT_PLAN.pro === 'business') : false, JSON.stringify(pc.NEXT_PLAN))
for (const lang of ['en', 'fr', 'zh', 'hi', 'fa']) {
  let b; try { b = pc.getBtn ? pc.getBtn(lang) : null } catch (e) { b = null }
  ok(`getBtn(${lang}).standardPlan`, !!(b && b.standardPlan), b && b.standardPlan)
  if (b && b.standardPlan && pc.planByButton) {
    let r; try { r = typeof pc.planByButton === 'function' ? pc.planByButton(b.standardPlan, lang) : pc.planByButton[b.standardPlan] } catch (e) { r = e.message }
    ok(`planByButton(${lang}) -> standard`, r === 'standard', JSON.stringify(r))
  }
}
for (const lang of ['en', 'fr', 'zh', 'hi', 'fa']) {
  try {
    const L = require(`/app/js/lang/${lang}.js`)
    const t = (L[lang] && L[lang].t) || L.t || L
    const S = pc.SUB_NUMBER_LIMITS
    const cp8 = t.cp_8('H', P.starter.price, P.starter.minutes, P.starter.sms, S.starter, P.pro.price, P.pro.minutes, P.pro.sms, S.pro, P.business.price, P.business.minutes, P.business.sms, S.business, P.standard.price, P.standard.minutes, S.standard)
    const s = String(cp8 || '')
    ok(`${lang} cp_8 has Starter block`, s.length > 0 && /Starter|starter/i.test(s) && /\$75/.test(s) && !/undefined/.test(s), s.slice(0, 80).replace(/\n/g, ' '))
    ok(`${lang} cp_8 no '0 SMS'`, !/\b0 SMS/.test(s))
  } catch (e) { ok(`${lang} cp_8 load`, false, e.message) }
}
// price lock
ok('lock pro 75', lc.renewalPrice({ plan: 'pro', planPrice: 75, priceLock: { plan: 'pro', price: 75 } }) === 75)
ok('no lock pro 100', lc.renewalPrice({ plan: 'pro', planPrice: 100 }) === 100)
ok('lock other plan ignored', lc.renewalPrice({ plan: 'business', planPrice: 75, priceLock: { plan: 'pro', price: 75 } }) === 120, String(lc.renewalPrice({ plan: 'business', planPrice: 75, priceLock: { plan: 'pro', price: 75 } })))
ok('standard canonical 75', lc.renewalPrice({ plan: 'standard', planPrice: 75 }) === 75)
ok('priceOnPlan locked pro->business 120', lc.priceOnPlan({ plan: 'pro', planPrice: 75, priceLock: { plan: 'pro', price: 75 } }, 'business') === 120, String(lc.priceOnPlan({ plan: 'pro', planPrice: 75, priceLock: { plan: 'pro', price: 75 } }, 'business')))
// re-entering pro after leaving it: lock still applies?
const back = lc.renewalPrice({ plan: 'pro', planPrice: 100, priceLock: { plan: 'pro', price: 75 } })
console.log(`INFO locked number that left pro and came back -> renewalPrice ${back} (lock never cleared on plan change)`)
console.log(fail ? `FAILED ${fail}` : 'ALL PASS')
process.exit(0)
