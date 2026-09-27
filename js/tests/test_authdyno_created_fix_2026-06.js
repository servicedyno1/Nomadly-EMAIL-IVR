/* global process */
/* E2E replay against the LIVE running authDyno (localhost:5000). Reproduces the
 * 2026-09-27 stuck-deposit sequence: payment.created → pending → confirmed →
 * settled. Asserts the created event no longer burns the idempotency slot, the
 * confirmed event credits the wallet exactly once, and settled is a dup. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

const BASE = 'http://localhost:5000/dynopay/crypto-wallet'
const REF = 'E2EREF' + Date.now().toString().slice(-5)
const CHAT = '90000' + Date.now().toString().slice(-4)
const PID = 'e2epay-' + Date.now()

const post = (body) => fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.text())
const base = { payment_id: PID, amount: 0.00793, currency: 'ETH', base_amount: 20, fee_payer: 'company', address: '0xe2e' }

;(async () => {
  const c = new MongoClient(process.env.MONGO_URL); await c.connect()
  const db = c.db(process.env.DB_NAME)
  const wallet = async () => (await db.collection('walletOf').findOne({ _id: String(CHAT) }))?.usdIn || 0

  // cleanup + seed
  await db.collection('dynopayProcessed').deleteOne({ _id: PID })
  await db.collection('chatIdOfDynopayPayment').deleteOne({ _id: REF })
  await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { _id: String(CHAT), userLanguage: 'en' } }, { upsert: true })
  await db.collection('chatIdOfDynopayPayment').insertOne({ _id: REF, val: { chatId: String(CHAT), action: 'walletFund', address: '0xe2e' } })

  const before = await wallet()
  console.log(`seed ref=${REF} chat=${CHAT} pid=${PID}  wallet_before=$${before}`)

  // 1) created — must NOT claim (matches prod: no meta_data.refId)
  await post({ ...base, event: 'payment.created', status: 'created', amount: 0.0073804 })
  let claim = await db.collection('dynopayProcessed').findOne({ _id: PID })
  const c1 = !claim
  console.log(`${c1 ? '✅' : '❌'} after CREATED: idempotency NOT claimed (claim=${claim ? claim.event : 'none'})`)

  // 2) pending — stores mapping, still no claim
  await post({ ...base, event: 'payment.pending', status: 'pending', meta_data: { refId: REF } })
  claim = await db.collection('dynopayProcessed').findOne({ _id: PID })
  const c2 = !claim
  console.log(`${c2 ? '✅' : '❌'} after PENDING: idempotency NOT claimed (claim=${claim ? claim.event : 'none'})`)

  // 3) confirmed — claims + credits
  await post({ ...base, event: 'payment.confirmed', status: 'confirmed', meta_data: { refId: REF } })
  await new Promise(r => setTimeout(r, 800))
  claim = await db.collection('dynopayProcessed').findOne({ _id: PID })
  const wAfterConfirm = await wallet()
  const c3a = claim && claim.event === 'payment.confirmed'
  const c3b = wAfterConfirm - before >= 18 && wAfterConfirm - before <= 22
  console.log(`${c3a ? '✅' : '❌'} after CONFIRMED: claimed by event='${claim && claim.event}' (expect payment.confirmed)`)
  console.log(`${c3b ? '✅' : '❌'} after CONFIRMED: wallet credited $${(wAfterConfirm - before).toFixed(2)} (expect ~20)`)

  // 4) settled — duplicate, no second credit
  await post({ ...base, event: 'payment.settled', status: 'settled', meta_data: { refId: REF } })
  await new Promise(r => setTimeout(r, 500))
  const wAfterSettle = await wallet()
  const c4 = Math.abs(wAfterSettle - wAfterConfirm) < 0.001
  console.log(`${c4 ? '✅' : '❌'} after SETTLED: no double-credit (wallet still $${wAfterSettle.toFixed(2)})`)

  // cleanup
  await db.collection('dynopayProcessed').deleteOne({ _id: PID })
  await db.collection('chatIdOfDynopayPayment').deleteOne({ _id: REF })
  await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  await db.collection('state').deleteOne({ _id: String(CHAT) })
  await db.collection('depositFunnel').deleteMany({ chatId: String(CHAT) })
  await db.collection('funnelEvents').deleteMany({ chatId: String(CHAT) })
  await c.close()

  const all = [c1, c2, c3a, c3b, c4]
  const pass = all.filter(Boolean).length
  console.log(`\n${pass}/${all.length} passed`)
  process.exit(pass === all.length ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
