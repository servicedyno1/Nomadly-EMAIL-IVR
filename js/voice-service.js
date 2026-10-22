// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Voice Service — Call Handling with IVR, Recording, Limits & Feature-Gating
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const { log } = require('console')
const { get, set, setFields, atomicIncrement } = require('./db.js')
const { formatPhone, formatDuration, canAccessFeature, plans, OVERAGE_RATE_MIN, OVERAGE_RATE_SMS, CALL_FORWARDING_RATE_MIN, CALL_CONNECTION_FEE, escapeHtml, isTwilioEnabled } = require('./phone-config.js')
const { getBalance, smartWalletDeduct, smartWalletCheck, forceWalletDebit } = require('./utils.js')
const dialGuard = require('./dial-rate-guard.js')
const callSessionStore = require('./call-session-store.js')

let _bot = null
let _db = null
let _phoneNumbersOf = null
let _phoneLogs = null
let _telnyxApi = null
let _telnyxResources = null
let _translation = null
let _ivrAnalytics = null
let _walletOf = null
let _payments = null
let _nanoid = null
let _twilioSipDomain = null
let _selfUrl = null

// i18n helper: get user language and translate
const _langCache = new Map()
async function _getUserLang(chatId) {
  if (_langCache.has(chatId)) return _langCache.get(chatId)
  try {
    if (!_state) return 'en' // guard: state collection not yet initialized
    const user = await get(_state, chatId)
    const lang = user?.userLanguage || 'en'
    _langCache.set(chatId, lang)
    setTimeout(() => _langCache.delete(chatId), 300000) // cache 5 min
    return lang
  } catch { return 'en' }
}
function _trans(key, lang, ...args) {
  if (!_translation) return null
  const t = _translation(key, lang, ...args)
  return t
}
let _state = null
let _twilioService = null
let _loyalty = null
let _testOutboundSipMatch = null
let _notifyAdmin = null

// In-memory stores for in-flight call sessions. Each is wrapped in a write-through Proxy
// (js/call-session-store.js) so every create/delete is mirrored to the Mongo `callSessions`
// collection (TTL-indexed). A blue/green cutover (or a crash) therefore never drops a live call:
// the new slot warm-loads these on boot and read-through fills any gap, so Twilio/Telnyx webhooks
// for an ongoing call still find their session instead of a "session expired" dead-end.
const _activeCallsRaw = {}       // callControlId → session data
const _pendingBridgesRaw = {}    // bridgeId → { twilioNumber, destination, chatId, num, callControlId }
const _outboundIvrCallsRaw = {}  // callControlId → outbound IVR session data
const _twilioIvrSessionsRaw = {} // sessionId → { chatId, callerId, targetNumber, ... } (Twilio IVR)
function _persistentStore(kind, raw) {
  return new Proxy(raw, {
    set(o, p, v) { o[p] = v; if (typeof p === 'string') callSessionStore.persist(kind, p, v); return true },
    deleteProperty(o, p) { delete o[p]; if (typeof p === 'string') callSessionStore.remove(kind, p); return true },
  })
}
const activeCalls = _persistentStore('activeCalls', _activeCallsRaw)
const pendingBridges = _persistentStore('pendingBridges', _pendingBridgesRaw)
const outboundIvrCalls = _persistentStore('outboundIvrCalls', _outboundIvrCallsRaw)
const twilioIvrSessions = _persistentStore('twilioIvrSessions', _twilioIvrSessionsRaw)
// Raw (un-proxied) refs — warm-load / read-through / snapshot write here so restoring a session
// from Mongo does NOT trigger a redundant write-back, and for fast key counts in /health.
const _callSessionStores = {
  activeCalls: _activeCallsRaw,
  pendingBridges: _pendingBridgesRaw,
  outboundIvrCalls: _outboundIvrCallsRaw,
  twilioIvrSessions: _twilioIvrSessionsRaw,
}
const CALL_SESSION_SNAPSHOT_MS = parseInt(process.env.CALL_SESSION_SNAPSHOT_MS || '15000', 10)
let _callSessionSnapshotTimer = null

// Live phone-call session counts — consumed by /health so deploy.sh can hold the blue/green
// nginx flip (drain the old slot) while total > 0, so a redeploy never cuts off an active call.
function getLiveCallCounts() {
  const ac = Object.keys(_activeCallsRaw).length
  const pb = Object.keys(_pendingBridgesRaw).length
  const oic = Object.keys(_outboundIvrCallsRaw).length
  const tis = Object.keys(_twilioIvrSessionsRaw).length
  return { activeCalls: ac, pendingBridges: pb, outboundIvrCalls: oic, twilioIvrSessions: tis, total: ac + pb + oic + tis }
}
const lastIvrCallParams = new Map() // chatId → last IVR call params for Redial feature

// ── Ended Calls Tracker ──
// Tracks call_control_ids that have received hangup events.
// Prevents race condition where gather/speak commands are issued after call.hangup.
const _endedCalls = new Set()
const ENDED_CALL_TTL_MS = 60_000 // Auto-cleanup after 60s

// Throttles admin alerts for orphaned (no-owner) inbound numbers: phoneNumber → last-alert ms.
// A single de-provisioned number hammered by a robocaller must not spam the admin chat.
const _orphanAlertThrottle = new Map()

function markCallEnded(callControlId) {
  if (!callControlId) return
  _endedCalls.add(callControlId)
  setTimeout(() => _endedCalls.delete(callControlId), ENDED_CALL_TTL_MS)
}

function isCallEnded(callControlId) {
  return _endedCalls.has(callControlId)
}

// ── Voice mapping: TTS voice → Twilio Polly voice & Telnyx voice gender ──
// Used as the FALLBACK voice for Twilio say() when a matching-voice audio clip
// isn't available. ElevenLabs voices are mapped by GENDER so the fallback at least
// matches the greeting's gender (bug fix 2026-08-07).
const OPENAI_TO_TWILIO_VOICE = {
  // OpenAI voices
  'alloy': 'Polly.Joanna-Neural',      // Female, neutral
  'fable': 'Polly.Brian-Neural',        // Male, British expressive
  'nova': 'Polly.Salli-Neural',         // Female, warm friendly
  'shimmer': 'Polly.Kimberly-Neural',   // Female, clear pleasant
  'echo': 'Polly.Matthew-Neural',       // Male, warm deep
  'onyx': 'Polly.Stephen-Neural',       // Male, deep authoritative
  // ElevenLabs female voices → female Polly
  'rachel': 'Polly.Joanna-Neural', 'sarah': 'Polly.Kimberly-Neural', 'laura': 'Polly.Salli-Neural',
  'emily': 'Polly.Joanna-Neural', 'domi': 'Polly.Kimberly-Neural', 'dorothy': 'Polly.Salli-Neural',
  'glinda': 'Polly.Joanna-Neural',
  // ElevenLabs male voices → male Polly
  'drew': 'Polly.Matthew-Neural', 'charlie': 'Polly.Brian-Neural', 'clyde': 'Polly.Stephen-Neural',
  'adam': 'Polly.Matthew-Neural', 'josh': 'Polly.Stephen-Neural', 'arnold': 'Polly.Matthew-Neural',
  'sam': 'Polly.Brian-Neural', 'thomas': 'Polly.Matthew-Neural',
}
const OPENAI_TO_TELNYX_VOICE = {
  'alloy': 'female', 'fable': 'male', 'nova': 'female',
  'shimmer': 'female', 'echo': 'male', 'onyx': 'male',
  'rachel': 'female', 'sarah': 'female', 'laura': 'female', 'emily': 'female',
  'domi': 'female', 'dorothy': 'female', 'glinda': 'female',
  'drew': 'male', 'charlie': 'male', 'clyde': 'male', 'adam': 'male',
  'josh': 'male', 'arnold': 'male', 'sam': 'male', 'thomas': 'male',
}
function getTwilioVoice(voiceName) {
  return OPENAI_TO_TWILIO_VOICE[(voiceName || '').toLowerCase()] || 'Polly.Matthew-Neural'
}
function getTelnyxVoice(voiceName) {
  return OPENAI_TO_TELNYX_VOICE[(voiceName || '').toLowerCase()] || 'female'
}

// SIP outbound rate limiter: key (sipUser:destination) → { count, firstCallTime }
const sipRateLimit = {}
const SIP_RATE_LIMIT_MAX = 3       // Max calls per window
const SIP_RATE_LIMIT_WINDOW = 60000 // 60 seconds window

// Per-user global rate limiter — caps total outbound calls from a single number/user
// regardless of destination. Prevents spam dialing to many different numbers.
const sipGlobalRateLimit = {}
const SIP_GLOBAL_RATE_MAX = 10         // Max total calls per window (any destination)
const SIP_GLOBAL_RATE_WINDOW = 300000  // 5-minute window

// Fix #2: Escalating hard-block for persistent rate-limit abusers.
// After N consecutive rejections, silently drop all webhooks for a cooldown period
// instead of processing + logging + calling hangup on every single attempt.
const sipHardBlock = {}
const HARD_BLOCK_THRESHOLD = 5         // Consecutive rate-limit hits before hard block
const HARD_BLOCK_DURATION = 600000     // 10 minutes of silent drop

// Expired test credential block set — prevents auto-route retry storm from expired test SIP users.
// Key: sipUsername, Value: timestamp when blocked. Entries auto-expire after 10 minutes.
const _expiredTestBlockSet = new Map()
const EXPIRED_TEST_BLOCK_DURATION = 600000  // 10 minutes

// ── UNIDENTIFIED-CREDENTIAL COST-LEAK GUARD ──
// A SIP credential that repeatedly fails to map to an owner keeps generating billable inbound SIP legs
// (Telnyx bills the leg + the Call Control per-leg fee) plus a wasteful 250-credential reverse lookup,
// with NO user to charge. After N consecutive identification failures we hard-block it briefly to stop
// the recurring cost leak. Auto-expires (self-heals a transient DB hiccup); cleared on any success.
const _unidentifiedFailCount = new Map()  // sipUsername → { count, firstAt }
const _unidentifiedBlockSet = new Map()   // sipUsername → blockedAt
const UNIDENTIFIED_FAIL_THRESHOLD = 3
const UNIDENTIFIED_FAIL_WINDOW = 300000    // 5 min window to accumulate failures
const UNIDENTIFIED_BLOCK_DURATION = 600000 // 10 min hard block
function _recordUnidentifiedFailure(sipUsername) {
  if (!sipUsername) return false
  const now = Date.now()
  let e = _unidentifiedFailCount.get(sipUsername)
  if (!e || now - e.firstAt > UNIDENTIFIED_FAIL_WINDOW) e = { count: 0, firstAt: now }
  e.count++
  _unidentifiedFailCount.set(sipUsername, e)
  if (e.count >= UNIDENTIFIED_FAIL_THRESHOLD) {
    _unidentifiedBlockSet.set(sipUsername, now)
    _unidentifiedFailCount.delete(sipUsername)
    return true
  }
  return false
}
function _isUnidentifiedBlocked(sipUsername) {
  if (!sipUsername) return false
  const blockedAt = _unidentifiedBlockSet.get(sipUsername)
  if (!blockedAt) return false
  if (Date.now() - blockedAt > UNIDENTIFIED_BLOCK_DURATION) { _unidentifiedBlockSet.delete(sipUsername); return false }
  return true
}
function _clearUnidentifiedFailure(sipUsername) {
  if (!sipUsername) return
  if (_unidentifiedFailCount.has(sipUsername)) _unidentifiedFailCount.delete(sipUsername)
  if (_unidentifiedBlockSet.has(sipUsername)) _unidentifiedBlockSet.delete(sipUsername)
}

// ── TEST CALL RATE LIMITER ──
// Strict per-user rate limit specifically for test SIP credentials.
// Much tighter than paid user limits to prevent abuse of free test calls.
const testCallRateLimit = {}
const TEST_CALL_RATE_MAX = 2           // Max 2 test calls per window
const TEST_CALL_RATE_WINDOW = 120000   // 2-minute window

function checkTestCallRateLimit(chatId) {
  if (!chatId) return true
  const key = `test_${chatId}`
  const now = Date.now()
  const entry = testCallRateLimit[key]
  if (!entry || (now - entry.firstCallTime) > TEST_CALL_RATE_WINDOW) {
    testCallRateLimit[key] = { count: 1, firstCallTime: now }
    return true
  }
  entry.count++
  if (entry.count > TEST_CALL_RATE_MAX) {
    return false
  }
  return true
}

// ── PRE-DIAL BLOCKLIST ──
// In-memory cache of SIP credentials that should be INSTANTLY rejected.
// Checked at the TOP of handleOutboundSipCall BEFORE any async/DB operations.
// This prevents auto-routed calls from reaching PSTN for known-blocked users.
// Populated by: (1) wallet monitor scan, (2) LOW_BALANCE_LOCK on first fail, (3) DB on startup.
// Removed by: wallet top-up above LOW_BALANCE_RESUME threshold.
const _sipPreDialBlocklist = new Map()  // sipUsername → { chatId, reason, blockedAt, phoneNumber }

function addSipPreDialBlock(sipUsername, chatId, reason = 'low_balance', phoneNumber = '') {
  if (!sipUsername) return
  _sipPreDialBlocklist.set(sipUsername, { chatId, reason, blockedAt: Date.now(), phoneNumber })
  // Also persist to DB (async, non-blocking)
  try {
    const db = _phoneNumbersOf?.s?.db
    if (db) {
      db.collection('sipPreDialBlocklist').updateOne(
        { _id: sipUsername },
        { $set: { chatId, reason, phoneNumber, blockedAt: new Date() } },
        { upsert: true }
      ).catch(() => {})
    }
  } catch (e) { /* non-critical */ }
}

function removeSipPreDialBlock(sipUsername) {
  if (!sipUsername) return
  _sipPreDialBlocklist.delete(sipUsername)
  // Also remove from DB
  try {
    const db = _phoneNumbersOf?.s?.db
    if (db) {
      db.collection('sipPreDialBlocklist').deleteOne({ _id: sipUsername }).catch(() => {})
    }
  } catch (e) { /* non-critical */ }
}

// Remove ALL blocks for a given chatId (called when wallet is topped up)
function removeSipPreDialBlockByChatId(chatId) {
  let removed = 0
  const target = String(chatId)
  for (const [username, entry] of _sipPreDialBlocklist.entries()) {
    if (String(entry.chatId) === target) {
      _sipPreDialBlocklist.delete(username)
      removed++
    }
  }
  // Also remove from DB
  try {
    const db = _phoneNumbersOf?.s?.db
    if (db) {
      db.collection('sipPreDialBlocklist').deleteMany({ chatId }).catch(() => {})
    }
  } catch (e) { /* non-critical */ }
  // ALWAYS clear lingering wallet-reject cooldowns for this user — they outlive
  // the in-memory pre-dial block (escalating up to 2h) and would keep rejecting
  // SIP calls with a bare "503" even after the wallet is topped up.
  let cooldownsCleared = 0
  if (walletRejectCooldown[`chatId:${target}`]) { delete walletRejectCooldown[`chatId:${target}`]; cooldownsCleared++ }
  for (const [key, entry] of Object.entries(walletRejectCooldown)) {
    if (String(entry?.chatId) === target) { delete walletRejectCooldown[key]; cooldownsCleared++ }
  }
  if (removed > 0 || cooldownsCleared > 0) {
    log(`[Voice] PRE-DIAL: Cleared ${removed} block(s) + ${cooldownsCleared} cooldown(s) for chatId ${chatId} — wallet topped up`)
  }
  return removed + cooldownsCleared
}

// Notify a blocked user (throttled) WHY their outbound call was rejected. This
// covers the FAST pre-dial instant-block path, which previously rejected calls
// SILENTLY — so a user whose SIP call hit the cached blocklist (incl. after a
// partial top-up, or dialing again from a SIP client) got no explanation and
// assumed the call feature was broken. Throttled to at most once per
// PRE_DIAL_NOTIFY_MS per credential so repeated redials don't spam the chat.
const PRE_DIAL_NOTIFY_MS = 10 * 60 * 1000
// English fallback header so a low-balance lock alert is NEVER silently dropped
// when a translation string is missing — otherwise the user only sees the raw
// SIP "503" in their softphone and opens a support ticket.
const LOCK_FALLBACK_HEADER = '🚫 <b>Outbound Calling Locked</b>\n\n'
function notifyPreDialLowBalance(block) {
  try {
    if (!_bot || !block || !block.chatId || block.reason !== 'low_balance') return
    const now = Date.now()
    if (block._lastNotifiedAt && (now - block._lastNotifiedAt) < PRE_DIAL_NOTIFY_MS) return
    block._lastNotifiedAt = now
    // Fire-and-forget: never block/slow the sub-millisecond call rejection.
    ;(async () => {
      try {
        const lang = await _getUserLang(block.chatId)
        const baseMsg = _trans('vs.outboundCallingLocked', lang) || LOCK_FALLBACK_HEADER
        const fullMsg = baseMsg +
          `Your wallet balance is below $${LOW_BALANCE_TRIGGER}, so outbound calls are temporarily locked.\n\n` +
          `💰 <b>Top up to at least $${LOW_BALANCE_RESUME}</b> to resume calling.\n` +
          `Use 👛 <b>Wallet</b> to add funds.`
        _bot.sendMessage(block.chatId, fullMsg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '💰 Top Up Now', callback_data: 'wallet_topup_quick' }]] },
        }).catch(() => {})
      } catch (_) { /* non-critical */ }
    })()
  } catch (_) { /* non-critical */ }
}


async function _loadSipPreDialBlocklist() {
  try {
    const db = _phoneNumbersOf?.s?.db
    if (!db) return
    const entries = await db.collection('sipPreDialBlocklist').find({}).toArray()
    for (const entry of entries) {
      _sipPreDialBlocklist.set(entry._id, {
        chatId: entry.chatId,
        reason: entry.reason,
        blockedAt: entry.blockedAt?.getTime?.() || Date.now(),
        phoneNumber: entry.phoneNumber || '',
      })
    }
    if (entries.length > 0) {
      log(`[Voice] PRE-DIAL: Loaded ${entries.length} blocked credential(s) from DB`)
    }
  } catch (e) { log(`[Voice] PRE-DIAL: Error loading blocklist: ${e.message}`) }
}

// ── Recent Test Credential Cache ──
// Tracks recently created test SIP credentials for fast, reliable user identification.
// Solves the multi-match disambiguation problem: when multiple test users share the same
// SIP connection + ANI, the system couldn't determine which user was calling.
// Now: phone-test-routes.js registers credentials here → voice webhook checks here FIRST.
// Key: sipUsername, Value: { chatId, registeredAt }
const _recentTestCredentials = new Map()
const RECENT_TEST_CREDENTIAL_TTL = 30 * 60 * 1000  // 30 minutes (test calls should happen within minutes)

/**
 * Register a recently created test SIP credential for fast lookup during voice webhooks.
 * Called by phone-test-routes.js after credential creation.
 */
function registerRecentTestCredential(sipUsername, chatId) {
  _recentTestCredentials.set(sipUsername, { chatId, registeredAt: Date.now() })
  log(`[Voice] Registered recent test credential: ${sipUsername} → chatId ${chatId}`)
  // Auto-cleanup after TTL
  setTimeout(() => {
    if (_recentTestCredentials.has(sipUsername)) {
      const entry = _recentTestCredentials.get(sipUsername)
      if (Date.now() - entry.registeredAt >= RECENT_TEST_CREDENTIAL_TTL) {
        _recentTestCredentials.delete(sipUsername)
      }
    }
  }, RECENT_TEST_CREDENTIAL_TTL + 1000)
}

/**
 * Look up a chatId from the recent test credential cache.
 * Returns { chatId, registeredAt } or null if not found/expired.
 */

// Fix #4 → Fix #5: Auto-routed call REAL-TIME billing.
// When rate-limit/hard-block rejects a call but Telnyx auto-routed it to PSTN,
// we now bill in real-time (connection fee + per-minute timer) instead of deferring to hangup.
// If wallet is too low, the call is hung up immediately — prevents unbilled call duration.
const autoRoutedPendingBilling = {} // Legacy — kept for hangup fallback
const AUTO_ROUTE_BILLING_TTL = 600000 // 10 min — auto-expire stale entries

// ── Self-originated PSTN transfer-leg guard ──
// When we `transfer` an outbound SIP call to the PSTN, Telnyx creates a NEW outbound leg that fires
// its OWN call.initiated (direction=outgoing, from=<our ANI>, no SIP credential). Without this guard
// that leg re-enters handleOutboundSipCall and triggers a wasteful 250-credential reverse lookup,
// resolves the WRONG user, and delays the call ~3s. We tag the new leg via Telnyx
// `target_leg_client_state` (primary) and also record a short-TTL guard (backup) so the leg is skipped.
const PSTN_LEG_STATE = 'nomadly_pstn_leg'
const PSTN_LEG_GUARD_TTL = 20000 // 20s
const _pstnLegGuard = new Map() // `${connectionId}|${to}|${ani}` → ts
function _markSelfPstnLeg(connectionId, to, ani) {
  if (_pstnLegGuard.size > 500) {
    const cutoff = Date.now() - PSTN_LEG_GUARD_TTL
    for (const [k, t] of _pstnLegGuard) if (t < cutoff) _pstnLegGuard.delete(k)
  }
  _pstnLegGuard.set(`${connectionId}|${(to || '').replace(/[^+\d]/g, '')}|${(ani || '').replace(/[^+\d]/g, '')}`, Date.now())
}
function _isSelfPstnLeg(payload) {
  // Primary: Telnyx echoes our target_leg_client_state (base64) on the new leg's webhooks.
  try {
    if (payload.client_state) {
      const cs = Buffer.from(payload.client_state, 'base64').toString('utf8')
      if (cs === PSTN_LEG_STATE) return true
    }
  } catch (e) { /* not base64 — ignore */ }
  // Backup: short-TTL guard recorded right before we issued the transfer.
  const connectionId = payload.connection_id || ''
  const to = (payload.to || '').replace(/[^+\d]/g, '')
  const from = (payload.from || '').replace(/[^+\d]/g, '')
  const key = `${connectionId}|${to}|${from}`
  const ts = _pstnLegGuard.get(key)
  if (ts && Date.now() - ts < PSTN_LEG_GUARD_TTL) { _pstnLegGuard.delete(key); return true }
  return false
}

// Fix #5: Real-time billing for auto-routed calls that bypass normal flow
// Called from rate-limit/hard-block handlers when isAutoRouted=true.
// Does: user lookup → wallet check → connection fee → session + per-minute timer → hangup if broke
async function handleAutoRoutedRealTimeBilling(callControlId, sipUsername, fromClean, destination, reason) {
  try {
    const lookupResult = await findNumberBySipUser(sipUsername, fromClean, null)
    if (!lookupResult?.chatId || !lookupResult?.num) {
      // Can't identify user — store for deferred billing as fallback
      autoRoutedPendingBilling[callControlId] = { sipUsername, fromClean, destination, startedAt: new Date(), reason }
      setTimeout(() => { delete autoRoutedPendingBilling[callControlId] }, AUTO_ROUTE_BILLING_TTL)
      log(`[Voice] Fix #5: Auto-routed call ${callControlId} — user not found, deferred billing fallback`)
      return
    }

    const { chatId, num } = lookupResult
    const rate = getCallRate(destination)

    // ── Wallet check — hang up immediately if wallet too low ──
    if (_walletOf) {
      try {
        const walletCheck = await smartWalletCheck(_walletOf, chatId, rate + CALL_CONNECTION_FEE)
        if (walletCheck.usdBal < LOW_BALANCE_TRIGGER) {
          log(`[Voice] Fix #5: Auto-routed LOW BALANCE LOCK — $${walletCheck.usdBal.toFixed(2)} < $${LOW_BALANCE_TRIGGER}, hanging up ${callControlId}`)
          await _telnyxApi.hangupCall(callControlId).catch(() => {})
          const lang = await _getUserLang(chatId)
          const msg = _trans('vs.callDisconnectedAutoRouted', lang, walletCheck.usdBal.toFixed(2), LOW_BALANCE_TRIGGER, LOW_BALANCE_RESUME)
            || `🚫 <b>Call Disconnected</b>\n\nWallet: <b>$${walletCheck.usdBal.toFixed(2)}</b> — below the $${LOW_BALANCE_TRIGGER} minimum.\n💰 Top up at least $${LOW_BALANCE_RESUME} to resume calling.`
          _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
          return
        }
        if (!walletCheck.sufficient) {
          log(`[Voice] Fix #5: Auto-routed insufficient wallet — hanging up ${callControlId}`)
          await _telnyxApi.hangupCall(callControlId).catch(() => {})
          const lang = await _getUserLang(chatId)
          const msg = _trans('vs.callDisconnectedWalletInsufficient', lang, rate, CALL_CONNECTION_FEE)
            || `🚫 <b>Call Disconnected</b> — wallet balance too low for this call (need ~$${(rate + CALL_CONNECTION_FEE).toFixed(2)}).\n💰 Top up via 👛 <b>Wallet</b> to resume calling.`
          _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
          return
        }
      } catch (e) { log(`[Voice] Fix #5: Wallet check error: ${e.message}`) }
    }

    // ── Charge connection fee immediately ──
    if (CALL_CONNECTION_FEE > 0 && _walletOf) {
      try {
        const feeResult = await smartWalletDeduct(_walletOf, chatId, CALL_CONNECTION_FEE, {
          type: 'connection_fee', callType: 'AutoRoute_SIPOutbound',
          description: `Connection fee: ${num.phoneNumber} → ${destination}`,
          destination, phoneNumber: num.phoneNumber,
        })
        if (feeResult.success) {
          const feeRef = _nanoid?.() || `connfee_autoroute_${Date.now()}`
          const feeStr = `$${CALL_CONNECTION_FEE.toFixed(2)}`
          if (_payments) set(_payments, feeRef, `ConnectionFee,AutoRoute_SIPOutbound,$${CALL_CONNECTION_FEE.toFixed(2)},${chatId},${num.phoneNumber},${destination},${new Date()}`)
          log(`[Voice] Fix #5: Connection fee charged: ${feeStr} for ${num.phoneNumber} → ${destination}`)
        }
      } catch (e) { log(`[Voice] Fix #5: Connection fee error: ${e.message}`) }
    }

    // ── Create active session — same as normal calls ──
    activeCalls[callControlId] = {
      chatId,
      num,
      from: num.phoneNumber,
      to: destination,
      startedAt: new Date(),
      phase: 'outbound_telnyx',
      direction: 'outgoing',
      recordingEnabled: false,
      isAutoRouted: true,
      autoRouteReason: reason,
    }

    // ── Start per-minute billing timer — charges every 60s, hangs up if wallet exhausted ──
    const session = activeCalls[callControlId]
    session._limitTimer = setInterval(async () => {
      const sess = activeCalls[callControlId]
      if (!sess) { clearInterval(session._limitTimer); return }
      if (_walletOf) {
        try {
          const deductResult = await smartWalletDeduct(_walletOf, chatId, rate, {
            type: 'sip_per_minute', callType: 'AutoRoute_SIPOutbound',
            description: `SIP call: ${num.phoneNumber} → ${destination} ($${rate}/min)`,
            destination, phoneNumber: num.phoneNumber,
          })
          if (!deductResult.success) {
            log(`[Voice] Fix #5: Mid-call wallet exhausted for auto-routed ${num.phoneNumber} → ${destination}. Disconnecting.`)
            clearInterval(session._limitTimer)
            sess._limitDisconnect = true
            await _telnyxApi.hangupCall(callControlId).catch(() => {})
            const lang = await _getUserLang(chatId)
            const msg = _trans('vs.callDisconnectedWalletExhausted', lang)
            if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
            return
          }
        } catch (e) { log(`[Voice] Fix #5: Mid-call billing error: ${e.message}`) }
      }
    }, 60000)

    log(`[Voice] Fix #5: Auto-routed call ${callControlId} now has REAL-TIME billing — session created, per-min timer active (${num.phoneNumber} → ${destination}, $${rate}/min, reason=${reason})`)
  } catch (e) {
    // Fatal error — fall back to deferred billing
    autoRoutedPendingBilling[callControlId] = { sipUsername, fromClean, destination, startedAt: new Date(), reason }
    setTimeout(() => { delete autoRoutedPendingBilling[callControlId] }, AUTO_ROUTE_BILLING_TTL)
    log(`[Voice] Fix #5: Real-time billing failed (${e.message}), falling back to deferred billing for ${callControlId}`)
  }
}

// Wallet rejection cooldown — caches "wallet too low" rejections by from-number.
// If rejected within cooldown, immediately reject without expensive credential lookups.
const walletRejectCooldown = {}
const WALLET_REJECT_COOLDOWN_MS = 300000 // 5 minutes (base cooldown)

// ── Escalating Wallet Cooldown ──
// Prevents abuse where users repeatedly dial despite low balance.
// Cooldown escalates: 5min → 30min → 2h after repeated hits.
// Notifications are suppressed after the first to prevent Telegram spam.
const WALLET_COOLDOWN_ESCALATION = [
  { hits: 1,  durationMs: 5 * 60 * 1000,   label: '5min' },   // 1st rejection: 5 min cooldown
  { hits: 5,  durationMs: 30 * 60 * 1000,  label: '30min' },  // 5+ rejections: 30 min cooldown
  { hits: 10, durationMs: 2 * 60 * 60 * 1000, label: '2h' },  // 10+ rejections: 2 hour cooldown
]
const WALLET_COOLDOWN_NOTIFY_MAX = 2 // Max Telegram notifications per cooldown cycle

// Low Balance Lock — when AVAILABLE balance drops below LOW_BALANCE_TRIGGER, lock
// outbound calling until the user tops up to LOW_BALANCE_RESUME. This prevents
// near-zero-balance users from spam-dialing indefinitely.
// NOTE: LOW_BALANCE_RESUME applies to a SINGLE call (bot Quick IVR + outbound SIP).
// BULK campaigns enforce their own floor via BULK_CALL_MIN_WALLET (see _index.js /
// bulk-call-service). Both default to $20. Env-overridable for ops tuning.
const LOW_BALANCE_TRIGGER = parseFloat(process.env.CALL_LOW_BALANCE_TRIGGER || '1')  // USD threshold that activates the lock
const LOW_BALANCE_RESUME = parseFloat(process.env.CALL_LOW_BALANCE_RESUME || '20')   // USD minimum required to unlock calling

// ── Concurrency Guard: per-user outbound fund reservation ──────────────────
// A single wallet balance check at dial-time cannot prevent OVER-COMMITMENT
// when many outbound calls start almost simultaneously (the 2026-07-30 chatId
// 7898648919 [BillingLeak]: ~15 rapid calls all passed the balance check while
// the wallet was still funded, then collectively cost more than the balance).
// We now reserve an estimate of each in-flight call's not-yet-billed cost and
// subtract the reserved total from the available balance when authorizing the
// NEXT call. Reservations are released at hangup (+ a TTL safety-net so a
// missed hangup event can never strand funds forever). Purely in-memory & keyed
// by callControlId — safe to lose on restart (only affects concurrent gating).
const OUTBOUND_RESERVE_MINUTES = parseFloat(process.env.OUTBOUND_RESERVE_MINUTES || '2') // est. minutes reserved per concurrent call
const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000 // 2h hard cap — auto-release stranded reservations
const _outboundReservations = {} // { [chatId]: { [callControlId]: { amount, timer } } }

function _reservedTotal(chatId) {
  const m = _outboundReservations[String(chatId)]
  if (!m) return 0
  let sum = 0
  for (const k in m) sum += (m[k]?.amount || 0)
  return sum
}
function _reserveOutbound(chatId, callControlId, amount) {
  if (!chatId || !callControlId || !(amount > 0)) return
  const cid = String(chatId)
  ;(_outboundReservations[cid] ||= {})
  // Replace any existing reservation for this call (idempotent on retries)
  _releaseOutbound(cid, callControlId)
  const timer = setTimeout(() => {
    log(`[Voice] ⏱️ Reservation TTL expired — auto-releasing $${amount.toFixed(2)} for chatId ${cid} call ${callControlId}`)
    _releaseOutbound(cid, callControlId)
  }, RESERVATION_TTL_MS)
  if (timer.unref) timer.unref()
  _outboundReservations[cid][callControlId] = { amount, timer }
  log(`[Voice] 🔒 Reserved $${amount.toFixed(2)} for chatId ${cid} call ${callControlId} (in-flight reserved total: $${_reservedTotal(cid).toFixed(2)})`)
}
function _releaseOutbound(chatId, callControlId) {
  const cid = String(chatId)
  const m = _outboundReservations[cid]
  if (!m || !m[callControlId]) return
  try { if (m[callControlId].timer) clearTimeout(m[callControlId].timer) } catch (_) { /* noop */ }
  delete m[callControlId]
  if (Object.keys(m).length === 0) delete _outboundReservations[cid]
}

// ── User Wallet Low Balance Notification System ──
// Thresholds for proactive warnings sent via Telegram bot
const USER_BALANCE_WARN = parseFloat(process.env.USER_BALANCE_WARN || '5')    // $5 — "getting low"
const USER_BALANCE_CRIT = parseFloat(process.env.USER_BALANCE_CRIT || '2')    // $2 — "critical"
const USER_BALANCE_EMPTY = parseFloat(process.env.USER_BALANCE_EMPTY || '0')  // $0 — "empty"

// ── Anti-spam design ──
// 1. Base cooldown: 24 hours per user — max 1 notification per day
// 2. Escalation bypass: If level WORSENS (warning→critical→empty), send immediately BUT max 2 escalations per 24h window
// 3. Same-level repeat: NEVER re-send same level within 24h (even if user tops up and drops again)
// 4. Post-call + periodic share same history — can't stack
// Result: Max 3 notifications per 24h absolute worst case (warning + critical + empty escalation)
const BALANCE_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000
const _balanceNotifyHistory = {}  // { chatId: { level, ts, escalationCount, windowStart } }
const LEVEL_SEVERITY = { warning: 1, critical: 2, empty: 3 }
const MAX_ESCALATIONS_PER_DAY = 2  // After 2 escalations in 24h, stop completely

