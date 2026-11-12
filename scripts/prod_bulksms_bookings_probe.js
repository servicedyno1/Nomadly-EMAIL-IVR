// read-only: recent BulkSMS bookings, campaigns, eSIM purchases/inventory, incidents. ENVF=<backend.env> node prod_bulksms_bookings_probe.js [hours]
const fs = require('fs'), { MongoClient } = require('mongodb')
const env = {}; for (const l of fs.readFileSync(process.env.ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
;(async () => {
  const h = Number(process.argv[2] || 24), since = new Date(Date.now() - h * 3600e3)
  const cl = await MongoClient.connect(env.BULK_ESIM_MONGO_URL || env.MONGO_URL), db = cl.db(env.BULK_ESIM_DB || env.DB_NAME)
  const J = (x) => JSON.stringify(x, (k, v) => /secret|token|password|apiKey|iccid|activation|qr/i.test(k) ? '***' : v)
  console.log('## BOOKINGS'); for (const b of await db.collection('bsBookings').find({ $or: [{ at: { $gte: since } }, { createdAt: { $gte: since } }, { updatedAt: { $gte: since } }] }).limit(20).toArray()) console.log(J(b).slice(0, 700))
  console.log('## CAMPAIGNS'); for (const c of await db.collection('bsCampaigns').find({ $or: [{ createdAt: { $gte: since } }, { at: { $gte: since } }] }).limit(15).toArray()) console.log(J({ _id: c._id, cid: c.cid, status: c.status, total: c.total ?? c.recipients?.length, paid: c.paid, price: c.price, prepaid: c.prepaid, payStatus: c.payStatus, bookingId: c.bookingId, at: c.createdAt || c.at, check: c.numberCheck || c.lookup }).slice(0, 600))
  console.log('## PAYMENTS'); for (const p of await db.collection('bsPayments').find({ at: { $gte: since } }).limit(15).toArray()) console.log(J(p).slice(0, 400))
  console.log('## ESIMS'); for (const e of await db.collection('bsEsims').find({}).sort({ _id: 1 }).toArray()) console.log(e._id, e.role, e.status, e.health, e.msisdn, e.createdAt?.toISOString?.() || '', e.boughtFor || e.reason || '')
  console.log('## INCIDENTS/AUDIT'); for (const c of ['bsIncidents', 'bsAudit']) for (const x of await db.collection(c).find({ at: { $gte: since } }).sort({ at: -1 }).limit(25).toArray()) console.log(c, J(x).slice(0, 350))
  console.log('## DEMAND'); for (const d of await db.collection('bsDemand').find({}).sort({ _id: -1 }).limit(5).toArray()) console.log(J(d).slice(0, 400))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
