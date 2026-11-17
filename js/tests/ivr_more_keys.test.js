// New keypad keys: ring my phones, team group, AI agent, fax a document, call back, department mailbox,
// language sub-menu, staff extensions and the after-hours menu — driven through the real gather handler. No network.
process.env.TWILIO_ENABLED = 'false'
const vs = require('../../js/voice-service')
const acts = [], msgs = []
const rec = (name) => async (...a) => { acts.push({ name, a }); return {} }
let legN = 0
const stub = new Proxy({ createOutboundCall: async (from, to) => { legN++; acts.push({ name: 'dial', a: [from, to, `leg${legN}`] }); return { callControlId: `leg${legN}` } }, gatherDTMF: rec('gather'), gatherDTMFWithAudio: rec('gatherAudio'), speakOnCall: rec('speak'), hangupCall: rec('hangup'), transferCall: rec('transfer'), playbackStart: rec('play'), playbackStop: rec('stop') }, { get: (t, k) => t[k] || (async () => ({})) })
const phoneNumbersOf = { findOne: async () => ({ _id: 'u1', val: { numbers: [] } }), find: () => ({ toArray: async () => [] }) }
vs.initVoiceService({ telnyxApi: stub, phoneNumbersOf, selfUrl: 'http://x', bot: { sendMessage: async (c, t) => { msgs.push(t); return {} } } })
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const res = { sendStatus() {}, status() { return this }, send() {}, json() {} }
const ev = async (type, payload) => { await vs.handleVoiceWebhook({ body: { data: { event_type: type, payload } } }, res); await new Promise(r => setTimeout(r, 60)) }
const press = async (id, digits) => { acts.length = 0; await ev('call.gather.ended', { call_control_id: id, digits }) }
const last = (name) => acts.filter(x => x.name === name).pop()

// AI agent + fax modules stubbed (no OpenAI / Telnyx fax).
const ai = require('../../js/ai-agent'); const aiCalls = []
ai.takeFromIvr = async (a) => { aiCalls.push(a); return a.agentId === 'agent_ok' ? true : a.agentId === 'agent_closed' ? 'voicemail' : false }
const fax = require('../../js/fax-service'); const faxed = []
fax.sendIvrDoc = async (a) => { if (a.to === '+5550000') { const e = new Error('bad'); e.code = 'bad_number'; throw e } faxed.push(a); return { id: 'fx1' } }

const ivr = { enabled: true, language: 'en', greeting: 'Main menu. If you know the extension, dial it now.', options: {
  1: { action: 'devices', ringSecs: 15, noAnswer: 'voicemail', box: { name: 'Sales', email: 'sales@example.com' } },
  2: { action: 'ai', agentId: 'agent_ok' },
  3: { action: 'fax', faxFrom: '+14155550123', fileId: 'a'.repeat(24), pages: 2, docName: 'menu.pdf', message: 'Fax sent' },
  4: { action: 'callback', message: 'We will call you' },
  5: { action: 'ringgroup' },
  6: { action: 'submenu', subMenu: { language: 'es', greeting: 'Menú en español', options: { 1: { action: 'voicemail', box: { name: 'Ventas' } } } } },
  7: { action: 'voicemail', box: { name: 'Billing', email: 'billing@example.com' } },
  8: { action: 'ai', agentId: 'agent_closed' },
  9: { action: 'devices', noAnswer: 'menu' },
}, extensions: [{ code: '101', name: 'Anna', action: 'forward', forwardTo: '+14155550111' }, { code: '202', name: 'Desk', action: 'devices' }],
afterHours: { enabled: true, greeting: 'We are closed. Press 1 for a message.', options: { 1: { action: 'message', message: 'Open at nine' } } } }
const num = { phoneNumber: '+13346970100', plan: 'business', sipUsername: 'gencred123', features: { ivr, voicemail: { enabled: true }, ringGroup: { enabled: false, members: ['+14155550131', '+14155550132'], fallback: 'message' } } }
const open = (id, extra = {}) => { vs.activeCalls[id] = { num, chatId: 'u1', from: '+14155550199', to: '+13346970100', phase: 'ivr', startedAt: new Date(), ...extra }; return vs.activeCalls[id] }

