// Read-only audit: other accounts hit by the same faults. Run from a release dir.
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const since = new Date(Date.now() - 14 * 864e5)
  const ge = (d) => ({ $or: [{ timestamp: { $gte: d } }, { timestamp: { $gte: d.toISOString() } }] })
  // 1) per-minute charges that kept running: same account + destination, 6+ charges in one hour
  const runs = await db.collection('walletLedger').aggregate([
    { $match: { type: 'sip_per_minute', timestamp: { $gte: since } } },
    { $group: { _id: { c: '$chatId', d: '$destination', h: { $dateToString: { format: '%Y-%m-%dT%H', date: '$timestamp' } } }, n: { $sum: 1 }, amt: { $sum: '$amount' } } },
    { $match: { n: { $gte: 6 } } }, { $sort: { '_id.h': 1 } },
  ]).toArray()
  console.log('## long per-minute runs (14 d):', runs.length)
  for (const r of runs) {
    const t0 = new Date(r._id.h + ':00:00Z'), t1 = new Date(t0.getTime() + 2 * 3600e3)
    const log = await db.collection('phoneLogs').findOne({ chatId: r._id.c, type: 'outbound_sip', from: r._id.d, duration: { $gte: 300 }, $or: [{ timestamp: { $gte: t0, $lte: t1 } }, { timestamp: { $gte: t0.toISOString(), $lte: t1.toISOString() } }] })
    console.log(JSON.stringify(r), log ? `real long call ${log.duration}s` : 'NO matching long call')
  }
  // 2) softphone calls dialed as +<10 digits> (mis-read as international) in the last 3 days
  const bad = await db.collection('phoneLogs').aggregate([
    { $match: { type: 'outbound_sip', ...ge(new Date(Date.now() - 3 * 864e5)), from: { $regex: '^\\+[2-9]\\d{9}$' } } },
    { $group: { _id: '$chatId', n: { $sum: 1 }, charge: { $sum: '$charge' }, first: { $min: '$timestamp' }, last: { $max: '$timestamp' }, dests: { $addToSet: '$from' } } },
  ]).toArray()
  console.log('## mis-dialed 10-digit softphone calls (3 d):', JSON.stringify(bad))
  // 3) softphone calls cut at exactly 32 s since the engine route went live
  const cut = await db.collection('phoneLogs').aggregate([
    { $match: { type: 'outbound_sip', duration: { $in: [32, 33] }, ...ge(new Date('2026-11-15T22:40:00Z')) } },
    { $group: { _id: '$chatId', n: { $sum: 1 }, charge: { $sum: '$charge' } } },
  ]).toArray()
  console.log('## calls cut at 32 s:', JSON.stringify(cut))
  await c.close()
})().catch((e) => { console.error(e); process.exit(1) })
