// ============================================================
// Reseller API — cPanel Hosting Management  (js/reseller-hosting-mgmt.js)
// ------------------------------------------------------------
// Exposes, under the reseller API (/reseller/v1/hosting/:user/...), every
// IN-ACCOUNT cPanel user functionality that the web HostPanel (/panel) and the
// Telegram bot already offer — WITHOUT duplicating any business logic.
//
// It does this by reusing the EXACT SAME lower-level modules the panel routes
// call:
//   • cpanel-proxy.js  → Email / MySQL / Subdomains / Files / Domains / SSL / Stats
//   • whm-service.js   → AutoSSL trigger
//   • cf-service.js    → Geo rules, anti-bot profile, analytics
//   • safe-browsing-service.js → Safe-Browsing / blacklist checks
//   • anti-red-service.js      → Anti-Red deploy + Visitor-Captcha toggle
//
// Auth / ownership / billing model (inherited from reseller-api.js):
//   • apiKeyAuth binds the request to a single owner (chatId).
//   • loadOwnedCpanel(req, user) enforces that the account is owned by that key.
//   • cPanel password is read from the encrypted store (cpanel-auth.decrypt) —
//     the same source the panel's resolveCpPass middleware uses.
//   • Management ops are FREE (no wallet charge), like DNS management.
//   • SAFETY: on a dev/sandbox pod (SKIP_WEBHOOK_SYNC=true → isLive()===false)
//     every WRITE returns a dry-run envelope and never mutates the shared
//     production cPanel/WHM/Cloudflare state. READS run live on any pod (a read
//     is safe), mirroring the existing GET /hosting/:user behaviour.
// ============================================================

const cpProxy = require('./cpanel-proxy')
const cpAuth = require('./cpanel-auth')
const whmService = require('./whm-service')
const cfService = require('./cf-service')
const safeBrowsing = require('./safe-browsing-service')
const antiRed = require('./anti-red-service')
const siteStatusService = require('./site-status-service')       // site online/maintenance/suspended
const addonFlow = require('./addon-domain-flow')                 // runDnsAndProtection (set-primary background)
let nodemailer = null
try { nodemailer = require('nodemailer') } catch (_) { /* email/test unavailable if the dep is missing */ }

// Large-file chunked-upload assembly buffer (in-memory), keyed per
// owner+account+uploadId so two resellers can never collide. Mirrors the
// HostPanel /files/upload-chunk session map, but accepts base64 chunks over
// JSON (no multipart) which is far easier for a custom UI to drive.
const chunkSessions = new Map()
const CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024 // 100 MB hard cap
const CHUNK_SESSION_TTL_MS = 30 * 60 * 1000     // 30 min idle expiry
function _sweepChunkSessions() {
  const now = Date.now()
  for (const [k, s] of chunkSessions) { if (now - (s.touchedAt || s.createdAt || 0) > CHUNK_SESSION_TTL_MS) chunkSessions.delete(k) }
}

// ── Cloudflare DNS helpers for subdomains (best-effort, mirror HostPanel) ──
async function _cfCreateSubdomainDns(rootdomain, subdomain) {
  try {
    const zone = await cfService.getZoneByName(rootdomain)
    if (zone && cfService.CF_TUNNEL_CNAME) {
      // Tunnel CNAME only — never A→origin (prevents leaking the origin IP).
      await cfService.createDNSRecord(zone.id, 'CNAME', `${subdomain}.${rootdomain}`, cfService.CF_TUNNEL_CNAME, 1, true)
      return true
    }
  } catch (_) { /* non-blocking: subdomain still works via wildcard */ }
  return false
}
async function _cfDeleteSubdomainDns(rootdomain, fullSubOrLabel) {
  try {
    const fqdn = String(fullSubOrLabel).includes('.') ? fullSubOrLabel : `${fullSubOrLabel}.${rootdomain}`
    const rootOfFqdn = fqdn.split('.').slice(1).join('.')
    const zone = (await cfService.getZoneByName(rootOfFqdn)) || (await cfService.getZoneByName(rootdomain))
    if (zone) {
      const records = await cfService.listDNSRecords(zone.id)
      for (const r of (records || []).filter(rec => rec.name === fqdn)) {
        await cfService.deleteDNSRecord(zone.id, r.id)
      }
    }
  } catch (_) { /* best-effort cleanup */ }
}

// Files that back the Anti-Red protection — users must not clobber them.
// Mirrors cpanel-routes.js PROTECTED_FILES / isProtectedAntiRedFile.
const PROTECTED_FILES = ['.htaccess', '.user.ini', '.antired-challenge.php']
function isProtectedAntiRedFile(dir, file) {
  const inPublicHtml = dir && (String(dir).endsWith('/public_html') || String(dir).endsWith('/public_html/'))
  return !!inPublicHtml && PROTECTED_FILES.includes(file)
}

