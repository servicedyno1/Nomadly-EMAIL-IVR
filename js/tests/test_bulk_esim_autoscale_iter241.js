// iter241 independent checks of the eSIM automation layer (projected bookings, per-line cap, credit forecast, auto-replace,
// expiry) + bug probes for double-buy / stale forecast / stuck bookings. Simulated provider. Run from /app with nodejs STOPPED:
//   node js/tests/test_bulk_esim_autoscale_iter241.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
const COLS = ['bsConfig', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation']
let pass = 0, fail = 0, probes = []
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const probe = (name, bug, extra = '') => { probes.push({ name, bug }); console.log(`${bug ? '🐞 BUG' : '🟢 ok '} [probe] ${name}${extra ? ` — ${extra}` : ''}`) }
const DAY = 86400000, d = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), X = (n) => db.collection(n)
  const wipe = async () => { for (const c of COLS) await X(c).deleteMany({}) }
  await wipe()
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  process.env.BULK_ESIM_WORKER = ''
  let provCalls = 0; const realProv = P.provision; P.provision = async (...a) => { provCalls++; return realProv(...a) }
  const fresh = async (cfg = {}) => { await wipe(); alerts.length = 0; provCalls = 0; process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.setConfig({ quietStart: 0, quietEnd: 24, reserveBooking: false, autoProvision: false, manualApproval: true, minEsims: 1, monitorEsims: 0, testerEsims: 0, ...cfg }, 'test'); return (await B.customer('TEST_Iter241', '9001'))._id }
  const AUTO = { autoProvision: true, manualApproval: false, provisionBudget: 500, maxEsims: 20 }
  const hourAhead = () => (new Date().getUTCHours() + 2) % 24
  try {
    // (a) zero lines, auto-buy off
    let cid = await fresh()
    const ra = await B.createBooking(cid, { date: d(3), hour: 12, volume: 700 })
    ok('(a) 0 lines + autoProvision off → err_no_lines, bsDemand has 700', ra.error === 'err_no_lines' && (await X('bsDemand').findOne({ _id: `${cid}:${d(3)}` }))?.volume === 700 && (await B.unmetDemand()) === 700)

    // (b) auto-buy on, 1000 SMS 3 days ahead
    await B.setConfig({ autoProvision: true, manualApproval: false }, 'test'); await X('bsDemand').deleteMany({})
    const rb = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 })
    ok('(b) 1000-SMS booking 3 days ahead accepted with zero lines', !!rb.booking && rb.booking.price === 100, JSON.stringify(rb.error || rb.booking?.allocation))
    const cr = await B.confirmBooking(rb.booking._id, { method: 'wallet' })
    const bk = await X('bsBookings').findOne({ _id: rb.booking._id })
    ok('(b) confirm buys ceil(1000/(320*0.8)) = 4 lines, status provisioning', cr.ok && provCalls === 4 && (await X('bsEsims').countDocuments()) === 4 && bk.status === 'provisioning', `prov=${provCalls} status=${bk.status}`)
    await B.healthCheck(); await B.autoscale()
    ok('(b) healthCheck+autoscale → 4 available, booking scheduled, no extra purchase', (await X('bsEsims').countDocuments({ status: 'available' })) === 4 && (await X('bsBookings').findOne({ _id: rb.booking._id })).status === 'scheduled' && provCalls === 4, `prov=${provCalls}`)

    // (c) today / tomorrow with zero lines still refused
    cid = await fresh(AUTO)
    const rc0 = await B.createBooking(cid, { date: d(0), hour: 23, volume: 600 })
    ok('(c) today with zero lines refused even with auto-buy on', rc0.error === 'err_no_lines' && provCalls === 0, `${rc0.error}`)
    const rc2 = await B.createBooking(cid, { date: d(1), hour: 12, volume: 600 })
    ok('(c) exactly leadDays (1) ahead is accepted', !!rc2.booking, rc2.error || '')

    // (d) per-line daily cap in the send loop
    cid = await fresh(AUTO)
    const pre = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 }); await B.confirmBooking(pre.booking._id, {}); await B.healthCheck()
    const lines = await X('bsEsims').countDocuments({ status: 'available' })
    await B.setConfig({ esimDailyLimit: 3, warmupDays: 1, platformPerMin: 10000, esimPerMin: 10000 }, 'test')
    for (let i = 0; i < 20; i++) { const r = await B.sendOne(cid, `+1212555${4100 + i}`, `TEST hi ${i}`); if (r.error) console.log('sendOne', r.error) }
    for (let i = 0; i < 30; i++) await B.tick()
    const sent = await X('bsMessages').countDocuments({ cid, status: 'sent' }), queued = await X('bsMessages').countDocuments({ cid, status: 'queued' }), daily = await X('bsEsimDaily').find().toArray()
    ok(`(d) exactly lines×3 = ${lines * 3} sent, rest queued, bsEsimDaily n<=3`, sent === lines * 3 && queued === 20 - lines * 3 && daily.every(x => x.n <= 3), `sent=${sent} queued=${queued} daily=${daily.map(x => x.n)}`)
    await B.setConfig({ esimDailyLimit: 400, warmupDays: 5, platformPerMin: 30, esimPerMin: 10 }, 'test')

    // (e) credit forecast
    await B.creditWatch(); const f0 = (await B.state()).forecast
    process.env.BULK_ESIM_FAKE_CREDIT = '20'; alerts.length = 0; await B.creditWatch(); const f1 = (await B.state()).forecast
    ok('(e) credit 20 → one "getting low" alert, not paused', alerts.filter(a => /getting low/.test(a)).length === 1 && !(await B.state()).reasons.length, `committed=${f1.committed} available=${f1.available}`)
    await B.creditWatch(); ok('(e) not repeated same day', alerts.filter(a => /getting low/.test(a)).length === 1)
    ok('(e) createBooking refused err_no_lines', (await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 })).error === 'err_no_lines')
    const pe = await B.provisionOne('test'); ok('(e) provisionOne refused with credit error', !!pe.error && /credit/i.test(pe.error), pe.error)
    process.env.BULK_ESIM_FAKE_CREDIT = '2'; alerts.length = 0; await B.creditWatch()
    ok('(e) credit 2 → paused', (await B.state()).reasons.includes('provider_credit') && alerts.some(a => /PAUSED/.test(a)))
    await B.creditWatch(); ok('(e) no nag within the hour', !alerts.some(a => /Still paused/.test(a)))
    await X('bsConfig').updateOne({ _id: 'state' }, { $set: { creditNagAt: Date.now() - 2 * 3600000 } }); await B.creditWatch()
    ok('(e) creditNagAt 2h back → "Still paused" alert', alerts.some(a => /Still paused/.test(a)))
    process.env.BULK_ESIM_FAKE_CREDIT = '500'; await B.creditWatch()
    ok('(e) credit 500 → resumed + booking accepted', !(await B.state()).reasons.length && !!(await B.createBooking(cid, { date: d(4), hour: 12, volume: 600 })).booking, `f0.committed=${f0.committed}`)

    // (f) suspended → replace → pre-use check (auto-passed in dry run) → pool
    const victim = await X('bsEsims').findOne({ status: 'available' })
    process.env.BULK_ESIM_FAKE_SUSPENDED = victim.iccid; alerts.length = 0; await B.healthCheck(); process.env.BULK_ESIM_FAKE_SUSPENDED = ''
    const old = await X('bsEsims').findOne({ _id: victim._id }), nl = await X('bsEsims').findOne({ replaces: victim._id })
    ok('(f) old line replaced, new {replaces, testing, verify:true}', old.status === 'replaced' && nl?.status === 'testing' && nl.verify === true, `${old.status}/${nl?.status}`)
    await B.healthCheck()
    const vt = await X('bsTests').findOne({ esimId: nl._id, type: 'check', kind: 'pre_use' })
    ok('(f) pre-use check recorded + check text new line → peer', !!vt && vt.result === 'passed' && !!(await X('bsMessages').findOne({ esimId: nl._id, system: true, body: `CloudIVR line check ${vt.code}` })))
    ok('(f) new line available after the check', (await X('bsEsims').findOne({ _id: nl._id })).status === 'available')

    // (g) expiry
    const ex = await X('bsEsims').findOne({ status: 'available' }); alerts.length = 0
    process.env.BULK_ESIM_FAKE_EXPIRED = ex.iccid; await B.healthCheck(); process.env.BULK_ESIM_FAKE_EXPIRED = ''
    const others = await X('bsEsims').find({ status: 'available' }).toArray()
    ok('(g) expired line marked expired + "plan ended" alert', (await X('bsEsims').findOne({ _id: ex._id })).status === 'expired' && alerts.some(a => /plan ended/.test(a)))
    ok('(g) other lines expirationDate ~30 days ahead', others.length > 0 && others.every(e => Math.abs(new Date(e.expirationDate) - Date.now() - 30 * DAY) < 3600000))

    // ===== bug probes =====
    // P1: confirm after the hold expired → booking excluded from its own linesShort → scheduled without buying lines
    cid = await fresh(AUTO)
    const h = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 })
    await X('bsBookings').updateOne({ _id: h.booking._id }, { $set: { holdUntil: new Date(Date.now() - 60000) } })
    await B.confirmBooking(h.booking._id, {})
    const hb = await X('bsBookings').findOne({ _id: h.booking._id })
    probe('P1 confirm after hold expiry still buys the lines', !(provCalls === 4), `prov=${provCalls} status=${hb.status}`)

    // P2: two bookings same date paid concurrently → each buys the full shortfall
    cid = await fresh(AUTO)
    const cid2 = (await B.customer('TEST_Iter241', '9002'))._id
    const b1 = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 }), b2 = await B.createBooking(cid2, { date: d(3), hour: 14, volume: 1000 })
    await Promise.all([B.confirmBooking(b1.booking._id, {}), B.confirmBooking(b2.booking._id, {})])
    const need2 = Math.ceil(2000 / (B.lineCap(await B.cfg(), 4) * 0.8))
    probe(`P2 concurrent confirms buy no more than needed (${need2})`, provCalls > need2, `bought=${provCalls}`)

    // P3: stale forecast inside a batch — reserve fits 1 line, batch of 4 requested
    cid = await fresh(AUTO)
    process.env.BULK_ESIM_FAKE_CREDIT = '25'; await B.creditWatch()
    const fP3 = (await B.state()).forecast
    const pm = await B.provisionMany(4, 'probe')
    probe(`P3 provisionMany respects reserve (available $${fP3.available}, line $10)`, pm.ok > Math.floor(fP3.available / 10), `bought=${pm.ok}`)

    // P4: booking day arrives while bought lines are still not active → autoscale buys again each run
    cid = await fresh(AUTO)
    const p4 = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 }); await B.confirmBooking(p4.booking._id, {})
    const k = Object.keys(p4.booking.allocation)[0], hr = hourAhead()
    await X('bsBookings').updateOne({ _id: p4.booking._id }, { $set: { date: d(0), allocation: { [`${d(0)}T${String(hr).padStart(2, '0')}`]: 1000 } } })
    await X('bsEsims').updateMany({}, { $set: { status: 'provisioning', msisdn: null } })
    provCalls = 0; await B.autoscale(); const first = provCalls; await B.autoscale()
    probe('P4 autoscale does not re-buy while lines for today are still provisioning', provCalls > 0, `run1 +${first}, run1+2 +${provCalls} (orig key ${k})`)

    // P5: a refusal for a past hour (err_slot) is counted as unmet demand and drives purchases
    cid = await fresh(AUTO)
    const p5 = await B.createBooking(cid, { date: d(-1), hour: 12, volume: 2000 })
    probe('P5 past-date/slot refusals not recorded as unmet demand', (await B.unmetDemand()) > 0, `err=${p5.error} unmet=${await B.unmetDemand()}`)
    // P6: demand later satisfied by a booking stays in bsDemand → autoscale buys for both
    cid = await fresh({ ...AUTO })
    await B.setConfig({ autoProvision: false }, 'test')
    await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 })
    await B.setConfig({ autoProvision: true }, 'test')
    const p6 = await B.createBooking(cid, { date: d(3), hour: 12, volume: 1000 }); await B.confirmBooking(p6.booking._id, {})
    const after = provCalls; await B.autoscale()
    probe('P6 satisfied demand not bought twice', provCalls > after, `confirm bought ${after}, autoscale bought +${provCalls - after}`)
  } catch (e) { console.error('FATAL', e); fail++ }
  console.log(`\n${pass} passed, ${fail} failed; probes with bugs: ${probes.filter(p => p.bug).map(p => p.name.split(' ')[0]).join(',') || 'none'}`)
  await wipe(); await cl.close(); process.exit(fail ? 1 : 0)
})()
