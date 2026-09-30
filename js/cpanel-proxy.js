/* global process */
/**
 * cPanel UAPI Proxy Service
 * Proxies requests to cPanel UAPI, hiding the server IP from the frontend.
 * All responses are sanitized to remove server IP references.
 *
 * Supports per-account WHM host override — accounts created on different
 * servers use their stored whmHost instead of the global WHM_HOST.
 */

const axios = require('axios')
const https = require('https')
const { log } = require('console')
const FormData = require('form-data')

const WHM_HOST = process.env.WHM_HOST
const CPANEL_PORT = 2083
// ── Tunnel routing (origin-IP-hidden) ──
// When CPANEL_API_URL is set, every cPanel UAPI call is routed through that
// URL instead of `https://<WHM_HOST>:2083`. Used to route through Cloudflare
// Tunnel so the origin IP and ports 2083/2087 can stay locked down.
// Example value: "https://cpanel-api.hostbay.io"
const CPANEL_API_URL = (process.env.CPANEL_API_URL || '').replace(/\/+$/, '')

// Cloudflare Access service token (Zero Trust). When set, every request to
// the tunneled cPanel hostname carries CF-Access-Client-Id/Secret headers so
// the public-facing tunnel hostname is auth-locked to the bot.
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || ''
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || ''
const _accessHeaders = (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET }
  : {}
function _maybeAccessHeaders(url) {
  return CPANEL_API_URL && url && url.startsWith(CPANEL_API_URL) ? _accessHeaders : {}
}

// Accept self-signed certs on WHM
const httpsAgent = new https.Agent({ rejectUnauthorized: false })

// ─── Connection-level error detection ───────────────────
// When axios fails because the cPanel control plane is down (host refusing
// connections, license invalid → cpsrvd not running, network drop), the user
// should NEVER see raw "ECONNREFUSED" or server IPs. We tag the response with
// code: 'CPANEL_DOWN' so callers can switch to friendly UX + queue the action.
//
// We also treat Cloudflare-tunnel-origin errors as "down": when the CF tunnel
// serving `cpanel-api.hostbay.io` / `whm-api.hostbay.io` has no active
// connector, Cloudflare returns an HTTP 530 with body "error code: 1033" (or
// 520-527 for other origin failures). Prior to this fix, isControlPlaneDown()
// short-circuited on any HTTP response and let the raw 530 bubble up as a
// generic 503 in the panel UI, so admins were never paged and users saw no
// friendly message. See @ciroovblzz 2026-07-01 22:48 incident — the tunnel
// died at 22:48 and stayed down 2+ hours before we caught it in Railway logs.

const WHM_CONNECT_ERR_RX = /ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|connect ETIMEDOUT|connect ECONN/i

// Cloudflare-specific status codes returned when the ORIGIN (not the edge) is
// the problem. See https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/
//   520 — Web server returned an unknown error
//   521 — Web server is down
//   522 — Connection timed out (to origin)
//   523 — Origin is unreachable
//   524 — A timeout occurred
//   525 — SSL handshake failed
//   526 — Invalid SSL certificate
//   527 — Railgun error (deprecated)
//   530 — Argo Tunnel: origin unreachable / no active tunnel connector (1033)
const CF_ORIGIN_DOWN_STATUSES = new Set([520, 521, 522, 523, 524, 525, 526, 527, 530])

// CF-tunnel-specific error codes embedded in the response body (Cloudflare
// returns "error code: 1033" etc. as plain text or in HTML for tunnel failures).
const CF_TUNNEL_ERR_BODY_RX = /error code:\s*10(33|34|35|36)/i

function isControlPlaneDown(err) {
  if (!err) return false
  if (err.code && WHM_CONNECT_ERR_RX.test(err.code)) return true
  if (err.message && WHM_CONNECT_ERR_RX.test(err.message)) return true
  // Cloudflare edge returned an HTTP status telling us the origin is down.
  if (err.response) {
    const status = err.response.status
    if (CF_ORIGIN_DOWN_STATUSES.has(status)) {
      // Sanity check: CF error bodies are tiny plain-text or HTML pages, never
      // the JSON envelope a healthy cPanel/WHM would send. If the response
      // deserialized to an object with an `errors` array (cPanel's standard
      // shape), the origin IS up and just returned an in-band error — leave
      // that alone. Only treat as tunnel-down when the body is a raw CF page.
      const body = err.response.data
      const looksLikeCfPage = typeof body === 'string'
        ? (CF_TUNNEL_ERR_BODY_RX.test(body) || /cloudflare/i.test(body) || body.length < 4096)
        : true // non-string body from a 520-530 = certainly not cPanel JSON
      if (looksLikeCfPage) return true
    }
    return false // any other HTTP response — origin control plane is up
  }
  return false
}

// Throttled admin alert — first downward transition + a reminder every 15min.
let _lastDownAlertAt = 0
const DOWN_ALERT_THROTTLE_MS = 15 * 60 * 1000
let _adminNotifier = null
function setAdminNotifier(fn) { if (typeof fn === 'function') _adminNotifier = fn }
function _adminAlertDown(reason, host) {
  const now = Date.now()
  if (now - _lastDownAlertAt < DOWN_ALERT_THROTTLE_MS) return
  // Defensive: never page the admin for an obviously-fake hostname.
  // Test fixtures historically used "test" / "test.host" — those rows can
  // end up in the DB via the captcha seed script and would otherwise spam
  // the admin chat with ENOTFOUND every time someone touches them.
  const h = String(host || '').toLowerCase()
  if (!h || h === 'test' || h === 'test.host' || h === 'localhost' || h === '127.0.0.1') return
  _lastDownAlertAt = now
  if (!_adminNotifier) return
  try {
    _adminNotifier(
      `🚨 <b>cPanel control plane unreachable</b>\n` +
      `Host: <code>${host || WHM_HOST}</code>\n` +
      `Reason: <code>${reason}</code>\n` +
      `<i>New users continue to check out (provisioning is queued). Existing-user mutations are queued. Check /hostingstatus.</i>`
    )
  } catch (e) { log(`[cPanel Proxy] admin alert error: ${e.message}`) }
}

// ─── EPERM (broken account homedir/quota) — UX + ops alerting ───────────
//
// `"/usr/local/cpanel/uapi" exited with status 1 (EPERM)` means the account's
// home directory / quota accounting is broken at the OS level. BOTH the
// user-level UAPI call AND the WHM root-as-user fallback (which also runs in
// the user context) fail until ops repairs it on the box. Before this, the
// File Manager surfaced a raw "Create folder failed: 500 …EPERM" and NEVER
// paged ops — so @hellpeaces (5522767823) had a broken panel for ~2 weeks
// (2026-07-03 → 2026-07-21) and had to escalate manually 4 times. Now the
// user sees a calm message and ops gets an actionable page with the exact
// remediation so the account is repaired in minutes, not weeks.
const EPERM_USER_MESSAGES = {
  en: 'A temporary permission issue on your hosting account is blocking file changes right now. Our team has been alerted and is repairing it — your files and data are safe. Please try again shortly.',
  fr: "Un problème d'autorisation temporaire sur votre compte d'hébergement empêche actuellement les modifications de fichiers. Notre équipe a été alertée et procède à la réparation — vos fichiers et données sont en sécurité. Veuillez réessayer sous peu.",
  zh: '您的主机账户目前存在临时权限问题，暂时无法更改文件。我们的团队已收到提醒并正在修复 — 您的文件和数据是安全的。请稍后再试。',
  hi: 'आपके होस्टिंग खाते में एक अस्थायी अनुमति समस्या के कारण अभी फ़ाइल परिवर्तन अवरुद्ध हैं। हमारी टीम को सूचित कर दिया गया है और वह इसे ठीक कर रही है — आपकी फ़ाइलें और डेटा सुरक्षित हैं। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
}
function getEpermLocalizedMessages() {
  return { ...EPERM_USER_MESSAGES }
}
function getEpermUserMessage(lang) {
  return EPERM_USER_MESSAGES[lang] || EPERM_USER_MESSAGES.en
}

// Build the admin/ops page for a broken-homedir EPERM. Carries the exact
// root-shell remediation so whoever is on-call can repair immediately.
function buildEpermOpsAlert({ op = 'file operation', cpUser, domain, whmHost } = {}) {
  const host = whmHost || WHM_HOST
  return (
    `🛠️ <b>cPanel account needs repair (EPERM)</b>\n` +
    `A user's File Manager <b>${op}</b> failed with ` +
    `<code>uapi exited status 1 (EPERM)</code> — a broken home directory / quota on the server. ` +
    `The panel's user-level call AND the WHM root fallback both fail until this is repaired.\n\n` +
    `Account: <code>${cpUser || 'unknown'}</code>${domain ? ` (${domain})` : ''}\n` +
    `Server: <code>${host || 'unknown'}</code>\n\n` +
    `<b>Fix — run as root on the WHM box:</b>\n` +
    `<code>/scripts/fixquotas</code>\n` +
    `<code>/scripts/fixhomedirperms --user=${cpUser || '<user>'}</code>\n` +
    `<i>Then ask the user to retry. The panel auto-retries transient blips but cannot repair a broken homedir itself.</i>`
  )
}

