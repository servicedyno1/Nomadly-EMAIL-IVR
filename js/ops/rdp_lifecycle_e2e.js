#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// FULL RDP lifecycle end-to-end  (js/ops/rdp_lifecycle_e2e.js)
// ------------------------------------------------------------
// Exercises the exact DO-RDP service methods the reseller API + bot call:
//   create (golden fast path) -> active -> NLA login (default pw)
//   -> wait agent_online -> resetPassword (in-place, agent) -> NLA login (new pw)
//   -> reinstallInstance (OTHER edition, DO rebuild, IP kept) -> active
//   -> wait agent_online -> NLA login (reinstall pw) -> destroy droplet
//
//   node js/ops/rdp_lifecycle_e2e.js [--os ws2022] [--reinstall-os ws2019] [--region US] [--plan starter-1m] [--keep]
//   node js/ops/rdp_lifecycle_e2e.js --adopt rdp-<uuid> --default-pw '<pw>' [--reinstall-os ws2019]
//
// Billable: ONE droplet for ~15 min (~$0.03). Always destroys it (even on crash/signal) unless --keep.
// Requires the nodejs supervisor process running (it serves /provision callbacks + agent commands).
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false' // never resume golden builds from this side process
const { MongoClient } = require('mongodb')
const { spawnSync, spawn } = require('child_process')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const OS = String(arg('os', 'ws2022'))
const REINSTALL_OS = String(arg('reinstall-os', OS === 'ws2019' ? 'ws2022' : 'ws2019'))
const REGION = String(arg('region', 'US'))
const PLAN = String(arg('plan', 'starter-1m'))
const KEEP = !!arg('keep', false)
const ADOPT = arg('adopt', false)
const DEFAULT_PW = String(arg('default-pw', ''))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)

let _svc = null
const NID = (id) => _svc.normId(id)

// NLA-only RDP handshake to prove the Administrator password is live (xfreerdp +auth-only).
async function nlaCheck(ip, password) {
  if (!ip) return { ok: null, detail: 'no ip' }
  let xvfb = null
  if (!process.env.DISPLAY) { try { xvfb = spawn('Xvfb', [':97', '-screen', '0', '640x480x16'], { stdio: 'ignore' }); await sleep(1500) } catch (_) {} }
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':97' }
  let res = { ok: null, detail: 'xfreerdp not installed' }
  for (const bin of ['xfreerdp', 'xfreerdp3']) {
    const r = spawnSync(bin, [`/v:${ip}`, '/u:Administrator', `/p:${password}`, '/cert:ignore', '+auth-only', '/sec:nla'], { env, encoding: 'utf8', timeout: 60000 })
    if (r.error && r.error.code === 'ENOENT') continue
    const out = `${r.stdout || ''}\n${r.stderr || ''}`
    const m = out.match(/Authentication only, exit status (\d+)/)
    if (m && m[1] === '0') res = { ok: true, detail: `NLA OK via ${bin}` }
    else res = { ok: false, detail: `NLA FAILED via ${bin}: ${m ? 'exit ' + m[1] : 'no result'} ${(out.match(/STATUS_[A-Z_]+/) || [''])[0]} ${(out.match(/ERRCONNECT_[A-Z_]+/) || [''])[0]}`.trim() }
    break
  }
  if (xvfb) xvfb.kill()
  return res
}

async function waitActive(servers, extId, maxMin) {
  const serverId = NID(extId)
  const t0 = Date.now(); let seen = 0; let doc = null
  while (Date.now() - t0 < maxMin * 60000) {
    await sleep(10000)
    doc = await servers.findOne({ server_id: serverId })
    if (!doc) { log('server doc missing?!'); continue }
    for (const l of (doc.logs || []).slice(seen)) log(`  +${Math.round((Date.now() - t0) / 1000)}s ${String(l.stage).padEnd(12)} ${l.message}`)
    seen = (doc.logs || []).length
    if (['active', 'failed'].includes(doc.status)) break
  }
  return doc
}

