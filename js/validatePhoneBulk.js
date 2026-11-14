/*global process */
const { log } = require('console')
const { customAlphabet } = require('nanoid')
const { getRandom, sleep } = require('./utils')
const validatePhoneAlcazar = require('./validatePhoneAlcazar')
const validatePhoneSignalwire = require('./validatePhoneSignalwire')
const validatePhoneNpl = require('./validatePhoneNpl')
const validatePhoneNeutrino = require('./validatePhoneNeutrino')
const { lookupCnam } = require('./cnam-service')
const { translation } = require('./translation')
const { createJob, startPeriodicSave, stopPeriodicSave, completeJob, failJob } = require('./lead-job-persistence')
// const { validatePhoneTwilioV2 } = require('./validatePhoneTwilio')
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
const part1 = customAlphabet('23456789', 1)
const part2 = customAlphabet('0123456789', 6)
const _part2 = customAlphabet('0123456789', 7)

// config
const parallelApiCalls = 5
const waitAfterParallelApiCalls = 1 * 1000 // 1 second

const showProgressEveryXTime = 60 // 30 iterations = 1 minute

// ── Dynamic phoneGenTimeout configuration ──
// Timeout scales with order size. Observed throughput on Railway:
//   ~1.2 verified phones/sec (non-CNAM), ~0.5 phones/sec (CNAM-enabled)
// We budget generously so orders almost always finish before the safety net.
//
// CNAM_MULTIPLIER raised from 1.5 → 2.0 after production telemetry showed
//   3000-lead CNAM jobs averaging ~1.98s/lead (job f7c619a9: 1557 leads in
//   51 min ≈ 30.3 leads/min). 1.5× was pinning the 90-min ceiling at exactly
//   3000 CNAM leads with no safety margin.
// CEILING raised 90 → 240 min so large orders (>3k) no longer clip the cap.
// SAFETY_BUFFER adds 20% headroom on top of the raw budget to absorb provider
//   latency spikes and CNAM retries.
// All four constants are overridable via env vars for production tuning
// without a redeploy of the constants themselves.
const PHONE_GEN_TIMEOUT_FLOOR_MS = Number(process.env.PHONE_GEN_TIMEOUT_FLOOR_MS) || 10 * 60 * 1000   // 10 min floor (small orders)
const PHONE_GEN_TIMEOUT_CEILING_MS = Number(process.env.PHONE_GEN_TIMEOUT_CEILING_MS) || 240 * 60 * 1000 // 240 min ceiling (runaway guard)
const PHONE_GEN_BUDGET_PER_LEAD_MS = Number(process.env.PHONE_GEN_BUDGET_PER_LEAD_MS) || 1200          // 1.2s per lead (non-CNAM baseline)
const PHONE_GEN_CNAM_MULTIPLIER = Number(process.env.PHONE_GEN_CNAM_MULTIPLIER) || 2.0                 // CNAM orders get 2x base budget
const PHONE_GEN_SAFETY_BUFFER = Number(process.env.PHONE_GEN_SAFETY_BUFFER) || 1.2                     // 20% safety buffer on raw budget
const computePhoneGenTimeout = (targetCount, cnamEnabled) => {
  const budgetPerLead = cnamEnabled
    ? Math.ceil(PHONE_GEN_BUDGET_PER_LEAD_MS * PHONE_GEN_CNAM_MULTIPLIER)
    : PHONE_GEN_BUDGET_PER_LEAD_MS
  const raw = Math.ceil(targetCount * budgetPerLead * PHONE_GEN_SAFETY_BUFFER)
  return Math.min(PHONE_GEN_TIMEOUT_CEILING_MS, Math.max(PHONE_GEN_TIMEOUT_FLOOR_MS, raw))
}

const phoneGenStopAtNoXHits = 250 // 250 Hits with 0 phone number found then break the loop
const CNAM_MISS_THRESHOLD = 50 // 50 consecutive batches with 0 new real names → stop

