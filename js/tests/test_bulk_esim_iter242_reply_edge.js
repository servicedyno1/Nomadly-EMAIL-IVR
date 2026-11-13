// iter242 edge: a reply to a paid-replies campaign is "kept" when a later no-replies campaign to the same number is merely QUEUED.
// Run from /app: node js/tests/test_bulk_esim_iter242_reply_edge.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
for (const k of ['SPENZA_BULK_API_KEY', 'SPENZA_BULK_API_SECRET', 'EMERGENT_LLM_KEY', 'BULK_ESIM_FAKE_ACCOUNTS']) delete process.env[k]
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsAiVariants']
const nums = (n, from) => Array.from({ length: n }, (_, i) => `+1212555${String(from + i).padStart(4, '0')}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} }); process.env.BULK_ESIM_WORKER = ''
  await B.setConfig({ quietStart: 0, quietEnd: 24, platformPerMin: 10000, esimPerMin: 10000, monitorEsims: 0, testerEsims: 0, minEsims: 0 }, 't')
  await B.provisionMany(2, 't', 't'); await B.healthCheck()
  const cid = (await B.customer('TESTPROBE', '990000778'))._id, M = db.collection('bsMessages')
  const cpB = (await B.createCampaign(cid, { name: 'TEST_Paid', content: 'Paid replies', contacts: nums(500, 1000), consent: true })).campaign
  await B.setReplies(cid, cpB._id, true)
  const bB = await B.createBooking(cid, { campaignId: cpB._id, now: true }); await B.confirmBooking(bB.booking._id, { method: 'wallet' })
  await M.deleteMany({ system: true }); await B.claimWorker(); await B.tick()
  const sent = await M.findOne({ campaignId: cpB._id, status: 'sent' }), line = await db.collection('bsEsims').findOne({ _id: sent.esimId })
  // later campaign WITHOUT replies to the same numbers, booked 2 days ahead → only queued
  const cpA = (await B.createCampaign(cid, { name: 'TEST_Free', content: 'No replies', contacts: nums(500, 1000), consent: true })).campaign
  const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const bA = await B.createBooking(cid, { campaignId: cpA._id, date: d2, hour: 12 }); await B.confirmBooking(bA.booking._id, { method: 'wallet' })
  await B.onWebhook('{}', {}, { from: sent.to, to: line.msisdn, text: 'Reply to the PAID campaign', id: 'in_edge1' })
  const inb = await M.findOne({ direction: 'in', from: sent.to })
  const bug = inb.status === 'kept' || inb.campaignId !== cpB._id
  console.log(bug ? '❌ BUG' : '✅ OK', 'reply attributed to', inb.campaignId === cpB._id ? 'PAID' : 'FREE (queued, never sent)', '| status', inb.status, '| forwarded', inb.forwarded)
  for (const c of COLS) await db.collection(c).deleteMany({})
  console.log(`\n${bug ? 0 : 1} passed, ${bug ? 1 : 0} failed`); await cl.close(); process.exit(bug ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
