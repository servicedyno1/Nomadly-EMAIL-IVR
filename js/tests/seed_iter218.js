// iter218 seed/cleanup: node js/tests/seed_iter218.js seed|clean
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const BIZ = '990218001', PRO = '990218002', TRIAL = '990218003', FA = '990218004', EN2 = '990218005', FABIZ = '990218006', FAPRO = '990218007', FATRIAL = '990218008', OTHERBIZ = '990218009'
const ALL = [BIZ, PRO, TRIAL, FA, EN2, FABIZ, FAPRO, FATRIAL, OTHERBIZ]
const num = (n, plan) => ({ phoneNumber: n, plan, planPrice: 120, status: 'active', provider: 'telnyx', type: 'local', country: 'US', autoRenew: false, purchaseDate: new Date(), expiresAt: new Date(Date.now() + 20 * 86400000), sipUsername: 'gen218' + plan, sipPassword: 'x', features: {} })
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  for (const id of ALL) {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion', 'phoneNumbersOf']) await db.collection(c).deleteMany({ _id: id })
    for (const c of ['userConversion', 'welcomeBonuses', 'transactions', 'callerIdUses', 'callerIdDefaults', 'webCallerIds']) await db.collection(c).deleteMany({ chatId: id })
    await db.collection('resumableSessions').deleteMany({ _id: 'resume_' + id })
    await db.collection('state').deleteMany({ _id: `ivrTrialUsed_${id}` })
  }
  if (process.argv[2] === 'seed') {
    for (const [id, lang] of [[BIZ, 'en'], [PRO, 'en'], [TRIAL, 'en'], [FA, 'fa'], [EN2, 'en'], [FABIZ, 'fa'], [FAPRO, 'fa'], [FATRIAL, 'fa'], [OTHERBIZ, 'en']]) {
      await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'none', firstSessionIntentDone: true })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 0, usdOut: 0 })
      await db.collection('userConversion').updateOne({ chatId: id }, { $set: { chatId: id, firstDepositBonusAwarded: true } }, { upsert: true })
    }
    await db.collection('phoneNumbersOf').insertOne({ _id: BIZ, val: { numbers: [num('+18336110227', 'business')] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: PRO, val: { numbers: [num('+18336110228', 'pro')] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: FABIZ, val: { numbers: [num('+18336110236', 'business')] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: FAPRO, val: { numbers: [num('+18336110237', 'pro')] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: OTHERBIZ, val: { numbers: [num('+18336110239', 'business')] } })
    // OTHERBIZ owns +14155550988 -> FABIZ attesting it should get number_taken
    await db.collection('webCallerIds').replaceOne({ _id: '+14155550988' }, { _id: '+14155550988', chatId: OTHERBIZ, status: 'verified', method: 'attested', createdAt: Date.now() }, { upsert: true })
  }
  console.log(process.argv[2], ALL); await mc.close()
})()
