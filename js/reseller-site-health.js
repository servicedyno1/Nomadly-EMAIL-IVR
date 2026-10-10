'use strict'
// Origin uptime monitor for reseller hosting + GET /hosting/:user/health.
// Probing the homepage would only ever see the Anti-Red decoy/challenge, but the Anti-Red worker
// passes static-asset requests straight to the origin through the Cloudflare Tunnel — so a
// cache-busted /favicon.ico request measures the REAL origin. A 5xx / 52x / 530 or a network error
// means visitors cannot reach the site. 3 failed checks in a row → hosting.site_down (once), the next
// good check → hosting.site_recovered. A failed DNS lookup triggers an automatic dns/repair.
const axios = require('axios')
const tls = require('tls')
const dnsRepair = require('./hosting-dns-repair')
const webhooks = require('./reseller-webhooks')
const activity = require('./reseller-activity')

const DAY = 86400000
const FAIL_THRESHOLD = 3
const REPAIR_COOLDOWN_MS = 30 * 60000
const MONITOR = 'resellerSiteHealth'
const CONCURRENCY = 5
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const cfHeaders = () => ({ 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY })

// true = resolves, false = no A answer, null = resolver unreachable (unknown).
async function resolves(name) {
  try {
    const r = await axios.get('https://cloudflare-dns.com/dns-query', { params: { name, type: 'A' }, headers: { accept: 'application/dns-json' }, timeout: 8000 })
    return Array.isArray(r.data && r.data.Answer) && r.data.Answer.some((a) => a.type === 1)
  } catch (_) { return null }
}

let _tunnel = { at: 0, value: null }
async function tunnelStatus() {
  if (_tunnel.value && Date.now() - _tunnel.at < 60000) return _tunnel.value
  const id = process.env.CF_TUNNEL_ID || String(process.env.CF_TUNNEL_CNAME || '').split('.')[0]
  const account = require('./honeypot-service').ACCOUNT_ID
  let value
  if (!id || !account) value = { connected: null, status: 'not_configured', connections: null }
  else {
    try {
      const r = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${account}/cfd_tunnel/${id}`, { headers: cfHeaders(), timeout: 10000 })
      const t = (r.data && r.data.result) || {}
      const conns = Array.isArray(t.connections) ? t.connections.length : null
      value = { connected: t.status === 'healthy' || t.status === 'degraded' || conns > 0, status: t.status || null, connections: conns }
    } catch (e) { value = { connected: null, status: 'unavailable', connections: null } }
  }
  _tunnel = { at: Date.now(), value }
  return value
}

async function probeOrigin(domain) {
  const t0 = Date.now()
  const checkedAt = new Date(t0).toISOString()
  try {
    const r = await axios.get(`https://${domain}/favicon.ico`, {
      params: { nh: t0 }, timeout: 15000, maxRedirects: 0, validateStatus: () => true, responseType: 'stream',
      headers: { 'User-Agent': BROWSER_UA, 'Cache-Control': 'no-cache' },
    })
    const ttfb = Date.now() - t0
    if (r.data && typeof r.data.destroy === 'function') r.data.destroy()
    if (r.headers && r.headers['cf-mitigated']) return { ok: null, http_status: r.status, ttfb_ms: ttfb, checked_at: checkedAt, error: 'probe_challenged' }
    const ok = r.status < 500
    return { ok, http_status: r.status, ttfb_ms: ttfb, checked_at: checkedAt, ...(ok ? {} : { error: [520, 521, 522, 523, 524, 525, 526, 530].includes(r.status) ? 'origin_unreachable' : 'origin_error' }) }
  } catch (e) { return { ok: false, http_status: null, ttfb_ms: null, checked_at: checkedAt, error: e.code || e.message } }
}

function sslInfo(domain) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate() || {}
      const until = c.valid_to ? new Date(c.valid_to) : null
      const valid = sock.authorized && !!until && until.getTime() > Date.now()
      resolve({
        valid, valid_until: until ? until.toISOString() : null, days_left: until ? Math.floor((until.getTime() - Date.now()) / DAY) : null,
        issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || null, ...(sock.authorized ? {} : { error: String(sock.authorizationError || 'untrusted') }),
      })
      sock.end()
    })
    sock.on('timeout', () => { sock.destroy(); resolve({ valid: null, valid_until: null, error: 'timeout' }) })
    sock.on('error', (e) => resolve({ valid: null, valid_until: null, error: e.code || e.message }))
  })
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
// PHP error_log lines look like "[10-Oct-2026 12:34:56 UTC] PHP Warning: …" (zone treated as UTC).
function countRecentPhpErrors(content, now = Date.now()) {
  let n = 0
  for (const line of String(content).split('\n')) {
    const m = /^\[(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})[^\]]*\]\s+PHP /.exec(line)
    if (!m || MONTHS[m[2]] == null) continue
    const t = Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6])
    if (t >= now - DAY && t <= now + 3600000) n++
  }
  return n
}

