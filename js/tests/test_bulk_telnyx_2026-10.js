// Phase 2 sandbox harness — Bulk IVR on Telnyx Call Control. SANDBOX MONGO ONLY.
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_bulk_telnyx_2026-10.js
// RUNTIME: the REAL bulk-call-service + REAL voice-service (Telnyx webhook state machine, AMD,
// hold-music bridge transfer, billing) + real wallet utils. Only the Telnyx HTTP API and Telegram are stubbed.
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p2_telnyx_sandbox'
process.env.BULK_TELNYX_DIAL_GAP_MS = '0'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const bulk = require('../bulk-call-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail })
const r2 = (n) => Math.round(n * 10000) / 10000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }

// ── Telnyx API stub ──
const dials = []          // { id, from, to }
const hangups = []
const failTo = {}         // to → error string
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to) {
    if (failTo[to]) return { error: failTo[to] }
    const id = `v3:cc-${++seq}`
    dials.push({ id, from, to })
    return { callControlId: id }
  },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const twilioDials = []
const twilioStub = { async makeOutboundCall(...a) { twilioDials.push(a); return { callSid: 'CAx' } }, async getSubAccount() { return { authToken: 't' } } }
const sent = []; const docs = []
const botStub = {
  sendMessage: async (chatId, text) => { sent.push({ chatId: String(chatId), text: String(text) }); return {} },
  sendDocument: async (chatId, p) => { docs.push({ chatId: String(chatId), p }); return {} },
}

