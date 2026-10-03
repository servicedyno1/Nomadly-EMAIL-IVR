#!/usr/bin/env node
// One-off: seed a TEST reseller owner wallet + API key for dry-run endpoint testing.
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const OWNER = '999000111'
const LABEL = 'API-fix test reseller'
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  // Fund the test owner wallet (usdIn high enough to cover any dry-run price checks)
  await db.collection('walletOf').updateOne(
    { _id: OWNER },
    { $set: { usdIn: 100000, usdOut: 0 } },
    { upsert: true }
  )
  // Rotate any existing enabled key for this owner, then mint a fresh one
  await db.collection('resellerApiKeys').updateMany({ ownerChatId: OWNER, enabled: true }, { $set: { enabled: false, rotatedAt: new Date() } })
  const rawKey = `rsk_live_${crypto.randomBytes(24).toString('hex')}`
  await db.collection('resellerApiKeys').insertOne({
    _id: crypto.randomUUID(),
    keyHash: sha256(rawKey),
    keyPrefix: rawKey.slice(0, 16),
    ownerChatId: OWNER,
    label: LABEL,
    enabled: true,
    scopes: ['*'],
    createdAt: new Date(),
    lastUsedAt: null,
    requestCount: 0,
  })
  console.log('TEST_OWNER=' + OWNER)
  console.log('TEST_RESELLER_API_KEY=' + rawKey)
  await client.close()
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
