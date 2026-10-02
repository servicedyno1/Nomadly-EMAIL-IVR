#!/usr/bin/env node
// Dumps en.js source lines for keys that are still identical-to-en in a target lang.
// Usage: node scripts/i18n_fill/dump_todo.js <fr|hi|zh>
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '../..')
const lang = process.argv[2]
const { SKIP, isSkipped } = require('./skip.js')

function leaves(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[fk] = v
    else if (typeof v === 'function') out[fk] = v.toString()
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, fk, out)
  }
  return out
}
const hasLatin = (s) => /[a-zA-Z]{3,}/.test(s)
const en = leaves(require(path.join(ROOT, 'js/lang/en.js')).en)
const tgt = leaves(require(path.join(ROOT, `js/lang/${lang}.js`))[lang])
const enSrc = fs.readFileSync(path.join(ROOT, 'js/lang/en.js'), 'utf8').split('\n')

const todo = []
for (const [k, v] of Object.entries(en)) {
  if (!(k in tgt) || tgt[k] !== v || !hasLatin(v) || isSkipped(k, lang)) continue
  todo.push(k)
}
console.log(`# ${lang}: ${todo.length} keys`)
for (const k of todo) {
  const leaf = k.split('.').pop()
  const re = new RegExp(`^\\s*${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `)
  const lines = enSrc.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean)
  console.log(`${k}  [en.js:${lines.join(',')}]`)
  for (const ln of lines.slice(0, 1)) {
    let s = enSrc[ln - 1]
    let i = ln
    while (!/,\s*$/.test(s) && i < enSrc.length && i - ln < 6) { s += '\n' + enSrc[i]; i++ }
    console.log('    ' + s.trim())
  }
}