const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const dialFor = (to) => dials.filter(d => d.to === to).slice(-1)[0]

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  const phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')

  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, twilioStub, walletOf, null)

  const A = '9000000500', callerA = '+18885550500'
  await walletOf.insertOne({ _id: A, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: A, val: { numbers: [{ phoneNumber: callerA, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  const L = (i) => `+1415555${String(1000 + i)}`

  // ── P2-01..03: Telnyx campaign has no sub-account, starts, dials through voice-service ──
  const campA = await bulk.createCampaign({ chatId: A, callerId: callerA, audioUrl: 'https://cdn.invalid/a.mp3', audioName: 'a.mp3', mode: 'report_only', activeKeys: ['1'], concurrency: 5, provider: 'telnyx', leads: Array.from({ length: 6 }, (_, i) => ({ number: L(i), name: `L${i}` })) })
  ok('P2-01', 'campaign stored with provider=telnyx and no Twilio sub-account', campA.provider === 'telnyx' && !campA.twilioSubAccountSid, `provider=${campA.provider}`)
  const bal0 = await balance(A)
  const start = await bulk.startCampaign(campA.id)
  ok('P2-02', 'startCampaign succeeds (no "requires Twilio" block)', start.success === true, JSON.stringify(start))
  await waitFor(() => dials.length === 5)
  ok('P2-03', 'concurrency 5 → exactly 5 Telnyx dials from the campaign caller ID', dials.length === 5 && dials.every(d => d.from === callerA) && twilioDials.length === 0, `dials=${dials.length} twilio=${twilioDials.length}`)
  const cA1 = await camps.findOne({ id: campA.id })
  ok('P2-04', 'dialled leads are calling with callSid = Telnyx call_control_id', cA1.leads.slice(0, 5).every((l, i) => l.status === 'calling' && l.callSid === dialFor(L(i)).id) && cA1.leads[5].status === 'pending', cA1.leads.map(l => l.status).join(','))
  const sess0 = voice.outboundIvrCalls[dialFor(L(0)).id]
  ok('P2-05', 'voice-service session carries campaignId / leadIndex / bulkMode=report_only', sess0 && sess0.campaignId === campA.id && sess0.leadIndex === 0 && sess0.bulkMode === 'report_only', sess0 ? `${sess0.campaignId}/${sess0.leadIndex}/${sess0.bulkMode}` : 'no session')

  // lead0: answered, pressed 1, 65 s → completed, key 1, 2 min billed
  const c0 = dialFor(L(0)).id
  await hook('call.initiated', { call_control_id: c0, direction: 'outgoing', from: callerA, to: L(0) })
  await hook('call.answered', { call_control_id: c0 })
  await hook('call.gather.ended', { call_control_id: c0, digits: '1' })
  await hook('call.hangup', { call_control_id: c0, hangup_cause: 'normal_clearing', duration_secs: 65 })
  // lead1: answered, AMD machine → we hang up → voicemail
  const c1 = dialFor(L(1)).id
  await hook('call.initiated', { call_control_id: c1, direction: 'outgoing', from: callerA, to: L(1) })
  await hook('call.answered', { call_control_id: c1 })
  await hook('call.machine.detection.ended', { call_control_id: c1, result: 'machine' })
  ok('P2-06', 'AMD machine on a bulk call → app hangs the call up', hangups.includes(c1), `hangups=${hangups.join(',')}`)
  await hook('call.hangup', { call_control_id: c1, hangup_cause: 'normal_clearing', duration_secs: 6 })
  // lead2: never answered, timeout → no_answer
  const c2 = dialFor(L(2)).id
  await hook('call.initiated', { call_control_id: c2, direction: 'outgoing', from: callerA, to: L(2) })
  await hook('call.hangup', { call_control_id: c2, hangup_cause: 'timeout', duration_secs: 0 })
  // lead3: user_busy → busy
  const c3 = dialFor(L(3)).id
  await hook('call.initiated', { call_control_id: c3, direction: 'outgoing', from: callerA, to: L(3) })
  await hook('call.hangup', { call_control_id: c3, hangup_cause: 'user_busy' })
  // lead4: unallocated_number → failed, not billed
  const c4 = dialFor(L(4)).id
  await hook('call.initiated', { call_control_id: c4, direction: 'outgoing', from: callerA, to: L(4) })
  await hook('call.hangup', { call_control_id: c4, hangup_cause: 'unallocated_number', duration_secs: 3 })
  // lead5 got dialled after the first completion
  await waitFor(() => !!dialFor(L(5)))
  ok('P2-07', 'next pending lead dialled when a slot frees (lead 5)', !!dialFor(L(5)) && dials.length === 6, `dials=${dials.length}`)
  const c5 = dialFor(L(5)).id
  await hook('call.initiated', { call_control_id: c5, direction: 'outgoing', from: callerA, to: L(5) })
  await hook('call.answered', { call_control_id: c5 })
  await hook('call.hangup', { call_control_id: c5, hangup_cause: 'normal_clearing', duration_secs: 10 })
  // duplicate hangup for lead0 must be ignored
  await bulk.onCallComplete(c0, { campaignId: campA.id, leadIndex: 0, answeredAt: new Date(), duration: 65, hangupCause: 'normal_clearing' })

  await waitFor(async () => (await camps.findOne({ id: campA.id })).status === 'completed')
  const cA = await camps.findOne({ id: campA.id })
  const st = cA.leads.map(l => l.status)
  ok('P2-08', 'lead outcomes: completed / voicemail / no_answer / busy / failed / completed', JSON.stringify(st) === JSON.stringify(['completed', 'voicemail', 'no_answer', 'busy', 'failed', 'completed']), JSON.stringify(st))
  ok('P2-09', 'lead0 keypress + duration recorded; lead1 answeredBy=machine', cA.leads[0].digitPressed === '1' && cA.leads[0].duration === 65 && cA.leads[1].answeredBy === 'machine', `digit=${cA.leads[0].digitPressed} dur=${cA.leads[0].duration} amd=${cA.leads[1].answeredBy}`)
  ok('P2-10', 'stats: answered 2 (humans), keyPressed 1, hungUp 1, noAnswer 1, busy 1, failed 1, voicemail 1', cA.stats.answered === 2 && cA.stats.keyPressed === 1 && cA.stats.hungUp === 1 && cA.stats.noAnswer === 1 && cA.stats.busy === 1 && cA.stats.failed === 1 && cA.stats.voicemail === 1 && cA.stats.completed === 6, JSON.stringify(cA.stats))
  const rowsA = await ledger.find({ chatId: A }).toArray()
  const chargedA = r2(rowsA.reduce((a, l) => a + Math.abs(Number(l.amount) || 0), 0))
  ok('P2-11', 'billed ONCE per call at $0.15/min (0.30+0.15+0.15+0.15+0.15 = $0.90); failed lead not billed; duplicate ignored', rowsA.length === 5 && chargedA === 0.9 && r2(bal0 - (await balance(A))) === 0.9, `rows=${rowsA.length} charged=$${chargedA} legs=${rowsA.map(l => Math.abs(l.amount)).join(',')}`)
  const ivrOutbound = await phoneLogs.countDocuments({ chatId: A, type: { $ne: 'BulkIVR' } })
  const bulkLogs = await phoneLogs.find({ chatId: A, type: 'BulkIVR' }).toArray()
  ok('P2-12', 'no double billing: zero unified IVR_Outbound charges, BulkIVR phoneLogs tagged provider=telnyx', bulkLogs.length === 5 && bulkLogs.every(l => l.provider === 'telnyx') && rowsA.every(l => /BulkIVR/.test(l.description || l.callType || 'BulkIVR')), `bulkLogs=${bulkLogs.length} otherLogs=${ivrOutbound}`)
  const report = sent.find(m => m.chatId === A && /Voicemail:/.test(m.text) && /Speechcue/.test(m.text))
  ok('P2-13', 'final report sent (incl. Voicemail line) + CSV document', !!report && docs.some(d => d.chatId === A), `report=${!!report} docs=${docs.length}`)
  ok('P2-14', 'per-call progress shows "Voicemail — hung up"', sent.some(m => m.chatId === A && /Voicemail — hung up/.test(m.text)), '')

  // ── P2-15: transfer mode with hold music → bridged transfer marks transferConnected ──
  const B = '9000000501', callerB = '+18885550501', xfer = '+14155559999'
  await walletOf.insertOne({ _id: B, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: B, val: { numbers: [{ phoneNumber: callerB, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const campB = await bulk.createCampaign({ chatId: B, callerId: callerB, audioUrl: 'https://cdn.invalid/b.mp3', audioName: 'b.mp3', mode: 'transfer', transferNumber: xfer, activeKeys: ['1'], concurrency: 1, holdMusic: true, provider: 'telnyx', leads: [{ number: L(20) }] })
  await bulk.startCampaign(campB.id)
  await waitFor(() => !!dialFor(L(20)))
  const b0 = dialFor(L(20)).id
  const sB = voice.outboundIvrCalls[b0]
  ok('P2-15', 'transfer campaign session: bulkMode=transfer, ivrNumber=transfer number, holdMusic on', sB && sB.bulkMode === 'transfer' && sB.ivrNumber === xfer && sB.holdMusic === true, sB ? `${sB.bulkMode}/${sB.ivrNumber}/${sB.holdMusic}` : 'none')
  await hook('call.initiated', { call_control_id: b0, direction: 'outgoing', from: callerB, to: L(20) })
  await hook('call.answered', { call_control_id: b0 })
  await hook('call.gather.ended', { call_control_id: b0, digits: '1' })
  await hook('call.speak.ended', { call_control_id: b0 })   // hold announcement done → music + dial transfer leg (5 s)
  await waitFor(() => !!dialFor(xfer), 8000)
  const leg = dialFor(xfer)?.id
  ok('P2-16', 'hold-music bridge transfer dials the transfer number from the caller ID', !!leg && dialFor(xfer).from === callerB, `leg=${leg}`)
  await hook('call.answered', { call_control_id: leg })
  await hook('call.bridged', { call_control_id: b0 })
  await hook('call.hangup', { call_control_id: b0, hangup_cause: 'normal_clearing', duration_secs: 95 })
  await waitFor(async () => (await camps.findOne({ id: campB.id })).status === 'completed')
  const cB = await camps.findOne({ id: campB.id })
  ok('P2-17', 'transferred lead → completed, transferred=Yes, transferConnected=Yes, 2 min billed', cB.leads[0].status === 'completed' && cB.leads[0].transferred === true && cB.leads[0].transferConnected === true && cB.stats.transferred === 1 && (await ledger.countDocuments({ chatId: B })) === 1, JSON.stringify({ s: cB.leads[0].status, t: cB.leads[0].transferred, tc: cB.leads[0].transferConnected }))

  // ── P2-18: plain Telnyx dial error → lead failed, not billed, next lead dialled ──
  const C = '9000000502', callerC = '+18885550502'
  await walletOf.insertOne({ _id: C, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: C, val: { numbers: [{ phoneNumber: callerC, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  failTo[L(30)] = 'Invalid destination number'
  const campC = await bulk.createCampaign({ chatId: C, callerId: callerC, audioUrl: 'https://cdn.invalid/c.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(30) }, { number: L(31) }] })
  await bulk.startCampaign(campC.id)
  await waitFor(() => !!dialFor(L(31)))
  const cC = await camps.findOne({ id: campC.id })
  ok('P2-18', 'dial error → lead failed (not billed) and the next lead is dialled', cC.leads[0].status === 'failed' && !!dialFor(L(31)) && (await ledger.countDocuments({ chatId: C })) === 0, `lead0=${cC.leads[0].status} lead1Dialled=${!!dialFor(L(31))}`)

  // ── P2-19: Telnyx account out of funds → whole campaign ends, nothing else dialled/billed ──
  const D = '9000000503', callerD = '+18885550503'
  await walletOf.insertOne({ _id: D, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: D, val: { numbers: [{ phoneNumber: callerD, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  failTo[L(40)] = 'The account has insufficient funds to place this call'
  const campD = await bulk.createCampaign({ chatId: D, callerId: callerD, audioUrl: 'https://cdn.invalid/d.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(40) }, { number: L(41) }, { number: L(42) }] })
  await bulk.startCampaign(campD.id)
  await waitFor(async () => (await camps.findOne({ id: campD.id })).status === 'cancelled')
  const cD = await camps.findOne({ id: campD.id })
  ok('P2-19', 'provider account error ends campaign (cancelled "provider suspended"), leads not called, $0', cD.status === 'cancelled' && cD.cancelledReason === 'provider suspended' && cD.leads.every(l => l.status === 'pending' && l.notCalled) && !dialFor(L(41)) && (await ledger.countDocuments({ chatId: D })) === 0, `status=${cD.status} reason=${cD.cancelledReason}`)

  // ── P2-20/21: legacy Twilio campaign while TWILIO_ENABLED=false → "being upgraded", no Twilio dial ──
  const E = '9000000504'
  await walletOf.insertOne({ _id: E, usdIn: 50, usdOut: 0 })
  await camps.insertOne({ id: 'p2-legacy-twilio', chatId: E, callerId: '+18005550504', audioUrl: 'x', audioName: 'x', mode: 'report_only', activeKeys: ['1'], concurrency: 1, twilioSubAccountSid: 'ACx', twilioSubAccountToken: 't', leads: [{ index: 0, number: L(50), status: 'pending' }], stats: { total: 1, completed: 0 }, status: 'scheduled', scheduledFor: new Date(Date.now() - 1000), createdAt: new Date() })
  const launched = await bulk.launchDueScheduledCampaigns()
  const cE = await camps.findOne({ id: 'p2-legacy-twilio' })
  ok('P2-20', 'scheduled legacy Twilio campaign → cancelled "Twilio number being upgraded", 0 Twilio dials', cE.status === 'cancelled' && cE.cancelledReason === 'Twilio number being upgraded' && twilioDials.length === 0 && launched.some(l => l.id === 'p2-legacy-twilio' && l.error), `status=${cE.status} reason=${cE.cancelledReason}`)
  ok('P2-21', 'owner gets the friendly "Number Being Upgraded" message', sent.some(m => m.chatId === E && /Number Being Upgraded/.test(m.text)), '')
  await camps.insertOne({ id: 'p2-legacy-running', chatId: E, callerId: '+18005550504', audioUrl: 'x', mode: 'report_only', activeKeys: ['1'], concurrency: 1, twilioSubAccountSid: 'ACx', leads: [{ index: 0, number: L(51), status: 'pending' }], stats: { total: 1, completed: 0 }, status: 'running', startedAt: new Date(), createdAt: new Date() })
  await bulk.recoverRunningCampaigns()
  const cE2 = await camps.findOne({ id: 'p2-legacy-running' })
  ok('P2-22', 'restart recovery: running legacy Twilio campaign cancelled as being upgraded, no dial', cE2.status === 'cancelled' && cE2.cancelledReason === 'Twilio number being upgraded' && twilioDials.length === 0, `status=${cE2.status}`)

  console.log('\n| Journey | Check | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter((r) => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
