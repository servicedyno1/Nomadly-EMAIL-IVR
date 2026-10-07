/* global process */
// ============================================================
// Vanity-Nameserver Pilot  (ns1/ns2.<NS_PILOT_DOMAIN>  →  Cloudflare NS IPs)
// ------------------------------------------------------------
// Goal: prove (or disprove) — on a FREE Cloudflare plan — that a zone keeps
// Cloudflare protection (status=active, proxied records answer with CF edge
// IPs, Workers run) when its registry delegation uses vanity nameserver
// NAMES (ns1/ns2.hosta.sh) whose glue IPs are Cloudflare's own NS IPs.
//
// State machine (one Mongo doc in `nsPilot`, _id = pilot domain):
//   init → awaiting_activation → ready_to_switch → monitoring → passed
//                                                  ↘ reverted (auto/manual)
//   1. Create CF zone for the pilot domain (Free plan) + records:
//        ns1/ns2  A  <CF NS IP>        (DNS-only, mirrors the glue)
//        pilot    A  <harmless origin> (PROXIED + shared anti-red Worker route)
//   2. Create glue at the registry via Namecheap (ns.create / ns.update).
//   3. Point the registrar at the CF-ASSIGNED nameservers → wait for "active".
//   4. Baseline check (proxy works under CF names) → switch registrar to the
//      vanity names.
//   5. Hourly monitor (platform cron → POST /cron/ns-pilot-tick):
//        • CF zone status            (active? moved? pending?)
//        • registry delegation       (raw query to the TLD servers)
//        • authoritative answer      (glue IPs → CF edge IPs, never origin)
//        • public resolvers          (1.1.1.1 / 8.8.8.8 via DoH)
//        • HTTP probe                (cf-ray header present)
//      ALARM (zone not active OR origin IP leaked) → auto-revert registrar to
//      the CF-assigned names (zone re-activates before CF's 7-day deletion).
//   6. After NS_PILOT_DAYS (default 14) of continuous protection → "passed".
//
// Env (all optional):
//   NS_PILOT_DOMAIN=hosta.sh   NS_PILOT_VANITY=ns1.hosta.sh,ns2.hosta.sh
//   NS_PILOT_PROBE_HOST=pilot.hosta.sh   NS_PILOT_ORIGIN_IP=192.64.119.228
//   NS_PILOT_DAYS=14   NS_PILOT_AUTO_REVERT=true
// ============================================================

const axios = require('axios')
const crypto = require('crypto')
const dgram = require('dgram')
const dnsPromises = require('dns').promises
const dnsPacket = require('dns-packet')

const cf = require('./cf-service')
const nc = require('./namecheap-service')

const CF_BASE = 'https://api.cloudflare.com/client/v4'
const cfHeaders = () => ({
  'X-Auth-Email': process.env.CLOUDFLARE_EMAIL,
  'X-Auth-Key': process.env.CLOUDFLARE_API_KEY,
  'Content-Type': 'application/json',
})

const STATE_COL = 'nsPilot'
const CHECKS_COL = 'nsPilotChecks'
const CRON_RUNS_COL = 'nsPilotCronRuns'
const ACTIVATION_RETRIGGER_MS = 55 * 60 * 1000
const DIGEST_EVERY_MS = 24 * 60 * 60 * 1000
const CHECK_RETENTION_DAYS = 45

// Cloudflare published IPv4 ranges (https://www.cloudflare.com/ips-v4)
const CF_V4_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
]

let _deps = { getDb: () => null, notifyAdmin: null, log: (...a) => console.log('[NsPilot]', ...a) }
let _running = false

const log = (...a) => _deps.log('[NsPilot]', ...a)
const now = () => new Date()

function config() {
  const domain = String(process.env.NS_PILOT_DOMAIN || 'hosta.sh').trim().toLowerCase()
  const vanity = String(process.env.NS_PILOT_VANITY || `ns1.${domain},ns2.${domain}`)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return {
    domain,
    vanity,
    probeHost: String(process.env.NS_PILOT_PROBE_HOST || `pilot.${domain}`).trim().toLowerCase(),
    originIp: String(process.env.NS_PILOT_ORIGIN_IP || '192.64.119.228').trim(),
    days: Number(process.env.NS_PILOT_DAYS || 14),
    autoRevert: String(process.env.NS_PILOT_AUTO_REVERT || 'true').toLowerCase() !== 'false',
  }
}

