const { en } = require('./lang/en.js')
const { fr } = require('./lang/fr.js')
const { zh } = require('./lang/zh.js')
const { hi } = require('./lang/hi.js')
const { fa } = require('./lang/fa.js')

const translation = (key, language, ...args) => {
  const data = {
    en: { ...en },
    fr: { ...fr },
    zh: { ...zh },
    hi: { ...hi },
    fa: { ...fa },
  }
  const lang = language ? data[language] ? language : 'en' : 'en';
  // Helper function to resolve nested keys safely
  const getNestedValue = (obj, path) => {
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj)
  }

  let value = getNestedValue(data[lang], key)

  // If missing in current locale, fall back to English (and warn) BEFORE returning the literal key.
  if (value === undefined && lang !== 'en') {
    const fallback = getNestedValue(data.en, key)
    if (fallback !== undefined) {
      if (process.env.NODE_ENV !== 'production' || process.env.LANG_WARN === 'true') {
        console.warn(`[i18n] Missing key "${key}" in lang="${lang}" — fell back to en`)
      }
      value = fallback
    }
  }

  // Final guard: still missing — log loudly so prod gaps are visible, return the key string.
  if (value === undefined) {
    console.warn(`[i18n] Missing key "${key}" in ALL locales — returning raw key`)
    return key
  }

  // Normalize literal "\n" -> real newline. Many single-quoted lang strings were
  // authored with '\\n', which renders as a VISIBLE "\n" in Telegram (verified on
  // ~100 keys, e.g. Select Call Mode, Transaction History). Backtick strings that
  // already use real newlines are unaffected (they contain no literal backslash-n).
  // Only string values are touched; keyboards/objects pass through unchanged.
  const nlFix = (s) => (typeof s === 'string' ? s.replace(/\\n/g, '\n') : s)

  // If the value is a function, call it with the provided arguments
  if (typeof value === 'function') {
    return nlFix(value(...args))
  }

  return nlFix(value)
}

module.exports = {
  translation,
}
