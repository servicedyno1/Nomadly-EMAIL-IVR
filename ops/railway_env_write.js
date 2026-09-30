#!/usr/bin/env node
// Add the P1 rollout env vars to the Nomadly Railway service.
// - CPPASS_ROTATION_COOLDOWN_MIN=60  (identity, matches code default)
// - CPANEL_SELFHEAL_WRITES=1          (activates write-route self-heal after next deploy)
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
  if (j.errors) { console.error('errors:', JSON.stringify(j.errors, null, 2)); return null }
  return j.data
}

const VARS = [
  { name: 'CPPASS_ROTATION_COOLDOWN_MIN', value: '60' },
  { name: 'CPANEL_SELFHEAL_WRITES',       value: '1' },
]

;(async () => {
  const upsert = `mutation V($input: VariableUpsertInput!) { variableUpsert(input: $input) }`
  for (const v of VARS) {
    const d = await gql(upsert, {
      input: { projectId: PROJ, environmentId: ENV, serviceId: SVC, name: v.name, value: v.value },
    })
    console.log(`upsert ${v.name}=${v.value} → ${d ? 'OK' : 'FAILED'}`)
  }

  // Verify
  const read = `query V($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }`
  const d = await gql(read, { projectId: PROJ, environmentId: ENV, serviceId: SVC })
  const vars = d?.variables || {}
  console.log('\nVerification:')
  for (const v of VARS) {
    console.log(`  ${v.name.padEnd(32)} → ${JSON.stringify(vars[v.name] ?? '(unset)')}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
