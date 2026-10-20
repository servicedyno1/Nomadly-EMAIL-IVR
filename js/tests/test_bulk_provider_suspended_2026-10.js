// Phase 4 sandbox harness — bulk campaign ends on provider suspension (JRN-40..42, 44). SANDBOX MONGO ONLY.
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_bulk_provider_suspended_2026-10.js
// RUNTIME: the real bulk-call-service (startCampaign, fireNextBatch, onCallStatusUpdate billing,
// recoverRunningCampaigns) + real wallet utils. Twilio, Telegram and voice-service are stubbed.
const Module = require('module')
const fs = require('fs')
const path = require('path')
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p4_sandbox'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD
const vp = require.resolve('../voice-service.js')
require.cache[vp] = Object.assign(new Module(vp), { filename: vp, loaded: true, exports: { billCallMinutesUnified: async () => ({}) } })

const { MongoClient } = require('mongodb')
const bulk = require('../bulk-call-service.js')
const results = []
const ok = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail })
const r2 = (n) => Math.round(n * 10000) / 10000

let suspendFromLead = Infinity
const dials = []
const twilioStub = {
  async makeOutboundCall(from, to, twimlUrl, subSid) {
    const idx = Number(new URLSearchParams(twimlUrl.split('?')[1]).get('leadIndex'))
    dials.push({ idx, subSid })
    if (idx >= suspendFromLead) return { error: 'Authenticate — sub-account is suspended. Contact support.', subAccountStatus: 'suspended' }
    return { callSid: 'CA' + String(idx).padStart(32, '0'), status: 'queued', from, to }
  },
  async getSubAccount() { return { authToken: 'tok', status: 'active' } },
}
const sent = []
const botStub = { sendMessage: async (chatId, text) => { sent.push({ chatId: String(chatId), text: String(text) }); return {} } }

