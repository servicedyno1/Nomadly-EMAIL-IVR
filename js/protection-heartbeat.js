/* global process */
/**
 * Protection Heartbeat — hourly self-healing check for every cPanel account.
 *
 * Ensures these critical Anti-Red artifacts exist and are intact on every
 * provisioned cPanel account:
 *
 *   1. /public_html/.user.ini                 → auto_prepend_file pointing at the challenge
 *   2. /public_html/.antired-challenge.php    → IP restore + session bootstrap
 *
 * If either is missing or has been mutated by a client/tool/template overwrite,
 * deployCFIPFix() is called to restore them immediately.
 *
 * This complements hosting-health-check.js (which only runs 5min/30min/2hr post-
 * provisioning) by covering the whole fleet indefinitely.
 */

require('dotenv').config()
const axios = require('axios')
const https = require('https')
const { log } = require('console')

const WHM_HOST = process.env.WHM_HOST
const WHM_USERNAME = process.env.WHM_USERNAME || 'root'
const WHM_TOKEN = process.env.WHM_TOKEN

// Prefer the Cloudflare tunnel (WHM_API_URL) over the origin IP:2087. The DO
// firewall lockdown blocks direct access to the origin's :2087, so a hardcoded
// `https://<host>:2087` makes every get_file_content hang for the full 30s
// timeout → empty content → the heartbeat marks ALL accounts
// `whm_read_unreliable` and skips them every cycle (protection never verified).
// Mirrors whm-service.js so both use the same working path.
const WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const WHM_BASE = WHM_API_URL ? `${WHM_API_URL}/json-api` : `https://${WHM_HOST}:2087/json-api`

const whmApi = (WHM_HOST || WHM_API_URL) && WHM_TOKEN ? axios.create({
  baseURL: WHM_BASE,
  headers: {
    Authorization: `whm ${WHM_USERNAME}:${WHM_TOKEN}`,
    ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    } : {}),
  },
  timeout: 30000,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
}) : null

// Run every hour by default
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.PROTECTION_HEARTBEAT_INTERVAL_MIN || '60', 10) * 60 * 1000

// Rate limit WHM calls — sleep between accounts
const PER_ACCOUNT_DELAY_MS = 250
const WHM_TIMEOUT_BREAKER = 3          // consecutive timed-out accounts → abort cycle
const WHM_OUTAGE_ALERT_CYCLES = 3      // consecutive aborted/all-skipped cycles → page admin
let _whmOutageCycles = 0
let _whmOutageAlerted = false

// Page admin once when WHM reads have been unusable for N cycles in a row, and once on recovery.
async function trackWhmOutage(summary) {
  const checked = summary.total - summary.skipped
  const unusable = !!summary.aborted || (summary.total > 0 && checked <= 0 && summary.skippedWhmReadUnreliable === summary.total)
  if (unusable) {
    _whmOutageCycles++
    if (_whmOutageCycles >= WHM_OUTAGE_ALERT_CYCLES && !_whmOutageAlerted) {
      _whmOutageAlerted = true
      await alertAdmin(
        `\ud83d\udea8 <b>WHM API unreachable — Anti-Red protection UNVERIFIED</b>\n\n` +
        `Protection heartbeat could not read any cPanel files for ${_whmOutageCycles} consecutive cycles (~${_whmOutageCycles}h).\n` +
        `Host: <code>${process.env.WHM_HOST || '?'}</code> via <code>${process.env.WHM_API_URL || 'direct :2087'}</code>\n\n` +
        `Check cpsrvd on the WHM box (<code>/scripts/restartsrv_cpsrvd</code>) and the Cloudflare tunnel. ` +
        `Panel uploads/file ops are likely failing for customers too.`
      )
    }
    return
  }
  if (_whmOutageAlerted) {
    await alertAdmin(`\u2705 <b>WHM API recovered</b> — heartbeat verified ${checked}/${summary.total} accounts after ${_whmOutageCycles} unusable cycles.`)
  }
  _whmOutageCycles = 0
  _whmOutageAlerted = false
}

let db = null
let heartbeatTimer = null
let isRunning = false

function init(mongoDb) {
  db = mongoDb
  log('[ProtectionHeartbeat] Initialized')
}

// ─── File fetch helpers (via WHM root token) ─────────────

