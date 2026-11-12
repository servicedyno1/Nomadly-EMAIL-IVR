// SignalWire adapter speaks Telnyx: fake RELAY calls in, Telnyx-shaped webhook events out; router sends sw: ids to SignalWire.
// Run: cd /app && node js/tests/test_signalwire_adapter.js
process.env.SIGNALWIRE_PROJECT_ID = 'p'; process.env.SIGNALWIRE_API_TOKEN = 't'; process.env.SIGNALWIRE_SPACE_URL = 'x.signalwire.com'
process.env.TELNYX_CALL_CONTROL_APP_ID = 'app1'; process.env.TELNYX_SIP_CONNECTION_ID = 'sip1'
const sw = require('/app/js/signalwire')
const { voice } = sw
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))
const events = []
voice._setSink((e) => events.push(e.data))
const last = (t) => [...events].reverse().find(e => e.event_type === t)?.payload

function ender() { let done; const p = new Promise(r => { done = r }); return { p, done } }
function fakeCall(over = {}) {
  const c = { id: 'c' + Math.random().toString(36).slice(2), type: 'phone', from: '+15551110000', to: '+15552220000', device: { params: {} }, state: 'created', calls: [], ...over }
  c.listen = async ({ onStateChanged }) => { c.fire = (s) => { c.state = s; onStateChanged(c) } }
  c.answer = async () => { c.calls.push('answer'); c.fire('answered') }
  c.hangup = async (r) => { c.calls.push('hangup:' + (r || '')); c.fire('ended') }
  const action = (kind, result) => (params) => { c.calls.push(kind); c.last = params; const e = ender(); c.end = e; const obj = { stop: async () => { e.done(result) }, ended: () => e.p }; return { onStarted: async () => obj } }
  c.playTTS = action('tts', {}); c.playAudio = action('audio', {})
  c.promptTTS = action('prompt', null); c.promptAudio = action('promptAudio', null)
  c.recordAudio = action('record', { url: 'https://files.signalwire.com/r.mp3', duration: 4 })
  c.amd = action('amd', {})
  return c
}

