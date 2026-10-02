#!/usr/bin/env node
// Applies curated translations (scripts/i18n_fill/translations/<lang>/*.js) into js/lang/<lang>.js
// by AST-locating each property value and replacing its source text in place.
// Usage: node scripts/i18n_fill/apply.js <fr|hi|zh|en> [--dry]
const fs = require('fs')
const path = require('path')
const acorn = require('acorn')

const ROOT = path.resolve(__dirname, '../..')
const lang = process.argv[2]
const dry = process.argv.includes('--dry')
if (!lang) { console.error('usage: apply.js <lang>'); process.exit(2) }

const SECTIONS = ['t', 'user', 'u', 'vs', 'vp', 'hP', 'hostingPlansText', 'admin', 'payIn']
const file = path.join(ROOT, 'js/lang', `${lang}.js`)
const src = fs.readFileSync(file, 'utf8')

// 1. merge translation parts
const dir = path.join(__dirname, 'translations', lang)
const merged = {}
const topLevel = {} // `__topLevel: { constName: source }` → replaces a top-level `const constName = …` initializer
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const mod = require(path.join(dir, f))
  for (const [sec, obj] of Object.entries(mod)) {
    if (sec === '__topLevel') { Object.assign(topLevel, obj); continue }
    merged[sec] = merged[sec] || {}
    for (const [k, v] of Object.entries(obj)) {
      // later parts (sorted by filename) override earlier ones
      merged[sec][k] = v
    }
  }
}

// 2. parse + index top-level `const <section> = { ... }`
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true })
const index = {}
const topDecl = {}
for (const node of ast.body) {
  if (node.type !== 'VariableDeclaration') continue
  for (const d of node.declarations) {
    if (d.id?.type === 'Identifier' && d.init && d.id.name in topLevel) topDecl[d.id.name] = d.init
    if (d.id?.type !== 'Identifier' || !SECTIONS.includes(d.id.name)) continue
    if (d.init?.type !== 'ObjectExpression') continue
    const props = {}
    for (const p of d.init.properties) {
      if (p.type !== 'Property') continue
      const name = p.key.type === 'Identifier' ? p.key.name : String(p.key.value)
      if (p.shorthand) continue
      props[name] = p
    }
    index[d.id.name] = props
  }
}

function quote(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'"
}
function serialize(v) {
  if (typeof v === 'function') return v.toString()
  if (typeof v === 'string') return quote(v)
  if (v && typeof v === 'object' && typeof v.__src === 'string') return v.__src
  throw new Error('unsupported value type: ' + typeof v)
}

// 3. build replacements
const repls = []
const missing = []
for (const [sec, obj] of Object.entries(merged)) {
  for (const [k, v] of Object.entries(obj)) {
    const p = index[sec]?.[k]
    if (!p) { missing.push(`${sec}.${k}`); continue }
    const newSrc = serialize(v)
    const oldSrc = src.slice(p.value.start, p.value.end)
    if (oldSrc === newSrc) continue
    repls.push({ start: p.value.start, end: p.value.end, newSrc, key: `${sec}.${k}` })
  }
}
if (missing.length) { console.error(`[apply:${lang}] keys not found in ${file}:\n  ` + missing.join('\n  ')); process.exit(1) }
for (const [name, newSrc] of Object.entries(topLevel)) {
  const init = topDecl[name]
  if (!init) { console.error(`[apply:${lang}] top-level const ${name} not found`); process.exit(1) }
  const oldSrc = src.slice(init.start, init.end)
  if (oldSrc !== newSrc) repls.push({ start: init.start, end: init.end, newSrc, key: `const ${name}` })
}

repls.sort((a, b) => b.start - a.start)
let out = src
for (const r of repls) out = out.slice(0, r.start) + r.newSrc + out.slice(r.end)

// 4. syntax check before writing
try { acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script' }) } catch (e) {
  console.error(`[apply:${lang}] result does not parse: ${e.message}`); process.exit(1)
}
if (!dry) fs.writeFileSync(file, out)
console.log(`[apply:${lang}] ${repls.length} value(s) replaced${dry ? ' (dry run)' : ''}`)

// 5. verify arity + placeholders vs en
if (lang !== 'en') {
  const en = require(path.join(ROOT, 'js/lang/en.js')).en
  delete require.cache[require.resolve(file)]
  const tgt = dry ? null : require(file)[lang]
  const ph = (fn) => [...String(fn).matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].replace(/\s+/g, '')).sort().join('|')
  let warn = 0
  for (const [sec, obj] of Object.entries(merged)) {
    for (const k of Object.keys(obj)) {
      const e = en[sec]?.[k]
      const v = tgt ? tgt[sec]?.[k] : obj[k]
      if (e === undefined) { console.warn(`  ⚠ ${sec}.${k}: not in en`); warn++; continue }
      if (typeof e !== typeof v) { console.warn(`  ⚠ ${sec}.${k}: type ${typeof v} ≠ en ${typeof e}`); warn++; continue }
      if (typeof e === 'function') {
        if (e.length !== v.length) { console.warn(`  ⚠ ${sec}.${k}: arity ${v.length} ≠ en ${e.length}`); warn++ }
        if (ph(e) !== ph(v)) { console.warn(`  ⚠ ${sec}.${k}: placeholders differ\n      en: ${ph(e)}\n      ${lang}: ${ph(v)}`); warn++ }
      }
    }
  }
  console.log(`[apply:${lang}] verification: ${warn} warning(s)`)
}
