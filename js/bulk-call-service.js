// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bulk Call Campaign Service — Speechcue-based IVR campaigns
// Handles concurrent call queues, per-lead result tracking, and final reporting
// Uses Speechcue's TwiML webhooks for IVR logic (play audio, gather DTMF, transfer)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { log } = require('console')
const { sanitizeProviderError, sanitizeHangupCause } = require('./sanitize-provider')
const { getBalance, smartWalletDeduct, smartWalletCheck } = require('./utils.js')
const { get } = require('./db.js')
const { translation } = require('./translation.js')

// ━━━ Bulk Call Pricing & Limits ━━━
const BULK_CALL_RATE       = parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15')   // $/min — charged whether answered or not
const MAX_BULK_LEADS       = parseInt(process.env.BULK_CALL_MAX_LEADS || '500', 10)      // max leads per campaign
const BULK_CALL_MIN_WALLET = parseFloat(process.env.BULK_CALL_MIN_WALLET || '50')        // minimum wallet balance to launch

let _db = null
let _collection = null
let _bot = null
let _twilioService = null
let _voiceService = null
let _walletOf = null
let _phoneNumbersOf = null

// Active campaigns in memory: campaignId → { queue state }
const activeCampaigns = {}

// Map: callSid → { campaignId, leadIndex }
const callToCampaign = {}

/**
 * Initialize bulk call service
 */
async function initBulkCallService(db, bot, twilioService, walletOf, app) {
  _db = db
  _bot = bot
  _twilioService = twilioService
  _voiceService = require('./voice-service.js')
  _walletOf = walletOf || db.collection('walletOf')
  _phoneNumbersOf = db.collection('phoneNumbersOf')
  _collection = db.collection('bulkCallCampaigns')
  await _collection.createIndex({ chatId: 1 })
  await _collection.createIndex({ id: 1 }, { unique: true })
  await _collection.createIndex({ status: 1 })
  log('[BulkCall] Service initialized (Speechcue mode)')

  // Register Twilio webhook routes ONLY after init is complete — prevents
  // race where status callbacks land before _collection is bound.
  if (app && !_routesRegistered) {
    registerRoutes(app)
    _routesRegistered = true
    log('[BulkCall] Twilio webhook routes registered')
  }

  // ━━━ CAMPAIGN RECOVERY: Resume campaigns that were running before deployment ━━━
  // Delay recovery to let all services fully initialize (Twilio, webhooks, etc.)
  setTimeout(() => recoverRunningCampaigns().catch(e => log(`[BulkCall] Recovery error: ${e.message}`)), 15000)
}