// ── IP helpers ──────────────────────────────────────────────
const ipToInt = (ip) => String(ip).split('.').reduce((acc, o) => ((acc << 8) + (Number(o) & 255)) >>> 0, 0)
function inCidr(ip, cidr) {
  const [base, bits] = cidr.split('/')
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask)
}
const isCloudflareIp = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip)) && CF_V4_RANGES.some((c) => inCidr(ip, c))
const normName = (n) => String(n || '').trim().toLowerCase().replace(/\.$/, '')
const sameSet = (a, b) => {
  const A = [...new Set((a || []).map(normName))].sort()
  const B = [...new Set((b || []).map(normName))].sort()
  return A.length === B.length && A.every((x, i) => x === B[i])
}

// ── Raw DNS (UDP) — needed to see the REGISTRY delegation, which recursive
//    resolvers hide (CF answers the apex NS RRset with its own names). ──
function rawQuery(serverIp, name, type, { rd = false, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    let done = false
    const sock = dgram.createSocket('udp4')
    const finish = (val) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.close() } catch (_) { /* noop */ }
      resolve(val)
    }
    const timer = setTimeout(() => finish({ ok: false, server: serverIp, error: 'timeout' }), timeout)
    sock.on('error', (e) => finish({ ok: false, server: serverIp, error: e.message }))
    sock.on('message', (msg) => {
      try {
        const p = dnsPacket.decode(msg)
        finish({
          ok: true,
          server: serverIp,
          rcode: p.rcode,
          aa: !!p.flag_aa,
          answers: (p.answers || []).map((r) => ({ name: r.name, type: r.type, data: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) })),
          authorities: (p.authorities || []).map((r) => ({ name: r.name, type: r.type, data: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) })),
          additionals: (p.additionals || []).filter((r) => r.type !== 'OPT').map((r) => ({ name: r.name, type: r.type, data: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) })),
        })
      } catch (e) {
        finish({ ok: false, server: serverIp, error: `decode: ${e.message}` })
      }
    })
    const buf = dnsPacket.encode({
      type: 'query',
      id: crypto.randomInt(1, 65535),
      flags: rd ? dnsPacket.RECURSION_DESIRED : 0,
      questions: [{ type, name }],
    })
    sock.send(buf, 53, serverIp, (err) => { if (err) finish({ ok: false, server: serverIp, error: err.message }) })
  })
}

async function resolveFirstIpv4(host) {
  try {
    const ips = await dnsPromises.resolve4(host)
    return ips[0] || null
  } catch (_) {
    // Fallback via DoH
    const r = await doh(host, 'A', 'cloudflare')
    return (r.answers || []).find((x) => /^\d/.test(x)) || null
  }
}

let _tldServerCache = { tld: null, ips: [], at: 0 }
async function tldServerIps(tld) {
  if (_tldServerCache.tld === tld && _tldServerCache.ips.length && Date.now() - _tldServerCache.at < 6 * 3600 * 1000) {
    return _tldServerCache.ips
  }
  const names = await dnsPromises.resolveNs(tld)
  const ips = []
  for (const n of names.slice(0, 4)) {
    const ip = await resolveFirstIpv4(n)
    if (ip) ips.push(ip)
  }
  _tldServerCache = { tld, ips, at: Date.now() }
  return ips
}

async function registryDelegation(domain) {
  const tld = domain.split('.').pop()
  const servers = await tldServerIps(tld)
  for (const ip of servers) {
    const r = await rawQuery(ip, domain, 'NS', { rd: false })
    if (!r.ok) continue
    const ns = [...r.authorities, ...r.answers].filter((x) => x.type === 'NS').map((x) => normName(x.data))
    const glue = r.additionals.filter((x) => x.type === 'A').map((x) => ({ name: normName(x.name), ip: x.data }))
    return { ok: true, server: ip, rcode: r.rcode, nameservers: [...new Set(ns)], glue }
  }
  return { ok: false, error: 'no TLD server answered', servers }
}

