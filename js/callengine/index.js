'use strict'
// Own call engine (Asterisk ARI on the SIP server) speaking the Telnyx Call Control dialect. Calls get "ae:" ids.
// PSTN goes through the DIDWW trunk; softphones through Kamailio on the same server.
const crypto = require('crypto')
const axios = require('axios')
const https = require('https')
const WebSocket = require('ws')
const FO = require('./failover')

const log = (...a) => console.log('[CallEngine]', ...a)
const agent = new https.Agent({ rejectUnauthorized: false })
const url = () => String(process.env.ASTERISK_ARI_URL || '').replace(/\/+$/, '')
const enabled = () => !!(url() && process.env.ASTERISK_ARI_PASSWORD) && String(process.env.CALL_ENGINE_ENABLED || 'true') !== 'false'
const app = () => process.env.CALL_ENGINE_APP || `${String(process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, '')}${process.env.BOT_ENVIRONMENT === 'production' ? '' : '-dev'}`
// Channels this process creates live in its own ARI app, so their events keep coming here while a deploy's newer slot
// takes over the shared app (inbound calls).
const ownApp = () => `${app()}-${process.env.PORT || process.pid}`
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
let aiHook = null // (token, legId) for SIP legs that carry an inbound call to an AI agent

function emit(type, leg, extra = {}) {
  if (!sink || !leg) return
  if (leg.held) { leg.held.push([type, extra]); return }
  const occurred_at = new Date().toISOString()
  const payload = { call_control_id: leg.id, call_leg_id: leg.id, call_session_id: leg.session, connection_id: leg.connection, from: leg.from, to: leg.to, direction: leg.direction, state: leg.state, client_state: leg.clientState, start_time: leg.startedAt, occurred_at, ...(leg.fromSipUri ? { from_sip_uri: leg.fromSipUri } : {}), _provider: 'callengine', ...extra }
  setImmediate(() => Promise.resolve(sink({ data: { event_type: type, id: crypto.randomUUID(), occurred_at, payload } })).catch(e => log(`${type} handler error: ${e.message}`)))
}
const track = (meta) => { const l = { session: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'parked', ...meta }; legs.set(l.id, l); return l }
const live = (id) => { const l = legs.get(id); return l && !l.ended ? l : null }
const call = async (method, path, params, data) => { try { return (await M.ari().request({ method, url: path, params, data })).data || {} } catch (e) { log(`${method} ${path}: ${e.response?.status || ''} ${e.response?.data?.message || e.message}`); return null } }
// With machine detection the app hears call.answered only once the verdict is in (the leg is busy in dialplan until then).
function markAnswered(l) { if (l.answered) return; l.answered = true; l.answeredAt = Date.now(); l.state = 'answered'; if (l.amd) runAmd(l); else emit('call.answered', l) }
// Answering-machine detection on the call itself: the leg visits dialplan [ce-amd] (Asterisk AMD(), then the end of the
// greeting) and comes back into Stasis with the verdict. Emits the same events Telnyx did:
// call.machine.detection.ended { result: human | machine | not_sure } and, for machines, call.machine.greeting.ended.
async function dialplanTrip(l, extension) {
  l.inDialplan = extension
  clearTimeout(l.amdTimer)
  l.amdTimer = setTimeout(() => { if (l.inDialplan === extension && !l.ended) { l.inDialplan = null; amdResult(l, extension, 'NOTSURE', 'TIMEOUT') } }, 40000)
  const ok = await call('post', `/applications/${l.app || app()}/subscription`, { eventSource: `channel:${raw(l.id)}` }) &&
    await call('post', `/channels/${raw(l.id)}/variable`, { variable: 'CE_APP', value: l.app || app() }) &&
    await call('post', `/channels/${raw(l.id)}/continue`, { context: 'ce-amd', extension, priority: 1 })
  if (!ok) { l.inDialplan = null; clearTimeout(l.amdTimer); amdResult(l, extension, 'NOTSURE', 'ERROR') }
}
const runAmd = (l) => dialplanTrip(l, 'detect')
function amdResult(l, step, status, cause) {
  clearTimeout(l.amdTimer)
  if (l.ended) return
  if (step === 'greeting') return emit('call.machine.greeting.ended', l, { result: 'ended' })
  const result = status === 'MACHINE' ? 'machine' : status === 'HUMAN' ? 'human' : 'not_sure'
  log(`AMD ${l.to}: ${status} (${cause || ''})`)
  emit('call.answered', l)
  emit('call.machine.detection.ended', l, { result })
  if (result === 'machine') setTimeout(() => { if (!l.ended) dialplanTrip(l, 'greeting') }, 400)
}
const CAUSE = { 16: ['normal_clearing', '16'], 17: ['user_busy', '486'], 18: ['timeout', '480'], 19: ['timeout', '480'], 21: ['call_rejected', '603'], 1: ['unallocated_number', '404'], 34: ['normal_temporary_failure', '503'] }
function finish(l, cause) {
  if (!l || l.ended) return
  l.ended = true; l.state = 'hangup'; l.loop = null
  if (cause != null) l.cause = cause
  if (l.pstn && l.direction === 'outgoing') FO.result(l.trunk, { connected: !!(l.answered || l.ringing), cause: l.cause, cancelled: !!l.hungUpByUs })
  if (l.bird && l.answeredAt) { try { require('../bird-spend').call((Date.now() - l.answeredAt) / 1000) } catch (_) {} }
  clearTimeout(l.gTimer)
  if (l.em) stopExternalMedia(l.id)
  const [c, sip] = CAUSE[cause] || (l.answered ? CAUSE[16] : ['originator_cancel', '487'])
  emit('call.hangup', l, { hangup_cause: c, sip_hangup_cause: sip, hangup_source: l.hungUpByUs ? 'callee' : 'caller', end_time: new Date().toISOString() })
  if (l.transferOf) {
    const a = legs.get(l.transferOf)
    if (a && !a.ended && a.peer === l.id && l.answered) hangupCall(a.id)
    // A softphone's dialed number never answered (refused, busy, no answer): end the softphone's leg too, unless a redial is under way.
    else if (!l.answered && a?.fromSipUri) setTimeout(() => { if (!a.ended && !a.dialing && (!a.peer || a.peer === l.id)) hangupCall(a.id) }, 3000)
  }
  // The caller hung up: end the leg we dialed for them too (a carrier leg left up keeps billing).
  const p = l.peer && legs.get(l.peer)
  if (p && !p.ended && p.transferOf === l.id) hangupCall(p.id)
  setTimeout(() => legs.delete(l.id), 10 * 60000)
}

