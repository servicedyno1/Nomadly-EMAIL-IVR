'use strict'
// Infobip Calls adapter: same Telnyx Call Control dialect as signalwire/voice.js. Calls get "ib:" ids; Infobip webhooks
// (/infobip/voice-webhook → ingest) are replayed as Telnyx events. Numbers: search/buy in no-paperwork countries.
const crypto = require('crypto')
const axios = require('axios')

const log = (...a) => console.log('[Infobip]', ...a)
const base = () => `https://${String(process.env.INFOBIP_BASE_URL || 'api.infobip.com').replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
const enabled = () => !!process.env.INFOBIP_API_KEY && String(process.env.INFOBIP_ENABLED || 'true').toLowerCase() !== 'false'
// NUMBER_PROVIDERS (comma list: multitel, infobip) picks who sells NEW numbers; owned numbers keep working.
const selling = () => enabled() && String(process.env.NUMBER_PROVIDERS || 'multitel,infobip').toLowerCase().split(',').map(x => x.trim()).includes('infobip')
const makeHttp = () => axios.create({ baseURL: base(), headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}` }, timeout: 15000 })
const configId = () => process.env.INFOBIP_CALLS_CONFIG_ID || `${String(process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, '')}${process.env.BOT_ENVIRONMENT === 'production' ? '' : '-dev'}`
const errOf = (e) => { const x = e.response?.data?.requestError?.serviceException; return String(x?.text || x?.messageId || e.response?.data?.description || e.message) }
const isIb = (id) => String(id || '').startsWith('ib:')
const raw = (id) => String(id).slice(3)
const e164 = (n) => (n && !String(n).startsWith('+') && /^\d+$/.test(String(n)) ? `+${n}` : String(n || ''))
const digits = (n) => String(n || '').replace(/[^\d]/g, '')
const b64 = (s) => (s ? Buffer.from(String(s)).toString('base64') : undefined)

const legs = new Map()
let sink = null
const setSink = (fn) => { sink = fn }

function emit(type, leg, extra = {}) {
  if (!sink || !leg) return
  const occurred_at = new Date().toISOString()
  const payload = { call_control_id: leg.id, call_leg_id: leg.id, call_session_id: leg.session, connection_id: leg.connection, from: leg.from, to: leg.to, direction: leg.direction, state: leg.state, client_state: leg.clientState, start_time: leg.startedAt, occurred_at, _provider: 'infobip', ...extra }
  setImmediate(() => Promise.resolve(sink({ data: { event_type: type, id: crypto.randomUUID(), occurred_at, payload } })).catch(e => log(`${type} handler error: ${e.message}`)))
}
function track(meta) {
  const leg = { session: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'parked', ...meta }
  legs.set(leg.id, leg)
  return leg
}
const CAUSE = { NORMAL_HANGUP: ['normal_clearing', '16'], BUSY: ['user_busy', '486'], NO_ANSWER: ['timeout', '480'], CANCELLED: ['originator_cancel', '487'], REJECTED: ['call_rejected', '603'], DECLINED: ['call_rejected', '603'] }
function finish(leg, errName) {
  if (!leg || leg.ended) return
  leg.ended = true; leg.state = 'hangup'
  const [cause, sip] = CAUSE[errName] || (errName ? ['unspecified', '500'] : CAUSE.NORMAL_HANGUP)
  if (!leg.quietEnd) emit('call.hangup', leg, { hangup_cause: cause, sip_hangup_cause: sip, hangup_source: leg.hungUpByUs ? 'callee' : 'caller', end_time: new Date().toISOString() })
  if (leg.transferOf) { const a = legs.get(leg.transferOf); if (a && !a.ended && a.peer === leg.id && leg.answered) hangupCall(a.id) }
  setTimeout(() => legs.delete(leg.id), 10 * 60000)
}
function markAnswered(leg) { if (leg.answered) return; leg.answered = true; leg.state = 'answered'; emit('call.answered', leg) }

const post = async (path, body = {}) => { try { return (await M.http().post(path, body)).data || {} } catch (e) { log(`${path}: ${errOf(e)}`); return null } }
const live = (id) => { const l = legs.get(id); return l && !l.ended ? l : null }
const lang2 = (l) => String(l || 'en').slice(0, 2).toLowerCase()
const voicePrefs = (voice) => ({ voiceGender: /^male$/i.test(String(voice || '')) ? 'MALE' : 'FEMALE' })

