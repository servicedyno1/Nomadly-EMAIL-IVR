#!/usr/bin/env node
// One-shot idempotent seed of the documented sandbox reseller API key + owner wallet
// so the backend testing agent (which reads memory/test_credentials.md) can auth.
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const RAW_KEY = 'nmdly_e2e_51573577f5db956c5c0cb039'
const KEY_ID = 'e2e-golden-key'
const OWNER = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '5590563715')
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing'); process.exit(1) }
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  await db.collection('resellerApiKeys').updateOne(
    { _id: KEY_ID },
    { $set: {
      _id: KEY_ID, keyHash: sha256(RAW_KEY), keyPrefix: RAW_KEY.slice(0, 16),
      ownerChatId: OWNER, label: 'golden e2e sandbox key', enabled: true, scopes: ['*'],
      createdAt: new Date(), lastUsedAt: null, requestCount: 0,
    } },
    { upsert: true }
  )

  // Owner wallet with a healthy USD balance so any billed dry-run/live flow has funds.
  await db.collection('walletOf').updateOne(
    { _id: OWNER },
    { $setOnInsert: { _id: OWNER, usdIn: 1000, usdOut: 0 } },
    { upsert: true }
  )

  const key = await db.collection('resellerApiKeys').findOne({ _id: KEY_ID }, { projection: { keyHash: 0 } })
  const wallet = await db.collection('walletOf').findOne({ _id: OWNER })
  console.log('Seeded key:', JSON.stringify(key))
  console.log('Owner wallet:', JSON.stringify(wallet))
  await client.close()
})().catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
