#!/usr/bin/env node
// READ-ONLY: list Contabo VPS-capable data centers / valid region slugs for the PROD account.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const RTOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe', ENV = '889fd56a-720a-4020-884c-034784992666', SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const AUTH_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token'
const API_BASE = 'https://api.contabo.com/v1'
async function railwayVars() {
  const r = await fetch('https://backboard.railway.app/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': RTOK }, body: JSON.stringify({ query: `query V($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, variables: { p: PROJ, e: ENV, s: SVC } }) })
  return (await r.json()).data.variables
}
;(async () => {
  const v = await railwayVars()
  const params = new URLSearchParams({ client_id: v.CONTABO_CLIENT_ID, client_secret: v.CONTABO_CLIENT_SECRET, username: v.CONTABO_API_USER, password: v.CONTABO_API_PASSWORD, grant_type: 'password' })
  const tr = await axios.post(AUTH_URL, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
  const token = tr.data.access_token
  const dcs = (await axios.get(`${API_BASE}/data-centers`, { headers: { Authorization: `Bearer ${token}`, 'x-request-id': uuidv4() }, params: { size: 100 }, timeout: 30000 })).data
  console.log('# All data centers (name | regionSlug | regionName | capabilities):')
  const slugs = new Set()
  for (const dc of (dcs.data || [])) {
    console.log(`  ${dc.name} | slug=${dc.regionSlug} | ${dc.regionName} | ${(dc.capabilities||[]).join(',')}`)
    if ((dc.capabilities||[]).includes('VPS')) slugs.add(dc.regionSlug)
  }
  console.log('\n# VPS-capable regionSlugs:', [...slugs].join(', '))
})().catch(e => { console.error('ERR', e?.response?.status, JSON.stringify(e?.response?.data || e.message)); process.exit(1) })
