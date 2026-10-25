/**
 * Regression test: phone-scheduler.js must NEVER pass a full phone number as
 * the PUBLIC arg of _notifyGroup. Public arg = first arg; admin/private arg
 * = second arg. The full number is OK in the private arg.
 *
 * Reported 2026-07-01: "phone number expiry or renewal to group is showing
 * the full number, it shouldn't".
 *
 * This is a STATIC-SOURCE guard: parses phone-scheduler.js and asserts every
 * _notifyGroup?.() call where the body references `phoneNumber` either:
 *   (a) wraps the PUBLIC (1st) phoneNumber occurrence in maskPhone(...), OR
 *   (b) the call has only one arg AND no phoneNumber is in the message at all.
 *
 * If anyone re-introduces `formatPhone(num.phoneNumber)` as the SOLE arg, or
 * passes raw `${num.phoneNumber}` to the first arg, this test fails.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'phone-scheduler.js'), 'utf8')

let pass = 0
let fail = 0
const it = (label, cond, detail = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else      { console.log(`  ❌ ${label}${detail ? '\n     ' + detail : ''}`); fail++ }
}

console.log('\n=== phone-scheduler.js — no-leak guard ===')

// Find every _notifyGroup?.( ... ) call (multiline body, until matching close).
// We use a simple balanced-paren scanner because regex can't handle nesting.
const findCalls = (src) => {
  const calls = []
  const TRIG = '_notifyGroup?.('
  let i = 0
  while (true) {
    const idx = src.indexOf(TRIG, i)
    if (idx === -1) break
    const start = idx + TRIG.length
    let depth = 1
    let j = start
    let inStr = null     // ' " ` for string state
    let inTpl = false    // for inside ${...} in template literal
    while (j < src.length && depth > 0) {
      const c = src[j]
      const prev = src[j - 1]
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null
      } else {
        if (c === "'" || c === '"' || c === '`') inStr = c
        else if (c === '(') depth++
        else if (c === ')') depth--
      }
      j++
    }
    const body = src.slice(start, j - 1)
    // Line number
    const line = src.slice(0, idx).split('\n').length
    // Split into args at TOP-level commas only (ignore commas inside strings/parens/objects)
    const args = []
    let acc = ''; let d = 0; let s = null
    for (let k = 0; k < body.length; k++) {
      const c = body[k]
      if (s) { if (c === s && body[k - 1] !== '\\') s = null; acc += c; continue }
      if (c === "'" || c === '"' || c === '`') { s = c; acc += c; continue }
      if (c === '(' || c === '[' || c === '{') d++
      if (c === ')' || c === ']' || c === '}') d--
      if (c === ',' && d === 0) { args.push(acc); acc = ''; continue }
      acc += c
    }
    if (acc.trim().length) args.push(acc)
    calls.push({ line, body, args: args.map((a) => a.trim()) })
    i = j
  }
  return calls
}

const calls = findCalls(SRC)
it(`found ≥6 _notifyGroup calls (got ${calls.length})`, calls.length >= 6)

let leaks = 0
for (const c of calls) {
  const pub = c.args[0] || ''
  const priv = c.args[1] || ''
  const pubHasRawPhone = /\bphoneNumber\b/.test(pub) || /num\.phoneNumber/.test(pub)
  const pubHasFormatPhone = /formatPhone\s*\(/.test(pub)
  const pubHasMaskPhone = /maskPhone\s*\(/.test(pub)

  // PUBLIC arg must either:
  //   - not contain phoneNumber at all (safe), OR
  //   - contain only maskPhone(...), no formatPhone or raw template
  const publicLeak =
    (pubHasRawPhone || pubHasFormatPhone) && !pubHasMaskPhone
  const rawTemplateLeak =
    /\$\{[^}]*\.phoneNumber[^}]*\}/.test(pub) && !pubHasMaskPhone

  if (publicLeak || rawTemplateLeak) {
    leaks++
    console.log(`  ❌ LEAK at line ${c.line}: public arg contains raw phone or formatPhone without maskPhone`)
    console.log(`     public: ${pub.slice(0, 200)}`)
  }
}
it(`zero leaks in _notifyGroup public args (found ${leaks})`, leaks === 0)

// Sanity: maskPhone must be imported in phone-scheduler.js
it(
  'maskPhone is imported from ./phone-config.js',
  /require\(['"]\.\/phone-config(\.js)?['"]\)/.test(SRC) && /\bmaskPhone\b/.test(SRC),
  'expected maskPhone in destructuring from phone-config.js'
)

// Public feed posts (group + admin) must mask the number in the group arg.
const groupSites = ['Grace Expired + Released', 'Expired + Released:', 'Auto-Renewed:', 'Plan expired — suspended:', 'Released after ', 'Main line ended — extra line suspended:']
for (const tag of groupSites) {
  const c = calls.find(x => x.body.includes(tag))
  it(`group post "${tag}" masks the number in its group arg`, !!c && /maskPhone\s*\(/.test(c.args[0] || ''))
}

// Internal reports (2026-10 owner decision): admin chat only — never a _notifyGroup call.
const adminOnly = ['Release ABORTED (safety)', 'Grace Period Started', 'Auto-Renew Deferred (no release)', 'Sub-number planPrice anomaly', 'PlanPrice MISMATCH', 'Auto-renew ABORTED — invalid planPrice', 'Daily pricing reconciler', 'Twilio sub-token rotated', 'Inactive number auto-removed']
for (const tag of adminOnly) {
  it(`internal report "${tag}" goes to admin only`, SRC.includes(tag) && !calls.some(x => x.body.includes(tag)))
}
it('admin-only reports use _notifyAdmin', (SRC.match(/_notifyAdmin\?\.\(/g) || []).length >= adminOnly.length)

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail === 0 ? 0 : 1)
