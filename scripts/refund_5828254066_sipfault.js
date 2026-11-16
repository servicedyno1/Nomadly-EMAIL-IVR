// One-off refund: @iamthebestbusiness (5828254066), calls broken by our faults on 2026-11-15 23:19–23:51 UTC.
// 9 mis-dialed calls (10 digits sent as +<10 digits>) 9 × $0.48, 1 connection fee + 30 × $0.50 per-minute charges of a call
// that had already ended, 2 calls cut at 32 s (softphone ACK lost) 2 × $0.165. Idempotent. Run from a release dir: node _r.js [--apply]
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const CID = '5828254066', AMOUNT = 19.68, ID = 'TXN-20261115-REFUND-SIPFAULT-5828254066'
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: CID }); return (w.usdIn || 0) - (w.usdOut || 0) }
  console.log('before', (await bal()).toFixed(4))
  if (await db.collection('transactions').findOne({ _id: ID })) { console.log('already refunded'); return c.close() }
  if (!process.argv.includes('--apply')) { console.log('dry run — would credit', AMOUNT); return c.close() }
  const now = new Date().toISOString()
  await db.collection('transactions').insertOne({ _id: ID, chatId: CID, type: 'admin-credit', amount: AMOUNT, currency: 'USD', status: 'completed',
    metadata: { adminChatId: String(process.env.TELEGRAM_ADMIN_CHAT_ID), note: 'Refund: SIP calls that failed because of a fault on our side (15 Nov 23:19–23:51 UTC)' }, createdAt: now, updatedAt: now })
  await db.collection('walletOf').updateOne({ _id: CID }, { $inc: { usdIn: AMOUNT } })
  const after = await bal()
  await db.collection('walletLedger').insertOne({ _id: require('crypto').randomUUID(), chatId: CID, type: 'admin_credit', amount: AMOUNT, currency: 'usd', balanceAfter: +after.toFixed(4),
    description: 'Refund: SIP calls that failed because of a fault on our side', callRef: ID, timestamp: new Date() }).catch((e) => console.log('ledger note skipped:', e.message))
  console.log('after', after.toFixed(4), ID)
  await c.close()
})().catch((e) => { console.error(e); process.exit(1) })