// ── media: everything is converted to 8 kHz wav by the media helper on the SIP server ──
// Asterisk drops media links over ~250 chars, so long links go through a short app link that redirects.
const shortMedia = new Map()
function shortUrl(url) {
  if (url.length < 120 || !self()) return url
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)
  shortMedia.set(id, { url, at: Date.now() })
  for (const [k, v] of shortMedia) if (Date.now() - v.at > 6 * 3600000) shortMedia.delete(k)
  return `${self()}/callengine/m/${id}`
}
const mediaUrl = (id) => shortMedia.get(String(id))?.url || null
const conv = (audioUrl) => `sound:http://127.0.0.1:8090/c.wav?u=${b64u(shortUrl(String(audioUrl)))}`
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
      if (l && e.args?.[0] === 'amd') { const step = l.inDialplan; l.inDialplan = null; if (step) amdResult(l, step, e.args[1], e.args[2]); break }
      if (l) { if (ch.state === 'Up') onUp(l); break }
      if (e.args?.[0] === 'out' || /^UnicastRTP\//.test(ch.name || '')) break
      // SignalWire handing an inbound call to an AI agent: sip:ai.<app>.<token> — no call events, the agent owns the leg.
      if (e.args?.[0] === 'sip' && /^ai\./.test(e.args?.[1] || '')) {
        const t = String(e.args[1]).split('.').slice(2).join('.')
        const al = track({ id, direction: 'incoming', from: ch.caller?.number || null, to: e.args[1], connection: 'callengine-ai', initiatedSent: true, ai: true })
        if (aiHook) aiHook(t, al.id); else hangupCall(al.id)
        break
      }
      const sip = e.args?.[0] === 'sip'
      const exten = e.args?.[1] || ch.dialplan?.exten || ''
      const num = (n) => (n && /^\d{10,15}$/.test(n) ? `+${n}` : n)
      l = track({ id, direction: sip ? 'outgoing' : 'incoming', to: sip ? exten.replace(/[^+\d]/g, '') : num(exten.replace(/^\+/, '')), from: sip ? `sip:${e.args?.[2] || ch.caller?.number}@${process.env.SIP_DOMAIN || 'sip.cloudivr.net'}` : num(String(ch.caller?.number || '').replace(/^\+/, '')), connection: sip ? (process.env.TELNYX_SIP_CONNECTION_ID || 'callengine-sip') : (process.env.TELNYX_CALL_CONTROL_APP_ID || 'callengine-app'), initiatedSent: true, app: e.application || app() })
      if (sip) l.fromSipUri = l.from
      emit('call.initiated', l)
      break
    }
    case 'ChannelStateChange': if (l && ch.state === 'Up') onUp(l); else if (l && /^Ring/.test(ch.state)) l.ringing = true; break
    case 'ChannelHangupRequest': if (l && e.cause) l.cause = e.cause; break
    case 'ChannelDestroyed': if (l) finish(l, e.cause || l.cause); break
    case 'StasisEnd': if (l && !l.inDialplan) setTimeout(() => { if (!l.inDialplan) finish(l, l.cause) }, 300); break
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
    // Stop the ringing / ringback the caller hears before joining them — otherwise it keeps playing over the answered call.
    call('delete', `/channels/${raw(a.id)}/ring`)
    const rb = a.playback && playbacks.get(a.playback)
    if (rb?.kind === 'ringback') { rb.stopped = true; call('delete', `/playbacks/${a.playback}`) }
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
    ws = new WebSocket(`${url().replace(/^http/, 'ws')}/ari/events?app=${encodeURIComponent(`${app()},${ownApp()}`)}&api_key=${encodeURIComponent(auth)}&subscribeAll=false`, { agent })
    ws.on('open', () => { connected = true; log(`connected (app ${app()})`); onConnectHook?.() })
    ws.on('message', (m) => { try { onEvent(JSON.parse(m)) } catch (e) { log('event error', e.message) } })
    ws.on('close', () => { connected = false; setTimeout(open, 5000) })
    ws.on('error', (e) => log('ws', e.message))
  }
  open()
  // A hang-up event can be missed (during a deploy the newest app instance receives the events): any call we still
  // hold that the engine no longer has is ended here, so it can never keep running or billing.
  setInterval(sweep, 30000).unref?.()
  setInterval(() => { if (connected) birdChannels().catch(() => {}) }, 2000).unref?.()
  return true
}
async function sweep() {
  for (const l of [...legs.values()]) {
    if (l.ended || Date.now() - new Date(l.startedAt).getTime() < 60000) continue
    const gone = await M.ari().get(`/channels/${raw(l.id)}`).then(() => false, (e) => e.response?.status === 404)
    if (gone && !l.ended) { log(`sweep: ${l.id} is gone from the engine — ending it`); finish(l, l.cause) }
  }
}