// ── Forwarding-specific low-balance nudge (minutes-based, destination-aware) ──
const FORWARD_LOW_MIN_THRESHOLD = parseInt(process.env.FORWARD_LOW_MIN_THRESHOLD || '10', 10) // warn when < N min of forwarding left
const FORWARD_LOW_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6h safety re-nag gap
const _forwardLowNotifyHistory = {} // chatId -> { armed: bool, ts }

// ── FIX #9: MongoDB persistence for balance notify history ──
// Prevents mass-warning flood after redeployments by persisting anti-spam state.
let _balanceNotifyHistoryCol = null

/**
 * Load notification history from MongoDB into memory on startup.
 * Called during initVoiceService.
 */
async function _loadBalanceNotifyHistory(db) {
  try {
    _balanceNotifyHistoryCol = db.collection('balanceNotifyHistory')
    const docs = await _balanceNotifyHistoryCol.find({}).toArray()
    const now = Date.now()
    let loaded = 0
    for (const doc of docs) {
      // Only load entries still within cooldown window (skip stale ones)
      if (doc.ts && (now - doc.ts) < BALANCE_NOTIFY_COOLDOWN_MS) {
        _balanceNotifyHistory[doc._id] = {
          level: doc.level,
          ts: doc.ts,
          escalationCount: doc.escalationCount || 0,
          windowStart: doc.windowStart || doc.ts,
        }
        loaded++
      }
    }
    log(`[UserWalletMonitor] Loaded ${loaded} active notification histories from DB (${docs.length} total, ${docs.length - loaded} expired/skipped)`)
  } catch (e) {
    log(`[UserWalletMonitor] Warning: Failed to load notification history from DB: ${e.message}`)
  }
}

/**
 * Persist a single notification history entry to MongoDB.
 * Called after updating _balanceNotifyHistory[chatId].
 */
function _persistBalanceNotifyEntry(chatId, entry) {
  if (!_balanceNotifyHistoryCol) return
  _balanceNotifyHistoryCol.updateOne(
    { _id: chatId },
    { $set: { level: entry.level, ts: entry.ts, escalationCount: entry.escalationCount, windowStart: entry.windowStart } },
    { upsert: true }
  ).catch(e => log(`[UserWalletMonitor] DB persist error for ${chatId}: ${e.message}`))
}

/**
 * Post-call low balance notification — sends Telegram warning if wallet is low after billing.
 * Called after every billCallMinutesUnified charge. Deduplicates within 4h per level.
 * Includes loyalty tier info and top-up incentive.
 */
async function notifyLowBalance(chatId, phoneNumber) {
  try {
    // ⚠️ FIX: Skip group chats (negative chatIds)
    // Balance reminders should only go to individual users, not groups
    if (chatId < 0) {
      console.log(`[notifyLowBalance] Skipped group chat: ${chatId}`)
      return
    }

    const { getBalance } = require('./utils')
    const { usdBal } = await getBalance(_walletOf, chatId)
    const totalBal = usdBal

    let level = null
    let icon = ''
    let urgency = ''

    if (totalBal <= USER_BALANCE_EMPTY) {
      level = 'empty'
      icon = '🚨'
      urgency = `Your wallet is <b>empty</b>. All outbound calls and overage billing are now <b>paused</b>.`
    } else if (totalBal <= USER_BALANCE_CRIT) {
      level = 'critical'
      icon = '⚠️'
      urgency = `Your wallet is <b>critically low</b>. Calls may be disconnected mid-conversation.`
    } else if (totalBal <= USER_BALANCE_WARN) {
      level = 'warning'
      icon = '💡'
      urgency = `Your wallet balance is getting low. Top up soon to avoid call interruptions.`
    }

    if (!level) return // Balance is fine

    // ── Anti-spam gate ──
    const now = Date.now()
    const prev = _balanceNotifyHistory[chatId]
    if (prev) {
      const elapsed = now - prev.ts
      const windowElapsed = now - (prev.windowStart || prev.ts)
      // Reset 24h window if expired
      if (windowElapsed >= BALANCE_NOTIFY_COOLDOWN_MS) {
        // Fresh 24h window — allow this notification
      } else {
        const newSeverity = LEVEL_SEVERITY[level] || 0
        const prevSeverity = LEVEL_SEVERITY[prev.level] || 0
        if (newSeverity <= prevSeverity) {
          // Same or better level — skip (don't re-nag within 24h)
          return
        }
        // Escalation (worse level) — check escalation cap
        if ((prev.escalationCount || 0) >= MAX_ESCALATIONS_PER_DAY) {
          return // Hit daily escalation limit — stop completely
        }
      }
    }

    // Update history
    const windowStart = (prev && (now - (prev.windowStart || prev.ts)) < BALANCE_NOTIFY_COOLDOWN_MS)
      ? (prev.windowStart || prev.ts) : now
    const escalationCount = (prev && (now - (prev.windowStart || prev.ts)) < BALANCE_NOTIFY_COOLDOWN_MS)
      ? (prev.escalationCount || 0) + (prev.level !== level ? 1 : 0) : 0
    _balanceNotifyHistory[chatId] = { level, ts: now, escalationCount, windowStart }
    // FIX #9: Also persist post-call notification history
    _persistBalanceNotifyEntry(chatId, _balanceNotifyHistory[chatId])

    const balStr = `$${usdBal.toFixed(2)}`

    // Include loyalty tier incentive
    let tierLine = ''
    if (_loyalty && _walletOf) {
      try {
        const tier = await _loyalty.getUserTier(_walletOf, chatId)
        if (tier.discount > 0) {
          tierLine = `\n${tier.badge} Your <b>${tier.name}</b> tier gives you <b>${tier.discountPercent}% off</b> all calls & purchases!`
        } else if (tier.nextTier) {
          tierLine = `\n${tier.badge} Spend $${tier.spendToNext.toFixed(0)} more to unlock <b>${tier.nextTier.badge} ${tier.nextTier.name}</b> tier — <b>${Math.round(tier.nextTier.discount * 100)}% off</b> all calls & purchases!`
        }
      } catch (e) { /* ignore tier lookup errors */ }
    }

    const msg = [
      `${icon} <b>Low Wallet Balance</b>`,
      ``,
      `💰 Balance: <b>${balStr}</b>`,
      urgency,
      tierLine,
      ``,
      `💳 Top up via <b>👛 Wallet</b> in the bot menu.`,
    ].filter(Boolean).join('\n')

    _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    log(`[WalletNotify] ${level.toUpperCase()} alert sent to ${chatId} — balance: ${balStr}`)
  } catch (e) {
    log(`[WalletNotify] Error checking balance for ${chatId}: ${e.message}`)
  }
}

/**
 * Forwarding-specific low-balance nudge. Fires after a forwarded call is billed (and from the
 * pre-call wallet gate) when the wallet can cover fewer than FORWARD_LOW_MIN_THRESHOLD minutes
 * of forwarding at the destination's rate. De-duplicated via a falling-edge + cooldown gate so
 * the user is nudged once per low-balance episode (re-armed once they top back up).
 */
async function notifyLowForwardingBalance(chatId, phoneNumber, destinationNumber) {
  try {
    if (!_walletOf || !_bot) return
    if (chatId < 0) return // skip group chats
    const { getBalance } = require('./utils')
    const { usdBal } = await getBalance(_walletOf, chatId)
    const rate = getCallRate(destinationNumber)
    if (!(rate > 0)) return
    const minutesLeft = Math.floor(usdBal / rate)
    const hist = _forwardLowNotifyHistory[chatId] || { armed: true, ts: 0 }
    // Comfortably above the threshold → re-arm (e.g., after a top-up) and stay quiet
    if (minutesLeft > FORWARD_LOW_MIN_THRESHOLD) {
      _forwardLowNotifyHistory[chatId] = { armed: true, ts: hist.ts }
      return
    }
    const now = Date.now()
    // Only nudge on the falling edge, or after the cooldown as a safety re-nag
    if (!hist.armed && (now - (hist.ts || 0)) < FORWARD_LOW_NOTIFY_COOLDOWN_MS) return
    _forwardLowNotifyHistory[chatId] = { armed: false, ts: now }
    const lang = await _getUserLang(chatId)
    const msg = _trans('vs.lowBalanceForward', lang, usdBal.toFixed(2), minutesLeft)
    if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    log(`[Voice] Forwarding low-balance nudge to ${chatId}: ~${minutesLeft} min left ($${usdBal.toFixed(2)}, rate $${rate})`)
  } catch (e) {
    log(`[Voice] Forwarding low-balance check error: ${e.message}`)
  }
}

/**
 * Periodic user wallet monitor — scans ALL users with wallets (not just phone users)
 * and sends proactive low-balance warnings via Telegram.
 * Includes loyalty tier info and top-up incentives.
 * Runs every 6 hours. Does NOT charge anything — just warns.
 */
async function runUserWalletMonitor() {
  if (!_walletOf || !_bot) return
  const { getBalance } = require('./utils')
  log('[UserWalletMonitor] Running periodic wallet scan (all users)...')

  try {
    // Scan ALL wallets — not just phone users
    const allWallets = await _walletOf.find({}).toArray()
    let warned = 0, scanned = 0, skippedWelcomeOnly = 0

    // ── FIX: Build set of users who made real deposits (wallet-topup or admin-credit) ──
    // Welcome-bonus-only users should NOT receive low-balance warnings — they never
    // deposited real money, so nagging them to "top up" is spam, not a useful reminder.
    const db = _walletOf.s?.db || _walletOf.s?.namespace?.db
    let realDepositChatIds = new Set()
    try {
      const txnCol = (typeof db === 'object' && db.collection) ? db.collection('transactions') : null
      if (txnCol) {
        const realTxns = await txnCol.find(
          { type: { $in: ['wallet-topup', 'admin-credit'] } },
          { projection: { chatId: 1 } }
        ).toArray()
        realDepositChatIds = new Set(realTxns.map(t => String(t.chatId)))
      }
    } catch (e) {
      log(`[UserWalletMonitor] Warning: Could not load real deposits — skipping welcome-only filter: ${e.message}`)
    }

    for (const wallet of allWallets) {
      const chatId = String(wallet._id) // Ensure string for consistency
      scanned++

      try {
        // ⚠️ FIX: Skip group chats (negative chatIds)
        // Balance reminders should only go to individual users, not groups
        if (chatId < 0) {
          console.log(`[UserWalletMonitor] Skipped group chat: ${chatId}`)
          continue
        }

        const usdBal = (wallet.usdIn || 0) - (wallet.usdOut || 0)
        const totalBal = usdBal

        // Skip users who never had meaningful balance (never topped up)
        if ((wallet.usdIn || 0) < 1) continue

        // ── FIX: Skip welcome-bonus-only users ──
        // Users who only received the free welcome bonus and never deposited real money
        // should not be warned about low balance — it's spam, not a helpful reminder.
        if (realDepositChatIds.size > 0 && !realDepositChatIds.has(chatId)) {
          skippedWelcomeOnly++
          continue
        }

        let level = null
        if (totalBal <= USER_BALANCE_EMPTY) level = 'empty'
        else if (totalBal <= USER_BALANCE_CRIT) level = 'critical'
        else if (totalBal <= USER_BALANCE_WARN) level = 'warning'

        if (!level) continue

        // ── Anti-spam gate (same logic as post-call) ──
        const now = Date.now()
        const prev = _balanceNotifyHistory[chatId]
        if (prev) {
          const windowElapsed = now - (prev.windowStart || prev.ts)
          if (windowElapsed < BALANCE_NOTIFY_COOLDOWN_MS) {
            const newSeverity = LEVEL_SEVERITY[level] || 0
            const prevSeverity = LEVEL_SEVERITY[prev.level] || 0
            if (newSeverity <= prevSeverity) continue // Same or better — skip
            if ((prev.escalationCount || 0) >= MAX_ESCALATIONS_PER_DAY) continue // Hit daily cap
          }
        }

        const windowStart = (prev && (now - (prev.windowStart || prev.ts)) < BALANCE_NOTIFY_COOLDOWN_MS)
          ? (prev.windowStart || prev.ts) : now
        const escalationCount = (prev && (now - (prev.windowStart || prev.ts)) < BALANCE_NOTIFY_COOLDOWN_MS)
          ? (prev.escalationCount || 0) + (prev.level !== level ? 1 : 0) : 0
        _balanceNotifyHistory[chatId] = { level, ts: now, escalationCount, windowStart }
        // FIX #9: Persist to MongoDB so anti-spam state survives redeployments
        _persistBalanceNotifyEntry(chatId, _balanceNotifyHistory[chatId])
        const balStr = `$${usdBal.toFixed(2)}`
        const icon = level === 'empty' ? '🚨' : level === 'critical' ? '⚠️' : '💡'
        const urgency = level === 'empty'
          ? `Your wallet is <b>empty</b>. Outbound calls and overage billing are paused until you top up.`
          : level === 'critical'
            ? `Your balance is <b>critically low</b>. Active calls may be disconnected if balance runs out.`
            : `Your balance is getting low. Top up soon to avoid service interruptions.`

        // Loyalty tier incentive
        let tierLine = ''
        if (_loyalty && _walletOf) {
          try {
            const tier = await _loyalty.getUserTier(_walletOf, chatId)
            if (tier.discount > 0) {
              tierLine = `\n${tier.badge} Your <b>${tier.name}</b> tier saves you <b>${tier.discountPercent}%</b> on all calls & purchases!`
            } else if (tier.nextTier) {
              tierLine = `\n${tier.badge} Spend $${tier.spendToNext.toFixed(0)} more to unlock <b>${tier.nextTier.badge} ${tier.nextTier.name}</b> — <b>${Math.round(tier.nextTier.discount * 100)}% off</b> all calls & purchases!`
            }
          } catch (e) { /* ignore */ }
        }

        // Check if user has active phone numbers for context
        let phoneLine = ''
        if (_phoneNumbersOf) {
          try {
            const phoneData = await _phoneNumbersOf.findOne({ _id: chatId })
            const activeNums = (phoneData?.val?.numbers || []).filter(n => n.status !== 'suspended' && n.status !== 'released').map(n => n.phoneNumber)
            if (activeNums.length > 0) {
              phoneLine = `\n📞 Active numbers: ${activeNums.join(', ')}`
            }
          } catch (e) { /* ignore */ }
        }

        const msg = [
          `${icon} <b>Wallet Balance Reminder</b>`,
          ``,
          `💰 Balance: <b>${balStr}</b>`,
          phoneLine,
          ``,
          urgency,
          tierLine,
          ``,
          `💳 Top up anytime via <b>👛 Wallet</b> in the bot menu.`,
        ].filter(Boolean).join('\n')

        // Inline keyboard adds a one-tap "💰 Top Up Wallet" button, surfaced
        // for CRITICAL or EMPTY severity (balance < $1) where seconds matter
        // and the user is mid-campaign (root-caused via @johngambino
        // 2026-05-05 01:08 UTC: $0.42 balance during an active IVR campaign
        // — the existing message ended with "Top up anytime via 👛 Wallet"
        // but gave the user nothing to tap, costing both us and them.)
        const severity = level  // alias for readability and test-grep
        const replyMarkup = (severity === 'critical' || severity === 'empty')
          ? { inline_keyboard: [[{ text: '💰 Top Up Wallet', callback_data: 'wallet_topup_quick' }]] }
          : undefined
        await _bot.sendMessage(chatId, msg, {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }).catch(() => {})
        warned++
      } catch (e) { /* skip individual user errors */ }
    }

    log(`[UserWalletMonitor] Scan complete: ${scanned} wallets checked, ${warned} low-balance warnings sent, ${skippedWelcomeOnly} welcome-only users skipped`)

    // ── PRE-DIAL BLOCKLIST SCAN ──
    // After the wallet scan, identify SIP users with balance below LOW_BALANCE_TRIGGER
    // and add them to the instant-block list. This pre-populates the cache so even
    // FIRST calls from low-balance users are rejected in <1ms.
    try {
      if (_phoneNumbersOf) {
        let preDialBlocked = 0
        let preDialUnblocked = 0
        const allPhoneData = await _phoneNumbersOf.find({}).toArray()
        for (const phoneDoc of allPhoneData) {
          const chatId = String(phoneDoc._id) // Ensure string for consistency
          if (chatId < 0) continue // skip group chats
          const numbers = phoneDoc?.val?.numbers || []
          const sipCredentials = numbers.filter(n => n.telnyxSipUsername || n.sipUsername).map(n => ({
            sipUsername: n.telnyxSipUsername || n.sipUsername,
            phoneNumber: n.phoneNumber,
          }))
          if (sipCredentials.length === 0) continue

          // Get wallet balance
          try {
            const wallet = await _walletOf.findOne({ _id: chatId })
            const usdBal = (wallet?.usdIn || 0) - (wallet?.usdOut || 0)

            for (const cred of sipCredentials) {
              if (usdBal < LOW_BALANCE_TRIGGER) {
                // Below threshold → block
                if (!_sipPreDialBlocklist.has(cred.sipUsername)) {
                  addSipPreDialBlock(cred.sipUsername, chatId, 'low_balance', cred.phoneNumber)
                  preDialBlocked++
                }
              } else if (usdBal >= LOW_BALANCE_RESUME) {
                // Above resume threshold → unblock if previously blocked
                if (_sipPreDialBlocklist.has(cred.sipUsername)) {
                  removeSipPreDialBlock(cred.sipUsername)
                  preDialUnblocked++
                }
              }
            }
          } catch (e) { /* skip individual errors */ }
        }
        if (preDialBlocked > 0 || preDialUnblocked > 0) {
          log(`[UserWalletMonitor] PRE-DIAL: ${preDialBlocked} credential(s) blocked, ${preDialUnblocked} unblocked — ${_sipPreDialBlocklist.size} total in blocklist`)
        }
      }
    } catch (e) {
      log(`[UserWalletMonitor] PRE-DIAL scan error: ${e.message}`)
    }
  } catch (e) {
    log(`[UserWalletMonitor] Error: ${e.message}`)
  }
}

// Schedule periodic wallet monitor — every 6 hours
const USER_WALLET_MONITOR_INTERVAL = 6 * 60 * 60 * 1000
let _walletMonitorTimer = null
function initUserWalletMonitor() {
  // First run 2 minutes after startup
  setTimeout(() => {
    runUserWalletMonitor().catch(e => log(`[UserWalletMonitor] Startup scan error: ${e.message}`))
  }, 2 * 60 * 1000)
  // Then every 6 hours
  _walletMonitorTimer = setInterval(() => {
    runUserWalletMonitor().catch(e => log(`[UserWalletMonitor] Scheduled scan error: ${e.message}`))
  }, USER_WALLET_MONITOR_INTERVAL)
  log(`[UserWalletMonitor] Initialized — scanning every 6h (warn=$${USER_BALANCE_WARN}, crit=$${USER_BALANCE_CRIT}, empty=$${USER_BALANCE_EMPTY})`)
}

function checkSipRateLimit(sipUsername, destination) {
  const key = `${sipUsername}:${destination}`
  const now = Date.now()
  const entry = sipRateLimit[key]
  if (!entry || (now - entry.firstCallTime) > SIP_RATE_LIMIT_WINDOW) {
    sipRateLimit[key] = { count: 1, firstCallTime: now }
    return true // allowed
  }
  entry.count++
  if (entry.count > SIP_RATE_LIMIT_MAX) {
    return false // blocked
  }
  return true // allowed
}

// Check global per-user rate limit (total calls across all destinations)
function checkSipGlobalRateLimit(sipUsername) {
  const now = Date.now()
  const entry = sipGlobalRateLimit[sipUsername]
  if (!entry || (now - entry.firstCallTime) > SIP_GLOBAL_RATE_WINDOW) {
    sipGlobalRateLimit[sipUsername] = { count: 1, firstCallTime: now }
    return true // allowed
  }
  entry.count++
  if (entry.count > SIP_GLOBAL_RATE_MAX) {
    return false // blocked
  }
  return true // allowed
}

/**
 * Fix #2: Check if a user is in hard-block (escalated rate limit).
 * Returns true if the user should be silently dropped (no logging, no hangup API call).
 */
function isSipHardBlocked(key) {
  const entry = sipHardBlock[key]
  if (!entry) return false
  if (Date.now() - entry.blockedAt > HARD_BLOCK_DURATION) {
    delete sipHardBlock[key]
    log(`[Voice] Hard-block expired for ${key} (was blocked after ${entry.consecutiveHits} consecutive rate-limit hits)`)
    return false
  }
  return true
}

/**
 * Fix #2: Record a rate-limit hit. After HARD_BLOCK_THRESHOLD consecutive hits,
 * escalate to hard-block (silent drop for HARD_BLOCK_DURATION).
 */
function recordRateLimitHit(key) {
  const now = Date.now()
  const entry = sipHardBlock[key]
  if (entry && entry.blocked) return true // already hard-blocked
  if (!entry || (now - (entry.lastHitAt || 0)) > SIP_GLOBAL_RATE_WINDOW) {
    // Reset counter — gap between hits was too large
    sipHardBlock[key] = { consecutiveHits: 1, lastHitAt: now, blocked: false }
    return false
  }
  entry.consecutiveHits++
  entry.lastHitAt = now
  if (entry.consecutiveHits >= HARD_BLOCK_THRESHOLD) {
    entry.blocked = true
    entry.blockedAt = now
    log(`[Voice] 🚫 HARD-BLOCK activated for ${key} — ${entry.consecutiveHits} consecutive rate-limit hits. Silent-dropping for ${HARD_BLOCK_DURATION/1000}s`)
    return true
  }
  return false
}

// Check if a from-number was recently rejected for low wallet balance
// Returns false if expired, true if still in cooldown. Uses escalating duration.
function isWalletRejectCooldown(fromNumber) {
  const entry = walletRejectCooldown[fromNumber]
  if (!entry) return false
  // Determine effective cooldown duration based on hit count (escalation)
  const effectiveCooldown = getEscalatedCooldownMs(entry.hitCount || 1)
  if (Date.now() - entry.timestamp > effectiveCooldown) {
    delete walletRejectCooldown[fromNumber]
    return false
  }
  // Increment hit count for escalation tracking
  entry.hitCount = (entry.hitCount || 1) + 1
  entry.lastHitAt = Date.now()
  return true
}

/**
 * Get the escalated cooldown duration based on consecutive hit count
 */
function getEscalatedCooldownMs(hitCount) {
  let duration = WALLET_REJECT_COOLDOWN_MS // base: 5min
  for (const tier of WALLET_COOLDOWN_ESCALATION) {
    if (hitCount >= tier.hits) {
      duration = tier.durationMs
    }
  }
  return duration
}

/**
 * Check if we should still send Telegram notifications for this cooldown entry
 * Returns true if notification should be sent, false if suppressed
 */
function shouldSendWalletCooldownNotification(fromNumber) {
  const entry = walletRejectCooldown[fromNumber]
  if (!entry) return true
  return (entry.notifyCount || 0) < WALLET_COOLDOWN_NOTIFY_MAX
}

/**
 * Record that a notification was sent for this cooldown entry
 */
function markWalletCooldownNotified(fromNumber) {
  const entry = walletRejectCooldown[fromNumber]
  if (entry) {
    entry.notifyCount = (entry.notifyCount || 0) + 1
  }
}

// Record a wallet rejection for a from-number
function setWalletRejectCooldown(fromNumber, chatId) {
  const existing = walletRejectCooldown[fromNumber]
  walletRejectCooldown[fromNumber] = {
    timestamp: Date.now(),
    chatId,
    hitCount: existing ? (existing.hitCount || 1) + 1 : 1,
    notifyCount: existing ? (existing.notifyCount || 0) : 0,
    lastHitAt: Date.now(),
  }
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const key of Object.keys(sipRateLimit)) {
    if ((now - sipRateLimit[key].firstCallTime) > SIP_RATE_LIMIT_WINDOW * 2) {
      delete sipRateLimit[key]
    }
  }
  for (const key of Object.keys(sipGlobalRateLimit)) {
    if ((now - sipGlobalRateLimit[key].firstCallTime) > SIP_GLOBAL_RATE_WINDOW * 2) {
      delete sipGlobalRateLimit[key]
    }
  }
  for (const key of Object.keys(walletRejectCooldown)) {
    const entry = walletRejectCooldown[key]
    const effectiveCooldown = getEscalatedCooldownMs(entry.hitCount || 1)
    if ((now - entry.timestamp) > effectiveCooldown * 2) {
      delete walletRejectCooldown[key]
    }
  }

  // Fix #2: Clean expired hard-block entries
  for (const key of Object.keys(sipHardBlock)) {
    if (sipHardBlock[key].blockedAt && (now - sipHardBlock[key].blockedAt) > HARD_BLOCK_DURATION * 2) {
      delete sipHardBlock[key]
    } else if (!sipHardBlock[key].blocked && sipHardBlock[key].lastHitAt && (now - sipHardBlock[key].lastHitAt) > SIP_GLOBAL_RATE_WINDOW * 2) {
      delete sipHardBlock[key]
    }
  }

  // Clean expired test credential block entries
  for (const [key, blockedAt] of _expiredTestBlockSet) {
    if (now - blockedAt > EXPIRED_TEST_BLOCK_DURATION * 2) {
      _expiredTestBlockSet.delete(key)
    }
  }

  // Clean expired recent test credential cache entries
  for (const [key, entry] of _recentTestCredentials) {
    if (now - entry.registeredAt > RECENT_TEST_CREDENTIAL_TTL * 2) {
      _recentTestCredentials.delete(key)
    }
  }

  // ── Memory Leak Prevention: Cleanup orphaned call session stores ──
  // These stores rely on webhook events for cleanup. If webhooks are missed
  // (network glitch, server restart during active call), entries stay forever.
  // Clean up entries older than their max expected lifetime.
  // Fix #5: Reduced ACTIVE_CALL_MAX_AGE from 2h → 30min. No typical call on this
  // platform lasts 30 minutes, and the old 2h threshold let orphans accumulate to 133-140.
  const ACTIVE_CALL_MAX_AGE = 30 * 60 * 1000          // 30 minutes (was 2 hours)
  const IVR_SESSION_MAX_AGE = 15 * 60 * 1000           // 15 minutes for IVR sessions (was 30)
  const BRIDGE_TRANSFER_MAX_AGE = 30 * 60 * 1000       // 30 minutes for bridge transfers (was 1h)
  const HOLD_TRANSFER_MAX_AGE = 5 * 60 * 1000          // 5 minutes for pending hold transfers (was 10)
  const NATIVE_TRANSFER_MAX_AGE = 5 * 60 * 1000        // 5 minutes for native transfers (was 10)

  let cleaned = 0

  // activeCalls: each entry has startedAt timestamp
  for (const key of Object.keys(activeCalls)) {
    const entry = activeCalls[key]
    if (entry?.startedAt && (now - new Date(entry.startedAt).getTime()) > ACTIVE_CALL_MAX_AGE) {
      if (entry._limitTimer) clearInterval(entry._limitTimer)
      delete activeCalls[key]
      cleaned++
    }
  }

  // outboundIvrCalls: each entry has startTime (Date.now()) or startedAt or createdAt
  for (const key of Object.keys(outboundIvrCalls)) {
    const entry = outboundIvrCalls[key]
    const ts = entry?.startedAt || entry?.createdAt || entry?.startTime
    if (ts && (now - (ts instanceof Date ? ts.getTime() : ts)) > IVR_SESSION_MAX_AGE) {
      if (entry._limitTimer) clearInterval(entry._limitTimer)
      delete outboundIvrCalls[key]
      cleaned++
    }
  }

  // twilioIvrSessions: check for startTime, createdAt or startedAt
  for (const key of Object.keys(twilioIvrSessions)) {
    const entry = twilioIvrSessions[key]
    const ts = entry?.createdAt || entry?.startedAt || entry?.startTime
    if (ts && (now - (ts instanceof Date ? ts.getTime() : ts)) > IVR_SESSION_MAX_AGE) {
      delete twilioIvrSessions[key]
      cleaned++
    }
  }

  // pendingHoldTransfers: short-lived, clean aggressively
  for (const key of Object.keys(pendingHoldTransfers)) {
    const entry = pendingHoldTransfers[key]
    const ts = entry?.createdAt
    if (ts && (now - new Date(ts).getTime()) > HOLD_TRANSFER_MAX_AGE) {
      delete pendingHoldTransfers[key]
      cleaned++
    }
  }

  // activeBridgeTransfers: check startedAt or createdAt
  for (const key of Object.keys(activeBridgeTransfers)) {
    const entry = activeBridgeTransfers[key]
    const ts = entry?.startedAt || entry?.createdAt
    if (ts && (now - new Date(ts).getTime()) > BRIDGE_TRANSFER_MAX_AGE) {
      delete activeBridgeTransfers[key]
      cleaned++
    }
  }

  // pendingNativeTransfers: short-lived
  for (const key of Object.keys(pendingNativeTransfers)) {
    const entry = pendingNativeTransfers[key]
    const ts = entry?.createdAt || entry?.initiatedAt
    if (ts && (now - (ts instanceof Date ? ts.getTime() : ts)) > NATIVE_TRANSFER_MAX_AGE) {
      if (entry._timeout) clearTimeout(entry._timeout)
      delete pendingNativeTransfers[key]
      cleaned++
    }
  }

  // ivrTransferLegs: check for timeout or age
  for (const key of Object.keys(ivrTransferLegs)) {
    const entry = ivrTransferLegs[key]
    const ts = entry?.createdAt || entry?.startedAt || entry?.startTime
    if (ts && (now - (ts instanceof Date ? ts.getTime() : ts)) > IVR_SESSION_MAX_AGE) {
      if (entry._transferTimeout) clearTimeout(entry._transferTimeout)
      delete ivrTransferLegs[key]
      cleaned++
    }
  }

  if (cleaned > 0) {
    log(`[Voice] Memory cleanup: removed ${cleaned} orphaned session(s). Current: activeCalls=${Object.keys(activeCalls).length}, outboundIvr=${Object.keys(outboundIvrCalls).length}, twilioIvr=${Object.keys(twilioIvrSessions).length}, bridges=${Object.keys(activeBridgeTransfers).length}`)
  }
}, 60000) // Fix #5: Run cleanup every 60s (was 300s/5min) — reduces orphan accumulation

/**
 * Twilio direct call fallback — used when Telnyx SIP transfer fails
 * (e.g., auto-routing race condition killed the call before transfer).
 * Creates a fresh outbound call via Twilio REST API.
 */
// A bridge that cannot be established is abandoned WITHOUT any fallback PSTN call. The old "Twilio direct
// call" fallback dialled the destination after the SIP caller was already gone → unbillable ghost calls
// (prod audit 2026-09-16: 32/week, 4 answered by real people).
async function _abandonBridge({ chatId, num, destination, bridgeId, callControlId, reason, notify = true }) {
  log(`[Voice] Outbound SIP (Twilio): bridge abandoned — ${reason}. ${num.phoneNumber} → ${destination}. No fallback call placed.`)
  if (bridgeId) delete pendingBridges[bridgeId]
  if (!notify) return
  await _telnyxApi.hangupCall(callControlId).catch(() => {})
  _releaseOutbound(chatId, callControlId)
  const lang = await _getUserLang(chatId)
  const msg = _trans('vs.outboundCallFailedRouting', lang, formatPhone(num.phoneNumber), formatPhone(destination))
  if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
}

