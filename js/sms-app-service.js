/**
 * SMS App Service — Server-side campaign management for Nomadly SMS App
 * 
 * Provides APIs for:
 * - User authentication via activation code (Telegram chatId)
 * - Plan-based multi-device management (Monthly=unlimited, Weekly=10, Daily=3, Trial=1)
 * - Subscription-gated campaign CRUD
 * - Campaign sync between Telegram bot and mobile app
 * - SMS delivery reporting and analytics
 */

const { v4: uuidv4 } = require('uuid')

let db
let smsCampaigns
let nameOf
let planEndingTime
let freeSmsCountOf
let loginCountOf
let planOf

// ─── Device limits per subscription plan ───
const DEVICE_LIMITS = {
  Monthly: Infinity,   // unlimited
  Weekly: 10,
  Daily: 3,
  trial: 1,
  none: 1,
}

function getDeviceLimit(plan, isSubscribed, isFreeTrial) {
  if (!isSubscribed && isFreeTrial) return DEVICE_LIMITS.trial
  if (!isSubscribed) return DEVICE_LIMITS.none
  return DEVICE_LIMITS[plan] || 1
}

let _bot = null
const { translation } = require('./translation.js')
// Track users who have already received the trial-exhausted notification (prevent spam)
const _trialExhaustedNotified = new Set()

/**
 * Resolve user's preferred language for localised notifications.
 */
async function getUserLang(chatId) {
  try {
    const userState = await db?.collection('state').findOne({ _id: String(chatId) })
    return userState?.userLanguage || 'en'
  } catch (_) { return 'en' }
}

function initSmsAppService(_db, _nameOf, _planEndingTime, _freeSmsCountOf, _loginCountOf, _planOf, bot) {
  db = _db
  smsCampaigns = db.collection('smsCampaigns')
  nameOf = _nameOf
  planEndingTime = _planEndingTime
  freeSmsCountOf = _freeSmsCountOf
  loginCountOf = _loginCountOf
  planOf = _planOf
  _bot = bot

  smsCampaigns.createIndex({ chatId: 1 })
  smsCampaigns.createIndex({ chatId: 1, status: 1 })
  smsCampaigns.createIndex({ createdAt: -1 })
  // Per-user SMS app prefs (default SIM, rotate, bg-service toggle, detected SIMs)
  db.collection('userSmsPrefs').createIndex({ _id: 1 })
  // Auto-throttle telemetry (written by the app when it drops/slows a SIM mid-campaign)
  db.collection('smsThrottleEvents').createIndex({ chatId: 1, ts: -1 })
  db.collection('smsThrottleEvents').createIndex({ ts: -1 })

  console.log('[SmsApp] Service initialized')

  // ─── Stuck-campaign watchdog ───
  // The Android app's WebView reports campaign progress/completion via JS polling.
  // If the WebView dies (OS kill, force-close, network drop, deep sleep) before the
  // final `status: 'completed'` ping reaches the server, the campaign is left in
  // `status: 'sending'` forever. This watchdog reaps any campaign whose `updatedAt`
  // is older than STUCK_THRESHOLD_MS while still flagged `sending`:
  //   - sentCount > 0 → mark `completed`  (SMS likely went out, just no completion ping)
  //   - sentCount = 0 → mark `failed`     (nothing got delivered)
  // Counts and timestamps are preserved; we set `reapedAt` for forensics.
  const STUCK_THRESHOLD_MS = 30 * 60 * 1000        // 30 min since last progress
  const WATCHDOG_INTERVAL_MS = 15 * 60 * 1000      // run every 15 min

  async function reapStuckCampaigns() {
    try {
      const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS)
      const stuck = await smsCampaigns.find({
        status: 'sending',
        updatedAt: { $lt: cutoff },
      }).toArray()
      if (stuck.length === 0) return

      let completed = 0, failed = 0
      for (const c of stuck) {
        const sent = c.sentCount || 0
        const finalStatus = sent > 0 ? 'completed' : 'failed'
        await smsCampaigns.updateOne(
          { _id: c._id, status: 'sending' }, // guard against race with live progress ping
          { $set: { status: finalStatus, reapedAt: new Date(), reapedReason: 'watchdog-stuck-30min' } }
        )
        if (finalStatus === 'completed') completed++; else failed++
        const ageMin = Math.round((Date.now() - new Date(c.updatedAt).getTime()) / 60000)
        console.log(`[SmsApp] Watchdog reaped ${finalStatus}: campaign=${c._id} chatId=${c.chatId} sent=${sent} failed=${c.failedCount || 0} stale=${ageMin}min`)
      }
      console.log(`[SmsApp] Watchdog: reaped ${stuck.length} stuck campaign(s) — completed=${completed}, failed=${failed}`)
    } catch (err) {
      console.error('[SmsApp] Watchdog error:', err.message)
    }
  }

  // Run once on startup (catches anything stuck across deploys), then every 15 min
  setTimeout(reapStuckCampaigns, 30 * 1000)  // 30s after init so DB is ready
  setInterval(reapStuckCampaigns, WATCHDOG_INTERVAL_MS)
  console.log(`[SmsApp] Stuck-campaign watchdog scheduled every ${WATCHDOG_INTERVAL_MS / 60000}min (threshold: ${STUCK_THRESHOLD_MS / 60000}min)`)

  // ─── Proactive SMS App version announcement to ALL bot users ───
  // When a new version is deployed, automatically notify all users (not just app users)
  const SMS_APP_VERSION = '2.7.5'
  // Human-first, conversational release note. Shown verbatim in the broadcast
  // between the opening line and the download instructions. Keep it short and
  // free of internal jargon.
  const SMS_APP_RELEASE_NOTE =
    `Small background update — nothing new to learn. It just makes sure your app ` +
    `stays connected if we ever move servers, so you never need a reinstall.`

  ;(async () => {
    try {
      const announcementsCol = db.collection('appAnnouncements')
      const lastAnnounced = await announcementsCol.findOne({ _id: 'sms_app_version' })

      if (lastAnnounced?.version === SMS_APP_VERSION) {
        console.log(`[SmsApp] Version ${SMS_APP_VERSION} already announced — skipping broadcast`)
        return
      }

      console.log(`[SmsApp] New version ${SMS_APP_VERSION} detected (last announced: ${lastAnnounced?.version || 'none'}). Broadcasting to ALL users...`)

      // Mark as announced FIRST to prevent duplicate broadcasts on redeploy
      await announcementsCol.updateOne(
        { _id: 'sms_app_version' },
        { $set: { version: SMS_APP_VERSION, announcedAt: new Date() } },
        { upsert: true }
      )

      // Build the announcement message (conversational, human-first)
      const announcement =
`Hey — a new Nomadly SMS update is ready (v${SMS_APP_VERSION}).

${SMS_APP_RELEASE_NOTE}

To grab it: open the main menu → tap 📧 <b>BulkSMS</b> → 📱 <b>Download App</b>.`

      // Get ALL bot users and broadcast
      const { sendMessageToAllUsers } = require('./utils')
      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_CHAT_ID || '5590563715'

      // Small delay to let other services initialize
      setTimeout(() => {
        sendMessageToAllUsers(_bot, announcement, 'HTML', nameOf, adminChatId, db)
          .then(() => console.log(`[SmsApp] Version ${SMS_APP_VERSION} announcement broadcast started`))
          .catch(e => console.error(`[SmsApp] Announcement broadcast failed:`, e.message))
      }, 30000) // 30s delay after startup

    } catch (e) {
      console.error('[SmsApp] Version announcement check failed:', e.message)
    }
  })()
}

