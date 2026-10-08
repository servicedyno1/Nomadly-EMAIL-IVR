/* global process */
require('dotenv').config()
const { log } = require('console')
const { checkDomainPriceOnline } = require('./cr-domain-price-get')
const { buyDomainOnline } = require('./cr-domain-register')
const opService = require('./op-service')
const cfService = require('./cf-service')

/**
 * Strip internal provider names from error messages before they reach users.
 * Keeps the meaningful error description while removing brand references.
 */
const sanitizeErrorForUser = (errorMsg) => {
  if (!errorMsg || typeof errorMsg !== 'string') return 'Domain registration failed. Please try again or contact support.'
  return errorMsg
    .replace(/OpenProvider/gi, 'registrar')
    .replace(/ConnectReseller/gi, 'registrar')
    .replace(/Connect Reseller/gi, 'registrar')
    .replace(/\bTwilio\b/gi, 'Speechcue')
    .replace(/\bTelnyx\b/gi, 'Speechcue')
    .replace(/\bOP\b/g, 'registrar')
    .replace(/\bCR\b/g, 'registrar')
}

/**
 * Unified Domain Service
 * - CR first, fallback to OP for availability/pricing
 * - Supports: provider_default, cloudflare, custom nameservers
 * - Routes DNS ops to correct API based on stored metadata
 */

// ─── Domain check ───────────────────────────────────────

const checkDomainPrice = async (domainName, db) => {
  // Check both registrars in parallel for speed
  log(`[domain-service] Checking ${domainName} on CR + OP in parallel...`)
  const [crResult, opResult] = await Promise.allSettled([
    checkDomainPriceOnline(domainName),
    opService.checkDomainAvailability(domainName),
  ])

  const cr = crResult.status === 'fulfilled' ? crResult.value : { available: false, message: crResult.reason?.message }
  const op = opResult.status === 'fulfilled' ? opResult.value : { available: false, message: opResult.reason?.message }

  // When both registrars have the domain:
  // Show the HIGHER price to the user (worst-case), try the cheaper registrar first.
  // If cheaper registrar succeeds → user saves the difference.
  // If cheaper registrar fails → fallback to expensive one, user pays exactly what was shown.
  if (cr.available && op.available) {
    const cheaper = cr.price <= op.price ? cr : op
    const expensive = cr.price <= op.price ? op : cr
    const cheaperRegistrar = cheaper === cr ? 'ConnectReseller' : 'OpenProvider'
    const expensiveRegistrar = expensive === cr ? 'ConnectReseller' : 'OpenProvider'
    log(`[domain-service] ${domainName} available on both — CR: $${cr.price}, OP: $${op.price} → showing $${expensive.price} (${expensiveRegistrar}), trying ${cheaperRegistrar} @ $${cheaper.price} first`)
    return {
      available: true, price: expensive.price,
      originalPrice: expensive.originalPrice,
      registrar: cheaperRegistrar,
      expensiveRegistrar,
      cheaperPrice: cheaper.price,
      cheaperRegistrar,
      message: expensive.message || 'Domain is available',
    }
  }

  if (cr.available) {
    log(`[domain-service] ${domainName} available on ConnectReseller only @ $${cr.price}`)
    return {
      available: true, price: cr.price,
      originalPrice: cr.originalPrice, registrar: 'ConnectReseller',
      cheaperPrice: null, cheaperRegistrar: null, expensiveRegistrar: null,
      message: cr.message,
    }
  }

  if (op.available) {
    log(`[domain-service] ${domainName} available on OpenProvider only @ $${op.price}`)
    return {
      available: true, price: op.price,
      originalPrice: op.originalPrice, registrar: 'OpenProvider',
      cheaperPrice: null, cheaperRegistrar: null, expensiveRegistrar: null,
      message: 'Domain is available',
    }
  }

  return {
    available: false, price: 0, originalPrice: 0, registrar: null,
    cheaperPrice: null, cheaperRegistrar: null, expensiveRegistrar: null,
    message: 'Domain name not available, please try another domain name',
  }
}

/**
 * Check multiple TLD alternatives in parallel
 */
const checkAlternativeTLDs = async (baseName, db) => {
  const tlds = ['com', 'net', 'org', 'io', 'co', 'de', 'fr', 'it', 'xyz', 'sbs', 'app', 'dev']
  const checks = tlds.map(tld => {
    const domain = `${baseName}.${tld}`
    return checkDomainPrice(domain, db).then(r => ({ domain, ...r })).catch(() => ({ domain, available: false }))
  })
  const results = await Promise.allSettled(checks)
  return results
    .filter(r => r.status === 'fulfilled' && r.value.available)
    .map(r => r.value)
    .sort((a, b) => a.price - b.price)
    .slice(0, 5) // Top 5 cheapest
}

// ─── Domain registration ────────────────────────────────

/**
 * @param {string} nsChoice - 'provider_default', 'cloudflare', or 'custom'
 * @param {string[]} customNS - custom nameservers (only when nsChoice === 'custom')
 */
const registerDomain = async (domainName, registrar, nsChoice, db, chatId, customNS, onProgress) => {
  let result
  let nameservers = []
  let cfZoneId = null
  const originalRegistrar = registrar
  let actualPrice = null

  // Determine nameservers based on choice
  if (nsChoice === 'cloudflare') {
    log(`[domain-service] Creating Cloudflare zone for ${domainName}...`)
    let cfResult = await cfService.createZone(domainName)
    // ── Retry once on transient failure before downgrading to provider_default.
    //    Previously a single transient CF error silently downgraded the user's
    //    choice → produced the @HHR2009 / rsvpeviteopen.org broken state where
    //    domainsOf had nameserverType=provider_default but a later shortener
    //    activation created an orphan CF zone, with OP NS still on
    //    ns*.openprovider.* — domain never reached Cloudflare. See
    //    /app/scripts/heal_rsvpeviteopen_org.js for the user-level fix.
    if (!cfResult.success) {
      log(`[domain-service] Cloudflare zone creation failed (attempt 1), retrying once:`, cfResult.errors)
      await new Promise(r => setTimeout(r, 1500))
      cfResult = await cfService.createZone(domainName)
    }
    if (cfResult.success) {
      nameservers = cfResult.nameservers || []
      cfZoneId = cfResult.zoneId
      log(`[domain-service] Cloudflare zone created. NS: ${nameservers.join(', ')}`)
    } else {
      // Hard failure after retry — abort registration instead of silently
      // downgrading. Caller charges the user only on success, so user is not
      // charged in this branch (buyResult.error path).
      log(`[domain-service] Cloudflare zone creation FAILED after retry — aborting registration for ${domainName}:`, cfResult.errors)
      return { error: 'Cloudflare zone could not be created. Your card was NOT charged. Please retry in a few minutes or pick a different nameserver option.' }
    }
  } else if (nsChoice === 'custom' && customNS && customNS.length >= 2) {
    nameservers = customNS
    log(`[domain-service] Using custom NS: ${nameservers.join(', ')}`)
  }

  // ── Pre-delegation NAST gate (.de, .nl, .se, .fi, .be, .ch, .ie, .it, .eu,
  //    .at, .li, .dk, .cz, .no) ────────────────────────────────────────────
  // DENIC and similar registries run a Nameserver Pre-Delegation Check (NAST)
  // before publishing the delegation. The NS sent in our register API call
  // MUST already respond authoritatively (AA=1) for the domain at submit
  // time. If they don't, OP silently keeps the parking ns_group binding and
  // the registry never publishes our CF NS — which is the exact root cause
  // of the 5 prod-stuck domains (inviowelcoparty.de, rsvpcrumelbell.de,
  // rsvpeviteguestview.de + 2 .com that had moved CF zones).
  //
  // Cloudflare's zone normally answers authoritatively within ~30-60s of
  // createZone() returning. We poll up to 90s here; if it doesn't come
  // online we abort the whole registration (no charge) instead of registering
  // a known-broken delegation.
  const PRE_DELEGATION_TLDS = new Set([
    'de','nl','se','fi','be','ch','ie','it','eu','at','li','dk','cz','no'
  ])
  const tld = (domainName.split('.').pop() || '').toLowerCase()
  if (PRE_DELEGATION_TLDS.has(tld) && nameservers.length >= 2) {
    log(`[domain-service] .${tld} is a pre-delegation TLD — running NAST pre-flight check on [${nameservers.join(', ')}]`)
    // UX: tell the user we're waiting on the registry pre-check — otherwise
    // they sit watching a "processing…" message for up to 90s without context.
    try { onProgress?.('verifying', { tld }) } catch (_) { /* progress callback is best-effort */ }
    const nast = await opService.checkNsAuthoritative(domainName, nameservers, 90000)
    log(`[domain-service] NAST: ready=${nast.ready} authoritativeCount=${nast.authoritativeCount}/${nameservers.length} elapsed=${nast.elapsedMs}ms`)
    if (!nast.ready) {
      const detail = nast.perNs.map((n) => `${n.ns}=${n.aa ? 'AA' : 'noAA'}(${n.error || 'ok'})`).join(', ')
      log(`[domain-service] ❌ NAST pre-flight FAILED for ${domainName}: ${detail}`)
      return {
        error: `Nameserver pre-check failed for .${tld}. ${nast.authoritativeCount}/${nameservers.length} nameservers are authoritative. The registry would reject this delegation. Your card was NOT charged — please retry in a couple of minutes.`,
      }
    }
    log(`[domain-service] ✅ NAST pre-flight passed for ${domainName} in ${nast.elapsedMs}ms`)
    try { onProgress?.('verified', { tld, elapsedMs: nast.elapsedMs }) } catch (_) { /* best-effort */ }
  }

  if (registrar === 'ConnectReseller') {
    const ns1 = nameservers.length >= 1 ? nameservers[0] : undefined
    const ns2 = nameservers.length >= 2 ? nameservers[1] : undefined
    result = await buyDomainOnline(domainName, ns1, ns2)
    if (result.success) {
      log(`[domain-service] ${domainName} registered on ConnectReseller with NS: ${ns1 || 'default'}, ${ns2 || 'default'}`)
    } else {
      // Fallback to OpenProvider when ConnectReseller fails (insufficient balance, API error, etc.)
      log(`[domain-service] ConnectReseller failed for ${domainName}: ${result.error} — falling back to OpenProvider`)

      // Re-check OP price before fallback registration to ensure accurate billing
      try {
        const opPriceCheck = await opService.checkDomainAvailability(domainName)
        if (opPriceCheck?.available && opPriceCheck.price) {
          actualPrice = opPriceCheck.price
          log(`[domain-service] OP fallback price for ${domainName}: $${actualPrice}`)
        }
      } catch (priceErr) {
        log(`[domain-service] OP price re-check failed for ${domainName}: ${priceErr.message} — proceeding without price update`)
      }

      const ns = (nsChoice === 'cloudflare' || nsChoice === 'custom') ? nameservers : []
      log(`[domain-service] Fallback OP registration for ${domainName} with NS: ${ns.length > 0 ? ns.join(', ') : 'provider_default (OP built-in)'}`)
      result = await opService.registerDomain(domainName, ns)
      if (result.success) {
        registrar = 'OpenProvider'
        log(`[domain-service] ${domainName} registered on OpenProvider via fallback (ID: ${result.domainId})`)
      }
    }
  } else if (registrar === 'OpenProvider') {
    // Pass CF/custom NS if selected, otherwise empty → OP will use its built-in defaults
    const ns = (nsChoice === 'cloudflare' || nsChoice === 'custom') ? nameservers : []
    log(`[domain-service] Registering ${domainName} on OpenProvider with NS: ${ns.length > 0 ? ns.join(', ') : 'provider_default (OP built-in)'}`)
    result = await opService.registerDomain(domainName, ns)
    if (result.success) {
      log(`[domain-service] ${domainName} registered on OpenProvider (ID: ${result.domainId})`)
    }
  } else {
    return { error: 'Domain registration failed. Please try again or contact support.' }
  }

  if (result.error) return { error: sanitizeErrorForUser(result.error) }

  // Store metadata in MongoDB
  if (db) {
    try {
      await db.collection('domainsOf').updateOne(
        { domainName, chatId: String(chatId) },
        {
          $set: {
            registrar,
            nameserverType: nsChoice,
            cfZoneId: cfZoneId || null,
            opDomainId: result.domainId || null,
            customNS: nsChoice === 'custom' ? nameservers : null,
            // Persist the nameservers chosen at registration so the
            // Manage-Nameservers UI can show them immediately (without this
            // field, getDomainMeta().nameservers is [] and viewDNSRecords
            // can't prepend NS rows → user sees "No nameserver records found"
            // and thinks NS management is broken — see Leprechaun00 incident).
            nameservers: Array.isArray(nameservers) && nameservers.length ? nameservers : [],
            registeredAt: new Date(),
          },
        },
        { upsert: true }
      )
      log(`[domain-service] Stored metadata for ${domainName} in DB`)

      // ── Also persist registrar + provider in registeredDomains ──
      // The addon-domain-flow.js NS-delegation step reads
      // registeredDomains.val.registrar to decide whether to call
      // opService.updateNameservers(). Without this field, new domains
      // get "registrar unknown — skipping NS delegation" and DENIC
      // never delegates to Cloudflare. Bug first observed with
      // eventiestopart.de (chatId 7290657217, 2026-06-28).
      const regDomFields = {
        'val.registrar':  registrar,
        'val.provider':   registrar,
        'val.chatId':     String(chatId),
      }
      if (cfZoneId)          regDomFields['val.cfZoneId']        = cfZoneId
      if (result.domainId)   regDomFields['val.opDomainId']      = result.domainId
      if (nsChoice)          regDomFields['val.nameserverType']   = nsChoice
      if (Array.isArray(nameservers) && nameservers.length) {
        regDomFields['val.nameservers'] = nameservers
      }
      await db.collection('registeredDomains').updateOne(
        { _id: domainName },
        { $set: regDomFields },
        { upsert: true }
      ).catch(regErr => log(`[domain-service] registeredDomains upsert warning for ${domainName}: ${regErr.message}`))

    } catch (err) {
      log(`[domain-service] DB update error:`, err.message)
    }
  }

  return {
    success: true, registrar,
    nameservers: nsChoice !== 'provider_default' ? nameservers : [],
    cfZoneId, opDomainId: result.domainId || null,
    registrarChanged: registrar !== originalRegistrar,
    actualPrice: registrar !== originalRegistrar ? actualPrice : null,
  }
}

