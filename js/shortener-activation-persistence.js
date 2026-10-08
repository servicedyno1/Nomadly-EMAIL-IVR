/**
 * Shortener Activation Persistence — Survives deployments
 *
 * Tracks the multi-step shortener activation process so it can
 * resume from the last completed step after a deployment restart.
 *
 * Steps: pending → host_linked → dns_added → completed
 *   (legacy records may still carry status 'railway_linked' — treated as host_linked)
 */
const { log } = require('console')

const COLLECTION = 'shortenerActivations'
let _db = null

function initShortenerPersistence(db) {
  _db = db
  log('[ShortenerPersistence] Initialized')
}

/**
 * Create a new activation task (step 1 — before Railway linking)
 */
async function createActivationTask(chatId, domain, lang) {
  if (!_db) return null
  const task = {
    _id: domain,
    chatId: String(chatId),
    domain,
    status: 'pending',
    server: null,
    recordType: null,
    lang: lang || 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: task },
    { upsert: true }
  )
  log(`[ShortenerPersistence] Task created for ${domain} (chatId: ${chatId})`)
  return domain
}

/**
 * Mark host (shortener origin) linking complete (step 2 — DNS target obtained).
 * Formerly markRailwayLinked; now writes status 'host_linked'. An alias is kept.
 */
async function markHostLinked(domain, server, recordType) {
  if (!_db) return
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'host_linked', server, recordType, updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] ${domain} → host_linked (${recordType} → ${server})`)
}
// Back-compat alias for any older/external callers.
const markRailwayLinked = markHostLinked

/**
 * Mark DNS record added (step 3)
 */
async function markDnsAdded(domain) {
  if (!_db) return
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'dns_added', updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] ${domain} → dns_added`)
}

/**
 * Mark activation fully completed (step 4 — user notified)
 */
async function markCompleted(domain) {
  if (!_db) return
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'completed', completedAt: new Date(), updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] ${domain} → completed`)
}

/**
 * Mark activation failed
 */
async function markFailed(domain, error) {
  if (!_db) return
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'failed', error, updatedAt: new Date() } }
  )
}

/**
 * Mark activation skipped — use when the domain purchase succeeded but the
 * user-opted shortener setup couldn't complete (e.g., DNS provider error).
 * The user retains full manual DNS control via the bot menu. This status is
 * intentionally NOT picked up by findIncompleteTasks() — no auto-retry.
 */
async function markSkipped(domain, reason) {
  if (!_db) return
  await _db.collection(COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'skipped', reason, updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] ${domain} → skipped (${reason})`)
}

/**
 * Find all incomplete activation tasks
 * Returns tasks that are pending, host_linked (or legacy railway_linked), or dns_added
 */
async function findIncompleteTasks() {
  if (!_db) return []
  return _db.collection(COLLECTION).find({
    status: { $in: ['pending', 'host_linked', 'railway_linked', 'dns_added'] }
  }).toArray()
}

// ─────────────────────────────────────────────────────────────────────────────
// Deactivation queue — separate collection so it doesn't collide with the
// activation lifecycle above. Used by the reconciler tick to retry shortener
// deactivations that hit a transient upstream failure (e.g. provider 5xx)
// during the user-driven Deactivate flow.
// ─────────────────────────────────────────────────────────────────────────────
const DEACTIVATION_COLLECTION = 'shortenerDeactivations'
const MAX_DEACTIVATION_RETRIES = 5

async function enqueueDeactivation(domain, chatId, lang) {
  if (!_db) return
  await _db.collection(DEACTIVATION_COLLECTION).updateOne(
    { _id: domain },
    {
      $set: {
        _id: domain,
        chatId: String(chatId),
        domain,
        lang: lang || 'en',
        status: 'pending_deactivation',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date(), retryCount: 0 },
    },
    { upsert: true }
  )
  log(`[ShortenerPersistence] Deactivation queued for ${domain} (chatId: ${chatId})`)
}

async function incrementDeactivationRetry(domain, lastError) {
  if (!_db) return null
  const res = await _db.collection(DEACTIVATION_COLLECTION).findOneAndUpdate(
    { _id: domain },
    { $inc: { retryCount: 1 }, $set: { lastError: lastError || null, updatedAt: new Date() } },
    { returnDocument: 'after' }
  )
  return res?.value || null
}

async function markDeactivationDone(domain) {
  if (!_db) return
  await _db.collection(DEACTIVATION_COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'done', completedAt: new Date(), updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] Deactivation done for ${domain}`)
}

async function markDeactivationFailed(domain, error) {
  if (!_db) return
  await _db.collection(DEACTIVATION_COLLECTION).updateOne(
    { _id: domain },
    { $set: { status: 'failed', lastError: error || null, updatedAt: new Date() } }
  )
  log(`[ShortenerPersistence] Deactivation FAILED (retries exhausted) for ${domain}: ${error}`)
}

async function findPendingDeactivations() {
  if (!_db) return []
  return _db.collection(DEACTIVATION_COLLECTION)
    .find({ status: 'pending_deactivation', retryCount: { $lt: MAX_DEACTIVATION_RETRIES } })
    .toArray()
}

module.exports = {
  initShortenerPersistence,
  createActivationTask,
  markHostLinked,
  markRailwayLinked, // deprecated alias → markHostLinked
  markDnsAdded,
  markCompleted,
  markFailed,
  markSkipped,
  findIncompleteTasks,
  // Deactivation queue
  enqueueDeactivation,
  incrementDeactivationRetry,
  markDeactivationDone,
  markDeactivationFailed,
  findPendingDeactivations,
  MAX_DEACTIVATION_RETRIES,
}
