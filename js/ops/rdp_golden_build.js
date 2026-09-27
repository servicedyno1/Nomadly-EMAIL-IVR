#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// Windows-RDP golden image ops CLI  (js/ops/rdp_golden_build.js)
// ------------------------------------------------------------
// Thin HTTP client for the /admin/rdp-golden/* endpoints of the RUNNING Node
// bot (orchestration lives there so builds survive CLI exits). Reads SELF_URL
// and SESSION_SECRET from backend/.env.
//
// Usage:
//   node js/ops/rdp_golden_build.js status
//   node js/ops/rdp_golden_build.js build [--os all|ws2019|ws2022|ws2025] [--region nyc3]
//                                         [--regions all|fra1,ams3] [--keep-on-failure] [--watch]
//   node js/ops/rdp_golden_build.js watch                 # poll until no build is running
//   node js/ops/rdp_golden_build.js sync                  # register DO snapshots into Mongo
//   node js/ops/rdp_golden_build.js transfer --os ws2022 [--regions all|lon1,sgp1]
//   node js/ops/rdp_golden_build.js cancel --build build-xxxxxxxxxxxx
//
// ⚠ `build` creates BILLABLE DigitalOcean resources (build droplet ~1 h + snapshot storage).
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const axios = require('axios')

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return (v && !v.startsWith('--')) ? v : true
}

const BASE = String(process.env.SELF_URL || '').replace(/\/+$/, '')
const KEY = String(process.env.SESSION_SECRET || '').slice(0, 16)
if (!BASE || !KEY) { console.error('SELF_URL / SESSION_SECRET missing in backend/.env'); process.exit(1) }

const api = async (method, p, data) => {
  const r = await axios({ method, url: `${BASE}/admin/rdp-golden/${p}?key=${KEY}`, data, timeout: 60000, validateStatus: () => true })
  if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.data)}`)
  return r.data
}

const fmtTs = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19)

function printStatus(s) {
  console.log(`\n== Golden images (build size ${s.build_size}, build region ${s.build_region}) ==`)
  for (const o of s.os_options) {
    console.log(`  ${o.id.padEnd(7)} ${o.name.padEnd(22)} status=${String(o.golden_status).padEnd(10)} fast_deploy=${o.fast_deploy ? 'YES' : 'no '} image=${o.golden_image_id || '-'} regions=${(o.golden_regions || []).join(',') || '-'}${o.active_build_id ? `  building=${o.active_build_id}` : ''}${o.golden_error ? `  error=${o.golden_error}` : ''}`)
  }
  const active = s.builds.filter(b => b.status === 'building')
  console.log(`== Builds (${s.builds.length} total, ${active.length} running) ==`)
  for (const b of s.builds.slice(0, 6)) {
    const last = (b.logs || []).slice(-1)[0]
    console.log(`  ${b.build_id} ${b.os_id} ${b.status}/${b.phase} ${b.progress || 0}%${b.conv_progress != null ? ` (droplet ${b.conv_progress}%)` : ''} droplet=${b.do_droplet_id || '-'} ip=${b.ip_address || '-'} snap=${b.snapshot_image_id || '-'} xfer=${(b.transferred_regions || []).length}/${(b.target_regions || []).length}`)
    if (last) console.log(`      ↳ ${fmtTs(last.ts)} [${last.stage}] ${last.message}`)
  }
  return active.length
}

async function watch() {
  for (;;) {
    const running = printStatus(await api('get', 'status'))
    if (!running) { console.log('\nNo build running.'); return }
    await new Promise(r => setTimeout(r, 60000))
  }
}

;(async () => {
  const cmd = process.argv[2] || 'status'
  try {
    if (cmd === 'status') { printStatus(await api('get', 'status')); return }
    if (cmd === 'watch') { await watch(); return }
    if (cmd === 'sync') { console.log(JSON.stringify(await api('post', 'sync'), null, 2)); return }
    if (cmd === 'transfer') {
      const regions = arg('regions', 'all')
      console.log(JSON.stringify(await api('post', 'transfer', { os_id: arg('os'), regions: regions === 'all' ? 'all' : String(regions).split(',') }), null, 2)); return
    }
    if (cmd === 'cancel') { console.log(JSON.stringify(await api('post', 'cancel', { build_id: arg('build') }), null, 2)); return }
    if (cmd === 'build') {
      const regions = arg('regions', 'all')
      const body = { confirm: true, os_id: arg('os', 'all'), region: arg('region', undefined), regions: regions === 'all' ? 'all' : String(regions).split(','), keep_on_failure: !!arg('keep-on-failure', false) }
      console.log(JSON.stringify(await api('post', 'build', body), null, 2))
      if (arg('watch', false)) await watch()
      return
    }
    console.error(`unknown command "${cmd}"`); process.exit(1)
  } catch (e) { console.error('ERROR:', e.message); process.exit(1) }
})()
