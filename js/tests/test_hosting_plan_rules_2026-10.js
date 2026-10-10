/* eslint-disable no-console */
// Hosting plan-change RULES (2026-10) + renewal guards + race protection — engine, reseller API, scheduler.
//   • monthly → weekly never allowed (hidden + 409 weekly_downgrade_not_allowed)
//   • weekly → monthly = monthly price − unused weekly credit, FRESH 30-day term (legacy stacked → days)
//   • Premium ↔ Golden unchanged: pro-rata, expiry never moves
//   • weekly renews 1 week at a time, only once ≤ 7 days left (API + lifecycle reads)
//   • atomic plan-change lock, renew compare-and-set, hosting.plan_changed webhook
//   • scheduler skips accounts mid-plan-change; VPS/RDP need ≥ 1 h left; VPS auto-renew query skips resizes
// Run: node js/tests/test_hosting_plan_rules_2026-10.js
// SAFE: WHM + anti-red stubbed, throw-away local DB, reseller API in LIVE mode against the stubs.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.RESELLER_WEBHOOK_RETRIES = '0'

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const whm = require('../whm-service')
const antiRed = require('../anti-red-service')
const hpc = require('../hosting-plan-change')
const pc = require('../do-plan-change')
const webhooks = require('../reseller-webhooks')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 5).join('\n     ')}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
const code = (fn) => { try { fn(); return 'ok' } catch (e) { return e.code } }

