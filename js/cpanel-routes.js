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

// ─── Shared WHM-root impersonation helpers (UAPI v3 / session / fileop) ──
//
// These let a route recover a user-level op that failed because the user's
// cPanel Basic Auth is dead (stale cpPass / cPHulk lockout / login-page HTML).
// The WHM root token authenticates; cpanel_jsonapi_user=<user> impersonates.
// They intentionally NEVER throw — a null/failed result lets the caller keep
// the ORIGINAL user-level error rather than masking it with a WHM transport
// error, so genuine "already exists" / bad-input errors still surface.

// UAPI (api.version 3) via WHM /json-api/cpanel. Unwraps r.data.result to the
// same { status, data, errors, messages, metadata } shape UAPI callers know.
async function _uapiViaWhmRoot(whmApi, cpUser, module, func, params = {}) {
  try {
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
    const result = r.data?.result || {}
    const errs = Array.isArray(result.errors) && result.errors.length ? result.errors : null
    return {
      status: result.status === 1 && !errs ? 1 : 0,
      data: result.data != null ? result.data : null,
      errors: errs,
      messages: result.messages != null ? result.messages : null,
      metadata: result.metadata != null ? result.metadata : null,
      reason: errs ? errs[0] : null,
      via: 'whm-fallback',
    }
  } catch (e) {
    return { status: 0, data: null, errors: [e.message], reason: e.message, via: 'whm-fallback-failed' }
  }
}

// UAPI via a WHM-minted cPanel login SESSION — required for get/save file
// content because the plain /json-api query-string wrapper mangles large or
// binary-ish file bodies. Ladder: create_user_session → cpsession cookie →
// /execute/<module>/<func>. GET for reads, POST (form-encoded) for writes.
// Reuses the CPANEL_API_URL tunnel when the session URL points at the default
// firewalled host (direct :2083 is unreachable on the shared box).
async function _uapiViaWhmSession(whmApi, cpUser, module, func, params = {}, method = 'POST') {
  const https = require('https')
  const axios = require('axios')
  const httpsAgent = new https.Agent({ rejectUnauthorized: false })
  const accessHeaders = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) ? {
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
  } : {}
  try {
    const sess = await whmApi.get('/create_user_session', {
      params: { 'api.version': 1, user: cpUser, service: 'cpaneld' },
    })
    if (sess.data?.metadata?.result !== 1 || !sess.data?.data?.session) {
      return { status: 0, data: null, errors: [sess.data?.metadata?.reason || 'create_user_session failed'], via: 'whm-session-failed' }
    }
    const sessionToken = sess.data.data.session
    const rawUrl = String(sess.data.data.url || '')
    const cpsessMatch = rawUrl.match(/\/(cpsess\d+)\//)
    const cpsessPath = cpsessMatch ? `/${cpsessMatch[1]}` : null
    if (!cpsessPath) return { status: 0, data: null, errors: ['could not extract cp_security_token from session url'], via: 'whm-session-failed' }
    // Prefer the CPANEL tunnel; else use the origin WHM returned.
    let cpBase = (process.env.CPANEL_API_URL || '').replace(/\/+$/, '')
    if (!cpBase) {
      const m = rawUrl.match(/^(https?:\/\/[^/]+)/)
      cpBase = m ? m[1] : null
    }
    if (!cpBase) return { status: 0, data: null, errors: ['no cPanel base URL for session'], via: 'whm-session-failed' }

    // Consume the session to capture the cpsession cookie (maxRedirects:0!).
    const loginRes = await axios.get(`${cpBase}${cpsessPath}/login/`, {
      params: { session: sessionToken },
      headers: accessHeaders,
      httpsAgent, timeout: 30000, maxRedirects: 0,
      validateStatus: s => s < 500,
    })
    const setCookies = loginRes.headers['set-cookie'] || []
    const cpsessionCookie = setCookies.map(c => (c.match(/cpsession=([^;]+)/) || [])[1]).find(Boolean)
    if (!cpsessionCookie) return { status: 0, data: null, errors: ['login step did not return a cpsession cookie'], via: 'whm-session-failed' }

    const execUrl = `${cpBase}${cpsessPath}/execute/${module}/${func}`
    const headers = { Cookie: `cpsession=${cpsessionCookie}`, ...accessHeaders }
    let execRes
    if (String(method).toUpperCase() === 'GET') {
      execRes = await axios.get(execUrl, { params, headers, httpsAgent, timeout: 60000, validateStatus: s => s < 500 })
    } else {
      const qs = require('querystring')
      execRes = await axios.post(execUrl, qs.stringify(params), {
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent, timeout: 60000, maxContentLength: 100 * 1024 * 1024, validateStatus: s => s < 500,
      })
    }
    if (typeof execRes.data === 'string' && /<!DOCTYPE html|<title>cPanel Login<\/title>/i.test(execRes.data)) {
      return { status: 0, data: null, errors: ['session execute returned login page — session invalid'], via: 'whm-session-failed' }
    }
    const body = execRes.data || {}
    const errs = Array.isArray(body.errors) && body.errors.length ? body.errors : null
    return {
      status: body.status === 1 && !errs ? 1 : 0,
      data: body.data != null ? body.data : null,
      errors: errs,
      messages: body.messages != null ? body.messages : null,
      metadata: body.metadata != null ? body.metadata : null,
      reason: errs ? errs[0] : null,
      via: 'whm-session-fallback',
    }
  } catch (e) {
    return { status: 0, data: null, errors: [e.message], reason: e.message, via: 'whm-session-failed' }
  }
}

