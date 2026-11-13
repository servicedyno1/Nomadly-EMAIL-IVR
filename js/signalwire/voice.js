'use strict'
// SignalWire RELAY voice adapter: speaks the Telnyx Call Control dialect. Calls get "sw:" ids and every
// SignalWire happening is replayed as the matching Telnyx webhook event, so voice-service runs unchanged.
const crypto = require('crypto')
const rest = require('./rest')

const log = (...a) => console.log('[SignalWire]', ...a)
const legs = new Map()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const newId = (p = '') => `sw:${p}${crypto.randomUUID()}`
const b64 = (s) => (s ? Buffer.from(String(s)).toString('base64') : undefined)
const isSw = (id) => String(id || '').startsWith('sw:')
let client = null
let sink = null
let Voice = null

const CAUSE = {
  hangup: ['normal_clearing', '16'], cancel: ['originator_cancel', '487'], busy: ['user_busy', '486'],
  noAnswer: ['timeout', '480'], decline: ['call_rejected', '603'], error: ['unspecified', '500'],
}
const REJECT = { USER_BUSY: 'busy', CALL_REJECTED: 'decline' }

function emit(type, leg, extra = {}) {
  if (!sink || !leg) return
  const occurred_at = new Date().toISOString()
  const payload = {
    call_control_id: leg.id, call_leg_id: leg.id, call_session_id: leg.session, connection_id: leg.connection,
    from: leg.from, to: leg.to, direction: leg.direction, state: leg.state, client_state: leg.clientState,
    start_time: leg.startedAt, occurred_at, ...(leg.fromSipUri ? { from_sip_uri: leg.fromSipUri } : {}), _provider: 'signalwire', ...extra,
  }
  setImmediate(() => Promise.resolve(sink({ data: { event_type: type, id: crypto.randomUUID(), occurred_at, payload } })).catch(e => log(`${type} handler error: ${e.message}`)))
}

function track(meta) {
  const leg = { id: meta.id || newId(), session: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'parked', ...meta }
  legs.set(leg.id, leg)
  return leg
}

function markAnswered(leg, quiet = false) {
  if (leg.answered) return
  leg.answered = true
  leg.state = 'answered'
  if (!quiet) emit('call.answered', leg)
}

function finish(leg, reason = 'hangup') {
  if (!leg || leg.ended) return
  leg.ended = true
  leg.state = 'hangup'
  leg.loop = null
  const [cause, sip] = CAUSE[reason] || CAUSE.hangup
  if (!leg.quietEnd) emit('call.hangup', leg, { hangup_cause: cause, sip_hangup_cause: sip, hangup_source: leg.hungUpByUs ? 'callee' : 'caller', end_time: new Date().toISOString() })
  // Telnyx transfer semantics: when the transferred-to leg ends, the original leg ends too.
  if (leg.transferOf) { const a = legs.get(leg.transferOf); if (a && !a.ended && a.peer === leg.id) hangupCall(a.id) }
  setTimeout(() => legs.delete(leg.id), 10 * 60000)
}

function onState(leg, call) {
  if (!leg.call) leg.call = call
  if (leg.cancel && call.state !== 'ended') { leg.cancel = false; call.hangup().catch(() => {}) }
  if ((call.state === 'created' || call.state === 'ringing') && !leg.initiatedSent) { leg.initiatedSent = true; emit('call.initiated', leg) }
  if (call.state === 'answered') markAnswered(leg, leg.quietAnswer)
  if (call.state === 'ended') finish(leg, leg.endReason || (leg.answered ? 'hangup' : 'cancel'))
}

const live = (id) => { const l = legs.get(id); return l && !l.ended && l.call ? l : null }
const errText = (e) => {
  const md = e?.message_data?.[0]?.errors
  if (md && typeof md === 'object') return Object.values(md).flat().join('; ')
  return String(e?.message || e?.error?.message || (typeof e === 'object' ? JSON.stringify(e) : e))
}

function tts(voice, language) {
  const v = String(voice || '')
  const lang = language || 'en-US'
  const polly = v.match(/polly\.([a-z]+)(-neural)?/i)
  if (polly) return { voice: `polly.${polly[1][0].toUpperCase()}${polly[1].slice(1).toLowerCase()}${polly[2] ? '-Neural' : ''}`, language: lang }
  const vendor = v.match(/^(azure|gcloud|elevenlabs)\.(.+)$/i)
  if (vendor) return { voice: `${vendor[1].toLowerCase()}.${vendor[2]}`, language: lang }
  return { gender: /^male$/i.test(v) ? 'male' : 'female', language: lang }
}

