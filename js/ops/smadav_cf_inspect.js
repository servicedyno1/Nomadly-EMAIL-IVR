#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Read-only Cloudflare inspection for smadavspeech.com + smadavhost.com zones. */
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

function cf(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.cloudflare.com/client/v4' + pathname, {
      method: 'GET',
      headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json' },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 300))) } }) })
    req.on('error', reject); req.end()
  })
}

;(async () => {
  const zones = process.argv.slice(2)
  const wanted = zones.length ? zones : ['smadavspeech.com', 'smadavhost.com']
  for (const zname of wanted) {
    const zr = await cf(`/zones?name=${encodeURIComponent(zname)}`)
    if (!zr.success) { console.log(`\n### ${zname}: ZONE QUERY FAILED: ${JSON.stringify(zr.errors)}`); continue }
    if (!zr.result.length) { console.log(`\n### ${zname}: NO ZONE on this Cloudflare account`); continue }
    const zone = zr.result[0]
    console.log(`\n### ZONE ${zone.name}  id=${zone.id}  status=${zone.status}`)
    console.log(`    nameservers: ${(zone.name_servers||[]).join(', ')}`)
    const rr = await cf(`/zones/${zone.id}/dns_records?per_page=200`)
    if (!rr.success) { console.log(`    records query failed: ${JSON.stringify(rr.errors)}`); continue }
    const recs = rr.result.sort((a,b)=> a.name.localeCompare(b.name))
    console.log(`    ${recs.length} DNS records:`)
    for (const r of recs) {
      console.log(`      ${String(r.type).padEnd(6)} ${r.name.padEnd(38)} → ${String(r.content).slice(0,60)}  proxied=${r.proxied}`)
    }
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