/**
 * Post-registration: update nameservers for custom NS or Cloudflare on CR domains
 */
const postRegistrationNSUpdate = async (domainName, registrar, nsChoice, nameservers, db) => {
  if (nsChoice === 'provider_default') return { success: true }
  if (!nameservers || nameservers.length < 2) return { success: true }

  if (registrar === 'ConnectReseller') {
    // CR: update ALL NS in one API call (avoids stale-state revert from one-at-a-time loop)
    const crResult = await updateAllNameservers(domainName, nameservers, db)
    if (crResult.error) return { error: crResult.error }
    return { success: true }
  } else if (registrar === 'OpenProvider') {
    // OP was already registered with the nameservers, but update if needed
    return await opService.updateNameservers(domainName, nameservers)
  }
  return { success: true }
}

// ─── Domain metadata ────────────────────────────────────

const getDomainMeta = async (domainName, db) => {
  if (!db) return null
  try {
    // First check domainsOf for inline metadata (new registrations)
    const inlineMeta = await db.collection('domainsOf').findOne(
      { domainName },
      { projection: { _id: 0 } }
    )
    if (inlineMeta) return inlineMeta

    // Fallback: check registeredDomains for migrated/legacy domains
    const regDoc = await db.collection('registeredDomains').findOne({ _id: domainName })
    if (regDoc?.val) {
      return {
        domainName: regDoc.val.domain || domainName,
        registrar: regDoc.val.registrar || regDoc.val.provider || null,
        nameserverType: regDoc.val.nameserverType || null,
        cfZoneId: regDoc.val.cfZoneId || null,
        opDomainId: regDoc.val.opDomainId || null,
        nameservers: regDoc.val.nameservers || [],
        ownerChatId: regDoc.val.ownerChatId || null,
      }
    }

    return null
  } catch (err) {
    log(`[domain-service] getDomainMeta error:`, err.message)
    return null
  }
}

/**
 * resolveZoneMeta — resolve the registrable/zone metadata for a HOST.
 *
 * For an exact registered domain this is just getDomainMeta(host). For a
 * SUBDOMAIN of a domain we manage (e.g. go.namewords.sbs under namewords.sbs),
 * getDomainMeta(host) is null — but the subdomain still lives in the PARENT's
 * Cloudflare zone. This walks the parent suffixes and returns the parent zone's
 * metadata (cfZoneId etc.) so DNS records for the subdomain are written into the
 * correct zone (record name stays the full host). Falls back to a live Cloudflare
 * zone lookup when DB metadata is missing. Returns null if nothing is found.
 *
 * Returns the meta object augmented with { zoneHost, isSubdomain }.
 */
const resolveZoneMeta = async (host, db) => {
  const h = String(host || '').toLowerCase().replace(/\.$/, '')
  if (!h) return null
  const registrable = (m) => m && (m.cfZoneId || m.nameserverType || m.registrar)

  // 1. Exact registered domain.
  const exact = await getDomainMeta(h, db)
  if (registrable(exact)) return { ...exact, zoneHost: exact.domainName || h, isSubdomain: false }

  const parts = h.split('.').filter(Boolean)
  // 2. Walk parent suffixes (skip the host itself; stop before the bare TLD).
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.')
    const meta = await getDomainMeta(parent, db)
    if (registrable(meta)) return { ...meta, zoneHost: parent, isSubdomain: true }
  }
  // 3. Last resort: a zone that exists on our Cloudflare account. Start at the
  //    host itself (covers an apex whose DB meta is missing/unavailable) and
  //    walk up the parent suffixes; stop before the bare TLD.
  for (let i = 0; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join('.')
    try {
      const zone = await cfService.getZoneByName(cand)
      if (zone && zone.id) {
        return { domainName: cand, cfZoneId: zone.id, nameserverType: 'cloudflare', nameservers: zone.name_servers || [], zoneHost: cand, isSubdomain: cand !== h }
      }
    } catch (_) { /* ignore and fall through */ }
  }
  return exact || null
}


/**
 * Detect which registrar actually owns a domain by probing both APIs in
 * parallel. Used as a fallback whenever local metadata is missing or wrong
 * (e.g. legacy docs without a registrar field, or mis-tagged migrations).
 *
 * Returns one of: 'OpenProvider', 'ConnectReseller', or null when neither
 * registrar can find the domain.
 *
 * Side effect: when a registrar is detected, the result is persisted back to
 * both `domainsOf` and `registeredDomains` so the next call hits the right API
 * directly without re-probing.
 */
