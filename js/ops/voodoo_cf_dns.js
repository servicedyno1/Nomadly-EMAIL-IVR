#!/usr/bin/env node
require('../log-redact.js').installConsoleRedaction()
/* Voodoo Land DNS (Cloudflare, idempotent). Dry-run unless --apply. Mirrors the Smadav layout:
 *   voodooivr.xyz            A  → droplet (dns-only)   bot webhooks + /call page (SELF_URL)
 *   www.voodooivr.xyz        proxied placeholder + 301 → https://voodooivr.xyz
 *   sip.voodooivr.xyz        A 192.76.120.10 + SRV _sip._udp/_sip._tcp 5060, _sips._tcp 5061 → sip.telnyx.com
 *   panel.voodoohost.xyz     A  → droplet (dns-only)   hosting panel + landing
 *   voodoohost.xyz + www     proxied placeholders + 301 → https://panel.voodoohost.xyz */
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const ENV = process.env.VOODOO_ENV_FILE || path.resolve(__dirname, '../../backend/.env')
const E = Object.fromEntries(fs.readFileSync(ENV, 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const APPLY = process.argv.includes('--apply')
const DROPLET = E.DROPLET_PUBLIC_IP
const cf = axios.create({ baseURL: 'https://api.cloudflare.com/client/v4', headers: { 'X-Auth-Email': E.CLOUDFLARE_EMAIL, 'X-Auth-Key': E.CLOUDFLARE_API_KEY } })

const zoneId = async name => (await cf.get('/zones', { params: { name } })).data.result[0].id
async function ensure(zid, rec) {
  const ex = (await cf.get(`/zones/${zid}/dns_records`, { params: { type: rec.type, name: rec.name } })).data.result
  const same = r => rec.type === 'SRV' ? (r.data?.target === rec.data.target && r.data?.port === rec.data.port) : (r.content === rec.content && !!r.proxied === !!rec.proxied)
  if (ex.some(same)) return console.log(`  = ${rec.type} ${rec.name}`)
  if (!APPLY) return console.log(`  would set ${rec.type} ${rec.name} → ${rec.content || JSON.stringify(rec.data)}${rec.proxied ? ' (proxied)' : ''}`)
  if (ex.length && rec.type !== 'SRV') await cf.put(`/zones/${zid}/dns_records/${ex[0].id}`, rec)
  else await cf.post(`/zones/${zid}/dns_records`, rec)
  console.log(`  + ${rec.type} ${rec.name}`)
}
async function redirect(zid, desc, hosts, target) {
  const expression = '(' + hosts.map(h => `http.host eq "${h}"`).join(' or ') + ')'
  const rule = { action: 'redirect', description: desc, enabled: true, expression, action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: `concat("${target}", http.request.uri.path)` } } } }
  const ep = await cf.get(`/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`).catch(() => null)
  const rules = (ep?.data?.result?.rules || []).filter(r => r.description !== desc)
  if (!APPLY) return console.log(`  would redirect ${expression} → ${target}`)
  await cf.put(`/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, { rules: [...rules, rule] })
  console.log(`  + redirect ${hosts.join(', ')} → ${target}`)
}
const A = (name, content, proxied = false) => ({ type: 'A', name, content, ttl: proxied ? 1 : 300, proxied })
const SRV = (name, port) => ({ type: 'SRV', name, ttl: 300, data: { priority: 10, weight: 10, port, target: 'sip.telnyx.com' } })

;(async () => {
  if (!DROPLET) throw new Error('DROPLET_PUBLIC_IP missing')
  console.log('### voodooivr.xyz')
  const ivr = await zoneId('voodooivr.xyz')
  for (const r of [A('voodooivr.xyz', DROPLET), A('www.voodooivr.xyz', '192.0.2.1', true), A('sip.voodooivr.xyz', '192.76.120.10'),
    SRV('_sip._udp.sip.voodooivr.xyz', 5060), SRV('_sip._tcp.sip.voodooivr.xyz', 5060), SRV('_sips._tcp.sip.voodooivr.xyz', 5061)]) await ensure(ivr, r)
  await redirect(ivr, 'www redirect voodooivr.xyz', ['www.voodooivr.xyz'], 'https://voodooivr.xyz')

  console.log('### voodoohost.xyz')
  const host = await zoneId('voodoohost.xyz')
  for (const r of [A('panel.voodoohost.xyz', DROPLET), A('voodoohost.xyz', '192.0.2.1', true), A('www.voodoohost.xyz', '192.0.2.1', true)]) await ensure(host, r)
  await redirect(host, 'www+root redirect voodoohost.xyz', ['voodoohost.xyz', 'www.voodoohost.xyz'], 'https://panel.voodoohost.xyz')
})().catch(e => { console.error('FATAL', e.response?.status, JSON.stringify(e.response?.data?.errors || e.message)); process.exit(1) })
