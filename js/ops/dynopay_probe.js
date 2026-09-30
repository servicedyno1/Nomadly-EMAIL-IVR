#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY diagnostic: test each brand's DynoPay API key against the live DynoPay API.
 * Fetches prod keys from Railway (SAMDAV + Nomadly), reads sandbox key from backend/.env.
 * Runs: (auth) GET /getSupportedCurrency  and  (create) POST /cryptoPayment {amount,currency}
 * both with x-api-key ONLY and with the OLD-code Authorization: Bearer <wallet_token>.
 * Keys are redacted in output. NO funds move (creating an address is harmless).
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const axios = require('axios')

function parseEnv(t) { const o = {}; for (const line of t.split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (!m) continue; let v = m[2].trim(); if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1); o[m[1]] = v } return o }
const local = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8'))
const TOKEN = local.API_KEY_RAILWAY
const PROJECT = '0f41a48b-d2f6-4be5-acbd-524c6df6d2c6'
const ENVIRON = 'b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const BASE = 'https://dynopay.com/api'

function railwayVars(service) {
  const body = JSON.stringify({ query: `query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, variables: { p: PROJECT, e: ENVIRON, s: service } })
  return new Promise((resolve, reject) => {
    const req = https.request('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Project-Access-Token': TOKEN, Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); resolve((j.data && j.data.variables) || {}) } catch (e) { reject(new Error(d.slice(0, 200))) } }) })
    req.on('error', reject); req.write(body); req.end()
  })
}
const redact = k => k ? k.slice(0, 12) + '…' + k.slice(-4) : '(none)'

async function call(method, url, headers, data) {
  try {
    const r = await axios({ method, url, headers, data, timeout: 20000, validateStatus: () => true })
    return { status: r.status, body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 300) }
  } catch (e) { return { status: 'ERR', body: e.message } }
}

async function probe(label, apiKey, walletToken) {
  console.log(`\n════════ ${label} ════════`)
  console.log(`  api key      : ${redact(apiKey)}`)
  console.log(`  wallet token : ${walletToken ? walletToken.slice(0, 10) + '…(' + walletToken.length + 'ch)' : '(none)'}`)
  const hKeyOnly = { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey }
  const hWithBearer = { ...hKeyOnly, Authorization: `Bearer ${walletToken}` }

  let r
  r = await call('GET', `${BASE}/user/getSupportedCurrency`, hKeyOnly)
  console.log(`  [AUTH x-api-key only]  GET getSupportedCurrency  -> ${r.status}  ${r.body.slice(0, 120)}`)
  if (walletToken) {
    r = await call('GET', `${BASE}/user/getSupportedCurrency`, hWithBearer)
    console.log(`  [AUTH +Bearer(oldcode)] GET getSupportedCurrency -> ${r.status}  ${r.body.slice(0, 120)}`)
  }
  const payload = { amount: 25, currency: 'BTC', redirect_uri: 'https://example.com/done', webhook_url: 'https://example.com/done' }
  r = await call('POST', `${BASE}/user/cryptoPayment`, hKeyOnly, payload)
  console.log(`  [PAY  x-api-key only]  POST cryptoPayment BTC 25 -> ${r.status}  ${r.body}`)
  if (walletToken) {
    r = await call('POST', `${BASE}/user/cryptoPayment`, hWithBearer, payload)
    console.log(`  [PAY  +Bearer(oldcode)] POST cryptoPayment BTC 25 -> ${r.status}  ${r.body}`)
  }
  // also try USDT-TRC20 (most common) key-only
  r = await call('POST', `${BASE}/user/cryptoPayment`, hKeyOnly, { ...payload, currency: 'USDT-TRC20' })
  console.log(`  [PAY  x-api-key only]  POST cryptoPayment USDT-TRC20 -> ${r.status}  ${r.body}`)
}

;(async () => {
  const [smad, noma] = await Promise.all([
    railwayVars('6d40a2dd-dfdf-4d05-9c68-4962a065885c'),
    railwayVars('73e2050b-586d-41d4-a1b5-6b0914e7a0f9'),
  ])
  await probe('NOMADLY (prod Railway vars)', noma.DYNO_PAY_API_KEY, noma.DYNO_PAY_WALLET_TOKEN)
  await probe('SMADAV (prod Railway vars)', smad.DYNO_PAY_API_KEY, smad.DYNO_PAY_WALLET_TOKEN)
  await probe('SANDBOX backend/.env (current bot)', local.DYNO_PAY_API_KEY, local.DYNO_PAY_WALLET_TOKEN)
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
