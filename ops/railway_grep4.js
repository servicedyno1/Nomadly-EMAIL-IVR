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
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:3){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const ids = deps?.deployments?.edges?.map(e => e.node.id) || []
  // 65824e83 is the older, longer-running deployment covering 2026-08-27..08-29
  const targets = [ids[0], '65824e83-553c-43ef-bc5a-8d9dbbdfd8ce'].filter(Boolean)

  for (const id of targets) {
    console.log(`\n@@@ deployment ${id} @@@`)
    for (const f of ['AddonFlow', 'texascapitalbank', 'Could not attach', 'attach failed', 'attachAddon']) {
      const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp severity}}`, { d: id, l: 60, f })
      const rows = d?.deploymentLogs || []
      if (!rows.length) continue
      console.log(`\n=== "${f}" — ${rows.length} rows ===`)
      rows.forEach(r => console.log(r.timestamp, '|', String(r.message).replace(/\s+/g, ' ').substring(0, 400)))
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