let _routesRegistered = false

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Twilio Webhook Routes — registered AFTER initBulkCallService completes
// so we never serve a request while _collection is still null.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerRoutes(app) {
  const VoiceResponse = require('twilio').twiml.VoiceResponse

  // TwiML for the outbound call — plays the campaign audio + gathers DTMF
  app.post('/twilio/bulk-ivr', async (req, res) => {
    try {
      const { campaignId, leadIndex } = req.query
      const response = new VoiceResponse()

      if (!campaignId) {
        response.say('Configuration error. Goodbye.')
        response.hangup()
        return res.type('text/xml').send(response.toString())
      }

      const campaign = await getCampaign(campaignId)
      if (!campaign || campaign.status === 'cancelled') {
        response.say('This campaign has been cancelled. Goodbye.')
        response.hangup()
        return res.type('text/xml').send(response.toString())
      }

      const selfUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
      const gatherActionUrl = `${selfUrl}/twilio/bulk-ivr-gather?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${leadIndex}`

      // Use audio proxy to serve with correct Content-Type for Twilio
      // Guard: only build proxy URL if campaign has a valid http(s) audioUrl
      const rawAudioUrl = campaign.audioUrl
      const audioUrl = (rawAudioUrl && /^https?:\/\//i.test(rawAudioUrl))
        ? `${selfUrl}/twilio/audio-proxy?url=${encodeURIComponent(rawAudioUrl)}`
        : null

      // Gather DTMF while playing audio (2s pause lets recipient put phone to ear)
      const gather = response.gather({
        action: gatherActionUrl,
        method: 'POST',
        numDigits: 1,
        timeout: 8,
        finishOnKey: '',
      })
      gather.pause({ length: 2 })
      if (audioUrl) {
        gather.play(audioUrl)
      } else {
        log(`[BulkIVR] ⚠️ No valid audioUrl for campaign=${campaignId}, using TTS fallback | raw=${(rawAudioUrl || 'null').substring(0, 80)}`)
        gather.say('Thank you for your time. Press 1 to continue.')
      }

      // No input — try once more
      const gather2 = response.gather({
        action: gatherActionUrl,
        method: 'POST',
        numDigits: 1,
        timeout: 5,
        finishOnKey: '',
      })
      if (audioUrl) {
        gather2.play(audioUrl)
      } else {
        gather2.say('Press 1 to continue or hang up.')
      }

      // Still no input — hang up
      response.say('No input received. Goodbye.')
      response.hangup()

      log(`[BulkIVR] TwiML served for campaign=${campaignId} lead=${leadIndex}`)
      res.type('text/xml').send(response.toString())
    } catch (error) {
      log('[BulkIVR] TwiML error:', error.message)
      const response = new VoiceResponse()
      response.say('An error occurred. Goodbye.')
      response.hangup()
      res.type('text/xml').send(response.toString())
    }
  })

  // TwiML: Gather callback — handle DTMF input
  app.post('/twilio/bulk-ivr-gather', async (req, res) => {
    try {
      const { campaignId, leadIndex } = req.query
      const digits = req.body?.Digits || ''
      const response = new VoiceResponse()

      log(`[BulkIVR] Gather: campaign=${campaignId} lead=${leadIndex} digits=${digits}`)

      const campaign = await getCampaign(campaignId)
      if (!campaign) {
        response.say('Goodbye.')
        response.hangup()
        return res.type('text/xml').send(response.toString())
      }

      // Record the digit pressed
      if (digits) {
        await onDigitReceived(campaignId, parseInt(leadIndex), digits)
      }

      // ── Multi-key menu routing (Phase 2 outbound parity, opt-in) ──
      // Only when campaign.menu is set; otherwise the legacy single-transfer path runs.
      if (campaign.menu) {
        const path = req.query.path || ''
        const atSub = !!path
        const levelOpts = atSub ? ((campaign.menu[path] && campaign.menu[path].options) || {}) : campaign.menu
        const opt = digits ? levelOpts[digits] : null
        if (opt) {
          try {
            const leadNum = (Array.isArray(campaign.leads) && campaign.leads[parseInt(leadIndex)]) ? campaign.leads[parseInt(leadIndex)].number : null
            require('./voice-service.js').recordOutboundMenuPress({ callerId: campaign.callerId, chatId: campaign.chatId, targetNumber: leadNum, digit: atSub ? `${path}.${digits}` : digits, action: opt.action, campaignId })
          } catch (_) { /* non-blocking */ }
        }
        const selfUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
        const gatherBase = `${selfUrl}/twilio/bulk-ivr-gather?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${leadIndex}`
        if (opt && opt.action === 'forward' && opt.forwardTo) {
          response.say('Please hold while we connect you.')
          const transferStatusUrl = `${selfUrl}/twilio/bulk-ivr-transfer-status?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${encodeURIComponent(leadIndex)}&dest=${encodeURIComponent(opt.forwardTo)}`
          const dial = response.dial({ callerId: campaign.callerId, timeout: 30, action: transferStatusUrl, method: 'POST' })
          dial.number(opt.forwardTo)
          log(`[BulkIVR] Menu forward: lead=${leadIndex} key=${atSub ? path + '.' : ''}${digits} → ${opt.forwardTo}`)
          return res.type('text/xml').send(response.toString())
        }
        if (opt && opt.action === 'message') {
          response.say(opt.message || 'Thank you. Goodbye.')
          response.hangup()
          return res.type('text/xml').send(response.toString())
        }
        if (opt && opt.action === 'submenu' && !atSub) {
          const subUrl = `${gatherBase}&path=${encodeURIComponent(digits)}`
          const g = response.gather({ action: subUrl, method: 'POST', numDigits: 1, timeout: 8, finishOnKey: '' })
          g.say(opt.greeting || 'Please select an option.')
          const g2 = response.gather({ action: subUrl, method: 'POST', numDigits: 1, timeout: 6, finishOnKey: '' })
          g2.say(opt.greeting || 'Please select an option.')
          response.say('No input received. Goodbye.')
          response.hangup()
          return res.type('text/xml').send(response.toString())
        }
        response.say('Invalid input. Goodbye.')
        response.hangup()
        return res.type('text/xml').send(response.toString())
      }

      // Check if it's an active key (e.g., "1")
      if (digits && campaign.activeKeys.includes(digits)) {
        if (campaign.mode === 'transfer' && campaign.transferNumber) {
          // Transfer mode — bridge to the transfer number
          response.say('Please hold while we connect you.')
          // BILLING PARITY (2026-08-07): the transfer leg (callerId → transferNumber) is a
          // SECOND concurrent outbound PSTN leg Twilio charges Nomadly for. Bill it exactly
          // like the single Quick IVR transfer (IVR_Transfer, flat rate, idempotent) by adding
          // a status callback — previously this <Dial> had none, so the transfer leg was unbilled.
          const selfUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
          const transferStatusUrl = `${selfUrl}/twilio/bulk-ivr-transfer-status?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${encodeURIComponent(leadIndex)}`
          const dial = response.dial({
            callerId: campaign.callerId,
            timeout: 30,
            action: transferStatusUrl,
            method: 'POST',
          })
          dial.number(campaign.transferNumber)
          log(`[BulkIVR] Transferring lead=${leadIndex} to ${campaign.transferNumber} (transfer-leg billing enabled)`)
        } else {
          // Report only — acknowledge and hang up
          response.say('Thank you. Goodbye.')
          response.hangup()
          log(`[BulkIVR] Report-only: lead=${leadIndex} pressed ${digits}`)
        }
      } else {
        // Invalid key or no key
        response.say('Invalid input. Goodbye.')
        response.hangup()
      }

      res.type('text/xml').send(response.toString())
    } catch (error) {
      log('[BulkIVR] Gather error:', error.message)
      const response = new VoiceResponse()
      response.say('An error occurred. Goodbye.')
      response.hangup()
      res.type('text/xml').send(response.toString())
    }
  })

  // TwiML: transfer-leg status callback — bills the bulk transfer leg (billing parity
  // with single Quick IVR). Flat IVR rate (IVR_Transfer), min 1 min when connected,
  // idempotent via a DISTINCT callRef (twilio_transfer_<DialCallSid>) that never collides
  // with the per-lead BulkIVR charge. 2026-08-07.
  app.post('/twilio/bulk-ivr-transfer-status', async (req, res) => {
    const response = new VoiceResponse()
    try {
      const { campaignId, leadIndex } = req.query
      const dialStatus = req.body?.DialCallStatus || ''
      const dialDuration = parseInt(req.body?.DialCallDuration || '0', 10)
      const dialSid = req.body?.DialCallSid || ''
      const campaign = await getCampaign(campaignId)
      if (campaign && campaign.mode === 'transfer' && campaign.chatId && dialStatus === 'completed' && dialDuration > 0) {
        const minutes = Math.max(1, Math.ceil(dialDuration / 60))
        const callRef = `twilio_transfer_${dialSid || (campaignId + '_' + leadIndex)}`
        const dest = req.query.dest || campaign.transferNumber
        try {
          const voiceService = require('./voice-service.js')
          await voiceService.billCallMinutesUnified(campaign.chatId, campaign.callerId, minutes, dest, 'IVR_Transfer', callRef)
          log(`[BulkIVR] Transfer leg billed: campaign=${campaignId} lead=${leadIndex} → ${dest} ${minutes} min (dialSid=${dialSid})`)
        } catch (e) { log('[BulkIVR] Transfer leg billing error:', e.message) }
      } else {
        log(`[BulkIVR] Transfer leg not billed (status=${dialStatus}, dur=${dialDuration})`)
      }
      response.hangup()
      res.type('text/xml').send(response.toString())
    } catch (error) {
      log('[BulkIVR] transfer-status error:', error.message)
      response.hangup()
      res.type('text/xml').send(response.toString())
    }
  })

  // Twilio Bulk Call Status Callback — tracks call completion
  app.post('/twilio/bulk-status', async (req, res) => {
    try {
      const { campaignId, leadIndex } = req.query
      const { CallSid, CallStatus, CallDuration, SipResponseCode } = req.body || {}
      const duration = parseInt(CallDuration || '0')

      log(`[BulkIVR] Status: campaign=${campaignId} lead=${leadIndex} sid=${CallSid} status=${CallStatus} duration=${duration}s`)

      if (campaignId && leadIndex != null) {
        const hangupCause = CallStatus === 'failed' ? (SipResponseCode || 'call_failed')
          : CallStatus === 'canceled' ? 'cancelled'
          : null

        await onCallStatusUpdate(
          CallSid,
          campaignId,
          parseInt(leadIndex),
          CallStatus,
          duration,
          hangupCause
        )
      }

      res.sendStatus(200)
    } catch (error) {
      log('[BulkIVR] Status error:', error.message)
      res.sendStatus(200)
    }
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Campaign Recovery — Resumes campaigns after redeployment
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STALE_CAMPAIGN_HOURS = 24  // Campaigns with no progress for 24h are considered zombie/stale

async function recoverRunningCampaigns() {
  if (!_collection) return
  const runningCampaigns = await _collection.find({ status: 'running' }).toArray()
  if (runningCampaigns.length === 0) {
    log('[BulkCall] Recovery: No running campaigns to recover')
    return
  }

  log(`[BulkCall] Recovery: Found ${runningCampaigns.length} running campaign(s) — analyzing...`)

  let recovered = 0
  let stale = 0
  let blocked = 0

  for (const campaign of runningCampaigns) {
    const campaignId = campaign.id
    const leads = campaign.leads || []
    const pendingLeads = leads.filter(l => ['pending', 'calling', 'ringing'].includes(l.status))

    // ── 1. No pending leads → mark as completed ──
    if (pendingLeads.length === 0) {
      await _collection.updateOne({ id: campaignId }, { $set: { status: 'completed', completedAt: new Date() } })
      log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — no pending leads, marked completed`)
      // Send final report since it was never sent
      await sendFinalReport(campaignId).catch(() => {})
      continue
    }

    // ── 2. Security: Block campaigns without sub-account (prevents main Twilio account abuse) ──
    if (!campaign.twilioSubAccountSid) {
      await _collection.updateOne({ id: campaignId }, {
        $set: { status: 'cancelled', completedAt: new Date(), cancelledReason: 'Recovery blocked: no Twilio sub-account' }
      })
      blocked++
      log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — BLOCKED (no sub-account)`)
      _bot?.sendMessage(campaign.chatId,
        `🚫 <b>Campaign Cancelled After Restart</b>\n\n` +
        `Your Bulk IVR campaign could not be resumed because it requires a Twilio-powered number.\n` +
        `${pendingLeads.length} leads were not dialed.`,
        { parse_mode: 'HTML' }
      ).catch(() => {})
      continue
    }

    // ── 3. Stale check: >24h with no recent lead activity → zombie campaign ──
    const lastActivity = getLastLeadActivity(campaign)
    const hoursSinceActivity = lastActivity ? (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60) : Infinity
    const hoursSinceStart = campaign.startedAt ? (Date.now() - new Date(campaign.startedAt).getTime()) / (1000 * 60 * 60) : Infinity

    if (hoursSinceActivity > STALE_CAMPAIGN_HOURS && hoursSinceStart > STALE_CAMPAIGN_HOURS) {
      await _collection.updateOne({ id: campaignId }, {
        $set: { status: 'cancelled', completedAt: new Date(), cancelledReason: `Recovery cleanup: stale campaign (${Math.round(hoursSinceActivity)}h since last activity)` }
      })
      stale++
      log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — STALE (${Math.round(hoursSinceActivity)}h idle), cancelled`)
      _bot?.sendMessage(campaign.chatId,
        `⚠️ <b>Campaign Auto-Cancelled</b>\n\n` +
        `Your Bulk IVR campaign was cancelled after a server restart because it had been idle for over ${STALE_CAMPAIGN_HOURS} hours.\n` +
        `${pendingLeads.length} remaining leads were not dialed.\n\n` +
        `You can start a new campaign if needed.`,
        { parse_mode: 'HTML' }
      ).catch(() => {})
      continue
    }

    // ── 4. Credit check: Ensure user still has wallet balance ──
    let canResume = true
    if (_walletOf) {
      try {
        const walletCheck = await smartWalletCheck(_walletOf, campaign.chatId, BULK_CALL_RATE)
        if (!walletCheck.sufficient) {
          // Reset in-flight leads before pausing (those calls are dead after restart)
          await resetInflightLeads(campaignId, leads)
          await _collection.updateOne({ id: campaignId }, { $set: { status: 'paused' } })
          log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — paused (insufficient funds)`)
          _bot?.sendMessage(campaign.chatId,
            `⏸️ <b>Campaign Paused After Restart</b>\n\n` +
            `Your Bulk IVR campaign has ${pendingLeads.length} leads remaining but your wallet is too low.\n` +
            `Wallet: <b>$${walletCheck.usdBal.toFixed(2)}</b> (need $${BULK_CALL_RATE.toFixed(2)}/min)\n\n` +
            `Top up via 👛 Wallet to resume.`,
            { parse_mode: 'HTML' }
          ).catch(() => {})
          canResume = false
        }
      } catch (e) {
        log(`[BulkCall] Recovery: Credit check error for ${campaignId}: ${e.message}`)
      }
    }

    if (!canResume) continue

    // ── 5. RESUME: Reset in-flight leads and re-populate in-memory state ──
    // Reset leads that were mid-call (calling/ringing) when deployment happened → pending
    await resetInflightLeads(campaignId, leads)

    // Re-populate in-memory state
    activeCampaigns[campaignId] = {
      activeCalls: 0,
      nextLeadIndex: 0,
      paused: false,
    }

    recovered++
    const completedCount = leads.filter(l => !['pending', 'calling', 'ringing'].includes(l.status)).length
    log(`[BulkCall] Recovery: Resuming campaign ${campaignId} (user ${campaign.chatId}) — ${pendingLeads.length} pending, ${completedCount} completed`)

    _bot?.sendMessage(campaign.chatId,
      `🔄 <b>Campaign Resuming</b>\n\n` +
      `Your Bulk IVR campaign is being resumed after a server restart.\n` +
      `📞 Remaining: <b>${pendingLeads.length}</b> leads\n` +
      `✅ Already completed: <b>${completedCount}</b>\n\n` +
      `Dialing will resume shortly...`,
      { parse_mode: 'HTML' }
    ).catch(() => {})

    // Stagger campaign starts to avoid thundering herd (3s between each)
    await new Promise(r => setTimeout(r, 3000))
    await fireNextBatch(campaignId).catch(e => {
      log(`[BulkCall] Recovery: Failed to fire batch for ${campaignId}: ${e.message}`)
    })
  }

  log(`[BulkCall] Recovery complete: ${recovered} resumed, ${stale} stale cancelled, ${blocked} blocked (no sub-account)`)
}

