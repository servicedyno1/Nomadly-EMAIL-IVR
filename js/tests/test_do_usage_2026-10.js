/* eslint-disable no-console */
// VPS/RDP usage metrics (DigitalOcean) — stats math, reseller API endpoints, RDP agent ingestion.
// Run: node js/tests/test_do_usage_2026-10.js
// SAFE: DigitalOcean API replaced by an in-memory fake, throw-away local DB.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const d = require('../digitalocean-service')
const rdp = require('../digitalocean-rdp-service')
const usage = require('../do-usage')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}
const near = (a, b, eps = 0.05) => assert.ok(a != null && Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

// ── Fake DigitalOcean: droplets + monitoring metrics (31 samples, 120 s apart) ──
const droplets = new Map()
let metricCalls = 0
const N = 31, STEP = 120
const series = (end, f) => Array.from({ length: N }, (_, i) => [end - (N - 1 - i) * STEP, String(f(i))])
function metric(name, q) {
  const end = Number(q.get('end'))
  if (name === 'cpu') {
    // Δtotal 240 cpu-s per step; 25% busy, last step 50% busy
    const cum = (busyLast) => { let idle = 1e6, user = 5e4, sys = 1e4; const out = { idle: [], user: [], system: [] }
      for (let i = 0; i < N; i++) { if (i > 0) { const last = i === N - 1 && busyLast; idle += last ? 120 : 180; user += last ? 100 : 50; sys += last ? 20 : 10 } out.idle.push(idle); out.user.push(user); out.system.push(sys) }
      return out }
    const c = cum(true)
    return ['idle', 'user', 'system'].map((mode) => ({ metric: { host_id: q.get('host_id'), mode }, values: series(end, (i) => c[mode][i]) }))
  }
  if (name === 'bandwidth') return [{ metric: { direction: q.get('direction') }, values: series(end, () => (q.get('direction') === 'inbound' ? 8 : 0.8)) }]
  if (name === 'memory_total') return [{ metric: {}, values: series(end, () => 4e9) }]
  if (name === 'memory_available') return [{ metric: {}, values: series(end, (i) => (i === N - 1 ? 1e9 : 3e9)) }]
  if (name === 'filesystem_size') return [{ metric: { mountpoint: '/boot' }, values: series(end, () => 1e9) }, { metric: { mountpoint: '/' }, values: series(end, () => 80e9) }]
  if (name === 'filesystem_free') return [{ metric: { mountpoint: '/boot' }, values: series(end, () => 0.9e9) }, { metric: { mountpoint: '/' }, values: series(end, () => 60e9) }]
  if (/^load_/.test(name)) return [{ metric: {}, values: series(end, () => 0.5) }]
  return []
}
d.apiRequest = async (method, p) => {
  const u = new URL(`http://x/v2${p}`)
  let m
  if ((m = u.pathname.match(/^\/v2\/droplets\/(\d+)$/))) {
    const x = droplets.get(m[1]); if (!x) { const e = new Error('404'); e.status = 404; throw e }
    return { droplet: x }
  }
  if ((m = u.pathname.match(/^\/v2\/monitoring\/metrics\/droplet\/(\w+)$/))) { metricCalls++; return { status: 'success', data: { resultType: 'matrix', result: metric(m[1], u.searchParams) } } }
  throw new Error(`unmocked ${method} ${p}`)
}
d.getInstance = async () => null
rdp.getInstance = async () => null
const addDroplet = (id, features = ['monitoring']) => droplets.set(String(id), { id, status: 'active', vcpus: 2, memory: 4096, disk: 80, size: { transfer: 4 }, features })

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_do_usage_${Date.now()}`)
  rdp.init(DB)
  const OWNER = '777000911'

  console.log('stats math')
  await t('cpuStats: busy % from cumulative counters (now/avg/peak), counter reset skipped', () => {
    const r = usage.cpuStats(metric('cpu', new URLSearchParams({ end: '100000', host_id: '1' })))
    near(r.percent_now, 50); near(r.percent_peak, 50); near(r.percent_avg, 25.8)
    const reset = [{ metric: { mode: 'idle' }, values: [[0, '100'], [60, '150'], [120, '5'], [180, '50']] }, { metric: { mode: 'user' }, values: [[0, '0'], [60, '10'], [120, '1'], [180, '11']] }]
    const r2 = usage.cpuStats(reset)
    near(r2.percent_now, 18.2, 0.1)
  })
  await t('rateStats: Mbps → GB over the period; memory + disk (root mount) stats', () => {
    const bw = usage.rateStats(metric('bandwidth', new URLSearchParams({ end: '100000', direction: 'inbound' })))
    near(bw.gb, 3.6, 0.001); assert.strictEqual(bw.now_mbps, 8); assert.strictEqual(bw.peak_mbps, 8)
    const q = new URLSearchParams({ end: '100000' })
    const mem = usage.memoryStats(metric('memory_total', q), metric('memory_available', q))
    near(mem.percent_now, 75); near(mem.percent_peak, 75); near(mem.percent_avg, 26.6, 0.1); near(mem.total_gb, 3.73, 0.01)
    const disk = usage.diskStats(metric('filesystem_size', q), metric('filesystem_free', q))
    near(disk.percent, 25); near(disk.free_gb, 55.88, 0.01)
    assert.strictEqual(usage.cpuStats([]), null); assert.strictEqual(usage.rateStats([]), null)
  })

  console.log('RDP agent ingestion (/provision/commands)')
  const prov = express(); prov.use('/provision', rdp.provisionRouter())
  const provSrv = prov.listen(0)
  const pbase = `http://127.0.0.1:${provSrv.address().port}/provision`
  const servers = DB.collection('doRdpServers'), samples = DB.collection('doRdpAgentMetrics')
  const sid = crypto.randomUUID(), tok = 'tok_' + crypto.randomBytes(8).toString('hex')
  await servers.insertOne({ server_id: sid, callback_token: tok, do_droplet_id: 702, tier_slug: 'standard', region: 'fra1', status: 'active', commands: [] })
  const poll = (qs) => axios.get(`${pbase}/commands?server_id=${sid}&token=${tok}${qs}`, { validateStatus: () => true })
  await t('poll with metrics stores the snapshot + one 5-minute sample; repeat poll does not add a sample', async () => {
    const r = await poll('&cpu=12.5&mem_total=4294496256&mem_free=2147483648&disk_total=85362618368&disk_free=60000000000')
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.data.commands, [])
    const s = await servers.findOne({ server_id: sid })
    assert.strictEqual(s.agent_metrics.cpu_percent, 12.5); assert.strictEqual(s.agent_metrics.disk_free, 60000000000); assert.ok(s.agent_seen_at)
    assert.strictEqual(await samples.countDocuments({ server_id: sid }), 1)
    await poll('&cpu=30')
    assert.strictEqual(await samples.countDocuments({ server_id: sid }), 1)
    assert.strictEqual((await servers.findOne({ server_id: sid })).agent_metrics.cpu_percent, 30)
    await servers.updateOne({ server_id: sid }, { $set: { agent_metrics_sampled_at: new Date(Date.now() - 6 * 60000) } })
    await poll('&cpu=40')
    assert.strictEqual(await samples.countDocuments({ server_id: sid }), 2)
  })
  await t('invalid values are dropped; a poll without metrics keeps the last snapshot; wrong token → 403', async () => {
    const m = rdp.parseAgentMetrics({ cpu: 'abc', mem_total: '100', mem_free: '200', disk_total: '-5' })
    assert.strictEqual(m.cpu_percent, null); assert.strictEqual(m.mem_free, null); assert.strictEqual(m.disk_total, null); assert.strictEqual(m.mem_total, 100)
    assert.strictEqual(rdp.parseAgentMetrics({ cpu: '250' }), null)
    await poll('')
    assert.strictEqual((await servers.findOne({ server_id: sid })).agent_metrics.cpu_percent, 40)
    assert.strictEqual((await axios.get(`${pbase}/commands?server_id=${sid}&token=bad`, { validateStatus: () => true })).status, 403)
  })

  console.log('reseller API')
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  await DB.collection('resellerApiKeys').insertOne({ _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER, label: 'usage-test' })
  const { createResellerApi } = require('../reseller-api')
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const api = (url) => axios.get(base + url, { headers: { Authorization: `Bearer ${KEY}` }, validateStatus: () => true })
  const plans = DB.collection('vpsPlansOf')
  const end = new Date(Date.now() + 20 * 86400000)
  addDroplet(701); addDroplet(703, []); addDroplet(702, [])
  const vps = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: 'do-701', provider: 'digitalocean', productId: 's-2vcpu-4gb', isRDP: false, status: 'RUNNING', source: 'reseller_api', end_time: end }
  const vpsNoAgent = { ...vps, _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), instanceId: 'do-703' }
  const rdpRec = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: `rdp-${sid}`, provider: 'digitalocean-rdp', productId: 'standard-1m', isRDP: true, status: 'RUNNING', source: 'reseller_api', end_time: end }
  const contabo = { _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: OWNER, instanceId: '2023455', provider: 'contabo', isRDP: false, status: 'RUNNING', end_time: end }
  const foreign = { ...vps, _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), chatId: '999' }
  const prov2 = { ...vps, _id: crypto.randomUUID(), vpsId: crypto.randomUUID(), status: 'PROVISIONING', provisionState: 'provisioning' }
  await plans.insertMany([vps, vpsNoAgent, rdpRec, contabo, foreign, prov2])

  await t('GET /vps/:id/usage: CPU, memory, disk, load, bandwidth + specs (agent installed)', async () => {
    const r = await api(`/vps/${vps.vpsId}/usage?period=1h`)
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    const u = r.data
    assert.strictEqual(u.product, 'vps'); assert.strictEqual(u.period, '1h'); assert.strictEqual(u.metrics_agent, true)
    assert.deepStrictEqual(u.specs, { vcpus: 2, ram_gb: 4, disk_gb: 80, monthly_transfer_gb: 4000 })
    near(u.cpu.percent_now, 50); near(u.memory.percent_now, 75); near(u.disk.percent, 25); assert.strictEqual(u.load.load_1, 0.5)
    near(u.bandwidth.inbound.gb, 3.6, 0.001); near(u.bandwidth.outbound.gb, 0.36, 0.001); assert.strictEqual(u.bandwidth.estimated, true)
    assert.ok(Date.parse(u.from) < Date.parse(u.to)); assert.strictEqual(u.sample_interval_seconds, 120)
    assert.ok(!('step' in u.bandwidth))
  })
  await t('results are cached per server + period', async () => {
    const before = metricCalls
    await api(`/vps/${vps.vpsId}/usage?period=1h`)
    assert.strictEqual(metricCalls, before)
    await api(`/vps/${vps.vpsId}/usage?period=7d`)
    assert.ok(metricCalls > before)
  })
  await t('no metrics agent → only CPU + bandwidth, with a note', async () => {
    const r = await api(`/vps/${vpsNoAgent.vpsId}/usage`)
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.period, '24h'); assert.strictEqual(r.data.metrics_agent, false)
    assert.strictEqual(r.data.memory, null); assert.strictEqual(r.data.disk, null); assert.ok(r.data.cpu); assert.ok(r.data.notes.length)
  })
  await t('GET /rdp/:id/usage: bandwidth from DO + CPU/RAM/C: from the agent (period avg/peak from samples)', async () => {
    await samples.deleteMany({ server_id: sid })
    const ago = (m) => new Date(Date.now() - m * 60000)
    await samples.insertMany([{ server_id: sid, at: ago(50), cpu_percent: 10, mem_total: 4e9, mem_free: 3e9 }, { server_id: sid, at: ago(30), cpu_percent: 20, mem_total: 4e9, mem_free: 2e9 }, { server_id: sid, at: ago(10), cpu_percent: 90, mem_total: 4e9, mem_free: 1e9 }, { server_id: sid, at: ago(3000), cpu_percent: 100 }])
    await servers.updateOne({ server_id: sid }, { $set: { agent_metrics: { cpu_percent: 40, mem_total: 4e9, mem_free: 1e9, disk_total: 80e9, disk_free: 20e9, at: new Date() } } })
    const r = await api(`/rdp/${rdpRec.vpsId}/usage?period=1h`)
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    const u = r.data
    assert.strictEqual(u.product, 'rdp'); assert.strictEqual(u.agent_reporting, true)
    assert.strictEqual(u.cpu.percent_now, 40); near(u.cpu.percent_avg, 40); assert.strictEqual(u.cpu.percent_peak, 90)
    near(u.memory.percent_now, 75); near(u.memory.percent_peak, 75); near(u.memory.total_gb, 3.73, 0.01)
    assert.strictEqual(u.disk.drive, 'C:'); near(u.disk.percent, 75)
    near(u.bandwidth.inbound.gb, 3.6, 0.001)
    assert.deepStrictEqual(u.notes, [])
  })
  await t('RDP agent not reporting yet → bandwidth only + restart note; stale snapshot → last disk + note', async () => {
    usage._cache.clear()
    await servers.updateOne({ server_id: sid }, { $unset: { agent_metrics: '' } })
    await samples.deleteMany({ server_id: sid })
    let r = await api(`/rdp/${rdpRec.vpsId}/usage`)
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.cpu, null); assert.strictEqual(r.data.agent_reporting, false); assert.ok(/restarts once/.test(r.data.notes[0]))
    assert.ok(r.data.bandwidth.inbound)
    usage._cache.clear()
    await servers.updateOne({ server_id: sid }, { $set: { agent_metrics: { cpu_percent: 5, mem_total: 4e9, mem_free: 2e9, disk_total: 80e9, disk_free: 40e9, at: new Date(Date.now() - 3600000) } } })
    r = await api(`/rdp/${rdpRec.vpsId}/usage`)
    assert.strictEqual(r.data.agent_reporting, false); assert.strictEqual(r.data.cpu, null); near(r.data.disk.percent, 50); assert.ok(/not reported recently/.test(r.data.notes[0]))
  })
  await t('errors: invalid period 400, other owner 404, wrong product 404, non-DO 501, provisioning 409', async () => {
    assert.strictEqual((await api(`/vps/${vps.vpsId}/usage?period=90d`)).data.error, 'invalid_period')
    assert.strictEqual((await api(`/vps/${foreign.vpsId}/usage`)).status, 404)
    assert.strictEqual((await api(`/rdp/${vps.vpsId}/usage`)).status, 404)
    const c = await api(`/vps/${contabo.vpsId}/usage`); assert.strictEqual(c.status, 501); assert.strictEqual(c.data.error, 'not_supported')
    const p = await api(`/vps/${prov2.vpsId}/usage`); assert.strictEqual(p.status, 409); assert.strictEqual(p.data.error, 'not_active')
    droplets.delete('701'); usage._cache.clear()
    const g = await api(`/vps/${vps.vpsId}/usage`); assert.strictEqual(g.status, 404); assert.strictEqual(g.data.error, 'not_found')
  })

  await t('API docs render and list both usage endpoints', () => {
    const html = require('../apidoc-page').renderApiDocPage('https://x/reseller/v1')
    assert.ok(html.includes('/vps/:id/usage') || (html.match(/id\/usage/g) || []).length >= 2)
    assert.ok(html.includes('sample_interval_seconds'))
  })

  server.close(); provSrv.close()
  await DB.dropDatabase(); await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
