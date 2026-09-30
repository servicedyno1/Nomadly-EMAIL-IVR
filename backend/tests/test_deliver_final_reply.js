// Direct-import behaviour test for deliverFinalReply after the P2 fix.
// Exercises the four scenarios that /dev/stream-delivery-test covers, without
// needing the express endpoint or a running bot.
'use strict'

const path = require('path')
process.env.TELEGRAM_BOT_ON = 'false'   // stub the bot inside _index.js
process.env.SKIP_WEBHOOK_SYNC = 'true'

// We only need the two symbols — but _index.js is a monolith and requires
// many env vars just to load. Instead of importing it, we extract the target
// functions from source and eval them in an isolated scope with minimal deps.
const fs = require('fs')
const src = fs.readFileSync(path.join('/app/js/_index.js'), 'utf8')

// Grab the region: everything from `const _sleep` down to the end of
// `deliverFinalReply`. All three helpers + the function itself.
const startIdx = src.indexOf('const _sleep = (ms)')
const endMarker = 'async function streamAiReply'
const endIdx = src.indexOf(endMarker, startIdx)
if (startIdx < 0 || endIdx < 0) throw new Error('Could not locate deliverFinalReply source region')
const region = src.slice(startIdx, endIdx)

// The region references `log` — stub it. Also, the region is written in an
// async-friendly module; eval it inside a function scope that returns the
// symbols we care about.
// eslint-disable-next-line no-new-func
const factory = new Function('log', region + '\nreturn { deliverFinalReply, _resetSupportFallbackNoise, _tgEditIsTerminal }')
const captured = []
const { deliverFinalReply, _resetSupportFallbackNoise, _tgEditIsTerminal } = factory((msg) => captured.push(msg))

const mkBot = (opts = {}) => {
  const calls = { edit: 0, del: 0, send: 0, plainEdit: 0 }
  let sentText = null
  return {
    calls,
    get sentText() { return sentText },
    editMessageText: async (text, o) => {
      if (o && o.parse_mode === 'HTML') calls.edit++
      else calls.plainEdit++
      if (opts.editFails) throw new Error("Bad Request: message can't be edited")
      if (opts.editFailsRateLimit && calls.edit === 1) { const e = new Error('429 Too Many Requests: retry after 1'); e.response = { statusCode: 429 }; throw e }
      return true
    },
    deleteMessage: async () => { calls.del++; return true },
    sendMessage: async (cid, text) => { calls.send++; sentText = text; return { message_id: 999 } },
  }
}

const assert = require('assert')
;(async () => {
  const aiResponse = 'Inbound overage is $0.15 per minute after your included minutes.'
  const safeHtml = 'Inbound overage is <b>$0.15/min</b> after your included minutes.'

  // A) edit succeeds → via 'edit'
  _resetSupportFallbackNoise(111)
  let b = mkBot({})
  let r = await deliverFinalReply(b, 111, 500, aiResponse, safeHtml, '💬 Typing...')
  assert.deepStrictEqual({ via: r.via, delivered: r.delivered, edits: b.calls.edit, plain: b.calls.plainEdit, sends: b.calls.send },
    { via: 'edit', delivered: true, edits: 1, plain: 0, sends: 0 })
  console.log('✓ A) HTML edit succeeds — no fallback')

  // B) edit fails with "can't be edited" — MUST skip plain retry (was firing before)
  _resetSupportFallbackNoise(222)
  captured.length = 0
  b = mkBot({ editFails: true })
  r = await deliverFinalReply(b, 222, 500, aiResponse, safeHtml, '💬 Typing...')
  assert.strictEqual(r.via, 'send', 'terminal edit must fall through to send')
  assert.strictEqual(r.delivered, true)
  assert.strictEqual(b.calls.plainEdit, 0, 'plain-edit retry MUST be skipped on terminal error (this is the P2 fix)')
  assert.strictEqual(b.calls.del, 1, 'stuck placeholder must be deleted')
  assert.strictEqual(b.sentText, safeHtml, 'final send must use safeHtml')
  assert.strictEqual(captured.length, 1, `dedup should log exactly 1 line for the first fallback; got ${captured.length}`)
  console.log('✓ B) Terminal edit → 1 send, 0 plain-retry, 1 delete, 1 dedup log')

  // C) Same session, second reply — dedup MUST silence the second fallback log
  b = mkBot({ editFails: true })
  captured.length = 0
  r = await deliverFinalReply(b, 222, 501, aiResponse, safeHtml, '💬 Typing...')
  assert.strictEqual(r.delivered, true)
  assert.strictEqual(captured.length, 0, 'second fallback in same session must not re-log (dedup)')
  console.log('✓ C) Same session repeat — dedup suppresses second log line')

  // D) After close, new session logs once again
  _resetSupportFallbackNoise(222)
  b = mkBot({ editFails: true })
  captured.length = 0
  r = await deliverFinalReply(b, 222, 502, aiResponse, safeHtml, '💬 Typing...')
  assert.strictEqual(captured.length, 1, 'after session reset, fallback should log once again')
  console.log('✓ D) After session close+reset — log line re-armed')

  // E) already-shown short-circuit (streaming rendered the final)
  b = mkBot({})
  r = await deliverFinalReply(b, 333, 500, aiResponse, safeHtml, safeHtml)
  assert.strictEqual(r.via, 'already')
  assert.strictEqual(b.calls.edit + b.calls.send + b.calls.del, 0)
  console.log('✓ E) Already-shown — no-op')

  // F) 429 rate limit — retries HTML edit once, no terminal short-circuit
  b = mkBot({ editFailsRateLimit: true })
  r = await deliverFinalReply(b, 444, 500, aiResponse, safeHtml, '💬 Typing...')
  assert.strictEqual(r.via, 'edit-retry', '429 must trigger single HTML retry')
  assert.strictEqual(b.calls.edit, 2, 'HTML editMessageText must have been called twice')
  console.log('✓ F) 429 rate-limit path still retries correctly')

  // G) _tgEditIsTerminal recognises all three variants
  assert.strictEqual(_tgEditIsTerminal(new Error("Bad Request: message can't be edited")), true)
  assert.strictEqual(_tgEditIsTerminal(new Error('Bad Request: message to edit not found')), true)
  assert.strictEqual(_tgEditIsTerminal(new Error('Bad Request: MESSAGE_ID_INVALID')), true)
  assert.strictEqual(_tgEditIsTerminal(new Error('some other error')), false)
  console.log('✓ G) _tgEditIsTerminal detects the 3 terminal variants and rejects others')

  console.log('\nAll deliverFinalReply behaviour tests passed ✓')
})().catch((e) => { console.error(e); process.exit(1) })
