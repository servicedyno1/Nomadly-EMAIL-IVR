'use strict'
// Tests for cid-guard: blocklist, emergency, AI classification, and Business-plan caller ID resolution
const assert = require('assert')
let passed = 0, failed = 0
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`) } }
const testAsync = async (name, fn) => { try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`) } }

console.log('\n── CID Guard Tests ──\n')

const cidGuard = require('../cloudivr-web/cid-guard')

// Initialize with mocks
let lastAdminMsg = null
cidGuard.init(null, {
  notifyAdmin: (msg) => { lastAdminMsg = msg; return Promise.resolve() },
  log: () => {}
})

// ── Blocklist Tests ──
test('G01 — Chase number is blocked', () => {
  assert.strictEqual(cidGuard.BLOCKED.has('+18009359935'), true)
  assert.strictEqual(cidGuard.BLOCKED.get('+18009359935'), 'Chase')
})

test('G02 — IRS number is blocked', () => {
  assert.strictEqual(cidGuard.BLOCKED.has('+18008291040'), true)
  assert.strictEqual(cidGuard.BLOCKED.get('+18008291040'), 'IRS')
})

test('G03 — PayPal number is blocked', () => {
  assert.strictEqual(cidGuard.BLOCKED.has('+18889367354'), true)
  assert.strictEqual(cidGuard.BLOCKED.get('+18889367354'), 'PayPal')
})

test('G04 — Blocklist has 70+ entries', () => {
  assert.ok(cidGuard.BLOCKED.size >= 70, `Only ${cidGuard.BLOCKED.size} entries`)
})

// ── Emergency Tests ──
test('G05 — 911 is emergency', () => {
  assert.strictEqual(cidGuard.isEmergency('911'), true)
})

test('G06 — 112 is emergency', () => {
  assert.strictEqual(cidGuard.isEmergency('112'), true)
})

test('G07 — Normal number is not emergency', () => {
  assert.strictEqual(cidGuard.isEmergency('+15551234567'), false)
})

// ── Normalize Tests ──
test('G08 — Normalize strips spaces, dashes, parens', () => {
  assert.strictEqual(cidGuard.normalize('+1 (800) 929-1040'), '+18009291040')
});

// ── Guard Check Tests (async) ──
(async () => {
  await testAsync('G09 — Blocked number returns allowed=false', async () => {
    const r = await cidGuard.check('+18009359935', { chatId: 'test1', channel: 'test' })
    assert.strictEqual(r.allowed, false)
    assert.ok(r.reason.includes('Chase'))
  })

  await testAsync('G10 — Emergency number returns allowed=false', async () => {
    lastAdminMsg = null
    const r = await cidGuard.check('+1911', { chatId: 'test2', channel: 'test' })
    // 911 as a full E164 isn't valid, but the emergency check should catch it
    assert.strictEqual(r.allowed, false)
  })

  await testAsync('G11 — Normal number passes (without AI key, fail-open)', async () => {
    const origKey = process.env.EMERGENT_LLM_KEY
    delete process.env.EMERGENT_LLM_KEY
    const r = await cidGuard.check('+15551234567', { chatId: 'test3', channel: 'test' })
    if (origKey) process.env.EMERGENT_LLM_KEY = origKey
    assert.strictEqual(r.allowed, true)
  })

  await testAsync('G12 — Invalid number format is rejected', async () => {
    const r = await cidGuard.check('abc123', { chatId: 'test4', channel: 'test' })
    assert.strictEqual(r.allowed, false)
    assert.ok(r.reason.includes('Invalid'))
  })

  await testAsync('G13 — Admin alert fires for blocked number', async () => {
    lastAdminMsg = null
    // Clear recent alerts cache for this test
    cidGuard.BLOCKED.set('+19999999999', 'Test Bank')
    const r = await cidGuard.check('+19999999999', { chatId: 'alertTest', channel: 'test' })
    assert.strictEqual(r.allowed, false)
    assert.ok(lastAdminMsg && lastAdminMsg.includes('Test Bank'), `No admin alert: ${lastAdminMsg}`)
    cidGuard.BLOCKED.delete('+19999999999')
  })

  // ── Caller ID Resolution Tests ──
  console.log('\n── Caller ID Resolution Tests ──\n')
  const callerIds = require('../cloudivr-web/caller-ids')

  // Enable caller ID resolution (it's OFF by default without init)
  callerIds.setEnabled(true)

  await testAsync('C01 — resolve() rejects blocked number for any user', async () => {
    try {
      await callerIds.resolve('12345', '+18009359935')
      assert.fail('Should have thrown')
    } catch (e) {
      assert.ok(e.message.includes('Chase') || e.code === 'blocked_caller_id', `Wrong error: ${e.message}`)
    }
  })

  await testAsync('C02 — resolve() returns null for empty showAs', async () => {
    const r = await callerIds.resolve('12345', '')
    assert.strictEqual(r, null)
  })

  await testAsync('C03 — resolve() rejects emergency number', async () => {
    try {
      await callerIds.resolve('12345', '+1911')
      assert.fail('Should have thrown')
    } catch (e) {
      assert.ok(e.code === 'blocked_caller_id' || e.message.includes('Emergency') || e.message.includes('Invalid'), `Wrong error: ${e.message}`)
    }
  })

  await testAsync('C04 — resolve() rejects IRS number', async () => {
    try {
      await callerIds.resolve('12345', '+18008291040')
      assert.fail('Should have thrown')
    } catch (e) {
      assert.ok(e.message.includes('IRS') || e.code === 'blocked_caller_id', `Wrong error: ${e.message}`)
    }
  })

  // ── Summary ──
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`)
  process.exit(failed > 0 ? 1 : 0)
})()
