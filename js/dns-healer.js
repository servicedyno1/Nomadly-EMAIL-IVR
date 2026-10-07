/* global process */
/**
 * DnsHealer — background self-healing for registry-side delegation failures.
 *
 * Why this exists:
 * Some ccTLDs (notably .de via DENIC, but also .nl/.se/.fi/.be/.ch/.ie/.it/.eu/.at/.li/.dk/.cz/.no)
 * run a pre-delegation nameserver check during/after registration. If our
 * Cloudflare zone wasn't fully published at the moment that check ran, the
 * registry refuses to publish the NS records — even though OpenProvider's API
 * returned a success response. The result: the customer's domain resolves to
 * a registry parking page (e.g. DENIC's `nx.denic.de` / `93.180.69.*`) instead
 * of Cloudflare. We saw this happen with teustbnk.de on 2026-05-26.
 *
 * What it does:
 * Every DNS_HEAL_INTERVAL_MIN minutes, this worker scans the registeredDomains
 * collection for cloudflare-managed domains and verifies — via Cloudflare DoH
 * — that public DNS actually delegates to Cloudflare. When it finds a domain
 * that doesn't, it walks a healing ladder:
 *   1. opService.disableDnssec(domain)   — best-effort, no-op if already off
 *   2. opService.updateNameservers(domain, [...cfNs])  — re-push to registry
 * Both of these helpers already retry on 5xx and auto-recover DNSSEC errors.
 *
 * Healing state lives in collection `dnsHealState` keyed by domain:
 *   {
 *     _id: domain,
 *     status: 'unknown' | 'healthy' | 'unhealthy' | 'healing' | 'stable' | 'escalated',
 *     attempts: int,                  // consecutive heal calls
 *     consecutiveHealthy: int,        // consecutive healthy probes (resets to 0 on unhealthy)
 *     lastProbeAt: Date,
 *     lastHealAttemptAt: Date | null,
 *     nextProbeAt: Date,              // earliest time worker will touch this row again
 *     lastError: string | null,
 *     lastPublicNs: [string],
 *     lastPublicA: [string],
 *   }
 *
 * Cadence:
 *   - Default probe interval: 5 min for active monitoring (first 7 days post-registration).
 *   - Exponential backoff between heal attempts: 5m → 10m → 30m → 1h → 2h → 4h (cap).
 *   - Escalate to admin Telegram (notifyAdmin) after MAX_ATTEMPTS (3) failed heals.
 *   - Once "stable" (3 consecutive healthy probes), probes drop to once per day.
 */

'use strict'

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const dnsChecker = require('./dns-checker')
const opService = require('./op-service')
const cfService = require('./cf-service')

// ── Config ──────────────────────────────────────────────────────────────────
const INTERVAL_MIN = parseInt(process.env.DNS_HEAL_INTERVAL_MIN || '5', 10)
const MAX_ATTEMPTS = parseInt(process.env.DNS_HEAL_MAX_ATTEMPTS || '3', 10)
const ACTIVE_WINDOW_DAYS = parseInt(process.env.DNS_HEAL_ACTIVE_WINDOW_DAYS || '7', 10)
const STABLE_PROBE_HOURS = parseInt(process.env.DNS_HEAL_STABLE_PROBE_HOURS || '24', 10)
const STABLE_THRESHOLD = parseInt(process.env.DNS_HEAL_STABLE_THRESHOLD || '3', 10)
const BACKOFF_LADDER_MIN = [5, 10, 30, 60, 120, 240]       // minutes between heal attempts
const HEAL_RECHECK_MIN = 5                                  // probe quickly after a heal call
// Auto-sync gate (Fix 2026-07-01): once a domain has been ESCALATED for at
// least N hours, the healer makes ONE attempt at opService.syncDomain() (a
// no-op PUT to /v1beta/domains/{id} that re-pushes ns_group:'' +
// name_servers — equivalent to RCP's "Synchronize" button). Cap at
// MAX_SYNC_ATTEMPTS total auto-syncs per domain so a permanently broken row
// doesn't bombard OP.
const ESCALATION_SYNC_AFTER_HRS = parseFloat(process.env.DNS_HEAL_AUTO_SYNC_AFTER_HRS || '24')
const MAX_SYNC_ATTEMPTS = parseInt(process.env.DNS_HEAL_MAX_SYNC_ATTEMPTS || '3', 10)

