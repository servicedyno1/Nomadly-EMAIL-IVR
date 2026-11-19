// The original "Send a test SMS" step is reached from every new entry point: after validation, after buying leads,
// a reused saved list, and Validate-first inside BulkSMS. Testing stays optional; Edit after a test keeps validation.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000778, L = I.btn('en')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await BOT.init({ db, log: () => {}, notifyAdmin: () => {} })
  if (!(await B.ready()).send || !(await B.ready()).test) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() }
  const cid = B.cidOf(BOT.brand(), CHAT)
  const info = { action: 'none', userLanguage: 'en' }, out = []
  const send = async (id, text, o) => { out.push({ text: String(text), kb: (o?.reply_markup?.keyboard || []).flat().map(String) }); return true }
  const ctx = (message) => ({ chatId: CHAT, msg: { text: message, from: { id: CHAT, first_name: 'Qa' } }, message, info, state: {}, set: async (_s, _c, k, v) => { info[k] = v }, saveInfo: async (k, v) => { info[k] = v }, send, goto: { 'digital-product-pay': async () => {}, submenu7: async () => {}, displayMainMenuButtons: async () => {} }, bot: null })
  const say = async (m) => { out.length = 0; await BOT.handle(ctx(m)); return out[out.length - 1] || { text: '', kb: [] } }
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
  const nums = (base, n) => Array.from({ length: n }, (_, i) => `+1212555${base + i}`)
  // From the list/consent screen: write the text, use it → the original ready (test) screen.
  const toReady = async (text) => { await say(L.agree); await say(text); return say(L.use_one) }
  const isReady = (r, label) => {
    ok(`${label}: reaches the test step (bse-test)`, info.action === 'bse-test', info.action)
    ok(`${label}: Send a test SMS + Skip test offered`, r.kb.includes(L.test) && r.kb.includes(L.test_skip), r.kb.join(' | '))
  }
  const doTest = async (label) => {
    let r = await say(L.test); ok(`${label}: Send a test → number prompt`, info.action === 'bse-test-to', info.action)
    r = await say('+13104567890'); ok(`${label}: test sent → "Did it arrive?"`, info.action === 'bse-test-check' && /Did it arrive/.test(r.text), info.action)
    const m = await db.collection('bsMessages').findOne({ _id: info.bseTestMsg })
    ok(`${label}: test message queued as test for this campaign`, m?.test === true && m?.campaignId === info.bseCampaign, JSON.stringify(m && { test: m.test, to: m.to }))
  }
  try {
    // 1) After validating a list (offerSend → Text them now)
    let r; out.length = 0
    await BOT.offerSend({ chatId: CHAT, numbers: nums(3000, 150), lang: 'en', send })
    ok('validation hand-off intro mentions the test', /send yourself a test/.test(out[0]?.text || ''), out[0]?.text)
    await say(L.ho_now); r = await toReady('Hi from QA validated A')
    isReady(r, 'after validation'); await doTest('after validation')
    r = await say(L.arrived_yes); ok('after validation: Yes → when screen', info.action === 'bse-when', info.action)
    await say(L.back)
    // 2) After buying leads (same hand-off, Schedule for later) — skipping the test stays allowed
    await BOT.offerSend({ chatId: CHAT, numbers: nums(3200, 120), lang: 'en', send })
    await say(L.ho_later); r = await toReady('Hi from QA leads B')
    isReady(r, 'after buying leads')
    r = await say(L.test_skip); ok('after buying leads: Skip test → when screen (optional)', info.action === 'bse-when' && r.kb.includes(L.sched), info.action)
    await say(L.back)
    // 3) Reusing a saved validated list
    await say(L.home); await say(L.newc); await say(L.lists)
    const ls = await B.savedLists(cid); const label = ls[0].name ? `📋 ${ls[0].name} · ${ls[0].n} · ${ls[0].at.toISOString().slice(0, 10)}` : I.t('en', 'list_label', { n: ls[0].n, date: ls[0].at.toISOString().slice(0, 10) })
    await say(label); r = await toReady('Hi from QA saved C')
    isReady(r, 'saved list'); await doTest('saved list')
    await say(L.back)
    // 4) Validate-first inside BulkSMS; Edit after a test keeps the validation
    await say(L.home); await say(L.newc); await say(L.validate_first); await say(nums(4000, 510).join('\n'))
    r = await toReady('Hi from QA valfirst D')
    isReady(r, 'validate-first'); await doTest('validate-first')
    const cpD = await db.collection('bsCampaigns').findOne({ _id: info.bseCampaign })
    ok('validate-first: campaign carries validation', cpD?.validate === true && cpD?.valFee > 0, JSON.stringify({ validate: cpD?.validate, valFee: cpD?.valFee }))
    await db.collection('bsMessages').updateMany({ cid, test: true }, { $set: { createdAt: new Date(Date.now() - 3 * 60000) } })
    await say(L.arrived_no); await say(L.edit)
    const d = await db.collection('bsDrafts').findOne({ _id: cid })
    ok('validate-first: Edit after test keeps validation in the draft', d?.validate === true, JSON.stringify({ validate: d?.validate }))
    await say('Hi from QA valfirst D2'); r = await say(L.use_one)
    const cpD2 = await db.collection('bsCampaigns').findOne({ _id: info.bseCampaign })
    ok('validate-first: rebuilt campaign still validates + back on test step', info.action === 'bse-test' && cpD2?.validate === true && cpD2?.valFee === cpD.valFee, JSON.stringify({ a: info.action, validate: cpD2?.validate, valFee: cpD2?.valFee }))
  } catch (e) { fail++; console.log('❌ exception', e.stack) }
  for (const b of await db.collection('bsBookings').find({ cid }).toArray()) await B.cancelBooking(b._id, { by: 'admin' }).catch(() => {})
  for (const c of ['bsMessages', 'bsBookings', 'bsCampaigns', 'bsDaily', 'bsPayments', 'bsReviews', 'bsLists', 'bsFreeTests']) await db.collection(c).deleteMany({ cid })
  await db.collection('bsHandoff').deleteOne({ _id: cid }); await db.collection('bsNotify').deleteMany({ chatId: String(CHAT) }); await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('bsDrafts').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
