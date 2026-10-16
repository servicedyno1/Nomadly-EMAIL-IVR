#!/usr/bin/env node
/* PROSHOP brand (4th bot): Cloudflare zones + OpenProvider registration (Cloudflare NS, auto-renew OFF per owner)
   for proshophost.xyz + proshopivr.xyz. Dry-run unless --apply. Idempotent (skips what already exists). */
require('../log-redact.js').installConsoleRedaction()
const fs = require('fs')
const path = require('path')
for (const l of fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const axios = require('axios')
const cf = require('../cf-service')
const op = require('../op-service')

const DOMAINS = ['proshophost.xyz', 'proshopivr.xyz']
const APPLY = process.argv.includes('--apply')
const OP = 'https://api.openprovider.eu'

async function opHeaders() {
  const r = await axios.post(`${OP}/v1beta/auth/login`, { username: process.env.OPENPROVIDER_USERNAME, password: process.env.OPENPROVIDER_PASSWORD }, { timeout: 15000 })
  return { Authorization: `Bearer ${r.data.data.token}` }
}
async function opDomain(headers, domain) {
  const [name, ext] = [domain.slice(0, domain.indexOf('.')), domain.slice(domain.indexOf('.') + 1)]
  const r = await axios.get(`${OP}/v1beta/domains`, { headers, params: { full_name: domain, limit: 5 }, timeout: 15000 })
  return (r.data?.data?.results || []).find(d => d.domain && d.domain.name === name && d.domain.extension === ext) || null
}

;(async () => {
  const headers = await opHeaders()
  for (const d of DOMAINS) {
    console.log(`\n== ${d}`)
    let zone = await cf.getZoneByName(d)
    if (!zone && APPLY) {
      const z = await cf.createZone(d)
      if (!z.success) throw new Error(`CF zone create failed for ${d}: ${JSON.stringify(z)}`)
      zone = await cf.getZoneByName(d)
    }
    console.log('CF zone:', zone ? `${zone.id} ${zone.status} NS=${(zone.name_servers || []).join(',')}` : '(would create)')
    let reg = await opDomain(headers, d)
    if (!reg) {
      const avail = await op.checkDomainAvailability(d)
      console.log('OpenProvider availability:', JSON.stringify(avail))
      if (APPLY && avail.available && zone) {
        const r = await op.registerDomain(d, zone.name_servers)
        console.log('register:', JSON.stringify(r).slice(0, 400))
        reg = await opDomain(headers, d)
      }
    }
    if (reg) {
      console.log('OpenProvider domain:', reg.id, reg.status, 'autorenew', reg.autorenew, 'expires', reg.expiration_date, 'NS', (reg.name_servers || []).map(n => n.name).join(','))
      if (APPLY && reg.autorenew !== 'off') {
        const u = await axios.put(`${OP}/v1beta/domains/${reg.id}`, { autorenew: 'off' }, { headers, timeout: 15000 })
        console.log('autorenew → off:', u.data?.code === 0 ? 'ok' : JSON.stringify(u.data).slice(0, 200))
      }
    }
    if (APPLY && zone) {
      const s = await axios.patch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/settings/ssl`, { value: 'full' }, { headers: { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }, timeout: 15000 })
      console.log('CF ssl mode → full:', s.data?.success ? 'ok' : JSON.stringify(s.data?.errors))
    }
  }
  process.exit(0)
})().catch(e => { console.error('ERR', e.response ? JSON.stringify(e.response.data).slice(0, 400) : e.message); process.exit(1) })
