// Golden-image builder for DigitalOcean Windows RDP — full phase machine with a
// FAKE DigitalOcean API (axios stubbed) against an isolated local MongoDB.
// Covers: build → qcow2 callback → custom-image import → register → cleanup →
// transfer, droplet-failure callback, resume after "restart", DO→Mongo sync
// (custom images only), fast-path selection, on-demand region transfer,
// createInstance ETA, listOsOptions, build-size fallback.
//   node js/tests/test_do_rdp_golden_2026-06.js
const net = require('net')
const http = require('http')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

// ── Stub axios BEFORE the service is required ─────────────────────────────
const calls = []
const fake = {
  droplets: {}, actions: {}, images: {}, volumes: {}, nextId: 1000, dropletStatusAfter: 1, unavailableSizes: [], regionSizes: null,
}
function reset() {
  fake.droplets = {}; fake.actions = {}; fake.images = {}; fake.volumes = {}; fake.nextId = 1000; fake.unavailableSizes = []; fake.regionSizes = null
  calls.length = 0
}
async function fakeDO({ method, url, data }) {
  const m = method.toUpperCase()
  const u = url.replace('https://api.digitalocean.com/v2', '')
  calls.push({ m, u, data })
  let mt
  if (m === 'GET' && u.startsWith('/account/keys')) return { status: 200, data: { ssh_keys: fake.sshKeys || [] } }
  if (m === 'POST' && u === '/account/keys') { const k = { id: 555, name: data.name, public_key: data.public_key }; fake.sshKeys = [k]; return { status: 201, data: { ssh_key: k } } }
  if (m === 'GET' && u.startsWith('/regions')) { if (!fake.regionSizes) return { status: 500, data: { message: 'regions down' } }; return { status: 200, data: { regions: [{ slug: 'nyc3', sizes: fake.regionSizes }] } } }
  if (m === 'POST' && u === '/volumes') { const id = `vol-${fake.nextId++}`; fake.volumes[id] = { id, name: data.name, region: { slug: data.region }, size_gigabytes: data.size_gigabytes, droplet_ids: [] }; return { status: 201, data: { volume: fake.volumes[id] } } }
  if (m === 'GET' && u.startsWith('/volumes?name=')) { const name = decodeURIComponent(u.match(/name=([^&]+)/)[1]); return { status: 200, data: { volumes: Object.values(fake.volumes).filter(v => v.name === name) } } }
  if (m === 'POST' && (mt = u.match(/^\/volumes\/([^/]+)\/actions$/))) { const v = fake.volumes[mt[1]]; if (!v) return { status: 404, data: { message: 'nf' } }; if (data.type === 'detach') v.droplet_ids = []; return { status: 202, data: { action: { id: fake.nextId++, status: 'completed' } } } }
  if (m === 'DELETE' && (mt = u.match(/^\/volumes\/([^/]+)$/))) { if (!fake.volumes[mt[1]]) return { status: 404, data: { message: 'nf' } }; if (fake.volumes[mt[1]].droplet_ids.length) return { status: 409, data: { message: 'attached' } }; delete fake.volumes[mt[1]]; return { status: 204, data: '' } }
  if (m === 'POST' && u === '/droplets') {
    if (fake.unavailableSizes.includes(data.size) || fake.unavailableSizes.includes(`${data.size}@${data.region}`)) return { status: 422, data: { message: 'Size is not available in this region.' } }
    const id = fake.nextId++
    for (const v of (data.volumes || [])) { if (!fake.volumes[v]) return { status: 422, data: { message: 'unknown volume' } }; fake.volumes[v].droplet_ids = [id] }
    fake.droplets[id] = { id, name: data.name, status: 'new', image: data.image, user_data: data.user_data, size_slug: data.size, region: { slug: data.region }, tags: data.tags || [], volumes: data.volumes || [], polls: 0, networks: { v4: [] } }
    return { status: 202, data: { droplet: { id } } }
  }
  if (m === 'GET' && u.startsWith('/droplets?tag_name=')) return { status: 200, data: { droplets: Object.values(fake.droplets) } }
  if (m === 'GET' && (mt = u.match(/^\/droplets\/(\d+)$/))) {
    const d = fake.droplets[mt[1]]
    if (!d) return { status: 404, data: { message: 'not found' } }
    d.polls++
    if (d.status === 'new' && d.polls >= fake.dropletStatusAfter) { d.status = 'active'; d.networks = { v4: [{ type: 'public', ip_address: '127.0.0.1' }] } }
    return { status: 200, data: { droplet: d } }
  }
  if (m === 'POST' && (mt = u.match(/^\/droplets\/(\d+)\/actions$/))) {
    const d = fake.droplets[mt[1]]
    if (!d) return { status: 404, data: { message: 'not found' } }
    const id = fake.nextId++
    fake.actions[id] = { id, status: 'completed', type: data.type }
    return { status: 201, data: { action: fake.actions[id] } }
  }
  if (m === 'DELETE' && (mt = u.match(/^\/droplets\/(\d+)$/))) { if (!fake.droplets[mt[1]]) return { status: 404, data: { message: 'nf' } }; for (const v of fake.droplets[mt[1]].volumes || []) { if (fake.volumes[v]) fake.volumes[v].droplet_ids = [] }; delete fake.droplets[mt[1]]; return { status: 204, data: '' } }
  if (m === 'GET' && (mt = u.match(/^\/actions\/(\d+)$/))) {
    const a = fake.actions[mt[1]]
    if (a && a.status === 'in-progress' && --a.done <= 0) {
      a.status = 'completed'
      if (a.type === 'transfer') fake.images[a.image].regions.push(a.region)
    }
    return { status: 200, data: { action: a || { id: mt[1], status: 'errored' } } }
  }
  // Custom-image import: NEW → available after 2 polls (or a scripted failure).
  if (m === 'POST' && u === '/images') {
    const id = fake.nextId++
    const stuck = (fake.stuckImports || 0) > 0; if (stuck) fake.stuckImports--
    fake.images[id] = { id, name: data.name, type: 'custom', distribution: data.distribution, status: fake.failImport ? 'deleted' : 'NEW', error_message: fake.failImport ? 'Unsupported image format' : '', regions: [data.region], min_disk_size: 32, size_gigabytes: 11.5, created_at: new Date().toISOString(), polls: 0, url: data.url, stuck }
    return { status: 202, data: { image: fake.images[id] } }
  }
  if (m === 'GET' && u.startsWith('/images?private=true')) return { status: 200, data: { images: Object.values(fake.images) } }
  if (m === 'GET' && (mt = u.match(/^\/images\/(\d+)$/))) {
    const img = fake.images[mt[1]]
    if (!img) return { status: 404, data: { message: 'nf' } }
    if (img.status === 'NEW' && !img.stuck && ++img.polls >= 2) img.status = 'available'
    return { status: 200, data: { image: img } }
  }
  if (m === 'DELETE' && (mt = u.match(/^\/images\/(\d+)$/))) { if (!fake.images[mt[1]]) return { status: 404, data: { message: 'nf' } }; delete fake.images[mt[1]]; return { status: 204, data: '' } }
  if (m === 'POST' && (mt = u.match(/^\/images\/(\d+)\/actions$/))) {
    const id = fake.nextId++
    if (fake.failTransferTo === data.region) { fake.actions[id] = { id, status: 'errored', type: 'transfer' }; return { status: 201, data: { action: fake.actions[id] } } }
    fake.actions[id] = { id, status: 'in-progress', done: 1, type: 'transfer', image: Number(mt[1]), region: data.region }
    return { status: 201, data: { action: fake.actions[id] } }
  }
  return { status: 500, data: { message: `unstubbed ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
require(axiosPath)
require.cache[axiosPath].exports = fakeDO

process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.SELF_URL = 'https://example.test/api'
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
const svc = require('../digitalocean-rdp-service.js')
// Shrink every poll interval so the whole machine runs in seconds.
Object.assign(svc._timing, { bootPoll: 20, rdpPoll: 40, actionPoll: 20, offPoll: 20, rdpMaxMin: 0.05, transferMaxMin: 0.05, buildMaxMin: 0.2, importPoll: 20, importMaxMin: 0.05, importRetryMin: 0.03, importRetries: 2, callbackGraceMs: 50, fastTargetMs: 400 })
const alerts = [] // admin Telegram alerts captured via the injected notifyAdmin

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const TEST_DB = 'do_rdp_golden_test'
let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(30) } return false }

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(TEST_DB)
  for (const c of ['doRdpServers', 'doRdpOsOptions', 'doRdpImageBuilds', 'vpsSecrets']) await db.collection(c).deleteMany({}).catch(() => {})
  ok('init(db, { notifyAdmin }) succeeds', svc.init(db, { notifyAdmin: (m) => { alerts.push(m); return Promise.resolve() } }) === true)
  await sleep(50)
  const osCol = db.collection('doRdpOsOptions'), builds = db.collection('doRdpImageBuilds')

  // A local "RDP" listener stands in for Windows' 3389 (customer fast path).
  const rdp = net.createServer(s => s.destroy())
  await new Promise(r => rdp.listen(0, '127.0.0.1', r))
  svc._timing.rdpPort = rdp.address().port
  // The build droplet reports through the real /provision/callback router.
  const app = require('express')(); app.use('/provision', svc.provisionRouter())
  const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const post = (body) => new Promise((resolve) => { const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/provision/callback', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })) }); req.end(JSON.stringify(body)) })

  console.log('\n[1] Full golden build: ws2022 in nyc3 → +fra1,lon1 (qcow2 callback → custom image import)')
  reset()
  fake.images[777] = { id: 777, name: 'golden-ws2022-1000', type: 'snapshot', status: 'available', regions: ['nyc3'], min_disk_size: 50, created_at: '2026-01-01T00:00:00Z' }
  let r = await svc.startGoldenBuild({ osId: 'ws2022', region: 'nyc3', targetRegions: ['fra1', 'UK'] })
  ok('startGoldenBuild returns started=true', r.started === true && r.build && r.build.build_id.startsWith('build-'))
  ok('build doc hides secrets', r.build.callback_token === undefined && r.build.admin_password === undefined)
  ok('target regions normalised (UK→lon1) and include build region', JSON.stringify(r.build.target_regions) === JSON.stringify(['nyc3', 'fra1', 'lon1']))
  ok('OS row flips to building', (await osCol.findOne({ _id: 'ws2022' })).golden_status === 'building')
  const dup = await svc.startGoldenBuild({ osId: 'ws2022' })
  ok('second build for same OS refused (already_building)', dup.started === false && dup.reason === 'already_building')
  ok('build reaches converting (waiting for the droplet)', await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting', 5000))
  const raw1 = await builds.findOne({ build_id: r.build.build_id })
  const created = calls.find(c => c.m === 'POST' && c.u === '/droplets')
  ok('build droplet uses BUILD_SIZE + ubuntu + golden-build tag + conversion user-data', created && created.data.size === svc.BUILD_SIZE && created.data.image === 'ubuntu-22-04-x64' && created.data.tags.includes('golden-build') && /qemu-system-x86_64/.test(created.data.user_data) && created.data.user_data.includes(`SERVER_ID="${r.build.build_id}"`))
  ok('user-data is in golden mode with the per-build image token + apply.ps1 sha', created.data.user_data.includes('BUILD_MODE="golden"') && created.data.user_data.includes(`IMAGE_TOKEN="${raw1.image_token}"`) && /APPLY_SHA256="[0-9a-f]{64}"/.test(created.data.user_data) && created.data.user_data.includes('qemu-img convert -f raw -O qcow2'))
  const volCreate = calls.find(c => c.m === 'POST' && c.u === '/volumes')
  ok('install volume created (32 GB, same region) and attached at droplet creation', volCreate && volCreate.data.size_gigabytes === 32 && volCreate.data.region === 'nyc3' && created.data.volumes && created.data.volumes.length === 1)
  ok('user-data targets the volume by-id path + bakes $WinPEDriver$ and ships apply.ps1 on the answer disc + self-shutdown', created.data.user_data.includes(`TARGET_DISK="/dev/disk/by-id/scsi-0DO_Volume_${created.data.name}-win"`) && /\\\$WinPEDriver\\\$/.test(created.data.user_data) && created.data.user_data.includes(`APPLY_PS1_B64="${require('fs').readFileSync(path.join(__dirname, '../rdp-scripts/apply.ps1')).toString('base64')}"`) && (() => { const x = Buffer.from(created.data.user_data.match(/AUTOUNATTEND_B64="([^"]+)"/)[1], 'base64').toString(); return x.includes('copy /y %d:\\cloudinit\\apply.ps1 C:\\cloudinit\\apply.ps1') && x.includes('schtasks /create /tn CloudInitApply') && x.includes('shutdown /s /t 20') && !x.includes('certutil') && !x.includes('10.0.2.2') })())
  let cb = await post({ server_id: r.build.build_id, token: raw1.callback_token, stage: 'image_ready', progress: 90, message: 'x', image_url: 'http://evil.example/../../etc/passwd' })
  ok('image_ready with a malformed url is logged but ignored', cb.status === 200 && !(await builds.findOne({ build_id: r.build.build_id })).image_url)
  cb = await post({ server_id: r.build.build_id, token: raw1.callback_token, stage: 'image_ready', progress: 90, message: 'qcow2 ready', image_url: `http://127.0.0.1/${raw1.image_token}/windows.qcow2`, image_bytes: 12345678 })
  ok('image_ready callback stores the qcow2 url', cb.status === 200 && (await builds.findOne({ build_id: r.build.build_id })).image_url === `http://127.0.0.1/${raw1.image_token}/windows.qcow2`)
  const done = await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).status !== 'building', 15000)
  const b = await builds.findOne({ build_id: r.build.build_id })
  ok('build finishes', done, JSON.stringify((b.logs || []).slice(-3)))
  ok('build status available / phase done / 100%', b.status === 'available' && b.phase === 'done' && b.progress === 100)
  const imp = calls.find(c => c.m === 'POST' && c.u === '/images')
  ok('custom image import requested: url from droplet, distribution Unknown, build region', imp && imp.data.url === b.image_url && imp.data.distribution === 'Unknown' && imp.data.region === 'nyc3' && /^golden-ws2022-\d+$/.test(imp.data.name))
  ok('no droplet snapshot taken (snapshots are unusable for Windows)', !calls.some(c => c.u.endsWith('/actions') && c.data && c.data.type === 'snapshot'))
  ok('install volume released before import', Object.keys(fake.volumes).length === 0 && calls.some(c => c.m === 'DELETE' && c.u.startsWith('/volumes/')) && b.volume_id === null)
  ok('image named golden-ws2022-<ts>', /^golden-ws2022-\d+$/.test(b.snapshot_name))
  ok('image id recorded as number = imported custom image', typeof b.snapshot_image_id === 'number' && b.snapshot_image_id === b.import_image_id && fake.images[b.snapshot_image_id].type === 'custom')
  const os22 = await osCol.findOne({ _id: 'ws2022' })
  ok('OS row registered: available + image id + min disk 32 (qcow2 virtual size)', os22.golden_status === 'available' && os22.golden_image_id === b.snapshot_image_id && os22.golden_min_disk_gb === 32)
  ok('OS row regions include nyc3 + fra1 + lon1 after transfers', ['nyc3', 'fra1', 'lon1'].every(x => os22.golden_regions.includes(x)))
  ok('build droplet destroyed only after the import completed', !fake.droplets[b.do_droplet_id] && calls.findIndex(c => c.m === 'DELETE' && c.u === `/droplets/${b.do_droplet_id}`) > calls.findIndex(c => c.m === 'GET' && c.u === `/images/${b.import_image_id}`))
  ok('superseded legacy snapshot 777 deleted, new custom image kept', !fake.images[777] && fake.images[b.snapshot_image_id])
  ok('transfers recorded', JSON.stringify(b.transferred_regions.sort()) === JSON.stringify(['fra1', 'lon1', 'nyc3']))
  const rb2 = await svc.startGoldenBuild({ osId: 'ws2022', region: 'nyc3' })
  ok('rebuild keeps serving the existing image (row stays available, active build exposed)', rb2.started === true && (await osCol.findOne({ _id: 'ws2022' })).golden_status === 'available' && (await svc.goldenStatus()).os_options.find(o => o.id === 'ws2022').active_build_id === rb2.build.build_id)
  await svc.cancelBuild(rb2.build.build_id)
  await waitFor(async () => !!(await builds.findOne({ build_id: rb2.build.build_id })).finished_at, 5000)
  ok('cancelled rebuild leaves the served image untouched', (await osCol.findOne({ _id: 'ws2022' })).golden_status === 'available' && (await osCol.findOne({ _id: 'ws2022' })).golden_image_id === b.snapshot_image_id)

  console.log('\n[2] listOsOptions / fast path / createInstance ETA')
  const opts = await svc.listOsOptions()
  const o22 = opts.find(o => o.id === 'ws2022'), o19 = opts.find(o => o.id === 'ws2019')
  ok('ws2022 fast_deploy=true eta 3 with region codes', o22.fast_deploy && o22.eta_minutes === 3 && o22.fast_deploy_regions.includes('EU') && o22.fast_deploy_regions.includes('US') && o22.fast_deploy_regions.includes('UK') && !o22.fast_deploy_regions.includes('SG'))
  ok('ws2019 fast_deploy=false eta 45', o19.fast_deploy === false && o19.eta_minutes === 45 && o19.default === false)
  ok('ws2022 is default', o22.default === true)
  calls.length = 0
  const inst = await svc.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'ws2022' })
  ok('createInstance reports fastDeploy + eta 3 for standard in nyc3', inst.fastDeploy === true && inst.etaMinutes === 3 && inst.osId === 'ws2022')
  await waitFor(async () => calls.some(c => c.m === 'POST' && c.u === '/droplets'))
  await sleep(100)
  const fastCreate = calls.find(c => c.m === 'POST' && c.u === '/droplets')
  ok('fast path creates droplet FROM golden image with KEY=VALUE user-data', fastCreate && fastCreate.data.image === b.snapshot_image_id && /^ADMIN_PASSWORD=.+\nCALLBACK_URL=https:\/\/example\.test\/api\/provision\/callback\n/.test(fastCreate.data.user_data))
  ok('AMD only: nyc3 order runs on the Premium AMD slug (s-2vcpu-4gb-amd)', fastCreate.data.size === 's-2vcpu-4gb-amd' && fastCreate.data.region === 'nyc3')
  ok('size candidates are AMD only (never Intel / Basic) for every tier + region; legacy raw shapes get none',
    svc.TIERS.every(t => ['nyc3', 'fra1', 'tor1', 'sgp1', 'lon1'].every(r => svc.sizeCandidatesFor(t, r).every(x => /-amd$/.test(x))))
    && JSON.stringify(svc.sizeCandidatesFor(svc.getProduct('pro-1m'), 'sgp1')) === JSON.stringify(['s-4vcpu-8gb-amd'])
    && JSON.stringify(svc.sizeCandidatesFor({ do_size_slug: 's-1vcpu-2gb', do_size_slug_basic: 's-1vcpu-2gb' }, 'ams3')) === '[]')
  ok('fast-path user-data carries the REAL per-order password (from the secret store, not "undefined")', fastCreate.data.user_data.startsWith(`ADMIN_PASSWORD=${inst.defaultPassword}\n`) && inst.defaultPassword.length >= 16)
  const keyPost = calls.find(c => c.m === 'POST' && c.u === '/account/keys')
  ok('custom-image create carries the auto-registered throwaway ed25519 SSH key', keyPost && /^ssh-ed25519 [A-Za-z0-9+/=]+ nomadly-rdp-golden$/.test(keyPost.data.public_key) && JSON.stringify(fastCreate.data.ssh_keys) === '[555]')
  // AMD out of stock in nyc3 → the SAME AMD size is built in nyc1 (same city), never Intel/Basic.
  calls.length = 0
  fake.unavailableSizes = ['s-2vcpu-4gb-amd@nyc3']
  const oos = await svc.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'ws2022' })
  await waitFor(async () => calls.filter(c => c.m === 'POST' && c.u === '/droplets').length >= 2)
  await sleep(150)
  const oosPosts = calls.filter(c => c.m === 'POST' && c.u === '/droplets')
  const oosDoc = await db.collection('doRdpServers').findOne({ server_id: oos.serverId })
  ok('422 "Size is not available" in nyc3 → same AMD size tried in nyc1 (same city), order continues', oosPosts.length === 2 && oosPosts[0].data.region === 'nyc3' && oosPosts[1].data.region === 'nyc1' && oosPosts.every(x => x.data.size === 's-2vcpu-4gb-amd') && oosDoc.do_droplet_id)
  ok('fallback persisted: region nyc1 (requested nyc3) + order log explains it', oosDoc.region === 'nyc1' && oosDoc.requested_region === 'nyc3' && oosDoc.do_size_slug === 's-2vcpu-4gb-amd' && (oosDoc.logs || []).some(l => /s-2vcpu-4gb-amd is not available in nyc3/.test(l.message)) && (oosDoc.logs || []).some(l => /built in nyc1 \(same city\)/.test(l.message)))
  // AMD gone in the whole city → order fails cleanly (refundable) + admin out-of-stock alert; no Intel/Basic attempt.
  require('../do-size-catalog')._resetForTest()
  calls.length = 0
  fake.unavailableSizes = ['s-2vcpu-4gb-amd']
  const dead = await svc.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'ws2022' })
  await waitFor(async () => ((await db.collection('doRdpServers').findOne({ server_id: dead.serverId })) || {}).status === 'failed')
  const deadDoc = await db.collection('doRdpServers').findOne({ server_id: dead.serverId })
  const deadPosts = calls.filter(c => c.m === 'POST' && c.u === '/droplets')
  ok('no AMD anywhere in New York → failed with "no AMD capacity", tried nyc3/nyc1/nyc2 only with AMD', deadDoc.status === 'failed' && /no AMD capacity/.test((deadDoc.logs || []).slice(-1)[0].message) && deadPosts.length === 3 && deadPosts.every(x => x.data.size === 's-2vcpu-4gb-amd'))
  ok('admin alerted: RDP out of stock in New York', alerts.some(a => /RDP out of stock: Standard in United States \(New York\)/.test(a)))
  require('../do-size-catalog')._resetForTest()
  fake.unavailableSizes = []
  calls.length = 0
  const slow = await svc.createInstance({ productId: 'pro-1m', regionSlug: 'SG', osId: 'ws2022' })
  ok('region without image → fastDeploy=false eta 45', slow.fastDeploy === false && slow.etaMinutes === 45)
  await waitFor(async () => calls.some(c => c.m === 'POST' && c.u === '/droplets'))
  await sleep(150)
  const slowCreate = calls.find(c => c.m === 'POST' && c.u === '/droplets')
  ok('slow path creates Ubuntu droplet with conversion script in direct mode', slowCreate && slowCreate.data.image === 'ubuntu-22-04-x64' && /qemu-system-x86_64/.test(slowCreate.data.user_data) && slowCreate.data.user_data.includes('BUILD_MODE="direct"'))
  ok('region-aware size: sgp1 HAS AMD → AMD slug (s-4vcpu-8gb-amd)', slowCreate.data.size === 's-4vcpu-8gb-amd')
  ok('slow-path autounattend bakes the REAL per-order Administrator password', (() => { const x = Buffer.from(slowCreate.data.user_data.match(/AUTOUNATTEND_B64="([^"]+)"/)[1], 'base64').toString(); return x.includes(`<Value>${slow.defaultPassword}</Value>`) && !x.includes('undefined') })())
  ok('slow path attaches an install volume and records volume_id', slowCreate.data.volumes && slowCreate.data.volumes.length === 1 && (await db.collection('doRdpServers').findOne({ server_id: slow.serverId })).volume_id === slowCreate.data.volumes[0])
  ok('on-demand transfer to sgp1 kicked off', calls.some(c => c.m === 'POST' && c.u === `/images/${b.snapshot_image_id}/actions` && c.data.region === 'sgp1'))
  await waitFor(async () => (await osCol.findOne({ _id: 'ws2022' })).golden_regions.includes('sgp1'))
  ok('sgp1 added to golden_regions once transfer completes', (await osCol.findOne({ _id: 'ws2022' })).golden_regions.includes('sgp1'))
  const srvLog = await db.collection('doRdpServers').findOne({ server_id: slow.serverId })
  ok('order log notes the transfer', (srvLog.logs || []).some(l => /image transfer started/.test(l.message)))
  let threw = null
  try { await svc.createInstance({ productId: 'standard-1m', regionSlug: 'US', osId: 'win11' }) } catch (e) { threw = e }
  ok('createInstance rejects unknown os', threw && /unknown os/.test(threw.message))

  console.log('\n[2b] Reseller status block (GET /rdp/:id → provisioning) + admin alerts')
  const fastRaw = await db.collection('doRdpServers').findOne({ server_id: inst.serverId })
  ok('fast-path order records fast_deploy / eta / golden_image_id at provision time', fastRaw.fast_deploy === true && fastRaw.eta_minutes === 3 && fastRaw.golden_image_id === b.snapshot_image_id)
  let gi = await svc.getInstance(inst.instanceId)
  ok('password_confirmed is null until apply.ps1 calls back', gi.provisioning && gi.provisioning.password_confirmed === null && gi.provisioning.credentials_ready === false)
  // apply.ps1 on the droplet confirms network + password → order active.
  await post({ server_id: inst.serverId, token: fastRaw.callback_token, stage: 'rdp_ready', progress: 100, message: 'Windows booted from golden image; network + password applied; RDP ready' })
  const fastDoc = await db.collection('doRdpServers').findOne({ server_id: inst.serverId })
  ok('rdp_ready callback → active + password_confirmed + time_to_active_s recorded', fastDoc.status === 'active' && fastDoc.password_confirmed === true && Number.isFinite(fastDoc.time_to_active_s) && fastDoc.activated_at)
  gi = await svc.getInstance(inst.instanceId)
  const p = gi.provisioning
  ok('getInstance exposes provisioning block: active, 100%, credentials_ready, eta 0, 4 steps all done', p && p.status === 'active' && p.progress === 100 && p.credentials_ready === true && p.password_confirmed === true && p.eta_seconds === 0 && p.eta_at === null && p.fast_deploy === true && p.os === 'ws2022' && p.steps.length === 4 && p.steps.every(s => s.done) && Array.isArray(p.logs) && p.stage_label === 'Windows is ready')
  await post({ server_id: inst.serverId, token: fastRaw.callback_token, stage: 'rdp_ready', progress: 100, message: 'again' })
  ok('second activation keeps the first activated_at', String((await db.collection('doRdpServers').findOne({ server_id: inst.serverId })).activated_at) === String(fastDoc.activated_at))
  const inFlight = { server_id: 'srv-inflight', os_id: 'ws2019', tier_slug: 'starter', region: 'nyc3', status: 'installing', progress: 60, fast_deploy: true, eta_minutes: 3, created_at: new Date(Date.now() - 100000), logs: [{ ts: new Date(), stage: 'creating', message: 'c' }, { ts: new Date(), stage: 'booting', message: 'b' }, { ts: new Date(), stage: 'rdp_up', message: 'RDP port open' }] }
  const ps = svc.provisioningStatus(inFlight)
  ok('in-flight status: eta countdown ~80s, elapsed ~100s, stage label, step 3 done + step 4 current, credentials not ready', ps.eta_seconds > 70 && ps.eta_seconds <= 80 && ps.elapsed_seconds >= 100 && ps.elapsed_seconds <= 101 && ps.stage === 'rdp_up' && /confirming password/.test(ps.stage_label) && ps.steps[2].done === true && ps.steps[3].done === false && ps.steps[3].current === true && ps.credentials_ready === false && typeof ps.eta_at === 'string')
  const slowPs = svc.provisioningStatus({ ...inFlight, fast_deploy: false, eta_minutes: 45, status: 'converting', logs: [{ ts: new Date(), stage: 'converting', message: 'x' }] })
  ok('slow-path status uses the converting step + 45-min ETA', slowPs.steps[2].key === 'converting' && slowPs.eta_minutes === 45 && slowPs.eta_seconds > 40 * 60)
  const beforeAlerts = alerts.length
  const slowRaw = await db.collection('doRdpServers').findOne({ server_id: slow.serverId })
  await post({ server_id: slow.serverId, token: slowRaw.callback_token, stage: 'failed', progress: 20, message: 'No /dev/kvm on this droplet' })
  await waitFor(async () => alerts.length > beforeAlerts, 3000)
  ok('failed order → admin Telegram alert with order ref + reason', alerts.slice(beforeAlerts).some(m => /RDP order .*FAILED/.test(m) && /No \/dev\/kvm/.test(m) && new RegExp(slow.serverId.slice(0, 8)).test(m)))
  ok('failed order provisioning block: terminal, eta 0, stage failed', (await svc.getInstance(slow.instanceId)).provisioning.stage === 'failed' && (await svc.getInstance(slow.instanceId)).provisioning.eta_seconds === 0)
  await db.collection('doRdpServers').insertOne({ server_id: 'srv-slowfast', os_id: 'ws2022', tier_slug: 'pro', region: 'fra1', status: 'installing', progress: 60, fast_deploy: true, created_at: new Date(), logs: [{ ts: new Date(), stage: 'rdp_up', message: 'RDP port open at 1.2.3.4:3389' }] })
  svc._watchFastTarget('srv-slowfast')
  await waitFor(async () => alerts.some(m => /missed the 0-min|missed the \d+-min fast-deploy target/.test(m) && /srv-slow/.test(m)), 3000)
  ok('fast-path order still provisioning after the target → one admin alert with stage + last message', alerts.some(m => /fast-deploy target/.test(m) && /srv-slow/.test(m) && /rdp_up/.test(m) && /RDP port open/.test(m)))
  const nAlerts = alerts.length
  svc._watchFastTarget('srv-slowfast'); await sleep(600)
  ok('same alert is de-duplicated', alerts.length === nAlerts)
  svc._watchFastTarget(inst.serverId); await sleep(600)
  ok('no target alert for an order that is already active', !alerts.some(m => /fast-deploy target/.test(m) && new RegExp(inst.serverId.slice(0, 8)).test(m) && /status=active/.test(m)))
  await db.collection('doRdpServers').insertOne({ server_id: 'srv-active', os_id: 'ws2019', tier_slug: 'starter', region: 'nyc3', status: 'active', fast_deploy: true, created_at: new Date(), logs: [] })
  svc._watchFastTarget('srv-active'); await sleep(600)
  ok('watchdog is silent for an active order', !alerts.some(m => /srv-active/.test(m)))
  const digest = await svc.sendDailyDigest()
  ok('daily digest summarises last-24h orders (count, fast-path time to active, failures)', typeof digest === 'string' && /RDP orders last 24h: \d+/.test(digest) && /fast path \d+/.test(digest) && /failed 2/.test(digest))

  console.log('\n[3] Droplet-reported conversion failure via /provision/callback → build fails + cleanup')
  reset()
  r = await svc.startGoldenBuild({ osId: 'ws2019', region: 'nyc3' })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting')
  const raw = await builds.findOne({ build_id: r.build.build_id })
  cb = await post({ server_id: r.build.build_id, token: 'wrong', stage: 'failed', message: 'x' })
  ok('callback with wrong token → 403', cb.status === 403)
  cb = await post({ server_id: r.build.build_id, token: raw.callback_token, stage: 'download_iso', progress: 25, message: 'Downloading Windows ISO' })
  ok('progress callback accepted and logged', cb.status === 200 && (await builds.findOne({ build_id: r.build.build_id })).conv_progress === 25)
  cb = await post({ server_id: r.build.build_id, token: raw.callback_token, stage: 'failed', progress: 20, message: 'No /dev/kvm on this droplet' })
  ok('failed callback accepted', cb.status === 200)
  await waitFor(async () => !!(await builds.findOne({ build_id: r.build.build_id })).finished_at, 5000)
  const fb = await builds.findOne({ build_id: r.build.build_id })
  ok('build marked failed with droplet reason', fb.status === 'failed' && (fb.logs || []).some(l => l.stage === 'failed' && /No \/dev\/kvm/.test(l.message)))
  ok('failed golden build → admin Telegram alert with os + phase + retry command', alerts.some(m => /Golden image build build-.* \(ws2019, nyc3\) FAILED/.test(m) && /No \/dev\/kvm/.test(m) && /rdp_golden_build.js build --os ws2019/.test(m)))
  await waitFor(async () => !fake.droplets[fb.do_droplet_id], 3000)
  ok('failed build droplet destroyed (no keep_on_failure)', !fake.droplets[fb.do_droplet_id])
  await waitFor(async () => Object.keys(fake.volumes).length === 0, 3000).catch(() => {})
  ok('failed build install volume deleted', Object.keys(fake.volumes).length === 0)
  const os19 = await osCol.findOne({ _id: 'ws2019' })
  ok('ws2019 row reverts to failed (no prior image) with error', os19.golden_status === 'failed' && /No \/dev\/kvm/.test(os19.golden_error))
  ok('build can be restarted after failure', (await svc.startGoldenBuild({ osId: 'ws2019', region: 'nyc3', keepOnFailure: true })).started === true)
  const b19 = await builds.findOne({ os_id: 'ws2019', status: 'building' })
  ok('cancelBuild stops a running build', (await svc.cancelBuild(b19.build_id)).cancelled === true)
  await waitFor(async () => !!(await builds.findOne({ build_id: b19.build_id })).finished_at, 5000)
  const cb19 = await builds.findOne({ build_id: b19.build_id })
  ok('cancelled build keeps droplet when keep_on_failure', cb19.status === 'cancelled' && (cb19.do_droplet_id ? !!fake.droplets[cb19.do_droplet_id] : true))

  console.log('\n[3b] Import rejected by DigitalOcean → build fails, half-imported image + droplet removed')
  reset()
  fake.failImport = true
  r = await svc.startGoldenBuild({ osId: 'ws2019', region: 'nyc3' })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting')
  const rawF = await builds.findOne({ build_id: r.build.build_id })
  await post({ server_id: r.build.build_id, token: rawF.callback_token, stage: 'image_ready', progress: 90, message: 'ready', image_url: `http://127.0.0.1/${rawF.image_token}/windows.qcow2` })
  await waitFor(async () => !!(await builds.findOne({ build_id: r.build.build_id })).finished_at, 8000)
  const fbi = await builds.findOne({ build_id: r.build.build_id })
  ok('import failure surfaces DO error_message', fbi.status === 'failed' && (fbi.logs || []).some(l => /custom image import failed: Unsupported image format/.test(l.message)))
  ok('half-imported image deleted + build droplet destroyed', !fake.images[fbi.import_image_id] && !fake.droplets[fbi.do_droplet_id])
  fake.failImport = false

  console.log('\n[3b-2] Import stuck in "pending" at DigitalOcean → stuck entry deleted, same qcow2 re-submitted, build completes')
  reset()
  fake.stuckImports = 1
  r = await svc.startGoldenBuild({ osId: 'ws2019', region: 'nyc3', regions: ['nyc3'] })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting')
  const rawS = await builds.findOne({ build_id: r.build.build_id })
  await post({ server_id: r.build.build_id, token: rawS.callback_token, stage: 'image_ready', progress: 90, message: 'ready', image_url: `http://127.0.0.1/${rawS.image_token}/windows.qcow2` })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'importing')
  const firstImport = (await builds.findOne({ build_id: r.build.build_id })).import_image_id
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).status === 'available', 15000)
  const sb = await builds.findOne({ build_id: r.build.build_id })
  ok('stuck import detected after importRetryMin and logged', (sb.logs || []).some(l => /still pending after .* looks stuck.*re-submitting.*attempt 1\/2/.test(l.message)))
  ok('stuck DO image entry deleted, new import created from the SAME qcow2 URL with -r1 suffix', !fake.images[firstImport] && fake.images[sb.import_image_id] && fake.images[sb.import_image_id].url === sb.image_url && /-r1$/.test(fake.images[sb.import_image_id].name) && sb.import_attempts === 1 && sb.import_image_id !== firstImport)
  ok('re-imported image registered as the golden image and build finished', sb.status === 'available' && sb.snapshot_image_id === sb.import_image_id && (await svc.getOsOption('ws2019')).golden_image_id === sb.import_image_id)
  fake.stuckImports = 0

  console.log('\n[3c] Build-size fallback when DO reports 422 "Size is not available"')
  reset()
  fake.regionSizes = ['s-1vcpu-2gb', 'c-4', 'm-2vcpu-16gb'] // BUILD_SIZE missing from live availability
  fake.unavailableSizes = [svc.BUILD_SIZE]
  r = await svc.startGoldenBuild({ osId: 'ws2025', region: 'nyc3' })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting', 5000)
  const bSz = await builds.findOne({ build_id: r.build.build_id })
  const dropletPosts = calls.filter(c => c.m === 'POST' && c.u === '/droplets')
  ok('unavailable BUILD_SIZE skipped, live-available 50 GB size used', bSz.build_size === 'c-4' && dropletPosts.length === 1 && dropletPosts[0].data.size === 'c-4')
  await svc.cancelBuild(r.build.build_id)
  await waitFor(async () => !!(await builds.findOne({ build_id: r.build.build_id })).finished_at, 5000)
  reset()
  fake.unavailableSizes = [svc.BUILD_SIZE, 'c-4'] // regions API down → default order, first two 422
  r = await svc.startGoldenBuild({ osId: 'ws2025', region: 'nyc3' })
  await waitFor(async () => (await builds.findOne({ build_id: r.build.build_id })).phase === 'converting', 5000)
  const bSz2 = await builds.findOne({ build_id: r.build.build_id })
  ok('422 on two sizes → third candidate succeeds, attempts logged', bSz2.build_size === 'm-2vcpu-16gb' && calls.filter(c => c.m === 'POST' && c.u === '/droplets').length === 3 && (bSz2.logs || []).filter(l => /not available/.test(l.message)).length === 2)
  ok('volumes from failed attempts cleaned up (one attached volume remains)', Object.keys(fake.volumes).length === 1)
  await svc.cancelBuild(r.build.build_id)
  await waitFor(async () => !!(await builds.findOne({ build_id: r.build.build_id })).finished_at, 5000)
  srv.close()

  console.log('\n[4] Resume after restart: build stuck in "importing" phase continues')
  reset()
  const dropletId = 4242
  fake.droplets[dropletId] = { id: dropletId, name: 'golden-ws2025-abc', status: 'active', polls: 0, region: { slug: 'nyc3' }, networks: { v4: [] } }
  fake.images[9100] = { id: 9100, name: 'golden-ws2025-1700000000', type: 'custom', status: 'NEW', polls: 0, regions: ['nyc3'], min_disk_size: 32, created_at: new Date().toISOString() }
  await builds.insertOne({ build_id: 'build-resume01', os_id: 'ws2025', region: 'nyc3', target_regions: ['nyc3', 'ams3'], status: 'building', phase: 'importing', progress: 75, logs: [], callback_token: 't', admin_password: 'p', do_droplet_id: dropletId, ip_address: '127.0.0.1', snapshot_name: 'golden-ws2025-1700000000', import_image_id: 9100, snapshot_image_id: null, transferred_regions: [], keep_on_failure: false, created_at: new Date(), updated_at: new Date(), finished_at: null })
  await osCol.updateOne({ _id: 'ws2025' }, { $set: { golden_status: 'building', golden_build_id: 'build-resume01' } })
  ok('resumeBuilds picks up 1 build', (await svc.resumeBuilds()) === 1)
  await waitFor(async () => (await builds.findOne({ build_id: 'build-resume01' })).status !== 'building', 8000)
  const rb = await builds.findOne({ build_id: 'build-resume01' })
  ok('resumed build completes', rb.status === 'available' && rb.snapshot_image_id === 9100 && rb.transferred_regions.includes('ams3'))
  ok('ws2025 registered + build droplet destroyed', (await osCol.findOne({ _id: 'ws2025' })).golden_image_id === 9100 && !fake.droplets[dropletId])

  console.log('\n[5] syncGoldenFromDO: DO custom images are the source of truth (legacy snapshots ignored)')
  reset()
  fake.images[501] = { id: 501, name: 'golden-ws2022-1000', type: 'custom', status: 'available', regions: ['nyc3'], min_disk_size: 32, created_at: '2026-01-01T00:00:00Z' }
  fake.images[502] = { id: 502, name: 'golden-ws2022-2000', type: 'custom', status: 'available', regions: ['nyc3', 'fra1'], min_disk_size: 32, created_at: '2026-02-01T00:00:00Z' }
  fake.images[503] = { id: 503, name: 'whm-backup', type: 'snapshot', status: 'available', regions: ['fra1'], min_disk_size: 120, created_at: '2026-02-01T00:00:00Z' }
  fake.images[504] = { id: 504, name: 'golden-ws2025-3000', type: 'snapshot', status: 'available', regions: ['nyc3'], min_disk_size: 50, created_at: '2026-03-01T00:00:00Z' }
  fake.images[505] = { id: 505, name: 'golden-ws2022-3000', type: 'custom', status: 'pending', regions: ['nyc3'], min_disk_size: 32, created_at: '2026-03-01T00:00:00Z' }
  await osCol.updateOne({ _id: 'ws2025' }, { $set: { golden_status: 'available', golden_image_id: 9100 } })
  await osCol.updateOne({ _id: 'ws2019' }, { $set: { golden_status: 'building', golden_build_id: 'x' } })
  const sync = await svc.syncGoldenFromDO()
  ok('newest AVAILABLE ws2022 custom image registered (502, both regions; pending 505 skipped)', sync.ws2022.status === 'available' && sync.ws2022.image_id === 502 && (await osCol.findOne({ _id: 'ws2022' })).golden_regions.includes('fra1'))
  ok('ws2025 legacy droplet snapshot ignored → reset to none', sync.ws2025.status === 'none' && (await osCol.findOne({ _id: 'ws2025' })).golden_status === 'none')
  ok('in-progress build is not overridden by sync', sync.ws2019.status === 'building')
  const st = await svc.goldenStatus()
  ok('goldenStatus lists 3 OS + builds + all regions', st.os_options.length === 3 && Array.isArray(st.builds) && st.all_regions.includes('sgp1') && st.build_size === svc.BUILD_SIZE)
  ok('transferGolden queues only missing regions', JSON.stringify((await svc.transferGolden('ws2022', ['fra1', 'SG'])).queued_regions) === JSON.stringify(['sgp1']))
  let bad = null; try { await svc.transferGolden('ws2025', 'all') } catch (e) { bad = e }
  ok('transferGolden refuses OS without image', bad && /no golden image/.test(bad.message))

  console.log('\n[6] syncGoldenFromDO: manually re-imported image with suffix (golden-ws2025-<ts>-r2) is registered')
  fake.images[506] = { id: 506, name: 'golden-ws2025-1790110923-r2', type: 'custom', status: 'available', regions: ['nyc3'], min_disk_size: 32, created_at: '2026-09-23T02:02:59Z' }
  fake.images[507] = { id: 507, name: 'golden-ws2025-not-a-golden-image-at-all', type: 'custom', status: 'available', regions: ['nyc3'], min_disk_size: 32, created_at: '2026-09-24T00:00:00Z' }
  const sync2 = await svc.syncGoldenFromDO()
  ok('ws2025 -r2 custom image picked up as available in nyc3', sync2.ws2025.status === 'available' && sync2.ws2025.image_id === 506 && JSON.stringify(sync2.ws2025.regions) === JSON.stringify(['nyc3']))
  ok('transferGolden ws2025 queues the 8 missing regions', (await svc.transferGolden('ws2025', 'all')).queued_regions.length === svc.GOLDEN_ALL_REGIONS.length - 1)

  rdp.close()
  await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