// ── Call control (telnyx-service names) ──
const answerCall = async (id) => (live(id) ? call('post', `/channels/${raw(id)}/answer`) : null)
async function hangupCall(id) { const l = live(id); if (!l) return null; l.hungUpByUs = true; await call('delete', `/channels/${raw(id)}`, { reason: 'normal' }); return null }
async function rejectCall(id, cause) { const l = live(id); if (!l) return null; await call('delete', `/channels/${raw(id)}`, { reason: cause === 'USER_BUSY' ? 'busy' : 'normal' }); return null }
const isCallAlive = async (id) => !!live(id)
// Live audio of a call to/from host:port as RTP (μ-law) → { port } of Asterisk's side, or null.
async function startExternalMedia(id, host) {
  const l = live(id); if (!l || l.em) return null
  const ch = crypto.randomUUID()
  const em = await call('post', '/channels/externalMedia', { channelId: ch, app: ownApp(), external_host: host, format: 'ulaw', encapsulation: 'rtp', transport: 'udp', connection_type: 'client', direction: 'both' })
  if (!em) return null
  const br = await call('post', '/bridges', { type: 'mixing' })
  if (!br || !(await call('post', `/bridges/${br.id}/addChannel`, { channel: `${raw(id)},${ch}` }))) { call('delete', `/channels/${ch}`); if (br) call('delete', `/bridges/${br.id}`); return null }
  l.em = { ch, br: br.id }
  // Where Asterisk listens: its reported address unless that is unroutable from here, then the SIP server's own host.
  const a = String(em.channelvars?.UNICASTRTP_LOCAL_ADDRESS || '')
  const address = !a || /^(0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) ? new URL(url()).hostname : a
  return { port: Number(em.channelvars?.UNICASTRTP_LOCAL_PORT) || null, address }
}
async function stopExternalMedia(id) {
  const l = legs.get(id); const em = l?.em
  if (!em) return
  l.em = null
  await call('delete', `/channels/${em.ch}`)
  await call('delete', `/bridges/${em.br}`)
}
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
  const snoop = await call('post', `/channels/${raw(id)}/snoop`, { spy: 'both', app: ownApp(), appArgs: 'out' })
  if (!snoop) return null
  l.snoop = snoop.id
  return call('post', `/channels/${snoop.id}/record`, { name: l.recName, format: 'wav', beep: !!playBeep, maxSilenceSeconds: 0, ifExists: 'overwrite' })
}
const stopRecording = async (id) => { const l = legs.get(id); return l?.recName ? call('post', `/recordings/live/${l.recName}/stop`) : null }
// when a call ends its snoop copy ends too, which finishes the recording