const detectRegistrarForDomain = async (domainName, db) => {
  log(`[domain-service] Auto-detecting registrar for ${domainName}...`)

  // Probe OP and CR in parallel
  let crProbe
  try {
    const getDomainDetails = require('./cr-domain-details-get')
    crProbe = getDomainDetails(domainName)
  } catch (e) {
    crProbe = Promise.resolve(null)
  }
  const [opRes, crRes] = await Promise.allSettled([
    opService.getDomainInfo(domainName),
    crProbe,
  ])

  const opInfo = opRes.status === 'fulfilled' ? opRes.value : null
  const crDetails = crRes.status === 'fulfilled' ? crRes.value : null
  const crHasDomain = !!(crDetails?.responseData?.domainNameId)

  let detected = null
  let extraFields = {}
  if (opInfo?.domainId) {
    detected = 'OpenProvider'
    extraFields.opDomainId = opInfo.domainId
  } else if (crHasDomain) {
    detected = 'ConnectReseller'
  }

  if (!detected) {
    log(`[domain-service] ${domainName} not found at OP or CR — cannot auto-detect`)
    return null
  }

  log(`[domain-service] ${domainName} detected at ${detected} — persisting to DB`)
  if (db) {
    try {
      await db.collection('domainsOf').updateOne(
        { domainName },
        { $set: { registrar: detected, ...extraFields } },
        { upsert: false }
      )
      await db.collection('registeredDomains').updateOne(
        { _id: domainName },
        { $set: { 'val.registrar': detected, ...(extraFields.opDomainId ? { 'val.opDomainId': extraFields.opDomainId } : {}) } },
        { upsert: false }
      )
    } catch (persistErr) {
      log(`[domain-service] registrar persist error for ${domainName}: ${persistErr.message}`)
    }
  }
  return detected
}

// ─── Registrar resolution (auto-heal mis-tagged / missing) ──
//
// Some domains in the DB have `val.registrar` set to one of these sentinel
// values instead of the canonical 'OpenProvider' / 'ConnectReseller' or the
// verified-external 'external_unmanaged'. The most common offender is the
// legacy literal `'external'` written by older "Connect External Domain"
// flows (which historically forgot to verify whether the domain was
// actually in our OP/CR account before tagging). null / undefined / '' /
// 'unknown' / 'manual' / 'none' come from various older migrations.
//
// When any downstream registrar-routing path (NS update, renewal, transfer,
// DNSSEC fix) reads one of these values, it MUST first probe both APIs
// to learn the true registrar — otherwise the code paths that do
// `meta.registrar || 'ConnectReseller'` silently route to CR and then fail
// with "Could not find domain at registrar" even though the domain is at OP.
//
// Once a probe confirms the domain is NOT in our OP/CR account, the tag is
// upgraded to 'external_unmanaged' which is treated as definitive (no
// re-probe) — so truly external domains don't pay the API-call tax on every
// management read.
const REGISTRAR_SENTINELS = new Set([
  '', 'external', 'unknown', 'manual', 'none', 'null', 'undefined',
])
const DEFINITIVE_REGISTRARS = new Set([
  'openprovider', 'connectreseller', 'external_unmanaged',
])

/**
 * Returns true when the given registrar value is NOT definitive — i.e.
 * callers should auto-detect. A value of 'external_unmanaged' is treated
 * as definitive (we already probed and confirmed it's not in our account).
 */
const isRegistrarUnclear = (value) => {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return true
  const v = value.trim().toLowerCase()
  if (!v) return true
  if (DEFINITIVE_REGISTRARS.has(v)) return false
  return REGISTRAR_SENTINELS.has(v)
}

/**
 * Resolve a definitive registrar for a domain. If the stored value is
 * missing or one of the sentinel values listed above, this calls
 * `detectRegistrarForDomain` (which probes OP + CR and persists the
 * result). When the probe finds nothing, the tag is upgraded to
 * 'external_unmanaged' so the next read is a no-op.
 *
 * @param {string} domainName
 * @param {object} db          — MongoDB client
 * @param {object} [meta]      — pre-fetched meta from getDomainMeta (optional)
 * @returns {Promise<{registrar:string|null, meta:object|null, healed:boolean}>}
 */
const resolveRegistrar = async (domainName, db, meta) => {
  if (!meta) meta = await getDomainMeta(domainName, db)
  const current = meta?.registrar
  if (!isRegistrarUnclear(current)) {
    return { registrar: current, meta, healed: false }
  }
  log(`[domain-service] resolveRegistrar: ${domainName} has unclear registrar="${current}" — probing OP/CR`)
  const detected = await detectRegistrarForDomain(domainName, db)
  if (!detected) {
    // Two distinct sub-cases here:
    //   1. User declared this domain as 'external' (or one of the explicit
    //      sentinels meaning "user-supplied, not ours") → upgrade tag to
    //      'external_unmanaged' so future reads skip the probe.
    //   2. Tag was simply missing (null/undefined/'') → return null and let
    //      the caller surface the legacy "Could not find domain at registrar"
    //      error. We do NOT upgrade in this case because the missing tag may
    //      reflect a transient race during registration; tagging it
    //      'external_unmanaged' would hide a real bug.
    const wasDeclaredExternal = typeof current === 'string'
      && ['external', 'unknown', 'manual', 'none'].includes(current.trim().toLowerCase())
    if (wasDeclaredExternal && db) {
      try {
        await db.collection('domainsOf').updateOne(
          { domainName },
          { $set: { registrar: 'external_unmanaged' } },
          { upsert: false }
        )
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.registrar': 'external_unmanaged' } },
          { upsert: false }
        )
        log(`[domain-service] resolveRegistrar: ${domainName} not at OP/CR — upgraded tag to 'external_unmanaged'`)
      } catch (persistErr) {
        log(`[domain-service] resolveRegistrar persist error for ${domainName}: ${persistErr.message}`)
      }
      return { registrar: 'external_unmanaged', meta, healed: false }
    }
    return { registrar: null, meta, healed: false }
  }
  // Re-read so opDomainId etc. are populated for the caller
  const freshMeta = (await getDomainMeta(domainName, db)) || meta
  return { registrar: detected, meta: freshMeta, healed: true }
}

// ─── DNS operations (routing) ───────────────────────────

const viewDNSRecords = async (domainName, db) => {
  const meta = await getDomainMeta(domainName, db)

  // Cloudflare DNS — route to CF if nameserverType is 'cloudflare' OR if cfZoneId exists
  // (handles 'external' and other non-standard types that actually have a CF zone)
  const isCfManaged = (meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId
  if (isCfManaged) {
    const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
    const records = cfRecords.map(r => ({
      recordType: r.type,
      recordContent: r.content,
      recordName: r.name,
      cfRecordId: r.id,
      ttl: r.ttl,
      proxied: r.proxied,
      priority: r.priority ?? null,
    }))
    // Prepend nameservers as NS records (zone-level, not deletable via record API)
    let nameservers = meta.nameservers || []
    // Self-heal: if nameservers list is empty but we have a cfZoneId, fetch
    // the actual NS from Cloudflare and backfill the DB. This fixes the
    // "No nameserver records found" bug for domains that were registered
    // before the registration flow started persisting the nameservers field
    // into domainsOf.
    if ((!nameservers || nameservers.length === 0) && db) {
      try {
        const zone = await cfService.getZoneByName(domainName)
        if (zone?.name_servers?.length) {
          nameservers = zone.name_servers
          log(`[domain-service] Self-heal: backfilling ${domainName} nameservers ← CF (${nameservers.join(', ')})`)
          await db.collection('domainsOf').updateOne(
            { domainName },
            { $set: { nameservers } },
            { upsert: false }
          )
        }
      } catch (e) {
        log(`[domain-service] Self-heal NS lookup failed for ${domainName}: ${e.message}`)
      }
    }
    for (const ns of nameservers) {
      records.unshift({ recordType: 'NS', recordContent: ns, recordName: domainName, isNameserver: true })
    }
    // Normalize: if nameserverType wasn't 'cloudflare' but cfZoneId exists, fix the DB metadata
    if (meta.nameserverType !== 'cloudflare' && db) {
      log(`[domain-service] ${domainName} has cfZoneId but nameserverType='${meta.nameserverType}' — normalizing to 'cloudflare'`)
      await db.collection('domainsOf').updateOne({ domainName }, { $set: { nameserverType: 'cloudflare' } }, { upsert: false })
      await db.collection('registeredDomains').updateOne({ _id: domainName }, { $set: { 'val.nameserverType': 'cloudflare' } }, { upsert: false })
    }
    return { records, source: 'cloudflare', cfZoneId: meta.cfZoneId }
  }

  // Cloudflare NS but no zone yet — try to auto-create zone
  if (meta?.nameserverType === 'cloudflare' && !meta?.cfZoneId) {
    log(`[domain-service] ${domainName} has CF nameservers but no zone — auto-creating...`)
    const cfResult = await cfService.createZone(domainName)
    if (cfResult.success && cfResult.zoneId) {
      const newNS = cfResult.nameservers || []
      if (db) {
        // Update BOTH collections to keep metadata consistent
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.cfZoneId': cfResult.zoneId, 'val.nameservers': newNS } }
        )
        await db.collection('domainsOf').updateOne(
          { domainName },
          { $set: { cfZoneId: cfResult.zoneId, nameservers: newNS } },
          { upsert: false }
        )
      }
      const cfRecords = await cfService.listDNSRecords(cfResult.zoneId)
      const records = cfRecords.map(r => ({
        recordType: r.type,
        recordContent: r.content,
        recordName: r.name,
        cfRecordId: r.id,
        ttl: r.ttl,
        proxied: r.proxied,
      }))
      for (const ns of newNS) {
        records.unshift({ recordType: 'NS', recordContent: ns, recordName: domainName, isNameserver: true })
      }
      return { records, source: 'cloudflare', cfZoneId: cfResult.zoneId }
    }
    log(`[domain-service] ${domainName} CF zone auto-create failed, falling back to OP`)
  }

  // OpenProvider DNS (provider_default or custom)
  if (meta?.registrar === 'OpenProvider') {
    let dnsResult = await opService.listDNSRecords(domainName)
    
    // If zone returned empty or doesn't exist, try to create it first then re-list
    if (!dnsResult.records || dnsResult.records.length === 0) {
      const zoneReady = await opService.ensureDnsZone(domainName)
      if (zoneReady.created) {
        log(`[domain-service] Auto-created OP DNS zone for ${domainName}`)
        // Re-list after zone creation
        dnsResult = await opService.listDNSRecords(domainName)
      }
    }

    if (dnsResult.records && dnsResult.records.length > 0) {
      return {
        records: dnsResult.records.map(r => ({
          recordType: r.recordType,
          recordContent: r.recordContent,
          recordName: r.recordName,
          ttl: r.ttl,
          priority: r.priority,
        })),
        source: 'openprovider',
        opDomainId: meta.opDomainId,
      }
    }
    // Fallback: show nameserver info
    const info = await opService.getDomainInfo(domainName)
    if (info) {
      return {
        records: info.nameservers.map((ns, i) => ({
          recordType: 'NS', recordContent: ns, nsId: i + 1,
        })),
        source: 'openprovider',
        opDomainId: info.domainId,
      }
    }
    return { records: [], source: 'openprovider' }
  }

  // Default: ConnectReseller
  const viewCRDNS = require('./cr-view-dns-records')
  return { ...(await viewCRDNS(domainName)), source: 'connectreseller' }
}