// ── Stubbed WHM / anti-red (optional delay to force overlapping requests) ──
const whmCalls = []
let whmDelay = 0
whm.getAccountInfo = async () => { if (whmDelay) await sleep(whmDelay); return { success: true } }
whm.changePackage = async (u, plan) => { whmCalls.push([u, plan]); return { success: true } }
whm.unsuspendAccount = async () => ({ success: true })
antiRed.deployFullProtection = async () => ({ success: true })

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_hosting_plan_rules_${Date.now()}`)
  const wallets = DB.collection('walletOf')
  const cp = DB.collection('cpanelAccounts')
  const OWNER = '777000902'
  const bal = async () => { const w = await wallets.findOne({ _id: OWNER }); return Math.round(((w.usdIn || 0) - (w.usdOut || 0)) * 100) / 100 }
  await wallets.insertOne({ _id: OWNER, usdIn: 2000, usdOut: 0 })
  const hp = require('../reseller-api').hostingPlans()
  const WEEKLY = 'Premium Anti-Red (1-Week)'
  const PREMIUM = 'Premium Anti-Red HostPanel (30 Days)'
  const GOLDEN = 'Golden Anti-Red HostPanel (1-Month)'
  const acct = (over = {}) => ({ _id: 'x', plan: PREMIUM, expiryDate: new Date(Date.now() + 15 * DAY), addonDomains: [], ...over })

  console.log('engine — allowed switches + math')
  await t('monthly accounts never see weekly; requesting it → 409 weekly_downgrade_not_allowed', () => {
    for (const plan of [PREMIUM, GOLDEN]) {
      const po = hpc.hostingPlanOptions(acct({ plan }), hp)
      assert.ok(!po.options.some((o) => o.plan_id === 'premium-weekly'), plan)
      assert.strictEqual(po.options.length, 1)
      let err = null
      try { hpc.hostingQuote(acct({ plan }), hp, 'premium-weekly') } catch (e) { err = e }
      assert.strictEqual(err.code, 'weekly_downgrade_not_allowed'); assert.strictEqual(err.status, 409)
    }
  })
  await t('weekly → Premium / Golden: monthly − unused weekly credit, fresh 30-day term (5 days and 14 days left)', () => {
    const now = new Date()
    const w5 = hpc.hostingPlanOptions(acct({ plan: WEEKLY, expiryDate: new Date(now.getTime() + 5 * DAY) }), hp, now)
    const p5 = w5.options.find((o) => o.plan_id === 'premium-monthly'); const g5 = w5.options.find((o) => o.plan_id === 'golden-monthly')
    assert.strictEqual(p5.unused_credit_usd, 21.43); assert.strictEqual(p5.charge_now_usd, 53.57)
    assert.strictEqual(g5.unused_credit_usd, 21.43); assert.strictEqual(g5.charge_now_usd, 78.57)
    for (const o of [p5, g5]) {
      assert.strictEqual(o.billing, 'new_term'); assert.strictEqual(o.expiry_changes, true); assert.strictEqual(o.new_price_from, 'now')
      assert.strictEqual(o.new_term_days, 30); assert.strictEqual(new Date(o.expires_at).getTime(), now.getTime() + 30 * DAY)
      assert.strictEqual(o.direction, 'upgrade'); assert.strictEqual(o.refund_usd, 0)
    }
    const w14 = hpc.hostingPlanOptions(acct({ plan: WEEKLY, expiryDate: new Date(now.getTime() + 14 * DAY) }), hp, now)
    assert.strictEqual(w14.options.find((o) => o.plan_id === 'premium-monthly').charge_now_usd, 15)
    assert.strictEqual(w14.options.find((o) => o.plan_id === 'golden-monthly').charge_now_usd, 40)
  })
  await t('weekly credit uses the account\'s price-locked weekly price (promo) when present', () => {
    const now = new Date()
    const po = hpc.hostingPlanOptions(acct({ plan: WEEKLY, expiryDate: new Date(now.getTime() + 5 * DAY), renewalPriceUsd: 15 }), hp, now)
    assert.strictEqual(po.current.renewal_price_usd, 15)
    assert.strictEqual(po.options.find((o) => o.plan_id === 'premium-monthly').charge_now_usd, 64.29) // 75 − 15 × 5/7
  })
  await t('legacy stacked weekly (20 days left): credit > monthly price → $0 + credit converted to days; never loses paid time', () => {
    const now = new Date()
    const po = hpc.hostingPlanOptions(acct({ plan: WEEKLY, expiryDate: new Date(now.getTime() + 20 * DAY) }), hp, now)
    const p = po.options.find((o) => o.plan_id === 'premium-monthly'); const g = po.options.find((o) => o.plan_id === 'golden-monthly')
    assert.strictEqual(p.unused_credit_usd, 85.71); assert.strictEqual(p.charge_now_usd, 0)
    assert.ok(near(p.new_term_days, 34.28), p.new_term_days) // 85.71 / (75/30)
    assert.strictEqual(g.charge_now_usd, 14.29); assert.strictEqual(g.new_term_days, 30)
  })
  await t('Premium ↔ Golden unchanged: pro-rata on ALL remaining days (incl. multi-month prepaid), expiry never moves', () => {
    const now = new Date()
    const exp = new Date(now.getTime() + 90 * DAY)
    const up = hpc.hostingQuote(acct({ expiryDate: exp }), hp, 'golden-monthly', now).option
    assert.strictEqual(up.charge_now_usd, 75); assert.strictEqual(up.billing, 'pro_rata') // (100−75) × 90/30
    assert.strictEqual(up.expires_at, exp.toISOString()); assert.strictEqual(up.expiry_changes, false); assert.strictEqual(up.unused_credit_usd, 0)
    const dn = hpc.hostingQuote(acct({ plan: GOLDEN, expiryDate: exp }), hp, 'premium-monthly', now).option
    assert.strictEqual(dn.charge_now_usd, 0); assert.strictEqual(dn.refund_usd, 0); assert.strictEqual(dn.expires_at, exp.toISOString())
    assert.strictEqual(code(() => hpc.hostingQuote(acct({ plan: GOLDEN, addonDomains: [1, 2, 3, 4, 5, 6] }), hp, 'premium-monthly')), 'too_many_addon_domains')
  })
  await t('weeklyRenewBlock: 1 period only, only once ≤ 7 days are left; monthly plans unaffected', () => {
    const now = new Date()
    assert.strictEqual(hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() + 6 * DAY) }, { durationDays: 7, now }), null)
    assert.strictEqual(hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() + 7 * DAY) }, { durationDays: 7, now }), null)
    assert.strictEqual(hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() - DAY) }, { durationDays: 7, now }), null) // expired → may renew
    const p2 = hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() + 3 * DAY) }, { durationDays: 7, periods: 2, now })
    assert.strictEqual(p2.error, 'weekly_single_period_only'); assert.strictEqual(p2.status, 400)
    const early = hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() + 10 * DAY) }, { durationDays: 7, now })
    assert.strictEqual(early.error, 'weekly_renew_too_early'); assert.strictEqual(early.status, 409)
    assert.strictEqual(early.renew_available_at, new Date(now.getTime() + 3 * DAY).toISOString())
    assert.strictEqual(hpc.weeklyRenewBlock({ expiryDate: new Date(now.getTime() + 40 * DAY) }, { durationDays: 30, periods: 3, now }), null)
  })
  await t('VPS/RDP plan change needs ≥ 1 hour left in the term (term_ending_soon) — checked before any DigitalOcean call', async () => {
    const rec = { _id: 'v1', chatId: OWNER, instanceId: 'do-999', provider: 'digitalocean', productId: 's-2vcpu-4gb', isRDP: false, status: 'RUNNING', end_time: new Date(Date.now() + 30 * 60000) }
    let err = null
    try { await pc.planOptions(rec) } catch (e) { err = e }
    assert.ok(err, 'expected an error'); assert.strictEqual(err.code, 'term_ending_soon'); assert.strictEqual(err.status, 409)
  })

  console.log('reseller API (live mode, stubbed WHM)')
  const hooks = []
  const hookApp = express(); hookApp.use(express.json()); hookApp.post('/hook', (req, res) => { hooks.push(req.body); res.sendStatus(200) })
  const hookSrv = hookApp.listen(0)
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  await DB.collection('resellerApiKeys').insertOne({ _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER, label: 'test', webhookUrl: `http://127.0.0.1:${hookSrv.address().port}/hook` })
  const { createResellerApi } = require('../reseller-api')
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const api = (method, url, data) => axios({ method, url: base + url, data, headers: { Authorization: `Bearer ${KEY}` }, validateStatus: () => true })
  const mk = (id, over = {}) => ({ _id: id, cpUser: id, chatId: OWNER, domain: `${id}.test`, plan: PREMIUM, expiryDate: new Date(Date.now() + 15 * DAY), addonDomains: [], ...over })

  await t('webhook catalog lists hosting.plan_changed (EVENTS + GET /account/webhook)', async () => {
    assert.ok(webhooks.EVENTS.includes('hosting.plan_changed'))
    const r = await api('get', '/account/webhook')
    assert.strictEqual(r.status, 200); assert.ok(r.data.events.includes('hosting.plan_changed'))
  })
  await cp.insertMany([
    mk('premacct'), mk('goldacct', { plan: GOLDEN }),
    mk('wk5', { plan: WEEKLY, expiryDate: new Date(Date.now() + 5 * DAY), renewalPriceUsd: 30 }),
    mk('wkfree', { plan: WEEKLY, expiryDate: new Date(Date.now() + 20 * DAY), renewalPriceUsd: 30 }),
    mk('racer'), mk('stale', { planChangeLock: { id: 'old', at: new Date(Date.now() - 11 * 60000) } }),
    mk('wk10', { plan: WEEKLY, expiryDate: new Date(Date.now() + 10 * DAY) }),
    mk('wk3', { plan: WEEKLY, expiryDate: new Date(Date.now() + 3 * DAY) }),
    mk('renewrace', { expiryDate: new Date(Date.now() + 5 * DAY) }),
  ])

  await t('GET plan-options: monthly → no weekly option; weekly → both monthly options as new_term with credit + new expiry; policy has the rules', async () => {
    const m = await api('get', '/hosting/premacct/plan-options')
    assert.strictEqual(m.status, 200, JSON.stringify(m.data))
    assert.deepStrictEqual(m.data.options.map((o) => o.plan_id), ['golden-monthly'])
    assert.ok(m.data.policy.weekly_to_monthly && m.data.policy.monthly_to_weekly)
    const w = await api('get', '/hosting/wk5/plan-options')
    assert.deepStrictEqual(w.data.options.map((o) => o.plan_id).sort(), ['golden-monthly', 'premium-monthly'])
    assert.ok(w.data.options.every((o) => o.billing === 'new_term' && o.expiry_changes === true && near(o.unused_credit_usd, 21.43, 0.05)))
  })
  await t('POST premium → weekly (and golden → weekly) → 409 weekly_downgrade_not_allowed; nothing charged, WHM untouched', async () => {
    const before = await bal(); const n = whmCalls.length
    for (const u of ['premacct', 'goldacct']) {
      const r = await api('post', `/hosting/${u}/change-plan`, { plan_id: 'premium-weekly' })
      assert.strictEqual(r.status, 409, JSON.stringify(r.data)); assert.strictEqual(r.data.error, 'weekly_downgrade_not_allowed')
      const d = await api('post', `/hosting/${u}/change-plan`, { plan_id: 'premium-weekly', dry_run: true })
      assert.strictEqual(d.status, 409)
    }
    assert.strictEqual(await bal(), before); assert.strictEqual(whmCalls.length, n)
  })
  await t('dry_run weekly → golden returns the quote (charge, credit, new expiry) with no charge', async () => {
    const before = await bal()
    const d = await api('post', '/hosting/wk5/upgrade', { plan_id: 'golden-monthly', dry_run: true })
    assert.strictEqual(d.status, 200, JSON.stringify(d.data)); assert.strictEqual(d.data.dry_run, true)
    assert.ok(near(d.data.quote.charge_now_usd, 78.57, 0.05)); assert.strictEqual(d.data.quote.billing, 'new_term')
    assert.strictEqual(await bal(), before)
  })
  await t('LIVE weekly → golden: charged (100 − credit), fresh 30-day expiry, plan + renewal price set, reminders reset, history + hosting.plan_changed webhook', async () => {
    const before = await bal()
    await cp.updateOne({ _id: 'wk5' }, { $set: { expiryNotified: true } })
    const t0 = Date.now()
    const r = await api('post', '/hosting/wk5/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.mode, 'live')
    assert.ok(near(r.data.charged_usd, 78.57, 0.05), r.data.charged_usd)
    assert.ok(near(before - await bal(), r.data.charged_usd, 0.001))
    const res = r.data.result
    assert.strictEqual(res.billing, 'new_term'); assert.strictEqual(res.expiry_changed, true); assert.strictEqual(res.renewal_days, 30)
    const a = await cp.findOne({ _id: 'wk5' })
    assert.strictEqual(a.plan, GOLDEN); assert.strictEqual(a.renewalPriceUsd, 100); assert.strictEqual(a.expiryNotified, false)
    assert.ok(Math.abs(a.expiryDate.getTime() - (t0 + 30 * DAY)) < 60000, a.expiryDate)
    assert.ok(!a.planChangeLock, 'lock released')
    const h = a.planChangeHistory[a.planChangeHistory.length - 1]
    assert.strictEqual(h.billing, 'new_term'); assert.ok(near(h.unused_credit_usd, 21.43, 0.05)); assert.ok(h.previous_expires_at && h.expires_at)
    for (let i = 0; i < 60 && !hooks.some((x) => x.event === 'hosting.plan_changed' && x.data && x.data.username === 'wk5'); i++) await sleep(30)
    const ev = hooks.find((x) => x.event === 'hosting.plan_changed' && x.data.username === 'wk5')
    assert.ok(ev, JSON.stringify(hooks))
    assert.strictEqual(ev.data.from_plan, 'premium-weekly'); assert.strictEqual(ev.data.to_plan, 'golden-monthly'); assert.strictEqual(ev.data.billing, 'new_term')
    assert.ok(near(ev.data.charged_usd, r.data.charged_usd, 0.001)); assert.strictEqual(ev.data.expires_at, res.expires_at)
  })
  await t('LIVE legacy stacked weekly → premium: $0 charged, credit converted into ~34.3 days, webhook still sent', async () => {
    const before = await bal()
    const r = await api('post', '/hosting/wkfree/upgrade', { plan_id: 'premium-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.charged_usd, 0)
    assert.strictEqual(await bal(), before)
    const a = await cp.findOne({ _id: 'wkfree' })
    const days = (a.expiryDate.getTime() - Date.now()) / DAY
    assert.ok(days > 34.2 && days < 34.4, days); assert.strictEqual(a.plan, 'Premium Anti-Red HostPanel (1-Month)')
    for (let i = 0; i < 60 && !hooks.some((x) => x.event === 'hosting.plan_changed' && x.data.username === 'wkfree'); i++) await sleep(30)
    assert.ok(hooks.some((x) => x.event === 'hosting.plan_changed' && x.data.username === 'wkfree'))
  })
  await t('LIVE premium → golden: pro-rata charge, expiry unchanged; golden → premium free', async () => {
    const before = await bal()
    const exp = (await cp.findOne({ _id: 'premacct' })).expiryDate
    const r = await api('post', '/hosting/premacct/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.ok(near(r.data.charged_usd, 12.5, 0.05))
    assert.ok(near(before - await bal(), r.data.charged_usd, 0.001))
    const a = await cp.findOne({ _id: 'premacct' })
    assert.strictEqual(a.expiryDate.getTime(), exp.getTime()); assert.strictEqual(r.data.result.expiry_changed, false)
    const mid = await bal()
    const dn = await api('post', '/hosting/goldacct/change-plan', { plan_id: 'premium-monthly' })
    assert.strictEqual(dn.status, 200, JSON.stringify(dn.data)); assert.strictEqual(dn.data.charged_usd, 0); assert.strictEqual(await bal(), mid)
  })
  await t('two simultaneous plan-change calls → exactly one applies (charged once), the other gets 409 plan_change_in_progress', async () => {
    const before = await bal()
    whmDelay = 300
    const [a, b] = await Promise.all([
      api('post', '/hosting/racer/upgrade', { plan_id: 'golden-monthly' }),
      api('post', '/hosting/racer/upgrade', { plan_id: 'golden-monthly' }),
    ])
    whmDelay = 0
    const statuses = [a.status, b.status].sort()
    assert.deepStrictEqual(statuses, [200, 409], JSON.stringify([a.data, b.data]))
    const lost = a.status === 409 ? a : b
    assert.strictEqual(lost.data.error, 'plan_change_in_progress')
    const won = a.status === 200 ? a : b
    assert.ok(near(before - await bal(), won.data.charged_usd, 0.001), 'charged exactly once')
    assert.ok(!(await cp.findOne({ _id: 'racer' })).planChangeLock, 'lock released')
    const again = await api('post', '/hosting/racer/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(again.status, 400); assert.strictEqual(again.data.error, 'same_plan')
  })
  await t('a stale lock (> 10 min, crashed request) is taken over', async () => {
    const r = await api('post', '/hosting/stale/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.ok(!(await cp.findOne({ _id: 'stale' })).planChangeLock)
  })

  console.log('renewals — weekly guard + compare-and-set')
  await t('weekly with 10 days left: renew → 409 weekly_renew_too_early (+renew_available_at), dry_run too; nothing charged', async () => {
    const before = await bal()
    const r = await api('post', '/hosting/wk10/renew', {})
    assert.strictEqual(r.status, 409, JSON.stringify(r.data)); assert.strictEqual(r.data.error, 'weekly_renew_too_early'); assert.ok(r.data.renew_available_at)
    const d = await api('post', '/hosting/wk10/renew', { dry_run: true })
    assert.strictEqual(d.status, 409); assert.strictEqual(d.data.renew_blocked_reason, 'weekly_renew_too_early')
    assert.strictEqual(await bal(), before)
  })
  await t('weekly with 3 days left: periods:2 → 400 weekly_single_period_only; periods:1 → +7 days; renewing again right away → 409 too early', async () => {
    const p2 = await api('post', '/hosting/wk3/renew', { periods: 2 })
    assert.strictEqual(p2.status, 400, JSON.stringify(p2.data)); assert.strictEqual(p2.data.error, 'weekly_single_period_only')
    const exp0 = (await cp.findOne({ _id: 'wk3' })).expiryDate
    const ok = await api('post', '/hosting/wk3/renew', { periods: 1 })
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data))
    const exp1 = (await cp.findOne({ _id: 'wk3' })).expiryDate
    assert.strictEqual(exp1.getTime() - exp0.getTime(), 7 * DAY)
    const again = await api('post', '/hosting/wk3/renew', {})
    assert.strictEqual(again.status, 409); assert.strictEqual(again.data.error, 'weekly_renew_too_early')
  })
  await t('reads expose it: GET /hosting/:user and GET /renewals → renewable:false, weekly_renew_too_early, renew_available_at', async () => {
    const g = await api('get', '/hosting/wk10')
    assert.strictEqual(g.status, 200, JSON.stringify(g.data))
    assert.strictEqual(g.data.renewable, false); assert.strictEqual(g.data.renew_blocked_reason, 'weekly_renew_too_early'); assert.ok(g.data.renew_available_at)
    const rn = await api('get', '/renewals')
    const it = rn.data.renewals.find((x) => x.id === 'wk10')
    assert.ok(it, JSON.stringify(rn.data).slice(0, 400)); assert.strictEqual(it.renewable, false); assert.strictEqual(it.renew_blocked_reason, 'weekly_renew_too_early')
    assert.ok(it.renew_available_at)
    const m = rn.data.renewals.find((x) => x.id === 'premacct')
    assert.strictEqual(m.renewable, true); assert.strictEqual(m.renew_available_at, null)
  })
  await t('monthly plans can still prepay several periods (periods:3 → +90 days)', async () => {
    const exp0 = (await cp.findOne({ _id: 'goldacct' })).expiryDate
    const r = await api('post', '/hosting/goldacct/renew', { periods: 3 })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual((await cp.findOne({ _id: 'goldacct' })).expiryDate.getTime() - exp0.getTime(), 90 * DAY)
  })
  await t('two simultaneous renew calls → extended exactly once and the loser is refunded (never "charged twice, extended once")', async () => {
    const before = await bal()
    const exp0 = (await cp.findOne({ _id: 'renewrace' })).expiryDate
    whmDelay = 300
    const [a, b] = await Promise.all([api('post', '/hosting/renewrace/renew', {}), api('post', '/hosting/renewrace/renew', {})])
    whmDelay = 0
    const ok = [a, b].filter((x) => x.status === 200); const lost = [a, b].filter((x) => x.status !== 200)
    assert.strictEqual(ok.length, 1, JSON.stringify([a.data, b.data])); assert.strictEqual(lost[0].data.refunded, true)
    assert.strictEqual((await cp.findOne({ _id: 'renewrace' })).expiryDate.getTime() - exp0.getTime(), 30 * DAY)
    assert.ok(near(before - await bal(), ok[0].data.charged_usd, 0.001), 'net charge = one renewal')
  })

  console.log('schedulers')
  await t('hosting auto-renew skips an expired account while a plan change holds the lock, then renews it once released', async () => {
    const { initScheduler } = require('../hosting-scheduler')
    const sched = initScheduler({ bot: { sendMessage: async () => ({}) }, db: DB, whmService: whm })
    await cp.insertOne(mk('expiring', { expiryDate: new Date(Date.now() - 60000), autoRenew: true, renewalPriceUsd: 75, planChangeLock: { id: 'live', at: new Date() } }))
    const before = await bal()
    await sched.runCheck()
    let a = await cp.findOne({ _id: 'expiring' })
    assert.ok(a.expiryDate.getTime() < Date.now(), 'not renewed while locked'); assert.strictEqual(await bal(), before)
    await cp.updateOne({ _id: 'expiring' }, { $unset: { planChangeLock: '' } })
    await sched.runCheck()
    a = await cp.findOne({ _id: 'expiring' })
    assert.ok(a.expiryDate.getTime() > Date.now() + 29 * DAY, 'renewed after unlock'); assert.ok(near(before - await bal(), 75, 0.001))
    sched.stop()
  })
  await t('VPS/RDP auto-renew query skips servers mid-resize (planChange running/reconciling) but keeps everything else', async () => {
    const vp = DB.collection('vpsPlansOf_q')
    const end = new Date(Date.now() + 12 * 3600000)
    await vp.insertMany([
      { _id: 'none', end_time: end, status: 'RUNNING' },
      { _id: 'done', end_time: end, status: 'RUNNING', planChange: { status: 'completed' } },
      { _id: 'failed', end_time: end, status: 'RUNNING', planChange: { status: 'failed' } },
      { _id: 'running', end_time: end, status: 'RUNNING', planChange: { status: 'running' } },
      { _id: 'reconciling', end_time: end, status: 'RUNNING', planChange: { status: 'reconciling' } },
    ])
    const now = new Date(); const oneDayFromNow = new Date(now.getTime() + DAY)
    // Same filter as the VPS scheduler's Phase-1 auto-renew query (_index.js).
    const due = await vp.find({ end_time: { $lte: oneDayFromNow, $gt: now }, status: { $in: ['RUNNING', 'running'] }, _autoRenewAttempted: { $ne: true }, 'planChange.status': { $nin: ['running', 'reconciling'] } }).toArray()
    assert.deepStrictEqual(due.map((d) => d._id).sort(), ['done', 'failed', 'none'])
  })

  server.close(); hookSrv.close()
  await DB.dropDatabase(); await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
