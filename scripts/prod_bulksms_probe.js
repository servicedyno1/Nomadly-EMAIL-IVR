// read-only: BulkSMS eSIM lines + test-SMS/reply activity (production). Usage: node prod_bulksms_probe.js [hours]
const { MongoClient } = require('mongodb')
;(async () => {
  const H = Number(process.argv[2] || 18), since = new Date(Date.now() - H * 3600e3)
  const cl = await MongoClient.connect(process.env.BULK_ESIM_MONGO_URL || process.env.MONGO_URL), db = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME)
  const lines = await db.collection('bsEsims').find({}, { projection: { phone: 1, phoneNumber: 1, status: 1, iccid: 1, account: 1, owner: 1, chatId: 1, health: 1, replacedBy: 1, createdAt: 1 } }).toArray()
  console.log('LINES', lines.length)
  for (const l of lines) console.log(' ', JSON.stringify({ id: l._id, phone: l.phone || l.phoneNumber, status: l.status, acct: l.account, owner: l.owner || l.chatId, health: l.health && (l.health.state || l.health.status), replacedBy: l.replacedBy }))
  const tests = await db.collection('bsTests').find({ $or: [{ createdAt: { $gte: since } }, { at: { $gte: since } }] }).toArray()
  console.log(`\nTESTS last ${H}h:`, tests.length)
  for (const t of tests) console.log(' ', JSON.stringify(t).slice(0, 400))
  const msgs = await db.collection('bsMessages').find({ $or: [{ createdAt: { $gte: since } }, { at: { $gte: since } }] }).toArray()
  const dir = {}; for (const m of msgs) { const k = `${m.direction || m.dir || '?'}/${m.kind || m.type || '-'}/${m.status || '-'}`; dir[k] = (dir[k] || 0) + 1 }
  console.log(`\nMESSAGES last ${H}h:`, msgs.length, JSON.stringify(dir))
  for (const m of msgs.filter(m => /in/i.test(m.direction || m.dir || '') || m.reply)) console.log('  IN', JSON.stringify(m).slice(0, 400))
  console.log('\nSAMPLE OUT', msgs.filter(m => !/in/i.test(m.direction || m.dir || '')).slice(0, 3).map(m => JSON.stringify(m).slice(0, 300)).join('\n'))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
