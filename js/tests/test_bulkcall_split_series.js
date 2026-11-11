// Split lists (owner choice 2026-06): >500 numbers → parts of 500 in file order, one at a time; wallet must cover all
// parts at launch; next part starts by itself (autoNext) or waits for the customer; stopping a part stops the rest.
// Run: cd /tmp && node /app/js/tests/test_bulkcall_split_series.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.BULK_TELNYX_DIAL_GAP_MS = '5'
const { MongoClient } = require('mongodb')
const dials = []
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: {
  initiateOutboundIvrCall: async (o) => { dials.push(o.leadIndex); return { success: true, callControlId: `cc_${dials.length}` } },
  recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}),
} }
const B = require('/app/js/bulk-call-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const msgs = []
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_split_series`)
  await db.dropDatabase()
  const W = db.collection('walletOf'), col = db.collection('bulkCallCampaigns')
  await W.insertOne({ _id: '901', usdIn: 100000, usdOut: 0 }); await W.insertOne({ _id: '902', usdIn: 5, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t, o) => { msgs.push({ id, t, o }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const leads = Array.from({ length: 1240 }, (_, i) => ({ number: `+1212557${String(i).padStart(4, '0')}`, name: `L${i}` }))
  const base = { chatId: '901', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 5, provider: 'telnyx' }

  const s = await B.createSeries({ ...base, leads }, { autoNext: true })
  const parts = await col.find({ splitId: s.splitId }).sort({ part: 1 }).toArray()
  ok('1,240 numbers → 3 parts of 500/500/240', parts.map(p => p.leads.length).join('/') === '500/500/240', parts.map(p => p.leads.length).join('/'))
  ok('file order kept across parts', parts[1].leads[0].number === leads[500].number && parts[2].leads[239].number === leads[1239].number)
  ok('only part 1 ready; parts 2–3 wait', parts[0].status === 'created' && parts.slice(1).every(p => p.status === 'series_waiting'), parts.map(p => p.status).join(','))
  ok('small list → normal campaign (no split)', !(await B.createSeries({ ...base, leads: leads.slice(0, 300) })).splitId)
  const big = await B.createSeries({ ...base, leads: Array.from({ length: 5001 }, (_, i) => ({ number: `+1212558${String(i % 10000).padStart(4, '0')}` })) })
  ok('over 5,000 → only first-500 / pay-per-part allowed', big.code === 'series_too_big', big.error)
  const poor = await B.createSeries({ ...base, chatId: '902', leads })
  ok('wallet must cover all parts at launch', poor.code === 'series_funds' && /all 3 parts/.test(poor.error) && !(await col.countDocuments({ chatId: '902' })), poor.error)

  // auto: part 1 finishes → part 2 starts by itself
  await col.updateOne({ id: parts[0].id }, { $set: { status: 'completed', completedAt: new Date() } })
  await B.sendFinalReport(parts[0].id); await wait(1500)
  ok('auto: part 2 starts when part 1 is done', (await col.findOne({ id: parts[1].id })).status === 'running')
  ok('auto: part 3 still waits', (await col.findOne({ id: parts[2].id })).status === 'series_waiting')
  ok('auto: customer told "Part 2 of 3 … starting now"', msgs.some(m => /Part 2 of 3 \(500 numbers\) starting now/.test(m.t)))
  // stopping part 2 stops the rest
  await B.cancelCampaign(parts[1].id); await wait(1200)
  ok('stop part 2 → part 3 cancelled too', (await col.findOne({ id: parts[2].id })).status === 'cancelled')
  ok('customer told the rest will not run', msgs.some(m => /Series stopped/.test(m.t)))

  // ask mode: part 1 done → part 2 ready + button; customer starts it
  const a = await B.createSeries({ ...base, leads: leads.slice(0, 700) }, { autoNext: false })
  const ap = await col.find({ splitId: a.splitId }).sort({ part: 1 }).toArray()
  await col.updateOne({ id: ap[0].id }, { $set: { status: 'completed', completedAt: new Date() } })
  await B.sendFinalReport(ap[0].id); await wait(800)
  ok('ask: part 2 waits for the customer', (await col.findOne({ id: ap[1].id })).status === 'series_ready')
  const btn = msgs.find(m => m.o?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `bcnext:${ap[1].id}`)
  ok('ask: bot gets "Start part 2 of 2" button', !!btn && /Start part 2 of 2/.test(btn.o.reply_markup.inline_keyboard[0][0].text))
  ok('ask: another account cannot start it', !!(await B.startSeriesPart(ap[1].id, '999')).error)
  const r = await B.startSeriesPart(ap[1].id, '901'); await wait(800)
  ok('ask: customer starts part 2', !r?.error && (await col.findOne({ id: ap[1].id })).status === 'running', r?.error)
  await col.updateOne({ id: ap[1].id }, { $set: { status: 'completed', completedAt: new Date() } })
  await B.sendFinalReport(ap[1].id); await wait(500)
  ok('last part done → "Series finished"', msgs.some(m => /Series finished/.test(m.t) && /all 2 parts/.test(m.t)))
  // repeat campaigns (seriesId) are not affected
  const rep = await B.createCampaign({ ...base, leads: leads.slice(0, 5) })
  await col.updateOne({ id: rep.id }, { $set: { seriesId: 'rep-1', status: 'completed', completedAt: new Date() } })
  const before = msgs.length; await B.sendFinalReport(rep.id); await wait(300)
  ok('repeat campaigns untouched (no series messages)', !msgs.slice(before).some(m => /Part \d|Series/.test(m.t)))

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of await col.find({ status: 'running' }).toArray()) await B.cancelCampaign(c.id, 'test end', { sendReport: false }).catch(() => {})
  await db.dropDatabase(); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
