/*global require, process, console */
// Test helper: seed a click count onto a shortener link's key, in the SAME DB
// the reseller API uses (RESELLER_DB_URL + RESELLER_DB_NAME||DB_NAME, falling
// back to MONGO_URL). Used by the rename regression to prove click migration
// without needing real public redirects.
//   usage: node js/tests/seed_shortener_clicks.js <domain> <slug> <count>
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

const [, , domainArg, slugArg, countArg] = process.argv
if (!domainArg || !slugArg || countArg === undefined) {
  console.error('usage: node js/tests/seed_shortener_clicks.js <domain> <slug> <count>')
  process.exit(2)
}
const url = process.env.RESELLER_DB_URL || process.env.MONGO_URL
const dbName = process.env.RESELLER_DB_NAME || process.env.DB_NAME
const key = `${String(domainArg).toLowerCase().replaceAll('.', '@')}/${slugArg}`

;(async () => {
  const client = new MongoClient(url)
  try {
    await client.connect()
    const db = client.db(dbName)
    await db.collection('clicksOn').updateOne({ _id: key }, { $set: { val: Number(countArg) } }, { upsert: true })
    const doc = await db.collection('clicksOn').findOne({ _id: key })
    console.log(`SEEDED clicksOn[${key}] = ${doc && doc.val}`)
    process.exit(0)
  } catch (e) {
    console.error('SEED FAILED:', e.message)
    process.exit(1)
  } finally {
    await client.close().catch(() => {})
  }
})()
