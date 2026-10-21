'use strict'
/* global process */
// ============================================================
// Safe Browsing Monitor  (js/safe-browsing-monitor.js)
// ------------------------------------------------------------
// Periodically checks every domain LINKED TO OUR SERVER — hosting plans (cPanel
// main + addon domains), VPS, RDP, and the URL shortener — for BOTH reseller-API
// and bot-purchased (Nomadly + white-label e.g. Smadav) customers, against Google
// Safe Browsing (js/safe-browsing-service.js). When a domain is
// flagged (malware / social-engineering / unwanted software) we:
//   1. Record a flag in `safeBrowsingFlags` + stamp the resource doc (sbFlagged)
//      so the reseller API can REPORT the status on demand.
//   2. NOTIFY the reseller via their push webhook — hosting.flagged / vps.flagged /
//      rdp.flagged / shortener.flagged (js/reseller-webhooks.js).
//   3. UNLINK it from our server so we stop serving abusive content:
//        hosting   → suspend the cPanel account (reversible)
//        vps / rdp → delete the DNS A-record pointing the domain at the box
//        shortener → deactivate the domain (status 'deactivated' + drop the
//                    shortener DNS) so its slugs stop resolving (see the
//                    deactivated-domain guard in js/_index.js app.get('/:id')).
//
// SAFETY: the live scheduled sweep (with real unlink + real webhooks) only runs
// when BOT_ENVIRONMENT=production (or SAFE_BROWSING_MONITOR_ENABLED=true) AND the
// API key is configured. All side-effecting collaborators (safe-browsing check,
// webhook emit, unlink actions, DNS resolver) are injected so the logic is unit-
// testable against a local DB with mocks — it never has to touch production.
// ============================================================
require('dotenv').config()
const dns = require('dns').promises
const { log: clog } = require('console')

const sbService = require('./safe-browsing-service')
const webhooks = require('./reseller-webhooks')
const { distinctValues } = require('./db')

const COLLECTION = 'safeBrowsingFlags'
const VPS_TERMINAL = ['CANCELLED', 'DESTROYED', 'DELETED', 'FAILED']
const SHORTENER_ACTIVE = ['host_linked', 'railway_linked', 'dns_added', 'completed']
const DEFAULT_SWEEP_MIN = 60
const DEFAULT_BATCH = 300

const norm = (d) => String(d || '').trim().toLowerCase().replace(/\.$/, '')
const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || '').trim())

// Resolve a promise but never hang forever — rejects after `ms` so one stuck
// network call can't wedge a whole sweep. Timer is unref'd + cleared so it
// never keeps the event loop alive.
async function withTimeout(promise, ms, label) {
  let to = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { to = setTimeout(() => reject(new Error(label || `timed out after ${ms}ms`)), ms); if (to && to.unref) to.unref() }),
    ])
  } finally { if (to) clearTimeout(to) }
}

// dns.resolve4 has NO timeout and can hang indefinitely on a flaky resolver —
// that single hang used to wedge the whole sweep (the monitor's `running`
// guard then stayed true forever, silently stopping all future sweeps until
// the next process restart). Cap every lookup so it always resolves/rejects.
const DNS_TIMEOUT_MS = Math.max(1000, Number(process.env.SB_DNS_TIMEOUT_MS) || 8000)
function dnsResolve4(host) {
  return withTimeout(dns.resolve4(host), DNS_TIMEOUT_MS, 'dns_timeout')
}

let _indexed = false
async function ensureIndexes(db) {
  if (_indexed || !db) return
  _indexed = true
  try {
    await db.collection(COLLECTION).createIndex({ chatId: 1 })
    await db.collection(COLLECTION).createIndex({ product: 1, flagged: 1 })
  } catch (_) { _indexed = false }
}

