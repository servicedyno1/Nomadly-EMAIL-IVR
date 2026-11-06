/**
 * Test My Number — one-tap "📞 Test my number" feature
 *
 * Places an outbound Telnyx call FROM our Telnyx trial caller (TELNYX_TRIAL_CALLER_ID)
 * TO the user's Nomadly Twilio number. The call traverses the full real-world inbound
 * path:  PSTN → user's Twilio number → /twilio/voice-webhook → <Dial><Sip>… → Telnyx
 * → registered SIP UA (softphone or PBX). When the far end answers, we play a
 * "press 1 to confirm" prompt and listen for DTMF. We also let Telnyx's AMD
 * (answering machine detection) tell us if a voicemail/PBX answered instead of a human.
 *
 * Outcomes reported back to the user via Telegram message:
 *   ✅ Reached your SIP device       — DTMF '1' received within 12s of answer
 *   ⚠️ Got voicemail / PBX            — AMD = 'machine' OR call answered but no DTMF
 *   ❌ No answer                       — call never answered (timeout / busy / failed)
 *
 * Throttle: 3 free tests per number per 24h (in-memory + persisted in MongoDB). Never billed (isFreeTestRing).
 *
 * Wiring: initTestMyNumber(app, { telnyxApi, bot, db, log, selfUrl, getTxt })
 */

const TRIAL_CALLER_ID = process.env.TELNYX_TRIAL_CALLER_ID || '+18889020132'
const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes — sessions auto-cleaned
const TEST_TIMEOUT_MS = 60 * 1000     // 1 minute — overall test deadline
const DTMF_WAIT_MS = 12 * 1000        // 12s to press '1' after answer
const MAX_TESTS_PER_DAY = 3
const FREE_WINDOW_MS = TEST_TIMEOUT_MS + 60 * 1000
// phoneNumber → ts the free ring was started; inbound billing skips calls from TRIAL_CALLER_ID while set
const pendingTargets = {}
// owner number → latest test { state: 'calling'|'done', code, outcome, to, external, startedAt } (web page polls it)
const results = {}

// In-memory session map: callControlId → { chatId, num, lang, phase, dtmf, amdResult, ... }
const sessions = {}
// Throttle map: phoneNumber → [timestamp, timestamp, ...]  (last 24h)
const testHistory = {}

let _bot = null
let _telnyxApi = null
let _log = console.log
let _getTxt = null
let _selfUrl = ''
let _col = null

const isFreeTestRing = (from, to) => from === TRIAL_CALLER_ID && !!pendingTargets[to] && Date.now() - pendingTargets[to] < FREE_WINDOW_MS

function initTestMyNumber(app, deps) {
  _bot = deps.bot
  _telnyxApi = deps.telnyxApi
  _log = deps.log || console.log
  _getTxt = deps.getTxt
  _selfUrl = deps.selfUrl || ''
  _col = deps.db ? deps.db.collection('testMyNumberLog') : null

  // ── Webhook: Telnyx posts ALL events for the test call here ──
  // Route registered WITHOUT /api prefix because there's app-level middleware
  // that strips /api from incoming requests. External URL is still
  // ${SELF_URL}/api/test-call/webhook (middleware will strip /api → matches).
  app.post('/test-call/webhook', async (req, res) => {
    try {
      const event = req.body?.data || req.body
      const payload = event?.payload || {}
      const eventType = event?.event_type || ''
      const callControlId = payload.call_control_id

      // Always 200 OK fast — Telnyx retries otherwise
      res.status(200).send('OK')

      const session = sessions[callControlId]
      if (!session) {
        _log(`[TestMyNumber] ${eventType} — no session for ccId=${callControlId}`)
        return
      }

      _log(`[TestMyNumber] ${eventType} ccId=${callControlId} sessionId=${session.id}`)

      switch (eventType) {
        case 'call.initiated':
          // Ringing — nothing to do, wait for answer
          break

        case 'call.answered':
          session.answeredAt = Date.now()
          // Speak prompt + gather single digit
          try {
            await _telnyxApi.gatherDTMF(
              callControlId,
              ('Hello. This is your ' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + ' test call. Press one to confirm your SIP device is working.'),
              {
                voice: 'female',
                language: 'en-US',
                minDigits: 1,
                maxDigits: 1,
                timeout: DTMF_WAIT_MS,
                validDigits: '0123456789',
              }
            )
          } catch (e) {
            _log(`[TestMyNumber] gatherDTMF failed: ${e.message}`)
          }
          break

        case 'call.machine.detection.ended':
          session.amdResult = payload.result || 'unknown'  // 'human' | 'machine' | 'not_sure'
          _log(`[TestMyNumber] AMD result: ${session.amdResult}`)
          break

        case 'call.gather.ended':
          session.dtmf = payload.digits || ''
          _log(`[TestMyNumber] DTMF received: "${session.dtmf}"`)
          // Hang up after capturing the digit
          try { await _telnyxApi.hangupCall(callControlId) } catch (e) { /* ignore */ }
          break

        case 'call.hangup':
        case 'call.dtmf.received':
        case 'call.speak.ended':
        case 'call.playback.ended':
          if (eventType === 'call.hangup') {
            session.endedAt = Date.now()
            await finalizeAndReport(session)
          }
          break

        default:
          // Other events ignored
          break
      }
    } catch (e) {
      _log(`[TestMyNumber] Webhook error: ${e.message}`)
    }
  })

  // ── Periodic cleanup of stale sessions ──
  setInterval(() => {
    const now = Date.now()
    for (const [id, s] of Object.entries(sessions)) {
      if (now - s.startedAt > SESSION_TTL_MS) {
        delete sessions[id]
      }
    }
    // Trim throttle history older than 24h
    const cutoff = now - 24 * 60 * 60 * 1000
    for (const [num, ts] of Object.entries(testHistory)) {
      testHistory[num] = ts.filter(t => t >= cutoff)
      if (testHistory[num].length === 0) delete testHistory[num]
    }
  }, 60 * 1000)

  _log('[TestMyNumber] initialized — POST /test-call/webhook ready (external: /api/test-call/webhook)')
}

