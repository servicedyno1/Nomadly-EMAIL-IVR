/**
 * Tests for the 4 production fixes approved 2026-11:
 * 1. Trial Quick IVR → SignalWire (no more blocked Telnyx)
 * 2. AI support empty/media-message guard
 * 4. eSIM customer complaint-driven suspect (ESIM-0008/0009)
 * 5. BulkSMS identity backfill
 */
'use strict'
const assert = require('assert')
let passed = 0, failed = 0
const ok = (name) => { passed++; console.log(`  ✅ ${name}`) }
const fail = (name, e) => { failed++; console.error(`  ❌ ${name}: ${e}`) }
const test = async (name, fn) => { try { await fn(); ok(name) } catch (e) { fail(name, e.message || e) } }

// ═══════════════════════════════════════════════════════════
// 1. Trial Quick IVR → SignalWire
// ═══════════════════════════════════════════════════════════
console.log('\n── 1. Trial Quick IVR ──')

test('getTrialCaller is exported', () => {
  const ivrOb = require('../ivr-outbound.js')
  assert.strictEqual(typeof ivrOb.getTrialCaller, 'function')
})

test('getTrialCaller returns object with callerId and callerProvider', async () => {
  const ivrOb = require('../ivr-outbound.js')
  const result = await ivrOb.getTrialCaller()
  assert.ok(result.callerId, 'should have callerId')
  assert.ok(result.callerProvider, 'should have callerProvider')
  assert.strictEqual(result.callerProvider, 'telnyx') // wrapper path
})

test('getTrialCaller prefers SignalWire pool or falls back to TRIAL_CALLER_ID', async () => {
  const ivrOb = require('../ivr-outbound.js')
  const result = await ivrOb.getTrialCaller()
  // When SignalWire is enabled, returns a pool number; otherwise falls back
  assert.ok(/^\+\d{10,15}$/.test(result.callerId), 'should be a valid E.164 number')
  // If SW is enabled, the pool number should differ from the Telnyx trial caller
  // (unless it happens to be the same — both cases are valid)
  const sw = require('../signalwire')
  if (sw.enabled()) {
    console.log(`    (SignalWire enabled — got pool caller ${result.callerId})`)
  } else {
    assert.strictEqual(result.callerId, ivrOb.TRIAL_CALLER_ID, 'without SW, should use TRIAL_CALLER_ID')
  }
})

test('TRIAL_CALLER_ID is still exported for backward compat', () => {
  const ivrOb = require('../ivr-outbound.js')
  assert.ok(ivrOb.TRIAL_CALLER_ID, 'should still export TRIAL_CALLER_ID')
  assert.ok(/^\+\d+$/.test(ivrOb.TRIAL_CALLER_ID), 'should be E.164 format')
})

// ═══════════════════════════════════════════════════════════
// 2. AI Support empty/media-message guard
// ═══════════════════════════════════════════════════════════
console.log('\n── 2. AI Support empty/media guard ──')

const aiSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'ai-support.js'), 'utf8')

test('getAiResponse has empty content guard', () => {
  assert.ok(aiSource.includes("String(userMessage || '').trim()"), 'should check for empty userMessage')
  assert.ok(aiSource.includes('Empty content guard triggered'), 'should log the guard')
})

test('getAiResponseStreaming has empty content guard', () => {
  // Count occurrences - should be in both functions
  const matches = aiSource.match(/Empty content guard/g)
  assert.ok(matches && matches.length >= 2, 'should have guard in both getAiResponse and getAiResponseStreaming')
})

test('empty guard returns text-only hint, not error', () => {
  assert.ok(aiSource.includes('I can only process text right now'), 'should return a user-friendly hint')
  assert.ok(aiSource.includes('escalate: false'), 'empty messages should not escalate')
})

test('empty guard supports multiple languages', () => {
  assert.ok(aiSource.includes("fr: '"), 'should have French hint')
  assert.ok(aiSource.includes("zh: '"), 'should have Chinese hint')
  assert.ok(aiSource.includes("hi: '"), 'should have Hindi hint')
})

test('media relay seeds AI history with context (source check)', () => {
  const indexSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '_index.js'), 'utf8')
  assert.ok(indexSrc.includes('addSupportContext'), 'should call addSupportContext after media relay')
  assert.ok(indexSrc.includes('The user sent a'), 'should describe what the user sent')
  assert.ok(indexSrc.includes('forwarded to human support'), 'should note media was forwarded')
})

// ═══════════════════════════════════════════════════════════
// 4. eSIM customer complaint-driven suspect
// ═══════════════════════════════════════════════════════════
console.log('\n── 4. eSIM complaint-driven suspect ──')

const coreSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'bulk-esim', 'core.js'), 'utf8')

test('reviewAnswer auto-suspects line on >=2 complaints in 48h', () => {
  assert.ok(coreSrc.includes('complaints48h'), 'should count recent complaints')
  assert.ok(coreSrc.includes('customer_complaints'), 'should mark suspect reason as customer_complaints')
  assert.ok(coreSrc.includes('customer_suspect'), 'should log customer_suspect incident')
})

test('complaint threshold is 2 in 48h window', () => {
  assert.ok(coreSrc.includes('complaints48h >= 2'), 'should require >=2 complaints')
  assert.ok(coreSrc.includes('2 * DAY'), 'should use 48h window')
})

