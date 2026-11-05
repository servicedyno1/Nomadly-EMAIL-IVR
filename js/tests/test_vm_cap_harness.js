// Harness: voicemail-drop cap timer (session.maxCallMs) hangs up after the cap unless transferring/bridged.
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
const vs = require('../voice-service')
const hung = []
const fakeApi = new Proxy({}, { get: (_, k) => (k === 'hangupCall' ? async (id) => { hung.push(id) } : async () => ({})) })
vs.initVoiceService({ telnyxApi: fakeApi, bot: { sendMessage: async () => {} }, nanoid: () => 'x' })
const res = { sendStatus: () => {} }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const mk = (id, extra) => {
  vs.outboundIvrCalls[id] = { callControlId: id, phase: 'ringing', targetNumber: '+14155550100', callerId: '+17377031678', isTrial: true, campaignId: 'c1', audioUrl: 'https://x/a.mp3', activeKeys: ['1'], ivrMode: 'ivr', ...extra }
}
const answer = (id) => vs.handleVoiceWebhook({ body: { data: { event_type: 'call.answered', payload: { call_control_id: id, to: '+14155550100', from: '+17377031678' } } } }, res)
;(async () => {
  let pass = 0, fail = 0
  const ok = (c, m) => { if (c) { pass++; console.log('✓', m) } else { fail++; console.log('✗', m) } }
  mk('cap1', { maxCallMs: 150 }); await answer('cap1')
  ok(!!vs.outboundIvrCalls.cap1?._capTimer, 'cap timer armed when maxCallMs set')
  await sleep(300); ok(hung.includes('cap1'), 'hangs up after the cap while playing')
  mk('cap2', { maxCallMs: 150 }); await answer('cap2'); vs.outboundIvrCalls.cap2.phase = 'transferring'
  await sleep(300); ok(!hung.includes('cap2'), 'no hang-up while transferring')
  mk('cap3', { maxCallMs: 150 }); await answer('cap3'); vs.outboundIvrCalls.cap3.phase = 'bridged'
  await sleep(300); ok(!hung.includes('cap3'), 'no hang-up when bridged')
  mk('cap4', { maxCallMs: null }); await answer('cap4')
  ok(!vs.outboundIvrCalls.cap4?._capTimer, 'no cap timer without maxCallMs (non-VM campaigns)')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
