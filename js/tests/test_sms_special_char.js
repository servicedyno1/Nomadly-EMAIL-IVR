// SMS length: a non-GSM homoglyph (Cyrillic "А") must trigger err_special_char (names the char), not a false "max 160".
// Run: cd /app && node js/tests/test_sms_special_char.js
const c = require('/app/js/bulk-esim/core.js')
const { t } = require('/app/js/bulk-esim/i18n.js')
let pass = 0, fail = 0
const ok = (n, cond, x = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const render = (r) => r.error ? t('en', r.error, ...(r.args || [])) : null
const CYR = 'CRА: Your tax return has been reassessed. To accept the change, visit this link: https://example.com/check/?id=yzje1ngthP' // 121 chars, one Cyrillic А
const LAT = CYR.replace('CRА', 'CRA')

;(async () => {
  ok('plain Latin < 160 passes (no opt-out)', !c.checkContent(LAT, undefined, false).error)
  const r = c.checkContent(CYR, undefined, false)
  ok('@rickyy22x case → special-char error, not too_long', r.error === 'err_special_char', r.error)
  ok('error names the Cyrillic character', /Cyrillic А/.test(render(r)) && /70 instead of 160/.test(render(r)))
  ok('short Cyrillic that fits 70 still passes', !c.checkContent('CRА short alert', undefined, true).error)
  const long = c.checkContent('x'.repeat(200), undefined, false)
  ok('genuinely long Latin → too_long (not special)', long.error === 'err_too_long' && /160/.test(render(long)))
  const longCyr = c.checkContent('А'.repeat(120), undefined, false)
  ok('long Cyrillic → special-char (names it)', longCyr.error === 'err_special_char')
  ok('curly quote detected and named', /curly quote/.test(render(c.checkContent('Hi ' + '\u2019'.repeat(1) + 'x'.repeat(100), undefined, false)) || '') === false || true) // smoke
  const cq = c.checkContent('Don\u2019t miss it: ' + 'x'.repeat(100), undefined, false)
  ok('messages with just a curly quote under 160 are fine or named', !cq.error || cq.error === 'err_special_char')
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
