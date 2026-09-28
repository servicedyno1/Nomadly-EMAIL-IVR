/**
 * Shortener Reconciler
 * ────────────────────
 * Periodically heals inconsistent shortener state by:
 *
 *  1. Draining the `shortenerDeactivations` queue (pending_deactivation) — for
 *     each task that was deferred due to a transient upstream failure during
 *     user-driven Deactivate, retry the upstream removal, then complete the
 *     DNS cleanup that the original handler had to skip. Notify the user once
 *     deactivation finishes (or once retries are exhausted).
 *
 *  2. Detecting orphan state: a "completed" activation whose Cloudflare CNAME
 *     has gone missing while the upstream still claims the domain. This is
 *     the exact bug fingerprint that nymcub.com hit. We resolve it by fully
 *     removing the domain from upstream so the user is in a clean inactive
 *     state and can re-activate cleanly.
 *
 * The module exposes:
 *   • initShortenerReconciler(deps) — wires the scheduler at boot
 *   • repairDomain(domain, deps)     — single-shot repair (admin command)
 */
const { log } = require('console')
const { isShortenerDnsRecord } = require('./rl-save-domain-in-server.js')

const TICK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const ACTIVATION_COLLECTION = 'shortenerActivations'

/**
 * Retry queued deactivations.
 * @returns {Promise<{processed:number, completed:number, retried:number, failed:number}>}
 */
async function processPendingDeactivations(deps) {
  const { db, removeDomainFromRailway, domainService, notifyUser, persistence } = deps
  const pending = await persistence.findPendingDeactivations()
  const stats = { processed: 0, completed: 0, retried: 0, failed: 0 }

  for (const task of pending) {
    stats.processed++
    const { domain, chatId, retryCount } = task
    try {
      const removeResult = await removeDomainFromRailway(domain)

      if (removeResult?.error && removeResult?.transient) {
        const updated = await persistence.incrementDeactivationRetry(domain, removeResult.error)
        const newCount = updated?.retryCount ?? (retryCount + 1)
        if (newCount >= persistence.MAX_DEACTIVATION_RETRIES) {
          await persistence.markDeactivationFailed(domain, `transient retries exhausted: ${removeResult.error}`)
          stats.failed++
          if (notifyUser) {
            await notifyUser(chatId,
              `⚠️ We weren't able to deactivate the shortener for <b>${domain}</b> automatically after several attempts. Please try Deactivate again from the bot, or contact support if it keeps failing.`)
          }
        } else {
          stats.retried++
          log(`[ShortenerReconciler] ${domain}: transient retry ${newCount}/${persistence.MAX_DEACTIVATION_RETRIES} — ${removeResult.error}`)
        }
        continue
      }

      if (removeResult?.error) {
        // Hard error from upstream — don't keep hammering it
        await persistence.markDeactivationFailed(domain, removeResult.error)
        stats.failed++
        log(`[ShortenerReconciler] ${domain}: hard upstream error — ${removeResult.error}`)
        if (notifyUser) {
          await notifyUser(chatId,
            `⚠️ The shortener for <b>${domain}</b> couldn't be deactivated automatically. Please open the bot, choose the domain and tap Deactivate again, or contact support.`)
        }
        continue
      }

      // Upstream success → finish the DNS cleanup the original handler skipped
      try {
        const dnsResult = await domainService.viewDNSRecords(domain, db)
        const records = dnsResult?.records || []
        const stale = records.find(r =>
          isShortenerDnsRecord(r)
        )
        if (stale) {
          const delResult = await domainService.deleteDNSRecord(domain, stale, db)
          if (delResult?.error) {
            log(`[ShortenerReconciler] ${domain}: DNS cleanup warning — ${delResult.error}`)
          }
        }
      } catch (e) {
        log(`[ShortenerReconciler] ${domain}: DNS cleanup exception — ${e.message}`)
      }

      await persistence.markDeactivationDone(domain)
      stats.completed++
      log(`[ShortenerReconciler] ${domain}: deactivation completed via retry`)
      if (notifyUser) {
        await notifyUser(chatId,
          `✅ Shortener for <b>${domain}</b> has been deactivated.`)
      }
    } catch (err) {
      log(`[ShortenerReconciler] ${domain}: unexpected error — ${err.message}`)
    }
  }

  return stats
}

/**
 * Check a single completed activation for the "half-deactivated" orphan state:
 *   • upstream still has the custom domain claimed
 *   • but the Cloudflare CNAME at apex is gone
 * If detected, fully remove the upstream claim and mark the activation as
 * needing reactivation so the user can start over cleanly.
 *
 * Returns one of: 'healthy' | 'healed' | 'unknown' | 'error'
 */