/**
 * Get the most recent lead activity timestamp for a campaign
 */
function getLastLeadActivity(campaign) {
  let latest = null
  for (const lead of (campaign.leads || [])) {
    const ts = lead.completedAt || lead.answeredAt || lead.startedAt
    if (ts) {
      const d = new Date(ts)
      if (!latest || d > latest) latest = d
    }
  }
  return latest
}

/**
 * Reset in-flight leads (calling/ringing) to pending after restart
 * These calls are dead — the old process that initiated them is gone
 */
async function resetInflightLeads(campaignId, leads) {
  const resetOps = {}
  let count = 0
  for (let i = 0; i < leads.length; i++) {
    if (leads[i].status === 'calling' || leads[i].status === 'ringing') {
      resetOps[`leads.${i}.status`] = 'pending'
      resetOps[`leads.${i}.callSid`] = null
      resetOps[`leads.${i}.startedAt`] = null
      count++
    }
  }
  if (count > 0) {
    await _collection.updateOne({ id: campaignId }, { $set: resetOps })
    log(`[BulkCall] Recovery: Reset ${count} in-flight leads to pending for campaign ${campaignId}`)
  }
  return count
}

/**
 * Parse a leads file (CSV or TXT)
 * Supports: one number per line, or CSV with number,name columns
 * @param {string} content - File content
 * @returns {{ leads: Array<{number, name}>, errors: string[] }}
 */
