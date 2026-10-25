// Sandbox harness — Telnyx line-limit redial + AI agent campaigns / inbound billing. SANDBOX MONGO ONLY.
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_bulk_line_limit_ai_2026-10.js
// Real bulk-call-service + voice-service + ai-agent store/billing; Telnyx HTTP, OpenAI and Telegram are stubbed.
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p4_line_ai_sandbox'
process.env.BULK_TELNYX_DIAL_GAP_MS = '0'
process.env.BULK_LINE_RETRY_MIN_MS = '150'
process.env.BULK_LINE_RETRY_MAX_MS = '300'
process.env.TWILIO_ENABLED = 'false'
process.env.APP_OPEN_API_KEY = 'sk-test-stub'
process.env.TELNYX_API_KEY = 'stub'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const axios = require('axios')
const axiosCalls = []
axios.post = async (url, body) => {
  axiosCalls.push({ url, body })
  if (url.includes('chat/completions')) return { data: { choices: [{ message: { content: JSON.stringify({ summary: 'Caller wants a cleaning.', outcome: 'interested' }) } }] } }
  return { data: { data: { call_control_id: `ai-cc-${axiosCalls.length}` } } }
}
const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const bulk = require('../bulk-call-service.js')
const ai = require('../ai-agent')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail })
const r2 = (n) => Math.round(n * 10000) / 10000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }

