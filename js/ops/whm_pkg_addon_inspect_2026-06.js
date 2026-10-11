#!/usr/bin/env node
require('../config-setup')
/* READ-ONLY: dump WHM package definitions (MAXADDON/MAXSQL) + per-account maxaddon by plan. */
const axios = require('axios')

const WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const WHM_BASE = WHM_API_URL ? `${WHM_API_URL}/json-api` : `https://${process.env.WHM_HOST}:2087/json-api`
const whmApi = axios.create({
  baseURL: WHM_BASE,
  headers: {
    Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${process.env.WHM_TOKEN}`,
    ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    } : {}),
  },
  timeout: 30000,
})

const OUR = ['Premium-Anti-Red-1-Week', 'Premium-Anti-Red-HostPanel-1-Month', 'Golden-Anti-Red-HostPanel-1-Month']

;(async () => {
  console.log(`[whm] base=${WHM_BASE}`)
  const pk = await whmApi.get('/listpkgs', { params: { 'api.version': 1 } })
  const pkgs = pk.data?.data?.pkg || pk.data?.data?.package || []
  console.log('\n[whm] ===== PACKAGE DEFINITIONS =====')
  for (const name of OUR) {
    const p = pkgs.find(x => (x.name || x.package) === name)
    if (!p) { console.log(`   ${name}: NOT FOUND`); continue }
    console.log(`   ${name}: MAXADDON=${p.MAXADDON} MAXPARK=${p.MAXPARK} MAXSQL=${p.MAXSQL} QUOTA=${p.QUOTA} MAXSUB=${p.MAXSUB}`)
  }

  const la = await whmApi.get('/listaccts', { params: { 'api.version': 1 } })
  const accts = la.data?.data?.acct || []
  console.log(`\n[whm] ===== LIVE ACCOUNTS (${accts.length}) grouped by package =====`)
  const byPlan = {}
  for (const a of accts) {
    const plan = a.plan || '(none)'
    byPlan[plan] = byPlan[plan] || []
    byPlan[plan].push({ user: a.user, maxaddons: a.maxaddons, suspended: a.suspended })
  }
  for (const [plan, list] of Object.entries(byPlan)) {
    console.log(`\n   [${plan}] — ${list.length} account(s)`) 
    list.forEach(x => console.log(`      ${x.user}: maxaddons=${x.maxaddons}${x.suspended ? ' (suspended)' : ''}`))
  }
})().catch(e => { console.error('[whm] FATAL', e.response?.data || e.message); process.exit(1) })
