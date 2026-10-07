// Cold iterative resolution (no recursive cache): TLD registry → branded NS → .sh glue → Cloudflare answer.
const { probes } = require('../js/ns-pilot')
const domain = String(process.argv[2] || '').toLowerCase()

;(async () => {
  const del = await probes.registryDelegation(domain)
  console.log(`1. ${domain.split('.').pop()} registry (${del.server}) delegates to: ${del.nameservers.join(', ')}`)
  for (const ns of del.nameservers) {
    const glue = await probes.registryDelegation(ns.split('.').slice(-2).join('.'))
    const g = (glue.glue || []).find((x) => x.name === ns) || {}
    const ip = g.ip || g.data || (await probes.resolveFirstIpv4(ns))
    const r = await probes.rawQuery(ip, domain, 'A', { rd: false })
    const ips = (r.answers || []).filter((a) => a.type === 'A').map((a) => a.data)
    console.log(`2. ${ns} glue at .sh registry (${glue.server}) → ${ip} | 3. answer aa=${r.aa}: ${ips.join(', ')} → ${ips.length && ips.every(probes.isCloudflareIp) ? 'Cloudflare edge (proxied)' : 'NOT proxied'}`)
  }
  process.exit(0)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
