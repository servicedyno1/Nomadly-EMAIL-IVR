// eSIM BulkSMS automation check: per-line daily cap + warm-up, projected bookings that buy lines, credit forecast gate,
// auto-replace with delivery test, plan expiry. Simulated provider. Run from /app: node js/tests/test_bulk_esim_autoscale.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
const COLS = ['bsConfig', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const DAY = 86400000, d = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  process.env.BULK_ESIM_WORKER = ''
  let provCalls = 0; const realProv = P.provision; P.provision = async (...a) => { provCalls++; return realProv(...a) }
  const c = await B.cfg()
  ok('defaults: 400/line/day, no warm-up, 1 lead day, dynamic ceilings (maxEsims 0, budget 0), reserve one booking, auto-replace on, auto-buy off', c.esimDailyLimit === 400 && c.warmupDays === 0 && c.leadDays === 1 && c.maxEsims === 0 && c.provisionBudget === 0 && c.reserveBooking === true && c.demandDays === 14 && c.autoReplace === true && c.autoProvision === false)
  ok('line ceiling derived from Spenza rate × open hours (10 h → 14,400/day → 45 lines)', B.dayCeiling(d(3), c) === 14400 && B.maxLines(c, d(3)) === 45 && B.maxLines({ ...c, maxEsims: 7 }) === 7)
  ok('no ramp: full cap from day 1 (ramp available via warmupDays)', [1, 2, 9].map(a => B.lineCap(c, a)).join() === '400,400,400' && [1, 3, 5].map(a => B.lineCap({ ...c, warmupDays: 5 }, a)).join() === '80,240,400')
  await B.setConfig({ quietStart: 0, quietEnd: 24, reserveBooking: false }, 'test')
  const cust = await B.customer('Nomadly', '501'), cid = cust._id

  // ---- no lines, auto-buy off: refused + demand remembered + daily nudge ----
  const r0 = await B.createBooking(cid, { date: d(3), hour: 12, volume: 600 })
  ok('no lines + auto-buy off → refused, unmet demand recorded', r0.error === 'err_no_lines' && (await B.unmetDemand()) === 600)
  await B.autoscale()
  ok('autoscale nudges admin (no purchase)', provCalls === 0 && alerts.some(a => /needed for the next 7 days/.test(a)))

  // ---- auto-buy on: a booking 3 days ahead is accepted on projected lines, payment buys them ----
  await B.setConfig({ autoProvision: true, manualApproval: false, provisionBudget: 500, maxEsims: 20 }, 'test')
  const cap3 = await B.capacity(d(3), await B.cfg())
  ok('projected capacity counts lines that can still be bought (budget $500 / $10 → 20 max)', cap3.projected === 20 && cap3.perDay === Math.floor(20 * B.lineCap(c, 4) * 0.8), JSON.stringify(cap3))
  ok('today has no projected lines, tomorrow does (lead time 1 day)', (await B.capacity(d(0), await B.cfg())).lines === 0 && (await B.capacity(d(1), await B.cfg())).projected === 20)
  const bk = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 })
  ok('1,000 SMS booked 3 days ahead with zero lines', !!bk.booking && bk.booking.price === 100, JSON.stringify(bk.error || bk.booking?.allocation))
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  const need = Math.ceil(1000 / (B.lineCap(c, 4) * 0.8)), bought = await db.collection('bsEsims').countDocuments()
  ok(`payment buys exactly the ${need} lines the booking needs`, provCalls === need && bought === need && (await db.collection('bsBookings').findOne({ _id: bk.booking._id })).status === 'provisioning', `${provCalls} bought`)
  await db.collection('bsDemand').deleteMany({}); await B.healthCheck(); await B.autoscale()
  ok('lines pass checks, booking becomes scheduled, nothing extra bought', (await db.collection('bsEsims').countDocuments({ status: 'available' })) === need && (await db.collection('bsBookings').findOne({ _id: bk.booking._id })).status === 'scheduled' && provCalls === need)

  // ---- per-line daily cap in the send loop ----
  await B.setConfig({ platformPerMin: 10000, esimPerMin: 10000, esimDailyLimit: 3, warmupDays: 1 }, 'test')
  for (let i = 0; i < 20; i++) await B.sendOne(cid, `+1212555${3000 + i}`, `hello ${i}`)
  for (let i = 0; i < 25; i++) await B.tick()
  const sentNow = await db.collection('bsMessages').countDocuments({ status: 'sent', cid }), perLine = await db.collection('bsEsimDaily').find().toArray()
  ok(`send loop stops each line at its daily cap (${need} lines × 3)`, sentNow === need * 3 && perLine.every(x => x.n <= 3) && (await db.collection('bsMessages').countDocuments({ status: 'queued', cid })) === 20 - need * 3, `${sentNow} sent`)
  await B.setConfig({ esimDailyLimit: 400, warmupDays: 0 }, 'test')
  const lg = await db.collection('bsEsimDaily').findOne({ esimId: perLine[0].esimId })
  ok('line log keeps age + new/out/sent per day', lg.age === 1 && lg.out === lg.sent && lg.n === lg.out, JSON.stringify(lg))
  await db.collection('bsMessages').deleteMany({ cid, status: 'queued' })

  // ---- credit forecast: warning, booking gate, purchase reserve, hourly nag ----
  await B.creditWatch()
  const f = (await B.state()).forecast
  ok('forecast: promised = queued parts × cost + renewals × line cost', f && f.committed === Math.round((1000 * 0.01 + need * 10) * 100) / 100 && f.available === Math.round((200 - f.committed - 10) * 100) / 100, JSON.stringify(f))
  process.env.BULK_ESIM_FAKE_CREDIT = '20'; alerts.length = 0; await B.creditWatch()
  ok('low runway → one warning, sending continues', alerts.filter(a => /getting low/.test(a)).length === 1 && !(await B.state()).reasons.length)
  await B.creditWatch(); ok('warning not repeated the same day', alerts.filter(a => /getting low/.test(a)).length === 1)
  ok('bookings on hold while credit can’t cover them', (await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 })).error === 'err_no_lines')
  const pr = await B.provisionOne('test'); ok('no eSIM purchase with the reserve unmet', !!pr.error && /credit/i.test(pr.error) && alerts.some(a => /Provisioning blocked: Spenza credit/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '2'; alerts.length = 0; await B.creditWatch()
  await db.collection('bsConfig').updateOne({ _id: 'state' }, { $set: { creditNagAt: Date.now() - 2 * 3600000 } }); await B.creditWatch()
  ok('below the floor: paused, then reminded again after an hour', (await B.state()).reasons.includes('provider_credit') && alerts.some(a => /PAUSED/.test(a)) && alerts.some(a => /Still paused/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.creditWatch()
  ok('top-up → resumes and bookings open again', !(await B.state()).reasons.length && !!(await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 })).booking)

  // ---- provider suspends a line → new number → delivery test → pool (or retire + new eSIM) ----
  const victim = await db.collection('bsEsims').findOne({ status: 'available' })
  process.env.BULK_ESIM_FAKE_SUSPENDED = victim.iccid; alerts.length = 0; provCalls = 0
  await B.healthCheck()
  const old = await db.collection('bsEsims').findOne({ _id: victim._id }), repl = await db.collection('bsEsims').findOne({ replaces: victim._id })
  ok('suspended line replaced automatically, new number waits for a delivery test', old.status === 'replaced' && repl?.status === 'testing' && repl.verify === true && alerts.some(a => /new number requested/.test(a)))
  const snap = await db.collection('bsIncidents').findOne({ type: 'line_suspended', esimId: victim._id })
  ok('suspension snapshot logged with age, lifetime stats and daily history', !!snap && snap.age === 1 && Array.isArray(snap.last7) && snap.last7.length >= 1 && snap.stats.sent >= 1, JSON.stringify(snap?.last7))
  process.env.BULK_ESIM_FAKE_SUSPENDED = ''
  await B.healthCheck()
  const vt = await db.collection('bsTests').findOne({ esimId: repl._id, type: 'verify', result: 'pending' })
  ok('delivery test text queued to another pool line', !!vt && (await db.collection('bsMessages').countDocuments({ esimId: repl._id, system: true, body: new RegExp(vt.code) })) === 1 && (await db.collection('bsEsims').findOne({ _id: repl._id })).status === 'testing')
  await B.tick()
  const peer = await db.collection('bsEsims').findOne({ _id: vt.peer })
  await B.onWebhook('', {}, { data: { From: repl.msisdn, Owner: peer.msisdn, Message_Body: `CloudIVR line check ${vt.code}`, Message_ID: 'v1' } })
  await B.healthCheck()
  ok('reply arrives → new number joins the pool', (await db.collection('bsEsims').findOne({ _id: repl._id })).status === 'available' && (await db.collection('bsTests').findOne({ _id: vt._id })).result === 'passed')
  // second suspension: the new number never delivers → retired, a fresh eSIM is bought
  const v2 = await db.collection('bsEsims').findOne({ status: 'available', _id: { $ne: repl._id } })
  process.env.BULK_ESIM_FAKE_SUSPENDED = v2.iccid; await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''
  const r2 = await db.collection('bsEsims').findOne({ replaces: v2._id })
  for (let i = 0; i < 2; i++) { await B.healthCheck(); await db.collection('bsTests').updateMany({ esimId: r2._id, type: 'verify', result: 'pending' }, { $set: { result: 'no_reply' } }) }
  provCalls = 0; await B.healthCheck()
  ok('two missed delivery tests → number retired, new eSIM bought', (await db.collection('bsEsims').findOne({ _id: r2._id })).status === 'failed' && provCalls === 1 && alerts.some(a => /does not deliver texts/.test(a)))
  ok('auto-replacements capped per day', (await db.collection('bsConfig').findOne({ _id: `replaces:${d(0)}` })).n === 2 && (await B.cfg()).maxReplacesPerDay === 3)

  // ---- plan ended → line leaves the pool ----
  const live = await db.collection('bsEsims').findOne({ status: 'available' }); process.env.BULK_ESIM_FAKE_EXPIRED = live.iccid; await B.healthCheck(); process.env.BULK_ESIM_FAKE_EXPIRED = ''
  ok('expired plan → line marked expired + admin told', (await db.collection('bsEsims').findOne({ _id: live._id })).status === 'expired' && alerts.some(a => /plan ended/.test(a)))
  await B.healthCheck()
  const avail = await db.collection('bsEsims').find({ status: 'available' }).toArray()
  ok('expiry dates synced into the pool', avail.length >= 2 && avail.every(e => e.expirationDate && new Date(e.expirationDate) > new Date()), `${avail.length} lines`)

  // ---- unmet demand drives purchases for the coming days ----
  await B.setConfig({ maxEsims: 40 }, 'test')
  await db.collection('bsDemand').insertOne({ _id: 'x:demand', date: d(0), volume: 3000, at: new Date() })
  const before = await db.collection('bsEsims').countDocuments({ status: { $nin: ['replaced', 'failed', 'expired'] } }); provCalls = 0; await B.autoscale()
  ok('refused demand (3,000 SMS) makes the autoscaler buy lines for the coming days', provCalls > 0 && alerts.some(a => /Bought \d+ eSIM/.test(a)), `${before} → +${provCalls}`)

  // ---- dynamic demand model: room for one more booking + busiest recent day, capped by the day ceiling ----
  await db.collection('bsDemand').deleteMany({}); await db.collection('bsBookings').deleteMany({}); await B.setConfig({ reserveBooking: true, quietStart: 8, quietEnd: 21, maxEsims: 0, platformPerMin: 30, esimPerMin: 10 }, 'test')
  const cfgNow = await B.cfg(), dm0 = await B.demandModel(cfgNow)
  ok('empty history → target = one full booking (2,000) per day', dm0.peak === 0 && dm0.target(d(2)) === 2000)
  await db.collection('bsBookings').insertMany([{ _id: 'bk_hist1', cid, date: d(-3), volume: 2000, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_hist2', cid, date: d(-3), volume: 2000, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_hist3', cid, date: d(-3), volume: 500, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_fut', cid, date: d(2), volume: 1500, status: 'scheduled', paymentStatus: 'paid', allocation: { [`${d(2)}T16`]: 1500 } }])
  await db.collection('bsDemand').insertOne({ _id: 'x:hist', date: d(-3), volume: 2000, at: new Date() })
  const dm = await B.demandModel(cfgNow)
  ok('busiest recent day (4,500 booked + 2,000 refused) lifts every day\'s target to 6,500', dm.peak === 6500 && dm.target(d(3)) === 6500 && dm.target(d(2)) === 6500)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 6000, allocation: { [`${d(2)}T16`]: 6000 } } })
  ok('a day booked above the peak targets booked + one more booking (8,000)', (await B.demandModel(cfgNow)).target(d(2)) === 8000)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 14000, allocation: { [`${d(2)}T16`]: 14000 } } })
  ok('target never exceeds the Spenza day ceiling (14,400)', (await B.demandModel(cfgNow)).target(d(2)) === 14400)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 1500, allocation: { [`${d(2)}T16`]: 1500 } } })
  const liveNow = await db.collection('bsEsims').countDocuments({ status: { $nin: ['replaced', 'failed', 'expired'] } }); provCalls = 0; await B.autoscale()
  const wantLines = Math.ceil(6500 / 320)
  ok(`autoscaler buys up to the demand target (${wantLines} lines for 6,500/day), once`, provCalls === Math.max(0, wantLines - liveNow) && alerts.some(a => /peak 6500/.test(a)), `${liveNow} live → +${provCalls}`)
  provCalls = 0; await B.healthCheck(); await B.autoscale()
  ok('target met → no further purchase', provCalls === 0)
  const pl = await B.plan(cfgNow)
  ok('/bulkplan rows: 7 days with booked/target/have/ceiling/short', pl.rows.length === 7 && pl.rows[2].booked === 1500 && pl.rows[2].target === 6500 && pl.rows.every(r => r.ceiling === 14400) && pl.maxLines === 45 && pl.rows.slice(1).every(r => r.short === 0), JSON.stringify(pl.rows[2]))
  await db.collection('bsBookings').deleteMany({ _id: /^bk_/ })
  const hist = await B.lineHistory(14)
  ok('line history report lists every line with days + incidents', hist.length === (await db.collection('bsEsims').countDocuments()) && hist.some(h => h.days.length) && hist.some(h => h.incidents.length), `${hist.length} lines`)
  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
