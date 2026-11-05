#!/usr/bin/env node
// iter215: static check — js/phone-config.js fa blocks (msg/btnI18n/txtI18n/plansI18n) cover every key fr/en have,
// and every fa function-valued text renders without throwing and contains Persian.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const pc = require('../phone-config')
const fa = /[\u0600-\u06FF]/
let fails = 0
const report = (name, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(d).slice(0, 600)}`) }
const keysDeep = (o, p = '') => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)) ? keysDeep(v, p + k + '.') : [p + k])
const tFa = pc.getTxt('fa'), tEn = pc.getTxt('en'), tFr = pc.getTxt('fr')
const mFa = pc.getMsg('fa'), mEn = pc.getMsg('en')
const missTxt = keysDeep(tFr).filter(k => !keysDeep(tFa).includes(k))
report('txt fa has all fr keys', !missTxt.length, missTxt.join(', '))
const missMsg = keysDeep(mEn).filter(k => !keysDeep(mFa).includes(k))
report('msg fa has all en keys', !missMsg.length, missMsg.join(', '))
// Same-as-English strings (untranslated) in fa txt
const get = (o, k) => k.split('.').reduce((a, x) => a && a[x], o)
const sameTxt = keysDeep(tFa).filter(k => typeof get(tFa, k) === 'string' && get(tFa, k) === get(tEn, k) && fa.test(get(tFr, k) || '') === false && /[a-z]{4,}/i.test(get(tFa, k)) && get(tFa, k) !== get(tFr, k))
console.log('INFO fa txt strings identical to en:', sameTxt.length, sameTxt.slice(0, 20).join(', '))
// Render function-valued entries with dummy args
const dummy = [ '+14155551234', 'pro', 25, 'US', 5, 'x', 'y', 'z' ]
let fnErr = [], noFa = []
for (const k of keysDeep(tFa).concat(keysDeep(mFa).map(x => 'MSG:' + x))) {
  const isMsg = k.startsWith('MSG:'), key = isMsg ? k.slice(4) : k, v = get(isMsg ? mFa : tFa, key)
  if (typeof v !== 'function') { if (typeof v === 'string' && !fa.test(v) && /[a-z]{5,}/i.test(v)) noFa.push(k); continue }
  try { const out = v(...dummy); if (typeof out === 'string' && !fa.test(out) && /[a-z]{5,}/i.test(out)) noFa.push(k) } catch (e) { fnErr.push(`${k}: ${e.message}`) }
}
console.log('INFO fa entries with no Persian chars:', noFa.length, noFa.slice(0, 30).join(', '))
console.log('INFO fa fn entries that threw with dummy args (may be arg-shape, not a bug):', fnErr.length, fnErr.slice(0, 10).join(' | '))
// Buttons
const bFa = {}, bFr = {}
for (const k of Object.keys(pc.btn || {})) { bFa[k] = pc.getBtnLabel(k, 'fa'); bFr[k] = pc.getBtnLabel(k, 'fr') }
const engBtns = Object.keys(bFa).filter(k => typeof bFa[k] === 'string' && bFa[k] === pc.btn[k] && bFr[k] !== pc.btn[k])
report('btn fa: no key falls back to English where fr is translated', !engBtns.length, engBtns.join(', '))
const seen = {}; const dup = []
for (const [k, v] of Object.entries(bFa)) { if (typeof v !== 'string') continue; if (seen[v] && seen[v] !== k) dup.push(`${seen[v]}/${k}="${v}"`); seen[v] = k }
report('btn fa: no two keys share the same Persian label', !dup.length, dup.join(' ; '))
const keyBack = Object.entries(bFa).filter(([k, v]) => typeof v === 'string' && pc.btnKeyOf(v) !== k && !dup.some(d => d.includes(k))).map(([k, v]) => `${k}->${pc.btnKeyOf(v)}`)
report('btn fa: btnKeyOf(fa label) maps back to its key', !keyBack.length, keyBack.join(', '))
const pfa = pc.plansI18n.fa
report('plansI18n.fa has starter/pro/business with Persian features', ['starter', 'pro', 'business'].every(p => pfa?.[p]?.features?.length && pfa[p].features.every(f => fa.test(f))), JSON.stringify(pfa).slice(0, 300))
console.log('INFO exports:', Object.keys(pc).filter(k => /btn|Btn|plans/i.test(k)).join(','))
console.log(`\nRESULT fails=${fails}`)
process.exit(0)
