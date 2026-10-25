/*global Buffer process */
const fs = require('fs')
require('dotenv').config()
const axios = require('axios')
const QRCode = require('qrcode')
const { timeOf, freeDomainsOf, freeValidationsOf } = require('./config')
const { getAll, get, set } = require('./db')
const { log } = require('console')
const resolveDns = require('./resolve-cname.js')
const { checkExistingDomain, getNewDomain } = require('./cr-check-domain-available')
const { translation } = require('./translation.js')
const TELEGRAM_DEV_CHAT_ID = process.env.TELEGRAM_DEV_CHAT_ID

const HIDE_SMS_APP = process.env.HIDE_SMS_APP
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API_KEY_CURRENCY_EXCHANGE = process.env.API_KEY_CURRENCY_EXCHANGE
const UPDATE_DNS_INTERVAL = Number(process.env.UPDATE_DNS_INTERVAL || 60)
const PERCENT_INCREASE_USD_TO_NAIRA = Number(process.env.PERCENT_INCREASE_USD_TO_NAIRA)

// ── Exchange rate cache (10-min TTL) — avoids hitting API on every payment ──
let _cachedNgnRate = null
let _cachedNgnRateAt = 0
const NGN_RATE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

async function _fetchNgnRate() {
  const now = Date.now()
  if (_cachedNgnRate && (now - _cachedNgnRateAt) < NGN_RATE_CACHE_TTL) return _cachedNgnRate
  try {
    const apiUrl = `https://openexchangerates.org/api/latest.json?app_id=${API_KEY_CURRENCY_EXCHANGE}`
    const response = await axios.get(apiUrl, { timeout: 10000 })
    if (!response?.data?.rates?.['NGN']) {
      console.error('[ExchangeRate] Invalid API response — NGN rate missing')
      return null
    }
    _cachedNgnRate = response.data.rates['NGN']
    _cachedNgnRateAt = now
    return _cachedNgnRate
  } catch (error) {
    console.error(`[ExchangeRate] API fetch failed: ${error.message}`)
    // Return stale cache if available (better than nothing within 1 hour)
    if (_cachedNgnRate && (now - _cachedNgnRateAt) < 60 * 60 * 1000) return _cachedNgnRate
    return null
  }
}

// Helper function to get chat IDs - defined early to avoid hoisting issues
const getChatIds = async nameOf => {
  let ans = await getAll(nameOf)
  if (!ans) return []
  return ans.map(a => a._id)
}

function isValidUrl(url) {
  try {
    // More robust URL validation using built-in URL constructor
    if (!url || typeof url !== 'string') return false
    const urlObj = new URL(url)
    return ['http:', 'https:', 'ftp:'].includes(urlObj.protocol)
  } catch (error) {
    // If URL constructor throws, it's invalid
    return false
  }
}

// ─────────────────────────────────────────────────────────────
// sanitizeShortenerUrl — strip common user-typo junk from a URL
// so the shortener sees a clean value.
//
// Context (2026-04-21): User typed "https://canada.ca-cms.cfd." (trailing
// period). Node's URL() accepts trailing dots in hostnames so isValidUrl()
// returned true, but the shortener provider rejected it with 400 "URL is
// invalid". Admin got noisy error pings. Sanitize before validation so
// user-typos are caught early and we never call the shortener with garbage
// (Linkly, the current provider, accepts any string — so this is the only guard).
//
// Rules:
//   • Trim outer whitespace (including zero-width / unicode spaces).
//   • Strip trailing punctuation that's almost never part of a real URL:
//       . , ; ! ? ) ] } ' " < > » ‹ ›
//     (one or more, repeatedly)
//   • Strip a trailing `.` inside the hostname (normalizes `foo.com.` → `foo.com`).
//     We only trim ONE trailing dot from the hostname — subdomains with
//     legitimate dots are preserved.
//   • Leave query-string and path alone.
// ─────────────────────────────────────────────────────────────
function sanitizeShortenerUrl(raw) {
  if (!raw || typeof raw !== 'string') return raw
  // 1. Outer whitespace (regular + common unicode spaces)
  let s = raw.replace(/^[\s\u00A0\u200B]+|[\s\u00A0\u200B]+$/g, '')
  // 2. Trailing sentence punctuation (repeat until stable)
  // eslint-disable-next-line no-useless-escape
  s = s.replace(/[.,;!?)\]}'"<>»›]+$/g, '')
  // 3. Normalize trailing dot on the hostname only (e.g. example.com.)
  try {
    const u = new URL(s)
    if (u.hostname.endsWith('.') && u.hostname.length > 1) {
      u.hostname = u.hostname.replace(/\.+$/, '')
      s = u.toString()
      // URL.toString() may add a trailing `/` on an empty path — preserve
      // original "no trailing slash" if the sanitized input didn't have one.
      if (!raw.trim().endsWith('/') && s.endsWith('/') && u.pathname === '/') {
        s = s.slice(0, -1)
      }
    }
  } catch (_) {
    // not a valid URL after the lite cleanup — let downstream isValidUrl handle it
  }
  return s
}

function isDeveloper(chatId) {
  const devId = process.env.TELEGRAM_DEVELOPER_CHAT_ID
  if (!devId) return false
  // Handle both string and number comparisons after chatId typing fix
  return String(chatId) === String(devId)
}

function isAdmin(chatId) {
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!adminId) return false
  // Handle both string and number comparisons after chatId typing fix
  return String(chatId) === String(adminId)
}

async function usdToNgn(amountInUSD) {
  const rate = await _fetchNgnRate()
  if (!rate) return null // NGN payment unavailable — caller must handle null
  const nairaAmount = Number(amountInUSD) * rate * (1 + PERCENT_INCREASE_USD_TO_NAIRA)
  return Number(nairaAmount.toFixed())
}

async function ngnToUsd(ngn) {
  const rate = await _fetchNgnRate()
  if (!rate) return null // conversion unavailable — caller must handle null
  return Number(ngn) / (rate * (1 + PERCENT_INCREASE_USD_TO_NAIRA))
}

