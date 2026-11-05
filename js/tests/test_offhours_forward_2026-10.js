// Off-hours forwarding (2026-10): outside a number's hours the backup numbers ring one after another (20 s each), then
// voicemail / the closed message when nobody answers. Also: the hours switch works for never-saved (default) hours.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx / Telegram stubbed — no real calls.
//   node js/tests/test_offhours_forward_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'offhours_forward_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const hours = require('../number-hours')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50) } return false }

const calls = []
let seq = 0
const telnyxStub = new Proxy({
  async createOutboundCall(from, to) { const id = `v3:leg-${++seq}`; calls.push(['dial', from, to, id]); return { callControlId: id } },
  async answerCall(id) { calls.push(['answer', id]); return {} },
  async hangupCall(id) { calls.push(['hangup', id]); return {} },
  async speakOnCall(id, text) { calls.push(['speak', id, text]); return {} },
  async bridgeCalls(a, b) { calls.push(['bridge', a, b]); return {} },
}, { get: (t, k) => t[k] || (async (...a) => { calls.push([String(k), ...a]); return {} }) })
const sent = []
const botStub = new Proxy({}, { get: (t, k) => async (chatId, x) => { sent.push({ m: String(k), chatId: String(chatId), x: String(x) }); return {} } })
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {}, status() { return { send() {}, json() {} } } })
const dials = () => calls.filter(c => c[0] === 'dial')