// ─── Helper: get value from key-value collection ───
async function getVal(collection, key) {
  const doc = await collection.findOne({ _id: key })
  if (!doc) return undefined
  if (doc.val === 0) return 0
  if (doc.val === false) return false
  return doc.val || undefined
}

// ─── Device session helpers ───
function getDevices(loginData) {
  // Support new format (devices array) and migrate from old format
  if (Array.isArray(loginData?.devices)) return loginData.devices
  // Old format: { loginCount, canLogin, lastLoginAt } → convert
  if (loginData?.canLogin === false && loginData?.lastLoginAt) {
    return [{ deviceId: 'legacy', loginAt: loginData.lastLoginAt, lastActive: loginData.lastLoginAt }]
  }
  return []
}

function cleanStaleDevices(devices, maxAgeHours = 24) {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000)
  return devices.filter(d => (d.lastActive || d.loginAt || 0) > cutoff)
}

// ─── Auth: Validate activation code and return user info ───
async function authenticateUser(chatId) {
  const strChatId = String(chatId)
  if (!strChatId || strChatId === 'NaN' || strChatId === 'undefined') return { valid: false, error: 'Invalid code' }

  const nameDoc = await nameOf.findOne({ _id: strChatId })
  const name = nameDoc?.val || nameDoc?.name
  if (!name) return { valid: false, error: 'Invalid activation code. Open @NomadlyBot on Telegram to get your code.' }

  const planExpiry = await getVal(planEndingTime, strChatId) || 0
  const freeSmsCount = await getVal(freeSmsCountOf, strChatId) || 0
  const plan = await getVal(planOf, strChatId) || 'none'
  const doc = await loginCountOf.findOne({ _id: strChatId })
  const loginData = doc?.val || doc || {}
  const devices = getDevices(loginData)

  const freeSmsLimit = Number(process.env.APP_FREE_SMS) || 100
  const isSubscribed = planExpiry > Date.now()
  const isFreeTrial = !isSubscribed && freeSmsCount < freeSmsLimit
  const canUseSms = isSubscribed || isFreeTrial
  const deviceLimit = getDeviceLimit(plan, isSubscribed, isFreeTrial)

  return {
    valid: true,
    user: {
      chatId: strChatId,
      name,
      plan,
      planExpiry,
      isSubscribed,
      isFreeTrial,
      canUseSms,
      freeSmsUsed: freeSmsCount,
      freeSmsLimit,
      freeSmsRemaining: Math.max(0, freeSmsLimit - freeSmsCount),
      deviceLimit: isFinite(deviceLimit) ? deviceLimit : 'unlimited',
      activeDevices: devices.length,
      loginCount: devices.length,
      canLogin: true,  // backward compat — real check is in auth route
    }
  }
}

// ─── Get active devices for a user ───
async function getActiveDevices(chatId) {
  const strChatId = String(chatId)
  const doc = await loginCountOf.findOne({ _id: strChatId })
  const loginData = doc?.val || doc || {}
  let devices = getDevices(loginData)
  devices = cleanStaleDevices(devices, 24)
  return devices
}

// ─── Subscription Check (reusable) ───
async function checkSubscription(chatId) {
  const strChatId = String(chatId)
  const planExpiry = await getVal(planEndingTime, strChatId) || 0
  const freeSmsCount = await getVal(freeSmsCountOf, strChatId) || 0
  const freeSmsLimit = Number(process.env.APP_FREE_SMS) || 100
  const isSubscribed = planExpiry > Date.now()
  const isFreeTrial = !isSubscribed && freeSmsCount < freeSmsLimit

  return {
    canUseSms: isSubscribed || isFreeTrial,
    isSubscribed,
    isFreeTrial,
    freeSmsRemaining: Math.max(0, freeSmsLimit - freeSmsCount),
  }
}

// ─── Campaign CRUD ───

async function createCampaign(chatId, data) {
  const campaign = {
    _id: uuidv4(),
    chatId: String(chatId),
    name: data.name || `Campaign ${new Date().toLocaleDateString()}`,
    content: data.content || [''],
    contacts: data.contacts || [],
    status: 'draft',
    smsGapTime: data.smsGapTime || 5,
    simSelection: data.simSelection || 'default',
    scheduledAt: data.scheduledAt || null,
    deviceId: data.deviceId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sentCount: 0,
    failedCount: 0,
    totalCount: (data.contacts || []).length,
    source: data.source || 'app',
    lastSentIndex: 0,
  }

  await smsCampaigns.insertOne(campaign)
  return campaign
}

async function getCampaigns(chatId) {
  return await smsCampaigns
    .find({ chatId: String(chatId) })
    .sort({ createdAt: -1 })
    .toArray()
}

async function getCampaign(campaignId) {
  return await smsCampaigns.findOne({ _id: campaignId })
}

async function updateCampaign(campaignId, chatId, updates) {
  const allowed = ['name', 'content', 'contacts', 'smsGapTime', 'scheduledAt', 'status', 'deviceId', 'simSelection']
  const safeUpdates = {}
  for (const key of allowed) {
    if (updates[key] !== undefined) safeUpdates[key] = updates[key]
  }
  safeUpdates.updatedAt = new Date()
  if (safeUpdates.contacts) {
    safeUpdates.totalCount = safeUpdates.contacts.length
  }

  const result = await smsCampaigns.updateOne(
    { _id: campaignId, chatId: String(chatId) },
    { $set: safeUpdates }
  )
  return result.modifiedCount > 0
}

async function deleteCampaign(campaignId, chatId) {
  const result = await smsCampaigns.deleteOne({
    _id: campaignId,
    chatId: String(chatId)
  })
  return result.deletedCount > 0
}

async function updateCampaignProgress(campaignId, chatId, progress) {
  const updates = { updatedAt: new Date() }
  if (progress.sentCount !== undefined) updates.sentCount = progress.sentCount
  if (progress.failedCount !== undefined) updates.failedCount = progress.failedCount
  if (progress.status !== undefined) updates.status = progress.status
  if (progress.lastSentIndex !== undefined) updates.lastSentIndex = progress.lastSentIndex

  await smsCampaigns.updateOne(
    { _id: campaignId, chatId: String(chatId) },
    { $set: updates }
  )
}

