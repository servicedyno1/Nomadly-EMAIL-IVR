#!/usr/bin/env node
// One-off: seed a COMPLETED shortener-activated domain for reseller owner 999000111 so the
// URL-shortener link endpoints can be tested on a sandbox pod (where real domain activation
// stays in dry-run and never reaches 'completed'). Idempotent.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const OWNER = '999000111'
const DOMAIN = 'golink-test.com'
const CNAME_TARGET = 'nomadly.up.railway.app'
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const now = new Date()

  // 1) Mark the domain owned by the reseller (both shapes the API checks).
  await db.collection('domainsOf').updateOne({ _id: OWNER }, { $set: { [DOMAIN.replaceAll('.', '@')]: true } }, { upsert: true })
  await db.collection('domainsOf').updateOne(
    { chatId: OWNER, domainName: DOMAIN },
    { $set: { chatId: OWNER, domainName: DOMAIN, registrar: 'test', registeredAt: now, source: 'test_fixture_shortener' } },
    { upsert: true },
  )

  // 2) A COMPLETED shortener activation for that domain.
  await db.collection('shortenerActivations').updateOne(
    { _id: DOMAIN },
    { $set: { _id: DOMAIN, chatId: OWNER, domain: DOMAIN, status: 'completed', server: CNAME_TARGET, recordType: 'CNAME', lang: 'en', createdAt: now, updatedAt: now, completedAt: now, source: 'test_fixture_shortener' } },
    { upsert: true },
  )

  console.log(`seeded shortener domain ${DOMAIN} (status=completed, target=${CNAME_TARGET}) for owner ${OWNER}`)
  await client.close()
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