async function sipFrom(number) {
  const d = await rest.sipDomain()
  return `sip:${String(number || '').replace(/^sip:/, '').split('@')[0]}@${d}`
}
// Telnyx-style sip:user@sip.telnyx.com → SignalWire endpoint, or our own SIP server (brand addresses). SignalWire can't dial
// outside SIP addresses, so the SIP server registers as SignalWire endpoint SIP_BRIDGE_USER and we tell it which softphone to ring.
async function sipTarget(uri) {
  const user = String(uri).replace(/^sip:/i, '').split('@')[0]
  if (rest.isSipUser(user) || !process.env.SIP_SERVER_SECRET) return { to: rest.isSipUser(user) ? `sip:${user}@${await rest.sipDomain()}` : String(uri) }
  return {
    to: `sip:${process.env.SIP_BRIDGE_USER || 'sipbridge'}@${await rest.sipDomain()}`,
    headers: [{ name: 'X-Nomadly-Key', value: process.env.SIP_SERVER_SECRET }, { name: 'X-Nomadly-User', value: user }, ...(process.env.SIP_DOMAIN ? [{ name: 'X-Nomadly-Domain', value: process.env.SIP_DOMAIN }] : [])],
  }
}

async function start(onEvent) {
  if (!rest.enabled()) return false
  sink = onEvent
  if (client) return true
  log(`RELAY connecting (topic ${rest.topic()})`)
  try {
    const { SignalWire, Voice: V } = require('@signalwire/realtime-api')
    Voice = V
    client = await SignalWire({ project: process.env.SIGNALWIRE_PROJECT_ID, token: process.env.SIGNALWIRE_API_TOKEN })
    await client.voice.listen({ topics: [rest.topic()], onCallReceived: (call) => onInbound(call).catch(e => log(`inbound error: ${e.message}`)) })
    await Promise.all([rest.loadSipUsers(), rest.refreshOwned(true), rest.sipDomain()])
    log(`RELAY listening on topic "${rest.topic()}"`)
    return true
  } catch (e) {
    log(`RELAY initial connect failed: ${e.message} — scheduling retry in 30s`)
    client = null
    // Auto-retry: attempt reconnection every 30 seconds (up to 10 retries)
    let retries = 0
    const retryInterval = setInterval(async () => {
      if (client || retries >= 10) { clearInterval(retryInterval); return }
      retries++
      try {
        const { SignalWire, Voice: V } = require('@signalwire/realtime-api')
        Voice = V
        client = await SignalWire({ project: process.env.SIGNALWIRE_PROJECT_ID, token: process.env.SIGNALWIRE_API_TOKEN })
        await client.voice.listen({ topics: [rest.topic()], onCallReceived: (call) => onInbound(call).catch(e2 => log(`inbound error: ${e2.message}`)) })
        await Promise.all([rest.loadSipUsers(), rest.refreshOwned(true), rest.sipDomain()])
        log(`RELAY connected on retry #${retries}`)
        clearInterval(retryInterval)
      } catch (e2) { log(`RELAY retry #${retries} failed: ${e2.message}`) }
    }, 30000)
    return false
  }
}

async function onInbound(call) {
  const isSip = call.type === 'sip'
  const dev = call.device?.params || {}
  const from = String(dev.from_number || dev.from || call.from || '')
  const to = String(dev.to_number || dev.to || call.to || '')
  const leg = track({
    call, from, to,
    // A softphone placing a call looks like Telnyx's outbound SIP leg; a phone calling a number is "incoming".
    direction: isSip ? 'outgoing' : 'incoming',
    connection: isSip ? (process.env.TELNYX_SIP_CONNECTION_ID || 'signalwire-sip') : (process.env.TELNYX_CALL_CONTROL_APP_ID || 'signalwire-app'),
    fromSipUri: isSip ? from : undefined, initiatedSent: true,
  })
  call.listen({ onStateChanged: (c) => onState(leg, c) }).catch(() => {})
  emit('call.initiated', leg)
}

