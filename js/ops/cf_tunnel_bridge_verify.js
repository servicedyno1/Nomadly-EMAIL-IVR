#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY: verify the Cloudflare Tunnel (customer hosting web) + bridge hostnames
 * (whm-api / cpanel-api → WHM :2087 / cPanel :2083) are healthy against the prod WHM box.
 * Usage: node js/ops/cf_tunnel_bridge_verify.js [--domains=12] */
const fs = require('fs'), path = require('path'), https = require('https'), dns = require('dns')
const axios = require('axios')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8'))
const CF_ACCOUNT_ID = 'ed6035ebf6bd3d85f5b26c60189a21e2'
const CF = axios.create({ baseURL: 'https://api.cloudflare.com/client/v4', headers: { 'X-Auth-Email': N.CLOUDFLARE_EMAIL, 'X-Auth-Key': N.CLOUDFLARE_API_KEY }, timeout: 30000 })
const SERVICES = { Nomadly: '73e2050b-586d-41d4-a1b5-6b0914e7a0f9', SMADAV: '6d40a2dd-dfdf-4d05-9c68-4962a065885c' }
const PROJECT = '0f41a48b-d2f6-4be5-acbd-524c6df6d2c6', ENVIRON = 'b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const MAX_DOMAINS = Number((process.argv.find(a => a.startsWith('--domains=')) || '').split('=')[1] || 12)
const insecure = new https.Agent({ rejectUnauthorized: false })
const problems = [], warnings = []
const ok = (m) => console.log('  ✅ ' + m)
const bad = (m) => { console.log('  ❌ ' + m); problems.push(m) }
const warn = (m) => { console.log('  ⚠️  ' + m); warnings.push(m) }
const host = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0]
const mask = (v) => v ? `${String(v).slice(0, 4)}…${String(v).slice(-3)} (len ${String(v).length})` : '(unset)'

