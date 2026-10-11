/* global process */
require('dotenv').config()
const axios = require('axios')
const { log } = require('console')

const CF_BASE_URL = 'https://api.cloudflare.com/client/v4'
const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
const CF_TUNNEL_CNAME = process.env.CF_TUNNEL_CNAME || '' // e.g. "xxxx.cfargotunnel.com"

// ─── Mail relay config ──────────────────────────────────
// To prevent `mail.<domain>` A records from leaking the origin (WHM/hosting) IP,
// we never create `mail.*` A records pointing to WHM_HOST. Mail DNS is controlled by:
//   • MAIL_RELAY_HOST — external MX target (e.g. "mx.zoho.com", "mx1.brevo.com")
//   • MAIL_RELAY_PRIORITY — MX priority (default 10)
// If MAIL_RELAY_HOST is unset, NO mail/MX records are created (safest default —
// origin IP never appears in DNS; user can add their own mail DNS if needed).
const MAIL_RELAY_HOST = process.env.MAIL_RELAY_HOST || ''
const MAIL_RELAY_PRIORITY = parseInt(process.env.MAIL_RELAY_PRIORITY || '10', 10)

// Origin-leak subdomain prefixes — never create A records for these against WHM_HOST.
// `mail.` is included because cPanel used to auto-create it pointing at the server.
const LEAK_PREFIXES = ['mail', 'cpanel', 'webmail', 'webdisk', 'whm', 'autodiscover', 'autoconfig']

const cfHeaders = () => ({
  'X-Auth-Email': CF_EMAIL,
  'X-Auth-Key': CF_API_KEY,
  'Content-Type': 'application/json',
})

// ─── Cloudflare error-code classification (pure, unit-testable) ─────────
// "Record already exists" family — Cloudflare returns different codes for the
// same practical situation depending on record type. Previously only 81057 was
// handled, so a pre-existing root/www record surfaced as a hard error
// ("CF createDNSRecord error: 81053 ...", Railway prod 2026-08-06) and DNS
// setup for a domain could be left incomplete → site not resolving.
//   81053 = "An A, AAAA, or CNAME record with that host already exists"
//   81057 = "Record already exists"
//   81058 = "An A, AAAA record with that host already exists"
const CF_ALREADY_EXISTS_CODES = [81053, 81057, 81058]
// Zone is unusable by our token (different CF account or stale/invalid zone id).
const CF_OUT_OF_ACCOUNT_CODES = [10000, 9109, 7003, 1003]

const _classifyCreateError = (cfErrors = [], status) => {
  const codes = (cfErrors || []).map((e) => Number(e && e.code)).filter((n) => !Number.isNaN(n))
  const alreadyExists = codes.some((c) => CF_ALREADY_EXISTS_CODES.includes(c))
  const outOfAccount = status === 403 || codes.some((c) => CF_OUT_OF_ACCOUNT_CODES.includes(c))
  return { alreadyExists, outOfAccount, codes }
}

// A DELETE that 404s means the record is already gone → idempotent success.
const _isIdempotentDeleteStatus = (status) => status === 404

// ─── Connection ─────────────────────────────────────────

const testConnection = async () => {
  try {
    if (!CF_EMAIL || !CF_API_KEY) return { success: false, message: 'Cloudflare credentials not configured' }
    const res = await axios.get(`${CF_BASE_URL}/user`, { headers: cfHeaders(), timeout: 10000 })
    if (res.data?.success) return { success: true, email: res.data.result?.email }
    return { success: false, message: 'Cloudflare API auth failed' }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

// ─── Nameservers ────────────────────────────────────────

const getAccountNameservers = async () => {
  try {
    const res = await axios.get(`${CF_BASE_URL}/zones`, {
      headers: cfHeaders(), params: { per_page: 1 }, timeout: 10000,
    })
    if (res.data?.success && res.data.result?.length > 0) {
      const ns = res.data.result[0].name_servers
      if (ns && ns.length >= 2) return ns
    }
    return ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']
  } catch (err) {
    log('CF getAccountNameservers error:', err.message)
    return ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']
  }
}

// ─── Zone management ────────────────────────────────────

const createZone = async (domainName) => {
  try {
    const existing = await getZoneByName(domainName)
    if (existing) {
      log(`CF zone already exists for ${domainName}`)
      // Re-apply HTTPS defaults — covers the case where a previous run
      // created the zone but the post-create setting calls were skipped
      // (e.g. older code path or a partial failure). Idempotent at CF.
      await _applyHttpsDefaults(existing.id, domainName)
      return {
        success: true,
        zoneId: existing.id,
        nameservers: existing.name_servers || [],
        status: existing.status,
      }
    }

    const res = await axios.post(`${CF_BASE_URL}/zones`, {
      name: domainName, type: 'full',
    }, { headers: cfHeaders(), timeout: 30000 })

    if (res.data?.success) {
      const zone = res.data.result
      log(`CF zone created for ${domainName}`)
      // Always-on baseline for every freshly created zone:
      //   • SSL mode = flexible (visitor↔CF encrypted; CF↔origin plain
      //     — required because origin may not exist yet for standalone
      //     domain registrations).
      //   • Always Use HTTPS = on (301 redirects every http:// hit).
      //   • HSTS + Auto HTTPS Rewrites.
      // Without these defaults, http://<domain> answered 200 OK in
      // plaintext and customers reported "no SSL" because browsers
      // showed "Not Secure" in the address bar (regression observed
      // for mccoyfcuportal.com — 2026-06-01).
      await _applyHttpsDefaults(zone.id, domainName)
      return {
        success: true,
        zoneId: zone.id,
        nameservers: zone.name_servers || [],
        status: zone.status,
      }
    }

    // "already exists" error
    const errors = res.data?.errors || []
    for (const err of errors) {
      if (err.code === 1061) {
        const existing2 = await getZoneByName(domainName)
        if (existing2) {
          await _applyHttpsDefaults(existing2.id, domainName)
          return {
            success: true,
            zoneId: existing2.id,
            nameservers: existing2.name_servers || [],
            status: existing2.status,
          }
        }
      }
    }

    return { success: false, errors }
  } catch (err) {
    log('CF createZone error:', err.message)
    return { success: false, errors: [{ message: err.message }] }
  }
}

/**
 * Apply the HTTPS-baseline settings to a freshly created (or re-discovered)
 * zone: SSL mode = flexible, Always Use HTTPS = on, HSTS, Auto-Rewrites.
 *
 * Never throws — settings are non-fatal. The zone is the critical resource;
 * settings can be repaired later via the heal script.
 */
const _applyHttpsDefaults = async (zoneId, domainName) => {
  try {
    await setSSLMode(zoneId, 'flexible')
    const result = await enforceHTTPS(zoneId)
    log(`[CF] HTTPS baseline applied for ${domainName} (${zoneId}):`, result)
  } catch (e) {
    log(`[CF] HTTPS baseline non-fatal error for ${domainName} (${zoneId}): ${e.message}`)
  }
}

const getZoneByName = async (domainName) => {
  // Retry transient failures (CF was intermittently timing out at 10s and
  // returning null, which cascaded into "stale zone" worker-deploy 403s and
  // failed DNS heals). 3 attempts, higher timeout, small backoff. (2026-09)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(`${CF_BASE_URL}/zones`, {
        headers: cfHeaders(), params: { name: domainName }, timeout: 15000,
      })
      if (res.data?.success && res.data.result?.length > 0) return res.data.result[0]
      return null
    } catch (err) {
      const transient = /timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(err.message || '')
      if (attempt < 3 && transient) {
        await new Promise(r => setTimeout(r, 600 * attempt))
        continue
      }
      log(`CF getZoneByName error (${domainName}, attempt ${attempt}/3):`, err.message)
      return null
    }
  }
  return null
}

const deleteZone = async (zoneId) => {
  try {
    const res = await axios.delete(`${CF_BASE_URL}/zones/${zoneId}`, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success) return { success: true }
    return { success: false }
  } catch (err) {
    if (err.response?.status === 404) return { success: true }
    log('CF deleteZone error:', err.message)
    return { success: false }
  }
}

// ─── DNS record CRUD ────────────────────────────────────

const listDNSRecords = async (zoneId, recordType) => {
  try {
    const params = {}
    if (recordType) params.type = recordType
    const res = await axios.get(`${CF_BASE_URL}/zones/${zoneId}/dns_records`, {
      headers: cfHeaders(), params, timeout: 10000,
    })
    if (res.data?.success) return res.data.result || []
    return []
  } catch (err) {
    // ── Fix Railway-log issue #11: handle 403 gracefully (token scope missing
    //    or zone not part of account) — return [] and warn-log instead of
    //    error-log so it doesn't pollute the error stream.
    const status = err.response?.status
    const cfErr = err.response?.data?.errors?.[0]
    if (status === 403) {
      log(`[CF] listDNSRecords 403 forbidden for zone ${zoneId} (token missing Zone:DNS:Read or zone outside account) — returning empty list`)
    } else if (status === 404) {
      log(`[CF] listDNSRecords 404 zone ${zoneId} not found — returning empty list`)
    } else {
      log(`[CF] listDNSRecords error for zone ${zoneId}: ${err.message}${cfErr ? ` (${cfErr.code}: ${cfErr.message})` : ''}`)
    }
    return []
  }
}

