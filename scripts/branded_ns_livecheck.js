// Read-only live check: do ns1/ns2.hosta.sh glue IPs answer authoritatively for zones on any CF NS pair?
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { probes } = require('../js/ns-pilot')

const GLUE = { 'ns1.hosta.sh': '172.64.35.177', 'ns2.hosta.sh': '108.162.194.151' }
const cfHeaders = { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }

async function listZones() {
  const out = []
  for (let page = 1; page <= 20; page++) {
    const r = await axios.get('https://api.cloudflare.com/client/v4/zones', { headers: cfHeaders, params: { per_page: 50, page, status: 'active' } })
    out.push(...r.data.result)
    if (page >= r.data.result_info.total_pages) break
  }
  return out
}

async function proxiedHost(zone) {
  const r = await axios.get(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`, { headers: cfHeaders, params: { per_page: 50 } })
  const rec = r.data.result.find((x) => x.proxied && ['A', 'AAAA', 'CNAME'].includes(x.type))
  return rec ? rec.name : null
}

;(async () => {
  const zones = await listZones()
  const pairs = {}
  for (const z of zones) {
    const key = [...z.name_servers].sort().join(' + ')
    ;(pairs[key] = pairs[key] || []).push(z)
  }
  console.log(`Active zones: ${zones.length}, distinct NS pairs: ${Object.keys(pairs).length}`)
  for (const [pair, zs] of Object.entries(pairs)) console.log(`  ${pair}: ${zs.length} zone(s)`)

  let pass = 0, fail = 0
  for (const zs of Object.values(pairs)) {
   let tested = 0
   for (const z of zs) {
    if (tested >= 3) break
    const host = await proxiedHost(z).catch(() => null)
    if (!host) continue
    tested++
    for (const [ns, ip] of Object.entries(GLUE)) {
      const r = await probes.rawQuery(ip, host, 'A', { rd: false })
      const ips = (r.answers || []).filter((a) => a.type === 'A').map((a) => a.data)
      const ok = r.ok && r.aa && ips.length > 0 && ips.every(probes.isCloudflareIp)
      ok ? pass++ : fail++
      console.log(`- ${host} [assigned ${z.name_servers.join(',')}] via ${ns}(${ip}): rcode=${r.rcode} aa=${r.aa} A=${ips.join('/') || '-'} ${ok ? 'PASS' : 'FAIL'}`)
    }
   }
  }
  console.log(`\nRESULT: ${pass} pass, ${fail} fail`)
  process.exit(0)
})().catch((e) => { console.error('ERR', e.response?.data || e.message); process.exit(1) })
