// Renewal rules (preview/simulated lines): charge a day before expiry, pause + retry when unpaid, end at expiry when unpaid or auto-renew off.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const ES = require('/app/js/spenza.js')
const H = 3600000, D = 24 * H
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const col = db.collection('esimLines'), rich = 'renewtest-rich', poor = 'renewtest-poor'
  const clean = () => Promise.all([col.deleteMany({ chatId: { $in: [rich, poor] } }), db.collection('walletOf').deleteMany({ _id: { $in: [rich, poor] } }), db.collection('transactions').deleteMany({ chatId: { $in: [rich, poor] } })])
  await clean()
  await db.collection('walletOf').insertMany([{ _id: rich, usdIn: 500, usdOut: 0 }, { _id: poor, usdIn: 0, usdOut: 0 }])
  const told = []
  ES.init({ db, log: () => {}, tell: async (id, text) => { told.push(text); return null } })
  const base = { status: 'active', price: 75, simulated: true, iccid: 'x', phoneNumber: '+15550000000', callsTo: 'device', createdAt: new Date() }
  const exp = new Date(Date.now() + 20 * H)
  await col.insertMany([
    { ...base, _id: 'rt_paid', chatId: rich, expiresAt: exp, nextBillAt: new Date(exp - D) },
    { ...base, _id: 'rt_unpaid', chatId: poor, expiresAt: exp, nextBillAt: new Date(exp - D) },
    { ...base, _id: 'rt_off', chatId: rich, autoRenew: false, expiresAt: exp, nextBillAt: new Date(exp - D) },
    { ...base, _id: 'rt_legacy', chatId: rich, nextBillAt: new Date(Date.now() + 10 * D) },
  ])
  await ES.tick()
  const g = async (id) => col.findOne({ _id: id })
  const paid = await g('rt_paid'), unpaid = await g('rt_unpaid'), off = await g('rt_off'), legacy = await g('rt_legacy')
  const w = await db.collection('walletOf').findOne({ _id: rich })
  const r = {
    paidRenewed: paid.status === 'active' && Math.abs(paid.expiresAt - exp - 30 * D) < 5000 && w.usdOut === 75,
    unpaidPaused: unpaid.status === 'suspended' && /renewal is due/.test(unpaid.note || ''),
    offUntouched: off.status === 'active',
    legacyDated: !!legacy.expiresAt && Math.abs(legacy.expiresAt - legacy.nextBillAt - D) < 5000,
  }
  await col.updateMany({ _id: { $in: ['rt_unpaid', 'rt_off'] } }, { $set: { expiresAt: new Date(Date.now() + 30 * 60000) } })
  await col.insertOne({ ...base, _id: 'rt_remind', chatId: poor, expiresAt: new Date(Date.now() + 2 * D), nextBillAt: new Date(Date.now() + D) })

  await ES.tick()
  r.reminded = !!(await g('rt_remind')).remindedFor && told.some(t => /renews on .*Wallet balance: \$0\.00\. Top up \$75\.00/.test(t))
  const n = told.length
  await ES.tick()
  const soon = new Date(Date.now() + 2 * D).toISOString().slice(0, 10)
  r.remindOnce = told.filter(t => t.startsWith('🔔') && t.includes(soon)).length === 1 && told.length === n
  r.unpaidEnded = (await g('rt_unpaid')).status === 'cancelled'
  r.offEnded = (await g('rt_off')).status === 'cancelled'
  r.offNoCharge = (await db.collection('walletOf').findOne({ _id: rich })).usdOut === 75
  console.log(JSON.stringify(r))
  await clean(); await c.close()
  const ok = Object.values(r).every(Boolean); console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
