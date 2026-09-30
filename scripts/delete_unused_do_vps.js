#!/usr/bin/env node
/**
 * Admin cleanup: destroy specific unused DigitalOcean droplets and archive
 * their vpsPlansOf record. SILENT (no owner notification).
 *
 * For each target:
 *   1. GET droplet (confirm exists, capture final snapshot, flag any volumes)
 *   2. DELETE /v2/droplets/{id}
 *   3. Poll until GET returns 404 (confirm destroyed)
 *   4. Archive vpsPlansOf doc -> vpsPlansOf_revoked, then remove from vpsPlansOf
 *
 * Usage:
 *   node scripts/delete_unused_do_vps.js           # dry-run
 *   node scripts/delete_unused_do_vps.js --apply   # perform destroy + DB update
 */
'use strict'
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { MongoClient } = require('mongodb')

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.DIGITALOCEAN_API_TOKEN || ''
const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test'

// Confirmed targets (wrapped ids as stored in vpsPlansOf.vpsId)
const TARGETS = ['do-593967362', 'do-593457561']

const http = axios.create({
  baseURL: 'https://api.digitalocean.com/v2',
  timeout: 30000,
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getDroplet(rawId) {
  try {
    const { data } = await http.get(`/droplets/${rawId}`)
    return { ok: true, droplet: data.droplet }
  } catch (e) {
    if (e.response && e.response.status === 404) return { ok: false, notFound: true }
    return { ok: false, error: e.response ? String(e.response.status) : e.message }
  }
}

;(async () => {
  console.log(`\n=== Delete unused DO VPS (${APPLY ? 'APPLY' : 'DRY-RUN'}) — SILENT ===`)
  console.log(`Targets: ${TARGETS.join(', ')}\n`)

  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const col = client.db(DB_NAME).collection('vpsPlansOf')
  const revoked = client.db(DB_NAME).collection('vpsPlansOf_revoked')

  for (const wrapped of TARGETS) {
    const rawId = wrapped.replace(/^do-/, '')
    const rec = await col.findOne({ vpsId: wrapped })
    const info = await getDroplet(rawId)

    console.log(`--- ${wrapped} (droplet ${rawId}) ---`)
    console.log(`  DB record : ${rec ? `owner=${rec.chatId} status=${rec.status} name=${rec.name}` : 'NONE'}`)
    if (info.notFound) {
      console.log('  DO droplet: already gone (404)')
    } else if (info.error) {
      console.log(`  DO droplet: lookup error ${info.error} — SKIPPING (will not touch DB)`) ; continue
    } else {
      const d = info.droplet
      const ip = ((d.networks && d.networks.v4) || []).find(n => n.type === 'public')
      console.log(`  DO droplet: name=${d.name} status=${d.status} ip=${ip ? ip.ip_address : '-'} region=${d.region && d.region.slug} size=${d.size_slug}`)
      if (d.volume_ids && d.volume_ids.length) {
        console.log(`  ⚠️ attached volumes: ${d.volume_ids.join(', ')} (NOT auto-deleted — review separately)`)
      }
    }

    if (!APPLY) { console.log('  => DRY-RUN: would DELETE droplet + archive DB record\n'); continue }

    // 1. destroy droplet (idempotent — skip if already gone)
    if (!info.notFound) {
      try {
        await http.delete(`/droplets/${rawId}`)
        console.log('  ✓ DELETE issued')
      } catch (e) {
        console.log(`  ✗ DELETE failed: ${e.response ? e.response.status : e.message} — leaving DB record intact`)
        continue
      }
      // 2. confirm destroyed
      let gone = false
      for (let i = 0; i < 10; i++) {
        await sleep(3000)
        const chk = await getDroplet(rawId)
        if (chk.notFound) { gone = true; break }
      }
      console.log(gone ? '  ✓ confirmed destroyed (404)' : '  ⚠️ not yet 404 after 30s (DO may still be tearing down)')
    }

    // 3. archive + remove DB record
    if (rec) {
      try {
        await revoked.updateOne(
          { _id: rec._id },
          { $set: Object.assign({}, rec, {
              _revokedAt: new Date(),
              _revokedReason: 'admin cleanup — unused DO VPS (idle: no CPU/traffic over 14d)',
              _revokedBy: 'ops',
              _dropletId: rawId,
            }) },
          { upsert: true }
        )
        await col.deleteOne({ _id: rec._id })
        console.log('  ✓ DB record archived -> vpsPlansOf_revoked and removed from vpsPlansOf\n')
      } catch (e) {
        console.log(`  ✗ DB archive/remove failed: ${e.message}\n`)
      }
    } else {
      console.log('  (no DB record to archive)\n')
    }
  }

  await client.close()
  console.log(APPLY ? 'Done.' : 'Dry-run only. Re-run with --apply to execute.')
})().catch(e => { console.error('DELETE ERROR:', e.message); process.exit(1) })
