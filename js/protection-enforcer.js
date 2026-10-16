/* global process */
/**
 * Protection Enforcer — ensures ALL domains in the system have
 * Cloudflare Worker anti-red protection (both domain/* and www.domain/*).
 *
 * Sources:
 *  1. registeredDomains — domains registered via the bot
 *  2. domainsOf — custom domains used for link shortening
 *  3. cpanelAccounts — hosting accounts (main domain + addon domains)
 *
 * Runs on a schedule (configurable) to verify and repair protection.
 */

require('dotenv').config()
const { log } = require('console')
const axios = require('axios')

const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
const CF_HEADERS = {
  'X-Auth-Email': CF_EMAIL,
  'X-Auth-Key': CF_API_KEY,
  'Content-Type': 'application/json',
}
const CF_BASE = 'https://api.cloudflare.com/client/v4'
const WORKER_NAME = 'antired-challenge'

// Our WHM/hosting server IP — only domains pointing here should get anti-red protection
const OUR_SERVER_IP = process.env.RENDER_APP_IP_ADDRESS || '199.247.22.196'
const WHM_HOST_IP = process.env.WHM_HOST || '199.247.22.196'

// How often to run enforcement (default: every 6 hours)
const ENFORCE_INTERVAL_MS = parseInt(process.env.PROTECTION_ENFORCE_INTERVAL_HOURS || '6', 10) * 60 * 60 * 1000

let db = null
let enforceTimer = null
let isRunning = false
// Optional bot/handle for owner notifications (set via startScheduler({ bot })).
// We avoid module-level requires of `bot` to prevent circular deps with _index.js.
let _bot = null

// ─── Persistent Failure & DNS Cache Tracking ────────────
// Tracks CF zones that repeatedly fail SSL/AOP checks (auth errors, 404s).
// After 3+ consecutive failures, skip for 7 days to avoid log noise.
// Also caches "not pointing to us" DNS results to skip redundant CF API lookups.
const ZONE_FAILURE_THRESHOLD = 3         // Skip after N consecutive failures
const ZONE_FAILURE_SKIP_DAYS = 7         // How long to skip failing zones
const DNS_CACHE_SKIP_DAYS = 7            // Re-check stale domains after N days
const DNS_CACHE_MISS_THRESHOLD = 3       // Consecutive misses before caching as stale

// ─── Initialize ──────────────────────────────────────────

function init(mongoDb) {
  db = mongoDb
  log('[ProtectionEnforcer] Initialized')
}

// ─── Domain Collection ───────────────────────────────────

/**
 * Collect ALL domains from all sources in the database.
 * Returns array of { domain, source, cfZoneId? }
 */
async function collectAllDomains() {
  if (!db) throw new Error('ProtectionEnforcer not initialized')

  const domains = new Map() // domain → { source, cfZoneId }

  // 1. registeredDomains
  try {
    const registered = await db.collection('registeredDomains').find({}).toArray()
    for (const doc of registered) {
      const domain = doc.val?.domain || doc._id
      if (domain && typeof domain === 'string' && domain.includes('.')) {
        domains.set(domain.toLowerCase(), {
          source: 'registeredDomains',
          cfZoneId: doc.val?.cfZoneId || null,
          antiRedOff: doc.val?.antiRedOff === true,
        })
      }
    }
    log(`[ProtectionEnforcer] registeredDomains: ${registered.length} entries`)
  } catch (e) {
    log(`[ProtectionEnforcer] Error reading registeredDomains: ${e.message}`)
  }

  // 2. domainsOf (custom link shortener domains)
  // Format: { _id: chatId, "domain@tld": true, ... }
  try {
    const customDocs = await db.collection('domainsOf').find({}).toArray()
    let count = 0
    for (const doc of customDocs) {
      for (const key of Object.keys(doc)) {
        if (key === '_id') continue
        if (doc[key] !== true) continue
        // Convert "domain@tld" → "domain.tld"
        const domain = key.replace('@', '.').toLowerCase()
        if (domain.includes('.') && !domains.has(domain)) {
          domains.set(domain, { source: 'domainsOf', cfZoneId: null })
          count++
        }
      }
    }
    log(`[ProtectionEnforcer] domainsOf: ${count} unique custom domains`)
  } catch (e) {
    log(`[ProtectionEnforcer] Error reading domainsOf: ${e.message}`)
  }

  // 3. cpanelAccounts — main domain + try to get addon domains via CF zones
  try {
    const cpAccounts = await db.collection('cpanelAccounts').find({}).toArray()
    for (const account of cpAccounts) {
      const mainDomain = account.domain
      if (mainDomain && mainDomain.includes('.')) {
        // Include cpUser for SSL upgrade logic (AutoSSL needs the cPanel username)
        const existing = domains.get(mainDomain.toLowerCase())
        if (existing) {
          // Merge cpUser into existing entry (preserve antiRedOff from registeredDomains)
          existing.source = 'cpanelAccounts'
          existing.cpUser = account._id || account.cpUser || null
        } else {
          domains.set(mainDomain.toLowerCase(), {
            source: 'cpanelAccounts',
            cfZoneId: null,
            cpUser: account._id || account.cpUser || null,
            antiRedOff: false,
          })
        }
      }
      // Check for addon domains stored in the account
      if (Array.isArray(account.addonDomains)) {
        for (const addon of account.addonDomains) {
          const d = (typeof addon === 'string' ? addon : addon.domain || '').toLowerCase()
          if (d && d.includes('.') && !domains.has(d)) {
            // Propagate cpUser from parent account so SSL enforcement works on addon domains
            // antiRedOff defaults to false; addon domains inherit from registeredDomains if they exist there
            domains.set(d, {
              source: 'cpanelAddon',
              cfZoneId: null,
              cpUser: account._id || account.cpUser || null,
              parentDomain: mainDomain?.toLowerCase() || null,
              antiRedOff: false,
            })
          }
        }
      }
    }
    log(`[ProtectionEnforcer] cpanelAccounts: ${cpAccounts.length} accounts`)
  } catch (e) {
    log(`[ProtectionEnforcer] Error reading cpanelAccounts: ${e.message}`)
  }

  // Convert map to array
  const result = []
  for (const [domain, info] of domains) {
    result.push({ domain, ...info })
  }
  log(`[ProtectionEnforcer] Total unique domains: ${result.length}`)
  return result
}

