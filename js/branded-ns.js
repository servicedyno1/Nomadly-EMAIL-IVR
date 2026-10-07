/* global process */
// ============================================================
// Branded nameservers for the RESELLER API  (default: ns1/ns2.hosta.sh)
// ------------------------------------------------------------
// The Telegram bot keeps using Cloudflare's assigned nameservers. Domains
// registered through the reseller API (POST /domains/register and
// POST /hosting with domain_mode=buy) default to BRANDED nameservers whose
// glue records point at Cloudflare's own NS IPs (see ns-pilot.js), so the
// zone stays on Cloudflare (proxy, WAF, anti-red Worker) while the registry
// shows ns1/ns2.hosta.sh.
//
// Why two steps: a Free Cloudflare zone only ACTIVATES when the registry lists
// the exact CF-assigned names, and a PENDING zone serves proxied records as
// DNS-only (origin IP leak). So every domain is registered on the CF-assigned
// names first; this worker switches the registrar to the branded names only
// after the zone is ACTIVE and its proxied records answer with CF edge IPs.
//
// Per-domain lifecycle (collection `brandedNsDomains`, _id = domain):
//   activating → branded            (zone active + proxy verified → registrar switched)
//   activating → branding_failed    (zone never activated / registrar refused — stays on CF names)
//   branded    → reverted           (zone not active / missing / origin exposed → back to CF names)
//   any        → cancelled          (owner set other nameservers — we never fight the owner)
//
// Env:
//   RESELLER_BRANDED_NS_ENABLED=true          default ON for new reseller domains
//   RESELLER_BRANDED_NS=ns1.hosta.sh,ns2.hosta.sh
//   RESELLER_BRANDED_NS_ACTIVATION_TIMEOUT_HOURS=72
//   RESELLER_BRANDED_NS_MONITOR_MIN=60
//   RESELLER_BRANDED_NS_WORKER_MS=300000
// ============================================================

const crypto = require('crypto')

const COL = 'brandedNsDomains'
const LOCK_MS = 10 * 60 * 1000
const BATCH = 25
const MAX_SWITCH_ATTEMPTS = 6
const MAX_ZONE_LOOKUP_ATTEMPTS = 6
const ACTIVATION_RETRIGGER_MS = 55 * 60 * 1000

const OPEN_STATUSES = ['activating', 'branded']

let _deps = {
  getDb: () => null,
  notifyAdmin: null,
  log: (...a) => console.log(...a),
  // overridable for tests
  cf: null,
  domainService: null,
  probes: null,
  emitWebhook: null,
}
let _running = false
let _timer = null

const log = (...a) => _deps.log('[BrandedNS]', ...a)
const now = () => new Date()
const addMin = (m) => new Date(Date.now() + m * 60 * 1000)

function cf() { return _deps.cf || require('./cf-service') }
function domainService() { return _deps.domainService || require('./domain-service') }
function probes() { return _deps.probes || require('./ns-pilot').probes }

// ── Config / pure helpers ───────────────────────────────────
const normName = (n) => String(n || '').trim().toLowerCase().replace(/\.$/, '')
const sameSet = (a, b) => {
  const A = [...new Set((a || []).map(normName).filter(Boolean))].sort()
  const B = [...new Set((b || []).map(normName).filter(Boolean))].sort()
  return A.length > 0 && A.length === B.length && A.every((x, i) => x === B[i])
}

function brandedNameservers() {
  return [...new Set(String(process.env.RESELLER_BRANDED_NS || 'ns1.hosta.sh,ns2.hosta.sh')
    .split(',').map(normName).filter(Boolean))]
}
function isEnabled() {
  return String(process.env.RESELLER_BRANDED_NS_ENABLED || 'true').toLowerCase() !== 'false' && brandedNameservers().length >= 2
}
function isBrandedNs(host) { return brandedNameservers().includes(normName(host)) }
/** Exact branded set (order-insensitive). Recognised even when the feature flag is off,
 *  so already-branded domains keep their Cloudflare linkage. */
function isBrandedSet(list) { return Array.isArray(list) && sameSet(list, brandedNameservers()) }

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

