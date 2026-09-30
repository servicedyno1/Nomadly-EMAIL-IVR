#!/usr/bin/env node
// Read-only Railway log pull for @fulyrich BTC deposit dispute (ref Hy8Ok).
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
  // 1. Get last ~10 deployments so we can walk the whole range (2026-08-31 -> today)
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:12){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const nodes = deps?.deployments?.edges?.map(e => e.node) || []
  console.log('deployments:')
  nodes.forEach(n => console.log(' ', n.id, n.status, n.createdAt))

  // Any deployment created on/before 2026-08-31 15:03 that was still alive at that moment counts.
  // Simpler: just walk all deployments and pull logs matching our filters.
  const targets = nodes.map(n => n.id)

  const FILTERS = [
    'Hy8Ok',
    '6635602837',
    'fulyrich',
    'bc1q2ztqrp4ztayh0zj3cpfgucl5yaeguly4y457ls',
    'c3d269d83fec20a04d97b277726277ef92781bf9553079f63cb4e6ea9dde1515',
    'dynopay',
    'payment.confirmed',
    'address_generated',
    '/dynopay-webhook',
  ]

  for (const id of targets) {
    let printedHeader = false
    for (const f of FILTERS) {
      const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp severity}}`, { d: id, l: 40, f })
      const rows = d?.deploymentLogs || []
      if (!rows.length) continue
      if (!printedHeader) {
        console.log(`\n@@@ deployment ${id} @@@`)
        printedHeader = true
      }
      console.log(`\n=== filter "${f}" — ${rows.length} rows ===`)
      rows.forEach(r => console.log(r.timestamp, '|', String(r.message || '').replace(/\s+/g, ' ').substring(0, 500)))
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