function initVoiceService(deps) {
  _bot = deps.bot
  _phoneNumbersOf = deps.phoneNumbersOf
  _phoneLogs = deps.phoneLogs
  _telnyxApi = deps.telnyxApi
  _telnyxResources = deps.telnyxResources
  _translation = deps.translation
  _ivrAnalytics = deps.ivrAnalytics
  _walletOf = deps.walletOf
  _payments = deps.payments
  _nanoid = deps.nanoid
  _twilioSipDomain = deps.twilioSipDomainName || null
  _selfUrl = deps.selfUrl || null
  _twilioService = deps.twilioService || null
  _state = deps.state || null
  _loyalty = deps.loyalty || null
  _testOutboundSipMatch = deps.testOutboundSipMatch || null
  _notifyAdmin = deps.notifyAdmin || null

  // FIX #9: Load persisted notification history from MongoDB to prevent mass-warning on deploy
  if (deps.db) {
    _db = deps.db
    _loadBalanceNotifyHistory(deps.db).catch(e => log(`[VoiceService] Failed to load balance history: ${e.message}`))
    // Call-session persistence — survive blue/green cutovers & crashes (see call-session-store.js).
    callSessionStore.init(deps.db).then(ok => {
      if (!ok) return
      callSessionStore.loadAll(_callSessionStores).catch(e => log(`[VoiceService] call-session warm-load failed: ${e.message}`))
      if (!_callSessionSnapshotTimer) {
        _callSessionSnapshotTimer = setInterval(() => {
          try { callSessionStore.snapshot(_callSessionStores) } catch (_) { /* noop */ }
        }, CALL_SESSION_SNAPSHOT_MS)
        if (_callSessionSnapshotTimer.unref) _callSessionSnapshotTimer.unref()
      }
    }).catch(e => log(`[VoiceService] call-session-store init failed: ${e.message}`))
  }

  // PRE-DIAL: Load blocklist from DB + run initial scan after a delay
  setTimeout(() => {
    _loadSipPreDialBlocklist().catch(e => log(`[VoiceService] Failed to load pre-dial blocklist: ${e.message}`))
  }, 5000)

  log('[VoiceService] Initialized with IVR + Recording + Analytics + Limits + Overage billing + SIP Bridge + Twilio IVR + Loyalty Discounts + Pre-Dial Prevention')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// USAGE LIMIT HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Check if a phone number is US or Canada (+1 prefix)
 */
function isUSCanada(phoneNumber) {
  const clean = (phoneNumber || '').replace(/[^+\d]/g, '')
  return clean.startsWith('+1')
}

/**
 * Get per-minute overage rate based on destination country
 * US/Canada (+1): OVERAGE_RATE_MIN ($0.15)
 * International: CALL_FORWARDING_RATE_MIN ($0.50)
 */
function getCallRate(destinationNumber) {
  // High-cost destinations (satellite/premium blocked → recovery rate; expensive
  // prefixes → cost×markup surcharge). null for standard → apply US/CA vs intl below.
  const hc = dialGuard.getHighCostRate(destinationNumber)
  if (hc != null) return hc
  return isUSCanada(destinationNumber) ? OVERAGE_RATE_MIN : CALL_FORWARDING_RATE_MIN
}

// ── IVR outbound base rate (same as bulk IVR) — plan minutes are for inbound only ──
const IVR_CALL_RATE = parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15')
const IVR_CALL_TYPES = ['IVR_Outbound', 'IVR_Transfer', 'IVR_Outbound_Twilio']

/**
 * Per-minute rate for Quick IVR / Bulk IVR product legs (IVR_Outbound + IVR_Transfer).
 * Policy (user directive 2026-08-07): US/Canada (+1) = the IVR flat rate ($0.15/min);
 * INTERNATIONAL (non-US/CA) = the $0.50/min forwarding rate — an international IVR leg is a
 * real international outbound PSTN cost. Applied identically on Telnyx & Twilio (parity).
 */
function getIvrCallRate(destinationNumber) {
  // High-cost destinations override the flat IVR rate (satellite/premium → recovery;
  // expensive prefixes → cost×markup surcharge). null for standard → US/CA vs intl below.
  const hc = dialGuard.getHighCostRate(destinationNumber)
  if (hc != null) return hc
  return isUSCanada(destinationNumber) ? IVR_CALL_RATE : CALL_FORWARDING_RATE_MIN
}

function getMinuteLimit(planKey) {
  const plan = plans[planKey]
  if (!plan) return 0
  if (plan.minutes === 'Unlimited') return Infinity
  return plan.minutes || 0
}

function getSmsLimit(planKey) {
  const plan = plans[planKey]
  if (!plan) return 0
  return plan.sms || 0
}

function isMinuteLimitReached(num) {
  const limit = getMinuteLimit(num.plan)
  if (limit === Infinity) return false
  const used = num.minutesUsed || 0
  return used >= limit
}

function isSmsLimitReached(num) {
  const limit = getSmsLimit(num.plan)
  const used = num.smsUsed || 0
  return used >= limit
}

// Atomically increment minutesUsed for a phone number in DB
async function incrementMinutesUsed(chatId, phoneNumber, minutes) {
  try {
    // BUGFIX: Use MongoDB atomic $inc to prevent race conditions.
    // Previous approach: read numbers → modify minutesUsed → write back entire array
    // This caused concurrent IVR/forwarding setting changes to be overwritten.
    // Now: atomically increment minutesUsed on the specific array element, then read back.
    await _phoneNumbersOf.updateOne(
      { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
      { $inc: { 'val.numbers.$.minutesUsed': minutes } }
    )

    // Read back updated state for billing calculations
    const userData = await get(_phoneNumbersOf, chatId)
    const numbers = userData?.numbers || []
    const num = numbers.find(n => n.phoneNumber === phoneNumber)
    if (!num) return { used: 0, limit: 0, overageMinutes: 0 }

    const used = num.minutesUsed || 0
    const limit = getMinuteLimit(num.plan)

    if (limit !== Infinity && used >= limit && !num._minLimitNotified) {
      // Atomically set the notification flag — no array overwrite
      await _phoneNumbersOf.updateOne(
        { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
        { $set: { 'val.numbers.$._minLimitNotified': true } }
      )
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.planMinutesExhausted', lang, formatPhone(phoneNumber), used, limit)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }

    const overageMinutes = limit !== Infinity ? Math.max(0, used - limit) : 0
    return { used, limit, overageMinutes }
  } catch (e) {
    log(`[Voice] incrementMinutesUsed error: ${e.message}`)
    return { used: 0, limit: 0, overageMinutes: 0 }
  }
}

/**
 * Unified billing: Plan minutes first → wallet overage at destination-based rate
 * Works for ALL call types: inbound, forwarded, SIP outbound, IVR outbound, IVR transfer
 *
 * @param {string} chatId - User's chat ID
 * @param {string} phoneNumber - User's phone number (plan minutes are tracked here)
 * @param {number} minutesBilled - Minutes to bill
 * @param {string} destinationNumber - The remote party number (determines overage rate)
 * @param {string} callType - Label for payment logs (e.g. 'Inbound', 'Forwarding', 'SIPOutbound', 'IVR_Outbound', 'IVR_Transfer')
 * @returns {{ planMinUsed: number, overageMin: number, overageCharge: number, rate: number }}
 */
// ━━━ Outbound call types: charge wallet directly, do NOT use plan minutes ━━━
const OUTBOUND_CALL_TYPES = [
  'SIPOutbound', 'Forwarding', 'Bridge_Transfer',
  'IVR_Outbound', 'IVR_Transfer',
  'IVR_Outbound_Twilio', 'Twilio_SIP_Bridge', 'Twilio_SIP_Outbound', 'Twilio_Forwarding',
  'Telnyx_SIP_Leg', 'AutoRoute_SIPOutbound',
]

async function billCallMinutesUnified(chatId, phoneNumber, minutesBilled, destinationNumber, callType, callRef = null) {
  if (minutesBilled <= 0) return { planMinUsed: 0, overageMin: 0, overageCharge: 0, rate: 0, used: 0, limit: 0 }

  // IVR product legs: US/CA at flat IVR rate, INTERNATIONAL at the $0.50 forwarding rate
  // (user policy 2026-08-07). Non-IVR legs: destination-based rate (getCallRate).
  let baseRate = IVR_CALL_TYPES.includes(callType) ? getIvrCallRate(destinationNumber) : getCallRate(destinationNumber)
  const isOutbound = OUTBOUND_CALL_TYPES.includes(callType)

  // ━━━ LOYALTY TIER DISCOUNT — applies to all call billing ━━━
  let loyaltyDiscount = 0
  let tierInfo = null
  let rate = baseRate
  if (_loyalty && _walletOf) {
    try {
      tierInfo = await _loyalty.getUserTier(_walletOf, chatId)
      if (tierInfo && tierInfo.discount > 0) {
        loyaltyDiscount = tierInfo.discount
        rate = +(baseRate * (1 - loyaltyDiscount)).toFixed(4)
        log(`[Voice] Loyalty discount: ${tierInfo.badge} ${tierInfo.name} (${tierInfo.discountPercent}% off) — rate $${baseRate} → $${rate} for ${callType}`)
      }
    } catch (e) { log(`[Voice] Loyalty tier lookup error: ${e.message}`) }
  }
  const discountLine = tierInfo && loyaltyDiscount > 0
    ? `\n${tierInfo.badge} <b>${tierInfo.name} ${tierInfo.discountPercent}% off</b> applied`
    : ''

  // ━━━ OUTBOUND: Charge wallet directly — plan minutes are for inbound only ━━━
  if (isOutbound) {
    const totalCharge = +(minutesBilled * rate).toFixed(4)
    try {
      if (_walletOf) {
        const deductResult = await smartWalletDeduct(_walletOf, chatId, totalCharge, {
          type: 'outbound_call', callType,
          description: `Outbound ${callType}: ${phoneNumber} → ${destinationNumber} (${minutesBilled} min × $${rate})`,
          destination: destinationNumber, phoneNumber,
          callRef, // idempotency key — duplicate webhooks for same callRef will no-op
        })
        if (deductResult.success) {
          if (deductResult.idempotent) {
            log(`[Voice] Outbound idempotent: $${totalCharge.toFixed(2)} for ${callType} (${callRef}) already billed — skipping notifications`)
            return { planMinUsed: 0, overageMin: minutesBilled, overageCharge: totalCharge, rate, used: 0, limit: 0, idempotent: true }
          }
          const ref = _nanoid?.() || `out_${callType}_${Date.now()}`
          const chargedStr = deductResult.currency === 'ngn' ? `₦${deductResult.chargedNgn}` : `$${totalCharge.toFixed(2)}`
          if (_payments) set(_payments, ref, `Outbound,${callType},$${totalCharge.toFixed(2)},${chatId},${phoneNumber},${destinationNumber},${new Date()}${deductResult.currency === 'ngn' ? `,${deductResult.chargedNgn} NGN` : ''},loyaltyDiscount=${loyaltyDiscount}`)
          log(`[Voice] Outbound billed: ${chargedStr} (${minutesBilled} min × $${rate} ${isUSCanada(destinationNumber) ? 'US/CA' : 'Intl'}) for ${callType}`)
          const lang = await _getUserLang(chatId)
          const region = isUSCanada(destinationNumber) ? 'US/CA' : 'International'
          const msg = _trans('vs.callTypeCharge', lang, callType, minutesBilled, rate, chargedStr, region, discountLine)
          if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        } else {
          // ── Hard-fail path REPLACED (2026-07-31 BillingLeak fix): ──
          // smartWalletDeduct is atomic-conditional and silently no-ops when the
          // wallet can't cover an ALREADY-CONNECTED outbound call — the call was
          // delivered but $0 was billed, permanently LOSING the revenue. This is
          // exactly the [BillingLeak] alerts seen for chatId 7898648919 on
          // 2026-07-30 (rapid concurrent dialing drained the wallet below the
          // per-call cost, so the deferred settlement for the last few calls
          // failed). There is NO owedUsd-recovery anywhere, so those rows were a
          // true loss.
          //
          // The service is already rendered, so it MUST be billed. We now
          // FORCE-SETTLE the charge as recoverable debt (balance may go
          // negative), mirroring the retroactive-ivr-billing precedent. The debt
          // nets out on the user's next deposit (balance = usdIn - usdOut), and
          // the LOW_BALANCE_LOCK (<$1) already blocks fresh calls while negative,
          // so this cannot be abused to accumulate unbounded debt. Idempotent via
          // callRef → duplicate hangup webhooks never double-charge.
          const debtResult = await forceWalletDebit(_walletOf, chatId, totalCharge, {
            type: 'outbound_call', callType,
            description: `Outbound ${callType} (settled as debt): ${phoneNumber} → ${destinationNumber} (${minutesBilled} min × $${rate})`,
            destination: destinationNumber, phoneNumber,
            callRef,
          })
          if (debtResult.idempotent) {
            log(`[Voice] Outbound debt-settle idempotent: $${totalCharge.toFixed(2)} for ${callType} (${callRef}) already billed — skipping`)
            return { planMinUsed: 0, overageMin: minutesBilled, overageCharge: totalCharge, rate, used: 0, limit: 0, idempotent: true }
          }
          const newBal = debtResult.balanceAfter || 0
          log(`[Voice] ⚠️ Outbound charge FORCE-SETTLED as debt: $${totalCharge.toFixed(2)} for ${callType} — service delivered, balance now $${newBal.toFixed(2)} (recovered on next top-up)`)
          if (_payments) {
            const ref = _nanoid?.() || `debt_${callType}_${Date.now()}`
            set(_payments, ref, `Outbound,${callType},$${totalCharge.toFixed(2)},${chatId},${phoneNumber},${destinationNumber},${new Date()},settledAsDebt=true`)
          }
          try {
            const lang = await _getUserLang(chatId)
            const dmMsg = ({
              en: `⚠️ <b>Outbound call charged — wallet now negative</b>\n\n📞 ${phoneNumber} → ${destinationNumber} (${minutesBilled} min, $${totalCharge.toFixed(2)})\n💳 Balance: <b>$${newBal.toFixed(2)}</b>\n\nThis charge was applied on credit. Top up your wallet to clear it — further outbound calls are locked until your balance is positive.`,
              fr: `⚠️ <b>Appel sortant facturé — solde négatif</b>\n\n📞 ${phoneNumber} → ${destinationNumber} (${minutesBilled} min, $${totalCharge.toFixed(2)})\n💳 Solde: <b>$${newBal.toFixed(2)}</b>\n\nRechargez votre portefeuille pour régler ce montant — les appels sortants sont bloqués tant que le solde est négatif.`,
              zh: `⚠️ <b>拨出电话已计费 — 钱包余额为负</b>\n\n📞 ${phoneNumber} → ${destinationNumber}（${minutesBilled} 分钟，$${totalCharge.toFixed(2)}）\n💳 余额: <b>$${newBal.toFixed(2)}</b>\n\n此费用以信用方式扣除。请充值以结清，余额为负时拨出电话将被锁定。`,
              hi: `⚠️ <b>आउटबाउंड कॉल शुल्क लिया गया — वॉलेट अब ऋणात्मक</b>\n\n📞 ${phoneNumber} → ${destinationNumber} (${minutesBilled} मिनट, $${totalCharge.toFixed(2)})\n💳 शेष: <b>$${newBal.toFixed(2)}</b>\n\nयह शुल्क उधार पर लिया गया। इसे चुकाने के लिए टॉप-अप करें — शेष ऋणात्मक रहने तक आउटबाउंड कॉल लॉक रहेंगी।`,
            }[lang] || `⚠️ <b>Outbound call charged — wallet now negative</b>\n\n📞 ${phoneNumber} → ${destinationNumber} (${minutesBilled} min, $${totalCharge.toFixed(2)})\n💳 Balance: <b>$${newBal.toFixed(2)}</b>\n\nTop up your wallet to clear it — outbound calls are locked until your balance is positive.`)
            _bot?.sendMessage(chatId, dmMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Top Up Now', callback_data: 'wallet_topup_quick' }]] } }).catch(() => {})
          } catch (_) { /* noop */ }
          if (_notifyAdmin) {
            _notifyAdmin(`💸 [BillingRecovered] $${totalCharge.toFixed(2)} ${callType} settled as DEBT (was a leak)\nchatId: <code>${chatId}</code>\n${phoneNumber} → ${destinationNumber}\nminutes: ${minutesBilled} · rate: $${rate}\nbalance now: $${newBal.toFixed(2)} (recovers on next top-up)`).catch(() => {})
          }
        }
      }
    } catch (e) { log(`[Voice] Outbound charge error: ${e.message}`) }
    return { planMinUsed: 0, overageMin: minutesBilled, overageCharge: totalCharge, rate, used: 0, limit: 0 }
  }

  // ━━━ INBOUND: Use plan minutes first, then overage from wallet ━━━
  // Step 1: Increment plan minutes
  const { used, limit, overageMinutes } = await incrementMinutesUsed(chatId, phoneNumber, minutesBilled)

  // Step 2: If there are overage minutes, charge wallet at discounted rate
  let overageCharge = 0
  if (overageMinutes > 0 && _walletOf) {
    const previousUsed = used - minutesBilled
    const previousOverage = limit !== Infinity ? Math.max(0, previousUsed - limit) : 0
    const newOverageMin = overageMinutes - previousOverage
    if (newOverageMin > 0) {
      overageCharge = newOverageMin * rate
      try {
        const deductResult = await smartWalletDeduct(_walletOf, chatId, overageCharge, {
          type: 'overage_charge', callType,
          description: `Overage ${callType}: ${phoneNumber} → ${destinationNumber} (${newOverageMin} min × $${rate})`,
          destination: destinationNumber, phoneNumber,
        })
        if (deductResult.success) {
          const ref = _nanoid?.() || `ov_${callType}_${Date.now()}`
          const chargedStr = deductResult.currency === 'ngn' ? `₦${deductResult.chargedNgn}` : `$${overageCharge.toFixed(2)}`
          if (_payments) set(_payments, ref, `Overage,${callType},$${overageCharge.toFixed(2)},${chatId},${phoneNumber},${destinationNumber},${new Date()}${deductResult.currency === 'ngn' ? `,${deductResult.chargedNgn} NGN` : ''},loyaltyDiscount=${loyaltyDiscount}`)
          log(`[Voice] Overage billed: ${chargedStr} (${newOverageMin} min × $${rate} ${isUSCanada(destinationNumber) ? 'US/CA' : 'Intl'}) for ${callType}`)
          const lang = await _getUserLang(chatId)
          const region = isUSCanada(destinationNumber) ? 'US/CA' : 'International'
          const msg = _trans('vs.overageCharge', lang, newOverageMin, rate, chargedStr, region, discountLine)
          if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        }
      } catch (e) { log(`[Voice] Overage charge error: ${e.message}`) }
    }
  }

  const planMinUsed = minutesBilled - (overageMinutes > 0 ? Math.min(minutesBilled, overageMinutes) : 0)
  log(`[Voice] Billed ${callType}: ${minutesBilled} min (${planMinUsed} plan + ${minutesBilled - planMinUsed} overage @ $${rate}) for ${phoneNumber}`)

  // ── Post-call low balance warning ──
  // After every billable call, check remaining wallet and warn user if getting low
  if (_walletOf && _bot) {
    notifyLowBalance(chatId, phoneNumber).catch(() => {})
    // Forwarding-specific proactive nudge — warn before the wallet can no longer cover forwards
    if (callType === 'Forwarding' || callType === 'Bridge_Transfer') {
      notifyLowForwardingBalance(chatId, phoneNumber, destinationNumber).catch(() => {})
    }
  }

  return { planMinUsed, overageMin: minutesBilled - planMinUsed, overageCharge, rate, used, limit }
}

// Atomically increment smsUsed for a phone number in DB
async function incrementSmsUsed(chatId, phoneNumber) {
  try {
    // BUGFIX: Use MongoDB atomic $inc to prevent race conditions.
    // Same fix as incrementMinutesUsed — avoid read-modify-write that overwrites concurrent changes.
    await _phoneNumbersOf.updateOne(
      { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
      { $inc: { 'val.numbers.$.smsUsed': 1 } }
    )

    // Read back to check limits
    const userData = await get(_phoneNumbersOf, chatId)
    const numbers = userData?.numbers || []
    const num = numbers.find(n => n.phoneNumber === phoneNumber)
    if (!num) return

    const limit = getSmsLimit(num.plan)
    const used = num.smsUsed || 0
    if (used >= limit && !num._smsLimitNotified) {
      await _phoneNumbersOf.updateOne(
        { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
        { $set: { 'val.numbers.$._smsLimitNotified': true } }
      )
      const msg = `⚠️ <b>Plan SMS Exhausted</b>\n\n📞 ${formatPhone(phoneNumber)}\nUsed: <b>${used}/${limit}</b> inbound SMS this cycle.\n\nOverage billing is now active at <b>$${OVERAGE_RATE_SMS}/SMS</b> from your wallet. Service pauses if wallet is empty. Top up or upgrade your plan.`
      _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }
  } catch (e) {
    log(`[Voice] incrementSmsUsed error: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WEBHOOK HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Hold music URL — soft jazz instrumental loop (no voice, TTS handles announcement separately)
const HOLD_MUSIC_URL = `${process.env.SELF_URL || process.env.SELF_URL_PROD || ''}/assets/hold-music-jazz.mp3?v=1`
const RINGBACK_URL = `${process.env.SELF_URL || process.env.SELF_URL_PROD || ''}/assets/us-ringback.wav?v=1`

/**
 * Play hold music to the caller, then transfer.
 * Flow: Start hold music loop → wait for Telnyx to buffer → transfer call
 * The hold music keeps playing until the transfer target answers and calls are bridged.
 *
 * Note: speakOnCall + playbackStart conflict in Telnyx (can't overlay by default).
 * Using playbackStart alone is reliable — music signals "please wait" to the caller.
 *
 * @param {string} callControlId - Active call to play hold music on
 * @param {string} forwardTo - Number to transfer to
 * @param {string} fromNumber - Caller ID for the transfer
 * @param {object} config - { holdMusic: true/false }
 */
// Pending hold-music transfers: callControlId → { forwardTo, fromNumber }
// Used to defer the transfer until after the TTS announcement finishes
const pendingHoldTransfers = {}

// Active bridge transfers: originalCallControlId → { transferCallControlId, forwardTo, fromNumber }
// Used to track the two-leg bridge approach for hold music during transfer
const activeBridgeTransfers = {}

// Track pending non-hold-music transfers: callControlId → { forwardTo, initiatedAt }
// Used to detect when a native transferCall target didn't answer
const pendingNativeTransfers = {}

async function playHoldMusicAndTransfer(callControlId, forwardTo, fromNumber, config) {
  // ── Self-call prevention: reject forwarding to own number or caller's number ──
  const session = activeCalls[callControlId]
  if (session) {
    const ownNumber = (session.to || '').replace(/[^+\d]/g, '')
    const callerNumber = (fromNumber || '').replace(/[^+\d]/g, '')
    const targetNumber = (forwardTo || '').replace(/[^+\d]/g, '')
    if (targetNumber && (targetNumber === ownNumber || targetNumber === callerNumber)) {
      log(`[Voice] ❌ Self-call loop blocked: cannot forward ${ownNumber} to ${targetNumber}`)
      await _telnyxApi.speakOnCall(callControlId, 'Sorry, call forwarding to your own number is not allowed. Goodbye.').catch(() => {})
      setTimeout(() => _telnyxApi.hangupCall(callControlId).catch(() => {}), 3000)
      if (session.chatId) {
        _bot?.sendMessage(session.chatId,
          `📞 <b>Self-Call Loop Blocked</b>\n❌ Cannot forward to ${forwardTo} (same number).\n💡 Update your forwarding settings.`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
      }
      return
    }
  }
  const useHoldMusic = config?.holdMusic === true

  if (useHoldMusic) {
    // Two-phase approach:
    // Phase 1: Speak TTS announcement
    // Phase 2 (on speak.ended): Start hold music + create outbound call to destination
    // Phase 3 (on destination answered): Bridge the two calls (stops music automatically)
    pendingHoldTransfers[callControlId] = { forwardTo, fromNumber, createdAt: new Date() }
    // Safety: clean up if speak.ended never fires (10s timeout — TTS is ~3-4s)
    setTimeout(() => {
      if (pendingHoldTransfers[callControlId]) {
        log(`[Voice] Stale pendingHoldTransfer cleanup for ${callControlId} — speak.ended never arrived`)
        delete pendingHoldTransfers[callControlId]
      }
    }, 10000)
    log(`[Voice] Speaking hold announcement for ${callControlId}, will bridge-transfer to ${forwardTo}`)
    await _telnyxApi.speakOnCall(callControlId, 'Please hold while your call is being transferred.')
  } else {
    // Track native transfer for timeout/no-answer detection
    pendingNativeTransfers[callControlId] = {
      forwardTo,
      fromNumber,
      initiatedAt: Date.now(),
      connected: false,
    }
    // Safety timeout: if native transfer doesn't connect in 35s, mark as timed out
    // (Telnyx will hang up both legs, but we track it for accurate notification)
    const transferTimeout = setTimeout(() => {
      const transfer = pendingNativeTransfers[callControlId]
      if (transfer && !transfer.connected) {
        transfer.timedOut = true
        log(`[Voice] Native transfer timeout: ${forwardTo} didn't answer in 35s (call: ${callControlId})`)
      }
    }, 35000)
    pendingNativeTransfers[callControlId]._timeout = transferTimeout

    await _telnyxApi.transferCall(callControlId, forwardTo, fromNumber)
  }
}

// ── Bridge Transfer Handlers ──
// When the outbound leg (to transfer destination) answers, bridge it with the original leg
async function handleBridgeTransferAnswered(payload) {
  const callControlId = payload.call_control_id
  const transfer = activeBridgeTransfers[callControlId]
  if (!transfer) return false

  log(`[Voice] Bridge transfer destination answered: ${transfer.forwardTo}, bridging with original call`)

  // If original inbound call hasn't been answered yet (SIP ring without auto-answer),
  // answer it now before bridging
  if (transfer.unanswered) {
    try {
      await _telnyxApi.answerCall(transfer.originalCallControlId)
      transfer.unanswered = false
      log(`[Voice] Answered original inbound call for SIP bridge`)
    } catch (e) {
      log(`[Voice] Failed to answer original call for bridge: ${e.message}`)
      await _telnyxApi.hangupCall(callControlId).catch(() => {})
      delete activeBridgeTransfers[callControlId]
      return true
    }
  }

  // Stop hold music/ringback on original leg and bridge the two calls
  await _telnyxApi.playbackStop(transfer.originalCallControlId).catch(() => {})
  await _telnyxApi.bridgeCalls(transfer.originalCallControlId, callControlId)

  transfer.phase = 'bridged'
  transfer.bridgeTime = Date.now()

  // LEAK sweeper coverage (2026-08-07): record a durable pending-bill row for this Telnyx
  // bridge/transfer leg, keyed by the EXACT callRef handleBridgeTransferHangup bills under
  // (telnyx_<callControlId>, Bridge_Transfer). If that hangup callback is dropped, the
  // reconciler DETECTS it (needs_review + admin alert). Telnyx legs are NOT auto-settled:
  // Telnyx reports 0s for bridged legs, so the true duration (tracked locally via bridgeTime)
  // cannot be reconstructed server-side after a missed callback. Scoped to non-trial, billable
  // sessions — mirrors the billing guard in handleBridgeTransferHangup.
  try {
    const _ps = outboundIvrCalls[transfer.originalCallControlId] || activeCalls[transfer.originalCallControlId]
    if (_ps && !_ps.isTrial) {
      const _reconciler = require('./call-billing-reconciler.js')
      _reconciler.recordPendingBill({
        callRef: `telnyx_${callControlId}`,
        chatId: _ps.chatId != null ? String(_ps.chatId) : null,
        phoneNumber: _ps.callerId || _ps.num?.phoneNumber || null,
        destination: transfer.forwardTo,
        callType: 'Bridge_Transfer',
        provider: 'telnyx',
      }).catch(() => {})
    }
  } catch (_) { /* never break the bridge path */ }
  const MAX_BRIDGE_MINUTES = 10
  transfer._bridgeTimeout = setTimeout(async () => {
    const t = activeBridgeTransfers[callControlId]
    if (t && t.phase === 'bridged') {
      log(`[Voice] Bridge safety timeout: ${transfer.forwardTo} exceeded ${MAX_BRIDGE_MINUTES} min — disconnecting`)
      await _telnyxApi.hangupCall(callControlId).catch(() => {})
      // handleBridgeTransferHangup will clean up the original leg
    }
  }, MAX_BRIDGE_MINUTES * 60 * 1000)

  // Notify bot user
  const parentSession = outboundIvrCalls[transfer.originalCallControlId] || activeCalls[transfer.originalCallControlId]
  if (parentSession) {
    parentSession.transferConnected = true
    const chatId = String(parentSession.chatId) // Ensure string for consistency
    const msg = transfer.type === 'sip_ring'
      ? `✅ <b>SIP Call Connected</b>\nIncoming call bridged to your device`
      : `✅ <b>Transfer Connected</b>\n📞 ${transfer.forwardTo} connected`
    _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
  }
  return true
}

// When either leg of a bridge transfer hangs up, clean up and ensure other leg disconnects

  // Calculate transfer leg duration from when destination answered (bridgeTime) to now
// Bill the transfer leg's connected time (original leg billing is separate in handleOutboundIvrHangup)
async function handleBridgeTransferHangup(payload) {
  const callControlId = payload.call_control_id
  const transfer = activeBridgeTransfers[callControlId]
  if (!transfer) return false

  // Mark as ended to prevent race conditions
  markCallEnded(callControlId)

  const hangupCause = payload.hangup_cause || 'unknown'

  // Clear bridge safety timeout if set
  if (transfer._bridgeTimeout) clearTimeout(transfer._bridgeTimeout)
  // Telnyx reports 0s for bridged legs, so we track it ourselves
  const transferDuration = transfer.bridgeTime ? Math.round((Date.now() - transfer.bridgeTime) / 1000) : 0
  const transferMinutes = transferDuration > 0 ? Math.ceil(transferDuration / 60) : 0

  log(`[Voice] Bridge transfer leg hangup: ${transfer.forwardTo} (${transferDuration}s = ${transferMinutes} min, cause: ${hangupCause})`)

  // Bill the transfer leg's minutes (this is a separate outbound call to the destination)
  if (transferMinutes > 0 && transfer.phase === 'bridged') {
    // Check both outboundIvrCalls and activeCalls for the parent session
    const parentSession = outboundIvrCalls[transfer.originalCallControlId] || activeCalls[transfer.originalCallControlId]
    if (parentSession && !parentSession.isTrial) {
      try {
        // For inbound calls, the owner is already in the session (chatId, num)
        // For outbound IVR, we need to look up the callerId
        let ownerId, ownerNum
        if (parentSession.callerId) {
          // Outbound IVR session — look up by callerId
          const lookup = await findNumberOwner(parentSession.callerId)
          ownerId = lookup.chatId
          ownerNum = lookup.num
        } else if (parentSession.chatId && parentSession.num) {
          // Inbound call session — owner info already available
          ownerId = parentSession.chatId
          ownerNum = parentSession.num
        }

        if (ownerId && ownerNum) {
          const billingInfo = await billCallMinutesUnified(ownerId, ownerNum.phoneNumber, transferMinutes, transfer.forwardTo, 'Bridge_Transfer', `telnyx_${callControlId}`)
          if (billingInfo.idempotent) {
            log(`[Voice] Transfer leg billing idempotent for ${callControlId} — skipping user DM`)
            return
          }
          log(`[Voice] Billed transfer leg: ${transferMinutes} min to ${transfer.forwardTo} for ${ownerNum.phoneNumber}`)

          const remaining = billingInfo.limit > 0 ? Math.max(0, billingInfo.limit - billingInfo.used) : null
          const planLine = remaining !== null
            ? `📊 Transfer: ${transferMinutes} min deducted · <b>${remaining}/${billingInfo.limit}</b> min remaining`
            : `📊 Transfer: ${transferMinutes} min used`
          const lang = await _getUserLang(ownerId)
          const msg = _trans('vs.transferEnded', lang, formatPhone(transfer.forwardTo), formatDuration(transferDuration), planLine)
          if (msg) _bot?.sendMessage(ownerId, msg, { parse_mode: 'HTML' }).catch(() => {})
        } else {
          log(`[Voice] Bridge transfer billing: could not find owner for parent session`)
        }
      } catch (e) { log(`[Voice] Bridge transfer billing error: ${e.message}`) }
    }
  }

  // Stop any playback (ringback/hold music) on the original leg
  await _telnyxApi.playbackStop(transfer.originalCallControlId).catch(() => {})

  // If destination never answered (no_answer, busy, timeout), handle fallback
  if (transfer.phase !== 'bridged') {
    // Special handling for SIP ring: DON'T hang up original leg — fall through to voicemail/forwarding/missed
    if (transfer.type === 'sip_ring') {
      const origSession = activeCalls[transfer.originalCallControlId]
      if (origSession) {
        // If original inbound was never answered (unanswered SIP ring), answer it now for fallback
        if (transfer.unanswered) {
          try {
            await _telnyxApi.answerCall(transfer.originalCallControlId)
            transfer.unanswered = false
            log(`[Voice] SIP no answer → answered original call for fallback`)
            // Small delay to let Telnyx process the answer before issuing speak/playback
            await new Promise(r => setTimeout(r, 500))
          } catch (e) {
            log(`[Voice] Failed to answer original call for fallback: ${e.message} — hanging up`)
            await _telnyxApi.hangupCall(transfer.originalCallControlId).catch(() => {})
            notifyUser(transfer.chatId, transfer.num, 'missed', origSession)
            delete activeBridgeTransfers[callControlId]
            return true
          }
        }

        const vm = transfer.vmConfig
        const fwd = transfer.fwdConfig

        // Try forwarding based on mode (no_answer OR busy when SIP reports busy)
        const sipHangupCause = hangupCause || ''
        const isSipBusy = sipHangupCause === 'USER_BUSY' || sipHangupCause === 'BUSY'
        const shouldForwardAfterSip = (fwd?.enabled && fwd.forwardTo && fwd.mode === 'no_answer')
          || (fwd?.enabled && fwd.forwardTo && fwd.mode === 'busy' && isSipBusy)
        if (shouldForwardAfterSip) {
          origSession.phase = 'forwarding'
          origSession.forwardingRate = CALL_FORWARDING_RATE_MIN
          const modeLabel = fwd.mode === 'busy' ? 'SIP busy' : 'SIP no answer'
          log(`[Voice] ${modeLabel} → forwarding to ${fwd.forwardTo}`)
          await playHoldMusicAndTransfer(transfer.originalCallControlId, fwd.forwardTo, transfer.fromNumber, fwd)
        }
        // Try voicemail (if configured and plan allows)
        else if (vm?.enabled && canAccessFeature(transfer.num.plan, 'voicemail')) {
          origSession.phase = 'voicemail_greeting'
          log(`[Voice] SIP no answer → playing voicemail for ${transfer.num.phoneNumber}`)
          if (vm.greetingType === 'custom' && vm.customAudioGreetingUrl) {
            try {
              const axios = require('axios')
              await axios.post(`https://api.telnyx.com/v2/calls/${transfer.originalCallControlId}/actions/playback_start`, {
                audio_url: vm.customAudioGreetingUrl,
              }, {
                headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }
              })
            } catch (e) {
              const fallback = vm.customGreetingText || `The person at ${formatPhone(transfer.num.phoneNumber)} is unavailable. Please leave a message after the tone.`
              await _telnyxApi.speakOnCall(transfer.originalCallControlId, fallback)
            }
          } else {
            const greeting = vm.greetingType === 'custom' && vm.customGreetingText
              ? vm.customGreetingText
              : `The person at ${formatPhone(transfer.num.phoneNumber)} is unavailable. Please leave a message after the tone.`
            await _telnyxApi.speakOnCall(transfer.originalCallControlId, greeting)
          }
        }
        // No forwarding or voicemail — missed call
        else {
          origSession.phase = 'missed'
          log(`[Voice] SIP no answer → missed call for ${transfer.num.phoneNumber}`)
          await _telnyxApi.speakOnCall(transfer.originalCallControlId, 'The person you are calling is currently unavailable. Please try again later.')
          setTimeout(() => _telnyxApi.hangupCall(transfer.originalCallControlId), 4000)
          notifyUser(transfer.chatId, transfer.num, 'missed', origSession)
        }
      }
      delete activeBridgeTransfers[callControlId]
      return true
    }

    // Regular bridge transfer failure — hang up original leg and notify user
    await _telnyxApi.hangupCall(transfer.originalCallControlId).catch(() => {})
    const parentSession = outboundIvrCalls[transfer.originalCallControlId] || activeCalls[transfer.originalCallControlId]
    if (parentSession) {
      const chatId = parentSession.chatId
      let reason = hangupCause === 'no_answer' || hangupCause === 'timeout' ? 'No answer' :
                   hangupCause === 'user_busy' ? 'Busy' : hangupCause
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.transferFailed', lang, formatPhone(transfer.forwardTo), reason)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }
  } else {
    // Bridge was active and one leg hung up — hang up the other leg too
    await _telnyxApi.hangupCall(transfer.originalCallControlId).catch(() => {})
  }

  delete activeBridgeTransfers[callControlId]
  return true
}

// Used to recognize new call legs that Telnyx creates during call transfers
const ivrTransferLegs = {}

// ── Webhook Event Buffer ──
// Handles race condition where call.hangup arrives before call.initiated
// Buffers early hangups and processes them after initiated is handled
const _eventBuffer = new Map() // call_control_id → { hangupPayload, timer }
const EVENT_BUFFER_TIMEOUT_MS = 5000 // Max 5s to wait for matching initiated event

function bufferHangup(callControlId, payload) {
  // Clear any existing timer for this call
  const existing = _eventBuffer.get(callControlId)
  if (existing?.timer) clearTimeout(existing.timer)

  _eventBuffer.set(callControlId, {
    hangupPayload: payload,
    timer: setTimeout(() => {
      // Timeout: process the orphan hangup
      const entry = _eventBuffer.get(callControlId)
      if (entry) {
        _eventBuffer.delete(callControlId)
        log(`[Voice] Buffer timeout — processing late hangup for ${callControlId} (no matching call.initiated — likely post-deploy orphan)`)
        processHangup(entry.hangupPayload)
      }
    }, EVENT_BUFFER_TIMEOUT_MS)
  })
  log(`[Voice] Buffered early hangup for ${callControlId} (waiting for call.initiated)`)
}

async function processHangup(payload) {
  if (await handleBridgeTransferHangup(payload)) return
  // BUG FIX: handleOutboundIvrHangup and handleIvrTransferLegHangup are async — must be awaited.
  if (await handleOutboundIvrHangup(payload)) return
  if (await handleIvrTransferLegHangup(payload)) return
  await handleCallHangup(payload)
}

// Track which call_control_ids have been initiated (processed)
const _initiatedCalls = new Set()
const INITIATED_CALL_TTL_MS = 120_000 // Clean up after 2 min

async function handleVoiceWebhook(req, res) {
  res.sendStatus(200)

  try {
    const event = req.body?.data || req.body
    const eventType = event?.event_type || event?.type
    const payload = event?.payload || event

    if (!eventType) return

    log(`[Voice] Event: ${eventType}`)
    
    // Detailed payload logging for call debugging
    if (eventType === 'call.initiated' || eventType === 'call.hangup') {
      log(`[Voice] PAYLOAD DUMP: direction=${payload.direction}, from=${payload.from}, to=${payload.to}, connection_id=${payload.connection_id}, call_control_id=${payload.call_control_id}, call_leg_id=${payload.call_leg_id}, hangup_cause=${payload.hangup_cause || 'N/A'}, hangup_source=${payload.hangup_source || 'N/A'}, sip_hangup_cause=${payload.sip_hangup_cause || 'N/A'}, state=${payload.state}`)
    }

    const callControlId = payload?.call_control_id

    // Read-through: if this call's session isn't in local memory (e.g. it began on the OLD slot
    // during a blue/green drain that exceeded the 30-min cap), restore it from Mongo so the
    // webhook is handled here instead of hitting a "session expired" dead-end. Gated on a
    // memory-miss, so the common (in-memory hit) path makes no DB call.
    if (callControlId && !_activeCallsRaw[callControlId] && !_outboundIvrCallsRaw[callControlId] && !_pendingBridgesRaw[callControlId]) {
      await callSessionStore.rehydrate(callControlId, _callSessionStores)
    }

    switch (eventType) {
      case 'call.initiated': {
        // Mark as initiated and process
        if (callControlId) {
          _initiatedCalls.add(callControlId)
          setTimeout(() => _initiatedCalls.delete(callControlId), INITIATED_CALL_TTL_MS)
        }

        if (handleOutboundIvrInitiated(payload)) break
        // BUG FIX: handleIvrTransferLegInitiated is async — must be awaited.
        // Without `await`, the returned Promise is always truthy, so `break` always
        // fires and handleCallInitiated() is NEVER called for inbound calls.
        // This caused all inbound calls (forwarding/IVR/voicemail) to silently drop
        // — Telnyx parks the call but the bot never tells it what to do.
        if (await handleIvrTransferLegInitiated(payload)) break
        // Skip normal routing for bridge transfer legs (e.g., SIP ring, call forwarding)
        if (activeBridgeTransfers[callControlId]) {
          log(`[Voice] call.initiated for bridge transfer leg ${callControlId} — skipping normal routing`)
        }
        // Skip SIP device delivery legs — Telnyx auto-routes these to the registered device
        // These arrive on the SIP Connection with state=bridging when we ring a SIP URI
        // FIX: Only skip if `to` is a SIP URI or gencred (delivery leg). Outbound SIP calls to PSTN numbers
        // (e.g., +17123393700) must NOT be skipped — they need handleOutboundSipCall() routing.
        // NOTE: Telnyx sometimes strips the "sip:" prefix from delivery legs, sending
        // to=gencredXXX instead of to=sip:gencredXXX@sip.telnyx.com. Without this check,
        // the gencred string gets digit-stripped (e.g., "762442") and triggers false orphaned alerts.
        else if (payload.state === 'bridging' && payload.connection_id === (process.env.TELNYX_SIP_CONNECTION_ID || '') && ((payload.to || '').startsWith('sip:') || (payload.to || '').startsWith('gencred'))) {
          log(`[Voice] call.initiated for SIP device delivery leg ${callControlId} — skipping (Telnyx auto-routes)`)
        } else {
          await handleCallInitiated(payload)
        }

        // Check if we have a buffered hangup for this call
        const buffered = _eventBuffer.get(callControlId)
        if (buffered) {
          clearTimeout(buffered.timer)
          _eventBuffer.delete(callControlId)
          log(`[Voice] Processing buffered hangup for ${callControlId} (arrived before initiated)`)
          await processHangup(buffered.hangupPayload)
        }
        break
      }
      case 'call.answered':
        if (await handleBridgeTransferAnswered(payload)) break
        if (await handleOutboundIvrAnswered(payload)) break
        // BUG FIX: handleIvrTransferLegAnswered is async — must be awaited.
        if (await handleIvrTransferLegAnswered(payload)) break
        await handleCallAnswered(payload)
        break
      case 'call.hangup': {
        // If we haven't seen call.initiated for this call yet, buffer the hangup
        // UNLESS it's a known bridge transfer leg — those can be processed directly
        if (callControlId && !_initiatedCalls.has(callControlId) && !activeBridgeTransfers[callControlId]) {
          // Recognize known benign hangup patterns that don't need buffering:
          // 1. SIP bridge delivery legs (to=sip:bridge_*@speechcue-*)
          // 2. SIP device delivery legs (to=sip:* or to=gencred*)
          // These commonly arrive after deployment restarts when _initiatedCalls is empty
          const toField = (payload?.to || '')
          const isBenignLeg = toField.includes('bridge_') || toField.startsWith('sip:bridge_') || toField.startsWith('gencred')
          if (isBenignLeg) {
            log(`[Voice] Hangup for known bridge/delivery leg ${callControlId} — processing directly (no buffer)`)
          } else {
            bufferHangup(callControlId, payload)
            break
          }
        }
        if (await handleBridgeTransferHangup(payload)) break
        // BUG FIX: handleOutboundIvrHangup and handleIvrTransferLegHangup are async — must be awaited.
        if (await handleOutboundIvrHangup(payload)) break
        if (await handleIvrTransferLegHangup(payload)) break
        await handleCallHangup(payload)
        break
      }
      case 'call.gather.ended':
        if (await handleOutboundIvrGatherEnded(payload)) break
        await handleGatherEnded(payload)
        break
      case 'call.recording.saved':
        await handleRecordingSaved(payload)
        break
      case 'call.speak.ended':
        await handleSpeakEnded(payload)
        break
      case 'call.playback.ended':
        // Only route to handleSpeakEnded for voicemail flows, NOT for hold music
        // Hold music transfers are handled via call.speak.ended only
        if (!pendingHoldTransfers[payload?.call_control_id]) {
          await handleSpeakEnded(payload)
        }
        break
      case 'call.bridged':
        handleCallBridged(payload)
        break
      case 'call.playback.started':
      case 'call.speak.started':
      case 'call.dtmf.received':
        // Informational events — already handled via gather.ended
        // (call.speak.started arrives on every TTS prompt; we react to
        //  call.speak.ended, not the start event.)
        break
      case 'call.machine.detection.ended': {
        // AMD result from Telnyx — store in outbound IVR session
        const amdCallControlId = payload.call_control_id
        const amdSession = outboundIvrCalls[amdCallControlId]
        const amdResult = payload.result || 'unknown' // 'human', 'machine', 'not_sure'
        log(`[Voice] AMD result: ${amdResult} for callControlId=${amdCallControlId}`)
        if (amdSession) {
          amdSession.answeredBy = amdResult === 'machine' ? 'machine'
            : amdResult === 'human' ? 'human'
            : 'unknown'
          log(`[OutboundIVR] AMD: ${amdSession.targetNumber} → ${amdSession.answeredBy}`)
          // Bulk IVR: a voicemail can't press a key — hang up (lead is reported as "Voicemail").
          if (amdSession.campaignId && amdSession.answeredBy === 'machine' && !amdSession.digitPressed && amdSession.phase === 'playing') {
            log(`[OutboundIVR] Bulk AMD machine → hanging up ${amdSession.targetNumber} (campaign ${amdSession.campaignId})`)
            await _telnyxApi.hangupCall(amdCallControlId).catch(() => {})
          }
        }
        break
      }
      case 'fax.received':
      case 'fax.receiving.started':
      case 'fax.media.processing.started':
      case 'fax.failed':
        // Fax events — handled by dedicated /telnyx/fax-webhook endpoint
        // If they arrive here via voice webhook, log and skip
        log(`[Voice] Fax event received on voice webhook: ${eventType} — use /telnyx/fax-webhook for fax handling`)
        break
      default:
        log(`[Voice] Unhandled event: ${eventType}`)
    }
  } catch (e) {
    log(`[Voice] Webhook error: ${e.message}`)
  }
}

/**
 * Handle call.bridged — mark active/IVR sessions as bridged
 */
function handleCallBridged(payload) {
  const callControlId = payload.call_control_id
  const session = outboundIvrCalls[callControlId]
  if (session) {
    session.phase = 'bridged'
    log(`[OutboundIVR] Bridged: ${session.targetNumber} → ${session.ivrNumber}`)
    _bot?.sendMessage(session.chatId, ivrOutbound.formatCallNotification('transferred', session), { parse_mode: 'HTML' }).catch(() => {})
    return
  }
  const active = activeCalls[callControlId]
  if (active) {
    active.phase = 'bridged'
    log(`[Voice] Call bridged: ${active.from} ↔ ${active.to}`)
    // Mark native transfer as connected if one exists
    const nativeTransfer = pendingNativeTransfers[callControlId]
    if (nativeTransfer) {
      nativeTransfer.connected = true
      if (nativeTransfer._timeout) clearTimeout(nativeTransfer._timeout)
      log(`[Voice] Native transfer connected: ${nativeTransfer.forwardTo}`)
    }
    return
  }
  // Check if this is a transfer leg being bridged
  const transfer = ivrTransferLegs[callControlId]
  if (transfer) {
    log(`[OutboundIVR] Transfer leg bridged: ${transfer.ivrNumber}`)
    return
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CALL INITIATED — Answer or reject based on limits
// Also handles OUTBOUND SIP calls (Twilio bridge)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleCallInitiated(payload) {
  const callControlId = payload.call_control_id
  const to = (payload.to || '').replace(/[^+\d]/g, '')
  const from = (payload.from || '').replace(/[^+\d]/g, '')
  const direction = payload.direction
  const connectionId = payload.connection_id || ''
  const sipConnectionId = process.env.TELNYX_SIP_CONNECTION_ID || ''

  // Webhook delivery delay diagnostic — Telnyx sometimes delivers events with multi-second lag
  if (payload.start_time) {
    const ageMs = Date.now() - new Date(payload.start_time).getTime()
    if (ageMs > 5000) {
      log(`[Voice] ⚠️ Stale call.initiated: ${ageMs}ms old cc=${callControlId} to=${to}`)
    }
  }

  log(`[Voice] handleCallInitiated: ${direction || '?'} from=${from} to=${to} conn=${connectionId} cc=${callControlId}`)

  // ── SKIP: our own outbound PSTN leg created by an auto-routed transfer ──
  // Telnyx fires call.initiated for the NEW leg we created via `transfer` (direction=outgoing,
  // from=<our ANI>, no SIP credential). It's already tracked/billed on the A-leg. Re-processing it
  // would run a 250-credential reverse lookup, resolve the WRONG user, and delay the call ~3s.
  if (_isSelfPstnLeg(payload)) {
    log(`[Voice] Skipping self-originated PSTN transfer leg cc=${callControlId} to=${to} (already tracked on A-leg)`)
    return
  }

  // ── OUTBOUND / SIP CALLS ──
  // Route to SIP handler if:
  // 1. direction is 'outgoing' (explicit outbound)
  // 2. connection_id matches SIP Connection (outbound from SIP device)
  const isFromSipConnection = sipConnectionId && connectionId === sipConnectionId
  if (direction === 'outgoing' || (isFromSipConnection && direction !== 'incoming')) {
    await handleOutboundSipCall(payload)
    return
  }

  // ── INBOUND CALLS (via Call Control App) ──
  // With numbers assigned to Call Control App, all inbound calls arrive here
  // with direction='incoming'. We answer and apply IVR/forwarding/voicemail.

  // Lookup number owner — get FRESH data from DB
  const { chatId, num } = await findNumberOwner(to)
  if (!chatId || !num) {
    log(`[Voice] ⚠️ ORPHANED NUMBER: No owner found for ${to} — inbound call from ${from} rejected. Number may need cleanup.`)
    // Reject BEFORE answering. A robocaller/scanner flooding an orphaned or
    // de-provisioned number sends bursts of call.initiated that hang up in <1s;
    // answering+speaking on those legs produced 90102 (answer on outbound leg) and
    // 90034 (speak before answered) error storms. reject() sends a SIP rejection
    // without ever answering — no billed answer, no error storm.
    await _telnyxApi.rejectCall(callControlId, 'CALL_REJECTED').catch(() => {})
    // Throttle the admin alert — one alert per number per 6h so a flood can't spam admin.
    const _nowMs = Date.now()
    const _lastAlert = _orphanAlertThrottle.get(to) || 0
    if (_nowMs - _lastAlert > 6 * 3600000) {
      _orphanAlertThrottle.set(to, _nowMs)
      if (_bot && process.env.TELEGRAM_ADMIN_CHAT_ID) {
        const msg = _trans('vs.orphanedNumberAlert', 'en', to, from)
        if (msg) _bot.sendMessage(process.env.TELEGRAM_ADMIN_CHAT_ID, msg, { parse_mode: 'HTML' }).catch(() => {})
      }
    }
    return
  }

  log(`[Voice] Number owner found: chatId=${chatId} plan=${num.plan} status=${num.status} sip=${!!num.sipUsername} fwd=${!!num.features?.callForwarding?.enabled}(${num.features?.callForwarding?.mode || 'n/a'}) ivr=${!!num.features?.ivr?.enabled} vm=${!!num.features?.voicemail?.enabled}`)

  // ── CHECK: Number suspended? ──
  if (num.status !== 'active') {
    log(`[Voice] Number ${to} is ${num.status}, rejecting call`)
    try {
      await _telnyxApi.answerCall(callControlId)
      await _telnyxApi.speakOnCall(callControlId, 'This number is no longer in service.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 4000)
    } catch (e) {
      await _telnyxApi.hangupCall(callControlId).catch(() => {})
    }
    return
  }

  // ── CHECK: Inbound minutes limit reached? → Try overage billing ──
  if (isMinuteLimitReached(num)) {
    const inboundRate = getCallRate(from) // Rate based on caller's country
    let overageAllowed = false
    if (_walletOf) {
      try {
        const check = await smartWalletCheck(_walletOf, chatId, inboundRate)
        if (check.sufficient) {
          overageAllowed = true
          log(`[Voice] Minutes limit reached for ${to}, but wallet has funds (${check.currency}) — allowing overage at $${inboundRate}/min`)
        }
      } catch (e) { log(`[Voice] Overage check error: ${e.message}`) }
    }
    if (!overageAllowed) {
      const inboundRate = getCallRate(from)
      log(`[Voice] Minutes limit reached for ${to} (${num.minutesUsed || 0}/${getMinuteLimit(num.plan)}), no wallet balance — rejecting call`)
      try {
        await _telnyxApi.answerCall(callControlId)
        await _telnyxApi.speakOnCall(callControlId, 'Your inbound minutes limit has been reached and wallet balance is insufficient. Please top up your wallet or upgrade your plan.')
        setTimeout(() => _telnyxApi.hangupCall(callControlId), 6000)
      } catch (e) {
        await _telnyxApi.hangupCall(callControlId).catch(() => {})
      }
      const lang = await _getUserLang(chatId)
      const region = isUSCanada(from) ? 'US/CA' : 'Intl'
      const msg = _trans('vs.incomingCallBlockedWalletEmpty', lang, formatPhone(to), formatPhone(from), inboundRate, region)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      return
    }
  }

  // Store session data
  activeCalls[callControlId] = {
    chatId,
    num,
    from,
    to,
    startedAt: new Date(),
    phase: 'answering',
    recordingEnabled: num.features?.recording === true && canAccessFeature(num.plan, 'callRecording'),
  }

  // ── MID-CALL LIMIT MONITOR ──
  // All call types: plan minutes first, then overage at destination-based rate
  const minuteLimit = getMinuteLimit(num.plan)
  const sessionRef = activeCalls[callControlId]
  sessionRef._limitTimer = setInterval(async () => {
    const sess = activeCalls[callControlId]
    if (!sess) { clearInterval(sessionRef._limitTimer); return }
    const elapsedSec = Math.floor((Date.now() - sess.startedAt.getTime()) / 1000)
    const elapsedMin = Math.ceil(elapsedSec / 60)

    // Determine destination for rate calculation
    const isForwarded = sess.phase === 'forwarding' || sess.phase === 'ivr_forward'
    const isOutbound = sess.direction === 'outgoing'
    const destination = isForwarded
      ? (num.features?.callForwarding?.forwardTo || from)
      : isOutbound ? to : from
    const rate = getCallRate(destination)

    // Check plan minutes + overage
    if (minuteLimit !== Infinity) {
      const projectedTotal = (num.minutesUsed || 0) + elapsedMin
      if (projectedTotal >= minuteLimit) {
        let canContinue = false
        if (_walletOf) {
          try {
            const deductResult = await smartWalletDeduct(_walletOf, chatId, rate, {
              type: 'twilio_per_minute_overage', callType: 'TwilioCall',
              description: `Twilio overage: ${from} → ${to} ($${rate}/min)`,
              destination, phoneNumber: num.phoneNumber,
            })
            if (deductResult.success) {
              canContinue = true
              if (!sess._overageNotified) {
                sess._overageNotified = true
                const chargedStr = deductResult.currency === 'ngn' ? `₦${deductResult.chargedNgn}/min` : `$${rate}/min`
                const lang = await _getUserLang(chatId)
                const region = isUSCanada(destination) ? 'US/CA' : 'Intl'
                const msg = _trans('vs.overageActive', lang, chargedStr, region, deductResult.currency.toUpperCase())
                if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
              }
            }
          } catch (e) { log(`[Voice] Mid-call overage error: ${e.message}`) }
        }
        if (!canContinue) {
          log(`[Voice] Mid-call limit reached for ${to}: projected ${projectedTotal}/${minuteLimit} min, no wallet balance. Disconnecting.`)
          clearInterval(sessionRef._limitTimer)
          sess._limitDisconnect = true
          try {
            await _telnyxApi.speakOnCall(callControlId, 'Your call limit and wallet balance have been exhausted. This call will now end.')
            setTimeout(() => _telnyxApi.hangupCall(callControlId), 5000)
          } catch (e) {
            await _telnyxApi.hangupCall(callControlId).catch(() => {})
          }
          const lang = await _getUserLang(chatId)
          const msg = _trans('vs.callEndedPlanWalletExhausted', lang, elapsedMin)
          if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        }
      }
    }
  }, 60000)

  // ── SIP DEVICE RING (NO AUTO-ANSWER) ──
  // If number has SIP credentials, ring the SIP device BEFORE answering.
  // The caller hears real network ringback. Only answer when SIP device picks up.
  // If SIP device doesn't answer → answer + voicemail/forwarding/missed fallback.
  const fwdConfig = num.features?.callForwarding
  const ivrConfig = num.features?.ivr
  const hasSip = !!num.sipUsername
  const hasIvr = ivrConfig?.enabled && canAccessFeature(num.plan, 'ivr') && ivrConfig.options && Object.keys(ivrConfig.options).length > 0
  const hasForwardAlways = fwdConfig?.enabled && fwdConfig.forwardTo && fwdConfig.mode === 'always'

  // Only do unanswered SIP ring if: has SIP, no IVR, no forward-always (those need answered call)
  if (hasSip && !hasIvr && !hasForwardAlways) {
    sessionRef.phase = 'ringing_sip'
    const sipUser = num.telnyxSipUsername || num.sipUsername
    const sipUri = `sip:${sipUser}@sip.telnyx.com`
    const ringTimeout = fwdConfig?.ringTimeout || 25
    const vmConfig = num.features?.voicemail
    log(`[Voice] Ringing SIP device (unanswered): ${sipUri} for ${num.phoneNumber} (timeout: ${ringTimeout}s)`)

    try {
      const newCall = await _telnyxApi.createOutboundCall(from, sipUri)
      // Pass original caller's number as 'from' so SIP device shows correct caller ID
      if (newCall?.callControlId) {
        activeBridgeTransfers[newCall.callControlId] = {
          originalCallControlId: callControlId,
          forwardTo: sipUri,
          fromNumber: to,
          type: 'sip_ring',
          vmConfig,
          fwdConfig,
          chatId,
          num,
          phase: 'ringing',
          unanswered: true, // Original inbound NOT yet answered
          createdAt: new Date(),
        }
        sessionRef.sipRingCallControlId = newCall.callControlId // Track for hangup cleanup

        const lang = await _getUserLang(chatId)
        const msg = _trans('vs.incomingCall', lang, formatPhone(from), formatPhone(to))
        if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})

        // Timeout: SIP device didn't answer — answer inbound + fallback
        setTimeout(async () => {
          const transfer = activeBridgeTransfers[newCall.callControlId]
          if (transfer && transfer.phase !== 'bridged') {
            log(`[Voice] SIP ring timeout: device didn't answer in ${ringTimeout}s — falling through`)
            await _telnyxApi.hangupCall(newCall.callControlId).catch(() => {})
          }
        }, ringTimeout * 1000)
        return // Don't answer — wait for SIP device
      }
    } catch (e) {
      log(`[Voice] Failed to ring SIP device: ${e.message} — answering and routing normally`)
    }
    // If SIP ring failed, fall through to normal answer + routing
  }

  // Answer the call — for non-SIP numbers, or SIP ring failed, or IVR/forwarding-always
  log(`[Voice] Answering call for ${to} (hasSip=${hasSip}, hasIvr=${hasIvr}, hasForwardAlways=${hasForwardAlways}) — waiting for call.answered to apply features`)
  try {
    const ansResult = await _telnyxApi.answerCall(callControlId)
    // Fix #3: answerCall now returns null for 90018 (call already ended) instead of throwing
    if (ansResult === null) {
      log(`[Voice] answerCall returned null (call ended before answer) for ${to} cc=${callControlId} — skipping feature routing`)
      if (sessionRef._limitTimer) clearInterval(sessionRef._limitTimer)
      delete activeCalls[callControlId]
      return
    }
    log(`[Voice] answerCall accepted for ${to} cc=${callControlId} — Telnyx will fire call.answered next`)
  } catch (answerErr) {
    const errMsg = answerErr?.message || ''
    log(`[Voice] answerCall error for ${to}: ${errMsg}`)
    if (sessionRef._limitTimer) clearInterval(sessionRef._limitTimer)
    delete activeCalls[callControlId]
    return
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OUTBOUND SIP CALL — Bridge Twilio numbers through Twilio PSTN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleOutboundSipCall(payload) {
  const callControlId = payload.call_control_id
  const rawTo = payload.to || ''
  const rawFrom = payload.from || ''
  const connectionId = payload.connection_id || ''

  // ── CRITICAL FIX: Check if this is an outbound IVR call FIRST ──
  // Outbound IVR calls (initiated via bot) arrive with direction='outgoing' but are NOT SIP-originated.
  // If we have a session for this call, it should NOT be processed here as a SIP call.
  if (outboundIvrCalls[callControlId]) {
    log(`[Voice] Outbound IVR call detected: ${callControlId} — routing to IVR handler`)
    // Let the standard webhook handler (handleOutboundIvrInitiated) process this
    return
  }

  // Detect SIP-originated calls using multiple methods:
  // 1. sip: prefix or @ in from field (SIP URI format — user dialing via SIP client with URI)
  // 2. connection_id matches our SIP Connection ID (Telnyx credential connection outbound —
  //    from field will be phone number, not SIP URI)
  const sipConnectionId = process.env.TELNYX_SIP_CONNECTION_ID || ''
  const isSipByFromField = rawFrom.startsWith('sip:') || rawFrom.includes('@')
  const isSipByConnection = sipConnectionId && connectionId === sipConnectionId
  const fromClean = rawFrom.replace(/[^+\d]/g, '')
  const toClean = rawTo.replace(/[^+\d]/g, '')

  // For connection_id based detection, check if we already have an active session
  // that initiated a transfer to this destination (avoid double-processing transfer legs)
  const isDuplicateSession = activeCalls[callControlId] !== undefined
  
  const isSipOriginated = isSipByFromField || isSipByConnection

  if (!isSipOriginated) {
    log(`[Voice] Outbound call from ${rawFrom} to ${rawTo} (conn=${connectionId}) — not on SIP connection, ignoring`)
    return
  }

  if (isDuplicateSession) {
    log(`[Voice] Outbound SIP: Already tracking call ${callControlId}, skipping duplicate`)
    return
  }

  // Determine if Telnyx auto-routed this call (state=bridging means already routing)
  const isAutoRouted = isSipByConnection && !isSipByFromField
  log(`[Voice] SIP call detected: byFromField=${isSipByFromField}, byConnection=${isSipByConnection}, autoRouted=${isAutoRouted}, connection_id=${connectionId}`)

  // Parse destination number from SIP URI: sip:+1234567890@domain → +1234567890
  let destination = rawTo.replace(/[^+\d]/g, '')
  if (rawTo.startsWith('sip:')) {
    destination = rawTo.replace('sip:', '').split('@')[0].replace(/[^+\d]/g, '')
  }

  // E.164 normalization — SIP clients may dial without + prefix
  // 10 digits (US/CA local) → prepend +1
  // 11 digits starting with 1 (US/CA with country code) → prepend +
  // Already has + → leave as-is
  if (destination && !destination.startsWith('+')) {
    if (destination.length === 10) {
      destination = '+1' + destination
    } else if (destination.length === 11 && destination.startsWith('1')) {
      destination = '+' + destination
    } else if (destination.length > 6) {
      destination = '+' + destination // International — assume country code included
    }
  }

  // ── CRITICAL FIX: Extract actual SIP credential username ──
  // When calls go through the shared Telnyx SIP connection, the webhook 'from' field
  // contains the connection's phone number (e.g. +18889020132), NOT the SIP username.
  // This caused findNumberBySipUser to match the connection's number owner (wrong user)
  // instead of the actual SIP caller. We must extract the real SIP username from:
  // 1. SIP URI in 'from' field (sip:user@domain)
  // 2. custom_headers (Telnyx may forward SIP headers)
  // 3. sip_headers field
  // 4. from_display_name
  let sipUsername = rawFrom
  let credentialExtracted = false

  // Method 1: Parse from SIP URI format
  if (rawFrom.includes('@')) {
    sipUsername = rawFrom.replace(/^sip:/, '').split('@')[0]
    credentialExtracted = true
  }

  // Method 1b: Check from_sip_uri field — Telnyx includes the actual SIP URI of the caller
  // This is the MOST RELIABLE source for connection-based calls where 'from' is just the phone number
  // Value format varies: "sip:gencredXYZ@domain" or just "gencredXYZ@domain" (no sip: prefix)
  if (!credentialExtracted && payload.from_sip_uri) {
    const uri = payload.from_sip_uri.replace(/^sip:/, '')
    const atIdx = uri.indexOf('@')
    if (atIdx > 0) {
      const uriUser = uri.substring(0, atIdx)
      if (uriUser && !uriUser.startsWith('+') && !/^\d+$/.test(uriUser)) {
        sipUsername = uriUser
        credentialExtracted = true
        log(`[Voice] SIP credential extracted from from_sip_uri: ${sipUsername} (uri=${payload.from_sip_uri})`)
      }
    }
  }

  // Method 2: Check custom_headers for SIP identity
  if (!credentialExtracted && Array.isArray(payload.custom_headers)) {
    for (const h of payload.custom_headers) {
      const hName = (h.name || '').toLowerCase()
      // Look for common SIP headers that contain the authenticated user
      if (['p-asserted-identity', 'x-authenticated-user', 'x-credential-username', 'from', 'remote-party-id'].includes(hName)) {
        const sipMatch = (h.value || '').match(/sip:([^@>]+)@/)
        if (sipMatch && sipMatch[1] && !sipMatch[1].startsWith('+')) {
          sipUsername = sipMatch[1]
          credentialExtracted = true
          log(`[Voice] SIP credential extracted from custom_headers[${h.name}]: ${sipUsername}`)
          break
        }
      }
    }
  }

  // Method 3: Check sip_headers
  if (!credentialExtracted && payload.sip_headers && typeof payload.sip_headers === 'object') {
    for (const [hName, hValue] of Object.entries(payload.sip_headers)) {
      if (['from', 'p-asserted-identity', 'contact'].includes(hName.toLowerCase())) {
        const sipMatch = (hValue || '').match(/sip:([^@>]+)@/)
        if (sipMatch && sipMatch[1] && !sipMatch[1].startsWith('+')) {
          sipUsername = sipMatch[1]
          credentialExtracted = true
          log(`[Voice] SIP credential extracted from sip_headers[${hName}]: ${sipUsername}`)
          break
        }
      }
    }
  }

  // Method 4: Check from_display_name (some SIP clients set this to the SIP username)
  if (!credentialExtracted && payload.from_display_name && payload.from_display_name.startsWith('gencred')) {
    sipUsername = payload.from_display_name
    credentialExtracted = true
    log(`[Voice] SIP credential extracted from from_display_name: ${sipUsername}`)
  }

  // ── Full payload dump for SIP calls (helps diagnose credential extraction) ──
  if (!credentialExtracted && isSipByConnection) {
    try {
      const payloadKeys = Object.keys(payload).join(', ')
      log(`[Voice] SIP FULL PAYLOAD KEYS: ${payloadKeys}`)
      log(`[Voice] SIP PAYLOAD DETAIL: custom_headers=${JSON.stringify(payload.custom_headers)}, sip_headers=${JSON.stringify(payload.sip_headers)}, from_display_name=${payload.from_display_name || 'N/A'}, client_state=${payload.client_state || 'N/A'}, from_sip_uri=${payload.from_sip_uri || 'N/A'}, to_sip_uri=${payload.to_sip_uri || 'N/A'}`)
    } catch (e) { /* ignore logging errors */ }
  }

  log(`[Voice] Outbound SIP: from=${sipUsername} (cleaned=${fromClean}) to=${destination} (${callControlId}, conn=${connectionId}, credentialExtracted=${credentialExtracted})`)

  // ── PRE-DIAL INSTANT BLOCK ──
  // Check in-memory blocklist BEFORE any async/DB operations.
  // Sub-millisecond check: if this SIP credential is known-blocked (low balance, etc.),
  // immediately reject the call. For auto-routed calls, this rejects so fast that
  // the PSTN leg likely hasn't connected yet → zero carrier charge.
  if (credentialExtracted && sipUsername && _sipPreDialBlocklist.has(sipUsername)) {
    const block = _sipPreDialBlocklist.get(sipUsername)
    log(`[Voice] PRE-DIAL BLOCK: ${sipUsername} (chatId ${block.chatId}) — instant reject (reason: ${block.reason})`)
    try {
      if (isAutoRouted) {
        await _telnyxApi.hangupCall(callControlId)
      } else {
        await _telnyxApi.rejectCall(callControlId, 'CALL_REJECTED')
      }
    } catch (e) { /* call may have already ended */ }
    // Increment hit counter for logging reduction
    if (!block._hits) block._hits = 0
    block._hits++
    if (block._hits <= 3 || block._hits % 20 === 0) {
      log(`[Voice] PRE-DIAL BLOCK: ${sipUsername} rejected (hit #${block._hits}) — ${block.reason}`)
    }
    // Notify the user why (throttled) so SIP-originated blocked calls are not silent.
    notifyPreDialLowBalance(block)
    return
  }

  // Fix #2: If user is in hard-block, silently drop — no logging, no hangup API call
  const rateLimitKey = fromClean || sipUsername
  if (isSipHardBlocked(rateLimitKey)) {
    // FIX: Do NOT bill hard-blocked calls — they are rejected and never connected
    // Billing blocked calls creates phantom charges for calls that were never completed
    return // silent drop — saves webhook processing, logging, and Telnyx API calls
  }

  // ── EXPIRED TEST CREDENTIAL EARLY BLOCK ──
  // If this SIP user was recently identified as an expired test credential,
  // silently drop without any DB lookups or API calls (saves resources)
  if (credentialExtracted && sipUsername && _expiredTestBlockSet.has(sipUsername)) {
    const blockedAt = _expiredTestBlockSet.get(sipUsername)
    if (Date.now() - blockedAt < EXPIRED_TEST_BLOCK_DURATION) {
      return // silent drop — expired test user keeps retrying
    }
    _expiredTestBlockSet.delete(sipUsername) // expired block, allow re-check
  }

  // ── UNIDENTIFIED-CREDENTIAL COST-LEAK BLOCK ──
  // A credential that repeatedly failed to map to an owner is temporarily hard-blocked so it stops
  // generating billable legs (and the expensive 250-credential reverse lookup) with no user to charge.
  if (credentialExtracted && sipUsername && _isUnidentifiedBlocked(sipUsername)) {
    try { await _telnyxApi.hangupCall(callControlId) } catch (e) { /* call may have already ended */ }
    return
  }

  // ── SIP Rate Limiting — prevent spam dialing ──
  if (!checkSipRateLimit(sipUsername, destination)) {
    log(`[Voice] ⚠️ SIP RATE LIMIT: ${sipUsername} → ${destination} — exceeded ${SIP_RATE_LIMIT_MAX} calls/${SIP_RATE_LIMIT_WINDOW/1000}s, rejecting`)
    // FIX: Do NOT bill rate-limited calls — they are rejected before connecting
    try {
      await _telnyxApi.hangupCall(callControlId)
    } catch (e) { log(`[Voice] Reject error: ${e.message}`) }
    return
  }

  // ── Global per-user rate limit — caps total outbound calls from any single user ──
  // Prevents users from spam-dialing many different numbers to bypass per-destination limit
  if (!checkSipGlobalRateLimit(rateLimitKey)) {
    // Fix #2: Record hit and potentially escalate to hard-block
    const hardBlocked = recordRateLimitHit(rateLimitKey)
    if (!hardBlocked) {
      // Still in soft-block — log + hangup
      log(`[Voice] ⚠️ SIP GLOBAL RATE LIMIT: ${rateLimitKey} — exceeded ${SIP_GLOBAL_RATE_MAX} total calls/${SIP_GLOBAL_RATE_WINDOW/1000}s, rejecting`)
      try {
        await _telnyxApi.hangupCall(callControlId)
      } catch (e) { /* suppress — call may already be ended */ }
    }
    // FIX: Do NOT bill rate-limited or hard-blocked calls — they are rejected before connecting
    // If hard-blocked, recordRateLimitHit already logged the activation
    return
  }

  // ── Wallet rejection cooldown — skip expensive credential lookup if recently rejected ──
  // When a user's wallet is too low, we cache the rejection for 5 minutes.
  // Subsequent calls from the same number are immediately rejected without
  // the costly 116-credential reverse lookup, DB queries, or wallet API calls.
  //
  // CRITICAL FIX: Only use early cooldown for calls where we extracted the actual SIP credential
  // (credentialExtracted=true). For connection-based calls (from=shared connection ANI like +18556820054),
  // ALL users share the same 'from' number, so keying cooldown on fromClean would block ALL users
  // when just ONE user has low balance. For these shared-connection calls, the cooldown check
  // is deferred to AFTER user identification (see post-identification cooldown check below).
  const cooldownKey = credentialExtracted ? sipUsername : null
  if (cooldownKey && isWalletRejectCooldown(cooldownKey)) {
    const cooldownEntry = walletRejectCooldown[cooldownKey]
    const hitCount = cooldownEntry?.hitCount || 1
    const effectiveDuration = getEscalatedCooldownMs(hitCount)
    // Reduced logging after first few hits (prevent log spam)
    if (hitCount <= 3) {
      log(`[Voice] ⚠️ WALLET COOLDOWN: ${cooldownKey} — rejected for low balance (hit #${hitCount}, cooldown=${effectiveDuration / 60000}min)`)
    } else if (hitCount % 10 === 0) {
      log(`[Voice] ⚠️ WALLET COOLDOWN: ${cooldownKey} — still blocked (hit #${hitCount}, cooldown=${effectiveDuration / 60000}min)`)
    }
    // Send low-balance notification only for first N hits (suppress spam)
    if (_bot && cooldownEntry?.chatId && shouldSendWalletCooldownNotification(cooldownKey)) {
      markWalletCooldownNotified(cooldownKey)
      const lang = await _getUserLang(cooldownEntry.chatId)
      const baseMsg = _trans('vs.outboundCallingLocked', lang)
      const fullMsg = baseMsg + 
        `Your wallet balance has dropped below $${LOW_BALANCE_TRIGGER}. To protect your account, outbound calls are temporarily locked.\n\n` +
        `💰 <b>Top up at least $${LOW_BALANCE_RESUME}</b> to resume calling.\n` +
        `Use 👛 <b>Wallet</b> to add funds.`
      if (baseMsg) _bot.sendMessage(cooldownEntry.chatId, fullMsg, { parse_mode: 'HTML' }).catch(() => {})
    }
    try {
      await _telnyxApi.hangupCall(callControlId)
    } catch (e) { /* silently reject */ }
    return
  }

  // Look up the SIP user → find their phone number and provider
  // Pass the SIP connection's phone number to prevent wrong-user matching
  // When from=connection_number and no credential was extracted, the old code would match
  // the connection's number owner (wrong user) instead of the actual SIP caller
  // Detect: when call is from SIP connection and sipUsername looks like a phone number (not a gencred),
  // it's the connection's default number, not the actual SIP user
  const isConnectionDefaultNumber = isSipByConnection && !credentialExtracted && /^\+?\d+$/.test(sipUsername)
  const connectionPhoneNumber = isConnectionDefaultNumber ? fromClean : null
  
  if (isConnectionDefaultNumber) {
    log(`[Voice] SIP from=${fromClean} is connection's default number (no credential in payload) — phone match will be blocked to prevent wrong-user billing`)
  }
  
  // ── FAST PATH: Check recent test credential cache BEFORE expensive DB/API lookups ──
  // When a user just created a test credential via /testsip, we can instantly identify them
  // without scanning all 145+ Telnyx credentials. This also solves the multi-match
  // disambiguation bug where the wrong user's low balance killed another user's call.
  let lookupResult = { chatId: null, num: null }
  let skipReverseLookup = false
  
  if (!credentialExtracted && isSipByConnection) {
    // Scan the recent test credentials cache for any entry matching this connection
    // The user who JUST created their credential (seconds/minutes ago) is almost certainly the caller
    // If multiple recent entries exist, prefer the most recently registered one
    let bestCacheMatch = null
    let bestCacheTime = 0
    for (const [cachedSipUser, cacheEntry] of _recentTestCredentials) {
      if (Date.now() - cacheEntry.registeredAt < RECENT_TEST_CREDENTIAL_TTL && cacheEntry.registeredAt > bestCacheTime) {
        bestCacheMatch = { sipUser: cachedSipUser, entry: cacheEntry }
        bestCacheTime = cacheEntry.registeredAt
      }
    }
    if (bestCacheMatch) {
      const cachedLookup = await findNumberBySipUser(bestCacheMatch.sipUser, null, null)
      if (cachedLookup.chatId === bestCacheMatch.entry.chatId && cachedLookup.num) {
        lookupResult = cachedLookup
        sipUsername = bestCacheMatch.sipUser
        credentialExtracted = true
        skipReverseLookup = true
        log(`[Voice] ✅ Fast-path match via recent test credential cache: ${sipUsername} → chatId ${bestCacheMatch.entry.chatId} (created ${Math.round((Date.now() - bestCacheMatch.entry.registeredAt) / 1000)}s ago)`)
      }
    }
  }
  
  if (!lookupResult.chatId && !skipReverseLookup) {
    lookupResult = await findNumberBySipUser(sipUsername, fromClean, connectionPhoneNumber)
  }
  
  // ── FALLBACK: If credential wasn't extracted from payload and no match found,
  // try reverse lookup via Telnyx credentials API ──
  if (!lookupResult.chatId && !credentialExtracted && isSipByConnection) {
    log(`[Voice] SIP credential not in payload and phone match blocked — trying Telnyx credentials reverse lookup`)
    try {
      const telnyxService = require('./telnyx-service.js')
      const credentials = await telnyxService.listSIPCredentials(connectionId)
      log(`[Voice] Found ${credentials.length} Telnyx credentials on connection`)
      
      // Try each credential username against our DB — collect ALL matches
      const matches = []
      for (const cred of credentials) {
        if (cred.sipUsername) {
          const tryResult = await findNumberBySipUser(cred.sipUsername, null, null)
          if (tryResult.chatId && tryResult.num && tryResult.num.status === 'active') {
            matches.push({ ...tryResult, credUsername: cred.sipUsername })
          }
        }
      }
      
      if (matches.length === 1) {
        // Only one active user with SIP credential — must be them
        lookupResult = matches[0]
        sipUsername = matches[0].credUsername
        log(`[Voice] Telnyx reverse lookup: unique match → ${sipUsername} → chatId ${lookupResult.chatId}, number ${lookupResult.num.phoneNumber}`)
      } else if (matches.length > 1) {
        // Multiple active users — disambiguate using recent call activity
        log(`[Voice] Telnyx reverse lookup: ${matches.length} possible users, trying recent-activity heuristic`)
        
        // Strategy: check each user's recent SIP call history — the one who most recently
        // made/received a call is most likely the current caller
        try {
          const db = _phoneNumbersOf?.s?.db
          const callLogs = db ? db.collection('callLogs') : null
          let bestMatch = null
          let bestTime = 0
          if (callLogs) {
            for (const m of matches) {
              const recentCall = await callLogs.findOne(
                { chatId: m.chatId, direction: 'outbound' },
                { sort: { createdAt: -1 }, projection: { createdAt: 1 } }
              )
              const t = recentCall?.createdAt ? new Date(recentCall.createdAt).getTime() : 0
              if (t > bestTime) {
                bestTime = t
                bestMatch = m
              }
            }
          }
          if (bestMatch) {
            lookupResult = bestMatch
            sipUsername = bestMatch.credUsername
            log(`[Voice] Multi-match resolved by recent activity: ${sipUsername} → chatId ${lookupResult.chatId} (last call: ${new Date(bestTime).toISOString()})`)
          } else {
            // No call history — use MOST RECENTLY CREATED test credential from DB
            // This is the critical fix: when multiple test users share the same SIP connection,
            // the user who just created their credential (via /testsip) is the one calling.
            let resolvedByCreation = false
            try {
              const testCredsCollection = db ? db.collection('testCredentials') : null
              if (testCredsCollection) {
                const matchUsernames = matches.map(m => m.credUsername)
                const mostRecent = await testCredsCollection.find({
                  sipUsername: { $in: matchUsernames },
                  expired: { $ne: true }
                }).sort({ createdAt: -1 }).limit(1).toArray()
                
                if (mostRecent.length > 0) {
                  const recentCred = mostRecent[0]
                  const match = matches.find(m => m.credUsername === recentCred.sipUsername)
                  if (match) {
                    lookupResult = match
                    sipUsername = match.credUsername
                    resolvedByCreation = true
                    log(`[Voice] ✅ Multi-match resolved by most recent credential creation: ${sipUsername} → chatId ${lookupResult.chatId} (created: ${recentCred.createdAt?.toISOString?.() || 'unknown'})`)
                  }
                }
              }
            } catch (dbErr) {
              log(`[Voice] testCredentials lookup failed: ${dbErr.message}`)
            }
            
            if (!resolvedByCreation) {
              // Absolute last resort — use first match (with warning)
              lookupResult = matches[0]
              sipUsername = matches[0].credUsername
              log(`[Voice] ⚠️ Multiple SIP credential matches, no call history AND no testCredentials resolution — using first: ${sipUsername} → chatId ${lookupResult.chatId}`)
            }
          }
        } catch (e) {
          // Call history check failed — try testCredentials creation time as fallback
          let resolvedByCreation = false
          try {
            const db2 = _phoneNumbersOf?.s?.db
            const testCredsCollection = db2 ? db2.collection('testCredentials') : null
            if (testCredsCollection) {
              const matchUsernames = matches.map(m => m.credUsername)
              const mostRecent = await testCredsCollection.find({
                sipUsername: { $in: matchUsernames },
                expired: { $ne: true }
              }).sort({ createdAt: -1 }).limit(1).toArray()
              
              if (mostRecent.length > 0) {
                const recentCred = mostRecent[0]
                const match = matches.find(m => m.credUsername === recentCred.sipUsername)
                if (match) {
                  lookupResult = match
                  sipUsername = match.credUsername
                  resolvedByCreation = true
                  log(`[Voice] ✅ Multi-match resolved by credential creation (call history err: ${e.message}): ${sipUsername} → chatId ${lookupResult.chatId}`)
                }
              }
            }
          } catch (_) { /* ignore nested error */ }
          
          if (!resolvedByCreation) {
            lookupResult = matches[0]
            sipUsername = matches[0].credUsername
            log(`[Voice] ⚠️ Multiple SIP credential matches (activity check failed: ${e.message}) — using first: ${sipUsername} → chatId ${lookupResult.chatId}`)
          }
        }
        log(`[Voice] Other matches: ${matches.filter(m => m.credUsername !== sipUsername).map(m => `${m.credUsername}→${m.chatId}`).join(', ')}`)
      } else {
        log(`[Voice] Telnyx reverse lookup found no matching users with active numbers`)
      }
    } catch (e) {
      log(`[Voice] Telnyx credentials reverse lookup error: ${e.message}`)
    }
  }
  
  const { chatId, num, expiredTest, expiredSipUser } = lookupResult

  // ── EXPIRED TEST CREDENTIAL: silent drop to prevent auto-route retry storm ──
  // When a test SIP user exhausts their free calls, the credential is marked expired.
  // But the SIP client stays registered and keeps re-dialing → Telnyx auto-routes →
  // webhook → "No owner found" → hangup → auto-route again → infinite loop.
  // Fix: detect expired test credentials, add to temporary block set, and hard-block.
  if (expiredTest) {
    const blockKey = expiredSipUser || sipUsername
    if (!_expiredTestBlockSet.has(blockKey)) {
      log(`[Voice] Expired test credential ${blockKey} — adding to 10-min block set (auto-route prevention)`)
      _expiredTestBlockSet.set(blockKey, Date.now())
      // Notify the user once that their test expired
      if (lookupResult.expiredChatId && _bot) {
        const lang = await _getUserLang(lookupResult.expiredChatId)
        const msg = _trans('vs.testCallsExpired', lang)
        if (msg) _bot.sendMessage(lookupResult.expiredChatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      }
    }
    try { await _telnyxApi.hangupCall(callControlId) } catch (e) { /* silent */ }
    return
  }

  if (!chatId || !num) {
    const nowBlocked = (credentialExtracted && sipUsername) ? _recordUnidentifiedFailure(sipUsername) : false
    log(`[Voice] Outbound SIP: No owner found for SIP user ${sipUsername}, rejecting${nowBlocked ? ` — ${UNIDENTIFIED_FAIL_THRESHOLD} consecutive failures, credential BLOCKED for ${UNIDENTIFIED_BLOCK_DURATION / 60000}min to stop billable-leg cost leak` : ''}`)
    // Cost-leak visibility: record the unbillable billable-leg so the operator can see/reconcile it.
    try {
      const db = _phoneNumbersOf?.s?.db
      if (db) db.collection('unidentifiedCallLeaks').insertOne({
        sipUsername: sipUsername || null, from: fromClean || null, destination: destination || null,
        callControlId, isAutoRouted: !!isAutoRouted, blocked: nowBlocked, createdAt: new Date(),
      }).catch(() => {})
    } catch (e) { /* non-critical */ }
    try {
      await _telnyxApi.hangupCall(callControlId)
    } catch (e) { log(`[Voice] Reject error: ${e.message}`) }
    return
  }
  // Identification succeeded — clear any prior unidentified-failure state for this credential.
  if (credentialExtracted && sipUsername) _clearUnidentifiedFailure(sipUsername)

  // ── TEST OUTBOUND SIP HOOK ──
  // If this user has an active "Test Outbound SIP" session, short-circuit the call:
  // hang up cleanly (no PSTN leg, no wallet charge, no connection fee) and report back.
  if (_testOutboundSipMatch) {
    try {
      const intercepted = await _testOutboundSipMatch(chatId, num, sipUsername, {
        provider: num.provider,
        destination,
        callControlId,
        autoRouted: isAutoRouted,
      })
      if (intercepted) {
        log(`[Voice] Outbound SIP test intercept: ${sipUsername} → ${destination} (chatId=${chatId}) — hung up, no billing`)
        return
      }
    } catch (e) {
      log(`[Voice] testOutboundSipMatch error (non-fatal): ${e.message}`)
    }
  }

  // ── POST-IDENTIFICATION WALLET COOLDOWN CHECK ──
  // For shared-connection calls (where early cooldown was skipped because fromClean is shared),
  // we now check using the USER-SPECIFIC chatId. This ensures only the specific low-balance user
  // is blocked, not all users on the SIP connection.
  const userCooldownKey = `chatId:${chatId}`
  if (isWalletRejectCooldown(userCooldownKey)) {
    const cooldownEntry = walletRejectCooldown[userCooldownKey]
    const hitCount = cooldownEntry?.hitCount || 1
    const effectiveDuration = getEscalatedCooldownMs(hitCount)
    // Reduced logging after first few hits
    if (hitCount <= 3) {
      log(`[Voice] ⚠️ WALLET COOLDOWN (post-ID): chatId ${chatId} (${num.phoneNumber}) — rejected (hit #${hitCount}, cooldown=${effectiveDuration / 60000}min)`)
    } else if (hitCount % 10 === 0) {
      log(`[Voice] ⚠️ WALLET COOLDOWN (post-ID): chatId ${chatId} — still blocked (hit #${hitCount}, cooldown=${effectiveDuration / 60000}min)`)
    }
    // Suppress notification spam — only send first N
    if (_bot && shouldSendWalletCooldownNotification(userCooldownKey)) {
      markWalletCooldownNotified(userCooldownKey)
      const lang = await _getUserLang(chatId)
      const baseMsg = _trans('vs.outboundCallingLocked', lang)
      const fullMsg = baseMsg + 
        `Your wallet balance has dropped below $${LOW_BALANCE_TRIGGER}. To protect your account, outbound calls are temporarily locked.\n\n` +
        `💰 <b>Top up at least $${LOW_BALANCE_RESUME}</b> to resume calling.\n` +
        `Use 👛 <b>Wallet</b> to add funds.`
      if (baseMsg) _bot.sendMessage(chatId, fullMsg, { parse_mode: 'HTML' }).catch(() => {})
    }
    try {
      await _telnyxApi.hangupCall(callControlId)
    } catch (e) { /* silently reject */ }
    return
  }

  // Number suspended check
  if (num.status !== 'active') {
    log(`[Voice] Outbound SIP: Number ${num.phoneNumber} is ${num.status}, rejecting`)
    try {
      await _telnyxApi.hangupCall(callControlId)
    } catch (e) { log(`[Voice] Reject error: ${e.message}`) }
    const lang = await _getUserLang(chatId)
    const msg = _trans('vs.outboundCallBlocked', lang, formatPhone(num.phoneNumber), formatPhone(destination), num.status)
    if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    return
  }

  // Wallet balance check — outbound calls charge directly from wallet (plan minutes are for inbound only)
  const sipRate = getCallRate(destination)
  const minRequired = sipRate + CALL_CONNECTION_FEE  // Per-minute rate + connection fee
  if (_walletOf) {
    try {
      const walletCheck = await smartWalletCheck(_walletOf, chatId, minRequired)
      // ── Concurrency Guard: subtract funds already committed to in-flight
      // outbound calls so simultaneous dials can't collectively overspend. ──
      const reservedNow = _reservedTotal(chatId)
      const availableBal = walletCheck.usdBal - reservedNow
      const availableSufficient = availableBal >= minRequired
      if (reservedNow > 0) {
        log(`[Voice] Concurrency Guard: chatId ${chatId} balance $${walletCheck.usdBal.toFixed(2)} − reserved $${reservedNow.toFixed(2)} = available $${availableBal.toFixed(2)} (need $${minRequired.toFixed(2)})`)
      }

      // ── LOW BALANCE LOCK ──
      // When AVAILABLE USD balance (net of in-flight reservations) drops below
      // $1, lock outbound calling entirely. User must top up to $50+ to resume.
      if (availableBal < LOW_BALANCE_TRIGGER) {
        log(`[Voice] Outbound SIP: LOW BALANCE LOCK for ${num.phoneNumber} → ${destination} (Available: $${availableBal.toFixed(2)} < $${LOW_BALANCE_TRIGGER} trigger [balance $${walletCheck.usdBal.toFixed(2)}, reserved $${reservedNow.toFixed(2)}], need $${LOW_BALANCE_RESUME} to resume)`)
        // Use chatId-based key so only THIS user is cooldown-blocked, not all users on the shared SIP connection
        setWalletRejectCooldown(`chatId:${chatId}`, chatId)
        if (credentialExtracted) setWalletRejectCooldown(sipUsername, chatId) // Also cache by SIP username for early check
        // ── PRE-DIAL: Add to instant-block list so ALL future calls are rejected in <1ms ──
        // Only hard-block by SIP username when the ACTUAL balance is low (not merely
        // reserved), otherwise concurrent in-flight calls would wrongly lock the user
        // out even though their real balance recovers as each call settles.
        if (credentialExtracted && sipUsername && walletCheck.usdBal < LOW_BALANCE_TRIGGER) {
          addSipPreDialBlock(sipUsername, chatId, 'low_balance', num.phoneNumber)
          log(`[Voice] PRE-DIAL: Added ${sipUsername} to instant-block list (balance $${walletCheck.usdBal.toFixed(2)})`)
        }
        // Use rejectCall for non-auto-routed calls (prevents PSTN leg from being created = zero cost)
        if (isAutoRouted) {
          await _telnyxApi.hangupCall(callControlId)
        } else {
          await _telnyxApi.rejectCall(callControlId, 'CALL_REJECTED')
        }
        const lang = await _getUserLang(chatId)
        const baseMsg = _trans('vs.outboundCallingLocked', lang) || LOCK_FALLBACK_HEADER
        const reservedNote = reservedNow > 0
          ? `\n\n(You have other calls in progress reserving <b>$${reservedNow.toFixed(2)}</b>.)`
          : ''
        const fullMsg = baseMsg + 
          `Your available wallet balance (<b>$${availableBal.toFixed(2)}</b>) is below $${LOW_BALANCE_TRIGGER}. To protect your account, outbound calls are temporarily locked.${reservedNote}\n\n` +
          `💰 <b>Top up at least $${LOW_BALANCE_RESUME}</b> to resume calling.\n` +
          `Use 👛 <b>Wallet</b> to add funds.`
        _bot?.sendMessage(chatId, fullMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Top Up Now', callback_data: 'wallet_topup_quick' }]] } }).catch(() => {})
        return
      }

      if (!availableSufficient) {
        log(`[Voice] Outbound SIP: wallet too low for ${num.phoneNumber} → ${destination} (Available: $${availableBal.toFixed(2)} [balance $${walletCheck.usdBal.toFixed(2)}, reserved $${reservedNow.toFixed(2)}])`)
        setWalletRejectCooldown(`chatId:${chatId}`, chatId)
        if (credentialExtracted && walletCheck.usdBal < minRequired) setWalletRejectCooldown(sipUsername, chatId)
        if (isAutoRouted) {
          await _telnyxApi.hangupCall(callControlId)
        } else {
          await _telnyxApi.rejectCall(callControlId, 'CALL_REJECTED')
        }
        const lang = await _getUserLang(chatId)
        const region = isUSCanada(destination) ? 'US/CA' : 'Intl'
        const msg = _trans('vs.sipCallBlocked', lang, sipRate, CALL_CONNECTION_FEE, region, availableBal.toFixed(2), 0)
          || `🚫 <b>SIP Call Blocked</b> — wallet balance too low (need $${sipRate}/min + $${CALL_CONNECTION_FEE} connect fee ${region}).\nBalance: $${availableBal.toFixed(2)}\n💰 Top up via 👛 <b>Wallet</b> to resume calling.`
        _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        return
      }
    } catch (e) { log(`[Voice] Wallet check error: ${e.message}`) }
  }

  // ── Concurrency Guard: RESERVE this call's estimated not-yet-billed cost ──
  // Keyed by callControlId; released at hangup (+ TTL safety-net). This is what
  // lets the check above see funds committed to sibling calls started moments ago.
  _reserveOutbound(chatId, callControlId, sipRate * OUTBOUND_RESERVE_MINUTES)

  // ── CONNECTION FEE: Charge $CALL_CONNECTION_FEE per call attempt ──
  if (CALL_CONNECTION_FEE > 0 && _walletOf) {
    try {
      const feeResult = await smartWalletDeduct(_walletOf, chatId, CALL_CONNECTION_FEE, {
        type: 'connection_fee', callType: 'SIPOutbound',
        description: `Connection fee: ${num.phoneNumber} → ${destination}`,
        destination, phoneNumber: num.phoneNumber,
      })
      if (feeResult.success) {
        const feeRef = _nanoid?.() || `connfee_${Date.now()}`
        const feeStr = `$${CALL_CONNECTION_FEE.toFixed(2)}`
        if (_payments) set(_payments, feeRef, `ConnectionFee,SIPOutbound,$${CALL_CONNECTION_FEE.toFixed(2)},${chatId},${num.phoneNumber},${destination},${new Date()}`)
        log(`[Voice] Connection fee charged: ${feeStr} for ${num.phoneNumber} → ${destination}`)
      } else {
        log(`[Voice] Connection fee deduction failed (insufficient funds) — proceeding anyway`)
      }
    } catch (e) { log(`[Voice] Connection fee charge error: ${e.message}`) }
  }

  // ── TELNYX NUMBER: Route SIP call to PSTN via transfer command ──
  if (num.provider === 'telnyx') {
    const callerDisplay = num.phoneNumber || 'TEST-SIP'
    log(`[Voice] Outbound SIP (Telnyx): ${callerDisplay} → ${destination} — routing to PSTN`)

    // Check if this is a test credential call (enforce limits)
    // FIX: Pass chatId for fallback lookup when credential extraction fails on auto-routed calls
    let testCallInfo = { isTestCall: false }
    try {
      const { checkTestCredentialCall } = require('./phone-test-routes.js')
      testCallInfo = await checkTestCredentialCall(sipUsername, chatId)
      if (testCallInfo.isTestCall) {
        log(`[Voice] TEST CALL detected — max ${testCallInfo.maxDuration}s, ${testCallInfo.callsRemaining} calls remaining`)
        if (testCallInfo.callsRemaining < 0) {
          log(`[Voice] TEST CALL LIMIT EXCEEDED for chatId ${chatId} — hanging up`)
          try { await _telnyxApi.hangupCall(callControlId) } catch (e) { /* already ended */ }
          return
        }
        // Strict rate limit for test calls — 2 calls per 2 minutes
        if (!checkTestCallRateLimit(chatId)) {
          log(`[Voice] ⚠️ TEST CALL RATE LIMIT: chatId ${chatId} — exceeded ${TEST_CALL_RATE_MAX} test calls/${TEST_CALL_RATE_WINDOW/1000}s, rejecting`)
          try { await _telnyxApi.hangupCall(callControlId) } catch (e) { /* already ended */ }
          return
        }
      }
    } catch (e) { /* phone-test-routes not loaded, ignore */ }

    activeCalls[callControlId] = {
      chatId,
      num,
      from: num.phoneNumber,
      to: destination,
      startedAt: new Date(),
      phase: 'outbound_telnyx',
      direction: 'outgoing',
      recordingEnabled: num.features?.recording === true,
      isTestCall: testCallInfo.isTestCall,
    }

    // Auto-hangup for test calls after max duration
    if (testCallInfo.isTestCall && testCallInfo.maxDuration) {
      const maxMs = testCallInfo.maxDuration * 1000
      setTimeout(async () => {
        if (activeCalls[callControlId]) {
          log(`[Voice] Test call time limit (${testCallInfo.maxDuration}s) reached — hanging up ${callControlId}`)
          await _telnyxApi.hangupCall(callControlId).catch(() => {})
        }
      }, maxMs)
    }

    // Mid-call wallet monitor — outbound calls billed from wallet only (plan minutes are for inbound)
    if (!testCallInfo.isTestCall) {
      const outboundSession = activeCalls[callControlId]
      outboundSession._limitTimer = setInterval(async () => {
        const sess = activeCalls[callControlId]
        if (!sess) { clearInterval(outboundSession._limitTimer); return }
        const rate = getCallRate(destination)
        // Check wallet balance each minute
        if (_walletOf) {
          try {
            const deductResult = await smartWalletDeduct(_walletOf, chatId, rate, {
              type: 'sip_per_minute', callType: 'SIPOutbound',
              description: `SIP call: ${num.phoneNumber} → ${destination} ($${rate}/min)`,
              destination, phoneNumber: num.phoneNumber,
            })
            if (!deductResult.success) {
              log(`[Voice] Mid-call wallet exhausted for outbound ${num.phoneNumber}: insufficient funds. Disconnecting.`)
              clearInterval(outboundSession._limitTimer)
              sess._limitDisconnect = true
              await _telnyxApi.hangupCall(callControlId).catch(() => {})
              const lang = await _getUserLang(chatId)
              const msg = _trans('vs.callDisconnectedWalletExhausted', lang)
              if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
              return
            }
          } catch (e) { log(`[Voice] Mid-call wallet check error: ${e.message}`) }
        }
      }, 60000)
    }

    // ── MULTI-USER CALLER ID FIX ──
    // Always set per-call ANI via transferCall for ALL outbound SIP calls.
    // Auto-routed calls use the shared SIP connection ANI override,
    // which is a single global value — wrong for multi-user. transferCall's `from` param
    // overrides this per-call, ensuring each user's correct phone number displays as caller ID.

    try {
      const callState = activeCalls[callControlId]
      if (callState && callState.phase === 'outbound_telnyx') {
        callState._pendingTransfer = { destination, callerNumber: num.phoneNumber }
      }
      // Tag the NEW PSTN leg so its own call.initiated is skipped (no reverse lookup / re-route).
      _markSelfPstnLeg(payload.connection_id, destination, num.phoneNumber)
      await _telnyxApi.transferCall(callControlId, destination, num.phoneNumber, { targetLegClientState: PSTN_LEG_STATE })
      log(`[Voice] Outbound SIP (Telnyx): Transfer initiated ${callerDisplay} → ${destination} (autoRouted=${isAutoRouted})`)
    } catch (e) {
      const errMsg = e.message || ''
      // Handle race condition: call not answered yet — schedule retry
      if (errMsg.includes('not been answered') || errMsg.includes('not answered')) {
        log(`[Voice] Outbound SIP (Telnyx): Transfer too early, scheduling retry for ${callControlId} → ${destination}`)
        const retryTransfer = async (retryCount = 0) => {
          if (retryCount >= 5) {
            log(`[Voice] Outbound SIP (Telnyx): Transfer retry exhausted for ${callControlId}`)
            return
          }
          await new Promise(r => setTimeout(r, 1500))
          try {
            _markSelfPstnLeg(payload.connection_id, destination, num.phoneNumber)
            await _telnyxApi.transferCall(callControlId, destination, num.phoneNumber, { targetLegClientState: PSTN_LEG_STATE })
            log(`[Voice] Outbound SIP (Telnyx): Transfer retry ${retryCount + 1} succeeded ${callerDisplay} → ${destination}`)
          } catch (retryErr) {
            if ((retryErr.message || '').includes('not been answered') || (retryErr.message || '').includes('not answered')) {
              return retryTransfer(retryCount + 1)
            }
            log(`[Voice] Outbound SIP (Telnyx): Transfer retry ${retryCount + 1} failed — ${retryErr.message}`)
          }
        }
        retryTransfer(0).catch(() => {})
      } else {
        log(`[Voice] Outbound SIP (Telnyx): Transfer failed — ${errMsg}`)
        if (isAutoRouted) {
          log(`[Voice] Outbound SIP (Telnyx): Auto-routed call may proceed with connection ANI — still tracking`)
        } else {
          const sess = activeCalls[callControlId]
          if (sess?._limitTimer) clearInterval(sess._limitTimer)
          delete activeCalls[callControlId]
          _releaseOutbound(chatId, callControlId) // Concurrency Guard: free reservation on transfer failure
          const lang = await _getUserLang(chatId)
          const msg = _trans('vs.outboundCallFailedRouting', lang, formatPhone(num.phoneNumber), formatPhone(destination))
          if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        }
      }
    }

    // Notify user about the outbound call
    if (testCallInfo.isTestCall) {
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.freeSipTestCall', lang, formatPhone(num.phoneNumber), formatPhone(destination), testCallInfo.callsRemaining ?? 0, testCallInfo.maxDuration)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    } else {
      let walletLine = ''
      if (_walletOf) {
        try {
          const { usdBal } = await getBalance(_walletOf, chatId)
          const estMinutes = Math.floor(usdBal / sipRate)
          const connFeeNote = CALL_CONNECTION_FEE > 0 ? ` + $${CALL_CONNECTION_FEE} connect fee` : ''
          walletLine = `💳 Wallet: <b>$${usdBal.toFixed(2)}</b> (~${estMinutes} min at $${sipRate}/min${connFeeNote} ${isUSCanada(destination) ? 'US/CA' : 'Intl'})`
        } catch (e) { /* ignore */ }
      }
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.sipOutboundCall', lang, formatPhone(num.phoneNumber), formatPhone(destination), walletLine)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }
    return
  }

  // ── TWILIO NUMBER: Bridge through Twilio SIP → Twilio PSTN ──
  if (num.provider === 'twilio') {
    if (!_twilioSipDomain) {
      log(`[Voice] Outbound SIP (Twilio): No Twilio SIP domain available, rejecting`)
      await _telnyxApi.hangupCall(callControlId)
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.outboundCallFailedTempUnavailable', lang, formatPhone(num.phoneNumber), formatPhone(destination))
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      return
    }

    // ── CRITICAL: Answer the call IMMEDIATELY to STOP Telnyx auto-routing ──
    // This MUST happen BEFORE any DB queries or API calls. Even a 50-100ms delay allows
    // Telnyx to auto-route the call via the SIP Connection's outbound voice profile.
    // The auto-routed call uses the wrong caller ID (connection-level ANI override, not
    // the user's Twilio number), causing the callee to reject → call dies → our transfer fails.
    // Answering immediately claims the call on Telnyx's side, preventing the auto-route race.
    try {
      await _telnyxApi.answerCall(callControlId)
      log(`[Voice] Outbound SIP (Twilio): Answered call IMMEDIATELY to prevent auto-routing race`)
    } catch (ansErr) {
      await _abandonBridge({ chatId, num, destination, callControlId, reason: `answer failed: ${ansErr.message}` })
      return
    }

    // ── PRE-FLIGHT: Ensure sub-account credentials are available before bridge attempt ──
    // If credentials are missing from num, recover them proactively so both the bridge
    // and the direct-call fallback have what they need.
    // This happens AFTER answering to avoid any delay that could trigger auto-routing.
    if (!num.twilioSubAccountToken || !num.subAccountAuthToken) {
      try {
        const userData = await _phoneNumbersOf.findOne({ _id: chatId })
        const subSid = num.twilioSubAccountSid || userData?.val?.twilioSubAccountSid
        let subToken = userData?.val?.twilioSubAccountToken
        if (subSid && !subToken && _twilioService) {
          const subAcct = await _twilioService.getSubAccount(subSid)
          if (subAcct?.authToken && !subAcct.error) {
            subToken = subAcct.authToken
            await _phoneNumbersOf.updateOne({ _id: chatId }, { $set: { 'val.twilioSubAccountSid': subSid, 'val.twilioSubAccountToken': subToken } })
            log(`[Voice] Pre-flight: Recovered & persisted sub-account token for chatId=${chatId}`)
          }
        }
        if (subSid) num.subAccountSid = subSid
        if (subToken) num.subAccountAuthToken = subToken
      } catch (e) { log(`[Voice] Pre-flight credential check error: ${e.message}`) }
    }

    log(`[Voice] Outbound SIP (Twilio): Bridging ${num.phoneNumber} → ${destination} via ${_twilioSipDomain}`)

    // Generate unique bridge ID
    const bridgeId = `bridge_${_nanoid ? _nanoid() : Date.now()}`

    // Store bridge context for the Twilio SIP voice handler to pick up
    pendingBridges[bridgeId] = {
      twilioNumber: num.phoneNumber,
      destination,
      chatId,
      num,
      callControlId,
      selfUrl: _selfUrl,
      createdAt: Date.now(),
    }

    // Auto-expire bridge after 60s to prevent memory leaks
    setTimeout(() => { delete pendingBridges[bridgeId] }, 60000)

    // Store session for tracking
    activeCalls[callControlId] = {
      chatId,
      num,
      from: num.phoneNumber,
      to: destination,
      startedAt: new Date(),
      phase: 'outbound_twilio_bridge',
      direction: 'outgoing',
      bridgeId,
      alive: true,  // Track if call is still active for race condition detection
    }

    // ── Mid-call wallet monitor for Twilio bridge calls ──
    // Outbound calls charge directly from wallet (plan minutes are for inbound only).
    // Without this, a Twilio bridge call could run indefinitely with exhausted wallet.
    const bridgeSession = activeCalls[callControlId]
    bridgeSession._limitTimer = setInterval(async () => {
      const sess = activeCalls[callControlId]
      if (!sess) { clearInterval(bridgeSession._limitTimer); return }
      const rate = getCallRate(destination)
      if (_walletOf) {
        try {
          const deductResult = await smartWalletDeduct(_walletOf, chatId, rate, {
            type: 'twilio_bridge_per_minute', callType: 'TwilioBridge',
            description: `Twilio bridge: ${num.phoneNumber} → ${destination} ($${rate}/min)`,
            destination, phoneNumber: num.phoneNumber,
          })
          if (!deductResult.success) {
            log(`[Voice] Mid-call wallet exhausted for Twilio bridge ${num.phoneNumber} → ${destination}. Disconnecting.`)
            clearInterval(bridgeSession._limitTimer)
            sess._limitDisconnect = true
            // Hang up the Telnyx SIP leg — Twilio PSTN leg will end automatically
            await _telnyxApi.hangupCall(callControlId).catch(() => {})
            const lang = await _getUserLang(chatId)
            const msg = _trans('vs.callDisconnectedWalletExhausted', lang)
            if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
            return
          }
        } catch (e) { log(`[Voice] Mid-call wallet check error (Twilio bridge): ${e.message}`) }
      }
    }, 60000)

    // ── Strategy: Use a valid Telnyx number as 'from' for the SIP transfer ──
    // The user's Twilio number can't be used as 'from' on Telnyx (D51 error).
    // The connection ANI override may also be set to a non-Telnyx number.
    // Solution: Use TELNYX_DEFAULT_ANI (a verified Telnyx number) as 'from'.
    // The Twilio SIP handler (/twilio/sip-voice) will use the correct Twilio
    // number as caller ID for the final PSTN leg.
    let telnyxDefaultAni = process.env.TELNYX_DEFAULT_ANI || ''

    // ── DEFENSIVE: If TELNYX_DEFAULT_ANI is missing or invalid, find a valid Telnyx number ──
    // Query the account's phone numbers on the SIP connection and use the first one.
    if (!telnyxDefaultAni) {
      try {
        const sipNumbers = await _telnyxApi.listNumbers()
        const sipConnId = process.env.TELNYX_SIP_CONNECTION_ID || ''
        const validNum = (sipNumbers || []).find(n =>
          n.status === 'active' && String(n.connection_id) === String(sipConnId)
        )
        if (validNum) {
          telnyxDefaultAni = validNum.phone_number
          log(`[Voice] No TELNYX_DEFAULT_ANI configured — using ${telnyxDefaultAni} from SIP connection`)
        }
      } catch (e) { log(`[Voice] Dynamic ANI lookup failed: ${e.message}`) }
    }

    const sipUri = `sip:${bridgeId}@${_twilioSipDomain}`

    // ── FIX: Restore ANI to user's actual number after transfer attempt ──
    // Setting ANI to TELNYX_DEFAULT_ANI causes a problem: if the user retries their SIP call
    // (e.g., after a failed transfer), the auto-routed call arrives with from=TELNYX_DEFAULT_ANI
    // and findNumberBySipUser can't match it to any owner → "No owner found", call rejected.
    // We still use TELNYX_DEFAULT_ANI for the transfer 'from' param, but we restore the
    // connection-level ANI back to the user's number afterward so retries are identifiable.
    const sipConnectionId = process.env.TELNYX_SIP_CONNECTION_ID || ''

    // ── CRITICAL FIX: Add small delay to allow call to stabilize before transfer ──
    // Some calls receive immediate 603 (user_busy) rejection. If we try to transfer before
    // the hangup webhook arrives, we get "call is no longer active" error + double billing.
    // Wait 200ms for potential immediate rejections to be caught.
    await new Promise(resolve => setTimeout(resolve, 200))

    // ── CHECK: Is the call still alive? The hangup handler already billed/notified/cleaned up. ──
    const callSession = activeCalls[callControlId]
    if (!callSession || callSession.alive === false) {
      await _abandonBridge({ chatId, num, destination, bridgeId, callControlId, reason: 'SIP caller hung up before transfer', notify: false })
      return
    }

    try {
      log(`[Voice] Transferring SIP call to Twilio: ${sipUri} (from=${telnyxDefaultAni || 'none'})`)
      const transferResult = await _telnyxApi.transferCall(callControlId, sipUri, telnyxDefaultAni || undefined)

      if (!transferResult) {
        await _abandonBridge({ chatId, num, destination, bridgeId, callControlId, reason: 'Telnyx transfer returned null' })
        return
      }
    } catch (e) {
      await _abandonBridge({ chatId, num, destination, bridgeId, callControlId, reason: `Telnyx→Twilio transfer failed: ${e.message}` })
      return
    }

    // NOTE: Do NOT restore connection-level ANI to user's number.
    // The ANI was set to a verified LOCAL number at startup for STIR/SHAKEN attestation.
    // Overwriting with toll-free/Twilio numbers causes auto-routed call rejections.

    // Notify user
    if (_walletOf) {
      try {
        const { usdBal } = await getBalance(_walletOf, chatId)
        const estMinutes = Math.floor(usdBal / sipRate)
        const connFeeNote = CALL_CONNECTION_FEE > 0 ? ` + $${CALL_CONNECTION_FEE} connect fee` : ''
        const lang = await _getUserLang(chatId)
        const msg = _trans('vs.sipOutboundCallWithRate', lang, formatPhone(num.phoneNumber), formatPhone(destination), sipRate, connFeeNote, estMinutes)
        if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      } catch (e) { /* ignore */ }
    }
    return
  }

  // Unknown provider — reject gracefully without trying to answer outbound calls
  log(`[Voice] Outbound SIP: Unknown provider '${num.provider}' for ${num.phoneNumber}`)
  try {
    // Only attempt answer+speak on incoming calls; outbound calls can't be answered
    if (payload.direction === 'incoming') {
      await _telnyxApi.answerCall(callControlId)
      await _telnyxApi.speakOnCall(callControlId, 'Outbound calling is not available for this number.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 3000)
    } else {
      log(`[Voice] Outbound SIP: Skipping answer/speak for outbound call (not an incoming SIP call)`)
    }
  } catch (e) {
    log(`[Voice] Reject error: ${e.message}`)
  }
}

// Find a phone number record by SIP username (across all providers)
// connectionPhoneNumber: the SIP connection's default number (e.g. +18889020132)
// When from=connectionPhoneNumber, we must NOT match by phone number (it would match wrong user)
async function findNumberBySipUser(sipUsername, fromPhone, connectionPhoneNumber) {
  try {
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    for (const user of allUsers) {
      const numbers = user.val?.numbers || []
      for (const num of numbers) {
        if (num.status !== 'active' && num.status !== 'suspended') continue
        // Match by SIP username (Telnyx gencred or legacy)
        if (num.telnyxSipUsername && num.telnyxSipUsername === sipUsername) {
          return { chatId: user._id, num }
        }
        if (num.sipUsername && num.sipUsername === sipUsername) {
          return { chatId: user._id, num }
        }
        // Match by phone number (in case 'from' is the phone number)
        // CRITICAL: Skip phone number matching if 'from' is the SIP connection's own number
        // because that number belongs to a different user — not the actual SIP caller
        if (fromPhone && (!connectionPhoneNumber || fromPhone !== connectionPhoneNumber)) {
          const normalizedFrom = fromPhone.replace(/^\+/, '')
          const normalizedNum = num.phoneNumber?.replace(/[^+\d]/g, '').replace(/^\+/, '')
          if (normalizedFrom === normalizedNum) {
            return { chatId: user._id, num }
          }
        }
      }
    }

    // Fallback: check testCredentials — test SIP users won't be in phoneNumbersOf
    // All test calls route through @hostbay_support's phone number plan
    const TEST_ACCOUNT_CHAT_ID = 5168006768
    const db = _phoneNumbersOf?.s?.db
    if (db) {
      const testCred = await db.collection('testCredentials').findOne({
        sipUsername, expired: { $ne: true }
      })
      if (testCred) {
        log(`[Voice] Found test credential for SIP user ${sipUsername}, chatId=${testCred.chatId} — routing via test account ${TEST_ACCOUNT_CHAT_ID}`)
        // Always use @hostbay_support's phone number for test calls
        const testAccountDoc = await _phoneNumbersOf.findOne({ _id: TEST_ACCOUNT_CHAT_ID })
        const testNumbers = testAccountDoc?.val?.numbers || []
        const testNum = testNumbers.find(n => n.status === 'active')
        if (testNum) {
          return { chatId: testCred.chatId, num: testNum, isTestCall: true }
        }
        // FALLBACK: Test account has no active number — create a virtual test number
        // using TELNYX_DEFAULT_ANI so test calls can still be routed via the SIP connection
        const fallbackAni = process.env.TELNYX_DEFAULT_ANI
        if (fallbackAni) {
          log(`[Voice] Test account ${TEST_ACCOUNT_CHAT_ID} has no active number — using TELNYX_DEFAULT_ANI ${fallbackAni} as fallback for test call`)
          const virtualTestNum = {
            phoneNumber: fallbackAni,
            provider: 'telnyx',
            status: 'active',
            plan: 'test',
            _isVirtualTestNumber: true
          }
          return { chatId: testCred.chatId, num: virtualTestNum, isTestCall: true }
        }
        log(`[Voice] Test account ${TEST_ACCOUNT_CHAT_ID} has no active number and no TELNYX_DEFAULT_ANI fallback — cannot route test call`)
      }

      // ── EXPIRED TEST CREDENTIAL DETECTION ──
      // If the SIP user has an expired test credential, return a special marker
      // so handleOutboundSipCall() can silently reject instead of logging "No owner found"
      // and triggering Telnyx auto-route retry storms.
      const expiredCred = await db.collection('testCredentials').findOne({ sipUsername, expired: true })
      if (expiredCred) {
        return { chatId: null, num: null, expiredTest: true, expiredSipUser: sipUsername, expiredChatId: expiredCred.chatId }
      }
    }

    return {}
  } catch (e) {
    log(`[Voice] findNumberBySipUser error: ${e.message}`)
    return {}
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CALL ANSWERED — Route based on features
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleCallAnswered(payload) {
  const callControlId = payload.call_control_id
  const session = activeCalls[callControlId]
  if (!session) {
    log(`[Voice] handleCallAnswered: NO SESSION for cc=${callControlId} (likely outbound or expired) — skipping`)
    return
  }

  const { num, chatId, to, from } = session
  log(`[Voice] handleCallAnswered: chatId=${chatId} to=${to} from=${from} phase=${session.phase} hasFwd=${!!num.features?.callForwarding?.enabled}(${num.features?.callForwarding?.mode || 'n/a'}→${num.features?.callForwarding?.forwardTo || 'n/a'}) hasIvr=${!!num.features?.ivr?.enabled} hasVm=${!!num.features?.voicemail?.enabled}`)

  // Outbound SIP calls: skip inbound feature routing (IVR, forwarding, voicemail)
  // Just start recording if enabled and update phase
  if (session.direction === 'outgoing' || session.phase === 'outbound_telnyx' || session.phase === 'outbound_twilio_bridge') {
    log(`[Voice] Outbound call answered: ${from} → ${to} (phase: ${session.phase})`)
    if (session.recordingEnabled) {
      log(`[Voice] Starting call recording for outbound ${num.phoneNumber}`)
      await _telnyxApi.startRecording(callControlId, 'single')
      session.isRecording = true
    }
    session.phase = session.phase === 'outbound_telnyx' ? 'outbound_telnyx_active' : session.phase
    return
  }

  // Start recording if Business plan + recording enabled
  if (session.recordingEnabled) {
    log(`[Voice] Starting call recording for ${num.phoneNumber}`)
    await _telnyxApi.startRecording(callControlId, 'single')
    session.isRecording = true
  }

  // Route based on features priority:
  //   Forwarding(always) > IVR > Forwarding(busy) > Forwarding(no_answer) > Ring SIP Device > Voicemail > Missed Call
  // NOTE: Forwarding-mode "always" is deliberately the highest priority — it's an explicit user
  // statement that EVERY call should forward. If IVR were checked first, calls would always hit the
  // IVR menu and never forward (which is exactly the bug @wizardchop reported on +15162719167).
  const ivrConfig = num.features?.ivr
  const fwdConfig = num.features?.callForwarding
  const vmConfig = num.features?.voicemail

  // Helper: wallet pre-check before any forwarding action. Returns true if forwarding is allowed,
  // false if blocked (in which case it has already spoken/hung up + notified the user).
  async function _forwardingWalletGate() {
    if (!_walletOf) return true
    try {
      const { usdBal } = await getBalance(_walletOf, chatId)
      if (usdBal >= CALL_FORWARDING_RATE_MIN) {
        // De-duplicated, destination-aware low-balance nudge (shared with the post-billing alert)
        await notifyLowForwardingBalance(chatId, num.phoneNumber, fwdConfig.forwardTo)
        return true
      }
      log(`[Voice] Forwarding wallet check: $${usdBal} < $${CALL_FORWARDING_RATE_MIN} required — blocking forward`)
      await _telnyxApi.speakOnCall(callControlId, 'Your wallet balance is insufficient for call forwarding. Please top up your wallet.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 5000)
      const lang = await _getUserLang(chatId)
      const msg = _trans('vs.forwardingBlocked', lang, usdBal.toFixed(2), CALL_FORWARDING_RATE_MIN)
      if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      return false
    } catch (e) {
      log(`[Voice] Forwarding wallet check error: ${e.message}`)
      return true // fail-open on transient wallet errors so we don't drop legit forwards
    }
  }

  // 1. Call Forwarding — "always" mode (highest priority — user explicitly opted in for every call)
  if (fwdConfig?.enabled && fwdConfig.forwardTo && (fwdConfig.mode || 'always') === 'always') {
    const allowed = await _forwardingWalletGate()
    if (!allowed) return
    session.phase = 'forwarding'
    session.forwardingRate = CALL_FORWARDING_RATE_MIN
    const rate = getCallRate(fwdConfig.forwardTo)
    const ivrSkipped = ivrConfig?.enabled && canAccessFeature(num.plan, 'ivr') && ivrConfig.options && Object.keys(ivrConfig.options).length > 0
    log(`[Voice] Forwarding call to ${fwdConfig.forwardTo} from ${to} (rate: $${rate}/min ${isUSCanada(fwdConfig.forwardTo) ? 'US/CA' : 'Intl'})${ivrSkipped ? ' — IVR skipped (always-forward overrides)' : ''}`)
    await playHoldMusicAndTransfer(callControlId, fwdConfig.forwardTo, to, fwdConfig)
    return
  }

  // 2. IVR — Business plan only (only reached when forwarding is NOT in "always" mode)
  if (ivrConfig?.enabled && canAccessFeature(num.plan, 'ivr') && ivrConfig.options && Object.keys(ivrConfig.options).length > 0) {
    session.phase = 'ivr'
    const greeting = ivrConfig.greeting || 'Thank you for calling. Please listen to the following options.'
    log(`[Voice] Starting IVR for ${num.phoneNumber}`)

    // (#9) Play audio greeting if available, otherwise use TTS
    if (ivrConfig.greetingAudioUrl) {
      await _telnyxApi.gatherDTMFWithAudio(callControlId, ivrConfig.greetingAudioUrl, {
        minDigits: 1,
        maxDigits: 1,
        timeout: 15000,
        validDigits: Object.keys(ivrConfig.options).join(''),
      })
    } else {
      await _telnyxApi.gatherDTMF(callControlId, greeting, {
        minDigits: 1,
        maxDigits: 1,
        timeout: 15000,
        validDigits: Object.keys(ivrConfig.options).join(''),
      })
    }
    return
  }

  // 3. Call Forwarding — "busy" / "no_answer" modes
  if (fwdConfig?.enabled && fwdConfig.forwardTo) {
    const allowed = await _forwardingWalletGate()
    if (!allowed) return

    session.phase = 'forwarding'
    session.forwardingRate = CALL_FORWARDING_RATE_MIN
    const mode = fwdConfig.mode || 'always'

    if (mode === 'busy') {
      // Detect busy: check if there's already another active call for this phone number
      const isNumberBusy = Object.values(activeCalls).some(s =>
        s !== session && s.to === to && s.phase !== 'ended' && s.phase !== 'voicemail_greeting'
      )
      if (isNumberBusy) {
        const rate = getCallRate(fwdConfig.forwardTo)
        log(`[Voice] Number ${to} is BUSY (concurrent call detected) — forwarding to ${fwdConfig.forwardTo} (rate: $${rate}/min)`)
        await playHoldMusicAndTransfer(callControlId, fwdConfig.forwardTo, to, fwdConfig)
        const lang = await _getUserLang(chatId)
        const msg = _trans('vs.forwardedBusy', lang, formatPhone(from), formatPhone(fwdConfig.forwardTo))
        if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        return
      }
      // Not busy — don't forward, fall through to SIP ring / voicemail / missed
      log(`[Voice] Number ${to} is NOT busy — skipping forward-when-busy, falling through to next handler`)
      session.phase = 'answering' // Reset phase so next handler picks up
    } else if (mode === 'no_answer') {
      session.phase = 'ringing'
      session.forwardAfterTimeout = true
      session.forwardingRate = CALL_FORWARDING_RATE_MIN
      const ringTime = (fwdConfig.ringTimeout || 25) * 1000
      // Play ringback tone to caller during the wait (prevents silence)
      if (!num.sipUsername) {
        _telnyxApi.playbackStart(callControlId, RINGBACK_URL, { loop: 'infinity' }).catch(e => {
          log(`[Voice] Ringback playback during no-answer wait failed: ${e.message}`)
        })
      }
      setTimeout(async () => {
        const current = activeCalls[callControlId]
        if (current && current.phase === 'ringing') {
          const rate = getCallRate(fwdConfig.forwardTo)
          log(`[Voice] No answer after ${fwdConfig.ringTimeout}s, forwarding to ${fwdConfig.forwardTo} from ${to} (rate: $${rate}/min ${isUSCanada(fwdConfig.forwardTo) ? 'US/CA' : 'Intl'})`)
          current.phase = 'forwarding'
          await playHoldMusicAndTransfer(callControlId, fwdConfig.forwardTo, to, fwdConfig)
        }
      }, ringTime)
      return
    }
  }

  // 4. Ring SIP device — only reached when call was already answered (IVR/fwd-busy/no_answer fallthrough or SIP ring failed in handleCallInitiated)
  // Primary unanswered SIP ring is handled in handleCallInitiated
  if (num.sipUsername && session.phase !== 'ringing_sip') {
    session.phase = 'ringing_sip'
    const sipUser = num.telnyxSipUsername || num.sipUsername
    const sipUri = `sip:${sipUser}@sip.telnyx.com`
    const ringTimeout = fwdConfig?.ringTimeout || 25
    log(`[Voice] Ringing SIP device (answered path): ${sipUri} for ${num.phoneNumber} (timeout: ${ringTimeout}s)`)

    // Play ringback tone to the CALLER while the SIP device rings
    _telnyxApi.playbackStart(callControlId, RINGBACK_URL, { loop: 'infinity' }).catch(e => {
      log(`[Voice] Ringback playback failed: ${e.message}`)
    })

    try {
      // Use Call Control App ID — POST /v2/calls only accepts Call Control Apps, not SIP Connection IDs
      // The SIP device registered on the credential connection is reachable via its SIP URI
      const newCall = await _telnyxApi.createOutboundCall(from, sipUri)
      // Pass original caller's number as 'from' so SIP device shows correct caller ID
      if (newCall?.callControlId) {
        // Track as SIP ring bridge — handleBridgeTransferAnswered/Hangup handles the rest
        activeBridgeTransfers[newCall.callControlId] = {
          originalCallControlId: callControlId,
          forwardTo: sipUri,
          fromNumber: to,
          type: 'sip_ring',
          vmConfig,
          fwdConfig,
          chatId,
          num,
          phase: 'ringing',
        }

        const lang = await _getUserLang(chatId)
        const msg = _trans('vs.incomingCall', lang, formatPhone(from), formatPhone(to))
        if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})

        // Timeout: SIP device didn't answer — hang up outbound leg (triggers fallback in handleBridgeTransferHangup)
        setTimeout(async () => {
          const transfer = activeBridgeTransfers[newCall.callControlId]
          if (transfer && transfer.phase !== 'bridged') {
            log(`[Voice] SIP ring timeout: device didn't answer in ${ringTimeout}s — falling through`)
            await _telnyxApi.hangupCall(newCall.callControlId).catch(() => {})
            // handleBridgeTransferHangup will handle voicemail/forwarding/missed fallback
          }
        }, ringTimeout * 1000)
        return
      }
    } catch (e) {
      log(`[Voice] Failed to ring SIP device: ${e.message} — falling through to voicemail/missed`)
    }
    // If we get here, SIP ring failed — fall through to voicemail/missed below
  }

  // 5. Voicemail — Pro/Business (also counts toward minutes)
  if (vmConfig?.enabled && canAccessFeature(num.plan, 'voicemail')) {
    session.phase = 'voicemail_greeting'
    
    // Check for custom audio greeting first
    if (vmConfig.greetingType === 'custom' && vmConfig.customAudioGreetingUrl) {
      try {
        const axios = require('axios')
        await axios.post(`https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`, {
          audio_url: vmConfig.customAudioGreetingUrl,
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          }
        })
      } catch (e) {
        log(`[Voice] Custom audio playback failed, falling back to TTS: ${e.message}`)
        const fallback = vmConfig.customGreetingText || `The person at ${formatPhone(num.phoneNumber)} is unavailable. Please leave a message after the tone.`
        await _telnyxApi.speakOnCall(callControlId, fallback)
      }
      return
    }
    
    const greeting = vmConfig.greetingType === 'custom' && vmConfig.customGreetingText
      ? vmConfig.customGreetingText
      : `The person at ${formatPhone(num.phoneNumber)} is unavailable. Please leave a message after the tone.`
    await _telnyxApi.speakOnCall(callControlId, greeting)
    return
  }

  // 6. No features / no SIP device — notify missed call and hang up
  session.phase = 'missed'
  await _telnyxApi.speakOnCall(callControlId, 'This number is currently unavailable. Please try again later.')
  setTimeout(async () => {
    await _telnyxApi.hangupCall(callControlId)
  }, 5000)

  notifyUser(chatId, num, 'missed', session)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GATHER ENDED — IVR DTMF selection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleGatherEnded(payload) {
  const callControlId = payload.call_control_id
  const session = activeCalls[callControlId]
  if (!session) return

  // ── Race condition guard: skip if call already ended ──
  if (isCallEnded(callControlId)) {
    log(`[Voice] Skipping gather for ${session.num?.phoneNumber} — call already ended`)
    return
  }

  const digits = payload.digits || ''
  const { num, chatId } = session
  const ivrConfig = num.features?.ivr

  // ── 2026-08-03: Multi-layer IVR — resolve option through session.ivrPath ──
  // If session.ivrPath is set, we're inside a sub-menu and the digit resolves
  // against ivrConfig.options[path].subMenu.options[digits] instead of the
  // root options. Depth is capped at 2 by design (leaf actions can't be
  // action:'submenu'), so no recursion possible.
  const inSubMenu = !!session.ivrPath
  const optionsMap = inSubMenu
    ? (ivrConfig?.options?.[session.ivrPath]?.subMenu?.options || {})
    : (ivrConfig?.options || {})
  log(`[Voice] DTMF received: "${digits}" for ${num.phoneNumber}${inSubMenu ? ` (sub-menu ${session.ivrPath})` : ''}`)

  // Track IVR analytics — prefix digit with parent path for sub-menu selections
  const analyticsDigit = inSubMenu ? `${session.ivrPath}.${digits}` : digits
  trackIvrAnalytics(num.phoneNumber, chatId, session.from, analyticsDigit, optionsMap?.[digits]?.action || 'invalid')

  if (!digits || !optionsMap?.[digits]) {
    if (!session.ivrRetried) {
      session.ivrRetried = true
      await _telnyxApi.gatherDTMF(callControlId, 'Sorry, that was not a valid option. Please try again.', {
        minDigits: 1,
        maxDigits: 1,
        timeout: 10000,
        validDigits: Object.keys(optionsMap || {}).join('') || '0123456789',
      })
    } else {
      await _telnyxApi.speakOnCall(callControlId, 'Goodbye.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
    }
    return
  }

  const option = optionsMap[digits]

  // ── 2026-08-03: If the caller picked a sub-menu key at the root, start a
  // NEW gather that plays the sub-menu greeting and marks the session as
  // being inside that sub-menu. The next DTMF will land here again with
  // session.ivrPath set, and resolve against the sub-menu's options map.
  if (option.action === 'submenu' && !inSubMenu) {
    session.ivrPath = digits
    session.ivrRetried = false // reset retry counter for the new menu level
    const sub = option.subMenu || {}
    const validDigits = Object.keys(sub.options || {}).join('') || '0123456789'
    const greetingText = (sub.greetingType === 'text' || sub.greetingType === 'default')
      ? (sub.greeting || 'Please select an option.')
      : (sub.greeting || 'Please select an option.')
    try {
      if (sub.greetingType === 'audio' && sub.greetingAudioUrl && _telnyxApi.gatherDTMFWithAudio) {
        await _telnyxApi.gatherDTMFWithAudio(callControlId, sub.greetingAudioUrl, {
          minDigits: 1,
          maxDigits: 1,
          timeout: 10000,
          validDigits,
        })
      } else {
        await _telnyxApi.gatherDTMF(callControlId, greetingText, {
          minDigits: 1,
          maxDigits: 1,
          timeout: 10000,
          validDigits,
        })
      }
      // Notify owner that a caller entered the sub-menu
      _bot?.sendMessage(chatId, `📞 <b>IVR Call — Key ${digits}</b>\nFrom: ${session.from}\n📂 Entering sub-menu <b>${escapeHtml(option.label && option.label.trim() ? option.label.trim() : 'Sub-Menu ' + digits)}</b> (${Object.keys(sub.options || {}).length} options)`, { parse_mode: 'HTML' }).catch(() => {})
    } catch (e) {
      log(`[Voice] Sub-menu gather failed: ${e.message}`)
      await _telnyxApi.speakOnCall(callControlId, 'An error occurred. Goodbye.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
    }
    return
  }

  switch (option.action) {
    case 'forward': {
      const ivrFwdRate = getCallRate(option.forwardTo)
      // ── Wallet check before IVR forward (same pattern as regular call forwarding) ──
      if (_walletOf) {
        try {
          const { usdBal } = await getBalance(_walletOf, chatId)
          if (usdBal < ivrFwdRate) {
            log(`[Voice] IVR forward blocked: wallet $${usdBal} < $${ivrFwdRate}/min for ${option.forwardTo}`)
            await _telnyxApi.speakOnCall(callControlId, 'Your wallet balance is insufficient for call forwarding. Please top up your wallet.')
            setTimeout(() => _telnyxApi.hangupCall(callControlId), 5000)
            const lang = await _getUserLang(chatId)
            const region = isUSCanada(option.forwardTo) ? 'US/CA' : 'Intl'
            const msg = _trans('vs.ivrForwardBlocked', lang, formatPhone(num.phoneNumber), formatPhone(option.forwardTo), usdBal.toFixed(2), ivrFwdRate, region)
            if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
            break
          }
          // Low balance warning
          const estMinutes = Math.floor(usdBal / ivrFwdRate)
          if (usdBal < 5) {
            const lang = await _getUserLang(chatId)
            const msg = _trans('vs.lowBalanceIvrForward', lang, usdBal.toFixed(2), estMinutes)
            if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
          }
        } catch (e) { log(`[Voice] IVR forward wallet check error: ${e.message}`) }
      }
      session.phase = 'ivr_forward'
      log(`[Voice] IVR: forwarding to ${option.forwardTo} from ${session.to} (rate: $${ivrFwdRate}/min ${isUSCanada(option.forwardTo) ? 'US/CA' : 'Intl'})`)
      await playHoldMusicAndTransfer(callControlId, option.forwardTo, session.to, num.features?.callForwarding || {})
      notifyUser(chatId, num, 'ivr_forward', session, { digit: digits, forwardTo: option.forwardTo })
      break
    }

    case 'voicemail':
      session.phase = 'voicemail_greeting'
      await _telnyxApi.speakOnCall(callControlId, 'Please leave a message after the tone.')
      break

    case 'message':
      session.phase = 'ivr_message'
      // Play saved audio if available, otherwise fall back to TTS
      if (option.audioUrl) {
        try {
          const selfUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
          const audioUrl = option.audioUrl
          // Validate local file exists (restore from MongoDB if needed)
          if (selfUrl && (audioUrl.includes('/assets/user-audio/') || audioUrl.startsWith(selfUrl + '/assets/'))) {
            const urlPath = new URL(audioUrl).pathname
            const localPath = require('path').join(__dirname, urlPath)
            if (!require('fs').existsSync(localPath)) {
              // Try restoring from MongoDB
              try {
                const stored = await _db.collection('ivrAudioStore').findOne({ _id: num.phoneNumber + ':option:' + digits })
                if (stored && stored.buffer) {
                  const dir = require('path').dirname(localPath)
                  if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true })
                  require('fs').writeFileSync(localPath, Buffer.from(stored.buffer, 'base64'))
                  log(`[Voice] IVR option audio restored from MongoDB: ${localPath}`)
                }
              } catch (e) { log(`[Voice] IVR option audio restore failed: ${e.message}`) }
            }
          }
          await _telnyxApi.playbackStart(callControlId, audioUrl)
        } catch (e) {
          log(`[Voice] IVR message audio playback failed, falling back to TTS: ${e.message}`)
          await _telnyxApi.speakOnCall(callControlId, option.message || 'Thank you for calling.')
        }
      } else {
        await _telnyxApi.speakOnCall(callControlId, option.message || 'Thank you for calling.')
      }
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 8000)
      notifyUser(chatId, num, 'ivr_message', session, { digit: digits, message: option.message })
      break

    default:
      await _telnyxApi.speakOnCall(callControlId, 'Goodbye.')
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPEAK ENDED — After IVR/Voicemail greeting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleSpeakEnded(payload) {
  const callControlId = payload.call_control_id

  // Check if there's a pending hold-music transfer waiting for this speak to end
  const pending = pendingHoldTransfers[callControlId]
  if (pending) {
    delete pendingHoldTransfers[callControlId]
    log(`[Voice] Hold announcement done for ${callControlId}, starting hold music + dialing ${pending.forwardTo}`)

    // Phase 2: Start hold music on the ORIGINAL call leg (caller hears music)
    await _telnyxApi.playbackStart(callControlId, HOLD_MUSIC_URL, { loop: 'infinity' })

    // Let caller hear 5 seconds of hold music before dialing the transfer destination
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Phase 2b: Create new outbound call to the transfer destination
    const newCall = await _telnyxApi.createOutboundCall(pending.fromNumber, pending.forwardTo)
    if (newCall?.callControlId) {
      activeBridgeTransfers[newCall.callControlId] = {
        originalCallControlId: callControlId,
        forwardTo: pending.forwardTo,
        fromNumber: pending.fromNumber,
      }
      log(`[Voice] Bridge transfer: dialing ${pending.forwardTo} (new leg: ${newCall.callControlId}), hold music on ${callControlId}`)

      // Timeout: if transfer destination doesn't answer in 30s, cancel and hang up
      setTimeout(async () => {
        const transfer = activeBridgeTransfers[newCall.callControlId]
        if (transfer && transfer.phase !== 'bridged') {
          log(`[Voice] Bridge transfer timeout: ${pending.forwardTo} didn't answer in 30s`)
          await _telnyxApi.hangupCall(newCall.callControlId).catch(() => {})
          // handleBridgeTransferHangup will clean up the original leg
        }
      }, 30000)
    } else {
      // Failed to create outbound call — fall back to regular transfer with tracking
      log(`[Voice] Failed to create outbound call to ${pending.forwardTo}, falling back to transfer`)
      await _telnyxApi.playbackStop(callControlId)
      // Track the fallback transfer for no-answer detection
      pendingNativeTransfers[callControlId] = {
        forwardTo: pending.forwardTo,
        fromNumber: pending.fromNumber,
        initiatedAt: Date.now(),
        connected: false,
      }
      const fallbackTimeout = setTimeout(() => {
        const transfer = pendingNativeTransfers[callControlId]
        if (transfer && !transfer.connected) {
          transfer.timedOut = true
          log(`[Voice] Fallback transfer timeout: ${pending.forwardTo} didn't answer in 35s`)
        }
      }, 35000)
      pendingNativeTransfers[callControlId]._timeout = fallbackTimeout
      await _telnyxApi.transferCall(callControlId, pending.forwardTo, pending.fromNumber)
    }
    return
  }

  const session = activeCalls[callControlId]
  if (!session) return

  // ── Race condition guard: skip if call already ended ──
  if (isCallEnded(callControlId)) return

  if (session.phase === 'voicemail_greeting') {
    session.phase = 'voicemail_recording'
    log(`[Voice] Starting voicemail recording for ${session.num.phoneNumber}`)
    await _telnyxApi.startRecording(callControlId, 'single')

    setTimeout(async () => {
      const current = activeCalls[callControlId]
      if (current && current.phase === 'voicemail_recording') {
        await _telnyxApi.stopRecording(callControlId)
        await _telnyxApi.hangupCall(callControlId)
      }
    }, 60000)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECORDING SAVED — Deliver voicemail / call recording
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleRecordingSaved(payload) {
  const callControlId = payload.call_control_id
  const session = activeCalls[callControlId]
  if (!session) return

  const recordingUrl = payload.recording_urls?.mp3 || payload.public_recording_urls?.mp3 || payload.recording_urls?.wav
  const duration = payload.duration_secs || 0
  const { chatId, num, from, to } = session
  const time = new Date().toLocaleString()

  if (session.phase === 'voicemail_recording') {
    log(`[Voice] Voicemail saved for ${to} from ${from}: ${recordingUrl}`)

    if (num.features?.voicemail?.forwardToTelegram && recordingUrl) {
      const caption = `🎙️ <b>New Voicemail</b>\n\n📞 To: ${formatPhone(to)}\n👤 From: ${formatPhone(from)}\n⏱️ Duration: ${formatDuration(duration)}\n🕐 ${time}`
      try {
        await _bot.sendAudio(chatId, recordingUrl, { caption, parse_mode: 'HTML' })
      } catch (e) {
        log(`[Voice] Failed to send voicemail audio: ${e.message}`)
        _bot.sendMessage(chatId, caption + `\n\n🔗 <a href="${recordingUrl}">Listen</a>`, { parse_mode: 'HTML' }).catch(() => {})
      }
    }

    logEvent(to, from, 'voicemail', duration, recordingUrl)
    return
  }

  if (session.isRecording && recordingUrl) {
    log(`[Voice] Call recording saved for ${to} from ${from}: ${recordingUrl}`)
    const caption = `🔴 <b>Call Recording</b>\n\n📞 To: ${formatPhone(to)}\n👤 From: ${formatPhone(from)}\n⏱️ Duration: ${formatDuration(duration)}\n🕐 ${time}`
    try {
      await _bot.sendAudio(chatId, recordingUrl, { caption, parse_mode: 'HTML' })
    } catch (e) {
      log(`[Voice] Failed to send recording audio: ${e.message}`)
      _bot.sendMessage(chatId, caption + `\n\n🔗 <a href="${recordingUrl}">Listen</a>`, { parse_mode: 'HTML' }).catch(() => {})
    }

    logEvent(to, from, 'call_recording', duration, recordingUrl)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CALL HANGUP — Cleanup + REAL-TIME minute tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleCallHangup(payload) {
  const callControlId = payload.call_control_id
  const hangupCauseRaw = payload.hangup_cause || payload.sip_hangup_cause || 'unknown'
  const hangupSourceRaw = payload.hangup_source || 'unknown'
  
  // Mark as ended IMMEDIATELY to prevent race conditions with concurrent gather/speak events
  markCallEnded(callControlId)

  const session = activeCalls[callControlId]
  if (!session) {
    // ── Fix #5 FALLBACK: Deferred billing for auto-routed calls that bypassed real-time billing ──
    // This only fires if handleAutoRoutedRealTimeBilling failed to create a session (e.g., user lookup failed).
    // Normal auto-routed calls now have activeCalls sessions and are handled by the regular hangup flow above.
    const pendingBill = autoRoutedPendingBilling[callControlId]
    if (pendingBill) {
      delete autoRoutedPendingBilling[callControlId]
      const duration = payload.duration_secs || Math.floor((Date.now() - pendingBill.startedAt.getTime()) / 1000)
      const minutesBilled = duration > 0 ? Math.ceil(duration / 60) : 1 // 1-min minimum for outbound
      log(`[Voice] Fix #4: Deferred billing for auto-routed call ${callControlId}: ${pendingBill.fromClean} → ${pendingBill.destination}, ${duration}s (${minutesBilled} min), reason=${pendingBill.reason}`)
      try {
        // Look up user from SIP credential
        const lookupResult = await findNumberBySipUser(pendingBill.sipUsername, pendingBill.fromClean, null)
        if (lookupResult.chatId && lookupResult.num) {
          const { chatId, num } = lookupResult
          // Charge connection fee
          if (CALL_CONNECTION_FEE > 0 && _walletOf) {
            const feeResult = await smartWalletDeduct(_walletOf, chatId, CALL_CONNECTION_FEE, {
              type: 'connection_fee', callType: 'AutoRoute_Deferred',
              description: `Deferred conn fee: ${num.phoneNumber} → ${pendingBill.destination}`,
              destination: pendingBill.destination, phoneNumber: num.phoneNumber,
              callRef: `telnyx_${callControlId}_connfee`, // idempotent: separate from per-minute callRef
            })
            if (feeResult.success && !feeResult.idempotent) {
              const feeRef = _nanoid?.() || `connfee_autoroute_${Date.now()}`
              const feeStr = `$${CALL_CONNECTION_FEE.toFixed(2)}`
              if (_payments) set(_payments, feeRef, `ConnectionFee,AutoRoute_SIPOutbound,$${CALL_CONNECTION_FEE.toFixed(2)},${chatId},${num.phoneNumber},${pendingBill.destination},${new Date()}`)
              log(`[Voice] Fix #4: Connection fee charged (deferred): ${feeStr} for ${num.phoneNumber} → ${pendingBill.destination}`)
            }
          }
          // Charge per-minute billing
          const billingInfo = await billCallMinutesUnified(chatId, num.phoneNumber, minutesBilled, pendingBill.destination, 'AutoRoute_SIPOutbound', `telnyx_${callControlId}`)
          log(`[Voice] Fix #4: Auto-routed call billed: ${num.phoneNumber} → ${pendingBill.destination}, ${minutesBilled} min @ $${billingInfo.rate}, reason=${pendingBill.reason}`)
          // Notify user
          const rate = billingInfo.rate || getCallRate(pendingBill.destination)
          const lang = await _getUserLang(chatId)
          const msg = _trans('vs.sipCallEndedAutoRouted', lang, formatPhone(num.phoneNumber), formatPhone(pendingBill.destination), formatDuration(duration), minutesBilled, rate)
          if (msg) _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        } else {
          log(`[Voice] Fix #4: Could not identify owner for auto-routed call — unbilled: ${pendingBill.sipUsername} → ${pendingBill.destination}`)
        }
      } catch (e) {
        log(`[Voice] Fix #4: Deferred billing error: ${e.message}`)
      }
      return
    }
    // Log hangup details even for untracked calls (helps debug SIP failures)
    log(`[Voice] Hangup for untracked call ${callControlId}: cause=${hangupCauseRaw}, source=${hangupSourceRaw}, from=${payload.from}, to=${payload.to}, duration=${payload.duration_secs || 0}s`)
    return
  }

  // ── FIX: Mark call as dead for race condition prevention ──
  // If this call is in 'outbound_twilio_bridge' phase and hangup arrives BEFORE transfer completes,
  // mark it as dead so the transfer logic can detect and skip the transfer attempt.
  // This prevents "call is no longer active" errors and double billing.
  if (session.phase === 'outbound_twilio_bridge' && session.alive === true) {
    log(`[Voice] Call ${callControlId} hung up during transfer setup window — marking as dead to prevent transfer attempt`)
    session.alive = false
  }

  // ── CLEANUP SIP RING LEG ──
  // If the inbound caller hangs up while SIP device is still ringing,
  // we must hang up the outbound SIP ring leg so the WebRTC client stops ringing
  if (session.sipRingCallControlId) {
    const sipRingTransfer = activeBridgeTransfers[session.sipRingCallControlId]
    if (sipRingTransfer && sipRingTransfer.phase !== 'bridged') {
      log(`[Voice] Caller hung up during SIP ring — hanging up SIP ring leg ${session.sipRingCallControlId}`)
      await _telnyxApi.hangupCall(session.sipRingCallControlId).catch(() => {})
      delete activeBridgeTransfers[session.sipRingCallControlId]
    }
  }

  // Prevent duplicate hangup processing (Telnyx can fire multiple hangup events for transferred calls)
  if (session._hangupProcessed) return
  session._hangupProcessed = true

  const payloadDuration = payload.duration_secs || 0
  // Telnyx doesn't always include duration_secs for credential connection calls
  // Calculate from session start time as fallback
  const duration = payloadDuration > 0 ? payloadDuration : Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
  const hangupCause = payload.hangup_cause || payload.sip_hangup_cause || 'unknown'
  const hangupSource = payload.hangup_source || 'unknown'
  const { chatId, num, from, to } = session
  const time = new Date().toLocaleString()

  // Log hangup details for all calls (helps diagnose outbound drops)
  const isOutbound = session.direction === 'outgoing'
  if (isOutbound) {
    log(`[Voice] Outbound call hangup: ${from} → ${to}, duration=${duration}s, cause=${hangupCause}, source=${hangupSource}`)
  }

  // ── UNIFIED BILLING: plan minutes → overage at destination-based rate ──
  // ALL calls billed minimum 1 minute — answered or not, outbound or forwarded.
  // Inbound missed calls: no charge (receiver doesn't pay for missed inbound).
  const isForwarded = session.phase === 'forwarding' || session.phase === 'ivr_forward'
  const minutesBilled = duration > 0
    ? Math.ceil(duration / 60)
    : ((isOutbound || isForwarded) ? 1 : 0) // Outbound/Forwarded: 1-min minimum even if unanswered. Inbound: no charge if missed.

  // Determine if this is a Twilio bridge (call goes through both Telnyx SIP + Twilio PSTN)
  const isTwilioBridge = session.phase === 'outbound_twilio_bridge'

  // Determine destination for rate calculation
  const destination = isForwarded
    ? (num.features?.callForwarding?.forwardTo || from)
    : isOutbound ? to : from

  let billingInfo = { planMinUsed: 0, overageMin: 0, overageCharge: 0, rate: 0, used: 0, limit: 0 }
  if (minutesBilled > 0 && !session.isTestCall) {
    // Use callControlId as idempotency key so duplicate Telnyx hangup webhooks
    // (cross-pod or post-restart retries) cannot double-bill the same call.
    const callRef = `telnyx_${callControlId}`
    if (isTwilioBridge) {
      // ── DUAL-LEG BILLING: Telnyx SIP leg charge (Twilio PSTN leg billed separately via /twilio/voice-dial-status) ──
      const callType = 'Telnyx_SIP_Leg'
      billingInfo = await billCallMinutesUnified(chatId, num.phoneNumber, minutesBilled, destination, callType, callRef)
      log(`[Voice] Telnyx SIP leg billed: ${minutesBilled} min @ $${billingInfo.rate} for bridge call ${num.phoneNumber} → ${destination}`)
    } else {
      // Standard single-carrier billing
      const callType = isForwarded ? 'Forwarding' : isOutbound ? 'SIPOutbound' : 'Inbound'
      billingInfo = await billCallMinutesUnified(chatId, num.phoneNumber, minutesBilled, destination, callType, callRef)
    }
  } else if (session.isTestCall) {
    log(`[Voice] Skipping billing for test call (${duration}s) — free test call`)
  }

  // Clean up mid-call limit timer
  if (session._limitTimer) {
    clearInterval(session._limitTimer)
  }
  // ── Concurrency Guard: release this call's outbound fund reservation ──
  // The actual charges have now been applied (or force-settled as debt), so the
  // committed estimate must be freed for the user's next call.
  _releaseOutbound(chatId, callControlId)

  // Build plan usage line for notifications
  const remaining = billingInfo.limit > 0 ? Math.max(0, billingInfo.limit - billingInfo.used) : null
  const planLine = remaining !== null
    ? `📊 ${minutesBilled} min deducted · <b>${remaining}/${billingInfo.limit}</b> min remaining`
    : `📊 ${minutesBilled} min used`

  // Notify based on phase
  if (isForwarded) {
    const forwardTo = num.features?.callForwarding?.forwardTo || 'unknown'
    // Check if the forward/transfer actually connected
    const nativeTransfer = pendingNativeTransfers[callControlId]
    const transferConnected = nativeTransfer ? nativeTransfer.connected : (session.phase === 'bridged')
    if (nativeTransfer) {
      if (nativeTransfer._timeout) clearTimeout(nativeTransfer._timeout)
      delete pendingNativeTransfers[callControlId]
    }

    if (transferConnected) {
      const lang = await _getUserLang(chatId)
      const msg = _trans('t.vs_callForwarded', lang, formatPhone(to), formatPhone(forwardTo), formatPhone(from), formatDuration(duration), planLine, time) || `📞 <b>Call Forwarded</b>\n\n📞 ${formatPhone(to)} → 📲 ${formatPhone(forwardTo)}\n👤 ${formatPhone(from)}\n⏱️ ${formatDuration(duration)}\n${planLine}\n🕐 ${time}`
      _bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    } else {
      const lang2 = await _getUserLang(chatId)
      const msg = _trans('t.vs_forwardFailed', lang2, formatPhone(to), formatPhone(forwardTo), formatPhone(from), time) || `📞 <b>Forward — No Answer</b>\n\n📞 ${formatPhone(to)} → 📲 ${formatPhone(forwardTo)}\n👤 ${formatPhone(from)}\n🕐 ${time}`
      _bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }
    logEvent(to, from, transferConnected ? 'forwarded' : 'forward_failed', duration)
  } else if (isOutbound) {
    // Check if there was a native transfer that failed to connect (SIP → Twilio bridge)
    const nativeTransfer = pendingNativeTransfers[callControlId]
    if (nativeTransfer) {
      if (nativeTransfer._timeout) clearTimeout(nativeTransfer._timeout)
      if (!nativeTransfer.connected) {
        const msg = `📞 <b>SIP Call — Transfer No Answer</b>\n\n📞 From: ${formatPhone(from)}\n📲 To: ${formatPhone(to)}\n📲 Transfer to ${formatPhone(nativeTransfer.forwardTo)} didn't connect\n🕐 ${time}`
        _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      } else {
        const msg = `📞 <b>SIP Call Ended</b>\n\n📞 From: ${formatPhone(from)}\n📲 To: ${formatPhone(to)}\n⏱️ ${formatDuration(duration)}\n${planLine}\n🕐 ${time}`
        _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
      }
      delete pendingNativeTransfers[callControlId]
    } else if (session.isTestCall) {
      const msg = `📞 <b>Free Test Call Ended</b>\n\n📞 From: ${formatPhone(from)}\n📲 To: ${formatPhone(to)}\n⏱️ ${formatDuration(duration)}\n🆓 Free test call — no charges\n🕐 ${time}`
      _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    } else {
      const hangupInfo = hangupCause !== 'unknown' ? `\n🔍 Cause: ${hangupCause}` : ''
      const msg = `📞 <b>SIP Call Ended</b>\n\n📞 From: ${formatPhone(from)}\n📲 To: ${formatPhone(to)}\n⏱️ ${formatDuration(duration)}\n${planLine}${hangupInfo}\n🕐 ${time}`
      _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    }
    logEvent(from, to, 'outbound_sip', duration)
  } else if (session.phase === 'missed' || session.phase === 'answering') {
    const langMissed = await _getUserLang(chatId)
    const msg = _trans('t.vs_missedCall', langMissed, formatPhone(to), formatPhone(from), time) || `📞 <b>Missed Call</b>\n\n📞 To: ${formatPhone(to)}\n👤 From: ${formatPhone(from)}\n🕐 ${time}`
    _bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
    logEvent(to, from, 'missed', 0)
  } else if (session.phase === 'voicemail_recording' || session.phase === 'voicemail_greeting') {
    // Voicemail call — billing already happened above; send notification with plan usage
    const overageLine = billingInfo.overageCharge > 0
      ? `\n💰 Overage: $${billingInfo.overageCharge.toFixed(2)}`
      : ''
    const msg = `🎤 <b>Voicemail Call Ended</b>\n\n📞 To: ${formatPhone(to)}\n👤 From: ${formatPhone(from)}\n⏱️ ${formatDuration(duration)}\n${planLine}${overageLine}\n🕐 ${time}`
    _bot?.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
  }

  // Cleanup any bridge transfer legs tied to this call (e.g., caller hung up during hold music)
  for (const [transferLegId, transfer] of Object.entries(activeBridgeTransfers)) {
    if (transfer.originalCallControlId === callControlId) {
      log(`[Voice] Inbound leg hung up — cancelling bridge transfer leg ${transferLegId} to ${transfer.forwardTo}`)
      await _telnyxApi.hangupCall(transferLegId).catch(() => {})
      delete activeBridgeTransfers[transferLegId]
    }
  }

  // Cleanup any pending hold transfers that never completed
  delete pendingHoldTransfers[callControlId]

  // Cleanup any pending native transfers
  const remainingNativeTransfer = pendingNativeTransfers[callControlId]
  if (remainingNativeTransfer) {
    if (remainingNativeTransfer._timeout) clearTimeout(remainingNativeTransfer._timeout)
    delete pendingNativeTransfers[callControlId]
  }

  // Cleanup
  delete activeCalls[callControlId]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function findNumberOwner(phoneNumber) {
  try {
    const clean = phoneNumber.replace(/[^+\d]/g, '')
    const allUsers = await _phoneNumbersOf.find({}).toArray()
    for (const user of allUsers) {
      const numbers = user.val?.numbers || []
      for (const num of numbers) {
        if (num.phoneNumber?.replace(/[^+\d]/g, '') === clean && (num.status === 'active' || num.status === 'suspended')) {
          return { chatId: user._id, num }
        }
      }
    }
    return {}
  } catch (e) {
    log(`[Voice] findNumberOwner error: ${e.message}`)
    return {}
  }
}

async function notifyUser(chatId, num, type, session, extra = {}) {
  const time = new Date().toLocaleString()
  const lang = await _getUserLang(chatId)
  let msg = ''
  if (type === 'missed') {
    msg = _trans('t.vs_missedCall', lang, formatPhone(session.to), formatPhone(session.from), time) || `📞 <b>Missed Call</b>\n\n📞 To: ${formatPhone(session.to)}\n👤 From: ${formatPhone(session.from)}\n🕐 ${time}`
  } else if (type === 'ivr_forward') {
    msg = _trans('t.vs_ivrCallRouted', lang, formatPhone(session.to), formatPhone(session.from), extra.digit, formatPhone(extra.forwardTo), time) || `📞 <b>IVR Call Routed</b>\n\n📞 To: ${formatPhone(session.to)}\n👤 From: ${formatPhone(session.from)}\nPressed: <b>${extra.digit}</b> → Forwarded to ${formatPhone(extra.forwardTo)}\n🕐 ${time}`
  } else if (type === 'ivr_message') {
    msg = _trans('t.vs_ivrCall', lang, formatPhone(session.to), formatPhone(session.from), extra.digit, time) || `📞 <b>IVR Call</b>\n\n📞 To: ${formatPhone(session.to)}\n👤 From: ${formatPhone(session.from)}\nPressed: <b>${extra.digit}</b> → Played message\n🕐 ${time}`
  }
  if (msg) _bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
}

function logEvent(to, from, type, duration, recordingUrl) {
  if (!_phoneLogs) return
  _phoneLogs.insertOne({
    phoneNumber: to,
    from,
    type,
    duration: duration || 0,
    recordingUrl: recordingUrl || null,
    timestamp: new Date().toISOString(),
  }).catch(e => log(`[Voice] Log error: ${e.message}`))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IVR ANALYTICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function trackIvrAnalytics(phoneNumber, chatId, callerFrom, digit, action) {
  if (!_ivrAnalytics) return
  _ivrAnalytics.insertOne({
    phoneNumber,
    chatId,
    callerFrom,
    digit,
    action,
    timestamp: new Date().toISOString(),
  }).catch(e => log(`[Voice] IVR analytics log error: ${e.message}`))
}

async function getIvrAnalytics(phoneNumber, days = 30) {
  if (!_ivrAnalytics) return { totalCalls: 0, optionBreakdown: [], topOption: null, recentCalls: [] }
  try {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString()

    const all = await _ivrAnalytics.find({
      phoneNumber,
      timestamp: { $gte: sinceStr },
    }).sort({ timestamp: -1 }).toArray()

    const totalCalls = all.length

    const digitCounts = {}
    for (const entry of all) {
      const d = entry.digit || '?'
      digitCounts[d] = (digitCounts[d] || 0) + 1
    }

    const optionBreakdown = Object.entries(digitCounts)
      .map(([digit, count]) => ({ digit, count, percent: totalCalls > 0 ? Math.round((count / totalCalls) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)

    const topOption = optionBreakdown.length > 0 ? optionBreakdown[0] : null

    const recentCalls = all.slice(0, 5).map(e => ({
      from: e.callerFrom,
      digit: e.digit,
      action: e.action,
      time: e.timestamp,
    }))

    return { totalCalls, optionBreakdown, topOption, recentCalls }
  } catch (e) {
    log(`[Voice] IVR analytics query error: ${e.message}`)
    return { totalCalls: 0, optionBreakdown: [], topOption: null, recentCalls: [] }
  }
}

// ── Outbound MENU analytics (Phase 2 parity) — track which menu keys callers press
// on outbound calls, mirroring inbound trackIvrAnalytics but tagged direction:'outbound'.
function recordOutboundMenuPress({ callerId, chatId, targetNumber, digit, action, campaignId } = {}) {
  if (!_ivrAnalytics) return
  _ivrAnalytics.insertOne({
    phoneNumber: callerId || null,
    chatId: chatId || null,
    callerFrom: targetNumber || null,
    digit,
    action,
    direction: 'outbound',
    campaignId: campaignId || null,
    timestamp: new Date().toISOString(),
  }).catch(e => log(`[Voice] Outbound menu analytics log error: ${e.message}`))
}

async function getOutboundMenuAnalytics(chatId, days = 30) {
  if (!_ivrAnalytics) return { totalPresses: 0, keyBreakdown: [], topKey: null, recent: [] }
  try {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString()
    const all = await _ivrAnalytics.find({ chatId, direction: 'outbound', timestamp: { $gte: sinceStr } }).sort({ timestamp: -1 }).toArray()
    const total = all.length
    const counts = {}
    for (const e of all) {
      const key = `${e.digit || '?'}`
      if (!counts[key]) counts[key] = { count: 0, action: e.action }
      counts[key].count++
    }
    const keyBreakdown = Object.entries(counts)
      .map(([digit, v]) => ({ digit, action: v.action, count: v.count, percent: total ? Math.round((v.count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
    const topKey = keyBreakdown[0] || null
    const recent = all.slice(0, 5).map(e => ({ to: e.callerFrom, digit: e.digit, action: e.action, time: e.timestamp }))
    return { totalPresses: total, keyBreakdown, topKey, recent }
  } catch (e) {
    log(`[Voice] Outbound menu analytics query error: ${e.message}`)
    return { totalPresses: 0, keyBreakdown: [], topKey: null, recent: [] }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OUTBOUND IVR CALL — Place automated IVR calls
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ivrOutbound = require('./ivr-outbound.js')

/**
 * Initiate an outbound IVR call via Telnyx
 * @param {object} params - Call parameters from bot flow
 * @returns {{ callControlId, error }}
 */
async function initiateOutboundIvrCall(params) {
  const { chatId, callerId, targetNumber, ivrNumber, menu, audioUrl, activeKeys, templateName, placeholderValues, voiceName, isTrial, holdMusic, campaignId, leadIndex, bulkMode, ivrMode, otpLength, otpMaxAttempts, otpConfirmMsg, otpRejectMsg } = params

  // ── Block satellite / premium-rate destinations (target + transfer leg) ──
  for (const dest of [targetNumber, ivrNumber].filter(Boolean)) {
    if (dialGuard.classifyDial(dest).blocked) {
      return { error: `❌ ${dest} is a restricted premium/satellite destination and cannot be dialed. Contact support if you believe this is an error.` }
    }
  }

  // ── Wallet balance check (skip for trial calls) ──
  // Outbound IVR always charges wallet at flat IVR rate (plan minutes are for inbound only)
  if (!isTrial && _walletOf) {
    try {
      const { chatId: ownerId } = await findNumberOwner(callerId)
      if (ownerId) {
        const { usdBal } = await getBalance(_walletOf, ownerId)
        // Require at least 1 min at the ACTUAL rate for the leg(s) — international IVR legs
        // cost $0.50/min (policy 2026-08-07), not the flat $0.15. Use the max across the
        // primary target + transfer leg so an intl call can't start under-funded.
        const startRate = Math.max(getIvrCallRate(targetNumber), ivrNumber ? getIvrCallRate(ivrNumber) : 0)
        if (usdBal < startRate) {
          return { error: `Insufficient wallet balance ($${usdBal.toFixed(2)}). This ${campaignId ? 'Bulk' : 'Quick'} IVR call costs $${startRate.toFixed(2)}/min from wallet. Top up your wallet.` }
        }
        log(`[OutboundIVR] Wallet check passed: $${usdBal.toFixed(2)} (IVR rate: $${startRate}/min)`)
      }
    } catch (e) {
      log(`[OutboundIVR] Wallet check error: ${e.message}`)
    }
  }

  // ── TWILIO PATH: Use Twilio REST API + TwiML endpoints ──
  const provider = params.provider || 'telnyx'
  if (provider === 'twilio' && _twilioService) {
    // Reversible guard: while Twilio is disabled (account suspended), don't attempt a
    // Twilio call (which would 401). Show a friendly "being upgraded" message instead.
    if (!isTwilioEnabled()) {
      log(`[OutboundIVR] Twilio disabled (TWILIO_ENABLED=false) — returning friendly upgrade notice for ${params.callerId}`)
      return { error: '⚠️ This number is being upgraded to our new calling network, so calls from it are paused for a short while. We\'re moving it over — please try again later or tap 💬 Support.' }
    }
    // ── TRIAL CALLS: Use main Twilio account (trial number lives on main account) ──
    if (isTrial) {
      log(`[OutboundIVR] Trial call via Twilio main account: ${callerId} → ${targetNumber}`)
      const crypto = require('crypto')
      const sessionId = crypto.randomUUID()
      twilioIvrSessions[sessionId] = {
        chatId,
        callerId,
        targetNumber,
        ivrNumber,
        audioUrl,
        activeKeys: activeKeys || ['1'],
        menu: menu || null,
        obPath: null,
        templateName: templateName || 'Custom',
        placeholderValues: placeholderValues || {},
        voiceName: voiceName || 'Rachel',
        isTrial: true,
        holdMusic: holdMusic || false,
        bulkMode: null,
        campaignId: null,
        leadIndex: null,
        phase: 'initiated',
        digitPressed: null,
        startTime: Date.now(),
        // OTP Collection fields
        ivrMode: ivrMode || 'transfer',
        otpLength: otpLength || 6,
        otpMaxAttempts: otpMaxAttempts || 3,
        otpAttempt: 0,
        otpDigits: null,
        otpStatus: null,
        otpHoldStartedAt: null,
        otpConfirmMsg: params.otpConfirmMsg || null,
        otpRejectMsg: params.otpRejectMsg || null,
        answeredBy: null,
      }

      const twimlUrl = `${_selfUrl}/twilio/single-ivr?sessionId=${encodeURIComponent(sessionId)}`
      const statusUrl = `${_selfUrl}/twilio/single-ivr-status?sessionId=${encodeURIComponent(sessionId)}`

      const result = await _twilioService.makeTrialOutboundCall(
        callerId, targetNumber, twimlUrl,
        {
          statusCallback: statusUrl,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          timeout: 30,
          machineDetection: 'Enable',
        }
      )

      if (result.error) {
        delete twilioIvrSessions[sessionId]
        return { error: result.error }
      }

      twilioIvrSessions[sessionId].callSid = result.callSid
      log(`[OutboundIVR] Trial Twilio call initiated: ${result.callSid} ${callerId} → ${targetNumber} (sessionId: ${sessionId})`)
      return { callSid: result.callSid, sessionId, provider: 'twilio' }
    }

    // ━━━ SECURITY: Block non-trial Twilio calls without sub-account credentials ━━━
    if (!params.twilioSubAccountSid || !params.twilioSubAccountToken) {
      log(`[OutboundIVR] SECURITY BLOCK: Twilio call rejected — missing sub-account credentials for chatId ${chatId}`)
      return { error: 'Twilio calls require sub-account credentials. Cannot use main account.' }
    }
    const crypto = require('crypto')
    const sessionId = crypto.randomUUID()
    twilioIvrSessions[sessionId] = {
      chatId,
      callerId,
      targetNumber,
      ivrNumber,
      audioUrl,
      activeKeys: activeKeys || ['1'],
      menu: menu || null,
      obPath: null,
      templateName: templateName || 'Custom',
      placeholderValues: placeholderValues || {},
      voiceName: voiceName || 'Rachel',
      isTrial: isTrial || false,
      holdMusic: holdMusic || false,
      bulkMode: bulkMode || null,
      campaignId: campaignId || null,
      leadIndex: leadIndex != null ? leadIndex : null,
      phase: 'initiated',
      digitPressed: null,
      startTime: Date.now(),
      // OTP Collection fields
      ivrMode: ivrMode || 'transfer',
      otpLength: otpLength || 6,
      otpMaxAttempts: otpMaxAttempts || 3,
      otpAttempt: 0,
      otpDigits: null,
      otpStatus: null,
      otpHoldStartedAt: null,
      otpConfirmMsg: params.otpConfirmMsg || null,
      otpRejectMsg: params.otpRejectMsg || null,
      answeredBy: null,
    }

    const twimlUrl = `${_selfUrl}/twilio/single-ivr?sessionId=${encodeURIComponent(sessionId)}`
    const statusUrl = `${_selfUrl}/twilio/single-ivr-status?sessionId=${encodeURIComponent(sessionId)}`

    const result = await _twilioService.makeOutboundCall(
      callerId, targetNumber, twimlUrl,
      params.twilioSubAccountSid || null,
      params.twilioSubAccountToken || null,
      {
        statusCallback: statusUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        timeout: 30,
        machineDetection: 'Enable',
      }
    )

    // ── Persist rotated sub-token back to DB (self-heal, added 2026-08-01) ──
    // makeOutboundCall now returns liveToken + tokenRotated when it self-heals via
    // the master account. We atomically cache it on the caller number so subsequent
    // calls skip the master-account round-trip. See voice-service.js Twilio branch.
    if (result.tokenRotated && result.liveToken && chatId && callerId && _phoneNumbersOf) {
      try {
        await _phoneNumbersOf.updateOne(
          { _id: chatId, 'val.numbers.phoneNumber': callerId },
          { $set: {
              'val.numbers.$.twilioSubAccountToken': result.liveToken,
              'val.twilioSubAccountToken': result.liveToken,
          } }
        )
        log(`[OutboundIVR] ✓ Persisted rotated Twilio sub-token for ${callerId} (chatId=${chatId})`)
      } catch (e) {
        log(`[OutboundIVR] Failed to persist rotated sub-token: ${e.message}`)
      }
    }

    if (result.error) {
      delete twilioIvrSessions[sessionId]
      return { error: result.error, transientAuth: !!result.transientAuth, subAccountStatus: result.subAccountStatus }
    }

    twilioIvrSessions[sessionId].callSid = result.callSid
    log(`[OutboundIVR] Twilio call initiated: ${result.callSid} ${callerId} → ${targetNumber} (sessionId: ${sessionId})`)
    return { callSid: result.callSid, sessionId, provider: 'twilio' }
  }

  // ── TELNYX PATH (default): Use Telnyx Call Control API ──
  const webhookUrl = `${_selfUrl}/telnyx/voice-webhook`
  const result = await _telnyxApi.createOutboundCall(callerId, targetNumber, webhookUrl)

  if (result.error) {
    return { error: result.error }
  }

  // Store outbound IVR session
  outboundIvrCalls[result.callControlId] = {
    chatId,
    callerId,
    targetNumber,
    ivrNumber,
    audioUrl,
    activeKeys: activeKeys || ['1'],
    menu: menu || null,
    obPath: null,
    templateName: templateName || 'Custom',
    placeholderValues: placeholderValues || {},
    voiceName: voiceName || 'Rachel',
    isTrial: isTrial || false,
    holdMusic: holdMusic || false,
    phase: 'initiated',
    digitPressed: null,
    startTime: Date.now(),
    // Bulk campaign fields
    campaignId: campaignId || null,
    leadIndex: leadIndex != null ? leadIndex : null,
    bulkMode: bulkMode || null, // 'transfer' | 'report_only'
    answeredBy: null, // AMD result: 'human', 'machine', 'not_sure', null
    // OTP Collection fields (Business plan)
    ivrMode: ivrMode || 'transfer',
    otpLength: otpLength || 6,
    otpMaxAttempts: otpMaxAttempts || 3,
    otpAttempt: 0,
    otpDigits: null,
    otpStatus: null,
    otpHoldStartedAt: null,
    otpConfirmMsg: otpConfirmMsg || null,
    otpRejectMsg: otpRejectMsg || null,
  }

  log(`[OutboundIVR] Call initiated: ${callerId} → ${targetNumber} (chatId: ${chatId}, template: ${templateName})`)
  return { callControlId: result.callControlId }
}

/**
 * Handle outbound IVR: call.initiated
 */
function handleOutboundIvrInitiated(payload) {
  const callControlId = payload.call_control_id
  const session = outboundIvrCalls[callControlId]
  if (!session) return false

  session.phase = 'ringing'
  log(`[OutboundIVR] Ringing: ${session.targetNumber}`)
  return true
}

/**
 * Handle outbound IVR: call.answered — play audio + gather DTMF
 * NOTE: Do NOT notify the bot user here — "answered" can be voicemail
 * or the target may hang up immediately. We only notify on final outcome (hangup).
 */
async function handleOutboundIvrAnswered(payload) {
  const callControlId = payload.call_control_id
  const session = outboundIvrCalls[callControlId]
  if (!session) return false

  session.phase = 'playing'
  session.answerTime = Date.now()
  log(`[OutboundIVR] Answered: ${session.targetNumber} — playing IVR audio`)

  // ── MID-CALL WALLET MONITOR for outbound IVR ──
  // Outbound IVR charges wallet at flat IVR rate (plan minutes are for inbound only)
  if (!session.isTrial) {
    try {
      const { chatId: ownerId } = await findNumberOwner(session.callerId)
      if (ownerId) {
        session._limitTimer = setInterval(async () => {
          const sess = outboundIvrCalls[callControlId]
          if (!sess) { clearInterval(session._limitTimer); return }
          if (_walletOf) {
            try {
              const { usdBal } = await getBalance(_walletOf, ownerId)
              // Disconnect threshold = the ACTUAL per-min rate for the active leg(s)
              // (international IVR = $0.50/min, policy 2026-08-07), not the flat $0.15.
              const midRate = Math.max(getIvrCallRate(sess.targetNumber), sess.ivrNumber ? getIvrCallRate(sess.ivrNumber) : 0) || IVR_CALL_RATE
              if (usdBal < midRate) {
                log(`[OutboundIVR] Mid-call wallet exhausted: $${usdBal.toFixed(2)} < $${midRate}/min. Disconnecting.`)
                clearInterval(session._limitTimer)
                await _telnyxApi.hangupCall(callControlId).catch(() => {})
                const lang = await _getUserLang(session.chatId)
                const msg = _trans('vs.ivrCallEndedWalletExhausted', lang, usdBal.toFixed(2), midRate)
                if (msg) _bot?.sendMessage(session.chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
              }
            } catch (e) { log(`[OutboundIVR] Mid-call wallet check error: ${e.message}`) }
          }
        }, 60000)
      }
    } catch (e) { log(`[OutboundIVR] Limit monitor setup error: ${e.message}`) }
  }

  // Play audio and gather DTMF
  const validDigits = session.activeKeys.join('')
  if (session.audioUrl) {
    await _telnyxApi.gatherDTMFWithAudio(callControlId, session.audioUrl, {
      minDigits: 1,
      maxDigits: 1,
      timeout: 20000,
      validDigits: validDigits || '0123456789',
    })
  } else {
    // Fallback to TTS if no audio URL
    const tVoice = getTelnyxVoice(session.voiceName)
    await _telnyxApi.gatherDTMF(callControlId, 'Thank you for your time. Goodbye.', {
      minDigits: 1,
      maxDigits: 1,
      timeout: 15000,
      voice: tVoice,
    })
  }
  return true
}

// ── Outbound multi-key menu router (Phase 2 parity). Returns true if it handled
// the pressed digit (forward / spoken message / one-level sub-menu / retry). Only
// invoked when session.menu is set, so the legacy single-transfer path is untouched.
async function handleOutboundMenuDigit(callControlId, session, digits) {
  const menu = session.menu
  if (!menu) return false
  const atSub = !!session.obPath
  const levelOpts = atSub ? ((menu[session.obPath] && menu[session.obPath].options) || {}) : menu
  const opt = digits ? levelOpts[digits] : null

  if (opt) {
    recordOutboundMenuPress({
      callerId: session.callerId, chatId: session.chatId, targetNumber: session.targetNumber,
      digit: atSub ? `${session.obPath}.${digits}` : digits, action: opt.action, campaignId: session.campaignId,
    })
  }

  if (opt && opt.action === 'forward' && opt.forwardTo) {
    session.phase = 'transferring'
    session.digitPressed = atSub ? `${session.obPath}.${digits}` : digits
    session.ivrNumber = opt.forwardTo // keep billing + notify consistent with the chosen destination
    if (!session.campaignId) {
      _bot?.sendMessage(session.chatId, ivrOutbound.formatCallNotification('key_pressed', { ...session, digit: session.digitPressed }), { parse_mode: 'HTML' }).catch(() => {})
    }
    session._pendingTransferTo = opt.forwardTo
    session._pendingTransferFrom = session.callerId
    await playHoldMusicAndTransfer(callControlId, opt.forwardTo, session.callerId, { holdMusic: session.holdMusic })
    log(`[OutboundIVR] Menu forward: key=${session.digitPressed} → ${opt.forwardTo}`)
    return true
  }

  if (opt && opt.action === 'message') {
    session.phase = 'completed'
    session.digitPressed = atSub ? `${session.obPath}.${digits}` : digits
    const msg = opt.message || 'Thank you. Goodbye.'
    await _telnyxApi.speakOnCall(callControlId, msg, getTelnyxVoice(session.voiceName))
    setTimeout(() => _telnyxApi.hangupCall(callControlId).catch(() => {}), Math.min(30000, Math.max(4000, msg.length * 90)))
    log(`[OutboundIVR] Menu message: key=${session.digitPressed}`)
    return true
  }

  if (opt && opt.action === 'submenu' && !atSub) {
    session.obPath = digits
    session.ivrRetried = false
    const subGreeting = opt.greeting || 'Please select an option.'
    const subDigits = Object.keys(opt.options || {}).join('') || '0123456789'
    await _telnyxApi.gatherDTMFWithSpeak(callControlId, subGreeting, getTelnyxVoice(session.voiceName), {
      minDigits: 1, maxDigits: 1, timeout: 15000, interDigitTimeout: 5000, validDigits: subDigits,
    })
    log(`[OutboundIVR] Menu sub-menu opened: key=${digits}`)
    return true
  }

  // Invalid / no digit at this level — replay the current-level prompt once, then hang up.
  if (!session.ivrRetried) {
    session.ivrRetried = true
    if (atSub) {
      const parent = menu[session.obPath] || {}
      const subGreeting = parent.greeting || 'Please select an option.'
      const subDigits = Object.keys(parent.options || {}).join('') || '0123456789'
      await _telnyxApi.gatherDTMFWithSpeak(callControlId, `Sorry, that was not a valid option. ${subGreeting}`, getTelnyxVoice(session.voiceName), {
        minDigits: 1, maxDigits: 1, timeout: 15000, interDigitTimeout: 5000, validDigits: subDigits,
      })
    } else if (session.audioUrl) {
      await _telnyxApi.gatherDTMFWithAudio(callControlId, session.audioUrl, {
        minDigits: 1, maxDigits: 1, timeout: 15000, validDigits: Object.keys(menu).join('') || '0123456789',
      })
    } else {
      await _telnyxApi.gatherDTMFWithSpeak(callControlId, 'Sorry, that was not a valid option. Please try again.', getTelnyxVoice(session.voiceName), {
        minDigits: 1, maxDigits: 1, timeout: 15000, validDigits: Object.keys(menu).join('') || '0123456789',
      })
    }
    return true
  }

  session.phase = 'completed'
  await _telnyxApi.speakOnCall(callControlId, 'Goodbye.', getTelnyxVoice(session.voiceName))
  setTimeout(() => _telnyxApi.hangupCall(callControlId).catch(() => {}), 2000)
  return true
}

/**
 * Handle outbound IVR: call.gather.ended — transfer on valid key
 */
async function handleOutboundIvrGatherEnded(payload) {
  const callControlId = payload.call_control_id
  const session = outboundIvrCalls[callControlId]
  if (!session) return false

  // ── Race condition guard: skip if call already ended ──
  // call.hangup and call.gather.ended can arrive near-simultaneously from Telnyx.
  // If hangup was already processed, don't issue speak/gather/transfer commands.
  if (isCallEnded(callControlId) || session.phase === 'ended') {
    log(`[OutboundIVR] Skipping gather for ${session.targetNumber} — call already ended`)
    return true
  }

  const digits = payload.digits || ''
  log(`[OutboundIVR] DTMF received: "${digits}" for ${session.targetNumber}`)

  // ── OTP COLLECTION: Handle OTP code input (second gather after key press) ──
  if (session.ivrMode === 'otp_collect' && session.phase === 'otp_gathering') {
    if (digits && digits.length >= (session.otpLength || 4)) {
      session.otpDigits = digits
      session.phase = 'otp_hold'
      session.otpHoldStartedAt = Date.now()
      log(`[OutboundIVR] OTP collected: "${digits}" from ${session.targetNumber} — putting on hold, notifying bot user`)
      
      // Put caller on hold while bot user reviews
      await _telnyxApi.speakOnCall(callControlId, 'Thank you. Please hold while we verify your code.', getTelnyxVoice(session.voiceName))
      
      // Notify bot user with OTP + approve/reject buttons
      const msg = `🔑 <b>OTP Collected</b>\n\n📞 Target: ${session.targetNumber}\n🔢 Code: <code>${digits}</code>\n\n⏳ Caller is on hold. Approve or reject:`
      _bot?.sendMessage(session.chatId, msg, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confirm & Transfer', callback_data: `otp_confirm:${callControlId}` },
              { text: '❌ Reject & Retry', callback_data: `otp_reject:${callControlId}` },
            ],
            [{ text: '📵 Hang Up', callback_data: `otp_hangup:${callControlId}` }],
          ]
        }
      }).catch(() => {})
      
      // Auto-timeout: if bot user doesn't respond within 90s, hang up
      setTimeout(async () => {
        const current = outboundIvrCalls[callControlId]
        if (current && current.phase === 'otp_hold') {
          log(`[OutboundIVR] OTP hold timeout (90s) for ${current.targetNumber} — hanging up`)
          current.phase = 'otp_timeout'
          await _telnyxApi.speakOnCall(callControlId, 'We were unable to verify your code at this time. Goodbye.', getTelnyxVoice(current.voiceName)).catch(() => {})
          setTimeout(() => _telnyxApi.hangupCall(callControlId).catch(() => {}), 3000)
        }
      }, 90000)
      return true
    } else {
      // Invalid OTP length — retry if attempts remain
      if (session.otpAttempt < (session.otpMaxAttempts || 3)) {
        session.otpAttempt++
        log(`[OutboundIVR] OTP invalid (got "${digits}", need ${session.otpLength} digits) — retry ${session.otpAttempt}/${session.otpMaxAttempts}`)
        const retryPrompt = `That code was not valid. Please enter your ${session.otpLength}-digit code again.`
        await _telnyxApi.gatherDTMFWithSpeak(callControlId, retryPrompt, getTelnyxVoice(session.voiceName), {
          minDigits: session.otpLength || 4,
          maxDigits: session.otpLength || 6,
          timeout: 30000,
          interDigitTimeout: 5000,
          validDigits: '0123456789',
        })
        return true
      } else {
        log(`[OutboundIVR] OTP max attempts reached for ${session.targetNumber} — hanging up`)
        session.otpStatus = 'max_attempts'
        await _telnyxApi.speakOnCall(callControlId, 'Maximum attempts reached. Goodbye.', getTelnyxVoice(session.voiceName))
        setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
        _bot?.sendMessage(session.chatId, `⚠️ <b>OTP Not Collected</b>\n📞 ${session.targetNumber}\n⚠️ Max attempts (${session.otpMaxAttempts}) reached without valid code.`, { parse_mode: 'HTML' }).catch(() => {})
        return true
      }
    }
  }

  // ── Multi-key menu routing (Phase 2 outbound parity, opt-in) ──────────────
  // Backward compatible: only active when session.menu is set. Each pressed key
  // routes to its own action (forward / message / one-level sub-menu), mirroring
  // inbound. OTP and bulk report-only flows keep their existing behaviour.
  if (session.menu && session.ivrMode !== 'otp_collect' && session.bulkMode !== 'report_only') {
    const routed = await handleOutboundMenuDigit(callControlId, session, digits)
    if (routed) return true
  }

  if (digits && session.activeKeys.includes(digits)) {
    session.phase = 'transferring'
    session.digitPressed = digits

    // Bulk campaign: report-only mode — log digit, say goodbye, hang up (NO transfer)
    if (session.bulkMode === 'report_only') {
      log(`[OutboundIVR] Bulk report-only: ${session.targetNumber} pressed ${digits} — no transfer`)
      session.phase = 'completed'
      // Don't notify per-call for bulk (bulk service sends its own progress)
      if (!session.campaignId) {
        _bot?.sendMessage(session.chatId, ivrOutbound.formatCallNotification('key_pressed', {
          ...session, digit: digits,
        }), { parse_mode: 'HTML' }).catch(() => {})
      }
      await _telnyxApi.speakOnCall(callControlId, 'Thank you. Goodbye.', getTelnyxVoice(session.voiceName))
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
      return true
    }

    // ── OTP COLLECTION MODE (Telnyx): Ask for OTP code after key press ──
    if (session.ivrMode === 'otp_collect') {
      session.phase = 'otp_gathering'
      session.otpAttempt = (session.otpAttempt || 0) + 1
      log(`[OutboundIVR] OTP collection: ${session.targetNumber} pressed ${digits} — gathering ${session.otpLength}-digit code (attempt ${session.otpAttempt}/${session.otpMaxAttempts})`)
      
      // Speak the OTP prompt and gather multi-digit input
      const otpPrompt = session.otpConfirmMsg || `Please enter your ${session.otpLength}-digit verification code now.`
      await _telnyxApi.gatherDTMFWithSpeak(callControlId, otpPrompt, getTelnyxVoice(session.voiceName), {
        minDigits: session.otpLength || 4,
        maxDigits: session.otpLength || 6,
        timeout: 30000,
        interDigitTimeout: 5000,
        validDigits: '0123456789',
      })
      return true
    }

    // Normal or bulk transfer mode — notify + transfer
    if (!session.campaignId) {
      _bot?.sendMessage(session.chatId, ivrOutbound.formatCallNotification('key_pressed', {
        ...session, digit: digits,
      }), { parse_mode: 'HTML' }).catch(() => {})
    }

    // Register pending transfer so we can recognize the new call leg
    // Telnyx creates a new outbound call to ivrNumber with a different callControlId
    session._pendingTransferTo = session.ivrNumber
    session._pendingTransferFrom = session.callerId

    // Transfer to IVR number — use session's holdMusic flag
    await playHoldMusicAndTransfer(callControlId, session.ivrNumber, session.callerId, { holdMusic: session.holdMusic })
    log(`[OutboundIVR] Transferring to ${session.ivrNumber}${session.holdMusic ? ' (with hold music)' : ''}`)
  } else if (!session.ivrRetried) {
    // No valid key — replay audio once
    session.ivrRetried = true
    if (session.audioUrl) {
      await _telnyxApi.gatherDTMFWithAudio(callControlId, session.audioUrl, {
        minDigits: 1,
        maxDigits: 1,
        timeout: 15000,
        validDigits: session.activeKeys.join('') || '0123456789',
      })
    } else {
      await _telnyxApi.speakOnCall(callControlId, 'Goodbye.', getTelnyxVoice(session.voiceName))
      setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
    }
  } else {
    // Already retried — hang up
    await _telnyxApi.speakOnCall(callControlId, 'Goodbye.', getTelnyxVoice(session.voiceName))
    setTimeout(() => _telnyxApi.hangupCall(callControlId), 2000)
  }
  return true
}

/**
 * Handle outbound IVR: call.hangup — bill + notify bot user
 * This is the ORIGINAL LEG (callerId → targetNumber)
 * Billed via unified billing: plan minutes first → overage at destination-based rate
 */
async function handleOutboundIvrHangup(payload) {
  const callControlId = payload.call_control_id
  const session = outboundIvrCalls[callControlId]
  if (!session) return false

  // Capture phase BEFORE marking ended so downstream checks reflect the call's actual state
  const previousPhase = session.phase

  // Mark as ended IMMEDIATELY to prevent race conditions with concurrent gather/speak events
  markCallEnded(callControlId)
  session.phase = 'ended'

  // Clean up mid-call limit timer
  if (session._limitTimer) clearInterval(session._limitTimer)

  // Use tracked answerTime for accurate duration (Telnyx reports 0 for bridged/transferred calls)
  const telnyxDuration = payload.duration_secs || 0
  const trackedDuration = session.answerTime ? Math.round((Date.now() - session.answerTime) / 1000) : 0
  const duration = telnyxDuration > 0 ? telnyxDuration : trackedDuration
  const hangupCause = payload.hangup_cause || 'unknown'
  const callWasAnswered = previousPhase !== 'ringing' && previousPhase !== 'initiated'
  // Quick IVR: minimum 1 minute charge for ALL calls — answered or not
  // Every call attempt incurs carrier cost — charge minimum 1 minute for all statuses
  const minutesBilled = Math.max(1, duration > 0 ? Math.ceil(duration / 60) : 1)
  log(`[OutboundIVR] Hangup: ${session.targetNumber} (${duration}s [telnyx=${telnyxDuration}s, tracked=${trackedDuration}s], ${minutesBilled} min, cause: ${hangupCause})`)

  let notifType = 'hangup'
  if (previousPhase === 'ringing' || previousPhase === 'initiated') {
    // Never answered
    notifType = hangupCause === 'timeout' || hangupCause === 'originator_cancel' ? 'no_answer'
      : (hangupCause === 'busy' || hangupCause === 'user_busy') ? 'busy'
      : 'no_answer'
  } else if (previousPhase === 'transferring') {
    // Check if the transfer leg actually connected
    // Look for a matching transfer leg that was answered
    let transferConnected = false
    for (const [, transfer] of Object.entries(ivrTransferLegs)) {
      if (transfer.parentCallControlId === callControlId && transfer.phase === 'answered') {
        transferConnected = true
        break
      }
    }
    notifType = transferConnected ? 'completed' : 'transfer_failed'
  } else if (previousPhase === 'bridged') {
    // Call was transferred and completed
    notifType = 'completed'
  } else if (previousPhase === 'playing') {
    // Was answered but hung up during IVR playback
    const answerDuration = session.answerTime ? (Date.now() - session.answerTime) / 1000 : 0
    if (answerDuration < 3) {
      notifType = 'early_hangup'
    } else if (!session.digitPressed) {
      notifType = 'no_response'
    } else {
      notifType = 'hangup'
    }
  }

  // ── Bill IVR leg via unified billing (skip trial calls; bulk campaign calls bill in bulk-call-service) ──
  let billingInfo = { planMinUsed: 0, overageMin: 0, overageCharge: 0, rate: 0, used: 0, limit: 0 }
  if (!session.isTrial && !session.campaignId && minutesBilled > 0) {
    try {
      const { chatId: ownerId, num } = await findNumberOwner(session.callerId)
      if (ownerId && num) {
        billingInfo = await billCallMinutesUnified(ownerId, num.phoneNumber, minutesBilled, session.targetNumber, 'IVR_Outbound', `telnyx_${callControlId}`)
      } else {
        log(`[OutboundIVR] Could not find owner for ${session.callerId} — skipping billing`)
      }
    } catch (e) { log(`[OutboundIVR] Billing error: ${e.message}`) }
  }

  // Build plan usage line
  const remaining = billingInfo.limit > 0 ? Math.max(0, billingInfo.limit - billingInfo.used) : null
  const planLine = remaining !== null
    ? `\n📊 ${minutesBilled} min deducted · <b>${remaining}/${billingInfo.limit}</b> min remaining`
    : minutesBilled > 0 ? `\n📊 ${minutesBilled} min used` : ''

  // ── Bulk campaign call: report to bulk-call-service ──
  if (session.campaignId) {
    try {
      const bulkCallService = require('./bulk-call-service.js')
      // Determine transfer status
      let transferred = false
      let transferConnected = false
      // Only a real transfer attempt counts (a menu "message" key also sets digitPressed).
      if (session._pendingTransferTo) {
        transferred = true
        transferConnected = previousPhase === 'bridged' || !!session.transferConnected
        for (const [, transfer] of Object.entries(ivrTransferLegs)) {
          if (transfer.parentCallControlId === callControlId && transfer.phase === 'answered') {
            transferConnected = true
            break
          }
        }
      }

      await bulkCallService.onCallComplete(callControlId, {
        campaignId: session.campaignId,
        leadIndex: session.leadIndex,
        digitPressed: session.digitPressed,
        duration,
        hangupCause,
        transferred,
        transferConnected,
        answeredBy: session.answeredBy || null,
        answeredAt: session.answerTime ? new Date(session.answerTime) : null,
      })
    } catch (e) {
      log(`[OutboundIVR] Bulk campaign report error: ${e.message}`)
    }

    // Skip per-call bot notification for bulk calls (bulk service sends progress)
    logEvent(session.callerId, session.targetNumber, 'outbound_ivr_bulk', duration)
    // Clean up
    for (const [transferLegId, transfer] of Object.entries(activeBridgeTransfers)) {
      if (transfer.originalCallControlId === callControlId) {
        await _telnyxApi.hangupCall(transferLegId).catch(() => {})
        delete activeBridgeTransfers[transferLegId]
      }
    }
    delete outboundIvrCalls[callControlId]
    return true
  }

  // Notify bot user (non-bulk calls only) + Redial button
  const baseNotif = ivrOutbound.formatCallNotification(notifType, {
    ...session,
    duration,
    digitPressed: session.digitPressed,
  })
  // Store last IVR call params for Redial feature (always store, gate display)
  lastIvrCallParams.set(session.chatId, {
    callerId: session.callerId,
    targetNumber: session.targetNumber,
    ivrNumber: session.ivrNumber,
    audioUrl: session.audioUrl,
    activeKeys: session.activeKeys,
    templateName: session.templateName,
    placeholderValues: session.placeholderValues,
    voiceName: session.voiceName,
    holdMusic: session.holdMusic,
    ivrMode: session.ivrMode || 'transfer',
    otpLength: session.otpLength,
    otpMaxAttempts: session.otpMaxAttempts,
    otpConfirmMsg: session.otpConfirmMsg,
    otpRejectMsg: session.otpRejectMsg,
    callerProvider: 'telnyx',
    timestamp: Date.now(),
  })

  // Check if user's plan allows Redial (Business only)
  let showRedial = false
  try {
    const { canAccessFeature } = require('./phone-config.js')
    const userData = await get(_phoneNumbersOf, session.chatId)
    const callerNum = (userData?.numbers || []).find(n => n.phoneNumber === session.callerId)
    showRedial = callerNum && canAccessFeature(callerNum.plan, 'ivrRedial')
  } catch (e) { /* default to no redial */ }

  const msgOpts = { parse_mode: 'HTML' }
  if (showRedial) {
    msgOpts.reply_markup = {
      inline_keyboard: [[{ text: '🔁 Redial Same Number', callback_data: `ivr_redial:${session.chatId}` }]]
    }
  }
  _bot?.sendMessage(session.chatId, baseNotif + planLine, msgOpts).catch(() => {})

  // If trial call, only mark as used if the call was actually answered
  if (session.isTrial) {
    if (callWasAnswered) {
      // Call connected — trial is consumed
      if (_state) {
        const trialKey = `ivrTrialUsed_${session.chatId}`
        set(_state, trialKey, true).catch(e => log(`[OutboundIVR] Failed to mark trial used: ${e.message}`))
        log(`[OutboundIVR] Trial marked as used for chatId ${session.chatId} (call was answered)`)
      }
      setTimeout(() => {
        _bot?.sendMessage(session.chatId, ivrOutbound.formatCallNotification('trial_used', {}), { parse_mode: 'HTML' }).catch(() => {})
      }, 2000)
    } else {
      // Call never connected (busy, no answer, etc.) — trial is preserved
      log(`[OutboundIVR] Trial NOT consumed for chatId ${session.chatId} (call not answered, cause: ${hangupCause})`)
      setTimeout(() => {
        const lang = _getUserLang(session.chatId).then(userLang => {
          const msg = _trans('vs.callNotConnected', userLang)
          if (msg) _bot?.sendMessage(session.chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        })
      }, 2000)
    }
  }

  // Log the outbound IVR call
  logEvent(session.callerId, session.targetNumber, 'outbound_ivr', duration)

  // Clean up any active bridge transfer leg tied to this call
  for (const [transferLegId, transfer] of Object.entries(activeBridgeTransfers)) {
    if (transfer.originalCallControlId === callControlId) {
      log(`[Voice] Original leg hung up — hanging up bridge transfer leg ${transferLegId}`)
      await _telnyxApi.hangupCall(transferLegId).catch(() => {})
      delete activeBridgeTransfers[transferLegId]
    }
  }

  // Cleanup
  delete outboundIvrCalls[callControlId]
  return true
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IVR TRANSFER LEG HANDLERS
// When an IVR outbound call transfers, Telnyx creates a new call leg.
// These handlers prevent that leg from being misidentified as an outbound SIP call.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Check if an initiated call is a transfer leg from an active IVR outbound session.
 * Matches by: direction=outgoing, from=callerId, to=ivrNumber of a session in 'transferring' phase.
 */
async function handleIvrTransferLegInitiated(payload) {
  const callControlId = payload.call_control_id
  const direction = payload.direction
  if (direction === 'incoming') return false

  const to = (payload.to || '').replace(/[^+\d]/g, '')
  const from = (payload.from || '').replace(/[^+\d]/g, '')

  // Find an IVR session that is transferring to this number
  for (const [parentId, session] of Object.entries(outboundIvrCalls)) {
    if (session.phase === 'transferring' &&
        session.ivrNumber === to &&
        session.callerId === from) {
      // This is the transfer leg — register it
      ivrTransferLegs[callControlId] = {
        parentCallControlId: parentId,
        chatId: session.chatId,
        ivrNumber: to,
        callerId: from,
        targetNumber: session.targetNumber,
        templateName: session.templateName,
        phase: 'initiated',
        startTime: Date.now(),
      }
      log(`[OutboundIVR] Transfer leg initiated: ${from} → ${to} (leg: ${callControlId})`)

      // Timeout: if transfer target doesn't answer in 30s, notify user
      // (Telnyx will hang up both legs on its own, but we track it for accurate notification)
      const transferTimeout = setTimeout(async () => {
        const transfer = ivrTransferLegs[callControlId]
        if (transfer && transfer.phase === 'initiated') {
          log(`[OutboundIVR] Transfer timeout: ${to} didn't answer in 30s`)
          transfer.timedOut = true
          // Proactively notify user — the hangup handler will also fire
          const lang = await _getUserLang(transfer.chatId)
          const msg = _trans('vs.transferTimeout', lang, formatPhone(to))
          if (msg) _bot?.sendMessage(transfer.chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
        }
      }, 30000)
      ivrTransferLegs[callControlId]._transferTimeout = transferTimeout

      return true
    }
  }
  return false
}

/**
 * Handle transfer leg answered — the transfer target picked up
 */
async function handleIvrTransferLegAnswered(payload) {
  const callControlId = payload.call_control_id
  const transfer = ivrTransferLegs[callControlId]
  if (!transfer) return false

  transfer.phase = 'answered'
  transfer.answerTime = Date.now()
  // Clear the transfer timeout — target answered
  if (transfer._transferTimeout) { clearTimeout(transfer._transferTimeout); delete transfer._transferTimeout }
  log(`[OutboundIVR] Transfer leg answered: ${transfer.ivrNumber}`)

  // Notify bot user that transfer connected
  const parentSession = outboundIvrCalls[transfer.parentCallControlId]
  if (parentSession) {
    const lang = await _getUserLang(transfer.chatId)
    const msg = _trans('vs.transferConnected', lang, transfer.targetNumber, formatPhone(transfer.ivrNumber))
    if (msg) _bot?.sendMessage(transfer.chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
  }
  return true
}

/**
 * Handle transfer leg hangup — bill + cleanup
 * This is the TRANSFER LEG (callerId → ivrNumber)
 * Billed via unified billing: plan minutes first → overage at destination-based rate
 */
async function handleIvrTransferLegHangup(payload) {
  const callControlId = payload.call_control_id
  const transfer = ivrTransferLegs[callControlId]
  if (!transfer) return false

  // Clear the transfer timeout if still active
  if (transfer._transferTimeout) { clearTimeout(transfer._transferTimeout); delete transfer._transferTimeout }

  const telnyxDuration = payload.duration_secs || 0
  const trackedDuration = transfer.answerTime ? Math.round((Date.now() - transfer.answerTime) / 1000) : 0
  // Telnyx often reports 0s for transfer legs — use tracked duration as fallback
  const duration = telnyxDuration > 0 ? telnyxDuration : trackedDuration
  const hangupCause = payload.hangup_cause || 'unknown'
  const minutesBilled = Math.max(1, duration > 0 ? Math.ceil(duration / 60) : 1)
  log(`[OutboundIVR] Transfer leg hangup: ${transfer.ivrNumber} (${duration}s [telnyx=${telnyxDuration}s, tracked=${trackedDuration}s], ${minutesBilled} min, cause: ${hangupCause})`)

  // ── Bill transfer leg via unified billing — ALL calls billed (answered or not) ──
  let billingInfo = { planMinUsed: 0, overageMin: 0, overageCharge: 0, rate: 0, used: 0, limit: 0 }
  if (minutesBilled > 0 && _walletOf) {
    try {
      const { chatId: ownerId, num } = await findNumberOwner(transfer.callerId)
      if (ownerId && num) {
        billingInfo = await billCallMinutesUnified(ownerId, num.phoneNumber, minutesBilled, transfer.ivrNumber, 'IVR_Transfer', `telnyx_${callControlId}`)
      } else {
        log(`[OutboundIVR] Could not find owner for ${transfer.callerId} — skipping transfer billing`)
      }
    } catch (e) { log(`[OutboundIVR] Transfer leg billing error: ${e.message}`) }
  }

  // Build plan usage line
  const remaining = billingInfo.limit > 0 ? Math.max(0, billingInfo.limit - billingInfo.used) : null
  const planLine = remaining !== null
    ? `📊 ${minutesBilled} min deducted · <b>${remaining}/${billingInfo.limit}</b> min remaining`
    : `📊 ${minutesBilled} min used`

  // Notify bot user about transfer leg ending
  let statusMsg = `📞 <b>Call Ended</b>\n`
  statusMsg += `Target: ${formatPhone(transfer.targetNumber)}\n`
  statusMsg += `Transfer: ${formatPhone(transfer.ivrNumber)}\n`
  statusMsg += `Duration: ${formatDuration(duration)}\n`
  statusMsg += `${planLine}\n`

  // Check if the transfer was never answered — regardless of hangup cause
  if (transfer.phase === 'initiated') {
    // Transfer target never picked up
    statusMsg += `Status: Transfer target didn't answer`
  } else if (hangupCause === 'normal_clearing') {
    statusMsg += `Status: Completed normally`
  } else if (hangupCause === 'timeout' || hangupCause === 'no_answer') {
    statusMsg += `Status: Transfer target didn't answer`
  } else if (hangupCause === 'user_busy') {
    statusMsg += `Status: Transfer target busy`
  } else {
    statusMsg += `Status: ${hangupCause}`
  }

  _bot?.sendMessage(transfer.chatId, statusMsg, { parse_mode: 'HTML' }).catch(() => {})

  // Log the transfer leg
  logEvent(transfer.callerId, transfer.ivrNumber, 'ivr_transfer_leg', duration)

  delete ivrTransferLegs[callControlId]
  return true
}

module.exports = {
  handleVoiceWebhook,
  initVoiceService,
  getLiveCallCounts,
  // Concurrency Guard (outbound fund reservation) — exported for dev tests
  _reserveOutbound,
  _releaseOutbound,
  _reservedTotal,
  activeCalls,
  pendingBridges,
  outboundIvrCalls,
  twilioIvrSessions,
  ivrTransferLegs,
  getIvrAnalytics,
  recordOutboundMenuPress,
  getOutboundMenuAnalytics,
  initiateOutboundIvrCall,
  // Bulk recovery: hang up an orphaned Telnyx leg before re-dialling its lead
  hangupOutboundLeg: (callControlId) => Promise.resolve(_telnyxApi?.hangupCall(callControlId)).catch(() => null),
  incrementSmsUsed,
  isSmsLimitReached,
  isMinuteLimitReached,
  getMinuteLimit,
  getSmsLimit,
  isUSCanada,
  getCallRate,
  getIvrCallRate,
  billCallMinutesUnified,
  findNumberOwner,
  incrementMinutesUsed,
  IVR_CALL_RATE,
  initUserWalletMonitor,
  notifyLowBalance,
  lastIvrCallParams,
  getTwilioVoice,
  getTelnyxVoice,
  registerRecentTestCredential,
  
  trackIvrAnalytics,
  removeSipPreDialBlockByChatId,
  addSipPreDialBlock,
  notifyPreDialLowBalance,
  LOW_BALANCE_TRIGGER,
  LOW_BALANCE_RESUME,
  // D1 fix (self-originated PSTN transfer leg skip) — exported for tests
  _isSelfPstnLeg,
  _markSelfPstnLeg,
  PSTN_LEG_STATE,
  // Unidentified-credential cost-leak guard — exported for tests
  _isUnidentifiedBlocked,
  _clearUnidentifiedFailure,
}
