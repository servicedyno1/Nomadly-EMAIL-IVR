#!/usr/bin/env node
// READ-ONLY: 48h Railway anomaly/UX/bug scan for the Nomadly service.
// Paginates environmentLogs by anchorDate, buckets by anomaly filter, writes
// JSONL per filter + a summary to /app/investigations/anomaly48h/.
require('dotenv').config({ path: '/app/backend/.env' })
const fs = require('fs')
const path = require('path')

const TOK = process.env.API_KEY_RAILWAY
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const HOURS = Number(process.env.HOURS || 48)
const OUT = process.env.OUT || '/app/investigations/anomaly48h'
fs.mkdirSync(OUT, { recursive: true })

// Anomaly / UX / bug signals. Quoted strings are treated as phrases by Railway.
const FILTERS = [
  // Crashes / unhandled
  'UnhandledPromiseRejection', 'unhandledRejection', 'uncaughtException',
  'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'FATAL', 'panic',
  // Network / infra
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', '"socket hang up"',
  // HTTP / API errors
  '"status code 500"', '"status code 502"', '"status code 503"', '"status code 401"',
  '"status code 403"', '"status code 429"', '"Internal Server Error"', '"Request failed"',
  // Mongo / DB
  'MongoNetworkError', 'MongoServerError', 'MongoTimeoutError', '"topology was destroyed"', '"connection closed"',
  // Integrations / auth
  'invalid_client', '"invalid credentials"', '"Access denied"', 'Contabo', 'cPanel', 'WHM', 'Openprovider',
  'Cloudflare', 'DYNOPAY', 'BlockBee', 'Fincra', 'Brevo',
  // Telegram / bot
  'ETELEGRAM', 'polling_error', 'webhook_error', "\"can't be edited\"", '"blocked by the user"', '"chat not found"',
  // Voice / billing
  'NOT BILLED', '"billing error"', '"charge error"', 'BillingLeak', 'FORCE-SETTLED', '"Provisioning failed"',
  // App alarms
  'crash', 'stuck', 'timeout', 'Escalation', 'HELD', 'expired', 'failed', 'Error',
]

async function gql(q, v) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
        body: JSON.stringify({ query: q, variables: v }),
      })
      const j = await r.json()
      if (j.errors) { await new Promise(r => setTimeout(r, 1200)); continue }
      return j.data
    } catch (e) { await new Promise(r => setTimeout(r, 1200)) }
  }
  return null
}

const Q = `query E($e:String!,$f:String,$a:String,$al:Int,$bl:Int!){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,afterLimit:$al,beforeLimit:$bl){timestamp message severity}}`

;(async () => {
  const start = new Date(Date.now() - HOURS * 3600e3)
  const endMs = Date.now()
  const summary = []
  for (const f of FILTERS) {
    const name = f.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'all'
    const file = path.join(OUT, `${name}.jsonl`)
    const ws = fs.createWriteStream(file)
    let anchor = start.toISOString(), total = 0, lastTs = null, guard = 0
    while (guard++ < 200) {
      const d = await gql(Q, { e: ENV, f: `@service:${SVC} ${f}`, a: anchor, al: 1000, bl: 0 })
      const rows = d?.environmentLogs || []
      if (!rows.length) break
      let newRows = 0
      for (const r of rows) {
        if (lastTs && r.timestamp <= lastTs) continue
        ws.write(JSON.stringify({ t: r.timestamp, s: r.severity, m: r.message }) + '\n')
        newRows++
        lastTs = r.timestamp
      }
      total += newRows
      if (!newRows) break
      if (new Date(lastTs).getTime() >= endMs) break
      anchor = lastTs
      if (rows.length < 1000) break
    }
    ws.end()
    summary.push({ f, total })
    console.log(`${f.padEnd(30)} -> ${String(total).padStart(6)} rows`)
  }
  summary.sort((a, b) => b.total - a.total)
  fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify({ hours: HOURS, from: start.toISOString(), pulledAt: new Date().toISOString(), summary }, null, 2))
  console.log('\nDONE. Summary written to', path.join(OUT, '_summary.json'))
})().catch(e => { console.error(e); process.exit(1) })