// ── webhook → Telnyx events ──
async function ingest(ev) {
  if (!ev?.type) return
  const id = `ib:${ev.callId || ''}`
  const p = ev.properties || {}
  const call = p.callLog || p.call || {}
  let leg = legs.get(id) || [...legs.values()].find(l => l.ibCallId === ev.callId)
  if (ev.type === 'CALL_RECEIVED' && !leg) {
    leg = track({ id, from: e164(call.from || p.from), to: e164(call.to || p.to || call.endpoint?.phoneNumber), direction: 'incoming', connection: process.env.TELNYX_CALL_CONTROL_APP_ID || 'infobip-app' })
    leg.initiatedSent = true
    return emit('call.initiated', leg)
  }
  if (!leg) return
  switch (ev.type) {
    case 'CALL_RINGING': case 'CALL_PRE_ESTABLISHED':
      if (!leg.initiatedSent) { leg.initiatedSent = true; emit('call.initiated', leg) }
      break
    case 'CALL_ESTABLISHED':
      markAnswered(leg)
      if (leg.transferOf) { const a = legs.get(leg.transferOf); if (a) emit('call.bridged', a); emit('call.bridged', leg) }
      break
    case 'SAY_FINISHED': if (!leg.stopped) emit('call.speak.ended', leg, { status: 'completed' }); leg.stopped = false; break
    case 'PLAY_FINISHED': if (!leg.stopped) emit(leg.gathering ? 'call.speak.ended' : 'call.playback.ended', leg, { status: 'completed' }); leg.stopped = false; break
    case 'DTMF_CAPTURED': {
      leg.gathering = false
      if (leg.stopped) { leg.stopped = false; break }
      const d = String(p.dtmf ?? p.capturedDtmf ?? p.digits ?? '').replace(/[^0-9*#]/g, '')
      const g = leg.gather || {}
      let status = d ? 'valid' : 'timeout'
      if (status === 'valid' && d.length < (g.minDigits || 1)) status = 'timeout'
      if (status === 'valid' && g.validDigits && [...d].some(c => !String(g.validDigits).includes(c))) status = 'invalid'
      emit('call.gather.ended', leg, { digits: d, status })
      break
    }
    case 'MACHINE_DETECTION_FINISHED': {
      const r = String(p.detectionResult || p.result || '').toUpperCase()
      emit('call.machine.detection.ended', leg, { result: r === 'HUMAN' ? 'human' : r === 'MACHINE' ? 'machine' : 'not_sure' })
      break
    }
    case 'CALL_RECORDING_READY': {
      const f = p.recording?.files?.[0] || p.files?.[0] || p.file || {}
      if (!f.id) break
      const url = `${String(process.env.SELF_URL || '').replace(/\/+$/, '')}/infobip/recording/${f.id}?k=${recordingToken(f.id)}`
      emit('call.recording.saved', leg, { recording_urls: { mp3: url }, public_recording_urls: { mp3: url }, duration_secs: Math.round(f.duration || 0), channels: 'single' })
      break
    }
    case 'CALL_FINISHED': case 'CALL_FAILED':
      finish(leg, call.errorCode?.name || p.errorCode?.name || (ev.type === 'CALL_FAILED' ? 'FAILED' : null))
      break
  }
}
const smsHookKey = () => crypto.createHmac('sha256', String(process.env.INFOBIP_API_KEY || '')).update('sms-hook').digest('hex').slice(0, 24)
// Texts to this number are posted to our SMS webhook.
async function routeSms(numberKey) {
  const url = `${String(process.env.SELF_URL || '').replace(/\/+$/, '')}/infobip/sms-webhook/${smsHookKey()}`
  const body = { action: { type: 'HTTP_FORWARD', httpMethod: 'POST', url, contentType: 'JSON' } }
  try {
    const cur = (await M.http().get(`/numbers/2/numbers/${numberKey}/sms`)).data?.configurations?.[0]
    if (cur?.key) await M.http().delete(`/numbers/1/numbers/${numberKey}/configurations/${cur.key}`) // one SMS action per number: replace it
    await M.http().post(`/numbers/2/numbers/${numberKey}/sms`, body)
    return true
  } catch (e) { log(`sms route ${numberKey}:`, errOf(e)); return false }
}
const recordingToken = (fileId) => crypto.createHmac('sha256', String(process.env.INFOBIP_API_KEY || '')).update(String(fileId)).digest('hex').slice(0, 24)

// ── Call control (telnyx-service names) ──
const answerCall = async (id) => (live(id) ? post(`/calls/1/calls/${raw(id)}/answer`, {}) : null)
async function hangupCall(id) { const l = live(id); if (!l) return null; l.hungUpByUs = true; await post(`/calls/1/calls/${raw(id)}/hangup`, {}); return null }
async function rejectCall(id, cause = 'CALL_REJECTED') { const l = live(id); if (!l) return null; await post(`/calls/1/calls/${raw(id)}/hangup`, { errorCode: cause === 'USER_BUSY' ? 'BUSY' : 'REJECTED' }); return null }
const isCallAlive = async (id) => !!live(id)
const speakOnCall = async (id, text, voice, language) => (live(id) ? post(`/calls/1/calls/${raw(id)}/say`, { text: String(text || ''), language: lang2(language), preferences: voicePrefs(voice) }) : null)
async function playbackStart(id, audioUrl, options = {}) {
  const l = live(id); if (!l) return null
  l.stopped = false; l.gathering = false
  const loopCount = String(options.loop) === 'infinity' ? 1000 : Math.max(1, Number(options.loop) || 1)
  return post(`/calls/1/calls/${raw(id)}/play`, { content: { type: 'URL', fileUrl: audioUrl }, loopCount })
}
async function playbackStop(id) { const l = live(id); if (!l) return null; l.stopped = true; return post(`/calls/1/calls/${raw(id)}/stop-play`, {}) }
async function gather(id, { text, voice, language, audioUrl, minDigits = 1, maxDigits = 1, timeout = 15000, interDigitTimeout = 5000, validDigits, terminator = '#' }) {
  const l = live(id); if (!l) return null
  l.gather = { minDigits, validDigits }; l.gathering = true; l.stopped = false
  const playContent = audioUrl ? { type: 'URL', fileUrl: audioUrl } : text ? { type: 'TEXT', text: String(text), language: lang2(language), preferences: voicePrefs(voice) } : undefined
  return post(`/calls/1/calls/${raw(id)}/capture/dtmf`, { maxLength: maxDigits, timeout: Math.max(1, Math.round(timeout / 1000)), digitTimeout: Math.max(1, Math.round(interDigitTimeout / 1000)), terminator, ...(playContent ? { playContent } : {}) })
}
const gatherDTMF = (id, payload, o = {}) => gather(id, { ...o, text: payload, validDigits: o.validDigits || '0123456789*#', timeout: o.timeout || 10000 })
const gatherDTMFWithSpeak = (id, text, voice, o = {}) => gather(id, { ...o, text, voice })
const gatherDTMFWithAudio = (id, audioUrl, o = {}) => gather(id, { ...o, audioUrl })
async function gatherStop(id) { const l = live(id); if (!l) return null; l.stopped = true; return post(`/calls/1/calls/${raw(id)}/stop-play`, {}) }
const startRecording = async (id, channels, format, { playBeep = false } = {}) => (live(id) ? post(`/calls/1/calls/${raw(id)}/start-recording`, { recording: { recordingType: 'AUDIO', beep: !!playBeep } }) : null)
const stopRecording = async (id) => (legs.get(id) ? post(`/calls/1/calls/${raw(id)}/stop-recording`, {}) : null)

async function transferCall(id, toNumber, fromNumber, options = {}) {
  const a = live(id); if (!a) return null
  const from = digits(fromNumber || (a.direction === 'incoming' ? a.to : a.from))
  const r = await post(`/calls/1/calls/${raw(id)}/connect`, { callRequest: { endpoint: { type: 'PHONE', phoneNumber: digits(toNumber) }, from, connectTimeout: options.timeoutSecs || 30 }, ringbackGeneration: { enabled: true } })
  const bId = r?.callId || r?.id || r?.calls?.find?.(c => c.id !== raw(id))?.id
  if (!bId) return null
  const b = track({ id: `ib:${bId}`, from: e164(from), to: toNumber, direction: 'outgoing', connection: a.connection, clientState: b64(options.targetLegClientState), session: a.session, transferOf: a.id, initiatedSent: true })
  a.peer = b.id
  emit('call.initiated', b)
  return { result: 'ok' }
}
async function bridgeCalls(aId, bId) { const r = await post('/calls/1/connect', { callIds: [raw(aId), raw(bId)] }); if (r) { emit('call.bridged', legs.get(aId)); emit('call.bridged', legs.get(bId)) } return r ? { success: true } : null }

async function createOutboundCall(from, to, webhookUrl, connectionId, options = {}) {
  if (/^sip:/i.test(String(to))) return { error: 'Infobip SIP dialing not set up', status: 422, _provider: 'infobip' }
  const amd = options.answering_machine_detection && options.answering_machine_detection !== false
  try {
    const r = (await M.http().post('/calls/1/calls', { endpoint: { type: 'PHONE', phoneNumber: digits(to) }, from: digits(from), callsConfigurationId: configId(), connectTimeout: options.timeout_secs || 30, ...(amd ? { machineDetection: { enabled: true } } : {}) })).data
    if (r.state === 'FAILED') return { error: 'Infobip refused the call', status: 422, _provider: 'infobip' }
    const leg = track({ id: `ib:${r.id}`, from, to, direction: 'outgoing', connection: connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID || 'infobip-app', clientState: options.client_state })
    return { callControlId: leg.id, callLegId: leg.id, callSessionId: leg.session }
  } catch (e) { const t = errOf(e); return { error: t, status: e.response?.status === 429 ? 429 : 422, _provider: 'infobip' } }
}

// ── Numbers ──
const searched = new Map() // e164 → numberKey
async function searchNumbers(countryCode, numberType, areaCode, limit = 5, { sms = false } = {}) {
  if (!selling()) return []
  try {
    const cc = String(countryCode || 'US').toUpperCase()
    const params = { country: cc, limit: areaCode ? 100 : Math.max(limit, 10), capabilities: sms ? 'SMS' : 'VOICE' }
    // Infobip ignores area codes, so filter here (US/CA: 1 + area code; elsewhere: digits appear in the number).
    const inArea = (num) => !areaCode || (['US', 'CA', 'PR'].includes(cc) ? String(num).startsWith(`1${areaCode}`) : String(num).includes(String(areaCode)))
    const list = ((await M.http().get('/numbers/1/numbers/available', { params })).data?.numbers || []).filter(n => !n.additionalSetupRequired && inArea(n.number)).slice(0, limit)
    return list.map(n => {
      const num = e164(n.number); searched.set(num, n.numberKey)
      const caps = n.capabilities || []
      return { record_type: 'available_phone_number', phone_number: num, features: caps.map(c => ({ name: c.toLowerCase() })), region_information: [{ region_type: 'country_code', region_name: n.country }],
        cost_information: { currency: n.price?.currency || 'EUR', monthly_cost: String(n.price?.pricePerMonth || 0), upfront_cost: String(n.price?.setupPrice || 0) },
        _capabilities: { voice: caps.includes('VOICE'), sms: caps.includes('SMS'), mms: caps.includes('MMS'), fax: false }, _provider: 'infobip' }
    })
  } catch (e) { log('search:', errOf(e)); return [] }
}
const isIbSearched = (n) => searched.has(String(n || ''))
// Resale note (end user's name + address) put on the number right after it is bought.
const notes = new Map()
const setResaleNote = (phoneNumber, note) => { if (note) notes.set(phoneNumber, String(note).slice(0, 250)) }
async function saveNote(numberKey, note) {
  try {
    const cur = (await M.http().get(`/numbers/1/numbers/${numberKey}`)).data
    await M.http().put(`/numbers/1/numbers/${numberKey}`, { applicationId: cur.applicationId || 'default', note })
    const kept = (await M.http().get(`/numbers/1/numbers/${numberKey}`)).data?.note === note
    log(`resale note ${kept ? 'saved' : 'NOT kept by Infobip'} on ${numberKey}`)
  } catch (e) { log(`resale note on ${numberKey}:`, errOf(e)) }
}
async function buyNumber(phoneNumber) {
  if (!selling()) return null
  const key = searched.get(phoneNumber); if (!key) return null
  try {
    const n = (await M.http().post('/numbers/1/numbers', { numberKey: key })).data
    if (!n.capabilities || (n.capabilities || []).includes('VOICE')) await M.http().post(`/numbers/2/numbers/${n.numberKey || key}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: configId() } })
    if ((n.capabilities || []).includes('SMS')) await routeSms(n.numberKey || key)
    searched.delete(phoneNumber)
    log(`Bought ${phoneNumber} → calls config ${configId()}`)
    const note = notes.get(phoneNumber); notes.delete(phoneNumber)
    if (note) await saveNote(n.numberKey || key, note)
    return { id: `ib:${n.numberKey || key}`, status: 'success', requirements_met: true, phone_numbers: [{ id: `ib:${n.numberKey || key}`, phone_number: phoneNumber, status: 'success', requirements_status: 'requirements-met' }], _provider: 'infobip' }
  } catch (e) { log(`buy ${phoneNumber}:`, errOf(e)); return null }
}
// Numbers this Infobip account owns (E.164), refreshed by the Bird auto-link tick.
let owned = []
async function refreshOwned() {
  if (!enabled()) return owned
  try {
    const list = (await M.http().get('/numbers/1/numbers', { params: { limit: 1000 } })).data?.numbers || []
    owned = list.map(n => e164(n.number))
    syncVoiceRouting(list).catch(e => log('voice routing sync:', errOf(e)))
  } catch (e) { log('owned numbers:', errOf(e)) }
  return owned
}
// Production owns inbound calls: point every voice number at our calls config (a preview/dev buy can leave it on the dev config).
let lastSync = 0
async function syncVoiceRouting(list) {
  // Main brand only: the Infobip account is shared, and only the 'nomadly' calls config exists.
  if (process.env.BOT_ENVIRONMENT !== 'production' || configId() !== 'nomadly' || Date.now() - lastSync < 3600000) return
  lastSync = Date.now()
  for (const n of list.filter(x => (x.capabilities || []).includes('VOICE'))) {
    const cur = (await M.http().get(`/numbers/2/numbers/${n.numberKey}/voice`).catch(() => ({ data: null }))).data
    if (cur?.action?.callsConfigurationId === configId()) continue
    if (cur?.action) await M.http().delete(`/numbers/2/numbers/${n.numberKey}/voice`)
    await M.http().post(`/numbers/2/numbers/${n.numberKey}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: configId() } })
    log(`voice routing for +${n.number}: ${cur?.action?.callsConfigurationId || 'none'} → ${configId()}`)
  }
}
const ownedNumbers = () => owned
async function releaseNumber(id) { try { await M.http().delete(`/numbers/1/numbers/${raw(id)}`); return true } catch (e) { log('release:', errOf(e)); return false } }