function validateNameservers(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'nameservers must be an array of hostnames, e.g. ["ns1.example.com","ns2.example.com"]' }
  const norm = [...new Set(list.map(normName).filter(Boolean))]
  if (norm.length < 2) return { ok: false, error: 'Provide at least 2 distinct nameservers.' }
  if (norm.length > 4) return { ok: false, error: 'At most 4 nameservers are supported.' }
  const bad = norm.filter((n) => !HOST_RE.test(n))
  if (bad.length) return { ok: false, error: `Invalid nameserver hostname(s): ${bad.join(', ')}` }
  return { ok: true, nameservers: norm }
}

/**
 * Decide how a reseller registration should be delegated.
 *   nameservers (array)   → custom (or branded if it equals the branded set) — overrides ns_choice
 *   ns_choice "branded"   → branded (default when enabled)
 *   ns_choice "cloudflare"→ Cloudflare-assigned names
 *   ns_choice "registrar" → registrar default NS (domains only; not allowed for hosting)
 * Returns { ok, mode, registerChoice, customNS, error, code }.
 */
function resolveNsChoice({ ns_choice: rawChoice, nameservers, forHosting = false } = {}) {
  const hasNs = Array.isArray(nameservers) ? nameservers.length > 0 : (nameservers != null && nameservers !== '')
  if (hasNs) {
    if (forHosting) {
      return { ok: false, code: 'nameservers_not_supported', error: 'Hosting with a new domain always uses protected DNS. Omit "nameservers" and use ns_choice "branded" (default) or "cloudflare".' }
    }
    const v = validateNameservers(nameservers)
    if (!v.ok) return { ok: false, code: 'invalid_nameservers', error: v.error }
    if (isBrandedSet(v.nameservers)) {
      return { ok: true, mode: 'branded', registerChoice: 'cloudflare', customNS: null }
    }
    return { ok: true, mode: 'custom', registerChoice: 'custom', customNS: v.nameservers }
  }
  const choice = String(rawChoice || '').trim().toLowerCase() || (isEnabled() ? 'branded' : 'cloudflare')
  if (choice === 'branded') {
    if (!isEnabled()) return { ok: true, mode: 'cloudflare', registerChoice: 'cloudflare', customNS: null, downgraded: true }
    return { ok: true, mode: 'branded', registerChoice: 'cloudflare', customNS: null }
  }
  if (choice === 'cloudflare') return { ok: true, mode: 'cloudflare', registerChoice: 'cloudflare', customNS: null }
  if (choice === 'registrar' || choice === 'provider_default') {
    if (forHosting) return { ok: false, code: 'invalid_ns_choice', error: 'Hosting requires protected DNS: ns_choice must be "branded" (default) or "cloudflare".' }
    return { ok: true, mode: 'registrar', registerChoice: 'provider_default', customNS: null }
  }
  if (choice === 'custom') return { ok: false, code: 'invalid_nameservers', error: 'ns_choice "custom" requires a "nameservers" array (2–4 hostnames).' }
  return {
    ok: false,
    code: 'invalid_ns_choice',
    error: forHosting
      ? 'ns_choice must be "branded" (default) or "cloudflare".'
      : 'ns_choice must be one of: "branded" (default), "cloudflare", "registrar" — or pass a "nameservers" array.',
  }
}

// ── DB helpers ──────────────────────────────────────────────
function col(db) { return db.collection(COL) }

function _unwrap(r) {
  // mongodb v5 returns ModifyResult { value, ok }, v6 returns the document
  if (r && typeof r === 'object' && 'value' in r && 'ok' in r) return r.value
  return r
}

async function _setStatus(db, domain, set, historyMsg) {
  const upd = { $set: { ...set, updatedAt: now() } }
  if (historyMsg) upd.$push = { history: { $each: [{ at: now(), msg: historyMsg }], $slice: -50 } }
  await col(db).updateOne({ _id: domain }, upd)
}