// Throttle: one ops page per (cpUser + op) per 30 min, so a user repeatedly
// tapping "Create folder" can't flood the admin chat.
const EPERM_ALERT_THROTTLE_MS = 30 * 60 * 1000
const _epermAlertAt = new Map() // `${cpUser}:${op}` → last-alert ts
function alertEpermRepairNeeded({ op = 'file operation', cpUser, domain, whmHost } = {}) {
  if (!cpUser) return false
  // Never page for obviously-fake test hosts (mirrors _adminAlertDown).
  const h = String(whmHost || WHM_HOST || '').toLowerCase()
  if (!h || h === 'test' || h === 'test.host' || h === 'localhost' || h === '127.0.0.1') return false
  const key = `${cpUser}:${op}`
  const now = Date.now()
  const last = _epermAlertAt.get(key) || 0
  if (now - last < EPERM_ALERT_THROTTLE_MS) return false
  _epermAlertAt.set(key, now)
  if (!_adminNotifier) return false
  try {
    _adminNotifier(buildEpermOpsAlert({ op, cpUser, domain, whmHost }))
    return true
  } catch (e) {
    log(`[cPanel Proxy] EPERM admin alert error: ${e.message}`)
    return false
  }
}

// ─── Helpers ────────────────────────────────────────────

function getBaseUrl(host) {
  // Route every call for the default/shared WHM server through the CF tunnel
  // (`CPANEL_API_URL`, e.g. https://cpanel-api.hostbay.io) when one is
  // configured. This is critical: the DO firewall lockdown blocks direct
  // access to the origin IP on port 2083, so accounts whose stored
  // `whmHost` equals the default `WHM_HOST` MUST be normalised onto the
  // tunnel — otherwise the UAPI call times out silently and the panel shows
  // "This folder is empty" (see @ciroovblzz production report where the
  // website served files fine but /files returned nothing because
  // Fileman::list_files couldn't reach 209.38.241.9:2083).
  //
  // Only resellers on a genuinely DIFFERENT WHM box get direct routing —
  // those servers aren't behind our tunnel.
  if (CPANEL_API_URL && (!host || host === WHM_HOST)) return CPANEL_API_URL
  const effectiveHost = host || WHM_HOST
  return `https://${effectiveHost}:${CPANEL_PORT}`
}

// Friendly user-facing copy in every language the bot/frontend supports.
// Returned alongside `code: 'CPANEL_DOWN'` so callers can pick by user lang.
const DOWN_MESSAGES = {
  en: 'Hosting service is temporarily unavailable. Please try again in a few minutes — your data is safe.',
  fr: "Le service d'hébergement est temporairement indisponible. Veuillez réessayer dans quelques minutes — vos données sont en sécurité.",
  zh: '主机服务暂时不可用，请几分钟后再试 — 您的数据是安全的。',
  hi: 'होस्टिंग सेवा अस्थायी रूप से अनुपलब्ध है। कृपया कुछ मिनटों में फिर से प्रयास करें — आपका डेटा सुरक्षित है।',
}

function downResponse(reason) {
  return {
    status: 0,
    code: 'CPANEL_DOWN',
    // English fallback for legacy callers; localized variants for i18n-aware ones
    errors: [DOWN_MESSAGES.en],
    localizedMessages: DOWN_MESSAGES,
    data: null,
    _internalReason: reason,
  }
}

// ─── cpsrvd "login-page HTML" auth-failure detector ─────
//
// cpsrvd is inconsistent about signalling denied Basic Auth:
//   • Sometimes it returns HTTP 401 with the login page as body — this is
//     caught by the axios catch block via `err.response.status === 401`.
//   • Sometimes it returns HTTP 403 with `{"cpanelresult":{"error":"Access
//     denied"}}` — also caught by catch (used by @Devils_gods 2026-08-30
//     for AddonDomain/SubDomain/fileop).
//   • Sometimes it returns HTTP 200 with the raw login-page HTML — the
//     axios success path fires, `res.data` is a string starting with
//     `<!DOCTYPE html>`, and callers happily "succeed" while parsing
//     garbage. Panel editor renders it verbatim; API2 callers see
//     `cpanelresult` missing → they invent a generic "Operation failed".
//
// This helper unifies detection of the third case. Returns
// `{ reason }` when the body is a login page, null otherwise.
function _detectLoginPageHtml(body) {
  if (typeof body !== 'string') return null
  if (!/<!DOCTYPE html|<title>cPanel Login<\/title>|<title>Login<\/title>/i.test(body)) return null
  return { reason: 'cPanel returned login page HTML (session/auth denied at cpsrvd layer)' }
}

// ─── Sanitization ───────────────────────────────────────

function sanitizeString(str, extraHost) {
  if (!str || typeof str !== 'string') return str
  // Replace server IP with [server]
  if (WHM_HOST) {
    str = str.split(WHM_HOST).join('[server]')
  }
  if (extraHost && extraHost !== WHM_HOST) {
    str = str.split(extraHost).join('[server]')
  }
  // Also strip common cPanel port references
  str = str.replace(/:2083/g, '').replace(/:2087/g, '').replace(/:2096/g, '')
  return str
}

function sanitize(obj, extraHost) {
  if (typeof obj === 'string') return sanitizeString(obj, extraHost)
  if (Array.isArray(obj)) return obj.map(o => sanitize(o, extraHost))
  if (obj && typeof obj === 'object') {
    const clean = {}
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = sanitize(v, extraHost)
    }
    return clean
  }
  return obj
}

// ─── cPanel error extraction ────────────────────────────
//
// When cPanel returns HTTP 500 (typically when user-level `uapi` exits with
// EPERM/status-1 due to a broken account shell/homedir — @hellpeaces
// 5522767823, 2026-07-06), axios throws with a generic
// "Request failed with status code 500" and drops the real diagnostic
// (`"/usr/local/cpanel/uapi" exited with status 1 (EPERM)`) that lives in
// the response body under cpanelresult.error / data[0].reason. Extracting
// it here lets support/admins see the actual reason.
function extractCpanelErrorFromResponse(err, host) {
  const body = err?.response?.data
  if (body === undefined || body === null) return null
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (!trimmed) return null
    const firstLine = trimmed.split('\n').find(l => l.trim()) || trimmed
    return sanitizeString(firstLine.slice(0, 500), host)
  }
  const cp = body.cpanelresult || body.result || body
  const dataArr = Array.isArray(cp?.data)
    ? cp.data
    : (Array.isArray(body?.data) ? body.data : [])
  const first = dataArr && dataArr[0]
  const reason =
    (first && (first.reason || first.error)) ||
    cp?.error ||
    body?.error ||
    (Array.isArray(body?.errors) ? body.errors[0] : null) ||
    (Array.isArray(cp?.errors) ? cp.errors[0] : null) ||
    cp?.event?.reason
  if (!reason) return null
  return sanitizeString(String(reason), host)
}

// Detect "uapi exited status 1 (EPERM)"-class errors — signals to callers
// that they should try the WHM-root fallback (root can `su` into the user
// context and bypass the broken user-level shell/homedir).
const UAPI_EPERM_RX = /uapi.*(EPERM|status\s*1)|EPERM|permission denied|not permitted/i
function looksLikeUapiPermFailure(msg) {
  return typeof msg === 'string' && UAPI_EPERM_RX.test(msg)
}

// Detect user-level cPanel auth failures — cPanel refusing the user's
// HTTP Basic Auth. Same class of "user session is broken, use WHM root as
// impersonator" problem as EPERM, but caused by:
//   • stale cached cpPass (password rotated on the panel side, not synced
//     back to our encrypted store) — the dominant real-world case
//     (2026-08-26 @HHR2009 / nnliae74: 401 on upload_files+list_files,
//      403 "Access denied" on mkdir; ProtectionHeartbeat has been logging
//      "empty content after 3 retries" every hour since 2026-08-24 — same
//      root, same class)
//   • cPanel session-security policy blocking the user
//   • WAF (ModSecurity / cPHulk) rate-limiting the user's IP or account
//
// UAPI /execute/... returns 401 with an HTML login page.
// API2 /json-api/cpanel returns 403 with plain "Access denied".
// Both should trigger the WHM-root fallback ladder (Authorization: whm
// root:TOKEN + cpanel_jsonapi_user=<user>) which authenticates as root and
// impersonates the user — bypassing the user's password entirely.
function looksLikeAuthFailure(status, msg) {
  if (status === 401 || status === 403) return true
  if (typeof msg === 'string') {
    // Body-based fallback: some deployments strip the HTTP status (e.g. via
    // Cloudflare Access) but still leak the string in the body.
    if (/^Access denied$/i.test(msg.trim())) return true
    if (/Request failed with status code 40[13]/.test(msg)) return true
  }
  return false
}

// ─── File-name safety for cPanel Fileman::fileop ────────────────────────
//
// cPanel's `Fileman::fileop` takes `sourcefiles`/`destfiles` as a COMMA-separated
// list (and `compress` joins with a NEWLINE). There is NO escaping mechanism, so a
// file whose *name* contains one of these delimiters can be UPLOADED but then can
// NEVER be deleted, renamed, moved or extracted through the panel — cPanel splits
// the path on the delimiter and operates on a non-existent fragment
// (`Downloader,withName.zip` → tries `Downloader` → "No such file or directory").
// Confirmed live on @hellpeaces / prevc2b4 (2026-08-03): every API workaround
// (api2/UAPI scalar+array, backslash-escape, rename-first) still splits.
//
// Fix: sanitize the *basename* at creation time (upload / mkdir / rename target)
// so a delimiter can never enter a filename in the first place. We replace the
// unusable characters with '_'. Returns { name, changed, original }.
const CPANEL_FILEOP_UNSAFE_RX = /[,\r\n\t/\\\x00-\x1f]/g   // fileop list delims + path sep + control
function sanitizeCpanelFileName(rawName) {
  const original = String(rawName == null ? '' : rawName)
  let name = original.replace(CPANEL_FILEOP_UNSAFE_RX, '_').trim()
  if (!name || name === '.' || name === '..') name = 'file'
  return { name, changed: name !== original, original }
}

