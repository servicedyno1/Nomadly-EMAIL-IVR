#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Attach 1.smadavspeech.com + 1.panel.smadavhost.com to the SAMDAV Railway service and print required DNS. */
const fs = require('fs')
const path = require('path')
const https = require('https')

const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
const ENDPOINT = 'https://backboard.railway.com/graphql/v2'
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
const TOKEN = process.env.RAILWAY_TOKEN || local.API_KEY_RAILWAY
const PROJECT = '0f41a48b-d2f6-4be5-acbd-524c6df6d2c6'
const ENVIRON = 'b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const SERVICE = '6d40a2dd-dfdf-4d05-9c68-4962a065885c' // SAMDAV
const DOMAINS = ['1.smadavspeech.com', '1.panel.smadavhost.com']

function gql(query, variables) {
  const body = JSON.stringify({ query, variables: variables || {} })
  const headers = { 'Content-Type': 'application/json', 'Project-Access-Token': TOKEN, Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, { method: 'POST', headers }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`)) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}
async function must(q, v, label) { const r = await gql(q, v); if (r.errors) throw new Error(`${label}: ${JSON.stringify(r.errors).slice(0, 500)}`); return r.data }

;(async () => {
  // existing custom domains on SAMDAV
  const si = await must(`query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ domains{ customDomains{ id domain } } } }`, { s: SERVICE, e: ENVIRON }, 'serviceInstance')
  const existing = new Set((si.serviceInstance.domains.customDomains || []).map(x => x.domain))
  for (const domain of DOMAINS) {
    if (existing.has(domain)) { console.log(`= ${domain} already attached to SAMDAV`); continue }
    const r = await gql(`mutation($i:CustomDomainCreateInput!){ customDomainCreate(input:$i){ id domain } }`, { i: { domain, environmentId: ENVIRON, projectId: PROJECT, serviceId: SERVICE } })
    if (r.errors) { console.log(`✗ ${domain}: ${r.errors[0].message}`); continue }
    console.log(`+ ${domain} attached`)
  }
  // read back required DNS records
  const d = await must(`query($p:String!,$s:String!,$e:String!){ domains(projectId:$p, serviceId:$s, environmentId:$e){ customDomains{ domain status{ certificateStatus dnsRecords{ hostlabel requiredValue currentValue status recordType zone } verificationDnsHost verificationToken } } } }`, { p: PROJECT, s: SERVICE, e: ENVIRON }, 'domains')
  console.log('\n=== Required DNS records (Railway) ===')
  const plan = []
  for (const c of d.domains.customDomains || []) {
    if (!DOMAINS.includes(c.domain)) continue
    const st = c.status || {}
    console.log(`\n${c.domain}: cert=${(st.certificateStatus || '').replace('CERTIFICATE_STATUS_TYPE_', '')}`)
    for (const rec of st.dnsRecords || []) {
      const type = rec.recordType.replace('DNS_RECORD_TYPE_', '')
      const host = rec.hostlabel ? `${rec.hostlabel}.${rec.zone}` : rec.zone
      console.log(`  ${type} ${host} → ${rec.requiredValue}  (current=${rec.currentValue || '-'} ${rec.status.replace('DNS_RECORD_STATUS_', '')})`)
      plan.push({ domain: c.domain, zone: rec.zone, type, host, value: rec.requiredValue })
    }
    if (st.verificationDnsHost) { console.log(`  TXT ${st.verificationDnsHost} → ${st.verificationToken}`); plan.push({ domain: c.domain, zone: c.domain.split('.').slice(-2).join('.'), type: 'TXT', host: st.verificationDnsHost, value: st.verificationToken }) }
  }
  fs.writeFileSync('/tmp/smadav_railway_dns.json', JSON.stringify(plan, null, 2))
  console.log('\nwrote /tmp/smadav_railway_dns.json')
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
