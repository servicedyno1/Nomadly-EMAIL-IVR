// Deploy handover + low-lines alert. Run: cd /tmp && node /app/js/tests/test_bulkcall_handover.js
require('dotenv').config({ path: '/app/backend/.env' })
Object.assign(process.env, { BULK_TELNYX_DIAL_GAP_MS: '5', BULK_DIALER_LEASE: 'on', BULK_DIALER_LEASE_TICK_MS: '300', BULK_DIALER_LEASE_TTL_MS: '1500', BULK_DIALER_APP: 'handover-test', BULK_LOW_LINES_SAMPLES: '3', BULK_LOW_LINES_EVERY_MS: '3600000', TELEGRAM_ADMIN_CHAT_ID: '999' })
const { MongoClient } = require('mongodb')
let dialed = 0
const hold = new Set()
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async () => { dialed++; const id = `cc_${Math.random()}`; hold.add(id); return { success: true, callControlId: id } },
  outboundIvrCalls: new Proxy({}, { get: (_, k) => (hold.has(k) ? {} : undefined) }),
  rehydrateSession: async () => null, hangupOutboundLeg: async () => null,
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('/app/js/bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const msgs = []
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_handover`)
  await db.dropDatabase()
  const L = db.collection('bulkDialerLease'), col = db.collection('bulkCallCampaigns')
  // the "old server" holds the lease
  await L.insertOne({ _id: 'bulkDialer:handover-test', owner: 'old-server', expiresAt: new Date(Date.now() + 60000) })
  const W = db.collection('walletOf'); await W.insertOne({ _id: 't', usdIn: 100000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t) => { msgs.push({ id, t }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const leads = Array.from({ length: 60 }, (_, i) => ({ number: `+1212559${String(i).padStart(4, '0')}` }))
  const c = await B.createCampaign({ chatId: 't', name: 'Handover', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 10, provider: 'telnyx', leads })
  await B.startCampaign(c.id); await wait(1200)
  ok('new server does not dial while the old one holds the lease', dialed === 0 && !B.dialerStatus().holder, `dialed=${dialed}`)
  // old server drains (keeps lease) then exits (releases)
  await wait(600)
  ok('still nothing while the old server drains', dialed === 0)
  await L.deleteOne({ _id: 'bulkDialer:handover-test' }); await wait(1500)
  ok('takes over and dials as soon as the old server lets go', B.dialerStatus().holder && dialed === 10, `dialed=${dialed}`)
  const lease = await L.findOne({ _id: 'bulkDialer:handover-test' })
  ok('lease now belongs to this server and is renewed', lease && lease.owner !== 'old-server' && new Date(lease.expiresAt) > new Date())

  // low lines: only 2 of 10 in flight, rest pending
  const doc = await col.findOne({ id: c.id })
  const set = {}; doc.leads.forEach((l, i) => { if (i >= 2) { set[`leads.${i}.status`] = 'pending'; set[`leads.${i}.callSid`] = null } })
  await col.updateOne({ id: c.id }, { $set: set })
  B.stopDialing('test')  // freeze dialing so the sample stays low
  await wait(200)
  const s1 = B.dialerStatus()
  ok('stopDialing: draining, lease kept', s1.draining && s1.holder)
  const before = dialed; await wait(800)
  ok('no new calls while draining', dialed === before)
  for (let i = 0; i < 4; i++) await B.checkLowLines()
  ok('no low-lines alert from a server that is handing over', !msgs.some(m => m.id === '999'))
  B.resumeDialing()
  ok('handover cancelled → dials again', !B.dialerStatus().draining && B.dialerStatus().holder)
  await B.stopDialing('test')
  await B.releaseDialer()
  ok('releaseDialer hands the lease over', !(await L.findOne({ _id: 'bulkDialer:handover-test' })))
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