// ── CNAM Cost Optimization Constants ──
const CNAM_COST_PER_LOOKUP = 0.004 // Estimated average CNAM cost per lookup (USD)
const AREA_CODE_MIN_YIELD = 0.08 // 8% — disable CNAM for area codes below this real-name yield
const AREA_CODE_SAMPLE_SIZE = 30 // Evaluate area code after this many CNAM lookups
const VOIP_WHOLESALE_CARRIERS = new Set([
  'ONVOY', 'BANDWIDTH', 'LEVEL 3', 'LEVEL3', 'LUMEN', 'THINQ', 'INTELIQUENT',
  'PEERLESS', 'COMMIO', 'WEST TELECOM', 'INTRADO', 'NEUTRAL TANDEM',
  'WINDSTREAM', 'MAGICJACK', 'GOOGLE VOICE', 'VONAGE', 'DIALPAD',
  'RINGCENTRAL', 'GRASSHOPPER', '8X8', 'TWILIO', 'PLIVO', 'TELNYX',
  'SINCH', 'FLOWROUTE', 'VOXBONE', 'DIDWW', 'NEXTIVA',
])

// ── Real Person Name Filter ──
// US state abbreviations for city/state pattern detection
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MO','MS','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC','PR','VI','GU','AS','MP'
])

// Known non-person identifiers
const REJECT_EXACT = new Set([
  'WIRELESS CALLER', 'UNKNOWN', 'UNAVAILABLE', 'NONE', 'NOT FOUND', 'NO NAME',
  'PRIVATE', 'PRIVATE CALLER', 'BLOCKED', 'RESTRICTED', 'ANONYMOUS',
  'TOLL FREE', 'TOLL FREE CALL', 'TOLLFREE', 'OUT OF AREA',
  'PROBABLY FRAUD', 'SPAM', 'SCAM', 'SCAM LIKELY', 'FRAUD', 'TELEMARKETER',
  'V', 'N/A', '-', '', 'CALLER', 'WIRELESS', 'LANDLINE', 'VOIP'
])

// Known carrier/company substrings (partial match)
const REJECT_CONTAINS = [
  'WIRELESS CALL', 'TOLL FREE', 'CALLER ID', 'CELL PHONE',
  'VERIZON', 'T-MOBILE', 'TMOBILE', 'AT&T', 'ATT ', 'SPRINT', 'SPECTRUM',
  'COMCAST', 'XFINITY', 'CRICKET', 'METRO PCS', 'METROPCS', 'BOOST MOBILE',
  'TRACFONE', 'STRAIGHT TALK', 'VONAGE', 'MAGICJACK', 'GOOGLE VOICE',
  'BANDWIDTH', 'LEVEL 3', 'LEVEL3', 'WINDSTREAM', 'FRONTIER', 'CENTURYLINK',
  'LUMEN', 'CORELOGIC', 'COSTAR', 'HOME CARE', 'IPHONE', 'ANDROID',
  'COLOPLAST', 'SAIA LTL', 'RAIDER NATION'
]

/**
 * Determines if a CNAM result is a real person's name vs carrier/location/junk data.
 * Returns true only for entries that look like actual human names.
 */
const isRealPersonName = (name) => {
  if (!name || typeof name !== 'string') return false
  const trimmed = name.trim().toUpperCase()
  if (trimmed.length < 3) return false

  // Reject exact matches
  if (REJECT_EXACT.has(trimmed)) return false

  // Reject if contains known carrier/company substrings
  for (const kw of REJECT_CONTAINS) {
    if (trimmed.includes(kw)) return false
  }

  // Reject city/state pattern: "WORD(S) XX" where XX is a US state
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1]
    if (US_STATES.has(lastPart) && lastPart.length === 2) {
      // Check that the preceding parts look like a city name (all caps, no mixed case)
      // This catches "LOS ANGELES CA", "MINNEAPOLIS MN", "SAN FRANCSCO CA", etc.
      // But allows "JAMES CA" (could be a name) if it has only 2 parts with a short first part
      // Real names with 2-letter "state" last names exist but are extremely rare
      // We only reject if the "city" part is >= 3 words or matches known city patterns
      if (parts.length >= 3) return false // "LOS ANGELES CA" = 3 parts, always reject
      // 2-part: "GARDENA CA" vs "JAMES CA" — reject if last is a state and first part > 4 chars
      // (most city names are > 4 chars; most first names are <= 8 chars but this is a heuristic)
      // Actually, let's reject all 2-part "WORD STATE" patterns since city names dominate
      return false
    }
  }

  // Reject if it's all digits or has mostly digits
  const alphaCount = (trimmed.match(/[A-Z]/g) || []).length
  if (alphaCount < 2) return false

  // Reject masked/placeholder names (e.g., "XXXX XXXX", "AAAA BBBB")
  const lettersOnly = trimmed.replace(/[^A-Z]/g, '')
  if (lettersOnly.length >= 4 && new Set(lettersOnly).size <= 2) return false

  // Reject single-word entries that are too short or look like abbreviations
  if (parts.length === 1 && trimmed.length < 4) return false

  // Pass: looks like a real person name
  return true
}

