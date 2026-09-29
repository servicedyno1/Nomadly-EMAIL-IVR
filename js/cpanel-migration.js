/* global process */
/**
 * cPanel Account Migration Service
 *
 * Automatically migrates cPanel accounts to the current WHM server on startup.
 * When WHM_HOST changes (server migration), this module:
 *   1. Detects accounts pointing to old servers (whmHost !== current WHM_HOST)
 *   2. Checks which of those accounts exist on the new WHM server
 *   3. Syncs their stored password to the new server via WHM API
 *   4. Updates whmHost in MongoDB
 *
 * This ensures users can always log in after a server migration with zero manual work.
 */

const axios = require('axios')
const https = require('https')
const crypto = require('crypto')
const { log } = require('console')

const httpsAgent = new https.Agent({ rejectUnauthorized: false })

function getEncryptionKey() {
  if (!process.env.SESSION_SECRET) {
    console.error('⚠️ CRITICAL: SESSION_SECRET not set — cPanel migration decryption will fail!')
  }
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')).digest()
}

function decrypt(data) {
  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'))
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Run migration check on startup.
 * @param {Function} getCpanelCol - returns the cpanelAccounts MongoDB collection
 */
async function runMigration(getCpanelCol) {
  const WHM_HOST = process.env.WHM_HOST
  const WHM_TOKEN = process.env.WHM_TOKEN
  const WHM_USERNAME = process.env.WHM_USERNAME || 'root'
  // Route through the Cloudflare Tunnel (WHM_API_URL) when set — the WHM box
  // firewalls port 2087, so a direct https://WHM_HOST:2087 connection just
  // times out (30s) and aborts migration. Mirror whm-service.js. (2026-09 issue 5)
  const WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')

  if (!WHM_HOST || !WHM_TOKEN) {
    log('[CpanelMigration] WHM_HOST or WHM_TOKEN not set — skipping migration check.')
    return
  }

  const col = getCpanelCol()
  if (!col || !col.find) {
    log('[CpanelMigration] cpanelAccounts collection not ready — skipping.')
    return
  }

  // 1. Find accounts NOT pointing to current WHM_HOST
  const staleAccounts = await col.find({
    whmHost: { $exists: true, $ne: WHM_HOST },
  }).toArray()

  // Also find accounts with no whmHost at all
  const noHostAccounts = await col.find({
    whmHost: { $exists: false },
  }).toArray()

  const nullHostAccounts = await col.find({
    whmHost: null,
  }).toArray()

  const allToMigrate = [...staleAccounts, ...noHostAccounts, ...nullHostAccounts]

  if (allToMigrate.length === 0) {
    log(`[CpanelMigration] All accounts already point to current WHM_HOST (${WHM_HOST}). No migration needed.`)
    return
  }

  log(`[CpanelMigration] Found ${allToMigrate.length} account(s) not on current WHM_HOST (${WHM_HOST}). Checking new server...`)

  // 2. List accounts on the new WHM server
  const whmApi = axios.create({
    baseURL: WHM_API_URL ? `${WHM_API_URL}/json-api` : `https://${WHM_HOST}:2087/json-api`,
    headers: { Authorization: `whm ${WHM_USERNAME}:${WHM_TOKEN}` },
    httpsAgent,
    timeout: 30000,
  })

  let whmUsers = new Set()
  try {
    const res = await whmApi.get('/listaccts', { params: { 'api.version': 1 } })
    const accts = res.data?.data?.acct || []
    whmUsers = new Set(accts.map(a => a.user))
    log(`[CpanelMigration] New WHM server has ${whmUsers.size} account(s).`)
  } catch (err) {
    log(`[CpanelMigration] Failed to list WHM accounts: ${err.message}. Aborting migration.`)
    return
  }

  // 3. For each stale account that exists on new server, sync password + update whmHost
  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const acct of allToMigrate) {
    const cpUser = acct.cpUser
    if (!whmUsers.has(cpUser)) {
      log(`[CpanelMigration] ${cpUser}: Not on new server — skipped (stays on ${acct.whmHost || 'unknown'}).`)
      skipped++
      continue
    }

    // Decrypt the stored password
    let cpPass
    try {
      cpPass = decrypt({
        encrypted: acct.cpPass_encrypted,
        iv: acct.cpPass_iv,
        tag: acct.cpPass_tag,
      })
    } catch (err) {
      log(`[CpanelMigration] ${cpUser}: Failed to decrypt password — ${err.message}`)
      failed++
      continue
    }

    // Sync password to new WHM server
    try {
      const res = await whmApi.get('/passwd', {
        params: { 'api.version': 1, user: cpUser, password: cpPass },
      })
      const ok = res.data?.metadata?.result === 1
      if (!ok) {
        log(`[CpanelMigration] ${cpUser}: WHM passwd failed — ${res.data?.metadata?.reason}`)
        failed++
        continue
      }
    } catch (err) {
      log(`[CpanelMigration] ${cpUser}: WHM passwd error — ${err.message}`)
      failed++
      continue
    }

    // Verify auth actually works
    try {
      await axios.get(`https://${WHM_HOST}:2083/execute/Quota/get_local_quota_info`, {
        auth: { username: cpUser, password: cpPass },
        httpsAgent,
        timeout: 15000,
      })
    } catch (err) {
      log(`[CpanelMigration] ${cpUser}: Auth verification failed after passwd sync — ${err.message}`)
      failed++
      continue
    }

    // Update whmHost in MongoDB
    // CRITICAL: also clear the protection-heartbeat "stuck" flags inherited
    // from the old WHM. Without this, every account migrated here stays
    // permanently excluded from ProtectionHeartbeat — re: 2026-06-18 audit,
    // 19/20 accounts on the new server were silently skipped because their
    // protectionRepairCount was already 3 (pinned on the dead OLD WHM).
    // Stamp migratedAt + prevWhmHost so the heartbeat can also confirm the
    // pin predates the migration (and to keep parity with the ad-hoc
    // /app/memory/WHM_MIGRATION_2026-06-17.md migration's schema).
    await col.updateOne(
      { _id: acct._id },
      {
        $set: { whmHost: WHM_HOST, prevWhmHost: acct.whmHost || null, migratedAt: new Date() },
        $unset: {
          protectionRepairCount: '',
          protectionLastSkipReason: '',
          protectionStuckAt: '',
          protectionRepairUpdatedAt: '',
        },
      },
    )
    log(`[CpanelMigration] ${cpUser}: ✅ Migrated to ${WHM_HOST} (was ${acct.whmHost || 'unset'}).`)
    migrated++

    // Update Cloudflare DNS records for the domain (switch to new server/tunnel)
    try {
      const cfService = require('./cf-service')
      const domain = acct.domain || acct.cpDomain
      if (domain) {
        const zone = await cfService.getZoneByName(domain)
        if (zone) {
          await cfService.cleanupConflictingDNS(zone.id, domain)
          await cfService.createHostingDNSRecords(zone.id, domain, WHM_HOST, true)
          log(`[CpanelMigration] ${cpUser}: DNS updated for ${domain}`)

          // Also migrate addon domains if any
          const addons = acct.addonDomains || []
          for (const addon of addons) {
            const addonZone = await cfService.getZoneByName(addon)
            if (addonZone) {
              await cfService.cleanupConflictingDNS(addonZone.id, addon)
              await cfService.createHostingDNSRecords(addonZone.id, addon, WHM_HOST, true)
              log(`[CpanelMigration] ${cpUser}: DNS updated for addon ${addon}`)
            }
          }
        }
      }
    } catch (dnsErr) {
      log(`[CpanelMigration] ${cpUser}: DNS update warning — ${dnsErr.message}`)
      // Non-fatal: migration succeeded even if DNS update fails
    }
  }

  log(`[CpanelMigration] Migration complete: ${migrated} migrated, ${skipped} skipped (not on new server), ${failed} failed.`)
}

module.exports = { runMigration }
