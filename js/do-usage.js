// Usage metrics for DigitalOcean servers (read-only).
// VPS: DigitalOcean Monitoring API — CPU, bandwidth (always) + RAM, disk, load (metrics agent,
// installed on every VPS at creation). RDP (Windows, no DO agent): bandwidth from DigitalOcean,
// CPU/RAM/disk from our in-guest agent (apply.ps1 -Agent → /provision/commands, sampled every 5 min).
// Cached per server+period (longer periods longer — DO's sample interval grows with the range) to
// spare the shared DigitalOcean rate limit.
const doVps = require('./digitalocean-service')
const doRdp = require('./digitalocean-rdp-service')
const { instanceIdOf, rdpServerOf, PlanChangeError } = require('./do-plan-change')

const PERIODS = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 }
const CACHE_MS = { '1h': 60000, '24h': 120000, '7d': 600000, '30d': 1800000 }
const AGENT_FRESH_MS = 10 * 60000
const GIB = 1024 ** 3
const _cache = new Map()

const round = (n, d = 1) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d)
const clampPct = (n) => (n == null ? null : Math.min(100, Math.max(0, n)))
const pts = (s) => (s && Array.isArray(s.values) ? s.values.map(([t, v]) => [Number(t), Number(v)]).filter(([t, v]) => isFinite(t) && isFinite(v)) : [])
const iso = (sec) => new Date(sec * 1000).toISOString()

async function _metric(name, dropletId, start, end, extra = '') {
  const r = await doVps.apiRequest('GET', `/monitoring/metrics/droplet/${name}?host_id=${dropletId}&start=${start}&end=${end}${extra}`)
  return (r && r.data && r.data.result) || []
}

// Cumulative CPU seconds per mode → busy % between consecutive samples (counter resets skipped).
function cpuStats(result) {
  const byT = new Map()
  for (const s of result) {
    for (const [t, v] of pts(s)) {
      const e = byT.get(t) || { idle: 0, total: 0 }
      e.total += v
      if (s.metric && s.metric.mode === 'idle') e.idle += v
      byT.set(t, e)
    }
  }
  const ts = [...byT.keys()].sort((a, b) => a - b)
  const samples = []
  let busy = 0, total = 0
  for (let i = 1; i < ts.length; i++) {
    const a = byT.get(ts[i - 1]), b = byT.get(ts[i])
    const dt = b.total - a.total, di = b.idle - a.idle
    if (dt <= 0 || di < 0 || di > dt) continue
    samples.push(100 * (1 - di / dt)); busy += dt - di; total += dt
  }
  if (!samples.length) return null
  return { percent_now: round(clampPct(samples[samples.length - 1])), percent_avg: round(clampPct(100 * busy / total)), percent_peak: round(clampPct(Math.max(...samples))), last_sample_at: iso(ts[ts.length - 1]) }
}

// Mbps samples → now/avg/peak + GB transferred over the period (estimated from the sampled rate).
function rateStats(result) {
  const byT = new Map()
  for (const s of result) for (const [t, v] of pts(s)) byT.set(t, (byT.get(t) || 0) + v)
  const p = [...byT.entries()].sort((a, b) => a[0] - b[0])
  if (!p.length) return null
  let megabytes = 0
  for (let i = 1; i < p.length; i++) megabytes += p[i][1] * (p[i][0] - p[i - 1][0]) / 8
  const vals = p.map(([, v]) => v)
  return { now_mbps: round(vals[vals.length - 1], 3), avg_mbps: round(vals.reduce((a, b) => a + b, 0) / vals.length, 3), peak_mbps: round(Math.max(...vals), 3), gb: round(megabytes / 1000, 3) }
}

function memoryStats(totalRes, availRes) {
  const tot = new Map(pts(totalRes[0]))
  const pct = pts(availRes[0]).filter(([t]) => tot.get(t) > 0).map(([t, v]) => [t, 100 * (1 - v / tot.get(t))])
  if (!pct.length) return null
  const [lastT] = pct[pct.length - 1]
  const total = tot.get(lastT), avail = pts(availRes[0]).find(([t]) => t === lastT)[1]
  const vals = pct.map(([, v]) => v)
  return {
    total_gb: round(total / GIB, 2), used_gb: round((total - avail) / GIB, 2), available_gb: round(avail / GIB, 2),
    percent_now: round(clampPct(vals[vals.length - 1])), percent_avg: round(clampPct(vals.reduce((a, b) => a + b, 0) / vals.length)), percent_peak: round(clampPct(Math.max(...vals))),
  }
}

function diskStats(sizeRes, freeRes) {
  const pick = (res) => res.find((s) => s.metric && s.metric.mountpoint === '/') || res[0]
  const size = pts(pick(sizeRes)), free = pts(pick(freeRes))
  if (!size.length || !free.length) return null
  const total = size[size.length - 1][1], avail = free[free.length - 1][1]
  if (!(total > 0)) return null
  return { total_gb: round(total / GIB, 2), used_gb: round((total - avail) / GIB, 2), free_gb: round(avail / GIB, 2), percent: round(clampPct(100 * (1 - avail / total))) }
}

const lastVal = (res) => { const p = pts(res[0]); return p.length ? round(p[p.length - 1][1], 2) : null }

async function _droplet(id) {
  try { return (await doVps.apiRequest('GET', `/droplets/${id}`)).droplet } catch (e) {
    if (e.status === 404) throw new PlanChangeError('not_found', 'Server not found at the provider.', 404)
    throw new PlanChangeError('provider_error', `Provider unavailable: ${e.message}`, 502)
  }
}

const _specs = (d) => ({ vcpus: d.vcpus, ram_gb: round(d.memory / 1024, 2), disk_gb: d.disk, monthly_transfer_gb: d.size && d.size.transfer ? d.size.transfer * 1000 : null })