// ─── Cloudflare Zone Lookup ──────────────────────────────

/**
 * Look up a Cloudflare zone by domain name.
 * Returns zone object { id, status } or null.
 */
async function findCFZone(domain) {
  try {
    const res = await axios.get(`${CF_BASE}/zones`, {
      params: { name: domain, per_page: 1 },
      headers: CF_HEADERS,
      timeout: 10000,
    })
    const zones = res.data?.result || []
    return zones.length > 0 ? { id: zones[0].id, status: zones[0].status } : null
  } catch {
    return null
  }
}

// ─── Worker Route Enforcement ────────────────────────────

/**
 * Check if a domain's root A record in Cloudflare points to our server.
 * Domains pointing elsewhere (user's own server) should NOT get anti-red Workers.
 * Returns true if domain points to our server, false otherwise.
 */
async function domainPointsToOurServer(domain, zoneId) {
  try {
    const res = await axios.get(`${CF_BASE}/zones/${zoneId}/dns_records`, {
      params: { type: 'A', name: domain },
      headers: CF_HEADERS,
      timeout: 10000,
    })
    const records = res.data?.result || []
    if (records.length === 0) {
      // No A record — check if CNAME points to our tunnel or infrastructure
      const cnameRes = await axios.get(`${CF_BASE}/zones/${zoneId}/dns_records`, {
        params: { type: 'CNAME', name: domain },
        headers: CF_HEADERS,
        timeout: 10000,
      })
      const cnames = cnameRes.data?.result || []
      if (cnames.length === 0) return false
      // Accept: our CF tunnel CNAME or any .cfargotunnel.com CNAME
      const tunnelCname = process.env.CF_TUNNEL_CNAME || ''
      return cnames.some(r =>
        r.content === tunnelCname ||
        r.content.endsWith('.cfargotunnel.com')
      ) || cnames.length > 0 // Fallback: any CNAME in our zone is likely ours
    }
    // Check if the A record points to our WHM server or Render app IP
    const ourIPs = [OUR_SERVER_IP, WHM_HOST_IP].filter(Boolean)
    return records.some(r => ourIPs.includes(r.content))
  } catch {
    // On error, default to protecting (safer)
    return true
  }
}

/**
 * Ensure a domain has both `domain/*` and `www.domain/*` worker routes.
 * Returns { domain, status, actions[] }
 */
async function enforceWorkerRoutes(domain, zoneId) {
  const actions = []

  try {
    // Get existing routes
    const routesRes = await axios.get(`${CF_BASE}/zones/${zoneId}/workers/routes`, {
      headers: CF_HEADERS,
      timeout: 10000,
    })
    const routes = routesRes.data?.result || []
    const hasMain = routes.some(r => r.pattern === `${domain}/*`)
    const hasWww = routes.some(r => r.pattern === `www.${domain}/*`)

    // Deploy main route if missing
    if (!hasMain) {
      try {
        await axios.post(`${CF_BASE}/zones/${zoneId}/workers/routes`, {
          pattern: `${domain}/*`,
          script: WORKER_NAME,
        }, { headers: CF_HEADERS, timeout: 10000 })
        actions.push(`deployed ${domain}/*`)
      } catch (e) {
        if (!e.response?.data?.errors?.some(err => err.message?.includes('duplicate'))) {
          actions.push(`FAILED ${domain}/*: ${e.message}`)
        } else {
          actions.push(`${domain}/* already exists (duplicate)`)
        }
      }
    }

    // Deploy www route if missing
    if (!hasWww) {
      try {
        await axios.post(`${CF_BASE}/zones/${zoneId}/workers/routes`, {
          pattern: `www.${domain}/*`,
          script: WORKER_NAME,
        }, { headers: CF_HEADERS, timeout: 10000 })
        actions.push(`deployed www.${domain}/*`)
      } catch (e) {
        if (!e.response?.data?.errors?.some(err => err.message?.includes('duplicate'))) {
          actions.push(`FAILED www.${domain}/*: ${e.message}`)
        } else {
          actions.push(`www.${domain}/* already exists (duplicate)`)
        }
      }
    }

    const status = hasMain && hasWww ? 'already_protected' : actions.length > 0 ? 'fixed' : 'already_protected'
    return { domain, zoneId, status, actions }
  } catch (err) {
    const status = err.response?.status
    if (status === 403 || status === 404) {
      return { domain, zoneId, status: 'stale_zone', actions: [`route check failed (HTTP ${status} — stale CF zone): ${err.message}`] }
    }
    return { domain, zoneId, status: 'error', actions: [`route check failed: ${err.message}`] }
  }
}

// ─── SSL Mode Enforcement ──────────────────────────────

