#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Create the Railway-required Cloudflare records for the SMADAV 1.* subdomains. Idempotent. */
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

// full record names (Cloudflare uses fully-qualified names)
const RECORDS = [
  { zone: 'smadavspeech.com', type: 'CNAME', name: '1.smadavspeech.com', content: 'llk705wd.up.railway.app', proxied: false },
  { zone: 'smadavspeech.com', type: 'TXT', name: '_railway-verify.1.smadavspeech.com', content: 'railway-verify=e757693cd92954d4e398e33d897a07a9ccadd27abb0cac2235ba3c499459bb30' },
  { zone: 'smadavhost.com', type: 'CNAME', name: '1.panel.smadavhost.com', content: 'pb5ueh4h.up.railway.app', proxied: false },
  { zone: 'smadavhost.com', type: 'TXT', name: '_railway-verify.1.panel.smadavhost.com', content: 'railway-verify=dfe70edbc5689a1ef543193a558050d460b658c418c11721c59d8962de9ed64e' },
]

;(async () => {
  const zids = {}
  for (const r of RECORDS) if (!zids[r.zone]) zids[r.zone] = await zoneId(r.zone)
  for (const rec of RECORDS) {
    const zid = zids[rec.zone]
    const existing = await cf('GET', `/zones/${zid}/dns_records?type=${rec.type}&name=${encodeURIComponent(rec.name)}`)
    const payload = { type: rec.type, name: rec.name, content: rec.content, ttl: 1 }
    if (rec.type === 'CNAME') payload.proxied = !!rec.proxied
    if (existing.success && existing.result.length) {
      const cur = existing.result[0]
      if (cur.content === rec.content && (rec.type !== 'CNAME' || cur.proxied === !!rec.proxied)) { console.log(`= ${rec.type} ${rec.name} already correct`); continue }
      const up = await cf('PUT', `/zones/${zid}/dns_records/${cur.id}`, payload)
      console.log(up.success ? `~ ${rec.type} ${rec.name} updated` : `✗ ${rec.type} ${rec.name} update failed: ${JSON.stringify(up.errors)}`)
      continue
    }
    const cr = await cf('POST', `/zones/${zid}/dns_records`, payload)
    console.log(cr.success ? `+ ${rec.type} ${rec.name} created (proxied=${!!rec.proxied})` : `✗ ${rec.type} ${rec.name} create failed: ${JSON.stringify(cr.errors)}`)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
