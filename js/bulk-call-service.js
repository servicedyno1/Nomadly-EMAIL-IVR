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
const { isTwilioEnabled } = require('./phone-config.js')
const dialGuard = require('./dial-rate-guard.js')
const contactsImport = require('./contacts-import.js')
const sched = require('./campaign-schedule.js')

// ━━━ Bulk Call Pricing & Limits ━━━
const BULK_CALL_RATE       = parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15')   // $/min — charged whether answered or not
const MAX_BULK_LEADS       = parseInt(process.env.BULK_CALL_MAX_LEADS || '500', 10)      // max leads per campaign
const BULK_CALL_MIN_WALLET = parseFloat(process.env.BULK_CALL_MIN_WALLET || '20')        // minimum wallet balance to launch
const TELNYX_DIAL_GAP_MS   = parseInt(process.env.BULK_TELNYX_DIAL_GAP_MS || '1000', 10) // account-wide Telnyx dial pacing (CPS)
const VM_MAX_CALL_SEC      = parseInt(process.env.BULK_VM_MAX_CALL_SEC || '60', 10)      // voicemail-drop campaigns: max call length
const STUCK_LEAD_MAX_MIN   = parseInt(process.env.BULK_STUCK_LEAD_MAX_MIN || '20', 10)   // in-flight lead with no completion → swept

// Legacy campaigns (pre-Telnyx) carry no provider field — they are Twilio campaigns.
const campaignProvider = (c) => (c && c.provider) || 'twilio'
const INFLIGHT_STATUSES = ['calling', 'ringing', 'answered']
const TELNYX_NO_ANSWER_CAUSES = ['timeout', 'no_answer', 'originator_cancel', 'normal_clearing', 'recovery_on_timer_expire']
const TELNYX_BUSY_CAUSES = ['busy', 'user_busy', 'call_rejected']
// Line limit: Telnyx refused the dial because every line is in use → the lead waits and is redialed (never failed).
const LINE_RETRY_MIN_MS = parseInt(process.env.BULK_LINE_RETRY_MIN_MS || '5000', 10)
const LINE_RETRY_MAX_MS = parseInt(process.env.BULK_LINE_RETRY_MAX_MS || '60000', 10)
const LINE_403_MAX_RETRIES = 30 // a SIP 403 on hangup can also be a real carrier block, so that case has a safety valve
const HOURS_RECHECK_MS = 10 * 60000 // AI campaigns: leads outside 8am–9pm local time are rechecked every 10 min
const isAiCampaign = (c) => c?.mode === 'ai'
const aiAgent = () => require('./ai-agent')
// The account's do-not-call list applies to every campaign (false if the list isn't loaded in this process).
const onDnc = (chatId, number) => aiAgent().store.onDnc(chatId, number).catch(() => false)
const TWILIO_UPGRADE_NOTICE = `⚠️ <b>Number Being Upgraded</b>\n\n` +
  `This campaign's caller ID is being moved to our new calling network, so it can't dial right now. ` +
  `Nothing was dialed or charged.\n\nStart a new campaign from your new number, or tap 💬 Support.`

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
  // Only the server holding the dialer lease dials. Under PM2 (blue/green slots) a new slot waits for the old one to
  // hand over (it stops dialing, lets live calls finish, exits) and then recovers; elsewhere recovery runs after 15 s.
  _leaseCol = db.collection('bulkDialerLease')
  if (LEASE_ON) startLeaseLoop()
  else setTimeout(() => recoverRunningCampaigns().catch(e => log(`[BulkCall] Recovery error: ${e.message}`)), 15000)

  if (!_lowLinesTimer) {
    _lowLinesTimer = setInterval(() => checkLowLines().catch(e => log(`[BulkCall] Low-lines check error: ${e.message}`)), LOW_LINES_EVERY_MS)
    if (_lowLinesTimer.unref) _lowLinesTimer.unref()
  }

  if (!_stuckSweepTimer) {
    _stuckSweepTimer = setInterval(() => sweepStuckLeads().catch(e => log(`[BulkCall] Stuck-lead sweep error: ${e.message}`)), 2 * 60 * 1000)
    if (_stuckSweepTimer.unref) _stuckSweepTimer.unref()
  }
}

let _routesRegistered = false
let _stuckSweepTimer = null
let _lowLinesTimer = null

// ━━━ DIALER LEASE: one dialing server per app ━━━
// Mongo doc { _id, owner, expiresAt, draining }. The holder renews it; a server without it never places a call.
// Deploy handover: the old slot gets POST /internal/bulk-dialer/stop → stops dialing but KEEPS the lease (so the new
// slot, which isn't receiving webhooks yet, can't dial) → live calls finish → nginx flips → old slot exits and
// releases the lease → the new slot takes over and resumes. A crashed holder's lease expires after LEASE_TTL_MS.
const LEASE_ON = process.env.BULK_DIALER_LEASE === 'on' || (process.env.BULK_DIALER_LEASE !== 'off' && process.env.pm_id !== undefined)
const LEASE_TTL_MS = parseInt(process.env.BULK_DIALER_LEASE_TTL_MS || '30000', 10)
const LEASE_TICK_MS = parseInt(process.env.BULK_DIALER_LEASE_TICK_MS || '3000', 10)
const LEASE_ID = `bulkDialer:${String(process.env.BULK_DIALER_APP || process.env.name || 'app').replace(/-[ab]$/, '')}`
const LEASE_OWNER = `${require('os').hostname()}:${process.pid}:${Date.now()}`
let _leaseCol = null, _isDialer = false, _draining = false, _leaseTimer = null
const canDial = () => !_draining && (!LEASE_ON || _isDialer)

async function tryLease() {
  if (!_leaseCol) return false
  const now = new Date()
  try {
    await _leaseCol.updateOne(
      { _id: LEASE_ID, $or: [{ owner: LEASE_OWNER }, { expiresAt: { $lt: now } }] },
      { $set: { owner: LEASE_OWNER, expiresAt: new Date(now.getTime() + LEASE_TTL_MS), renewedAt: now, draining: _draining } },
      { upsert: true })
    return true
  } catch (e) {
    if (e.code !== 11000) log(`[BulkCall] Dialer lease error: ${e.message}`)
    return false // held by another live server
  }
}

async function leaseTick() {
  const had = _isDialer
  _isDialer = await tryLease()
  if (_isDialer && !had && !_draining) {
    log(`[BulkCall] Dialer lease acquired (${LEASE_ID}) — this server dials now`)
    await recoverRunningCampaigns().catch(e => log(`[BulkCall] Recovery error: ${e.message}`))
    // Campaigns started on this server while it was waiting for the lease
    for (const id of Object.keys(activeCampaigns)) fireNextBatch(id).catch(e => log(`[BulkCall] takeover batch ${id}: ${e.message}`))
  } else if (!_isDialer && had) log(`[BulkCall] Dialer lease lost (${LEASE_ID}) — dialing stopped on this server`)
}

function startLeaseLoop() {
  if (_leaseTimer) return
  log(`[BulkCall] Waiting for dialer lease ${LEASE_ID} (owner ${LEASE_OWNER})`)
  const tick = () => leaseTick().catch(e => log(`[BulkCall] lease tick: ${e.message}`))
  setTimeout(tick, Math.min(5000, LEASE_TICK_MS))
  _leaseTimer = setInterval(tick, LEASE_TICK_MS)
  if (_leaseTimer.unref) _leaseTimer.unref()
}

// Deploy step 1 (old slot): stop placing new calls; live calls run to the end. The lease stays held.
async function stopDialing(reason = 'deploy') {
  if (_draining) return dialerStatus()
  _draining = true
  log(`[BulkCall] Dialing stopped (${reason}) — live calls finish here; the next server resumes the campaigns`)
  if (_isDialer) await tryLease()
  return dialerStatus()
}

function resumeDialing() {
  if (!_draining) return dialerStatus()
  _draining = false
  log('[BulkCall] Dialing resumed on this server (handover cancelled)')
  for (const id of Object.keys(activeCampaigns)) fireNextBatch(id).catch(e => log(`[BulkCall] resume batch ${id}: ${e.message}`))
  return dialerStatus()
}

// Deploy step 2 (old slot exiting): hand the lease over.
async function releaseDialer() {
  _draining = true
  if (_leaseTimer) { clearInterval(_leaseTimer); _leaseTimer = null }
  if (!_leaseCol || !_isDialer) return
  _isDialer = false
  await _leaseCol.deleteOne({ _id: LEASE_ID, owner: LEASE_OWNER }).catch(() => {})
  log(`[BulkCall] Dialer lease released (${LEASE_ID})`)
}

function dialerStatus() {
  return { lease: LEASE_ON, holder: _isDialer, draining: _draining, campaigns: Object.keys(activeCampaigns).length }
}

// ━━━ LOW-LINES ALERT (admin only) ━━━
// A running campaign that keeps fewer than half its lines busy for LOW_LINES_SAMPLES minutes in a row (while enough
// numbers are still waiting, and not waiting for calling hours / the daily limit) → one admin Telegram alert, then
// at most one per campaign per hour.
const LOW_LINES_EVERY_MS = parseInt(process.env.BULK_LOW_LINES_EVERY_MS || '60000', 10)
const LOW_LINES_SAMPLES = parseInt(process.env.BULK_LOW_LINES_SAMPLES || '10', 10)
const LOW_LINES_REALERT_MS = 60 * 60 * 1000

// Campaigns paused for a low wallet continue by themselves once the wallet covers the next call (checked every minute).
// Campaigns the customer paused stay paused.
async function resumeToppedUp() {
  if (!_collection || !_walletOf || !canDial()) return
  const paused = await _collection.find({ status: 'paused', pausedReason: 'wallet', dryRun: { $ne: true } }, { projection: { id: 1, chatId: 1, name: 1, agentId: 1, mode: 1, 'leads.status': 1, 'leads.number': 1 } }).toArray()
  for (const c of paused) {
    const next = c.leads.find(l => l.status === 'pending')
    if (!next) continue
    const need = isAiCampaign(c) ? aiAgent().RATE() : leadRate(next.number)
    if (!(await smartWalletCheck(_walletOf, c.chatId, need)).sufficient) continue
    const r = await resumeCampaign(c.id)
    if (!r.success) continue
    log(`[BulkCall] Auto-resumed ${c.id} — wallet topped up`)
    _bot?.sendMessage(c.chatId, `▶️ <b>Campaign resumed</b>\n\n${escHtml(c.name || 'Your campaign')} continues — your wallet was topped up. ${c.leads.filter(l => l.status === 'pending').length} numbers left to call.`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: campaignControls({ id: c.id, status: 'running' }) } }).catch(() => {})
  }
}

// A campaign marked running in the database that no server is dialing (e.g. resumed by support, or a lost handover)
// is picked up within a minute. Skips anything started/resumed in the last 2 minutes (still starting up).
async function adoptOrphans() {
  if (!_collection || !canDial()) return
  const cut = new Date(Date.now() - 120000)
  const q = { id: { $nin: Object.keys(activeCampaigns) }, startedAt: { $lt: cut }, $or: [{ resumedAt: { $exists: false } }, { resumedAt: null }, { resumedAt: { $lt: cut } }] }
  if (await _collection.countDocuments({ status: 'running', dryRun: { $ne: true }, ...q })) {
    log('[BulkCall] Found running campaign(s) no server is dialing — picking them up')
    await recoverRunningCampaigns(q)
  }
}

