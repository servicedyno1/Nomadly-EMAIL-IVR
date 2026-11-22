// Number orders vs provider balance: never paused ahead of time; a "balance too low" answer queues the order, the
// queue buys oldest-first once the balance is back and stops again at the next "too low". Run: node js/tests/test_order_queue_funds.js
const path = require('path')
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }

// Fake MultiTEL: buys succeed while `funds` > 0 (each costs 1); otherwise "Insufficient balance".
let funds = 0
const bought = [], noFunds = new Set()
const fakeMt = {
  buyNumber: async (p) => { noFunds.delete(p); if (funds < 1) { noFunds.add(p); return null } funds--; bought.push(p); return { id: `mt:${p}`, phone_numbers: [{ phone_number: p }] } },
  wasNoFunds: (p) => noFunds.has(p), searchNumbers: async () => [], remember: () => {}, searchedMeta: () => null, isBlocked: () => false, enabled: () => true,
}
require.cache[path.resolve(__dirname, '../multitel/index.js')] = { id: 'mt', filename: 'mt', loaded: true, exports: fakeMt }
require.cache[path.resolve(__dirname, '../active-slot.js')] = { id: 'as', filename: 'as', loaded: true, exports: { singletonInterval: () => {} } }

;(async () => {
  const cl = await MongoClient.connect('mongodb://127.0.0.1:27017'); const db = cl.db('order_queue_' + Date.now())
  const PO = require('../pending-orders'), PH = require('../provider-health')
  const done = []
  await PO.init({ db, credit: async () => {}, removeNumber: async () => {}, activateNumber: async (c, p) => done.push(p), send: () => {}, email: () => {}, notifyAdmin: () => {} })

  funds = 1
  const r1 = await PH.buyWithBackup('multitel', '+18000000001')
  ok('balance enough → bought straight away (no early pause)', r1 && !r1._pending && bought.includes('+18000000001'))
  const r2 = await PH.buyWithBackup('multitel', '+18000000002')
  ok('provider says balance too low → order queued', r2?._pending === true)
  for (const [i, p] of ['+18000000002', '+18000000003', '+18000000004'].entries()) await PO.enqueue({ chatId: 'c' + i, phoneNumber: p, order: i ? { id: `pending:${i}`, _pending: true, _provider: 'multitel' } : { ...r2 }, amount: 5 })
  await db.collection('pendingNumberOrders').updateMany({}, [{ $set: { createdAt: { $toDate: { $add: [Date.now() - 600000, { $multiply: [{ $toInt: { $substrCP: ['$phoneNumber', 11, 1] } }, 1000] }] } } } }])

  funds = 0; await PO.tick()
  ok('still no balance → nothing bought, nothing refunded', done.length === 0 && (await db.collection('pendingNumberOrders').countDocuments({ status: 'waiting' })) === 3)
  const later = () => db.collection('pendingNumberOrders').updateMany({}, { $set: { nextTryAt: new Date(Date.now() - 1000) } }) // 10 minutes pass (retry gap)
  funds = 2; await later(); await PO.tick()
  ok('top-up covers two → oldest two bought, queue stops at the third', JSON.stringify(done) === JSON.stringify(['+18000000002', '+18000000003']) && (await db.collection('pendingNumberOrders').countDocuments({ status: 'waiting' })) === 1)
  funds = 1; await later(); await PO.tick()
  ok('next top-up → last one bought', done.length === 3 && done[2] === '+18000000004' && (await db.collection('pendingNumberOrders').countDocuments({ status: 'refunded' })) === 0)

  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
