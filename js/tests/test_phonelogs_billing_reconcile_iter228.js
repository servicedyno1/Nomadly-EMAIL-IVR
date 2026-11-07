// iter228 — Billing reconciliation: every billed SIP / IVR hangup writes a phoneLogs row with
// chatId, minutesBilled, planMinUsed, callControlId (+charge / autoRouted / campaignId).
// SANDBOX MONGO ONLY (127.0.0.1:27999). Telnyx API + Telegram bot stubbed — NO real calls.
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_phonelogs_billing_reconcile_iter228.js
// Loads the REAL voice-service.js source in its own module scope with a few test-only exports
// appended (autoRoutedPendingBilling is not exported by the module).
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'iter228_phonelogs_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const fs = require('fs'), path = require('path'), Module = require('module')
const file = path.join(__dirname, '..', 'voice-service.js')
const src = fs.readFileSync(file, 'utf8') + `
module.exports.__t = { autoRoutedPendingBilling, handleCallHangup, handleOutboundIvrHangup, CALL_CONNECTION_FEE, _initiatedCalls }
`
const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file))
m._compile(src, file)
const voice = m.exports
const T = voice.__t

const { MongoClient } = require('mongodb')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => { results.push({ id, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${detail}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const r2 = (n) => Math.round(n * 100) / 100

const hangups = []
const telnyxStub = new Proxy({ async hangupCall(id) { hangups.push(id); return {} }, async isCallAlive() { return null } }, {
  get: (t, k) => (k in t ? t[k] : async () => ({})),
})
const sent = []
const botStub = { sendMessage: async (c, t) => { sent.push({ c: String(c), t: String(t) }); return {} }, sendDocument: async () => ({}) }
const hook = (event_type, payload) => { if (payload.call_control_id) T._initiatedCalls.add(payload.call_control_id); return voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {}, status() { return this }, send() {}, json() {} }) }

// Track any thrown ReferenceError anywhere
const errs = []
process.on('unhandledRejection', e => { errs.push(e); console.log('UNHANDLED', e && e.stack) })

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  // spy on insertOne
  const inserted = []
  const _ins = phoneLogs.insertOne.bind(phoneLogs)
  phoneLogs.insertOne = (doc, ...a) => { inserted.push(doc); return _ins(doc, ...a) }
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const bal = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  const FEE = T.CALL_CONNECTION_FEE
  console.log(`CALL_CONNECTION_FEE=${FEE}`)

  const A = '9000000228', numA = '+18885550228', sipA = 'gencredTEST228'
  await walletOf.insertOne({ _id: A, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: A, val: { numbers: [{ phoneNumber: numA, status: 'active', plan: 'starter', provider: 'telnyx', telnyxSipUsername: sipA, minutesUsed: 0 }] } })

  // ── (a) Deferred auto-routed path ──
  const ccA = 'v3:TEST_autoroute_1'
  T.autoRoutedPendingBilling[ccA] = { sipUsername: sipA, fromClean: numA, destination: '+14155550101', startedAt: new Date(Date.now() - 130000), reason: 'rate_limit' }
  const b0 = await bal(A)
  await hook('call.hangup', { call_control_id: ccA, hangup_cause: 'normal_clearing', duration_secs: 125 })
  await sleep(400)
  const la = inserted.find(d => d.callControlId === ccA)
  ok('AR-01', 'deferred auto-route hangup writes phoneLogs row', !!la, JSON.stringify(la))
  ok('AR-02', 'type=outbound_sip, phoneNumber=caller num, from=destination arg', la && la.type === 'outbound_sip' && la.phoneNumber === numA && la.from === '+14155550101', la && `${la.type} ${la.phoneNumber} ${la.from}`)
  ok('AR-03', 'chatId (string), minutesBilled=3, duration=125, autoRouted=true', la && la.chatId === A && la.minutesBilled === 3 && la.duration === 125 && la.autoRouted === true, la && `${la.chatId} ${la.minutesBilled} ${la.duration} ${la.autoRouted}`)
  ok('AR-04', 'planMinUsed numeric + charge numeric', la && typeof la.planMinUsed === 'number' && typeof la.charge === 'number', la && `planMinUsed=${la.planMinUsed} charge=${la.charge}`)
  const persistedA = await phoneLogs.findOne({ callControlId: ccA })
  ok('AR-05', 'row persisted in Mongo', !!persistedA, '')
  ok('AR-06', 'pending entry removed after hangup', !T.autoRoutedPendingBilling[ccA], '')
  const b1 = await bal(A)
  console.log(`   wallet charged on deferred path: $${r2(b0 - b1)} (log charge=$${la && la.charge})`)
  // duplicate hangup must not write a second row
  await hook('call.hangup', { call_control_id: ccA, hangup_cause: 'normal_clearing', duration_secs: 125 })
  await sleep(200)
  ok('AR-07', 'duplicate hangup → no second phoneLogs row', inserted.filter(d => d.callControlId === ccA).length === 1, `rows=${inserted.filter(d => d.callControlId === ccA).length}`)

  // ── (a2) Deferred path with unknown owner → no log, no throw ──
  const ccU = 'v3:TEST_autoroute_unknown'
  T.autoRoutedPendingBilling[ccU] = { sipUsername: 'nobodyTEST', fromClean: '+10000000000', destination: '+14155550102', startedAt: new Date(), reason: 'hard_block' }
  await hook('call.hangup', { call_control_id: ccU, duration_secs: 30 })
  await sleep(200)
  ok('AR-08', 'unidentified owner → no phoneLogs row (not billed)', !inserted.find(d => d.callControlId === ccU), '')

  // ── (b) Normal SIP outbound path ──
  const numDoc = (await phoneNumbersOf.findOne({ _id: A })).val.numbers[0]
  const ccS = 'v3:TEST_sip_out_1'
  voice.activeCalls[ccS] = { chatId: A, num: numDoc, from: numA, to: '+14155550103', startedAt: new Date(Date.now() - 70000), phase: 'outbound_telnyx', direction: 'outgoing' }
  await hook('call.hangup', { call_control_id: ccS, hangup_cause: 'normal_clearing', duration_secs: 61 })
  await sleep(400)
  const ls = inserted.find(d => d.callControlId === ccS)
  ok('SIP-01', 'normal SIP hangup writes outbound_sip row', ls && ls.type === 'outbound_sip' && ls.phoneNumber === numA && ls.from === '+14155550103', JSON.stringify(ls))
  ok('SIP-02', 'chatId/minutesBilled=2/planMinUsed/callControlId present', ls && ls.chatId === A && ls.minutesBilled === 2 && typeof ls.planMinUsed === 'number' && ls.callControlId === ccS, ls && `${ls.chatId} ${ls.minutesBilled} ${ls.planMinUsed}`)
  ok('SIP-03', 'charge numeric, no autoRouted flag, no esim', ls && typeof ls.charge === 'number' && !('autoRouted' in ls) && !('esim' in ls), ls && `charge=${ls.charge}`)

  // test call → charge 0, still logged
  const ccT = 'v3:TEST_sip_testcall'
  voice.activeCalls[ccT] = { chatId: A, num: numDoc, from: numA, to: '+14155550104', startedAt: new Date(), phase: 'outbound_telnyx', direction: 'outgoing', isTestCall: true }
  await hook('call.hangup', { call_control_id: ccT, duration_secs: 20 })
  await sleep(300)
  const lt = inserted.find(d => d.callControlId === ccT)
  ok('SIP-04', 'free test call → row with charge=0, planMinUsed=0', lt && lt.charge === 0 && lt.planMinUsed === 0 && lt.minutesBilled === 1, JSON.stringify(lt))

  // eSIM mobile line → esim field
  const ccE = 'v3:TEST_sip_esim'
  voice.activeCalls[ccE] = { chatId: A, num: { ...numDoc, mobileLine: 'TEST_ml_1' }, from: numA, to: '+14155550105', startedAt: new Date(), phase: 'outbound_telnyx', direction: 'outgoing' }
  await hook('call.hangup', { call_control_id: ccE, duration_secs: 5 })
  await sleep(300)
  const le = inserted.find(d => d.callControlId === ccE)
  ok('SIP-05', 'mobile line call → esim field kept + new fields', le && le.esim === 'TEST_ml_1' && le.chatId === A && le.minutesBilled === 1, JSON.stringify(le))

  // ── (c) Outbound IVR (non-bulk) ──
  const ccI = 'v3:TEST_ivr_1'
  voice.outboundIvrCalls[ccI] = { chatId: A, callerId: numA, targetNumber: '+14155550106', phase: 'playing', answerTime: Date.now() - 40000, startTime: Date.now() - 45000, digitPressed: null }
  const r1 = await hook('call.hangup', { call_control_id: ccI, hangup_cause: 'normal_clearing', duration_secs: 40 })
  await sleep(400)
  const li = inserted.find(d => d.callControlId === ccI)
  ok('IVR-01', 'quick IVR hangup → outbound_ivr row with chatId+callControlId', li && li.type === 'outbound_ivr' && li.chatId === A && li.phoneNumber === numA && li.from === '+14155550106', JSON.stringify(li))
  ok('IVR-02', 'IVR session cleaned up', !voice.outboundIvrCalls[ccI], '')

  // ── (d) Outbound IVR bulk ──
  const ccB = 'v3:TEST_ivr_bulk_1'
  voice.outboundIvrCalls[ccB] = { chatId: A, callerId: numA, targetNumber: '+14155550107', phase: 'playing', answerTime: Date.now() - 20000, campaignId: 'TEST_campaign_228', leadIndex: 0 }
  await hook('call.hangup', { call_control_id: ccB, hangup_cause: 'normal_clearing', duration_secs: 20 })
  await sleep(400)
  const lb = inserted.find(d => d.callControlId === ccB)
  ok('IVR-03', 'bulk IVR hangup → outbound_ivr_bulk row with chatId+callControlId+campaignId', lb && lb.type === 'outbound_ivr_bulk' && lb.chatId === A && lb.campaignId === 'TEST_campaign_228', JSON.stringify(lb))

  // session without chatId → chatId '' (no 'undefined' string)
  const ccN = 'v3:TEST_ivr_nochat'
  voice.outboundIvrCalls[ccN] = { callerId: '+19999999999', targetNumber: '+14155550108', phase: 'ringing', isTrial: true }
  await hook('call.hangup', { call_control_id: ccN, hangup_cause: 'timeout' })
  await sleep(300)
  const ln = inserted.find(d => d.callControlId === ccN)
  ok('IVR-04', 'IVR session missing chatId → chatId="" (not "undefined")', ln && ln.chatId === '', JSON.stringify(ln && ln.chatId))

  const refErr = errs.filter(e => e instanceof ReferenceError || /is not defined/.test(String(e && e.message)))
  ok('ERR-01', 'no ReferenceError / unhandled rejections', refErr.length === 0 && errs.length === 0, `errs=${errs.map(e => e.message).join('; ')}`)

  await db.dropDatabase(); await client.close()
  const pass = results.filter(r => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length} passed`)
  process.exit(pass === results.length ? 0 : 1)
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(3) })