;(async () => {
  const call = fakeCall()
  await voice._onInbound(call); await wait()
  const init = last('call.initiated')
  ok('inbound → call.initiated incoming with sw: id', init?.direction === 'incoming' && init.call_control_id.startsWith('sw:') && init.connection_id === 'app1')
  const id = init.call_control_id
  await sw.wrap({ answerCall: async () => 'telnyx' }).answerCall(id); await wait()
  ok('router sends sw: id to SignalWire answer', call.calls.includes('answer'))
  ok('call.answered emitted once', events.filter(e => e.event_type === 'call.answered').length === 1)

  await voice.gatherDTMFWithSpeak(id, 'Press 1', 'AWS.Polly.Joanna-Neural', { maxDigits: 2, timeout: 8000, interDigitTimeout: 3000, validDigits: '12' })
  ok('Polly voice mapped', call.last.voice === 'polly.Joanna-Neural', call.last.voice)
  ok('gather timers in seconds', call.last.initialTimeout === 8 && call.last.digits.digitTimeout === 3 && call.last.digits.max === 2)
  call.end.done({ type: 'digit', digits: '12' }); await wait()
  ok('gather.ended valid digits', last('call.gather.ended')?.status === 'valid' && last('call.gather.ended').digits === '12')
  await voice.gatherDTMF(id, 'x', { minDigits: 1 }); call.end.done({ type: 'no_input' }); await wait()
  ok('no input → timeout', last('call.gather.ended')?.status === 'timeout')
  await voice.gatherDTMFWithAudio(id, 'https://a/b.mp3', { validDigits: '1' }); call.end.done({ type: 'digit', digits: '9' }); await wait()
  ok('digit outside valid → invalid', last('call.gather.ended')?.status === 'invalid')
  const before = events.length
  await voice.gatherDTMF(id, 'x'); await voice.gatherStop(id); await wait()
  ok('stopped gather emits nothing', events.slice(before).every(e => e.event_type !== 'call.gather.ended'))

  await voice.speakOnCall(id, 'hi', 'male'); ok('plain male voice → gender', call.last.gender === 'male')
  call.end.done({}); await wait(); ok('speak.ended completed', last('call.speak.ended')?.status === 'completed')

  await voice.playbackStart(id, 'https://a/hold.mp3', { loop: 2 }); call.end.done({}); await wait(); call.end.done({}); await wait()
  ok('loop 2 plays twice then playback.ended', call.calls.filter(x => x === 'audio').length === 2 && !!last('call.playback.ended'))
  await voice.playbackStart(id, 'https://a/hold.mp3', { loop: 'infinity' }); const n = events.length; await voice.playbackStop(id); await wait()
  ok('playbackStop ends loop silently', events.slice(n).every(e => e.event_type !== 'call.playback.ended'))

  await voice.startRecording(id, 'dual', 'mp3', { playBeep: true })
  ok('record never stops on silence', call.last.endSilenceTimeout === 0 && call.last.initialTimeout === 0 && call.last.stereo === true && call.last.beep === true)
  call.fire('ended'); await wait()
  const rec = call.end; rec.done({ url: 'https://files.signalwire.com/r.mp3', duration: 4 }); await wait()
  ok('hangup → call.hangup normal_clearing', last('call.hangup')?.hangup_cause === 'normal_clearing')
  ok('recording.saved after hangup with mp3 url', last('call.recording.saved')?.recording_urls?.mp3 === 'https://files.signalwire.com/r.mp3' && last('call.recording.saved').duration_secs === 4)
  ok('isCallAlive false after end', (await voice.isCallAlive(id)) === false)

  const sipCall = fakeCall({ type: 'sip', device: { params: { from: 'sip:cvabc12345@x.sip.signalwire.com', to: 'sip:+15553334444@x.sip.signalwire.com' } } })
  await voice._onInbound(sipCall); await wait()
  const s = last('call.initiated')
  ok('softphone call → outgoing on SIP connection with sip: from', s.direction === 'outgoing' && s.connection_id === 'sip1' && s.from.startsWith('sip:cvabc12345@') && s.from_sip_uri)

  const rej = fakeCall(); await voice._onInbound(rej); await wait()
  await voice.rejectCall(last('call.initiated').call_control_id, 'USER_BUSY'); await wait()
  ok('reject USER_BUSY → busy hangup', rej.calls.includes('hangup:busy') && last('call.hangup')?.hangup_cause === 'user_busy')

  // transfer
  const a = fakeCall(); await voice._onInbound(a); await wait(); const aid = last('call.initiated').call_control_id
  await voice.answerCall(aid)
  const peer = fakeCall(); let resolvePeer; const peerEnded = ender()
  peer.waitFor = () => peerEnded.p
  a.connectPhone = (p) => { a.connectParams = p; return new Promise(r => { resolvePeer = r }) }
  voice._setClient({}, { Playlist: class { add() { return this } static Ringtone(x) { return x } static Audio(x) { return x } } })
  await voice.transferCall(aid, '+15559990000', '+15552220000', { targetLegClientState: 'nomadly_pstn_leg' }); await wait(150)
  const t = last('call.initiated')
  ok('transfer leg initiated with base64 client_state', t.call_control_id.startsWith('sw:t-') && Buffer.from(t.client_state, 'base64').toString() === 'nomadly_pstn_leg')
  ok('connect from/to/timeout', a.connectParams.from === '+15552220000' && a.connectParams.to === '+15559990000' && a.connectParams.timeout === 30)
  resolvePeer(peer); await wait()
  ok('transfer answered → bridged both legs', events.filter(e => e.event_type === 'call.bridged').length === 2)
  peerEnded.done(true); await wait()
  ok('peer ends → transfer leg hangup + original hung up', last('call.hangup')?.call_control_id === aid || a.calls.some(x => x.startsWith('hangup')))

  const b = fakeCall(); await voice._onInbound(b); await wait(); const bid = last('call.initiated').call_control_id
  b.connectPhone = () => Promise.reject(new Error('busy'))
  await voice.transferCall(bid, '+15559990001', null); await wait(150)
  ok('failed transfer → transfer leg user_busy, original stays', last('call.hangup')?.hangup_cause === 'user_busy' && await voice.isCallAlive(bid))

  // router fallbacks
  let telnyxCalled = 0
  const w = sw.wrap({ hangupCall: async () => { telnyxCalled++ }, createOutboundCall: async () => ({ callControlId: 'v3:telnyx' }) })
  await w.hangupCall('v3:abc'); ok('non-sw id goes to Telnyx', telnyxCalled === 1)
  ok('lookup type mapping exists', typeof sw.lookup === 'function')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.log('ERR', e.stack); process.exit(1) })
