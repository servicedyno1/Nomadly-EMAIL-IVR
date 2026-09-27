#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// Reseller status-API end-to-end  (js/ops/rdp_status_api_e2e.js)
// ------------------------------------------------------------
// Creates ONE real Windows RDP order exactly like the reseller API would
// (provider.createInstance + vpsPlansOf record for the sandbox key's owner),
// then polls the PUBLIC endpoint GET /api/reseller/v1/rdp/:id every 10 s and
// prints the `provisioning` block (stage, progress, ETA countdown, steps).
// When credentials_ready flips true it reads /credentials, checks the RDP
// login (xfreerdp +auth-only) and destroys the droplet.
//
//   node js/ops/rdp_status_api_e2e.js [--os ws2019] [--region US] [--plan starter-1m] [--wait-min 15]
//
// ⚠ Billable: one droplet for a few minutes (~$0.01). Local Mongo of this pod.
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
const { MongoClient } = require('mongodb')
const axios = require('axios')
const crypto = require('crypto')
const { spawnSync, spawn } = require('child_process')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const OS = String(arg('os', 'ws2019')), REGION = String(arg('region', 'US')), PLAN = String(arg('plan', 'starter-1m')), WAIT_MIN = Number(arg('wait-min', 15))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const BASE = String(process.env.SELF_URL || '').replace(/\/+$/, '') + '/reseller/v1'
const KEY = process.env.RDP_E2E_API_KEY || 'nmdly_e2e_51573577f5db956c5c0cb039'
const api = (m, p) => axios({ method: m, url: `${BASE}${p}`, headers: { 'X-API-Key': KEY }, timeout: 30000, validateStatus: () => true })

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js')
  if (!svc.init(db)) throw new Error('service init failed')
  const key = await db.collection('resellerApiKeys').findOne({ _id: 'e2e-golden-key' })
  if (!key) throw new Error('sandbox reseller key e2e-golden-key missing (see memory/test_credentials.md)')

  const t0 = Date.now()
  const inst = await svc.createInstance({ productId: PLAN, regionSlug: REGION, osId: OS, label: 'status-api-e2e' })
  // Never leak a billable droplet if this process is killed (pause / Ctrl-C).
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`\n${sig} → destroying droplet of ${inst.instanceId}`); svc.cancelInstance(inst.instanceId).catch(() => {}).then(() => process.exit(1)) })
  const vpsId = crypto.randomUUID()
  await db.collection('vpsPlansOf').insertOne({ _id: vpsId, chatId: String(key.ownerChatId), vpsId, provider: svc.PROVIDER, instanceId: inst.instanceId, host: null, region: REGION, productId: PLAN, plan: PLAN, osType: 'windows', osId: OS, isRDP: true, status: 'provisioning', rootPasswordSecretId: inst.passwordSecretId, source: 'reseller_api', start_time: new Date(), timestamp: new Date() })
  console.log(`[${ts()}] order ${vpsId} → instance ${inst.instanceId} fastDeploy=${inst.fastDeploy} eta=${inst.etaMinutes}min`)

  let last = null, lastStage = ''
  while (Date.now() - t0 < WAIT_MIN * 60000) {
    const r = await api('get', `/rdp/${vpsId}`)
    if (r.status !== 200) { console.log(`[${ts()}] GET /rdp/:id → HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); await sleep(10000); continue }
    last = r.data
    const p = last.provisioning || {}
    const line = `${p.status}/${p.stage} ${p.progress}% eta=${p.eta_seconds}s elapsed=${p.elapsed_seconds}s steps=${(p.steps || []).map(s => s.done ? '■' : (s.current ? '▶' : '□')).join('')} creds=${last.credentials_ready} ip=${last.ip}`
    if (line !== lastStage) { console.log(`[${ts()}] +${Math.round((Date.now() - t0) / 1000)}s ${line}  «${p.stage_label}»`); lastStage = line }
    if (last.credentials_ready || p.status === 'failed') break
    await sleep(10000)
  }
  const secs = Math.round((Date.now() - t0) / 1000)
  const shapeOk = last && last.provisioning && ['status', 'stage', 'stage_label', 'progress', 'fast_deploy', 'eta_seconds', 'elapsed_seconds', 'credentials_ready', 'steps', 'logs'].every(k => k in last.provisioning)
  console.log(`\n[${ts()}] final: status=${last && last.status} credentials_ready=${last && last.credentials_ready} credentials_url=${last && last.credentials_url} time_to_active_s=${last && last.provisioning && last.provisioning.time_to_active_s} password_confirmed=${last && last.provisioning && last.provisioning.password_confirmed} shape_ok=${shapeOk} after ${(secs / 60).toFixed(1)} min`)

  let credsOk = null, authOk = null
  if (last && last.credentials_ready) {
    const c = await api('get', `/rdp/${vpsId}/credentials`)
    console.log(`[${ts()}] GET /credentials → ${c.status} ip=${c.data.ip} user=${c.data.username} mode=${c.data.mode} password=${c.data.mode === 'live' ? '(revealed)' : c.data.password}`)
    credsOk = c.status === 200 && c.data.ip === last.ip && c.data.username === 'Administrator'
    let xvfb = null
    if (!process.env.DISPLAY) { try { xvfb = spawn('Xvfb', [':97', '-screen', '0', '640x480x16'], { stdio: 'ignore' }); await sleep(1500) } catch (_) {} }
    // The password is applied by apply.ps1 shortly after 3389 opens - allow a couple of minutes if the callback did not arrive.
    for (let k = 0; k < 8 && authOk !== true; k++) {
      const r = spawnSync('xfreerdp', [`/v:${last.ip}`, '/u:Administrator', `/p:${inst.defaultPassword}`, '/cert:ignore', '+auth-only', '/sec:nla'], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':97' }, encoding: 'utf8', timeout: 60000 })
      if (r.error && r.error.code === 'ENOENT') { console.log(`[${ts()}] RDP credential check skipped (xfreerdp not installed)`); break }
      const out = `${r.stdout || ''}\n${r.stderr || ''}`
      const m = out.match(/Authentication only, exit status (\d+)/)
      authOk = !!(m && m[1] === '0')
      console.log(`[${ts()}] RDP credential check #${k + 1}: ${authOk ? 'OK (NLA login with the per-order password)' : 'FAILED ' + (m ? 'exit ' + m[1] : 'no result') + ' ' + ((out.match(/STATUS_[A-Z_]+/) || [''])[0])}`)
      if (!authOk) await sleep(15000)
    }
    if (xvfb) xvfb.kill()
  }
  if (authOk === false && arg('keep-on-fail', false)) { console.log(`\nKEEPING droplet for diagnosis: ${last.ip} Administrator / ${inst.defaultPassword} (instance ${inst.instanceId})`); await client.close(); process.exit(1) }
  await svc.cancelInstance(inst.instanceId)
  await db.collection('vpsPlansOf').updateOne({ _id: vpsId }, { $set: { status: 'destroyed' } })
  console.log(`[${ts()}] droplet destroyed.`)
  await client.close()
  const pass = !!(last && last.credentials_ready && shapeOk && credsOk !== false && authOk !== false)
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} — ${OS} status API ${last && last.status} in ${(secs / 60).toFixed(1)} min`)
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
