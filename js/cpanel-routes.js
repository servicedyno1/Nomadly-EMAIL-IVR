/* global process */
/**
 * cPanel Panel Routes
 * Express routes for the cPanel management frontend.
 * All routes prefixed with /panel
 */

const express = require('express')
const multer = require('multer')
const nodemailer = require('nodemailer')
const cpAuth = require('./cpanel-auth')
const cpProxy = require('./cpanel-proxy')
const cfService = require('./cf-service')
const safeBrowsing = require('./safe-browsing-service')
const whmService = require('./whm-service')
const { log } = require('console')
const { translation } = require('./translation')

/**
 * Resolve user's preferred language for localised notifications.
 */
async function getUserLang(account) {
  try {
    const db = require('./_index')?._db || require('./_index')?.db
    if (!db || !account?.chatId) return 'en'
    const userState = await db.collection('state').findOne({ _id: String(account.chatId) })
    return userState?.userLanguage || 'en'
  } catch (_) { return 'en' }
}

// ── Debounced anti-red protection restore after destructive File-Manager ops ──
// Panel deletes / folder-removals / zip extracts can wipe the root protection
// files (.user.ini + .antired-challenge.php). CONFIRMED on secuec3b
// (securitedesjardins.com) 2026-06-21: repeated folder deletes + zip re-extracts
// left both files MISSING (heartbeat DIAG), the hourly heartbeat fell behind, then
// gave up (stuck_repair_loop) → site served the cloak 404 to its owner.
// Only `/files/extract` re-deployed protection before; `/files/delete` did NOT.
// We now restore within seconds of the user's LAST destructive op (debounced so a
// burst of ops coalesces into one WHM redeploy).
const _protectionRestoreTimers = new Map()
const PROTECTION_RESTORE_DEBOUNCE_MS = parseInt(process.env.PANEL_PROTECTION_RESTORE_DEBOUNCE_MS || '15000', 10)
let _restoreRunner = null // test hook (see __setRestoreRunnerForTest)

function isPublicHtmlPath(p) {
  return typeof p === 'string' && p.includes('public_html')
}

function scheduleProtectionRestore(cpUser, reason) {
  if (!cpUser) return
  const existing = _protectionRestoreTimers.get(cpUser)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    _protectionRestoreTimers.delete(cpUser)
    try {
      if (_restoreRunner) { await _restoreRunner(cpUser, reason); return }
      const antiRed = require('./anti-red-service')
      // force: bypass idempotency cache — the customer just modified files in
      // public_html (delete/extract/save), so the cached sig is stale.
      await antiRed.deployCFIPFix(cpUser, { force: true })
      log(`[Panel] Auto-restored anti-red protection after ${reason} (user: ${cpUser})`)
    } catch (e) {
      log(`[Panel] Auto-restore anti-red failed for ${cpUser} after ${reason}: ${e.message}`)
    }
  }, PROTECTION_RESTORE_DEBOUNCE_MS)
  if (typeof timer.unref === 'function') timer.unref()
  _protectionRestoreTimers.set(cpUser, timer)
}

// Test-only: inject a fake restore runner so the debounce can be unit-tested
// without hitting WHM. Returns a disposer that restores the real runner.
function __setRestoreRunnerForTest(fn) { _restoreRunner = fn; return () => { _restoreRunner = null } }

/**
 * Robust ownership check for a domain against a chatId.
 *
 * `domainsOf` is keyed by `{ _id: <chatId>, "<domain@com>": true }` (legacy schema).
 * The old check that compared `domOf.chatId === chatId` always returned false because
 * the doc is *keyed* by chatId rather than carrying a `chatId` field.
 * `registeredDomains.val.chatId` is also frequently missing on older records.
 *
 * This helper accepts any of the historical shapes:
 *   1. `domainsOf` doc keyed by chatId with `<dom@tld>: true`
 *   2. `domainsOf` doc keyed by domain with explicit chatId field (newer code)
 *   3. `registeredDomains.val.chatId === chatId`
 */
async function isDomainOwnedByChat(db, domain, chatId) {
  if (!db || !domain || !chatId) return false
  const cid = String(chatId)
  try {
    // Newer schema: per-domain doc keyed by domain in either collection
    const [regDom, domOfByDomain] = await Promise.all([
      db.collection('registeredDomains').findOne({ _id: domain }),
      db.collection('domainsOf').findOne({ _id: domain }),
    ])
    if (regDom?.val?.chatId && String(regDom.val.chatId) === cid) return true
    if (domOfByDomain?.chatId && String(domOfByDomain.chatId) === cid) return true

    // Legacy schema: per-user doc keyed by chatId with `domain@tld: true` fields
    const legacyKey = domain.replace(/\./g, '@')
    const domOfByUser = await db.collection('domainsOf').findOne({ _id: cid })
    if (domOfByUser && domOfByUser[legacyKey] === true) return true
  } catch (_) {}
  return false
}


// ─── WHM-root fallback helpers ─────────────────────────────
//
// Both /files/delete and /files/mkdir need to fall back to a root-level
// WHM call (impersonating the cPanel user) when the user-level API2 call
// fails — typically with a "uapi exited status 1 (EPERM)" style error
// caused by a broken account shell/homedir. See @hellpeaces (5522767823)
// 2026-07-06 for the incident that motivated extracting these helpers.
// Consolidated here so future ops (rename/copy/move) can reuse the same
// wiring without another copy-paste.

// Resolve the WHM base URL. Prefer WHM_API_URL (tunnel) when the account
// lives on the default shared host — direct IP:2087 is firewalled by the
// DO lockdown. Resellers on their own box get direct :2087 via their
// custom hostname.
function _resolveWhmBaseUrl(whmHost) {
  const whmApiUrl = process.env.WHM_API_URL
  if (whmApiUrl && whmHost === process.env.WHM_HOST) {
    return `${whmApiUrl.replace(/\/+$/, '')}/json-api`
  }
  return `https://${whmHost}:2087/json-api`
}

