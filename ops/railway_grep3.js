#!/usr/bin/env node
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
  return (await r.json()).data
}

;(async () => {
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:6){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const nodes = deps?.deployments?.edges?.map(e => e.node) || []
  console.log('deployments:')
  nodes.forEach(n => console.log(' ', n.id, n.status, n.createdAt))

  // Check all reachable deployments (SUCCESS or REMOVED — logs may still be queryable)
  for (const n of nodes.slice(0, 4)) {
    console.log(`\n=== [${n.id}] status=${n.status} createdAt=${n.createdAt} ===`)
    for (const f of ['1446310286', 'auth62f9', 'nseu77f4', 'auth09-tdhelp', 'addAddon', 'domains/add', 'attach', 'AddonFlow', 'domain limit', 'blocked']) {
      const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp}}`, { d: n.id, l: 12, f })
      const rows = d?.deploymentLogs || []
      if (rows.length) {
        console.log(`  "${f}" — ${rows.length} rows`)
        rows.slice(0, 5).forEach(r => console.log('    ', r.timestamp, '|', String(r.message).replace(/\s+/g, ' ').substring(0, 250)))
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
