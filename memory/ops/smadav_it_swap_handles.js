// Read-only: list OP handles using the lost tutamail address + release-code parity check
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const op = require(process.env.REL + '/js/op-service.js')
;(async () => {
  const h = { Authorization: 'Bearer ' + (await op.authenticate()) }
  const B = 'https://api.openprovider.eu'
  for (const pat of ['cloakhost@tutamail.com', '*tutamail*']) {
    const r = await axios.get(`${B}/v1beta/customers`, { headers: h, params: { limit: 500, email_pattern: pat } })
    console.log(pat, '=>', (r.data.data.results || []).map(c => `${c.handle}|${c.email}|${c.name?.full_name}|${c.company_name || ''}`))
  }
  const ds = require(process.env.REL + '/js/domain-service.js')
  const whm = require(process.env.REL + '/js/whm-service.js')
  const af = require(process.env.REL + '/js/addon-domain-flow.js')
  const td = require(process.env.REL + '/js/hosting-dns-teardown.js')
  const cf = require(process.env.REL + '/js/cf-service.js')
  console.log('parity', typeof ds.registerDomain, ds.registerDomain.length, typeof whm.changePrimaryDomain, typeof af.runDnsAndProtection, typeof td.teardownHostingDomain, typeof cf.deleteZone, typeof cf.getZoneByName)
  process.exit(0)
})().catch(e => { console.error('ERR', e.message, e.response?.data); process.exit(1) })
