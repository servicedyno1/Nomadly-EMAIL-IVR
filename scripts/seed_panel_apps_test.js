#!/usr/bin/env node
// Seed a HostPanel test account for the Apps tab (sandbox only): wpapps01 / PIN 246810 on the
// WEEKLY plan (MySQL now open to weekly) + one READY WordPress app and one FAILED app.
// Fake account (not on WHM). Panel installs on this pod are dry-run (SKIP_WEBHOOK_SYNC=true).
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const cpAuth = require('../js/cpanel-auth')

const USER = 'wpapps01'
const PIN = '246810'
;(async () => {
  if (process.env.SKIP_WEBHOOK_SYNC !== 'true') throw new Error('refusing to seed: not a dev sandbox (SKIP_WEBHOOK_SYNC!=true)')
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME)
  const enc = cpAuth.encrypt('Fake-Pass-123!')
  const now = new Date()
  await db.collection('cpanelAccounts').updateOne({ _id: USER }, {
    $set: {
      cpUser: USER, cpPass_encrypted: enc.encrypted, cpPass_iv: enc.iv, cpPass_tag: enc.tag,
      pinHash: await cpAuth.hashPin(PIN), chatId: '999100777', domain: 'wpapps-demo.com',
      plan: 'Premium Anti-Red (1-Week)', expiryDate: new Date(now.getTime() + 6 * 86400000),
      createdAt: now, suspended: false, autoRenew: false, source: 'test_fixture_phase4', __seedTestAccount: true,
    },
    $unset: { deleted: '', deletedAt: '' },
  }, { upsert: true })
  const apps = db.collection('hostingApps')
  await apps.deleteMany({ username: USER })
  await apps.insertMany([
    {
      _id: 'wp_seedready01', username: USER, chatId: '999100777', domain: 'wpapps-demo.com', app: 'wordpress', path: '',
      state: 'ready', stage: 'ready', liveKey: `${USER}|`, title: 'Demo Site', adminEmail: 'owner@wpapps-demo.com',
      siteUrl: 'https://wpapps-demo.com', adminUrl: 'https://wpapps-demo.com/wp-admin/', adminUser: 'admin_demo',
      adminPassEnc: cpAuth.encrypt('Demo-Admin-Pass-2026!'), version: '6.8.3', dbName: `${USER}_wpdemo`, dbUser: `${USER}_wpdemo`,
      docRoot: `/home/${USER}/public_html`, via: 'panel', createdAt: new Date(now.getTime() - 3600000), installedAt: new Date(now.getTime() - 3500000),
    },
    {
      _id: 'wp_seedfail01', username: USER, chatId: '999100777', domain: 'wpapps-demo.com', app: 'wordpress', path: 'shop',
      state: 'failed', stage: 'failed', title: null, siteUrl: 'https://wpapps-demo.com/shop', adminUrl: 'https://wpapps-demo.com/shop/wp-admin/',
      error: 'db_create_failed: You have reached the maximum allowed number of databases.', via: 'panel',
      createdAt: new Date(now.getTime() - 7200000), failedAt: new Date(now.getTime() - 7100000),
    },
  ])
  console.log(`seeded ${USER} (PIN ${PIN}, weekly plan) + 2 apps (ready "", failed "shop")`)
  await client.close()
})().catch((e) => { console.error('seed failed:', e.message); process.exit(1) })
