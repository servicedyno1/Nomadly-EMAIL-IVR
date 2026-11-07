'use strict'
// Fax bulk resumeBatches + cancelBatch ownership: restart recovery scenarios (stale claim, fresh claim, cancelled-unsummarised).
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const fax = require('../fax-service')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('fax_resume_test_' + Date.now())
  const sent = []
  fax.init({ db, bot: { sendMessage: async (id, t) => sent.push({ id, t }), sendDocument: async () => {} }, log: () => {} })
  const chatId = '888001'
  const biz = { phoneNumber: '+15550003333', plan: 'business', provider: 'telnyx', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', features: {} }
  await db.collection('phoneNumbersOf').insertOne({ _id: chatId, val: { numbers: [biz] } })
  await db.collection('walletOf').insertOne({ _id: chatId, usdIn: 50, usdOut: 0 })
  await db.collection('state').insertOne({ _id: chatId, userLanguage: 'en' })
  const base = (id, extra) => ({ _id: id, chatId, phoneNumber: biz.phoneNumber, fileId: '000000000000000000000000', pages: 1, recipients: ['+14155550101', '+14155550102', '+14155550103'], total: 3, cursor: 1, started: 0, startFailed: 0, delivered: 0, failed: 0, status: 'running', createdAt: new Date(), ...extra })

  // A: stale (idle > 2 min) claim with no fax record → startFailed 1, rest resumes, batch completes
  await db.collection('faxBatches').insertOne(base('A', { updatedAt: new Date(Date.now() - 5 * 60000) }))
  // B: claim fresh (restart within 2 min: realistic — resume runs 15 s after boot)
  await db.collection('faxBatches').insertOne(base('B', { updatedAt: new Date(Date.now() - 20000) }))
  // C: cancelled but never summarised, all claimed recorded
  await db.collection('faxBatches').insertOne(base('C', { status: 'cancelled', cursor: 1, startFailed: 1, updatedAt: new Date(Date.now() - 5 * 60000) }))
  await fax.resumeBatches()
  await wait(5000)
  const A = await db.collection('faxBatches').findOne({ _id: 'A' })
  // B: the periodic sweep (every 2 min) runs again once the batch has been idle 2 min.
  await db.collection('faxBatches').updateOne({ _id: 'B' }, { $set: { updatedAt: new Date(Date.now() - 3 * 60000) } })
  await fax.resumeBatches()
  await wait(1000)
  const B = await db.collection('faxBatches').findOne({ _id: 'B' })
  const C = await db.collection('faxBatches').findOne({ _id: 'C' })
  console.log('A', { cursor: A.cursor, started: A.started, startFailed: A.startFailed, delivered: A.delivered, status: A.status, summary: A.summarySent })
  console.log('B', { cursor: B.cursor, started: B.started, startFailed: B.startFailed, delivered: B.delivered, status: B.status, summary: B.summarySent })
  console.log('C', { status: C.status, summary: C.summarySent })
  ok(A.startFailed === 1 && A.started === 2 && A.status === 'done' && A.summarySent, 'A: stale claim counted startFailed, rest sent, done+summarised')
  ok(C.summarySent === true && C.status === 'cancelled', 'C: cancelled batch summarised')
  ok(B.status === 'done' && B.summarySent, 'B: fresh-claim restart (<2 min idle) still finishes')

  // cancel ownership
  try { await fax.cancelBatch('someone_else', 'A'); ok(false, 'other user cancel') } catch (e) { ok(e.code === 'not_found', 'cancel other user batch → not_found') }
  try { await fax.cancelBatch(chatId, 'A'); ok(false, 'finished cancel') } catch (e) { ok(e.code === 'not_running', 'cancel finished batch → not_running') }

  await client.db(db.databaseName).dropDatabase()
  await client.close()
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
