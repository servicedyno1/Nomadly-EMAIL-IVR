#!/usr/bin/env node
// iter219: caller ID presets (10 cap, one-tap list), price-gap Business upgrade (web route + quote), bot preset helpers. Local Mongo, no network.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const cid = require('../cloudivr-web/caller-ids')
const pc = require('../phone-config')
const ccid = require('../custom-caller-id-bot')
const sw = require('../scam-watch')
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' :: ' + JSON.stringify(d)}`) }
const BIZ = 'T219_biz', PRO = 'T219_pro'
const nums = Array.from({ length: 11 }, (_, i) => `+1415555${String(2100 + i)}`)
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  sw.setNotifier(() => {})
  const routes = {}
  const router = { get: (p, f) => (routes['GET ' + p] = f), post: (p, f) => (routes['POST ' + p] = f), put() {}, delete() {} }
  const upgradeCalls = []
  const numbersApi = {
    findMine: async () => null,
    myNumbers: async (id) => ((await db.collection('phoneNumbersOf').findOne({ _id: id }))?.val?.numbers || []),
    upgradeQuote: (n, plan, pct, diff) => ({ charge: diff ? pc.callerIdUpgradeQuote(n).chargeAmount : 999 }),
    upgradeNumber: async (chatId, n, plan, via, pct, diff) => { upgradeCalls.push({ chatId, phone: n.phoneNumber, plan, pct, diff }); return { status: 200, body: { plan, charged: pc.callerIdUpgradeQuote(n).chargeAmount } } },
  }
  cid.routes(router, { db, h: f => f, numbersApi })
  const call = async (key, chatId, body = {}) => { let out = { status: 200 }; const r = { status(s) { out.status = s; return this }, json(b) { out.body = b; return this } }; await routes[key]({ webChatId: chatId, body }, r); return out }
  const P = db.collection('phoneNumbersOf')
  const cleanup = async () => { await P.deleteMany({ _id: { $in: [BIZ, PRO] } }); await db.collection('webCallerIds').deleteMany({ _id: { $in: nums } }) }
  try {
    await cleanup()
    await P.insertOne({ _id: BIZ, val: { numbers: [{ phoneNumber: '+18336112190', plan: 'business', status: 'active' }] } })
    await P.insertOne({ _id: PRO, val: { numbers: [{ phoneNumber: '+18336112191', plan: 'starter', status: 'active' }, { phoneNumber: '+18336112192', plan: 'pro', status: 'active', purchaseDate: new Date().toISOString() }] } })
    for (let i = 0; i < 10; i++) { const r = await cid.attest(BIZ, nums[i]); if (!r.ok) ok(`attest ${i}`, false, r) }
    const r11 = await cid.attest(BIZ, nums[10]); ok('11th preset refused too_many_presets', r11.error === 'too_many_presets', r11)
    ok('re-attesting a saved one still ok at cap', (await cid.attest(BIZ, nums[3])).ok)
    const list = await cid.presets(BIZ); ok('presets lists 10', list.length === 10 && list.includes(nums[0]), list)
    const g = await call('GET /caller-ids/presets', BIZ); ok('GET presets route', g.body.items.length === 10 && g.body.max === 10, g.body)
    await P.updateOne({ _id: BIZ }, { $set: { 'val.numbers.0.plan': 'pro' } })
    ok('attested presets hidden once off Business', (await cid.presets(BIZ)).length === 0)
    await P.updateOne({ _id: BIZ }, { $set: { 'val.numbers.0.plan': 'business' } })
    const q = pc.callerIdUpgradeQuote({ plan: 'pro', planPrice: 75, purchaseDate: new Date().toISOString() })
    ok('price-gap quote Pro→Business = Business − Pro', q.chargeAmount === pc.plans.business.price - pc.plans.pro.price && q.credit === 0, q)
    ok('normal quote unchanged (25% credit path)', pc.computeUpgradeQuote({ plan: 'pro', purchaseDate: new Date().toISOString() }, 'business').chargeAmount === pc.plans.business.price - pc.plans.pro.price * 0.25)
    const pq = await call('POST /caller-ids/upgrade', PRO, {}); ok('upgrade quote picks the Pro number', pq.body.number === '+18336112192' && pq.body.quote.charge === q.chargeAmount && !upgradeCalls.length, pq.body)
    const pd = await call('POST /caller-ids/upgrade', PRO, { number: '+18336112192', confirm: true }); ok('confirm upgrades with diff pricing, no offer', pd.status === 200 && upgradeCalls[0]?.diff === true && upgradeCalls[0]?.pct === 0 && upgradeCalls[0]?.plan === 'business', { pd, upgradeCalls })
    const pb = await call('POST /caller-ids/upgrade', BIZ, {}); ok('business-only account → not_found', pb.status === 404, pb)
    ok('bot preset button parsing', ccid.isPreset('🎭 +14155550100') && ccid.presetOf('🎭 +14155550100') === '+14155550100' && !ccid.isBtn('🎭 +14155550100') && ccid.isBtn(ccid.t('fa').btn))
    ok('bot upgrade button parsing', ccid.isUpBtn(ccid.t('en').upBtn('45.00')) && ccid.isUpBtn(ccid.t('fa').upBtn('45.00')) && !ccid.isUpBtn('👑 Upgrade to Business'))
    ok('bot preset rows', (await ccid.presetRows(BIZ)).length === 10)
    ok('no "logged" wording in bot copy', Object.keys({ en: 1, fr: 1, zh: 1, hi: 1, fa: 1 }).every(l => !/logged|enregistrée|记录|लॉग|ثبت می/.test(ccid.t(l).ask)))
  } catch (e) { ok('exception', false, e.stack) }
  await cleanup(); await mc.close()
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1)
})()
