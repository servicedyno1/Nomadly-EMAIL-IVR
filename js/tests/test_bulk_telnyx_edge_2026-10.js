// Phase 2 EDGE harness (testing agent) — Bulk IVR on Telnyx. SANDBOX MONGO ONLY. Telnyx/Telegram stubbed.
//   node js/tests/test_bulk_telnyx_edge_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p2_telnyx_edge_sandbox'
process.env.BULK_TELNYX_DIAL_GAP_MS = '250' // real pacing for the cancel-while-waiting case
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const bulk = require('../bulk-call-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40) } return false }
const r2 = (n) => Math.round(n * 10000) / 10000

const dials = []; const hangups = []; let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to) { const id = `v3:e-${++seq}`; dials.push({ id, from, to, at: Date.now() }); return { callControlId: id } },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const sent = []
const botStub = { sendMessage: async (c, t) => { sent.push({ chatId: String(c), text: String(t) }); return {} }, sendDocument: async () => ({}) }
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const dialFor = (to) => dials.filter(d => d.to === to).slice(-1)[0]
const dialsTo = (to) => dials.filter(d => d.to === to).length

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  const phoneNumbersOf = db.collection('phoneNumbersOf'), phoneLogs = db.collection('phoneLogs')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs, telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, null, walletOf, null)
  const initAt = Date.now()
  const mkUser = async (id, caller, usd = 50) => {
    await walletOf.insertOne({ _id: id, usdIn: usd, usdOut: 0 })
    await phoneNumbersOf.insertOne({ _id: id, val: { numbers: [{ phoneNumber: caller, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  }
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  const L = (i) => `+1415666${String(1000 + i)}`
  const answerHang = async (id, from, to, secs, digits) => {
    await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from, to })
    await hook('call.answered', { call_control_id: id })
    if (digits) await hook('call.gather.ended', { call_control_id: id, digits })
    await hook('call.hangup', { call_control_id: id, hangup_cause: 'normal_clearing', duration_secs: secs })
  }

  // ── E1: concurrent completions never over-dial beyond concurrency ──
  const A = '9100000001', cA = '+18885551001'; await mkUser(A, cA)
  const campA = await bulk.createCampaign({ chatId: A, callerId: cA, audioUrl: 'https://cdn.invalid/a.mp3', mode: 'report_only', concurrency: 3, provider: 'telnyx', leads: Array.from({ length: 10 }, (_, i) => ({ number: L(i) })) })
  await bulk.startCampaign(campA.id)
  await waitFor(() => dials.filter(d => d.from === cA).length === 3)
  const first3 = dials.filter(d => d.from === cA).slice(0, 3)
  await Promise.all(first3.map(d => answerHang(d.id, cA, d.to, 20)))
  await sleep(2500)
  const docA = await camps.findOne({ id: campA.id })
  const inflightA = docA.leads.filter(l => ['calling', 'ringing', 'answered'].includes(l.status)).length
  const uniqA = new Set(dials.filter(d => d.from === cA).map(d => d.to)).size
  ok('E1', '3 concurrent completions → exactly 3 in-flight again, no lead dialled twice', inflightA === 3 && uniqA === dials.filter(d => d.from === cA).length && bulk.activeCampaigns[campA.id]?.activeCalls === 3, `inflight=${inflightA} dials=${dials.filter(d => d.from === cA).length} uniq=${uniqA} activeCalls=${bulk.activeCampaigns[campA.id]?.activeCalls}`)
  ok('E1b', 'paced dials respect BULK_TELNYX_DIAL_GAP_MS (>=~250ms apart)', first3.every((d, i) => i === 0 || d.at - first3[i - 1].at >= 200), first3.map((d, i) => i ? d.at - first3[i - 1].at : 0).join(','))
  await bulk.cancelCampaign(campA.id)

  // ── E2: cancel mid-run while a paced dial is waiting → no further dials ──
  const B = '9100000002', cB = '+18885551002'; await mkUser(B, cB)
  const campB = await bulk.createCampaign({ chatId: B, callerId: cB, audioUrl: 'https://cdn.invalid/b.mp3', mode: 'report_only', concurrency: 5, provider: 'telnyx', leads: Array.from({ length: 5 }, (_, i) => ({ number: L(100 + i) })) })
  await sleep(600) // let global pacing reservation drain
  await bulk.startCampaign(campB.id)
  await waitFor(() => dials.some(d => d.from === cB), 3000)
  await bulk.cancelCampaign(campB.id)
  const atCancel = dials.filter(d => d.from === cB).length
  await sleep(2000)
  const afterB = dials.filter(d => d.from === cB).length
  const docB = await camps.findOne({ id: campB.id })
  ok('E2', 'cancel while paced dials are waiting → no dial after cancel, status cancelled', afterB === atCancel && docB.status === 'cancelled', `atCancel=${atCancel} after=${afterB} status=${docB.status}`)
  // in-flight leg after cancel still settles + bills once
  const bLeg = dials.find(d => d.from === cB)
  await answerHang(bLeg.id, cB, bLeg.to, 30)
  await sleep(300)
  const docB2 = await camps.findOne({ id: campB.id })
  ok('E2b', 'in-flight leg after cancel settles (completed) and is billed once', docB2.leads[0].status === 'completed' && (await ledger.countDocuments({ chatId: B })) === 1, `lead0=${docB2.leads[0].status} ledger=${await ledger.countDocuments({ chatId: B })}`)

  // ── E3: wallet exhaustion on Telnyx path → campaign paused, no further dials ──
  const C = '9100000003', cC = '+18885551003'; await mkUser(C, cC)
  const campC = await bulk.createCampaign({ chatId: C, callerId: cC, audioUrl: 'https://cdn.invalid/c.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: Array.from({ length: 4 }, (_, i) => ({ number: L(200 + i) })) })
  await sleep(400)
  await bulk.startCampaign(campC.id)
  await waitFor(() => dials.some(d => d.from === cC))
  await walletOf.updateOne({ _id: C }, { $set: { usdOut: 49.8 } }) // $0.20 left
  const c0 = dials.find(d => d.from === cC)
  await answerHang(c0.id, cC, c0.to, 40)
  await sleep(1500)
  const docC = await camps.findOne({ id: campC.id })
  ok('E3', 'wallet exhausted after billing → paused, only 1 dial, lead billed $0.15', docC.status === 'paused' && dials.filter(d => d.from === cC).length === 1 && (await balance(C)) === 0.05 && sent.some(m => m.chatId === C && /Wallet Depleted/.test(m.text)), `status=${docC.status} dials=${dials.filter(d => d.from === cC).length} bal=${await balance(C)}`)

  // wait until the init-time (15 s) auto recovery timer has fired so it can't interfere with E4
  await sleep(Math.max(0, 16500 - (Date.now() - initAt)))

  // ── E4: menu bulk campaign on Telnyx (transfer mode): key 1 forward, key 2 message ──
  const D = '9100000004', cD = '+18885551004', fwd = '+14155557777'; await mkUser(D, cD)
  const menu = { '1': { action: 'forward', forwardTo: fwd }, '2': { action: 'message', message: 'Thanks, bye.' } }
  const campD = await bulk.createCampaign({ chatId: D, callerId: cD, audioUrl: 'https://cdn.invalid/d.mp3', mode: 'transfer', transferNumber: null, menu, activeKeys: ['1', '2'], concurrency: 2, holdMusic: true, provider: 'telnyx', leads: [{ number: L(300) }, { number: L(301) }] })
  await sleep(400)
  await bulk.startCampaign(campD.id)
  await waitFor(() => !!dialFor(L(300)) && !!dialFor(L(301)))
  const d0 = dialFor(L(300)).id, d1 = dialFor(L(301)).id
  const sD = voice.outboundIvrCalls[d0]
  ok('E4a', 'menu passed to the Telnyx session', !!sD && !!sD.menu && sD.menu['1'].forwardTo === fwd, sD ? JSON.stringify(Object.keys(sD.menu || {})) : 'none')
  // lead0 presses 1 → forward
  await hook('call.initiated', { call_control_id: d0, direction: 'outgoing', from: cD, to: L(300) })
  await hook('call.answered', { call_control_id: d0 })
  await hook('call.gather.ended', { call_control_id: d0, digits: '1' })
  await hook('call.speak.ended', { call_control_id: d0 })
  const fwdDialled = await waitFor(() => !!dialFor(fwd), 8000)
  ok('E4b', 'menu forward key dials the forward number', fwdDialled, `fwd=${dialFor(fwd)?.id}`)
  if (fwdDialled) { await hook('call.answered', { call_control_id: dialFor(fwd).id }); await hook('call.bridged', { call_control_id: d0 }) }
  await hook('call.hangup', { call_control_id: d0, hangup_cause: 'normal_clearing', duration_secs: 70 })
  // lead1 presses 2 → spoken message, hangup (NOT a transfer)
  await answerHang(d1, cD, L(301), 15, '2')
  await waitFor(async () => (await camps.findOne({ id: campD.id })).status === 'completed')
  const docD = await camps.findOne({ id: campD.id })
  ok('E4c', 'forward lead → transferred + transferConnected', docD.leads[0].transferred === true && docD.leads[0].transferConnected === true, JSON.stringify({ t: docD.leads[0].transferred, tc: docD.leads[0].transferConnected, d: docD.leads[0].digitPressed }))
  ok('E4d', 'menu "message" key lead is NOT reported as transferred', docD.leads[1].transferred === false, JSON.stringify({ t: docD.leads[1].transferred, tc: docD.leads[1].transferConnected, d: docD.leads[1].digitPressed, statsTransferred: docD.stats.transferred }))

  // ── E5: restart recovery of a RUNNING Telnyx campaign → resumes on Telnyx (not cancelled) ──
  const E = '9100000005', cE = '+18885551005'; await mkUser(E, cE)
  await camps.insertOne({ id: 'edge-telnyx-running', chatId: E, callerId: cE, provider: 'telnyx', audioUrl: 'https://cdn.invalid/e.mp3', audioName: 'e', mode: 'report_only', activeKeys: ['1'], concurrency: 1,
    leads: [{ index: 0, number: L(400), status: 'calling', callSid: 'v3:old-live', startedAt: new Date() }, { index: 1, number: L(401), status: 'pending' }],
    stats: { total: 2, completed: 0 }, status: 'running', startedAt: new Date(), createdAt: new Date() })
  await sleep(400)
  await bulk.recoverRunningCampaigns()
  await sleep(800)
  const docE = await camps.findOne({ id: 'edge-telnyx-running' })
  ok('E5', 'running Telnyx campaign recovered (status running, dialled via Telnyx)', docE.status === 'running' && dials.some(d => d.from === cE), `status=${docE.status} dials=${dials.filter(d => d.from === cE).map(d => d.to).join(',')}`)
  ok('E5b', '[risk] lead that was mid-call at restart is redialled (possible duplicate call to same person)', dialsTo(L(400)) === 1, `redialled lead0 ${dialsTo(L(400))}x (old live leg v3:old-live orphaned, never billed)`)
  ok('E5c', 'orphaned Telnyx leg (no voice-service session) is hung up before its lead is re-dialled', hangups.includes('v3:old-live'), `hangups=${hangups.join(',')}`)

  // ── E8: restart with a warm-loaded live Telnyx session → lead kept (not re-dialled), slot held ──
  const H = '9100000008', cH = '+18885551008'; await mkUser(H, cH)
  voice.outboundIvrCalls['v3:warm-live'] = { chatId: H, callerId: cH, targetNumber: L(600), activeKeys: ['1'], phase: 'playing', campaignId: 'edge-telnyx-warm', leadIndex: 0, bulkMode: 'report_only', startTime: Date.now(), answerTime: Date.now() }
  await camps.insertOne({ id: 'edge-telnyx-warm', chatId: H, callerId: cH, provider: 'telnyx', audioUrl: 'https://cdn.invalid/h.mp3', audioName: 'h', mode: 'report_only', activeKeys: ['1'], concurrency: 1,
    leads: [{ index: 0, number: L(600), status: 'calling', callSid: 'v3:warm-live', startedAt: new Date() }, { index: 1, number: L(601), status: 'pending' }],
    stats: { total: 2, completed: 0 }, status: 'running', startedAt: new Date(), createdAt: new Date() })
  await bulk.recoverRunningCampaigns()
  await sleep(600)
  const docH1 = await camps.findOne({ id: 'edge-telnyx-warm' })
  ok('E8', 'live warm-loaded leg kept: lead0 still calling, not re-dialled; lead1 waits (concurrency 1 held)', docH1.leads[0].status === 'calling' && dialsTo(L(600)) === 0 && dialsTo(L(601)) === 0 && bulk.activeCampaigns['edge-telnyx-warm']?.activeCalls === 1, `lead0=${docH1.leads[0].status} d600=${dialsTo(L(600))} d601=${dialsTo(L(601))} active=${bulk.activeCampaigns['edge-telnyx-warm']?.activeCalls}`)
  await hook('call.initiated', { call_control_id: 'v3:warm-live', direction: 'outgoing', from: cH, to: L(600) })
  await hook('call.hangup', { call_control_id: 'v3:warm-live', hangup_cause: 'normal_clearing', duration_secs: 40 })
  await waitFor(() => dialsTo(L(601)) === 1)
  const docH2 = await camps.findOne({ id: 'edge-telnyx-warm' })
  ok('E8b', 'kept leg settles + bills via its webhook, then the next lead is dialled', docH2.leads[0].status === 'completed' && (await ledger.countDocuments({ chatId: H })) === 1 && dialsTo(L(601)) === 1, `lead0=${docH2.leads[0].status} ledger=${await ledger.countDocuments({ chatId: H })}`)
  await bulk.cancelCampaign('edge-telnyx-warm')

  // ── E9: stuck-lead sweeper settles a lead whose completion never arrived (not billed) ──
  const S = '9100000009', cS = '+18885551009'; await mkUser(S, cS)
  const campS = await bulk.createCampaign({ chatId: S, callerId: cS, audioUrl: 'https://cdn.invalid/s.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(700) }, { number: L(701) }] })
  await sleep(300)
  await bulk.startCampaign(campS.id)
  await waitFor(() => dialsTo(L(700)) === 1)
  await camps.updateOne({ id: campS.id }, { $set: { 'leads.0.startedAt': new Date(Date.now() - 25 * 60 * 1000) } })
  const swept = await bulk.sweepStuckLeads()
  await waitFor(() => dialsTo(L(701)) === 1)
  const docS = await camps.findOne({ id: campS.id })
  ok('E9', 'stuck lead swept → failed, not billed, slot freed (next lead dialled)', swept >= 1 && docS.leads[0].status === 'failed' && (await ledger.countDocuments({ chatId: S })) === 0 && dialsTo(L(701)) === 1, `swept=${swept} lead0=${docS.leads[0].status} ledger=${await ledger.countDocuments({ chatId: S })}`)
  await bulk.cancelCampaign(campS.id)

  // ── E7: recovery pass (boot +15 s timer) must NOT touch a campaign already running in THIS process ──
  const G = '9100000007', cG = '+18885551007'; await mkUser(G, cG)
  const campG = await bulk.createCampaign({ chatId: G, callerId: cG, audioUrl: 'https://cdn.invalid/g.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: L(500) }, { number: L(501) }] })
  await sleep(400)
  await bulk.startCampaign(campG.id)
  await waitFor(() => !!dialFor(L(500)))
  const g0 = dialFor(L(500)).id
  await bulk.recoverRunningCampaigns()   // what the setTimeout(…,15000) in initBulkCallService does
  await sleep(600)
  await answerHang(g0, cG, L(500), 30)
  await sleep(400)
  const docG = await camps.findOne({ id: campG.id })
  ok('E7', 'recovery does not redial a live lead of a campaign started in this process; original completion is billed', dialsTo(L(500)) === 1 && (await ledger.countDocuments({ chatId: G })) >= 1 && docG.leads[0].callSid === g0, `lead0 dialled ${dialsTo(L(500))}x, ledger=${await ledger.countDocuments({ chatId: G })}, lead0.callSid=${docG.leads[0].callSid} (orig ${g0}), activeCalls=${bulk.activeCampaigns[campG.id]?.activeCalls}`)
  await bulk.cancelCampaign(campG.id)

  // ── E6: international lead billing on Telnyx (bulk flat rate vs IVR intl rate) ──
  const F = '9100000006', cF = '+18885551006'; await mkUser(F, cF)
  const campF = await bulk.createCampaign({ chatId: F, callerId: cF, audioUrl: 'https://cdn.invalid/f.mp3', mode: 'report_only', concurrency: 1, provider: 'telnyx', leads: [{ number: '+447700900123' }] })
  await sleep(400)
  await bulk.startCampaign(campF.id)
  await waitFor(() => !!dialFor('+447700900123'))
  const f0 = dialFor('+447700900123')
  if (f0) await answerHang(f0.id, cF, f0.to, 60)
  await sleep(400)
  const chargedF = r2(50 - (await balance(F)))
  ok('E6', '[info] UK lead 60s on Telnyx billed at bulk flat rate', !!f0, `dialled=${!!f0} charged=$${chargedF} (single Quick-IVR intl rate is $0.50/min)`)

  console.log('\n| Case | Check | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter(r => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
