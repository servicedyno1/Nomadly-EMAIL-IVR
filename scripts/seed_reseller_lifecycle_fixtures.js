#!/usr/bin/env node
// Seed reseller lifecycle edge-states for owner 999000111 so the new hosting/vps/rdp
// state + grace + renewable fields and /renewals ?include_terminated can be tested on
// a sandbox pod. Idempotent.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const OWNER = '999000111'
;(async () => {
  const c = new MongoClient(process.env.MONGO_URL)
  await c.connect()
  const db = c.db(process.env.DB_NAME || 'test')
  const cp = db.collection('cpanelAccounts')
  const vps = db.collection('vpsPlansOf')
  const now = Date.now()
  const H = 3600000, D = 86400000

  // Hosting — GRACE: expired 10h ago, suspended, not deleted → state 'grace' (delete_at = expiry+48h).
  await cp.updateOne({ _id: 'apigrace01' }, {
    $set: {
      _id: 'apigrace01', cpUser: 'apigrace01', chatId: OWNER, domain: 'apigrace.com',
      plan: 'Golden Anti-Red HostPanel (1-Month)', addonDomains: [],
      expiryDate: new Date(now - 10 * H), suspended: true, suspendedAt: new Date(now - 10 * H),
      suspendedReason: 'plan_expired', autoRenew: true,
      autoRenewLastError: 'insufficient_funds', autoRenewLastAttemptAt: new Date(now - 10 * H),
      autoRenewNextAttemptAt: new Date(now + 1 * H),
      createdAt: new Date(now - 40 * D), source: 'test_fixture_lifecycle',
    },
    $unset: { deleted: '', deletedAt: '', terminatedOnWhm: '' },
  }, { upsert: true })

  // Hosting — SUSPENDED past grace: expired 5 days ago, suspended, not deleted → state 'suspended'.
  await cp.updateOne({ _id: 'apisusp01' }, {
    $set: {
      _id: 'apisusp01', cpUser: 'apisusp01', chatId: OWNER, domain: 'apisusp.com',
      plan: 'Premium Anti-Red HostPanel (1-Month)', addonDomains: [],
      expiryDate: new Date(now - 5 * D), suspended: true, suspendedAt: new Date(now - 5 * D),
      suspendedReason: 'plan_expired', autoRenew: false,
      createdAt: new Date(now - 40 * D), source: 'test_fixture_lifecycle',
    },
    $unset: { deleted: '', deletedAt: '', terminatedOnWhm: '' },
  }, { upsert: true })

  // Hosting — TERMINATED: deleted 2 days ago → state 'terminated', renewable false.
  await cp.updateOne({ _id: 'apiterm01' }, {
    $set: {
      _id: 'apiterm01', cpUser: 'apiterm01', chatId: OWNER, domain: 'apiterm.com',
      plan: 'Premium Anti-Red HostPanel (1-Month)', addonDomains: [],
      expiryDate: new Date(now - 4 * D), suspended: true,
      deleted: true, deletedAt: new Date(now - 2 * D), deletedBy: 'reseller_api',
      terminationNote: 'expired_grace', autoRenew: false,
      createdAt: new Date(now - 40 * D), source: 'test_fixture_lifecycle',
    },
  }, { upsert: true })

  // VPS — TERMINATED (CANCELLED 1 day ago) → renewable false, only in /renewals?include_terminated.
  await vps.updateOne({ _id: 'vps-term-1' }, {
    $set: {
      _id: 'vps-term-1', vpsId: 'vps-term-1', chatId: OWNER, isRDP: false, status: 'CANCELLED',
      productId: 's-1vcpu-1gb', planPrice: 18, plan: 'Cloud VPS 10', instanceId: 'do-inst-term',
      region: 'nyc1', osType: 'ubuntu', end_time: new Date(now - 1 * D),
      cancelledAt: new Date(now - 1 * D), cancelReason: 'auto_renewal_failed',
      durationMonths: 1, source: 'test_fixture_lifecycle',
    },
  }, { upsert: true })

  // RDP — GRACE (expired, powered off, pending deletion in 2 days) → renewable true.
  await vps.updateOne({ _id: 'rdp-grace-1' }, {
    $set: {
      _id: 'rdp-grace-1', vpsId: 'rdp-grace-1', chatId: OWNER, isRDP: true, status: 'EXPIRED_GRACE',
      productId: 'standard-1m', planPrice: 56, plan: 'Standard RDP', instanceId: 'rdp-inst-grace',
      provider: 'digitalocean-rdp', region: 'nyc1', osType: 'windows', osId: 'ws2022',
      end_time: new Date(now - 1 * D), expired_at: new Date(now - 1 * D),
      grace_until: new Date(now + 2 * D), durationMonths: 1, source: 'test_fixture_lifecycle',
    },
    $unset: { cancelReason: '' },
  }, { upsert: true })

  console.log('seeded lifecycle fixtures for owner', OWNER, ': apigrace01(grace) apisusp01(suspended) apiterm01(terminated) vps-term-1(terminated) rdp-grace-1(grace)')
  await c.close()
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