/**
 * Place a test call. Returns { ok: true, message } or { ok: false, message }.
 * The message is what the bot should send to the user immediately.
 */
// opts.to = ring another phone (web "Another number"): straight from the test line, same daily limit, max 1 minute.
async function placeTestCall(chatId, num, lang, { to = null } = {}) {
  const owner = num.phoneNumber
  const targetNumber = to || owner
  const t = _getTxt ? _getTxt(lang) : null
  const M = (key, ...args) => (t?.testMyNumber?.[key] ? (typeof t.testMyNumber[key] === 'function' ? t.testMyNumber[key](...args) : t.testMyNumber[key]) : null)

  // ── Throttle ──
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  let saved = []
  if (_col) {
    try { saved = ((await _col.findOne({ _id: owner }))?.ts || []).filter(t => t >= dayAgo) } catch (e) { /* in-memory fallback */ }
  }
  // Read in-memory after the await: from here to the reservation below is synchronous, so concurrent taps can't overshoot.
  const mem = (testHistory[owner] || []).filter(t => t >= dayAgo)
  const recent = saved.length > mem.length ? saved : mem
  if (recent.length >= MAX_TESTS_PER_DAY) {
    return {
      ok: false,
      message: M('throttled', MAX_TESTS_PER_DAY) || `⏳ You've already run ${MAX_TESTS_PER_DAY} tests on ${owner} in the last 24 hours. Try again later.`,
    }
  }

  // ── Sanity ──
  if (!_telnyxApi || !_bot) {
    return { ok: false, message: '❌ Test feature not initialized. Please try again in a moment.' }
  }
  if (num.status !== 'active') {
    return {
      ok: false,
      message: M('inactive', owner) || `❌ Number ${owner} is not active — testing is only available for active numbers.`,
    }
  }

  // ── Place outbound call (Telnyx → user's Twilio number, with AMD) ──
  const webhookUrl = `${_selfUrl}/api/test-call/webhook`
  // Reserve the slot before dialling so concurrent taps can't exceed the limit.
  let slot = Date.now()
  while (recent.includes(slot)) slot++
  testHistory[owner] = [...recent, slot]
  const release = () => { testHistory[owner] = (testHistory[owner] || []).filter(x => x !== slot); if (!to) delete pendingTargets[owner]; results[owner] = null }
  if (!to) pendingTargets[owner] = slot
  results[owner] = { state: 'calling', to: targetNumber, external: !!to, startedAt: slot }
  const result = await _telnyxApi.createOutboundCall(
    TRIAL_CALLER_ID,
    targetNumber,
    webhookUrl,
    null,   // use default Telnyx call control connection
    { answering_machine_detection: 'detect' }
  ).catch(e => ({ error: e.message }))

  if (result?.error) {
    release()
    _log(`[TestMyNumber] createOutboundCall error: ${result.error}`)
    return {
      ok: false,
      message: M('placeFailed', result.error) || `❌ Couldn't place test call: ${result.error}`,
    }
  }

  const callControlId = result.callControlId
  const session = {
    id: callControlId,
    chatId,
    num,
    owner,
    targetNumber,
    external: !!to,
    lang,
    startedAt: Date.now(),
    answeredAt: null,
    endedAt: null,
    amdResult: null,
    dtmf: null,
    reported: false,
  }
  sessions[callControlId] = session

  if (_col) _col.updateOne({ _id: owner }, { $set: { ts: testHistory[owner] } }, { upsert: true }).catch(() => {})

  // Hard 1-minute cap — hang up and finalize even if no hangup event arrives
  setTimeout(() => {
    Promise.resolve(_telnyxApi.hangupCall(callControlId)).catch(() => {})
    if (sessions[callControlId] && !sessions[callControlId].reported) {
      finalizeAndReport(sessions[callControlId]).catch(e => _log(`[TestMyNumber] timeout finalize err: ${e.message}`))
    }
  }, TEST_TIMEOUT_MS)

  _log(`[TestMyNumber] Test call placed: ${TRIAL_CALLER_ID} → ${targetNumber} (chatId=${chatId}, ccId=${callControlId})`)

  return {
    ok: true,
    message: M('placing', targetNumber) || `📞 Calling <code>${targetNumber}</code> from a ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} test line… pick up and press <b>1</b> when it rings (you have ~12 seconds after answer).\n\nResult will appear here in under 60s.`,
  }
}