const dials = []
let limitLeft = {} // to → how many more times Telnyx says "channel limit"
let seq = 0
const telnyxStub = {
  isLineLimitError: require('../telnyx-service').isLineLimitError,
  async createOutboundCall(from, to) {
    if (limitLeft[to] > 0) { limitLeft[to]--; dials.push({ refused: true, to }); return { error: 'User channel limit exceeded', code: '90041', status: 403 } }
    const id = `v3:cc-${++seq}`
    dials.push({ id, from, to })
    return { callControlId: id }
  },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} }, async gatherStop() { return {} },
  async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} }, async hangupCall() { return {} },
}
const botStub = { sendMessage: async () => ({}), sendDocument: async () => ({}) }
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const okDials = (to) => dials.filter(d => d.to === to && !d.refused)

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs: db.collection('phoneLogs'), telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, {}, walletOf, null)
  ai.init({ db, walletOf, bot: botStub, selfUrl: 'https://sandbox.invalid', voiceService: voice, log: () => {} })

  const A = '9000000600', callerA = '+18885550600'
  await walletOf.insertOne({ _id: A, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: A, val: { numbers: [{ phoneNumber: callerA, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  const L = (i) => `+1415555${String(2000 + i)}`

  // ── LL: line limit at dial time → re-queued, redialed, never failed ──
  limitLeft = { [L(0)]: 3 }
  const c1 = await bulk.createCampaign({ chatId: A, callerId: callerA, audioUrl: 'https://cdn.invalid/a.mp3', audioName: 'a', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(0) }, { number: L(1) }] })
  await bulk.startCampaign(c1.id)
  await waitFor(async () => (await camps.findOne({ id: c1.id })).leads[0].lineRetries >= 1, 2000)
  const mid = await camps.findOne({ id: c1.id })
  ok('LL-01', 'refused dial (90041) → lead back to pending, not failed', mid.leads[0].status === 'pending' || okDials(L(0)).length === 1, `status=${mid.leads[0].status} retries=${mid.leads[0].lineRetries}`)
  ok('LL-02', 'refused dial does not move on to the next lead (lines are full)', okDials(L(1)).length === 0, `L1 dials=${okDials(L(1)).length}`)
  await waitFor(() => okDials(L(0)).length === 1, 4000)
  const c1b = await camps.findOne({ id: c1.id })
  ok('LL-03', 'lead redialed automatically once a line frees up (after 3 refusals)', okDials(L(0)).length === 1 && c1b.leads[0].lineRetries === 3 && c1b.leads[0].status === 'calling' && !c1b.leads[0].waitingForLine, `retries=${c1b.leads[0].lineRetries} status=${c1b.leads[0].status}`)
  ok('LL-04', 'no lead ever marked failed and nothing billed for refused dials', c1b.leads.every(l => l.status !== 'failed') && (await balance(A)) === 50, `bal=${await balance(A)}`)

  // ── LL: SIP 403 on hangup (carrier line limit) → re-queued + redialed, not billed ──
  const cc0 = okDials(L(0))[0].id
  await hook('call.initiated', { call_control_id: cc0, direction: 'outgoing', from: callerA, to: L(0) })
  await hook('call.hangup', { call_control_id: cc0, hangup_cause: 'call_rejected', sip_hangup_cause: '403', duration_secs: 0 })
  await waitFor(() => okDials(L(0)).length === 2, 3000)
  const c1c = await camps.findOne({ id: c1.id })
  ok('LL-05', 'SIP 403 before answer → lead re-queued and redialed (not busy/failed)', okDials(L(0)).length === 2 && ['calling', 'pending'].includes(c1c.leads[0].status), `dials=${okDials(L(0)).length} status=${c1c.leads[0].status}`)
  ok('LL-06', 'SIP 403 refusal not billed', (await balance(A)) === 50, `bal=${await balance(A)}`)
  const cc1 = okDials(L(0))[1].id
  await hook('call.initiated', { call_control_id: cc1, direction: 'outgoing', from: callerA, to: L(0) })
  await hook('call.answered', { call_control_id: cc1 })
  await hook('call.hangup', { call_control_id: cc1, hangup_cause: 'normal_clearing', duration_secs: 30 })
  await waitFor(() => okDials(L(1)).length === 1, 3000)
  const cc2 = okDials(L(1))[0].id
  await hook('call.initiated', { call_control_id: cc2, direction: 'outgoing', from: callerA, to: L(1) })
  await hook('call.hangup', { call_control_id: cc2, hangup_cause: 'timeout', duration_secs: 0 })
  await waitFor(async () => (await camps.findOne({ id: c1.id })).status === 'completed', 3000)
  const c1d = await camps.findOne({ id: c1.id })
  ok('LL-07', 'campaign completes normally after waiting for lines', c1d.status === 'completed' && c1d.leads[0].status === 'completed', `status=${c1d.status} leads=${c1d.leads.map(l => l.status).join(',')}`)
  ok('LL-08', 'ordinary SIP 403 on an ANSWERED call is a normal completion', c1d.leads[0].status === 'completed', '')

  // ── AI: campaign with do-not-call, calling hours, line limit and $0.20/started-minute billing ──
  const agent = await ai.store.createAgent(A, { name: 'Ava', goal: 'Book cleanings for the dental clinic.', businessName: 'Sunrise Dental' })
  await ai.store.addDnc(A, L(11), 'manual')
  const realCallable = ai.hours.callableNow
  ai.hours.callableNow = (n) => n !== L(12)
  const aiDials = []
  let aiLimit = 1
  const realDial = ai.dialLead
  ai.dialLead = async (camp, lead) => {
    if (lead.number === L(10) && aiLimit-- > 0) { aiDials.push({ refused: true, to: lead.number }); return { error: 'User channel limit exceeded', lineLimit: true } }
    const id = `ai-cc-${aiDials.length + 1}`; aiDials.push({ id, to: lead.number, agentId: camp.agentId }); return { callControlId: id }
  }
  const c2 = await bulk.createCampaign({ chatId: A, callerId: callerA, audioName: 'AI agent: Ava', mode: 'ai', agentId: agent.id, agentName: 'Ava', concurrency: 3, provider: 'telnyx', leads: [{ number: L(10) }, { number: L(11) }, { number: L(12) }] })
  ok('AI-01', 'AI campaign stored with mode=ai + agent', c2.mode === 'ai' && c2.agentId === agent.id, `${c2.mode}/${c2.agentName}`)
  await bulk.startCampaign(c2.id)
  await waitFor(() => aiDials.some(d => d.id && d.to === L(10)), 3000)
  const a1 = await camps.findOne({ id: c2.id })
  ok('AI-02', 'AI dial uses the campaign agent; refused once for lines then redialed', aiDials.filter(d => d.to === L(10)).length === 2 && aiDials.find(d => d.id).agentId === agent.id, JSON.stringify(aiDials))
  ok('AI-03', 'do-not-call lead skipped, never dialed', a1.leads[1].status === 'skipped' && !aiDials.some(d => d.to === L(11)), `status=${a1.leads[1].status}`)
  ok('AI-04', 'lead outside 8am–9pm local time waits (pending, not dialed)', a1.leads[2].status === 'pending' && !aiDials.some(d => d.to === L(12)), `status=${a1.leads[2].status}`)
  const bal1 = await balance(A)
  await bulk.onCallComplete('ai-cc-2', { campaignId: c2.id, leadIndex: 0, duration: 75, answeredAt: new Date(), ai: { outcome: 'interested', summary: 'Wants a cleaning Friday.', callId: 'x' }, aiBilling: { minutesBilled: 2, charge: 0.4, rate: 0.2 } })
  const a2 = await camps.findOne({ id: c2.id })
  ok('AI-05', '75 s AI call billed 2 started minutes × $0.20 = $0.40', r2(bal1 - await balance(A)) === 0.4, `charged=${r2(bal1 - await balance(A))}`)
  const led = await ledger.findOne({ chatId: A, type: 'ai_agent_call' }) || await ledger.findOne({ type: 'ai_agent_call' })
  ok('AI-06', 'wallet ledger row type ai_agent_call', !!led, led ? led.description || '' : 'none')
  ok('AI-07', 'lead keeps AI outcome + summary; stats count interested + skipped', a2.leads[0].ai?.outcome === 'interested' && a2.stats.interested === 1 && a2.stats.skipped === 1, JSON.stringify(a2.stats))
  ok('AI-08', 'campaign keeps running while a lead waits for calling hours', a2.status === 'running', a2.status)
  ai.hours.callableNow = () => true
  await bulk.fireNextBatch(c2.id)
  await waitFor(() => aiDials.some(d => d.to === L(12) && d.id), 2000)
  ok('AI-09', 'once inside calling hours the waiting lead is dialed', aiDials.some(d => d.to === L(12) && d.id), '')
  await bulk.onCallComplete(aiDials.find(d => d.to === L(12)).id, { campaignId: c2.id, leadIndex: 2, duration: 0, hangupCause: 'timeout' })
  await waitFor(async () => (await camps.findOne({ id: c2.id })).status === 'completed', 2000)
  const bal2 = await balance(A)
  ok('AI-10', 'unanswered AI lead is free and campaign completes', (await camps.findOne({ id: c2.id })).status === 'completed' && r2(bal1 - 0.4) === bal2, `bal=${bal2}`)
  ai.hours.callableNow = realCallable; ai.dialLead = realDial

  // ── Hours module (TCPA) ──
  const { DateTime } = require('luxon')
  const at = (iso) => DateTime.fromISO(iso, { zone: 'utc' })
  ok('HR-01', 'NY number callable at 14:00 UTC (10am ET), not at 02:00 UTC (10pm ET)', ai.hours.callableNow('+12125550100', at('2026-10-20T14:00:00')) && !ai.hours.callableNow('+12125550100', at('2026-10-21T02:00:00')), '')
  ok('HR-02', 'LA number not callable at 14:00 UTC (7am PT)', !ai.hours.callableNow('+14155550100', at('2026-10-20T14:00:00')), '')
  ok('HR-03', 'Paris number callable at 09:00 UTC (11am CEST)', ai.hours.callableNow('+33612345678', at('2026-10-20T09:00:00')), '')

  // ── Inbound AI receptionist: plan gate + per-started-minute billing ──
  const B = '9000000601', numB = '+18885550601'
  await walletOf.insertOne({ _id: B, usdIn: 5, usdOut: 0 })
  const agentB = await ai.store.createAgent(B, { name: 'Max', goal: 'Answer calls for the shop and take messages.' })
  const starter = { phoneNumber: numB, plan: 'starter', status: 'active', features: { aiAgent: { enabled: true, agentId: agentB.id } } }
  ok('IN-01', 'Starter plan number: AI agent does not answer (normal routing)', (await ai.tryInbound({ payload: { call_control_id: 'in-1', from: '+14155550111' }, chatId: B, num: starter })) === false, '')
  const pro = { ...starter, plan: 'pro' }
  ok('IN-01b', 'Pro plan number: AI agent does not answer (AI voice agent is Business-only)', (await ai.tryInbound({ payload: { call_control_id: 'in-1b', from: '+14155550111' }, chatId: B, num: pro })) === false && !axiosCalls.some(c => c.url.includes('/calls/in-1b/')), '')
  const business = { ...starter, plan: 'business' }
  const answered = await ai.tryInbound({ payload: { call_control_id: 'in-2', from: '+14155550111' }, chatId: B, num: business })
  ok('IN-02', 'Business plan number: AI agent answers with a bidirectional media stream', answered === true && axiosCalls.some(c => c.url.includes('/calls/in-2/actions/answer') && c.body.stream_bidirectional_mode === 'rtp'), '')
  ok('IN-03', 'live AI call is owned by the AI module (webhooks routed to it)', ai.owns('in-2', {}), '')
  const realNow = Date.now
  Date.now = () => realNow() + 61000
  await ai.onWebhook('call.hangup', { call_control_id: 'in-2', hangup_cause: 'normal_clearing' })
  Date.now = realNow
  await sleep(200)
  ok('IN-04', '61 s inbound AI call → 2 started minutes × $0.20 = $0.40 from the wallet', (await balance(B)) === 4.6, `bal=${await balance(B)}`)
  const call = await db.collection('aiCalls').findOne({ chatId: B, direction: 'inbound' })
  ok('IN-05', 'AI call record saved with minutes + charge', call && call.minutesBilled === 2 && call.charge === 0.4, call ? `${call.minutesBilled}/${call.charge}` : 'none')
  await walletOf.updateOne({ _id: B }, { $set: { usdIn: 0.1, usdOut: 0 } })
  ok('IN-06', 'wallet under $0.20 → AI agent does not answer', (await ai.tryInbound({ payload: { call_control_id: 'in-3', from: '+14155550111' }, chatId: B, num: business })) === false, '')

  console.log('\n| Journey | Check | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter((r) => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
