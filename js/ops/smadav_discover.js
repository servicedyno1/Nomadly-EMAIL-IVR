#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Read-only discovery: locate the SMADAV project/service on Railway using the account token. */
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
const TOKEN = process.env.RAILWAY_ACCOUNT_TOKEN || local.RAILWAY_ACCOUNT_TOKEN

function gql(query, variables) {
  const body = JSON.stringify({ query, variables: variables || {} })
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, { method: 'POST', headers }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`)) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}

function printProject(p) {
  const svcs = (p.services?.edges || []).map(s => `${s.node.name}[${s.node.id}]`).join(', ')
  const envs = (p.environments?.edges || []).map(s => `${s.node.name}[${s.node.id}]`).join(', ')
  console.log(`\nPROJECT ${p.name}  id=${p.id}`)
  console.log(`  services: ${svcs}`)
  console.log(`  envs:     ${envs}`)
}

;(async () => {
  const r = await gql(`query {
    me {
      email
      workspaces {
        id name
        projects {
          edges { node {
            id name
            services { edges { node { id name } } }
            environments { edges { node { id name } } }
          } }
        }
      }
    }
  }`)
  if (r.errors) { console.error('ERRORS', JSON.stringify(r.errors, null, 2)) }
  const me = r.data && r.data.me
  if (!me) { console.error('no me'); process.exit(1) }
  console.log(`account: <${me.email}>`)
  for (const w of me.workspaces || []) {
    console.log(`\n=== WORKSPACE ${w.name} (${w.id}) ===`)
    const projs = w.projects ? w.projects.edges : []
    for (const e of projs) printProject(e.node)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
