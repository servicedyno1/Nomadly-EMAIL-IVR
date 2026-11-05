/**
 * P12 (2026-06-21): Tiny i18n loader.
 *
 * Goal: stop inlining `{ en: '...', fr: '...', zh: '...', hi: '...' }[lang]`
 * 122 times across `_index.js`.  Translators can now edit a single JSON file.
 *
 * Usage:
 *   const i18n = require('./i18n')
 *   const t = i18n.for(userLang)        // userLang ∈ {'en','fr','zh','hi'}
 *   t('main_menu.welcome')              // returns localised string
 *   t('main_menu.welcome', { name: 'Alice' })  // {name} placeholder
 *
 * Source files: js/i18n/<lang>.json — flat key/value, dot-paths nested.
 * Missing keys fall back to en; missing keys in en log a warning and return
 * the key itself so it shows up in QA.
 */
const path = require('path')

const SUPPORTED = ['en', 'fr', 'zh', 'hi', 'fa']
const FALLBACK = 'en'
const _tables = {}

function load(lang) {
  if (_tables[lang]) return _tables[lang]
  try {
    _tables[lang] = require(path.join(__dirname, 'i18n', `${lang}.json`))
  } catch (err) {
    _tables[lang] = {}
    console.warn(`[i18n] failed to load ${lang}: ${err.message}`)
  }
  return _tables[lang]
}

function _get(table, key) {
  return key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), table)
}

function _interp(s, params) {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}

function forLang(lang) {
  const l = SUPPORTED.includes(lang) ? lang : FALLBACK
  const primary = load(l)
  const fallback = l === FALLBACK ? primary : load(FALLBACK)
  return function t(key, params) {
    let v = _get(primary, key)
    if (v == null) v = _get(fallback, key)
    if (v == null) {
      console.warn(`[i18n] missing key: ${key}`)
      return key
    }
    return typeof v === 'string' ? _interp(v, params) : v
  }
}

module.exports = { for: forLang, SUPPORTED, FALLBACK }
