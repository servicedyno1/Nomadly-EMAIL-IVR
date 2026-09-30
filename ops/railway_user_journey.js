#!/usr/bin/env node
// Pull ALL logs mentioning a chatId, sorted chronologically, to reconstruct the user journey.
require('dotenv').config({ path: '/app/backend/.env' })
const TOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const CHAT = process.argv[2] || '7333384436'

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
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:5){edges{node{id status createdAt}}}}`, { p: PROJ, e: ENV, s: SVC })
  const nodes = deps?.deployments?.edges?.map(e => e.node) || []
  const live = nodes.find(n => n.status === 'SUCCESS') || nodes[0]
  const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp severity}}`, { d: live.id, l: 400, f: CHAT })
  const rows = (d?.deploymentLogs || []).slice().sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)))
  console.log(`# ${rows.length} log lines mentioning ${CHAT}\n`)
  for (const r of rows) {
    console.log(r.timestamp, '|', String(r.severity||'').padEnd(5), '|', String(r.message||'').replace(/\s+/g,' ').substring(0, 600))
  }
})().catch(e => { console.error(e); process.exit(1) })