// Grace period: don't upgrade 'flexible' → 'full' for domains first seen within this window.
// AutoSSL / self-signed cert generation on cPanel can take time; switching to 'full' before
// the origin has any cert causes HTTP 421 "Misdirected Request" (SNI mismatch).
const SSL_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * (Fix b) Check if a domain is still within its SSL grace period.
 * The first time the enforcer sees a domain on 'flexible', it records the timestamp.
 * Until SSL_GRACE_PERIOD_MS has elapsed, 'flexible' → 'full' upgrades are deferred.
 */
async function isInSSLGracePeriod(domain) {
  if (!db) return false
  try {
    const record = await db.collection('sslGracePeriod').findOne({ _id: domain })
    if (!record) return false
    const elapsed = Date.now() - new Date(record.firstSeen).getTime()
    if (elapsed < SSL_GRACE_PERIOD_MS) {
      const hoursLeft = ((SSL_GRACE_PERIOD_MS - elapsed) / (60 * 60 * 1000)).toFixed(1)
      log(`[ProtectionEnforcer] SSL grace period active for ${domain} — ${hoursLeft}h remaining (first seen: ${record.firstSeen})`)
      return true
    }
    // Grace period expired — clean up the record
    await db.collection('sslGracePeriod').deleteOne({ _id: domain })
    return false
  } catch { return false }
}

/**
 * Record a domain entering the SSL grace period (first time seen on 'flexible').
 * Also tracks consecutive deferCount so we can escalate to admin after N cycles.
 */
async function recordSSLGracePeriod(domain, lastError = null) {
  if (!db) return
  try {
    await db.collection('sslGracePeriod').updateOne(
      { _id: domain },
      {
        $setOnInsert: { firstSeen: new Date().toISOString(), domain },
        $set: { lastDeferAt: new Date(), lastDeferError: lastError },
        $inc: { deferCount: 1 },
      },
      { upsert: true }
    )
  } catch (e) { log(`[ProtectionEnforcer] SSL grace record error for ${domain}: ${e.message}`) }
}

/**
 * If the origin has failed the SSL probe for many consecutive cycles, page
 * the admin so somebody actually looks at why the WHM origin isn't answering
 * HTTPS. Prior behaviour: silent "SSL DEFERRED ... grace period started, will
 * retry in 24h" every 24 h forever (see 2026-07-08 chatId 8011229362 logs for
 * eventrsvp.sbs — 30+ hours deferring silently). Now: after 3 defers we
 * escalate; after that we notify at most once every 7 days to avoid spam.
 */
async function _maybeEscalateSSLDefer(domain, deferCount, error) {
  try {
    if (deferCount < 3) return
    const admin = process.env.TELEGRAM_ADMIN_CHAT_ID
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_PROD
    if (!admin || !token) return
    // Notify once when we cross the threshold, then at most weekly.
    const rec = await db.collection('sslGracePeriod').findOne({ _id: domain })
    const lastAlert = rec?.lastAdminAlertAt ? new Date(rec.lastAdminAlertAt).getTime() : 0
    if (deferCount > 3 && (Date.now() - lastAlert) < 7 * 24 * 60 * 60 * 1000) return
    const msg =
      `🔒 <b>SSL upgrade stuck</b>\n` +
      `Domain: <b>${domain}</b>\n` +
      `Consecutive defers: <b>${deferCount}</b>\n` +
      `Last probe error: <code>${(error || 'unknown').slice(0, 200)}</code>\n\n` +
      `The bot keeps CF SSL on 'flexible' (weaker) because the origin server can't terminate TLS for this domain. Fix on WHM/cPanel: install a valid cert (AutoSSL) or check that <code>${domain}</code> is served on port 443.`
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: admin, text: msg, parse_mode: 'HTML', disable_web_page_preview: true,
    }, { timeout: 10000 })
    await db.collection('sslGracePeriod').updateOne(
      { _id: domain },
      { $set: { lastAdminAlertAt: new Date() } }
    )
    log(`[ProtectionEnforcer] SSL escalation sent to admin for ${domain} (deferCount=${deferCount})`)
  } catch (e) { /* best-effort */ }
}

/**
 * (Fix a) Probe whether the origin server can handle HTTPS for this domain.
 * Makes a direct HTTPS request to the origin IP with the correct SNI.
 * Returns { ok, status, error } — ok=true means it's safe to switch to 'full'.
 *
 * Failure status codes that indicate origin SSL is NOT ready:
 *  - 421: Misdirected Request (SNI doesn't match origin cert)
 *  - 525: SSL Handshake Failed
 *  - 526: Invalid SSL Certificate
 *  - Connection errors (ECONNREFUSED, ECONNRESET, etc.)
 */
async function probeOriginSSL(domain) {
  const https = require('https')
  const originIP = WHM_HOST_IP || OUR_SERVER_IP
  if (!originIP) return { ok: false, status: 0, error: 'No origin IP configured' }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, status: 0, error: 'Probe timeout (8s)' })
    }, 8000)

    const req = https.request({
      hostname: originIP,
      port: 443,
      path: '/',
      method: 'HEAD',
      servername: domain,  // SNI — this is the critical part
      rejectUnauthorized: false,  // Accept self-signed certs (like CF 'full' mode does)
      timeout: 7000,
      headers: { 'Host': domain, 'User-Agent': 'ProtectionEnforcer-SSLProbe/1.0' },
    }, (res) => {
      clearTimeout(timer)
      const status = res.statusCode
      // 421 = Misdirected Request (SNI mismatch — origin cert doesn't cover this domain)
      // 502/525/526 = SSL-related failures
      const badStatuses = [421, 525, 526]
      if (badStatuses.includes(status)) {
        resolve({ ok: false, status, error: `Origin returned ${status} (SSL not ready for ${domain})` })
      } else {
        // Any 2xx, 3xx, 4xx (except 421), or even 5xx (except SSL-specific) means origin CAN terminate TLS for this domain
        resolve({ ok: true, status, error: null })
      }
    })

    req.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, status: 0, error: `Origin probe failed: ${err.code || err.message}` })
    })

    req.on('timeout', () => {
      req.destroy()
      clearTimeout(timer)
      resolve({ ok: false, status: 0, error: 'Origin probe socket timeout' })
    })

    req.end()
  })
}

