// RDP golden-image auto-copy to every build datacenter, honest per-city deploy ETAs (reseller API),
// RDP reinstall that copies the image first, bot Linux "Reinstall OS" (2026-10-14 owner decisions).
// FAKE DigitalOcean (axios stubbed), isolated local MongoDB DB, in-process reseller API + webhook receiver.
//   node js/tests/test_reinstall_eta_golden_copy_2026-10.js
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.NODE_ENV = 'test'
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '15000'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
process.env.SKIP_WEBHOOK_SYNC = 'true'
delete process.env.RESELLER_PROVISION_WORKER
delete process.env.RESELLER_JOB_ENV
const { MongoClient } = require('mongodb')

// ── Fake DigitalOcean ──
const CAT = { sizes: [], regions: [] }
const IMG = {}                       // image id → { id, name, regions }
const XFER = { delay: {}, fail: new Set(), posts: [] }
const ACT = {}                       // action id → { status, doneAt, onDone }
const rebuilds = []
let actSeq = 1000
async function fakeDO(cfg) {
  const m = String(cfg.method || 'get').toUpperCase()
  const u = String(cfg.url || '').replace(/^https:\/\/api\.digitalocean\.com\/v2/, '')
  const body = typeof cfg.data === 'string' ? JSON.parse(cfg.data || '{}') : (cfg.data || {})
  if (m === 'GET' && u.startsWith('/sizes')) return { status: 200, data: { sizes: CAT.sizes, links: {} } }
  if (m === 'GET' && u.startsWith('/regions')) return { status: 200, data: { regions: CAT.regions } }
  let mm
  if (m === 'GET' && (mm = u.match(/^\/images\/(\d+)$/))) return IMG[mm[1]] ? { status: 200, data: { image: IMG[mm[1]] } } : { status: 404, data: { message: 'not found' } }
  if (m === 'GET' && u.startsWith('/images')) return { status: 200, data: { images: [] } }
  if (m === 'POST' && (mm = u.match(/^\/images\/(\d+)\/actions$/))) {
    const id = String(++actSeq), img = IMG[mm[1]], region = body.region
    XFER.posts.push({ image: mm[1], region })
    const fail = XFER.fail.has(region)
    ACT[id] = { status: 'in-progress', doneAt: Date.now() + (XFER.delay[region] ?? 150), result: fail ? 'errored' : 'completed', onDone: () => { if (!fail && img && !img.regions.includes(region)) img.regions.push(region) } }
    return { status: 201, data: { action: { id: Number(id), status: 'in-progress' } } }
  }
  if (m === 'GET' && (mm = u.match(/^\/actions\/(\d+)$/))) {
    const a = ACT[mm[1]]
    if (!a) return { status: 404, data: {} }
    if (a.status === 'in-progress' && Date.now() >= a.doneAt) { a.status = a.result; a.onDone() }
    return { status: 200, data: { action: { id: Number(mm[1]), status: a.status } } }
  }
  if (m === 'POST' && (mm = u.match(/^\/droplets\/(\d+)\/actions$/))) {
    const id = String(++actSeq)
    if (body.type === 'rebuild') rebuilds.push({ droplet: mm[1], image: String(body.image) })
    ACT[id] = { status: 'completed', doneAt: 0, result: 'completed', onDone: () => {} }
    return { status: 201, data: { action: { id: Number(id), status: 'completed' } } }
  }
  return { status: 404, data: { message: `fake DO: no route ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
const realAxios = require('axios')
function stubAxios(cfg) { return /digitalocean\.com/.test(String(cfg && cfg.url)) ? fakeDO(cfg) : realAxios(cfg) }
Object.assign(stubAxios, realAxios)
stubAxios.create = (defaults = {}) => ({ defaults, interceptors: { request: { use() {} }, response: { use() {} } }, request: async (cfg) => fakeDO({ ...cfg, url: (defaults.baseURL || '') + cfg.url }) })
require.cache[axiosPath].exports = stubAxios

const sizeCatalog = require('../do-size-catalog')
const rdp = require('../digitalocean-rdp-service')
const linuxReinstall = require('../vps-linux-reinstall')
const sshPw = require('../vps-ssh-password')
const vps = require('../digitalocean-service')
const { translation } = require('../translation')
const { createResellerApi } = require('../reseller-api')
const LANGS = { en: require('../lang/en.js').en, fr: require('../lang/fr.js').fr, hi: require('../lang/hi.js').hi, zh: require('../lang/zh.js').zh }

const indexSrc = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
const grab = (re) => { const m = indexSrc.match(re); if (!m) throw new Error(`not found in _index.js: ${re}`); return m[0] }
const req2 = (m) => require(m.startsWith('./') ? path.join(__dirname, '..', m) : m)

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50) } return false }

CAT.regions = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['nyc3', 'New York 3'], ['sfo3', 'San Francisco 3'], ['tor1', 'Toronto 1'], ['lon1', 'London 1'], ['fra1', 'Frankfurt 1'],
  ['ams3', 'Amsterdam 3'], ['blr1', 'Bangalore 1'], ['sgp1', 'Singapore 1'], ['syd1', 'Sydney 1']].map(([slug, name]) => ({ slug, name, available: true }))
const S = (slug, vcpus, gb, disk, price, regions) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description: 'Basic AMD', available: true, regions })
const ALL_BUT_NY = ['sfo3', 'lon1', 'fra1', 'ams3', 'blr1', 'sgp1', 'syd1']
const LIVE_NY = ['nyc1', 'nyc2', ...ALL_BUT_NY] // DigitalOcean today: AMD in New York 1 + 2, none in nyc3 / Toronto
const AMD = (rs) => [S('s-2vcpu-4gb-amd', 2, 4, 80, 28, rs), S('s-4vcpu-8gb-amd', 4, 8, 160, 56, rs), S('s-8vcpu-16gb-amd', 8, 16, 320, 112, rs)]
async function setCatalog(sizes) { CAT.sizes = sizes; await sizeCatalog.refresh({ force: true }) }
const GOLD = { ws2019: '501', ws2022: '502', ws2025: '503' }

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_reinstall_eta_${Date.now()}`)
  const hooks = []
  const receiver = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { hooks.push({ path: req.url, ...JSON.parse(b) }) } catch (_) {} res.end('ok') }) })
  await new Promise(r => receiver.listen(0, r))
  const servers = [receiver]
  try {
    Object.assign(rdp._timing, { actionPoll: 20, importPoll: 20, transferMaxMin: 0.02, rdpMaxMin: 0.01, rdpPoll: 30 })
    sizeCatalog.init(db, { autoRefresh: false })
    await setCatalog(AMD(LIVE_NY))
    const sent = [], adminMsgs = [], events = []
    const plans = db.collection('vpsPlansOf'), state = db.collection('state')
    const handleRdpReinstallEvent = new Function('require', 'resellerDb', 'db', 'state', 'send', 'translation', 'log',
      grab(/const handleRdpReinstallEvent = async \(ev\) => \{[\s\S]*?\n\}\n/) + '\nreturn handleRdpReinstallEvent')(
      req2, null, db, state, (chatId, text, opts) => sent.push({ chatId: String(chatId), text, opts }), translation, () => {})
    rdp.init(db, { notifyAdmin: (m) => adminMsgs.push(m), onReinstallEvent: async (ev) => { events.push(ev); await handleRdpReinstallEvent(ev) } })
    await sleep(100)
    const osCol = db.collection('doRdpOsOptions'), srvCol = db.collection('doRdpServers')
    for (const [os, id] of Object.entries(GOLD)) {
      IMG[id] = { id: Number(id), name: `golden-${os}-1`, regions: ['nyc3', ...ALL_BUT_NY] }
      await osCol.updateOne({ _id: os }, { $set: { golden_status: 'available', golden_image_id: Number(id), golden_regions: ['nyc3', ...ALL_BUT_NY], golden_min_disk_gb: 32 } }, { upsert: true })
    }

    // Reseller API (live, isolated DB)
    const OWNER = '900901001', KEY = 'test-reinstall-raw-key'
    await db.collection('resellerApiKeys').insertOne({ _id: 'k-r', keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), ownerChatId: OWNER, enabled: true, scopes: ['*'], webhookUrl: `http://127.0.0.1:${receiver.address().port}/hook` })
    await db.collection('walletOf').insertOne({ _id: OWNER, usdIn: 1000, usdOut: 0 })
    const apiApp = require('express')(); apiApp.use(require('express').json())
    apiApp.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }))
    const apiSrv = await new Promise(r => { const s = apiApp.listen(0, () => r(s)) }); servers.push(apiSrv)
    const api = async (method, p, body) => { const r = await fetch(`http://127.0.0.1:${apiSrv.address().port}/reseller/v1${p}`, { method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }
    const realCreate = rdp.createInstance
    rdp.createInstance = rdp.createInstanceWithFallback = async () => ({ instanceId: `rdp-${crypto.randomUUID()}`, status: 'provisioning', mainIp: null, etaMinutes: 45 })

    // ── 1. Honest deploy ETA per city BEFORE the images are copied (New York builds in nyc1, image only in nyc3) ──
    console.log('\n── 1: reseller ETAs follow the datacenter an order is really built in ──')
    let r = await api('GET', '/rdp/availability')
    const us = r.body.regions.find(x => x.region === 'US'), eu = r.body.regions.find(x => x.region === 'EU')
    ok('GET /rdp/availability: New York deploy_eta_minutes 45/45/45 (image not in nyc1 yet), Frankfurt 3/3/5', JSON.stringify(us.deploy_eta_minutes) === JSON.stringify({ ws2019: 45, ws2022: 45, ws2025: 45 }) && JSON.stringify(eu.deploy_eta_minutes) === JSON.stringify({ ws2019: 3, ws2022: 3, ws2025: 5 }), { us: us.deploy_eta_minutes, eu: eu.deploy_eta_minutes })
    r = await api('GET', '/rdp/os-options')
    const ws22 = (r.body.os_options || []).find(o => o.id === 'ws2022')
    ok('GET /rdp/os-options: eta_minutes_by_region US 45 · EU 3 · UK 3', ws22 && ws22.eta_minutes_by_region.US === 45 && ws22.eta_minutes_by_region.EU === 3 && ws22.eta_minutes_by_region.UK === 3, ws22)
    r = await api('GET', '/rdp/plans?region=US')
    const p22 = (r.body.os_options || []).find(o => o.id === 'ws2022')
    ok('GET /rdp/plans?region=US: eta_minutes_in_region 45, fast_deploy_in_region false', p22 && p22.eta_minutes_in_region === 45 && p22.fast_deploy_in_region === false, p22)
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('POST /rdp New York → 202 with the real ~45 min ETA (eta_seconds ≈ 2700, not 180)', r.status === 202 && r.body.eta_seconds > 2600 && r.body.eta_seconds <= 2700, { s: r.status, eta: r.body && r.body.eta_seconds })
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'EU', os: 'ws2025' })
    ok('POST /rdp Frankfurt ws2025 → eta_seconds ≈ 300', r.status === 202 && r.body.eta_seconds > 200 && r.body.eta_seconds <= 300, r.body && r.body.eta_seconds)
    ok('bot edition picker for a New York order also says ⏳ ~45 min', (await rdp.listOsOptionsForRegion('nyc3')).every(o => !o.fast_deploy && o.eta_minutes === 45))

    // ── 2. Auto-copy the images to every build datacenter ──
    console.log('\n── 2: images copied automatically to every datacenter an order can be built in ──')
    ok('build sites = every datacenter selling AMD for a sold city (nyc1, nyc2, …; not nyc3 / tor1)', JSON.stringify(rdp.goldenBuildSites().sort()) === JSON.stringify([...LIVE_NY].sort()), rdp.goldenBuildSites())
    let q = await rdp.ensureGoldenAtBuildSites()
    ok('queues one copy per edition × missing datacenter (3 × nyc1/nyc2)', JSON.stringify(q.queued.sort()) === JSON.stringify(['ws2019@nyc1', 'ws2019@nyc2', 'ws2022@nyc1', 'ws2022@nyc2', 'ws2025@nyc1', 'ws2025@nyc2']), q.queued)
    q = await rdp.ensureGoldenAtBuildSites()
    ok('a second check while copies run queues nothing (no duplicate transfers)', q.queued.length === 0, q.queued)
    await waitFor(async () => (await Promise.all(Object.keys(GOLD).map(id => osCol.findOne({ _id: id })))).every(o => o.golden_regions.includes('nyc1') && o.golden_regions.includes('nyc2')))
    ok('exactly 6 transfer requests reached DigitalOcean', XFER.posts.length === 6, XFER.posts)
    ok('golden_regions now include nyc1 + nyc2 for all three editions', (await Promise.all(Object.keys(GOLD).map(id => osCol.findOne({ _id: id })))).every(o => o.golden_regions.includes('nyc1') && o.golden_regions.includes('nyc2')))
    ok('nothing left to copy → no new transfers', (await rdp.ensureGoldenAtBuildSites()).queued.length === 0 && XFER.posts.length === 6)
    const nyOs = await rdp.listOsOptionsForRegion('nyc3')
    ok('New York is fast now: ws2019 3 · ws2022 3 · ws2025 5 min', JSON.stringify(nyOs.map(o => [o.id, o.fast_deploy, o.eta_minutes])) === JSON.stringify([['ws2019', true, 3], ['ws2022', true, 3], ['ws2025', true, 5]]), nyOs)
    r = await api('GET', '/rdp/availability?region=US')
    ok('reseller availability follows: New York deploy_eta_minutes 3/3/5', JSON.stringify(r.body.regions[0].deploy_eta_minutes) === JSON.stringify({ ws2019: 3, ws2022: 3, ws2025: 5 }), r.body.regions[0].deploy_eta_minutes)
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('POST /rdp New York → eta_seconds ≈ 180 now', r.status === 202 && r.body.eta_seconds > 100 && r.body.eta_seconds <= 180, r.body && r.body.eta_seconds)
    // DigitalOcean starts selling AMD in Toronto, but the copy there fails → admin alerted, retried only after 6 h.
    XFER.fail.add('tor1')
    await setCatalog(AMD([...LIVE_NY, 'tor1']))
    q = await rdp.ensureGoldenAtBuildSites()
    ok('AMD appears in a new datacenter (tor1) → copies queued there automatically', q.queued.length === 3 && q.queued.every(k => k.endsWith('@tor1')), q.queued)
    await waitFor(() => adminMsgs.filter(m => /could not be copied to tor1/.test(m)).length >= 1, 5000)
    await waitFor(async () => (await rdp.ensureGoldenAtBuildSites()).queued.length === 0 && XFER.posts.filter(p => p.region === 'tor1').length === 3, 4000)
    await sleep(300)
    ok('a failed copy alerts the admin and is not re-queued on every refresh (6 h back-off)', adminMsgs.some(m => /could not be copied to tor1/.test(m)) && (await rdp.ensureGoldenAtBuildSites()).queued.length === 0 && XFER.posts.filter(p => p.region === 'tor1').length === 3, XFER.posts.filter(p => p.region === 'tor1'))
    rdp.createInstance = realCreate; rdp.createInstanceWithFallback = realCreate

    // ── 3. RDP reinstall when the image is not in the server's datacenter ──
    console.log('\n── 3: reinstall copies the image first, server untouched until then, then reinstalls by itself ──')
    let drop = 7000
    const server = async (region, extra = {}) => {
      const sid = crypto.randomUUID()
      await srvCol.insertOne({ server_id: sid, tier_slug: 'standard', os_id: 'ws2022', region, requested_region: region, do_droplet_id: ++drop, ip_address: `203.0.113.${drop % 250}`, status: 'active', logs: [], commands: [], created_at: new Date(Date.now() - 86400000), activated_at: new Date(Date.now() - 86000000), ...extra })
      return { sid, ext: `rdp-${sid}`, droplet: String(drop) }
    }
    await rdp.createSecret('pwd-bot-1', 'Bot-New-Pass-1')
    XFER.delay.sfo2 = 400
    const a = await server('sfo2')
    await plans.insertOne({ chatId: '7201', contaboInstanceId: a.ext, vpsId: a.ext, label: 'my-rdp', isRDP: true, provider: 'digitalocean-rdp', host: '203.0.113.1', status: 'RUNNING', rootPasswordSecretId: 'old-secret' })
    await state.insertOne({ _id: '7201', userLanguage: 'en' })
    const opts = await rdp.reinstallOptions(a.ext)
    ok('edition picker for this server: image not in sfo2 → ⏳ ~23 / 23 / 25 min, copy_first; current edition flagged', JSON.stringify(opts.map(o => [o.id, o.fast_deploy, o.copy_first, o.eta_minutes, o.current])) === JSON.stringify([['ws2019', false, true, 23, false], ['ws2022', false, true, 23, true], ['ws2025', false, true, 25, false]]), opts)
    const fr1 = await server('fra1')
    ok('… and for a Frankfurt server (image there) ⚡ 3 / 3 / 5 min', JSON.stringify((await rdp.reinstallOptions(fr1.ext)).map(o => [o.fast_deploy, o.eta_minutes])) === JSON.stringify([[true, 3], [true, 3], [true, 5]]))
    const rb0 = rebuilds.length
    const res = await rdp.reinstallInstance(a.ext, { osId: 'ws2019', rootPassword: 'pwd-bot-1' })
    ok('reinstall answers queued / copying_image with ETA 23 min, no password yet', res.queued === true && res.phase === 'copying_image' && res.etaMinutes === 23 && res.copyMinutes === 20 && res.password === null && res.osName === 'Windows Server 2019', res)
    let doc = await srvCol.findOne({ server_id: a.sid })
    ok('server untouched while copying: still active, ws2022, no rebuild sent, pending_reinstall saved', doc.status === 'active' && doc.os_id === 'ws2022' && rebuilds.length === rb0 && doc.pending_reinstall && doc.pending_reinstall.os_id === 'ws2019' && doc.pending_reinstall.root_password === 'pwd-bot-1', { st: doc.status, p: doc.pending_reinstall })
    ok('GET /rdp/:id provisioning shows reinstall_queued while copying', (rdp.provisioningStatus(doc).reinstall_queued || {}).os === 'ws2019' && rdp.provisioningStatus(doc).reinstall_queued.phase === 'copying_image')
    let threw = null
    try { await rdp.reinstallInstance(a.ext, { osId: 'ws2025' }) } catch (e) { threw = e }
    ok('a second reinstall while one is queued is refused', threw && /already queued/.test(threw.message), threw && threw.message)
    await waitFor(() => events.some(e => e.server_id === a.sid && e.type === 'started'))
    doc = await srvCol.findOne({ server_id: a.sid })
    const ev = events.find(e => e.server_id === a.sid)
    ok('after the copy: exactly one rebuild of THIS droplet from the ws2019 image', rebuilds.filter(x => x.droplet === a.droplet).length === 1 && rebuilds.find(x => x.droplet === a.droplet).image === GOLD.ws2019, rebuilds)
    ok('server now reinstalling ws2019, queue cleared, the bot-chosen password queued for the agent', ['reinstalling', 'booting', 'installing'].includes(doc.status) && doc.reinstall_started_at && doc.os_id === 'ws2019' && !doc.pending_reinstall && (doc.commands || []).some(c => c.type === 'set_password'), { st: doc.status, os: doc.os_id })
    ok('reinstall_started event carries the password + secret the bot created', ev && ev.type === 'started' && ev.password === 'Bot-New-Pass-1' && ev.secretId === 'pwd-bot-1' && ev.osName === 'Windows Server 2019' && ev.etaMinutes === 3, ev)
    await waitFor(() => sent.some(s => s.chatId === '7201'))
    const rec = await plans.findOne({ vpsId: a.ext })
    const m1 = sent.find(s => s.chatId === '7201')
    ok('bot customer DM when it starts: new password + edition + ~3 min', m1 && m1.text.includes('Bot-New-Pass-1') && m1.text.includes('Windows Server 2019') && /3 minutes/.test(m1.text), m1 && m1.text)
    ok('bot record updated only now (new password secret, ws2019, provisioning)', rec.rootPasswordSecretId === 'pwd-bot-1' && rec.osId === 'ws2019' && rec.status === 'provisioning' && !rec.reinstallQueued, rec)
    // copy fails → nothing changes, customer told
    XFER.fail.add('tor2')
    const b = await server('tor2')
    await plans.insertOne({ chatId: '7202', contaboInstanceId: b.ext, vpsId: b.ext, label: 'rdp-fr', isRDP: true, provider: 'digitalocean-rdp', status: 'RUNNING', rootPasswordSecretId: 'keep-me', reinstallQueued: { osId: 'ws2025' } })
    await state.insertOne({ _id: '7202', userLanguage: 'fr' })
    await rdp.reinstallInstance(b.ext, { osId: 'ws2025' })
    await waitFor(() => events.some(e => e.server_id === b.sid))
    doc = await srvCol.findOne({ server_id: b.sid })
    const evB = events.find(e => e.server_id === b.sid)
    ok('copy failed → reinstall_failed (image_copy_failed), no rebuild, server still active ws2022', evB.type === 'failed' && evB.reason === 'image_copy_failed' && !rebuilds.some(x => x.droplet === b.droplet) && doc.status === 'active' && doc.os_id === 'ws2022' && !doc.pending_reinstall, { evB, st: doc.status })
    await waitFor(() => sent.some(s => s.chatId === '7202'))
    const recB = await plans.findOne({ vpsId: b.ext })
    ok('customer told in French that nothing changed; password secret untouched', (sent.find(s => s.chatId === '7202') || {}).text?.includes("Rien n'a été modifié") && recB.rootPasswordSecretId === 'keep-me' && !recB.reinstallQueued, sent.find(s => s.chatId === '7202'))
    // server deleted while the image was copying → dropped
    XFER.delay.lon2 = 400
    const c = await server('lon2')
    await rdp.reinstallInstance(c.ext, { osId: 'ws2019' })
    await srvCol.updateOne({ server_id: c.sid }, { $set: { status: 'destroyed' } })
    await waitFor(() => events.some(e => e.server_id === c.sid))
    ok('server deleted during the copy → queued reinstall dropped (server_destroyed), no rebuild', events.find(e => e.server_id === c.sid).reason === 'server_destroyed' && !rebuilds.some(x => x.droplet === c.droplet))
    // restart during the copy → resumed, and two resumers rebuild only once
    const d = await server('sgp2', { pending_reinstall: { os_id: 'ws2022', root_password: null, source: null, queued_at: new Date(), eta_minutes: 23 } })
    XFER.delay.sgp2 = 300
    const n = await Promise.all([rdp.resumeQueuedReinstalls(), rdp.resumeQueuedReinstalls()])
    await waitFor(() => events.some(e => e.server_id === d.sid))
    await sleep(500)
    ok('restart during the copy: queued reinstall resumed from the DB and the server rebuilt exactly ONCE', n[0] >= 1 && rebuilds.filter(x => x.droplet === d.droplet).length === 1 && events.filter(e => e.server_id === d.sid).length === 1 && events.find(e => e.server_id === d.sid).type === 'started', { n, rb: rebuilds.filter(x => x.droplet === d.droplet).length })
    ok('the copy to sgp2 was requested once (shared by both resumers)', XFER.posts.filter(p => p.region === 'sgp2').length === 3 - 2, XFER.posts.filter(p => p.region === 'sgp2'))
    // image already in the datacenter → immediate rebuild as before
    const e1 = await server('fra1')
    const r2 = await rdp.reinstallInstance(e1.ext, { osId: 'ws2025' })
    ok('image already in the datacenter → immediate rebuild, password returned, ~5 min', !r2.queued && r2.password && r2.etaMinutes === 5 && rebuilds.some(x => x.droplet === e1.droplet), r2)

    // ── 4. Reseller reinstall: 202 copying_image → rdp.reinstall_started webhook ──
    console.log('\n── 4: reseller POST /rdp/:id/reinstall when the image must be copied first ──')
    XFER.delay.ams2 = 300
    const f = await server('ams2')
    await plans.insertOne({ _id: 'rr-1', vpsId: 'rr-1', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: f.ext, osId: 'ws2022', status: 'RUNNING', source: 'reseller_api', rootPasswordSecretId: f.sid })
    r = await api('POST', '/rdp/rr-1/reinstall', { os: 'ws2019' })
    ok('202 copying_image: password null, server_changed false, copy + total ETA', r.status === 202 && r.body.status === 'copying_image' && r.body.password === null && r.body.server_changed === false && r.body.copy_minutes === 20 && r.body.eta_minutes === 23, r.body)
    ok('record marked reinstallQueued, otherwise unchanged', (await plans.findOne({ _id: 'rr-1' })).reinstallQueued?.osId === 'ws2019' && (await plans.findOne({ _id: 'rr-1' })).osId === 'ws2022')
    await waitFor(() => hooks.some(h => h.event === 'rdp.reinstall_started'))
    const hk = hooks.find(h => h.event === 'rdp.reinstall_started')
    const recR = await plans.findOne({ _id: 'rr-1' })
    ok('rdp.reinstall_started webhook: os, eta_minutes, credentials_url', hk && hk.data.id === 'rr-1' && hk.data.os === 'ws2019' && hk.data.eta_minutes === 3 && hk.data.credentials_url === '/rdp/rr-1/credentials' && hk.data.server_changed === true, hk)
    ok('reseller record now ws2019 / reinstalling, queue flag cleared', recR.osId === 'ws2019' && recR.status === 'reinstalling' && !recR.reinstallQueued, recR)
    r = await api('GET', '/rdp/rr-1/credentials')
    ok('GET /rdp/:id/credentials returns the NEW password set at rebuild time', r.status === 200 && r.body.password && r.body.password === events.find(e => e.server_id === f.sid).password, { s: r.status, b: r.body })
    XFER.fail.add('blr2')
    const g = await server('blr2')
    await plans.insertOne({ _id: 'rr-2', vpsId: 'rr-2', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: g.ext, osId: 'ws2022', status: 'RUNNING', source: 'reseller_api' })
    r = await api('POST', '/rdp/rr-2/reinstall', { os: 'ws2025' })
    await waitFor(() => hooks.some(h => h.event === 'rdp.reinstall_failed'))
    const hf = hooks.find(h => h.event === 'rdp.reinstall_failed')
    ok('copy failed → rdp.reinstall_failed webhook (reason, server_changed false), record unchanged', r.status === 202 && hf && hf.data.id === 'rr-2' && hf.data.reason === 'image_copy_failed' && hf.data.server_changed === false && (await plans.findOne({ _id: 'rr-2' })).osId === 'ws2022', hf)
    ok('rdp.reinstall_started / _failed are registered webhook events', require('../reseller-webhooks').EVENTS.includes('rdp.reinstall_started') && require('../reseller-webhooks').EVENTS.includes('rdp.reinstall_failed'))

    // ── 5. Linux VPS reinstall (bot) ──
    console.log('\n── 5: bot Linux "Reinstall OS" — live list, same password + SSH key ──')
    Object.assign(linuxReinstall._timing, { firstWaitMs: 5, pollMs: 5, retryMs: 5, maxMs: 1500 })
    const calls = []
    const prov = { listImages: vps.listImages, getLinuxImage: vps.getLinuxImage,
      getSecretPassword: async (id) => (id === 'sec-1' ? 'Root-Pass-1' : null),
      reinstallInstance: async (id, o) => { calls.push({ id, o }); return { instanceId: id } },
      getInstance: async () => ({ status: 'running', mainIp: '198.51.100.7' }) }
    const keyless = { contaboInstanceId: 'do-123', osId: 'ubuntu-24-04-x64', host: '198.51.100.7', rootPasswordSecretId: 'sec-1' }
    const keyed = { ...keyless, sshKeySecretId: 'k-1' }
    const o1 = await linuxReinstall.options(keyless, prov), o2 = await linuxReinstall.options(keyed, prov)
    ok('OS list = DigitalOcean live list; key-less server hides SSH-key-only images; current flagged', !o1.some(o => o.requiresSshKey) && o1.some(o => o.id === 'debian-13-x64') && o2.some(o => o.id === 'rockylinux-10-x64' && o.requiresSshKey) && o1.find(o => o.id === 'ubuntu-24-04-x64').current && !o1.some(o => /debian-12/.test(o.id)), o1.map(o => o.id))
    let err = null
    try { await linuxReinstall.start({ rec: keyless, osId: 'rockylinux-10-x64', provider: prov, applyPassword: async () => ({ ok: true }) }) } catch (e) { err = e }
    ok('SSH-key-only image on a key-less server → ssh_key_required, nothing sent', err && err.code === 'ssh_key_required' && calls.length === 0)
    err = null
    try { await linuxReinstall.start({ rec: keyed, osId: 'debian-12-x64', provider: prov, applyPassword: async () => ({ ok: true }) }) } catch (e) { err = e }
    ok('retired image → invalid_os, nothing sent', err && err.code === 'invalid_os' && calls.length === 0)
    const applied = []
    let done = null
    const st = await linuxReinstall.start({ rec: keyed, osId: 'rockylinux-10-x64', provider: prov, privateKeys: ['KEY'], applyPassword: async (a) => { applied.push(a); return { ok: true, verified: true } }, onDone: (x) => { done = x } })
    ok('rebuild sent with ONLY the image (no new password / user_data)', calls.length === 1 && calls[0].id === 'do-123' && JSON.stringify(calls[0].o) === JSON.stringify({ osId: 'rockylinux-10-x64' }) && st.osName === 'Rocky Linux 10' && st.etaMinutes === 3, calls)
    await waitFor(() => done, 3000)
    ok('once back up: the SAME stored password is re-applied over SSH (after cloud-init), with the server key', applied.length === 1 && applied[0].newPassword === 'Root-Pass-1' && applied[0].waitForCloudInit === true && applied[0].host === '198.51.100.7' && applied[0].privateKeys[0] === 'KEY', applied)
    ok('onDone → ok, password shown again, username root', done && done.ok && done.passwordApplied && done.password === 'Root-Pass-1' && done.username === 'root' && done.osName === 'Rocky Linux 10', done)
    done = null
    await linuxReinstall.start({ rec: { ...keyed, rootPasswordSecretId: null }, osId: 'debian-13-x64', provider: prov, applyPassword: async () => { throw new Error('must not be called') }, onDone: (x) => { done = x } })
    await waitFor(() => done, 3000)
    ok('no stored password → done without touching SSH (customer pointed to SSH key / Show Password)', done && done.ok && !done.passwordApplied && done.password === null, done)
    done = null
    await linuxReinstall.start({ rec: keyed, osId: 'debian-13-x64', provider: prov, applyPassword: async () => ({ ok: false, error: 'auth' }), onDone: (x) => { done = x } })
    await waitFor(() => done, 4000)
    ok('password could not be re-applied → ok:false (bot tells customer + admin)', done && !done.ok && !done.passwordApplied && done.password === null, done)
    ok('SSH script waits for cloud-init only when asked', sshPw.buildPasswordScript('root', 'x', { waitForCloudInit: true }).includes('cloud-init status --wait') && !sshPw.buildPasswordScript('root', 'x').includes('cloud-init'))

    // ── 6. Bot wiring ──
    console.log('\n── 6: bot wiring + texts ──')
    ok('VPS details: 🔄 Reinstall OS only for DigitalOcean Linux (RDP keeps 🔄 Reinstall Windows)', /isDoLinux = !isRDP && require\('\.\/vps-provider'\)\.providerNameForRecord\(vpsData\) === 'digitalocean'/.test(indexSrc) && indexSrc.includes("[vp.revealPasswordBtn, vp.resetPasswordBtn, ...(isDoLinux ? [vp.reinstallOsBtn] : [])]"))
    ok('button → OS picker → confirm → start handlers exist', indexSrc.includes('if (message === vp.reinstallOsBtn) return goto.askReinstallLinuxOs()') && indexSrc.includes('if (action === a.askReinstallLinuxOs) {') && indexSrc.includes('if (action === a.confirmReinstallLinux) {') && indexSrc.includes("require('./vps-linux-reinstall').start({"))
    ok('Windows confirm handler handles a queued (copying) reinstall without touching the password record', indexSrc.includes('if (isDoRdp && reinstallResult?.queued) {') && indexSrc.includes('vp.windowsReinstallQueued(') && indexSrc.includes('reinstallOptions(vpsDetails.contaboInstanceId || vpsDetails._id)'))
    const linuxOsRows = new Function(grab(/const linuxOsRows = \(options, L\) => \{[\s\S]*?\n\}\n/) + '\nreturn linuxOsRows')()
    const rows = linuxOsRows(o2, LANGS.en.vp)
    ok('OS keyboard: 2 per row + cancel', rows.slice(0, -1).every(x => Array.isArray(x) && x.length <= 2) && rows[rows.length - 1] === LANGS.en.vp.cancel && rows.slice(0, -1).flat().length === o2.length)
    const sent2 = [], admin2 = []
    const notifyDone = new Function('send', 'translation', 'notifyAdmin', grab(/const notifyLinuxReinstallDone = \(chatId, lang, name, done\) => \{[\s\S]*?\n\}\n/) + '\nreturn notifyLinuxReinstallDone')((c, t) => sent2.push(t), translation, (m) => admin2.push(m))
    notifyDone('1', 'en', 'web-01', { ok: true, passwordApplied: true, ip: '198.51.100.7', username: 'root', password: 'Root-Pass-1', osName: 'Rocky Linux 10' })
    notifyDone('1', 'en', 'web-01', { ok: true, passwordApplied: false, ip: '198.51.100.7', username: 'root', password: null, osName: 'Debian 13' })
    notifyDone('1', 'en', 'web-01', { ok: false, passwordApplied: false, ip: '198.51.100.7', username: 'root', password: null, osName: 'Debian 13', error: 'auth' })
    ok('done messages: password shown (unchanged) / SSH-key hint / could-not-confirm + admin alert', sent2[0].includes('Root-Pass-1') && sent2[0].includes('unchanged') && /SSH key/.test(sent2[1]) && !sent2[1].includes('Root-Pass') && /could not confirm/.test(sent2[2]) && admin2.length === 1, sent2)
    const keys = ['reinstallOsBtn', 'linuxOsBtn', 'askReinstallLinuxOs', 'confirmReinstallLinuxText', 'linuxReinstallStarted', 'linuxReinstallDone', 'linuxReinstallDoneNoPassword', 'linuxReinstallDoneUnverified', 'linuxReinstallFailed', 'linuxReinstallNeedsKey', 'windowsReinstallQueued', 'windowsReinstallCopyFailed']
    ok('all new texts exist in en / fr / zh / hi', Object.values(LANGS).every(L => keys.every(k => L.vp[k] !== undefined)), Object.entries(LANGS).map(([l, L]) => [l, keys.filter(k => L.vp[k] === undefined)]))
    ok('edition button shows the real minutes (⏳ ~23 min while the image is copied)', LANGS.en.vp.rdpEditionBtn({ name: 'Windows Server 2019', fast_deploy: false, eta_minutes: 23 }) === '🪟 Windows Server 2019 ⏳ ~23 min' && LANGS.en.vp.rdpEditionBtn({ name: 'Windows Server 2022', fast_deploy: true, eta_minutes: 3 }) === '🪟 Windows Server 2022 ⚡ ~3 min')
    ok('confirm text mentions the copy only when needed', /copied to your server's datacenter/.test(LANGS.en.vp.confirmReinstallWindowsRdpText('s', 'WS', 23, true)) && !/copied/.test(LANGS.en.vp.confirmReinstallWindowsRdpText('s', 'WS', 3, false)))

    // ── 7. Docs ──
    const html = require('../apidoc-page').renderApiDocPage('https://example.test/reseller/v1')
    ok('docs: deploy_eta_minutes, eta_minutes_by_region, eta_minutes_in_region, copying_image, rdp.reinstall_started/_failed, auto-copy', ['deploy_eta_minutes', 'eta_minutes_by_region', 'eta_minutes_in_region', 'copying_image', 'rdp.reinstall_started', 'rdp.reinstall_failed', 'Deploy time (RDP)'].every(x => html.includes(x)))
  } catch (e) {
    fail++; console.log('  ❌ suite crashed:', e.stack || e.message)
  } finally {
    for (const s of servers) { try { s.close() } catch (_) {} }
    try { await db.dropDatabase() } catch (_) {}
    await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} Reinstall / ETA / golden auto-copy suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
