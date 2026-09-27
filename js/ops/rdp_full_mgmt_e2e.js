#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// FULL RDP MANAGEMENT end-to-end  (js/ops/rdp_full_mgmt_e2e.js)
// ------------------------------------------------------------
// Provisions ONE real DigitalOcean Windows-RDP droplet, then exercises EVERY
// management op the bot + reseller API expose, and finally the 3-day grace
// auto-destroy (via the RDP-service safety-net sweep):
//   create (golden fast) -> active
//   -> stopInstance (OFF)      -> DO droplet status=off,   doRdpServers=suspended
//   -> startInstance (ON)      -> DO droplet status=active, doRdpServers=active, 3389 back
//   -> restartInstance (REBOOT)-> reboot action ok,         3389 recovers
//   -> resetPassword           -> new pw (needs agent; informational on sandbox)
//   -> reinstallInstance (other edition) -> active, IP kept, os switched
//   -> renewInstance(1)        -> expires_at extended ~30d, expired_at cleared
//   -> GRACE-DESTROY           -> seed {status:expired, expired_at:now-4d, grace_until:now-1d}
//                                 + a vpsPlansOf mirror row, run svc.processExpiries()
//                                 -> droplet 404 at DO, doRdpServers=destroyed/expired_grace,
//                                    vpsPlansOf=CANCELLED/expired_grace
//   -> finally cancelInstance (idempotent) on every exit path (incl. SIGINT/TERM/HUP)
//
//   node js/ops/rdp_full_mgmt_e2e.js [--os ws2022] [--reinstall-os ws2019] [--region US] [--plan starter-1m] [--keep]
//
// Billable: ONE droplet for ~15-20 min (~$0.05-0.10). ALWAYS destroyed on exit unless --keep.
// Requires the nodejs supervisor process running (serves /provision callbacks + agent commands).
// NLA login + tcp:3389 checks are INFORMATIONAL (pod egress to :3389 and the preview-host
// callback do not resolve on the sandbox) — judge PASS on DO + Mongo state.
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false' // never resume golden builds from this side process
const net = require('net')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const { spawnSync, spawn } = require('child_process')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const OS = String(arg('os', 'ws2022'))
const REINSTALL_OS = String(arg('reinstall-os', OS === 'ws2019' ? 'ws2022' : 'ws2019'))
const REGION = String(arg('region', 'US'))
const PLAN = String(arg('plan', 'standard-1m'))
const KEEP = !!arg('keep', false)
const DO_TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const DAY = 86400000

let _svc = null
const NID = (id) => _svc.normId(id)

// ── Direct DO reads (real axios; the service doesn't expose raw droplet power state) ──
async function doDropletStatus(dropletId) {
  if (!dropletId) return 'no-droplet'
  try {
    const r = await axios({ method: 'GET', url: `https://api.digitalocean.com/v2/droplets/${dropletId}`, headers: { Authorization: `Bearer ${DO_TOKEN}` }, timeout: 30000, validateStatus: () => true })
    if (r.status === 404) return '404'
    return (r.data && r.data.droplet && r.data.droplet.status) || `http${r.status}`
  } catch (e) { return 'err:' + e.message }
}
async function waitDropletStatus(dropletId, want, maxSec) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxSec * 1000) { const s = await doDropletStatus(dropletId); if (s === want) return true; await sleep(8000) }
  return false
}
function tcp3389(ip, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!ip) return resolve(null)
    const sock = new net.Socket(); let done = false
    const finish = (v) => { if (!done) { done = true; try { sock.destroy() } catch (_) {} resolve(v) } }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true)).once('timeout', () => finish(false)).once('error', () => finish(false))
    sock.connect(3389, ip)
  })
}

// NLA-only RDP handshake (informational).
async function nlaCheck(ip, password) {
  if (!ip) return { ok: null, detail: 'no ip' }
  let xvfb = null
  if (!process.env.DISPLAY) { try { xvfb = spawn('Xvfb', [':98', '-screen', '0', '640x480x16'], { stdio: 'ignore' }); await sleep(1500) } catch (_) {} }
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':98' }
  let res = { ok: null, detail: 'xfreerdp not installed' }
  for (const bin of ['xfreerdp', 'xfreerdp3']) {
    const r = spawnSync(bin, [`/v:${ip}`, '/u:Administrator', `/p:${password}`, '/cert:ignore', '+auth-only', '/sec:nla'], { env, encoding: 'utf8', timeout: 60000 })
    if (r.error && r.error.code === 'ENOENT') continue
    const out = `${r.stdout || ''}\n${r.stderr || ''}`
    const m = out.match(/Authentication only, exit status (\d+)/)
    res = (m && m[1] === '0') ? { ok: true, detail: `NLA OK via ${bin}` } : { ok: false, detail: `NLA via ${bin}: ${m ? 'exit ' + m[1] : 'no result'}` }
    break
  }
  if (xvfb) xvfb.kill()
  return res
}

