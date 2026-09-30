#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Set up Cloudflare 301 redirects: bare smadav hosts -> 1.* hosts (path+query preserved).
 * Flips the old host DNS record to proxied (so CF edge handles it) and installs a
 * dynamic redirect rule in each zone's http_request_dynamic_redirect entrypoint.
 * Does NOT touch sip.smadavspeech.com. */
const fs = require('fs')
const path = require('path')
const https = require('https')

const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const local = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'))
const CF_KEY = local.CLOUDFLARE_API_KEY
const CF_EMAIL = local.CLOUDFLARE_EMAIL

function cf(method, pathname, body) {
  const payload = body ? JSON.stringify(body) : null
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.cloudflare.com/client/v4' + pathname, {
      method,
      headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 300))) } }) })
    req.on('error', reject); if (payload) req.write(payload); req.end()
  })
}
async function zoneId(name) {
  const r = await cf('GET', `/zones?name=${encodeURIComponent(name)}`)
  if (!r.success || !r.result.length) throw new Error(`zone ${name} not found`)
  return r.result[0].id
}

const MOVES = [
  { zone: 'smadavspeech.com', oldHost: 'smadavspeech.com', newHost: '1.smadavspeech.com' },
  { zone: 'smadavhost.com', oldHost: 'panel.smadavhost.com', newHost: '1.panel.smadavhost.com' },
]

async function ensureProxied(zid, host) {
  const r = await cf('GET', `/zones/${zid}/dns_records?name=${encodeURIComponent(host)}`)
  if (!r.success || !r.result.length) { console.log(`  ! no DNS record for ${host} — skipping proxy flip`); return }
  const rec = r.result.find(x => x.type === 'CNAME' || x.type === 'A' || x.type === 'AAAA')
  if (!rec) { console.log(`  ! no proxiable record for ${host}`); return }
  if (rec.proxied) { console.log(`  = ${host} (${rec.type}) already proxied`); return }
  const up = await cf('PUT', `/zones/${zid}/dns_records/${rec.id}`, { type: rec.type, name: rec.name, content: rec.content, ttl: 1, proxied: true })
  console.log(up.success ? `  ~ ${host} (${rec.type}) flipped to proxied` : `  ✗ ${host} proxy flip failed: ${JSON.stringify(up.errors)}`)
}

async function upsertRedirect(zid, oldHost, newHost) {
  const desc = `bare->1. redirect ${oldHost}`
  const rule = {
    action: 'redirect',
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: `concat("https://${newHost}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
    expression: `(http.host eq "${oldHost}")`,
    description: desc,
    enabled: true,
  }
  // read existing entrypoint
  const ep = await cf('GET', `/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`)
  let rules = []
  if (ep.success && ep.result && Array.isArray(ep.result.rules)) rules = ep.result.rules.filter(r => r.description !== desc)
  rules.push(rule)
  const put = await cf('PUT', `/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, { rules })
  console.log(put.success ? `  + redirect rule installed: ${oldHost}/* -> https://${newHost}/* (301)` : `  ✗ redirect rule failed: ${JSON.stringify(put.errors)}`)
}

;(async () => {
  for (const m of MOVES) {
    const zid = await zoneId(m.zone)
    console.log(`\n### ${m.oldHost} -> ${m.newHost} (zone ${m.zone})`)
    await ensureProxied(zid, m.oldHost)
    await upsertRedirect(zid, m.oldHost, m.newHost)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
