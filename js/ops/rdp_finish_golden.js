#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// Finish an interrupted golden build whose build droplet already CONVERTED Windows and is
// serving the qcow2 on :80, but whose orchestrator died before importing it as a DO custom
// image. Per --os it: discovers the build droplet + qcow2 URL, imports it as a new custom
// image, waits for `available`, transfers to all 9 regions, registers it via the service's
// own syncGoldenFromDO(), deletes the superseded old golden-<os>-* image(s), and destroys
// the build droplet.
//   node js/ops/rdp_finish_golden.js --os ws2019
// Idempotent-ish: if a newer available image already exists it skips the import.
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
const axios = require('axios')
const { MongoClient } = require('mongodb')

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d) }
const OS = String(arg('os', '')).toLowerCase()
if (!OS) throw new Error('pass --os ws2019|ws2022|ws2025')
const KEEP_DROPLET = process.argv.includes('--keep-droplet')
const NO_DELETE_OLD = process.argv.includes('--no-delete-old')
const TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const FULL_REGIONS = ['nyc3', 'tor1', 'sfo3', 'lon1', 'fra1', 'ams3', 'sgp1', 'blr1', 'syd1']
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] [${OS}] ${m}`)
const DO = (method, url, data) => axios({ method, url: `https://api.digitalocean.com/v2${url}`, data, headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 60000, validateStatus: () => true })
const imageRegions = async (id) => { const r = await DO('GET', `/images/${id}`); return (r.data && r.data.image && r.data.image.regions) || [] }
const imageStatus = async (id) => { const r = await DO('GET', `/images/${id}`); return (r.data && r.data.image && r.data.image.status) || `http${r.status}` }

