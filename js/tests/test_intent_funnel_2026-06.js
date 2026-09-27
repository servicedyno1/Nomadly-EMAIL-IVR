/**
 * Verification for audit fix #17 — first-session intent funnel.
 * A NEW user, right after picking a language, is asked "What do you need today?"
 * and jumps straight to the relevant hub (or the full menu via "Just looking"),
 * instead of facing the 17-button dump.
 *
 * Run: node js/tests/test_intent_funnel_2026-06.js  (exit 0 = pass)
 */
const fs = require('fs')
const path = require('path')
const s = fs.readFileSync(path.join(__dirname, '..', '_index.js'), 'utf8')

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('── Fix #17 — first-session intent funnel ──')

check('firstSessionIntent action is registered', /firstSessionIntent: 'firstSessionIntent'/.test(s))
check('intent options defined for 5 choices', /const FIRST_SESSION_INTENT = \{[\s\S]{0,600}numbers:[\s\S]{0,400}hosting:[\s\S]{0,400}domains:[\s\S]{0,400}digital:[\s\S]{0,400}looking:/.test(s))
check('intent options localised (en/fr/zh/hi)', /numbers: \{ en:[\s\S]{0,120}fr:[\s\S]{0,120}zh:[\s\S]{0,120}hi:/.test(s))
check('_ALL lookup arrays built from the intent map', /const FIRST_SESSION_INTENT_ALL = Object\.fromEntries/.test(s))

// New-user path shows the intent question instead of the greeting dump
check('new-user path sets the firstSessionIntent action', /await set\(state, chatId, 'action', a\.firstSessionIntent\)/.test(s))
check('new-user path asks "what do you need today"', /What do you need today\?/.test(s))
check('intent question offers "Just looking" to reach the full menu', /Just looking to browse everything/.test(s))

// Routing handler
check('intent handler routes Numbers/IVR → Cloud IVR hub (submenu5)', /FIRST_SESSION_INTENT_ALL\.numbers\.includes\(message\)\) return goto\.submenu5/.test(s))
check('intent handler routes Hosting → hosting hub (submenu3)', /FIRST_SESSION_INTENT_ALL\.hosting\.includes\(message\)\) return goto\.submenu3/.test(s))
check('intent handler routes Domains → domains hub (submenu2)', /FIRST_SESSION_INTENT_ALL\.domains\.includes\(message\)\) return goto\.submenu2/.test(s))
check('intent handler routes Digital → digital hub (submenu6)', /FIRST_SESSION_INTENT_ALL\.digital\.includes\(message\)\) return goto\.submenu6/.test(s))
check('unrecognized / "Just looking" falls through to the full menu (never stuck)',
  /if \(action === a\.firstSessionIntent\)[\s\S]{0,800}return goto\.displayMainMenuButtons\(\)\n  \}/.test(s))

// The intent handler must sit BEFORE the settings handler (so it is reached)
check('intent handler is placed before the settings menu handler',
  s.indexOf("if (action === a.firstSessionIntent)") < s.indexOf("if (action === a.settingsMenu)"))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  • ' + f)) }
process.exit(fail ? 1 : 0)