async function getFile(cpUsername, dir, file) {
  try {
    const res = await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'get_file_content',
        dir, file,
      },
    })
    // cPanel returns `errors: ["No such user"]` for terminated accounts in the
    // result.errors array, while the HTTP call itself is a 200. Surface that
    // so the caller can short-circuit to `accountGone`.
    const result = res.data?.result
    if (result?.errors && Array.isArray(result.errors) && result.errors.length > 0) {
      return { content: '', whmErrors: result.errors }
    }
    return { content: result?.data?.content || '' }
  } catch (e) {
    return { content: '', fetchError: e.message, status: e.response?.status }
  }
}

// Intact if .user.ini contains our auto_prepend and challenge PHP is the IP-fix variant
function isUserIniIntact(content, cpUsername) {
  if (!content) return false
  const expected = `/home/${cpUsername}/public_html/.antired-challenge.php`
  return content.includes('auto_prepend_file') && content.includes(expected)
}

function isChallengePhpIntact(content) {
  if (!content) return false
  return content.includes('ANTIRED_IP_FIXED') &&
         content.includes('CF_CONNECTING_IP') &&
         content.includes("FIL212sD")
}

// ─── Core heartbeat ──────────────────────────────────────

// Track consecutive repairs per account to detect broken accounts
// BUG FIX (2026-02): Counter is also persisted to `cpanelAccounts.protectionRepairCount`
// so it survives container restarts. Previously the in-memory map reset every
// boot, which meant the 3x-skip guard never actually triggered in production
// for accounts that were being repaired every hour.
const consecutiveRepairs = {}
const MAX_CONSECUTIVE_REPAIRS = 3  // Skip after N consecutive repairs without sticking

// ── PREVENTION (2026-06): never give up FOREVER on a stuck account ──
// Before this, hitting MAX_CONSECUTIVE_REPAIRS excluded the account from all
// future scans permanently. A transient cause — e.g. a one-time client upload
// that overwrote/deleted .user.ini + .antired-challenge.php, or a brief WHM
// hiccup — would then leave a PAID Anti-Red site serving the cloak 404/decoy to
// its own owner indefinitely, with no alert. (Root-caused on securitedesjardins.com.)
// Now: after a cooldown we reset the counter and retry once, and we alert the
// admin the first time an account gets stuck.
const STUCK_RETRY_COOLDOWN_MS = parseInt(process.env.PROTECTION_STUCK_RETRY_COOLDOWN_MIN || '360', 10) * 60 * 1000

// Pure helper: has a stuck account cooled down enough to retry? (testable, no WHM)
function isStuckCooledDown(stuckAt, now = Date.now()) {
  if (!stuckAt) return false
  return (now - new Date(stuckAt).getTime()) >= STUCK_RETRY_COOLDOWN_MS
}

// ── Pure helpers for the transient-empty-read defence (testable, no WHM) ──
// Used by `checkAndRepair` to stop false-positive STUCK alerts when WHM's
// get_file_content returns empty under load.
const RETRY_DELAYS_MS = [750, 2000, 5000]  // exponential backoff for empty-read retries

function isEmptyReadPair(iniRes, phpRes) {
  // Both files came back without any usable content (could be empty string or
  // undefined — getFile() normalises to '' but be defensive).
  return !(iniRes && iniRes.content) && !(phpRes && phpRes.content)
}

function hasNoExplicitError(iniRes, phpRes) {
  // "Explicit error" means cPanel/WHM told us something concrete (per-file
  // whmErrors like "No such user", or a fetchError with a known HTTP status).
  // If we see ANY of those, the empty content is NOT a transient read — it's
  // either a real account state issue or a hard failure. Fall through to the
  // existing logic in those cases.
  const iniHasErr = !!((iniRes && iniRes.whmErrors && iniRes.whmErrors.length) || (iniRes && iniRes.fetchError && iniRes.status))
  const phpHasErr = !!((phpRes && phpRes.whmErrors && phpRes.whmErrors.length) || (phpRes && phpRes.fetchError && phpRes.status))
  return !iniHasErr && !phpHasErr
}

// Used after all retries are exhausted. Returns true if we should SKIP this
// account's repair cycle (treat as transient WHM read failure) rather than
// increment the counter / call deployCFIPFix.
//   { iniContent, phpContent, iniWhmErrors, phpWhmErrors, lastCfIpFixSig }
// Pure function: easy to unit-test without a DB or WHM mock.
function shouldSkipAsTransient(snapshot) {
  const {
    iniContent = '', phpContent = '',
    iniWhmErrors = [], phpWhmErrors = [],
    iniFetchError = null, phpFetchError = null,
    iniStatus = null, phpStatus = null,
    lastCfIpFixSig = null,
  } = snapshot || {}
  const bothEmpty = !iniContent && !phpContent
  const iniHasErr = (iniWhmErrors && iniWhmErrors.length) || (iniFetchError && iniStatus)
  const phpHasErr = (phpWhmErrors && phpWhmErrors.length) || (phpFetchError && phpStatus)
  const noExplicitErr = !iniHasErr && !phpHasErr
  const hasDeploySig = !!lastCfIpFixSig
  return bothEmpty && noExplicitErr && hasDeploySig
}

