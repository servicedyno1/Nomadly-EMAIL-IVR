// Low-lines admin alert. Run: cd /tmp && node /app/js/tests/test_bulkcall_low_lines.js
require('dotenv').config({ path: '/app/backend/.env' })
Object.assign(process.env, { BULK_TELNYX_DIAL_GAP_MS: '5', BULK_DIALER_LEASE: 'off', BULK_LOW_LINES_SAMPLES: '3', BULK_LOW_LINES_EVERY_MS: '3600000', TELEGRAM_ADMIN_CHAT_ID: '999' })
const { MongoClient } = require('mongodb')
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async () => ({ success: true, callControlId: `cc_${Math.random()}` }),
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('/app/js/bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const msgs = []
const admin = () => msgs.filter(m => m.id === '999')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_lowlines`)
  await db.dropDatabase()
  const col = db.collection('bulkCallCampaigns'), W = db.collection('walletOf'); await W.insertOne({ _id: 't', usdIn: 100000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t) => { msgs.push({ id: String(id), t }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const mk = async (name) => {
    const c = await B.createCampaign({ chatId: 't', name, callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 10, provider: 'telnyx', leads: Array.from({ length: 60 }, (_, i) => ({ number: `+1212560${String(i).padStart(4, '0')}` })) })
    await B.startCampaign(c.id); await wait(800); return c
  }
  const c = await mk('Slow one')
  ok('full lines → sample is healthy', (await col.findOne({ id: c.id })).leads.filter(l => l.status === 'calling').length === 10)
  for (let i = 0; i < 3; i++) await B.checkLowLines()
  ok('no alert while all lines are busy', admin().length === 0)
  // 8 of the 10 calls "vanish" (back to waiting) and nothing refills them
  const doc = await col.findOne({ id: c.id }), set = {}
  doc.leads.forEach((l, i) => { if (l.status === 'calling' && Object.keys(set).length < 16) { set[`leads.${i}.status`] = 'pending'; set[`leads.${i}.callSid`] = null } })
  await col.updateOne({ id: c.id }, { $set: set })
  await B.checkLowLines(); await B.checkLowLines()
  ok('no alert before the full window', admin().length === 0)
  await B.checkLowLines()
  const a = admin()
  ok('alert after a full window under half the lines', a.length === 1 && /Slow one/.test(a[0]?.t) && /of <b>10<\/b>/.test(a[0]?.t), a[0]?.t?.slice(0, 160))
  ok('alert names a likely reason', /Likely reason:/.test(a[0]?.t || ''))
  ok('only the admin is told (not the customer)', !msgs.some(m => m.id === 't' && /few lines/.test(m.t)))
  await B.checkLowLines(); await B.checkLowLines(); await B.checkLowLines()
  ok('no repeat alert within the hour', admin().length === 1)
  // waiting for calling hours → never alerts
  const c2 = await mk('Waiting hours')
  const d2 = await col.findOne({ id: c2.id }), s2 = { waitingForHours: true }
  d2.leads.forEach((l, i) => { if (l.status === 'calling') { s2[`leads.${i}.status`] = 'pending'; s2[`leads.${i}.callSid`] = null } })
  await col.updateOne({ id: c2.id }, { $set: s2 })
  for (let i = 0; i < 4; i++) await B.checkLowLines()
  ok('no alert while waiting for calling hours', !admin().some(m => /Waiting hours/.test(m.t)))
  await B.cancelCampaign(c.id, 't').catch(() => {}); await B.cancelCampaign(c2.id, 't').catch(() => {})
  await wait(500); await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
