// eSIM BulkSMS engine check (simulated provider). Run from /app with the nodejs service stopped: node js/tests/test_bulk_esim_engine.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const TZ = require('../bulk-esim/tz')
const { t, LANGS } = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsUploads', 'bsDrafts']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1 }, 'test') // LEGACY_DEFAULTS: this suite covers the floor / spare-reserve / monitor paths
  process.env.BULK_ESIM_WORKER = ''
  ok('lean start: 2 service lines, no monitor, no floor, grows with demand (auto-buy on by default)', B.DEFAULTS.minEsims === 2 && B.DEFAULTS.monitorEsims === 0 && B.DEFAULTS.minCredit === 0 && B.DEFAULTS.autoProvision === true && B.DEFAULTS.manualApproval === false)
  await B.setConfig({ autoProvision: false, manualApproval: true }, 'test')
  process.env.WEB_CLOUDIVR_DRY_RUN = 'false'; const live = B.configured(); process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
  ok('live mode needs the shared database', live === !!process.env.BULK_ESIM_MONGO_URL)
  // Phone rules + quiet hours (fixed times).
  ok('Caribbean / territories / toll-free refused, US + CA accepted', !TZ.validUsCa('+18765551234') && !TZ.validUsCa('+17875550123') && !TZ.validUsCa('+18005550123') && TZ.validUsCa('+14165550123') && TZ.validUsCa('+12125550123'))
  const noonNY = Date.parse('2026-06-20T16:00:00Z'), lateNY = Date.parse('2026-06-21T02:00:00Z')
  // Time gating OFF by default — users can send/book any hour; quiet-hours deferral is disabled.
  ok('no time gate by default: any hour sends, any hour bookable', TZ.quietWait('+12125550123', 8, 21, lateNY) === 0 && TZ.hourOpen('2026-06-20', 3) && TZ.hourOpen('2026-06-20', 18))
  // The gate still works when explicitly re-enabled (BULKSMS_NO_TIME_GATE=false).
  process.env.BULKSMS_NO_TIME_GATE = 'false'; delete require.cache[require.resolve('../bulk-esim/tz')]
  const TZgate = require('../bulk-esim/tz')
  ok('quiet hours follow the area code when gate re-enabled', TZgate.quietWait('+12125550123', 8, 21, noonNY) === 0 && TZgate.quietWait('+12125550123', 8, 21, lateNY) > 0 && TZgate.quietWait('+13105550123', 8, 21, lateNY) === 0 && !TZgate.hourOpen('2026-06-20', 3) && TZgate.hourOpen('2026-06-20', 18))
  delete process.env.BULKSMS_NO_TIME_GATE; delete require.cache[require.resolve('../bulk-esim/tz')]
  ok('every language has every text', Object.entries(LANGS).every(([, p]) => Object.keys(LANGS.en).every(k => p[k] != null)) && t('fr', 'err_volume', 500, 2000).includes('500'))
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test')
  const cust = await B.customer('Nomadly', '111'), cid = cust._id
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const noLine = await B.createBooking(cid, { date: day, hour: 18, volume: 600 })
  ok('no bookings while there is no working eSIM', noLine.error === 'err_no_lines')
  for (let i = 0; i < 5; i++) await B.provisionOne('test')
  await B.healthCheck()
  const pool = await db.collection('bsEsims').find().toArray()
  ok('eSIMs get internal ids and join the pool only after checks', pool.length === 5 && pool[0]._id === 'ESIM-0001' && pool.every(e => e.status === 'available' && e.health === 'healthy'))
  await B.setConfig({ platformPerMin: 600, esimPerMin: 200, esimDailyLimit: 5000, warmupDays: 1, scheduleDiscountPct: 0 }, 'test')
  ok('customer gets the 2,000/day default', (await B.usage(cid)).limit === 2000)
  const raw = Array.from({ length: 520 }, (_, i) => `+1212555${1000 + i}`).join('\n') + '\nbad,123\n+15551234567\n+18765551234\n+12125551000'
  const pc = await B.parseContacts(cid, raw)
  ok('contacts: invalid, Caribbean and duplicates removed', pc.contacts.length === 520 && pc.invalid === 2 && pc.duplicates === 1, JSON.stringify({ ...pc, contacts: pc.contacts.length }))
  ok('declared text-only with a link or phone is refused; undeclared → link price type', (await B.createCampaign(cid, { name: 'x', content: 'Shop at www.shop.com', contacts: pc.contacts, withLinks: false, consent: true })).error === 'err_has_link' && (await B.createCampaign(cid, { name: 'x', content: 'Call 212 555 0100', contacts: pc.contacts, withLinks: false, consent: true })).error === 'err_has_link' && (await B.createCampaign(cid, { name: 'x', content: 'Call 212 555 0100', contacts: pc.contacts, consent: true })).campaign?.withLinks === true)
  ok('campaign needs consent', (await B.createCampaign(cid, { name: 'x', content: 'Hi', contacts: pc.contacts })).error === 'err_consent')
  const cr = await B.createCampaign(cid, { name: 'Spring', content: 'Hello A\n---\nHello B', contacts: pc.contacts, consent: true })
  ok('campaign created with rotation, opt-out line and part count', cr.campaign?.content.length === 2 && cr.campaign.parts === 520 && cr.campaign.withLinks === false)
  const tooLong = await B.createCampaign(cid, { name: 'Long', content: `${'x'.repeat(200)} see www.a.com`, contacts: pc.contacts, withLinks: true, consent: true })
  ok('text over one SMS (160 incl. opt-out line) refused', tooLong.error === 'err_too_long' && tooLong.args[0] === 160 - B.OPT.length, JSON.stringify(tooLong))
  const crL = await B.createCampaign(cid, { name: 'Long', content: `${'x'.repeat(100)} see www.a.com`, contacts: [...pc.contacts, ...Array.from({ length: 1600 }, (_, i) => `+1312555${1000 + i}`)], withLinks: true, consent: true })
  ok('link campaign: 1 part each, capped at 2,000 SMS', crL.campaign?.parts === 2000 && crL.campaign.volume === 2000 && crL.campaign.dropped === 120, `${crL.campaign?.parts} parts / ${crL.campaign?.volume}`)
  const bL = await B.createBooking(cid, { date: day, hour: 18, campaignId: crL.campaign._id })
  ok('link price $75 per 500 SMS, charged per part', bL.booking?.price === 300 && bL.booking.unitPrice === 0.15, `$${bL.booking?.price}`)
  await db.collection('bsBookings').deleteOne({ _id: bL.booking._id })
  await db.collection('bsCustomers').updateOne({ _id: cid }, { $set: { freeTestAt: new Date() } }) // free first test already used → regular 2-per-campaign rule
  const t1 = await B.testSend(cid, cr.campaign._id, '+12125550999'), t2 = await B.testSend(cid, cr.campaign._id, '+12125550998'), t3 = await B.testSend(cid, cr.campaign._id, '+12125550997')
  ok('2 test sends allowed, 3rd refused, opt-out line added', t1.ok && t2.ok && t3.error === 'err_tests_used' && /Reply STOP to opt out$/.test((await db.collection('bsMessages').findOne({ _id: t1.messageId })).body))
  ok('booking under 500 refused', (await B.createBooking(cid, { date: day, hour: 18, volume: 100 })).error === 'err_volume')
  const bk = await B.createBooking(cid, { date: day, hour: 18, campaignId: cr.campaign._id })
  ok('plain price $50 per 500 SMS', bk.booking?.status === 'awaiting_payment' && bk.booking.price === 52, `$${bk.booking?.price}`)
  const av = await B.availability(day), slot = av.slots.find(s => s.hour === 18)
  ok('availability reduced by the hold', av.dayFree === av.perDay - 520 && slot.free === Math.min(av.dayFree, av.capacity - bk.booking.allocation[`${day}T18`]))
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  const bDay = (await db.collection('bsBookings').findOne({ _id: bk.booking._id })).quotaDay
  ok('payment reserves the allowance for the booking day', (await db.collection('bsDaily').findOne({ _id: `${cid}:${bDay}` }))?.used === 520)
  ok('payment queues the campaign', (await db.collection('bsMessages').countDocuments({ campaignId: cr.campaign._id, test: false, prepaid: true })) === 520)
  const cr2 = await B.createCampaign(cid, { name: 'Two', content: 'Hey there friend', contacts: Array.from({ length: 1600 }, (_, i) => `+1415555${1000 + i}`), consent: true })
  ok('booking that would pass the day allowance is refused', (await B.createBooking(cid, { date: day, hour: 19, campaignId: cr2.campaign._id })).error === 'err_allowance_day', `${cr2.campaign?.parts} parts`)
  // Send now is always offered and accepted, even when the batch is bigger than today's free capacity (it blasts + auto-orders lines).
  const crNow = await B.createCampaign(cid, { name: 'Now', content: 'Flash sale today only', contacts: Array.from({ length: 1000 }, (_, i) => `+1415777${1000 + i}`), consent: true })
  const wo = await B.whenOptions(cid, crNow.campaign._id)
  ok('Send now offered even when batch exceeds today\u2019s capacity', !!wo.now)
  const bn = await B.createBooking(cid, { campaignId: crNow.campaign._id, now: true })
  ok('send-now booking accepted as a blast (mode now)', bn.booking?.mode === 'now' && bn.booking.status === 'awaiting_payment')
  await B.cancelBooking(bn.booking._id, { by: 'admin' })

  await db.collection('bsMessages').updateMany({ bookingId: bk.booking._id }, { $set: { nextAt: new Date() } })
  process.env.BULK_ESIM_FAKE_CREDIT = '2'; await B.creditWatch()
  const before = await db.collection('bsMessages').countDocuments({ status: 'sent' }); await B.claimWorker(); await B.tick(); const afterPaused = await db.collection('bsMessages').countDocuments({ status: 'sent' })
  ok('low Spenza credit pauses all sending + alerts admin', (await B.state()).reasons.includes('provider_credit') && afterPaused === before && alerts.some(a => /PAUSED/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '50'; await B.creditWatch()
  ok('credit back → resumes automatically + alerts admin', !(await B.state()).reasons.length && alerts.some(a => /resumed/i.test(a)))
  for (let i = 0; i < 6; i++) { await B.claimWorker(); await B.tick(); await sleep(50) }
  const sent = await db.collection('bsMessages').countDocuments({ campaignId: cr.campaign._id, test: false, status: 'sent' })
  ok('queue sends through the pool', sent > 0, `${sent} sent`)
  ok('campaign texts use the pre-paid allowance (no double count)', (await db.collection('bsDaily').findOne({ _id: `${cid}:${bDay}` })).used === 520)
  const spread = await db.collection('bsMessages').distinct('esimId', { cid, status: 'sent' })
  ok('traffic spread over several eSIMs', spread.length > 1, spread.join(','))
  const m = await db.collection('bsMessages').findOne({ cid, status: 'sent', test: false })
  await db.collection('bsCampaigns').updateOne({ _id: m.campaignId }, { $set: { replies: true } }) // paid replies → forwarded
  await B.onWebhook('', {}, { data: { From: m.to, Owner: m.from, Message_Body: 'Interested!', Message_ID: 'pm1' } })
  await B.onWebhook('', {}, { data: { From: m.to, Owner: m.from, Message_Body: 'Interested!', Message_ID: 'pm1' } })
  ok('reply routed to the right customer once (idempotent)', (await db.collection('bsMessages').countDocuments({ direction: 'in', cid })) === 1 && (await db.collection('bsNotify').countDocuments({ type: 'inbound', chatId: '111' })) === 1)
  await B.onWebhook('', {}, { data: { From: m.to, Owner: m.from, Message_Body: 'STOP', Message_ID: 'pm2' } })
  ok('STOP adds a platform-wide block', !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: m.to, by: cid })))
  ok('opted-out number blocked', (await B.sendOne(cid, m.to, 'hi again')).error === 'err_opted')
  const other = (await B.customer('Nomadly', '222'))._id
  ok('opted-out number blocked for every other customer too', !!(await B.sendOne(other, m.to, 'hello')).error && !(await B.parseContacts(other, m.to)).contacts.length)
  await B.onWebhook('', {}, { data: { From: '+13105550001', Owner: m.from, Message_Body: 'Stop!', Message_ID: 'pm4' } })
  await B.onWebhook('', {}, { data: { From: '+13105550002', Owner: '+19995550000', Message_Body: 'STOP.', Message_ID: 'pm5' } })
  ok('STOP from unrouted senders / old lines still blocks', !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: '+13105550001' })) && !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: '+13105550002' })))
  await B.onWebhook('', {}, { data: { From: m.to, Owner: m.from, Message_Body: 'STOP', Message_ID: 'pm6' } })
  ok('one STOP confirmation per number', (await db.collection('bsMessages').countDocuments({ to: m.to, system: true, body: /unsubscribed/ })) === 1)
  await B.onWebhook('', {}, { data: { From: '+13105550000', Owner: m.from, Message_Body: 'who?', Message_ID: 'pm3' } })
  ok('unknown sender is not guessed', (await db.collection('bsMessages').findOne({ providerMessageId: 'pm3' }))?.status === 'unrouted')
  // Finish the campaign: some failed + the rest never sent → refund to wallet at the end.
  await db.collection('bsMessages').updateMany({ campaignId: cr.campaign._id, test: false, status: 'sent' }, { $set: { status: 'sent' } })
  const left = await db.collection('bsMessages').find({ campaignId: cr.campaign._id, test: false, status: { $ne: 'sent' } }).toArray()
  await db.collection('bsMessages').updateMany({ campaignId: cr.campaign._id, test: false, status: 'queued' }, { $set: { status: 'queued', expireAt: new Date(Date.now() - 1000) } })
  const sentNow = await db.collection('bsMessages').find({ campaignId: cr.campaign._id, test: false, status: 'sent' }).limit(3).toArray()
  await db.collection('bsMessages').updateMany({ _id: { $in: sentNow.map(x => x._id) } }, { $set: { status: 'failed' } })
  await B.finishCampaigns(); await B.finishCampaigns()
  const unsentParts = await db.collection('bsMessages').countDocuments({ campaignId: cr.campaign._id, test: false, status: { $in: ['failed', 'rejected', 'expired'] } })
  const ref = await db.collection('bsNotify').find({ type: 'refund', campaignId: cr.campaign._id }).toArray()
  ok('failed + never-sent SMS refunded once at the end', ref.length === 1 && ref[0].amount === Math.round(unsentParts * 0.1 * 100) / 100 && unsentParts >= 3, `${unsentParts} parts → $${ref[0]?.amount} (${left.length} were not sent before)`)
  ok('refund notice is translated on delivery', t('zh', ref[0].key, ...ref[0].args).includes('退回'))
  await B.setCustomer(cid, { dailyLimit: (await B.usage(cid)).used + 1 }, 'test')
  const s1 = await B.sendOne(cid, '+12125551111', 'one'); await B.claimWorker(); await B.tick(); const s2 = await B.sendOne(cid, '+12125551112', 'two')
  ok('daily allowance enforced for one-off texts', s1.ok && s2.error === 'err_quota_used')
  const rp = await B.replaceEsim('ESIM-0002', 'test defect', 'test'), old = await db.collection('bsEsims').findOne({ _id: 'ESIM-0002' })
  ok('replacement links new eSIM, keeps history', old.status === 'replaced' && old.replacedBy === rp.newEsimId && (await db.collection('bsMessages').countDocuments({ esimId: 'ESIM-0002' })) > 0)
  if (process.env.EMERGENT_LLM_KEY) { const st = require('../bulk-esim/storage'); const up = await st.saveUpload(db, cid, { name: 'list.csv', data: '+12125550100\n' }); ok('uploaded contact file stored and readable', up && (await st.get(up.storagePath)).toString().includes('2125550100')) }
  // ── Campaign completion review (stars + comment) ──
  const CPR = `cpr_${cr.campaign._id}`
  ok('completed campaign creates a star-review request', !!(await db.collection('bsReviews').findOne({ _id: CPR, kind: 'campaign', status: 'waiting' })))
  await db.collection('bsReviews').updateOne({ _id: CPR }, { $set: { at: new Date(Date.now() - 60000) } })
  const due = await B.dueReviews('Nomadly')
  ok('campaign review is due to ask (no message lookup needed)', due.some(r => r._id === CPR && r.kind === 'campaign'))
  const ra = await B.reviewAnswer(CPR, cr.campaign.cid, 'stars', 5)
  await B.reviewAnswer(CPR, cr.campaign.cid, 'comment', 'great service')
  const rvDoc = await db.collection('bsReviews').findOne({ _id: CPR })
  ok('campaign review stores stars + comment', ra?.stars === 5 && ra.status === 'done' && rvDoc?.comment === 'great service')
  // ── Progress milestones (25/50/75%) with ETA, once each ──
  await db.collection('bsNotify').deleteMany({ key: 'n_progress' })
  await db.collection('bsCampaigns').insertOne({ _id: 'cp_prog', cid: cr.campaign.cid, name: 'Prog', status: 'running', startedAt: new Date(Date.now() - 10 * 60000), bookingId: null, progressNotified: [] })
  await db.collection('bsMessages').insertMany([
    { _id: 'pg1', campaignId: 'cp_prog', direction: 'out', status: 'sent', test: false },
    { _id: 'pg2', campaignId: 'cp_prog', direction: 'out', status: 'queued', test: false },
    { _id: 'pg3', campaignId: 'cp_prog', direction: 'out', status: 'queued', test: false },
    { _id: 'pg4', campaignId: 'cp_prog', direction: 'out', status: 'queued', test: false },
  ])
  await B.finishCampaigns()
  const pn = await db.collection('bsNotify').findOne({ key: 'n_progress', campaignId: 'cp_prog' })
  ok('progress milestone notice at 25% with sent/total/eta', !!pn && pn.args[1] === 25 && pn.args[2] === 1 && pn.args[3] === 4 && !!pn.args[4])
  await B.finishCampaigns()
  // ── Instant join: a new line that proves both delivery legs joins the pool at once (no wait for the next health check) ──
  await db.collection('bsEsims').insertOne({ _id: 'ESIM-JOIN', role: 'service', status: 'testing', health: 'activating', msisdn: '+13330001111', iccid: 'icc-join', createdAt: new Date(), stats: {} })
  await db.collection('bsEsims').updateOne({ _id: 'ESIM-0003' }, { $set: { role: 'monitor', status: 'available', health: 'healthy', msisdn: '+13330002222' } }, { upsert: false })
  if (!(await db.collection('bsEsims').findOne({ _id: 'ESIM-0003' }))) await db.collection('bsEsims').insertOne({ _id: 'ESIM-0003', role: 'monitor', status: 'available', health: 'healthy', msisdn: '+13330002222', stats: {} })
  await db.collection('bsTests').insertOne({ esimId: 'ESIM-JOIN', peer: 'ESIM-0003', type: 'check', kind: 'pre_use', code: 'abc123', result: 'pending', legs: { out: true, back: false }, at: new Date() })
  await B.onWebhook('', {}, { data: { From: '+13330002222', Owner: '+13330001111', Message_Body: 'CloudIVR line check abc123 ok', Message_ID: 'chk-join' } })
  ok('new line joins the pool instantly when its delivery check passes', (await db.collection('bsEsims').findOne({ _id: 'ESIM-JOIN' }))?.status === 'available')

  ok('progress milestone not repeated on the next tick', (await db.collection('bsNotify').countDocuments({ key: 'n_progress', campaignId: 'cp_prog' })) === 1)

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
