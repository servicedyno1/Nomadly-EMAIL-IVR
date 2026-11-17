'use strict'
// Stop-call promise detection + removal (ivr-blueprint stopClauses / stripStopPromise / outbound check).
const BP = require('../cloudivr-web/ivr-blueprint')
const menu = [{ digit: '1', action: 'forward', forwardTo: '+14155550100' }, { digit: '2', action: 'message', message: 'Nine to five.' }]
let fail = 0
const ok = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${cond ? '' : extra}`) }
const strip = [
  ['Hello, this is [Business name]. We have a weekend sale! Press 1 to talk to sales, or press 2 to hear our opening hours. Press 9 to stop these calls.', 'Hello, this is [Business name]. We have a weekend sale! Press 1 to talk to sales, or press 2 to hear our opening hours.'],
  ['Hi from Acme. Press 1 for sales, press 2 for hours, or press 9 to be removed from our list.', 'Hi from Acme. Press 1 for sales, press 2 for hours.'],
  ['Hi. To speak with sales press 1. For our hours press 2. If you no longer wish to receive these calls, press 9.', 'Hi. To speak with sales press 1. For our hours press 2.'],
  ['Hi. Press 1 for sales. Press 2 for hours. To opt out of future calls, press nine now.', 'Hi. Press 1 for sales. Press 2 for hours.'],
  ['Hi. Press 1 for sales, 2 for hours, and 9 to unsubscribe.', 'Hi. Press 1 for sales, 2 for hours.'],
  ['Hi. Press 1 for sales or 2 for hours. Press 9 and we will not call you again.', 'Hi. Press 1 for sales or 2 for hours.'],
  ['Hi. Press 1 for sales, press 2 for hours. Do not want these calls? Press 9.', 'Hi. Press 1 for sales, press 2 for hours.'],
  ['Hi. Press 9 to stop these calls, or press 1 for sales, or press 2 for hours.', 'Hi. Press 1 for sales, or press 2 for hours.'],
  ['Hi. Press 1 for sales. To stop receiving these calls, press 9, at any time. Press 2 for hours.', 'Hi. Press 1 for sales. Press 2 for hours.'],
  ['Hi. Press 1 for sales, press 2 for hours — press 9 to opt out.', 'Hi. Press 1 for sales, press 2 for hours.'],
]
for (const [src, want] of strip) {
  const got = BP.stripStopPromise(src)
  const errs = BP.outbound('campaign', { script: got, mode: 'menu', menu }, {}).validation.issues.filter(i => i.level === 'error')
  ok(`strip: ${src.slice(-45)}`, got === want && !errs.length, `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)} errs=${JSON.stringify(errs)}`)
  const before = BP.outbound('campaign', { script: src, mode: 'menu', menu }, {}).validation.issues.filter(i => i.level === 'error' && /key 9 stops/.test(i.message))
  ok(`check flags key 9: ${src.slice(-45)}`, before.length === 1, JSON.stringify(BP.outbound('campaign', { script: src, mode: 'menu', menu }, {}).validation.issues))
}
const keep = [
  'Hi. Press 1 to stop by our store info, press 2 for hours.',
  'Hi from Acme. Our sale costs $9.99 today. Press 1 if you do not want to miss it, or press 2 for hours.',
  'Hello. Press 1 to talk to sales and to hear offers. Press 2 for our hours: nine to five every day',
  'We will stop the sale on Sunday. Press 1 for sales.',
]
for (const src of keep) {
  ok(`keep: ${src.slice(0, 50)}`, BP.stripStopPromise(src) === src, JSON.stringify(BP.stripStopPromise(src)))
  ok(`no false promise: ${src.slice(0, 50)}`, !BP.stopClauses(src).hits.length)
}
const tr = (script, stopKey) => BP.outbound('campaign', { script, mode: 'transfer', transferNumber: '+14155550100', activeKeys: ['1'], stopKey }, {}).validation.issues
ok('stop key set + promised → no error, no "never tells" warning', !tr('Hi. Press 1 for sales. To stop receiving these calls, press 9.', '9').some(i => i.level === 'error' || /never tells/.test(i.message)))
ok('promise differs from stop key → error', tr('Hi. Press 1 for sales. Press 8 to stop these calls.', '9').some(i => i.level === 'error' && /stop-calls key is 9/.test(i.message)))
ok('stop key set, not said → warning', tr('Hi. Press 1 for sales.', '9').some(i => /never tells/.test(i.message)))
ok('promise without stop key → error', tr('Hi. Press 1 for sales. Press 9 and we will not call you again.', '').some(i => i.level === 'error' && /key 9 stops/.test(i.message)))
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