// core
const duplicate = {}
const areaCodeCount = {}
let first = 0

const validateNumber = async (carrier, countryCode, areaCode, cnam) => {
  const part = ['61', '44'].includes(countryCode) ? _part2 : part2
  // validatePhoneNpl can improved to multiple queries in one go, alcazar is already optimized
  const validatePhone = countryCode === '1' ? validatePhoneAlcazar : validatePhoneNpl
  const phone = countryCode + areaCode + part1() + part()

  if (first < parallelApiCalls) {
    log('Phone', phone)
    first++
  }

  if (duplicate[phone]) return log(`Duplicate ${phone}`)
  duplicate[phone] = true

  // neutrino for countries not US
  if (countryCode !== '1') {
    const res0 = await validatePhoneNeutrino(phone)
    if (!res0) return res0
  }

  const res1 = await validatePhone(carrier, phone)
  // log(phone, res1)
  if (!res1) return res1

  if (!cnam) {
    return [...res1]
  }

  // ── FIX #4: VoIP/Wholesale carrier pre-filter ──
  // Skip CNAM lookup for known VoIP/wholesale carriers — they rarely have real person names
  // This saves a paid CNAM lookup per number from these carriers
  const carrierName = (res1[1] || '').toUpperCase()
  for (const voip of VOIP_WHOLESALE_CARRIERS) {
    if (carrierName.includes(voip)) {
      return [...res1, 'VoIP Carrier'] // Skip CNAM — return placeholder
    }
  }

  // Use unified CNAM service (Multitel → SignalWire + cache)
  // Falls back to legacy SignalWire-only lookup if cnam-service not initialized
  try {
    const name = await lookupCnam(phone)
    return [...res1, name || 'Not Found']
  } catch (e) {
    // Fallback to legacy SignalWire direct lookup
    return [...res1, await validatePhoneSignalwire(phone)]
  }
}

const validateNumbersParallel = async (carrier, length, countryCode, areaCode, cnam) => {
  const promises = Array.from({ length }, () => validateNumber(carrier, countryCode, areaCode, cnam))
  try {
    const results = (await Promise.all(promises)).filter(r => r)

    const fullAc = '+' + countryCode + areaCode + ' ' + carrier
    const a = areaCodeCount[fullAc]
    const totalHits = (a?.totalHits || 0) + length
    const goodHits = (a?.goodHits || 0) + results.length
    const percentage = Number((goodHits / totalHits) * 100).toFixed() + '% Good Hits'
    areaCodeCount[fullAc] = { totalHits, goodHits, percentage }

    return results
  } catch (error) {
    console.error('validateNumbersParallel error', error?.message)
    return []
  }
}