async function doh(name, type, provider = 'cloudflare') {
  const url = provider === 'google'
    ? `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`
    : `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  try {
    const r = await axios.get(url, { headers: { accept: 'application/dns-json' }, timeout: 8000 })
    return { ok: true, provider, status: r.data?.Status, answers: (r.data?.Answer || []).map((a) => normName(a.data)) }
  } catch (e) {
    return { ok: false, provider, error: e.message }
  }
}

async function httpProbe(url) {
  try {
    const r = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NsPilotMonitor/1.0)' },
    })
    return {
      ok: true,
      status: r.status,
      cfRay: r.headers['cf-ray'] || null,
      server: r.headers.server || null,
      location: r.headers.location || null,
    }
  } catch (e) {
    return { ok: false, error: e.code || e.message }
  }
}

// ── Cloudflare helpers not covered by cf-service ─────────────
async function cfGetZone(zoneId) {
  try {
    const r = await axios.get(`${CF_BASE}/zones/${zoneId}`, { headers: cfHeaders(), timeout: 15000 })
    const z = r.data?.result
    return z ? { found: true, id: z.id, status: z.status, nameservers: z.name_servers || [], activatedOn: z.activated_on || null, plan: z.plan?.name || null } : { found: false }
  } catch (e) {
    const st = e.response?.status
    if (st === 404 || st === 403 || st === 400) return { found: false, httpStatus: st }
    return { found: null, error: e.message }
  }
}

async function cfTriggerActivationCheck(zoneId) {
  try {
    const r = await axios.put(`${CF_BASE}/zones/${zoneId}/activation_check`, {}, { headers: cfHeaders(), timeout: 15000 })
    return { ok: !!r.data?.success }
  } catch (e) {
    return { ok: false, error: e.response?.data?.errors?.[0]?.message || e.message }
  }
}

async function ensureRecord(zoneId, type, name, content, proxied, ttl) {
  const existing = (await cf.listDNSRecords(zoneId)).filter((r) => normName(r.name) === normName(name))
  const same = existing.find((r) => r.type === type && r.content === content && !!r.proxied === !!proxied)
  if (same) return { action: 'unchanged', id: same.id }
  // Remove conflicting A/AAAA/CNAME on that exact name, then create.
  for (const r of existing.filter((x) => ['A', 'AAAA', 'CNAME'].includes(x.type))) {
    await cf.deleteDNSRecord(zoneId, r.id)
  }
  const c = await cf.createDNSRecord(zoneId, type, name, content, ttl, proxied)
  return { action: c?.success === false ? 'failed' : 'created', result: c }
}

// ── State helpers ───────────────────────────────────────────
function db() {
  const d = _deps.getDb()
  if (!d) throw new Error('Database not ready')
  return d
}
async function loadState() {
  return db().collection(STATE_COL).findOne({ _id: config().domain })
}
async function saveState(patch) {
  const { domain } = config()
  await db().collection(STATE_COL).updateOne({ _id: domain }, { $set: { ...patch, updatedAt: now() } }, { upsert: true })
  return loadState()
}
async function addEvent(type, message, { notify = false } = {}) {
  const { domain } = config()
  const ev = { at: now(), type, message }
  await db().collection(STATE_COL).updateOne(
    { _id: domain },
    { $push: { events: { $each: [ev], $slice: -200 } }, $set: { updatedAt: now() } },
    { upsert: true },
  )
  log(`${type}: ${message}`)
  if (notify && typeof _deps.notifyAdmin === 'function') {
    try { _deps.notifyAdmin(`🧪 <b>NS Pilot (${domain})</b>\n${message}`) } catch (_) { /* noop */ }
  }
  return ev
}

// ── Health check (no side effects) ──────────────────────────
async function runChecks(state) {
  const cfg = config()
  const zone = state?.zoneId ? await cfGetZone(state.zoneId) : { found: false }
  const delegation = await registryDelegation(cfg.domain).catch((e) => ({ ok: false, error: e.message }))

  // Ask every NS currently delegated (via glue/IP) + the CF-assigned ones, so we
  // can compare "through the vanity names" vs "through CF names".
  const targets = []
  for (const g of delegation.glue || []) targets.push({ via: g.name, ip: g.ip })
  for (const n of state?.cfAssignedNs || []) {
    const ip = await resolveFirstIpv4(n)
    if (ip) targets.push({ via: n, ip })
  }
  const authoritative = []
  for (const t of targets) {
    const r = await rawQuery(t.ip, cfg.probeHost, 'A', { rd: false })
    const ips = (r.answers || []).filter((x) => x.type === 'A').map((x) => x.data)
    authoritative.push({ via: t.via, ip: t.ip, ok: r.ok, rcode: r.rcode, aa: r.aa, ips, allCloudflare: ips.length > 0 && ips.every(isCloudflareIp), originLeak: ips.includes(cfg.originIp), error: r.error })
  }
  const pubCf = await doh(cfg.probeHost, 'A', 'cloudflare')
  const pubGoogle = await doh(cfg.probeHost, 'A', 'google')
  const pubNs = await doh(cfg.domain, 'NS', 'google')
  const http = await httpProbe(`http://${cfg.probeHost}/`)
  const https = await httpProbe(`https://${cfg.probeHost}/`)

  const publicIps = [...(pubCf.answers || []), ...(pubGoogle.answers || [])].filter((x) => /^\d/.test(x))
  const originLeak = authoritative.some((a) => a.originLeak) || publicIps.includes(cfg.originIp)
  const answered = authoritative.filter((a) => a.ok && a.ips.length)
  const proxied = answered.length > 0 && answered.every((a) => a.allCloudflare)
  const delegatedToVanity = delegation.ok && sameSet(delegation.nameservers, cfg.vanity)
  const delegatedToCf = delegation.ok && sameSet(delegation.nameservers, state?.cfAssignedNs || [])
  const zoneActive = zone.found === true && zone.status === 'active'
  const cfEdge = !!(http.cfRay || https.cfRay)

  return {
    at: now(),
    zone,
    delegation,
    delegatedToVanity,
    delegatedToCf,
    authoritative,
    publicResolvers: { cloudflare: pubCf, google: pubGoogle },
    publicNsView: pubNs.answers || [],
    http,
    https,
    verdict: {
      zoneActive,
      dnsAnswered: answered.length > 0,
      proxied,
      originLeak,
      cfEdge,
      protected: zoneActive && proxied && !originLeak,
    },
  }
}

