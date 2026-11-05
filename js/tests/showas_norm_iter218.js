// iter218: extract trycall._showAs and call-me inline normaliser; check 10-digit → +1
const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../cloudivr-web/trycall.js', 'utf8')
const fn = src.match(/function _showAs\(raw\) \{[\s\S]*?\n\}/)[0]
const _showAs = new Function('require', fn + '; return _showAs')(p => p === './caller-ids' ? require('../cloudivr-web/caller-ids') : require(p))
const cases = [['4155550199', '+14155550199'], ['(415) 555-0199', '+14155550199'], ['+447911123456', '+447911123456'], ['447911123456', '+447911123456'], ['911', undefined], ['12', undefined], ['', null]]
let ok = 0; for (const [i, e] of cases) { const r = _showAs(i); const p = r === e; ok += p; console.log(`${p ? 'PASS' : 'FAIL'} _showAs(${JSON.stringify(i)}) = ${r}`) }
console.log(`${ok}/${cases.length}`)
