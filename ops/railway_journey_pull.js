#!/usr/bin/env node
// READ-ONLY: pull filtered Railway environmentLogs for the Nomadly service over N days,
// paginating forward by anchorDate. Writes JSONL to /app/investigations/journey7d/<name>.jsonl
require('dotenv').config({ path: '/app/backend/.env' })
const fs = require('fs')
const path = require('path')
const TOK = process.env.API_KEY_RAILWAY
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const DAYS = Number(process.env.DAYS || 7)
const OUT = '/app/investigations/journey7d'
fs.mkdirSync(OUT, { recursive: true })

const FILTERS = (process.argv.length > 2 ? process.argv.slice(2) : [
  '"message:"', 'DynoPay', 'Wallet', 'Conversion', 'AutoPromo', 'CartRecovery', 'AbandonedCart',
  'WelcomeBonus', 'LowBalanceNudge', '"AI Support"', 'Support', 'Escalation', 'address_generated',
  'Plan', 'SingleIVR', 'CloudPhone', 'Referral', 'PostPurchase', 'Dedup', '"blocked by the user"',
  'addFundsTo', 'Fincra', 'Insufficient', 'PaymentTimeout', 'Day12Nudge', 'BundleChecker',
  'Shortener', 'EmailValidation', 'Leads', 'Marketplace', 'DigitalProducts',
  'Domain', 'VPS', 'Hosting', 'StartFresh', 'Reminders', '"PRE-DIAL BLOCK"', 'Voice', 'tx-log', 'testsip', 'deposit',
])

async function gql(q, v) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
        body: JSON.stringify({ query: q, variables: v }),
      })
      const j = await r.json()
      if (j.errors) { console.error('GraphQL errors:', JSON.stringify(j.errors).slice(0, 300)); await new Promise(r => setTimeout(r, 1500)); continue }
      return j.data
    } catch (e) { await new Promise(r => setTimeout(r, 1500)) }
  }
  return null
}

const Q = `query E($e:String!,$f:String,$a:String,$al:Int,$bl:Int!){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,afterLimit:$al,beforeLimit:$bl){timestamp message severity}}`

;(async () => {
  const start = new Date(Date.now() - DAYS * 86400e3)
  const endMs = Date.now()
  for (const f of FILTERS) {
    const name = f.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'all'
    const file = path.join(OUT, `${name}.jsonl`)
    const ws = fs.createWriteStream(file)
    let anchor = start.toISOString(), total = 0, lastTs = null, guard = 0
    while (guard++ < 400) {
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
    console.log(`${f.padEnd(22)} -> ${total} rows (${guard} pages) ${file}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
