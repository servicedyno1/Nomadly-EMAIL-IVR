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
    'checkDomainPriceOnline',
    'stale CF zone',
    'listRailwayCustomDomains failed',
    'Rate limit',
    'AntiRed-Cron',
    'AntiRed] Worker',
    'CPANEL_DOWN',
    'Panel] Upload user-level auth-broken',
    'PhoneMonitor',
    'Warning:',
    'MongooseError',
    'circuit breaker',
    'MAIL_RELAY_HOST',
    'CF Hosting',
    'CryptoCredit',
    'HostingScheduler',
    'suspicious',
    'address_generated',
    'Rate-limit',
    'Twilio] updateSubAccountNumberWebhooks',
  ]
  for (const f of probes) {
    const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp severity}}`, { d: id, l: 10, f })
    const rows = d?.deploymentLogs || []
    if (!rows.length) continue
    console.log(`\n=== "${f}" — sample ${Math.min(rows.length, 5)}/${rows.length} ===`)
    rows.slice(0, 5).forEach(r => console.log(r.timestamp, '|', String(r.severity||'').padEnd(5), '|', String(r.message||'').replace(/\s+/g,' ').substring(0, 500)))
  }
})().catch(e => { console.error(e); process.exit(1) })
