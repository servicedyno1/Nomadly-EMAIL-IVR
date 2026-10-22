// READ-ONLY: list every non-released Twilio number per brand with status + suspension details
const { MongoClient } = require('mongodb')
const { loadBrandEnv, parseBrandsArg, maskPhone } = require('./_brand_env')
;(async () => {
  const now = new Date()
  for (const brand of parseBrandsArg(process.argv)) {
    const env = loadBrandEnv(brand)
    const c = new MongoClient(env.MONGO_URL, { serverSelectionTimeoutMS: 20000 }); await c.connect()
    const db = c.db(env.DB_NAME)
    const docs = await db.collection('phoneNumbersOf').find({ 'val.numbers.provider': 'twilio' }).toArray()
    console.log(`\n== ${brand} (db=${env.DB_NAME})`)
    for (const d of docs) {
      for (const n of d.val?.numbers || []) {
        if (n.provider !== 'twilio' || n.status === 'released') continue
        const exp = new Date(n.expiresAt)
        const keys = Object.keys(n).filter(k => /suspend|expire|grace|migrat|autoRenew|_released/i.test(k))
        console.log(`chat=${d._id} ${maskPhone(n.phoneNumber)} status=${n.status} plan=${n.plan} exp=${String(n.expiresAt).slice(0, 10)} ${exp > now ? 'FUTURE' : 'PAST'} sub=${!!n.isSubNumber} | ${keys.map(k => `${k}=${JSON.stringify(n[k])}`).join(' ')}`)
      }
    }
    await c.close()
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