// Number lookup (HLR) → { valid, type, carrier } | null when unavailable
async function lookup(e) {
  if (!enabled()) return null
  try {
    const r = (await M.http().post('/number/1/query', { to: [digits(e)] })).data?.results?.[0]
    if (!r || r.status?.groupName === 'REJECTED') return null
    return { valid: r.error?.groupName !== 'PERMANENT', country: r.originalNetwork?.countryPrefix || 'unknown', carrier: r.originalNetwork?.networkName || 'unknown', type: 'mobile' }
  } catch (err) { log('lookup:', errOf(err)); return null }
}

// Texts → { id } | { error }
async function sendSms(from, to, text) {
  try { const r = (await M.http().post('/sms/2/text/advanced', { messages: [{ from: digits(from), destinations: [{ to: digits(to) }], text, ...(process.env.SELF_URL ? { notifyUrl: `${String(process.env.SELF_URL).replace(/\/+$/, '')}/infobip/sms-dlr/${smsHookKey()}`, notifyContentType: 'application/json' } : {}) }] })).data; return { id: r.messages?.[0]?.messageId || null } } catch (e) { return { error: errOf(e) } }
}

const M = module.exports = {
  enabled, selling, isIb, configId, http: makeHttp, errOf, recordingToken, smsHookKey, routeSms,
  voice: { ingest, setSink, _legs: legs, answerCall, rejectCall, hangupCall, isCallAlive, speakOnCall, playbackStart, playbackStop, gatherDTMF, gatherDTMFWithSpeak, gatherDTMFWithAudio, gatherStop, startRecording, stopRecording, transferCall, bridgeCalls, createOutboundCall },
  searchNumbers, isIbSearched, buyNumber, releaseNumber, refreshOwned, ownedNumbers, lookup, sendSms, setResaleNote,
}
