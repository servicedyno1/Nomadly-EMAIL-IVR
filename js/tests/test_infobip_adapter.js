// Infobip adapter: webhook events → Telnyx events; router sends ib: ids to Infobip; dial order by country.
// Run: cd /app && node js/tests/test_infobip_adapter.js
process.env.INFOBIP_API_KEY = 'k'; process.env.SIGNALWIRE_PROJECT_ID = ''; process.env.TELNYX_CALL_CONTROL_APP_ID = 'app1'
const ib = require('/app/js/infobip')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms))
const events = []; ib.voice.setSink((e) => events.push(e.data))
const last = (t) => [...events].reverse().find(e => e.event_type === t)?.payload
const posts = []
ib.http = () => ({ post: async (p, b) => { posts.push([p, b]); if (p === '/calls/1/calls') return { data: { id: 'out1', state: 'CALLING' } }; if (p.endsWith('/connect')) return { data: { callId: 'b1' } }; return { data: {} } }, get: async () => ({ data: {} }) })
const ev = (type, callId, properties = {}) => ib.voice.ingest({ type, callId, properties })

;(async () => {
  await ev('CALL_RECEIVED', 'c1', { callLog: { from: '33612345678', to: '33939370060' } }); await wait()
  const i = last('call.initiated')
  ok('CALL_RECEIVED → incoming call.initiated, ib: id, E.164', i?.call_control_id === 'ib:c1' && i.from === '+33612345678' && i.direction === 'incoming' && i.connection_id === 'app1')
  await ev('CALL_ESTABLISHED', 'c1'); await wait(); ok('ESTABLISHED → call.answered', last('call.answered')?.call_control_id === 'ib:c1')
  await ib.voice.gatherDTMFWithSpeak('ib:c1', 'Press 1', 'male', { maxDigits: 2, timeout: 8000, interDigitTimeout: 3000, validDigits: '12' })
  const g = posts.at(-1)
  ok('gather → capture/dtmf with spoken prompt, seconds', g[0] === '/calls/1/calls/c1/capture/dtmf' && g[1].timeout === 8 && g[1].digitTimeout === 3 && g[1].maxLength === 2 && g[1].playContent.type === 'TEXT' && g[1].playContent.preferences.voiceGender === 'MALE')
  await ev('DTMF_CAPTURED', 'c1', { dtmf: '12' }); await wait(); ok('DTMF_CAPTURED → gather.ended valid', last('call.gather.ended')?.digits === '12' && last('call.gather.ended').status === 'valid')
  await ib.voice.gatherDTMF('ib:c1', 'x'); await ev('DTMF_CAPTURED', 'c1', { dtmf: '' }); await wait(); ok('no digits → timeout', last('call.gather.ended')?.status === 'timeout')
  await ib.voice.speakOnCall('ib:c1', 'hi', 'female', 'fr-FR'); ok('say uses 2-letter language', posts.at(-1)[1].language === 'fr')
  await ev('SAY_FINISHED', 'c1'); await wait(); ok('SAY_FINISHED → speak.ended', !!last('call.speak.ended'))
  await ib.voice.playbackStart('ib:c1', 'https://a/hold.mp3', { loop: 'infinity' }); ok('infinite loop → big loopCount', posts.at(-1)[1].loopCount === 1000)
  const n = events.length; await ib.voice.playbackStop('ib:c1'); await ev('PLAY_FINISHED', 'c1'); await wait(); ok('stopped playback emits nothing', events.slice(n).length === 0)
  await ev('CALL_RECORDING_READY', 'c1', { recording: { files: [{ id: 'f9', duration: 7 }] } }); await wait()
  ok('recording → signed proxy link', /\/infobip\/recording\/f9\?k=[a-f0-9]{24}$/.test(last('call.recording.saved')?.recording_urls?.mp3 || '') && last('call.recording.saved').duration_secs === 7)
  await ib.voice.transferCall('ib:c1', '+33611111111', null, { targetLegClientState: 'x' }); await wait()
  ok('transfer → connect + B leg initiated with client_state', posts.at(-1)[0] === '/calls/1/calls/c1/connect' && last('call.initiated')?.call_control_id === 'ib:b1' && Buffer.from(last('call.initiated').client_state, 'base64').toString() === 'x')
  await ev('CALL_ESTABLISHED', 'b1'); await wait(); ok('B answered → bridged both', events.filter(e => e.event_type === 'call.bridged').length === 2)
  await ev('CALL_FINISHED', 'b1', { callLog: { errorCode: { name: 'NORMAL_HANGUP' } } }); await wait()
  ok('B hangup → original hung up too', posts.at(-1)[0] === '/calls/1/calls/c1/hangup')
  await ev('CALL_FINISHED', 'c1', { callLog: { errorCode: { name: 'BUSY' } } }); await wait(); ok('BUSY → user_busy', last('call.hangup')?.hangup_cause === 'user_busy')
  const o = await ib.voice.createOutboundCall('+33939370060', '+33612345678', null, null, { answering_machine_detection: 'detect' })
  ok('outbound → ib: id + machine detection', o.callControlId === 'ib:out1' && posts.at(-1)[1].machineDetection?.enabled === true && posts.at(-1)[1].endpoint.phoneNumber === '33612345678')
  await ev('MACHINE_DETECTION_FINISHED', 'out1', { detectionResult: 'MACHINE' }); await wait(); ok('AMD → machine', last('call.machine.detection.ended')?.result === 'machine')
  const sw = require('/app/js/signalwire')
  let telnyx = 0
  const w = sw.wrap({ hangupCall: async () => { telnyx++ }, createOutboundCall: async () => { telnyx++; return { callControlId: 'v3:t' } } })
  await w.hangupCall('ib:out1'); ok('router: ib: id → Infobip', posts.at(-1)[0] === '/calls/1/calls/out1/hangup' && telnyx === 0)
  const r = await w.createOutboundCall('+33939370060', '+447700900123', null, null, {}); ok('router: non-US call → Infobip first', String(r.callControlId).startsWith('ib:') && telnyx === 0)
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.log('ERR', e.stack); process.exit(1) })