async function phpErrorsLast24h(cpUser) {
  const whm = require('./whm-service')._whmApi
  if (!whm) return { count: null, error: 'whm_unavailable' }
  const call = (func, params) => whm.get('/cpanel', { params: { 'api.version': 1, cpanel_jsonapi_user: cpUser, cpanel_jsonapi_apiversion: 3, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: func, ...params }, timeout: 15000 })
  try {
    const ls = (await call('list_files', { dir: '/public_html', types: 'file', only_these_files: 'error_log' })).data
    const res = ls && ls.result
    if (!res || res.status !== 1) return { count: null, error: ((res && res.errors) || ['list_files_failed']).join('; ') }
    const f = (res.data || []).find((x) => x.file === 'error_log')
    if (!f || !(Number(f.size) > 0) || Number(f.mtime) * 1000 < Date.now() - DAY) return { count: 0 }
    if (Number(f.size) > 2 * 1024 * 1024) return { count: null, error: 'error_log_too_large', bytes: Number(f.size) }
    const content = (await call('get_file_content', { dir: '/public_html', file: 'error_log' })).data?.result?.data?.content || ''
    return { count: countRecentPhpErrors(content) }
  } catch (e) { return { count: null, error: e.message } }
}

// Test seam: the sweep + checkHealth call probes through this object.
const probes = { resolves, tunnelStatus, probeOrigin, sslInfo, phpErrorsLast24h, repairAccount: (acct, opts) => dnsRepair.repairAccount(acct, opts), inspectDomain: (d) => dnsRepair.inspectDomain(d) }

function overallStatus({ dns, tunnel, origin, ssl }) {
  if (origin.ok === false || dns.apex === false) return 'down'
  if (origin.ok == null) return 'unknown'
  if (dns.www === false || tunnel.connected === false || (ssl && ssl.valid === false)) return 'degraded'
  return 'up'
}

async function checkHealth(acct, { deep = false } = {}) {
  const domain = String(acct.domain || '').toLowerCase()
  const [apex, www, tunnel, origin, ssl, php] = await Promise.all([
    probes.resolves(domain), probes.resolves(`www.${domain}`), probes.tunnelStatus(), probes.probeOrigin(domain),
    deep ? probes.sslInfo(domain) : null, deep ? probes.phpErrorsLast24h(acct.cpUser || acct._id) : null,
  ])
  const dns = { apex, www, ok: apex == null || www == null ? null : (apex && www) }
  const out = { domain, checked_at: origin.checked_at, dns, tunnel, origin, ...(deep ? { ssl, php_errors_last_24h: php.count, ...(php.error ? { php_errors_note: php.error } : {}) } : {}) }
  out.status = overallStatus(out)
  return out
}

async function monitoredAccounts(db) {
  const owners = (await db.collection('resellerApiKeys').distinct('ownerChatId', { enabled: true })).map(String)
  if (!owners.length) return []
  return db.collection('cpanelAccounts').find({
    chatId: { $in: owners }, deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true },
    provisionState: { $nin: ['provisioning', 'failed'] }, suspended: { $ne: true }, maintenanceMode: { $ne: true },
    expiryDate: { $gt: new Date() }, domain: { $exists: true, $nin: [null, ''] },
  }).toArray()
}

function emitFor(db, acct, event, payload, dedupKey, log) {
  activity.record(db, { ownerChatId: acct.chatId, resourceType: 'hosting', resourceId: acct._id, action: event.replace('hosting.site_', 'site.'), actor: 'system', details: payload })
  return webhooks.emit(db, { chatId: acct.chatId, event, instanceId: String(acct._id), dedupKey, payload: { username: String(acct._id), domain: acct.domain, ...payload }, log })
}

