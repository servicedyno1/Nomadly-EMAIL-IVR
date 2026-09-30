#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/*
 * Railway production bootstrap for the Nomadly bot (new project).
 *
 * Target IDs come from /app/backend/.env: RAILWAY_PROD_PROJECT_ID / RAILWAY_PROD_SERVICE_ID / RAILWAY_PROD_ENVIRONMENT_ID.
 * Token: RAILWAY_TOKEN env var (fallback: API_KEY_RAILWAY in backend/.env). Both header styles are sent.
 * Legacy production values (MONGO_URL, prod-only flags, working provider keys) come from the encrypted
 * snapshot /app/memory/railway_newhosting_prod_vars.enc (VAULT_PASSWORD env required).
 *
 * Commands:
 *   inspect            project / service / env / source repo / domains / latest deployment
 *   plan               dry-run — composed production variable set vs current target vars (values masked)
 *   apply              upsert the composed variable set (creates a public *.up.railway.app domain if missing)
 *   verify             readback — every planned key present on the target with the planned value
 *   connect            connect the GitHub repo (--repo owner/name --branch main)
 *   deploy             trigger a deployment from the connected repo (latest commit)
 *   domains            attach legacy custom domains and print the DNS records Railway requires
 *   status             recent deployments + tail of the latest deploy logs
 *   plan --json FILE   also write the composed set to FILE (plaintext — keep out of git)
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { execFileSync } = require('child_process')

const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
const SNAPSHOT = '/app/memory/railway_newhosting_prod_vars.enc'
const ENDPOINT = 'https://backboard.railway.com/graphql/v2'

const SANDBOX_ONLY = new Set(['SKIP_WEBHOOK_SYNC', 'API_KEY_RAILWAY_NEW_HOSTING'])
const PROD_FIXED = { BOT_ENVIRONMENT: 'production', VPS_RDP_PROVIDER: 'digitalocean-rdp', HIDE_SMS_APP: 'true' }
const FROM_LEGACY = ['MONGO_URL', 'RESELLER_API_LIVE', 'MARKETPLACE_ACCESS_FEE_USD', 'CPANEL_SELFHEAL_WRITES', 'CPPASS_ROTATION_COOLDOWN_MIN']
const LEGACY_CUSTOM_DOMAINS = ['2.speechcue.com', 'panel.2.hostbay.io']

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def }
const has = name => process.argv.includes('--' + name)

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
const PROJECT = local.RAILWAY_PROD_PROJECT_ID
const SERVICE = local.RAILWAY_PROD_SERVICE_ID
const ENVIRON = local.RAILWAY_PROD_ENVIRONMENT_ID
const TOKEN = process.env.RAILWAY_TOKEN || local.API_KEY_RAILWAY
if (!PROJECT || !SERVICE || !ENVIRON) { console.error('RAILWAY_PROD_* ids missing in backend/.env'); process.exit(1) }
if (!TOKEN) { console.error('no RAILWAY_TOKEN'); process.exit(1) }

const mask = s => (s == null ? '(null)' : s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-3) : s)

function gql(query, variables) {
  const body = JSON.stringify({ query, variables: variables || {} })
  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Project-Access-Token': TOKEN,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`)) } })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}
async function must(query, variables, label) {
  const r = await gql(query, variables)
  if (r.errors) throw new Error(`${label || 'gql'}: ${JSON.stringify(r.errors).slice(0, 500)}`)
  return r.data
}

function legacyVars() {
  const pass = process.env.VAULT_PASSWORD
  if (!pass) throw new Error('VAULT_PASSWORD required to read legacy production snapshot')
  const out = execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', SNAPSHOT, '-pass', 'pass:' + pass], { stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out.toString('utf8'))
}

async function serviceInstance() {
  const d = await must(`query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){
    id serviceName startCommand buildCommand rootDirectory healthcheckPath builder restartPolicyType restartPolicyMaxRetries
    source{ repo image } domains{ serviceDomains{ id domain } customDomains{ id domain status{ dnsRecords{ hostlabel requiredValue currentValue status recordType } } } }
    latestDeployment{ id status createdAt meta } } }`, { s: SERVICE, e: ENVIRON }, 'serviceInstance')
  return d.serviceInstance
}
async function targetVars() {
  const d = await must(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: PROJECT, e: ENVIRON, s: SERVICE }, 'variables')
  return d.variables || {}
}
async function ensureServiceDomain(si, create) {
  const existing = si.domains && si.domains.serviceDomains && si.domains.serviceDomains[0]
  if (existing) return existing.domain
  if (!create) return null
  const d = await must(`mutation($i:ServiceDomainCreateInput!){ serviceDomainCreate(input:$i){ id domain } }`, { i: { environmentId: ENVIRON, serviceId: SERVICE } }, 'serviceDomainCreate')
  console.log(`[railway] created public domain ${d.serviceDomainCreate.domain}`)
  return d.serviceDomainCreate.domain
}

