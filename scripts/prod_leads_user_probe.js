// read-only: find a user by @username in a brand DB, wallet balance, language, recent lead jobs. ENVF=<backend.env> node prod_leads_user_probe.js <username>
const fs = require('fs'), { MongoClient } = require('mongodb')
const env = {}; for (const l of fs.readFileSync(process.env.ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
;(async () => {
  const u = process.argv[2].replace(/^@/, ''), cl = await MongoClient.connect(env.MONGO_URL), db = cl.db(env.DB_NAME)
  console.log('BRAND', env.CHAT_BOT_BRAND, 'DB', env.DB_NAME, 'BOT', env.CHAT_BOT_NAME || env.BOT_USERNAME || '')
  const n = await db.collection('nameOf').find({ val: { $regex: `^@?${u}$`, $options: 'i' } }).toArray()
  for (const x of n) {
    const id = x._id, w = await db.collection('walletOf').findOne({ _id: id }), st = await db.collection('state').findOne({ _id: id }, { projection: { userLanguage: 1, action: 1 } })
    console.log('USER', id, x.val, 'wallet', JSON.stringify(w && { usdIn: w.usdIn, usdOut: w.usdOut, bal: (w.usdIn || 0) - (w.usdOut || 0) }), 'lang', st?.userLanguage, 'action', st?.action)
    for (const j of await db.collection('leadJobs').find({ chatId: { $in: [id, Number(id), String(id)] } }).sort({ createdAt: -1 }).limit(5).toArray()) console.log('JOB', j.jobId, j.status, j.carrier, j.phonesToGenerate, j.countryCode, (j.areaCodes || []).length, j.price, j.walletDeducted, j.paymentCoin, j.createdAt, (j.results || []).length)
  }
  console.log('ACTIVE JOBS', await db.collection('leadJobs').countDocuments({ status: { $in: ['running', 'interrupted', 'resume_error'] } }))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