// ─── Core UAPI call ─────────────────────────────────────

// Idempotent UAPI reads that are safe to auto-retry ONCE on a transient
// upstream timeout. These are pure GETs — they don't mutate cPanel state, so
// a retry can only recover from a flaky control-plane blip (which the Railway
// logs show is the dominant failure pattern: a single 30s timeout surrounded
// by successful calls within a few seconds). This directly addresses the
// @ciroovblzz post-login "error screen" reports.
const RETRY_SAFE_UAPI = new Set([
  'Fileman::list_files',
  'Fileman::get_file_content',
  'DomainInfo::list_domains',
  'DomainInfo::domains_data',
  'DomainInfo::single_domain_data',
  'SSL::installed_hosts',
  'StatsBar::get_stats',
  'Quota::get_quota_info',
])
const UPSTREAM_TIMEOUT_RX = /ECONNABORTED|ETIMEDOUT|timeout of \d+ms exceeded/i

async function uapi(cpUser, cpPass, module, func, params = {}, method = 'GET', host = null) {
  const baseUrl = getBaseUrl(host)
  const url = `${baseUrl}/execute/${module}/${func}`
  const auth = { username: cpUser, password: cpPass }
  const headers = _maybeAccessHeaders(baseUrl)
  const key = `${module}::${func}`

  const doCall = async () => {
    if (method === 'GET') {
      return axios.get(url, { params, auth, httpsAgent, timeout: 30000, headers })
    }
    return axios.post(url, params, { auth, httpsAgent, timeout: 30000, headers })
  }

  try {
    let res
    try {
      res = await doCall()
    } catch (err) {
      // Single retry on transient timeouts for known-idempotent reads — the
      // panel would otherwise surface a jarring "timeout of 30000ms exceeded"
      // banner right after login while the cPanel control plane is recovering.
      const transient = UPSTREAM_TIMEOUT_RX.test(err.code || '') || UPSTREAM_TIMEOUT_RX.test(err.message || '')
      if (transient && RETRY_SAFE_UAPI.has(key)) {
        log(`[cPanel Proxy] ${key} transient timeout — retrying once`)
        await new Promise(r => setTimeout(r, 500))
        res = await doCall()
      } else {
        throw err
      }
    }

    const data = res.data
    // 2026-08-30 @Devils_gods fix: cpsrvd sometimes returns HTTP 200 with
    // the cPanel login-page HTML instead of a proper 401 when Basic Auth
    // is denied at the cpsrvd layer (see uploadFile check below for the
    // original occurrence). Without this, /files/content silently returned
    // the raw HTML as the "file content" — the panel editor rendered
    // `<!DOCTYPE html>...` when clicking Edit on a real file.
    const htmlAuthFail = _detectLoginPageHtml(data)
    if (htmlAuthFail) {
      log(`[cPanel Proxy] ${module}::${func} got HTTP ${res.status} with login-page HTML — treating as auth failure`)
      return {
        status: 0,
        errors: [htmlAuthFail.reason],
        data: null,
        httpStatus: res.status,
        code: 'CPANEL_AUTH_FAILURE',
      }
    }
    // Sanitize: strip server IP from response
    return sanitize(data, host)
  } catch (err) {
    if (isControlPlaneDown(err)) {
      log(`[cPanel Proxy] ${module}::${func} CPANEL_DOWN (${err.code || err.message})`)
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    const status = err.response?.status
    // Same rationale as api2(): pull the real cPanel error from the body
    // before falling back to axios's generic status-code message.
    const cpanelMsg = extractCpanelErrorFromResponse(err, host)
    const msg = cpanelMsg || err.response?.data?.errors?.[0] || err.message
    const eperm = looksLikeUapiPermFailure(cpanelMsg || err.response?.data?.errors?.[0] || '')
    const authFail = !eperm && looksLikeAuthFailure(status, msg)
    log(`[cPanel Proxy] ${module}::${func} error (${status}): ${msg}${eperm ? ' [EPERM]' : ''}${authFail ? ' [AUTH]' : ''}`)
    return {
      status: 0,
      errors: [sanitizeString(String(msg), host)],
      data: null,
      httpStatus: status || null,
      code: eperm ? 'CPANEL_UAPI_EPERM' : (authFail ? 'CPANEL_AUTH_FAILURE' : undefined),
    }
  }
}

/**
 * Upload file to cPanel via multipart/form-data
 */
async function uploadFile(cpUser, cpPass, dir, fileName, fileBuffer, host = null) {
  const baseUrl = getBaseUrl(host)
  const url = `${baseUrl}/execute/Fileman/upload_files`
  const auth = { username: cpUser, password: cpPass }

  const form = new FormData()
  form.append('dir', dir)
  form.append('file-1', fileBuffer, { filename: fileName })

  try {
    const res = await axios.post(url, form, {
      auth,
      httpsAgent,
      timeout: 120000,
      headers: { ...form.getHeaders(), ..._maybeAccessHeaders(baseUrl) },
      maxContentLength: 100 * 1024 * 1024, // 100MB
    })
    // 2026-08-26 @HHR2009 fix: cpsrvd sometimes returns HTTP 200 with the
    // cPanel login-page HTML instead of a proper 401. That's the same
    // auth-broken class as a 401 login page — surface it as such so the
    // route triggers the WHM impersonation-session fallback (which uses
    // a WHM-root-minted session and bypasses the cpsrvd-denies-basic-auth
    // state entirely). Without this check the raw HTML would leak to the
    // client as a "successful" upload.
    if (typeof res.data === 'string' && /<title>cPanel Login<\/title>|<!DOCTYPE html>/i.test(res.data)) {
      log(`[cPanel Proxy] Fileman::upload_files got HTTP ${res.status} with login-page HTML — treating as auth failure`)
      return {
        status: 0,
        errors: ['cPanel returned login page HTML (session/auth denied at cpsrvd layer)'],
        data: null,
        httpStatus: res.status,
        code: 'CPANEL_AUTH_FAILURE',
      }
    }
    return sanitize(res.data, host)
  } catch (err) {
    if (isControlPlaneDown(err)) {
      log(`[cPanel Proxy] Fileman::upload_files CPANEL_DOWN (${err.code || err.message})`)
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    const status = err.response?.status
    const authFail = looksLikeAuthFailure(status, err.message)
    log(`[cPanel Proxy] Fileman::upload_files error (${status || 'no-status'}): ${err.message}${authFail ? ' [AUTH]' : ''}`)
    return {
      status: 0,
      errors: [sanitizeString(err.message, host)],
      data: null,
      httpStatus: status || null,
      code: authFail ? 'CPANEL_AUTH_FAILURE' : undefined,
    }
  }
}

// ─── WHM-root impersonation for cPanel API2 ────────────────────────────
//
// When the user's cPanel HTTP Basic Auth is broken (401 login-page /
// 403 "Access denied" — typically a stale cached cpPass in Mongo, cPHulk
// lockout or session-security policy block), user-level API2 calls fail
// silently but WHM-root can still drive the exact same cPanel op via
// `/json-api/cpanel?cpanel_jsonapi_user=<user>` — root token authenticates,
// `cpanel_jsonapi_user` impersonates.
//
// Existing use in cpanel-routes.js gives every File Manager op a
// WHM-root fallback (mkdir/list/upload). This helper extends the same
// safety net to the AddonDomain / SubDomain API2 calls below —
// otherwise a fresh account with broken user-auth (@greyhound110 /
// laup48f8, 2026-08-30) sees "Add Subdomain" silently fail with a
// generic error and no fallback, even though WHM package allows it.
//
// Returns the SAME response shape as the direct-Basic-Auth call so
// callers don't have to branch. Returns `null` when WHM_TOKEN /
// WHM_HOST are missing so the caller can surface the original error.
function _resolveWhmBaseUrl(host) {
  const whmApiUrl = process.env.WHM_API_URL
  const eff = host || WHM_HOST
  if (whmApiUrl && eff === WHM_HOST) {
    return `${whmApiUrl.replace(/\/+$/, '')}/json-api`
  }
  return `https://${eff}:2087/json-api`
}

async function _api2ViaWhmRoot(cpUser, module, func, params = {}, host = null) {
  const whmToken = process.env.WHM_TOKEN
  const whmUser = process.env.WHM_USERNAME || 'root'
  const eff = host || WHM_HOST
  if (!eff || !whmToken) return null
  const baseUrl = _resolveWhmBaseUrl(host)
  const url = `${baseUrl}/cpanel`
  const queryParams = {
    'api.version': 1,
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }
  const headers = {
    Authorization: `whm ${whmUser}:${whmToken}`,
    ...(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
    } : {}),
  }
  try {
    const res = await axios.get(url, {
      params: queryParams,
      headers,
      httpsAgent,
      timeout: 30000,
    })
    const raw = sanitize(res.data, host)
    const cp = raw?.cpanelresult || {}
    const dataArr = Array.isArray(cp.data) ? cp.data : (cp.data ? [cp.data] : [])
    const first = dataArr[0] || {}
    // cPanel's api2 result field is sometimes '1' (string) sometimes 1 (number).
    const okBit = (v) => v === 1 || v === '1' || v === true
    const opOk = okBit(first.result)
    const eventOk = okBit(cp.event?.result)
    if ((opOk || eventOk) && !cp.error) {
      log(`[cPanel Proxy] ${module}::${func} succeeded via WHM-root fallback (user: ${cpUser})`)
      return { status: 1, data: first, errors: null, via: 'whm-fallback' }
    }
    const reason = first.reason || cp.error || `Failed to ${func}`
    log(`[cPanel Proxy] ${module}::${func} WHM-root fallback returned failure (user: ${cpUser}): ${reason}`)
    return { status: 0, data: null, errors: [sanitizeString(String(reason), host)], via: 'whm-fallback-failed' }
  } catch (err) {
    log(`[cPanel Proxy] ${module}::${func} WHM-root fallback error (user: ${cpUser}): ${err.message}`)
    return null
  }
}

// ─── WHM-root impersonation for cPanel UAPI (api3) ─────────────────────
//
// Sibling of _api2ViaWhmRoot, but for UAPI (api3) functions like
// Fileman::list_files, Fileman::get_file_content and SSL::installed_hosts.
// WHM's /json-api/cpanel wrapper with cpanel_jsonapi_apiversion=3 runs the
// UAPI call authenticated as WHM root and impersonates <cpUser> — bypassing
// the user's (possibly stale/rotated) Basic-Auth password entirely.
//
// 2026 File-Manager/SSL reseller bug: for a live account whose cpsrvd was
// refusing the stored cpPass, the cpsession-cookie mechanism (uapiViaSession)
// 308-redirected on the SSL module (no cpsession cookie → SSL never healed),
// whereas THIS root wrapper returned both list_files AND SSL::installed_hosts
// cleanly. It is therefore the preferred fallback for UAPI reads.
//
// Returns the SAME { status, data, errors, ... } shape as the direct call so
// callers don't branch. Returns `null` when WHM_TOKEN / host is missing so the
// caller can surface the original error.
async function _uapiViaWhmRoot(cpUser, module, func, params = {}, host = null) {
  const whmToken = process.env.WHM_TOKEN
  const whmUser = process.env.WHM_USERNAME || 'root'
  const eff = host || WHM_HOST
  if (!eff || !whmToken) return null
  const baseUrl = _resolveWhmBaseUrl(host)
  const url = `${baseUrl}/cpanel`
  const queryParams = {
    'api.version': 1,
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 3,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }
  const headers = {
    Authorization: `whm ${whmUser}:${whmToken}`,
    ...(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
    } : {}),
  }
  try {
    const res = await axios.get(url, { params: queryParams, headers, httpsAgent, timeout: 30000, validateStatus: () => true })
    const body = sanitize(res.data, host)
    // WHM wraps the UAPI (api3) response under `result`.
    const cp = body?.result || body || {}
    const ok = cp.status === 1 || cp.status === '1'
    if (ok) {
      log(`[cPanel Proxy] ${module}::${func} succeeded via WHM-root UAPI fallback (user: ${cpUser})`)
      return {
        status: 1,
        data: cp.data ?? null,
        errors: null,
        messages: cp.messages || null,
        metadata: cp.metadata || null,
        via: 'whm-root-uapi',
      }
    }
    const reason = (Array.isArray(cp.errors) && cp.errors[0]) || cp.error || `Failed to ${func}`
    log(`[cPanel Proxy] ${module}::${func} WHM-root UAPI fallback returned failure (user: ${cpUser}): ${reason}`)
    return { status: 0, data: null, errors: [sanitizeString(String(reason), host)], via: 'whm-root-uapi-failed' }
  } catch (err) {
    log(`[cPanel Proxy] ${module}::${func} WHM-root UAPI fallback error (user: ${cpUser}): ${err.message}`)
    return null
  }
}

