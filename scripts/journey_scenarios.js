#!/usr/bin/env node
// Scripted end-to-end journeys against the LOCAL sandbox bot (free-text steps included — the
// crawler only presses buttons). Each step asserts what the user must see next; a failure means
// a real person would be stuck. Money-moving buttons are never pressed.
// Usage: node scripts/journey_scenarios.js <chatId> [lang=en]   (chatId should be a fresh sandbox user)
const fs = require('fs')
const { makeSim, strip } = require('./lib/tg_sim')
const chatId = process.argv[2]
const LANG = process.argv[3] || 'en'
if (!chatId) { console.error('usage: journey_scenarios.js <chatId> [en|fr]'); process.exit(1) }

const L = {
  en: { langBtn: '🇬🇧 English', ivr: '📞 Cloud IVR + SIP', choosePlan: '🛒 Choose a Plan', monthly: 'Monthly', daily: 'Daily', skip: 'Skip', back: '↩️ Back', cancel: 'Cancel',
    domains: '🌐 Bulletproof Domains', buyDomain: '🛒🌐 Buy Domain Names', support: '💬 Support', wallet: '👛 Wallet', upgrade: '⚡ Upgrade Plan',
    resume: '✅ Complete My Order', fresh: '🆕 Start Fresh', plainBack: 'Back',
    notAvail: /isn't available|not available/i, validPlan: /valid plan/i, coupon: /coupon/i, payMethod: /payment method/i, resumeQ: /resume\?/i },
  fr: { langBtn: '🇫🇷 French', ivr: '📞 Cloud IVR + SIP', choosePlan: '🛒 Choisir un Forfait', monthly: 'Mensuel', daily: 'Quotidien', skip: 'Passer', back: '↩️ Retour', cancel: 'Annuler',
    domains: '🌐 Domaines Blindés', buyDomain: '🛒🌐 Acheter des noms de domaine', support: '💬 Support', wallet: '👛 Portefeuille', upgrade: '⚡ Améliorer le plan',
    resume: '✅ Terminer ma commande', fresh: '🆕 Recommencer', plainBack: 'Retour',
    notAvail: /n'est pas disponible|pas disponible/i, validPlan: /forfait valide|plan valide/i, coupon: /coupon|code promo/i, payMethod: /méthode de paiement|mode de paiement/i, resumeQ: /reprendre|resume\?/i },
}[LANG]

const sim = makeSim(chatId)
const results = []
let screen = { kb: [], force: false }
const kbHas = re => screen.kb.some(b => re.test(b))
const lastText = res => strip(res.msgs[res.msgs.length - 1]?.text || '')

async function run(name, steps) {
  const fails = []
  for (const [sendRaw, check] of steps) {
    const send = typeof sendRaw === 'function' ? sendRaw() : sendRaw
    const res = await sim.say(screen, send)
    const txt = lastText(res)
    const why = check ? check(res, txt) : null
    if (res.errors.length) fails.push(`"${send}" → JS error: ${res.errors[0]}`)
    if (why) fails.push(`"${send}" → ${why} | bot: "${txt.replace(/\n/g, ' ⏎ ').slice(0, 120)}" | kb: [${screen.kb.slice(0, 8).join(' | ')}]`)
    if (why) break
  }
  results.push({ name, ok: !fails.length, fails })
  console.log(`${fails.length ? '❌' : '✅'} ${name}${fails.map(f => `\n     ${f}`).join('')}`)
}
const need = (cond, msg) => (cond ? null : msg)
const hasKb = () => need(screen.kb.length > 0, 'no reply keyboard on screen (stranded)')
const mainMenu = () => need(screen.kb.length >= 10, 'expected main menu keyboard')

;(async () => {
  // fresh user → language → dismiss first-run quick-pick
  await sim.say(screen, '/start')
  if (kbHas(/english|french/i)) { await sim.say(screen, L.langBtn); await new Promise(r => setTimeout(r, 2500)) }
  await sim.say(screen, '/start')
  if (kbHas(/just looking|je regarde/i)) await sim.say(screen, screen.kb.find(b => /just looking|je regarde/i.test(b)))

  await run('subscription upgrade (Daily/Weekly/Monthly) reaches payment screen and Back/Cancel work', [
    ['/start', mainMenu],
    [L.upgrade, () => need(kbHas(/^(Daily|Quotidien)$/) && kbHas(/^(Monthly|Mensuel)$/), 'plan keyboard (Daily/Weekly/Monthly) missing')],
    ['not-a-plan', (_r, t) => need(L.validPlan.test(t) && kbHas(/^(Daily|Quotidien)$/), 'typing junk must re-show the plan keyboard')],
    [L.monthly, (_r, t) => need(L.coupon.test(t) && kbHas(/skip|passer|ignorer/i), 'coupon prompt with Skip expected')],
    [() => screen.kb.find(b => /skip|passer|ignorer/i.test(b)) || L.skip, (_r, t) => need(L.payMethod.test(t) && kbHas(/deposit|dépôt|crypto/i) && kbHas(/back|retour/i), 'payment-method screen with Deposit/Crypto + Back expected')],
    [L.back, (_r, t) => need(L.coupon.test(t) && kbHas(/skip|passer|ignorer/i), 'Back from payment must return to coupon prompt')],
    [L.cancel, mainMenu],
  ])

  await run('phone-number plan → country → number → payment screen (the production complaint path)', [
    ['/start', hasKb],
    [L.fresh, mainMenu],
    [L.ivr, () => need(kbHas(/choose a plan|choisir un forfait/i), 'IVR submenu missing Choose a Plan')],
    [L.choosePlan, () => need(kbHas(/pro/i) && kbHas(/starter/i), 'phone plan keyboard (Starter/Pro/Business) missing')],
    ['not-a-plan', () => need(kbHas(/pro/i), 'typing junk must keep the plan keyboard')],
    [() => screen.kb.find(b => /pro/i.test(b)) || '⭐ Pro — $75/mo', () => need(kbHas(/united states|états-unis/i), 'country keyboard expected')],
    [() => screen.kb.find(b => /united states|états-unis/i.test(b)) || '🇺🇸 United States', () => need(kbHas(/toll-free|numéro vert|numéro gratuit|sans frais|local/i), 'number-type keyboard expected')],
    [() => screen.kb.find(b => /toll-free|numéro vert|numéro gratuit|sans frais/i.test(b)) || '🆓 Toll-Free Number', () => need(kbHas(/^1$/), 'number list (1..6) expected')],
    ['1', () => need(kbHas(/deposit|dépôt|crypto/i) && kbHas(/back|retour/i), 'payment screen with Deposit/Crypto + Back expected')],
    [L.plainBack, hasKb],
    [L.cancel, mainMenu],
  ])

  await run('/start "Welcome back — resume?" → Complete My Order is NOT swallowed', [
    ['/start', (_r, t) => need(L.resumeQ.test(t) && kbHas(/complete my order|terminer ma commande/i), 'expected resume prompt (session saved by previous scenario)')],
    [L.resume, (_r, t) => need(!L.notAvail.test(t) && !/valid/i.test(t) && screen.kb.length > 0 && kbHas(/deposit|dépôt|pay|crypto|wallet|portefeuille/i), 'Complete My Order must open the payment / balance wall')],
    [L.cancel, hasKb],
  ])

  await run('/start resume prompt → Back and Start Fresh both escape to a menu', [
    ['/start', () => need(screen.kb.length > 0, 'no keyboard after /start')],
    [L.plainBack, hasKb],
    ['/start', hasKb],
    [L.fresh, () => (kbHas(/complete my order|terminer ma commande/i) ? 'Start Fresh did not dismiss the resume prompt' : mainMenu())],
    ['/start', (_r, t) => need(!L.resumeQ.test(t), 'resume prompt must be gone after Start Fresh')],
  ])

  await run('stale plan button at main menu does not strand', [
    ['/start', mainMenu],
    [L.daily, hasKb],
    ['/start', mainMenu],
  ])

  await run('random text at main menu gets a keyboard back', [
    ['/start', mainMenu],
    ['asdfgh qwerty', hasKb],
    ['/start', mainMenu],
  ])

  await run('domain search (free text) always answers with a keyboard', [
    [L.domains, () => need(kbHas(/buy domain|acheter/i), 'domains submenu missing Buy Domain Names')],
    [L.buyDomain, hasKb],
    ['crawler-test-xyz123', hasKb],
    ['crawler-test-xyz123.com', (r) => need(screen.kb.length > 0 || r.msgs.length > 0, 'no reply to a domain lookup')],
    [L.cancel, hasKb],
    ['/start', mainMenu],
  ])

  await run('support chat opens with /done and /done returns to the menu', [
    [L.support, hasKb],
    ['/done', mainMenu],
  ])

  const bad = results.filter(r => !r.ok)
  console.log(`\n══ ${results.length - bad.length}/${results.length} scenarios passed`)
  const out = `/app/test_reports/journey_scenarios_${LANG}.json`
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), chatId, lang: LANG, results }, null, 2))
  console.log(`report → ${out}`)
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('SCENARIO ERR', e.message); process.exit(2) })
