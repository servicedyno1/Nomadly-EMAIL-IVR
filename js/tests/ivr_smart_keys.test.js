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
  2: { action: 'sms', smsFrom: 'mn_abc123', smsText: 'Our address: 1 Main St', message: 'We texted you our address.' },
  3: { action: 'sms', smsFrom: 'mn_abc123', smsText: 'Opening hours 9 to 5', after: 'menu' },
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
  await press('c6', ''); ok(s.collect?.kind === 'pin' && (s.collectTries || 0) === 1 && /Wrong code/.test(last('gather')?.a[1]), 'the pound pressed after a full wrong code is not counted as a try (found on a live call)')
  await press('c6', '4821'); ok(!s.collect && /Welcome staff/.test(last('speak')?.a[1]), 'right pin continues')
  s = open('c7'); await press('c7', '7'); await press('c7', '1'); await press('c7', '2'); await press('c7', '3')
  ok(!s.collect && !last('gather') && /Wrong code/.test(last('speak')?.a[1]), 'three wrong pins ends the call')
  s = open('c8'); await press('c8', '8')
  ok(s.phase === 'ivr_sms' && /text/i.test(String(last('speak')?.a[1])), `pay key runs the text path and tells the caller (${last('speak')?.a[1]})`)

  // Text key on its own (not through the pay key): the caller, and only the caller, gets the owner's text from the owner's line.
  const spenza = require('../../js/spenza.js'), realSend = spenza.sendSms, texts = []
  spenza.sendSms = async (...a) => { texts.push(a); return { log: {} } }
  s = open('t1'); await press('t1', '2')
  ok(texts.length === 1 && JSON.stringify(texts[0]) === JSON.stringify(['u1', 'mn_abc123', '+14155550199', 'Our address: 1 Main St']), `text key sends the owner's text to the caller from the chosen line (${JSON.stringify(texts[0])})`)
  ok(s.phase === 'ivr_sms' && /We texted you our address/.test(String(last('speak')?.a[1])), 'text key tells the caller with the owner\'s own line')
  texts.length = 0; s = open('t2'); await press('t2', '3')
  ok(texts.length === 1 && texts[0][3] === 'Opening hours 9 to 5' && /Main/.test(String(last('gather')?.a[1])), 'text key set to "back to menu" sends the text and reads the menu again')
  texts.length = 0; msgs.length = 0; spenza.sendSms = async () => ({ error: 'This number can’t send texts right now.' })
  s = open('t3'); await press('t3', '2')
  ok(/could not send/i.test(String(last('speak')?.a[1])) && !/We texted you/.test(String(last('speak')?.a[1])), `a text that fails is not announced as sent (${last('speak')?.a[1]})`)
  spenza.sendSms = realSend

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
  // ── queue callback offer ──
  for (const [name, digit] of [['asks for a call back', '1'], ['keeps waiting', '']]) {
    const id = `qc-${digit || 'none'}`; const sc = open(id); sc.num = { ...sc.num, features: { ivr: { ...ivr, options: { 9: { ...ivr.options[9], callback: true, maxWait: 300 } } } } }
    await press(id, '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: id })
    const lg = acts.find(x => x.name === 'dial')?.a[2]; sc.transferBackups = []
    acts.length = 0; await ev('call.hangup', { call_control_id: lg, hangup_cause: 'no_answer' })
    ok(sc.queue?.offering && /Press 1 and we will call you back/.test(String(last('gather')?.a[1])) && !dials().length, `queue callback: offered between rounds, nobody rung yet (${name})`)
    msgs.length = 0; await press(id, digit)
    if (digit === '1') ok(!sc.queue && sc.callbackRequested && /call you back/.test(String(last('speak')?.a[1])) && !dials().length, 'queue callback: pressing 1 ends the wait and confirms; no more ringing')
    else ok(sc.queue && !sc.queue.offering && dials().length === 1 && acts.some(x => x.name === 'play'), 'queue callback: no key → hold music and the team rings again')
  }
  { const id = 'qc-off'; const sc = open(id); await press(id, '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: id }); const lg = acts.find(x => x.name === 'dial')?.a[2]; sc.transferBackups = []; sc.queue.maxWait = 300000
    acts.length = 0; await ev('call.hangup', { call_control_id: lg, hangup_cause: 'no_answer' })
    ok(!sc.queue.offering && !last('gather') && /stay on the line/.test(String(last('speak')?.a[1])), 'queue callback: off by default — plain update, no offer') }
  // ── outbound stop-calls key ──
  const dncAdds = []; const store = require('../../js/ai-agent').store; const realAdd = store.addDnc
  store.addDnc = async (chatId, number, reason) => { dncAdds.push([chatId, number, reason]); return {} }
  const ob = (id, extra) => { vs.outboundIvrCalls[id] = { chatId: 'u1', callerId: '+13346970100', targetNumber: '+14155550188', ivrNumber: '+14155550100', activeKeys: ['1'], stopKey: '9', phase: 'playing', greetingText: 'Hi', startedAt: new Date(), ...extra }; return vs.outboundIvrCalls[id] }
  let o1 = ob('ob1'); await press('ob1', '9')
  ok(o1.optedOut && dncAdds.length === 1 && dncAdds[0][1] === '+14155550188' && /not receive these calls again/.test(String(last('speak')?.a[1])) && !acts.some(x => x.name === 'transfer' || x.name === 'dial'), 'stop key: number goes on the do-not-call list, caller is told, nobody is connected')
  o1 = ob('ob2', { bulkMode: 'report_only' }); await press('ob2', '9'); ok(o1.optedOut && dncAdds.length === 2, 'stop key: works on a record-only campaign call too')
  o1 = ob('ob3'); await press('ob3', '1'); ok(!o1.optedOut && dncAdds.length === 2 && o1.phase === 'transferring', 'stop key: the connect key still connects')
  o1 = ob('ob4', { stopKey: null }); await press('ob4', '9'); ok(!o1.optedOut && dncAdds.length === 2, 'stop key: off by default — 9 does nothing special')
  store.addDnc = async () => { throw new Error('db down') }
  o1 = ob('ob5'); await press('ob5', '9'); ok(o1.optedOut && !/not receive these calls again/.test(String(last('speak')?.a[1])) && msgs.some(m => /saving it failed/.test(m)), 'stop key: if saving fails the caller is NOT told they are removed and the owner is alerted')
  store.addDnc = realAdd
  // caller gives up while waiting → nothing more is dialled
  const s4 = open('q4'); await press('q4', '9'); acts.length = 0; await ev('call.speak.ended', { call_control_id: 'q4' })
  l = acts.find(x => x.name === 'dial')?.a[2]; s4.transferBackups = []
  await ev('call.hangup', { call_control_id: 'q4', hangup_cause: 'normal_clearing' })
  await new Promise(r => setTimeout(r, 5600)) // the harness never sent call.initiated, so the hangup sits in the 5s early-hangup buffer first
  acts.length = 0; await ev('call.hangup', { call_control_id: l, hangup_cause: 'originator_cancel' })
  ok(!dials().length && !acts.some(x => x.name === 'speak'), `queue: caller hung up → no more ringing or announcements ${JSON.stringify(acts.map(x => [x.name, x.a[0], String(x.a[1]).slice(0, 60)]))} session=${!!vs.activeCalls.q4} queue=${!!vs.activeCalls.q4?.queue}`)
  setTimeout(() => process.exit(process.exitCode || 0), 200)
})()