const addDNSRecord = async (domainName, recordType, recordValue, hostName, db, priority, extraData, opts = {}) => {
  const meta = await getDomainMeta(domainName, db)

  // NS records on Cloudflare-managed domains → update nameservers at registrar instead
  if (recordType === 'NS' && (meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.registrar === 'OpenProvider') {
    log(`[domain-service] NS add on CF domain ${domainName} — updating nameservers at OpenProvider`)
    // Parse multiple NS values (user may send multiple lines or comma-separated)
    const nsValues = recordValue.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    const result = await opService.updateNameservers(domainName, nsValues)
    if (result.success) {
      // Check if NS changed from current CF zone — if so, create new CF zone
      const oldNS = (meta.nameservers || []).sort().join(',')
      const newNS = nsValues.sort().join(',')
      let newCfZoneId = meta.cfZoneId
      if (oldNS !== newNS) {
        log(`[domain-service] NS changed for ${domainName}, checking if new CF zone needed`)
        const cfResult = await cfService.createZone(domainName)
        if (cfResult.success && cfResult.zoneId) {
          newCfZoneId = cfResult.zoneId
        }
      }
      // Update DB with new nameservers and zone
      if (db) {
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.nameservers': nsValues, 'val.cfZoneId': newCfZoneId } }
        )
      }
      return { success: true }
    }
    return { error: result.error || 'Failed to update nameservers at registrar' }
  }

  if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId) {
    // GAP-2 FIX (2026-09): normalize the record name so the apex is reachable and a
    // fully-qualified name is never re-suffixed with the zone (Cloudflare rejected
    // "@.<domain>" → dns_add_failed, and the bare zone produced "<domain>.<domain>").
    //   • '@' | '' | the bare zone apex        → apex (name = domainName)
    //   • a name already ending in '.<domain>'  → used as-is (no double-append)
    //   • a bare label ('www')                  → '<label>.<domain>'
    const _hn = String(hostName == null ? '' : hostName).trim().replace(/\.$/, '')
    const _dn = String(domainName).toLowerCase()
    const _hnLower = _hn.toLowerCase()
    let name
    if (!_hn || _hn === '@' || _hnLower === _dn) name = domainName
    else if (_hnLower.endsWith('.' + _dn)) name = _hn
    else name = `${_hn}.${domainName}`
    // Proxied (orange-cloud) vs DNS-only (grey-cloud) decision.
    //
    // BUG FIX (@LevelupwithME assist-user04.com, 2026-07-06):
    // The DNS-Management "Add Record" user flow is on a register-only
    // domain where the user is pointing the domain at their OWN origin
    // server. Force-proxying it hides the origin — `dig` returns CF edge
    // IPs, not the user's IP — which reads as "the A record didn't
    // update". Callers can now opt out of proxying via `opts.proxied:
    // false` for that use case.
    //
    // Historic default preserved (proxied=true for A/AAAA/CNAME on CF
    // zones) so shortener CNAME + www-CNAME paths that rely on CF SSL
    // termination keep working unchanged. Explicit opt-out required.
    const isProxiable = ['A', 'AAAA', 'CNAME'].includes(recordType.toUpperCase())
    const shouldProxy = isProxiable && opts.proxied !== false
    const result = await cfService.createDNSRecord(meta.cfZoneId, recordType, name, recordValue, 300, shouldProxy, priority, extraData)

    // ── Stale / cross-account zone recovery ──
    //    If CF rejects with out_of_account (token has no rights on this zone),
    //    the stored cfZoneId is unusable. Two ways forward:
    //    (1) try to re-resolve the zone by domain name — maybe a NEW zone was
    //        created in our account since the stale id was cached;
    //    (2) clear the stale id so the next request takes a clean path.
    //    Either way return a clear message so the user knows what to do.
    if (result?.out_of_account) {
      log(`[domain-service] CF reports stale/cross-account zoneId for ${domainName}; attempting re-resolve`)
      try {
        const fresh = await cfService.getZoneByName(domainName)
        if (fresh && fresh.id && fresh.id !== meta.cfZoneId) {
          // Refresh DB with the real zoneId and retry once
          if (db) {
            await db.collection('registeredDomains').updateOne(
              { _id: domainName },
              { $set: { 'val.cfZoneId': fresh.id } }
            )
          }
          log(`[domain-service] refreshed cfZoneId for ${domainName}: ${meta.cfZoneId} → ${fresh.id}`)
          const retry = await cfService.createDNSRecord(fresh.id, recordType, name, recordValue, 300, shouldProxy, priority, extraData)
          if (retry?.success) return retry
        }
      } catch (e) {
        log(`[domain-service] zone re-resolve failed for ${domainName}: ${e.message}`)
      }
      // Clear the stale id so future calls bypass CF (will fall through to registrar DNS)
      if (db) {
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.cfZoneId': null, 'val._cfZoneIdStaleAt': new Date() } }
        )
      }
      return {
        error: `This domain's DNS zone (${meta.cfZoneId.slice(0,8)}…) is not in our Cloudflare account. ` +
               `Either the zone was deleted or it lives in a different CF account. ` +
               `Please re-add the domain via 🌐 Register Bulletproof Domain → 📂 My Domain Names → select domain → 🔧 DNS Management → 🔄 Manage Nameservers to recreate the CF zone.`,
      }
    }

    return result
  }

  if (meta?.registrar === 'OpenProvider') {
    return await opService.addDNSRecord(domainName, recordType, recordValue, hostName || domainName, priority, extraData)
  }

  // Default: ConnectReseller — SRV/CAA not supported
  if (['SRV', 'CAA'].includes(recordType.toUpperCase())) {
    return { error: 'SRV and CAA records are not supported with your current DNS provider. Switch to Cloudflare nameservers to use these record types.' }
  }
  const { saveServerInDomain } = require('./cr-dns-record-add')
  return await saveServerInDomain(domainName, recordValue, recordType, null, null, null, hostName, priority)
}

const updateDNSRecord = async (domainName, recordData, db) => {
  const meta = await getDomainMeta(domainName, db)

  if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId && recordData.cfRecordId) {
    return await cfService.updateDNSRecord(
      meta.cfZoneId, recordData.cfRecordId,
      recordData.recordType, recordData.recordName || domainName,
      recordData.recordValue, recordData.ttl || 300
    )
  }

  if (meta?.registrar === 'OpenProvider') {
    return await opService.updateDNSRecord(domainName, recordData, recordData.recordValue, recordData.recordType)
  }

  // Default: ConnectReseller
  const { updateDNSRecord: crUpdate } = require('./cr-dns-record-update')
  return await crUpdate(
    recordData.DNSZoneID, recordData.DNSZoneRecordID,
    domainName, recordData.recordType, recordData.recordValue,
    recordData.domainNameId, recordData.nsId, recordData.dnsRecords, recordData.hostName
  )
}

const deleteDNSRecord = async (domainName, recordData, db) => {
  const meta = await getDomainMeta(domainName, db)

  if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId && recordData.cfRecordId) {
    return await cfService.deleteDNSRecord(meta.cfZoneId, recordData.cfRecordId)
  }

  if (meta?.registrar === 'OpenProvider') {
    return await opService.deleteDNSRecord(domainName, recordData)
  }

  // Default: ConnectReseller
  const { deleteDNSRecord: crDelete } = require('./cr-dns-record-del')
  return await crDelete(
    recordData.DNSZoneID, recordData.DNSZoneRecordID,
    domainName, recordData.domainNameId, recordData.nsId, recordData.dnsRecords
  )
}

// ─── NS update (registrar-level) ────────────────────────

/**
 * Update ALL nameservers at the registrar in one operation.
 * For OP: calls opService.updateNameservers(domainName, nsArray).
 * For CR: looks up domainNameId via getDomainDetails, calls UpdateNameServer API with all NS.
 * Updates DB (both collections) with new NS array.
 */