/**
 * Ensure hosting domains use 'full' SSL mode (not 'strict').
 * Cloudflare handles visitor-facing SSL. Origin uses self-signed cert.
 * 'full' mode encrypts CF→origin traffic and accepts self-signed certs.
 * 'strict' requires CA-signed certs on origin which causes 526 errors.
 *
 * If a domain is stuck on 'strict' (from old logic), downgrade to 'full'.
 * If a domain is on 'off' or 'flexible', upgrade to 'full' — BUT only after:
 *   (a) Probing the origin to confirm it can handle HTTPS for this domain (no 421/525/526)
 *   (b) The domain has been out of the 24h grace period (AutoSSL needs time)
 */
async function enforceSSLMode(domain, zoneId) {
  try {
    const sslRes = await axios.get(`${CF_BASE}/zones/${zoneId}/settings/ssl`, {
      headers: CF_HEADERS,
      timeout: 10000,
    })
    const currentSSL = sslRes.data?.result?.value

    // 'full' is the target — no action needed
    if (currentSSL === 'full') return

    // Fix 'strict' → 'full' immediately (this always helps, no probe needed)
    if (currentSSL === 'strict') {
      await axios.patch(`${CF_BASE}/zones/${zoneId}/settings/ssl`, { value: 'full' }, {
        headers: CF_HEADERS,
        timeout: 10000,
      })
      log(`[ProtectionEnforcer] SSL FIXED: ${domain} from 'strict' → 'full'`)
      return
    }

    // Fix 'off' → 'full' immediately (off is always worse than full)
    if (currentSSL === 'off') {
      await axios.patch(`${CF_BASE}/zones/${zoneId}/settings/ssl`, { value: 'full' }, {
        headers: CF_HEADERS,
        timeout: 10000,
      })
      log(`[ProtectionEnforcer] SSL FIXED: ${domain} from 'off' → 'full'`)
      return
    }

    // ── 'flexible' → 'full' requires safety checks ──
    if (currentSSL === 'flexible') {
      // (b) Grace period check — don't upgrade too soon after domain creation
      const inGrace = await isInSSLGracePeriod(domain)
      if (inGrace) {
        return // Skip — domain is still new, AutoSSL may not have issued a cert yet
      }

      // (a) Origin SSL probe — verify the origin server can terminate TLS for this domain
      const probe = await probeOriginSSL(domain)
      if (!probe.ok) {
        // Origin can't handle HTTPS for this domain yet — record grace period and skip
        await recordSSLGracePeriod(domain, probe.error)
        log(`[ProtectionEnforcer] SSL DEFERRED: ${domain} staying on 'flexible' — origin not ready (${probe.error}). Grace period started, will retry in ${SSL_GRACE_PERIOD_MS / 3600000}h.`)
        // BUG FIX (2026-07-08): after 3 consecutive defers, page admin so the
        // origin gets looked at instead of silently deferring forever.
        try {
          const rec = await db.collection('sslGracePeriod').findOne({ _id: domain })
          const deferCount = (rec && rec.deferCount) || 1
          await _maybeEscalateSSLDefer(domain, deferCount, probe.error)
        } catch { /* best-effort */ }
        return
      }

      // Both checks passed — safe to upgrade
      await axios.patch(`${CF_BASE}/zones/${zoneId}/settings/ssl`, { value: 'full' }, {
        headers: CF_HEADERS,
        timeout: 10000,
      })
      log(`[ProtectionEnforcer] SSL UPGRADED: ${domain} from 'flexible' → 'full' (origin probe OK, status=${probe.status})`)
      // Success — remove the grace period doc so the deferCount / lastAdminAlertAt reset.
      try { await db.collection('sslGracePeriod').deleteOne({ _id: domain }) } catch { /* best-effort */ }
    }
  } catch (err) {
    if (!err.message?.includes('ECONNREFUSED')) {
      log(`[ProtectionEnforcer] SSL mode check error for ${domain}: ${err.message}`)
    }
  }
}

// ─── Origin CA self-heal ────────────────────────────────
// At provisioning the Origin CA cert is requested right after the CF zone is
// created, while the zone is still activating; Cloudflare rejects it with the
// misleading "zone is not part of your account" and provisioning never retries.
// The origin (cPanel) then has no cert for the domain, so enforceSSLMode's HTTPS
// probe fails and the zone is stuck on 'flexible' (plain-HTTP CF→origin) forever.
// This self-heal (runs in the 6-hourly loop) mints + installs an Origin CA cert
// once the zone is active, breaking the deadlock → next pass upgrades SSL to full.
const ORIGIN_CERT_REFRESH_DAYS = parseInt(process.env.ORIGIN_CERT_REFRESH_DAYS || '30', 10)

const ORIGIN_CERT_FAIL_BACKOFF_DAYS = 7