async function recordCheck(phase, check) {
  try {
    await db().collection(CHECKS_COL).insertOne({ _id: crypto.randomUUID(), domain: config().domain, phase, ...check })
    const cutoff = new Date(Date.now() - CHECK_RETENTION_DAYS * 86400000)
    await db().collection(CHECKS_COL).deleteMany({ domain: config().domain, at: { $lt: cutoff } })
  } catch (e) {
    log(`recordCheck error: ${e.message}`)
  }
}

// ── Actions ─────────────────────────────────────────────────
async function revertToCloudflare(reason, { manual = false } = {}) {
  const cfg = config()
  const st = await loadState()
  if (!st?.cfAssignedNs?.length) throw new Error('No CF-assigned nameservers recorded — cannot revert')
  await nc.setCustomNameservers(cfg.domain, st.cfAssignedNs)
  const act = st.zoneId ? await cfTriggerActivationCheck(st.zoneId) : { ok: false }
  await saveState({ phase: 'reverted', revertedAt: now(), revertReason: reason, lastActivationCheckAt: now() })
  await addEvent(manual ? 'manual_revert' : 'auto_revert',
    `↩️ Registrar switched BACK to Cloudflare names (${st.cfAssignedNs.join(', ')}). Reason: ${reason}. Activation re-check: ${act.ok ? 'triggered' : 'not triggered'}`,
    { notify: true })
  return loadState()
}

