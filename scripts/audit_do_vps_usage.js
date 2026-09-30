#!/usr/bin/env node
/**
 * READ-ONLY audit: which DigitalOcean droplets purchased by bot users are
 * actually being used, and which are idle/unused.
 *
 * Does ONLY GET requests to the DO API + reads from Mongo.
 * NO power actions, NO destroy, NO DB writes.
 *
 * Usage: node scripts/audit_do_vps_usage.js [windowDays]
 */
'use strict'
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { MongoClient } = require('mongodb')

const TOKEN = process.env.DIGITALOCEAN_API_TOKEN || ''
const API = 'https://api.digitalocean.com/v2'
const WINDOW_DAYS = parseFloat(process.argv[2] || '14')
const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test'

if (!TOKEN) { console.error('No DIGITALOCEAN_API_TOKEN'); process.exit(1) }

const http = axios.create({
  baseURL: API,
  timeout: 40000,
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function allDroplets() {
  let next = `/droplets?per_page=200`
  const out = []
  while (next) {
    const { data } = await http.get(next)
    out.push(...(data.droplets || []))
    next = data.links && data.links.pages && data.links.pages.next
      ? data.links.pages.next.replace(API, '') : null
  }
  return out
}

async function getMetric(path, id, start, end, extra = {}) {
  const params = new URLSearchParams(Object.assign(
    { host_id: String(id), start: String(start), end: String(end) }, extra))
  try {
    const { data } = await http.get(`/monitoring/metrics/droplet/${path}?${params.toString()}`)
    return data
  } catch (e) {
    return { __error: e.response ? `${e.response.status}` : e.message }
  }
}

function flatValues(data) {
  const res = (data && data.data && data.data.result) || []
  const vals = []
  for (const r of res) for (const pair of (r.values || [])) {
    const n = parseFloat(pair[1]); if (!isNaN(n)) vals.push(n)
  }
  return vals
}

// CPU util from cumulative per-mode seconds: util = 1 - idle_delta/total_delta
function cpuUtilPct(data) {
  const res = (data && data.data && data.data.result) || []
  if (!res.length) return null
  let idleDelta = 0, totalDelta = 0
  for (const r of res) {
    const mode = r.metric && r.metric.mode
    const vals = (r.values || []).map(v => parseFloat(v[1])).filter(n => !isNaN(n))
    if (vals.length < 2) continue
    const delta = vals[vals.length - 1] - vals[0]
    if (delta < 0) continue
    totalDelta += delta
    if (mode === 'idle') idleDelta += delta
  }
  if (totalDelta <= 0) return null
  return +(100 * (1 - idleDelta / totalDelta)).toFixed(2)
}

function stat(vals) {
  if (!vals.length) return { n: 0, avg: null, max: null }
  const sum = vals.reduce((a, b) => a + b, 0)
  return { n: vals.length, avg: +(sum / vals.length).toFixed(4), max: +Math.max(...vals).toFixed(4) }
}

;(async () => {
  const end = Math.floor(Date.now() / 1000)
  const start = end - Math.round(WINDOW_DAYS * 86400)

  console.log(`\n=== DigitalOcean VPS usage audit ===`)
  console.log(`Metrics window: last ${WINDOW_DAYS} days`)

  // 1. DB records ----------------------------------------------------------
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  const allPlans = await db.collection('vpsPlansOf').find({}).toArray()

  const isDO = (p) => {
    const prov = String(p.provider || '').toLowerCase()
    if (prov === 'digitalocean' || prov === 'do') return true
    const id = String(p.vpsId || p.contaboInstanceId || p.instanceId || '')
    return id.startsWith('do-')
  }
  const doPlans = allPlans.filter(isDO)

  // index by raw numeric droplet id
  const dbById = new Map()
  for (const p of doPlans) {
    const rid = String(p.vpsId || p.instanceId || '').replace(/^do-/, '')
    if (rid) dbById.set(rid, p)
  }
  console.log(`\nDB: total vpsPlansOf=${allPlans.length}, DigitalOcean records=${doPlans.length}`)

  // 2. Live DO account -----------------------------------------------------
  const droplets = await allDroplets()
  console.log(`DO account: ${droplets.length} droplet(s) live\n`)

  // 3. Per-droplet metrics -------------------------------------------------
  const rows = []
  for (const d of droplets) {
    const id = d.id
    const cpuData = await getMetric('cpu', id, start, end)
    await sleep(120)
    const bwIn = await getMetric('bandwidth', id, start, end, { interface: 'public', direction: 'inbound' })
    await sleep(120)
    const bwOut = await getMetric('bandwidth', id, start, end, { interface: 'public', direction: 'outbound' })
    await sleep(120)

    const cpu = cpuUtilPct(cpuData)
    const inS = stat(flatValues(bwIn))
    const outS = stat(flatValues(bwOut))
    const bwMax = Math.max(inS.max || 0, outS.max || 0)
    const bwAvg = +(((inS.avg || 0) + (outS.avg || 0))).toFixed(4)
    const metricsAvailable = cpu !== null || inS.n > 0 || outS.n > 0

    const dbRec = dbById.get(String(id))
    const ageDays = d.created_at ? +(( Date.now() - new Date(d.created_at)) / 86400000).toFixed(1) : null

    // classification
    let verdict
    if (d.status !== 'active') {
      verdict = 'NOT USED — powered ' + d.status
    } else if (!metricsAvailable) {
      verdict = 'UNKNOWN — no monitoring data'
    } else if ((cpu === null || cpu < 2) && bwMax < 0.1) {
      verdict = 'NOT USED — idle (near-zero CPU + traffic)'
    } else if ((cpu !== null && cpu < 5) && bwMax < 1) {
      verdict = 'LOW USE — minimal activity'
    } else {
      verdict = 'IN USE'
    }

    rows.push({
      id, name: d.name, status: d.status, region: d.region && d.region.slug,
      size: d.size_slug,
      publicIp: (d.networks && d.networks.v4 || []).filter(n => n.type === 'public').map(n => n.ip)[0] || '-',
      ageDays,
      cpuUtilPct: cpu,
      bwAvgMbps: bwAvg,
      bwMaxMbps: +bwMax.toFixed(4),
      owner: dbRec ? (dbRec.chatId || dbRec._id) : null,
      inDb: !!dbRec,
      dbStatus: dbRec ? dbRec.status : null,
      dbPlan: dbRec ? (dbRec.productName || dbRec.planName || dbRec.plan) : null,
      dbEnd: dbRec ? (dbRec.end_time || dbRec.endTime || dbRec.expiry) : null,
      dbAutoRenew: dbRec ? dbRec.autoRenewable : null,
      verdict,
    })
  }

  // 4. Report --------------------------------------------------------------
  rows.sort((a, b) => (a.verdict > b.verdict ? 1 : -1))
  console.log('ID           NAME                          STATUS   OWNER          AGE   CPU%   BWmax(Mbps)  IN_DB  VERDICT')
  console.log('-'.repeat(140))
  for (const r of rows) {
    console.log(
      String(r.id).padEnd(12),
      String(r.name || '').slice(0, 28).padEnd(30),
      String(r.status).padEnd(8),
      String(r.owner || '-').padEnd(14),
      String(r.ageDays == null ? '-' : r.ageDays).padEnd(5),
      String(r.cpuUtilPct == null ? '-' : r.cpuUtilPct).padEnd(6),
      String(r.bwMaxMbps).padEnd(12),
      String(r.inDb ? 'yes' : 'NO').padEnd(6),
      r.verdict,
    )
  }

  // orphans: in DO account but no DB record
  const orphans = rows.filter(r => !r.inDb)
  // stale: DB DO record whose droplet not found live
  const liveIds = new Set(droplets.map(d => String(d.id)))
  const staleDb = doPlans.filter(p => {
    const rid = String(p.vpsId || p.instanceId || '').replace(/^do-/, '')
    return rid && !liveIds.has(rid)
  })

  const notUsed = rows.filter(r => r.verdict.startsWith('NOT USED'))
  const lowUse = rows.filter(r => r.verdict.startsWith('LOW USE'))
  const unknown = rows.filter(r => r.verdict.startsWith('UNKNOWN'))
  const inUse = rows.filter(r => r.verdict === 'IN USE')

  console.log('\n=== SUMMARY ===')
  console.log(`Total live droplets : ${rows.length}`)
  console.log(`  IN USE            : ${inUse.length}`)
  console.log(`  LOW USE           : ${lowUse.length}`)
  console.log(`  NOT USED          : ${notUsed.length}`)
  console.log(`  UNKNOWN (no data) : ${unknown.length}`)
  console.log(`  Orphans (not in DB): ${orphans.length}`)
  console.log(`  Stale DB records (droplet gone): ${staleDb.length}`)

  if (notUsed.length) {
    console.log('\n--- NOT USED droplets ---')
    for (const r of notUsed) console.log(`  • ${r.id}  ${r.name}  owner=${r.owner || '-'}  ${r.publicIp}  [${r.verdict}]`)
  }
  if (orphans.length) {
    console.log('\n--- ORPHANS (in DO account, no bot-user DB record) ---')
    for (const r of orphans) console.log(`  • ${r.id}  ${r.name}  ${r.publicIp}  status=${r.status}  age=${r.ageDays}d  [${r.verdict}]`)
  }
  if (staleDb.length) {
    console.log('\n--- STALE DB records (DO record but droplet no longer exists) ---')
    for (const p of staleDb) console.log(`  • ${p.vpsId || p.instanceId}  owner=${p.chatId || p._id}  dbStatus=${p.status}`)
  }

  const fs = require('fs')
  fs.writeFileSync('/app/memory/do_vps_usage_audit.json', JSON.stringify({ generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS, rows, orphans, staleDb: staleDb.map(p => ({ id: p.vpsId || p.instanceId, owner: p.chatId || p._id, status: p.status })) }, null, 2))
  console.log('\nSaved full report -> /app/memory/do_vps_usage_audit.json')

  await client.close()
})().catch(e => { console.error('AUDIT ERROR:', e.message); process.exit(1) })