// Pure helper: the cpanelAccounts scan filter (testable, no WHM). Includes
// healthy accounts AND stuck-but-cooled-down accounts (for one auto-recovery try).
function buildAccountScanFilter(now = Date.now()) {
  const cooldownCutoff = new Date(now - STUCK_RETRY_COOLDOWN_MS)
  return {
    deleted: { $ne: true },
    $or: [
      { protectionRepairCount: { $exists: false } },
      { protectionRepairCount: { $lt: MAX_CONSECUTIVE_REPAIRS } },
      { protectionRepairCount: { $gte: MAX_CONSECUTIVE_REPAIRS }, protectionStuckAt: { $lte: cooldownCutoff } },
    ],
  }
}

// Best-effort admin Telegram alert (never throws, never blocks the heartbeat).
// Uses the active bot token (config-setup.js sets TELEGRAM_BOT_TOKEN to dev/prod).
//
// ── P1: ALERT DEDUP/DIGEST (2026-02) ──
// Previously each stuck account fired its own Telegram message instantly,
// flooding the admin during WHM load spikes (28 messages in the 2026-06-24
// incident). Now alerts are batched: `queueStuckAlert()` collects them during
// the heartbeat cycle, and `flushStuckAlerts()` sends a single digest at the end.
const _stuckAlertQueue = []

async function alertAdmin(html) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_PROD
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
    if (!token || !chatId) return
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true,
    }, { timeout: 10000 })
  } catch (e) { /* best-effort */ }
}

function queueStuckAlert(cpUsername, domain, plan, chatId) {
  _stuckAlertQueue.push({ cpUsername, domain, plan, chatId, at: new Date() })
}

async function flushStuckAlerts() {
  if (_stuckAlertQueue.length === 0) return
  const items = _stuckAlertQueue.splice(0) // drain the queue

  if (items.length === 1) {
    // Single alert — send as before (more detail)
    const a = items[0]
    await alertAdmin(
      `\u26a0\ufe0f <b>Anti-Red protection STUCK</b>\n\n` +
      `\ud83c\udf10 <b>${a.domain || a.cpUsername}</b> (cPanel <code>${a.cpUsername}</code>)\n` +
      `\ud83d\udce6 Plan: ${a.plan || 'unknown'}\n` +
      `\ud83d\udc64 Owner chatId: <code>${a.chatId || '?'}</code>\n\n` +
      `Protection files won't stick after ${MAX_CONSECUTIVE_REPAIRS} repairs.\n` +
      `Auto-retry in ~${Math.round(STUCK_RETRY_COOLDOWN_MS / 60000)}m.`
    )
    return
  }

  // Multiple alerts — send a digest
  const lines = items.map(a =>
    `  \u2022 <b>${a.domain || a.cpUsername}</b> (<code>${a.cpUsername}</code>) — ${a.plan || '?'}`
  ).join('\n')

  await alertAdmin(
    `\u26a0\ufe0f <b>Anti-Red protection STUCK — ${items.length} accounts</b>\n\n` +
    lines + '\n\n' +
    `Protection files won't stick after ${MAX_CONSECUTIVE_REPAIRS} consecutive repairs on these accounts.\n` +
    `Auto-retry in ~${Math.round(STUCK_RETRY_COOLDOWN_MS / 60000)}m each.\n` +
    `Most common cause: client upload overwrote/deleted protection files, or WHM read unreliable under load.`
  )
}

async function getRepairCount(cpUsername) {
  // In-memory cache wins if set (latest within this process), otherwise
  // fall back to the persisted DB value.
  if (cpUsername in consecutiveRepairs) return consecutiveRepairs[cpUsername]
  if (!db) return 0
  try {
    const doc = await db.collection('cpanelAccounts').findOne(
      { _id: cpUsername },
      { projection: { protectionRepairCount: 1 } }
    )
    const persisted = (doc && doc.protectionRepairCount) || 0
    consecutiveRepairs[cpUsername] = persisted
    return persisted
  } catch (e) {
    return 0
  }
}

