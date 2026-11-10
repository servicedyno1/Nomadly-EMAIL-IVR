// eSIM BulkSMS automation check: per-line daily cap + warm-up, projected bookings that buy lines, credit forecast gate,
// auto-replace with delivery test, plan expiry. Simulated provider. Run from /app: node js/tests/test_bulk_esim_autoscale.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const DAY = 86400000, d = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1, rateMargin: 0 }, 'test') // LEGACY_DEFAULTS: this suite covers the floor / spare-reserve / monitor paths
  process.env.BULK_ESIM_WORKER = ''
  let provCalls = 0; const realProv = P.provision; P.provision = async (...a) => { provCalls++; return realProv(...a) }
  const c = await B.cfg()
  ok('defaults: 400/line/day, no warm-up, 1 lead day, dynamic ceilings, reserve one booking, auto-replace on, auto-buy ON, 1 monitor + 2 service', c.esimDailyLimit === 400 && c.warmupDays === 0 && c.leadDays === 1 && c.maxEsims === 0 && c.provisionBudget === 0 && c.reserveBooking === true && c.demandDays === 14 && c.autoReplace === true && c.autoProvision === true && c.manualApproval === false && c.minEsims === 2 && c.monitorEsims === 1 && c.testerEsims === 1)
  await B.setConfig({ autoProvision: false, manualApproval: true, minEsims: 1 }, 'test')
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
  await B.setConfig({ autoProvision: true, manualApproval: false, provisionBudget: 500, maxEsims: 20, monitorEsims: 0, testerEsims: 0 }, 'test')
  const cap3 = await B.capacity(d(3), await B.cfg())
  ok('projected capacity counts lines that can still be bought (budget $500 / $10 → 20 max)', cap3.projected === 20 && cap3.perDay === Math.floor(20 * B.lineCap(c, 4) * 0.8), JSON.stringify(cap3))
  ok('today has no projected lines, tomorrow does (lead time 1 day)', (await B.capacity(d(0), await B.cfg())).lines === 0 && (await B.capacity(d(1), await B.cfg())).projected === 20)
  const bk = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 })
  ok('1,000 SMS booked 3 days ahead with zero lines — scheduled 24h+ ahead → 10% off ($90, list $100)', !!bk.booking && bk.booking.price === 90 && bk.booking.discountPct === 10 && bk.booking.listPrice === 100 && bk.booking.unitPrice === 0.09, JSON.stringify(bk.error || bk.booking?.allocation))
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  const need = Math.ceil(1000 / (B.lineCap(c, 4) * 0.8)), bought = await db.collection('bsEsims').countDocuments()
  ok(`payment buys exactly the ${need} lines the booking needs`, provCalls === need && bought === need && (await db.collection('bsBookings').findOne({ _id: bk.booking._id })).status === 'provisioning', `${provCalls} bought`)
  await db.collection('bsDemand').deleteMany({}); await B.healthCheck(); await B.autoscale()
  ok('lines pass checks, booking becomes scheduled, nothing extra bought', (await db.collection('bsEsims').countDocuments({ status: 'available' })) === need && (await db.collection('bsBookings').findOne({ _id: bk.booking._id })).status === 'scheduled' && provCalls === need)

  // ---- per-line daily cap in the send loop ----
  await B.setConfig({ platformPerMin: 10000, esimPerMin: 10000, esimDailyLimit: 3, warmupDays: 1 }, 'test')
  for (let i = 0; i < 20; i++) await B.sendOne(cid, `+1212555${3000 + i}`, `hello ${i}`)
  for (let i = 0; i < 25; i++) await B.claimWorker(); await B.tick()
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
  const hb = await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 }); ok('low-but-positive credit no longer holds bookings (no forecast floor)', !!hb.booking, hb.error)
  if (hb.booking) await db.collection('bsBookings').deleteOne({ _id: hb.booking._id })
  const pr = await B.provisionOne('test'); ok('order is tried — Spenza decides (no reserve floor)', !!pr.ok, pr.error)
  if (pr.ok) await db.collection('bsEsims').deleteOne({ _id: pr.esimId })
  process.env.BULK_ESIM_FAKE_CREDIT = '2'; alerts.length = 0; await B.creditWatch()
  await db.collection('bsConfig').updateOne({ _id: 'state' }, { $set: { creditNagAt: Date.now() - 2 * 3600000 } }); await B.creditWatch()
  ok('below the floor: paused, then reminded again after an hour', (await B.state()).reasons.includes('provider_credit') && alerts.some(a => /PAUSED/.test(a)) && alerts.some(a => /Still paused/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.creditWatch()
  ok('top-up → resumes and bookings open again', !(await B.state()).reasons.length && !!(await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 })).booking)

  // ---- monitor line + round-trip checks: line → monitor → line ----
  await B.setConfig({ monitorEsims: 1 }, 'test'); await B.provisionOne('test', 'test', 'monitor'); await B.healthCheck()
  const mon = await B.monitorLine()
  const cp1 = await B.capacity(d(1), await B.cfg())
  ok('monitor line provisioned, joins after its own check, never in the sending pool', mon?.status === 'available' && mon.role === 'monitor' && cp1.lines - cp1.projected === (await db.collection('bsEsims').countDocuments({ role: 'service', status: 'available' })), JSON.stringify({ mon: mon?.status, cp1 }))
  process.env.BULK_ESIM_FAKE_CHECKS = 'manual'
  const victim = await db.collection('bsEsims').findOne({ status: 'available', role: 'service' })
  process.env.BULK_ESIM_FAKE_SUSPENDED = victim.iccid; alerts.length = 0; provCalls = 0
  await B.healthCheck()
  const old = await db.collection('bsEsims').findOne({ _id: victim._id }), repl = await db.collection('bsEsims').findOne({ replaces: victim._id })
  ok('suspended line replaced automatically, new number waits for its pre-use check', old.status === 'replaced' && repl?.status === 'testing' && repl.verify === true && alerts.some(a => /new number requested/.test(a)))
  const snap = await db.collection('bsIncidents').findOne({ type: 'line_suspended', esimId: victim._id })
  ok('suspension snapshot logged with age, lifetime stats and daily history', !!snap && snap.age === 1 && Array.isArray(snap.last7) && snap.last7.length >= 1 && snap.stats.sent >= 1, JSON.stringify(snap?.last7))
  process.env.BULK_ESIM_FAKE_SUSPENDED = ''
  await B.healthCheck()
  const vt = await db.collection('bsTests').findOne({ esimId: repl._id, type: 'check', kind: 'pre_use', result: 'pending' })
  ok('pre-use check: text queued from the new line to the monitor', !!vt && vt.peer === mon._id && (await db.collection('bsMessages').countDocuments({ esimId: repl._id, system: true, body: new RegExp(vt.code) })) === 1 && (await db.collection('bsEsims').findOne({ _id: repl._id })).status === 'testing')
  await B.claimWorker(); await B.tick()
  await B.onWebhook('', {}, { data: { From: repl.msisdn, Owner: mon.msisdn, Message_Body: `CloudIVR line check ${vt.code}`, Message_ID: 'v1' } })
  const back = await db.collection('bsMessages').findOne({ esimId: mon._id, system: true, body: `CloudIVR line check ${vt.code} ok` })
  ok('monitor received it → answers from the monitor line', !!back && back.to === repl.msisdn && (await db.collection('bsTests').findOne({ _id: vt._id })).legs.out === true)
  await B.claimWorker(); await B.tick()
  await B.onWebhook('', {}, { data: { From: mon.msisdn, Owner: repl.msisdn, Message_Body: `CloudIVR line check ${vt.code} ok`, Message_ID: 'v2' } })
  await B.healthCheck()
  ok('answer arrives → check passed → new number joins the pool', (await db.collection('bsEsims').findOne({ _id: repl._id })).status === 'available' && (await db.collection('bsTests').findOne({ _id: vt._id })).result === 'passed')
  // second suspension: the new number never reaches the monitor → retired, a fresh eSIM is bought
  await B.setConfig({ autoProvision: true, manualApproval: false }, 'test')
  const v2 = await db.collection('bsEsims').findOne({ status: 'available', role: 'service', _id: { $ne: repl._id } })
  process.env.BULK_ESIM_FAKE_SUSPENDED = v2.iccid; await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''
  const r2 = await db.collection('bsEsims').findOne({ replaces: v2._id })
  for (let i = 0; i < 2; i++) { await B.healthCheck(); await db.collection('bsTests').updateMany({ esimId: r2._id, type: 'check', result: 'pending' }, { $set: { at: new Date(Date.now() - 11 * 60000) } }); await B.checkTimeouts(await B.cfg()) }
  ok('missed checks counted as no_delivery on the line', (await db.collection('bsTests').countDocuments({ esimId: r2._id, type: 'check', result: 'no_delivery' })) === 2 && (await db.collection('bsEsims').findOne({ _id: r2._id })).sendMiss === 2)
  provCalls = 0; await B.healthCheck()
  ok('two missed checks → number retired, new eSIM bought', (await db.collection('bsEsims').findOne({ _id: r2._id })).status === 'failed' && provCalls === 1 && alerts.some(a => /does not pass the delivery check/.test(a)), `${(await db.collection('bsEsims').findOne({ _id: r2._id })).status} prov=${provCalls} ${alerts.slice(-2).join(' | ').slice(0, 300)}`)
  ok('auto-replacements capped per day', (await db.collection('bsConfig').findOne({ _id: `replaces:${d(0)}` })).n === 2 && (await B.cfg()).maxReplacesPerDay === 3)
  // dead lines are cancelled with Spenza, unless the eSIM lives on in a replacement
  let cancels = []; const realCancel = P.cancelSubscription; P.cancelSubscription = async (iccid) => { cancels.push(iccid); return realCancel(iccid) }
  await db.collection('bsEsims').updateMany({ _id: { $in: [r2._id, victim._id] } }, { $set: { updatedAt: new Date(Date.now() - 2 * 3600000) } })
  await B.cancelDead(await B.cfg())
  const r2d = await db.collection('bsEsims').findOne({ _id: r2._id }), vd = await db.collection('bsEsims').findOne({ _id: victim._id })
  ok('failed line cancelled with Spenza (no more billing); replaced line whose eSIM lives on is not', cancels.length === 1 && cancels[0] === r2.iccid && !!r2d.cancelledAt && !vd.cancelledAt && alerts.some(a => /cancelled with Spenza/.test(a)), JSON.stringify(cancels))
  cancels = []; await B.cancelDead(await B.cfg()); ok('cancellation happens once', cancels.length === 0)
  P.cancelSubscription = realCancel
  // active lines: re-checked only when they sent something since the last pass; a spike of failures checks at once
  const act = await db.collection('bsEsims').find({ status: 'available', role: 'service' }).limit(2).toArray()
  await db.collection('bsEsims').updateMany({ _id: { $in: act.map(x => x._id) } }, { $set: { lastCheckOkAt: new Date(Date.now() - 7 * 3600000), checkedSubmitted: 0, 'stats.submitted': 5 } })
  await db.collection('bsEsims').updateOne({ _id: act[0]._id }, { $set: { 'stats.submitted': 0 } })
  await B.healthCheck()
  ok('periodic check only for the line that sent since its last pass', !(await db.collection('bsTests').findOne({ esimId: act[0]._id, type: 'check', kind: 'periodic' })) && !!(await db.collection('bsTests').findOne({ esimId: act[1]._id, type: 'check', kind: 'periodic', result: 'pending' })))
  // monitor fault: two different lines fail delivery to the same monitor → the monitor is replaced, lines are cleared
  await B.startCheck(act[0], 'periodic')
  await db.collection('bsTests').updateMany({ type: 'check', result: 'pending' }, { $set: { at: new Date(Date.now() - 11 * 60000) } }); alerts.length = 0
  await B.checkTimeouts(await B.cfg())
  ok('two lines missing the monitor at once → monitor suspected + replaced, lines not blamed', alerts.some(a => /Monitor line .* is the suspect/.test(a)) && (await db.collection('bsEsims').findOne({ _id: mon._id })).status === 'replaced' && (await db.collection('bsEsims').find({ _id: { $in: act.map(x => x._id) } }).toArray()).every(e => (e.sendMiss || 0) === 0) && (await db.collection('bsTests').countDocuments({ type: 'check', result: 'monitor_fault' })) >= 2)
  process.env.BULK_ESIM_FAKE_CHECKS = ''
  await B.healthCheck()
  const mon2 = await B.monitorLine()
  await db.collection('bsEsims').updateOne({ _id: mon2._id }, { $set: { lastCheckOkAt: new Date(Date.now() - 7 * 3600000) } }); await B.healthCheck()
  const selfT = await db.collection('bsTests').findOne({ esimId: mon2._id, type: 'check', kind: 'periodic' })
  ok('monitor proves itself every 6 h against a service line, traffic or not', !!selfT && (await db.collection('bsEsims').findOne({ _id: selfT.peer })).role === 'service')
  ok('replacement monitor passes its check and takes over', (await B.monitorLine())?.status === 'available' && (await B.monitorLine()).replaces === mon._id)

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
  ok('empty history → no target at all (nothing bought before the first customer)', dm0.peak === 0 && dm0.target(d(2)) === 0)
  await db.collection('bsBookings').insertMany([{ _id: 'bk_hist1', cid, date: d(-3), volume: 2000, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_hist2', cid, date: d(-3), volume: 2000, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_hist3', cid, date: d(-3), volume: 500, status: 'completed', paymentStatus: 'paid' }, { _id: 'bk_fut', cid, date: d(2), volume: 1500, status: 'scheduled', paymentStatus: 'paid', allocation: { [`${d(2)}T16`]: 1500 } }])
  await db.collection('bsDemand').insertOne({ _id: 'x:hist', date: d(-3), volume: 2000, at: new Date() })
  const dm = await B.demandModel(cfgNow)
  ok('busiest recent day (4,500 booked + 2,000 refused) lifts every day\'s target to 6,500', dm.peak === 6500 && dm.target(d(3)) === 6500 && dm.target(d(2)) === 6500)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 6000, allocation: { [`${d(2)}T16`]: 6000 } } })
  ok('a day booked above the peak targets booked + one more booking (8,000)', (await B.demandModel(cfgNow)).target(d(2)) === 8000)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 14000, allocation: { [`${d(2)}T16`]: 14000 } } })
  ok('target never exceeds the Spenza day ceiling (14,400)', (await B.demandModel(cfgNow)).target(d(2)) === 14400)
  await db.collection('bsBookings').updateOne({ _id: 'bk_fut' }, { $set: { volume: 1500, allocation: { [`${d(2)}T16`]: 1500 } } })
  const liveNow = await db.collection('bsEsims').countDocuments({ role: 'service', status: { $nin: ['replaced', 'failed', 'expired', 'retired'] } }); provCalls = 0; await B.autoscale()
  const wantLines = Math.ceil(6500 / 320)
  ok(`autoscaler buys up to the demand target (${wantLines} lines for 6,500/day), once`, provCalls === Math.max(0, wantLines - liveNow) && alerts.some(a => /peak 6500/.test(a)), `${liveNow} live → +${provCalls}`)
  provCalls = 0; await B.healthCheck(); await B.autoscale()
  ok('target met → no further purchase', provCalls === 0)
  const pl = await B.plan(cfgNow)
  ok('/bulkplan rows: 7 days with booked/target/have/ceiling/short', pl.rows.length === 7 && pl.rows[2].booked === 1500 && pl.rows[2].target === 6500 && pl.rows.every(r => r.ceiling === 14400) && pl.maxLines === 45 && pl.rows.slice(1).every(r => r.short === 0), JSON.stringify(pl.rows[2]))
  await db.collection('bsBookings').deleteMany({ _id: /^bk_/ })
  const hist = await B.lineHistory(14)
  ok('line history report lists every line with days + incidents', hist.length === (await db.collection('bsEsims').countDocuments()) && hist.some(h => h.days.length) && hist.some(h => h.incidents.length), `${hist.length} lines`)
  // ---- new Spenza credentials → bootstrap buys only the tester line; monitor + 2 starters come with the first paid booking ----
  for (const col of ['bsEsims', 'bsBookings', 'bsDemand', 'bsTests', 'bsMessages', 'bsCampaigns', 'bsDaily']) await db.collection(col).deleteMany({})
  await db.collection('bsConfig').deleteMany({ _id: { $in: ['settings', 'provider', 'esimSeq', `scale:${d(0)}`] } }); await db.collection('bsAccounts').deleteMany({})
  await B.setConfig({ quietStart: 8, quietEnd: 21, minCredit: 10, reserveBooking: true, monitorEsims: 1, rateMargin: 0 }, 'test')
  process.env.SPENZA_BULK_API_KEY = 'key-one'; process.env.BULK_ESIM_FAKE_CREDIT = '500'; alerts.length = 0; provCalls = 0
  const b1 = await B.bootstrap()
  ok('first credentials → account connected, tester + a monitor peer are bought', b1.ok && b1.testers === 1 && b1.monitors === 1 && b1.lines === 0 && provCalls === 2 && alerts.some(a => /account connected/.test(a)) && alerts.some(a => /Account ready: 1\/1 tester/.test(a)), JSON.stringify(b1))
  ok('same credentials again → nothing happens', (await B.bootstrap()).same === true && provCalls === 2)
  await B.healthCheck(); provCalls = 0; await B.autoscale()
  ok('no demand yet → nothing else bought, no target', provCalls === 0 && (await B.demandModel(await B.cfg())).target(d(2)) === 0)
  const tester = await db.collection('bsEsims').findOne({ role: 'tester' })
  ok('tester line passed its check and is ready (not in the sending pool)', tester.status === 'available' && (await B.capacity(d(0), await B.cfg())).lines === 0)
  const cust2 = await B.customer('Nomadly', '777'), cp2 = await B.createCampaign(cust2._id, { name: 'First', content: 'Hello there', contacts: Array.from({ length: 520 }, (_, i) => `+1212555${4000 + i}`), consent: true })
  await db.collection('bsCustomers').updateOne({ _id: cust2._id }, { $set: { testNumbers: [{ phone: '+12125550777', verifiedAt: new Date() }] } })
  const ts = await B.testSend(cust2._id, cp2.campaign._id, '+12125550777'); await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test'); await B.claimWorker(); await B.tick(); await B.setConfig({ quietStart: 8, quietEnd: 21 }, 'test')
  const tm = await db.collection('bsMessages').findOne({ _id: ts.messageId })
  ok('customer test text goes out through the tester line before any service line exists', ts.ok && tm.status === 'sent' && tm.esimId === tester._id, `${tm.status} via ${tm.esimId}`)
  const first = await B.createBooking(cust2._id, { date: d(1), hour: 16, campaignId: cp2.campaign._id })
  ok('first customer books 520 tomorrow with zero service lines (auto-buy on)', !!first.booking, first.error || '')
  provCalls = 0; alerts.length = 0; await B.confirmBooking(first.booking._id, {})
  ok('first paid booking buys the 2 starter lines (monitor already there)', provCalls === 2 && (await B.monitorCount()) === 1 && (await db.collection('bsEsims').countDocuments({ role: 'service' })) === 2, `+${provCalls}`)
  await B.healthCheck(); provCalls = 0; await B.autoscale()
  ok('then the model keeps room for one more full booking → grows', provCalls === Math.ceil(2520 / 320) - 2, `+${provCalls}`)
  process.env.SPENZA_BULK_API_KEY = 'key-two'; alerts.length = 0; provCalls = 0
  const b2 = await B.bootstrap()
  ok('new credentials → old lines retired, new account bootstrapped again (tester + lines for the waiting work ordered at once)', b2.ok && b2.retired >= 4 && b2.testers === 1 && provCalls >= 1 && alerts.some(a => /New credentials for Spenza account #1/.test(a)) && (await db.collection('bsEsims').countDocuments({ status: 'retired' })) === b2.retired, JSON.stringify(b2))
  ok('bootstrap with a balance of $0 does not buy', await (async () => { process.env.SPENZA_BULK_API_KEY = 'key-three'; process.env.BULK_ESIM_FAKE_CREDIT = '0'; await B.creditWatch(); provCalls = 0; const b3 = await B.bootstrap(); return b3.ok && provCalls === 0 && b3.testers === 0 })())
  delete process.env.SPENZA_BULK_API_KEY
  // next free day for a full day
  await db.collection('bsBookings').deleteMany({}); await db.collection('bsDemand').deleteMany({}); await B.setConfig({ autoProvision: false, manualApproval: true, quietStart: 0, quietEnd: 24 }, 'test')
  for (const e of await db.collection('bsEsims').find({ role: 'service', status: { $in: ['available', 'testing', 'provisioning', 'purchasing', 'degraded'] } }).toArray()) await db.collection('bsEsims').updateOne({ _id: e._id }, { $set: { status: 'retired' } })
  await db.collection('bsConfig').deleteOne({ _id: 'settings' }); await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1, rateMargin: 0 }, 'test'); await B.setConfig({ autoProvision: false, manualApproval: true, quietStart: 0, quietEnd: 24, testerEsims: 0, monitorEsims: 0 }, 'test')
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.creditWatch()
  for (let i = 0; i < 2; i++) await B.provisionOne('nf'); await B.healthCheck()
  const nfCid = (await B.customer('Nomadly', '888'))._id, avail1 = await B.availability(d(1))
  ok('2 fresh lines → 640 bookable per day', avail1.perDay === 640, `${avail1.perDay}`)
  const full = await B.createBooking(nfCid, { date: d(1), hour: 10, volume: 600 })
  ok('a 600 booking fills tomorrow', !!full.booking && (await B.availability(d(1))).dayFree === 40)
  const nf = await B.nextFreeDay(600, d(1))
  ok('next free day for 600 SMS is the day after', nf?.date === d(2) && nf.dayFree === 640, JSON.stringify(nf))
  ok('no day within 14 days for 700 SMS → null', (await B.nextFreeDay(700, d(1))) === null)
  // ---- replacement + dead detection for EVERY role (service, monitor, tester) ----
  for (const col of ['bsEsims', 'bsBookings', 'bsDemand', 'bsTests', 'bsMessages', 'bsIncidents']) await db.collection(col).deleteMany({})
  await db.collection('bsConfig').deleteMany({ _id: { $regex: /^(settings|replaces:|replimit:|stuck:|nopeer:)/ } })
  await B.setConfig({ autoProvision: true, manualApproval: false, quietStart: 0, quietEnd: 24, monitorEsims: 1, minCredit: 10, reserveBooking: true, rateMargin: 0 }, 'test'); process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.creditWatch()
  await B.ensureRoles(await B.cfg()); for (let i = 0; i < 2; i++) await B.provisionOne('role-test'); await B.healthCheck(); await B.healthCheck()
  const T = await db.collection('bsEsims').findOne({ role: 'tester' }), M = await B.monitorLine(), S = await db.collection('bsEsims').findOne({ role: 'service', status: 'available' })
  ok('fleet for the role test: tester + monitor + 2 service, all available', T?.status === 'available' && M?.status === 'available' && (await db.collection('bsEsims').countDocuments({ role: 'service', status: 'available' })) === 2)
  // a) tester suspended → number replaced first → new number passes check → tester back (same role)
  process.env.BULK_ESIM_FAKE_SUSPENDED = T.iccid; alerts.length = 0; await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''; await B.healthCheck()
  const T2 = await db.collection('bsEsims').findOne({ replaces: T._id })
  ok('tester: number replaced first, new number checked, back in service as tester', T2?.role === 'tester' && T2.status === 'available' && (await db.collection('bsEsims').findOne({ _id: T._id })).status === 'replaced' && (await B.roleCount('tester')) === 1 && (await db.collection('bsTests').findOne({ esimId: T2._id, kind: 'pre_use', result: 'passed' })) !== null)
  // b) monitor suspended and renew-number refused by Spenza → new eSIM bought with the monitor role
  process.env.BULK_ESIM_FAKE_SUSPENDED = M.iccid; process.env.BULK_ESIM_FAKE_RENEW_FAIL = M.iccid; provCalls = 0; alerts.length = 0
  await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''; process.env.BULK_ESIM_FAKE_RENEW_FAIL = ''; await B.healthCheck()
  const Mnew = await B.monitorLine()
  ok('monitor: renew-number refused → fresh eSIM bought as monitor', provCalls === 1 && Mnew && Mnew._id !== M._id && !Mnew.replaces && Mnew.role === 'monitor' && alerts.some(a => /could not replace the number/.test(a)), `${provCalls} bought, monitor ${Mnew?._id}`)
  // c) service line: Spenza API keeps erroring on it (3×) → treated as dead → number replaced
  process.env.BULK_ESIM_FAKE_BROKEN = S.iccid; for (let i = 0; i < 2; i++) await B.healthCheck()
  ok('two API errors → flagged, not yet replaced', (await db.collection('bsEsims').findOne({ _id: S._id })).apiFails === 2 && (await db.collection('bsEsims').findOne({ _id: S._id })).status !== 'replaced')
  await B.healthCheck(); process.env.BULK_ESIM_FAKE_BROKEN = ''
  ok('third API error → number replacement requested', (await db.collection('bsEsims').findOne({ _id: S._id })).status === 'replaced' && !!(await db.collection('bsEsims').findOne({ replaces: S._id, role: 'service' })))
  // d) a replacement number that never arrives
  await B.healthCheck()
  const stuckOld = await db.collection('bsEsims').insertOne({ _id: 'ESIM-STUCK1', role: 'service', status: 'provisioning', iccid: 'x1', health: 'unknown', stats: {}, history: [], createdAt: new Date(Date.now() - 25 * 3600000), updatedAt: new Date(Date.now() - 25 * 3600000) })
  await db.collection('bsEsims').insertOne({ _id: 'ESIM-STUCK2', role: 'tester', status: 'provisioning', iccid: 'x2', health: 'unknown', stats: {}, history: [], createdAt: new Date(Date.now() - 3 * 3600000), updatedAt: new Date(Date.now() - 3 * 3600000) })
  provCalls = 0; alerts.length = 0; await B.stuckLines(await B.cfg())
  ok('number never arrived: 24 h → retired + same-role rebuy; 3 h → warning only', stuckOld.acknowledged && (await db.collection('bsEsims').findOne({ _id: 'ESIM-STUCK1' })).status === 'failed' && provCalls === 1 && (await db.collection('bsEsims').findOne({ _id: 'ESIM-STUCK2' })).status === 'provisioning' && alerts.some(a => /never received a number in 24 h/.test(a)) && alerts.some(a => /waiting 3 h/.test(a)))
  await db.collection('bsEsims').deleteMany({ _id: /^ESIM-STUCK/ })
  // e) a line is re-checked after 100 texts even inside the 6 h window
  const S2 = await db.collection('bsEsims').findOne({ role: 'service', status: 'available' })
  await db.collection('bsEsims').updateOne({ _id: S2._id }, { $set: { lastCheckOkAt: new Date(), checkedSubmitted: 0, 'stats.submitted': 120 } }); await B.healthCheck()
  ok('100 texts since the last pass → volume check', !!(await db.collection('bsTests').findOne({ esimId: S2._id, type: 'check', kind: 'volume' })))
  // f) replacement cap reached and monitor suspended → a suspended aux line no longer counts, a new monitor is bought
  await db.collection('bsConfig').updateOne({ _id: `replaces:${d(0)}` }, { $set: { n: 3, at: new Date() } }, { upsert: true })
  process.env.BULK_ESIM_FAKE_SUSPENDED = Mnew.iccid; provCalls = 0; await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''; await B.autoscale()
  ok('suspended monitor + replacement cap → counted as missing, new monitor bought', provCalls === 1 && (await db.collection('bsEsims').findOne({ _id: Mnew._id })).status === 'suspended' && (await B.roleCount('monitor')) === 1)
  await B.setConfig({ autoProvision: false, manualApproval: true }, 'test')

  // ---- interplay: booked hours honoured, late notice, cancel once per eSIM ----
  for (const col of ['bsBookings', 'bsDemand', 'bsMessages', 'bsCampaigns', 'bsDaily', 'bsNotify']) await db.collection(col).deleteMany({})
  await B.setConfig({ platformPerMin: 30, esimPerMin: 10, esimDailyLimit: 5000 }, 'test')
  const ipCid = (await B.customer('Nomadly', '999'))._id, ipC = await B.createCampaign(ipCid, { name: 'Hours', content: 'Hello', contacts: Array.from({ length: 2000 }, (_, i) => `+1212${String(5550000 + i)}`), consent: true })
  const ipB = await B.createBooking(ipCid, { date: d(1), hour: 16, campaignId: ipC.campaign._id })
  ok('2,000 texts need 2 booked hours at 1,440/hour', !!ipB.booking && Object.keys(ipB.booking.allocation).length === 2, JSON.stringify(ipB.booking?.allocation || ipB.error))
  await B.confirmBooking(ipB.booking._id, {})
  const byHour = await db.collection('bsMessages').aggregate([{ $match: { campaignId: ipC.campaign._id } }, { $group: { _id: '$nextAt', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()
  ok('texts released per booked hour exactly as allocated', byHour.length === 2 && byHour.every(h => ipB.booking.allocation[h._id.toISOString().slice(0, 13)] === h.n), JSON.stringify(byHour.map(h => [h._id.toISOString().slice(11, 13), h.n])))
  await db.collection('bsCampaigns').updateOne({ _id: ipC.campaign._id }, { $set: { scheduledAt: new Date(Date.now() - 3 * 3600000), status: 'running' } })
  await B.finishCampaigns(); await B.finishCampaigns()
  ok('campaign behind schedule → admin told once, customer not', (await db.collection('bsNotify').countDocuments({ key: 'n_late', chatId: '999' })) === 0 && alerts.filter(a => /is running behind/.test(a)).length === 1, String(alerts.filter(a => /is running behind/.test(a)).length))
  await db.collection('bsEsims').insertMany([{ _id: 'ESIM-DEAD1', role: 'service', status: 'failed', iccid: 'dead-iccid', updatedAt: new Date(Date.now() - 3 * 3600000), stats: {}, history: [] }, { _id: 'ESIM-DEAD2', role: 'service', status: 'failed', iccid: 'dead-iccid', replaces: 'ESIM-DEAD1', updatedAt: new Date(Date.now() - 3 * 3600000), stats: {}, history: [] }])
  let cc = []; const rc = P.cancelSubscription; P.cancelSubscription = async (i) => { cc.push(i); return rc(i) }
  await B.cancelDead(await B.cfg()); P.cancelSubscription = rc
  ok('line + its failed replacement share one eSIM → cancelled once', cc.length === 1 && (await db.collection('bsEsims').countDocuments({ iccid: 'dead-iccid', cancelledAt: { $ne: null } })) === 2, JSON.stringify(cc))
  await db.collection('bsEsims').deleteMany({ _id: /^ESIM-DEAD/ })
  // ---- rate-limit headers: worker holds while exhausted, limit changes are adopted ----
  await B.setConfig({ platformPerMin: 30 }, 'test')
  process.env.BULK_ESIM_FAKE_RATE = '20,0,5'; alerts.length = 0
  const held = await B.paceByHeaders(await B.cfg())
  ok('X-RateLimit: limit 20 adopted as the account rate + admin told', held === true && (await B.cfg()).accounts[0].perMin === 20 && B.ratePerMin(await B.cfg()) === 20 && alerts.some(a => /rate limit is 20\/min/.test(a)))
  await B.sendOne(ipCid, '+12125559999', 'rate test'); await B.claimWorker(); await B.tick()
  ok('remaining 0 → nothing sent until the window resets', (await db.collection('bsMessages').countDocuments({ cid: ipCid, body: /rate test/, status: 'queued' })) === 1)
  process.env.BULK_ESIM_FAKE_RATE = '1000,999,55'; await B.setConfig({ quietStart: 0, quietEnd: 24, esimDailyLimit: 5000 }, 'test'); await B.claimWorker(); await B.tick()
  const rm = await db.collection('bsMessages').findOne({ cid: ipCid, body: /rate test/ })
  ok('window open again → sends', rm.status === 'sent', `${rm.status} ${rm.failureReason || ''} ${JSON.stringify(rm.history.slice(-2))} lines=${JSON.stringify(await db.collection('bsEsims').find({ role: 'service' }, { projection: { status: 1, health: 1 } }).toArray())}`)
  delete process.env.BULK_ESIM_FAKE_RATE; await B.setConfig({ platformPerMin: 30 }, 'test'); await B.setAccount('spenza1', { perMin: null })
  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