async function checkLowLines() {
  await adoptOrphans().catch(e => log(`[BulkCall] orphan pick-up error: ${e.message}`))
  await resumeToppedUp().catch(e => log(`[BulkCall] wallet auto-resume error: ${e.message}`))
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!_collection || !canDial() || !admin) return
  for (const [id, st] of Object.entries(activeCampaigns)) {
    if (st.paused) { st.lineSamples = []; continue }
    const c = await _collection.findOne({ id }, { projection: { name: 1, chatId: 1, status: 1, dryRun: 1, concurrency: 1, callerId: 1, callerPool: 1, waitingForHours: 1, waitingForDailyLimit: 1, lineLimitAt: 1, 'leads.status': 1, 'leads.startedAt': 1, 'leads.completedAt': 1, 'leads.hangupCause': 1 } })
    if (!c || c.status !== 'running' || c.dryRun) { st.lineSamples = []; continue }
    const live = c.leads.filter(l => INFLIGHT_STATUSES.includes(l.status)).length
    const pending = c.leads.filter(l => l.status === 'pending').length
    const want = Math.min(c.concurrency || 1, pending + live)
    st.lineSamples = [...(st.lineSamples || []), { live, want, waiting: !!(c.waitingForHours || c.waitingForDailyLimit) }].slice(-LOW_LINES_SAMPLES)
    const s = st.lineSamples
    if (s.length < LOW_LINES_SAMPLES || s.some(x => x.waiting || x.want < 2 || x.live * 2 >= x.want)) continue
    if (st.lowAlertAt && Date.now() - st.lowAlertAt < LOW_LINES_REALERT_MS) continue
    st.lowAlertAt = Date.now()
    const since = Date.now() - LOW_LINES_SAMPLES * LOW_LINES_EVERY_MS
    const recent = c.leads.filter(l => l.completedAt && new Date(l.completedAt).getTime() >= since)
    const started = c.leads.filter(l => l.startedAt && new Date(l.startedAt).getTime() >= since).length
    const failed = recent.filter(l => l.status === 'failed')
    const causes = {}; for (const l of failed) { const k = String(l.hangupCause || 'unknown').slice(0, 60); causes[k] = (causes[k] || 0) + 1 }
    const topCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${escHtml(k)} ×${n}`).join(', ')
    const avg = s.reduce((a, x) => a + x.live, 0) / s.length
    const reason = c.lineLimitAt && Date.now() - new Date(c.lineLimitAt).getTime() < LOW_LINES_SAMPLES * LOW_LINES_EVERY_MS ? 'Telnyx said all account lines are busy (line limit) — check the Telnyx channel limit / other campaigns.'
      : recent.length && failed.length / recent.length >= 0.3 ? `Many calls fail before ringing (${failed.length} of ${recent.length}): ${topCauses}.`
      : started === 0 ? 'No calls were started at all — the dialer looks stuck. Check the server logs for this campaign.'
      : 'Free lines are not being refilled — check the server logs for this campaign.'
    log(`[BulkCall] LOW LINES campaign=${id} avg ${avg.toFixed(1)}/${c.concurrency} — ${reason}`)
    _bot?.sendMessage(admin,
      `⚠️ <b>Bulk IVR using few lines</b>\n\n` +
      `Campaign: <b>${escHtml(c.name || id)}</b>\n<code>${id}</code>\nCustomer chatId: <code>${c.chatId}</code>\n` +
      `Lines busy: <b>${avg.toFixed(1)}</b> of <b>${c.concurrency}</b> on average for ${LOW_LINES_SAMPLES} min\n` +
      `Calls started in that time: <b>${started}</b> · numbers waiting: <b>${pending}</b>\n` +
      `Caller ID: ${escHtml(cidSummary({ ...c, leads: [] }))}\n\n` +
      `Likely reason: ${reason}`,
      { parse_mode: 'HTML' }).catch(() => {})
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Twilio Webhook Routes — registered AFTER initBulkCallService completes
// so we never serve a request while _collection is still null.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerRoutes(app) {
  // Deploy handover (localhost only + a per-process token file the deploy script reads; see scripts/droplet_deploy.sh).
  const tokenFile = path.join(require('os').tmpdir(), `bulk-dialer-${process.env.PORT || 'app'}.token`)
  const token = crypto.randomBytes(24).toString('hex')
  try { fs.writeFileSync(tokenFile, token, { mode: 0o600 }) } catch (e) { log(`[BulkCall] handover token write failed: ${e.message}`) }
  const local = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] &&
    String(req.headers['x-dialer-token'] || '').length === token.length && crypto.timingSafeEqual(Buffer.from(String(req.headers['x-dialer-token'])), Buffer.from(token))
  app.post('/internal/bulk-dialer/stop', async (req, res) => {
    if (!local(req)) return res.sendStatus(403)
    res.json(await stopDialing('deploy handover'))
  })
  // Deploy aborted after the stop (nginx switch failed) → this slot keeps serving and dials again.
  app.post('/internal/bulk-dialer/start', async (req, res) => {
    if (!local(req)) return res.sendStatus(403)
    res.json(resumeDialing())
  })
  app.get('/internal/bulk-dialer', (req, res) => (local(req) ? res.json(dialerStatus()) : res.sendStatus(403)))
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
            require('./voice-service.js').recordOutboundMenuPress({ callerId: leadCid(campaign, campaign.leads?.[parseInt(leadIndex)]), chatId: campaign.chatId, targetNumber: leadNum, digit: atSub ? `${path}.${digits}` : digits, action: opt.action, campaignId })
          } catch (_) { /* non-blocking */ }
        }
        const selfUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
        const gatherBase = `${selfUrl}/twilio/bulk-ivr-gather?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${leadIndex}`
        if (opt && opt.action === 'forward' && opt.forwardTo) {
          response.say('Please hold while we connect you.')
          const transferStatusUrl = `${selfUrl}/twilio/bulk-ivr-transfer-status?campaignId=${encodeURIComponent(campaignId)}&leadIndex=${encodeURIComponent(leadIndex)}&dest=${encodeURIComponent(opt.forwardTo)}`
          const dial = response.dial({ callerId: leadCid(campaign, campaign.leads?.[parseInt(leadIndex)]), timeout: 30, action: transferStatusUrl, method: 'POST' })
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
            callerId: leadCid(campaign, campaign.leads?.[parseInt(leadIndex)]),
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
          await voiceService.billCallMinutesUnified(campaign.chatId, leadCid(campaign, campaign.leads?.[parseInt(leadIndex)]), minutes, dest, 'IVR_Transfer', callRef)
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

async function recoverRunningCampaigns(extra = {}) {
  if (!_collection) return
  const runningCampaigns = await _collection.find({ status: 'running', dryRun: { $ne: true }, ...extra }).toArray()
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
    // Started (or already recovered) by THIS process — its legs are live and tracked; don't reset/redial.
    if (activeCampaigns[campaignId]) {
      log(`[BulkCall] Recovery: Campaign ${campaignId} already active in this process — skipped`)
      continue
    }
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

    // ── 2. Twilio campaigns: blocked while Twilio is disabled; otherwise require a sub-account ──
    if (campaignProvider(campaign) === 'twilio' && !isTwilioEnabled()) {
      await cancelForTwilioUpgrade(campaign)
      blocked++
      log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — Twilio disabled, cancelled (number being upgraded)`)
      continue
    }
    if (campaignProvider(campaign) === 'twilio' && !campaign.twilioSubAccountSid) {
      await _collection.updateOne({ id: campaignId }, {
        $set: { status: 'cancelled', completedAt: new Date(), cancelledReason: 'Recovery blocked: no Twilio sub-account' }
      })
      blocked++
      log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — BLOCKED (no sub-account)`)
      _bot?.sendMessage(campaign.chatId,
        `🚫 <b>Campaign Cancelled After Restart</b>\n\n` +
        `Your Bulk IVR campaign could not be resumed because its caller number no longer supports Bulk IVR.\n` +
        `${pendingLeads.length} leads were not dialed.`,
        { parse_mode: 'HTML' }
      ).catch(() => {})
      continue
    }

    // ── 3. Stale check: >24h with no recent lead activity → zombie campaign ──
    const lastActivity = getLastLeadActivity(campaign)
    const hoursSinceActivity = lastActivity ? (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60) : Infinity
    const hoursSinceStart = campaign.startedAt ? (Date.now() - new Date(campaign.startedAt).getTime()) / (1000 * 60 * 60) : Infinity

    if (hoursSinceActivity > STALE_CAMPAIGN_HOURS && hoursSinceStart > STALE_CAMPAIGN_HOURS && !campaign.waitingForDailyLimit) {
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
          await resetInflightLeads(campaignId, leads, campaignProvider(campaign))
          log(`[BulkCall] Recovery: Campaign ${campaignId} (user ${campaign.chatId}) — paused (insufficient funds)`)
          await pauseForWallet(campaign, walletCheck.usdBal, BULK_CALL_RATE, 'Campaign Paused After Restart')
          canResume = false
        }
      } catch (e) {
        log(`[BulkCall] Recovery: Credit check error for ${campaignId}: ${e.message}`)
      }
    }

    if (!canResume) continue

    // ── 5. RESUME: Reset in-flight leads and re-populate in-memory state ──
    // Twilio legs from the old process are dead → pending. Telnyx legs whose voice-service session
    // was warm-loaded keep running and settle via their hangup webhook (they hold a slot).
    const { kept } = await resetInflightLeads(campaignId, leads, campaignProvider(campaign))

    // Re-populate in-memory state
    activeCampaigns[campaignId] = {
      activeCalls: kept,
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

  log(`[BulkCall] Recovery complete: ${recovered} resumed, ${stale} stale cancelled, ${blocked} blocked (Twilio)`)
}

async function cancelForTwilioUpgrade(campaign) {
  await _collection.updateOne({ id: campaign.id }, {
    $set: { status: 'cancelled', completedAt: new Date(), cancelledReason: 'Twilio number being upgraded' }
  })
  _bot?.sendMessage(campaign.chatId, TWILIO_UPGRADE_NOTICE, { parse_mode: 'HTML' }).catch(() => {})
}

// Per-minute rate for one lead — same destination pricing as Quick IVR
// (US/CA flat, international + high-cost destinations higher).
function leadRate(number) {
  return typeof _voiceService?.getIvrCallRate === 'function' ? _voiceService.getIvrCallRate(number) : BULK_CALL_RATE
}

// Pre-launch estimate (min 1 min per lead), split standard-rate vs higher-rate leads.
// Blocked (satellite / premium-rate) numbers are never dialled or billed, so they are left out.
function estimateLeadsCost(leads) {
  let total = 0, domestic = 0, intl = 0, blocked = 0, intlMin = Infinity, intlMax = 0
  for (const l of leads || []) {
    if (dialGuard.classifyDial(l.number).blocked) { blocked++; continue }
    const r = leadRate(l.number)
    total += r
    if (r > BULK_CALL_RATE) { intl++; intlMin = Math.min(intlMin, r); intlMax = Math.max(intlMax, r) } else domestic++
  }
  const intlLabel = intl ? (intlMin === intlMax ? `$${intlMax.toFixed(2)}` : `$${intlMin.toFixed(2)}–$${intlMax.toFixed(2)}`) : ''
  const rateLine = intl
    ? `Rate: $${BULK_CALL_RATE.toFixed(2)}/min US/CA · ${intlLabel}/min international (${intl} lead${intl === 1 ? '' : 's'})`
    : `Rate: $${BULK_CALL_RATE.toFixed(2)}/min per call`
  const blockedLine = blocked ? `🚫 ${blocked} blocked number${blocked === 1 ? '' : 's'} (satellite/premium-rate) will be skipped — not charged` : ''
  return { total: +total.toFixed(2), domestic, intl, blocked, intlRate: intlMax, rateLine, blockedLine }
}

const STATUS_ICON = { running: '▶️', paused: '⏸', scheduled: '⏰', created: '🆕', completed: '✅', cancelled: '❌' }
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline Pause / Resume / Cancel buttons for a campaign's current status.
function campaignControls(c) {
  const id = c.id
  const status = { text: '📊 Status', callback_data: `bulk_view:${id}` }
  const cancel = { text: '❌ Cancel', callback_data: `bulk_cancel:${id}` }
  if (c.status === 'running') return [[{ text: '⏸ Pause', callback_data: `bulk_pause:${id}` }, cancel], [status]]
  if (c.status === 'paused') return [[{ text: '▶️ Resume', callback_data: `bulk_resume:${id}` }, cancel], [status]]
  if (c.status === 'scheduled' || c.status === 'created') return [[cancel]]
  return []
}

function formatCampaignStatus(c) {
  const s = c.stats || {}
  const pct = s.total ? Math.round(((s.completed || 0) / s.total) * 100) : 0
  return [
    `📊 <b>Campaign Status</b> — ${STATUS_ICON[c.status] || ''} <b>${String(c.status).toUpperCase()}</b>`,
    ``,
    `📱 Caller ID: <b>${cidSummary(c)}</b>`,
    `🎵 Audio: <b>${escHtml(c.audioName || 'Custom Audio')}</b>`,
    `Progress: <b>${s.completed || 0}/${s.total || 0}</b> (${pct}%)`,
    `✅ Answered: <b>${s.answered || 0}</b>`,
    `🔘 Key Pressed: <b>${s.keyPressed || 0}</b>`,
    c.mode === 'transfer' ? `🔗 Transferred: <b>${s.transferred || 0}</b>` : null,
    `📵 No Answer: <b>${s.noAnswer || 0}</b>`,
    `📵 Hung Up: <b>${s.hungUp || 0}</b>`,
    s.voicemail ? `📭 Voicemail: <b>${s.voicemail}</b>${s.voicemailLeft ? ` (📩 ${s.voicemailLeft} message${s.voicemailLeft === 1 ? '' : 's'} left)` : ''}` : null,
    `🚫 Busy: <b>${s.busy || 0}</b>`,
    `❌ Failed: <b>${s.failed || 0}</b>`,
    c.status === 'paused' && c.pausedReason === 'wallet' ? `\n⏸ Paused — wallet depleted. Top up via 👛 Wallet — it continues by itself within a minute.` : null,
    c.status === 'scheduled' && c.scheduledFor ? `\n⏰ Launches at <b>${new Date(c.scheduledFor).toISOString().replace('T', ' ').slice(0, 16)} UTC</b>` : null,
    c.status === 'cancelled' && c.cancelledReason ? `\nReason: ${escHtml(c.cancelledReason)}` : null,
  ].filter(v => v !== null).join('\n')
}

// Pauses a running campaign for low wallet balance and offers ▶️ Resume / ❌ Cancel.
async function pauseForWallet(campaign, usdBal, rate, title = 'Campaign Paused — Wallet Depleted') {
  const state = activeCampaigns[campaign.id]
  if (state && state.paused) return
  // Only pause while leads are still waiting to be dialled — a campaign whose last lead just
  // billed must complete (final report), not sit paused asking for a top-up.
  const r = await _collection.updateOne({ id: campaign.id, status: 'running', 'leads.status': 'pending' }, { $set: { status: 'paused', pausedReason: 'wallet' } })
  if (r.modifiedCount !== 1) return
  if (state) state.paused = true
  const fresh = await _collection.findOne({ id: campaign.id })
  _bot?.sendMessage(campaign.chatId,
    `⏸️ <b>${title}</b>\n\n` +
    `📞 ${fresh?.stats?.completed || 0}/${fresh?.stats?.total || 0} calls completed so far.\n` +
    `Wallet: <b>$${Number(usdBal || 0).toFixed(2)}</b> (need $${rate.toFixed(2)}/min per call).\n\n` +
    `Top up via 👛 Wallet — the campaign continues by itself within a minute of your top-up.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: campaignControls({ id: campaign.id, status: 'paused' }) } }
  ).catch(() => {})
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
 * Reset in-flight leads (calling/ringing) to pending after restart.
 * Telnyx: a lead whose leg still has a voice-service session is kept (counted in `kept`);
 * an orphaned Telnyx leg is hung up first so the re-dial never overlaps a live call.
 */
