#!/usr/bin/env node
// Broad Railway log anomaly scan for the Nomadly service.
require('dotenv').config({ path: '/app/backend/.env' })

const TOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'

async function gql(q, v) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
    body: JSON.stringify({ query: q, variables: v }),
  })
  const j = await r.json()
  if (j.errors) console.error('GraphQL errors:', JSON.stringify(j.errors))
  return j.data
}

;(async () => {
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:20){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const nodes = deps?.deployments?.edges?.map(e => e.node) || []
  console.log('# Deployments (latest 20):')
  nodes.forEach(n => console.log(' ', n.id, n.status.padEnd(9), n.createdAt))

  const live = nodes.find(n => n.status === 'SUCCESS') || nodes[0]
  console.log(`\n# Scanning live deployment: ${live.id} (started ${live.createdAt})\n`)

  // Broad anomaly signals we care about
  const FILTERS = [
    // Exceptions / crashes
    'UnhandledPromiseRejection', 'unhandledRejection', 'uncaughtException',
    'TypeError:', 'ReferenceError:', 'RangeError:', 'SyntaxError:', 'Error:', 'FATAL', 'panic',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'socket hang up',
    // HTTP / API errors
    ' 500 ', ' 502 ', ' 503 ', ' 504 ', ' 401 ', ' 403 ',
    'Internal Server Error', 'Request failed with status code',
    // Mongo / DB
    'MongoNetworkError', 'MongoServerError', 'MongoTimeoutError', 'MongooseError', 'topology was destroyed', 'connection closed',
    // Auth / integrations
    'cPanel auth', 'invalid credentials', 'Access denied', 'cpPass',
    'Cloudflare', 'CF error', 'WHM', 'Openprovider', 'OpenProvider',
    'DYNOPAY WEBHOOK', 'BlockBee', 'Fincra', 'blockbee',
    // Bot / Telegram
    'ETELEGRAM', 'Telegram API', 'bot polling', 'polling_error', 'webhook_error',
    // Emails / Twilio / SignalWire / SendGrid
    'BREVO', 'SendGrid', 'ESMTP', 'nodemailer', 'Twilio', 'SignalWire',
    // App-specific alarms
    'HELD', 'reconcile', 'expired', 'address_generated', 'suspend', 'crash', 'stuck',
    // Suspicious traffic
    'rate limit', 'throttle', 'blocked', '429',
  ]

  const buckets = {}
  for (const f of FILTERS) {
    const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp severity}}`, { d: live.id, l: 60, f })
    const rows = d?.deploymentLogs || []
    if (rows.length) buckets[f] = rows
  }

  const sortedKeys = Object.keys(buckets).sort((a, b) => buckets[b].length - buckets[a].length)
  console.log(`# Filters with hits: ${sortedKeys.length}\n`)
  for (const f of sortedKeys) {
    const rows = buckets[f]
    console.log(`\n=== "${f}" — ${rows.length} rows (showing up to 8) ===`)
    rows.slice(0, 8).forEach(r => console.log(r.timestamp, '|', String(r.severity||'').padEnd(5), '|', String(r.message||'').replace(/\s+/g, ' ').substring(0, 400)))
  }

  // Also pull raw ERROR-severity logs
  console.log('\n\n=== Severity=error (limit 80) ===')
  const errQ = await gql(`query L($d:String!,$l:Int!){deploymentLogs(deploymentId:$d,limit:$l){message timestamp severity}}`, { d: live.id, l: 500 })
  const all = errQ?.deploymentLogs || []
  const errs = all.filter(r => (r.severity || '').toLowerCase() === 'error' || (r.severity || '').toLowerCase() === 'err')
  console.log(`total lines pulled=${all.length}, error-severity=${errs.length}`)
  errs.slice(0, 40).forEach(r => console.log(r.timestamp, '|', String(r.message||'').replace(/\s+/g, ' ').substring(0, 500)))
})().catch(e => { console.error(e); process.exit(1) })
