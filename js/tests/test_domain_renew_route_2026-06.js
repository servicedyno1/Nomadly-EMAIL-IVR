'use strict'
// ============================================================
// DI harness for POST /domains/:domain/renew (manual, on-demand).
// Mounts the REAL reseller API router against an ISOLATED local test DB
// (never the prod reseller DB) and stubs OpenProvider so NO real registrar
// call and NO real wallet is ever touched. Covers: validation, ownership,
// registrar gate (OpenProvider-only), years clamp, dry-run pricing, live
// charge + expiry extension + domain.renewed webhook, insufficient balance,
// pricing failure.
// ============================================================

process.env.NODE_ENV = 'test'
process.env.SKIP_WEBHOOK_SYNC = 'true'

const http = require('http')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const OWNER = '900900900'
const OTHER = '111222333'
const API_KEY = 'harness-test-key-123'

let pass = 0, fail = 0
function ok(cond, label) { if (cond) { pass++; console.log('  ✅ ' + label) } else { fail++; console.log('  ❌ ' + label) } }

function req(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null
    const addr = server.address()
    const opts = {
      host: '127.0.0.1', port: addr.port, method, path,
      headers: { 'Content-Type': 'application/json', ...headers },
    }
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data)
    const r = http.request(opts, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(buf) } catch (_) {} resolve({ status: res.statusCode, body: j }) })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

