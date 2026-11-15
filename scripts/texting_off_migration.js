// One-off: texting is an opt-in add-on, so switch it off on every existing calling number (run per brand, env loaded):
//   node scripts/texting_off_migration.js [--apply] [--keep-after=<ISO>]
// Dry run by default. Numbers bought after --keep-after (the new "Calls + texting" flow) keep their choice. Fax-only lines live elsewhere.
require('dotenv').config()
const { MongoClient } = require('mongodb')
const APPLY = process.argv.includes('--apply')
const keepAfter = (process.argv.find(a => a.startsWith('--keep-after=')) || '').split('=')[1] || null

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const col = c.db(process.env.DB_NAME).collection('phoneNumbersOf')
  const s = { accounts: 0, numbers: 0, switchedOff: 0, alreadyOff: 0, keptNew: 0 }
  for await (const doc of col.find({ 'val.numbers.0': { $exists: true } }, { projection: { 'val.numbers': 1 } })) {
    s.accounts++
    for (const n of doc.val.numbers || []) {
      s.numbers++
      if (n.features?.sms === false) { s.alreadyOff++; continue }
      if (keepAfter && n.purchaseDate && n.purchaseDate > keepAfter) { s.keptNew++; continue }
      s.switchedOff++
      if (APPLY) await col.updateOne({ _id: doc._id }, { $set: { 'val.numbers.$[n].features.sms': false } }, { arrayFilters: [{ 'n.phoneNumber': n.phoneNumber }] })
    }
  }
  console.log(JSON.stringify({ db: process.env.DB_NAME, apply: APPLY, keepAfter, ...s }))
  await c.close()
})().catch(e => { console.error(e.message); process.exit(1) })
