/* eslint-disable no-console */
// Plan-change HISTORY (hosting + VPS + RDP) + hosting renewal-price repair — engine, reseller API, repair module.
//   • VPS/RDP engine records completed AND failed (refunded) changes in planChangeHistory
//   • hosting API changes recorded with id/status/renewal price; legacy upgradedAt/downgradedAt → legacy:true
//   • GET /hosting/:user/plan-changes, /vps/:id/plan-changes, /rdp/:id/plan-changes, GET /plan-changes
//     (filters: product, since, until, status, via; limit + cursor pagination; ownership; 400s)
//   • hosting-renewal-price-repair: preview + compare-and-set apply, idempotent, never touches promo/API accounts
// Run: node js/tests/test_plan_change_history_2026-10.js
// SAFE: fake DigitalOcean API + stubbed WHM/anti-red, throw-away local DB, in-process API in LIVE mode.
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
const d = require('../digitalocean-service')
const rdp = require('../digitalocean-rdp-service')
const whm = require('../whm-service')
const antiRed = require('../anti-red-service')
const pc = require('../do-plan-change')
const hist = require('../plan-change-history')
const repair = require('../hosting-renewal-price-repair')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 5).join('\n     ')}`) }
}
const DAY = 86400000
const WEEKLY = 'Premium Anti-Red (1-Week)'
const PREMIUM = 'Premium Anti-Red HostPanel (30 Days)'
const GOLDEN = 'Golden Anti-Red HostPanel (30 Days)'

// ── Fake DigitalOcean API (same shape as test_do_plan_change_2026-10.js) ──
const fake = { droplets: new Map(), actions: new Map(), failResize: false, n: 1 }
function addDroplet(id, size, disk, region = 'fra1') { fake.droplets.set(String(id), { id: Number(id), size_slug: size, disk, status: 'active', region: { slug: region } }) }
const sizeDisk = (slug) => { const p = d.getProduct(slug); return p ? p.diskMb / 1024 : 0 }
d.apiRequest = async (method, p, data) => {
  let m
  if (method === 'GET' && (m = p.match(/^\/droplets\/(\d+)$/))) { const dr = fake.droplets.get(m[1]); return { droplet: { ...dr, region: { ...dr.region } } } }
  if (method === 'GET' && (m = p.match(/^\/actions\/(\d+)$/))) return { action: { ...fake.actions.get(m[1]) } }
  if (method === 'POST' && (m = p.match(/^\/droplets\/(\d+)\/actions$/))) {
    const dr = fake.droplets.get(m[1]); const id = String(fake.n++)
    if (data.type === 'shutdown' || data.type === 'power_off') dr.status = 'off'
    else if (data.type === 'power_on') dr.status = 'active'
    else if (data.type === 'resize') {
      if (fake.failResize) { fake.actions.set(id, { id, status: 'errored' }); return { action: { id: Number(id) } } }
      dr.size_slug = data.size; if (data.disk) dr.disk = sizeDisk(data.size)
    }
    fake.actions.set(id, { id, status: 'completed' })
    return { action: { id: Number(id), status: 'in-progress' } }
  }
  throw new Error(`unmocked DO ${method} ${p}`)
}
d.getInstance = async () => null
rdp.getInstance = async () => null
pc._timing.poll = 5
const ALL = ['fra1', 'nyc3', 'nyc1', 'sfo3', 'lon1', 'sgp1', 'syd1', 'blr1', 'ams3']
d._applySizes([...d.PRODUCT_CATALOG, ...d.PRODUCT_CATALOG_NVME].map((p) => ({ slug: p.productId, available: true, price_monthly: p.basePriceUsd, regions: ALL })))
whm.getAccountInfo = async () => ({ success: true })
whm.changePackage = async () => ({ success: true })
antiRed.deployFullProtection = async () => ({ success: true })

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_plan_change_history_${Date.now()}`)
  rdp.init(DB)
  const plans = DB.collection('vpsPlansOf')
  const wallets = DB.collection('walletOf')
  const cp = DB.collection('cpanelAccounts')
  const rdpServers = DB.collection('doRdpServers')
  const OWNER = '777000903'
  const OTHER = '777000904'
  await wallets.insertMany([{ _id: OWNER, usdIn: 2000, usdOut: 0 }, { _id: OTHER, usdIn: 100, usdOut: 0 }])
  const vpsRec = (over = {}) => ({ _id: crypto.randomUUID(), chatId: OWNER, provider: 'digitalocean', productId: 's-2vcpu-4gb', planPrice: 72, isRDP: false, status: 'RUNNING', end_time: new Date(Date.now() + 15 * DAY), region: 'EU', ...over })

  console.log('engine — completed + failed changes are recorded')
  await t('VPS completed resize → history entry status completed with names, disk, renewal price, via', async () => {
    addDroplet(501, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-501' }); await plans.insertOne(rec)
    const r = await (await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb', via: 'api' })).done
    assert.strictEqual(r.success, true, r.error)
    const h = (await plans.findOne({ _id: rec._id })).planChangeHistory
    assert.strictEqual(h.length, 1)
    const e = h[0]
    assert.strictEqual(e.status, 'completed'); assert.strictEqual(e.from, 's-2vcpu-4gb'); assert.strictEqual(e.to, 's-4vcpu-8gb')
    assert.ok(e.from_name && e.to_name); assert.strictEqual(e.renewal_price_usd, 144); assert.strictEqual(e.via, 'api')
    assert.strictEqual(e.from_disk_gb, 80); assert.ok(e.started_at); assert.ok(e.charged_usd > 0)
  })
  await t('VPS failed resize → refunded AND recorded in history (status failed, reason, refund_usd)', async () => {
    addDroplet(502, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-502' }); await plans.insertOne(rec)
    fake.failResize = true
    const s = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb', via: 'bot' })
    const r = await s.done
    fake.failResize = false
    assert.strictEqual(r.success, false); assert.strictEqual(r.refunded, true)
    const doc = await plans.findOne({ _id: rec._id })
    assert.strictEqual(doc.planChangeHistory.length, 1)
    const e = doc.planChangeHistory[0]
    assert.strictEqual(e.status, 'failed'); assert.strictEqual(e.refunded, true); assert.strictEqual(e.refund_usd, s.change.charged_usd)
    assert.ok(e.reason); assert.strictEqual(e.via, 'bot'); assert.strictEqual(e.id, doc.planChange.id)
    // de-dup: the same failed attempt in planChange + history is listed once
    const entries = hist.serverEntries(doc)
    assert.strictEqual(entries.length, 1); assert.strictEqual(entries[0].status, 'failed'); assert.strictEqual(entries[0].legacy, false)
  })
  await t('RDP completed change recorded on the RDP record (product rdp)', async () => {
    const sid = crypto.randomUUID()
    await rdpServers.insertOne({ server_id: sid, do_droplet_id: 503, tier_slug: 'standard', region: 'ams3', duration_months: 3, status: 'active', product_id: 'standard-3m' })
    addDroplet(503, 's-2vcpu-4gb-amd', 80, 'ams3')
    const rec = { _id: crypto.randomUUID(), chatId: OWNER, vpsId: `rdp-${sid}`, provider: 'digitalocean-rdp', productId: 'standard-3m', planPrice: 142.8, isRDP: true, status: 'RUNNING', end_time: new Date(Date.now() + 60 * DAY), source: 'reseller_api' }
    await plans.insertOne(rec)
    const r = await (await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 'pro', via: 'api' })).done
    assert.strictEqual(r.success, true, r.error)
    const entries = hist.serverEntries(await plans.findOne({ _id: rec._id }))
    assert.strictEqual(entries.length, 1); assert.strictEqual(entries[0].product, 'rdp')
    assert.strictEqual(entries[0].from_plan, 'standard'); assert.strictEqual(entries[0].to_plan, 'pro'); assert.strictEqual(entries[0].renewal_price_usd, 285.6)
  })

  console.log('builder — normalisation, legacy entries, running changes')
  await t('hosting: API/bot history entries normalised (plan ids from names, via, billing, expiries)', () => {
    const at = new Date('2026-10-05T10:00:00Z')
    const e = hist.hostingEntries({ _id: 'h1', domain: 'h1.test', plan: GOLDEN, planChangeHistory: [
      { id: 'x1', at, status: 'completed', from: WEEKLY, to: GOLDEN, direction: 'upgrade', billing: 'new_term', charged_usd: 50, loyalty_credit_usd: 50, previous_expires_at: at, expires_at: new Date(at.getTime() + 30 * DAY), renewal_price_usd: 100, via: 'bot' },
    ] })
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].from_plan, 'premium-weekly'); assert.strictEqual(e[0].to_plan, 'golden-monthly')
    assert.strictEqual(e[0].via, 'bot'); assert.strictEqual(e[0].billing, 'new_term'); assert.strictEqual(e[0].loyalty_credit_usd, 50)
    assert.strictEqual(e[0].expires_at, new Date(at.getTime() + 30 * DAY).toISOString()); assert.strictEqual(e[0].legacy, false)
  })
  await t('hosting legacy: old bot upgrade (only upgradedAt/upgradedFrom/upgradeChargedAmount) → legacy:true, via bot', () => {
    const e = hist.hostingEntries({ _id: 'h2', plan: GOLDEN, upgradedAt: new Date('2026-09-01T00:00:00Z'), upgradedFrom: WEEKLY, upgradeChargedAmount: 50, upgradeCreditApplied: 50 })
    assert.strictEqual(e.length, 1)
    assert.strictEqual(e[0].legacy, true); assert.strictEqual(e[0].via, 'bot'); assert.strictEqual(e[0].charged_usd, 50)
    assert.strictEqual(e[0].from_plan, 'premium-weekly'); assert.strictEqual(e[0].to_plan, 'golden-monthly'); assert.strictEqual(e[0].expires_at, null)
  })
  await t('hosting legacy: not duplicated when a history entry exists for the same moment; "to" = next change\'s "from"', () => {
    const at = new Date('2026-09-10T00:00:00Z')
    const dup = hist.hostingEntries({ _id: 'h3', plan: GOLDEN, upgradedAt: at, upgradedFrom: PREMIUM, planChangeHistory: [{ at, from: PREMIUM, to: GOLDEN, direction: 'upgrade', billing: 'pro_rata', charged_usd: 10, via: 'api' }] })
    assert.strictEqual(dup.length, 1); assert.strictEqual(dup[0].legacy, false)
    const chain = hist.hostingEntries({ _id: 'h4', plan: PREMIUM, downgradedAt: new Date('2026-08-01T00:00:00Z'), downgradedFrom: GOLDEN,
      planChangeHistory: [{ at: new Date('2026-09-01T00:00:00Z'), from: 'Golden Anti-Red HostPanel (1-Month)', to: PREMIUM, direction: 'downgrade', billing: 'pro_rata', charged_usd: 0, via: 'api' }] })
    const leg = chain.find((x) => x.legacy)
    assert.ok(leg); assert.strictEqual(leg.direction, 'downgrade'); assert.strictEqual(leg.via, null)
    assert.strictEqual(leg.to_plan_name, 'Golden Anti-Red HostPanel (1-Month)')
  })
  await t('VPS: running change listed as status running; pre-history failed attempt → legacy:true', () => {
    const running = hist.serverEntries({ _id: 'v1', vpsId: 'do-9', planChange: { id: 'r1', status: 'running', started_at: new Date(), direction: 'upgrade', from: { plan_id: 'a', name: 'A' }, to: { plan_id: 'b', name: 'B', renewal_price_usd: 9 }, charged_usd: 3, via: 'api' } })
    assert.strictEqual(running.length, 1); assert.strictEqual(running[0].status, 'running'); assert.strictEqual(running[0].legacy, false); assert.strictEqual(running[0].reason, null)
    const old = hist.serverEntries({ _id: 'v2', vpsId: 'do-8', isRDP: true, planChange: { id: 'f1', status: 'failed', error: 'Resize errored.', refunded: true, refund_usd: 4, charged_usd: 4, started_at: new Date(), finished_at: new Date(), direction: 'upgrade', from: { plan_id: 'standard' }, to: { plan_id: 'pro' }, via: 'bot' } })
    assert.strictEqual(old[0].product, 'rdp'); assert.strictEqual(old[0].status, 'failed'); assert.strictEqual(old[0].legacy, true)
    assert.strictEqual(old[0].reason, 'Resize errored.'); assert.strictEqual(old[0].refund_usd, 4)
  })
  await t('filters validated: bad product/date/status/via/limit/cursor → HistoryQueryError 400', () => {
    for (const [q, codeWanted] of [[{ product: 'dns' }, 'invalid_product'], [{ since: 'yesterday-ish' }, 'invalid_date'], [{ since: '2026-10-05', until: '2026-10-01' }, 'invalid_date'],
      [{ status: 'done' }, 'invalid_status'], [{ via: 'web' }, 'invalid_via'], [{ limit: '0' }, 'invalid_limit'], [{ limit: 'abc' }, 'invalid_limit'], [{ cursor: 'nope' }, 'invalid_cursor']]) {
      let err = null
      try { hist.parseFilters(q) } catch (e) { err = e }
      assert.ok(err, JSON.stringify(q)); assert.strictEqual(err.code, codeWanted); assert.strictEqual(err.status, 400)
    }
    assert.strictEqual(hist.parseFilters({ limit: '500' }).limit, 200)
    assert.deepStrictEqual(hist.parseFilters({ product: 'vps,rdp' }).products, ['vps', 'rdp'])
  })
  await t('pagination: newest first, cursor pages cover every entry exactly once (incl. identical timestamps)', () => {
    const same = new Date('2026-10-01T00:00:00Z')
    const entries = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, product: 'vps', at: (i < 3 ? same : new Date(same.getTime() + i * 1000)).toISOString(), status: 'completed', via: 'api' }))
    const seen = []
    let cursor = null
    for (let i = 0; i < 10; i++) {
      const pg = hist.page(entries, hist.parseFilters({ limit: '2', ...(cursor ? { cursor } : {}) }))
      seen.push(...pg.items.map((x) => x.id))
      if (!pg.has_more) { assert.strictEqual(pg.next_cursor, null); break }
      cursor = pg.next_cursor
    }
    assert.strictEqual(seen.length, 7); assert.strictEqual(new Set(seen).size, 7)
    assert.deepStrictEqual(seen.slice(0, 4), ['e6', 'e5', 'e4', 'e3'])
  })

  console.log('reseller API — endpoints')
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const KEY2 = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  await DB.collection('resellerApiKeys').insertMany([
    { _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER, label: 'test' },
    { _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY2).digest('hex'), enabled: true, ownerChatId: OTHER, label: 'other' },
  ])
  const { createResellerApi } = require('../reseller-api')
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const api = (method, url, data, key = KEY) => axios({ method, url: base + url, data, headers: { Authorization: `Bearer ${key}` }, validateStatus: () => true })
  await cp.insertMany([
    { _id: 'histprem', cpUser: 'histprem', chatId: OWNER, domain: 'histprem.test', plan: PREMIUM, expiryDate: new Date(Date.now() + 15 * DAY), addonDomains: [] },
    { _id: 'histlegacy', cpUser: 'histlegacy', chatId: OWNER, domain: 'histlegacy.test', plan: GOLDEN, expiryDate: new Date(Date.now() + 20 * DAY), upgradedAt: new Date('2026-09-01T00:00:00Z'), upgradedFrom: WEEKLY, upgradeChargedAmount: 50, upgradeCreditApplied: 50, renewalPriceUsd: 30 },
    { _id: 'otherhost', cpUser: 'otherhost', chatId: OTHER, domain: 'other.test', plan: GOLDEN, expiryDate: new Date(Date.now() + 9 * DAY), upgradedAt: new Date(), upgradedFrom: PREMIUM },
  ])

  await t('hosting change via API → GET /hosting/:user/plan-changes lists it (via api, pro_rata, renewal price, id)', async () => {
    const r = await api('post', '/hosting/histprem/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    const g = await api('get', '/hosting/histprem/plan-changes')
    assert.strictEqual(g.status, 200, JSON.stringify(g.data))
    assert.strictEqual(g.data.product, 'hosting'); assert.strictEqual(g.data.username, 'histprem'); assert.strictEqual(g.data.count, 1)
    const e = g.data.plan_changes[0]
    assert.ok(e.id && !e.id.startsWith('hpc_')); assert.strictEqual(e.status, 'completed'); assert.strictEqual(e.via, 'api')
    assert.strictEqual(e.from_plan, 'premium-monthly'); assert.strictEqual(e.to_plan, 'golden-monthly'); assert.strictEqual(e.billing, 'pro_rata')
    assert.strictEqual(e.renewal_price_usd, 100); assert.strictEqual(e.charged_usd, r.data.charged_usd); assert.strictEqual(e.legacy, false)
  })
  await t('legacy hosting account → one legacy:true entry; another owner\'s account → 404', async () => {
    const g = await api('get', '/hosting/histlegacy/plan-changes')
    assert.strictEqual(g.status, 200); assert.strictEqual(g.data.count, 1); assert.strictEqual(g.data.plan_changes[0].legacy, true)
    const x = await api('get', '/hosting/otherhost/plan-changes')
    assert.strictEqual(x.status, 404)
  })
  await t('GET /vps/:id/plan-changes and /rdp/:id/plan-changes (completed + failed), wrong product → 404', async () => {
    const v = await api('get', '/vps/do-502/plan-changes')
    assert.strictEqual(v.status, 200, JSON.stringify(v.data)); assert.strictEqual(v.data.product, 'vps'); assert.strictEqual(v.data.plan_changes[0].status, 'failed')
    const v2 = await api('get', '/vps/do-501/plan-changes?status=completed')
    assert.strictEqual(v2.data.count, 1); assert.strictEqual(v2.data.plan_changes[0].status, 'completed')
    const rdpId = (await plans.findOne({ isRDP: true, chatId: OWNER })).vpsId
    const rr = await api('get', `/rdp/${rdpId}/plan-changes`)
    assert.strictEqual(rr.status, 200); assert.strictEqual(rr.data.product, 'rdp'); assert.strictEqual(rr.data.plan_changes[0].to_plan, 'pro')
    assert.strictEqual((await api('get', `/vps/${rdpId}/plan-changes`)).status, 404)
  })
  await t('GET /plan-changes: account-wide, newest first, owner-scoped, filters product/status/via/since/until', async () => {
    const all = await api('get', '/plan-changes')
    assert.strictEqual(all.status, 200, JSON.stringify(all.data))
    const ids = all.data.plan_changes.map((e) => `${e.product}:${e.resource_id}:${e.status}`)
    assert.ok(all.data.total >= 5, all.data.total)
    assert.ok(!all.data.plan_changes.some((e) => e.resource_id === 'otherhost'), 'other owner hidden')
    const times = all.data.plan_changes.map((e) => new Date(e.at).getTime())
    assert.deepStrictEqual(times, times.slice().sort((a, b) => b - a), ids.join(' | '))
    const host = await api('get', '/plan-changes?product=hosting')
    assert.ok(host.data.plan_changes.length && host.data.plan_changes.every((e) => e.product === 'hosting'))
    const vr = await api('get', '/plan-changes?product=vps,rdp')
    assert.ok(vr.data.plan_changes.every((e) => e.product !== 'hosting'))
    assert.ok(vr.data.plan_changes.some((e) => e.product === 'rdp') && vr.data.plan_changes.some((e) => e.product === 'vps'))
    const failedOnly = await api('get', '/plan-changes?status=failed')
    assert.ok(failedOnly.data.plan_changes.length >= 1 && failedOnly.data.plan_changes.every((e) => e.status === 'failed'))
    const bot = await api('get', '/plan-changes?via=bot')
    assert.ok(bot.data.plan_changes.every((e) => e.via === 'bot'))
    assert.ok(bot.data.plan_changes.some((e) => e.legacy === true && e.resource_id === 'histlegacy'))
    const since = await api('get', '/plan-changes?since=2026-10-01')
    assert.ok(!since.data.plan_changes.some((e) => e.resource_id === 'histlegacy'), 'Sept legacy excluded by since')
    const until = await api('get', '/plan-changes?until=2026-09-15')
    assert.deepStrictEqual(until.data.plan_changes.map((e) => e.resource_id), ['histlegacy'])
    assert.strictEqual(until.data.filters.until, new Date('2026-09-15').toISOString())
  })
  await t('GET /plan-changes pagination with limit + next_cursor; bad params → 400 with error codes', async () => {
    const seen = []
    let url = '/plan-changes?limit=2'
    for (let i = 0; i < 10; i++) {
      const pg = await api('get', url)
      assert.strictEqual(pg.status, 200)
      seen.push(...pg.data.plan_changes.map((e) => e.id))
      if (!pg.data.has_more) break
      url = `/plan-changes?limit=2&cursor=${encodeURIComponent(pg.data.next_cursor)}`
    }
    const total = (await api('get', '/plan-changes')).data.total
    assert.strictEqual(seen.length, total); assert.strictEqual(new Set(seen).size, total)
    for (const [q, c] of [['product=dns', 'invalid_product'], ['since=notadate', 'invalid_date'], ['status=ok', 'invalid_status'], ['via=web', 'invalid_via'], ['limit=-1', 'invalid_limit'], ['cursor=zzz', 'invalid_cursor']]) {
      const r = await api('get', `/plan-changes?${q}`)
      assert.strictEqual(r.status, 400, q); assert.strictEqual(r.data.error, c, q)
    }
    const other = await api('get', '/plan-changes', null, KEY2)
    assert.ok(other.data.plan_changes.every((e) => e.resource_id === 'otherhost'))
  })

  console.log('hosting renewal-price repair')
  const R = DB.collection('cpanelAccounts_repair')
  const up = new Date('2026-09-20T00:00:00Z')
  await R.insertMany([
    { _id: 'oldbotweekly', domain: 'a.test', chatId: '1', plan: GOLDEN, renewalPriceUsd: 30, upgradedAt: up, upgradedFrom: WEEKLY, upgradeChargedAmount: 50, expiryDate: new Date(Date.now() + 10 * DAY), autoRenew: true },
    { _id: 'oldbotprem', domain: 'b.test', chatId: '2', plan: GOLDEN, renewalPriceUsd: 75, upgradedAt: up, upgradedFrom: PREMIUM, expiryDate: new Date(Date.now() + 5 * DAY) },
    { _id: 'apichanged', domain: 'c.test', chatId: '3', plan: GOLDEN, renewalPriceUsd: 90, upgradedAt: up, planChangedAt: up, upgradedFrom: PREMIUM },
    { _id: 'promo', domain: 'd.test', chatId: '4', plan: GOLDEN, renewalPriceUsd: 60 },
    { _id: 'deletedone', domain: 'e.test', chatId: '5', plan: GOLDEN, renewalPriceUsd: 30, upgradedAt: up, upgradedFrom: WEEKLY, deleted: true },
    { _id: 'terminated', domain: 'f.test', chatId: '6', plan: GOLDEN, renewalPriceUsd: 30, upgradedAt: up, upgradedFrom: WEEKLY, terminatedOnWhm: true },
    { _id: 'nolock', domain: 'g.test', chatId: '7', plan: GOLDEN, upgradedAt: up, upgradedFrom: WEEKLY },
    { _id: 'correct', domain: 'h.test', chatId: '8', plan: GOLDEN, renewalPriceUsd: 100, upgradedAt: up, upgradedFrom: PREMIUM },
    { _id: 'repairedbefore', domain: 'i.test', chatId: '9', plan: GOLDEN, renewalPriceUsd: 30, upgradedAt: up, upgradedFrom: WEEKLY, renewalPriceRepairedAt: new Date('2026-09-25T00:00:00Z') },
    { _id: 'racy', domain: 'j.test', chatId: '10', plan: PREMIUM, renewalPriceUsd: 30, upgradedAt: up, upgradedFrom: WEEKLY },
  ])
  await t('preview lists ONLY old-bot-upgraded accounts with a stale locked price (never promo/API/deleted/terminated/correct/repaired)', async () => {
    const rows = await repair.findAffected(R)
    assert.deepStrictEqual(rows.map((r) => r.username).sort(), ['oldbotprem', 'oldbotweekly', 'racy'])
    const w = rows.find((r) => r.username === 'oldbotweekly')
    assert.strictEqual(w.current_renewal_price_usd, 30); assert.strictEqual(w.correct_renewal_price_usd, 100); assert.strictEqual(w.difference_per_renewal_usd, 70)
    const s = repair.summarize(rows)
    assert.strictEqual(s.affected_count, 3); assert.strictEqual(s.total_difference_per_renewal_usd, 70 + 25 + 45)
    assert.strictEqual((await R.findOne({ _id: 'oldbotweekly' })).renewalPriceUsd, 30, 'preview changes nothing')
  })
  await t('apply (subset) fixes only the named accounts; compare-and-set skips an account changed since the preview; re-apply is a no-op', async () => {
    const sub = await repair.applyRepair(R, { usernames: ['oldbotweekly', 'nosuchuser'] })
    assert.strictEqual(sub.applied_count, 1); assert.deepStrictEqual(sub.not_affected, ['nosuchuser'])
    const a = await R.findOne({ _id: 'oldbotweekly' })
    assert.strictEqual(a.renewalPriceUsd, 100); assert.ok(a.renewalPriceRepairedAt); assert.strictEqual(a.renewalPriceRepair.from_usd, 30)
    // simulate a change landing between preview and apply: the module re-reads, so only an
    // update racing the write itself is skipped — emulate by pre-changing the plan of 'racy'
    const realUpdate = R.updateOne.bind(R)
    R.updateOne = async (f, u) => { if (f._id === 'racy') await realUpdate({ _id: 'racy' }, { $set: { plan: GOLDEN } }); return realUpdate(f, u) }
    const rest = await repair.applyRepair(R)
    R.updateOne = realUpdate
    assert.strictEqual(rest.applied_count, 1); assert.strictEqual(rest.applied[0].username, 'oldbotprem')
    assert.strictEqual(rest.skipped.length, 1); assert.strictEqual(rest.skipped[0].username, 'racy'); assert.strictEqual(rest.skipped[0].skipped_reason, 'changed_since_preview')
    assert.strictEqual((await R.findOne({ _id: 'oldbotprem' })).renewalPriceUsd, 100)
    assert.strictEqual((await R.findOne({ _id: 'racy' })).renewalPriceUsd, 30, 'racy left untouched')
    const again = await repair.applyRepair(R, { usernames: ['oldbotweekly', 'oldbotprem'] })
    assert.strictEqual(again.applied_count, 0)
  })
  await t('auto-renew price after repair = new plan price (getPlanPrice on the account)', async () => {
    const { getPlanPrice } = require('../hosting-scheduler')
    assert.strictEqual(getPlanPrice(await R.findOne({ _id: 'oldbotweekly' })), 100)
    assert.strictEqual(getPlanPrice(await R.findOne({ _id: 'promo' })), 60, 'promo price lock untouched')
  })

  server.close()
  await DB.dropDatabase(); await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