const updateAllNameservers = async (domainName, newNameservers, db) => {
  const initialMeta = await getDomainMeta(domainName, db)
  if (!initialMeta) return { error: 'Domain metadata not found' }

  // Resolve the registrar — heals records that have missing/sentinel values
  // (e.g. legacy "Connect External Domain" docs with no registrar tag).
  const { registrar: resolved, meta } = await resolveRegistrar(domainName, db, initialMeta)
  let registrar = resolved
  if (!registrar) {
    return { error: 'Could not find domain at registrar' }
  }
  if (registrar === 'external_unmanaged') {
    // Domain is not in our OP/CR account — user must update NS at their own
    // registrar's panel. The bot has no API path to do this on their behalf.
    return { error: 'externally_managed' }
  }

  if (registrar === 'OpenProvider') {
    const result = await opService.updateNameservers(domainName, newNameservers)
    if (result.error) return result
    log(`[updateAllNameservers] OP NS updated for ${domainName}: ${newNameservers.join(', ')}`)
  } else {
    // ConnectReseller
    try {
      const getDomainDetails = require('./cr-domain-details-get')
      const details = await getDomainDetails(domainName)
      const rd = details?.responseData
      if (!rd?.domainNameId) {
        // CR doesn't have it — local meta is mis-tagged. Probe OP before giving up
        // (and fix the registrar tag in the DB so this stops happening).
        log(`[updateAllNameservers] ${domainName} not at CR despite meta.registrar=CR — falling back to OP probe`)
        const detected = await detectRegistrarForDomain(domainName, db)
        if (detected === 'OpenProvider') {
          const result = await opService.updateNameservers(domainName, newNameservers)
          if (result.error) return result
          registrar = 'OpenProvider'
          log(`[updateAllNameservers] OP NS updated (after CR mis-tag fallback) for ${domainName}: ${newNameservers.join(', ')}`)
          // Fall through to the shared persist block below
        } else {
          return { error: 'Could not find domain at registrar' }
        }
      } else {
        const APIKey = process.env.API_KEY_CONNECT_RESELLER
        const axios = require('axios')
        const crUrl = 'https://api.connectreseller.com/ConnectReseller/ESHOP/UpdateNameServer'

        // Collect current NS from CR (to handle "unlinked host" edge case)
        const currentCRNs = []
        for (let i = 1; i <= 4; i++) {
          const ns = rd[`nameserver${i}`]
          if (ns && ns.trim()) currentCRNs.push(ns.trim())
        }

        // Build the target request with ONLY the new NS
        const requestData = { APIKey, domainNameId: rd.domainNameId, websiteName: domainName }
        for (let i = 0; i < newNameservers.length && i < 4; i++) {
          requestData[`nameServer${i + 1}`] = newNameservers[i]
        }

        log(`[updateAllNameservers] CR NS update for ${domainName}:`, JSON.stringify(requestData))
        let response = await axios.get(crUrl, { params: requestData })

        // If CR returns "host not linked" error, use two-step approach:
        // Step 1: Include old unlinked NS alongside new ones → clears the block
        // Step 2: Retry with only the new NS → removes old NS cleanly
        if (response?.data?.responseMsg?.statusCode !== 200 && response?.data?.responseData?.msgCode === 2303) {
          log(`[updateAllNameservers] CR "host not linked" for ${domainName} — using two-step approach`)
          // Find NS that are in current CR but NOT in new list (these are the "stuck" ones)
          const stuckNs = currentCRNs.filter(ns => !newNameservers.map(n => n.toLowerCase()).includes(ns.toLowerCase()))
          if (stuckNs.length > 0) {
            // Step 1: Include stuck NS alongside new ones
            const step1Data = { APIKey, domainNameId: rd.domainNameId, websiteName: domainName }
            const allNs = [...newNameservers]
            for (const stuck of stuckNs) {
              if (allNs.length < 12) allNs.push(stuck)
            }
            for (let i = 0; i < allNs.length && i < 12; i++) {
              step1Data[`nameServer${i + 1}`] = allNs[i]
            }
            log(`[updateAllNameservers] CR Step 1 (include stuck NS): ${JSON.stringify(step1Data)}`)
            const step1 = await axios.get(crUrl, { params: step1Data })
            if (step1?.data?.responseMsg?.statusCode !== 200) {
              const err = step1?.data?.responseMsg?.message || 'Step 1 failed'
              log(`[updateAllNameservers] CR Step 1 failed for ${domainName}: ${err}`)
              return { error: err }
            }

            // Step 2: Now update with ONLY the new NS (removing stuck ones)
            log(`[updateAllNameservers] CR Step 2 (remove stuck NS): ${JSON.stringify(requestData)}`)
            response = await axios.get(crUrl, { params: requestData })
            if (response?.data?.responseMsg?.statusCode !== 200) {
              const err = response?.data?.responseMsg?.message || 'Step 2 failed'
              log(`[updateAllNameservers] CR Step 2 failed for ${domainName}: ${err}`)
              return { error: err }
            }
          } else {
            const errMsg = response?.data?.responseMsg?.message || 'CR nameserver update failed'
            return { error: errMsg }
          }
        } else if (response?.data?.responseMsg?.statusCode !== 200) {
          const errMsg = response?.data?.responseMsg?.message || 'CR nameserver update failed'
          log(`[updateAllNameservers] CR error for ${domainName}: ${errMsg}`)
          return { error: errMsg }
        }
        log(`[updateAllNameservers] CR NS updated for ${domainName}: ${newNameservers.join(', ')}`)
      }
    } catch (err) {
      log(`[updateAllNameservers] CR error for ${domainName}: ${err.message}`)
      return { error: `Nameserver update failed: ${err.message}` }
    }
  }

  // Determine new nameserverType based on NS values
  // Branded reseller nameservers (ns1/ns2.hosta.sh → glue = Cloudflare NS IPs) are
  // served by the SAME Cloudflare zone, so they must keep the cfZoneId linkage
  // (DNS CRUD, anti-red, SSL) exactly like the CF-assigned names.
  let isBrandedNsSet = false
  try { isBrandedNsSet = require('./branded-ns').isBrandedSet(newNameservers) } catch (_) { isBrandedNsSet = false }
  const isCloudflare = isBrandedNsSet || newNameservers.some(ns => ns.toLowerCase().includes('cloudflare'))
  const isCRDefault = newNameservers.some(ns => ns.toLowerCase().includes('managedns.org'))
  const isOPDefault = newNameservers.some(ns => ns.toLowerCase().includes('openprovider'))
  let newNsType = 'custom'
  let resolvedCfZoneId = meta.cfZoneId || null

  // Mark as 'cloudflare' whenever the user moves NS to Cloudflare AND we already
  // manage a CF zone for this domain (whether or not `meta.cfZoneId` was
  // populated on this Mongo record yet — addon-domain flows historically left
  // it blank). If we DON'T have a CF zone for the name, leave as 'custom' so we
  // don't create a conflicting zone in our CF account.
  if (isCloudflare) {
    if (!resolvedCfZoneId) {
      try {
        const cfService = require('./cf-service')
        const z = await cfService.getZoneByName(domainName)
        if (z?.id) {
          resolvedCfZoneId = z.id
          log(`[updateAllNameservers] ${domainName}: resolved missing cfZoneId via CF API = ${resolvedCfZoneId}`)
        }
      } catch (e) {
        log(`[updateAllNameservers] ${domainName}: CF zone lookup failed: ${e.message}`)
      }
    }
    if (resolvedCfZoneId) newNsType = 'cloudflare'
  } else if ((registrar === 'ConnectReseller' && isCRDefault) || (registrar === 'OpenProvider' && isOPDefault)) {
    newNsType = 'provider_default'
  }

  // Update DB
  if (db) {
    const updateFields = { nameservers: newNameservers, nameserverType: newNsType }
    // If switching away from cloudflare, clear cfZoneId
    if (newNsType !== 'cloudflare' && meta.cfZoneId) {
      await db.collection('domainsOf').updateOne(
        { domainName },
        { $set: updateFields, $unset: { cfZoneId: '' } },
        { upsert: false }
      )
      await db.collection('registeredDomains').updateOne(
        { _id: domainName },
        { $set: { 'val.nameservers': newNameservers, 'val.nameserverType': newNsType }, $unset: { 'val.cfZoneId': '' } },
        { upsert: false }
      )
    } else {
      // Stamp cfZoneId when we just (re)confirmed cloudflare ownership.
      const rdSet = { 'val.nameservers': newNameservers, 'val.nameserverType': newNsType }
      const doSet = { ...updateFields }
      if (newNsType === 'cloudflare' && resolvedCfZoneId) {
        rdSet['val.cfZoneId'] = resolvedCfZoneId
        doSet.cfZoneId = resolvedCfZoneId
      }
      await db.collection('domainsOf').updateOne(
        { domainName },
        { $set: doSet },
        { upsert: false }
      )
      await db.collection('registeredDomains').updateOne(
        { _id: domainName },
        { $set: rdSet },
        { upsert: false }
      )
    }
  }

  return { success: true, nameservers: newNameservers, nameserverType: newNsType }
}

/**
 * Update a single NS slot at the registrar.
 * For OP: replaces all nameservers (fetches current, swaps the slot, PUTs all).
 * For CR: calls the CR UpdateNameServer API.
 */