/** Queue a freshly registered reseller domain for the branded switch. */
async function enqueue(db, { domain, ownerChatId, source, registrar = null, cfZoneId = null, cfNameservers = [], username = null } = {}) {
  if (!db || !domain) return { ok: false, error: 'missing db/domain' }
  const d = normName(domain)
  const branded = brandedNameservers()
  await col(db).updateOne(
    { _id: d },
    {
      $set: {
        domain: d, ownerChatId: String(ownerChatId || ''), source: source || null, registrar,
        status: 'activating', brandedNs: branded,
        cfZoneId: cfZoneId || null,
        cfNameservers: (cfNameservers || []).map(normName).filter(Boolean),
        username, attempts: 0, zoneLookupAttempts: 0,
        nextCheckAt: addMin(2), lockUntil: null, lastError: null,
        revertedAt: null, revertReason: null, switchedAt: null, failedReason: null,
        createdAt: now(), updatedAt: now(),
      },
      $push: { history: { $each: [{ at: now(), msg: `queued (${source || 'api'}) → will switch to ${branded.join(', ')} once Cloudflare activates the zone` }], $slice: -50 } },
    },
    { upsert: true },
  )
  log(`queued ${d} (${source})`)
  return { ok: true, domain: d, status: 'activating', brandedNs: branded }
}

/** Owner explicitly chose other nameservers — stop managing this domain. */
async function cancel(db, domain, reason = 'owner_changed_nameservers') {
  if (!db || !domain) return { ok: false }
  const d = normName(domain)
  const r = await col(db).updateOne(
    { _id: d, status: { $in: OPEN_STATUSES.concat(['reverted', 'branding_failed']) } },
    { $set: { status: 'cancelled', cancelledAt: now(), cancelReason: reason, lockUntil: null, updatedAt: now() }, $push: { history: { $each: [{ at: now(), msg: `cancelled: ${reason}` }], $slice: -50 } } },
  )
  return { ok: true, cancelled: r.modifiedCount > 0 }
}

async function getDoc(db, domain) {
  if (!db || !domain) return null
  return col(db).findOne({ _id: normName(domain) })
}

/**
 * Customer-facing nameserver view for a domain.
 * Returns null when the domain is not managed by this module (caller keeps its own data).
 */
function displayFromDoc(doc) {
  if (!doc || doc.status === 'cancelled') return null
  const branded = doc.brandedNs && doc.brandedNs.length ? doc.brandedNs : brandedNameservers()
  const cfNs = doc.cfNameservers || []
  switch (doc.status) {
    case 'activating':
      return { nameserver_mode: 'branded', nameserver_status: 'activating', nameservers: branded, current_nameservers: cfNs,
        note: 'Cloudflare is activating the zone on its assigned nameservers; the registrar is switched to the branded nameservers automatically (usually within minutes to a few hours). No action needed.' }
    case 'branded':
      return { nameserver_mode: 'branded', nameserver_status: 'branded', nameservers: branded, current_nameservers: branded, branded_at: doc.switchedAt || null }
    case 'reverted':
      return { nameserver_mode: 'cloudflare', nameserver_status: 'reverted', nameservers: cfNs, current_nameservers: cfNs,
        note: 'Branded nameservers were rolled back to Cloudflare-assigned nameservers to keep the domain protected.', reverted_at: doc.revertedAt || null }
    case 'branding_failed':
      return { nameserver_mode: 'cloudflare', nameserver_status: 'branding_failed', nameservers: cfNs, current_nameservers: cfNs,
        note: 'The domain stays protected on Cloudflare-assigned nameservers (branded switch could not be completed).' }
    default:
      return null
  }
}

async function displayMap(db, domains) {
  const out = {}
  const names = [...new Set((domains || []).map(normName).filter(Boolean))]
  if (!db || !names.length) return out
  try {
    const docs = await col(db).find({ _id: { $in: names } }).toArray()
    for (const d of docs) {
      const v = displayFromDoc(d)
      if (v) out[d._id] = v
    }
  } catch (e) {
    log(`displayMap error: ${e.message}`)
  }
  return out
}

// ── Webhooks / notifications ────────────────────────────────
function _emit(db, doc, event, payload) {
  try {
    if (_deps.emitWebhook) return _deps.emitWebhook(db, doc, event, payload)
    require('./reseller-webhooks').emit(db, {
      chatId: doc.ownerChatId, event, instanceId: doc._id || doc.domain,
      dedupKey: `${doc._id || doc.domain}:${event}:${Date.now()}`,
      payload: { domain: doc._id || doc.domain, ...payload },
      log: (m) => log(m),
    }).catch(() => {})
  } catch (_) { /* best-effort */ }
}
function _notify(msg) {
  try { if (typeof _deps.notifyAdmin === 'function') _deps.notifyAdmin(`🏷️ <b>Branded NS</b>\n${msg}`) } catch (_) { /* noop */ }
}

