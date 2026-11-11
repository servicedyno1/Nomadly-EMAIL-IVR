// Web caller-ID rotation (poolShare): 3 caller IDs + 20 calls at once → 20 live calls spread ~7/7/6; bots unchanged.
// Run from /app: node js/tests/test_bulkcall_rotation_shared.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.BULK_CALL_MAX_LEADS = '2000'; process.env.BULK_TELNYX_DIAL_GAP_MS = '20'
const { MongoClient } = require('mongodb')
const dials = []
const vsPath = require.resolve('../voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async (o) => { dials.push({ callerId: o.callerId, lead: o.leadIndex }); return { success: true, callControlId: `cc_${dials.length}` } },
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('../bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const spread = (list) => { const p = {}; for (const d of list) p[d.callerId] = (p[d.callerId] || 0) + 1; return Object.values(p).sort((a, b) => b - a) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_rotation_shared`)
  await db.dropDatabase()
  await db.collection('walletOf').insertOne({ _id: '778', usdIn: 100000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async () => ({}) }, {}, db.collection('walletOf'), null)
  const leads = Array.from({ length: 200 }, (_, i) => ({ number: `+1212556${String(1000 + i).padStart(4, '0')}`, name: '' }))
  const pool = [{ callerId: '+14155551002' }, { callerId: '+14155551003' }]
  const c = await B.createCampaign({ chatId: '778', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 20, poolShare: true, leads, provider: 'telnyx', callerPool: pool })
  ok('web: 3 caller IDs keep the chosen 20 calls at once', c.callerPool?.length === 3 && c.concurrency === 20 && c.poolShare === true, JSON.stringify({ n: c.callerPool?.length, conc: c.concurrency }))
  await B.startCampaign(c.id); await wait(3000)
  ok('first wave: 20 calls at once across the 3 caller IDs', dials.length === 20, `${dials.length} dials`)
  ok('spread evenly 7/7/6', JSON.stringify(spread(dials)) === '[7,7,6]', JSON.stringify(spread(dials)))
  // finish 5 calls → exactly 5 new ones, still balanced
  const live = (await db.collection('bulkCallCampaigns').findOne({ id: c.id })).leads.filter(l => l.status === 'calling').slice(0, 5)
  for (const l of live) await B.onCallComplete(l.callSid || 'x', { campaignId: c.id, leadIndex: l.index, answeredAt: new Date(), hangupCause: 'normal_clearing', duration: 5 })
  await wait(2500)
  const now = (await db.collection('bulkCallCampaigns').findOne({ id: c.id })).leads.filter(l => l.status === 'calling')
  ok('refills back to 20 live calls', now.length === 20 && dials.length === 25, `${now.length} live, ${dials.length} dials`)
  const liveSpread = spread(now.map(l => ({ callerId: l.callerId })))
  ok('live calls stay balanced (max − min ≤ 1)', liveSpread[0] - liveSpread[liveSpread.length - 1] <= 1, JSON.stringify(liveSpread))
  const big = await B.createCampaign({ chatId: '778', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', mode: 'report_only', concurrency: 99, poolShare: true, leads: leads.slice(0, 10), provider: 'telnyx', callerPool: pool })
  ok('web: 3 IDs cap at 20 at once', big.concurrency === 20, String(big.concurrency))
  const many = Array.from({ length: 29 }, (_, i) => ({ callerId: `+1415557${String(1000 + i)}` }))
  const m = await B.createCampaign({ chatId: '778', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', mode: 'report_only', concurrency: 99, poolShare: true, leads: leads.slice(0, 10), provider: 'telnyx', callerPool: many })
  ok('web: 30 IDs allow up to 30 at once', m.concurrency === 30, String(m.concurrency))
  const bot = await B.createCampaign({ chatId: '778', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', mode: 'report_only', concurrency: 20, leads: leads.slice(0, 10), provider: 'telnyx', callerPool: pool })
  ok('bot (no poolShare): unchanged — one call per caller ID', bot.concurrency === 3 && !bot.poolShare, String(bot.concurrency))
  console.log(`\n${pass} passed, ${fail} failed`)
  await B.cancelCampaign?.(c.id).catch?.(() => {})
  await db.dropDatabase(); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