// Normalize a reseller-supplied path to an ABSOLUTE cPanel path under the
// account home (/home/<cpUser>/...).
//
// WHY (Bug #2): cPanel's API2 Fileman::fileop resolves a RELATIVE `destfiles`
// against the SOURCE file's directory, NOT $HOME. So an extract/copy with
// dir="public_html" and destfiles="public_html" landed in
// $HOME/public_html/public_html (path duplicated), and move/rename resolved to
// a non-existent/!owned directory → cPanel "Access denied". The HostPanel never
// hit this because it always sends absolute "/home/<user>/..." paths; this
// helper brings the reseller API to the identical contract. Verified live on
// namea3a5: with absolute paths extract lands in the exact dir and
// move/rename/copy all succeed (status:1).
//
// Accepts "public_html", "/public_html", "public_html/sub", "~/x", an already
// absolute "/home/<user>/x", or a foreign "/home/other/x" (re-rooted to THIS
// account's home as a safety measure). Empty/"~"/"." → the home dir itself.
function toAbsPath(cpUser, p) {
  const home = `/home/${cpUser}`
  let s = (p == null ? '' : String(p)).trim()
  if (!s || s === '~' || s === '.') return home
  if (s.startsWith('~/')) s = s.slice(2)
  if (s === home || s.startsWith(home + '/')) return s.replace(/\/+$/, '') || home
  s = s.replace(/^\/+/, '').replace(/^home\/[^/]+\/?/, '')
  const abs = `${home}/${s}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return abs || home
}

// Derive the same request context the panel's resolveCpPass middleware builds.
function ctxFromAccount(acct) {
  const cpUser = acct.cpUser || acct._id
  let cpPass = null
  try {
    if (acct.cpPass_encrypted && acct.cpPass_iv && acct.cpPass_tag) {
      cpPass = cpAuth.decrypt({ encrypted: acct.cpPass_encrypted, iv: acct.cpPass_iv, tag: acct.cpPass_tag })
    } else if (acct.cpPass || acct.password) {
      cpPass = acct.cpPass || acct.password
    }
  } catch (_) { cpPass = null }
  const cpPlan = acct.plan || ''
  const cpAddonDomains = (acct.addonDomains || [])
    .map(a => (typeof a === 'string' ? a : (a && a.domain) || ''))
    .filter(Boolean)
  return {
    cpUser,
    cpPass,
    whmHost: acct.whmHost || null,
    cpDomain: acct.domain || null,
    cpPlan,
    cpAddonDomains,
    cpIsGold: /Golden Anti-Red HostPanel/i.test(cpPlan),
  }
}

/**
 * Register all hosting-management routes onto the reseller router.
 * @param {object} deps
 *   router          express.Router() from createResellerApi
 *   apiKeyAuth      the API-key middleware (sets req.reseller.ownerChatId)
 *   h               async route wrapper (catches → 500)
 *   col             (name) => db.collection(name)
 *   getDb           () => db
 *   loadOwnedCpanel (req, username) => account | null  (ownership enforced)
 *   isLive          () => boolean
 *   mode            () => 'live' | 'dry_run'
 *   log             logger
 */
function registerHostingMgmtRoutes(deps) {
  const { router, apiKeyAuth, h, col, getDb, loadOwnedCpanel, isLive, mode, log } = deps

  // ── Ownership loader: returns account or sends 404 and returns null ──
  async function loadOwned(req, res) {
    const acct = await loadOwnedCpanel(req, req.params.user)
    if (!acct || acct.deleted) {
      res.status(404).json({ error: 'not_found', message: 'No hosting account with that username under your API key.' })
      return null
    }
    return acct
  }

  // ── Read context (needs live cPanel credentials) ──
  // Returns { acct, ...ctx } or sends 4xx and returns null.
  function withCreds(res, acct) {
    const ctx = ctxFromAccount(acct)
    if (!ctx.cpPass) {
      res.status(501).json({ error: 'no_credentials', message: 'cPanel password is not on file for this account; management via API is unavailable.' })
      return null
    }
    return { acct, ...ctx }
  }

  // ── Standard dry-run envelope for a WRITE that is blocked on the sandbox ──
  function dryRun(res, acct, action, extra = {}) {
    return res.json({
      ...extra,
      mode: 'dry_run',
      username: acct._id || acct.cpUser,
      action,
      note: 'Dry-run: input validated + ownership confirmed; no change was made on the cPanel/WHM/Cloudflare server. Set RESELLER_API_LIVE=true on a production pod to apply.',
    })
  }

  // ── File-Manager WRITE gate ──
  // Same as isLive(), but ALSO honours a narrow, opt-in RESELLER_FILEOPS_LIVE=true
  // escape so a sandbox pod can verify File-Manager behaviour against a real
  // OWNED account without un-gating any platform-level mutation — email / MySQL /
  // subdomain / domain / SSL-AutoSSL / security ops stay dry-run under isLive().
  // cPanel jails every fileop to the account home, so this is strictly
  // account-scoped. Defaults OFF (identical to prior behaviour); on a production
  // pod isLive() is already true so it is a no-op there.
  const fileOpsLive = () => isLive() || process.env.RESELLER_FILEOPS_LIVE === 'true'

  // ── MySQL plan gate (mirror requireMysqlEligible: reject 7-day trial only) ──
  function mysqlBlocked(res, ctx) {
    const planLc = (ctx.cpPlan || '').toLowerCase()
    const isWeeklyTrial = /1-week|\bweek\b|\(7 days\)/.test(planLc) && !/month/.test(planLc)
    if (!isWeeklyTrial) return false
    res.status(403).json({
      error: 'mysql_requires_monthly',
      message: 'MySQL databases require Premium Anti-Red HostPanel (1-Month) or Golden.',
      current_plan: ctx.cpPlan || '',
    })
    return true
  }

  // ── Gold gate (mirror requireGold: Geo + Visitor Captcha) ──
  function goldBlocked(res, ctx) {
    if (ctx.cpIsGold) return false
    res.status(403).json({
      error: 'gold_only',
      message: 'This feature is available on the Golden Anti-Red HostPanel plan only.',
      is_gold: false,
      plan: ctx.cpPlan || '',
    })
    return true
  }

  // Small helpers for reading params from body OR query (handy for DELETE).
  const bq = (req, key) => (req.body && req.body[key] != null ? req.body[key] : req.query[key])
  const missing = (res, ...pairs) => {
    for (const [name, val] of pairs) {
      if (val == null || val === '') { res.status(400).json({ error: 'missing_parameter', message: `'${name}' is required.` }); return true }
    }
    return false
  }

  // ════════════════════════════════════════════════════════
  // cPanel auth self-healing (File Manager / SSL / cPanel UAPI & API2)
  // ────────────────────────────────────────────────────────
  // Every File-Manager / SSL op below authenticates to cPanel with the
  // account's stored cpPass via HTTP Basic Auth. When that password has been
  // rotated on the panel side (the dominant real-world case), or the account
  // is under a cPHulk / session-security lockout, cpsrvd serves its HTML login
  // page instead of a UAPI JSON body → cpanel-proxy surfaces
  // `code: 'CPANEL_AUTH_FAILURE'` (httpStatus 401).
  //
  // The account-management endpoints (GET /login, /credentials) are unaffected
  // because they mint a WHM-root create_user_session and never touch the user's
  // password. `withCpAuthFallback` gives the File-Manager / SSL ops the SAME
  // escape hatch the HostPanel already uses: on CPANEL_AUTH_FAILURE, retry the
  // identical op impersonated as WHM root (or over a WHM-minted cpsession),
  // which bypasses the broken user password entirely.
  //
  // Verified live (server 68.183.77.106): the WHM-root api3 wrapper returns
  // both Fileman::list_files and SSL::installed_hosts for an account whose
  // Basic Auth was being refused.
  //
  // Contract: returns the HEALED result (status:1) when the fallback succeeds,
  // otherwise the ORIGINAL failure with `code` preserved so `sendCp` can still
  // report a real error (and so integrators keep seeing CPANEL_AUTH_FAILURE
  // when even root impersonation can't recover the account).
  async function withCpAuthFallback(primary, fallbackFn, label) {
    const result = await primary
    if (!result || result.code !== 'CPANEL_AUTH_FAILURE') return result
    try {
      log && log(`[Reseller] ${label}: user Basic Auth refused (CPANEL_AUTH_FAILURE) → retrying via WHM root/session impersonation`)
      const healed = await fallbackFn()
      if (healed && healed.status === 1) {
        log && log(`[Reseller] ${label}: recovered via ${healed.via || 'whm-fallback'}`)
        return { ...healed, healed: true, healed_via: healed.via || 'whm-fallback' }
      }
      // Fallback ran but didn't recover — keep the original auth error, note the attempt.
      return { ...result, session_fallback: (healed && healed.via) || 'unavailable' }
    } catch (e) {
      log && log(`[Reseller] ${label}: WHM fallback threw — ${e.message}`)
      return result
    }
  }

  // Send a cPanel-proxy result with an HTTP status that reflects upstream
  // failure, so integrators can detect errors from the status line instead of
  // parsing `status:0` / `httpStatus` out of an HTTP-200 body (secondary
  // API-contract fix requested in the File Manager/SSL bug report).
  //   • CPANEL_AUTH_FAILURE → 502 (cPanel refused us — an upstream problem;
  //     the reseller's own API-key auth succeeded, so 401/403 would mislead)
  //   • CPANEL_DOWN         → 503 (control plane unreachable)
  // All healthy results (and existing non-cPanel error envelopes) are unchanged.
  function sendCp(res, result) {
    if (result && result.code === 'CPANEL_AUTH_FAILURE') return res.status(502).json(result)
    if (result && result.code === 'CPANEL_DOWN') return res.status(503).json(result)
    return res.json(result)
  }

  // ════════════════════════════════════════════════════════
  // FILE-OP RECEIPTS  (before/after directory listings)
  // ────────────────────────────────────────────────────────
  // move/copy/extract/unzip return a concise `receipt` so integrators can
  // confirm placement WITHOUT a second request. Best-effort: listing failures
  // never break the underlying file operation (receipt is simply omitted).
  const okStatus = (r) => !!(r && (r.status === 1 || r.status === '1') && !r.code)

  // List a single ABSOLUTE directory → just the entry names (sorted), healing a
  // stale-cpPass account via the same WHM-root UAPI fallback GET /files uses.
  async function listDirNames(ctx, absDir) {
    try {
      const fparams = { dir: absDir, include_mime: 0, include_permissions: 0, include_hash: 0, include_content: 0, types: 'dir|file' }
      const result = await withCpAuthFallback(
        cpProxy.listFiles(ctx.cpUser, ctx.cpPass, absDir, ctx.whmHost),
        () => cpProxy.uapiViaWhmRoot(ctx.cpUser, 'Fileman', 'list_files', fparams, ctx.whmHost),
        'files.list(receipt)'
      )
      if (!result || (result.status !== 1 && result.status !== '1') || !Array.isArray(result.data)) return null
      return result.data.map(f => f && (f.file || f.fullname)).filter(Boolean).sort()
    } catch (_) { return null }
  }

  // Names present in `a` but not in `b` (compare by name).
  const diffNames = (a, b) => {
    if (!Array.isArray(a)) return []
    const bset = new Set(Array.isArray(b) ? b : [])
    return a.filter(x => !bset.has(x))
  }

  // Receipts are ON by default; callers opt out with { receipt:false } or ?receipt=false.
  const receiptDisabled = (req) =>
    (req.body && (req.body.receipt === false || req.body.receipt === 'false')) ||
    String((req.query && req.query.receipt) || '').toLowerCase() === 'false'

  // Snapshot dest (and optional source) dir BEFORE running `opFn`, snapshot
  // AFTER, and attach `receipt` when the op succeeded. `dirs` are ABSOLUTE paths.
  async function withReceipt(req, ctx, dirs, opFn) {
    const want = !receiptDisabled(req)
    const twoDirs = dirs.srcDir && dirs.srcDir !== dirs.destDir
    const destBefore = want ? await listDirNames(ctx, dirs.destDir) : null
    const srcBefore = want && twoDirs ? await listDirNames(ctx, dirs.srcDir) : null
    const result = await opFn()
    if (!want || !okStatus(result)) return result
    const destAfter = await listDirNames(ctx, dirs.destDir)
    const srcAfter = twoDirs ? await listDirNames(ctx, dirs.srcDir) : null
    const receipt = {
      dest: { dir: dirs.destDir, before: destBefore, after: destAfter, added: diffNames(destAfter, destBefore) },
    }
    if (twoDirs) {
      receipt.source = { dir: dirs.srcDir, before: srcBefore, after: srcAfter, removed: diffNames(srcBefore, srcAfter) }
    }
    return { ...result, receipt }
  }


  // ════════════════════════════════════════════════════════
  // EMAIL ACCOUNTS
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/email', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.listEmailAccounts(ctx.cpUser, ctx.cpPass, ctx.whmHost))
  }))

  router.post('/hosting/:user/email', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { email, password, quota, domain } = req.body || {}
    if (missing(res, ['email', email], ['password', password], ['domain', domain])) return
    if (!isLive()) return dryRun(res, acct, 'email.create', { email: `${email}@${domain}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.createEmailAccount(ctx.cpUser, ctx.cpPass, email, password, quota, domain, ctx.whmHost))
  }))

  router.delete('/hosting/:user/email', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const email = bq(req, 'email'); const domain = bq(req, 'domain')
    if (missing(res, ['email', email], ['domain', domain])) return
    if (!isLive()) return dryRun(res, acct, 'email.delete', { email: `${email}@${domain}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.deleteEmailAccount(ctx.cpUser, ctx.cpPass, email, domain, ctx.whmHost))
  }))

  router.put('/hosting/:user/email/password', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { email, password, domain } = req.body || {}
    if (missing(res, ['email', email], ['password', password], ['domain', domain])) return
    if (!isLive()) return dryRun(res, acct, 'email.password', { email: `${email}@${domain}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.changeEmailPassword(ctx.cpUser, ctx.cpPass, email, password, domain, ctx.whmHost))
  }))

  // ════════════════════════════════════════════════════════
  // STATS (disk quota + bandwidth)  — read, safe on any pod
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/stats', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    const [quota, bandwidth] = await Promise.all([
      cpProxy.getQuotaInfo(ctx.cpUser, ctx.cpPass, ctx.whmHost).catch(e => ({ error: e.message })),
      cpProxy.getBandwidthData(ctx.cpUser, ctx.cpPass, ctx.whmHost).catch(e => ({ error: e.message })),
    ])
    res.json({ username: acct._id, quota, bandwidth })
  }))

  // ════════════════════════════════════════════════════════
  // SSL
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/ssl', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.getSSLStatus(ctx.cpUser, ctx.cpPass, ctx.whmHost),
      () => cpProxy.uapiViaWhmRoot(ctx.cpUser, 'SSL', 'installed_hosts', {}, ctx.whmHost),
      'ssl.installed_hosts'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/ssl/autossl', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    if (!isLive()) return dryRun(res, acct, 'ssl.autossl')
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await whmService.startAutoSSL(ctx.cpUser)
    if (result && result.success) return res.json({ success: true, message: 'AutoSSL check started. Certificates will be issued shortly (1-3 minutes).' })
    const already = /PIDFile|already/i.test(result && result.error || '')
    if (already) return res.json({ success: true, message: 'AutoSSL is already running for this account.' })
    res.status(502).json({ success: false, error: (result && result.error) || 'AutoSSL trigger failed' })
  }))

  // ════════════════════════════════════════════════════════
  // SUBDOMAINS
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/subdomains', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.listSubdomains(ctx.cpUser, ctx.cpPass, ctx.whmHost))
  }))

  router.post('/hosting/:user/subdomains', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const subdomain = req.body && req.body.subdomain
    const rootdomain = (req.body && req.body.rootdomain) || acct.domain
    const dir = req.body && req.body.dir
    if (missing(res, ['subdomain', subdomain], ['rootdomain', rootdomain])) return
    if (!isLive()) return dryRun(res, acct, 'subdomain.create', { subdomain: `${subdomain}.${rootdomain}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    const r = await cpProxy.createSubdomain(ctx.cpUser, ctx.cpPass, subdomain, rootdomain, dir, ctx.whmHost)
    if (r && r.status === 1) await _cfCreateSubdomainDns(rootdomain, subdomain)  // mirror panel: add CF tunnel CNAME
    res.json(r)
  }))

  router.delete('/hosting/:user/subdomains', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const full = bq(req, 'subdomain')
    if (missing(res, ['subdomain', full])) return
    if (!isLive()) return dryRun(res, acct, 'subdomain.delete', { subdomain: full })
    const ctx = withCreds(res, acct); if (!ctx) return
    const r = await cpProxy.deleteSubdomain(ctx.cpUser, ctx.cpPass, full, ctx.whmHost)
    await _cfDeleteSubdomainDns(acct.domain, full)  // mirror panel: clean up CF DNS
    res.json(r)
  }))

  // ════════════════════════════════════════════════════════
  // DOMAINS (list / docroot / addon removal)
  //   Addon-domain ADD already exists as POST /hosting/:user/addons.
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/domains', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    // GAP-3 FIX (2026-09): give the domains list the SAME WHM-root impersonation self-heal that
    // File-Manager / SSL already use, so a stale/absent cpPass no longer returns CPANEL_AUTH_FAILURE
    // on an active account. (A SUSPENDED account still can't be sessioned into — that's expected.)
    const result = await withCpAuthFallback(
      cpProxy.listDomains(ctx.cpUser, ctx.cpPass, ctx.whmHost),
      () => cpProxy.uapiViaWhmRoot(ctx.cpUser, 'DomainInfo', 'list_domains', {}, ctx.whmHost),
      'domains.list'
    )
    return sendCp(res, result)
  }))

  router.post('/hosting/:user/domains/docroot', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { subdomain, rootdomain, dir } = req.body || {}
    if (missing(res, ['subdomain', subdomain], ['rootdomain', rootdomain], ['dir', dir])) return
    if (!isLive()) return dryRun(res, acct, 'domain.docroot', { subdomain, rootdomain, dir })
    const ctx = withCreds(res, acct); if (!ctx) return
    // GAP-3 FIX (2026-09): docroot change is API2 (SubDomain::changedocroot) — add the api2 WHM-root
    // fallback so a stale cpPass self-heals instead of hard-failing with CPANEL_AUTH_FAILURE.
    const result = await withCpAuthFallback(
      cpProxy.changeDomainDocRoot(ctx.cpUser, ctx.cpPass, subdomain, rootdomain, dir, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'SubDomain', 'changedocroot', { subdomain, rootdomain, dir }, ctx.whmHost),
      'domain.docroot'
    )
    return sendCp(res, result)
  }))

  router.delete('/hosting/:user/domains/addon', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const domain = String(bq(req, 'domain') || '').trim().toLowerCase()
    if (missing(res, ['domain', domain])) return
    if (!isLive()) return dryRun(res, acct, 'domain.addon.remove', { domain })
    const ctx = withCreds(res, acct); if (!ctx) return
    const r = await cpProxy.removeAddonDomain(ctx.cpUser, ctx.cpPass, domain, undefined, acct.domain, ctx.whmHost)
    // Best-effort: keep the Mongo mirror in sync with cPanel.
    if (r && r.status === 1) {
      try { await col('cpanelAccounts').updateOne({ _id: acct._id }, { $pull: { addonDomains: { domain } } }) } catch (_) {}
    }
    res.json(r)
  }))

  // ════════════════════════════════════════════════════════
  // MYSQL  (databases / users / privileges / remote hosts)
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/mysql/databases', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    if (mysqlBlocked(res, ctx)) return
    res.json(await cpProxy.listDatabases(ctx.cpUser, ctx.cpPass, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/databases', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const name = req.body && req.body.name
    if (missing(res, ['name', name])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.database.create', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.createDatabase(ctx.cpUser, ctx.cpPass, name, ctx.whmHost))
  }))

  router.delete('/hosting/:user/mysql/databases', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const name = bq(req, 'name')
    if (missing(res, ['name', name])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.database.delete', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.deleteDatabase(ctx.cpUser, ctx.cpPass, name, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/databases/rename', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { oldname, newname } = req.body || {}
    if (missing(res, ['oldname', oldname], ['newname', newname])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.database.rename', { oldname, newname })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.renameDatabase(ctx.cpUser, ctx.cpPass, oldname, newname, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/databases/repair', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const name = req.body && req.body.name
    if (missing(res, ['name', name])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.database.repair', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.repairDatabase(ctx.cpUser, ctx.cpPass, name, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/databases/check', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const name = req.body && req.body.name
    if (missing(res, ['name', name])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.database.check', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.checkDatabase(ctx.cpUser, ctx.cpPass, name, ctx.whmHost))
  }))

  router.get('/hosting/:user/mysql/users', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    if (mysqlBlocked(res, ctx)) return
    res.json(await cpProxy.listDatabaseUsers(ctx.cpUser, ctx.cpPass, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/users', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { name, password } = req.body || {}
    if (missing(res, ['name', name], ['password', password])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.user.create', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.createDatabaseUser(ctx.cpUser, ctx.cpPass, name, password, ctx.whmHost))
  }))

  router.delete('/hosting/:user/mysql/users', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const name = bq(req, 'name')
    if (missing(res, ['name', name])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.user.delete', { name })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.deleteDatabaseUser(ctx.cpUser, ctx.cpPass, name, ctx.whmHost))
  }))

  router.put('/hosting/:user/mysql/users/password', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { user, password } = req.body || {}
    if (missing(res, ['user', user], ['password', password])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.user.password', { user })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.setDatabaseUserPassword(ctx.cpUser, ctx.cpPass, user, password, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/users/rename', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { oldname, newname } = req.body || {}
    if (missing(res, ['oldname', oldname], ['newname', newname])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.user.rename', { oldname, newname })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.renameDatabaseUser(ctx.cpUser, ctx.cpPass, oldname, newname, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/privileges/grant', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { user, database, privileges } = req.body || {}
    if (missing(res, ['user', user], ['database', database], ['privileges', privileges])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.privileges.grant', { user, database })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.setUserPrivilegesOnDatabase(ctx.cpUser, ctx.cpPass, user, database, privileges, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/privileges/revoke', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { user, database } = req.body || {}
    if (missing(res, ['user', user], ['database', database])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.privileges.revoke', { user, database })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.revokeUserPrivilegesOnDatabase(ctx.cpUser, ctx.cpPass, user, database, ctx.whmHost))
  }))

  router.get('/hosting/:user/mysql/remote-hosts', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    if (mysqlBlocked(res, ctx)) return
    res.json(await cpProxy.listMysqlRemoteHosts(ctx.cpUser, ctx.cpPass, ctx.whmHost))
  }))

  router.post('/hosting/:user/mysql/remote-hosts', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const remoteHost = req.body && req.body.host
    if (missing(res, ['host', remoteHost])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.remote-host.add', { host: remoteHost })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.addMysqlRemoteHost(ctx.cpUser, ctx.cpPass, remoteHost, ctx.whmHost))
  }))

  router.delete('/hosting/:user/mysql/remote-hosts', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const remoteHost = bq(req, 'host')
    if (missing(res, ['host', remoteHost])) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.remote-host.delete', { host: remoteHost })
    const ctx = withCreds(res, acct); if (!ctx) return
    res.json(await cpProxy.deleteMysqlRemoteHost(ctx.cpUser, ctx.cpPass, remoteHost, ctx.whmHost))
  }))

  // ════════════════════════════════════════════════════════
  // FILE MANAGER
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/files', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = withCreds(res, acct); if (!ctx) return
    const dir = req.query.dir || req.query.path || '/public_html'
    const fparams = { dir, include_mime: 1, include_permissions: 1, include_hash: 0, include_content: 0, types: 'dir|file' }
    const result = await withCpAuthFallback(
      cpProxy.listFiles(ctx.cpUser, ctx.cpPass, dir, ctx.whmHost),
      () => cpProxy.uapiViaWhmRoot(ctx.cpUser, 'Fileman', 'list_files', fparams, ctx.whmHost),
      'files.list'
    )
    sendCp(res, result)
  }))

  router.get('/hosting/:user/files/content', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, file } = req.query
    if (missing(res, ['dir', dir], ['file', file])) return
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.getFileContent(ctx.cpUser, ctx.cpPass, dir, file, ctx.whmHost),
      async () => {
        // Content reads: prefer the WHM-minted cpsession (Fileman content works
        // over it), fall back to WHM-root api3 if the session doesn't recover.
        let fb = await cpProxy.uapiViaSession(ctx.cpUser, 'Fileman', 'get_file_content', { dir, file }, 'GET', ctx.whmHost)
        if (!fb || fb.status !== 1) fb = await cpProxy.uapiViaWhmRoot(ctx.cpUser, 'Fileman', 'get_file_content', { dir, file }, ctx.whmHost)
        return fb
      },
      'files.content'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/save', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, file, content } = req.body || {}
    if (missing(res, ['dir', dir], ['file', file])) return
    if (isProtectedAntiRedFile(dir, file)) return res.status(403).json({ error: 'protected_file', message: `${file} is protected by Anti-Red and cannot be modified.` })
    if (!fileOpsLive()) return dryRun(res, acct, 'files.save', { path: `${dir}/${file}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    const body = content != null ? content : ''
    const result = await withCpAuthFallback(
      cpProxy.saveFileContent(ctx.cpUser, ctx.cpPass, dir, file, body, ctx.whmHost),
      // Content writes go over a WHM cpsession POST — the WHM json-api GET
      // wrapper mangles large `content` params in the query string.
      () => cpProxy.uapiViaSession(ctx.cpUser, 'Fileman', 'save_file_content', { dir, file, content: body }, 'POST', ctx.whmHost),
      'files.save'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/mkdir', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, name } = req.body || {}
    if (missing(res, ['dir', dir], ['name', name])) return
    if (!fileOpsLive()) return dryRun(res, acct, 'files.mkdir', { path: `${dir}/${name}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.createDirectory(ctx.cpUser, ctx.cpPass, dir, name, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'mkdir', { path: dir, name }, ctx.whmHost),
      'files.mkdir'
    )
    sendCp(res, result)
  }))

  router.delete('/hosting/:user/files', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const dir = bq(req, 'dir'); const file = bq(req, 'file')
    const isDirectory = String(bq(req, 'isDirectory') || '') === 'true' || bq(req, 'isDirectory') === true
    if (missing(res, ['dir', dir], ['file', file])) return
    if (isProtectedAntiRedFile(dir, file)) return res.status(403).json({ error: 'protected_file', message: `${file} is protected by Anti-Red and cannot be deleted.` })
    if (!fileOpsLive()) return dryRun(res, acct, 'files.delete', { path: `${dir}/${file}` })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.deleteFile(ctx.cpUser, ctx.cpPass, dir, file, ctx.whmHost, isDirectory),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: isDirectory ? 'trash' : 'unlink', sourcefiles: `${dir}/${file}` }, ctx.whmHost),
      'files.delete'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/rename', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, oldName, newName } = req.body || {}
    if (missing(res, ['dir', dir], ['oldName', oldName], ['newName', newName])) return
    const cpUser = acct.cpUser || acct._id
    const absDir = toAbsPath(cpUser, dir)
    const sourcefiles = `${absDir}/${oldName}`, destfiles = `${absDir}/${newName}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.rename', { sourcefiles, destfiles })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.renameFile(ctx.cpUser, ctx.cpPass, absDir, oldName, newName, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'rename', sourcefiles, destfiles }, ctx.whmHost),
      'files.rename'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/extract', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, file, destDir } = req.body || {}
    if (missing(res, ['dir', dir], ['file', file])) return
    const cpUser = acct.cpUser || acct._id
    const absDir = toAbsPath(cpUser, dir)
    // No destDir → unpack into <dir> (dirname of the archive). destDir → $HOME/<destDir>.
    const absDest = destDir ? toAbsPath(cpUser, destDir) : absDir
    const sourcefiles = `${absDir}/${file}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.extract', { sourcefiles, destfiles: absDest })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withReceipt(req, ctx, { destDir: absDest }, () => withCpAuthFallback(
      cpProxy.extractFile(ctx.cpUser, ctx.cpPass, absDir, file, absDest, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'extract', sourcefiles, destfiles: absDest }, ctx.whmHost),
      'files.extract'
    ))
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/compress', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, files, destFile } = req.body || {}
    if (missing(res, ['dir', dir], ['destFile', destFile])) return
    if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'invalid_parameter', message: "'files' must be a non-empty array of file names." })
    const cpUser = acct.cpUser || acct._id
    const absDir = toAbsPath(cpUser, dir)
    const sourcefiles = files.map(f => `${absDir}/${f}`).join('\n'), destfiles = `${absDir}/${destFile}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.compress', { sourcefiles: files.map(f => `${absDir}/${f}`), destfiles })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.compressFiles(ctx.cpUser, ctx.cpPass, absDir, files, destFile, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'compress', sourcefiles, destfiles }, ctx.whmHost),
      'files.compress'
    )
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/copy', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { sourceDir, fileName, destDir } = req.body || {}
    if (missing(res, ['sourceDir', sourceDir], ['fileName', fileName], ['destDir', destDir])) return
    const cpUser = acct.cpUser || acct._id
    const absSrc = toAbsPath(cpUser, sourceDir), absDest = toAbsPath(cpUser, destDir)
    const sourcefiles = `${absSrc}/${fileName}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.copy', { sourcefiles, destfiles: absDest })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withReceipt(req, ctx, { destDir: absDest }, () => withCpAuthFallback(
      cpProxy.copyFile(ctx.cpUser, ctx.cpPass, absSrc, fileName, absDest, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'copy', sourcefiles, destfiles: absDest }, ctx.whmHost),
      'files.copy'
    ))
    sendCp(res, result)
  }))

  router.post('/hosting/:user/files/move', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { sourceDir, fileName, destDir } = req.body || {}
    if (missing(res, ['sourceDir', sourceDir], ['fileName', fileName], ['destDir', destDir])) return
    const cpUser = acct.cpUser || acct._id
    const absSrc = toAbsPath(cpUser, sourceDir), absDest = toAbsPath(cpUser, destDir)
    const sourcefiles = `${absSrc}/${fileName}`, destfiles = `${absDest}/${fileName}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.move', { sourcefiles, destfiles })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withReceipt(req, ctx, { destDir: absDest, srcDir: absSrc }, () => withCpAuthFallback(
      cpProxy.moveFile(ctx.cpUser, ctx.cpPass, absSrc, fileName, absDest, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'move', sourcefiles, destfiles }, ctx.whmHost),
      'files.move'
    ))
    sendCp(res, result)
  }))

  // Upload a file via base64 body (small files). Reuses cpProxy.uploadFile.
  router.post('/hosting/:user/files/upload', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, fileName } = req.body || {}
    const contentB64 = (req.body && (req.body.content_base64 || req.body.contentBase64)) || null
    if (missing(res, ['dir', dir], ['fileName', fileName], ['content_base64', contentB64])) return
    let buffer
    try { buffer = Buffer.from(String(contentB64), 'base64') } catch (e) { return res.status(400).json({ error: 'invalid_base64', message: 'content_base64 must be valid base64.' }) }
    if (!fileOpsLive()) return dryRun(res, acct, 'files.upload', { path: `${dir}/${fileName}`, bytes: buffer.length })
    const ctx = withCreds(res, acct); if (!ctx) return
    const result = await withCpAuthFallback(
      cpProxy.uploadFile(ctx.cpUser, ctx.cpPass, dir, fileName, buffer, ctx.whmHost),
      async () => {
        // Multipart upload: WHM-minted cpsession first, then WHM-root multipart.
        let fb = await cpProxy.uploadFileViaSession(ctx.cpUser, dir, fileName, buffer, ctx.whmHost)
        if (!fb || fb.status !== 1) fb = await cpProxy.uploadFileAsRoot(ctx.cpUser, dir, fileName, buffer, ctx.whmHost)
        return fb
      },
      'files.upload'
    )
    sendCp(res, result)
  }))

  // One-tap "unzip": upload a base64 archive into `dir`, extract it into
  // `destDir` (default = dir), then list the destination — all in ONE call, so
  // integrators get a clean unzip action instead of upload → extract → list.
  // Optional { removeArchive:true } deletes the uploaded archive after a
  // successful extract. Same absolute-path + WHM-root-fallback contract as the
  // individual ops; on the sandbox it returns a dry-run plan.
  router.post('/hosting/:user/files/unzip', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { dir, fileName, destDir, removeArchive } = req.body || {}
    const contentB64 = (req.body && (req.body.content_base64 || req.body.contentBase64)) || null
    if (missing(res, ['dir', dir], ['fileName', fileName], ['content_base64', contentB64])) return
    if (isProtectedAntiRedFile(dir, fileName)) return res.status(403).json({ error: 'protected_file', message: `${fileName} is protected by Anti-Red and cannot be uploaded.` })
    let buffer
    try { buffer = Buffer.from(String(contentB64), 'base64') } catch (e) { return res.status(400).json({ error: 'invalid_base64', message: 'content_base64 must be valid base64.' }) }
    const cpUser = acct.cpUser || acct._id
    const absDir = toAbsPath(cpUser, dir)
    const absDest = destDir ? toAbsPath(cpUser, destDir) : absDir
    const sourcefiles = `${absDir}/${fileName}`
    if (!fileOpsLive()) return dryRun(res, acct, 'files.unzip', { steps: ['upload', 'extract', 'list'], upload: sourcefiles, bytes: buffer.length, destfiles: absDest, removeArchive: !!removeArchive })
    const ctx = withCreds(res, acct); if (!ctx) return

    // 1) Upload the archive (multipart, with WHM-session / WHM-root fallback).
    const uploaded = await withCpAuthFallback(
      cpProxy.uploadFile(ctx.cpUser, ctx.cpPass, dir, fileName, buffer, ctx.whmHost),
      async () => {
        let fb = await cpProxy.uploadFileViaSession(ctx.cpUser, dir, fileName, buffer, ctx.whmHost)
        if (!fb || fb.status !== 1) fb = await cpProxy.uploadFileAsRoot(ctx.cpUser, dir, fileName, buffer, ctx.whmHost)
        return fb
      },
      'files.unzip.upload'
    )
    if (!okStatus(uploaded)) {
      return sendCp(res, { ...(uploaded || { status: 0, errors: ['upload failed'] }), action: 'files.unzip', step: 'upload' })
    }

    // Snapshot destination BEFORE extracting so we can report exactly what landed.
    const receiptWanted = !receiptDisabled(req)
    const destBefore = receiptWanted ? await listDirNames(ctx, absDest) : null

    // 2) Extract the archive into destDir (or its own dir).
    const extracted = await withCpAuthFallback(
      cpProxy.extractFile(ctx.cpUser, ctx.cpPass, absDir, fileName, absDest, ctx.whmHost),
      () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'extract', sourcefiles, destfiles: absDest }, ctx.whmHost),
      'files.unzip.extract'
    )
    if (!okStatus(extracted)) {
      return sendCp(res, { ...(extracted || { status: 0, errors: ['extract failed'] }), action: 'files.unzip', step: 'extract', uploaded: { fileName, bytes: buffer.length } })
    }

    // 3) Optionally remove the uploaded archive.
    let archiveRemoved = null
    if (removeArchive) {
      const del = await withCpAuthFallback(
        cpProxy.deleteFile(ctx.cpUser, ctx.cpPass, absDir, fileName, ctx.whmHost, false),
        () => cpProxy.api2ViaWhmRoot(ctx.cpUser, 'Fileman', 'fileop', { doubledecode: 0, op: 'unlink', sourcefiles }, ctx.whmHost),
        'files.unzip.cleanup'
      )
      archiveRemoved = okStatus(del)
    }

    // 4) List the destination so the caller sees the unpacked files (the receipt).
    const listing = receiptWanted ? await listDirNames(ctx, absDest) : null
    const added = receiptWanted ? diffNames(listing, destBefore) : null

    return sendCp(res, {
      status: 1,
      action: 'files.unzip',
      uploaded: { fileName, bytes: buffer.length, dir: absDir },
      extracted: { src: (extracted.data && extracted.data.src) || sourcefiles, dest: (extracted.data && extracted.data.dest) || absDest },
      archiveRemoved,
      listing,
      added,
      healed: !!(uploaded.healed || extracted.healed),
      healed_via: extracted.healed_via || uploaded.healed_via || null,
    })
  }))

  // ════════════════════════════════════════════════════════
  // SECURITY / ANTI-RED  (Cloudflare-backed premium protection)
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/security/status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const domain = ctx.cpDomain
    const [zone, jsEnabled, sbResult, blResult] = await Promise.all([
      cfService.getZoneByName(domain).catch(() => null),
      antiRed.isJSChallengeEnabled(ctx.cpUser).catch(() => false),
      safeBrowsing.checkDomain(domain).catch(() => ({ error: 'check failed' })),
      safeBrowsing.checkBlacklists(domain).catch(() => ({ error: 'check failed' })),
    ])
    let antiBot = null
    if (zone) { try { antiBot = await cfService.getSecuritySettings(zone.id); antiBot.zoneId = zone.id } catch (_) {} }
    res.json({
      username: acct._id,
      domain,
      plan: ctx.cpPlan,
      is_gold: ctx.cpIsGold,
      antiBot,
      antiRed: { safeBrowsing: sbResult, blacklist: blResult },
      configured: { safeBrowsing: safeBrowsing.isConfigured() },
      protectionLayers: {
        jsChallenge: jsEnabled,
        cloudflareZone: !!zone,
      },
      stats: {
        scannerIpRanges: antiRed.SCANNER_IP_RANGES.length,
        scannerUserAgents: antiRed.SCANNER_USER_AGENTS.length,
        ja3Hashes: antiRed.SCANNER_JA3_HASHES.length,
      },
    })
  }))

  router.get('/hosting/:user/security/anti-red/status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const jsEnabled = await antiRed.isJSChallengeEnabled(ctx.cpUser).catch(() => false)
    res.json({
      username: acct._id,
      scannerIpRanges: antiRed.SCANNER_IP_RANGES.length,
      scannerUserAgents: antiRed.SCANNER_USER_AGENTS.length,
      ja3Hashes: antiRed.SCANNER_JA3_HASHES.length,
      jsChallengeEnabled: jsEnabled,
      protectionLayers: ['htaccess_ip_cloaking', 'scanner_ua_blocking', 'js_challenge', 'ja3_fingerprinting', 'cf_waf_rules'],
    })
  }))

  router.post('/hosting/:user/security/anti-red/deploy', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (!isLive()) return dryRun(res, acct, 'security.anti-red.deploy', { domain: ctx.cpDomain })
    const result = await antiRed.deployFullProtection(ctx.cpUser, ctx.cpDomain, ctx.cpPlan || '')
    res.json(result)
  }))

  router.post('/hosting/:user/security/anti-bot', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const profile = req.body && req.body.profile
    const allowed = ['off', 'low', 'medium', 'high', 'under_attack']
    if (!allowed.includes(profile)) return res.status(400).json({ error: 'invalid_profile', message: `profile must be one of: ${allowed.join(', ')}` })
    const ctx = ctxFromAccount(acct)
    if (!isLive()) return dryRun(res, acct, 'security.anti-bot', { profile })
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.status(404).json({ error: 'cf_zone_not_found', message: 'Cloudflare zone not found for this domain.' })
    res.json(await cfService.setAntiBotProfile(zone.id, profile))
  }))

  router.post('/hosting/:user/security/anti-bot/rules', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (!isLive()) return dryRun(res, acct, 'security.anti-bot.rules', { domain: ctx.cpDomain })
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.status(404).json({ error: 'cf_zone_not_found', message: 'Cloudflare zone not found for this domain.' })
    res.json(await cfService.createAntiBotRules(zone.id))
  }))

  router.get('/hosting/:user/security/safe-browsing', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    res.json(await safeBrowsing.checkDomain(ctx.cpDomain))
  }))

  router.get('/hosting/:user/security/blacklist', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    res.json(await safeBrowsing.checkBlacklists(ctx.cpDomain))
  }))

  // Visitor Captcha (Golden plan) — enable/disable the human challenge page for
  // a specific domain. Mirrors panel POST /security/captcha/toggle.
  router.get('/hosting/:user/security/visitor-captcha', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const db = getDb()
    const allDomains = [ctx.cpDomain, ...ctx.cpAddonDomains].filter(Boolean)
    const domains = await Promise.all(allDomains.map(async (d) => {
      const cf = await antiRed.resolveDomainCfState(d, db).catch(() => ({}))
      return { domain: d, enabled: !!(cf.hasCloudflare && !cf.isOff), hasCloudflare: !!cf.hasCloudflare, isMain: d === ctx.cpDomain }
    }))
    res.json({ username: acct._id, is_gold: ctx.cpIsGold, plan: ctx.cpPlan, captchaGoldOnly: true, domains })
  }))

  router.post('/hosting/:user/security/visitor-captcha', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (goldBlocked(res, ctx)) return
    const enabled = req.body && req.body.enabled
    let domain = (req.body && req.body.domain) || ctx.cpDomain
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'missing_parameter', message: "'enabled' (boolean) is required." })
    domain = String(domain).toLowerCase()
    const allDomains = [ctx.cpDomain, ...ctx.cpAddonDomains].filter(Boolean).map(d => d.toLowerCase())
    if (!allDomains.includes(domain)) return res.status(403).json({ error: 'domain_not_owned', message: 'Domain does not belong to this account.' })
    if (!isLive()) return dryRun(res, acct, 'security.visitor-captcha', { domain, enabled })
    const db = getDb()
    const cf = await antiRed.resolveDomainCfState(domain, db)
    if (!cf.hasCloudflare || !cf.zoneId) return res.status(400).json({ error: 'no_cloudflare', message: `Visitor Captcha requires Cloudflare nameservers. ${domain} is not on Cloudflare.` })
    const workerResult = await antiRed.deploySharedWorkerRoute(domain, cf.zoneId)
    if (!workerResult || !workerResult.success) return res.status(502).json({ error: 'worker_deploy_failed', message: (workerResult && workerResult.error) || 'Failed to update Visitor Captcha.' })
    try {
      if (enabled) {
        await db.collection('registeredDomains').updateOne({ _id: domain }, { $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '', 'val.visitorCaptchaOff': '' } })
        await antiRed.setDomainChallengeBypass(domain, false)
      } else {
        await db.collection('registeredDomains').updateOne({ _id: domain }, { $set: { 'val.visitorCaptchaOff': true }, $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '' } })
        await antiRed.setDomainChallengeBypass(domain, true)
      }
    } catch (_) { /* best-effort persistence */ }
    res.json({ success: true, username: acct._id, domain, enabled, hasCloudflare: true })
  }))

  // ════════════════════════════════════════════════════════
  // GEO BLOCKING  (Golden plan)  — Cloudflare firewall rules
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/geo', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (goldBlocked(res, ctx)) return
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.json({ rules: [], error: 'Domain not in Cloudflare' })
    const rules = await cfService.listFirewallRules(zone.id)
    const geoRules = (rules || []).filter(r => r.filter && r.filter.expression && r.filter.expression.includes('ip.geoip.country'))
      .map(r => ({ id: r.id, description: r.description || '', action: r.action, expression: (r.filter && r.filter.expression) || '', paused: r.paused || false }))
    res.json({ rules: geoRules, zoneId: zone.id })
  }))

  router.post('/hosting/:user/geo', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (goldBlocked(res, ctx)) return
    const { countries, mode: geoMode, description } = req.body || {}
    if (!Array.isArray(countries) || !countries.length || !geoMode) return res.status(400).json({ error: 'missing_parameter', message: 'countries (non-empty array) and mode (block|allow) are required.' })
    if (!isLive()) return dryRun(res, acct, 'geo.create', { countries, requested_mode: geoMode })
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.status(400).json({ error: 'cf_zone_not_found', message: 'Domain not in Cloudflare.' })
    res.json(await cfService.createGeoRule(zone.id, countries, geoMode, description))
  }))

  router.delete('/hosting/:user/geo', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (goldBlocked(res, ctx)) return
    const ruleId = bq(req, 'ruleId')
    if (missing(res, ['ruleId', ruleId])) return
    if (!isLive()) return dryRun(res, acct, 'geo.delete', { ruleId })
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.status(400).json({ error: 'cf_zone_not_found', message: 'Domain not in Cloudflare.' })
    res.json(await cfService.deleteFirewallRule(zone.id, ruleId))
  }))

  // ════════════════════════════════════════════════════════
  // ANALYTICS  (Cloudflare zone analytics) — read
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/analytics', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const days = parseInt(req.query.days, 10) || 7
    const detailed = req.query.detailed !== 'false'
    const zone = await cfService.getZoneByName(ctx.cpDomain)
    if (!zone) return res.json({ success: false, error: 'Domain not in Cloudflare' })
    if (detailed) return res.json(await cfService.getDetailedZoneAnalytics(zone.id, days))
    res.json(await cfService.getZoneAnalytics(zone.id, days))
  }))

  // ════════════════════════════════════════════════════════
  // EMAIL — send test email (mirror panel POST /email/test)
  // ════════════════════════════════════════════════════════
  router.post('/hosting/:user/email/test', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { from, to } = req.body || {}
    if (missing(res, ['from', from], ['to', to])) return
    if (!isLive()) return dryRun(res, acct, 'email.test', { from: `${from}@${acct.domain}`, to })
    if (!nodemailer) return res.status(501).json({ error: 'not_available', message: 'Email test transport (nodemailer) is not installed on this server.' })
    const ctx = withCreds(res, acct); if (!ctx) return
    const domain = ctx.cpDomain
    const WHM_HOST = ctx.whmHost || process.env.WHM_HOST
    const mailOpts = {
      from: `"${domain} Test" <${from}@${domain}>`, to,
      subject: `Test Email from ${domain} - ${new Date().toISOString().split('T')[0]}`,
      text: `Test email from your hosting panel at ${domain}. If you received this, email is working. Sent: ${new Date().toISOString()}`,
    }
    const attempts = [
      { port: 465, secure: true, user: `${from}@${domain}`, pass: ctx.cpPass },
      { port: 25, secure: false, user: ctx.cpUser, pass: ctx.cpPass },
      { port: 587, secure: false, user: `${from}@${domain}`, pass: ctx.cpPass },
    ].map(cfg => nodemailer.createTransport({
      host: WHM_HOST, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass },
      tls: { rejectUnauthorized: false }, connectionTimeout: 8000, greetingTimeout: 5000, socketTimeout: 10000,
    }).sendMail(mailOpts).then(info => ({ info, port: cfg.port })))
    try {
      const r = await Promise.any(attempts)
      res.json({ success: true, messageId: r.info.messageId, accepted: r.info.accepted, message: `Test email sent to ${to}` })
    } catch (aggErr) {
      const lastErr = (aggErr.errors && aggErr.errors[0] && aggErr.errors[0].message) || 'All SMTP connections failed'
      res.json({ success: false, error: `SMTP connection failed: ${lastErr}`, hint: 'Ensure the mailbox exists and the server allows SMTP.' })
    }
  }))

  // ════════════════════════════════════════════════════════
  // MYSQL — phpMyAdmin SSO (mirror panel GET /mysql/phpmyadmin)
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/mysql/phpmyadmin', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx0 = ctxFromAccount(acct); if (mysqlBlocked(res, ctx0)) return
    if (!isLive()) return dryRun(res, acct, 'mysql.phpmyadmin', { note_extra: 'SSO URL minted only in live mode.' })
    const r = await whmService.createUserSession(ctx0.cpUser, 'phpMyAdmin', 'cpaneld')
    if (!r || !r.success) return res.status(502).json({ status: 0, errors: [(r && r.error) || 'Could not open phpMyAdmin.'] })
    res.json({ status: 1, url: r.url, expires: r.expires })
  }))

  // ════════════════════════════════════════════════════════
  // SUBDOMAINS — bulk create (mirror panel POST /subdomains/bulk-create)
  // ════════════════════════════════════════════════════════
  router.post('/hosting/:user/subdomains/bulk-create', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    let subdomains = req.body && req.body.subdomains
    const rootdomain = (req.body && req.body.rootdomain) || acct.domain
    if (!rootdomain) return res.status(400).json({ error: 'missing_parameter', message: "'rootdomain' is required." })
    if (typeof subdomains === 'string') subdomains = subdomains.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean)
    if (!Array.isArray(subdomains) || !subdomains.length) return res.status(400).json({ error: 'missing_parameter', message: "'subdomains' array (or comma-separated string) is required." })
    if (subdomains.length > 50) return res.status(400).json({ error: 'too_many', message: 'Maximum 50 subdomains per bulk operation.' })
    const validSubRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
    const invalid = subdomains.filter(s => !validSubRe.test(s))
    if (invalid.length) return res.status(400).json({ error: 'invalid_subdomain', message: `Invalid subdomain names: ${invalid.join(', ')}` })
    const uniqueSubs = [...new Set(subdomains.map(s => s.toLowerCase()))]
    if (!isLive()) return dryRun(res, acct, 'subdomain.bulk-create', { rootdomain, count: uniqueSubs.length, subdomains: uniqueSubs })
    const ctx = withCreds(res, acct); if (!ctx) return
    const results = []
    for (const subdomain of uniqueSubs) {
      try {
        const r = await cpProxy.createSubdomain(ctx.cpUser, ctx.cpPass, subdomain, rootdomain, null, ctx.whmHost)
        const ok = r && (r.status === 1 || (r.data && r.data[0] && r.data[0].result === 1))
        if (ok) await _cfCreateSubdomainDns(rootdomain, subdomain)
        results.push({ subdomain, fqdn: `${subdomain}.${rootdomain}`, success: !!ok, error: ok ? null : ((r && r.errors && r.errors[0]) || 'Unknown error') })
      } catch (e) {
        results.push({ subdomain, fqdn: `${subdomain}.${rootdomain}`, success: false, error: e.message })
      }
    }
    const succeeded = results.filter(r => r.success).length
    res.json({ results, summary: { total: uniqueSubs.length, succeeded, failed: results.length - succeeded } })
  }))

  // ════════════════════════════════════════════════════════
  // DOMAINS — docroot mode (mirror/own) + set primary (mirror panel)
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/domains/docroot-modes', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const stored = acct.docrootModes || {}
    const modes = {}
    for (const d of ctx.cpAddonDomains) { const key = (d || '').toLowerCase(); if (key) modes[key] = stored[key] === 'mirror' ? 'mirror' : 'own' }
    res.json({ modes, primary: ctx.cpDomain })
  }))

  router.post('/hosting/:user/domains/docroot-mode', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const dom = String((req.body && req.body.domain) || '').toLowerCase().trim()
    const wantMode = (req.body && req.body.mode) === 'mirror' ? 'mirror' : 'own'
    if (!dom || !(req.body && req.body.mode)) return res.status(400).json({ error: 'missing_parameter', message: 'domain and mode (mirror|own) are required.' })
    if (dom === (ctx.cpDomain || '').toLowerCase()) return res.status(400).json({ error: 'primary_immutable', message: 'The primary domain always serves public_html and cannot be changed here.' })
    if (!ctx.cpAddonDomains.map(d => d.toLowerCase()).includes(dom)) return res.status(404).json({ error: 'not_addon', message: 'That domain is not an addon on this hosting plan.' })
    if (!isLive()) return dryRun(res, acct, 'domain.docroot-mode', { domain: dom, requested_mode: wantMode })
    const creds = withCreds(res, acct); if (!creds) return
    const subdomainLabel = dom.replace(/\./g, '')
    const dir = wantMode === 'mirror' ? 'public_html' : `public_html/${dom}`
    if (wantMode === 'own') { try { await cpProxy.createDirectory(creds.cpUser, creds.cpPass, 'public_html', dom, creds.whmHost) } catch (_) {} }
    const result = await cpProxy.changeDomainDocRoot(creds.cpUser, creds.cpPass, subdomainLabel, ctx.cpDomain, dir, creds.whmHost)
    if (result.code === 'CPANEL_DOWN') return res.status(503).json({ error: 'cpanel_down', message: 'WHM control plane unreachable. Retry shortly.' })
    if (result.status !== 1) return res.status(400).json({ error: 'docroot_failed', message: (result.errors && result.errors[0]) || 'Failed to update domain mode' })
    try { await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { [`docrootModes.${dom}`]: wantMode } }) } catch (_) {}
    res.json({ success: true, domain: dom, mode: wantMode, docRoot: dir })
  }))

  router.post('/hosting/:user/domains/set-primary', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    const newDomain = String((req.body && req.body.domain) || '').toLowerCase().trim()
    if (!newDomain || !newDomain.includes('.')) return res.status(400).json({ error: 'invalid_domain', message: 'A valid domain is required.' })
    const oldDomain = (ctx.cpDomain || '').toLowerCase()
    if (newDomain === oldDomain) return res.status(400).json({ error: 'already_primary', message: 'That domain is already your primary domain.' })
    if (!ctx.cpAddonDomains.map(d => d.toLowerCase()).includes(newDomain)) {
      return res.status(400).json({ error: 'needs_attach', message: 'Add this domain to the plan as an addon first, then set it as primary.', needsAttach: true })
    }
    try { const db = getDb(); if (db) { const blocked = await db.collection('blockedDomains').findOne({ domain: newDomain }); if (blocked) return res.status(403).json({ error: 'blocked_domain', message: `${newDomain} is blocked and cannot be used.` }) } } catch (_) {}
    if (!isLive()) return dryRun(res, acct, 'domain.set-primary', { from: oldDomain, to: newDomain })
    const creds = withCreds(res, acct); if (!creds) return
    // 1. Detach the target from addons (a domain can't be both addon + primary).
    let removedAddon = false
    try { const rm = await cpProxy.removeAddonDomain(creds.cpUser, creds.cpPass, newDomain, undefined, oldDomain, creds.whmHost); if (rm.code === 'CPANEL_DOWN') return res.status(503).json({ error: 'cpanel_down', message: 'WHM control plane unreachable. Retry shortly.' }); removedAddon = rm.status === 1 } catch (_) {}
    // 2. Swap primary on WHM.
    const swap = await whmService.changePrimaryDomain(creds.cpUser, newDomain)
    if (!swap.success) {
      if (removedAddon) { try { await cpProxy.addAddonDomain(creds.cpUser, creds.cpPass, newDomain, newDomain.replace(/\./g, ''), `public_html/${newDomain}`, creds.whmHost) } catch (_) {} }
      return res.status(502).json({ error: 'set_primary_failed', message: swap.error || 'Failed to change primary domain.' })
    }
    // 3. DB update.
    try { await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { domain: newDomain }, $pull: { addonDomains: newDomain }, $unset: { [`docrootModes.${newDomain}`]: '', [`docrootModes.${oldDomain}`]: '' } }) } catch (_) {}
    // 4. Background: (re)deploy CF + anti-red for new primary; clean up old primary.
    ;(async () => {
      try {
        const db = getDb()
        const fresh = (await col('cpanelAccounts').findOne({ _id: acct._id })) || acct
        await addonFlow.runDnsAndProtection({ domain: newDomain, cpUser: creds.cpUser, whmHost: creds.whmHost, account: fresh, db, bot: null, lang: 'en' })
      } catch (_) {}
      try { const zone = await cfService.getZoneByName(oldDomain); if (zone) { await antiRed.removeWorkerRoutes(oldDomain, zone.id).catch(() => {}); await cfService.cleanupAllHostingRecords(zone.id, oldDomain).catch(() => {}) } } catch (_) {}
    })()
    res.json({ success: true, oldDomain, newDomain, domain: newDomain })
  }))

  // ── First-class WHM-level "change / replace primary domain" (mirrors the proven bot flow) ──
  // Unlike set-primary (which requires the target to already be an addon), this accepts any domain
  // the reseller owns and swaps it in at the WHM level (modifyacct domain=), so a plan's primary can
  // be corrected WITHOUT a cPanel session and WITHOUT terminate+recreate. Adds the same
  // whm-userdata-heal self-heal the bot uses, and re-points Cloudflare/anti-red in the background.
  router.post('/hosting/:user/change-primary', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const newDomain = String((req.body && req.body.domain) || '').toLowerCase().trim()
    if (!newDomain || !newDomain.includes('.')) return res.status(400).json({ error: 'invalid_domain', message: 'A valid { "domain": "example.com" } is required.' })
    const oldDomain = String(acct.domain || '').toLowerCase()
    if (newDomain === oldDomain) return res.status(400).json({ error: 'already_primary', message: 'That domain is already the primary domain for this plan.' })
    const db = getDb()
    try {
      if (db) {
        // Refuse if the target is the primary or an addon of a DIFFERENT (non-deleted) plan.
        const onOther = await db.collection('cpanelAccounts').findOne({
          $or: [{ domain: newDomain }, { addonDomains: newDomain }, { 'addonDomains.domain': newDomain }],
          deleted: { $ne: true }, _id: { $ne: acct._id },
        })
        if (onOther) return res.status(409).json({ error: 'domain_on_other_plan', message: `${newDomain} is already attached to another hosting plan — detach it there first.` })
        const blocked = await db.collection('blockedDomains').findOne({ domain: newDomain })
        if (blocked) return res.status(403).json({ error: 'blocked_domain', message: `${newDomain} is blocked and cannot be used.` })
      }
    } catch (_) { /* guard best-effort */ }
    if (!isLive()) return dryRun(res, acct, 'domain.change-primary', { from: oldDomain, to: newDomain })

    const whmHost = acct.whmHost || process.env.WHM_HOST
    const cpUser = acct.cpUser || acct._id
    const ctx = ctxFromAccount(acct)

    // A domain can't be both an addon and the primary on the same account — detach it first
    // (best-effort; never blocks the WHM swap below).
    if (ctx.cpAddonDomains.map(d => d.toLowerCase()).includes(newDomain)) {
      try {
        if (ctx.cpPass) {
          const rm = await cpProxy.removeAddonDomain(cpUser, ctx.cpPass, newDomain, undefined, oldDomain, whmHost).catch(() => null)
          if (rm && rm.code === 'CPANEL_DOWN') return res.status(503).json({ error: 'cpanel_down', message: 'WHM control plane unreachable. Retry shortly.' })
        }
        await col('cpanelAccounts').updateOne({ _id: acct._id }, { $pull: { addonDomains: { domain: newDomain } } }).catch(() => {})
        await col('cpanelAccounts').updateOne({ _id: acct._id }, { $pull: { addonDomains: newDomain } }).catch(() => {})
      } catch (e) { log && log(`[Reseller] change-primary addon pre-removal warning: ${e.message}`) }
    }

    // Swap primary at the WHM level (no cPanel session needed).
    let result
    try { result = await whmService.changePrimaryDomain(cpUser, newDomain) }
    catch (e) { result = { success: false, error: e.message } }

    // Self-heal "domain already exists in the userdata" (stale row from a prior deleted account),
    // then retry once — identical to the bot's ChangePrimary path.
    if (!result || !result.success) {
      try {
        const heal = require('./whm-userdata-heal')
        if (heal.isStaleUserdataError(String(result?.error || ''))) {
          const release = await heal.attemptUserdataRelease({ db, whmService, domain: newDomain, chatId: String(acct.chatId || '') })
          if (release && release.released) {
            try { result = await whmService.changePrimaryDomain(cpUser, newDomain) }
            catch (e) { result = { success: false, error: e.message } }
          }
        }
      } catch (healErr) { log && log(`[Reseller] change-primary self-heal warning: ${healErr.message}`) }
    }

    if (!result || !result.success) {
      return res.status(502).json({ error: 'change_primary_failed', message: result?.error || 'WHM refused to change the primary domain.' })
    }

    // Persist the swap.
    try {
      await col('cpanelAccounts').updateOne(
        { _id: acct._id },
        { $set: { domain: newDomain, primaryChangedAt: new Date().toISOString(), previousPrimaryDomain: oldDomain },
          $pull: { addonDomains: { domain: newDomain } } }
      )
      await col('cpanelAccounts').updateOne({ _id: acct._id }, { $pull: { addonDomains: newDomain } }).catch(() => {})
    } catch (e) { log && log(`[Reseller] change-primary DB update warning: ${e.message}`) }

    // Background: re-point Cloudflare + anti-red for the NEW primary; strip the OLD domain's hosting DNS.
    ;(async () => {
      try {
        const fresh = (await col('cpanelAccounts').findOne({ _id: acct._id })) || acct
        await addonFlow.runDnsAndProtection({ domain: newDomain, cpUser, whmHost, account: fresh, db, bot: null, lang: 'en' })
      } catch (e) { log && log(`[Reseller] change-primary DNS/protection warning: ${e.message}`) }
      try {
        const zone = await cfService.getZoneByName(oldDomain)
        if (zone) {
          await antiRed.removeWorkerRoutes(oldDomain, zone.id).catch(() => {})
          await cfService.cleanupAllHostingRecords(zone.id, oldDomain).catch(() => {})
        }
      } catch (e) { log && log(`[Reseller] change-primary old-domain cleanup warning: ${e.message}`) }
    })()

    res.json({ success: true, username: acct._id, oldDomain, newDomain, domain: newDomain, note: 'Primary domain changed at WHM. Cloudflare + anti-red re-point runs in the background (~30-60s).' })
  }))
  router.get('/hosting/:user/domains/ns-status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const domain = req.query.domain
    if (!domain) return res.status(400).json({ error: 'missing_parameter', message: "'domain' query param is required." })
    const zone = await cfService.getZoneByName(domain)
    if (!zone) return res.json({ status: 'not_found', nameservers: [], message: 'Domain not in Cloudflare' })
    const nsInfo = await cfService.checkZoneNSStatus(zone.id)
    res.json({ status: nsInfo.status || 'unknown', nameservers: nsInfo.nameservers || [], originalNameservers: nsInfo.originalNameservers || [], zoneId: zone.id })
  }))

  // ════════════════════════════════════════════════════════
  // ACCOUNT — site status (online / maintenance / suspended)
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/account/site-status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    res.json({
      status: siteStatusService.readStatus(acct),
      domain: acct.domain, plan: acct.plan || null,
      expiryDate: acct.expiryDate || null, autoRenew: acct.autoRenew !== false,
      suspendedAt: acct.suspendedAt || null, maintenanceModeAt: acct.maintenanceModeAt || null,
    })
  }))

  router.post('/hosting/:user/account/site-status', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const { action, mode: siteMode } = req.body || {}
    if (action !== 'take_offline' && action !== 'bring_online') return res.status(400).json({ error: 'invalid_action', message: 'action must be take_offline or bring_online.' })
    if (action === 'take_offline' && siteMode !== 'maintenance' && siteMode !== 'suspended') return res.status(400).json({ error: 'invalid_mode', message: 'mode must be maintenance or suspended.' })
    if (acct.deleted) return res.status(409).json({ error: 'cancelled', message: 'This hosting plan has been cancelled.' })
    const before = siteStatusService.readStatus(acct)
    if (!isLive()) return dryRun(res, acct, 'account.site-status', { requested_action: action, requested_mode: siteMode || null, current: before })
    if (action === 'take_offline') {
      if (before !== 'online') return res.status(409).json({ error: 'already_offline', message: `Site is already ${before}.` })
      let result
      try { result = (siteMode === 'suspended') ? await siteStatusService.suspend(acct, 'Taken offline via reseller API') : await siteStatusService.enableMaintenanceMode(acct) }
      catch (e) { result = { ok: false, error: e.message } }
      if (!result || !result.ok) return res.status(502).json({ error: 'site_offline_failed', message: (result && result.error) || 'Failed to take site offline.' })
      const update = (siteMode === 'suspended')
        ? { suspended: true, suspendedAt: new Date(), suspendedBy: 'reseller_api', maintenanceMode: false }
        : { maintenanceMode: true, maintenanceModeAt: new Date(), maintenanceModeBy: 'reseller_api', suspended: false }
      await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: update })
      return res.json({ success: true, status: siteMode })
    }
    if (before === 'online') return res.status(409).json({ error: 'already_online', message: 'Site is already online.' })
    let result
    try { result = (before === 'suspended') ? await siteStatusService.unsuspend(acct) : await siteStatusService.disableMaintenanceMode(acct) }
    catch (e) { result = { ok: false, error: e.message } }
    if (!result || !result.ok) return res.status(502).json({ error: 'site_online_failed', message: (result && result.error) || 'Failed to bring site online.' })
    await col('cpanelAccounts').updateOne({ _id: acct._id }, { $set: { suspended: false, maintenanceMode: false, lastBroughtOnlineAt: new Date() } })
    res.json({ success: true, status: 'online' })
  }))

  // ════════════════════════════════════════════════════════
  // SECURITY — JS Challenge toggle (Golden plan) — mirror panel
  // ════════════════════════════════════════════════════════
  router.get('/hosting/:user/security/js-challenge', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    res.json({ enabled: await antiRed.isJSChallengeEnabled(ctx.cpUser).catch(() => false) })
  }))

  router.post('/hosting/:user/security/js-challenge', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const ctx = ctxFromAccount(acct)
    if (goldBlocked(res, ctx)) return
    const enabled = req.body && req.body.enabled
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'missing_parameter', message: "'enabled' (boolean) is required." })
    if (!isLive()) return dryRun(res, acct, 'security.js-challenge', { domain: ctx.cpDomain, enabled })
    const db = getDb()
    let result, workerResult = null
    if (enabled) {
      result = await antiRed.deployJSChallenge(ctx.cpUser)
      // Best-effort: ensure the .htaccess auto-prepend is present (reuse cpProxy).
      if (result && result.success && result.prependDirective) {
        try {
          const creds = ctxFromAccount(acct)
          if (creds.cpPass) {
            const cur = await cpProxy.getFileContent(creds.cpUser, creds.cpPass, '/public_html', '.htaccess', creds.whmHost)
            const content = (cur && cur.data && (cur.data.content != null ? cur.data.content : cur.data)) || ''
            if (typeof content === 'string' && !content.includes('antired-challenge.php')) {
              await cpProxy.saveFileContent(creds.cpUser, creds.cpPass, '/public_html', '.htaccess', content + result.prependDirective, creds.whmHost)
            }
          }
        } catch (_) {}
      }
      try { const zone = await cfService.getZoneByName(ctx.cpDomain); if (zone) workerResult = await antiRed.deploySharedWorkerRoute(ctx.cpDomain, zone.id) } catch (_) {}
      try { if (db) await db.collection('registeredDomains').updateOne({ _id: ctx.cpDomain }, { $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '', 'val.visitorCaptchaOff': '' } }) } catch (_) {}
      try { await antiRed.setDomainChallengeBypass(ctx.cpDomain, false) } catch (_) {}
    } else {
      result = await antiRed.removeJSChallenge(ctx.cpUser)
      try { if (db) await db.collection('registeredDomains').updateOne({ _id: ctx.cpDomain }, { $set: { 'val.visitorCaptchaOff': true }, $unset: { 'val.antiRedOff': '', 'val.antiRedOffAt': '' } }) } catch (_) {}
      try { await antiRed.setDomainChallengeBypass(ctx.cpDomain, true) } catch (_) {}
    }
    res.json({ jsChallengeEnabled: !!enabled, workerRoutes: workerResult, ...(result || {}) })
  }))

  // ════════════════════════════════════════════════════════
  // FILE MANAGER — large-file chunked upload (base64 chunks over JSON)
  // ════════════════════════════════════════════════════════
  router.post('/hosting/:user/files/upload-chunk', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    _sweepChunkSessions()
    const { uploadId, chunkIndex, totalChunks, fileName, dir } = req.body || {}
    const contentB64 = (req.body && (req.body.content_base64 || req.body.contentBase64)) || null
    if (uploadId == null || chunkIndex == null || totalChunks == null || !fileName || !dir || contentB64 == null) {
      return res.status(400).json({ error: 'missing_parameter', message: 'uploadId, chunkIndex, totalChunks, fileName, dir and content_base64 are required.' })
    }
    if (isProtectedAntiRedFile(dir, fileName)) return res.status(403).json({ error: 'protected_file', message: `${fileName} is protected by Anti-Red and cannot be uploaded.` })
    const idx = parseInt(chunkIndex, 10), total = parseInt(totalChunks, 10)
    if (!Number.isFinite(idx) || !Number.isFinite(total) || idx < 0 || idx >= total || total > 1000) return res.status(400).json({ error: 'invalid_chunk', message: 'Invalid chunkIndex/totalChunks.' })
    let buf
    try { buf = Buffer.from(String(contentB64), 'base64') } catch (_) { return res.status(400).json({ error: 'invalid_base64', message: 'content_base64 must be valid base64.' }) }
    const sessionKey = `${req.reseller.ownerChatId}::${String(req.params.user).toLowerCase()}::${uploadId}`
    let session = chunkSessions.get(sessionKey)
    if (!session) { session = { dir, fileName, totalChunks: total, chunks: new Array(total), received: new Set(), bytes: 0, createdAt: Date.now() } ; chunkSessions.set(sessionKey, session) }
    else if (session.totalChunks !== total || session.fileName !== fileName) return res.status(400).json({ error: 'session_mismatch', message: 'Chunk session metadata mismatch — start a new upload.' })
    session.touchedAt = Date.now()
    const prev = session.chunks[idx]; if (prev) session.bytes -= prev.length
    session.chunks[idx] = buf; session.bytes += buf.length; session.received.add(idx)
    if (session.bytes > CHUNK_MAX_TOTAL_BYTES) { chunkSessions.delete(sessionKey); return res.status(413).json({ error: 'too_large', message: `Upload exceeded ${Math.floor(CHUNK_MAX_TOTAL_BYTES / (1024 * 1024))} MB cap.` }) }
    if (session.received.size < total) return res.json({ status: 'chunk-received', uploadId, received: session.received.size, totalChunks: total })
    // All chunks in — assemble.
    const assembled = Buffer.concat(session.chunks)
    chunkSessions.delete(sessionKey)
    const san = cpProxy.sanitizeCpanelFileName(fileName)
    if (!fileOpsLive()) return dryRun(res, acct, 'files.upload-chunk', { path: `${dir}/${san.name}`, bytes: assembled.length })
    const ctx = withCreds(res, acct); if (!ctx) return
    let result = await cpProxy.uploadFile(ctx.cpUser, ctx.cpPass, dir, san.name, assembled, ctx.whmHost)
    if ((!result || result.status !== 1)) {
      // WHM impersonation-session fallback (same as panel's upload path).
      try { const sess = await cpProxy.uploadFileViaSession(ctx.cpUser, dir, san.name, assembled, ctx.whmHost || process.env.WHM_HOST); if (sess && sess.status === 1) result = sess } catch (_) {}
    }
    res.json({ ...(result || {}), status: 'complete', cpanelStatus: result && result.status, ...(san.changed ? { renamedFrom: san.original, savedAs: san.name } : {}) })
  }))

  router.post('/hosting/:user/files/upload-chunk/cancel', apiKeyAuth, h(async (req, res) => {
    const acct = await loadOwned(req, res); if (!acct) return
    const uploadId = req.body && req.body.uploadId
    if (!uploadId) return res.status(400).json({ error: 'missing_parameter', message: "'uploadId' is required." })
    const sessionKey = `${req.reseller.ownerChatId}::${String(req.params.user).toLowerCase()}::${uploadId}`
    const existed = chunkSessions.delete(sessionKey)
    res.json({ status: existed ? 'cancelled' : 'not_found' })
  }))

  log(`[ResellerAPI] hosting-management routes registered (email+test, mysql+phpmyadmin, subdomains+bulk, files+chunked-upload, domains+docroot+set-primary+ns-status, account/site-status, ssl, stats, security+js-challenge, geo, analytics)`)
}

module.exports = { registerHostingMgmtRoutes, ctxFromAccount, isProtectedAntiRedFile }
