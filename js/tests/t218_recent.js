// iter218: seed/clean a phoneLogs recent entry + set stale displayCallerId; or print ivrObData
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const [cmd, id] = process.argv.slice(2)
 if (cmd === 'seed') {
   await db.collection('phoneLogs').insertOne({ _id: 'T218_recent_' + id, chatId: id, type: 'ivr_outbound', to: '+14155550133', timestamp: new Date() })
   await db.collection('state').updateOne({ _id: id }, { $set: { ivrObData: { callerId: '+18336110236', displayCallerId: '+14155550989' } } })
 } else if (cmd === 'clean') await db.collection('phoneLogs').deleteOne({ _id: 'T218_recent_' + id })
 const s = await db.collection('state').findOne({ _id: id })
 console.log(cmd, 'action=', s?.action, 'ivrObData=', JSON.stringify(s?.ivrObData)); await mc.close() })()
