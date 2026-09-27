/**
 * Empty-state UX pass (2026-06) — static-source guards on _index.js.
 * Covers: intent-funnel resilience + reuse, first-deposit-bonus surfacing,
 * consolidated free-to-try hint, softened no-activity greeting line,
 * returning zero-activity re-onboarding, and the wallet-history empty CTA.
 *
 * Run: node js/tests/test_empty_state_ux_2026-06.js  (exit 0 = pass)
 */
const fs = require('fs')
const path = require('path')
const s = fs.readFileSync(path.join(__dirname, '..', '_index.js'), 'utf8')

let pass = 0, fail = 0
const failures = []
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('── Empty-state UX (2026-06) ──')

// P0-1: reusable + resilient intent funnel
ok('showFirstSessionIntent helper defined', /const showFirstSessionIntent = async \(lang\) =>/.test(s))
ok('helper sets action AFTER send (no strand on failure)',
  /await bot\.sendMessage\(chatId, q,[\s\S]{0,140}await set\(state, chatId, 'action', a\.firstSessionIntent\)/.test(s))
ok('helper falls back to full menu on any send error',
  /catch \(e\) \{[\s\S]{0,160}getMainMenuGreeting\(\)[\s\S]{0,80}send\(chatId, greeting, trans\('o'\)\)/.test(s))
ok('language handler renders funnel via the resilient helper (not a bare setTimeout body)',
  /setTimeout\(\(\) => \{ showFirstSessionIntent\(validLanguage\)\.catch\(\(\) => \{\}\) \}, welcomeBonusShown \? 1200 : 300\)/.test(s))
ok('welcome-bonus shown flag tracked for the funnel delay', /let welcomeBonusShown = false/.test(s))

// P0-2: first-deposit bonus surfaced in the empty state
ok('funnel surfaces the first-deposit bonus tip', /deposit \$20\+ and get \$\$\{depBonus\} free on your first deposit/.test(s))
ok('bonus amount read from userConversion (no hardcode drift)',
  /const depBonus = \(userConversion && userConversion\.FIRST_DEPOSIT_BONUS_USD\) \|\| 5/.test(s))

// P1: value prop + de-duped free hint + softened greeting
ok('funnel carries a one-line value prop', /your all-in-one toolkit: phone numbers, hosting, domains & digital products/.test(s))
ok('greeting uses a SINGLE consolidated free-to-try line',
  /Free to try: tap 📞 Cloud IVR for a free call/.test(s))
ok('old duplicate "free trial Quick IVR Call! Tap Cloud IVR" line removed',
  !/You have a free trial Quick IVR Call! Tap Cloud IVR to try it/.test(s))
ok('old separate sipTestMenuHint line removed from greeting',
  !/sipTestLine = `\\n\$\{pMsg\.sipTestMenuHint\}\\n`/.test(s))
ok('no-activity greeting line softened (no "Start spending to unlock discounts")',
  !/Start spending to unlock discounts/.test(s) && /Choose a service below to get started/.test(s))

// P1-4: returning zero-activity user re-onboarding (bounded, gated on hasPurchased)
ok('returning-user branch gated by firstSessionIntentDone + firstIntentReshown',
  /if \(!info\.firstSessionIntentDone && !info\.firstIntentReshown\)/.test(s))
ok('returning-user branch checks hasPurchased before re-showing funnel',
  /userConversion'\)\.findOne\(\{ chatId: String\(chatId\) \}\)[\s\S]{0,120}!_conv\?\.hasPurchased/.test(s))
ok('funnel completion marks firstSessionIntentDone',
  /if \(action === a\.firstSessionIntent\)[\s\S]{0,120}firstSessionIntentDone', true\)/.test(s))

// P2: wallet-history empty state gets a CTA keyboard
ok('empty transaction history renders a Wallet CTA keyboard',
  /return send\(chatId, trans\('t\.wlt_9'\), k\.of\(\[\[user\.wallet\]\]\)\)/.test(s))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  • ' + f)) }
process.exit(fail ? 1 : 0)
