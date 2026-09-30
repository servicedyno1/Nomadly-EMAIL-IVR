// READ-ONLY: sample domainsOf + vpsPlansOf shapes. No writes.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const d = await db.collection('domainsOf').findOne({})
  console.log('domainsOf sample keys:', d ? Object.keys(d) : null)
  console.log('domainsOf owner-ish fields:', d ? { domainName: d.domainName, chatId: d.chatId, ownerChatId: d.ownerChatId, registrar: d.registrar } : null)
  const v = await db.collection('vpsPlansOf').findOne({})
  console.log('vpsPlansOf sample keys:', v ? Object.keys(v) : null)
  console.log('vpsPlansOf sample _id:', v ? v._id : null, ' hasVal:', v ? !!v.val : null, ' valKeys:', v && v.val ? Object.keys(v.val) : null)
  // cpanelAccounts sample for hosting listing
  const c = await db.collection('cpanelAccounts').findOne({})
  console.log('cpanelAccounts sample keys:', c ? Object.keys(c) : null)
  await client.close()
})().catch(e => { console.error(e.message); process.exit(1) })
