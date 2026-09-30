#!/usr/bin/env node
// READ-ONLY preflight for the VPS_RDP_PROVIDER prod flip.
// Confirms API access, identifies services, reads relevant vars + public domains.
// Makes NO mutations.
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
  if (j.errors) console.error('GQL errors:', JSON.stringify(j.errors))
  return j.data
}

;(async () => {
  if (!TOK) { console.error('API_KEY_RAILWAY missing'); process.exit(1) }

  // 1. Project + services + environments
  const proj = await gql(`query($id:String!){ project(id:$id){ name
      environments { edges { node { id name } } }
      services { edges { node { id name } } } } }`, { id: PROJ })
  const p = proj?.project
  if (!p) { console.error('No project access — token/proj wrong'); process.exit(1) }
  console.log('PROJECT:', p.name)
  console.log('ENVIRONMENTS:')
  for (const e of p.environments.edges) console.log('   ', e.node.id, e.node.name, e.node.id === ENV ? '  <== target ENV' : '')
  console.log('SERVICES:')
  for (const s of p.services.edges) console.log('   ', s.node.id, s.node.name, s.node.id === SVC ? '  <== target SVC' : '')

  // 2. Target service variables (only relevant ones)
  const d = await gql(`query V($projectId:String!,$environmentId:String!,$serviceId:String!){
    variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId) }`,
    { projectId: PROJ, environmentId: ENV, serviceId: SVC })
  const vars = d?.variables || {}
  console.log('\nTARGET SERVICE VAR COUNT:', Object.keys(vars).length)
  const targets = ['VPS_RDP_PROVIDER','VPS_DEFAULT_PROVIDER','RESELLER_API_LIVE','SELF_URL','SELF_URL_PROD','BOT_ENVIRONMENT','SKIP_WEBHOOK_SYNC','CUSTOM_DOMAIN','APP_URL']
  for (const k of targets) {
    const present = Object.prototype.hasOwnProperty.call(vars, k)
    console.log('  ', k.padEnd(22), '→', present ? JSON.stringify(vars[k]) : '(unset)')
  }

  // 3. Public domains for the target service (to place the confirmation order)
  const dom = await gql(`query($environmentId:String!,$serviceId:String!){
     domains(environmentId:$environmentId,serviceId:$serviceId){
       serviceDomains{ domain } customDomains{ domain } } }`,
    { environmentId: ENV, serviceId: SVC })
  console.log('\nDOMAINS:', JSON.stringify(dom?.domains || {}, null, 0))
})().catch(e => { console.error(e); process.exit(1) })
