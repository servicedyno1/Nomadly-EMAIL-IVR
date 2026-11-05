// Turns lang/fa.raw.js into lang/fa.js: any translated value that breaks (throws where English works, or changes
// type/shape) is replaced by the English one, so Farsi users never hit a crash — they just see English there.
const fs = require('fs')
const path = require('path')
const dir = path.join(__dirname, '..', 'js', 'lang')
const raw = fs.readFileSync(path.join(dir, 'fa.raw.js'), 'utf8')
fs.writeFileSync(path.join(dir, 'fa.check.js'), raw)
let fa
try { fa = require(path.join(dir, 'fa.check.js')).fa } catch (e) { console.error('fa.raw.js does not load:', e.message); process.exit(1) }
const { en } = require(path.join(dir, 'en.js'))
const DUMMY = [1, 'x', 2, 'y', 3, 'z']
const broken = []
const sameShape = (a, b) => typeof a === typeof b && (typeof a !== 'object' || a === null || Array.isArray(a) === Array.isArray(b))
function walk(e, f, p) {
  for (const k of Object.keys(e)) {
    const kp = p.concat(k), ev = e[k], fv = f ? f[k] : undefined
    if (fv === undefined || !sameShape(ev, fv)) { broken.push(kp); continue }
    if (typeof ev === 'function') {
      let eo, fo, eok = true, fok = true
      try { eo = ev(...DUMMY) } catch (_) { eok = false }
      try { fo = fv(...DUMMY) } catch (_) { fok = false }
      if (eok && (!fok || typeof eo !== typeof fo)) broken.push(kp)
    } else if (ev && typeof ev === 'object' && !Array.isArray(ev)) walk(ev, fv, kp)
    else if (Array.isArray(ev) && JSON.stringify(ev).replace(/"[^"]*"/g, 's').length !== JSON.stringify(fv).replace(/"[^"]*"/g, 's').length) broken.push(kp)
  }
}
walk(en, fa, [])
const out = raw.replace(/module\.exports = \{\n fa,\n\}/, `// Values that did not translate cleanly fall back to English.
const _en = require('./en.js').en
for (const p of ${JSON.stringify(broken)}) {
  let t = fa, s = _en
  for (const k of p.slice(0, -1)) { t = t?.[k]; s = s?.[k] }
  if (t && s) t[p[p.length - 1]] = s[p[p.length - 1]]
}
module.exports = {
 fa,
}`)
fs.writeFileSync(path.join(dir, 'fa.js'), out)
fs.unlinkSync(path.join(dir, 'fa.check.js'))
console.log('broken -> English:', broken.length, broken.slice(0, 15).map(p => p.join('.')).join(', '))
