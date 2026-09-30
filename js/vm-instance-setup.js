/**
 * vm-instance-setup.js — REWRITTEN for Contabo API
 *
 * Keeps the same 28+ export signatures so _index.js doesn't break.
 * Routes everything through contabo-service.js.
 * Uses MongoDB (vpsPlansOf, sshKeysOf) for per-user tracking.
 *
 * KEY CHANGES vs old Nameword version:
 *  - Region selection is flat (9 regions, no country→region→zone hierarchy)
 *  - Disk type is part of the product (NVMe vs SSD variants)
 *  - Billing is always monthly (no hourly/quarterly/annual via API)
 *  - SSH keys stored as Contabo secrets (named with telegramId prefix)
 *  - cPanel/Plesk: NOT available via Contabo API — graceful fallback
 *  - "RDP" = Windows Server (auto-selects Windows image)
 */

require('dotenv').config()
const crypto = require('crypto')
const nodemailer = require('nodemailer')

// ─── Provider abstraction (2026-02 OVH migration) ─────────────────────────
// `contabo` was originally a direct require of contabo-service.js. As of
// the OVH migration it is now a smart-routing proxy from vps-provider.js:
//
//  • Catalog/list/region ops      → default provider (OVH by default)
//  • Per-record ops (createInstance, getInstance, cancelInstance, …)
//    are dispatched by the instanceId format:
//        numeric    (e.g. "203228089")          → contabo-service.js
//        "vps-..."  (e.g. "vps-12abc.vps.ovh")  → ovh-service.js
//
// This lets us preserve `contabo.X(...)` call sites throughout this file
// without any per-line rewrites — legacy Contabo records keep working,
// and new orders ship via OVH automatically.
const vpsProvider = require('./vps-provider')
const contabo = vpsProvider.buildSmartProxy()

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

// ─── MongoDB references (set by initVpsDb from _index.js) ────────────────
let _db = null
let _vpsPlansOf = null
let _sshKeysOf = null

/**
 * Must be called once from _index.js after DB connects.
 * Sets the MongoDB collections for VPS tracking.
 */
function initVpsDb(db) {
  _db = db
  _vpsPlansOf = db.collection('vpsPlansOf')
  _sshKeysOf = db.collection('sshKeysOf')
  // Ensure indexes
  _vpsPlansOf.createIndex({ chatId: 1 }).catch(() => {})
  _vpsPlansOf.createIndex({ contaboInstanceId: 1 }).catch(() => {})
  _sshKeysOf.createIndex({ telegramId: 1 }).catch(() => {})
}

// ─── Utility ──────────────────────────────────────────────────────────────

/**
 * Load a customer's stored SSH PRIVATE keys, newest-relevant first.
 *
 * Used by the DigitalOcean password paths: DO cannot set or read a droplet
 * password through its API, so the bot logs into the running box with the key
 * it injected at create time (DO re-injects it on every rebuild) to apply a new
 * password or to recover the original one from cloud-init user-data.
 *
 * @param {string|number} telegramId
 * @param {string|number} [linkedSecretId] provider ssh-key id linked to the VPS
 *                                         (that key is returned first)
 * @returns {Promise<Array<{privateKey:string, sshKeyName:string}>>}
 */
async function fetchUserSSHPrivateKeys(telegramId, linkedSecretId = null) {
  try {
    if (!_sshKeysOf) return []
    const docs = await _sshKeysOf.find({ telegramId: String(telegramId) }).toArray()
    return docs
      .filter(k => k && k.privateKey)
      .sort((a, b) => {
        const am = linkedSecretId && String(a.contaboSecretId) === String(linkedSecretId) ? -1 : 0
        const bm = linkedSecretId && String(b.contaboSecretId) === String(linkedSecretId) ? -1 : 0
        return am - bm
      })
      .map(k => ({ privateKey: k.privateKey, sshKeyName: k.sshKeyName }))
  } catch (e) {
    console.log(`[VPS] fetchUserSSHPrivateKeys(${telegramId}) failed: ${e.message || e}`)
    return []
  }
}

function generateRandomName(prefix, number = 12) {
  const randomSuffix = crypto.randomBytes(number).toString('hex').substring(0, 12)
  return `${prefix}-${randomSuffix}`
}

// Short, brandable instance label: "nomadly-x7k2p9" (brand + 6-char code).
// Cosmetic display/label only (NOT a lookup key) — replaces the old
// nomadly-<telegramId>-<epoch> label that leaked the Telegram ID and was noisy.
function shortInstanceLabel(prefix = 'nomadly') {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789' // drop look-alikes l,o,0,1
  let code = ''
  const buf = crypto.randomBytes(6)
  for (let i = 0; i < 6; i++) code += alphabet[buf[i] % alphabet.length]
  return `${prefix}-${code}`
}


function generateRandomPassword(length = 16) {
  const upperCase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
  const numbers = '0123456789'
  // RDP-safe symbols only — avoid % ^ $ & * ( ) which break Windows auth,
  // shell escaping, and Contabo secret provisioning
  const symbols = '!@#-_+=.'
  const allCharacters = upperCase + lowerCase + numbers + symbols
  const getRandomIndex = (max) => {
    const randomBuffer = crypto.randomBytes(4)
    return randomBuffer.readUInt32BE(0) % max
  }
  let password = [
    upperCase[getRandomIndex(upperCase.length)],
    lowerCase[getRandomIndex(lowerCase.length)],
    numbers[getRandomIndex(numbers.length)],
    symbols[getRandomIndex(symbols.length)],
  ]
  for (let i = password.length; i < length; i++) {
    password.push(allCharacters[getRandomIndex(allCharacters.length)])
  }
  for (let i = password.length - 1; i > 0; i--) {
    const j = getRandomIndex(i + 1)
    ;[password[i], password[j]] = [password[j], password[i]]
  }
  return password.join('')
}

// ─── Region / Country / Zone  ─────────────────────────────────────────────
// Contabo has flat regions, no country→region→zone hierarchy.
// We still export the 3 old functions but flatten the flow.

/**
 * OLD: fetchAvailableCountries() → ['Americas','Europe','Asia Pacific']
 * NEW: Returns Contabo region slugs as "countries".
 *      _index.js uses these as button labels.
 */
