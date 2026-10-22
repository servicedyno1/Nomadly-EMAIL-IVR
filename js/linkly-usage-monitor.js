/* global process */
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Linkly usage monitor — admin warning BEFORE the plan limits bite
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shortit "Random" links are created on Linkly (js/cuttly.js). Linkly Free plan
// (https://linklyhq.com/pricing): 100 NEW links / month + 500 tracked clicks /
// month. At the link cap new link creation is blocked → users get "Link
// shortening failed". At the click cap Linkly PAUSES every linkly.link redirect
// until the monthly reset.
//
// How usage is measured (usually ONE call per check):
//   GET /api/v1/workspace/{id}/list_links              (active links, every check)
//   GET /api/v1/workspace/{id}/list_links?deleted=true (trashed links, every 6 h)
// list_links is NOT a billed analytics endpoint, but Linkly throttles it hard
// (429 after ~4 calls in 10 min) → hourly checks, 30-min gap for checks
// triggered by new links, 30-min back-off after a 429, never alert on errors.
// Trashed links are included because Linkly counts every link you CREATE
// (deleting doesn't give it back).
// Each link carries inserted_at + clicks_thirty_days → we count links created
// and clicks over a rolling 30-day window (Linkly's billing anchor isn't
// exposed by the API), which errs on the early side — right for a warning.
//
// All bots share ONE Linkly account and the same admin chat, so this runs only
// where LINKLY_USAGE_ALERTS=true (the Nomadly bot) → one alert, not four.
//
// Env:
//   LINKLY_USAGE_ALERTS=true        enable (default: off)
//   LINKLY_LINK_LIMIT=100           plan's new links / month
//   LINKLY_CLICK_LIMIT=500          plan's tracked clicks / month
//   LINKLY_LINK_ALERT_AT=80         warn when links (last 30 days) >= this
//   LINKLY_CLICK_ALERT_AT=400       warn when clicks (last 30 days) >= this
//   LINKLY_USAGE_CHECK_MINUTES=60   periodic check interval
//
// De-dup (Mongo collection `linklyUsage`, doc _id 'alerts'): per metric the
// "warn" and "full" levels each fire once and re-arm only after usage drops
// back below the warning threshold. An alert that fails to send is retried on
// the next check (the level is only stored after Telegram accepted it).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios')
const { getLinklyWorkspaceId } = require('./cuttly.js')

const log = (msg) => console.log(msg)

function _delayFromEnv() {
  const n = parseInt(process.env.LINKLY_TRASH_READ_DELAY_MS, 10)
  return Number.isFinite(n) && n >= 0 ? n : 65 * 1000
}

const LINKLY_API_BASE = 'https://api.linklyhq.com/api/v1'
const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30
// list_links is throttled hard by Linkly (429 after ~4 calls in 10 min), so stay frugal:
const MIN_GAP_MS = 30 * 60 * 1000 // creation-triggered checks: at most one per 30 min
const TRASH_TTL_MS = 6 * 60 * 60 * 1000 // trashed links rarely change → re-read every 6 h
const TRASH_READ_DELAY_MS = _delayFromEnv() // gap between the active and trashed reads (default 65 s)
const BACKOFF_429_MS = 30 * 60 * 1000 // after a 429, skip checks for 30 min
const LINKLY_DASHBOARD = 'https://app.linklyhq.com'
const RANK = { warn: 1, full: 2 }

let _bot = null
let _db = null
let _adminChatId = null
let _enabled = false
let _inFlight = null
let _lastCheckAt = 0
let _lastResult = null
let _trashCache = { at: 0, links: [] }
let _backoffUntil = 0

const _int = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : d
}

function getConfig() {
  const linkLimit = _int(process.env.LINKLY_LINK_LIMIT, 100)
  const clickLimit = _int(process.env.LINKLY_CLICK_LIMIT, 500)
  return {
    linkLimit,
    clickLimit,
    linkWarn: _int(process.env.LINKLY_LINK_ALERT_AT, Math.round(linkLimit * 0.8)),
    clickWarn: _int(process.env.LINKLY_CLICK_ALERT_AT, Math.round(clickLimit * 0.8)),
    intervalMin: _int(process.env.LINKLY_USAGE_CHECK_MINUTES, 60),
  }
}

