// Unit check (no network): a verified "Show as" number becomes the Telnyx `from`; the CloudIVR number stays the session caller.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const calls = [], transfers = []
const stubTelnyx = new Proxy({
  createOutboundCall: async (from, to) => { calls.push({ from, to }); return { callControlId: `cc-${calls.length}` } },
  transferCall: async (cc, to, from) => { transfers.push({ cc, to, from }); return {} },
}, { get: (t, k) => t[k] || (async () => ({})) })
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [{ phoneNumber: '+13346972125', plan: 'business', status: 'active', provider: 'telnyx' }] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stubTelnyx, phoneNumbersOf, selfUrl: 'http://x' })
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const hook = (event_type, payload) => vs.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus: () => {} })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const base = { chatId: 'u1', callerId: '+13346972125', targetNumber: '+14155550100', greetingText: 'Hi', activeKeys: ['1'], templateName: 't', provider: 'telnyx' }
  const a = await vs.initiateOutboundIvrCall({ ...base, displayCallerId: '+14155550142' })
  ok(!a.error && calls[0]?.from === '+14155550142', `show-as used as from (${calls[0]?.from}${a.error ? ' ' + a.error : ''})`)
  const b = await vs.initiateOutboundIvrCall(base)
  ok(!b.error && calls[1]?.from === '+13346972125', `default from is the CloudIVR number (${calls[1]?.from})`)
  // Call me first: owner's mobile sees the CloudIVR number; the connected leg shows the verified number.
  const c = await vs.initiateOutboundIvrCall({ ...base, targetNumber: '+14155550111', ivrNumber: '+14155550222', ivrMode: 'transfer', transferCallerId: '+14155550142' })
  ok(calls[2]?.from === '+13346972125', `call-me-first first leg from CloudIVR number (${calls[2]?.from})`)
  await hook('call.answered', { call_control_id: c.callControlId, from: '+13346972125', to: '+14155550111', direction: 'outgoing' })
  await sleep(200)
  await hook('call.gather.ended', { call_control_id: c.callControlId, digits: '1', status: 'valid', from: '+13346972125', to: '+14155550111' })
  await sleep(500)
  const t = transfers.find(x => x.cc === c.callControlId)
  ok(t?.from === '+14155550142' && t?.to === '+14155550222', `press 1 connects showing verified number (${JSON.stringify(t)})`)
  setTimeout(() => process.exit(process.exitCode || 0), 100)
})()
