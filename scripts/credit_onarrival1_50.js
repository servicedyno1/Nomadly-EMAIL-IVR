// One-shot admin credit for @onarrival1 — $50 USD.
// Uses the same wire-format as _index.js:8500-8523 (addFundsTo → transactions
// row) so the credit shows up in their /txns history exactly like an in-bot
// admin /credit would.
// Run: /opt/node22/bin/node /app/scripts/credit_onarrival1_50.js
'use strict'

require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const OWNER = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '5590563715') // @onarrival1
const AMOUNT_USD = 50.00

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing'); process.exit(1) }
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  const walletOf = db.collection('walletOf')
  const transactions = db.collection('transactions')
  const nameOf = db.collection('nameOf')

  const before = await walletOf.findOne({ _id: OWNER })
  const beforeBal = before ? ((before.usdIn || 0) - (before.usdOut || 0)) : 0
  console.log(`Owner: ${OWNER} (@${(await nameOf.findOne({ _id: OWNER }))?.val || 'unknown'})`)
  console.log(`Wallet before: $${beforeBal.toFixed(2)}`)

  // Atomic $inc on usdIn (same shape addFundsTo → atomicIncrement uses).
  // walletOf._id is always a String for this project.
  const upd = await walletOf.updateOne(
    { _id: OWNER },
    { $inc: { usdIn: AMOUNT_USD } },
    { upsert: true }
  )
  console.log(`Wallet updated: matched=${upd.matchedCount} modified=${upd.modifiedCount} upserted=${upd.upsertedCount}`)

  // Audit row (matches _index.js:8505-8519 admin-credit shape).
  const txnId = `TXN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
  await transactions.insertOne({
    _id: txnId,
    chatId: OWNER,
    type: 'admin-credit',
    amount: AMOUNT_USD,
    currency: 'USD',
    status: 'completed',
    metadata: {
      adminChatId: OWNER,          // self-credit (main agent action on behalf of admin)
      adminName: 'onarrival1',
      note: 'Manual credit via scripts/credit_onarrival1_50.js (reseller endpoint testing top-up)',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const after = await walletOf.findOne({ _id: OWNER })
  const afterBal = (after.usdIn || 0) - (after.usdOut || 0)
  console.log(`Wallet after:  $${afterBal.toFixed(2)}   (delta: +$${(afterBal - beforeBal).toFixed(2)})`)
  console.log(`Transaction id: ${txnId}`)
  await client.close()
})().catch((e) => { console.error(e); process.exit(1) })