async function findBuildDroplet() {
  const r = await DO('GET', `/droplets?per_page=200`)
  const drs = (r.data && r.data.droplets) || []
  // build droplet name = golden-<os>-<hex>; ignore anything that looks like an image name (numeric ts)
  const d = drs.find(x => new RegExp(`^golden-${OS}-[0-9a-f]{6,}$`, 'i').test(x.name || ''))
  if (!d) return null
  const ip = ((d.networks && d.networks.v4) || []).find(n => n.type === 'public')
  return { id: d.id, name: d.name, ip: ip && ip.ip_address }
}
async function discoverQcow2(ip) {
  const root = await axios({ method: 'GET', url: `http://${ip}/`, timeout: 20000, validateStatus: () => true })
  const dir = String(root.data || '').match(/href="([0-9a-f]{8,}\/)"/i)
  if (!dir) throw new Error(`no hashed dir served on http://${ip}/`)
  const url = `http://${ip}/${dir[1]}windows.qcow2`
  const head = await axios({ method: 'HEAD', url, timeout: 20000, validateStatus: () => true })
  const sz = Number(head.headers['content-length'] || 0)
  if (head.status !== 200 || sz < 1e9) throw new Error(`qcow2 not ready at ${url} (http ${head.status}, ${sz} bytes)`)
  return { url, sizeMB: Math.round(sz / 1024 / 1024) }
}
async function newestAvailableImage() {
  const r = await DO('GET', `/images?private=true&per_page=200`)
  const imgs = ((r.data && r.data.images) || []).filter(i => new RegExp(`^golden-${OS}-\\d+`, 'i').test(i.name || ''))
  return imgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const svc = require('../digitalocean-rdp-service.js')
  if (!svc.init(db)) throw new Error('service init failed')
  await sleep(400)
  const osCol = db.collection('doRdpOsOptions')

  const droplet = await findBuildDroplet()
  log(`build droplet: ${droplet ? droplet.name + ' (' + droplet.ip + ', id ' + droplet.id + ')' : 'NONE FOUND'}`)

  const existingImages = await newestAvailableImage()
  const before = existingImages[0]
  log(`existing golden-${OS}-* images: ${existingImages.map(i => i.id + '(' + i.status + ',' + (i.regions || []).length + 'reg)').join(', ') || 'none'}`)

  // ---- 1. IMPORT (skip if a recent image for this OS already exists — makes resume idempotent) ----
  let imageId = null
  const recent = before && ['available', 'pending', 'NEW'].includes(before.status) && (new Date(before.created_at) > new Date(Date.now() - 4 * 3600000))
  if (recent) {
    imageId = before.id
    log(`resume: recent image ${imageId} already exists (status ${before.status}) — skipping import`)
  } else if (!droplet) {
    if (!before || before.status !== 'available') throw new Error('no build droplet AND no available image — nothing to finish')
    imageId = before.id; log(`no droplet; using existing available image ${imageId}`)
  } else {
    const q = await discoverQcow2(droplet.ip)
    log(`qcow2: ${q.url} (${q.sizeMB} MB)`) 
    const name = `golden-${OS}-${Math.floor(Date.now() / 1000)}`
    log(`importing custom image "${name}" from qcow2 → region nyc3 …`)
    const imp = await DO('POST', `/images`, { name, url: q.url, distribution: 'Unknown', region: 'nyc3', description: `RDP golden ${OS} (internet/DNS fix)`, tags: ['nomadly-rdp-golden'] })
    if (imp.status >= 400 || !(imp.data && imp.data.image)) throw new Error(`import POST failed: HTTP ${imp.status} ${JSON.stringify(imp.data).slice(0, 160)}`)
    imageId = imp.data.image.id
    log(`import accepted → image ${imageId} (status ${imp.data.image.status})`)
  }

  // ---- 2. POLL to available (DO fetches the qcow2 from the droplet's :80) ----
  const t0 = Date.now()
  while (true) {
    const st = await imageStatus(imageId)
    if (st === 'available') { log(`image ${imageId} AVAILABLE after ${Math.round((Date.now() - t0) / 60000)}m`); break }
    if (Date.now() - t0 > 240 * 60000) throw new Error(`image ${imageId} not available after 240m (status ${st})`)
    log(`   image ${imageId} status=${st} (${Math.round((Date.now() - t0) / 60000)}m)`) 
    await sleep(60000)
  }

  // ---- 3. TRANSFER to all remaining regions ----
  let have = await imageRegions(imageId)
  const targets = FULL_REGIONS.filter(r => !have.includes(r))
  log(`regions now [${have.join(',')}] → transferring to [${targets.join(',') || 'none'}]`)
  const failed = []
  for (const region of targets) {
    log(`→ ${region}: transfer …`)
    const act = await DO('POST', `/images/${imageId}/actions`, { type: 'transfer', region })
    if (act.status >= 400 && !JSON.stringify(act.data || {}).includes('already')) log(`   HTTP ${act.status}: ${JSON.stringify(act.data).slice(0, 120)} (will still poll)`) 
    const ts0 = Date.now(); let landed = false
    while (Date.now() - ts0 < 90 * 60000) {
      await sleep(30000)
      have = await imageRegions(imageId)
      if (have.includes(region)) { landed = true; break }
    }
    if (landed) log(`✅ ${region} (${have.length}/${FULL_REGIONS.length} regions)`) 
    else { failed.push(region); log(`❌ ${region} did not land in 90m`) }
  }

  // ---- 4. REGISTER via the service's own tested sync (picks newest available image + its regions) ----
  const sync = await svc.syncGoldenFromDO()
  const reg = await osCol.findOne({ _id: OS })
  log(`registered: image=${reg.golden_image_id} status=${reg.golden_status} regions=[${(reg.golden_regions || []).join(',')}]`)
  if (String(reg.golden_image_id) !== String(imageId)) log(`⚠️ WARNING: registered image ${reg.golden_image_id} != new image ${imageId} (sync picked a different newest?)`)

  // ---- 5. DELETE superseded old golden-<os>-* image(s) ----
  if (!NO_DELETE_OLD) {
    have = await imageRegions(imageId)
    const complete = FULL_REGIONS.every(r => have.includes(r))
    if (complete && String(reg.golden_image_id) === String(imageId)) {
      const olds = (await newestAvailableImage()).filter(i => String(i.id) !== String(imageId))
      for (const old of olds) {
        const del = await DO('DELETE', `/images/${old.id}`)
        log(`deleted old image ${old.id} (${old.name}) → HTTP ${del.status}`)
      }
    } else log(`skip old-image delete (new image not in all regions yet, or not registered)`) 
  }

  // ---- 6. DESTROY the build droplet ----
  if (droplet && !KEEP_DROPLET) {
    const complete = (await imageRegions(imageId)).length >= FULL_REGIONS.length - failed.length
    if (complete) { const del = await DO('DELETE', `/droplets/${droplet.id}`); log(`destroyed build droplet ${droplet.id} → HTTP ${del.status}`) }
    else log(`kept build droplet ${droplet.id} (transfers incomplete)`) 
  }

  const finalRegions = await imageRegions(imageId)
  log(`DONE: image ${imageId} in [${finalRegions.join(',')}] | failed=[${failed.join(',') || 'none'}]`)
  await client.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(`[${ts()}] [${OS}] FATAL:`, e.message); process.exit(1) })