const updateNameserverAtRegistrar = async (domainName, nsSlot, newValue, db) => {
  const initialMeta = await getDomainMeta(domainName, db)

  // Heal sentinel/missing registrar so single-slot NS updates also pick the
  // correct API even when the doc came from the legacy "external" flow.
  const { registrar: resolved, meta } = await resolveRegistrar(domainName, db, initialMeta)

  if (resolved === 'external_unmanaged') {
    // Not in our OP/CR account — user must update NS at their own registrar.
    return { error: 'externally_managed' }
  }

  if (resolved === 'OpenProvider') {
    // OP: fetch current NS, replace slot, push all
    const info = await opService.getDomainInfo(domainName)
    if (!info) return { error: 'Domain not found at registrar' }
    const currentNS = info.nameservers || []
    const idx = nsSlot - 1
    if (idx < 0 || idx >= Math.max(currentNS.length, 4)) return { error: 'Invalid NS slot' }
    // Build new NS array (expand to fit slot if needed)
    const newNS = [...currentNS]
    while (newNS.length <= idx) newNS.push('')
    newNS[idx] = newValue
    // Filter out empty entries
    const filtered = newNS.filter(Boolean)
    if (filtered.length < 2) return { error: 'At least 2 nameservers are required' }
    const result = await opService.updateNameservers(domainName, filtered)
    if (result.success) {
      // Update DB metadata
      if (db) {
        await db.collection('domainsOf').updateOne(
          { domainName },
          { $set: { nameservers: filtered } },
          { upsert: false }
        )
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.nameservers': filtered } },
          { upsert: false }
        )
      }
    }
    return result
  }

  // ConnectReseller: look up domainNameId + current NS from CR API directly
  // (session state may not have CR data if domain DNS is managed via Cloudflare)
  try {
    const getDomainDetails = require('./cr-domain-details-get')
    const { updateDNSRecordNs } = require('./cr-dns-record-update-ns')

    const details = await getDomainDetails(domainName)
    const rd = details?.responseData
    if (!rd || !rd.domainNameId) {
      log(`[updateNameserverAtRegistrar] CR domain lookup failed for ${domainName}`)
      return { useDefaultCR: true }
    }

    // Build current NS array from CR response
    const currentNSRecords = []
    if (rd.nameserver1) currentNSRecords.push({ nsId: 1, recordContent: rd.nameserver1 })
    if (rd.nameserver2) currentNSRecords.push({ nsId: 2, recordContent: rd.nameserver2 })
    if (rd.nameserver3) currentNSRecords.push({ nsId: 3, recordContent: rd.nameserver3 })
    if (rd.nameserver4) currentNSRecords.push({ nsId: 4, recordContent: rd.nameserver4 })

    log(`[updateNameserverAtRegistrar] CR domain ${domainName}: domainNameId=${rd.domainNameId}, slot=${nsSlot} → ${newValue}`)
    const result = await updateDNSRecordNs(rd.domainNameId, domainName, newValue, nsSlot, currentNSRecords)

    if (result.success) {
      // Build updated NS list for DB
      const updatedNS = [...(meta?.nameservers || [])]
      const idx = nsSlot - 1
      while (updatedNS.length <= idx) updatedNS.push('')
      updatedNS[idx] = newValue
      const filtered = updatedNS.filter(Boolean)
      if (db) {
        await db.collection('domainsOf').updateOne(
          { domainName },
          { $set: { nameservers: filtered } },
          { upsert: false }
        )
        await db.collection('registeredDomains').updateOne(
          { _id: domainName },
          { $set: { 'val.nameservers': filtered } },
          { upsert: false }
        )
      }
      return { success: true }
    }
    return result
  } catch (err) {
    log(`[updateNameserverAtRegistrar] CR path error for ${domainName}:`, err.message)
    return { useDefaultCR: true }
  }
}

// ─── Migrate records helper ─────────────────────────────

/**
 * Migrate existing DNS records from old provider (OP/CR) to a Cloudflare zone.
 * Skips NS records (handled by zone-level nameservers).
 * Returns { migrated: [], failed: [], isEmpty: boolean }
 */
const migrateRecordsToCF = async (domainName, cfZoneId, meta) => {
  const migrated = []
  const failed = []
  let oldRecords = []

  try {
    // Fetch existing records from old provider
    const registrar = meta.registrar || 'ConnectReseller'
    if (registrar === 'OpenProvider') {
      const opResult = await opService.listDNSRecords(domainName)
      oldRecords = (opResult.records || [])
    } else {
      const viewCRDNS = require('./cr-view-dns-records')
      const crData = await viewCRDNS(domainName)
      oldRecords = (crData?.records || []).map(r => ({
        recordType: r.recordType,
        recordContent: r.recordContent || r.value,
        recordName: r.recordName || r.hostName || domainName,
        ttl: r.ttl,
        priority: r.priority,
      }))
    }

    // Filter out NS records and empty entries
    const toMigrate = oldRecords.filter(r =>
      r.recordType && r.recordType !== 'NS' && r.recordContent
    )

    if (toMigrate.length === 0) {
      log(`[migrateRecordsToCF] No records to migrate for ${domainName}`)
      return { migrated, failed, isEmpty: true }
    }

    log(`[migrateRecordsToCF] Migrating ${toMigrate.length} records for ${domainName}`)

    for (const record of toMigrate) {
      const type = record.recordType.toUpperCase()
      const name = record.recordName || domainName
      const content = record.recordContent
      const shouldProxy = ['A', 'AAAA', 'CNAME'].includes(type)
      const priority = record.priority

      const result = await cfService.createDNSRecord(
        cfZoneId, type, name, content, record.ttl || 300, shouldProxy, priority
      )

      if (result.success || result.alreadyExists) {
        migrated.push({ type, name, content })
        log(`[migrateRecordsToCF] ✅ ${type} ${name} → ${content}`)
      } else {
        failed.push({ type, name, content, error: result.errors?.[0]?.message || 'Unknown' })
        log(`[migrateRecordsToCF] ❌ ${type} ${name} → ${content}: ${result.errors?.[0]?.message || 'Unknown'}`)
      }
    }
  } catch (err) {
    log(`[migrateRecordsToCF] Error: ${err.message}`)
  }

  return { migrated, failed, isEmpty: oldRecords.filter(r => r.recordType !== 'NS').length === 0 }
}

// ─── Background NS verification ────────────────────────

/**
 * Background task: re-check CF zone NS after 30s to detect CF reassignment.
 * Auto-corrects at registrar + DB if drift detected.
 */
const backgroundNSVerify = (domainName, cfNameservers, registrar, db) => {
  ;(async () => {
    try {
      await new Promise(r => setTimeout(r, 30000))
      const zoneData = await cfService.getZoneByName(domainName)
      if (!zoneData) return
      const currentNS = (zoneData.name_servers || []).sort().join(',')
      const savedNS = [...cfNameservers].sort().join(',')
      if (currentNS !== savedNS) {
        log(`[NSVerify] ⚠️ CF reassigned NS for ${domainName}: was [${cfNameservers}] now [${zoneData.name_servers}]`)
        const correctNS = zoneData.name_servers
        if (registrar === 'OpenProvider') {
          await opService.updateNameservers(domainName, correctNS)
        } else {
          // ConnectReseller: update ALL nameservers in one call (avoids stale-state revert)
          const crResult = await updateAllNameservers(domainName, correctNS, null)
          if (crResult.error) {
            log(`[NSVerify] CR NS drift correction failed for ${domainName}: ${crResult.error}`)
            return
          }
        }
        if (db) {
          await db.collection('domainsOf').updateOne({ domainName }, { $set: { nameservers: correctNS } })
          await db.collection('registeredDomains').updateOne({ _id: domainName }, { $set: { 'val.nameservers': correctNS } })
        }
        log(`[NSVerify] NS drift corrected for ${domainName}`)
      } else {
        log(`[NSVerify] NS verified OK for ${domainName}`)
      }
    } catch (err) {
      log(`[NSVerify] Error for ${domainName}: ${err.message}`)
    }
  })()
}

// ─── Core: create CF zone + update NS at registrar ──────

const _createZoneAndUpdateNS = async (domainName, meta) => {
  const cfResult = await cfService.createZone(domainName)
  if (!cfResult.success || !cfResult.zoneId) {
    return { error: 'Failed to create Cloudflare zone: ' + (cfResult.errors?.[0]?.message || 'Unknown error') }
  }
  const cfNameservers = cfResult.nameservers || []
  log(`[switchToCloudflare] CF zone created for ${domainName}: ${cfResult.zoneId}, NS: ${cfNameservers.join(', ')}`)
  if (cfNameservers.length < 2) {
    return { error: 'Cloudflare did not return nameservers' }
  }

  const registrar = meta.registrar || 'ConnectReseller'
  if (registrar === 'OpenProvider') {
    const nsResult = await opService.updateNameservers(domainName, cfNameservers)
    if (nsResult.error) return { error: `Failed to update nameservers: ${nsResult.error}` }
    log(`[switchToCloudflare] OP NS updated for ${domainName}: ${cfNameservers.join(', ')}`)
  } else {
    // ConnectReseller: update ALL nameservers in one API call to avoid stale-state revert
    const crResult = await updateAllNameservers(domainName, cfNameservers, null) // null db — caller updates DB
    if (crResult.error) {
      return { error: `Failed to update nameservers: ${crResult.error}` }
    }
    log(`[switchToCloudflare] CR NS updated for ${domainName}: ${cfNameservers.join(', ')}`)
  }

  return { success: true, zoneId: cfResult.zoneId, nameservers: cfNameservers, registrar }
}

const _updateDBMeta = async (domainName, cfZoneId, cfNameservers, db) => {
  if (!db) return
  const updateData = { nameserverType: 'cloudflare', cfZoneId, nameservers: cfNameservers }
  await db.collection('domainsOf').updateOne({ domainName }, { $set: updateData }, { upsert: false })
  await db.collection('registeredDomains').updateOne(
    { _id: domainName },
    { $set: { 'val.nameserverType': 'cloudflare', 'val.cfZoneId': cfZoneId, 'val.nameservers': cfNameservers } },
    { upsert: false }
  )
}

// ─── Switch to Cloudflare ───────────────────────────────

/**
 * Switch a domain's DNS to Cloudflare:
 * 1. Create CF zone (get NS)
 * 2. Migrate existing DNS records from old provider to CF zone
 * 3. Update NS at registrar (CR or OP)
 * 4. Update DB metadata
 * 5. Background NS drift detection
 * Returns { success, nameservers, zoneId, migration: { migrated, failed, isEmpty } }
 */
const switchToCloudflare = async (domainName, db) => {
  const meta = await getDomainMeta(domainName, db)
  if (!meta) return { error: 'Domain metadata not found' }

  if ((meta.nameserverType === 'cloudflare' || meta.cfZoneId) && meta.cfZoneId) {
    return { error: 'Domain is already using Cloudflare DNS' }
  }

  log(`[switchToCloudflare] Starting for ${domainName} (registrar: ${meta.registrar || 'ConnectReseller'})`)

  // 1+3. Create CF zone + update NS at registrar
  const zoneResult = await _createZoneAndUpdateNS(domainName, meta)
  if (zoneResult.error) return zoneResult

  // 2. Migrate existing DNS records to CF zone
  const migration = await migrateRecordsToCF(domainName, zoneResult.zoneId, meta)

  // 4. Update DB metadata
  await _updateDBMeta(domainName, zoneResult.zoneId, zoneResult.nameservers, db)

  // 5. Background NS verification
  backgroundNSVerify(domainName, zoneResult.nameservers, zoneResult.registrar, db)

  return {
    success: true,
    nameservers: zoneResult.nameservers,
    zoneId: zoneResult.zoneId,
    migration,
  }
}

