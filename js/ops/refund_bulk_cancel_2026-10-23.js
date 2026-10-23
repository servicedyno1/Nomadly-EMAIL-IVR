// One-off goodwill refund (owner-approved 2026-10-23): calls that kept billing after @draggadem876 cancelled
// Bulk IVR campaign eafefe7c. Idempotent (fixed transaction id). Run inside a release dir:
//   node js/ops/refund_bulk_cancel_2026-10-23.js /opt/nomadly/shared/app-main/backend.env [--apply]
require('dotenv').config({ path: process.argv[2] || 'backend/.env' })
const { MongoClient } = require('mongodb')
const axios = require('axios')
const { logTransaction } = require('../transaction-id.js')

const CHAT = '8666352410'
const AMOUNT = 1.95
const TX_ID = 'REFUND-BULKCANCEL-eafefe7c'
const MSG = '💚 <b>Refund: $1.95</b>\n\nSorry about that — 4 calls from your cancelled Bulk IVR campaign kept running for a few minutes after you cancelled and were charged. We refunded <b>$1.95</b> to your wallet.\n\nFrom now on, ❌ Cancel ends every call still playing your message right away. Calls already transferred to you keep going.'

;(async () => {
  const apply = process.argv.includes('--apply')
  const c = new MongoClient(process.env.MONGO_URL); await c.connect()
  const db = c.db(process.env.DB_NAME)
  if (await db.collection('transactions').findOne({ _id: TX_ID })) { console.log('ALREADY REFUNDED — nothing to do'); return c.close() }
  const w = await db.collection('walletOf').findOne({ _id: CHAT })
  console.log(`DB=${process.env.DB_NAME} balance before $${((w?.usdIn || 0) - (w?.usdOut || 0)).toFixed(2)}`)
  if (!apply) { console.log('DRY RUN — pass --apply'); return c.close() }
  await db.collection('walletOf').updateOne({ _id: CHAT }, { $inc: { usdIn: AMOUNT } })
  await logTransaction(db, { transactionId: TX_ID, chatId: CHAT, type: 'refund', amount: AMOUNT, currency: 'USD', status: 'completed', metadata: { reason: 'Bulk IVR calls billed after cancel', campaignId: 'eafefe7c-a066-4b5a-bf8a-cc165e056de4', approvedBy: 'owner' } })
  const w2 = await db.collection('walletOf').findOne({ _id: CHAT })
  console.log(`balance after $${((w2?.usdIn || 0) - (w2?.usdOut || 0)).toFixed(2)}`)
  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: CHAT, text: MSG, parse_mode: 'HTML' }, { timeout: 15000 })
    console.log('user notified')
  } catch (e) { console.log('notify failed:', e.response?.data?.description || e.message) }
  await c.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
