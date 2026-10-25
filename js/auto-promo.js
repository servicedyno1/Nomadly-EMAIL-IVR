// Auto-Promo System (2026-06 rewrite) — per-user themed promos with one-tap hub buttons.
//   • Copy comes from ./promo-copy (12 themes × 4 langs), prices from ./promo-prices (live config).
//   • Each user gets at most one promo every other day; theme is chosen per user from
//     what they browsed, what they already own (cross-sell) and the day schedule.
//   • Every ad ends in a deep-link button (promo_open:<hub>) — never "type /start".

const schedule = require('node-schedule')
const { log } = require('console')
const fs = require('fs')
const path = require('path')
const BROADCAST_CONFIG = require('./broadcast-config.js')
const promoCopy = require('./promo-copy')
const { getPromoPrices } = require('./promo-prices.js')

// OpenAI — optional (graceful fallback if missing)
let OpenAI = null
try { OpenAI = require('openai') } catch { log('[AutoPromo] openai package not installed, using static messages only') }

let openai = null
function getOpenAI() {
  if (!openai && OpenAI && process.env.APP_OPEN_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.APP_OPEN_API_KEY })
  }
  return openai
}

const LANG_NAMES = { en: 'English', fr: 'French', zh: 'Chinese (Simplified)', hi: 'Hindi' }

// ─── Service facts for AI generation (price-free — prices are injected from config) ──
const SERVICE_CONTEXT = {
  cloudphone: {
    services: 'Cloud IVR + SIP — virtual phone numbers',
    details: [`Virtual phone numbers in ${require('./phone-config').CLOUD_COUNTRY_COUNT} countries, no SIM, no contract`, 'IVR menu, voicemail, SMS forwarded to Telegram', 'SIP credentials for softphones, call forwarding anywhere', 'Most numbers are active in minutes; a few countries need ID details first'],
  },
  antired_hosting: {
    services: 'Anti-Red Hosting — DMCA-ignored offshore cPanel hosting',
    details: ['DMCA-ignored offshore servers', 'Anti-Red scanner blocks bots and flaggers before they reach the site', 'Full cPanel access, free SSL', 'Weekly or monthly billing'],
  },
  leads_validation: {
    services: 'SMS Leads — phone leads and number validation',
    details: ['Phone leads filtered by country, state, area code and carrier', 'Live-line validation delivers only active numbers', 'CNAM lookup shows the owner name behind a number', 'Delivered as a file in Telegram within minutes'],
  },
  domains_shortener: {
    services: 'Bulletproof Domains + branded URL shortener',
    details: ['400+ TLDs, DMCA-ignored offshore registration', 'Cloudflare DNS and nameserver management built in', 'Branded short links on your own domain', 'Free trial short links to start'],
  },
  digital_products: {
    services: 'Digital Products — verified Twilio, Telnyx, AWS, Google Cloud, Workspace, Zoho, eSIM',
    details: ['Fully verified accounts, ready to use', 'Delivered inside Telegram', 'Pay with wallet, crypto or bank transfer'],
  },
  cards_bundles: {
    services: 'Virtual debit cards',
    details: ['Load a virtual card with the amount you choose', 'Works for online payments and verifications worldwide', 'Instant delivery'],
  },
  email_validation: {
    services: 'Email Validation — 7-layer list cleaning',
    details: ['Syntax, MX, SMTP, catch-all and disposable checks', 'Gmail, Yahoo, Outlook and private domains', 'Free 50-email trial, lists up to 100K', 'Campaign-ready deliverable file'],
  },
  marketplace: {
    services: 'P2P Marketplace with escrow',
    details: ['Funds held in escrow until delivery is confirmed', 'Chat with buyers and sellers inside Telegram', 'Up to 10 active listings per seller, new listings broadcast to all users'],
  },
  vps_rdp: {
    services: 'Linux VPS and Windows RDP servers',
    details: ['Full root or admin access', 'DMCA-ignored, port 25 open by default', 'Ready in minutes, multiple regions', 'Prepay 3, 6 or 12 months for a discount'],
  },
  bulksms_app: {
    services: 'BulkSMS Android app — bulk SMS from your own phone number',
    details: ['Send from your own SIM, no shared sender IDs', 'Schedule campaigns, control gaps between messages', 'Live delivery analytics', 'Free trial of 100 SMS without a subscription'],
  },
  email_blast: {
    services: 'Email Blast — email campaigns from Telegram',
    details: ['Custom subject and full HTML body', 'Upload contacts by CSV', 'Live sending progress', 'Built-in SMTP, nothing to configure'],
  },
  refer_earn: {
    services: 'Refer & Earn',
    details: ['Personal referral link', 'Reward credited to your wallet when a referral spends', 'Works across every service in the bot'],
  },
}

// ─── Sanitize AI output for Telegram HTML ─────────────────────────────
function sanitizeForTelegram(text) {
  let s = text
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<b>$1</b>')
  s = s.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>')
  s = s.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>')
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  s = s.replace(/^#{1,3}\s+/gm, '')
  s = s.replace(/<(?!\/?(?:b|i|u|s|code|pre|a)\b)[^>]*>/gi, '')
  for (const tag of ['b', 'i', 'code']) {
    const opens = (s.match(new RegExp(`<${tag}>`, 'gi')) || []).length
    const closes = (s.match(new RegExp(`</${tag}>`, 'gi')) || []).length
    for (let i = 0; i < opens - closes; i++) s += `</${tag}>`
    if (closes > opens) {
      let excess = closes - opens
      s = s.replace(new RegExp(`</${tag}>`, 'gi'), (match) => {
        if (excess > 0) { excess--; return '' }
        return match
      })
    }
  }
  return s.trim()
}

// Plain text only: AI output is escaped by the renderer, so strip tags, emoji and shouting.
function _plainLine(s, max) {
  const t = String(s || '').replace(/<[^>]+>/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const cased = t === t.toUpperCase() && /[A-Z]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t
  return cased.length <= max ? cased : null
}

const AI_HOOK_MAX = 60
const AI_LINE_MAX = 70

// ─── AI hook + lines (never prices) ──────────────────────────────────
async function generateDynamicPromo(theme, lang) {
  const ai = getOpenAI()
  if (!ai) return null
  const ctx = SERVICE_CONTEXT[theme]
  if (!ctx) return null
  const langName = LANG_NAMES[lang] || 'English'
  const brand = process.env.CHAT_BOT_BRAND || 'Nomadly'

  const prompt = `You write short Telegram ads for ${brand}. Product: ${ctx.services}.
Facts you may use (do not invent others; never mention prices — they are added automatically):
${ctx.details.map(d => '- ' + d).join('\n')}

Write in ${langName}. Return JSON only: {"hook": "...", "lines": ["...", "...", "..."]}
Rules:
- hook: one plain sentence, max ${AI_HOOK_MAX - 5} characters, sentence case (never ALL CAPS), no emoji, no exclamation marks
- lines: exactly 3 concrete benefits, each max ${AI_LINE_MAX - 5} characters, no emoji, no prices
- no fake social proof, no "limited spots", no urgency, no competitor shaming
- keep the words "Anti-Red", "Bulletproof" and "DMCA-ignored" exactly as written when relevant`

  try {
    const res = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 220,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    })
    const raw = res.choices?.[0]?.message?.content?.trim()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const hook = _plainLine(parsed.hook, AI_HOOK_MAX)
    const lines = Array.isArray(parsed.lines) ? parsed.lines.map(l => _plainLine(l, AI_LINE_MAX)).filter(Boolean) : []
    if (!hook || lines.length !== 3) return null
    return { hook, lines }
  } catch (error) {
    log(`[AutoPromo] OpenAI error for ${theme}/${lang}: ${error.message}`)
    return null
  }
}