// ─── Zone-name cache (zoneId → zone domain) ─────────────
// Used by createDNSRecord to verify that the supplied record name belongs
// to the supplied zone. Cached because zone names are immutable per zone id
// and the verification runs on every DNS write.
const _zoneNameCache = new Map()
// true = zone is in our account, false = definitively not (400/403/404), null = unknown (transient).
const zoneExistsInAccount = async (zoneId) => {
  try {
    const res = await axios.get(`${CF_BASE_URL}/zones/${zoneId}`, { headers: cfHeaders(), timeout: 10000 })
    return res.data?.success ? String(res.data.result?.name || '').toLowerCase() : null
  } catch (err) {
    const status = err.response?.status
    if ([400, 403, 404].includes(status)) return false
    return null
  }
}

const getZoneName = async (zoneId) => {
  if (_zoneNameCache.has(zoneId)) return _zoneNameCache.get(zoneId)
  try {
    const res = await axios.get(`${CF_BASE_URL}/zones/${zoneId}`, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success && res.data.result?.name) {
      const name = String(res.data.result.name).toLowerCase()
      _zoneNameCache.set(zoneId, name)
      return name
    }
  } catch (err) {
    log(`CF getZoneName(${zoneId}) error: ${err.response?.status || ''} ${err.message}`)
  }
  return null
}

const createDNSRecord = async (zoneId, recordType, name, content, ttl = 300, proxied = false, priority, extraData) => {
  try {
    const type = recordType.toUpperCase()

    // ── ZONE-NAME SANITY CHECK ──
    // Refuse if the supplied `name` doesn't belong to the supplied zone.
    // This catches the wrong-zone bug where stale `info.cfZoneId` from
    // session state caused records to be created in the wrong zone.
    // Cloudflare's API silently auto-appends the zone domain when names
    // don't match (e.g. name="hunt-verify.org" + zone=*.it produces
    // "hunt-verify.org.huntingtononlinebanking.it"). We refuse instead.
    const zoneName = await getZoneName(zoneId)
    if (zoneName && name && name !== '@') {
      const lower = String(name).toLowerCase()
      const inZone = lower === zoneName || lower.endsWith(`.${zoneName}`)
      if (!inZone) {
        const msg = `[CF createDNSRecord] ❌ REFUSING — record name "${name}" does not belong to zone "${zoneName}" (id=${zoneId}). Possible stale cfZoneId. Aborting.`
        log(msg)
        return { success: false, error: 'zone_name_mismatch', message: msg }
      }
    }

    let data = { type, name, content, ttl, proxied }
    if (type === 'MX' && priority !== undefined) data.priority = Number(priority)
    // SRV uses a structured data object in Cloudflare API
    if (type === 'SRV' && extraData) {
      data = {
        type: 'SRV',
        name,
        data: {
          service: extraData.service || '',
          proto: extraData.proto || '_tcp',
          name: extraData.srvName || name,
          priority: Number(extraData.priority || 10),
          weight: Number(extraData.weight || 100),
          port: Number(extraData.port || 0),
          target: content,
        },
        ttl,
      }
    }
    // CAA uses a structured data object in Cloudflare API
    if (type === 'CAA' && extraData) {
      data = {
        type: 'CAA',
        name,
        data: {
          flags: Number(extraData.flags || 0),
          tag: extraData.tag || 'issue',
          value: content,
        },
        ttl,
      }
    }
    const res = await axios.post(`${CF_BASE_URL}/zones/${zoneId}/dns_records`, data, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success) return { success: true, record: res.data.result }
    return { success: false, errors: res.data?.errors || [] }
  } catch (err) {
    const cfErrors = err.response?.data?.errors || []
    const status = err.response?.status
    // Classify: "record already exists" (81053/81057/81058) vs cross-account/stale zone.
    const { alreadyExists, outOfAccount } = _classifyCreateError(cfErrors, status)
    if (alreadyExists) {
      try {
        // Find the existing record and update it
        const type = recordType.toUpperCase()
        const listRes = await axios.get(`${CF_BASE_URL}/zones/${zoneId}/dns_records`, {
          headers: cfHeaders(), timeout: 10000,
          params: { type, name: name.endsWith(name) ? name : undefined },
        })
        const existing = (listRes.data?.result || []).find(r => r.type === type && r.name === name)
        if (existing) {
          const updated = await updateDNSRecord(zoneId, existing.id, type, name, content, ttl, proxied)
          if (updated.success) return { success: true, record: updated.record, updated: true }
        }
      } catch {}
      return { success: true, alreadyExists: true }
    }
    // ── CROSS-ACCOUNT / STALE-ZONE DETECTION ──
    //    403 = token has no rights on this zone (zone is in a different CF
    //          account than ours OR token's permissions don't cover it)
    //    400/404 + code 7003/1003 = zone id is no longer valid
    //    code 10000 = generic auth failure (often paired with 403)
    //    In all of these cases the bot's stored cfZoneId is unusable.
    //    Return a structured signal so the caller can:
    //      (1) clear the stale zoneId from MongoDB
    //      (2) show the user a meaningful explanation instead of "Failed".
    const codes = cfErrors.map(e => Number(e.code))
    if (outOfAccount) {
      log(`[CF createDNSRecord] cross-account / stale zoneId: zone=${zoneId} status=${status} codes=${codes.join(',')} — caller should clear cfZoneId`)
      return {
        success: false,
        out_of_account: true,
        stale_zone_id: zoneId,
        error: `zone ${zoneId.slice(0,8)} is outside this Cloudflare account`,
        errors: cfErrors,
      }
    }
    const errDetail = cfErrors.map(e => `${e.code}: ${e.message}`).join(', ') || err.message
    log(`CF createDNSRecord error: ${errDetail} (zone=${zoneId}, type=${recordType}, name=${name})`)
    return { success: false, errors: cfErrors.length ? cfErrors : [{ message: err.message }] }
  }
}

const updateDNSRecord = async (zoneId, recordId, recordType, name, content, ttl = 300, proxied = false) => {
  try {
    const data = { type: recordType.toUpperCase(), name, content, ttl, proxied }
    const res = await axios.put(`${CF_BASE_URL}/zones/${zoneId}/dns_records/${recordId}`, data, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success) return { success: true, record: res.data.result }
    return { success: false, errors: res.data?.errors || [] }
  } catch (err) {
    log('CF updateDNSRecord error:', err.message)
    return { success: false, errors: [{ message: err.message }] }
  }
}

const deleteDNSRecord = async (zoneId, recordId) => {
  try {
    const res = await axios.delete(`${CF_BASE_URL}/zones/${zoneId}/dns_records/${recordId}`, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success) return { success: true }
    return { success: false, errors: res.data?.errors || [] }
  } catch (err) {
    // 404 = record already gone → idempotent success (mirrors deleteZone).
    // Prevents the DnsHealer/cleanup loops from treating an already-deleted
    // record as a failure ("CF deleteDNSRecord error: ...404", Railway 2026-08-06).
    if (_isIdempotentDeleteStatus(err.response?.status)) {
      return { success: true, alreadyDeleted: true }
    }
    log('CF deleteDNSRecord error:', err.message)
    return { success: false, errors: [{ message: err.message }] }
  }
}

// ─── Default DNS records ────────────────────────────────

/**
 * Create default DNS records for a domain: root + www.
 *
 * ORIGIN-LEAK HARDENED: If the caller is not using Cloudflare Tunnel, this
 * function REFUSES to publish an A record pointing to the hosting origin IP.
 * The only ways root/www get published now:
 *   1. Cloudflare Tunnel CNAME (recommended — origin never touches public DNS)
 *   2. A record to a non-origin IP explicitly provided by the caller
 *
 * @param {string} zoneId
 * @param {string} domainName
 * @param {string} serverIP - may be WHM_HOST (origin) — we'll block that unless tunnel
 * @param {string} recordType - 'A' or 'CNAME'
 */
