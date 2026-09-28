/**
 * Daily cron wrapper around /app/scripts/heal_bifurcated_domains.js.
 *
 * The heal script detects four divergence patterns across
 * `domainsOf` ⇄ `registeredDomains` ⇄ Cloudflare ⇄ OpenProvider/CR and
 * fixes the two safe ones (Category A — DB diverged, Category B —
 * registrar NS lagging) automatically. The previous fork ran it manually
 * once (74 domains repaired) — this cron makes the heal recurring so
 * future divergences self-resolve overnight without operator action.
 *
 * Schedule: daily at 03:30 UTC (low-traffic window, off-peak for
 * Telegram message volume, after domain-sync's hourly cycle has
 * already converged).
 *
 * Failure handling: any thrown error is logged + Telegrammed to the
 * admin chat with the truncated stack. The cron does NOT crash the
 * bot process.
 *
 * Bootstrap delay: 90s after init() to give the bot, MongoDB pool,
 * OpenProvider auth cache, and Cloudflare service time to settle.
 */
const schedule = require('node-schedule')
// Portable require: resolve relative to this file (../scripts) so it works both on the
// Emergent pod (/app) and on the droplet blue/green release (/opt/nomadly/releases/...).
const heal = require('../scripts/heal_bifurcated_domains')

const BOOT_DELAY_MS = 90 * 1000 // 90s — let auth tokens warm up
const CRON_DAILY_0330_UTC = '30 3 * * *'

let initialised = false

/**
 * Wire up the cron job.
 * Called once from /app/js/_index.js after `bot` and `db` are ready.
 *
 * @param {Object} bot   — Telegram bot instance (only used for admin DM on failure)
 * @param {Object} db    — already-open Mongo `Db` to reuse the bot's connection
 * @param {Object} [opts]
 * @param {string} [opts.adminChatId]   — overrides TELEGRAM_ADMIN_CHAT_ID env
 * @param {string} [opts.applyMode]     — 'A,B' (default) | 'A' | 'all' | null (dry-run)
 */
function init({ bot, db, adminChatId, applyMode }) {
  if (initialised) {
    console.log('[BifurcationHealCron] already initialised — skipping double-init')
    return
  }
  initialised = true

  const apply = applyMode || 'A,B,D'
  const admin = adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID

  setTimeout(() => {
    schedule.scheduleJob(CRON_DAILY_0330_UTC, () => runOnce({ bot, db, admin, apply }))
    console.log(`[BifurcationHealCron] Scheduled — daily at 03:30 UTC (apply=${apply})`)
  }, BOOT_DELAY_MS)
}

async function runOnce({ bot, db, admin, apply }) {
  const startedAt = new Date().toISOString()
  console.log(`[BifurcationHealCron] Tick start ${startedAt} (apply=${apply})`)
  try {
    const result = await heal.runHealSweep({ db, apply })
    const { summary } = result
    const summaryLine = `OK=${summary.OK || 0}, A-healed=${summary.A || 0}, B-healed=${summary.B || 0}, C-flagged=${summary.C || 0}, D-healed=${summary.D || 0}, ERR=${summary.ERROR || 0}`
    console.log(`[BifurcationHealCron] Tick done — ${summaryLine}`)

    // Admin alert only when something interesting happened
    const hasFindings = (summary.A || 0) > 0 || (summary.B || 0) > 0 || (summary.C || 0) > 0 || (summary.D || 0) > 0 || (summary.ERROR || 0) > 0
    if (hasFindings && bot && admin) {
      const lines = [
        `🩹 <b>Bifurcation heal — daily sweep</b>`,
        `<i>${startedAt}</i>`,
        ``,
        `OK: ${summary.OK || 0}`,
        `A (DB diverged, auto-healed): ${summary.A || 0}`,
        `B (registrar NS lagging, auto-healed): ${summary.B || 0}`,
        `C (orphan CF zone, flagged for review): ${summary.C || 0}`,
        `D (.de DENIC Nsentry stuck, auto-healed): ${summary.D || 0}`,
        `Errors: ${summary.ERROR || 0}`,
      ]
      if ((summary.C || 0) > 0) {
        const cExamples = (result.results || []).filter(r => r.category === 'C').slice(0, 5).map(r => `• ${r.domain}`)
        if (cExamples.length) lines.push('', '<b>Sample C orphans:</b>', ...cExamples)
      }
      try {
        await bot.sendMessage(String(admin), lines.join('\n'), { parse_mode: 'HTML' })
      } catch (sendErr) {
        console.log(`[BifurcationHealCron] admin DM failed: ${sendErr.message}`)
      }
    }
  } catch (e) {
    console.error('[BifurcationHealCron] Tick FAILED:', e.message, e.stack)
    if (bot && admin) {
      try {
        await bot.sendMessage(String(admin), `⚠️ Bifurcation heal cron FAILED at ${startedAt}\n<code>${(e.stack || e.message).slice(0, 1500)}</code>`, { parse_mode: 'HTML' })
      } catch {/* ignore */}
    }
  }
}

module.exports = { init, runOnce }
