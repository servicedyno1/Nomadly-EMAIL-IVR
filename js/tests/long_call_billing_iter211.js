// iter211 — Long-call billing + mid-call wallet guard. SANDBOX MONGO ONLY (127.0.0.1:27999).
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/long_call_billing_iter211.js
// REAL voice-service (cleanup interval, outbound IVR handlers, billing); Telnyx API + Telegram stubbed.
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'iter211_longcall_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

// capture every setInterval so we can fire the 60 s cleanup + wallet monitor on demand
const intervals = []
const _si = global.setInterval
global.setInterval = function (fn, ms, ...a) { const h = _si(() => {}, 1e9); intervals.push({ fn, ms, h, src: String(fn) }); return h }
const _ci = global.clearInterval
const cleared = new Set()
global.clearInterval = function (h) { cleared.add(h); return _ci(h) }

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => { results.push({ id, name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${detail}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const r2 = (n) => Math.round(n * 100) / 100

const alive = {}          // id → true/false/null
const aliveCalls = []
const hangups = []
let seq = 0
const telnyxStub = {
  async createOutboundCall() { return { callControlId: `v3:lc-${++seq}` } },
  async isCallAlive(id) { aliveCalls.push(id); return id in alive ? alive[id] : null },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async gatherStop() { return {} }, async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const sent = []
const botStub = { sendMessage: async (c, t) => { sent.push({ c: String(c), t: String(t) }); return {} }, sendDocument: async () => ({}) }
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const cleanupFn = () => intervals.find(i => i.src.includes('Memory Leak Prevention'))
const monitorOf = (sinceIdx) => intervals.slice(sinceIdx).filter(i => i.src.includes('Mid-call wallet')).slice(-1)[0]

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), ledger = db.collection('walletLedger')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs: db.collection('phoneLogs'), telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }

  const A = '9000000611', callerA = '+18885550611'
  await walletOf.insertOne({ _id: A, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: A, val: { numbers: [{ phoneNumber: callerA, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const CL = cleanupFn()
  ok('LC-00', 'cleanup interval captured (60 s)', CL && CL.ms === 60000, CL ? `ms=${CL.ms}` : 'none')

  // ── Live Quick IVR + answered transfer leg, 20 min old ──
  const start = async (target, ivr) => {
    const r = await voice.initiateOutboundIvrCall({ chatId: A, callerId: callerA, targetNumber: target, ivrNumber: ivr, audioUrl: 'https://cdn.invalid/a.mp3', activeKeys: ['1'], templateName: 't' })
    return r.callControlId || r.callSid || Object.keys(voice.outboundIvrCalls).slice(-1)[0]
  }
  const iMon = intervals.length
  const p1 = await start('+14155551001', '+14155552001')
  ok('LC-01', 'Quick IVR session created (telnyx stub)', !!voice.outboundIvrCalls[p1], p1)
  await hook('call.initiated', { call_control_id: p1, direction: 'outgoing', from: callerA, to: '+14155551001' })
  await hook('call.answered', { call_control_id: p1 })
  voice.outboundIvrCalls[p1].phase = 'transferring'
  const l1 = 'v3:leg-1'
  await hook('call.initiated', { call_control_id: l1, direction: 'outgoing', from: callerA, to: '+14155552001' })
  await hook('call.answered', { call_control_id: l1 })
  ok('LC-02', 'transfer leg registered + answered', voice.ivrTransferLegs[l1]?.phase === 'answered' && voice.ivrTransferLegs[l1].parentCallControlId === p1, JSON.stringify(voice.ivrTransferLegs[l1]?.phase))
  const ago = (m) => Date.now() - m * 60000
  const s1 = voice.outboundIvrCalls[p1]
  s1.startTime = ago(20); s1.answerTime = ago(20); delete s1.startedAt; delete s1.createdAt
  voice.ivrTransferLegs[l1].startTime = ago(19); voice.ivrTransferLegs[l1].answerTime = ago(19)

  // dead pair (non-alive) 20 min old
  const p2 = await start('+14155551002', '+14155552002')
  await hook('call.initiated', { call_control_id: p2, direction: 'outgoing', from: callerA, to: '+14155551002' })
  await hook('call.answered', { call_control_id: p2 })
  const s2 = voice.outboundIvrCalls[p2]; s2.startTime = ago(20); delete s2.startedAt; delete s2.createdAt
  const p2Timer = s2._limitTimer
  // unknown-state (Telnyx unreachable) 20 min old
  const p3 = await start('+14155551003', null)
  await hook('call.initiated', { call_control_id: p3, direction: 'outgoing', from: callerA, to: '+14155551003' })
  await hook('call.answered', { call_control_id: p3 })
  const s3 = voice.outboundIvrCalls[p3]; s3.startTime = ago(20); delete s3.startedAt; delete s3.createdAt
  // > 6 h old (hard cap) — deleted even if "alive"
  const p4 = await start('+14155551004', null)
  const s4 = voice.outboundIvrCalls[p4]; s4.startTime = Date.now() - 6.1 * 3600000; delete s4.startedAt; delete s4.createdAt
  // non-Telnyx key in activeCalls (old) → deleted
  voice.activeCalls['CAtwilio-old'] = { startedAt: new Date(ago(40)) }
  voice.activeCalls['v3:ac-live'] = { startedAt: new Date(ago(40)) }
  voice.activeCalls['v3:ac-dead'] = { startedAt: new Date(ago(40)) }

  alive[p1] = true; alive[l1] = true; alive[p2] = false; alive[p3] = null; alive[p4] = true
  alive['v3:ac-live'] = true; alive['v3:ac-dead'] = false
  aliveCalls.length = 0
  CL.fn(); await sleep(150)
  ok('LC-03', 'live 20-min Quick IVR session kept', !!voice.outboundIvrCalls[p1], `aliveChecked=${aliveCalls.includes(p1)}`)
  ok('LC-04', 'live 19-min answered transfer leg kept', !!voice.ivrTransferLegs[l1], `aliveChecked=${aliveCalls.includes(l1)}`)
  ok('LC-05', 'dead (is_alive=false) session removed + its limit timer cleared', !voice.outboundIvrCalls[p2] && cleared.has(p2Timer), `present=${!!voice.outboundIvrCalls[p2]} timerCleared=${cleared.has(p2Timer)}`)
  ok('LC-06', 'unknown (null) session kept', !!voice.outboundIvrCalls[p3], '')
  ok('LC-07', '>6 h session deleted without asking Telnyx', !voice.outboundIvrCalls[p4] && !aliveCalls.includes(p4), `asked=${aliveCalls.includes(p4)}`)
  ok('LC-08', 'activeCalls: non-Telnyx old key deleted, live v3 kept, dead v3 deleted', !voice.activeCalls['CAtwilio-old'] && !!voice.activeCalls['v3:ac-live'] && !voice.activeCalls['v3:ac-dead'], Object.keys(voice.activeCalls).join(','))

  // re-check throttle: second cleanup within 5 min must not query Telnyx again for p1
  aliveCalls.length = 0
  CL.fn(); await sleep(100)
  ok('LC-09', 'live session not re-queried within 5 min', !aliveCalls.includes(p1) && !aliveCalls.includes(l1), `queried=${aliveCalls.join(',')}`)
  // after 5 min, call ended → removed
  voice.outboundIvrCalls[p3]._aliveCheckedAt = Date.now() - 6 * 60000; alive[p3] = false
  CL.fn(); await sleep(100)
  ok('LC-10', 'previously-unknown session removed once Telnyx says it ended (after 5-min recheck)', !voice.outboundIvrCalls[p3], '')

  // ── activeBridgeTransfers ──
  voice.activeCalls // (bridges are not exported; skip if not reachable)

  // ── Hangup webhooks bill the full duration ──
  const bal0 = await balance(A)
  await hook('call.hangup', { call_control_id: l1, hangup_cause: 'normal_clearing', duration_secs: 0 })
  await hook('call.hangup', { call_control_id: p1, hangup_cause: 'normal_clearing', duration_secs: 1200 })
  await sleep(300)
  const led = await ledger.find({ chatId: { $in: [A, String(A)] } }).toArray()
  const all = led.length ? led : await ledger.find({}).toArray()
  const bal1 = await balance(A)
  ok('LC-11', 'long call billed: wallet charged 20 min IVR_Outbound + 19 min IVR_Transfer @ $0.15 = $5.85', r2(bal0 - bal1) === 5.85, `charged=$${r2(bal0 - bal1)} ledger=${JSON.stringify(all.map(x => [x.callType || x.type, x.amount, x.description]).slice(-4))}`)
  ok('LC-12', 'sessions removed after hangup', !voice.outboundIvrCalls[p1] && !voice.ivrTransferLegs[l1], '')

  // ── Mid-call wallet guard: $1.00 wallet, both legs answered → disconnect at ~3 min ──
  const B = '9000000612', callerB = '+18885550612'
  await walletOf.insertOne({ _id: B, usdIn: 1, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: B, val: { numbers: [{ phoneNumber: callerB, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const iB = intervals.length
  const rb = await voice.initiateOutboundIvrCall({ chatId: B, callerId: callerB, targetNumber: '+14155553001', ivrNumber: '+14155554001', audioUrl: 'https://cdn.invalid/a.mp3', activeKeys: ['1'], templateName: 't' })
  const pb = rb.callControlId || Object.keys(voice.outboundIvrCalls).slice(-1)[0]
  await hook('call.initiated', { call_control_id: pb, direction: 'outgoing', from: callerB, to: '+14155553001' })
  await hook('call.answered', { call_control_id: pb })
  const mon = monitorOf(iB)
  ok('LC-13', 'wallet monitor interval set (60 s) on answer', mon && mon.ms === 60000, mon ? 'yes' : 'none')
  voice.outboundIvrCalls[pb].phase = 'transferring'
  const lb = 'v3:leg-b'
  await hook('call.initiated', { call_control_id: lb, direction: 'outgoing', from: callerB, to: '+14155554001' })
  await hook('call.answered', { call_control_id: lb })
  const step = async (m) => { voice.outboundIvrCalls[pb] && (voice.outboundIvrCalls[pb].answerTime = Date.now() - m * 60000 + 1000); voice.ivrTransferLegs[lb] && (voice.ivrTransferLegs[lb].answerTime = Date.now() - m * 60000 + 1000); hangups.length = 0; sent.length = 0; await mon.fn(); await sleep(100) }
  await step(1); const h1 = [...hangups]
  await step(2); const h2 = [...hangups]
  ok('LC-14', 'not disconnected at minute 1–2 ($1.00 − $0.60 ≥ $0.30)', h1.length === 0 && h2.length === 0, `h1=${h1} h2=${h2}`)
  await step(3)
  ok('LC-15', 'at minute 3 BOTH legs hung up', hangups.includes(pb) && hangups.includes(lb), `hangups=${hangups.join(',')}`)
  ok('LC-16', 'user told wallet exhausted (vs.ivrCallEndedWalletExhausted)', sent.some(s => s.c === B), sent.map(s => s.t.slice(0, 120)).join(' | '))
  ok('LC-17', 'monitor interval cleared after disconnect', cleared.has(mon.h), '')

  // ── Monitor with main leg only (no transfer) — $0.40 wallet → disconnect at min 2 ──
  const C = '9000000613', callerC = '+18885550613'
  await walletOf.insertOne({ _id: C, usdIn: 0.4, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: C, val: { numbers: [{ phoneNumber: callerC, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const iC = intervals.length
  const rc = await voice.initiateOutboundIvrCall({ chatId: C, callerId: callerC, targetNumber: '+14155555001', audioUrl: 'https://cdn.invalid/a.mp3', activeKeys: ['1'], templateName: 't' })
  const pc = rc.callControlId || Object.keys(voice.outboundIvrCalls).slice(-1)[0]
  await hook('call.answered', { call_control_id: pc })
  const monC = monitorOf(iC)
  const stepC = async (m) => { voice.outboundIvrCalls[pc].answerTime = Date.now() - m * 60000 + 1000; hangups.length = 0; await monC.fn(); await sleep(80) }
  await stepC(1); const c1 = [...hangups]
  await stepC(2)
  ok('LC-18', 'single-leg $0.40: kept at min 1 ($0.25 left), cut at min 2 ($0.10 left)', c1.length === 0 && hangups.includes(pc), `m1=${c1} m2=${hangups}`)

  const failed = results.filter(r => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  await db.dropDatabase(); await client.close(); process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(3) })
