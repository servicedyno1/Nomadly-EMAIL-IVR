// Deletes bot promo messages (they all end with the "/stoppromos" footer) from CloudIVR web inboxes.
// Usage (from the app dir): node scripts/ops/clear_web_promos.js          → dry run, counts only
//                           node scripts/ops/clear_web_promos.js --apply  → delete
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const col = c.db(process.env.DB_NAME).collection('webNotifications')
  const q = { chatId: /^5\d{15}$/, text: /\/stoppromos/ }
  const n = await col.countDocuments(q)
  const accounts = (await col.distinct('chatId', q)).length
  if (process.argv.includes('--apply')) {
    const r = await col.deleteMany(q)
    console.log(JSON.stringify({ found: n, accounts, deleted: r.deletedCount }))
  } else console.log(JSON.stringify({ found: n, accounts, dryRun: true }))
  await c.close()
})().catch(e => { console.error('ERROR', e.message); process.exit(1) })