async function resetInflightLeads(campaignId, leads, provider = 'twilio') {
  const resetOps = {}
  let count = 0
  let kept = 0
  for (let i = 0; i < leads.length; i++) {
    if (leads[i].status === 'calling' || leads[i].status === 'ringing') {
      const sid = leads[i].callSid
      if (provider === 'telnyx' && sid) {
        // A call the previous server placed after this one warm-loaded sessions → read it from the session store.
        if (!_voiceService?.outboundIvrCalls?.[sid]) await _voiceService?.rehydrateSession?.(sid)
        if (_voiceService?.outboundIvrCalls?.[sid]) { kept++; continue }
        await _voiceService?.hangupOutboundLeg?.(sid)
      }
      resetOps[`leads.${i}.status`] = 'pending'
      resetOps[`leads.${i}.callSid`] = null
      resetOps[`leads.${i}.startedAt`] = null
      count++
    }
  }
  if (count > 0) {
    await _collection.updateOne({ id: campaignId }, { $set: resetOps })
    log(`[BulkCall] Recovery: Reset ${count} in-flight leads to pending for campaign ${campaignId}${kept ? ` (${kept} live Telnyx leg(s) kept)` : ''}`)
  }
  return { count, kept }
}

/**
 * Settle leads stuck in flight (completion webhook lost) so their slot frees and the
 * campaign can complete. Marked failed with 0s → not billed.
 */
async function sweepStuckLeads() {
  if (!_collection) return 0
  const cutoff = Date.now() - STUCK_LEAD_MAX_MIN * 60 * 1000
  let swept = 0
  for (const campaignId of Object.keys(activeCampaigns)) {
    const campaign = await _collection.findOne({ id: campaignId })
    if (!campaign) continue
    for (const lead of campaign.leads || []) {
      if (!INFLIGHT_STATUSES.includes(lead.status) || !lead.startedAt || new Date(lead.startedAt).getTime() > cutoff) continue
      log(`[BulkCall] Sweeping stuck lead campaign=${campaignId} lead=${lead.index} (in flight > ${STUCK_LEAD_MAX_MIN} min)`)
      await finalizeLead(campaign, lead.index, lead.callSid || null, {
        finalStatus: 'failed', duration: 0, hangupCause: 'no completion received',
        digitPressed: lead.digitPressed || null, transferred: false, transferConnected: false,
      })
      swept++
    }
  }
  return swept
}

// Leads from a pasted list or an uploaded file (.xlsx / .csv / .txt). The phone and name columns are found from the
// headers (Phone, Mobile, Name, First name…) or the cell contents; see contacts-import.js.
// 2026-10-01 (@jameswalker3646): unreadable binary uploads (pdf/audio/old .xls) return { binary: true } so the bot
// answers with a clear message instead of garbage "leads".
function parseLeadsFile(content, fileName, opts) {
  try {
    return contactsImport.parseLeads(Buffer.isBuffer(content) ? content : String(content || ''), fileName, opts)
  } catch (e) {
    if (!e.code) throw e
    return { leads: [], errors: [e.message], binary: true, columns: null }
  }
}

/**
 * Create a new campaign
 */
