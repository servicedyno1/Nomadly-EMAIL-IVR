// Voicemail / call recording delivered when Telnyx sends call.recording.saved AFTER call.hangup (caller hung up mid-message).
// Live run 2026-10-25 on cloudivr.net lost a voicemail this way. Also: answered ring-group calls are logged.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx / Telegram stubbed — no real calls.
//   node js/tests/test_voicemail_after_hangup_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'vm_after_hangup_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }

const calls = []
let seq = 0
const telnyxStub = new Proxy({
  async createOutboundCall(from, to) { const id = `v3:leg-${++seq}`; calls.push(['dial', from, to, id]); return { callControlId: id } },
  async answerCall(id) { calls.push(['answer', id]); return {} },
  async hangupCall(id) { calls.push(['hangup', id]); return {} },
  async startRecording(id, ch, fmt, opts) { calls.push(['record', id, opts || null]); return {} },
}, { get: (t, k) => t[k] || (async (...a) => { calls.push([String(k), ...a]); return {} }) })
const sent = []
const botStub = new Proxy({}, { get: (t, k) => async (chatId, x, opts) => { sent.push({ m: String(k), chatId: String(chatId), x: String(x), caption: opts?.caption }); return {} } })
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {}, status() { return { send() {}, json() {} } } })

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const chat = '9000000881', num = '+18885550881', caller = '+14155550123'
  await walletOf.insertOne({ _id: chat, usdIn: 20, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: num, status: 'active', plan: 'pro', provider: 'telnyx',
    features: { voicemail: { enabled: true, forwardToTelegram: true, ringTimeout: 10 }, recording: false, ringGroup: { enabled: false }, callForwarding: { enabled: false, mode: 'disabled' } } }] } })

  // ── 1. Voicemail: hangup arrives BEFORE recording.saved ──
  const cc = 'v3:inbound-vm-1'
  await hook('call.initiated', { call_control_id: cc, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
  await hook('call.answered', { call_control_id: cc, from: caller, to: num })
  await waitFor(() => /^voicemail/.test(voice.activeCalls?.[cc]?.phase || ''))
  ok('V00', 'setup: call reaches the voicemail greeting', /^voicemail/.test(voice.activeCalls?.[cc]?.phase || ''), `phase=${voice.activeCalls?.[cc]?.phase}`)
  await hook('call.speak.ended', { call_control_id: cc })
  await waitFor(() => voice.activeCalls?.[cc]?.phase === 'voicemail_recording')
  ok('V01', 'recording starts after the greeting, with the promised beep', calls.some(c => c[0] === 'record' && c[1] === cc && c[2]?.playBeep === true), JSON.stringify(calls.filter(c => c[0] === 'record')))
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing', duration_secs: 30 })
  ok('V02', 'session removed from live calls at hangup', !voice.activeCalls?.[cc])
  await hook('call.recording.saved', { call_control_id: cc, recording_urls: { mp3: 'https://rec.invalid/vm1.mp3' }, duration_secs: 21 })
  const vmOk = await waitFor(async () => !!(await phoneLogs.findOne({ type: 'voicemail', phoneNumber: num, from: caller })))
  const vm = await phoneLogs.findOne({ type: 'voicemail', phoneNumber: num, from: caller })
  ok('V03', 'voicemail logged even though recording.saved came after hangup', vmOk && vm?.recordingUrl === 'https://rec.invalid/vm1.mp3' && vm?.duration === 21, JSON.stringify(vm))
  ok('V04', 'owner gets the voicemail audio', sent.some(s => s.m === 'sendAudio' && s.chatId === chat && /vm1\.mp3/.test(s.x)), JSON.stringify(sent.map(s => s.m)))
  await hook('call.recording.saved', { call_control_id: cc, recording_urls: { mp3: 'https://rec.invalid/vm1.mp3' }, duration_secs: 21 })
  await sleep(200)
  ok('V05', 'a duplicate recording.saved does not log the voicemail twice', (await phoneLogs.countDocuments({ type: 'voicemail', phoneNumber: num })) === 1)

  // ── 2. A call with no recording leaves nothing behind ──
  const cc2 = 'v3:inbound-noanswer-2'
  await hook('call.initiated', { call_control_id: cc2, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
  await hook('call.hangup', { call_control_id: cc2, hangup_cause: 'originator_cancel', duration_secs: 0 })
  await hook('call.recording.saved', { call_control_id: cc2, recording_urls: { mp3: 'https://rec.invalid/none.mp3' }, duration_secs: 3 })
  await sleep(200)
  ok('V06', 'recording.saved for an ended call that was not recording is ignored', !(await phoneLogs.findOne({ recordingUrl: 'https://rec.invalid/none.mp3' })))

  // ── 2b. SIP device rings unanswered → voicemail: the greeting plays ONCE (the call.answered from the fallback
  //        must not route the call again) and recording starts after it ──
  await phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.sipUsername': 'gencredSANDBOX', 'val.numbers.0.telnyxSipUsername': 'gencredSANDBOX' } })
  const cc4 = 'v3:inbound-sip-vm-4'
  calls.length = 0
  await hook('call.initiated', { call_control_id: cc4, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
  await waitFor(() => calls.some(c => c[0] === 'dial' && /^sip:/.test(c[2])))
  const sipLeg = calls.find(c => c[0] === 'dial' && /^sip:/.test(c[2]))
  ok('S00', 'setup: the SIP device rings first', !!sipLeg, JSON.stringify(calls.slice(0, 6)))
  if (sipLeg) {
    await hook('call.hangup', { call_control_id: sipLeg[3], hangup_cause: 'normal_clearing', duration_secs: 0 })
    await waitFor(() => calls.some(c => c[0] === 'answer' && c[1] === cc4))
    await hook('call.answered', { call_control_id: cc4, from: caller, to: num })
    await sleep(900)
    const greetings = calls.filter(c => (c[0] === 'speakOnCall' || c[0] === 'playbackStart') && c[1] === cc4 && !/ringback/i.test(String(c[2])))
    ok('S01', 'voicemail greeting plays exactly once after the unanswered SIP ring', greetings.length === 1, JSON.stringify(greetings))
    ok('S02', 'call is in the voicemail greeting (not re-routed)', voice.activeCalls?.[cc4]?.phase === 'voicemail_greeting', `phase=${voice.activeCalls?.[cc4]?.phase}`)
    await hook('call.speak.ended', { call_control_id: cc4 })
    await waitFor(() => calls.some(c => c[0] === 'record' && c[1] === cc4))
    ok('S03', 'recording starts only after that single greeting, with a beep', calls.filter(c => c[0] === 'record' && c[1] === cc4).length === 1 && calls.find(c => c[0] === 'record' && c[1] === cc4)?.[2]?.playBeep === true)
    await hook('call.hangup', { call_control_id: cc4, hangup_cause: 'normal_clearing', duration_secs: 25 })
    await hook('call.recording.saved', { call_control_id: cc4, recording_urls: { mp3: 'https://rec.invalid/vm4.mp3' }, duration_secs: 12 })
    ok('S04', 'that voicemail is saved too', await waitFor(async () => !!(await phoneLogs.findOne({ recordingUrl: 'https://rec.invalid/vm4.mp3' }))))
  }
  await phoneNumbersOf.updateOne({ _id: chat }, { $unset: { 'val.numbers.0.sipUsername': '', 'val.numbers.0.telnyxSipUsername': '' } })

  // ── 2c. Call recording ON (Business) → voicemail: the greeting-only call recording is stopped and dropped, the voicemail
  //        gets its own recording with the beep, and is logged once with the voicemail file ──
  await phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.plan': 'business', 'val.numbers.0.features.recording': true } })
  const cc5 = 'v3:inbound-rec-vm-5'
  calls.length = 0
  await hook('call.initiated', { call_control_id: cc5, direction: 'incoming', from: '+14155550555', to: num, connection_id: 'x' })
  await hook('call.answered', { call_control_id: cc5, from: '+14155550555', to: num })
  await waitFor(() => voice.activeCalls?.[cc5]?.phase === 'voicemail_greeting')
  ok('C00', 'setup: call recording started at answer', calls.some(c => c[0] === 'record' && c[1] === cc5 && !c[2]?.playBeep), JSON.stringify(calls.filter(c => c[1] === cc5).map(c => c[0])))
  await hook('call.speak.ended', { call_control_id: cc5 })
  await waitFor(() => calls.some(c => c[0] === 'record' && c[1] === cc5 && c[2]?.playBeep))
  const i5stop = calls.findIndex(c => c[0] === 'stopRecording' && c[1] === cc5), i5beep = calls.findIndex(c => c[0] === 'record' && c[1] === cc5 && c[2]?.playBeep)
  ok('C01', 'greeting-only call recording stopped before the voicemail recording (with beep) starts', i5stop >= 0 && i5beep > i5stop, JSON.stringify(calls.filter(c => c[1] === cc5)))
  await hook('call.recording.saved', { call_control_id: cc5, recording_urls: { mp3: 'https://rec.invalid/greeting-only.mp3' }, duration_secs: 8 })
  await hook('call.hangup', { call_control_id: cc5, hangup_cause: 'normal_clearing', duration_secs: 30 })
  await hook('call.recording.saved', { call_control_id: cc5, recording_urls: { mp3: 'https://rec.invalid/vm5.mp3' }, duration_secs: 15 })
  await waitFor(async () => !!(await phoneLogs.findOne({ recordingUrl: 'https://rec.invalid/vm5.mp3' })))
  const v5 = await phoneLogs.find({ from: '+14155550555' }).toArray()
  ok('C02', 'only the voicemail is logged (greeting-only file dropped)', v5.length === 1 && v5[0].type === 'voicemail' && v5[0].recordingUrl === 'https://rec.invalid/vm5.mp3', JSON.stringify(v5))
  ok('C03', 'greeting-only file was not sent to the owner', !sent.some(s => /greeting-only/.test(s.x)))
  await phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.plan': 'pro', 'val.numbers.0.features.recording': false } })

  // ── 3. Ring group: the answered call is logged as forwarded to the phone that answered ──
  await phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.features.ringGroup': { enabled: true, members: ['+14155550201', '+14155550202'], ringTimeout: 20, fallback: 'message', message: 'x' }, 'val.numbers.0.features.voicemail.enabled': false } })
  const cc3 = 'v3:inbound-rg-3'
  calls.length = 0
  await hook('call.initiated', { call_control_id: cc3, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
  await hook('call.answered', { call_control_id: cc3, from: caller, to: num })
  await waitFor(() => calls.filter(c => c[0] === 'dial').length === 2)
  const legs = calls.filter(c => c[0] === 'dial')
  ok('R00', 'setup: ring group dials both members from the number', legs.length === 2 && legs.every(l => l[1] === num), JSON.stringify(legs))
  const win = legs.find(l => l[2] === '+14155550201')
  if (win) {
    await hook('call.answered', { call_control_id: win[3], from: num, to: '+14155550201' })
    await hook('call.bridged', { call_control_id: cc3, from: caller, to: num })
    await hook('call.hangup', { call_control_id: cc3, hangup_cause: 'normal_clearing', duration_secs: 42 })
    const fwOk = await waitFor(async () => !!(await phoneLogs.findOne({ type: 'forwarded', phoneNumber: num })))
    const fw = await phoneLogs.findOne({ type: 'forwarded', phoneNumber: num })
    ok('R01', 'answered ring-group call logged as forwarded, with the phone that answered', fwOk && fw?.forwardTo === '+14155550201' && fw?.duration === 42 && fw?.from === caller, JSON.stringify(fw))
  }

  await db.dropDatabase(); await client.close()
  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.pass ? '' : ` — ${r.detail}`}`)
  console.log(`${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error('ERROR', e); process.exit(1) })
