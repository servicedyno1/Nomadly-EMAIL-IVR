'use strict'
// Provider router: SignalWire first, Telnyx as backup. Wraps the telnyx-service exports so every caller keeps the same API.
const rest = require('./rest')
const voice = require('./voice')
const ib = require('../infobip')

const log = (...a) => console.log('[SignalWire]', ...a)
const telnyxBackup = () => String(process.env.TELNYX_FALLBACK || 'true').toLowerCase() !== 'false'
const swOn = () => rest.enabled()

const CALL_FNS = ['answerCall', 'rejectCall', 'hangupCall', 'isCallAlive', 'speakOnCall', 'playbackStart', 'playbackStop', 'gatherDTMF', 'gatherDTMFWithSpeak', 'gatherDTMFWithAudio', 'gatherStop', 'startRecording', 'stopRecording', 'transferCall']

function wrap(t) {
  const w = { ...t }
  for (const fn of CALL_FNS) w[fn] = (id, ...a) => (voice.isSw(id) ? voice[fn](id, ...a) : ib.isIb(id) ? ib.voice[fn](id, ...a) : t[fn](id, ...a))
  w.bridgeCalls = (a, b) => (voice.isSw(a) || voice.isSw(b) ? voice.bridgeCalls(a, b) : ib.isIb(a) || ib.isIb(b) ? ib.voice.bridgeCalls(a, b) : t.bridgeCalls(a, b))

  // US/Canada: SignalWire → Infobip → Telnyx. Other countries: Infobip → Telnyx.
  w.createOutboundCall = async (from, to, webhookUrl, connectionId, options = {}) => {
    const nanp = /^\+1\d{10}$/.test(String(to)) || /^sip:/i.test(String(to))
    const tries = []
    if (nanp && swOn() && voice.connected()) tries.push(['SignalWire', () => voice.createOutboundCall(from, to, webhookUrl, connectionId, options)])
    if (ib.enabled() && !/^sip:/i.test(String(to))) tries.push(['Infobip', () => ib.voice.createOutboundCall(from, to, webhookUrl, connectionId, options)])
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
  w.isLineLimitError = (r) => (r?._provider === 'signalwire' ? r.status === 429 : !!t.isLineLimitError?.(r))

  w.searchNumbers = async (countryCode, numberType, areaCode, limit = 5) => {
    if (swOn()) {
      const r = await rest.searchNumbers(countryCode, numberType, areaCode, limit)
      if (r.length) return r
    }
    if (ib.enabled()) { const r = await ib.searchNumbers(countryCode, numberType, areaCode, limit); if (r.length || !telnyxBackup()) return r }
    return t.searchNumbers(countryCode, numberType, areaCode, limit)
  }

  w.buyNumber = async (phoneNumber, connectionId, messagingProfileId, retrySearch = null) => {
    if (ib.isIbSearched(phoneNumber)) return ib.buyNumber(phoneNumber)
    if (swOn() && rest.isSwSearched(phoneNumber)) {
      const r = await rest.buyNumber(phoneNumber)
      if (r) return r
      if (retrySearch) {
        const fresh = await rest.searchNumbers(retrySearch.countryCode || 'US', retrySearch.numberType || 'local', retrySearch.areaCode || null, 3)
        if (fresh[0]) { const again = await rest.buyNumber(fresh[0].phone_number); if (again) { again._retriedNumber = fresh[0].phone_number; return again } }
      }
      return null
    }
    return t.buyNumber(phoneNumber, connectionId, messagingProfileId, retrySearch)
  }

  w.getNumberCapabilities = async (phoneNumber) => {
    if (swOn()) { await rest.refreshOwned(); if (rest.ownsNumber(phoneNumber)) return { voice: true, sms: true, mms: true, fax: false } }
    return t.getNumberCapabilities(phoneNumber)
  }
  w.updateNumber = (id, updates) => (voice.isSw(id) ? rest.configureNumber(String(id).slice(3)) : t.updateNumber(id, updates))
  w.releaseNumber = (id) => (voice.isSw(id) ? rest.releaseById(id) : ib.isIb(id) ? ib.releaseNumber(id) : t.releaseNumber(id))
  w.releaseByPhoneNumber = async (phoneNumber) => {
    if (swOn()) { const r = await rest.releaseByPhoneNumber(String(phoneNumber).replace(/[^+\d]/g, '')); if (r !== null) return r }
    return t.releaseByPhoneNumber(phoneNumber)
  }
  w.listNumbers = async () => [...(swOn() ? await rest.listNumbers() : []), ...((await t.listNumbers().catch(() => [])) || [])]
  w.assignNumberToCallControlApp = async (phoneNumber, appId) => {
    if (swOn()) { await rest.refreshOwned(); if (rest.ownsNumber(phoneNumber)) return rest.assignNumber(phoneNumber) }
    return t.assignNumberToCallControlApp(phoneNumber, appId)
  }
  w.deleteSIPCredential = (id) => (voice.isSw(id) ? rest.deleteSipEndpoint(id) : t.deleteSIPCredential(id))
  w.createSIPCredential = async (connectionId, username, password, phoneNumber) => {
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
    if (swOn() && /^\+1/.test(String(toNumber))) { const r = await rest.lookup(toNumber); if (r) return r }
    const r = await ib.lookup(toNumber)
    if (r) return r
    return t.validateForwardingDestination(toNumber)
  }

  w.initializeTelnyxResources = async (...a) => {
    const r = await t.initializeTelnyxResources(...a).catch((e) => { log(`Telnyx init failed: ${e.message}`); return {} })
    return r || {}
  }
  return w
}

// Number lookup for list screening → { type, carrier } | null
const lookup = async (e164) => (swOn() ? await rest.lookup(e164) : null) || ib.lookup(e164)

// Texts: SignalWire when it owns the sending number, else null (caller keeps its Telnyx path).
async function sendSms(from, to, text, mediaUrls = []) {
  if (!swOn()) return null
  await rest.refreshOwned()
  if (!rest.ownsNumber(from)) return null
  return rest.sendSms(from, to, text, mediaUrls)
}

module.exports = { wrap, rest, voice, lookup, sendSms, enabled: swOn }
