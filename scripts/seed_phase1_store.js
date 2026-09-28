#!/usr/bin/env node
// ============================================================
// Phase 1 storefront fixtures (SANDBOX ONLY)
// ============================================================
// Seeds hosting plans (cpanelAccounts) for a web store test user so the
// testing agent can verify Phase 1 point #5 (lifecycle expiry chips on
// "My Plans": green / amber / red + renewal hint).
//
// The web user itself is created via the normal /api/store/auth/signup flow:
//   email:    phase1tester@example.com
//   password: Phase1Test!234
// This script looks that user up by email and links 3 plans to its webUserId.
//
// Idempotent. Clean up:  node scripts/seed_phase1_store.js --clean
// ============================================================

require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

const EMAIL = 'phase1tester@example.com'
const CLEAN = process.argv.includes('--clean')
const IDS = ['phase1-green', 'phase1-amber', 'phase1-red']
const DAY = 24 * 3600 * 1000

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing'); process.exit(1) }
  if (!/localhost|127\.0\.0\.1/.test(process.env.MONGO_URL)) {
    console.error('❌ Refusing to seed: MONGO_URL is not local. Sandbox-only.'); process.exit(1)
  }
  const c = new MongoClient(process.env.MONGO_URL)
  await c.connect()
  const db = c.db(process.env.DB_NAME || 'test')
  const accts = db.collection('cpanelAccounts')

  if (CLEAN) {
    await accts.deleteMany({ _id: { $in: IDS } })
    console.log('🧹 Removed Phase 1 store fixtures')
    await c.close(); return
  }

  const user = await db.collection('webUsers').findOne({ email: EMAIL })
  if (!user) {
    console.error(`❌ Web user ${EMAIL} not found. Sign it up first:`)
    console.error(`   curl -s -X POST http://localhost:8001/api/store/auth/signup -H 'Content-Type: application/json' -d '{"email":"${EMAIL}","password":"Phase1Test!234"}'`)
    await c.close(); process.exit(1)
  }
  const webUserId = user._id
  const now = new Date()

  const base = { webUserId, chatId: '777000123', deleted: false, addonDomains: [], createdAt: now }
  const rows = [
    { _id: 'phase1-green', cpUser: 'phase1green', domain: 'green-plan.com',
      plan: 'Golden Anti-Red HostPanel (1-Month)', suspended: false,
      expiryDate: new Date(now.getTime() + 30 * DAY) },   // green "30d left"
    { _id: 'phase1-amber', cpUser: 'phase1amber', domain: 'amber-plan.com',
      plan: 'Premium Anti-Red HostPanel (1-Month)', suspended: false,
      expiryDate: new Date(now.getTime() + 3 * DAY) },    // amber "Expires in 3d" + hint
    { _id: 'phase1-red', cpUser: 'phase1red', domain: 'red-plan.com',
      plan: 'Premium Anti-Red HostPanel (1-Week)', suspended: true,
      expiryDate: new Date(now.getTime() - 2 * DAY) },    // red "Expired" + hint
  ]
  for (const r of rows) {
    await accts.updateOne({ _id: r._id }, { $set: { ...base, ...r } }, { upsert: true })
  }

  console.log(`✅ Seeded 3 Phase 1 store plans for webUserId=${webUserId} (${EMAIL})`)
  console.log('   green-plan.com (30d left), amber-plan.com (Expires in 3d), red-plan.com (Expired, suspended)')
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