// Build a configured axios client for WHM /json-api calls. Returns null if
// WHM credentials aren't available (caller should skip the fallback).
function _makeWhmApi(whmHost) {
  const whmToken = process.env.WHM_TOKEN
  if (!whmHost || !whmToken) return null
  const https = require('https')
  const axios = require('axios')
  return axios.create({
    baseURL: _resolveWhmBaseUrl(whmHost),
    headers: {
      Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${whmToken}`,
      ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
        'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
      } : {}),
    },
    timeout: 30000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  })
}


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

// ─── Shared: broken-homedir EPERM reply ─────────────────────────────────
// `"/usr/local/cpanel/uapi" exited with status 1 (EPERM)` (broken account
// homedir / quota accounting) breaks ALL File Manager ops equally —
// create/open folder, delete, extract, etc. When a route (and its WHM
// fallback) hits this class, page ops once (throttled, with the exact repair
// command) and return a calm localized message + code:'CPANEL_UAPI_EPERM'
// instead of a raw "500 …EPERM". The frontend maps the code to a friendly
// toast. Motivated by @hellpeaces (5522767823) — the raw error + no ops page
// let a broken account fester ~2 weeks.
function _isEpermReason(reason) {
  return !!(cpProxy.looksLikeUapiPermFailure && cpProxy.looksLikeUapiPermFailure(String(reason || '')))
}

// User-level cPanel Basic Auth broken? 401 / 403 → try the WHM-root
// impersonation fallback ladder (same as EPERM). Dominant real-world cause
// is a stale cached cpPass (password rotated on cPanel side without a
// re-sync into our encrypted store) — 2026-08-26 @HHR2009 / nnliae74:
// mkdir 403 "Access denied", list_files/upload_files 401, ProtectionHeartbeat
// silently degraded to "empty content after 3 retries" every hour since
// 2026-08-24. Also covers cpHulk/ModSecurity lockouts + cPanel session
// policy blocks. Cheap safety net: WHM-root uses WHM_TOKEN + impersonation
// (`cpanel_jsonapi_user=X`) which sidesteps the user's password entirely.
function _isAuthBroken(result) {
  if (!result) return false
  if (result.code === 'CPANEL_AUTH_FAILURE') return true
  if (result.httpStatus === 401 || result.httpStatus === 403) return true
  const first = Array.isArray(result.errors) ? result.errors[0] : (result.error || '')
  // cPanel login-page HTML returned as error body (no httpStatus in proxied results)
  if (typeof first === 'string' && /<!DOCTYPE html>/i.test(first)) return true
  return !!(cpProxy.looksLikeAuthFailure && cpProxy.looksLikeAuthFailure(result.httpStatus, String(first || '')))
}

// ─── Shared WHM-root impersonation callers for File Manager routes ─────
//
// The mkdir / list_files / delete / extract / upload routes already retry
// via WHM-root when the user-level API returns 401/403 or an EPERM login
// page. This helper generalises that so /files/content, /files/save,
// /files/rename, /files/move, /files/copy, /files/compress can share the
// exact same fallback ladder without another dozen copy-pastes.
//
// Motivated by @Devils_gods (chatId 1446310286, cpUser auth62f9,
// 2026-08-30): every file-list call succeeded via WHM fallback (already
// wired), but clicking Edit on a real file surfaced `<!DOCTYPE html>` in
// the code editor (get_file_content had no fallback → cpsrvd returned
// the login page HTML with HTTP 200) and every move attempt silently
// returned "Access denied" [AUTH] (fileop had no fallback).
async function _uapiViaWhmRoot(whmApi, cpUser, module, func, params) {
  const r = await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUser,
      cpanel_jsonapi_apiversion: 3,
      cpanel_jsonapi_module: module,
      cpanel_jsonapi_func: func,
      ...params,
    },
  })
  // WHM's json-api wraps UAPI (api3) responses under `result`.
  const cp = r.data?.result || r.data || {}
  const ok = cp.status === 1 || cp.status === '1'
  return {
    status: ok ? 1 : 0,
    data: cp.data ?? null,
    errors: cp.errors || null,
    messages: cp.messages || null,
    metadata: cp.metadata || null,
    reason: (Array.isArray(cp.errors) && cp.errors[0]) || cp.error || null,
  }
}

// WHM session-based UAPI call — creates a user session and POSTs
// to the cPanel UAPI endpoint. Required for functions like
// save_file_content and get_file_content which don't work properly
// via the WHM GET /json-api/cpanel wrapper (content params get mangled
// in query strings or file reads return empty).
async function _uapiViaWhmSession(whmApi, cpUser, module, func, params, method = 'POST') {
  // Step 1: create user session
  const sessRes = await whmApi.get('/create_user_session', {
    params: { 'api.version': 1, user: cpUser, service: 'cpaneld' },
  })
  const sessionUrl = sessRes.data?.data?.url
  if (!sessionUrl) throw new Error('WHM create_user_session returned no URL')

  // Step 2: Use session URL to call UAPI directly via cPanel
  const baseUrl = sessionUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/execute/${module}/${func}`
  const axiosOpts = {
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    timeout: 30000,
    maxRedirects: 5,
  }

  let res
  if (method === 'POST') {
    res = await require('axios').post(url, new URLSearchParams(params).toString(), {
      ...axiosOpts,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  } else {
    res = await require('axios').get(url, { ...axiosOpts, params })
  }

  const data = res.data || {}
  return {
    status: data.status === 1 ? 1 : 0,
    data: data.data ?? null,
    errors: data.errors || null,
    messages: data.messages || null,
    metadata: data.metadata || null,
    reason: (Array.isArray(data.errors) && data.errors[0]) || data.error || null,
  }
}

async function _fileopViaWhmRoot(whmApi, cpUser, op, params) {
  const r = await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUser,
      cpanel_jsonapi_apiversion: 2,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'fileop',
      doubledecode: 0,
      op,
      ...params,
    },
  })
  const cp = r.data?.cpanelresult || {}
  const dataArr = Array.isArray(cp.data) ? cp.data : []
  const ok = (dataArr[0]?.result === 1) || cp.event?.result === 1
  return {
    ok,
    dataArr,
    reason: dataArr[0]?.reason || cp.error || (ok ? null : 'WHM fallback also failed'),
  }
}

// ─── Self-healing cpPass rotation for CPANEL_AUTH_FAILURE ─────────────
//
// When the user's cached cpPass in Mongo no longer matches the real cPanel
// account password on WHM, every user-level HTTP Basic Auth call fails
// (UAPI /execute/... → 401 login page, API2 /json-api/cpanel → 403
// "Access denied"). WHM-root impersonation via /json-api/cpanel with
// cpanel_jsonapi_user=X handles this for GET-only ops (list, mkdir, extract,
// delete) because those pass all params in the query string. But
// Fileman::upload_files needs a MULTIPART BODY, and WHM's json-api gateway
// silently drops multipart bodies before forwarding to the underlying
// cPanel context — 22:54:27Z 2026-08-26 log:
//     [Panel] Chunk upload WHM-root fallback failed: setup_Unassigned.msi
//     → /home/nnliae74/public_html/AteraInvite/evite-source — "You must
//     specify at least one file to upload."
// The correct fix is not to work around the gateway, but to *repair* the
// stale cpPass. Use WHM /passwd (root token) to rotate the account password
// to a freshly-generated one, save it AES-GCM-encrypted to Mongo, and let
// the caller retry the ORIGINAL user-level UAPI call with the new pass —
// same code path, no multipart-through-gateway surface.
//
// Idempotent, rate-limited: at most 1 rotation per 60 min per account so we
// don't churn on transient blips (e.g. a cPHulk 5-min lockout that would
// clear on its own). If we're inside the cool-down window and the CACHED
// pass is still failing, we return `{ ok: false, reason: 'cooling-down' }`
// so the caller can return a clean error to the user.
//
// Returns:
//   { ok: true,  cpPass: '<plaintext>', rotated: true  }  — just rotated
//   { ok: true,  cpPass: '<plaintext>', rotated: false, reason: 'cool-down' } — recently rotated, reuse
//   { ok: false, error: '<reason>' }                     — repair failed
// Terminal-failure detection for WHM /passwd. A "suspended" (or locked/
// disabled) account can NEVER be repaired by a password rotation — WHM refuses
// because /passwd would unsuspend it. Callers back off instead of thrashing.
function _isTerminalPasswdReason(reason) {
  const r = String(reason || '').toLowerCase()
  return /suspend|would unsuspend|account is (locked|disabled)|is (locked|disabled)/.test(r)
}

async function _repairCpPass(getCpanelCol, cpUser, whmHost) {
  const crypto = require('crypto')
  const cpAuth = require('./cpanel-auth')
  // Configurable cool-down (minutes). Default 60. Bumped via
  // CPPASS_ROTATION_COOLDOWN_MIN so we can tune without a deploy —
  // useful if WHM's cPHulk lockout window changes or we see churn
  // on a single account.
  const cooldownMin = parseInt(process.env.CPPASS_ROTATION_COOLDOWN_MIN || '60', 10)
  const COOL_DOWN_MS = (Number.isFinite(cooldownMin) && cooldownMin > 0 ? cooldownMin : 60) * 60 * 1000

  const col = getCpanelCol()
  if (!col || !col.findOne) return { ok: false, error: 'accounts collection unavailable' }
  const doc = await col.findOne({ _id: cpUser.toLowerCase() })
  if (!doc) return { ok: false, error: 'account not found in Mongo' }

  // Terminal-state back-off: if a previous attempt found the account SUSPENDED
  // (or otherwise unfixable by a password rotation), don't thrash WHM + the
  // logs on every request. A rotation literally CANNOT succeed while the
  // account is suspended — WHM refuses /passwd because it would unsuspend the
  // account. Back off for CPPASS_SUSPENDED_COOLDOWN_MIN (default 6h) and stay
  // silent until it expires (prod log: ghrx51df thrashed 38×/48h).
  const suspMin = parseInt(process.env.CPPASS_SUSPENDED_COOLDOWN_MIN || '360', 10)
  const SUSPEND_COOL_MS = (Number.isFinite(suspMin) && suspMin > 0 ? suspMin : 360) * 60 * 1000
  const suspendedAt = doc.cpPassSuspendedAt ? new Date(doc.cpPassSuspendedAt).getTime() : 0
  if (suspendedAt && Date.now() - suspendedAt < SUSPEND_COOL_MS) {
    return { ok: false, error: 'account suspended — rotation skipped (cooling down)', terminal: true, suppressed: true }
  }

  // Cool-down: if we just rotated within COOL_DOWN_MS, don't rotate again —
  // just return the current cached pass. This keeps the caller from thrashing
  // on a persistent WHM-side lockout (cPHulk, ModSecurity IP ban, etc.)
  // that a rotation can't fix.
  const rotatedAt = doc.cpPassRotatedAt ? new Date(doc.cpPassRotatedAt).getTime() : 0
  if (Date.now() - rotatedAt < COOL_DOWN_MS) {
    try {
      const cpPass = cpAuth.decrypt({ encrypted: doc.cpPass_encrypted, iv: doc.cpPass_iv, tag: doc.cpPass_tag })
      const minsLeft = Math.ceil((COOL_DOWN_MS - (Date.now() - rotatedAt)) / 60000)
      return { ok: true, cpPass, rotated: false, reason: `cool-down (${minsLeft}m left since last rotate)` }
    } catch (e) {
      return { ok: false, error: `decrypt of cached pass failed: ${e.message}` }
    }
  }

  // Generate a strong ASCII password. WHM /passwd rejects some special
  // characters via URL-encoding quirks, so stick to [A-Za-z0-9] which is
  // safe everywhere. 24 chars @ 62-alphabet ≈ 143 bits entropy.
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const buf = crypto.randomBytes(32)
  let newPass = ''
  for (let i = 0; i < 24; i++) newPass += alphabet[buf[i] % alphabet.length]

  // Rotate on WHM (root token → /passwd). db_pass_update=0 because we don't
  // want to touch any bound MySQL user passwords — those are managed
  // separately and rotating them could break the customer's live site.
  const whmApi = _makeWhmApi(whmHost || process.env.WHM_HOST)
  if (!whmApi) return { ok: false, error: 'WHM API unavailable (no WHM_TOKEN or whmHost)' }
  try {
    const res = await whmApi.get('/passwd', {
      params: { 'api.version': 1, user: cpUser, password: newPass, db_pass_update: 0 },
    })
    const ok = res.data?.metadata?.result === 1
    if (!ok) {
      const reason = res.data?.metadata?.reason || res.data?.data?.reason || 'WHM /passwd returned failure'
      if (_isTerminalPasswdReason(reason)) {
        // Suspended / terminal state — a password rotation can NEVER fix this
        // (WHM refuses because /passwd would unsuspend the account). Stamp a
        // back-off marker so we stop thrashing WHM + logs every request, and
        // log the reason exactly ONCE per back-off window.
        try {
          await col.updateOne(
            { _id: cpUser.toLowerCase() },
            { $set: { cpPassSuspendedAt: new Date(), cpPassLastSuspendReason: reason } }
          )
        } catch (_) { /* marker is best-effort */ }
        log(`[Panel] Self-heal: cpPass rotation SKIPPED for ${cpUser} — terminal state ("${reason}"); rotation cannot fix, backing off ${Math.round(SUSPEND_COOL_MS / 60000)}m`)
        return { ok: false, error: reason, terminal: true }
      }
      log(`[Panel] Self-heal: cpPass rotation FAILED for ${cpUser} — ${reason}`)
      return { ok: false, error: reason }
    }
  } catch (err) {
    const status = err.response?.status
    log(`[Panel] Self-heal: cpPass rotation exception for ${cpUser} (${status || 'no-status'}): ${err.message}`)
    return { ok: false, error: `WHM /passwd exception: ${err.message}` }
  }

  // Persist the new pass. AES-GCM via cpanel-auth so the login flow and any
  // other consumer that reads cpPass_encrypted stays in sync.
  const encPass = cpAuth.encrypt(newPass)
  try {
    await col.updateOne(
      { _id: cpUser.toLowerCase() },
      { $set: {
        cpPass_encrypted: encPass.encrypted,
        cpPass_iv: encPass.iv,
        cpPass_tag: encPass.tag,
        cpPassRotatedAt: new Date(),
        cpPassLastRotateReason: 'CPANEL_AUTH_FAILURE',
      },
        // Account is clearly no longer suspended if WHM accepted the rotation —
        // clear the back-off marker so future heals aren't suppressed.
        $unset: { cpPassSuspendedAt: '', cpPassLastSuspendReason: '' } }
    )
  } catch (err) {
    log(`[Panel] Self-heal: cpPass rotated on WHM but Mongo update FAILED for ${cpUser} — ${err.message}`)
    return { ok: false, error: `Mongo update failed after WHM rotate: ${err.message}` }
  }

  log(`[Panel] Self-heal: rotated cpPass for ${cpUser} (WHM was rejecting cached pass with 401/403 — @HHR2009 pattern)`)
  return { ok: true, cpPass: newPass, rotated: true }
}

// ─── Self-heal wiring: rotate a stale cpPass on the first auth-broken hit ──
//
// When a user-level cPanel call fails with a broken-Basic-Auth signature
// (_isAuthBroken → 401/403 login-page HTML / CPANEL_AUTH_FAILURE), rotate the
// account password ONCE via the proven _repairCpPass primitive, persist it
// AES-GCM-encrypted to Mongo, and retry the SAME user-level call with the
// fresh pass. Because resolveCpPass reads the pass fresh from Mongo on every
// request, one successful heal means every SUBSEQUENT panel request uses the
// healthy pass — no more WHM-root detour on each call.
//
// SAFETY: production-gated. Dev/sandbox pods share the PRODUCTION Mongo + WHM
// token, so they must NEVER rotate a real customer's cPanel password. When
// BOT_ENVIRONMENT!=='production' (or SKIP_WEBHOOK_SYNC==='true') the heal is a
// no-op and the existing WHM-root fallback handles the request exactly as
// before. Idempotent per request (req._selfHealAttempted) and rate-limited to
// 1 rotation / 60 min / account inside _repairCpPass (cPHulk-churn safe).
// `repairFn` is injectable purely so unit tests can exercise the control-flow
// without touching WHM/Mongo.
async function _selfHealCpPass(req, getCpanelCol, repairFn = _repairCpPass) {
  if (req._selfHealAttempted) return !!req._selfHealOk
  req._selfHealAttempted = true

  if (process.env.BOT_ENVIRONMENT !== 'production' || process.env.SKIP_WEBHOOK_SYNC === 'true') {
    log(`[Panel] Self-heal SKIPPED for ${req.cpUser} (non-production sandbox — must not rotate prod cpPass)`)
    req._selfHealOk = false
    return false
  }

  try {
    const repair = await repairFn(getCpanelCol, req.cpUser, req.whmHost)
    if (repair && repair.ok) {
      // Adopt the new (or cool-down cached) pass for the retry + any later op
      // in this request. Only report "healed" when we actually ROTATED — during
      // cool-down the cached pass is unchanged and may still be failing.
      if (repair.cpPass) req.cpPass = repair.cpPass
      req._selfHealOk = !!repair.rotated
      if (repair.rotated) {
        log(`[Panel] Self-heal: repaired cpPass for ${req.cpUser} — user-level auth restored; future calls skip the WHM-root detour`)
      } else {
        log(`[Panel] Self-heal: rotation skipped for ${req.cpUser} — ${repair.reason || 'cool-down'}`)
      }
      return req._selfHealOk
    }
    // Suppress the generic "repair failed" noise for terminal/suspended
    // accounts — _repairCpPass already logged a concise one-time reason and is
    // now backing off, so repeating it on every request just spams the logs.
    if (!(repair && (repair.suppressed || repair.terminal))) {
      log(`[Panel] Self-heal: cpPass repair failed for ${req.cpUser} — ${(repair && repair.error) || 'unknown'}`)
    }
    req._selfHealOk = false
    return false
  } catch (e) {
    log(`[Panel] Self-heal exception for ${req.cpUser}: ${e.message}`)
    req._selfHealOk = false
    return false
  }
}

// Run a user-level cPanel call; on a broken-auth failure, self-heal the cpPass
// and retry ONCE with the fresh pass. Returns the (possibly retried) result;
// if it's still broken the caller's existing WHM-root fallback takes over.
// `doCall(pass)` issues the user-level call → cPanel-shaped result ({status:1}
// on success). `selfHeal()` resolves true only when it actually rotated.
async function _userCallWithHeal(req, doCall, selfHeal) {
  const result = await doCall(req.cpPass)
  if (result?.status === 1 || !_isAuthBroken(result)) return result
  const healed = await selfHeal()
  if (healed) return doCall(req.cpPass)
  return result
}

// Write-route variant: wraps a user-level WRITE call (upload, mkdir, rename,
// delete …) with the same self-heal-and-retry pattern, but gated behind the
// CPANEL_SELFHEAL_WRITES=1 feature flag so we can roll it out gradually.
// When the flag is OFF, this is a straight passthrough → identical to the
// pre-existing behaviour (direct cpProxy call). When ON, an auth-broken
// return value triggers _repairCpPass, and the call is retried once with the
// fresh pass. Existing route-level WHM-root / session fallbacks still run
// after this wrapper if the retry itself fails, so this ONLY adds recovery,
// never removes it.
async function _userWriteCallWithHeal(req, getCpanelCol, doCall) {
  if (process.env.CPANEL_SELFHEAL_WRITES !== '1') return doCall(req.cpPass)
  return _userCallWithHeal(req, doCall, () => _selfHealCpPass(req, getCpanelCol))
}

function _replyEperm(res, req, op) {
  cpProxy.alertEpermRepairNeeded({
    op,
    cpUser: req.cpUser,
    domain: req.cpDomain,
    whmHost: req.whmHost || process.env.WHM_HOST,
  })
  log(`[Panel] ${op} blocked by broken-homedir EPERM (user: ${req.cpUser}) — ops paged, friendly message returned`)
  return res.json({
    status: 0,
    code: 'CPANEL_UAPI_EPERM',
    error: cpProxy.getEpermUserMessage('en'),
    errors: [cpProxy.getEpermUserMessage('en')],
    localizedMessages: cpProxy.getEpermLocalizedMessages(),
    via: 'eperm',
  })
}

function createCpanelRoutes(getCpanelCol, opts = {}) {
  const router = express.Router()
  const notifier = (opts && typeof opts.notifyAdmin === 'function') ? opts.notifyAdmin : (() => {})

  // ─── Auth Middleware ────────────────────────────────────

  function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = authHeader.split(' ')[1]
    const decoded = cpAuth.verifyToken(token)
    if (!decoded) {
      return res.status(401).json({ error: 'Session expired. Please login again.' })
    }
    req.cpUser = decoded.cpUser
    req.cpDomain = decoded.domain
    req.cpChatId = decoded.chatId
    next()
  }

  // Resolve cPanel password from encrypted storage
  async function resolveCpPass(req, res, next) {
    try {
      const col = getCpanelCol()
      if (!col || !col.findOne) return res.status(503).json({ error: 'Service starting up, try again shortly.' })
      const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
      if (!account) return res.status(401).json({ error: 'Account not found' })

      req.cpPass = cpAuth.decrypt({
        encrypted: account.cpPass_encrypted,
        iv: account.cpPass_iv,
        tag: account.cpPass_tag,
      })
      // Per-account WHM host — accounts created on different servers keep their original host
      req.whmHost = account.whmHost || null
      // Plan info & helper flag for Gold-gated features (Visitor Captcha)
      req.cpPlan = account.plan || ''
      req.cpAddonDomains = (account.addonDomains || []).map(a => (typeof a === 'string' ? a : a?.domain || '')).filter(Boolean)
      req.cpIsGold = /Golden Anti-Red HostPanel/i.test(req.cpPlan)
      // Monthly-plan flag for the Honeypot Traps self-service toggle (weekly = locked)
      try { req.cpIsMonthly = !require('./hosting-scheduler').isWeeklyPlan(req.cpPlan) } catch (_) { req.cpIsMonthly = true }
      next()
    } catch (err) {
      log(`[Panel] Credential resolve error: ${err.message}`)
      return res.status(500).json({ error: 'Authentication error' })
    }
  }

  const auth = [authMiddleware, resolveCpPass]

  // ─── Login ──────────────────────────────────────────────

  router.post('/login', async (req, res) => {
    const { username, pin } = req.body
    if (!username || !pin) return res.status(400).json({ error: 'Username and PIN are required.' })

    const col = getCpanelCol()
    if (!col || !col.findOne) return res.status(503).json({ error: 'Service starting up, try again shortly.' })

    const result = await cpAuth.login(col, username, pin)
    if (!result.success) {
      // Backend-authoritative rate-limit response: HTTP 429 + Retry-After header
      // so the frontend can render an exact countdown without trusting localStorage.
      if (result.rateLimited) {
        if (result.lockedSeconds) res.set('Retry-After', String(result.lockedSeconds))
        return res.status(429).json({
          error: result.error,
          rateLimited: true,
          lockedSeconds: result.lockedSeconds,
          lockedMinutes: result.lockedMinutes,
          lockedUntil: result.lockedUntil,
        })
      }
      return res.status(401).json({
        error: result.error,
        attemptsRemaining: result.attemptsRemaining,
      })
    }

    res.json({
      token: result.token,
      username: result.cpUser,
      domain: result.domain,
      isGold: /Golden Anti-Red HostPanel/i.test(result.plan || ''),
      plan: result.plan || '',
    })
  })

  // Verify session
  router.get('/session', authMiddleware, async (req, res) => {
    // Re-load plan from Mongo so the flag is always fresh (the token doesn't
    // carry plan info — a user who got upgraded to Gold mid-session should
    // see the new flag without re-logging-in).
    let isGold = false
    let plan = ''
    try {
      const col = getCpanelCol()
      if (col && col.findOne) {
        const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
        plan = account?.plan || ''
        isGold = /Golden Anti-Red HostPanel/i.test(plan)
      }
    } catch (_) { /* fall through with defaults */ }
    res.json({ username: req.cpUser, domain: req.cpDomain, isGold, plan })
  })

  // ─── File Manager ──────────────────────────────────────

  // Protected anti-red files that users should not modify/delete
  const PROTECTED_FILES = ['.htaccess', '.user.ini', '.antired-challenge.php']

  function isProtectedAntiRedFile(dir, file) {
    // Only protect files in the public_html root directory
    const isPublicHtml = dir && (dir.endsWith('/public_html') || dir.endsWith('/public_html/'))
    return isPublicHtml && PROTECTED_FILES.includes(file)
  }

  router.get('/files', ...auth, async (req, res) => {
    const dir = req.query.dir || `/home/${req.cpUser}/public_html`
    let result = await _userCallWithHeal(req, (pass) => cpProxy.listFiles(req.cpUser, pass, dir, req.whmHost), () => _selfHealCpPass(req, getCpanelCol))

    // ── EPERM / user-auth broken handling — parity with /files/mkdir and /files/extract ──
    // (@HHR2009 2026-08-04 — chatId 1960615421: cpUser papea895 on WHM
    // 68.183.77.106 was getting `"/usr/local/cpanel/uapi" exited with
    // status 1 (EPERM)` for Fileman::list_files. The user simply saw a
    // File Manager that "wasn't allowing" him to browse. The existing
    // handler DID return a friendly message BUT:
    //   1. No WHM-root fallback was tried (mkdir/delete/extract all do this
    //      and it typically recovers from a transient quota-accounting blip
    //      — a persistent break is much rarer than a transient one).
    //   2. Nothing was logged, so ops had no way to correlate the raw
    //      `[cPanel Proxy] Fileman::list_files error (500): ...[EPERM]`
    //      line to which cpUser was affected → 9 EPERM errors in 36 min
    //      for HHR2009 with zero audit trail.
    // Fix: mirror the mkdir/extract WHM-root-fallback + retry ladder, and
    // route the persistent-EPERM tail through `_replyEperm` so it logs +
    // pages ops with the exact repair command and the affected cpUser.
    // 2026-08-26 update: also fall back on 401 (@HHR2009/nnliae74 —
    // cPanel returning HTML login page for user-level UAPI due to a stale
    // cached cpPass). WHM-root path uses root credentials + impersonation
    // so it succeeds regardless of the user's broken auth.
    const authBrokenList = _isAuthBroken(result)
    const looksBroken = authBrokenList ||
      result?.code === 'CPANEL_UAPI_EPERM' ||
      (result?.httpStatus && result.httpStatus >= 500) ||
      _isEpermReason(result?.errors?.[0])
    if (looksBroken) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        const initialReason = authBrokenList ? 'user-auth-broken' : (result?.errors?.[0] || 'unknown')
        log(`[Panel] list_files user-level failed for ${dir} → WHM fallback (user: ${req.cpUser}, reason: ${initialReason})`)
        const BACKOFFS = [0, 800, 1600]
        let lastReason = initialReason
        for (let i = 0; i < BACKOFFS.length; i++) {
          if (BACKOFFS[i] > 0) await new Promise(r => setTimeout(r, BACKOFFS[i]))
          try {
            const r = await whmApi.get('/cpanel', {
              params: {
                'api.version': 1,
                cpanel_jsonapi_user: req.cpUser,
                cpanel_jsonapi_apiversion: 3,
                cpanel_jsonapi_module: 'Fileman',
                cpanel_jsonapi_func: 'list_files',
                dir,
                include_mime: 1,
                include_permissions: 1,
                include_hash: 0,
                include_content: 0,
                types: 'dir|file',
              },
            })
            const cp = r.data?.result || r.data?.cpanelresult || {}
            const dataArr = Array.isArray(cp.data) ? cp.data : (Array.isArray(r.data?.data) ? r.data.data : [])
            const statusOk = cp.status === 1 || cp.errors == null && Array.isArray(cp.data)
            if (statusOk && Array.isArray(dataArr)) {
              log(`[Panel] list_files succeeded via WHM fallback${i ? ` (retry ${i})` : ''}: ${dir} (user: ${req.cpUser}, ${dataArr.length} entries)`)
              result = { status: 1, data: dataArr, errors: null, metadata: cp.metadata || {}, via: i ? 'whm-fallback-retry' : 'whm-fallback' }
              break
            }
            lastReason = (Array.isArray(cp.errors) && cp.errors[0]) || cp.error || 'WHM fallback also failed'
            // Only worth retrying an EPERM/status-1 class blip.
            if (!_isEpermReason(String(lastReason))) break
            log(`[Panel] list_files WHM fallback EPERM${i < BACKOFFS.length - 1 ? ' — retrying' : ''}: ${dir} (user: ${req.cpUser}) — ${lastReason}`)
          } catch (e) {
            lastReason = e.message
            log(`[Panel] list_files WHM fallback exception: ${e.message} (user: ${req.cpUser})`)
            break
          }
        }
        if (result?.status !== 1 && _isEpermReason(String(lastReason))) {
          return _replyEperm(res, req, 'open folder')
        }
      } else if (result?.code === 'CPANEL_UAPI_EPERM' || _isEpermReason(result?.errors?.[0])) {
        // No WHM credentials available — still page ops + friendly reply.
        return _replyEperm(res, req, 'open folder')
      }
    }
    res.json(result)
  })

  // ─── Anti-Red Protection — user-initiated restore ───────
  //
  // The hourly heartbeat + panel auto-restore-on-extract already handle the
  // common cases automatically. This endpoint is the safety-net for the
  // ~3-5% of scenarios neither covers:
  //   • The customer modified files via FTP/SFTP (bypasses the panel debounce)
  //   • The 3-strike STUCK cooldown is active (6h pause) and the customer
  //     wants to restore NOW instead of waiting
  //   • The last auto-restore failed (WHM 5xx / network blip) and the customer
  //     wants to retry before the next hourly heartbeat tick
  //   • A CMS/cron the customer installed overwrote the protection files
  //
  // Rate-limited to 1 restore / minute / cpUser to prevent click-spam.

  const _antiRedRestoreCooldown = new Map() // cpUser → epoch-ms of next allowed restore
  const ANTI_RED_RESTORE_COOLDOWN_MS = 60 * 1000  // 1 minute

  router.get('/anti-red/status', ...auth, async (req, res) => {
    try {
      const col = getCpanelCol()
      if (!col || !col.findOne) return res.status(503).json({ error: 'Service starting up' })
      const acct = await col.findOne(
        { _id: req.cpUser.toLowerCase() },
        { projection: {
          protectionRepairCount: 1, protectionStuckAt: 1,
          protectionLastUserRestoreAt: 1, protectionUserRestoreCount: 1,
          lastCfIpFixAt: 1,
        }},
      )
      if (!acct) return res.status(404).json({ error: 'Account not found' })

      // Status pill logic:
      //   stuck     — 3-strike threshold tripped, in cooldown
      //   repairing — 1-2 consecutive heartbeat repairs but not stuck yet
      //   active    — everything healthy
      let status = 'active'
      if (acct.protectionStuckAt) status = 'stuck'
      else if ((acct.protectionRepairCount || 0) > 0) status = 'repairing'

      const cooldownUntil = _antiRedRestoreCooldown.get(req.cpUser) || 0
      const cooldownRemainingMs = Math.max(0, cooldownUntil - Date.now())

      res.json({
        status,
        lastRestoredAt: acct.protectionLastUserRestoreAt || acct.lastCfIpFixAt || null,
        userRestoreCount: acct.protectionUserRestoreCount || 0,
        cooldownRemainingMs,
      })
    } catch (e) {
      log(`[Panel] anti-red/status error for ${req.cpUser}: ${e.message}`)
      res.status(500).json({ error: 'Status check failed' })
    }
  })

  router.post('/anti-red/restore', ...auth, async (req, res) => {
    const now = Date.now()
    const nextAllowedAt = _antiRedRestoreCooldown.get(req.cpUser) || 0
    if (now < nextAllowedAt) {
      return res.status(429).json({
        error: 'Please wait a moment before restoring again.',
        retryAfterMs: nextAllowedAt - now,
      })
    }
    _antiRedRestoreCooldown.set(req.cpUser, now + ANTI_RED_RESTORE_COOLDOWN_MS)

    try {
      const antiRed = require('./anti-red-service')
      // force: true — user explicitly asked for restore; never skip the WHM
      // write. (Same option the heartbeat repair path uses post the 2026-06-23
      // fix in STUCK_ALERTS_RCA.md.)
      const r = await antiRed.deployCFIPFix(req.cpUser, { force: true })

      // Reset stuck-loop tracking so the heartbeat doesn't double-alert.
      try {
        const col = getCpanelCol()
        if (col && col.updateOne) {
          await col.updateOne(
            { _id: req.cpUser.toLowerCase() },
            {
              $set: {
                protectionRepairCount: 0,
                protectionStuckAt: null,
                protectionLastSkipReason: null,
                protectionLastUserRestoreAt: new Date(),
              },
              $inc: { protectionUserRestoreCount: 1 },
            },
          )
        }
      } catch (dbErr) {
        // Non-blocking — the WHM write is the user-visible outcome
        log(`[Panel] anti-red restore — DB update failed (continuing) for ${req.cpUser}: ${dbErr.message}`)
      }

      log(`[Panel] User-initiated anti-red restore for ${req.cpUser} → ${r.success ? 'OK' : 'FAIL (' + (r.error || 'unknown') + ')'}`)
      res.json({
        success: !!r.success,
        restoredAt: new Date(),
        error: r.success ? null : (r.error || 'Restore failed — please try again or contact support.'),
      })
    } catch (e) {
      log(`[Panel] anti-red restore fatal for ${req.cpUser}: ${e.message}`)
      // Roll back the cooldown so the user can retry immediately on a genuine error
      _antiRedRestoreCooldown.delete(req.cpUser)
      res.status(500).json({ success: false, error: 'Restore failed. Please try again.' })
    }
  })

  router.get('/files/content', ...auth, async (req, res) => {
    const { dir, file } = req.query
    if (!dir || !file) return res.status(400).json({ error: 'dir and file are required' })
    let result = await _userCallWithHeal(req, (pass) => cpProxy.getFileContent(req.cpUser, pass, dir, file, req.whmHost), () => _selfHealCpPass(req, getCpanelCol))
    // WHM-root fallback on user-auth-broken (2026-08-30 @Devils_gods fix):
    // uapi()'s HTML-in-200 detector normalises the "cpsrvd returned login
    // page instead of file content" case to CPANEL_AUTH_FAILURE — retry the
    // read via WHM-root impersonation so Edit shows the actual file.
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] get_file_content user-level auth-broken → WHM session fallback (user: ${req.cpUser}, file: ${file})`)
          const fb = await cpProxy.uapiViaSession(req.cpUser, 'Fileman', 'get_file_content', { dir, file }, 'GET', req.whmHost)
          if (fb.status === 1) {
            log(`[Panel] get_file_content succeeded via WHM session fallback (user: ${req.cpUser}, file: ${file})`)
            result = { ...fb, via: 'whm-session-fallback' }
          } else {
            // Second attempt: try the plain WHM impersonation as last resort
            log(`[Panel] get_file_content WHM session fallback returned status=0, trying plain WHM (user: ${req.cpUser})`)
            const fb2 = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Fileman', 'get_file_content', { dir, file })
            if (fb2.status === 1) {
              result = { ...fb2, via: 'whm-fallback' }
            } else {
              log(`[Panel] get_file_content all fallbacks failed (user: ${req.cpUser}, file: ${file}) — ${fb.reason || fb2.reason || 'unknown'}`)
            }
          }
        } catch (e) {
          log(`[Panel] get_file_content WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/files/save', express.json({ limit: '50mb' }), ...auth, async (req, res) => {
    const { dir, file, content } = req.body
    if (!dir || !file) return res.status(400).json({ error: 'dir and file are required' })
    if (isProtectedAntiRedFile(dir, file)) {
      return res.status(403).json({ error: `Cannot modify ${file} — this file is managed by the anti-red protection system. Changes would be overwritten automatically.` })
    }
    let result = await _userCallWithHeal(req, (pass) => cpProxy.saveFileContent(req.cpUser, pass, dir, file, content, req.whmHost), () => _selfHealCpPass(req, getCpanelCol))
    // WHM-root fallback on user-auth-broken (parity with /files/content).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] save_file_content user-level auth-broken → WHM session fallback (user: ${req.cpUser}, file: ${file})`)
          const fb = await cpProxy.uapiViaSession(req.cpUser, 'Fileman', 'save_file_content', { dir, file, content }, 'POST', req.whmHost)
          if (fb.status === 1) {
            log(`[Panel] save_file_content succeeded via WHM session fallback (user: ${req.cpUser}, file: ${file})`)
            result = { ...fb, via: 'whm-session-fallback' }
          } else {
            // Second attempt: try plain WHM as last resort
            log(`[Panel] save_file_content WHM session fallback returned status=0, trying plain WHM (user: ${req.cpUser})`)
            const fb2 = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Fileman', 'save_file_content', { dir, file, content })
            if (fb2.status === 1) {
              result = { ...fb2, via: 'whm-fallback' }
            } else {
              log(`[Panel] save_file_content all fallbacks failed (user: ${req.cpUser}, file: ${file}) — ${fb.reason || fb2.reason || 'unknown'}`)
            }
          }
        } catch (e) {
          log(`[Panel] save_file_content WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/files/upload', ...auth, (req, res, next) => {
    // Gracefully handle client disconnection during upload.
    // NOTE for >~8 MB files on mobile: use /files/upload-chunk instead — Railway's
    // HTTP ingress has ~60s per-request budget, large single-shot uploads get cut.
    let aborted = false
    req.on('aborted', () => { aborted = true })
    req.on('close', () => {
      // Only mark as aborted if the response hasn't been sent AND the body wasn't fully received.
      // req.complete is true once Node.js has received the entire request body from the client.
      // Railway's HTTP/2 proxy can close the stream after sending the full body but before multer
      // finishes parsing — that's not an abort, the data is in memory.
      if (!res.writableEnded && !req.complete) aborted = true
    })

    upload.single('file')(req, res, (err) => {
      if (aborted) {
        log(`[Panel] Upload aborted before multer finished (user: ${req.cpUser || 'unknown'}, dir: ${req.body?.dir || 'unknown'}, size: ${req.headers?.['content-length'] || '?'}) — likely Railway ingress timeout on large/mobile upload; client should retry with chunked upload`)
        if (!res.headersSent) return res.status(499).json({ error: 'Upload interrupted — connection closed before file was fully received. For files >8 MB, please use chunked upload (retry and the panel will auto-chunk).' })
        return
      }
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `File too large (max 100 MB)`
          : `Upload error: ${err.message}`
        log(`[Panel] Upload error: ${err.message} (user: ${req.cpUser || 'unknown'})`)
        if (!res.headersSent) return res.status(400).json({ error: msg })
        return
      }
      next()
    })
  }, async (req, res) => {
    const dir = req.body.dir || `/home/${req.cpUser}/public_html`
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    // Sanitize the filename so a comma/newline/control char (which cPanel's
    // Fileman::fileop treats as a list delimiter with no escaping) can never
    // enter the account — otherwise the file uploads fine but can NEVER be
    // deleted/renamed/extracted afterwards. See @hellpeaces 2026-08-03.
    const _up = cpProxy.sanitizeCpanelFileName(req.file.originalname)
    const uploadName = _up.name
    if (_up.changed) log(`[Panel] Upload filename sanitized: ${JSON.stringify(_up.original)} → ${JSON.stringify(uploadName)} (user: ${req.cpUser})`)
    log(`[Panel] Upload: ${uploadName} (${(req.file.size / 1024).toFixed(1)} KB) → ${dir} (user: ${req.cpUser})`)
    // Prevent overwriting protected anti-red files via upload
    if (isProtectedAntiRedFile(dir, uploadName)) {
      return res.status(403).json({ error: `Cannot upload ${uploadName} — this file is managed by the anti-red protection system.` })
    }
    const result = await _userWriteCallWithHeal(req, getCpanelCol, (pass) => cpProxy.uploadFile(req.cpUser, pass, dir, uploadName, req.file.buffer, req.whmHost))
    // 2026-08-26 @HHR2009 / nnliae74 fix (final):
    // On user-level auth-broken (401 login-page / 403 Access denied), retry via
    // WHM impersonation session (create_user_session + cpsession cookie → POST
    // /execute/Fileman/upload_files). This works when the account is stuck in
    // a cpsrvd security-policy state that denies Basic Auth entirely, even
    // right after WHM /passwd sets a fresh password. Live-tested against
    // nnliae74 at 23:37Z — session upload succeeded (56-byte payload) where
    // both user-level UAPI and WHM-root multipart returned 401 / "no file".
    if (result?.status !== 1 && _isAuthBroken(result)) {
      log(`[Panel] Upload user-level auth-broken (${result?.httpStatus}) → WHM session fallback: ${uploadName} → ${dir} (user: ${req.cpUser})`)
      const sessResult = await cpProxy.uploadFileViaSession(req.cpUser, dir, uploadName, req.file.buffer, req.whmHost || process.env.WHM_HOST)
      if (sessResult?.status === 1) {
        log(`[Panel] Upload succeeded via WHM session fallback: ${uploadName} → ${dir} (user: ${req.cpUser})`)
        return res.json(_up.changed ? { ...sessResult, renamedFrom: _up.original, savedAs: uploadName } : sessResult)
      }
      log(`[Panel] Upload WHM session fallback failed: ${uploadName} → ${dir} (user: ${req.cpUser}, via=${sessResult?.via}) — ${sessResult?.errors?.[0] || 'unknown'}`)
      return res.status(500).json({ status: 0, error: `Upload failed: ${sessResult?.errors?.[0] || 'auth error persists via WHM session'}`, errors: sessResult?.errors || ['auth error'], via: sessResult?.via || 'whm-session-failed' })
    }
    res.json(_up.changed ? { ...result, renamedFrom: _up.original, savedAs: uploadName } : result)
  })

  // ── Chunked upload (for files >8 MB that hit Railway's per-request timeout) ──
  //
  // Root cause this fixes: Railway's HTTP ingress has a ~60s budget per request.
  // A 50 MB zip uploaded over a slow mobile link exceeds that and gets killed
  // mid-body, logged as "aborted before multer finished". Solution: client splits
  // the file into ~5 MB chunks, each posted as its own fast request. Server
  // assembles in memory and forwards to cPanel once the last chunk arrives.
  //
  // Flow:
  //   Every chunk POST sends fields { uploadId, chunkIndex, totalChunks, fileName, dir, fileSize }
  //   + a single 'chunk' multipart file. When chunkIndex === totalChunks-1, the
  //   server concatenates and uploads the assembled Buffer to cPanel.
  //
  // Safety:
  //   - per-user in-memory cap (MAX_TOTAL_SIZE = 120 MB) — abort if exceeded
  //   - per-upload TTL (10 min since first chunk)
  //   - janitor sweep every 2 min drops stale sessions
  //   - lockdown: uploadId MUST be scoped to req.cpUser (spoofing someone else's session rejected)
  const MAX_TOTAL_SIZE = 120 * 1024 * 1024 // allow a little headroom above 100 MB
  const CHUNK_SESSION_TTL_MS = 10 * 60 * 1000
  const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })
  // Map<uploadId, { cpUser, dir, fileName, fileSize, totalChunks, chunks: Buffer[], received: Set<number>, createdAt: number, totalBytesBuffered: number }>
  const chunkSessions = new Map()
  // Janitor — drop expired / crashed sessions so memory doesn't leak
  const janitorHandle = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of chunkSessions) {
      if (now - s.createdAt > CHUNK_SESSION_TTL_MS) {
        chunkSessions.delete(id)
        log(`[Panel] Chunk session ${id} expired (user: ${s.cpUser}, received ${s.received.size}/${s.totalChunks} chunks)`)
      }
    }
  }, 2 * 60 * 1000)
  if (janitorHandle && typeof janitorHandle.unref === 'function') janitorHandle.unref()

  router.post('/files/upload-chunk', ...auth, (req, res) => {
    chunkUpload.single('chunk')(req, res, async (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? 'Chunk too large (max 8 MB per chunk)'
          : `Chunk upload error: ${err.message}`
        log(`[Panel] Chunk upload error: ${err.message} (user: ${req.cpUser || 'unknown'})`)
        return res.status(400).json({ error: msg })
      }
      try {
        const { uploadId, chunkIndex, totalChunks, fileName, dir, fileSize } = req.body || {}
        if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName || !dir) {
          return res.status(400).json({ error: 'Missing required fields: uploadId, chunkIndex, totalChunks, fileName, dir' })
        }
        if (!req.file?.buffer) return res.status(400).json({ error: 'No chunk payload' })

        const idx = parseInt(chunkIndex, 10)
        const total = parseInt(totalChunks, 10)
        const sizeTotal = parseInt(fileSize || '0', 10)
        if (!Number.isFinite(idx) || !Number.isFinite(total) || idx < 0 || idx >= total || total > 1000) {
          return res.status(400).json({ error: 'Invalid chunkIndex/totalChunks' })
        }
        if (sizeTotal > MAX_TOTAL_SIZE) {
          return res.status(413).json({ error: `File too large (max ${Math.floor(MAX_TOTAL_SIZE / (1024 * 1024))} MB via chunked upload)` })
        }
        // Scope the session ID to the user to prevent cross-user hijack
        const sessionKey = `${req.cpUser}::${uploadId}`

        // Protected file guard applies to the final target
        if (isProtectedAntiRedFile(dir, fileName)) {
          chunkSessions.delete(sessionKey)
          return res.status(403).json({ error: `Cannot upload ${fileName} — this file is managed by the anti-red protection system.` })
        }

        let session = chunkSessions.get(sessionKey)
        if (!session) {
          if (idx !== 0 && !session) {
            // Allow out-of-order resume — just initialize
          }
          session = {
            cpUser: req.cpUser,
            dir,
            fileName,
            fileSize: sizeTotal,
            totalChunks: total,
            chunks: new Array(total),
            received: new Set(),
            createdAt: Date.now(),
            totalBytesBuffered: 0,
          }
          chunkSessions.set(sessionKey, session)
          log(`[Panel] Chunk upload started: ${fileName} (${(sizeTotal / (1024 * 1024)).toFixed(1)} MB, ${total} chunks) → ${dir} (user: ${req.cpUser}, id: ${uploadId})`)
        } else if (session.totalChunks !== total || session.fileName !== fileName) {
          return res.status(400).json({ error: 'Chunk session metadata mismatch — start a new upload.' })
        }

        // Idempotent — replacing an already-received chunk is allowed (retry after network blip)
        const prev = session.chunks[idx]
        if (prev) session.totalBytesBuffered -= prev.length
        session.chunks[idx] = req.file.buffer
        session.totalBytesBuffered += req.file.buffer.length
        session.received.add(idx)

        if (session.totalBytesBuffered > MAX_TOTAL_SIZE) {
          chunkSessions.delete(sessionKey)
          return res.status(413).json({ error: `Upload exceeded ${Math.floor(MAX_TOTAL_SIZE / (1024 * 1024))} MB cap` })
        }

        // Not complete yet — ack and wait for more
        if (session.received.size < total) {
          return res.json({
            status: 'chunk-received',
            uploadId,
            received: session.received.size,
            totalChunks: total,
          })
        }

        // All chunks present — assemble & forward
        const assembled = Buffer.concat(session.chunks)
        chunkSessions.delete(sessionKey)
        // Sanitize the filename (comma/newline/control → '_') so it can be
        // deleted/renamed later — cPanel fileop has no delimiter escaping.
        const _cu = cpProxy.sanitizeCpanelFileName(fileName)
        const saveName = _cu.name
        if (_cu.changed) log(`[Panel] Chunk upload filename sanitized: ${JSON.stringify(_cu.original)} → ${JSON.stringify(saveName)} (user: ${req.cpUser})`)
        log(`[Panel] Chunk upload complete: ${saveName} (${(assembled.length / (1024 * 1024)).toFixed(1)} MB) → ${dir} (user: ${req.cpUser}, id: ${uploadId})`)

        const result = await _userWriteCallWithHeal(req, getCpanelCol, (pass) => cpProxy.uploadFile(req.cpUser, pass, dir, saveName, assembled, req.whmHost))
        // 2026-08-26 @HHR2009 / nnliae74 fix (final): on user-level
        // auth-broken, retry via WHM impersonation session (create_user_session
        // + cpsession cookie → /execute/Fileman/upload_files). See the
        // single-shot /files/upload handler for the full rationale.
        if (result?.status !== 1 && _isAuthBroken(result)) {
          log(`[Panel] Chunk upload user-level auth-broken (${result?.httpStatus}) → WHM session fallback: ${saveName} → ${dir} (user: ${req.cpUser}, id: ${uploadId})`)
          const sessResult = await cpProxy.uploadFileViaSession(req.cpUser, dir, saveName, assembled, req.whmHost || process.env.WHM_HOST)
          if (sessResult?.status === 1) {
            log(`[Panel] Chunk upload succeeded via WHM session fallback: ${saveName} (${(assembled.length / (1024 * 1024)).toFixed(1)} MB) → ${dir} (user: ${req.cpUser})`)
            return res.json({ ...sessResult, status: 'complete', cpanelStatus: sessResult.status, ...(_cu.changed ? { renamedFrom: _cu.original, savedAs: saveName } : {}) })
          }
          log(`[Panel] Chunk upload WHM session fallback failed: ${saveName} → ${dir} (user: ${req.cpUser}, via=${sessResult?.via}) — ${sessResult?.errors?.[0] || 'unknown'}`)
          return res.status(500).json({ status: 'complete', cpanelStatus: 0, error: `Upload failed: ${sessResult?.errors?.[0] || 'auth error persists via WHM session'}`, errors: sessResult?.errors || ['auth error'], via: sessResult?.via || 'whm-session-failed' })
        }
        return res.json({ ...result, status: 'complete', cpanelStatus: result?.status, ...(_cu.changed ? { renamedFrom: _cu.original, savedAs: saveName } : {}) })
      } catch (e) {
        log(`[Panel] Chunk handler error: ${e.message} (user: ${req.cpUser || 'unknown'})`)
        return res.status(500).json({ error: `Upload failed: ${e.message}` })
      }
    })
  })

  // Allow a client to explicitly cancel an in-progress chunked upload (frees memory)
  router.post('/files/upload-chunk/cancel', express.json(), ...auth, (req, res) => {
    const { uploadId } = req.body || {}
    if (!uploadId) return res.status(400).json({ error: 'uploadId required' })
    const sessionKey = `${req.cpUser}::${uploadId}`
    const existed = chunkSessions.delete(sessionKey)
    if (existed) log(`[Panel] Chunk upload cancelled by client (user: ${req.cpUser}, id: ${uploadId})`)
    return res.json({ status: existed ? 'cancelled' : 'not_found' })
  })

  router.post('/files/mkdir', ...auth, async (req, res) => {
    let { dir, name } = req.body
    if (!dir || !name) return res.status(400).json({ error: 'dir and name are required' })
    // Sanitize folder name — a comma/newline in a directory name makes the
    // folder (and everything under it) impossible to delete/rename via fileop.
    const _mk = cpProxy.sanitizeCpanelFileName(name)
    if (_mk.changed) log(`[Panel] mkdir name sanitized: ${JSON.stringify(_mk.original)} → ${JSON.stringify(_mk.name)} (user: ${req.cpUser})`)
    name = _mk.name

    // Attempt 1: user-level cPanel API2 (Fileman::mkdir).
    const result = await _userWriteCallWithHeal(req, getCpanelCol, (pass) => cpProxy.createDirectory(req.cpUser, pass, dir, name, req.whmHost))
    if (result?.status === 1) return res.json(_mk.changed ? { ...result, renamedFrom: _mk.original, savedAs: name } : result)

    // Attempt 2: WHM-root fallback for uapi EPERM / status-1 failures OR
    // user-level auth failures (401/403 — stale cpPass / cPanel session
    // lockout, 2026-08-26 @HHR2009 fix).
    // Motivated by @hellpeaces (5522767823) 2026-07-06 — broken shell/homedir
    // made user-level `uapi` exit EPERM. Root, calling via WHM's
    // /json-api/cpanel?cpanel_jsonapi_user=<user>, retries the same op.
    //
    // A genuinely broken homedir/quota makes BOTH the user-level call and the
    // root-as-user fallback exit EPERM (both run in the user context) — but
    // the dominant real-world pattern is a *transient* quota-accounting blip
    // (common right after account creation), so we retry the fallback a couple
    // of times with a short backoff before giving up. If it still fails with
    // EPERM we (a) proactively page ops with the exact repair command and
    // (b) return a calm, localized message instead of a raw "500 …EPERM".
    // (Re-reported by @hellpeaces on 2026-07-21 because the 07-06 fallback
    // alone couldn't recover a persistent break and never alerted anyone.)
    // For 401/403 (broken user auth), the WHM-root path succeeds because
    // it uses root credentials + impersonation — no retry needed, single
    // attempt is enough.
    const authBroken = _isAuthBroken(result)
    const looksBroken =
      authBroken ||
      result?.code === 'CPANEL_UAPI_EPERM' ||
      (result?.httpStatus && result.httpStatus >= 500) ||
      result?.errors?.some(e => cpProxy.looksLikeUapiPermFailure && cpProxy.looksLikeUapiPermFailure(e))
    const whmApi = looksBroken ? _makeWhmApi(req.whmHost || process.env.WHM_HOST) : null

    if (whmApi) {
      const reasonTag = authBroken ? 'user-auth-broken' : (result?.errors?.[0] || 'unknown')
      log(`[Panel] mkdir user-level failed for "${name}" in ${dir}, trying WHM fallback (user: ${req.cpUser}, reason: ${reasonTag})`)
      const MKDIR_RETRY_BACKOFFS_MS = [0, 800, 1600] // initial + 2 retries
      let lastWhmReason = result?.errors?.[0] || 'unknown'
      for (let attempt = 0; attempt < MKDIR_RETRY_BACKOFFS_MS.length; attempt++) {
        if (MKDIR_RETRY_BACKOFFS_MS[attempt] > 0) {
          await new Promise(r => setTimeout(r, MKDIR_RETRY_BACKOFFS_MS[attempt]))
        }
        try {
          const r = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: req.cpUser,
              cpanel_jsonapi_apiversion: 2,
              cpanel_jsonapi_module: 'Fileman',
              cpanel_jsonapi_func: 'mkdir',
              path: dir,
              name,
            },
          })
          const cp = r.data?.cpanelresult || {}
          const dataArr = Array.isArray(cp.data) ? cp.data : []
          const created = dataArr.length > 0 && dataArr[0]?.path && dataArr[0]?.name
          const eventOk = cp.event?.result === 1
          if (created || eventOk) {
            log(`[Panel] mkdir succeeded via WHM fallback${attempt ? ` (retry ${attempt})` : ''}: "${name}" in ${dir} (user: ${req.cpUser})`)
            return res.json({ status: 1, data: dataArr, errors: null, via: attempt ? 'whm-fallback-retry' : 'whm-fallback' })
          }
          lastWhmReason = dataArr[0]?.reason || cp.error || 'WHM fallback also failed'
          // Only worth retrying an EPERM/status-1 class blip; any other
          // reason (e.g. "already exists", bad path) won't self-heal.
          if (!(cpProxy.looksLikeUapiPermFailure && cpProxy.looksLikeUapiPermFailure(String(lastWhmReason)))) break
          log(`[Panel] mkdir WHM fallback EPERM${attempt < MKDIR_RETRY_BACKOFFS_MS.length - 1 ? ' — retrying' : ''}: "${name}" (user: ${req.cpUser}) — ${lastWhmReason}`)
        } catch (e) {
          lastWhmReason = e.message
          log(`[Panel] mkdir WHM fallback exception: ${e.message} (user: ${req.cpUser})`)
          break
        }
      }

      // Fallback exhausted. If it's the EPERM class, page ops with the exact
      // repair and give the user a calm message; otherwise surface the real
      // reason as before.
      const isEperm = cpProxy.looksLikeUapiPermFailure && cpProxy.looksLikeUapiPermFailure(String(lastWhmReason))
      if (isEperm) {
        cpProxy.alertEpermRepairNeeded({
          op: 'create folder',
          cpUser: req.cpUser,
          domain: req.cpDomain,
          whmHost: req.whmHost || process.env.WHM_HOST,
        })
        log(`[Panel] mkdir blocked by EPERM (user: ${req.cpUser}) — ops paged, friendly message returned`)
        return res.json({
          status: 0,
          code: 'CPANEL_UAPI_EPERM',
          error: cpProxy.getEpermUserMessage('en'),
          errors: [cpProxy.getEpermUserMessage('en')],
          localizedMessages: cpProxy.getEpermLocalizedMessages(),
          via: 'whm-fallback-eperm',
        })
      }
      log(`[Panel] mkdir WHM fallback failed: "${name}" in ${dir} (user: ${req.cpUser}) — ${lastWhmReason}`)
      return res.status(500).json({
        status: 0,
        error: `Create folder failed: ${lastWhmReason}`,
        errors: [lastWhmReason],
        via: 'whm-fallback-failed',
      })
    }

    return res.json(result)
  })

  router.post('/files/delete', ...auth, async (req, res) => {
    const { dir, file, isDirectory } = req.body
    if (!dir || !file) return res.status(400).json({ error: 'dir and file are required' })
    if (isProtectedAntiRedFile(dir, file)) {
      log(`[Panel] Delete blocked (anti-red protected): ${file} in ${dir} (user: ${req.cpUser})`)
      return res.status(403).json({ error: `Cannot delete ${file} — this file is managed by the anti-red protection system and will be re-created automatically.` })
    }
    try {
      const result = await _userWriteCallWithHeal(req, getCpanelCol, (pass) => cpProxy.deleteFile(req.cpUser, pass, dir, file, req.whmHost, !!isDirectory))
      if (result?.status === 1) {
        log(`[Panel] Deleted ${isDirectory ? 'folder' : 'file'}: ${file} in ${dir} (user: ${req.cpUser})`)
        // A delete in public_html may have removed the root protection files
        // (.user.ini / .antired-challenge.php) — restore them shortly after.
        if (isPublicHtmlPath(dir)) scheduleProtectionRestore(req.cpUser, `delete:${isDirectory ? 'folder' : 'file'}`)
        return res.json(result)
      }

      // User-level cPanel API2 failed — try WHM-level fallback (root can delete on behalf of user)
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] Delete user-level failed for ${file}, trying WHM fallback (user: ${req.cpUser}, reason: ${result?.errors?.[0] || 'unknown'})`)
        // Helper: run a single fileop call as the user, return cpanelresult.data
        const runOp = async (op) => {
          const r = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: req.cpUser,
              cpanel_jsonapi_apiversion: 2,
              cpanel_jsonapi_module: 'Fileman',
              cpanel_jsonapi_func: 'fileop',
              doubledecode: 0,
              op,
              sourcefiles: `${dir}/${file}`,
            },
          })
          return r.data?.cpanelresult || r.data?.result || {}
        }

        // Helper: verify the target is gone by re-listing the parent dir.
        // Returns true (gone), false (still present), or null (could not verify).
        const verifyGone = async () => {
          try {
            const r = await whmApi.get('/cpanel', {
              params: {
                'api.version': 1,
                cpanel_jsonapi_user: req.cpUser,
                cpanel_jsonapi_apiversion: 3,
                cpanel_jsonapi_module: 'Fileman',
                cpanel_jsonapi_func: 'list_files',
                dir,
              },
            })
            const items = r.data?.result?.data || []
            return !items.some(f => f && (f.file === file || f.fullname === file))
          } catch (_) {
            return null
          }
        }

        // For directories: `unlink` silently no-ops, `killdir` is unrecognised.
        // `trash` is the only op that works for directories on modern cPanel.
        // For plain files, `unlink` is fast.
        // We try the primary op, verify the deletion landed, and on silent
        // no-op we automatically retry with the alternate op.
        const primary = isDirectory ? 'trash' : 'unlink'
        const fallback = isDirectory ? 'unlink' : 'trash'
        const attempted = [primary]
        let opResult = await runOp(primary)
        let gone = await verifyGone()

        if (gone === false) {
          log(`[Panel] WHM fallback: ${primary} returned success but ${file} still present — retrying with ${fallback} (user: ${req.cpUser})`)
          attempted.push(fallback)
          opResult = await runOp(fallback)
          gone = await verifyGone()
        }

        const opData = opResult.data || []
        const opOk = opData.length > 0 && opData[0]?.result === 1
        const opEventOk = opResult.event?.result === 1 && opData.length === 0
        if ((opOk || opEventOk) && gone !== false) {
          log(`[Panel] Deleted via WHM fallback: ${file} in ${dir} (user: ${req.cpUser}, ops_tried: [${attempted.join(', ')}], verified: ${gone === true})`)
          if (isPublicHtmlPath(dir)) scheduleProtectionRestore(req.cpUser, 'delete:whm-fallback')
          return res.json({ status: 1, data: opData, errors: null, via: 'whm-fallback', attempted_ops: attempted })
        }

        // WHM fallback (both ops) failed — report combined error
        const whmReason = opData[0]?.reason
          || opResult.error
          || (gone === false ? 'Both ops returned success but target is still present (permission/readonly?)' : 'WHM operation also failed')
        log(`[Panel] Delete WHM fallback also failed: ${file} in ${dir} (user: ${req.cpUser}, ops_tried: [${attempted.join(', ')}]) — ${whmReason}`)
        if (_isEpermReason(whmReason)) return _replyEperm(res, req, 'delete item')
        return res.status(500).json({ error: `Delete failed: ${whmReason}`, attempted_ops: attempted })
      }

      // No WHM credentials available — report the original error
      const reason = result?.errors?.[0] || 'cPanel refused to delete this item'
      log(`[Panel] Delete failed: ${file} in ${dir} (user: ${req.cpUser}) — ${reason}`)
      if (result?.code === 'CPANEL_UAPI_EPERM' || _isEpermReason(reason)) return _replyEperm(res, req, 'delete item')
      return res.status(500).json({ error: `Delete failed: ${reason}`, ...result })
    } catch (err) {
      log(`[Panel] Delete exception: ${file} in ${dir} (user: ${req.cpUser}) — ${err.message}`)
      if (_isEpermReason(err.message)) return _replyEperm(res, req, 'delete item')
      return res.status(500).json({ error: `Delete failed: ${err.message}` })
    }
  })

  router.post('/files/rename', ...auth, async (req, res) => {
    const { dir, oldName, newName } = req.body
    if (!dir || !oldName || !newName) return res.status(400).json({ error: 'dir, oldName, newName required' })
    // Prevent renaming protected anti-red files (both source and destination)
    if (isProtectedAntiRedFile(dir, oldName)) {
      return res.status(403).json({ error: `Cannot rename ${oldName} — this file is managed by the anti-red protection system.` })
    }
    if (isProtectedAntiRedFile(dir, newName)) {
      return res.status(403).json({ error: `Cannot overwrite ${newName} — this file is managed by the anti-red protection system.` })
    }
    // Reject a new name containing cPanel fileop delimiters (comma/newline/etc.):
    // it would create a file that can never be deleted/renamed/extracted again.
    const _rn = cpProxy.sanitizeCpanelFileName(newName)
    if (_rn.changed) {
      return res.status(400).json({ error: `The name "${newName}" contains characters that aren't allowed (commas, slashes or line breaks). Try "${_rn.name}" instead.`, suggestedName: _rn.name })
    }
    const result = await _userWriteCallWithHeal(req, getCpanelCol, (pass) => cpProxy.renameFile(req.cpUser, pass, dir, oldName, newName, req.whmHost))
    // WHM-root fallback on user-auth-broken (@Devils_gods 2026-08-30 —
    // Fileman::fileop returned 403 [AUTH] silently; no fallback wired).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] rename user-level auth-broken → WHM fallback (user: ${req.cpUser}, ${oldName} → ${newName})`)
          const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'rename', {
            sourcefiles: `${dir}/${oldName}`,
            destfiles: `${dir}/${newName}`,
          })
          if (fb.ok) {
            log(`[Panel] rename succeeded via WHM fallback (user: ${req.cpUser})`)
            return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
          }
          log(`[Panel] rename WHM fallback failed (user: ${req.cpUser}) — ${fb.reason}`)
          return res.status(500).json({ status: 0, error: `Rename failed: ${fb.reason}`, errors: [fb.reason] })
        } catch (e) {
          log(`[Panel] rename WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/files/extract', ...auth, async (req, res) => {
    const { dir, file, destDir } = req.body
    if (!dir || !file) return res.status(400).json({ error: 'dir and file are required' })
    const extractTarget = destDir || dir
    let result = await cpProxy.extractFile(req.cpUser, req.cpPass, dir, file, extractTarget, req.whmHost)

    // If the user-level extract failed with the broken-homedir class OR
    // user-auth-broken (401/403 — stale cpPass, 2026-08-26 @HHR2009 fix),
    // try the WHM root-as-user fallback (same fileop path delete uses).
    if (result?.status !== 1) {
      const failReason = result?.errors?.[0] || result?.error || 'unknown'
      const authBrokenExt = _isAuthBroken(result)
      const looksBroken = authBrokenExt || result?.code === 'CPANEL_UAPI_EPERM' ||
        (result?.httpStatus && result.httpStatus >= 500) || _isEpermReason(failReason)
      const whmApi = looksBroken ? _makeWhmApi(req.whmHost || process.env.WHM_HOST) : null
      if (whmApi) {
        log(`[Panel] extract user-level failed for ${file} → WHM fallback (user: ${req.cpUser}, reason: ${authBrokenExt ? 'user-auth-broken' : failReason})`)
        const BACKOFFS = [0, 800, 1600]
        let lastReason = failReason
        for (let i = 0; i < BACKOFFS.length; i++) {
          if (BACKOFFS[i] > 0) await new Promise(r => setTimeout(r, BACKOFFS[i]))
          try {
            const r = await whmApi.get('/cpanel', { params: {
              'api.version': 1, cpanel_jsonapi_user: req.cpUser, cpanel_jsonapi_apiversion: 2,
              cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', doubledecode: 0,
              op: 'extract', sourcefiles: `${dir}/${file}`, destfiles: extractTarget,
            } })
            const cp = r.data?.cpanelresult || {}
            const dataArr = Array.isArray(cp.data) ? cp.data : []
            if ((dataArr[0]?.result === 1) || cp.event?.result === 1) {
              log(`[Panel] extract succeeded via WHM fallback${i ? ` (retry ${i})` : ''}: ${file} (user: ${req.cpUser})`)
              result = { status: 1, data: dataArr, errors: null, via: i ? 'whm-fallback-retry' : 'whm-fallback' }
              break
            }
            lastReason = dataArr[0]?.reason || cp.error || 'WHM fallback also failed'
            if (!_isEpermReason(lastReason)) break
          } catch (e) { lastReason = e.message; break }
        }
        if (result?.status !== 1 && _isEpermReason(lastReason)) return _replyEperm(res, req, 'extract archive')
        if (result?.status !== 1) result = { status: 0, error: `Extract failed: ${lastReason}`, errors: [lastReason] }
      } else if (result?.code === 'CPANEL_UAPI_EPERM' || _isEpermReason(failReason)) {
        return _replyEperm(res, req, 'extract archive')
      }
    }

    // Only re-deploy anti-red protection if extraction actually succeeded —
    // archive contents may have overwritten .user.ini / .antired-challenge.php.
    if (result?.status === 1 && extractTarget.includes('public_html')) {
      try {
        const antiRed = require('./anti-red-service')
        // force: bypass idempotency cache to guarantee a fresh write to WHM.
        await antiRed.deployCFIPFix(req.cpUser, { force: true })
        log(`[Panel] Re-deployed anti-red protection after extract to ${extractTarget} (user: ${req.cpUser})`)
      } catch (e) {
        log(`[Panel] Warning: failed to re-deploy anti-red after extract for ${req.cpUser}: ${e.message}`)
      }
    }

    res.json(result)
  })

  router.post('/files/compress', ...auth, async (req, res) => {
    const { dir, files, destFile } = req.body
    if (!dir || !files?.length || !destFile) return res.status(400).json({ error: 'dir, files, and destFile are required' })
    const result = await cpProxy.compressFiles(req.cpUser, req.cpPass, dir, files, destFile, req.whmHost)
    // WHM-root fallback on user-auth-broken (parity with /files/rename).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] compress user-level auth-broken → WHM fallback (user: ${req.cpUser}, ${files.length} files → ${destFile})`)
          // fileop compress joins sources with a NEWLINE (per cPanel API).
          const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'compress', {
            sourcefiles: files.map(f => `${dir}/${f}`).join('\n'),
            destfiles: `${dir}/${destFile}`,
          })
          if (fb.ok) {
            log(`[Panel] compress succeeded via WHM fallback (user: ${req.cpUser})`)
            return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
          }
          log(`[Panel] compress WHM fallback failed (user: ${req.cpUser}) — ${fb.reason}`)
          return res.status(500).json({ status: 0, error: `Compress failed: ${fb.reason}`, errors: [fb.reason] })
        } catch (e) {
          log(`[Panel] compress WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/files/copy', ...auth, async (req, res) => {
    const { dir, file, destDir } = req.body
    if (!dir || !file || !destDir) return res.status(400).json({ error: 'dir, file, and destDir are required' })
    if (isProtectedAntiRedFile(dir, file)) {
      return res.status(403).json({ error: `Cannot copy ${file} — this file is managed by the anti-red protection system.` })
    }
    const result = await cpProxy.copyFile(req.cpUser, req.cpPass, dir, file, destDir, req.whmHost)
    // WHM-root fallback on user-auth-broken (parity with /files/rename).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] copy user-level auth-broken → WHM fallback (user: ${req.cpUser}, ${file} → ${destDir})`)
          const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'copy', {
            sourcefiles: `${dir}/${file}`,
            destfiles: destDir,
          })
          if (fb.ok) {
            log(`[Panel] copy succeeded via WHM fallback (user: ${req.cpUser})`)
            return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
          }
          log(`[Panel] copy WHM fallback failed (user: ${req.cpUser}) — ${fb.reason}`)
          return res.status(500).json({ status: 0, error: `Copy failed: ${fb.reason}`, errors: [fb.reason] })
        } catch (e) {
          log(`[Panel] copy WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/files/move', ...auth, async (req, res) => {
    const { dir, file, destDir } = req.body
    if (!dir || !file || !destDir) return res.status(400).json({ error: 'dir, file, and destDir are required' })
    if (isProtectedAntiRedFile(dir, file)) {
      return res.status(403).json({ error: `Cannot move ${file} — this file is managed by the anti-red protection system.` })
    }
    const result = await cpProxy.moveFile(req.cpUser, req.cpPass, dir, file, destDir, req.whmHost)
    // WHM-root fallback on user-auth-broken (@Devils_gods 2026-08-30 —
    // reported "i still cant move files"; Railway logs confirmed
    // Fileman::fileop returned 403 [AUTH] with NO fallback wired).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try {
          log(`[Panel] move user-level auth-broken → WHM fallback (user: ${req.cpUser}, ${file} → ${destDir})`)
          const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'move', {
            sourcefiles: `${dir}/${file}`,
            destfiles: destDir,
          })
          if (fb.ok) {
            log(`[Panel] move succeeded via WHM fallback (user: ${req.cpUser})`)
            return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
          }
          log(`[Panel] move WHM fallback failed (user: ${req.cpUser}) — ${fb.reason}`)
          return res.status(500).json({ status: 0, error: `Move failed: ${fb.reason}`, errors: [fb.reason] })
        } catch (e) {
          log(`[Panel] move WHM fallback exception (user: ${req.cpUser}): ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  // ─── Domains ────────────────────────────────────────────

  router.get('/domains', ...auth, async (req, res) => {
    const result = await _userCallWithHeal(req, (pass) => cpProxy.listDomains(req.cpUser, pass, req.whmHost), () => _selfHealCpPass(req, getCpanelCol))
    // WHM-root fallback when user-level auth is broken (same pattern as file routes)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] listDomains user-level auth broken for ${req.cpUser} → WHM-root fallback`)
        try {
          const fb = await _uapiViaWhmRoot(whmApi, req.cpUser, 'DomainInfo', 'list_domains', {})
          if (fb.status === 1) {
            log(`[Panel] listDomains WHM-root fallback SUCCESS for ${req.cpUser}`)
            return res.json(fb)
          }
        } catch (e) {
          log(`[Panel] listDomains WHM-root fallback error: ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/domains/add', ...auth, async (req, res) => {
    const { domain, subDomain, dir } = req.body
    if (!domain) return res.status(400).json({ error: 'domain is required' })

    // Load account doc and call shared addon flow helper.
    // The helper centralises blocklist + plan-limit + duplicate-on-plan +
    // cPanel addAddon + persist + DNS + anti-red retry + verify-probe so the
    // bot and panel paths stay in lockstep.
    const col = getCpanelCol()
    const account = col ? await col.findOne({ _id: req.cpUser.toLowerCase() }) : null
    if (!account) {
      return res.status(404).json({ error: 'account not found' })
    }

    const addonFlow = require('./addon-domain-flow')
    const lang = await getUserLang(account)
    const bot = require('./_index')?._bot || null

    const result = await addonFlow.attachAddonDomain({
      account,
      cpPass: req.cpPass,
      domain,
      subDomain,
      dir,
      db,
      bot,
      lang,
    })

    if (result.ok) {
      // Maintain legacy success response shape (frontend expects { errors: null|[] })
      return res.json({ status: 1, errors: null, data: { domain, alreadyAttached: !!result.alreadyAttached, docRoot: result.docRoot } })
    }

    // Map errorKind → HTTP status
    if (result.errorKind === 'blocked') {
      return res.status(403).json({ error: result.error || 'domain blocked', blocked: true })
    }
    if (result.errorKind === 'limit') {
      const isWeekly = (account.plan || '').toLowerCase().includes('week')
      const upgradeMsg = isWeekly
        ? `Domain limit reached (${result.limit} addon${result.limit !== 1 ? 's' : ''}). Upgrade to a monthly plan for more domains — use the Upgrade Plan button in your hosting details on the bot.`
        : `Domain limit reached (${result.limit} addon domains). Upgrade to Golden Anti-Red for unlimited domains.`
      return res.status(403).json({ error: upgradeMsg, limitReached: true, currentAddons: result.currentAddons, limit: result.limit })
    }
    if (result.errorKind === 'duplicate') {
      return res.status(409).json({ error: result.error || 'domain already attached', errors: [result.error || 'domain already attached'] })
    }
    if (result.errorKind === 'cpanel_down') {
      return res.status(503).json({ error: 'WHM control plane unreachable. Please retry shortly.', code: 'CPANEL_DOWN', errors: ['CPANEL_DOWN'] })
    }
    return res.status(400).json({ error: result.error || 'failed to add domain', errors: [result.error || 'failed to add domain'] })
  })

  router.post('/domains/remove', ...auth, async (req, res) => {
    const { domain, subDomain } = req.body
    if (!domain) return res.status(400).json({ error: 'domain is required' })

    // 1. Remove addon domain from cPanel (with WHM-root fallback via cpanel-proxy)
    const result = await cpProxy.removeAddonDomain(req.cpUser, req.cpPass, domain, subDomain, req.cpDomain, req.whmHost)

    // Treat "already gone" as success — cPanel returns "does not exist" when
    // a partial delete previously stripped it from the httpd conf. We MUST
    // still clean up our own tracking + CF for these.
    const errText = String((result?.errors && result.errors[0]) || '').toLowerCase()
    const alreadyGone = /does\s*not\s*exist|not\s*found|is\s*not\s*an?\s*(addon|park)|no such/.test(errText)
    const succeeded = result?.status === 1 || alreadyGone

    // If the cPanel removal HARD-failed, do NOT unpersist from Mongo or wipe
    // Cloudflare — otherwise the domain silently disappears from our tracking
    // while still attached in cPanel, producing the exact orphan state that
    // @Devils_gods hit ("i added an example domain ... now i cant delete it").
    // 2026-08-30 testing-agent flagged this.
    if (!succeeded) {
      log(`[Panel] domains/remove HARD FAIL for ${req.cpUser} → ${domain}: ${result?.errors?.[0] || 'unknown'} — skipping Mongo/CF cleanup so retry is possible`)
      // 503 for control-plane down (parity with /domains/add), 502 otherwise.
      const statusCode = result?.code === 'CPANEL_DOWN' ? 503 : 502
      return res.status(statusCode).json({
        status: 0,
        error: (result && result.errors && result.errors[0]) || 'Failed to remove addon domain',
        errors: (result && result.errors) || ['Failed to remove addon domain'],
        code: result?.code,
      })
    }

    // 2. Remove addon domain from cpanelAccounts.addonDomains[] (protection-enforcer tracking)
    try {
      const col = getCpanelCol()
      if (col) {
        await col.updateOne(
          { _id: req.cpUser.toLowerCase() },
          { $pull: { addonDomains: domain.toLowerCase() } }
        )
        log(`[Panel] Removed addon domain ${domain} from cpanelAccounts for ${req.cpUser}${alreadyGone ? ' (already-gone reconcile)' : ''}`)
      }
    } catch (dbErr) {
      log(`[Panel] remove: failed to unpersist addon ${domain}: ${dbErr.message}`)
    }

    // 3. Clean up Cloudflare: remove DNS records and Worker routes for the removed domain
    try {
      const td = await require('./hosting-dns-teardown').teardownHostingDomain({ col: getCpanelCol(), domain, tag: 'Panel' })
      if (td.removed) log(`[Panel] Cleaned up CF resources for removed domain: ${domain}`)
    } catch (cfErr) {
      log(`[Panel] CF cleanup warning for removed domain ${domain}: ${cfErr.message}`)
    }

    // If we got here via alreadyGone, still return status:1 so the panel
    // treats it as a successful reconcile.
    res.json(alreadyGone ? { status: 1, data: null, errors: null, reconciled: true } : result)
  })

  // ─── Domain Document-Root Mode (mirror primary vs own folder) ───
  // GET  /domains/docroot-modes → { modes: { <addonDomain>: 'mirror'|'own' }, primary }
  //   'mirror' = addon serves the SAME website as the primary (docroot=public_html)
  //   'own'    = addon serves its own folder (docroot=public_html/<domain>)
  router.get('/domains/docroot-modes', ...auth, async (req, res) => {
    try {
      const col = getCpanelCol()
      const account = col ? await col.findOne({ _id: req.cpUser.toLowerCase() }) : null
      const stored = (account && account.docrootModes) || {}
      const modes = {}
      for (const d of (req.cpAddonDomains || [])) {
        const key = (d || '').toLowerCase()
        if (!key) continue
        modes[key] = stored[key] === 'mirror' ? 'mirror' : 'own'
      }
      res.json({ modes, primary: req.cpDomain })
    } catch (err) {
      log(`[Panel] docroot-modes list error: ${err.message}`)
      res.status(500).json({ error: 'Failed to fetch domain modes' })
    }
  })

  // POST /domains/docroot-mode { domain, mode: 'mirror'|'own' }
  // Switches an ADDON domain between mirroring the primary site and serving
  // its own folder. The primary domain itself cannot be changed here.
  router.post('/domains/docroot-mode', ...auth, async (req, res) => {
    const { domain, mode } = req.body || {}
    if (!domain || !mode) return res.status(400).json({ error: 'domain and mode are required' })
    const dom = String(domain).toLowerCase().trim()
    const wantMode = mode === 'mirror' ? 'mirror' : 'own'

    if (dom === (req.cpDomain || '').toLowerCase()) {
      return res.status(400).json({ error: 'The primary domain always serves your main site (public_html) and cannot be changed here.' })
    }
    const addons = (req.cpAddonDomains || []).map(d => (d || '').toLowerCase())
    if (!addons.includes(dom)) {
      return res.status(404).json({ error: 'That domain is not an addon on this hosting plan.' })
    }

    const subdomainLabel = dom.replace(/\./g, '')
    const rootdomain = req.cpDomain
    const dir = wantMode === 'mirror' ? 'public_html' : `public_html/${dom}`

    try {
      // For 'own' mode, make sure the target folder exists (it may not if the
      // domain was originally added in mirror mode). Idempotent — ignore
      // "already exists" style failures.
      if (wantMode === 'own') {
        try {
          await cpProxy.createDirectory(req.cpUser, req.cpPass, 'public_html', dom, req.whmHost)
        } catch (mkErr) {
          log(`[Panel] docroot-mode: mkdir public_html/${dom} note: ${mkErr.message}`)
        }
      }

      const result = await cpProxy.changeDomainDocRoot(req.cpUser, req.cpPass, subdomainLabel, rootdomain, dir, req.whmHost)
      if (result.code === 'CPANEL_DOWN') {
        return res.status(503).json({ error: 'WHM control plane unreachable. Please retry shortly.', code: 'CPANEL_DOWN' })
      }
      if (result.status !== 1) {
        return res.status(400).json({ error: (result.errors && result.errors[0]) || 'Failed to update domain mode' })
      }

      // Persist the mode for display
      try {
        const col = getCpanelCol()
        if (col) {
          await col.updateOne(
            { _id: req.cpUser.toLowerCase() },
            { $set: { [`docrootModes.${dom}`]: wantMode } }
          )
        }
      } catch (dbErr) {
        log(`[Panel] docroot-mode: persist warning for ${dom}: ${dbErr.message}`)
      }

      log(`[Panel] docroot-mode: ${dom} → ${wantMode} (dir=${dir}) for ${req.cpUser}`)
      return res.json({ success: true, domain: dom, mode: wantMode, docRoot: dir })
    } catch (err) {
      log(`[Panel] docroot-mode error for ${dom}: ${err.message}`)
      return res.status(500).json({ error: 'Failed to update domain mode' })
    }
  })

  // ─── Set / Replace Primary Domain ───────────────────────
  // POST /domains/set-primary { domain }
  // Promotes an existing ADDON domain to be the account's PRIMARY domain via
  // WHM modifyacct. The old primary is removed from the account by cPanel; the
  // account keeps the same username/PIN and the same public_html site content
  // (the new primary now serves it). Cloudflare zone + anti-red protection are
  // (re)deployed for the new primary in the background, and the old primary's
  // CF records/worker routes are cleaned up. Returns a fresh session token
  // carrying the new primary domain.
  router.post('/domains/set-primary', ...auth, async (req, res) => {
    const { domain } = req.body || {}
    if (!domain) return res.status(400).json({ error: 'domain is required' })
    const newDomain = String(domain).toLowerCase().trim()
    if (!newDomain.includes('.')) return res.status(400).json({ error: 'invalid domain' })

    const oldDomain = (req.cpDomain || '').toLowerCase()
    if (newDomain === oldDomain) {
      return res.status(400).json({ error: 'That domain is already your primary domain.' })
    }

    const col = getCpanelCol()
    if (!col) return res.status(503).json({ error: 'Service starting up, try again shortly.' })
    const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Eligibility: the new domain must already be an addon on THIS plan.
    const addons = (req.cpAddonDomains || []).map(d => (d || '').toLowerCase())
    if (!addons.includes(newDomain)) {
      return res.status(400).json({
        error: 'Add this domain to your plan first (Add Domain), then set it as primary.',
        needsAttach: true,
      })
    }

    // Blocklist guard
    try {
      const db = getCpanelCol()?.s?.db
      if (db) {
        const blocked = await db.collection('blockedDomains').findOne({ domain: newDomain })
        if (blocked) {
          return res.status(403).json({ error: `This domain (${newDomain}) is blocked and cannot be used.`, blocked: true })
        }
      }
    } catch (e) {
      log(`[Panel] set-primary: blocklist check warning: ${e.message}`)
    }

    log(`[Panel] set-primary request — cpUser=${req.cpUser}, ${oldDomain} → ${newDomain}`)

    // 1. Remove the new domain as an addon (a domain can't be both addon + primary).
    let removedAddon = false
    try {
      const rm = await cpProxy.removeAddonDomain(req.cpUser, req.cpPass, newDomain, undefined, oldDomain, req.whmHost)
      if (rm.code === 'CPANEL_DOWN') {
        return res.status(503).json({ error: 'WHM control plane unreachable. Please retry shortly.', code: 'CPANEL_DOWN' })
      }
      removedAddon = rm.status === 1
      // Even if cPanel reports a soft failure, continue — modifyacct will fail
      // loudly if the domain is still bound, and we roll back below.
    } catch (e) {
      log(`[Panel] set-primary: removeAddon warning for ${newDomain}: ${e.message}`)
    }

    // 2. Swap the primary domain on WHM.
    const swap = await whmService.changePrimaryDomain(req.cpUser, newDomain)
    if (!swap.success) {
      // Roll back: re-attach the domain as an addon so the user isn't left worse off.
      if (removedAddon) {
        try {
          await cpProxy.addAddonDomain(req.cpUser, req.cpPass, newDomain, newDomain.replace(/\./g, ''), `public_html/${newDomain}`, req.whmHost)
          log(`[Panel] set-primary: rolled back — re-attached ${newDomain} as addon after modifyacct failure`)
        } catch (rbErr) {
          log(`[Panel] set-primary: ROLLBACK FAILED for ${newDomain}: ${rbErr.message}`)
        }
      }
      return res.status(500).json({ error: swap.error || 'Failed to change primary domain. Please try again or contact support.' })
    }

    // 3. Update DB: new primary, drop it from addonDomains + docrootModes.
    try {
      await col.updateOne(
        { _id: account._id },
        {
          $set: { domain: newDomain },
          $pull: { addonDomains: newDomain },
          $unset: { [`docrootModes.${newDomain}`]: '', [`docrootModes.${oldDomain}`]: '' },
        }
      )
    } catch (dbErr) {
      log(`[Panel] set-primary: DB update warning: ${dbErr.message}`)
    }

    // 4. Fresh session token carrying the new primary domain.
    const token = cpAuth.createToken({ cpUser: req.cpUser, domain: newDomain, chatId: req.cpChatId })

    // 5. Background: (re)deploy CF zone + anti-red for the new primary, and
    //    clean up the old primary's CF records/worker routes. Fire-and-forget.
    ;(async () => {
      try {
        const addonFlow = require('./addon-domain-flow')
        const freshAccount = await col.findOne({ _id: account._id }) || account
        const lang = await getUserLang(freshAccount)
        const bot = require('./_index')?._bot || null
        await addonFlow.runDnsAndProtection({
          domain: newDomain,
          cpUser: req.cpUser,
          whmHost: req.whmHost,
          account: freshAccount,
          db: getCpanelCol()?.s?.db,
          bot,
          lang,
        })
      } catch (e) {
        log(`[Panel] set-primary: new-primary protection pipeline error: ${e.message}`)
      }
      // Old primary cleanup (best-effort)
      try {
        const td = await require('./hosting-dns-teardown').teardownHostingDomain({ col: getCpanelCol(), domain: oldDomain, tag: 'Panel' })
        if (td.removed) log(`[Panel] set-primary: cleaned up CF resources for old primary ${oldDomain}`)
      } catch (e) {
        log(`[Panel] set-primary: old-primary CF cleanup warning: ${e.message}`)
      }
    })()

    try {
      notifier(`🔄 <b>Primary domain changed (via web HostPanel)</b>\nUser: ${account.chatId}\ncPanel: <code>${req.cpUser}</code>\nOld: <b>${oldDomain}</b>\nNew: <b>${newDomain}</b>`)
    } catch {}

    log(`[Panel] set-primary SUCCESS — ${req.cpUser}: ${oldDomain} → ${newDomain}`)
    return res.json({ success: true, oldDomain, newDomain, token, domain: newDomain })
  })

  // ─── Account: Cancel Hosting Plan ───────────────────────
  // Mirrors the Telegram bot's confirmCancelHostingPlan flow.
  // Body: { confirm: 'CANCEL' } — must be the literal string to prevent accidents.
  router.post('/account/cancel', ...auth, async (req, res) => {
    const { confirm } = req.body || {}
    if (confirm !== 'CANCEL') {
      return res.status(400).json({ error: 'Confirmation phrase missing or incorrect.' })
    }

    const col = getCpanelCol()
    if (!col) return res.status(503).json({ error: 'Service starting up, try again shortly.' })

    const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
    if (!account) return res.status(404).json({ error: 'Account not found' })
    if (account.deleted) {
      return res.status(409).json({ error: 'This hosting plan has already been cancelled.' })
    }

    log(`[Panel] Cancel hosting plan request — cpUser=${req.cpUser}, domain=${account.domain}, chatId=${account.chatId}`)

    let terminated = false
    try {
      // 1. Terminate cPanel account on WHM
      terminated = await whmService.terminateAccount(req.cpUser)
    } catch (err) {
      log(`[Panel] Cancel: terminateAccount error: ${err.message}`)
    }

    // 2. Cloudflare cleanup for primary + every addon domain (best-effort)
    try {
      const antiRedService = require('./anti-red-service')
      const allDomains = [account.domain, ...(account.addonDomains || [])].filter(Boolean)
      const seen = new Set()
      for (const d of allDomains) {
        const key = (d || '').toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        try {
          await require('./hosting-dns-teardown').teardownHostingDomain({ col, domain: d, excludeId: account._id, tag: 'Panel' })
        } catch (cfErr) {
          log(`[Panel] Cancel: CF cleanup warning for ${d}: ${cfErr.message}`)
        }
      }
    } catch (err) {
      log(`[Panel] Cancel: CF cleanup top-level error: ${err.message}`)
    }

    // 3. Soft-delete record (preserves audit trail; scheduler skips deleted)
    try {
      await col.updateOne(
        { _id: account._id },
        { $set: { deleted: true, deletedAt: new Date(), deletedBy: 'user', cancelledByUser: true, cancelledFrom: 'panel', autoRenew: false } }
      )
    } catch (err) {
      log(`[Panel] Cancel: DB soft-delete error: ${err.message}`)
    }

    if (terminated) {
      try {
        notifier(`🚫 <b>Hosting plan cancelled by user (via web HostPanel)</b>\nUser: ${account.chatId}\nDomain: <b>${account.domain}</b>\nPlan: <code>${account.plan || 'N/A'}</code>\ncPanel: <code>${account.cpUser}</code>`)
      } catch {}
      return res.json({ success: true, domain: account.domain })
    }
    return res.status(500).json({ error: 'Failed to terminate hosting plan. Please try again or contact support.' })
  })

  // ─── Account: Site Status (online / maintenance / suspended) ────
  // GET → returns current state + plan billing info (so the UI can remind the user
  //       that taking the site offline does NOT pause billing).
  // POST { action: 'take_offline' | 'bring_online', mode?: 'maintenance'|'suspended' }
  router.get('/account/site-status', ...auth, async (req, res) => {
    const col = getCpanelCol()
    if (!col) return res.status(503).json({ error: 'Service starting up, try again shortly.' })
    const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const siteStatusService = require('./site-status-service')
    return res.json({
      status: siteStatusService.readStatus(account),
      domain: account.domain,
      plan: account.plan || null,
      expiryDate: account.expiryDate || null,
      autoRenew: account.autoRenew !== false,
      suspendedAt: account.suspendedAt || null,
      maintenanceModeAt: account.maintenanceModeAt || null,
      lastBroughtOnlineAt: account.lastBroughtOnlineAt || null,
    })
  })

  router.post('/account/site-status', ...auth, async (req, res) => {
    const { action, mode } = req.body || {}
    if (action !== 'take_offline' && action !== 'bring_online') {
      return res.status(400).json({ error: 'action must be take_offline or bring_online' })
    }
    if (action === 'take_offline' && mode !== 'maintenance' && mode !== 'suspended') {
      return res.status(400).json({ error: 'mode must be maintenance or suspended' })
    }

    const col = getCpanelCol()
    if (!col) return res.status(503).json({ error: 'Service starting up, try again shortly.' })
    const account = await col.findOne({ _id: req.cpUser.toLowerCase() })
    if (!account) return res.status(404).json({ error: 'Account not found' })
    if (account.deleted) return res.status(409).json({ error: 'This hosting plan has been cancelled.' })

    const siteStatusService = require('./site-status-service')
    const before = siteStatusService.readStatus(account)

    if (action === 'take_offline') {
      if (before !== 'online') {
        return res.status(409).json({ error: `Site is already ${before}.` })
      }
      let result
      try {
        result = (mode === 'suspended')
          ? await siteStatusService.suspend(account, `Taken offline by user via web panel (chatId ${account.chatId})`)
          : await siteStatusService.enableMaintenanceMode(account)
      } catch (err) {
        result = { ok: false, error: err.message }
      }
      if (!result?.ok) {
        return res.status(500).json({ error: result?.error || 'Failed to take site offline.' })
      }
      const update = (mode === 'suspended')
        ? { suspended: true, suspendedAt: new Date(), suspendedBy: 'user', suspendedFrom: 'panel', maintenanceMode: false }
        : { maintenanceMode: true, maintenanceModeAt: new Date(), maintenanceModeBy: 'user', maintenanceModeFrom: 'panel', suspended: false }
      await col.updateOne({ _id: account._id }, { $set: update })
      try {
        notifier(`🔌 <b>Site taken offline by user (via web HostPanel)</b>\nUser: ${account.chatId}\nDomain: <b>${account.domain}</b>\nMode: <code>${mode}</code>\ncPanel: <code>${account.cpUser}</code>`)
      } catch {}
      return res.json({ success: true, status: mode })
    }

    // action === 'bring_online'
    if (before === 'online') {
      return res.status(409).json({ error: 'Site is already online.' })
    }
    let result
    try {
      result = (before === 'suspended')
        ? await siteStatusService.unsuspend(account)
        : await siteStatusService.disableMaintenanceMode(account)
    } catch (err) {
      result = { ok: false, error: err.message }
    }
    if (!result?.ok) {
      return res.status(500).json({ error: result?.error || 'Failed to bring site online.' })
    }
    await col.updateOne(
      { _id: account._id },
      { $set: { suspended: false, maintenanceMode: false, lastBroughtOnlineAt: new Date() } }
    )
    try {
      notifier(`🌐 <b>Site brought back online by user (via web HostPanel)</b>\nUser: ${account.chatId}\nDomain: <b>${account.domain}</b>\nWas: <code>${before}</code>\ncPanel: <code>${account.cpUser}</code>`)
    } catch {}
    return res.json({ success: true, status: 'online' })
  })

  // ─── Email ──────────────────────────────────────────────

  router.get('/email', ...auth, async (req, res) => {
    const result = await cpProxy.listEmailAccounts(req.cpUser, req.cpPass, req.whmHost)
    res.json(result)
  })

  router.post('/email/create', ...auth, async (req, res) => {
    const { email, password, quota, domain } = req.body
    if (!email || !password || !domain) return res.status(400).json({ error: 'email, password, and domain are required' })
    const result = await cpProxy.createEmailAccount(req.cpUser, req.cpPass, email, password, quota, domain, req.whmHost)
    res.json(result)
  })

  router.post('/email/delete', ...auth, async (req, res) => {
    const { email, domain } = req.body
    if (!email || !domain) return res.status(400).json({ error: 'email and domain are required' })
    const result = await cpProxy.deleteEmailAccount(req.cpUser, req.cpPass, email, domain, req.whmHost)
    res.json(result)
  })

  router.post('/email/password', ...auth, async (req, res) => {
    const { email, password, domain } = req.body
    if (!email || !password || !domain) return res.status(400).json({ error: 'email, password, and domain required' })
    const result = await cpProxy.changeEmailPassword(req.cpUser, req.cpPass, email, password, domain, req.whmHost)
    res.json(result)
  })

  // ─── Stats ──────────────────────────────────────────────

  router.get('/stats', ...auth, async (req, res) => {
    const [quota, bandwidth] = await Promise.all([
      cpProxy.getQuotaInfo(req.cpUser, req.cpPass, req.whmHost),
      cpProxy.getBandwidthData(req.cpUser, req.cpPass, req.whmHost),
    ])
    res.json({ quota, bandwidth })
  })

  // ─── MySQL ──────────────────────────────────────────────
  //
  // Mirrors cPanel's "MySQL Databases" + "Remote MySQL" UI. All operations
  // go through UAPI's `Mysql` module via cpanel-proxy. Plan-level quotas are
  // enforced by the cPanel package (DBs, DB users), so we surface UAPI's
  // human-readable errors directly when the limit is hit.
  //
  // Gold-only: MySQL is a Golden-Anti-Red-HostPanel feature. Non-Gold users
  // get HTTP 403 with `{ goldOnly: true, isGold: false, plan }` so the
  // frontend can render the upgrade banner. The WHM package itself ALSO
  // enforces this via MAXSQL=0 on Premium/Weekly packages — this middleware
  // is defense-in-depth so direct API curls also fail cleanly.
  // ─── Plan-tier gates ───────────────────────────────────────────────
  //
  // requireGold:     Golden plan only (used by: Visitor Captcha, Geo blocking).
  // requireMysqlEligible: Premium Monthly OR Golden (NOT the 1-week trial).
  //                  MySQL was previously gated as gold-only, but the storefront
  //                  card for Premium Monthly explicitly advertises MySQL — so
  //                  the gate was widened to match the customer-facing promise.
  //                  ⚠️ Operator note: the underlying WHM packages still need
  //                  MAXSQL raised on the "Premium-Anti-Red-HostPanel-1-Month"
  //                  package (was MAXSQL=0). Until then, calls will succeed at
  //                  this gate but the WHM API will reject them at the cPanel
  //                  layer. Edit the package via WHM dashboard or via API:
  //                  `whmapi1 modifypkg name=Premium-Anti-Red-HostPanel-1-Month MAXSQL=unlimited`
  function requireGold(req, res, next) {
    if (req.cpIsGold) return next()
    return res.status(403).json({
      error: 'This feature is available on the Golden Anti-Red HostPanel plan only.',
      goldOnly: true,
      isGold: false,
      plan: req.cpPlan || '',
    })
  }
  function requireMysqlEligible(req, res, next) {
    const planLc = (req.cpPlan || '').toLowerCase()
    // Reject the 7-day trial only. Anything else (Premium Monthly, Gold, future tiers) is allowed.
    const isWeeklyTrial = /1-week|\bweek\b|\(7 days\)/.test(planLc) && !/month/.test(planLc)
    if (!isWeeklyTrial) return next()
    return res.status(403).json({
      error: 'MySQL databases require Premium Anti-Red HostPanel (1-Month) or Golden — upgrade to enable.',
      mysqlRequiresMonthly: true,
      currentPlan: req.cpPlan || '',
    })
  }
  const mysqlAuth = [...auth, requireMysqlEligible]
  const goldAuth = [...auth, requireGold]

  // List databases. Returns `{ data: { databases: [...], users: [...] } }`.
  router.get('/mysql/databases', ...mysqlAuth, async (req, res) => {
    let [databases, users] = await Promise.all([
      cpProxy.listDatabases(req.cpUser, req.cpPass, req.whmHost),
      cpProxy.listDatabaseUsers(req.cpUser, req.cpPass, req.whmHost),
    ])
    // WHM-root fallback when user-level auth is broken
    if (_isAuthBroken(databases) || _isAuthBroken(users)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] mysql/databases user-level auth broken for ${req.cpUser} → WHM-root fallback`)
        const [fbDbs, fbUsers] = await Promise.all([
          _isAuthBroken(databases) ? _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', 'list_databases', {}).catch(() => databases) : databases,
          _isAuthBroken(users) ? _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', 'list_users', {}).catch(() => users) : users,
        ])
        databases = fbDbs
        users = fbUsers
      }
    }
    res.json({ databases, users })
  })

  // ── MySQL WHM-root fallback helper ─────────────────────────────
  // Same concept as domain/subdomain/file routes: when user-level cPanel auth
  // is broken, retry the UAPI call via WHM root impersonation.
  async function _mysqlWithFallback(req, module, func, params, method = 'POST') {
    const proxyFnMap = {
      'create_database': () => cpProxy.createDatabase(req.cpUser, req.cpPass, params.name, req.whmHost),
      'delete_database': () => cpProxy.deleteDatabase(req.cpUser, req.cpPass, params.name, req.whmHost),
      'rename_database': () => cpProxy.renameDatabase(req.cpUser, req.cpPass, params.oldname, params.newname, req.whmHost),
      'repair_database': () => cpProxy.repairDatabase(req.cpUser, req.cpPass, params.name, req.whmHost),
      'check_database': () => cpProxy.checkDatabase(req.cpUser, req.cpPass, params.name, req.whmHost),
      'create_user': () => cpProxy.createDatabaseUser(req.cpUser, req.cpPass, params.name, params.password, req.whmHost),
      'delete_user': () => cpProxy.deleteDatabaseUser(req.cpUser, req.cpPass, params.name, req.whmHost),
      'set_password': () => cpProxy.setDatabaseUserPassword(req.cpUser, req.cpPass, params.user, params.password, req.whmHost),
      'rename_user': () => cpProxy.renameDatabaseUser(req.cpUser, req.cpPass, params.oldname, params.newname, req.whmHost),
      'set_privileges_on_database': () => cpProxy.setUserPrivilegesOnDatabase(req.cpUser, req.cpPass, params.user, params.database, params.privileges, req.whmHost),
      'revoke_privileges_on_database': () => cpProxy.revokeUserPrivilegesOnDatabase(req.cpUser, req.cpPass, params.user, params.database, req.whmHost),
      'list_users': () => cpProxy.listDatabaseUsers(req.cpUser, req.cpPass, req.whmHost),
    }
    let result = proxyFnMap[func] ? await proxyFnMap[func]() : await cpProxy[func]?.(req.cpUser, req.cpPass, req.whmHost)
    if (_isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] mysql/${func} user-level auth broken for ${req.cpUser} → WHM-root fallback`)
        try {
          result = await _uapiViaWhmRoot(whmApi, req.cpUser, module, func, params)
        } catch (e) {
          log(`[Panel] mysql/${func} WHM-root fallback error: ${e.message}`)
        }
      }
    }
    return result
  }

  router.post('/mysql/databases/create', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'create_database', { name: name.trim() })
    res.json(result)
  })

  router.post('/mysql/databases/delete', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'delete_database', { name })
    res.json(result)
  })

  router.post('/mysql/databases/rename', ...mysqlAuth, async (req, res) => {
    const { oldname, newname } = req.body
    if (!oldname || !newname) return res.status(400).json({ error: 'oldname and newname are required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'rename_database', { oldname, newname })
    res.json(result)
  })

  router.post('/mysql/databases/repair', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'repair_database', { name })
    res.json(result)
  })

  router.post('/mysql/databases/check', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'check_database', { name })
    res.json(result)
  })

  // DB Users
  router.get('/mysql/users', ...mysqlAuth, async (req, res) => {
    const result = await _mysqlWithFallback(req, 'Mysql', 'list_users', {}, 'GET')
    res.json(result)
  })

  router.post('/mysql/users/create', ...mysqlAuth, async (req, res) => {
    const { name, password } = req.body
    if (!name || !password) return res.status(400).json({ error: 'name and password are required' })
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'create_user', { name: name.trim(), password })
    res.json(result)
  })

  router.post('/mysql/users/delete', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'delete_user', { name })
    res.json(result)
  })

  router.post('/mysql/users/password', ...mysqlAuth, async (req, res) => {
    const { user, password } = req.body
    if (!user || !password) return res.status(400).json({ error: 'user and password are required' })
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'set_password', { user, password })
    res.json(result)
  })

  router.post('/mysql/users/rename', ...mysqlAuth, async (req, res) => {
    const { oldname, newname } = req.body
    if (!oldname || !newname) return res.status(400).json({ error: 'oldname and newname are required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'rename_user', { oldname, newname })
    res.json(result)
  })

  // Privileges
  router.post('/mysql/privileges/grant', ...mysqlAuth, async (req, res) => {
    const { user, database, privileges } = req.body
    if (!user || !database) return res.status(400).json({ error: 'user and database are required' })
    // Default to ALL PRIVILEGES if caller omits — matches cPanel's "Add User to Database" default.
    const privs = (Array.isArray(privileges) && privileges.length) ? privileges : ['ALL PRIVILEGES']
    const result = await _mysqlWithFallback(req, 'Mysql', 'set_privileges_on_database', { user, database, privileges: privs })
    res.json(result)
  })

  router.post('/mysql/privileges/revoke', ...mysqlAuth, async (req, res) => {
    const { user, database } = req.body
    if (!user || !database) return res.status(400).json({ error: 'user and database are required' })
    const result = await _mysqlWithFallback(req, 'Mysql', 'revoke_privileges_on_database', { user, database })
    res.json(result)
  })

  // Remote MySQL access hosts
  router.get('/mysql/remote-hosts', ...mysqlAuth, async (req, res) => {
    let result = await cpProxy.listMysqlRemoteHosts(req.cpUser, req.cpPass, req.whmHost)
    if (_isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] mysql/remote-hosts user-level auth broken for ${req.cpUser} → WHM-root fallback`)
        try { result = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', 'get_host_notes', {}) } catch (_) {}
      }
    }
    res.json(result)
  })

  router.post('/mysql/remote-hosts/add', ...mysqlAuth, async (req, res) => {
    const { host } = req.body
    if (!host || typeof host !== 'string') return res.status(400).json({ error: 'host is required' })
    const cleaned = host.trim()
    if (cleaned.length < 1 || cleaned.length > 60) {
      return res.status(400).json({ error: 'host must be 1-60 characters' })
    }
    let result = await cpProxy.addMysqlRemoteHost(req.cpUser, req.cpPass, cleaned, req.whmHost)
    if (_isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try { result = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', 'add_host', { host: cleaned }) } catch (_) {}
      }
    }
    res.json(result)
  })

  router.post('/mysql/remote-hosts/delete', ...mysqlAuth, async (req, res) => {
    const { host } = req.body
    if (!host) return res.status(400).json({ error: 'host is required' })
    let result = await cpProxy.deleteMysqlRemoteHost(req.cpUser, req.cpPass, host, req.whmHost)
    if (_isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        try { result = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', 'delete_host', { host }) } catch (_) {}
      }
    }
    res.json(result)
  })

  // phpMyAdmin SSO — returns a one-shot URL that lands the user inside
  // phpMyAdmin without leaking the cPanel origin IP. The URL is rewritten to
  // go through CPANEL_API_URL (CF tunnel). Frontend opens it in a new tab.
  router.get('/mysql/phpmyadmin', ...mysqlAuth, async (req, res) => {
    const result = await whmService.createUserSession(req.cpUser, 'phpMyAdmin', 'cpaneld')
    if (!result.success) {
      return res.status(502).json({
        status: 0,
        errors: [result.error || 'Could not open phpMyAdmin. Please try again.'],
      })
    }
    res.json({ status: 1, url: result.url, expires: result.expires })
  })

  // ─── Subdomains ─────────────────────────────────────────

  router.get('/subdomains', ...auth, async (req, res) => {
    const result = await _userCallWithHeal(req, (pass) => cpProxy.listSubdomains(req.cpUser, pass, req.whmHost), () => _selfHealCpPass(req, getCpanelCol))
    // WHM-root fallback when user-level auth is broken
    if (_isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] listSubdomains user-level auth broken for ${req.cpUser} → WHM-root fallback`)
        try {
          const fb = await whmApi.get('/cpanel', {
            params: {
              cpanel_jsonapi_user: req.cpUser,
              cpanel_jsonapi_apiversion: 2,
              cpanel_jsonapi_module: 'SubDomain',
              cpanel_jsonapi_func: 'listsubdomains',
            },
          })
          const subData = fb.data?.cpanelresult?.data || []
          log(`[Panel] listSubdomains WHM-root fallback SUCCESS for ${req.cpUser} (${subData.length} subdomains)`)
          return res.json({ status: 1, data: subData, errors: null })
        } catch (e) {
          log(`[Panel] listSubdomains WHM-root fallback error: ${e.message}`)
        }
      }
    }
    res.json(result)
  })

  router.post('/subdomains/create', ...auth, async (req, res) => {
    const { subdomain, rootdomain, dir } = req.body
    if (!subdomain || !rootdomain) return res.status(400).json({ error: 'subdomain and rootdomain are required' })

    // 1. Create subdomain in cPanel
    const result = await cpProxy.createSubdomain(req.cpUser, req.cpPass, subdomain, rootdomain, dir, req.whmHost)

    // 2. Create DNS record in Cloudflare for the subdomain
    try {
      const zone = await cfService.getZoneByName(rootdomain)
      if (zone) {
        const fqdn = `${subdomain}.${rootdomain}`
        // ORIGIN-LEAK HARDENED: Only create subdomain via tunnel CNAME.
        // Previously fell back to A → WHM_HOST when tunnel was unset, which leaked
        // the origin IP in public DNS (this is how `huntingtononlinebanking.it`
        // exposed 209.38.241.9 to Cloudflare's abuse forwarder).
        if (cfService.CF_TUNNEL_CNAME) {
          await cfService.createDNSRecord(zone.id, 'CNAME', fqdn, cfService.CF_TUNNEL_CNAME, 1, true)
          log(`[Panel] Created CF DNS CNAME for subdomain: ${fqdn} → ${cfService.CF_TUNNEL_CNAME} (tunnel)`)
        } else {
          log(`[Panel] ⚠️ CF_TUNNEL_CNAME not set — skipping DNS for ${fqdn} to avoid origin IP leak`)
        }
      }
    } catch (cfErr) {
      // Non-blocking — subdomain still works via wildcard if CF has one
      log(`[Panel] CF DNS for subdomain ${subdomain}.${rootdomain} warning: ${cfErr.message}`)
    }

    res.json(result)
  })

  // ─── Bulk subdomain creation ──────────────────────────────
  // Accepts { subdomains: string | string[], rootdomain: string }
  // subdomains can be comma-separated string or array
  router.post('/subdomains/bulk-create', ...auth, async (req, res) => {
    let { subdomains, rootdomain } = req.body
    if (!rootdomain) return res.status(400).json({ error: 'rootdomain is required' })

    // Parse comma-separated string into array
    if (typeof subdomains === 'string') {
      subdomains = subdomains.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean)
    }
    if (!Array.isArray(subdomains) || subdomains.length === 0) {
      return res.status(400).json({ error: 'subdomains array is required (comma-separated or array)' })
    }
    if (subdomains.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 subdomains per bulk operation' })
    }

    // Validate subdomain names
    const validSubRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
    const invalid = subdomains.filter(s => !validSubRe.test(s))
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid subdomain names: ${invalid.join(', ')}` })
    }

    // Deduplicate
    const uniqueSubs = [...new Set(subdomains.map(s => s.toLowerCase()))]

    const results = []
    for (const subdomain of uniqueSubs) {
      try {
        // 1. Create in cPanel
        const result = await cpProxy.createSubdomain(req.cpUser, req.cpPass, subdomain, rootdomain, null, req.whmHost)
        const ok = result?.status === 1 || (result?.data?.[0]?.result === 1)

        // 2. Create CF DNS (non-blocking)
        if (ok) {
          try {
            const zone = await cfService.getZoneByName(rootdomain)
            if (zone && cfService.CF_TUNNEL_CNAME) {
              const fqdn = `${subdomain}.${rootdomain}`
              await cfService.createDNSRecord(zone.id, 'CNAME', fqdn, cfService.CF_TUNNEL_CNAME, 1, true)
              log(`[Panel] Bulk: CF DNS CNAME for ${fqdn} → tunnel`)
            }
          } catch (cfErr) {
            log(`[Panel] Bulk: CF DNS for ${subdomain}.${rootdomain} warning: ${cfErr.message}`)
          }
        }

        results.push({
          subdomain,
          fqdn: `${subdomain}.${rootdomain}`,
          success: ok,
          error: ok ? null : (result?.errors?.[0] || result?.data?.[0]?.reason || 'Unknown error'),
        })
      } catch (err) {
        results.push({
          subdomain,
          fqdn: `${subdomain}.${rootdomain}`,
          success: false,
          error: err.message || 'Request failed',
        })
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    log(`[Panel] Bulk subdomain create: ${succeeded} ok, ${failed} failed out of ${uniqueSubs.length} (user: ${req.cpUser}, root: ${rootdomain})`)

    res.json({ results, summary: { total: uniqueSubs.length, succeeded, failed } })
  })

  router.post('/subdomains/delete', ...auth, async (req, res) => {
    const { subdomain } = req.body
    if (!subdomain) return res.status(400).json({ error: 'subdomain is required' })

    // 1. Delete subdomain from cPanel
    const result = await cpProxy.deleteSubdomain(req.cpUser, req.cpPass, subdomain, req.whmHost)

    // 2. Clean up CF DNS record for the deleted subdomain
    try {
      // subdomain format from cPanel: "sub.rootdomain.com" or just "sub" with cpDomain as root
      const rootdomain = req.cpDomain
      const fqdn = subdomain.includes('.') ? subdomain : `${subdomain}.${rootdomain}`
      const rootOfFqdn = fqdn.split('.').slice(1).join('.') // e.g. "rootdomain.com" from "sub.rootdomain.com"
      const zone = await cfService.getZoneByName(rootOfFqdn) || await cfService.getZoneByName(rootdomain)
      if (zone) {
        const records = await cfService.listDNSRecords(zone.id)
        const matching = records.filter(r => r.name === fqdn)
        for (const record of matching) {
          await cfService.deleteDNSRecord(zone.id, record.id)
          log(`[Panel] Deleted CF DNS ${record.type} record for subdomain: ${fqdn}`)
        }
      }
    } catch (cfErr) {
      log(`[Panel] CF DNS cleanup for deleted subdomain warning: ${cfErr.message}`)
    }

    res.json(result)
  })

  // ─── Domain NS Status ──────────────────────────────────

  router.get('/domains/ns-status', ...auth, async (req, res) => {
    const { domain } = req.query
    if (!domain) return res.status(400).json({ error: 'domain query param is required' })
    try {
      const chatId = req.cpChatId
      const db = getCpanelCol()?.s?.db
      const domainService = require('./domain-service')
      const opService = require('./op-service')
      const WHM_HOST = req.whmHost || process.env.WHM_HOST

      // 1. Check if domain is managed by our platform (registered through our registrar)
      let autoManaged = false
      let domainMeta = null
      if (db) {
        domainMeta = await domainService.getDomainMeta(domain, db)
        if (domainMeta) {
          // Domain is in our DB — check if it belongs to this user (any of the
          // legacy/current ownership shapes — see isDomainOwnedByChat helper).
          const isChatIdMatch = await isDomainOwnedByChat(db, domain, chatId)
          // Domain is auto-managed if it's in our registrar (has registrar info) and belongs to this user
          autoManaged = !!(isChatIdMatch && domainMeta.registrar)
        }
      }

      // 2. Check Cloudflare zone
      let zone = await cfService.getZoneByName(domain)

      // 3. If no CF zone but domain IS ours — auto-create zone + update NS at registrar
      if (!zone && autoManaged && db) {
        log(`[Panel] NS-status: Auto-creating CF zone for own domain ${domain}`)
        try {
          const newZone = await cfService.createZone(domain)
          if (newZone.success) {
            // Clean up conflicting DNS records before creating hosting records
            const cleanupResult = await cfService.cleanupConflictingDNS(newZone.zoneId, domain)
            // If a Railway CNAME was deleted (shortener was active), also remove from Railway
            if (cleanupResult?.deleted?.some(r => require('./rl-save-domain-in-server').isShortenerDnsRecord(r))) {
              log(`[Panel] NS-status: Shortener CNAME detected — removing domain from Railway`)
              const { removeDomainFromRailway } = require('./rl-save-domain-in-server')
              await removeDomainFromRailway(domain).catch(e => log(`[Panel] Railway cleanup: ${e.message}`))
            }
            // Create hosting DNS records
            if (WHM_HOST) {
              await cfService.createHostingDNSRecords(newZone.zoneId, domain, WHM_HOST)
              await cfService.setSSLMode(newZone.zoneId, 'flexible')
              await cfService.enforceHTTPS(newZone.zoneId)
            }

            // NOTE: Worker routes are NOT deployed from a status-check endpoint.
            // Workers are deployed via deployFullProtection() during hosting provisioning
            // or via the /security/anti-red/deploy panel endpoint.

            // Update NS at registrar
            const registrar = domainMeta.registrar || 'OpenProvider'
            try {
              if (registrar === 'OpenProvider') {
                await opService.updateNameservers(domain, newZone.nameservers)
              } else if (registrar === 'ConnectReseller') {
                await domainService.postRegistrationNSUpdate(domain, 'ConnectReseller', 'cloudflare', newZone.nameservers, db)
              }
              log(`[Panel] NS-status: Auto-updated NS at ${registrar} for ${domain}`)
            } catch (nsErr) {
              log(`[Panel] NS-status: NS update at ${registrar} failed for ${domain}: ${nsErr.message}`)
            }

            // Persist cfZoneId + nameserverType in DB
            await db.collection('registeredDomains').updateOne(
              { _id: domain },
              { $set: { 'val.cfZoneId': newZone.zoneId, 'val.nameservers': newZone.nameservers, 'val.nameserverType': 'cloudflare' } }
            )
            await db.collection('domainsOf').updateOne(
              { domainName: domain },
              { $set: { nameservers: newZone.nameservers, nameserverType: 'cloudflare', cfZoneId: newZone.zoneId } },
              { upsert: false }
            )

            zone = { id: newZone.zoneId, name: domain }
          }
        } catch (err) {
          log(`[Panel] NS-status: Auto CF zone creation failed for ${domain}: ${err.message}`)
        }
      }

      // 4. No zone at all — external domain with no CF zone
      if (!zone) {
        return res.json({ status: 'not_found', nameservers: [], autoManaged: false, message: 'Domain not in Cloudflare' })
      }

      // 5. Get CF zone status
      const nsInfo = await cfService.checkZoneNSStatus(zone.id)
      const cfStatus = nsInfo.status || 'unknown'

      res.json({
        status: cfStatus,
        nameservers: nsInfo.nameservers || [],
        originalNameservers: nsInfo.originalNameservers || [],
        zoneId: zone.id,
        autoManaged,
      })
    } catch (err) {
      log(`[Panel] NS status error: ${err.message}`)
      res.status(500).json({ error: 'Failed to check NS status' })
    }
  })

  // ─── Add Domain Enhanced (auto-NS for platform domains) ─

  router.post('/domains/add-enhanced', ...auth, async (req, res) => {
    const { domain, subDomain, dir, mode } = req.body
    if (!domain) return res.status(400).json({ error: 'domain is required' })
    // Document-root mode chosen at add time:
    //   'mirror' → serve the SAME site as the primary (docroot = public_html)
    //   'own' (default) → its own folder (public_html/<domain>)
    const docMode = mode === 'mirror' ? 'mirror' : 'own'
    const effectiveDir = docMode === 'mirror'
      ? 'public_html'
      : (dir || `public_html/${String(domain).toLowerCase()}`)

    try {
      // ── Blocked domain check (phishing/abuse) ──
      try {
        const db = getCpanelCol()?.s?.db
        if (db) {
          const blockedCol = db.collection('blockedDomains')
          const blocked = await blockedCol.findOne({ domain: domain.toLowerCase() })
          if (blocked) {
            log(`[Panel] add-enhanced: BLOCKED domain rejected: ${domain} (reason: ${blocked.reason})`)
            return res.status(403).json({
              error: `This domain (${domain}) has been permanently blocked due to abuse policy violations and cannot be added.`,
              blocked: true,
            })
          }
        }
      } catch (blockErr) {
        log(`[Panel] add-enhanced: blocklist check error (non-blocking): ${blockErr.message}`)
      }

      // ── Addon domain limit enforcement ──
      try {
        const limitCol = getCpanelCol()
        if (limitCol) {
          const account = await limitCol.findOne({ _id: req.cpUser.toLowerCase() })
          if (account) {
            const { getAddonLimit } = require('./whm-service')
            const limit = getAddonLimit(account.plan)
            const currentAddons = (account.addonDomains || []).length
            if (limit !== -1 && currentAddons >= limit) {
              const isWeekly = (account.plan || '').toLowerCase().includes('week')
              const upgradeMsg = isWeekly
                ? `Domain limit reached (${limit} addon${limit !== 1 ? 's' : ''}). Upgrade to a monthly plan for more domains — use the Upgrade Plan button in your hosting details on the bot.`
                : `Domain limit reached (${limit} addon domains). Upgrade to Golden Anti-Red for unlimited domains.`
              return res.status(403).json({ error: upgradeMsg, limitReached: true, currentAddons, limit })
            }
          }
        }
      } catch (limitErr) {
        log(`[Panel] add-enhanced: limit check error (non-blocking): ${limitErr.message}`)
      }
      // 1. Add addon domain in cPanel
      const cpResult = await cpProxy.addAddonDomain(req.cpUser, req.cpPass, domain, subDomain, effectiveDir, req.whmHost)
      if (cpResult.errors?.length) {
        return res.json(cpResult)
      }

      // 1b. Persist addon domain in cpanelAccounts.addonDomains[] for protection-enforcer discovery
      try {
        const colPersist = getCpanelCol()
        if (colPersist) {
          await colPersist.updateOne(
            { _id: req.cpUser.toLowerCase() },
            {
              $addToSet: { addonDomains: domain.toLowerCase() },
              $set: { [`docrootModes.${domain.toLowerCase()}`]: docMode },
            }
          )
          log(`[Panel] add-enhanced: stored addon ${domain} (mode=${docMode}) in cpanelAccounts for ${req.cpUser}`)
        }
      } catch (dbErr) {
        log(`[Panel] add-enhanced: failed to persist addon ${domain}: ${dbErr.message}`)
      }

      // 2. Check if domain is on user's account (registeredDomains or domainsOf)
      const chatId = req.cpChatId || req.chatId
      const db = getCpanelCol()?.s?.db
      let isOwnDomain = await isDomainOwnedByChat(db, domain, chatId)

      // 3. Check if domain already has a Cloudflare zone
      let nsInfo = { status: 'external', nameservers: [], autoUpdated: false }
      const zone = await cfService.getZoneByName(domain)
      const WHM_HOST = req.whmHost || process.env.WHM_HOST

      if (zone) {
        // Clean up conflicting DNS records before creating hosting records
        await cfService.cleanupConflictingDNS(zone.id, domain)
        // Domain is on our Cloudflare — create hosting DNS records
        await cfService.createHostingDNSRecords(zone.id, domain, WHM_HOST)
        // Start with 'flexible' SSL so the site works immediately while AutoSSL issues a cert
        await cfService.setSSLMode(zone.id, 'flexible')
        await cfService.enforceHTTPS(zone.id)

        // Deploy full anti-red protection (Worker routes deployed as part of hosting)
        try {
          const antiRedService = require('./anti-red-service')
          const col = getCpanelCol()
          const account = col ? await col.findOne({ _id: req.cpUser.toLowerCase() }) : null

          // Retry up to 3 times with backoff
          const MAX_RETRIES = 3
          const RETRY_DELAYS = [5000, 15000, 45000]
          let deployed = false
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (account) {
                await antiRedService.deployFullProtection(req.cpUser, domain, account.plan || '')
              } else {
                await antiRedService.deploySharedWorkerRoute(domain, zone.id)
              }
              deployed = true
              log(`[Panel] add-enhanced: anti-red deployed for ${domain} (attempt ${attempt})`)
              break
            } catch (depErr) {
              log(`[Panel] add-enhanced: anti-red deploy attempt ${attempt}/${MAX_RETRIES} failed for ${domain}: ${depErr.message}`)
              if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]))
              }
            }
          }

          // Verify protection + notify on failure
          if (deployed) {
            setTimeout(async () => {
              try {
                const verification = await antiRedService.verifyProtection(domain)
                if (verification.active) {
                  log(`[Panel] add-enhanced: ✅ protection VERIFIED for ${domain}`)
                } else {
                  log(`[Panel] add-enhanced: ⚠️ protection deployed but NOT verified for ${domain}`)
                  if (account?.chatId) {
                    const bot = require('./_index')?._bot
                    if (bot) {
                      const lang = await getUserLang(account)
                      bot.sendMessage(account.chatId,
                        translation('t.antiRedWarningTitle', lang) + '\n' +
                        translation('t.antiRedWarningBodyShort', lang, domain),
                        { parse_mode: 'HTML' }
                      ).catch(() => {})
                    }
                  }
                }
              } catch (_) {}
            }, 30000)
          } else if (account?.chatId) {
            try {
              const bot = require('./_index')?._bot
              if (bot) {
                const lang = await getUserLang(account)
                bot.sendMessage(account.chatId,
                  translation('t.antiRedFailedTitle', lang) + '\n' +
                  translation('t.antiRedFailedBodyShort', lang, domain, MAX_RETRIES),
                  { parse_mode: 'HTML' }
                ).catch(() => {})
              }
            } catch (_) {}
          }
        } catch (_) {}

        // If domain is ours, auto-update NS at registrar if not already cloudflare
        if (isOwnDomain) {
          const domainService = require('./domain-service')
          const opService = require('./op-service')
          const meta = db ? await domainService.getDomainMeta(domain, db) : null
          if (meta && meta.nameserverType !== 'cloudflare') {
            try {
              const status0 = await cfService.checkZoneNSStatus(zone.id)
              const cfNS = status0.nameservers || []
              const registrar = meta.registrar || 'OpenProvider'
              if (cfNS.length >= 2) {
                if (registrar === 'OpenProvider') {
                  await opService.updateNameservers(domain, cfNS)
                } else if (registrar === 'ConnectReseller') {
                  await domainService.postRegistrationNSUpdate(domain, 'ConnectReseller', 'cloudflare', cfNS, db)
                }
                log(`[Panel] add-enhanced: Auto-updated NS at ${registrar} for existing zone ${domain}`)
              }
            } catch (err) {
              log(`[Panel] add-enhanced: NS auto-update for existing zone ${domain} failed: ${err.message}`)
            }
          }
        }

        const status = await cfService.checkZoneNSStatus(zone.id)
        nsInfo = {
          status: status.status || 'pending',
          nameservers: status.nameservers || [],
          autoUpdated: true,
          autoManaged: isOwnDomain,
          message: isOwnDomain
            ? 'DNS records auto-configured via Cloudflare. Nameservers managed automatically.'
            : 'DNS records auto-configured via Cloudflare',
        }
      } else {
        // No zone yet — create one
        const newZone = await cfService.createZone(domain)
        if (newZone.success) {
          await cfService.cleanupConflictingDNS(newZone.zoneId, domain)
          await cfService.createHostingDNSRecords(newZone.zoneId, domain, WHM_HOST)
          await cfService.setSSLMode(newZone.zoneId, 'flexible')
          await cfService.enforceHTTPS(newZone.zoneId)

          // Deploy full anti-red protection for hosting domain
          try {
            const antiRedService = require('./anti-red-service')
            const col = getCpanelCol()
            const account = col ? await col.findOne({ _id: req.cpUser.toLowerCase() }) : null
            if (account) {
              antiRedService.deployFullProtection(req.cpUser, domain, account.plan || '').catch(e =>
                log(`[Panel] add-enhanced: anti-red deploy warning for ${domain}: ${e.message}`)
              )
            } else {
              const { deploySharedWorkerRoute } = require('./anti-red-service')
              deploySharedWorkerRoute(domain, newZone.zoneId).catch(() => {})
            }
          } catch (_) {}

          if (isOwnDomain) {
            // Domain is on user's account — auto-update nameservers at registrar
            const domainService = require('./domain-service')
            const opService = require('./op-service')
            let nsResult = null
            try {
              const meta = db ? await domainService.getDomainMeta(domain, db) : null
              const registrar = meta?.registrar || 'OpenProvider'

              if (registrar === 'OpenProvider') {
                nsResult = await opService.updateNameservers(domain, newZone.nameservers)
              } else if (registrar === 'ConnectReseller') {
                nsResult = await domainService.postRegistrationNSUpdate(domain, 'ConnectReseller', 'cloudflare', newZone.nameservers, db)
              }

              log(`[Panel] Auto NS update for ${domain}: registrar=${registrar}, success=${!!nsResult?.success}`)
            } catch (err) {
              log(`[Panel] Auto NS update failed for ${domain}: ${err.message}`)
            }

            nsInfo = {
              status: nsResult?.success ? 'active' : 'pending',
              nameservers: newZone.nameservers || [],
              autoUpdated: true,
              autoManaged: true,
              message: nsResult?.success
                ? 'Cloudflare zone created and nameservers auto-updated at registrar'
                : 'Cloudflare zone created. Nameserver auto-update attempted — may take a few minutes to propagate.',
            }
          } else {
            // External domain — prompt user to update NS manually
            nsInfo = {
              status: 'pending',
              nameservers: newZone.nameservers || [],
              autoUpdated: false,
              message: 'Please update your domain nameservers to the ones shown below',
            }
          }
        }
      }

      // Schedule health check for addon domain (same 3-stage pipeline as primary domain)
      try {
        const healthCheck = require('./hosting-health-check')
        const chatIdForHealth = req.cpChatId || req.chatId || ''
        healthCheck.scheduleHealthCheck(domain, req.cpUser, chatIdForHealth)
        log(`[Panel] add-enhanced: health check scheduled for addon ${domain}`)
      } catch (_) {}

      // ── Persist CF state in registeredDomains (always, not just isOwnDomain) ──
      // Once the addon domain is linked to this user's cPanel and a CF zone exists,
      // the panel UI must be able to see `cfZoneId` + `nameserverType: cloudflare`
      // to enable AntiRed captcha controls. We also stamp `chatId` so future
      // ownership checks via `isDomainOwnedByChat` succeed reliably.
      try {
        const finalZone = await cfService.getZoneByName(domain)
        if (finalZone && db) {
          const cfNS = nsInfo?.nameservers?.length
            ? nsInfo.nameservers
            : (await cfService.checkZoneNSStatus(finalZone.id))?.nameservers || []
          const setFields = {
            'val.cfZoneId':       finalZone.id,
            'val.nameserverType': 'cloudflare',
          }
          if (cfNS.length) setFields['val.nameservers'] = cfNS
          if (chatId)       setFields['val.chatId']     = String(chatId)

          // ── Carry registrar/provider from domainsOf into registeredDomains ──
          // The addon-domain-flow NS-delegation step requires val.registrar to
          // decide whether to call opService.updateNameservers(). Without it,
          // new addon domains get "registrar unknown — skipping NS delegation"
          // → DENIC never delegates to CF. See eventiestopart.de incident 2026-06-28.
          if (chatId && db) {
            try {
              const domOfDoc = await db.collection('domainsOf').findOne(
                { domainName: domain, chatId: String(chatId) }
              )
              const reg = domOfDoc?.registrar
              if (reg) {
                setFields['val.registrar'] = reg
                setFields['val.provider']  = reg
              }
              if (domOfDoc?.opDomainId) {
                setFields['val.opDomainId'] = domOfDoc.opDomainId
              }
            } catch (_) { /* best-effort — NS delegation cron will heal later */ }
          }

          await db.collection('registeredDomains').updateOne(
            { _id: domain },
            { $set: setFields },
            { upsert: true }
          )
          // Also stamp the legacy domainsOf doc so isDomainOwnedByChat can find it later
          if (chatId) {
            const legacyKey = domain.replace(/\./g, '@')
            await db.collection('domainsOf').updateOne(
              { _id: String(chatId) },
              { $set: { [legacyKey]: true } },
              { upsert: true }
            )
          }
          log(`[Panel] add-enhanced: persisted cfZoneId/nameserverType=cloudflare for ${domain} (chatId=${chatId})`)
        }
      } catch (persistErr) {
        log(`[Panel] add-enhanced: registeredDomains persist warning for ${domain}: ${persistErr.message}`)
      }

      // ── Origin Hardening: Auth Origin Pulls + Origin CA cert ──
      // Runs async after response to avoid slowing down the addon domain flow
      const zoneIdForHarden = nsInfo?.zoneId || (await cfService.getZoneByName(domain))?.id
      if (zoneIdForHarden) {
        ;(async () => {
          try {
            // 1. Enable Authenticated Origin Pulls (blocks direct-IP/SNI access)
            await cfService.enableAuthenticatedOriginPulls(zoneIdForHarden)

            // 2. Generate + install Cloudflare Origin CA cert (prevents CT log IP exposure)
            const whmService = require('./whm-service')
            const certResult = await cfService.generateOriginCACert([domain, `*.${domain}`])
            if (certResult.success) {
              await whmService.installDomainSSL(req.cpUser, domain, certResult.certificate, certResult.privateKey)
              await whmService.excludeDomainsFromAutoSSL(req.cpUser, [domain, `www.${domain}`])
              log(`[Panel] add-enhanced: origin hardened for ${domain} (AOP + Origin CA + AutoSSL excluded)`)
            }
          } catch (hardenErr) {
            log(`[Panel] add-enhanced: origin hardening warning for ${domain}: ${hardenErr.message}`)
          }
        })()
      }

      res.json({
        ...cpResult,
        nsInfo,
      })
    } catch (err) {
      log(`[Panel] Enhanced add domain error: ${err.message}`)
      res.status(500).json({ error: 'Failed to add domain' })
    }
  })

  // ─── SSL Certificate Status ─────────────────────────────

  router.get('/domains/ssl', ...auth, async (req, res) => {
    try {
      const result = await cpProxy.getSSLStatus(req.cpUser, req.cpPass, req.whmHost)
      const hosts = result?.data || []
      const sslMap = {}

      for (const host of hosts) {
        const domain = host.servername || host.domain
        if (!domain) continue

        const cert = host.certificate || host
        const notAfter = cert.not_after
        const issuerObj = cert.issuer || {}
        const issuer = typeof issuerObj === 'object'
          ? (issuerObj.organizationName || issuerObj.commonName || issuerObj.O || JSON.stringify(issuerObj))
          : String(issuerObj)
        const isSelfSigned = cert.is_self_signed === 1 || cert.is_self_signed === '1'

        let expiresAt = null
        if (notAfter) {
          // notAfter can be epoch seconds (number) or a date string
          expiresAt = typeof notAfter === 'number'
            ? new Date(notAfter * 1000).toISOString()
            : new Date(notAfter).toISOString()
        }

        const now = Date.now()
        const expiryMs = expiresAt ? new Date(expiresAt).getTime() : 0
        const daysLeft = expiresAt ? Math.floor((expiryMs - now) / (1000 * 60 * 60 * 24)) : -1

        let status = 'none'
        if (expiresAt && expiryMs > now) {
          status = daysLeft <= 30 ? 'expiring' : 'valid'
        } else if (expiresAt) {
          status = 'expired'
        }

        sslMap[domain] = { status, issuer, expiresAt, daysLeft, selfSigned: isSelfSigned }
        // Map www variant too
        if (!domain.startsWith('www.')) {
          if (!sslMap[`www.${domain}`]) sslMap[`www.${domain}`] = sslMap[domain]
        }
      }

      // ─── Map addon domains to their cPanel subdomain certs + check Cloudflare SSL ─
      // Addon domains like "anbgateway.com" get mapped to "anbgatewaycom.maindomain.sbs" in cPanel.
      // If the cPanel subdomain has a valid cert, mark the addon domain as having SSL too.
      // Also check Cloudflare SSL for each addon domain.
      try {
        const domainsResult = await cpProxy.listDomains(req.cpUser, req.cpPass, req.whmHost)
        const addonDomains = domainsResult?.data?.addon_domains || []
        const mainDomain = req.cpDomain

        for (const addon of addonDomains) {
          if (sslMap[addon]) continue // Already has direct cert entry

          // cPanel maps "some.domain.com" → "somedomaincom.maindomain.sbs"
          const cpanelSub = addon.replace(/\./g, '') + '.' + mainDomain
          if (sslMap[cpanelSub]) {
            // Inherit the SSL status from the cPanel subdomain cert
            sslMap[addon] = { ...sslMap[cpanelSub], mappedFrom: cpanelSub }
          }

          // Check Cloudflare SSL for this addon domain's zone
          if (!sslMap[addon] || sslMap[addon].status === 'none') {
            try {
              const zone = await cfService.getZoneByName(addon)
              if (zone) {
                const axios = require('axios')
                const CF_BASE_URL = 'https://api.cloudflare.com/client/v4'
                const sslRes = await axios.get(`${CF_BASE_URL}/zones/${zone.id}/settings/ssl`, {
                  headers: {
                    'X-Auth-Email': process.env.CLOUDFLARE_EMAIL,
                    'X-Auth-Key': process.env.CLOUDFLARE_API_KEY,
                    'Content-Type': 'application/json',
                  },
                  timeout: 10000,
                })
                const cfMode = sslRes.data?.result?.value
                if (cfMode && cfMode !== 'off') {
                  sslMap[addon] = {
                    status: 'valid',
                    issuer: `Cloudflare (${cfMode})`,
                    expiresAt: null,
                    daysLeft: -1,
                    selfSigned: false,
                    cloudflare: true,
                    cfSSLMode: cfMode,
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (e) {
        log(`[Panel] Addon domain SSL mapping error: ${e.message}`)
      }

      // Also check Cloudflare SSL mode for the primary domain
      let cfSSLMode = null
      try {
        const zone = await cfService.getZoneByName(req.cpDomain)
        if (zone) {
          const axios = require('axios')
          const CF_BASE_URL = 'https://api.cloudflare.com/client/v4'
          const sslRes = await axios.get(`${CF_BASE_URL}/zones/${zone.id}/settings/ssl`, {
            headers: {
              'X-Auth-Email': process.env.CLOUDFLARE_EMAIL,
              'X-Auth-Key': process.env.CLOUDFLARE_API_KEY,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          })
          cfSSLMode = sslRes.data?.result?.value || null
        }
      } catch (_) {}

      res.json({ data: sslMap, cfSSLMode })
    } catch (err) {
      log(`[Panel] SSL status error: ${err.message}`)
      res.status(500).json({ error: 'Failed to check SSL status' })
    }
  })

  // ─── Trigger AutoSSL ───────────────────────────────────

  router.post('/domains/ssl/autossl', ...auth, async (req, res) => {
    try {
      const result = await whmService.startAutoSSL(req.cpUser)
      if (result.success) {
        res.json({ success: true, message: 'AutoSSL check started. Certificates will be issued shortly (may take 1-3 minutes).' })

        // After AutoSSL starts, schedule a check to upgrade CF SSL from 'flexible' → 'full'
        // once a non-self-signed cert is issued. 'full' is the target post-SSL-fix
        // (encrypts CF→origin and accepts AutoSSL/self-signed) and avoids HTTP 421 SNI
        // mismatches that 'strict' would cause. Protection-enforcer also handles this
        // on schedule, but doing it here accelerates the upgrade for this domain.
        const domain = req.cpDomain
        const cpUser = req.cpUser
        const cpPass = req.cpPass
        const whmHostForSSL = req.whmHost
        setTimeout(async () => {
          try {
            const zone = await cfService.getZoneByName(domain)
            if (!zone) return
            const sslResult = await cpProxy.getSSLStatus(cpUser, cpPass, whmHostForSSL)
            if (sslResult?.data?.length > 0) {
              const domainCert = sslResult.data.find(c =>
                c.domains?.some(d => d === domain || d === `www.${domain}` || d === `*.${domain}`)
              )
              const isSelfSigned = domainCert?.issuer?.organization_name === 'cPanel, Inc.'
                || domainCert?.issuer?.commonName?.includes(domain)
              if (domainCert && !isSelfSigned) {
                await cfService.setSSLMode(zone.id, 'full')
                log(`[Panel] SSL upgraded to 'full' for ${domain} (AutoSSL cert active)`)
              }
            }
          } catch (e) {
            log(`[Panel] SSL upgrade check for ${domain} failed: ${e.message}`)
          }
        }, 3 * 60 * 1000) // Check after 3 minutes
      } else {
        // Check if AutoSSL is already running (common when user clicks multiple times)
        const isAlreadyRunning = (result.error || '').includes('PIDFile') || (result.error || '').includes('already')
        if (isAlreadyRunning) {
          res.json({ success: true, message: 'AutoSSL is already running for your account. Certificates will be issued shortly.' })
        } else {
          res.status(500).json({ success: false, error: result.error || 'AutoSSL trigger failed' })
        }
      }
    } catch (err) {
      log(`[Panel] AutoSSL trigger error: ${err.message}`)
      res.status(500).json({ error: 'Failed to trigger AutoSSL' })
    }
  })

  // ─── Geo-blocking ──────────────────────────────────────

  // ─── Geo blocking ───────────────────────────────────────
  // Gold-only feature. Storefront's Golden card promises "Visitor Captcha + Geo"
  // — keeping the marketing honest by gating Geo to Gold here too.
  router.get('/geo', ...goldAuth, async (req, res) => {
    try {
      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.json({ rules: [], error: 'Domain not in Cloudflare' })
      const rules = await cfService.listFirewallRules(zone.id)
      // Filter to only geo rules
      const geoRules = rules.filter(r =>
        r.filter?.expression?.includes('ip.geoip.country')
      ).map(r => ({
        id: r.id,
        description: r.description || '',
        action: r.action,
        expression: r.filter?.expression || '',
        paused: r.paused || false,
      }))
      res.json({ rules: geoRules, zoneId: zone.id })
    } catch (err) {
      log(`[Panel] Geo list error: ${err.message}`)
      res.status(500).json({ error: 'Failed to fetch geo rules' })
    }
  })

  router.post('/geo/create', ...goldAuth, async (req, res) => {
    const { countries, mode, description } = req.body
    if (!countries?.length || !mode) {
      return res.status(400).json({ error: 'countries array and mode (block/allow) are required' })
    }
    try {
      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.status(400).json({ error: 'Domain not in Cloudflare' })
      const result = await cfService.createGeoRule(zone.id, countries, mode, description)
      res.json(result)
    } catch (err) {
      log(`[Panel] Geo create error: ${err.message}`)
      res.status(500).json({ error: 'Failed to create geo rule' })
    }
  })

  router.post('/geo/delete', ...goldAuth, async (req, res) => {
    const { ruleId } = req.body
    if (!ruleId) return res.status(400).json({ error: 'ruleId is required' })
    try {
      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.status(400).json({ error: 'Domain not in Cloudflare' })
      const result = await cfService.deleteFirewallRule(zone.id, ruleId)
      res.json(result)
    } catch (err) {
      log(`[Panel] Geo delete error: ${err.message}`)
      res.status(500).json({ error: 'Failed to delete geo rule' })
    }
  })

  // ─── Email Test ─────────────────────────────────────────

  router.post('/email/test', ...auth, async (req, res) => {
    const { from, to } = req.body
    if (!from || !to) return res.status(400).json({ error: 'from and to email addresses are required' })

    const domain = req.cpDomain
    const cpUser = req.cpUser
    const cpPass = req.cpPass
    const WHM_HOST = req.whmHost || process.env.WHM_HOST

    const mailOpts = {
      from: `"${domain} Test" <${from}@${domain}>`,
      to,
      subject: `Test Email from ${domain} - ${new Date().toISOString().split('T')[0]}`,
      text: `This is a test email sent from your hosting panel at ${domain}.\n\nIf you received this, your email configuration is working correctly.\n\nSent at: ${new Date().toISOString()}\ncPanel user: ${cpUser}`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#333">Email Test Successful</h2>
        <p>This is a test email sent from your hosting panel at <strong>${domain}</strong>.</p>
        <p style="color:#16a34a;font-weight:600">If you received this, your email configuration is working correctly.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="color:#888;font-size:12px">Sent at: ${new Date().toISOString()}<br>cPanel user: ${cpUser}</p>
      </div>`,
    }

    // Race multiple SMTP transports — first success wins
    const attempts = [
      { port: 465, secure: true, user: `${from}@${domain}`, pass: cpPass },
      { port: 25, secure: false, user: cpUser, pass: cpPass },
      { port: 587, secure: false, user: `${from}@${domain}`, pass: cpPass },
    ].map(cfg => {
      const t = nodemailer.createTransport({
        host: WHM_HOST, port: cfg.port, secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000, greetingTimeout: 5000, socketTimeout: 10000,
      })
      return t.sendMail(mailOpts).then(info => ({ success: true, info, port: cfg.port }))
    })

    try {
      const result = await Promise.any(attempts)
      res.json({
        success: true,
        messageId: result.info.messageId,
        accepted: result.info.accepted,
        message: `Test email sent successfully to ${to}`,
      })
    } catch (aggErr) {
      const lastErr = aggErr.errors?.[0]?.message || 'All SMTP connections failed'
      log(`[Panel] Email test all failed: ${lastErr}`)
      res.json({
        success: false,
        error: `SMTP connection failed: ${lastErr}`,
        hint: 'Ensure the email account exists and the cPanel server allows SMTP connections.',
      })
    }
  })

  // ─── Analytics ─────────────────────────────────────────

  router.get('/analytics', ...auth, async (req, res) => {
    const days = parseInt(req.query.days) || 7
    const detailed = req.query.detailed !== 'false' // default to detailed
    try {
      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.json({ success: false, error: 'Domain not in Cloudflare' })
      
      if (detailed) {
        const analytics = await cfService.getDetailedZoneAnalytics(zone.id, days)
        return res.json(analytics)
      }
      const analytics = await cfService.getZoneAnalytics(zone.id, days)
      res.json(analytics)
    } catch (err) {
      log(`[Panel] Analytics error: ${err.message}`)
      res.status(500).json({ error: 'Failed to fetch analytics' })
    }
  })

  // ─── Security: Anti-Bot & Anti-Red ──────────────────────

  /**
   * GET /security/status — full security status for the domain
   * Returns anti-bot settings + safe browsing status + blacklist check
   */
  router.get('/security/status', ...auth, async (req, res) => {
    try {
      const domain = req.cpDomain
      const antiRedService = require('./anti-red-service')

      // Run all checks in parallel
      const [zone, jsEnabled, sbResult, blResult] = await Promise.all([
        cfService.getZoneByName(domain).catch(() => null),
        antiRedService.isJSChallengeEnabled(req.cpUser).catch(() => false),
        safeBrowsing.checkDomain(domain).catch(() => ({ error: 'check failed' })),
        safeBrowsing.checkBlacklists(domain, { ip: req.whmHost || process.env.WHM_HOST }).catch(() => ({ error: 'check failed' })),
      ])

      // Check CF Worker route exists
      let cfWorkerActive = false
      if (zone) {
        try {
          const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
          const CF_KEY = process.env.CLOUDFLARE_API_KEY
          if (CF_EMAIL && CF_KEY) {
            const axios = require('axios')
            const routesRes = await axios.get(
              `https://api.cloudflare.com/client/v4/zones/${zone.id}/workers/routes`,
              { headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY }, timeout: 10000 }
            )
            cfWorkerActive = (routesRes.data?.result || []).some(
              r => r.pattern === `${domain}/*` || r.pattern === `*.${domain}/*`
            )
          }
        } catch (_) {}
      }

      // Check CF WAF rules exist
      let cfWafRulesActive = false
      if (zone) {
        try {
          const rules = await cfService.listFirewallRules(zone.id)
          cfWafRulesActive = rules && rules.length > 0
        } catch (_) {}
      }

      // Get CF anti-bot settings
      let antiBot = null
      if (zone) {
        try {
          antiBot = await cfService.getSecuritySettings(zone.id)
          antiBot.zoneId = zone.id
        } catch (_) {}
      }

      // Honeypot-off preference (Monthly-plan self-service toggle)
      let honeypotOff = false
      try {
        const dbh = getCpanelCol()?.s?.db
        if (dbh) {
          const hpDoc = await dbh.collection('registeredDomains').findOne({ _id: domain })
          honeypotOff = hpDoc?.val?.honeypotOff === true
        }
      } catch (_) {}

      const result = {
        antiBot,
        antiRed: { safeBrowsing: sbResult, blacklist: blResult },
        configured: { safeBrowsing: safeBrowsing.isConfigured() },
        plan: req.cpPlan,
        isGold: req.cpIsGold,
        captchaGoldOnly: true,
        geoGoldOnly: true,
        honeypotMonthlyOnly: true,
        isMonthly: req.cpIsMonthly,
        goldPrice: Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100),
        protectionLayers: {
          htaccessCloaking: true,
          scannerUaBlocking: true,
          jsChallenge: jsEnabled,
          cfWafRules: cfWafRulesActive,
          cfWorker: cfWorkerActive,
          honeypot: !honeypotOff,
        },
        stats: {
          scannerIpRanges: antiRedService.SCANNER_IP_RANGES.length,
          scannerUserAgents: antiRedService.SCANNER_USER_AGENTS.length,
          ja3Hashes: antiRedService.SCANNER_JA3_HASHES.length,
        },
      }

      res.json(result)
    } catch (err) {
      log(`[Panel] Security status error: ${err.message}`)
      res.status(500).json({ error: 'Failed to check security status' })
    }
  })

  /**
   * POST /security/anti-bot — set anti-bot profile
   * Body: { profile: 'off'|'low'|'medium'|'high'|'under_attack' }
   */
  router.post('/security/anti-bot', ...auth, async (req, res) => {
    try {
      const { profile } = req.body
      const allowed = ['off', 'low', 'medium', 'high', 'under_attack']
      if (!allowed.includes(profile)) {
        return res.status(400).json({ error: `Invalid profile. Use: ${allowed.join(', ')}` })
      }

      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.status(404).json({ error: 'Cloudflare zone not found for this domain' })

      const result = await cfService.setAntiBotProfile(zone.id, profile)
      res.json(result)
    } catch (err) {
      log(`[Panel] Anti-bot set error: ${err.message}`)
      res.status(500).json({ error: 'Failed to apply anti-bot profile' })
    }
  })

  /**
   * POST /security/anti-bot/rules — create anti-bot WAF rules (block bad crawlers)
   */
  router.post('/security/anti-bot/rules', ...auth, async (req, res) => {
    try {
      const zone = await cfService.getZoneByName(req.cpDomain)
      if (!zone) return res.status(404).json({ error: 'Cloudflare zone not found' })

      const result = await cfService.createAntiBotRules(zone.id)
      res.json(result)
    } catch (err) {
      log(`[Panel] Anti-bot rules error: ${err.message}`)
      res.status(500).json({ error: 'Failed to create anti-bot rules' })
    }
  })

  /**
   * GET /security/safe-browsing — check domain against Safe Browsing
   */
  router.get('/security/safe-browsing', ...auth, async (req, res) => {
    try {
      const result = await safeBrowsing.checkDomain(req.cpDomain)
      res.json(result)
    } catch (err) {
      log(`[Panel] Safe Browsing check error: ${err.message}`)
      res.status(500).json({ error: 'Failed to check Safe Browsing status' })
    }
  })

  /**
   * GET /security/blacklist — check domain IP against blacklists
   */
  router.get('/security/blacklist', ...auth, async (req, res) => {
    try {
      const result = await safeBrowsing.checkBlacklists(req.cpDomain, { ip: req.whmHost || process.env.WHM_HOST })
      res.json(result)
    } catch (err) {
      log(`[Panel] Blacklist check error: ${err.message}`)
      res.status(500).json({ error: 'Failed to check blacklists' })
    }
  })

  /**
   * POST /security/anti-red/deploy — deploy full anti-red protection
   * Deploys .htaccess rules, JS challenge, and JA3 fingerprinting
   */
  router.post('/security/anti-red/deploy', ...auth, async (req, res) => {
    try {
      const antiRedService = require('./anti-red-service')
      const account = req.cpAccount
      if (!account) return res.status(404).json({ error: 'Account not found' })

      const result = await antiRedService.deployFullProtection(account.cpUser, req.cpDomain, account.plan || '')
      res.json(result)
    } catch (err) {
      log(`[Panel] Anti-Red deploy error: ${err.message}`)
      res.status(500).json({ error: 'Failed to deploy anti-red protection' })
    }
  })

  /**
   * POST /security/anti-red/upgrade-worker — upgrade the shared worker to hardened version
   * This deploys the cookie-gated challenge worker that blocks scanners from seeing any content
   */
  router.post('/security/anti-red/upgrade-worker', ...auth, async (req, res) => {
    try {
      const antiRedService = require('./anti-red-service')
      const result = await antiRedService.upgradeSharedWorker()
      if (result.success) {
        res.json({ success: true, message: 'Shared worker upgraded to hardened cookie-gated challenge version' })
      } else {
        res.status(500).json({ success: false, error: result.error || 'Upgrade failed' })
      }
    } catch (err) {
      log(`[Panel] Worker upgrade error: ${err.message}`)
      res.status(500).json({ error: 'Failed to upgrade worker' })
    }
  })

  /**
   * POST /security/enforce-protection — run protection enforcement on all domains
   * Checks all domains in the system and deploys missing worker routes
   */
  router.post('/security/enforce-protection', ...auth, async (req, res) => {
    try {
      const enforcer = require('./protection-enforcer')
      const result = await enforcer.runEnforcement()
      res.json({ success: true, ...result })
    } catch (err) {
      log(`[Panel] Protection enforcement error: ${err.message}`)
      res.status(500).json({ error: 'Enforcement failed: ' + err.message })
    }
  })

  /**
   * GET /security/anti-red/status — check anti-red protection status
   */
  router.get('/security/anti-red/status', ...auth, async (req, res) => {
    try {
      const antiRedService = require('./anti-red-service')
      const jsEnabled = await antiRedService.isJSChallengeEnabled(req.cpUser)
      res.json({
        scannerIpRanges: antiRedService.SCANNER_IP_RANGES.length,
        scannerUserAgents: antiRedService.SCANNER_USER_AGENTS.length,
        ja3Hashes: antiRedService.SCANNER_JA3_HASHES.length,
        jsChallengeEnabled: jsEnabled,
        protectionLayers: ['htaccess_ip_cloaking', 'scanner_ua_blocking', 'js_challenge', 'ja3_fingerprinting', 'cf_waf_rules'],
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * POST /security/js-challenge/toggle — enable or disable JS challenge for this domain
   * Body: { enabled: true|false }
   * NOTE: Toggling JS challenge OFF does NOT affect other Anti-Red protections.
   *       Scanner IP cloaking, UA blocking, TLS fingerprinting all remain active.
   */
  router.post('/security/js-challenge/toggle', ...auth, async (req, res) => {
    try {
      // Gate to Golden Anti-Red HostPanel plans only
      if (!req.cpIsGold) {
        return res.status(403).json({
          error: 'Visitor Captcha is exclusive to Golden Anti-Red HostPanel plans.',
          captchaGoldOnly: true,
          isGold: false,
          plan: req.cpPlan,
          goldPrice: Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100),
          upgradeRequired: true,
        })
      }
      const antiRedService = require('./anti-red-service')
      const cfService = require('./cf-service')
      const { enabled } = req.body
      let result
      let workerResult = null

      if (enabled) {
        result = await antiRedService.deployJSChallenge(req.cpUser)
        // Add auto-prepend to .htaccess if not present
        if (result.success && result.prependDirective) {
          try {
            const WHM_HOST = req.whmHost || process.env.WHM_HOST
            const WHM_TOKEN = process.env.WHM_TOKEN
            // Route through the WHM tunnel for the default server — direct
            // IP:2087 is firewalled. Same fix as the delete fallback / panel
            // UAPI paths (@ciroovblzz regression report).
            const whmApiUrl = process.env.WHM_API_URL
            const whmBaseURL = (whmApiUrl && WHM_HOST === process.env.WHM_HOST)
              ? `${whmApiUrl.replace(/\/+$/, '')}/json-api`
              : `https://${WHM_HOST}:2087/json-api`
            if (WHM_HOST && WHM_TOKEN) {
              const whmApi = require('axios').create({
                baseURL: whmBaseURL,
                headers: {
                  Authorization: `whm ${process.env.WHM_USERNAME || 'root'}:${WHM_TOKEN}`,
                  ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
                    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
                    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
                  } : {}),
                },
                timeout: 30000,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
              })
              const readRes = await whmApi.get('/cpanel', {
                params: {
                  'api.version': 1,
                  cpanel_jsonapi_user: req.cpUser,
                  cpanel_jsonapi_apiversion: 3,
                  cpanel_jsonapi_module: 'Fileman',
                  cpanel_jsonapi_func: 'get_file_content',
                  dir: '/public_html',
                  file: '.htaccess',
                },
              })
              let htContent = readRes.data?.result?.data?.content || ''
              if (!htContent.includes('antired-challenge.php')) {
                htContent += result.prependDirective
                await whmApi.get('/cpanel', {
                  params: {
                    'api.version': 1,
                    cpanel_jsonapi_user: req.cpUser,
                    cpanel_jsonapi_apiversion: 3,
                    cpanel_jsonapi_module: 'Fileman',
                    cpanel_jsonapi_func: 'save_file_content',
                    dir: '/public_html',
                    file: '.htaccess',
                    content: htContent,
                  },
                })
              }
            }
          } catch (_) {}
        }
        // Re-deploy Cloudflare Worker routes so "Verify your browser" page shows
        try {
          const zone = await cfService.getZoneByName(req.cpDomain)
          if (zone) {
            workerResult = await antiRedService.deploySharedWorkerRoute(req.cpDomain, zone.id)
          }
        } catch (_) {}
        // Persist user preference: clear captcha-off flags so the visitor
        // challenge re-shows. We clear BOTH the legacy `antiRedOff` and the
        // current `visitorCaptchaOff` to make this idempotent regardless of
        // when the doc was first written.
        try {
          const db = getCpanelCol()?.s?.db
          if (db) {
            await db.collection('registeredDomains').updateOne(
              { _id: req.cpDomain },
              { $unset: {
                'val.antiRedOff': '',
                'val.antiRedOffAt': '',
                'val.visitorCaptchaOff': '',
              } }
            )
          }
        } catch (_) {}
        // Remove domain bypass from CF Worker KV (re-enable challenge at edge)
        try {
          const antiRedService = require('./anti-red-service')
          await antiRedService.setDomainChallengeBypass(req.cpDomain, false)
        } catch (_) {}
      } else {
        result = await antiRedService.removeJSChallenge(req.cpUser)
        // NOTE (2026-02): we no longer remove the CF Worker route when the
        // user toggles captcha off. The Worker must stay deployed so scanner
        // cloaking, honeypots, and IP bans continue to run. Only the human-
        // facing "Verifying your browser" page is hidden (via the KV bypass
        // flag below). Previously this called removeWorkerRoutes() which
        // killed all anti-red layers — see verify-navy.com incident.
        // Persist user preference: mark only the captcha page as OFF
        try {
          const db = getCpanelCol()?.s?.db
          if (db) {
            await db.collection('registeredDomains').updateOne(
              { _id: req.cpDomain },
              {
                $set: { 'val.visitorCaptchaOff': true },
                $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '' },
              }
            )
          }
        } catch (_) {}
        // Set domain bypass in CF Worker KV (disable the challenge PAGE at the
        // edge — Step 7 of the worker — but Steps 1-6 including scanner cloaking
        // still run for everyone).
        try {
          const antiRedService = require('./anti-red-service')
          await antiRedService.setDomainChallengeBypass(req.cpDomain, true)
        } catch (_) {}
      }

      res.json({
        jsChallengeEnabled: !!enabled,
        workerRoutes: workerResult,
        alwaysActive: [
          'Scanner IP cloaking (35+ scanner IP ranges)',
          'Scanner UA blocking (20 scanner user-agents)',
          'TLS/JA3 fingerprinting (Cloudflare WAF)',
          'Cloudflare anti-bot profile',
        ],
        ...result,
      })
    } catch (err) {
      log(`[Panel] JS Challenge toggle error: ${err.message}`)
      res.status(500).json({ error: 'Failed to toggle JS challenge' })
    }
  })

  /**
   * POST /security/honeypot/toggle — enable or disable honeypot traps for this domain
   * Body: { enabled: true|false }  (enabled = traps ON)
   * Monthly-plan feature (Premium or Golden monthly). Turning traps OFF only
   * suppresses the hidden decoy markup via the CF Worker KV flag — Visitor
   * Captcha, scanner cloaking, IP bans and WAF all keep running.
   */
  router.post('/security/honeypot/toggle', ...auth, async (req, res) => {
    try {
      const { isWeeklyPlan } = require('./hosting-scheduler')
      if (isWeeklyPlan(req.cpPlan || '')) {
        return res.status(403).json({
          error: 'Honeypot Traps management is available on Monthly plans (Premium or Golden).',
          honeypotMonthlyOnly: true,
          isMonthly: false,
          plan: req.cpPlan,
          upgradeRequired: true,
        })
      }
      const antiRedService = require('./anti-red-service')
      const { enabled } = req.body
      const off = !enabled
      const result = await antiRedService.setDomainHoneypot(req.cpDomain, off)
      if (!result?.success) {
        return res.status(500).json({ error: result?.error || 'Failed to toggle Honeypot Traps' })
      }
      // Persist preference so the panel + bot reflect the same state
      try {
        const db = getCpanelCol()?.s?.db
        if (db) {
          await db.collection('registeredDomains').updateOne(
            { _id: req.cpDomain },
            off ? { $set: { 'val.honeypotOff': true } } : { $unset: { 'val.honeypotOff': '' } },
            { upsert: true }
          )
        }
      } catch (_) {}
      res.json({
        honeypotEnabled: !!enabled,
        alwaysActive: [
          'Visitor Captcha (if enabled)',
          'Scanner IP cloaking',
          'Scanner UA blocking',
          'Cloudflare WAF anti-bot rules',
        ],
      })
    } catch (err) {
      log(`[Panel] Honeypot toggle error: ${err.message}`)
      res.status(500).json({ error: 'Failed to toggle Honeypot Traps' })
    }
  })

  /**
   * GET /security/js-challenge/status — check if JS challenge is enabled for this domain
   */
  router.get('/security/js-challenge/status', ...auth, async (req, res) => {
    try {
      const antiRedService = require('./anti-red-service')
      const enabled = await antiRedService.isJSChallengeEnabled(req.cpUser)
      res.json({ enabled })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * GET /security/captcha/status — Visitor Captcha status for ALL domains under this account.
   * Returns { isGold, plan, captchaGoldOnly, domains: [{ domain, enabled, hasCloudflare, isMain }] }
   */
  router.get('/security/captcha/status', ...auth, async (req, res) => {
    try {
      const col = getCpanelCol()
      const db = col?.s?.db
      if (!db) return res.status(503).json({ error: 'Service starting up, try again shortly.' })

      const allDomains = [req.cpDomain, ...(req.cpAddonDomains || [])].filter(Boolean)
      const antiRedService = require('./anti-red-service')

      // Resolve each domain's CF state with DB-then-API fallback so addon
      // domains whose `val.cfZoneId` was never persisted still report the
      // correct `hasCloudflare` flag and let the user toggle the captcha.
      const domains = await Promise.all(allDomains.map(async d => {
        const cf = await antiRedService.resolveDomainCfState(d, db)
        return {
          domain: d,
          enabled: cf.hasCloudflare && !cf.isOff,
          hasCloudflare: cf.hasCloudflare,
          isMain: d === req.cpDomain,
        }
      }))

      res.json({
        isGold: req.cpIsGold,
        plan: req.cpPlan,
        captchaGoldOnly: true,
        goldPrice: Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100),
        botUrl: 'https://t.me/nomadlybot',
        domains,
      })
    } catch (err) {
      log(`[Panel] Captcha status error: ${err.message}`)
      res.status(500).json({ error: 'Failed to load Visitor Captcha status' })
    }
  })

  /**
   * POST /security/captcha/toggle — enable/disable Visitor Captcha for a SPECIFIC domain
   * Body: { domain: string, enabled: boolean }
   * Gated to Golden Anti-Red HostPanel plans.
   */
  router.post('/security/captcha/toggle', ...auth, async (req, res) => {
    try {
      // Gate to Golden Anti-Red HostPanel plans only
      if (!req.cpIsGold) {
        return res.status(403).json({
          error: 'Visitor Captcha is exclusive to Golden Anti-Red HostPanel plans.',
          captchaGoldOnly: true,
          isGold: false,
          plan: req.cpPlan,
          goldPrice: Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100),
          upgradeRequired: true,
        })
      }

      const { domain, enabled } = req.body || {}
      if (!domain || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'domain and enabled (boolean) are required.' })
      }

      // Domain must belong to this user (main domain or addon)
      const allDomains = [req.cpDomain, ...(req.cpAddonDomains || [])].filter(Boolean).map(d => d.toLowerCase())
      const target = String(domain).toLowerCase()
      if (!allDomains.includes(target)) {
        return res.status(403).json({ error: 'Domain does not belong to this account.' })
      }

      const col = getCpanelCol()
      const db = col?.s?.db
      if (!db) return res.status(503).json({ error: 'Service starting up, try again shortly.' })

      const antiRedService = require('./anti-red-service')
      // Resolve CF zone via DB-then-CF-API fallback so legacy addon domains
      // (whose `val.cfZoneId` was never persisted) can still be toggled.
      const cf = await antiRedService.resolveDomainCfState(target, db)
      if (!cf.hasCloudflare || !cf.zoneId) {
        return res.status(400).json({
          error: `Visitor Captcha requires Cloudflare nameservers. ${target} is not on Cloudflare.`,
          domain: target,
          enabled: false,
          hasCloudflare: false,
        })
      }
      const zoneId = cf.zoneId

      let workerResult = null
      if (enabled) {
        // Re-deploy worker (idempotent — also serves as self-heal if route was missing)
        workerResult = await antiRedService.deploySharedWorkerRoute(target, zoneId)
        if (workerResult?.success) {
          await db.collection('registeredDomains').updateOne(
            { _id: target },
            { $unset: {
              'val.antiRedOff': '',
              'val.antiRedOffAt': '',
              'val.visitorCaptchaOff': '',
            } }
          )
          try { await antiRedService.setDomainChallengeBypass(target, false) } catch (_) {}
        }
      } else {
        // NOTE (2026-02): we no longer remove the CF Worker route on captcha
        // disable. The Worker stays deployed so scanner cloaking + honeypots
        // + IP bans + WAF still run. Only the human "Verifying your browser"
        // page is hidden (via the KV bypass flag below).
        // Make sure the Worker route IS deployed (idempotent self-heal) — if
        // a prior version of the code removed it, restore it now.
        workerResult = await antiRedService.deploySharedWorkerRoute(target, zoneId)
        if (workerResult?.success) {
          await db.collection('registeredDomains').updateOne(
            { _id: target },
            {
              $set: { 'val.visitorCaptchaOff': true },
              $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '' },
            }
          )
          try { await antiRedService.setDomainChallengeBypass(target, true) } catch (_) {}
        }
      }

      if (!workerResult?.success) {
        return res.status(500).json({ error: workerResult?.error || 'Failed to update Visitor Captcha for this domain.' })
      }

      res.json({
        success: true,
        domain: target,
        enabled,
        hasCloudflare: true,
      })
    } catch (err) {
      log(`[Panel] Captcha toggle error: ${err.message}`)
      res.status(500).json({ error: 'Failed to toggle Visitor Captcha' })
    }
  })

  return router
}

module.exports = {
  createCpanelRoutes,
  // Exposed for unit tests (debounced protection restore)
  scheduleProtectionRestore,
  isPublicHtmlPath,
  __setRestoreRunnerForTest,
  // Exposed for unit tests (cpPass self-heal wiring)
  _selfHealCpPass,
  _userCallWithHeal,
  _userWriteCallWithHeal,
  _repairCpPass,
  _isTerminalPasswdReason,
}
