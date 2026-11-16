// Hold music while connecting (2026-11): announcement → music + destination rings at once → music stops before the bridge.
// Also: announcement fails / speak.ended never arrives → still connects; caller leaves → nothing dialed; busy → backup with music.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx / Telegram stubbed — no real calls.
//   node js/tests/test_hold_music_2026-11.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'hold_music_sandbox'
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

  // 1. Normal: announcement → music and ring together → answer → music stops → bridge
  let cc = 'v3:hold-1'
  await ring(cc)
  await waitFor(() => of('speak', cc).length)
  ok('caller hears the hold announcement', /Please hold/.test(of('speak', cc)[0]?.[2] || ''))
  ok('nothing dialed before the announcement ends', dials().length === 0)
  const t0 = Date.now()
  await hook('call.speak.ended', { call_control_id: cc })
  await waitFor(() => dials().length && of('music', cc).length)
  ok('hold music starts on the caller', /hold-music/.test(of('music', cc)[0]?.[2] || ''), JSON.stringify(of('music', cc)))
  ok('destination rings right away (no 5 s wait)', dials()[0]?.[2] === dest && dials()[0][4] - t0 < 1500, `${dials()[0]?.[4] - t0} ms`)
  const leg = dials()[0][3]
  await hook('call.initiated', { call_control_id: leg, direction: 'outgoing', from: num, to: dest })
  await hook('call.answered', { call_control_id: leg, from: num, to: dest })
  await waitFor(() => of('bridge').length)
  const stop = calls.findIndex(c => c[0] === 'stop' && c[1] === cc), br = calls.findIndex(c => c[0] === 'bridge' && c[1] === cc)
  ok('music stops before the two calls are joined', stop > -1 && br > stop, `stop@${stop} bridge@${br}`)
  await hook('call.hangup', { call_control_id: leg, hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })

  // 2. Destination answers instantly while the music is still starting → stop waits for the music, never left playing
  calls = []; slowMusic = 400; cc = 'v3:hold-2'
  await ring(cc); await waitFor(() => of('speak', cc).length)
  await hook('call.speak.ended', { call_control_id: cc })
  await waitFor(() => dials().length)
  const leg2 = dials()[0][3]
  await hook('call.initiated', { call_control_id: leg2, direction: 'outgoing', from: num, to: dest })
  await hook('call.answered', { call_control_id: leg2, from: num, to: dest })
  await waitFor(() => of('bridge').length)
  const m2 = calls.findIndex(c => c[0] === 'music'), s2 = calls.findIndex(c => c[0] === 'stop' && c[1] === cc)
  ok('quick answer: music stopped after it started (not left playing over the call)', m2 > -1 && s2 > m2, `music@${m2} stop@${s2}`)
  slowMusic = 0
  await hook('call.hangup', { call_control_id: leg2, hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })

  // 3. Announcement can't play → music + dial at once
  calls = []; speakFails = true; cc = 'v3:hold-3'
  await ring(cc)
  await waitFor(() => dials().length, 3000)
  ok('announcement fails → caller still gets music and the call still rings', dials()[0]?.[2] === dest && of('music', cc).length === 1)
  speakFails = false
  await hook('call.hangup', { call_control_id: dials()[0][3], hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })

  // 4. speak.ended never arrives → after 10 s music + dial (caller not left in silence)
  calls = []; cc = 'v3:hold-4'
  await ring(cc)
  await waitFor(() => of('speak', cc).length)
  ok('waits for the announcement first', dials().length === 0)
  await waitFor(() => dials().length, 13000)
  ok('no speak.ended → still connects after 10 s', dials()[0]?.[2] === dest && of('music', cc).length === 1)
  await hook('call.hangup', { call_control_id: dials()[0][3], hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })

  // 5. Caller hangs up during the announcement → nothing is dialed
  calls = []; cc = 'v3:hold-5'
  await ring(cc)
  await waitFor(() => of('speak', cc).length)
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })
  await sleep(300)
  await hook('call.speak.ended', { call_control_id: cc })
  await sleep(800)
  ok('caller left during announcement → destination never rung', dials().length === 0, JSON.stringify(dials()))

  // 6. Destination busy → music back on and the backup rings
  calls = []; cc = 'v3:hold-6'
  await setFwd({ backups: [backup] })
  await ring(cc); await waitFor(() => of('speak', cc).length)
  await hook('call.speak.ended', { call_control_id: cc })
  await waitFor(() => dials().length)
  await hook('call.hangup', { call_control_id: dials()[0][3], hangup_cause: 'user_busy' })
  await waitFor(() => dials().length >= 2)
  const lastStop = calls.map(c => c[0] === 'stop' && c[1] === cc).lastIndexOf(true), lastMusic = calls.map(c => c[0] === 'music' && c[1] === cc).lastIndexOf(true)
  ok('busy → backup rings with hold music back on', dials()[1]?.[2] === backup && lastMusic > lastStop, `music@${lastMusic} stop@${lastStop}`)
  await hook('call.hangup', { call_control_id: dials()[1][3], hangup_cause: 'normal_clearing' })
  await hook('call.hangup', { call_control_id: cc, hangup_cause: 'normal_clearing' })

  // 7. Hold music OFF → normal transfer, no announcement or music
  calls = []; cc = 'v3:hold-7'
  await setFwd({ holdMusic: false, backups: [] })
  await ring(cc)
  await waitFor(() => of('transferCall').length)
  ok('hold music off → plain transfer, no music', of('transferCall').length === 1 && !of('music').length && !of('speak', cc).length, JSON.stringify(calls.map(c => c[0])))

  await client.close()
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : ' — ' + r.detail}`)
  const f = results.filter(r => !r.pass).length
  console.log(`\n${results.length - f} passed, ${f} failed`)
  process.exit(f ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