// ─── IMS / Wi-Fi Calling quirk detection ───
// On IMS carriers (notably T-Mobile Wi-Fi Calling), Android's sentIntent broadcast
// doesn't fire even though the SMS was sent. Older APKs (<2.7.5) interpret this
// as `send_timeout` failure. We detect the pattern and nudge users to update.

/**
 * Returns true if the given SIM carrier name matches a known IMS / Wi-Fi Calling
 * carrier where sentIntent broadcasts are known to be unreliable.
 */
function isLikelyImsCarrier(simCarrier) {
  if (!simCarrier) return false
  const s = String(simCarrier).toLowerCase()
  return (
    s.includes('wi-fi calling') ||
    s.includes('wifi calling') ||
    s.includes('wi-fi') && s.includes('calling') ||
    s.includes('ims') ||
    // T-Mobile on Wi-Fi Calling is the most common instance we see in logs
    (s.includes('t-mobile') && s.includes('wi-fi'))
  )
}

/**
 * Returns true if appVersion is strictly below `2.7.5` — i.e. the APK with the
 * IMS quirk fallback is NOT yet installed, so the user will keep hitting timeouts.
 */
function isPreImsFixVersion(appVersion) {
  if (!appVersion || appVersion === 'unknown') return true
  const [maj, min, patch] = String(appVersion).split('.').map(n => parseInt(n, 10) || 0)
  if (maj < 2) return true
  if (maj > 2) return false
  if (min < 7) return true
  if (min > 7) return false
  return patch < 5
}

/**
 * If the user has ≥5 recent send_timeout events on a matching IMS carrier and
 * is on an APK older than 2.7.5, send a one-time Telegram explainer + update prompt.
 * Idempotent via `val.ims_nudge_sent` flag on loginCountOf.
 */
async function maybeNudgeImsUser(strChatId, simCarrier, appVersion) {
  if (!isLikelyImsCarrier(simCarrier)) return
  if (!isPreImsFixVersion(appVersion)) return // user already on the fixed APK

  // Count recent send_timeout / multipart_timeout events for THIS user in the last 2 hours
  const recentCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const recentFails = await db.collection('testSmsLogs').countDocuments({
    chatId: strChatId,
    success: false,
    errorReason: { $in: ['send_timeout', 'multipart_timeout'] },
    simCarrier: { $exists: true, $ne: null },
    ts: { $gte: recentCutoff }
  })
  if (recentFails < 5) return // not enough signal yet

  // Check if we've already nudged this user (idempotent — once per appVersion cycle)
  const loginDoc = await loginCountOf.findOne({ _id: strChatId })
  const nudgeKey = `ims_nudge_${(appVersion || 'x').replace(/\./g, '_')}`
  if (loginDoc?.val?.[nudgeKey]) return

  const msg = `⚠️ <b>Heads up about your recent SMS</b>\n\n` +
    `We detected your device uses <b>Wi-Fi Calling / IMS</b> for SMS (${simCarrier}). ` +
    `This is a known Android quirk where your app can't verify SMS delivery, ` +
    `even though the messages are <b>actually being sent successfully</b>.\n\n` +
    `📊 We saw ${recentFails} "timed out" reports from you in the last 2 hours — ` +
    `most likely <i>all of those SMS reached their recipients</i>.\n\n` +
    `✅ A fix is available in <b>Nomadly SMS v2.7.5</b>. The new version verifies ` +
    `delivery via Android's system SMS log, so you'll see accurate results.\n\n` +
    `Tap the button below to download and reinstall.`

  try {
    if (_bot) {
      await _bot.sendMessage(strChatId, msg, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '📥 Update to v2.7.5', url: `${process.env.SELF_URL_PROD || process.env.SELF_URL || ''}/sms-app/download` }
          ]]
        }
      })
      console.log(`[SmsApp][IMS-Nudge] Sent update prompt to ${strChatId} (appVersion=${appVersion}, carrier=${simCarrier}, recentFails=${recentFails})`)
    }
  } catch (e) {
    console.warn(`[SmsApp][IMS-Nudge] send failed for ${strChatId}:`, e.message)
  }

  // Mark as nudged so we don't spam — persists per appVersion
  await loginCountOf.updateOne(
    { _id: strChatId },
    { $set: { [`val.${nudgeKey}`]: new Date(), 'val.ims_detected_carrier': simCarrier } },
    { upsert: true }
  )
}



// ─── Register Express Routes ───

