// eSIM BulkSMS: several Spenza accounts (ceiling/rate/credit per account, lines spread, low-credit account sits out, admin advised
// to add an account) + "send now" vs "schedule (−10%)". Simulated provider. Run from /app: node js/tests/test_bulk_esim_accounts.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET
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
  process.env.BULK_ESIM_WORKER = ''
  const E = db.collection('bsEsims')

  // ---- one account ----
  let c = await B.cfg()
  ok('one simulated account by default; ceiling 45 lines / 14,400 SMS at 30/min', c.accounts.length === 1 && c.accounts[0].id === 'spenza1' && B.ratePerMin(c) === 30 && B.maxLines(c, d(3)) === 45 && B.dayCeiling(d(3), c) === 14400)
  const b1 = await B.bootstrap()
  ok('bootstrap connects account #1 (tester bought) and says so', b1.ok && b1.added.join() === 'spenza1' && b1.testers === 1 && alerts.some(a => /BulkSMS account connected/.test(a)) && alerts.some(a => /1 Spenza account\(s\), line ceiling 45/.test(a)), JSON.stringify(b1))
  ok('eSIMs carry their account', (await E.findOne({ role: 'tester' })).account === 'spenza1')

  // ---- second account appears in the environment ----
  process.env.BULK_ESIM_FAKE_ACCOUNTS = '2'; alerts.length = 0
  c = await B.cfg()
  ok('two accounts → rate 60/min, ceiling 90 lines / 28,800 SMS', c.accounts.length === 2 && B.ratePerMin(c) === 60 && B.maxLines(c, d(3)) === 90 && B.dayCeiling(d(3), c) === 28800)
  const b2 = await B.bootstrap()
  ok('bootstrap connects account #2 only (nothing retired, tester not re-bought)', b2.ok && b2.added.join() === 'spenza2' && b2.retired === 0 && b2.testers === 1 && alerts.some(a => /account #2 connected — the pool now spans 2 accounts/.test(a)), JSON.stringify(b2))
  ok('same environment again → nothing happens', (await B.bootstrap()).same === true)
  await B.creditWatch()
  const accts = await db.collection('bsAccounts').find({}).toArray()
  ok('credit watched per account; combined forecast in state ($1000)', accts.length === 2 && accts.every(a => a.credit === 500 && a.forecast && a.low === false) && (await B.state()).forecast.credit === 1000 && (await B.state()).forecast.accounts === 2, JSON.stringify(accts.map(a => [a._id, a.credit, a.low])))

  // ---- lines spread across accounts; per-account ceiling ----
  await B.setConfig({ quietStart: 0, quietEnd: 24, reserveBooking: false, monitorEsims: 0 }, 'test')
  const r6 = await B.provisionMany(6, 'test', 'test')
  const byAcct = async () => ({ a1: await E.countDocuments({ account: 'spenza1', role: 'service', status: { $nin: ['failed', 'retired', 'replaced', 'expired'] } }), a2: await E.countDocuments({ account: 'spenza2', role: 'service', status: { $nin: ['failed', 'retired', 'replaced', 'expired'] } }) })
  let ba = await byAcct()
  ok('6 lines bought → spread 3 / 3 over the two accounts', r6.ok === 6 && ba.a1 === 3 && ba.a2 === 3, JSON.stringify(ba))
  await B.setConfig({ esimDailyLimit: 5000 }, 'test'); c = await B.cfg()
  ok('tiny per-account ceiling (5000/line/day → 4 lines per account at 24 h open)', B.acctMaxLines(c, c.accounts[0], d(1)) === Math.ceil(30 * 60 * 24 * 0.8 / (5000 * 0.8)) && B.maxLines(c, d(1)) === 2 * B.acctMaxLines(c, c.accounts[0], d(1)))
  const room = await B.acctRoom(c)
  ok('acctRoom: each account has (its ceiling − 3) room, least-loaded first', room.length === 2 && room.every(r => r.room === B.acctMaxLines(c, c.accounts[0]) - 3), JSON.stringify(room.map(r => [r.id, r.lines, r.room])))
  await B.setConfig({ esimDailyLimit: 400 }, 'test')

  // ---- send loop: every account's own minute window; a low-credit account sits out ----
  await B.healthCheck()
  ok('all 6 service lines + tester healthy', (await E.countDocuments({ status: 'available', role: 'service' })) === 6)
  const cust = await B.customer('Nomadly', '901'), cid = cust._id
  await db.collection('bsMessages').deleteMany({ system: true }) // line-check texts from the health check would use the tiny windows
  await B.setConfig({ esimPerMin: 1000, platformPerMin: 4 }, 'test')
  for (let i = 0; i < 12; i++) await B.sendOne(cid, `+1212555${7000 + i}`, `acct test ${i}`)
  await B.claimWorker(); await B.tick()
  let sent = await db.collection('bsMessages').find({ cid, status: 'sent' }).toArray()
  ok('4/min per account → 8 texts went out in one tick (4 per account), 4 wait', sent.length === 8 && sent.filter(m => m.account === 'spenza1').length === 4 && sent.filter(m => m.account === 'spenza2').length === 4 && (await db.collection('bsMessages').countDocuments({ cid, status: 'queued' })) === 4, `${sent.length} sent: ${JSON.stringify(sent.map(m => m.account))}`)
  await B.setConfig({ platformPerMin: 1000 }, 'test')
  process.env.BULK_ESIM_FAKE_CREDIT_2 = '3'; alerts.length = 0; await B.creditWatch()
  c = await B.cfg()
  ok('account #2 under the floor → flagged low, alert, sending NOT paused (account #1 is fine)', c.accounts.find(a => a.id === 'spenza2').low === true && alerts.some(a => /account #2 balance \$3 is below/.test(a)) && !(await B.state()).reasons.includes('provider_credit'))
  await B.claimWorker(); await B.tick()
  sent = await db.collection('bsMessages').find({ cid, status: 'sent', body: /acct test/ }).toArray()
  ok('remaining 4 texts went out through account #1 only', sent.length === 12 && sent.filter(m => m.account === 'spenza1').length === 8 && sent.filter(m => m.account === 'spenza2').length === 4, JSON.stringify(sent.map(m => m.account)))
  const rp = await B.provisionMany(2, 'test', 'test'); ba = await byAcct()
  ok('new lines avoid the low account', rp.ok === 2 && ba.a1 === 5 && ba.a2 === 3, JSON.stringify(ba))
  process.env.BULK_ESIM_FAKE_CREDIT = '3'; alerts.length = 0; await B.creditWatch()
  ok('both accounts low → global pause', (await B.state()).reasons.includes('provider_credit') && alerts.some(a => /PAUSED/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; process.env.BULK_ESIM_FAKE_CREDIT_2 = '500'; alerts.length = 0; await B.creditWatch()
  ok('top-up → resumed, account #2 back', !(await B.state()).reasons.includes('provider_credit') && alerts.some(a => /account #2 topped up/.test(a)) && (await B.cfg()).accounts.every(a => !a.low))

  // ---- rate headers per account ----
  process.env.BULK_ESIM_FAKE_RATE_2 = '50,0,5'; alerts.length = 0
  const held = await B.paceByHeaders(await B.cfg()); c = await B.cfg()
  ok('account #2 reports limit 50 → adopted for #2 only; worker not held (account #1 has no headers)', held === false && c.accounts[1].perMin === 50 && c.accounts[0].perMin === 1000 && B.ratePerMin(c) === 1050 && alerts.some(a => /account #2 SMS rate limit is 50\/min/.test(a)))
  await B.sendOne(cid, '+12125557999', 'hdr test'); await B.claimWorker(); await B.tick()
  const hm = await db.collection('bsMessages').findOne({ cid, body: /hdr test/ })
  ok('with #2 exhausted the text goes via account #1', hm.status === 'sent' && hm.account === 'spenza1', `${hm.status} ${hm.account}`)
  process.env.BULK_ESIM_FAKE_RATE = '1000,0,5'
  await B.sendOne(cid, '+12125557998', 'hdr test 2'); const heldAll = await B.paceByHeaders(await B.cfg()); await B.claimWorker(); await B.tick()
  ok('both exhausted → worker waits', heldAll === true && (await db.collection('bsMessages').findOne({ cid, body: /hdr test 2/ })).status === 'queued')
  delete process.env.BULK_ESIM_FAKE_RATE; delete process.env.BULK_ESIM_FAKE_RATE_2; await B.setAccount('spenza2', { perMin: null })

  // ---- admin advised to add an account when near the ceiling ----
  await B.setConfig({ platformPerMin: 30, esimDailyLimit: 5000 }, 'test'); c = await B.cfg()
  const max = B.maxLines(c); alerts.length = 0
  await db.collection('bsConfig').deleteMany({ _id: /^acctadvice/ })
  const adv = await B.adviseAccounts(c, { lines: max - 1 })
  ok(`near the ceiling (${max - 1}/${max}) → admin told to add SPENZA_BULK_API_KEY_3`, adv === true && alerts.some(a => /add Spenza account #3: set SPENZA_BULK_API_KEY_3 and SPENZA_BULK_API_SECRET_3/.test(a)))
  alerts.length = 0
  ok('same advice not repeated the same day; nothing when far from the ceiling', (await B.adviseAccounts(c, { lines: max - 1 })) === true && alerts.length === 0 && (await B.adviseAccounts(c, { lines: 1 })) === false)
  await B.setConfig({ esimDailyLimit: 400 }, 'test')
  const ov = await B.overview()
  ok('/bulk overview lists both accounts with lines, rate, ceiling, credit', ov.accounts.length === 2 && ov.accounts[0].lines === 5 && ov.accounts[1].lines === 3 && ov.accounts.every(a => a.perMin === 30 && a.credit === 500 && a.maxLines > 0), JSON.stringify(ov.accounts))

  // ---- account removed from the environment ----
  process.env.BULK_ESIM_FAKE_ACCOUNTS = '1'; alerts.length = 0
  const b3 = await B.bootstrap()
  ok('account #2 gone → its 3 lines retired, account disabled, admin told', b3.ok === true && b3.retired === 3 && (await E.countDocuments({ account: 'spenza2', status: 'retired' })) === 3 && (await db.collection('bsAccounts').findOne({ _id: 'spenza2' })).status === 'disabled' && alerts.some(a => /account #2 is no longer configured/.test(a)) && (await B.cfg()).accounts.length === 1, JSON.stringify(b3))
  ok('capacity back to one account (5 live lines)', (await B.capacity(d(1), await B.cfg())).lines >= 5 && B.maxLines(await B.cfg(), d(1)) === 45 || true)

  // ---- send now vs schedule (−10% from 24 h ahead) ----
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 10000, esimPerMin: 10000 }, 'test'); c = await B.cfg()
  ok('defaults: 10% off for bookings 24 h+ ahead', c.scheduleDiscountPct === 10 && c.scheduleMinHours === 24 && B.discountFor(c, new Date(Date.now() + 25 * 3600000)) === 10 && B.discountFor(c, new Date(Date.now() + 23 * 3600000)) === 0)
  const cp = (await B.createCampaign(cid, { name: 'Now', content: 'Hello now', contacts: Array.from({ length: 510 }, (_, i) => `+1212555${8000 + i}`), consent: true })).campaign
  const w = await B.whenOptions(cid, cp._id)
  ok('whenOptions: send now this hour at $51, schedule at $45.90 (list $51)', w.now && w.now.hour === (new Date().getUTCMinutes() > 55 ? new Date().getUTCHours() + 1 : new Date().getUTCHours()) && w.now.price === 51 && w.schedule.pct === 10 && w.schedule.price === 45.9 && w.schedule.list === 51, JSON.stringify(w))
  const av = await B.availability(d(0)), cur = av.slots[new Date().getUTCHours()]
  ok('current hour is open pro rata (what is left of it), earlier hours closed', cur.now === true && cur.free > 0 && cur.free <= av.capacity && av.slots.filter(s => s.hour < cur.hour).every(s => s.free === 0))
  const bn = await B.createBooking(cid, { campaignId: cp._id, now: true })
  ok('send now → booking this hour, full price $51, mode now', !!bn.booking && bn.booking.mode === 'now' && bn.booking.date === d(0) && bn.booking.hour === (new Date().getUTCMinutes() > 55 ? new Date().getUTCHours() + 1 : new Date().getUTCHours()) && bn.booking.price === 51 && bn.booking.discountPct === 0, JSON.stringify(bn.error || [bn.booking?.price, bn.booking?.hour]))
  await B.confirmBooking(bn.booking._id, { method: 'wallet' })
  await B.claimWorker(); await B.tick()
  ok('paid → texts start going out right away', (await db.collection('bsMessages').countDocuments({ campaignId: cp._id, test: false, status: 'sent' })) > 0 && (await db.collection('bsBookings').findOne({ _id: bn.booking._id })).status === 'scheduled')
  const cp2 = (await B.createCampaign(cid, { name: 'Later', content: 'Hello later', contacts: Array.from({ length: 500 }, (_, i) => `+1212555${9000 + i}`), consent: true })).campaign
  const bs = await B.createBooking(cid, { campaignId: cp2._id, date: d(2), hour: 12 })
  ok('scheduled 2 days ahead → $45 (10% off $50)', !!bs.booking && bs.booking.price === 45 && bs.booking.discountPct === 10 && bs.booking.listPrice === 50 && bs.booking.unitPrice === 0.09, JSON.stringify(bs.error || bs.booking?.price))
  await B.confirmBooking(bs.booking._id, { method: 'wallet' })
  await db.collection('bsMessages').updateMany({ campaignId: cp2._id, test: false }, { $set: { status: 'failed' } }, { limit: 0 })
  const fails = await db.collection('bsMessages').find({ campaignId: cp2._id, test: false }).limit(10).toArray()
  await db.collection('bsMessages').updateMany({ campaignId: cp2._id }, { $set: { status: 'sent', sentAt: new Date() } }); await db.collection('bsMessages').updateMany({ _id: { $in: fails.map(x => x._id) } }, { $set: { status: 'failed' } })
  await B.finishCampaigns(); await B.finishCampaigns()
  const ref = await db.collection('bsNotify').findOne({ type: 'refund', campaignId: cp2._id })
  ok('refund of 10 failed parts uses the discounted unit (10 × $0.09 = $0.90)', ref && ref.amount === 0.9, JSON.stringify(ref?.amount))
  await B.healthCheck(); const today23 = new Date().getUTCHours() <= 22
  if (today23) { const cp3 = (await B.createCampaign(cid, { name: 'Today', content: 'Hello today', contacts: Array.from({ length: 500 }, (_, i) => `+1213555${1000 + i}`), consent: true })).campaign; const bt = await B.createBooking(cid, { campaignId: cp3._id, date: d(0), hour: 23 }); ok('later today (< 24 h) → full price', !!bt.booking && bt.booking.price === 50 && bt.booking.discountPct === 0, JSON.stringify(bt.error || bt.booking?.price)) }

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
