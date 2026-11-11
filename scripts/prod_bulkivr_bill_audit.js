// read-only billing audit for one web account's Bulk IVR campaigns
const { MongoClient } = require('mongodb')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const chatIds = [5000000000000143, '5000000000000143']
  const camps = await db.collection('bulkCallCampaigns').find({ chatId: { $in: chatIds } }).sort({ createdAt: -1 }).limit(6).toArray()
  const w = await db.collection('walletOf').findOne({ _id: { $in: chatIds } })
  console.log('wallet', { usdIn: w?.usdIn, usdOut: +(w?.usdOut || 0).toFixed(4), bal: +((w?.usdIn || 0) - (w?.usdOut || 0)).toFixed(2) })
  for (const c of camps) {
    const logs = await db.collection('phoneLogs').find({ campaignId: c.id, type: 'BulkIVR' }).toArray()
    const byLead = {}; for (const l of logs) (byLead[l.leadIndex] = byLead[l.leadIndex] || []).push(l)
    const st = {}; let shouldBill = 0, missing = [], wrongBilled = [], dup = [], minMismatch = []
    c.leads.forEach((l, i) => {
      st[l.status] = (st[l.status] || 0) + 1
      const done = !['pending', 'calling', 'ringing', 'answered', 'skipped'].includes(l.status) && !l.notCalled
      const free = l.status === 'failed' && !(l.duration > 0)
      const got = byLead[i] || []
      if (got.length > 1) dup.push(i)
      if (done && !free) { shouldBill++; if (!got.length) missing.push(`${i}:${l.status}:${l.duration || 0}s`) }
      if ((free || l.status === 'skipped' || l.status === 'pending') && got.length) wrongBilled.push(`${i}:${l.status}`)
      if (got.length === 1 && l.duration != null && Math.max(1, Math.ceil((l.duration || 0) / 60)) !== got[0].minutesBilled) minMismatch.push(`${i}:${l.duration}s/${got[0].minutesBilled}m`)
    })
    const total = logs.reduce((a, l) => a + (l.charge || 0), 0), mins = logs.reduce((a, l) => a + (l.minutesBilled || 0), 0)
    const ledger = await db.collection('walletLedger').aggregate([{ $match: { chatId: { $in: chatIds }, callType: 'BulkIVR', createdAt: { $gte: c.createdAt } } }, { $group: { _id: null, n: { $sum: 1 }, amt: { $sum: '$amount' } } }]).toArray().catch(() => [])
    console.log(`\n=== ${c.name} [${c.status}] ${c.id.slice(0, 8)} created ${c.createdAt?.toISOString?.()} completed ${c.completedAt?.toISOString?.() || '-'}`)
    console.log('leads', JSON.stringify(st))
    console.log(`charges: ${logs.length} logs, ${mins} min, $${total.toFixed(2)} · should be billed: ${shouldBill} · rates ${[...new Set(logs.map(l => l.rate))].join(',')}`)
    console.log(`missing charge: ${missing.length} ${missing.slice(0, 8).join(' ')} · double charge: ${dup.length} ${dup.slice(0, 8).join(',')} · charged but shouldn't: ${wrongBilled.length} ${wrongBilled.slice(0, 5).join(' ')} · minute mismatch: ${minMismatch.length} ${minMismatch.slice(0, 5).join(' ')}`)
    if (ledger[0]) console.log('ledger since creation (all BulkIVR for account):', ledger[0].n, ledger[0].amt)
  }
  await cl.close()
})().catch(e => { console.error(e.message); process.exit(1) })