async function switchToVanity({ manual = false } = {}) {
  const cfg = config()
  await nc.setCustomNameservers(cfg.domain, cfg.vanity)
  const st = await saveState({ phase: 'monitoring', switchedAt: now(), revertedAt: null, revertReason: null, consecutiveAlarms: 0, passedAt: null })
  await addEvent(manual ? 'manual_switch' : 'switched',
    `🔀 Registrar delegation switched to vanity nameservers: ${cfg.vanity.join(', ')}. Monitoring for ${cfg.days} days.`,
    { notify: true })
  return st
}

async function start() {
  const cfg = config()
  const existing = await loadState()
  if (existing?.enabled) return existing
  await saveState({
    enabled: true,
    phase: existing?.phase || 'init',
    vanity: cfg.vanity,
    probeHost: cfg.probeHost,
    originIp: cfg.originIp,
    createdAt: existing?.createdAt || now(),
  })
  await addEvent('started', `Pilot started for ${cfg.domain} with vanity NS ${cfg.vanity.join(', ')}`, { notify: true })
  return loadState()
}

async function stop() {
  await saveState({ enabled: false })
  await addEvent('stopped', 'Pilot monitoring stopped (registrar delegation left as-is)', { notify: true })
  return loadState()
}

// ── The tick: advance state machine + monitor ───────────────
async function tick({ source = 'manual' } = {}) {
  if (_running) return { skipped: 'already-running' }
  _running = true
  const cfg = config()
  try {
    let st = await loadState()
    if (!st?.enabled) return { skipped: 'not-enabled' }
    const steps = []

    // 1) Cloudflare zone
    if (!st.zoneId) {
      const z = await cf.createZone(cfg.domain)
      if (!z?.success) throw new Error(`CF createZone failed: ${JSON.stringify(z?.errors || z)}`)
      st = await saveState({ zoneId: z.zoneId, cfAssignedNs: (z.nameservers || []).map(normName) })
      await addEvent('zone_created', `Cloudflare zone ready (${z.zoneId}), assigned NS: ${(z.nameservers || []).join(', ')} — status ${z.status}`, { notify: true })
      steps.push('zone_created')
    }

    // 2) Glue IPs (vanity[i] → IP of CF-assigned NS[i]) + mirror records + probe host
    if (!st.glueReady || !st.recordsReady) {
      const glue = {}
      for (let i = 0; i < cfg.vanity.length; i++) {
        const cfNs = st.cfAssignedNs[i % st.cfAssignedNs.length]
        const ip = await resolveFirstIpv4(cfNs)
        if (!ip) throw new Error(`Could not resolve IPv4 for ${cfNs}`)
        glue[cfg.vanity[i]] = { ip, mirrors: cfNs }
      }
      if (!st.glueReady) {
        const results = []
        for (const [ns, g] of Object.entries(glue)) {
          results.push(await nc.ensureChildNameserver(cfg.domain, ns, g.ip))
        }
        st = await saveState({ glue, glueReady: true, glueAt: now() })
        await addEvent('glue_ready', `Glue records at registry: ${results.map((r) => `${r.nameserver} → ${r.ip} (${r.action})`).join('; ')}`, { notify: true })
        steps.push('glue_ready')
      }
      if (!st.recordsReady) {
        const out = []
        for (const [ns, g] of Object.entries(glue)) {
          out.push(`${ns}: ${(await ensureRecord(st.zoneId, 'A', ns, g.ip, false, 3600)).action}`)
        }
        out.push(`${cfg.probeHost}: ${(await ensureRecord(st.zoneId, 'A', cfg.probeHost, cfg.originIp, true, 1)).action}`)
        let worker = null
        try {
          const antiRed = require('./anti-red-service')
          worker = await antiRed.deploySharedWorkerRoute(cfg.probeHost, st.zoneId)
        } catch (e) { worker = { success: false, error: e.message } }
        st = await saveState({ recordsReady: true, workerRoute: { success: !!worker?.success, status: worker?.status || worker?.error || null } })
        await addEvent('records_ready', `Zone records: ${out.join(', ')}; anti-red Worker route on ${cfg.probeHost}: ${worker?.success ? worker.status : `FAILED (${worker?.error})`}`)
        steps.push('records_ready')
      }
    }

    // 3) Point registrar at CF-assigned NS (only before first switch)
    if (st.phase === 'init') {
      await nc.setCustomNameservers(cfg.domain, st.cfAssignedNs)
      const act = await cfTriggerActivationCheck(st.zoneId)
      st = await saveState({ phase: 'awaiting_activation', cfNsSetAt: now(), lastActivationCheckAt: now() })
      await addEvent('cf_ns_set', `Registrar set to Cloudflare-assigned NS (${st.cfAssignedNs.join(', ')}). Activation check ${act.ok ? 'triggered' : `not triggered (${act.error})`}. Waiting for zone to become active…`, { notify: true })
      steps.push('cf_ns_set')
    }

    // 4) Monitor / advance
    const check = await runChecks(st)
    await recordCheck(st.phase, check)
    const v = check.verdict
    const patch = {
      lastCheck: {
        at: check.at, zoneStatus: check.zone.status || (check.zone.found === false ? 'not_found' : 'unknown'),
        delegation: check.delegation.nameservers || [], delegatedToVanity: check.delegatedToVanity,
        verdict: v, httpStatus: check.http.status || null, httpsStatus: check.https.status || null,
        publicNsView: check.publicNsView,
      },
      lastCheckSource: source,
    }

    if (st.phase === 'awaiting_activation') {
      if (v.zoneActive) {
        st = await saveState({ ...patch, phase: 'ready_to_switch', activatedAt: now() })
        await addEvent('activated', `✅ Zone is ACTIVE on Cloudflare under the standard names. Baseline proxy check: ${v.proxied ? 'proxied ✅' : 'not proxied yet'}${v.cfEdge ? ', CF edge reachable' : ''}.`, { notify: true })
        steps.push('activated')
      } else {
        const last = st.lastActivationCheckAt ? new Date(st.lastActivationCheckAt).getTime() : 0
        if (st.zoneId && Date.now() - last > ACTIVATION_RETRIGGER_MS) {
          await cfTriggerActivationCheck(st.zoneId)
          patch.lastActivationCheckAt = now()
        }
        st = await saveState(patch)
      }
    }

    if (st.phase === 'ready_to_switch') {
      // Re-use the fresh check: require proxy to be working under CF names first
      if (v.zoneActive && v.proxied && !v.originLeak) {
        st = await saveState({ ...patch, baseline: { at: now(), verdict: v, httpStatus: check.http.status || null, cfRay: !!check.http.cfRay } })
        st = await switchToVanity()
        steps.push('switched')
      } else {
        st = await saveState(patch)
        steps.push('waiting_for_baseline')
      }
    }

    if (st.phase === 'monitoring' || st.phase === 'passed') {
      const alarmReasons = []
      if (check.zone.found === false) alarmReasons.push('zone missing from Cloudflare')
      else if (check.zone.found === true && check.zone.status !== 'active') alarmReasons.push(`zone status is "${check.zone.status}"`)
      if (v.originLeak) alarmReasons.push(`origin IP ${cfg.originIp} returned by DNS (proxy OFF)`)
      if (check.zone.found === true && check.zone.status === 'active' && v.dnsAnswered && !v.proxied) alarmReasons.push('authoritative answer is not Cloudflare edge IPs')

      const prevProtected = st.lastCheck?.verdict?.protected
      if (alarmReasons.length) {
        const consecutive = (st.consecutiveAlarms || 0) + 1
        st = await saveState({ ...patch, consecutiveAlarms: consecutive, lastAlarmAt: now() })
        await addEvent('alarm', `🚨 Protection check FAILED (${consecutive}x): ${alarmReasons.join('; ')}`, { notify: true })
        if (cfg.autoRevert) {
          st = await revertToCloudflare(alarmReasons.join('; '))
          steps.push('auto_reverted')
        }
      } else {
        st = await saveState({ ...patch, consecutiveAlarms: 0 })
        if (prevProtected === false) await addEvent('recovered', '✅ Protection checks passing again', { notify: true })
        const switchedAt = st.switchedAt ? new Date(st.switchedAt).getTime() : Date.now()
        const daysOn = (Date.now() - switchedAt) / 86400000
        if (st.phase === 'monitoring' && daysOn >= cfg.days) {
          st = await saveState({ phase: 'passed', passedAt: now() })
          await addEvent('passed', `🏁 PILOT PASSED — ${cfg.days} days on vanity nameservers with the zone ACTIVE and proxied. Safe to roll out to the reseller API.`, { notify: true })
          steps.push('passed')
        }
      }
    }

    if (st.phase === 'reverted') {
      st = await saveState(patch)
      if (v.zoneActive && !st.revertConfirmedAt) {
        st = await saveState({ revertConfirmedAt: now() })
        await addEvent('revert_confirmed', '✅ After revert, zone is ACTIVE again on Cloudflare names.', { notify: true })
      }
    }

    // Daily digest
    const lastDigest = st.lastDigestAt ? new Date(st.lastDigestAt).getTime() : 0
    if (Date.now() - lastDigest > DIGEST_EVERY_MS && ['monitoring', 'passed', 'reverted', 'awaiting_activation'].includes(st.phase)) {
      const days = st.switchedAt ? ((Date.now() - new Date(st.switchedAt).getTime()) / 86400000).toFixed(1) : '0'
      await addEvent('digest',
        `📊 Daily status — phase <b>${st.phase}</b>, day ${days}/${cfg.days}\n` +
        `• CF zone: ${patch.lastCheck.zoneStatus}\n` +
        `• Registry NS: ${(patch.lastCheck.delegation || []).join(', ') || 'n/a'}\n` +
        `• Proxied: ${v.proxied ? 'yes' : 'no'} | Origin leak: ${v.originLeak ? 'YES' : 'no'} | CF edge: ${v.cfEdge ? 'yes' : 'no'}\n` +
        `• Public NS view: ${(check.publicNsView || []).join(', ') || 'n/a'}`,
        { notify: true })
      st = await saveState({ lastDigestAt: now() })
    }

    return { ok: true, phase: st.phase, steps, verdict: v, delegation: check.delegation.nameservers || [], zoneStatus: patch.lastCheck.zoneStatus }
  } catch (e) {
    log(`tick error: ${e.message}`)
    try {
      // Surface tick failures to admin, throttled to one alert per 6h per distinct message.
      const st = await loadState().catch(() => null)
      const lastAt = st?.lastErrorNotifyAt ? new Date(st.lastErrorNotifyAt).getTime() : 0
      const notify = st?.lastErrorNotifyMsg !== e.message || Date.now() - lastAt > 6 * 3600 * 1000
      await addEvent('error', `⚠️ Tick error: ${e.message}`, { notify })
      if (notify) await saveState({ lastErrorNotifyAt: now(), lastErrorNotifyMsg: e.message })
    } catch (_) { /* noop */ }
    return { ok: false, error: e.message }
  } finally {
    _running = false
  }
}