// Linkly timestamps look like "2026-10-22T20:26:02" (UTC, no zone suffix).
function _parseTs(v) {
  if (!v) return 0
  const s = String(v)
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')
  return Number.isFinite(t) ? t : 0
}

// Pure: links created + clicks over the rolling window. Exported for tests.
function computeUsage(links, now = Date.now()) {
  const since = now - WINDOW_DAYS * DAY_MS
  const seen = new Set()
  let linksCreated = 0
  let clicks = 0
  for (const l of links || []) {
    if (!l || l.id == null || seen.has(l.id)) continue
    seen.add(l.id)
    if (_parseTs(l.inserted_at) >= since) linksCreated++
    clicks += Number(l.clicks_thirty_days) || 0
  }
  return { linksCreated, clicks, totalLinksSeen: seen.size }
}

function levelFor(value, warnAt, limit) {
  if (value >= limit) return 'full'
  if (value >= warnAt) return 'warn'
  return null
}

function buildAlert(metric, level, usage, cfg) {
  const shared = 'All bots share this one Linkly account.'
  if (metric === 'links') {
    const used = usage.linksCreated
    const limit = cfg.linkLimit
    const left = Math.max(0, limit - used)
    if (level === 'full') {
      return [
        '🚨 <b>Linkly link limit reached</b>',
        '',
        `🔗 New links in the last 30 days: <b>${used} / ${limit}</b>`,
        '',
        'New Shortit links now FAIL for users ("Link shortening failed") until Linkly\'s monthly reset.',
        shared,
        '',
        `Fix: upgrade the Linkly plan or add a link pack → ${LINKLY_DASHBOARD}`,
      ].join('\n')
    }
    return [
      '⚠️ <b>Linkly links almost used up</b>',
      '',
      `🔗 New links in the last 30 days: <b>${used} / ${limit}</b> (about ${left} left)`,
      '',
      `At ${limit}, new Shortit links will fail for users until Linkly's monthly reset. Deleting links does not give them back.`,
      shared,
      '',
      `To avoid it: upgrade the Linkly plan or add a link pack → ${LINKLY_DASHBOARD}`,
    ].join('\n')
  }
  const used = usage.clicks
  const limit = cfg.clickLimit
  if (level === 'full') {
    return [
      '🚨 <b>Linkly click limit reached</b>',
      '',
      `👆 Clicks in the last 30 days: <b>${used} / ${limit}</b>`,
      '',
      'On the Free plan Linkly now PAUSES all linkly.link redirects — users\' short links stop opening until the monthly reset.',
      shared,
      '',
      `Fix: upgrade the Linkly plan → ${LINKLY_DASHBOARD}`,
    ].join('\n')
  }
  return [
    '⚠️ <b>Linkly clicks almost used up</b>',
    '',
    `👆 Clicks in the last 30 days: <b>${used} / ${limit}</b>`,
    '',
    `At ${limit} clicks, Linkly pauses all linkly.link redirects on the Free plan until the monthly reset.`,
    shared,
    '',
    `To avoid it: upgrade the Linkly plan → ${LINKLY_DASHBOARD}`,
  ].join('\n')
}

async function _fetchLinks(workspaceId, deleted) {
  const out = []
  for (let page = 1; page <= 5; page++) {
    const params = { page, page_size: 1000, sort_by: 'inserted_at', sort_dir: 'desc' }
    if (deleted) params.deleted = true
    const res = await axios.get(`${LINKLY_API_BASE}/workspace/${workspaceId}/list_links`, {
      params,
      headers: { Authorization: `Bearer ${process.env.LINKLY_API_KEY}`, Accept: 'application/json' },
      timeout: 20000,
    })
    const links = Array.isArray(res.data && res.data.links) ? res.data.links : []
    out.push(...links)
    const totalPages = Number(res.data && res.data.total_pages) || 1
    const oldest = links[links.length - 1]
    const pastWindow = oldest && _parseTs(oldest.inserted_at) < Date.now() - WINDOW_DAYS * DAY_MS
    if (!links.length || page >= totalPages || pastWindow) break
  }
  return out
}