function compose(selfDomain, legacy) {
  const vars = {}
  for (const [k, v] of Object.entries(local)) {
    if (SANDBOX_ONLY.has(k) || k.startsWith('RAILWAY_')) continue
    vars[k] = v
  }
  Object.assign(vars, PROD_FIXED)
  const preferLegacy = (arg('prefer-legacy', '') || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const k of [...FROM_LEGACY, ...preferLegacy]) {
    if (legacy[k] == null) throw new Error(`legacy snapshot lacks ${k}`)
    vars[k] = legacy[k]
  }
  if (selfDomain) { vars.SELF_URL = `https://${selfDomain}`; vars.SELF_URL_PROD = `https://${selfDomain}` }
  vars.API_KEY_RAILWAY = TOKEN
  return vars
}

function diff(planned, current) {
  const add = [], change = [], same = []
  for (const k of Object.keys(planned).sort()) {
    if (!(k in current)) add.push(k)
    else if (current[k] !== planned[k]) change.push(k)
    else same.push(k)
  }
  const extra = Object.keys(current).filter(k => !(k in planned) && !k.startsWith('RAILWAY_')).sort()
  return { add, change, same, extra }
}

async function cmdInspect() {
  const d = await must(`query($p:String!){ project(id:$p){ id name services{ edges{ node{ id name } } } environments{ edges{ node{ id name } } } } }`, { p: PROJECT }, 'project')
  const p = d.project
  console.log(`project  ${p.name} (${p.id})`)
  console.log('services ', p.services.edges.map(e => `${e.node.name} ${e.node.id}${e.node.id === SERVICE ? '  <== target' : ''}`).join('\n         '))
  console.log('envs     ', p.environments.edges.map(e => `${e.node.name} ${e.node.id}${e.node.id === ENVIRON ? '  <== target' : ''}`).join('\n         '))
  const si = await serviceInstance()
  console.log(`service  ${si.serviceName}  source=${si.source && (si.source.repo || si.source.image) || '(none)'}  builder=${si.builder}  start=${si.startCommand || '(railway.json)'}`)
  console.log('domains  ', (si.domains.serviceDomains || []).map(x => x.domain).join(', ') || '(none)')
  console.log('custom   ', (si.domains.customDomains || []).map(x => x.domain).join(', ') || '(none)')
  const ld = si.latestDeployment
  console.log('latest   ', ld ? `${ld.status} ${ld.createdAt} ${(ld.meta && ld.meta.commitHash || '').slice(0, 8)}` : '(no deployments)')
  const cur = await targetVars()
  console.log(`vars     ${Object.keys(cur).length} currently set (${Object.keys(cur).filter(k => !k.startsWith('RAILWAY_')).length} non-RAILWAY_)`)
}

async function cmdPlan(apply) {
  const si = await serviceInstance()
  const selfDomain = await ensureServiceDomain(si, apply)
  const legacy = legacyVars()
  const planned = compose(selfDomain, legacy)
  const current = await targetVars()
  const d = diff(planned, current)
  console.log(`planned ${Object.keys(planned).length} vars → SELF_URL=${planned.SELF_URL || '(no public domain yet — run apply)'}`)
  console.log(`  add ${d.add.length}, change ${d.change.length}, unchanged ${d.same.length}, extra-on-target ${d.extra.length}`)
  for (const k of d.change) console.log(`  ~ ${k}: ${mask(current[k])} → ${mask(planned[k])}`)
  if (d.extra.length) console.log(`  target-only (left untouched): ${d.extra.join(', ')}`)
  const overrides = Object.keys(PROD_FIXED).concat(FROM_LEGACY, ['SELF_URL', 'SELF_URL_PROD', 'API_KEY_RAILWAY'])
  console.log(`  not from sandbox .env: ${overrides.join(', ')}; dropped: ${[...SANDBOX_ONLY].join(', ')}`)
  const jsonOut = arg('json')
  if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(planned, null, 2)); console.log(`  wrote ${jsonOut}`) }
  if (!apply) return
  if (!selfDomain) throw new Error('no public domain — cannot set SELF_URL')
  await must(`mutation($i:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$i) }`,
    { i: { projectId: PROJECT, environmentId: ENVIRON, serviceId: SERVICE, variables: planned, replace: false } }, 'variableCollectionUpsert')
  console.log(`[railway] upserted ${Object.keys(planned).length} variables`)
  await cmdVerify(planned)
}

async function cmdVerify(planned) {
  if (!planned) {
    const si = await serviceInstance()
    planned = compose(await ensureServiceDomain(si, false), legacyVars())
  }
  const current = await targetVars()
  const bad = Object.keys(planned).filter(k => current[k] !== planned[k])
  if (bad.length) { console.log(`❌ ${bad.length} mismatches: ${bad.join(', ')}`); process.exitCode = 2 }
  else console.log(`✅ readback OK — all ${Object.keys(planned).length} planned vars match on Railway`)
}

