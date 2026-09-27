#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Read-only: print DynoPay/BlockBee/payment vars for a Railway service. */
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
const SERVICE = process.argv[2] || '6d40a2dd-dfdf-4d05-9c68-4962a065885c'
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
;(async () => {
  const vr = await must(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: PROJECT, e: ENVIRON, s: SERVICE }, 'variables')
  const vars = vr.variables || {}
  console.log('TOTAL', Object.keys(vars).length)
  for (const k of Object.keys(vars).sort()) {
    if (/DYNO|BLOCKBEE|CRYPTO|COINGATE|^BRAND$|PAYMENT/i.test(k)) console.log(`${k}=${vars[k]}`)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
