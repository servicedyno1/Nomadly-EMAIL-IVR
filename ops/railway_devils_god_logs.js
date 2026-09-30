#!/usr/bin/env node
// Read-only Railway log pull for @Devils_gods debugging.
require('dotenv').config({ path: '/app/backend/.env' })

const RAILWAY_TOKEN = process.env.API_KEY_RAILWAY
const PROJECT_ID = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV_ID = '889fd56a-720a-4020-884c-034784992666'
const SERVICE_ID = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'

async function gql(query, variables = {}) {
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 nomadly-ops',
      'Project-Access-Token': RAILWAY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })
  const j = await res.json()
  if (j.errors) console.error('GraphQL errors:', JSON.stringify(j.errors))
  return j.data
}

;(async () => {
  // 1. Latest 3 deployments (find the currently-live one)
  const deps = await gql(`
    query D($projectId: String!, $envId: String, $serviceId: String) {
      deployments(
        input: { projectId: $projectId, environmentId: $envId, serviceId: $serviceId },
        first: 5,
      ) { edges { node { id status createdAt } } }
    }`, { projectId: PROJECT_ID, envId: ENV_ID, serviceId: SERVICE_ID })
  const list = deps?.deployments?.edges?.map(e => e.node) || []
  console.log('deployments (last 5):')
  list.forEach(d => console.log(' ', d.id, d.status, d.createdAt))

  const live = list.find(d => d.status === 'SUCCESS') || list[0]
  if (!live) { console.log('no live deployment'); return }
  console.log('\n>>> using deploymentId', live.id, '\n')

  // 2. Pull logs filtered by "auth62f9" OR "1446310286" OR "403" OR "AddonFlow"
  for (const filter of ['1446310286', 'auth62f9', 'auth09-tdhelpdesk', 'AddonFlow', 'domains/add', '/domains/add']) {
    const d = await gql(`
      query L($deploymentId: String!, $limit: Int!, $filter: String) {
        deploymentLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) { message timestamp severity }
      }`, { deploymentId: live.id, limit: 80, filter })
    const rows = d?.deploymentLogs || []
    console.log(`=== filter "${filter}" — ${rows.length} lines ===`)
    rows.forEach(r => {
      const msg = String(r.message || '').replace(/\s+/g, ' ').substring(0, 400)
      console.log(r.timestamp, '|', msg)
    })
    console.log('')
  }
})().catch(e => { console.error('fatal', e); process.exit(1) })