/**
 * Smart wallet deduct — USD only.
 * Uses atomic findOneAndUpdate with balance condition to prevent TOCTOU race conditions.
 * Used by auto-renewal schedulers and overage billing where there's no user interaction.
 *
 * Idempotency (added 2026-05-30): when `metadata.callRef` is supplied, this function
 * first checks for an existing `walletLedger` row with the same `callRef`. If found,
 * it skips the deduction entirely and returns `{success: true, idempotent: true}`.
 * This protects against duplicate Telnyx/Twilio webhook fires causing double-billing
 * (each provider can retry up to 8 times if the bot doesn't ACK within ~10s).
 *
 * @returns {{ success: boolean, currency: 'usd'|null, charged: number, idempotent?: boolean, usdBal?: number }}
 */
async function smartWalletDeduct(walletOf, chatId, amountUsd, metadata = {}) {
  const { atomicIncrement } = require('./db')
  const db = walletOf.s?.db

  // ── Idempotency guard ──
  // If a unique callRef is supplied (call_control_id for Telnyx, CallSid for Twilio,
  // or any other globally-unique handle), refuse to re-bill if we've already written
  // a ledger row for it. This stops duplicate-webhook double-billing at the database
  // level, surviving process restarts and multi-pod deploys (in-memory `Set`-based
  // dedup like `_twilioBilledCallSids` only catches same-process duplicates).
  if (metadata.callRef && db) {
    try {
      const existing = await db.collection('walletLedger').findOne(
        { callRef: metadata.callRef, chatId },
        { projection: { _id: 1, amount: 1, balanceAfter: 1 } }
      )
      if (existing) {
        log(`[smartWalletDeduct] Idempotent skip — callRef=${metadata.callRef} already billed (ledger=${existing._id})`)
        return { success: true, currency: 'usd', charged: 0, idempotent: true }
      }
    } catch (idemErr) {
      // Don't block billing on idempotency-check failures — log and proceed
      log(`[smartWalletDeduct] Idempotency check error (proceeding anyway): ${idemErr.message}`)
    }
  }

  // Atomic USD deduction: only deducts if current balance >= amountUsd
  try {
    // ── CRITICAL: pass `includeResultMetadata: false` (mongodb v5 default) ──
    // Without it, findOneAndUpdate returns `{ value: null|<doc>, lastErrorObject,
    // ok }` regardless of match. The wrapper is ALWAYS truthy, so a missing-match
    // (insufficient balance) was misread as success, the function silently wrote
    // a walletLedger row + returned success, and the call was effectively free.
    // Worse: `usdResult.usdIn` reads from the wrapper (always undefined), so
    // `balanceAfter` computed to `0 - 0 = 0` for every entry. Discovered during
    // 2026-05-30 user 890522022 audit.
    const usdResult = await walletOf.findOneAndUpdate(
      {
        _id: chatId,
        $expr: { $gte: [{ $subtract: [{ $ifNull: ['$usdIn', 0] }, { $ifNull: ['$usdOut', 0] }] }, amountUsd] }
      },
      { $inc: { usdOut: amountUsd } },
      { returnDocument: 'after', includeResultMetadata: false }
    )
    if (usdResult) {
      checkReferralReward(walletOf, chatId, amountUsd).catch(() => {})  // async, non-blocking

      // ── APPROACH B: Real-time wallet ledger entry ──
      // Every deduction is now traceable in walletLedger with full metadata
      try {
        if (db) {
          const { v4: uuidv4 } = require('uuid')
          const newBal = (usdResult.usdIn || 0) - (usdResult.usdOut || 0)
          db.collection('walletLedger').insertOne({
            _id: uuidv4(),
            chatId,
            type: metadata.type || 'wallet_deduction',
            amount: -amountUsd,
            currency: 'usd',
            balanceAfter: parseFloat(newBal.toFixed(4)),
            description: metadata.description || `Deduction: $${amountUsd.toFixed(4)}`,
            callType: metadata.callType || null,
            destination: metadata.destination || null,
            phoneNumber: metadata.phoneNumber || null,
            callRef: metadata.callRef || null,
            timestamp: new Date(),
          }).catch(async (e) => {
            // Duplicate-key (E11000) on callRef means another concurrent caller
            // got there first — treat as benign (idempotent path).
            if (e && e.code === 11000) {
              log(`[walletLedger] callRef ${metadata.callRef} already inserted by concurrent caller — refunding $${amountUsd.toFixed(4)} to chatId ${chatId}`)
              // Refund the just-deducted amount so net effect is zero.
              try {
                await walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: -amountUsd } })
              } catch (refundErr) {
                log(`[walletLedger] Concurrent-dup refund FAILED for chatId=${chatId} amount=$${amountUsd}: ${refundErr.message}`)
              }
              return
            }
            log(`[walletLedger] Insert error: ${e.message}`)
          })
        }
      } catch (_ledgerErr) { /* non-critical — don't break the deduction */ }

      return { success: true, currency: 'usd', charged: amountUsd }
    }
  } catch (e) {
    log(`[smartWalletDeduct] USD atomic deduct error: ${e.message}`)
  }

  // Insufficient USD balance
  const { usdBal } = await getBalance(walletOf, chatId)
  return { success: false, currency: null, charged: 0, usdBal }
}

/**
 * Force-settle an already-rendered charge as recoverable DEBT.
 *
 * Unlike smartWalletDeduct (atomic-conditional — silently no-ops when the
 * balance can't cover the charge, which permanently LOSES the revenue), this
 * ALWAYS records the charge, driving the wallet balance negative if needed.
 * The debt is recovered automatically on the user's next deposit because
 * balance = usdIn - usdOut (a top-up raises usdIn and nets out the debt).
 *
 * Use this ONLY for services that have ALREADY been delivered and therefore
 * MUST be billed (e.g. an outbound call that already connected). New-service
 * gating (LOW_BALANCE_LOCK etc.) still blocks fresh spend while the balance is
 * negative, so this cannot be abused to rack up unbounded debt.
 *
 * Mirrors the "force-charge as debt" precedent in retroactive-ivr-billing.js.
 *
 * @returns {{ success: true, forced: boolean, charged: number, balanceAfter: number, idempotent?: boolean }}
 */