function registerRoutes(app, get, set, increment, clicksOfSms, today, week, month, year) {

  // ── Bootstrap config for the SMS app ──
  // The APK hits this unauthenticated endpoint on launch to discover its
  // effective API base URL (allowing future server migrations without
  // rebuilding+redistributing the APK). All fields are optional — when
  // `apiBase` is absent or blank the app stays on its baked-in seed URL.
  // Kept on the same Express app so it's served by every deployment.
  app.get('/sms-app/config', (_req, res) => {
    res.json({
      apiBase: process.env.SMS_APP_API_BASE || null,
      minAppVersion: process.env.SMS_APP_MIN_VERSION || null,
      maintenance: process.env.SMS_APP_MAINTENANCE === 'true',
      maintenanceMessage: process.env.SMS_APP_MAINTENANCE_MESSAGE || null,
    })
  })

  // Auth endpoint — plan-based multi-device enforcement
  app.get('/sms-app/auth/:code', async (req, res) => {
    try {
      const deviceId = req.query.deviceId || 'unknown'
      const deviceName = req.query.deviceName || null
      const result = await authenticateUser(req.params.code)
      if (!result.valid) return res.status(401).json(result)

      const strChatId = String(req.params.code)
      const { plan, isSubscribed, isFreeTrial } = result.user
      const deviceLimit = getDeviceLimit(plan, isSubscribed, isFreeTrial)

      // Get current device sessions
      const doc = await loginCountOf.findOne({ _id: strChatId })
      const loginData = doc?.val || doc || {}
      let devices = getDevices(loginData)

      // Clean up stale sessions (>24h inactive)
      devices = cleanStaleDevices(devices, 24)

      // Check if this device is already registered
      const existingIdx = devices.findIndex(d => d.deviceId === deviceId)

      if (existingIdx >= 0) {
        // Returning device — update lastActive and deviceName if provided
        devices[existingIdx].lastActive = Date.now()
        if (deviceName) devices[existingIdx].deviceName = deviceName
      } else {
        // New device — check limit (Infinity means unlimited)
        if (isFinite(deviceLimit) && devices.length >= deviceLimit) {
          // For single-device plans (trial/daily), auto-replace the old device
          // This handles reinstalls, phone switches, etc.
          if (deviceLimit === 1) {
            console.log(`[SmsApp] Auto-replacing device for ${strChatId}: ${devices[0]?.deviceId} → ${deviceId}`)
            devices = [{ deviceId, deviceName: deviceName || null, loginAt: Date.now(), lastActive: Date.now() }]
          } else {
            const limitLabel = `${deviceLimit} devices`
            const planLabel = isFreeTrial ? 'Free Trial' : (plan || 'your plan')
            return res.status(403).json({
              valid: false,
              error: 'device_limit',
              message: `${planLabel} allows ${limitLabel}. You have ${devices.length} active. Logout from another device first, or type /resetlogin in @NomadlyBot.`,
              deviceLimit,
              activeDevices: devices.length,
            })
          }
        } else {
          // Add new device with optional name
          devices.push({ deviceId, deviceName: deviceName || null, loginAt: Date.now(), lastActive: Date.now() })
        }
      }

      // Save updated device sessions
      await set(loginCountOf, strChatId, {
        devices,
        loginCount: devices.length,
        canLogin: true, // device array handles session mgmt — keep true so old bot code doesn't block user
        lastLoginAt: Date.now()
      })

      // Add device info to response
      result.user.activeDevices = devices.length
      result.user.deviceLimit = isFinite(deviceLimit) ? deviceLimit : 'unlimited'

      res.json(result)
    } catch (error) {
      console.error('[SmsApp] Auth error:', error.message)
      res.status(500).json({ valid: false, error: 'Server error' })
    }
  })

  // Logout — remove specific device
  app.post('/sms-app/logout/:code', async (req, res) => {
    try {
      const strChatId = String(req.params.code)
      const deviceId = req.body?.deviceId || req.query?.deviceId || null

      const doc = await loginCountOf.findOne({ _id: strChatId })
      const loginData = doc?.val || doc || {}
      let devices = getDevices(loginData)

      if (deviceId) {
        // Remove specific device
        devices = devices.filter(d => d.deviceId !== deviceId)
      } else {
        // Remove all devices (full /resetlogin)
        devices = []
      }

      await set(loginCountOf, strChatId, {
        ...loginData,
        devices,
        loginCount: 0,
        canLogin: true,
      })
      res.json({ success: true, message: deviceId ? 'Device logged out' : 'All devices logged out' })
    } catch (error) {
      console.error('[SmsApp] Logout error:', error.message)
      res.status(500).json({ error: 'Server error' })
    }
  })

  // ── Update device name ──
  app.put('/sms-app/device/name', async (req, res) => {
    const { code, deviceId, deviceName } = req.body
    
    if (!code || !deviceId) {
      return res.status(400).json({ error: 'Missing code or deviceId' })
    }
    
    if (!deviceName || deviceName.trim().length === 0) {
      return res.status(400).json({ error: 'Device name cannot be empty' })
    }
    
    if (deviceName.trim().length > 50) {
      return res.status(400).json({ error: 'Device name too long (max 50 characters)' })
    }

    try {
      const strChatId = String(code)
      const doc = await loginCountOf.findOne({ _id: strChatId })
      const loginData = doc?.val || doc || {}
      let devices = getDevices(loginData)
      
      const deviceIdx = devices.findIndex(d => d.deviceId === deviceId)
      if (deviceIdx === -1) {
        return res.status(404).json({ error: 'Device not found' })
      }
      
      devices[deviceIdx].deviceName = deviceName.trim()
      
      await set(loginCountOf, strChatId, {
        ...loginData,
        devices,
      })
      
      res.json({ success: true, deviceName: deviceName.trim() })
    } catch (error) {
      console.log(`[SmsApp] Update device name error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // Logout — remove specific device
  app.post('/sms-app/logout/:code', async (req, res) => {
    try {
      const strChatId = String(req.params.code)
      const deviceId = req.body?.deviceId || req.query?.deviceId || null

      const doc = await loginCountOf.findOne({ _id: strChatId })
      const loginData = doc?.val || doc || {}
      let devices = getDevices(loginData)

      if (deviceId) {
        devices = devices.filter(d => d.deviceId !== deviceId)
      } else {
        // No deviceId — remove all (backward compat / full reset)
        devices = []
      }

      await set(loginCountOf, strChatId, {
        devices,
        loginCount: devices.length,
        canLogin: true, // device array handles session mgmt
        lastLoginAt: loginData.lastLoginAt || Date.now()
      })

      res.json({ ok: true, activeDevices: devices.length })
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message })
    }
  })

  // Get plan info
  app.get('/sms-app/plan/:code', async (req, res) => {
    try {
      const result = await authenticateUser(req.params.code)
      if (!result.valid) return res.status(401).json(result)
      res.json(result.user)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Get all campaigns for user
  app.get('/sms-app/campaigns/:chatId', async (req, res) => {
    try {
      const campaigns = await getCampaigns(req.params.chatId)
      res.json({ campaigns })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Create campaign — SUBSCRIPTION GATED
  app.post('/sms-app/campaigns', async (req, res) => {
    try {
      const { chatId, name, content, contacts, smsGapTime, scheduledAt, source } = req.body
      if (!chatId) return res.status(400).json({ error: 'chatId required' })

      // Enforce subscription
      const sub = await checkSubscription(chatId)
      if (!sub.canUseSms) {
        // Send one-time Telegram notification when BulkSMS trial is exhausted
        const notifKey = `sms_trial_${chatId}`
        if (_bot && !_trialExhaustedNotified.has(notifKey)) {
          _trialExhaustedNotified.add(notifKey)
          // Auto-cleanup after 24h to allow re-notification if they come back later
          setTimeout(() => _trialExhaustedNotified.delete(notifKey), 24 * 60 * 60 * 1000)
          const BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'
          const lang = await getUserLang(chatId)
          const tt = (key, ...args) => translation(`t.${key}`, lang, ...args)
          _bot.sendMessage(Number(chatId),
            tt('smsAppTrialCompleteTitle') + '\n\n' +
            tt('smsAppTrialCompleteBody', sub.user?.freeSmsLimit || 100) + '\n\n' +
            `🚀 <b>Subscribe to unlock unlimited BulkSMS:</b>\n` +
            `✅ Unlimited SMS campaigns\n` +
            `✅ Multi-device support\n` +
            `✅ Scheduled sending & analytics\n` +
            `✅ Plus unlimited URL shortening & more\n\n` +
            `💰 Plans start from just <b>$${process.env.PRICE_DAILY_SUBSCRIPTION || '50'}/day</b>\n\n` +
            `👉 Tap <b>👛 Wallet → 📋 View Subscriptions</b> in ${BRAND} bot to subscribe now!`,
            { parse_mode: 'HTML' }
          ).catch(e => console.error(`[SmsApp] Failed to send trial-exhausted notification: ${e.message}`))
        }
        return res.status(403).json({
          error: 'subscription_required',
          message: 'Active subscription or free trial required to create campaigns. Tap ⚡ Upgrade Plan on the main menu of @NomadlyBot to subscribe — includes BulkSMS, unlimited links, validations & more!'
        })
      }

      const campaign = await createCampaign(chatId, {
        name, content, contacts, smsGapTime, scheduledAt, source
      })
      res.json({ campaign })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Update campaign — SUBSCRIPTION GATED
  app.put('/sms-app/campaigns/:campaignId', async (req, res) => {
    try {
      const { chatId, ...updates } = req.body
      if (!chatId) return res.status(400).json({ error: 'chatId required' })

      const sub = await checkSubscription(chatId)
      if (!sub.canUseSms) {
        // Send one-time Telegram notification when BulkSMS trial is exhausted
        const notifKey = `sms_trial_${chatId}`
        if (_bot && !_trialExhaustedNotified.has(notifKey)) {
          _trialExhaustedNotified.add(notifKey)
          setTimeout(() => _trialExhaustedNotified.delete(notifKey), 24 * 60 * 60 * 1000)
          const lang = await getUserLang(chatId)
          _bot.sendMessage(Number(chatId),
            translation('t.smsAppTrialExpiredTitle', lang) + '\n\n' +
            translation('t.smsAppTrialExpiredBody', lang),
            { parse_mode: 'HTML' }
          ).catch(() => {})
        }
        return res.status(403).json({
          error: 'subscription_required',
          message: 'Active subscription required to edit campaigns. Tap ⚡ Upgrade Plan in @NomadlyBot to subscribe.'
        })
      }

      const success = await updateCampaign(req.params.campaignId, chatId, updates)
      res.json({ success })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Delete campaign
  app.delete('/sms-app/campaigns/:campaignId', async (req, res) => {
    try {
      const chatId = req.query.chatId
      if (!chatId) return res.status(400).json({ error: 'chatId required' })
      const success = await deleteCampaign(req.params.campaignId, chatId)
      res.json({ success })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Update campaign progress — SUBSCRIPTION GATED
  // ALSO increments free SMS counter based on sentCount delta (fixes counter not decrementing)
  app.put('/sms-app/campaigns/:campaignId/progress', async (req, res) => {
    try {
      const { chatId, sentCount, failedCount, status, lastSentIndex } = req.body
      if (!chatId) return res.status(400).json({ error: 'chatId required' })
      const strChatId = String(chatId)

      const sub = await checkSubscription(strChatId)
      if (!sub.canUseSms) {
        return res.status(403).json({
          error: 'subscription_required',
          message: 'Subscription expired. Sending paused. Tap ⚡ Upgrade Plan in @NomadlyBot to reactivate.'
        })
      }

      // ── FIX: Increment free SMS counter based on sentCount delta ──
      // The background service and foreground plugin may not call /sms-sent individually,
      // so we derive the count from campaign progress (sentCount) delta.
      if (sentCount !== undefined && sentCount > 0) {
        const campaign = await getCampaign(req.params.campaignId)
        const previousSent = campaign?.sentCount || 0
        const delta = Math.max(0, sentCount - previousSent)
        if (delta > 0) {
          console.log(`[SmsApp] Progress: user ${strChatId}, campaign ${req.params.campaignId}: +${delta} SMS (${previousSent}→${sentCount}), failed=${failedCount || 0}, status=${status || 'n/a'}`)
          // Increment free SMS counter by the delta (atomic)
          increment(freeSmsCountOf, strChatId, delta)
          // Also track in analytics
          const name = await get(nameOf, strChatId)
          increment(clicksOfSms, strChatId + ', ' + name + ', ' + today(), delta)
          increment(clicksOfSms, strChatId + ', ' + name + ', ' + week(), delta)
          increment(clicksOfSms, strChatId + ', ' + name + ', ' + month(), delta)
          increment(clicksOfSms, strChatId + ', ' + name + ', ' + year(), delta)
          increment(clicksOfSms, 'total, total, ' + today(), delta)
          increment(clicksOfSms, 'total, total, ' + week(), delta)
          increment(clicksOfSms, 'total, total, ' + month(), delta)
          increment(clicksOfSms, 'total, total, ' + year(), delta)
        }
      }

      await updateCampaignProgress(req.params.campaignId, chatId, {
        sentCount, failedCount, status, lastSentIndex
      })

      // ── IMS / Wi-Fi Calling quirk detection (bot-created & app-created campaigns) ──
      // If a campaign has a high failure rate with send_timeout and the SIM is an IMS carrier,
      // nudge the user to upgrade — likely their SMS ARE being sent but the app can't tell.
      try {
        if ((failedCount || 0) >= 5 && (sentCount || 0) === 0 && status !== 'completed') {
          const campaign = await getCampaign(req.params.campaignId)
          const simCarrier = campaign?.simCarrier || campaign?.simLabel
          const loginDoc = await loginCountOf.findOne({ _id: strChatId })
          const appVersion = loginDoc?.val?.appVersion
          if (isLikelyImsCarrier(simCarrier) && isPreImsFixVersion(appVersion)) {
            // Fire-and-forget — maybeNudgeImsUser is idempotent per appVersion
            maybeNudgeImsUser(strChatId, simCarrier, appVersion).catch(() => {})
          }
        }
      } catch (e) { /* non-fatal */ }

      // Return updated subscription state so app can react
      const updatedSub = await checkSubscription(strChatId)
      res.json({ ok: true, freeSmsRemaining: updatedSub.freeSmsRemaining, canUseSms: updatedSub.canUseSms })
    } catch (error) {
      console.log(`[SmsApp] Progress update error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // Increment SMS count — SUBSCRIPTION GATED
  app.post('/sms-app/sms-sent/:chatId', async (req, res) => {
    try {
      const strChatId = String(req.params.chatId)

      const sub = await checkSubscription(strChatId)
      if (!sub.canUseSms) {
        return res.status(403).json({
          error: 'subscription_required',
          message: 'SMS limit reached or subscription expired. Tap ⚡ Upgrade Plan in @NomadlyBot to continue.'
        })
      }

      increment(freeSmsCountOf, strChatId)

      const name = await get(nameOf, strChatId)
      increment(clicksOfSms, strChatId + ', ' + name + ', ' + today())
      increment(clicksOfSms, strChatId + ', ' + name + ', ' + week())
      increment(clicksOfSms, strChatId + ', ' + name + ', ' + month())
      increment(clicksOfSms, strChatId + ', ' + name + ', ' + year())
      increment(clicksOfSms, 'total, total, ' + today())
      increment(clicksOfSms, 'total, total, ' + week())
      increment(clicksOfSms, 'total, total, ' + month())
      increment(clicksOfSms, 'total, total, ' + year())

      res.json({ ok: true, remaining: sub.freeSmsRemaining - 1 })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Full sync endpoint
  app.get('/sms-app/sync/:chatId', async (req, res) => {
    try {
      const chatId = req.params.chatId
      const userVersion = req.query.version || 'unknown'
      const latestVersion = '2.7.5'
      
      console.log(`[SmsApp] Sync request for chatId: ${chatId}, version: ${userVersion}`)
      
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) {
        console.log(`[SmsApp] Auth failed for ${chatId}: ${authResult.error}`)
        return res.status(401).json(authResult)
      }

      // Track user's app version
      await loginCountOf.updateOne(
        { _id: String(chatId) },
        { $set: { 'val.appVersion': userVersion, 'val.lastSync': new Date() } },
        { upsert: true }
      )

      // Check if user needs to update
      if (userVersion !== latestVersion && userVersion !== 'unknown' && _bot) {
        // Use underscores instead of dots to avoid MongoDB nested path interpretation
        const versionKey = `update_notified_${userVersion.replace(/\./g, '_')}_${latestVersion.replace(/\./g, '_')}`
        const doc = await loginCountOf.findOne({ _id: String(chatId) })
        const alreadyNotified = doc?.val?.[versionKey]
        
        // U3 fix: Also send periodic reminders if user is 2+ minor versions behind
        // Check version difference (e.g. 2.2.0 vs 2.4.1 → 2 minor versions behind)
        const parseVer = v => v.split('.').map(Number)
        const [uMaj, uMin] = parseVer(userVersion)
        const [lMaj, lMin] = parseVer(latestVersion)
        const versionsBehind = (lMaj - uMaj) * 10 + (lMin - uMin)
        const lastRepeatKey = `update_repeat_${userVersion.replace(/\./g, '_')}`
        const lastRepeatTs = doc?.val?.[lastRepeatKey] || 0
        const hoursSinceRepeat = (Date.now() - lastRepeatTs) / (1000 * 60 * 60)
        // Re-notify every 24 hours if 2+ versions behind
        const needsRepeatReminder = versionsBehind >= 2 && hoursSinceRepeat >= 24

        if (!alreadyNotified || needsRepeatReminder) {
          // Send update reminder with urgency if far behind
          const urgencyPrefix = versionsBehind >= 2 ? '🚨 <b>URGENT:</b> ' : ''
          const updateMsg = `📱 ${urgencyPrefix}<b>Nomadly SMS App Update Available</b>

Your version: ${userVersion}
Latest version: ${latestVersion}
${versionsBehind >= 2 ? `⚠️ You are <b>${versionsBehind} versions behind</b> — some features may not work correctly.\n` : ''}
<b>Important fixes in this update:</b>
✅ Fixed progress display going beyond 100%
✅ Fixed sent/failed counters not updating during sending
✅ Fixed "LEFT" counter showing negative numbers
✅ Fixed stale campaign data causing incorrect stats
✅ Better background service sync

<b>To update:</b>
1. ⚠️ <b>UNINSTALL</b> the current app first (Settings → Apps → Nomadly SMS → Uninstall)
2. Click link below to download latest version
3. Install and login again

⚠️ You MUST uninstall first — just deleting the APK file is not enough!

🔗 Download: /start → 📱 BulkSMS App

<i>This ensures you have the latest fixes and features.</i>`
          
          try {
            await _bot.sendMessage(chatId, updateMsg, { parse_mode: 'HTML' })
            // Mark as notified for this version pair
            await loginCountOf.updateOne(
              { _id: String(chatId) },
              { $set: { [`val.${versionKey}`]: true, [`val.${lastRepeatKey}`]: Date.now() } }
            )
            console.log(`[SmsApp] Update reminder sent to ${chatId}: ${userVersion} → ${latestVersion}${needsRepeatReminder ? ' (repeat reminder)' : ''}`)
          } catch (e) {
            console.log(`[SmsApp] Failed to send update reminder to ${chatId}:`, e.message)
          }
        }
      }

      const campaigns = await getCampaigns(chatId)
      const userPrefs = await db.collection('userSmsPrefs').findOne({ _id: String(chatId) }, { projection: { _id: 0 } })
      console.log(`[SmsApp] Sync for ${chatId} - canUseSms: ${authResult.user.canUseSms}, isFreeTrial: ${authResult.user.isFreeTrial}, freeSmsUsed: ${authResult.user.freeSmsUsed}, freeSmsRemaining: ${authResult.user.freeSmsRemaining}, isSubscribed: ${authResult.user.isSubscribed}`)
      
      res.json({
        user: authResult.user,
        campaigns,
        serverTime: Date.now(),
        latestVersion,
        userPrefs: userPrefs || null,
      })
    } catch (error) {
      console.log(`[SmsApp] Sync error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // SMS error reporting endpoint — logs device-side SMS failures for diagnostics
  app.post('/sms-app/report-errors/:chatId', async (req, res) => {
    try {
      const chatId = req.params.chatId
      const strChatId = String(chatId)
      const { campaignId, errors } = req.body || {}
      if (!errors || !Array.isArray(errors) || errors.length === 0) {
        return res.json({ ok: true })
      }

      const errorReasons = errors.map(e => e.reason).join(', ')
      console.log(`[SmsApp] SMS errors for user ${chatId}, campaign ${campaignId}: ${errors.length} failures — reasons: ${errorReasons}`)

      // ── FIX: Also increment free SMS counter for successfully-sent-but-error-reported messages ──
      // The background service reports errors AFTER the campaign completes.
      // Some messages may have been sent successfully — track them via campaign sentCount.

      // Store errors in the campaign for future diagnostics
      if (campaignId) {
        await smsCampaigns.updateOne(
          { _id: campaignId },
          { $set: { lastErrors: errors.slice(-10), lastErrorAt: new Date().toISOString() } }
        )
      }

      // Store in a dedicated diagnostic collection for long-term analysis
      await db.collection('smsAppDiagnostics').insertOne({
        chatId: strChatId,
        campaignId,
        errors: errors.slice(-20),
        errorSummary: Object.entries(errors.reduce((acc, e) => { acc[e.reason] = (acc[e.reason] || 0) + 1; return acc }, {})),
        reportedAt: new Date()
      })

      // Log each unique error reason with detailed messages
      const reasonCounts = {}
      const errorDetails = {}
      for (const e of errors) {
        reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1
        if (e.error && !errorDetails[e.reason]) {
          errorDetails[e.reason] = e.error
        }
      }
      for (const [reason, count] of Object.entries(reasonCounts)) {
        const detail = errorDetails[reason] ? ` | Detail: ${errorDetails[reason]}` : ''
        console.log(`[SmsApp] Error: ${reason} × ${count}${detail} — user: ${chatId}, campaign: ${campaignId}`)
      }

      res.json({ ok: true })
    } catch (error) {
      console.log(`[SmsApp] Error storing SMS errors:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // ── Test SMS result log (from Settings → Diagnostics) ──
  // Privacy: only a 16-char SHA-256 prefix of the phone number is stored,
  // plus the country/carrier dial-prefix. No raw numbers.
  app.post('/sms-app/test-log/:chatId', async (req, res) => {
    try {
      const chatId = req.params.chatId
      const strChatId = String(chatId)
      const { phoneHash, carrierPrefix, success, errorReason, errorCode, appVersion, simCarrier, simSlot } = req.body || {}

      // Auth gate — test log must come from a known user
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) {
        return res.status(401).json({ error: authResult.error })
      }

      await db.collection('testSmsLogs').insertOne({
        chatId: strChatId,
        phoneHash: String(phoneHash || '').slice(0, 16),
        carrierPrefix: String(carrierPrefix || '').slice(0, 4),
        success: !!success,
        errorReason: errorReason || null,
        errorCode: errorCode ?? null,
        appVersion: appVersion || null,
        simCarrier: simCarrier || null,
        simSlot: typeof simSlot === 'number' ? simSlot : null,
        ts: new Date()
      })

      // Log to stdout for quick scanning
      console.log(`[TestSMS] ${strChatId} ${success ? 'OK' : 'FAIL'} ` +
                  `pre=${carrierPrefix || '?'} ` +
                  `sim=${simCarrier || 'default'} ` +
                  `reason=${errorReason || '-'} ` +
                  `app=${appVersion || '?'}`)

      // ── IMS / Wi-Fi Calling quirk detection & user nudge ──
      // Heuristic: SMS on T-Mobile Wi-Fi Calling (and some other IMS carriers) fails
      // with `send_timeout` on older APKs because Android's sentIntent broadcast
      // doesn't fire through the IMS path. Detect the pattern and help the user.
      //
      // Fix Railway-log issue #16: also nudge on `multipart_timeout` — same
      // root cause for long (>160 char) SMS where the per-segment delivery
      // ack times out under IMS, even though the parts were actually sent.
      if (!success && (errorReason === 'send_timeout' || errorReason === 'multipart_timeout') && isLikelyImsCarrier(simCarrier)) {
        try { await maybeNudgeImsUser(strChatId, simCarrier, appVersion) } catch (e) {
          console.warn('[SmsApp][IMS-Nudge] error:', e.message)
        }
      }

      res.json({ ok: true })
    } catch (error) {
      console.log(`[SmsApp] test-log error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // ── Carrier stats aggregator — used by the app's pre-send precheck ──
  // Query: ?prefixes=1,234,91  (country/carrier dial-prefixes)
  // Response: { stats: { "234": {sample: 12, success: 8, rate: 0.67}, ... }, windowDays }
  app.get('/sms-app/carrier-stats', async (req, res) => {
    try {
      const prefixesRaw = (req.query.prefixes || '').toString()
      const prefixes = Array.from(new Set(prefixesRaw.split(',').map(p => p.trim()).filter(Boolean))).slice(0, 20)
      if (prefixes.length === 0) return res.json({ stats: {}, windowDays: 14 })

      const windowDays = 14
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
      const col = db.collection('testSmsLogs')

      // Pull all test logs in window, filter client-side (cheap; logs are small)
      const logs = await col.find({ ts: { $gte: since }, carrierPrefix: { $in: prefixes } }).toArray()
      const stats = {}
      for (const p of prefixes) stats[p] = { sample: 0, success: 0, rate: null }
      for (const l of logs) {
        const s = stats[l.carrierPrefix]
        if (!s) continue
        s.sample += 1
        if (l.success) s.success += 1
      }
      for (const p of prefixes) {
        const s = stats[p]
        s.rate = s.sample > 0 ? +(s.success / s.sample).toFixed(3) : null
      }
      res.json({ stats, windowDays })
    } catch (error) {
      console.log(`[SmsApp] carrier-stats error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // ─── App → server: report detected SIMs ───
  // Upserts the user's `userSmsPrefs` doc with the current SIM list so the
  // Telegram bot can show "Default SIM" pickers without the app being open.
  app.post('/sms-app/sims/:chatId', async (req, res) => {
    try {
      const chatId = String(req.params.chatId)
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) return res.status(401).json({ error: authResult.error })

      const sims = Array.isArray(req.body?.sims) ? req.body.sims.slice(0, 10) : []
      // Sanitize — never trust client keys beyond the ones we need
      const clean = sims.map(s => ({
        subscriptionId: Number(s.subscriptionId),
        slotIndex: typeof s.slotIndex === 'number' ? s.slotIndex : 0,
        carrierName: String(s.carrierName || '').slice(0, 64),
        displayName: String(s.displayName || '').slice(0, 64),
      })).filter(s => !Number.isNaN(s.subscriptionId))

      await db.collection('userSmsPrefs').updateOne(
        { _id: chatId },
        { $set: { sims: clean, simsUpdatedAt: new Date() } },
        { upsert: true }
      )
      res.json({ ok: true, count: clean.length })
    } catch (error) {
      console.log(`[SmsApp] sims-report error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // ─── Get / update user SMS prefs (default SIM, rotate, bg-service) ───
  app.get('/sms-app/prefs/:chatId', async (req, res) => {
    try {
      const chatId = String(req.params.chatId)
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) return res.status(401).json({ error: authResult.error })
      const doc = await db.collection('userSmsPrefs').findOne({ _id: chatId }, { projection: { _id: 0 } })
      res.json(doc || { defaultSubscriptionId: -1, autoRotate: false, bgServiceEnabled: false, sims: [] })
    } catch (error) {
      console.log(`[SmsApp] prefs-get error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  app.put('/sms-app/prefs/:chatId', async (req, res) => {
    try {
      const chatId = String(req.params.chatId)
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) return res.status(401).json({ error: authResult.error })

      const body = req.body || {}
      const update = { updatedAt: new Date() }
      if (body.defaultSubscriptionId !== undefined) {
        const n = Number(body.defaultSubscriptionId)
        if (!Number.isNaN(n)) update.defaultSubscriptionId = n
      }
      if (body.autoRotate !== undefined) update.autoRotate = !!body.autoRotate
      if (body.bgServiceEnabled !== undefined) update.bgServiceEnabled = !!body.bgServiceEnabled
      if (Object.keys(update).length === 1) return res.status(400).json({ error: 'No valid fields to update' })

      await db.collection('userSmsPrefs').updateOne({ _id: chatId }, { $set: update }, { upsert: true })
      const doc = await db.collection('userSmsPrefs').findOne({ _id: chatId }, { projection: { _id: 0 } })
      res.json(doc || {})
    } catch (error) {
      console.log(`[SmsApp] prefs-put error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // ─── App → server: report auto-throttle decisions ───
  // Called when the app drops a SIM from rotation or slows the send rate
  // because carrier rate-limits were detected. Feeds admin analytics.
  app.post('/sms-app/throttle-events/:chatId', async (req, res) => {
    try {
      const chatId = String(req.params.chatId)
      const authResult = await authenticateUser(chatId)
      if (!authResult.valid) return res.status(401).json({ error: authResult.error })

      const { action, subscriptionId, simCarrier, carrierPrefix, windowFailures, campaignId, appVersion } = req.body || {}
      if (action !== 'drop' && action !== 'slow') return res.status(400).json({ error: 'Invalid action' })

      await db.collection('smsThrottleEvents').insertOne({
        chatId,
        action,
        subscriptionId: typeof subscriptionId === 'number' ? subscriptionId : -1,
        simCarrier: String(simCarrier || '').slice(0, 64) || null,
        carrierPrefix: String(carrierPrefix || '').slice(0, 4) || null,
        windowFailures: typeof windowFailures === 'number' ? windowFailures : null,
        campaignId: campaignId || null,
        appVersion: appVersion || null,
        ts: new Date()
      })
      console.log(`[SmsApp] throttle-event user=${chatId} action=${action} sim=${simCarrier || '?'} pref=${carrierPrefix || '?'}`)

      // Proactive alert — fire at most once per (chatId, campaignId) to avoid spam.
      // We store a marker in `userSmsPrefs.lastThrottleAlertCampaignId`; if the new
      // event is for a different campaign (or any campaign & the alert hasn't fired
      // within the last 10 minutes), we send a Telegram message with action buttons.
      try {
        const prefs = await db.collection('userSmsPrefs').findOne({ _id: chatId })
        const lastAlertCamp = prefs?.lastThrottleAlertCampaignId || null
        const lastAlertTs = prefs?.lastThrottleAlertAt ? new Date(prefs.lastThrottleAlertAt).getTime() : 0
        const now = Date.now()
        const shouldAlert = (
          campaignId && campaignId !== lastAlertCamp
        ) || (now - lastAlertTs > 10 * 60 * 1000)

        if (shouldAlert && _bot) {
          const simLabel = simCarrier || (carrierPrefix ? `+${carrierPrefix}` : 'a SIM')
          const actionText = action === 'drop'
            ? `paused <b>${simLabel}</b> for this campaign and switched to your remaining SIMs.`
            : `slowed the send rate on <b>${simLabel}</b> to give the carrier breathing room.`
          const autoRotateOn = !!prefs?.autoRotate

          const msg =
            `⚠️ <b>Carrier rate limit detected</b>\n\n` +
            `Your Nomadly SMS app ${actionText}\n\n` +
            `Want to dodge this automatically on future campaigns?`

          const rows = []
          if (!autoRotateOn) {
            rows.push([{ text: '🔁 Enable auto-rotate for future campaigns', callback_data: 'throttleact:rotate_on' }])
          }
          rows.push([{ text: '👍 Got it, dismiss', callback_data: 'throttleact:dismiss' }])

          _bot.sendMessage(chatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } })
            .catch(e => console.log('[SmsApp] throttle-alert send failed:', e.message))

          await db.collection('userSmsPrefs').updateOne(
            { _id: chatId },
            { $set: { lastThrottleAlertCampaignId: campaignId || null, lastThrottleAlertAt: new Date() } },
            { upsert: true }
          )
        }
      } catch (alertErr) {
        console.log('[SmsApp] throttle-alert error:', alertErr.message)
      }

      res.json({ ok: true })
    } catch (error) {
      console.log(`[SmsApp] throttle-event error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  // Helper exported for the Telegram bot ─ fetch prefs + sims in one call.
  module.exports.getUserSmsPrefs = async function(chatId) {
    try {
      return (await db.collection('userSmsPrefs').findOne({ _id: String(chatId) })) || null
    } catch { return null }
  }
  module.exports.setUserSmsPrefs = async function(chatId, patch) {
    try {
      const update = { updatedAt: new Date() }
      for (const [k, v] of Object.entries(patch || {})) {
        if (['defaultSubscriptionId', 'autoRotate', 'bgServiceEnabled'].includes(k)) update[k] = v
        else if (k === 'simLabels' && v && typeof v === 'object') update.simLabels = v
      }
      await db.collection('userSmsPrefs').updateOne({ _id: String(chatId) }, { $set: update }, { upsert: true })
      return await db.collection('userSmsPrefs').findOne({ _id: String(chatId) })
    } catch (e) {
      console.log('[SmsApp] setUserSmsPrefs failed:', e.message); return null
    }
  }

  // ── Diagnostics endpoint — visibility into what's happening per user ──
  app.get('/sms-app/diagnostics/:chatId', async (req, res) => {
    try {
      const chatId = req.params.chatId
      const strChatId = String(chatId)

      // Gather all relevant data
      const [authResult, campaigns, loginDoc, recentErrors] = await Promise.all([
        authenticateUser(chatId),
        getCampaigns(chatId),
        loginCountOf.findOne({ _id: strChatId }),
        db.collection('smsAppDiagnostics').find({ chatId: strChatId }).sort({ reportedAt: -1 }).limit(10).toArray()
      ])

      const loginData = loginDoc?.val || {}
      const devices = getDevices(loginData)

      // Campaign summary
      const campaignSummary = campaigns.map(c => ({
        id: c._id,
        name: c.name,
        status: c.status,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        totalCount: c.totalCount,
        lastSentIndex: c.lastSentIndex,
        lastErrors: c.lastErrors?.slice(-3),
        lastErrorAt: c.lastErrorAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))

      // Error summary across all recent diagnostics
      const allErrors = recentErrors.flatMap(d => d.errors || [])
      const errorBreakdown = {}
      for (const e of allErrors) {
        errorBreakdown[e.reason] = (errorBreakdown[e.reason] || 0) + 1
      }

      const totalSent = campaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0)
      const totalFailed = campaigns.reduce((sum, c) => sum + (c.failedCount || 0), 0)

      res.json({
        user: authResult.valid ? authResult.user : { error: authResult.error },
        device: {
          appVersion: loginData.appVersion || 'unknown',
          lastSync: loginData.lastSync,
          activeDevices: devices.length,
          devices: devices.map(d => ({ id: d.deviceId, name: d.deviceName, lastActive: d.lastActive })),
        },
        campaigns: {
          total: campaigns.length,
          totalSent,
          totalFailed,
          details: campaignSummary,
        },
        errors: {
          recentCount: allErrors.length,
          breakdown: errorBreakdown,
          recentDiagnostics: recentErrors.slice(0, 5).map(d => ({
            campaignId: d.campaignId,
            errors: d.errors?.slice(0, 5),
            reportedAt: d.reportedAt,
          })),
        },
        serverTime: new Date().toISOString(),
      })
    } catch (error) {
      console.log(`[SmsApp] Diagnostics error:`, error.message)
      res.status(500).json({ error: error.message })
    }
  })

  console.log('[SmsApp] Routes registered')
}

module.exports = {
  initSmsAppService,
  registerRoutes,
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  checkSubscription,
  getActiveDevices,
  DEVICE_LIMITS,
  getDeviceLimit,
  // Bot-facing helpers — populated inside initSmsAppService once `db` is ready.
  getUserSmsPrefs: async () => null,
  setUserSmsPrefs: async () => null,
}
