// Inbound keypad menu: 3-level sub-menus + webhook / collect / pin keys, driven through the real gather handler. No network.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const acts = [], msgs = []
const rec = (name) => async (...a) => { acts.push({ name, a }); return {} }
const stub = new Proxy({ gatherDTMF: rec('gather'), speakOnCall: rec('speak'), hangupCall: rec('hangup'), transferCall: rec('transfer'), playbackStart: rec('play') }, { get: (t, k) => t[k] || (async () => ({})) })
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stub, phoneNumbersOf, selfUrl: 'http://x', bot: { sendMessage: async (c, t) => { msgs.push(t); return {} } } })
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const res = { sendStatus() {}, status() { return this }, send() {}, json() {} }
const press = async (id, digits) => { acts.length = 0; await vs.handleVoiceWebhook({ body: { data: { event_type: 'call.gather.ended', payload: { call_control_id: id, digits } } } }, res); await new Promise(r => setTimeout(r, 50)) }
const last = (name) => acts.filter(x => x.name === name).pop()

const ivr = { enabled: true, greeting: 'Main', options: {
  1: { action: 'submenu', subMenu: { greeting: 'Level one', options: { 2: { action: 'submenu', subMenu: { greeting: 'Level two', options: { 3: { action: 'submenu', subMenu: { greeting: 'Level three', options: { 4: { action: 'message', message: 'Deep leaf' } } } } } } } } } },
  5: { action: 'webhook', url: 'https://127.0.0.1/hook', message: 'Logged' },
  6: { action: 'collect', prompt: 'Type your order', length: 8, message: 'Got it' },
  8: { action: 'pay', payUrl: 'https://pay.example.com/x', smsFrom: 'mn_abc123', smsText: 'Pay securely here: https://pay.example.com/x' },
  7: { action: 'pin', prompt: 'Code please', pin: '4821', onOk: { action: 'message', message: 'Welcome staff' }, failMessage: 'Wrong code' },
} }
const open = (id) => { vs.activeCalls[id] = { num: { phoneNumber: '+13346970100', plan: 'business', features: { ivr } }, chatId: 'u1', from: '+14155550199', to: '+13346970100', phase: 'ivr' }; return vs.activeCalls[id] }

;(async () => {
  let s = open('c1')
  await press('c1', '1'); ok(JSON.stringify(s.ivrPath) === '["1"]' && /Level one/.test(last('gather')?.a[1]), 'level 1 sub-menu entered')
  await press('c1', '2'); ok(JSON.stringify(s.ivrPath) === '["1","2"]' && /Level two/.test(last('gather')?.a[1]), 'level 2 sub-menu entered')
  await press('c1', '3'); ok(JSON.stringify(s.ivrPath) === '["1","2","3"]' && /Level three/.test(last('gather')?.a[1]), 'level 3 sub-menu entered')
  await press('c1', '4'); ok(acts.some(x => (x.name === 'speak' || x.name === 'gather') && /Deep leaf/.test(String(x.a[1]))), `level 3 leaf message spoken ${JSON.stringify(acts.map(x => x.name))}`)

  s = open('c2'); s.ivrPath = '1' // old single-digit string path still resolves
  await press('c2', '2'); ok(JSON.stringify(s.ivrPath) === '["1","2"]', 'legacy string ivrPath is upgraded to a path')

  s = open('c3')
  await press('c3', '5'); ok(/Logged/.test(last('speak')?.a[1]), 'webhook key speaks its line (private URL is refused, call still continues)')

  s = open('c4')
  await press('c4', '6'); ok(s.collect?.kind === 'collect' && /Type your order/.test(last('gather')?.a[1]) && last('gather')?.a[2].maxDigits === 8, 'collect key asks for up to 8 digits')
  await press('c4', '12345'); ok(!s.collect && /Got it/.test(last('speak')?.a[1]) && msgs.some(m => /12345/.test(m)), 'collected digits confirmed and sent to the owner')
  s = open('c5'); await press('c5', '6'); await press('c5', '')
  ok(/Goodbye/.test(last('speak')?.a[1]), 'collect with nothing typed says goodbye')

  s = open('c6')
  await press('c6', '7'); ok(s.collect?.kind === 'pin' && last('gather')?.a[2].maxDigits === 4, 'pin key asks for a 4-digit code')
  await press('c6', '0000'); ok(s.collect?.kind === 'pin' && /Wrong code/.test(last('gather')?.a[1]), 'wrong pin is asked again')
  await press('c6', '4821'); ok(!s.collect && /Welcome staff/.test(last('speak')?.a[1]), 'right pin continues')
  s = open('c7'); await press('c7', '7'); await press('c7', '1'); await press('c7', '2'); await press('c7', '3')
  ok(!s.collect && !last('gather') && /Wrong code/.test(last('speak')?.a[1]), 'three wrong pins ends the call')
  s = open('c8'); await press('c8', '8')
  ok(s.phase === 'ivr_sms' && /text/i.test(String(last('speak')?.a[1])), `pay key runs the text path and tells the caller (${last('speak')?.a[1]})`)
  setTimeout(() => process.exit(process.exitCode || 0), 200)
})()
