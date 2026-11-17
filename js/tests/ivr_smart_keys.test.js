// Inbound keypad menu: 3-level sub-menus + webhook / collect / pin keys, driven through the real gather handler. No network.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const acts = [], msgs = []
const rec = (name) => async (...a) => { acts.push({ name, a }); return {} }
let legN = 0
const stub = new Proxy({ createOutboundCall: async (from, to) => { legN++; acts.push({ name: 'dial', a: [from, to, `leg${legN}`] }); return { callControlId: `leg${legN}` } }, bridgeCalls: rec('bridge'), gatherDTMF: rec('gather'), speakOnCall: rec('speak'), hangupCall: rec('hangup'), transferCall: rec('transfer'), playbackStart: rec('play') }, { get: (t, k) => t[k] || (async () => ({})) })
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stub, phoneNumbersOf, selfUrl: 'http://x', bot: { sendMessage: async (c, t) => { msgs.push(t); return {} } } })
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const res = { sendStatus() {}, status() { return this }, send() {}, json() {} }
const press = async (id, digits) => { acts.length = 0; await vs.handleVoiceWebhook({ body: { data: { event_type: 'call.gather.ended', payload: { call_control_id: id, digits } } } }, res); await new Promise(r => setTimeout(r, 50)) }
const ev = async (type, payload) => { await vs.handleVoiceWebhook({ body: { data: { event_type: type, payload } } }, res); await new Promise(r => setTimeout(r, 60)) }
const dials = () => acts.filter(x => x.name === 'dial').map(x => x.a[1])
const last = (name) => acts.filter(x => x.name === name).pop()

