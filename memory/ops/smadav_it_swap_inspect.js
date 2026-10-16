// Read-only: inspect DB + OP + CF + WHM state for the SMADAV .it domain swap
require('dotenv').config({ path: process.env.ENV_PATH })
const { MongoClient } = require('mongodb')
const op = require(process.env.REL + '/js/op-service.js')
const OLD = process.env.OLD || '73sandoresworld.it'
const NEW = process.env.NEW || '72sandoresworld.it'
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const out = {}
  for (const name of (await db.listCollections().toArray()).map(x => x.name)) {
    const col = db.collection(name)
    const q = { $or: [{ domain: OLD }, { domainName: OLD }, { _id: OLD }, { name: OLD }, { 'val.domain': OLD }, { addonDomains: OLD }, { domain: NEW }, { _id: NEW }, { domainName: NEW }] }
    const docs = await col.find(q).limit(20).toArray().catch(() => [])
    if (docs.length) out[name] = docs
  }
  console.log(JSON.stringify(out, (k, v) => (/pass|token|secret|pin/i.test(k) ? '<redacted>' : v), 2))
  const h = { Authorization: 'Bearer ' + (await op.authenticate()) }
  const axios = require('axios')
  const B = 'https://api.openprovider.eu'
  const cust = await axios.get(`${B}/v1beta/customers/MR971932-IT`, { headers: h })
  const cd = cust.data.data
  console.log('OP handle MR971932-IT:', JSON.stringify({ email: cd.email, name: cd.name, company: cd.company_name, country: cd.address?.country, is_deleted: cd.is_deleted }))
  for (const d of [OLD, NEW]) {
    const info = await op.getDomainInfo(d)
    console.log('OP', d, info ? JSON.stringify({ id: info.domainId, status: info.status, ns: info.nameservers, owner: info.domainData?.owner_handle, verification: info.domainData?.verification_email_status || info.domainData?.is_verified }) : 'NOT IN ACCOUNT')
  }
  console.log('Registry verify NEW:', JSON.stringify(await op.verifyRegistryAvailability(NEW)))
  console.log('OP availability NEW:', JSON.stringify(await op.checkDomainAvailability(NEW)))
  await c.close()
})().catch(e => { console.error('ERR', e.message, e.response?.data); process.exit(1) })
