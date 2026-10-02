#!/usr/bin/env node
// Frequency table of Latin-script words left inside zh/hi values (non-skipped keys, text pieces only).
// Usage: node scripts/i18n_fill/latin_words.js <zh|hi> [--keys WORD]
const path = require('path')
const acorn = require('acorn')
const ROOT = path.resolve(__dirname, '../..')
const { isSkipped } = require('./skip.js')
const lang = process.argv[2]
const keysFor = process.argv.includes('--keys') ? process.argv[process.argv.indexOf('--keys') + 1] : null

function leaves(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' || typeof v === 'function') out[fk] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, fk, out)
  }
  return out
}
function textPieces(v) {
  if (typeof v === 'string') return [v]
  let ast
  try { ast = acorn.parseExpressionAt(`(${v.toString()})`, 0, { ecmaVersion: 'latest' }) } catch { return [] }
  const out = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value)
    else if (n.type === 'TemplateElement') out.push(n.value.cooked ?? n.value.raw)
    else if (n.type === 'Property' && !n.computed && n.key?.type === 'Identifier') { walk(n.value); return }
    for (const key of Object.keys(n)) if (!['type', 'start', 'end', 'loc'].includes(key)) walk(n[key])
  })(ast)
  return out
}
const strip = s => s
  .replace(/<\/?[a-z]+[^>]*>/gi, ' ').replace(/\$\{[^}]*\}/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ').replace(/\/[a-z_]+\b/g, ' ').replace(/[@#]\w+/g, ' ')
  .replace(/\b[a-z0-9.-]+\.(com|net|org|io|app|xyz|sbs|de|fr|uk|us|ke|ch|me)\b/gi, ' ')

const tgt = leaves(require(path.join(ROOT, `js/lang/${lang}.js`))[lang])
const freq = new Map()
for (const [k, v] of Object.entries(tgt)) {
  if (isSkipped(k, lang)) continue
  for (const p of textPieces(v)) {
    for (const w of strip(p).match(/[A-Za-z][A-Za-z'’-]{2,}/g) || []) {
      const e = freq.get(w) || { n: 0, keys: new Set() }
      e.n++; e.keys.add(k); freq.set(w, e)
    }
  }
}
if (keysFor) { console.log([...(freq.get(keysFor)?.keys || [])].join('\n')); process.exit(0) }
const rows = [...freq.entries()].sort((a, b) => b[1].n - a[1].n)
console.log(rows.map(([w, e]) => `${w}\t${e.n}\t${[...e.keys].slice(0, 3).join(',')}`).join('\n'))
