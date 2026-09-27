#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// ws2025 golden finisher  (js/ops/rdp_ws2025_finish.js)
// ------------------------------------------------------------
// SAFE, idempotent completion for a ws2025 golden build whose local tracking was
// lost (fresh pod) but whose DO custom image import is already in flight.
// It NEVER re-imports and NEVER deletes the build droplet while the image is still
// pending — so it cannot conflict with any other process still driving the build.
//
// Loop (up to --max-min, default 240):
//   1. syncGoldenFromDO()  → registers ws2025 the moment DO marks any golden-ws2025-* AVAILABLE
//   2. once available: transferGolden('ws2025','all') to copy to all 9 regions, poll DO image.regions
//   3. when the image is in all 9 regions: delete the leftover build droplet, final sync, exit 0
//
//   node js/ops/rdp_ws2025_finish.js [--build-droplet 602828932] [--max-min 240]
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
const { MongoClient } = require('mongodb')
const axios = require('axios')
function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const BUILD_DROPLET = Number(arg('build-droplet', 602828932))
const MAX_MIN = Number(arg('max-min', 240))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const T = process.env.DIGITALOCEAN_API_TOKEN
const doGet = async (p) => (await axios.get(`https://api.digitalocean.com/v2${p}`, { headers: { Authorization: `Bearer ${T}` }, validateStatus: () => true })).data
const doDel = async (p) => (await axios.delete(`https://api.digitalocean.com/v2${p}`, { headers: { Authorization: `Bearer ${T}` }, validateStatus: () => true })).status

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js'); if (!svc.init(db)) throw new Error('init failed')
  const ALL = svc.GOLDEN_ALL_REGIONS
  log(`ws2025 finisher started. target regions (${ALL.length}): ${ALL.join(',')}  build droplet=${BUILD_DROPLET}  max ${MAX_MIN} min`)
  const t0 = Date.now()
  let transferKicked = false
  while (Date.now() - t0 < MAX_MIN * 60000) {
    let sync = null
    try { sync = await svc.syncGoldenFromDO() } catch (e) { log(`sync error: ${e.message}`) }
    const o = await svc.getOsOption('ws2025')
    const st = o.golden_status, regions = o.golden_regions || []
    log(`ws2025 status=${st} image=${o.golden_image_id || '-'} regions=${regions.length}/${ALL.length} [${regions.join(',')}]`)
    if (st === 'available' && o.golden_image_id) {
      if (!transferKicked) { try { const q = await svc.transferGolden('ws2025', 'all'); log(`transferGolden queued → ${JSON.stringify(q.queued_regions)}`); transferKicked = true } catch (e) { log(`transferGolden error: ${e.message}`) } }
      // read the DO image directly to see which regions it now lives in
      let imgRegions = regions
      try { const im = await doGet(`/images/${o.golden_image_id}`); imgRegions = (im.image && im.image.regions) || regions } catch (_) {}
      if (ALL.every(r => imgRegions.includes(r))) {
        log(`ws2025 now available in ALL ${ALL.length} regions. Deleting leftover build droplet ${BUILD_DROPLET}...`)
        const code = await doDel(`/droplets/${BUILD_DROPLET}`)
        log(`build droplet delete → HTTP ${code}`)
        try { await svc.syncGoldenFromDO() } catch (_) {}
        const fin = await svc.getOsOption('ws2025')
        log(`DONE. ws2025 available in ${(fin.golden_regions || []).length} regions: ${(fin.golden_regions || []).join(',')}`)
        await client.close(); process.exit(0)
      }
    }
    await sleep(180000) // 3 min
  }
  log(`TIMEOUT after ${MAX_MIN} min — ws2025 still not fully ready. Re-run this finisher or: node js/ops/rdp_golden_build.js status`)
  await client.close(); process.exit(1)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
