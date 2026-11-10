// Test helper: add/remove a hostedSms doc (TESTONLY-<chatId>) for a texting-only TEST_ account. Usage: node ... add|clean <chatId>
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
;(async () => {
  const [cmd, chatId] = process.argv.slice(2)
  const c = await MongoClient.connect(process.env.MONGO_URL), db = c.db(process.env.DB_NAME)
  const hs = db.collection('hostedSms'), id = `TESTONLY-${chatId}`
  if (cmd === 'add') {
    await hs.insertOne({ _id: id, chatId, phoneNumber: '+12125550177', plan: 'texting', status: 'loa', planNumber: null, paid: 200, emailedStatus: 'loa', createdAt: new Date(), updatedAt: new Date() })
    console.log('added', id)
  } else {
    const r = await hs.deleteOne({ _id: id }); console.log('deleted hs', r.deletedCount)
    const a = await db.collection('webAccounts').deleteOne({ _id: chatId, email: /^test_/i }).catch(() => ({ deletedCount: 'n/a' }))
    console.log('deleted acc (webAccounts)', a.deletedCount)
  }
  await c.close()
})()
