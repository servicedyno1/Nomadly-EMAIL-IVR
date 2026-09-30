#!/usr/bin/env node
// READ-ONLY probe: list deployments + test environmentLogs pagination shape.
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
  if (j.errors) console.error('GraphQL errors:', JSON.stringify(j.errors).slice(0, 600))
  return j.data
}

;(async () => {
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:15){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const nodes = deps?.deployments?.edges?.map(e => e.node) || []
  console.log('# Deployments:')
  nodes.forEach(n => console.log(' ', n.id, n.status.padEnd(9), n.createdAt))

  const anchor = new Date().toISOString()
  const d = await gql(`query E($e:String!,$f:String,$a:String,$bl:Int!){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,beforeLimit:$bl){timestamp message severity tags{serviceId deploymentId}}}`, { e: ENV, f: `@service:${SVC}`, a: anchor, bl: 5 })
  const rows = d?.environmentLogs || []
  console.log(`\n# environmentLogs probe rows: ${rows.length}`)
  rows.forEach(r => console.log(r.timestamp, r.severity, r.tags?.serviceId?.slice(0, 8), String(r.message).replace(/\s+/g, ' ').slice(0, 160)))

  const old = new Date(Date.now() - 7 * 86400e3).toISOString()
  const d2 = await gql(`query E($e:String!,$f:String,$a:String,$bl:Int!,$al:Int){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,beforeLimit:$bl,afterLimit:$al){timestamp message severity}}`, { e: ENV, f: `@service:${SVC}`, a: old, bl: 0, al: 5 })
  const rows2 = d2?.environmentLogs || []
  console.log(`\n# 7-day-old anchor rows: ${rows2.length}`)
  rows2.forEach(r => console.log(r.timestamp, r.severity, String(r.message).replace(/\s+/g, ' ').slice(0, 160)))
})().catch(e => { console.error(e); process.exit(1) })
