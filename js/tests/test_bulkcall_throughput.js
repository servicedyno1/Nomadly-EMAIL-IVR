// Throughput: a 20-line campaign must keep ~20 calls going while calls finish (prod 2026-11-11: fell to ~1 call/min
// because every finishing call started its own batch and each batch burned a global dial slot per already-claimed lead).
// Run: cd /tmp && node /app/js/tests/test_bulkcall_throughput.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.BULK_TELNYX_DIAL_GAP_MS = '50'
const { MongoClient } = require('mongodb')
let live = 0, peak = 0, dialed = 0
const B = (() => {
  const vsPath = require.resolve('/app/js/voice-service.js')
  require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
    initiateOutboundIvrCall: async (o) => {
      const id = `cc_${Math.random()}`; dialed++; live++; peak = Math.max(peak, live)
      setTimeout(() => { live--; require('/app/js/bulk-call-service.js').onCallComplete(id, { campaignId: o.campaignId, leadIndex: o.leadIndex, hangupCause: 'timeout' }) }, 1500 + Math.random() * 300)
      return { success: true, callControlId: id }
    },
    recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
  } }
  return require('/app/js/bulk-call-service.js')
})()
const wait = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_throughput`)
  await db.dropDatabase()
  const W = db.collection('walletOf'); await W.insertOne({ _id: 't', usdIn: 100000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async () => ({}), sendDocument: async () => ({}) }, {}, W, null)
  const leads = Array.from({ length: 400 }, (_, i) => ({ number: `+1212558${String(i).padStart(4, '0')}` }))
  const c = await B.createCampaign({ chatId: 't', callerId: '+14155551001', callerPool: [{ callerId: '+14155551001' }, { callerId: '+14155551001', showAs: '+14155551002' }], poolShare: true, audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 20, provider: 'telnyx', leads })
  await B.startCampaign(c.id)
  await wait(8000)
  const lowLive = []
  for (let i = 0; i < 10; i++) { lowLive.push(live); await wait(300) }
  const avg = lowLive.reduce((a, b) => a + b, 0) / lowLive.length
  console.log(`dialed in ~11s: ${dialed}, peak live ${peak}, steady live avg ${avg.toFixed(1)}`)
  const ok = dialed >= 100 && avg >= 16
  console.log(ok ? '✅ keeps the lines full while calls finish' : '❌ throughput collapsed')
  await B.cancelCampaign(c.id, 'test').catch(() => {})
  await wait(1500); await db.dropDatabase(); await cl.close()
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
