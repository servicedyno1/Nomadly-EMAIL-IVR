// QA (iter239, updated iter240 for the new API): eSIM BulkSMS STOP/HELP compliance, contacts upload + consent step (bot flow with fake
// document), storage failure path, no-auto-provision, low credit pause/resume, and iter240 edge cases (no lines, day allowance, cancel
// returns allowance, prepaid expiry + refund once, prepaid retry keeps quotaDay, quiet hours, HI/NL zones, 3-part limit, +1 non-US/CA,
// link/phone check, pricing, translations). Simulated provider only. Run with nodejs stopped:
//   sudo supervisorctl stop nodejs && node js/tests/test_bulk_esim_stop_upload_iter239.js; sudo supervisorctl start nodejs
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const http = require('http')
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
const BOT = require('../bulk-esim/bot')
const TZ = require('../bulk-esim/tz')
const I = require('../bulk-esim/i18n')
const storage = require('../bulk-esim/storage')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const COLS = ['bsConfig', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsUploads', 'bsDrafts']
const nums = (n, base = 3000, ac = '212') => Array.from({ length: n }, (_, i) => `+1${ac}555${String(base + i).padStart(4, '0')}`)
// first open (bookable) hour of a day with at least `need` free
const openHour = async (date, need = 1) => (await B.availability(date)).slots.find(s => s.free >= need)?.hour

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) if (await db.collection(c).countDocuments() > 1) throw new Error(`${c} not empty — refusing to run`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await BOT.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  process.env.BULK_ESIM_WORKER = ''
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)

  // ---- no eSIM → no bookings ----
  const cA = (await B.customer('Nomadly', '9001'))._id
  const cp0 = (await B.createCampaign(cA, { name: 'TEST_nolines', content: 'Hi', contacts: nums(500), consent: true })).campaign
  const nb = await B.createBooking(cA, { date: day, hour: 18, campaignId: cp0._id })
  ok('0 healthy eSIMs → createBooking err_no_lines', nb.error === 'err_no_lines', JSON.stringify(nb))
  const av0 = await B.availability(day)
  const sent0 = []; const st0 = { action: 'bse-day', bseCampaign: cp0._id, userLanguage: 'en' }
  await BOT.handle({ chatId: '9001', msg: { text: day }, message: day, info: st0, state: {}, set: async (_s, _c, k, v) => { st0[k] = v }, saveInfo: async (k, v) => { st0[k] = v }, send: async (_c, t) => { sent0.push(t) }, goto: {} })
  ok('day picker with 0 lines shows "not available" message', av0.capacity === 0 && st0.action === 'bse-day' && /not available/.test(sent0[0] || ''), sent0[0])

  // ---- defaults / no auto provisioning ----
  const c0 = await B.cfg()
  ok('defaults minEsims=1 autoProvision=false manualApproval=true price .10/.15', c0.minEsims === 1 && c0.autoProvision === false && c0.manualApproval === true && c0.pricePlain === 0.1 && c0.priceLink === 0.15)
  let provCalls = 0; const realProv = P.provision; P.provision = async (...a) => { provCalls++; return realProv(...a) }
  await B.autoscale()
  ok('autoscale with 0 eSIMs does NOT provision (alerts instead)', provCalls === 0 && (await db.collection('bsEsims').countDocuments()) === 0 && alerts.some(a => /Provisioning needs approval/.test(a)))
  const said = []; await BOT.admin('1', '/bulkprovision', (t) => said.push(t))
  ok('/bulkprovision (admin) provisions exactly one (simulated)', provCalls === 1 && (await db.collection('bsEsims').countDocuments()) === 1, said.join('|'))
  await B.healthCheck()
  const e1 = await db.collection('bsEsims').findOne({ _id: 'ESIM-0001' })
  ok('eSIM healthy + available after check', e1.status === 'available' && e1.health === 'healthy')
  await B.setConfig({ esimDailyLimit: 5000, warmupDays: 1 }, 'qa')
  const H = await openHour(day, 1)
  ok('booking hours offered only inside mainland quiet window', H != null && (await B.availability(day)).slots.filter(s => s.free).every(s => TZ.hourOpen(day, s.hour)), `first open ${H}`)
  // booking needing more capacity than 1 eSIM → no provisioning
  const bk = await B.createBooking(cA, { date: day, hour: H, volume: 500 })
  ok('volume-only booking priced plain $50', bk.booking?.price === 50, JSON.stringify(bk.error || ''))
  await B.setConfig({ esimPerMin: 1, platformPerMin: 1 }, 'qa')
  await db.collection('bsBookings').updateOne({ _id: bk.booking._id }, { $set: { allocation: { [`${day}T${String(H).padStart(2, '0')}`]: 500 } } })
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  await B.autoscale()
  ok('confirmBooking needing capacity + autoscale demand do NOT buy eSIM', provCalls === 1 && (await db.collection('bsEsims').countDocuments()) === 1)
  await B.setConfig({ esimPerMin: 10, platformPerMin: 30 }, 'qa')
  const dk = `${cA}:${day}`
  ok('paid booking reserves the allowance for its day', (await db.collection('bsDaily').findOne({ _id: dk }))?.used === 500)
  // ---- cancel returns money + allowance ----
  const can = await B.cancelBooking(bk.booking._id, { cid: cA })
  const nRef = await db.collection('bsNotify').findOne({ bookingId: bk.booking._id, type: 'refund' })
  ok('cancel paid booking → refunded $50 + allowance returned + refund notice', can.ok && can.refunded === 50 && (await db.collection('bsDaily').findOne({ _id: dk }))?.used === 0 && nRef?.amount === 50 && nRef?.key === 'n_refund_cancel')
  // ---- day allowance ----
  await B.setCustomer(cA, { dailyLimit: 800 }, 'qa')
  const b1 = await B.createBooking(cA, { date: day, hour: H, volume: 500 }); await B.confirmBooking(b1.booking._id, { method: 'wallet' })
  const b2 = await B.createBooking(cA, { date: day, hour: H, volume: 500 })
  ok('booking over remaining day allowance → err_allowance_day (300 left)', b2.error === 'err_allowance_day' && b2.args[0] === 300 && b2.args[1] === day, JSON.stringify(b2))
  const b2b = await B.createBooking(cA, { date: day, hour: H, volume: 900 })
  ok('booking above the daily limit → err_allowance_over', b2b.error === 'err_allowance_over', JSON.stringify(b2b))
  await B.cancelBooking(b1.booking._id, { by: 'admin' }); await B.setCustomer(cA, { dailyLimit: 2000 }, 'qa')

  // ---- content: link/phone check, 3-part limit incl. opt-out, pricing, consent ----
  ok('plain campaign with www link refused', B.checkContent('Visit www.qa.com', false).error === 'err_has_link')
  ok('plain campaign with https link refused', B.checkContent('see https://x.y/z', false).error === 'err_has_link')
  ok('plain campaign with phone number refused', B.checkContent('Call 212-555-1234 now', false).error === 'err_has_link')
  ok('plain campaign with bare domain refused', B.checkContent('go to shop.example.com', false).error === 'err_has_link')
  ok('link campaign with link accepted', !B.checkContent('Visit www.qa.com', true).error)
  const room = 153 * 3 - B.OPT.length
  ok('3-part limit includes opt-out line', !B.checkContent('a'.repeat(room), false).error && B.checkContent('a'.repeat(room + 1), false).error === 'err_too_long', `room=${room}`)
  ok('createCampaign without consent → err_consent', (await B.createCampaign(cA, { name: 'x', content: 'Hi', contacts: nums(500) })).error === 'err_consent')
  const lc = (await B.createCampaign(cA, { name: 'TEST_link', content: 'Visit www.qa.com', contacts: nums(500, 4000), withLinks: true, consent: true })).campaign
  const lb = await B.createBooking(cA, { date: day, hour: H, campaignId: lc._id })
  ok('link campaign priced $0.15/part ($75 per 500)', lb.booking?.price === 75 && lb.booking?.unitPrice === 0.15, JSON.stringify(lb.error || lb.booking?.price))
  const mp = (await B.createCampaign(cA, { name: 'TEST_2part', content: 'b'.repeat(200), contacts: nums(300, 5000), consent: true })).campaign
  ok('multi-part SMS counts each part for size (300 contacts × 2 parts = 600)', mp?.parts === 600 && mp?.volume === 300, JSON.stringify(mp?.parts))
  await B.cancelBooking(lb.booking._id, { by: 'admin' })

  // ---- +1 numbers outside USA/Canada ----
  const badNums = { Jamaica: '+18765551234', PuertoRico: '+17875551234', Guam: '+16715551234', TollFree800: '+18005551234', TollFree888: '+18885551234', Bahamas: '+12425551234' }
  for (const [k, v] of Object.entries(badNums)) ok(`${k} ${v} refused`, !TZ.validUsCa(v) && (await B.sendOne(cA, v, 'hi')).error === 'err_number')
  ok('US/CA mobiles accepted (212, 808 HI, 709 NL, 604 BC)', ['+12125551234', '+18085551234', '+17095551234', '+16045551234'].every(TZ.validUsCa))
  ok('Hawaii 808 → Pacific/Honolulu, Newfoundland 709 → America/St_Johns', TZ.zones('+18085551234')[0] === 'Pacific/Honolulu' && TZ.zones('+17095551234')[0] === 'America/St_Johns')
  // 2026-01-15 18:00Z: HI 08:00 open; 2026-01-15 17:30Z: HI 07:30 closed (wait 30min); NL is UTC-3:30 → 17:30Z = 14:00 open; 00:45Z = 21:15 closed
  ok('Hawaii quiet-hours math', TZ.quietWait('+18085551234', 8, 21, Date.parse('2026-01-15T18:00:00Z')) === 0 && TZ.quietWait('+18085551234', 8, 21, Date.parse('2026-01-15T17:30:00Z')) === 30 * 60000)
  ok('Newfoundland quiet-hours math (half-hour zone)', TZ.quietWait('+17095551234', 8, 21, Date.parse('2026-01-15T17:30:00Z')) === 0 && TZ.quietWait('+17095551234', 8, 21, Date.parse('2026-01-16T00:45:00Z')) > 0)

  // ---- STOP variants & cross-customer ----
  const eSim = e1.msisdn, cB = (await B.customer('Nomadly', '9002'))._id, cC = (await B.customer('OtherBrand', '9003'))._id
  const variants = ['STOP', 'stopall', ' Unsubscribe ', 'Opt Out', 'QUIT', 'cancel', 'End', 'STOP.']
  for (let i = 0; i < variants.length; i++) {
    const ph = `+1415555${String(1000 + i)}`
    const q1 = await B.sendOne(cB, ph, 'hello B'), q2 = await B.sendOne(cC, ph, 'hello C')
    await B.onWebhook('', {}, { data: { From: ph, Owner: eSim, Message_Body: variants[i], Message_ID: `stopv${i}` } })
    const sup = await db.collection('bsSuppression').findOne({ cid: '*', phone: ph })
    const m1 = await db.collection('bsMessages').findOne({ _id: q1.messageId }), m2 = await db.collection('bsMessages').findOne({ _id: q2.messageId })
    const conf = await db.collection('bsMessages').countDocuments({ to: ph, system: true, body: /unsubscribed/ })
    ok(`STOP variant ${JSON.stringify(variants[i])} → block + queued rejected + one confirmation`, !!sup && m1.status === 'rejected' && m2.status === 'rejected' && m1.failureReason === 'opted_out' && conf === 1)
  }
  const ph0 = '+14155551000'
  ok('sendOne blocked for other brands too (err_opted)', (await B.sendOne(cC, ph0, 'x')).error === 'err_opted' && (await B.sendOne(cA, ph0, 'x')).error === 'err_opted')
  ok('parseContacts drops it for all customers', !(await B.parseContacts(cA, `${ph0}`)).contacts.length)
  // second STOP from same number (new Message_ID) → no second confirmation
  await B.onWebhook('', {}, { data: { From: ph0, Owner: eSim, Message_Body: 'stop', Message_ID: 'stop-again' } })
  ok('repeat STOP → still one confirmation', (await db.collection('bsMessages').countDocuments({ to: ph0, system: true, body: /unsubscribed/ })) === 1)
  // processOne: message already claimed when STOP arrives → rejected by worker
  const ph9 = '+14155552222'
  const qa = await B.sendOne(cA, ph9, 'race')
  ok('one-off text gets the opt-out line', (await db.collection('bsMessages').findOne({ _id: qa.messageId })).body.endsWith(B.OPT))
  await db.collection('bsMessages').updateOne({ _id: qa.messageId }, { $set: { status: 'processing' } })
  await B.onWebhook('', {}, { data: { From: ph9, Owner: eSim, Message_Body: 'stop', Message_ID: 'race1' } })
  await db.collection('bsMessages').updateOne({ _id: qa.messageId }, { $set: { status: 'queued', nextAt: new Date(Date.now() - 1000) } })
  await db.collection('bsMessages').updateMany({ system: true }, { $set: { nextAt: new Date(Date.now() + 3600000) } })
  for (let i = 0; i < 3; i++) await B.tick()
  const qam = await db.collection('bsMessages').findOne({ _id: qa.messageId })
  ok('send worker (processOne) rejects opted-out number', qam.status === 'rejected' && qam.failureReason === 'opted_out', qam.status)
  await db.collection('bsMessages').updateMany({ system: true }, { $set: { nextAt: new Date(Date.now() - 1000) } })
  for (let i = 0; i < 5; i++) await B.tick()
  ok('STOP confirmation actually sent (system texts skip suppression + quiet hours)', !!(await db.collection('bsMessages').findOne({ to: ph9, system: true, status: 'sent' })))
  const phA = '+14155553333', exp = new Date(Date.now() + 3600000)
  for (const cid of [cA, cB]) await db.collection('bsSessions').insertOne({ _id: `s_${cid}`, cid, esimId: e1._id, to: phA, status: 'active', lastActivityAt: new Date(), expiresAt: exp })
  await B.onWebhook('', {}, { data: { From: phA, Owner: eSim, Message_Body: 'STOP', Message_ID: 'amb1' } })
  ok('STOP from ambiguous sender still blocks globally (held for review)', !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: phA })) && (await db.collection('bsMessages').findOne({ from: phA, direction: 'in' }))?.status === 'review')
  const phR = '+14155554444'
  await db.collection('bsSessions').insertOne({ _id: 's_r', cid: cA, esimId: e1._id, to: phR, status: 'active', lastActivityAt: new Date(), expiresAt: exp })
  await B.onWebhook('', {}, { data: { From: phR, Owner: eSim, Message_Body: 'Stop', Message_ID: 'r1' } })
  ok('routed STOP → suppression.by=cid + owner notified (n_inbound_stop)', (await db.collection('bsSuppression').findOne({ cid: '*', phone: phR }))?.by === cA && !!(await db.collection('bsNotify').findOne({ type: 'inbound', from: phR, key: 'n_inbound_stop' })))
  await B.onWebhook('', {}, { data: { From: '+14155555555', Owner: eSim, Message_Body: 'please stop by tomorrow', Message_ID: 'ns1' } })
  ok('sentence containing "stop" does not block', !(await db.collection('bsSuppression').findOne({ phone: '+14155555555' })))
  for (const [i, id] of ['h1', 'h2'].entries()) await B.onWebhook('', {}, { data: { From: '+14155557777', Owner: eSim, Message_Body: i ? 'HELP' : 'help', Message_ID: id } })
  ok('HELP auto reply once/day (no suppression)', (await db.collection('bsMessages').countDocuments({ to: '+14155557777', system: true, body: /Reply STOP to opt out/ })) === 1 && !(await db.collection('bsSuppression').findOne({ phone: '+14155557777' })))
  const before = await db.collection('bsMessages').countDocuments({ to: phR, system: true })
  await B.onWebhook('', {}, { data: { From: phR, Owner: eSim, Message_Body: 'Stop', Message_ID: 'r1' } })
  ok('duplicate STOP webhook (same Message_ID) is idempotent', (await db.collection('bsMessages').countDocuments({ to: phR, system: true })) === before)
  await B.onWebhook('', {}, { data: { From: '+14155558888', Owner: '+19999999999', Message_Body: 'STOP', Message_ID: 'un1' } })
  ok('STOP to unknown platform number still blocks', !!(await db.collection('bsSuppression').findOne({ phone: '+14155558888' })))

  // ---- quiet hours in the worker ----
  // pick an area code whose local time is outside 8-21 right now (else skip with info)
  const cand = ['+12125551111', '+14155551111', '+18085551111', '+19075551111', '+17095551111', '+16045551111']
  const qp = cand.find(p => TZ.quietWait(p) > 0), op = cand.find(p => TZ.quietWait(p) === 0)
  await B.setConfig({ esimPerMin: 1000, platformPerMin: 1000 }, 'qa') // in-memory per-minute windows are full from the STOP tests
  if (qp) {
    const q = await B.sendOne(cA, qp, 'quiet test'), sess = { _id: 's_q', cid: cA, esimId: e1._id, to: qp, status: 'active', lastActivityAt: new Date(), expiresAt: exp }
    await db.collection('bsSessions').insertOne(sess)
    const rp = await B.sendOne(cA, qp, 'conversation reply', 's_q')
    const cpq = (await B.createCampaign(cA, { name: 'TEST_q', content: 'Hello', contacts: nums(500, 6000), consent: true })).campaign
    const tq = await B.testSend(cA, cpq._id, qp)
    for (let i = 0; i < 4; i++) await B.tick()
    const [mq, mr, mt] = await Promise.all([q.messageId, rp.messageId, tq.messageId].map(x => db.collection('bsMessages').findOne({ _id: x })))
    ok(`one-off to ${qp} at local quiet time is delayed, not dropped`, mq.status === 'queued' && mq.nextAt > new Date(), `${mq.status} next ${mq.nextAt?.toISOString()}`)
    ok('conversation reply skips quiet hours + has NO opt-out line', mr.status === 'sent' && !mr.body.includes('Reply STOP'), mr.status)
    ok('test text skips quiet hours + has opt-out line', mt.status === 'sent' && mt.body.endsWith(B.OPT), mt.status)
    ok('delayed one-off did not consume allowance yet', (await db.collection('bsMessages').findOne({ _id: q.messageId })).quotaDay == null)
  } else console.log('ℹ️  every candidate area code is inside 8-21 right now — quiet-hours worker test skipped')
  if (op) { const q = await B.sendOne(cA, op, 'open test'); for (let i = 0; i < 3; i++) await B.tick(); ok(`one-off to ${op} (local daytime) sent`, (await db.collection('bsMessages').findOne({ _id: q.messageId })).status === 'sent') }

  // ---- prepaid: retry keeps quotaDay; expiry returns allowance; refund once ----
  const cD = (await B.customer('Nomadly', '9004'))._id
  const cpE = (await B.createCampaign(cD, { name: 'TEST_exp', content: 'Hello', contacts: nums(500, 7000, '415'), consent: true })).campaign
  const bER = await B.createBooking(cD, { date: day, hour: H, campaignId: cpE._id }), bE = bER.booking
  if (!bE) throw new Error(`prepaid booking: ${JSON.stringify(bER)}`)
  const cfE = await B.confirmBooking(bE._id, { method: 'wallet', amount: bE.price }); if (cfE.error) throw new Error(`confirm: ${JSON.stringify(cfE)}`)
  bE.quotaDay = (await db.collection('bsBookings').findOne({ _id: bE._id })).quotaDay
  const dkE = `${cD}:${bE.quotaDay}`, usedE = (await db.collection('bsDaily').findOne({ _id: dkE }))?.used
  ok('paid campaign reserved its allowance (500)', usedE === 500 && bE.quotaDay === day && (await db.collection('bsMessages').countDocuments({ campaignId: cpE._id, prepaid: true, quotaDay: day })) === 500, `used=${usedE} quotaDay=${bE.quotaDay}`)
  // make 3 sendable now; first one hits a temporary provider error
  const ids = (await db.collection('bsMessages').find({ campaignId: cpE._id }).limit(3).toArray()).map(m => m._id)
  await db.collection('bsMessages').updateMany({ campaignId: cpE._id }, { $set: { nextAt: new Date(Date.now() + 86400000) } })
  await db.collection('bsMessages').updateMany({ _id: { $in: ids } }, { $set: { nextAt: new Date(Date.now() - 1000), to: '+18085550100' } })
  const realSend = P.sendSms; let calls = 0
  P.sendSms = async (a) => { if (a.key === ids[0] && calls++ === 0) { const e = new Error('temp'); e.kind = 'temporary'; throw e } return realSend(a) }
  // force HI quiet window open for this check
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'qa')
  for (let i = 0; i < 3; i++) await B.tick()
  const r0 = await db.collection('bsMessages').findOne({ _id: ids[0] })
  ok('prepaid retry keeps quotaDay, no double count', r0.status === 'queued' && r0.quotaDay === bE.quotaDay && r0.attempts === 1 && (await db.collection('bsDaily').findOne({ _id: dkE })).used === 500, `${r0.status} used=${(await db.collection('bsDaily').findOne({ _id: dkE })).used}`)
  P.sendSms = realSend
  await B.setConfig({ quietStart: 8, quietEnd: 21 }, 'qa')
  // everything still queued is past expireAt (long pause) → expired
  await db.collection('bsMessages').updateMany({ campaignId: cpE._id, status: 'queued' }, { $set: { expireAt: new Date(Date.now() - 1000) } })
  await B.finishCampaigns(); await B.finishCampaigns()
  const rep = await B.report(cpE._id), bkE = await db.collection('bsBookings').findOne({ _id: bE._id }), usedAfter = (await db.collection('bsDaily').findOne({ _id: dkE })).used
  const refs = await db.collection('bsNotify').find({ bookingId: bE._id, type: 'refund' }).toArray()
  ok('expired prepaid texts marked expired, allowance returned', rep.rejected === 498 && rep.sent === 2 && usedAfter === 2, `${JSON.stringify(rep)} used=${usedAfter}`)
  ok('campaign completed + refund covers expired (498 × $0.10 = $49.8) once', (await db.collection('bsCampaigns').findOne({ _id: cpE._id })).status === 'completed' && bkE.refundedUnsent === 49.8 && refs.length === 1 && refs[0].amount === 49.8, `${bkE.refundedUnsent} notices=${refs.length}`)
  await B.finishCampaigns()
  ok('refund not repeated on later runs', (await db.collection('bsNotify').countDocuments({ bookingId: bE._id, type: 'refund' })) === 1)

  // ---- low credit ----
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'qa')
  process.env.BULK_ESIM_FAKE_CREDIT = '3'; await B.creditWatch()
  const qL = await B.sendOne(cA, '+14155559991', 'credit test'); await B.tick()
  ok('low credit pauses (nothing sent) + admin alert', (await B.state()).reasons.includes('provider_credit') && (await db.collection('bsMessages').findOne({ _id: qL.messageId })).status === 'queued' && alerts.some(a => /PAUSED/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '80'; await B.creditWatch(); for (let i = 0; i < 3; i++) await B.tick()
  const qLm = await db.collection('bsMessages').findOne({ _id: qL.messageId })
  ok('top-up → auto resume + queued text goes out', !(await B.state()).reasons.length && alerts.some(a => /resumed/i.test(a)) && (qLm.status === 'sent' || qLm.nextAt > new Date()), qLm.status)
  delete process.env.BULK_ESIM_FAKE_CREDIT
  await B.setConfig({ quietStart: 8, quietEnd: 21 }, 'qa')

  // ---- contacts upload via bot flow (contacts → consent → campaign; file saved only after consent) ----
  const list = Array.from({ length: 505 }, (_, i) => `(212) 555-${String(3000 + i)}`).join('\n') + `\n${ph0}\nfoo,bar\n`
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(list) }).listen(0)
  const port = srv.address().port
  const mkCtx = (chatId, msg, st) => { const sent = []; return { sent, ctx: { chatId, msg, message: msg.text || '', info: st, state: {}, set: async (_s, _c, k, v) => { st[k] = v }, saveInfo: async (k, v) => { st[k] = v }, send: async (_c, t) => { sent.push(t) }, goto: {}, bot: { getFileLink: async () => `http://127.0.0.1:${port}/f.csv` } } } }
  const agree = async (chatId, st) => { const r = mkCtx(chatId, { text: I.btn(st.userLanguage || 'en').agree }, st); await BOT.handle(r.ctx); return r }
  let st = { action: 'bse-contacts', bseName: 'TEST_upload', bseContent: ['Hi'], bseLinks: false }
  let r = mkCtx('9100', { document: { file_id: 'x', file_name: 'list.exe', file_size: 100 } }, st); await BOT.handle(r.ctx)
  ok('upload .exe rejected', /\.txt or \.csv/.test(r.sent[0] || '') && st.action === 'bse-contacts')
  r = mkCtx('9100', { document: { file_id: 'x', file_name: 'big.csv', file_size: 3e6 } }, st); await BOT.handle(r.ctx)
  ok('upload >2MB rejected', /under 2 MB/.test(r.sent[0] || '') && st.action === 'bse-contacts')
  r = mkCtx('9100', { document: { file_id: 'x', file_name: 'Contacts.CSV', file_size: 9000 } }, st); await BOT.handle(r.ctx)
  ok('.CSV parsed → consent step, list in bsDrafts, nothing stored yet', st.action === 'bse-consent' && (await db.collection('bsDrafts').findOne({ _id: 'Nomadly:9100' }))?.contacts?.length === 505 && (await db.collection('bsUploads').countDocuments()) === 0 && /505 numbers/.test(r.sent[0] || ''), r.sent[0]?.slice(0, 60))
  r = mkCtx('9100', { text: 'yes' }, st); await BOT.handle(r.ctx)
  ok('consent step needs the button', st.action === 'bse-consent' && /pick one/.test(r.sent[0] || ''))
  r = await agree('9100', st)
  const cp = await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })
  const up = cp?.uploadId && await db.collection('bsUploads').findOne({ _id: cp.uploadId })
  ok('consent → campaign (opted-out skipped, consentAt set, draft removed)', st.action === 'bse-test' && cp?.volume === 505 && !!cp.consentAt && /opted out/.test(r.sent[0] || '') && !(await db.collection('bsDrafts').findOne({ _id: 'Nomadly:9100' })), r.sent[0]?.slice(0, 90))
  ok('upload copy stored after consent (bsUploads + campaign.uploadId)', !!up && !!up.storagePath && up.originalName === 'Contacts.CSV' && up.contentType === 'text/csv')
  if (up) ok('stored object readable from Object Storage', (await storage.get(up.storagePath)).toString().includes('555-3000'))
  // too few → never stored
  const few = http.createServer((req, res) => res.end('+12125550001\n+12125550002')).listen(0)
  st = { action: 'bse-contacts', bseName: 'TEST_few', bseContent: ['Hi'] }
  r = mkCtx('9104', { document: { file_id: 'x', file_name: 'few.txt', file_size: 30 } }, st); r.ctx.bot.getFileLink = async () => `http://127.0.0.1:${few.address().port}/f`; await BOT.handle(r.ctx)
  ok('too-few upload → contacts_few, nothing stored', st.action === 'bse-contacts' && /at least 500/.test(r.sent[0] || '') && (await db.collection('bsUploads').countDocuments()) === 1)
  few.close()
  // storage failure → campaign still created
  const realProxy = process.env.INTEGRATION_PROXY_URL
  process.env.INTEGRATION_PROXY_URL = 'http://127.0.0.1:1'; await storage.init(true).catch(() => {})
  st = { action: 'bse-contacts', bseName: 'TEST_upload2', bseContent: ['Hi'] }
  r = mkCtx('9101', { document: { file_id: 'x', file_name: 'list.txt', file_size: 9000 } }, st); await BOT.handle(r.ctx); await agree('9101', st)
  const cp2 = await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })
  ok('storage failure → campaign still proceeds (uploadId null)', st.action === 'bse-test' && cp2?.volume === 505 && !cp2.uploadId)
  if (realProxy === undefined) delete process.env.INTEGRATION_PROXY_URL; else process.env.INTEGRATION_PROXY_URL = realProxy
  await storage.init(true).catch(() => {})
  st = { action: 'bse-contacts', bseName: 'TEST_upload3', bseContent: ['Hi'] }
  r = mkCtx('9102', { document: { file_id: 'x', file_name: 'list.txt', file_size: 10 } }, st); r.ctx.bot.getFileLink = async () => { throw new Error('nope') }; await BOT.handle(r.ctx)
  ok('unreadable file → friendly error', /\.txt or \.csv/.test(r.sent[0] || '') && st.action === 'bse-contacts')
  st = { action: 'bse-contacts', bseName: 'TEST_paste', bseContent: ['Hi'] }
  r = mkCtx('9103', { text: list }, st); await BOT.handle(r.ctx); await agree('9103', st)
  ok('paste path still works (no upload stored)', st.action === 'bse-test' && !(await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })).uploadId)
  srv.close()

  // ---- translations ----
  const en = I.LANGS.en, enKeys = Object.keys(en).filter(k => !['btn', 'st'].includes(k))
  for (const L of ['fr', 'zh', 'hi', 'fa']) {
    const p = I.LANGS[L], miss = enKeys.filter(k => p[k] == null), missB = Object.keys(en.btn).filter(k => !p.btn?.[k]), missS = Object.keys(en.st).filter(k => k !== 'processing_' && !p.st?.[k])
    const same = Object.keys(en.btn).filter(k => p.btn?.[k] === en.btn[k] && !(L === 'fr' && k === 'convs')) // “Conversations” is French too
    ok(`${L}: all keys / buttons / statuses translated`, !miss.length && !missB.length && !missS.length && !same.length, `${miss.join(',')}|${missB.join(',')}|${missS.join(',')}|same:${same.join(',')}`)
    let thrown = null; for (const k of enKeys) { try { I.t(L, k, { min: 1, max: 2, n: 1, parts: 1, used: 0, limit: 1, reset: 'x', code: 'x', wallet: null }, 1, 2, 3, 4) } catch (e) { thrown = `${k}: ${e.message}` } }
    ok(`${L}: every text renders`, !thrown, thrown || '')
    const labels = Object.values(I.btn(L)); ok(`${L}: button labels unique`, new Set(labels).size === labels.length)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
