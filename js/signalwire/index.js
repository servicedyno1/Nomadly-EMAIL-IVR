'use strict'
// Provider router: SignalWire first, Telnyx as backup. Wraps the telnyx-service exports so every caller keeps the same API.
const rest = require('./rest')
const voice = require('./voice')
const ib = require('../infobip')
const mt = require('../multitel')
const ce = require('../callengine')
const bird = require('../bird')
const aws = require('../aws')
const txs = require('../telnyx-sip')

const log = (...a) => console.log('[SignalWire]', ...a)
// Telnyx is off for calls and number buying unless TELNYX_FALLBACK=true.
const telnyxBackup = () => String(process.env.TELNYX_FALLBACK || 'false').toLowerCase() === 'true'
// Bird goes first for US/Canada numbers. Returns 'bird', or why not: 'off' | 'unlinked' | 'spend' | 'full'.
const birdMax = () => Number(process.env.BIRD_MAX_CONCURRENT || 20)
async function birdState(from, to, anyDest = false) {
  if (!(anyDest ? /^\+[1-9]\d{7,14}$/ : /^\+1\d{10}$/).test(String(to)) || !bird.enabled() || !ce.enabled() || !ce.connected()) return 'off'
  if (!(await bird.presentable(from))) return 'unlinked'
  if ((await bird.spendLeft()) < Number(process.env.BIRD_MIN_SPEND_LEFT || 1)) return 'spend'
  return ce.activeBird() >= birdMax() ? 'full' : 'bird'
}
// Single calls wait (first come, first served) for a free Bird line, up to BIRD_WAIT_MS, then go via SignalWire.
const birdWaiters = []
// Campaign caller IDs waiting for Bird — the auto-link job links the ones we own first.
const birdWanted = new Set()
async function waitForBirdLine(from, to) {
  const until = Date.now() + Number(process.env.BIRD_WAIT_MS || 120000)
  const me = {}; birdWaiters.push(me)
  try {
    for (;;) {
      const st = await birdState(from, to, true).catch(() => 'off')
      if (st !== 'full' && birdWaiters[0] === me) return st
      if (st !== 'full' && st !== 'bird') return st
      if (Date.now() > until) return 'full'
      await new Promise(r => setTimeout(r, 500))
    }
  } finally { birdWaiters.splice(birdWaiters.indexOf(me), 1) }
}

const swOn = () => rest.enabled()
const sells = (p) => String(process.env.NUMBER_PROVIDERS || 'multitel,infobip').toLowerCase().split(',').map(x => x.trim()).includes(p)

const CALL_FNS = ['answerCall', 'rejectCall', 'hangupCall', 'isCallAlive', 'speakOnCall', 'playbackStart', 'playbackStop', 'gatherDTMF', 'gatherDTMFWithSpeak', 'gatherDTMFWithAudio', 'gatherStop', 'startRecording', 'stopRecording', 'transferCall']

// SignalWire only presents numbers it owns or has verified. Calls from a Telnyx-hosted or custom caller ID go out from one of
// our own SignalWire numbers (same area code when we have one), never one that belongs to a customer.
let reservedCallers = async () => new Set()
const setReservedCallers = (fn) => { reservedCallers = fn }
// Fax-only numbers never place calls, even when every other number is busy.
let neverCallers = async () => new Set()
const setNeverCallers = (fn) => { neverCallers = fn }
// SignalWire refuses to originate from a number it doesn't own/verify. force=true ignores reservations so a call never
// fails just because every owned number is busy — delivery matters more than avoiding a shared caller ID.
async function poolCaller(from, { force = false } = {}) {
  await rest.refreshOwned()
  if (rest.ownsNumber(from)) return from
  const never = await neverCallers().catch(() => new Set())
  const all = rest.ownedNumbers().filter(n => !never.has(n))
  if (!all.length) return null
  const taken = force ? new Set() : await reservedCallers().catch(() => new Set())
  const free = all.filter(n => !taken.has(n))
  const pool = free.length ? free : (force ? all : [])
  if (!pool.length) return null
  const ac = String(from).replace(/\D/g, '').replace(/^1/, '').slice(0, 3)
  return pool.find(n => n.slice(2, 5) === ac) || pool[Math.floor(Math.random() * pool.length)]
}
// SignalWire's "the From number isn't one you own/verified" rejection — retry from a valid owned number.
const SW_CID_REJECT = /purchased or verified|match the parent call|not a valid.*(from|caller)|caller ?id.*not.*(valid|verified|allowed)/i