// ── Probes ──────────────────────────────────────────────────
async function _zoneInfo(doc) {
  const P = probes()
  if (doc.cfZoneId) {
    const z = await P.cfGetZone(doc.cfZoneId)
    if (z.found !== false) return z
  }
  const byName = await cf().getZoneByName(doc._id || doc.domain)
  if (byName) return { found: true, id: byName.id, status: byName.status, nameservers: byName.name_servers || [] }
  return { found: false }
}

/** Proxied hosts must answer with Cloudflare edge IPs (never the origin). */
async function _leakCheck(zone) {
  const P = probes()
  try {
    const recs = await cf().listDNSRecords(zone.id)
    const hosts = [...new Set((recs || [])
      .filter((r) => r.proxied && ['A', 'AAAA', 'CNAME'].includes(r.type))
      .map((r) => normName(r.name)))].slice(0, 3)
    if (!hosts.length) return { checked: 0, leaks: [] }
    const nsIp = await P.resolveFirstIpv4((zone.nameservers || [])[0] || 'anderson.ns.cloudflare.com')
    if (!nsIp) return { checked: 0, leaks: [], error: 'ns-ip-unresolved' }
    const leaks = []
    for (const h of hosts) {
      const r = await P.rawQuery(nsIp, h, 'A', { rd: false })
      if (!r.ok) continue
      const ips = (r.answers || []).filter((x) => x.type === 'A').map((x) => x.data)
      if (ips.length && !ips.every(P.isCloudflareIp)) leaks.push({ host: h, ips })
    }
    return { checked: hosts.length, leaks }
  } catch (e) {
    return { checked: 0, leaks: [], error: e.message }
  }
}

async function _currentRegistrarNs(db, domain) {
  try {
    const meta = await domainService().getDomainMeta(domain, db)
    return (meta?.nameservers || []).map(normName).filter(Boolean)
  } catch (_) { return [] }
}

// ── State transitions ───────────────────────────────────────
async function _release(db, doc, set = {}, minutes = 15, historyMsg) {
  await _setStatus(db, doc._id, { ...set, lockUntil: null, nextCheckAt: addMin(minutes) }, historyMsg)
}

async function _fail(db, doc, reason) {
  await _setStatus(db, doc._id, { status: 'branding_failed', failedReason: reason, failedAt: now(), lockUntil: null }, `branding failed: ${reason}`)
  _notify(`⚠️ <code>${doc._id}</code> stays on Cloudflare names — branded switch failed: ${reason}`)
  _emit(db, doc, 'domain.nameservers_branding_failed', { reason, nameservers: doc.cfNameservers || [] })
  return { domain: doc._id, action: 'failed', reason }
}

async function revert(db, doc, reason, { manual = false } = {}) {
  const P = probes()
  let target = (doc.cfNameservers || []).filter(Boolean)
  if (target.length < 2) {
    const z = await _zoneInfo(doc).catch(() => ({ found: false }))
    target = (z.nameservers || []).map(normName)
  }
  if (target.length < 2) {
    await _release(db, doc, { lastError: 'no CF nameservers to revert to' }, 10, 'revert blocked: CF nameservers unknown')
    _notify(`🚨 <code>${doc._id}</code> needs a revert (${reason}) but its Cloudflare nameservers are unknown — manual action required.`)
    return { domain: doc._id, action: 'revert_blocked' }
  }
  const r = await domainService().updateAllNameservers(doc._id, target, db)
  if (!r || r.error) {
    await _release(db, doc, { lastError: `revert failed: ${r?.error || 'unknown'}`, alarmAt: now() }, 10, `revert FAILED: ${r?.error || 'unknown'}`)
    _notify(`🚨 <code>${doc._id}</code>: revert to Cloudflare names FAILED (${r?.error || 'unknown'}). Reason for revert: ${reason}. Retrying in 10 min.`)
    return { domain: doc._id, action: 'revert_failed', error: r?.error }
  }
  if (doc.cfZoneId) await P.cfTriggerActivationCheck(doc.cfZoneId).catch(() => {})
  await _setStatus(db, doc._id, { status: 'reverted', revertedAt: now(), revertReason: reason, lockUntil: null, cfNameservers: target },
    `${manual ? 'manual ' : ''}revert → ${target.join(', ')} (${reason})`)
  _notify(`↩️ <code>${doc._id}</code> switched BACK to Cloudflare names (${target.join(', ')}). Reason: ${reason}`)
  _emit(db, doc, 'domain.nameservers_reverted', { reason, nameservers: target })
  return { domain: doc._id, action: 'reverted', reason }
}

