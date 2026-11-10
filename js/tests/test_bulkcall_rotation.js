// Caller-ID rotation: 1,000 leads × 10 caller IDs → 10 calls at once, each from a different caller ID; even spread; pool persists.
// Run from /app: node js/tests/test_bulkcall_rotation.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.BULK_CALL_MAX_LEADS = '2000'; process.env.BULK_TELNYX_DIAL_GAP_MS = '50'
const path = require('path'), { MongoClient } = require('mongodb')
const dials = [] // {callerId, showAs, to}
const vsPath = require.resolve('../voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async (o) => { dials.push({ callerId: o.callerId, showAs: o.displayCallerId, to: o.targetNumber, lead: o.leadIndex }); return { success: true, callControlId: `cc_${dials.length}` } },
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('../bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_rotation`)
  await db.dropDatabase()
  await db.collection('walletOf').insertOne({ _id: '777', usdIn: 100000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async () => ({}) }, {}, db.collection('walletOf'), null)
  const own = Array.from({ length: 9 }, (_, i) => ({ callerId: `+1415555${String(1001 + i)}` }))
  const leads = Array.from({ length: 1000 }, (_, i) => ({ number: `+1212555${String(1000 + i).padStart(4, '0')}`, name: '' }))
  const c = await B.createCampaign({ chatId: '777', callerId: '+14155550999', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 5, leads, provider: 'telnyx', callerPool: own })
  ok('pool of 10 saved with the campaign; concurrency = 10', c.callerPool?.length === 10 && c.concurrency === 10, JSON.stringify({ n: c.callerPool?.length, conc: c.concurrency, err: c.error }))
  const stored = await db.collection('bulkCallCampaigns').findOne({ id: c.id })
  ok('selection persists in the DB', stored.callerPool.length === 10 && stored.callerPool[0].callerId === '+14155550999')
  const r = await B.startCampaign(c.id); await wait(4000)
  const first = dials.slice(0, 10)
  ok('first wave: 10 calls at once, all from different caller IDs', dials.length === 10 && new Set(first.map(d => d.callerId)).size === 10, `${dials.length} dials, ${new Set(first.map(d => d.callerId)).size} distinct`)
  const doc = await db.collection('bulkCallCampaigns').findOne({ id: c.id })
  ok('each claimed lead records its caller ID', doc.leads.filter(l => l.status === 'calling').every(l => l.callerId) && doc.leads.filter(l => l.status === 'calling').length === 10)
  // finish calls in waves; each wave must reuse every caller ID exactly once
  let waves = 0, bad = 0
  for (; waves < 9; waves++) {
    const live = (await db.collection('bulkCallCampaigns').findOne({ id: c.id })).leads.filter(l => l.status === 'calling')
    for (const l of live) await B.onCallComplete(l.callSid || 'x', { campaignId: c.id, leadIndex: l.index, answeredAt: new Date(), hangupCause: 'normal_clearing', duration: 5 })
    await wait(3500)
    const w = dials.slice(10 * (waves + 1), 10 * (waves + 2))
    if (w.length !== 10 || new Set(w.map(d => d.callerId)).size !== 10) bad++
  }
  ok('next 9 waves also run 10 at once from 10 different caller IDs', bad === 0 && dials.length >= 100, `${dials.length} dials, bad waves ${bad}`)
  const per = {}; for (const d of dials) per[d.callerId] = (per[d.callerId] || 0) + 1
  ok('volume spread evenly (no caller ID ahead by more than 1)', Math.max(...Object.values(per)) - Math.min(...Object.values(per)) <= 1, JSON.stringify(Object.values(per)))
  const v = await B.createCampaign({ chatId: '777', callerId: '+14155550999', audioUrl: 'https://x/a.mp3', mode: 'report_only', leads: leads.slice(0, 20), provider: 'telnyx', callerPool: [{ callerId: '+14155550999', showAs: '+13055550101' }, { callerId: '+14155550999', showAs: '+13055550102' }] })
  ok('verified caller IDs ride on the primary number with their own shown ID', v.callerPool.length === 3 && v.callerPool.filter(e => e.showAs).length === 2 && v.concurrency === 3)
  const single = await B.createCampaign({ chatId: '777', callerId: '+14155550999', audioUrl: 'https://x/a.mp3', mode: 'report_only', concurrency: 7, leads: leads.slice(0, 5), provider: 'telnyx' })
  ok('no pool → unchanged single caller ID campaign', !single.callerPool && single.concurrency === 7)
  console.log(`\n${pass} passed, ${fail} failed`)
  await B.cancelCampaign?.(c.id).catch?.(() => {})
  await db.dropDatabase(); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