// ─── cPanel API2 call (for functions not available in UAPI) ──
// Normalizes API2 response to match UAPI format: { status, data, errors }

async function api2(cpUser, cpPass, module, func, params = {}, host = null) {
  const baseUrl = getBaseUrl(host)
  const url = `${baseUrl}/json-api/cpanel`
  const auth = { username: cpUser, password: cpPass }
  const queryParams = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }

  try {
    const res = await axios.get(url, { params: queryParams, auth, httpsAgent, timeout: 60000, headers: _maybeAccessHeaders(baseUrl) })
    // Detect the "HTTP 200 + login-page HTML" auth-broken variant (see
    // _detectLoginPageHtml docstring). Without this, api2() invents a
    // generic "Operation failed" for the missing cpanelresult and callers
    // never trigger their WHM-root fallback.
    const htmlAuthFail = _detectLoginPageHtml(res.data)
    if (htmlAuthFail) {
      log(`[cPanel Proxy API2] ${module}::${func} got HTTP ${res.status} with login-page HTML — treating as auth failure`)
      return {
        status: 0,
        errors: [htmlAuthFail.reason],
        data: null,
        httpStatus: res.status,
        code: 'CPANEL_AUTH_FAILURE',
      }
    }
    const raw = sanitize(res.data, host)

    // Normalize API2 response to UAPI-like format
    const cp = raw?.cpanelresult || {}
    const eventOk = cp.event?.result === 1
    const dataArr = cp.data || []
    const opOk = dataArr.length > 0 && dataArr[0]?.result === 1
    const errors = []
    if (!eventOk || !opOk) {
      const reason = dataArr[0]?.reason || cp.error || 'Operation failed'
      errors.push(sanitizeString(String(reason), host))
    }

    return {
      status: (eventOk && opOk) ? 1 : 0,
      data: dataArr,
      errors: errors.length ? errors : null,
      messages: null,
      metadata: {},
    }
  } catch (err) {
    if (isControlPlaneDown(err)) {
      log(`[cPanel Proxy API2] ${module}::${func} CPANEL_DOWN (${err.code || err.message})`)
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    const status = err.response?.status
    // Extract the real cPanel reason from the response body before falling
    // back to axios's generic "Request failed with status code NNN".
    const cpanelMsg = extractCpanelErrorFromResponse(err, host)
    const msg = cpanelMsg || err.response?.data?.errors?.[0] || err.message
    const eperm = looksLikeUapiPermFailure(cpanelMsg || err.response?.data?.errors?.[0] || '')
    const authFail = !eperm && looksLikeAuthFailure(status, msg)
    log(`[cPanel Proxy API2] ${module}::${func} error (${status}): ${msg}${eperm ? ' [EPERM]' : ''}${authFail ? ' [AUTH]' : ''}`)
    return {
      status: 0,
      errors: [sanitizeString(String(msg), host)],
      data: null,
      httpStatus: status || null,
      code: eperm ? 'CPANEL_UAPI_EPERM' : (authFail ? 'CPANEL_AUTH_FAILURE' : undefined),
    }
  }
}

// ─── High-level operations ──────────────────────────────

// FILE MANAGER

async function listFiles(cpUser, cpPass, dir = '/public_html', host = null) {
  return uapi(cpUser, cpPass, 'Fileman', 'list_files', {
    dir,
    include_mime: 1,
    include_permissions: 1,
    include_hash: 0,
    include_content: 0,
    types: 'dir|file',
  }, 'GET', host)
}

async function getFileContent(cpUser, cpPass, dir, file, host = null) {
  return uapi(cpUser, cpPass, 'Fileman', 'get_file_content', { dir, file }, 'GET', host)
}

async function saveFileContent(cpUser, cpPass, dir, file, content, host = null) {
  return uapi(cpUser, cpPass, 'Fileman', 'save_file_content', { dir, file, content }, 'POST', host)
}

async function createDirectory(cpUser, cpPass, dir, name, host = null) {
  const result = await api2(cpUser, cpPass, 'Fileman', 'mkdir', {
    path: dir,
    name: name,
  }, host)
  // api2 normalizer misreads mkdir success — check data for actual result
  if (result.data?.length > 0 && result.data[0]?.path && result.data[0]?.name) {
    result.status = 1
    result.errors = null
  }
  return result
}

/**
 * Run a single Fileman::fileop deletion attempt. Returns the raw api2 result.
 */
async function _fileopDelete(cpUser, cpPass, dir, file, op, host) {
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op,
    sourcefiles: `${dir}/${file}`,
  }, host)
}

/**
 * Verify a target file/dir is no longer present in `dir` by listing the parent.
 * Returns true when target is gone, false when it still appears, null if the
 * listing call itself failed (treat null as "unknown — assume best").
 *
 * 2026-08-26 — HHR2009/nnliae74 fix: previously we treated `data:null` from a
 * failed listFiles (user-level UAPI returning 401 login-page) as an empty
 * directory, which made verifyDeleted return true (gone) → deleteFile
 * promoted the actual FAILED delete (status:0) to a false success (status:1).
 * Now we treat any non-`status:1` listing as null (unknown) so the caller
 * keeps the original delete result and can trigger the WHM-root fallback.
 */
async function _verifyDeleted(cpUser, cpPass, dir, file, host) {
  try {
    const listing = await listFiles(cpUser, cpPass, dir, host)
    if (!listing || listing.status !== 1 || !Array.isArray(listing.data)) return null
    const items = listing.data
    return !items.some(f => f && (f.file === file || f.fullname === file))
  } catch (_) {
    return null
  }
}