// One monitor tick for one account → { status, event, repaired }.
async function monitorAccount(db, acct, { now = Date.now(), log = () => {} } = {}) {
  const col = db.collection(MONITOR)
  const prev = (await col.findOne({ _id: acct._id })) || {}
  const h = await checkHealth(acct)
  const set = { ownerChatId: String(acct.chatId), domain: acct.domain, lastCheckedAt: new Date(now), lastCheck: { status: h.status, dns: h.dns, origin: h.origin, tunnel_connected: h.tunnel.connected } }
  const unset = {}
  let repaired = null
  if ((h.dns.apex === false || h.dns.www === false) && !(prev.lastRepairAt && now - new Date(prev.lastRepairAt).getTime() < REPAIR_COOLDOWN_MS)) {
    set.lastRepairAt = new Date(now)
    const r = await probes.repairAccount(acct, { apply: true }).catch((e) => ({ error: e.message, domains: [] }))
    repaired = (r.domains || []).flatMap((d) => (d.created || []).filter((c) => c.success).map((c) => c.name))
    if (repaired.length) activity.record(db, { ownerChatId: acct.chatId, resourceType: 'hosting', resourceId: acct._id, action: 'dns.repair', actor: 'system', details: { trigger: 'health_check', created: repaired } })
    else if (r.error) log(`[SiteHealth] dns repair for ${acct._id} failed: ${r.error}`)
  }
  let event = null
  if (h.status === 'down') {
    const fails = (prev.consecutiveFailures || 0) + 1
    const firstFailureAt = prev.firstFailureAt || new Date(now)
    Object.assign(set, { consecutiveFailures: fails, firstFailureAt, status: fails >= FAIL_THRESHOLD ? 'down' : (prev.status || 'unknown') })
    // Never alert for a site we have never seen up (e.g. nameservers not pointed yet).
    if (fails >= FAIL_THRESHOLD && !prev.downAlertedAt && prev.lastOkAt) {
      set.downAlertedAt = new Date(now)
      set.downSince = firstFailureAt
      event = emitFor(db, acct, 'hosting.site_down', {
        down_since: new Date(firstFailureAt).toISOString(), consecutive_failures: fails,
        checks: { dns: h.dns, origin: { http_status: h.origin.http_status, error: h.origin.error || null }, tunnel_connected: h.tunnel.connected },
        dns_repair_attempted: repaired !== null,
      }, `${acct._id}:down:${new Date(firstFailureAt).getTime()}`, log).then(() => 'hosting.site_down')
    }
  } else if (h.status !== 'unknown') {
    Object.assign(set, { consecutiveFailures: 0, status: 'up', lastOkAt: new Date(now) })
    Object.assign(unset, { firstFailureAt: '', downAlertedAt: '', downSince: '' })
    if (prev.downAlertedAt) {
      const since = new Date(prev.downSince || prev.downAlertedAt)
      event = emitFor(db, acct, 'hosting.site_recovered', {
        down_since: since.toISOString(), recovered_at: new Date(now).toISOString(), downtime_minutes: Math.max(0, Math.round((now - since.getTime()) / 60000)),
      }, `${acct._id}:recovered:${since.getTime()}`, log).then(() => 'hosting.site_recovered')
    }
  }
  await col.updateOne({ _id: acct._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true })
  return { status: set.status || prev.status || 'unknown', health: h.status, event: event ? await event : null, repaired }
}

async function runHealthSweep(db, { now = Date.now(), log = () => {} } = {}) {
  const accounts = await monitoredAccounts(db)
  const out = { checked: 0, events: [] }
  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const batch = await Promise.allSettled(accounts.slice(i, i + CONCURRENCY).map((a) => monitorAccount(db, a, { now, log })))
    for (const b of batch) {
      if (b.status === 'fulfilled') { out.checked++; if (b.value.event) out.events.push(b.value.event) }
      else log(`[SiteHealth] check failed: ${b.reason && b.reason.message}`)
    }
  }
  return out
}

const monitorView = (m) => (m ? {
  status: m.status || 'unknown', consecutive_failures: m.consecutiveFailures || 0,
  down_since: m.downSince ? new Date(m.downSince).toISOString() : null, last_ok_at: m.lastOkAt ? new Date(m.lastOkAt).toISOString() : null,
  last_checked_at: m.lastCheckedAt ? new Date(m.lastCheckedAt).toISOString() : null, last_dns_repair_at: m.lastRepairAt ? new Date(m.lastRepairAt).toISOString() : null,
} : null)

module.exports = { checkHealth, monitorAccount, runHealthSweep, monitoredAccounts, monitorView, countRecentPhpErrors, overallStatus, probes, FAIL_THRESHOLD, REPAIR_COOLDOWN_MS, MONITOR }
