/**
 * Every function-valued translation key must render without a ReferenceError in every locale.
 * hi.js / zh.js had machine-"translated" code inside templates (`${phoneConfig.plans.starter.मिनट}`,
 * `${sp.hint}`, `${sufficient ? …}`) that threw at runtime, so Hindi/Chinese users never saw the
 * phone "Choose a Plan" screen, IVR template prompts, VPS expiry notices, … (2026-10-01).
 */
const langs = {
  en: require('../js/lang/en.js').en,
  fr: require('../js/lang/fr.js').fr,
  zh: require('../js/lang/zh.js').zh,
  hi: require('../js/lang/hi.js').hi,
}
const dummyArgs = Array.from({ length: 16 }, (_, i) => (i % 2 ? 7 : 'x'))

function collect(obj, path, out) {
  for (const [k, v] of Object.entries(obj || {})) {
    const p = path ? `${path}.${k}` : k
    if (typeof v === 'function') out.push([p, v])
    else if (v && typeof v === 'object' && !Array.isArray(v) && p.split('.').length < 3) collect(v, p, out)
  }
  return out
}

describe('locale template functions render without ReferenceError', () => {
  test.each(Object.keys(langs))('%s', (lang) => {
    const broken = []
    for (const [key, fn] of collect(langs[lang], '', [])) {
      try { fn(...dummyArgs) } catch (e) { if (e instanceof ReferenceError) broken.push(`${key}: ${e.message}`) }
    }
    expect(broken).toEqual([])
  })

  test('hi/zh plan list (t.cp_8) interpolates the minutes arguments like en', () => {
    const args = ['H', 50, 100, 50, 3, 75, 500, 100, 6, 120, 'Unlimited', 300, 10]
    for (const lang of ['hi', 'zh']) {
      const out = langs[lang].t.cp_8(...args)
      expect(out).toContain('100 min')
      expect(out).toContain('500 min')
      expect(out).toContain('Unlimited')
    }
  })
})
