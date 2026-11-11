// Auto-resume: wallet-paused campaigns continue after a top-up; user-paused stay paused; running-but-orphaned campaigns
// are picked up. Run: cd /tmp && node /app/js/tests/test_bulkcall_auto_resume.js
require('dotenv').config({ path: '/app/backend/.env' })
Object.assign(process.env, { BULK_TELNYX_DIAL_GAP_MS: '5', BULK_DIALER_LEASE: 'off', BULK_LOW_LINES_EVERY_MS: '3600000' })
const { MongoClient } = require('mongodb')
let dialed = 0
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async () => { dialed++; return { success: true, callControlId: `cc_${Math.random()}` } },
  outboundIvrCalls: {}, rehydrateSession: async () => null, hangupOutboundLeg: async () => null,
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('/app/js/bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const msgs = []
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_autoresume`)
  await db.dropDatabase()
  const col = db.collection('bulkCallCampaigns'), W = db.collection('walletOf')
  await W.insertOne({ _id: 'w', usdIn: 0.05, usdOut: 0 }); await W.insertOne({ _id: 'u', usdIn: 1000, usdOut: 0 }); await W.insertOne({ _id: 'o', usdIn: 1000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t) => { msgs.push({ id: String(id), t }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const leads = (p) => Array.from({ length: 30 }, (_, i) => ({ number: `+1212${p}${String(i).padStart(4, '0')}` }))
  const base = { callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 5, provider: 'telnyx' }
  const old = new Date(Date.now() - 10 * 60000)
  // wallet-paused
  const w = await B.createCampaign({ ...base, chatId: 'w', name: 'Wallet one', leads: leads('561') })
  await col.updateOne({ id: w.id }, { $set: { status: 'paused', pausedReason: 'wallet', startedAt: old } })
  // user-paused
  const u = await B.createCampaign({ ...base, chatId: 'u', name: 'User one', leads: leads('562') })
  await col.updateOne({ id: u.id }, { $set: { status: 'paused', pausedReason: 'user', startedAt: old } })
  await B.checkLowLines(); await wait(300)
  ok('wallet-paused stays paused while the wallet is still low', (await col.findOne({ id: w.id })).status === 'paused')
  await W.updateOne({ _id: 'w' }, { $set: { usdIn: 500 } })
  await B.checkLowLines(); await wait(500)
  const wd = await col.findOne({ id: w.id })
  ok('after a top-up it continues by itself', wd.status === 'running' && !wd.pausedReason && dialed >= 5, `status=${wd.status} dialed=${dialed}`)
  ok('customer is told it resumed', msgs.some(m => m.id === 'w' && /Campaign resumed/.test(m.t) && /topped up/.test(m.t)))
  ok('a campaign the customer paused stays paused', (await col.findOne({ id: u.id })).status === 'paused')
  // orphan: running in DB, no server dialing it
  const o = await B.createCampaign({ ...base, chatId: 'o', name: 'Orphan', leads: leads('563') })
  await col.updateOne({ id: o.id }, { $set: { status: 'running', startedAt: old, resumedAt: old } })
  const d0 = dialed
  await B.checkLowLines(); await wait(4500)
  ok('running campaign nobody dials is picked up within a minute', dialed >= d0 + 5, `dialed ${dialed - d0}`)
  // a fresh one (just started) is not touched by the pick-up
  const f = await B.createCampaign({ ...base, chatId: 'o', name: 'Fresh', leads: leads('564') })
  await col.updateOne({ id: f.id }, { $set: { status: 'running', startedAt: new Date() } })
  const d1 = dialed
  await B.checkLowLines(); await wait(800)
  ok('just-started campaigns are left alone', dialed === d1)
  for (const id of [w.id, u.id, o.id, f.id]) await B.cancelCampaign(id, 't').catch(() => {})
  await wait(500); await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
