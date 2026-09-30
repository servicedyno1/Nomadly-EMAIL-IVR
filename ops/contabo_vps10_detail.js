#!/usr/bin/env node
// READ-ONLY: dump full pricing/period detail for the Cloud VPS 10/20 products
// on the PROD Contabo account, to understand the 'period' offer structure.
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
  const get = async (path, qp) => (await axios.get(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'x-request-id': uuidv4() }, params: qp, timeout: 30000 })).data

  const prods = await get('/products', { size: 200 })
  const targets = (prods.data || []).filter(p => {
    const nm = p.priceItem?.name || ''
    return /Cloud VPS 10\b|Cloud VPS 10 NVMe|Cloud VPS 20\b|Cloud VPS 20 NVMe/.test(nm)
  })
  for (const p of targets) {
    console.log('\n===', p.priceItem?.name, '| itemId=', p.priceItem?.itemId, '| nvmeProductId=', p.priceItem?.nvmeProductId, '===')
    console.log(JSON.stringify(p.priceItem?.price, null, 1))
  }
  // also print raw keys of one product entry so we understand the schema
  console.log('\n=== RAW first target keys ===')
  console.log(JSON.stringify(targets[0], null, 1)?.slice(0, 1500))
})().catch(e => { console.error('ERR', e?.response?.status, JSON.stringify(e?.response?.data || e.message)); process.exit(1) })