const ivr = { enabled: true, greeting: 'Main', options: {
  1: { action: 'submenu', subMenu: { greeting: 'Level one', options: { 2: { action: 'submenu', subMenu: { greeting: 'Level two', options: { 3: { action: 'submenu', subMenu: { greeting: 'Level three', options: { 4: { action: 'message', message: 'Deep leaf' } } } } } } } } } },
  5: { action: 'webhook', url: 'https://127.0.0.1/hook', message: 'Logged' },
  6: { action: 'collect', prompt: 'Type your order', length: 8, message: 'Got it' },
  8: { action: 'pay', payUrl: 'https://pay.example.com/x', smsFrom: 'mn_abc123', smsText: 'Pay securely here: https://pay.example.com/x' },
  9: { action: 'queue', agents: ['+14155550101', '+14155550102'], maxWait: 30, ringSecs: 10, message: 'Hold for the team', overflow: { action: 'message', message: 'Nobody free, bye' } },
  7: { action: 'pin', prompt: 'Code please', pin: '4821', onOk: { action: 'message', message: 'Welcome staff' }, failMessage: 'Wrong code' },
} }
const open = (id) => { vs.activeCalls[id] = { num: { phoneNumber: '+13346970100', plan: 'business', features: { ivr } }, chatId: 'u1', from: '+14155550199', to: '+13346970100', phase: 'ivr', startedAt: new Date() }; return vs.activeCalls[id] }

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

  // ── queue ──
  s = open('q1'); await press('q1', '9')
  ok(s.queue && /Hold for the team/.test(last('speak')?.a[1]) && !/number \d in the queue/.test(last('speak')?.a[1]), 'queue: first caller hears the hold line, no position')
  acts.length = 0; await ev('call.speak.ended', { call_control_id: 'q1' })
  const first = dials()[0]; const leg1 = acts.find(x => x.name === 'dial')?.a[2]
  ok(!!first && acts.some(x => x.name === 'play'), `queue: hold music starts and the first team phone rings (${first})`)
  acts.length = 0; await ev('call.hangup', { call_control_id: leg1, hangup_cause: 'no_answer' })
  const second = dials()[0]; const leg2 = acts.find(x => x.name === 'dial')?.a[2]
  ok(second && second !== first, `queue: no answer → the other team phone rings (${second})`)
  // second caller arrives while the first is waiting
  const s2 = open('q2'); await press('q2', '9')
  ok(/number 2 in the queue/.test(last('speak')?.a[1]), 'queue: second caller is told they are number 2')
  // nobody answers the first caller this round → told to keep holding, team rung again
  acts.length = 0; await ev('call.hangup', { call_control_id: leg2, hangup_cause: 'no_answer' })
  ok(s.queue?.round === 1 && /still busy/.test(String(last('speak')?.a[1])) && !last('hangup'), 'queue: round over → caller keeps waiting and hears an update')
  acts.length = 0; await ev('call.speak.ended', { call_control_id: 'q1' })
  const leg3 = acts.find(x => x.name === 'dial')?.a[2]
  ok(dials()[0] && dials()[0] !== first, `queue: round 2 starts with a different phone (${dials()[0]})`)
  // someone answers → bridged, first caller leaves the queue, second caller becomes number 1
  acts.length = 0; await ev('call.answered', { call_control_id: leg3 })
  ok(acts.some(x => x.name === 'bridge') && !s.queue, 'queue: answered → caller is connected and leaves the queue')
  // wait runs out for a caller → overflow message
  const s3 = open('q3'); await press('q3', '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: 'q3' })
  let l = acts.find(x => x.name === 'dial')?.a[2]; s3.transferBackups = []; s3.queue.startedAt = Date.now() - 60000
  acts.length = 0; await ev('call.hangup', { call_control_id: l, hangup_cause: 'user_busy' })
  ok(!s3.queue && /Nobody free, bye/.test(String(last('speak')?.a[1])), 'queue: maximum wait passed → overflow message')
  for (const [name, overflow, want] of [['voicemail', { action: 'voicemail' }, /leave a message/i], ['another phone', { action: 'forward', forwardTo: '+14155550177' }, /being transferred/i]]) {
    const id = `qo-${name}`; const so = open(id); so.num = { ...so.num, features: { ivr: { ...ivr, options: { 9: { ...ivr.options[9], overflow } } } } }
    await press(id, '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: id })
    const lg = acts.find(x => x.name === 'dial')?.a[2]; so.transferBackups = []; so.queue.startedAt = Date.now() - 60000
    acts.length = 0; await ev('call.hangup', { call_control_id: lg, hangup_cause: 'no_answer' })
    ok(!so.queue && acts.some(x => x.name === 'speak' && want.test(String(x.a[1]))) && !acts.some(x => x.name === 'hangup' && x.a[0] === id), `queue: overflow to ${name} (${acts.filter(x => x.name === 'speak').map(x => String(x.a[1]).slice(0, 40))})`)
    if (name === 'another phone') { acts.length = 0; await ev('call.speak.ended', { call_control_id: id }); ok(dials()[0] === '+14155550177', 'queue: overflow phone is dialled') }
  }
  // caller gives up while waiting → nothing more is dialled
  const s4 = open('q4'); await press('q4', '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: 'q4' })
  l = acts.find(x => x.name === 'dial')?.a[2]; s4.transferBackups = []
  await ev('call.hangup', { call_control_id: 'q4', hangup_cause: 'normal_clearing' })
  await new Promise(r => setTimeout(r, 5600)) // the harness never sent call.initiated, so the hangup sits in the 5s early-hangup buffer first
  acts.length = 0; await ev('call.hangup', { call_control_id: l, hangup_cause: 'originator_cancel' })
  ok(!dials().length && !acts.some(x => x.name === 'speak'), `queue: caller hung up → no more ringing or announcements ${JSON.stringify(acts.map(x => [x.name, x.a[0], String(x.a[1]).slice(0, 60)]))} session=${!!vs.activeCalls.q4} queue=${!!vs.activeCalls.q4?.queue}`)
  setTimeout(() => process.exit(process.exitCode || 0), 200)
})()