async function status({ checks = 24 } = {}) {
  const st = await loadState()
  const recent = await db().collection(CHECKS_COL)
    .find({ domain: config().domain }, { projection: { _id: 0 } })
    .sort({ at: -1 }).limit(Math.min(Number(checks) || 24, 200)).toArray()
  return { config: config(), state: st, recentChecks: recent }
}

// ── HTTP routes ─────────────────────────────────────────────
function _adminOk(req) {
  const key = String(req.query?.key || req.headers['x-admin-key'] || '')
  const expected = String(process.env.SESSION_SECRET || '').slice(0, 16)
  return !!expected && key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))
}

function _cronAuthOk(req) {
  const secret = String(process.env.WEBHOOK_CRON_SECRET || '')
  const h = String(req.headers.authorization || '')
  if (!secret || !h.startsWith('Bearer ')) return false
  const token = h.slice(7).trim()
  const a = crypto.createHash('sha256').update(token).digest()
  const b = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(a, b)
}

function registerRoutes(app) {
  const guard = (fn) => async (req, res) => {
    if (!_adminOk(req)) return res.status(403).json({ error: 'Unauthorized' })
    try { res.json(await fn(req)) } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
  }
  app.get('/admin/ns-pilot/status', guard((req) => status({ checks: req.query.checks })))
  // Mutations are POST-only (never triggerable by a prefetch/crawler GET).
  app.post('/admin/ns-pilot/start', guard(async () => { await start(); return tick({ source: 'start' }) }))
  app.post('/admin/ns-pilot/tick', guard(() => tick({ source: 'manual' })))
  app.post('/admin/ns-pilot/revert', guard(async (req) => revertToCloudflare(String(req.query.reason || req.body?.reason || 'manual revert'), { manual: true })))
  app.post('/admin/ns-pilot/switch', guard(async () => switchToVanity({ manual: true })))
  app.post('/admin/ns-pilot/stop', guard(() => stop()))

  // Platform cron (.emergent/crons.yml → POST {{BASE_URL}}/api/cron/ns-pilot-tick)
  app.post('/cron/ns-pilot-tick', async (req, res) => {
    // Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if (!_cronAuthOk(req)) return res.status(401).json({ error: 'unauthorized' })
    if (req.body !== undefined && req.body !== null && typeof req.body !== 'object') {
      return res.status(400).json({ error: 'invalid body' })
    }
    const runId = String(req.headers['x-webhook-id'] || req.body?.run_id || '') || `anon-${crypto.randomUUID()}`
    try {
      await db().collection(CRON_RUNS_COL).insertOne({ _id: runId, at: now() })
    } catch (e) {
      if (e?.code === 11000) return res.status(200).json({ accepted: false, duplicate: true })
      return res.status(503).json({ error: 'not ready' })
    }
    res.status(202).json({ accepted: true, runId })
    setImmediate(() => {
      tick({ source: 'cron' }).catch((e) => log(`cron tick error: ${e.message}`))
      db().collection(CRON_RUNS_COL).deleteMany({ at: { $lt: new Date(Date.now() - 7 * 86400000) } }).catch(() => {})
    })
  })
}

