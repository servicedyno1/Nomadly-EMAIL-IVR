// CloudIVR web eSIM: pay first, then send the IMEI (order page right after payment, or later from the eSIM list).
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const axios = require('axios')
const fake = async (cfg) => ({ data: cfg.url.includes('/plans') ? { data: [{ productId: 'P1', price: 10, currency: 'USD', validityDays: 30, operator: 'T', isEsim: true }] } : { data: [{ simId: 'S1', operator: 'T', isEsim: true, inStock: 5, price: 1 }] } })
fake.post = async () => ({ data: { data: { access_token: 'x', expires_at: new Date(Date.now() + 3600e3).toISOString() } } })
fake.get = axios.get
require.cache[require.resolve('axios')].exports = fake
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const IMEI = '490154203237518', CHAT = '5000000000000999'
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db('test_imei_web')
  await db.dropDatabase()
  const told = []
  const ES = require('../spenza.js').init({ db, log: () => {}, tell: async (id, text) => { told.push({ id, text }) } })
  await db.collection('esimPlans').insertOne({ _id: 'P1', price: 30, enabled: true })
  const W = require('../cloudivr-web/wallet').walletOps(db)
  await W.credit(CHAT, 100)
  const r = await ES.buy(CHAT, { planId: 'P1', email: 'qa@example.com', source: 'web' })
  ok(r.awaitingImei && r.item.status === 'awaiting_imei', 'web buy without IMEI is paid and waits for the IMEI')
  ok(r.item.imeiDueAt && new Date(r.item.imeiDueAt) - Date.now() > 6.9 * 86400e3, 'the line shows a 7-day IMEI deadline')
  ok((await ES.list(CHAT)).some(x => x.id === r.item.id && x.status === 'awaiting_imei'), 'the paid line is listed on the eSIM page (add IMEI later)')
  ok((await ES.buy(CHAT, { planId: 'P1', email: 'qa@example.com', imei: '123', source: 'web' })).error, 'a wrong IMEI typed at checkout is still rejected')
  ok(/15-digit IMEI/.test((await ES.submitImei(CHAT, r.item.id, '490154203237519')).error || ''), 'invalid IMEI after payment is rejected')
  ok(/no longer waiting/.test((await ES.submitImei('5000000000000998', r.item.id, IMEI)).error || ''), 'another account cannot send the IMEI for this line')
  const s = await ES.submitImei(CHAT, r.item.id, IMEI)
  ok(!s.error && (await db.collection('esimLines').findOne({ _id: r.item.id })).status === 'provisioning', 'valid IMEI creates the eSIM (provisioning)')
  ok(/no longer waiting/.test((await ES.submitImei(CHAT, r.item.id, IMEI)).error || ''), 'the IMEI can only be sent once')
  const r2 = await ES.buy(CHAT, { planId: 'P1', email: 'qa@example.com', source: 'web' })
  await db.collection('esimLines').updateOne({ _id: r2.item.id }, { $set: { createdAt: new Date(Date.now() - 2 * 86400e3) } })
  await ES.imeiChase()
  ok(told.some(x => x.id === CHAT && /Open USA eSIM in CloudIVR/.test(x.text) && !/\/imei/.test(x.text)), 'web reminder points to the CloudIVR eSIM page, not the bot command')
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
