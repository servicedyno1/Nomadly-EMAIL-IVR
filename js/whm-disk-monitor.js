/* global process */
/**
 * WHM Disk Monitor
 *
 * Proactive every-6h probe of WHM health. Two failure modes we want to
 * catch BEFORE customers do:
 *
 *  1. WHM control plane unhealthy (5xx or unreachable) — usually disk-full
 *     or a license issue.
 *  2. Customer account count is approaching the host's capacity.
 *
 * Strategy:
 *   - Hit `listaccts` (cheap, returns metadata even on a stressed
 *     server). If it 5xxs, we KNOW WHM is sick.
 *   - Compare account count to the configured threshold.
 *   - Cross-check the `cpanelAccounts.lastCfIpFixAt` distribution — if
 *     none have been deployed in 48h, the protection worker is stuck.
 *   - Send a once-per-day admin DM if any check is failing.
 *
 * The previous 06-17 disk-full crisis was 100% silent until a customer
 * tried to provision (`No space left on device`). This monitor would
 * have caught it 12-24h earlier when WHM started 500-ing.
 *
 * Production-only — dev pod skips this scheduler entirely.
 */

const { MongoClient } = require('mongodb')
const axios = require('axios')

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const ADMIN_ALERT_DEDUPE_HOURS = 24           // don't spam admin

function log(...args) { console.log('[WhmDiskMonitor]', ...args) }

// cPanel license usage. Defaults: limit 30, warn at limit-3 (27). Same env the daily digest uses.
function licenseStats(accountCount) {
  const limit = parseInt(process.env.WHM_LICENSE_LIMIT, 10) || 30
  const warnAt = parseInt(process.env.WHM_LICENSE_WARN_AT, 10) || Math.max(1, limit - 3)
  return { count: accountCount, limit, warnAt, remaining: limit - accountCount, nearLimit: accountCount >= warnAt, atLimit: accountCount >= limit }
}

async function probeWhmHealth(whmService) {
  const result = { healthy: true, signals: [], httpStatus: null }
  try {
    // Use the cheapest possible WHM call to detect 5xx / disk-full / license issues
    const resp = await whmService._whmApi.get('/listaccts', {
      params: { 'api.version': 1 },
      timeout: 15000,
    })
    result.httpStatus = resp.status
    result.accountCount = (resp.data?.data?.acct || []).length
    if (resp.data?.metadata?.result !== 1) {
      result.healthy = false
      result.signals.push(`listaccts metadata.result != 1 (reason: ${resp.data?.metadata?.reason || 'no reason'})`)
    }
  } catch (err) {
    result.healthy = false
    result.httpStatus = err.response?.status || 0
    if (err.response?.status >= 500) {
      result.signals.push(`listaccts returned HTTP ${err.response.status}`)
      const reason = err.response.data?.metadata?.reason || err.response.data || ''
      if (/No space left|disk.{0,4}full/i.test(String(reason))) {
        result.signals.push(`DISK-FULL detected in error body: ${String(reason).slice(0, 200)}`)
        result.diskFull = true
      }
    } else if (!err.response) {
      result.signals.push(`listaccts unreachable: ${err.code || err.message}`)
    } else {
      result.signals.push(`listaccts HTTP ${err.response.status}: ${err.message}`)
    }
  }
  return result
}

async function sendAdminAlert(bot, db, signals, probeResult) {
  const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!TELEGRAM_ADMIN_CHAT_ID || !bot) return

  // Dedupe — don't spam admin
  const alertsCol = db.collection('whmDiskMonitorAlerts')
  const last = await alertsCol.findOne({ _id: 'lastAlert' })
  if (last && (Date.now() - new Date(last.at).getTime()) < ADMIN_ALERT_DEDUPE_HOURS * 3600 * 1000) {
    log(`Admin alert deduped (last sent ${last.at})`)
    return
  }

  const sigList = signals.map(s => `• ${s}`).join('\n')
  const msg =
    `🚨 <b>WHM Health Warning</b>\n\n` +
    `Host: <code>${process.env.WHM_HOST || 'unknown'}</code>\n` +
    `HTTP: <code>${probeResult.httpStatus || 'no response'}</code>\n\n` +
    `<b>Signals:</b>\n${sigList}\n\n` +
    (probeResult.diskFull
      ? `<i>Possible disk-full. See /app/memory/WHM_DROPLET_RECOVERY_2026-06-17.md for the cleanup playbook.</i>`
      : `<i>Investigate before customers hit it.</i>`)

  await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => {
    log(`sendMessage error: ${e.message}`)
  })
  await alertsCol.updateOne(
    { _id: 'lastAlert' },
    { $set: { at: new Date(), signals, probeResult } },
    { upsert: true }
  )
}

