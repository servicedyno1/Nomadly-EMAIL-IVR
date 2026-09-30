'use strict'
/**
 * vps-password-reveal.js — resolve the CURRENT password of a VPS so the
 * customer can look it up any time, not only in the one message we sent when
 * the password was created or reset.
 *
 * ─── WHY ─────────────────────────────────────────────────────────────────
 * Until now the password was shown exactly once and the copy even said "we
 * cannot retrieve it later". That was true for the wrong reason: DigitalOcean
 * and Vultr have no secrets API, so the bot fabricated `do-pwd-…` / `vultr-pwd-…`
 * ids and kept the plaintext in a per-process Map that died on every redeploy.
 * Customers who lost the message had to "reset" — which, before the 2026-08-13
 * fix, wiped their server and handed them a password that did not work.
 *
 * Resolution order (first hit wins):
 *   1. vps-secret-store (Mongo)      — everything created/reset from now on
 *   2. provider secrets API          — Contabo stores real secrets server-side
 *   3. provider instance record      — Vultr exposes `default_password`
 *   4. cloud-init user-data over SSH — LEGACY RECOVERY. DigitalOcean serves the
 *      immutable create-time user_data for the life of the droplet, so the
 *      original password is still on the box even for VPS created before the
 *      durable store existed. Recovered values are written back into the store
 *      so the next lookup is instant.
 *
 * Whatever we find is then checked against the live server, so we never show a
 * credential that does not actually work.
 */

const secretStore = require('./vps-secret-store')

const log = (...a) => console.log('[VpsReveal]', ...a)

/** Best-effort: which provider owns this record. */
function detectProvider(record = {}) {
  if (record.provider) return String(record.provider).toLowerCase()
  const id = String(record.vpsId || record.contaboInstanceId || record._id || '')
  if (id.startsWith('do-')) return 'digitalocean'
  if (id.startsWith('vps-')) return 'ovh'
  if (id.startsWith('az-') || id.startsWith('azure-')) return 'azure'
  if (/^\d+$/.test(id)) return 'contabo'
  return 'unknown'
}

function isRdpRecord(record = {}) {
  return !!(record.isRDP || record.osType === 'Windows')
}

function loginUserFor(record = {}) {
  return record.defaultUser || (isRdpRecord(record) ? 'Administrator' : 'root')
}

/**
 * @param {object} record   vpsPlansOf document (or fetchVPSDetails result)
 * @param {object} opts     { sshPrivateKeys: [{privateKey, sshKeyName}], verify: bool }
 * @returns {Promise<{
 *   status: 'ok'|'not_available'|'error',
 *   password: string|null,
 *   source: string|null,
 *   recovered: boolean,
 *   verification: {status:string, detail:string}|null,
 *   reason: string|null,
 * }>}
 */
