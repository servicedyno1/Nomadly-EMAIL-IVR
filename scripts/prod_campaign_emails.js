// read-only: were campaign-summary emails sent?
const { MongoClient } = require('mongodb')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const logs = await db.collection('webEmailLog').find({ type: 'campaignDone', at: { $gte: new Date(Date.now() - 3 * 86400e3) } }).sort({ at: -1 }).limit(12).toArray()
  console.log('campaign emails 3d:', logs.length); for (const l of logs) console.log(' ', l.chatId, l._id, 'ok=', l.ok, l.at?.toISOString?.(), (l.subject || '').slice(0, 60))
  await cl.close()
})()
