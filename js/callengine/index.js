'use strict'
// Own call engine (Asterisk ARI on the SIP server) speaking the Telnyx Call Control dialect. Calls get "ae:" ids.
// PSTN goes through the DIDWW trunk; softphones through Kamailio on the same server.
const crypto = require('crypto')
const axios = require('axios')
const https = require('https')
const WebSocket = require('ws')

const log = (...a) => console.log('[CallEngine]', ...a)
const agent = new https.Agent({ rejectUnauthorized: false })
const url = () => String(process.env.ASTERISK_ARI_URL || '').replace(/\/+$/, '')
const enabled = () => !!(url() && process.env.ASTERISK_ARI_PASSWORD) && String(process.env.CALL_ENGINE_ENABLED || 'true') !== 'false'
const app = () => process.env.CALL_ENGINE_APP || `${String(process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, '')}${process.env.BOT_ENVIRONMENT === 'production' ? '' : '-dev'}`
const makeAri = () => axios.create({ baseURL: `${url()}/ari`, httpsAgent: agent, auth: { username: process.env.ASTERISK_ARI_USER || 'cloudivr', password: process.env.ASTERISK_ARI_PASSWORD }, timeout: 10000 })
const isAe = (id) => String(id || '').startsWith('ae:')
const raw = (id) => String(id).slice(3)
const b64u = (s) => Buffer.from(String(s)).toString('base64url')
const b64 = (s) => (s ? Buffer.from(String(s)).toString('base64') : undefined)
const self = () => String(process.env.SELF_URL || '').replace(/\/+$/, '')
const sign = (s) => crypto.createHmac('sha256', String(process.env.ASTERISK_ARI_PASSWORD || '')).update(String(s)).digest('hex').slice(0, 24)

const legs = new Map()
const playbacks = new Map() // playback id → { leg, kind }
let sink = null, ws = null, connected = false

function emit(type, leg, extra = {}) {
  if (!sink || !leg) return
  const occurred_at = new Date().toISOString()
  const payload = { call_control_id: leg.id, call_leg_id: leg.id, call_session_id: leg.session, connection_id: leg.connection, from: leg.from, to: leg.to, direction: leg.direction, state: leg.state, client_state: leg.clientState, start_time: leg.startedAt, occurred_at, ...(leg.fromSipUri ? { from_sip_uri: leg.fromSipUri } : {}), _provider: 'callengine', ...extra }
  setImmediate(() => Promise.resolve(sink({ data: { event_type: type, id: crypto.randomUUID(), occurred_at, payload } })).catch(e => log(`${type} handler error: ${e.message}`)))
}
const track = (meta) => { const l = { session: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'parked', ...meta }; legs.set(l.id, l); return l }
const live = (id) => { const l = legs.get(id); return l && !l.ended ? l : null }
const call = async (method, path, params, data) => { try { return (await M.ari().request({ method, url: path, params, data })).data || {} } catch (e) { log(`${method} ${path}: ${e.response?.status || ''} ${e.response?.data?.message || e.message}`); return null } }
function markAnswered(l) { if (l.answered) return; l.answered = true; l.state = 'answered'; emit('call.answered', l); if (l.amd) emit('call.machine.detection.ended', l, { result: 'not_sure' }) }
const CAUSE = { 16: ['normal_clearing', '16'], 17: ['user_busy', '486'], 18: ['timeout', '480'], 19: ['timeout', '480'], 21: ['call_rejected', '603'], 1: ['unallocated_number', '404'], 34: ['normal_temporary_failure', '503'] }
function finish(l, cause) {
  if (!l || l.ended) return
  l.ended = true; l.state = 'hangup'; l.loop = null
  clearTimeout(l.gTimer)
  const [c, sip] = CAUSE[cause] || (l.answered ? CAUSE[16] : ['originator_cancel', '487'])
  emit('call.hangup', l, { hangup_cause: c, sip_hangup_cause: sip, hangup_source: l.hungUpByUs ? 'callee' : 'caller', end_time: new Date().toISOString() })
  if (l.transferOf) { const a = legs.get(l.transferOf); if (a && !a.ended && a.peer === l.id && l.answered) hangupCall(a.id) }
  setTimeout(() => legs.delete(l.id), 10 * 60000)
}

