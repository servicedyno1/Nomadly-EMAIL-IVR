#!/usr/bin/env node
// Trigger a redeploy of Nomadly-EMAIL-IVR (prod) so the new VPS_RDP_PROVIDER applies.
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
  if (j.errors) { console.error('GQL errors:', JSON.stringify(j.errors)); return { __err: j.errors } }
  return j.data
}

;(async () => {
  // 1. Find the latest deployment for this service/env
  const dep = await gql(`query($input: DeploymentsInput!){
     deployments(first:1, input:$input){ edges { node { id status createdAt } } } }`,
    { input: { projectId: PROJ, environmentId: ENV, serviceId: SVC } })
  const node = dep?.deployments?.edges?.[0]?.node
  console.log('Latest deployment:', node ? `${node.id} status=${node.status} created=${node.createdAt}` : '(none found)')

  // 2. Redeploy it (picks up the new variable). Try deploymentRedeploy first.
  if (node?.id) {
    const rd = await gql(`mutation($id: String!){ deploymentRedeploy(id:$id){ id status } }`, { id: node.id })
    if (rd && !rd.__err) { console.log('✅ deploymentRedeploy triggered →', JSON.stringify(rd.deploymentRedeploy)); return }
    console.log('deploymentRedeploy failed, trying serviceInstanceRedeploy...')
  }

  // 3. Fallback: serviceInstanceRedeploy
  const si = await gql(`mutation($environmentId: String!, $serviceId: String!){
     serviceInstanceRedeploy(environmentId:$environmentId, serviceId:$serviceId) }`,
    { environmentId: ENV, serviceId: SVC })
  if (si && !si.__err) console.log('✅ serviceInstanceRedeploy →', JSON.stringify(si))
  else console.error('❌ Both redeploy mutations failed')
})().catch(e => { console.error(e); process.exit(1) })
