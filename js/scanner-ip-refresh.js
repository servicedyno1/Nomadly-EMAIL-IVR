/**
 * Scanner IP Auto-Refresh Service
 *
 * Problem: SCANNER_IP_RANGES in anti-red-service.js is static. Scanner
 * networks (Censys, Shodan, GreyNoise, etc.) regularly rotate/add IPs.
 * New scanner IPs slip through unblocked.
 *
 * Solution: Periodically fetch from known public scanner-IP feeds, merge
 * with the hardcoded base list, persist to MongoDB, and re-deploy the CF
 * Worker with the combined list.
 *
 * Flow:
 *   1. On boot: loadDynamicIPs() reads cached IPs from MongoDB
 *   2. Daily: refreshScannerIPs() fetches public feeds → merges → stores → redeploys Worker
 *   3. generateHardenedWorkerScript() in anti-red-service.js calls getDynamicIPs()
 *      to get the current combined list at worker-generation time.
 *
 * The base list (hardcoded) is never removed — dynamic IPs are additive.
 */

require('dotenv').config()
const axios = require('axios')
const { log } = require('console')

let db = null
let dynamicIPs = []  // In-memory cache — populated from Mongo on boot + after refresh
let refreshTimer = null

const COLLECTION_NAME = 'scannerIPFeeds'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Public Scanner IP Feed Sources ──────────────────────
// Each source returns { ips: string[], source: string, fetchedAt: Date }
// Sources are best-effort: a failure on one doesn't block others.

const FEED_SOURCES = [
  {
    name: 'censys',
    url: 'https://support.censys.io/hc/en-us/articles/360043177092',
    // Censys publishes ranges on their support page. We extract CIDR patterns.
    parse: (body) => extractCIDRs(body),
  },
  {
    name: 'binaryedge',
    // BinaryEdge publishes their scanner IPs
    url: 'https://api.binaryedge.io/v1/minions',
    parse: (body) => {
      try {
        const data = typeof body === 'string' ? JSON.parse(body) : body
        if (Array.isArray(data)) return data.filter(ip => isValidCIDR(ip))
        if (data.scanners) return data.scanners.filter(ip => isValidCIDR(ip))
      } catch { /* */ }
      return extractCIDRs(typeof body === 'string' ? body : JSON.stringify(body))
    },
  },
  {
    name: 'shodan_known',
    // Shodan's known scanner ranges (updated list — not an API, manually curated)
    url: null, // No public API — we maintain a curated extension list
    parse: () => [
      // Shodan ranges not in the base list (newly observed)
      '185.163.109.0/24', // Shodan new range 2025+
      '198.20.71.0/24',   // Shodan additional
      '93.120.27.0/24',   // Shodan EU
    ],
  },
  {
    name: 'stretchoid',
    url: null,
    parse: () => [
      // Stretchoid scanner network
      '198.235.24.0/24',
      '192.35.168.0/24',
    ],
  },
  {
    name: 'internet_measurement',
    url: null,
    parse: () => [
      // Internet Measurement / research networks
      '185.180.143.0/24',  // Shadowserver
      '74.120.14.0/24',    // Project Sonar
      '141.212.121.0/24',  // University of Michigan (ZMap)
      '141.212.122.0/24',
    ],
  },
]

// ─── Helpers ─────────────────────────────────────────────

function isValidCIDR(str) {
  if (!str || typeof str !== 'string') return false
  const s = str.trim()
  // Single IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return true
  // CIDR
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(s)) {
    const bits = parseInt(s.split('/')[1])
    return bits >= 8 && bits <= 32
  }
  return false
}

function extractCIDRs(text) {
  if (!text) return []
  // Match IPv4 addresses and CIDR ranges from arbitrary text
  const matches = text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/g) || []
  return [...new Set(matches.filter(isValidCIDR))]
}

function dedupeIPs(ips) {
  return [...new Set(ips.map(ip => ip.trim()).filter(Boolean))]
}

// ─── Core Functions ──────────────────────────────────────

function init(mongoDb) {
  db = mongoDb
  log('[ScannerIPRefresh] Initialized')
}

/**
 * Load cached dynamic IPs from MongoDB into memory.
 * Called on boot — makes getDynamicIPs() work immediately without
 * waiting for the first daily refresh.
 */
async function loadDynamicIPs() {
  if (!db) return
  try {
    const doc = await db.collection(COLLECTION_NAME).findOne({ _id: 'combined' })
    if (doc && Array.isArray(doc.ips)) {
      dynamicIPs = doc.ips
      log(`[ScannerIPRefresh] Loaded ${dynamicIPs.length} dynamic scanner IPs from cache (last refresh: ${doc.refreshedAt || 'unknown'})`)
    }
  } catch (err) {
    log(`[ScannerIPRefresh] Cache load warning: ${err.message}`)
  }
}

/**
 * Fetch scanner IPs from all configured public feeds.
 * Merges results, deduplicates, persists to MongoDB, and optionally
 * triggers a CF Worker redeploy.
 *
 * @param {Object} opts
 * @param {boolean} [opts.redeploy=true]  Redeploy the shared Worker after refresh
 * @returns {{ total: number, bySource: Object, errors: string[] }}
 */