async function createCampaign(params) {
  require('./scam-watch').watch({ chatId: params.chatId, where: 'Call campaign', data: { name: params.name, audioName: params.audioName, agentName: params.agentName, menu: params.menu, voicemailAudioName: params.voicemailAudioName } })
  const { chatId, callerId, showAs, audioUrl, audioName, mode, transferNumber, transferBackups, menu, activeKeys, concurrency, holdMusic, leads, twilioSubAccountSid, twilioSubAccountToken, scheduledFor, provider, voicemailAudioUrl, voicemailAudioName, agentId, agentName, repeat, dailyLimit, tz } = params

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
    ...(showAs ? { showAs } : {}),
    audioUrl,
    audioName: audioName || 'Custom Audio',
    name: String(params.name || '').trim().slice(0, 80) || null,
    mode: mode || 'report_only', // 'transfer' | 'report_only' | 'ai' (an AI voice agent talks to each lead)
    agentId: mode === 'ai' ? agentId : null,
    agentName: mode === 'ai' ? (agentName || null) : null,
    transferNumber: transferNumber || null,
    transferBackups: Array.isArray(transferBackups) && transferNumber ? transferBackups.slice(0, 4) : [],
    menu: menu || null,
    activeKeys: activeKeys || ['1'],
    concurrency: Math.min(concurrency || 10, 20),
    // Rotation: bots = one call per caller ID (calls at once = pool size); web (poolShare) = the customer's
    // calls-at-once shared across the IDs (1–20, or up to one per ID when they rotate more than 20, max 50).
    ...(poolOf(params.callerPool, callerId, showAs) ? (() => {
      const pool = poolOf(params.callerPool, callerId, showAs)
      if (!params.poolShare) return { callerPool: pool, concurrency: pool.length }
      return { callerPool: pool, poolShare: true, concurrency: Math.max(1, Math.min(parseInt(concurrency, 10) || 10, Math.max(20, pool.length), MAX_CALLER_POOL)) }
    })() : {}),
    holdMusic: holdMusic || false,
    provider: provider || (twilioSubAccountSid ? 'twilio' : 'telnyx'),
    voicemailAudioUrl: voicemailAudioUrl || null,
    voicemailAudioName: voicemailAudioName || null,
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
      voicemail: 0,
      voicemailLeft: 0,
    },
    scheduledFor: schedAt,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    // Repeat runs + daily call limit (web app); tz = owner's time zone for "same time" / "per day".
    repeat: sched.REPEATS.includes(repeat) ? repeat : null,
    dailyLimit: dailyLimit > 0 ? Math.floor(dailyLimit) : null,
    tz: tz ? sched.zoneOf(tz) : null,
  }
  if (campaign.repeat) { campaign.seriesId = campaign.id; campaign.runNumber = 1 }

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
  const due = await _collection.find({ status: 'scheduled', scheduledFor: { $lte: now }, dryRun: { $ne: true } }).limit(20).toArray()
  for (const c of due) {
    // Repeat run while the previous run is still calling → that run finishes first; this one moves to the next slot.
    if (c.seriesId && await _collection.findOne({ seriesId: c.seriesId, id: { $ne: c.id }, status: { $in: ['running', 'paused'] } }, { projection: { id: 1 } })) {
      const next = sched.nextRunAt(c)
      await _collection.updateOne({ id: c.id, status: 'scheduled' }, { $set: { scheduledFor: next, lastSkippedAt: new Date() } })
      log(`[BulkSchedule] ${c.id}: previous run still calling — moved to ${next.toISOString()}`)
      continue
    }
    // Atomic claim — only the winner flips 'scheduled' -> 'created' and proceeds.
    const claim = await _collection.updateOne({ id: c.id, status: 'scheduled' }, { $set: { status: 'created', claimedAt: new Date() } })
    if (!claim || claim.modifiedCount !== 1) continue
    if (c.repeat) await spawnNextRun(c).catch(e => log(`[BulkSchedule] next run for ${c.id} failed: ${e.message}`))
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

// Repeating campaign: schedules its next run once (the launch of a run creates the one after it).
async function spawnNextRun(c) {
  if (!c.repeat) return null
  const id = crypto.randomUUID()
  const r = await _collection.updateOne({ id: c.id, nextRunId: { $exists: false } }, { $set: { nextRunId: id } })
  if (r.modifiedCount !== 1) return null
  const at = sched.nextRunAt(c)
  await _collection.insertOne(sched.nextRunDoc(c, id, at))
  log(`[BulkSchedule] ${c.id}: next ${c.repeat} run ${id} at ${at.toISOString()}`)
  return id
}

// Stop repeating: no more runs are made and upcoming auto-made runs are cancelled. Runs calling now keep going.
async function stopRepeat(campaignId) {
  const c = await _collection.findOne({ id: campaignId })
  if (!c?.repeat) return { error: 'This campaign does not repeat.' }
  const seriesId = c.seriesId || c.id
  await _collection.updateMany({ seriesId }, { $set: { repeat: null } })
  const upcoming = await _collection.find({ seriesId, autoRun: true, status: 'scheduled' }, { projection: { id: 1 } }).toArray()
  for (const u of upcoming) await cancelCampaign(u.id, 'Repeat stopped', { sendReport: false })
  log(`[BulkSchedule] series ${seriesId}: repeat stopped (${upcoming.length} upcoming run(s) cancelled)`)
  return { success: true, cancelledRuns: upcoming.length }
}

/**
 * Start a campaign — begin dialing leads via Twilio
 */
const PROVIDER_SUSPENDED_REASON = 'provider suspended'

function isProviderSuspended(result) {
  const s = result?.subAccountStatus
  const err = String(result?.error || '')
  return (s && s !== 'active') || /sub-account is (suspended|closed)/i.test(err) ||
    /insufficient (funds|balance)|balance (is )?too low|account (is )?(not active|inactive|disabled|suspended)|authentication failed|api key|provided credentials/i.test(err)
}

// Ends the campaign: cancelled + reason, pending leads marked not called. The in-memory state stays
// paused (not deleted) so in-flight legs still settle and bill normally via onCallStatusUpdate.
async function endCampaignProviderSuspended(campaignId, leadNumber) {
  const state = activeCampaigns[campaignId]
  if (state) state.paused = true
  const r = await _collection.updateOne(
    { id: campaignId, status: 'running' },
    { $set: {
      status: 'cancelled', cancelledReason: PROVIDER_SUSPENDED_REASON, completedAt: new Date(),
      'leads.$[p].notCalled': true, 'leads.$[p].hangupCause': `not called — campaign ended (${PROVIDER_SUSPENDED_REASON})`,
    } },
    { arrayFilters: [{ 'p.status': 'pending' }] }
  )
  if (r.modifiedCount) {
    log(`[BulkCall] Campaign ${campaignId} ended — ${PROVIDER_SUSPENDED_REASON} (first failing lead ${leadNumber}); no further dials`)
    await recalcStats(campaignId).catch(() => {})
  }
}

async function startCampaign(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return { error: 'Campaign not found' }
  if (campaign.status === 'running') return { error: 'Campaign already running' }
  if (campaign.dryRun) return { error: 'Preview campaigns are never dialed.' }
  const isTelnyx = campaignProvider(campaign) === 'telnyx'

  // Reversible guard: legacy Twilio campaigns can't dial while Twilio is disabled.
  if (!isTelnyx && !isTwilioEnabled()) {
    log(`[BulkCall] Campaign ${campaignId} uses a Twilio caller ID while TWILIO_ENABLED=false — cancelled (number being upgraded)`)
    await cancelForTwilioUpgrade(campaign)
    return { error: 'This number is being upgraded to our new calling network. Start a new campaign from your new number.' }
  }

  // ━━━ SECURITY: Reject Twilio campaigns without a sub-account — prevents unauthorized use of main Twilio account ━━━
  if (!isTelnyx && !campaign.twilioSubAccountSid) {
    log(`[BulkCall] BLOCKED campaign ${campaignId}: no twilioSubAccountSid — would use main Twilio account`)
    await _collection.updateOne({ id: campaignId }, { $set: { status: 'cancelled', cancelledReason: 'No Twilio sub-account — bulk IVR requires an owned Twilio number' } })
    _bot?.sendMessage(campaign.chatId,
      `🚫 <b>Campaign Blocked</b>\n\nYour current number does not support Bulk IVR.\n\nPurchase a ☎️ Bulk IVR capable number to use this feature.`,
      { parse_mode: 'HTML' }
    ).catch(() => {})
    return { error: 'This number does not support Bulk IVR. Campaign blocked.' }
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

      // ── Pre-campaign estimate for all users (destination-based rates, min 1 min per lead) ──
      const est = estimateLeadsCost(campaign.leads)
      const minRequired = est.total
      const estLeadsCovered = Math.floor(Math.max(usdBal, 0) / BULK_CALL_RATE)
      const rateLine = est.rateLine + (est.blockedLine ? `\n${est.blockedLine}` : '')
      const costCheck = await smartWalletCheck(_walletOf, campaign.chatId, minRequired)
      if (!costCheck.sufficient) {
        _bot?.sendMessage(campaign.chatId,
          `⚠️ <b>Low Balance Warning</b>\n\n` +
          `Wallet: <b>$${usdBal.toFixed(2)}</b> (~${estLeadsCovered}+ calls at $${BULK_CALL_RATE.toFixed(2)}/min).\n` +
          `Campaign has <b>${campaign.leads.length}</b> leads — estimated cost: <b>$${minRequired.toFixed(2)}</b>.\n` +
          `${rateLine}\n` +
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
          rateLine,
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
  if (campaign.repeat) await spawnNextRun(campaign).catch(e => log(`[BulkSchedule] next run for ${campaignId} failed: ${e.message}`))

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
    `📱 Caller ID: <b>${cidSummary(campaign)}</b>\n` +
    `📞 Provider: <b>Speechcue</b>\n` +
    `⚡ Concurrency: <b>${campaign.concurrency}</b>\n` +
    `📊 Mode: <b>${campaign.mode === 'transfer' ? '🔗 Transfer + Report' : '📊 Report Only'}</b>\n` +
    (isTelnyx ? `📭 Voicemail: <b>${campaign.voicemailAudioUrl ? `Leave "${escHtml(campaign.voicemailAudioName || 'message')}"` : 'Hang up'}</b>\n` : '') +
    `Dialing now... You'll receive updates as calls complete.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: campaignControls({ id: campaignId, status: 'running' }) } }
  ).catch(() => {})

  // Fire initial batch (Telnyx dials are paced, so don't hold the caller while they ramp up)
  const firing = fireNextBatch(campaignId)
  if (isTelnyx) firing.catch(e => log(`[BulkCall] Initial batch error for ${campaignId}: ${e.message}`))
  else await firing
  return { success: true }
}

let _nextTelnyxDialAt = 0
// Reserves the next account-wide Telnyx dial slot (shared by all campaigns/batches).
async function telnyxDialSlot() {
  const now = Date.now()
  const at = Math.max(now, _nextTelnyxDialAt)
  _nextTelnyxDialAt = at + TELNYX_DIAL_GAP_MS
  if (at > now) await new Promise(r => setTimeout(r, at - now))
}

// Atomically flips one lead pending → calling so concurrent batches never dial the same lead twice.
async function claimLead(campaignId, leadIndex, cid = null) {
  const r = await _collection.updateOne(
    { id: campaignId, status: 'running', [`leads.${leadIndex}.status`]: 'pending' },
    { $set: { [`leads.${leadIndex}.status`]: 'calling', [`leads.${leadIndex}.startedAt`]: new Date(), ...(cid ? { [`leads.${leadIndex}.callerId`]: cid.callerId, [`leads.${leadIndex}.shownAs`]: cid.showAs || null } : {}) } }
  )
  return r.modifiedCount === 1
}

// Caller-ID rotation: campaign.callerPool = [{ callerId, showAs }] (2+ entries). Every call in progress uses a different entry
// (one call per entry at a time); the next call takes the free entry that has dialed the fewest leads so far.
const MAX_CALLER_POOL = 50
const poolKey = (e) => `${e.callerId}|${e.showAs || ''}`
const leadCid = (campaign, lead) => lead?.callerId || campaign.callerId
// "📱 +1… ×120 · +1… ×118 …" — calls per rotating caller ID (report); plain number when there is no pool.
function cidSummary(campaign) {
  if (!Array.isArray(campaign.callerPool) || campaign.callerPool.length < 2) return campaign.callerId
  const n = {}; for (const l of campaign.leads || []) if (l.callerId) { const k = l.shownAs || l.callerId; n[k] = (n[k] || 0) + 1 }
  return `${campaign.callerPool.length} rotating — ` + campaign.callerPool.map(e => e.showAs || e.callerId).map(k => `${k}${n[k] ? ` ×${n[k]}` : ''}`).join(' · ')
}
function poolPicker(campaign) {
  const pool = Array.isArray(campaign.callerPool) && campaign.callerPool.length > 1 ? campaign.callerPool : null
  if (!pool) return null
  const used = {}, busy = new Set(), live = {}
  for (const l of campaign.leads) {
    if (!l.callerId) continue
    const k = `${l.callerId}|${l.shownAs || ''}`; used[k] = (used[k] || 0) + 1
    if (['calling', 'ringing', 'answered', 'in-progress'].includes(l.status)) { busy.add(k); live[k] = (live[k] || 0) + 1 }
  }
  // Shared pool (web): several calls per ID at once — take the ID with the fewest calls in progress, then fewest dialed.
  if (campaign.poolShare) return {
    next() { const e = [...pool].sort((a, b) => ((live[poolKey(a)] || 0) - (live[poolKey(b)] || 0)) || ((used[poolKey(a)] || 0) - (used[poolKey(b)] || 0)))[0]; live[poolKey(e)] = (live[poolKey(e)] || 0) + 1; used[poolKey(e)] = (used[poolKey(e)] || 0) + 1; return e },
    free(e) { live[poolKey(e)] = Math.max(0, (live[poolKey(e)] || 0) - 1) },
  }
  return {
    next() { const e = pool.filter(x => !busy.has(poolKey(x))).sort((a, b) => (used[poolKey(a)] || 0) - (used[poolKey(b)] || 0))[0]; if (e) { busy.add(poolKey(e)); used[poolKey(e)] = (used[poolKey(e)] || 0) + 1 } return e || null },
    free(e) { busy.delete(poolKey(e)) },
  }
}

function poolOf(list, callerId, showAs) {
  if (!Array.isArray(list)) return null
  const seen = new Set(), out = []
  for (const e of [{ callerId, showAs: showAs || null }, ...list]) {
    if (!e?.callerId) continue
    const x = { callerId: String(e.callerId), showAs: e.showAs ? String(e.showAs) : null }
    if (seen.has(poolKey(x))) continue
    seen.add(poolKey(x)); out.push(x)
  }
  return out.length > 1 ? out.slice(0, MAX_CALLER_POOL) : null
}

function dialTwilio(campaign, lead, selfUrl) {
  const q = `campaignId=${encodeURIComponent(campaign.id)}&leadIndex=${lead.index}`
  return _twilioService.makeOutboundCall(
    campaign.callerId,
    lead.number,
    `${selfUrl}/twilio/bulk-ivr?${q}`,
    campaign.twilioSubAccountSid || null,
    campaign.twilioSubAccountToken || null,
    {
      statusCallback: `${selfUrl}/twilio/bulk-status?${q}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      timeout: 30, // ring for 30s
    }
  )
}

// Telnyx Call Control: reuses the outbound-IVR state machine in voice-service (audio + DTMF,
// transfer w/ hold music, multi-key menu, report-only). Its hangup handler calls onCallComplete.
function dialTelnyx(campaign, lead) {
  const audioUrl = /^https?:\/\//i.test(campaign.audioUrl || '') ? campaign.audioUrl : null
  const isTransfer = campaign.mode === 'transfer'
  return _voiceService.initiateOutboundIvrCall({
    chatId: campaign.chatId,
    callerId: campaign.callerId,
    displayCallerId: campaign.showAs || null,
    targetNumber: lead.number,
    ivrNumber: isTransfer ? (campaign.transferNumber || null) : null,
    transferBackups: isTransfer ? (campaign.transferBackups || []) : [],
    menu: campaign.menu || null,
    audioUrl,
    activeKeys: campaign.activeKeys || ['1'],
    templateName: campaign.audioName,
    holdMusic: !!campaign.holdMusic,
    voicemailAudioUrl: /^https?:\/\//i.test(campaign.voicemailAudioUrl || '') ? campaign.voicemailAudioUrl : null,
    // Voicemail-drop campaigns: no call runs past BULK_VM_MAX_CALL_SEC (default 60 s, hung up ~3 s early so it bills as 1 min)
    // unless connected to the owner or a voicemail message is being left (voice-service CAP_EXEMPT_PHASES).
    maxCallSec: campaign.voicemailAudioUrl ? VM_MAX_CALL_SEC : null,
    campaignId: campaign.id,
    leadIndex: lead.index,
    bulkMode: isTransfer ? 'transfer' : 'report_only',
    provider: 'telnyx',
  })
}

// Runs fireNextBatch again after `ms` (one pending timer per campaign).
function retryLater(campaignId, ms) {
  const st = activeCampaigns[campaignId]
  if (!st) return
  if (st.retryTimer) {
    if (st.retryAt <= Date.now() + ms) return
    clearTimeout(st.retryTimer) // a sooner retry wins
  }
  st.retryAt = Date.now() + ms
  st.retryTimer = setTimeout(() => {
    st.retryTimer = null
    fireNextBatch(campaignId).catch(e => log(`[BulkCall] retry batch error ${campaignId}: ${e.message}`))
  }, ms)
  if (st.retryTimer.unref) st.retryTimer.unref()
}

// All lines busy: put the lead back in the queue and try again with backoff (5s → 60s).
async function requeueForLines(campaignId, leadIndex, extra = {}) {
  await _collection.updateOne({ id: campaignId }, {
    $set: { [`leads.${leadIndex}.status`]: 'pending', [`leads.${leadIndex}.startedAt`]: null, [`leads.${leadIndex}.callSid`]: null, [`leads.${leadIndex}.waitingForLine`]: true, lineLimitAt: new Date(), ...extra },
    $inc: { [`leads.${leadIndex}.lineRetries`]: 1 },
  })
  await sched.refundDailySlot(_collection, campaignId)
  const st = activeCampaigns[campaignId]
  if (!st) return
  st.lineBackoff = Math.min(LINE_RETRY_MAX_MS, st.lineBackoff ? st.lineBackoff * 2 : LINE_RETRY_MIN_MS)
  retryLater(campaignId, st.lineBackoff)
}

/**
 * Fill free lines. One batch per campaign at a time: a finishing call while a batch runs only asks for one more pass.
 * (Concurrent batches walked the same lead list and spent a global Telnyx dial slot on every lead another batch had
 * already claimed — with 20 lines that queued minutes of empty slots and dialing fell to ~1 call/min.)
 */
async function fireNextBatch(campaignId) {
  const st = activeCampaigns[campaignId]
  if (!st) return
  if (st.firing) { st.refire = true; return }
  st.firing = true
  try {
    do { st.refire = false; await fireBatchOnce(campaignId) } while (st.refire && activeCampaigns[campaignId] === st && !st.paused)
  } finally { st.firing = false }
}

async function fireBatchOnce(campaignId) {
  if (!canDial()) return
  const state = activeCampaigns[campaignId]
  if (!state || state.paused) return

  const campaign = await _collection.findOne({ id: campaignId })
  // Preview (dry-run) campaigns never place real calls, even after a restart's recovery.
  if (!campaign || campaign.status !== 'running' || campaign.dryRun) return

  if (campaign.concurrency - state.activeCalls <= 0) return

  const SELF_URL = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
  const isTelnyx = campaignProvider(campaign) === 'telnyx'

  // Find pending leads
  const pendingLeads = campaign.leads.filter(l => l.status === 'pending')
  const picker = poolPicker(campaign)
  const isAi = isAiCampaign(campaign)
  const minRate = isAi ? aiAgent().RATE() : BULK_CALL_RATE

  // ━━━ PER-BATCH CREDIT CHECK: Pause campaign if wallet exhausted (bulk calls use wallet only) ━━━
  if (pendingLeads.length > 0 && _walletOf) {
    try {
      const walletCheck = await smartWalletCheck(_walletOf, campaign.chatId, minRate)
      if (!walletCheck.sufficient) {
        // No credits — pause campaign
        log(`[BulkCall] Pausing campaign ${campaignId}: insufficient funds`)
        await pauseForWallet(campaign, walletCheck.usdBal, minRate)
        return
      }
    } catch (e) { log(`[BulkCall] Per-batch credit check error: ${e.message}`) }
  }

  let fired = 0, outsideHours = 0, limitHit = false
  for (const lead of pendingLeads) {
    if (state.paused || state.activeCalls >= campaign.concurrency) break
    // Do-not-call list (every campaign): never dialed, never billed.
    if (await onDnc(campaign.chatId, lead.number)) {
      await _collection.updateOne({ id: campaignId, [`leads.${lead.index}.status`]: 'pending' }, { $set: { [`leads.${lead.index}.status`]: 'skipped', [`leads.${lead.index}.hangupCause`]: 'On your do-not-call list', [`leads.${lead.index}.completedAt`]: new Date() } })
      await recalcStats(campaignId)
      continue
    }
    if (isAi) {
      // Calling hours (TCPA): only 8am–9pm in the lead's local time — otherwise the lead waits.
      if (!aiAgent().hours.callableNow(lead.number)) { outsideHours++; continue }
      const { usdBal } = await getBalance(_walletOf, campaign.chatId)
      const aiRate = aiAgent().leadRate(lead.number, campaign.aiRecord !== false) // + recording surcharge
      const need = aiAgent().committed(campaign.chatId) + aiRate
      if (usdBal < need) {
        if (state.activeCalls > 0) break // calls in progress settle first, then we check again
        log(`[BulkCall] Pausing AI campaign ${campaignId}: wallet $${usdBal} can't cover ${lead.number}`)
        await pauseForWallet(campaign, usdBal, aiRate)
        return
      }
    }
    if (isTelnyx) {
      await telnyxDialSlot()
      if (state.paused || state.activeCalls >= campaign.concurrency) break
    }
    // Daily call limit: today's calls used up → the rest wait for tomorrow (owner's time zone).
    if (campaign.dailyLimit && !(await sched.reserveDailySlot(_collection, campaign))) { limitHit = true; break }
    const cid = picker ? picker.next() : null
    if (picker && !cid) { if (campaign.dailyLimit) await sched.refundDailySlot(_collection, campaignId); break }
    state.activeCalls++
    if (!(await claimLead(campaignId, lead.index, cid))) {
      state.activeCalls--
      if (cid) picker.free(cid)
      if (campaign.dailyLimit) await sched.refundDailySlot(_collection, campaignId)
      continue
    }
    fired++
    const cc = cid ? { ...campaign, callerId: cid.callerId, showAs: cid.showAs || null } : campaign

    try {
      const result = isAi ? await aiAgent().dialLead(cc, lead) : isTelnyx ? await dialTelnyx(cc, lead) : await dialTwilio(cc, lead, SELF_URL)
      if (result.error && cid) picker.free(cid)

      if (result.error && isTelnyx && result.lineLimit) {
        // Every line is in use (account concurrent-call limit) → lead goes back in the queue, retried shortly.
        state.activeCalls--
        log(`[BulkCall] Line limit reached — ${lead.number} re-queued (campaign ${campaignId}): ${result.error}`)
        await requeueForLines(campaignId, lead.index)
        break
      }
      if (result.error) {
        state.activeCalls--
        // Provider account / caller ID suspended or out of funds → end the whole campaign now (no further dials, no charge).
        if (isProviderSuspended(result)) {
          await updateLeadResult(campaignId, lead.index, { status: 'pending', startedAt: null })
          await sched.refundDailySlot(_collection, campaignId)
          await endCampaignProviderSuspended(campaignId, lead.number)
          return
        }
        // Wallet can't cover this lead's (destination) rate → pause instead of failing the lead.
        if (/^Insufficient wallet balance/i.test(String(result.error))) {
          await updateLeadResult(campaignId, lead.index, { status: 'pending', startedAt: null })
          await sched.refundDailySlot(_collection, campaignId)
          const { usdBal } = await getBalance(_walletOf, campaign.chatId)
          log(`[BulkCall] Pausing campaign ${campaignId}: wallet can't cover ${lead.number} at $${leadRate(lead.number)}/min`)
          await pauseForWallet(campaign, usdBal, leadRate(lead.number))
          return
        }
        // Carrier says the number isn't in service → skip it (no charge, daily slot back) and list it in the report.
        if (result.invalidNumber) {
          await updateLeadResult(campaignId, lead.index, { status: 'skipped', hangupCause: 'Not an in-service number — skipped, not charged', completedAt: new Date() })
          await sched.refundDailySlot(_collection, campaignId)
          log(`[BulkCall] Skipped ${lead.number} — not in service (campaign ${campaignId})`)
          await recalcStats(campaignId)
          await sendProgressUpdate(campaignId, lead.index, { status: 'skipped', hangupCause: 'Not an in-service number — skipped, not charged', duration: 0 })
          await checkCampaignCompletion(campaignId)
          continue
        }
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
        // Map callSid (Twilio) / callControlId (Telnyx) to campaign
        const sid = result.callSid || result.callControlId
        state.lineBackoff = 0
        if (lead.waitingForLine) await updateLeadResult(campaignId, lead.index, { waitingForLine: false })
        callToCampaign[sid] = { campaignId, leadIndex: lead.index }
        await _collection.updateOne(
          { id: campaignId, [`leads.${lead.index}.status`]: { $in: INFLIGHT_STATUSES } },
          { $set: { [`leads.${lead.index}.callSid`]: sid }, ...(result.refusedCid ? { $addToSet: { refusedCids: result.refusedCid } } : {}) }
        )
        log(`[BulkCall] Speechcue call initiated (${isTelnyx ? 'telnyx' : 'twilio'}): ${sid} → ${lead.number}`)
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

  // AI campaigns: some leads are outside calling hours → look again later (campaign keeps running).
  if (isAi) {
    const waiting = outsideHours > 0 && fired === 0 && state.activeCalls === 0
    if (!!campaign.waitingForHours !== waiting) await _collection.updateOne({ id: campaignId }, { $set: { waitingForHours: waiting } })
    if (outsideHours > 0) retryLater(campaignId, HOURS_RECHECK_MS)
  }

  if (campaign.dailyLimit) {
    if (!!campaign.waitingForDailyLimit !== limitHit) await _collection.updateOne({ id: campaignId }, { $set: { waitingForDailyLimit: limitHit } })
    if (limitHit) retryLater(campaignId, Math.min(sched.msToNextDay(campaign.tz) + 5000, HOURS_RECHECK_MS))
  }

  // Check if all done (in case all calls failed immediately)
  if (fired === 0) {
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
    // Map Twilio status to our status
    let finalStatus = 'completed'
    if (status === 'no-answer') finalStatus = 'no_answer'
    else if (status === 'busy') finalStatus = 'busy'
    else if (status === 'failed' || status === 'canceled') finalStatus = 'failed'

    // Determine if transferred (transfer mode + digit pressed)
    const digitPressed = lead.digitPressed || null
    const transferred = !!(campaign.mode === 'transfer' && digitPressed && campaign.activeKeys.includes(digitPressed))

    await finalizeLead(campaign, leadIndex, callSid, {
      finalStatus,
      duration: duration || 0,
      hangupCause: hangupCause || null,
      digitPressed,
      transferred,
      transferConnected: transferred, // Speechcue Dial handles this — if completed it connected
    })
  }
}

/**
 * Telnyx Call Control completion — called by voice-service handleOutboundIvrHangup for
 * campaign calls. Maps the Telnyx outcome to a lead status, then finalizes (bill + progress + next).
 */
async function onCallComplete(callControlId, r = {}) {
  if (!_collection) return
  const { campaignId } = r
  const leadIndex = Number(r.leadIndex)
  if (!campaignId || !Number.isInteger(leadIndex)) return
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign || !campaign.leads[leadIndex]) return

  const answered = !!r.answeredAt
  const cause = String(r.hangupCause || '').toLowerCase()
  // SIP 403 before any answer = usually Telnyx's channel limit (D1/D2/D3) → wait for a free line and redial.
  const lead = campaign.leads[leadIndex]
  if (!answered && String(r.sipHangupCause || '') === '403' && (lead.lineRetries || 0) < LINE_403_MAX_RETRIES && INFLIGHT_STATUSES.includes(lead.status)) {
    const state = activeCampaigns[campaignId]
    if (state) state.activeCalls = Math.max(0, state.activeCalls - 1)
    delete callToCampaign[callControlId]
    log(`[BulkCall] ${lead.number} refused with SIP 403 (line limit) — re-queued (campaign ${campaignId}, retry ${(lead.lineRetries || 0) + 1})`)
    await requeueForLines(campaignId, leadIndex)
    return
  }
  const digitPressed = r.digitPressed || null
  let finalStatus
  if (answered && r.answeredBy === 'machine' && !digitPressed) finalStatus = 'voicemail'
  else if (answered) finalStatus = 'completed'
  else if (TELNYX_BUSY_CAUSES.includes(cause)) finalStatus = 'busy'
  else if (TELNYX_NO_ANSWER_CAUSES.includes(cause)) finalStatus = 'no_answer'
  else finalStatus = 'failed' // never connected (invalid / unreachable / carrier reject) → not billed

  await finalizeLead(campaign, leadIndex, callControlId, {
    finalStatus,
    duration: answered ? (r.duration || 0) : 0,
    hangupCause: r.hangupCause || null,
    digitPressed,
    transferred: !!r.transferred,
    transferConnected: !!r.transferConnected,
    answeredBy: r.answeredBy || null,
    answeredAt: r.answeredAt || null,
    voicemailDropped: finalStatus === 'voicemail' && !!r.voicemailDropped,
    ai: r.ai || null,
    aiBilling: r.aiBilling || null,
  })
}

/**
 * Shared terminal handler: atomically settles an in-flight lead exactly once, bills it,
 * posts progress, then dials the next lead and checks for campaign completion.
 */
async function finalizeLead(campaign, leadIndex, callSid, res) {
  const campaignId = campaign.id
  const p = `leads.${leadIndex}`
  const set = {
    [`${p}.status`]: res.finalStatus,
    [`${p}.duration`]: res.duration,
    [`${p}.hangupCause`]: res.hangupCause,
    [`${p}.completedAt`]: new Date(),
    [`${p}.digitPressed`]: res.digitPressed,
    [`${p}.transferred`]: res.transferred,
    [`${p}.transferConnected`]: res.transferConnected,
  }
  if (res.answeredBy) set[`${p}.answeredBy`] = res.answeredBy
  if (res.answeredAt) set[`${p}.answeredAt`] = res.answeredAt
  if (res.voicemailDropped) set[`${p}.voicemailDropped`] = true
  if (res.ai) set[`${p}.ai`] = res.ai
  const filter = { id: campaignId, [`${p}.status`]: { $in: INFLIGHT_STATUSES } }
  // NOTE: {$in:[null, sid]} on an array path always matches (Mongo also probes field "0" of each
  // element, which is missing ⇒ null), so match the sid exactly or a genuinely null/absent callSid.
  if (callSid) filter.$or = [{ [`${p}.callSid`]: callSid }, { [`${p}.callSid`]: { $type: 'null' } }, { [`${p}.callSid`]: { $exists: false } }]
  const claim = await _collection.updateOne(filter, { $set: set })
  if (claim.modifiedCount !== 1) {
    log(`[BulkCall] Ignoring stale/duplicate completion campaign=${campaignId} lead=${leadIndex} sid=${callSid}`)
    return
  }

  const state = activeCampaigns[campaignId]
  if (state) state.activeCalls = Math.max(0, state.activeCalls - 1)
  if (callSid) delete callToCampaign[callSid]

  if (isAiCampaign(campaign)) await billAiLead(campaign, leadIndex, res.aiBilling)
  else await billLead(campaign, leadIndex, res.finalStatus, res.duration)

  await recalcStats(campaignId)
  await sendProgressUpdate(campaignId, leadIndex, {
    status: res.finalStatus,
    digitPressed: res.digitPressed,
    duration: res.duration,
    hangupCause: res.hangupCause,
    transferred: res.transferred,
    transferConnected: res.transferConnected,
    voicemailDropped: !!res.voicemailDropped,
  })

  // Fire next batch
  await fireNextBatch(campaignId)
  await checkCampaignCompletion(campaignId)
}

// ━━━ BILLING: Charge $BULK_CALL_RATE/min from wallet — only for calls that connected ━━━
// A call with finalStatus 'failed' AND 0s duration never reached the carrier
// (e.g. provider auth/system rejection like Twilio "Authenticate", or an
// invalid number) — no carrier cost was incurred, so billing it overcharges
// the user. Fix 2026-06-10 after the Twilio sub-account auth outage billed
// ~196 never-connected calls. Answered / no-answer / busy / voicemail are billed.
async function billLead(campaign, leadIndex, finalStatus, duration) {
  const campaignId = campaign.id
  const lead = campaign.leads[leadIndex]
  if (finalStatus === 'failed' && (duration || 0) === 0) {
    log(`[BulkCall] Skipped billing — call never connected (status=failed, 0s) campaign=${campaignId} lead=${leadIndex}`)
    return
  }
  if (!_walletOf || !campaign.chatId) return
  try {
    const minutesBilled = Math.max(1, Math.ceil((duration || 0) / 60))  // minimum 1 minute always
    const rate = leadRate(lead?.number)  // US/CA flat; international / high-cost destinations higher
    const charge = +(minutesBilled * rate).toFixed(4)

    // Direct wallet deduction (bulk calls do NOT use plan minutes) — tries USD first, then NGN.
    // Metadata gives walletLedger full per-call attribution (2026-05-05 @johngambino audit).
    const deductResult = await smartWalletDeduct(_walletOf, campaign.chatId, charge, {
      type: 'outbound_call',
      callType: 'BulkIVR',
      destination: lead?.number || null,
      phoneNumber: lead?.number || null,
      description: `BulkIVR ${leadCid(campaign, lead)} → ${lead?.number || 'unknown'} (${minutesBilled} min × $${rate}, status=${finalStatus})`,
    })
    if (deductResult.success) {
      const chargedStr = deductResult.currency === 'ngn' ? `₦${deductResult.chargedNgn}` : `$${charge.toFixed(2)}`
      if (_db) {
        await _db.collection('phoneLogs').insertOne({
          chatId: campaign.chatId,
          type: 'BulkIVR',
          direction: 'outbound',
          provider: campaignProvider(campaign),
          from: leadCid(campaign, lead),
          to: lead?.number || 'unknown',
          duration: duration || 0,
          minutesBilled,
          charge,
          chargedCurrency: deductResult.currency,
          chargedNgn: deductResult.chargedNgn || null,
          rate,
          callStatus: finalStatus,
          campaignId,
          leadIndex,
          createdAt: new Date(),
        })
      }
      log(`[BulkCall] Billed ${chargedStr} (${minutesBilled} min × $${rate}/min) for campaign=${campaignId} lead=${leadIndex} status=${finalStatus}`)
    } else {
      log(`[BulkCall] Billing failed (insufficient funds) for campaign=${campaignId} lead=${leadIndex}`)
    }

    // ━━━ POST-BILLING: Check if wallet is now exhausted → pause campaign ━━━
    try {
      const postCheck = await smartWalletCheck(_walletOf, campaign.chatId, BULK_CALL_RATE)
      if (!postCheck.sufficient) {
        const campState = activeCampaigns[campaignId]
        if (campState && !campState.paused) {
          log(`[BulkCall] Wallet exhausted after billing — pausing campaign ${campaignId}`)
          await pauseForWallet(campaign, postCheck.usdBal, BULK_CALL_RATE, 'Campaign Auto-Paused — Wallet Depleted')
        }
      }
    } catch (e) { log(`[BulkCall] Post-billing wallet check error: ${e.message}`) }
  } catch (billErr) {
    log(`[BulkCall] Billing error for campaign=${campaignId} lead=${leadIndex}: ${billErr.message}`)
  }
}

// AI campaign lead: $0.30 per started minute of conversation (higher-cost destinations bill their IVR rate). Unanswered = free.
async function billAiLead(campaign, leadIndex, bill) {
  const lead = campaign.leads[leadIndex]
  if (!bill || !(bill.charge > 0) || !_walletOf) return
  try {
    const r = await smartWalletDeduct(_walletOf, campaign.chatId, bill.charge, {
      type: 'ai_agent_call', callType: 'AIAgent', destination: lead?.number || null, phoneNumber: leadCid(campaign, lead),
      description: `AI agent campaign ${leadCid(campaign, lead)} → ${lead?.number || 'unknown'} (${bill.minutesBilled} min × $${bill.rate}${bill.recordingRate ? ` incl. $${bill.recordingRate} recording` : ''})`,
    })
    log(`[BulkCall] AI lead billed $${bill.charge} (${bill.minutesBilled} min) campaign=${campaign.id} lead=${leadIndex} ok=${!!r?.success}`)
    const post = await smartWalletCheck(_walletOf, campaign.chatId, aiAgent().RATE())
    const st = activeCampaigns[campaign.id]
    if (!post.sufficient && st && !st.paused) await pauseForWallet(campaign, post.usdBal, aiAgent().RATE(), 'Campaign Auto-Paused — Wallet Depleted')
  } catch (e) { log(`[BulkCall] AI billing error campaign=${campaign.id} lead=${leadIndex}: ${e.message}`) }
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
    voicemail: 0,
    voicemailLeft: 0,
    skipped: 0,
    interested: 0,
    callback: 0,
    optedOut: 0,
    booked: 0,
  }

  for (const lead of campaign.leads) {
    if (lead.status === 'pending' || lead.status === 'calling' || lead.status === 'ringing') continue
    stats.completed++
    const o = lead.ai?.outcome
    if (o === 'interested') stats.interested++
    else if (o === 'booked') stats.booked++
    else if (o === 'callback') stats.callback++
    else if (o === 'opted_out') stats.optedOut++
    if (lead.status === 'skipped') stats.skipped++
    else if (lead.status === 'no_answer') stats.noAnswer++
    else if (lead.status === 'busy') stats.busy++
    else if (lead.status === 'failed') stats.failed++
    else if (lead.status === 'voicemail') { stats.voicemail++; if (lead.voicemailDropped) stats.voicemailLeft++ }
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
  else if (result.status === 'voicemail') { icon = '📭'; statusText = result.voicemailDropped ? 'Voicemail — message left' : 'Voicemail — hung up' }
  else if (lead?.ai?.outcome) { icon = '🤖'; statusText = `AI: ${lead.ai.outcome.replace(/_/g, ' ')}${lead.ai.summary ? ` — ${escHtml(lead.ai.summary.slice(0, 160))}` : ''}` }
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
    `🔘${stats.keyPressed} 📵${stats.noAnswer + stats.hungUp} ❌${stats.failed}` +
    (stats.voicemail ? ` 📭${stats.voicemail}` : '')

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
  if (campaign?.status === 'cancelled') return sendCancelledReport(campaignId)
  // 'paused' too: a campaign paused while its last call(s) were in flight is finished once they settle.
  if (!campaign || !['running', 'paused'].includes(campaign.status)) return

  const allDone = campaign.leads.every(l => !['pending', 'calling', 'ringing', 'answered'].includes(l.status))
  if (!allDone) return

  // Campaign complete! (atomic flip so concurrent final settlements send ONE report)
  const done = await _collection.updateOne({ id: campaignId, status: { $in: ['running', 'paused'] } }, {
    $set: { status: 'completed', completedAt: new Date() }
  })
  if (done.modifiedCount !== 1) return
  delete activeCampaigns[campaignId]

  log(`[BulkCall] Campaign ${campaignId} completed!`)

  // Send final report
  await sendFinalReport(campaignId)
}

/**
 * Send the final campaign report to the user
 */
// Numbers the carrier said aren't in service (skipped at dial time, or hung up as unallocated / SIP 404·604).
const NOT_IN_SERVICE = /not an in-service number|unallocated_number|^(404|604)$/i
const notInService = (c) => [...new Set((c?.leads || []).filter(l => NOT_IN_SERVICE.test(String(l.hangupCause || ''))).map(l => l.number))]

// One-tap cleanup: delete those numbers from the owner's saved contacts (every list) → { numbers, removed, cleanLeads }.
async function removeNotInService(campaignId, chatId) {
  const c = await _collection.findOne({ id: campaignId, chatId: String(chatId) })
  if (!c) return null
  if (c.badNumbersCleanedAt) return { numbers: notInService(c), removed: 0, alreadyCleaned: true, cleanLeads: [] }
  const numbers = notInService(c)
  const r = numbers.length && _db ? await _db.collection('webContacts').deleteMany({ chatId: { $in: [String(chatId), Number(chatId)] }, phone: { $in: numbers } }) : { deletedCount: 0 }
  await _collection.updateOne({ id: campaignId }, { $set: { badNumbersCleanedAt: new Date(), badNumbersRemoved: r.deletedCount } })
  const bad = new Set(numbers)
  return { numbers, removed: r.deletedCount, cleanLeads: (c.leads || []).filter(l => !bad.has(l.number)).map(l => ({ number: l.number, name: l.name || null })) }
}

// After the campaign only: "show as" numbers the network carriers refused (calls went out from the customer's own number).
const REFUSED_NOTE = {
  en: (list, own) => `\n⚠️ <b>Network carriers refused caller ID${list.length > 1 ? 's' : ''}</b> ${list.join(', ')} — they are not verified for calling. Those calls showed your own number ${own} instead.`,
  fr: (list, own) => `\n⚠️ <b>Les opérateurs réseau ont refusé le(s) numéro(s) affiché(s)</b> ${list.join(', ')} — non vérifié(s) pour appeler. Ces appels ont affiché votre numéro ${own}.`,
  zh: (list, own) => `\n⚠️ <b>网络运营商拒绝了来电号码</b> ${list.join(', ')} — 这些号码未经验证，不能用于拨号。相关通话改为显示您自己的号码 ${own}。`,
  hi: (list, own) => `\n⚠️ <b>नेटवर्क कैरियर्स ने कॉलर ID अस्वीकार किए</b> ${list.join(', ')} — ये कॉल के लिए सत्यापित नहीं हैं। उन कॉल में आपका अपना नंबर ${own} दिखा।`,
  fa: (list, own) => `\n⚠️ <b>اپراتورهای شبکه شماره(های) نمایشی را رد کردند</b> ${list.join(', ')} — برای تماس تأیید نشده‌اند. در آن تماس‌ها شماره خودتان ${own} نمایش داده شد.`,
}
function refusedNote(c, lang) {
  const list = (c.refusedCids || []).slice(0, 10)
  if (!list.length) return null
  return (REFUSED_NOTE[lang] || REFUSED_NOTE.en)(list.map(n => `<code>${n}</code>`).concat(c.refusedCids.length > 10 ? [`+${c.refusedCids.length - 10} more`] : []), c.callerId)
}

async function sendFinalReport(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return
  if (campaign.splitId) advanceSeries(campaign).catch(e => log(`[BulkCall] series advance error: ${e.message}`))

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
    tt(campaign.status === 'cancelled' ? 'bulkCallReportTitleCancelled' : 'bulkCallReportTitle'),
    ``,
    stats.voicemailLeft ? tt('bulkCallReportVmLeft', stats.voicemailLeft) + '\n' : null,
    `📱 ${tt('bulkCallReportCallerId')} <b>${cidSummary(campaign)}</b>`,
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
    stats.voicemail ? `📭 ${tt('bulkCallReportVoicemail')} <b>${stats.voicemail}</b>${stats.voicemailLeft ? ` (📩 ${stats.voicemailLeft})` : ''}` : null,
    `🚫 ${tt('bulkCallReportBusy')} <b>${stats.busy}</b>`,
    `❌ ${tt('bulkCallReportFailed')} <b>${stats.failed}</b>`,
    (() => { const bad = notInService(campaign); return bad.length ? `⏭ Not in service (skipped, not charged): <b>${bad.length}</b>${bad.length <= 5 ? '\n' + bad.map(n => `   • <code>${n}</code>`).join('\n') : ''}` : null })(),
    campaign.status === 'cancelled' && (leads || []).some(l => l.notCalled) ? `⏭ ${tt('bulkCallReportNotDialed')} <b>${leads.filter(l => l.notCalled).length}</b>` : null,
    refusedNote(campaign, lang),
  ].filter(Boolean).join('\n')

  const badCount = notInService(campaign).length
  const cleanBtn = badCount && !require('./cloudivr-web/notify').isWebChatId(campaign.chatId)
    ? { reply_markup: { inline_keyboard: [[{ text: `🧹 Remove ${badCount} not-in-service number${badCount === 1 ? '' : 's'}`, callback_data: `bcclean:${campaign.id}` }]] } } : {}
  _bot?.sendMessage(campaign.chatId, summary, { parse_mode: 'HTML', ...cleanBtn }).catch(() => {})

  // Generate detailed report file
  try {
    const reportPath = await generateReportFile(campaign)
    if (reportPath) {
      await _bot?.sendDocument(campaign.chatId, reportPath, {
        caption: `📋 Detailed campaign report — ${stats.total} calls`,
      })
      // Clean up file after sending
      setTimeout(() => { try { fs.unlinkSync(reportPath) } catch (_) { /* already removed */ } }, 30000)
    }
  } catch (e) {
    log(`[BulkCall] Report file error: ${e.message}`)
  }
}

/**
 * Generate a detailed CSV report file
 */
async function generateReportFile(campaign) {
  const lines = ['Number,Name,Status,Key Pressed,Duration (s),Transferred,Transfer Connected,Hangup Cause,Answered By,Voicemail Left']

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
      lead.answeredBy ? `${lead.answeredBy}${lead.voicemailDropped ? ' (message left)' : ''}` : '',
      lead.voicemailDropped ? 'Yes' : 'No',
    ].join(','))
  }

  const filename = `campaign-report-${campaign.id.slice(0, 8)}.csv`
  const reportPath = path.join('/tmp', filename)
  fs.writeFileSync(reportPath, lines.join('\n'))
  return reportPath
}