async function ensureOriginCert(domain, zoneId, cpUser) {
  const actions = []
  if (!cpUser || !zoneId || !db) return actions

  // Only act on domains actually hosted on a LIVE cPanel account. The enforcer's
  // domain map includes deleted accounts (cpanelAccounts.find({})), whose domains
  // WHM no longer manages — minting a cert for those just orphans it on CF.
  const acct = await db.collection('cpanelAccounts').findOne({ $or: [{ _id: cpUser }, { cpUser }] })
  if (!acct || acct.deleted) return actions
  const hosted = [acct.domain, ...(acct.addonDomains || []).map(a => (typeof a === 'string' ? a : a?.domain))]
    .filter(Boolean).map(s => String(s).toLowerCase())
  if (!hosted.includes(String(domain).toLowerCase())) return actions

  // Dedup: skip if satisfied within the refresh window, or failed within the backoff.
  try {
    const state = await db.collection('originCertState').findOne({ _id: domain })
    const age = (t) => Date.now() - new Date(t).getTime()
    if (state?.installedAt && age(state.installedAt) < ORIGIN_CERT_REFRESH_DAYS * 86400000) return actions
    if (state?.failedAt && age(state.failedAt) < ORIGIN_CERT_FAIL_BACKOFF_DAYS * 86400000) return actions
  } catch { /* fall through and attempt */ }

  const recordState = async (fields) => {
    try {
      await db.collection('originCertState').updateOne(
        { _id: domain },
        { $set: { ...fields, domain, cpUser, updatedAt: new Date() } },
        { upsert: true }
      )
    } catch (e) { log(`[ProtectionEnforcer] originCertState write error for ${domain}: ${e.message}`) }
  }

  // If the origin already terminates TLS for this domain (AutoSSL or a prior
  // cert), there's nothing to do — remember it so we don't re-check every pass.
  const probe = await probeOriginSSL(domain)
  if (probe.ok) {
    await recordState({ installedAt: new Date(), via: 'origin-already-ok' })
    return actions
  }

  const cfService = require('./cf-service')
  const whmService = require('./whm-service')
  const certResult = await cfService.generateOriginCACert([domain, `*.${domain}`])
  if (!certResult.success) {
    // Zone most likely still pending/activating — let the next 6h pass retry.
    actions.push(`origin CA skipped for ${domain}: ${certResult.code || certResult.error || 'unknown'}`)
    return actions
  }
  const installRes = await whmService.installDomainSSL(cpUser, domain, certResult.certificate, certResult.privateKey)
  if (!installRes.success) {
    await recordState({ failedAt: new Date(), via: 'install-failed', error: String(installRes.error || '').slice(0, 200) })
    actions.push(`origin CA install FAILED for ${domain}: ${installRes.error}`)
    return actions
  }
  try { await whmService.excludeDomainsFromAutoSSL(cpUser, [domain, `www.${domain}`]) } catch (_) { /* best-effort */ }
  await recordState({ installedAt: new Date(), via: 'origin-ca', certId: certResult.id || null })
  actions.push(`origin CA installed for ${domain}`)
  return actions
}

// ─── Origin Hardening (CT + Direct IP protection) ───────

/**
 * Ensure a hosting domain has Authenticated Origin Pulls enabled AND a valid
 * origin cert (self-heals the provisioning race that left CF↔origin on 'flexible').
 *
 * @param {string} domain
 * @param {string} zoneId
 * @param {string|null} cpUser - cPanel username (used for Origin CA install)
 */
async function enforceOriginHardening(domain, zoneId, cpUser) {
  const actions = []
  const cfService = require('./cf-service')

  // Enable Authenticated Origin Pulls (blocks direct-IP and SNI scanning)
  try {
    const aopStatus = await cfService.getAuthenticatedOriginPullsStatus(zoneId)
    if (!aopStatus.enabled) {
      const result = await cfService.enableAuthenticatedOriginPulls(zoneId)
      if (result.success) {
        actions.push(`AOP enabled for ${domain}`)
      } else {
        actions.push(`AOP FAILED for ${domain}: ${result.error}`)
      }
    }
  } catch (err) {
    actions.push(`AOP check error for ${domain}: ${err.message}`)
  }

  // Origin CA cert self-heal (install on cPanel so CF SSL can reach 'full')
  try {
    const certActions = await ensureOriginCert(domain, zoneId, cpUser)
    actions.push(...certActions)
  } catch (err) {
    actions.push(`origin CA check error for ${domain}: ${err.message}`)
  }

  return actions
}

// ─── Zone Failure Tracking Helpers ──────────────────────

/**
 * Check if a CF zone should be skipped due to persistent auth/SSL failures.
 * Returns true if zone has failed >= ZONE_FAILURE_THRESHOLD times and skip hasn't expired.
 */
async function isZoneSkipped(zoneId) {
  if (!db) return false
  try {
    const record = await db.collection('protectionZoneFailures').findOne({ _id: zoneId })
    if (!record || record.consecutiveFailures < ZONE_FAILURE_THRESHOLD) return false
    const skipUntil = new Date(record.lastFailedAt).getTime() + ZONE_FAILURE_SKIP_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() < skipUntil) return true
    // Skip period expired — reset and allow retry
    await db.collection('protectionZoneFailures').deleteOne({ _id: zoneId })
    return false
  } catch { return false }
}

/**
 * Record a CF zone auth/SSL failure. Increments consecutive failure counter.
 */
async function recordZoneFailure(zoneId, domain, errorMsg) {
  if (!db) return
  try {
    await db.collection('protectionZoneFailures').updateOne(
      { _id: zoneId },
      {
        $inc: { consecutiveFailures: 1 },
        $set: { lastFailedAt: new Date(), lastDomain: domain, lastError: errorMsg },
        $setOnInsert: { firstFailedAt: new Date() }
      },
      { upsert: true }
    )
  } catch (e) { log(`[ProtectionEnforcer] Zone failure tracking error: ${e.message}`) }
}