// Resellers with at least one enabled API key — Safe Browsing protection is a
// reseller-API feature, so we scope to their resources (mirrors reseller-site-health).
async function resellerOwners(db) {
  const ids = await distinctValues(db.collection('resellerApiKeys'), 'ownerChatId', { enabled: true }).catch(() => [])
  return [...new Set((ids || []).map(String))]
}

// Enumerate every domain linked to our server for the given resellers.
// Returns [{ domain, product, resourceId, chatId, ip?, account? }]
// resolve4 is injected for testability (VPS/RDP domain→IP matching).
async function enumerateLinkedDomains(db, { owners = null, scope = 'reseller', resolve4 = dnsResolve4, log = clog } = {}) {
  const items = []
  const seen = new Set()
  const add = (domain, product, resourceId, chatId, extra = {}) => {
    const d = norm(domain)
    if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return
    const key = `${d}|${product}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({ domain: d, product, resourceId: String(resourceId), chatId: String(chatId), ...extra })
  }

  // Owner filter. Explicit `owners` → just those chatIds. scope 'all' → EVERY linked
  // domain regardless of owner, i.e. bot-purchased (Nomadly / white-label) customers
  // AND resellers. Default 'reseller' → only chatIds with an enabled reseller API key.
  let ownerFilter
  if (owners && owners.length) {
    ownerFilter = { chatId: { $in: owners } }
  } else if (scope === 'all') {
    ownerFilter = {}
  } else {
    const ownerIds = await resellerOwners(db)
    if (!ownerIds.length) return items
    ownerFilter = { chatId: { $in: ownerIds } }
  }

  // ── Hosting: cPanel main + addon domains ──────────────────────────────────
  const hosting = await db.collection('cpanelAccounts').find({
    ...ownerFilter, deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true },
    provisionState: { $nin: ['provisioning', 'failed'] },
  }).limit(5000).toArray().catch(() => [])
  for (const a of hosting) {
    const resourceId = a._id
    const addons = (a.addonDomains || []).map(x => (typeof x === 'string' ? x : (x && x.domain) || '')).filter(Boolean)
    for (const dom of [a.domain, ...addons]) {
      if (dom) add(dom, 'hosting', resourceId, a.chatId, { account: a })
    }
  }

  // ── Shortener: activated custom domains ───────────────────────────────────
  const shorteners = await db.collection('shortenerActivations').find({
    ...ownerFilter, status: { $in: SHORTENER_ACTIVE },
  }).limit(5000).toArray().catch(() => [])
  for (const s of shorteners) add(s.domain || s._id, 'shortener', s.domain || s._id, s.chatId, { activation: s })

  // ── VPS / RDP: reseller domains whose A-record points at a reseller box ───
  const servers = await db.collection('vpsPlansOf').find({
    ...ownerFilter, deleted: { $ne: true }, provisionState: { $nin: ['provisioning', 'failed'] },
  }).limit(5000).toArray().catch(() => [])
  // Map ip -> { product, resourceId, chatId } for quick matching.
  const ipMap = new Map()
  for (const v of servers) {
    if (VPS_TERMINAL.includes(String(v.status || '').toUpperCase())) continue
    const ip = String(v.host || v.ip || v.mainIp || '').trim()
    if (!isIp(ip)) continue
    ipMap.set(ip, { product: v.isRDP ? 'rdp' : 'vps', resourceId: String(v.vpsId || v._id), chatId: String(v.chatId) })
  }
  if (ipMap.size) {
    // Candidate domains = reseller domains not already matched to hosting/shortener.
    const vpsDnsCap = Math.max(50, Number(process.env.SB_VPS_DNS_CAP) || 800)
    const domains = (await db.collection('domainsOf').find({ ...ownerFilter, domainName: { $exists: true } }).limit(5000).toArray().catch(() => [])).slice(0, vpsDnsCap)
    for (const d of domains) {
      const name = norm(d.domainName)
      if (!name || seen.has(`${name}|hosting`) || seen.has(`${name}|shortener`)) continue
      let ips = []
      try { ips = await resolve4(name) } catch (_) { ips = [] }
      const hit = (ips || []).map(String).find(ip => ipMap.has(ip))
      if (hit) {
        const m = ipMap.get(hit)
        // Attribute to the box owner only when the domain owner matches.
        if (String(d.chatId) === m.chatId) add(name, m.product, m.resourceId, m.chatId, { ip: hit })
      }
    }
  }

  return items
}

// ── Real unlink actions (production). Injectable so tests use no-op mocks. ──
const defaultActions = {
  async hosting(db, item, { log = clog } = {}) {
    const acct = item.account || await db.collection('cpanelAccounts').findOne({ _id: item.resourceId }).catch(() => null)
    const cpUser = (acct && (acct.cpUser || acct._id)) || item.resourceId
    const whmService = require('./whm-service')
    const ok = await whmService.suspendAccount(cpUser, `Google Safe Browsing flag: ${item.domain}`).catch((e) => { log(`[SafeBrowsingMonitor] WHM suspend error ${cpUser}: ${e.message}`); return false })
    if (ok) await db.collection('cpanelAccounts').updateOne({ _id: item.resourceId }, { $set: { suspended: true, suspendedReason: 'safe_browsing_flag', suspendedAt: new Date() } }).catch(() => {})
    return { ok: !!ok, action: 'hosting_suspended', cpUser }
  },
  async shortener(db, item, { log = clog } = {}) {
    const domainService = require('./domain-service')
    const rlSaveDomain = require('./rl-save-domain-in-server')
    try {
      const dnsResult = await domainService.viewDNSRecords(item.domain, db).catch(() => null)
      const rec = (dnsResult?.records || []).find(r => rlSaveDomain.isShortenerDnsRecord(r))
      if (rec) await domainService.deleteDNSRecord(item.domain, rec, db).catch((e) => log(`[SafeBrowsingMonitor] shortener DNS del warn ${item.domain}: ${e.message}`))
    } catch (e) { log(`[SafeBrowsingMonitor] shortener unlink warn ${item.domain}: ${e.message}`) }
    await db.collection('shortenerActivations').updateOne({ _id: item.domain }, { $set: { status: 'deactivated', deactivatedReason: 'safe_browsing_flag', updatedAt: new Date() } }).catch(() => {})
    return { ok: true, action: 'shortener_deactivated' }
  },
  async vps(db, item, { log = clog } = {}) { return defaultActions._serverDns(db, item, { log, product: 'vps' }) },
  async rdp(db, item, { log = clog } = {}) { return defaultActions._serverDns(db, item, { log, product: 'rdp' }) },
  async _serverDns(db, item, { log = clog } = {}) {
    const domainService = require('./domain-service')
    try {
      const dnsResult = await domainService.viewDNSRecords(item.domain, db).catch(() => null)
      const recs = (dnsResult?.records || []).filter(r => {
        const type = String(r.recordType || r.type || '').toUpperCase()
        const content = String(r.recordContent || r.content || '').trim()
        return type === 'A' && (!item.ip || content === item.ip)
      })
      for (const rec of recs) await domainService.deleteDNSRecord(item.domain, rec, db).catch((e) => log(`[SafeBrowsingMonitor] ${item.product} DNS del warn ${item.domain}: ${e.message}`))
      return { ok: true, action: `${item.product}_dns_removed`, removed: recs.length }
    } catch (e) { log(`[SafeBrowsingMonitor] ${item.product} unlink warn ${item.domain}: ${e.message}`); return { ok: false, error: e.message } }
  },
}

// Stamp the originating resource doc so status endpoints can surface the flag.
async function stampResource(db, item, flagged, threats) {
  const set = flagged
    ? { sbFlagged: true, sbFlaggedAt: new Date(), sbThreats: threats || [] }
    : { sbFlagged: false }
  const unset = flagged ? {} : { sbFlaggedAt: '', sbThreats: '' }
  const op = flagged ? { $set: set } : { $set: set, $unset: unset }
  try {
    if (item.product === 'hosting') await db.collection('cpanelAccounts').updateOne({ _id: item.resourceId }, op)
    else if (item.product === 'shortener') await db.collection('shortenerActivations').updateOne({ _id: item.domain }, op)
    else if (item.product === 'vps' || item.product === 'rdp') await db.collection('vpsPlansOf').updateOne({ $or: [{ vpsId: item.resourceId }, { _id: item.resourceId }] }, op)
  } catch (_) { /* best-effort */ }
}

// Handle a single flagged domain: record → notify → (enforce) unlink. Idempotent.
async function handleFlagged(db, item, { enforce = false, threats = [], emit = webhooks.emit, actions = defaultActions, activityRecord = null, log = clog } = {}) {
  const col = db.collection(COLLECTION)
  const existing = await col.findOne({ _id: item.domain }).catch(() => null)
  const alreadyHandled = existing && existing.flagged === true && (existing.status === 'unlinked' || (!enforce && existing.status === 'flagged'))

  const now = new Date()
  const status = enforce ? 'unlinked' : 'flagged'
  await col.updateOne(
    { _id: item.domain },
    {
      $set: { domain: item.domain, product: item.product, resourceId: item.resourceId, chatId: item.chatId, flagged: true, threats, status, lastCheckedAt: now, lastFlaggedAt: now },
      $setOnInsert: { firstFlaggedAt: now },
    },
    { upsert: true }
  ).catch((e) => log(`[SafeBrowsingMonitor] flag upsert warn ${item.domain}: ${e.message}`))
  await stampResource(db, item, true, threats)

  if (alreadyHandled) return { domain: item.domain, product: item.product, status, alreadyHandled: true }

  // Notify the reseller (push webhook). Deduped once per flag episode.
  let notified = { delivered: 0, skipped: 0 }
  try {
    notified = await emit(db, {
      chatId: item.chatId,
      event: `${item.product}.flagged`,
      instanceId: item.resourceId,
      dedupKey: `sbflag:${item.domain}`,
      payload: { domain: item.domain, threats: threats.map(t => t.type || t), action: enforce ? 'unlinked' : 'flagged', reason: 'google_safe_browsing' },
      log,
    }) || notified
  } catch (e) { log(`[SafeBrowsingMonitor] notify warn ${item.domain}: ${e.message}`) }

  // Activity trail (best-effort).
  try {
    const rec = activityRecord || require('./reseller-activity').record
    rec(db, { ownerChatId: item.chatId, resourceType: item.product, resourceId: item.resourceId, action: 'safe_browsing.flagged', actor: 'system', details: { domain: item.domain, threats: threats.map(t => t.type || t), enforced: enforce } })
  } catch (_) { /* activity trail is best-effort */ }

  // Unlink from our server.
  let unlink = { ok: false, skipped: true }
  if (enforce) {
    const fn = actions[item.product]
    if (typeof fn === 'function') {
      try { unlink = await fn(db, item, { log }) } catch (e) { unlink = { ok: false, error: e.message }; log(`[SafeBrowsingMonitor] unlink error ${item.domain}: ${e.message}`) }
    }
    await col.updateOne({ _id: item.domain }, { $set: { unlinkedAt: new Date(), unlinkResult: unlink } }).catch(() => {})
  }

  log(`[SafeBrowsingMonitor] FLAGGED ${item.product} ${item.domain} (threats=${threats.map(t => t.type || t).join(',') || '?'}) → notified=${notified.delivered} enforce=${enforce} unlink=${JSON.stringify(unlink)}`)
  return { domain: item.domain, product: item.product, status, notified, unlink }
}

// Full sweep: enumerate → check each → handle flags. Returns a summary.
async function runSweep(db, { enforce = false, sb = sbService, emit = webhooks.emit, actions = defaultActions, resolve4, limit = DEFAULT_BATCH, owners = null, scope = 'reseller', recheckHours = null, log = clog } = {}) {
  if (!db) return { checked: 0, flagged: 0, error: 'no_db' }
  if (!sb.isConfigured || !sb.isConfigured()) { log('[SafeBrowsingMonitor] GOOGLE_SAFE_BROWSING_KEY not configured — sweep skipped'); return { checked: 0, flagged: 0, skipped: 'not_configured' } }
  await ensureIndexes(db)

  const all = await enumerateLinkedDomains(db, { owners, scope, ...(resolve4 ? { resolve4 } : {}), log })

  // Pre-load stored flag/check state so we can (a) SKIP clean domains re-checked
  // within the recheck window — this spreads Google API calls out (quota-safe) and
  // naturally rotates coverage across runs so every domain is re-checked in turn —
  // and (b) NEVER flip an already-flagged/unlinked domain back to "clear" on its own.
  const existing = all.length
    ? await db.collection(COLLECTION).find({ _id: { $in: all.map(i => i.domain) } }).toArray().catch(() => [])
    : []
  const existingMap = new Map(existing.map(r => [r._id, r]))
  const recheckMs = Math.max(0, (recheckHours != null ? recheckHours : (Number(process.env.SB_RECHECK_HOURS) || 20))) * 3600000
  const isRecentClean = (d) => {
    if (!recheckMs) return false
    const r = existingMap.get(d)
    return !!(r && r.flagged !== true && r.lastCheckedAt && (Date.now() - new Date(r.lastCheckedAt).getTime()) < recheckMs)
  }
  const due = all.filter(i => !isRecentClean(i.domain))
  const items = due.slice(0, limit)

  let checked = 0, flagged = 0
  const flaggedList = []
  for (const item of items) {
    checked++
    let res
    try { res = await sb.checkDomain(item.domain) } catch (_) { res = { safe: null } }
    if (res && res.safe === false && (res.threats || []).length) {
      flagged++
      flaggedList.push(item.domain)
      await handleFlagged(db, item, { enforce, threats: res.threats, emit, actions, log })
    } else if (res && res.safe === true) {
      // Clean: record lastCheckedAt (drives the recheck rotation above). Never touch a
      // flagged record — reactivation after a flag is a deliberate action, not automatic.
      const ex = existingMap.get(item.domain)
      if (!ex || ex.flagged !== true) {
        await db.collection(COLLECTION).updateOne(
          { _id: item.domain },
          { $set: { domain: item.domain, product: item.product, resourceId: item.resourceId, chatId: item.chatId, flagged: false, status: 'clear', lastCheckedAt: new Date() } },
          { upsert: true }
        ).catch(() => {})
      }
    }
  }
  log(`[SafeBrowsingMonitor] sweep done: scope=${scope} checked=${checked}/${all.length} (due=${due.length}) flagged=${flagged}${flaggedList.length ? ' [' + flaggedList.join(', ') + ']' : ''} enforce=${enforce}`)
  return { checked, total: all.length, due: due.length, flagged, flaggedList, enforce, scope }
}

// ── Status queries (reseller API "available if called for status") ──────────
async function getFlag(db, domain) {
  if (!db) return null
  return db.collection(COLLECTION).findOne({ _id: norm(domain) }).catch(() => null)
}
async function listFlags(db, { chatId = null, product = null } = {}) {
  if (!db) return []
  const q = { flagged: true }
  if (chatId != null) q.chatId = String(chatId)
  if (product) q.product = product
  return db.collection(COLLECTION).find(q).limit(1000).toArray().catch(() => [])
}

// ── Realtime on-demand checks (shared by hosting / shortener / vps / rdp endpoints) ──
const DNS_MATCH_CAP = 60 // cap domains we DNS-resolve for a VPS/RDP "all" realtime sweep

// Does `domain`'s A-record point at `ip`? (VPS/RDP association check.)
async function domainResolvesTo(domain, ip, { resolve4 = dnsResolve4 } = {}) {
  if (!isIp(ip)) return false
  let ips = []
  try { ips = await resolve4(norm(domain)) } catch (_) { ips = [] }
  return (ips || []).map(String).includes(String(ip))
}

// Reseller's domains whose A-record currently points at `ip` (a VPS/RDP box). Best-effort.
async function linkedDomainsForIp(db, ownerChatId, ip, { resolve4 = dnsResolve4, limit = DNS_MATCH_CAP } = {}) {
  if (!db || !isIp(ip)) return []
  const domains = await db.collection('domainsOf').find({ chatId: String(ownerChatId), domainName: { $exists: true } }).limit(2000).toArray().catch(() => [])
  const out = []
  for (const d of domains.slice(0, limit)) {
    const name = norm(d.domainName)
    if (!name) continue
    const matches = await domainResolvesTo(name, ip, { resolve4 })
    if (matches) out.push(name)
  }
  return out
}

// LIVE (cache-bypassed) Safe Browsing check over a list of domains → uniform result rows.
// Pass { main } to tag which row is the primary domain (hosting). Read-only: no enforce/notify.
async function liveCheck(db, domains, { main = null, sb = sbService } = {}) {
  const uniq = [...new Set((domains || []).map(norm).filter(Boolean))]
  const mainN = main ? norm(main) : null
  return Promise.all(uniq.slice(0, 100).map(async (d) => {
    const r = await sb.checkDomain(d, { fresh: true }).catch(() => ({ safe: null, threats: [], error: 'check_failed' }))
    const flagState = await getFlag(db, d).catch(() => null)
    const row = {
      domain: d,
      safe: r.safe,                                 // true | false | null (null = could not determine)
      flagged: r.safe === false,
      threats: (r.threats || []).map(t => t.type || t),
      error: r.error || null,
      monitor_status: flagState ? (flagState.status || (flagState.flagged ? 'flagged' : 'clear')) : 'clear',
    }
    if (mainN !== null) row.is_main = (d === mainN)
    return row
  }))
}

// ── Add-time guard ──────────────────────────────────────────────────────────
// Reject a domain that Google Safe Browsing currently flags BEFORE it is attached
// to any product (hosting create/addon, shortener activate, domain register, DNS
// pointing at a VPS/RDP box). LIVE check (bypasses cache). Returns:
//   { allowed: true }                                   → safe, or check unavailable (fail-open)
//   { allowed: false, status: 422, error, message, threats } → definitively flagged → caller 422s
// We fail OPEN when the key is unconfigured or the API errors, so a Google outage
// never blocks a legitimate domain — but a confirmed flag is always rejected.
async function assertAddable(domain, { sb = sbService } = {}) {
  const d = norm(domain)
  if (!d) return { allowed: true }
  if (!sb.isConfigured || !sb.isConfigured()) return { allowed: true, skipped: 'unconfigured' }
  let r
  try { r = await sb.checkDomain(d, { fresh: true }) } catch (_) { return { allowed: true, skipped: 'check_failed' } }
  if (r && r.safe === false && (r.threats || []).length) {
    const threats = r.threats.map(t => t.type || t)
    return {
      allowed: false,
      status: 422,
      error: 'domain_flagged',
      threats,
      message: `${d} is flagged by Google Safe Browsing (${threats.join(', ')}) and cannot be added to our services. Clean the site, request a review in Google Search Console, and try again once it clears.`,
    }
  }
  return { allowed: true }
}
function publicFlagView(f) {
  if (!f) return null
  return {
    domain: f.domain || f._id,
    product: f.product || null,
    status: f.status || (f.flagged ? 'flagged' : 'clear'),
    flagged: !!f.flagged,
    threats: (f.threats || []).map(t => t.type || t),
    first_flagged_at: f.firstFlaggedAt ? new Date(f.firstFlaggedAt).toISOString() : null,
    last_checked_at: f.lastCheckedAt ? new Date(f.lastCheckedAt).toISOString() : null,
    unlinked_at: f.unlinkedAt ? new Date(f.unlinkedAt).toISOString() : null,
  }
}

// ── Scheduling (production + active-slot only) ──────────────────────────────
function enabled() {
  const v = process.env.SAFE_BROWSING_MONITOR_ENABLED
  if (v === 'true' || v === 'false') return v === 'true'
  return String(process.env.BOT_ENVIRONMENT || '').toLowerCase() === 'production'
}

function start({ getDb, log = clog } = {}) {
  if (!enabled()) { log('[SafeBrowsingMonitor] background sweep OFF (BOT_ENVIRONMENT!=production; set SAFE_BROWSING_MONITOR_ENABLED=true to force)'); return null }
  if (!sbService.isConfigured()) { log('[SafeBrowsingMonitor] GOOGLE_SAFE_BROWSING_KEY not configured — sweep NOT scheduled'); return null }
  const activeSlot = require('./active-slot')
  const ms = Math.max(5, Number(process.env.SAFE_BROWSING_SWEEP_MIN) || DEFAULT_SWEEP_MIN) * 60000
  const batch = Math.max(50, Number(process.env.SB_SWEEP_BATCH) || 500)
  // Hard ceiling on ONE sweep so a single hung DNS/HTTP call can never wedge the
  // monitor forever. Previously, if a sweep's promise never resolved, the
  // `running` guard below stayed true for the life of the process and EVERY
  // later tick returned early — the monitor went silent until the next restart
  // (seen in prod: exactly one "sweep done" then 12h of nothing on a stable pod).
  const sweepTimeoutMs = Math.max(60000, Number(process.env.SB_SWEEP_TIMEOUT_MS) || 10 * 60000)
  let running = false
  const doSweep = async (reason) => {
    const db = getDb()
    if (running || !db) return
    running = true
    try {
      await withTimeout(runSweep(db, { enforce: true, scope: 'all', limit: batch, log }), sweepTimeoutMs, `sweep timed out after ${Math.round(sweepTimeoutMs / 1000)}s`)
    } catch (e) {
      log(`[SafeBrowsingMonitor] sweep error (${reason}): ${e.message}`)
    } finally {
      running = false
    }
  }
  // Periodic sweep — active-slot singleton so only the nginx-active slot runs it.
  const t = setInterval(activeSlot.singleton('safe-browsing-monitor', () => { doSweep('interval') }), ms)
  if (t && typeof t.unref === 'function') t.unref()
  // Kick off an initial sweep shortly after boot so every restart/deploy gets
  // protection coverage right away instead of waiting a full interval. (The bare
  // setInterval above only fires `ms` AFTER boot, so frequent restarts kept
  // resetting the timer before it ever ran — the root cause of the prod gaps.)
  const initialDelayMs = Math.max(0, Number(process.env.SB_SWEEP_INITIAL_DELAY_MS) || 45000)
  const kickoff = setTimeout(activeSlot.singleton('safe-browsing-monitor-initial', () => { doSweep('startup') }), initialDelayMs)
  if (kickoff && typeof kickoff.unref === 'function') kickoff.unref()
  log(`[SafeBrowsingMonitor] scheduled: every ${ms / 60000} min (enforce ON, scope=all, batch=${batch}); initial sweep in ${Math.round(initialDelayMs / 1000)}s; per-sweep timeout ${Math.round(sweepTimeoutMs / 1000)}s`)
  return t
}

module.exports = {
  COLLECTION,
  ensureIndexes,
  resellerOwners,
  enumerateLinkedDomains,
  handleFlagged,
  runSweep,
  getFlag,
  listFlags,
  domainResolvesTo,
  linkedDomainsForIp,
  liveCheck,
  assertAddable,
  publicFlagView,
  defaultActions,
  enabled,
  start,
  withTimeout,
  dnsResolve4,
}
