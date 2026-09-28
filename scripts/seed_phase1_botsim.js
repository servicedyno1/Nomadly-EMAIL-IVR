#!/usr/bin/env node
// ============================================================
// Phase 1 bot-sim fixtures (SANDBOX ONLY)
// ============================================================
// Seeds two users into local Mongo `test` so the testing agent can verify
// Phase 1 point #3 ("📊 Your services:" glance line on the bot home):
//   - RETURNING customer (chatId 777000123): owns 1 active number + 1 hosting
//     account + 1 domain  => home greeting MUST show the glance line.
//   - NEW customer       (chatId 777000888): onboarded, owns nothing
//     => home greeting MUST NOT show the glance line.
//
// #4 (Check DNS Active/Inactive) needs NO seed — it is driven by a
// `dns_check_<domain>` callback on any domain (real => Active, fake => Inactive).
//
// Safe: only runs against the local sandbox Mongo (SKIP_WEBHOOK_SYNC=true).
// Idempotent. Clean up with:  node scripts/seed_phase1_botsim.js --clean
// ============================================================

require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

const RC = '777000123' // returning customer (owns services)
const NU = '777000888' // new customer (owns nothing)
const CLEAN = process.argv.includes('--clean')

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing'); process.exit(1) }
  if (!/localhost|127\.0\.0\.1/.test(process.env.MONGO_URL)) {
    console.error('❌ Refusing to seed: MONGO_URL is not local. This script is sandbox-only.')
    process.exit(1)
  }
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  const users = db.collection('users')
  const state = db.collection('state')
  const walletOf = db.collection('walletOf')
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  const cpanelAccounts = db.collection('cpanelAccounts')
  const domainsOf = db.collection('domainsOf')

  if (CLEAN) {
    await users.deleteMany({ _id: { $in: [RC, NU] } })
    await state.deleteMany({ _id: { $in: [RC, NU] } })
    await walletOf.deleteMany({ _id: { $in: [RC, NU] } })
    await phoneNumbersOf.deleteMany({ _id: { $in: [RC, NU, Number(RC), Number(NU)] } })
    await domainsOf.deleteMany({ _id: { $in: [RC, NU, Number(RC), Number(NU)] } })
    await cpanelAccounts.deleteMany({ _id: 'phase1-host-777' })
    console.log('🧹 Removed Phase 1 bot-sim fixtures')
    await client.close(); return
  }

  // ── Both users: onboarded + English + a wallet (so home greeting renders) ──
  for (const id of [RC, NU]) {
    await users.updateOne({ _id: id },
      { $set: { _id: id, hasCompletedOnboarding: true, onboardingCompletedAt: new Date() } },
      { upsert: true })
    await state.updateOne({ _id: id },
      { $set: { _id: id, userLanguage: 'en' } },
      { upsert: true })
    await walletOf.updateOne({ _id: id },
      { $setOnInsert: { _id: id, usdIn: id === RC ? 500 : 5, usdOut: 0 } },
      { upsert: true })
  }

  // ── RETURNING customer services (drives all 3 glance-line chips) ──
  // 1) active phone number — seed BOTH string and numeric _id (keying-safe)
  const numbersDoc = { numbers: [{ phoneNumber: '+15551230001', status: 'active', provider: 'telnyx', plan: 'Pro' }] }
  await phoneNumbersOf.updateOne({ _id: RC }, { $set: { _id: RC, ...numbersDoc } }, { upsert: true })
  await phoneNumbersOf.updateOne({ _id: Number(RC) }, { $set: { _id: Number(RC), ...numbersDoc } }, { upsert: true })

  // 2) hosting account (cpanelAccounts.countDocuments uses string chatId)
  await cpanelAccounts.updateOne({ _id: 'phase1-host-777' }, { $set: {
    _id: 'phase1-host-777', chatId: RC, cpUser: 'phase1host', domain: 'phase1host.com',
    plan: 'Golden Anti-Red HostPanel (1-Month)', suspended: false, deleted: false,
    terminatedOnWhm: false, createdAt: new Date(),
  } }, { upsert: true })

  // 3) purchased domain — domainsOf doc keyed by domain (dots stored as @).
  //    Seed BOTH string and numeric _id (getPurchasedDomains keying-safe).
  //    example.com resolves (=> #4 "Active"); phase1host.com does not (=> #4 "Inactive").
  const domDoc = {
    'phase1host@com': { registrar: 'openprovider', createdAt: new Date() },
    'example@com': { registrar: 'openprovider', createdAt: new Date() },
  }
  await domainsOf.updateOne({ _id: RC }, { $set: { _id: RC, ...domDoc } }, { upsert: true })
  await domainsOf.updateOne({ _id: Number(RC) }, { $set: { _id: Number(RC), ...domDoc } }, { upsert: true })

  // ── Report ──
  const hostCount = await cpanelAccounts.countDocuments({ chatId: RC, terminatedOnWhm: { $ne: true }, deleted: { $ne: true } })
  console.log('✅ Seeded Phase 1 bot-sim fixtures')
  console.log(`   RETURNING customer chatId=${RC}: numbers(active)=1, hosting=${hostCount}, domains=1`)
  console.log(`   NEW customer       chatId=${NU}: onboarded, no services`)
  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
