// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Monetization Engine
// 4 features to convert subscribers → paying customers:
// 1. Smart Upsell Triggers (limit-hit → sale)
// 2. First-Purchase Welcome Bonus ($3 on first deposit)
// 3. Win-Back Campaign (re-engage inactive users)
// 4. Service Bundles (discounted multi-service packages)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const schedule = require('node-schedule')
const { customAlphabet } = require('nanoid')
const { log } = require('console')

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)

// ━━━ Environment config ━━━
const WELCOME_BONUS_USD = parseFloat(process.env.WELCOME_BONUS_USD || '3')
const WINBACK_INACTIVE_DAYS = parseInt(process.env.WINBACK_INACTIVE_DAYS || '7')
const WINBACK_DISCOUNT_PERCENT = parseInt(process.env.WINBACK_DISCOUNT_PERCENT || '20')
const WINBACK_CODE_EXPIRY_HOURS = parseInt(process.env.WINBACK_CODE_EXPIRY_HOURS || '48')

// ━━━ Pricing from env ━━━
const PRICE_DAILY = Number(process.env.PRICE_DAILY_SUBSCRIPTION || 50)
const PRICE_WEEKLY = Number(process.env.PRICE_WEEKLY_SUBSCRIPTION || 100)
const PRICE_MONTHLY = Number(process.env.PRICE_MONTHLY_SUBSCRIPTION || 200)
const PHONE_STARTER_PRICE = Number(process.env.PHONE_STARTER_PRICE || 50)
const PHONE_PRO_PRICE = Number(process.env.PHONE_PRO_PRICE || 75)
const PHONE_BUSINESS_PRICE = Number(process.env.PHONE_BUSINESS_PRICE || 120)
const PREMIUM_ANTIRED_WEEKLY = Number(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE || 30)
const PREMIUM_ANTIRED_CPANEL = Number(process.env.PREMIUM_ANTIRED_CPANEL_PRICE || 75)
// ── Single source of truth for per-minute overage / forwarding rates ──
// Read from the SAME env vars phone-config.js uses so the upsell copy can never
// quote a different rate than the billing engine (audit P0: $0.04 vs $0.15 mismatch).
const OVERAGE_RATE_MIN = parseFloat(process.env.OVERAGE_RATE_MIN || '0.15')
const CALL_FORWARDING_RATE_MIN = parseFloat(process.env.CALL_FORWARDING_RATE_MIN || '0.50')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FEATURE 1: Smart Upsell Triggers
// Converts limit-hit moments into compelling upgrade messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UPSELL_MESSAGES = {
  en: {
    linksExhausted: () =>
      `🔥 <b>You've used all your free links!</b>\n\n` +
      `Don't stop now — your links are getting clicks!\n\n` +
      `⚡ <b>Upgrade to unlock:</b>\n` +
      `├ ♾️ Unlimited short links\n` +
      `├ 🌐 Free custom domains (.sbs, .xyz)\n` +
      `├ 📊 Click analytics & tracking\n` +
      `└ 🎯 Phone lead validations with owner names\n\n` +
      `💰 <b>Plans:</b>\n` +
      `├ Daily — <b>$${PRICE_DAILY}</b>\n` +
      `├ Weekly — <b>$${PRICE_WEEKLY}</b> (save 28%)\n` +
      `└ Monthly — <b>$${PRICE_MONTHLY}</b> (save 60%)\n\n` +
      `👇 Tap <b>⚡ Upgrade Plan</b> to start`,

    lastLinkWarning: (remaining) =>
      `⚠️ <b>Only ${remaining} free link${remaining !== 1 ? 's' : ''} left!</b>\n\n` +
      `Pro tip: Subscribers never run out — unlimited links + free domains.\n` +
      `Plans from <b>$${PRICE_DAILY}/day</b>. Tap ⚡ Upgrade Plan anytime.`,

    smsLimitHit: () =>
      `📱 <b>SMS limit reached on your plan!</b>\n\n` +
      `Need more SMS? Here's how:\n` +
      `├ 💰 Add wallet funds for <b>overage SMS</b> ($0.02/msg)\n` +
      `└ ⬆️ Upgrade your plan for more included SMS\n\n` +
      `📦 <b>Plans:</b>\n` +
      `├ Starter (${process.env.STARTER_SMS || 50} SMS) — $${PHONE_STARTER_PRICE}\n` +
      `├ Pro (${process.env.PRO_SMS || 200} SMS) — $${PHONE_PRO_PRICE}\n` +
      `└ Business (${process.env.BUSINESS_SMS || 300} SMS) — $${PHONE_BUSINESS_PRICE}\n\n` +
      `💳 Tap 👛 My Wallet to add funds for instant overage access.`,

    minuteLimitHit: () =>
      `📞 <b>Call minutes exhausted!</b>\n\n` +
      `Your calls are working — let's keep them going:\n` +
      `├ 💰 Add wallet funds for <b>overage minutes</b> ($${OVERAGE_RATE_MIN}/min)\n` +
      `└ ⬆️ Upgrade for more included minutes\n\n` +
      `📦 <b>Plans:</b>\n` +
      `├ Starter (${process.env.STARTER_MINUTES || 100} min) — $${PHONE_STARTER_PRICE}\n` +
      `├ Pro (${process.env.PRO_MINUTES || 400} min) — $${PHONE_PRO_PRICE}\n` +
      `└ Business (${process.env.BUSINESS_MINUTES || 600} min) — $${PHONE_BUSINESS_PRICE}\n\n` +
      `💳 Tap 👛 My Wallet to add funds, or upgrade your plan.`,

    domainLimitHit: (planType) =>
      `🌐 <b>Free domain limit reached!</b>\n\n` +
      `Your ${planType} plan includes a limited number of free domains.\n\n` +
      `Want more domains?\n` +
      `├ 🛒 <b>Buy individual domains</b> starting from $${process.env.MIN_DOMAIN_PRICE || 30}\n` +
      `└ ⬆️ <b>Upgrade your plan</b> for more free domains\n\n` +
      `Monthly plans include up to ${process.env.MONTHLY_PLAN_FREE_DOMAINS || 6} free domains!`,

    noPhonePlanYet: () =>
      `📞 <b>Try Cloud Phone — Your Virtual Number Awaits!</b>\n\n` +
      `Get a real phone number in 30+ countries with:\n` +
      `├ 📱 Call & SMS capability\n` +
      `├ 🔀 Call forwarding to your phone\n` +
      `├ 🎙️ IVR auto-attendant\n` +
      `├ 📧 Voicemail to text\n` +
      `└ 🔐 SIP credentials for desktop/app calling\n\n` +
      `🆓 <b>Free trial:</b> Try a Quick IVR Call first!\n\n` +
      `💰 Plans from <b>$${PHONE_STARTER_PRICE}/mo</b>`,
  },
  fr: {
    linksExhausted: () =>
      `🔥 <b>Vos liens gratuits sont épuisés !</b>\n\n` +
      `Vos liens reçoivent des clics — ne vous arrêtez pas !\n\n` +
      `⚡ <b>Passez à l'offre supérieure :</b>\n` +
      `├ ♾️ Liens illimités\n` +
      `├ 🌐 Domaines gratuits\n` +
      `├ 📊 Analytiques de clics\n` +
      `└ 🎯 Validations de numéros\n\n` +
      `💰 À partir de <b>$${PRICE_DAILY}/jour</b>`,
    lastLinkWarning: (remaining) =>
      `⚠️ <b>Plus que ${remaining} lien${remaining !== 1 ? 's' : ''} gratuit${remaining !== 1 ? 's' : ''} !</b>\n\nAbonnez-vous pour des liens illimités. À partir de <b>$${PRICE_DAILY}/jour</b>.`,
    smsLimitHit: () => `📱 <b>Limite SMS atteinte !</b>\n\nAjoutez des fonds pour continuer ($0.02/SMS) ou passez au forfait supérieur.`,
    minuteLimitHit: () => `📞 <b>Minutes épuisées !</b>\n\nAjoutez des fonds pour continuer ($${OVERAGE_RATE_MIN}/min) ou passez au forfait supérieur.`,
    domainLimitHit: (planType) => `🌐 <b>Limite de domaines gratuits atteinte !</b>\n\nVotre forfait ${planType} a atteint sa limite. Achetez des domaines individuels ou passez au forfait supérieur.`,
    noPhonePlanYet: () => `📞 <b>Essayez Cloud Phone !</b>\n\nNuméros virtuels dans 30+ pays. À partir de <b>$${PHONE_STARTER_PRICE}/mois</b>.`,
  },
  zh: {
    linksExhausted: () => `🔥 <b>免费链接已用完！</b>\n\n升级即可获得无限链接+免费域名+点击分析。\n\n💰 方案从 <b>$${PRICE_DAILY}/天</b> 起`,
    lastLinkWarning: (remaining) => `⚠️ <b>仅剩 ${remaining} 个免费链接！</b>\n\n订阅后永不断链。方案从 <b>$${PRICE_DAILY}/天</b> 起。`,
    smsLimitHit: () => `📱 <b>短信额度已用完！</b>\n\n充值钱包继续发送（$0.02/条）或升级套餐。`,
    minuteLimitHit: () => `📞 <b>通话分钟已用完！</b>\n\n充值钱包继续通话（$${OVERAGE_RATE_MIN}/分钟）或升级套餐。`,
    domainLimitHit: (planType) => `🌐 <b>免费域名额度已达上限！</b>\n\n升级套餐获取更多免费域名。`,
    noPhonePlanYet: () => `📞 <b>试试云电话！</b>\n\n30+国家虚拟号码。方案从 <b>$${PHONE_STARTER_PRICE}/月</b> 起。`,
  },
  hi: {
    linksExhausted: () => `🔥 <b>आपके मुफ्त लिंक समाप्त हो गए!</b>\n\nअपग्रेड करें — असीमित लिंक + मुफ्त डोमेन + एनालिटिक्स।\n\n💰 प्लान <b>$${PRICE_DAILY}/दिन</b> से शुरू`,
    lastLinkWarning: (remaining) => `⚠️ <b>केवल ${remaining} मुफ्त लिंक बचे!</b>\n\nसब्सक्राइब करें — कभी लिंक खत्म नहीं होंगे। <b>$${PRICE_DAILY}/दिन</b> से।`,
    smsLimitHit: () => `📱 <b>SMS सीमा पूरी हो गई!</b>\n\nवॉलेट में पैसे डालें ($0.02/SMS) या प्लान अपग्रेड करें।`,
    minuteLimitHit: () => `📞 <b>कॉल मिनट समाप्त!</b>\n\nवॉलेट में पैसे डालें ($${OVERAGE_RATE_MIN}/मिनट) या प्लान अपग्रेड करें।`,
    domainLimitHit: (planType) => `🌐 <b>मुफ्त डोमेन सीमा पूरी!</b>\n\nअधिक मुफ्त डोमेन के लिए प्लान अपग्रेड करें।`,
    noPhonePlanYet: () => `📞 <b>Cloud Phone आज़माएं!</b>\n\n30+ देशों में वर्चुअल नंबर। <b>$${PHONE_STARTER_PRICE}/माह</b> से।`,
  },
}

