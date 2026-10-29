// Unit check (no network): a verified "Show as" number becomes the Telnyx `from`; the CloudIVR number stays the session caller.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const calls = []
const stubTelnyx = { createOutboundCall: async (from, to) => { calls.push({ from, to }); return { callControlId: `cc-${calls.length}` } } }
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [{ phoneNumber: '+13346972125', plan: 'business', status: 'active', provider: 'telnyx' }] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stubTelnyx, phoneNumbersOf, selfUrl: 'http://x' })
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
;(async () => {
  const base = { chatId: 'u1', callerId: '+13346972125', targetNumber: '+14155550100', greetingText: 'Hi', activeKeys: ['1'], templateName: 't', provider: 'telnyx' }
  const a = await vs.initiateOutboundIvrCall({ ...base, displayCallerId: '+14155550142' })
  ok(!a.error && calls[0]?.from === '+14155550142', `show-as used as from (${calls[0]?.from}${a.error ? ' ' + a.error : ''})`)
  const b = await vs.initiateOutboundIvrCall(base)
  ok(!b.error && calls[1]?.from === '+13346972125', `default from is the CloudIVR number (${calls[1]?.from})`)
  setTimeout(() => process.exit(process.exitCode || 0), 100)
})()
