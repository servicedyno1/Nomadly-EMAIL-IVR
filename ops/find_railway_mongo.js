#!/usr/bin/env node
// READ-ONLY: find MongoDB connection URLs across the Railway project's services.
require('dotenv').config({ path: '/app/backend/.env' })
const TOK = process.env.API_KEY_RAILWAY
const PROJ = process.env.RAILWAY_PROD_PROJECT_ID || 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV  = process.env.RAILWAY_PROD_ENVIRONMENT_ID || '889fd56a-720a-4020-884c-034784992666'

async function gql(q, v) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
    body: JSON.stringify({ query: q, variables: v }),
  })
  const j = await r.json()
  if (j.errors) console.error('errors:', JSON.stringify(j.errors).slice(0,300))
  return j.data
}

function mask(u) {
  return String(u).replace(/\/\/([^:]+):([^@]+)@/, (m,user)=>`//${user}:****@`)
}

;(async () => {
  // list services in the project
  const pq = `query P($id: String!) { project(id: $id) { name services { edges { node { id name } } } } }`
  const pd = await gql(pq, { id: PROJ })
  const svcs = pd?.project?.services?.edges?.map(e=>e.node) || []
  console.log('Project:', pd?.project?.name, '| services:', svcs.map(s=>s.name).join(', '))
  const vq = `query V($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }`
  for (const s of svcs) {
    const d = await gql(vq, { projectId: PROJ, environmentId: ENV, serviceId: s.id })
    const vars = d?.variables || {}
    const hits = Object.keys(vars).filter(k => /mongo|database_url|db_url|db_conn/i.test(k) || /^mongodb(\+srv)?:\/\//i.test(String(vars[k])))
    if (hits.length) {
      console.log(`\n[service: ${s.name}]`)
      for (const k of hits) console.log('   ', k, '=', mask(vars[k]))
    }
  }
})().catch(e => { console.error(e.message); process.exit(1) })