const createDefaultDNSRecords = async (zoneId, domainName, serverIP, recordType = 'A') => {
  const results = []
  const originIP = process.env.WHM_HOST || ''

  // SAFETY: If caller passes the origin IP and we have a tunnel, silently upgrade to CNAME→tunnel.
  // If caller passes the origin IP and we have NO tunnel, refuse — don't leak the origin.
  const isOriginIP = serverIP && originIP && serverIP === originIP

  if (isOriginIP && CF_TUNNEL_CNAME) {
    // Upgrade to tunnel — origin IP never enters DNS
    const rootResult = await createDNSRecord(zoneId, 'CNAME', domainName, CF_TUNNEL_CNAME, 1, true)
    results.push({ type: 'root-CNAME', ...rootResult })
    const wwwResult = await createDNSRecord(zoneId, 'CNAME', `www.${domainName}`, CF_TUNNEL_CNAME, 1, true)
    results.push({ type: 'www-CNAME', ...wwwResult })
    log(`[CF DNS] ${domainName}: Using tunnel (caller passed origin IP — upgraded to CNAME → ${CF_TUNNEL_CNAME})`)
    const allSuccess = results.every(r => r.success)
    return { success: allSuccess, results }
  }

  if (isOriginIP && !CF_TUNNEL_CNAME) {
    const msg = `[CF DNS] ❌ REFUSING to create A record for ${domainName} → ${serverIP} (origin IP leak). Set CF_TUNNEL_CNAME or pass a non-origin IP.`
    log(msg)
    return { success: false, error: 'origin_ip_leak_blocked', results: [] }
  }

  // Safe path — caller supplied a non-origin IP or CNAME target.
  const rootResult = await createDNSRecord(zoneId, recordType, domainName, serverIP, 300, true)
  results.push({ type: `root-${recordType}`, ...rootResult })

  if (recordType === 'A') {
    const wwwResult = await createDNSRecord(zoneId, 'CNAME', `www.${domainName}`, domainName, 300, true)
    results.push({ type: 'www-CNAME', ...wwwResult })
  } else if (recordType === 'CNAME') {
    const wwwResult = await createDNSRecord(zoneId, 'CNAME', `www.${domainName}`, serverIP, 300, true)
    results.push({ type: 'www-CNAME', ...wwwResult })
  }

  const allSuccess = results.every(r => r.success)
  return { success: allSuccess, results }
}

/**
 * Create hosting DNS records for a cPanel domain on Cloudflare
 *
 * ORIGIN-LEAK HARDENED — covers the root cause of the DigitalOcean abuse report:
 *   • Web (root/www): REQUIRES CF_TUNNEL_CNAME. Refuses to create A→origin otherwise.
 *   • Mail: Uses MAIL_RELAY_HOST if set. Otherwise NO mail/MX records are created
 *     (safest default — origin IP never appears in public DNS for mail either).
 *     The old behavior of `mail.<domain>` A → WHM_HOST is REMOVED because it was
 *     the primary leak vector that exposed 209.38.241.9.
 *
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domainName - Domain name
 * @param {string} serverIP - WHM server IP (only used for cross-check; not published)
 */
const createHostingDNSRecords = async (zoneId, domainName, serverIP, proxied = true) => {
  const results = []

  if (!CF_TUNNEL_CNAME) {
    const msg = `[CF Hosting] ❌ REFUSING hosting DNS for ${domainName} — CF_TUNNEL_CNAME not configured. Set env var to <tunnel-id>.cfargotunnel.com to proceed.`
    log(msg)
    return {
      success: false,
      error: 'tunnel_not_configured',
      message: 'CF_TUNNEL_CNAME is not set. Web records would leak origin IP — aborting.',
      results: [],
    }
  }

  // Web: root + www CNAME → tunnel (origin IP never published)
  results.push({ type: 'root-CNAME', ...(await createDNSRecord(zoneId, 'CNAME', domainName, CF_TUNNEL_CNAME, 1, true)) })
  results.push({ type: 'www-CNAME', ...(await createDNSRecord(zoneId, 'CNAME', `www.${domainName}`, CF_TUNNEL_CNAME, 1, true)) })
  log(`[CF Hosting] ${domainName}: Web via Cloudflare Tunnel (CNAME → ${CF_TUNNEL_CNAME})`)

  // Mail: external relay OR no records at all (NEVER publish mail.* → origin IP)
  if (MAIL_RELAY_HOST) {
    results.push({
      type: 'MX',
      ...(await createDNSRecord(zoneId, 'MX', domainName, MAIL_RELAY_HOST, 300, false, MAIL_RELAY_PRIORITY)),
    })
    log(`[CF Hosting] ${domainName}: Mail via external relay (MX → ${MAIL_RELAY_HOST} priority ${MAIL_RELAY_PRIORITY})`)
  } else {
    // BUG FIX (2026-07-08): upgrade this line from a silent INFO to a WARN that
    // fires visibly in the anomaly report + admin notify (once per 24h) so an
    // operator eventually sets MAIL_RELAY_HOST instead of every addon domain
    // shipping without email. Emit both the legacy INFO line (preserves grep
    // tooling) and a distinctive WARN prefix that stands out in Railway.
    log(`[CF Hosting] ${domainName}: Skipping mail DNS (MAIL_RELAY_HOST unset — preventing origin leak via mail.*)`)
    if (!global.__mail_relay_warn_at || (Date.now() - global.__mail_relay_warn_at) > 24 * 60 * 60 * 1000) {
      global.__mail_relay_warn_at = Date.now()
      log(`[CF Hosting] ⚠️  MAIL_RELAY_HOST is UNSET — mail (MX) DNS is NOT being provisioned for any addon/primary domain. New customers can't receive email at their domain. Set MAIL_RELAY_HOST in backend/.env (e.g. mx1.brevo.com) + MAIL_RELAY_PRIORITY (default 10).`)
      try {
        const admin = process.env.TELEGRAM_ADMIN_CHAT_ID
        const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_PROD
        if (admin && token && process.env.SKIP_WEBHOOK_SYNC !== 'true') {
          await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: admin,
            text: `⚠️ <b>MAIL_RELAY_HOST is not set</b>\nHosting domains (like ${domainName}) are being provisioned without MX records. Fix once in <code>backend/.env</code>:\n<code>MAIL_RELAY_HOST="mx1.brevo.com"</code>`,
            parse_mode: 'HTML',
          }, { timeout: 8000 })
        }
      } catch { /* best-effort */ }
    }
  }

  // NOTE: cpanel.*, webmail.*, webdisk.*, autodiscover.*, autoconfig.* A records intentionally NOT created.
  // Any such subdomain pointing at WHM_HOST would expose the origin in public DNS.
  // Users access cPanel via HostPanel (web panel proxy) which already routes through the tunnel.

  const allSuccess = results.every(r => r.success)
  const failCount = results.filter(r => !r.success).length
  if (failCount > 0) {
    log(`[CF Hosting] ${domainName}: ${results.length - failCount}/${results.length} DNS records created`)
  } else {
    log(`[CF Hosting] ${domainName}: All ${results.length} DNS records created (origin-leak-free)`)
  }
  return { success: allSuccess, results }
}

/**
 * Switch hosting DNS records (root + www) from DNS-only to proxied mode.
 * Handles both A records (legacy) and CNAME records (tunnel).
 * Called after AutoSSL has had time to issue a CA cert via HTTP-01 validation.
 */

/**
 * Set Cloudflare SSL mode for a zone to Full (Strict)
 */
const setSSLMode = async (zoneId, mode = 'flexible') => {
  try {
    const res = await axios.patch(`${CF_BASE_URL}/zones/${zoneId}/settings/ssl`, {
      value: mode,
    }, { headers: cfHeaders(), timeout: 10000 })
    return res.data?.success || false
  } catch (err) {
    log('CF setSSLMode error:', err.message)
    return false
  }
}

/**
 * Enable HTTPS enforcement for a zone:
 * - Always Use HTTPS (301 redirect HTTP -> HTTPS)
 * - HSTS (Strict-Transport-Security header)
 * - Automatic HTTPS Rewrites (fix mixed content)
 */
const enforceHTTPS = async (zoneId) => {
  const headers = cfHeaders()
  const results = {}
  try {
    // Always Use HTTPS
    const r1 = await axios.patch(`${CF_BASE_URL}/zones/${zoneId}/settings/always_use_https`,
      { value: 'on' }, { headers, timeout: 10000 })
    results.alwaysHTTPS = r1.data?.success || false

    // HSTS
    const r2 = await axios.patch(`${CF_BASE_URL}/zones/${zoneId}/settings/security_header`,
      { value: { strict_transport_security: { enabled: true, max_age: 15552000, include_subdomains: true, preload: false, nosniff: true } } },
      { headers, timeout: 10000 })
    results.hsts = r2.data?.success || false

    // Auto HTTPS Rewrites
    const r3 = await axios.patch(`${CF_BASE_URL}/zones/${zoneId}/settings/automatic_https_rewrites`,
      { value: 'on' }, { headers, timeout: 10000 })
    results.autoRewrites = r3.data?.success || false

    log(`[CF] HTTPS enforcement enabled for zone ${zoneId}:`, results)
    return results
  } catch (err) {
    log('CF enforceHTTPS error:', err.message)
    return { error: err.message }
  }
}

// ─── Firewall / Geo-blocking ────────────────────────────
//
// Migrated 2026-06-19 from the deprecated Firewall Rules API
// (/zones/{id}/firewall/rules + /zones/{id}/filters) to the
// Rulesets API for WAF Custom Rules (phase: http_request_firewall_custom).
//
// The 3 exported functions below preserve their original return contracts
// so existing callers (cpanel-routes.js Geo CRUD, anti-red-service.js
// anti-phishing cleanup, deploy-protection-all-domains.js) keep working
// without code changes outside this file.