const validateBulkNumbers = async (carrier, phonesToGenerate, countryCode, areaCodes, cnam, bot, chatId, lang, requireRealName = false, jobMeta = {}, resumeData = null) => {
  log({ phonesToGenerate, countryCode, areaCodes, cnam, requireRealName, resuming: !!resumeData }, '\n')

  let jobId
  const res = resumeData ? [...(resumeData.results || [])] : []
  let realNameCount = resumeData ? (resumeData.realNameCount || 0) : 0

  // ── Stall alert (silent-stall detector) ──
  // Fired by lead-job-persistence when results.length hasn't grown for
  // LEAD_JOB_STALL_THRESHOLD_MS (default 120 s). Notifies admin only — the
  // customer keeps seeing the existing progress messages and we avoid spam.
  // onRecover closes the loop: fires once when progress resumes after a stall
  // alert so we know the upstream provider is healthy again.
  const onStall = (info) => {
    if (!bot || !TELEGRAM_ADMIN_CHAT_ID) return
    const msg =
      `🚨 [LeadJobs] STALL — job ${info.jobId.slice(0, 8)}… ` +
      `(${info.target || 'unknown target'}, chat ${info.chatId || '?'}) ` +
      `stuck at ${info.currentCount}/${info.targetCount || '?'} for ${info.stalledForSec}s. ` +
      `Likely CNAM/validation provider degradation — investigate Telnyx/Alcazar/Signalwire.`
    bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg).catch(() => {})
  }
  const onRecover = (info) => {
    if (!bot || !TELEGRAM_ADMIN_CHAT_ID) return
    const msg =
      `✅ [LeadJobs] STALL RESOLVED — job ${info.jobId.slice(0, 8)}… ` +
      `(${info.target || 'unknown target'}, chat ${info.chatId || '?'}) ` +
      `resumed at ${info.currentCount}/${info.targetCount || '?'} after ${info.stalledForSec}s stall. ` +
      `Upstream provider appears healthy again.`
    bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg).catch(() => {})
  }
  const stallMeta = { chatId, target: jobMeta.target, targetCount: phonesToGenerate, onRecover }

  if (resumeData) {
    // ── Resuming interrupted job — reuse jobId and existing results ──
    jobId = resumeData.jobId
    log(`[LeadJobs] Resuming job ${jobId} — ${res.length} existing results, ${realNameCount} real names, target ${phonesToGenerate}`)
    if (jobId) {
      startPeriodicSave(jobId, () => ({ results: res, realNameCount }), onStall, stallMeta)
    }
  } else {
    // ── Create persistent job ──
    jobId = await createJob({
      chatId,
      carrier,
      phonesToGenerate,
      countryCode,
      areaCodes,
      cnam,
      requireRealName,
      target: jobMeta.target,
      price: jobMeta.price,
      lang,
      walletDeducted: jobMeta.walletDeducted || false,
      paymentCoin: jobMeta.paymentCoin || null,
    }).catch(e => { log(`[LeadJobs] Create error: ${e.message}`); return null })

    // ── Start periodic progress saves ──
    if (jobId) {
      startPeriodicSave(jobId, () => ({ results: res, realNameCount }), onStall, stallMeta)
    }
  }
  let i = 0
  let elapsedTime = 0
  let noHitCount = 0
  let cnamMissStreak = 0 // Consecutive batches with 0 new real names
  const startTime = new Date()
  const t = translation('t', lang)

  try {
    // When requireRealName is true, we keep going until we have enough leads with real person names
    const targetCount = phonesToGenerate

    // ── Dynamic safety-net timeout (scales with order size) ──
    const phoneGenTimeout = computePhoneGenTimeout(targetCount, cnam)
    log(`[LeadJobs] phoneGenTimeout set to ${Math.round(phoneGenTimeout / 60000)}min for order of ${targetCount} leads (cnam=${!!cnam})`)

    // ── Area code CNAM management — disable CNAM for low-yield codes instead of dropping them ──
    const acYield = {} // { areaCode: { lookups: N, realNames: N } }
    const cnamDisabledAreas = new Set() // Area codes where CNAM is disabled (still generate numbers)
    let totalCnamLookups = 0

    // Completion check: once ANY area code has CNAM disabled, count total numbers (mix of named + unnamed)
    const isComplete = () => {
      if (requireRealName && cnam && cnamDisabledAreas.size === 0) {
        // All area codes still have CNAM — count only real names
        return realNameCount >= targetCount
      }
      // Some area codes lost CNAM — count all validated numbers toward target
      return res.length >= targetCount
    }

    for (i = 0; !isComplete(); i++) {
      // Gen Phone Numbers and Verify
      const areaCode = areaCodes[getRandom(areaCodes.length)]
      // Use CNAM only if enabled for this area code
      const useCnam = cnam && !cnamDisabledAreas.has(areaCode)
      const r = await Promise.all([
        sleep(waitAfterParallelApiCalls),
        validateNumbersParallel(carrier, parallelApiCalls, countryCode, areaCode, useCnam),
      ])
      if (r[1]) {
        res.push(...r[1])

        // Track CNAM lookups (only for area codes where CNAM is still active)
        if (useCnam) {
          const batchCnamLookups = r[1].filter(e => e[3] && e[3] !== 'VoIP Carrier').length
          totalCnamLookups += batchCnamLookups
        }

        // Count entries with real person names (whenever CNAM is enabled for this area code)
        if (cnam && useCnam) {
          let batchRealNames = 0
          for (const entry of r[1]) {
            if (entry[3] && isRealPersonName(entry[3])) {
              realNameCount++
              batchRealNames++
            }
          }

          // Track per-area-code yield
          if (!acYield[areaCode]) acYield[areaCode] = { lookups: 0, realNames: 0 }
          acYield[areaCode].lookups += r[1].length
          acYield[areaCode].realNames += batchRealNames

          // Evaluate area code after enough samples — disable CNAM if yield too low
          if (acYield[areaCode].lookups >= AREA_CODE_SAMPLE_SIZE) {
            const yieldRate = acYield[areaCode].realNames / acYield[areaCode].lookups
            if (yieldRate < AREA_CODE_MIN_YIELD) {
              cnamDisabledAreas.add(areaCode)
              log(`[LeadJobs] CNAM disabled for area code ${areaCode} — yield ${(yieldRate * 100).toFixed(1)}% (${acYield[areaCode].realNames}/${acYield[areaCode].lookups}) < ${AREA_CODE_MIN_YIELD * 100}% threshold. Will continue generating without CNAM.`)
              bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
                `📉 [CNAM] Disabled CNAM for area code <b>${areaCode}</b> — ${(yieldRate * 100).toFixed(1)}% yield (${acYield[areaCode].realNames}/${acYield[areaCode].lookups}). Numbers from this code will be delivered without names.`,
                { parse_mode: 'HTML' }).catch(() => {})
            }
          }

          // Track consecutive batches with 0 new real names (CNAM exhaustion detection)
          if (batchRealNames === 0 && r[1].length > 0) {
            cnamMissStreak++
          } else {
            cnamMissStreak = 0
          }
        }
      }

      // Publish Progress
      const currentProgress = cnamDisabledAreas.size > 0
        ? (res.length > targetCount ? targetCount : res.length)
        : (requireRealName && cnam ? realNameCount : (res.length > targetCount ? targetCount : res.length))
      const progress = t.buyLeadsProgress(currentProgress, targetCount)

      if (i % showProgressEveryXTime === 0) {
        bot && bot.sendMessage(chatId, progress)
        log(progress)
      }

      // ── Billing policy ──
      // Billable unit = total verified phone numbers delivered (res.length).
      // Real names are a bonus; the user receives every verified number across
      // both output files. A partial refund is only warranted when we could not
      // deliver the requested *volume* of phone numbers.

      // ── CNAM Exhaustion Check (all providers likely down) ──
      if (requireRealName && cnam && cnamMissStreak >= CNAM_MISS_THRESHOLD) {
        const msg = `⚠️ Lead generation paused — CNAM name lookup services are temporarily unavailable. Delivering ${res.length} of ${targetCount} leads (${realNameCount} with real names).`
        bot && bot.sendMessage(chatId, msg)
        bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
          `⚠️ [LeadJobs] CNAM exhausted for ${chatId} — ${cnamMissStreak} consecutive misses. ${res.length}/${targetCount} phones, ${realNameCount} with names.`)
        log(`[LeadJobs] CNAM exhausted: ${cnamMissStreak} consecutive batches with 0 names. Phones delivered=${res.length}/${targetCount}.`)
        if (jobId) await completeJob(jobId, res, realNameCount)
        // Only flag partial if phone volume falls short; otherwise treat as full delivery.
        if (res.length < targetCount) {
          res._partialReason = 'cnam_exhausted'
          res._deliveredCount = res.length
          res._targetCount = targetCount
        }
        return res
      }

      // Timeout Checks
      elapsedTime = new Date() - startTime
      if (elapsedTime > phoneGenTimeout) {
        const deliveredCount = Math.min(res.length, targetCount)
        if (res.length >= targetCount) {
          // Phone-volume target met → full delivery, no partial refund flow.
          const msg = `⏱️ Lead generation finished at the ${Math.round(elapsedTime / 60000)}-minute mark. Delivered ${targetCount} of ${targetCount} verified phone numbers (${realNameCount} with real names).`
          bot && bot.sendMessage(chatId, msg)
          bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
            `⏱️ [LeadJobs] Timeout for ${chatId} but volume met: ${res.length}/${targetCount} phones (${realNameCount} names) after ${Math.round(elapsedTime / 1000)}s — no refund.`)
          log(`[LeadJobs] Timeout at ${Math.round(elapsedTime / 60000)}min but volume met (${res.length}/${targetCount}) — no partial refund.`)
          if (jobId) await completeJob(jobId, res, realNameCount)
          return res
        }
        const msg = `⏱️ Lead generation timed out after ${Math.round(elapsedTime / 60000)} minutes. Delivering ${deliveredCount} of ${targetCount} leads.`
        bot && bot.sendMessage(chatId, msg)
        bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
          `⏱️ [LeadJobs] Timeout for ${chatId}: ${deliveredCount}/${targetCount} after ${Math.round(elapsedTime / 1000)}s`)
        if (jobId) await completeJob(jobId, res, realNameCount)
        res._partialReason = 'timeout'
        res._deliveredCount = deliveredCount
        res._targetCount = targetCount
        return res
      }
      noHitCount = !r[1] || r[1].length === 0 ? noHitCount + parallelApiCalls : 0
      log({ noHitCount, realNameCount, totalGenerated: res.length, cnamMissStreak, totalCnamLookups, cnamDisabledCodes: cnamDisabledAreas.size })

      // Early abort: if we hit 50 misses (10 batches) with 0 results at the very start,
      // it's likely the phone validation API is broken/expired (not just bad area codes)
      if (noHitCount >= 50 && res.length === 0 && i <= 10) {
        log(`[LeadJobs] ⚠️ EARLY ABORT — 50 consecutive misses with 0 total results in first ${i} iterations. Likely API key issue.`)
        bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
          `🚨 [LeadJobs] EARLY ABORT for ${chatId} — 0 results after ${noHitCount} attempts. Phone validation API may be down or key expired. Check Alcazar API key!`,
          { parse_mode: 'HTML' }).catch(() => {})
        if (jobId) await failJob(jobId, 'api_failure_suspected')
        // Return a 0-length array carrying the abort reason so the caller in
        // _index.js can show an honest "provider down" message instead of the
        // misleading "selected area code is unavailable" copy. Plain Array
        // doesn't preserve custom props across `if (!res || res.length === 0)`,
        // so attach the reason as a non-enumerable side-channel.
        const empty = []
        empty._abortReason = 'api_key_invalid'
        return empty
      }

      if (noHitCount > phoneGenStopAtNoXHits) {
        const deliveredCount = Math.min(res.length, targetCount)
        const msg = `⚠️ Could not find more valid phone numbers in this area. Delivering ${deliveredCount} of ${targetCount} leads.`
        bot && bot.sendMessage(chatId, msg)
        bot && bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID,
          `⚠️ [LeadJobs] No good hits for ${chatId}: ${deliveredCount}/${targetCount}`)
        if (jobId) await completeJob(jobId, res, realNameCount)
        if (res.length < targetCount) {
          res._partialReason = 'no_good_hits'
          res._deliveredCount = deliveredCount
          res._targetCount = targetCount
        }
        return res
      }

    }

    log(
      'elapsedTime',
      elapsedTime / 1000,
      'seconds, total tries',
      i * parallelApiCalls,
      'got',
      res.length,
      'mobile numbers',
      requireRealName ? `(${realNameCount} with real names)` : '',
      cnam ? `\nCNAM lookups: ${totalCnamLookups} (est. cost: $${(totalCnamLookups * CNAM_COST_PER_LOOKUP).toFixed(2)})` : '',
      cnamDisabledAreas.size > 0 ? `\nCNAM disabled for: ${[...cnamDisabledAreas].join(', ')}` : '',
      '\nareaCodeCount',
      areaCodeCount,
      requireRealName && cnam ? `\nareaCodeYield: ${Object.entries(acYield).map(([ac, v]) => `${ac}: ${(v.realNames/v.lookups*100).toFixed(0)}% (${v.realNames}/${v.lookups})`).join(', ')}` : '',
    )

    // ── Mark job completed ──
    if (jobId) await completeJob(jobId, res, realNameCount)

    return res
  } catch (e) {
    // Unexpected error — save whatever we have
    log(`[LeadJobs] Unexpected error in bulk generation: ${e.message}`)
    if (jobId) await failJob(jobId, e.message)
    throw e
  }
}

//
// validateBulkNumbers('T-mobile', 1, '1', ['310'], false).then(log) // US
// validateBulkNumbers('Mixed Carriers', 1, '1', ['310'], false).then(log) // US
// validateBulkNumbers('Mixed Carriers', 10, '1', ['416'], false).then(log) // Canada
// validateBulkNumbers('Mixed Carriers', 1, '61', ['4']).then(log) // Australia
// validateBulkNumbers('Mixed Carriers', 20, '44', ['71', '72', '73', '74', '75', '77', '78', '79']).then(log) // UK
// validateBulkNumbers('Mixed Carriers', 1, '64', ['23', '24', '25', '26']).then(log) // New Zealand

module.exports = { validateBulkNumbers, isRealPersonName }
