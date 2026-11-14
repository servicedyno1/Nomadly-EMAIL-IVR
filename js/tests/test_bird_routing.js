// Outbound routing: Bird first (caller ID linked, spend left, free line), SignalWire on refusal; Telnyx off by default;
// call engine holds events until the call rings so an early Bird refusal can be retried. Run from /app.
'use strict'
delete process.env.TELNYX_FALLBACK
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const ce = require('../callengine'), bird = require('../bird'), sw = require('../signalwire'), ib = require('../infobip')
const used = []
const state = { birdResult: { callControlId: 'ae:1' }, presentable: true, spend: 50, active: 0 }
Object.assign(ce, { enabled: () => true, connected: () => true, activeBird: () => state.active, createOutboundCall: async () => { used.push('Bird'); return state.birdResult } })
Object.assign(bird, { enabled: () => true, presentable: async () => state.presentable, spendLeft: async () => state.spend })
Object.assign(sw.rest, { enabled: () => true, refreshOwned: async () => {}, ownsNumber: () => true, ownedNumbers: () => ['+12074892004'] })
Object.assign(sw.voice, { connected: () => true, createOutboundCall: async (f) => { used.push(`SignalWire:${f}`); return { callControlId: 'sw:1' } } })
ib.enabled = () => false
const t = { createOutboundCall: async () => { used.push('Telnyx'); return { callControlId: 't:1' } }, buyNumber: async () => { used.push('TelnyxBuy'); return { id: 'x' } } }
const w = sw.wrap(t)
const FROM = '+12074892004', TO = '+12074891859'

;(async () => {
  let r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('linked caller ID → Bird', r.callControlId === 'ae:1' && used.join() === 'Bird', used.join())

  used.length = 0; state.birdResult = { error: 'trunk refused the call (cause 34)', status: 503, refused: true }
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('Bird refuses → retried through SignalWire', r.callControlId === 'sw:1' && used.join() === `Bird,SignalWire:${FROM}`, used.join())

  used.length = 0; state.birdResult = { callControlId: 'ae:1' }; state.presentable = false
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('caller ID not on Bird yet → SignalWire only', r.callControlId === 'sw:1' && used.join() === `SignalWire:${FROM}`, used.join())

  used.length = 0; state.presentable = true; state.spend = 0.5
  await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('daily spend used up → SignalWire', used.join() === `SignalWire:${FROM}`, used.join())

  used.length = 0; state.spend = 50; state.active = 20
  setTimeout(() => { state.active = 19 }, 700)
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('single call waits for a free Bird line (20 busy) then uses Bird', r.callControlId === 'ae:1' && used.join() === 'Bird', used.join())

  used.length = 0; state.active = 20; process.env.BIRD_WAIT_MS = '800'
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('single call: no line within the wait → SignalWire', used.join() === `SignalWire:${FROM}`, used.join())
  delete process.env.BIRD_WAIT_MS

  used.length = 0
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', { _campaign: true })
  ok('campaign call with Bird full → line-limit error (lead re-queued), no SignalWire', r.status === 429 && w.isLineLimitError(r) && used.length === 0, JSON.stringify(r))

  used.length = 0; state.active = 0; state.presentable = false
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', { _campaign: true })
  ok('campaign caller ID not linked → waits (re-queued) and is queued for linking', r.status === 429 && used.length === 0 && sw.birdWanted.has(FROM), JSON.stringify(r))

  used.length = 0; state.presentable = true; state.spend = 0
  await w.createOutboundCall(FROM, TO, 'u', 'c', { _campaign: true })
  ok('campaign with Bird spend used up → continues on SignalWire', used.join() === `SignalWire:${FROM}`, used.join())
  state.spend = 50

  used.length = 0; state.active = 0
  await w.createOutboundCall(FROM, TO, 'u', 'c', { answering_machine_detection: 'premium' })
  ok('voicemail drop → Bird too (machine detection runs on the call engine)', used.join() === 'Bird', used.join())

  used.length = 0; state.active = 0
  await w.createOutboundCall(FROM, 'sip:user1@sip.example', 'u', 'c', {})
  ok('softphone (sip:) destination stays on SignalWire', used.join() === `SignalWire:${FROM}`, used.join())

  used.length = 0; sw.voice.createOutboundCall = async () => { used.push('SignalWire'); return { error: 'boom' } }; state.presentable = false
  r = await w.createOutboundCall(FROM, TO, 'u', 'c', {})
  ok('Telnyx not used for calls by default', !used.includes('Telnyx'), used.join())

  used.length = 0
  r = await w.buyNumber('+15550001111', 'c', 'm')
  ok('number buying never falls back to Telnyx by default', r === null && !used.includes('TelnyxBuy'))

  process.env.SIP_SERVER_SECRET = process.env.SIP_SERVER_SECRET || 'k'
  r = await w.createSIPCredential('conn', 'cvtestuser1', 'Pw12345678', FROM)
  ok('SIP login made on our own SIP server (brand address), not SignalWire', r.id === 'kam:cvtestuser1' && r.sip_username === 'cvtestuser1' && r.sip_password === 'Pw12345678' && !('sip_domain' in r))
  ok('removing an own-server SIP login needs no carrier call', (await w.deleteSIPCredential('kam:cvtestuser1')) === true)

  // ── call engine early-refusal window (real module, ARI stubbed) ──
  delete require.cache[require.resolve('../callengine')]
  const CE = require('../callengine')
  const events = []
  CE._setSink(async (e) => events.push(e.data.event_type)); CE._setConnected(true)
  let chId
  CE.ari = () => ({ post: async (path) => { chId = path.split('/').pop(); return { data: {} } } })
  process.env.BIRD_API_KEY = process.env.BIRD_API_KEY || 'bk_us1_test'
  let p = CE.createOutboundCall(FROM, TO, 'u', 'c', { earlyMs: 2000 })
  await new Promise(r => setTimeout(r, 150))
  CE._onEvent({ type: 'ChannelDestroyed', cause: 34, channel: { id: chId } })
  r = await p; await new Promise(r => setTimeout(r, 50))
  ok('trunk refusal before ringing → error for retry, no events leaked', r.refused === true && events.length === 0, `${JSON.stringify(r)} events=${events}`)

  p = CE.createOutboundCall(FROM, TO, 'u', 'c', { earlyMs: 2000 })
  await new Promise(r => setTimeout(r, 150))
  CE._onEvent({ type: 'ChannelStateChange', channel: { id: chId, state: 'Ringing' } })
  r = await p; await new Promise(r => setTimeout(r, 50))
  ok('ringing call → returned with call.initiated', r.callControlId === `ae:${chId}` && events.includes('call.initiated'), `${JSON.stringify(r)} events=${events}`)
  ok('Bird line counted while live', CE.activeBird() === 1)

  events.length = 0
  p = CE.createOutboundCall(FROM, TO, 'u', 'c', { earlyMs: 2000 })
  await new Promise(r => setTimeout(r, 150))
  CE._onEvent({ type: 'ChannelDestroyed', cause: 17, channel: { id: chId } })
  r = await p; await new Promise(r => setTimeout(r, 50))
  ok('busy destination is a real result (no retry), hangup delivered', !r.error && events.includes('call.hangup'), `${JSON.stringify(r)} events=${events}`)

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