async function deleteFile(cpUser, cpPass, dir, file, host = null, isDirectory = false) {
  // cPanel API2 Fileman::fileop quirks observed on production WHM 11.x:
  //   • op=unlink     → reliably deletes FILES.
  //                     For directories it returns result=1 BUT the dir is NOT removed
  //                     (silent no-op — see @Thebiggestbag22 "BlueFCU_Upload_Ready"
  //                     bug Apr 2026, reproduced live against panel.1.hostbay.io).
  //   • op=killdir    → "Unknown operation sent to api2_fileop" on current cPanel
  //                     servers (deprecated).
  //   • op=trash      → ✅ works for BOTH files and directories. Moves the item
  //                     to ~/.trash/, fully removed from the visible tree.
  //                     Verified end-to-end on production cPanel WHM 11.x.
  //
  // Strategy:
  //   1. Try the preferred op (trash for dirs, unlink for files).
  //   2. Verify by re-listing the parent dir — if the target is still there,
  //      retry with the alternate op (the silent-no-op guard suggested by the
  //      BlueFCU post-mortem).
  //   3. Re-verify. If still present, surface a clear error to the caller.
  const primary = isDirectory ? 'trash' : 'unlink'
  const fallback = isDirectory ? 'unlink' : 'trash'

  let result = await _fileopDelete(cpUser, cpPass, dir, file, primary, host)
  let gone = await _verifyDeleted(cpUser, cpPass, dir, file, host)

  if (gone === false) {
    // Silent no-op detected — try the alternate op.
    const fallbackResult = await _fileopDelete(cpUser, cpPass, dir, file, fallback, host)
    const goneAfter = await _verifyDeleted(cpUser, cpPass, dir, file, host)
    if (goneAfter === false) {
      return {
        ...result,
        status: 0,
        errors: [
          `Both '${primary}' and '${fallback}' returned success but the target is still present. ` +
          `Permission issue or read-only filesystem? Original op response was kept above.`,
        ],
        attempted_ops: [primary, fallback],
        fallback_response: fallbackResult,
      }
    }
    // Fallback worked — promote it.
    return {
      ...fallbackResult,
      status: 1,
      attempted_ops: [primary, fallback],
      verified_via: 'fallback',
    }
  }

  // Primary worked (or verification failed but we'll trust the API's success).
  // 2026-08-26 fix: only promote to status:1 if the original op ALSO said status:1.
  // Previously we promoted status:0 → status:1 whenever verifyDeleted returned
  // true, which false-positived when both the deleteFile AND the verifying
  // listFiles were auth-broken (both returning empty). Now we only *demote*
  // status:1 → status:0 when verification says "still there"; we never
  // promote in the other direction.
  if (gone === true && result?.status === 1) {
    return { ...result, status: 1, attempted_ops: [primary], verified_via: 'primary' }
  }
  return result
}

async function renameFile(cpUser, cpPass, dir, oldName, newName, host = null) {
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op: 'rename',
    sourcefiles: `${dir}/${oldName}`,
    destfiles: `${dir}/${newName}`,
  }, host)
}

async function extractFile(cpUser, cpPass, dir, file, destDir, host = null) {
  // Extract uses API2 (UAPI has no fileop equivalent)
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op: 'extract',
    sourcefiles: `${dir}/${file}`,
    destfiles: destDir || dir,
  }, host)
}

async function compressFiles(cpUser, cpPass, dir, files, destFile, host = null) {
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op: 'compress',
    sourcefiles: files.map(f => `${dir}/${f}`).join('\n'),
    destfiles: `${dir}/${destFile}`,
  }, host)
}

async function copyFile(cpUser, cpPass, sourceDir, fileName, destDir, host = null) {
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op: 'copy',
    sourcefiles: `${sourceDir}/${fileName}`,
    destfiles: destDir,
  }, host)
}

async function moveFile(cpUser, cpPass, sourceDir, fileName, destDir, host = null) {
  return api2(cpUser, cpPass, 'Fileman', 'fileop', {
    doubledecode: 0,
    op: 'move',
    sourcefiles: `${sourceDir}/${fileName}`,
    destfiles: `${destDir}/${fileName}`,
  }, host)
}

// DOMAINS

async function listDomains(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'DomainInfo', 'list_domains', {}, 'GET', host)
}

async function addAddonDomain(cpUser, cpPass, domain, subDomain, dir, host = null) {
  // Use cPanel API2 for AddonDomain::addaddondomain (UAPI module not available on all versions)
  const auth = { username: cpUser, password: cpPass }
  const url = `${getBaseUrl(host)}/json-api/cpanel`
  const p2 = {
    newdomain: domain,
    subdomain: subDomain || domain.replace(/\./g, ''),
    dir: dir || `public_html/${domain}`,
  }
  const params = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: 'AddonDomain',
    cpanel_jsonapi_func: 'addaddondomain',
    ...p2,
  }
  try {
    const res = await axios.get(url, {
      params,
      auth,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      timeout: 30000,
      headers: _maybeAccessHeaders(getBaseUrl(host)),
    })
    // 200-with-login-page-HTML variant → treat as auth failure and let
    // the caller's WHM-root fallback path kick in.
    const htmlAuthFailAddon = _detectLoginPageHtml(res.data)
    if (htmlAuthFailAddon) {
      log(`[cPanel Proxy] AddonDomain::addaddondomain got HTTP ${res.status} with login-page HTML — falling back via WHM-root`)
      const fallback = await _api2ViaWhmRoot(cpUser, 'AddonDomain', 'addaddondomain', p2, host)
      if (fallback) return fallback
      return { status: 0, data: null, errors: [htmlAuthFailAddon.reason], httpStatus: res.status, code: 'CPANEL_AUTH_FAILURE' }
    }
    const result = res.data?.cpanelresult?.data?.[0] || {}
    if (result.result === 1) {
      return { status: 1, data: result, errors: null }
    }
    return { status: 0, data: null, errors: [result.reason || 'Failed to add addon domain'] }
  } catch (err) {
    if (isControlPlaneDown(err)) {
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    // User-level Basic Auth broken (401 login-page / 403 "Access denied") →
    // retry via WHM-root impersonation. Fixes @greyhound110 / laup48f8
    // (2026-08-30): fresh account had a broken user auth so every panel
    // subdomain / addon-domain create silently failed with a generic 403,
    // even though the WHM package (Premium-Anti-Red-1-Week) allows both.
    const status = err.response?.status
    if (looksLikeAuthFailure(status, err.message)) {
      const fallback = await _api2ViaWhmRoot(cpUser, 'AddonDomain', 'addaddondomain', p2, host)
      if (fallback) return fallback
    }
    return { status: 0, data: null, errors: [err.message], httpStatus: status || null }
  }
}

async function removeAddonDomain(cpUser, cpPass, domain, subDomain, mainDomain, host = null) {
  const auth = { username: cpUser, password: cpPass }
  const url = `${getBaseUrl(host)}/json-api/cpanel`
  const p2 = {
    domain: domain,
    subdomain: subDomain || (mainDomain ? `${domain.replace(/\./g, '')}.${mainDomain}` : domain.replace(/\./g, '')),
  }
  const params = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: 'AddonDomain',
    cpanel_jsonapi_func: 'deladdondomain',
    ...p2,
  }
  try {
    const res = await axios.get(url, {
      params,
      auth,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      timeout: 30000,
      headers: _maybeAccessHeaders(getBaseUrl(host)),
    })
    const htmlAuthFailRemove = _detectLoginPageHtml(res.data)
    if (htmlAuthFailRemove) {
      log(`[cPanel Proxy] AddonDomain::deladdondomain got HTTP ${res.status} with login-page HTML — falling back via WHM-root`)
      const fallback = await _api2ViaWhmRoot(cpUser, 'AddonDomain', 'deladdondomain', p2, host)
      if (fallback) return fallback
      return { status: 0, data: null, errors: [htmlAuthFailRemove.reason], httpStatus: res.status, code: 'CPANEL_AUTH_FAILURE' }
    }
    const result = res.data?.cpanelresult?.data?.[0] || {}
    if (result.result === 1) {
      return { status: 1, data: result, errors: null }
    }
    return { status: 0, data: null, errors: [result.reason || 'Failed to remove addon domain'] }
  } catch (err) {
    if (isControlPlaneDown(err)) {
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    // WHM-root fallback for user-auth-broken (parity with addAddonDomain).
    const status = err.response?.status
    if (looksLikeAuthFailure(status, err.message)) {
      const fallback = await _api2ViaWhmRoot(cpUser, 'AddonDomain', 'deladdondomain', p2, host)
      if (fallback) return fallback
    }
    return { status: 0, data: null, errors: [err.message], httpStatus: status || null }
  }
}

// DOMAIN DOCUMENT ROOTS (mirror primary vs own folder)

// Full per-vhost data including documentroot. Used to derive whether an addon
// domain currently mirrors the primary site (docroot === public_html) or
// serves its own folder (docroot === public_html/<domain>).

// Change the document root of an addon domain's underlying subdomain.
// cPanel exposes this ONLY via API2 SubDomain::changedocroot (no UAPI equiv).
//   subdomain  = addon's subdomain label (we create addons as <domainNoDots>)
//   rootdomain = the account's primary domain
//   dir        = new docroot relative to home, e.g. 'public_html' (mirror)
//                or 'public_html/<domain>' (own folder)
async function changeDomainDocRoot(cpUser, cpPass, subdomain, rootdomain, dir, host = null) {
  return api2(cpUser, cpPass, 'SubDomain', 'changedocroot', {
    subdomain,
    rootdomain,
    dir,
  }, host)
}

// EMAIL

async function listEmailAccounts(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Email', 'list_pops_with_disk', {}, 'GET', host)
}

async function createEmailAccount(cpUser, cpPass, email, password, quota, domain, host = null) {
  return uapi(cpUser, cpPass, 'Email', 'add_pop', {
    email,
    password,
    quota: quota || 250, // MB
    domain,
  }, 'POST', host)
}

