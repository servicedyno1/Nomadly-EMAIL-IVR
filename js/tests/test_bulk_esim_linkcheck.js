// eSIM BulkSMS: Google link safety (message step + 10-min sweep), over-cap replacement orders a new line, free-test farming limits.
// Run from /app: node js/tests/test_bulk_esim_linkcheck.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.EMERGENT_LLM_KEY
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), U = require('../bulk-esim/url-check'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsLookups', 'bsLookupLog', 'bsDrafts']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = [], since = (n) => alerts.slice(n).join('\n')
  await B.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await B.setConfig({ quietStart: 0, quietEnd: 24, monitorEsims: 0, testerEsims: 0, platformPerMin: 10000, esimPerMin: 10000 }, 'test')
  await B.provisionMany(3, 'test', 'test'); await B.healthCheck()
  const cid = (await B.customer('Nomadly', '931'))._id, M = db.collection('bsMessages')

  // ---- message step ----
  ok('no key → simulated mode', U.keyMode() === null || process.env.BULK_ESIM_URLCHECK_LIVE !== 'true')
  const f = await B.screenContent(cid, ['Win now at login.flagged-test.com today'])
  ok('flagged link → content refused with the link named', f.error === 'err_link_flagged' && /login\.flagged-test\.com/.test(f.args[0]) && /Content flagged/.test(I.t('en', f.error, ...f.args)))
  ok('admin told (once per customer per day) + incident', /tried to use a link Google flags/.test(alerts.join('\n')) && !!(await db.collection('bsIncidents').findOne({ type: 'link_flagged' })))
  ok('clean link passes', (await B.screenContent(cid, ['Sale at shop.example.com'])).ok === true)
  ok('text without links passes without a check', (await B.screenContent(cid, ['Hello there'])).unchecked === false)
  process.env.BULK_ESIM_FAKE_URLCHECK_DOWN = '1'; U.clearCache(); let n0 = alerts.length
  const d = await B.screenContent(cid, ['Sale at other.example.com'])
  ok('Google down → let through, marked unchecked, admin told', d.ok && d.unchecked === true && /not answering/.test(since(n0)))

  // ---- unchecked campaign: test refused while Google is down, sweep checks later ----
  const cpU = (await B.createCampaign(cid, { content: ['Deals at login.flagged-test.com', 'Deals at shop.example.com'], contacts: nums(500, 1000), consent: true, linksUnchecked: true })).campaign
  ok('campaign stored as linksUnchecked', cpU.linksUnchecked === true)
  ok('test with unchecked link while Google is down → refused', (await B.testCheck(cid, cpU._id, '+13105550100')).error === 'err_link_unchecked')
  delete process.env.BULK_ESIM_FAKE_URLCHECK_DOWN; U.clearCache()
  ok('Google back → test re-checks and refuses the flagged link', (await B.testCheck(cid, cpU._id, '+13105550100')).error === 'err_link_flagged')

  // ---- sweep while sending: stop only flagged versions, no refund ----
  process.env.BULK_ESIM_FAKE_FLAGGED = ''
  const cp = (await B.createCampaign(cid, { content: ['Deals at a.example.com', 'Deals at b.example.com'], contacts: nums(500, 2000), consent: true })).campaign
  const bk = (await B.createBooking(cid, { campaignId: cp._id, now: true })).booking; await B.confirmBooking(bk._id, { method: 'wallet' })
  ok('500 texts queued (2 versions)', (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 500)
  process.env.BULK_ESIM_FAKE_FLAGGED = 'b.example.com'; U.clearCache(); n0 = alerts.length
  await B.linkSweep()
  const cp2 = await db.collection('bsCampaigns').findOne({ _id: cp._id })
  ok('sweep: version 2 blocked, its 250 queued texts stopped, version 1 keeps sending', JSON.stringify(cp2.blockedVersions) === '[1]' && (await M.countDocuments({ campaignId: cp._id, status: 'blocked' })) === 250 && (await M.countDocuments({ campaignId: cp._id, status: 'queued' })) === 250)
  ok('admin alert names customer, campaign, link and "no refund"', /Link flagged by Google in Nomadly:931/.test(since(n0)) && /b\.example\.com/.test(since(n0)) && /no refund/.test(since(n0)), since(n0))
  ok('customer is NOT told about the flag (admin only)', !(await db.collection('bsNotify').findOne({ key: 'n_link_flagged', campaignId: cp._id })))
  n0 = alerts.length; await B.linkSweep()
  ok('second sweep: no duplicate alert', !/Link flagged/.test(since(n0)))
  await M.updateMany({ campaignId: cp._id, status: 'queued' }, { $set: { status: 'sent' } }); await B.finishCampaigns()
  const bk2 = await db.collection('bsBookings').findOne({ _id: bk._id })
  ok('campaign completes; blocked texts not refunded', (await db.collection('bsCampaigns').findOne({ _id: cp._id })).status === 'completed' && (bk2.refundedUnsent || 0) === 0, JSON.stringify(bk2.refundedUnsent))
  const done = await db.collection('bsNotify').findOne({ key: 'n_done', campaignId: cp._id })
  ok('customer gets the completion alert once nothing eligible is left (blocked counted as not sent, no refund)', done && done.args[1] === 250 && done.args[3] === 250 && !done.args[6], JSON.stringify(done?.args))
  ok('report counts blocked', (await B.report(cp._id)).blocked === 250)

  // ---- all versions flagged → cannot book ----
  const cp3 = (await B.createCampaign(cid, { content: ['Deals at b.example.com'], contacts: nums(500, 3000), consent: true })).campaign
  await B.linkSweep()
  ok('draft with every version flagged → booking refused', (await B.createBooking(cid, { campaignId: cp3._id, now: true })).error === 'err_link_flagged_all')

  // ---- one-off texts ----
  ok('one-off text with a flagged link refused', (await B.sendOne(cid, '+13105550111', 'see x.b.example.com')).error === 'err_link_flagged')
  delete process.env.BULK_ESIM_FAKE_FLAGGED

  // ---- SSRF guard for short-link following ----
  ok('short-link follower never touches private hosts', !(await U.publicHost('127.0.0.1')) && !(await U.publicHost('localhost')) && !(await U.publicHost('169.254.169.254')) && !(await U.publicHost('10.0.0.5')))

  // ---- bot message step shows "Content flagged" and stays ----
  const st = { action: 'bse-content', bseOptOut: true, userLanguage: 'en' }, sent = []
  await BOT.handle({ chatId: '931', message: 'Claim at win.flagged-test.com now', info: st, state: {}, set: async (_s, _c, k, v) => { st[k] = v }, saveInfo: async (k, v) => { st[k] = v }, send: async (_c, t) => { sent.push(t) }, goto: {} })
  ok('bot: flagged content refused at the message step', st.action === 'bse-content' && /Content flagged/.test(sent[0] || ''), sent[0])

  // ---- over the daily number-change cap → new line ordered ----
  await B.setConfig({ autoReplace: true, maxReplacesPerDay: 3 }, 'test'); await db.collection('bsConfig').updateOne({ _id: `replaces:${new Date().toISOString().slice(0, 10)}` }, { $set: { n: 3, at: new Date() } }, { upsert: true })
  const e = await db.collection('bsEsims').findOne({ status: 'available' }), before = await db.collection('bsEsims').countDocuments(); n0 = alerts.length
  await B.autoReplace(e, 'suspended by provider (TEST)', await B.cfg())
  const e2 = await db.collection('bsEsims').findOne({ _id: e._id })
  ok('limit reached → a new line is ordered instead and linked', (await db.collection('bsEsims').countDocuments()) === before + 1 && /new line .* was ordered/.test(since(n0)) && e2.replacedBy && e2.replacedBy !== 'pending-new-line', since(n0))

  // ---- free-test farming ----
  const c1 = (await B.customer('Nomadly', '941'))._id, c2 = (await B.customer('Nomadly', '942'))._id
  const k1 = (await B.createCampaign(c1, { content: 'Hi', contacts: nums(500, 4000), consent: true })).campaign, k2 = (await B.createCampaign(c2, { content: 'Hi', contacts: nums(500, 5000), consent: true })).campaign
  ok('first new customer: free test to +13105550200', (await B.testSend(c1, k1._id, '+13105550200')).free === true)
  ok('second account, same number → free test refused (one free test per number ever)', (await B.testCheck(c2, k2._id, '+13105550200')).error === 'err_free_number_used')
  await B.setConfig({ freeTestsPerDay: 1 }, 'test'); n0 = alerts.length
  ok('platform daily free-test cap → refused + admin alert', (await B.testCheck(c2, k2._id, '+13105550201')).error === 'err_free_cap' && /Free-test daily cap/.test(since(n0)))

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