async function _processActivating(db, doc) {
  const P = probes()
  const zone = await _zoneInfo(doc)
  if (zone.found === null) return _release(db, doc, { lastError: zone.error || 'cf transient' }, 10).then(() => ({ domain: doc._id, action: 'retry_transient' }))
  if (zone.found === false) {
    const n = (doc.zoneLookupAttempts || 0) + 1
    if (n >= MAX_ZONE_LOOKUP_ATTEMPTS) return _fail(db, doc, 'cloudflare_zone_missing')
    await _release(db, doc, { zoneLookupAttempts: n, lastError: 'zone not found' }, 15)
    return { domain: doc._id, action: 'zone_missing_retry' }
  }
  const cfNs = (zone.nameservers || []).map(normName)
  if (!doc.cfZoneId || !(doc.cfNameservers || []).length) {
    await _setStatus(db, doc._id, { cfZoneId: zone.id, cfNameservers: cfNs })
    doc.cfZoneId = zone.id
    doc.cfNameservers = cfNs
  }

  // Never fight the owner: if they already moved the domain elsewhere, stop.
  const cur = await _currentRegistrarNs(db, doc._id)
  if (cur.length && !sameSet(cur, cfNs) && !isBrandedSet(cur)) {
    await cancel(db, doc._id, `owner_changed_nameservers (${cur.join(', ')})`)
    return { domain: doc._id, action: 'cancelled' }
  }

  if (zone.status !== 'active') {
    const ageH = (Date.now() - new Date(doc.createdAt || Date.now()).getTime()) / 3600000
    const timeoutH = Number(process.env.RESELLER_BRANDED_NS_ACTIVATION_TIMEOUT_HOURS || 72)
    if (ageH > timeoutH) return _fail(db, doc, `zone_not_activated_after_${timeoutH}h (status ${zone.status})`)
    const set = { lastZoneStatus: zone.status }
    const lastAct = doc.lastActivationCheckAt ? new Date(doc.lastActivationCheckAt).getTime() : 0
    if (Date.now() - lastAct > ACTIVATION_RETRIGGER_MS) {
      await P.cfTriggerActivationCheck(zone.id).catch(() => {})
      set.lastActivationCheckAt = now()
    }
    await _release(db, doc, set, ageH < 1 ? 5 : 30)
    return { domain: doc._id, action: 'waiting_activation', zoneStatus: zone.status }
  }

  // Active → proxied hosts must already answer with CF edge IPs before we switch.
  const leak = await _leakCheck(zone)
  if (leak.leaks.length) {
    await _release(db, doc, { lastZoneStatus: 'active', lastError: `proxy not ready: ${leak.leaks.map((l) => `${l.host}=${l.ips.join('/')}`).join(', ')}` }, 10)
    return { domain: doc._id, action: 'waiting_proxy' }
  }

  if (isBrandedSet(cur)) {
    // Already on branded names (e.g. manual switch) — just start monitoring.
    await _setStatus(db, doc._id, { status: 'branded', switchedAt: doc.switchedAt || now(), lockUntil: null, nextCheckAt: addMin(Number(process.env.RESELLER_BRANDED_NS_MONITOR_MIN || 60)), lastZoneStatus: 'active' }, 'already on branded nameservers — monitoring')
    return { domain: doc._id, action: 'branded_existing' }
  }

  const branded = doc.brandedNs && doc.brandedNs.length ? doc.brandedNs : brandedNameservers()
  const r = await domainService().updateAllNameservers(doc._id, branded, db)
  if (!r || r.error) {
    const attempts = (doc.attempts || 0) + 1
    if (attempts >= MAX_SWITCH_ATTEMPTS) return _fail(db, doc, `registrar_update_failed: ${r?.error || 'unknown'}`)
    await _release(db, doc, { attempts, lastError: r?.error || 'registrar update failed' }, 15 * attempts, `switch attempt ${attempts} failed: ${r?.error || 'unknown'}`)
    return { domain: doc._id, action: 'switch_retry', error: r?.error }
  }
  await _setStatus(db, doc._id, {
    status: 'branded', switchedAt: now(), lockUntil: null, attempts: 0, lastError: null, lastZoneStatus: 'active',
    nextCheckAt: addMin(Number(process.env.RESELLER_BRANDED_NS_MONITOR_MIN || 60)),
  }, `switched registrar → ${branded.join(', ')}`)
  log(`${doc._id}: switched to ${branded.join(', ')}`)
  _emit(db, doc, 'domain.nameservers_branded', { nameservers: branded, previous_nameservers: cfNs })
  return { domain: doc._id, action: 'switched' }
}

