// Real DigitalOcean hardware type (Premium AMD / Premium Intel / Regular · NVMe SSD / SSD) on every VPS/RDP
// plan + server — reseller API (cpu_type / size_slug / hardware, cpu + storage_type unchanged) and the bot
// (plan list, order summary, My VPS/RDP screen). 2026-10-14.
// FAKE DigitalOcean (axios stubbed), isolated local MongoDB DB, in-process reseller API + webhook receiver.
//   node js/tests/test_do_hw_type_2026-10.js
const http = require('http')
const path = require('path')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.NODE_ENV = 'test'
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.VPS_MARKUP_PERCENT = '200'
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
process.env.SKIP_WEBHOOK_SYNC = 'true' // preview pod: jobs tagged env=preview, processed in the request path
delete process.env.RESELLER_PROVISION_WORKER
delete process.env.RESELLER_JOB_ENV
const { MongoClient } = require('mongodb')

// ── Fake DigitalOcean ──
const CAT = { sizes: [], regions: [], images: [] }
const DROPLETS = {}
async function fakeDO(cfg) {
  const m = String(cfg.method || 'get').toUpperCase()
  const u = String(cfg.url || '').replace(/^https:\/\/api\.digitalocean\.com\/v2/, '')
  if (m === 'GET' && u.startsWith('/sizes')) return { status: 200, data: { sizes: CAT.sizes, links: {} } }
  if (m === 'GET' && u.startsWith('/regions')) return { status: 200, data: { regions: CAT.regions } }
  if (m === 'GET' && u.startsWith('/images')) return { status: 200, data: { images: CAT.images } }
  const dm = /^\/droplets\/(\d+)/.exec(u)
  if (m === 'GET' && dm && DROPLETS[dm[1]]) return { status: 200, data: { droplet: DROPLETS[dm[1]] } }
  const err = new Error(`fake DO: no route ${m} ${u}`); err.response = { status: 404, data: { id: 'not_found', message: 'The resource you were accessing could not be found.' } }
  throw err
}
const axiosPath = require.resolve('axios')
const realAxios = require('axios')
function stubAxios(cfg) { return /digitalocean\.com/.test(String(cfg && cfg.url)) ? fakeDO(cfg) : realAxios(cfg) }
Object.assign(stubAxios, realAxios)
stubAxios.create = (defaults = {}) => ({ defaults, interceptors: { request: { use() {} }, response: { use() {} } }, request: async (cfg) => fakeDO({ ...cfg, url: (defaults.baseURL || '') + cfg.url }) })
require.cache[axiosPath].exports = stubAxios

const hw = require('../do-hw-type')
const sizeCatalog = require('../do-size-catalog')
const rdp = require('../digitalocean-rdp-service')
const vpsSvc = require('../digitalocean-service')
const vm = require('../vm-instance-setup')
const { createResellerApi } = require('../reseller-api')
const LANGS = { en: require('../lang/en.js').en, fr: require('../lang/fr.js').fr, hi: require('../lang/hi.js').hi, zh: require('../lang/zh.js').zh }

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100) } return false }

CAT.regions = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['nyc3', 'New York 3'], ['sfo3', 'San Francisco 3'], ['tor1', 'Toronto 1'], ['lon1', 'London 1'], ['fra1', 'Frankfurt 1'],
  ['ams3', 'Amsterdam 3'], ['blr1', 'Bangalore 1'], ['sgp1', 'Singapore 1'], ['syd1', 'Sydney 1']].map(([slug, name]) => ({ slug, name, available: true }))