async function forceWalletDebit(walletOf, chatId, amountUsd, metadata = {}) {
  const db = walletOf.s?.db
  const { v4: uuidv4 } = require('uuid')

  // ── Idempotency guard (same contract as smartWalletDeduct) ──
  // Duplicate hangup webhooks for the same callRef must never double-charge.
  if (metadata.callRef && db) {
    try {
      const existing = await db.collection('walletLedger').findOne(
        { callRef: metadata.callRef, chatId },
        { projection: { _id: 1 } }
      )
      if (existing) {
        log(`[forceWalletDebit] Idempotent skip — callRef=${metadata.callRef} already billed (ledger=${existing._id})`)
        const { usdBal } = await getBalance(walletOf, chatId)
        return { success: true, forced: false, charged: 0, balanceAfter: usdBal, idempotent: true }
      }
    } catch (idemErr) {
      log(`[forceWalletDebit] Idempotency check error (proceeding anyway): ${idemErr.message}`)
    }
  }

  // ── Unconditional debit — balance is allowed to go negative (debt) ──
  let newBal = 0
  try {
    const result = await walletOf.findOneAndUpdate(
      { _id: chatId },
      { $inc: { usdOut: amountUsd } },
      { returnDocument: 'after', upsert: true, includeResultMetadata: false }
    )
    newBal = (result?.usdIn || 0) - (result?.usdOut || 0)
  } catch (e) {
    log(`[forceWalletDebit] Debit error for chatId=${chatId} amount=$${amountUsd}: ${e.message}`)
    const { usdBal } = await getBalance(walletOf, chatId)
    return { success: false, forced: false, charged: 0, balanceAfter: usdBal }
  }

  // ── Ledger row — records the charge as a REAL debit (recoverable debt) ──
  if (db) {
    try {
      await db.collection('walletLedger').insertOne({
        _id: uuidv4(),
        chatId,
        type: metadata.type || 'wallet_deduction',
        amount: -amountUsd,
        currency: 'usd',
        balanceAfter: parseFloat(newBal.toFixed(4)),
        description: metadata.description || `Debt settlement: $${amountUsd.toFixed(4)}`,
        callType: metadata.callType || null,
        destination: metadata.destination || null,
        phoneNumber: metadata.phoneNumber || null,
        callRef: metadata.callRef || null,
        settledAsDebt: true,
        owedUsd: amountUsd,
        timestamp: new Date(),
      })
    } catch (e) {
      // Duplicate-key on callRef → a concurrent caller already billed it. Refund
      // our just-applied debit so the net effect is a single charge.
      if (e && e.code === 11000) {
        log(`[forceWalletDebit] callRef ${metadata.callRef} already inserted by concurrent caller — refunding $${amountUsd.toFixed(4)} to chatId ${chatId}`)
        try { await walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: -amountUsd } }) } catch (_) {}
        const { usdBal } = await getBalance(walletOf, chatId)
        return { success: true, forced: false, charged: 0, balanceAfter: usdBal, idempotent: true }
      }
      log(`[forceWalletDebit] Ledger insert error: ${e.message}`)
    }
  }

  return { success: true, forced: true, charged: amountUsd, balanceAfter: newBal }
}

/**
 * Check and process referral reward after a wallet deduction
 * If the user was referred and their cumulative spend >= $30, credit referrer $5
 */
async function checkReferralReward(walletOf, chatId, amountUsd) {
  try {
    const { MongoClient } = require('mongodb')
    const db = walletOf.s?.db || walletOf.dbName  // get db reference from collection
    // Access referrals collection from the same db
    const referralsCol = walletOf.s?.db?.collection('referrals') || null
    if (!referralsCol) return

    const ref = await referralsCol.findOne({ _id: chatId })
    if (!ref || ref.rewardPaid) return  // No referrer or already paid

    // Skip self-referrals — happens when a user joins without `?start=ref_*`
    // and the join code seeds `referrerChatId = chatId`. Paying a self-reward
    // would be free money / abuse vector.
    if (String(ref.referrerChatId) === String(chatId)) return

    // Update cumulative spend
    const newSpend = (ref.cumulativeSpend || 0) + amountUsd
    await referralsCol.updateOne({ _id: chatId }, { $set: { cumulativeSpend: newSpend } })

    // Check if threshold reached
    if (newSpend >= 30 && !ref.rewardPaid) {
      const REFERRAL_REWARD = 5
      // Credit referrer's wallet
      const { atomicIncrement } = require('./db')
      await atomicIncrement(walletOf, ref.referrerChatId, 'usdIn', REFERRAL_REWARD)
      // Mark reward as paid
      await referralsCol.updateOne({ _id: chatId }, { $set: { rewardPaid: true, rewardPaidAt: new Date() } })

      // Log payment record
      const paymentsCol = walletOf.s?.db?.collection('payments')
      if (paymentsCol) {
        const { nanoid } = require('nanoid')
        const payRef = nanoid()
        await paymentsCol.updateOne({ _id: payRef }, { $set: {
          val: `Referral,Reward,$${REFERRAL_REWARD},${ref.referrerChatId},${chatId},Referral reward — referred user spent $${newSpend.toFixed(2)},${new Date().toISOString()}`
        } }, { upsert: true })
      }

      log(`[Referral] 🎉 Reward paid! $${REFERRAL_REWARD} credited to ${ref.referrerChatId} (referred ${chatId} spent $${newSpend.toFixed(2)})`)

      // Try to notify the referrer via Telegram
      try {
        const TelegramBot = require('node-telegram-bot-api')
        const token = process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN_DEV
        if (token) {
          const notifyBot = new TelegramBot(token)
          const nameCol = walletOf.s?.db?.collection('nameOf')
          const refName = nameCol ? await nameCol.findOne({ _id: chatId }) : null
          const userName = refName?.val || `User ${chatId}`
          await notifyBot.sendMessage(ref.referrerChatId,
            `🎉 <b>Referral Reward!</b>\n\n` +
            `Your referral <b>${userName}</b> has spent $${newSpend.toFixed(2)}.\n` +
            `💰 <b>$${REFERRAL_REWARD}.00</b> has been added to your wallet!\n\n` +
            `Keep sharing to earn more!`,
            { parse_mode: 'HTML' }
          ).catch(() => {})
        }
      } catch (e) { /* notification is best-effort */ }
    }
  } catch (e) {
    log(`[Referral] checkReferralReward error: ${e.message}`)
  }
}