async function getLinklyUsage() {
  if (!process.env.LINKLY_API_KEY) throw new Error('LINKLY_API_KEY is not configured')
  const workspaceId = await getLinklyWorkspaceId()
  const active = await _fetchLinks(workspaceId, false)
  let trashed = _trashCache.links
  let trashFresh = false
  if (Date.now() - _trashCache.at > TRASH_TTL_MS) {
    try {
      // Linkly 429s a 2nd list_links call made right after the 1st (~1 call/min) →
      // wait before the trash read. Background job, so the delay costs nothing.
      await new Promise(r => setTimeout(r, TRASH_READ_DELAY_MS))
      trashed = await _fetchLinks(workspaceId, true)
      _trashCache = { at: Date.now(), links: trashed }
      trashFresh = true
    } catch (e) {
      // Trash is a correction term only — fall back to the last copy rather than fail the check.
      const status = e && e.response && e.response.status
      if (status === 429) _backoffUntil = Date.now() + BACKOFF_429_MS
      log(`[LinklyUsage] trashed-links read failed${status ? ` (HTTP ${status})` : ''} — using cached copy (${trashed.length})`)
    }
  }
  return {
    workspaceId,
    ...computeUsage([...active, ...trashed]),
    activeLinks: active.length,
    trashedLinks: trashed.length,
    trashFresh,
  }
}

function _alertsCol() {
  return _db && typeof _db.collection === 'function' ? _db.collection('linklyUsage') : null
}

