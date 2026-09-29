/* global process, require, console */
// READ-ONLY. Usage: node ops_order_lookup.js /path/to/backend.env <chatId> <domain>
const fs = require('fs'); const path = require('path')
const envPath = process.argv[2], CHAT = process.argv[3], DOMAIN = process.argv[4]
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) { let v = m[2].trim(); if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1); env[m[1]] = v }
}
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))
;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect(); const db = c.db(env.DB_NAME)
  const idNum = Number(CHAT)
  console.log('DB:', env.DB_NAME)
  for (const coll of ['users', 'usersOf', 'state', 'registeredDomains', 'domainsOf', 'cpanelPendingJobs']) {
    try {
      let q
      if (coll === 'registeredDomains') q = { _id: DOMAIN }
      else if (coll === 'cpanelPendingJobs') q = { domain: DOMAIN }
      else q = { $or: [{ _id: idNum }, { _id: String(CHAT) }, { chatId: idNum }, { chatId: String(CHAT) }] }
      const docs = await db.collection(coll).find(q).limit(5).toArray()
      console.log(`\n===== ${coll} (${docs.length}) =====`)
      docs.forEach(d => {
        // print a trimmed view of relevant fields
        const keys = Object.keys(d)
        const pick = {}
        for (const k of keys) {
          if (/plan|website|domain|email|lang|price|hosting|status|type|_id|chatId|step|state|nameserver|ns|registrar|cfZone|nameservers/i.test(k)) pick[k] = d[k]
        }
        console.log(JSON.stringify(pick))
      })
    } catch (e) { console.log(`(${coll} err: ${e.message})`) }
  }
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