async function cmdConnect() {
  const repo = arg('repo'), branch = arg('branch', 'main')
  if (!repo) throw new Error('--repo owner/name required')
  const d = await must(`mutation($id:String!,$i:ServiceConnectInput!){ serviceConnect(id:$id, input:$i){ id name } }`, { id: SERVICE, i: { repo, branch } }, 'serviceConnect')
  console.log(`[railway] connected ${d.serviceConnect.name} → ${repo}#${branch}`)
}

async function cmdDeploy() {
  const r = await gql(`mutation($s:String!,$e:String!){ serviceInstanceDeployV2(serviceId:$s, environmentId:$e) }`, { s: SERVICE, e: ENVIRON })
  if (!r.errors) { console.log(`[railway] deployment triggered: ${r.data.serviceInstanceDeployV2}`); return }
  const d = await must(`mutation($s:String!,$e:String!){ serviceInstanceDeploy(serviceId:$s, environmentId:$e, latestCommit:true) }`, { s: SERVICE, e: ENVIRON }, 'serviceInstanceDeploy')
  console.log(`[railway] deployment triggered: ${d.serviceInstanceDeploy}`)
}

async function cmdDomains() {
  const si = await serviceInstance()
  const existing = new Set((si.domains.customDomains || []).map(x => x.domain))
  const wanted = (arg('only', '') ? arg('only').split(',') : LEGACY_CUSTOM_DOMAINS).map(s => s.trim()).filter(Boolean)
  for (const domain of wanted) {
    if (existing.has(domain)) { console.log(`= ${domain} already attached`); continue }
    const r = await gql(`mutation($i:CustomDomainCreateInput!){ customDomainCreate(input:$i){ id domain } }`,
      { i: { domain, environmentId: ENVIRON, projectId: PROJECT, serviceId: SERVICE } })
    if (r.errors) { console.log(`✗ ${domain}: ${r.errors[0].message}`); continue }
    console.log(`+ ${domain} attached`)
  }
  const d = await must(`query($p:String!,$s:String!,$e:String!){ domains(projectId:$p, serviceId:$s, environmentId:$e){ customDomains{ domain status{ certificateStatus dnsRecords{ hostlabel requiredValue currentValue status recordType zone } verificationDnsHost verificationToken } } } }`,
    { p: PROJECT, s: SERVICE, e: ENVIRON }, 'domains')
  for (const c of d.domains.customDomains || []) {
    const st = c.status || {}
    console.log(`${c.domain}: cert=${(st.certificateStatus || '').replace('CERTIFICATE_STATUS_TYPE_', '')}`)
    for (const rec of st.dnsRecords || []) console.log(`  ${rec.recordType.replace('DNS_RECORD_TYPE_', '')} ${rec.hostlabel || '@'}.${rec.zone} → ${rec.requiredValue}  (current=${rec.currentValue || '-'} ${rec.status.replace('DNS_RECORD_STATUS_', '')})`)
    if (st.verificationDnsHost) console.log(`  TXT ${st.verificationDnsHost} → ${st.verificationToken}`)
  }
}

async function cmdStatus() {
  const d = await must(`query($p:String!,$e:String!,$s:String!){ deployments(first:8, input:{ projectId:$p, environmentId:$e, serviceId:$s }){ edges{ node{ id status createdAt meta } } } }`, { p: PROJECT, e: ENVIRON, s: SERVICE }, 'deployments')
  const rows = d.deployments.edges.map(e => e.node)
  if (!rows.length) { console.log('(no deployments yet)'); return }
  for (const n of rows) console.log(`${n.status.padEnd(12)} ${n.createdAt} ${n.id.slice(0, 8)} ${(n.meta && n.meta.commitHash || '').slice(0, 8)} ${(n.meta && n.meta.commitMessage || '').split('\n')[0].slice(0, 60)}`)
  const latest = rows[0]
  const which = ['BUILDING', 'FAILED', 'INITIALIZING'].includes(latest.status) && has('build') ? 'buildLogs' : 'deploymentLogs'
  const l = await gql(`query($id:String!){ ${which}(deploymentId:$id, limit:40){ timestamp message } }`, { id: latest.id })
  if (l.errors) { console.log('logs:', l.errors[0].message); return }
  for (const x of l.data[which] || []) console.log(`  ${x.timestamp.slice(11, 19)} ${x.message.slice(0, 180)}`)
}

const cmd = process.argv[2]
;(async () => {
  switch (cmd) {
    case 'inspect': return cmdInspect()
    case 'plan': return cmdPlan(false)
    case 'apply': return cmdPlan(true)
    case 'verify': return cmdVerify()
    case 'connect': return cmdConnect()
    case 'deploy': return cmdDeploy()
    case 'domains': return cmdDomains()
    case 'status': return cmdStatus()
    default: console.log('usage: railway_setup_prod.js inspect|plan|apply|verify|connect|deploy|domains|status'); process.exit(1)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