// Telnyx leg already transferred to the customer's own line (digit pressed / bridging) — keep it on cancel.
function isLegTransferring(sid) {
  const s = _voiceService?.outboundIvrCalls?.[sid]
  return !!(s && (s.digitPressed || ['transferring', 'bridged'].includes(s.phase)))
}

// Cancel = stop billing now: hang up live legs still ringing or playing the message.
async function hangupUntransferred(c) {
  const live = (c?.leads || []).filter(l => INFLIGHT_STATUSES.includes(l.status) && l.callSid && !String(l.callSid).startsWith('CA') && !isLegTransferring(l.callSid))
  await Promise.all(live.map(l => _voiceService?.hangupOutboundLeg?.(l.callSid)))
  if (live.length) log(`[BulkCall] Campaign ${c.id}: ended ${live.length} live call(s) on cancel`)
  return live.length
}

/**
 * Cancel a campaign (running / paused / scheduled). Live calls still ringing or playing the message are
 * hung up (they bill only the time already used); calls already transferred to the customer keep going.
 * Pending leads are marked not called. Sends the report once in-flight calls settle.
 */
// ── Series (owner choice 2026-06): a list over 500 runs as back-to-back parts of 500, in file order. ──
// The wallet must cover the estimate for ALL parts at launch (money is still taken per minute). Only one
// part calls at a time; the next one starts by itself (autoNext) or waits for the customer to start it.
const MAX_SERIES_PARTS = parseInt(process.env.BULK_CALL_MAX_SERIES_PARTS || '10', 10)
const MAX_SERIES_LEADS = MAX_BULK_LEADS * MAX_SERIES_PARTS
// Biggest upload: over MAX_SERIES_LEADS only 'first' (500) or 'part' (first MAX_SERIES_LEADS kept) are allowed.
const MAX_UPLOAD_LEADS = parseInt(process.env.BULK_CALL_MAX_UPLOAD_LEADS || '50000', 10)
const splitLeads = (leads) => { const out = []; for (let i = 0; i < leads.length; i += MAX_BULK_LEADS) out.push(leads.slice(i, i + MAX_BULK_LEADS)); return out }

