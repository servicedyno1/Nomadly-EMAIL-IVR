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
process.env.BULK_VM_BEEP_WAIT_MS = '1500'
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
const gathers = [], gatherStops = [], playbacks = []
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to, webhookUrl, connId, opts) {
    if (failTo[to]) return { error: failTo[to] }
    const id = `v3:cc-${++seq}`
    dials.push({ id, from, to, amd: opts?.answering_machine_detection || 'detect' })
    return { callControlId: id }
  },
  async gatherDTMFWithAudio(id) { gathers.push(id); return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async gatherStop(id) { gatherStops.push(id); return {} },
  async speakOnCall() { return {} }, async playbackStart(id, url) { playbacks.push({ id, url }); return /fail/.test(url) ? null : {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const twilioDials = []
const twilioStub = { async makeOutboundCall(...a) { twilioDials.push(a); return { callSid: 'CAx' } }, async getSubAccount() { return { authToken: 't' } } }
const sent = []; const docs = []
const sentOpts = []
const botStub = {
  sendMessage: async (chatId, text, opts) => { sent.push({ chatId: String(chatId), text: String(text) }); sentOpts.push({ chatId: String(chatId), text: String(text), opts }); return {} },
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


  // ━━━ Feature: international pricing (destination-based, same as Quick IVR) ━━━
  const I = '9000000510', callerI = '+18885550510', uk = '+447700900123'
  await walletOf.insertOne({ _id: I, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: I, val: { numbers: [{ phoneNumber: callerI, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const est = bulk.estimateLeadsCost([{ number: L(60) }, { number: L(61) }, { number: uk }])
  ok('P3-01', 'estimate splits US/CA vs international: 2×$0.15 + 1×$0.50 = $0.80, rate line mentions both', est.domestic === 2 && est.intl === 1 && est.total === 0.8 && /\$0\.15\/min US\/CA · \$0\.50\/min international/.test(est.rateLine), JSON.stringify(est))
  const campI = await bulk.createCampaign({ chatId: I, callerId: callerI, audioUrl: 'https://cdn.invalid/i.mp3', mode: 'report_only', concurrency: 2, provider: 'telnyx', leads: [{ number: L(60) }, { number: uk }] })
  await bulk.startCampaign(campI.id)
  await waitFor(() => !!dialFor(uk) && !!dialFor(L(60)))
  ok('P3-02', 'start message shows the split rate line', sent.some(m => m.chatId === I && /international \(1 lead\)/.test(m.text)), '')
  for (const [to, secs] of [[L(60), 70], [uk, 70]]) {
    const id = dialFor(to).id
    await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: callerI, to })
    await hook('call.answered', { call_control_id: id })
    await hook('call.hangup', { call_control_id: id, hangup_cause: 'normal_clearing', duration_secs: secs })
  }
  await waitFor(async () => (await camps.findOne({ id: campI.id })).status === 'completed')
  const rowsI = (await ledger.find({ chatId: I }).toArray()).map(l => r2(Math.abs(l.amount))).sort()
  ok('P3-03', '70 s US lead billed 2×$0.15 = $0.30; 70 s UK lead billed 2×$0.50 = $1.00', JSON.stringify(rowsI) === JSON.stringify([0.3, 1]), JSON.stringify(rowsI))

  // ━━━ Feature: campaign controls (pause / resume / cancel) ━━━
  const P = '9000000520', callerP = '+18885550520'
  await walletOf.insertOne({ _id: P, usdIn: 25, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: P, val: { numbers: [{ phoneNumber: callerP, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const campP = await bulk.createCampaign({ chatId: P, callerId: callerP, audioUrl: 'https://cdn.invalid/p.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [0, 1, 2, 3].map(i => ({ number: L(70 + i) })) })
  await bulk.startCampaign(campP.id)
  await waitFor(() => !!dialFor(L(70)))
  const startMsg = sent.find(m => m.chatId === P && /Campaign Started/.test(m.text))
  ok('P4-01', 'campaign controls helper: running → Pause + Cancel; paused → Resume + Cancel', JSON.stringify(bulk.campaignControls({ id: 'x', status: 'running' }).flat().map(b => b.callback_data)) === JSON.stringify(['bulk_pause:x', 'bulk_cancel:x', 'bulk_view:x']) && JSON.stringify(bulk.campaignControls({ id: 'x', status: 'paused' }).flat().map(b => b.callback_data)) === JSON.stringify(['bulk_resume:x', 'bulk_cancel:x', 'bulk_view:x']), '')
  const pz = await bulk.pauseCampaign(campP.id)
  const p0 = dialFor(L(70)).id
  await hook('call.initiated', { call_control_id: p0, direction: 'outgoing', from: callerP, to: L(70) })
  await hook('call.hangup', { call_control_id: p0, hangup_cause: 'timeout' })
  await sleep(300)
  const cP1 = await camps.findOne({ id: campP.id })
  ok('P4-02', 'pause: status paused (reason user), in-flight lead settles, NO next dial', pz.success && cP1.status === 'paused' && cP1.pausedReason === 'user' && cP1.leads[0].status === 'no_answer' && !dialFor(L(71)), `status=${cP1.status} lead0=${cP1.leads[0].status} lead1Dialled=${!!dialFor(L(71))}`)
  ok('P4-03', 'pause again → error (not running)', !!(await bulk.pauseCampaign(campP.id)).error, '')
  await walletOf.updateOne({ _id: P }, { $set: { usdOut: 24.95 } })   // wallet → $0.05 (after the $0.15 no-answer charge it's below)
  const rz1 = await bulk.resumeCampaign(campP.id)
  ok('P4-04', 'resume with low wallet → refused with a top-up message, stays paused, nothing dialled', rz1.lowBalance && /Top up/.test(rz1.error) && (await camps.findOne({ id: campP.id })).status === 'paused' && !dialFor(L(71)), rz1.error)
  await walletOf.updateOne({ _id: P }, { $set: { usdOut: 0 } })
  const rz2 = await bulk.resumeCampaign(campP.id)
  await waitFor(() => !!dialFor(L(71)))
  ok('P4-05', 'resume after top-up → running again and the next lead is dialled', rz2.success && (await camps.findOne({ id: campP.id })).status === 'running' && !!dialFor(L(71)), JSON.stringify(rz2))
  const docsBefore = docs.length
  const cz = await bulk.cancelCampaign(campP.id)
  const cP2 = await camps.findOne({ id: campP.id })
  ok('P4-06', 'cancel: status cancelled, 2 untouched leads marked not called, report waits for the call in progress', cz.success && cz.notCalled === 2 && cz.inFlight === 1 && cP2.status === 'cancelled' && cP2.leads.filter(l => l.notCalled).length === 2 && docs.length === docsBefore, JSON.stringify(cz))
  const p1 = dialFor(L(71)).id
  await hook('call.initiated', { call_control_id: p1, direction: 'outgoing', from: callerP, to: L(71) })
  await hook('call.answered', { call_control_id: p1 })
  await hook('call.hangup', { call_control_id: p1, hangup_cause: 'normal_clearing', duration_secs: 20 })
  await sleep(300)
  const cP3 = await camps.findOne({ id: campP.id })
  ok('P4-07', 'call in progress at cancel settles + bills, then the report is sent once; no further dials; cancel twice → error', cP3.leads[1].status === 'completed' && docs.length === docsBefore + 1 && !dialFor(L(72)) && !!(await bulk.cancelCampaign(campP.id)).error && (await ledger.countDocuments({ chatId: P })) === 2, `lead1=${cP3.leads[1].status} ledger=${await ledger.countDocuments({ chatId: P })}`)
  ok('P4-08', 'status card formats paused/cancelled with reason', /CANCELLED/.test(bulk.formatCampaignStatus(cP3)) && /Reason: Cancelled by user/.test(bulk.formatCampaignStatus(cP3)), '')

  // wallet auto-pause message carries ▶️ Resume + ❌ Cancel buttons
  const W = '9000000521', callerW = '+18885550521'
  await walletOf.insertOne({ _id: W, usdIn: 20.2, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: W, val: { numbers: [{ phoneNumber: callerW, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const campW = await bulk.createCampaign({ chatId: W, callerId: callerW, audioUrl: 'https://cdn.invalid/w.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(80) }, { number: L(81) }] })
  await bulk.startCampaign(campW.id)
  await waitFor(() => !!dialFor(L(80)))
  await walletOf.updateOne({ _id: W }, { $set: { usdOut: 20.1 } })   // $0.10 left → after billing the first call, wallet is depleted
  const w0 = dialFor(L(80)).id
  await hook('call.initiated', { call_control_id: w0, direction: 'outgoing', from: callerW, to: L(80) })
  await hook('call.answered', { call_control_id: w0 })
  await hook('call.hangup', { call_control_id: w0, hangup_cause: 'normal_clearing', duration_secs: 30 })
  await waitFor(async () => (await camps.findOne({ id: campW.id })).status === 'paused')
  const pauseMsgs = []
  botStub._last = null
  const cW = await camps.findOne({ id: campW.id })
  ok('P4-09', 'wallet depleted → auto-paused (pausedReason wallet) and next lead not dialled', cW.status === 'paused' && cW.pausedReason === 'wallet' && !dialFor(L(81)), `status=${cW.status} reason=${cW.pausedReason}`)
  ok('P4-10', 'pause message offers ▶️ Resume / ❌ Cancel inline buttons', sentOpts.some(o => o.chatId === W && /Wallet Depleted/.test(o.text) && JSON.stringify(o.opts?.reply_markup || {}).includes(`bulk_resume:${campW.id}`)), '')
  void pauseMsgs

  // ━━━ Feature: voicemail drop (detect_beep → leave clip → hang up) ━━━
  const V = '9000000530', callerV = '+18885550530', vmUrl = 'https://cdn.invalid/vm-drop.mp3'
  await walletOf.insertOne({ _id: V, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: V, val: { numbers: [{ phoneNumber: callerV, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const campV = await bulk.createCampaign({ chatId: V, callerId: callerV, audioUrl: 'https://cdn.invalid/v.mp3', audioName: 'v', mode: 'report_only', concurrency: 2, provider: 'telnyx', voicemailAudioUrl: vmUrl, voicemailAudioName: 'Call us back', leads: [{ number: L(90) }, { number: L(91) }] })
  ok('P5-01', 'campaign stores the voicemail clip', campV.voicemailAudioUrl === vmUrl && campV.voicemailAudioName === 'Call us back', '')
  await bulk.startCampaign(campV.id)
  await waitFor(() => !!dialFor(L(90)) && !!dialFor(L(91)))
  ok('P5-02', 'voicemail-drop campaign dials with AMD detect_beep', dialFor(L(90)).amd === 'detect_beep' && dialFor(L(91)).amd === 'detect_beep' && dials.filter(d => d.from === callerA).every(d => d.amd === 'detect'), `${dialFor(L(90)).amd}`)
  // lead 0: beep detected → clip plays → finishes → hang up
  const v0 = dialFor(L(90)).id
  await hook('call.initiated', { call_control_id: v0, direction: 'outgoing', from: callerV, to: L(90) })
  await hook('call.answered', { call_control_id: v0 })
  await hook('call.machine.detection.ended', { call_control_id: v0, result: 'machine' })
  ok('P5-03', 'machine → IVR prompt stopped (gather_stop), not hung up, waiting for beep', gatherStops.includes(v0) && !hangups.includes(v0) && voice.outboundIvrCalls[v0]?.phase === 'voicemail_wait', `phase=${voice.outboundIvrCalls[v0]?.phase}`)
  const gathersBefore = gathers.filter(g => g === v0).length
  await hook('call.gather.ended', { call_control_id: v0, digits: '' })
  ok('P5-04', 'stale gather.ended during voicemail wait is ignored (prompt not replayed)', gathers.filter(g => g === v0).length === gathersBefore, '')
  await hook('call.machine.greeting.ended', { call_control_id: v0, result: 'beep_detected' })
  ok('P5-05', 'beep → voicemail clip played on the call', playbacks.some(pb => pb.id === v0 && pb.url === vmUrl), JSON.stringify(playbacks.filter(pb => pb.id === v0)))
  await hook('call.playback.ended', { call_control_id: v0, media_url: vmUrl, status: 'completed' })
  ok('P5-06', 'clip finished → app hangs up', hangups.includes(v0), '')
  await hook('call.hangup', { call_control_id: v0, hangup_cause: 'normal_clearing', duration_secs: 75 })
  // lead 1: no beep → fallback timeout plays the clip
  const v1 = dialFor(L(91)).id
  await hook('call.initiated', { call_control_id: v1, direction: 'outgoing', from: callerV, to: L(91) })
  await hook('call.answered', { call_control_id: v1 })
  await hook('call.machine.detection.ended', { call_control_id: v1, result: 'machine' })
  await waitFor(() => playbacks.some(pb => pb.id === v1), 4000)
  ok('P5-07', 'no beep within the wait window → clip still played (fallback timeout)', playbacks.some(pb => pb.id === v1 && pb.url === vmUrl), '')
  await hook('call.playback.ended', { call_control_id: v1, media_url: vmUrl })
  await hook('call.hangup', { call_control_id: v1, hangup_cause: 'normal_clearing', duration_secs: 40 })
  await waitFor(async () => (await camps.findOne({ id: campV.id })).status === 'completed')
  const cV = await camps.findOne({ id: campV.id })
  ok('P5-08', 'both leads → voicemail + voicemailDropped; stats.voicemailLeft = 2', cV.leads.every(l => l.status === 'voicemail' && l.voicemailDropped) && cV.stats.voicemail === 2 && cV.stats.voicemailLeft === 2, JSON.stringify(cV.stats))
  const rowsV = (await ledger.find({ chatId: V }).toArray()).map(l => r2(Math.abs(l.amount))).sort()
  ok('P5-09', 'voicemail drops billed by duration: 75 s → $0.30, 40 s → $0.15', JSON.stringify(rowsV) === JSON.stringify([0.15, 0.3]), JSON.stringify(rowsV))
  ok('P5-10', 'progress says "Voicemail — message left"; report shows 📩 count', sent.some(m => m.chatId === V && /Voicemail — message left/.test(m.text)) && sent.some(m => m.chatId === V && /Voicemail:.*📩 2/.test(m.text)), '')
  ok('P5-11', 'start message shows voicemail choice', sent.some(m => m.chatId === V && /Voicemail: <b>Leave "Call us back"/.test(m.text)), '')

  // voicemail clip fails to play → hang up straight away, not counted as a message left
  const F = '9000000531', callerF = '+18885550531'
  await walletOf.insertOne({ _id: F, usdIn: 50, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: F, val: { numbers: [{ phoneNumber: callerF, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  const campF = await bulk.createCampaign({ chatId: F, callerId: callerF, audioUrl: 'https://cdn.invalid/f.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', voicemailAudioUrl: 'https://cdn.invalid/fail.mp3', voicemailAudioName: 'x', leads: [{ number: L(95) }] })
  await bulk.startCampaign(campF.id)
  await waitFor(() => !!dialFor(L(95)))
  const f0 = dialFor(L(95)).id
  await hook('call.initiated', { call_control_id: f0, direction: 'outgoing', from: callerF, to: L(95) })
  await hook('call.answered', { call_control_id: f0 })
  await hook('call.machine.detection.ended', { call_control_id: f0, result: 'machine' })
  await hook('call.machine.greeting.ended', { call_control_id: f0, result: 'beep_detected' })
  ok('P5-12', 'clip fails to play → call hung up immediately', hangups.includes(f0), '')
  await hook('call.hangup', { call_control_id: f0, hangup_cause: 'normal_clearing', duration_secs: 25 })
  await waitFor(async () => (await camps.findOne({ id: campF.id })).status === 'completed')
  const cF = await camps.findOne({ id: campF.id })
  ok('P5-13', 'failed clip → Voicemail, not counted as message left', cF.leads[0].status === 'voicemail' && !cF.leads[0].voicemailDropped && cF.stats.voicemailLeft === 0, JSON.stringify(cF.stats))

  console.log('\n| Journey | Check | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter((r) => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