/**
 * Smart wallet check — checks if USD balance covers the amount.
 * @returns {{ sufficient: boolean, currency: 'usd'|null, usdBal: number }}
 */
async function smartWalletCheck(walletOf, chatId, amountUsd) {
  const { usdBal } = await getBalance(walletOf, chatId)
  if (usdBal >= amountUsd) return { sufficient: true, currency: 'usd', usdBal }
  return { sufficient: false, currency: null, usdBal }
}
const addZero = number => (number < 10 ? '0' + number : number)
const date = (date) => {
  try {
    const currentDate = date ? new Date(date) : new Date()
    if (isNaN(currentDate.getTime())) {
      console.error('Invalid date provided:', date)
      return new Date().toISOString()
    }
    const year = currentDate.getFullYear()
    const month = addZero(currentDate.getMonth() + 1)
    const day = addZero(currentDate.getDate())
    const hours = addZero(currentDate.getHours())
    const minutes = addZero(currentDate.getMinutes())
    const seconds = addZero(currentDate.getSeconds())

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  } catch (error) {
    console.error('Error in date function:', error.message)
    return new Date().toISOString()
  }
}

// Safe JSON stringify that handles circular references
const safeStringify = (obj, replacer = null, space = 2) => {
  try {
    const seen = new WeakSet()
    return JSON.stringify(obj, (key, val) => {
      if (val != null && typeof val === 'object') {
        if (seen.has(val)) {
          return '[Circular]'
        }
        seen.add(val)
      }
      return replacer ? replacer(key, val) : val
    }, space)
  } catch (error) {
    return `[Object stringify error: ${error.message}]`
  }
}

// Enhanced API error handler for better debugging

function today() {
  const currentDate = new Date()
  const day = currentDate.getDate()
  const month = currentDate.getMonth() + 1 // Note: Months are 0-indexed
  const year = currentDate.getFullYear()

  const formattedDate = `${day}-${month}-${year}`
  return formattedDate
}

function week() {
  const currentDate = new Date()
  const startDate = new Date(currentDate.getFullYear(), 0, 1)
  const days = Math.floor((currentDate - startDate) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.ceil(days / 7)

  return year() + ' Week ' + weekNumber
}

function month() {
  const currentDate = new Date()
  return year() + ' Month ' + (currentDate.getMonth() + 1)
}

function year() {
  const currentDate = new Date()
  return 'Year ' + currentDate.getFullYear()
}

function isValidEmail(email) {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return regex.test(email)
}

function removeProtocolFromDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return domain || ''
  }
  return domain.toLowerCase().replace('https://', '').replace('http://', '')
}

const regularCheckDns = (bot, chatId, domain, lang) => {
  const checkDnsPropagation = async () => {
    if (await resolveDns(domain)) {
      bot.sendMessage(chatId, translation('t.dnsPropagated', lang).replace('{{domain}}', domain))
      clearInterval(intervalDnsPropagation)
      return
    }
    bot.sendMessage(chatId, translation('t.dnsNotPropagated', lang).replace('{{domain}}', domain))
  }
  const intervalDnsPropagation = setInterval(checkDnsPropagation, UPDATE_DNS_INTERVAL * 1000)

  setTimeout(() => {
    clearInterval(intervalDnsPropagation)
  }, 60 * 60 * 1000)
}

const getRandom = n => Math.floor(Math.random() * n)

const nextNumber = arr => {
  let n = 1
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === n) n++
    else return n
  }
  return n
}

// Import broadcast configuration
const BROADCAST_CONFIG = require('./broadcast-config.js')

// Detect permanent Telegram errors where retrying is pointless
function isPermanentTelegramError(error) {
  const msg = (error.message || '').toLowerCase()
  return msg.includes('chat not found') || msg.includes('user is deactivated') || msg.includes('bot was blocked') || msg.includes('have no rights to send a message')
}

