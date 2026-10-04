'use strict'
/**
 * Phase 1 parity test — inbound IVR greetings now use the SAME smart-placeholder
 * engine as outbound (js/ivr-outbound.js) via js/ivr-templates.js.
 * Pure functions, no DB / network. Run: node /app/tests/ivr_parity.test.js
 */
const path = require('path')
const ivrTpl = require(path.join(__dirname, '..', '..', 'js', 'ivr-templates.js'))
const ivrOb = require(path.join(__dirname, '..', '..', 'js', 'ivr-outbound.js'))

let failures = 0
function assert(cond, msg) {
  if (cond) console.log('  ✅ PASS:', msg)
  else { console.log('  ❌ FAIL:', msg); failures++ }
}

// A template rich in placeholder types: Name/Bank/Amount (plain), CardLast4/CaseID (auto)
const tpl = ivrOb.getTemplateByKey('pay_notification')

console.log('\n[1] greetingPlaceholders extracts template placeholders')
const phs = ivrTpl.greetingPlaceholders(tpl.text)
assert(Array.isArray(phs) && phs.includes('CardLast4') && phs.includes('CaseID') && phs.includes('Bank'),
  `found placeholders: ${phs.join(', ')}`)

console.log('\n[2] autoFillSmartPlaceholders generates AUTO ones only')
const auto = ivrTpl.autoFillSmartPlaceholders(tpl.text)
assert(/^\d{4}$/.test(auto.CardLast4 || ''), `CardLast4 auto-generated (=${auto.CardLast4})`)
assert(/^CASE-\d{6}$/.test(auto.CaseID || ''), `CaseID auto-generated (=${auto.CaseID})`)
assert(!('Bank' in auto) && !('Name' in auto), 'plain placeholders (Bank/Name) NOT auto-filled')

console.log('\n[3] describePlaceholder returns smart metadata (parity with outbound wizard)')
assert(ivrTpl.describePlaceholder('CardLast4').type === 'auto', 'CardLast4 → type auto')
const reason = ivrTpl.describePlaceholder('Reason')
assert(reason.type === 'list' && Array.isArray(reason.presets) && reason.presets.length > 0, 'Reason → type list with presets')
assert(ivrTpl.describePlaceholder('Location').type === 'input', 'Location → type input')
assert(ivrTpl.describePlaceholder('CallBack').type === 'number', 'CallBack → type number')
assert(ivrTpl.describePlaceholder('Bank').smart === false, 'Bank → plain (not smart)')

console.log('\n[4] buildInboundIvrFromTemplate fills greeting via shared engine')
const partial = ivrTpl.buildInboundIvrFromTemplate(tpl, { placeholderValues: { Bank: 'Chase', ...auto } })
assert(partial.greeting.includes('Chase'), 'Bank value substituted into greeting')
assert(!partial.greeting.includes('[Bank]') && !partial.greeting.includes('[CardLast4]'), 'no raw [Bank]/[CardLast4] left for filled values')
assert(partial.greeting.includes('[Name]') || partial.greeting.includes('[Amount]'), 'unfilled placeholders preserved verbatim (Name/Amount)')
assert(partial.voiceKey === undefined || typeof partial.voiceKey === 'string', 'voiceKey optional')

console.log('\n[5] validateInboundReady — guard blocks unfilled greeting / missing forward number')
const v1 = ivrTpl.validateInboundReady(partial)
assert(v1.ok === false && v1.unfilledPlaceholders.length > 0, `blocks unfilled greeting (unfilled: ${v1.unfilledPlaceholders.join(',')})`)

// Fully fill + set forward destination → should pass
const full = ivrTpl.buildInboundIvrFromTemplate(tpl, {
  placeholderValues: { Name: 'John', Bank: 'Chase', Amount: '250', ...auto },
  voiceKey: 'rachel', ttsSpeed: 1.0,
})
full.options['1'].forwardTo = '+18005551234'
const v2 = ivrTpl.validateInboundReady(full)
assert(v2.ok === true, `passes when greeting filled + forward set (ok=${v2.ok})`)
assert(full.voiceKey === 'rachel' && full.ttsSpeed === 1.0, 'premium voice + speed carried on config')

// Missing forward destination → pendingForwardKeys should flag it
const full2 = ivrTpl.buildInboundIvrFromTemplate(tpl, { placeholderValues: { Name: 'John', Bank: 'Chase', Amount: '250', ...auto } })
const v3 = ivrTpl.validateInboundReady(full2)
assert(v3.ok === false && v3.pendingForwardKeys.includes('1'), `flags missing forward destination (pending: ${v3.pendingForwardKeys.join(',')})`)

console.log(failures === 0 ? '\n🎉 ALL TESTS PASSED' : `\n💥 ${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