// ── media: everything is converted to 8 kHz wav by the media helper on the SIP server ──
const conv = (audioUrl) => `sound:http://127.0.0.1:8090/c.wav?u=${b64u(audioUrl)}`
function ttsMedia(text, voice, language) {
  const male = /^male$/i.test(String(voice || '')) || /matthew|joey|justin|brian/i.test(String(voice || ''))
  if (process.env.OPENAI_API_KEY && self()) {
    const q = `t=${b64u(text)}&g=${male ? 'm' : 'f'}`
    return conv(`${self()}/callengine/tts.mp3?${q}&k=${sign(q)}`)
  }
  return `sound:http://127.0.0.1:8090/tts.wav?t=${b64u(text)}&g=${male ? 'male' : 'female'}&l=${String(language || 'en').slice(0, 2)}`
}
async function play(l, media, kind) {
  const pid = crypto.randomUUID()
  playbacks.set(pid, { leg: l, kind })
  l.playback = pid
  const r = await call('post', `/channels/${raw(l.id)}/play/${pid}`, { media })
  if (!r) { playbacks.delete(pid); return null }
  return pid
}

// ── events ──
function onEvent(e) {
  const ch = e.channel
  const id = ch ? `ae:${ch.id}` : null
  let l = id && legs.get(id)
  switch (e.type) {
    case 'StasisStart': {
      if (l) { if (ch.state === 'Up') onUp(l); break }
      if (e.args?.[0] === 'out') break
      const sip = e.args?.[0] === 'sip'
      const exten = e.args?.[1] || ch.dialplan?.exten || ''
      const num = (n) => (n && /^\d{10,15}$/.test(n) ? `+${n}` : n)
      l = track({ id, direction: sip ? 'outgoing' : 'incoming', to: num(exten.replace(/^\+/, '')), from: sip ? `sip:${e.args?.[2] || ch.caller?.number}@${process.env.SIP_DOMAIN || 'sip.cloudivr.net'}` : num(String(ch.caller?.number || '').replace(/^\+/, '')), connection: sip ? (process.env.TELNYX_SIP_CONNECTION_ID || 'callengine-sip') : (process.env.TELNYX_CALL_CONTROL_APP_ID || 'callengine-app'), initiatedSent: true })
      if (sip) l.fromSipUri = l.from
      emit('call.initiated', l)
      break
    }
    case 'ChannelStateChange': if (l && ch.state === 'Up') onUp(l); break
    case 'ChannelHangupRequest': if (l && e.cause) l.cause = e.cause; break
    case 'ChannelDestroyed': if (l) finish(l, e.cause || l.cause); break
    case 'StasisEnd': if (l) setTimeout(() => finish(l, l.cause), 300); break
    case 'PlaybackFinished': {
      const p = playbacks.get(e.playback?.id); playbacks.delete(e.playback?.id)
      if (e.playback?.state === 'failed') log(`playback failed: ${String(e.playback.media_uri).slice(0, 80)}`)
      if (!p || p.leg.ended || p.stopped) break
      const pl = p.leg
      if (p.kind === 'loop' && pl.loop && --pl.loop.left > 0) { play(pl, pl.loop.media, 'loop'); break }
      if (p.kind === 'prompt') { if (pl.gather && !pl.gather.digits.length) armGather(pl, pl.gather.timeout); break }
      emit(p.kind === 'speak' ? 'call.speak.ended' : 'call.playback.ended', pl, { status: 'completed' })
      break
    }
    case 'ChannelDtmfReceived': if (l?.gather) onDigit(l, e.digit); break
    case 'RecordingFinished': case 'RecordingFailed': {
      const name = e.recording?.name; const rl = [...legs.values()].find(x => x.recName === name)
      if (!rl || e.type === 'RecordingFailed') break
      const u = `${self()}/callengine/recording/${encodeURIComponent(name)}?k=${sign(name)}`
      emit('call.recording.saved', rl, { recording_urls: { mp3: u }, public_recording_urls: { mp3: u }, duration_secs: e.recording?.duration || 0, channels: 'single' })
      break
    }
  }
}
async function onUp(l) {
  if (l.answered) return
  markAnswered(l)
  if (l.transferOf) {
    const a = legs.get(l.transferOf)
    if (!a || a.ended) return hangupCall(l.id)
    const br = await call('post', '/bridges', { type: 'mixing' })
    if (br) { await call('post', `/bridges/${br.id}/addChannel`, { channel: `${raw(a.id)},${raw(l.id)}` }); emit('call.bridged', a); emit('call.bridged', l) }
  }
}