// Closed right now: every day open only in a window 6–7 hours from now (UTC).
const hh = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:00`
const closedWeek = () => {
  const a = new Date(Date.now() + 6 * 3600000), b = new Date(Date.now() + 7 * 3600000)
  return Object.fromEntries(hours.DAYS.map(d => [d, { on: true, start: hh(a), end: hh(b) }]))
}

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const chat = '9000000991', num = '+18885550991', caller = '+14155550123'
  const B = ['+14155550201', '+14155550202', '+14155550203']
  const setHours = (h) => phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.features.hours': h } })
  await walletOf.insertOne({ _id: chat, usdIn: 20, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: num, status: 'active', plan: 'pro', provider: 'telnyx',
    features: { voicemail: { enabled: true, forwardToTelegram: true, ringTimeout: 10 }, recording: false, ringGroup: { enabled: false }, callForwarding: { enabled: false, mode: 'disabled' } } }] } })
  const call = async (cc) => {
    await hook('call.initiated', { call_control_id: cc, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
    await hook('call.answered', { call_control_id: cc, from: caller, to: num })
  }

  // ── 1. Nobody answers: 3 backups in order, then voicemail ──
  await setHours({ enabled: true, timezone: 'UTC', days: closedWeek(), offAction: 'forward', offForward: B, offMessage: '' })
  const cc = 'v3:offhours-1'
  await call(cc)
  await waitFor(() => voice.activeCalls?.[cc]?.phase === 'forwarding')
  const s = voice.activeCalls?.[cc]
  ok('F00', 'outside hours with forward → the call goes to forwarding (no voicemail yet)', s?.phase === 'forwarding' && s?.offHoursFallback === true, `phase=${s?.phase}`)
  ok('F01', 'each backup rings 20 s', s?.bridgeRingSecs === 20, `bridgeRingSecs=${s?.bridgeRingSecs}`)
  ok('F02', 'owner told the call is being forwarded', sent.some(m => m.chatId === chat && /Forwarding to your backup numbers/.test(m.x)))
  await hook('call.speak.ended', { call_control_id: cc })
  await waitFor(() => dials().length >= 1)
  ok('F03', 'first backup dialed from the number', dials()[0]?.[2] === B[0] && dials()[0]?.[1] === num, JSON.stringify(dials()))
  await hook('call.hangup', { call_control_id: dials()[0][3], hangup_cause: 'timeout' })
  await waitFor(() => dials().length >= 2)
  ok('F04', 'no answer → second backup', dials()[1]?.[2] === B[1], JSON.stringify(dials().map(d => d[2])))
  await hook('call.hangup', { call_control_id: dials()[1][3], hangup_cause: 'user_busy' })
  await waitFor(() => dials().length >= 3)
  ok('F05', 'busy → third backup', dials()[2]?.[2] === B[2], JSON.stringify(dials().map(d => d[2])))
  await hook('call.hangup', { call_control_id: dials()[2][3], hangup_cause: 'timeout' })
  await waitFor(() => /^voicemail/.test(voice.activeCalls?.[cc]?.phase || ''))
  ok('F06', 'nobody answered → voicemail (caller not hung up)', /^voicemail/.test(voice.activeCalls?.[cc]?.phase || '') && !calls.some(c => c[0] === 'hangup' && c[1] === cc), `phase=${voice.activeCalls?.[cc]?.phase}`)
  ok('F07', 'owner told none answered', sent.some(m => /None of your backup numbers answered/.test(m.x)))
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing', duration_secs: 70 })

  // ── 2. Second backup answers → bridged; no voicemail ──
  calls.length = 0
  const cc2 = 'v3:offhours-2'
  await call(cc2)
  await waitFor(() => voice.activeCalls?.[cc2]?.phase === 'forwarding')
  await hook('call.speak.ended', { call_control_id: cc2 })
  await waitFor(() => dials().length >= 1)
  await hook('call.hangup', { call_control_id: dials()[0][3], hangup_cause: 'timeout' })
  await waitFor(() => dials().length >= 2)
  await hook('call.answered', { call_control_id: dials()[1][3], from: num, to: B[1] })
  await waitFor(() => calls.some(c => c[0] === 'bridge'))
  ok('F08', 'second backup answers → bridged with the caller', calls.some(c => c[0] === 'bridge' && c[1] === cc2 && c[2] === dials()[1][3]), JSON.stringify(calls.filter(c => c[0] === 'bridge')))
  await hook('call.hangup', { call_control_id: dials()[1][3], hangup_cause: 'normal_clearing' })
  await sleep(300)
  ok('F09', 'after a bridged call ends, no voicemail is started', !/^voicemail/.test(voice.activeCalls?.[cc2]?.phase || ''), `phase=${voice.activeCalls?.[cc2]?.phase}`)
  await hook('call.hangup', { call_control_id: cc2, hangup_cause: 'normal_clearing', duration_secs: 40 })

  // ── 3. Message mode unchanged; empty wallet skips forwarding ──
  calls.length = 0
  await setHours({ enabled: true, timezone: 'UTC', days: closedWeek(), offAction: 'message', offForward: B, offMessage: 'We are closed.' })
  const cc3 = 'v3:offhours-3'
  await call(cc3)
  await waitFor(() => voice.activeCalls?.[cc3]?.phase === 'off_hours')
  ok('F10', 'message mode: closed message, nothing dialed', voice.activeCalls?.[cc3]?.phase === 'off_hours' && !dials().length && calls.some(c => c[0] === 'speak' && /We are closed/.test(c[2])))
  await hook('call.hangup', { call_control_id: cc3, hangup_cause: 'normal_clearing', duration_secs: 5 })

  calls.length = 0
  await walletOf.updateOne({ _id: chat }, { $set: { usdOut: 20 } })
  await setHours({ enabled: true, timezone: 'UTC', days: closedWeek(), offAction: 'forward', offForward: B, offMessage: '' })
  const cc4 = 'v3:offhours-4'
  await call(cc4)
  await waitFor(() => /^voicemail/.test(voice.activeCalls?.[cc4]?.phase || ''))
  ok('F11', 'empty wallet: no forwarding, straight to voicemail', /^voicemail/.test(voice.activeCalls?.[cc4]?.phase || '') && !dials().length, `phase=${voice.activeCalls?.[cc4]?.phase}`)
  await hook('call.hangup', { call_control_id: cc4, hangup_cause: 'normal_clearing', duration_secs: 5 })

  // ── 4. Hours validation keeps offForward for the route; defaults include it ──
  ok('F12', 'forward is a valid off action', hours.validateHours({ enabled: true, days: closedWeek(), offAction: 'forward' }).offAction === 'forward')
  ok('F13', 'default hours have Mon–Fri on and an empty backup list', ['mon', 'fri'].every(d => hours.defaultHours().days[d].on) && Array.isArray(hours.defaultHours().offForward))

  await client.close()
  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.id} ${r.name}${r.pass ? '' : `  — ${r.detail}`}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error('ERROR', e); process.exit(1) })