;(async () => {
  // ── main menu gather accepts extensions (multi-digit + short pause) ──
  let s = open('m0', { offHours: false })
  acts.length = 0; await ev('call.answered', { call_control_id: 'm0', to: '+13346970100', from: '+14155550199' })
  const g0 = last('gather')
  ok(!g0 || (g0.a[2].maxDigits === 3 && g0.a[2].interDigitTimeout === 2500 && /2/.test(g0.a[2].validDigits)), `main menu waits for up to 3 digits with a 2.5s pause (${JSON.stringify(g0?.a[2] || 'answer path not reached in stub')})`)

  // ── devices ──
  s = open('d1'); await press('d1', '1')
  const dial = acts.find(x => x.name === 'dial')
  ok(dial && dial.a[1] === 'sip:gencred123@sip.telnyx.com' && dial.a[0] === '+14155550199' && s.phase === 'ringing_sip', 'key 1 rings this number\'s own phone apps with the caller ID')
  ok(acts.some(x => x.name === 'play'), 'the caller hears ringback while the phones ring')
  acts.length = 0; await ev('call.hangup', { call_control_id: dial.a[2], hangup_cause: 'timeout' })
  ok(s.phase === 'voicemail_greeting' && s.vmBox?.name === 'Sales' && /leave/i.test(String(last('speak')?.a[1])), `nobody answers → voicemail into the Sales mailbox (${s.phase})`)
  s = open('d2'); await press('d2', '9'); const dial2 = acts.find(x => x.name === 'dial')
  acts.length = 0; await ev('call.hangup', { call_control_id: dial2.a[2], hangup_cause: 'timeout' })
  ok(s.phase === 'ivr' && /Main menu/.test(String(last('gather')?.a[1])), 'nobody answers → back to the main menu')

  // ── AI agent ──
  s = open('a1'); await press('a1', '2')
  ok(aiCalls[0]?.agentId === 'agent_ok' && aiCalls[0]?.ccid === 'a1' && !vs.activeCalls.a1, 'key 2 hands the call to the AI agent and lets go of it')
  s = open('a2'); await press('a2', '8')
  ok(s.phase === 'voicemail_greeting' && /closed/i.test(String(last('speak')?.a[1])), 'agent closed → voicemail')

  // ── fax ──
  s = open('f1'); await press('f1', '3')
  ok(s.collect?.kind === 'fax' && /fax number/i.test(String(last('gather')?.a[1])) && last('gather')?.a[2].maxDigits === 15, 'key 3 asks for the caller\'s fax number')
  await press('f1', '4155550177')
  ok(faxed[0]?.to === '+14155550177' && faxed[0]?.fileId === 'a'.repeat(24) && faxed[0]?.faxFrom === '+14155550123' && /Fax sent/.test(String(last('speak')?.a[1])), `10-digit US fax number gets +1 and the document is sent (${JSON.stringify(faxed[0])})`)
  s = open('f2'); await press('f2', '3'); await press('f2', '5550000')
  ok(s.collect?.kind === 'fax' && /did not work/i.test(String(last('gather')?.a[1])), 'a bad fax number is asked once more')

  // ── call back ──
  s = open('cb1'); await press('cb1', '4')
  ok(s.callbackRequested && /We will call you/.test(String(last('speak')?.a[1])), 'key 4 takes a call-back request')

  // ── team group ──
  s = open('rg1'); await press('rg1', '5')
  const rgDials = acts.filter(x => x.name === 'dial').map(x => x.a[1])
  ok(rgDials.includes('+14155550131') && rgDials.includes('+14155550132') && s.phase === 'ring_group', `key 5 rings the team group together (${rgDials})`)

  // ── language sub-menu ──
  s = open('l1'); await press('l1', '6')
  ok(s.ivrLang === 'es' && /^es/.test(last('gather')?.a[2].language), `press 6 switches the menu to Spanish (${last('gather')?.a[2].language})`)
  await press('l1', '1')
  ok(/^es/.test(last('speak')?.a[3]) && s.vmBox?.name === 'Ventas', 'the Spanish voicemail prompt is spoken in Spanish into its own mailbox')

  // ── department mailbox ──
  s = open('v1'); await press('v1', '7')
  ok(s.vmBox?.email === 'billing@example.com' && s.phase === 'voicemail_greeting', 'key 7 voicemail goes to the Billing mailbox')

  // ── extensions ──
  s = open('e1'); await press('e1', '101')
  ok(s.phase === 'ivr_forward' && acts.some(x => x.name === 'speak' || x.name === 'transfer'), `extension 101 connects to Anna (${s.phase})`)
  s = open('e2'); await press('e2', '202')
  ok(acts.find(x => x.name === 'dial')?.a[1] === 'sip:gencred123@sip.telnyx.com', 'extension 202 rings the phone apps')
  s = open('e3'); await press('e3', '303')
  ok(s.ivrRetried && /invalid|not valid|option/i.test(String(last('gather')?.a[1])), 'an unknown extension is treated as a wrong key')

  // ── after-hours menu ──
  s = open('h1', { ivrRoot: 'after' }); await press('h1', '1')
  ok(/Open at nine/.test(String(last('speak')?.a[1])), 'after hours, key 1 follows the after-hours menu')
  s = open('h2', { ivrRoot: 'after' }); await press('h2', '101')
  ok(!acts.some(x => x.name === 'transfer') && s.ivrRetried, 'extensions are not offered in the after-hours menu')
  // ── your own Accept / Decline outcomes on a manual-check key ──
  ivr.options[0] = { action: 'collect', prompt: 'Type your order', length: 6, confirm: true, onAccept: { action: 'forward', forwardTo: '+14155550144', message: 'Connecting you' }, onDecline: { action: 'menu', message: 'Not found' } }
  s = open('o1'); await press('o1', '0'); await press('o1', '123456')
  ok(s.phase === 'ivr_confirm', 'manual-check key waits for Accept / Decline')
  acts.length = 0; await vs.resolveIvrConfirm('o1', 'accept', 'u1'); await new Promise(r => setTimeout(r, 60))
  ok(s.routeGo && /Connecting you/.test(String(last('speak')?.a[1])), 'Accept → your message, then transfer to your phone')
  s = open('o2'); await press('o2', '0'); await press('o2', '654321')
  acts.length = 0; await vs.resolveIvrConfirm('o2', 'decline', 'u1'); await new Promise(r => setTimeout(r, 60))
  ok(s.phase === 'ivr' && /Not found/.test(String(last('gather')?.a[1])), 'Decline → your message, then back to the menu')
  ivr.options[0].onDecline = { action: 'end' }
  s = open('o3'); await press('o3', '0'); await press('o3', '111111')
  acts.length = 0; await vs.resolveIvrConfirm('o3', 'decline', 'u1'); await new Promise(r => setTimeout(r, 60))
  ok(acts.some(x => x.name === 'hangup') && !acts.some(x => x.name === 'speak'), 'Decline → end the call at once')
  delete ivr.options[0]
  console.log('DONE')
  setTimeout(() => process.exit(process.exitCode || 0), 200)
})().catch(e => { console.error(e); process.exit(1) })