const sendMessageToAllUsers = async (bot, message, method, nameOf, myChatId, db, opts = {}) => {
  try {
    const chatIds = await getChatIds(nameOf)
    
    if (chatIds.length === 0) {
      bot.sendMessage(myChatId, 'No users found to broadcast to.')
      return
    }

    // Pre-filter permanently unreachable users if DB is available
    let filteredChatIds = chatIds
    let skippedPermanent = 0
    if (db) {
      const promoOptOut = db.collection('promoOptOut')
      const allOptedOut = await promoOptOut.find({ optedOut: true }).toArray()
      const deadSet = new Set(allOptedOut.map(r => r._id))
      filteredChatIds = chatIds.filter(id => !deadSet.has(id))
      skippedPermanent = chatIds.length - filteredChatIds.length
    }
    // Optional: skip people who already got this message (e.g. an earlier targeted send)
    if (opts.excludeIds?.length) {
      const exclude = new Set(opts.excludeIds.map(String))
      filteredChatIds = filteredChatIds.filter(id => !exclude.has(String(id)))
    }

    const total = filteredChatIds.length
    const { BATCH_SIZE, DELAY_BETWEEN_BATCHES, DELAY_BETWEEN_MESSAGES, MAX_RETRIES, RETRY_DELAY } = BROADCAST_CONFIG

    // ── Persist broadcast job to MongoDB for crash/redeploy recovery ──
    const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    if (db) {
      await db.collection('broadcastJobs').insertOne({
        _id: broadcastId,
        status: 'running',
        adminChatId: myChatId,
        message,
        method,
        chatIds: filteredChatIds,
        totalUsers: chatIds.length,
        skippedPermanent,
        lastProcessedIndex: 0,
        successCount: 0,
        errorCount: 0,
        newlyDeadCount: 0,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      log(`[Broadcast] Job ${broadcastId} created — ${total} users to send`)
    }

    await _executeBroadcast(bot, db, broadcastId, filteredChatIds, message, method, myChatId, 0, 0, 0, 0, skippedPermanent, chatIds.length)
  } catch (error) {
    log(`Broadcast error: ${error.message}`)
    bot.sendMessage(myChatId, `Broadcast failed: ${error.message}`)
  }
}

/**
 * Core broadcast execution — shared by fresh starts and resumptions.
 * @param {number} startIndex - index into chatIds to resume from
 */
async function _executeBroadcast(bot, db, broadcastId, filteredChatIds, message, method, myChatId, startIndex, successCount, errorCount, newlyDeadCount, skippedPermanent, totalUsersRaw) {
  const total = filteredChatIds.length
  const { BATCH_SIZE, DELAY_BETWEEN_BATCHES, DELAY_BETWEEN_MESSAGES, MAX_RETRIES, RETRY_DELAY } = BROADCAST_CONFIG
  const totalBatches = Math.ceil(total / BATCH_SIZE)
  const startBatch = Math.floor(startIndex / BATCH_SIZE)
  const startTime = Date.now()

  const isResume = startIndex > 0
  if (!isResume) {
    bot.sendMessage(myChatId, `Starting broadcast to ${total} users (${skippedPermanent} permanently unreachable skipped)...\nBatch size: ${BATCH_SIZE}\nEstimated time: ${Math.ceil(total / BATCH_SIZE)} seconds`)
  }

  for (let i = startIndex; i < total; i += BATCH_SIZE) {
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1
    const batch = filteredChatIds.slice(i, i + BATCH_SIZE)

    bot.sendMessage(myChatId, `Processing batch ${currentBatch}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, total)} of ${total})`)

    const batchPromises = batch.map(async (chatId, index) => {
      await sleep(index * DELAY_BETWEEN_MESSAGES)

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // ── Resolve Telegram send options from `method` ──
          // Historically `method` was used only to distinguish 'sendPhoto', but callers
          // also pass 'HTML' / 'Markdown' / 'MarkdownV2' to request a parse mode.
          // Without this, announcements with <b> tags render as literal text.
          const isPhoto = method === 'sendPhoto'
          const parseMode =
            method === 'HTML' || method === 'Markdown' || method === 'MarkdownV2'
              ? method
              : null
          const sendOpts = parseMode
            ? { parse_mode: parseMode, disable_web_page_preview: true }
            : {}

          if (isPhoto) {
            await bot.sendPhoto(chatId, message)
          } else {
            await bot.sendMessage(chatId, message, sendOpts)
          }
          successCount++
          if (db) {
            db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: false, failCount: 0, updatedAt: new Date() } }).catch(() => {})
          }
          return { success: true, chatId, attempts: attempt }
        } catch (error) {
          const errMsg = (error.message || '').toLowerCase()
          const isTrulyPermanent = errMsg.includes('user is deactivated')
          const isLikelyPermanent = errMsg.includes('chat not found') || errMsg.includes('bot was blocked') || errMsg.includes('have no rights to send a message')

          if (isTrulyPermanent) {
            errorCount++
            newlyDeadCount++
            if (db) {
              await db.collection('promoOptOut').updateOne(
                { _id: chatId },
                { $set: { optedOut: true, reason: 'user_deactivated', updatedAt: new Date() } },
                { upsert: true }
              )
            }
            return { success: false, chatId, error: error.message, permanent: true }
          }

          if (isLikelyPermanent && attempt === MAX_RETRIES) {
            errorCount++
            newlyDeadCount++
            if (db) {
              const reason = errMsg.includes('chat not found') ? 'chat_not_found' :
                             errMsg.includes('bot was blocked') ? 'bot_blocked' : 'no_rights'
              await db.collection('promoOptOut').updateOne(
                { _id: chatId },
                { $set: { reason, updatedAt: new Date() }, $inc: { failCount: 1 } },
                { upsert: true }
              )
              const record = await db.collection('promoOptOut').findOne({ _id: chatId })
              if (record?.failCount >= 3) {
                await db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: true } })
              }
            }
            return { success: false, chatId, error: error.message, permanent: true }
          }

          if (!isLikelyPermanent && isPermanentTelegramError(error)) {
            errorCount++
            return { success: false, chatId, error: error.message, permanent: true }
          }

          if (attempt === MAX_RETRIES) {
            errorCount++
            log(`Failed to send message to ${chatId} after ${MAX_RETRIES} attempts: ${error.message}`)
            return { success: false, chatId, error: error.message, attempts: attempt }
          } else {
            log(`Attempt ${attempt} failed for ${chatId}, retrying in ${RETRY_DELAY / 1000}s...`)
            await sleep(RETRY_DELAY)
          }
        }
      }
    })

    await Promise.allSettled(batchPromises)

    // ── Checkpoint: persist progress after each batch ──
    const processedUpTo = Math.min(i + BATCH_SIZE, total)
    if (db && broadcastId) {
      db.collection('broadcastJobs').updateOne(
        { _id: broadcastId },
        { $set: { lastProcessedIndex: processedUpTo, successCount, errorCount, newlyDeadCount, updatedAt: new Date() } }
      ).catch(e => log(`[Broadcast] Checkpoint save error: ${e.message}`))
    }

    bot.sendMessage(myChatId, `Batch ${currentBatch}/${totalBatches} completed\nSuccess: ${successCount}, Errors: ${errorCount}`)

    if (i + BATCH_SIZE < total) {
      await sleep(DELAY_BETWEEN_BATCHES)
    }
  }

  // ── Mark broadcast as completed ──
  if (db && broadcastId) {
    await db.collection('broadcastJobs').updateOne(
      { _id: broadcastId },
      { $set: { status: 'completed', lastProcessedIndex: total, successCount, errorCount, newlyDeadCount, completedAt: new Date(), updatedAt: new Date() } }
    ).catch(() => {})
  }

  const finalMessage = `${isResume ? '🔄 Resumed b' : 'B'}roadcast completed!\n\nFinal Results:\nSuccessfully sent: ${successCount}\nFailed: ${errorCount}\nPermanently unreachable (newly found): ${newlyDeadCount}\nPre-filtered (known dead): ${skippedPermanent}\nSuccess rate: ${((successCount / total) * 100).toFixed(1)}%`
  bot.sendMessage(myChatId, finalMessage)
  log(`Broadcast ${broadcastId} completed - Total: ${total}, Success: ${successCount}, Errors: ${errorCount}, NewlyDead: ${newlyDeadCount}, PreFiltered: ${skippedPermanent}`)
}

