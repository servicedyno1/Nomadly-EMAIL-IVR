// Bulk IVR cancel = stop billing now (2026-10-23, @draggadem876 "balance still going down after I stopped").
// Live legs still ringing / playing the message are hung up on cancel; legs already transferring are kept.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx / Telegram stubbed — no real calls.
//   node js/tests/test_bulk_cancel_hangup_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'bulk_cancel_hangup_sandbox'
process.env.BULK_TELNYX_DIAL_GAP_MS = '0'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const bulk = require('../bulk-call-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }

const dials = [], hangups = []
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to) { const id = `v3:cancel-${++seq}`; dials.push({ id, from, to }); return { callControlId: id } },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} }, async gatherStop() { return {} },
  async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const sent = [], docs = []
const botStub = {
  sendMessage: async (chatId, text) => { sent.push({ chatId: String(chatId), text: String(text) }); return {} },
  sendDocument: async (chatId) => { docs.push({ chatId: String(chatId) }); return {} },
}
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const dialFor = (to) => dials.filter(d => d.to === to).slice(-1)[0]

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  const phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, null, walletOf, null)

  const chat = '9000000777', caller = '+18885550777'
  await walletOf.insertOne({ _id: chat, usdIn: 30, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: caller, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const L = (i) => `+1415557${String(1000 + i)}`
  const c0 = await bulk.createCampaign({ chatId: chat, callerId: caller, audioUrl: 'https://cdn.invalid/c.mp3', audioName: 'c', mode: 'transfer', transferNumber: '+17075550100', activeKeys: ['1'], concurrency: 3, provider: 'telnyx', leads: [0, 1, 2, 3].map(i => ({ number: L(i) })) })
  await bulk.startCampaign(c0.id)
  await waitFor(() => !!dialFor(L(0)) && !!dialFor(L(1)) && !!dialFor(L(2)))
  const [A, B, C] = [dialFor(L(0)).id, dialFor(L(1)).id, dialFor(L(2)).id]
  for (const [id, to] of [[A, L(0)], [B, L(1)], [C, L(2)]]) await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: caller, to })
  await hook('call.answered', { call_control_id: A })
  await hook('call.answered', { call_control_id: B })
  await hook('call.gather.ended', { call_control_id: A, digits: '1' }) // A presses 1 → transferring to the customer's line
  await sleep(200)
  ok('C00', 'setup: A transferring, B playing, C ringing', voice.outboundIvrCalls[A]?.phase === 'transferring' || !!voice.outboundIvrCalls[A]?.digitPressed, `A=${voice.outboundIvrCalls[A]?.phase}`)

  hangups.length = 0
  const r = await bulk.cancelCampaign(c0.id, 'Cancelled by user', { sendReport: false })
  ok('C01', 'cancel succeeds, 1 lead not dialled', r.success && r.notCalled === 1, JSON.stringify(r))
  ok('C02', 'B (playing message) and C (ringing) are hung up immediately', hangups.includes(B) && hangups.includes(C), `hangups=${hangups}`)
  ok('C03', 'A (already transferred to the customer) is NOT hung up', !hangups.includes(A), `hangups=${hangups}`)
  ok('C04', 'result reports ended=2, transferring=1', r.ended === 2 && r.transferring === 1, JSON.stringify(r))
  ok('C05', 'lead 3 never dialled', !dialFor(L(3)))

  await hook('call.hangup', { call_control_id: B, hangup_cause: 'normal_clearing', duration_secs: 20 })
  await hook('call.hangup', { call_control_id: C, hangup_cause: 'normal_clearing', duration_secs: 0 })
  await sleep(300)
  let c = await camps.findOne({ id: c0.id })
  ok('C06', 'campaign stays cancelled; B billed once (only time used)', c.status === 'cancelled' && (await ledger.countDocuments({ chatId: chat, description: { $regex: L(1).replace('+', '\\+') } })) === 1, `status=${c.status}`)
  ok('C07', 'final report waits for the transferred call', docs.filter(d => d.chatId === chat).length === 0)
  await hook('call.hangup', { call_control_id: A, hangup_cause: 'normal_clearing', duration_secs: 90 })
  await sleep(300)
  await bulk.sendCancelledReport(c0.id)
  c = await camps.findOne({ id: c0.id })
  ok('C08', 'after the transferred call ends → exactly one report, no in-flight leads', docs.filter(d => d.chatId === chat).length === 1 && !c.leads.some(l => ['calling', 'ringing', 'answered'].includes(l.status)), `reports=${docs.filter(d => d.chatId === chat).length}`)

  const r2 = await bulk.cancelCampaign(c0.id)
  ok('C09', 'second cancel → error, no extra hangups', !!r2.error && hangups.length === 2)

  for (const x of results) console.log(`| ${x.id} | ${x.name} | ${x.pass ? 'PASS' : 'FAIL'} | ${x.detail} |`)
  const failed = results.filter(x => !x.pass).length
  console.log(`\n${failed ? '❌' : '✅'} bulk cancel-hangup suite: ${results.length - failed} passed / ${failed} failed`)
  await client.close()
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
