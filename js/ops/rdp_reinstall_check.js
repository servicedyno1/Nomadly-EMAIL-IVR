#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// Focused live check: adopt an active droplet, REINSTALL to another edition (DO rebuild),
// wait active, prove it with an NLA login using the ORIGINAL user-data password
// (a reinstall boots the immutable user-data password; the new one is only applied by the agent).
// Then DESTROY the droplet. Usage:
//   node js/ops/rdp_reinstall_check.js --adopt rdp-<uuid> --pw '<original-pw>' --reinstall-os ws2019 [--keep]
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
const { MongoClient } = require('mongodb')
const { spawnSync, spawn } = require('child_process')
function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const ADOPT = String(arg('adopt', '')), PW = String(arg('pw', '')), RE_OS = String(arg('reinstall-os', 'ws2019')), KEEP = !!arg('keep', false)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)

async function nla(ip, pw) {
  if (!ip) return { ok: null, detail: 'no ip' }
  let xvfb = null
  if (!process.env.DISPLAY) { try { xvfb = spawn('Xvfb', [':97', '-screen', '0', '640x480x16'], { stdio: 'ignore' }); await sleep(1500) } catch (_) {} }
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':97' }
  let res = { ok: null, detail: 'xfreerdp missing' }
  const r = spawnSync('xfreerdp', [`/v:${ip}`, '/u:Administrator', `/p:${pw}`, '/cert:ignore', '+auth-only', '/sec:nla'], { env, encoding: 'utf8', timeout: 60000 })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  const m = out.match(/Authentication only, exit status (\d+)/)
  res = (m && m[1] === '0') ? { ok: true, detail: 'NLA OK' } : { ok: false, detail: `NLA FAIL ${m ? 'exit ' + m[1] : ''} ${(out.match(/STATUS_[A-Z_]+/) || [''])[0]} ${(out.match(/ERRCONNECT_[A-Z_]+/) || [''])[0]}`.trim() }
  if (xvfb) xvfb.kill()
  return res
}

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js'); if (!svc.init(db)) throw new Error('init failed')
  const servers = db.collection('doRdpServers')
  const nid = svc.normId(ADOPT)
  let destroyed = false
  const cleanup = async (why) => { if (destroyed || KEEP) return; destroyed = true; try { await svc.cancelInstance(ADOPT); log(`droplet destroyed (${why})`) } catch (e) { console.error('cleanup fail', e.message) } }
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => cleanup(s).then(() => process.exit(1)))
  const R = {}
  try {
    const before = await servers.findOne({ server_id: nid })
    const ipBefore = before && before.ip_address
    log(`BEFORE reinstall: os=${before && before.os_id} status=${before && before.status} ip=${ipBefore}`)
    const re = await svc.reinstallInstance(ADOPT, { osId: RE_OS })
    log(`reinstallInstance → os=${re.osId} image=${re.imageId} eta=${re.etaMinutes}min ip=${re.ip}`)
    // wait active
    const t0 = Date.now(); let seen = 0; let doc = null
    while (Date.now() - t0 < 15 * 60000) {
      await sleep(10000)
      doc = await servers.findOne({ server_id: nid })
      for (const l of (doc.logs || []).slice(seen)) log(`  +${Math.round((Date.now() - t0) / 1000)}s ${String(l.stage).padEnd(12)} ${l.message}`)
      seen = (doc.logs || []).length
      if (['active', 'failed'].includes(doc.status)) break
    }
    R.reinstall_active = doc && doc.status === 'active'
    R.ip_kept = !!(doc && ipBefore && doc.ip_address === ipBefore)
    R.os_switched = !!(doc && doc.os_id === RE_OS)
    log(`AFTER reinstall: os=${doc && doc.os_id} status=${doc && doc.status} ip=${doc && doc.ip_address} (kept=${R.ip_kept})`)
    if (R.reinstall_active && PW) {
      await sleep(5000)
      const c = await nla(doc.ip_address, PW)
      R.login_original_pw = c.ok
      log(`NLA after reinstall (original user-data pw): ${c.detail}`)
    }
  } catch (e) { console.error('ERROR:', e.message); R.error = e.message }
  finally {
    await cleanup('done')
    console.log('\n===== REINSTALL RESULT =====\n' + JSON.stringify(R, null, 2))
    const pass = R.reinstall_active && R.ip_kept && R.os_switched && !R.error
    console.log(`\nREINSTALL: ${pass ? 'PASS' : 'FAIL'}`)
    await client.close(); process.exit(pass ? 0 : 1)
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
