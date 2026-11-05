// iter217: seed/clean a fake SIP test credential (no Telnyx) for /phone/test UI. node seed_ptest_iter217.js seed|clean
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  await db.collection('testCredentials').deleteMany({ chatId: 'T217_ptest' }); await db.collection('callerIdUses').deleteMany({ chatId: 'T217_ptest' })
  if (process.argv[2] === 'seed') await db.collection('testCredentials').insertOne({ chatId: 'T217_ptest', sipUsername: 'T217ptestuser', sipPassword: 'T217pw', lastOtp: '217917', callsMade: 0, expired: false, createdAt: new Date() })
  console.log(process.argv[2]); await mc.close() })()
