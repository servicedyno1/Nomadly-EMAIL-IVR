// read-only
const { MongoClient } = require('mongodb')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const acc = await db.collection('webAccounts').findOne({ email: 'businessintelusa@gmail.com' })
  if (!acc) { console.log('no account'); return process.exit(0) }
  const ids = [acc.chatId, String(acc.chatId), acc._id, String(acc._id), acc.webChatId].filter(Boolean)
  console.log('account keys', Object.keys(acc).join(','), 'chatId', acc.chatId, 'webChatId', acc.webChatId)
  const camps = await db.collection('bulkCallCampaigns').find({ chatId: { $in: ids } }).sort({ createdAt: -1 }).limit(6).toArray()
  for (const c of camps) {
    const st = {}, hc = {}
    let last = null
    for (const l of c.leads || []) { st[l.status] = (st[l.status] || 0) + 1; if (l.hangupCause) hc[l.hangupCause] = (hc[l.hangupCause] || 0) + 1; if (l.startedAt && (!last || new Date(l.startedAt) > last)) last = new Date(l.startedAt) }
    const o = { ...c }; delete o.leads
    console.log('\n=== ', c.id, c.name, c.status)
    console.log(JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v)))
    console.log('leadStatus', JSON.stringify(st), 'hangup', JSON.stringify(hc), 'lastDial', last)
  }
  const w = await db.collection('walletOf').findOne({ _id: { $in: ids } })
  console.log('\nwallet', w && { usdIn: w.usdIn, usdOut: w.usdOut, bal: (w.usdIn || 0) - (w.usdOut || 0) })
  await cl.close()
})().catch(e => { console.error(e.message); process.exit(1) })