function parseLeadsFile(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const leads = []
  const errors = []
  const seen = new Set()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let number = ''
    let name = null

    // Try CSV (comma or semicolon separated)
    if (line.includes(',') || line.includes(';')) {
      const parts = line.split(/[,;]/).map(p => p.trim())
      number = parts[0]
      name = parts[1] || null
    } else {
      number = line
    }

    // Clean the number
    number = number.replace(/["'\s]/g, '')
    // NANP fix (2026-02 @blacknmilds): a bare 10-digit US/Canada number pasted
    // without "+" was becoming "+4065067340" — which E.164 parses as Romania
    // (+40), not US (+1). Every call then failed with Twilio "Account not
    // authorized to call…" geo-permissions. Prepend +1 for 10-digit input.
    number = number.replace(/[^\d+]/g, '')
    if (!number.startsWith('+')) {
      if (/^\d{10}$/.test(number)) number = '+1' + number           // NANP 10-digit
      else if (/^1\d{10}$/.test(number)) number = '+' + number      // NANP 1-prefixed
      else number = '+' + number.replace(/^0+/, '')
    }
    number = number.replace(/[^+\d]/g, '')

    if (!number.match(/^\+\d{8,15}$/)) {
      errors.push(`Line ${i + 1}: Invalid number "${lines[i].substring(0, 30)}"`)
      continue
    }

    if (seen.has(number)) continue // skip duplicates
    seen.add(number)
    leads.push({ number, name: name ? name.trim() : null })
  }

  return { leads, errors }
}

/**
 * Create a new campaign
 */
async function createCampaign(params) {
  const { chatId, callerId, audioUrl, audioName, mode, transferNumber, menu, activeKeys, concurrency, holdMusic, leads, twilioSubAccountSid, twilioSubAccountToken, scheduledFor } = params

  // ━━━ Enforce max lead limit ━━━
  if (leads.length > MAX_BULK_LEADS) {
    return { error: `Maximum ${MAX_BULK_LEADS} leads per campaign. You uploaded ${leads.length}.` }
  }

  // Scheduled launch (Phase 2b): a valid future timestamp means the campaign waits
  // for the scheduler to launch it, instead of running immediately.
  let schedAt = null
  if (scheduledFor) {
    const d = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor)
    if (!isNaN(d.getTime())) schedAt = d
  }

  const campaign = {
    id: crypto.randomUUID(),
    chatId: String(chatId),
    callerId,
    audioUrl,
    audioName: audioName || 'Custom Audio',
    mode: mode || 'report_only', // 'transfer' or 'report_only'
    transferNumber: transferNumber || null,
    menu: menu || null,
    activeKeys: activeKeys || ['1'],
    concurrency: Math.min(concurrency || 10, 20),
    holdMusic: holdMusic || false,
    twilioSubAccountSid: twilioSubAccountSid || null,
    twilioSubAccountToken: twilioSubAccountToken || null,
    leads: leads.map((l, i) => ({
      index: i,
      number: l.number,
      name: l.name,
      status: 'pending', // pending|calling|ringing|answered|completed|no_answer|busy|failed
      digitPressed: null,
      transferred: false,
      transferConnected: false,
      duration: 0,
      callSid: null,
      startedAt: null,
      answeredAt: null,
      completedAt: null,
      hangupCause: null,
    })),
    status: 'created', // created|scheduled|running|paused|completed|cancelled
    stats: {
      total: leads.length,
      completed: 0,
      answered: 0,
      keyPressed: 0,
      transferred: 0,
      noAnswer: 0,
      busy: 0,
      failed: 0,
      hungUp: 0,
    },
    scheduledFor: schedAt,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
  }

  if (schedAt) campaign.status = 'scheduled'

  await _collection.insertOne(campaign)
  log(`[BulkCall] Campaign created: ${campaign.id} (${leads.length} leads, mode: ${mode}, concurrency: ${campaign.concurrency}${schedAt ? `, scheduledFor: ${schedAt.toISOString()}` : ''})`)
  return campaign
}

/**
 * Launch any scheduled campaigns whose time has arrived (Phase 2b).
 * Uses an atomic claim (updateOne guarded on status:'scheduled') so that even if two
 * instances run this concurrently, each due campaign is launched exactly once.
 * Returns [{ id, chatId, leadCount, error? }] for the caller to notify owners.
 */
async function launchDueScheduledCampaigns() {
  const launched = []
  if (!_collection) return launched
  const now = new Date()
  const due = await _collection.find({ status: 'scheduled', scheduledFor: { $lte: now } }).limit(20).toArray()
  for (const c of due) {
    // Atomic claim — only the winner flips 'scheduled' -> 'created' and proceeds.
    const claim = await _collection.updateOne({ id: c.id, status: 'scheduled' }, { $set: { status: 'created', claimedAt: new Date() } })
    if (!claim || claim.modifiedCount !== 1) continue
    const leadCount = (c.stats && c.stats.total) || (Array.isArray(c.leads) ? c.leads.length : 0)
    try {
      const r = await startCampaign(c.id)
      launched.push({ id: c.id, chatId: c.chatId, leadCount, error: r && r.error ? r.error : null })
      log(`[BulkSchedule] Launched scheduled campaign ${c.id}${r && r.error ? ` (error: ${r.error})` : ''}`)
    } catch (e) {
      launched.push({ id: c.id, chatId: c.chatId, leadCount, error: e.message })
      log(`[BulkSchedule] Launch exception ${c.id}: ${e.message}`)
    }
  }
  return launched
}

/**
 * Start a campaign — begin dialing leads via Twilio
 */