/**
 * Reset zone failure counter (called when a zone succeeds).
 */
async function resetZoneFailure(zoneId) {
  if (!db) return
  try {
    await db.collection('protectionZoneFailures').deleteOne({ _id: zoneId })
  } catch { /* ignore */ }
}

// ─── DNS Result Cache Helpers ───────────────────────────

/**
 * Check if a domain's DNS "not pointing to us" result is cached and still valid.
 * Returns true if domain should be skipped (known stale).
 */
async function isDnsCacheStale(domain) {
  if (!db) return false
  try {
    const record = await db.collection('domainDnsCache').findOne({ _id: domain })
    if (!record || record.pointsToUs !== false) return false
    if (record.consecutiveMisses < DNS_CACHE_MISS_THRESHOLD) return false
    const skipUntil = new Date(record.checkedAt).getTime() + DNS_CACHE_SKIP_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() < skipUntil) return true
    // Cache expired — allow fresh check
    return false
  } catch { return false }
}

/**
 * Update DNS cache after a live check.
 */
async function updateDnsCache(domain, pointsToUs) {
  if (!db) return
  try {
    if (pointsToUs) {
      await db.collection('domainDnsCache').deleteOne({ _id: domain })
    } else {
      await db.collection('domainDnsCache').updateOne(
        { _id: domain },
        {
          $inc: { consecutiveMisses: 1 },
          $set: { pointsToUs: false, checkedAt: new Date() },
          $setOnInsert: { firstMissAt: new Date() }
        },
        { upsert: true }
      )
    }
  } catch (e) { log(`[ProtectionEnforcer] DNS cache write error for ${domain}: ${e.message}`) }
}

/**
 * Run a full enforcement pass across all domains.
 * Returns summary of actions taken.
 */
