// Production: round-trip line check between the two BulkSMS lines (A→B, B→A) using the platform's own check flow,
// then a report of customer test texts and replies in the last N hours. Usage: node prod_bulksms_pair_check.js [hours]
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const id = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`
;(async () => {
  const H = Number(process.argv[2] || 18), since = new Date(Date.now() - H * 3600e3)
  const cl = await MongoClient.connect(process.env.BULK_ESIM_MONGO_URL), db = cl.db(process.env.BULK_ESIM_DB), C = (n) => db.collection(n)
  const lines = await C('bsEsims').find({ status: { $nin: ['failed', 'retired', 'cancelled'] } }).toArray()
  console.log('LINES', lines.map(l => `${l._id} ${l.msisdn} status=${l.status} role=${l.role || 'service'} health=${l.health} lastCheckOk=${l.lastCheckOkAt ? new Date(l.lastCheckOkAt).toISOString() : '-'}`).join('\n      '))
  if (process.argv.includes('--check') && lines.length >= 2) {
    const [a, b] = lines, made = []
    for (const [e, peer] of [[a, b], [b, a]]) {
      if (await C('bsTests').findOne({ esimId: e._id, type: 'check', result: 'pending' })) { console.log(`${e._id}: a check is already pending`); continue }
      const code = crypto.randomBytes(3).toString('hex')
      const t = { esimId: e._id, peer: peer._id, type: 'check', kind: 'manual', code, legs: { out: false, back: false }, result: 'pending', at: new Date() }
      await C('bsTests').insertOne(t)
      const body = `CloudIVR line check ${code}`
      await C('bsMessages').insertOne({ _id: id('m'), cid: 'system:health', brand: 'system', campaignId: null, bookingId: null, sessionId: null, esimId: e._id, to: peer.msisdn, from: null, body, segments: 1, direction: 'out', status: 'queued', history: [{ s: 'queued', at: new Date() }], attempts: 0, priority: 2, nextAt: new Date(), test: false, system: true, prepaid: false, quotaDay: null, expireAt: null, createdAt: new Date() })
      made.push({ e, peer, code }); console.log(`sent check ${code}: ${e.msisdn} → ${peer.msisdn}`)
    }
    for (let i = 0; i < 36 && made.length; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const rows = await C('bsTests').find({ code: { $in: made.map(m => m.code) } }).toArray()
      if (rows.every(r => r.result !== 'pending')) break
    }
    for (const m of made) {
      const t = await C('bsTests').findOne({ code: m.code })
      const out = await C('bsMessages').findOne({ body: `CloudIVR line check ${m.code}`, direction: 'out' })
      const inb = await C('bsMessages').find({ direction: 'in', body: { $regex: m.code } }).toArray()
      console.log(`\nCHECK ${m.e._id} ${m.e.msisdn} → ${m.peer._id} ${m.peer.msisdn}: result=${t.result} legs=${JSON.stringify(t.legs)} sentStatus=${out?.status} provider=${out?.providerStatus || out?.dlr || '-'} inbound=${inb.length} (${inb.map(x => `${x.from}→${x.to} "${x.body}"`).join(' | ')})`)
    }
  }
  const tests = await C('bsMessages').find({ test: true, createdAt: { $gte: since } }).sort({ createdAt: 1 }).toArray()
  console.log(`\nCUSTOMER TEST TEXTS last ${H}h: ${tests.length}`)
  for (const m of tests) console.log(`  ${m.createdAt.toISOString()} cid=${m.cid} to=${m.to} from=${m.from || '-'} status=${m.status} ${m.failureReason ? 'reason=' + m.failureReason : ''} camp=${m.campaignId} "${String(m.body).slice(0, 60)}"`)
  const replies = await C('bsMessages').find({ direction: 'in', createdAt: { $gte: since }, body: { $not: /line check/ } }).sort({ createdAt: 1 }).toArray()
  console.log(`\nREPLIES (incoming, not line checks) last ${H}h: ${replies.length}`)
  for (const m of replies) console.log(`  ${m.createdAt.toISOString()} from=${m.from} to=${m.to} cid=${m.cid || '-'} camp=${m.campaignId || '-'} routed=${m.routed || m.status || '-'} "${String(m.body).slice(0, 80)}"`)
  const outR = await C('bsMessages').find({ direction: 'out', sessionId: { $ne: null }, createdAt: { $gte: since } }).toArray()
  console.log(`\nCUSTOMER REPLY TEXTS SENT (chat sessions) last ${H}h: ${outR.length}`)
  for (const m of outR) console.log(`  ${m.createdAt.toISOString()} cid=${m.cid} to=${m.to} status=${m.status} "${String(m.body).slice(0, 60)}"`)
  const cids = [...new Set([...tests, ...replies, ...outR].map(m => m.cid).filter(Boolean))]
  const cust = await C('bsCustomers').find({ _id: { $in: cids } }).toArray()
  console.log('\nCUSTOMERS', cust.map(c => `${c._id} name=${c.name || c.username || '-'} lang=${c.lang || '-'} freeTestAt=${c.freeTestAt ? c.freeTestAt.toISOString() : '-'}`).join('\n          '))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