// DTMF collection: initial timer starts after the prompt ends; digit timer after each key
function armGather(l, ms) { clearTimeout(l.gTimer); l.gTimer = setTimeout(() => endGather(l), ms) }
function onDigit(l, d) {
  const g = l.gather
  if (!g.digits.length && l.playback) { const p = playbacks.get(l.playback); if (p) p.stopped = true; call('delete', `/playbacks/${l.playback}`) }
  if (d === g.terminator) return endGather(l)
  g.digits += d
  if (g.digits.length >= g.max) return endGather(l)
  armGather(l, g.inter)
}
function endGather(l) {
  const g = l.gather; if (!g) return
  l.gather = null; clearTimeout(l.gTimer)
  const d = g.digits
  let status = d.length >= g.min ? 'valid' : 'timeout'
  if (status === 'valid' && g.valid && [...d].some(c => !String(g.valid).includes(c))) status = 'invalid'
  emit('call.gather.ended', l, { digits: d, status })
}

async function start(onEvent_) {
  if (!enabled()) return false
  sink = onEvent_
  const open = () => {
    const auth = `${process.env.ASTERISK_ARI_USER || 'cloudivr'}:${process.env.ASTERISK_ARI_PASSWORD}`
    ws = new WebSocket(`${url().replace(/^http/, 'ws')}/ari/events?app=${encodeURIComponent(app())}&api_key=${encodeURIComponent(auth)}&subscribeAll=false`, { agent })
    ws.on('open', () => { connected = true; log(`connected (app ${app()})`) })
    ws.on('message', (m) => { try { onEvent(JSON.parse(m)) } catch (e) { log('event error', e.message) } })
    ws.on('close', () => { connected = false; setTimeout(open, 5000) })
    ws.on('error', (e) => log('ws', e.message))
  }
  open()
  return true
}

// ── Call control (telnyx-service names) ──
const answerCall = async (id) => (live(id) ? call('post', `/channels/${raw(id)}/answer`) : null)
async function hangupCall(id) { const l = live(id); if (!l) return null; l.hungUpByUs = true; await call('delete', `/channels/${raw(id)}`, { reason: 'normal' }); return null }
async function rejectCall(id, cause) { const l = live(id); if (!l) return null; await call('delete', `/channels/${raw(id)}`, { reason: cause === 'USER_BUSY' ? 'busy' : 'normal' }); return null }
const isCallAlive = async (id) => !!live(id)
async function speakOnCall(id, text, voice, language) { const l = live(id); if (!l) return null; return (await play(l, ttsMedia(text, voice, language), 'speak')) ? { result: 'ok' } : null }
async function playbackStart(id, audioUrl, options = {}) {
  const l = live(id); if (!l) return null
  const left = String(options.loop) === 'infinity' ? Infinity : Math.max(1, Number(options.loop) || 1)
  l.loop = { media: conv(audioUrl), left }
  return (await play(l, l.loop.media, 'loop')) ? { success: true } : null
}
async function playbackStop(id) { const l = live(id); if (!l) return null; l.loop = null; const p = playbacks.get(l.playback); if (p) p.stopped = true; await call('delete', `/playbacks/${l.playback}`); return { result: 'ok' } }
async function gather(id, { text, voice, language, audioUrl, minDigits = 1, maxDigits = 1, timeout = 15000, interDigitTimeout = 5000, validDigits, terminator = '#' }) {
  const l = live(id); if (!l) return null
  l.gather = { digits: '', min: minDigits, max: maxDigits, timeout, inter: interDigitTimeout, valid: validDigits, terminator }
  if (text || audioUrl) await play(l, audioUrl ? conv(audioUrl) : ttsMedia(text, voice, language), 'prompt')
  else armGather(l, timeout)
  return { result: 'ok' }
}
const gatherDTMF = (id, payload, o = {}) => gather(id, { ...o, text: payload, validDigits: o.validDigits || '0123456789*#', timeout: o.timeout || 10000 })
const gatherDTMFWithSpeak = (id, text, voice, o = {}) => gather(id, { ...o, text, voice })
const gatherDTMFWithAudio = (id, audioUrl, o = {}) => gather(id, { ...o, audioUrl })
async function gatherStop(id) { const l = live(id); if (!l) return null; l.gather = null; clearTimeout(l.gTimer); const p = playbacks.get(l.playback); if (p) p.stopped = true; await call('delete', `/playbacks/${l.playback}`); return { result: 'ok' } }
async function startRecording(id, channels, format, { playBeep = false } = {}) {
  const l = live(id); if (!l) return null
  l.recName = `rec-${raw(id)}-${Date.now()}`
  // Record a snoop copy of the call so prompts and menus can keep playing on the call itself (like Telnyx)
  const snoop = await call('post', `/channels/${raw(id)}/snoop`, { spy: 'both', app: app(), appArgs: 'out' })
  if (!snoop) return null
  l.snoop = snoop.id
  return call('post', `/channels/${snoop.id}/record`, { name: l.recName, format: 'wav', beep: !!playBeep, maxSilenceSeconds: 0, ifExists: 'overwrite' })
}
const stopRecording = async (id) => { const l = legs.get(id); return l?.recName ? call('post', `/recordings/live/${l.recName}/stop`) : null }
// when a call ends its snoop copy ends too, which finishes the recording

