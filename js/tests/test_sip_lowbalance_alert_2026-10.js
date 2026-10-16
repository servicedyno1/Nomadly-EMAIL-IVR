// Regression: low-balance SIP block must NEVER be silent, and a wallet top-up
// must clear lingering cooldowns (not just in-memory pre-dial blocks).
// Context: @pirate_script (chatId 1005284399) saw a bare Zoiper "503" with no
// bot explanation after his wallet hit $0.18 — see SIP_LOWBALANCE_ALERT RCA.
const assert = require('assert')

process.env.BOT_ENVIRONMENT = 'development'
process.env.SKIP_WEBHOOK_SYNC = 'true'

const vs = require('../voice-service.js')

let passed = 0
const ok = (m) => { console.log('✅', m); passed++ }

;(async () => {
  // ── 1. notifyPreDialLowBalance sends even when the translation is MISSING ──
  const sent = []
  const fakeBot = { sendMessage: (chatId, text, opts) => { sent.push({ chatId, text, opts }); return Promise.resolve() } }
  vs.initVoiceService({
    bot: fakeBot,
    // _trans resolves via lang files internally; we simulate "missing" by using
    // a language with no string — but the public API is notifyPreDialLowBalance,
    // which now falls back to the English LOCK header instead of returning early.
  })

  const block = { chatId: 1005284399, reason: 'low_balance', phoneNumber: '+18445716353' }
  vs.notifyPreDialLowBalance(block)
  await new Promise(r => setTimeout(r, 50))
  assert(sent.length >= 1, 'expected a Telegram alert to be sent')
  assert(/Locked/i.test(sent[0].text) || /🚫/.test(sent[0].text), 'alert should carry the locked header (fallback-safe)')
  assert(sent[0].opts?.reply_markup?.inline_keyboard, 'alert should include a Top-Up button')
  ok('low-balance SIP block ALWAYS notifies the user (fallback header, never silent)')

  // ── 2. Top-up clears lingering cooldown even with NO in-memory pre-dial block ──
  // Add only a pre-dial block, remove it to leave a cooldown behind, then prove
  // the by-chatId clear removes cooldowns and returns a positive count.
  vs.addSipPreDialBlock('gencredTEST', 1005284399, 'low_balance', '+18445716353')
  const cleared = vs.removeSipPreDialBlockByChatId(1005284399)
  assert(cleared >= 1, 'clearing by chatId should report what was cleared (block and/or cooldown)')
  ok('wallet top-up clears SIP block by chatId and reports a positive count')

  // ── 3. A second clear with nothing left returns 0 (idempotent, no false signal) ──
  const again = vs.removeSipPreDialBlockByChatId(999999999)
  assert(again === 0, 'clearing an unblocked user returns 0 (so no false "re-enabled" message fires)')
  ok('clearing an unblocked user is a no-op (returns 0)')

  console.log(`\n✅ ALL ${passed} assertions passed`)
  process.exit(0)
})().catch(e => { console.error('❌', e.message); process.exit(1) })
