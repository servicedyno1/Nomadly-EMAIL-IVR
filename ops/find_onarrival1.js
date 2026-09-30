// READ-ONLY: resolve @onarrival1 chatId + wallet. No writes.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  const targets = ['onarrival1', '@onarrival1', 'onarrival']
  const rx = new RegExp('onarrival', 'i')

  // 1) nameOf collection
  try {
    const hits = await db.collection('nameOf').find({ $or: [
      { val: rx }, { username: rx }, { name: rx }
    ] }).limit(10).toArray()
    console.log('nameOf hits:', JSON.stringify(hits, null, 2))
  } catch (e) { console.log('nameOf err', e.message) }

  // 2) scan a few likely collections for username field
  for (const coll of ['users', 'usersOf', 'userProfiles', 'escalations', 'aiSupportLogs']) {
    try {
      const hit = await db.collection(coll).find({ username: rx }).limit(3).toArray()
      if (hit.length) console.log(`${coll} hits:`, JSON.stringify(hit.map(h => ({ _id: h._id, chatId: h.chatId, username: h.username })), null, 2))
    } catch (e) { /* collection may not exist */ }
  }

  // 3) admin chatId wallet (support is often admin)
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const w = await db.collection('walletOf').findOne({ _id: String(adminId) })
  console.log(`walletOf[admin ${adminId}]:`, JSON.stringify(w))

  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
