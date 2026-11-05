require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const ids = process.argv.slice(3), mode = process.argv[2]
 for (const id of ids) { for (const c of ['state','walletOf','nameOf','chatIdOf','userConversion']) await db.collection(c).deleteMany({ _id: id })
  await db.collection('userConversion').deleteMany({ chatId: id }); await db.collection('resumableSessions').deleteMany({ _id: 'resume_' + id }); await db.collection('welcomeBonuses').deleteMany({ chatId: id }); await db.collection('transactions').deleteMany({ chatId: id })
  if (mode === 'seed') { await db.collection('state').insertOne({ _id: id, userLanguage: 'fa', action: 'none', firstSessionIntentDone: true }); await db.collection('walletOf').insertOne({ _id: id, usdIn: 0, usdOut: 0 }) } }
 console.log(mode, ids); await mc.close() })()
