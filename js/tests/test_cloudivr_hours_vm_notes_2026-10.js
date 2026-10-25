// Unit test: CloudIVR web — on/off hours, voicemail greeting languages, call-note matching, plan feature matrix.
// Run: node js/tests/test_cloudivr_hours_vm_notes_2026-10.js
const assert = require('assert')
const hours = require('../number-hours')
const vm = require('../voicemail-greeting')
const notes = require('../cloudivr-web/notes')

let pass = 0
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ✓ ${name}`) }).catch(e => { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 })

const week = (start = '09:00', end = '17:00') => Object.fromEntries(hours.DAYS.map(d => [d, { on: true, start, end }]))
const base = { enabled: true, timezone: 'America/New_York', days: week(), offAction: 'voicemail', offMessage: '' }

;(async () => {
  console.log('number-hours')
  // 2026-10-23 is a Friday; New York is UTC-4 (EDT).
  await t('open inside hours (Fri 10:00 NY)', () => assert.strictEqual(hours.isOpen(hours.validateHours(base), new Date('2026-10-23T14:00:00Z')), true))
  await t('closed after hours (Fri 19:00 NY)', () => assert.strictEqual(hours.isOpen(hours.validateHours(base), new Date('2026-10-23T23:00:00Z')), false))
  await t('end time is exclusive (Fri 17:00 NY closed)', () => assert.strictEqual(hours.isOpen(hours.validateHours(base), new Date('2026-10-23T21:00:00Z')), false))
  await t('schedule off = always open', () => assert.strictEqual(hours.isOpen({ ...base, enabled: false }, new Date('2026-10-23T23:00:00Z')), true))
  await t('day switched off = closed all day', () => {
    const h = hours.validateHours({ ...base, days: { ...week(), fri: { on: false, start: '09:00', end: '17:00' } } })
    assert.strictEqual(hours.isOpen(h, new Date('2026-10-23T14:00:00Z')), false)
  })
  const night = hours.validateHours({ ...base, days: { ...week(), fri: { on: true, start: '22:00', end: '06:00' }, sat: { on: false, start: '09:00', end: '17:00' } } })
  await t('overnight window open late Friday (23:00 NY)', () => assert.strictEqual(hours.isOpen(night, new Date('2026-10-24T03:00:00Z')), true))
  await t('overnight window spills into Saturday (03:00 NY)', () => assert.strictEqual(hours.isOpen(night, new Date('2026-10-24T07:00:00Z')), true))
  await t('overnight window closed after 06:00 Saturday', () => assert.strictEqual(hours.isOpen(night, new Date('2026-10-24T11:00:00Z')), false))
  await t('other time zone (Asia/Tokyo 10:00 open)', () => assert.strictEqual(hours.isOpen(hours.validateHours({ ...base, timezone: 'Asia/Tokyo' }), new Date('2026-10-23T01:00:00Z')), true))
  await t('bad time zone rejected', () => assert.throws(() => hours.validateHours({ ...base, timezone: 'Mars/Base' }), /time zone/))
  await t('bad time rejected', () => assert.throws(() => hours.validateHours({ ...base, days: { mon: { on: true, start: '25:00', end: '10:00' } } }), /24-hour/))
  await t('enabled with no days rejected', () => assert.throws(() => hours.validateHours({ ...base, days: {} }), /at least one day/))
  await t('unknown off action falls back to voicemail', () => assert.strictEqual(hours.validateHours({ ...base, offAction: 'x' }).offAction, 'voicemail'))
  await t('off message trimmed to 500 chars', () => assert.strictEqual(hours.validateHours({ ...base, offMessage: 'a'.repeat(900) }).offMessage.length, 500))

  console.log('voicemail-greeting')
  await t('5 languages', () => assert.deepStrictEqual(vm.LANG_CODES, ['en', 'fr', 'es', 'pt', 'ar']))
  await t('Telnyx language codes', () => assert.deepStrictEqual(vm.LANG_CODES.map(c => vm.LANGS[c].tts), ['en-US', 'fr-FR', 'es-US', 'pt-BR', 'arb']))
  await t('number read digit by digit', () => assert.strictEqual(vm.spokenNumber('+15156442785'), '1, 5 1 5, 6 4 4, 2 7 8 5'))
  await t('French greeting text + code', () => {
    const g = vm.standardGreeting('fr', '+15156442785')
    assert.strictEqual(g.language, 'fr-FR'); assert.match(g.text, /n'est pas disponible/); assert.match(g.text, /5 1 5/)
  })
  await t('unknown language falls back to English', () => assert.strictEqual(vm.standardGreeting('xx', '+1').language, 'en-US'))
  await t('closed message: custom text wins', () => assert.strictEqual(vm.closedMessage('pt', 'Fechado', false).text, 'Fechado'))
  await t('closed message: voicemail variant', () => assert.match(vm.closedMessage('ar', '', true).text, /رسالة/))

  console.log('call notes matching')
  const fakeDb = (list) => ({ collection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => list }) }) }) }) })
  const logs = [
    { id: 'L1', from: '+14155550100', to: '+15156442785', timestamp: '2026-10-23T14:00:00Z' },
    { id: 'L2', from: '+15156442785', to: '+14155550199', timestamp: '2026-10-23T15:00:00Z' },
    { id: 'L3', from: '+14155550100', to: '+15156442785', timestamp: '2026-10-23T18:00:00Z' },
  ]
  await t('note by log id', async () => {
    const out = await notes.attachNotes(fakeDb([{ _id: 'n1', logId: 'L3', text: 'x', callAt: new Date('2026-10-01') }]), 'c', '+15156442785', logs)
    assert.strictEqual(out[2].note.id, 'n1'); assert.ok(!out[0].note)
  })
  await t('browser-phone note matched by other party within 15 min', async () => {
    const out = await notes.attachNotes(fakeDb([{ _id: 'n2', peer: '+14155550199', text: 'y', callAt: new Date('2026-10-23T15:05:00Z') }]), 'c', '+15156442785', logs)
    assert.strictEqual(out[1].note.id, 'n2')
  })
  await t('no match outside the window', async () => {
    const out = await notes.attachNotes(fakeDb([{ _id: 'n3', peer: '+14155550199', text: 'z', callAt: new Date('2026-10-23T16:00:00Z') }]), 'c', '+15156442785', logs)
    assert.ok(out.every(l => !l.note))
  })
  await t('one note attaches to one row only', async () => {
    const out = await notes.attachNotes(fakeDb([{ _id: 'n4', peer: '+14155550100', text: 'w', callAt: new Date('2026-10-23T14:02:00Z') }]), 'c', '+15156442785', [logs[0], { ...logs[0], id: 'L1b' }])
    assert.strictEqual(out.filter(l => l.note).length, 1)
  })

  console.log('plan feature matrix')
  const numbers = require('../cloudivr-web/numbers')
  const c = numbers.catalog()
  const inc = (id) => c.plans.find(p => p.id === id).webFeatures.filter(f => f.included).map(f => f.key)
  await t('Pro is the recommended plan', () => { assert.strictEqual(c.recommendedPlan, 'pro'); assert.strictEqual(c.plans.filter(p => p.recommended).map(p => p.id).join(), 'pro') })
  await t('Starter: no browser phone / voicemail / IVR', () => { const s = inc('starter'); assert.ok(!s.includes('browserPhone') && !s.includes('voicemail') && !s.includes('ivr')); assert.ok(s.includes('forwarding') && s.includes('hours') && s.includes('notes')) })
  await t('Pro: browser phone, voicemail, call me first, bulk, recording; no IVR', () => { const s = inc('pro'); assert.ok(['browserPhone', 'voicemail', 'callMeFirst', 'bulk', 'recording'].every(k => s.includes(k))); assert.ok(!s.includes('ivr')) })
  await t('Business: everything', () => assert.strictEqual(inc('business').length, numbers.WEB_FEATURES.length))
  await t('no Telegram-only items in the web list', () => assert.ok(!numbers.WEB_FEATURES.some(([, label]) => /redial|preset|extra numbers|otp|telegram/i.test(label))))
  await t('voicemail languages in catalog', () => assert.deepStrictEqual(c.voicemailLanguages.map(l => l.code), ['en', 'fr', 'es', 'pt', 'ar']))

  console.log(`\n${pass} passed${process.exitCode ? ', some FAILED' : ''}`)
})()
