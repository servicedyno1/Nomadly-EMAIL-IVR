require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const ids = ['990218001','990218002','990218003','990218004','990218005','990218006','990218007','990218008','990218009']
 const a = await db.collection('webCallerIds').deleteMany({ _id: { $in: ['+14155550988','+14155550989','+14155550990','+14155550991','+14155550977'] }, chatId: { $in: ids } })
 const b = await db.collection('callerIdUses').deleteMany({ chatId: { $in: ids } })
 const c = await db.collection('state').deleteMany({ _id: { $in: ids.map(i => 'ivrTrialUsed_' + i) } })
 const d = await db.collection('phoneLogs').countDocuments({ chatId: { $in: ids } })
 console.log('webCallerIds', a.deletedCount, 'uses', b.deletedCount, 'trialKeys', c.deletedCount, 'phoneLogs left', d); await mc.close() })()
