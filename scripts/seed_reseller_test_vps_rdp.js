#!/usr/bin/env node
// Seed VPS + RDP records under reseller owner 999000111 so the manual-renew endpoints
// (/vps/:id/renew, /rdp/:id/renew) are testable on a sandbox pod. Idempotent.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const OWNER = '999000111'
;(async () => {
  const c = new MongoClient(process.env.MONGO_URL)
  await c.connect()
  const db = c.db(process.env.DB_NAME || 'test')
  const future = new Date(Date.now() + 10 * 86400000)
  await db.collection('vpsPlansOf').updateOne({ _id: 'vps-test-1' }, {
    $set: { _id: 'vps-test-1', vpsId: 'vps-test-1', chatId: OWNER, isRDP: false, status: 'RUNNING', productId: 's-1vcpu-1gb', planPrice: 18, plan: 'Cloud VPS 10', instanceId: 'do-inst-123', region: 'nyc1', osType: 'ubuntu', end_time: future, durationMonths: 1, source: 'test_fixture_renew' },
    $unset: { cancelReason: '', grace_until: '', expired_at: '' },
  }, { upsert: true })
  await db.collection('vpsPlansOf').updateOne({ _id: 'rdp-test-1' }, {
    $set: { _id: 'rdp-test-1', vpsId: 'rdp-test-1', chatId: OWNER, isRDP: true, status: 'RUNNING', productId: 'standard-1m', planPrice: 56, plan: 'Standard RDP', instanceId: 'rdp-inst-456', region: 'nyc1', osType: 'windows', osId: 'ws2022', end_time: future, durationMonths: 1, source: 'test_fixture_renew' },
    $unset: { cancelReason: '', grace_until: '', expired_at: '' },
  }, { upsert: true })
  console.log('seeded vps-test-1 (VPS, planPrice 18) + rdp-test-1 (RDP, standard-1m $56) for owner', OWNER)
  await c.close()
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
