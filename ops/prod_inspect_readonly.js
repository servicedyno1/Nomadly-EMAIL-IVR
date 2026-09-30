#!/usr/bin/env node
// READ-ONLY prod Mongo inspection. NO writes. Reads the prod MONGO_URL from the
// commented ORIGINAL_PROD_MONGO_URL line in backend/.env.
const fs = require('fs')
const { MongoClient } = require('mongodb')

function prodMongoUrl() {
  const env = fs.readFileSync('/app/backend/.env', 'utf8')
  const m = env.match(/ORIGINAL_PROD_MONGO_URL\s*=\s*"?([^"\n]+)"?/)
  if (!m) throw new Error('ORIGINAL_PROD_MONGO_URL not found in .env')
  return m[1].trim()
}

;(async () => {
  const url = prodMongoUrl()
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 15000 })
  await client.connect()
  const db = client.db('test')

  // 1. Owner wallet
  const w = await db.collection('walletOf').findOne({ _id: '5590563715' })
  const bal = w ? ((w.usdIn || 0) - (w.usdOut || 0)) : null
  console.log('OWNER WALLET 5590563715:', w ? `usdIn=${w.usdIn} usdOut=${w.usdOut} balance=$${bal.toFixed(2)}` : '(no wallet doc)')

  // 2. Existing reseller keys for owner
  const keys = await db.collection('resellerApiKeys').find({ ownerChatId: '5590563715' }).project({ keyHash: 0 }).toArray()
  console.log('RESELLER KEYS for owner:', keys.length, keys.map(k => `${k._id}(enabled=${k.enabled},prefix=${k.keyPrefix})`).join(', '))

  // 3. #6 — locate bylinebank.capital hosting record across likely collections
  const dom = 'bylinebank.capital'
  console.log('\n--- #6 bylinebank.capital lookups ---')
  for (const [coll, q] of [
    ['cpanelAccounts', { $or: [{ domain: dom }, { addonDomains: { $elemMatch: { domain: dom } } }] }],
    ['registeredDomains', { _id: dom }],
    ['domainsOf', { domainName: dom }],
    ['hostingAccounts', { domain: dom }],
  ]) {
    try {
      const docs = await db.collection(coll).find(q).limit(3).toArray()
      if (docs.length) {
        for (const d of docs) {
          console.log(`[${coll}]`, JSON.stringify({
            _id: d._id, chatId: d.chatId, domain: d.domain || d.domainName, server: d.server || d.serverIp || d.ip || d.host || d.serverHost || d.dedicatedIp || null,
            cpanelUser: d.username || d.cpanelUser || null, status: d.status, nameservers: d.nameservers || d.ns || null,
          }))
        }
      } else {
        console.log(`[${coll}] no match`)
      }
    } catch (e) { console.log(`[${coll}] err: ${e.message}`) }
  }
  await client.close()
})().catch(e => { console.error('ERR:', e.message); process.exit(1) })
