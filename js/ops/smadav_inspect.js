#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Read-only inspect of the SAMDAV (smadav) service on Railway. */
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
const SERVICE = process.argv[2] || '6d40a2dd-dfdf-4d05-9c68-4962a065885c' // SAMDAV

function gql(query, variables) {
  const body = JSON.stringify({ query, variables: variables || {} })
  const headers = { 'Content-Type': 'application/json', 'Project-Access-Token': TOKEN, Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, { method: 'POST', headers }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`)) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}
async function must(q, v, label) { const r = await gql(q, v); if (r.errors) throw new Error(`${label}: ${JSON.stringify(r.errors).slice(0, 500)}`); return r.data }

const mask = s => (s == null ? '(null)' : s.length > 60 ? s.slice(0, 40) + '…' + s.slice(-8) : s)

;(async () => {
  const d = await must(`query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){
    id serviceName source{ repo image }
    domains{ serviceDomains{ id domain } customDomains{ id domain status{ certificateStatus dnsRecords{ hostlabel requiredValue currentValue status recordType zone } } } }
    latestDeployment{ id status createdAt meta } } }`, { s: SERVICE, e: ENVIRON }, 'serviceInstance')
  const si = d.serviceInstance
  console.log(`service   ${si.serviceName} [${SERVICE}]`)
  console.log(`source    ${si.source && (si.source.repo || si.source.image) || '(none)'}`)
  console.log(`public    ${(si.domains.serviceDomains || []).map(x => x.domain).join(', ') || '(none)'}`)
  console.log(`custom    ${(si.domains.customDomains || []).map(x => x.domain).join(', ') || '(none)'}`)
  for (const c of si.domains.customDomains || []) {
    const st = c.status || {}
    console.log(`  [${c.domain}] cert=${(st.certificateStatus||'').replace('CERTIFICATE_STATUS_TYPE_','')}`)
    for (const rec of st.dnsRecords || []) console.log(`     ${rec.recordType.replace('DNS_RECORD_TYPE_','')} ${rec.hostlabel||'@'}.${rec.zone} → ${rec.requiredValue} (cur=${rec.currentValue||'-'} ${rec.status.replace('DNS_RECORD_STATUS_','')})`)
  }
  const ld = si.latestDeployment
  console.log(`latest    ${ld ? `${ld.status} ${ld.createdAt} ${(ld.meta&&ld.meta.commitHash||'').slice(0,8)}` : '(none)'}`)

  const vr = await must(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: PROJECT, e: ENVIRON, s: SERVICE }, 'variables')
  const vars = vr.variables || {}
  console.log(`\nvars      ${Object.keys(vars).length} set`)
  const KEYS = ['CALL_PAGE_URL','PANEL_DOMAIN','SMS_APP_LINK','CPANEL_API_URL','WHM_API_URL','CUSTOM_DOMAIN','SELF_URL','SELF_URL_PROD','CF_TUNNEL_CNAME','LINK_TO_SELF_SERVER','APP_SUPPORT_LINK','CALL_CONNECTION_FEE','CLOUDFLARE_EMAIL','BOT_ENVIRONMENT']
  console.log('\n--- URL / domain related vars ---')
  for (const k of KEYS) if (k in vars) console.log(`  ${k} = ${mask(vars[k])}`)
  console.log('\n--- any var whose value mentions smadav/speech/host/panel ---')
  for (const [k,v] of Object.entries(vars)) {
    if (/smadav|speech|hostbay|smadavhost|panel\.|\/call/i.test(String(v))) console.log(`  ${k} = ${mask(v)}`)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
