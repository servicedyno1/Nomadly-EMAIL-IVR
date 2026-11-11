// Engagement: hot-lead-only per-call alerts, 25/50/75% digests, final report reach/cost/best hour, follow-ups, live rate.
// Run: cd /tmp && node /app/js/tests/test_bulkcall_engagement.js
require('dotenv').config({ path: '/app/backend/.env' })
Object.assign(process.env, { BULK_TELNYX_DIAL_GAP_MS: '5', BULK_DIALER_LEASE: 'off', BULK_LOW_LINES_EVERY_MS: '3600000' })
const { MongoClient } = require('mongodb')
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async () => ({ success: true, callControlId: `cc_${Math.random()}` }),
  outboundIvrCalls: {}, recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('/app/js/bulk-call-service.js'), ENG = require('/app/js/bulk-engagement.js'), LIVE = require('/app/js/cloudivr-web/campaign-live.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const msgs = []
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_engage`)
  await db.dropDatabase()
  const col = db.collection('bulkCallCampaigns'), W = db.collection('walletOf'); await W.insertOne({ _id: 'e', usdIn: 1000, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t, o) => { msgs.push({ id: String(id), t, o }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const leads = Array.from({ length: 20 }, (_, i) => ({ number: `+1212561${String(i).padStart(4, '0')}` }))
  const c = await B.createCampaign({ chatId: 'e', name: 'Engage', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'transfer', transferNumber: '+14155550142', activeKeys: ['1'], concurrency: 2, provider: 'telnyx', leads })
  await B.startCampaign(c.id); await wait(500)
  const finish = async (i, r) => { const d = await col.findOne({ id: c.id }); await B.onCallComplete(d.leads[i].callSid || `x${i}`, { campaignId: c.id, leadIndex: i, ...r }) }
  // simulate results through the real completion path
  const doc = await col.findOne({ id: c.id })
  const set = {}; doc.leads.forEach((l, i) => { set[`leads.${i}.status`] = 'calling'; set[`leads.${i}.callSid`] = `x${i}`; set[`leads.${i}.startedAt`] = new Date() })
  await col.updateOne({ id: c.id }, { $set: set })
  const n0 = msgs.length
  for (let i = 0; i < 4; i++) await finish(i, { hangupCause: 'timeout', duration: 0 })
  await wait(300)
  ok('no per-call message for no-answer calls', !msgs.slice(n0).some(m => /No answer/.test(m.t)), msgs.slice(n0).map(m => m.t.slice(0, 40)).join(' | '))
  const dig = msgs.slice(n0).filter(m => /% done/.test(m.t))
  ok('no digest before 25%', dig.length === 0)
  const n1 = msgs.length
  await finish(4, { duration: 40, answeredAt: new Date(), digitPressed: '1', transferred: true, transferConnected: true })
  await wait(300)
  ok('hot lead alert sent right away', msgs.slice(n1).some(m => /Hot lead!/.test(m.t) && m.t.includes('+12125610004')), msgs.slice(n1).map(m => m.t.slice(0, 50)).join(' | '))
  for (let i = 5; i < 20; i++) await finish(i, i < 12 ? { duration: 45, answeredAt: new Date() } : i < 16 ? { duration: 30, answeredAt: new Date(), answeredBy: 'machine', voicemailDropped: true } : { hangupCause: 'user_busy', duration: 0 })
  await wait(1500)
  const d = await col.findOne({ id: c.id })
  ok('digests at 25, 50 and 75% (once each)', ['25% done', '50% done', '75% done'].every(k => msgs.filter(m => m.t.includes(k)).length === 1), msgs.filter(m => /% done/.test(m.t)).map(m => m.t.slice(0, 30)).join(' | '))
  const e = ENG.engagementOf(d)
  ok('engagement counts', e.called === 20 && e.hot === 1 && e.unanswered >= 4 && e.reached >= 8, JSON.stringify({ called: e.called, hot: e.hot, unanswered: e.unanswered, reached: e.reached, vm: e.voicemails, listened: e.listened }))
  const fin = msgs.find(m => /people reached your message/.test(m.t) && m.o?.reply_markup)
  ok('final report shows reach + follow-up buttons', !!fin && fin.o.reply_markup.inline_keyboard.flat().some(b => b.callback_data === `bcfu:u:${c.id}`), fin?.t?.slice(-300))
  const f = await B.createFollowup(c.id, 'e', 'unanswered')
  const fd = await col.findOne({ id: f.id })
  ok('follow-up: unanswered numbers, same settings', !f.error && fd.leads.length === e.unanswered && fd.mode === 'transfer' && fd.transferNumber === '+14155550142' && fd.followupOf === c.id && fd.status === 'created', f.error || JSON.stringify({ n: fd?.leads?.length, st: fd?.status }))
  const fl = await B.createFollowup(c.id, 'e', 'listeners')
  ok('follow-up: listeners (30s+, no key)', !fl.error && (await col.findOne({ id: fl.id })).leads.every(l => !l.number.endsWith('0004')), fl.error)
  ok('other account cannot create a follow-up', !!(await B.createFollowup(c.id, 'zz', 'unanswered')).error)
  // live rate: 30 calls finished in the first 60s → ~30/min, not 6/min
  const now = Date.now(), fake = { status: 'running', startedAt: new Date(now - 60000), leads: Array.from({ length: 60 }, (_, i) => i < 30 ? { status: 'no_answer', completedAt: new Date(now - i * 1000) } : { status: 'pending' }) }
  const lv = LIVE.liveView(fake, {}, now)
  ok('live rate uses time since start (fresh campaign not shown slow)', lv.ratePerMin === 30 && lv.etaSec === 60, JSON.stringify({ rate: lv.ratePerMin, eta: lv.etaSec }))
  ok('live view carries reach numbers', 'people' in lv && 'hot' in lv)
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