async function startCampaign(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return { error: 'Campaign not found' }
  if (campaign.status === 'running') return { error: 'Campaign already running' }

  // ━━━ SECURITY: Reject campaigns without a Twilio sub-account — prevents unauthorized use of main Twilio account ━━━
  if (!campaign.twilioSubAccountSid) {
    log(`[BulkCall] BLOCKED campaign ${campaignId}: no twilioSubAccountSid — would use main Twilio account`)
    await _collection.updateOne({ id: campaignId }, { $set: { status: 'cancelled', cancelledReason: 'No Twilio sub-account — bulk IVR requires an owned Twilio number' } })
    _bot?.sendMessage(campaign.chatId,
      `🚫 <b>Campaign Blocked</b>\n\nBulk IVR campaigns require a Twilio-powered Cloud IVR number.\nYour current number does not support Bulk IVR.\n\nPurchase a ☎️ Bulk IVR capable number to use this feature.`,
      { parse_mode: 'HTML' }
    ).catch(() => {})
    return { error: 'Bulk IVR requires a Twilio-powered number with a sub-account. Campaign blocked.' }
  }

  // ━━━ PRE-CAMPAIGN CREDIT CHECK: Bulk calls charge $BULK_CALL_RATE/min from wallet (plan minutes NOT used) ━━━
  try {
    if (_walletOf) {
      const walletCheck = await smartWalletCheck(_walletOf, campaign.chatId, BULK_CALL_RATE)
      const { usdBal } = walletCheck

      // Determine if this is the user's first-ever campaign
      const pastCampaignCount = await _collection.countDocuments({
        chatId: campaign.chatId,
        status: { $in: ['completed', 'running', 'paused'] },
        _id: { $ne: campaign._id },
      })
      const isFirstCampaign = pastCampaignCount === 0

      // Balance is effectively zero — not enough for even a single call
      const isNearZero = !walletCheck.sufficient  // can't cover $BULK_CALL_RATE

      // ── Minimum wallet balance: enforced for first-time users OR zero-balance users ──
      if (isFirstCampaign || isNearZero) {
        const fullCheck = await smartWalletCheck(_walletOf, campaign.chatId, BULK_CALL_MIN_WALLET)
        if (!fullCheck.sufficient) {
          const reason = isFirstCampaign
            ? `First-time Bulk IVR campaigns require a minimum wallet balance of <b>$${BULK_CALL_MIN_WALLET.toFixed(2)}</b>.`
            : `Your wallet balance is too low to start a campaign. Please top up at least <b>$${BULK_CALL_MIN_WALLET.toFixed(2)}</b>.`
          _bot?.sendMessage(campaign.chatId,
            `🚫 <b>Campaign Blocked — Minimum Balance Not Met</b>\n\n` +
            `${reason}\n` +
            `Your wallet: <b>$${usdBal.toFixed(2)}</b>\n\n` +
            `Top up via 👛 Wallet, then retry.`,
            { parse_mode: 'HTML' }
          ).catch(() => {})
          return { error: `Minimum wallet balance of $${BULK_CALL_MIN_WALLET.toFixed(2)} required. USD: $${usdBal.toFixed(2)}, NGN: ₦${0}.` }
        }
      }

      // ── Pre-campaign estimate for all users ──
      const minRequired = BULK_CALL_RATE * campaign.leads.length
      const estLeadsCovered = Math.floor(Math.max(usdBal, 0) / BULK_CALL_RATE)
      const costCheck = await smartWalletCheck(_walletOf, campaign.chatId, minRequired)
      if (!costCheck.sufficient) {
        _bot?.sendMessage(campaign.chatId,
          `⚠️ <b>Low Balance Warning</b>\n\n` +
          `Wallet: <b>$${usdBal.toFixed(2)}</b> (~${estLeadsCovered}+ calls at $${BULK_CALL_RATE.toFixed(2)}/min).\n` +
          `Campaign has <b>${campaign.leads.length}</b> leads — estimated cost: <b>$${minRequired.toFixed(2)}</b>.\n` +
          `Campaign will pause automatically if balance runs out.\n` +
          `Consider topping up for uninterrupted dialing.`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
      } else {
        // Sufficient balance — show campaign estimate
        _bot?.sendMessage(campaign.chatId,
          `📊 <b>Campaign Starting</b>\n\n` +
          `📞 <b>${campaign.leads.length}</b> leads — estimated cost: <b>$${minRequired.toFixed(2)}</b>\n` +
          `Wallet: <b>$${usdBal.toFixed(2)}</b> (~${estLeadsCovered}+ calls covered)\n` +
          `Rate: $${BULK_CALL_RATE.toFixed(2)}/min per call`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
      }
    }
  } catch (e) {
    log(`[BulkCall] Pre-campaign credit check error: ${e.message}`)
  }

  // ── Resolve sub-account token if SID is present but token is missing ──
  if (campaign.twilioSubAccountSid && !campaign.twilioSubAccountToken && _twilioService?.getSubAccount) {
    try {
      const subAccount = await _twilioService.getSubAccount(campaign.twilioSubAccountSid)
      if (subAccount && subAccount.authToken) {
        campaign.twilioSubAccountToken = subAccount.authToken
        await _collection.updateOne({ id: campaignId }, { $set: { twilioSubAccountToken: subAccount.authToken } })
        log(`[BulkCall] Resolved sub-account token for ${campaign.twilioSubAccountSid}`)
      } else {
        log(`[BulkCall] WARNING: Could not resolve sub-account token for ${campaign.twilioSubAccountSid}`)
      }
    } catch (e) {
      log(`[BulkCall] Failed to resolve sub-account token: ${e.message}`)
    }
  }

  await _collection.updateOne({ id: campaignId }, { $set: { status: 'running', startedAt: new Date() } })
  campaign.status = 'running'
  campaign.startedAt = new Date()

  // Initialize in-memory state
  activeCampaigns[campaignId] = {
    activeCalls: 0,
    nextLeadIndex: 0,
    paused: false,
  }

  log(`[BulkCall] Starting campaign ${campaignId}: ${campaign.leads.length} leads, concurrency ${campaign.concurrency}`)

  // Notify user
  _bot?.sendMessage(campaign.chatId,
    `🚀 <b>Campaign Started!</b>\n\n` +
    `📞 Leads: <b>${campaign.leads.length}</b>\n` +
    `🎵 Audio: <b>${campaign.audioName}</b>\n` +
    `📱 Caller ID: <b>${campaign.callerId}</b>\n` +
    `📞 Provider: <b>Speechcue</b>\n` +
    `⚡ Concurrency: <b>${campaign.concurrency}</b>\n` +
    `📊 Mode: <b>${campaign.mode === 'transfer' ? '🔗 Transfer + Report' : '📊 Report Only'}</b>\n` +
    `Dialing now... You'll receive updates as calls complete.`,
    { parse_mode: 'HTML' }
  ).catch(() => {})

  // Fire initial batch
  await fireNextBatch(campaignId)
  return { success: true }
}

/**
 * Fire the next batch of calls up to concurrency limit via Twilio
 */
async function fireNextBatch(campaignId) {
  const state = activeCampaigns[campaignId]
  if (!state || state.paused) return

  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign || campaign.status !== 'running') return

  const available = campaign.concurrency - state.activeCalls
  if (available <= 0) return

  const SELF_URL = process.env.SELF_URL_PROD || process.env.SELF_URL || ''

  // Find pending leads
  const pendingLeads = campaign.leads.filter(l => l.status === 'pending')
  const toFire = pendingLeads.slice(0, available)

  // ━━━ PER-BATCH CREDIT CHECK: Pause campaign if wallet exhausted (bulk calls use wallet only) ━━━
  if (toFire.length > 0 && _walletOf) {
    try {
      const walletCheck = await smartWalletCheck(_walletOf, campaign.chatId, BULK_CALL_RATE)
      if (!walletCheck.sufficient) {
        // No credits — pause campaign
        log(`[BulkCall] Pausing campaign ${campaignId}: insufficient funds`)
        state.paused = true
        await _collection.updateOne({ id: campaignId }, { $set: { status: 'paused' } })
        _bot?.sendMessage(campaign.chatId,
          `⏸️ <b>Campaign Paused — Wallet Depleted</b>\n\n` +
          `📞 ${campaign.stats.completed}/${campaign.stats.total} calls completed so far.\n` +
          `Wallet: <b>$${walletCheck.usdBal.toFixed(2)}</b> (need $${BULK_CALL_RATE.toFixed(2)}/min per call).\n\n` +
          `Top up via 👛 Wallet, then resume the campaign.`,
          { parse_mode: 'HTML' }
        ).catch(() => {})
        return
      }
    } catch (e) { log(`[BulkCall] Per-batch credit check error: ${e.message}`) }
  }

  for (const lead of toFire) {
    state.activeCalls++

    try {
      // Build TwiML URL with campaign context
      const twimlUrl = `${SELF_URL}/twilio/bulk-ivr?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${lead.index}`
      const statusUrl = `${SELF_URL}/twilio/bulk-status?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${lead.index}`

      const result = await _twilioService.makeOutboundCall(
        campaign.callerId,
        lead.number,
        twimlUrl,
        campaign.twilioSubAccountSid || null,
        campaign.twilioSubAccountToken || null,
        {
          statusCallback: statusUrl,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          timeout: 30, // ring for 30s
        }
      )

      if (result.error) {
        state.activeCalls--
        await updateLeadResult(campaignId, lead.index, {
          status: 'failed',
          hangupCause: result.error,
          completedAt: new Date(),
        })
        log(`[BulkCall] Speechcue call failed for ${lead.number}: ${result.error}`)
        // Recalc and check completion after failure
        await recalcStats(campaignId)
        await sendProgressUpdate(campaignId, lead.index, {
          status: 'failed', hangupCause: result.error, duration: 0,
        })
        await checkCampaignCompletion(campaignId)
      } else {
        // Map callSid to campaign
        callToCampaign[result.callSid] = { campaignId, leadIndex: lead.index }
        await updateLeadResult(campaignId, lead.index, {
          status: 'calling',
          callSid: result.callSid,
          startedAt: new Date(),
        })
        log(`[BulkCall] Speechcue call initiated: ${result.callSid} → ${lead.number}`)
      }
    } catch (e) {
      state.activeCalls--
      await updateLeadResult(campaignId, lead.index, {
        status: 'failed',
        hangupCause: e.message,
        completedAt: new Date(),
      })
      log(`[BulkCall] Speechcue call error for ${lead.number}: ${e.message}`)
      await recalcStats(campaignId)
      await checkCampaignCompletion(campaignId)
    }
  }

  // Check if all done (in case all calls failed immediately)
  if (toFire.length === 0) {
    await checkCampaignCompletion(campaignId)
  }
}

/**
 * Update a lead's result in the campaign
 */
async function updateLeadResult(campaignId, leadIndex, updates) {
  const setFields = {}
  for (const [key, val] of Object.entries(updates)) {
    setFields[`leads.${leadIndex}.${key}`] = val
  }
  await _collection.updateOne({ id: campaignId }, { $set: setFields })
}

/**
 * Called when a DTMF digit is received (from TwiML gather callback)
 */
async function onDigitReceived(campaignId, leadIndex, digit) {
  await updateLeadResult(campaignId, leadIndex, {
    digitPressed: digit,
  })
  log(`[BulkCall] Digit received: campaign=${campaignId} lead=${leadIndex} digit=${digit}`)
}

/**
 * Called when a call status update is received from Twilio
 * This handles ringing, answered, and completed statuses
 */
async function onCallStatusUpdate(callSid, campaignId, leadIndex, status, duration, hangupCause) {
  if (!_collection) {
    log(`[BulkCall] onCallStatusUpdate: service not yet initialized — ignoring callSid=${callSid} status=${status}`)
    return
  }
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return

  const lead = campaign.leads[leadIndex]
  if (!lead) return

  if (status === 'ringing' && lead.status === 'calling') {
    await updateLeadResult(campaignId, leadIndex, { status: 'ringing' })
    return
  }

  if (status === 'in-progress' && lead.status !== 'answered') {
    await updateLeadResult(campaignId, leadIndex, {
      status: 'answered',
      answeredAt: new Date(),
    })
    return
  }

  // Terminal statuses
  if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(status)) {
    const state = activeCampaigns[campaignId]
    if (state) state.activeCalls = Math.max(0, state.activeCalls - 1)

    // Clean up callSid mapping
    if (callSid) delete callToCampaign[callSid]

    // Refresh lead data to get digitPressed
    const freshCampaign = await _collection.findOne({ id: campaignId })
    const freshLead = freshCampaign?.leads[leadIndex]
    const digitPressed = freshLead?.digitPressed || null

    // Map Twilio status to our status
    let finalStatus = 'completed'
    if (status === 'no-answer') finalStatus = 'no_answer'
    else if (status === 'busy') finalStatus = 'busy'
    else if (status === 'failed' || status === 'canceled') finalStatus = 'failed'

    // Determine if transferred (transfer mode + digit pressed)
    const transferred = freshCampaign.mode === 'transfer' && digitPressed && freshCampaign.activeKeys.includes(digitPressed)

    await updateLeadResult(campaignId, leadIndex, {
      status: finalStatus,
      duration: duration || 0,
      hangupCause: hangupCause || null,
      completedAt: new Date(),
      transferred,
      transferConnected: transferred, // Speechcue Dial handles this — if completed it connected
    })

    // ━━━ BILLING: Charge $BULK_CALL_RATE/min from wallet — only for calls that connected ━━━
    // A call with finalStatus 'failed' AND 0s duration never reached the carrier
    // (e.g. provider auth/system rejection like Twilio "Authenticate", or an
    // invalid number) — no carrier cost was incurred, so billing it overcharges
    // the user. Fix 2026-06-10 after the Twilio sub-account auth outage billed
    // ~196 never-connected calls. Answered / no-answer / busy keep prior behavior.
    const _neverConnected = finalStatus === 'failed' && (duration || 0) === 0
    if (_neverConnected) {
      log(`[BulkCall] Skipped billing — call never connected (status=failed, 0s) campaign=${campaignId} lead=${leadIndex}`)
    }
    if (!_neverConnected && _walletOf && freshCampaign.chatId) {
      try {
        const minutesBilled = Math.max(1, Math.ceil((duration || 0) / 60))  // minimum 1 minute always
        const charge = +(minutesBilled * BULK_CALL_RATE).toFixed(4)

        // Direct wallet deduction (bulk calls do NOT use plan minutes) — tries USD first, then NGN.
        // Pass metadata so walletLedger gets full attribution per call (was an
        // anonymous "wallet_deduction" before — fixed 2026-05-05 after the
        // @johngambino billing audit found 2,937 ledger entries with no
        // callType / destination / phoneNumber, making post-hoc disputes
        // unauditable). The corresponding phoneLogs row already has the
        // detail; this just brings the ledger to parity.
        const deductResult = await smartWalletDeduct(_walletOf, freshCampaign.chatId, charge, {
          type: 'outbound_call',
          callType: 'BulkIVR',
          destination: freshLead?.number || null,
          phoneNumber: freshLead?.number || null,
          description: `BulkIVR ${freshCampaign.callerId} → ${freshLead?.number || 'unknown'} (${minutesBilled} min × $${BULK_CALL_RATE}, status=${finalStatus})`,
        })
        if (deductResult.success) {
          const chargedStr = deductResult.currency === 'ngn' ? `₦${deductResult.chargedNgn}` : `$${charge.toFixed(2)}`
          // Log the payment
          if (_db) {
            const phoneLogs = _db.collection('phoneLogs')
            await phoneLogs.insertOne({
              chatId: freshCampaign.chatId,
              type: 'BulkIVR',
              direction: 'outbound',
              from: freshCampaign.callerId,
              to: freshLead?.number || 'unknown',
              duration: duration || 0,
              minutesBilled,
              charge,
              chargedCurrency: deductResult.currency,
              chargedNgn: deductResult.chargedNgn || null,
              rate: BULK_CALL_RATE,
              callStatus: finalStatus,
              campaignId,
              leadIndex,
              createdAt: new Date(),
            })
          }
          log(`[BulkCall] Billed ${chargedStr} (${minutesBilled} min × $${BULK_CALL_RATE}/min) for campaign=${campaignId} lead=${leadIndex} status=${finalStatus}`)
        } else {
          log(`[BulkCall] Billing failed (insufficient funds) for campaign=${campaignId} lead=${leadIndex}`)
        }

        // ━━━ POST-BILLING: Check if wallet is now exhausted → pause campaign ━━━
        try {
          const postCheck = await smartWalletCheck(_walletOf, freshCampaign.chatId, BULK_CALL_RATE)
          if (!postCheck.sufficient) {
            const campState = activeCampaigns[campaignId]
            if (campState && !campState.paused) {
              log(`[BulkCall] Wallet exhausted after billing — pausing campaign ${campaignId}`)
              campState.paused = true
              await _collection.updateOne({ id: campaignId }, { $set: { status: 'paused' } })
              _bot?.sendMessage(freshCampaign.chatId,
                `⏸️ <b>Campaign Auto-Paused — Wallet Depleted</b>\n\n` +
                `Wallet: <b>$${postCheck.usdBal.toFixed(2)}</b> (need $${BULK_CALL_RATE.toFixed(2)}/min per call).\n` +
                `${freshCampaign.stats?.completed || 0}/${freshCampaign.stats?.total || 0} calls completed.\n\n` +
                `Top up via 👛 Wallet to resume.`,
                { parse_mode: 'HTML' }
              ).catch(() => {})
            }
          }
        } catch (e) { log(`[BulkCall] Post-billing wallet check error: ${e.message}`) }
      } catch (billErr) {
        log(`[BulkCall] Billing error for campaign=${campaignId} lead=${leadIndex}: ${billErr.message}`)
      }
    }

    await recalcStats(campaignId)
    await sendProgressUpdate(campaignId, leadIndex, {
      status: finalStatus,
      digitPressed,
      duration: duration || 0,
      hangupCause,
      transferred,
      transferConnected: transferred,
    })

    // Fire next batch
    await fireNextBatch(campaignId)
    await checkCampaignCompletion(campaignId)
  }
}

