// iter217: carrier rejects custom caller ID → retry from own number + user told "Phone carriers rejected caller ID X" (no "Telnyx"). No network.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const calls = [], msgs = []
const stubTelnyx = new Proxy({
  createOutboundCall: async (from, to) => { calls.push({ from, to }); return from === '+14155550142' ? { error: 'D51 Invalid caller ID' } : { callControlId: `cc-${calls.length}` } },
  isLineLimitError: () => false,
}, { get: (t, k) => t[k] || (async () => ({})) })
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stubTelnyx, phoneNumbersOf, selfUrl: 'http://x', bot: { sendMessage: async (c, t) => msgs.push({ c, t }) } })
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
;(async () => {
  const base = { chatId: 'u1', callerId: '+13346972125', targetNumber: '+14155550100', greetingText: 'Hi', activeKeys: ['1'], templateName: 't', provider: 'telnyx' }
  const r = await vs.initiateOutboundIvrCall({ ...base, displayCallerId: '+14155550142' })
  await new Promise(r => setTimeout(r, 300))
  ok(calls.length === 2 && calls[0].from === '+14155550142' && calls[1].from === '+13346972125', `retried from own number ${JSON.stringify(calls)}`)
  ok(!r.error && r.callControlId, `call proceeds after retry ${JSON.stringify(r)}`)
  ok(msgs.length === 1 && /Phone carriers rejected caller ID \+14155550142/.test(msgs[0].t) && !/telnyx/i.test(msgs[0].t), `user notified: ${msgs[0]?.t}`)
  await vs.initiateOutboundIvrCall({ ...base, displayCallerId: '+14155550142' })
  await new Promise(r => setTimeout(r, 300))
  ok(msgs.length === 1, 'notice throttled (1/h per number)')
  setTimeout(() => process.exit(process.exitCode || 0), 100)
})()
