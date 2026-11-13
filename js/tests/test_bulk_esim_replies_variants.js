// eSIM BulkSMS: opt-out line choice + one-SMS rule, AI variants (simulated here), paid replies (+$20) routing, type-manipulation
// guard, admin notice when a line with paid replies loses its number. Run from /app: node js/tests/test_bulk_esim_replies_variants.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.EMERGENT_LLM_KEY; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsAiVariants']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  process.env.BULK_ESIM_WORKER = ''
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 10000, esimPerMin: 10000, esimDailyLimit: 5000, monitorEsims: 0, testerEsims: 0, scheduleDiscountPct: 0 }, 'test')
  const M = db.collection('bsMessages')

  // ---- content rules ----
  ok('one SMS incl. opt-out line: 138 chars ok, 139 refused', !B.checkContent('a'.repeat(138), false).error && B.checkContent('a'.repeat(139), false).error === 'err_too_long')
  ok('no opt-out line: 160 ok, 161 refused', !B.checkContent('a'.repeat(160), false, false).error && B.checkContent('a'.repeat(161), false, false).error === 'err_too_long')
  ok('unicode text: 70 chars is one SMS, 71 is refused naming the character that forces unicode', !B.checkContent('ب'.repeat(70), false, false).error && B.checkContent('ب'.repeat(71), false, false).error === 'err_special_char' && /ب/.test(B.checkContent('ب'.repeat(71), false, false).args[0]))
  ok('text-only refuses links/phones in ANY version', B.checkContent('Hi\n---\nCall 212-555-1234', false).error === 'err_has_link')
  ok('MAX_PARTS is 1', B.MAX_PARTS === 1)

  // ---- AI variants (simulated provider in dry mode without the LLM key) ----
  const cust = await B.customer('Nomadly', '901'), cid = cust._id
  const v1 = await B.aiVariants(cid, { text: 'Spring sale at Nomadly: 20% off all eSIM plans this week.', withLinks: false, optOut: true })
  ok('5 variants returned, each one SMS with the opt-out line, none equal to the original', v1.variants?.length === 5 && v1.variants.every(v => B.checkContent(v, false).error === undefined) && !v1.variants.includes('Spring sale at Nomadly: 20% off all eSIM plans this week.'), JSON.stringify(v1))
  const v2 = await B.aiVariants(cid, { text: 'Spring sale at Nomadly: 20% off all eSIM plans this week.', withLinks: false, optOut: true, avoid: v1.variants })
  ok('"more" avoids the ones already shown', v2.variants?.length >= 1 && v2.variants.every(v => !v1.variants.includes(v)), JSON.stringify(v2.variants))
  const v3 = await B.aiVariants(cid, { text: 'a'.repeat(138), withLinks: false, optOut: true })
  ok('variants that would exceed one SMS are dropped → err_ai', v3.error === 'err_ai', JSON.stringify(v3))
  const v4 = await B.aiVariants(cid, { text: 'See www.nomadly.com for 20% off', withLinks: true, optOut: true })
  ok('link campaign: variants keep the original URL and add none', v4.variants?.length === 5 && v4.variants.every(v => /www\.nomadly\.com/.test(v)), JSON.stringify(v4.variants?.slice(0, 2)))
  ok('every request is logged (bsAiVariants)', (await db.collection('bsAiVariants').countDocuments({ cid })) === 4)

  // ---- lines ----
  await B.provisionMany(3, 'test', 'test'); await B.healthCheck()
  ok('3 service lines available', (await db.collection('bsEsims').countDocuments({ status: 'available', role: 'service' })) === 3)

  // ---- paid replies + pricing ----
  const cpA = (await B.createCampaign(cid, { name: 'NoReplies', content: 'Hello A', contacts: nums(500, 1000), consent: true })).campaign
  const cpB = (await B.createCampaign(cid, { name: 'WithReplies', content: 'Hello B', contacts: nums(500, 3000), optOut: false, consent: true })).campaign
  await B.setReplies(cid, cpB._id, true)
  const cpB2 = await db.collection('bsCampaigns').findOne({ _id: cpB._id })
  ok('campaign stores optOut=false and replies=true', cpA.optOut === true && cpA.replies === false && cpB2.optOut === false && cpB2.replies === true)
  const wA = await B.whenOptions(cid, cpA._id), wB = await B.whenOptions(cid, cpB._id)
  ok('whenOptions: $50 without replies, $70 with replies (+$20 fee)', wA.now?.price === 50 && wA.replyFee === 0 && wB.now?.price === 70 && wB.replyFee === 20, JSON.stringify([wA.now, wB.now]))
  await B.setConfig({ scheduleDiscountPct: 10 }, 'test')
  const w2 = await B.whenOptions(cid, cpB._id)
  ok('schedule discount applies to the texts only, not the reply fee ($45 + $20 = $65)', w2.schedule.price === 65 && w2.schedule.list === 70, JSON.stringify(w2.schedule))
  await B.setConfig({ scheduleDiscountPct: 0 }, 'test')
  const bA = await B.createBooking(cid, { campaignId: cpA._id, now: true }), bB = await B.createBooking(cid, { campaignId: cpB._id, now: true })
  ok('bookings: $50 (no fee) and $70 (replyFee 20 stored)', bA.booking?.price === 50 && bA.booking.replyFee === 0 && bB.booking?.price === 70 && bB.booking.replyFee === 20, JSON.stringify([bA.error || bA.booking?.price, bB.error || bB.booking?.price]))

  // ---- manipulation guard: stored text no longer matching the paid type ----
  const cpX = (await B.createCampaign(cid, { name: 'Sneaky', content: 'Plain text here', contacts: nums(500, 5000), consent: true })).campaign
  await db.collection('bsCampaigns').updateOne({ _id: cpX._id }, { $set: { content: ['Plain text here www.evil.com'] } })
  ok('text-only campaign whose text gained a link is refused at booking', (await B.createBooking(cid, { campaignId: cpX._id, now: true })).error === 'err_has_link')
  await db.collection('bsCampaigns').updateOne({ _id: cpX._id }, { $set: { content: ['x'.repeat(150)] } })
  ok('…or grew past one SMS', (await B.createBooking(cid, { campaignId: cpX._id, now: true })).error === 'err_too_long')

  // ---- send both, then replies ----
  await B.confirmBooking(bA.booking._id, { method: 'wallet' }); await B.confirmBooking(bB.booking._id, { method: 'wallet' })
  await M.deleteMany({ system: true })
  await B.claimWorker(); await B.tick()
  const sentA = await M.findOne({ campaignId: cpA._id, status: 'sent', test: false }), sentB = await M.findOne({ campaignId: cpB._id, status: 'sent', test: false })
  ok('both campaigns sending', !!sentA && !!sentB && (await M.countDocuments({ status: 'sent', test: false })) === 1000)
  ok('opt-out line added for A, not for B', /Reply STOP to opt out$/.test(sentA.body) && sentB.body === 'Hello B', JSON.stringify([sentA.body, sentB.body]))
  const lineA = await db.collection('bsEsims').findOne({ _id: sentA.esimId }), lineB = await db.collection('bsEsims').findOne({ _id: sentB.esimId })
  const inbound = (from, to, text) => B.onWebhook('{}', {}, { from, to, text, id: `in_${Math.random().toString(16).slice(2)}` })
  await inbound(sentA.to, lineA.msisdn, 'Tell me more about A')
  const inA = await M.findOne({ direction: 'in', from: sentA.to })
  ok('reply to the no-replies campaign is KEPT by the platform: not forwarded, no notice', inA?.status === 'kept' && inA.forwarded === false && inA.campaignId === cpA._id && (await db.collection('bsNotify').countDocuments({ type: 'inbound', from: sentA.to })) === 0, JSON.stringify(inA?.status))
  ok('…still counted on the campaign', (await db.collection('bsCampaigns').findOne({ _id: cpA._id })).stats.replies === 1)
  await inbound(sentB.to, lineB.msisdn, 'Tell me more about B')
  const inB = await M.findOne({ direction: 'in', from: sentB.to })
  ok('reply to the paid-replies campaign is forwarded to the customer', inB?.status === 'received' && inB.forwarded === true && (await db.collection('bsNotify').countDocuments({ type: 'inbound', from: sentB.to, key: 'n_inbound' })) === 1, JSON.stringify(inB?.status))
  const stopper = await M.findOne({ campaignId: cpA._id, status: 'sent', test: false, to: { $ne: sentA.to } })
  await inbound(stopper.to, lineA.msisdn, 'STOP')
  ok('STOP from a no-replies recipient still blocks the number globally (and is not forwarded)', !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: stopper.to })) && (await db.collection('bsNotify').countDocuments({ type: 'inbound', from: stopper.to })) === 0)
  ok('HELP/STOP auto-answers still queued for no-replies recipients', (await M.countDocuments({ cid: 'system:compliance', to: stopper.to })) === 1)

  // ---- a line with paid replies loses its number → admin notice ----
  alerts.length = 0
  const hit = await B.replyImpact(lineB, 'test')
  ok('replyImpact lists the paid-replies campaign on that line, not the free one', hit.length === 1 && hit[0].campaignId === cpB._id && hit[0].cid === cid && hit[0].replyFee === 20 && hit[0].sentFromLine > 0, JSON.stringify(hit))
  ok('admin alert names the customer and campaign', alerts.some(a => /paid replies affected/.test(a) && a.includes(cid) && a.includes('WithReplies') && !a.includes('NoReplies')), alerts.join(' | ').slice(0, 300))
  alerts.length = 0
  const hitA = lineA._id === lineB._id ? [] : await B.replyImpact(lineA, 'test')
  ok('the free campaign is never listed (lines are shared, so B may appear again)', hitA.every(h => h.campaignId === cpB._id), JSON.stringify(hitA.map(h => h.name)))
  alerts.length = 0
  await B.replaceEsim(lineB._id, 'suspended (test)', 'test')
  ok('number replacement path raises the same notice', alerts.some(a => /lost its number \(suspended \(test\)\)/.test(a) && a.includes('WithReplies')), alerts.join(' | ').slice(0, 200))

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