// Latest test for a number + tests left today (the limit itself is enforced in placeTestCall).
function testStatus(owner) {
  const left = MAX_TESTS_PER_DAY - (testHistory[owner] || []).filter(t => t >= Date.now() - 24 * 60 * 60 * 1000).length
  return { ...(results[owner] || { state: 'idle' }), left: Math.max(0, left), max: MAX_TESTS_PER_DAY, maxSeconds: TEST_TIMEOUT_MS / 1000 }
}

/**
 * Compute the final outcome and send the result to the user.
 */
async function finalizeAndReport(session) {
  if (session.reported) return
  session.reported = true
  if (!session.external) setTimeout(() => { if (pendingTargets[session.owner] <= session.startedAt) delete pendingTargets[session.owner] }, 30 * 1000)

  const t = _getTxt ? _getTxt(session.lang) : null
  const M = (key, ...args) => (t?.testMyNumber?.[key] ? (typeof t.testMyNumber[key] === 'function' ? t.testMyNumber[key](...args) : t.testMyNumber[key]) : null)
  const phone = session.targetNumber

  let outcome
  const code = session.dtmf ? 'ok' : (session.amdResult === 'machine' || session.amdResult === 'machine_premature_hangup') ? 'voicemail' : session.answeredAt ? 'no_key' : 'no_answer'
  if (session.external) {
    outcome = ({
      ok: `✅ <b>Test call reached ${phone}</b> — it rang, was answered and a key was pressed.`,
      voicemail: `⚠️ <b>Voicemail answered</b> on <code>${phone}</code> — the call went through, but nobody picked up in person.`,
      no_key: `⚠️ <b>Answered, but no key was pressed</b> on <code>${phone}</code>. Run the test again and press 1 when you hear the message.`,
      no_answer: `❌ <b>No answer</b> on <code>${phone}</code>. Check the number and that the phone has signal, then try again.`,
    })[code]
  } else if (session.dtmf && session.dtmf.length > 0) {
    // Best signal — a real human pressed a key
    outcome = M('successDtmf', phone) || `✅ <b>Reached your SIP device</b> — calls to <code>${phone}</code> are working. The far end answered and key <b>${session.dtmf}</b> was pressed.`
  } else if (session.amdResult === 'machine' || session.amdResult === 'machine_premature_hangup') {
    outcome = M('voicemail', phone) || `⚠️ <b>Got voicemail / PBX answer</b> on <code>${phone}</code>.\n\nThis usually means a PBX (3CX, FreePBX, Asterisk…) is answering and dumping the call to its own voicemail instead of ringing your extension. Open <b>/sipguide</b> for the SIP TRUNK setup walk-through, or switch to a single-line softphone (Linphone, Zoiper) for an instant fix.`
  } else if (session.answeredAt && !session.dtmf) {
    // Call answered but no DTMF — could be PBX voicemail w/ AMD = not_sure
    outcome = M('answeredNoDtmf', phone) || `⚠️ <b>Call answered, but no key was pressed</b> on <code>${phone}</code> within 12 seconds.\n\nIf you didn't pick up, your softphone may not be receiving the call. If you DID pick up but didn't press 1, just retry. If a PBX (3CX/FreePBX) is involved, see <b>/sipguide</b> for SIP TRUNK setup.`
  } else {
    outcome = M('noAnswer', phone) || `❌ <b>No answer</b> on <code>${phone}</code>.\n\nMake sure your softphone (Linphone / Zoiper / 3CX trunk) is registered and online, then run the test again. Open <b>/sipguide</b> for setup help.`
  }

  results[session.owner] = { ...(results[session.owner] || {}), state: 'done', code, outcome, endedAt: Date.now() }
  try {
    await _bot?.sendMessage(session.chatId, outcome, { parse_mode: 'HTML', disable_web_page_preview: true })
  } catch (e) {
    _log(`[TestMyNumber] Failed to send result to chatId=${session.chatId}: ${e.message}`)
  }

  // Clean up after 5s (let any straggling events log session correctly first)
  setTimeout(() => { delete sessions[session.id] }, 5000)
}

module.exports = {
  initTestMyNumber,
  placeTestCall,
  TRIAL_CALLER_ID,
  MAX_TESTS_PER_DAY,
  isFreeTestRing,
  testStatus,
}