async function deleteEmailAccount(cpUser, cpPass, email, domain, host = null) {
  return uapi(cpUser, cpPass, 'Email', 'delete_pop', { email, domain }, 'POST', host)
}

async function changeEmailPassword(cpUser, cpPass, email, password, domain, host = null) {
  return uapi(cpUser, cpPass, 'Email', 'passwd_pop', { email, password, domain }, 'POST', host)
}

// Send test email via cPanel webmail (uses the server's sendmail)

// STATS

async function getQuotaInfo(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Quota', 'get_local_quota_info', {}, 'GET', host)
}

async function getBandwidthData(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Stats', 'get_bandwidth', {}, 'GET', host)
}

// SUBDOMAINS
// Note: listing uses DomainInfo::list_domains (subdomains in the domains response)
// Creation/deletion uses cPanel API2 SubDomain module

async function listSubdomains(cpUser, cpPass, host = null) {
  // Subdomains are already part of the domains response
  const domains = await listDomains(cpUser, cpPass, host)
  return {
    data: (domains.data?.sub_domains || []).map(s => {
      if (typeof s === 'string') {
        const parts = s.split('.')
        return { domain: parts[0], rootdomain: parts.slice(1).join('.'), fullDomain: s }
      }
      return s
    }),
    status: domains.status,
    errors: domains.errors,
  }
}

async function createSubdomain(cpUser, cpPass, subdomain, rootdomain, dir, host = null) {
  // Use cpanel API2 for SubDomain::addsubdomain
  const auth = { username: cpUser, password: cpPass }
  const url = `${getBaseUrl(host)}/json-api/cpanel`
  const p2 = {
    domain: subdomain,
    rootdomain: rootdomain,
    dir: dir || `public_html/${subdomain}`,
  }
  const params = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: 'SubDomain',
    cpanel_jsonapi_func: 'addsubdomain',
    ...p2,
  }
  try {
    const res = await axios.get(url, {
      params,
      auth,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      timeout: 30000,
      headers: _maybeAccessHeaders(getBaseUrl(host)),
    })
    const htmlAuthFailCreate = _detectLoginPageHtml(res.data)
    if (htmlAuthFailCreate) {
      log(`[cPanel Proxy] SubDomain::addsubdomain got HTTP ${res.status} with login-page HTML — falling back via WHM-root`)
      const fallback = await _api2ViaWhmRoot(cpUser, 'SubDomain', 'addsubdomain', p2, host)
      if (fallback) return fallback
      return { status: 0, data: null, errors: [htmlAuthFailCreate.reason], httpStatus: res.status, code: 'CPANEL_AUTH_FAILURE' }
    }
    const result = res.data?.cpanelresult?.data?.[0] || {}
    if (result.result === 1) {
      return { status: 1, data: result, errors: null }
    }
    return { status: 0, data: null, errors: [result.reason || 'Failed to create subdomain'] }
  } catch (err) {
    if (isControlPlaneDown(err)) {
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    // WHM-root fallback for user-auth-broken (401/403). Fixes @greyhound110
    // 2026-08-30: fresh laup48f8 account had broken user Basic Auth so the
    // panel's "Add Subdomain" silently failed with 403 even though the plan
    // (Premium-Anti-Red-1-Week, MAXSUB=unlimited) permits it.
    const status = err.response?.status
    if (looksLikeAuthFailure(status, err.message)) {
      const fallback = await _api2ViaWhmRoot(cpUser, 'SubDomain', 'addsubdomain', p2, host)
      if (fallback) return fallback
    }
    return { status: 0, data: null, errors: [err.message], httpStatus: status || null }
  }
}

async function deleteSubdomain(cpUser, cpPass, fullSubdomain, host = null) {
  // Use cpanel API2 for SubDomain::delsubdomain
  const effectiveHost = host || WHM_HOST
  const auth = { username: cpUser, password: cpPass }
  const url = `${getBaseUrl(host)}/json-api/cpanel`
  const p2 = {
    domain: fullSubdomain,
  }
  const params = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: 'SubDomain',
    cpanel_jsonapi_func: 'delsubdomain',
    ...p2,
  }
  try {
    const res = await axios.get(url, {
      params,
      auth,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      timeout: 30000,
      headers: _maybeAccessHeaders(getBaseUrl(host)),
    })
    const htmlAuthFailDelete = _detectLoginPageHtml(res.data)
    if (htmlAuthFailDelete) {
      log(`[cPanel Proxy] SubDomain::delsubdomain got HTTP ${res.status} with login-page HTML — falling back via WHM-root`)
      const fallback = await _api2ViaWhmRoot(cpUser, 'SubDomain', 'delsubdomain', p2, host)
      if (fallback) return fallback
      return { status: 0, data: null, errors: [htmlAuthFailDelete.reason], httpStatus: res.status, code: 'CPANEL_AUTH_FAILURE' }
    }
    const result = res.data?.cpanelresult?.data?.[0] || {}
    if (result.result === 1) {
      return { status: 1, data: result, errors: null }
    }
    return { status: 0, data: null, errors: [result.reason || 'Failed to delete subdomain'] }
  } catch (err) {
    if (isControlPlaneDown(err)) {
      _adminAlertDown(err.code || err.message, host || WHM_HOST)
      return downResponse(err.code || err.message)
    }
    // WHM-root fallback for user-auth-broken (parity with createSubdomain).
    const status = err.response?.status
    if (looksLikeAuthFailure(status, err.message)) {
      const fallback = await _api2ViaWhmRoot(cpUser, 'SubDomain', 'delsubdomain', p2, host)
      if (fallback) return fallback
    }
    return { status: 0, data: null, errors: [err.message], httpStatus: status || null }
  }
}

// SSL

async function getSSLStatus(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'SSL', 'installed_hosts', {}, 'GET', host)
}

// ─── MySQL ──────────────────────────────────────────────
// All MySQL operations use UAPI's `Mysql` module. cPanel auto-prefixes DB
// names and DB usernames with `<cpanel_user>_`. We pass names through
// unchanged — the frontend handles displaying full prefixed names.
//
// Plan limits (max DBs / max DB users) are enforced server-side by the cPanel
// package quota, so we don't need to count locally. UAPI will surface a
// human-readable error if the user hits the limit.

async function listDatabases(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'list_databases', {}, 'GET', host)
}

async function listDatabaseUsers(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'list_users', {}, 'GET', host)
}

async function createDatabase(cpUser, cpPass, name, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'create_database', { name }, 'POST', host)
}

async function deleteDatabase(cpUser, cpPass, name, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'delete_database', { name }, 'POST', host)
}

async function renameDatabase(cpUser, cpPass, oldname, newname, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'rename_database', { oldname, newname }, 'POST', host)
}

async function checkDatabase(cpUser, cpPass, name, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'check_database', { name }, 'POST', host)
}

async function repairDatabase(cpUser, cpPass, name, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'repair_database', { name }, 'POST', host)
}

async function createDatabaseUser(cpUser, cpPass, name, password, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'create_user', { name, password }, 'POST', host)
}

async function deleteDatabaseUser(cpUser, cpPass, name, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'delete_user', { name }, 'POST', host)
}

async function setDatabaseUserPassword(cpUser, cpPass, user, password, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'set_password', { user, password }, 'POST', host)
}

async function renameDatabaseUser(cpUser, cpPass, oldname, newname, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'rename_user', { oldname, newname }, 'POST', host)
}

// privileges is an array of MySQL privilege strings, e.g.
// ['SELECT','INSERT','UPDATE','DELETE'] or ['ALL PRIVILEGES'].
// cPanel expects them comma-separated.
async function setUserPrivilegesOnDatabase(cpUser, cpPass, user, database, privileges, host = null) {
  const privs = Array.isArray(privileges) ? privileges.join(',') : String(privileges || '')
  return uapi(cpUser, cpPass, 'Mysql', 'set_privileges_on_database', {
    user,
    database,
    privileges: privs,
  }, 'POST', host)
}

async function revokeUserPrivilegesOnDatabase(cpUser, cpPass, user, database, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'revoke_privileges_on_database', {
    user, database,
  }, 'POST', host)
}

// Remote MySQL access — whitelist a host (IP, IP with %, or hostname) so it
// can connect from outside the server. Used by power users who want to
// connect their laptop/IDE to the cPanel DB.
async function listMysqlRemoteHosts(cpUser, cpPass, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'get_remote_hosts', {}, 'GET', host)
}

async function addMysqlRemoteHost(cpUser, cpPass, remoteHost, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'add_host', { host: remoteHost }, 'POST', host)
}

async function deleteMysqlRemoteHost(cpUser, cpPass, remoteHost, host = null) {
  return uapi(cpUser, cpPass, 'Mysql', 'delete_host', { host: remoteHost }, 'POST', host)
}