async function _processBranded(db, doc) {
  const zone = await _zoneInfo(doc)
  if (zone.found === null) return _release(db, doc, { lastError: zone.error || 'cf transient' }, 15).then(() => ({ domain: doc._id, action: 'retry_transient' }))

  const cur = await _currentRegistrarNs(db, doc._id)
  if (cur.length && !isBrandedSet(cur)) {
    await cancel(db, doc._id, `owner_changed_nameservers (${cur.join(', ')})`)
    return { domain: doc._id, action: 'cancelled' }
  }

  const reasons = []
  if (zone.found === false) reasons.push('cloudflare zone missing (deleted?) — zone must be re-added')
  else if (zone.status !== 'active') reasons.push(`cloudflare zone status "${zone.status}"`)
  if (zone.found === true) {
    const leak = await _leakCheck(zone)
    if (leak.leaks.length) reasons.push(`origin IP exposed: ${leak.leaks.map((l) => `${l.host}=${l.ips.join('/')}`).join(', ')}`)
  }
  if (reasons.length) return revert(db, doc, reasons.join('; '))

  await _release(db, doc, { lastCheckAt: now(), lastZoneStatus: 'active', lastError: null }, Number(process.env.RESELLER_BRANDED_NS_MONITOR_MIN || 60))
  return { domain: doc._id, action: 'ok' }
}

async function processDoc(db, doc) {
  if (doc.status === 'activating') return _processActivating(db, doc)
  if (doc.status === 'branded') return _processBranded(db, doc)
  await _release(db, doc, {}, 60)
  return { domain: doc._id, action: 'noop' }
}

async function _claimNext(db) {
  const t = now()
  const r = await col(db).findOneAndUpdate(
    { status: { $in: OPEN_STATUSES }, nextCheckAt: { $lte: t }, $or: [{ lockUntil: null }, { lockUntil: { $exists: false } }, { lockUntil: { $lte: t } }] },
    { $set: { lockUntil: new Date(t.getTime() + LOCK_MS) } },
    { sort: { nextCheckAt: 1 }, returnDocument: 'after' },
  )
  return _unwrap(r)
}

/** One worker pass: processes up to BATCH due domains. */
async function tick({ domain = null } = {}) {
  if (_running) return { skipped: 'already-running' }
  const db = _deps.getDb()
  if (!db) return { skipped: 'db-not-ready' }
  _running = true
  const results = []
  try {
    if (domain) {
      const doc = await getDoc(db, domain)
      if (!doc) return { ok: false, error: 'not_found' }
      if (!OPEN_STATUSES.includes(doc.status)) return { ok: false, error: `status ${doc.status} is not open` }
      results.push(await processDoc(db, doc).catch((e) => ({ domain: doc._id, action: 'error', error: e.message })))
      return { ok: true, results }
    }
    for (let i = 0; i < BATCH; i++) {
      const doc = await _claimNext(db)
      if (!doc) break
      try {
        results.push(await processDoc(db, doc))
      } catch (e) {
        log(`${doc._id}: process error ${e.message}`)
        await _release(db, doc, { lastError: e.message }, 15).catch(() => {})
        results.push({ domain: doc._id, action: 'error', error: e.message })
      }
    }
    return { ok: true, processed: results.length, results }
  } finally {
    _running = false
  }
}

