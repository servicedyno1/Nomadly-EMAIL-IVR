// Read-only: which live hosting domains (primary + addons) lack a Cloudflare Origin CA cert, per brand
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const cf = require(process.env.REL + '/js/cf-service.js')
const H = () => ({ 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY })
const B = 'https://api.cloudflare.com/client/v4'
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const accts = await db.collection('cpanelAccounts').find({ deleted: { $ne: true } }).project({ cpUser: 1, domain: 1, addonDomains: 1, chatId: 1, suspended: 1 }).toArray()
  const rows = []
  for (const a of accts) {
    for (const d of [a.domain, ...(a.addonDomains || [])].filter(Boolean)) {
      const zone = await cf.getZoneByName(String(d).toLowerCase())
      if (!zone) { rows.push({ d, cpUser: a._id, zone: 'NONE' }); continue }
      let ssl = '?', certs = '?'
      try { ssl = (await axios.get(`${B}/zones/${zone.id}/settings/ssl`, { headers: H() })).data.result.value } catch (e) { ssl = 'ERR' + (e.response?.status || '') }
      try { certs = (await axios.get(`${B}/certificates`, { headers: H(), params: { zone_id: zone.id } })).data.result.length } catch (e) { certs = 'ERR' + (e.response?.status || '') }
      rows.push({ d, cpUser: a._id, zone: zone.status, ssl, certs })
    }
  }
  const missing = rows.filter(r => r.certs === 0)
  console.log(`${process.env.BRAND}: accounts=${accts.length} domains=${rows.length} with_cert=${rows.filter(r => r.certs > 0).length} missing_cert=${missing.length} no_zone=${rows.filter(r => r.zone === 'NONE').length} errors=${rows.filter(r => String(r.certs).startsWith('ERR')).length}`)
  for (const r of rows.filter(r => !(r.certs > 0))) console.log(`  ${r.d} | ${r.cpUser} | zone=${r.zone} | ssl=${r.ssl} | certs=${r.certs}`)
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
