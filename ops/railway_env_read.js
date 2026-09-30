#!/usr/bin/env node
// Read current Railway service variables. READ-ONLY.
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
  if (j.errors) console.error('errors:', JSON.stringify(j.errors))
  return j.data
}

;(async () => {
  const q = `query V($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }`
  const d = await gql(q, { projectId: PROJ, environmentId: ENV, serviceId: SVC })
  const vars = d?.variables || {}
  const keys = Object.keys(vars).sort()
  console.log(`Total service-scoped vars: ${keys.length}`)
  // Only print names of ones relevant to this rollout
  const targets = [
    'CPANEL_SELFHEAL_WRITES',
    'CPPASS_ROTATION_COOLDOWN_MIN',
    'PROTECTION_HEARTBEAT_VERBOSE',
    'CPANEL_HEALTH_VERBOSE',
    'AUTOPROMO_VERBOSE',
    'UNHANDLED_REJECT_VERBOSE',
    'MAIL_RELAY_HOST',
    'MAIL_RELAY_PRIORITY',
  ]
  for (const k of targets) {
    const present = Object.prototype.hasOwnProperty.call(vars, k)
    const v = vars[k]
    console.log(`  ${k.padEnd(32)} → ${present ? JSON.stringify(v) : '(unset)'}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