const leads = (n) => Array.from({ length: n }, (_, i) => ({ index: i, number: `+1555000${String(i).padStart(4, '0')}`, name: `L${i}`, status: 'pending' }))
const campaignDoc = (id, chatId, n, concurrency) => ({
  id, chatId, callerId: '+18440000025', audioUrl: 'x', audioName: 'a.mp3', mode: 'report', transferNumber: null, menu: null, activeKeys: [],
  concurrency, holdMusic: false, twilioSubAccountSid: 'ACsandbox' + chatId, twilioSubAccountToken: 'tok', leads: leads(n),
  stats: { total: n, completed: 0, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0 }, status: 'created', createdAt: new Date(),
})

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db('p4_sandbox'); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns'), ledger = db.collection('walletLedger')
  await bulk.initBulkCallService(db, botStub, twilioStub, walletOf, null)
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }
  const settle = (cid, idx, dur) => bulk.onCallStatusUpdate('CA' + String(idx).padStart(32, '0'), cid, idx, 'completed', dur, 'normal')

  // ── JRN-40/42: 10 leads, concurrency 1, legs 0..2 run (65 s each), sub-account suspended from lead 3 ──
  const A = '9000000400', cidA = 'p4-camp-A'
  await walletOf.insertOne({ _id: A, usdIn: 50, usdOut: 0 })
  await camps.insertOne(campaignDoc(cidA, A, 10, 1))
  suspendFromLead = 3
  const bal0 = await balance(A)
  await bulk.startCampaign(cidA)
  for (const i of [0, 1, 2]) await settle(cidA, i, 65)
  const cA = await camps.findOne({ id: cidA })
  const dialsA = dials.filter((d) => d.subSid === 'ACsandbox' + A).map((d) => d.idx)
  const pendingNotCalled = cA.leads.filter((l) => l.status === 'pending' && l.notCalled).map((l) => l.index)
  ok('JRN-40', 'first suspended leg ends the whole campaign (cancelled, "provider suspended")', cA.status === 'cancelled' && cA.cancelledReason === 'provider suspended' && cA.completedAt, `status=${cA.status} reason=${cA.cancelledReason}`)
  ok('JRN-40', 'leads 4..9 never dialled (dials = 0,1,2 + the failing lead 3 only)', JSON.stringify(dialsA) === '[0,1,2,3]', `dialled=${JSON.stringify(dialsA)}`)
  ok('JRN-40', 'remaining leads 3..9 marked not called (status pending + notCalled)', JSON.stringify(pendingNotCalled) === '[3,4,5,6,7,8,9]', `notCalled=${JSON.stringify(pendingNotCalled)}`)
  const rowsA = await ledger.find({ chatId: A }).toArray()
  const chargedA = r2(rowsA.reduce((a, l) => a + Math.abs(Number(l.amount) || 0), 0))
  const bal1 = await balance(A)
  ok('JRN-42', 'wallet charged only for the 3 legs that ran; $0 for failed/undialled; balance = start − real charges', rowsA.length === 3 && r2(bal0 - bal1) === chargedA && chargedA > 0, `start=${bal0} end=${bal1} ledger=${rowsA.length} rows/$${chargedA} (legs: ${rowsA.map((l) => Math.abs(l.amount)).join(', ')})`)

  // ── In-flight leg settles normally: concurrency 2, lead 0 in flight when lead 1 hits the suspension ──
  const B = '9000000401', cidB = 'p4-camp-B'
  await walletOf.insertOne({ _id: B, usdIn: 50, usdOut: 0 })
  await camps.insertOne(campaignDoc(cidB, B, 6, 2))
  suspendFromLead = 1
  const balB0 = await balance(B)
  await bulk.startCampaign(cidB)
  const cB1 = await camps.findOne({ id: cidB })
  await settle(cidB, 0, 125)
  const cB2 = await camps.findOne({ id: cidB })
  const rowsB = await ledger.find({ chatId: B }).toArray()
  const dialsB = dials.filter((d) => d.subSid === 'ACsandbox' + B).map((d) => d.idx)
  ok('JRN-40', 'in-flight leg settles + bills normally after the campaign ended; no further dial', cB1.status === 'cancelled' && cB2.leads[0].status === 'completed' && rowsB.length === 1 && r2(balB0 - (await balance(B))) === r2(Math.abs(rowsB[0].amount)) && JSON.stringify(dialsB) === '[0,1]', `dialled=${JSON.stringify(dialsB)} lead0=${cB2.leads[0].status} billed=${rowsB.map((l) => Math.abs(l.amount))}`)

  // ── JRN-41: restart → recovery must not resume either campaign ──
  const before = dials.length
  await bulk.recoverRunningCampaigns()
  const after = (await camps.find({ id: { $in: [cidA, cidB] } }).toArray()).map((c) => c.status)
  ok('JRN-41', 'restart (recoverRunningCampaigns) → 0 dial attempts; campaigns stay cancelled', dials.length === before && after.every((s) => s === 'cancelled'), `new dials=${dials.length - before} statuses=${after}`)

  // ── Customer messaging: no new suspension wording ──
  const suspMsgs = sent.filter((m) => /suspend|carrier|twilio/i.test(m.text))
  ok('JRN-44/REQ-70', 'no customer message mentions suspension/carrier (existing start/progress messages only)', suspMsgs.length === 0, `messages=${sent.length}, mentioning suspension=${suspMsgs.length}`)

  // ── REQ-69: suspension monitoring / notifications / AI support untouched ──
  const { execSync } = require('child_process')
  const protectedFiles = ['js/phone-monitor.js', 'backend/subaccount_monitor.py', 'js/ai-support.js']
  const changed = execSync(`git diff --name-only cfe0fa69 -- ${protectedFiles.join(' ')}`, { cwd: path.join(__dirname, '../..') }).toString().trim().split('\n').filter(Boolean)
  ok('REQ-69', 'phone-monitor, subaccount_monitor, ai-support untouched', changed.length === 0, changed.join(', ') || 'none changed')

  console.log('\n| Journey | Check | Result | Detail |\n|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`)
  const pass = results.filter((r) => r.pass).length
  console.log(`\nRESULT ${pass}/${results.length}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
