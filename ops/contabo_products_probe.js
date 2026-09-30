#!/usr/bin/env node
// READ-ONLY: verify which Contabo products/offers are actually available for the
// PRODUCTION RDP account (rdpup@dyno.pt). Pulls prod Contabo creds from Railway,
// gets an OAuth token, and does GET /v1/products + GET /v1/data-centers.
// No POST/create — completely safe.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')

const RTOK = process.env.API_KEY_RAILWAY
const PROJ = 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'

const AUTH_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token'
const API_BASE = 'https://api.contabo.com/v1'

async function railwayVars() {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': RTOK },
    body: JSON.stringify({ query: `query V($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, variables: { p: PROJ, e: ENV, s: SVC } }),
  })
  const j = await r.json()
  return j.data.variables
}

;(async () => {
  const v = await railwayVars()
  const CLIENT_ID = v.CONTABO_CLIENT_ID, CLIENT_SECRET = v.CONTABO_CLIENT_SECRET
  const API_USER = v.CONTABO_API_USER, API_PASSWORD = v.CONTABO_API_PASSWORD
  console.log(`# Using PROD Contabo account: user=${API_USER} clientId=${CLIENT_ID}\n`)

  const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, username: API_USER, password: API_PASSWORD, grant_type: 'password' })
  let token
  try {
    const tr = await axios.post(AUTH_URL, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
    token = tr.data.access_token
    console.log('# OAuth token acquired OK\n')
  } catch (e) {
    console.error('# OAuth FAILED:', e?.response?.status, JSON.stringify(e?.response?.data || e.message)); process.exit(1)
  }

  async function get(path, qp) {
    try {
      const r = await axios.get(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'x-request-id': uuidv4() }, params: qp, timeout: 30000 })
      return r.data
    } catch (e) {
      console.error(`# GET ${path} FAILED (${e?.response?.status}):`, JSON.stringify(e?.response?.data || e.message))
      return null
    }
  }

  // 1) Products (the active offer list). Print productId + period pricing.
  const prods = await get('/products', { size: 200 })
  if (prods?.data) {
    console.log(`# /v1/products — ${prods.data.length} entries`)
    for (const p of prods.data) {
      const periods = (p.pricing || p.prices || []).map(pr => `${pr.period || pr.periodInMonths}mo=$${pr.price||pr.amount}`).join(', ')
      console.log(`  ${p.productId || p.id} | ${p.name || p.tenant || ''} | periods: ${periods || JSON.stringify(p).slice(0,200)}`)
    }
  } else {
    console.log('# /v1/products returned no data (endpoint may not exist for compute) — trying /compute/products')
    const cprods = await get('/compute/products', { size: 200 })
    console.log(JSON.stringify(cprods, null, 2)?.slice(0, 2000))
  }

  // 2) Data centers / regions available to this account
  const dcs = await get('/data-centers', { size: 100 })
  if (dcs?.data) {
    const vpsRegions = {}
    for (const dc of dcs.data) {
      if (!(dc.capabilities || []).includes('VPS')) continue
      vpsRegions[dc.regionSlug] = (vpsRegions[dc.regionSlug] || []).concat(dc.name)
    }
    console.log(`\n# VPS-capable regionSlugs for this account: ${Object.keys(vpsRegions).join(', ')}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