// Destination → Asterisk endpoint: softphones via Kamailio (it rings the registered phone), numbers via DIDWW
function endpointFor(to) {
  if (/^sip:/i.test(String(to))) return { endpoint: `PJSIP/kamailio/sip:${String(to).replace(/^sip:/i, '').split('@')[0]}@188.166.34.29:5060`, variables: { 'PJSIP_HEADER(add,X-Nomadly-Key)': process.env.SIP_SERVER_SECRET || '', 'PJSIP_HEADER(add,X-Nomadly-User)': String(to).replace(/^sip:/i, '').split('@')[0] } }
  return { endpoint: `PJSIP/${String(to).replace(/[^\d]/g, '')}@${process.env.CALL_ENGINE_TRUNK || 'didww'}`, variables: {} }
}
async function originate(meta, from, to, timeout = 30) {
  const { endpoint, variables } = endpointFor(to)
  const chId = crypto.randomUUID()
  const l = track({ id: `ae:${chId}`, from, to, direction: 'outgoing', ...meta })
  try {
    await M.ari().post(`/channels/${chId}`, { variables }, { params: { endpoint, app: app(), appArgs: 'out', callerId: String(from || '').replace(/^\+/, ''), timeout } })
    return l
  } catch (e) { legs.delete(l.id); throw new Error(e.response?.data?.message || e.message) }
}
async function transferCall(id, toNumber, fromNumber, options = {}) {
  const a = live(id); if (!a) return null
  if (!a.answered) await answerCall(id)
  try {
    const b = await originate({ connection: a.connection, clientState: b64(options.targetLegClientState), session: a.session, transferOf: a.id }, fromNumber || (a.direction === 'incoming' ? a.to : a.from), toNumber, options.timeoutSecs || 30)
    a.peer = b.id
    if (!options.audioUrl) call('post', `/channels/${raw(a.id)}/ring`)
    else play(a, conv(options.audioUrl), 'ringback')
    emit('call.initiated', b)
    return { result: 'ok' }
  } catch (e) { log(`transfer ${id} → ${toNumber}: ${e.message}`); return null }
}
async function bridgeCalls(aId, bId) {
  const br = await call('post', '/bridges', { type: 'mixing' }); if (!br) return null
  await call('post', `/bridges/${br.id}/addChannel`, { channel: `${raw(aId)},${raw(bId)}` })
  emit('call.bridged', legs.get(aId)); emit('call.bridged', legs.get(bId))
  return { success: true }
}
async function createOutboundCall(from, to, webhookUrl, connectionId, options = {}) {
  if (!connected) return { error: 'call engine offline', status: 503, _provider: 'callengine' }
  try {
    const l = await originate({ connection: connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID || 'callengine-app', clientState: options.client_state, amd: !!options.answering_machine_detection }, from, to, options.timeout_secs || 30)
    emit('call.initiated', l)
    return { callControlId: l.id, callLegId: l.id, callSessionId: l.session }
  } catch (e) { return { error: e.message, status: /allocate|not found|no such/i.test(e.message) ? 422 : 503, _provider: 'callengine' } }
}

const M = module.exports = {
  enabled, isAe, connected: () => connected, app, sign, ari: makeAri, _legs: legs, _onEvent: onEvent, _setSink: (fn) => { sink = fn }, _setConnected: (v) => { connected = v },
  start, answerCall, rejectCall, hangupCall, isCallAlive, speakOnCall, playbackStart, playbackStop, gatherDTMF, gatherDTMFWithSpeak, gatherDTMFWithAudio, gatherStop, startRecording, stopRecording, transferCall, bridgeCalls, createOutboundCall,
}
