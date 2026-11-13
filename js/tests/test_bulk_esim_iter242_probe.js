// iter242 probe: multi-account (rate/credit/ceiling/bootstrap/advice), send-now vs schedule discount, one-SMS rule, AI variants
// (simulated), paid replies routing, replyImpact alert. Run from /app: node js/tests/test_bulk_esim_iter242_probe.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.BULKSMS_NO_TIME_GATE = 'false' // this suite covers the quiet-hour window (off by default in production)
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
for (const k of ['SPENZA_BULK_API_KEY', 'SPENZA_BULK_API_SECRET', 'EMERGENT_LLM_KEY', 'BULK_ESIM_FAKE_RATE', 'BULK_ESIM_FAKE_RATE_2', 'BULK_ESIM_FAKE_CREDIT_2']) delete process.env[k]
process.env.BULK_ESIM_FAKE_ACCOUNTS = '3'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsAiVariants']
let pass = 0, fail = 0; const bugs = []
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, bugs.push(name)); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from) => Array.from({ length: n }, (_, i) => `+1212555${String(from + i).padStart(4, '0')}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ minCredit: 10, reserveBooking: true, monitorEsims: 1, rateMargin: 0, quietStart: 8, quietEnd: 21 }, 'test') // 8am–9pm window = 10 open UTC hours · LEGACY_DEFAULTS: this suite covers the floor / spare-reserve / monitor paths
  process.env.BULK_ESIM_WORKER = ''
  await B.claimWorker()
  const M = db.collection('bsMessages'), A = db.collection('bsAccounts'), Es = db.collection('bsEsims')
  await B.setConfig({ monitorEsims: 0, testerEsims: 0 }, 'probe')

  // (a) 3 accounts: rate + line ceiling with default quiet hours
  let c = await B.cfg()
  ok('(a) 3 accounts → ratePerMin 90', B.ratePerMin(c) === 90, String(B.ratePerMin(c)))
  ok('(a) maxLines 135 (45/account)', B.maxLines(c) === 135 && c.accounts.every(a => B.acctMaxLines(c, a) === 45), String(B.maxLines(c)))
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 1000, esimPerMin: 10000, minEsims: 0, scheduleDiscountPct: 10 }, 'probe')
  await B.creditWatch()
  const pm = await B.provisionMany(6, 'probe', 'probe')
  const per = async () => Object.fromEntries(await Promise.all(['spenza1', 'spenza2', 'spenza3'].map(async a => [a, await Es.countDocuments({ account: a, role: 'service' })])))
  let dist = await per()
  ok('(a) provisionMany spreads lines evenly (2/2/2)', pm.ok === 6 && dist.spenza1 === 2 && dist.spenza2 === 2 && dist.spenza3 === 2, JSON.stringify(dist))
  await B.healthCheck()
  process.env.BULK_ESIM_FAKE_CREDIT_2 = '1'; alerts.length = 0
  await B.creditWatch()
  ok('(a) account #2 low, no global pause', (await A.findOne({ _id: 'spenza2' })).low === true && !(await B.state()).reasons.includes('provider_credit'))
  ok('(a) admin told #2 sits out while others keep sending', alerts.some(a => /account #2 balance \$1/.test(a) && /keep sending/.test(a)))
  await B.provisionMany(2, 'probe', 'probe'); dist = await per()
  ok('(a) new lines skip low account #2', dist.spenza2 === 2 && dist.spenza1 + dist.spenza3 === 6, JSON.stringify(dist))
  await B.healthCheck()
  const cust = await B.customer('TESTPROBE', '990000777'), cid = cust._id
  const cpA = (await B.createCampaign(cid, { name: 'TEST_NoReplies', content: 'Hello A from probe', contacts: nums(500, 1000), consent: true })).campaign
  const bA = await B.createBooking(cid, { campaignId: cpA._id, now: true })
  ok('(e) createBooking now → mode now, current UTC hour, no discount', bA.booking?.mode === 'now' && bA.booking.hour === new Date().getUTCHours() && bA.booking.discountPct === 0 && bA.booking.price === 50, JSON.stringify(bA.error || [bA.booking.mode, bA.booking.hour, bA.booking.discountPct, bA.booking.price]))
  await B.confirmBooking(bA.booking._id, { method: 'wallet' }); await M.deleteMany({ system: true })
  await B.claimWorker(); await B.tick()
  const sentA = await M.countDocuments({ campaignId: cpA._id, status: 'sent' }), viaA2 = await M.countDocuments({ campaignId: cpA._id, account: 'spenza2' })
  ok('(a) low account #2 sends nothing, others send all 500', sentA === 500 && viaA2 === 0, `sent ${sentA}, via #2 ${viaA2}`)
  process.env.BULK_ESIM_FAKE_CREDIT = '1'; delete process.env.BULK_ESIM_FAKE_CREDIT_2
  await B.creditWatch()
  ok('(a) all three low → pause provider_credit', (await B.state()).reasons.includes('provider_credit'))
  process.env.BULK_ESIM_FAKE_CREDIT = '500'; alerts.length = 0
  await B.creditWatch()
  ok('(a) top-up → resumed, #2 back', !(await B.state()).reasons.includes('provider_credit') && (await A.findOne({ _id: 'spenza2' })).low === false && alerts.some(a => /Sending resumed/.test(a)))

  // (b) rate headers per account
  process.env.BULK_ESIM_FAKE_RATE_2 = '50,0,5'
  c = await B.cfg(); const allEx = await B.paceByHeaders(c); c = await B.cfg()
  ok('(b) account #2 adopts header limit 50/min', c.accounts[1].perMin === 50 && c.accounts[0].perMin === 1000 && allEx === false, JSON.stringify(c.accounts.map(a => a.perMin)))
  const cpB = (await B.createCampaign(cid, { name: 'TEST_WithReplies', content: 'Hello B from probe', contacts: nums(500, 3000), optOut: false, consent: true })).campaign
  await B.setReplies(cid, cpB._id, true)
  const bB = await B.createBooking(cid, { campaignId: cpB._id, now: true })
  ok('(e) now booking with replies: price 70, replyFee 20', bB.booking?.price === 70 && bB.booking.replyFee === 20, JSON.stringify(bB.error || bB.booking.price))
  await B.confirmBooking(bB.booking._id, { method: 'wallet' }); await M.deleteMany({ system: true })
  await B.claimWorker(); await B.tick()
  const sentB = await M.countDocuments({ campaignId: cpB._id, status: 'sent' }), viaB2 = await M.countDocuments({ campaignId: cpB._id, account: 'spenza2' })
  ok('(b) exhausted account #2 skipped, others carry the texts', sentB === 500 && viaB2 === 0, `sent ${sentB}, via #2 ${viaB2}`)
  process.env.BULK_ESIM_FAKE_RATE = '50,0,5'
  const cpC = (await B.createCampaign(cid, { name: 'TEST_Exhausted', content: 'Hello C from probe', contacts: nums(500, 5000), consent: true })).campaign
  const bC = await B.createBooking(cid, { campaignId: cpC._id, now: true })
  await B.confirmBooking(bC.booking?._id, { method: 'wallet' }); await M.deleteMany({ system: true })
  await B.claimWorker(); await B.tick()
  ok('(b) all accounts exhausted → nothing sent, texts stay queued', (await M.countDocuments({ campaignId: cpC._id, status: 'queued' })) === 500, String(await M.countDocuments({ campaignId: cpC._id, status: 'queued' })))
  delete process.env.BULK_ESIM_FAKE_RATE; delete process.env.BULK_ESIM_FAKE_RATE_2
  await B.cancelBooking(bC.booking._id, { by: 'admin' })

  // (h) replies routing
  const inbound = (from, to, text) => B.onWebhook('{}', {}, { from, to, text, id: `in_${Math.random().toString(16).slice(2)}` })
  const mA = await M.findOne({ campaignId: cpA._id, status: 'sent' }), mB = await M.findOne({ campaignId: cpB._id, status: 'sent' })
  const lnA = await Es.findOne({ _id: mA.esimId }), lnB = await Es.findOne({ _id: mB.esimId })
  await inbound(mA.to, lnA.msisdn, 'Info please A'); await inbound(mB.to, lnB.msisdn, 'Info please B')
  const iA = await M.findOne({ direction: 'in', from: mA.to }), iB = await M.findOne({ direction: 'in', from: mB.to })
  const nA = await db.collection('bsNotify').countDocuments({ type: 'inbound', from: mA.to }), nB = await db.collection('bsNotify').countDocuments({ type: 'inbound', from: mB.to })
  ok('(h) no-replies campaign: kept, not forwarded, no notify', iA?.status === 'kept' && iA.forwarded === false && nA === 0, JSON.stringify([iA?.status, nA]))
  ok('(h) paid-replies campaign: received, forwarded, one notify', iB?.status === 'received' && iB.forwarded === true && nB === 1, JSON.stringify([iB?.status, nB]))
  const st = async (id) => (await db.collection('bsCampaigns').findOne({ _id: id })).stats.replies
  ok('(h) stats.replies incremented either way', (await st(cpA._id)) === 1 && (await st(cpB._id)) === 1)
  const mA2 = await M.findOne({ campaignId: cpA._id, status: 'sent', to: { $ne: mA.to } }), mB2 = await M.findOne({ campaignId: cpB._id, status: 'sent', to: { $ne: mB.to } })
  await inbound(mA2.to, lnA.msisdn, 'STOP'); await inbound(mB2.to, (await Es.findOne({ _id: mB2.esimId })).msisdn, 'stop')
  const supA = await db.collection('bsSuppression').findOne({ cid: '*', phone: mA2.to }), supB = await db.collection('bsSuppression').findOne({ cid: '*', phone: mB2.to })
  ok('(h) STOP global suppression for both campaigns', !!supA && !!supB)
  ok('(h) STOP on no-replies not forwarded; on paid-replies forwarded as n_inbound_stop', (await db.collection('bsNotify').countDocuments({ type: 'inbound', from: mA2.to })) === 0 && (await db.collection('bsNotify').countDocuments({ type: 'inbound', from: mB2.to, key: 'n_inbound_stop' })) === 1)
  ok('(h) unsubscribe confirmation queued for both', (await M.countDocuments({ cid: 'system:compliance', to: { $in: [mA2.to, mB2.to] } })) === 2)
  const pr = await B.parseContacts(cid, `${mA2.to}\n${mB2.to}\n+12125559999`)
  ok('(h) STOP numbers dropped from future uploads', pr.contacts.length === 1 && pr.optedOut === 2, JSON.stringify(pr))

  // (i) replyImpact via replaceEsim
  alerts.length = 0
  await B.replaceEsim(lnB._id, 'suspended (probe)', 'probe')
  const al = alerts.find(a => /📵/.test(a)) || ''
  ok('(i) replaceEsim → 📵 alert with cid, campaign, texts, replies, fee', /paid replies affected/.test(al) && al.includes(cid) && al.includes('TEST_WithReplies') && !al.includes('TEST_NoReplies') && /text\(s\) went out from this line/.test(al) && /reply fee \$20/.test(al), al.slice(0, 300))
  ok('(i) incident paid_replies_affected recorded', (await db.collection('bsIncidents').countDocuments({ type: 'paid_replies_affected', esimId: lnB._id })) === 1)

  // (e) schedule discount, link price, refund at discounted unit
  const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const cpS = (await B.createCampaign(cid, { name: 'TEST_Sched', content: 'Sched text probe', contacts: nums(510, 7000), consent: true })).campaign
  const w = await B.whenOptions(cid, cpS._id)
  ok('(e) whenOptions now = 51, schedule = 45.9 / list 51, pct 10', (w.now?.price === 51 || w.later?.price === 51) && w.schedule.price === 45.9 && w.schedule.list === 51 && w.schedule.pct === 10, JSON.stringify(w))
  const bS = await B.createBooking(cid, { campaignId: cpS._id, date: d2, hour: 12 })
  ok('(e) booking 2 days ahead: discount 10%, unit 0.09, price 45.9, list 51', bS.booking?.discountPct === 10 && bS.booking.unitPrice === 0.09 && bS.booking.price === 45.9 && bS.booking.listPrice === 51 && bS.booking.mode === 'scheduled', JSON.stringify(bS.error || bS.booking && [bS.booking.discountPct, bS.booking.unitPrice, bS.booking.price, bS.booking.listPrice]))
  const cpL = (await B.createCampaign(cid, { name: 'TEST_Link', content: 'See www.example.com today', withLinks: true, contacts: nums(500, 8000), consent: true })).campaign
  await B.setReplies(cid, cpL._id, true)
  const bL = await B.createBooking(cid, { campaignId: cpL._id, date: d2, hour: 15 })
  ok('(e) link + replies 2 days ahead: same unit as plain 0.09, price 45+20=65, replyFee not discounted', bL.booking?.unitPrice === 0.09 && bL.booking.price === 65 && bL.booking.replyFee === 20 && bL.booking.listPrice === 70, JSON.stringify(bL.error || [bL.booking.unitPrice, bL.booking.price, bL.booking.listPrice]))
  const bE = await B.createBooking(cid, { campaignId: cpS._id, date: new Date(Date.now() + 3600000 * 30).toISOString().slice(0, 10), hour: new Date(Date.now() + 3600000 * 20).getUTCHours() })
  ok('(e) booking <24h ahead gets no discount', !bE.booking || bE.booking.startAt - Date.now() >= 24 * 3600000 || bE.booking.discountPct === 0, JSON.stringify(bE.error || [bE.booking.startAt, bE.booking.discountPct]))
  await B.confirmBooking(bS.booking._id, { method: 'wallet' })
  await M.updateMany({ campaignId: cpS._id, test: false }, { $set: { status: 'sent' } })
  const ten = (await M.find({ campaignId: cpS._id }).limit(10).toArray()).map(m => m._id)
  await M.updateMany({ _id: { $in: ten } }, { $set: { status: 'failed' } })
  await B.finishCampaigns()
  const rf = await db.collection('bsNotify').findOne({ type: 'refund', campaignId: cpS._id })
  ok('(e) refund of 10 failed parts at discounted unit = $0.9', rf?.amount === 0.9, JSON.stringify(rf?.amount))

  // (f) content
  ok('(f) 138/139 with opt-out, err args [138]', !B.checkContent('a'.repeat(138), false).error && JSON.stringify(B.checkContent('a'.repeat(139), false)) === JSON.stringify({ error: 'err_too_long', args: [138] }))
  ok('(f) 160/161 without opt-out, args [160]', !B.checkContent('a'.repeat(160), false, false).error && B.checkContent('a'.repeat(161), false, false).args[0] === 160)
  ok('(f) unicode 70 ok / 71 refused (no opt-out)', !B.checkContent('é漢'.repeat(35), false, false).error && B.checkContent('漢'.repeat(71), false, false).error === 'err_special_char')
  ok('(f) multi-version: one too-long version refuses all', B.checkContent(`short one\n---\n${'b'.repeat(139)}`, false).error === 'err_too_long')
  ok('(f) multi-version link in v2: text-only refused, link type ok', B.checkContent('Hi\n---\nGo to nomadly.com', false).error === 'err_has_link' && !B.checkContent('Hi\n---\nGo to nomadly.com', true).error)
  const cpG = (await B.createCampaign(cid, { name: 'TEST_Guard', content: 'g'.repeat(160), optOut: false, contacts: nums(500, 9000), consent: true })).campaign
  ok('(f) 160-char no-optout campaign created', !!cpG)
  await db.collection('bsCampaigns').updateOne({ _id: cpG._id }, { $set: { content: ['g'.repeat(161)] } })
  ok('(f) edited to 161 → createBooking err_too_long', (await B.createBooking(cid, { campaignId: cpG._id, now: true })).error === 'err_too_long')
  await db.collection('bsCampaigns').updateOne({ _id: cpG._id }, { $set: { content: ['ok', 'call 212-555-0101'] } })
  ok('(f) edited v2 to contain phone → err_has_link', (await B.createBooking(cid, { campaignId: cpG._id, now: true })).error === 'err_has_link')
  await db.collection('bsCampaigns').updateOne({ _id: cpG._id }, { $set: { optOut: true, content: ['g'.repeat(150)] } })
  ok('(f) optOut flipped on with 150 chars → err_too_long', (await B.createBooking(cid, { campaignId: cpG._id, now: true })).error === 'err_too_long')

  // (g) AI variants simulated
  const t = 'Summer deal: 15% off all plans this week only.'
  const v1 = await B.aiVariants(cid, { text: t, withLinks: false, optOut: true })
  ok('(g) 5 variants, each valid one SMS', v1.variants?.length === 5 && v1.variants.every(v => !B.checkContent(v, false).error))
  const v2 = await B.aiVariants(cid, { text: t, withLinks: false, optOut: true, avoid: v1.variants })
  ok('(g) more with avoid excludes earlier', v2.variants?.length >= 1 && v2.variants.every(v => !v1.variants.includes(v)), JSON.stringify(v2))
  ok('(g) over-length → err_ai', (await B.aiVariants(cid, { text: 'x'.repeat(138), optOut: true })).error === 'err_ai')
  const v4 = await B.aiVariants(cid, { text: 'x'.repeat(150), optOut: false })
  ok('(g) no-optout 150 chars: only prefixes fitting 160 kept', v4.variants?.length >= 1 && v4.variants.every(v => v.length <= 160), JSON.stringify(v4.variants?.map(v => v.length)))
  const v5 = await B.aiVariants(cid, { text: 'Visit https://nomadly.com/sale now', withLinks: true })
  ok('(g) link campaign keeps URL', v5.variants?.length === 5 && v5.variants.every(v => v.includes('https://nomadly.com/sale')))
  ok('(g) text-only source containing a phone → err_ai (all dropped)', (await B.aiVariants(cid, { text: 'Call 212-555-0101', withLinks: false })).error === 'err_ai')
  ok('(g) empty text → err_add_text', (await B.aiVariants(cid, { text: '  ' })).error === 'err_add_text')
  ok('(g) bsAiVariants logged (6 calls with a model)', (await db.collection('bsAiVariants').countDocuments({ cid })) === 6, String(await db.collection('bsAiVariants').countDocuments({ cid })))

  // (d) adviseAccounts
  c = await B.cfg(); alerts.length = 0
  ok('(d) below 80% → no advice', (await B.adviseAccounts(c, { lines: 1 })) === false && !alerts.length)
  const near = Math.ceil(B.maxLines(c) * 0.8)
  const r1 = await B.adviseAccounts(c, { lines: near }), r2 = await B.adviseAccounts(c, { lines: near })
  ok('(d) near ceiling → one alert naming SPENZA_BULK_API_KEY_4, not repeated', r1 && r2 && alerts.length === 1 && alerts[0].includes('SPENZA_BULK_API_KEY_4'), `${alerts.length} ${alerts[0]?.slice(0, 120)}`)
  const ov = await B.overview()
  ok('(d) overview().accounts lists 3 accounts with lines/maxLines', ov.accounts.length === 3 && ov.accounts.every(a => a.maxLines > 0 && typeof a.lines === 'number'), JSON.stringify(ov.accounts.map(a => [a.id, a.lines, a.maxLines, a.low])))

  // (c) bootstrap add/remove
  alerts.length = 0
  await B.bootstrap()
  process.env.BULK_ESIM_FAKE_ACCOUNTS = '2'; alerts.length = 0
  const live3 = await Es.countDocuments({ account: 'spenza3', status: { $nin: ['replaced', 'retired', 'failed', 'expired'] } })
  const rb = await B.bootstrap()
  ok('(c) removing #3 → lines retired, status disabled, alert', rb.retired === live3 && live3 > 0 && (await A.findOne({ _id: 'spenza3' })).status === 'disabled' && alerts.some(a => /account #3 is no longer configured/.test(a)), JSON.stringify([rb, live3]))
  ok('(c) cfg no longer lists #3', (await B.cfg()).accounts.length === 2)
  ok('(c) same env → {same:true}', (await B.bootstrap()).same === true)
  process.env.BULK_ESIM_FAKE_ACCOUNTS = '3'; alerts.length = 0
  const ra = await B.bootstrap()
  ok('(c) re-adding #3 → connected alert', ra.added?.includes('spenza3') && alerts.some(a => /account #3 connected/.test(a)), JSON.stringify(ra))
  ok('(c) after re-add same env → same', (await B.bootstrap()).same === true)

  console.log(`\n${pass} passed, ${fail} failed${bugs.length ? `; failing: ${bugs.join(' | ')}` : ''}`)
  for (const c2 of COLS) await db.collection(c2).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
