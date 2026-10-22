require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
;(async()=>{ const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const re = /^9903000\d\d$/
 for (const c of ['state','walletOf','phoneNumbersOf','nameOf']) { const r = await db.collection(c).deleteMany({ _id: re }); console.log(c, r.deletedCount) }
 for (const c of ['telnyxRegSessions','telnyxPendingOrders','userConversion']) { const r = await db.collection(c).deleteMany({ chatId: re }); console.log(c, r.deletedCount) }
 await mc.close() })()