async function forceSwitch(db, domain) {
  const doc = await getDoc(db, domain)
  if (!doc) return { ok: false, error: 'not_found' }
  await _setStatus(db, doc._id, { status: 'activating', attempts: 0, zoneLookupAttempts: 0, nextCheckAt: now(), lockUntil: null, createdAt: now() }, 'manual re-queue for branded switch')
  return tick({ domain: doc._id })
}

async function stats(db, { domain = null, limit = 100 } = {}) {
  if (domain) return { domain: await getDoc(db, domain) }
  const byStatus = await col(db).aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()
  const recent = await col(db).find({}, { projection: { history: 0 } }).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).toArray()
  return {
    enabled: isEnabled(),
    brandedNameservers: brandedNameservers(),
    counts: Object.fromEntries(byStatus.map((x) => [x._id, x.n])),
    recent,
  }
}

// ── Admin routes + worker ───────────────────────────────────
function _adminOk(req) {
  const key = String(req.query?.key || req.headers['x-admin-key'] || '')
  const expected = String(process.env.SESSION_SECRET || '').slice(0, 16)
  return !!expected && key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))
}

function registerRoutes(app) {
  const guard = (fn) => async (req, res) => {
    if (!_adminOk(req)) return res.status(403).json({ error: 'Unauthorized' })
    const db = _deps.getDb()
    if (!db) return res.status(503).json({ error: 'db_not_ready' })
    try { res.json(await fn(req, db)) } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
  }
  app.get('/admin/branded-ns/status', guard((req, db) => stats(db, { domain: req.query.domain, limit: req.query.limit })))
  app.post('/admin/branded-ns/tick', guard((req) => tick({ domain: req.query.domain || null })))
  app.post('/admin/branded-ns/switch', guard((req, db) => {
    if (!req.query.domain) return { ok: false, error: 'domain required' }
    return forceSwitch(db, req.query.domain)
  }))
  app.post('/admin/branded-ns/revert', guard(async (req, db) => {
    const doc = await getDoc(db, req.query.domain)
    if (!doc) return { ok: false, error: 'not_found' }
    return revert(db, doc, String(req.query.reason || 'manual revert'), { manual: true })
  }))
}

function startWorker() {
  if (_timer || String(process.env.RESELLER_BRANDED_NS_WORKER || 'true').toLowerCase() === 'false') return
  const ms = Math.max(60000, Number(process.env.RESELLER_BRANDED_NS_WORKER_MS) || 5 * 60 * 1000)
  const run = () => { tick().then((r) => { if (r?.processed) log(`worker processed ${r.processed}`) }).catch((e) => log(`worker error: ${e.message}`)) }
  try {
    const activeSlot = require('./active-slot')
    _timer = activeSlot.singletonInterval('branded-ns-worker', run, ms)
  } catch (_) {
    _timer = setInterval(run, ms)
  }
  if (_timer && typeof _timer.unref === 'function') _timer.unref()
}

async function ensureIndexes(db) {
  try {
    await col(db).createIndex({ status: 1, nextCheckAt: 1 })
    await col(db).createIndex({ ownerChatId: 1 })
  } catch (e) { log(`index warn: ${e.message}`) }
}

function init({ app, getDb, notifyAdmin, log: logger, startScheduler = true } = {}) {
  _deps = { ..._deps, getDb: getDb || (() => null), notifyAdmin: notifyAdmin || null, log: logger || ((...a) => console.log(...a)) }
  if (app) registerRoutes(app)
  if (startScheduler) {
    startWorker()
    // indexes once the DB is up
    setTimeout(() => { const db = _deps.getDb(); if (db) ensureIndexes(db) }, 30000).unref?.()
  }
  log(`init — enabled=${isEnabled()} nameservers=${brandedNameservers().join(',')}`)
}

function _setDeps(over = {}) { _deps = { ..._deps, ...over } }

module.exports = {
  init,
  // config / helpers
  brandedNameservers,
  isEnabled,
  isBrandedNs,
  isBrandedSet,
  validateNameservers,
  resolveNsChoice,
  // lifecycle
  enqueue,
  cancel,
  getDoc,
  displayFromDoc,
  displayMap,
  tick,
  processDoc,
  revert,
  forceSwitch,
  stats,
  COL,
  _setDeps,
}
