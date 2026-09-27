#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// Golden-image end-to-end check  (js/ops/rdp_golden_e2e.js)
// ------------------------------------------------------------
// Provisions ONE real Windows RDP droplet exactly like a customer order
// (provider.createInstance → golden fast-path), waits until the backend marks
// it active (RDP answering + apply.ps1 callback), verifies the per-order
// Administrator password with an NLA-only RDP handshake (xfreerdp +auth-only,
// if installed) and destroys the droplet again.
//
//   node js/ops/rdp_golden_e2e.js [--os ws2022] [--region US] [--plan starter-1m] [--keep] [--wait-min 30]
//
// ⚠ Billable: one droplet for a few minutes (~$0.01). Uses the local Mongo of this pod.
// Exit code 0 only when the server became active on the FAST path.
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false' // never resume builds / sync from this side process
const { MongoClient } = require('mongodb')

const axios = require('axios')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const OS = String(arg('os', 'ws2022')), REGION = String(arg('region', 'US')), PLAN = String(arg('plan', 'standard-1m')), KEEP = !!arg('keep', false), WAIT_MIN = Number(arg('wait-min', 30))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const doGet = async (p) => (await axios.get(`https://api.digitalocean.com/v2${p}`, { headers: { Authorization: `Bearer ${process.env.DIGITALOCEAN_API_TOKEN}` }, validateStatus: () => true })).data

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js')
  if (!svc.init(db)) throw new Error('service init failed')
  const opt = await svc.getOsOption(OS)
  console.log(`[${ts()}] ${OS}: golden_status=${opt.golden_status} image=${opt.golden_image_id} min_disk=${opt.golden_min_disk_gb} regions=${(opt.golden_regions || []).join(',')} → region ${REGION} = ${svc.regionToSlug(REGION)}`)

  const t0 = Date.now()
  const inst = await svc.createInstance({ productId: PLAN, regionSlug: REGION, osId: OS, label: 'golden-e2e' })
  // Never leak a billable droplet if this process is killed (pause / Ctrl-C) - unless --keep was asked for.
  if (!KEEP) for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`\n${sig} → destroying droplet of ${inst.instanceId}`); svc.cancelInstance(inst.instanceId).catch(() => {}).then(() => process.exit(1)) })
  console.log(`[${ts()}] createInstance → id=${inst.instanceId} fastDeploy=${inst.fastDeploy} eta=${inst.etaMinutes}min password=${inst.defaultPassword}`)
  if (!inst.fastDeploy) console.log('!! NOT on the fast path (no golden image for this OS/region/tier) - this will be a slow conversion')

  const servers = db.collection('doRdpServers')
  let seen = 0, doc = null, dropletChecked = false
  while (Date.now() - t0 < WAIT_MIN * 60000) {
    await sleep(10000)
    doc = await servers.findOne({ server_id: svc.normId(inst.instanceId) })
    if (!doc) { console.log(`[${ts()}] server doc missing?!`); continue }
    for (const l of (doc.logs || []).slice(seen)) console.log(`[${ts()}] +${Math.round((Date.now() - t0) / 1000)}s ${String(l.stage).padEnd(12)} ${l.message}`)
    seen = (doc.logs || []).length
    if (doc.do_droplet_id && !dropletChecked && Date.now() - t0 > 60000) {
      dropletChecked = true
      const d = await doGet(`/droplets/${doc.do_droplet_id}`)
      console.log(`[${ts()}] DO droplet ${doc.do_droplet_id}: ${d.droplet ? `${d.droplet.status} image=${d.droplet.image && d.droplet.image.id} size=${d.droplet.size_slug}` : `NOT FOUND (${d.message}) → DO create action errored`}`)
    }
    if (['active', 'failed'].includes(doc.status)) break
  }
  const secs = Math.round((Date.now() - t0) / 1000)
  console.log(`\n[${ts()}] status=${doc && doc.status} ip=${doc && doc.ip_address} droplet=${doc && doc.do_droplet_id} after ${secs}s (${(secs / 60).toFixed(1)} min)`)

  let authOk = null
  if (doc && doc.status === 'active' && doc.ip_address) {
    // xfreerdp's X11 client needs a display even for +auth-only; it aborts (rc 134) after printing the result,
    // so judge by the "Authentication only, exit status N" line.
    let auth = 'skipped (xfreerdp not installed)'
    const { spawnSync } = require('child_process')
    let xvfb = null
    if (!process.env.DISPLAY) { try { xvfb = require('child_process').spawn('Xvfb', [':97', '-screen', '0', '640x480x16'], { stdio: 'ignore' }); await sleep(1500) } catch (_) {} }
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':97' }
    // The per-order password can land a minute or two AFTER 3389 opens (WS2025 especially): retry for up to 4 min.
    const authDeadline = Date.now() + 4 * 60000
    let tries = 0
    outer: for (const bin of ['xfreerdp', 'xfreerdp3']) {
      while (true) {
        tries++
        const r = spawnSync(bin, [`/v:${doc.ip_address}`, '/u:Administrator', `/p:${inst.defaultPassword}`, '/cert:ignore', '+auth-only', '/sec:nla'], { env, encoding: 'utf8', timeout: 60000 })
        if (r.error && r.error.code === 'ENOENT') continue outer
        const out = `${r.stdout || ''}\n${r.stderr || ''}`
        const m = out.match(/Authentication only, exit status (\d+)/)
        if (m && m[1] === '0') { auth = `OK via ${bin} after ${tries} attempt(s), ${Math.round((Date.now() - t0) / 1000)}s after order (NLA login with the per-order password succeeded)`; authOk = true; break outer }
        auth = `FAILED via ${bin} after ${tries} attempts: ${m ? 'exit status ' + m[1] : 'no result'} ${(out.match(/STATUS_[A-Z_]+/) || [''])[0]} ${(out.match(/ERRCONNECT_[A-Z_]+/) || [''])[0]}`.trim(); authOk = false
        if (Date.now() > authDeadline) break outer
        console.log(`[${ts()}] login attempt ${tries} rejected (${(out.match(/STATUS_[A-Z_]+/) || ['no status'])[0]}) - retrying in 20s`)
        await sleep(20000)
      }
    }
    if (xvfb) xvfb.kill()
    console.log(`[${ts()}] RDP credential check: ${auth}`)
  }

  if (KEEP) console.log(`\nKeeping droplet ${doc && doc.do_droplet_id} (${doc && doc.ip_address}). Administrator / ${inst.defaultPassword}. Delete it with: svc.cancelInstance('${inst.instanceId}')`)
  else { await svc.cancelInstance(inst.instanceId); console.log(`[${ts()}] droplet destroyed (cancelInstance).`) }
  await client.close()
  const okFast = doc && doc.status === 'active' && inst.fastDeploy && authOk !== false
  console.log(`\nRESULT: ${okFast ? 'PASS' : 'FAIL'} — ${OS} ${inst.fastDeploy ? 'fast path' : 'slow path'} ${doc && doc.status} in ${(secs / 60).toFixed(1)} min${authOk === false ? ' (RDP credential check failed)' : ''}`)
  process.exit(okFast ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
