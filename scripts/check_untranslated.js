#!/usr/bin/env node
// Finds fr/hi/zh leaf values that are identical to en (likely untranslated).
// Exit code 1 when any user-facing leak remains (CI lint). `--verbose` / `--fr` list keys.
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '..')
const TARGETS = ['fr', 'hi', 'zh']
const { isSkipped } = require('./i18n_fill/skip.js')

function leaves(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[fk] = v
    else if (typeof v === 'function') out[fk] = v.toString()
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, fk, out)
    else if (Array.isArray(v)) out[fk] = JSON.stringify(v)
  }
  return out
}

// Skip values that are legitimately language-neutral.
const NEUTRAL = /^[\s\d\W_]*$|^[A-Z0-9_\-./:@]+$|^https?:\/\//i
const hasLatinWords = (s) => /[a-zA-Z]{3,}/.test(s)
// Hosting-panel keys that are brand/technical and identical by design.
const PANEL_NEUTRAL = new Set([
  'dashboard.tabs.geo', 'sec.layers.htaccessCloaking.label', 'sec.layers.cfWorker.label', 'dl.bulkPlaceholder',
  'dl.sslCf', 'dl.sslValidCfTip', 'dl.sslValidNoDaysTip', 'dl.cfSslLabel', 'store.pin', 'languageNames.fr',
])

function report(label, loadFn, skipFn) {
  const en = leaves(loadFn('en'))
  const summary = {}
  for (const lang of TARGETS) {
    const tgt = leaves(loadFn(lang))
    const same = []
    for (const [k, v] of Object.entries(en)) {
      if (!(k in tgt)) continue
      if (tgt[k] !== v) continue
      if (NEUTRAL.test(v)) continue
      if (!hasLatinWords(v)) continue
      if (skipFn && skipFn(k, lang)) continue
      same.push(k)
    }
    summary[lang] = same
  }
  console.log(`\n=== ${label} ===`)
  for (const lang of TARGETS) {
    console.log(`${lang}: ${summary[lang].length} identical-to-en values`)
    if (process.argv.includes('--verbose') || process.argv.includes(`--${lang}`)) {
      for (const k of summary[lang]) {
        const v = en[k].replace(/\n/g, '\\n')
        console.log(`  ${k} = ${v.slice(0, 110)}${v.length > 110 ? '…' : ''}`)
      }
    }
  }
  return summary
}

const botLang = (l) => { const fp = path.join(ROOT, 'js/lang', `${l}.js`); return require(fp)[l] }
const botI18n = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'js/i18n', `${l}.json`), 'utf8'))
const panel = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/src/locales', `${l}.json`), 'utf8'))

const r1 = report('Telegram bot js/lang', botLang, isSkipped)
const r2 = report('Bot i18n js/i18n', botI18n)
const r3 = report('Hosting panel frontend/src/locales', panel, k => PANEL_NEUTRAL.has(k))

if (process.argv.includes('--json')) {
  fs.writeFileSync('/tmp/untranslated.json', JSON.stringify({ lang: r1, i18n: r2, panel: r3 }, null, 2))
}
const total = [r1, r2, r3].reduce((n, r) => n + Object.values(r).reduce((m, a) => m + a.length, 0), 0)
if (total) { console.log(`\n${total} untranslated value(s) remain`); process.exit(1) }
console.log('\nAll user-facing strings translated ✓')
