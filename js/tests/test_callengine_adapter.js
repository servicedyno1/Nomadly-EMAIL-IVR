// Own call engine (Asterisk ARI) → Telnyx events. Run: cd /app && node js/tests/test_callengine_adapter.js
process.env.ASTERISK_ARI_URL = 'https://x:8089'; process.env.ASTERISK_ARI_PASSWORD = 'p'; delete process.env.OPENAI_API_KEY; delete process.env.BIRD_API_KEY; delete process.env.CALL_ENGINE_TRUNK
const ce = require('/app/js/callengine')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms))
const ev = []; ce._setSink((e) => ev.push(e.data)); const last = (t) => [...ev].reverse().find(e => e.event_type === t)?.payload
const reqs = []; ce.ari = () => ({ request: async (o) => { reqs.push(o); return { data: o.url === '/bridges' ? { id: 'br1' } : o.url.endsWith('/snoop') ? { id: 'snoop1' } : {} } }, post: async (u, b, o) => { reqs.push({ method: 'post', url: u, params: o?.params, data: b }); return { data: {} } } })
const E = (type, extra) => ce._onEvent({ type, ...extra })
;(async () => {
  E('StasisStart', { channel: { id: 'c1', state: 'Ring', caller: { number: '33612345678' } }, args: ['pstn', '+33939370060'] }); await wait()
  ok('DIDWW call → incoming call.initiated', last('call.initiated')?.call_control_id === 'ae:c1' && last('call.initiated').from === '+33612345678' && last('call.initiated').to === '+33939370060')
  E('StasisStart', { channel: { id: 's1', state: 'Up', caller: { number: 'cvabc' } }, args: ['sip', '+12125550000', 'cvabc'] }); await wait()
  ok('softphone call → outgoing with sip: from', last('call.initiated')?.direction === 'outgoing' && last('call.initiated').from.startsWith('sip:cvabc@'))
  E('ChannelStateChange', { channel: { id: 'c1', state: 'Up' } }); await wait(); ok('Up → call.answered', last('call.answered')?.call_control_id === 'ae:c1')
  await ce.gatherDTMFWithSpeak('ae:c1', 'Press 1', 'female', { maxDigits: 2, timeout: 200, interDigitTimeout: 100 })
  const pl = reqs.find(r => /\/play\//.test(r.url)); ok('prompt played through media helper', /tts\.wav\?t=/.test(pl.params.media))
  const pid = pl.url.split('/').pop()
  E('ChannelDtmfReceived', { channel: { id: 'c1' }, digit: '1' }); E('ChannelDtmfReceived', { channel: { id: 'c1' }, digit: '2' }); await wait()
  ok('2 digits → gather.ended valid 12 and prompt stopped', last('call.gather.ended')?.digits === '12' && reqs.some(r => r.method === 'delete' && r.url === `/playbacks/${pid}`))
  await ce.gatherDTMF('ae:c1', null, { timeout: 50 }); await wait(120); ok('no keys → timeout', last('call.gather.ended')?.status === 'timeout')
  await ce.speakOnCall('ae:c1', 'hi', 'male'); const sp = reqs.filter(r => /\/play\//.test(r.url)).pop()
  E('PlaybackFinished', { playback: { id: sp.url.split('/').pop(), state: 'done' } }); await wait(); ok('speak → speak.ended', !!last('call.speak.ended'))
  await ce.startRecording('ae:c1', 'single', 'wav'); ok('recording uses a snoop copy', reqs.some(r => r.url === '/channels/snoop1/record'))
  const name = reqs.find(r => r.url === '/channels/snoop1/record').params.name
  E('RecordingFinished', { recording: { name, duration: 5 } }); await wait(); ok('recording.saved with signed link', /\/callengine\/recording\/.+\?k=/.test(last('call.recording.saved')?.recording_urls.mp3))
  ce._setConnected(true)
  const o = await ce.createOutboundCall('+33939370060', '+447700900123', null, null, {}); ok('outbound via DIDWW trunk', o.callControlId.startsWith('ae:') && reqs.pop().params.endpoint === 'PJSIP/447700900123@didww')
  await ce.transferCall('ae:c1', 'sip:cvabc@sip.telnyx.com', '+33939370060', { targetLegClientState: 'x' }); const tr = reqs.filter(r => r.params?.endpoint).pop()
  ok('transfer to softphone via Kamailio with key header', /^PJSIP\/kamailio\/sip:cvabc@/.test(tr.params.endpoint) && tr.data.variables['PJSIP_HEADER(add,X-Nomadly-User)'] === 'cvabc')
  await wait(); const bId = last('call.initiated').call_control_id
  E('ChannelStateChange', { channel: { id: bId.slice(3), state: 'Up' } }); await wait(50); ok('B answered → bridged both', ev.filter(e => e.event_type === 'call.bridged').length === 2)
  E('ChannelHangupRequest', { channel: { id: 'c1' }, cause: 17 }); E('ChannelDestroyed', { channel: { id: 'c1' } }); await wait(); ok('cause 17 → user_busy', last('call.hangup')?.hangup_cause === 'user_busy')
  // softphone dials 10 digits: passed through untouched (voice-service adds +1), never turned into +<10 digits>
  E('StasisStart', { channel: { id: 's2', state: 'Ring', caller: { number: 'cvabc' } }, args: ['sip', '7023231634', 'cvabc'] }); await wait()
  ok('softphone 10-digit dial is not prefixed with +', last('call.initiated')?.call_control_id === 'ae:s2' && last('call.initiated').to === '7023231634')
  // dialed number refused before answer → the softphone leg is ended (no endless ringing)
  process.env.CALL_ENGINE_EARLY_MS = '50'
  const before = reqs.length
  await ce.transferCall('ae:s2', '+17023231634', '+12025550000', {}); await wait()
  const b2 = last('call.initiated').call_control_id
  E('ChannelHangupRequest', { channel: { id: b2.slice(3) }, cause: 21 }); E('ChannelDestroyed', { channel: { id: b2.slice(3) } }); await wait(3200)
  ok('refused destination → softphone leg hung up', reqs.slice(before).some(r => r.method === 'delete' && r.url === '/channels/s2'))
  // a call the engine no longer has is ended by the sweep (missed hang-up event)
  E('StasisStart', { channel: { id: 's3', state: 'Up', caller: { number: 'cvabc' } }, args: ['sip', '+12125550000', 'cvabc'] }); await wait()
  ce._legs.get('ae:s3').startedAt = new Date(Date.now() - 120000).toISOString()
  const base = ce.ari()
  ce.ari = () => ({ ...base, get: async (u) => { if (u === '/channels/s3') { const e = new Error('nf'); e.response = { status: 404 }; throw e } return { data: {} } } })
  await ce._sweep(); await wait()
  ok('sweep ends a call missing from the engine', last('call.hangup')?.call_control_id === 'ae:s3')
  ok('sweep keeps calls that still exist', !ce._legs.get('ae:s1').ended)
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
