/* eslint-disable no-console */
// Phase 3 (2026-10) billing & domains: prepaid 3/6/12-month hosting terms (catalog, create, renew,
// detail, plan-change pro-rata at the term discount, scheduler auto-renew on the same term) and
// per-domain wallet auto-renew for OpenProvider domains (API toggle, hourly sweep, webhooks).
// Run: node js/tests/test_phase3_billing_2026-10.js
//
// SAFE BY CONSTRUCTION: WHM, anti-red, the cPanel provisioning helper and OpenProvider are mocked via
// require.cache BEFORE anything loads; all data lives in a throw-away DB on the LOCAL mongod and
// webhooks are delivered to an in-process receiver. No provider, registrar, wallet or DNS is touched.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })

process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.RESELLER_WEBHOOK_RETRIES = '0'
process.env.RESELLER_ALERTS_ENABLED = ''
process.env.RESELLER_DOMAIN_AUTORENEW_ENABLED = ''
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.BOT_ENVIRONMENT = 'development'
process.env.PREMIUM_ANTIRED_CPANEL_PRICE = '75'
process.env.GOLDEN_ANTIRED_CPANEL_PRICE = '100'
process.env.PREMIUM_ANTIRED_WEEKLY_PRICE = '30'

function mockModule(rel, exportsObj) {
  const p = require.resolve(path.resolve(__dirname, '..', rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
const stubProxy = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => ({})) })

