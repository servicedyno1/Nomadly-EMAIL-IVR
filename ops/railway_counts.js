#!/usr/bin/env node
require('dotenv').config({ path: '/app/backend/.env' })
const TOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
async function gql(q, v) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
    body: JSON.stringify({ query: q, variables: v }),
  })
  return (await r.json()).data
}
;(async () => {
  const id = 'e01b765a-53b8-4223-8ab9-e5b3bdfcaba1'
  const probes = [
    { f: 'checkDomainPriceOnline', label: 'CR domain-price 401 storm' },
    { f: 'MAIL_RELAY_HOST is UNSET', label: 'MX not provisioned' },
    { f: 'ProtectionHeartbeat', label: 'ProtectionHeartbeat' },
    { f: 'WHM was rejecting cached pass', label: 'cpPass self-heal firing' },
    { f: 'listRailwayCustomDomains failed', label: 'Railway API list custom domains failed' },
    { f: 'Railway rate limit', label: 'Railway log rate limit drops' },
    { f: 'CPANEL_DOWN', label: 'cPanel DOWN' },
    { f: 'WHM probe missed', label: 'WHM probe misses' },
    { f: 'AntiRed', label: 'AntiRed cron' },
    { f: 'stale CF zone', label: 'AntiRed CF 403 stale zone' },
    { f: 'updateSubAccountNumberWebhooks error', label: 'Twilio webhook update errors' },
    { f: 'MongoNetworkError', label: 'Mongo net' },
    { f: 'MongoServerError', label: 'Mongo server' },
    { f: 'address_generated', label: 'Address generated' },
    { f: 'payment.underpaid', label: 'DynoPay underpaid events' },
    { f: 'payment.confirmed', label: 'DynoPay confirmed' },
    { f: 'payment.pending', label: 'DynoPay pending' },
    { f: 'ECONNRESET', label: 'ECONNRESET' },
    { f: 'ETIMEDOUT', label: 'ETIMEDOUT' },
    { f: 'UnhandledRejection', label: 'Unhandled rejections' },
    { f: 'uncaughtException', label: 'Uncaught exception' },
    { f: 'attemptsRemaining', label: 'attemptsRemaining' },
    { f: 'suspend', label: 'suspend' },
    { f: 'DEDUP', label: 'Escalation dedup' },
    { f: 'AI reply', label: 'AI support replies' },
    { f: 'Escalation OPENED', label: 'Escalations OPENED' },
    { f: 'notifyAdmin', label: 'admin notify' },
  ]
  for (const p of probes) {
    const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){timestamp}}`, { d: id, l: 500, f: p.f })
    const rows = d?.deploymentLogs || []
    if (!rows.length) { console.log(`${p.label.padEnd(40)} — 0`); continue }
    const first = rows[rows.length - 1].timestamp
    const last = rows[0].timestamp
    console.log(`${p.label.padEnd(40)} — ${String(rows.length).padStart(4)} | ${first} .. ${last}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