/**
 * Recover and resume any broadcasts that were interrupted by a server restart/redeploy.
 * Call this during startup after DB is connected.
 */
async function recoverBroadcast(bot, db) {
  if (!db) return
  try {
    const running = await db.collection('broadcastJobs').find({ status: 'running' }).toArray()
    if (running.length === 0) {
      log('[Broadcast] Recovery: No interrupted broadcasts to resume')
      return
    }

    for (const job of running) {
      const broadcastId = job._id
      const chatIds = job.chatIds || []
      const startIndex = job.lastProcessedIndex || 0
      const total = chatIds.length
      const remaining = total - startIndex

      // Stale check: if broadcast was started >6 hours ago with no progress in last 2 hours, cancel it
      const hoursSinceStart = (Date.now() - new Date(job.startedAt).getTime()) / (1000 * 60 * 60)
      const hoursSinceUpdate = (Date.now() - new Date(job.updatedAt).getTime()) / (1000 * 60 * 60)
      if (hoursSinceStart > 6 && hoursSinceUpdate > 2) {
        await db.collection('broadcastJobs').updateOne(
          { _id: broadcastId },
          { $set: { status: 'cancelled', cancelledReason: `Stale: ${Math.round(hoursSinceStart)}h since start, ${Math.round(hoursSinceUpdate)}h since last update`, updatedAt: new Date() } }
        )
        log(`[Broadcast] Recovery: Cancelled stale broadcast ${broadcastId} (${Math.round(hoursSinceStart)}h old)`)
        bot.sendMessage(job.adminChatId,
          `⚠️ <b>Broadcast Auto-Cancelled</b>\n\nYour broadcast was cancelled after a server restart because it had been idle for over 2 hours.\n✅ Sent: ${job.successCount || 0}\n❌ Remaining: ${remaining}\n\nStart a new broadcast if needed.`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
        continue
      }

      // Already fully sent — just mark completed
      if (remaining <= 0) {
        await db.collection('broadcastJobs').updateOne(
          { _id: broadcastId },
          { $set: { status: 'completed', completedAt: new Date(), updatedAt: new Date() } }
        )
        log(`[Broadcast] Recovery: Broadcast ${broadcastId} was already complete — marked finished`)
        continue
      }

      log(`[Broadcast] Recovery: Resuming broadcast ${broadcastId} — ${remaining}/${total} remaining (was at index ${startIndex})`)
      bot.sendMessage(job.adminChatId,
        `🔄 <b>Broadcast Resuming</b>\n\nYour admin broadcast is being resumed after a server restart.\n📤 Remaining: <b>${remaining}</b> users\n✅ Already sent: <b>${startIndex}</b>\n✅ Success: ${job.successCount || 0} | ❌ Errors: ${job.errorCount || 0}\n\nContinuing now...`,
        { parse_mode: 'HTML' }
      ).catch(() => {})

      // Resume in background
      _executeBroadcast(
        bot, db, broadcastId, chatIds, job.message, job.method,
        job.adminChatId, startIndex, job.successCount || 0, job.errorCount || 0,
        job.newlyDeadCount || 0, job.skippedPermanent || 0, job.totalUsers || total
      ).catch(e => {
        log(`[Broadcast] Recovery: Resume failed for ${broadcastId}: ${e.message}`)
        bot.sendMessage(job.adminChatId, `❌ Broadcast resume failed: ${e.message}`).catch(() => {})
      })

      // Stagger if multiple broadcasts (unlikely but safe)
      await sleep(2000)
    }
  } catch (err) {
    log(`[Broadcast] Recovery error: ${err.message}`)
  }
}

// Helper function to get broadcast statistics
const getBroadcastStats = async (nameOf) => {
  try {
    const chatIds = await getChatIds(nameOf)
    const total = chatIds.length
    
    return {
      totalUsers: total,
      estimatedBatchTime: Math.ceil(total / BROADCAST_CONFIG.BATCH_SIZE),
      batchSize: BROADCAST_CONFIG.BATCH_SIZE,
      delayBetweenBatches: BROADCAST_CONFIG.DELAY_BETWEEN_BATCHES / 1000,
      maxRetries: BROADCAST_CONFIG.MAX_RETRIES
    }
  } catch (error) {
    log(`Error getting broadcast stats: ${error.message}`)
    return null
  }
}

/**
 * Broadcast a new marketplace listing to ALL bot users (background, non-blocking).
 * Sends the first product image with caption + inline buttons for chat & escrow.
 * Skips the seller who created the listing and known dead users.
 */
const broadcastNewListing = async (bot, product, nameOf, db) => {
  try {
    let chatIds = await getChatIds(nameOf)
    if (!chatIds.length) return

    // Exclude the seller themselves
    chatIds = chatIds.filter(id => String(id) !== String(product.sellerId))

    // Pre-filter ALL opted-out users (not just specific reasons)
    // This prevents wasting API calls on known-dead users
    let skippedPermanent = 0
    if (db) {
      const promoOptOut = db.collection('promoOptOut')
      const allOptedOut = await promoOptOut.find({ optedOut: true }).toArray()
      const deadSet = new Set(allOptedOut.map(r => r._id))
      const before = chatIds.length
      chatIds = chatIds.filter(id => !deadSet.has(id))
      skippedPermanent = before - chatIds.length
    }

    const total = chatIds.length
    if (!total) return
    log(`[Marketplace Broadcast] Starting — product ${product._id} to ${total} users (${skippedPermanent} dead skipped)`)

    const { BATCH_SIZE, DELAY_BETWEEN_BATCHES, DELAY_BETWEEN_MESSAGES, MAX_RETRIES, RETRY_DELAY } = BROADCAST_CONFIG

    const caption = `🆕 <b>New Listing!</b>\n\n` +
      `🏷️ <b>${product.title}</b>\n` +
      `📄 ${product.description}\n\n` +
      `💰 <b>$${Number(product.price).toFixed(2)}</b>  ·  ${product.category}\n` +
      `👤 Seller: @${product.sellerUsername || 'anonymous'}\n\n` +
      `🔒 Escrow Protected — Buy with confidence`

    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💬 Chat with Seller', callback_data: `mp:chat:${product._id}` },
            { text: '🔒 Start Escrow', callback_data: `mp:escrow_product:${product._id}` }
          ]
        ]
      },
      parse_mode: 'HTML'
    }

    const hasImage = product.images && product.images.length > 0
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = chatIds.slice(i, i + BATCH_SIZE)
      const batchPromises = batch.map(async (cid, index) => {
        await sleep(index * DELAY_BETWEEN_MESSAGES)
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (hasImage) {
              await bot.sendPhoto(cid, product.images[0].fileId, { caption, ...inlineKeyboard })
            } else {
              await bot.sendMessage(cid, caption, inlineKeyboard)
            }
            successCount++
            // Reset failCount on success — user is reachable
            if (db) {
              db.collection('promoOptOut').updateOne({ _id: cid }, { $set: { optedOut: false, failCount: 0, updatedAt: new Date() } }).catch(() => {})
            }
            return
          } catch (error) {
            const errMsg = (error.message || '').toLowerCase()
            const isTrulyPermanent = errMsg.includes('user is deactivated')
            const isLikelyPermanent = errMsg.includes('chat not found') || errMsg.includes('bot was blocked') || errMsg.includes('have no rights to send a message')
            if (isTrulyPermanent) {
              errorCount++
              if (db) {
                await db.collection('promoOptOut').updateOne({ _id: cid }, { $set: { optedOut: true, reason: 'user_deactivated', updatedAt: new Date() } }, { upsert: true })
              }
              return
            }
            if (isLikelyPermanent && attempt === MAX_RETRIES) {
              errorCount++
              if (db) {
                const reason = errMsg.includes('chat not found') ? 'chat_not_found' : errMsg.includes('bot was blocked') ? 'bot_blocked' : 'no_rights'
                await db.collection('promoOptOut').updateOne({ _id: cid }, { $set: { reason, updatedAt: new Date() }, $inc: { failCount: 1 } }, { upsert: true })
                const record = await db.collection('promoOptOut').findOne({ _id: cid })
                if (record?.failCount >= 3) {
                  await db.collection('promoOptOut').updateOne({ _id: cid }, { $set: { optedOut: true } })
                }
              }
              return
            }
            if (attempt === MAX_RETRIES) {
              errorCount++
              return
            }
            await sleep(RETRY_DELAY)
          }
        }
      })
      await Promise.allSettled(batchPromises)
      if (i + BATCH_SIZE < total) await sleep(DELAY_BETWEEN_BATCHES)
    }
    log(`[Marketplace Broadcast] Done — product ${product._id}: ${successCount} sent, ${errorCount} failed out of ${total}`)
  } catch (error) {
    log(`[Marketplace Broadcast] Error: ${error.message}`)
  }
}