function _window(period, now = Date.now()) {
  const end = Math.floor(now / 1000)
  return { start: end - PERIODS[period], end }
}

async function _cached(key, period, fn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS[period]) return hit.value
  const value = await fn()
  _cache.set(key, { at: Date.now(), value })
  if (_cache.size > 500) _cache.delete(_cache.keys().next().value)
  return value
}

async function _bandwidth(dropletId, start, end) {
  const [inb, outb] = await Promise.allSettled([
    _metric('bandwidth', dropletId, start, end, '&interface=public&direction=inbound'),
    _metric('bandwidth', dropletId, start, end, '&interface=public&direction=outbound'),
  ])
  const p = inb.status === 'fulfilled' && inb.value[0] ? pts(inb.value[0]) : []
  return {
    inbound: inb.status === 'fulfilled' ? rateStats(inb.value) : null,
    outbound: outb.status === 'fulfilled' ? rateStats(outb.value) : null,
    interface: 'public', estimated: true, step: p.length > 1 ? p[1][0] - p[0][0] : null,
  }
}

async function vpsUsage(rec, period) {
  const dropletId = instanceIdOf(rec).replace(/^do-/i, '')
  return _cached(`vps:${dropletId}:${period}`, period, async () => {
    const d = await _droplet(dropletId)
    const { start, end } = _window(period)
    const agent = (d.features || []).includes('monitoring')
    const names = ['cpu', ...(agent ? ['memory_total', 'memory_available', 'filesystem_size', 'filesystem_free', 'load_1', 'load_5', 'load_15'] : [])]
    const [{ step, ...bandwidth }, ...settled] = await Promise.all([_bandwidth(dropletId, start, end), ...names.map((n) => _metric(n, dropletId, start, end).then((v) => v, () => null))])
    const m = Object.fromEntries(names.map((n, i) => [n, settled[i] || []]))
    const out = {
      period, from: iso(start), to: iso(end), sample_interval_seconds: step, status: d.status, specs: _specs(d), metrics_agent: agent,
      cpu: cpuStats(m.cpu), memory: agent ? memoryStats(m.memory_total, m.memory_available) : null,
      disk: agent ? diskStats(m.filesystem_size, m.filesystem_free) : null,
      load: agent ? { load_1: lastVal(m.load_1), load_5: lastVal(m.load_5), load_15: lastVal(m.load_15) } : null,
      bandwidth, notes: [],
    }
    if (!agent) out.notes.push('The monitoring agent is not installed on this server, so memory, disk and load are unavailable.')
    if (out.cpu === null && d.status === 'active') out.notes.push('No CPU samples yet for this period (new or recently restarted server).')
    return out
  })
}

// Agent sample → in-memory number or null.
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v))

async function rdpUsage(rec, period) {
  const server = await rdpServerOf(rec)
  return _cached(`rdp:${server.server_id}:${period}`, period, async () => {
    const d = await _droplet(server.do_droplet_id)
    const { start, end } = _window(period)
    const col = doRdp.agentMetricsCollection()
    const [{ step, ...bandwidth }, hist] = await Promise.all([
      _bandwidth(server.do_droplet_id, start, end),
      col ? col.find({ server_id: server.server_id, at: { $gte: new Date(start * 1000) } }).sort({ at: 1 }).limit(10000).toArray() : [],
    ])
    const now = server.agent_metrics || null
    const fresh = !!(now && now.at && Date.now() - new Date(now.at).getTime() < AGENT_FRESH_MS)
    const series = (f) => hist.map(f).filter((v) => v != null)
    const stats = (vals, cur) => (vals.length || cur != null ? {
      percent_now: cur != null ? round(clampPct(cur)) : null,
      percent_avg: vals.length ? round(clampPct(vals.reduce((a, b) => a + b, 0) / vals.length)) : null,
      percent_peak: vals.length ? round(clampPct(Math.max(...vals))) : null,
    } : null)
    const memPct = (m) => (num(m.mem_total) > 0 && num(m.mem_free) != null ? 100 * (1 - num(m.mem_free) / num(m.mem_total)) : null)
    const curCpu = fresh ? num(now.cpu_percent) : null
    const curMem = fresh ? memPct(now) : null
    const cpu = stats(series((h) => num(h.cpu_percent)), curCpu)
    const memS = stats(series(memPct), curMem)
    const out = {
      period, from: iso(start), to: iso(end), sample_interval_seconds: step, status: d.status, specs: _specs(d),
      metrics_agent: !!now, agent_reporting: fresh, agent_metrics_at: now && now.at ? new Date(now.at).toISOString() : null,
      cpu, memory: memS && now && num(now.mem_total) > 0 ? {
        total_gb: round(num(now.mem_total) / GIB, 2), used_gb: round((num(now.mem_total) - num(now.mem_free)) / GIB, 2), available_gb: round(num(now.mem_free) / GIB, 2), ...memS,
      } : memS,
      disk: now && num(now.disk_total) > 0 ? {
        drive: 'C:', total_gb: round(num(now.disk_total) / GIB, 2), used_gb: round((num(now.disk_total) - num(now.disk_free)) / GIB, 2), free_gb: round(num(now.disk_free) / GIB, 2),
        percent: round(clampPct(100 * (1 - num(now.disk_free) / num(now.disk_total)))),
      } : null,
      bandwidth, notes: [],
    }
    if (!now) out.notes.push('CPU, memory and disk appear after the server restarts once with the latest management agent.')
    else if (!fresh) out.notes.push('The management agent has not reported recently (server off or restarting); showing the last known disk usage.')
    return out
  })
}

module.exports = { PERIODS, vpsUsage, rdpUsage, cpuStats, rateStats, memoryStats, diskStats, _cache }