async function _evaluate(usage, { dryRun } = {}) {
  const cfg = getConfig()
  const col = _alertsCol()
  const doc = (col && (await col.findOne({ _id: 'alerts' }).catch(() => null))) || {}
  const metrics = [
    { key: 'links', value: usage.linksCreated, warn: cfg.linkWarn, limit: cfg.linkLimit },
    { key: 'clicks', value: usage.clicks, warn: cfg.clickWarn, limit: cfg.clickLimit },
  ]
  const outcome = {}
  const update = {}
  for (const m of metrics) {
    const level = levelFor(m.value, m.warn, m.limit)
    const prev = doc[m.key] || null
    if (!level) {
      outcome[m.key] = { level: null, action: prev ? 're-armed' : 'ok' }
      if (prev) update[m.key] = null
      continue
    }
    if ((RANK[level] || 0) <= (RANK[prev] || 0)) {
      outcome[m.key] = { level, action: 'already-alerted' }
      continue
    }
    if (dryRun || !_enabled || !_bot || !_adminChatId) {
      outcome[m.key] = { level, action: 'would-alert' }
      continue
    }
    try {
      await _bot.sendMessage(_adminChatId, buildAlert(m.key, level, usage, cfg), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
      update[m.key] = level
      update[`${m.key}AlertedAt`] = new Date()
      outcome[m.key] = { level, action: 'alerted' }
      log(`[LinklyUsage] ${level.toUpperCase()} alert sent for ${m.key} (${m.value}/${m.limit})`)
    } catch (e) {
      outcome[m.key] = { level, action: 'send-failed', error: e.message }
      log(`[LinklyUsage] Failed to send ${m.key} alert: ${e.message} — will retry next check`)
    }
  }
  if (col && !dryRun) {
    await col
      .updateOne(
        { _id: 'alerts' },
        { $set: { ...update, lastUsage: usage, checkedAt: new Date() } },
        { upsert: true },
      )
      .catch(e => log(`[LinklyUsage] Could not save alert state: ${e.message}`))
  }
  return outcome
}

/**
 * Check Linkly usage and alert the admin if a threshold was crossed.
 * opts.force   — ignore the 10-min gap (scheduled/startup/dev checks)
 * opts.dryRun  — compute + report only, never send or persist
 */
async function checkLinklyUsage(opts = {}) {
  const { force = false, dryRun = false, reason = 'manual' } = opts
  if (!force && Date.now() - _lastCheckAt < MIN_GAP_MS) {
    return { skipped: 'throttled', last: _lastResult }
  }
  if (Date.now() < _backoffUntil) {
    return { skipped: 'rate-limited-backoff', retryAfter: new Date(_backoffUntil).toISOString(), last: _lastResult }
  }
  if (_inFlight) return _inFlight
  _inFlight = (async () => {
    _lastCheckAt = Date.now()
    const cfg = getConfig()
    try {
      const usage = await getLinklyUsage()
      const outcome = await _evaluate(usage, { dryRun })
      log(
        `[LinklyUsage] (${reason}) links ${usage.linksCreated}/${cfg.linkLimit}, clicks ${usage.clicks}/${cfg.clickLimit} ` +
          `(last ${WINDOW_DAYS}d; active ${usage.activeLinks}, trashed ${usage.trashedLinks}) → links:${outcome.links.action} clicks:${outcome.clicks.action}`,
      )
      _lastResult = { ok: true, reason, enabled: _enabled, usage, config: cfg, outcome, checkedAt: new Date().toISOString() }
    } catch (e) {
      const status = e && e.response && e.response.status
      if (status === 429) _backoffUntil = Date.now() + BACKOFF_429_MS
      log(
        `[LinklyUsage] (${reason}) check failed${status ? ` (HTTP ${status})` : ''}: ${e.message}` +
          (status === 429 ? ' — backing off 30 min (no alert sent)' : ''),
      )
      _lastResult = { ok: false, reason, enabled: _enabled, error: e.message, status, config: cfg, checkedAt: new Date().toISOString() }
    }
    return _lastResult
  })()
  try {
    return await _inFlight
  } finally {
    _inFlight = null
  }
}

// Called after every successful Linkly link creation (throttled, non-blocking).
function notifyLinkCreated() {
  if (!_enabled) return
  setTimeout(() => {
    checkLinklyUsage({ reason: 'after-create' }).catch(() => {})
  }, 5000)
}

function initLinklyUsageMonitor({ bot, db, adminChatId } = {}) {
  _bot = bot || null
  _db = db || null
  _adminChatId = adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID || null
  if (process.env.LINKLY_USAGE_ALERTS !== 'true') {
    log('[LinklyUsage] Alerts OFF on this bot (LINKLY_USAGE_ALERTS!=true)')
    return false
  }
  if (!process.env.LINKLY_API_KEY) {
    log('[LinklyUsage] Alerts OFF — LINKLY_API_KEY not configured')
    return false
  }
  if (!_adminChatId || !_bot) {
    log('[LinklyUsage] Alerts OFF — no TELEGRAM_ADMIN_CHAT_ID / bot')
    return false
  }
  _enabled = true
  const cfg = getConfig()
  setTimeout(() => {
    checkLinklyUsage({ force: true, reason: 'startup' }).catch(() => {})
  }, 60 * 1000)
  const t = setInterval(() => {
    checkLinklyUsage({ force: true, reason: 'scheduled' }).catch(() => {})
  }, cfg.intervalMin * 60 * 1000)
  if (t && typeof t.unref === 'function') t.unref()
  log(
    `[LinklyUsage] Initialized — every ${cfg.intervalMin}min; warn at links ≥${cfg.linkWarn}/${cfg.linkLimit}, ` +
      `clicks ≥${cfg.clickWarn}/${cfg.clickLimit} (rolling ${WINDOW_DAYS}d)`,
  )
  return true
}

module.exports = {
  initLinklyUsageMonitor,
  checkLinklyUsage,
  notifyLinkCreated,
  getLinklyUsage,
  computeUsage,
  levelFor,
  buildAlert,
  getConfig,
}
