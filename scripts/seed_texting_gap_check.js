// Local check for Landline-to-Texting counting + expiringSoon. Usage: node scripts/seed_texting_gap_check.js seed|clean
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const { MongoClient } = require('mongodb')
const ALICE = '5000000000000001', DAY = 86400000
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL), db = c.db(process.env.DB_NAME)
  const hs = db.collection('hostedSms'), pn = db.collection('phoneNumbersOf')
  await hs.deleteMany({ _id: /^GAPCHK-/ })
  await pn.updateOne({ _id: ALICE }, { $pull: { 'val.numbers': { gapCheck: true } } })
  if (process.argv[2] === 'seed') {
    const now = Date.now()
    await hs.insertMany([
      { _id: 'GAPCHK-1', chatId: ALICE, phoneNumber: '+12125550101', plan: 'texting', status: 'active', planNumber: null, nextBillAt: new Date(now + 3 * DAY), paid: 200, createdAt: new Date(), updatedAt: new Date() },
      { _id: 'GAPCHK-2', chatId: ALICE, phoneNumber: '+12125550102', plan: 'texting', status: 'review', planNumber: null, paid: 200, createdAt: new Date(), updatedAt: new Date() },
      { _id: 'GAPCHK-3', chatId: ALICE, phoneNumber: '+12125550103', plan: 'texting', status: 'cancelled', planNumber: null, paid: 0, createdAt: new Date(), updatedAt: new Date() },
    ])
    await pn.updateOne({ _id: ALICE }, { $push: { 'val.numbers': { $each: [
      { gapCheck: true, phoneNumber: '+19995550001', plan: 'starter', status: 'active', expiresAt: new Date(now - 2 * DAY).toISOString() },
      { gapCheck: true, phoneNumber: '+19995550002', plan: 'starter', status: 'released', expiresAt: new Date(now + 2 * DAY).toISOString() },
      { gapCheck: true, phoneNumber: '+19995550003', plan: 'starter', status: 'suspended', expiresAt: new Date(now + 2 * DAY).toISOString() },
    ] } } })
    await db.collection('phoneLogs').deleteMany({ gapCheck: true })
    await db.collection('phoneLogs').insertOne({ gapCheck: true, chatId: ALICE, phoneNumber: '+12125550101', from: '+13105550199', to: '+12125550101', type: 'sms', direction: 'inbound', body: 'gap check text', hosted: true, timestamp: new Date() })
  } else await db.collection('phoneLogs').deleteMany({ gapCheck: true })
  console.log('done', process.argv[2])
  await c.close()
})()
