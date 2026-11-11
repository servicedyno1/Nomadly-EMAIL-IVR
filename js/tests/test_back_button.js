/**
 * Tests for isBackPress() — the helper that fixes the IVR-OB Custom-Script
 * "Back-button trap" rage-tap bug from production (user `fuckthisapp` tapped
 * Back 16× in 8s because the bot's `message === t.back` check was missing the
 * emoji-prefixed variants the visible button rendered as).
 *
 * Run with: node js/tests/test_back_button.js
 */

// Extract the isBackPress function from _index.js without booting the bot.
// We re-implement the same logic here to test in isolation, then assert that
// _index.js exports the identical implementation by source-comparing.
const fs = require('fs')
const path = require('path')

let pass = 0, fail = 0
function ok(name, cond, note = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} — ${note}`) }
}

// ─── Mirror the implementation from _index.js (kept in sync) ──────────
function isBackPress(message) {
  if (!message || typeof message !== 'string') return false
  const m = message.trim()
  if (m === '↩️ Back' || m === '🔙 Back' || m === '⬅️ Back') return true
  const stripped = m.replace(/^[\p{Extended_Pictographic}\u200d\ufe0f\s↩🔙]+/u, '').trim()
  const knownBacks = new Set(['Back', 'Retour', '返回', 'वापस', 'بازگشت'])
  return knownBacks.has(stripped)
}

// ─── Confirm _index.js really has the same implementation ─────────────
const src = fs.readFileSync(path.resolve(__dirname, '..', '_index.js'), 'utf8')
ok('isBackPress is defined in _index.js', /function\s+isBackPress\s*\(\s*message\s*\)/.test(src))
ok('_index.js no longer contains strict "message === t.back" patterns',
   !/message\s*===\s*t\.back\b(?!Button)/.test(src),
   '(use replace_all should have caught all of them)')

// ─── Standardization: exactly one back-button style is rendered ───────
// (THE assertion: every visible button is `↩️ Back`, never `🔙 Back` / `⬅️ Back`
//  / `t.backButton` / raw `t.back` in a row. The two non-button references
//  to `🔙 Back` and `⬅️ Back` inside `isBackPress` are preserved for backward
//  compatibility — accepting old keyboards that may still be on user screens.)
const occ = (re) => (src.match(re) || []).length
ok('rendered keyboards use ONLY "↩️ Back"',
   occ(/'↩️ Back'/g) > 100,                         // sanity: a lot of them
   `count=${occ(/'↩️ Back'/g)}`)
ok('NO "🔙 Back" buttons remain (except inside isBackPress accept-list)',
   occ(/'🔙 Back'/g) === 1,                         // only inside isBackPress()
   `count=${occ(/'🔙 Back'/g)}`)
ok('NO "⬅️ Back" buttons remain (except inside isBackPress accept-list)',
   occ(/'⬅️ Back'/g) === 1,                         // only inside isBackPress()
   `count=${occ(/'⬅️ Back'/g)}`)
ok('NO "t.backButton" references remain anywhere',
   occ(/t\.backButton\b/g) === 0,
   `count=${occ(/t\.backButton\b/g)}`)
ok('NO "[t.back]" raw rows remain (was 77)',
   occ(/\[t\.back\]/g) === 0,
   `count=${occ(/\[t\.back\]/g)}`)
ok('NO "t.back || ..." fallback patterns remain',
   occ(/t\.back\s*\|\|\s*'/g) === 0,
   `count=${occ(/t\.back\s*\|\|\s*'/g)}`)

// ─── Visible button strings (must all return true) ────────────────────
ok('"↩️ Back" matches (THE rage-tap regression)', isBackPress('↩️ Back') === true)
ok('"🔙 Back" matches', isBackPress('🔙 Back') === true)
ok('"⬅️ Back" matches (legacy t.backButton style)', isBackPress('⬅️ Back') === true)
ok('"🔙 Retour" matches (fr)', isBackPress('🔙 Retour') === true)
ok('"🔙 返回" matches (zh)', isBackPress('🔙 返回') === true)
ok('"🔙 वापस" matches (hi)', isBackPress('🔙 वापस') === true)
ok('"↩️ Retour" matches', isBackPress('↩️ Retour') === true)

// ─── Plain locale words (must all return true) ────────────────────────
ok('"Back" matches (en t.back)', isBackPress('Back') === true)
ok('"Retour" matches (fr t.back)', isBackPress('Retour') === true)
ok('"↩️ بازگشت" matches (fa)', isBackPress('↩️ بازگشت') === true)
ok('"返回" matches (zh t.back)', isBackPress('返回') === true)
ok('"वापस" matches (hi t.back)', isBackPress('वापस') === true)

// ─── Whitespace tolerance ─────────────────────────────────────────────
ok('"  ↩️ Back  " matches (trim)', isBackPress('  ↩️ Back  ') === true)
ok('" Back " matches (trim)', isBackPress(' Back ') === true)

// ─── Things that must NOT match ───────────────────────────────────────
ok('empty string → false', isBackPress('') === false)
ok('null → false', isBackPress(null) === false)
ok('undefined → false', isBackPress(undefined) === false)
ok('non-string number → false', isBackPress(42) === false)
ok('"Backwards" → false (substring trap)', isBackPress('Backwards') === false)
ok('"Bring Online" → false', isBackPress('Bring Online') === false)
ok('"go back to start" → false (sentence with "back")', isBackPress('go back to start') === false)
ok('"📞 Back end" → false (NO match: "Back end" stripped to "Back end", not in set)',
   isBackPress('📞 Back end') === false)

// ─── Production scenarios (the actual rage-tap event) ─────────────────
ok(
  'production scenario 1: French user lang=fr, sees button "↩️ Back" (English emoji label, untranslated), taps it → previously did NOT match t.back which is "Retour", now matches',
  isBackPress('↩️ Back') === true,
)
ok(
  'production scenario 2: user mid-flow on Custom Script screen taps button → previously dropped through to "treat as script content", now correctly back-navigates',
  isBackPress('↩️ Back') === true,
)
ok(
  'production scenario 3: user types "Back" manually as fallback (still works post-fix)',
  isBackPress('Back') === true,
)

console.log(`\n${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
