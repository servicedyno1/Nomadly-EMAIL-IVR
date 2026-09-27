#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Update SAMDAV env vars: bare smadav domains -> 1.* subdomains. Leaves SIP untouched. Dry-run unless --apply. */
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
const APPLY = process.argv.includes('--apply')

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

// keys we intend to migrate (panel/call host swap). SIP is intentionally excluded.
const TARGET_KEYS = ['CALL_PAGE_URL', 'PANEL_DOMAIN', 'SMS_APP_LINK', 'BRAND_LOGO_URL', 'REACT_APP_PANEL_DOMAIN', 'REACT_APP_BRAND_LOGO_URL', 'REACT_APP_BRAND_FAVICON_URL']

function migrate(v) {
  if (v == null) return v
  let out = v
  // panel host: bare -> 1.panel  (guard against double-prefix)
  out = out.replace(/(^|[^.\w])panel\.smadavhost\.com/g, (m, p1) => `${p1}1.panel.smadavhost.com`)
  // call/speech host on non-sip usages: bare smadavspeech.com -> 1.smadavspeech.com (guard: not already 1. and not sip.)
  out = out.replace(/(^|[^.\w])smadavspeech\.com/g, (m, p1) => `${p1}1.smadavspeech.com`)
  return out
}

;(async () => {
  const vr = await must(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: PROJECT, e: ENVIRON, s: SERVICE }, 'variables')
  const vars = vr.variables || {}
  const updates = {}
  console.log('=== planned changes ===')
  for (const k of TARGET_KEYS) {
    if (!(k in vars)) { console.log(`  (skip ${k}: not set)`); continue }
    const nv = migrate(vars[k])
    if (nv !== vars[k]) { updates[k] = nv; console.log(`  ~ ${k}: ${vars[k]}  ->  ${nv}`) }
    else console.log(`  = ${k}: unchanged (${vars[k]})`)
  }

  // full safety scan: any OTHER var still referencing the bare hosts (excluding sip.* and already-1.* )
  console.log('\n=== safety scan: other vars referencing bare panel/call hosts ===')
  const suspicious = []
  for (const [k, v] of Object.entries(vars)) {
    if (TARGET_KEYS.includes(k)) continue
    const s = String(v)
    // bare panel.smadavhost.com not preceded by a dot/word, and bare smadavspeech.com not part of sip. or 1.
    const barePanel = /(^|[^.\w])panel\.smadavhost\.com/.test(s)
    const bareSpeech = /(^|[^.\w])smadavspeech\.com/.test(s) && !/sip\.smadavspeech\.com/.test(s.replace(/[^.\w]smadavspeech\.com/g, ''))
    const bareSpeechAny = /smadavspeech\.com/.test(s)
    if (barePanel || (bareSpeechAny && !/^sip\.smadavspeech\.com$/.test(s))) suspicious.push([k, v])
  }
  if (!suspicious.length) console.log('  none')
  else for (const [k, v] of suspicious) console.log(`  ? ${k} = ${v}`)

  if (!APPLY) { console.log('\n(dry-run — pass --apply to write)'); return }
  if (!Object.keys(updates).length) { console.log('\nnothing to update'); return }
  await must(`mutation($i:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$i) }`, { i: { projectId: PROJECT, environmentId: ENVIRON, serviceId: SERVICE, variables: updates, replace: false } }, 'variableCollectionUpsert')
  console.log(`\n[railway] upserted ${Object.keys(updates).length} vars: ${Object.keys(updates).join(', ')}`)
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