// ── Call control (same names / returns as telnyx-service) ──
async function answerCall(id) {
  const leg = live(id); if (!leg) return null
  if (leg.answered) return { result: 'ok' }
  try { await leg.call.answer(); markAnswered(leg); return { result: 'ok' } } catch (e) { log(`answer ${id}: ${errText(e)}`); return null }
}

async function rejectCall(id, cause = 'CALL_REJECTED') {
  const leg = live(id); if (!leg) return null
  leg.endReason = REJECT[cause] || 'decline'
  try { await leg.call.hangup(leg.endReason) } catch (e) { log(`reject ${id}: ${errText(e)}`) }
  return null
}

async function hangupCall(id) {
  const leg = legs.get(id)
  if (!leg || leg.ended) return null
  leg.hungUpByUs = true
  if (!leg.call) { leg.cancel = true; return null }
  try { await leg.call.hangup() } catch (e) { if (!/not found|ended/i.test(errText(e))) log(`hangup ${id}: ${errText(e)}`) }
  return null
}

async function isCallAlive(id) { const leg = legs.get(id); return !!(leg && !leg.ended) }

async function speakOnCall(id, text, voice = 'female', language = 'en-US') {
  const leg = live(id); if (!leg) return null
  try {
    const pb = await leg.call.playTTS({ text: String(text || ''), ...tts(voice, language) }).onStarted()
    leg.play = pb
    emit('call.speak.started', leg)
    pb.ended().then(() => { if (leg.play === pb) leg.play = null; if (!pb._stopped && !leg.ended) emit('call.speak.ended', leg, { status: 'completed' }) }).catch(() => {})
    return { result: 'ok' }
  } catch (e) { log(`speak ${id}: ${errText(e)}`); return null }
}

async function playbackStart(id, audioUrl, options = {}) {
  const leg = live(id); if (!leg) return null
  const loops = String(options.loop) === 'infinity' ? Infinity : Math.max(1, Number(options.loop) || 1)
  const token = {}
  leg.loop = token
  const play = async () => { const pb = await leg.call.playAudio({ url: audioUrl }).onStarted(); leg.play = pb; return pb }
  const done = async (pb) => { await pb.ended(); if (leg.play === pb) leg.play = null; return !pb._stopped && !leg.ended && leg.loop === token }
  try {
    const first = await play()
    emit('call.playback.started', leg, { media_url: audioUrl })
    let left = loops
    const more = async () => {
      let keep = await done(first)
      while (keep && --left > 0) keep = await done(await play())
      if (keep) emit('call.playback.ended', leg, { status: 'completed', media_url: audioUrl })
    }
    more().catch(() => {})
    return { success: true }
  } catch (e) { log(`playback ${id}: ${errText(e)}`); return null }
}

async function playbackStop(id) {
  const leg = live(id); if (!leg) return null
  leg.loop = null
  if (leg.play) { leg.play._stopped = true; await leg.play.stop().catch(() => {}) }
  return { result: 'ok' }
}

async function gather(id, { text, voice, language, audioUrl, minDigits = 1, maxDigits = 1, timeout = 15000, interDigitTimeout = 5000, validDigits, terminator = '#' }) {
  const leg = live(id); if (!leg) return null
  const params = { digits: { max: maxDigits, digitTimeout: interDigitTimeout / 1000, terminators: terminator }, initialTimeout: timeout / 1000 }
  try {
    const pr = await (audioUrl ? leg.call.promptAudio({ url: audioUrl, ...params }) : leg.call.promptTTS({ text: String(text || ''), ...tts(voice, language), ...params })).onStarted()
    leg.prompt = pr
    pr.ended().then((r) => {
      if (leg.prompt === pr) leg.prompt = null
      if (pr._stopped || leg.ended) return
      const digits = String(r?.digits || '')
      let status = r?.type === 'digit' ? 'valid' : r?.type === 'no_input' ? 'timeout' : 'invalid'
      if (status === 'valid' && digits.length < minDigits) status = 'timeout'
      if (status === 'valid' && validDigits && [...digits].some(c => !String(validDigits).includes(c))) status = 'invalid'
      emit('call.gather.ended', leg, { digits, status })
    }).catch(() => {})
    return { result: 'ok' }
  } catch (e) { log(`gather ${id}: ${errText(e)}`); return null }
}
const gatherDTMF = (id, payload, o = {}) => gather(id, { ...o, text: payload, validDigits: o.validDigits || '0123456789*#', timeout: o.timeout || 10000 })
const gatherDTMFWithSpeak = (id, text, voice, o = {}) => gather(id, { ...o, text, voice })
const gatherDTMFWithAudio = (id, audioUrl, o = {}) => gather(id, { ...o, audioUrl })

