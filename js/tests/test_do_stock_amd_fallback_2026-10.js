// DigitalOcean live stock: AMD-only RDP, same-city fallback, +15% price pass-through, pre-payment
// out-of-stock gate, VPS exact-size fallback, RDP/VPS wording, reseller active-only webhooks with
// refund on failure, and admin stock-change alerts (2026-10-14 owner requirements).
// FAKE DigitalOcean (axios stubbed), isolated local MongoDB DB, in-process reseller API + webhook receiver.
//   node js/tests/test_do_stock_amd_fallback_2026-10.js
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DIGITALOCEAN_API_TOKEN = 'test-token' // every DO call goes to the fake below
process.env.NODE_ENV = 'test'
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.RESELLER_API_LIVE = 'true' // isolated DB + stubbed provider: exercises the real charge/refund path
process.env.RESELLER_PROVISION_WORKER_MS = '15000'
process.env.RESELLER_PROVISION_WORKER = 'true' // the worker is OFF on a sandbox unless turned on (2026-10-14 isolation)
const { MongoClient } = require('mongodb')

// ── Fake DigitalOcean ─────────────────────────────────────────────────────
const CAT = { sizes: [], regions: [] }
const fake = { sizesDown: false, refuse: new Set(), droplets: {}, nextId: 7000 }
const doCalls = []
async function fakeDO(cfg) {
  const m = String(cfg.method || 'get').toUpperCase()
  const u = String(cfg.url || '').replace(/^https:\/\/api\.digitalocean\.com\/v2/, '')
  const data = typeof cfg.data === 'string' ? JSON.parse(cfg.data) : cfg.data
  doCalls.push({ m, u, data })
  if (m === 'GET' && u.startsWith('/sizes')) return fake.sizesDown ? { status: 503, data: { message: 'unavailable' } } : { status: 200, data: { sizes: CAT.sizes, links: {} } }
  if (m === 'GET' && u.startsWith('/regions')) return { status: 200, data: { regions: CAT.regions } }
  if (m === 'POST' && u === '/droplets') {
    if (fake.refuse.has(`${data.size}@${data.region}`)) return { status: 422, data: { id: 'unprocessable_entity', message: 'Size is not available in this region.' } }
    const id = fake.nextId++
    fake.droplets[id] = { id, name: data.name, status: 'new', size_slug: data.size, region: { slug: data.region }, networks: { v4: [] }, tags: data.tags || [] }
    return { status: 202, data: { droplet: fake.droplets[id] } }
  }
  return { status: 404, data: { message: `fake DO: no route ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
const realAxios = require('axios')
function stubAxios(cfg) { return /digitalocean\.com/.test(String(cfg && cfg.url)) ? fakeDO(cfg) : realAxios(cfg) }
Object.assign(stubAxios, realAxios)
stubAxios.create = (defaults = {}) => ({
  defaults, interceptors: { request: { use() {} }, response: { use() {} } },
  request: async (cfg) => {
    const r = await fakeDO({ ...cfg, url: (defaults.baseURL || '') + cfg.url })
    if (r.status >= 400) { const e = new Error(`Request failed with status code ${r.status}`); e.response = r; throw e }
    return r
  },
})
require.cache[axiosPath].exports = stubAxios

const sizeCatalog = require('../do-size-catalog')
const rdp = require('../digitalocean-rdp-service')
const vps = require('../digitalocean-service')
const vmSetup = require('../vm-instance-setup')
const stockWatch = require('../do-stock-watch')
const { createResellerApi } = require('../reseller-api')
const LANGS = { en: require('../lang/en.js').en, fr: require('../lang/fr.js').fr, hi: require('../lang/hi.js').hi, zh: require('../lang/zh.js').zh }

// Bot helpers live inside _index.js (not exported) → evaluate their exact source.
const indexSrc = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
const grab = (re) => { const m = indexSrc.match(re); if (!m) throw new Error(`not found in _index.js: ${re}`); return m[0] }
const botHelpers = new Function('require', [
  grab(/const isRdpRecord = .*\n/), grab(/const asKind = .*\n/),
  grab(/const vpsPlanInStock = async \(vpsDetails\) => \{[\s\S]*?\n\}\n/).replace("require('./vps-provider')", `require(${JSON.stringify(path.join(__dirname, '../vps-provider'))})`).replace("require('./do-size-catalog')", `require(${JSON.stringify(path.join(__dirname, '../do-size-catalog'))})`),
  'return { isRdpRecord, asKind, vpsPlanInStock }',
].join('\n'))(require)

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 45000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(250) } return false }

// ── Catalogue fixtures ───────────────────────────────────────────────────
CAT.regions = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['nyc3', 'New York 3'], ['sfo2', 'San Francisco 2'], ['sfo3', 'San Francisco 3'], ['tor1', 'Toronto 1'],
  ['lon1', 'London 1'], ['fra1', 'Frankfurt 1'], ['ams3', 'Amsterdam 3'], ['blr1', 'Bangalore 1'], ['sgp1', 'Singapore 1'], ['syd1', 'Sydney 1']].map(([slug, name]) => ({ slug, name, available: true }))
const S = (slug, vcpus, gb, disk, price, regions, description) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description, available: true, regions })
const AMD = (rs) => [S('s-2vcpu-4gb-amd', 2, 4, 80, 28, rs, 'Basic AMD'), S('s-4vcpu-8gb-amd', 4, 8, 160, 56, rs, 'Basic AMD'), S('s-8vcpu-16gb-amd', 8, 16, 320, 112, rs, 'Basic AMD')]
const INTEL = (rs) => [S('s-2vcpu-4gb-intel', 2, 4, 80, 28, rs, 'Premium Intel'), S('s-4vcpu-8gb-intel', 4, 8, 160, 56, rs, 'Premium Intel'), S('s-8vcpu-16gb-intel', 8, 16, 320, 112, rs, 'Premium Intel')]
const BASIC = (rs) => [S('s-2vcpu-4gb', 2, 4, 80, 24, rs, 'Basic'), S('s-4vcpu-8gb', 4, 8, 160, 48, rs, 'Basic'), S('s-8vcpu-16gb', 8, 16, 320, 96, rs, 'Basic')]
const ALL_BUT_NY = ['sfo3', 'lon1', 'fra1', 'ams3', 'blr1', 'sgp1', 'syd1']
const EVERYWHERE = ['nyc1', 'nyc2', 'nyc3', ...ALL_BUT_NY]
async function setCatalog(sizes) { CAT.sizes = sizes; await sizeCatalog.refresh({ force: true }); await sizeCatalog.refresh({ force: true }) }
const nyc = (r) => ['nyc1', 'nyc2', 'nyc3'].includes(r)

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_do_stock_${Date.now()}`)
  const hooks = []
  const receiver = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { hooks.push(JSON.parse(b)) } catch (_) {} res.end('ok') }) })
  await new Promise(r => receiver.listen(0, r))
  let server = null
  try {
    // ── 1. Live catalogue: refresh, persistence, DigitalOcean unreachable ──
    console.log('\n── 1: live catalogue (15-min refresh, Mongo copy, keeps last good copy) ──')
    sizeCatalog.init(db, { autoRefresh: false })
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])
    const st1 = sizeCatalog.getState()
    ok('refresh pulls GET /v2/sizes + /v2/regions → live catalogue', st1.loaded && st1.source === 'live' && st1.sizes === 6 && doCalls.some(c => c.u.startsWith('/regions')), st1)
    ok('refresh interval is 15 minutes', st1.refresh_interval_seconds === 900)
    ok('same-city datacenters come from DigitalOcean region names (nyc3 → nyc1, nyc2)', JSON.stringify(sizeCatalog.sameCityOf('nyc3')) === '["nyc1","nyc2"]' && JSON.stringify(sizeCatalog.sameCityOf('fra1')) === '[]')
    await sleep(100)
    const persisted = await db.collection('doSizeCatalog').findOne({ _id: 'live' })
    ok('catalogue persisted to Mongo doSizeCatalog', persisted && persisted.sizes.length === 6 && persisted.regions.length === CAT.regions.length)
    fake.sizesDown = true
    const r1 = await sizeCatalog.refresh({ force: true })
    ok('DigitalOcean unreachable → refresh fails but the last good copy is KEPT', r1 === false && sizeCatalog.isLoaded() && sizeCatalog.getState().last_error && sizeCatalog.isAvailable('s-2vcpu-4gb-amd', 'nyc3') === true)
    fake.sizesDown = false
    sizeCatalog._resetForTest(); sizeCatalog.init(db, { autoRefresh: false }); await sizeCatalog._loadFromDb()
    ok('after a restart the last good copy is loaded from Mongo (source db)', sizeCatalog.isLoaded() && sizeCatalog.getState().source === 'db' && sizeCatalog.isAvailable('s-4vcpu-8gb-amd', 'lon1') === true)
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])

    // ── 2. AMD only + same-city fallback ──
    console.log('\n── 2: RDP = AMD only, chosen datacenter → same-city datacenter ──')
    await setCatalog([...AMD(['nyc1', 'fra1', 'lon1']), ...INTEL(['nyc3', 'nyc2', 'tor1']), ...BASIC(['nyc3', 'nyc1', 'nyc2', 'tor1'])])
    let q = rdp.quoteFor('standard-1m', 'nyc3')
    ok('nyc3 has only Intel/Basic → built on the SAME AMD size in nyc1 (same city)', q.in_stock && q.build_region === 'nyc1' && q.size_slug === 's-2vcpu-4gb-amd' && q.same_city === true && q.price_factor === 1, q)
    const opts = rdp.TIERS.flatMap(t => rdp.buildOptions(t, 'nyc3'))
    ok('every build option for New York is an AMD size in a New York datacenter (never Intel / Basic)', opts.length > 0 && opts.every(o => /-amd$/.test(o.size) && nyc(o.region)), opts)
    q = rdp.quoteFor('pro-1m', 'tor1')
    ok('Toronto has no AMD → closest match: same-spec Premium Intel in tor1, same price, flagged', q.in_stock && q.build_region === 'tor1' && q.size_slug === 's-4vcpu-8gb-intel' && q.closest_match === true && q.price_factor === 1 && rdp.isProductAvailable('pro-1m', 'CA'), q)
    ok('closest match never uses a shared Basic size', rdp.TIERS.flatMap(t => rdp.buildOptions(t, 'tor1')).every(o => /-intel$/.test(o.size)))
    ok('New York quote with AMD in nyc1 is NOT a closest match', rdp.quoteFor('standard-1m', 'nyc3').closest_match === false)
    ok('in-place resize in nyc3 (no AMD) → Premium Intel; nyc1 → AMD', rdp.TIERS.every(t => rdp.sizeCandidatesFor(t, 'nyc3').every(x => /-intel$/.test(x))) && JSON.stringify(rdp.sizeCandidatesFor(rdp.TIERS[1], 'nyc1')) === '["s-4vcpu-8gb-amd"]')
    await setCatalog([...AMD(['nyc3', 'nyc1'])])
    q = rdp.quoteFor('power-1m', 'nyc3')
    ok('same price in nyc3 and nyc1 → the chosen datacenter (nyc3) wins', q.build_region === 'nyc3' && q.same_city === false, q)
    await setCatalog([...AMD(['nyc2'])])
    q = rdp.quoteFor('standard-1m', 'US')
    ok('AMD only in nyc2 → region code US (nyc3) builds in nyc2', q.in_stock && q.build_region === 'nyc2', q)
    sizeCatalog.markRefused('s-2vcpu-4gb-amd', 'nyc2', 'Size is not available in this region.')
    ok('a size DigitalOcean just refused (422) is skipped for 30 min → out of stock', !rdp.isProductAvailable('standard-1m', 'US') && rdp.isProductAvailable('pro-1m', 'US'))
    sizeCatalog._resetForTest(); sizeCatalog.init(db, { autoRefresh: false })

    // ── 3. City sold out → blocked before payment + suggestions ──
    console.log('\n── 3: no AMD or Premium Intel in the whole city → blocked BEFORE payment, other cities suggested ──')
    await setCatalog([...AMD(['fra1', 'lon1']), ...BASIC(EVERYWHERE)])
    ok('isProductAvailable(standard-1m, US) = false', rdp.isProductAvailable('standard-1m', 'US') === false)
    ok('bot plan list for New York is empty (nothing to buy)', rdp.listProducts('nyc3', true).length === 0)
    const flagged = rdp.listProducts('nyc3', true, undefined, { includeOutOfStock: true })
    ok('includeOutOfStock lists every plan flagged inStock:false', flagged.length === 9 && flagged.every(p => p.inStock === false))
    ok('bot pre-payment gate: RDP New York → blocked; RDP Frankfurt → allowed',
      (await botHelpers.vpsPlanInStock({ isRDP: true, config: { _id: 'standard-1m' }, zone: 'nyc3' })) === false && (await botHelpers.vpsPlanInStock({ isRDP: true, config: { _id: 'standard-1m' }, zone: 'fra1' })) === true)
    const sugg = await vmSetup.fetchRegionsWithStock(true)
    ok('suggested cities = only where AMD RDP is in stock (Frankfurt, London)', sugg.length === 2 && sugg.some(s => /Frankfurt/.test(s)) && sugg.some(s => /London/.test(s)) && !sugg.some(s => /New York|Toronto/.test(s)), sugg)
    const cfgs = await vmSetup.fetchAvailableVPSConfigs('t', { region: 'nyc3', isRDP: true })
    ok('bot RDP config step returns [] for a sold-out city (→ vpsOutOfStock screen)', Array.isArray(cfgs) && cfgs.length === 0, cfgs)
    let threw = null
    try { await rdp.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'ws2022' }) } catch (e) { threw = e }
    ok('createInstance refuses (code out_of_stock) before anything is created', threw && threw.code === 'out_of_stock' && !doCalls.some(c => c.m === 'POST'), threw && threw.message)
    // Bot wiring: the gate runs before the payment screen and before the wallet debit.
    const planPay = indexSrc.slice(indexSrc.indexOf("if (!(await vpsPlanInStock(info.vpsDetails))) return goto.vpsOutOfStock()"))
    ok('bot: stock gate runs BEFORE the payment-method screen', planPay.length > 0 && planPay.indexOf("checkoutScreen('vps-plan-pay'") > 0 && planPay.indexOf("checkoutScreen('vps-plan-pay'") < 200)
    const walletPay = indexSrc.slice(indexSrc.indexOf("'vps-plan-pay': async coin => {"))
    const gateAt = walletPay.indexOf('if (!(await vpsPlanInStock(vpsDetails))) return goto.vpsOutOfStock()')
    const debitAt = walletPay.indexOf("atomicIncrement(walletOf, chatId, 'usdOut', priceUsd)")
    ok('bot: wallet payment re-checks stock BEFORE debiting', gateAt > 0 && debitAt > gateAt)
    ok('bot: sold-out screen sends planOutOfStock(isRDP, region, suggestions) and asks for the region again',
      /vpsOutOfStock: async \(\) => \{[\s\S]{0,700}fetchRegionsWithStock\(isRDP\)[\s\S]{0,400}vp\.planOutOfStock\(isRDP, here, suggestions\)[\s\S]{0,80}goto\.askRegionForVps\(\)/.test(indexSrc))

    // ── 4. +15% cap, passed on in the price ──
    console.log('\n── 4: pricier same-spec AMD size (≤ +15%) → price passed on; above +15% → out of stock ──')
    const PRICEY = (price) => [S('s-2vcpu-4gb-160gb-amd', 2, 4, 160, price, ['nyc1'], 'Basic AMD'), S('s-2vcpu-4gb-amd', 2, 4, 80, 28, ALL_BUT_NY, 'Basic AMD'),
      S('s-4vcpu-8gb-amd', 4, 8, 160, 56, EVERYWHERE, 'Basic AMD'), S('s-8vcpu-16gb-amd', 8, 16, 320, 112, EVERYWHERE, 'Basic AMD')]
    await setCatalog(PRICEY(32))
    q = rdp.quoteFor('standard-1m', 'US')
    ok('$32 AMD size (+14.3%) in nyc1 is used for Standard New York', q.in_stock && q.size_slug === 's-2vcpu-4gb-160gb-amd' && q.build_region === 'nyc1' && q.do_cost === 32, q)
    const p1 = rdp.calculatePrice('standard-1m', 'US'), p3 = rdp.calculatePrice('standard-3m', 'US')
    ok('customer price includes it: 1 month $64 (+$8), 3 months $163.20', p1.totalWithMarkup === 64 && p1.regionSurcharge === 8 && p3.totalWithMarkup === 163.2, { p1: p1.totalWithMarkup, s: p1.regionSurcharge, p3: p3.totalWithMarkup })
    ok('Frankfurt (normal AMD size) stays at the base $56', rdp.calculatePrice('standard-1m', 'EU').totalWithMarkup === 56 && rdp.calculatePrice('standard-1m', 'EU').regionSurcharge === 0)
    const av = rdp.availability().find(r => r.region === 'US').plans.find(p => p.plan === 'standard')
    ok('availability(): US standard price $64, base $56, surcharge 14.3%, same-city fallback', av.price_usd === 64 && av.base_price_usd === 56 && av.surcharge_pct === 14.3 && av.same_city_fallback === true, av)
    const botCfg = (await vmSetup.fetchAvailableVPSConfigs('t', { region: 'nyc3', isRDP: true })).find(c => /^standard/.test(c._id))
    const cyc = Object.fromEntries((botCfg.billingCycles || []).map(c => [c.period, c.price]))
    ok('bot shows the passed-on price ($64 / $115.20 / $163.20) and carries maxDoCost=32 to the build', botCfg.monthlyPrice === 64 && cyc[1] === 64 && cyc[2] === 115.2 && cyc[3] === 163.2 && botCfg.maxDoCost === 32, { m: botCfg.monthlyPrice, cyc, max: botCfg.maxDoCost })
    ok('cap respected: with a quote of $28 the $32 size is never used', rdp.buildOptions(rdp.TIERS[0], 'nyc3', { maxCost: 28 }).length === 0)
    threw = null
    try { await rdp.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'ws2022', maxDoCost: 28 }) } catch (e) { threw = e }
    ok('order quoted at the base price is refused (out_of_stock) rather than built on the pricier size', threw && threw.code === 'out_of_stock', threw && threw.message)
    await setCatalog(PRICEY(33))
    ok('$33 AMD size (+17.9%) is over the 15% cap → Standard New York out of stock', rdp.isProductAvailable('standard-1m', 'US') === false && rdp.MAX_SIZE_COST_FACTOR === 1.15)

    // ── 5. Reseller API: stock, 409, active-only webhook, refund on failure ──
    console.log('\n── 5: reseller API — availability, 409 out_of_stock, rdp.provisioned only when up, refund + rdp.provision_failed ──')
    const OWNER = '900900977', KEY = 'test-stock-raw-key'
    await db.collection('resellerApiKeys').insertOne({ _id: 'k-stock', keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), ownerChatId: OWNER, enabled: true, scopes: ['*'], webhookUrl: `http://127.0.0.1:${receiver.address().port}/hook` })
    await db.collection('walletOf').insertOne({ _id: OWNER, usdIn: 1000, usdOut: 0 })
    const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: OWNER }); return Math.round((w.usdIn - w.usdOut) * 100) / 100 }
    const express = require('express')
    const app = express(); app.use(express.json())
    app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }))
    server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
    const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
    const api = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }

    await setCatalog([...AMD(['fra1', 'lon1'])])
    let r = await api('GET', '/rdp/availability?region=US')
    ok('GET /rdp/availability?region=US → AMD, out of stock, catalogue freshness', r.status === 200 && r.body.cpu === 'AMD' && r.body.regions[0].in_stock === false && r.body.catalog && r.body.catalog.source === 'live', r.body)
    r = await api('GET', '/rdp/plans?region=US')
    ok('GET /rdp/plans lists sold-out plans flagged in_stock:false', r.status === 200 && r.body.plans.length === 9 && r.body.plans.every(p => p.in_stock === false && p.out_of_stock === true))
    const jobsBefore = await db.collection('resellerProvisionJobs').countDocuments()
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('POST /rdp sold out → 409 out_of_stock with available_regions (EU, UK)', r.status === 409 && r.body.error === 'out_of_stock' && JSON.stringify(r.body.available_regions.sort()) === '["EU","UK"]', r.body)
    ok('409 → nothing charged, no job created', (await bal()) === 1000 && (await db.collection('resellerProvisionJobs').countDocuments()) === jobsBefore)

    // Stub the provider build (no real droplets) — reseller-api drives it through the module exports.
    const builds = {}, created = [], cancelled = []
    let nextCreate = 'ok'
    const realCreate = rdp.createInstance
    rdp.createInstance = rdp.createInstanceWithFallback = async (o) => {
      created.push(o)
      if (nextCreate === 'throw_oos') { const e = new Error('Standard — Windows RDP is out of stock in United States (New York) right now'); e.code = 'out_of_stock'; throw e }
      const id = `rdp-${crypto.randomUUID()}`
      builds[id] = { status: 'building', mainIp: null, region: 'nyc1', logs: [{ message: 'Creating droplet...' }] }
      return { instanceId: id, status: 'provisioning', mainIp: null }
    }
    const realGet = rdp.getInstance, realCancel = rdp.cancelInstance
    rdp.getInstance = async (id) => builds[id] ? { ...builds[id] } : { status: 'unknown', mainIp: null }
    rdp.cancelInstance = async (id, o) => { cancelled.push({ id, reason: o && o.reason }); if (builds[id]) builds[id].status = 'destroyed' }

    // A build started by ANOTHER host (e.g. production, sharing this jobs collection) must never be judged here.
    await db.collection('resellerProvisionJobs').insertOne({ _id: 'job-other-host', product: 'rdp', ownerChatId: OWNER, vpsId: 'vps-other-host', priceUsd: 56, charged: true, mode: 'live',
      status: 'awaiting_provider', instanceId: 'rdp-built-elsewhere', buildHost: 'some-other-pod', awaitingSince: new Date(Date.now() - 5 * 3600000), createdAt: new Date(), request: { isRDP: true, plan: 'Standard', region: 'US' } })
    await setCatalog(PRICEY(32))
    r = await api('GET', '/rdp/plans?region=US')
    const std = r.body.plans.find(p => p.plan_id === 'standard-1m')
    ok('GET /rdp/plans shows the passed-on price: $64, surcharge_usd 8, same_city_fallback', std && std.in_stock && std.price_usd === 64 && std.surcharge_usd === 8 && std.same_city_fallback === true, std)
    const ok1 = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('POST /rdp → 202 provisioning, charged the quoted $64', ok1.status === 202 && ok1.body.status === 'provisioning' && ok1.body.price_usd === 64 && (await bal()) === 936, ok1.body)
    await waitFor(async () => created.length === 1)
    ok('build gets maxDoCost=32 (never a pricier size than quoted)', created[0] && created[0].maxDoCost === 32, created[0])
    const fail1 = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    await waitFor(async () => created.length === 2)
    await sleep(1500)
    const job1 = await api('GET', `/jobs/${ok1.body.job_id}`)
    const rec1 = await db.collection('vpsPlansOf').findOne({ _id: ok1.body.id })
    ok('accepted by the provider but not up yet → job + record stay provisioning, NO rdp.provisioned yet',
      job1.body.status === 'provisioning' && rec1.provisionState === 'provisioning' && !hooks.some(h => h.event === 'rdp.provisioned'), { job: job1.body.status, rec: rec1.provisionState, hooks: hooks.map(h => h.event) })
    // Now the first server comes up, the second one fails for lack of AMD capacity.
    builds[rec1.instanceId].status = 'active'; builds[rec1.instanceId].mainIp = '198.51.100.7'
    const rec2 = await db.collection('vpsPlansOf').findOne({ _id: fail1.body.id })
    builds[rec2.instanceId].status = 'failed'
    builds[rec2.instanceId].logs.push({ message: 'Provisioning error: no AMD capacity for this plan in United States (New York) right now (tried s-2vcpu-4gb-160gb-amd@nyc1)' })
    await waitFor(async () => hooks.some(h => h.event === 'rdp.provisioned') && hooks.some(h => h.event === 'rdp.provision_failed'))
    const okHook = hooks.find(h => h.event === 'rdp.provisioned')
    ok('rdp.provisioned fires once the server is UP, with its IP + datacenter', okHook && okHook.data.id === ok1.body.id && okHook.data.ip === '198.51.100.7' && okHook.data.datacenter === 'nyc1', okHook)
    const rec1b = await db.collection('vpsPlansOf').findOne({ _id: ok1.body.id })
    const job1b = await api('GET', `/jobs/${ok1.body.job_id}`)
    ok('record RUNNING/active with expiry, job provisioned', rec1b.status === 'RUNNING' && rec1b.provisionState === 'active' && rec1b.end_time && job1b.body.status === 'provisioned', { s: rec1b.status, p: rec1b.provisionState, j: job1b.body.status })
    const failHook = hooks.find(h => h.event === 'rdp.provision_failed')
    ok('build failure → rdp.provision_failed (reason_code out_of_stock, refunded:true)', failHook && failHook.data.id === fail1.body.id && failHook.data.reason_code === 'out_of_stock' && failHook.data.refunded === true, failHook)
    const job2 = await api('GET', `/jobs/${fail1.body.job_id}`)
    const rec2b = await db.collection('vpsPlansOf').findOne({ _id: fail1.body.id })
    ok('failed order: refunded in full ($936 balance), job failed refunded, half-built server cleaned up',
      (await bal()) === 936 && job2.body.status === 'failed' && job2.body.refunded === true && rec2b.provisionState === 'failed' && cancelled.some(c => c.id === rec2.instanceId), { bal: await bal(), job: job2.body, cancelled })
    nextCreate = 'throw_oos'
    const fail2 = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    await waitFor(async () => hooks.some(h => h.event === 'rdp.provision_failed' && h.data.id === fail2.body.id))
    const failHook2 = hooks.find(h => h.event === 'rdp.provision_failed' && h.data.id === fail2.body.id)
    ok('provider refuses at create (out_of_stock) → refunded + rdp.provision_failed reason_code out_of_stock', failHook2 && failHook2.data.reason_code === 'out_of_stock' && failHook2.data.refunded === true && (await bal()) === 936, failHook2)
    ok('exactly one rdp.provisioned in total (never for failed orders)', hooks.filter(h => h.event === 'rdp.provisioned').length === 1)
    const other = await db.collection('resellerProvisionJobs').findOne({ _id: 'job-other-host' })
    ok('a build owned by another host is left alone (not failed/refunded from a pod that cannot see it)', other.status === 'awaiting_provider' && !hooks.some(h => h.data.id === 'vps-other-host') && (await bal()) === 936, other.status)
    rdp.createInstance = realCreate; rdp.createInstanceWithFallback = realCreate; rdp.getInstance = realGet; rdp.cancelInstance = realCancel

    // ── 6. VPS: exact size only, same-city datacenter, else blocked ──
    console.log('\n── 6: VPS — same size in a same-city datacenter, never another CPU type ──')
    await setCatalog([...BASIC(['nyc1', 'fra1']), ...AMD(['nyc3'])])
    ok('s-2vcpu-4gb missing in nyc3 → nyc1 (same city) builds it', JSON.stringify(vps.buildRegionsFor('s-2vcpu-4gb', 'US-central')) === '["nyc1"]' && vps.isProductAvailable('s-2vcpu-4gb', 'US-central'))
    ok('in-place ops (exactRegion) only count nyc3 itself', vps.isProductAvailable('s-2vcpu-4gb', 'US-central', { exactRegion: true }) === false)
    await setCatalog([...BASIC(['fra1']), ...AMD(['nyc3'])])
    ok('s-2vcpu-4gb in no New York datacenter → out of stock (bot gate blocks; AMD is NOT substituted)',
      vps.isProductAvailable('s-2vcpu-4gb', 'US-central') === false && (await botHelpers.vpsPlanInStock({ isRDP: false, config: { _id: 's-2vcpu-4gb' }, zone: 'US-central' })) === false && !vps.listProducts('US-central', false).some(p => p.productId === 's-2vcpu-4gb'))
    doCalls.length = 0; threw = null
    try { await vps.createInstance({ productId: 's-2vcpu-4gb', regionSlug: 'US-central', osId: 'ubuntu-24-04-x64' }) } catch (e) { threw = e }
    ok('VPS createInstance refuses with out_of_stock and creates nothing', threw && threw.code === 'out_of_stock' && !doCalls.some(c => c.m === 'POST'), threw && threw.message)
    await setCatalog([...BASIC(['nyc3', 'nyc1', 'nyc2'])])
    fake.refuse = new Set(['s-2vcpu-4gb@nyc3'])
    doCalls.length = 0
    const v1 = await vps.createInstance({ productId: 's-2vcpu-4gb', regionSlug: 'US-central', osId: 'ubuntu-24-04-x64' })
    const posts = doCalls.filter(c => c.m === 'POST' && c.u === '/droplets')
    ok('422 in nyc3 → the SAME size is created in nyc1', v1.region === 'nyc1' && posts.length === 2 && posts.every(p => p.data.size === 's-2vcpu-4gb') && posts[1].data.region === 'nyc1', posts.map(p => `${p.data.size}@${p.data.region}`))
    ok('the refused size is skipped for 30 min', sizeCatalog.isRefused('s-2vcpu-4gb', 'nyc3'))
    fake.refuse = new Set(['s-4vcpu-8gb@nyc3', 's-4vcpu-8gb@nyc1', 's-4vcpu-8gb@nyc2'])
    doCalls.length = 0; threw = null
    try { await vps.createInstance({ productId: 's-4vcpu-8gb', regionSlug: 'US-central', osId: 'ubuntu-24-04-x64' }) } catch (e) { threw = e }
    const posts2 = doCalls.filter(c => c.m === 'POST' && c.u === '/droplets')
    ok('whole city refuses → out_of_stock after trying only the same size in nyc3/nyc1/nyc2', threw && threw.code === 'out_of_stock' && posts2.length === 3 && posts2.every(p => p.data.size === 's-4vcpu-8gb'), posts2.map(p => `${p.data.size}@${p.data.region}`))
    ok('stock-outs are not counted as provider failures (circuit breaker untouched)', vps.getCircuitState().failures === 0 && vps.isProvisioningHealthy() === true, vps.getCircuitState())
    fake.refuse = new Set()

    // ── 7. Customer wording: RDP is never called VPS ──
    console.log('\n── 7: product-correct wording (RDP vs VPS) in all 4 languages ──')
    const { asKind, isRdpRecord } = botHelpers
    ok('isRdpRecord: isRDP / digitalocean-rdp / rdp-* id / Windows → RDP; DO Linux → VPS',
      [{ isRDP: true }, { provider: 'digitalocean-rdp' }, { instanceId: 'rdp-1' }, { osType: 'Windows' }].every(isRdpRecord) && !isRdpRecord({ isRDP: false, provider: 'digitalocean', instanceId: 'do-1', osType: 'Linux' }))
    ok('asKind swaps VPS → RDP for RDP, keeps the "VPS/RDP" menu path, leaves VPS text alone',
      asKind('Your VPS is ready. Open VPS/RDP → Manage.', true) === 'Your RDP is ready. Open VPS/RDP → Manage.' && asKind('Your VPS is ready.', false) === 'Your VPS is ready.')
    for (const [lang, L] of Object.entries(LANGS)) {
      const rdpMsg = L.vp.planOutOfStock(true, '🇺🇸 United States (New York)', ['🇩🇪 Germany (Frankfurt)'])
      const vpsMsg = L.vp.planOutOfStock(false, '🇺🇸 US', [])
      ok(`${lang}: RDP sold-out says "Windows RDP" + AMD, never "VPS", lists the suggestion`, /Windows RDP/.test(rdpMsg) && /AMD/.test(rdpMsg) && !/\bVPS\b/.test(rdpMsg) && /Frankfurt/.test(rdpMsg))
      ok(`${lang}: VPS sold-out says "VPS", never "RDP"/"AMD"`, /\bVPS\b/.test(vpsMsg) && !/RDP|AMD/.test(vpsMsg))
      const scheduler = ['util_1', 'util_2', 'util_3', 'util_4', 'util_5', 'util_6', 'util_7', 'util_8', 'wh_13', 'wh_23'].map(k => asKind(L.t[k]('Box', 'a', 'b', 'c', 'd', 'e', 'f'), true))
      ok(`${lang}: renewal/expiry/refund notices for an RDP never say "VPS" (menu path aside)`, scheduler.every(m => !/\bVPS\b(?!\s*\/\s*RDP)/.test(m)), scheduler.find(m => /\bVPS\b(?!\s*\/\s*RDP)/.test(m)))
      ok(`${lang}: purchase-error message names RDP for an RDP plan`, /RDP/.test(L.vp.errorPurchasingVPS('Standard', true)) && !/\bVPS\b/.test(L.vp.errorPurchasingVPS('Standard', true)))
    }

    // ── 8. Admin stock-change alerts ──
    console.log('\n── 8: admin alerts when a plan goes out of stock / comes back ──')
    const col = db.collection('doSizeCatalog')
    const sent = []
    const notify = (m) => sent.push(m)
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    const t0 = Date.now()
    const at = (min) => new Date(t0 + min * 60000)
    let w = await stockWatch.check({ col, notify, now: at(0) })
    ok('first run stores a baseline (one short summary of what is sold out now: Toronto RDP)', w.baseline === true && sent.length === 1 && /Stock watch on/.test(sent[0]) && /🔴 RDP Toronto: all plans/.test(sent[0]) && sent[0].split('\n').length <= 5, sent[0])
    sent.length = 0
    w = await stockWatch.check({ col, notify, now: at(1) })
    ok('no change → no alert', w.changed === 0 && sent.length === 0)
    await setCatalog([...AMD(ALL_BUT_NY), ...BASIC(EVERYWHERE), ...INTEL(ALL_BUT_NY)])
    w = await stockWatch.check({ col, notify, now: at(2) })
    ok('AMD gone in New York → NOT announced yet (unconfirmed, waiting 30 min)', sent.length === 0 && w.changed === 0 && w.pending >= 3, w)
    w = await stockWatch.check({ col, notify, now: at(17) })
    ok('still gone 15 min later → still waiting', sent.length === 0 && w.pending >= 3, w)
    w = await stockWatch.check({ col, notify, now: at(32) })
    ok('held 30 min → ONE short alert: RDP New York all plans out (+ the VPS AMD sizes)',
      sent.length === 1 && ['standard', 'pro', 'power'].every(t => w.wentOut.includes(`rdp|nyc3|${t}`)) && /Stock change/.test(sent[0]) && /🔴 RDP New York: all plans/.test(sent[0]) && /🔴 VPS .*AMD/.test(sent[0]) && !w.cameBack.length && !/s-2vcpu-4gb-amd/.test(sent[0]), sent[0])
    sent.length = 0
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    w = await stockWatch.check({ col, notify, now: at(40) })
    ok('back → waits 30 min too', sent.length === 0 && w.pending >= 3, w)
    const [wa, wb] = await Promise.all([stockWatch.check({ col, notify, now: at(71) }), stockWatch.check({ col, notify, now: at(71) })])
    ok('back in stock (held 30 min) → exactly ONE alert even with two pods checking at once', sent.length === 1 && /🟢 RDP New York: all plans/.test(sent[0]) && [wa, wb].filter(x => x.cameBack && x.cameBack.includes('rdp|nyc3|standard')).length === 1, { sent, wa, wb })
    sent.length = 0
    // DigitalOcean flapping (2026-10-14 RCA): gone → back 5 min later → gone again → never announced
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])
    w = await stockWatch.check({ col, notify, now: at(80) })
    ok('flap: Intel sizes vanish → waiting', sent.length === 0 && w.pending > 0, w)
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    w = await stockWatch.check({ col, notify, now: at(85) })
    ok('flap: back 5 min later → dropped as a blip, nothing sent', sent.length === 0 && w.pending === 0 && w.blips > 0, w)
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])
    await stockWatch.check({ col, notify, now: at(90) })
    w = await stockWatch.check({ col, notify, now: at(115) })
    ok('flap: gone again → the 30 min restart from the latest flip (25 min held → still silent)', sent.length === 0 && w.pending > 0, w)
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    w = await stockWatch.check({ col, notify, now: at(118) })
    ok('flap: back before 30 min → blip, the admin never saw any of it', sent.length === 0 && w.pending === 0, w)
    sent.length = 0
    sizeCatalog._setForTest(CAT.sizes, CAT.regions, { source: 'live', fetchedAt: new Date(Date.now() - 3 * 3600000) })
    fake.sizesDown = true
    await sizeCatalog.refresh({ force: true })
    const s1 = stockWatch.staleCheck(notify), s2 = stockWatch.staleCheck(notify)
    w = await stockWatch.check({ col, notify })
    ok('DigitalOcean unreachable 2h+ → one "catalogue unreachable" alert, no stock alerts from stale data', /unreachable/.test(s1 || '') && s2 === null && w.skipped === 'no_live_catalogue' && sent.length === 1)
    fake.sizesDown = false
    await sizeCatalog.refresh({ force: true })
    ok('catalogue reachable again → recovery notice', /reachable again/.test(stockWatch.staleCheck(notify) || ''))
    sent.length = 0
    stockWatch._resetForTest()
    ok('start() wires the watcher to every catalogue refresh', stockWatch.start(db, { notify }) === true)
    await setCatalog([...AMD(ALL_BUT_NY), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    await sleep(500)
    ok('a refresh that changes stock does NOT alert at once, and books a 5-min re-check', !sent.length && stockWatch._scheduleRecheck() === false, sent)
    const savedConfirm = stockWatch._timing.confirmMs
    stockWatch._timing.confirmMs = 0
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE), ...INTEL(EVERYWHERE)])
    await sleep(500)
    await setCatalog([...AMD(ALL_BUT_NY), ...BASIC(EVERYWHERE), ...INTEL(ALL_BUT_NY)])
    await waitFor(async () => sent.some(m => /🔴 RDP New York/.test(m)), 5000)
    stockWatch._timing.confirmMs = savedConfirm
    ok('a confirmed change after a refresh alerts the admin automatically', sent.some(m => /Stock change/.test(m) && /🔴 RDP New York: all plans/.test(m)), sent)
    stockWatch._resetForTest()
  } catch (e) {
    fail++; console.log('  ❌ suite crashed:', e.stack || e.message)
  } finally {
    if (server) await new Promise(r => server.close(r))
    receiver.close()
    await db.dropDatabase().catch(() => {})
    await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} DO stock / AMD fallback suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