// mode: 'auto' | 'ask' (wallet covers all parts) · 'part' (pay per part: first 500 now, the rest wait unpaid for
// the customer to start) · 'first' (call only the first 500, the rest are dropped).
async function createSeries(params, { autoNext = true, mode } = {}) {
  mode = mode || (autoNext ? 'auto' : 'ask')
  let leads = params.leads || [], seriesDropped = 0
  if (leads.length <= MAX_BULK_LEADS) return createCampaign(params)
  if (leads.length > MAX_UPLOAD_LEADS) return { error: `Up to ${MAX_UPLOAD_LEADS.toLocaleString()} numbers per upload. You uploaded ${leads.length.toLocaleString()}.` }
  if (leads.length > MAX_SERIES_LEADS && mode !== 'first' && mode !== 'part') return { error: `Lists over ${MAX_SERIES_LEADS.toLocaleString()} numbers can call only the first ${MAX_BULK_LEADS}, or the first ${MAX_BULK_LEADS} now and keep the rest up to ${MAX_SERIES_LEADS.toLocaleString()}. You uploaded ${leads.length.toLocaleString()}.`, code: 'series_too_big' }
  if (mode === 'part' && leads.length > MAX_SERIES_LEADS) { seriesDropped = leads.length - MAX_SERIES_LEADS; leads = leads.slice(0, MAX_SERIES_LEADS) }
  if (mode === 'first') {
    const need = estimateLeadsCost(leads.slice(0, MAX_BULK_LEADS)).total, w = await smartWalletCheck(_walletOf, params.chatId, need)
    if (!w.sufficient) return { error: `Your wallet must cover the first ${MAX_BULK_LEADS} numbers: about $${need.toFixed(2)} (wallet: $${Number(w.usdBal ?? 0).toFixed(2)}). Add $${Math.max(0.01, need - Number(w.usdBal ?? 0)).toFixed(2)} and try again.`, code: 'series_funds', needed: need }
    const c = await createCampaign({ ...params, leads: leads.slice(0, MAX_BULK_LEADS) })
    if (c.error) return c
    await _collection.updateOne({ id: c.id }, { $set: { trimmedFrom: leads.length } })
    return { ...c, trimmedFrom: leads.length }
  }
  const payPerPart = mode === 'part'
  if (payPerPart) autoNext = false
  else autoNext = mode !== 'ask'
  const chunks = splitLeads(leads), est = estimateLeadsCost(payPerPart ? chunks[0] : leads)
  const funds = await smartWalletCheck(_walletOf, params.chatId, est.total)
  if (!funds.sufficient && payPerPart) {
    const bal = Number(funds.usdBal ?? funds.balance ?? (await getBalance(_walletOf, params.chatId).catch(() => ({})))?.usdBal ?? 0)
    return { error: `Your wallet must cover part 1 before launch: about $${est.total.toFixed(2)} for ${chunks[0].length} numbers (wallet: $${bal.toFixed(2)}). Add $${Math.max(0.01, est.total - bal).toFixed(2)} and try again.`, code: 'series_funds', needed: est.total }
  }
  if (!funds.sufficient) {
    const bal = Number(funds.usdBal ?? funds.balance ?? (await getBalance(_walletOf, params.chatId).catch(() => ({})))?.usdBal ?? 0)
    return { error: `Your wallet must cover all ${chunks.length} parts before launch: about $${est.total.toFixed(2)} for ${leads.length.toLocaleString()} numbers (wallet: $${bal.toFixed(2)}). Add $${Math.max(0.01, est.total - bal).toFixed(2)} and try again.`, code: 'series_funds', needed: est.total }
  }
  const splitId = crypto.randomUUID(), ids = []
  for (let i = 0; i < chunks.length; i++) {
    const c = await createCampaign({ ...params, leads: chunks[i], ...(i ? { scheduledFor: null } : {}) })
    if (c.error) { await _collection.deleteMany({ id: { $in: ids } }); return c }
    ids.push(c.id)
    await _collection.updateOne({ id: c.id }, { $set: { splitId, part: i + 1, parts: chunks.length, autoNext: !!autoNext, payPerPart, seriesTotal: leads.length, ...(seriesDropped ? { seriesDropped } : {}), ...(i ? { status: 'series_waiting' } : {}) } })
  }
  return { ...(await _collection.findOne({ id: ids[0] })), splitId, parts: chunks.length, partIds: ids, seriesDropped }
}

