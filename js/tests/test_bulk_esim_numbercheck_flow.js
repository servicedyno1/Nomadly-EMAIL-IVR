// eSIM BulkSMS round 15: free number check (only mobiles texted, every uploaded number billed), price type detected from the text,
// AI rotation that keeps the link/number or swaps in the customer's other links/numbers. Run from /app: node js/tests/test_bulk_esim_numbercheck_flow.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.EMERGENT_LLM_KEY
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), I = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsAiVariants', 'bsLookups', 'bsLookupLog']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  await B.setConfig({ quietStart: 0, quietEnd: 24, monitorEsims: 0, testerEsims: 0, scheduleDiscountPct: 10 }, 'test')
  await B.provisionMany(3, 'test', 'test'); await B.healthCheck()
  const cid = (await B.customer('Nomadly', '915'))._id

  // ---- number check (simulated: last4 9900–9949 landline, 9950+ VoIP) ----
  const mob = Array.from({ length: 480 }, (_, i) => `+1212555${String(1000 + i)}`), land = Array.from({ length: 12 }, (_, i) => `+1212555${9900 + i}`), voip = Array.from({ length: 8 }, (_, i) => `+1212555${9950 + i}`)
  const all = [...mob, ...land, ...voip], k = await B.checkNumbers(cid, all)
  ok('check: 480 mobile sendable, 12 landline + 8 VoIP skipped', k.sendable === 480 && k.skip.length === 20 && k.counts.landline === 12 && k.counts.voip === 8, JSON.stringify(k.counts))
  ok('check: simulated → no paid lookups, cost 0, logged', k.looked === 0 && k.cost === 0 && (await db.collection('bsLookupLog').countDocuments({ cid })) === 1)
  let calls = 0; B.setLookup(async (p) => { calls++; if (p.endsWith('1000')) throw new Error('down'); return { type: p.endsWith('1001') ? 'invalid' : 'mobile', carrier: 'T-Mobile' } })
  const k2 = await B.checkNumbers(cid, mob.slice(0, 5))
  ok('live-style lookup: failed lookup keeps the number, invalid skipped, paid lookups counted + cached', k2.sendable === 4 && k2.counts.invalid === 1 && k2.looked === 4 && k2.cost === 0.01 && (await db.collection('bsLookups').countDocuments()) === 4, JSON.stringify(k2))
  calls = 0; await B.checkNumbers(cid, mob.slice(0, 5))
  ok('cache: second check only re-looks the failed number', calls === 1, String(calls))
  B.setLookup(null)
  await B.setConfig({ numberCheck: false }, 'test')
  ok('numberCheck off → everything sendable', (await B.checkNumbers(cid, all)).sendable === 500)
  await B.setConfig({ numberCheck: true }, 'test')

  // ---- billing: all uploaded billed, only mobiles queued ----
  const cp = (await B.createCampaign(cid, { name: 'Check', content: 'Spring sale at our store, 20% off', contacts: all, skip: k.skip, consent: true })).campaign
  ok('campaign: billed 500 numbers, 480 to text, 20 skipped stored', cp.volume === 500 && cp.parts === 500 && cp.contacts.length === 480 && cp.skipped.length === 20 && cp.stats.skipped === 20 && cp.withLinks === false)
  ok('all-skipped list refused (err_no_mobile)', (await B.createCampaign(cid, { content: 'Hi', contacts: all, skip: all, consent: true })).error === 'err_no_mobile')
  const bk = (await B.createBooking(cid, { campaignId: cp._id, now: true })).booking
  ok('price covers all 500 uploaded (text only $50)', bk?.price === 50 && bk.volume === 500, JSON.stringify(bk && [bk.price, bk.volume]))
  await B.confirmBooking(bk._id, { method: 'wallet' })
  ok('only the 480 mobiles queued', (await db.collection('bsMessages').countDocuments({ bookingId: bk._id })) === 480)
  ok('report shows skipped 20', (await B.report(cp._id)).skipped === 20)

  // ---- price type from the text ----
  ok('text with a link → link price type', B.checkContent('Shop at www.store.com').withLinks === true && B.checkContent('Shop today').withLinks === false)
  ok('explicit text-only + link still refused', B.checkContent('Shop at www.store.com', false).error === 'err_has_link')
  const mixed = (await B.createCampaign(cid, { content: ['Hello friends', 'Visit shop.example.com'], contacts: all, consent: true })).campaign
  ok('rotation: one version with a link → whole campaign link-priced', mixed?.withLinks === true)
  const own = (await B.createCampaign(cid, { content: ['Deals at a.example.com', 'Deals at b.example.com', 'Call 646-555-0101 for deals'], contacts: all, consent: true })).campaign
  ok('own versions may each use a different link / number', own?.content.length === 3 && own.withLinks === true)

  // ---- AI rotation ----
  const src = 'Big sale at shop.example.com today'
  const same = await B.aiVariants(cid, { text: src })
  ok('AI (simulated): every variant keeps the original link exactly', same.variants?.length === 5 && same.variants.every(v => v.includes('shop.example.com')), JSON.stringify(same.variants))
  const sw = await B.aiVariants(cid, { text: src, swap: ['deals.example.org', 'promo.example.net'] })
  ok('AI with other links: each variant gets one, rotated', sw.variants?.length === 5 && sw.variants.every(v => !v.includes('shop.example.com')) && sw.variants.filter(v => v.includes('deals.example.org')).length === 3 && sw.variants.filter(v => v.includes('promo.example.net')).length === 2, JSON.stringify(sw.variants))
  ok('AI swap: a phone number cannot replace a link that has no phone counterpart', (await B.aiVariants(cid, { text: src, swap: ['646-555-0101'] })).error === 'err_links_bad')
  ok('AI swap: "visit x.com" (not just a link) refused', (await B.aiVariants(cid, { text: src, swap: ['visit deals.example.org'] })).error === 'err_links_bad')
  const plainV = await B.aiVariants(cid, { text: 'Spring sale this week only', swap: ['x.example.com'] })
  ok('AI on text-only ignores swap and adds no link', plainV.variants?.every(v => !B.hasLinkOrPhone(v)))

  // ---- copy ----
  const L = I.btn('en'), h = I.t('en', 'home', { min: 500, max: 2000, plain: 50, link: 75, pct: 10, minHours: 24, fee: 20, used: 0, limit: 2000, from: 8, to: 21 })
  ok('home says it reaches every US & Canadian carrier (short copy)', /every US & Canadian carrier/.test(h) && /Test SMS free/.test(h))
  const lo = I.t('en', 'list_ok', { n: 500, send: 480, skipped: 20, counts: { landline: 12, voip: 8, invalid: 0, other: 0 }, max: 2000 })
  ok('list summary tells who gets the text and that all are billed', /480<\/b> will get your text/.test(lo) && /12 landline, 8 VoIP/.test(lo) && /Billed for all 500/.test(lo), lo)
  let allLangs = true
  const O = { min: 1, max: 2, plain: 1, link: 2, pct: 10, minHours: 24, fee: 20, used: 0, limit: 1, from: 8, to: 21, n: 500, send: 480, skipped: 1, counts: { landline: 1, voip: 0, invalid: 0, other: 0 }, v: ['a'], optOut: true, links: false, price: 50, unit: 0.1, tests: 2, parts: 500, schedPrice: 45, list: 50, lines: true }
  const args = (key) => (key === 'progress_line' ? ['n', 'st', { sent: 1, total: 1, skipped: 1 }] : key === 'n_done' ? ['n', 1, 0, 0, 0, 2] : [O])
  for (const lang of ['fr', 'zh', 'hi', 'fa']) for (const key of ['home', 'help', 'contacts_q', 'list_ok', 'content_q', 'review', 'ready', 'when_q', 'progress_line', 'n_done', 'own_q']) { try { const v = I.t(lang, key, ...args(key)); if (!v || v === key || v === I.t('en', key, ...args(key))) { allLangs = false; console.log('missing', lang, key) } } catch (e) { allLangs = false; console.log(lang, key, e.message) } }
  ok('fr/zh/hi/fa have their own journey texts', allLangs)
  ok('every language has the new buttons, all distinct per language', ['en', 'fr', 'zh', 'hi', 'fa'].every(l => { const b = I.btn(l), v = [b.use_one, b.use_these, b.rotate_ai, b.rotate_own, b.edit, b.same_links, b.replies_off, b.replies_add(20), b.optout_no, b.optout_yes, b.agree, b.cont, b.test, b.now, b.sched]; return v.every(Boolean) && new Set(v).size === v.length }))
  ok('en buttons unchanged where tests rely on them', L.test === '🧪 Send a test SMS' && L.now === '🚀 Send now')

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