/**
 * Recalculate campaign stats from lead results
 */
async function recalcStats(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return

  const stats = {
    total: campaign.leads.length,
    completed: 0,
    answered: 0,
    keyPressed: 0,
    transferred: 0,
    noAnswer: 0,
    busy: 0,
    failed: 0,
    hungUp: 0,
  }

  for (const lead of campaign.leads) {
    if (lead.status === 'pending' || lead.status === 'calling' || lead.status === 'ringing') continue
    stats.completed++
    if (lead.status === 'no_answer') stats.noAnswer++
    else if (lead.status === 'busy') stats.busy++
    else if (lead.status === 'failed') stats.failed++
    else {
      // answered/completed/transferred
      if (lead.duration > 0 || lead.status === 'answered' || lead.digitPressed) stats.answered++
      if (lead.digitPressed) stats.keyPressed++
      if (lead.transferred) stats.transferred++
      if (!lead.digitPressed && lead.duration > 0 && lead.duration < 3) stats.hungUp++
      else if (!lead.digitPressed && lead.duration > 0) stats.hungUp++
    }
  }

  await _collection.updateOne({ id: campaignId }, { $set: { stats } })
}

/**
 * Send a progress update to the bot user
 */
async function sendProgressUpdate(campaignId, leadIndex, result) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return

  const lead = campaign.leads[leadIndex]
  const { stats } = campaign
  const displayNumber = lead?.number || '?'
  const displayName = lead?.name ? ` (${lead.name})` : ''

  // Per-call notification
  let icon = '📵'
  let statusText = 'Unknown'
  if (result.status === 'no_answer') { icon = '📵'; statusText = 'No answer' }
  else if (result.status === 'busy') { icon = '📵'; statusText = 'Busy' }
  else if (result.status === 'failed') { icon = '❌'; statusText = `Failed: ${sanitizeHangupCause(result.hangupCause)}` }
  else if (result.digitPressed) {
    icon = '🔘'
    statusText = `Pressed ${result.digitPressed}`
    if (result.transferred) statusText += result.transferConnected ? ' → Connected' : ' → Transfer attempted'
  } else if (result.duration > 0 && result.duration < 3) {
    icon = '📵'; statusText = 'Hung up immediately'
  } else if (result.duration > 0) {
    icon = '📵'; statusText = 'Listened but no key pressed'
  } else {
    statusText = sanitizeHangupCause(result.hangupCause) || 'Completed'
  }

  const durText = result.duration > 0 ? ` (${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')})` : ''

  // Build progress bar
  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
  const barLen = 10
  const filled = Math.round(pct / 10)
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)

  const msg = `${icon} <b>${displayNumber}</b>${displayName} — ${statusText}${durText}\n` +
    `${bar} ${stats.completed}/${stats.total} (${pct}%) | ` +
    `🔘${stats.keyPressed} 📵${stats.noAnswer + stats.hungUp} ❌${stats.failed}`

  _bot?.sendMessage(campaign.chatId, msg, { parse_mode: 'HTML' }).catch(() => {})
}