// Destination → Asterisk endpoint: softphones via Kamailio (it rings the registered phone), numbers via DIDWW
function endpointFor(to, trunk) {
  if (/^sip:/i.test(String(to))) return { endpoint: `PJSIP/kamailio/sip:${String(to).replace(/^sip:/i, '').split('@')[0]}@188.166.34.29:5060`, variables: { 'PJSIP_HEADER(add,X-Nomadly-Key)': process.env.SIP_SERVER_SECRET || '', 'PJSIP_HEADER(add,X-Nomadly-User)': String(to).replace(/^sip:/i, '').split('@')[0] } }
  return { endpoint: `PJSIP/${String(to).replace(/[^\d]/g, '')}@${trunk || process.env.CALL_ENGINE_TRUNK || (process.env.BIRD_API_KEY ? 'bird' : 'didww')}`, variables: {} }
}
// Bird trunk limits (account-wide): BIRD_MAX_CONCURRENT live calls, BIRD_MAX_CPS new calls per second. All four brand
// apps share one Asterisk, so its channel list (PJSIP/bird-…) is the shared count; each app also paces its own starts.
const BIRD_CPS = () => Math.max(1, Number(process.env.BIRD_MAX_CPS || 5))
let ariBird = 0, nextBirdStart = 0
async function birdChannels() {
  const list = ((await M.ari().get('/channels', { timeout: 3000 })).data || []).filter(c => /^PJSIP\/bird-/.test(c.name || ''))
  ariBird = list.length
  return { live: list.length, recent: list.filter(c => Date.now() - Date.parse(c.creationtime) < 1000).length }
}
async function birdSlot() {
  for (let i = 0; i < 100; i++) {
    const t = Math.max(Date.now(), nextBirdStart)
    nextBirdStart = t + Math.ceil(1000 / BIRD_CPS())
    if (t > Date.now()) await new Promise(r => setTimeout(r, t - Date.now()))
    const s = await birdChannels().catch(() => null)
    if (!s || s.recent < BIRD_CPS()) return
    await new Promise(r => setTimeout(r, 150 + Math.random() * 250))
  }
}
async function originate(meta, from, to, timeout = 30, trunk = null) {
  let use = trunk
  const pstn = !/^sip:/i.test(String(to))
  if (pstn && FO.birdOnly()) {
    // Bird-only switch: every PSTN call leaves via Bird; a caller ID meant for another trunk falls back to the line's own number.
    if (trunk && trunk !== FO.BIRD) { if (meta.ownFrom) from = meta.ownFrom; log(`bird-only: ${trunk} → bird (${from} → ${to})`) }
    use = FO.BIRD
  } else if (pstn) {
    const want = trunk || FO.defaultTrunk(), r = FO.route(want)
    use = r.trunk
    // Moving a custom caller ID off MultiTEL: Bird only shows verified numbers, so the line's own number is used.
    if (r.moved) { if (use === FO.BIRD && meta.ownFrom) from = meta.ownFrom; log(`failover: ${want} is down — ${from} → ${to} via ${use}`) }
  }
  const { endpoint, variables } = endpointFor(to, use)
  if (/@bird$/.test(endpoint)) await birdSlot()
  const chId = crypto.randomUUID()
  const l = track({ id: `ae:${chId}`, app: ownApp(), from, to, direction: 'outgoing', bird: /@bird$/.test(endpoint), trunk: endpoint.split('@').pop(), pstn, ...meta })
  try {
    await M.ari().post(`/channels/${chId}`, { variables }, { params: { endpoint, app: ownApp(), appArgs: 'out', callerId: String(from || '').replace(/^\+/, ''), timeout } })
    return l
  } catch (e) { legs.delete(l.id); if (pstn) FO.result(l.trunk, { connected: false, cause: 'originate_error' }); throw new Error(e.response?.data?.message || e.message) }
}
async function transferCall(id, toNumber, fromNumber, options = {}) {
  const a = live(id); if (!a) return null
  a.dialing = (a.dialing || 0) + 1
  if (!a.answered) await answerCall(id)
  try {
    if (!options.audioUrl) call('post', `/channels/${raw(a.id)}/ring`)
    else play(a, conv(options.audioUrl), 'ringback')
    const meta = () => ({ connection: a.connection, clientState: b64(options.targetLegClientState), session: a.session, transferOf: a.id, ownFrom: options.fallbackFrom || null })
    let b = await dialWithBackup(meta(), fromNumber || (a.direction === 'incoming' ? a.to : a.from), toNumber, options.timeoutSecs || 30, undefined, options.trunk)
    // Carrier refused the shown caller ID (e.g. caller's own number not verified) — redial showing our number instead.
    if (refusedEarly(b) && options.fallbackFrom && options.fallbackFrom !== fromNumber) {
      log(`transfer ${id} → ${toNumber}: caller ID ${fromNumber} refused (cause ${b.cause ?? '?'}) — retrying with ${options.fallbackFrom}`)
      legs.delete(b.id)
      b = await dialWithBackup(meta(), options.fallbackFrom, toNumber, options.timeoutSecs || 30)
    }
    a.peer = b.id
    const held = b.held || []; b.held = null
    emit('call.initiated', b)
    for (const [type, extra] of held) emit(type, b, extra)
    return { result: 'ok' }
  } catch (e) { log(`transfer ${id} → ${toNumber}: ${e.message}`); return null }
  finally { a.dialing-- }
}
async function bridgeCalls(aId, bId) {
  const br = await call('post', '/bridges', { type: 'mixing' }); if (!br) return null
  await call('post', `/bridges/${br.id}/addChannel`, { channel: `${raw(aId)},${raw(bId)}` })
  emit('call.bridged', legs.get(aId)); emit('call.bridged', legs.get(bId))
  return { success: true }
}
// Hang-up causes that are the destination's real answer (busy, bad number) — not the carrier refusing us.
const DEST_RESULT = new Set([1, 17, 28])
// If Bird refuses a call before it rings, the same call goes out once through the backup trunk (MultiTEL termination).
const BACKUP_TRUNK = () => FO.MULTITEL()
const refusedEarly = (l) => l.ended && !l.answered && !DEST_RESULT.has(Number(l.cause))
async function early(l, ms) {
  const until = Date.now() + Number(ms ?? process.env.CALL_ENGINE_EARLY_MS ?? 6000)
  while (!l.ended && !l.ringing && !l.answered && Date.now() < until) await new Promise(r => setTimeout(r, 100))
}
async function dialWithBackup(meta, from, to, timeout, earlyMs, trunk = null) {
  let l = await originate({ ...meta, held: [] }, from, to, timeout, trunk)
  await early(l, earlyMs)
  if (trunk) return l // a chosen trunk (caller-ID passthrough) has its own fallback in the caller
  if (refusedEarly(l) && l.bird && BACKUP_TRUNK() && !/^sip:/i.test(String(to))) {
    log(`Bird refused ${from} → ${to} (cause ${l.cause ?? '?'}) — retrying via ${BACKUP_TRUNK()}`)
    const b = await originate({ ...meta, held: [], backupOf: l.id }, from, to, timeout, BACKUP_TRUNK()).catch(e => { log(`backup trunk: ${e.message}`); return null })
    if (b) { legs.delete(l.id); l = b; await early(l, earlyMs) }
  }
  return l
}
const activeBird = () => Math.max(ariBird, [...legs.values()].filter(l => l.bird && !l.ended).length)
// Holds the call's events for a few seconds: if the trunk refuses it before it rings, the caller can retry elsewhere.
async function createOutboundCall(from, to, webhookUrl, connectionId, options = {}) {
  if (!connected) return { error: 'call engine offline', status: 503, _provider: 'callengine' }
  let l
  try {
    l = await dialWithBackup({ connection: connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID || 'callengine-app', clientState: options.client_state, amd: !!options.answering_machine_detection, ownFrom: options.ownFrom || null }, from, to, options.timeout_secs || 30, options.earlyMs, options.trunk)
  } catch (e) { return { error: e.message, status: /allocate|not found|no such/i.test(e.message) ? 422 : 503, _provider: 'callengine' } }
  const held = l.held; l.held = null
  if (l.ended && !l.answered && !DEST_RESULT.has(Number(l.cause))) {
    log(`${l.bird ? 'Bird' : l.trunk || 'trunk'} refused ${from} → ${to} before ringing (cause ${l.cause ?? '?'})`)
    return { error: `trunk refused the call (cause ${l.cause ?? 'unknown'})`, status: 503, refused: true, _provider: 'callengine' }
  }
  emit('call.initiated', l)
  for (const [type, extra] of held) emit(type, l, extra)
  return { callControlId: l.id, callLegId: l.id, callSessionId: l.session }
}

// Inbound PSTN calls (Telnyx/Bird trunks) reach the brand that owns the number: global DIDAPP_<digits> = this ARI app.
let onConnectHook = null
async function setDidApps(numbers) {
  if (!enabled()) return 0
  let n = 0
  for (const p of numbers) if (await call('post', '/asterisk/variable', { variable: `DIDAPP_${String(p).replace(/\D/g, '')}`, value: app() })) n++
  return n
}

const M = module.exports = {
  enabled, isAe, connected: () => connected, app, sign, ari: makeAri, _legs: legs, _onEvent: onEvent, _setSink: (fn) => { sink = fn }, _setConnected: (v) => { connected = v },
  setDidApps, onConnect: (fn) => { onConnectHook = fn }, failover: FO, originate,
  mediaUrl, activeBird, start, _sweep: sweep, startExternalMedia, stopExternalMedia, setAiHook: (fn) => { aiHook = fn }, answerCall, rejectCall, hangupCall, isCallAlive, speakOnCall, playbackStart, playbackStop, gatherDTMF, gatherDTMFWithSpeak, gatherDTMFWithAudio, gatherStop, startRecording, stopRecording, transferCall, bridgeCalls, createOutboundCall,
}