function init({ app, getDb, notifyAdmin, log: logger } = {}) {
  _deps = {
    getDb: getDb || (() => null),
    notifyAdmin: notifyAdmin || null,
    log: logger || ((...a) => console.log(...a)),
  }
  if (app) registerRoutes(app)
  startFallbackScheduler()
  log('routes mounted: /admin/ns-pilot/{status,start,tick,revert,switch,stop}, /cron/ns-pilot-tick')
}

// ── Fallback scheduler ──────────────────────────────────────
// Primary trigger is the platform cron (.emergent/crons.yml). If that cron is
// not installed/reachable on this pod, this light watchdog runs the tick only
// when no tick has happened recently — so it never double-runs alongside the
// platform cron. Faster cadence while waiting for activation so the switch
// happens soon after Cloudflare activates the zone. Disable with
// NS_PILOT_FALLBACK_TIMER=false.
let _fallbackTimer = null
const FALLBACK_POLL_MS = 5 * 60 * 1000
function startFallbackScheduler() {
  if (_fallbackTimer || String(process.env.NS_PILOT_FALLBACK_TIMER || 'true').toLowerCase() === 'false') return
  _fallbackTimer = setInterval(async () => {
    try {
      if (!_deps.getDb()) return
      const st = await loadState()
      if (!st?.enabled) return
      const fast = ['init', 'awaiting_activation', 'ready_to_switch'].includes(st.phase)
      const gapMs = (fast ? 14 : 55) * 60 * 1000
      const last = st.lastCheck?.at ? new Date(st.lastCheck.at).getTime() : 0
      if (Date.now() - last < gapMs) return
      await tick({ source: 'fallback-timer' })
    } catch (e) {
      log(`fallback scheduler error: ${e.message}`)
    }
  }, FALLBACK_POLL_MS)
  if (typeof _fallbackTimer.unref === 'function') _fallbackTimer.unref()
}

module.exports = {
  init,
  tick,
  start,
  stop,
  status,
  runChecks,
  revertToCloudflare,
  switchToVanity,
  // exported for tests
  _internals: { isCloudflareIp, inCidr, sameSet, rawQuery, registryDelegation, config },
}
