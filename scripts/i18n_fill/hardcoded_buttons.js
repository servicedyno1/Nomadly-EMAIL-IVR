#!/usr/bin/env node
// Lists hard-coded keyboard button labels in js/_index.js: string literals inside array "rows"
// ([ 'a', 'b' ]) that are themselves inside an array, a `.push(...)` call, or a `keyboard:` property.
// Usage: node scripts/i18n_fill/hardcoded_buttons.js [--with-lines]
const fs = require('fs')
const path = require('path')
const acorn = require('acorn')
const walk = require(require('fs').existsSync(path.join(__dirname, '../../node_modules/acorn-walk')) ? 'acorn-walk' : path.join(__dirname, '../../frontend/node_modules/acorn-walk'))
const ROOT = path.resolve(__dirname, '../..')
const src = fs.readFileSync(path.join(ROOT, 'js/_index.js'), 'utf8')
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true })
const withLines = process.argv.includes('--with-lines')

const found = new Map()
const add = (node) => {
  if (node.type !== 'Literal' || typeof node.value !== 'string') return
  const v = node.value
  if (!/[A-Za-z]{2,}/.test(v) || v.length > 60) return
  if (/^(HTML|Markdown|true|false|en|fr|zh|hi|[a-z_]+|\/[a-z]+|[A-Z]{2,}(\s\([A-Z0-9]+\))?|https?:.*|[\d.,\s-]+)$/.test(v)) return
  const e = found.get(v) || new Set()
  e.add(node.loc.start.line)
  found.set(v, e)
}
const isRow = (n) => n.type === 'ArrayExpression' && n.elements.length && n.elements.every(e => e && (e.type === 'Literal' || (e.type === 'ObjectExpression')))

walk.fullAncestor(ast, (node, _state, ancestors) => {
  if (!isRow(node)) return
  const parent = ancestors[ancestors.length - 2]
  const inArray = parent?.type === 'ArrayExpression'
  const inPush = parent?.type === 'CallExpression' && parent.callee?.property?.name === 'push'
  const inKeyboard = parent?.type === 'Property' && (parent.key?.name === 'keyboard' || parent.key?.name === 'inline_keyboard')
  if (!inArray && !inPush && !inKeyboard) return
  for (const el of node.elements) {
    if (el.type === 'Literal') add(el)
    else if (el.type === 'ObjectExpression') for (const p of el.properties) if (p.key?.name === 'text') add(p.value)
  }
})
const rows = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]))
for (const [v, lines] of rows) console.log(withLines ? `${JSON.stringify(v)}\t${[...lines].slice(0, 6).join(',')}` : JSON.stringify(v))
console.error(`# ${rows.length} labels`)
