#!/usr/bin/env node
// ============================================================
// Seed / rotate a Reseller API key  (scripts/seed_reseller_key.js)
// ------------------------------------------------------------
// Creates an API key in the `resellerApiKeys` collection, bound to a wallet
// owner account (default: @onarrival1 / chatId 5590563715). The RAW key is
// printed ONCE — only its sha256 hash is stored, so copy it now.
//
// Usage:
//   node scripts/seed_reseller_key.js                # create (fails if one already exists)
//   node scripts/seed_reseller_key.js --rotate       # disable existing + create a new one
//   node scripts/seed_reseller_key.js --owner 12345 --label "Acme reseller"
// ============================================================

require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return (v && !v.startsWith('--')) ? v : true
}

const OWNER = String(arg('owner', process.env.TELEGRAM_ADMIN_CHAT_ID || '5590563715'))
const LABEL = String(arg('label', '@onarrival1 reseller'))
const ROTATE = !!arg('rotate', false)

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  if (!process.env.MONGO_URL) { console.error('MONGO_URL missing in backend/.env'); process.exit(1) }
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const keys = db.collection('resellerApiKeys')

  // Confirm the owner has a wallet (so billing works)
  const wallet = await db.collection('walletOf').findOne({ _id: OWNER })
  const bal = wallet ? ((wallet.usdIn || 0) - (wallet.usdOut || 0)) : 0

  const existing = await keys.find({ ownerChatId: OWNER, enabled: true }).toArray()
  if (existing.length && !ROTATE) {
    console.log(`\n⚠️  An ENABLED reseller key already exists for owner ${OWNER} (${existing.length} key(s)).`)
    console.log(`   Re-run with --rotate to disable the old key(s) and mint a new one.\n`)
    console.log(`   Existing key ids: ${existing.map(k => k._id).join(', ')}`)
    await client.close()
    process.exit(0)
  }

  if (ROTATE && existing.length) {
    await keys.updateMany({ ownerChatId: OWNER, enabled: true }, { $set: { enabled: false, rotatedAt: new Date() } })
    console.log(`\n🔄 Disabled ${existing.length} existing key(s) for owner ${OWNER}.`)
  }

  const rawKey = `rsk_live_${crypto.randomBytes(24).toString('hex')}`
  const doc = {
    _id: crypto.randomUUID(),
    keyHash: sha256(rawKey),
    keyPrefix: rawKey.slice(0, 16),          // for identification in logs/UI (not secret)
    ownerChatId: OWNER,
    label: LABEL,
    enabled: true,
    scopes: ['*'],                            // full access (per product decision)
    createdAt: new Date(),
    lastUsedAt: null,
    requestCount: 0,
  }
  await keys.insertOne(doc)

  console.log('\n============================================================')
  console.log('✅ Reseller API key created')
  console.log('============================================================')
  console.log(`Owner chatId : ${OWNER}  (${LABEL})`)
  console.log(`Wallet balance: $${bal.toFixed(2)}`)
  console.log(`Key id        : ${doc._id}`)
  console.log('')
  console.log('🔑 RAW API KEY (shown ONCE — copy it now):')
  console.log(`   ${rawKey}`)
  console.log('')
  console.log('Use it as either header:')
  console.log(`   Authorization: Bearer ${rawKey}`)
  console.log(`   X-API-Key: ${rawKey}`)
  console.log('============================================================\n')

  await client.close()
})().catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