// TLDs that require/perform pre-delegation NS checks at the registry.
// These are the ones most prone to silent delegation failure on initial
// registration. Other TLDs are still monitored, just less aggressively.
const PRE_DELEGATION_TLDS = new Set([
  'de', 'nl', 'se', 'fi', 'be', 'ch', 'ie', 'it', 'eu', 'at', 'li', 'dk', 'cz', 'no',
])

// Cloudflare authoritative-NS suffix — all CF customer NS look like
// `<word>.ns.cloudflare.com`. Two NS are assigned per zone.
// Reseller BRANDED nameservers (ns1/ns2.hosta.sh, glue = CF NS IPs) are served by
// the same Cloudflare zone, so they count as Cloudflare delegation too — the healer
// must never "heal" a branded domain back to the CF-assigned names.
const isCfNs = (host) => {
  if (/\.ns\.cloudflare\.com\.?$/i.test(String(host || ''))) return true
  try { return require('./branded-ns').isBrandedNs(host) } catch (_) { return false }
}

// Known registry parking IP ranges — appearing here proves the registry has
// not delegated to our NS yet. We currently know DENIC's `nx.denic.de`
// wildcard at `93.180.69.0/24`. Add more here as we observe them.
const PARKED_IP_PREFIXES = [
  '93.180.69.',   // DENIC nx.denic.de wildcard
]

// ── Helpers ─────────────────────────────────────────────────────────────────
const log = (...args) => console.log(`[DnsHealer]`, ...args)
const now = () => new Date()
const addMin = (mins, base = now()) => new Date(base.getTime() + mins * 60 * 1000)
const tldOf = (domain) => String(domain || '').split('.').pop().toLowerCase()

let bot = null
let notifyAdmin = null
let TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
let _timer = null
let _running = false

/**
 * Probe public DNS to determine whether the registry is delegating this
 * domain to Cloudflare's nameservers. Returns a structured verdict.
 */
async function probeDelegation(domain) {
  const nsRes = await dnsChecker.resolve(domain, 'NS')
  const aRes = await dnsChecker.resolve(domain, 'A')

  const publicNs = (nsRes.answers || []).map((a) => String(a.data || '').toLowerCase())
  const publicA = (aRes.answers || []).map((a) => String(a.data || ''))
  const cfNsCount = publicNs.filter(isCfNs).length
  const parked = publicA.some((ip) => PARKED_IP_PREFIXES.some((p) => ip.startsWith(p)))

  // Healthy iff at least 2 CF nameservers in NS answer AND not landing on
  // a known registry parking IP.
  const healthy = cfNsCount >= 2 && !parked

  let reason = 'ok'
  if (!healthy) {
    if (parked) reason = `parked at registry (A=${publicA.join(',')})`
    else if (cfNsCount === 0 && publicNs.length === 0) reason = 'no NS in public DNS (registry not delegating)'
    else if (cfNsCount < 2) reason = `only ${cfNsCount} CF NS in public DNS (need ≥2). got: ${publicNs.join(',')}`
    else reason = 'unhealthy'
  }

  return { healthy, reason, publicNs, publicA, cfNsCount, parked }
}

/**
 * Apply the healing ladder once. Idempotent.
 * Returns { ok, action, error }.
 */
