// Telegram eSIM pay-first: pay without IMEI → line waits; IMEI afterwards creates it; daily reminder; refund after 7 days.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const EB = require('/app/js/esim-bot.js')
const ES = EB.ES
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const col = db.collection('esimLines'), a = '700000011', b = '700000012', cr = '700000013'
  const ids = [a, b, cr]
  const clean = () => Promise.all([col.deleteMany({ chatId: { $in: ids } }), db.collection('walletOf').deleteMany({ _id: { $in: ids } }), db.collection('transactions').deleteMany({ chatId: { $in: ids } })])
  await clean()
  await db.collection('walletOf').insertMany([{ _id: a, usdIn: 100, usdOut: 0 }, { _id: b, usdIn: 100, usdOut: 0 }, { _id: cr, usdIn: 0, usdOut: 0 }])
  const chat = []
  ES.init({ db, log: () => {}, tell: async () => null })
  ES.setBot({ sendMessage: async (id, text) => { chat.push({ id: String(id), text }); return {} }, sendPhoto: async () => ({}) })
  const p = await EB.plan()
  const order = { planId: p.planId, zipcode: null, email: null, autoRenew: true }
  const bal = async (id) => { const w = await db.collection('walletOf').findOne({ _id: id }); return (w.usdIn || 0) - (w.usdOut || 0) }
  const r = {}
  r.summaryNoImei = /after paying/.test(EB.s('en').summary(order, 75))
  const paid = await EB.fulfill(db, a, order, 'en')
  const la = await col.findOne({ _id: paid.lineId })
  r.payFirstWaits = paid.ok && paid.awaitingImei && la.status === 'awaiting_imei' && !la.imei && (await bal(a)) === 25 && /15-digit IMEI/.test(paid.text)
  r.listedWithSendImei = (await EB.lines(a)).some(l => l.id === paid.lineId && l.status === 'awaiting_imei')
  const bad = await EB.submitImei(db, a, paid.lineId, '123', 'en')
  r.badImeiKeepsWaiting = !bad.ok && (await col.findOne({ _id: paid.lineId })).status === 'awaiting_imei'
  const good = await EB.submitImei(db, a, paid.lineId, '356938035643809', 'en')
  const la2 = await col.findOne({ _id: paid.lineId })
  r.imeiCreatesLine = good.ok && la2.status === 'provisioning' && la2.imei === '356938035643809' && la2.simulated === true && (await bal(a)) === 25
  const again = await EB.submitImei(db, a, paid.lineId, '356938035643809', 'en')
  r.imeiOnlyOnce = !again.ok
  const other = await EB.submitImei(db, b, paid.lineId, '356938035643809', 'en')
  r.notOtherUsersLine = !other.ok
  const paidC = await EB.fulfillPaid(db, cr, order, 75, 'fr')
  r.cryptoPayFirst = paidC.ok && paidC.awaitingImei && /IMEI à 15 chiffres/.test(paidC.text) && (await bal(cr)) === 0
  const kept = await EB.fulfill(db, b, order, 'en')
  await col.updateOne({ _id: kept.lineId }, { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } })
  await ES.imeiChase()
  r.reminderSent = chat.filter(x => x.id === b && /waiting for your phone’s IMEI/.test(x.text)).length === 1
  await ES.imeiChase()
  r.reminderOncePerDay = chat.filter(x => x.id === b && /waiting for your phone’s IMEI/.test(x.text)).length === 1
  await col.updateOne({ _id: kept.lineId }, { $set: { createdAt: new Date(Date.now() - 8 * 86400000) } })
  await ES.imeiChase(); await ES.imeiChase()
  const lb = await col.findOne({ _id: kept.lineId })
  r.refundAfter7Days = lb.status === 'cancelled' && (await bal(b)) === 100 && chat.filter(x => x.id === b && /refunded to your wallet/.test(x.text)).length === 1
  r.cancelledHiddenFromList = !(await EB.lines(b)).some(l => l.id === kept.lineId)
  await clean(); await c.close()
  const fails = Object.entries(r).filter(([, v]) => !v)
  console.log(JSON.stringify(r, null, 1)); console.log(fails.length ? `FAIL ${fails.map(x => x[0])}` : `PASS ${Object.keys(r).length}/${Object.keys(r).length}`)
  process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