// A part finished (or was stopped): start / offer the next one, or stop the rest.
async function advanceSeries(c) {
  if (c.status === 'cancelled') {
    const r = await _collection.updateMany({ splitId: c.splitId, part: { $gt: c.part }, status: { $in: ['series_waiting', 'series_ready'] } }, { $set: { status: 'cancelled', completedAt: new Date(), cancelReason: `Part ${c.part} was stopped` } })
    if (r.modifiedCount) _bot?.sendMessage(c.chatId, `⏹ Series stopped — the remaining ${r.modifiedCount} part${r.modifiedCount === 1 ? '' : 's'} will not run.`).catch(() => {})
    return
  }
  if (c.status !== 'completed') return
  const next = await _collection.findOneAndUpdate({ splitId: c.splitId, part: c.part + 1, status: 'series_waiting' }, { $set: { status: c.autoNext ? 'created' : 'series_ready', readyAt: new Date() } }, { returnDocument: 'after' })
  const doc = next?.value !== undefined ? next.value : next
  if (!doc) { if (c.part === c.parts) _bot?.sendMessage(c.chatId, `🏁 <b>Series finished</b> — all ${c.parts} parts (${(c.seriesTotal || 0).toLocaleString()} numbers) are done.`, { parse_mode: 'HTML' }).catch(() => {}); return }
  const label = `Part ${doc.part} of ${doc.parts} (${doc.leads.length} numbers)`
  if (!c.autoNext) {
    const web = require('./cloudivr-web/notify').isWebChatId(c.chatId)
    const left = c.parts - c.part, pay = c.payPerPart ? `\n💳 About $${estimateLeadsCost(doc.leads).total.toFixed(2)} — your wallet must cover this part when you start it.` : ''
    _bot?.sendMessage(c.chatId, `✅ Part ${c.part} of ${c.parts} done.\n\n▶️ ${label} is ready.${pay}${web ? ` Open Campaigns to start it, or drop the remaining ${left === 1 ? 'part' : `${left} parts`}.` : ''}`, web ? {} : { reply_markup: { inline_keyboard: [[{ text: `▶️ Start part ${doc.part} of ${doc.parts}`, callback_data: `bcnext:${doc.id}` }], [{ text: `🗑 Drop the remaining ${left === 1 ? 'part' : `${left} parts`}`, callback_data: `bcdrop:${doc.id}` }]] } }).catch(() => {})
    return
  }
  _bot?.sendMessage(c.chatId, `✅ Part ${c.part} of ${c.parts} done — ▶️ ${label} starting now.`).catch(() => {})
  const r = await startCampaign(doc.id)
  if (r?.error) { await _collection.updateOne({ id: doc.id }, { $set: { status: 'series_ready' } }); _bot?.sendMessage(c.chatId, `⏸ ${label} couldn't start: ${r.error}`, require('./cloudivr-web/notify').isWebChatId(c.chatId) ? {} : { reply_markup: { inline_keyboard: [[{ text: `▶️ Try part ${doc.part} again`, callback_data: `bcnext:${doc.id}` }]] } }).catch(() => {}) }
}