const ALL = CAT.regions.map(r => r.slug)
const S = (slug, vcpus, gb, disk, price, regions, description) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description, available: true, regions })
const PRODUCTS = [...vpsSvc.PRODUCT_CATALOG_SSD, ...vpsSvc.PRODUCT_CATALOG_NVME]
const sizeOf = (p, rs) => S(p.productId, p.cpuCores, p.ramMb / 1024, p.diskMb / 1024, p.basePriceUsd, rs, /-amd$/.test(p.productId) ? 'Basic AMD' : /-intel$/.test(p.productId) ? 'Basic Intel' : 'Basic')
// Everything everywhere, except: the plain 2vCPU/4GB AMD size is NOT in Frankfurt — there the Standard RDP is
// built on a pricier same-spec AMD size (s-2vcpu-4gb-120gb-amd, +7%).
const BASE_SIZES = () => [
  ...PRODUCTS.map(p => sizeOf(p, p.productId === 's-2vcpu-4gb-amd' ? ALL.filter(r => r !== 'fra1') : ALL)),
  S('s-2vcpu-4gb-120gb-amd', 2, 4, 120, 30, ['fra1'], 'Basic AMD'),
]
async function setCatalog(sizes) { CAT.sizes = sizes; await sizeCatalog.refresh({ force: true }) }

