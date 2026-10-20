#!/usr/bin/env node
// Rebrand hardcoded "Nomadly" in USER-FACING string literals → the running bot's brand (CHAT_BOT_BRAND).
// AST-based (acorn): only touches string/template contents; skips `x || 'Nomadly'` fallbacks and object keys.
// Usage: node scripts/rebrand_strings.js <file>[:line,line,...] ...   (no line list = every occurrence)  --dry
const fs = require('fs')
const acorn = require('acorn')

const BRAND = "(process.env.CHAT_BOT_BRAND || 'Nomadly')"
const BOTNAME = "(process.env.CHAT_BOT_NAME || 'Nomadly Bot')"
const BOTUSER = "(process.env.BOT_USERNAME || 'Nomadlybot')"
// longest phrases first; each maps to a JS expression
const PHRASES = [
  [/t\.me\/Nomadlybot\b/g, ['t.me/', BOTUSER]],
  [/@Nomadlybot\b/g, ['@', BOTUSER]],
  [/(?:(?<=\\[ntr])|(?<![A-Za-z0-9]))Nomadly Bot\b/g, ['', BOTNAME]],
  [/(?:(?<=\\[ntr])|(?<![A-Za-z0-9]))Nomadly(?![-_]?[A-Za-z0-9])/g, ['', BRAND]],
]
const dry = process.argv.includes('--dry')

function walk(node, parent, key, cb) {
  if (!node || typeof node.type !== 'string') return
  cb(node, parent, key)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, node, k, cb))
    else if (v && typeof v.type === 'string') walk(v, node, k, cb)
  }
}

// split a raw string body into [text, expr, text, expr, ...]
function pieces(raw) {
  const hits = []
  for (const [re, [prefix, expr]] of PHRASES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(raw))) {
      if (!hits.some(h => m.index < h.end && m.index + m[0].length > h.start)) hits.push({ start: m.index, end: m.index + m[0].length, prefix, expr })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

for (const arg of process.argv.slice(2).filter(a => a !== '--dry')) {
  const [file, lineSpec] = arg.split(':')
  const only = lineSpec ? new Set(lineSpec.split(',').map(Number)) : null
  const src = fs.readFileSync(file, 'utf8')
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true, allowReturnOutsideFunction: true })
  const edits = []
  walk(ast, null, null, (node, parent, key) => {
    if (node.type === 'TaggedTemplateExpression') node.quasi._tagged = true   // String.raw`…` etc. stay untouched
    const isStr = node.type === 'Literal' && typeof node.value === 'string'
    const isTpl = node.type === 'TemplateElement'
    if (!isStr && !isTpl) return
    if (only && ![...Array(node.loc.end.line - node.loc.start.line + 1)].some((_, i) => only.has(node.loc.start.line + i))) return
    if (parent && parent.type === 'LogicalExpression' && key === 'right') return          // x || 'Nomadly' fallback
    if (parent && parent.type === 'Property' && key === 'key') return
    if (parent && (parent.type === 'ImportDeclaration' || (parent.type === 'CallExpression' && parent.callee.name === 'require'))) return
    if (isTpl && parent && parent._tagged) return
    const start = isStr ? node.start + 1 : node.start
    const end = isStr ? node.end - 1 : node.end
    const raw = src.slice(start, end)
    const hits = pieces(raw)
    if (!hits.length) return
    if (isStr) {
      const q = src[node.start]
      if (hits.length === 1 && hits[0].start === 0 && hits[0].end === raw.length && !hits[0].prefix) {
        edits.push({ start: node.start, end: node.end, text: hits[0].expr }); return
      }
      let out = '', pos = 0
      for (const h of hits) { out += raw.slice(pos, h.start) + h.prefix + `${q} + ${h.expr} + ${q}`; pos = h.end }
      out += raw.slice(pos)
      edits.push({ start: node.start, end: node.end, text: `(${q}${out}${q})` })
    } else {
      let out = '', pos = 0
      for (const h of hits) { out += raw.slice(pos, h.start) + h.prefix + '${' + h.expr + '}'; pos = h.end }
      out += raw.slice(pos)
      edits.push({ start, end, text: out })
    }
  })
  let out = src
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  if (out !== src) {
    acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true })
    if (!dry) fs.writeFileSync(file, out)
  }
  console.log(`${dry ? '[dry] ' : ''}${file}: ${edits.length} string(s) rebranded`)
}