// Pay-per-part: the wallet must cover this part's estimate when the customer starts it.
async function partFundsError(doc, chatId) {
  if (!doc?.payPerPart) return null
  const need = estimateLeadsCost(doc.leads).total, w = await smartWalletCheck(_walletOf, chatId, need)
  if (w.sufficient) return null
  const bal = Number(w.usdBal ?? 0)
  return { error: `Your wallet must cover part ${doc.part}: about $${need.toFixed(2)} for ${doc.leads.length} numbers (wallet: $${bal.toFixed(2)}). Add $${Math.max(0.01, need - bal).toFixed(2)} and start it again.`, lowBalance: true }
}

// The customer starts a waiting part ("Ask me before each part", or a retry after an error).
async function startSeriesPart(campaignId, chatId) {
  const c = await _collection.findOneAndUpdate({ id: campaignId, chatId, status: 'series_ready' }, { $set: { status: 'created' } }, { returnDocument: 'after' })
  const doc = c?.value !== undefined ? c.value : c
  if (!doc) return { error: 'This part is not ready to start.' }
  const low = await partFundsError(doc, chatId)
  if (low) { await _collection.updateOne({ id: doc.id }, { $set: { status: 'series_ready' } }); return low }
  const r = await startCampaign(doc.id)
  if (r?.error) await _collection.updateOne({ id: doc.id }, { $set: { status: 'series_ready' } })
  return r
}

// The customer drops the parts that haven't started yet (this one and every later part).
// A scheduled part 1 was cancelled before launch: the later parts never run either.
async function cancelSeriesAfter(campaignId) {
  const c = await _collection.findOne({ id: campaignId })
  if (c?.splitId) await _collection.updateMany({ splitId: c.splitId, part: { $gt: c.part }, status: { $in: ['series_waiting', 'series_ready'] } }, { $set: { status: 'cancelled', completedAt: new Date(), cancelReason: `Part ${c.part} was cancelled` } })
}

async function dropSeriesRest(campaignId, chatId) {
  const c = await _collection.findOne({ id: campaignId, chatId, splitId: { $exists: true }, status: { $in: ['series_waiting', 'series_ready'] } })
  if (!c) return { error: 'There are no waiting parts to drop.' }
  const r = await _collection.updateMany({ splitId: c.splitId, chatId, part: { $gte: c.part }, status: { $in: ['series_waiting', 'series_ready'] } }, { $set: { status: 'cancelled', completedAt: new Date(), cancelReason: 'Remaining parts dropped by customer' } })
  return { dropped: r.modifiedCount }
}

async function cancelCampaign(campaignId, reason = 'Cancelled by user', { sendReport = true } = {}) {
  const state = activeCampaigns[campaignId]
  if (state) state.paused = true
  const before = await _collection.findOne({ id: campaignId })

  const r = await _collection.updateOne(
    { id: campaignId, status: { $in: ['created', 'scheduled', 'running', 'paused'] } },
    { $set: {
      status: 'cancelled', completedAt: new Date(), cancelledReason: reason, reportPending: !!before?.startedAt,
      'leads.$[p].notCalled': true, 'leads.$[p].hangupCause': 'not called — campaign cancelled',
    } },
    { arrayFilters: [{ 'p.status': 'pending' }] }
  )
  if (r.modifiedCount !== 1) return { error: 'Campaign already finished or cancelled.' }
  if (before?.splitId) advanceSeries({ ...before, status: 'cancelled' }).catch(e => log(`[BulkCall] series stop error: ${e.message}`))

  log(`[BulkCall] Campaign ${campaignId} cancelled (${reason})`)
  await recalcStats(campaignId)
  const c = await _collection.findOne({ id: campaignId })
  const inFlight = (c?.leads || []).filter(l => INFLIGHT_STATUSES.includes(l.status)).length
  const ended = inFlight ? await hangupUntransferred(c) : 0
  // State stays (paused) while calls are in flight so they settle, bill and get swept if stuck.
  if (!inFlight) delete activeCampaigns[campaignId]
  if (sendReport) await sendCancelledReport(campaignId)
  return { success: true, notCalled: (c?.leads || []).filter(l => l.notCalled).length, inFlight, ended, transferring: inFlight - ended }
}

// Cancelled campaign: send the final report once its in-flight calls have settled (exactly once).
async function sendCancelledReport(campaignId) {
  const c = await _collection.findOne({ id: campaignId })
  if (!c || c.status !== 'cancelled' || !c.reportPending) return
  if (c.leads.some(l => INFLIGHT_STATUSES.includes(l.status))) return
  const r = await _collection.updateOne({ id: campaignId, reportPending: true }, { $unset: { reportPending: '' } })
  if (r.modifiedCount !== 1) return
  delete activeCampaigns[campaignId]
  await sendFinalReport(campaignId).catch(() => {})
}

/**
 * Pause a running campaign (stop firing new calls, let active calls finish)
 */
async function pauseCampaign(campaignId) {
  const r = await _collection.updateOne({ id: campaignId, status: 'running' }, { $set: { status: 'paused', pausedReason: 'user' } })
  if (r.modifiedCount !== 1) return { error: 'Campaign is not running.' }
  const state = activeCampaigns[campaignId]
  if (state) state.paused = true
  log(`[BulkCall] Campaign ${campaignId} paused`)
  return { success: true }
}

/**
 * Resume a paused campaign once the wallet covers the next lead's rate.
 */
async function resumeCampaign(campaignId) {
  const campaign = await _collection.findOne({ id: campaignId })
  if (!campaign) return { error: 'Campaign not found.' }
  if (campaign.status !== 'paused') return { error: `Campaign is ${campaign.status}, not paused.` }
  const provider = campaignProvider(campaign)
  if (provider === 'twilio' && !isTwilioEnabled()) {
    await cancelForTwilioUpgrade(campaign)
    return { error: 'This number is being upgraded to our new calling network. Start a new campaign from your new number.' }
  }

  const next = campaign.leads.find(l => l.status === 'pending')
  const need = next ? leadRate(next.number) : BULK_CALL_RATE
  if (_walletOf && next) {
    const w = await smartWalletCheck(_walletOf, campaign.chatId, need)
    if (!w.sufficient) {
      return { error: `Wallet balance $${w.usdBal.toFixed(2)} is too low — at least $${need.toFixed(2)} is needed to continue. Top up via 👛 Wallet, then tap ▶️ Resume.`, lowBalance: true }
    }
  }

  const claim = await _collection.updateOne({ id: campaignId, status: 'paused' }, { $set: { status: 'running', resumedAt: new Date() }, $unset: { pausedReason: '' } })
  if (claim.modifiedCount !== 1) return { error: 'Campaign status changed — please try again.' }

  if (activeCampaigns[campaignId]) {
    activeCampaigns[campaignId].paused = false
  } else {
    // Paused before a restart: settle in-flight bookkeeping the same way recovery does.
    const { kept } = await resetInflightLeads(campaignId, campaign.leads, provider)
    activeCampaigns[campaignId] = { activeCalls: kept, nextLeadIndex: 0, paused: false }
  }
  log(`[BulkCall] Campaign ${campaignId} resumed`)

  const firing = fireNextBatch(campaignId)
  if (provider === 'telnyx') firing.catch(e => log(`[BulkCall] Resume batch error for ${campaignId}: ${e.message}`))
  else await firing
  return { success: true }
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
  MAX_CALLER_POOL,
  initBulkCallService,
  generateReportFile,
  notInService,
  removeNotInService,
  
  registerRoutes,
  recoverRunningCampaigns,
  stopDialing,
  resumeDialing,
  releaseDialer,
  dialerStatus,
  checkLowLines,
  refusedNote,
  parseLeadsFile,
  createCampaign,
  createSeries,
  startSeriesPart,
  partFundsError,
  dropSeriesRest,
  cancelSeriesAfter,
  MAX_SERIES_LEADS,
  MAX_UPLOAD_LEADS,
  MAX_SERIES_PARTS,
  startCampaign,
  launchDueScheduledCampaigns,
  sendFinalReport,
  spawnNextRun,
  stopRepeat,
  onDigitReceived,
  onCallStatusUpdate,
  onCallComplete,
  sweepStuckLeads,
  cancelCampaign,
  sendCancelledReport,
  pauseCampaign,
  resumeCampaign,
  estimateLeadsCost,
  leadRate,
  formatCampaignStatus,
  campaignControls,
  getCampaign,
  getUserCampaigns,
  isBulkCall,
  getCampaignMapping,
  callToCampaign,
  activeCampaigns,
  fireNextBatch,
  BULK_CALL_RATE,
  MAX_BULK_LEADS,
  BULK_CALL_MIN_WALLET,
}