async function runEnforcement() {
  if (isRunning) {
    log('[ProtectionEnforcer] Enforcement already running, skipping')
    return { skipped: true }
  }

  isRunning = true
  const startTime = Date.now()
  log('[ProtectionEnforcer] ═══ Starting enforcement run ═══')

  const summary = {
    total: 0,
    protected: 0,
    fixed: 0,
    noZone: 0,
    errors: 0,
    dnsSkipped: 0,
    zoneSkipped: 0,
    actions: [],
  }

  try {
    const allDomains = await collectAllDomains()
    summary.total = allDomains.length

    for (const entry of allDomains) {
      const { domain, cfZoneId } = entry

      // Find Cloudflare zone
      let zoneId = cfZoneId
      if (!zoneId) {
        const zone = await findCFZone(domain)
        if (zone) {
          zoneId = zone.id
          // Update the registeredDomains with the found zone ID if applicable
          if (entry.source === 'registeredDomains') {
            try {
              await db.collection('registeredDomains').updateOne(
                { _id: domain },
                { $set: { 'val.cfZoneId': zoneId } }
              )
            } catch {}
          }
        }
      }

      if (!zoneId) {
        summary.noZone++
        continue
      }

      // ── DNS CACHE: Skip domains known to not point to us ──
      // Domains that consistently have A records pointing elsewhere are cached.
      // Re-checked every DNS_CACHE_SKIP_DAYS to detect if they return.
      const cachedStale = await isDnsCacheStale(domain)
      if (cachedStale) {
        summary.dnsSkipped++
        summary.protected++ // count as OK, just not ours
        continue
      }

      // Skip domains that don't point to our server (e.g., domain-only purchases
      // where the user set their own A record to their own server)
      const pointsToUs = await domainPointsToOurServer(domain, zoneId)
      await updateDnsCache(domain, pointsToUs) // persist result
      if (!pointsToUs) {
        log(`[ProtectionEnforcer] SKIP: ${domain} — A record does not point to our server`)
        summary.protected++ // count as OK, just not ours to protect
        continue
      }

      // Only enforce Worker routes for domains with a hosting plan (cpanelAccounts or addon domains).
      // Domain-only domains should NOT get anti-red Workers, even if their DNS
      // points to our server (could be leftover DNS or misconfiguration).
      if (entry.source === 'cpanelAccounts' || entry.source === 'cpanelAddon') {
        // NOTE (2026-02): we no longer skip on `antiRedOff` here. The Worker
        // route MUST always be deployed so scanner cloaking + honeypots + IP bans
        // run for every hosting domain. The captcha toggle is now Worker-side
        // (KV `bypass:{domain}`) and only skips the human challenge page.
        // Legacy `antiRedOff=true` docs are cleaned up by runLegacyAntiRedOffMigration().

        // Enforce worker routes for hosting domains (main + addon)
        const result = await enforceWorkerRoutes(domain, zoneId)

        // ── Stale-zone self-heal: re-lookup CF zone and retry ──
        if (result.status === 'stale_zone') {
          log(`[ProtectionEnforcer] Stale zone detected for ${domain} (zoneId=${zoneId}), refreshing...`)
          try {
            const cfService = require('./cf-service')
            const freshZone = await cfService.getZoneByName(domain)
            if (freshZone && freshZone.id && freshZone.id !== zoneId) {
              await db.collection('registeredDomains').updateOne(
                { _id: domain },
                { $set: { 'val.cfZoneId': freshZone.id } }
              )
              log(`[ProtectionEnforcer] Zone refreshed for ${domain}: ${zoneId} → ${freshZone.id}`)
              zoneId = freshZone.id  // update local variable for downstream SSL/hardening
              const retryResult = await enforceWorkerRoutes(domain, freshZone.id)
              if (retryResult.status === 'already_protected') {
                summary.protected++
              } else if (retryResult.status === 'fixed') {
                summary.fixed++
                summary.actions.push(...retryResult.actions)
                log(`[ProtectionEnforcer] FIXED (after zone refresh): ${domain} — ${retryResult.actions.join(', ')}`)
              } else {
                summary.errors++
                summary.actions.push(...retryResult.actions)
              }
            } else if (!freshZone) {
              log(`[ProtectionEnforcer] Zone not found on CF for ${domain} — clearing stale cfZoneId`)
              await db.collection('registeredDomains').updateOne(
                { _id: domain },
                { $unset: { 'val.cfZoneId': '' } }
              )
              summary.errors++
              summary.actions.push(`${domain}: cleared stale zone (domain not on CF)`)
              continue  // skip SSL/hardening since zone is gone
            } else {
              log(`[ProtectionEnforcer] Zone ID unchanged for ${domain} — CF still rejecting`)
              summary.errors++
              summary.actions.push(...result.actions)
              continue
            }
          } catch (refreshErr) {
            log(`[ProtectionEnforcer] Zone refresh error for ${domain}: ${refreshErr.message}`)
            summary.errors++
            continue
          }
        } else if (result.status === 'already_protected') {
          summary.protected++
        } else if (result.status === 'fixed') {
          summary.fixed++
          summary.actions.push(...result.actions)
          log(`[ProtectionEnforcer] FIXED: ${domain} — ${result.actions.join(', ')}`)
        } else {
          summary.errors++
          summary.actions.push(...result.actions)
        }

        // SSL mode enforcement for hosting domains — ensure 'full' mode (not 'strict')
        // ── Zone Failure Tracking: skip zones with persistent auth/SSL errors ──
        const zoneIsSkipped = await isZoneSkipped(zoneId)
        if (zoneIsSkipped) {
          if (!summary._zoneSkipLogged) summary._zoneSkipLogged = new Set()
          if (!summary._zoneSkipLogged.has(zoneId)) {
            log(`[ProtectionEnforcer] SKIP SSL/AOP: ${domain} (zone ${zoneId}) — persistent auth failures (retries in ${ZONE_FAILURE_SKIP_DAYS}d)`)
            summary._zoneSkipLogged.add(zoneId)
          }
          summary.zoneSkipped++
        } else {
          let sslFailed = false
          try {
            await enforceSSLMode(domain, zoneId)
            // SSL succeeded — no failure to record (AOP check below may still fail)
          } catch (sslErr) {
            sslFailed = true
            log(`[ProtectionEnforcer] SSL enforcement error for ${domain}: ${sslErr.message}`)
            await recordZoneFailure(zoneId, domain, `SSL: ${sslErr.message}`)
          }

          // Origin hardening: Authenticated Origin Pulls (blocks direct-IP and SNI scanning)
          try {
            const cpUser = entry.cpUser || null
            const hardenActions = await enforceOriginHardening(domain, zoneId, cpUser)
            if (hardenActions.length > 0) {
              // Check if AOP failed
              const aopFailed = hardenActions.some(a => a.includes('FAILED') || a.includes('error'))
              if (aopFailed) {
                await recordZoneFailure(zoneId, domain, `AOP: ${hardenActions.join(', ')}`)
              } else {
                // AOP succeeded — reset any failure count
                if (!sslFailed) await resetZoneFailure(zoneId)
              }
              summary.actions.push(...hardenActions)
              log(`[ProtectionEnforcer] HARDENED: ${domain} — ${hardenActions.join(', ')}`)
            } else {
              // No actions needed (already hardened) — reset failures if SSL also passed
              if (!sslFailed) await resetZoneFailure(zoneId)
            }
          } catch (hardenErr) {
            log(`[ProtectionEnforcer] Origin hardening error for ${domain}: ${hardenErr.message}`)
            await recordZoneFailure(zoneId, domain, `Harden: ${hardenErr.message}`)
          }
        }
      } else {
        // Non-hosting domain pointing to our server — just count as OK, no Workers
        summary.protected++
      }

      // Rate limit: Cloudflare API has limits
      await new Promise(r => setTimeout(r, 200))
    }
  } catch (err) {
    log(`[ProtectionEnforcer] Fatal error: ${err.message}`)
    summary.fatalError = err.message
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  log(`[ProtectionEnforcer] ═══ Enforcement complete in ${elapsed}s ═══`)
  log(`[ProtectionEnforcer] Total: ${summary.total} | Protected: ${summary.protected} | Fixed: ${summary.fixed} | No Zone: ${summary.noZone} | Errors: ${summary.errors} | DNS Cached: ${summary.dnsSkipped} | Zone Skipped: ${summary.zoneSkipped}`)
  if (summary.actions.length > 0) {
    log(`[ProtectionEnforcer] Actions: ${summary.actions.join('; ')}`)
  }

  isRunning = false
  return summary
}

// ─── Legacy Anti-Red OFF Migration ───────────────────────
// Pre-2026-02 the "Turn OFF Visitor Captcha" toggle wrote `val.antiRedOff=true`
// AND removed the CF Worker route. The new architecture keeps the Worker
// deployed and only flips a Worker-side KV bypass flag.
//
// This migration heals legacy docs:
//   1. Find docs with `val.antiRedOff=true`
//   2. Redeploy the shared Worker route (so scanner cloaking + honeypots
//      + IP bans run again — the user only opted out of the captcha page,
//      not the rest of anti-red)
//   3. Set Worker KV bypass = true so the visitor captcha page stays hidden
//      (respects the user's stated preference)
//   4. Rename `val.antiRedOff` → `val.visitorCaptchaOff` and drop the obsolete
//      `val.antiRedOffAt` timestamp
//   5. Notify owner of the corrected state
//
// Runs once at boot and then once an hour (idempotent — does nothing if no
// legacy docs remain).

async function runLegacyAntiRedOffMigration() {
  if (!db) return { processed: 0, migrated: 0, errors: 0 }
  const summary = { processed: 0, migrated: 0, errors: 0, domains: [] }
  try {
    const candidates = await db.collection('registeredDomains').find({
      'val.antiRedOff': true,
    }).toArray()

    if (candidates.length === 0) return summary
    log(`[LegacyAntiRedMigration] Found ${candidates.length} legacy antiRedOff=true doc(s) — migrating to visitorCaptchaOff...`)

    const antiRed = require('./anti-red-service')
    for (const doc of candidates) {
      summary.processed++
      const domain = doc._id
      const zoneId = doc.val?.cfZoneId

      try {
        if (zoneId) {
          // Re-deploy worker route so scanner cloaking + honeypots come back.
          // Idempotent — already-deployed routes are a no-op.
          const result = await antiRed.deploySharedWorkerRoute(domain, zoneId)
          if (!result?.success) {
            summary.errors++
            log(`[LegacyAntiRedMigration] ⚠️ ${domain}: worker redeploy failed: ${result?.error || 'unknown'}`)
            // Continue with field migration anyway — KV bypass will still hide
            // the challenge page even without the worker, and the enforcer's
            // hourly sweep will retry the deploy.
          }
          // Preserve user's "no challenge page" preference via KV bypass.
          try { await antiRed.setDomainChallengeBypass(domain, true) } catch (_) {}
        }

        await db.collection('registeredDomains').updateOne(
          { _id: domain },
          {
            $set: { 'val.visitorCaptchaOff': true },
            $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '' },
          }
        )
        summary.migrated++
        summary.domains.push(domain)
        log(`[LegacyAntiRedMigration] ✅ ${domain}: migrated (worker redeployed, captcha bypass preserved)`)

        // Best-effort notification — failure must not roll back the migration.
        try {
          const ownerChatId = doc.val?.ownerChatId
          if (ownerChatId && _bot && typeof _bot.sendMessage === 'function') {
            const userDoc = await db.collection('users').findOne({ _id: String(ownerChatId) })
            const userLang = userDoc?.lang || userDoc?.language || 'en'
            const safeLang = ['en','fr','hi','zh'].includes(userLang) ? userLang : 'en'
            const t = require(`./lang/${safeLang}`)
            const msg = t.antiRedRestoredNote
              ? t.antiRedRestoredNote(domain)
              : `🛡️ Anti-Red protection restored for ${domain}. Scanner cloaking, honeypots and IP bans are now active again. Your "Visitor Captcha OFF" preference is preserved — humans still don't see the "Verifying your browser" page.`
            await _bot.sendMessage(ownerChatId, msg, { parse_mode: 'HTML' }).catch(() => {})
          }
        } catch (notifyErr) {
          log(`[LegacyAntiRedMigration] Notify failed for ${domain}: ${notifyErr.message}`)
        }
      } catch (e) {
        summary.errors++
        log(`[LegacyAntiRedMigration] ❌ ${domain}: ${e.message}`)
      }
    }
  } catch (err) {
    log(`[LegacyAntiRedMigration] Fatal: ${err.message}`)
  }
  if (summary.processed > 0) {
    log(`[LegacyAntiRedMigration] Done — processed:${summary.processed} migrated:${summary.migrated} errors:${summary.errors}`)
  }
  return summary
}

