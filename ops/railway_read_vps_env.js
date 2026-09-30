#!/usr/bin/env node
// Read selected production env vars from Railway (read-only).
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
  if (j.errors) console.error('GraphQL errors:', JSON.stringify(j.errors))
  return j.data
}

;(async () => {
  const d = await gql(`query V($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: PROJ, e: ENV, s: SVC })
  const v = d?.variables || {}
  const keys = Object.keys(v).sort()
  const show = keys.filter(k => /^(VPS_|CONTABO|OVH_|VULTR|DIGITALOCEAN|DO_|AZURE|BOT_ENVIRONMENT|SELF_URL)/i.test(k))
  console.log('# Total prod env vars:', keys.length)
  console.log('# VPS/provider-related prod vars:\n')
  for (const k of show) {
    const val = v[k]
    const masked = /(KEY|SECRET|TOKEN|PASS|PASSWORD)/i.test(k) ? (val ? `<set,len=${String(val).length}>` : '<empty>') : val
    console.log(`${k} = ${masked}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