async function attemptHeal(domain, cfNameservers) {
  if (!Array.isArray(cfNameservers) || cfNameservers.length < 2) {
    return { ok: false, action: 'noop', error: 'missing CF nameservers for domain' }
  }

  // 0) CF-zone pre-check (Fix 1, 2026-06-30). Pre-delegation registries (DENIC
  //    et al.) run a nameserver test and only publish our CF NS once the CF zone
  //    exists and is serving the domain. Re-pushing NS to the registry while the
  //    CF zone is MISSING is futile — that is why rsvpcrumelbell.de /
  //    rsvpeviteguestview.de looped forever. Ensure the zone exists first
  //    (createZone is idempotent) and surface its status for escalation.
  //    Best-effort: only hard-block when the zone is missing AND can't be created.
  let cfZoneStatus = null
  if (PRE_DELEGATION_TLDS.has(tldOf(domain))) {
    try {
      const zone = await cfService.getZoneByName(domain)
      if (!zone) {
        log(`${domain}: CF zone missing — creating before registry NS push (pre-delegation requirement)`)
        const created = await cfService.createZone(domain)
        cfZoneStatus = created?.status || (created?.success ? 'created' : 'create-failed')
        if (!created?.success) {
          return { ok: false, action: 'cf-zone-create-failed', cfZoneStatus,
            error: `CF zone missing and could not be created: ${JSON.stringify(created?.errors || created)}` }
        }
      } else {
        cfZoneStatus = zone.status
      }
      if (cfZoneStatus && cfZoneStatus !== 'active') {
        log(`${domain}: CF zone status='${cfZoneStatus}' (not yet active) — pushing NS anyway so the registry can confirm CF delegation`)
      }
    } catch (e) {
      log(`${domain}: CF zone pre-check soft-failed: ${e.message} — proceeding with NS push`)
    }
  }

  // 1) Best-effort DNSSEC disable. Most domains never had DNSSEC set; this is
  //    a no-op for them but cheap. If it fails, log + continue — the real
  //    work is updateNameservers, which has its own DNSSEC autofix.
  try {
    await opService.disableDnssec(domain)
  } catch (e) {
    log(`disableDnssec(${domain}) soft-failed: ${e.message} — continuing`)
  }

  // 2) Re-push NS. opService.updateNameservers already retries on 5xx and
  //    self-heals DNSSEC errors.
  try {
    const upd = await opService.updateNameservers(domain, cfNameservers)
    if (upd && upd.error) {
      return { ok: false, action: 'updateNameservers', error: upd.error, cfZoneStatus }
    }
    return { ok: true, action: 'updateNameservers', error: null, cfZoneStatus }
  } catch (e) {
    return { ok: false, action: 'updateNameservers', error: e.message, cfZoneStatus }
  }
}

function nextBackoffMin(attempts) {
  const i = Math.min(Math.max(0, attempts), BACKOFF_LADDER_MIN.length - 1)
  return BACKOFF_LADDER_MIN[i]
}

/**
 * Pick the next batch of domains to probe — those with nextProbeAt in the
 * past OR no state row yet but inside the active monitoring window.
 */
async function pickBatch(db) {
  const stateCol = db.collection('dnsHealState')
  const regCol = db.collection('registeredDomains')

  // 1) Rows already in healing/escalated/unhealthy — always re-probe when due
  const dueExisting = await stateCol
    .find({ nextProbeAt: { $lte: now() } })
    .sort({ nextProbeAt: 1 })
    .limit(200)
    .toArray()

  // 2) Recently-registered CF-managed domains that have no state yet
  const activeCutoff = new Date(now().getTime() - ACTIVE_WINDOW_DAYS * 24 * 3600 * 1000)
  const existingIds = new Set(dueExisting.map((s) => s._id))
  const newReg = await regCol
    .find({
      'val.nameserverType': 'cloudflare',
      'val.registeredAt': { $gte: activeCutoff },
      'val.status': 'registered',
    })
    .limit(200)
    .toArray()

  // FIX (2026-06-30): exclude domains that ALREADY have a dnsHealState row of
  // ANY status (not just the currently-due ones). Previously `existingIds` only
  // held the *due* rows, so a domain in 'escalated'/'healing' with a future
  // nextProbeAt got re-injected here as a fresh {attempts:0} candidate every
  // tick — resetting the escalation ladder and logging "attempt 1/3" forever.
  const newRegIds = newReg.map((r) => r._id)
  const tracked = newRegIds.length
    ? new Set(
        (await stateCol
          .find({ _id: { $in: newRegIds } }, { projection: { _id: 1 } })
          .toArray()).map((s) => s._id)
      )
    : new Set()

  const newCandidates = newReg
    .filter((r) => !existingIds.has(r._id) && !tracked.has(r._id))
    .map((r) => ({ _id: r._id, status: 'unknown', attempts: 0, consecutiveHealthy: 0 }))

  return [...dueExisting, ...newCandidates]
}

