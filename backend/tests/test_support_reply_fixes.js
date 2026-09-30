// Regression tests for the 2026-02 @blacknmilds AI-Support fixes.
//   P1: AI Support KB now disambiguates Quick-IVR (TTS) vs Bulk-IVR (upload)
//   P2: editMessageText "message can't be edited" no longer produces
//       per-reply log spam + redundant plain-edit attempt
// Run: /opt/node22/bin/node /app/backend/tests/test_support_reply_fixes.js
'use strict'

const assert = require('assert')
const fs = require('fs')

// ── P1: KB content ────────────────────────────────────────────────────────
;(function testKbDisambiguation() {
  const kb = fs.readFileSync('/app/js/ai-support.js', 'utf8')

  // The old blanket entry that told users to "Try a different voice from the
  // voice selection menu" for ANY IVR audio issue is gone.
  const oldEntryHits = (kb.match(/### "IVR call not working \/ TTS audio failing"/g) || []).length
  assert.strictEqual(oldEntryHits, 0, 'old ambiguous KB entry must be removed')

  // New entry exists and covers BOTH flows.
  assert.ok(/### "IVR call not working \/ no sound plays \/ audio failing"/.test(kb),
    'new disambiguating KB entry title must exist')
  assert.ok(/A\) Quick IVR Call — uses TTS/.test(kb), 'must describe Quick IVR TTS flow')
  assert.ok(/B\) Bulk IVR Campaign — uses an uploaded audio file/.test(kb),
    'must describe Bulk IVR upload flow')
  assert.ok(/There is NO "voice selection menu" in this flow/.test(kb),
    'must explicitly tell the AI that Bulk IVR has no voice picker')
  assert.ok(/WAV uploads are auto-converted to MP3 on upload/.test(kb),
    'must document the Feb-2026 WAV auto-conversion fix')

  // New entry about the +1/Romania parseLeadsFile bug.
  assert.ok(/### "Bulk IVR — calls failing with 'Account not authorized to call'/.test(kb),
    'must document the NANP normalization behaviour')
  assert.ok(/bare 10-digit US number.*4065067340.*Romania/.test(kb),
    'must reference the specific @blacknmilds case in KB')

  console.log('✓ P1 (KB disambiguation) — Quick-IVR vs Bulk-IVR entries added')
})()

// ── P2: deliverFinalReply & doEdit behaviour ─────────────────────────────
// We can't import _index.js (it boots the whole app), so verify by source
// pattern-match — the actual runtime behaviour is separately covered by the
// /dev/stream-delivery-test in-process endpoint at line ~42515.
;(function testEditFallbackNoiseFixed() {
  const src = fs.readFileSync('/app/js/_index.js', 'utf8')

  // The per-reply "delivered via fallback message (send)" info line is gone.
  const perReplyLog = (src.match(/AI reply delivered via fallback message/g) || []).length
  assert.strictEqual(perReplyLog, 0,
    'per-reply "delivered via fallback message" log must be removed (it fired on every AI reply)')

  // Terminal-error detector exists (skips redundant plain-edit).
  assert.ok(/function _tgEditIsTerminal\b/.test(src),
    'must define _tgEditIsTerminal helper')
  assert.ok(/message can.?t be edited/.test(src) &&
            /message to edit not found/.test(src) &&
            /MESSAGE_ID_INVALID/.test(src),
    '_tgEditIsTerminal must match the three known terminal errors')

  // deliverFinalReply short-circuits on terminal errors (no wasted plain retry).
  assert.ok(/if \(_tgEditIsTerminal\(e\)\) \{ terminal = true; break \}/.test(src),
    'deliverFinalReply must break on terminal error before the plain-edit path')
  assert.ok(/if \(!terminal\) \{[\s\S]*editMessageText\(aiResponse/.test(src),
    'plain-edit attempt must be gated on !terminal')

  // Log dedup — max 1 fallback line per session (was 1+ per reply).
  assert.ok(/_fallbackLoggedThisSession/.test(src),
    'must dedup fallback log per session')
  assert.ok(/function _resetSupportFallbackNoise/.test(src),
    'must expose per-session reset for the dedup')

  // Reset is called on all three session-close paths.
  const resetCalls = (src.match(/_resetSupportFallbackNoise\(/g) || []).length
  // 4 = 1 definition + 3 call sites (user /done, admin /close, admin closeSession helper, Cancel-to-Main-Menu)
  assert.ok(resetCalls >= 4,
    `expected _resetSupportFallbackNoise wired into all close paths (got ${resetCalls} occurrences)`)

  // streamAiReply's doEdit stops trying after a terminal error.
  assert.ok(/let terminalEdit = false/.test(src),
    'doEdit must track a session-scoped terminalEdit flag')
  assert.ok(/if \(!mid \|\| terminalEdit\) return false/.test(src),
    'doEdit must short-circuit when the placeholder is known-terminal')

  console.log('✓ P2 (editMessageText fallback spam) — terminal detection + log dedup + streaming short-circuit')
})()

console.log('\nAll AI-Support P1+P2 regression tests passed ✓')