function getUpsellMessage(type, lang = 'en', ...args) {
  const msgs = UPSELL_MESSAGES[lang] || UPSELL_MESSAGES.en
  const fn = msgs[type]
  return fn ? fn(...args) : (UPSELL_MESSAGES.en[type] || (() => ''))(...args)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FEATURE 2: Welcome Bonus
// Auto-credits wallet when user first joins
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _welcomeBonusCol = null
let _walletOf = null
let _bot = null

function initWelcomeBonus(db, bot, walletOf) {
  _welcomeBonusCol = db.collection('welcomeBonuses')
  _walletOf = walletOf
  _bot = bot

  // Index for fast lookups
  _welcomeBonusCol.createIndex({ chatId: 1 }, { unique: true }).catch(() => {})
  log(`[WelcomeBonus] Initialized — $${WELCOME_BONUS_USD} welcome gift for new users`)
}

async function checkAndAwardWelcomeBonus(chatId, lang = 'en') {
  if (!_welcomeBonusCol || !_walletOf || WELCOME_BONUS_USD <= 0) return null

  try {
    // Ensure chatId is always string for consistency
    chatId = String(chatId)
    
    // Check if bonus already awarded
    const existing = await _welcomeBonusCol.findOne({ chatId })
    if (existing) return null // Already received

    // Award the bonus — use findOneAndUpdate to prevent race conditions
    const result = await _welcomeBonusCol.findOneAndUpdate(
      { chatId },
      {
        $setOnInsert: {
          chatId,
          bonusAmount: WELCOME_BONUS_USD,
          awardedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    )

    // If we just inserted (not already existing), award the bonus
    if (result && !result.previouslyExisted) {
      // Credit wallet
      const { atomicIncrement } = require('./db.js')
      await atomicIncrement(_walletOf, chatId, 'usdIn', WELCOME_BONUS_USD)

      // ✅ FIX: Log welcome bonus in transactions collection for audit trail
      try {
        const txnId = `TXN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
        const txnsCol = _walletOf.s.db.collection('transactions')
        await txnsCol.insertOne({
          _id: txnId,
          chatId: String(chatId), // Store as string for consistency with bot chatId
          type: 'welcome-bonus',
          amount: WELCOME_BONUS_USD,
          currency: 'USD',
          status: 'completed',
          metadata: {
            source: 'automated'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        log(`[WelcomeBonus] Transaction logged: ${txnId} - $${WELCOME_BONUS_USD} to ${chatId}`)
      } catch (txnErr) {
        log(`[WelcomeBonus] Warning: Failed to log transaction: ${txnErr.message}`)
      }

      log(`[WelcomeBonus] Awarded $${WELCOME_BONUS_USD} to chatId=${chatId}`)

      const msgs = {
        en: `🎉 <b>Welcome Gift!</b>\n\n` +
            `$${WELCOME_BONUS_USD} has been added to your wallet as a welcome gift!\n\n` +
            `💡 Use it toward any service — domains, phone numbers, hosting, or more.\n\n` +
            `Thank you for joining Nomadly! 🚀`,
        fr: `🎉 <b>Cadeau de bienvenue !</b>\n\n` +
            `$${WELCOME_BONUS_USD} ajoutés à votre portefeuille en cadeau de bienvenue !\n\n` +
            `💡 Utilisez-le pour n'importe quel service. Merci d'avoir rejoint Nomadly ! 🚀`,
        zh: `🎉 <b>欢迎礼物！</b>\n\n` +
            `$${WELCOME_BONUS_USD} 已作为欢迎礼物添加到您的钱包！\n\n` +
            `💡 可用于任何服务。感谢加入 Nomadly！🚀`,
        hi: `🎉 <b>स्वागत उपहार!</b>\n\n` +
            `$${WELCOME_BONUS_USD} स्वागत उपहार के रूप में आपके वॉलेट में जोड़ दिए गए!\n\n` +
            `💡 किसी भी सेवा पर इस्तेमाल करें। Nomadly में स्वागत है! 🚀`,
      }

      return { awarded: true, amount: WELCOME_BONUS_USD, message: msgs[lang] || msgs.en }
    }

    return null
  } catch (e) {
    // Duplicate key = already awarded (race condition safe)
    if (e.code === 11000) return null
    log(`[WelcomeBonus] Error: ${e.message}`)
    return null
  }
}

/**
 * Gift $5 welcome bonus to ALL existing users who haven't received it yet.
 * Sends a localized announcement message to each gifted user.
 * Rate-limited to avoid Telegram API throttling.
 * @param {Function} getChatIds - async function returning all user chatIds
 * @param {Function} sendMessage - bot.sendMessage
 * @param {Function} adminSend - function to send progress to admin
 * @param {Function} getUserLang - async function(chatId) => language code string
 * @returns {Object} { gifted, skipped, failed, total }
 */
async function giftAllUsersWelcomeBonus(getChatIds, sendMessage, adminSend, getUserLang) {
  if (!_welcomeBonusCol || !_walletOf) {
    throw new Error('Welcome bonus not initialized')
  }

  const giftMsgs = {
    en: `🎉 <b>Welcome Gift!</b>\n\n` +
        `$${WELCOME_BONUS_USD} has been added to your wallet as a welcome gift from Nomadly!\n\n` +
        `💡 Use it toward any service — domains, phone numbers, hosting, or more.\n\n` +
        `Thank you for being part of Nomadly! 🚀`,
    fr: `🎉 <b>Cadeau de bienvenue !</b>\n\n` +
        `$${WELCOME_BONUS_USD} ajoutés à votre portefeuille en cadeau de bienvenue de Nomadly !\n\n` +
        `💡 Utilisez-le pour n'importe quel service — domaines, numéros, hébergement, et plus.\n\n` +
        `Merci de faire partie de Nomadly ! 🚀`,
    zh: `🎉 <b>欢迎礼物！</b>\n\n` +
        `$${WELCOME_BONUS_USD} 已作为 Nomadly 的欢迎礼物添加到您的钱包！\n\n` +
        `💡 可用于任何服务 — 域名、电话号码、托管等。\n\n` +
        `感谢您成为 Nomadly 的一员！🚀`,
    hi: `🎉 <b>स्वागत उपहार!</b>\n\n` +
        `$${WELCOME_BONUS_USD} Nomadly से स्वागत उपहार के रूप में आपके वॉलेट में जोड़ दिए गए!\n\n` +
        `💡 किसी भी सेवा पर इस्तेमाल करें — डोमेन, फ़ोन नंबर, होस्टिंग, और बहुत कुछ।\n\n` +
        `Nomadly का हिस्सा बनने के लिए धन्यवाद! 🚀`,
  }

  const chatIds = await getChatIds()
  const total = chatIds.length
  let gifted = 0
  let skipped = 0
  let failed = 0

  const BATCH_SIZE = 25
  const DELAY_BETWEEN_MSGS = 50 // ms (safe for Telegram 30msg/sec)
  const DELAY_BETWEEN_BATCHES = 2000 // 2s pause between batches

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  const totalBatches = Math.ceil(total / BATCH_SIZE)

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    for (const chatId of batch) {
      try {
        // Check if already received
        const existing = await _welcomeBonusCol.findOne({ chatId })
        if (existing) {
          skipped++
          continue
        }

        // Award — race-safe upsert
        const result = await _welcomeBonusCol.findOneAndUpdate(
          { chatId },
          {
            $setOnInsert: {
              chatId,
              bonusAmount: WELCOME_BONUS_USD,
              awardedAt: new Date(),
              source: 'admin_gift_all',
            },
          },
          { upsert: true, returnDocument: 'after' }
        )

        if (result && !result.previouslyExisted) {
          const { atomicIncrement } = require('./db.js')
          await atomicIncrement(_walletOf, chatId, 'usdIn', WELCOME_BONUS_USD)

          // Get user's preferred language, default to English
          let lang = 'en'
          try {
            if (getUserLang) lang = (await getUserLang(chatId)) || 'en'
          } catch (_) {}

          // Announce to user in their language
          try {
            await sendMessage(chatId, giftMsgs[lang] || giftMsgs.en, { parse_mode: 'HTML' })
          } catch (sendErr) {
            // User may have blocked bot — still count as gifted (wallet credited)
            log(`[GiftAll] Could not message ${chatId}: ${sendErr.message}`)
          }

          gifted++
        } else {
          skipped++
        }
      } catch (e) {
        if (e.code === 11000) { skipped++; continue }
        log(`[GiftAll] Error for ${chatId}: ${e.message}`)
        failed++
      }

      await sleep(DELAY_BETWEEN_MSGS)
    }

    // Progress update to admin every batch
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      try {
        await adminSend(`📊 Gift progress: ${batchNum}/${totalBatches} batches\n✅ Gifted: ${gifted} | ⏭ Skipped: ${skipped} | ❌ Failed: ${failed}`)
      } catch (_) {}
    }

    if (i + BATCH_SIZE < total) await sleep(DELAY_BETWEEN_BATCHES)
  }

  log(`[GiftAll] Complete — gifted=${gifted}, skipped=${skipped}, failed=${failed}, total=${total}`)
  return { gifted, skipped, failed, total }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FEATURE 3: Win-Back Campaign
// Re-engages inactive users with time-limited discount codes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _winbackCol = null
let _winbackCodesCol = null
let _stateCol = null
let _nameOfCol = null
let _promoOptOutCol = null

function initWinBack(db, bot, stateCol, nameOfCol) {
  _winbackCol = db.collection('winbackCampaigns')
  _winbackCodesCol = db.collection('winbackCodes')
  _stateCol = stateCol
  _nameOfCol = nameOfCol
  _promoOptOutCol = db.collection('promoOptOut')

  // Indexes
  _winbackCodesCol.createIndex({ code: 1 }, { unique: true }).catch(() => {})
  _winbackCodesCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}) // TTL
  _winbackCodesCol.createIndex({ chatId: 1 }).catch(() => {})
  _winbackCol.createIndex({ chatId: 1 }).catch(() => {})
  _stateCol.createIndex({ lastMessageAt: 1 }).catch(() => {})

  // ── One-time backfill: seed lastMessageAt for users missing it ──
  backfillLastMessageAt(stateCol).catch(e => log(`[WinBack] Backfill error: ${e.message}`))

  // Schedule: Run daily at 10:00 UTC
  schedule.scheduleJob('0 10 * * *', () => runWinBackCampaign(bot))
  log(`[WinBack] Initialized — scans for ${WINBACK_INACTIVE_DAYS}-day inactive users daily at 10:00 UTC, ${WINBACK_DISCOUNT_PERCENT}% discount, ${WINBACK_CODE_EXPIRY_HOURS}h expiry`)
}

/**
 * One-time backfill: For users missing lastMessageAt, seed it from lastUpdated
 * or a 30-day-ago fallback so they appear in win-back scans.
 */
async function backfillLastMessageAt(stateCol) {
  const alreadyDone = await stateCol.findOne({ _id: '__winback_backfill_done' })
  if (alreadyDone) return // Already ran

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // 1) Users WITH lastUpdated but NO lastMessageAt → copy lastUpdated
  const withLastUpdated = await stateCol.find({
    lastMessageAt: { $exists: false },
    lastUpdated: { $exists: true },
    _id: { $type: 'number' }
  }).project({ _id: 1, lastUpdated: 1 }).toArray()

  let seeded = 0
  for (const doc of withLastUpdated) {
    const ts = doc.lastUpdated instanceof Date ? doc.lastUpdated : new Date(doc.lastUpdated)
    await stateCol.updateOne({ _id: doc._id }, { $set: { lastMessageAt: ts } })
    seeded++
  }
  log(`[WinBack] Backfill: seeded lastMessageAt from lastUpdated for ${seeded} users`)

  // 2) Users with NEITHER field → set to 30 days ago
  const result = await stateCol.updateMany(
    { lastMessageAt: { $exists: false }, _id: { $type: 'number' } },
    { $set: { lastMessageAt: thirtyDaysAgo } }
  )
  log(`[WinBack] Backfill: seeded lastMessageAt (30d ago) for ${result.modifiedCount} users with no activity timestamps`)

  // Mark backfill as done so it doesn't re-run
  await stateCol.insertOne({ _id: '__winback_backfill_done', doneAt: new Date() }).catch(() => {})
  log(`[WinBack] Backfill complete`)
}

async function findInactiveUsers() {
  if (!_stateCol || !_nameOfCol) return []

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - WINBACK_INACTIVE_DAYS)

  try {
    // Query: users inactive for WINBACK_INACTIVE_DAYS+ days
    // Positive numeric _id only (skip group chats which are negative)
    const inactiveStates = await _stateCol.find({
      lastMessageAt: { $lt: cutoffDate, $exists: true },
      _id: { $type: 'number', $gt: 0 }  // Only positive numeric chatIds (real users)
    }).project({ _id: 1, lastMessageAt: 1, userLanguage: 1 }).toArray()

    if (inactiveStates.length === 0) return []

    log(`[WinBack] Raw inactive query returned ${inactiveStates.length} candidates`)

    // Batch check: get opted-out users
    const optedOutSet = new Set()
    if (_promoOptOutCol) {
      const optedOut = await _promoOptOutCol.find({ optedOut: true }).project({ _id: 1 }).toArray()
      optedOut.forEach(u => optedOutSet.add(u._id))
    }

    // Batch check: get recent win-back recipients (last 14 days)
    const recentWinbackSet = new Set()
    const recentWinbacks = await _winbackCol.find({
      sentAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
    }).project({ chatId: 1 }).toArray()
    recentWinbacks.forEach(w => recentWinbackSet.add(w.chatId))

    // Filter and build result
    const inactiveUsers = []
    for (const userState of inactiveStates) {
      const chatId = userState._id
      if (chatId <= 0) continue // extra safety: skip group chats
      if (optedOutSet.has(chatId)) continue
      if (recentWinbackSet.has(chatId)) continue

      inactiveUsers.push({
        chatId,
        lastActive: new Date(userState.lastMessageAt),
        lang: userState.userLanguage || 'en',
        daysSinceActive: Math.floor((Date.now() - new Date(userState.lastMessageAt).getTime()) / 86400000)
      })
    }

    return inactiveUsers
  } catch (e) {
    log(`[WinBack] Error finding inactive users: ${e.message}`)
    return []
  }
}

async function generateWinbackCode(chatId) {
  const code = `COMEBACK${generateCode()}`
  const expiresAt = new Date(Date.now() + WINBACK_CODE_EXPIRY_HOURS * 60 * 60 * 1000)

  try {
    await _winbackCodesCol.insertOne({
      code,
      chatId,
      discount: WINBACK_DISCOUNT_PERCENT,
      expiresAt,
      used: false,
      createdAt: new Date()
    })
    return { code, discount: WINBACK_DISCOUNT_PERCENT, expiresAt }
  } catch (e) {
    log(`[WinBack] Error generating code: ${e.message}`)
    return null
  }
}

async function validateWinbackCode(code, chatId) {
  if (!_winbackCodesCol) return null

  try {
    const record = await _winbackCodesCol.findOne({ code, chatId })
    if (!record) return null
    if (record.used) return { error: 'already_used' }
    if (new Date() > record.expiresAt) return { error: 'expired' }
    return { discount: record.discount, code: record.code }
  } catch (e) {
    log(`[WinBack] Error validating code: ${e.message}`)
    return null
  }
}

async function markWinbackCodeUsed(code) {
  if (!_winbackCodesCol) return
  try {
    await _winbackCodesCol.updateOne({ code }, { $set: { used: true, usedAt: new Date() } })
  } catch (e) { /* non-critical */ }
}

function getWinbackMessage(lang, code, discount, expiryHours) {
  const msgs = {
    en: `👋 <b>We miss you!</b>\n\n` +
        `It's been a while since you used Nomadly. We'd love to have you back!\n\n` +
        `🎁 <b>Exclusive come-back offer:</b>\n` +
        `Use code <code>${code}</code> for <b>${discount}% off</b> your next purchase!\n\n` +
        `⏰ <b>Expires in ${expiryHours} hours</b> — don't miss out.\n\n` +
        `Here's what you can do:\n` +
        `├ 📞 Get a Cloud Phone number\n` +
        `├ 🌐 Register a domain\n` +
        `├ 🔗 Shorten unlimited URLs\n` +
        `├ 🎯 Buy phone leads\n` +
        `└ 🛡️ Set up bulletproof hosting\n\n` +
        `Tap /start to come back and use your code at checkout!`,

    fr: `👋 <b>Vous nous manquez !</b>\n\n` +
        `Cela fait un moment. Nous aimerions vous revoir !\n\n` +
        `🎁 Code <code>${code}</code> pour <b>${discount}%</b> de réduction !\n` +
        `⏰ Expire dans ${expiryHours}h.\n\n` +
        `Tapez /start pour revenir !`,

    zh: `👋 <b>我们想念您！</b>\n\n` +
        `好久不见！🎁 使用代码 <code>${code}</code> 享受 <b>${discount}%</b> 折扣！\n` +
        `⏰ ${expiryHours}小时后过期。\n\n` +
        `点击 /start 回来使用！`,

    hi: `👋 <b>हम आपकी याद करते हैं!</b>\n\n` +
        `काफी समय हो गया! 🎁 कोड <code>${code}</code> से <b>${discount}%</b> छूट पाएं!\n` +
        `⏰ ${expiryHours} घंटे में समाप्त।\n\n` +
        `/start पर टैप करें!`,
  }
  return msgs[lang] || msgs.en
}

async function runWinBackCampaign(bot) {
  log(`[WinBack] Running win-back campaign scan...`)

  const inactiveUsers = await findInactiveUsers()
  if (inactiveUsers.length === 0) {
    log(`[WinBack] No inactive users found`)
    return { sent: 0, errors: 0 }
  }

  log(`[WinBack] Found ${inactiveUsers.length} inactive users (${WINBACK_INACTIVE_DAYS}+ days)`)

  let sent = 0, errors = 0, markedDead = 0, rateLimited = 0
  let BATCH_DELAY = 200 // ms between messages — start conservative

  for (const user of inactiveUsers) {
    try {
      const codeData = await generateWinbackCode(user.chatId)
      if (!codeData) continue

      const message = getWinbackMessage(user.lang, codeData.code, codeData.discount, WINBACK_CODE_EXPIRY_HOURS)

      await bot.sendMessage(user.chatId, message, { parse_mode: 'HTML' })

      // Track campaign
      await _winbackCol.insertOne({
        chatId: user.chatId,
        code: codeData.code,
        discount: codeData.discount,
        daysSinceActive: user.daysSinceActive,
        sentAt: new Date(),
        converted: false
      })

      sent++
      log(`[WinBack] Sent to ${user.chatId} (inactive ${user.daysSinceActive}d) — code: ${codeData.code}`)

      // Reset delay on success
      BATCH_DELAY = 200
      await new Promise(r => setTimeout(r, BATCH_DELAY))
    } catch (e) {
      errors++
      const msg = e?.response?.body?.description || e.message || ''
      const statusCode = e?.response?.statusCode || 0

      // Handle Telegram rate limiting (429) with exponential backoff
      if (statusCode === 429 || msg.includes('Too Many Requests')) {
        rateLimited++
        const retryAfter = e?.response?.body?.parameters?.retry_after || 30
        log(`[WinBack] Rate limited (429) at user ${user.chatId} — backing off ${retryAfter}s`)
        BATCH_DELAY = Math.min(BATCH_DELAY * 2, 5000)
        await new Promise(r => setTimeout(r, retryAfter * 1000))
        continue
      }

      // Mark permanently unreachable users as dead
      if (msg.includes('chat not found') || msg.includes('user is deactivated') || msg.includes('bot was blocked') ||
          msg.includes('have no rights') || msg.includes('PEER_ID_INVALID') || msg.includes('bot was kicked')) {
        markedDead++
        const reason = msg.includes('chat not found') ? 'chat_not_found'
          : msg.includes('deactivated') ? 'user_deactivated'
          : msg.includes('bot was blocked') ? 'bot_blocked'
          : msg.includes('bot was kicked') ? 'bot_kicked'
          : 'unreachable'
        if (_promoOptOutCol) {
          await _promoOptOutCol.updateOne(
            { _id: user.chatId },
            { $set: { optedOut: true, reason, updatedAt: new Date() } },
            { upsert: true }
          ).catch(() => {})
        }
        // Log only every 50th dead user to avoid log spam
        if (markedDead % 50 === 1) {
          log(`[WinBack] Marking dead: ${user.chatId} — ${reason} (${markedDead} total so far)`)
        }
      } else {
        // Log unexpected errors
        log(`[WinBack] Unexpected error for ${user.chatId}: ${msg.slice(0, 150)}`)
      }

      await new Promise(r => setTimeout(r, BATCH_DELAY))
    }
  }

  log(`[WinBack] Campaign complete: ${sent} sent, ${errors} errors (${markedDead} newly marked dead, ${rateLimited} rate-limited)`)

  // Admin notification
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (adminChatId && bot && (sent > 0 || errors > 0)) {
    bot.sendMessage(adminChatId,
      `📊 <b>Win-Back Campaign Report</b>\n\n` +
      `👥 Inactive users found: ${inactiveUsers.length}\n` +
      `✉️ Messages sent: ${sent}\n` +
      `❌ Errors: ${errors}\n` +
      `💀 Newly marked dead: ${markedDead}\n` +
      `⏱ Rate limited: ${rateLimited}\n` +
      `🎟️ Discount: ${WINBACK_DISCOUNT_PERCENT}%\n` +
      `⏰ Code expiry: ${WINBACK_CODE_EXPIRY_HOURS}h`,
      { parse_mode: 'HTML' }
    ).catch(() => {})
  }

  return { sent, errors, markedDead, rateLimited }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FEATURE 4: Service Bundles
// Discounted multi-service packages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SERVICE_BUNDLES = {
  'starter-launch': {
    name: { en: '🚀 Starter Launch Bundle', fr: '🚀 Pack Lancement Débutant', zh: '🚀 入门启动套餐', hi: '🚀 स्टार्टर लॉन्च बंडल' },
    description: {
      en: 'Your first site, live today — a domain + a full week of bulletproof hosting for one flat $50. A single $50 deposit covers it exactly.',
      fr: 'Votre premier site en ligne aujourd\'hui — un domaine + une semaine d\'hébergement anti-blocage pour 50$ tout compris. Un seul dépôt de 50$ suffit.',
      zh: '今天就让您的第一个网站上线 — 域名 + 整整一周防封主机，统一价 50 美元。一次 50 美元充值即可完全覆盖。',
      hi: 'आज ही आपकी पहली साइट लाइव — एक डोमेन + पूरे एक हफ़्ते की बुलेटप्रूफ होस्टिंग, फ्लैट $50 में। एक $50 डिपॉज़िट में पूरा हो जाता है।',
    },
    items: [
      { service: 'domain', label: { en: '1× Domain (.sbs)', fr: '1× Domaine (.sbs)', zh: '1个域名 (.sbs)', hi: '1× डोमेन (.sbs)' }, basePrice: 30 },
      { service: 'hosting_weekly', label: { en: '1× Premium Anti-Red Hosting (Weekly)', fr: '1× Hébergement Anti-Red Premium (Hebdo)', zh: '1× 高级防红主机 (每周)', hi: '1× प्रीमियम एंटी-रेड होस्टिंग (साप्ताहिक)' }, basePrice: PREMIUM_ANTIRED_WEEKLY },
    ],
    flatPrice: 50,          // matches the $50 wallet-deposit preset exactly (audit #19)
    firstPurchase: true,    // featured to first-time buyers
    popular: true,
  },
  'starter-web': {
    name: { en: '🌐 Starter Web Bundle', fr: '🌐 Pack Web Débutant', zh: '🌐 网站入门套餐', hi: '🌐 स्टार्टर वेब बंडल' },
    description: {
      en: 'Domain + Weekly Hosting — everything to launch your website',
      fr: 'Domaine + Hébergement hebdomadaire — tout pour lancer votre site',
      zh: '域名 + 每周主机 — 启动网站所需一切',
      hi: 'डोमेन + साप्ताहिक होस्टिंग — वेबसाइट शुरू करने के लिए सब कुछ',
    },
    items: [
      { service: 'domain', label: { en: '1× Domain (.sbs)', fr: '1× Domaine (.sbs)', zh: '1个域名 (.sbs)', hi: '1× डोमेन (.sbs)' }, basePrice: 30 },
      { service: 'hosting_weekly', label: { en: '1× Premium Anti-Red Hosting (Weekly)', fr: '1× Hébergement Anti-Red Premium (Hebdo)', zh: '1× 高级防红主机 (每周)', hi: '1× प्रीमियम एंटी-रेड होस्टिंग (साप्ताहिक)' }, basePrice: PREMIUM_ANTIRED_WEEKLY },
    ],
    discountPercent: 15,
    popular: false,
  },
  'pro-web': {
    name: { en: '🔥 Pro Web Bundle', fr: '🔥 Pack Web Pro', zh: '🔥 专业网站套餐', hi: '🔥 प्रो वेब बंडल' },
    description: {
      en: 'Domain + cPanel Hosting + URL Shortener — full web presence',
      fr: 'Domaine + cPanel + Raccourcisseur URL — présence web complète',
      zh: '域名 + cPanel主机 + URL缩短器 — 完整网络形象',
      hi: 'डोमेन + cPanel होस्टिंग + URL शॉर्टनर — पूरी वेब उपस्थिति',
    },
    items: [
      { service: 'domain', label: { en: '1× Domain (.sbs)', fr: '1× Domaine (.sbs)', zh: '1个域名 (.sbs)', hi: '1× डोमेन (.sbs)' }, basePrice: 30 },
      { service: 'hosting_cpanel', label: { en: '1× Premium cPanel Hosting', fr: '1× Hébergement cPanel Premium', zh: '1× 高级cPanel主机', hi: '1× प्रीमियम cPanel होस्टिंग' }, basePrice: PREMIUM_ANTIRED_CPANEL },
      { service: 'shortener_weekly', label: { en: '1× URL Shortener (Weekly)', fr: '1× Raccourcisseur URL (Hebdo)', zh: '1× URL缩短器 (每周)', hi: '1× URL शॉर्टनर (साप्ताहिक)' }, basePrice: PRICE_WEEKLY },
    ],
    discountPercent: 20,
    popular: true,
  },
  'phone-domain': {
    name: { en: '📞 Phone + Domain Bundle', fr: '📞 Pack Téléphone + Domaine', zh: '📞 电话+域名套餐', hi: '📞 फोन + डोमेन बंडल' },
    description: {
      en: 'Cloud Phone (Starter) + Domain — calls + web identity',
      fr: 'Cloud Phone (Starter) + Domaine — appels + identité web',
      zh: '云电话 (入门) + 域名 — 通话+网络身份',
      hi: 'Cloud Phone (स्टार्टर) + डोमेन — कॉल + वेब पहचान',
    },
    items: [
      { service: 'phone_starter', label: { en: '1× Cloud Phone Starter', fr: '1× Cloud Phone Starter', zh: '1× 云电话入门版', hi: '1× Cloud Phone स्टार्टर' }, basePrice: PHONE_STARTER_PRICE },
      { service: 'domain', label: { en: '1× Domain (.sbs)', fr: '1× Domaine (.sbs)', zh: '1个域名 (.sbs)', hi: '1× डोमेन (.sbs)' }, basePrice: 30 },
    ],
    discountPercent: 15,
    popular: false,
  },
  'business-all': {
    name: { en: '💼 Business All-in-One', fr: '💼 Pack Business Tout-en-Un', zh: '💼 商务全能套餐', hi: '💼 बिज़नेस ऑल-इन-वन' },
    description: {
      en: 'Cloud Phone Pro + Domain + cPanel Hosting + Shortener — complete business toolkit',
      fr: 'Cloud Phone Pro + Domaine + cPanel + Raccourcisseur — boîte à outils complète',
      zh: '云电话专业版 + 域名 + cPanel主机 + 缩短器 — 完整商业工具包',
      hi: 'Cloud Phone Pro + डोमेन + cPanel होस्टिंग + शॉर्टनर — पूरा बिज़नेस टूलकिट',
    },
    items: [
      { service: 'phone_pro', label: { en: '1× Cloud Phone Pro', fr: '1× Cloud Phone Pro', zh: '1× 云电话专业版', hi: '1× Cloud Phone प्रो' }, basePrice: PHONE_PRO_PRICE },
      { service: 'domain', label: { en: '1× Domain (.sbs)', fr: '1× Domaine (.sbs)', zh: '1个域名 (.sbs)', hi: '1× डोमेन (.sbs)' }, basePrice: 30 },
      { service: 'hosting_cpanel', label: { en: '1× Premium cPanel Hosting', fr: '1× cPanel Premium', zh: '1× cPanel主机', hi: '1× cPanel होस्टिंग' }, basePrice: PREMIUM_ANTIRED_CPANEL },
      { service: 'shortener_monthly', label: { en: '1× URL Shortener (Monthly)', fr: '1× Raccourcisseur (Mensuel)', zh: '1× URL缩短器 (月)', hi: '1× URL शॉर्टनर (मासिक)' }, basePrice: PRICE_MONTHLY },
    ],
    discountPercent: 20,
    popular: true,
  },
}

function getBundleDetails(bundleId, lang = 'en') {
  const bundle = SERVICE_BUNDLES[bundleId]
  if (!bundle) return null

  const totalBase = bundle.items.reduce((sum, item) => sum + item.basePrice, 0)
  // A bundle may pin an exact flatPrice (e.g. the $50 first-purchase bundle that
  // matches a single deposit preset). Otherwise use its discountPercent.
  let discountPercent, discountAmount, finalPrice
  if (bundle.flatPrice != null) {
    finalPrice = bundle.flatPrice
    discountAmount = Math.max(0, totalBase - finalPrice)
    discountPercent = totalBase > 0 ? Math.round(discountAmount / totalBase * 100) : 0
  } else {
    discountPercent = bundle.discountPercent
    discountAmount = Math.round(totalBase * bundle.discountPercent / 100)
    finalPrice = totalBase - discountAmount
  }

  return {
    id: bundleId,
    name: bundle.name[lang] || bundle.name.en,
    description: bundle.description[lang] || bundle.description.en,
    items: bundle.items.map(item => ({
      service: item.service,
      label: item.label[lang] || item.label.en,
      basePrice: item.basePrice,
    })),
    totalBase,
    discountPercent,
    discountAmount,
    finalPrice,
    popular: bundle.popular,
    firstPurchase: !!bundle.firstPurchase,
  }
}

function getAllBundles(lang = 'en') {
  return Object.keys(SERVICE_BUNDLES).map(id => getBundleDetails(id, lang))
}

// The featured first-purchase bundle (priced to match a single deposit preset).
function getFirstPurchaseBundle(lang = 'en') {
  const id = Object.keys(SERVICE_BUNDLES).find(k => SERVICE_BUNDLES[k].firstPurchase)
  return id ? getBundleDetails(id, lang) : null
}

function formatBundleCard(bundle, lang = 'en') {
  const popularTag = bundle.firstPurchase ? ' ✅ PERFECT FIRST ORDER' : (bundle.popular ? ' ⭐ POPULAR' : '')
  const itemLines = bundle.items.map(item => `  ├ ${item.label} — $${item.basePrice}`).join('\n')
  const firstLine = bundle.firstPurchase
    ? '\n💡 ' + ({ en: `A single <b>$${bundle.finalPrice} deposit</b> covers this exactly — no leftover.`, fr: `Un seul dépôt de <b>$${bundle.finalPrice}</b> suffit — sans reste.`, zh: `一次 <b>$${bundle.finalPrice}</b> 充值即可完全覆盖 — 无剩余。`, hi: `एक ही <b>$${bundle.finalPrice} डिपॉज़िट</b> में पूरा — कुछ नहीं बचता।` }[lang] || `A single <b>$${bundle.finalPrice} deposit</b> covers this exactly.`)
    : ''

  return `${bundle.name}${popularTag}\n` +
    `${bundle.description}\n\n` +
    `📦 <b>Includes:</b>\n${itemLines}\n\n` +
    `💲 Regular price: <s>$${bundle.totalBase}</s>\n` +
    `🏷️ Bundle discount: <b>${bundle.discountPercent}% off</b> (−$${bundle.discountAmount})\n` +
    `✅ <b>Bundle price: $${bundle.finalPrice}</b>${firstLine}`
}

function formatBundleMenu(lang = 'en') {
  const bundles = getAllBundles(lang)
  const header = {
    en: `📦 <b>Service Bundles — Save Up to 20%!</b>\n\nCombine services and save. Each bundle includes a special discount:\n`,
    fr: `📦 <b>Packs de Services — Économisez jusqu'à 20% !</b>\n\nCombinez les services et économisez :\n`,
    zh: `📦 <b>服务套餐 — 最高节省20%！</b>\n\n组合服务享受折扣：\n`,
    hi: `📦 <b>सर्विस बंडल — 20% तक बचाएं!</b>\n\nसेवाएं मिलाकर बचत करें:\n`,
  }

  let msg = header[lang] || header.en
  bundles.forEach((b, i) => {
    const tag = b.firstPurchase ? ' ✅ start here' : (b.popular ? ' ⭐' : '')
    msg += `\n${i + 1}. <b>${b.name}</b>${tag}\n`
    msg += `   <s>$${b.totalBase}</s> → <b>$${b.finalPrice}</b> (${b.discountPercent}% off)\n`
  })

  msg += {
    en: '\n👇 Select a bundle to see details and purchase.',
    fr: '\n👇 Sélectionnez un pack pour voir les détails.',
    zh: '\n👇 选择一个套餐查看详情。',
    hi: '\n👇 विवरण देखने के लिए एक बंडल चुनें।',
  }[lang] || '\n👇 Select a bundle to see details and purchase.'

  return msg
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Unified Coupon Validator (integrates win-back codes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function validateMonetizationCode(code, chatId) {
  // Check win-back codes
  const winback = await validateWinbackCode(code, chatId)
  if (winback) return { ...winback, type: 'winback' }

  return null // Not a monetization code
}

async function markMonetizationCodeUsed(code, type) {
  if (type === 'winback') {
    await markWinbackCodeUsed(code)

    // Mark campaign as converted
    if (_winbackCol) {
      await _winbackCol.updateOne(
        { code },
        { $set: { converted: true, convertedAt: new Date() } }
      ).catch(() => {})
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Activity Tracking (for win-back detection)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function trackUserActivity(stateCol, chatId) {
  if (!stateCol) return
  try {
    await stateCol.updateOne(
      { _id: chatId },
      { $set: { lastMessageAt: new Date() } },
      { upsert: false } // Only update if exists
    )
  } catch (e) { /* non-critical */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Admin Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getMonetizationStats() {
  const stats = {}

  if (_welcomeBonusCol) {
    stats.welcomeBonuses = await _welcomeBonusCol.countDocuments()
    stats.welcomeBonusTotalUsd = (await _welcomeBonusCol.aggregate([
      { $group: { _id: null, total: { $sum: '$bonusAmount' } } }
    ]).toArray())?.[0]?.total || 0
  }

  if (_winbackCol) {
    stats.winbackSent = await _winbackCol.countDocuments()
    stats.winbackConverted = await _winbackCol.countDocuments({ converted: true })
    stats.winbackConversionRate = stats.winbackSent > 0
      ? ((stats.winbackConverted / stats.winbackSent) * 100).toFixed(1) + '%'
      : '0%'
  }

  return stats
}

module.exports = {
  // Feature 1: Upsell
  getUpsellMessage,
  UPSELL_MESSAGES,

  // Feature 2: Welcome Bonus
  initWelcomeBonus,
  checkAndAwardWelcomeBonus,
  
  giftAllUsersWelcomeBonus,
  WELCOME_BONUS_USD,

  // Feature 3: Win-Back
  initWinBack,
  runWinBackCampaign,
  validateWinbackCode,
  markWinbackCodeUsed,
  findInactiveUsers,

  // Feature 4: Bundles
  SERVICE_BUNDLES,
  getBundleDetails,
  getAllBundles,
  getFirstPurchaseBundle,
  formatBundleCard,
  formatBundleMenu,

  // Shared
  validateMonetizationCode,
  markMonetizationCodeUsed,
  trackUserActivity,
  getMonetizationStats,
}