/**
 * Resolve the user's preferred language for localised reports.
 */
async function getUserLang(chatId) {
  if (!_db) return 'en'
  try {
    const userState = await _db.collection('state').findOne({ _id: String(chatId) })
    return userState?.userLanguage || 'en'
  } catch (_) { return 'en' }
}

/**
 * Check if a campaign is complete (all leads processed)
 */
async function checkCampaignCompletion(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign || campaign.status !== 'running') return

  const allDone = campaign.leads.every(l => !['pending', 'calling', 'ringing', 'answered'].includes(l.status))
  if (!allDone) return

  // Campaign complete!
  await _collection.updateOne({ id: campaignId }, {
    $set: { status: 'completed', completedAt: new Date() }
  })
  delete activeCampaigns[campaignId]

  log(`[BulkCall] Campaign ${campaignId} completed!`)

  // Send final report
  await sendFinalReport(campaignId)
}

/**
 * Send the final campaign report to the user
 */
async function sendFinalReport(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return

  const { stats, leads } = campaign
  const duration = campaign.completedAt && campaign.startedAt
    ? Math.round((new Date(campaign.completedAt) - new Date(campaign.startedAt)) / 1000)
    : 0
  const durMin = Math.floor(duration / 60)
  const durSec = duration % 60

  const lang = await getUserLang(campaign.chatId)
  const tt = (key, ...args) => translation(`t.${key}`, lang, ...args)

  // Summary message
  const summary = [
    tt('bulkCallReportTitle'),
    ``,
    `📱 ${tt('bulkCallReportCallerId')} <b>${campaign.callerId}</b>`,
    `🎵 ${tt('bulkCallReportAudio')} <b>${campaign.audioName}</b>`,
    `📞 ${tt('bulkCallReportProvider')} <b>Speechcue</b>`,
    `⏱ ${tt('bulkCallReportDuration')} <b>${durMin}m ${durSec}s</b>`,
    ``,
    `📞 ${tt('bulkCallReportTotal')} <b>${stats.total}</b>`,
    `✅ ${tt('bulkCallReportAnswered')} <b>${stats.answered}</b>`,
    `🔘 ${tt('bulkCallReportKeyPressed')} <b>${stats.keyPressed}</b>`,
    campaign.mode === 'transfer' ? `🔗 ${tt('bulkCallReportTransferred')} <b>${stats.transferred}</b>` : null,
    `📵 ${tt('bulkCallReportNoAnswer')} <b>${stats.noAnswer}</b>`,
    `📵 ${tt('bulkCallReportHungUp')} <b>${stats.hungUp}</b>`,
    `🚫 ${tt('bulkCallReportBusy')} <b>${stats.busy}</b>`,
    `❌ ${tt('bulkCallReportFailed')} <b>${stats.failed}</b>`,
  ].filter(Boolean).join('\n')

  _bot?.sendMessage(campaign.chatId, summary, { parse_mode: 'HTML' }).catch(() => {})

  // Generate detailed report file
  try {
    const reportPath = await generateReportFile(campaign)
    if (reportPath) {
      await _bot?.sendDocument(campaign.chatId, reportPath, {
        caption: `📋 Detailed campaign report — ${stats.total} calls`,
      })
      // Clean up file after sending
      setTimeout(() => { try { fs.unlinkSync(reportPath) } catch (e) {} }, 30000)
    }
  } catch (e) {
    log(`[BulkCall] Report file error: ${e.message}`)
  }
}