const BIRD_ONLY = () => String(process.env.OUTBOUND_BIRD_ONLY || 'true').toLowerCase() !== 'false'

function wrap(t) {
  const w = { ...t }
  for (const fn of CALL_FNS) w[fn] = (id, ...a) => (voice.isSw(id) ? voice[fn](id, ...a) : ib.isIb(id) ? ib.voice[fn](id, ...a) : ce.isAe(id) ? ce[fn](id, ...a) : t[fn](id, ...a))
  w.bridgeCalls = (a, b) => (voice.isSw(a) || voice.isSw(b) ? voice.bridgeCalls(a, b) : ib.isIb(a) || ib.isIb(b) ? ib.voice.bridgeCalls(a, b) : ce.isAe(a) || ce.isAe(b) ? ce.bridgeCalls(a, b) : t.bridgeCalls(a, b))

  // US/Canada: Bird (own call engine) → SignalWire → Infobip → Telnyx (only if TELNYX_FALLBACK=true).
  w.createOutboundCall = async (from, to, webhookUrl, connectionId, options = {}) => {
    const nanp = /^\+1\d{10}$/.test(String(to)) || /^sip:/i.test(String(to))
    // Softphones sign in to our own SIP server only, so they're rung from our call engine — never a SignalWire retry
    // (it can't reach them: it only ever answered "No valid devices" / queue full).
    if (/^sip:/i.test(String(to))) {
      // A call that came in on Infobip can only be joined to another Infobip call, so it rings the softphone itself.
      if (ib.isIb(options.ringFor) && ib.sipTrunk()) return ib.voice.createOutboundCall(from, to, webhookUrl, connectionId, options)
      if (!ce.enabled() || !ce.connected()) return { error: 'call engine not connected', status: 503, _provider: 'callengine' }
      const r = await ce.createOutboundCall(from, to, webhookUrl, connectionId, options)
      if (r.error) log(`ring ${to} via CallEngine refused (${r.error}) — not retried elsewhere`)
      return r.error && !r.status ? { ...r, status: 503 } : r
    }
    const tries = []
    // Voicemail drop: the call engine detects answering machines on the call itself (Asterisk AMD), so Bird handles it too.
    // Bird only (default): a caller ID not verified on Bird is swapped for a system caller ID (logged); any failure alerts the admin.
    if (BIRD_ONLY() && !/^sip:/i.test(String(to))) {
      const { birdAlert } = require('../bird-alert')
      let st = await birdState(from, to, true).catch(() => 'off')
      if (st === 'unlinked') {
        const sys = await Promise.resolve().then(() => require('../ivr-outbound').getTrialCaller({ purpose: 'unverified_caller_swap', to, chatId: options.chatId })).then(r => r?.callerId).catch(() => null)
        if (!sys) { birdAlert('no-system-caller', `No system caller ID available to replace unverified ${from}. Call → ${to} was not placed.`); return { error: 'No verified caller ID available', status: 503, _provider: 'callengine' } }
        log(`caller ID ${from} isn't verified on Bird — calling from system number ${sys}`)
        from = sys; st = await birdState(from, to, true).catch(() => 'off')
      }
      if (st === 'full' && !options._campaign) st = await waitForBirdLine(from, to)
      if (st === 'full' && options._campaign) return { error: `all ${birdMax()} Bird lines busy — waiting for a free line`, status: 429, _provider: 'callengine', birdWait: st }
      if (st !== 'bird') {
        const why = { off: 'Bird call engine is offline or not connected', spend: 'Bird daily spend limit reached', unlinked: `caller ID ${from} is not verified on Bird`, full: 'all Bird lines busy' }[st] || `Bird unavailable (${st})`
        birdAlert(`state-${st}`, `${why}. Call ${from} → ${to} was not placed.`)
        return { error: why, status: 503, _provider: 'callengine' }
      }
      const r = await Promise.resolve().then(() => ce.createOutboundCall(from, to, webhookUrl, connectionId, options)).catch(e => ({ error: e.message || String(e) }))
      if (r?.error) birdAlert(`dial-${String(r.error).slice(0, 40)}`, `Bird refused the call ${from} → ${to}: ${r.error}`)
      if (r?.error && !r.status) r.status = 503
      return r
    }
    let st = await birdState(from, to).catch(() => 'off')
    // Campaign calls only go through Bird: a full Bird or a caller ID not linked yet puts the lead back in the queue.
    if (options._campaign && (st === 'full' || st === 'unlinked')) {
      if (st === 'unlinked') birdWanted.add(from)
      return { error: st === 'full' ? `all ${birdMax()} Bird lines busy — waiting for a free line` : `caller ID ${from} not linked on Bird yet — waiting`, status: 429, _provider: 'callengine', birdWait: st }
    }
    if (st === 'full' || (st === 'bird' && birdWaiters.length)) st = await waitForBirdLine(from, to)
    const viaBird = st === 'bird'
    if (viaBird) tries.push(['Bird', () => ce.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    // Backup only (Bird busy/over budget): an Infobip-owned caller ID calls through Infobip before SignalWire, which would swap it for a pool number.
    const ibFirst = !viaBird && ib.enabled() && !/^sip:/i.test(String(to)) && (await ib.refreshOwned().catch(() => [])).includes(from)
    if (ibFirst) tries.push(['Infobip', () => ib.voice.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    if (nanp && swOn() && voice.connected()) tries.push(['SignalWire', async () => {
      const nanpFrom = /^\+1\d{10}$/.test(String(from))
      let use = nanpFrom ? (await poolCaller(from)) || from : from
      let r = await voice.createOutboundCall(use, to, webhookUrl, connectionId, options)
      // SignalWire refused the caller ID → retry once from a guaranteed owned number.
      if (r.error && nanpFrom && SW_CID_REJECT.test(String(r.error))) {
        const forced = await poolCaller(from, { force: true })
        if (forced && forced !== use) {
          log(`caller ID ${use} refused by SignalWire (${r.error}) — retrying from owned number ${forced}`)
          use = forced
          r = await voice.createOutboundCall(use, to, webhookUrl, connectionId, options)
        }
      }
      if (!r.error && use !== from) { r.callerSwapped = { requested: from, used: use }; log(`caller ID ${from} isn't on SignalWire — called ${to} from ${use}`) }
      return r
    }])
    // REST fallback: RELAY is offline but SignalWire REST & LaML callback URLs are available
    if (nanp && swOn() && !voice.connected() && options._swRestCallbackUrl) tries.push(['SignalWire-REST', async () => {
      const nanpFrom = /^\+1\d{10}$/.test(String(from))
      let use = nanpFrom ? (await poolCaller(from)) || from : from
      if (!use || (use === from && !rest.ownsNumber(from))) use = await poolCaller(from, { force: true })
      if (!use) return { error: 'No SignalWire pool number available for REST call', status: 422 }
      let r = await rest.createRestCall(use, to, options._swRestCallbackUrl, options._swRestStatusUrl)
      if (r.error && nanpFrom && SW_CID_REJECT.test(String(r.error))) {
        const forced = await poolCaller(from, { force: true })
        if (forced && forced !== use) {
          log(`caller ID ${use} refused by SignalWire REST (${r.error}) — retrying from owned number ${forced}`)
          use = forced
          r = await rest.createRestCall(use, to, options._swRestCallbackUrl, options._swRestStatusUrl)
        }
      }
      if (r.error) return r
      r.callControlId = `sw:rest:${r.sid}`; r.callLegId = r.sid; r.callSessionId = r.sid
      if (use !== from) { r.callerSwapped = { requested: from, used: use }; log(`caller ID ${from} isn't on SignalWire — REST called ${to} from ${use}`) }
      return r
    }])
    if (!ibFirst && ib.enabled() && !/^sip:/i.test(String(to))) tries.push(['Infobip', () => ib.voice.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    if (!viaBird && !nanp && ce.enabled() && ce.connected()) tries.push(['CallEngine', () => ce.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    if (telnyxBackup() || !tries.length) tries.push(['Telnyx', () => t.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    let first = null
    for (const [name, dial] of tries) {
      const r = await dial()
      if (!r.error) return r
      first = first || r
      log(`dial via ${name} refused (${r.error})`)
    }
    return first
  }

  // SignalWire rate limits re-queue the lead, like Telnyx's line limit.
  w.isLineLimitError = (r) => (['signalwire', 'infobip', 'callengine'].includes(r?._provider) ? r.status === 429 || r.status === 503 : !!t.isLineLimitError?.(r))

  // New numbers: Infobip (default for local numbers) → Telnyx SIP → SignalWire → Infobip → Telnyx old account.
  // Only providers listed in NUMBER_PROVIDERS sell new numbers (owned numbers keep working).
  w.searchNumbers = async (countryCode, numberType, areaCode, limit = 5) => {
    // Least paperwork, then cheapest (number-catalog): MultiTEL leads where it wins, e.g. US/CA without an area code.
    if (mt.enabled() && require('../number-catalog').best(String(countryCode || 'US').toUpperCase(), numberType || 'local')?.provider === 'multitel') { const r = await mt.searchNumbers(countryCode, numberType || 'local', areaCode, limit); if (r.length) return r }
    const up = (p) => !require('../provider-health').isDown(p)
    if (ib.enabled() && up('infobip') && (!numberType || numberType === 'local')) { const r = await ib.searchNumbers(countryCode, numberType, areaCode, limit); if (r.length) return r }
    if (txs.enabled() && sells('telnyx')) {
      const r = await txs.searchNumbers(countryCode, numberType, areaCode, limit, rest.AREA_REGION[Number(areaCode)] || null)
      if (r.length) return r
    }
    if (swOn() && sells('signalwire')) {
      const r = await rest.searchNumbers(countryCode, numberType, areaCode, limit)
      if (r.length) return r
    }
    if (ib.enabled() && up('infobip')) { const r = await ib.searchNumbers(countryCode, numberType, areaCode, limit); if (r.length) return r }
    if (mt.enabled() && up('multitel')) { const r = await mt.searchNumbers(countryCode, numberType || 'local', areaCode, limit); if (r.length) return r }
    // Nobody has this area code → offer numbers from other areas, flagged as such.
    if (areaCode) {
      for (const p of [mt, ib]) {
        if (!p.enabled() || !up(p === mt ? 'multitel' : 'infobip')) continue
        const r = await p.searchNumbers(countryCode, numberType || 'local', null, limit).catch(() => [])
        if (r.length) return r.map(n => ({ ...n, _areaFallback: true, _requestedAreaCode: String(areaCode), _fallbackRegion: n._fallbackRegion || null }))
      }
    }
    // Skip Telnyx while its account can't sell numbers (US/CA-only mode); international searches still try it.
    if (!telnyxBackup() || (['US', 'CA'].includes(String(countryCode || 'US').toUpperCase()) && require('../phone-config').numberSearchUsCaOnly())) return []
    return t.searchNumbers(countryCode, numberType, areaCode, limit)
  }

  w.buyNumber = async (phoneNumber, connectionId, messagingProfileId, retrySearch = null) => {
    if (!txs.isTxSearched(phoneNumber) && !ib.isIbSearched(phoneNumber) && !mt.isMtSearched(phoneNumber)) await ib.recall(phoneNumber).catch(() => false)
    if (txs.isTxSearched(phoneNumber) && sells('telnyx')) {
      let r = await txs.buyNumber(phoneNumber)
      if (!r && retrySearch) {
        const fresh = await txs.searchNumbers(retrySearch.countryCode || 'US', retrySearch.numberType || 'local', retrySearch.areaCode || null, 3)
        if (fresh[0]) { r = await txs.buyNumber(fresh[0].phone_number); if (r) r._retriedNumber = fresh[0].phone_number }
      }
      if (r) ce.setDidApps([r._retriedNumber || phoneNumber])
      return r
    }
    if (ib.isIbSearched(phoneNumber)) return require('../provider-health').buyWithBackup('infobip', phoneNumber, retrySearch)
    if (mt.isMtSearched(phoneNumber)) return require('../provider-health').buyWithBackup('multitel', phoneNumber, retrySearch)
    if (bird.isBirdSearched(phoneNumber)) return bird.buyNumber(phoneNumber)
    if (swOn() && rest.isSwSearched(phoneNumber)) {
      if (!sells('signalwire') || rest.isFull()) return null
      const r = await rest.buyNumber(phoneNumber)
      if (r) return r
      if (retrySearch) {
        const fresh = await rest.searchNumbers(retrySearch.countryCode || 'US', retrySearch.numberType || 'local', retrySearch.areaCode || null, 3)
        if (fresh[0]) { const again = await rest.buyNumber(fresh[0].phone_number); if (again) { again._retriedNumber = fresh[0].phone_number; return again } }
      }
      return null
    }
    return telnyxBackup() ? t.buyNumber(phoneNumber, connectionId, messagingProfileId, retrySearch) : null
  }

  w.getNumberCapabilities = async (phoneNumber) => {
    if (txs.enabled()) { await txs.refreshOwned(); if (txs.ownsNumber(phoneNumber)) return { voice: true, sms: false, mms: false, fax: false } }
    if (swOn()) { await rest.refreshOwned(); if (rest.ownsNumber(phoneNumber)) return { voice: true, sms: true, mms: true, fax: false } }
    return t.getNumberCapabilities(phoneNumber)
  }
  w.updateNumber = (id, updates) => (txs.isTx(id) ? Promise.resolve(true) : voice.isSw(id) ? rest.configureNumber(String(id).slice(3)) : t.updateNumber(id, updates))
  w.releaseNumber = (id) => (txs.isTx(id) ? txs.releaseNumber(id) : voice.isSw(id) ? rest.releaseById(id) : ib.isIb(id) ? ib.releaseNumber(id) : mt.isMt(id) ? mt.releaseNumber(id) : bird.isBird(id) ? bird.releaseNumber(id) : t.releaseNumber(id))
  w.releaseByPhoneNumber = async (phoneNumber) => {
    if (txs.enabled() && await txs.releaseByPhoneNumber(String(phoneNumber).replace(/[^+\d]/g, '')).catch(() => false)) return true
    if (swOn()) { const r = await rest.releaseByPhoneNumber(String(phoneNumber).replace(/[^+\d]/g, '')); if (r !== null) return r }
    return t.releaseByPhoneNumber(phoneNumber)
  }
  w.listNumbers = async () => [...(swOn() ? await rest.listNumbers() : []), ...((await t.listNumbers().catch(() => [])) || [])]
  w.assignNumberToCallControlApp = async (phoneNumber, appId) => {
    if (ib.enabled() && (await ib.refreshOwned()).includes(phoneNumber)) return true // routed to our calls config when bought
    if (mt.enabled() && (await mt.refreshOwned()).includes(phoneNumber)) { ce.setDidApps([phoneNumber]); return true } // SIP URI to our server
    if (txs.enabled()) { await txs.refreshOwned(); if (txs.ownsNumber(phoneNumber)) { ce.setDidApps([phoneNumber]); return true } }
    if (swOn()) { await rest.refreshOwned(); if (rest.ownsNumber(phoneNumber)) return rest.assignNumber(phoneNumber) }
    return t.assignNumberToCallControlApp(phoneNumber, appId)
  }
  // SIP logins live on our own SIP server (brand address, password checked against the bot via /sip-auth).
  const ownSip = () => !!process.env.SIP_SERVER_SECRET
  w.deleteSIPCredential = (id) => (String(id || '').startsWith('kam:') ? Promise.resolve(true) : voice.isSw(id) ? rest.deleteSipEndpoint(id) : t.deleteSIPCredential(id))
  w.createSIPCredential = async (connectionId, username, password, phoneNumber) => {
    if (ownSip() && username && password) return { id: `kam:${username}`, sip_username: username, sip_password: password, kind: 'sipserver' }
    if (swOn() && phoneNumber) {
      await rest.refreshOwned()
      if (rest.ownsNumber(phoneNumber)) {
        const sipLogins = require('../sip-logins')
        const r = await rest.createSipEndpoint(sipLogins.shortUser(), sipLogins.shortPass(), phoneNumber)
        if (r) return r
      }
    }
    return t.createSIPCredential(connectionId, username, password, phoneNumber)
  }

  w.validateForwardingDestination = async (toNumber) => {
    const r = (await bird.lookup(toNumber)) || (swOn() && /^\+1/.test(String(toNumber)) ? await rest.lookup(toNumber) : null) || (await aws.lookup(toNumber)) || (await ib.lookup(toNumber))
    // No lookup answered: don't block the customer (Telnyx lookup removed — account blocked).
    return r || { valid: true, country: 'unknown', carrier: 'unknown', type: 'unknown' }
  }

  w.initializeTelnyxResources = async (...a) => {
    const r = await t.initializeTelnyxResources(...a).catch((e) => { log(`Telnyx init failed: ${e.message}`); return {} })
    return r || {}
  }
  return w
}

// Number lookup for list screening: SignalWire → Bird → AWS → Infobip → Telnyx fax account → { type, carrier } | null
const lookup = async (e164) => (await bird.lookup(e164)) || (swOn() ? await rest.lookup(e164) : null) || (await aws.lookup(e164)) || (await ib.lookup(e164))

// Texts: SignalWire when it owns the sending number, else null (caller keeps its Telnyx path).
async function sendSms(from, to, text, mediaUrls = []) {
  if (!swOn()) return null
  await rest.refreshOwned()
  if (!rest.ownsNumber(from)) return null
  return rest.sendSms(from, to, text, mediaUrls)
}

module.exports = { wrap, rest, voice, lookup, sendSms, enabled: swOn, sells, poolCaller, setReservedCallers, setNeverCallers, birdWanted }
