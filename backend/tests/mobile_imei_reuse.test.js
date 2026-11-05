// Live-mode check (no purchase): mobileOffer() must find an IMEI already on file, so ordering turns on without a new setting.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
delete process.env.SPENZA_TEXT_LINE_IMEI
const { MongoClient } = require('mongodb')
const ES = require('/app/js/spenza.js')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  await db.collection('spenzaConfig').deleteOne({ _id: 'mobileImei' })
  ES.init({ db, log: () => {}, tell: async () => null, noTimers: true })
  const o = await ES.mobileOffer()
  const cached = await db.collection('spenzaConfig').findOne({ _id: 'mobileImei' })
  console.log('offer', JSON.stringify(o), 'cached', !!cached && String(cached.imei).length === 15)
  await db.collection('spenzaConfig').deleteOne({ _id: 'mobileImei' })
  const ok = o.available === true && o.price === 75 && !!cached
  console.log(ok ? 'PASS' : 'FAIL'); await c.close(); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e.message); process.exit(1) })