/**
 * Generate a detailed CSV report file
 */
async function generateReportFile(campaign) {
  const lines = ['Number,Name,Status,Key Pressed,Duration (s),Transferred,Transfer Connected,Hangup Cause']

  for (const lead of campaign.leads) {
    lines.push([
      lead.number,
      `"${(lead.name || '').replace(/"/g, '""')}"`,
      lead.status,
      lead.digitPressed || '',
      lead.duration || 0,
      lead.transferred ? 'Yes' : 'No',
      lead.transferConnected ? 'Yes' : 'No',
      lead.hangupCause ? sanitizeHangupCause(lead.hangupCause) : '',
    ].join(','))
  }

  const filename = `campaign-report-${campaign.id.slice(0, 8)}.csv`
  const reportPath = path.join('/tmp', filename)
  fs.writeFileSync(reportPath, lines.join('\n'))
  return reportPath
}

/**
 * Cancel a running campaign
 */
async function cancelCampaign(campaignId) {
  const state = activeCampaigns[campaignId]
  if (state) state.paused = true

  await _collection.updateOne(
    { id: campaignId },
    { $set: { status: 'cancelled', completedAt: new Date() } }
  )
  delete activeCampaigns[campaignId]

  // Clean up callToCampaign mappings for this campaign
  for (const [sid, mapping] of Object.entries(callToCampaign)) {
    if (mapping.campaignId === campaignId) delete callToCampaign[sid]
  }

  log(`[BulkCall] Campaign ${campaignId} cancelled`)
  return true
}

/**
 * Pause a running campaign (stop firing new calls, let active calls finish)
 */
async function pauseCampaign(campaignId) {
  const state = activeCampaigns[campaignId]
  if (state) state.paused = true
  await _collection.updateOne({ id: campaignId }, { $set: { status: 'paused' } })
  log(`[BulkCall] Campaign ${campaignId} paused`)
  return true
}

/**
 * Get campaign by ID
 */
async function getCampaign(campaignId) {
  return _collection.findOne({ id: campaignId })
}

/**
 * Get recent campaigns for a user
 */
async function getUserCampaigns(chatId, limit = 10) {
  return _collection.find({ chatId: String(chatId) }).sort({ createdAt: -1 }).limit(limit).toArray()
}

/**
 * Check if a callSid belongs to a bulk campaign
 */
function isBulkCall(callSid) {
  return !!callToCampaign[callSid]
}

/**
 * Get campaign mapping for a callSid
 */
function getCampaignMapping(callSid) {
  return callToCampaign[callSid] || null
}

module.exports = {
  initBulkCallService,
  
  registerRoutes,
  recoverRunningCampaigns,
  parseLeadsFile,
  createCampaign,
  startCampaign,
  launchDueScheduledCampaigns,
  onDigitReceived,
  onCallStatusUpdate,
  cancelCampaign,
  pauseCampaign,
  getCampaign,
  getUserCampaigns,
  isBulkCall,
  getCampaignMapping,
  callToCampaign,
  activeCampaigns,
  BULK_CALL_RATE,
  MAX_BULK_LEADS,
  BULK_CALL_MIN_WALLET,
}