// ─── Scheduler ───────────────────────────────────────────

function startScheduler(opts) {
  // Accept either: startScheduler() OR startScheduler({ bot }) — backwards compat
  // with the existing single-arg signature in _index.js.
  if (opts && typeof opts === 'object' && opts.bot) {
    _bot = opts.bot
  }
  if (enforceTimer) {
    clearInterval(enforceTimer)
  }

  const hours = ENFORCE_INTERVAL_MS / (60 * 60 * 1000)
  log(`[ProtectionEnforcer] Scheduler started — runs every ${hours}h`)

  // Run first enforcement after 30 seconds (let services initialize)
  setTimeout(() => {
    runEnforcement().catch(e => log(`[ProtectionEnforcer] Scheduled run error: ${e.message}`))
  }, 30000)

  // Then run periodically
  enforceTimer = setInterval(() => {
    runEnforcement().catch(e => log(`[ProtectionEnforcer] Scheduled run error: ${e.message}`))
  }, ENFORCE_INTERVAL_MS)

  // Legacy migration: run once at boot (45s after start to let CF clients warm
  // up) and once an hour after that. Idempotent — does nothing once all
  // legacy `antiRedOff=true` docs have been migrated.
  setTimeout(() => {
    runLegacyAntiRedOffMigration().catch(e => log(`[LegacyAntiRedMigration] Scheduled run error: ${e.message}`))
  }, 45000)
  setInterval(() => {
    runLegacyAntiRedOffMigration().catch(e => log(`[LegacyAntiRedMigration] Scheduled run error: ${e.message}`))
  }, 60 * 60 * 1000)
}

function stopScheduler() {
  if (enforceTimer) {
    clearInterval(enforceTimer)
    enforceTimer = null
    log('[ProtectionEnforcer] Scheduler stopped')
  }
}

// ─── Exports ─────────────────────────────────────────────

module.exports = {
  init,
  collectAllDomains,
  enforceWorkerRoutes,
  runEnforcement,
  runLegacyAntiRedOffMigration,
  startScheduler,
  stopScheduler,
  ensureOriginCert,
}
