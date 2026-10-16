// Backfill Origin CA certs for live hosting domains stuck on Flexible SSL with no origin cert.
// Reuses protection-enforcer.ensureOriginCert (generate CF Origin CA → install on cPanel → exclude AutoSSL),
// then sets CF SSL to 'full' for domains whose origin now terminates TLS.
// Usage per brand env on droplet: CONFIRM=1 REL=<release> ENV_PATH=<brand backend.env> node origin_ca_backfill.js  (dry-run without CONFIRM)
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const R = process.env.REL
const cf = require(R + '/js/cf-service.js')
const pe = require(R + '/js/protection-enforcer.js')
const H = () => ({ 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY, 'Content-Type': 'application/json' })
const B = 'https://api.cloudflare.com/client/v4'
const CONFIRM = !!process.env.CONFIRM
const brand = process.env.DB_NAME
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(brand)
  pe.init(db)
  const accts = await db.collection('cpanelAccounts').find({ deleted: { $ne: true } }).toArray()
  let fixed = 0, okAlready = 0, skipped = 0, failed = 0
  for (const a of accts) {
    const cpUser = a._id || a.cpUser
    for (const d of [a.domain, ...(a.addonDomains || [])].filter(Boolean)) {
      const dom = String(d).toLowerCase()
      const zone = await cf.getZoneByName(dom)
      if (!zone) { console.log(`[${brand}] SKIP ${dom}: no CF zone`); skipped++; continue }
      const certs = (await axios.get(`${B}/certificates`, { headers: H(), params: { zone_id: zone.id } })).data.result || []
      const sslBefore = (await axios.get(`${B}/zones/${zone.id}/settings/ssl`, { headers: H() })).data.result.value
      if (certs.length > 0 && sslBefore === 'full') { console.log(`[${brand}] OK ${dom}: ${certs.length} cert(s), ssl=full`); okAlready++; continue }
      if (!CONFIRM) { console.log(`[${brand}] WOULD-FIX ${dom}: certs=${certs.length} ssl=${sslBefore} zone=${zone.status} cpUser=${cpUser}`); continue }
      const actions = await pe.ensureOriginCert(dom, zone.id, cpUser)
      const bad = actions.some(x => /FAILED|skipped|error/.test(x))
      let sslAfter = sslBefore
      if (!bad) {
        await new Promise(r => setTimeout(r, 4000))  // let cPanel start serving the new cert
        try { await axios.patch(`${B}/zones/${zone.id}/settings/ssl`, { value: 'full' }, { headers: H() }); sslAfter = 'full' } catch (e) { /* enforcer will retry */ }
        fixed++
      } else { failed++ }
      console.log(`[${brand}] ${bad ? 'DEFER' : 'FIX'} ${dom}: ${actions.join('; ') || 'origin already OK'} | ssl ${sslBefore} -> ${sslAfter}`)
    }
  }
  console.log(`[${brand}] done: fixed=${fixed} already_full=${okAlready} skipped=${skipped} deferred/failed=${failed}`)
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