async function refreshScannerIPs(opts = {}) {
  const { redeploy = true } = opts
  const results = { total: 0, bySource: {}, errors: [], newIPs: [] }
  const allIPs = []

  for (const source of FEED_SOURCES) {
    try {
      let body = null
      if (source.url) {
        const res = await axios.get(source.url, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NomadlyBot/1.0)' },
          // Accept text or JSON
          transformResponse: [(data) => data],
        })
        body = res.data
      }

      const ips = source.parse(body)
      if (Array.isArray(ips) && ips.length > 0) {
        results.bySource[source.name] = ips.length
        allIPs.push(...ips)
        log(`[ScannerIPRefresh] ${source.name}: ${ips.length} IPs`)
      } else {
        results.bySource[source.name] = 0
      }
    } catch (err) {
      const msg = `${source.name}: ${err.message}`
      results.errors.push(msg)
      log(`[ScannerIPRefresh] Feed error — ${msg}`)
    }
  }

  // Also load any admin-added overrides from MongoDB
  if (db) {
    try {
      const overrides = await db.collection(COLLECTION_NAME).findOne({ _id: 'admin_overrides' })
      if (overrides && Array.isArray(overrides.ips)) {
        allIPs.push(...overrides.ips)
        results.bySource['admin_overrides'] = overrides.ips.length
      }
    } catch { /* */ }
  }

  const combined = dedupeIPs(allIPs)
  results.total = combined.length

  // Detect new IPs (not in previous cache)
  const prevSet = new Set(dynamicIPs)
  results.newIPs = combined.filter(ip => !prevSet.has(ip))

  // Update in-memory cache
  dynamicIPs = combined

  // Persist to MongoDB
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).updateOne(
        { _id: 'combined' },
        { $set: { ips: combined, refreshedAt: new Date(), bySource: results.bySource, errors: results.errors } },
        { upsert: true }
      )
    } catch (err) {
      log(`[ScannerIPRefresh] Persist error: ${err.message}`)
    }
  }

  log(`[ScannerIPRefresh] Refresh complete: ${combined.length} dynamic IPs (${results.newIPs.length} new)`)

  // Redeploy the CF Worker with updated IP list
  if (redeploy && results.newIPs.length > 0) {
    try {
      const antiRed = require('./anti-red-service')
      const upResult = await antiRed.upgradeSharedWorker()
      log(`[ScannerIPRefresh] Worker redeployed after IP refresh: ${upResult.success ? 'OK' : 'FAIL'}`)
    } catch (err) {
      log(`[ScannerIPRefresh] Worker redeploy error: ${err.message}`)
    }
  }

  return results
}

/**
 * Returns the current dynamic IP list (for merging with the hardcoded base).
 * Called by generateHardenedWorkerScript() in anti-red-service.js.
 */
function getDynamicIPs() {
  return dynamicIPs
}

/**
 * Admin API: add IPs manually (persisted, included in next refresh merge).
 * @param {string[]} ips  Array of IP/CIDR strings
 * @param {string} reason  Why these were added
 */
async function addAdminOverrides(ips, reason = '') {
  if (!db) return { success: false, error: 'No database' }
  const valid = ips.filter(isValidCIDR)
  if (valid.length === 0) return { success: false, error: 'No valid IPs provided' }

  try {
    await db.collection(COLLECTION_NAME).updateOne(
      { _id: 'admin_overrides' },
      {
        $addToSet: { ips: { $each: valid } },
        $set: { updatedAt: new Date(), lastReason: reason },
      },
      { upsert: true }
    )
    // Also add to in-memory cache immediately
    const newOnes = valid.filter(ip => !dynamicIPs.includes(ip))
    dynamicIPs.push(...newOnes)
    log(`[ScannerIPRefresh] Admin added ${valid.length} IPs (${newOnes.length} new): ${reason}`)
    return { success: true, added: valid.length, new: newOnes.length }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ─── Scheduler ───────────────────────────────────────────

function startRefreshScheduler() {
  if (process.env.SKIP_WEBHOOK_SYNC === 'true') {
    log('[ScannerIPRefresh] SKIP_WEBHOOK_SYNC=true — refresh DISABLED (dev sandbox)')
    return
  }
  if (refreshTimer) clearInterval(refreshTimer)

  // Load cached IPs immediately
  loadDynamicIPs().catch(e => log(`[ScannerIPRefresh] Load error: ${e.message}`))

  // First refresh after 5 minutes (let services boot)
  setTimeout(() => {
    refreshScannerIPs().catch(e => log(`[ScannerIPRefresh] Refresh error: ${e.message}`))
  }, 5 * 60 * 1000)

  // Then daily
  refreshTimer = setInterval(() => {
    refreshScannerIPs().catch(e => log(`[ScannerIPRefresh] Refresh error: ${e.message}`))
  }, REFRESH_INTERVAL_MS)

  log(`[ScannerIPRefresh] Scheduler started — refreshes every ${REFRESH_INTERVAL_MS / 3600000}h`)
}

function stopRefreshScheduler() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
    log('[ScannerIPRefresh] Scheduler stopped')
  }
}

module.exports = {
  init,
  loadDynamicIPs,
  refreshScannerIPs,
  getDynamicIPs,
  addAdminOverrides,
  startRefreshScheduler,
  stopRefreshScheduler,
  // Exported for testing
  isValidCIDR,
  extractCIDRs,
  dedupeIPs,
  FEED_SOURCES,
}