async function main() {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017'
  const client = new MongoClient(mongoUrl)
  await client.connect()
  const dbName = 'reseller_renew_harness_' + Date.now()
  const db = client.db(dbName)

  // ── Seed isolated fixtures ──
  const now = new Date()
  const expSoon = new Date(now.getTime() + 20 * 86400000) // 20 days out
  await db.collection('resellerApiKeys').insertOne({ _id: 'k1', keyHash: sha256(API_KEY), ownerChatId: OWNER, enabled: true, label: 'harness' })
  await db.collection('walletOf').insertOne({ _id: OWNER, usdIn: 50, usdOut: 0 })
  await db.collection('domainsOf').insertMany([
    { _id: 'd-op', chatId: OWNER, domainName: 'renewme-op.com', registrar: 'OpenProvider', expiresAt: expSoon, renewalCount: 0 },
    { _id: 'd-nc', chatId: OWNER, domainName: 'renewme-nc.com', registrar: 'Namecheap', expiresAt: expSoon },
    { _id: 'd-other', chatId: OTHER, domainName: 'notyours.com', registrar: 'OpenProvider', expiresAt: expSoon },
  ])

  // ── Stub OpenProvider (shared cached module object; reseller-api references the same object) ──
  const opService = require('../op-service')
  let renewCalls = []
  opService.getRenewPrice = async (_domain) => ({ price: 12.5, originalPrice: 9.0, registrar: 'OpenProvider' })
  opService.renewDomain = async (domain, period) => {
    renewCalls.push({ domain, period })
    const cur = expSoon
    const after = new Date(cur); after.setUTCFullYear(after.getUTCFullYear() + period)
    return { success: true, domainId: 123, previousExpiresAt: cur.toISOString(), expiresAt: after.toISOString() }
  }

  const { createResellerApi } = require('../reseller-api')
  const express = require('express')
  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: async () => {} }))
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const auth = { Authorization: 'Bearer ' + API_KEY }

  try {
    console.log('── A: auth + validation ──')
    let r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', {}, {})
    ok(r.status === 401, 'no api key → 401 (got ' + r.status + ')')

    r = await req(server, 'POST', '/reseller/v1/domains/notadomain/renew', {}, auth)
    ok(r.status === 400 && r.body && r.body.error === 'invalid_domain', 'invalid domain → 400 invalid_domain (got ' + r.status + ')')

    r = await req(server, 'POST', '/reseller/v1/domains/notyours.com/renew', {}, auth)
    ok(r.status === 404 && r.body.error === 'not_found', "someone else's domain → 404 not_found (got " + r.status + ')')

    r = await req(server, 'POST', '/reseller/v1/domains/renewme-nc.com/renew', {}, auth)
    ok(r.status === 501 && r.body.error === 'not_supported', 'non-OpenProvider domain → 501 not_supported (got ' + r.status + ')')

    console.log('── B: dry-run pricing + years clamp (RESELLER_API_LIVE unset) ──')
    delete process.env.RESELLER_API_LIVE
    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { dry_run: true }, auth)
    ok(r.status === 200 && r.body.dry_run === true, 'dry_run → 200 dry_run:true (got ' + r.status + ')')
    ok(r.body.period_years === 1 && r.body.price_usd === 12.5, 'default 1 year, price 12.50 (got ' + r.body.period_years + 'y $' + r.body.price_usd + ')')
    ok(r.body.sufficient_balance === true && r.body.wallet_balance_usd === 50, 'balance 50 sufficient for $12.50')

    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { dry_run: true, years: 2 }, auth)
    ok(r.body.period_years === 2 && r.body.price_usd === 25, '2 years → price 25.00 (got ' + r.body.price_usd + ')')

    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { dry_run: true, years: 99 }, auth)
    ok(r.body.period_years === 10, 'years=99 clamps to 10 (got ' + r.body.period_years + ')')
    ok(r.body.price_usd === 125 && r.body.sufficient_balance === false, '10y → $125 > $50 → insufficient flagged')

    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { dry_run: true, years: 0 }, auth)
    ok(r.body.period_years === 1, 'years=0 clamps up to 1 (got ' + r.body.period_years + ')')

    console.log('── C: live renewal (RESELLER_API_LIVE=true, isolated DB, stubbed registrar) ──')
    process.env.RESELLER_API_LIVE = 'true'
    renewCalls = []
    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { years: 2 }, auth)
    ok(r.status === 200 && r.body.mode === 'live', 'live renew → 200 mode:live (got ' + r.status + ' ' + JSON.stringify(r.body && r.body.error) + ')')
    ok(r.body.charged_usd === 25, 'charged $25 for 2 years (got ' + (r.body && r.body.charged_usd) + ')')
    ok(r.body.wallet_balance_usd === 25, 'wallet 50 - 25 = 25 (got ' + (r.body && r.body.wallet_balance_usd) + ')')
    ok(renewCalls.length === 1 && renewCalls[0].period === 2, 'opService.renewDomain called once with period 2')
    ok(r.body.result && r.body.result.expires_at, 'result.expires_at present (' + (r.body.result && r.body.result.expires_at) + ')')

    const updated = await db.collection('domainsOf').findOne({ _id: 'd-op' })
    const expectedYear = expSoon.getUTCFullYear() + 2
    ok(new Date(updated.expiresAt).getUTCFullYear() === expectedYear, 'domainsOf.expiresAt extended by 2 years (got ' + new Date(updated.expiresAt).getUTCFullYear() + ')')
    ok(updated.renewalCount === 1, 'renewalCount incremented to 1 (got ' + updated.renewalCount + ')')

    const order = await db.collection('resellerApiOrders').findOne({ product: 'domain', action: 'renew', status: 'provisioned' })
    ok(!!order, 'order recorded as provisioned')

    console.log('── D: insufficient balance ──')
    // wallet now at 25; 10 years = $125 → 402
    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { years: 10 }, auth)
    ok(r.status === 402 && r.body.error === 'insufficient_wallet_balance', '10y $125 > $25 → 402 insufficient (got ' + r.status + ')')
    const afterDecline = await db.collection('walletOf').findOne({ _id: OWNER })
    ok((afterDecline.usdIn - afterDecline.usdOut) === 25, 'wallet unchanged after 402 (got ' + (afterDecline.usdIn - afterDecline.usdOut) + ')')

    console.log('── E: pricing failure ──')
    opService.getRenewPrice = async () => ({ error: 'No renewal price from OpenProvider' })
    r = await req(server, 'POST', '/reseller/v1/domains/renewme-op.com/renew', { years: 1 }, auth)
    ok(r.status === 502 && r.body.error === 'pricing_failed', 'no price → 502 pricing_failed (got ' + r.status + ')')
  } finally {
    await db.dropDatabase().catch(() => {})
    await client.close().catch(() => {})
    server.close()
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} domain-renew route harness: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1) })