const whmMock = stubProxy({
  getAccountInfo: async () => ({ success: true, data: { suspended: 0 } }),
  getAccountBandwidth: async () => ({ success: false }),
  generateUsername: (d) => String(d).replace(/[^a-z]/g, '').slice(0, 8),
  changePackage: async () => ({ success: true }),
  unsuspendAccount: async () => ({ success: true }),
  suspendAccount: async () => ({ success: true }),
  _whmApi: null,
})
mockModule('whm-service.js', whmMock)
mockModule('anti-red-service.js', stubProxy({}))
mockModule('cr-register-domain-&-create-cpanel.js', {
  registerDomainAndCreateCpanel: async (send, info) => ({ success: true, username: info.customUsername, password: 'Pw-test-123!', nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] }),
})
const op = { info: {}, price: {}, renewCalls: [], renewFail: false }
mockModule('op-service.js', stubProxy({
  getDomainInfo: async (d) => (op.info[d] ? { domainId: 1, expiresAt: op.info[d] } : null),
  getRenewPrice: async (d) => (op.price[d] != null ? { price: op.price[d] } : { error: 'no price' }),
  renewDomain: async (d) => {
    op.renewCalls.push(d)
    await new Promise((r) => setTimeout(r, 30))
    if (op.renewFail) return { error: 'registrar down' }
    const n = new Date(op.info[d]); n.setUTCFullYear(n.getUTCFullYear() + 1); op.info[d] = n.toISOString()
    return { success: true, expiresAt: op.info[d] }
  },
}))

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const webhooks = require('../reseller-webhooks')
const alerts = require('../reseller-alerts')
const terms = require('../hosting-terms')
const dar = require('../domain-auto-renew')
const hostingScheduler = require('../hosting-scheduler')
const { createResellerApi } = require('../reseller-api')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000
const HOUR = 3600000
const near = (a, b, tol = 0.02) => assert.ok(Math.abs(Number(a) - Number(b)) <= tol, `${a} ≈ ${b}`)
const nearMs = (a, b, tol = 5 * 60000) => assert.ok(Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= tol, `${new Date(a).toISOString()} ≈ ${new Date(b).toISOString()}`)

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_phase3_billing_${Date.now()}`)

  const got = { a: [], b: [] }
  const hook = express()
  hook.use(express.json())
  hook.post('/a', (req, res) => { got.a.push(req.body); res.json({ ok: true }) })
  hook.post('/b', (req, res) => { got.b.push(req.body); res.json({ ok: true }) })
  const hs = hook.listen(0)
  const HOOK = `http://127.0.0.1:${hs.address().port}`
  const evFor = (name, id, box = 'a') => got[box].filter((e) => e.event === name && e.data && String(e.data.id) === String(id))

  const OWNER = '880000991'
  const POOR = '880000992'
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const POOR_KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
  await DB.collection('resellerApiKeys').insertMany([
    { _id: crypto.randomUUID(), keyHash: sha(KEY), enabled: true, ownerChatId: OWNER, label: 'k1', webhookUrl: `${HOOK}/a`, webhookSecret: 'whsec_test' },
    { _id: crypto.randomUUID(), keyHash: sha(POOR_KEY), enabled: true, ownerChatId: POOR, label: 'poor', webhookUrl: `${HOOK}/b` },
  ])
  await DB.collection('walletOf').insertMany([{ _id: OWNER, usdIn: 10000, usdOut: 0 }, { _id: POOR, usdIn: 10, usdOut: 0 }])
  const bal = async (id) => { const w = await DB.collection('walletOf').findOne({ _id: id }); return Math.round(((w.usdIn || 0) - (w.usdOut || 0)) * 100) / 100 }

  const NOW = Date.now()
  const PREMIUM = 'Premium Anti-Red HostPanel (1-Month)'
  const GOLDEN = 'Golden Anti-Red HostPanel (1-Month)'
  const WEEKLY = 'Premium Anti-Red (1-Week)'
  const acct = (id, o) => ({ _id: id, cpUser: id, chatId: OWNER, domain: `${id}.com`, plan: PREMIUM, renewalPriceUsd: 75, autoRenew: true, ...o })
  await DB.collection('cpanelAccounts').insertMany([
    acct('hostm1', { expiryDate: new Date(NOW + 10 * DAY) }),
    acct('hostleg', { expiryDate: new Date(NOW + 10 * DAY) }),
    acct('hostwk', { plan: WEEKLY, renewalPriceUsd: 30, expiryDate: new Date(NOW + 5 * DAY) }),
    acct('hostup', { termMonths: 6, expiryDate: new Date(NOW + 60 * DAY) }),
    acct('hostup1', { expiryDate: new Date(NOW + 60 * DAY) }),
    acct('hostexp', { termMonths: 3, expiryDate: new Date(NOW - HOUR) }),
    acct('hostpoor', { chatId: POOR, plan: GOLDEN, renewalPriceUsd: 100, termMonths: 12, expiryDate: new Date(NOW - HOUR) }),
  ])

  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {} }))
  const srv = app.listen(0)
  const API = `http://127.0.0.1:${srv.address().port}/reseller/v1`
  const http = axios.create({ baseURL: API, validateStatus: () => true, headers: { Authorization: `Bearer ${KEY}` } })
  const httpPoor = axios.create({ baseURL: API, validateStatus: () => true, headers: { Authorization: `Bearer ${POOR_KEY}` } })

  console.log('\n=== hosting-terms ===')
  await t('term prices: 10% / 15% / 25% off monthly × months', async () => {
    assert.strictEqual(terms.termPrice(75, 1), 75)
    assert.strictEqual(terms.termPrice(75, 3), 202.5)
    assert.strictEqual(terms.termPrice(75, 6), 382.5)
    assert.strictEqual(terms.termPrice(75, 12), 675)
    assert.strictEqual(terms.termPrice(100, 12), 900)
  })
  await t('parseMonths validates values and blocks weekly terms', async () => {
    assert.deepStrictEqual(terms.parseMonths(undefined, 30), { months: null })
    assert.strictEqual(terms.parseMonths(2, 30).error, 'invalid_months')
    assert.strictEqual(terms.parseMonths('abc', 30).error, 'invalid_months')
    assert.strictEqual(terms.parseMonths(3, 7).error, 'term_not_available')
    assert.deepStrictEqual(terms.parseMonths(1, 7), { months: 1 })
    assert.deepStrictEqual(terms.parseMonths('12', 30), { months: 12 })
  })
  await t('getRenewalCharge: term price + term days; weekly / legacy unchanged', async () => {
    const r6 = hostingScheduler.getRenewalCharge({ plan: PREMIUM, renewalPriceUsd: 75, termMonths: 6 })
    assert.deepStrictEqual([r6.months, r6.priceUsd, r6.days, r6.discountPct], [6, 382.5, 180, 15])
    const wk = hostingScheduler.getRenewalCharge({ plan: WEEKLY, renewalPriceUsd: 30, termMonths: 6 })
    assert.deepStrictEqual([wk.months, wk.priceUsd, wk.days], [1, 30, 7])
    const leg = hostingScheduler.getRenewalCharge({ plan: PREMIUM, renewalPriceUsd: 37.5 })
    assert.deepStrictEqual([leg.months, leg.priceUsd, leg.days], [1, 37.5, 30])
  })

  console.log('\n=== GET /hosting/plans ===')
  await t('monthly plans list 1/3/6/12-month terms; weekly has none', async () => {
    const r = await http.get('/hosting/plans')
    assert.strictEqual(r.status, 200)
    const pm = r.data.plans.find((p) => p.plan_id === 'premium-monthly')
    assert.deepStrictEqual(pm.terms.map((x) => x.months), [1, 3, 6, 12])
    const t12 = pm.terms.find((x) => x.months === 12)
    assert.deepStrictEqual([t12.price_usd, t12.discount_pct, t12.duration_days, t12.monthly_equivalent_usd, t12.savings_usd], [675, 25, 360, 56.25, 225])
    assert.deepStrictEqual(r.data.plans.find((p) => p.plan_id === 'premium-weekly').terms, [])
    assert.deepStrictEqual(r.data.term_discounts_pct, { 1: 0, 3: 10, 6: 15, 12: 25 })
  })

  console.log('\n=== POST /hosting with months ===')
  await t('golden 6 months → charged $510 up-front, account lands on a 180-day term', async () => {
    const before = await bal(OWNER)
    const r = await http.post('/hosting', { plan_id: 'golden-monthly', months: 6, domain: 'sixmonth.com', domain_mode: 'external' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.price_usd, r.data.term_months, r.data.term_discount_pct, r.data.hosting_usd], [510, 6, 15, 510])
    near(before - await bal(OWNER), 510)
    let a = null
    for (let i = 0; i < 40 && !(a && a.provisionState === 'active'); i++) { await sleep(50); a = await DB.collection('cpanelAccounts').findOne({ _id: r.data.username }) }
    assert.strictEqual(a.provisionState, 'active')
    assert.deepStrictEqual([a.termMonths, a.renewalPriceUsd], [6, 100])
    nearMs(a.expiryDate, NOW + 180 * DAY)
  })
  await t('GET /hosting/:user shows the term price, days and discount', async () => {
    const r = await http.get('/hosting/sixmonth')
    assert.strictEqual(r.status, 200)
    assert.deepStrictEqual([r.data.price_usd, r.data.duration_days, r.data.term_months, r.data.term_discount_pct, r.data.monthly_price_usd], [510, 180, 6, 15, 100])
    const l = await http.get('/hosting')
    const row = l.data.accounts.find((x) => x.username === 'sixmonth')
    assert.deepStrictEqual([row.term_months, row.renewal_price_usd], [6, 510])
  })
  await t('no months → 1-month term at the full price (unchanged)', async () => {
    const before = await bal(OWNER)
    const r = await http.post('/hosting', { plan_id: 'premium-monthly', domain: 'onemonth.com', domain_mode: 'external' })
    assert.strictEqual(r.status, 202)
    assert.deepStrictEqual([r.data.price_usd, r.data.term_months], [75, 1])
    near(before - await bal(OWNER), 75)
  })
  await t('invalid months / weekly term → 400 before any charge', async () => {
    const before = await bal(OWNER)
    const a = await http.post('/hosting', { plan_id: 'premium-monthly', months: 4, domain: 'bad4.com', domain_mode: 'external' })
    assert.strictEqual(a.status, 400); assert.strictEqual(a.data.error, 'invalid_months')
    const b = await http.post('/hosting', { plan_id: 'premium-weekly', months: 3, domain: 'badwk.com', domain_mode: 'external' })
    assert.strictEqual(b.status, 400); assert.strictEqual(b.data.error, 'term_not_available')
    assert.strictEqual(await bal(OWNER), before)
  })

  console.log('\n=== POST /hosting/:user/renew with months ===')
  await t('dry_run months 12 → $675 for 360 days, nothing charged', async () => {
    const before = await bal(OWNER)
    const r = await http.post('/hosting/hostm1/renew', { months: 12, dry_run: true })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.price_usd, r.data.duration_days, r.data.term_months, r.data.term_discount_pct, r.data.monthly_price_usd], [675, 360, 12, 25, 75])
    nearMs(r.data.would_expire_at, NOW + 370 * DAY)
    assert.strictEqual(await bal(OWNER), before)
  })
  await t('live months 3 → charged $202.50, +90 days, becomes the auto-renew term', async () => {
    const before = await bal(OWNER)
    const r = await http.post('/hosting/hostm1/renew', { months: 3 })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.result.term_months, r.data.result.duration_days], [3, 90])
    near(before - await bal(OWNER), 202.5)
    const a = await DB.collection('cpanelAccounts').findOne({ _id: 'hostm1' })
    assert.strictEqual(a.termMonths, 3)
    nearMs(a.expiryDate, NOW + 100 * DAY)
  })
  await t('without months the current term is renewed; periods capped at 12 months total', async () => {
    const r = await http.post('/hosting/hostm1/renew', { dry_run: true })
    assert.deepStrictEqual([r.data.price_usd, r.data.term_months, r.data.duration_days], [202.5, 3, 90])
    const p = await http.post('/hosting/hostm1/renew', { periods: 5, dry_run: true })
    assert.deepStrictEqual([p.data.periods, p.data.price_usd, p.data.duration_days], [4, 810, 360])
  })
  await t('legacy 1-month account: periods 2 → $150 / 60 days (unchanged)', async () => {
    const r = await http.post('/hosting/hostleg/renew', { periods: 2, dry_run: true })
    assert.deepStrictEqual([r.data.periods, r.data.price_usd, r.data.duration_days, r.data.term_months], [2, 150, 60, 1])
  })
  await t('months + periods, bad months, weekly term → 400; weekly months 1 still renews 1 week', async () => {
    const a = await http.post('/hosting/hostm1/renew', { months: 3, periods: 2 })
    assert.strictEqual(a.status, 400); assert.strictEqual(a.data.error, 'invalid_body')
    const b = await http.post('/hosting/hostm1/renew', { months: 7 })
    assert.strictEqual(b.status, 400); assert.strictEqual(b.data.error, 'invalid_months')
    const c = await http.post('/hosting/hostwk/renew', { months: 3 })
    assert.strictEqual(c.status, 400); assert.strictEqual(c.data.error, 'term_not_available')
    const d = await http.post('/hosting/hostwk/renew', { months: 1, dry_run: true })
    assert.strictEqual(d.status, 200); assert.deepStrictEqual([d.data.price_usd, d.data.duration_days, d.data.monthly_price_usd], [30, 7, null])
  })
  await t('auto-renew toggle reports the term renewal price', async () => {
    const r = await http.post('/hosting/hostm1/auto-renew', { enabled: true })
    assert.deepStrictEqual([r.data.auto_renew, r.data.term_months, r.data.renewal_price_usd, r.data.renewal_days], [true, 3, 202.5, 90])
  })

  console.log('\n=== Plan change on a prepaid term ===')
  await t('plan-options: upgrade pro-rata at the 6-month discount, renews on the same term', async () => {
    const r = await http.get('/hosting/hostup/plan-options')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.current.term_months, r.data.current.renewal_price_usd, r.data.current.term_discount_pct], [6, 382.5, 15])
    const g = r.data.options.find((o) => o.plan_id === 'golden-monthly')
    near(g.charge_now_usd, 42.5) // (100 − 75) × 0.85 × 60 / 30
    assert.deepStrictEqual([g.renewal_price_usd, g.renewal_days, g.term_months, g.expiry_changes], [510, 180, 6, false])
  })
  await t('1-month account keeps the full-price pro-rata ($50 for 60 days)', async () => {
    const r = await http.get('/hosting/hostup1/plan-options')
    near(r.data.options.find((o) => o.plan_id === 'golden-monthly').charge_now_usd, 50)
  })
  await t('live upgrade charges the discounted difference; termMonths kept, renewal = golden 6-month price', async () => {
    const before = await bal(OWNER)
    const r = await http.post('/hosting/hostup/change-plan', { plan_id: 'golden-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    near(before - await bal(OWNER), 42.5)
    assert.deepStrictEqual([r.data.result.renewal_price_usd, r.data.result.term_months], [510, 6])
    const a = await DB.collection('cpanelAccounts').findOne({ _id: 'hostup' })
    assert.deepStrictEqual([a.plan, a.renewalPriceUsd, a.termMonths], [GOLDEN, 100, 6])
    nearMs(a.expiryDate, NOW + 60 * DAY, 1000)
    const ev = evFor('hosting.plan_changed', 'hostup')
    assert.strictEqual(ev.length, 1); assert.deepStrictEqual([ev[0].data.renewal_price_usd, ev[0].data.term_months], [510, 6])
  })

  console.log('\n=== Scheduler auto-renew repeats the term ===')
  const sch = hostingScheduler.initScheduler({ bot: null, db: DB, whmService: whmMock })
  await sch.runCheck()
  await sleep(150)
  await t('3-month account auto-renews for 90 days at $202.50 (hosting.renewed carries term_months)', async () => {
    const a = await DB.collection('cpanelAccounts').findOne({ _id: 'hostexp' })
    nearMs(a.expiryDate, NOW + 90 * DAY)
    assert.strictEqual(a.suspended, false)
    const e = evFor('hosting.renewed', 'hostexp')
    assert.strictEqual(e.length, 1)
    assert.deepStrictEqual([e[0].data.charged_usd, e[0].data.term_months, e[0].data.via], [202.5, 3, 'auto_renew'])
  })
  await t('insufficient funds for a 12-month term → auto_renew_failed with the term price', async () => {
    const e = evFor('hosting.auto_renew_failed', 'hostpoor', 'b')
    assert.strictEqual(e.length, 1)
    assert.deepStrictEqual([e[0].data.price_usd, e[0].data.term_months, e[0].data.reason], [900, 12, 'insufficient_funds'])
    assert.strictEqual(await bal(POOR), 10)
  })
  await t('expiry alerts quote the term renewal price', async () => {
    const res = await alerts.ownedResources(DB, OWNER)
    const r = res.find((x) => x.product === 'hosting' && x.id === 'hostm1')
    assert.deepStrictEqual([r.payload.renewal_price_usd, r.payload.term_months, r.termDays], [202.5, 3, 90])
  })

  console.log('\n=== POST /domains/:domain/auto-renew ===')
  await DB.collection('domainsOf').insertMany([
    { domainName: 'opdom.com', chatId: OWNER, registrar: 'OpenProvider' },
    { domainName: 'crdom.com', chatId: OWNER, registrar: 'ConnectReseller', expiresAt: new Date(NOW + 3 * DAY) },
    { domainName: 'regdom.com', chatId: OWNER },
    { domainName: 'poor.com', chatId: POOR, registrar: 'OpenProvider' },
  ])
  await DB.collection('registeredDomains').insertOne({ _id: 'regdom.com', val: { registrar: 'OpenProvider' } })
  op.info['opdom.com'] = new Date(NOW + 30 * DAY).toISOString(); op.price['opdom.com'] = 30
  op.info['regdom.com'] = new Date(NOW + 200 * DAY).toISOString(); op.price['regdom.com'] = 35
  op.info['poor.com'] = new Date(NOW + 3 * DAY).toISOString(); op.price['poor.com'] = 30

  await t('enable on an OpenProvider domain pins expiry + price, next charge = expiry − 7d', async () => {
    const r = await http.post('/domains/opdom.com/auto-renew', { enabled: true })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.auto_renew, r.data.auto_renew_supported, r.data.renewal_price_usd, r.data.renewal_period_years, r.data.registrar], [true, true, 30, 1, 'OpenProvider'])
    nearMs(r.data.expires_at, op.info['opdom.com'], 1000)
    nearMs(r.data.next_charge_at, NOW + 23 * DAY, 1000)
    assert.strictEqual(r.data.sufficient_balance, true)
    const d = await DB.collection('domainsOf').findOne({ domainName: 'opdom.com' })
    assert.deepStrictEqual([d.autoRenew, d.autoRenewPriceUsd], [true, 30]); assert.ok(d.expiresAt instanceof Date)
  })
  await t('ConnectReseller domain → 501 auto_renew_not_supported; disabling always works', async () => {
    const r = await http.post('/domains/crdom.com/auto-renew', { enabled: true })
    assert.strictEqual(r.status, 501); assert.strictEqual(r.data.error, 'auto_renew_not_supported'); assert.strictEqual(r.data.registrar, 'ConnectReseller')
    assert.notStrictEqual((await DB.collection('domainsOf').findOne({ domainName: 'crdom.com' })).autoRenew, true)
    const off = await http.post('/domains/crdom.com/auto-renew', { enabled: false })
    assert.strictEqual(off.status, 200); assert.strictEqual(off.data.auto_renew, false); assert.strictEqual(off.data.auto_renew_supported, false)
  })
  await t('toggle without a body; registrar read from registeredDomains', async () => {
    const r = await http.post('/domains/regdom.com/auto-renew')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual([r.data.auto_renew, r.data.registrar, r.data.renewal_price_usd], [true, 'OpenProvider', 35])
    const r2 = await http.post('/domains/regdom.com/auto-renew')
    assert.strictEqual(r2.data.auto_renew, false)
  })
  await t('bad body → 400, not owned → 404, bad domain → 400', async () => {
    assert.strictEqual((await http.post('/domains/opdom.com/auto-renew', { enabled: 'yes' })).status, 400)
    assert.strictEqual((await http.post('/domains/poor.com/auto-renew', { enabled: true })).status, 404)
    assert.strictEqual((await http.post('/domains/not_a_domain/auto-renew', { enabled: true })).status, 400)
  })
  await t('GET /domains + /renewals expose the auto-renew state', async () => {
    const r = await http.get('/domains')
    const d = r.data.domains.find((x) => x.domain === 'opdom.com')
    assert.deepStrictEqual([d.auto_renew, d.auto_renew_supported, d.renewal_price_usd, d.auto_renew_last_error], [true, true, 30, null])
    assert.ok(d.next_charge_at && d.expires_at)
    const cr = r.data.domains.find((x) => x.domain === 'crdom.com')
    assert.deepStrictEqual([cr.auto_renew, cr.auto_renew_supported], [false, false])
    const rn = await http.get('/renewals?days=60')
    const it = rn.data.renewals.find((x) => x.product === 'domain' && x.domain === 'opdom.com')
    assert.deepStrictEqual([it.auto_renew, it.renewal_price_usd], [true, 30])
  })
  await t('activity log records auto_renew.enabled / disabled (actor api)', async () => {
    await sleep(100)
    const r = await http.get('/activity', { params: { resource: 'domain:opdom.com' } })
    assert.ok(r.data.activity.some((i) => i.action === 'auto_renew.enabled' && i.actor === 'api'), JSON.stringify(r.data.activity))
    const c = await http.get('/activity', { params: { resource: 'domain:crdom.com' } })
    assert.ok(c.data.activity.some((i) => i.action === 'auto_renew.disabled'))
    assert.ok(!c.data.activity.some((i) => i.action === 'auto_renew.enabled'), '501 not recorded')
  })

  console.log('\n=== Domain auto-renew sweep ===')
  const doc = (name) => DB.collection('domainsOf').findOne({ domainName: name })
  await t('outside the 7-day window → nothing charged', async () => {
    const before = await bal(OWNER)
    const r = await dar.processDomain(DB, await doc('opdom.com'), { now: NOW })
    assert.strictEqual(r, 'skipped'); assert.strictEqual(await bal(OWNER), before); assert.strictEqual(op.renewCalls.length, 0)
  })
  const T6 = NOW + 24 * DAY // 6 days before opdom.com expires
  await t('inside the window → wallet charged, registrar renews 1 year, domain.renewed fires', async () => {
    const before = await bal(OWNER)
    const prevExp = op.info['opdom.com']
    const out = await dar.runSweep(DB, { now: T6 })
    assert.strictEqual(out.renewed, 1, JSON.stringify(out))
    near(before - await bal(OWNER), 30)
    assert.deepStrictEqual(op.renewCalls, ['opdom.com'])
    const d = await doc('opdom.com')
    nearMs(d.expiresAt, new Date(prevExp).getTime() + 365 * DAY, DAY)
    assert.deepStrictEqual([d.autoRenewLastError, d.autoRenewNextAttemptAt, d.renewalCount], [null, null, 1])
    const e = evFor('domain.renewed', 'opdom.com')
    assert.strictEqual(e.length, 1)
    assert.deepStrictEqual([e[0].data.via, e[0].data.charged_usd, e[0].data.period_years, e[0].data.registrar], ['auto_renew', 30, 1, 'OpenProvider'])
    const ord = await DB.collection('resellerApiOrders').findOne({ product: 'domain', action: 'auto_renew', 'request.domain': 'opdom.com' })
    assert.ok(ord && ord.priceUsd === 30 && ord.status === 'provisioned')
    const act = await DB.collection('resellerActivity').findOne({ resourceId: 'opdom.com', action: 'auto_renew.charged', actor: 'system' })
    assert.ok(act)
  })
  await t('re-running the sweep never charges twice', async () => {
    const before = await bal(OWNER)
    const out = await dar.runSweep(DB, { now: T6 + HOUR })
    assert.strictEqual(out.renewed, 0); assert.strictEqual(await bal(OWNER), before); assert.strictEqual(op.renewCalls.length, 1)
  })
  await t('lifecycle alert sweep does not double-send domain.renewed', async () => {
    await alerts.runLifecycleSweep(DB, { now: T6 + 2 * HOUR })
    assert.strictEqual(evFor('domain.renewed', 'opdom.com').length, 1)
  })

  await t('insufficient funds → domain.auto_renew_failed, nothing charged, retry tomorrow', async () => {
    await DB.collection('domainsOf').updateOne({ domainName: 'poor.com' }, { $set: { autoRenew: true } })
    const r = await dar.processDomain(DB, await doc('poor.com'), { now: NOW })
    assert.strictEqual(r, 'failed')
    assert.strictEqual(await bal(POOR), 10)
    const e = evFor('domain.auto_renew_failed', 'poor.com', 'b')
    assert.strictEqual(e.length, 1)
    assert.deepStrictEqual([e[0].data.reason, e[0].data.price_usd, e[0].data.wallet_balance_usd], ['insufficient_funds', 30, 10])
    nearMs(e[0].data.next_attempt_at, NOW + DAY, 1000)
    const d = await doc('poor.com')
    assert.strictEqual(d.autoRenewLastError, 'insufficient_funds')
    nearMs(d.autoRenewNextAttemptAt, NOW + DAY, 1000)
  })
  await t('same day → no new attempt; next day → retried (one webhook per day)', async () => {
    assert.strictEqual(await dar.processDomain(DB, await doc('poor.com'), { now: NOW + 3 * HOUR }), 'skipped')
    assert.strictEqual(evFor('domain.auto_renew_failed', 'poor.com', 'b').length, 1)
    assert.strictEqual(await dar.processDomain(DB, await doc('poor.com'), { now: NOW + DAY + 60000 }), 'failed')
    assert.strictEqual(evFor('domain.auto_renew_failed', 'poor.com', 'b').length, 2)
  })
  await t('last day: next_attempt_at is null; view hides next_charge_at', async () => {
    assert.strictEqual(await dar.processDomain(DB, await doc('poor.com'), { now: NOW + 2 * DAY + 2 * 60000 }), 'failed')
    const e = evFor('domain.auto_renew_failed', 'poor.com', 'b')
    assert.strictEqual(e[e.length - 1].data.next_attempt_at, null)
    assert.strictEqual(dar.view(await doc('poor.com'), 'OpenProvider', NOW + 2 * DAY + 3 * 60000).next_charge_at, null)
  })
  await t('top-up + re-enable clears the retry gate → renewed on the next run', async () => {
    await DB.collection('walletOf').updateOne({ _id: POOR }, { $inc: { usdIn: 100 } })
    const r = await httpPoor.post('/domains/poor.com/auto-renew', { enabled: true })
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.auto_renew_last_error, null)
    assert.strictEqual(await dar.processDomain(DB, await doc('poor.com'), { now: NOW + 2 * DAY + 5 * 60000 }), 'renewed')
    assert.strictEqual(await bal(POOR), 80)
  })
  await t('registrar error → refunded, registrar_error webhook', async () => {
    await DB.collection('domainsOf').insertOne({ domainName: 'flaky.com', chatId: OWNER, registrar: 'OpenProvider', autoRenew: true, expiresAt: new Date(NOW + 2 * DAY) })
    op.info['flaky.com'] = new Date(NOW + 2 * DAY).toISOString(); op.price['flaky.com'] = 40; op.renewFail = true
    const before = await bal(OWNER)
    assert.strictEqual(await dar.processDomain(DB, await doc('flaky.com'), { now: NOW }), 'failed')
    op.renewFail = false
    assert.strictEqual(await bal(OWNER), before)
    const e = evFor('domain.auto_renew_failed', 'flaky.com')
    assert.deepStrictEqual([e[0].data.reason, e[0].data.refunded, e[0].data.detail], ['registrar_error', true, 'registrar down'])
  })
  await t('already renewed at the registrar → date synced, no charge', async () => {
    await DB.collection('domainsOf').insertOne({ domainName: 'synced.com', chatId: OWNER, registrar: 'OpenProvider', autoRenew: true, expiresAt: new Date(NOW + 5 * DAY) })
    op.info['synced.com'] = new Date(NOW + 370 * DAY).toISOString(); op.price['synced.com'] = 30
    const before = await bal(OWNER)
    assert.strictEqual(await dar.processDomain(DB, await doc('synced.com'), { now: NOW }), 'synced')
    assert.strictEqual(await bal(OWNER), before)
    nearMs((await doc('synced.com')).expiresAt, NOW + 370 * DAY, 1000)
  })
  await t('non-OpenProvider (forced in DB), expired and pricing-unavailable domains', async () => {
    await DB.collection('domainsOf').updateOne({ domainName: 'crdom.com' }, { $set: { autoRenew: true } })
    assert.strictEqual(await dar.processDomain(DB, await doc('crdom.com'), { now: NOW }), 'skipped')
    await DB.collection('domainsOf').insertOne({ domainName: 'gone.com', chatId: OWNER, registrar: 'OpenProvider', autoRenew: true, expiresAt: new Date(NOW - HOUR) })
    assert.strictEqual(await dar.processDomain(DB, await doc('gone.com'), { now: NOW }), 'skipped')
    await DB.collection('domainsOf').insertOne({ domainName: 'noprice.com', chatId: OWNER, registrar: 'OpenProvider', autoRenew: true, expiresAt: new Date(NOW + 2 * DAY) })
    op.info['noprice.com'] = new Date(NOW + 2 * DAY).toISOString()
    assert.strictEqual(await dar.processDomain(DB, await doc('noprice.com'), { now: NOW }), 'failed')
    assert.strictEqual((await doc('noprice.com')).autoRenewLastError, 'pricing_unavailable')
  })
  await t('two concurrent runs on the same domain charge once (per-domain lock)', async () => {
    await DB.collection('domainsOf').insertOne({ domainName: 'race.com', chatId: OWNER, registrar: 'OpenProvider', autoRenew: true, expiresAt: new Date(NOW + 3 * DAY) })
    op.info['race.com'] = new Date(NOW + 3 * DAY).toISOString(); op.price['race.com'] = 30
    const before = await bal(OWNER)
    const d = await doc('race.com')
    const rs = await Promise.all([dar.processDomain(DB, d, { now: NOW }), dar.processDomain(DB, d, { now: NOW })])
    assert.strictEqual(rs.filter((x) => x === 'renewed').length, 1, JSON.stringify(rs))
    near(before - await bal(OWNER), 30)
    assert.strictEqual(op.renewCalls.filter((x) => x === 'race.com').length, 1)
  })
  await t('domain.expiring alert carries the auto-renew price', async () => {
    const res = await alerts.ownedResources(DB, OWNER)
    const r = res.find((x) => x.product === 'domain' && x.id === 'race.com')
    assert.deepStrictEqual([r.payload.renewal_price_usd, r.payload.auto_renew], [30, true])
  })

  console.log('\n=== Safety + docs ===')
  await t('sweep is off on a dev pod; RESELLER_DOMAIN_AUTORENEW_ENABLED overrides', async () => {
    assert.strictEqual(dar.enabled(), false)
    assert.strictEqual(dar.start({ getDb: () => DB, log: () => {} }), null)
    process.env.RESELLER_DOMAIN_AUTORENEW_ENABLED = 'true'
    assert.strictEqual(dar.enabled(), true)
    process.env.RESELLER_DOMAIN_AUTORENEW_ENABLED = ''
  })
  await t('EVENTS + GET /account/webhook list domain.auto_renew_failed', async () => {
    assert.ok(webhooks.EVENTS.includes('domain.auto_renew_failed'))
    const r = await http.get('/account/webhook')
    assert.ok(r.data.events.includes('domain.auto_renew_failed'))
  })
  await t('API doc covers terms, months and domain auto-renew', async () => {
    const html = require('../apidoc-page').renderApiDocPage('https://x/api/reseller/v1')
    for (const s of ['/domains/:domain/auto-renew', 'domain.auto_renew_failed', 'term_discounts_pct', 'term_not_available', 'auto_renew_not_supported', 'invalid_months']) assert.ok(html.includes(s), s)
  })

  await DB.dropDatabase()
  await client.close()
  srv.close(); hs.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