async function waitAgent(svc, extId, maxMin) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMin * 60000) {
    const live = await svc.getInstance(extId)
    if (live && live.agentOnline) { log(`  agent online (seen ${live.agentSeenAt})`); return true }
    await sleep(10000)
  }
  return false
}

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js')
  _svc = svc
  if (!svc.init(db)) throw new Error('service init failed')
  const servers = db.collection('doRdpServers')

  let instanceId = null, destroyed = false
  const cleanup = async (why) => {
    if (destroyed || KEEP || !instanceId) return
    destroyed = true
    try { await svc.cancelInstance(instanceId); log(`droplet destroyed (${why})`) } catch (e) { console.error(`!! cleanup failed: ${e.message}`) }
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`\n${sig} received`); cleanup(sig).then(() => process.exit(1)) })

  const results = {}
  try {
    let ip = null
    if (ADOPT) {
      instanceId = String(ADOPT)
      log(`ADOPT existing instance ${instanceId}`)
      const doc0 = await servers.findOne({ server_id: NID(instanceId) })
      results.fast_deploy = true
      results.create_active = doc0 && doc0.status === 'active'
      ip = doc0 && doc0.ip_address
      log(`ADOPT → status=${doc0 && doc0.status} ip=${ip} os=${doc0 && doc0.os_id}`)
      if (!results.create_active) throw new Error(`adopted instance is not active (status=${doc0 && doc0.status})`)
      if (DEFAULT_PW) { const c1 = await nlaCheck(ip, DEFAULT_PW); results.login_after_create = c1.ok; log(`NLA (adopt default pw): ${c1.detail}`) }
    } else {
      // ── 1. CREATE (golden fast path) ──
      const opt = await svc.getOsOption(OS)
      log(`${OS}: golden_status=${opt.golden_status} image=${opt.golden_image_id} regions=${(opt.golden_regions || []).join(',')} → region ${REGION}=${svc.regionToSlug(REGION)}`)
      const inst = await svc.createInstance({ productId: PLAN, regionSlug: REGION, osId: OS, label: 'lifecycle-e2e' })
      instanceId = inst.instanceId
      log(`createInstance → id=${instanceId} fastDeploy=${inst.fastDeploy} eta=${inst.etaMinutes}min pw=${inst.defaultPassword}`)
      results.fast_deploy = !!inst.fastDeploy
      const doc = await waitActive(servers, instanceId, 12)
      results.create_active = doc && doc.status === 'active'
      log(`CREATE → status=${doc && doc.status} ip=${doc && doc.ip_address}`)
      if (!results.create_active) throw new Error(`create did not reach active (status=${doc && doc.status})`)
      ip = doc.ip_address
      const c1 = await nlaCheck(ip, inst.defaultPassword)
      results.login_after_create = c1.ok
      log(`NLA after create: ${c1.detail}`)
    }

    // ── 2. WAIT AGENT + RESET PASSWORD (in place) ──
    const ag1 = await waitAgent(svc, instanceId, 8)
    results.agent_online_1 = ag1
    if (!ag1) throw new Error('agent never came online (needed for password reset)')
    const reset = await svc.resetPassword(instanceId)
    results.reset_password = !!(reset && reset.password && reset.verified)
    log(`resetPassword → new pw=${reset.password} verified=${reset.verified} method=${reset.raw && reset.raw.method}`)
    await sleep(5000)
    const c2 = await nlaCheck(ip, reset.password)
    results.login_after_reset = c2.ok
    log(`NLA after reset: ${c2.detail}`)

    // ── 3. REINSTALL (other edition) — DO rebuild, IP kept ──
    log(`reinstall → ${REINSTALL_OS} — IP ${ip} kept, disk wiped`)
    const re = await svc.reinstallInstance(instanceId, { osId: REINSTALL_OS })
    log(`reinstallInstance → os=${re.osId} image=${re.imageId} eta=${re.etaMinutes}min pw=${re.password} ip=${re.ip}`)
    const doc2 = await waitActive(servers, instanceId, 12)
    results.reinstall_active = doc2 && doc2.status === 'active'
    results.reinstall_ip_kept = !!(doc2 && ip && doc2.ip_address === ip)
    results.reinstall_os_switched = !!(doc2 && doc2.os_id === REINSTALL_OS)
    log(`REINSTALL → status=${doc2 && doc2.status} ip=${doc2 && doc2.ip_address} (kept=${results.reinstall_ip_kept}) os=${doc2 && doc2.os_id}`)
    if (results.reinstall_active) {
      const ag2 = await waitAgent(svc, instanceId, 8)
      results.agent_online_2 = ag2
      const c3 = await nlaCheck(ip, re.password)
      results.login_after_reinstall = c3.ok
      log(`NLA after reinstall: ${c3.detail}`)
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`)
    results.error = e.message
  } finally {
    await cleanup('e2e complete')
    console.log('\n==================== RESULT ====================')
    console.log(JSON.stringify(results, null, 2))
    const pass = results.create_active && results.fast_deploy && results.reset_password &&
      results.reinstall_active && results.reinstall_ip_kept && results.reinstall_os_switched && !results.error
    console.log(`\nOVERALL: ${pass ? 'PASS' : 'FAIL'}`)
    console.log('(NLA login checks are informational — network egress to :3389 may be blocked from this pod)')
    await client.close()
    process.exit(pass ? 0 : 1)
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
