// Ring groups + Text-to-Call message calls + call-event feed (2026-06). Telnyx / Telegram / webhook receiver stubbed.
// SANDBOX MONGO ONLY (mongod --port 27999 --dbpath /tmp/mongo27999 --fork --logpath /tmp/m.log). No real calls.
//   node js/tests/test_ring_group_triggers_2026-06.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'ring_group_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const http = require('http')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const events = require('../cloudivr-web/events.js')
const triggers = require('../cloudivr-web/text-triggers.js')
const ringGroup = require('../cloudivr-web/ring-group.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }

const dials = [], hangups = [], speaks = [], bridges = [], gathers = []
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to) { const id = `v3:rg-${++seq}`; dials.push({ id, from, to }); return { callControlId: id } },
  async gatherDTMFWithAudio(id) { gathers.push(id); return {} }, async gatherDTMF(id) { gathers.push(id); return {} }, async gatherDTMFWithSpeak(id) { gathers.push(id); return {} }, async gatherStop() { return {} },
  async speakOnCall(id, text) { speaks.push({ id, text }); return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls(a, b) { bridges.push([a, b]); return {} }, async transferCall() { return {} }, async answerCall() { return {} }, async startRecording() { return {} },
  async hangupCall(id) { hangups.push(id); return {} }, async rejectCall() { return {} },
}
const botStub = { sendMessage: async () => ({}), sendAudio: async () => ({}), sendDocument: async () => ({}) }
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const legsTo = (to) => dials.filter(d => d.to === to).map(d => d.id)

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })

  // Webhook receiver (events.publicHost blocks loopback, so the stored hook is written straight to the DB).
  const got = []
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.end('ok') }) })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port

  const chat = '5000000000000901', num = '+18885550901'
  const members = ['+14155550901', '+14155550902', '+14155550903']
  await walletOf.insertOne({ _id: chat, usdIn: 50, usdOut: 0 })
  const rg = ringGroup.validate({ enabled: true, members, ringTimeout: 15, fallback: 'message', message: 'Nobody is free right now.' }, { phoneNumber: num, plan: 'pro' })
  await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: num, status: 'active', plan: 'pro', provider: 'telnyx', features: { ringGroup: rg, voicemail: { enabled: true } } }] } })
  const secret = 'whsec_test'
  await db.collection('webPrefs').insertOne({ _id: chat, webhook: { enabled: true, url: `http://127.0.0.1:${port}/hook`, secret, events: Object.keys(events.EVENTS) } })
  events.routes({ get() {}, put() {}, post() {} }, { db, h: (f) => f })

  // ── RG1: answered → every member rings at once; first answer bridged, the others stop ──
  const in1 = 'v3:inbound-1'
  await hook('call.initiated', { call_control_id: in1, direction: 'incoming', from: '+12125550111', to: num })
  await hook('call.answered', { call_control_id: in1 })
  await waitFor(() => members.every(m => legsTo(m).length))
  ok('RG1', 'all 3 members dialed at once from the CloudIVR number', members.every(m => legsTo(m).length === 1) && dials.filter(d => members.includes(d.to)).every(d => d.from === num), JSON.stringify(dials))
  const [A, B, C] = members.map(m => legsTo(m)[0])
  await hook('call.answered', { call_control_id: B })
  await sleep(100)
  ok('RG2', 'first answer (B) is bridged to the caller', bridges.some(([x, y]) => x === in1 && y === B), JSON.stringify(bridges))
  ok('RG3', 'the other ringing phones are hung up', hangups.includes(A) && hangups.includes(C) && !hangups.includes(B), JSON.stringify(hangups))
  await hook('call.answered', { call_control_id: C }) // late answer after it was stopped
  ok('RG4', 'a late answer is not bridged', !bridges.some(([, y]) => y === C))
  await hook('call.hangup', { call_control_id: A, hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: C, hangup_cause: 'normal_clearing' })
  ok('RG5', 'stopped legs do not trigger the no-answer fallback', !speaks.some(s => s.id === in1 && /Nobody is free/.test(s.text)))
  await hook('call.hangup', { call_control_id: B, hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: in1, hangup_cause: 'normal_clearing', duration_secs: 30 })

  // ── RG6: nobody answers → the group's message plays ──
  const in2 = 'v3:inbound-2'
  const before = dials.length
  await hook('call.initiated', { call_control_id: in2, direction: 'incoming', from: '+12125550112', to: num })
  await hook('call.answered', { call_control_id: in2 })
  await waitFor(() => dials.length >= before + 3)
  const legs2 = dials.slice(before).map(d => d.id)
  for (const l of legs2) await hook('call.hangup', { call_control_id: l, hangup_cause: 'timeout' })
  await waitFor(() => speaks.some(s => s.id === in2))
  ok('RG6', 'no answer → "sorry" message on the caller leg', speaks.some(s => s.id === in2 && s.text === 'Nobody is free right now.'), JSON.stringify(speaks))
  await hook('call.hangup', { call_control_id: in2, hangup_cause: 'normal_clearing', duration_secs: 20 })
  await sleep(200)
  const missed = await phoneLogs.findOne({ phoneNumber: num, from: '+12125550112', type: 'missed' })
  ok('RG7', 'unanswered ring group call is logged as missed', !!missed)

  // ── RG8: fallback voicemail ──
  await phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.features.ringGroup.fallback': 'voicemail' } })
  const in3 = 'v3:inbound-3'
  const b3 = dials.length
  await hook('call.initiated', { call_control_id: in3, direction: 'incoming', from: '+12125550113', to: num })
  await hook('call.answered', { call_control_id: in3 })
  await waitFor(() => dials.length >= b3 + 3)
  for (const l of dials.slice(b3).map(d => d.id)) await hook('call.hangup', { call_control_id: l, hangup_cause: 'timeout' })
  await waitFor(() => speaks.some(s => s.id === in3))
  ok('RG8', 'no answer → voicemail greeting', speaks.some(s => s.id === in3 && /leave a message|unavailable/i.test(s.text)), JSON.stringify(speaks.filter(s => s.id === in3)))
  await hook('call.hangup', { call_control_id: in3, hangup_cause: 'normal_clearing', duration_secs: 5 })

  // ── MO: Text-to-Call message call → speaks the message once, no keypad gather ──
  const r = await voice.initiateOutboundIvrCall({ chatId: chat, callerId: num, targetNumber: '+14155550999', greetingText: 'Thanks for your text, we open at nine.', messageOnly: true, activeKeys: ['1'], ivrMode: 'transfer', templateName: 'Text-to-Call message', provider: 'telnyx' })
  ok('MO1', 'message call dialed', !!r.callControlId, JSON.stringify(r))
  const g0 = gathers.length
  await hook('call.answered', { call_control_id: r.callControlId })
  await sleep(100)
  ok('MO2', 'message spoken, no keypad gather', speaks.some(s => s.id === r.callControlId && /we open at nine/.test(s.text)) && gathers.length === g0)

  // ── EV: call-event feed (signed) ──
  await waitFor(() => got.filter(g => /"call.ended"/.test(g.body)).length >= 3, 3000)
  const types = got.map(g => JSON.parse(g.body).type)
  ok('EV1', 'call.started and call.ended delivered', types.includes('call.started') && types.includes('call.ended'), types.join(','))
  const sample = got[0]
  ok('EV2', 'signature = HMAC-SHA256(secret, body)', sample && sample.headers['x-cloudivr-signature'] === crypto.createHmac('sha256', secret).update(sample.body).digest('hex'))
  const ended = got.map(g => JSON.parse(g.body)).filter(e => e.type === 'call.ended')
  ok('EV3', 'call.ended carries duration + outcome', ended.some(e => e.data.duration === 30 && e.data.answeredBy === members[1]) && ended.some(e => e.data.outcome === 'missed'), JSON.stringify(ended.map(e => e.data)))

  // ── TT: Text Triggers rule matching ──
  const cfg = triggers.validate({ enabled: true, myPhone: '+14155550888', rules: [
    { action: 'callback', keywordOnly: true, keywords: 'call me, urgent' },
    { action: 'message', message: 'We will reply soon.', businessHoursOnly: true },
  ] }, { phoneNumber: num, plan: 'pro' }, [])
  const open = { phoneNumber: num, features: { hours: { enabled: false } } }
  ok('TT1', 'keyword matches whole words, case-insensitive', triggers.match(cfg, open, 'Please CALL ME back').rule?.action === 'callback' && triggers.match(cfg, open, 'recall meeting').rule?.action === 'message')
  const closed = { phoneNumber: num, features: { hours: { enabled: true, timezone: 'UTC', days: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => [d, { on: false, start: '09:00', end: '17:00' }])) } } }
  ok('TT2', 'business-hours-only rule skipped when closed', triggers.match(cfg, closed, 'hello').rule === null)
  let threw = null
  try { triggers.validate({ enabled: true, rules: [{ action: 'ai', agentId: 'x' }] }, { phoneNumber: num, plan: 'pro' }, ['x']) } catch (e) { threw = e.message }
  ok('TT3', 'AI call back refused below Business', /Business/.test(threw || ''), threw)

  srv.close()
  await client.close()
  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.id} ${r.name}${r.pass ? '' : ` — ${r.detail}`}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
