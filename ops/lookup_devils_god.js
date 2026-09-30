require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

const CHAT_ID = '1446310286'
const CP_USER = 'auth62f9'
const PRIMARY = 'auth09-tdhelpdesk.click'

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  console.log('=== blockedDomains sample (10) ===')
  const bd = await db.collection('blockedDomains').find({}).limit(10).toArray()
  bd.forEach(d => console.log(JSON.stringify(d)))
  console.log('total blockedDomains:', await db.collection('blockedDomains').countDocuments({}))

  console.log('\n=== search blockedDomains for user related terms ===')
  const q = await db.collection('blockedDomains').find({
    $or: [
      { domain: { $regex: 'td', $options: 'i' } },
      { domain: { $regex: 'helpdesk', $options: 'i' } },
      { domain: { $regex: 'boa', $options: 'i' } },
      { domain: { $regex: 'bankof', $options: 'i' } },
      { domain: { $regex: 'auth', $options: 'i' } },
      { domain: { $regex: 'americafirst', $options: 'i' } },
      { domain: { $regex: 'afcu', $options: 'i' } },
    ]
  }).limit(30).toArray()
  q.forEach(d => console.log(JSON.stringify(d)))

  console.log('\n=== recent state for chatId', CHAT_ID, '===')
  const st = await db.collection('state').findOne({ _id: CHAT_ID })
  if (st) {
    console.log('action:', st.action, 'currentPackage:', !!st.currentPackage)
    console.log('info keys:', Object.keys(st.info || {}).slice(0, 30))
    console.log('user:', JSON.stringify(st.user))
    if (st.info?.cpAddonDomain) console.log('cpAddonDomain draft:', st.info.cpAddonDomain)
    if (st.info?.pendingAddonDomain) console.log('pendingAddonDomain:', st.info.pendingAddonDomain)
    if (st.info?.currentPackage) console.log('currentPackage:', JSON.stringify(st.info.currentPackage))
  } else {
    console.log('no state doc for this chatId')
  }

  console.log('\n=== recent webOrders / cart / paymentIntents for chatId', CHAT_ID, '===')
  const cutoff = new Date(Date.now() - 7*24*3600*1000)
  const pi = await db.collection('paymentIntents').find({ chatId: CHAT_ID }).sort({ createdAt: -1 }).limit(10).toArray()
  pi.forEach(p => console.log('PI:', JSON.stringify({ ref: p._id, plan: p.plan, domain: p.domain, amount: p.amount, status: p.status, createdAt: p.createdAt })))

  console.log('\n=== webOrders for cpUser', CP_USER, '===')
  const wo = await db.collection('webOrders').find({ cpUser: CP_USER }).limit(5).toArray()
  wo.forEach(w => console.log(JSON.stringify(w)))

  console.log('\n=== registeredDomains for primary domain', PRIMARY, '===')
  const primary = await db.collection('registeredDomains').findOne({ _id: PRIMARY })
  console.log(JSON.stringify(primary, null, 2))

  console.log('\n=== recent transactions with amount for chatId', CHAT_ID, '===')
  const txAll = await db.collection('transactions').find({ chatId: CHAT_ID }).sort({ _id: -1 }).limit(15).toArray()
  txAll.forEach(t => {
    const ts = t.time || t.timeStamp || (t._id?.getTimestamp?.() && t._id.getTimestamp().toISOString())
    console.log(ts, t.type, t.amount, t.description || t.reason || '')
  })

  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
