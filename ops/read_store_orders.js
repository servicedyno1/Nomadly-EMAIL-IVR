'use strict'
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const ids = ['30d09e47-69f2-402d-85ac-b8f7ccd18da7', '9fd5da6a-d587-4de1-a3a3-1bd75d315149']
  for (const id of ids) {
    const o = await db.collection('webOrders').findOne({ _id: id })
    if (!o) { console.log(id, '=> NOT FOUND'); continue }
    console.log('\n=== order', id, '===')
    console.log(JSON.stringify({
      _id: o._id, kind: o.kind, plan: o.plan, domain: o.domain, coin: o.coin,
      provider: o.provider, status: o.status, amountUsd: o.amountUsd, total: o.total,
      payAddress: o.payAddress, paymentId: o.paymentId,
      email: o.email, guestEmail: o.guestEmail, webUserId: o.webUserId,
      createdAt: o.createdAt, updatedAt: o.updatedAt, usdCredited: o.usdCredited,
    }, null, 1))
  }
  await client.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
