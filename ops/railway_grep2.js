#!/usr/bin/env node
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
  return (await r.json()).data
}

;(async () => {
  const deps = await gql(`query D($p:String!,$e:String,$s:String){deployments(input:{projectId:$p,environmentId:$e,serviceId:$s},first:1){edges{node{id status}}}}`, { p: PROJ, e: ENV, s: SVC })
  const id = deps?.deployments?.edges?.[0]?.node?.id
  console.log('deployment', id)

  const filters = [
    'domains/add',      // panel addon route
    'addonDomain',
    'addaddondomain',
    'panel.hostbay',    // panel base URL if any
    'panel-routes',
    'AddAddon',
    'externalAddon',
    'external addon',
    'AttachAddon',
    'attachAddonDomain',
    'domain limit',
    'limit reached',
    'domain blocked',
    'errorKind',
    '"blocked":true',
    'limitReached',
    '"errorKind"',
    'sessions/login',
    'not authorized',
    'unauthorized',
    'X-Panel-Auth',
    'panel-cpanel',
    'cpanel-web',
    ' 403 ',
    'HTTP 403',
    'requireGoldOnly',
    'switchPrimaryDomain',
    'setDomainAsAddon',
    'change primary',
    'Change Primary',
    'JSON.parse',
    'sessionExpired',
  ]

  for (const f of filters) {
    const d = await gql(`query L($d:String!,$l:Int!,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){message timestamp}}`, { d: id, l: 30, f })
    const rows = (d?.deploymentLogs || []).filter(r => r.timestamp > '2026-08-29T18:00')
    if (rows.length) {
      console.log(`\n=== "${f}" — ${rows.length} ===`)
      rows.forEach(r => console.log(r.timestamp, '|', String(r.message).replace(/\s+/g, ' ').substring(0, 350)))
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
