/* eslint-disable no-console */
// DigitalOcean VPS/RDP in-place plan change + hosting plan change — engine, pro-rata math, reseller API.
// Run: node js/tests/test_do_plan_change_2026-10.js
// SAFE: the DigitalOcean API is replaced by an in-memory fake, WHM + anti-red are stubbed, throw-away
// local DB. The reseller API runs in LIVE mode against those fakes (nothing real is resized or charged).
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.VPS_MARKUP_PERCENT = '200'
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
const hpc = require('../hosting-plan-change')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000

// ── Fake DigitalOcean API ──
const fake = { droplets: new Map(), actions: new Map(), calls: [], failResize: false, refuseOff: false, delayMs: 0, n: 1 }
function addDroplet(id, size, disk, region = 'fra1', status = 'active') { fake.droplets.set(String(id), { id: Number(id), size_slug: size, disk, status, region: { slug: region } }) }
const sizeDisk = (slug) => { const p = d.getProduct(slug); return p ? p.diskMb / 1024 : 0 }
d.apiRequest = async (method, p, data) => {
  fake.calls.push({ method, path: p, data })
  let m
  if (method === 'GET' && (m = p.match(/^\/droplets\/(\d+)$/))) {
    const dr = fake.droplets.get(m[1]); if (!dr) { const e = new Error(`DO GET ${p} failed (404)`); e.status = 404; throw e }
    return { droplet: { ...dr, region: { ...dr.region } } }
  }
  if (method === 'GET' && (m = p.match(/^\/actions\/(\d+)$/))) { const a = fake.actions.get(m[1]); return { action: { ...a, status: Date.now() < (a.doneAt || 0) ? 'in-progress' : a.status } } }
  if (method === 'POST' && (m = p.match(/^\/droplets\/(\d+)\/actions$/))) {
    const dr = fake.droplets.get(m[1]); const id = String(fake.n++)
    if (data.type === 'shutdown' || data.type === 'power_off') { if (!fake.refuseOff) dr.status = 'off' } else if (data.type === 'power_on') dr.status = 'active'
    else if (data.type === 'resize') {
      if (dr.status !== 'off') throw new Error('DO resize failed (422): Droplet must be powered off')
      if (sizeDisk(data.size) < dr.disk) throw new Error('DO resize failed (422): disk too small')
      if (fake.failResize) { fake.actions.set(id, { id, status: 'errored' }); return { action: { id: Number(id) } } }
      dr.size_slug = data.size; if (data.disk) dr.disk = sizeDisk(data.size)
    }
    fake.actions.set(id, { id, status: 'completed', doneAt: Date.now() + (data.type === 'resize' ? fake.delayMs : 0) })
    return { action: { id: Number(id), status: 'in-progress' } }
  }
  throw new Error(`unmocked DO ${method} ${p}`)
}
d.getInstance = async () => null
rdp.getInstance = async () => null
pc._timing.poll = 5
const ALL = ['fra1', 'nyc3', 'nyc1', 'sfo3', 'lon1', 'sgp1', 'syd1', 'blr1', 'ams3']
d._applySizes([...d.PRODUCT_CATALOG, ...d.PRODUCT_CATALOG_NVME].map((p) => ({ slug: p.productId, available: true, price_monthly: p.basePriceUsd, regions: ALL })))