async function processDomain(db, stateRow, regCol, stateCol) {
  const domain = stateRow._id
  const reg = await regCol.findOne({ _id: domain })
  if (!reg) return // domain was deleted/cancelled — skip
  if (reg.val?.nameserverType !== 'cloudflare') return // user moved off CF — don't touch

  const cfNs = reg.val?.nameservers || []
  const ownerChatId = reg.val?.ownerChatId || null

  const probe = await probeDelegation(domain)
  const tld = tldOf(domain)
  const preDelegationTld = PRE_DELEGATION_TLDS.has(tld)

  // ── Healthy branch ────────────────────────────────────────────────────────
  if (probe.healthy) {
    const consecutiveHealthy = (stateRow.consecutiveHealthy || 0) + 1
    const isStable = consecutiveHealthy >= STABLE_THRESHOLD
    const nextStatus = isStable ? 'stable' : 'healthy'
    const nextProbeAt = isStable
      ? addMin(STABLE_PROBE_HOURS * 60)
      : addMin(INTERVAL_MIN)

    // If we just recovered from healing/escalated/unhealthy, notify the user.
    const wasUnhealthy = ['healing', 'escalated', 'unhealthy'].includes(stateRow.status)
    if (wasUnhealthy && bot && ownerChatId) {
      try {
        bot.sendMessage(
          ownerChatId,
          `✅ Your domain <b>${domain}</b> is now live and resolving correctly. Thanks for your patience.`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
      } catch (_) { /* ignore */ }

      if (notifyAdmin) {
        notifyAdmin(`[DnsHealer] RECOVERED: <code>${domain}</code> (owner ${ownerChatId})`)
      }
    }

    // BUG FIX (2026-02): Only reset `attempts` once the domain is truly
    // "stable" (consecutiveHealthy >= STABLE_THRESHOLD). Previously a single
    // healthy probe wiped attempts to 0, which meant a flapping domain
    // (healthy → unhealthy → healthy → unhealthy …) would log "attempt 1/3"
    // forever and never escalate. Keeping the counter across single-blip
    // recoveries lets us reach MAX_ATTEMPTS and escalate properly.
    const updateSet = {
      status: nextStatus,
      consecutiveHealthy,
      lastProbeAt: now(),
      nextProbeAt,
      lastError: null,
      lastPublicNs: probe.publicNs,
      lastPublicA: probe.publicA,
    }
    if (isStable) {
      updateSet.attempts = 0  // truly recovered — safe to clear
    }
    await stateCol.updateOne(
      { _id: domain },
      { $set: updateSet },
      { upsert: true }
    )
    return { domain, status: nextStatus }
  }

  // ── Unhealthy branch ──────────────────────────────────────────────────────
  // For non-pre-delegation TLDs (like .com), unhealthy usually just means
  // global DNS propagation in flight — don't immediately call OP. We give it
  // one full probe cycle of grace first, by demoting status to 'unhealthy'
  // without bumping attempts on the first occurrence.
  const isFirstUnhealthy = stateRow.status === 'unknown' || stateRow.status === 'healthy' || stateRow.status === 'stable'

  if (isFirstUnhealthy && !preDelegationTld) {
    const nextProbeAt = addMin(INTERVAL_MIN)
    await stateCol.updateOne(
      { _id: domain },
      { $set: {
        status: 'unhealthy',
        consecutiveHealthy: 0,
        lastProbeAt: now(),
        nextProbeAt,
        lastError: probe.reason,
        lastPublicNs: probe.publicNs,
        lastPublicA: probe.publicA,
      } },
      { upsert: true }
    )
    log(`${domain}: unhealthy (${probe.reason}) — grace period for non-preDelegation TLD, will recheck in ${INTERVAL_MIN}m`)
    return { domain, status: 'unhealthy' }
  }

  // Heal attempt
  const attempts = Math.min(stateRow.attempts || 0, MAX_ATTEMPTS)
  if (attempts >= MAX_ATTEMPTS || stateRow.status === 'escalated') {
    // Already escalated — keep probing at backoff cap, but don't call OP again
    // unless an operator runs /dnsheal manually.
    //
    // EXCEPTION (Fix 2026-07-01): for pre-delegation TLDs, once the row has
    // been escalated for ≥ESCALATION_SYNC_AFTER_HRS (default 24h) AND we
    // haven't tried opService.syncDomain() yet (or last sync was >24h ago),
    // auto-trigger ONE sync attempt. The sync PUT is what RCP's "Synchronize"
    // button does — re-pushes ns_group:'' + name_servers to force OP→DENIC
    // chprov. This catches the stuck-binding case where the NS update was
    // accepted by OP but the registry never republished.
    const escalationAgeHrs = stateRow.lastHealAttemptAt
      ? (Date.now() - new Date(stateRow.lastHealAttemptAt).getTime()) / 3600000
      : 0
    const lastSyncAgeHrs = stateRow.lastSyncAt
      ? (Date.now() - new Date(stateRow.lastSyncAt).getTime()) / 3600000
      : Infinity
    const shouldAutoSync = preDelegationTld
      && escalationAgeHrs >= ESCALATION_SYNC_AFTER_HRS
      && lastSyncAgeHrs >= 24
      && (stateRow.syncAttempts || 0) < MAX_SYNC_ATTEMPTS

    if (shouldAutoSync) {
      log(`${domain}: escalated ${escalationAgeHrs.toFixed(1)}h, lastSyncAge=${lastSyncAgeHrs === Infinity ? 'never' : lastSyncAgeHrs.toFixed(1) + 'h'} — auto-triggering opService.syncDomain()`)
      let syncResult
      try {
        syncResult = await opService.syncDomain(domain)
      } catch (e) {
        syncResult = { error: e.message }
      }
      const syncOk = !!syncResult?.success
      log(`${domain}: auto-sync result: ${JSON.stringify(syncResult)}`)
      // Give it 5 min for the registry to publish, then re-engage healing
      await stateCol.updateOne(
        { _id: domain },
        { $set: {
          status: syncOk ? 'healing' : 'escalated',
          attempts: syncOk ? 0 : attempts,                 // reset attempts if sync OK
          syncAttempts: (stateRow.syncAttempts || 0) + 1,
          lastSyncAt: now(),
          lastSyncResult: syncOk ? 'ok' : (syncResult?.error || 'unknown'),
          consecutiveHealthy: 0,
          lastProbeAt: now(),
          nextProbeAt: addMin(syncOk ? HEAL_RECHECK_MIN : BACKOFF_LADDER_MIN[BACKOFF_LADDER_MIN.length - 1]),
          lastError: syncOk ? 'auto-sync triggered, awaiting registry publish' : (syncResult?.error || probe.reason),
          lastPublicNs: probe.publicNs,
          lastPublicA: probe.publicA,
        } },
        { upsert: true }
      )
      if (notifyAdmin) {
        const tag = syncOk ? '🔄 [DnsHealer] AUTO-SYNC' : '⚠️ [DnsHealer] AUTO-SYNC FAILED'
        notifyAdmin(
          `${tag}\n` +
          `Domain: <code>${domain}</code> (TLD .${tld})\n` +
          `Was escalated ${escalationAgeHrs.toFixed(1)}h. Sync attempt ${(stateRow.syncAttempts || 0) + 1}/${MAX_SYNC_ATTEMPTS}.\n` +
          `OP sync: ${syncOk ? '✅ accepted' : '❌ ' + (syncResult?.error || 'unknown')}\n` +
          (syncOk ? 'Re-probing in 5min. Will escalate again if registry still does not publish.' : 'Open OpenProvider support ticket.')
        )
      }
      return { domain, status: syncOk ? 'healing' : 'escalated' }
    }

    const nextProbeAt = addMin(BACKOFF_LADDER_MIN[BACKOFF_LADDER_MIN.length - 1])
    await stateCol.updateOne(
      { _id: domain },
      { $set: {
        status: 'escalated',
        consecutiveHealthy: 0,
        lastProbeAt: now(),
        nextProbeAt,
        lastError: probe.reason,
        lastPublicNs: probe.publicNs,
        lastPublicA: probe.publicA,
      } },
      { upsert: true }
    )
    return { domain, status: 'escalated' }
  }

  log(`${domain}: unhealthy (${probe.reason}) — heal attempt ${attempts + 1}/${MAX_ATTEMPTS}, CF NS=${cfNs.join(',')}`)
  const heal = await attemptHeal(domain, cfNs)
  const nextAttempts = attempts + 1
  // FIX (2026-06-30): escalate once we've tried MAX_ATTEMPTS, REGARDLESS of
  // whether OpenProvider's API "accepted" the push. For .de / pre-delegation
  // TLDs, OP routinely returns ok=true while DENIC silently keeps the old NS —
  // the previous `!heal.ok` guard meant those NEVER escalated and the admin was
  // never alerted (they just re-pushed every cycle forever).
  const escalateNow = nextAttempts >= MAX_ATTEMPTS
  const status = escalateNow ? 'escalated' : 'healing'

  const backoffMin = escalateNow
    ? BACKOFF_LADDER_MIN[BACKOFF_LADDER_MIN.length - 1]
    : nextBackoffMin(attempts)

  // Quick 5m recheck only for non-pre-delegation TLDs after a successful push.
  // Pre-delegation TLDs (.de etc.) need real registry-propagation time, so use
  // the backoff ladder even when OP accepted the push.
  const nextProbeMin = (heal.ok && !preDelegationTld) ? HEAL_RECHECK_MIN : backoffMin

  await stateCol.updateOne(
    { _id: domain },
    { $set: {
      status,
      consecutiveHealthy: 0,
      attempts: nextAttempts,
      lastHealAttemptAt: now(),
      lastProbeAt: now(),
      nextProbeAt: addMin(nextProbeMin),
      lastError: heal.error || probe.reason,
      lastHealAction: heal.action,
      lastCfZoneStatus: heal.cfZoneStatus || null,
      lastPublicNs: probe.publicNs,
      lastPublicA: probe.publicA,
    } },
    { upsert: true }
  )

  log(`${domain}: heal action=${heal.action} ok=${heal.ok} cfZone=${heal.cfZoneStatus || '-'} err=${heal.error || '-'} → status=${status}, nextProbe=+${nextProbeMin}m`)

  // Escalation notice (sent once, when crossing into escalated)
  if (escalateNow && notifyAdmin) {
    const registryHint = preDelegationTld
      ? `\n\n⚠️ <i>.${tld} is a pre-delegation TLD. OpenProvider accepted the push (ok=${heal.ok}) but the registry (e.g. DENIC) has not published our CF NS. If CF zone status is not 'active', fix/await CF activation; otherwise open an OpenProvider support ticket to manually reset the .${tld} pre-delegation. Auto-sync will retry in ${ESCALATION_SYNC_AFTER_HRS}h before final escalation.</i>`
      : ''
    notifyAdmin(
      `🚨 <b>[DnsHealer] ESCALATED</b>\n` +
      `Domain: <code>${domain}</code> (TLD .${tld})\n` +
      `Owner: <code>${ownerChatId || 'unknown'}</code>\n` +
      `Attempts: ${nextAttempts}/${MAX_ATTEMPTS}\n` +
      `CF zone status: <code>${heal.cfZoneStatus || 'unknown'}</code>\n` +
      `Last reason: ${probe.reason}\n` +
      `Last heal: action=${heal.action} ok=${heal.ok} err=${heal.error || '-'}\n` +
      `Public NS: <code>${(probe.publicNs.join(', ') || '∅')}</code>\n` +
      `Public A: <code>${(probe.publicA.join(', ') || '∅')}</code>\n` +
      `CF NS expected: <code>${cfNs.join(', ')}</code>` +
      registryHint + `\n\n` +
      `Manual retry: <code>/dnsheal ${domain}</code>`
    )
  }

  return { domain, status }
}

async function tick(db) {
  if (_running) {
    log('tick: previous tick still running — skipping')
    return
  }
  _running = true
  try {
    const stateCol = db.collection('dnsHealState')
    const regCol = db.collection('registeredDomains')
    const batch = await pickBatch(db)

    const counters = { probed: 0, healthy: 0, healing: 0, escalated: 0, stable: 0, unhealthy: 0 }
    for (const row of batch) {
      try {
        const result = await processDomain(db, row, regCol, stateCol)
        if (!result) continue
        counters.probed++
        counters[result.status] = (counters[result.status] || 0) + 1
      } catch (e) {
        log(`processDomain(${row._id}) crashed: ${e.message}`)
      }
    }
    log(`tick: probed=${counters.probed} healthy=${counters.healthy} stable=${counters.stable} unhealthy=${counters.unhealthy} healing=${counters.healing} escalated=${counters.escalated}`)
  } finally {
    _running = false
  }
}

/**
 * Manual single-domain heal — used by the /dnsheal admin command.
 * Resets attempts so the worker will re-engage from scratch.
 */
async function manualHeal(db, domain) {
  const regCol = db.collection('registeredDomains')
  const stateCol = db.collection('dnsHealState')
  const reg = await regCol.findOne({ _id: domain })
  if (!reg) return { ok: false, error: 'domain not in registeredDomains' }
  if (reg.val?.nameserverType !== 'cloudflare') return { ok: false, error: `nameserverType=${reg.val?.nameserverType} (not cloudflare)` }

  // Reset attempts so it isn't blocked by escalation cap
  await stateCol.updateOne(
    { _id: domain },
    { $set: { attempts: 0, status: 'unknown', nextProbeAt: now() } },
    { upsert: true }
  )

  const fresh = await stateCol.findOne({ _id: domain })
  const result = await processDomain(db, fresh, regCol, stateCol)
  const after = await stateCol.findOne({ _id: domain })
  return { ok: true, result, state: after }
}

/**
 * Inline post-registration guard (B1).
 *
 * Called right after a successful opService.registerDomain. For pre-delegation
 * TLDs, waits up to ~60s for the registry to publish CF NS; if that fails,
 * applies the heal ladder once and waits another ~60s. Returns:
 *   { healthy: bool, action: 'noop'|'healed-now'|'queued-for-worker' }
 *
 * On 'queued-for-worker', the background tick() will keep re-probing.
 */
async function verifyDelegationOrQueue(db, domain, cfNameservers, ownerChatId = null) {
  const tld = tldOf(domain)
  // For non-pre-delegation TLDs, skip the inline wait — propagation is normal there.
  if (!PRE_DELEGATION_TLDS.has(tld)) {
    return { healthy: true, action: 'noop', skipped: 'not-preDelegation-TLD' }
  }

  log(`[B1] verifying delegation for ${domain} (TLD .${tld}) — up to 60s`)
  const tryFor = async (totalMs) => {
    const deadline = Date.now() + totalMs
    let last = null
    while (Date.now() < deadline) {
      last = await probeDelegation(domain)
      if (last.healthy) return last
      await new Promise((r) => setTimeout(r, 5000))
    }
    return last
  }

  let probe = await tryFor(60000)
  if (probe?.healthy) {
    log(`[B1] ${domain}: delegated on first wait — ok`)
    return { healthy: true, action: 'noop' }
  }

  // Heal once inline
  log(`[B1] ${domain}: not delegated yet (${probe?.reason}). Re-pushing NS to registrar…`)
  const heal = await attemptHeal(domain, cfNameservers)
  log(`[B1] ${domain}: heal ok=${heal.ok} action=${heal.action} err=${heal.error || '-'}`)

  probe = await tryFor(60000)
  if (probe?.healthy) {
    log(`[B1] ${domain}: delegated after inline heal — ok`)
    // Persist a clean state row
    await db.collection('dnsHealState').updateOne(
      { _id: domain },
      { $set: {
        status: 'healthy',
        attempts: 0,
        consecutiveHealthy: 1,
        lastProbeAt: now(),
        nextProbeAt: addMin(INTERVAL_MIN),
        lastError: null,
        lastHealAttemptAt: now(),
        lastPublicNs: probe.publicNs,
        lastPublicA: probe.publicA,
      } },
      { upsert: true }
    )
    return { healthy: true, action: 'healed-now' }
  }

  // Still not delegated — queue for the background healer
  log(`[B1] ${domain}: still not delegated after inline heal — queued for background DnsHealer`)
  await db.collection('dnsHealState').updateOne(
    { _id: domain },
    { $set: {
      status: 'healing',
      attempts: 1,                                    // we already burned one inline
      consecutiveHealthy: 0,
      lastHealAttemptAt: now(),
      lastProbeAt: now(),
      nextProbeAt: addMin(HEAL_RECHECK_MIN),
      lastError: heal.error || probe?.reason || 'unknown',
      lastPublicNs: probe?.publicNs || [],
      lastPublicA: probe?.publicA || [],
      ownerChatId,
    } },
    { upsert: true }
  )
  return { healthy: false, action: 'queued-for-worker', reason: probe?.reason }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
function startScheduler(db, opts = {}) {
  if (opts.bot) bot = opts.bot
  if (opts.notifyAdmin) notifyAdmin = opts.notifyAdmin
  if (opts.adminChatId) TELEGRAM_ADMIN_CHAT_ID = opts.adminChatId

  if (_timer) {
    log('startScheduler called twice — ignored')
    return
  }
  log(`startScheduler: every ${INTERVAL_MIN}m, max ${MAX_ATTEMPTS} heal attempts before escalation, active window ${ACTIVE_WINDOW_DAYS}d`)

  // Run one tick on boot (after 30s grace so other services come up)
  setTimeout(() => { tick(db).catch((e) => log(`boot tick crashed: ${e.message}`)) }, 30 * 1000)

  _timer = setInterval(() => {
    tick(db).catch((e) => log(`tick crashed: ${e.message}`))
  }, INTERVAL_MIN * 60 * 1000)
}

function stopScheduler() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  verifyDelegationOrQueue,
  manualHeal,
  probeDelegation,
  PRE_DELEGATION_TLDS,
  // Exported for testing
  _internals: { attemptHeal, tick, pickBatch, processDomain },
}
