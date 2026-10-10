/* eslint-disable no-console */
// Phase 2 (2026-10) reseller alerts: expiry / renewal / unsuspended / domain-expired / low-balance
// webhooks, origin health + site_down / site_recovered + automatic dns repair, usage thresholds and
// the per-service activity log (API recorder, bot/system writes, GET /activity).
// Run: node js/tests/test_phase2_alerts_2026-10.js
//
// SAFE BY CONSTRUCTION: WHM, anti-red, DNS repair and DigitalOcean usage are replaced with mocks via
// require.cache BEFORE anything loads; all data lives in a throw-away DB on the LOCAL mongod and
// webhooks are delivered to an in-process receiver. No provider, wallet or DNS is touched.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })

process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.RESELLER_WEBHOOK_RETRIES = '0'
process.env.RESELLER_ALERTS_ENABLED = ''
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.BOT_ENVIRONMENT = 'development'

function mockModule(rel, exportsObj) {
  const p = require.resolve(path.resolve(__dirname, '..', rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
const stubProxy = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => ({})) })

const whmAccounts = {}
const bandwidth = []
const whmMock = stubProxy({
  getAccountInfo: async (u) => (whmAccounts[u] ? { success: true, data: whmAccounts[u] } : { success: true, data: { suspended: 0 } }),
  listAccountBandwidth: async () => ({ success: true, data: bandwidth }),
  getAccountBandwidth: async (u) => { const a = bandwidth.find((x) => x.user === u); return a ? { success: true, data: a } : { success: false } },
  generateUsername: (d) => String(d).replace(/[^a-z]/g, '').slice(0, 8),
  unsuspendAccount: async () => ({ success: true }),
  suspendAccount: async () => ({ success: true }),
  _whmApi: null,
})
mockModule('whm-service.js', whmMock)
mockModule('anti-red-service.js', stubProxy({}))
const repairCalls = []
mockModule('hosting-dns-repair.js', {
  repairAccount: async (acct, opts) => {
    repairCalls.push({ user: acct._id, apply: opts.apply })
    return { username: acct._id, domains: [{ domain: acct.domain, status: 'repaired', missing: [`www.${acct.domain}`], created: [{ name: `www.${acct.domain}`, success: true }] }] }
  },
  inspectDomain: async (d) => ({ domain: d, status: 'missing', missing: [`www.${d}`] }),
  domainsOf: (a) => [a.domain],
  isLiveAccount: (a) => !!a && a.deleted !== true,
})
const snaps = {}
mockModule('do-usage.js', { PERIODS: { '1h': 3600, '24h': 86400 }, vpsUsage: async () => ({}), rdpUsage: async () => ({}), alertSnapshot: async (rec) => snaps[rec.vpsId] || { cpu: null, memory: null, disk: null } })

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const webhooks = require('../reseller-webhooks')
const alerts = require('../reseller-alerts')
const sh = require('../reseller-site-health')
const usage = require('../reseller-usage-alerts')
const activity = require('../reseller-activity')
const { createResellerApi } = require('../reseller-api')
const { initScheduler } = require('../hosting-scheduler')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000
const HOUR = 3600000

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_phase2_alerts_${Date.now()}`)

  // ── Webhook receivers (two keys on the same owner) ──
  const got = { a: [], b: [] }
  const hook = express()
  hook.use(express.json())
  hook.post('/a', (req, res) => { got.a.push({ ...req.body, _sig: req.headers['x-nomadly-signature'] }); res.json({ ok: true }) })
  hook.post('/b', (req, res) => { got.b.push(req.body); res.json({ ok: true }) })
  const hs = hook.listen(0)
  const HOOK = `http://127.0.0.1:${hs.address().port}`
  const ev = (name, box = 'a') => got[box].filter((e) => e.event === name)
  const evFor = (name, id, box = 'a') => ev(name, box).filter((e) => e.data && String(e.data.id) === String(id))

  const OWNER = '880000881'
  const OTHER = '880000882'
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const OTHER_KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const KEY1_ID = crypto.randomUUID()
  const KEY2_ID = crypto.randomUUID()
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
  await DB.collection('resellerApiKeys').insertMany([
    { _id: KEY1_ID, keyHash: sha(KEY), enabled: true, ownerChatId: OWNER, label: 'k1', webhookUrl: `${HOOK}/a`, webhookSecret: 'whsec_test' },
    { _id: KEY2_ID, keyHash: sha(crypto.randomUUID()), enabled: true, ownerChatId: OWNER, label: 'k2', webhookUrl: `${HOOK}/b` },
    { _id: crypto.randomUUID(), keyHash: sha(OTHER_KEY), enabled: true, ownerChatId: OTHER, label: 'other' },
  ])
  await DB.collection('walletOf').insertMany([{ _id: OWNER, usdIn: 200, usdOut: 0 }, { _id: OTHER, usdIn: 50, usdOut: 0 }])

  const NOW = Date.now()
  const MONTHLY = 'Premium Anti-Red HostPanel (1-Month)'
  const WEEKLY = 'Premium Anti-Red (1-Week)'
  await DB.collection('cpanelAccounts').insertMany([
    { _id: 'hostaaa', chatId: OWNER, domain: 'aaa.com', plan: MONTHLY, renewalPriceUsd: 75, expiryDate: new Date(NOW + 2.5 * DAY), autoRenew: true },
    { _id: 'hostwk', chatId: OWNER, domain: 'wk.com', plan: WEEKLY, renewalPriceUsd: 30, expiryDate: new Date(NOW + 6.5 * DAY) },
    { _id: 'hostsus', chatId: OWNER, domain: 'sus.com', plan: MONTHLY, expiryDate: new Date(NOW + 20 * DAY), suspended: true },
    { _id: 'hostprov', chatId: OWNER, domain: 'prov.com', plan: MONTHLY, expiryDate: new Date(NOW + 1 * DAY), provisionState: 'provisioning' },
    { _id: 'hostother', chatId: OTHER, domain: 'other.com', plan: MONTHLY, expiryDate: new Date(NOW + 2 * DAY) },
  ])
  await DB.collection('vpsPlansOf').insertMany([
    { _id: 'v1', vpsId: 'v1', chatId: OWNER, isRDP: false, provider: 'digitalocean', status: 'RUNNING', end_time: new Date(NOW + 6 * DAY), planPrice: 40, plan: 's-1vcpu-1gb' },
    { _id: 'r1', vpsId: 'r1', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', status: 'RUNNING', end_time: new Date(NOW + 20 * HOUR), durationMonths: 1, plan: 'Standard RDP' },
    { _id: 'v2', vpsId: 'v2', chatId: OWNER, isRDP: false, status: 'DESTROYED', end_time: new Date(NOW + 1 * DAY) },
  ])
  await DB.collection('domainsOf').insertMany([
    { domainName: 'dom1.com', chatId: OWNER, expiresAt: new Date(NOW + 5 * DAY), registrar: 'OpenProvider' },
    { domainName: 'dom2.com', chatId: OWNER, expiresAt: new Date(NOW + 2 * HOUR) },
  ])

  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {} }))
  const srv = app.listen(0)
  const API = `http://127.0.0.1:${srv.address().port}/reseller/v1`
  const http = axios.create({ baseURL: API, validateStatus: () => true, headers: { Authorization: `Bearer ${KEY}` } })

  console.log('\n=== Events + emit ===')
  await t('EVENTS lists every Phase 2 alert event', async () => {
    for (const e of ['hosting.expiring', 'hosting.renewed', 'hosting.unsuspended', 'vps.expiring', 'vps.renewed', 'rdp.expiring', 'rdp.renewed', 'domain.expiring', 'domain.expired', 'domain.renewed', 'hosting.site_down', 'hosting.site_recovered', 'hosting.usage_threshold', 'vps.usage_threshold', 'rdp.usage_threshold', 'account.low_balance']) {
      assert.ok(webhooks.EVENTS.includes(e), e)
    }
  })
  await t('GET /account/webhook exposes the new events', async () => {
    const r = await http.get('/account/webhook')
    assert.strictEqual(r.status, 200)
    assert.ok(r.data.events.includes('hosting.site_down') && r.data.events.includes('account.low_balance'))
  })
  await t('emit({keyIds}) delivers only to the listed key', async () => {
    await webhooks.emit(DB, { chatId: OWNER, event: 'hosting.expiring', instanceId: 'x-only', dedupKey: 'keyids-test', keyIds: [KEY1_ID], payload: {} })
    assert.strictEqual(evFor('hosting.expiring', 'x-only').length, 1)
    assert.strictEqual(evFor('hosting.expiring', 'x-only', 'b').length, 0)
  })

  console.log('\n=== expiryStage ===')
  await t('7 / 3 / 1-day windows; past and far-future → null', async () => {
    const at = (ms) => new Date(NOW + ms)
    assert.strictEqual(alerts.expiryStage(at(8 * DAY), NOW), null)
    assert.strictEqual(alerts.expiryStage(at(6.9 * DAY), NOW), 7)
    assert.strictEqual(alerts.expiryStage(at(2.5 * DAY), NOW), 3)
    assert.strictEqual(alerts.expiryStage(at(20 * HOUR), NOW), 1)
    assert.strictEqual(alerts.expiryStage(at(-HOUR), NOW), null)
  })
  await t('weekly term never gets the 7-day reminder (would fire at purchase)', async () => {
    assert.strictEqual(alerts.expiryStage(new Date(NOW + 6.5 * DAY), NOW, 7), null)
    assert.strictEqual(alerts.expiryStage(new Date(NOW + 2 * DAY), NOW, 7), 3)
  })

  console.log('\n=== Lifecycle sweep: expiring ===')
  const sweep = (now = NOW) => alerts.runLifecycleSweep(DB, { now })
  await sweep()
  await t('hosting.expiring (3 days) with renewal price, auto_renew, wallet + signature', async () => {
    const e = evFor('hosting.expiring', 'hostaaa')
    assert.strictEqual(e.length, 1, JSON.stringify(got.a.map((x) => [x.event, x.data.id])))
    const d = e[0].data
    assert.strictEqual(d.days_left, 3); assert.strictEqual(d.renewal_price_usd, 75); assert.strictEqual(d.auto_renew, true)
    assert.strictEqual(d.wallet_balance_usd, 200); assert.strictEqual(d.sufficient_balance, true)
    assert.strictEqual(d.domain, 'aaa.com'); assert.ok(d.expires_at && d.hours_left > 0)
    assert.ok(/^sha256=[0-9a-f]{64}$/.test(e[0]._sig))
  })
  await t('second key on the same owner also receives it', async () => assert.strictEqual(evFor('hosting.expiring', 'hostaaa', 'b').length, 1))
  await t('vps.expiring (7) / rdp.expiring (1) / domain.expiring (7 and 1)', async () => {
    assert.strictEqual(evFor('vps.expiring', 'v1')[0].data.days_left, 7)
    assert.strictEqual(evFor('vps.expiring', 'v1')[0].data.renewal_price_usd, 40)
    assert.strictEqual(evFor('rdp.expiring', 'r1')[0].data.days_left, 1)
    assert.strictEqual(evFor('domain.expiring', 'dom1.com')[0].data.days_left, 7)
    assert.strictEqual(evFor('domain.expiring', 'dom2.com')[0].data.days_left, 1)
  })
  await t('skipped: weekly at 6.5d, provisioning, destroyed, other owner without webhook', async () => {
    assert.strictEqual(evFor('hosting.expiring', 'hostwk').length, 0)
    assert.strictEqual(evFor('hosting.expiring', 'hostprov').length, 0)
    assert.strictEqual(evFor('vps.expiring', 'v2').length, 0)
    assert.strictEqual(evFor('hosting.expiring', 'hostother').length, 0)
  })
  await t('re-running the sweep sends nothing new (de-duplicated)', async () => {
    const before = got.a.length
    await sweep(NOW + 60000)
    assert.strictEqual(got.a.length, before)
  })
  await t('weekly plan gets the 3-day reminder once it is in that window', async () => {
    await DB.collection('cpanelAccounts').updateOne({ _id: 'hostwk' }, { $set: { expiryDate: new Date(NOW + 2 * DAY) } })
    await sweep(NOW + 120000)
    assert.strictEqual(evFor('hosting.expiring', 'hostwk')[0].data.days_left, 3)
  })

  console.log('\n=== Lifecycle sweep: transitions ===')
  const T1 = NOW + 10 * 60000
  await DB.collection('cpanelAccounts').updateOne({ _id: 'hostaaa' }, { $set: { expiryDate: new Date(NOW + 32.5 * DAY) } })
  await DB.collection('cpanelAccounts').updateOne({ _id: 'hostwk' }, { $set: { expiryDate: new Date(NOW + 30 * DAY), planChangedAt: new Date(T1 - 1000), plan: MONTHLY } })
  await DB.collection('vpsPlansOf').updateOne({ _id: 'v1' }, { $set: { end_time: new Date(NOW + 36 * DAY) } })
  await DB.collection('cpanelAccounts').updateOne({ _id: 'hostsus' }, { $set: { suspended: false } })
  await sweep(T1)
  await t('hosting.renewed carries previous + new expiry (renewed through any channel)', async () => {
    const e = evFor('hosting.renewed', 'hostaaa')
    assert.strictEqual(e.length, 1)
    assert.strictEqual(new Date(e[0].data.expires_at).getTime(), NOW + 32.5 * DAY)
    assert.strictEqual(new Date(e[0].data.previous_expires_at).getTime(), NOW + 2.5 * DAY)
  })
  await t('a plan change with a fresh term is NOT reported as renewed', async () => assert.strictEqual(evFor('hosting.renewed', 'hostwk').length, 0))
  await t('vps.renewed', async () => assert.strictEqual(evFor('vps.renewed', 'v1').length, 1))
  await t('hosting.unsuspended with suspended_since', async () => {
    const e = evFor('hosting.unsuspended', 'hostsus')
    assert.strictEqual(e.length, 1); assert.ok(e[0].data.suspended_since)
  })
  await t('domain.expired fires once when the expiry passes (observed transition)', async () => {
    await sweep(NOW + 3 * HOUR)
    await sweep(NOW + 4 * HOUR)
    assert.strictEqual(evFor('domain.expired', 'dom2.com').length, 1)
  })
  await t('no duplicates of any event per resource', async () => {
    const seen = new Set()
    for (const e of got.a) {
      const k = `${e.event}:${e.data.id}:${e.data.days_left || ''}`
      assert.ok(!seen.has(k), `duplicate ${k}`); seen.add(k)
    }
  })

  console.log('\n=== Hosting scheduler auto-renew → hosting.renewed + activity ===')
  await DB.collection('cpanelAccounts').insertOne({ _id: 'hostren', chatId: OWNER, domain: 'ren.com', plan: MONTHLY, renewalPriceUsd: 75, expiryDate: new Date(Date.now() - HOUR), autoRenew: true })
  await sweep(Date.now())
  const sch = initScheduler({ bot: null, db: DB, whmService: whmMock })
  await sch.runCheck()
  await sleep(300)
  await t('auto-renew pushes hosting.renewed (via auto_renew, charged_usd)', async () => {
    const e = evFor('hosting.renewed', 'hostren')
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].data.via, 'auto_renew'); assert.strictEqual(e[0].data.charged_usd, 75)
  })
  await t('the sweep sees the same renewal and does not send it twice', async () => {
    await sweep(Date.now() + 1000)
    assert.strictEqual(evFor('hosting.renewed', 'hostren').length, 1)
  })
  await t('activity: auto_renew.charged recorded by actor system', async () => {
    const a = await DB.collection('resellerActivity').findOne({ resourceId: 'hostren', action: 'auto_renew.charged' })
    assert.ok(a); assert.strictEqual(a.actor, 'system'); assert.strictEqual(a.ownerChatId, OWNER)
  })

  console.log('\n=== Low balance (PUT/GET /account/alerts) ===')
  await t('GET /account/alerts: off by default + fixed settings', async () => {
    const r = await http.get('/account/alerts')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.data.low_balance_usd, null)
    assert.deepStrictEqual(r.data.expiry_reminder_days, [7, 3, 1])
    assert.strictEqual(r.data.health_check.failures_before_site_down, 3)
    assert.strictEqual(r.data.usage_thresholds.vps_rdp.cpu_pct, 90)
    assert.ok(r.data.events.includes('account.low_balance'))
  })
  await t('PUT validation: missing field / non-number / negative → 400', async () => {
    assert.strictEqual((await http.put('/account/alerts', {})).data.error, 'nothing_to_update')
    assert.strictEqual((await http.put('/account/alerts', { low_balance_usd: 'abc' })).status, 400)
    assert.strictEqual((await http.put('/account/alerts', { low_balance_usd: -5 })).data.error, 'invalid_low_balance_usd')
  })
  const bal = async () => (await http.get('/account')).data.wallet_balance_usd
  await t('threshold above balance → account.low_balance once, only to that key', async () => {
    const r = await http.put('/account/alerts', { low_balance_usd: 5000 })
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.low_balance_usd, 5000); assert.strictEqual(r.data.below_threshold, true)
    await sleep(400)
    const e = ev('account.low_balance')
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].data.threshold_usd, 5000); assert.strictEqual(e[0].data.wallet_balance_usd, await bal())
    assert.strictEqual(ev('account.low_balance', 'b').length, 0)
    await alerts.checkLowBalance(DB, OWNER)
    assert.strictEqual(ev('account.low_balance').length, 1)
  })
  await t('re-arms after the balance recovers, fires again on the next drop', async () => {
    await DB.collection('walletOf').updateOne({ _id: OWNER }, { $inc: { usdIn: 10000 } })
    await alerts.checkLowBalance(DB, OWNER)
    assert.ok(!(await DB.collection('resellerApiKeys').findOne({ _id: KEY1_ID })).alerts.lowBalanceAlertedAt)
    await DB.collection('walletOf').updateOne({ _id: OWNER }, { $inc: { usdOut: 10000 } })
    await alerts.checkLowBalance(DB, OWNER)
    assert.strictEqual(ev('account.low_balance').length, 2)
  })
  await t('PUT null turns it off', async () => {
    const r = await http.put('/account/alerts', { low_balance_usd: null })
    assert.strictEqual(r.data.low_balance_usd, null); assert.strictEqual(r.data.below_threshold, false)
  })

  console.log('\n=== Activity log ===')
  await t('API recorder: successful mutation recorded with actor api; dry-run / 404 / 400 are not', async () => {
    assert.strictEqual((await http.post('/hosting/hostaaa/auto-renew', { enabled: false })).status, 200)
    assert.strictEqual((await http.post('/hosting/hostaaa/renew', { dry_run: true })).status, 200)
    assert.strictEqual((await http.post('/hosting/nope/suspend', {})).status, 404)
    await sleep(200)
    const docs = await DB.collection('resellerActivity').find({ ownerChatId: OWNER, actor: 'api' }).toArray()
    const acts = docs.map((d) => `${d.resourceId}:${d.action}`)
    assert.ok(acts.includes('hostaaa:auto_renew.disabled'), acts.join(','))
    assert.ok(!acts.some((a) => a.includes('renew') && !a.includes('auto_renew')), acts.join(','))
    assert.ok(!acts.some((a) => a.startsWith('nope')))
    assert.strictEqual(docs.filter((d) => d.action === 'alerts.update').length, 2, 'two successful PUT /account/alerts (400s not recorded)')
    const d = docs.find((x) => x.action === 'auto_renew.disabled')
    assert.strictEqual(d.details.request.enabled, false); assert.strictEqual(d.details.result.auto_renew, false)
  })
  await activity.record(DB, { ownerChatId: OWNER, resourceType: 'hosting', resourceId: 'HostAAA', action: 'dns.repair', actor: 'system', details: { created: ['www.aaa.com'] } })
  await activity.record(DB, { ownerChatId: OTHER, resourceType: 'hosting', resourceId: 'hostaaa', action: 'suspend', actor: 'bot' })
  await t('GET /activity?resource=hosting:hostaaa — newest first, owner-scoped, ids normalised', async () => {
    const r = await http.get('/activity', { params: { resource: 'hosting:hostaaa' } })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.retention_days, 90)
    const acts = r.data.activity.map((a) => a.action)
    assert.deepStrictEqual(acts.slice(0, 2), ['dns.repair', 'auto_renew.disabled'])
    assert.ok(!r.data.activity.some((a) => a.action === 'suspend'), 'other owner entry leaked')
    assert.ok(r.data.activity.every((a) => a.resource_id === 'hostaaa' && a.resource_type === 'hosting'))
  })
  await t('filters: actor, action prefix, resource_type', async () => {
    const a = await http.get('/activity', { params: { actor: 'system' } })
    assert.ok(a.data.activity.length >= 2 && a.data.activity.every((x) => x.actor === 'system'))
    const p = await http.get('/activity', { params: { action: 'auto_renew' } })
    assert.ok(p.data.activity.length >= 2 && p.data.activity.every((x) => x.action.startsWith('auto_renew.')))
    const ty = await http.get('/activity', { params: { resource_type: 'account' } })
    assert.ok(ty.data.activity.length >= 2 && ty.data.activity.every((x) => x.resource_type === 'account'))
  })
  await t('pagination: limit=1 → has_more + next_cursor → next page', async () => {
    const p1 = await http.get('/activity', { params: { limit: 1 } })
    assert.strictEqual(p1.data.count, 1); assert.strictEqual(p1.data.has_more, true); assert.ok(p1.data.next_cursor)
    const p2 = await http.get('/activity', { params: { limit: 1, cursor: p1.data.next_cursor } })
    assert.strictEqual(p2.data.count, 1); assert.notStrictEqual(p2.data.activity[0].id, p1.data.activity[0].id)
  })
  await t('bad params → 400 invalid_actor / invalid_limit / invalid_cursor / invalid_resource_type / invalid_date', async () => {
    for (const [q, code] of [[{ actor: 'robot' }, 'invalid_actor'], [{ limit: 0 }, 'invalid_limit'], [{ cursor: 'zzz' }, 'invalid_cursor'], [{ resource_type: 'car' }, 'invalid_resource_type'], [{ since: 'nope' }, 'invalid_date']]) {
      const r = await http.get('/activity', { params: q })
      assert.strictEqual(r.status, 400); assert.strictEqual(r.data.error, code)
    }
  })
  await t('TTL index keeps 90 days', async () => {
    const idx = await DB.collection('resellerActivity').indexes()
    const ttl = idx.find((i) => i.name === 'ttl_at')
    assert.ok(ttl); assert.strictEqual(ttl.expireAfterSeconds, 90 * 86400)
  })

  console.log('\n=== Site health ===')
  const dnsMap = {}
  const originMap = {}
  sh.probes.resolves = async (name) => (name in dnsMap ? dnsMap[name] : true)
  sh.probes.tunnelStatus = async () => ({ connected: true, status: 'healthy', connections: 4 })
  sh.probes.probeOrigin = async (d) => originMap[d] || { ok: true, http_status: 200, ttfb_ms: 50, checked_at: new Date().toISOString() }
  sh.probes.sslInfo = async () => ({ valid: true, valid_until: '2027-01-01T00:00:00.000Z', days_left: 80, issuer: 'Google Trust Services' })
  sh.probes.phpErrorsLast24h = async () => ({ count: 2 })
  const DOWN = { ok: false, http_status: 530, ttfb_ms: 40, checked_at: new Date().toISOString(), error: 'origin_unreachable' }
  await t('overallStatus rules', async () => {
    const ok = { ok: true }
    assert.strictEqual(sh.overallStatus({ dns: { apex: true, www: true }, tunnel: { connected: true }, origin: ok }), 'up')
    assert.strictEqual(sh.overallStatus({ dns: { apex: true, www: false }, tunnel: { connected: true }, origin: ok }), 'degraded')
    assert.strictEqual(sh.overallStatus({ dns: { apex: false, www: true }, tunnel: { connected: true }, origin: ok }), 'down')
    assert.strictEqual(sh.overallStatus({ dns: { apex: true, www: true }, tunnel: { connected: true }, origin: { ok: false } }), 'down')
    assert.strictEqual(sh.overallStatus({ dns: { apex: true, www: true }, tunnel: { connected: true }, origin: { ok: null } }), 'unknown')
  })
  await t('countRecentPhpErrors counts only PHP lines from the last 24h', async () => {
    const fmt = (d) => { const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; const p = (n) => String(n).padStart(2, '0'); return `[${p(d.getUTCDate())}-${m}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC]` }
    const now = Date.now()
    const log = [`${fmt(new Date(now - HOUR))} PHP Warning: x`, `${fmt(new Date(now - 2 * HOUR))} PHP Fatal error: y`, `${fmt(new Date(now - 2 * DAY))} PHP Notice: old`, 'Stack trace:', `${fmt(new Date(now - HOUR))} not php`].join('\n')
    assert.strictEqual(sh.countRecentPhpErrors(log, now), 2)
  })
  await t('monitoredAccounts: live reseller-owned accounts only', async () => {
    await DB.collection('cpanelAccounts').updateOne({ _id: 'hostsus' }, { $set: { suspended: true } })
    const ids = (await sh.monitoredAccounts(DB)).map((a) => a._id).sort()
    assert.ok(ids.includes('hostaaa') && ids.includes('hostother'))
    assert.ok(!ids.includes('hostsus') && !ids.includes('hostprov'))
  })
  const acctOf = (id) => DB.collection('cpanelAccounts').findOne({ _id: id })
  let tm = Date.now()
  const tick = async (id) => { tm += 5 * 60000; return sh.monitorAccount(DB, await acctOf(id), { now: tm }) }
  await t('3 failed checks in a row → hosting.site_down once', async () => {
    assert.strictEqual((await tick('hostaaa')).status, 'up')
    originMap['aaa.com'] = DOWN
    assert.strictEqual((await tick('hostaaa')).event, null)
    assert.strictEqual((await tick('hostaaa')).event, null)
    const third = await tick('hostaaa')
    assert.strictEqual(third.event, 'hosting.site_down'); assert.strictEqual(third.status, 'down')
    assert.strictEqual((await tick('hostaaa')).event, null)
    const e = evFor('hosting.site_down', 'hostaaa')
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].data.consecutive_failures, 3); assert.ok(e[0].data.down_since); assert.strictEqual(e[0].data.checks.origin.http_status, 530)
  })
  await t('next good check → hosting.site_recovered with downtime; activity site.down / site.recovered', async () => {
    delete originMap['aaa.com']
    const r = await tick('hostaaa')
    assert.strictEqual(r.event, 'hosting.site_recovered')
    const e = evFor('hosting.site_recovered', 'hostaaa')
    assert.strictEqual(e.length, 1); assert.ok(e[0].data.downtime_minutes >= 15)
    const acts = (await DB.collection('resellerActivity').find({ resourceId: 'hostaaa', actor: 'system' }).toArray()).map((a) => a.action)
    assert.ok(acts.includes('site.down') && acts.includes('site.recovered'), acts.join(','))
  })
  await t('a site never seen up does not trigger site_down', async () => {
    await DB.collection('cpanelAccounts').insertOne({ _id: 'hostnew', chatId: OWNER, domain: 'new.com', plan: MONTHLY, expiryDate: new Date(Date.now() + 20 * DAY) })
    originMap['new.com'] = DOWN
    for (let i = 0; i < 4; i++) assert.strictEqual((await tick('hostnew')).event, null)
    assert.strictEqual(evFor('hosting.site_down', 'hostnew').length, 0)
  })
  await t('DNS lookup failure → automatic dns/repair + activity dns.repair; 30-min cooldown', async () => {
    dnsMap['www.aaa.com'] = false
    repairCalls.length = 0
    const r = await tick('hostaaa')
    assert.deepStrictEqual(repairCalls, [{ user: 'hostaaa', apply: true }]); assert.deepStrictEqual(r.repaired, ['www.aaa.com'])
    await tick('hostaaa')
    assert.strictEqual(repairCalls.length, 1, 'cooldown')
    tm += 30 * 60000
    await tick('hostaaa')
    assert.strictEqual(repairCalls.length, 2)
    const a = await DB.collection('resellerActivity').findOne({ resourceId: 'hostaaa', action: 'dns.repair', actor: 'system', 'details.trigger': 'health_check' })
    assert.ok(a); assert.deepStrictEqual(a.details.created, ['www.aaa.com'])
    delete dnsMap['www.aaa.com']
  })
  await t('runHealthSweep checks every monitored account', async () => {
    const r = await sh.runHealthSweep(DB, { now: tm + 5 * 60000 })
    assert.ok(r.checked >= 3, JSON.stringify(r))
  })
  await t('GET /hosting/:user/health → full shape + monitor state', async () => {
    const r = await http.get('/hosting/hostaaa/health')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    const d = r.data
    assert.strictEqual(d.username, 'hostaaa'); assert.strictEqual(d.domain, 'aaa.com'); assert.strictEqual(d.status, 'up')
    assert.deepStrictEqual(d.dns, { apex: true, www: true, ok: true })
    assert.strictEqual(d.tunnel.connected, true); assert.strictEqual(d.origin.http_status, 200); assert.ok(d.origin.ttfb_ms >= 0)
    assert.strictEqual(d.ssl.valid, true); assert.strictEqual(d.php_errors_last_24h, 2)
    assert.strictEqual(d.monitor.interval_minutes, 5); assert.strictEqual(d.monitor.status, 'up'); assert.ok(d.monitor.last_ok_at)
  })
  await t('GET health with a missing www → degraded + dns.cloudflare + repair_url (read-only, no repair)', async () => {
    dnsMap['www.aaa.com'] = false
    repairCalls.length = 0
    const r = await http.get('/hosting/hostaaa/health')
    assert.strictEqual(r.data.status, 'degraded'); assert.strictEqual(r.data.dns.cloudflare.status, 'missing')
    assert.strictEqual(r.data.dns.repair_url, '/hosting/hostaaa/dns/repair'); assert.strictEqual(repairCalls.length, 0)
    delete dnsMap['www.aaa.com']
  })
  await t('GET health: suspended → 409, provisioning → 409, other owner → 404', async () => {
    assert.strictEqual((await http.get('/hosting/hostsus/health')).data.error, 'account_suspended')
    assert.strictEqual((await http.get('/hosting/hostprov/health')).data.error, 'account_not_live')
    assert.strictEqual((await http.get('/hosting/hostother/health')).status, 404)
  })

  console.log('\n=== Usage thresholds ===')
  whmAccounts.hostaaa = { diskused: '850M', disklimit: '1000M', inodesused: '1000', inodeslimit: 'unlimited', suspended: 0 }
  const usageSweep = (opts = {}) => usage.runUsageSweep(DB, { includeHosting: true, ...opts })
  await t('hosting disk 85% → usage_threshold 80 (once)', async () => {
    await usageSweep()
    await usageSweep()
    const e = evFor('hosting.usage_threshold', 'hostaaa').filter((x) => x.data.metric === 'disk')
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].data.threshold_pct, 80); assert.strictEqual(e[0].data.percent, 85); assert.strictEqual(e[0].data.limit_mb, 1000)
  })
  await t('disk 96% → 95 level; drop below 75% re-arms; 82% fires 80 again', async () => {
    whmAccounts.hostaaa.diskused = '960M'; await usageSweep()
    whmAccounts.hostaaa.diskused = '700M'; await usageSweep()
    whmAccounts.hostaaa.diskused = '820M'; await usageSweep()
    const lv = evFor('hosting.usage_threshold', 'hostaaa').filter((x) => x.data.metric === 'disk').map((x) => x.data.threshold_pct)
    assert.deepStrictEqual(lv, [80, 95, 80])
  })
  await t('bandwidth jump to 96% → straight to the 95 level', async () => {
    bandwidth.push({ user: 'hostaaa', totalbytes: 960 * 1048576, limit: 1000 * 1048576 })
    await usageSweep()
    const e = evFor('hosting.usage_threshold', 'hostaaa').filter((x) => x.data.metric === 'bandwidth')
    assert.strictEqual(e.length, 1); assert.strictEqual(e[0].data.threshold_pct, 95); assert.strictEqual(e[0].data.period, 'current_month')
  })
  await t('VPS CPU 95% (15-min avg) → vps.usage_threshold cpu 90; RDP disk 90% → rdp disk 85', async () => {
    snaps.v1 = { cpu: 95, memory: 50, disk: 10 }
    snaps.r1 = { cpu: 20, memory: 40, disk: 90 }
    await usageSweep({ includeHosting: false })
    const v = evFor('vps.usage_threshold', 'v1')
    assert.strictEqual(v.length, 1); assert.strictEqual(v[0].data.metric, 'cpu'); assert.strictEqual(v[0].data.threshold_pct, 90); assert.strictEqual(v[0].data.window_minutes, 15)
    const r = evFor('rdp.usage_threshold', 'r1')
    assert.strictEqual(r.length, 1); assert.strictEqual(r[0].data.metric, 'disk'); assert.strictEqual(r[0].data.threshold_pct, 85)
  })

  console.log('\n=== Safety ===')
  await t('sweeps are off on a dev pod; RESELLER_ALERTS_ENABLED overrides', async () => {
    assert.strictEqual(alerts.enabled(), false)
    assert.deepStrictEqual(alerts.start({ getDb: () => DB, log: () => {} }), [])
    process.env.RESELLER_ALERTS_ENABLED = 'true'
    assert.strictEqual(alerts.enabled(), true)
    process.env.RESELLER_ALERTS_ENABLED = ''
  })
  await t('API doc lists the alerts group, health + activity endpoints and new events', async () => {
    const html = require('../apidoc-page').renderApiDocPage('https://x/api/reseller/v1')
    for (const s of ['Alerts, Monitoring &amp; Activity', '/hosting/:user/health', '/account/alerts', '/activity', 'hosting.site_down', 'account.low_balance']) assert.ok(html.includes(s), s)
  })

  await DB.dropDatabase()
  await client.close()
  srv.close(); hs.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
