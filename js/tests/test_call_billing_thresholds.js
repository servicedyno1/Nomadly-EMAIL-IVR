/*global require, process, console, setTimeout */
// ============================================================
// Regression test for the @piki0000 billing-gate fix (2026-10-08)
// ============================================================
// Reported: a Pro user (chatId 986605509) tried a single outbound SIP call,
// was blocked for "low_balance", deposited $20 (balance $20.05) — and was STILL
// blocked, with NO Telegram explanation.
//
// Root causes + fixes verified here:
//   1. Single-call unlock gate was $50 (LOW_BALANCE_RESUME). A single SIP/bot
//      call must not be gated at $50 → lowered to $20.
//   2. Bulk-call minimum (BULK_CALL_MIN_WALLET) lowered $50 → $20.
//   3. The pre-dial INSTANT-block path rejected calls SILENTLY — SIP-originated
//      blocked calls now notify the user (throttled) with the $20 minimum.
//   4. The deposit-triggered unblock (removeSipPreDialBlockByChatId) is now
//      chatId-type tolerant, so a $20 top-up actually clears the block.
// ============================================================

require('dotenv').config({ path: '/app/backend/.env' })
const assert = require('assert')
const vs = require('../voice-service')
const bulk = require('../bulk-call-service')

let passed = 0
const ok = (n) => { console.log(`\u2705 ${n}`); passed++ }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  // 1. Single-call thresholds
  assert.strictEqual(vs.LOW_BALANCE_TRIGGER, 1, 'LOW_BALANCE_TRIGGER should stay $1')
  assert.strictEqual(vs.LOW_BALANCE_RESUME, 20, 'LOW_BALANCE_RESUME should now be $20 (was $50)')
  ok('single-call resume gate is $20 (lock trigger still $1) — a $20 top-up now unlocks calling')

  // 2. Bulk-call minimum
  assert.strictEqual(bulk.BULK_CALL_MIN_WALLET, 20, 'BULK_CALL_MIN_WALLET should now be $20 (was $50)')
  ok('bulk-call minimum is $20 (bot + SIP bulk)')

  // 3. Pre-dial instant-block NOW notifies the user (throttled) — previously silent
  const sent = []
  const mockBot = { sendMessage: (chatId, text, opts) => { sent.push({ chatId, text, opts }); return Promise.resolve() } }
  const mockTrans = (key) => (key === 'vs.outboundCallingLocked' ? '\uD83D\uDEAB <b>Outbound Calling Locked</b>\n\n' : null)
  vs.initVoiceService({ bot: mockBot, translation: mockTrans })

  const block = { chatId: '986605509', reason: 'low_balance', blockedAt: Date.now() }
  vs.notifyPreDialLowBalance(block)
  await wait(60) // helper sends async (fire-and-forget so it never slows the sub-ms reject)
  assert.strictEqual(sent.length, 1, 'a low-balance SIP block should notify the user exactly once')
  assert.ok(/\$20/.test(sent[0].text), 'notification must state the $20 resume minimum')
  assert.ok(/Top Up/i.test(JSON.stringify(sent[0].opts || {})), 'notification must include a Top Up button')
  ok('pre-dial instant-block notifies the user with the $20 minimum + Top Up button (SIP no longer silent)')

  // throttle: an immediate re-dial must NOT send a second message
  vs.notifyPreDialLowBalance(block)
  await wait(60)
  assert.strictEqual(sent.length, 1, 'repeat blocks within the window must be throttled (no chat spam)')
  ok('repeat blocks are throttled (no notification spam)')

  // non low_balance reason must not notify
  vs.notifyPreDialLowBalance({ chatId: '111', reason: 'fraud' })
  await wait(40)
  assert.strictEqual(sent.length, 1, 'non low_balance blocks must not send the low-balance notice')
  ok('only low_balance blocks trigger the low-balance notice')

  // 4. Deposit unblock is chatId-type tolerant (stored with NUMERIC chatId, removed by STRING)
  vs.addSipPreDialBlock('gencredTEST', 986605509 /* number */, 'low_balance', '+10000000000')
  const removed = vs.removeSipPreDialBlockByChatId('986605509' /* string */)
  assert.strictEqual(removed, 1, 'removeSipPreDialBlockByChatId must match across string/number chatId')
  ok('deposit-triggered unblock matches regardless of chatId type (the $20 top-up now clears the block)')

  console.log(`\n\u2705 ALL ${passed} assertions passed`)
  process.exit(0)
}
run().catch((e) => { console.error(`\u274C TEST FAILED: ${e.message}`); process.exit(1) })
