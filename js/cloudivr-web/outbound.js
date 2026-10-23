'use strict'
// Outbound IVR on the web, at parity with the bot's Quick IVR wizard: script templates, transfer or OTP collection,
// per-key menus, several numbers per call, saved setups (presets), recent numbers, redial, scheduling, menu stats,
// one free trial call and a saved voice. Calls run on the bot's outbound IVR engine (voice-service).
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const ivrOb = require('../ivr-outbound')
const { walletOps } = require('./wallet')
const { normPhone, E164 } = require('./numbers')

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

function routes(router, { db, h, numbersApi, audioLibraryService, voiceService, ttsService, log = console.log }) {
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const prefs = db.collection('webPrefs')
  const history = db.collection('webQuickCalls')
  const scheduled = db.collection('scheduledCalls')
  history.createIndex({ chatId: 1, at: -1 }).catch(() => {})
  const getPrefs = async (chatId) => (await prefs.findOne({ _id: chatId })) || {}
  const businessTier = (plan) => phoneConfig.canAccessFeature(plan, 'ivrRedial') // Business-only outbound extras
  const eligible = async (chatId) => (await numbersApi.myNumbers(chatId)).filter(n => n.status === 'active' && n.provider === 'telnyx' && phoneConfig.canAccessFeature(n.plan, 'ivrOutbound'))

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
    let menu = null, transferTo = null, otp = null, activeKeys = ['1']
    if (mode === 'otp') {
      if (trial) return { err: [400, 'trial_transfer_only', 'The free call uses transfer mode.'] }
      if (!phoneConfig.canAccessFeature(caller.plan, 'otpCollection')) return { err: [403, 'plan_upgrade_required', 'OTP collection needs the Pro plan or higher on the caller number.'] }
      const length = parseInt(b.otp?.length, 10) || 6
      if (length < 4 || length > 10) return { err: [400, 'invalid_otp_length', 'Codes can be 4 to 10 digits.'] }
      const custom = phoneConfig.canAccessFeature(caller.plan, 'otpCustomMessages')
      otp = { length, confirmMsg: custom ? String(b.otp?.confirmMsg || '').trim().slice(0, 300) || null : null, rejectMsg: custom ? String(b.otp?.rejectMsg || '').trim().slice(0, 300) || null : null }
    } else if (b.menu && Object.keys(b.menu).length) {
      if (trial) return { err: [400, 'trial_transfer_only', 'The free call transfers on key 1.'] }
      try { menu = cleanMenu(b.menu, callerId) } catch (e) { return { err: [400, 'invalid_menu', e.message] } }
      activeKeys = Object.keys(menu)
    } else {
      transferTo = normPhone(b.transferTo)
      if (!E164.test(transferTo)) return { err: [400, 'invalid_transfer', 'Enter the transfer number with country code, e.g. +14155550100.'] }
      if (phoneConfig.isBlockedPrefix(transferTo)) return { err: [400, 'invalid_transfer', `${transferTo} is a blocked premium/satellite destination.`] }
      if (transferTo === callerId) return { err: [400, 'invalid_transfer', 'The transfer number must differ from the caller ID.'] }
      if (!trial) activeKeys = [...new Set((Array.isArray(b.activeKeys) ? b.activeKeys : ['1']).map(String))].filter(k => KEYS.test(k))
      if (!activeKeys.length) activeKeys = ['1']
    }
    return {
      cfg: {
        callerId, callerPlan: caller?.plan || null, targets, mode, menu, transferTo, otp, activeKeys, holdMusic: !!b.holdMusic && !trial,
        audioId: audio?.id || null, audioUrl: audio?.audioUrl || null, text, voiceName, templateName: String(b.templateName || audio?.name || 'Custom script').slice(0, 80),
      },
    }
  }

  const rateOf = (cfg) => Math.max(...cfg.targets.map(t => voiceService.getIvrCallRate(t)), cfg.transferTo ? voiceService.getIvrCallRate(cfg.transferTo) : 0)
  const engineParams = (chatId, cfg, to, trial) => ({
    chatId, callerId: cfg.callerId, targetNumber: to, ivrNumber: cfg.menu ? firstForward(cfg.menu) : cfg.transferTo, menu: cfg.menu,
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
      doc.results = cfg.targets.map(to => ({ to, ok: true, preview: true }))
      await history.insertOne(doc)
      const what = cfg.mode === 'otp' ? `ask for a ${cfg.otp.length}-digit code` : cfg.menu ? `route keys ${Object.keys(cfg.menu).join(', ')}` : `transfer to ${cfg.transferTo} on key ${cfg.activeKeys.join('/')}`
      return { status: 202, body: { dryRun: true, rate, count: cfg.targets.length, callId: doc._id, message: `Preview mode: ${cfg.targets.length} call(s) validated (${what}) but not dialed.` } }
    }
    const results = []
    for (const to of cfg.targets) {
      const r = await voiceService.initiateOutboundIvrCall(engineParams(chatId, cfg, to, trial)).catch(e => ({ error: e.message }))
      results.push({ to, ok: !r?.error, error: r?.error ? strip(r.error) : null })
    }
    doc.results = results
    await history.insertOne(doc)
    log(`[CloudIVR-Web] quick IVR ${cfg.callerId} → ${cfg.targets.join(',')} (${cfg.mode}${cfg.menu ? '+menu' : ''}) by ${chatId}`)
    const ok = results.filter(r => r.ok).length
    if (!ok) return { status: 424, body: { error: 'call_failed', message: results[0]?.error || 'The call could not be started.', results } }
    return { status: 201, body: { started: ok, results, rate, callId: doc._id } }
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
      if (!businessTier(cfg.callerPlan)) return bad(res, 403, 'plan_upgrade_required', 'Scheduling calls is on the Business plan.')
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
    if (!businessTier(cfg.callerPlan)) return bad(res, 403, 'plan_upgrade_required', 'Saved presets are on the Business plan.')
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

  // One free trial call for accounts without a calling number yet (same offer as the bot's "Quick IVR Call — 1 Free").
  const trialAvailable = async (chatId) => !(await getPrefs(chatId)).ivrTrialUsed && !(await eligible(chatId)).length
  router.get('/calls/trial', h(async (req, res) => res.json({ available: await trialAvailable(req.webChatId) })))
  router.post('/calls/trial', h(async (req, res) => {
    const chatId = req.webChatId
    if (!(await trialAvailable(chatId))) return bad(res, 403, 'trial_used', 'The free trial call is for accounts without a calling number, once.')
    const { cfg, err } = await buildCall(chatId, req.body, { trial: true })
    if (err) return bad(res, ...err)
    const claim = await prefs.updateOne({ _id: chatId, ivrTrialUsed: { $ne: true } }, { $set: { ivrTrialUsed: true, ivrTrialAt: new Date() } }, { upsert: true }).catch(() => ({ modifiedCount: 0, upsertedCount: 0 }))
    if (!claim.modifiedCount && !claim.upsertedCount) return bad(res, 403, 'trial_used', 'The free trial call was already used.')
    const r = await run(chatId, req.body, cfg, { trial: true })
    if (r.status >= 400) await prefs.updateOne({ _id: chatId }, { $set: { ivrTrialUsed: false } })
    res.status(r.status).json(r.body)
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

module.exports = { routes, templates, cleanMenu, firstForward, parseTargets }