// ── Stubbed WHM / anti-red ──
const whmCalls = []
whm.getAccountInfo = async (u) => ({ success: u !== 'gonehost' })
whm.changePackage = async (u, plan) => { whmCalls.push([u, plan]); return u === 'refusehost' ? { success: false, error: 'pkg refused' } : { success: true } }
antiRed.deployFullProtection = async () => ({ success: true })

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_do_plan_change_${Date.now()}`)
  rdp.init(DB)
  const plans = DB.collection('vpsPlansOf')
  const wallets = DB.collection('walletOf')
  const OWNER = '777000901'
  const bal = async (id = OWNER) => { const w = await wallets.findOne({ _id: id }); return Math.round(((w.usdIn || 0) - (w.usdOut || 0)) * 100) / 100 }
  await wallets.insertOne({ _id: OWNER, usdIn: 1000, usdOut: 0 })
  const vpsRec = (over = {}) => ({ _id: crypto.randomUUID(), chatId: OWNER, vpsId: 'do-101', provider: 'digitalocean', productId: 's-2vcpu-4gb', planPrice: 72, isRDP: false, status: 'RUNNING', end_time: new Date(Date.now() + 15 * DAY), region: 'EU', ...over })

  console.log('engine — options + pro-rata quote')
  addDroplet(101, 's-2vcpu-4gb', 80)
  await t('VPS options: priced at catalog, smaller disks blocked, pro-rata = monthly diff × days/30', async () => {
    const po = await pc.planOptions(vpsRec(), new Date())
    assert.strictEqual(po.current.plan_id, 's-2vcpu-4gb')
    assert.strictEqual(po.current.monthly_price_usd, 72)
    const up = po.options.find((o) => o.plan_id === 's-4vcpu-8gb')
    assert.strictEqual(up.direction, 'upgrade')
    assert.strictEqual(up.monthly_price_usd, 144)
    assert.ok(Math.abs(up.charge_now_usd - 36) < 0.02, up.charge_now_usd) // (144-72) × 15/30
    assert.strictEqual(up.allowed, true)
    assert.strictEqual(up.can_resize_disk, true)
    assert.strictEqual(up.disk_after_gb, 80)
    const small = po.options.find((o) => o.plan_id === 's-1vcpu-2gb')
    assert.strictEqual(small.allowed, false)
    assert.strictEqual(small.blocked_reason, 'disk_too_small')
    const nvme = po.options.find((o) => o.plan_id === 's-2vcpu-4gb-amd')
    assert.strictEqual(nvme.storage_type, 'NVMe SSD')
    assert.strictEqual(nvme.allowed, true)
    for (let i = 1; i < po.options.length; i++) assert.ok(po.options[i].monthly_price_usd >= po.options[i - 1].monthly_price_usd)
  })
  await t('downgrade (disk kept from a CPU/RAM-only upgrade) is allowed and free, no refund', async () => {
    addDroplet(102, 's-4vcpu-8gb', 80)
    const q = await pc.quote(vpsRec({ vpsId: 'do-102' }), 's-2vcpu-4gb')
    assert.strictEqual(q.option.direction, 'downgrade')
    assert.strictEqual(q.option.charge_now_usd, 0)
    assert.strictEqual(q.option.refund_usd, 0)
    assert.strictEqual(q.option.renewal_price_usd, 72)
  })
  await t('guards: expired, not active, non-DO, same plan, unknown plan', async () => {
    const codeOf = async (p) => { try { await p; return 'ok' } catch (e) { return e.code } }
    assert.strictEqual(await codeOf(pc.planOptions(vpsRec({ end_time: new Date(Date.now() - 1000) }))), 'expired')
    assert.strictEqual(await codeOf(pc.planOptions(vpsRec({ status: 'CANCELLED' }))), 'not_active')
    assert.strictEqual(await codeOf(pc.planOptions(vpsRec({ provider: 'contabo', vpsId: '2023455' }))), 'not_supported')
    assert.strictEqual(await codeOf(pc.quote(vpsRec(), 's-2vcpu-4gb')), 'same_plan')
    assert.strictEqual(await codeOf(pc.quote(vpsRec(), 'nope')), 'invalid_plan')
    assert.strictEqual(await codeOf(pc.quote(vpsRec(), 's-1vcpu-2gb')), 'disk_too_small')
  })

  console.log('engine — start / resize / persist')
  await t('upgrade: charges once, powers off → resizes CPU/RAM only → powers on, persists plan + history', async () => {
    addDroplet(103, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-103' }); await plans.insertOne(rec)
    const before = await bal()
    fake.calls = []
    const s = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb' })
    assert.strictEqual(s.change.status, 'running')
    assert.ok(Math.abs((before - await bal()) - s.option.charge_now_usd) < 0.001)
    const r = await s.done
    assert.strictEqual(r.success, true, r.error)
    const dr = fake.droplets.get('103')
    assert.strictEqual(dr.size_slug, 's-4vcpu-8gb'); assert.strictEqual(dr.disk, 80); assert.strictEqual(dr.status, 'active')
    const types = fake.calls.filter((c) => c.method === 'POST').map((c) => c.data.type)
    assert.deepStrictEqual(types, ['shutdown', 'resize', 'power_on'])
    assert.strictEqual(fake.calls.find((c) => c.data && c.data.type === 'resize').data.disk, false)
    const after = await plans.findOne({ _id: rec._id })
    assert.strictEqual(after.productId, 's-4vcpu-8gb'); assert.strictEqual(after.planPrice, 144)
    assert.strictEqual(after.planChange.status, 'completed'); assert.strictEqual(after.planChangeHistory.length, 1)
    assert.strictEqual(after.end_time.getTime(), rec.end_time.getTime()) // term end never moves
    assert.ok(Math.abs((before - await bal()) - 36) < 0.02)
  })
  await t('resize_disk:true grows the disk (permanent) — later downgrades below it are blocked', async () => {
    addDroplet(104, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-104' }); await plans.insertOne(rec)
    const s = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb', resizeDisk: true })
    assert.strictEqual(s.option.resize_disk, true)
    assert.strictEqual((await s.done).success, true)
    assert.strictEqual(fake.droplets.get('104').disk, 160)
    const fresh = await plans.findOne({ _id: rec._id })
    let code = null; try { await pc.quote(fresh, 's-2vcpu-4gb') } catch (e) { code = e.code }
    assert.strictEqual(code, 'disk_too_small')
  })
  await t('downgrade: no wallet movement at all, applied immediately', async () => {
    addDroplet(105, 's-4vcpu-8gb', 80)
    const rec = vpsRec({ vpsId: 'do-105', productId: 's-4vcpu-8gb', planPrice: 144 }); await plans.insertOne(rec)
    const before = await bal()
    const s = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-2vcpu-4gb' })
    assert.strictEqual(s.change.charged_usd, 0)
    assert.strictEqual((await s.done).success, true)
    assert.strictEqual(await bal(), before)
    const after = await plans.findOne({ _id: rec._id })
    assert.strictEqual(after.planPrice, 72); assert.strictEqual(fake.droplets.get('105').size_slug, 's-2vcpu-4gb')
  })
  await t('resize failure → full refund, plan unchanged, server powered back on', async () => {
    addDroplet(106, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-106' }); await plans.insertOne(rec)
    const before = await bal()
    fake.failResize = true
    const s = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb' })
    const r = await s.done
    fake.failResize = false
    assert.strictEqual(r.success, false); assert.strictEqual(r.refunded, true)
    assert.strictEqual(await bal(), before)
    assert.strictEqual(fake.droplets.get('106').status, 'active'); assert.strictEqual(fake.droplets.get('106').size_slug, 's-2vcpu-4gb')
    const after = await plans.findOne({ _id: rec._id })
    assert.strictEqual(after.planChange.status, 'failed'); assert.strictEqual(after.productId, 's-2vcpu-4gb')
  })
  await t('server that will not power off → no resize, refund, powered back on', async () => {
    addDroplet(107, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-107' }); await plans.insertOne(rec)
    const before = await bal()
    const T = pc._timing; const keep = [T.shutdownMs, T.powerOffMs]; T.shutdownMs = 30; T.powerOffMs = 30
    fake.refuseOff = true
    const r = await (await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb' })).done
    fake.refuseOff = false; [T.shutdownMs, T.powerOffMs] = keep
    assert.strictEqual(r.success, false); assert.strictEqual(await bal(), before)
    assert.ok(!fake.calls.slice(-3).some((c) => c.data && c.data.type === 'resize'))
  })
  await t('a powered-off server stays off after the resize', async () => {
    addDroplet(108, 's-2vcpu-4gb', 80, 'fra1', 'off')
    const rec = vpsRec({ vpsId: 'do-108' }); await plans.insertOne(rec)
    assert.strictEqual((await (await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb' })).done).success, true)
    assert.strictEqual(fake.droplets.get('108').status, 'off')
  })
  await t('concurrent change is refused; insufficient wallet → 402 with the lock released', async () => {
    addDroplet(109, 's-2vcpu-4gb', 80)
    const rec = vpsRec({ vpsId: 'do-109' }); await plans.insertOne(rec)
    const s1 = await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-8gb' })
    let code = null; try { await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 's-4vcpu-16gb-amd' }) } catch (e) { code = e.code }
    assert.strictEqual(code, 'plan_change_in_progress')
    await s1.done
    await wallets.insertOne({ _id: '777000902', usdIn: 1, usdOut: 0 })
    addDroplet(110, 's-2vcpu-4gb', 80)
    const poor = vpsRec({ vpsId: 'do-110', chatId: '777000902' }); await plans.insertOne(poor)
    code = null; try { await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec: poor, planId: 's-4vcpu-8gb' }) } catch (e) { code = e.code }
    assert.strictEqual(code, 'insufficient_wallet_balance')
    assert.strictEqual((await plans.findOne({ _id: poor._id })).planChange, undefined)
    assert.strictEqual(await bal('777000902'), 1)
  })

  console.log('engine — RDP')
  const rdpServers = DB.collection('doRdpServers')
  await t('RDP standard → pro: tier pricing, same CPU family, persists tier on both records', async () => {
    const sid = crypto.randomUUID()
    await rdpServers.insertOne({ server_id: sid, do_droplet_id: 201, tier_slug: 'standard', region: 'ams3', duration_months: 1, status: 'active', product_id: 'standard-1m' })
    addDroplet(201, 's-2vcpu-4gb-amd', 80, 'ams3')
    const rec = { _id: crypto.randomUUID(), chatId: OWNER, vpsId: `rdp-${sid}`, provider: 'digitalocean-rdp', productId: 'standard-1m', planPrice: 56, isRDP: true, status: 'RUNNING', end_time: new Date(Date.now() + 10 * DAY) }
    await plans.insertOne(rec)
    const po = await pc.planOptions(rec)
    assert.deepStrictEqual(po.options.map((o) => o.plan_id), ['pro', 'power'])
    const pro = po.options[0]
    assert.strictEqual(pro.size_slug, 's-4vcpu-8gb-amd')
    assert.ok(Math.abs(pro.charge_now_usd - 18.67) < 0.02, pro.charge_now_usd) // (112-56) × 10/30
    const r = await (await pc.start({ vpsPlansOf: plans, walletOf: wallets, rec, planId: 'pro' })).done
    assert.strictEqual(r.success, true, r.error)
    assert.strictEqual((await plans.findOne({ _id: rec._id })).productId, 'pro-1m')
    const srv = await rdpServers.findOne({ server_id: sid })
    assert.strictEqual(srv.tier_slug, 'pro'); assert.strictEqual(srv.product_id, 'pro-1m')
  })
  await t('RDP on a 3-month term renews at the 3-month bundle price of the new tier', async () => {
    const sid = crypto.randomUUID()
    await rdpServers.insertOne({ server_id: sid, do_droplet_id: 202, tier_slug: 'pro', region: 'fra1', duration_months: 3, status: 'active' })
    addDroplet(202, 's-4vcpu-8gb-intel', 160, 'fra1')
    const rec = { _id: crypto.randomUUID(), chatId: OWNER, vpsId: `rdp-${sid}`, provider: 'digitalocean-rdp', productId: 'pro-3m', isRDP: true, status: 'RUNNING', end_time: new Date(Date.now() + 60 * DAY) }
    const po = await pc.planOptions(rec)
    assert.strictEqual(po.options.find((o) => o.plan_id === 'standard').allowed, false) // 80 GB < 160 GB disk
    const power = po.options.find((o) => o.plan_id === 'power')
    assert.strictEqual(power.size_slug, 's-8vcpu-16gb-amd') // RDP is AMD only (2026-10-14) — an Intel box upgrades onto AMD
    assert.strictEqual(power.renewal_price_usd, rdp.getProduct('power-3m').pricing.totalWithMarkup)
    assert.ok(Math.abs(power.charge_now_usd - 224) < 0.05, power.charge_now_usd) // (224-112) × 60/30
  })

  console.log('engine — stale reconcile')
  await t('orphaned running change: resized → completed; not resized → refunded', async () => {
    addDroplet(301, 's-4vcpu-8gb', 80); addDroplet(302, 's-2vcpu-4gb', 80, 'fra1', 'off')
    const old = new Date(Date.now() - 2 * 3600000)
    const mk = (vpsId, droplet) => ({ id: crypto.randomUUID(), status: 'running', kind: 'vps', via: 'api', chat_id: OWNER, direction: 'upgrade', resize_disk: false, charged_usd: 10, droplet_id: droplet, was_on: true, from: { plan_id: 's-2vcpu-4gb' }, to: { plan_id: 's-4vcpu-8gb', name: 'x', size_slug: 's-4vcpu-8gb', renewal_price_usd: 144, product_id: 's-4vcpu-8gb' }, started_at: old })
    const a = vpsRec({ vpsId: 'do-301', planChange: mk('do-301', 301) }); const b = vpsRec({ vpsId: 'do-302', planChange: mk('do-302', 302) })
    await plans.insertMany([a, b])
    const before = await bal()
    const seen = []
    await pc.reconcileStale({ vpsPlansOf: plans, walletOf: wallets, onDone: (r) => seen.push(r.success) })
    assert.deepStrictEqual(seen.sort(), [false, true])
    assert.strictEqual((await plans.findOne({ _id: a._id })).planChange.status, 'completed')
    assert.strictEqual((await plans.findOne({ _id: a._id })).planPrice, 144)
    assert.strictEqual((await plans.findOne({ _id: b._id })).planChange.status, 'failed')
    assert.strictEqual(await bal(), before + 10)
    assert.strictEqual(fake.droplets.get('302').status, 'active') // power restored
  })

  console.log('hosting quote')
  const hp = require('../reseller-api').hostingPlans()
  const acct = (over = {}) => ({ _id: 'h1', plan: 'Premium Anti-Red HostPanel (30 Days)', expiryDate: new Date(Date.now() + 15 * DAY), addonDomains: [], ...over })
  await t('premium → golden = (100-75) × 15/30; golden → premium free; weekly → monthly = monthly − unused weekly credit, fresh 30 days', () => {
    const now = new Date()
    const up = hpc.hostingQuote(acct(), hp, 'golden-monthly', now).option
    assert.strictEqual(up.direction, 'upgrade'); assert.ok(Math.abs(up.charge_now_usd - 12.5) < 0.02, up.charge_now_usd)
    assert.strictEqual(up.billing, 'pro_rata'); assert.strictEqual(up.expiry_changes, false)
    const down = hpc.hostingQuote(acct({ plan: 'Golden Anti-Red HostPanel (30 Days)' }), hp, 'premium-monthly', now).option
    assert.strictEqual(down.direction, 'downgrade'); assert.strictEqual(down.charge_now_usd, 0); assert.strictEqual(down.refund_usd, 0)
    const wk = hpc.hostingQuote(acct({ plan: 'Premium Anti-Red (1-Week)', expiryDate: new Date(now.getTime() + 5 * DAY) }), hp, 'golden-monthly', now).option
    assert.strictEqual(wk.direction, 'upgrade'); assert.strictEqual(wk.billing, 'new_term')
    assert.strictEqual(wk.unused_credit_usd, 21.43); assert.strictEqual(wk.charge_now_usd, 78.57) // 100 − 30 × 5/7
    assert.strictEqual(new Date(wk.expires_at).getTime(), now.getTime() + 30 * DAY)
  })
  await t('hosting guards: expired, too many addons, same plan', () => {
    const code = (fn) => { try { fn(); return 'ok' } catch (e) { return e.code } }
    assert.strictEqual(code(() => hpc.hostingPlanOptions(acct({ expiryDate: new Date(Date.now() - 1) }), hp)), 'expired')
    assert.strictEqual(code(() => hpc.hostingQuote(acct({ plan: 'Golden Anti-Red HostPanel (30 Days)', addonDomains: [1, 2, 3, 4, 5, 6] }), hp, 'premium-monthly')), 'too_many_addon_domains')
    assert.strictEqual(code(() => hpc.hostingQuote(acct(), hp, 'premium-monthly')), 'same_plan')
  })

  console.log('reseller API (live mode, fake DO/WHM)')
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
  addDroplet(401, 's-2vcpu-4gb', 80)
  const apiVps = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: 'do-401', provider: 'digitalocean', productId: 's-2vcpu-4gb', plan: 'Cloud VPS 30', planPrice: 72, isRDP: false, status: 'RUNNING', provisionState: 'active', source: 'reseller_api', end_time: new Date(Date.now() + 20 * DAY), region: 'EU' }
  await plans.insertOne(apiVps)

  await t('GET /vps/:id/plan-options lists options + policy, hides the DO size slug; 404 for others', async () => {
    const r = await api('get', `/vps/${apiVps.vpsId}/plan-options`)
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.current.plan_id, 's-2vcpu-4gb')
    assert.ok(r.data.policy.upgrade && r.data.policy.downgrade && r.data.policy.disk)
    assert.ok(r.data.options.length >= 20)
    assert.ok(r.data.options.every((o) => !('size_slug' in o)))
    assert.strictEqual((await api('get', '/vps/nope/plan-options')).status, 404)
    assert.strictEqual((await api('get', `/rdp/${apiVps.vpsId}/plan-options`)).status, 404)
  })
  await t('POST validation: missing/unknown/same plan, bad resize_disk, smaller disk — never charges', async () => {
    const before = await bal()
    assert.strictEqual((await api('post', `/vps/${apiVps.vpsId}/upgrade`, {})).data.error, 'missing_plan_id')
    assert.strictEqual((await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 'x' })).data.error, 'invalid_plan')
    assert.strictEqual((await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-2vcpu-4gb' })).data.error, 'same_plan')
    assert.strictEqual((await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb', resize_disk: 'yes' })).data.error, 'invalid_resize_disk')
    const small = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-1vcpu-2gb' })
    assert.strictEqual(small.status, 409); assert.strictEqual(small.data.error, 'disk_too_small')
    assert.strictEqual(await bal(), before)
  })
  await t('dry_run pre-flight returns the quote with no charge and no DO action', async () => {
    const before = await bal(); const n = fake.calls.filter((c) => c.method === 'POST').length
    const r = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb', dry_run: true })
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.dry_run, true)
    assert.ok(Math.abs(r.data.quote.charge_now_usd - 48) < 0.05, r.data.quote.charge_now_usd) // (144-72) × 20/30
    assert.strictEqual(r.data.sufficient_balance, true)
    assert.strictEqual(await bal(), before); assert.strictEqual(fake.calls.filter((c) => c.method === 'POST').length, n)
  })
  await t('live upgrade: 202 running → GET shows completed, wallet charged once, vps.plan_changed webhook', async () => {
    const before = await bal()
    fake.delayMs = 400
    const r = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    assert.strictEqual(r.data.status, 'running'); assert.strictEqual(r.data.plan_change.status, 'running')
    const busy = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-16gb-amd' })
    fake.delayMs = 0
    assert.strictEqual(busy.status, 409); assert.strictEqual(busy.data.error, 'plan_change_in_progress')
    let g
    for (let i = 0; i < 100; i++) { g = await api('get', `/vps/${apiVps.vpsId}`); if (g.data.plan_change && g.data.plan_change.status !== 'running') break; await sleep(30) }
    assert.strictEqual(g.data.plan_change.status, 'completed', JSON.stringify(g.data.plan_change))
    assert.strictEqual(g.data.plan_change.charged_usd, r.data.charged_usd)
    assert.ok(Math.abs((before - await bal()) - r.data.charged_usd) < 0.001)
    const rec = await plans.findOne({ _id: apiVps._id })
    assert.strictEqual(rec.productId, 's-4vcpu-8gb'); assert.strictEqual(rec.plan, d.getProduct('s-4vcpu-8gb').name); assert.strictEqual(rec.planPrice, 144)
    for (let i = 0; i < 50 && !hooks.some((h) => h.event === 'vps.plan_changed'); i++) await sleep(30)
    const h = hooks.find((x) => x.event === 'vps.plan_changed')
    assert.ok(h, JSON.stringify(hooks)); assert.strictEqual(h.data.to_plan, 's-4vcpu-8gb'); assert.strictEqual(h.data.id, apiVps.vpsId)
  })
  await t('live downgrade via /change-plan: charged 0, no refund, renewal price lowered', async () => {
    const before = await bal()
    const r = await api('post', `/vps/${apiVps.vpsId}/change-plan`, { plan_id: 's-2vcpu-4gb' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data)); assert.strictEqual(r.data.charged_usd, 0)
    assert.strictEqual(r.data.quote.direction, 'downgrade')
    for (let i = 0; i < 100; i++) { const g = await api('get', `/vps/${apiVps.vpsId}`); if (g.data.plan_change.status !== 'running') break; await sleep(30) }
    assert.strictEqual(await bal(), before)
    assert.strictEqual((await plans.findOne({ _id: apiVps._id })).planPrice, 72)
  })
  await t('failed resize via API → refunded, plan_change failed, vps.plan_change_failed webhook', async () => {
    const before = await bal()
    fake.failResize = true
    const r = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb' })
    assert.strictEqual(r.status, 202)
    let g
    for (let i = 0; i < 100; i++) { g = await api('get', `/vps/${apiVps.vpsId}`); if (g.data.plan_change.status !== 'running') break; await sleep(30) }
    fake.failResize = false
    assert.strictEqual(g.data.plan_change.status, 'failed'); assert.strictEqual(g.data.plan_change.refunded, true)
    assert.strictEqual(await bal(), before)
    for (let i = 0; i < 50 && !hooks.some((h) => h.event === 'vps.plan_change_failed'); i++) await sleep(30)
    assert.ok(hooks.find((x) => x.event === 'vps.plan_change_failed' && x.data.refunded === true))
  })
  await t('402 when the wallet cannot cover the pro-rata charge', async () => {
    await wallets.updateOne({ _id: OWNER }, { $set: { usdIn: 0, usdOut: 0 } })
    const r = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb' })
    assert.strictEqual(r.status, 402); assert.strictEqual(r.data.error, 'insufficient_wallet_balance'); assert.ok(r.data.shortfall_usd > 0)
    await wallets.updateOne({ _id: OWNER }, { $set: { usdIn: 1000, usdOut: 0 } })
  })
  await t('RDP endpoints: plan-options + live upgrade', async () => {
    const sid = crypto.randomUUID()
    await rdpServers.insertOne({ server_id: sid, do_droplet_id: 402, tier_slug: 'standard', region: 'fra1', duration_months: 1, status: 'active' })
    addDroplet(402, 's-2vcpu-4gb-intel', 80, 'fra1')
    const rec = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: `rdp-${sid}`, provider: 'digitalocean-rdp', productId: 'standard-1m', plan: 'Standard', isRDP: true, status: 'RUNNING', source: 'reseller_api', end_time: new Date(Date.now() + 30 * DAY) }
    await plans.insertOne(rec)
    const o = await api('get', `/rdp/${rec.vpsId}/plan-options`)
    assert.strictEqual(o.status, 200, JSON.stringify(o.data)); assert.deepStrictEqual(o.data.options.map((x) => x.plan_id), ['pro', 'power'])
    const r = await api('post', `/rdp/${rec.vpsId}/upgrade`, { plan_id: 'power' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    for (let i = 0; i < 100; i++) { const g = await api('get', `/rdp/${rec.vpsId}`); if (g.data.plan_change && g.data.plan_change.status !== 'running') break; await sleep(30) }
    assert.strictEqual(fake.droplets.get('402').size_slug, 's-8vcpu-16gb-amd') // AMD only
    assert.strictEqual((await plans.findOne({ _id: rec._id })).productId, 'power-1m')
  })
  await t('non-DigitalOcean server → 501 not_supported', async () => {
    const rec = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: '2023455', provider: 'contabo', productId: 'V45', isRDP: false, status: 'RUNNING', end_time: new Date(Date.now() + 30 * DAY) }
    await plans.insertOne(rec)
    const r = await api('get', `/vps/${rec.vpsId}/plan-options`)
    assert.strictEqual(r.status, 501); assert.strictEqual(r.data.error, 'not_supported')
  })

  console.log('reseller API — hosting')
  const cp = DB.collection('cpanelAccounts')
  const exp = new Date(Date.now() + 15 * DAY)
  await cp.insertMany([
    { _id: 'premhost', chatId: OWNER, domain: 'prem.test', plan: 'Premium Anti-Red HostPanel (30 Days)', expiryDate: exp, addonDomains: [] },
    { _id: 'goldhost', chatId: OWNER, domain: 'gold.test', plan: 'Golden Anti-Red HostPanel (30 Days)', expiryDate: exp, addonDomains: [] },
    { _id: 'oldhost', chatId: OWNER, domain: 'old.test', plan: 'Golden Anti-Red HostPanel (30 Days)', expiryDate: new Date(Date.now() - DAY), addonDomains: [] },
    { _id: 'pausedhost', chatId: OWNER, domain: 'paused.test', plan: 'Premium Anti-Red HostPanel (30 Days)', expiryDate: exp, suspended: true },
  ])
  await t('GET /hosting/:user/plan-options + dry_run', async () => {
    const r = await api('get', '/hosting/premhost/plan-options')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.current.plan_id, 'premium-monthly')
    const g = r.data.options.find((o) => o.plan_id === 'golden-monthly'); assert.ok(Math.abs(g.charge_now_usd - 12.5) < 0.02)
    const d0 = await api('post', '/hosting/premhost/upgrade', { plan_id: 'golden-monthly', dry_run: true })
    assert.strictEqual(d0.data.dry_run, true); assert.strictEqual(whmCalls.length, 0)
  })
  await t('hosting upgrade charges pro-rata, expiry unchanged; downgrade free with no refund', async () => {
    const before = await bal()
    const up = await api('post', '/hosting/premhost/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(up.status, 200, JSON.stringify(up.data)); assert.strictEqual(up.data.action, 'upgrade')
    assert.ok(Math.abs(up.data.charged_usd - 12.5) < 0.02); assert.ok(Math.abs((before - await bal()) - up.data.charged_usd) < 0.001)
    const a1 = await cp.findOne({ _id: 'premhost' })
    assert.strictEqual(a1.plan, 'Golden Anti-Red HostPanel (1-Month)'); assert.strictEqual(a1.renewalPriceUsd, 100)
    assert.strictEqual(a1.expiryDate.getTime(), exp.getTime())
    const mid = await bal()
    const dn = await api('post', '/hosting/goldhost/change-plan', { plan_id: 'premium-monthly' })
    assert.strictEqual(dn.status, 200, JSON.stringify(dn.data)); assert.strictEqual(dn.data.action, 'downgrade'); assert.strictEqual(dn.data.charged_usd, 0)
    assert.strictEqual(await bal(), mid)
    assert.strictEqual((await cp.findOne({ _id: 'goldhost' })).renewalPriceUsd, 75)
    assert.deepStrictEqual(whmCalls.map((c) => c[0]), ['premhost', 'goldhost'])
  })
  await t('hosting guards: expired → renew first, suspended → unsuspend first', async () => {
    const e = await api('post', '/hosting/oldhost/upgrade', { plan_id: 'premium-monthly' })
    assert.strictEqual(e.status, 409); assert.strictEqual(e.data.error, 'expired')
    const s = await api('post', '/hosting/pausedhost/upgrade', { plan_id: 'golden-monthly' })
    assert.strictEqual(s.status, 409); assert.strictEqual(s.data.error, 'account_suspended')
  })
  await t('dry-run mode (RESELLER_API_LIVE off): simulated, nothing charged or resized', async () => {
    process.env.RESELLER_API_LIVE = 'false'
    const before = await bal(); const n = fake.calls.filter((c) => c.method === 'POST').length
    const r = await api('post', `/vps/${apiVps.vpsId}/upgrade`, { plan_id: 's-4vcpu-8gb' })
    process.env.RESELLER_API_LIVE = 'true'
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.mode, 'dry_run')
    assert.strictEqual(await bal(), before); assert.strictEqual(fake.calls.filter((c) => c.method === 'POST').length, n)
  })

  server.close(); hookSrv.close()
  await DB.dropDatabase(); await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