const sendQrCode = async (bot, chatId, bb, lang) => {
  const qrCode = await bb.getQrcode()
  const buffer = Buffer.from(qrCode?.qr_code, 'base64')
  fs.writeFileSync('image.png', buffer)
  bot
    ?.sendPhoto(chatId, 'image.png', {
      caption: translation('t.qrCodeText', lang),
    })
    ?.then(() => fs.unlinkSync('image.png'))
    ?.catch(log)
}

const sendQr = async (bot, chatId, text, caption) => {
  const buffer = await QRCode.toDataURL(text)
  fs.writeFileSync('image.png', buffer.split(';base64,').pop(), { encoding: 'base64' })
  bot
    ?.sendPhoto(chatId, 'image.png', { caption })
    ?.then(() => fs.unlinkSync('image.png'))
    ?.catch(log)
}

const generateQr = async (bot, chatId, data, lang) => {
  fs.writeFileSync('image.png', data.split(';base64,').pop(), { encoding: 'base64' })
  bot
    ?.sendPhoto(chatId, 'image.png', {  caption:  translation('t.qrCodeText', lang), })
    ?.then(() => fs.unlinkSync('image.png'))
    ?.catch(log)
}

const getBalance = async (walletOf, chatId) => {
  const wallet = await get(walletOf, chatId)

  const usdBal = (wallet?.usdIn || 0) - (wallet?.usdOut || 0)

  return { usdBal }
}