async function setRepairCount(cpUsername, count, extra = {}) {
  consecutiveRepairs[cpUsername] = count
  if (!db) return
  try {
    await db.collection('cpanelAccounts').updateOne(
      { _id: cpUsername },
      { $set: { protectionRepairCount: count, protectionRepairUpdatedAt: new Date(), ...extra } }
    )
  } catch (e) {
    log(`[ProtectionHeartbeat] persist repair counter failed for ${cpUsername}: ${e.message}`)
  }
}

// ── P1: HTTP Health Probe (2026-02) ──────────────────────
// Before marking an account as STUCK, do a quick HTTP probe to see if the
// protection is ACTUALLY working at the edge. If the CF Worker responds
// correctly (cloaking scanners or showing the challenge page), the files
// on WHM don't matter — the protection IS functional. This prevents
// false STUCK alerts when WHM reads are unreliable but the Worker is fine.
//
// Returns: { working: boolean, reason: string }
async function probeProtectionHealth(domain) {
  if (!domain) return { working: false, reason: 'no_domain' }

  try {
    // Test with a scanner UA — should get cloaked (302 redirect or placeholder)
    const res = await axios.get(`https://${domain}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: () => true, // accept any status
    })

    const status = res.status
    const headers = res.headers || {}
    const body = (res.data || '').toString().substring(0, 1000)

    // Check for Anti-Red Worker signatures
    if (headers['x-antired'] === 'cloaked' || headers['x-antired'] === 'cloaked-html') {
      return { working: true, reason: 'worker_cloaking_active' }
    }
    if (status === 302 && res.headers.location) {
      // Scanner redirect (to Wikipedia etc.)
      return { working: true, reason: 'scanner_redirect_active' }
    }
    if (body.includes('Professional Business Solutions')) {
      return { working: true, reason: 'placeholder_served' }
    }
    if (headers['x-antired'] === 'challenge') {
      return { working: true, reason: 'challenge_page_active' }
    }

    // No protection detected
    return { working: false, reason: `no_protection_detected (status=${status})` }
  } catch (err) {
    // Network error — can't determine, assume not working
    return { working: false, reason: `probe_failed: ${err.message}` }
  }
}

async function checkAndRepair(cpUsername) {
  // Skip accounts stuck in repair loop (counter is persisted in Mongo so it
  // survives restarts — otherwise the guard never fires in production).
  const currentCount = await getRepairCount(cpUsername)
  if (currentCount >= MAX_CONSECUTIVE_REPAIRS) {
    // PREVENTION: don't skip forever. After a cooldown, reset the counter and try
    // ONE more full repair so a paid site that broke for a transient reason can
    // self-heal (instead of serving the cloak 404/decoy to its owner indefinitely).
    let stuckAt = null
    try {
      const doc = await db.collection('cpanelAccounts').findOne(
        { _id: cpUsername }, { projection: { protectionStuckAt: 1 } })
      stuckAt = doc && doc.protectionStuckAt
    } catch (e) { /* ignore — fall back to skip below */ }
    if (!isStuckCooledDown(stuckAt)) {
      return { cpUsername, ok: false, action: 'skipped', reason: 'stuck_repair_loop' }
    }
    const mins = stuckAt ? Math.round((Date.now() - new Date(stuckAt).getTime()) / 60000) : 0
    log(`[ProtectionHeartbeat] ${cpUsername} cooled down (${mins}m since stuck) — auto-resetting counter for one more repair attempt`)
    await setRepairCount(cpUsername, 0, { protectionLastSkipReason: null, protectionStuckAt: null, protectionAutoRecoveryAt: new Date() })
    // fall through with a fresh (0) counter
  }
  const iniRes1 = await getFile(cpUsername, '/public_html', '.user.ini')
  const phpRes1 = await getFile(cpUsername, '/public_html', '.antired-challenge.php')
  let iniRes = iniRes1
  let phpRes = phpRes1

  // ── Transient-empty-read guard (2026-06-24, hardened 2026-06-24-v2) ──
  // WHM's /json-api get_file_content occasionally returns empty content even
  // when the file is intact on disk — intermittent cpsrvd/Fileman hiccup,
  // proxy buffer flush, transient I/O race, OR WHM under sustained load (we
  // observed minute-long stalls during the 2026-06-24 incident).
  //
  // Without a robust retry/fallback, the heartbeat counts these false-empties
  // as "missing" → increments the repair counter → marks STUCK after 3
  // consecutive false-positives even though the protection IS deployed.
  //
  // Defence:
  //   1. Up to 3 retries with exponential backoff (750ms, 2s, 5s) — gives a
  //      slow/overloaded WHM more breathing room than the original 1×750ms.
  //   2. If reads STILL come back empty after every retry AND there were no
  //      explicit per-file errors (whmErrors / "No such user" / etc.) AND
  //      this account has a `lastCfIpFixSig` on record (= cryptographic proof
  //      we successfully deployed the protection at some point) → classify
  //      as `whm_read_unreliable` and skip WITHOUT incrementing the counter
  //      and WITHOUT calling deployCFIPFix. This is the key fix that stops
  //      the false-positive STUCK alert storm.
  //   3. Property-name fix: previous version checked `iniRes.error` but
  //      getFile() actually sets `fetchError`. Now uses the correct field.
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (!isEmptyReadPair(iniRes, phpRes)) break
    if (!hasNoExplicitError(iniRes, phpRes)) break  // explicit error → not transient, fall through
    await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    const iniRes2 = await getFile(cpUsername, '/public_html', '.user.ini')
    const phpRes2 = await getFile(cpUsername, '/public_html', '.antired-challenge.php')
    // Prefer whichever pass returned content (defends against blip on either
    // pass; protection check below only needs one good read)
    if ((iniRes2.content || '').length > (iniRes.content || '').length) iniRes = iniRes2
    if ((phpRes2.content || '').length > (phpRes.content || '').length) phpRes = phpRes2
    if (iniRes2.content && phpRes2.content && (!iniRes1.content || !phpRes1.content)) {
      log(`[ProtectionHeartbeat] ${cpUsername} — empty read recovered on retry #${attempt+1} (transient WHM read; no false-positive incremented)`)
      break
    }
  }

  // ── Trust-last-deploy fallback ──
  // After all retries, if BOTH files are still empty AND there were no
  // explicit per-file errors, look up `lastCfIpFixSig`. If we have a deploy
  // signature on record, the protection IS deployed and this is a WHM read
  // reliability issue — NOT a real file loss. Skip safely. If we have NO
  // deploy signature, fall through to the existing repair path (the account
  // was never deployed, so we should try to deploy now).
  if (isEmptyReadPair(iniRes, phpRes) && hasNoExplicitError(iniRes, phpRes)) {
    let hasDeploySignature = false
    try {
      const doc = await db.collection('cpanelAccounts').findOne(
        { _id: cpUsername }, { projection: { lastCfIpFixSig: 1, lastCfIpFixAt: 1 } })
      hasDeploySignature = !!(doc && doc.lastCfIpFixSig)
    } catch (e) { /* ignore — fall through */ }
    if (hasDeploySignature) {
      // Silent skip — this fires ~230/22h on prod when WHM is under load
      // and floods Railway's 500 msgs/sec cap. The count is aggregated
      // into the per-cycle summary line (see runHeartbeat) instead.
      // Set PROTECTION_HEARTBEAT_VERBOSE=1 to restore per-user logging.
      if (process.env.PROTECTION_HEARTBEAT_VERBOSE === '1') {
        log(`[ProtectionHeartbeat] ${cpUsername} — WHM read unreliable (empty content after ${RETRY_DELAYS_MS.length} retries, no explicit errors). lastCfIpFixSig present → SKIPPING this cycle (assuming files intact on disk). No counter increment, no alert.`)
      }
      const isTimeout = r => !!(r && r.fetchError && !r.status)
      return { cpUsername, ok: true, action: 'skipped', reason: 'whm_read_unreliable', timedOut: isTimeout(iniRes) && isTimeout(phpRes) }
    }
  }

  // ── If WHM says the user no longer exists, auto-mark as deleted in DB so
  // future heartbeats stop scanning it. Detected by either an explicit
  // "No such user" error from cPanel, or a 401/404 from WHM on both files.
  const whmErrCombined = [
    ...(iniRes.whmErrors || []),
    ...(phpRes.whmErrors || []),
  ]
  const looksGoneOnWhm =
    whmErrCombined.some(e => /No such user|user does not exist|Cpanel::Sys::Suspended/i.test(String(e))) ||
    ((iniRes.status === 401 || iniRes.status === 404) && (phpRes.status === 401 || phpRes.status === 404))
  if (looksGoneOnWhm) {
    if (db) {
      try {
        await db.collection('cpanelAccounts').updateOne(
          { _id: cpUsername },
          { $set: { deleted: true, deletedAt: new Date(), deletedReason: 'auto: not_on_whm', deletedBy: 'protection_heartbeat' } }
        )
        log(`[ProtectionHeartbeat] AUTO-DELETED ${cpUsername} in DB — account no longer on WHM (errs: ${JSON.stringify(whmErrCombined).slice(0,200)})`)
      } catch (dbErr) {
        log(`[ProtectionHeartbeat] auto-delete DB write failed for ${cpUsername}: ${dbErr.message}`)
      }
    }
    return { cpUsername, ok: false, action: 'skipped', reason: 'not_on_whm' }
  }

  const userIni = iniRes.content || ''
  const challenge = phpRes.content || ''

  const iniOk = isUserIniIntact(userIni, cpUsername)
  const phpOk = isChallengePhpIntact(challenge)

  if (iniOk && phpOk) {
    // Files are intact — reset persisted consecutive repair counter
    if ((await getRepairCount(cpUsername)) > 0) {
      await setRepairCount(cpUsername, 0, { protectionLastSkipReason: null })
    }
    return { cpUsername, ok: true, action: 'none' }
  }

  // Diagnostic: log what state the files are in before repair
  const iniState = !userIni ? 'MISSING' : !userIni.includes('auto_prepend_file') ? 'NO_PREPEND' : 'WRONG_PATH'
  const phpState = !challenge ? 'MISSING' : !challenge.includes('ANTIRED_IP_FIXED') ? 'WRONG_CONTENT' : 'PARTIAL'
  const iniSnippet = userIni ? userIni.slice(0, 120).replace(/\n/g, '\\n') : '(empty)'
  const phpSnippet = challenge ? challenge.slice(0, 120).replace(/\n/g, '\\n') : '(empty)'
  log(`[ProtectionHeartbeat] DIAG ${cpUsername}: .user.ini=${iniState} [${iniSnippet}] | .php=${phpState} [${phpSnippet}]`)

  // Repair — for .user.ini, MERGE our directive instead of overwriting
  // so we preserve any existing directives (e.g., from CMS/plugins/server)
  try {
    const antiRed = require('./anti-red-service')
    const expectedPrepend = `/home/${cpUsername}/public_html/.antired-challenge.php`

    // If .user.ini exists but lacks our directive, merge instead of overwrite
    if (userIni && !iniOk) {
      const mergedIni = mergeUserIni(userIni, cpUsername)
      await saveFile(cpUsername, '/public_html', '.user.ini', mergedIni)
      log(`[ProtectionHeartbeat] MERGED .user.ini for ${cpUsername} (preserved existing directives)`)
    }

    // For the challenge PHP and missing .user.ini, use the standard deployCFIPFix
    if (!userIni || !phpOk) {
      // `force: true` — bypass the deployCFIPFix idempotency cache. We've
      // already verified on WHM that the files are missing/corrupted, so the
      // cache MUST NOT skip the write or we'd be stuck in a repair loop
      // (3 fake repairs → STUCK alert → 6h pause while the site stays down).
      const result = await antiRed.deployCFIPFix(cpUsername, { force: true })
      // If we already merged .user.ini above, re-merge to restore our directives
      // (deployCFIPFix overwrites .user.ini)
      if (userIni && !iniOk) {
        const freshIniRes = await getFile(cpUsername, '/public_html', '.user.ini')
        const _freshIni = freshIniRes.content || ''
        const reMerged = mergeUserIni(userIni, cpUsername)
        await saveFile(cpUsername, '/public_html', '.user.ini', reMerged)
      }
    }

    const reason = [
      !iniOk ? '.user.ini' : null,
      !phpOk ? '.antired-challenge.php' : null,
    ].filter(Boolean).join('+')
    log(`[ProtectionHeartbeat] REPAIRED ${cpUsername} (${reason}): OK`)
    const newCount = (await getRepairCount(cpUsername)) + 1
    const extra = newCount >= MAX_CONSECUTIVE_REPAIRS
      ? { protectionLastSkipReason: 'stuck_repair_loop', protectionStuckAt: new Date() }
      : {}
    await setRepairCount(cpUsername, newCount, extra)
    if (newCount >= MAX_CONSECUTIVE_REPAIRS) {
      log(`[ProtectionHeartbeat] ⚠️ ${cpUsername} repaired ${MAX_CONSECUTIVE_REPAIRS}x consecutively — files won't stick. Checking edge health before alerting...`)

      // ── P1: HTTP health probe as STUCK second-opinion ──
      // Before alerting admin, check if protection actually WORKS at the edge.
      // WHM reads might be unreliable, but the CF Worker could be running fine.
      try {
        const acc = await db.collection('cpanelAccounts').findOne(
          { _id: cpUsername }, { projection: { domain: 1, plan: 1, chatId: 1 } })
        const domain = acc && acc.domain

        if (domain) {
          const probe = await probeProtectionHealth(domain)
          if (probe.working) {
            log(`[ProtectionHeartbeat] ✅ ${cpUsername} — edge probe says protection IS working (${probe.reason}). Downgrading STUCK to info-only.`)
            // Protection works at edge — don't alarm admin. Reset counter.
            await setRepairCount(cpUsername, 0, {
              protectionLastSkipReason: 'edge_probe_ok',
              protectionStuckAt: null,
              protectionEdgeProbeAt: new Date(),
              protectionEdgeProbeResult: probe.reason,
            })
            return { cpUsername, ok: true, action: 'repaired', reason, edgeProbe: 'working' }
          }
          log(`[ProtectionHeartbeat] ❌ ${cpUsername} — edge probe confirms protection DOWN (${probe.reason}). Alerting admin.`)
        }

        // Edge probe failed or no domain — queue alert for digest
        log(`[ProtectionHeartbeat] ⚠️ ${cpUsername} — pausing repairs; will auto-retry in ~${Math.round(STUCK_RETRY_COOLDOWN_MS / 60000)}m.`)
        queueStuckAlert(cpUsername, acc && acc.domain, acc && acc.plan, acc && acc.chatId)
      } catch (e) { /* best-effort probe + alert */ }
    }
    return { cpUsername, ok: true, action: 'repaired', reason }
  } catch (err) {
    log(`[ProtectionHeartbeat] Repair error for ${cpUsername}: ${err.message}`)
    return { cpUsername, ok: false, action: 'error', error: err.message }
  }
}

