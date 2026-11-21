// Announce the caller on forwarded calls (2026-11). Based on the hold-music test.
// Hold music while connecting (2026-11): announcement → music + destination rings at once → music stops before the bridge.
// Also: announcement fails / speak.ended never arrives → still connects; caller leaves → nothing dialed; busy → backup with music.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx / Telegram stubbed — no real calls.
//   node js/tests/test_announce_caller_2026-11.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'announce_caller_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50) } return false }

let calls = [], seq = 0, speakFails = false, slowMusic = 0
const telnyxStub = new Proxy({
  async createOutboundCall(from, to) { const id = `v3:leg-${++seq}`; calls.push(['dial', from, to, id, Date.now()]); return { callControlId: id } },
  async speakOnCall(id, text) { calls.push(['speak', id, text, Date.now()]); return speakFails ? null : {} },
  async playbackStart(id, url) { if (slowMusic) await sleep(slowMusic); calls.push(['music', id, url, Date.now()]); return {} },
  async playbackStop(id) { calls.push(['stop', id, Date.now()]); return {} },
  async bridgeCalls(a, b) { calls.push(['bridge', a, b, Date.now()]); return {} },
}, { get: (t, k) => t[k] || (async (...a) => { calls.push([String(k), ...a]); return {} }) })
const botStub = new Proxy({}, { get: () => async () => ({}) })
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {}, status() { return { send() {}, json() {} } } })
const of = (k, id) => calls.filter(c => c[0] === k && (!id || c[1] === id))
const dials = () => of('dial')

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const chat = '9000000881', num = '+18885550881', caller = '+14155550123', dest = '+14155550301', backup = '+14155550302'
  await walletOf.insertOne({ _id: chat, usdIn: 20, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: num, status: 'active', plan: 'pro', provider: 'telnyx',
    features: { voicemail: { enabled: false }, recording: false, ringGroup: { enabled: false }, callForwarding: { enabled: true, mode: 'always', forwardTo: dest, ringTimeout: 25, holdMusic: true } } }] } })
  const setFwd = (f) => phoneNumbersOf.updateOne({ _id: chat }, { $set: { 'val.numbers.0.features.callForwarding': { enabled: true, mode: 'always', forwardTo: dest, ringTimeout: 25, holdMusic: true, ...f } } })
  const ring = async (cc) => {
    await hook('call.initiated', { call_control_id: cc, direction: 'incoming', from: caller, to: num, connection_id: 'x' })
    await hook('call.answered', { call_control_id: cc, from: caller, to: num })
  }

  const answer = async (cc) => { await ring(cc); await waitFor(() => of('speak', cc).length); await hook('call.speak.ended', { call_control_id: cc }); await waitFor(() => dials().length); const leg = dials()[0][3]
    await hook('call.initiated', { call_control_id: leg, direction: 'outgoing', from: num, to: dest }); await hook('call.answered', { call_control_id: leg, from: num, to: dest }); return leg }
  const end = async (cc, leg) => { await hook('call.hangup', { call_control_id: leg, hangup_cause: 'normal_clearing' }); await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' }) }

  // 1. Toggle on: the answering phone hears the caller and the number, and is connected only after that
  await setFwd({ holdMusic: false, announceCaller: true })
  let cc = 'v3:ann-1', leg = await answer(cc)
  await waitFor(() => of('speak', leg).length)
  ok('answering phone hears who is calling and for which number', of('speak', leg)[0]?.[2] === 'Call from 4 1 5, 5 5 5, 0 1 2 3, to your number ending 0 8 8 1.', of('speak', leg)[0]?.[2])
  await sleep(300)
  ok('not connected while the announcement plays', of('bridge').length === 0)
  await hook('call.speak.ended', { call_control_id: leg })
  await waitFor(() => of('bridge').length)
  ok('connected once the announcement ends', of('bridge').length === 1 && of('bridge')[0][1] === cc && of('bridge')[0][2] === leg)
  await hook('call.speak.ended', { call_control_id: leg })
  ok('a repeated event does not connect twice', of('bridge').length === 1)
  await end(cc, leg)

  // 2. Announcement cannot be played → still connects
  calls = []; cc = 'v3:ann-2'; await ring(cc); await waitFor(() => of('speak', cc).length); await hook('call.speak.ended', { call_control_id: cc }); await waitFor(() => dials().length)
  leg = dials()[0][3]; speakFails = true
  await hook('call.answered', { call_control_id: leg, from: num, to: dest })
  await waitFor(() => of('bridge').length, 3000)
  ok('if the announcement fails the call still connects', of('bridge').length === 1)
  speakFails = false; await end(cc, leg)

  // 3. Toggle off: connects straight away, nothing spoken to the answering phone
  calls = []; await setFwd({ holdMusic: true, announceCaller: false })
  cc = 'v3:ann-3'; leg = await answer(cc)
  await waitFor(() => of('bridge').length, 3000)
  ok('toggle off: connected at once, no announcement', of('bridge').length === 1 && of('speak', leg).length === 0)
  await end(cc, leg)

  // 4. Hidden caller
  calls = []
  await setFwd({ announceCaller: true })
  cc = 'v3:ann-4'
  await hook('call.initiated', { call_control_id: cc, direction: 'incoming', from: 'anonymous', to: num, connection_id: 'x' }); await hook('call.answered', { call_control_id: cc, from: 'anonymous', to: num })
  await waitFor(() => of('speak', cc).length); await hook('call.speak.ended', { call_control_id: cc }); await waitFor(() => dials().length); leg = dials()[0][3]
  await hook('call.answered', { call_control_id: leg, from: num, to: dest }); await waitFor(() => of('speak', leg).length)
  ok('hidden caller wording', /^Call from a hidden number, to your number ending 0 8 8 1\.$/.test(of('speak', leg)[0]?.[2] || ''), of('speak', leg)[0]?.[2])
  await hook('call.speak.ended', { call_control_id: leg }); await end(cc, leg)

  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass || !r.detail ? '' : ' — ' + r.detail}`)
  const bad = results.filter(r => !r.pass).length
  console.log(`\n${results.length - bad} passed, ${bad} failed`)
  await db.dropDatabase(); await client.close(); process.exit(bad ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
