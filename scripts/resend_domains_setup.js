// One-off: add each bot's sender domain to Resend, write Resend's DNS records into Cloudflare, then ask Resend to verify.
// Usage: node scripts/resend_domains_setup.js [--dry]
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const axios = require('axios')

const DOMAINS = ['hostbay.io', 'cloudivr.net', 'smadavhost.com', 'voodoohost.xyz', 'proshophost.xyz']
const dry = process.argv.includes('--dry')
const rs = axios.create({ baseURL: 'https://api.resend.com', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 20000 })
const cf = axios.create({ baseURL: 'https://api.cloudflare.com/client/v4', headers: { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }, timeout: 20000 })

;(async () => {
  const existing = (await rs.get('/domains')).data.data || []
  for (const name of DOMAINS) {
    let d = existing.find(x => x.name === name)
    if (!d && !dry) d = (await rs.post('/domains', { name, region: 'us-east-1' })).data
    if (!d) { console.log(`${name}: would be added to Resend`); continue }
    const full = (await rs.get(`/domains/${d.id}`)).data
    const zone = (await cf.get('/zones', { params: { name } })).data.result[0]
    for (const r of full.records || []) {
      const fqdn = r.name === '@' || r.name === name ? name : (r.name.endsWith(name) ? r.name : `${r.name}.${name}`)
      const have = (await cf.get(`/zones/${zone.id}/dns_records`, { params: { type: r.type, name: fqdn } })).data.result
      const same = have.find(h => h.content.replace(/^"|"$/g, '') === String(r.value) || (r.type === 'MX' && h.content === r.value))
      if (same) { console.log(`${name}: ${r.type} ${fqdn} already set`); continue }
      // DKIM / SPF on Resend's own names may be stale from an earlier attempt: replace only those exact names.
      const stale = have.filter(h => r.type === 'TXT' ? /resend|amazonses|v=spf1|p=/i.test(h.content) : r.type === 'MX')
      const body = { type: r.type, name: fqdn, content: String(r.value), ttl: 1, ...(r.type === 'MX' ? { priority: Number(r.priority || 10) } : {}) }
      if (dry) { console.log(`${name}: would write ${r.type} ${fqdn}${stale.length ? ' (replacing ' + stale.length + ')' : ''}`); continue }
      for (const s of stale) await cf.delete(`/zones/${zone.id}/dns_records/${s.id}`)
      await cf.post(`/zones/${zone.id}/dns_records`, body)
      console.log(`${name}: wrote ${r.type} ${fqdn}`)
    }
    if (!dry) { await rs.post(`/domains/${d.id}/verify`).catch(() => {}); console.log(`${name}: verification requested`) }
  }
  const after = (await rs.get('/domains')).data.data || []
  for (const x of after) console.log(`STATUS ${x.name}: ${x.status}`)
})().catch(e => { console.log('ERR', e.response?.status, JSON.stringify(e.response?.data || e.message)); process.exit(1) })
