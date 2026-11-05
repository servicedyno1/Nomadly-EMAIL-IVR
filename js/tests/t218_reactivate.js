require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const ids = ['990218001','990218002','990218006','990218007','990218009']
 const r = await db.collection('phoneNumbersOf').updateMany({ _id: { $in: ids } }, { $set: { 'val.numbers.0.status': 'active' } })
 console.log('reactivated', r.modifiedCount); await mc.close() })()