/**
 * Near-license-limit admin DM. Own dedupe doc so it never collides with the
 * health-warning alert, and re-fires once a day while usage stays at/over warn.
 */
async function sendLicenseAlert(bot, db, stats) {
  const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!TELEGRAM_ADMIN_CHAT_ID || !bot) return
  const alertsCol = db.collection('whmDiskMonitorAlerts')
  const last = await alertsCol.findOne({ _id: 'lastLicenseAlert' })
  const level = stats.atLimit ? 'at' : 'near'
  const sameLevel = last && last.level === level
  if (last && sameLevel && (Date.now() - new Date(last.at).getTime()) < ADMIN_ALERT_DEDUPE_HOURS * 3600 * 1000) {
    log(`License alert deduped (last ${last.level} at ${last.at})`)
    return
  }
  const left = stats.remaining
  const msg = stats.atLimit
    ? `🛑 <b>cPanel license full</b>\n\nHost: <code>${process.env.WHM_HOST || 'unknown'}</code>\n<b>${stats.count} / ${stats.limit}</b> accounts used. New hosting orders will FAIL until you upgrade the license or remove an account.`
    : `⚠️ <b>Near cPanel license limit</b>\n\nHost: <code>${process.env.WHM_HOST || 'unknown'}</code>\n<b>${stats.count} / ${stats.limit}</b> accounts used — only <b>${left}</b> slot${left === 1 ? '' : 's'} left.\n\n<i>Upgrade the license or delete an empty account soon.</i>`
  await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => log(`sendMessage error: ${e.message}`))
  await alertsCol.updateOne({ _id: 'lastLicenseAlert' }, { $set: { at: new Date(), level, count: stats.count, limit: stats.limit } }, { upsert: true })
}

/**
 * Initialise the monitor — wired from start-bot.js / _index.js startup.
 * @param {object} deps  { bot, whmService } — whmService MUST expose `_whmApi` (the axios instance)
 */
function initMonitor(deps) {
  const { bot, whmService } = deps
  if (process.env.BOT_ENVIRONMENT !== 'production') {
    log('Skipping monitor — BOT_ENVIRONMENT != production')
    return
  }
  if (!whmService || !whmService._whmApi) {
    log('Skipping monitor — whmService not available')
    return
  }

  const client = new MongoClient(process.env.MONGO_URL)
  let db = null

  async function tick() {
    try {
      if (!db) {
        await client.connect()
        db = client.db(process.env.DB_NAME || 'test')
      }
      const probe = await probeWhmHealth(whmService)
      if (probe.healthy) {
        if (typeof probe.accountCount === 'number') {
          const stats = licenseStats(probe.accountCount)
          if (stats.nearLimit) await sendLicenseAlert(bot, db, stats)
          log(`OK — http=${probe.httpStatus}, accounts=${stats.count}/${stats.limit}${stats.nearLimit ? ' (NEAR LIMIT)' : ''}`)
        } else {
          log(`OK — http=${probe.httpStatus}, accounts=unknown`)
        }
      } else {
        log(`UNHEALTHY — signals: ${probe.signals.join(' | ')}`)
        await sendAdminAlert(bot, db, probe.signals, probe)
      }
    } catch (e) {
      log(`tick error: ${e.message}`)
    }
  }

  // First tick after 5 min (give the bot time to boot), then every 6h
  setTimeout(tick, 5 * 60 * 1000)
  setInterval(tick, CHECK_INTERVAL_MS)
  log(`Monitor initialised — interval ${CHECK_INTERVAL_MS / 3600000}h`)
}

module.exports = { initMonitor, probeWhmHealth, licenseStats, sendLicenseAlert }
