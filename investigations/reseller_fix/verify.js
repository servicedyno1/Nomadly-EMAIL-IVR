/* Self-contained verification of the reseller-API gap fixes.
 * Mounts the REAL reseller router against local Mongo in dry-run mode
 * (RESELLER_API_LIVE unset), stubs live WHM reads, and asserts contracts. */
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')

const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test'
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const OWNER = 'rtest-owner-001'
const KEY = 'rtest-key-abc'
const results = []
const assert = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 300) : ''}`) }

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)

  // ── seed ──
  await db.collection('resellerApiKeys').deleteMany({ ownerChatId: OWNER })
  await db.collection('resellerApiKeys').insertOne({ _id: 'rtestkey', keyHash: sha256(KEY), enabled: true, ownerChatId: OWNER, label: 'test' })
  await db.collection('domainsOf').deleteMany({ chatId: OWNER })
  await db.collection('domainsOf').insertOne({ chatId: OWNER, domainName: 'nstest.example', registrar: 'OpenProvider', nameserverType: 'cloudflare', cfZoneId: 'zone-x' })
  await db.collection('registeredDomains').deleteOne({ _id: 'nstest.example' })
  await db.collection('registeredDomains').insertOne({ _id: 'nstest.example', val: { domain: 'nstest.example', cfNameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'], cfZoneId: 'zone-x', nameserverType: 'cloudflare' } })
  await db.collection('cpanelAccounts').deleteMany({ chatId: OWNER })
  await db.collection('cpanelAccounts').insertOne({ _id: 'rtestacct', cpUser: 'rtestacct', chatId: OWNER, domain: 'primary.example', plan: 'Premium Anti-Red', suspended: true, suspendedReason: 'auto_renew_insufficient_funds', suspendedAt: new Date(), autoRenewLastError: 'insufficient_funds', autoRenewLastAttemptAt: new Date(), autoRenew: true, addonDomains: [{ domain: 'addon1.example' }], createdAt: new Date(), expiryDate: new Date(Date.now() - 86400000) })

  // ── stub live WHM reads (no external calls) ──
  const whm = require('/app/js/whm-service')
  whm.getAccountInfo = async () => ({ success: false })
  whm.getAccountBandwidth = async () => ({ success: false })

  // ── mount reseller api (dry-run) ──
  const { createResellerApi } = require('/app/js/reseller-api')
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0); const port = server.address().port
  const call = (method, path, body) => new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request({ host: '127.0.0.1', port, path: '/reseller/v1' + path, method, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }) } catch { resolve({ status: res.statusCode, body: d }) } }) })
    r.on('error', e => resolve({ status: 0, body: e.message })); if (data) r.write(data); r.end()
  })

  // Gap 5 — GET /domains nameservers filled from registeredDomains
  let r = await call('GET', '/domains')
  const dom = (r.body.domains || []).find(d => d.domain === 'nstest.example')
  assert('Gap5 GET /domains delegated NS', dom && Array.isArray(dom.nameservers) && dom.nameservers.length === 2, dom && dom.nameservers)

  // Gap 4 — lifecycle fields; Gap 7 — suspended falls back to DB when live unavailable
  r = await call('GET', '/hosting/rtestacct')
  assert('Gap4 suspended_reason', r.body.suspended_reason === 'auto_renew_insufficient_funds', r.body.suspended_reason)
  assert('Gap4 auto_renew_last_error', r.body.auto_renew_last_error === 'insufficient_funds', r.body.auto_renew_last_error)
  assert('Gap4 suspended_at present', !!r.body.suspended_at, r.body.suspended_at)
  assert('Gap4 auto_renew_last_attempt_at present', !!r.body.auto_renew_last_attempt_at, r.body.auto_renew_last_attempt_at)
  assert('Gap7 suspended reflects DB when live down', r.body.suspended === true, r.body.suspended)

  // Gap 6 — DELETE dry-run: no fake terminated:true
  r = await call('DELETE', '/hosting/rtestacct')
  assert('Gap6 DELETE dry-run (no fake success)', r.body.mode === 'dry_run' && r.body.terminated === undefined, r.body)

  // change-primary — dry-run + guards
  r = await call('POST', '/hosting/rtestacct/change-primary', { domain: 'newprimary.example' })
  assert('ChangePrimary dry-run from/to', r.body.mode === 'dry_run' && r.body.from === 'primary.example' && r.body.to === 'newprimary.example', r.body)
  r = await call('POST', '/hosting/rtestacct/change-primary', { domain: 'primary.example' })
  assert('ChangePrimary rejects already-primary', r.status === 400 && r.body.error === 'already_primary', r.body)
  r = await call('POST', '/hosting/rtestacct/change-primary', { domain: 'notadomain' })
  assert('ChangePrimary rejects invalid domain', r.status === 400 && r.body.error === 'invalid_domain', r.body)

  // Gap 2 — REAL addDNSRecord normalization on the Cloudflare branch
  const cfService = require('/app/js/cf-service')
  const captured = []
  cfService.createDNSRecord = async (zoneId, type, name) => { captured.push(name); return { success: true, name } }
  const ds = require('/app/js/domain-service')
  const cases = [
    ['@', 'nstest.example'],
    ['', 'nstest.example'],
    ['nstest.example', 'nstest.example'],
    ['NSTEST.EXAMPLE', 'nstest.example'],
    ['www', 'www.nstest.example'],
    ['www.nstest.example', 'www.nstest.example'],
    ['blog', 'blog.nstest.example'],
  ]
  for (const [input, expected] of cases) {
    captured.length = 0
    await ds.addDNSRecord('nstest.example', 'A', '1.2.3.4', input, db, undefined, undefined)
    assert(`Gap2 name("${input}") -> ${expected}`, captured[0] === expected, { got: captured[0] })
  }

  // ── cleanup ──
  await db.collection('resellerApiKeys').deleteMany({ ownerChatId: OWNER })
  await db.collection('domainsOf').deleteMany({ chatId: OWNER })
  await db.collection('registeredDomains').deleteOne({ _id: 'nstest.example' })
  await db.collection('cpanelAccounts').deleteMany({ chatId: OWNER })
  server.close(); await client.close()

  const failed = results.filter(x => !x.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2) })