/**
 * ensureCloudflare — idempotent: if already on CF, returns existing zone info.
 * If not, creates CF zone, migrates records, updates NS at registrar, updates DB.
 * Used by shortener activation to guarantee domain is on Cloudflare before adding CNAME.
 */
const ensureCloudflare = async (domainName, db) => {
  const meta = await getDomainMeta(domainName, db)
  if (!meta) return { error: 'Domain metadata not found' }

  if ((meta.nameserverType === 'cloudflare' || meta.cfZoneId) && meta.cfZoneId) {
    // 2026-10-01 (accesslog45security.com / 840923854): 96 registeredDomains carry a cfZoneId
    // whose zone was deleted from (or never belonged to) our CF account → every DNS write
    // failed with "Authentication error". Verify the zone is really ours; if definitively not,
    // re-link to an existing same-name zone in our account or drop the id and re-create.
    const live = await cfService.zoneExistsInAccount(meta.cfZoneId)
    if (live !== false) {
      log(`[ensureCloudflare] ${domainName} already on CF (zone: ${meta.cfZoneId})`)
      return { success: true, cfZoneId: meta.cfZoneId, nameservers: meta.nameservers || [], alreadyActive: true }
    }
    const sameName = await cfService.getZoneByName(domainName)
    if (sameName?.id) {
      log(`[ensureCloudflare] ${domainName}: stale cfZoneId ${meta.cfZoneId} → re-linked to existing zone ${sameName.id}`)
      await _updateDBMeta(domainName, sameName.id, sameName.name_servers || meta.nameservers || [], db)
      return { success: true, cfZoneId: sameName.id, nameservers: sameName.name_servers || [], alreadyActive: true, relinked: true }
    }
    log(`[ensureCloudflare] ${domainName}: cfZoneId ${meta.cfZoneId} not in our CF account — clearing and re-creating zone`)
    if (db) {
      await db.collection('domainsOf').updateOne({ domainName }, { $unset: { cfZoneId: '' } }).catch(() => {})
      await db.collection('registeredDomains').updateOne({ _id: domainName }, { $unset: { 'val.cfZoneId': '' } }).catch(() => {})
    }
    meta.cfZoneId = null
  }

  log(`[ensureCloudflare] ${domainName} NOT on Cloudflare — switching now`)

  // Create CF zone + update NS
  const zoneResult = await _createZoneAndUpdateNS(domainName, meta)
  if (zoneResult.error) return { error: zoneResult.error }

  // Migrate existing records to CF zone
  const migration = await migrateRecordsToCF(domainName, zoneResult.zoneId, meta)

  // Update DB
  await _updateDBMeta(domainName, zoneResult.zoneId, zoneResult.nameservers, db)

  // Background NS verification
  backgroundNSVerify(domainName, zoneResult.nameservers, zoneResult.registrar, db)

  return {
    success: true,
    cfZoneId: zoneResult.zoneId,
    nameservers: zoneResult.nameservers,
    alreadyActive: false,
    migration,
  }
}

/**
 * checkDNSConflict — check if adding a record type would conflict with existing records.
 * A/AAAA and CNAME cannot coexist on the same hostname in Cloudflare.
 * Returns { hasConflict, conflictingRecords: [], message } or { hasConflict: false }
 */
const checkDNSConflict = async (domainName, recordType, hostname, db) => {
  const meta = await getDomainMeta(domainName, db)
  if (!meta?.cfZoneId) return { hasConflict: false } // Only relevant for CF zones

  const type = recordType.toUpperCase()
  if (!['A', 'AAAA', 'CNAME'].includes(type)) return { hasConflict: false }

  const fullName = hostname ? `${hostname}.${domainName}` : domainName
  const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
  const conflicting = cfRecords.filter(r => {
    if (r.name !== fullName) return false
    if (type === 'CNAME') return ['A', 'AAAA'].includes(r.type)
    if (['A', 'AAAA'].includes(type)) return r.type === 'CNAME'
    return false
  })

  if (conflicting.length === 0) return { hasConflict: false }

  const conflictTypes = [...new Set(conflicting.map(r => r.type))].join('/')
  const isCNAME = type === 'CNAME'
  const message = isCNAME
    ? `⚠️ An existing ${conflictTypes} record for <b>${fullName}</b> will be deleted to add this CNAME.\n\n`
      + conflicting.map(r => `• ${r.type} → ${r.content}`).join('\n')
      + `\n\nProceed?`
    : `⚠️ An existing CNAME record for <b>${fullName}</b> will be deleted to add this ${type} record.\n\n`
      + conflicting.map(r => `• ${r.type} → ${r.content}`).join('\n')
      + `\n\nProceed?`

  return { hasConflict: true, conflictingRecords: conflicting, message }
}

/**
 * resolveConflictAndAdd — delete conflicting records, then add the new one.
 */
const resolveConflictAndAdd = async (domainName, recordType, recordValue, hostname, conflictingRecords, db, priority, opts) => {
  const meta = await getDomainMeta(domainName, db)
  if (!meta?.cfZoneId) return { error: 'No Cloudflare zone' }

  // Delete conflicting records
  for (const record of conflictingRecords) {
    const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, record.id)
    if (delResult.success) {
      log(`[resolveConflict] Deleted ${record.type} ${record.name} → ${record.content}`)
    } else {
      log(`[resolveConflict] Warning: failed to delete ${record.type} ${record.name}`)
    }
  }

  // Add the new record — forward `opts` so callers can request DNS-only
  // (grey cloud) for user-driven Add-Record conflict-resolution paths.
  return await addDNSRecord(domainName, recordType, recordValue, hostname, db, priority, undefined, opts)
}

// ─── Auto-create CF zone in viewDNSRecords also triggers worker ─────

/**
 * Switch a domain's DNS BACK from Cloudflare to the registrar's default nameservers.
 * 1. Fetch all DNS records from CF zone
 * 2. Restore default NS at registrar (OP: openprovider NS, CR: managedns NS)
 * 3. Create records on OP/CR DNS zone
 * 4. Delete CF zone (cleanup)
 * 5. Update DB metadata
 * Returns { success, nameservers, migration: { migrated, failed, isEmpty } }
 */
const switchToProviderDefault = async (domainName, db) => {
  const meta = await getDomainMeta(domainName, db)
  if (!meta) return { error: 'Domain metadata not found' }

  if (!(meta.nameserverType === 'cloudflare' || meta.cfZoneId) || !meta.cfZoneId) {
    return { error: 'Domain is not currently using Cloudflare DNS' }
  }

  const registrar = meta.registrar || 'ConnectReseller'
  log(`[switchToProvider] Starting for ${domainName} (registrar: ${registrar})`)

  // 1. Fetch existing records from CF zone
  const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
  const toMigrate = cfRecords.filter(r => !['NS', 'SOA'].includes(r.type))
  log(`[switchToProvider] Found ${toMigrate.length} records to migrate from CF`)

  // 2. Restore default NS at registrar
  let defaultNS = []
  if (registrar === 'OpenProvider') {
    defaultNS = ['ns1.openprovider.nl', 'ns2.openprovider.be', 'ns3.openprovider.eu']
    const nsResult = await opService.updateNameservers(domainName, defaultNS)
    if (nsResult.error) return { error: `Failed to restore nameservers: ${nsResult.error}` }
    log(`[switchToProvider] OP NS restored to defaults for ${domainName}`)
  } else {
    // ConnectReseller — update NS to CR defaults via NS update
    const viewCRDNS = require('./cr-view-dns-records')
    const crData = await viewCRDNS(domainName)
    if (crData?.domainNameId) {
      const nsRecords = (crData.records || []).filter(r => r.recordType === 'NS')
      defaultNS = nsRecords.map(r => r.recordContent)
      // NS should already be managedns.org — just ensure they're set
      if (defaultNS.length === 0) {
        defaultNS = ['8307.dns1.managedns.org', '8307.dns2.managedns.org']
      }
      // If current NS are cloudflare, update ALL back to CR defaults in one call
      const crDefaultNS = ['8307.dns1.managedns.org', '8307.dns2.managedns.org']
      const hasCloudflareNS = nsRecords.some(r => r.recordContent && r.recordContent.includes('cloudflare'))
      if (hasCloudflareNS) {
        const crResult = await updateAllNameservers(domainName, crDefaultNS, null) // null db — caller updates DB later
        if (crResult.error) {
          log(`[switchToProvider] CR NS restore failed for ${domainName}: ${crResult.error}`)
        }
      }
      defaultNS = crDefaultNS
      log(`[switchToProvider] CR NS restored for ${domainName}`)
    } else {
      return { error: 'Could not fetch domain data from registrar' }
    }
  }

  // 3. Migrate DNS records from CF to provider DNS zone
  // ── Ensure OP DNS zone exists before migrating records ──
  if (registrar === 'OpenProvider' && toMigrate.length > 0) {
    const zoneReady = await opService.ensureDnsZone(domainName)
    if (zoneReady.error) {
      log(`[switchToProvider] ⚠️ Could not ensure OP DNS zone for ${domainName}: ${zoneReady.error}`)
    } else {
      log(`[switchToProvider] OP DNS zone ready for ${domainName} (${zoneReady.created ? 'created' : 'exists'})`)
    }
  }

  const migrated = []
  const failed = []
  for (const record of toMigrate) {
    const type = record.type
    const name = record.name
    // Extract hostname relative to domain
    const hostname = name === domainName ? '' : name.replace(`.${domainName}`, '')
    const content = record.content
    const priority = record.priority

    try {
      let result
      if (registrar === 'OpenProvider') {
        result = await opService.addDNSRecord(domainName, type, content, hostname || domainName, priority)
      } else {
        // ConnectReseller
        const { saveServerInDomain } = require('./cr-dns-record-add')
        result = await saveServerInDomain(domainName, content, type, undefined, undefined, undefined, hostname || undefined, priority)
      }

      if (result?.success || result?.error === undefined || result?.error === null) {
        migrated.push({ type, name, content })
        log(`[switchToProvider] ✅ ${type} ${name} → ${content}`)
      } else {
        failed.push({ type, name, content, error: result?.error || 'Unknown' })
        log(`[switchToProvider] ❌ ${type} ${name} → ${content}: ${result?.error}`)
      }
    } catch (err) {
      failed.push({ type, name, content, error: err.message })
      log(`[switchToProvider] ❌ ${type} ${name} → ${content}: ${err.message}`)
    }
  }

  // 4. Delete CF zone (cleanup)
  if (meta.cfZoneId) {
    const delResult = await cfService.deleteZone(meta.cfZoneId)
    log(`[switchToProvider] CF zone ${meta.cfZoneId} deleted: ${delResult.success}`)
  }

  // 5. Update DB metadata
  if (db) {
    const updateData = {
      nameserverType: 'provider_default',
      nameservers: defaultNS,
    }
    // Remove cfZoneId
    await db.collection('domainsOf').updateOne(
      { domainName },
      { $set: updateData, $unset: { cfZoneId: '' } },
      { upsert: false }
    )
    await db.collection('registeredDomains').updateOne(
      { _id: domainName },
      { $set: { 'val.nameserverType': 'provider_default', 'val.nameservers': defaultNS }, $unset: { 'val.cfZoneId': '' } },
      { upsert: false }
    )
  }

  return {
    success: true,
    nameservers: defaultNS,
    migration: { migrated, failed, isEmpty: toMigrate.length === 0 },
  }
}

