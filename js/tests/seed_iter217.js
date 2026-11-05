// iter217 seed/cleanup: node js/tests/seed_iter217.js seed|clean
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const BIZ = '990217001', PRO = '990217002', TRIAL = '990217003', FA = '990217004', EN2 = '990217005'
const ALL = [BIZ, PRO, TRIAL, FA, EN2]
const num = (n, plan) => ({ phoneNumber: n, plan, planPrice: 120, status: 'active', provider: 'telnyx', type: 'local', country: 'US', autoRenew: false, purchaseDate: new Date(), expiresAt: new Date(Date.now() + 20 * 86400000), sipUsername: 'gen217' + plan, sipPassword: 'x', features: {} })
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  for (const id of ALL) {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion', 'phoneNumbersOf']) await db.collection(c).deleteMany({ _id: id })
    for (const c of ['userConversion', 'welcomeBonuses', 'transactions', 'callerIdUses', 'callerIdDefaults', 'webCallerIds']) await db.collection(c).deleteMany({ chatId: id })
    await db.collection('resumableSessions').deleteMany({ _id: 'resume_' + id })
    await db.collection('state').deleteMany({ _id: `ivrTrialUsed_${id}` })
  }
  if (process.argv[2] === 'seed') {
    for (const [id, lang] of [[BIZ, 'en'], [PRO, 'en'], [TRIAL, 'en'], [FA, 'fa'], [EN2, 'en']]) {
      await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'none', firstSessionIntentDone: true })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 0, usdOut: 0 })
      await db.collection('userConversion').updateOne({ chatId: id }, { $set: { chatId: id, firstDepositBonusAwarded: true } }, { upsert: true })
    }
    await db.collection('phoneNumbersOf').insertOne({ _id: BIZ, val: { numbers: [num('+18336110217', 'business')] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: PRO, val: { numbers: [num('+18336110218', 'pro')] } })
  }
  console.log(process.argv[2], ALL); await mc.close()
})()
