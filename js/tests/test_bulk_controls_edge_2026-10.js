// EDGE harness (testing agent, iteration_106) — Bulk IVR Pause/Resume/Cancel, international pricing,
// voicemail drop. SANDBOX MONGO ONLY. Telnyx / Twilio / Telegram stubbed (no real calls).
//   node js/tests/test_bulk_controls_edge_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p3_controls_edge_sandbox'
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

// ── stubs ──
const dials = [], hangups = [], gathers = [], gatherStops = [], playbacks = []
const gatherStopDelay = {}
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to, webhookUrl, connId, opts) {
    const id = `v3:edge-${++seq}`
    dials.push({ id, from, to, amd: opts?.answering_machine_detection || 'detect' })
    return { callControlId: id }
  },
  async gatherDTMFWithAudio(id) { gathers.push(id); return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async gatherStop(id) { if (gatherStopDelay[id]) await sleep(gatherStopDelay[id]); gatherStops.push(id); return {} },
  async speakOnCall() { return {} }, async playbackStart(id, url) { playbacks.push({ id, url }); return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const twilioDials = []
const twilioStub = { async makeOutboundCall(...a) { twilioDials.push(a); return { callSid: 'CAx' } }, async getSubAccount() { return { authToken: 't' } } }
const sent = [], docs = []
const botStub = {
  sendMessage: async (chatId, text, opts) => { sent.push({ chatId: String(chatId), text: String(text), opts }); return {} },
  sendDocument: async (chatId, p) => { docs.push({ chatId: String(chatId), p }); return {} },
}
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const dialsTo = (to) => dials.filter(d => d.to === to)
const dialFor = (to) => dialsTo(to).slice(-1)[0]

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  const phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, twilioStub, walletOf, null)

  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  let uid = 600
  const mkUser = async (usd) => {
    const chat = `9000000${++uid}`, caller = `+1888555${String(uid).padStart(4, '0')}`
    await walletOf.insertOne({ _id: chat, usdIn: usd, usdOut: 0 })
    await phoneNumbersOf.insertOne({ _id: chat, val: { numbers: [{ phoneNumber: caller, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
    return { chat, caller }
  }
  const L = (i) => `+1415556${String(1000 + i)}`
  const camp = (id) => camps.findOne({ id })
  const answerHang = async (id, caller, to, secs, digits) => {
    await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: caller, to })
    await hook('call.answered', { call_control_id: id })
    if (digits) await hook('call.gather.ended', { call_control_id: id, digits })
    await hook('call.hangup', { call_control_id: id, hangup_cause: 'normal_clearing', duration_secs: secs })
  }
  const mk = (u, leads, extra = {}) => bulk.createCampaign({ chatId: u.chat, callerId: u.caller, audioUrl: 'https://cdn.invalid/e.mp3', audioName: 'e', mode: 'report_only', activeKeys: ['1'], concurrency: 1, provider: 'telnyx', leads, ...extra })

  // ── E01: restart recovery with insufficient wallet → paused (wallet) with Resume button, no dial ──
  {
    const u = await mkUser(0.05)
    await camps.insertOne({ id: 'edge-recover-low', chatId: u.chat, callerId: u.caller, audioUrl: 'https://cdn.invalid/r.mp3', audioName: 'r', mode: 'report_only', activeKeys: ['1'], concurrency: 1, provider: 'telnyx', leads: [{ index: 0, number: L(1), status: 'pending' }, { index: 1, number: L(2), status: 'pending' }], stats: { total: 2, completed: 0 }, status: 'running', startedAt: new Date(), createdAt: new Date() })
    await bulk.recoverRunningCampaigns()
    const c = await camp('edge-recover-low')
    const msg = sent.filter(m => m.chatId === u.chat && /Paused After Restart/.test(m.text))
    ok('E01', 'recovery + low wallet → paused (wallet), ONE "Paused After Restart" msg w/ bulk_resume, no dial', c.status === 'paused' && c.pausedReason === 'wallet' && msg.length === 1 && JSON.stringify(msg[0].opts?.reply_markup || {}).includes('bulk_resume:edge-recover-low') && !dialFor(L(1)), `status=${c.status} reason=${c.pausedReason} msgs=${msg.length}`)
  }

  // ── E02: legacy Twilio paused campaign resume → refused "being upgraded", cancelled ──
  {
    const u = await mkUser(10)
    await camps.insertOne({ id: 'edge-legacy-paused', chatId: u.chat, callerId: '+18005550999', audioUrl: 'x', mode: 'report_only', activeKeys: ['1'], concurrency: 1, twilioSubAccountSid: 'ACx', leads: [{ index: 0, number: L(3), status: 'pending' }], stats: { total: 1, completed: 0 }, status: 'paused', startedAt: new Date(), createdAt: new Date() })
    const r = await bulk.resumeCampaign('edge-legacy-paused')
    const c = await camp('edge-legacy-paused')
    ok('E02', 'legacy Twilio resume refused with "being upgraded" and no Twilio dial', /being upgraded/.test(r.error || '') && twilioDials.length === 0 && c.status === 'cancelled', `err=${r.error} status=${c.status}`)
  }

  // ── E03: LAST lead's billing depletes the wallet → campaign should COMPLETE (final report), not be left paused ──
  {
    const u = await mkUser(25)
    const c0 = await mk(u, [{ number: L(10) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(10)))
    await walletOf.updateOne({ _id: u.chat }, { $set: { usdOut: 24.8 } })   // $0.20 left
    await answerHang(dialFor(L(10)).id, u.caller, L(10), 30)
    await waitFor(async () => ['completed', 'paused'].includes((await camp(c0.id)).status))
    await sleep(300)
    const c = await camp(c0.id)
    ok('E03', 'last-lead billing drains wallet → status completed + report (no "Resume" for a finished campaign)', c.status === 'completed' && docs.some(d => d.chatId === u.chat), `status=${c.status} pausedReason=${c.pausedReason} leads=${c.leads.map(l => l.status)} reportDocs=${docs.filter(d => d.chatId === u.chat).length} pauseMsgs=${sent.filter(m => m.chatId === u.chat && /Paused/.test(m.text)).length}`)
  }

  // ── E04/E05: international lead the wallet can't cover → paused (wallet), lead back to pending; resume needs intl rate ──
  {
    const u = await mkUser(25)
    const uk = '+447700900456'
    const c0 = await mk(u, [{ number: L(20) }, { number: uk }, { number: L(21) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(20)))
    await walletOf.updateOne({ _id: u.chat }, { $set: { usdOut: 24.7 } })   // $0.30 left
    await answerHang(dialFor(L(20)).id, u.caller, L(20), 30)   // $0.15 billed → $0.15 left (covers US, not UK)
    await waitFor(async () => (await camp(c0.id)).status === 'paused')
    await sleep(200)
    const c = await camp(c0.id)
    const pm = sent.filter(m => m.chatId === u.chat && /Paused/.test(m.text))
    ok('E04', 'UK lead unaffordable → paused(wallet), UK lead pending (not failed), 1 pause msg w/ Resume, lead 3 not dialled', c.status === 'paused' && c.pausedReason === 'wallet' && c.leads[1].status === 'pending' && !dialFor(uk) && !dialFor(L(21)) && pm.length === 1 && JSON.stringify(pm[0].opts?.reply_markup || {}).includes(`bulk_resume:${c0.id}`) && /\$0\.50/.test(pm[0].text), `status=${c.status} lead1=${c.leads[1].status} pauseMsgs=${pm.length} text=${(pm[0]?.text || '').slice(0, 120).replace(/\n/g, ' ')}`)
    const r1 = await bulk.resumeCampaign(c0.id)
    ok('E05a', 'resume with $0.15 refused: lowBalance, "$0.50 is needed", still paused, nothing dialled', r1.lowBalance && /\$0\.50/.test(r1.error) && (await camp(c0.id)).status === 'paused' && !dialFor(uk), r1.error)
    await walletOf.updateOne({ _id: u.chat }, { $set: { usdOut: 19.85 } })   // top up → $5.00
    const r2_ = await bulk.resumeCampaign(c0.id)
    await waitFor(() => !!dialFor(uk))
    await sleep(200)
    ok('E05b', 'resume after top-up → running, UK lead dialled exactly once, concurrency 1 respected', r2_.success && dialsTo(uk).length === 1 && !dialFor(L(21)) && (await camp(c0.id)).status === 'running', `uk dials=${dialsTo(uk).length} l21=${!!dialFor(L(21))}`)
    await answerHang(dialFor(uk).id, u.caller, uk, 61)
    await waitFor(() => !!dialFor(L(21)))
    await answerHang(dialFor(L(21)).id, u.caller, L(21), 5)
    await waitFor(async () => (await camp(c0.id)).status === 'completed')
    const rows = (await ledger.find({ chatId: u.chat }).toArray()).map(l => r2(Math.abs(l.amount))).sort()
    ok('E05c', 'billing: US 0.15, UK 61s 2×0.50=1.00, US 0.15 — each lead once', JSON.stringify(rows) === JSON.stringify([0.15, 0.15, 1]), JSON.stringify(rows))
  }

  // ── E06: high-cost destination (Cuba) uses the higher getIvrCallRate; billed + logged at that rate ──
  {
    const cuba = '+2693212345'   // Comoros mobile — high_cost tier (not blocked)
    const blockedCuba = '+5352345678'
    const rate = bulk.leadRate(cuba)
    const est = bulk.estimateLeadsCost([{ number: L(30) }, { number: cuba }])
    ok('E06a', `high-cost rate ($${rate}) > $0.50 intl, estimate = 0.15 + rate, rateLine shows it`, rate > 0.5 && est.total === r2(0.15 + rate) && est.rateLine.includes(`$${rate.toFixed(2)}/min international (1 lead)`), JSON.stringify(est))
    const estB = bulk.estimateLeadsCost([{ number: L(30) }, { number: blockedCuba }])
    ok('E06d', '[estimate] blocked destination (Cuba +53, never dialled/billed) should not add $10/min to the pre-launch estimate', estB.total === 0.15, JSON.stringify(estB))
    const usOnly = bulk.estimateLeadsCost([{ number: L(30) }, { number: '+14165550123' }])
    ok('E06b', 'US/CA-only estimate keeps the plain "$0.15/min per call" line', usOnly.rateLine === 'Rate: $0.15/min per call' && usOnly.intl === 0 && usOnly.total === 0.3, JSON.stringify(usOnly))
    const u = await mkUser(50)
    const c0 = await mk(u, [{ number: cuba }])
    await bulk.startCampaign(c0.id)
    const dialled = await waitFor(() => !!dialFor(cuba))
    if (dialled) {
      await answerHang(dialFor(cuba).id, u.caller, cuba, 61)
      await waitFor(async () => (await camp(c0.id)).status === 'completed')
      const lg = await ledger.findOne({ chatId: u.chat })
      const pl = await phoneLogs.findOne({ chatId: u.chat, type: 'BulkIVR' })
      ok('E06c', 'Cuba 61 s billed 2 × rate; phoneLogs.rate + ledger description carry the rate', lg && r2(Math.abs(lg.amount)) === r2(2 * rate) && pl?.rate === rate && (lg.description || '').includes(`× $${rate}`), `amount=${lg?.amount} plRate=${pl?.rate} desc=${lg?.description}`)
    } else {
      const c = await camp(c0.id)
      ok('E06c', 'Cuba lead dialled (not blocked)', false, `status=${c.status} lead=${c.leads[0].status} cause=${c.leads[0].hangupCause}`)
    }
  }

  // ── E07: concurrent double-resume → exactly one succeeds, no duplicate dial ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [0, 1, 2].map(i => ({ number: L(40 + i) })))
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(40)))
    await bulk.pauseCampaign(c0.id)
    await hook('call.initiated', { call_control_id: dialFor(L(40)).id, direction: 'outgoing', from: u.caller, to: L(40) })
    await hook('call.hangup', { call_control_id: dialFor(L(40)).id, hangup_cause: 'timeout' })
    await sleep(200)
    const rs = await Promise.all([bulk.resumeCampaign(c0.id), bulk.resumeCampaign(c0.id), bulk.resumeCampaign(c0.id)])
    await sleep(400)
    ok('E07', '3 parallel resumes → 1 success, lead 1 dialled once, lead 2 not (concurrency 1)', rs.filter(r => r.success).length === 1 && dialsTo(L(41)).length === 1 && !dialFor(L(42)), `succ=${rs.filter(r => r.success).length} l41=${dialsTo(L(41)).length} l42=${dialsTo(L(42)).length}`)
    await bulk.cancelCampaign(c0.id)
  }

  // ── E08: pause → resume → pause → resume quickly with a call in flight; no over-dial ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [0, 1, 2, 3].map(i => ({ number: L(50 + i) })), { concurrency: 2 })
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(50)) && !!dialFor(L(51)))
    for (let i = 0; i < 3; i++) { await bulk.pauseCampaign(c0.id); await bulk.resumeCampaign(c0.id) }
    await sleep(400)
    const c = await camp(c0.id)
    ok('E08', 'pause/resume ×3 with 2 calls in flight → still only 2 dials (no slot leak / over-dial)', dials.filter(d => [L(50), L(51), L(52), L(53)].includes(d.to)).length === 2 && c.status === 'running' && bulk.activeCampaigns[c0.id]?.activeCalls === 2, `dials=${dials.filter(d => [L(50), L(51), L(52), L(53)].includes(d.to)).length} active=${bulk.activeCampaigns[c0.id]?.activeCalls}`)
    await answerHang(dialFor(L(50)).id, u.caller, L(50), 10)
    await waitFor(() => !!dialFor(L(52)))
    ok('E08b', 'after a slot frees exactly one new lead is dialled', dialsTo(L(52)).length === 1 && !dialFor(L(53)), '')
    await bulk.cancelCampaign(c0.id)
  }

  // ── E09: cancel racing an in-flight completion → billed once, one report, stays cancelled ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [{ number: L(60) }, { number: L(61) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(60)))
    const id = dialFor(L(60)).id
    await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: u.caller, to: L(60) })
    await hook('call.answered', { call_control_id: id })
    const [cz] = await Promise.all([bulk.cancelCampaign(c0.id), hook('call.hangup', { call_control_id: id, hangup_cause: 'normal_clearing', duration_secs: 30 })])
    await sleep(500)
    const c = await camp(c0.id)
    ok('E09', 'cancel ∥ hangup → cancelled, lead0 completed & billed once, lead1 not dialled, 1 report', cz.success && c.status === 'cancelled' && c.leads[0].status === 'completed' && (await ledger.countDocuments({ chatId: u.chat })) === 1 && !dialFor(L(61)) && docs.filter(d => d.chatId === u.chat).length === 1 && c.leads[1].notCalled === true, `status=${c.status} lead0=${c.leads[0].status} ledger=${await ledger.countDocuments({ chatId: u.chat })} reports=${docs.filter(d => d.chatId === u.chat).length}`)
  }

  // ── E10: cancel a never-started (created) campaign → no report; second cancel → error ──
  {
    const u = await mkUser(5)
    const c0 = await mk(u, [{ number: L(70) }])
    const r1 = await bulk.cancelCampaign(c0.id)
    const r2c = await bulk.cancelCampaign(c0.id)
    ok('E10', 'created → cancelled, notCalled 1, no report, 2nd cancel error, start afterwards refused', r1.success && r1.notCalled === 1 && !docs.some(d => d.chatId === u.chat) && !!r2c.error && !!(await bulk.startCampaign(c0.id)).error && !dialFor(L(70)), JSON.stringify({ r1, r2c }))
  }

  // ── E11: paused before restart, orphaned Telnyx leg → resume hangs it up, re-dials, late old completion ignored ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [{ number: L(80) }, { number: L(81) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(80)))
    const oldId = dialFor(L(80)).id
    await bulk.pauseCampaign(c0.id)
    delete bulk.activeCampaigns[c0.id]; delete voice.outboundIvrCalls[oldId]   // simulate process restart
    const r = await bulk.resumeCampaign(c0.id)
    await waitFor(() => dialsTo(L(80)).length === 2)
    await sleep(200)
    const c = await camp(c0.id)
    ok('E11a', 'resume after restart: orphan leg hung up, lead 0 re-dialled once with new callSid, lead 1 waits', r.success && hangups.includes(oldId) && dialsTo(L(80)).length === 2 && c.leads[0].callSid === dialFor(L(80)).id && !dialFor(L(81)), `hung=${hangups.includes(oldId)} dials=${dialsTo(L(80)).length} sid=${c.leads[0].callSid}`)
    await bulk.onCallComplete(oldId, { campaignId: c0.id, leadIndex: 0, answeredAt: new Date(), duration: 40, hangupCause: 'normal_clearing' })
    await sleep(200)
    ok('E11b', 'late completion for the old leg is ignored (not billed, lead still in flight)', (await ledger.countDocuments({ chatId: u.chat })) === 0 && INFL((await camp(c0.id)).leads[0].status), `ledger=${await ledger.countDocuments({ chatId: u.chat })}`)
    await bulk.cancelCampaign(c0.id)
  }

  // ── E12: paused before restart, Telnyx leg still live (session warm) → kept, holds the slot ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [{ number: L(85) }, { number: L(86) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(85)))
    await bulk.pauseCampaign(c0.id)
    delete bulk.activeCampaigns[c0.id]
    const r = await bulk.resumeCampaign(c0.id)
    await sleep(300)
    ok('E12a', 'live leg kept: no re-dial of lead 0, no dial of lead 1 (slot held), activeCalls 1', r.success && dialsTo(L(85)).length === 1 && !dialFor(L(86)) && bulk.activeCampaigns[c0.id]?.activeCalls === 1, `dials85=${dialsTo(L(85)).length} d86=${!!dialFor(L(86))} active=${bulk.activeCampaigns[c0.id]?.activeCalls}`)
    await answerHang(dialFor(L(85)).id, u.caller, L(85), 20)
    await waitFor(() => !!dialFor(L(86)))
    ok('E12b', 'kept leg settles + bills once, then lead 1 dialled', (await ledger.countDocuments({ chatId: u.chat })) === 1 && dialsTo(L(86)).length === 1, '')
    await bulk.cancelCampaign(c0.id)
  }

  // ── E13: two calls bill concurrently and both drain the wallet → exactly ONE pause message ──
  {
    const u = await mkUser(25)
    const c0 = await mk(u, [0, 1, 2, 3].map(i => ({ number: L(90 + i) })), { concurrency: 2 })
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(90)) && !!dialFor(L(91)))
    await walletOf.updateOne({ _id: u.chat }, { $set: { usdOut: 24.6 } })   // $0.40 left
    for (const n of [L(90), L(91)]) { await hook('call.initiated', { call_control_id: dialFor(n).id, direction: 'outgoing', from: u.caller, to: n }); await hook('call.answered', { call_control_id: dialFor(n).id }) }
    await Promise.all([L(90), L(91)].map(n => hook('call.hangup', { call_control_id: dialFor(n).id, hangup_cause: 'normal_clearing', duration_secs: 30 })))
    await waitFor(async () => (await camp(c0.id)).status === 'paused')
    await sleep(400)
    const pm = sent.filter(m => m.chatId === u.chat && /Paused/.test(m.text))
    ok('E13', 'parallel billings drain wallet → paused(wallet), ONE pause message, no 3rd dial', (await camp(c0.id)).status === 'paused' && pm.length === 1 && !dialFor(L(92)) && (await ledger.countDocuments({ chatId: u.chat })) === 2, `pauseMsgs=${pm.length} d92=${!!dialFor(L(92))}`)
  }

  // ── E14: user pauses while the LAST call is in flight → after it settles campaign should finish ──
  {
    const u = await mkUser(20)
    const c0 = await mk(u, [{ number: L(95) }])
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(95)))
    await bulk.pauseCampaign(c0.id)
    await answerHang(dialFor(L(95)).id, u.caller, L(95), 10)
    await sleep(500)
    const c = await camp(c0.id)
    ok('E14', '[UX] pause with only the last call in flight → after settle, campaign completes (report) instead of staying paused at 100%', c.status === 'completed', `status=${c.status} progress=${c.stats?.completed}/${c.stats?.total} reports=${docs.filter(d => d.chatId === u.chat).length}`)
    const r = await bulk.resumeCampaign(c0.id)
    await sleep(300)
    ok('E14b', 'resume of an all-done paused campaign completes it and sends the report', (await camp(c0.id)).status === 'completed' && docs.filter(d => d.chatId === u.chat).length === 1, JSON.stringify(r))
  }

  // ── E20: the last two calls settle at the same moment → exactly ONE final report ──
  {
    const u = await mkUser(25)
    const c0 = await mk(u, [{ number: L(120) }, { number: L(121) }], { concurrency: 2 })
    await bulk.startCampaign(c0.id)
    await waitFor(() => !!dialFor(L(120)) && !!dialFor(L(121)))
    for (const n of [L(120), L(121)]) { await hook('call.initiated', { call_control_id: dialFor(n).id, direction: 'outgoing', from: u.caller, to: n }); await hook('call.answered', { call_control_id: dialFor(n).id }) }
    await Promise.all([L(120), L(121)].map(n => hook('call.hangup', { call_control_id: dialFor(n).id, hangup_cause: 'normal_clearing', duration_secs: 15 })))
    await waitFor(async () => (await camp(c0.id)).status === 'completed')
    await sleep(400)
    const reports = docs.filter(d => d.chatId === u.chat).length
    ok('E20', 'parallel final settlements → completed, ONE report document', (await camp(c0.id)).status === 'completed' && reports === 1, `reports=${reports}`)
  }

  // ── E15..E19: voicemail drop races ──
  {
    const u = await mkUser(50)
    const vmUrl = 'https://cdn.invalid/vm-edge.mp3'
    const maxPlayTimers = () => process._getActiveHandles().filter(h => h && h._idleTimeout === 120000 && !h._destroyed).length
    const timersBase = maxPlayTimers()
    const N = [100, 101, 102, 103].map(L)
    const c0 = await mk(u, N.map(number => ({ number })), { concurrency: 4, voicemailAudioUrl: vmUrl, voicemailAudioName: 'VM' })
    await bulk.startCampaign(c0.id)
    await waitFor(() => N.every(n => !!dialFor(n)))
    const [a, b, c, d] = N.map(n => dialFor(n).id)
    for (const [id, n] of [[a, N[0]], [b, N[1]], [c, N[2]], [d, N[3]]]) { await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: u.caller, to: n }); await hook('call.answered', { call_control_id: id }) }
    // a: human presses 1
    await hook('call.machine.detection.ended', { call_control_id: a, result: 'human' })
    await hook('call.gather.ended', { call_control_id: a, digits: '1' })
    ok('E15', 'human in a VM-drop campaign: no gather_stop, no clip, not hung up by app', !gatherStops.includes(a) && !playbacks.some(p => p.id === a && p.url === vmUrl) && !hangups.includes(a), '')
    await hook('call.hangup', { call_control_id: a, hangup_cause: 'normal_clearing', duration_secs: 40 })
    // b: callee side hangs up while waiting for beep → timer must not fire a playback later
    await hook('call.machine.detection.ended', { call_control_id: b, result: 'machine' })
    await hook('call.hangup', { call_control_id: b, hangup_cause: 'normal_clearing', duration_secs: 12 })
    // c: greeting.ended arrives while gather_stop is still in flight
    gatherStopDelay[c] = 300
    const pDet = hook('call.machine.detection.ended', { call_control_id: c, result: 'machine' })
    await sleep(50)
    await hook('call.machine.greeting.ended', { call_control_id: c, result: 'beep_detected' })
    await pDet
    // d: stale IVR-prompt playback.ended during wait / playing must not hang up early
    await hook('call.machine.detection.ended', { call_control_id: d, result: 'machine' })
    await hook('call.playback.ended', { call_control_id: d, media_url: 'https://cdn.invalid/e.mp3' })
    const dPhase1 = voice.outboundIvrCalls[d]?.phase
    await hook('call.machine.greeting.ended', { call_control_id: d, result: 'beep_detected' })
    await hook('call.playback.ended', { call_control_id: d, media_url: 'https://cdn.invalid/e.mp3' })
    const dHungEarly = hangups.includes(d)
    await sleep(1900)  // > BULK_VM_BEEP_WAIT_MS
    ok('E16', 'hangup during beep wait → beep-wait timer cleared, clip never played on dead call', !playbacks.some(p => p.id === b), JSON.stringify(playbacks.filter(p => p.id === b)))
    ok('E17', 'greeting.ended during in-flight gather_stop → clip played exactly once (no 2nd play from fallback timer)', playbacks.filter(p => p.id === c && p.url === vmUrl).length === 1, `plays=${playbacks.filter(p => p.id === c).length}`)
    ok('E18', 'stale IVR-prompt playback.ended in wait/playing phase → ignored (phase kept, not hung up early)', dPhase1 === 'voicemail_wait' && !dHungEarly && playbacks.filter(p => p.id === d && p.url === vmUrl).length === 1, `phase=${dPhase1} hungEarly=${dHungEarly}`)
    for (const id of [c, d]) { await hook('call.playback.ended', { call_control_id: id, media_url: vmUrl }) }
    ok('E18b', 'clip ended → hung up', hangups.includes(c) && hangups.includes(d), '')
    await hook('call.hangup', { call_control_id: c, hangup_cause: 'normal_clearing', duration_secs: 50 })
    await hook('call.hangup', { call_control_id: d, hangup_cause: 'normal_clearing', duration_secs: 20 })
    await waitFor(async () => (await camp(c0.id)).status === 'completed')
    const cc = await camp(c0.id)
    ok('E19', 'outcomes: completed(1) / voicemail no msg / voicemail+msg ×2; stats voicemail 3, voicemailLeft 2; each billed once', cc.leads[0].status === 'completed' && cc.leads[0].digitPressed === '1' && cc.leads[1].status === 'voicemail' && !cc.leads[1].voicemailDropped && cc.leads[2].voicemailDropped && cc.leads[3].voicemailDropped && cc.stats.voicemail === 3 && cc.stats.voicemailLeft === 2 && (await ledger.countDocuments({ chatId: u.chat })) === 4, `${cc.leads.map(l => `${l.status}/${!!l.voicemailDropped}`)} stats=${JSON.stringify(cc.stats)}`)
    ok('E21', 'no orphaned 120 s voicemail max-play timers after all VM calls hung up', maxPlayTimers() === timersBase, `base=${timersBase} now=${maxPlayTimers()}`)
    const progB = sent.find(m => m.chatId === u.chat && /Voicemail — hung up/.test(m.text))
    ok('E19b', 'lead without a played clip shows "Voicemail — hung up"; dropped ones "message left"', !!progB && sent.filter(m => m.chatId === u.chat && /Voicemail — message left/.test(m.text)).length === 2, '')
  }

  console.log('\n| Check | Name | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter(r => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })

function INFL(s) { return ['calling', 'ringing', 'answered'].includes(s) }
