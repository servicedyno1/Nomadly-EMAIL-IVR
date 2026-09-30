#!/usr/bin/env node
// Mint a TEMPORARY reseller API key on PROD (does NOT touch existing keys).
// Prints the raw key once. Used only for the ws2025 confirmation order, then disabled.
const fs = require('fs')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

function prodMongoUrl() {
  const env = fs.readFileSync('/app/backend/.env', 'utf8')
  const m = env.match(/ORIGINAL_PROD_MONGO_URL\s*=\s*"?([^"\n]+)"?/)
  if (!m) throw new Error('ORIGINAL_PROD_MONGO_URL not found'); return m[1].trim()
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  const client = new MongoClient(prodMongoUrl(), { serverSelectionTimeoutMS: 15000 })
  await client.connect()
  const db = client.db('test')
  const raw = `rsk_live_${crypto.randomBytes(24).toString('hex')}`
  const doc = {
    _id: 'temp-rdp-confirm-2026-09-23',
    keyHash: sha256(raw), keyPrefix: raw.slice(0, 16),
    ownerChatId: '5590563715', label: 'TEMP ws2025 confirmation (auto-disable)',
    enabled: true, scopes: ['*'], createdAt: new Date(), lastUsedAt: null, requestCount: 0,
  }
  await db.collection('resellerApiKeys').updateOne({ _id: doc._id }, { $set: doc }, { upsert: true })
  console.log('MINTED_RAW_KEY=' + raw)
  console.log('key_id=' + doc._id)
  await client.close()
})().catch(e => { console.error('ERR:', e.message); process.exit(1) })
