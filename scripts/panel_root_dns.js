// Point brand root domains (+ www) straight at the droplet (DNS-only) so nginx serves the hosting panel there.
//   node scripts/panel_root_dns.js            → plan only
//   node scripts/panel_root_dns.js --apply    → write records
// Only the apex and www A/CNAME records are touched; cpanel-api / whm-api / mail / MailerSend records stay as they are.
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') })
const axios = require('axios')
const IP = process.env.PANEL_ROOT_IP || '146.190.238.190'
const ROOTS = ['hostbay.io', 'smadavhost.com', 'voodoohost.xyz', 'proshophost.xyz']
const apply = process.argv.includes('--apply')
const cf = axios.create({ baseURL: 'https://api.cloudflare.com/client/v4', headers: { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }, timeout: 20000 })

;(async () => {
  for (const root of ROOTS) {
    const zone = (await cf.get('/zones', { params: { name: root } })).data.result[0]
    if (!zone) { console.log(`!! ${root}: not in this Cloudflare account`); continue }
    const recs = (await cf.get(`/zones/${zone.id}/dns_records`, { params: { per_page: 500 } })).data.result
    for (const name of [root, `www.${root}`]) {
      const cur = recs.filter(r => r.name === name && ['A', 'AAAA', 'CNAME'].includes(r.type))
      const ok = cur.length === 1 && cur[0].type === 'A' && cur[0].content === IP && !cur[0].proxied
      const was = cur.map(r => `${r.type} ${r.content}${r.proxied ? ' (proxied)' : ''}`).join(', ') || 'none'
      if (ok) { console.log(`ok     ${name} already A ${IP}`); continue }
      console.log(`${apply ? 'APPLY ' : 'PLAN  '} ${name}: ${was}  →  A ${IP} (DNS only)`)
      if (!apply) continue
      for (const r of cur) await cf.delete(`/zones/${zone.id}/dns_records/${r.id}`)
      await cf.post(`/zones/${zone.id}/dns_records`, { type: 'A', name, content: IP, ttl: 60, proxied: false })
    }
  }
})().catch(e => { console.error('ERROR', e.response?.status, JSON.stringify(e.response?.data?.errors || e.message)); process.exit(1) })