async function gatherStop(id) {
  const leg = live(id); if (!leg) return null
  if (leg.prompt) { leg.prompt._stopped = true; await leg.prompt.stop().catch(() => {}) }
  return { result: 'ok' }
}

async function startRecording(id, channels = 'single', format = 'mp3', { playBeep = false } = {}) {
  const leg = live(id); if (!leg) return null
  try {
    const startedAt = new Date().toISOString()
    const rec = await leg.call.recordAudio({ direction: 'both', stereo: channels === 'dual', format: format === 'wav' ? 'wav' : 'mp3', beep: !!playBeep, initialTimeout: 0, endSilenceTimeout: 0, terminators: '' }).onStarted()
    leg.rec = rec
    const t0 = Date.now()
    rec.ended().then((r) => {
      if (leg.rec === rec) leg.rec = null
      const url = r?.url || rec.url
      if (!url) return
      emit('call.recording.saved', leg, { recording_urls: { mp3: url }, public_recording_urls: { mp3: url }, duration_secs: Math.round(r?.duration || (Date.now() - t0) / 1000), channels, recording_started_at: startedAt, recording_ended_at: new Date().toISOString() })
    }).catch(e => log(`recording ${id}: ${errText(e)}`))
    return { result: 'ok' }
  } catch (e) { log(`record ${id}: ${errText(e)}`); return null }
}

async function stopRecording(id) {
  const leg = legs.get(id)
  if (leg?.rec) await leg.rec.stop().catch(() => {})
  return { result: 'ok' }
}

function ringback(audioUrl) {
  return audioUrl ? new Voice.Playlist().add(Voice.Playlist.Audio({ url: audioUrl })) : new Voice.Playlist().add(Voice.Playlist.Ringtone({ name: 'us' }))
}

async function transferCall(id, toNumber, fromNumber, options = {}) {
  const a = live(id); if (!a) return null
  const from = fromNumber || (a.direction === 'incoming' ? a.to : a.from)
  const isSip = /^sip:/i.test(String(toNumber))
  const b = track({ id: newId('t-'), direction: 'outgoing', from, to: toNumber, connection: a.connection, clientState: b64(options.targetLegClientState), session: a.session, transferOf: a.id })
  const timeout = options.timeoutSecs || 30
  const params = isSip
    ? { from: await sipFrom(String(from).replace(/[^+\d]/g, '') || from), ...(await sipTarget(toNumber)), timeout, ringback: ringback(options.audioUrl) }
    : { from, to: toNumber, timeout, ringback: ringback(options.audioUrl) }
  log(`Transferring ${id} → ${toNumber} from ${from}`)
  a.peer = b.id
  setTimeout(() => { if (!b.initiatedSent) { b.initiatedSent = true; emit('call.initiated', b) } }, 100)
  const connect = () => (isSip ? a.call.connectSip(params) : a.call.connectPhone(params))
  ;(async () => {
    let peer
    try { peer = await connect() } catch (e) {
      if (!a.answered && /answer/i.test(errText(e))) { await a.call.answer(); markAnswered(a, true); peer = await connect() } else throw e
    }
    b.call = peer
    markAnswered(b)
    emit('call.bridged', a)
    emit('call.bridged', b)
    peer.waitFor('ended').then(() => finish(b, 'hangup')).catch(() => finish(b, 'hangup'))
  })().catch((e) => {
    const t = errText(e)
    log(`transfer ${id} → ${toNumber} not connected: ${t}`)
    if (a.peer === b.id) a.peer = null
    finish(b, /busy/i.test(t) ? 'busy' : /decline|reject/i.test(t) ? 'decline' : /no.?answer|timeout/i.test(t) ? 'noAnswer' : 'error')
  })
  return { result: 'ok' }
}

