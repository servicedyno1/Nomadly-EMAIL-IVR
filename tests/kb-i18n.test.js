// Guards the central keyboard-button localization map (js/kb-i18n-buttons.js + js/kb-i18n.js).
// The canonicalizeIncoming() step rewrites a localized button press back to its English
// canonical before the literal `message === 'English'` handlers run. For that to be safe:
//   1. every PURE button must be fully translated for fr/zh/hi (no English leaks),
//   2. localized values must be UNIQUE per language (incl. the generic Back/Cancel/Main Menu),
//   3. a localized value must never equal a lang-dict value of a DIFFERENT English canonical
//      (otherwise canonicalize would hijack a legitimately trans()-driven button), and
//   4. each English key must actually be a hard-coded label present in js/_index.js.
const fs = require('fs')
const path = require('path')
const kb = require('../js/kb-i18n.js')
const BUTTONS = require('../js/kb-i18n-buttons.js')
const LANGS = ['fr', 'zh', 'hi']
const ROOT = path.resolve(__dirname, '..')
const indexSrc = fs.readFileSync(path.join(ROOT, 'js/_index.js'), 'utf8')

const dict = l => require(`../js/lang/${l}.js`)[l]
function leaves(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object') leaves(v, out)
  }
  return out
}
// en value → true, for the alias allowance (a localized value may equal a dict translation
// only when that dict key's ENGLISH form equals the button's own English canonical).
const enDict = dict('en')
function enFlat(obj, map = {}, prefix = '') {
  if (!obj || typeof obj !== 'object') return map
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') map[fk] = v
    else if (v && typeof v === 'object') enFlat(v, map, fk)
  }
  return map
}
function flat(obj, map = {}, prefix = '') {
  if (!obj || typeof obj !== 'object') return map
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') map[fk] = v
    else if (v && typeof v === 'object') flat(v, map, fk)
  }
  return map
}
const enMap = enFlat(enDict)

describe('kb-i18n button map', () => {
  const entries = Object.entries(BUTTONS)

  test('has buttons configured', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  test('every button is fully translated (no English leaks)', () => {
    for (const [en, tr] of entries) {
      for (const l of LANGS) {
        expect(typeof tr[l]).toBe('string')
        expect(tr[l].trim().length).toBeGreaterThan(0)
        expect(tr[l]).not.toBe(en) // must actually differ from English
      }
    }
  })

  test('localized values are unique per language (incl. generic Back/Cancel/Main Menu)', () => {
    const all = { ...kb.GENERIC, ...BUTTONS }
    for (const l of LANGS) {
      const seen = new Map()
      for (const [en, tr] of Object.entries(all)) {
        const v = tr[l]
        if (!v) continue
        if (seen.has(v)) {
          throw new Error(`Duplicate ${l} label "${v}" for "${en}" and "${seen.get(v)}"`)
        }
        seen.set(v, en)
      }
    }
  })

  test('no localized value collides with a different English key', () => {
    const keys = new Set(Object.keys(BUTTONS))
    for (const [en, tr] of entries) {
      for (const l of LANGS) {
        if (keys.has(tr[l]) && tr[l] !== en) {
          throw new Error(`${l} value "${tr[l]}" (for "${en}") equals another button's English key`)
        }
      }
    }
  })

  test('no localized value collides with a dict value of a different English canonical', () => {
    for (const l of LANGS) {
      const langMap = flat(dict(l))
      const byValue = new Map() // localized value -> set of keys
      for (const [k, v] of Object.entries(langMap)) {
        if (!byValue.has(v)) byValue.set(v, new Set())
        byValue.get(v).add(k)
      }
      for (const [en, tr] of entries) {
        const v = tr[l]
        const keys = byValue.get(v)
        if (!keys) continue
        // Allowed only if every colliding dict key's ENGLISH form equals this button's English.
        const bad = [...keys].filter(k => enMap[k] !== en)
        if (bad.length) {
          throw new Error(`${l} value "${v}" (for "${en}") collides with dict key(s) ${bad.join(', ')} of different English`)
        }
      }
    }
  })

  test('every English key is a hard-coded label present in js/_index.js', () => {
    for (const en of Object.keys(BUTTONS)) {
      expect(indexSrc.includes(en)).toBe(true)
    }
  })

  test('canonicalizeIncoming round-trips each localized value back to English', () => {
    for (const [en, tr] of entries) {
      for (const l of LANGS) {
        expect(kb.canonicalizeIncoming(tr[l], l)).toBe(en)
      }
    }
  })

  test('localizeReplyMarkup localizes a keyboard for a target language and leaves en untouched', () => {
    const [en, tr] = entries[0]
    const rm = { keyboard: [[en]], resize_keyboard: true }
    const outFr = kb.localizeReplyMarkup(rm, 'fr')
    expect(outFr.keyboard[0][0]).toBe(tr.fr)
    expect(rm.keyboard[0][0]).toBe(en) // original not mutated
    expect(kb.localizeReplyMarkup(rm, 'en')).toBe(rm) // en: no-op
  })
})
