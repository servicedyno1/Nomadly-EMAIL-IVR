// Removes tester-made texts (TEST_ prefix) from Alice's sample data so landing screenshots stay clean.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  for (const n of await db.listCollections().toArray()) {
    for (const f of ['text', 'body', 'message', 'Message_Body']) {
      const r = await db.collection(n.name).deleteMany({ [f]: { $regex: '^TEST_' } }).catch(() => ({ deletedCount: 0 }))
      if (r.deletedCount) console.log(n.name, f, r.deletedCount)
    }
  }
  await c.close(); process.exit(0)
})()
