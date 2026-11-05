// iter211 — dial-check.dialIssue + contacts-import.normalizeNumber/parseLeads typo handling.  node js/tests/dial_check_iter211.js
const { dialIssue } = require('../dial-check')
const ci = require('../contacts-import')
let pass = 0, fail = 0
const t = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${detail}`) }
const has = (n, frag) => { const m = dialIssue(n); t(`${n} → "${frag}"`, !!m && m.includes(frag), `got: ${m}`) }

has('+1707220640', 'is missing a digit')
has('+170722064100', 'has an extra digit')
has('+11234567890', 'not a valid USA/Canada number')
has('+17070206410', '') // exchange 0xx → invalid
has('+7072206410', 'looks like a USA number missing the 1. Did you mean +17072206410?')
has('', 'not a phone number')
t('+44791112345 (UK 10-digit, possible length) accepted per isPossible', dialIssue('+44791112345') === null)
has('+4479111234567', 'not a complete number')     // UK extra digit
has('+12025550100x', 'not a phone number')
for (const ok of ['+17072206410', '+18002805175', '+447911123456', '+77072206410', '+14155550100', '+33612345678', '+919876543210', '+5511987654321', '+61412345678', '+16135550123'])
  t(`${ok} valid`, dialIssue(ok) === null, `got: ${dialIssue(ok)}`)

// normalizeNumber
t('normalize 7072206410 → +17072206410', ci.normalizeNumber('7072206410') === '+17072206410', ci.normalizeNumber('7072206410'))
t('normalize (707) 220-6410 → +17072206410', ci.normalizeNumber('(707) 220-6410') === '+17072206410')
t('normalize 17072206410 → +17072206410', ci.normalizeNumber('17072206410') === '+17072206410')
t('normalize +7072206410 → null', ci.normalizeNumber('+7072206410') === null, String(ci.normalizeNumber('+7072206410')))
t('normalize +1707220640 → null', ci.normalizeNumber('+1707220640') === null)
t('normalize 707220640 (9 digits) → null', ci.normalizeNumber('707220640') === null, String(ci.normalizeNumber('707220640')))
t('normalize +447911123456 kept', ci.normalizeNumber('+447911123456') === '+447911123456')

// parseLeads with mixed
const r = ci.parseLeads('+17072206410,Ann\n+7072206410,Bob\n+1707220640,Cy\n+18002805175,Di\n+447911123456', 'x.txt')
t('parseLeads keeps 3 valid', r.leads.length === 3 && r.leads.map(l => l.number).join() === '+17072206410,+18002805175,+447911123456', JSON.stringify(r.leads))
t('parseLeads reports 2 errors', r.errors.length === 2, JSON.stringify(r.errors))
// CSV with header
const r2 = ci.parseLeads('Name,Phone\nAnn,+17072206410\nBob,+7072206410\nCy,800-280-5175', 'x.csv')
t('csv header: 2 valid, 1 error', r2.leads.length === 2 && r2.errors.length === 1, JSON.stringify(r2))
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
