#!/usr/bin/env node
// ============================================================
// Idempotent seed for the RDP reseller-API E2E test fixtures.
// Seeds: (1) reseller API key nmdly_e2e_51573577f5db956c5c0cb039 (+owner wallet)
//        (2) an owned DO-RDP record  id=e2e-rdp-1  in vpsPlansOf
// so the backend testing agent can exercise D1/D2/D3 in a fresh pod.
// Safe to re-run. Reads creds from /app/backend/.env.
// ============================================================
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const RAW_KEY = 'nmdly_e2e_51573577f5db956c5c0cb039'
const KEY_ID = 'e2e-golden-key'
const OWNER = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '5590563715')
const RDP_ID = 'e2e-rdp-1'
const RDP_INSTANCE = 'rdp-11111111-2222-3333-4444-555555555555'
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing'); process.exit(1) }
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  // (1) reseller API key
  await db.collection('resellerApiKeys').updateOne(
    { _id: KEY_ID },
    { $set: {
      _id: KEY_ID, keyHash: sha256(RAW_KEY), keyPrefix: RAW_KEY.slice(0, 16),
      ownerChatId: OWNER, label: 'golden e2e sandbox key', enabled: true, scopes: ['*'],
      createdAt: new Date(), lastUsedAt: null, requestCount: 0,
    } },
    { upsert: true }
  )

  // owner wallet (funds so any billed dry-run path is happy)
  await db.collection('walletOf').updateOne(
    { _id: OWNER },
    { $setOnInsert: { _id: OWNER, usdIn: 1000, usdOut: 0 } },
    { upsert: true }
  )

  // (2) owned DO-RDP record. provider 'digitalocean-rdp' + rdp-* instanceId
  //     => rdpProviderForRecord() routes to the DO-RDP service (not Azure).
  await db.collection('vpsPlansOf').updateOne(
    { _id: RDP_ID },
    { $set: {
      _id: RDP_ID, vpsId: RDP_ID, chatId: OWNER,
      provider: 'digitalocean-rdp', instanceId: RDP_INSTANCE, host: null,
      region: 'EU', productId: 'rdp-2c-4g-nvme', plan: 'RDP 2 vCPU / 4 GB', planPrice: 25,
      osType: 'windows', osId: 'ws2022', isRDP: true, status: 'active',
      rootPasswordSecretId: null, source: 'e2e_seed',
      start_time: new Date(), timestamp: new Date(),
    } },
    { upsert: true }
  )

  const key = await db.collection('resellerApiKeys').findOne({ _id: KEY_ID }, { projection: { keyHash: 0 } })
  const rdp = await db.collection('vpsPlansOf').findOne({ _id: RDP_ID })
  console.log('Seeded reseller key:', JSON.stringify(key))
  console.log('Seeded RDP record  :', JSON.stringify({ id: rdp._id, provider: rdp.provider, instanceId: rdp.instanceId, isRDP: rdp.isRDP, osId: rdp.osId, chatId: rdp.chatId }))
  await client.close()
})().catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
