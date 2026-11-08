// TDZ check: flag identifiers used before their let/const declaration in the fax early paths of js/_index.js
const { Linter } = require('eslint')
const fs = require('fs')
const src = fs.readFileSync(__dirname + '/../js/_index.js', 'utf8')
const linter = new Linter()
const msgs = linter.verify(src, {
  languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
  rules: { 'no-use-before-define': ['error', { functions: false, classes: true, variables: true }] },
})
const fatal = msgs.filter(m => m.fatal)
if (fatal.length) { console.log('PARSE ERROR', fatal); process.exit(2) }
const ranges = [[8466, 8506], [30750, 30761]]
const hits = msgs.filter(m => ranges.some(([a, b]) => m.line >= a && m.line <= b))
console.log('total no-use-before-define msgs in file:', msgs.length)
console.log('hits in fax early paths:', hits.length)
hits.forEach(h => console.log(h.line, h.message))
// also: does faxBulkList call site at 8485 resolve to the function declaration (same/enclosing scope)?
process.exit(hits.length ? 1 : 0)
