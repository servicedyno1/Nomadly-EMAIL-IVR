#!/usr/bin/env node
/* Read-only: dump a Railway service's production variables to a .env file (values never printed).
   usage: node js/ops/railway_env_dump.js <serviceId> <outFile> */
const fs = require('fs')
const path = require('path')
const https = require('https')

const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
const ENDPOINT = 'https://backboard.railway.com/graphql/v2'
const PROJECT = '0f41a48b-d2f6-4be5-acbd-524c6df6d2c6'
const ENVIRON = 'b9a9e5d2-0f71-42c4-925b-ac843adcb656'

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
const [serviceId, outFile] = process.argv.slice(2)
if (!serviceId || !outFile) { console.error('usage: railway_env_dump.js <serviceId> <outFile>'); process.exit(2) }

function gql(token, query, variables) {
  const body = JSON.stringify({ query, variables })
  const headers = { 'Content-Type': 'application/json', 'Project-Access-Token': token, Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, { method: 'POST', headers }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`)) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}

const quote = v => /[\s#"'\\$]/.test(v) ? JSON.stringify(v) : v

;(async () => {
  const q = `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`
  let vars = null, lastErr = null
  for (const [label, token] of [['project-token', local.API_KEY_RAILWAY], ['account-token', local.RAILWAY_ACCOUNT_TOKEN]]) {
    if (!token) continue
    const r = await gql(token, q, { p: PROJECT, e: ENVIRON, s: serviceId })
    if (r.errors) { lastErr = `${label}: ${JSON.stringify(r.errors).slice(0, 300)}`; continue }
    vars = r.data.variables; console.log(`fetched via ${label}`); break
  }
  if (!vars) throw new Error(lastErr || 'no token')
  const keys = Object.keys(vars).sort()
  const lines = keys.map(k => `${k}=${quote(String(vars[k]))}`)
  fs.writeFileSync(outFile, lines.join('\n') + '\n', { mode: 0o600 })
  console.log(`wrote ${keys.length} vars → ${outFile}`)
  console.log('keys:', keys.join(' '))
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
