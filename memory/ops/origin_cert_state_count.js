// Read-only: count originCertState rows written by the backfill/self-heal, per brand DB
require('dotenv').config({ path: process.env.ENV_PATH })
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const rows = await db.collection('originCertState').find({}).project({ via: 1, installedAt: 1 }).toArray()
  const by = rows.reduce((m, r) => { m[r.via] = (m[r.via] || 0) + 1; return m }, {})
  console.log(`${process.env.DB_NAME}: originCertState=${rows.length} ${JSON.stringify(by)}`)
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