/**
 * addShortenerCNAME — Add a root CNAME for URL shortener + TXT verification record for Railway.
 * 
 * The shortener always needs:
 * 1. Root CNAME pointing to Railway/Render
 * 2. TXT record for Railway domain ownership verification
 * 
 * If the domain has existing A/AAAA records at root (e.g. from hosting),
 * they must be deleted first since CNAME cannot coexist with A/AAAA.
 * 
 * @param {string} domainName - Domain name
 * @param {string} cnameTarget - Railway CNAME target (e.g., 8qn9dw52.up.railway.app)
 * @param {object} db - MongoDB database instance
 * @param {string} [txtHost] - TXT verification hostname (e.g., _railway-verify)
 * @param {string} [txtValue] - TXT verification value (e.g., railway-verify=...)
 * Returns { success: true } or { error: 'message' }
 */
const addShortenerCNAME = async (domainName, cnameTarget, db, txtHost, txtValue) => {
  try {
    // Subdomain-aware: go.namewords.sbs resolves to the parent namewords.sbs zone.
    const meta = await resolveZoneMeta(domainName, db)
    // Droplet/Render hand us an IPv4 → apex A record; Railway hands us a hostname → apex CNAME.
    const isIPv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(cnameTarget || '').trim())
    const recType = isIPv4 ? 'A' : 'CNAME'

    if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId) {
      // 1. Check for A/AAAA conflicts at root
      const conflict = await checkDNSConflict(domainName, 'CNAME', '', db)
      if (conflict.hasConflict && conflict.conflictingRecords?.length > 0) {
        log(`[addShortenerCNAME] ${domainName}: removing ${conflict.conflictingRecords.length} conflicting A/AAAA record(s) before ${recType}`)
        for (const rec of conflict.conflictingRecords) {
          if (recType === 'A' && rec.type === 'A' && rec.content === cnameTarget) continue
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted ${rec.type} ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete ${rec.type} ${rec.name} → ${rec.content}`)
          }
        }
      }

      // 1b. Also check for existing root records of our type that point elsewhere (and stale
      // apex CNAMEs when we are adding an A record). Handles domains previously linked to a
      // different shortener host (e.g. the old Railway CNAME).
      const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
      const existingSame = cfRecords.filter(r => r.name === domainName && (r.type === recType || (recType === 'A' && r.type === 'CNAME')))
      let cnameAlreadyCorrect = false
      for (const rec of existingSame) {
        if (rec.type !== recType || rec.content !== cnameTarget) {
          log(`[addShortenerCNAME] ${domainName}: removing existing ${rec.type} → ${rec.content} before adding shortener ${recType}`)
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted existing ${rec.type} ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete existing ${rec.type} ${rec.name} → ${rec.content}`)
          }
        } else {
          log(`[addShortenerCNAME] ${domainName}: ${recType} already points to ${cnameTarget}`)
          cnameAlreadyCorrect = true
        }
      }

      // 2. Add the record (proxied — CF terminates TLS at the edge)
      if (!cnameAlreadyCorrect) {
        const result = await cfService.createDNSRecord(meta.cfZoneId, recType, domainName, cnameTarget, 300, true)
        if (!result.success && !result.alreadyExists) {
          const errMsg = result.errors?.map(e => e.message || e.code).join(', ') || 'Cloudflare DNS add failed'
          return { error: errMsg }
        }
        log(`[addShortenerCNAME] ${domainName}: ${recType} → ${cnameTarget} added (proxied)`)
      }

      // 3. Add TXT verification record for Railway domain ownership
      if (txtHost && txtValue) {
        const txtFullHost = txtHost.includes('.') ? txtHost : `${txtHost}.${domainName}`
        // Check if TXT record already exists
        const existingTXT = cfRecords.find(r => r.name === txtFullHost && r.type === 'TXT')
        if (existingTXT && existingTXT.content === txtValue) {
          log(`[addShortenerCNAME] ${domainName}: TXT verification record already exists`)
        } else {
          // Delete any existing TXT record at this host
          if (existingTXT) {
            await cfService.deleteDNSRecord(meta.cfZoneId, existingTXT.id)
          }
          // Add the TXT record (not proxied)
          const txtResult = await cfService.createDNSRecord(meta.cfZoneId, 'TXT', txtFullHost, txtValue, 3600, false)
          if (txtResult.success || txtResult.alreadyExists) {
            log(`[addShortenerCNAME] ${domainName}: TXT ${txtHost} → ${txtValue.substring(0, 30)}... added`)
          } else {
            log(`[addShortenerCNAME] ${domainName}: Warning - TXT record failed: ${txtResult.errors?.map(e => e.message).join(', ')}`)
            // Don't fail the whole operation for TXT - domain may still work
          }
        }
      }

      return { success: true }
    }

    // Non-CF domains: use generic addDNSRecord (OP/CR don't have CNAME flattening at root)
    const result = await addDNSRecord(domainName, recType, cnameTarget, '', db)
    if (result.success || result.alreadyExists) return { success: true }
    const errMsg = result.error || result.errors?.map(e => e.message).join(', ') || 'DNS add failed'
    return { error: errMsg }
  } catch (err) {
    log(`[addShortenerCNAME] Error for ${domainName}: ${err.message}`)
    return { error: err.message }
  }
}

// ─── Activation nudge (Domain Status Check feature) ──────────────────────────
// Human-friendly, HTML-safe nudge text for a normalized activation state.
const _activationNudgeText = (state) => {
  switch (state) {
    case 'activating':
      return "⏳ <b>Activating…</b>\nThis domain is still being set up at the registry (usually a few minutes to a couple of hours after purchase). Nameserver changes may be temporarily locked — we'll apply them automatically once it's active. No action needed."
    case 'stuck':
      return "⚠️ <b>Setup is taking longer than usual.</b>\nThis domain hasn't finished activating at the registry yet. We're retrying automatically — if it isn't live within a few hours, tap 💬 Support."
    case 'failed':
      return "❌ <b>Registration problem.</b>\nThe registry reports this domain's registration didn't complete. Please tap 💬 Support so we can sort it out."
    default:
      return null // active / unknown → show nothing
  }
}

// Best-effort activation nudge for a freshly-registered OpenProvider domain.
// Reuses already-fetched `meta` (no extra DB call), only hits the OP API for
// recent OpenProvider domains, and is time-boxed so the DNS view never stalls.
// Returns an HTML nudge string, or null when there's nothing to show.
const getActivationNudge = async (domainName, meta) => {
  try {
    const registrar = String(meta?.registrar || meta?.provider || '').toLowerCase()
    if (!registrar.includes('openprovider')) return null // code 366 is OpenProvider-specific
    const regAt = meta?.registeredAt ? new Date(meta.registeredAt) : null
    const ageHours = regAt && !isNaN(regAt.getTime()) ? (Date.now() - regAt.getTime()) / 3600000 : 0
    // Domains older than 14 days are certainly active — skip the network call.
    if (regAt && ageHours > 24 * 14) return null
    const res = await Promise.race([
      opService.getActivationState(domainName, ageHours),
      new Promise((r) => setTimeout(() => r({ state: 'unknown', timeout: true }), 6000)),
    ])
    return _activationNudgeText(res && res.state)
  } catch (e) {
    log(`[domain-service] getActivationNudge(${domainName}): ${e.message}`)
    return null
  }
}

module.exports = {
  checkDomainPrice,
  checkAlternativeTLDs,
  registerDomain,
  postRegistrationNSUpdate,
  getDomainMeta,
  resolveZoneMeta,
  detectRegistrarForDomain,
  resolveRegistrar,
  isRegistrarUnclear,
  viewDNSRecords,
  addDNSRecord,
  updateDNSRecord,
  deleteDNSRecord,
  updateNameserverAtRegistrar,
  updateAllNameservers,
  switchToCloudflare,
  switchToProviderDefault,
  ensureCloudflare,
  checkDNSConflict,
  resolveConflictAndAdd,
  addShortenerCNAME,
  sanitizeErrorForUser,
  getActivationNudge,
  _activationNudgeText,
}
