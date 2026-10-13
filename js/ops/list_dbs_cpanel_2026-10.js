/* eslint-disable no-console */
// READ-ONLY: list every DB on RESELLER_DB_URL and count cpanelAccounts (total/live).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

;(async () => {
  const client = await MongoClient.connect(process.env.RESELLER_DB_URL)
  const admin = client.db().admin()
  const { databases } = await admin.listDatabases()
  for (const d of databases) {
    try {
      const db = client.db(d.name)
      const cols = await db.listCollections().toArray()
      const hasCp = cols.find(c => c.name === 'cpanelAccounts')
      if (hasCp) {
        const n = await db.collection('cpanelAccounts').countDocuments({})
        const live = await db.collection('cpanelAccounts').countDocuments({ deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true } })
        console.log(`DB=${d.name} cpanelAccounts total=${n} live=${live}`)
      } else {
        console.log(`DB=${d.name} (no cpanelAccounts) collections=${cols.length}`)
      }
    } catch (e) { console.log(`DB=${d.name} ERR ${e.message}`) }
  }
  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