// ─── WHM impersonation-session upload fallback ────────────────────────
//
// Definitive fix for the @HHR2009 / nnliae74 pattern (2026-08-26). This
// account is stuck in a state where its user-level UAPI Basic Auth is
// rejected by cpsrvd (HTTP 401 with cPanel login-page HTML) *regardless
// of the actual password* — even immediately after WHM /passwd confirms
// "Password changed for user X". That rules out stale cpPass, cPHulk,
// and ModSecurity (all confirmed via live probes 22:37→23:37Z). The
// underlying trigger is a per-account cpsrvd security-policy state that
// only clears with a session that ORIGINATES from WHM root, not from raw
// Basic Auth. The path:
//   1) WHM /json-api/create_user_session?user=X&service=cpaneld
//        → returns { session, cp_security_token, url }
//   2) GET  <tunnel>/cpsess<N>/login/?session=<sessionToken>
//        → sets the `cpsession` cookie
//   3) POST <tunnel>/cpsess<N>/execute/Fileman/upload_files
//        → cpsrvd accepts multipart via session cookie (which raw Basic
//          Auth is being denied) and forwards to Fileman properly. This
//          is the same session mechanism the cPanel UI uses.
//
// Advantages over the earlier cpPass-rotation attempt (which "worked" at
// the WHM /passwd level but didn't restore user-level UAPI):
//   • Zero writes to Mongo — no cpPass churn.
//   • Zero risk of breaking bound MySQL passwords.
//   • Works even when cpsrvd is denying Basic Auth entirely.
//   • Same code path handles all Fileman ops (multipart upload, list,
//     mkdir, extract, delete) — no /json-api/cpanel gateway multipart
//     limitations because it goes to /execute/... directly.
//
// Session is short-lived (~30 min from WHM) so we don't cache it — a
// per-op call is cheap and always fresh.
async function uploadFileViaSession(cpUser, dir, fileName, fileBuffer, whmHost) {
  const whmToken = process.env.WHM_TOKEN
  if (!whmToken || !whmHost) {
    return { status: 0, errors: ['WHM session fallback not configured (missing WHM_TOKEN or whmHost)'], data: null, via: 'session-unavailable' }
  }
  const whmApiUrl = process.env.WHM_API_URL
  const useTunnel = whmApiUrl && whmHost === process.env.WHM_HOST
  const whmBase = useTunnel ? `${whmApiUrl.replace(/\/+$/, '')}/json-api` : `https://${whmHost}:2087/json-api`

  const cfAccess = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) ? {
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
  } : {}

  try {
    // Step 1 — Ask WHM for a fresh user session.
    const sess = await axios.get(`${whmBase}/create_user_session`, {
      params: { 'api.version': 1, user: cpUser, service: 'cpaneld' },
      headers: { Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${whmToken}`, ...cfAccess },
      httpsAgent, timeout: 30000, validateStatus: () => true,
    })
    if (sess.data?.metadata?.result !== 1) {
      const reason = sess.data?.metadata?.reason || 'WHM create_user_session returned failure'
      log(`[cPanel Proxy] uploadFileViaSession: create_user_session failed for ${cpUser} — ${reason}`)
      return { status: 0, errors: [sanitizeString(String(reason), whmHost)], data: null, via: 'session-create-failed' }
    }
    const sessInfo = sess.data.data || {}
    const cpsess = sessInfo.cp_security_token
    const sessionToken = sessInfo.session
    if (!cpsess || !sessionToken) {
      return { status: 0, errors: ['WHM session response missing cp_security_token or session'], data: null, via: 'session-malformed' }
    }

    // Step 2 — Follow the session URL on the cPanel tunnel host to seed the
    // cpsession cookie. WHM's create_user_session returns a cprapid.com URL
    // by default; we rewrite it to CPANEL_API_URL (Cloudflare tunnel → port
    // 2083) so we don't need direct :2083 egress (which the ingress firewall
    // blocks). NOTE: cpsession + /execute/ endpoints live on 2083 (cpanel),
    // not 2087 (whm), so we must use CPANEL_API_URL here — using WHM_API_URL
    // sends us to the wrong service and gets 401 back with a wrong-service
    // login page.
    const cpanelApiUrl = process.env.CPANEL_API_URL || ''
    const useCpanelTunnel = cpanelApiUrl && whmHost === process.env.WHM_HOST
    const tunnelBase = useCpanelTunnel ? cpanelApiUrl.replace(/\/+$/, '') : `https://${whmHost}:2083`
    // Manually manage the cpsession cookie so we don't depend on tough-cookie.
    // (Only one cookie is set on the login redirect: `cpsession=<value>`.)
    const loginUrl = `${tunnelBase}${cpsess}/login/?session=${encodeURIComponent(sessionToken)}`
    const loginRes = await axios.get(loginUrl, {
      headers: { ...cfAccess },
      httpsAgent, timeout: 30000, validateStatus: () => true, maxRedirects: 0,
    })
    // cpsession cookie comes back on either the 200 or the 302
    const setCookies = loginRes.headers['set-cookie'] || []
    const cpsessionCookie = setCookies
      .map(c => (c.match(/cpsession=([^;]+)/) || [])[1])
      .find(Boolean)
    if (!cpsessionCookie) {
      log(`[cPanel Proxy] uploadFileViaSession: no cpsession cookie in login response for ${cpUser} (status ${loginRes.status})`)
      return { status: 0, errors: ['session login did not set cpsession cookie'], data: null, via: 'session-cookie-missing' }
    }

    // Step 3 — Multipart upload via /execute/Fileman/upload_files with the cpsession cookie.
    const uploadUrl = `${tunnelBase}${cpsess}/execute/Fileman/upload_files`
    const form = new FormData()
    form.append('dir', dir)
    form.append('file-1', fileBuffer, { filename: fileName })
    const up = await axios.post(uploadUrl, form, {
      headers: {
        ...form.getHeaders(),
        Cookie: `cpsession=${cpsessionCookie}`,
        ...cfAccess,
      },
      httpsAgent, timeout: 120000, validateStatus: () => true,
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength:    100 * 1024 * 1024,
    })

    // /execute/... always returns JSON on 2xx.
    if (up.status !== 200 || typeof up.data !== 'object') {
      const preview = (typeof up.data === 'string' ? up.data : JSON.stringify(up.data)).slice(0, 200)
      log(`[cPanel Proxy] uploadFileViaSession: upload_files HTTP ${up.status} for ${cpUser} — ${preview}`)
      return { status: 0, errors: [sanitizeString(`HTTP ${up.status}: ${preview}`, whmHost)], data: null, httpStatus: up.status, via: 'session-upload-failed' }
    }

    // UAPI shape: { status: 1|0, data: { uploads: [{status,file,reason,...}], succeeded, failed }, errors, ... }
    const body = sanitize(up.data, whmHost)
    const succeeded = body?.status === 1 && (body?.data?.uploads || []).some(u => u && u.status === 1)
    if (succeeded) {
      return { status: 1, data: body.data || null, errors: null, via: 'whm-session' }
    }
    const reason = (body?.data?.uploads || [])[0]?.reason || body?.errors?.[0] || 'WHM session upload also failed'
    return { status: 0, errors: [sanitizeString(String(reason), whmHost)], data: body?.data || null, via: 'session-upload-rejected' }
  } catch (err) {
    const status = err.response?.status
    const msg = extractCpanelErrorFromResponse(err, whmHost) || err.message
    log(`[cPanel Proxy] uploadFileViaSession exception for ${cpUser}: (${status || 'no-status'}) ${msg}`)
    return { status: 0, errors: [sanitizeString(String(msg), whmHost)], data: null, httpStatus: status || null, via: 'session-exception' }
  }
}

// ─── Generic UAPI over a WHM-minted cpsession ────────────────────────
//
// Same session ladder as uploadFileViaSession, but for non-multipart
// /execute/<module>/<func> ops — specifically Fileman::get_file_content and
// save_file_content. Those MUST go through a real cpsession on the
// CPANEL_API_URL tunnel (port 2083), NOT the WHM json-api gateway (2087):
//   - get_file_content over json-api returns the login-page HTML for a
//     broken-auth user, and
//   - the raw session URL WHM returns points at the origin IP:2083, which the
//     ingress firewall blocks (30s timeout — the 2026-08-31 @nbayftest bug).
// So we rewrite the cpsess path onto CPANEL_API_URL and carry the cpsession
// cookie ourselves, exactly like the upload path.
async function uapiViaSession(cpUser, module, func, params = {}, method = 'GET', whmHost = null) {
  const whmToken = process.env.WHM_TOKEN
  const eff = whmHost || WHM_HOST
  if (!whmToken || !eff) {
    return { status: 0, errors: ['WHM session fallback not configured (missing WHM_TOKEN or whmHost)'], data: null, via: 'session-unavailable' }
  }
  const whmApiUrl = process.env.WHM_API_URL
  const useTunnel = whmApiUrl && eff === WHM_HOST
  const whmBase = useTunnel ? `${whmApiUrl.replace(/\/+$/, '')}/json-api` : `https://${eff}:2087/json-api`
  const cfAccess = (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) ? {
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
  } : {}
  try {
    // Step 1 — WHM mints a user session (this call goes over the WHM tunnel, which is reachable).
    const sess = await axios.get(`${whmBase}/create_user_session`, {
      params: { 'api.version': 1, user: cpUser, service: 'cpaneld' },
      headers: { Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${whmToken}`, ...cfAccess },
      httpsAgent, timeout: 30000, validateStatus: () => true,
    })
    if (sess.data?.metadata?.result !== 1) {
      const reason = sess.data?.metadata?.reason || 'WHM create_user_session returned failure'
      log(`[cPanel Proxy] uapiViaSession: create_user_session failed for ${cpUser} — ${reason}`)
      return { status: 0, errors: [sanitizeString(String(reason), eff)], data: null, via: 'session-create-failed' }
    }
    const sessInfo = sess.data.data || {}
    const cpsess = sessInfo.cp_security_token
    const sessionToken = sessInfo.session
    if (!cpsess || !sessionToken) {
      return { status: 0, errors: ['WHM session response missing cp_security_token or session'], data: null, via: 'session-malformed' }
    }

    // Step 2 — Seed the cpsession cookie on the CPANEL tunnel host (port 2083).
    const cpanelApiUrl = process.env.CPANEL_API_URL || ''
    const useCpanelTunnel = cpanelApiUrl && eff === WHM_HOST
    const tunnelBase = useCpanelTunnel ? cpanelApiUrl.replace(/\/+$/, '') : `https://${eff}:2083`
    const loginUrl = `${tunnelBase}${cpsess}/login/?session=${encodeURIComponent(sessionToken)}`
    const loginRes = await axios.get(loginUrl, {
      headers: { ...cfAccess },
      httpsAgent, timeout: 30000, validateStatus: () => true, maxRedirects: 0,
    })
    const setCookies = loginRes.headers['set-cookie'] || []
    const cpsessionCookie = setCookies.map(c => (c.match(/cpsession=([^;]+)/) || [])[1]).find(Boolean)
    if (!cpsessionCookie) {
      log(`[cPanel Proxy] uapiViaSession: no cpsession cookie in login response for ${cpUser} (status ${loginRes.status})`)
      return { status: 0, errors: ['session login did not set cpsession cookie'], data: null, via: 'session-cookie-missing' }
    }

    // Step 3 — Call /execute/<module>/<func> with the cpsession cookie.
    const execUrl = `${tunnelBase}${cpsess}/execute/${module}/${func}`
    const commonHeaders = { Cookie: `cpsession=${cpsessionCookie}`, ...cfAccess }
    let res
    if (method === 'POST') {
      res = await axios.post(execUrl, new URLSearchParams(params).toString(), {
        headers: { ...commonHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent, timeout: 60000, validateStatus: () => true,
        maxContentLength: 50 * 1024 * 1024, maxBodyLength: 50 * 1024 * 1024,
      })
    } else {
      res = await axios.get(execUrl, { params, headers: commonHeaders, httpsAgent, timeout: 60000, validateStatus: () => true })
    }
    if (res.status !== 200 || typeof res.data !== 'object') {
      const preview = (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).slice(0, 200)
      log(`[cPanel Proxy] uapiViaSession: ${module}::${func} HTTP ${res.status} for ${cpUser} — ${preview}`)
      return { status: 0, errors: [sanitizeString(`HTTP ${res.status}: ${preview}`, eff)], data: null, httpStatus: res.status, via: 'session-exec-failed' }
    }
    const body = sanitize(res.data, eff)
    return {
      status: body?.status === 1 ? 1 : 0,
      data: body?.data ?? null,
      errors: body?.errors || null,
      messages: body?.messages || null,
      metadata: body?.metadata || null,
      reason: (Array.isArray(body?.errors) && body.errors[0]) || body?.error || null,
      via: 'whm-session',
    }
  } catch (err) {
    const status = err.response?.status
    const msg = extractCpanelErrorFromResponse(err, eff) || err.message
    log(`[cPanel Proxy] uapiViaSession exception for ${cpUser} (${module}::${func}): (${status || 'no-status'}) ${msg}`)
    return { status: 0, errors: [sanitizeString(String(msg), eff)], data: null, httpStatus: status || null, via: 'session-exception' }
  }
}

// ─── WHM-root multipart upload fallback ──────────────────────────────
//
// When user-level UAPI upload_files fails with 401/403 (stale cpPass /
// cPanel session-security lockout — 2026-08-26 @HHR2009 / nnliae74), retry
// the upload via WHM's /json-api/cpanel gateway authenticated as root, with
// cpanel_jsonapi_user=<user> to impersonate. Uses multipart POST (same body
// shape as user-level upload_files) and returns a normalized
// { status, data, errors, via } shape so callers can treat it identically.
//
// Requires process.env.WHM_TOKEN and a whmHost. Returns a canonical failure
// shape if either is missing so callers can log + report cleanly.
async function uploadFileAsRoot(cpUser, dir, fileName, fileBuffer, whmHost) {
  const whmToken = process.env.WHM_TOKEN
  if (!whmToken || !whmHost) {
    return { status: 0, errors: ['WHM root fallback not configured (missing WHM_TOKEN or whmHost)'], data: null, via: 'whm-root-unavailable' }
  }
  // Resolve WHM base URL: prefer WHM_API_URL (Cloudflare tunnel) when the
  // account is pinned to the primary WHM_HOST — matches _resolveWhmBaseUrl in
  // cpanel-routes.js.
  const whmApiUrl = process.env.WHM_API_URL
  const useTunnel = whmApiUrl && whmHost === process.env.WHM_HOST
  const base = useTunnel ? `${whmApiUrl.replace(/\/+$/, '')}/json-api` : `https://${whmHost}:2087/json-api`
  const url = `${base}/cpanel`

  const form = new FormData()
  form.append('dir', dir)
  form.append('file-1', fileBuffer, { filename: fileName })

  const cfAccess = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) ? {
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
  } : {}

  try {
    const res = await axios.post(url, form, {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUser,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'upload_files',
      },
      headers: {
        Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${whmToken}`,
        ...form.getHeaders(),
        ...cfAccess,
      },
      httpsAgent,
      timeout: 120000,
      maxContentLength: 100 * 1024 * 1024,
    })
    const body = sanitize(res.data, whmHost)
    // WHM wraps UAPI result under `result:`. Accept either shape.
    const inner = body?.result || body?.cpanelresult || body || {}
    const uploaded = inner?.data?.uploads?.uploaded
    const succeeded = Array.isArray(uploaded)
      ? uploaded.some(u => u && (u.status === 1 || u.uploaded === 1))
      : (inner?.status === 1 || inner?.data?.uploaded === 1)
    if (succeeded) {
      return { status: 1, data: inner.data || null, errors: null, via: 'whm-root' }
    }
    const reason = inner?.errors?.[0] || inner?.error || 'WHM root upload also failed'
    return { status: 0, errors: [sanitizeString(String(reason), whmHost)], data: null, via: 'whm-root-failed' }
  } catch (err) {
    const status = err.response?.status
    const msg = extractCpanelErrorFromResponse(err, whmHost) || err.message
    log(`[cPanel Proxy] WHM-root upload_files error (${status || 'no-status'}): ${msg}`)
    return { status: 0, errors: [sanitizeString(String(msg), whmHost)], data: null, httpStatus: status || null, via: 'whm-root-exception' }
  }
}

module.exports = {
  uapi,
  uploadFile,
  // Files
  listFiles,
  getFileContent,
  saveFileContent,
  createDirectory,
  deleteFile,
  renameFile,
  extractFile,
  compressFiles,
  copyFile,
  moveFile,
  // Domains
  listDomains,
  addAddonDomain,
  removeAddonDomain,
  
  changeDomainDocRoot,
  // Subdomains
  listSubdomains,
  createSubdomain,
  deleteSubdomain,
  // Email
  listEmailAccounts,
  createEmailAccount,
  deleteEmailAccount,
  changeEmailPassword,
  
  
  // Stats
  getQuotaInfo,
  getBandwidthData,
  // SSL
  getSSLStatus,
  // MySQL
  listDatabases,
  listDatabaseUsers,
  createDatabase,
  deleteDatabase,
  renameDatabase,
  checkDatabase,
  repairDatabase,
  createDatabaseUser,
  deleteDatabaseUser,
  setDatabaseUserPassword,
  renameDatabaseUser,
  setUserPrivilegesOnDatabase,
  revokeUserPrivilegesOnDatabase,
  listMysqlRemoteHosts,
  addMysqlRemoteHost,
  deleteMysqlRemoteHost,
  // Health hooks
  setAdminNotifier,
  isControlPlaneDown,
  
  // Diagnostics (surfaced for tests + route-level fallback logic)
  extractCpanelErrorFromResponse,
  looksLikeUapiPermFailure,
  looksLikeAuthFailure,
  // Low-level API2 caller — surfaced so tests can assert the "HTTP 200 +
  // login-page HTML" → CPANEL_AUTH_FAILURE normalisation directly (uapi is
  // already exported above).
  api2,
  sanitizeCpanelFileName,
  // WHM-root multipart upload fallback (2026-08-26 @HHR2009 /nnliae74 fix)
  uploadFileAsRoot,
  // WHM impersonation-session upload — definitive fix for cpsrvd-denies-basic-auth
  // (2026-08-26 @HHR2009 /nnliae74 final fix, superseded uploadFileAsRoot in routes)
  uploadFileViaSession,
  // Generic UAPI over a WHM cpsession — file get/save fallback via CPANEL_API_URL
  // tunnel (2026-08-31 fix: the routes' inline session helper hit the origin IP → 30s timeout)
  uapiViaSession,
  // WHM-root impersonation fallbacks — authenticate as root + impersonate the
  // user, bypassing a stale/rotated user cpPass. Surfaced so the reseller API
  // (js/reseller-hosting-mgmt.js) can heal File-Manager/SSL CPANEL_AUTH_FAILURE
  // the same way the HostPanel already does (2026 reseller File Manager/SSL bug).
  uapiViaWhmRoot: _uapiViaWhmRoot,   // UAPI / api3  (list_files, SSL::installed_hosts, get_file_content)
  api2ViaWhmRoot: _api2ViaWhmRoot,   // API2         (Fileman::mkdir, Fileman::fileop extract/copy/move/rename/compress)
  // EPERM (broken homedir/quota) — UX + ops alerting
  getEpermUserMessage,
  getEpermLocalizedMessages,
  buildEpermOpsAlert,
  alertEpermRepairNeeded,
}