const subscribePlan = async (planEndingTime, freeDomainNamesAvailableFor, planOf, chatId, plan, bot, lang, freeValidationsAvailableFor, stateOf) => {
  const duration = timeOf[plan]
  if (!duration) {
    console.error(`[subscribePlan] Invalid plan type "${plan}" for chatId ${chatId} — aborting subscription`)
    return
  }

  // Buying while a plan is still active adds the new period on top of the current expiry (no paid days lost).
  const now = Date.now()
  const current = Number(await get(planEndingTime, chatId)) || 0
  const endTime = Math.max(current, now) + duration
  await set(planOf, chatId, plan)
  await set(planEndingTime, chatId, endTime)
  // New term → re-arm the 3-day / 1-day reminders; a window the term already starts inside (e.g. a Daily plan)
  // is marked done so no "expires tomorrow" message arrives minutes after paying.
  if (stateOf) {
    const left = endTime - now
    await stateOf.updateOne({ _id: String(chatId) }, { $set: { 'reminders.botPlan3DayReminderSent': left <= 3.1 * 86400000, 'reminders.botPlan1DayReminderSent': left <= 1.1 * 86400000, 'reminders.botPlanExpiredSent': false } }, { upsert: true }).catch(() => {})
  }
  // Free domains removed - no longer granted with subscription
  // set(freeDomainNamesAvailableFor, chatId, freeDomainsOf[plan])
  if (freeValidationsAvailableFor) {
    set(freeValidationsAvailableFor, chatId, freeValidationsOf[plan])
  }
  const t = translation('t', lang)

  log(`[subscribePlan] chatId=${chatId} plan=${plan} expires=${new Date(endTime).toISOString()}`)
  sendMessage(chatId, t.planSubscribed.replace('{{plan}}', plan))
  log('reply:\t' + t.planSubscribed.replace('{{plan}}', plan) + '\tto: ' + chatId)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const parse = (cc, s) => {
  try {
    if (!s || typeof s !== 'string') return ''
    const cleanedStr = s.replace(`+${cc}`, ``).replace(/[^\d]/g, '')
    const parsed = parseInt(cleanedStr, 10)
    return isNaN(parsed) ? '' : parsed.toString()
  } catch (error) {
    console.error('Error in parse function:', error.message)
    return ''
  }
}

const getInt = str => {
  try {
    if (!str || typeof str !== 'string') return null
    const match = str.match(/\d+/)
    return match ? parseInt(match[0], 10) : null
  } catch (error) {
    console.error('Error in getInt function:', error.message)
    return null
  }
}
// const phoneLen = {
//   1: 11,
//   64: 11,
//   61: 11,
//   44: 12,
// }

// const areaCodeLength = {
//   1: 3,
//   44: 2,
//   64: 2,
//   61: 1,
// }

function extractPhoneNumbers(text, cc) {
  const phoneRegex = /\b(?:\+?\d{1,4}[ -]?)?(?:\(\d{1,}\)[ -]?)?\d{1,}[- ]?\d{1,}[- ]?\d{1,}\b/g
  let phones = text.match(phoneRegex) || []
  phones = phones.map(phoneNumber => phoneNumber.replace(/[\s()-+]/g, ''))
  // phones = phones.filter(phoneNumber => phoneNumber.length === phoneLen[cc])

  const lenBefore = phones.length
  phones = phones.filter(phoneNumber => phoneNumber.startsWith(cc))
  const lenAfter = phones.length

  return { phones, diff: lenBefore - lenAfter }
}

const sendMessage = async (chatId, message, reply_markup) => {
  try {
    console.log({ message, chatId })
    const opts = reply_markup || {}
    // Auto-detect HTML and inject parse_mode so tags like <b>, <i>, <code>, <a>, <pre>, <u>, <s>
    // render correctly instead of being shown as literal text. Mirrors the
    // behavior of the `send()` helper in _index.js.
    if (typeof message === 'string' && !opts.parse_mode && /<\/?(?:b|i|u|s|code|pre|a)\b/.test(message)) {
      opts.parse_mode = 'HTML'
    }
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      ...opts,
    })
  } catch (error) {
    console.error('Error sending message:', { code: error?.message, data: error?.response?.data, chatId, message })
  }
}

// sendMessage(6687923716, 'Hello, world!') // unit test

async function checkFreeTrialTaken(c, chatId) {
  const result = await c.findOne({ _id: chatId })

  // Check if current package is a free plan
  const currentPackage = result?.currentPackage
  if (currentPackage && currentPackage.name === 'Freedom Plan') {
    return 'already-used'
  }

  // Check if any previous package was a free plan
  const previousPackages = result?.previousPackages || []
  const hasUsedFreePlan = previousPackages.some(pkg => pkg.name === 'Freedom Plan')

  if (hasUsedFreePlan) {
    return 'already-used'
  }

  return 'not_taken' // If neither current nor previous packages are 'Freedom Plan'
}

const planCheckExistingDomain = (domainName, hostingType) => checkExistingDomain(domainName, hostingType)

async function planGetNewDomain(message, chatId, send, saveInfo, hostingType, verbose = true) {
  try {
    let modifiedDomain = removeProtocolFromDomain(message)

    const { available, originalPrice, price, chatMessage, domainType, registrar } = await getNewDomain(modifiedDomain, hostingType)
    if (!available) {
      // if(verbose) {
        await send(chatId, chatMessage)
      // }
      return getDefaultDomainResponse()
    }
    if (!originalPrice) {
      await send(TELEGRAM_DEV_CHAT_ID, 'Some issue in getting price')
      if(verbose) {
        await send(chatId, 'Some issue in getting price')
      }
      return getDefaultDomainResponse()
    }

    saveDomainInfo(saveInfo, modifiedDomain, price, originalPrice, registrar)
    return { modifiedDomain, price, domainType, chatMessage, registrar }
  } catch (error) {
    return getDefaultDomainResponse()
  }
}

function getDefaultDomainResponse() {
  return { modifiedDomain: null, price: null, domainType: null }
}

function saveDomainInfo(saveInfo, modifiedDomain, price, originalPrice, registrar) {
  saveInfo('price', price)
  saveInfo('domain', modifiedDomain)
  saveInfo('originalPrice', originalPrice)
  if (registrar) saveInfo('registrar', registrar)
}

// log(format('1', '4'))
// log(format('1', '20'))
// log(format('1', '200'))
// log(format('1', '201'))
// log(format('1', '213'))

// log(parse('1', '+1(04)'))
// log(parse('1', '+1(20)'))
// log(parse('1', '+1(200)'))
// log(parse('1', '+1(201)'))
// log(parse('1', '+1(213)'))

module.exports = {
  getInt,
  parse,
  year,
  week,
  today,
  month,
  date,
  sleep,
  sendMessage,
  isAdmin,
  usdToNgn,
  ngnToUsd,
  smartWalletDeduct,
  forceWalletDebit,
  checkReferralReward,
  smartWalletCheck,
  getRandom,
  isValidUrl,
  sanitizeShortenerUrl,
  sendQrCode,
  sendQr,
  generateQr,
  getBalance,
  nextNumber,
  isDeveloper,
  isValidEmail,
  
  subscribePlan,
  
  regularCheckDns,
  checkFreeTrialTaken,
  extractPhoneNumbers,
  sendMessageToAllUsers,
  recoverBroadcast,
  broadcastNewListing,
  getBroadcastStats,
  getChatIds,
  planGetNewDomain,
  planCheckExistingDomain,
  removeProtocolFromDomain,
  safeStringify,
  
}
