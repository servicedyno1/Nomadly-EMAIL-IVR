// Read-only forensic: was nseu77f4 (or the other 2 deleted accounts) admin-suspended
// or expired-normally? Look at deletedBy/suspendedBy/suspendedFrom/suspendReason
// and the timestamps to distinguish.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  for (const id of ['nseu77f4', 'onetcc73', 'ameraad9']) {
    const doc = await db.collection('cpanelAccounts').findOne({ _id: id })
    if (!doc) { console.log(id, 'MISSING'); continue }
    console.log(`\n=== ${id} ===`)
    console.log(JSON.stringify({
      _id: doc._id,
      domain: doc.domain,
      plan: doc.plan,
      createdAt: doc.createdAt,
      expiryDate: doc.expiryDate,
      suspended: doc.suspended,
      suspendedAt: doc.suspendedAt,
      suspendedBy: doc.suspendedBy,
      suspendedFrom: doc.suspendedFrom,
      suspendReason: doc.suspendReason,
      deleted: doc.deleted,
      deletedAt: doc.deletedAt,
      deletedBy: doc.deletedBy,
      cancelledByUser: doc.cancelledByUser,
      cancelledFrom: doc.cancelledFrom,
      whmTerminatePending: doc.whmTerminatePending,
      addonDomains: doc.addonDomains || [],
    }, null, 2))
  }

  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
