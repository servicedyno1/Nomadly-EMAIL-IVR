/*global require, process, console */
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const CHAT = '8837636204'
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME)
  const out = {}
  // Ownership map
  const dmap = await db.collection('domainsOf').findOne({ _id: CHAT })
  out.domainsOf = dmap ? Object.keys(dmap).filter(k => k !== '_id' && dmap[k]) : null
  // registeredDomains docs for this chat
  for (const colName of ['registeredDomains', 'domains', 'domainRegistry', 'userDomains']) {
    try {
      const docs = await db.collection(colName).find({ $or: [{ chatId: CHAT }, { chatId: Number(CHAT) }, { ownerChatId: CHAT }] }).limit(50).toArray()
      if (docs.length) out[colName] = docs.map(d => ({ _id: d._id, domain: d.domainName || d.domain || d._id, registrar: d.registrar, nameserverType: d.nameserverType, cfZoneId: d.cfZoneId, nameservers: d.nameservers, status: d.status, server: d.server, createdAt: d.createdAt }))
    } catch (e) { /* collection may not exist */ }
  }
  // Also try to find any doc mentioning this chat in hosting/addon domains
  for (const colName of ['hostingAccounts', 'cpanelAccounts', 'addonDomains']) {
    try {
      const docs = await db.collection(colName).find({ $or: [{ chatId: CHAT }, { chatId: Number(CHAT) }] }).limit(20).toArray()
      if (docs.length) out[colName] = docs.map(d => ({ _id: d._id, domain: d.domain || d.mainDomain, status: d.status }))
    } catch (e) { /* ignore */ }
  }
  console.log(JSON.stringify(out, null, 2))
  await client.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