// ─── Timezone & Schedule Config ───────────────────────────────────────
const TIMEZONE_OFFSETS = { en: 0, fr: 1, zh: 8, hi: 5.5 }
const LOCAL_TIMES = [{ hour: 10, minute: 0 }, { hour: 19, minute: 0 }] // Morning hero + Evening cross-sell
const THEMES = promoCopy.THEMES
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function getOptOutFooter(lang) { return promoCopy.FOOTER[lang] || promoCopy.FOOTER.en }
function getOptOutButtonText(lang) { return promoCopy.MUTE_BUTTON[lang] || promoCopy.MUTE_BUTTON.en }

// ─── Cadence: one promo every other day per user, slot alternates weekly ──
function hashId(chatId) {
  const s = String(chatId)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function cadenceSlot(chatId, date = new Date()) {
  const h = hashId(chatId)
  const dayIndex = Math.floor(date.getTime() / 86400000)
  if (process.env.PROMO_CADENCE !== 'daily' && (h + dayIndex) % 2 !== 0) return null
  return ((h >> 1) + Math.floor(dayIndex / 7)) % 2 === 0 ? 'morning' : 'evening'
}

// ─── Per-user theme choice ───────────────────────────────────────────
// owned: Set<theme>, browsed: theme|null, dayTheme: schedule theme for this slot.
// Priority (browsed / cross-sell of something owned) wins 2 sends out of 3; the
// third falls back to the day schedule so nobody sees the same pitch forever.
function pickTheme({ owned = new Set(), browsed = null, hash = 0, dayTheme = null, slot = 'morning', dayIndex = 0, env = process.env }) {
  const enabled = promoCopy.enabledThemes(env)
  const ok = t => t && enabled.includes(t) && !owned.has(t)
  const prio = []
  if (ok(browsed)) prio.push(browsed)
  for (const o of owned) for (const x of promoCopy.CROSS_SELL[o] || []) if (ok(x) && !prio.includes(x)) prio.push(x)
  const tick = Math.floor((dayIndex + hash) / 2) // advances once per eligible (every-other) day
  if (prio.length && tick % 3 !== 2) {
    const theme = prio[tick % prio.length]
    return theme === browsed ? { theme, mode: 'hero', reason: 'browsed' } : { theme, mode: 'cross', reason: 'cross_sell' }
  }
  if (ok(dayTheme)) return { theme: dayTheme, mode: slot === 'evening' ? 'cross' : 'hero', reason: 'schedule' }
  const rest = enabled.filter(ok)
  if (!rest.length) return null
  return { theme: rest[tick % rest.length], mode: 'hero', reason: 'rotation' }
}

const BROWSE_TO_THEME = { hosting: 'antired_hosting', domains: 'domains_shortener', cloudphone: 'cloudphone', digitalproducts: 'digital_products', vps: 'vps_rdp', virtualcard: 'cards_bundles', leads: 'leads_validation', marketplace: 'marketplace' }

// ─── Brand-aware banner lookup (assets/promo/<brand>/<theme>.png) ─────
// Brand folder = CHAT_BOT_BRAND slug ("Nomadly" → nomadly, "Smadav Bot" → smadav via prefix match),
// so the Nomadly bot and the Smadav white-label never show each other's logo.
const PROMO_ASSET_ROOT = path.join(__dirname, 'assets', 'promo')
function brandSlug() {
  const slug = String(process.env.CHAT_BOT_BRAND || 'Nomadly').toLowerCase().replace(/[^a-z0-9]+/g, '')
  let dirs = []
  try { dirs = fs.readdirSync(PROMO_ASSET_ROOT).filter(d => fs.statSync(path.join(PROMO_ASSET_ROOT, d)).isDirectory()) } catch { /* no assets yet */ }
  if (dirs.includes(slug)) return slug
  return dirs.find(d => slug.startsWith(d) || d.startsWith(slug)) || slug
}
function bannerFor(theme) {
  const dir = path.join(PROMO_ASSET_ROOT, brandSlug())
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(dir, `${theme}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function localToUtc(localHour, localMinute, offsetHours) {
  let utcHour = localHour - Math.floor(offsetHours)
  let utcMinute = localMinute - Math.round((offsetHours % 1) * 60)
  if (utcMinute < 0) { utcMinute += 60; utcHour -= 1 }
  if (utcMinute >= 60) { utcMinute -= 60; utcHour += 1 }
  if (utcHour < 0) utcHour += 24
  if (utcHour >= 24) utcHour -= 24
  return { hour: utcHour, minute: utcMinute }
}

// ── Promo cadence: escalating re-test back-off for repeat blockers (2026-08-20)
//   user_deactivated → never (permanent) · chat_not_found → 14 days
//   bot_blocked → 7d after 1st block, 30d after 2nd, then NEVER · other → 7 days
function _promoRetestTtlDays(reason, blockCount) {
  if (reason === 'user_deactivated') return Infinity
  if (reason === 'bot_target') return Infinity   // a bot target can never receive — never re-test
  if (reason === 'chat_not_found') return 14
  if (reason === 'bot_blocked') {
    const b = blockCount || 1
    if (b <= 1) return 7
    if (b === 2) return 30
    return Infinity
  }
  return 7
}

// ── Pre-blast block-rate report (admin-facing, 2026-08-20) ─────────────────
function _buildBlockRateReport({ theme, lang, slot, totalUsers, targets, dead, deadByReason, inactive }) {
  const total = totalUsers || 0
  const d = dead || 0
  const rate = total > 0 ? ((d / total) * 100).toFixed(1) : '0.0'
  const br = deadByReason || {}
  return `📊 <b>Pre-blast report</b> — ${theme}/${lang} (${slot})\n` +
    `👥 Users: <b>${total}</b>\n` +
    `🎯 Will send: <b>${targets || 0}</b>\n` +
    `🚫 Dead / opted-out: <b>${d}</b> (${rate}%)\n` +
    `   • blocked: ${br.bot_blocked || 0} · deactivated: ${br.user_deactivated || 0} · not-found: ${br.chat_not_found || 0}\n` +
    `😴 Inactive 30d+ skipped: ${inactive || 0}`
}

// ─── Initialize Auto-Promo System ─────────────────────────────────────
function initAutoPromo(bot, db, nameOf, stateCol, lifecycleDiet = null) {
  const promoTracker = db.collection('promoTracker')
  const promoOptOut = db.collection('promoOptOut')
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  // ── Per-blast lift window (#18): count /start + hub taps within 45 min ──
  const LIFT_WINDOW_MS = 45 * 60 * 1000
  // Zero-lift alert: only when statistically surprising (see zeroLiftVerdict)
  const LIFT_BASELINE_DAYS = 30
  const LIFT_BASELINE_MIN_DELIVERED = 500
  const LIFT_ALERT_MIN_EXPECTED = 3
  const LIFT_ALERT_COOLDOWN_MS = 7 * 86400000

  let dailyCouponSystem = null
  function setDailyCouponSystem(sys) { dailyCouponSystem = sys }

  let botUsername = process.env.BOT_USERNAME || 'Nomadlybot'
  if (bot?.getMe) bot.getMe().then(me => { if (me?.username) botUsername = me.username }).catch(() => {})

  function alertAdmin(msg) {
    if (adminChatId) bot.sendMessage(adminChatId, `[AutoPromo Alert] ${msg}`).catch(() => {})
  }

  // Rotation index per theme/lang/mode so the two hook variants alternate between blasts.
  async function getRotationIndex(theme, lang, customKey) {
    const trackerId = customKey || `${theme}_${lang}`
    const tracker = await promoTracker.findOne({ _id: trackerId })
    const currentIndex = tracker?.index || 0
    const mode = trackerId.includes('_evening_') ? 'cross' : 'hero'
    const totalVariations = promoCopy.variantCount(theme, lang, mode)
    const nextIndex = (currentIndex + 1) % totalVariations
    await promoTracker.updateOne({ _id: trackerId }, { $set: { index: nextIndex, lastSent: new Date() } }, { upsert: true })
    return currentIndex
  }

  // Only user_deactivated is truly permanent — chat_not_found can be temporary (rate limits, Telegram glitches)
  const PERMANENT_OPTOUT_REASONS = ['user_deactivated']
  // Require this many consecutive broadcast failures before marking a user as dead
  const DEAD_THRESHOLD = 3

  async function isOptedOut(chatId) {
    const record = await promoOptOut.findOne({ _id: chatId })
    if (!record?.optedOut) return false
    if (PERMANENT_OPTOUT_REASONS.includes(record.reason)) return true
    const ttlDays = _promoRetestTtlDays(record.reason, record.blockCount)
    if (ttlDays === Infinity) return true   // eased off — stay opted out
    if (record.updatedAt) {
      const daysSinceOptOut = (Date.now() - new Date(record.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceOptOut >= ttlDays) {
        await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut: false, updatedAt: new Date(), reOptInReason: 'ttl_expired', failCount: 0 } })
        log(`[AutoPromo] Re-opted-in ${chatId} after ${Math.floor(daysSinceOptOut)}d TTL (was: ${record.reason || 'unknown'}, blocks: ${record.blockCount || 0})`)
        return false
      }
    }
    return true
  }

  async function setOptOut(chatId, optedOut, reason = 'unknown') {
    await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut, reason, updatedAt: new Date() } }, { upsert: true })
  }

  // bot_blocked is set immediately (Telegram 403 = explicit block); others need DEAD_THRESHOLD failures.
  async function recordSendFailure(chatId, reason) {
    if (reason === 'bot_blocked') {
      await promoOptOut.updateOne(
        { _id: chatId },
        { $set: { optedOut: true, reason, updatedAt: new Date() }, $inc: { failCount: 1, blockCount: 1 } },
        { upsert: true }
      )
      const rec = await promoOptOut.findOne({ _id: chatId }).catch(() => null)
      const bc = rec?.blockCount || 1
      const ttl = _promoRetestTtlDays('bot_blocked', bc)
      log(`[AutoPromo] User ${chatId} marked dead (bot_blocked #${bc}) — re-test in ${ttl === Infinity ? 'never (eased off)' : ttl + 'd'}`)
      return
    }
    await promoOptOut.updateOne(
      { _id: chatId },
      { $set: { reason, updatedAt: new Date() }, $inc: { failCount: 1 } },
      { upsert: true }
    )
    const record = await promoOptOut.findOne({ _id: chatId })
    if (record?.failCount >= DEAD_THRESHOLD) {
      await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut: true } })
      log(`[AutoPromo] User ${chatId} marked dead after ${record.failCount} consecutive failures (${reason})`)
    }
  }

  async function getAllChatIds() {
    try {
      const users = await nameOf.find({}).project({ _id: 1 }).toArray()
      return users
        .map(u => u._id)
        .filter(id => id != null && (typeof id === 'string' || typeof id === 'number'))
        .map(id => String(id))
    } catch (error) {
      log(`[AutoPromo] Error fetching chat IDs: ${error.message}`)
      return []
    }
  }

  async function getUserLanguage(chatId) {
    try {
      const userState = await stateCol.findOne({ _id: chatId })
      const lang = userState?.userLanguage || 'en'
      return promoCopy.copyFor('cloudphone', lang) && LANG_NAMES[lang] ? lang : 'en'
    } catch { return 'en' }
  }

  // Bulk state load (language + activity) — replaces the old per-user findOne loop.
  async function loadStates(chatIds) {
    const map = new Map()
    try {
      const docs = await stateCol.find({ _id: { $in: chatIds } }).project({ userLanguage: 1, lastActiveAt: 1 }).toArray()
      for (const d of docs) map.set(String(d._id), d)
    } catch (e) { log(`[AutoPromo] state bulk load error: ${e.message}`) }
    return map
  }

  // ── Audience profile: owned themes + browsed-but-not-bought theme ──
  const OWNERSHIP_PROBES = [
    { col: 'phoneNumbersOf', theme: 'cloudphone', nonEmptyVal: 'numbers' },
    { col: 'cpanelAccounts', theme: 'antired_hosting', extra: { deleted: { $ne: true } } },
    { col: 'domainsOf', theme: 'domains_shortener', nonEmptyVal: true },
    { col: 'vpsPlansOf', theme: 'vps_rdp', nonEmptyVal: true },
    { col: 'leadJobs', theme: 'leads_validation' },
    { col: 'digitalOrders', theme: 'digital_products' },
    { col: 'marketplaceProducts', theme: 'marketplace' },
  ]

  async function buildProfiles(chatIds) {
    const profiles = new Map()
    const prof = cid => { cid = String(cid); if (!profiles.has(cid)) profiles.set(cid, { owned: new Set(), browsed: null }); return profiles.get(cid) }
    const ids = chatIds.map(String)
    const idVariants = [...ids, ...ids.map(Number).filter(Number.isFinite)]
    for (const probe of OWNERSHIP_PROBES) {
      try {
        const q = { $or: [{ _id: { $in: idVariants } }, { chatId: { $in: idVariants } }, { sellerId: { $in: idVariants } }], ...(probe.extra || {}) }
        const docs = await db.collection(probe.col).find(q).project({ _id: 1, chatId: 1, sellerId: 1, val: 1 }).toArray()
        for (const d of docs) {
          if (probe.nonEmptyVal) {
            const arr = probe.nonEmptyVal === true ? d.val : d.val?.[probe.nonEmptyVal]
            if (Array.isArray(arr) && arr.length === 0) continue
          }
          const owner = d.chatId ?? d.sellerId ?? d._id
          if (owner != null && ids.includes(String(owner))) prof(owner).owned.add(probe.theme)
        }
      } catch (e) { log(`[AutoPromo] ownership probe ${probe.col} failed: ${e.message}`) }
    }
    try {
      const docs = await db.collection('browseTracking').find({ chatId: { $in: idVariants } }).project({ chatId: 1, lastCategory: 1, browseCount: 1 }).toArray()
      for (const d of docs) {
        const counts = Object.entries(d.browseCount || {}).sort((a, b) => b[1] - a[1])
        const top = counts[0]?.[0] || d.lastCategory
        const theme = BROWSE_TO_THEME[top]
        if (theme) prof(d.chatId).browsed = theme
      }
    } catch (e) { log(`[AutoPromo] browse probe failed: ${e.message}`) }
    return profiles
  }

  function isUnreachableError(error) {
    const msg = error.message || ''
    return msg.includes('chat not found') || msg.includes('user is deactivated') || msg.includes('bot was blocked') || msg.includes('have no rights to send a message')
  }

  function classifyOptOutReason(error) {
    const msg = error.message || ''
    if (msg.includes('chat not found')) return 'chat_not_found'
    if (msg.includes('user is deactivated')) return 'user_deactivated'
    if (msg.includes('bot was blocked')) return 'bot_blocked'
    if (msg.includes('have no rights to send a message')) return 'no_rights'
    return 'unknown'
  }

  const PROMO_SEND_RETRIES = 2
  const PROMO_RETRY_DELAY = 2000

  // Safety trimmer kept for AI/legacy inputs — the template itself never exceeds this.
  const PROMO_BODY_MAX_CHARS = 420

  function _trimPromoBody(raw) {
    if (typeof raw !== 'string') return raw
    const plain = raw.replace(/<[^>]+>/g, '')
    if (plain.length <= PROMO_BODY_MAX_CHARS) return raw
    let cutoff = PROMO_BODY_MAX_CHARS
    const sentenceEnd = Math.max(raw.lastIndexOf('. ', cutoff), raw.lastIndexOf('! ', cutoff), raw.lastIndexOf('? ', cutoff), raw.lastIndexOf('\n', cutoff))
    if (sentenceEnd > cutoff - 120) cutoff = sentenceEnd
    else {
      const wordEnd = raw.lastIndexOf(' ', cutoff)
      if (wordEnd > 0) cutoff = wordEnd
    }
    return raw.slice(0, cutoff).replace(/[\s,;—-]+$/, '') + ' …'
  }

  // Build the exact message a user receives (text + keyboard + optional banner).
  function composePromo({ theme, lang, mode = 'hero', variation = 0, ai = null, couponLine = null, prices }) {
    const r = promoCopy.renderPromo({ theme, lang, variation, mode, prices: prices || getPromoPrices(), couponLine, ai })
    if (!r) return null
    return { text: _trimPromoBody(r.text), reply_markup: promoCopy.inlineKeyboard(theme, lang, r.buttonLabel), banner: bannerFor(theme), theme, mode }
  }

  async function sendPromoToUser(chatId, composed, slotType = 'morning') {
    try {
      if (await isOptedOut(chatId)) return { success: true, skipped: true }
      if (!composed) return { success: false, error: 'no copy' }
      const { text, reply_markup, banner } = composed

      const trySend = async (useHtml) => {
        const opts = { reply_markup, ...(useHtml ? { parse_mode: 'HTML' } : {}) }
        if (banner) {
          try {
            await bot.sendPhoto(chatId, banner, { caption: text, ...opts })
            return
          } catch (imgErr) {
            if (isUnreachableError(imgErr)) throw imgErr
            const _code = imgErr.response?.statusCode
            const _is429 = _code === 429 || /too many requests/i.test(imgErr.message || '')
            if (!_is429) log(`[AutoPromo] banner failed for ${chatId}, text fallback: ${imgErr.message}`)
          }
        }
        await bot.sendMessage(chatId, text, { ...opts, disable_web_page_preview: true })
      }

      const markSent = () => {
        promoOptOut.updateOne({ _id: chatId }, { $set: { failCount: 0 } }).catch(() => {})
        if (lifecycleDiet?.markUnsolicitedSent) lifecycleDiet.markUnsolicitedSent(chatId, slotType === 'evening' ? 'autopromo_evening' : 'autopromo_morning').catch(() => {})
      }

      for (let attempt = 1; attempt <= PROMO_SEND_RETRIES; attempt++) {
        try {
          try { await trySend(true) }
          catch (parseErr) {
            if (isUnreachableError(parseErr)) throw parseErr
            if (parseErr.message?.includes('parse') || parseErr.response?.statusCode === 400) {
              log(`[AutoPromo] HTML parse error for ${chatId}, retrying plain`)
              await trySend(false)
            } else throw parseErr
          }
          markSent()
          return { success: true }
        } catch (error) {
          const code = error.response?.statusCode
          const errMsg = (error.message || '').toLowerCase()
          if (errMsg.includes('user is deactivated')) {
            await setOptOut(chatId, true, 'user_deactivated')
            log(`[AutoPromo] User ${chatId} deactivated — permanently opted out`)
            return { success: false, error: error.message }
          }
          if (code === 429) {
            const retryAfter = error.response?.body?.parameters?.retry_after || parseInt((error.message.match(/retry after (\d+)/i) || [])[1]) || 30
            log(`[AutoPromo] Rate limited on ${chatId}, waiting ${retryAfter}s before continuing`)
            await sleep(retryAfter * 1000)
            try {
              await trySend(true)
              markSent()
              return { success: true, retryAfterWait: true }
            } catch {
              log(`[AutoPromo] Still rate limited on ${chatId} after wait, skipping`)
              return { success: false, error: 'rate_limited', rateLimited: true }
            }
          }
          if (attempt < PROMO_SEND_RETRIES) {
            await sleep(PROMO_RETRY_DELAY * attempt)
            continue
          }
          if (code === 403 || isUnreachableError(error)) {
            const reason = classifyOptOutReason(error)
            await recordSendFailure(chatId, reason)
            const alreadyLoggedByRecord = reason === 'bot_blocked' || reason === 'user_deactivated'
            if (!alreadyLoggedByRecord || process.env.AUTOPROMO_VERBOSE === '1') {
              log(`[AutoPromo] Unreachable ${chatId}: ${reason} (${error.message?.substring(0, 80)})`)
            }
          } else {
            log(`[AutoPromo] Failed ${chatId}: [${code || 'unknown'}] ${error.message}`)
          }
          return { success: false, error: error.message }
        }
      }
      return { success: false, error: 'exhausted retries' }
    } catch (error) {
      log(`[AutoPromo] Unexpected error for ${chatId}: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async function todayCouponLine() {
    if (!dailyCouponSystem) return null
    try {
      const codes = await dailyCouponSystem.getTodayCoupons()
      const entries = Object.entries(codes)
      if (!entries.length) return null
      const [code, info] = entries[Math.floor(Math.random() * entries.length)]
      return `🎁 <b>TODAY ${info.discount}% OFF</b> — code <code>${code}</code>`
    } catch (err) { log(`[AutoPromo] Coupon error: ${err.message}`); return null }
  }

  // Plan one blast: who gets which theme, in which mode.
  function planAudience({ targetChatIds, profiles, dayTheme, slotType, now = new Date(), env = process.env }) {
    const dayIndex = Math.floor(now.getTime() / 86400000)
    const plan = []
    let cadenceSkipped = 0, noTheme = 0
    const reasons = {}
    for (const cid of targetChatIds) {
      const slot = cadenceSlot(cid, now)
      if (slot !== slotType) { cadenceSkipped++; continue }
      const p = profiles.get(String(cid)) || { owned: new Set(), browsed: null }
      const pick = pickTheme({ owned: p.owned, browsed: p.browsed, hash: hashId(cid), dayTheme, slot: slotType, dayIndex, env })
      if (!pick) { noTheme++; continue }
      reasons[pick.reason] = (reasons[pick.reason] || 0) + 1
      plan.push({ chatId: cid, ...pick })
    }
    return { plan, cadenceSkipped, noTheme, reasons }
  }

  async function broadcastPromoForLang(themeIndex, lang, slotType = 'morning') {
    if (themeIndex === undefined || themeIndex === null) {
      log(`[AutoPromo] Skipping ${slotType} broadcast for ${lang} — no theme index (likely rest day)`)
      return
    }
    const dayTheme = THEMES[themeIndex]
    if (!dayTheme) {
      log(`[AutoPromo] Skipping ${slotType} broadcast for ${lang} — invalid theme index: ${themeIndex}`)
      return
    }
    const isEvening = slotType === 'evening'
    const allChatIds = await getAllChatIds()
    if (allChatIds.length === 0) return log(`[AutoPromo] No users found`)

    const permanentlyDead = await promoOptOut.find({
      optedOut: true,
      reason: { $in: ['chat_not_found', 'user_deactivated', 'bot_blocked'] }
    }).toArray()
    const deadSet = new Set(permanentlyDead.map(r => r._id))

    const states = await loadStates(allChatIds)
    const targetChatIds = []
    let skippedDead = 0
    let skippedInactive = 0
    const now = new Date()
    for (const chatId of allChatIds) {
      if (deadSet.has(chatId)) { skippedDead++; continue }
      const st = states.get(chatId)
      if (st?.lastActiveAt) {
        const daysSinceActive = (now - new Date(st.lastActiveAt)) / (1000 * 60 * 60 * 24)
        if (daysSinceActive > 30) { skippedInactive++; continue }
      }
      const userLang = st?.userLanguage && LANG_NAMES[st.userLanguage] ? st.userLanguage : 'en'
      if (userLang === lang) targetChatIds.push(chatId)
    }

    // ── Lifecycle Diet (#18): 24h cap, <72h-old users, active balance wall ──
    let dietCap = 0, dietWelcome = 0, dietWall = 0
    const preDietCount = targetChatIds.length
    if (lifecycleDiet?.buildSuppressionSets) {
      try {
        const sets = await lifecycleDiet.buildSuppressionSets(targetChatIds)
        const kept = []
        for (const cid of targetChatIds) {
          if (sets.capped.has(cid)) { dietCap++; continue }
          if (sets.welcome.has(cid)) { dietWelcome++; continue }
          if (sets.balanceWall.has(cid)) { dietWall++; continue }
          kept.push(cid)
        }
        targetChatIds.length = 0
        targetChatIds.push(...kept)
      } catch (e) { log(`[AutoPromo] Lifecycle-diet filter error (sending unfiltered): ${e.message}`) }
    }

    if (targetChatIds.length === 0) return log(`[AutoPromo] No ${lang} users for ${dayTheme} (${skippedDead} dead, ${skippedInactive} inactive; diet: cap=${dietCap} welcome=${dietWelcome} wall=${dietWall} skipped)`)

    // ── Per-user cadence + theme selection ──
    const profiles = await buildProfiles(targetChatIds)
    const { plan, cadenceSkipped, noTheme, reasons } = planAudience({ targetChatIds, profiles, dayTheme, slotType, now })
    log(`[AutoPromo] ${lang}/${slotType}: ${plan.length} planned of ${targetChatIds.length} eligible (${preDietCount} pre-diet; cadence skipped=${cadenceSkipped}, nothing-to-offer=${noTheme}; diet cap=${dietCap} welcome=${dietWelcome} wall=${dietWall}; ${skippedDead} dead, ${skippedInactive} inactive) reasons=${JSON.stringify(reasons)}`)
    if (plan.length === 0) return

    try {
      if (adminChatId && bot?.sendMessage) {
        const deadByReason = {}
        for (const r of permanentlyDead) { const k = r.reason || 'unknown'; deadByReason[k] = (deadByReason[k] || 0) + 1 }
        const report = _buildBlockRateReport({
          theme: dayTheme, lang, slot: slotType,
          totalUsers: allChatIds.length, targets: plan.length,
          dead: deadSet.size, deadByReason, inactive: skippedInactive,
        })
        await bot.sendMessage(adminChatId, report, { parse_mode: 'HTML' }).catch(() => {})
      }
    } catch (e) { log(`[AutoPromo] block-rate report error: ${e.message}`) }

    // ── Compose once per (theme, mode): rotation index, AI hook (hero only), banner ──
    const prices = getPromoPrices()
    const couponLine = await todayCouponLine()
    const composedCache = new Map()
    let aiUsed = 0
    const themeCounts = {}
    for (const item of plan) {
      const key = `${item.theme}:${item.mode}`
      themeCounts[item.theme] = (themeCounts[item.theme] || 0) + 1
      if (composedCache.has(key)) continue
      const rotationKey = item.mode === 'cross' ? `${item.theme}_evening_${lang}` : `${item.theme}_${lang}`
      const variation = await getRotationIndex(item.theme, lang, rotationKey)
      let ai = null
      if (item.mode === 'hero') {
        try { ai = await generateDynamicPromo(item.theme, lang) } catch (err) { log(`[AutoPromo] AI fail: ${err.message}`) }
        if (ai) aiUsed++
      }
      composedCache.set(key, composePromo({ theme: item.theme, lang, mode: item.mode, variation, ai, couponLine, prices }))
    }
    log(`[AutoPromo] Broadcasting ${lang} ${isEvening ? '🌙evening' : '🌅morning'} to ${plan.length} users — themes=${JSON.stringify(themeCounts)} ai=${aiUsed}/${composedCache.size}`)

    const { BATCH_SIZE, DELAY_BETWEEN_BATCHES, DELAY_BETWEEN_MESSAGES } = BROADCAST_CONFIG
    let successCount = 0, errorCount = 0, skippedCount = 0

    // Banner sends need slower pacing to avoid Telegram 429 on media
    const hasMedia = [...composedCache.values()].some(c => c?.banner)
    const batchSize = hasMedia ? Math.min(BATCH_SIZE, 10) : BATCH_SIZE
    const msgDelay = hasMedia ? Math.max(DELAY_BETWEEN_MESSAGES, 200) : DELAY_BETWEEN_MESSAGES
    const batchDelay = hasMedia ? Math.max(DELAY_BETWEEN_BATCHES, 3000) : DELAY_BETWEEN_BATCHES

    const failedDetails = []
    const errorReasonCounts = {}
    for (let i = 0; i < plan.length; i += batchSize) {
      const batch = plan.slice(i, i + batchSize)
      const results = await Promise.allSettled(batch.map(async (item, index) => {
        await sleep(index * msgDelay)
        const r = await sendPromoToUser(item.chatId, composedCache.get(`${item.theme}:${item.mode}`), slotType)
        return { chatId: item.chatId, ...r }
      }))
      let batchRateLimited = false
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value?.skipped) skippedCount++
          else if (result.value?.success) successCount++
          else {
            errorCount++
            if (result.value?.rateLimited) batchRateLimited = true
            const errMsg = (result.value?.error || 'unknown').substring(0, 120)
            const bucket = (errMsg.match(/^[A-Z0-9_]+/) || ['other'])[0]
            errorReasonCounts[bucket] = (errorReasonCounts[bucket] || 0) + 1
            if (failedDetails.length < 50) failedDetails.push({ chatId: result.value?.chatId, error: errMsg })
          }
        } else {
          errorCount++
          const errMsg = (result.reason?.message || String(result.reason || 'rejected')).substring(0, 120)
          const bucket = (errMsg.match(/^[A-Z0-9_]+/) || ['rejected'])[0]
          errorReasonCounts[bucket] = (errorReasonCounts[bucket] || 0) + 1
          if (failedDetails.length < 50) failedDetails.push({ chatId: 'unknown', error: errMsg })
        }
      }
      const nextDelay = batchRateLimited ? Math.max(batchDelay, 5000) : batchDelay
      if (i + batchSize < plan.length) await sleep(nextDelay)
    }

    const stats = {
      theme: dayTheme, themes: themeCounts, reasons, lang, slot: slotType, variation: 'per-user', usedAI: aiUsed > 0, aiUsed,
      total: plan.length, eligible: targetChatIds.length, cadenceSkipped, success: successCount, errors: errorCount, skipped: skippedCount,
      errorBreakdown: errorReasonCounts, timestamp: new Date().toISOString(), sentAt: new Date(),
      diet: { cap: dietCap, welcome: dietWelcome, balanceWall: dietWall },
      liftStartCount: 0, liftHubTapCount: 0, liftUserIds: [], liftWindowMs: LIFT_WINDOW_MS, liftEvaluated: false,
    }
    log(`[AutoPromo] Done:`, JSON.stringify(stats))
    if (errorCount > 0) {
      const breakdownStr = Object.entries(errorReasonCounts).map(([k, v]) => `${k}=${v}`).join(' ')
      log(`[AutoPromo] Error breakdown for ${lang}/${slotType}: ${breakdownStr}`)
      for (const f of failedDetails.slice(0, 10)) log(`[AutoPromo]   ↳ failed chatId=${f.chatId} error="${f.error}"`)
    }
    const _statsRes = await db.collection('promoStats').insertOne(stats)
    if (_statsRes?.insertedId) {
      setTimeout(() => { evaluateBlastLift(_statsRes.insertedId).catch(() => {}) }, LIFT_WINDOW_MS + 60 * 1000)
    }
  }

  // ─── Day-of-week → default theme (fallback when a user has no browse/ownership signal) ──
  const DAY_SCHEDULE = {
    0: [7, 3],                // Sun: marketplace, domains_shortener
    1: [0, 8],                // Mon: cloudphone, vps_rdp
    2: [1, 6],                // Tue: antired_hosting, email_validation
    3: [8, 2],                // Wed: vps_rdp, leads_validation
    4: [3, 1],                // Thu: domains_shortener, antired_hosting
    5: [7, 4],                // Fri: marketplace, digital_products
    6: [5, 8],                // Sat: cards_bundles, vps_rdp
  }

  function getTodayThemes() {
    const day = new Date().getDay()
    return DAY_SCHEDULE[day] || []
  }

  const supportedLangs = Object.keys(TIMEZONE_OFFSETS)
  let scheduledCount = 0

  for (const lang of supportedLangs) {
    const offset = TIMEZONE_OFFSETS[lang]
    LOCAL_TIMES.forEach((localTime, slotIndex) => {
      const utcTime = localToUtc(localTime.hour, localTime.minute, offset)
      const cronExpr = `${utcTime.minute} ${utcTime.hour} * * *`
      const slotType = slotIndex === 0 ? 'morning' : 'evening'
      schedule.scheduleJob(cronExpr, () => {
        const todayThemes = getTodayThemes()
        const themeIndex = todayThemes[slotIndex]
        if (themeIndex === undefined) {
          log(`[AutoPromo] Skipping ${lang} ${slotType} — no promo today (rest day)`)
          return
        }
        log(`[AutoPromo] Triggered ${THEMES[themeIndex]} ${slotType === 'evening' ? '🌙evening' : '🌅morning'} for ${lang} (local ${localTime.hour}:${String(localTime.minute).padStart(2, '0')})`)
        broadcastPromoForLang(themeIndex, lang, slotType).catch(err => log(`[AutoPromo] Broadcast error: ${err.message}`))
      })
      log(`[AutoPromo] Scheduled ${slotType} for ${lang.toUpperCase()} at local ${localTime.hour}:${String(localTime.minute).padStart(2, '0')} (UTC ${utcTime.hour}:${String(utcTime.minute).padStart(2, '0')})`)
      scheduledCount++
    })
  }

  log(`[AutoPromo] Initialized — ${scheduledCount} jobs (${supportedLangs.length} langs × ${LOCAL_TIMES.length} slots/day), ${THEMES.length} themes, per-user cadence=${process.env.PROMO_CADENCE === 'daily' ? 'daily' : 'every other day'}, brand banners=${brandSlug()}`)

  // ─── Resurrection Scan ─────────────────────────────────────────────────
  const RESURRECT_BATCH_SIZE = 200
  const RESURRECT_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

  async function runResurrectionScan() {
    try {
      const candidates = await promoOptOut.find({
        optedOut: true,
        reason: { $in: ['chat_not_found', 'bot_blocked'] }
      }).sort({ failCount: 1, updatedAt: 1 }).limit(RESURRECT_BATCH_SIZE).toArray()

      if (!candidates.length) {
        log(`[ResurrectionScan] No candidates to test`)
        return { tested: 0, resurrected: 0 }
      }

      log(`[ResurrectionScan] Testing ${candidates.length} dead users...`)
      let resurrected = 0
      let stillDead = 0

      for (const user of candidates) {
        try {
          await bot.getChat(user._id)
          await promoOptOut.updateOne({ _id: user._id }, {
            $set: { optedOut: false, updatedAt: new Date(), reOptInReason: 'resurrection_scan', failCount: 0 }
          })
          resurrected++
        } catch {
          stillDead++
          await promoOptOut.updateOne({ _id: user._id }, {
            $inc: { failCount: 1 },
            $set: { updatedAt: new Date() }
          }).catch(() => {})
        }
        await sleep(100)
      }

      const stats = { tested: candidates.length, resurrected, stillDead, timestamp: new Date().toISOString() }
      log(`[ResurrectionScan] Done: ${JSON.stringify(stats)}`)
      await db.collection('resurrectionStats').insertOne(stats)
      return stats
    } catch (error) {
      log(`[ResurrectionScan] Error: ${error.message}`)
      return { error: error.message }
    }
  }

  setInterval(() => {
    runResurrectionScan().catch(err => log(`[ResurrectionScan] Unhandled: ${err.message}`))
  }, RESURRECT_INTERVAL_MS)

  setTimeout(() => {
    runResurrectionScan().catch(err => log(`[ResurrectionScan] Initial scan error: ${err.message}`))
  }, 5 * 60 * 1000)
  log(`[AutoPromo] Resurrection scan enabled — every 6h, ${RESURRECT_BATCH_SIZE} users/batch`)

  // ─── Promo Response Tracking ───────────────────────────────────────────
  const PROMO_RESPONSE_WINDOW_MS = 60 * 60 * 1000 // 60 minutes

  async function trackPromoResponse(chatId) {
    try {
      const recentPromo = await db.collection('promoStats').findOne({
        timestamp: { $gte: new Date(Date.now() - PROMO_RESPONSE_WINDOW_MS).toISOString() }
      })
      if (!recentPromo) return
      await db.collection('promoResponses').updateOne(
        { chatId, date: new Date().toISOString().slice(0, 10) },
        { $set: { chatId, respondedAt: new Date(), theme: recentPromo.theme }, $inc: { responseCount: 1 } },
        { upsert: true }
      )
    } catch { /* tracking must never break the main flow */ }
  }

  // ─── Per-blast Lift Metric (#18) ──────────────────────────────────────
  async function recordPromoLift(chatId, kind = 'start') {
    try {
      const cid = String(chatId)
      const since = new Date(Date.now() - LIFT_WINDOW_MS)
      const userLang = await getUserLanguage(cid)
      const blast = await db.collection('promoStats')
        .find({ sentAt: { $gte: since }, lang: userLang })
        .sort({ sentAt: -1 }).limit(1).next()
      if (!blast) return
      if (Array.isArray(blast.liftUserIds) && blast.liftUserIds.includes(cid)) return // 1 lift/user/blast
      const incField = kind === 'hubtap' ? 'liftHubTapCount' : 'liftStartCount'
      const update = { $inc: { [incField]: 1 } }
      if (!Array.isArray(blast.liftUserIds) || blast.liftUserIds.length < 2000) {
        update.$addToSet = { liftUserIds: cid }
      }
      await db.collection('promoStats').updateOne({ _id: blast._id }, update)
    } catch { /* metric only — never break the main flow */ }
  }

  async function evaluateBlastLift(statsId) {
    try {
      const doc = await db.collection('promoStats').findOne({ _id: statsId })
      if (!doc || doc.liftEvaluated) return
      const returned = Array.isArray(doc.liftUserIds) ? doc.liftUserIds.length : 0
      const delivered = doc.success || 0
      const liftRate = delivered > 0 ? +((returned / delivered) * 100).toFixed(2) : 0
      await db.collection('promoStats').updateOne(
        { _id: statsId },
        { $set: { liftEvaluated: true, liftReturnedUsers: returned, liftRate } }
      )
      log(`[AutoPromo][Lift] ${doc.theme}/${doc.lang}/${doc.slot}: ${returned} returned of ${delivered} delivered (${liftRate}% lift, starts=${doc.liftStartCount || 0} hubtaps=${doc.liftHubTapCount || 0})`)
      if (returned === 0 && delivered >= 20) {
        const v = await zeroLiftVerdict(doc)
        if (v.alert) {
          alertAdmin(`⚠️ Zero-lift theme: <b>${doc.theme}/${doc.lang}/${doc.slot}</b> — 0 returns from ${v.deliveredTotal} delivered over ${v.blasts} blast(s) in ${LIFT_BASELINE_DAYS} days (normal return rate ${v.ratePct}% → ~${v.expected} expected). Consider dropping this theme/slot.`)
        } else {
          log(`[AutoPromo][Lift] zero-lift not alerted for ${doc.theme}/${doc.lang}/${doc.slot}: ${v.reason}`)
        }
      }
    } catch (e) { log(`[AutoPromo][Lift] eval error: ${e.message}`) }
  }

  // Zero returns from ONE blast is normal: users return to a blast at ~0.1-0.3% (1 in 400-1000), so a
  // 200-user blast has 0 returns ~2 times out of 3 by pure chance (2026-10-14 RCA — the old ">= 20
  // delivered" rule alerted on almost every blast). Alert only when the zero is SURPRISING: this
  // theme/lang/slot had no returns at all over the last 30 days while, at the normal return rate of the
  // other blasts in that language, >= 3 were expected (P(0) ≈ e^-3 ≈ 5%). Max once per 7 days per slot.
  async function zeroLiftVerdict(doc) {
    const since = new Date(Date.now() - LIFT_BASELINE_DAYS * 86400000)
    const rows = await db.collection('promoStats')
      .find({ lang: doc.lang, liftEvaluated: true, sentAt: { $gte: since }, _id: { $ne: doc._id } }, { projection: { theme: 1, slot: 1, success: 1, liftReturnedUsers: 1 } })
      .toArray()
    let baseDel = 0, baseRet = 0, delivered = doc.success || 0, returned = 0, blasts = 1
    for (const r of rows) {
      if (r.theme === doc.theme && r.slot === doc.slot) { delivered += r.success || 0; returned += r.liftReturnedUsers || 0; blasts++ } else { baseDel += r.success || 0; baseRet += r.liftReturnedUsers || 0 }
    }
    if (returned > 0) return { alert: false, reason: `${returned} return(s) from ${delivered} delivered over ${blasts} blast(s) in ${LIFT_BASELINE_DAYS}d — this blast's zero is normal noise` }
    if (baseDel < LIFT_BASELINE_MIN_DELIVERED || baseRet === 0) return { alert: false, reason: `not enough ${doc.lang} history to judge (${baseRet} returns / ${baseDel} delivered in ${LIFT_BASELINE_DAYS}d)` }
    const rate = baseRet / baseDel
    const expected = delivered * rate
    const fmt = { ratePct: +(rate * 100).toFixed(2), expected: +expected.toFixed(1), deliveredTotal: delivered, blasts }
    if (expected < LIFT_ALERT_MIN_EXPECTED) return { alert: false, ...fmt, reason: `0 of ${delivered} over ${blasts} blast(s) is normal at the ${fmt.ratePct}% return rate (~${fmt.expected} expected, need >= ${LIFT_ALERT_MIN_EXPECTED})` }
    const key = `lift_alert_${doc.theme}_${doc.lang}_${doc.slot}`
    const prev = await promoTracker.findOne({ _id: key })
    if (prev?.lastAlertAt && Date.now() - new Date(prev.lastAlertAt).getTime() < LIFT_ALERT_COOLDOWN_MS) return { alert: false, ...fmt, reason: 'already alerted in the last 7 days' }
    await promoTracker.updateOne({ _id: key }, { $set: { lastAlertAt: new Date(), delivered, expected: fmt.expected } }, { upsert: true })
    return { alert: true, ...fmt }
  }

  // ─── Admin helpers: channel post + in-bot preview ─────────────────────
  async function buildChannelPost(theme, lang = 'en') {
    if (!THEMES.includes(theme)) return null
    const variation = await getRotationIndex(theme, lang, `${theme}_channel_${lang}`)
    return promoCopy.renderChannelPost({ theme, lang, variation, prices: getPromoPrices(), couponLine: await todayCouponLine(), botUsername })
  }

  async function previewPromo(chatId, theme, lang = 'en', mode = 'hero') {
    if (!THEMES.includes(theme)) return { success: false, error: 'unknown theme' }
    const composed = composePromo({ theme, lang, mode, variation: 0, couponLine: await todayCouponLine(), prices: getPromoPrices() })
    const opts = { parse_mode: 'HTML', reply_markup: composed.reply_markup }
    if (composed.banner) await bot.sendPhoto(chatId, composed.banner, { caption: composed.text, ...opts })
    else await bot.sendMessage(chatId, composed.text, { ...opts, disable_web_page_preview: true })
    return { success: true, banner: !!composed.banner }
  }

  return {
    setOptOut,
    isOptedOut,
    recordSendFailure,
    broadcastPromoForLang,
    setDailyCouponSystem,
    runResurrectionScan,
    trackPromoResponse,
    recordPromoLift,
    evaluateBlastLift,
    zeroLiftVerdict,
    buildChannelPost,
    previewPromo,
    composePromo,
    planAudience,
    buildProfiles,
    getThemes: () => THEMES,
    getTodayThemes: () => getTodayThemes().map(i => THEMES[i]),
    getPromoMessages: () => promoCopy.legacyPools(getPromoPrices()).hero,
    getCrossSellMessages: () => promoCopy.legacyPools(getPromoPrices()).cross,
  }
}

// Legacy pool shape for any external reader ({ lang: { theme: [text...] } }).
let _legacy = null
function _pools() { if (!_legacy) _legacy = promoCopy.legacyPools(getPromoPrices()); return _legacy }

module.exports = {
  initAutoPromo,
  get promoMessages() { return _pools().hero },
  get crossSellMessages() { return _pools().cross },
  _promoRetestTtlDays,
  _buildBlockRateReport,
  // exported for tests
  cadenceSlot, pickTheme, hashId, generateDynamicPromo, sanitizeForTelegram, getOptOutFooter, getOptOutButtonText, bannerFor, brandSlug, THEMES, SERVICE_CONTEXT,
}