async function waitActive(servers, extId, maxMin) {
  const serverId = NID(extId); const t0 = Date.now(); let seen = 0; let doc = null
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
async function waitStatus(servers, serverId, want, maxSec) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxSec * 1000) { const d = await servers.findOne({ server_id: serverId }, { projection: { status: 1 } }); if (d && d.status === want) return true; await sleep(5000) }
  return false
}
async function waitAgent(svc, extId, maxMin) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMin * 60000) { const live = await svc.getInstance(extId); if (live && live.agentOnline) return true; await sleep(10000) }
  return false
}

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js'); _svc = svc
  if (!svc.init(db)) throw new Error('service init failed')
  const servers = db.collection('doRdpServers')
  const plans = db.collection('vpsPlansOf')

  let instanceId = null, dropletId = null, destroyed = false
  const cleanup = async (why) => {
    if (destroyed || KEEP || !instanceId) return
    destroyed = true
    try { await svc.cancelInstance(instanceId); log(`droplet destroyed (${why})`) } catch (e) { console.error(`!! cleanup failed: ${e.message}`) }
    try { await plans.deleteOne({ _id: `fullmgmt-${NID(instanceId)}` }) } catch (_) {}
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`\n${sig} received`); cleanup(sig).then(() => process.exit(1)) })

  const R = {}
  try {
    // ── 1. CREATE (golden fast path) ──
    const opt = await svc.getOsOption(OS)
    log(`${OS}: golden_status=${opt.golden_status} image=${opt.golden_image_id} regions=${(opt.golden_regions || []).join(',')} → region ${REGION}=${svc.regionToSlug(REGION)}`)
    const inst = await svc.createInstance({ productId: PLAN, regionSlug: REGION, osId: OS, label: 'full-mgmt-e2e' })
    instanceId = inst.instanceId
    log(`createInstance → id=${instanceId} fastDeploy=${inst.fastDeploy} eta=${inst.etaMinutes}min pw=${inst.defaultPassword}`)
    R.fast_deploy = !!inst.fastDeploy
    let doc = await waitActive(servers, instanceId, 12)
    R.create_active = !!(doc && doc.status === 'active')
    dropletId = doc && doc.do_droplet_id
    const ip = doc && doc.ip_address
    log(`CREATE → status=${doc && doc.status} ip=${ip} droplet=${dropletId}`)
    if (!R.create_active) throw new Error(`create did not reach active (status=${doc && doc.status})`)
    { const c = await nlaCheck(ip, inst.defaultPassword); R.login_after_create = c.ok; log(`  NLA after create: ${c.detail}`) }
    log(`  DO droplet status=${await doDropletStatus(dropletId)} | tcp:3389=${await tcp3389(ip)}`)

    // ── 2. OFF (stopInstance) ──
    log('OFF → stopInstance (power_off)')
    await svc.stopInstance(instanceId)
    R.off_record = await waitStatus(servers, NID(instanceId), 'suspended', 60)
    R.off_droplet = await waitDropletStatus(dropletId, 'off', 150)
    log(`OFF → doRdpServers=suspended:${R.off_record} DOstatus=${await doDropletStatus(dropletId)} tcp:3389=${await tcp3389(ip)}`)

    // ── 3. ON (startInstance) ──
    log('ON → startInstance (power_on)')
    await svc.startInstance(instanceId)
    R.on_record = await waitStatus(servers, NID(instanceId), 'active', 60)
    R.on_droplet = await waitDropletStatus(dropletId, 'active', 150)
    await sleep(15000)
    { const up = await tcp3389(ip); R.on_3389 = up; log(`ON → doRdpServers=active:${R.on_record} DOstatus=${await doDropletStatus(dropletId)} tcp:3389=${up}`) }

    // ── 4. RESTART (restartInstance / reboot) ──
    log('RESTART → restartInstance (reboot)')
    await svc.restartInstance(instanceId)
    R.restart_ok = true // action accepted (throws on API error)
    await sleep(20000)
    let up3389 = false
    for (let i = 0; i < 12 && !up3389; i++) { up3389 = await tcp3389(ip); if (!up3389) await sleep(10000) }
    R.restart_3389_recovered = up3389
    log(`RESTART → action ok, tcp:3389 recovered=${up3389} DOstatus=${await doDropletStatus(dropletId)}`)

    // ── 5. RESET PASSWORD (in-place agent; informational on sandbox) ──
    log('RESETPW → waiting up to 6 min for the in-guest agent…')
    R.agent_online = await waitAgent(svc, instanceId, 6)
    if (R.agent_online) {
      try { const reset = await svc.resetPassword(instanceId); R.reset_password = !!(reset && reset.password); await sleep(4000); const c = await nlaCheck(ip, reset.password); R.login_after_reset = c.ok; log(`  RESETPW → pw=${reset.password} verified=${reset.verified} NLA:${c.detail}`) }
      catch (e) { R.reset_password = false; log(`  RESETPW failed: ${e.message}`) }
    } else { log('  agent never checked in (known sandbox callback/DNS limitation) — RESETPW skipped (informational)') }

    // ── 6. REINSTALL (other edition) — DO rebuild, IP kept ──
    log(`REINSTALL → ${REINSTALL_OS} (IP ${ip} kept, disk wiped)`)
    const re = await svc.reinstallInstance(instanceId, { osId: REINSTALL_OS })
    log(`  reinstallInstance → os=${re.osId} eta=${re.etaMinutes}min pw=${re.password} ip=${re.ip}`)
    const doc2 = await waitActive(servers, instanceId, 12)
    R.reinstall_active = !!(doc2 && doc2.status === 'active')
    R.reinstall_ip_kept = !!(doc2 && ip && doc2.ip_address === ip)
    R.reinstall_os_switched = !!(doc2 && doc2.os_id === REINSTALL_OS)
    log(`REINSTALL → status=${doc2 && doc2.status} ip=${doc2 && doc2.ip_address} (kept=${R.reinstall_ip_kept}) os=${doc2 && doc2.os_id}`)
    if (R.reinstall_active) { const c = await nlaCheck(ip, re.password); R.login_after_reinstall = c.ok; log(`  NLA after reinstall: ${c.detail}`) }

    // ── 7. RENEW ──
    const before = await servers.findOne({ server_id: NID(instanceId) })
    const expBefore = before.expires_at ? new Date(before.expires_at).getTime() : 0
    log(`RENEW → renewInstance(1); expires_at before=${before.expires_at}`)
    const rn = await svc.renewInstance(instanceId, 1)
    const after = await servers.findOne({ server_id: NID(instanceId) })
    R.renew_extended = !!(after.expires_at && new Date(after.expires_at).getTime() > expBefore)
    R.renew_grace_cleared = (after.expired_at == null && after.grace_until == null)
    log(`RENEW → expires_at after=${after.expires_at} extended=${R.renew_extended} (returned ${rn && rn.expires_at})`)

    // ── 8. GRACE-DESTROY (safety-net sweep) ──
    // Seed a vpsPlansOf mirror row so we can assert the customer-catalog mirror, then push
    // this box past the 3-day grace deadline and run the RDP-service sweep (bot scheduler is
    // gated off on the sandbox by SKIP_WEBHOOK_SYNC, so we exercise the safety net directly).
    const sid = NID(instanceId)
    await plans.updateOne({ _id: `fullmgmt-${sid}` }, { $set: {
      _id: `fullmgmt-${sid}`, vpsId: svc.extId(sid), contaboInstanceId: svc.extId(sid), chatId: '0',
      isRDP: true, provider: 'digitalocean-rdp', status: 'EXPIRED_GRACE', region: REGION, plan: PLAN,
      end_time: new Date(Date.now() - 4 * DAY), expired_at: new Date(Date.now() - 4 * DAY), grace_until: new Date(Date.now() - DAY),
    } }, { upsert: true })
    await servers.updateOne({ server_id: sid }, { $set: { status: 'expired', expired_at: new Date(Date.now() - 4 * DAY), grace_until: new Date(Date.now() - DAY) } })
    log('GRACE-DESTROY → seeded expired_at=now-4d, grace_until=now-1d; running svc.processExpiries()…')
    await svc.processExpiries()
    await sleep(3000)
    const gone = await servers.findOne({ server_id: sid })
    R.grace_status_destroyed = gone && gone.status === 'destroyed'
    R.grace_reason = gone && gone.destroy_reason === 'expired_grace'
    // DO's DELETE is async — poll until the droplet 404s (up to 90s).
    R.grace_droplet_404 = await waitDropletStatus(dropletId, '404', 90)
    const mir = await plans.findOne({ _id: `fullmgmt-${sid}` })
    R.grace_plan_cancelled = !!(mir && mir.status === 'CANCELLED' && mir.cancelReason === 'expired_grace')
    if (R.grace_status_destroyed) destroyed = true // sweep already deleted the droplet
    log(`GRACE-DESTROY → doRdpServers=destroyed:${R.grace_status_destroyed} reason:${gone && gone.destroy_reason} DOdroplet=${await doDropletStatus(dropletId)} vpsPlansOf=CANCELLED/${mir && mir.cancelReason}`)
  } catch (e) {
    console.error(`ERROR: ${e.message}`); R.error = e.message
  } finally {
    await cleanup('e2e complete')
    console.log('\n==================== RESULT ====================')
    console.log(JSON.stringify(R, null, 2))
    const pass = R.create_active && R.fast_deploy && R.off_record && R.on_record &&
      R.restart_ok && R.reinstall_active && R.reinstall_ip_kept && R.reinstall_os_switched &&
      R.renew_extended && R.renew_grace_cleared &&
      R.grace_status_destroyed && R.grace_reason && R.grace_droplet_404 && R.grace_plan_cancelled && !R.error
    console.log(`\nOVERALL: ${pass ? 'PASS' : 'FAIL'}`)
    console.log('(NLA login + some DO-power waits are informational — sandbox egress to :3389 / preview-host callback may not resolve; judge on DO + Mongo state.)')
    try { await client.close() } catch (_) {}
    process.exit(pass ? 0 : 1)
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