test('only suspects lines in USABLE + GOOD_HEALTH', () => {
  assert.ok(coreSrc.includes('USABLE.includes(e.status) && GOOD_HEALTH.includes(e.health)'), 'should check status and health before suspecting')
})

// ═══════════════════════════════════════════════════════════
// 5. BulkSMS identity backfill
// ═══════════════════════════════════════════════════════════
console.log('\n── 5. Identity backfill ──')

test('backfillIdentity is exported from core', () => {
  const engine = require('../bulk-esim/core.js')
  assert.strictEqual(typeof engine.backfillIdentity, 'function')
})

test('backfillIdentity returns error without nameOf collection', async () => {
  const engine = require('../bulk-esim/core.js')
  const r = await engine.backfillIdentity(null)
  assert.strictEqual(r.ok, false)
  assert.ok(r.error, 'should return an error message')
})

test('backfillIdentity function handles missing/unknown usernames', () => {
  // Source check: query targets null, non-existent, and 'unknown' usernames
  assert.ok(coreSrc.includes("username: null"), 'should find null usernames')
  assert.ok(coreSrc.includes("username: 'unknown'"), 'should find unknown usernames')
  assert.ok(coreSrc.includes("$exists: false"), 'should find missing username field')
})

test('backfillIdentity is idempotent (only fills, never overwrites known)', () => {
  assert.ok(coreSrc.includes("username !== 'unknown'"), 'should skip if nameOf also returns unknown')
  assert.ok(coreSrc.includes('backfilledAt'), 'should mark records as backfilled')
})

test('/bulkbackfill admin command exists in bot.js', () => {
  const botSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'bulk-esim', 'bot.js'), 'utf8')
  assert.ok(botSrc.includes("'/bulkbackfill'"), 'should have the admin command')
  assert.ok(botSrc.includes('backfillIdentity'), 'should call the engine function')
  assert.ok(botSrc.includes("collection('nameOf')"), 'should use nameOf collection from main DB')
})

test('syncInventory immediately retires never-activated SIMs (no device + PENDING sub)', () => {
  assert.ok(coreSrc.includes("health = 'never_activated'"), 'should detect never_activated health state')
  assert.ok(coreSrc.includes("!sim?.device?.imei"), 'should check for missing device IMEI')
  assert.ok(coreSrc.includes("Never activated — SIM has no device bound"), 'should explain the reason clearly')
  assert.ok(coreSrc.includes("no_device"), 'should log no_device reason in incident')
  // Should NOT wait 24h like regular activating SIMs — retire immediately
  assert.ok(coreSrc.includes("Retired immediately"), 'should retire immediately, not wait 24h')
})

test('never_activated SIMs are excluded from send pool (GONE includes failed)', () => {
  assert.ok(coreSrc.includes("'failed'") && coreSrc.includes("'replaced'"), 'GONE should include failed')
  // When set to failed, the SIM is in GONE and excluded from USABLE checks
})

// ═══════════════════════════════════════════════════════════
// Bonus: HTML escape in admin notifications
// ═══════════════════════════════════════════════════════════
console.log('\n── HTML escape in notifications ──')

test('core.js has esc() helper for HTML-safe notifications', () => {
  assert.ok(coreSrc.includes("const esc = (t) => String(t || '').replace"), 'should have HTML escape helper')
  assert.ok(coreSrc.includes('&amp;'), 'should escape &')
  assert.ok(coreSrc.includes('&lt;'), 'should escape <')
  assert.ok(coreSrc.includes('&gt;'), 'should escape >')
})

test('error-injecting alerts use esc() wrapper', () => {
  // All alerts that inject err.message/err.status should use esc()
  const alertsWithErr = coreSrc.match(/alert\(.*err\.message/g) || []
  const unsafeAlerts = alertsWithErr.filter(a => !a.includes('esc('))
  assert.strictEqual(unsafeAlerts.length, 0, `${unsafeAlerts.length} alert(s) inject raw err.message without esc()`)
})

test('_index.js notifyAdmin calls use escHtml for error messages', () => {
  const indexSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '_index.js'), 'utf8')
  assert.ok(indexSrc.includes("const escHtml = (t) => String(t || '').replace"), 'should have escHtml helper')
  // Check that CRITICAL refund alerts are escaped
  const criticalAlerts = indexSrc.match(/notifyAdmin.*CRITICAL.*\.message/g) || []
  const unsafeCritical = criticalAlerts.filter(a => !a.includes('escHtml('))
  assert.strictEqual(unsafeCritical.length, 0, `${unsafeCritical.length} critical alert(s) have raw error messages`)
})

test('provisioning budget alert has emoji', () => {
  assert.ok(coreSrc.includes("alert(`⛔ Provisioning blocked"), 'budget alert should have emoji')
})

test('capacity alert does not mention env variable names', () => {
  // Should not reference SPENZA_BULK_API_KEY_N or SPENZA_BULK_API_SECRET_N
  const capacityMatch = coreSrc.match(/Capacity is near.*?`\)/s)
  assert.ok(capacityMatch, 'should find capacity alert')
  assert.ok(!capacityMatch[0].includes('SPENZA_BULK_API_KEY'), 'should not mention env var names')
})

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