async function revealVpsPassword(record = {}, opts = {}) {
  const provider = detectProvider(record)
  const secretId = record.rootPasswordSecretId || record.passwordSecretId || null
  const username = loginUserFor(record)
  const host = record.host && record.host !== 'provisioning...' ? record.host : null
  const sshPrivateKeys = opts.sshPrivateKeys || []
  const out = { status: 'not_available', password: null, source: null, recovered: false, verification: null, reason: null }

  // ── 1. durable store ────────────────────────────────────────────────────
  if (secretId) {
    try {
      const fromStore = await secretStore.getSecretPassword(secretId)
      if (fromStore) {
        out.status = 'ok'
        out.password = fromStore
        out.source = 'stored'
      }
    } catch (e) {
      log(`store lookup failed for ${secretId}: ${e.message || e}`)
    }
  }

  // ── 1b. provider in-process cache (secrets created since the last restart
  //        that predate the durable store) ─────────────────────────────────
  if (!out.password && secretId) {
    const MODULES = {
      digitalocean: './digitalocean-service',
      azure: './azure-service',
      vultr: './vultr-service',
    }
    const modPath = MODULES[provider]
    if (modPath) {
      try {
        const mod = require(modPath)
        if (typeof mod.getSecretPassword === 'function') {
          const v = await mod.getSecretPassword(secretId)
          if (v) {
            out.status = 'ok'
            out.password = v
            out.source = 'provider-cache'
          }
        }
      } catch (e) {
        log(`${provider} getSecretPassword failed: ${e.message || e}`)
      }
    }
  }

  // ── 2/3. provider-side lookups ──────────────────────────────────────────
  if (!out.password && secretId) {
    try {
      if (provider === 'contabo' && /^\d+$/.test(String(secretId))) {
        const contabo = require('./contabo-service')
        const secret = await contabo.getSecret(String(secretId))
        const value = secret?.value || secret?.secretValue || null
        if (value) {
          out.status = 'ok'
          out.password = value
          out.source = 'provider-secrets-api'
        }
      }
    } catch (e) {
      out.reason = `provider secrets API unavailable (${String(e.message || e).slice(0, 90)})`
      log(`contabo getSecret(${secretId}) failed: ${e.message || e}`)
    }
  }

  if (!out.password && provider === 'vultr') {
    try {
      const vultr = require('./vultr-service')
      const inst = await vultr.getInstance(record.vpsId || record._id)
      if (inst?.defaultPassword) {
        out.status = 'ok'
        out.password = inst.defaultPassword
        out.source = 'provider-instance-record'
      }
    } catch (e) {
      log(`vultr getInstance failed: ${e.message || e}`)
    }
  }

  // ── 4. LEGACY RECOVERY from cloud-init user-data (Linux + SSH key) ───────
  if (!out.password && host && !isRdpRecord(record) && sshPrivateKeys.length) {
    try {
      const { recoverPasswordFromCloudInit } = require('./vps-ssh-password')
      const rec = await recoverPasswordFromCloudInit({ host, username, privateKeys: sshPrivateKeys })
      if (rec.ok && rec.password) {
        out.status = 'ok'
        out.password = rec.password
        out.source = rec.source
        out.recovered = true
        // Cache it so the next lookup does not need SSH at all.
        if (secretId) await secretStore.putSecret(secretId, rec.password, { provider, name: secretId })
      } else if (!out.reason) {
        out.reason = rec.error || 'not recoverable from the server'
      }
    } catch (e) {
      log(`cloud-init recovery failed: ${e.message || e}`)
      if (!out.reason) out.reason = String(e.message || e).slice(0, 120)
    }
  }

  if (!out.password) {
    if (!out.reason) {
      out.reason = !secretId
        ? 'no password on record for this server'
        : (isRdpRecord(record)
          ? 'this Windows password was created before we stored passwords durably'
          : 'no stored password and no SSH key available to recover it')
    }
    // If we could not read the password AND the box is a reachable-but-SSH-
    // blocked Linux VPS, tell the caller so the UI can give firewall guidance
    // (a plain "reset password" won't help while port 22 is closed).
    if (host && !isRdpRecord(record)) {
      try {
        const { diagnoseSshReachability } = require('./vps-ssh-password')
        const diag = await diagnoseSshReachability(host, { sshPort: 22 })
        if (diag.verdict === 'ssh-blocked') {
          out.sshBlocked = true
          out.diag = diag
          out.reason = 'your VPS is online but SSH port 22 is blocked by a firewall on the server'
        }
      } catch (_) { /* best-effort diagnosis only */ }
    }
    return out
  }

  // ── verify it actually works (Linux only; RDP has no SSH to test) ────────
  if (opts.verify !== false && host && !isRdpRecord(record)) {
    try {
      const { diagnosePasswordAccess } = require('./vps-ssh-password')
      out.verification = await diagnosePasswordAccess({
        host, username, password: out.password, privateKeys: sshPrivateKeys,
      })
    } catch (e) {
      out.verification = { status: 'unreachable', detail: String(e.message || e).slice(0, 120) }
    }
  }

  return out
}

module.exports = {
  revealVpsPassword,
  detectProvider,
  loginUserFor,
  isRdpRecord,
}