async function fetchAvailableCountries(isRDP = false) {
  try {
    const regions = await vpsProvider.pickProviderForOs(!!isRDP).listRegions()
    // Return array of display labels — used as button text
    return regions.map(r => `${r.display.emoji} ${r.display.label}`)
  } catch (err) {
    console.log('Error in fetchAvailableCountries (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: fetchAvailableRegionsOfCountry(country) → [{value, label}]
 * NEW: Since regions are already flat, this just returns the single region.
 *      The "country" param is the button label from fetchAvailableCountries.
 */
async function fetchAvailableRegionsOfCountry(country, isRDP = false) {
  try {
    const regions = await vpsProvider.pickProviderForOs(!!isRDP).listRegions()
    // Find the region matching the button label
    const match = regions.find(r => `${r.display.emoji} ${r.display.label}` === country)
    if (match) {
      return [{ value: match.regionSlug, label: `${match.display.emoji} ${match.display.label}` }]
    }
    // If exact match fails, return all regions
    return regions.map(r => ({ value: r.regionSlug, label: `${r.display.emoji} ${r.display.label}` }))
  } catch (err) {
    console.log('Error in fetchAvailableRegionsOfCountry (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: fetchAvailableZones(region) → [{name, label}]
 * NEW: Contabo has no zones. Returns the region slug as a single "zone".
 */
async function fetchAvailableZones(region) {
  try {
    // region is the value from fetchAvailableRegionsOfCountry (regionSlug)
    const display = contabo.REGION_DISPLAY[region]
    if (display) {
      return [{ name: region, label: `${display.emoji} ${display.label}` }]
    }
    return [{ name: region, label: region }]
  } catch (err) {
    console.log('Error in fetchAvailableZones (contabo):', err.message || err)
    return false
  }
}

// ─── Disk Types ───────────────────────────────────────────────────────────

/**
 * OLD: fetchAvailableDiskTpes(zone) → [disk type objects]
 * NEW (OVH): returns only NVMe (OVH does not split NVMe/SSD).
 * NEW (Contabo): returns NVMe + SSD as before.
 */
async function fetchAvailableDiskTpes(zone, isRDP = false) {
  try {
    const active = vpsProvider.pickProviderForOs(!!isRDP)
    if (active.PROVIDER === 'ovh' || active.PROVIDER === 'digitalocean-rdp') {
      // OVH catalog and the DO Windows RDP catalog are NVMe-only. Show a single button so the
      // existing flow (which always requires a disk-type pick) keeps working.
      return [
        { id: 'nvme', _id: 'nvme', name: 'NVMe', value: 'nvme', label: '⚡ NVMe SSD', type: 'nvme', description: '⚡ <b>NVMe SSD</b>\n   └ High-performance enterprise storage' },
      ]
    }
    if (active.PROVIDER === 'digitalocean') {
      // DigitalOcean Linux droplets are SSD-only — a single entry makes the bot skip the disk step.
      return [
        { id: 'ssd', _id: 'ssd', name: 'SSD', value: 'ssd', label: '💾 SSD', type: 'ssd', description: '💾 <b>SSD</b>\n   └ Enterprise SSD storage' },
      ]
    }
    return [
      { id: 'nvme', _id: 'nvme', name: 'NVMe', value: 'nvme', label: '⚡ NVMe — Faster Speed', type: 'nvme', description: '⚡ <b>NVMe — Faster Speed</b>\n   └ Best for databases, apps & heavy I/O\n   └ Up to 10× faster read/write vs SSD' },
      { id: 'ssd',  _id: 'ssd',  name: 'SSD',  value: 'ssd',  label: '💾 SSD — 2× More Storage', type: 'ssd', description: '💾 <b>SSD — 2× More Storage</b>\n   └ Same price, double the disk space\n   └ Great for file hosting & backups' }
    ]
  } catch (err) {
    console.log('Error in fetchAvailableDiskTpes:', err.message || err)
    return false
  }
}

// ─── VPS Plans / Configs ──────────────────────────────────────────────────

/**
 * OLD: fetchAvailableVPSConfigs(telegramId, vpsDetails) → [plan objects with billingCycles]
 * NEW: Returns Contabo product catalog with markup pricing.
 *      vpsDetails should have: { region, diskType, isRDP }
 */
async function fetchAvailableVPSConfigs(telegramId, vpsDetails) {
  try {
    const region = vpsDetails.region || 'EU'
    const diskType = vpsDetails.diskType || 'nvme'
    const isRDP = vpsDetails.isRDP || false

    // OS-aware: Linux purchases use the default provider (DigitalOcean),
    // RDP purchases route to the dedicated RDP provider (Azure) when configured.
    const providerForOs = vpsProvider.pickProviderForOs(isRDP)
    const allProducts = providerForOs.listProducts(region, isRDP, diskType) || []
    // Multi-duration catalogs (DO RDP: <tier>-1m/2m/3m) → one button per tier (monthly price);
    // the sibling durations become that tier's billingCycles for the duration step.
    const multiDuration = allProducts.some(p => Number(p.durationMonths) > 1)
    const products = multiDuration ? allProducts.filter(p => Number(p.durationMonths || 1) === 1) : allProducts
    const cyclesFor = (p) => {
      if (!multiDuration) return [{ type: 'Monthly', price: p.pricing.totalWithMarkup, period: 1, productId: p.productId }]
      return allProducts.filter(x => x.slug === p.slug).sort((x, y) => x.durationMonths - y.durationMonths)
        .map(x => ({ type: x.durationMonths === 1 ? 'Monthly' : `${x.durationMonths} Months`, price: x.pricing.totalWithMarkup, period: x.durationMonths, productId: x.productId, discountPct: (x.pricing && x.pricing.discountPct) || 0 }))
    }
    
    // Adapt to old format expected by _index.js
    return products.map(p => ({
      _id: p.productId,
      name: p.botName || p.name,
      cpuCores: p.cpuCores,
      ramMb: p.ramMb,
      ramGb: p.ramGb,
      diskMb: p.diskMb,
      diskGb: p.diskGb,
      diskType: p.diskType,
      bandwidthTb: p.bandwidthTb,
      portSpeedMbps: p.portSpeedMbps,
      tier: p.tier,
      // Pricing adapted to old format
      monthlyPrice: p.pricing.totalWithMarkup,
      basePriceUsd: p.pricing.basePriceUsd,
      regionSurcharge: p.pricing.regionSurcharge,
      windowsLicense: p.pricing.windowsLicense,
      totalBeforeMarkup: p.pricing.totalBeforeMarkup,
      billingCycles: cyclesFor(p),
      // Spec display (object for templates, string for fallback)
      specs: { vCPU: p.cpuCores, RAM: p.ramGb, disk: p.diskGb, diskType: p.diskType?.toUpperCase() || 'NVMe' },
      specsStr: providerForOs.formatSpecs(p),
      // Flag for display
      isRDP: isRDP
    }))
  } catch (err) {
    console.log('Error in fetchAvailableVPSConfigs (contabo):', err.message || err)
    return false
  }
}

// ─── OS / Images ──────────────────────────────────────────────────────────

/**
 * OLD: fetchAvailableOS(cpanel) → [{ id, name, ... }]
 * NEW: Returns Contabo OS images + "RDP" as a special option.
 *      If cpanel param is truthy, returns empty (no cPanel in Contabo API).
 */
async function fetchAvailableOS(cpanel) {
  try {
    if (cpanel) {
      // No cPanel/Plesk via Contabo API
      return []
    }

    // OS-aware split: Linux images come from the default provider (DigitalOcean),
    // Windows defaults come from the RDP provider (Azure) when configured. This
    // ensures the catalogued image IDs are valid on the provider that will
    // actually create the instance later.
    const linuxProvider = vpsProvider.pickProviderForOs(false)
    const rdpProvider   = vpsProvider.pickProviderForOs(true)

    const linuxImages = await linuxProvider.listImages('linux')
    const osOptions = linuxImages.map(img => ({
      id: img.imageId,
      name: img.name,
      os_name: img.name,
      osType: 'Linux',
      isRDP: false,
      price: 0
    }))

    // Add RDP as a special option at the top
    const windowsImageId = await rdpProvider.getDefaultWindowsImageId()
    osOptions.unshift({
      id: windowsImageId || 'rdp',
      value: 'win',
      name: '🖥 RDP',
      os_name: 'Windows Server 2025',
      osType: 'Windows',
      isRDP: true,
      price: (rdpProvider.WINDOWS_LICENSE_BY_TIER && rdpProvider.WINDOWS_LICENSE_BY_TIER[2]) || 19.10  // display price (tier 2 as default); actual price computed per-tier by pricing engine
    })

    return osOptions
  } catch (err) {
    console.log('Error in fetchAvailableOS (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: fetchSelectedCpanelOptions(cpanel) → cpanel data
 * NEW: No cPanel in Contabo API. Returns empty/false.
 */
async function fetchSelectedCpanelOptions(cpanel) {
  console.log('[Contabo] cPanel not available via Contabo API')
  return false
}

// ─── User Registration (Nameword → MongoDB) ──────────────────────────────

/**
 * OLD: registerVpsTelegram(telegramId, email) → registers on Nameword
 * NEW: No-op — user already exists in MongoDB. Returns true.
 */
async function registerVpsTelegram(telegramId, email) {
  try {
    console.log(`[Contabo] User registration (no-op): ${telegramId} ${email}`)
    return true
  } catch (err) {
    console.log('Error in registerVpsTelegram:', err.message || err)
    return false
  }
}

/**
 * OLD: checkMissingEmailForNameword(telegramId) → { hasEmail: bool }
 * NEW: Always returns hasEmail:true since we don't need Nameword email.
 */
async function checkMissingEmailForNameword(telegramId) {
  return { hasEmail: true }
}

/**
 * OLD: addUserEmailForNameWord(telegramId, email) → updates Nameword user
 * NEW: No-op — email is stored in state collection already.
 */
async function addUserEmailForNameWord(telegramId, email) {
  return true
}

// ─── SSH Keys ─────────────────────────────────────────────────────────────
// Keys are stored as Contabo secrets, named with telegramId prefix.

/**
 * OLD: fetchUserSSHkeyList(telegramId, vpsId) → array of key objects
 * NEW: Fetches from Contabo Secrets API, filtered by telegramId prefix.
 */
async function fetchUserSSHkeyList(telegramId, vpsId) {
  try {
    const allSecrets = await contabo.listSecrets('ssh')
    // Filter by naming convention: ssh-{telegramId}-{name}
    const userKeys = allSecrets.filter(s => s.name.startsWith(`ssh-${telegramId}-`))
    
    // Also check local DB for any stored key metadata
    let localKeys = []
    if (_sshKeysOf) {
      localKeys = await _sshKeysOf.find({ telegramId: String(telegramId) }).toArray()
    }

    const keys = userKeys.map(s => {
      const localMatch = localKeys.find(lk => lk.contaboSecretId === s.secretId)
      return {
        _id: s.secretId,
        secretId: s.secretId,
        sshKeyName: s.name.replace(`ssh-${telegramId}-`, ''),
        name: s.name.replace(`ssh-${telegramId}-`, ''),
        telegramId: telegramId,
        createdAt: s.createdAt,
        privateKeyStored: localMatch ? true : false
      }
    })
    // Return in old format { keys: [...] } for backward compat with _index.js
    return { keys }
  } catch (err) {
    console.log('Error in fetchUserSSHkeyList (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: generateNewSSHkey(telegramId, sshName) → { data: { sshKeyName, publicKey, privateKey } }
 * NEW: Generates key pair locally, stores public key on Contabo.
 */
async function generateNewSSHkey(telegramId, sshName) {
  try {
    const keyName = sshName || generateRandomName('key')
    const contaboName = `ssh-${telegramId}-${keyName}`

    // Generate RSA key pair locally
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding:  { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })

    // Convert PEM to OpenSSH format for Contabo
    const sshPubKey = convertPemToOpenSSH(publicKey, `${telegramId}@nomadly`)

    // Guard: if conversion failed, don't send invalid key to Contabo
    if (!sshPubKey) {
      console.log('[SSH] Failed to convert PEM to OpenSSH format for', telegramId)
      return false
    }

    // Store on Contabo
    const secret = await contabo.createSecret(contaboName, sshPubKey, 'ssh')

    // Store private key in MongoDB for user download
    if (_sshKeysOf) {
      await _sshKeysOf.insertOne({
        telegramId: String(telegramId),
        contaboSecretId: secret.secretId,
        sshKeyName: keyName,
        contaboName: contaboName,
        privateKey: privateKey,
        publicKey: sshPubKey,
        createdAt: new Date()
      })
    }

    // Return in old format for backward compat with _index.js
    // _index.js references newSShKey.sshKeyName directly
    return {
      sshKeyName: keyName,
      secretId: secret.secretId,
      publicKey: sshPubKey,
      privateKey: privateKey,
      contaboName: contaboName,
      data: {
        sshKeyName: keyName,
        secretId: secret.secretId,
        publicKey: sshPubKey,
        privateKey: privateKey,
        contaboName: contaboName
      }
    }
  } catch (err) {
    console.log('Error in generateNewSSHkey (contabo):', err.message || err)
    return false
  }
}

/**
 * A (full VPS control): ensure a BOT-MANAGED SSH key exists for this user and
 * is registered with the provider, returning its provider key id so the caller
 * can attach it at droplet-create time.
 *
 * Why: DigitalOcean has no API to set/return a password on a running droplet,
 * so the bot sets passwords over SSH. If no key is on the box the bot can only
 * authenticate with the password it thinks is set — and once that drifts (or
 * the box only allows key auth) the bot is locked out and falls back to DO's
 * useless email reset. Injecting the bot's own key at create guarantees the
 * bot can always SSH in and set+show+verify a fresh password, no email.
 *
 * Idempotent: reuses the user's existing managed key (with its private half
 * stored) instead of piling up a new key on every purchase.
 *
 * @returns {Promise<{secretId:(string|number), sshKeyName:string}>}
 */
async function ensureManagedSSHKey(telegramId, provider) {
  const providerName = (provider && provider.PROVIDER) || 'digitalocean'

  if (_sshKeysOf) {
    try {
      const existing = await _sshKeysOf.findOne({
        telegramId: String(telegramId),
        managed: true,
        provider: providerName,
      })
      if (existing && existing.contaboSecretId && existing.privateKey) {
        return { secretId: existing.contaboSecretId, sshKeyName: existing.sshKeyName }
      }
    } catch (_) { /* fall through and create a fresh one */ }
  }

  const keyName = generateRandomName('botkey')
  const contaboName = `ssh-${telegramId}-${keyName}`
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const sshPubKey = convertPemToOpenSSH(publicKey, `${telegramId}@nomadly`)
  if (!sshPubKey) throw new Error('failed to convert public key to OpenSSH format')

  const secret = await provider.createSecret(contaboName, sshPubKey, 'ssh')
  if (!secret || !secret.secretId) throw new Error('provider did not return an ssh key id')

  if (_sshKeysOf) {
    await _sshKeysOf.insertOne({
      telegramId: String(telegramId),
      contaboSecretId: secret.secretId,
      sshKeyName: keyName,
      contaboName,
      privateKey,
      publicKey: sshPubKey,
      provider: providerName,
      managed: true,
      createdAt: new Date(),
    })
  }
  return { secretId: secret.secretId, sshKeyName: keyName }
}

/**
 * Convert PEM public key to OpenSSH format.
 * Fix #3: Previous implementation exported SPKI DER as base64, which is NOT valid OpenSSH format.
 * Contabo rejected these keys with "Ssh key is not valid. Valid formats [ dsa | ecdsa | ed25519 | rsa ]".
 * Now properly constructs SSH wire format: string("ssh-rsa") + mpint(e) + mpint(n).
 */
function convertPemToOpenSSH(pemKey, comment = '') {
  try {
    const keyObj = crypto.createPublicKey(pemKey)
    // Export as JWK to get raw key components (e = exponent, n = modulus)
    const jwk = keyObj.export({ format: 'jwk' })

    if (jwk.kty !== 'RSA' || !jwk.e || !jwk.n) {
      throw new Error('Not an RSA key or missing e/n components')
    }

    const e = Buffer.from(jwk.e, 'base64url')
    const n = Buffer.from(jwk.n, 'base64url')

    // SSH wire format helper: 4-byte big-endian length prefix + data
    const encodeSSHString = (buf) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(buf.length)
      return Buffer.concat([len, buf])
    }

    // SSH mpint: if high bit set, prepend 0x00 to indicate positive number
    const encodeSSHMpint = (buf) => {
      if (buf[0] & 0x80) {
        buf = Buffer.concat([Buffer.from([0x00]), buf])
      }
      const len = Buffer.alloc(4)
      len.writeUInt32BE(buf.length)
      return Buffer.concat([len, buf])
    }

    // Construct: string("ssh-rsa") + mpint(e) + mpint(n)
    const typeStr = Buffer.from('ssh-rsa')
    const sshBuf = Buffer.concat([
      encodeSSHString(typeStr),
      encodeSSHMpint(e),
      encodeSSHMpint(n),
    ])

    return `ssh-rsa ${sshBuf.toString('base64')} ${comment}`.trim()
  } catch (err) {
    console.log('[SSH] PEM-to-OpenSSH conversion error:', err.message)
    // Return null so caller knows conversion failed (don't send garbage to Contabo)
    return null
  }
}

/**
 * OLD: uploadSSHPublicKey(telegramId, key, sshName) → { data: { sshKeyName } }
 * NEW: Uploads the provided public key to Contabo as a secret.
 */
async function uploadSSHPublicKey(telegramId, key, sshName) {
  try {
    const keyName = sshName || generateRandomName('key')
    const contaboName = `ssh-${telegramId}-${keyName}`

    const secret = await contabo.createSecret(contaboName, key.trim(), 'ssh')

    // Store metadata in MongoDB
    if (_sshKeysOf) {
      await _sshKeysOf.insertOne({
        telegramId: String(telegramId),
        contaboSecretId: secret.secretId,
        sshKeyName: keyName,
        contaboName: contaboName,
        publicKey: key.trim(),
        privateKey: null, // User uploaded public key only
        createdAt: new Date()
      })
    }

    // Return in old format for backward compat with _index.js
    return {
      sshKeyName: keyName,
      secretId: secret.secretId,
      contaboName: contaboName,
      data: {
        sshKeyName: keyName,
        secretId: secret.secretId,
        contaboName: contaboName
      }
    }
  } catch (err) {
    console.log('Error in uploadSSHPublicKey (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: downloadSSHKeyFile(telegramId, sshKeyName) → Buffer (private key file)
 * NEW: Retrieves stored private key from MongoDB.
 */
async function downloadSSHKeyFile(telegramId, sshKeyName) {
  try {
    if (!_sshKeysOf) return false
    const keyDoc = await _sshKeysOf.findOne({
      telegramId: String(telegramId),
      sshKeyName: sshKeyName
    })
    if (!keyDoc || !keyDoc.privateKey) {
      console.log(`[Contabo] No private key stored for ${telegramId}/${sshKeyName}`)
      return false
    }
    return Buffer.from(keyDoc.privateKey, 'utf8')
  } catch (err) {
    console.log('Error in downloadSSHKeyFile (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: unlinkSSHKeyFromVps(telegramId, key, vpsDetails) → unlinks key
 * NEW: Reinstalls instance without that SSH key.
 *      NOTE: This is destructive — requires OS reinstall on Contabo.
 *      We'll just remove the key from Contabo secrets instead.
 */
async function unlinkSSHKeyFromVps(telegramId, key, vpsDetails) {
  try {
    // For Contabo, unlinking SSH key from a running instance isn't possible
    // without reinstall. We'll just delete the key from the account.
    // The key will no longer be available for future instances.
    const secretId = key._id || key.secretId || key
    await contabo.deleteSecret(secretId)

    // Remove from local DB
    if (_sshKeysOf) {
      await _sshKeysOf.deleteOne({ contaboSecretId: secretId })
    }

    return { success: true, message: 'SSH key removed from account' }
  } catch (err) {
    console.log('Error in unlinkSSHKeyFromVps (contabo):', err.message || err)
    return false
  }
}

// ─── VPS Instance CRUD ────────────────────────────────────────────────────

/**
 * OLD: createVPSInstance(telegramId, vpsDetails) → { success: true, data: { _id, vps_name, label, host, status, subscription: { subscriptionEnd } } }
 * NEW: Creates Contabo instance + stores mapping in MongoDB.
 */
async function createVPSInstance(telegramId, vpsDetails) {
  try {
    // Determine OS image
    let imageId = vpsDetails.os?.id
    let isRDP = vpsDetails.os?.isRDP || vpsDetails.isRDP || false

    // OS-aware provider: Linux → DEFAULT_PROVIDER (DigitalOcean),
    // RDP → VPS_RDP_PROVIDER (Azure). All createInstance / createSecret calls
    // below MUST go through this provider, not the legacy `contabo` proxy,
    // so the Azure-specific Windows licensing + VM provisioning fires.
    const newProvider = vpsProvider.pickProviderForOs(isRDP)

    // Build create request (determine product first so we can pick the right image)
    const productId = vpsDetails.config?._id || vpsDetails.productId
    
    if (isRDP && (!imageId || imageId === 'rdp')) {
      // Pass productId so the correct Windows edition (SE for NVMe, DE for SSD) is selected
      imageId = await newProvider.getDefaultWindowsImageId(productId)
    }

    if (!imageId) {
      return { error: 'No OS image selected' }
    }

    const region = vpsDetails.zone || vpsDetails.region || 'EU'
    
    // Generate a root password for the instance
    // Fix #6: Ensure minimum 20 chars (Contabo requires at least 8)
    const rootPassword = generateRandomPassword(Math.max(20, 20))
    const passwordSecret = await newProvider.createSecret(
      `pwd-${telegramId}-${Date.now()}`,
      rootPassword,
      'password'
    )

    const createOpts = {
      productId:    productId,
      region:       region,
      imageId:      imageId,
      displayName:  shortInstanceLabel(),
      rootPassword: passwordSecret.secretId,
      period:       1 // monthly
    }

    // Attach SSH keys. For Linux VPS we ALWAYS ensure a bot-managed key is
    // attached at create time so the bot can authenticate over SSH later
    // regardless of the password state — this is what makes in-bot password
    // reset/reveal work without ever emailing (A: full VPS control). A
    // customer-selected key (if any) still takes precedence.
    if (vpsDetails.sshKeySecretId) {
      createOpts.sshKeys = [vpsDetails.sshKeySecretId]
    } else if (!isRDP) {
      try {
        const managed = await ensureManagedSSHKey(telegramId, newProvider)
        if (managed && managed.secretId) {
          vpsDetails.sshKeySecretId = managed.secretId
          createOpts.sshKeys = [managed.secretId]
          console.log(`[VPS] Attached bot-managed SSH key ${managed.secretId} (${managed.sshKeyName}) to new Linux VPS for ${telegramId}`)
        }
      } catch (e) {
        console.log(`[VPS] ensureManagedSSHKey failed for ${telegramId} — continuing without a bot key: ${e.message || e}`)
      }
    }

    // Fix: On modern Linux distros (Ubuntu 24.04+), the root account is locked
    // and a non-root user (e.g., 'admin') is used instead. The Contabo resetPassword
    // API only resets the ROOT password, so we need to:
    // 1. Unlock root account so Contabo's resetPassword API works
    // 2. Enable PermitRootLogin so SSH as root works
    // 3. Enable PasswordAuthentication for both root and default user
    // 4. Sync root password with the provisioned password
    if (!isRDP) {
      const cloudInitScript = [
        '#!/bin/bash',
        '# === Nomadly VPS Setup ===',
        '# Enable password authentication',
        'sed -i "s/^#*PasswordAuthentication.*/PasswordAuthentication yes/" /etc/ssh/sshd_config',
        'sed -i "s/^#*PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config',
        '# Ensure settings exist even if sed missed commented lines',
        'grep -q "^PermitRootLogin yes" /etc/ssh/sshd_config || echo "PermitRootLogin yes" >> /etc/ssh/sshd_config',
        'grep -q "^PasswordAuthentication yes" /etc/ssh/sshd_config || echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config',
        '# Fix ALL drop-in configs (60-cloudimg-settings.conf often overrides)',
        'for f in /etc/ssh/sshd_config.d/*.conf; do',
        '  [ -f "$f" ] && sed -i "s/^PasswordAuthentication no/PasswordAuthentication yes/" "$f"',
        '  [ -f "$f" ] && sed -i "s/^PermitRootLogin prohibit-password/PermitRootLogin yes/" "$f"',
        '  [ -f "$f" ] && sed -i "s/^PermitRootLogin no/PermitRootLogin yes/" "$f"',
        'done',
        '# Unlock root account (Ubuntu 24.04 locks it by default)',
        'passwd -u root 2>/dev/null',
        '# Bi-directional password sync: ensure BOTH root and default user can login',
        '# On Ubuntu 24.04+, Contabo sets rootPassword on the admin user, not root',
        'ROOT_HASH=$(getent shadow root | cut -d: -f2)',
        'DEFAULT_USER=$(grep -E "^[^:]+:\\$" /etc/shadow | grep -v "root\\|nobody\\|systemd" | head -1 | cut -d: -f1)',
        'ROOT_VALID=false',
        'case "$ROOT_HASH" in "!"*|"*"|""|"!") ;; *"$"*) ROOT_VALID=true ;; esac',
        'if [ "$ROOT_VALID" = "true" ]; then',
        '  # Root has valid hash — copy root hash to default user',
        '  if [ -n "$DEFAULT_USER" ] && [ "$DEFAULT_USER" != "root" ]; then',
        '    usermod -p "$ROOT_HASH" "$DEFAULT_USER" 2>/dev/null',
        '  fi',
        'elif [ -n "$DEFAULT_USER" ] && [ "$DEFAULT_USER" != "root" ]; then',
        '  # Root is locked but default user has valid hash — copy default user hash to root',
        '  DEF_HASH=$(getent shadow "$DEFAULT_USER" | cut -d: -f2)',
        '  case "$DEF_HASH" in *"$"*)',
        '    usermod -p "$DEF_HASH" root 2>/dev/null',
        '    passwd -u root 2>/dev/null',
        '  ;; esac',
        'fi',
        '# Ensure SSH can never be firewalled out. Register an ufw allow rule',
        '# for OpenSSH so that even if the customer enables ufw later (or an',
        '# image ships it enabled), port 22 stays reachable — rules persist',
        '# across reboots. This is the exact lock-out that stranded chatId',
        '# 6277663071: ufw allowed port 80 only, so every reboot killed SSH.',
        'if command -v ufw >/dev/null 2>&1; then ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp 2>/dev/null || true; fi',
        '# Restart SSH daemon',
        'systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null',
      ].join('\n')
      createOpts.userData = Buffer.from(cloudInitScript).toString('base64')
      console.log(`[Contabo] Added cloud-init for Linux VPS: enable password auth + unlock root`)
    }

    console.log(`[VPS] Creating instance for user ${telegramId} via ${newProvider.PROVIDER || 'default'}:`, JSON.stringify(createOpts))
    // Use cross-region fallback when the provider supports it (Azure). Azure
    // capacity for a SKU flips minute-to-minute per region, so a single-region
    // attempt fails far too often — the fallback tries the requested region
    // first then rotates through currently-available regions (live SKUs API),
    // fully cleaning up each failed attempt.
    const instance = (typeof newProvider.createInstanceWithFallback === 'function')
      ? await newProvider.createInstanceWithFallback(createOpts)
      : await newProvider.createInstance(createOpts)

    if (!instance || !instance.instanceId) {
      return { error: 'Failed to create instance — no instanceId returned' }
    }

    // Use the actual product/image that was deployed (may differ from request due to fallback)
    const actualProductId = instance._actualProductId || productId
    const actualImageId = instance._actualImageId || imageId
    if (actualProductId !== productId) {
      console.log(`[Contabo] Product fallback used: requested=${productId}, actual=${actualProductId}`)
    }
    if (actualImageId !== imageId) {
      console.log(`[Contabo] Image fallback used: requested=${imageId}, actual=${actualImageId}`)
    }
    // Region may differ from request when cross-region capacity fallback kicked
    // in (Azure). Persist what actually got provisioned so management/IP lookups
    // hit the right region.
    const actualRegion = instance._actualRegion || region
    if (actualRegion !== region) {
      console.log(`[VPS] Region fallback used: requested=${region}, actual=${actualRegion} (attempts: ${(instance._regionAttempts || []).join(', ')})`)
    }

    // Resolve `defaultUser` reliably BEFORE we build the credentials message.
    // The createInstance response usually returns `defaultUser: undefined`
    // because Contabo only populates it after the OS finishes provisioning.
    // If we trust that empty value we'd hand the user `Username: root` for
    // modern Ubuntu images that actually default to `admin` — root is locked,
    // login fails, user complains "password not right". (See @spoofed,
    // chatId 6996287179, 2026-05-19.)
    //
    // Poll a few times (5×3s = 15s max) until defaultUser is populated.
    // If it never populates, fall back to the legacy guess.
    let resolvedDefaultUser = instance.defaultUser
    if (!resolvedDefaultUser && !isRDP) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const live = await contabo.getInstance(instance.instanceId)
          if (live?.defaultUser) {
            resolvedDefaultUser = live.defaultUser
            console.log(`[Contabo] defaultUser resolved on attempt ${attempt}: ${resolvedDefaultUser}`)
            // Keep the freshest instance snapshot for downstream fields
            if (live.ipConfig?.v4?.ip) instance.ipConfig = live.ipConfig
            if (live.status) instance.status = live.status
            break
          }
        } catch (e) {
          console.log(`[Contabo] getInstance poll ${attempt} error: ${e.message}`)
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      if (!resolvedDefaultUser) {
        console.log(`[Contabo] defaultUser still unresolved after 5 polls — falling back to 'root'`)
      }
    }
    const defaultUser = resolvedDefaultUser || (isRDP ? 'admin' : 'root')

    // Calculate expiry (1 month, or the prepaid duration picked in the bot — DO RDP sells 1/2/3 months)
    const now = new Date()
    const expiresAt = new Date(now)
    const durationMonths = Math.max(1, Number(vpsDetails.durationMonths || (newProvider.getProduct && newProvider.getProduct(actualProductId)?.durationMonths) || 1))
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths)

    // Adapt to old return format expected by _index.js
    // Cross-provider IP extraction: Contabo nests at ipConfig.v4.ip,
    // Vultr/OVH expose mainIp at top level.
    const initialIp = instance.ipConfig?.v4?.ip || instance.mainIp || instance.ipv4 || 'provisioning...'
    const vpsData = {
      _id: String(instance.instanceId),
      vps_name: instance.name || instance.displayName || createOpts.displayName,
      label: createOpts.displayName,
      host: initialIp,
      status: instance.status || 'provisioning',
      contaboInstanceId: instance.instanceId,
      region: actualRegion,
      productId: actualProductId,
      osType: isRDP ? 'Windows' : 'Linux',
      isRDP: isRDP,
      subscription: {
        subscriptionEnd: expiresAt.toISOString()
      },
      credentials: {
        username: defaultUser,
        password: rootPassword
      }
    }

    // Store in MongoDB for tracking
    if (_vpsPlansOf) {
      // Detect which provider just shipped this instance (OVH vs Contabo) so
      // future lookups can route per-record without sniffing the ID format.
      const provider = (vpsProvider.detectProviderByInstanceId(instance.instanceId) || vpsProvider.DEFAULT_PROVIDER)
      await _vpsPlansOf.insertOne({
        chatId: String(telegramId),
        contaboInstanceId: instance.instanceId,
        name: vpsData.vps_name,
        label: vpsData.label,
        vpsId: String(instance.instanceId),
        host: vpsData.host,
        region: actualRegion,
        productId: actualProductId,
        osType: vpsData.osType,
        isRDP: isRDP,
        imageId: actualImageId,
        defaultUser: defaultUser,
        start_time: now,
        end_time: expiresAt,
        plan: vpsDetails.plan || 'Monthly',
        durationMonths,
        planPrice: vpsDetails.plantotalPrice || vpsDetails.monthlyPrice,
        status: vpsData.status,
        // Explicit default: safer for user (no surprise wallet deductions).
        // When undefined, scheduler already treats as false — this just makes
        // the record self-describing so audits/queries are unambiguous.
        autoRenewable: false,
        rootPasswordSecretId: passwordSecret.secretId,
        sshKeySecretId: vpsDetails.sshKeySecretId || null,
        // 2026-02 OVH migration: record which provider owns this instance so
        // the per-record dispatcher in vps-provider.js routes future ops to
        // the right backend even after we add more providers later.
        provider: provider,
        timestamp: new Date()
      })
    }

    // ── Cancel-on-create: since autoRenewable defaults to false, schedule the
    // provider cancel NOW so the next renewal pre-bill never fires. This is
    // invisible to the user — instance still runs through the paid month.
    // (User can flip auto-renew ON later via the toggle; that path clears
    // these flags and pings admin to resume the subscription on the provider
    // dashboard.)
    //
    // Skip for dry-run instanceIds (start with "dryrun-") — there's nothing
    // to cancel and we'd just log noise from a guaranteed 404.
    if (String(instance.instanceId).startsWith('dryrun-')) {
      console.log(`[VPS] Skipping cancel-on-create for dry-run instance ${instance.instanceId}`)
    } else if (vpsProvider.isDestructiveCancelProvider(vpsProvider.detectProviderByInstanceId(instance.instanceId))) {
      // ── Vultr, DigitalOcean & Azure have no scheduled cancel — DELETE is destructive. ──
      // Calling cancelInstance on these providers without scheduleOnly=true would
      // destroy the just-created VPS instantly. autoRenewable=false in our DB
      // is sufficient — the renewal scheduler skips these instances when
      // autoRenewable is false (see hosting-scheduler.js / contabo cleanup).
      const _provName = vpsProvider.detectProviderByInstanceId(instance.instanceId)
      console.log(`[VPS] Skipping cancel-on-create for ${_provName} instance ${instance.instanceId} — provider has no scheduled cancel; autoRenewable=false in DB controls renewal.`)
      if (_vpsPlansOf) {
        await _vpsPlansOf.updateOne(
          { contaboInstanceId: instance.instanceId },
          { $set: {
              _contaboCancelledEarly: false,
              cancelReason: `${_provName}_no_scheduled_cancel_db_only`,
            }
          }
        )
      }
    } else {
    try {
      await contabo.cancelInstance(instance.instanceId)
      // Re-fetch to confirm cancelDate landed (provider may take a few seconds)
      let confirmedCancelDate = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const live = await contabo.getInstance(instance.instanceId)
          if (live?.cancelDate) { confirmedCancelDate = live.cancelDate; break }
        } catch (_) { /* getInstance can briefly 404 right after creation — keep polling */ }
      }
      if (confirmedCancelDate && _vpsPlansOf) {
        await _vpsPlansOf.updateOne(
          { contaboInstanceId: instance.instanceId },
          { $set: {
              _contaboCancelledEarly: true,
              contaboCancelDate: confirmedCancelDate,
              cancelReason: 'created_with_auto_renew_off',
            }
          }
        )
        console.log(`[VPS] Cancel-on-create scheduled for ${instance.instanceId} — cancelDate=${confirmedCancelDate}`)
      } else {
        console.log(`[VPS] Cancel-on-create call returned but cancelDate not yet visible for ${instance.instanceId} (scheduler/self-heal will retry)`)
      }
    } catch (cancelErr) {
      console.log(`[VPS] Cancel-on-create failed for ${instance.instanceId}: ${cancelErr.message || cancelErr} (scheduler/self-heal will retry)`)
      // Don't fail the purchase — instance is created & DB has record.
    }
    }

    return { success: true, data: vpsData }
  } catch (err) {
    const errorMessage = `Error creating VPS instance: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

/**
 * OLD: attachSSHKeysToVM(payload) → attaches SSH keys post-creation
 * NEW: In Contabo, keys are attached at creation time. This is a no-op.
 *      If keys need to be added later, it requires reinstall.
 */
async function attachSSHKeysToVM(payload) {
  try {
    console.log('[Contabo] SSH keys are attached at instance creation time. No separate attach needed.')
    return { success: true, message: 'SSH keys applied at creation' }
  } catch (err) {
    console.log('Error in attachSSHKeysToVM (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: fetchUserVPSList(telegramId) → array of VPS objects
 * NEW: Queries MongoDB for user's instances, enriches with live Contabo status.
 */
async function fetchUserVPSList(telegramId) {
  try {
    if (!_vpsPlansOf) {
      // Fallback: get all Contabo instances (account-level)
      const instances = await contabo.listInstances()
      return instances.map(i => contabo.formatInstanceForDisplay(i))
    }

    // Get user's instances from MongoDB
    const userRecords = await _vpsPlansOf.find({
      chatId: String(telegramId),
      status: { $ne: 'DELETED' }
    }).toArray()

    if (!userRecords.length) return []

    // Enrich with live Contabo status
    const enriched = []
    for (const record of userRecords) {
      try {
        const live = await contabo.getInstance(record.contaboInstanceId)
        const ip = live?.ipConfig?.v4?.ip || record.host || 'provisioning...'
        enriched.push({
          _id: record.vpsId,
          contaboInstanceId: record.contaboInstanceId,
          name: record.name,
          label: record.label,
          host: ip,
          status: (live?.botStatus || live?.status)?.toUpperCase() || record.status,
          region: record.region,
          productId: record.productId,
          osType: record.osType,
          isRDP: record.isRDP,
          plan: record.plan,
          planPrice: record.planPrice,
          start_time: record.start_time,
          end_time: record.end_time,
          autoRenewable: record.autoRenewable || false,
          subscription_id: record.vpsId, // for compatibility
          subscription: {
            subscriptionEnd: record.end_time,
            osId: { os_name: record.osType === 'Windows' ? (live?.osName || 'Windows Server') : 'Ubuntu' }
          }
        })

        // Update IP if it changed (provisioning → assigned)
        if (ip !== record.host && ip !== 'provisioning...') {
          await _vpsPlansOf.updateOne(
            { _id: record._id },
            { $set: { host: ip } }
          )
        }
      } catch (apiErr) {
        // Instance might be deleted on Contabo side
        enriched.push({
          _id: record.vpsId,
          name: record.name,
          label: record.label,
          host: record.host || 'unknown',
          status: 'UNKNOWN',
          region: record.region,
          plan: record.plan,
          planPrice: record.planPrice
        })
      }
    }

    return enriched
  } catch (err) {
    console.log('Error in fetchUserVPSList (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: fetchVPSDetails(telegramId, vpsId) → detailed VPS object
 * NEW: Gets live instance data from Contabo + local MongoDB record.
 */
async function fetchVPSDetails(telegramId, vpsId) {
  try {
    // First get the local record
    let localRecord = null
    if (_vpsPlansOf) {
      localRecord = await _vpsPlansOf.findOne({
        chatId: String(telegramId),
        vpsId: String(vpsId)
      })
    }

    const instanceId = localRecord?.contaboInstanceId || vpsId
    const live = await contabo.getInstance(instanceId)

    if (!live) return false

    const ip = live.ipConfig?.v4?.ip || live.mainIp || live.ipv4 || localRecord?.host || 'provisioning...'
    // Resolve the product/specs from the record's OWN provider catalog. The
    // smart proxy's getProduct() routes to the DEFAULT provider, so an Azure/
    // Vultr product id would miss and specs would render as "?". Also, several
    // providers' getInstance() don't echo osType/specs, so isRDP/osType must
    // come from the stored record first (otherwise an Azure RDP shows as Linux
    // and loses the Reinstall-Windows button + correct username). (2026-06 fix)
    let recSvc = contabo
    try { recSvc = localRecord ? require('./vps-provider').getProviderForRecord(localRecord) : contabo } catch (_) { /* fall back to smart proxy */ }
    const product = recSvc.getProduct(live.productId || localRecord?.productId) || contabo.getProduct(live.productId)
    const isRDP = (localRecord?.isRDP === true) || (localRecord?.osType === 'Windows') || (live.osType === 'Windows')
    const diskType = (product?.diskType || localRecord?.productId || '').includes('nvme') ? 'nvme' : 'ssd'

    return {
      _id: String(vpsId),
      contaboInstanceId: live.instanceId,
      name: live.name || live.displayName || localRecord?.label,
      label: localRecord?.label || live.displayName,
      host: ip,
      ipv6: live.ipConfig?.v6?.ip || '',
      status: (live.botStatus || live.status)?.toUpperCase() || 'UNKNOWN',
      region: live.region || localRecord?.region,
      productId: live.productId || localRecord?.productId,
      productName: product?.name || live.productId || localRecord?.productId,
      cpuCores: live.cpuCores || product?.cpuCores,
      ramMb: live.ramMb || product?.ramMb,
      diskMb: live.diskMb || product?.diskMb,
      osType: localRecord?.osType || live.osType,
      isRDP: isRDP,
      plan: localRecord?.plan || 'Monthly',
      planPrice: localRecord?.planPrice,
      start_time: localRecord?.start_time,
      end_time: localRecord?.end_time,
      autoRenewable: localRecord?.autoRenewable || false,
      subscription_id: String(vpsId),
      zone: live.region, // compatibility
      subscription: {
        subscriptionEnd: localRecord?.end_time || new Date(),
        osId: { os_name: isRDP ? 'Windows Server' : (live.imageId || 'Ubuntu') }
      },
      defaultUser: localRecord?.defaultUser || live.defaultUser || (isRDP ? 'Administrator' : 'root'),
      durationMonths: Number(localRecord?.durationMonths || live.durationMonths) || 1,
      osName: live.osName || null,
      agentOnline: live.agentOnline === true,
      provisioning: live.provisioning || null,

      // ── Compat fields required by lang/en.js selectedVpsData template ──
      planDetails: {
        name: product?.name || live.productId || 'Cloud VPS',
        specs: {
          vCPU: live.cpuCores || product?.cpuCores || '?',
          RAM:  Math.round((live.ramMb || product?.ramMb || 0) / 1024) || '?',
          disk: Math.round((live.diskMb || product?.diskMb || 0) / 1024) || '?',
        }
      },
      diskTypeDetails: {
        type: diskType.toUpperCase()
      },
      osDetails: {
        name: isRDP ? `🪟 ${live.osName || 'Windows Server'}` : (live.osType || 'Linux')
      },
      cPanelPlanDetails: null
    }
  } catch (err) {
    console.log('Error in fetchVPSDetails (contabo):', err.message || err)
    return false
  }
}

// ─── Instance Status Changes ──────────────────────────────────────────────

/**
 * OLD: changeVpsInstanceStatus(vpsDetails, changeStatus) → { success, data }
 * NEW: Maps to Contabo start/stop/restart.
 */
async function changeVpsInstanceStatus(vpsDetails, changeStatus) {
  try {
    const instanceId = vpsDetails.contaboInstanceId || vpsDetails._id
    let result

    switch (changeStatus) {
      case 'start':
        result = await contabo.startInstance(instanceId)
        break
      case 'stop':
        result = await contabo.stopInstance(instanceId)
        break
      case 'restart':
        result = await contabo.restartInstance(instanceId)
        break
      case 'shutdown':
        result = await contabo.shutdownInstance(instanceId)
        break
      default:
        return { error: `Unknown status: ${changeStatus}` }
    }

    // Update MongoDB status
    if (_vpsPlansOf) {
      const newStatus = changeStatus === 'start' ? 'RUNNING' :
                       changeStatus === 'stop' ? 'STOPPED' :
                       changeStatus === 'restart' ? 'RUNNING' :
                       changeStatus === 'shutdown' ? 'STOPPED' : 'UNKNOWN'
      await _vpsPlansOf.updateOne(
        { vpsId: String(instanceId) },
        { $set: { status: newStatus } }
      )
    }

    return { success: true, data: result }
  } catch (err) {
    // err shape from contabo-service apiRequest: { status, message, raw }
    const errorMessage = `Error changing VPS status to ${changeStatus}: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    // Preserve provider status code so the caller can show specific UX messages.
    return { error: errorMessage, status: err?.status || 'unknown', providerMessage: err?.message || '' }
  }
}

/**
 * OLD: deleteVPSinstance(chatId, vpsId) → { success, data }
 * NEW: Cancels instance on Contabo + marks as DELETED in MongoDB.
 *
 * VERIFICATION: after calling Contabo cancelInstance, we re-fetch the
 * instance and confirm `cancelDate` is now set. Contabo's cancel API has
 * been observed returning 2xx "soft success" without actually scheduling
 * cancellation (e.g., for instances in `pending_payment` state), which
 * previously left ghost records that kept billing silently. If the
 * verification fails, we DO NOT mark the DB record as DELETED — we
 * return an error so the caller/admin can intervene.
 */
async function deleteVPSinstance(chatId, vpsId) {
  try {
    const instanceId = vpsId

    // Get the local record to find contaboInstanceId
    let localRecord = null
    if (_vpsPlansOf) {
      localRecord = await _vpsPlansOf.findOne({
        chatId: String(chatId),
        vpsId: String(vpsId)
      })
    }

    const contaboId = localRecord?.contaboInstanceId || instanceId

    // Helper: Contabo returns 404 when the instance was already deleted
    // (manually via panel, prior-successful-but-undelivered-response, or
    // expired billing cycle). It ALSO returns 400 "Cannot cancel instance as
    // it has already been canceled" when we're calling cancelInstance on an
    // instance that's already in cancelled/scheduled-for-deletion state
    // (auto-renew off → provider grace window). BOTH mean: our earlier
    // cancel already succeeded on the provider side, we just have a stale
    // PENDING_CANCELLATION status in our DB. Treat as idempotent success —
    // otherwise the scheduler retries every tick and spams admin with
    // "🚨 VPS DELETE FAILED" (2026-02 vmi3508080 fired 43× in one day before
    // this fix).
    const isAlreadyGone = (e) =>
      e?.status === 404 ||
      /Entry Instances not found/i.test(e?.message || '') ||
      /already been cancel(l)?ed|already cancel(l)?ed|instance is already cancel(l)?ed/i.test(e?.message || '')

    // Step 1: Call Contabo cancel
    let result
    try {
      result = await contabo.cancelInstance(contaboId)
    } catch (cancelErr) {
      if (isAlreadyGone(cancelErr)) {
        console.log(`[VPS] Contabo says instance ${contaboId} already gone — marking DELETED locally`)
        if (_vpsPlansOf) {
          await _vpsPlansOf.updateOne(
            { vpsId: String(vpsId) },
            { $set: { status: 'DELETED', deletedAt: new Date(), cancelReason: 'contabo_404_already_gone' } }
          )
        }
        return { success: true, alreadyGone: true, contaboId }
      }
      throw cancelErr
    }

    // Step 1b: Provider-aware verification.
    // OVH cancellation is synchronous: cancelInstance awaits
    // PUT /vps/{sn}/serviceInfos (renew.deleteAtExpiration=true). A non-throwing
    // return IS the confirmation — OVH has no Contabo-style `cancelDate` to poll,
    // so skip the cancelDate verification loop below (which would always fail for OVH).
    //
    // Vultr & DigitalOcean: `cancelInstance` performs an IMMEDIATE DELETE
    // (no scheduled cancellation). A non-throwing return IS the confirmation;
    // the droplet/instance is already destroyed. Skip the verification poll
    // (it would spend 9-12s waiting for a cancelDate that will never exist).
    const _providerName = vpsProvider.detectProviderByInstanceId(contaboId)
      || (localRecord?.provider || '').toLowerCase()
      || 'contabo'
    if (_providerName === 'ovh') {
      console.log(`[VPS] OVH cancel confirmed for ${contaboId} (delete-at-expiration set)`)
      if (_vpsPlansOf) {
        await _vpsPlansOf.updateOne(
          { vpsId: String(vpsId) },
          { $set: {
              status: 'DELETED',
              deletedAt: new Date(),
              cancelReason: 'ovh_delete_at_expiration',
              ovhCancelMethod: result?.method || 'auto-renew-off',
          } }
        )
      }
      return { success: true, data: result, method: 'ovh-serviceInfos' }
    }
    if (vpsProvider.isDestructiveCancelProvider(_providerName)) {
      console.log(`[VPS] ${_providerName} cancel confirmed for ${contaboId} (immediate delete — VPS resources destroyed)`)
      if (_vpsPlansOf) {
        await _vpsPlansOf.updateOne(
          { vpsId: String(vpsId) },
          { $set: {
              status: 'DELETED',
              deletedAt: new Date(),
              cancelReason: `${_providerName}_immediate_delete`,
          } }
        )
      }
      return { success: true, data: result, method: `${_providerName}-immediate-delete` }
    }

    // Step 2: VERIFY the cancellation actually took effect by re-fetching
    //         and checking that `cancelDate` is now set. Poll briefly
    //         because Contabo can take a few seconds to update.
    let verifiedCancelDate = null
    let verifiedAlreadyGone = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const live = await contabo.getInstance(contaboId)
        if (live?.cancelDate) { verifiedCancelDate = live.cancelDate; break }
      } catch (fetchErr) {
        if (isAlreadyGone(fetchErr)) {
          console.log(`[VPS] verify says instance ${contaboId} already gone — treating as success`)
          verifiedAlreadyGone = true
          break
        }
        console.log(`[VPS] verify fetch attempt ${attempt} failed: ${fetchErr.message}`)
      }
    }

    if (!verifiedCancelDate && !verifiedAlreadyGone) {
      // Contabo returned success but cancelDate never appeared — soft-success.
      const errorMessage = `Contabo cancel returned success but cancelDate was not set after 9s. Manual cancellation required via Contabo Control Panel > Unpaid Orders. Instance: ${contaboId}`
      console.error(`[VPS] ${errorMessage}`)
      return { error: errorMessage, softSuccess: true, contaboId }
    }

    // Step 3: Mark as deleted in MongoDB only after verification (or 404)
    if (_vpsPlansOf) {
      await _vpsPlansOf.updateOne(
        { vpsId: String(vpsId) },
        { $set: {
            status: 'DELETED',
            deletedAt: new Date(),
            contaboCancelDate: verifiedCancelDate || null,
            cancelReason: verifiedAlreadyGone ? 'contabo_404_during_verify' : 'verified',
        } }
      )
    }

    return { success: true, data: result, cancelDate: verifiedCancelDate, alreadyGone: verifiedAlreadyGone }
  } catch (err) {
    // Final safety net: 404 or "already canceled" surfaced through an outer
    // wrapper (e.g. axios error transformed elsewhere). Still treat as
    // success rather than infinite-loop the scheduler.
    if (err?.status === 404 ||
        /Entry Instances not found/i.test(err?.message || '') ||
        /already been cancel(l)?ed|already cancel(l)?ed|instance is already cancel(l)?ed/i.test(err?.message || '')) {
      const wasAlreadyCancelled = /already/i.test(err?.message || '')
      console.log(`[VPS] caught ${wasAlreadyCancelled ? 'already-cancelled' : '404'} in outer handler — marking DELETED locally for ${vpsId}`)
      if (_vpsPlansOf) {
        await _vpsPlansOf.updateOne(
          { vpsId: String(vpsId) },
          { $set: { status: 'DELETED', deletedAt: new Date(), cancelReason: wasAlreadyCancelled ? 'contabo_already_cancelled' : 'contabo_404_outer' } }
        )
      }
      return { success: true, alreadyGone: true }
    }
    const errorMessage = `Error deleting VPS instance: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

// ─── Credentials ──────────────────────────────────────────────────────────

/**
 * OLD: setVpsSshCredentials(host) → { success, data: { username, password } }
 * NEW: Uses Contabo resetPassword API, OR returns the stored password from creation.
 */
async function setVpsSshCredentials(host) {
  try {
    // Find instance by IP
    let instanceId = null
    let defaultUser = 'root'
    if (_vpsPlansOf) {
      const record = await _vpsPlansOf.findOne({ host: host })
      instanceId = record?.contaboInstanceId
      defaultUser = record?.defaultUser || 'root'
    }

    if (!instanceId) {
      // Try to find from live instances
      const instances = await contabo.listInstances()
      const match = instances.find(i => i.ipConfig?.v4?.ip === host)
      instanceId = match?.instanceId
      // Use defaultUser from Contabo API response
      if (match?.defaultUser) defaultUser = match.defaultUser
    }

    if (instanceId) {
      // Pass defaultUser, imageId, osType, isRDP so resetPassword can decide:
      //  - Linux non-root → reinstall with bash cloud-init (preserves Ubuntu)
      //  - Windows (any defaultUser) → standard resetPassword API (preserves Windows)
      // Without osType/isRDP, the resetPassword path used to coerce Windows to Ubuntu.
      const resetOpts = {}
      if (_vpsPlansOf) {
        const record = await _vpsPlansOf.findOne({ contaboInstanceId: instanceId })
        if (record?.defaultUser) resetOpts.defaultUser = record.defaultUser
        if (record?.imageId) resetOpts.imageId = record.imageId
        if (record?.osType) resetOpts.osType = record.osType
        if (typeof record?.isRDP === 'boolean') resetOpts.isRDP = record.isRDP
      }
      const { password } = await contabo.resetPassword(instanceId, resetOpts)
      return {
        success: true,
        data: {
          username: defaultUser,
          password: password
        }
      }
    }

    // Fallback: generate random password (can't apply without instanceId)
    return {
      success: true,
      data: {
        username: defaultUser,
        password: generateRandomPassword()
      }
    }
  } catch (err) {
    const errorMessage = `Error setting VPS credentials: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

/**
 * OLD: createPleskResetLink(telegramId, vpsData) → { link }
 * NEW: Not available in Contabo API.
 */
async function createPleskResetLink(telegramId, vpsData) {
  console.log('[Contabo] Plesk password reset not available via Contabo API')
  return false
}

// ─── Auto-Renewal ─────────────────────────────────────────────────────────

/**
 * OLD: changeVpsAutoRenewal(telegramId, vpsDetails) → toggles auto renewal
 * NEW: Toggles in MongoDB AND immediately cancels on Contabo when disabling
 *      so the user doesn't get billed for an extra month if Contabo's prepaid
 *      billing has already triggered (root cause of past €30 leak charges).
 */
async function changeVpsAutoRenewal(telegramId, vpsDetails) {
  try {
    if (!_vpsPlansOf) return false

    const vpsId = vpsDetails._id || vpsDetails.vpsId
    const newValue = !vpsDetails.autoRenewable
    const contaboInstanceId = vpsDetails.contaboInstanceId

    const update = { autoRenewable: newValue }
    let needsContaboUncancel = false

    // ── BUG-B FIX: when DISABLING auto-renew, cancel on Contabo immediately ──
    // This makes Contabo set cancelDate to the END of the CURRENT paid period
    // (= our end_time). Waiting until the 5h-before-expiry pre-emptive cancel
    // was too late: Contabo had already invoiced the next month, so cancelDate
    // landed one period later and the user was billed an extra month.
    if (newValue === false && contaboInstanceId) {
      // ── Provider-aware guard ──
      // Vultr, DigitalOcean & Azure have no scheduled cancel — `cancelInstance`
      // would IMMEDIATELY DESTROY the running VPS the moment the user
      // toggles auto-renew OFF. For these providers we skip the provider
      // call entirely and rely on the DB-side `autoRenewable=false` flag
      // (the renewal scheduler already honours it).
      const _provName = vpsProvider.detectProviderByInstanceId(contaboInstanceId)
        || (vpsDetails.provider || '').toLowerCase()
      if (vpsProvider.isDestructiveCancelProvider(_provName)) {
        console.log(`[VPS] auto-renew OFF for ${_provName} instance ${contaboInstanceId} — skipping provider cancelInstance (would be destructive); DB flag is sufficient`)
        update.cancelReason = `auto_renew_disabled_by_user_${_provName}_db_only`
      } else {
        try {
          const live = await contabo.getInstance(contaboInstanceId).catch(() => null)
          if (live && !live.cancelDate) {
            await contabo.cancelInstance(contaboInstanceId)
            // Re-fetch to capture the cancelDate (Contabo can take a few seconds)
            let confirmed = null
            for (let attempt = 1; attempt <= 3; attempt++) {
              await new Promise(r => setTimeout(r, 3000))
              try {
                const post = await contabo.getInstance(contaboInstanceId)
                if (post?.cancelDate) { confirmed = post.cancelDate; break }
              } catch (_) { /* getInstance can briefly 404 during cancel-propagation — keep polling */ }
            }
            if (confirmed) {
              update._contaboCancelledEarly = true
              update.contaboCancelDate = confirmed
              update.cancelledAt = new Date()
              update.cancelReason = 'auto_renew_disabled_by_user'
              console.log(`[VPS] User ${telegramId} disabled auto-renew → Contabo cancelled. cancelDate=${confirmed}`)
            } else {
              console.log(`[VPS] User ${telegramId} disabled auto-renew → Contabo cancel call returned but cancelDate not yet visible; will retry from scheduler.`)
            }
          } else if (live?.cancelDate) {
            // Already cancelled on Contabo (could happen if scheduler cancelled first)
            update._contaboCancelledEarly = true
            update.contaboCancelDate = live.cancelDate
          }
        } catch (cancelErr) {
          console.log(`[VPS] Contabo cancel-on-disable failed for ${contaboInstanceId}: ${cancelErr.message}`)
          // Don't fail the toggle — DB update still proceeds so scheduler can retry.
        }
      }
    }

    // ── NEW: when RE-ENABLING auto-renew after an early Contabo cancel,
    // clear the cancel flags in our DB and flag the record so the daily
    // drift check / immediate caller can ask admin to "Resume Subscription"
    // on the Contabo dashboard (Contabo's API exposes no un-cancel endpoint).
    // The user sees auto-renew as ON and the VPS keeps working normally —
    // they don't need to know about the dashboard step.
    if (newValue === true && vpsDetails._contaboCancelledEarly) {
      update._contaboCancelledEarly = false
      update._uncancelPending = true
      update._uncancelPendingSince = new Date()
      update.cancelledAt = null
      update.cancelReason = null
      needsContaboUncancel = true
      console.log(`[VPS] User ${telegramId} re-enabled auto-renew on ${contaboInstanceId} — admin un-cancel needed on Contabo dashboard`)
    }

    await _vpsPlansOf.updateOne(
      { chatId: String(telegramId), vpsId: String(vpsId) },
      { $set: update }
    )

    return {
      autoRenewable: newValue,
      contaboCancelDate: update.contaboCancelDate || null,
      needsContaboUncancel,
      contaboInstanceId
    }
  } catch (err) {
    console.log('Error in changeVpsAutoRenewal (contabo):', err.message || err)
    return false
  }
}

// ─── Upgrades ─────────────────────────────────────────────────────────────

/**
 * OLD: fetchVpsUpgradeOptions(telegramId, vpsId, upgradeType) → array of upgrade options
 * NEW: Returns higher-tier products from Contabo catalog.
 */
async function fetchVpsUpgradeOptions(telegramId, vpsId, upgradeType = 'vps') {
  try {
    // Get current instance details
    const vpsDetails = await fetchVPSDetails(telegramId, vpsId)
    if (!vpsDetails) return false

    const isRDP = vpsDetails.isRDP || false
    const region = vpsDetails.region || 'EU'

    // OS-aware: pricing/catalog must come from the SAME provider that runs
    // the instance (e.g. Azure has B1ms/B2s/B2ms; DO has s-1vcpu-1gb/...).
    // Per-instance ops still flow via dispatchByInstanceId for the actual
    // resize; this only picks the catalog used to render the upgrade menu.
    const upgradeProvider = vpsProvider.pickProviderForOs(isRDP)

    const currentProduct = upgradeProvider.getProduct(vpsDetails.productId)
    if (!currentProduct) return false
    // Providers without a resize API (DO Windows RDP) offer no in-place upgrades.
    if (typeof upgradeProvider.upgradeInstance !== 'function') return []

    if (upgradeType === 'vps' || upgradeType === 'plan') {
      // Return higher-tier products of the same disk type
      const allProducts = upgradeProvider.listProducts(region, isRDP, currentProduct.diskType)
      const upgrades = allProducts.filter(p => p.tier > currentProduct.tier)

      return upgrades.map(p => ({
        _id: p.productId,
        from: currentProduct.name,
        to: p.name,
        fromTier: currentProduct.tier,
        toTier: p.tier,
        currentPrice: upgradeProvider.calculatePrice(currentProduct, region, isRDP).totalWithMarkup,
        monthlyPrice: p.pricing.totalWithMarkup,
        priceDifference: Math.round((p.pricing.totalWithMarkup - upgradeProvider.calculatePrice(currentProduct, region, isRDP).totalWithMarkup) * 100) / 100,
        specs: upgradeProvider.formatSpecs(p),
        cpuCores: p.cpuCores,
        ramGb: p.ramGb,
        diskGb: p.diskGb,
        diskType: p.diskType,
        billingCycle: 'Monthly'
      }))
    } else if (upgradeType === 'disk') {
      // Switch disk type: NVMe ↔ SSD
      const otherDiskType = currentProduct.diskType === 'nvme' ? 'ssd' : 'nvme'
      const sametierProduct = (otherDiskType === 'ssd' ? upgradeProvider.PRODUCT_CATALOG_SSD : upgradeProvider.PRODUCT_CATALOG)
        .find(p => p.tier === currentProduct.tier)

      if (!sametierProduct) return []

      const pricing = upgradeProvider.calculatePrice(sametierProduct, region, isRDP)
      return [{
        _id: sametierProduct.productId,
        from: currentProduct.name,
        to: sametierProduct.name,
        monthlyPrice: pricing.totalWithMarkup,
        specs: upgradeProvider.formatSpecs(sametierProduct),
        diskType: otherDiskType
      }]
    }

    return []
  } catch (err) {
    console.log('Error in fetchVpsUpgradeOptions (contabo):', err.message || err)
    return false
  }
}

/**
 * OLD: getVpsUpgradePrice(vpsDetails) → price number
 * NEW: Returns monthly price of the upgrade target.
 */
const getVpsUpgradePrice = (vpsDetails) => {
  return vpsDetails.upgradeOption?.monthlyPrice || vpsDetails.totalPrice || 0
}

/**
 * OLD: upgradeVPSPlanType(telegramId, vpsDetails) → { success, data }
 * NEW: Uses Contabo in-place upgrade API.
 */
async function upgradeVPSPlanType(telegramId, vpsDetails) {
  try {
    const instanceId = vpsDetails.contaboInstanceId || vpsDetails._id
    const newProductId = vpsDetails.upgradeOption?._id || vpsDetails.newProductId

    if (!newProductId) return { error: 'No upgrade target specified' }

    const result = await contabo.upgradeInstance(instanceId, newProductId)

    // Update MongoDB record
    if (_vpsPlansOf) {
      const newProduct = contabo.getProduct(newProductId)
      await _vpsPlansOf.updateOne(
        { vpsId: String(vpsDetails._id) },
        { $set: {
          productId: newProductId,
          planPrice: vpsDetails.totalPrice
        }}
      )
    }

    return {
      success: true,
      data: {
        price: vpsDetails.totalPrice,
        productId: newProductId,
        ...result
      }
    }
  } catch (err) {
    const errorMessage = `Error upgrading VPS plan: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

/**
 * OLD: upgradeVPSDiskType(telegramId, vpsDetails) → { success, data }
 * NEW: Uses Contabo in-place upgrade API (NVMe ↔ SSD swap).
 */
async function upgradeVPSDiskType(telegramId, vpsDetails) {
  try {
    const instanceId = vpsDetails.contaboInstanceId || vpsDetails._id
    const newProductId = vpsDetails.upgradeOption?._id || vpsDetails.newProductId

    if (!newProductId) return { error: 'No disk upgrade target specified' }

    const result = await contabo.upgradeInstance(instanceId, newProductId)

    // Update MongoDB record
    if (_vpsPlansOf) {
      await _vpsPlansOf.updateOne(
        { vpsId: String(vpsDetails._id) },
        { $set: {
          productId: newProductId,
          planPrice: vpsDetails.totalPrice
        }}
      )
    }

    return {
      success: true,
      data: {
        subscription: { price: vpsDetails.totalPrice },
        productId: newProductId,
        ...result
      }
    }
  } catch (err) {
    const errorMessage = `Error upgrading VPS disk type: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

// ─── Renewal ──────────────────────────────────────────────────────────────

/**
 * OLD: renewVPSPlan(telegramId, subscriptionId) → { success, data }
 * NEW: Extends the end_time in MongoDB by 1 month. Contabo handles its own billing.
 */
async function renewVPSPlan(telegramId, subscriptionId) {
  try {
    if (!_vpsPlansOf) return { error: 'Database not available' }

    const record = await _vpsPlansOf.findOne({ vpsId: String(subscriptionId) })
    if (!record) return { error: 'VPS record not found' }

    const currentEnd = new Date(record.end_time)
    const newEnd = new Date(currentEnd)
    newEnd.setMonth(newEnd.getMonth() + 1)

    const wasEarlyCancelled = !!record._contaboCancelledEarly
    const update = {
      end_time: newEnd,
      status: 'RUNNING',
      _autoRenewAttempted: false,
      _reminder3DaySent: false,
      _reminder1DaySent: false
    }
    const unset = {}

    // A renewal always clears any 3-day grace state (DigitalOcean-RDP): the
    // customer is back in good standing, so the box must leave EXPIRED_GRACE and
    // not be swept for deletion. Unsetting fields that don't exist is a no-op.
    unset.expired_at = ''
    unset.grace_until = ''
    unset._graceReminderSent = ''
    unset.deleteRetryCount = ''
    unset.lastDeleteError = ''
    unset.lastDeleteAlertAt = ''

    // If the plan was previously cancelled-early on Contabo (e.g. wallet
    // deduct failed at T-24h and we proactively cancelled), this manual
    // renewal means the customer is back in good standing. Clear our cancel
    // flags so the next cycle proceeds normally. Contabo's API can't
    // un-cancel — flag _uncancelPending so admin resumes the subscription
    // from my.contabo.com. User-facing UX is unchanged: they just see the
    // new expiry date.
    let needsContaboUncancel = false
    if (wasEarlyCancelled) {
      unset._contaboCancelledEarly = ''
      unset.cancelReason = ''
      unset.cancelledAt = ''
      unset._selfHealAttemptedAt = ''
      unset._selfHealReason = ''
      update._uncancelPending = true
      update._uncancelPendingSince = new Date()
      needsContaboUncancel = true
      console.log(`[VPS] Manual renewal for ${subscriptionId} — admin un-cancel needed on Contabo dashboard (was early-cancelled)`)
    }

    const mongoUpdate = { $set: update }
    if (Object.keys(unset).length) mongoUpdate.$unset = unset
    await _vpsPlansOf.updateOne({ vpsId: String(subscriptionId) }, mongoUpdate)

    // DigitalOcean-RDP: tell the provider to power the box back on + clear its
    // own doRdpServers grace fields (svc.renewInstance handles both). Other
    // providers manage renewal on their side / via the scheduler.
    try {
      if (vpsProvider.detectProviderByInstanceId(record.contaboInstanceId) === 'digitalocean-rdp') {
        const prov = vpsProvider.getProviderForRecord(record)
        if (prov && typeof prov.renewInstance === 'function') {
          await prov.renewInstance(record.contaboInstanceId, Math.max(1, Number(record.durationMonths) || 1))
        }
      }
    } catch (e) { console.log(`[VPS] DO-RDP provider renew sync failed for ${subscriptionId}: ${e.message}`) }

    return {
      success: true,
      data: {
        subscriptionEnd: newEnd.toISOString(),
        plan: record.plan,
        planPrice: record.planPrice
      },
      needsContaboUncancel,
      contaboInstanceId: record.contaboInstanceId
    }
  } catch (err) {
    const errorMessage = `Error renewing VPS plan: ${err.message || JSON.stringify(err)}`
    console.error(errorMessage)
    return { error: errorMessage }
  }
}

/**
 * OLD: renewVPSCPanel(telegramId, subscriptionId) → { success, data }
 * NEW: Not available in Contabo. Returns error.
 */
async function renewVPSCPanel(telegramId, subscriptionId) {
  return { error: 'cPanel renewal not available with current VPS provider' }
}

// ─── Email ────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_DOMAIN,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_AUTH_USER,
    pass: process.env.MAIL_AUTH_PASSWORD,
  },
})

/**
 * Send VPS credentials email. Adapted for Contabo data shape.
 * Handles both Linux (SSH) and Windows (RDP) credentials.
 */
async function sendVPSCredentialsEmail(info, response, vpsDetails, credentials) {
  // Skip email entirely when the user never provided one. Credentials are
  // delivered via Telegram regardless, so this is just supplementary.
  // Without this guard, nodemailer throws "No recipients defined" which
  // pollutes logs but is non-fatal (see Railway prod 2026-06-12 19:10:55
  // for TXN-20260612-097AA / chatId 7776668174).
  if (!info?.userEmail || typeof info.userEmail !== 'string' || !info.userEmail.includes('@')) {
    console.log(`[VPS Email] Skipped — no valid email on file for chatId ${info?.chatId || 'unknown'}`)
    return
  }
  const isRDP = vpsDetails.isRDP || vpsDetails.os?.isRDP || response.osType === 'Windows'
  const plan = isRDP ? 'RDP Plan' : 'VPS Plan'
  const connectionInfo = isRDP
    ? `<tr><td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
          <strong>🖥 RDP Connection:</strong> ${response.host}:3389
       </td></tr>`
    : `<tr><td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
          <strong>SSH Command:</strong> ssh ${credentials?.username || 'root'}@${response.host}
       </td></tr>`

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #007bff; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0;">🎉 Congratulations!</h1>
        </div>
        <div style="padding: 10px 20px; background-color: #f9f9f9; border-radius: 0 0 10px 10px;">
            <p style="font-size: 18px; line-height: 1.6;">
                Hello <strong>${info.username || 'User'}</strong>,
            </p>
            <p style="font-size: 18px; line-height: 1.6;">
                Your <strong style="text-transform: capitalize;">${plan}</strong> has been successfully activated!
            </p>
            <p style="font-size: 18px; line-height: 1.6; color: #007bff;">
                Here's your order summary:
            </p>
            <table style="width: 100%; margin-top: 10px; border-collapse: separate; border-spacing: 0 10px;">
              <tr>
                  <td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
                      <strong>Instance Name:</strong> ${response.name || response.vps_name}
                  </td>
              </tr>
              <tr>
                  <td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
                      <strong>IP Address:</strong> ${response.host}
                  </td>
              </tr>
              ${connectionInfo}
              <tr>
                  <td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
                      <strong>OS:</strong> ${vpsDetails.os ? vpsDetails.os.name : (isRDP ? 'Windows Server 2025' : 'Linux')}
                  </td>
              </tr>
              <tr>
                  <td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
                      <strong>Username:</strong> ${credentials?.username || (isRDP ? 'admin' : 'root')}
                  </td>
              </tr>
              <tr>
                  <td style="font-size: 16px; padding: 15px; background-color: #eee; border: 1px solid #ddd; border-radius: 5px;">
                      <strong>Password:</strong> ${credentials?.password || 'Set during provisioning'}
                  </td>
              </tr>
            </table>
            <p style="font-size: 18px; margin-top: 10px; line-height: 1.6;">
                If you need any assistance, feel free to contact our support team.
            </p>
            <p style="font-size: 18px; line-height: 1.6; margin-top: 15px;">
                Best regards,<br>
                Nomadly Team
            </p>
        </div>
    </div>`

  try {
    const mailResponse = await transporter.sendMail({
      from: process.env.MAIL_SENDER,
      to: info.userEmail,
      subject: `🎉 Your ${plan} has been Activated!`,
      html: emailHtml,
    })
    console.log('VPS credentials email sent:', mailResponse.messageId)
  } catch (error) {
    console.error('Error sending VPS credentials email:', error)
  }
}

// ─── Expiry Date ──────────────────────────────────────────────────────────

const getExpiryDateVps = (plan) => {
  const now = new Date()
  let expiresAt
  switch (plan) {
    case 'Hourly':
      expiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000)
      break
    case 'Monthly':
      expiresAt = new Date(now)
      expiresAt.setMonth(expiresAt.getMonth() + 1)
      break
    case 'Quarterly':
    case 'Quaterly':  // keep old typo compatibility
      expiresAt = new Date(now)
      expiresAt.setMonth(expiresAt.getMonth() + 3)
      break
    case 'Annually':
      expiresAt = new Date(now)
      expiresAt.setFullYear(expiresAt.getFullYear() + 1)
      break
    default:
      expiresAt = new Date(now)
      expiresAt.setMonth(expiresAt.getMonth() + 1) // default monthly
      break
  }
  return expiresAt
}

// ─── Exports ──────────────────────────────────────────────────────────────
module.exports = {
  // DB initialization
  initVpsDb,

  // Region/Country/Zone (flattened for Contabo)
  fetchAvailableCountries,
  fetchAvailableRegionsOfCountry,
  fetchAvailableZones,

  // Disk types
  fetchAvailableDiskTpes,

  // VPS configs / plans
  fetchAvailableVPSConfigs,

  // OS images
  fetchAvailableOS,
  fetchSelectedCpanelOptions,

  // User registration (no-ops for Contabo)
  registerVpsTelegram,
  checkMissingEmailForNameword,
  addUserEmailForNameWord,

  // SSH keys
  fetchUserSSHkeyList,
  fetchUserSSHPrivateKeys,
  generateNewSSHkey,
  ensureManagedSSHKey,
  uploadSSHPublicKey,
  downloadSSHKeyFile,
  unlinkSSHKeyFromVps,

  // Instance CRUD
  createVPSInstance,
  attachSSHKeysToVM,
  fetchUserVPSList,
  fetchVPSDetails,
  changeVpsInstanceStatus,
  deleteVPSinstance,

  // Credentials
  setVpsSshCredentials,
  createPleskResetLink,

  // Auto-renewal
  changeVpsAutoRenewal,

  // Upgrades
  fetchVpsUpgradeOptions,
  getVpsUpgradePrice,
  upgradeVPSPlanType,
  upgradeVPSDiskType,

  // Renewal
  renewVPSPlan,
  renewVPSCPanel,

  // Email
  sendVPSCredentialsEmail,

  // Utility
  getExpiryDateVps,
  generateRandomName,
  generateRandomPassword
}
