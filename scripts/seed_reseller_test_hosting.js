#!/usr/bin/env node
// One-off: seed TEST cpanel accounts for reseller owner 999000111 (dry-run API tests).
// addonDomains stored as canonical lowercase STRINGS.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const OWNER = '999000111'
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const col = db.collection('cpanelAccounts')
  const now = new Date()
  const exp = new Date(now.getTime() + 10 * 86400000)
  const accounts = [
    {
      _id: 'apifix01', cpUser: 'apifix01', chatId: OWNER,
      domain: 'apifixhost.com', plan: 'Golden Anti-Red HostPanel (1-Month)',
      addonDomains: ['addon-apifix.com'],   // canonical STRING shape
      expiryDate: exp, autoRenew: true, suspended: false,
      createdAt: now, source: 'test_fixture_2026_10',
    },
    {
      _id: 'apifix02', cpUser: 'apifix02', chatId: OWNER,
      domain: 'apifixpremium.com', plan: 'Premium Anti-Red HostPanel (1-Month)',
      addonDomains: [], expiryDate: exp, autoRenew: true, suspended: false,
      createdAt: now, source: 'test_fixture_2026_10',
    },
  ]
  for (const a of accounts) {
    await col.updateOne({ _id: a._id }, { $set: a, $unset: { deleted: '', deletedAt: '' } }, { upsert: true })
    console.log('seeded cpanelAccount', a._id, '→', a.domain, '(', a.plan, ')')
  }
  await client.close()
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
