// READ-ONLY prod probe: what are BulkSMS users complaining about? (run on droplet with app-main env)
const { MongoClient } = require('mongodb')
const url = (process.env.MONGO_URL || '').replace(/^"|"$/g, '')
;(async () => {
  const c = new MongoClient(url); await c.connect(); const db = c.db('test')
  const since = new Date(Date.now() - 45 * 86400000)
  const out = {}
  const cols = (await db.listCollections().toArray()).map(x => x.name)
  out.smsCollections = cols.filter(n => /sms|campaign|support|escalat|ticket/i.test(n))
  const camp = db.collection('smsCampaigns')
  out.campaigns = { total: await camp.countDocuments(), last45d: await camp.countDocuments({ createdAt: { $gte: since } }) }
  out.statusBreakdown = await camp.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 }, sent: { $sum: '$sentCount' }, failed: { $sum: '$failedCount' }, total: { $sum: '$totalContacts' } } }]).toArray()
  out.sampleFailed = await camp.find({ createdAt: { $gte: since }, failedCount: { $gt: 0 } }).project({ chatId: 1, status: 1, sentCount: 1, failedCount: 1, totalContacts: 1, lastError: 1, errors: 1, createdAt: 1, appVersion: 1, gapTime: 1 }).sort({ createdAt: -1 }).limit(8).toArray()
  for (const name of ['smsAppErrors', 'smsAppUsers', 'smsAppDevices', 'smsAppDiagnostics']) if (cols.includes(name)) {
    out[name] = { n: await db.collection(name).countDocuments(), sample: await db.collection(name).find({}).sort({ _id: -1 }).limit(3).toArray() }
  }
  // support transcripts mentioning sms app
  for (const name of cols.filter(n => /support|escalat|ticket|conversation|chatHistory/i.test(n))) {
    const col = db.collection(name)
    const one = await col.findOne({})
    const textFields = Object.keys(one || {}).filter(k => typeof one[k] === 'string' || Array.isArray(one[k]))
    out['support:' + name] = { n: await col.countDocuments(), fields: Object.keys(one || {}).slice(0, 15) }
    try {
      const rx = /bulk ?sms|sms app|sms campaign|apk|nomadly sms|smadav sms/i
      const docs = await col.find({ $or: textFields.map(f => ({ [f]: rx })) }).sort({ _id: -1 }).limit(12).toArray()
      out['support:' + name].matches = docs.map(d => JSON.stringify(d).slice(0, 700))
    } catch (e) { out['support:' + name].err = e.message }
  }
  console.log(JSON.stringify(out, null, 1))
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