/**
 * Merge our auto_prepend directive into an existing .user.ini without losing
 * existing directives (e.g., from WordPress, LiteSpeed Cache, cPanel defaults).
 * PHP uses the LAST auto_prepend_file when duplicates exist, so ours goes at the bottom.
 */
function mergeUserIni(existingContent, cpUsername) {
  const expectedLine = `auto_prepend_file = /home/${cpUsername}/public_html/.antired-challenge.php`

  // Remove ALL auto_prepend_file lines (ours and any others — we'll add ours back at the bottom)
  let cleaned = existingContent.replace(/^auto_prepend_file\s*=.*$/gm, '')
  // Remove our comment header if it exists
  cleaned = cleaned.replace(/^;\s*Anti-Red:.*$/gm, '')
  // Clean up excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  // Place our directive at the BOTTOM (PHP uses the last auto_prepend_file)
  const merged = `${cleaned ? cleaned + '\n\n' : ''}; Anti-Red: CF IP Restoration (do not remove)\n${expectedLine}`
  return merged
}

async function saveFile(cpUsername, dir, file, content) {
  await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 3,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'save_file_content',
      dir, file, content,
    },
  })
}

async function runHeartbeat() {
  if (!db) { log('[ProtectionHeartbeat] Not initialized'); return }
  if (!whmApi) { log('[ProtectionHeartbeat] WHM not configured — skipping'); return }
  if (isRunning) { log('[ProtectionHeartbeat] Already running — skipping'); return }

  // ── DEV SAFETY GUARD (2026-06-24) ──
  // The heartbeat WRITES to cpanelAccounts (protectionRepairCount / Stuck flags)
  // and triggers admin Telegram alerts. When a dev pod points at the production
  // MONGO_URL but can't reach WHM (TCP firewall), every scan from that pod
  // produces empty reads → increment → false STUCK → admin alert spam, AND
  // mutates production metadata. SKIP_WEBHOOK_SYNC=true is already the project's
  // canonical "this is a dev sandbox" marker. Honour it here too.
  if (process.env.SKIP_WEBHOOK_SYNC === 'true') {
    log('[ProtectionHeartbeat] SKIP_WEBHOOK_SYNC=true — heartbeat DISABLED (dev sandbox: must not mutate prod cpanelAccounts or alert admin)')
    return { skipped: true, reason: 'dev_sandbox' }
  }

  isRunning = true
  const startTime = Date.now()
  const summary = { total: 0, ok: 0, repaired: 0, errors: 0, skipped: 0, skippedWhmReadUnreliable: 0 }

  try {
    // Only scan ACTIVE accounts. Deleted accounts can never be repaired
    // (cPanel user is gone) and waste WHM API calls. Healthy accounts (counter
    // below MAX) are scanned every cycle; stuck accounts are scanned ONCE per
    // cooldown window so they can auto-recover instead of staying broken forever.
    const accounts = await db.collection('cpanelAccounts').find(
      buildAccountScanFilter()
    ).toArray()
    summary.total = accounts.length
    log(`[ProtectionHeartbeat] Checking ${accounts.length} cPanel accounts (deleted excluded; cooled-down stuck accounts retried)...`)

    let consecutiveTimeouts = 0
    for (let idx = 0; idx < accounts.length; idx++) {
      const account = accounts[idx]
      const cpUsername = account._id || account.cpUser
      if (!cpUsername || typeof cpUsername !== 'string') continue

      const result = await checkAndRepair(cpUsername)
      if (result.action === 'none') summary.ok++
      else if (result.action === 'repaired' && result.ok) summary.repaired++
      else if (result.action === 'skipped') {
        summary.skipped++
        if (result.reason === 'whm_read_unreliable') summary.skippedWhmReadUnreliable++
      }
      else summary.errors++

      // ── Circuit breaker (2026-10-01) ── WHM API hung for 32h after the 09-28 whm2
      // reboot: every getFile timed out (30s × 8 per account) so each cycle ground
      // through ALL accounts for 70 min and nobody was alerted. Abort the cycle once
      // WHM_TIMEOUT_BREAKER accounts in a row time out; the outage alert below pages admin.
      consecutiveTimeouts = (result.reason === 'whm_read_unreliable' && result.timedOut) ? consecutiveTimeouts + 1 : 0
      if (consecutiveTimeouts >= WHM_TIMEOUT_BREAKER) {
        const remaining = accounts.length - idx - 1
        summary.skipped += remaining
        summary.aborted = 'whm_api_timeouts'
        log(`[ProtectionHeartbeat] WHM API timing out (${consecutiveTimeouts} accounts in a row) — aborting cycle, ${remaining} accounts not checked`)
        break
      }

      await new Promise(r => setTimeout(r, PER_ACCOUNT_DELAY_MS))
    }
  } catch (err) {
    log(`[ProtectionHeartbeat] Fatal error: ${err.message}`)
    summary.fatalError = err.message
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  log(`[ProtectionHeartbeat] Done in ${elapsed}s — total:${summary.total} ok:${summary.ok} repaired:${summary.repaired} skipped:${summary.skipped}${summary.skippedWhmReadUnreliable ? ` (whm_read_unreliable:${summary.skippedWhmReadUnreliable})` : ''} errors:${summary.errors}${summary.aborted ? ` ABORTED:${summary.aborted}` : ''}`)

  await trackWhmOutage(summary)

  // ── P1: Flush queued STUCK alerts as a single digest ──
  try { await flushStuckAlerts() } catch (e) { /* best-effort */ }

  isRunning = false
  return summary
}

// ─── Scheduler ───────────────────────────────────────────

function startScheduler() {
  // ── DEV SAFETY GUARD (2026-06-24) ──
  // Don't even arm the timer in dev sandboxes — see runHeartbeat() comment.
  if (process.env.SKIP_WEBHOOK_SYNC === 'true') {
    log('[ProtectionHeartbeat] SKIP_WEBHOOK_SYNC=true — Scheduler DISABLED (dev sandbox)')
    return
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  const minutes = HEARTBEAT_INTERVAL_MS / 60000
  log(`[ProtectionHeartbeat] Scheduler started — runs every ${minutes}m`)

  // Run first heartbeat after 2 minutes (let services initialize + stagger with enforcer)
  setTimeout(() => {
    runHeartbeat().catch(e => log(`[ProtectionHeartbeat] Run error: ${e.message}`))
  }, 2 * 60 * 1000)

  heartbeatTimer = setInterval(() => {
    runHeartbeat().catch(e => log(`[ProtectionHeartbeat] Run error: ${e.message}`))
  }, HEARTBEAT_INTERVAL_MS)
}

function stopScheduler() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    log('[ProtectionHeartbeat] Scheduler stopped')
  }
}

module.exports = {
  init,
  checkAndRepair,
  runHeartbeat,
  startScheduler,
  stopScheduler,
  // Exposed for admin/test
  getRepairCount,
  setRepairCount,
  MAX_CONSECUTIVE_REPAIRS,
  // PREVENTION helpers (pure, unit-testable without WHM)
  STUCK_RETRY_COOLDOWN_MS,
  isStuckCooledDown,
  buildAccountScanFilter,
  alertAdmin,
  // P1 improvements
  probeProtectionHealth,
  queueStuckAlert,
  flushStuckAlerts,
  // Transient-empty-read defence helpers (pure, unit-testable without WHM)
  RETRY_DELAYS_MS,
  isEmptyReadPair,
  hasNoExplicitError,
  shouldSkipAsTransient,
}
