#!/usr/bin/env node
// Prints the full value of dotted keys from a lang file. Usage: node show.js <lang> key1 key2 ...
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const [lang, ...keys] = process.argv.slice(2)
const dict = require(path.join(ROOT, `js/lang/${lang}.js`))[lang]
for (const k of keys) {
  const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), dict)
  console.log(`\n### ${k}\n${typeof v === 'function' ? v.toString() : JSON.stringify(v)}`)
}
