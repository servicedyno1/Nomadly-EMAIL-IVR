#!/usr/bin/env node
// SANDBOX-ONLY test fixtures for reseller hosting-management endpoints.
// Creates a throwaway reseller API key + two fake cpanelAccounts owned by a
// throwaway chatId. Safe to delete afterwards (node scripts/seed_sandbox_test.js --clean).
// NOTE: only meant to run on the dev/sandbox pod (SKIP_WEBHOOK_SYNC=true).

require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const cpAuth = require('/app/js/cpanel-auth')

const OWNER = '990009900'                       // throwaway wallet owner
const RAW_KEY = 'rsk_sandbox_test_key_0001'     // fixed so we can hand it to the tester
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const CLEAN = process.argv.includes('--clean')

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const keys = db.collection('resellerApiKeys')
  const accts = db.collection('cpanelAccounts')

  const KEY_ID = 'sbxtest-key-990009900'
  const IDS = ['sbxtestgold', 'sbxtesttrial']

  if (CLEAN) {
    await keys.deleteOne({ _id: KEY_ID })
    await accts.deleteMany({ _id: { $in: IDS } })
    console.log('🧹 Removed sandbox test key + accounts')
    await client.close(); return
  }

  const enc = cpAuth.encrypt('SandboxFakePass123')

  await keys.updateOne(
    { _id: KEY_ID },
    { $set: { _id: KEY_ID, keyHash: sha256(RAW_KEY), ownerChatId: OWNER, label: 'SANDBOX TEST — safe to delete', enabled: true, createdAt: new Date() } },
    { upsert: true }
  )

  const base = {
    chatId: OWNER,
    cpPass_encrypted: enc.encrypted, cpPass_iv: enc.iv, cpPass_tag: enc.tag,
    createdAt: new Date(), suspended: false, deleted: false,
    addonDomains: [{ domain: 'blog-sbxtest.com', createdAt: new Date() }],
    whmHost: null,
  }
  await accts.updateOne({ _id: 'sbxtestgold' }, { $set: { ...base, _id: 'sbxtestgold', cpUser: 'sbxtestgold', domain: 'sbxtestgold.com', plan: 'Golden Anti-Red HostPanel (1-Month)' } }, { upsert: true })
  await accts.updateOne({ _id: 'sbxtesttrial' }, { $set: { ...base, _id: 'sbxtesttrial', cpUser: 'sbxtesttrial', domain: 'sbxtesttrial.com', plan: 'Premium Anti-Red HostPanel (1-Week)' } }, { upsert: true })

  console.log('✅ Seeded sandbox test fixtures')
  console.log('   API key   :', RAW_KEY)
  console.log('   Owner     :', OWNER)
  console.log('   Gold acct :', 'sbxtestgold  (plan: Golden Anti-Red HostPanel (1-Month))')
  console.log('   Trial acct:', 'sbxtesttrial (plan: Premium Anti-Red HostPanel (1-Week))')
  await client.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