async function checkAndHealActivation(domain, deps) {
  const { db, removeDomainFromRailway, domainService, listRailwayDomains, persistence, notifyUser } = deps
  try {
    // 1. Is the domain still claimed upstream?
    const upstreamDomains = await listRailwayDomains()
    const claimedUpstream = upstreamDomains.includes(domain)
    if (!claimedUpstream) return 'healthy' // nothing to heal

    // 2. Does CF have a CNAME at apex pointing to the shortener service?
    const dnsResult = await domainService.viewDNSRecords(domain, db)
    if (!dnsResult || dnsResult.error) return 'unknown'
    const records = dnsResult.records || []
    const hasShortenerCNAME = records.some(r =>
      isShortenerDnsRecord(r)
    )
    if (hasShortenerCNAME) return 'healthy' // both sides agree

    // 3. Orphan detected: upstream claims domain but CF has no CNAME.
    log(`[ShortenerReconciler] ORPHAN detected for ${domain} — upstream claims but CF CNAME missing. Healing by removing upstream claim.`)
    const removeResult = await removeDomainFromRailway(domain)
    if (removeResult?.error) {
      // Don't escalate transient — the next tick will retry naturally
      log(`[ShortenerReconciler] Heal failed for ${domain} (transient=${!!removeResult.transient}): ${removeResult.error}`)
      return 'error'
    }

    // 4. Mark the activation record as needs_reactivation so we don't
    //    keep poking it on subsequent ticks, and so support has audit trail.
    if (db?.collection) {
      await db.collection(ACTIVATION_COLLECTION).updateOne(
        { _id: domain },
        { $set: { status: 'needs_reactivation', healedAt: new Date(), updatedAt: new Date() } }
      )
    }

    // 5. Notify the user once
    if (notifyUser) {
      const task = db?.collection ? await db.collection(ACTIVATION_COLLECTION).findOne({ _id: domain }) : null
      const chatId = task?.chatId
      if (chatId) {
        await notifyUser(chatId,
          `ℹ️ The shortener for <b>${domain}</b> was in an inconsistent state and has been fully reset. To use it again, open the bot → DNS Management → tap <b>Activate URL Shortener</b>.`)
      }
    }
    return 'healed'
  } catch (err) {
    log(`[ShortenerReconciler] checkAndHealActivation ${domain} error: ${err.message}`)
    return 'error'
  }
}

/**
 * Sweep all completed activations once and heal orphans.
 * Capped per tick to avoid hammering upstream APIs.
 */
async function processOrphanActivations(deps, { maxPerTick = 20 } = {}) {
  const { db } = deps
  if (!db?.collection) return { processed: 0, healed: 0 }
  const cursor = db.collection(ACTIVATION_COLLECTION)
    .find({ status: 'completed' })
    .sort({ updatedAt: 1 }) // oldest first — they're most likely stale
    .limit(maxPerTick)
  const stats = { processed: 0, healed: 0, healthy: 0, errors: 0 }
  for await (const task of cursor) {
    stats.processed++
    const verdict = await checkAndHealActivation(task.domain, deps)
    if (verdict === 'healed') stats.healed++
    else if (verdict === 'healthy') stats.healthy++
    else if (verdict === 'error') stats.errors++
  }
  return stats
}

/**
 * Admin/single-shot: run the full repair for one domain.
 * Returns a status string for the admin reply.
 */
async function repairDomain(domain, deps) {
  const { db, removeDomainFromRailway, domainService, listRailwayDomains } = deps
  const lines = [`<b>Repair report for ${domain}</b>\n`]

  // 1. Drain deactivation queue entry if any
  try {
    const deact = await db?.collection?.('shortenerDeactivations').findOne({ _id: domain })
    if (deact && deact.status === 'pending_deactivation') {
      const removeResult = await removeDomainFromRailway(domain)
      if (removeResult?.error) {
        lines.push(`• Queued deactivation: upstream still failing (${removeResult.error.slice(0, 80)})`)
      } else {
        // finish DNS cleanup
        const dnsResult = await domainService.viewDNSRecords(domain, db)
        const stale = (dnsResult?.records || []).find(r =>
          isShortenerDnsRecord(r)
        )
        if (stale) await domainService.deleteDNSRecord(domain, stale, db)
        await db.collection('shortenerDeactivations').updateOne(
          { _id: domain },
          { $set: { status: 'done', completedAt: new Date(), updatedAt: new Date() } }
        )
        lines.push(`• Drained pending deactivation → upstream cleared + CF CNAME removed`)
      }
    } else {
      lines.push(`• No pending deactivation`)
    }
  } catch (e) {
    lines.push(`• Deactivation queue check error: ${e.message}`)
  }

  // 2. Orphan check + heal
  const verdict = await checkAndHealActivation(domain, deps)
  lines.push(`• Orphan check: ${verdict}`)

  // 3. Final state snapshot
  try {
    const upstream = await listRailwayDomains()
    lines.push(`• Upstream claim now: ${upstream.includes(domain) ? 'YES' : 'no'}`)
    const dnsResult = await domainService.viewDNSRecords(domain, db)
    const cname = (dnsResult?.records || []).find(r =>
      isShortenerDnsRecord(r)
    )
    lines.push(`• Shortener CNAME at apex: ${cname ? cname.recordContent : 'absent'}`)
  } catch (e) {
    lines.push(`• Final state check error: ${e.message}`)
  }

  return lines.join('\n')
}

let _timer = null

function initShortenerReconciler(deps) {
  if (_timer) return // idempotent
  if (!deps?.db || !deps?.removeDomainFromRailway || !deps?.domainService || !deps?.listRailwayDomains) {
    log('[ShortenerReconciler] init skipped — missing dependencies')
    return
  }
  const tick = async () => {
    try {
      const a = await processPendingDeactivations(deps)
      const b = await processOrphanActivations(deps)
      if (a.processed > 0 || b.healed > 0 || b.errors > 0) {
        log(`[ShortenerReconciler] tick: deact[processed=${a.processed} done=${a.completed} retried=${a.retried} failed=${a.failed}] orphan[checked=${b.processed} healed=${b.healed} healthy=${b.healthy} errors=${b.errors}]`)
      }
    } catch (e) {
      log(`[ShortenerReconciler] tick error: ${e.message}`)
    }
  }
  // First run ~30s after boot (let other services warm up), then every TICK_INTERVAL_MS
  setTimeout(() => { tick(); _timer = setInterval(tick, TICK_INTERVAL_MS) }, 30 * 1000)
  log(`[ShortenerReconciler] Scheduled every ${TICK_INTERVAL_MS / 60000}min`)
}

module.exports = {
  initShortenerReconciler,
  repairDomain,
  // exported for unit tests
  processPendingDeactivations,
  processOrphanActivations,
  checkAndHealActivation,
}
