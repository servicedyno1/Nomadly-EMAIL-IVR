#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY: prove each bot's Railway token + PROJECT/ENV/SERVICE ids can drive the
 * custom-domain API used by saveDomainInServerRailway (list customDomains for its own service). */
const fs = require('fs'), path = require('path'), https = require('https')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8'))
const PROJECT = '0f41a48b-d2f6-4be5-acbd-524c6df6d2c6', ENVIRON = 'b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const SERVICES = { Nomadly: '73e2050b-586d-41d4-a1b5-6b0914e7a0f9', SMADAV: '6d40a2dd-dfdf-4d05-9c68-4962a065885c' }

function gql(token, query, endpoint = 'https://backboard.railway.com/graphql/v2') {
  const body = JSON.stringify({ query })
  const headers = { 'Content-Type': 'application/json', 'Project-Access-Token': token, Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((res, rej) => { const r = https.request(endpoint, { method: 'POST', headers, timeout: 30000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(new Error('HTTP ' + x.statusCode + ': ' + d.slice(0, 200))) } }) }); r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('timeout')) }); r.write(body); r.end() })
}

;(async () => {
  // Each bot on Railway carries its OWN API_KEY_RAILWAY. Fetch each service's token from Railway itself.
  const svcVars = {}
  for (const [name, id] of Object.entries(SERVICES)) {
    const r = await gql(N.API_KEY_RAILWAY, `query{ variables(projectId:"${PROJECT}", environmentId:"${ENVIRON}", serviceId:"${id}") }`)
    svcVars[name] = r.data?.variables || {}
  }
  for (const [name, id] of Object.entries(SERVICES)) {
    const v = svcVars[name]
    const token = v.API_KEY_RAILWAY
    console.log(`\n═══ ${name} (service ${id.slice(0, 8)}…) ═══`)
    console.log(`  ids on prod: PROJECT=${v.RAILWAY_PROJECT_ID === PROJECT ? 'OK' : v.RAILWAY_PROJECT_ID} ENV=${v.RAILWAY_ENVIRONMENT_ID === ENVIRON ? 'OK' : v.RAILWAY_ENVIRONMENT_ID} SERVICE=${v.RAILWAY_SERVICE_ID === id ? 'OK (self)' : 'MISMATCH ' + v.RAILWAY_SERVICE_ID}`)
    console.log(`  API_KEY_RAILWAY: ${token ? token.slice(0, 8) + '… (len ' + token.length + ')' : 'MISSING'}`)
    if (!token) { console.log('  ❌ no token → domain save would fail'); continue }
    // Exactly the query saveDomainInServerRailway/list uses:
    const q = `query { domains(projectId:"${v.RAILWAY_PROJECT_ID}", serviceId:"${v.RAILWAY_SERVICE_ID}", environmentId:"${v.RAILWAY_ENVIRONMENT_ID}") { customDomains { domain } serviceDomains { domain } } }`
    try {
      const r = await gql(token, q)
      if (r.errors) { console.log('  ❌ API error:', JSON.stringify(r.errors).slice(0, 200)); continue }
      const cd = r.data?.domains?.customDomains || []
      const sd = r.data?.domains?.serviceDomains || []
      console.log(`  ✅ Railway domain API works with this token+ids → customDomains=${cd.length}, serviceDomains=${sd.map(d => d.domain).join(',') || '-'}`)
      console.log(`     sample customDomains: ${cd.slice(0, 5).map(d => d.domain).join(', ') || '(none yet)'}`)
    } catch (e) { console.log('  ❌', e.message) }
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