const CF_CUSTOM_RULES_PHASE = 'http_request_firewall_custom'

/**
 * Get (or create) the zone entrypoint ruleset for the WAF Custom Rules phase.
 * Returns the ruleset object with its `rules` array, or null on hard error.
 */
const _getOrCreateCustomRulesEntrypoint = async (zoneId) => {
  try {
    const res = await axios.get(
      `${CF_BASE_URL}/zones/${zoneId}/rulesets/phases/${CF_CUSTOM_RULES_PHASE}/entrypoint`,
      { headers: cfHeaders(), timeout: 15000 }
    )
    if (res.data?.success && res.data.result) return res.data.result
  } catch (err) {
    // 404 = entrypoint doesn't exist yet → create it
    if (err.response?.status !== 404) {
      log(`CF _getOrCreateCustomRulesEntrypoint GET error: ${err.message}`)
      return null
    }
  }
  // Create empty entrypoint
  try {
    const createRes = await axios.post(
      `${CF_BASE_URL}/zones/${zoneId}/rulesets`,
      {
        name: 'HostBay WAF Custom Rules',
        description: 'Auto-managed by HostBay (geo, anti-phishing, JA3, anti-bot)',
        kind: 'zone',
        phase: CF_CUSTOM_RULES_PHASE,
        rules: [],
      },
      { headers: cfHeaders(), timeout: 15000 }
    )
    if (createRes.data?.success) return createRes.data.result
    log(`CF entrypoint create failed: ${JSON.stringify(createRes.data?.errors || [])}`)
    return null
  } catch (err) {
    log(`CF entrypoint create error: ${err.message}`)
    return null
  }
}

/**
 * Adapt a Rulesets-API rule to the legacy Firewall-Rules shape so existing
 * callers that read `r.filter.expression` and `r.paused` keep working.
 */
const _adaptRule = (r) => ({
  id: r.id,
  description: r.description || '',
  action: r.action,
  paused: r.enabled === false,
  // Legacy callers read r.filter.expression — mirror both for compatibility.
  expression: r.expression || '',
  filter: { id: r.ref || r.id, expression: r.expression || '' },
  ref: r.ref,
  enabled: r.enabled !== false,
  last_updated: r.last_updated,
  version: r.version,
})

/**
 * List all WAF Custom Rules for a zone (legacy name: listFirewallRules).
 * Returns rules in the legacy Firewall-Rules shape for backward compatibility.
 */
const listFirewallRules = async (zoneId) => {
  try {
    const ep = await _getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return []
    return (ep.rules || []).map(_adaptRule)
  } catch (err) {
    log(`CF listFirewallRules error: ${err.message}`)
    return []
  }
}

/**
 * Create a geo-blocking WAF Custom Rule.
 * @param {string} zoneId
 * @param {string[]} countryCodes - ISO 3166-1 alpha-2 (e.g. ['US','GB'])
 * @param {'block'|'allow'} mode - 'block' = block listed countries, 'allow' = whitelist-only
 * @param {string} description
 */
const createGeoRule = async (zoneId, countryCodes, mode = 'block', description = '') => {
  try {
    if (!Array.isArray(countryCodes) || countryCodes.length === 0) {
      return { success: false, errors: [{ message: 'countryCodes must be a non-empty array' }] }
    }
    // Build a single `ip.geoip.country in {"US" "GB"}` expression (preferred form).
    const codes = countryCodes.map(c => `"${String(c).toUpperCase()}"`).join(' ')
    const inExpr = `(ip.geoip.country in {${codes}})`
    // block mode: traffic from these countries is blocked
    // allow mode: traffic NOT from these countries is blocked (whitelist)
    const expression = mode === 'allow' ? `(not ${inExpr})` : inExpr
    const desc = description || `Geo-${mode}: ${countryCodes.join(', ')}`

    const ep = await _getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return { success: false, errors: [{ message: 'Could not access WAF Custom Rules ruleset' }] }

    const ruleRes = await axios.post(
      `${CF_BASE_URL}/zones/${zoneId}/rulesets/${ep.id}/rules`,
      { expression, action: 'block', description: desc, enabled: true },
      { headers: cfHeaders(), timeout: 15000 }
    )
    if (ruleRes.data?.success) {
      // Response result is the FULL updated ruleset; find the rule we just added by description.
      const added = (ruleRes.data.result?.rules || []).find(r => r.description === desc) || null
      return { success: true, rule: added ? _adaptRule(added) : null }
    }
    return { success: false, errors: ruleRes.data?.errors || [] }
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : ''
    log(`CF createGeoRule error: ${err.message}${detail ? ' :: ' + detail : ''}`)
    return { success: false, errors: [{ message: err.message }] }
  }
}

/**
 * Delete a WAF Custom Rule (legacy name: deleteFirewallRule).
 * The rule is identified by zone + rule id; we resolve the ruleset id from
 * the zone entrypoint.
 */
const deleteFirewallRule = async (zoneId, ruleId) => {
  try {
    const ep = await _getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return { success: false, errors: [{ message: 'Could not access WAF Custom Rules ruleset' }] }
    const res = await axios.delete(
      `${CF_BASE_URL}/zones/${zoneId}/rulesets/${ep.id}/rules/${ruleId}`,
      { headers: cfHeaders(), timeout: 15000 }
    )
    if (res.data?.success) return { success: true }
    return { success: false, errors: res.data?.errors || [] }
  } catch (err) {
    // 404 = rule already gone → idempotent success
    if (err.response?.status === 404) return { success: true, alreadyGone: true }
    log(`CF deleteFirewallRule error: ${err.message}`)
    return { success: false, errors: [{ message: err.message }] }
  }
}

// ─── Zone Analytics ─────────────────────────────────────

/**
 * Get visitor analytics for a zone (last N days)
 * Uses Cloudflare GraphQL Analytics API
 * Returns unique visitors, total requests, bandwidth, threats blocked
 */
const getZoneAnalytics = async (zoneId, days = 30) => {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const until = new Date().toISOString().split('T')[0]

    const query = `{
      viewer {
        zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequests1dGroups(limit: ${days + 1}, filter: {date_geq: "${since}", date_leq: "${until}"}, orderBy: [date_ASC]) {
            dimensions { date }
            sum { requests pageViews bytes threats }
            uniq { uniques }
          }
        }
      }
    }`

    const res = await axios.post(`${CF_BASE_URL}/graphql`, { query }, {
      headers: cfHeaders(),
      timeout: 15000,
    })

    const zones = res.data?.data?.viewer?.zones || []
    const groups = zones[0]?.httpRequests1dGroups || []

    if (groups.length === 0) {
      return { success: true, totals: { requests: 0, uniqueVisitors: 0, bandwidth: 0, threats: 0, pageviews: 0 }, timeseries: [], days }
    }

    let totalReq = 0, totalVisitors = 0, totalBytes = 0, totalThreats = 0, totalPV = 0
    const timeseries = groups.map(g => {
      totalReq += g.sum?.requests || 0
      totalVisitors += g.uniq?.uniques || 0
      totalBytes += g.sum?.bytes || 0
      totalThreats += g.sum?.threats || 0
      totalPV += g.sum?.pageViews || 0
      return {
        since: g.dimensions?.date,
        until: g.dimensions?.date,
        requests: g.sum?.requests || 0,
        uniqueVisitors: g.uniq?.uniques || 0,
        bandwidth: g.sum?.bytes || 0,
        threats: g.sum?.threats || 0,
        pageviews: g.sum?.pageViews || 0,
      }
    })

    return {
      success: true,
      totals: {
        requests: totalReq,
        uniqueVisitors: totalVisitors,
        bandwidth: totalBytes,
        threats: totalThreats,
        pageviews: totalPV,
      },
      timeseries,
      days,
    }
  } catch (err) {
    log('CF getZoneAnalytics error:', err.message)
    return { success: false, totals: null, timeseries: [], error: err.message }
  }
}

// Known bot/scanner user-agent fragments
const BOT_UA_FRAGMENTS = [
  'bot', 'crawl', 'spider', 'scan', 'check', 'monitor', 'feed', 'fetch',
  'curl/', 'wget/', 'python-requests', 'go-http-client', 'java/', 'perl/',
  'ruby/', 'php/', 'libwww', 'lwp-', 'nutch', 'scrapy', 'httpclient',
  'googlebot', 'bingbot', 'yandex', 'baiduspider', 'duckduckbot', 'slurp',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp', 'telegrambot',
  'applebot', 'semrush', 'ahrefs', 'mj12bot', 'dotbot', 'petalbot',
  'googlesafebrowsing', 'safebrowsing', 'phishtank', 'netcraft', 'virustotal',
  'urlscan', 'sucuri', 'norton', 'smartscreen', 'clamav', 'sophos',
  'kaspersky', 'eset', 'avast', 'bitdefender', 'fortiguard', 'comodo',
  'malwarebytes', 'palo alto', 'censys', 'shodan', 'zmeu', 'nmap', 'nikto',
  'sqlmap', 'masscan', 'zgrab', 'nuclei', 'httpx', 'binaryedge',
  'securitytrails', 'l9scan', 'l9explore', 'let\'s encrypt',
  '{user_agent}', 'siteadvisor',
]

