// Large lists, pay-less choices: 'part' = first 500 now, rest wait unpaid (wallet checked per part, can drop);
// 'first' = only the first 500, rest dropped. Run: cd /tmp && node /app/js/tests/test_bulkcall_split_partial.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.BULK_TELNYX_DIAL_GAP_MS = '5'
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
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_split_partial`)
  await db.dropDatabase()
  const W = db.collection('walletOf'), col = db.collection('bulkCallCampaigns')
  // 'p' can afford ~1 part (estimate ≈ $0.15/lead → 500 ≈ $75); 'z' can afford nothing
  await W.insertOne({ _id: 'p', usdIn: 100, usdOut: 0 }); await W.insertOne({ _id: 'z', usdIn: 1, usdOut: 0 })
  await B.initBulkCallService(db, { sendMessage: async (id, t, o) => { msgs.push({ id, t, o }); return {} }, sendDocument: async () => ({}) }, {}, W, null)
  const leads = Array.from({ length: 1240 }, (_, i) => ({ number: `+1212557${String(i).padStart(4, '0')}` }))
  const base = { chatId: 'p', callerId: '+14155551001', audioUrl: 'https://x/a.mp3', audioName: 'A', mode: 'report_only', concurrency: 5, provider: 'telnyx' }
  const one = B.estimateLeadsCost(leads.slice(0, 500)).total, all = B.estimateLeadsCost(leads).total
  ok('test wallet covers 1 part but not all', 100 >= one && 100 < all, `part=$${one} all=$${all}`)

  ok('all-parts mode still blocked for this wallet', (await B.createSeries({ ...base, leads }, { mode: 'auto' })).code === 'series_funds')

  // first-only
  const f = await B.createSeries({ ...base, leads }, { mode: 'first' })
  const fd = await col.findOne({ id: f.id })
  ok('first: one campaign of the first 500, in order', !f.error && fd.leads.length === 500 && fd.leads[0].number === leads[0].number && fd.leads[499].number === leads[499].number, f.error)
  ok('first: no split, remembers original size', !fd.splitId && fd.trimmedFrom === 1240)
  ok('first: nothing else saved', (await col.countDocuments({ chatId: 'p' })) === 1)
  ok('first: wallet must cover 500', /first 500/.test((await B.createSeries({ ...base, chatId: 'z', leads }, { mode: 'first' })).error || ''))

  // pay per part
  const s = await B.createSeries({ ...base, leads }, { mode: 'part' })
  const parts = await col.find({ splitId: s.splitId }).sort({ part: 1 }).toArray()
  ok('part: 3 parts 500/500/240, wallet covered part 1 only', !s.error && parts.map(p => p.leads.length).join('/') === '500/500/240', s.error)
  ok('part: never auto-starts, marked pay-per-part', parts.every(p => p.payPerPart && !p.autoNext) && parts.slice(1).every(p => p.status === 'series_waiting'))
  ok('part: blocked when wallet cannot cover part 1', /cover part 1/.test((await B.createSeries({ ...base, chatId: 'z', leads }, { mode: 'part' })).error || ''))
  await col.updateOne({ id: parts[0].id }, { $set: { status: 'completed', completedAt: new Date() } })
  await B.sendFinalReport(parts[0].id); await wait(800)
  ok('part: part 2 becomes ready (not running)', (await col.findOne({ id: parts[1].id })).status === 'series_ready')
  const m = msgs.find(x => x.o?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `bcnext:${parts[1].id}`)
  ok('part: bot shows Start + Drop buttons and the part cost', !!m && m.o.reply_markup.inline_keyboard[1][0].callback_data === `bcdrop:${parts[1].id}` && /wallet must cover this part/.test(m.t))
  await W.updateOne({ _id: 'p' }, { $set: { usdIn: 1 } })
  const low = await B.startSeriesPart(parts[1].id, 'p')
  ok('part: start refused when wallet can’t cover this part, stays ready', low.lowBalance && /cover part 2/.test(low.error) && (await col.findOne({ id: parts[1].id })).status === 'series_ready', low.error)
  await W.updateOne({ _id: 'p' }, { $set: { usdIn: 100 } })
  ok('part: another account cannot drop', !!(await B.dropSeriesRest(parts[1].id, 'z')).error)
  const d = await B.dropSeriesRest(parts[1].id, 'p')
  const after = await col.find({ splitId: s.splitId }).sort({ part: 1 }).toArray()
  ok('part: drop cancels parts 2 and 3', d.dropped === 2 && after.slice(1).every(p => p.status === 'cancelled'), JSON.stringify(d))
  ok('part: dropping again → clear error', !!(await B.dropSeriesRest(parts[1].id, 'p')).error)

  // pay per part → start next after topping up
  const s2 = await B.createSeries({ ...base, leads: leads.slice(0, 700) }, { mode: 'part' })
  const p2 = await col.find({ splitId: s2.splitId }).sort({ part: 1 }).toArray()
  await col.updateOne({ id: p2[0].id }, { $set: { status: 'completed', completedAt: new Date() } })
  await B.sendFinalReport(p2[0].id); await wait(800)
  const st = await B.startSeriesPart(p2[1].id, 'p'); await wait(500)
  ok('part: funded customer starts part 2', !st?.error && (await col.findOne({ id: p2[1].id })).status === 'running', st?.error)
  await W.updateOne({ _id: 'p' }, { $set: { usdIn: 100000 } })
  const s3 = await B.createSeries({ ...base, leads: leads.slice(0, 1100) }, { mode: 'ask' })
  const p3 = await col.find({ splitId: s3.splitId }).sort({ part: 1 }).toArray()
  const d3 = await B.dropSeriesRest(p3[2].id, 'p')
  ok('waiting part 3 dropped before it is ready; part 2 kept', d3.dropped === 1 && (await col.findOne({ id: p3[1].id })).status === 'series_waiting')
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
