#!/usr/bin/env node
require('../config-setup')
/* Repair the ONE drifted live account: set MAXADDON=5 on nameaf15 (Premium-Monthly)
 * so its addon cap matches the plan + every other Premium-Monthly account.
 * Reads before, writes MAXADDON=5, reads after. */
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

const USER = process.env.REPAIR_USER || 'nameaf15'
const NEW_MAXADDON = 5

async function summary(user) {
  const r = await whmApi.get('/accountsummary', { params: { 'api.version': 1, user } })
  return r.data?.data?.acct?.[0] || null
}

;(async () => {
  const before = await summary(USER)
  if (!before) throw new Error(`account ${USER} not found on WHM`)
  console.log(`[repair] BEFORE ${USER}: plan=${before.plan} maxaddons=${before.maxaddons} maxsql=${before.maxsql}`)

  const res = await whmApi.get('/modifyacct', { params: { 'api.version': 1, user: USER, MAXADDON: NEW_MAXADDON } })
  const ok = res.data?.metadata?.result === 1
  console.log(`[repair] modifyacct MAXADDON=${NEW_MAXADDON} → result=${ok ? 'OK' : 'FAIL'} reason=${res.data?.metadata?.reason || ''}`)
  if (!ok) throw new Error(`modifyacct failed: ${res.data?.metadata?.reason}`)

  const after = await summary(USER)
  console.log(`[repair] AFTER  ${USER}: plan=${after.plan} maxaddons=${after.maxaddons} maxsql=${after.maxsql}`)
  console.log(`[repair] ${String(after.maxaddons) === String(NEW_MAXADDON) ? 'VERIFIED ✅' : 'STILL WRONG ❌'}`)
})().catch(e => { console.error('[repair] FATAL', e.response?.data || e.message); process.exit(1) })