;(async () => {
  console.log('\n── 1: do-hw-type ──')
  ok('AMD slug → Premium AMD · NVMe SSD', JSON.stringify(hw.apiFields('s-4vcpu-8gb-amd')) === JSON.stringify({ cpu_type: 'Premium AMD', size_slug: 's-4vcpu-8gb-amd', hardware: 'Premium AMD · NVMe SSD' }))
  ok('Intel slug → Premium Intel · NVMe SSD', hw.apiFields('s-8vcpu-16gb-480gb-intel').cpu_type === 'Premium Intel' && hw.apiFields('s-8vcpu-16gb-480gb-intel').hardware === 'Premium Intel · NVMe SSD')
  ok('plain Basic slug → Regular CPU · SSD (no brand claimed)', JSON.stringify(hw.apiFields('s-1vcpu-1gb')) === JSON.stringify({ cpu_type: 'Regular', size_slug: 's-1vcpu-1gb', hardware: 'Regular CPU · SSD' }) && hw.classOf('s-1vcpu-512mb-10gb').cpu_type === 'Regular')
  ok('unknown / non-DigitalOcean / empty → all null (never guessed)', ['g-2vcpu-8gb', 'Standard_D2as_v5', '', null, 'pro-1m'].every(s => JSON.stringify(hw.apiFields(s)) === JSON.stringify({ cpu_type: null, size_slug: null, hardware: null })))
  ok('case-insensitive, slug normalised', hw.apiFields('S-2VCPU-4GB-AMD').size_slug === 's-2vcpu-4gb-amd')
  ok('bot labels', hw.botLabel('s-2vcpu-4gb-amd') === '⚡ Premium AMD · NVMe SSD' && hw.botLabel('s-2vcpu-4gb-intel') === '⚡ Premium Intel · NVMe SSD' && hw.botLabel('s-2vcpu-4gb') === '💾 Regular CPU · SSD' && hw.botLabel('x') === null)
  ok('slugOfProduct: live RDP quote > do_size_slug > DO product id', hw.slugOfProduct({ do_size_slug: 's-2vcpu-4gb-amd', quote: { size_slug: 's-2vcpu-4gb-120gb-amd' } }) === 's-2vcpu-4gb-120gb-amd'
    && hw.slugOfProduct({ do_size_slug: 's-2vcpu-4gb-amd', quote: { size_slug: null } }) === 's-2vcpu-4gb-amd' && hw.slugOfProduct({ productId: 's-1vcpu-1gb' }) === 's-1vcpu-1gb' && hw.slugOfProduct({ productId: 'standard-1m' }) === null && hw.slugOfProduct(null) === null)

  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_hw_type_${Date.now()}`)
  const hooks = []
  const receiver = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { hooks.push({ path: req.url, ...JSON.parse(b) }) } catch (_) {} res.end('ok') }) })
  await new Promise(r => receiver.listen(0, r))
  const servers = [receiver]
  try {
    sizeCatalog.init(db, { autoRefresh: false })
    await setCatalog(BASE_SIZES())
    rdp.init(db, { notifyAdmin: () => {} })
    vm.initVpsDb(db)
    const srv = db.collection('doRdpServers'), plans = db.collection('vpsPlansOf')

    console.log('\n── 2: bot — plan list, order summary, My VPS/RDP screen (en/fr/zh/hi) ──')
    const nvme = await vm.fetchAvailableVPSConfigs('1', { region: 'UK', diskType: 'nvme' })
    const ssd = await vm.fetchAvailableVPSConfigs('1', { region: 'UK', diskType: 'ssd' })
    const rdpEU = await vm.fetchAvailableVPSConfigs('1', { region: 'EU', diskType: 'nvme', isRDP: true })
    ok('VPS NVMe configs carry ⚡ Premium AMD / Premium Intel, SSD configs 💾 Regular CPU · SSD',
      nvme.find(c => c._id === 's-2vcpu-4gb-amd').hardware === '⚡ Premium AMD · NVMe SSD' && nvme.find(c => c._id === 's-2vcpu-4gb-intel').hardware === '⚡ Premium Intel · NVMe SSD' && ssd.length === 6 && ssd.every(c => c.hardware === '💾 Regular CPU · SSD'), nvme.slice(0, 2))
    ok('RDP configs carry ⚡ Premium AMD · NVMe SSD (from the size quoted for the city)', rdpEU.length >= 3 && rdpEU.every(c => c.hardware === '⚡ Premium AMD · NVMe SSD'), rdpEU.map(c => c.hardware))
    for (const [lang, L] of Object.entries(LANGS)) {
      const listTxt = L.vp.askVpsConfig([...ssd.slice(0, 1), ...nvme.slice(0, 2)], {})
      const rdpTxt = L.vp.askVpsConfig(rdpEU, {})
      ok(`[${lang}] plan list shows the hardware line under every plan`, listTxt.includes('<i>💾 Regular CPU · SSD</i>') && listTxt.includes('<i>⚡ Premium AMD · NVMe SSD</i>') && (listTxt.match(/<i>(⚡|💾) /g) || []).length === 3 && (rdpTxt.match(/<i>⚡ Premium AMD · NVMe SSD<\/i>/g) || []).length === rdpEU.length, listTxt)
      const legacyRdp = L.vp.askVpsConfig(rdpEU.map(c => ({ ...c, hardware: undefined })), {})
      ok(`[${lang}] RDP plan list keeps its Premium AMD line when hardware is unknown`, (legacyRdp.match(/Premium AMD · NVMe SSD/g) || []).length === rdpEU.length)
      const cfg = nvme.find(c => c._id === 's-2vcpu-4gb-amd')
      const sum = L.vp.generateBillSummary({ config: cfg, plantotalPrice: cfg.monthlyPrice, totalPrice: cfg.monthlyPrice, isRDP: false, durationMonths: 1, regionName: 'Europe', os: { name: 'Ubuntu 24.04' } })
      ok(`[${lang}] order summary has a ⚙️ hardware line`, /⚙️ [^<]+<\/strong> ⚡ Premium AMD · NVMe SSD\n/.test(sum), sum.slice(0, 400))
      const sumNo = L.vp.generateBillSummary({ config: { ...cfg, hardware: null }, plantotalPrice: 1, totalPrice: 1, isRDP: false, durationMonths: 1, regionName: 'Europe', os: { name: 'Ubuntu' } })
      ok(`[${lang}] …and no hardware line when unknown`, !/⚙️/.test(sumNo))
      const det = { isRDP: true, name: 'rdp-x', planDetails: { name: 'Pro — Windows RDP', specs: { vCPU: 4, RAM: 8, disk: 160 } }, diskTypeDetails: { type: 'NVME' }, osDetails: { name: 'Windows' }, status: 'RUNNING', host: '203.0.113.5', hardware: '⚡ Premium Intel · NVMe SSD' }
      const detTxt = L.vp.selectedVpsData(det)
      ok(`[${lang}] My VPS/RDP screen shows the hardware right under the specs`, /\(NVME\)\n<strong>• [^<]+<\/strong> ⚡ Premium Intel · NVMe SSD\n/.test(detTxt), detTxt.slice(0, 300))
      ok(`[${lang}] …hidden when unknown`, !/Premium/.test(L.vp.selectedVpsData({ ...det, hardware: null })))
    }

    console.log('\n── 3: real built size — RDP getInstance / sizeSlugsFor / bot details ──')
    const sidAmd = crypto.randomUUID(), sidIntel = crypto.randomUUID(), sidOld = crypto.randomUUID()
    await srv.insertMany([
      { server_id: sidAmd, tier_slug: 'pro', product_id: 'pro-1m', os_id: 'ws2022', region: 'nyc2', do_size_slug: 's-4vcpu-8gb-amd', status: 'active', ip_address: '203.0.113.21', do_droplet_id: 7101, logs: [], created_at: new Date() },
      { server_id: sidIntel, tier_slug: 'power', product_id: 'power-1m', os_id: 'ws2022', region: 'fra1', do_size_slug: 's-8vcpu-16gb-intel', status: 'active', ip_address: '203.0.113.22', do_droplet_id: 7102, logs: [], created_at: new Date() },
      { server_id: sidOld, tier_slug: 'standard', product_id: 'standard-1m', os_id: 'ws2022', region: 'sfo3', status: 'active', ip_address: '203.0.113.23', do_droplet_id: 7103, logs: [], created_at: new Date() }, // no do_size_slug saved
    ])
    for (const [id, slug] of [[7101, 's-4vcpu-8gb-amd'], [7102, 's-8vcpu-16gb-intel'], [7103, 's-2vcpu-4gb-amd']]) DROPLETS[id] = { id, status: 'active', size_slug: slug, region: { slug: 'nyc2' }, networks: { v4: [{ type: 'public', ip_address: '203.0.113.2' }] } }
    const li = await rdp.getInstance(`rdp-${sidIntel}`)
    ok('RDP getInstance.sizeSlug = the size the droplet was ACTUALLY built on (legacy Intel box)', li.sizeSlug === 's-8vcpu-16gb-intel', li.sizeSlug)
    ok('…a server with no saved size falls back to its tier size', (await rdp.getInstance(`rdp-${sidOld}`)).sizeSlug === 's-2vcpu-4gb-amd')
    const map = await rdp.sizeSlugsFor([`rdp-${sidAmd}`, sidIntel, 'rdp-nope', null])
    ok('sizeSlugsFor: one query, both id forms, unknown ids absent', map.get(`rdp-${sidAmd}`) === 's-4vcpu-8gb-amd' && map.get(`rdp-${sidIntel}`) === 's-8vcpu-16gb-intel' && map.get(sidIntel) === 's-8vcpu-16gb-intel' && !map.has('rdp-nope'))
    await plans.insertOne({ chatId: '5001', vpsId: `rdp-${sidIntel}`, contaboInstanceId: `rdp-${sidIntel}`, isRDP: true, provider: 'digitalocean-rdp', productId: 'power-1m', status: 'RUNNING', osType: 'Windows' })
    const det = await vm.fetchVPSDetails('5001', `rdp-${sidIntel}`)
    ok('bot My RDP: legacy Intel server shows ⚡ Premium Intel · NVMe SSD (not the tier\'s AMD)', det && det.hardware === '⚡ Premium Intel · NVMe SSD', det && det.hardware)
    DROPLETS[7201] = { id: 7201, status: 'active', size_slug: 's-2vcpu-4gb', region: { slug: 'fra1' }, networks: { v4: [{ type: 'public', ip_address: '203.0.113.31' }] }, image: { slug: 'ubuntu-24-04-x64' }, name: 'web-01' }
    await plans.insertOne({ chatId: '5002', vpsId: 'do-7201', contaboInstanceId: 'do-7201', isRDP: false, provider: 'digitalocean', productId: 's-2vcpu-4gb-amd', status: 'RUNNING', osType: 'Linux' })
    const detV = await vm.fetchVPSDetails('5002', 'do-7201')
    ok('bot My VPS: reads the LIVE droplet size (resized to Regular) over the stored plan', detV && detV.hardware === '💾 Regular CPU · SSD', detV && detV.hardware)

    console.log('\n── 4: reseller API ──')
    const OWNER = '900900777', KEY = `rsk_hw_${crypto.randomBytes(8).toString('hex')}`
    await db.collection('resellerApiKeys').insertOne({ _id: 'k-hw', keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), ownerChatId: OWNER, enabled: true, scopes: ['*'], webhookUrl: `http://127.0.0.1:${receiver.address().port}/hook` })
    await db.collection('walletOf').insertOne({ _id: OWNER, usdIn: 5000, usdOut: 0 })
    const apiApp = require('express')(); apiApp.use(require('express').json())
    apiApp.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }))
    const apiSrv = await new Promise(r => { const s = apiApp.listen(0, () => r(s)) }); servers.push(apiSrv)
    const api = async (method, p, body) => { const r = await fetch(`http://127.0.0.1:${apiSrv.address().port}/reseller/v1${p}`, { method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }
    const FIELDS = ['cpu', 'storage_type', 'cpu_type', 'size_slug', 'hardware']
    const pick = (o) => FIELDS.map(k => o && o[k])

    let r = await api('GET', '/vps/plans?region=UK')
    const P = (id) => r.body.plans.find(p => p.plan_id === id)
    ok('GET /vps/plans: old fields unchanged + cpu_type / size_slug / hardware', r.status === 200
      && JSON.stringify(pick(P('s-1vcpu-1gb'))) === JSON.stringify(['Standard', 'SSD', 'Regular', 's-1vcpu-1gb', 'Regular CPU · SSD'])
      && JSON.stringify(pick(P('s-2vcpu-4gb-amd'))) === JSON.stringify(['AMD', 'NVMe SSD', 'Premium AMD', 's-2vcpu-4gb-amd', 'Premium AMD · NVMe SSD'])
      && JSON.stringify(pick(P('s-2vcpu-4gb-120gb-intel'))) === JSON.stringify(['Intel', 'NVMe SSD', 'Premium Intel', 's-2vcpu-4gb-120gb-intel', 'Premium Intel · NVMe SSD']), r.body && r.body.plans && r.body.plans.slice(0, 2))
    ok('every VPS plan has all 5 hardware fields filled', r.body.plans.length === 30 && r.body.plans.every(p => FIELDS.every(k => p[k])))
    r = await api('GET', '/rdp/plans?region=EU')
    const std = r.body.plans.find(p => p.plan_id === 'standard-1m'), pro = r.body.plans.find(p => p.plan_id === 'pro-1m')
    ok('GET /rdp/plans EU: Standard is built on the pricier same-spec size → size_slug shows it', std && std.size_slug === 's-2vcpu-4gb-120gb-amd' && std.cpu_type === 'Premium AMD' && std.cpu === 'AMD' && std.storage_type === 'NVMe SSD' && std.hardware === 'Premium AMD · NVMe SSD' && std.surcharge_usd > 0, std)
    ok('…Pro on its own size', pro && pro.size_slug === 's-4vcpu-8gb-amd' && pro.cpu_type === 'Premium AMD', pro)
    r = await api('GET', '/pricing?region=UK')
    ok('GET /pricing: VPS + RDP plans carry the new fields', r.status === 200 && r.body.vps.plans.every(p => p.cpu_type && p.hardware) && r.body.rdp.plans.every(p => p.cpu_type === 'Premium AMD'), r.body && r.body.rdp && r.body.rdp.plans && r.body.rdp.plans[0])
    await setCatalog(BASE_SIZES().map(s => (s.slug === 's-8vcpu-16gb-amd' ? { ...s, regions: s.regions.filter(x => x !== 'tor1') } : s)))
    r = await api('GET', '/rdp/availability?region=tor1')
    const tor = r.body.regions && r.body.regions[0]
    const pw = tor && tor.plans.find(p => p.plan === 'power'), st = tor && tor.plans.find(p => p.plan === 'standard')
    ok('GET /rdp/availability: cpu_type + hardware per plan; a sold-out plan keeps size_slug null', st && st.cpu_type === 'Premium AMD' && st.hardware === 'Premium AMD · NVMe SSD' && st.size_slug === 's-2vcpu-4gb-amd' && pw && pw.in_stock === false && pw.size_slug === null && pw.cpu_type === 'Premium AMD', tor && tor.plans)
    await setCatalog(BASE_SIZES())

    // Reseller-owned servers: list + get read the REAL size
    await plans.insertMany([
      { _id: 'r-amd', vpsId: 'r-amd', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: `rdp-${sidAmd}`, productId: 'pro-1m', plan: 'Pro', status: 'RUNNING', source: 'reseller_api' },
      { _id: 'r-intel', vpsId: 'r-intel', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: `rdp-${sidIntel}`, productId: 'power-1m', plan: 'Power', status: 'RUNNING', source: 'reseller_api' },
      { _id: 'r-pending', vpsId: 'r-pending', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: null, productId: 'standard-1m', plan: 'Standard', status: 'provisioning', provisionState: 'provisioning', source: 'reseller_api' },
      { _id: 'v-1', vpsId: 'v-1', chatId: OWNER, isRDP: false, provider: 'digitalocean', instanceId: 'do-7201', productId: 's-2vcpu-4gb-amd', plan: 'NVMe AMD', status: 'RUNNING', source: 'reseller_api' },
      { _id: 'v-2', vpsId: 'v-2', chatId: OWNER, isRDP: false, provider: 'digitalocean', instanceId: null, productId: 's-1vcpu-1gb', plan: 'Cloud VPS 10', status: 'provisioning', source: 'reseller_api' },
    ])
    r = await api('GET', '/rdp')
    const L = (id) => (r.body.rdp || []).find(x => x.id === id)
    ok('GET /rdp: each server reports the size it was built on (AMD box, legacy Intel box)', JSON.stringify(pick(L('r-amd'))) === JSON.stringify(['AMD', 'NVMe SSD', 'Premium AMD', 's-4vcpu-8gb-amd', 'Premium AMD · NVMe SSD'])
      && JSON.stringify(pick(L('r-intel'))) === JSON.stringify(['Intel', 'NVMe SSD', 'Premium Intel', 's-8vcpu-16gb-intel', 'Premium Intel · NVMe SSD']), r.body)
    ok('…a not-yet-built order shows its plan\'s default AMD size', L('r-pending') && L('r-pending').cpu_type === 'Premium AMD' && L('r-pending').size_slug === 's-2vcpu-4gb-amd', L('r-pending'))
    r = await api('GET', '/rdp/r-intel')
    ok('GET /rdp/:id: legacy Intel server → cpu Intel / Premium Intel (was reported AMD before)', r.status === 200 && r.body.cpu === 'Intel' && r.body.cpu_type === 'Premium Intel' && r.body.size_slug === 's-8vcpu-16gb-intel' && r.body.status !== 'destroyed', r.body && pick(r.body))
    r = await api('GET', '/vps/v-1')
    ok('GET /vps/:id: the LIVE droplet size wins (resized to Regular s-2vcpu-4gb)', r.status === 200 && JSON.stringify(pick(r.body)) === JSON.stringify(['Standard', 'SSD', 'Regular', 's-2vcpu-4gb', 'Regular CPU · SSD']), r.body && pick(r.body))
    r = await api('GET', '/vps')
    const vl = (id) => (r.body.vps || []).find(x => x.id === id)
    ok('GET /vps: plan size for each (no live call per row)', vl('v-1') && vl('v-1').cpu_type === 'Premium AMD' && vl('v-2') && vl('v-2').cpu_type === 'Regular' && vl('v-2').hardware === 'Regular CPU · SSD', r.body)

    // Orders: 202 shows the hardware being built; *.provisioned webhook + record carry the ACTUAL size
    console.log('\n── 5: orders — 202 response, rdp.provisioned / vps.provisioned webhooks ──')
    const realRdpCreate = rdp.createInstanceWithFallback
    rdp.createInstanceWithFallback = async (o) => {
      const sid = crypto.randomUUID()
      await srv.insertOne({ server_id: sid, tier_slug: 'standard', product_id: o.productId, os_id: 'ws2022', region: 'fra1', do_size_slug: 's-2vcpu-4gb-120gb-amd', status: 'active', ip_address: '203.0.113.41', do_droplet_id: 7301, logs: [], created_at: new Date() })
      DROPLETS[7301] = { id: 7301, status: 'active', size_slug: 's-2vcpu-4gb-120gb-amd', region: { slug: 'fra1' }, networks: { v4: [{ type: 'public', ip_address: '203.0.113.41' }] } }
      return { instanceId: `rdp-${sid}`, status: 'provisioning', mainIp: null }
    }
    hooks.length = 0
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'EU', os: 'ws2022' })
    ok('POST /rdp 202 → hardware it is being built on (the same-spec Frankfurt size)', r.status === 202 && r.body.cpu_type === 'Premium AMD' && r.body.size_slug === 's-2vcpu-4gb-120gb-amd' && r.body.hardware === 'Premium AMD · NVMe SSD' && r.body.cpu === 'AMD' && r.body.storage_type === 'NVMe SSD', r.body)
    await waitFor(async () => hooks.some(h => h.event === 'rdp.provisioned'), 15000)
    const hR = hooks.find(h => h.event === 'rdp.provisioned')
    ok('rdp.provisioned webhook data carries the 5 hardware fields of the size actually built', hR && JSON.stringify(pick(hR.data)) === JSON.stringify(['AMD', 'NVMe SSD', 'Premium AMD', 's-2vcpu-4gb-120gb-amd', 'Premium AMD · NVMe SSD']), hR && hR.data)
    const recR = await plans.findOne({ _id: r.body.id })
    ok('…and the record keeps do_size_slug for later list views', recR && recR.do_size_slug === 's-2vcpu-4gb-120gb-amd', recR && recR.do_size_slug)
    rdp.createInstanceWithFallback = realRdpCreate

    const realVpsCreate = vpsSvc.createInstance, realSecret = vpsSvc.createSecret
    vpsSvc.createSecret = async () => ({ secretId: 'sec-1' })
    vpsSvc.createInstance = async () => { DROPLETS[7401] = { id: 7401, status: 'active', size_slug: 's-1vcpu-1gb', region: { slug: 'fra1' }, networks: { v4: [{ type: 'public', ip_address: '203.0.113.51' }] } }; return { instanceId: 'do-7401', mainIp: null } }
    hooks.length = 0
    r = await api('POST', '/vps', { plan_id: 's-1vcpu-1gb', region: 'EU', hostname: 'hw-test-01' })
    ok('POST /vps 202 → Regular CPU · SSD', r.status === 202 && r.body.cpu_type === 'Regular' && r.body.size_slug === 's-1vcpu-1gb' && r.body.hardware === 'Regular CPU · SSD' && r.body.cpu === 'Standard' && r.body.storage_type === 'SSD', r.body)
    await waitFor(async () => hooks.some(h => h.event === 'vps.provisioned'), 15000)
    const hV = hooks.find(h => h.event === 'vps.provisioned')
    ok('vps.provisioned webhook carries the built droplet\'s hardware', hV && hV.data.cpu_type === 'Regular' && hV.data.size_slug === 's-1vcpu-1gb' && hV.data.hardware === 'Regular CPU · SSD', hV && hV.data)
    vpsSvc.createInstance = realVpsCreate; vpsSvc.createSecret = realSecret

    console.log('\n── 6: API docs ──')
    const html = require('../apidoc-page').renderApiDocPage('https://x/api/reseller/v1')
    ok('docs describe cpu_type / size_slug / hardware (plans, servers, webhooks, what\'s new)', /cpu_type/.test(html) && /Premium Intel · NVMe SSD/.test(html) && /Regular CPU · SSD/.test(html) && /size the server was ACTUALLY built on|size the box was actually built on/.test(html) && /Real hardware type on every VPS \/ RDP plan and server/.test(html))
  } catch (e) {
    fail++; console.log('  ❌ suite crashed:', e.stack || e.message)
  } finally {
    for (const s of servers) { try { s.close() } catch (_) {} }
    await db.dropDatabase().catch(() => {})
    await client.close()
  }
  console.log(`\n${fail ? '❌' : '✅'} hardware-type suite: ${pass} passed / ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