// RELAY cannot join two live calls, so both legs move into a private conference that ends when either leaves.
async function bridgeCalls(aId, bId) {
  const a = live(aId); const b = live(bId)
  if (!a || !b) return null
  const room = `bridge-${crypto.randomBytes(6).toString('hex')}`
  const dest = { version: '1.0.0', sections: { main: [{ join_conference: { name: room, beep: 'false', end_conference_on_exit: true, start_conference_on_enter: true } }] } }
  try {
    for (const leg of [a, b]) await rest.http().post('/api/calling/calls', { command: 'calling.transfer', id: leg.call.id, params: { dest } })
    emit('call.bridged', a); emit('call.bridged', b)
    return { success: true }
  } catch (e) {
    log(`bridge ${aId} ↔ ${bId} via room failed (${rest.errOf(e)}) — reconnecting ${b.to} on the original call`)
    b.quietEnd = true
    await hangupCall(bId)
    return transferCall(aId, b.to, b.from)
  }
}

function reasonOfDialError(e) {
  const t = errText(e)
  return /busy/i.test(t) ? 'busy' : /decline|reject/i.test(t) ? 'decline' : /no.?answer|timeout/i.test(t) ? 'noAnswer' : 'error'
}

async function runAmd(leg, mode) {
  const waitForBeep = /message_end|greeting_end|beep/.test(String(mode))
  let decided = false
  try {
    await leg.call.amd({
      timeout: 30, waitForBeep,
      listen: {
        onUpdated: (d) => {
          const r = d.result
          if (!decided && ['MACHINE', 'HUMAN', 'UNKNOWN'].includes(r)) {
            decided = true
            emit('call.machine.detection.ended', leg, { result: r === 'HUMAN' ? 'human' : r === 'MACHINE' ? 'machine' : 'not_sure' })
          }
          if (r === 'READY' && waitForBeep && !leg.greetingSent) { leg.greetingSent = true; emit('call.machine.greeting.ended', leg, { result: 'beep_detected' }) }
        },
      },
    }).onStarted()
  } catch (e) { log(`amd ${leg.id}: ${errText(e)}`) }
}

// → { callControlId, callLegId, callSessionId } | { error, code, status }
async function createOutboundCall(from, to, webhookUrl, connectionId, options = {}) {
  if (!client) return { error: 'SignalWire voice is not connected', code: 'sw_offline', status: 503 }
  const isSip = /^sip:/i.test(String(to))
  const leg = track({ id: newId('o-'), direction: 'outgoing', from, to, connection: connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID || 'signalwire-app', clientState: options.client_state, outbound: true })
  const listen = { onStateChanged: (c) => onState(leg, c) }
  const amd = options.answering_machine_detection === false ? null : (options.answering_machine_detection || 'detect')
  const dial = isSip
    ? client.voice.dialSip({ from: await sipFrom(String(from).replace(/[^+\d]/g, '') || from), ...(await sipTarget(to)), timeout: 30, listen })
    : client.voice.dialPhone({ from, to, timeout: options.timeout_secs || 30, listen })
  const early = await Promise.race([dial.then(() => null, (e) => e), sleep(1500).then(() => 'pending')])
  if (early && early !== 'pending' && !leg.call) {
    legs.delete(leg.id)
    const t = errText(early)
    log(`dial ${from} → ${to} refused: ${t}`)
    return { error: t, code: early?.code || null, status: /rate limit|limit|too many/i.test(t) ? 429 : 422, _provider: 'signalwire' }
  }
  dial.then((call) => {
    if (!leg.call) leg.call = call
    markAnswered(leg)
    if (amd && !isSip) runAmd(leg, amd)
  }).catch((e) => { leg.endReason = reasonOfDialError(e); finish(leg, leg.endReason) })
  log(`Outbound call ${leg.id} from=${from} to=${to}`)
  return { callControlId: leg.id, callLegId: leg.id, callSessionId: leg.session }
}

module.exports = {
  start, isSw, connected: () => !!client, _legs: legs, _setSink: (fn) => { sink = fn }, _onInbound: onInbound, _setClient: (c, V) => { client = c; Voice = V },
  answerCall, rejectCall, hangupCall, isCallAlive, speakOnCall, playbackStart, playbackStop,
  gatherDTMF, gatherDTMFWithSpeak, gatherDTMFWithAudio, gatherStop, startRecording, stopRecording,
  transferCall, bridgeCalls, createOutboundCall,
}