function classifyUA(ua) {
  if (!ua || ua === '?') return 'bot'
  const lower = ua.toLowerCase()
  for (const frag of BOT_UA_FRAGMENTS) {
    if (lower.includes(frag)) return 'bot'
  }
  return 'human'
}

/**
 * Get detailed zone analytics with breakdowns by host, path, country, status, UA
 */
const getDetailedZoneAnalytics = async (zoneId, days = 7) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const until = new Date().toISOString().split('T')[0]
  // Adaptive groups have 24h max range — use last 24h for breakdowns
  const adaptiveSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const adaptiveUntil = new Date().toISOString()

  try {
    // Run queries in parallel: daily totals + adaptive groups for breakdowns
    const [dailyRes, hostRes, pathRes, uaRes] = await Promise.all([
      // 1. Daily totals with country + status breakdown
      axios.post(`${CF_BASE_URL}/graphql`, {
        query: `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequests1dGroups(limit: ${days + 1}, filter: {date_geq: "${since}", date_leq: "${until}"}, orderBy: [date_ASC]) {
            dimensions { date }
            sum { requests pageViews bytes threats
              countryMap { clientCountryName requests threats }
              responseStatusMap { edgeResponseStatus requests }
            }
            uniq { uniques }
          }
        }}}`,
      }, { headers: cfHeaders(), timeout: 20000 }),

      // 2. Per-host breakdown (last 24h)
      axios.post(`${CF_BASE_URL}/graphql`, {
        query: `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequestsAdaptiveGroups(limit: 50, filter: {datetime_geq: "${adaptiveSince}", datetime_leq: "${adaptiveUntil}"}, orderBy: [count_DESC]) {
            dimensions { clientRequestHTTPHost }
            count
          }
        }}}`,
      }, { headers: cfHeaders(), timeout: 15000 }),

      // 3. Top paths (last 24h)
      axios.post(`${CF_BASE_URL}/graphql`, {
        query: `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequestsAdaptiveGroups(limit: 30, filter: {datetime_geq: "${adaptiveSince}", datetime_leq: "${adaptiveUntil}"}, orderBy: [count_DESC]) {
            dimensions { clientRequestPath edgeResponseStatus }
            count
          }
        }}}`,
      }, { headers: cfHeaders(), timeout: 15000 }),

      // 4. Top user-agents (last 24h)
      axios.post(`${CF_BASE_URL}/graphql`, {
        query: `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) {
          httpRequestsAdaptiveGroups(limit: 50, filter: {datetime_geq: "${adaptiveSince}", datetime_leq: "${adaptiveUntil}"}, orderBy: [count_DESC]) {
            dimensions { userAgent }
            count
          }
        }}}`,
      }, { headers: cfHeaders(), timeout: 15000 }),
    ])

    // Parse daily totals
    const dailyZones = dailyRes.data?.data?.viewer?.zones || []
    const dailyGroups = dailyZones[0]?.httpRequests1dGroups || []

    let totalReq = 0, totalVisitors = 0, totalBytes = 0, totalThreats = 0, totalPV = 0
    const countryAgg = {}
    const statusAgg = {}

    const timeseries = dailyGroups.map(g => {
      totalReq += g.sum?.requests || 0
      totalVisitors += g.uniq?.uniques || 0
      totalBytes += g.sum?.bytes || 0
      totalThreats += g.sum?.threats || 0
      totalPV += g.sum?.pageViews || 0

      for (const c of (g.sum?.countryMap || [])) {
        countryAgg[c.clientCountryName] = (countryAgg[c.clientCountryName] || { requests: 0, threats: 0 })
        countryAgg[c.clientCountryName].requests += c.requests
        countryAgg[c.clientCountryName].threats += c.threats
      }
      for (const s of (g.sum?.responseStatusMap || [])) {
        statusAgg[s.edgeResponseStatus] = (statusAgg[s.edgeResponseStatus] || 0) + s.requests
      }

      return {
        date: g.dimensions?.date,
        requests: g.sum?.requests || 0,
        uniqueVisitors: g.uniq?.uniques || 0,
        bandwidth: g.sum?.bytes || 0,
        threats: g.sum?.threats || 0,
        pageviews: g.sum?.pageViews || 0,
      }
    })

    // Parse per-host breakdown
    const hostZones = hostRes.data?.data?.viewer?.zones || []
    const hostGroups = hostZones[0]?.httpRequestsAdaptiveGroups || []
    const hostMap = {}
    for (const g of hostGroups) {
      const host = g.dimensions?.clientRequestHTTPHost || 'unknown'
      hostMap[host] = (hostMap[host] || 0) + g.count
    }
    const byHost = Object.entries(hostMap)
      .map(([host, requests]) => ({ host, requests }))
      .sort((a, b) => b.requests - a.requests)

    // Parse top paths
    const pathZones = pathRes.data?.data?.viewer?.zones || []
    const pathGroups = pathZones[0]?.httpRequestsAdaptiveGroups || []
    const pathMap = {}
    for (const g of pathGroups) {
      const path = g.dimensions?.clientRequestPath || '/'
      const status = g.dimensions?.edgeResponseStatus || 0
      if (!pathMap[path]) pathMap[path] = { requests: 0, statuses: {} }
      pathMap[path].requests += g.count
      pathMap[path].statuses[status] = (pathMap[path].statuses[status] || 0) + g.count
    }
    const topPaths = Object.entries(pathMap)
      .map(([path, data]) => ({ path, requests: data.requests, statuses: data.statuses }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20)

    // Parse user-agents + classify bot/human
    const uaZones = uaRes.data?.data?.viewer?.zones || []
    const uaGroups = uaZones[0]?.httpRequestsAdaptiveGroups || []
    let botRequests = 0, humanRequests = 0
    const topUserAgents = []
    for (const g of uaGroups) {
      const ua = g.dimensions?.userAgent || ''
      const type = classifyUA(ua)
      if (type === 'bot') botRequests += g.count
      else humanRequests += g.count
      topUserAgents.push({ userAgent: ua || '(empty)', requests: g.count, type })
    }
    topUserAgents.sort((a, b) => b.requests - a.requests)

    // Country breakdown sorted
    const byCountry = Object.entries(countryAgg)
      .map(([country, data]) => ({ country, requests: data.requests, threats: data.threats }))
      .sort((a, b) => b.requests - a.requests)

    // Status code breakdown sorted
    const byStatus = Object.entries(statusAgg)
      .map(([status, requests]) => ({ status: parseInt(status), requests }))
      .sort((a, b) => b.requests - a.requests)

    return {
      success: true,
      days,
      totals: {
        requests: totalReq,
        uniqueVisitors: totalVisitors,
        bandwidth: totalBytes,
        threats: totalThreats,
        pageviews: totalPV,
      },
      trafficQuality: {
        estimatedHuman: humanRequests,
        estimatedBot: botRequests,
        botPercentage: totalReq > 0 ? Math.round((botRequests / (botRequests + humanRequests)) * 100) : 0,
      },
      timeseries,
      byHost,
      byCountry,
      byStatus,
      topPaths,
      topUserAgents: topUserAgents.slice(0, 20),
    }
  } catch (err) {
    log('CF getDetailedZoneAnalytics error:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Check if a domain's nameservers point to Cloudflare
 */
const checkZoneNSStatus = async (zoneId) => {
  try {
    const res = await axios.get(`${CF_BASE_URL}/zones/${zoneId}`, {
      headers: cfHeaders(), timeout: 10000,
    })
    if (res.data?.success) {
      const zone = res.data.result
      return {
        success: true,
        status: zone.status, // 'active', 'pending', 'moved', etc.
        nameservers: zone.name_servers || [],
        originalNameservers: zone.original_name_servers || [],
      }
    }
    return { success: false, status: 'unknown', nameservers: [] }
  } catch (err) {
    log('CF checkZoneNSStatus error:', err.message)
    return { success: false, status: 'unknown', nameservers: [] }
  }
}

// ─── Security Settings (Anti-Bot) ───────────────────────

/**
 * Get current security settings for a zone
 */
const getSecuritySettings = async (zoneId) => {
  const settings = {}
  const keys = ['security_level', 'browser_check', 'challenge_ttl', 'email_obfuscation', 'server_side_exclude', 'hotlink_protection']
  for (const key of keys) {
    try {
      const res = await axios.get(`${CF_BASE_URL}/zones/${zoneId}/settings/${key}`, { headers: cfHeaders(), timeout: 10000 })
      if (res.data?.success) settings[key] = res.data.result?.value
    } catch (_) {}
  }
  return settings
}

/**
 * Set a single zone setting
 */
const setZoneSetting = async (zoneId, setting, value) => {
  try {
    const res = await axios.patch(`${CF_BASE_URL}/zones/${zoneId}/settings/${setting}`, {
      value,
    }, { headers: cfHeaders(), timeout: 10000 })
    return res.data?.success || false
  } catch (err) {
    log(`CF setZoneSetting(${setting}) error:`, err.message)
    return false
  }
}

/**
 * Apply an anti-bot profile to a zone
 * Profiles: 'off', 'low', 'medium', 'high', 'under_attack'
 */
const setAntiBotProfile = async (zoneId, profile = 'medium') => {
  const profiles = {
    off:          { security_level: 'essentially_off', browser_check: 'off', email_obfuscation: 'off', hotlink_protection: 'off' },
    low:          { security_level: 'low',             browser_check: 'on',  email_obfuscation: 'on',  hotlink_protection: 'off' },
    medium:       { security_level: 'medium',          browser_check: 'on',  email_obfuscation: 'on',  hotlink_protection: 'on'  },
    high:         { security_level: 'high',            browser_check: 'on',  email_obfuscation: 'on',  hotlink_protection: 'on'  },
    under_attack: { security_level: 'under_attack',    browser_check: 'on',  email_obfuscation: 'on',  hotlink_protection: 'on'  },
  }
  const p = profiles[profile] || profiles.medium
  const results = {}
  for (const [key, val] of Object.entries(p)) {
    results[key] = await setZoneSetting(zoneId, key, val)
  }
  log(`[CF AntiBot] Zone ${zoneId} → profile "${profile}"`, results)
  return { success: Object.values(results).every(Boolean), results, profile }
}

/**
 * Create anti-bot WAF rule (block known bad bots by user-agent) — migrated
 * 2026-06-19 from the deprecated Firewall Rules API to the Rulesets API
 * (phase: http_request_firewall_custom). Uses the same WAF Custom Rules
 * entrypoint as the Geo migration so all auto-created rules live together.
 */
const createAntiBotRules = async (zoneId) => {
  // Consolidated into ONE rule. Previously this created 3 separate firewall
  // rules which pushed some zones over Cloudflare's free-plan 5-custom-rule
  // cap → 403 (seen ~9×/24h in prod logs 2026-06-10). A single combined
  // user-agent expression covers all crawlers in one rule slot.
  const botUAs = [
    // Search engine crawlers
    'Googlebot', 'bingbot', 'Baiduspider', 'YandexBot', 'DuckDuckBot', 'Slurp', 'facebot', 'ia_archiver',
    // SEO / marketing bots
    'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'linkfluence', 'BLEXBot', 'Screaming Frog',
    // AI / misc bots
    'serpstatbot', 'Bytespider', 'GPTBot', 'CCBot', 'DataForSeoBot', 'Applebot',
  ]
  const expression = '(' + botUAs.map(b => `http.user_agent contains "${b}"`).join(' or ') + ')'
  const DESC = 'Anti-Bot: Block known bad crawlers'

  try {
    const ep = await _getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return { success: false, error: 'Could not access WAF Custom Rules ruleset' }

    // De-dupe via the entrypoint's own rules array (replaces the deprecated
    // GET /firewall/rules duplicate check that was silently failing).
    const existing = (ep.rules || []).filter(r => r.description?.includes('Anti-Bot'))
    if (existing.length >= 1) {
      return { success: true, message: 'Anti-Bot rule already exists', existing: true, ruleCount: existing.length }
    }

    const ruleRes = await axios.post(
      `${CF_BASE_URL}/zones/${zoneId}/rulesets/${ep.id}/rules`,
      { expression, action: 'block', description: DESC, enabled: true },
      { headers: cfHeaders(), timeout: 15000 }
    )
    return { success: ruleRes.data?.success || false }
  } catch (err) {
    if (err.response?.data?.errors?.some(e => e.message?.includes('already exists'))) {
      return { success: true, existing: true }
    }
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : ''
    log('CF createAntiBotRules error: ' + err.message + (detail ? ' :: ' + detail : ''))
    return { success: false, error: err.message, detail }
  }
}

// ─── DNS Cleanup for Domain Transition ────────────────────

/**
 * Remove conflicting A/AAAA/CNAME records for root and www before creating hosting records.
 * Essential when transitioning a domain from shortener (CNAME→Railway) to hosting (A→WHM).
 * Cloudflare doesn't allow both CNAME and A records for the same name.
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domainName - Domain name (e.g. "example.com")
 * @returns {{ success, deleted[] }}
 */
const cleanupConflictingDNS = async (zoneId, domainName) => {
  const deleted = []
  try {
    const records = await listDNSRecords(zoneId)
    const conflicting = records.filter(r => {
      const isRootOrWww = r.name === domainName || r.name === `www.${domainName}`
      const isConflictType = ['A', 'AAAA', 'CNAME'].includes(r.type)
      if (isRootOrWww && isConflictType) return true
      // Shortener leftover: Railway's custom-domain verification TXT must be
      // removed when transitioning from shortener → hosting, otherwise the
      // domain stays linked at Railway's edge.
      if (r.type === 'TXT' && r.name === `_railway-verify.${domainName}`) return true
      return false
    })

    for (const record of conflicting) {
      const result = await deleteDNSRecord(zoneId, record.id)
      if (result.success) {
        deleted.push({ type: record.type, name: record.name, content: record.content })
        log(`[CF] Cleaned up conflicting ${record.type} ${record.name} → ${record.content}`)
      }
    }

    return { success: true, deleted }
  } catch (err) {
    log(`[CF] cleanupConflictingDNS error: ${err.message}`)
    return { success: false, deleted, error: err.message }
  }
}

/**
 * Remove ALL hosting-related DNS records for a domain.
 * Used when a domain is fully removed from hosting (not just before re-creation).
 * Removes: root, www, mail, cpanel, webmail, webdisk + MX records.
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domainName - Domain name (e.g. "example.com")
 * @returns {{ success, deleted[] }}
 */
const cleanupAllHostingRecords = async (zoneId, domainName) => {
  const deleted = []
  try {
    const records = await listDNSRecords(zoneId)
    const hostingNames = [
      domainName,
      `www.${domainName}`,
      `mail.${domainName}`,
      `cpanel.${domainName}`,
      `webmail.${domainName}`,
      `webdisk.${domainName}`,
    ]
    const hostingRecords = records.filter(r => {
      // Match hosting names (A, AAAA, CNAME records) + MX records for the root domain
      if (hostingNames.includes(r.name) && ['A', 'AAAA', 'CNAME'].includes(r.type)) return true
      if (r.name === domainName && r.type === 'MX') return true
      return false
    })

    for (const record of hostingRecords) {
      const result = await deleteDNSRecord(zoneId, record.id)
      if (result.success) {
        deleted.push({ type: record.type, name: record.name, content: record.content })
        log(`[CF] Removed hosting record: ${record.type} ${record.name} → ${record.content}`)
      }
    }

    log(`[CF] cleanupAllHostingRecords: ${deleted.length} records removed for ${domainName}`)
    return { success: true, deleted }
  } catch (err) {
    log(`[CF] cleanupAllHostingRecords error: ${err.message}`)
    return { success: false, deleted, error: err.message }
  }
}

/**
 * Set the proxied (orange/gray cloud) state for a DNS record.
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domainName - Full record name (e.g. "example.com" or "www.example.com")
 * @param {boolean} proxied - true = orange cloud, false = gray cloud
 * @param {string} [recordType] - Record type filter (A, AAAA, CNAME), defaults to any
 * @returns {{ success, updated[] }}
 */
const setProxiedState = async (zoneId, domainName, proxied, recordType) => {
  const updated = []
  try {
    const records = await listDNSRecords(zoneId)
    const matching = records.filter(r => {
      const nameMatch = r.name === domainName
      const typeMatch = recordType ? r.type === recordType.toUpperCase() : ['A', 'AAAA', 'CNAME'].includes(r.type)
      return nameMatch && typeMatch && r.proxied !== proxied
    })

    for (const record of matching) {
      const result = await updateDNSRecord(zoneId, record.id, record.type, record.name, record.content, record.ttl || 1, proxied)
      if (result.success) {
        updated.push({ type: record.type, name: record.name, proxied })
        log(`[CF] Set ${record.name} (${record.type}) proxied=${proxied}`)
      }
    }

    return { success: true, updated }
  } catch (err) {
    log(`[CF] setProxiedState error: ${err.message}`)
    return { success: false, updated, error: err.message }
  }
}

// ─── Origin Hardening ────────────────────────────────────

/**
 * Enable Authenticated Origin Pulls on a Cloudflare zone.
 * When enabled, Cloudflare presents a client certificate when connecting to the origin.
 * The origin can be configured to reject any request without this certificate,
 * effectively blocking direct-IP access and SNI-based scanning.
 *
 * CF API: PUT /zones/{zone_id}/origin_tls_client_auth/settings
 */
const enableAuthenticatedOriginPulls = async (zoneId) => {
  try {
    const res = await axios.put(
      `${CF_BASE_URL}/zones/${zoneId}/origin_tls_client_auth/settings`,
      { enabled: true },
      { headers: cfHeaders(), timeout: 10000 }
    )
    if (res.data?.result?.enabled) {
      log(`[CF] Authenticated Origin Pulls ENABLED for zone ${zoneId}`)
      return { success: true, enabled: true }
    }
    log(`[CF] Authenticated Origin Pulls response for ${zoneId}: ${JSON.stringify(res.data)}`)
    return { success: true, enabled: res.data?.result?.enabled ?? false }
  } catch (err) {
    log(`[CF] enableAuthenticatedOriginPulls error for ${zoneId}: ${err.response?.data?.errors?.[0]?.message || err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Check if Authenticated Origin Pulls is enabled on a zone.
 */
const getAuthenticatedOriginPullsStatus = async (zoneId) => {
  try {
    const res = await axios.get(
      `${CF_BASE_URL}/zones/${zoneId}/origin_tls_client_auth/settings`,
      { headers: cfHeaders(), timeout: 10000 }
    )
    return { success: true, enabled: res.data?.result?.enabled ?? false }
  } catch (err) {
    return { success: false, enabled: false, error: err.message }
  }
}

/**
 * Generate a Cloudflare Origin CA certificate.
 * These certificates are ONLY valid between Cloudflare edge and the origin server.
 * They are NOT logged in Certificate Transparency (CT) logs, preventing
 * scanners from discovering the origin IP through CT monitoring.
 *
 * CF API: POST /certificates
 * Auth: Uses the same API key (Global API Key has Origin CA permissions)
 *
 * @param {string[]} hostnames — e.g. ['example.com', '*.example.com']
 * @param {number} validityDays — 7, 30, 90, 365, 730, 1095, or 5475 (15 years)
 * @returns {{ success, certificate, privateKey, expiresOn, id }}
 */
const generateOriginCACert = async (hostnames, validityDays = 5475) => {
  try {
    // ── Fix Railway-log issue #10: pre-flight zone-membership check ─────────
    //    Cloudflare's Origin CA API rejects hostnames whose APEX zone is not
    //    part of the authenticated account with:
    //      "zone-name <foo.com> is not part of your account"
    //    Previously we caught the error only AFTER calling the API, polluting
    //    the error stream. Now we check each hostname's zone exists in our
    //    account first; if any is missing we abort with a clean warning.
    // ───────────────────────────────────────────────────────────────────────
    const apexOf = (h) => {
      const clean = String(h || '').replace(/^\*\./, '').toLowerCase()
      const parts = clean.split('.')
      // naive apex: take last 2 labels (works for .com/.net/.org/etc.). For
      // ccTLDs like .co.uk a real PSL would be needed but those are rare in
      // our customer base; the API call will still surface those edge cases.
      return parts.length <= 2 ? clean : parts.slice(-2).join('.')
    }
    const checkedApex = new Set()
    for (const h of hostnames) {
      const apex = apexOf(h)
      if (checkedApex.has(apex)) continue
      checkedApex.add(apex)
      const zone = await getZoneByName(apex)
      if (!zone) {
        const errMsg = `zone-name "${apex}" not in Cloudflare account — cannot issue Origin CA cert`
        log(`[CF] generateOriginCACert skipped (pre-flight) for ${hostnames.join(', ')}: ${errMsg}`)
        return { success: false, error: errMsg, code: 'ZONE_NOT_IN_ACCOUNT', apex }
      }
    }

    // 1. Generate RSA private key and CSR using Node's crypto/forge
    const { execSync } = require('child_process')
    const os = require('os')
    const fs = require('fs')
    const path = require('path')
    const tmpDir = os.tmpdir()
    const keyFile = path.join(tmpDir, `origin-ca-${Date.now()}.key`)
    const csrFile = path.join(tmpDir, `origin-ca-${Date.now()}.csr`)

    // Generate RSA 2048 key + CSR with openssl (available on all Linux systems)
    const primaryHostname = hostnames[0]
    const sanEntries = hostnames.map(h => `DNS:${h}`).join(',')

    // Create a temporary openssl config for SAN support
    const opensslConf = path.join(tmpDir, `origin-ca-${Date.now()}.cnf`)
    const confContent = [
      '[req]',
      'distinguished_name = req_distinguished_name',
      'req_extensions = v3_req',
      'prompt = no',
      '[req_distinguished_name]',
      `CN = ${primaryHostname}`,
      '[v3_req]',
      `subjectAltName = ${sanEntries}`,
    ].join('\n')
    fs.writeFileSync(opensslConf, confContent)

    execSync(`openssl genrsa -out "${keyFile}" 2048 2>/dev/null`)
    execSync(`openssl req -new -key "${keyFile}" -out "${csrFile}" -config "${opensslConf}" 2>/dev/null`)

    const privateKey = fs.readFileSync(keyFile, 'utf8')
    const csr = fs.readFileSync(csrFile, 'utf8')

    // Cleanup temp files
    try { fs.unlinkSync(keyFile) } catch (_) {}
    try { fs.unlinkSync(csrFile) } catch (_) {}
    try { fs.unlinkSync(opensslConf) } catch (_) {}

    // 2. Submit CSR to Cloudflare Origin CA API
    // Note: Cloudflare's Origin CA endpoint has stricter auth than the rest
    // of the API. Some accounts (especially older ones or multi-user orgs)
    // require the "X-Auth-User-Service-Key" (Origin CA Key from the CF
    // dashboard → API Tokens → "Origin CA Key") instead of the Global API Key.
    // Symptom without it: API replies "zone-name X is not part of your account"
    // even for zones the same key just created — because CF checks a different
    // account graph for origin certs.
    // See 2026-07-08 chatId 8011229362 incident: every new addon domain got
    // logged as [CF] generateOriginCACert skipped (post-flight) ... not part
    // of your account. Fix: prefer the User Service Key when configured.
    const originHeaders = process.env.CLOUDFLARE_ORIGIN_CA_KEY
      ? {
          'X-Auth-User-Service-Key': process.env.CLOUDFLARE_ORIGIN_CA_KEY,
          'Content-Type': 'application/json',
        }
      : cfHeaders()
    const res = await axios.post(`${CF_BASE_URL}/certificates`, {
      csr,
      hostnames,
      requested_validity: validityDays,
      request_type: 'origin-rsa',
    }, { headers: originHeaders, timeout: 30000 })

    if (res.data?.success && res.data.result) {
      const cert = res.data.result
      log(`[CF] Origin CA cert generated for ${hostnames.join(', ')} (expires: ${cert.expires_on})`)
      return {
        success: true,
        certificate: cert.certificate,
        privateKey, // Return the private key we generated (CF doesn't return it when CSR is provided)
        expiresOn: cert.expires_on,
        id: cert.id,
        hostnames: cert.hostnames,
      }
    }

    const errMsg = res.data?.errors?.[0]?.message || 'Unknown error'
    log(`[CF] Origin CA cert generation failed for ${hostnames.join(', ')}: ${errMsg}`)
    return { success: false, error: errMsg }
  } catch (err) {
    const errMsg = err.response?.data?.errors?.[0]?.message || err.message
    // Fix #10 (defensive): if the API still tells us the zone isn't ours
    // (e.g. apex was a multi-label TLD we couldn't detect), warn-log + return
    // a structured no-success result instead of an ERROR-level log.
    if (/not part of your account/i.test(errMsg) || /zone-name/i.test(errMsg)) {
      // Fire a one-shot actionable warning (throttled globally so we don't spam).
      const now = Date.now()
      if (!global.__cf_origin_ca_warn_at || (now - global.__cf_origin_ca_warn_at) > 6 * 60 * 60 * 1000) {
        global.__cf_origin_ca_warn_at = now
        log(`[CF] ⚠️  ORIGIN CA API REJECTED (${errMsg}). ` +
            `Every new addon domain will ship WITHOUT an origin CA cert (weaker CF↔origin TLS). ` +
            `Fix: set CLOUDFLARE_ORIGIN_CA_KEY env var to your account's Origin CA Key ` +
            `(Cloudflare dashboard → My Profile → API Tokens → API Keys → Origin CA Key → View).`)
      } else {
        log(`[CF] generateOriginCACert skipped (post-flight) for ${hostnames.join(', ')}: ${errMsg}`)
      }
      return { success: false, error: errMsg, code: 'ZONE_NOT_IN_ACCOUNT' }
    }
    log(`[CF] generateOriginCACert error: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * List existing Origin CA certificates for given hostnames.
 * Used to check if a cert already exists before generating a new one.
 */

/**
 * Migrate a domain from A-record (direct IP) to CNAME (Cloudflare Tunnel).
 * Deletes existing root + www A records and replaces with CNAME → tunnel.
 * Also PURGES all origin-leaking subdomains (mail, cpanel, webmail, webdisk,
 * autodiscover, autoconfig) whose A records point at the origin — these are the
 * records that typically expose WHM_HOST in public DNS / abuse reports.
 * Only works when CF_TUNNEL_CNAME is configured.
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domainName - Domain name to migrate
 * @param {string} serverIP - WHM server IP (to identify which A records to replace)
 * @returns {{ success, migrated[], skipped[], errors[], leaksPurged[] }}
 */
const migrateToTunnel = async (zoneId, domainName, serverIP) => {
  if (!CF_TUNNEL_CNAME) return { success: false, error: 'CF_TUNNEL_CNAME not configured' }

  const migrated = [], skipped = [], errors = [], leaksPurged = []
  try {
    const records = await listDNSRecords(zoneId)
    const webNames = [domainName, `www.${domainName}`]

    for (const name of webNames) {
      // Find existing A record for this name
      const aRecord = records.find(r => r.type === 'A' && r.name === name && r.content === serverIP)
      // Check if CNAME already exists (already migrated)
      const cnameRecord = records.find(r => r.type === 'CNAME' && r.name === name)

      if (cnameRecord && cnameRecord.content === CF_TUNNEL_CNAME) {
        skipped.push({ name, reason: 'already_tunnel_cname' })
        continue
      }

      // Delete existing A record (CF doesn't allow A + CNAME for same name)
      if (aRecord) {
        const del = await deleteDNSRecord(zoneId, aRecord.id)
        if (!del.success) {
          errors.push({ name, action: 'delete_a', error: del.error || 'delete failed' })
          continue
        }
        log(`[CF Tunnel] Deleted A record: ${name} → ${serverIP}`)
      }

      // Delete existing CNAME if it points elsewhere
      if (cnameRecord && cnameRecord.content !== CF_TUNNEL_CNAME) {
        await deleteDNSRecord(zoneId, cnameRecord.id)
        log(`[CF Tunnel] Deleted old CNAME: ${name} → ${cnameRecord.content}`)
      }

      // Create CNAME → tunnel
      const created = await createDNSRecord(zoneId, 'CNAME', name, CF_TUNNEL_CNAME, 1, true)
      if (created.success) {
        migrated.push({ name, from: aRecord ? `A:${serverIP}` : 'new', to: `CNAME:${CF_TUNNEL_CNAME}` })
        log(`[CF Tunnel] Migrated: ${name} → CNAME ${CF_TUNNEL_CNAME} (proxied)`)
      } else {
        errors.push({ name, action: 'create_cname', error: created.errors || 'create failed' })
      }
    }

    // ── PURGE origin-leaking subdomain A records ──
    // These are the records that actually exposed 209.38.241.9 in the DigitalOcean abuse report:
    // anything like `mail.<domain>`, `cpanel.<domain>`, `webmail.<domain>` pointing at WHM_HOST.
    for (const rec of records) {
      if (rec.type !== 'A' || rec.content !== serverIP) continue
      const prefix = rec.name.split('.')[0].toLowerCase()
      if (!LEAK_PREFIXES.includes(prefix)) continue
      // Don't touch root / www — those are handled above
      if (rec.name === domainName || rec.name === `www.${domainName}`) continue
      const del = await deleteDNSRecord(zoneId, rec.id)
      if (del.success) {
        leaksPurged.push({ name: rec.name, type: 'A', content: rec.content })
        log(`[CF Tunnel] Purged origin-leak A record: ${rec.name} → ${rec.content}`)
      } else {
        errors.push({ name: rec.name, action: 'purge_leak', error: del.error || 'delete failed' })
      }
    }

    // ── Also purge MX records that resolve into the origin ──
    // If an MX points to mail.<domain> which was an A to origin, removing the A already
    // strips the leak. We also remove the MX so prod doesn't keep trying to deliver mail
    // to a now-nonexistent hostname. If MAIL_RELAY_HOST is set, add a clean MX.
    const mxHostname = `mail.${domainName}`
    const leakyMx = records.find(r => r.type === 'MX' && (r.content === mxHostname || r.content === serverIP))
    if (leakyMx) {
      const del = await deleteDNSRecord(zoneId, leakyMx.id)
      if (del.success) {
        leaksPurged.push({ name: leakyMx.name, type: 'MX', content: leakyMx.content })
        log(`[CF Tunnel] Purged leaky MX: ${leakyMx.name} → ${leakyMx.content}`)
      }
    }
    if (MAIL_RELAY_HOST) {
      const alreadyHasRelay = records.find(r => r.type === 'MX' && r.content === MAIL_RELAY_HOST)
      if (!alreadyHasRelay) {
        const created = await createDNSRecord(zoneId, 'MX', domainName, MAIL_RELAY_HOST, 300, false, MAIL_RELAY_PRIORITY)
        if (created.success) {
          migrated.push({ name: domainName, type: 'MX', to: MAIL_RELAY_HOST })
          log(`[CF Tunnel] Added clean MX: ${domainName} → ${MAIL_RELAY_HOST} (priority ${MAIL_RELAY_PRIORITY})`)
        }
      }
    }

    return { success: errors.length === 0, migrated, skipped, errors, leaksPurged }
  } catch (err) {
    return { success: false, migrated, skipped, errors: [{ message: err.message }], leaksPurged }
  }
}

// Accurate per-day visitor counts for a zone over an explicit date range.
// Uses the httpRequests1dGroups dataset (NOT sampled — unlike the adaptive datasets),
// so uniq.uniques is an accurate daily visitor count. `since`/`until` are 'YYYY-MM-DD'.
// Cloudflare only retains a limited window; days older than retention are simply absent
// from the result (no error), which is why js/hosting-visits.js snapshots daily rows so
// lifetime totals survive beyond Cloudflare's window.
const getZoneVisitsRange = async (zoneId, sinceDate, untilDate) => {
  try {
    const since = String(sinceDate).split('T')[0]
    const until = String(untilDate).split('T')[0]
    const dayMs = 86400000
    const span = Math.round((new Date(until) - new Date(since)) / dayMs) + 2
    const limit = Math.min(366, Math.max(1, span))
    const query = `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) {
      httpRequests1dGroups(limit: ${limit}, filter: {date_geq: "${since}", date_leq: "${until}"}, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests pageViews }
        uniq { uniques }
      }
    }}}`
    const res = await axios.post(`${CF_BASE_URL}/graphql`, { query }, { headers: cfHeaders(), timeout: 20000 })
    const errors = res.data?.errors
    if (errors && errors.length) return { success: false, error: errors[0]?.message || 'graphql_error', days: [] }
    const groups = res.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || []
    const days = groups
      .filter(g => g.dimensions?.date)
      .map(g => ({ date: g.dimensions.date, uniques: g.uniq?.uniques || 0, pageViews: g.sum?.pageViews || 0, requests: g.sum?.requests || 0 }))
    return { success: true, days }
  } catch (err) {
    log('CF getZoneVisitsRange error:', err.response?.data?.errors?.[0]?.message || err.message)
    return { success: false, error: err.message, days: [] }
  }
}

module.exports = {
  testConnection,
  getAccountNameservers,
  createZone,
  getZoneByName,
  zoneExistsInAccount,
  listDNSRecords,
  createDNSRecord,
  updateDNSRecord,
  deleteDNSRecord,
  deleteZone,
  createDefaultDNSRecords,
  createHostingDNSRecords,
  
  cleanupConflictingDNS,
  cleanupAllHostingRecords,
  setSSLMode,
  enforceHTTPS,
  setProxiedState,
  listFirewallRules,
  createGeoRule,
  deleteFirewallRule,
  // Public alias of _getOrCreateCustomRulesEntrypoint — used by anti-red-service.js
  // to mint additional WAF Custom Rules (JA3, anti-phishing) on the same
  // zone entrypoint as the geo / anti-bot rules created here.
  getOrCreateCustomRulesEntrypoint: _getOrCreateCustomRulesEntrypoint,
  CF_CUSTOM_RULES_PHASE,
  getZoneAnalytics,
  getZoneVisitsRange,
  getDetailedZoneAnalytics,
  checkZoneNSStatus,
  // Anti-Bot
  getSecuritySettings,
  setZoneSetting,
  setAntiBotProfile,
  createAntiBotRules,
  // Origin Hardening
  enableAuthenticatedOriginPulls,
  getAuthenticatedOriginPullsStatus,
  generateOriginCACert,
  
  // Tunnel
  migrateToTunnel,
  CF_TUNNEL_CNAME,
  // Pure helpers (exported for unit tests + /admin/dns-fix-selftest)
  _classifyCreateError,
  _isIdempotentDeleteStatus,
  CF_ALREADY_EXISTS_CODES,
  CF_OUT_OF_ACCOUNT_CODES,
}
