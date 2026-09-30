#!/usr/bin/env node
// LIVE PROD change: set VPS_RDP_PROVIDER=digitalocean-rdp on Nomadly-EMAIL-IVR.
// Owner-approved 2026-09-23 (flip + confirmation order). Changes ONLY this one var.
// Prints before/after value. Does NOT redeploy (done in a separate explicit step).
require('dotenv').config({ path: '/app/backend/.env' })
const TOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'   // Nomadly-EMAIL-IVR
const NAME = 'VPS_RDP_PROVIDER'
const NEWVAL = 'digitalocean-rdp'

async function gql(q, v) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
    body: JSON.stringify({ query: q, variables: v }),
  })
  const j = await r.json()
  if (j.errors) { console.error('GQL errors:', JSON.stringify(j.errors)); return null }
  return j.data
}
const readVar = async () => {
  const d = await gql(`query V($projectId:String!,$environmentId:String!,$serviceId:String!){
    variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId) }`,
    { projectId: PROJ, environmentId: ENV, serviceId: SVC })
  return (d?.variables || {})[NAME]
}

;(async () => {
  if (!TOK) { console.error('API_KEY_RAILWAY missing'); process.exit(1) }
  const before = await readVar()
  console.log(`BEFORE: ${NAME} = ${JSON.stringify(before)}`)
  if (before === NEWVAL) { console.log('Already set. No change.'); return }

  const d = await gql(`mutation V($input: VariableUpsertInput!){ variableUpsert(input:$input) }`,
    { input: { projectId: PROJ, environmentId: ENV, serviceId: SVC, name: NAME, value: NEWVAL } })
  console.log('variableUpsert →', d ? 'OK' : 'FAILED')

  const after = await readVar()
  console.log(`AFTER : ${NAME} = ${JSON.stringify(after)}`)
  if (after !== NEWVAL) { console.error('❌ Verify failed — value not applied'); process.exit(1) }
  console.log('✅ Flip applied. Redeploy required for it to take effect.')
})().catch(e => { console.error(e); process.exit(1) })
