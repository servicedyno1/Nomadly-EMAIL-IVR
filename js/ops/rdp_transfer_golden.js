#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// One-off: copy a registered golden image to its remaining mapped regions, driving each
// DO image-transfer action directly and WAITING for it to land (transferGolden() fires the
// copies in a detached task, so a short-lived script would kill them). The DO image copy is
// account-global → production's syncGoldenFromDO() (6-hourly) then picks up the new regions.
//   node js/ops/rdp_transfer_golden.js [--os ws2022]
// Safe to re-run: regions the image already has are skipped.
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d) }
const OS = String(arg('os', 'ws2022'))
const TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const DB_NAME = process.env.DB_NAME || 'test'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const DO = (method, url, data) => axios({ method, url: `https://api.digitalocean.com/v2${url}`, data, headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 60000, validateStatus: () => true })

const FULL_REGIONS = ['nyc3', 'tor1', 'sfo3', 'lon1', 'fra1', 'ams3', 'sgp1', 'blr1', 'syd1']

async function imageRegions(imageId) { const r = await DO('GET', `/images/${imageId}`); return (r.data && r.data.image && r.data.image.regions) || [] }

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)
  const osCol = db.collection('doRdpOsOptions')
  const o = await osCol.findOne({ _id: OS })
  if (!o || o.golden_status !== 'available' || !o.golden_image_id) throw new Error(`no golden image registered for ${OS}`)
  const imageId = o.golden_image_id
  let have = await imageRegions(imageId)
  const targets = FULL_REGIONS.filter(r => !have.includes(r))
  log(`${OS}: image ${imageId} currently in [${have.join(',')}] → transferring to [${targets.join(',') || 'nothing (already complete)'}]`)

  const done = [], failed = []
  for (const region of targets) {
    log(`→ ${region}: submitting transfer…`)
    let act = await DO('POST', `/images/${imageId}/actions`, { type: 'transfer', region })
    if (act.status >= 400 && !(act.data && JSON.stringify(act.data).includes('already'))) {
      log(`   transfer request HTTP ${act.status}: ${JSON.stringify(act.data).slice(0, 140)} — will still poll (a copy may already be running)`) 
    }
    const t0 = Date.now(); let landed = false
    while (Date.now() - t0 < 90 * 60000) {
      await sleep(30000)
      have = await imageRegions(imageId)
      if (have.includes(region)) { landed = true; break }
      log(`   …${region} still copying (${Math.round((Date.now() - t0) / 60000)}m)`) 
    }
    if (landed) {
      done.push(region)
      await osCol.updateOne({ _id: OS, golden_image_id: imageId }, { $addToSet: { golden_regions: region } })
      log(`✅ ${region} available (${done.length}/${targets.length}) — golden_regions updated`)
    } else { failed.push(region); log(`❌ ${region} did NOT land within 90m`) }
  }

  have = await imageRegions(imageId)
  const dbo = await osCol.findOne({ _id: OS })
  log(`FINISHED ${OS}: DO image regions=[${have.join(',')}]`)
  log(`  doRdpOsOptions.golden_regions=[${(dbo.golden_regions || []).join(',')}]`)
  log(`  transferred=[${done.join(',')}] failed=[${failed.join(',') || 'none'}]`)
  log(`  NOTE: production picks these up on its next syncGoldenFromDO (≤6h, or on redeploy/restart).`)
  await client.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(`[${ts()}] FATAL:`, e.message); process.exit(1) })