// API2 Fileman::fileop as WHM root (rename/copy/move/compress). Returns
// { ok, dataArr, reason } so the caller can shape its own response.
async function _fileopViaWhmRoot(whmApi, cpUser, op, params = {}) {
  try {
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
    const dataArr = Array.isArray(cp.data) ? cp.data : (cp.data ? [cp.data] : [])
    const ok = (dataArr[0]?.result === 1) || cp.event?.result === 1
    const reason = dataArr[0]?.reason || cp.error || (ok ? null : `Failed to ${op}`)
    return { ok: !!ok, dataArr, reason }
  } catch (e) {
    return { ok: false, dataArr: [], reason: e.message }
  }
}

// MySQL op wrapper: run the user-level cPanel call (primaryFn thunk) and, if
// it comes back auth-broken, retry the SAME UAPI Mysql func as WHM root
// (cpanel_jsonapi_user impersonation). A non-auth error (e.g. "already
// exists", "does not exist") is returned untouched so it still surfaces.
async function _mysqlWithFallback(req, primaryFn, func, params = {}) {
  const result = await primaryFn()
  if (result?.status === 1 || !_isAuthBroken(result)) return result
  const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
  if (!whmApi) return result
  log(`[Panel] mysql ${func} user-level auth-broken → WHM fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
  const fb = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Mysql', func, params)
  return fb || result
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
// ─── Stale-cpPass detector — peer of _isEpermReason ─────────────────────
// User's cached cPanel password in Mongo no longer matches WHM's real
// password. Every user-level HTTP Basic Auth call fails at the transport
// (401 on UAPI, 403 "Access denied" on API2). The existing looksBroken gate
// only tripped on httpStatus >= 500 or EPERM strings, so 401/403 leaked to
// the panel as a raw "Access denied" instead of being routed through the
// WHM-root fallback ladder — which would have succeeded because root auth
// + cpanel_jsonapi_user impersonation sidesteps the stale password entirely.
// Confirmed on cpUser `nnliae74` (WHM 68.183.77.106) — @HHR2009 2026-08-26.
function _isAuthBroken(result) {
  if (!result || typeof result !== 'object') return false
  if (result.code === 'CPANEL_AUTH_FAILURE') return true
  if (result.httpStatus === 401 || result.httpStatus === 403) return true
  // Body-based tail: axios can strip the response body on some transports
  // (control-plane proxies) so the code tag may be missing even when the
  // classifier would have fired. Re-check the message directly.
  if (cpProxy.looksLikeAuthFailure
      && cpProxy.looksLikeAuthFailure(result.httpStatus, String(result.errors?.[0] || ''))) {
    return true
  }
  // Proxied HTML variant: the cpanel-proxy normalizer may hand us a result
  // whose errors[0] IS the raw login-page HTML (no httpStatus to key on).
  const first = Array.isArray(result.errors) ? result.errors[0] : (result.error || '')
  if (typeof first === 'string' && /<!DOCTYPE html>/i.test(first)) return true
  return false
}

// ─── Retired approaches (2026-08-26) ─────────────────────────────────────
// Two earlier iterations of the upload-path auth fallback are now RETIRED
// and MUST NOT be re-introduced here — they don't work in practice:
//
// (a) uploadFileAsRoot() — POST /json-api/cpanel?cpanel_jsonapi_user=X with
//     multipart form + "Authorization: whm root:$WHM_TOKEN". WHM's json-api
//     gateway silently strips multipart bodies → cPanel returns
//     "You must specify at least one file to upload". Dead end.
//     (Still exported from cpanel-proxy.js for legacy compat, not called
//      from any route.)
//
// (b) _repairCpPass() — rotate cpPass via WHM /passwd (api.version=1,
//     db_pass_update:0), persist encrypted, retry user-level upload.
//     /passwd returns "Password changed" but cpsrvd is still denying
//     Basic Auth even with the fresh password (cPHulk / auth-state
//     stickiness). Dead end.
//
// Current fix: cpProxy.uploadFileViaSession() — WHM impersonation session
// (create_user_session → cpsession cookie → multipart upload on the cPanel
// tunnel). See cpanel-proxy.js for the three-step ladder.
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
    let result = await cpProxy.listFiles(req.cpUser, req.cpPass, dir, req.whmHost)

    // ── EPERM handling — parity with /files/mkdir and /files/extract ──
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
    const looksBroken = result?.code === 'CPANEL_UAPI_EPERM' ||
      (result?.httpStatus && result.httpStatus >= 500) ||
      _isEpermReason(result?.errors?.[0]) ||
      _isAuthBroken(result)
    if (looksBroken) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        const initialReason = result?.errors?.[0] || 'unknown'
        const reasonTag = _isAuthBroken(result) ? 'user-auth-broken' : (result?.code === 'CPANEL_UAPI_EPERM' || _isEpermReason(initialReason) ? 'eperm' : 'http5xx')
        log(`[Panel] list_files user-level failed for ${dir} → WHM fallback (user: ${req.cpUser}, reason: ${initialReason}, tag: ${reasonTag})`)
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
    let result = await cpProxy.getFileContent(req.cpUser, req.cpPass, dir, file, req.whmHost)
    // Auth-broken (stale cpPass / login-page HTML) → recover via a WHM-minted
    // cPanel session. Without this the editor rendered the login page as
    // "file content". Plain json-api wrapper is a last resort (mangles content).
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/content user-level auth-broken → WHM session fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        let fb = await _uapiViaWhmSession(whmApi, req.cpUser, 'Fileman', 'get_file_content', { dir, file }, 'GET')
        if (fb?.status !== 1) {
          const fb2 = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Fileman', 'get_file_content', { dir, file })
          if (fb2?.status === 1) fb = fb2
        }
        if (fb?.status === 1) result = { ...fb, via: 'whm-session-fallback' }
        else if (fb) result = fb
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
    let result = await cpProxy.saveFileContent(req.cpUser, req.cpPass, dir, file, content, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/save user-level auth-broken → WHM session fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        let fb = await _uapiViaWhmSession(whmApi, req.cpUser, 'Fileman', 'save_file_content', { dir, file, content }, 'POST')
        if (fb?.status !== 1) {
          const fb2 = await _uapiViaWhmRoot(whmApi, req.cpUser, 'Fileman', 'save_file_content', { dir, file, content })
          if (fb2?.status === 1) fb = fb2
        }
        if (fb?.status === 1) result = { ...fb, via: 'whm-session-fallback' }
        else if (fb) result = fb
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
    let result = await cpProxy.uploadFile(req.cpUser, req.cpPass, dir, uploadName, req.file.buffer, req.whmHost)
    // WHM impersonation session fallback — the current upload-path fix for
    // stale-cpPass / cpsrvd-Basic-Auth-locked accounts.
    //
    // Retires two dead approaches:
    //   • uploadFileAsRoot() — WHM /json-api gateway strips multipart bodies
    //   • _repairCpPass() (/passwd rotation) — cpsrvd still denies Basic Auth
    //     even with the fresh password (cPHulk / underlying auth stickiness)
    //
    // uploadFileViaSession() uses WHM's create_user_session + cpsession
    // cookie to authenticate the upload on cPanel's own tunnel — sidesteps
    // both problems.
    if (result?.status !== 1 && _isAuthBroken(result)) {
      log(`[Panel] upload user-level auth-broken (status=${result?.httpStatus}, reason=${result?.errors?.[0] || '?'}) → WHM session fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
      const sessionResult = await cpProxy.uploadFileViaSession(req.cpUser, dir, uploadName, req.file.buffer, req.whmHost)
      if (sessionResult?.status === 1) {
        log(`[Panel] Upload recovered via WHM session: ${uploadName} → ${dir} (user: ${req.cpUser}, via: ${sessionResult.via})`)
      } else {
        log(`[Panel] Upload WHM session fallback also failed: ${uploadName} (user: ${req.cpUser}, via: ${sessionResult?.via || 'unknown'}) — ${sessionResult?.errors?.[0] || 'unknown'}`)
      }
      result = sessionResult
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

        const result = await cpProxy.uploadFile(req.cpUser, req.cpPass, dir, saveName, assembled, req.whmHost)
        // WHM impersonation session fallback — same as /files/upload above.
        // Retires _repairCpPass and uploadFileAsRoot for the upload path.
        let finalResult = result
        if (result?.status !== 1 && _isAuthBroken(result)) {
          log(`[Panel] Chunk upload user-level auth-broken (status=${result?.httpStatus}, reason=${result?.errors?.[0] || '?'}) → WHM session fallback (user: ${req.cpUser}, tag: user-auth-broken, id: ${uploadId})`)
          const sessionResult = await cpProxy.uploadFileViaSession(req.cpUser, dir, saveName, assembled, req.whmHost)
          if (sessionResult?.status === 1) {
            log(`[Panel] Chunk upload recovered via WHM session: ${saveName} → ${dir} (user: ${req.cpUser}, id: ${uploadId}, via: ${sessionResult.via})`)
          } else {
            log(`[Panel] Chunk upload WHM session fallback also failed: ${saveName} (user: ${req.cpUser}, id: ${uploadId}, via: ${sessionResult?.via || 'unknown'}) — ${sessionResult?.errors?.[0] || 'unknown'}`)
          }
          finalResult = sessionResult
        }
        return res.json({ ...finalResult, status: 'complete', cpanelStatus: finalResult?.status, ...(_cu.changed ? { renamedFrom: _cu.original, savedAs: saveName } : {}) })
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
    const result = await cpProxy.createDirectory(req.cpUser, req.cpPass, dir, name, req.whmHost)
    if (result?.status === 1) return res.json(_mk.changed ? { ...result, renamedFrom: _mk.original, savedAs: name } : result)

    // Attempt 2: WHM-root fallback for uapi EPERM / status-1 failures.
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
    const looksBroken =
      result?.code === 'CPANEL_UAPI_EPERM' ||
      (result?.httpStatus && result.httpStatus >= 500) ||
      result?.errors?.some(e => cpProxy.looksLikeUapiPermFailure && cpProxy.looksLikeUapiPermFailure(e)) ||
      _isAuthBroken(result)
    const whmApi = looksBroken ? _makeWhmApi(req.whmHost || process.env.WHM_HOST) : null

    if (whmApi) {
      const reasonTag = _isAuthBroken(result) ? 'user-auth-broken' : (result?.code === 'CPANEL_UAPI_EPERM' ? 'eperm' : 'http5xx')
      log(`[Panel] mkdir user-level failed for "${name}" in ${dir}, trying WHM fallback (user: ${req.cpUser}, reason: ${result?.errors?.[0] || 'unknown'}, tag: ${reasonTag})`)
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
      const result = await cpProxy.deleteFile(req.cpUser, req.cpPass, dir, file, req.whmHost, !!isDirectory)
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
    let result = await cpProxy.renameFile(req.cpUser, req.cpPass, dir, oldName, newName, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/rename user-level auth-broken → WHM fileop fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'rename', { sourcefiles: `${dir}/${oldName}`, destfiles: `${dir}/${newName}` })
        if (fb.ok) return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
        return res.status(500).json({ status: 0, error: `Rename failed: ${fb.reason}`, errors: [fb.reason] })
      }
    }
    res.json(result)
  })

  router.post('/files/extract', ...auth, async (req, res) => {
    const { dir, file, destDir } = req.body
    if (!dir || !file) return res.status(400).json({ error: 'dir and file are required' })
    const extractTarget = destDir || dir
    let result = await cpProxy.extractFile(req.cpUser, req.cpPass, dir, file, extractTarget, req.whmHost)

    // If the user-level extract failed with the broken-homedir class, try the
    // WHM root-as-user fallback (same fileop path delete uses), retrying the
    // EPERM class a couple of times for transient quota blips. If it still
    // fails EPERM, page ops + return a calm localized message.
    if (result?.status !== 1) {
      const failReason = result?.errors?.[0] || result?.error || 'unknown'
      const looksBroken = result?.code === 'CPANEL_UAPI_EPERM' ||
        (result?.httpStatus && result.httpStatus >= 500) || _isEpermReason(failReason) ||
        _isAuthBroken(result)
      const whmApi = looksBroken ? _makeWhmApi(req.whmHost || process.env.WHM_HOST) : null
      if (whmApi) {
        const reasonTag = _isAuthBroken(result) ? 'user-auth-broken' : (_isEpermReason(failReason) ? 'eperm' : 'http5xx')
        log(`[Panel] extract user-level failed for ${file} → WHM fallback (user: ${req.cpUser}, reason: ${failReason}, tag: ${reasonTag})`)
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
    let result = await cpProxy.compressFiles(req.cpUser, req.cpPass, dir, files, destFile, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/compress user-level auth-broken → WHM fileop fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'compress', { sourcefiles: files.map(f => `${dir}/${f}`).join('\n'), destfiles: `${dir}/${destFile}` })
        if (fb.ok) return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
        return res.status(500).json({ status: 0, error: `Compress failed: ${fb.reason}`, errors: [fb.reason] })
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
    let result = await cpProxy.copyFile(req.cpUser, req.cpPass, dir, file, destDir, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/copy user-level auth-broken → WHM fileop fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'copy', { sourcefiles: `${dir}/${file}`, destfiles: destDir })
        if (fb.ok) return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
        return res.status(500).json({ status: 0, error: `Copy failed: ${fb.reason}`, errors: [fb.reason] })
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
    let result = await cpProxy.moveFile(req.cpUser, req.cpPass, dir, file, destDir, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] files/move user-level auth-broken → WHM fileop fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        const fb = await _fileopViaWhmRoot(whmApi, req.cpUser, 'move', { sourcefiles: `${dir}/${file}`, destfiles: destDir })
        if (fb.ok) return res.json({ status: 1, data: fb.dataArr, errors: null, via: 'whm-fallback' })
        return res.status(500).json({ status: 0, error: `Move failed: ${fb.reason}`, errors: [fb.reason] })
      }
    }
    res.json(result)
  })

  // ─── Domains ────────────────────────────────────────────

  router.get('/domains', ...auth, async (req, res) => {
    let result = await cpProxy.listDomains(req.cpUser, req.cpPass, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] domains list user-level auth-broken → WHM fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        const fb = await _uapiViaWhmRoot(whmApi, req.cpUser, 'DomainInfo', 'list_domains', {})
        if (fb?.status === 1) result = { ...fb, via: 'whm-fallback' }
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

    // 1. Remove addon domain from cPanel (WHM-root fallback is inside removeAddonDomain)
    const result = await cpProxy.removeAddonDomain(req.cpUser, req.cpPass, domain, subDomain, req.cpDomain, req.whmHost)

    // Reconcile-vs-orphan guard (data-integrity fix): a domain that cPanel says
    // is already gone should still trigger our tracking cleanup, but a HARD
    // failure MUST NOT $pull from Mongo or wipe Cloudflare — otherwise the
    // domain is orphaned (removed from our records but still attached in
    // cPanel) and the user can never retry cleanly.
    const errText = String((result?.errors && result.errors[0]) || '').toLowerCase()
    const alreadyGone = /does\s*not\s*exist|not\s*found|is\s*not\s*an?\s*(addon|park)|no such/.test(errText)
    const succeeded = result?.status === 1 || alreadyGone

    if (!succeeded) {
      // HARD FAIL → keep everything, let the user retry.
      const statusCode = result?.code === 'CPANEL_DOWN' ? 503 : 502
      log(`[Panel] domains/remove HARD FAIL for ${domain} (user: ${req.cpUser}) — ${result?.errors?.[0] || 'unknown'} — NOT unpersisting (avoid orphan)`)
      return res.status(statusCode).json({
        status: 0,
        error: result?.errors?.[0] || 'Failed to remove addon domain',
        errors: result?.errors || ['Failed to remove addon domain'],
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
        log(`[Panel] Removed addon domain ${domain} from cpanelAccounts for ${req.cpUser}`)
      }
    } catch (dbErr) {
      log(`[Panel] remove: failed to unpersist addon ${domain}: ${dbErr.message}`)
    }

    // 3. Clean up Cloudflare: remove DNS records and Worker routes for the removed domain
    try {
      const zone = await cfService.getZoneByName(domain)
      if (zone) {
        // Remove Worker routes
        const antiRedService = require('./anti-red-service')
        await antiRedService.removeWorkerRoutes(domain, zone.id).catch(() => {})
        // Remove ALL hosting DNS records (root, www, mail, cpanel, webmail, webdisk, MX)
        await cfService.cleanupAllHostingRecords(zone.id, domain).catch(() => {})
        log(`[Panel] Cleaned up CF resources for removed domain: ${domain}`)
      }
    } catch (cfErr) {
      log(`[Panel] CF cleanup warning for removed domain ${domain}: ${cfErr.message}`)
    }

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
        const antiRedService = require('./anti-red-service')
        const zone = await cfService.getZoneByName(oldDomain)
        if (zone) {
          await antiRedService.removeWorkerRoutes(oldDomain, zone.id).catch(() => {})
          await cfService.cleanupAllHostingRecords(zone.id, oldDomain).catch(() => {})
          log(`[Panel] set-primary: cleaned up CF resources for old primary ${oldDomain}`)
        }
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
          const zone = await cfService.getZoneByName(d)
          if (zone) {
            await antiRedService.removeWorkerRoutes(d, zone.id).catch(() => {})
            await cfService.cleanupAllHostingRecords(zone.id, d).catch(() => {})
          }
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
    const [databases, users] = await Promise.all([
      _mysqlWithFallback(req, () => cpProxy.listDatabases(req.cpUser, req.cpPass, req.whmHost), 'list_databases', {}),
      _mysqlWithFallback(req, () => cpProxy.listDatabaseUsers(req.cpUser, req.cpPass, req.whmHost), 'list_users', {}),
    ])
    res.json({ databases, users })
  })

  router.post('/mysql/databases/create', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.createDatabase(req.cpUser, req.cpPass, name.trim(), req.whmHost), 'create_database', { name: name.trim() })
    res.json(result)
  })

  router.post('/mysql/databases/delete', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.deleteDatabase(req.cpUser, req.cpPass, name, req.whmHost), 'delete_database', { name })
    res.json(result)
  })

  router.post('/mysql/databases/rename', ...mysqlAuth, async (req, res) => {
    const { oldname, newname } = req.body
    if (!oldname || !newname) return res.status(400).json({ error: 'oldname and newname are required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.renameDatabase(req.cpUser, req.cpPass, oldname, newname, req.whmHost), 'rename_database', { oldname, newname })
    res.json(result)
  })

  router.post('/mysql/databases/repair', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.repairDatabase(req.cpUser, req.cpPass, name, req.whmHost), 'repair_database', { name })
    res.json(result)
  })

  router.post('/mysql/databases/check', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.checkDatabase(req.cpUser, req.cpPass, name, req.whmHost), 'check_database', { name })
    res.json(result)
  })

  // DB Users
  router.get('/mysql/users', ...mysqlAuth, async (req, res) => {
    const result = await _mysqlWithFallback(req, () => cpProxy.listDatabaseUsers(req.cpUser, req.cpPass, req.whmHost), 'list_users', {})
    res.json(result)
  })

  router.post('/mysql/users/create', ...mysqlAuth, async (req, res) => {
    const { name, password } = req.body
    if (!name || !password) return res.status(400).json({ error: 'name and password are required' })
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const result = await _mysqlWithFallback(req, () => cpProxy.createDatabaseUser(req.cpUser, req.cpPass, name.trim(), password, req.whmHost), 'create_user', { name: name.trim(), password })
    res.json(result)
  })

  router.post('/mysql/users/delete', ...mysqlAuth, async (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.deleteDatabaseUser(req.cpUser, req.cpPass, name, req.whmHost), 'delete_user', { name })
    res.json(result)
  })

  router.post('/mysql/users/password', ...mysqlAuth, async (req, res) => {
    const { user, password } = req.body
    if (!user || !password) return res.status(400).json({ error: 'user and password are required' })
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const result = await _mysqlWithFallback(req, () => cpProxy.setDatabaseUserPassword(req.cpUser, req.cpPass, user, password, req.whmHost), 'set_password', { user, password })
    res.json(result)
  })

  router.post('/mysql/users/rename', ...mysqlAuth, async (req, res) => {
    const { oldname, newname } = req.body
    if (!oldname || !newname) return res.status(400).json({ error: 'oldname and newname are required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.renameDatabaseUser(req.cpUser, req.cpPass, oldname, newname, req.whmHost), 'rename_user', { oldname, newname })
    res.json(result)
  })

  // Privileges
  router.post('/mysql/privileges/grant', ...mysqlAuth, async (req, res) => {
    const { user, database, privileges } = req.body
    if (!user || !database) return res.status(400).json({ error: 'user and database are required' })
    // Default to ALL PRIVILEGES if caller omits — matches cPanel's "Add User to Database" default.
    const privs = (Array.isArray(privileges) && privileges.length) ? privileges : ['ALL PRIVILEGES']
    const result = await _mysqlWithFallback(
      req,
      () => cpProxy.setUserPrivilegesOnDatabase(req.cpUser, req.cpPass, user, database, privs, req.whmHost),
      'set_privileges_on_database',
      { user, database, privileges: privs.join(',') },
    )
    res.json(result)
  })

  router.post('/mysql/privileges/revoke', ...mysqlAuth, async (req, res) => {
    const { user, database } = req.body
    if (!user || !database) return res.status(400).json({ error: 'user and database are required' })
    const result = await _mysqlWithFallback(
      req,
      () => cpProxy.revokeUserPrivilegesOnDatabase(req.cpUser, req.cpPass, user, database, req.whmHost),
      'revoke_privileges_on_database',
      { user, database },
    )
    res.json(result)
  })

  // Remote MySQL access hosts
  router.get('/mysql/remote-hosts', ...mysqlAuth, async (req, res) => {
    const result = await _mysqlWithFallback(req, () => cpProxy.listMysqlRemoteHosts(req.cpUser, req.cpPass, req.whmHost), 'get_remote_hosts', {})
    res.json(result)
  })

  router.post('/mysql/remote-hosts/add', ...mysqlAuth, async (req, res) => {
    const { host } = req.body
    if (!host || typeof host !== 'string') return res.status(400).json({ error: 'host is required' })
    // Basic shape check: IPv4, IPv4 wildcard (%), hostname, or %.example.com.
    // cPanel does its own validation server-side, this is just to catch obvious typos.
    const cleaned = host.trim()
    if (cleaned.length < 1 || cleaned.length > 60) {
      return res.status(400).json({ error: 'host must be 1-60 characters' })
    }
    const result = await _mysqlWithFallback(req, () => cpProxy.addMysqlRemoteHost(req.cpUser, req.cpPass, cleaned, req.whmHost), 'add_host', { host: cleaned })
    res.json(result)
  })

  router.post('/mysql/remote-hosts/delete', ...mysqlAuth, async (req, res) => {
    const { host } = req.body
    if (!host) return res.status(400).json({ error: 'host is required' })
    const result = await _mysqlWithFallback(req, () => cpProxy.deleteMysqlRemoteHost(req.cpUser, req.cpPass, host, req.whmHost), 'delete_host', { host })
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
    let result = await cpProxy.listSubdomains(req.cpUser, req.cpPass, req.whmHost)
    if (result?.status !== 1 && _isAuthBroken(result)) {
      const whmApi = _makeWhmApi(req.whmHost || process.env.WHM_HOST)
      if (whmApi) {
        log(`[Panel] subdomains list user-level auth-broken → WHM fallback (user: ${req.cpUser}, tag: user-auth-broken)`)
        try {
          const r = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: req.cpUser,
              cpanel_jsonapi_apiversion: 2,
              cpanel_jsonapi_module: 'SubDomain',
              cpanel_jsonapi_func: 'listsubdomains',
            },
          })
          const cp = r.data?.cpanelresult || {}
          if (!cp.error) {
            result = { status: 1, data: Array.isArray(cp.data) ? cp.data : [], errors: null, via: 'whm-fallback' }
          }
        } catch (e) {
          log(`[Panel] subdomains WHM fallback exception: ${e.message} (user: ${req.cpUser})`)
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

  // ── Bulk subdomain create — accepts a comma/newline-separated list ──
  // Body: { subdomains: string | string[], rootdomain }. Validates DNS-label
  // names, dedupes, caps at 50, then loops createSubdomain (WHM-root fallback
  // is built into cpProxy.createSubdomain) + best-effort tunnel CNAME.
  router.post('/subdomains/bulk-create', ...auth, async (req, res) => {
    const { subdomains, rootdomain } = req.body || {}
    if (!rootdomain) return res.status(400).json({ error: 'rootdomain is required' })
    const list = Array.isArray(subdomains) ? subdomains : String(subdomains || '').split(/[,\n\r]+/)
    const nameRx = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
    const seen = new Set()
    const clean = []
    for (let s of list) {
      s = String(s || '').trim().toLowerCase()
      if (!s || seen.has(s) || !nameRx.test(s)) continue
      seen.add(s)
      clean.push(s)
      if (clean.length >= 50) break
    }
    if (!clean.length) return res.status(400).json({ error: 'no valid subdomain names provided' })

    const results = []
    for (const sub of clean) {
      const r = await cpProxy.createSubdomain(req.cpUser, req.cpPass, sub, rootdomain, null, req.whmHost)
      const ok = r?.status === 1
      if (ok) {
        try {
          const zone = await cfService.getZoneByName(rootdomain)
          if (zone && cfService.CF_TUNNEL_CNAME) {
            await cfService.createDNSRecord(zone.id, 'CNAME', `${sub}.${rootdomain}`, cfService.CF_TUNNEL_CNAME, 1, true).catch(() => {})
          }
        } catch (_) { /* best-effort CF CNAME — non-blocking */ }
      }
      results.push({ subdomain: sub, fqdn: `${sub}.${rootdomain}`, ok, error: ok ? null : (r?.errors?.[0] || 'failed') })
    }
    const succeeded = results.filter(x => x.ok).length
    res.json({ status: 1, results, summary: { total: results.length, succeeded, failed: results.length - succeeded } })
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
        safeBrowsing.checkBlacklists(domain).catch(() => ({ error: 'check failed' })),
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

      const result = {
        antiBot,
        antiRed: { safeBrowsing: sbResult, blacklist: blResult },
        configured: { safeBrowsing: safeBrowsing.isConfigured() },
        plan: req.cpPlan,
        isGold: req.cpIsGold,
        captchaGoldOnly: true,
        geoGoldOnly: true,
        goldPrice: Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100),
        protectionLayers: {
          htaccessCloaking: true,
          scannerUaBlocking: true,
          jsChallenge: jsEnabled,
          cfWafRules: cfWafRulesActive,
          cfWorker: cfWorkerActive,
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
      const result = await safeBrowsing.checkBlacklists(req.cpDomain)
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
}
