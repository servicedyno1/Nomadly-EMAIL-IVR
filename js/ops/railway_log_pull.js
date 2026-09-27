#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/*
 * READ-ONLY Railway production log puller (project "New Hosting", service Nomadly-EMAIL-IVR).
 * Uses the project-scoped API_KEY_RAILWAY via GraphQL environmentLogs.
 * Pages backward from --anchor using beforeDate until --max lines or window start.
 *
 * Usage:
 *   node js/ops/railway_log_pull.js --anchor 2026-09-21T21:30:00.000Z --before 800 \
 *        --filter '@service:b9c4ad64-7667-4dd3-8b9a-3867ede47885 18883304418' --out /app/investigations/chemist_ivr/logs.jsonl
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def }
const TOKEN = fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8')
  .match(/API_KEY_RAILWAY\s*=\s*"?([^"\n]+)"?/)[1].trim()

const anchor = arg('anchor', new Date().toISOString())
const totalWanted = parseInt(arg('max', arg('before', '800')), 10)
const pageSize = Math.min(parseInt(arg('page', '500'), 10), 1000)
const filter = arg('filter', `@service:${SVC}`)
const out = arg('out', '/app/investigations/chemist_ivr/logs.jsonl')

function gql(query, variables) {
  const body = JSON.stringify({ query, variables })
  return new Promise((resolve, reject) => {
    const req = https.request('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': TOKEN, 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 300))) } }) })
    req.on('error', reject); req.write(body); req.end()
  })
}

const Q = `query($e:String!,$f:String,$a:String,$bl:Int){ environmentLogs(environmentId:$e, filter:$f, anchorDate:$a, beforeLimit:$bl, afterLimit:0){ timestamp message severity } }`

;(async () => {
  let cursor = anchor
  const all = []
  const seen = new Set()
  while (all.length < totalWanted) {
    const r = await gql(Q, { e: ENV, f: filter, a: cursor, bl: Math.min(pageSize, totalWanted - all.length) })
    if (r.errors) { console.error('ERRORS', JSON.stringify(r.errors).slice(0, 400)); break }
    const logs = r.data.environmentLogs || []
    if (!logs.length) break
    let added = 0
    for (const l of logs) {
      const k = l.timestamp + '|' + l.message
      if (seen.has(k)) continue
      seen.add(k); all.push(l); added++
    }
    // logs come oldest→newest; page before the earliest
    const earliest = logs[0].timestamp
    if (earliest === cursor || added === 0) break
    cursor = earliest
    if (logs.length < 2) break
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, all.map(l => JSON.stringify(l)).join('\n'))
  console.log(`[railway] pulled ${all.length} lines → ${out}`)
  all.slice(0, 5).forEach(l => console.log('  first', l.timestamp))
  all.slice(-3).forEach(l => console.log('  last ', l.timestamp))
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
