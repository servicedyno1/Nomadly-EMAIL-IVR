// One-off: CloudIVR web test account with complimentary API access + a small wallet credit, so the owner can
// send one real SMS through the API. Credentials + key are sent only to the admin Telegram chat.
//   node scripts/setup_api_test_account.js
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const crypto = require('crypto')
const axios = require('axios')
const bcrypt = require('bcryptjs')
const { MongoClient } = require('mongodb')
const ID = 5999999999999102, SID = String(ID), EMAIL = 'api-test@cloudivr.net', CREDIT = 25

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const password = `Api-${crypto.randomBytes(6).toString('base64url')}#26`
  const now = new Date()
  const ex = await db.collection('webAccounts').findOne({ _id: ID })
  if (ex) await db.collection('webAccounts').updateOne({ _id: ID }, { $set: { passwordHash: await bcrypt.hash(password, 12) }, $inc: { tokenVersion: 1 } })
  else await db.collection('webAccounts').insertOne({ _id: ID, email: EMAIL, name: 'API Test', passwordHash: await bcrypt.hash(password, 12), tokenVersion: 0, qa: true, createdAt: now, lastLoginAt: now })
  await db.collection('state').updateOne({ _id: SID }, { $setOnInsert: { userLanguage: 'en', webAccount: true } }, { upsert: true })
  await db.collection('nameOf').updateOne({ _id: SID }, { $setOnInsert: { val: 'API Test' } }, { upsert: true })
  await db.collection('apiAccess').updateOne({ _id: SID }, { $set: { grant: true, until: new Date(Date.now() + 30 * 86400000), autoRenew: false, grantedBy: 'admin', grantNote: 'Owner API test account 2026-11-24', startedAt: now } }, { upsert: true })
  const credited = await db.collection('transactions').findOne({ _id: 'admin-credit-api-test-2026-11-24' })
  if (!credited) {
    await db.collection('walletOf').updateOne({ _id: SID }, { $inc: { usdIn: CREDIT } }, { upsert: true })
    await db.collection('transactions').insertOne({ _id: 'admin-credit-api-test-2026-11-24', chatId: SID, type: 'admin-credit', amount: CREDIT, currency: 'USD', status: 'completed', metadata: { note: 'Owner API SMS test', channel: 'web' }, createdAt: now, updatedAt: now })
  }
  await db.collection('apiKeys').updateMany({ chatId: SID, revokedAt: null }, { $set: { revokedAt: now } })
  const key = `civr_live_${crypto.randomBytes(24).toString('base64url')}`
  await db.collection('apiKeys').insertOne({ _id: `key_${crypto.randomBytes(8).toString('hex')}`, chatId: SID, name: 'Owner test', hash: crypto.createHash('sha256').update(key).digest('hex'), last4: key.slice(-4), createdAt: now, revokedAt: null })
  const w = await db.collection('walletOf').findOne({ _id: SID })
  const bal = (w.usdIn || 0) - (w.usdOut || 0)
  const base = 'https://cloudivr.net/cloudivr-web'
  const text = `🔑 <b>CloudIVR API test account</b>\n\nLogin: <code>${EMAIL}</code>\nPassword: <code>${password}</code>\nWallet: $${bal.toFixed(2)} · API access until ${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}\n\nAPI key (shown once):\n<code>${key}</code>\n\nSend one real text ($1):\n<pre>curl -X POST ${base}/v1/sms \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to":"+1YOURMOBILE","text":"CloudIVR API test"}'</pre>\nDelete this message after saving the key.`
  await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID, text, parse_mode: 'HTML' }, { timeout: 15000 })
  if (process.argv.includes('--print-key')) console.log('KEY', key)
  console.log(`[ApiTest] account ${SID} ready, wallet $${bal.toFixed(2)}, key …${key.slice(-4)} sent to admin chat`)
  await c.close(); process.exit(0)
})().catch(e => { console.error(e.response?.data || e); process.exit(1) })
