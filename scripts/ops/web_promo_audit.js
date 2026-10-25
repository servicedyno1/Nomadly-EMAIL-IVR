// Read-only: how many bot-marketing records point at CloudIVR web accounts (ids >= 5e15). Run on the droplet from the app dir.
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const webRe = /^5\d{15}$/
  for (const [col, field] of [['userConversion', 'chatId'], ['scheduledEvents', 'chatId'], ['abandonedCarts', 'chatId'], ['browseTracking', 'chatId'], ['welcomeCoupons', 'chatId'], ['winbackCampaigns', 'chatId'], ['welcomeBonuses', 'chatId'], ['promoOptOut', '_id'], ['broadcastJobs', 'chatIds']]) {
    const n = await db.collection(col).countDocuments({ [field]: webRe }).catch(() => 'n/a')
    console.log(col, n)
  }
  console.log('webNotifications promo rows', await db.collection('webNotifications').countDocuments({ text: /stoppromos/ }))
  process.exit(0)
})()
