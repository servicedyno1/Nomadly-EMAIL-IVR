'use strict'
// Outbound IVR on the web, at parity with the bot's Quick IVR wizard: script templates, transfer or OTP collection,
// per-key menus, several numbers per call, saved setups (presets), recent numbers, redial, scheduling, menu stats,
// one free trial call and a saved voice. Calls run on the bot's outbound IVR engine (voice-service).
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const ivrOb = require('../ivr-outbound')
const { walletOps } = require('./wallet')
const { normPhone, E164, parseBackups } = require('./numbers')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const MAX_TARGETS = 10
const MAX_PRESETS = 20
const MIN_WALLET = 1
const KEYS = /^[0-9*#]$/
const uid = () => crypto.randomUUID()
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').slice(0, 200)

// Script templates (the bot's catalogue). Smart placeholders: auto = we generate, list = pick a preset reason.
function templates() {
  const cats = ivrOb.OUTBOUND_CATEGORIES.filter(c => c.key !== 'custom')
  return {
    categories: cats.map(c => ({ key: c.key, name: c.name, icon: c.icon })),
    templates: cats.flatMap(c => (ivrOb.OUTBOUND_TEMPLATES[c.key] || []).map(t => ({ key: t.key, category: c.key, name: t.name, text: t.text, placeholders: t.placeholders || ivrOb.extractPlaceholders(t.text), activeKeys: t.activeKeys || ['1'] }))),
    smart: Object.fromEntries(Object.entries(ivrOb.SMART_PLACEHOLDERS).map(([k, v]) => [k, { label: v.label, type: v.type, hint: v.hint || v.description || null, presets: v.presets || null }])),
  }
}

// Per-key menu for outbound calls: forward / message / one level of sub-menu (engine shape: submenu.greeting + .options).
function cleanMenu(menu, callerId) {
  const entries = Object.entries(menu || {})
  if (entries.length > 10) throw new Error('Up to 10 keys per menu.')
  const leaf = (o, where, allowSub) => {
    const action = String(o?.action || ''), label = String(o?.label || '').slice(0, 60)
    if (action === 'forward') {
      const to = normPhone(o.forwardTo)
      if (!E164.test(to)) throw new Error(`${where}: enter the forward number with country code, e.g. +14155550100.`)
      if (phoneConfig.isBlockedPrefix(to)) throw new Error(`${where}: ${to} is a blocked premium/satellite destination.`)
      if (to === callerId) throw new Error(`${where}: forward to a number other than your caller ID.`)
      return { action, forwardTo: to, label }
    }
    if (action === 'message') {
      const message = String(o.message || '').trim().slice(0, 500)
      if (!message) throw new Error(`${where}: type the message callers hear.`)
      return { action, message, label }
    }
    if (action === 'submenu' && allowSub) {
      const options = {}
      for (const [d, so] of Object.entries(o.options || {})) {
        if (!/^[0-9]$/.test(d)) throw new Error(`${where}: sub-menu keys must be 0-9.`)
        options[d] = leaf(so, `${where}, sub-key ${d}`, false)
      }
      if (!Object.keys(options).length) throw new Error(`${where}: add at least one sub-menu key.`)
      return { action, greeting: String(o.greeting || 'Please select an option.').trim().slice(0, 500), options, label }
    }
    throw new Error(`${where}: pick forward, message${allowSub ? ' or sub-menu' : ''}.`)
  }
  const out = {}
  for (const [d, o] of entries) {
    if (!/^[0-9]$/.test(d)) throw new Error(`Menu key "${d}" must be a single digit 0-9.`)
    out[d] = leaf(o, `Key ${d}`, true)
  }
  return out
}
function firstForward(menu) {
  for (const o of Object.values(menu || {})) {
    if (o.action === 'forward') return o.forwardTo
    if (o.action === 'submenu') for (const s of Object.values(o.options || {})) if (s.action === 'forward') return s.forwardTo
  }
  return null
}

function parseTargets(b) {
  const raw = Array.isArray(b.targets) ? b.targets : String(b.targets || b.to || '').split(/[,;\s]+/)
  const list = [...new Set(raw.map(x => { let d = String(x || '').replace(/[^\d+]/g, ''); if (/^\d{10}$/.test(d)) d = `+1${d}`; return normPhone(d) }).filter(Boolean))]
  return list
}

// ── Code collection (OTP) state for the app ───────────────────────────────────────────────────────────────
// Engine phases → one plain state the screens show; the last state is kept a while after the call is gone.
const PHASE = { initiated: 'calling', ringing: 'calling', otp_gathering: 'waiting_code', otp_hold: 'code', otp_confirmed: 'accepted', otp_failed: 'declined', otp_hungup: 'hung_up', otp_timeout: 'timeout', ended: 'ended', completed: 'ended' }
const OTP_HOLD_MS = 90000
const lastOtp = new Map()
function remember(ccid, st) {
  lastOtp.set(ccid, { ...st, at: Date.now() })
  for (const [k, v] of lastOtp) if (Date.now() - v.at > 30 * 60000) lastOtp.delete(k)
  return st
}

// Preview (dry-run) stand-in: rings, plays, then "collects" a code after ~11 s; Decline asks again.
const otpSim = (() => {
  const sims = new Map()
  const code = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  const notice = (s) => { try { require('./notify').push(s.chatId, `🔑 Code collected (preview)\nFrom: ${s.to}\nCode: ${s.code}\nAccept or decline it on the Quick IVR call page or right here.`, null, { kind: 'call', meta: { otp: { callControlId: s.id, to: s.to } } }) } catch (_) { /* inbox is optional */ } }
  return {
    has: (id) => sims.has(id),
    start(chatId, to, cfg) {
      const id = `sim-${uid()}`, now = Date.now()
      const s = { id, chatId: String(chatId), to, length: cfg.otp?.length || 6, max: 3, attempt: 1, startedAt: now, holdAt: now + 11000, code: null, decided: null, transferTo: cfg.transferTo || null }
      s.code = code(s.length)
      sims.set(id, s)
      setTimeout(() => notice(s), 11000).unref?.()
      for (const [k, v] of sims) if (now - v.startedAt > 30 * 60000) sims.delete(k)
      return id
    },
    get(id) { return sims.get(id) },
    phase(s) {
      const now = Date.now()
      if (s.decided) return s.decided
      if (now < s.startedAt + 3000) return 'calling'
      if (now < s.startedAt + 7000) return 'playing'
      if (now < s.holdAt) return 'waiting_code'
      return now < s.holdAt + OTP_HOLD_MS ? 'code' : 'timeout'
    },
    decide(id, action) {
      const s = sims.get(id)
      if (action === 'accept') s.decided = 'accepted'
      else if (action === 'hangup') s.decided = 'hung_up'
      else if (s.attempt < s.max) { s.attempt += 1; s.holdAt = Date.now() + 6000; s.code = code(s.length); setTimeout(() => notice(s), 6000).unref?.() }
      else s.decided = 'declined'
    },
  }
})()

const pubOtp = ({ chatId: _c, at: _a, ...st }) => st

function otpState(chatId, ccid, voiceService) {
  const sim = otpSim.get(ccid)
  if (sim) {
    if (sim.chatId !== String(chatId)) return null
    const state = otpSim.phase(sim)
    return { state, to: sim.to, code: state === 'code' || state === 'accepted' ? sim.code : null, length: sim.length, attempt: sim.attempt, maxAttempts: sim.max, holdEndsAt: state === 'code' ? new Date(sim.holdAt + OTP_HOLD_MS) : null, connectTo: sim.transferTo, preview: true }
  }
  const s = voiceService.outboundIvrCalls[ccid]
  if (!s) { const last = lastOtp.get(ccid); return last && last.chatId === String(chatId) ? { ...last, state: ['accepted', 'declined', 'hung_up', 'timeout'].includes(last.state) ? last.state : 'ended', holdEndsAt: null } : null }
  if (String(s.chatId) !== String(chatId) || s.ivrMode !== 'otp_collect') return null
  const state = PHASE[s.phase] || 'playing'
  return remember(ccid, { chatId: String(chatId), state, to: s.targetNumber, code: state === 'code' || state === 'accepted' ? s.otpDigits : null, length: s.otpLength || 6, attempt: s.otpAttempt || 1, maxAttempts: s.otpMaxAttempts || 3, holdEndsAt: state === 'code' && s.otpHoldStartedAt ? new Date(s.otpHoldStartedAt + OTP_HOLD_MS) : null, connectTo: s.ivrNumber || null, preview: false })
}

// Free-call status. Like the bot, it is used up only once someone answers (the call engine then sets state
// ivrTrialUsed_<id>); a started free call is held for TRIAL_HOLD_MS so it can't run twice at once.
const TRIAL_HOLD_MS = 5 * 60000
async function trialStatus(db, numbersApi, chatId) {
  const [p, st, nums] = await Promise.all([
    db.collection('webPrefs').findOne({ _id: chatId }),
    db.collection('state').findOne({ _id: `ivrTrialUsed_${chatId}` }),
    numbersApi.myNumbers(chatId),
  ])
  const hasCaller = nums.some(n => n.status === 'active' && n.provider === 'telnyx' && phoneConfig.canAccessFeature(n.plan, 'ivrOutbound'))
  const used = !!p?.ivrTrialUsed || st?.val === true
  const heldUntil = p?.ivrTrialPendingAt ? new Date(p.ivrTrialPendingAt).getTime() + TRIAL_HOLD_MS : 0
  const inProgress = !used && heldUntil > Date.now()
  return { available: !used && !hasCaller, used, inProgress, retryAt: inProgress ? new Date(heldUntil) : null, callerId: ivrOb.TRIAL_CALLER_ID }
}

function routes(router, { db, h, numbersApi, audioLibraryService, voiceService, ttsService, log = console.log }) {
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const prefs = db.collection('webPrefs')
  const history = db.collection('webQuickCalls')
  const scheduled = db.collection('scheduledCalls')
  history.createIndex({ chatId: 1, at: -1 }).catch(() => {})
  const getPrefs = async (chatId) => (await prefs.findOne({ _id: chatId })) || {}
  const businessTier = (plan) => phoneConfig.canAccessFeature(plan, 'ivrRedial') // Business-only outbound extras

  // Validates a call request → { cfg } or { err: [status, code, message] }. `trial` uses the shared demo caller ID.
  async function buildCall(chatId, b, { trial = false } = {}) {
    let caller = null
    if (!trial) {
      caller = await numbersApi.findMine(chatId, b.callerId)
      if (!caller || caller.status !== 'active') return { err: [400, 'invalid_caller', 'Pick one of your active numbers as caller ID.'] }
      if (caller.provider !== 'telnyx') return { err: [400, 'invalid_caller', 'This number cannot place outbound IVR calls.'] }
      if (!phoneConfig.canAccessFeature(caller.plan, 'ivrOutbound')) return { err: [403, 'plan_upgrade_required', 'Quick IVR calls need the Pro plan or higher on the caller number.'] }
    }
    const callerId = trial ? ivrOb.TRIAL_CALLER_ID : caller.phoneNumber
    const targets = parseTargets(b)
    if (!targets.length) return { err: [400, 'invalid_number', 'Enter the number to call with country code, e.g. +14155550100.'] }
    if (targets.length > (trial ? 1 : MAX_TARGETS)) return { err: [400, 'too_many_numbers', trial ? 'The free call goes to one number.' : `Up to ${MAX_TARGETS} numbers per Quick IVR call — use a campaign for more.`] }
    for (const t of targets) {
      if (!E164.test(t)) return { err: [400, 'invalid_number', `${t} is not a valid number. Use the country code, e.g. +14155550100.`] }
      if (phoneConfig.isBlockedPrefix(t)) return { err: [400, 'blocked_destination', `${t} is a blocked premium/satellite destination.`] }
      if (t === callerId) return { err: [400, 'same_number', 'You cannot call your own caller ID.'] }
    }
    let audio = null, text = null
    if (b.audioId && !trial) {
      const a = await audioLibraryService.getAudio(String(b.audioId))
      if (!a || a.chatId !== String(chatId)) return { err: [400, 'invalid_audio', 'Pick a message from your audio library.'] }
      audio = a
    } else {
      text = String(b.text || '').trim().slice(0, 1500)
      if (!text) return { err: [400, 'invalid_message', 'Pick a template, type a script or choose audio from your library.'] }
      const unfilled = ivrOb.validateFilled(text).unfilled || []
      if (unfilled.length) return { err: [400, 'unfilled_placeholders', `Fill in: ${unfilled.map(u => `[${u}]`).join(', ')}.`] }
    }
    // Spoken scripts use the picked voice, else the account's saved default voice.
    const voiceKey = String(b.voice || (await getPrefs(chatId)).ttsVoice || '').toLowerCase()
    const voiceName = text && ttsService?.ALL_VOICES?.[voiceKey] ? voiceKey : null
    const mode = b.mode === 'otp' ? 'otp' : 'transfer'
    let menu = null, transferTo = null, otp = null, activeKeys = ['1'], transferBackups = []
    if (mode === 'otp') {
      if (!trial && !phoneConfig.canAccessFeature(caller.plan, 'otpCollection')) return { err: [403, 'plan_upgrade_required', 'OTP collection needs the Pro plan or higher on the caller number.'] }
      const length = parseInt(b.otp?.length, 10) || 6
      if (length < 4 || length > 10) return { err: [400, 'invalid_otp_length', 'Codes can be 4 to 10 digits.'] }
      const custom = !trial && phoneConfig.canAccessFeature(caller.plan, 'otpCustomMessages')
      otp = { length, confirmMsg: custom ? String(b.otp?.confirmMsg || '').trim().slice(0, 300) || null : null, rejectMsg: custom ? String(b.otp?.rejectMsg || '').trim().slice(0, 300) || null : null }
      if (String(b.transferTo || '').trim()) {
        transferTo = normPhone(b.transferTo)
        if (!E164.test(transferTo)) return { err: [400, 'invalid_transfer', 'Enter the number to connect with country code, e.g. +14155550100.'] }
        if (phoneConfig.isBlockedPrefix(transferTo)) return { err: [400, 'invalid_transfer', `${transferTo} is a blocked premium/satellite destination.`] }
        if (transferTo === callerId) return { err: [400, 'invalid_transfer', 'The number to connect must differ from the caller ID.'] }
      }
    } else if (b.menu && Object.keys(b.menu).length) {
      if (trial) return { err: [400, 'trial_transfer_only', 'The free call transfers on key 1.'] }
      try { menu = cleanMenu(b.menu, callerId) } catch (e) { return { err: [400, 'invalid_menu', e.message] } }
      activeKeys = Object.keys(menu)
    } else {
      transferTo = normPhone(b.transferTo)
      if (!E164.test(transferTo)) return { err: [400, 'invalid_transfer', 'Enter the transfer number with country code, e.g. +14155550100.'] }
      if (phoneConfig.isBlockedPrefix(transferTo)) return { err: [400, 'invalid_transfer', `${transferTo} is a blocked premium/satellite destination.`] }
      if (transferTo === callerId) return { err: [400, 'invalid_transfer', 'The transfer number must differ from the caller ID.'] }
      const bk = parseBackups(b.transferBackups, [transferTo, callerId])
      if (bk.error) return { err: [400, 'invalid_backup', bk.error] }
      transferBackups = bk.list
      if (!trial) activeKeys = [...new Set((Array.isArray(b.activeKeys) ? b.activeKeys : ['1']).map(String))].filter(k => KEYS.test(k))
      if (!activeKeys.length) activeKeys = ['1']
    }
    return {
      cfg: {
        callerId, callerPlan: caller?.plan || null, targets, mode, menu, transferTo, transferBackups, otp, activeKeys, holdMusic: !!b.holdMusic && !trial,
        audioId: audio?.id || null, audioUrl: audio?.audioUrl || null, text, voiceName, templateName: String(b.templateName || audio?.name || 'Custom script').slice(0, 80),
      },
    }
  }

  const rateOf = (cfg) => Math.max(...cfg.targets.map(t => voiceService.getIvrCallRate(t)), cfg.transferTo ? voiceService.getIvrCallRate(cfg.transferTo) : 0)
  const engineParams = (chatId, cfg, to, trial) => ({
    chatId, callerId: cfg.callerId, targetNumber: to, ivrNumber: cfg.menu ? firstForward(cfg.menu) : cfg.transferTo || null, transferBackups: cfg.menu || cfg.mode === 'otp' ? [] : (cfg.transferBackups || []), menu: cfg.menu,
    audioUrl: cfg.audioUrl, greetingText: cfg.audioUrl ? null : cfg.text, voiceName: cfg.voiceName || undefined, activeKeys: cfg.activeKeys, templateName: cfg.templateName,
    holdMusic: cfg.holdMusic, provider: 'telnyx', isTrial: !!trial, ivrMode: cfg.mode === 'otp' ? 'otp_collect' : 'transfer',
    otpLength: cfg.otp?.length || 6, otpMaxAttempts: 3, otpConfirmMsg: cfg.otp?.confirmMsg || null, otpRejectMsg: cfg.otp?.rejectMsg || null,
  })
  const publicCall = (d) => ({ id: d._id, at: d.at, callerId: d.cfg.callerId, targets: d.cfg.targets, mode: d.cfg.mode, templateName: d.cfg.templateName, hasMenu: !!d.cfg.menu, transferTo: d.cfg.transferTo, results: d.results || [], dryRun: !!d.dryRun, trial: !!d.trial, scheduledFor: d.scheduledFor || null })

  // Places (or validates, in preview) the call to every target; records it for Recent / Redial.
  async function run(chatId, body, cfg, { trial = false } = {}) {
    const rate = rateOf(cfg)
    if (!trial) {
      const bal = await w.balance(chatId)
      if (bal < Math.max(MIN_WALLET, rate)) return { status: 402, body: { error: 'insufficient_balance', message: `Quick IVR calls bill about $${rate.toFixed(2)}/min from your wallet. Your balance is $${bal.toFixed(2)} — top up first.` } }
    }
    const doc = { _id: uid(), chatId, at: new Date(), body: { ...body, scheduleAt: undefined }, cfg, trial, dryRun: dryRun() }
    if (dryRun()) {
      doc.results = cfg.targets.map(to => ({ to, ok: true, preview: true, callControlId: cfg.mode === 'otp' ? otpSim.start(chatId, to, cfg) : null }))
      await history.insertOne(doc)
      const what = cfg.mode === 'otp' ? `ask for a ${cfg.otp.length}-digit code` : cfg.menu ? `route keys ${Object.keys(cfg.menu).join(', ')}` : `transfer to ${cfg.transferTo} on key ${cfg.activeKeys.join('/')}`
      return { status: 202, body: { dryRun: true, rate, count: cfg.targets.length, callId: doc._id, results: doc.results, mode: cfg.mode, message: `Preview mode: ${cfg.targets.length} call(s) validated (${what}) but not dialed.${cfg.mode === 'otp' ? ' A simulated call below lets you try Accept / Decline.' : ''}` } }
    }
    const results = []
    for (const to of cfg.targets) {
      const r = await voiceService.initiateOutboundIvrCall(engineParams(chatId, cfg, to, trial)).catch(e => ({ error: e.message }))
      results.push({ to, ok: !r?.error, error: r?.error ? strip(r.error) : null, callControlId: r?.callControlId || null })
    }
    doc.results = results
    await history.insertOne(doc)
    log(`[CloudIVR-Web] quick IVR ${cfg.callerId} → ${cfg.targets.join(',')} (${cfg.mode}${cfg.menu ? '+menu' : ''}) by ${chatId}`)
    const ok = results.filter(r => r.ok).length
    if (!ok) return { status: 424, body: { error: 'call_failed', message: results[0]?.error || 'The call could not be started.', results } }
    return { status: 201, body: { started: ok, results, rate, callId: doc._id, mode: cfg.mode } }
  }

  router.get('/outbound/templates', (req, res) => res.json(templates()))
  router.post('/outbound/fill', h(async (req, res) => {
    const names = (Array.isArray(req.body.names) ? req.body.names : []).slice(0, 20).map(String)
    res.json({ values: Object.fromEntries(names.map(n => [n, ivrOb.generatePlaceholderValue(n)]).filter(([, v]) => v)) })
  }))

  router.post('/calls/quick', h(async (req, res) => {
    const chatId = req.webChatId
    const { cfg, err } = await buildCall(chatId, req.body)
    if (err) return bad(res, ...err)
    if (req.body.scheduleAt) {
      const at = new Date(req.body.scheduleAt)
      if (isNaN(at.getTime()) || at.getTime() < Date.now() + 4 * 60000 || at.getTime() > Date.now() + 86400000) return bad(res, 400, 'invalid_schedule', 'Schedule between 5 minutes and 24 hours from now.')
      const docs = cfg.targets.map(to => ({
        _id: uid(), chatId, web: true, scheduledAt: at, createdAt: new Date(), status: dryRun() ? 'preview' : 'pending',
        ivrObData: { ...engineParams(chatId, cfg, to, false), targetNumber: to, callerProvider: 'telnyx' },
      }))
      await scheduled.insertMany(docs)
      return res.status(201).json({ scheduled: docs.length, scheduledFor: at, dryRun: dryRun(), message: dryRun() ? 'Preview mode: saved to your schedule but it will not dial.' : null })
    }
    const r = await run(chatId, req.body, cfg)
    res.status(r.status).json(r.body)
  }))

  router.get('/calls/scheduled', h(async (req, res) => {
    // Preview-mode entries never dial; once their time passes they count as done.
    await scheduled.updateMany({ chatId: req.webChatId, web: true, status: 'preview', scheduledAt: { $lt: new Date() } }, { $set: { status: 'completed', previewOnly: true } })
    const list = await scheduled.find({ chatId: req.webChatId, web: true }).sort({ scheduledAt: -1 }).limit(30).toArray()
    res.json({ calls: list.map(s => ({ id: s._id, scheduledFor: s.scheduledAt, status: s.status, to: s.ivrObData?.targetNumber, callerId: s.ivrObData?.callerId, templateName: s.ivrObData?.templateName, error: s.error ? strip(s.error) : null })) })
  }))
  router.delete('/calls/scheduled/:id', h(async (req, res) => {
    const r = await scheduled.updateOne({ _id: String(req.params.id), chatId: req.webChatId, status: { $in: ['pending', 'preview'] } }, { $set: { status: 'cancelled', cancelledAt: new Date() } })
    if (!r.modifiedCount) return bad(res, 404, 'not_found', 'That scheduled call is not waiting any more.')
    res.json({ cancelled: true })
  }))

  router.get('/calls/history', h(async (req, res) => {
    const list = await history.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()
    res.json({ calls: list.map(publicCall) })
  }))
  router.get('/calls/recent', h(async (req, res) => {
    const list = await history.find({ chatId: req.webChatId, trial: { $ne: true } }).sort({ at: -1 }).limit(50).toArray()
    res.json({ numbers: [...new Set(list.flatMap(d => d.cfg.targets))].slice(0, 10) })
  }))
  router.post('/calls/history/:id/redial', h(async (req, res) => {
    const prev = await history.findOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!prev || prev.trial) return bad(res, 404, 'not_found', 'Call not found.')
    const { cfg, err } = await buildCall(req.webChatId, prev.body)
    if (err) return bad(res, ...err)
    if (!businessTier(cfg.callerPlan)) return bad(res, 403, 'plan_upgrade_required', 'Redial is on the Business plan.')
    const r = await run(req.webChatId, prev.body, cfg)
    res.status(r.status).json(r.body)
  }))

  // Presets: a saved call setup (everything except the numbers to call). Business plan.
  router.get('/calls/presets', h(async (req, res) => res.json({ presets: (await getPrefs(req.webChatId)).ivrPresets || [] })))
  router.post('/calls/presets', h(async (req, res) => {
    const chatId = req.webChatId, name = String(req.body.name || '').trim().slice(0, 40)
    if (!name) return bad(res, 400, 'invalid_name', 'Name the preset.')
    const setup = { ...(req.body.setup || {}) }
    delete setup.targets; delete setup.to; delete setup.scheduleAt
    const { cfg, err } = await buildCall(chatId, { ...setup, to: '+14155550100' })
    if (err) return bad(res, ...err)
    const list = ((await getPrefs(chatId)).ivrPresets || []).filter(p => p.name.toLowerCase() !== name.toLowerCase())
    if (list.length >= MAX_PRESETS) return bad(res, 400, 'too_many_presets', `Up to ${MAX_PRESETS} presets — delete one first.`)
    const preset = { id: uid(), name, setup, hasMenu: !!cfg.menu, mode: cfg.mode, menu: cfg.menu, createdAt: new Date() }
    await prefs.updateOne({ _id: chatId }, { $set: { ivrPresets: [preset, ...list], updatedAt: new Date() } }, { upsert: true })
    res.status(201).json({ preset })
  }))
  router.delete('/calls/presets/:id', h(async (req, res) => {
    const list = (await getPrefs(req.webChatId)).ivrPresets || []
    const next = list.filter(p => p.id !== String(req.params.id))
    if (next.length === list.length) return bad(res, 404, 'not_found', 'Preset not found.')
    await prefs.updateOne({ _id: req.webChatId }, { $set: { ivrPresets: next } })
    res.json({ deleted: true })
  }))

  router.get('/calls/menu-stats', h(async (req, res) => res.json(await voiceService.getOutboundMenuAnalytics(String(req.webChatId), 30))))

  // Code collection: live state of a call and the Accept / Decline / Hang up decision (bot: Confirm / Reject / Hang up).
  router.get('/calls/otp/:ccid', h(async (req, res) => {
    const st = otpState(req.webChatId, String(req.params.ccid), voiceService)
    if (!st) return bad(res, 404, 'not_found', 'That call is not available any more.')
    res.json(pubOtp(st))
  }))
  router.post('/calls/otp/:ccid', h(async (req, res) => {
    const ccid = String(req.params.ccid), action = String(req.body?.action || '')
    if (!['accept', 'decline', 'hangup'].includes(action)) return bad(res, 400, 'invalid_action', 'Choose accept, decline or hang up.')
    const st = otpState(req.webChatId, ccid, voiceService)
    if (!st) return bad(res, 404, 'not_found', 'That call is not available any more.')
    if (st.state !== 'code') return bad(res, 409, 'not_waiting', 'This call is not waiting for your answer any more.')
    if (otpSim.has(ccid)) otpSim.decide(ccid, action)
    else {
      const r = await voiceService.resolveOtp(ccid, action)
      if (r?.error) return bad(res, 409, 'not_waiting', 'This call is not waiting for your answer any more.')
    }
    res.json(pubOtp(otpState(req.webChatId, ccid, voiceService)))
  }))

  // One free Quick IVR call from our shared number for accounts without a calling number (the bot's "Quick IVR Call — 1 Free").
  const busyMsg = 'Your free call is still going. If nobody answered, you can try again in a few minutes.'
  router.get('/calls/trial', h(async (req, res) => res.json(await trialStatus(db, numbersApi, req.webChatId))))
  router.post('/calls/trial', h(async (req, res) => {
    const chatId = req.webChatId
    const t = await trialStatus(db, numbersApi, chatId)
    if (!t.available) return bad(res, 403, 'trial_used', 'The free Quick IVR call is for accounts without a calling number, once.')
    if (t.inProgress) return bad(res, 409, 'trial_in_progress', busyMsg)
    const { cfg, err } = await buildCall(chatId, req.body, { trial: true })
    if (err) return bad(res, ...err)
    const now = new Date()
    const claim = await prefs.updateOne({ _id: chatId, ivrTrialUsed: { $ne: true }, $or: [{ ivrTrialPendingAt: null }, { ivrTrialPendingAt: { $lt: new Date(now - TRIAL_HOLD_MS) } }] }, { $set: { ivrTrialPendingAt: now } }, { upsert: true }).catch(() => ({ modifiedCount: 0, upsertedCount: 0 }))
    if (!claim.modifiedCount && !claim.upsertedCount) return bad(res, 409, 'trial_in_progress', busyMsg)
    const r = await run(chatId, req.body, cfg, { trial: true })
    if (r.status >= 400) await prefs.updateOne({ _id: chatId }, { $unset: { ivrTrialPendingAt: '' } })
    else if (dryRun()) await prefs.updateOne({ _id: chatId }, { $set: { ivrTrialUsed: true, ivrTrialAt: now }, $unset: { ivrTrialPendingAt: '' } })
    res.status(r.status).json({ ...r.body, trial: await trialStatus(db, numbersApi, chatId) })
  }))

  // Saved voice + speed for every new AI voice message (Business "consistent voice").
  router.get('/prefs/voice', h(async (req, res) => {
    const p = await getPrefs(req.webChatId)
    res.json({ voice: p.ttsVoice || null, speed: p.ttsSpeed || null, canSave: (await numbersApi.myNumbers(req.webChatId)).some(n => n.status === 'active' && businessTier(n.plan)) })
  }))
  router.put('/prefs/voice', h(async (req, res) => {
    const nums = await numbersApi.myNumbers(req.webChatId)
    if (!nums.some(n => n.status === 'active' && businessTier(n.plan))) return bad(res, 403, 'plan_upgrade_required', 'Saving a default voice is on the Business plan.')
    const voice = req.body.voice ? String(req.body.voice).slice(0, 40) : null
    const speed = req.body.speed ? Math.min(1.5, Math.max(0.5, Number(req.body.speed) || 1)) : null
    await prefs.updateOne({ _id: req.webChatId }, { $set: { ttsVoice: voice, ttsSpeed: speed, updatedAt: new Date() } }, { upsert: true })
    res.json({ voice, speed })
  }))
}

module.exports = { routes, templates, cleanMenu, firstForward, parseTargets, trialStatus }
