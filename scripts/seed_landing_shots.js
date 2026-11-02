// Sample data for landing-page screenshots on the preview test account (Alice). Re-runnable; ids start with "shot_".
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const chatId = '5000000000000001', line = await db.collection('esimLines').findOne({ _id: 'mn_b5893a901b4f' })
  const me = line.phoneNumber, t = (m) => new Date(Date.now() - m * 60000).toISOString()
  const logs = [
    ['shot_1', '+18885550134', 'inbound', 'Your verification code is 482913. It expires in 10 minutes. Don’t share it with anyone.', 3],
    ['shot_2', '+18885550171', 'inbound', 'Sample Shop: your sign-in code is 7731.', 42],
    ['shot_3', '+14155550142', 'inbound', 'Hi! Is the apartment still available for viewing on Saturday?', 95],
    ['shot_4', '+14155550142', 'outbound', 'Yes, Saturday at 11am works. See you then.', 90],
  ]
  await db.collection('phoneLogs').deleteMany({ _id: { $in: logs.map(l => l[0]) } })
  await db.collection('phoneLogs').insertMany(logs.map(([_id, other, direction, body, ago]) => ({ _id, chatId, phoneNumber: me, from: direction === 'inbound' ? other : me, to: direction === 'inbound' ? me : other, type: direction === 'inbound' ? 'sms' : 'sms_out', direction, body, esim: line._id, charge: direction === 'inbound' ? 0 : 0.05, status: direction === 'inbound' ? undefined : 'delivered', timestamp: t(ago) })))
  for (const [phone, name] of [['+18885550134', 'Sample Bank'], ['+18885550171', 'Sample Shop'], ['+14155550142', 'Jordan Lee']]) {
    await db.collection('webContacts').updateOne({ chatId, phone }, { $set: { name }, $setOnInsert: { createdAt: new Date() } }, { upsert: true })
  }
  await db.collection('webThreadReads').deleteMany({ chatId, number: me, contact: '+18885550134' })
  console.log('seeded', me); await c.close()
})()
