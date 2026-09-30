#!/usr/bin/env node
// TEST FIXTURE SEED — reproduces the reseller File-Manager/SSL CPANEL_AUTH_FAILURE
// bug locally so the fix can be verified end-to-end through the reseller HTTP API.
//
//   • Reseller API key (deterministic, printed below) → resellerApiKeys
//   • cPanel account `namea3a5` on the LIVE server 68.183.77.106 with a
//     DELIBERATELY WRONG cpPass, so user Basic Auth is refused (401 login page →
//     CPANEL_AUTH_FAILURE) — exactly the reported condition. The fix's WHM-root
//     fallback then heals it using create_user_session-class auth.
//
// Reads run LIVE on any pod; writes are dry-run on the sandbox (isLive()===false).
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const RAW_KEY = 'rsk_live_testfix_namea3a5_filemgr_ssl_2026'
const OWNER = '5590563715'
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  await db.collection('resellerApiKeys').updateOne(
    { keyHash: sha256(RAW_KEY) },
    { $set: {
        keyHash: sha256(RAW_KEY), keyPrefix: RAW_KEY.slice(0, 16), ownerChatId: OWNER,
        label: 'TESTFIX namea3a5 filemgr/ssl', enabled: true, scopes: ['*'],
        createdAt: new Date(), lastUsedAt: null, requestCount: 0,
      },
      $setOnInsert: { _id: crypto.randomUUID() } },
    { upsert: true }
  )

  await db.collection('cpanelAccounts').updateOne(
    { _id: 'namea3a5' },
    { $set: {
        _id: 'namea3a5', chatId: OWNER, cpUser: 'namea3a5', domain: 'namewords.sbs',
        whmHost: '68.183.77.106',
        // WRONG on purpose — the stale-password condition from the bug report.
        cpPass: 'DELIBERATELY-WRONG-STALE-PASSWORD-to-reproduce-401',
        plan: 'Premium Anti-Red HostPanel (1-Week)',
        suspended: false, deleted: false,
        createdAt: new Date('2026-09-18T00:00:00Z'),
        expiryDate: new Date('2026-09-25T00:00:00Z'),
        source: 'testfix_seed',
      } },
    { upsert: true }
  )

  const key = await db.collection('resellerApiKeys').findOne({ keyHash: sha256(RAW_KEY) })
  const acct = await db.collection('cpanelAccounts').findOne({ _id: 'namea3a5' })
  console.log('Seeded resellerApiKeys:', key._id, 'owner', key.ownerChatId, 'enabled', key.enabled)
  console.log('Seeded cpanelAccounts:', acct._id, 'chatId', acct.chatId, 'host', acct.whmHost, 'domain', acct.domain)
  console.log('\nRAW RESELLER API KEY (for tests):', RAW_KEY)
  await client.close()
  process.exit(0)
})().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