async function railwayVars(serviceId) {
  const body = JSON.stringify({ query: `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, variables: { p: PROJECT, e: ENVIRON, s: serviceId } })
  const r = await axios.post('https://backboard.railway.com/graphql/v2', body, { headers: { 'Content-Type': 'application/json', 'Project-Access-Token': N.API_KEY_RAILWAY }, timeout: 30000 })
  if (r.data.errors) throw new Error(JSON.stringify(r.data.errors).slice(0, 200))
  return r.data.data.variables || {}
}
const resolve4 = (h) => new Promise(res => { const r = new dns.Resolver(); r.setServers(['1.1.1.1', '8.8.8.8']); const done = setTimeout(() => res(null), 4000); r.resolve4(h, (e, a) => { clearTimeout(done); res(e ? null : a) }) })
const isCfIp = (ip) => /^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.(6[4-9]|7[01])\.|173\.245\.|103\.(21|22|31)\.|141\.101\.|108\.162\.|190\.93\.|188\.114\.|197\.234\.|198\.41\.|162\.15[89]\.)/.test(ip)
const httpProbe = (url, opts = {}) => axios.get(url, { timeout: 15000, validateStatus: () => true, maxRedirects: 0, httpsAgent: insecure, ...opts }).then(r => ({ status: r.status, headers: r.headers, data: r.data })).catch(e => ({ status: 0, err: e.code || e.message }))

;(async () => {
  console.log('\n═══ 1. Env config (vault/.env vs Railway prod) ═══')
  const KEYS = ['WHM_HOST', 'WHM_API_URL', 'CPANEL_API_URL', 'CF_TUNNEL_CNAME', 'CF_TUNNEL_ID', 'WHM_TOKEN', 'CLOUDFLARE_EMAIL', 'CF_ACCESS_CLIENT_ID']
  const prod = {}
  for (const [name, id] of Object.entries(SERVICES)) prod[name] = await railwayVars(id).catch(e => ({ __err: e.message }))
  for (const k of KEYS) {
    const secret = /TOKEN|KEY|SECRET/.test(k)
    const show = (v) => secret ? mask(v) : (v || '(unset)')
    const line = `${k}: local=${show(N[k])}` + Object.entries(prod).map(([n, v]) => ` | ${n}=${v.__err ? 'ERR' : show(v[k])}`).join('')
    const vals = [N[k], ...Object.values(prod).map(v => v[k])]
    if (k === 'CF_TUNNEL_ID' || k === 'CF_ACCESS_CLIENT_ID') { console.log('  ℹ️  ' + line); continue }
    if (vals.every(v => v && v === vals[0])) ok(line)
    else if (vals.some(v => !v)) bad(line + '  ← missing somewhere')
    else warn(line + '  ← differs')
  }
  const tunnelIdFromCname = (N.CF_TUNNEL_CNAME || '').split('.')[0]
  if (!N.CF_TUNNEL_ID) warn(`CF_TUNNEL_ID not set — bot admin "/tunnel status" will refuse; derivable from CF_TUNNEL_CNAME = ${tunnelIdFromCname}`)
  else if (N.CF_TUNNEL_ID !== tunnelIdFromCname) bad(`CF_TUNNEL_ID (${N.CF_TUNNEL_ID}) ≠ tunnel id in CF_TUNNEL_CNAME (${tunnelIdFromCname})`)
  if (!N.CF_ACCESS_CLIENT_ID) warn('CF_ACCESS_CLIENT_ID/SECRET unset — bridge hostnames rely on WHM/cPanel auth only (no Zero Trust service-token gate)')

  console.log('\n═══ 2. Cloudflare Tunnel object ═══')
  const tunnels = (await CF.get(`/accounts/${CF_ACCOUNT_ID}/cfd_tunnel`, { params: { is_deleted: false } })).data.result || []
  console.log('  tunnels in account:', tunnels.map(t => `${t.name}[${t.id.slice(0, 8)}…]=${t.status}`).join(', ') || '(none)')
  const tunnel = tunnels.find(t => t.id === tunnelIdFromCname)
  if (!tunnel) bad(`No tunnel matches CF_TUNNEL_CNAME id ${tunnelIdFromCname}`)
  else {
    ;(tunnel.status === 'healthy' ? ok : bad)(`tunnel "${tunnel.name}" status=${tunnel.status} (created ${tunnel.created_at}, conns_active_at ${tunnel.conns_active_at || '-'})`)
    const conns = (await CF.get(`/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/connections`)).data.result || []
    const edges = conns.flatMap(c => (c.conns || []).map(x => `${x.colo_name}${x.is_pending_reconnect ? '(reconnecting)' : ''}`))
    const origins = [...new Set(conns.flatMap(c => (c.conns || []).map(x => x.origin_ip)))]
    ;(edges.length >= 2 ? ok : edges.length ? warn : bad)(`cloudflared connectors=${conns.length} edge-connections=${edges.length} [${edges.join(', ')}] version=${conns.map(c => c.version).join('/') || '-'} arch=${conns.map(c => c.arch).join('/') || '-'}`)
    if (origins.length) console.log(`     ℹ️  connector egress ip(s)=${origins.join(',')} (cloudflared's own outbound IP on the WHM box — not the origin service; routes are in the ingress rules above)`)
    const cfg = (await CF.get(`/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/configurations`)).data.result
    const ingress = cfg?.config?.ingress || []
    if (!ingress.length) warn('remote config has no ingress rules — tunnel is locally-managed (config.yml on the server); cannot inspect routes via API')
    for (const r of ingress) console.log(`     ingress: ${r.hostname || '*'}${r.path ? r.path : ''} → ${r.service}${r.originRequest?.noTLSVerify ? ' (noTLSVerify)' : ''}`)
    const expect = [[host(N.WHM_API_URL), /:2087/], [host(N.CPANEL_API_URL), /:2083/]]
    for (const [h, port] of expect) {
      if (!ingress.length) break
      const rule = ingress.find(r => r.hostname === h)
      if (!rule) bad(`no ingress rule for ${h}`)
      else (port.test(rule.service) ? ok : bad)(`${h} → ${rule.service}`)
    }
    if (ingress.length) {
      const catchAll = ingress.find(r => !r.hostname)
      ;(catchAll && !/http_status/.test(catchAll.service) ? ok : bad)(`catch-all (customer sites) → ${catchAll ? catchAll.service : '(none)'}`)
    }
  }

  console.log('\n═══ 3. Bridge DNS (hostbay.io zone) ═══')
  const zones = (await CF.get('/zones', { params: { name: 'hostbay.io' } })).data.result || []
  if (!zones.length) bad('zone hostbay.io not found in this CF account')
  else {
    const zid = zones[0].id
    for (const h of [host(N.WHM_API_URL), host(N.CPANEL_API_URL)]) {
      const recs = (await CF.get(`/zones/${zid}/dns_records`, { params: { name: h } })).data.result || []
      const r = recs[0]
      if (!r) { bad(`${h}: no DNS record`); continue }
      const good = r.type === 'CNAME' && r.content === N.CF_TUNNEL_CNAME && r.proxied
      ;(good ? ok : bad)(`${h}: ${r.type} → ${r.content} proxied=${r.proxied}`)
    }
    const leak = (await CF.get(`/zones/${zid}/dns_records`, { params: { type: 'A', content: N.WHM_HOST, per_page: 50 } })).data.result || []
    ;(leak.length ? bad : ok)(`A records pointing at origin ${N.WHM_HOST} in hostbay.io: ${leak.length ? leak.map(r => r.name).join(', ') : 'none'}`)
  }

  console.log('\n═══ 4. Bridge functional: WHM :2087 via ' + host(N.WHM_API_URL) + ' ═══')
  const whmAuth = { Authorization: `whm ${N.WHM_USERNAME || 'root'}:${N.WHM_TOKEN}` }
  const t0 = Date.now()
  const ver = await httpProbe(`${N.WHM_API_URL}/json-api/version?api.version=1`, { headers: whmAuth })
  ;(ver.status === 200 && ver.data?.data?.version ? ok : bad)(`/json-api/version → HTTP ${ver.status} ${ver.data?.data?.version ? 'WHM ' + ver.data.data.version : JSON.stringify(ver.data || ver.err).slice(0, 120)} (${Date.now() - t0}ms) server=${ver.headers?.server || '-'} cf-ray=${ver.headers?.['cf-ray'] || '-'}`)
  const noauth = await httpProbe(`${N.WHM_API_URL}/json-api/version?api.version=1`, { maxRedirects: 3 })
  const noauthDenied = noauth.status === 401 || noauth.status === 403 || !(noauth.status === 200 && noauth.data?.data?.version)
  ;(noauthDenied ? ok : bad)(`unauthenticated → HTTP ${noauth.status} (access denied — no version leaked without creds)`)
  const la = await httpProbe(`${N.WHM_API_URL}/json-api/listaccts?api.version=1`, { headers: whmAuth, timeout: 60000 })
  const accts = la.data?.data?.acct || []
  ;(la.status === 200 && accts.length ? ok : bad)(`/json-api/listaccts → HTTP ${la.status} accounts=${accts.length}`)

  console.log('\n═══ 5. Bridge functional: cPanel :2083 via ' + host(N.CPANEL_API_URL) + ' ═══')
  const cpRoot = await httpProbe(`${N.CPANEL_API_URL}/`)
  const isCpanel = /cpanel/i.test(String(cpRoot.data)) || /cpsess|cpanel/i.test(String(cpRoot.headers?.location || ''))
  ;((cpRoot.status === 200 || cpRoot.status === 301 || cpRoot.status === 302) && isCpanel ? ok : bad)(`GET / → HTTP ${cpRoot.status} ${isCpanel ? 'cPanel login served' : 'unexpected body: ' + String(cpRoot.data || cpRoot.err).replace(/\s+/g, ' ').slice(0, 100)}`)
  const wrongSvc = await httpProbe(`${N.WHM_API_URL}/`, { maxRedirects: 3 })
  const isWhm = /whm|WebHost Manager|cpanel/i.test(String(wrongSvc.data)) || /login/.test(String(wrongSvc.headers?.location || '')) || wrongSvc.status === 200
  ;(isWhm ? ok : warn)(`GET ${host(N.WHM_API_URL)}/ → HTTP ${wrongSvc.status} ${isWhm ? 'WHM front-end served (2087 bridge distinct from 2083)' : 'not clearly WHM'}`)
  const sample = accts.find(a => a.suspended === 0 && a.user) || accts[0]
  if (sample) {
    const sess = await httpProbe(`${N.WHM_API_URL}/json-api/create_user_session?api.version=1&user=${encodeURIComponent(sample.user)}&service=cpaneld`, { headers: whmAuth })
    const d = sess.data?.data || {}
    if (!(d.cp_security_token && d.session)) bad(`create_user_session(${sample.user}) → HTTP ${sess.status} ${JSON.stringify(sess.data?.metadata || sess.err).slice(0, 120)}`)
    else {
      const loginUrl = `${N.CPANEL_API_URL.replace(/\/+$/, '')}${d.cp_security_token}/login/?session=${encodeURIComponent(d.session)}`
      const login = await httpProbe(loginUrl)
      const cookie = (login.headers?.['set-cookie'] || []).map(c => (c.match(/cpsession=([^;]+)/) || [])[1]).find(Boolean)
      ;(cookie ? ok : bad)(`session login on cpanel bridge (user ${sample.user}) → HTTP ${login.status} cpsession=${cookie ? 'set' : 'MISSING'} (returned url host was ${host(d.url)})`)
      if (cookie) {
        const uapi = await httpProbe(`${N.CPANEL_API_URL.replace(/\/+$/, '')}${d.cp_security_token}/execute/DomainInfo/list_domains`, { headers: { Cookie: `cpsession=${cookie}` } })
        ;(uapi.status === 200 && uapi.data?.status === 1 ? ok : bad)(`UAPI DomainInfo::list_domains via bridge → HTTP ${uapi.status} status=${uapi.data?.status} main=${uapi.data?.data?.main_domain || '-'}`)
        await httpProbe(`${N.CPANEL_API_URL.replace(/\/+$/, '')}${d.cp_security_token}/logout/`, { headers: { Cookie: `cpsession=${cookie}` } })
      }
    }
  }

  console.log('\n═══ 6. Origin lockdown (direct-to-IP must be unreachable) ═══')
  for (const port of [80, 443, 2083, 2087]) {
    const r = await httpProbe(`${port === 80 ? 'http' : 'https'}://${N.WHM_HOST}:${port}/`, { timeout: 8000 })
    ;(r.status === 0 ? ok : bad)(`${N.WHM_HOST}:${port} → ${r.status === 0 ? 'unreachable (' + r.err + ')' : 'HTTP ' + r.status + ' — ORIGIN EXPOSED'}`)
  }

  console.log(`\n═══ 7. Customer hosting domains through the tunnel (sample ${MAX_DOMAINS}) ═══`)
  const live = accts.filter(a => a.suspended === 0 && a.domain && !/\.(hostbay\.io|smadavhost\.com)$/.test(a.domain))
  const sampleDomains = live.slice(-MAX_DOMAINS).map(a => a.domain)
  let viaTunnel = 0, notOnCf = 0, cfEdgeErr = 0
  for (const dom of sampleDomains) {
    const ips = await resolve4(dom)
    const zone = ((await CF.get('/zones', { params: { name: dom } }).catch(() => ({ data: {} }))).data.result || [])[0]
    let recNote = 'zone not in our CF account'
    if (zone) {
      const recs = (await CF.get(`/zones/${zone.id}/dns_records`, { params: { name: dom } })).data.result || []
      const r = recs.find(x => x.type === 'CNAME' || x.type === 'A')
      recNote = r ? `${r.type}→${r.content === N.CF_TUNNEL_CNAME ? 'TUNNEL' : r.content}${r.proxied ? ' proxied' : ' DNS-ONLY'}` : 'no root record'
      if (r && r.type === 'A' && r.content === N.WHM_HOST) recNote += ' ← ORIGIN LEAK'
    }
    const h = await httpProbe(`https://${dom}/`, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } })
    const onCf = !!(ips && ips.every(isCfIp))
    const edgeErr = [520, 521, 522, 523, 524, 525, 526, 530].includes(h.status)
    if (edgeErr) cfEdgeErr++
    if (!onCf) notOnCf++
    if (onCf && !edgeErr && h.status) viaTunnel++
    const flag = edgeErr ? '❌' : (!onCf ? '⚠️ ' : '✅')
    console.log(`  ${flag} ${dom.padEnd(32)} dns=${ips ? (onCf ? 'CF' : ips.join(',')) : 'NXDOMAIN'}  ${recNote.padEnd(28)} https → ${h.status || h.err}${h.headers?.['x-antired'] ? ' x-antired=' + h.headers['x-antired'] : ''}${h.status === 301 || h.status === 302 ? ' → ' + host(h.headers.location) : ''}`)
    if (edgeErr) problems.push(`${dom} returned CF ${h.status} (origin/tunnel unreachable)`)
    if (recNote.includes('ORIGIN LEAK')) problems.push(`${dom} A record leaks origin IP`)
  }
  console.log(`  sample summary: ${viaTunnel} served via CF/tunnel, ${notOnCf} not on Cloudflare (external DNS / expired), ${cfEdgeErr} CF edge errors`)

  console.log('\n═══ RESULT ═══')
  if (warnings.length) console.log(`⚠️  ${warnings.length} warning(s):\n   - ` + warnings.join('\n   - '))
  if (problems.length) { console.log(`❌ ${problems.length} problem(s):\n   - ` + problems.join('\n   - ')); process.exit(2) }
  console.log('✅ Tunnel + bridge domains healthy against production WHM.')
})().catch(e => { console.error('FATAL', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300) || e.message); process.exit(1) })
