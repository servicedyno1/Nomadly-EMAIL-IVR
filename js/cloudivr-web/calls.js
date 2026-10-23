'use strict'
// Outbound IVR: one-off Quick IVR calls and Bulk IVR campaigns, run by the bot's voice + bulk-call engines.
const phoneConfig = require('../phone-config')
const { walletOps } = require('./wallet')
const { normPhone, E164 } = require('./numbers')
const { spokenNumber } = require('../voicemail-greeting')
const { cleanMenu, firstForward } = require('./outbound')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const QUICK_MIN_WALLET = 1
const KEYS = /^[0-9*#]$/

const publicCampaign = (c, withLeads = false) => ({
  id: c.id, callerId: c.callerId, audioName: c.audioName, mode: c.menu ? 'menu' : c.mode, menu: c.menu || null, transferNumber: c.transferNumber, activeKeys: c.activeKeys,
  concurrency: c.concurrency, status: c.status, stats: c.stats, scheduledFor: c.scheduledFor, startedAt: c.startedAt, completedAt: c.completedAt,
  createdAt: c.createdAt, cancelledReason: c.cancelledReason || null, pausedReason: c.pausedReason || null, dryRun: !!c.dryRun,
  ...(withLeads ? { leads: (c.leads || []).slice(0, 500).map(l => ({ number: l.number, name: l.name, status: l.status, digitPressed: l.digitPressed, transferred: !!l.transferred, duration: l.duration || 0, hangupCause: l.hangupCause || null })) } : {}),
})

function routes(router, { db, h, numbersApi, audioLibraryService, voiceService, bulkCallService, log = console.log }) {
  const w = walletOps(db)
  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  // Caller ID must be one of the account's active Telnyx numbers on a plan with the feature.
  async function caller(chatId, phone, feature, label) {
    const n = await numbersApi.findMine(chatId, phone)
    if (!n || n.status !== 'active') return { err: [400, 'invalid_caller', 'Pick one of your active numbers as caller ID.'] }
    if (n.provider !== 'telnyx') return { err: [400, 'invalid_caller', 'This number cannot place outbound IVR calls.'] }
    if (!phoneConfig.canAccessFeature(n.plan, feature)) return { err: [403, 'plan_upgrade_required', `${label} needs the Pro plan or higher on the caller number.`] }
    return { n }
  }
  async function ownAudio(chatId, id) {
    const a = id ? await audioLibraryService.getAudio(String(id)) : null
    return a && a.chatId === String(chatId) ? a : null
  }
  function keysOf(body) {
    const keys = [...new Set((Array.isArray(body.activeKeys) ? body.activeKeys : ['1']).map(String))].filter(k => KEYS.test(k))
    return keys.length ? keys : ['1']
  }
  function transferTo(body, num) {
    const to = normPhone(body.transferTo)
    if (!E164.test(to)) return { err: 'Enter the transfer number with country code, e.g. +14155550100.' }
    if (phoneConfig.isBlockedPrefix(to)) return { err: `${to} is a blocked premium/satellite destination.` }
    if (to === num) return { err: 'The transfer number must differ from the caller ID.' }
    return { to }
  }

  // Quick IVR calls live in outbound.js. Call me first: we ring the owner's own phone from their CloudIVR number; pressing 1 connects them to `to`, who
  // sees the CloudIVR number. Runs on the outbound IVR engine; both legs bill per minute (plan minutes first).
  const prefs = db.collection('webPrefs')
  router.get('/calls/callback', h(async (req, res) => {
    const p = await prefs.findOne({ _id: req.webChatId })
    res.json({ myPhone: p?.callbackPhone || '' })
  }))
  router.post('/calls/callback', h(async (req, res) => {
    const chatId = req.webChatId
    const c = await caller(chatId, req.body.callerId, 'ivrOutbound', 'Call me first')
    if (c.err) return bad(res, ...c.err)
    const me = normPhone(req.body.myPhone), to = normPhone(req.body.to)
    if (!E164.test(me)) return bad(res, 400, 'invalid_my_phone', 'Enter your mobile number with country code, e.g. +14155550100.')
    if (!E164.test(to)) return bad(res, 400, 'invalid_number', 'Enter the number to call with country code, e.g. +14155550100.')
    for (const [n, label] of [[me, 'Your mobile'], [to, 'The number to call']]) {
      if (phoneConfig.isBlockedPrefix(n)) return bad(res, 400, 'blocked_destination', `${label} (${n}) is a blocked premium/satellite destination.`)
    }
    if (me === c.n.phoneNumber || to === c.n.phoneNumber) return bad(res, 400, 'same_number', 'Use numbers other than your CloudIVR number.')
    if (me === to) return bad(res, 400, 'same_number', 'Your mobile and the number to call must be different.')
    const rateMe = voiceService.getIvrCallRate(me), rateTo = voiceService.getIvrCallRate(to)
    const rate = Math.round((rateMe + rateTo) * 100) / 100
    const bal = await w.balance(chatId)
    if (bal < Math.max(QUICK_MIN_WALLET, rate)) return bad(res, 402, 'insufficient_balance', `Call me first bills both calls — about $${rate.toFixed(2)}/min together after your plan minutes. Your balance is $${bal.toFixed(2)} — top up first.`)
    await prefs.updateOne({ _id: chatId }, { $set: { callbackPhone: me, updatedAt: new Date() } }, { upsert: true })
    if (dryRun()) return res.status(202).json({ dryRun: true, rate, message: `Preview mode: we would ring ${me}, and after you press 1 connect you to ${to} showing ${c.n.phoneNumber}. Nothing was dialed.` })
    const greetingText = `This is your CloudIVR line. Press 1 to call ${spokenNumber(to)}. To cancel, just hang up.`
    const r = await voiceService.initiateOutboundIvrCall({ chatId, callerId: c.n.phoneNumber, targetNumber: me, ivrNumber: to, greetingText, activeKeys: ['1'], ivrMode: 'transfer', templateName: 'Call me first', holdMusic: false, provider: 'telnyx' })
    if (r?.error) return bad(res, 424, 'call_failed', String(r.error).replace(/<[^>]+>/g, '').slice(0, 200))
    log(`[CloudIVR-Web] call-me-first ${c.n.phoneNumber}: ${me} → ${to} by ${chatId}`)
    res.status(201).json({ started: true, callId: r?.callControlId || null, rate })
  }))

  router.post('/campaigns/estimate', h(async (req, res) => {
    const { leads, errors } = bulkCallService.parseLeadsFile(String(req.body.leads || ''))
    res.json({ count: leads.length, errors: errors.slice(0, 20), max: bulkCallService.MAX_BULK_LEADS, minWallet: bulkCallService.BULK_CALL_MIN_WALLET, estimate: bulkCallService.estimateLeadsCost(leads) })
  }))

  router.get('/campaigns', h(async (req, res) => {
    res.json({ campaigns: (await bulkCallService.getUserCampaigns(req.webChatId, 50)).map(c => publicCampaign(c)) })
  }))

  router.post('/campaigns', h(async (req, res) => {
    const chatId = req.webChatId, b = req.body
    const c = await caller(chatId, b.callerId, 'bulkCall', 'Bulk IVR campaigns')
    if (c.err) return bad(res, ...c.err)
    const audio = await ownAudio(chatId, b.audioId)
    if (!audio) return bad(res, 400, 'invalid_audio', 'Pick the campaign message from your audio library.')
    const vm = b.voicemailAudioId ? await ownAudio(chatId, b.voicemailAudioId) : null
    if (b.voicemailAudioId && !vm) return bad(res, 400, 'invalid_audio', 'Pick the voicemail drop from your audio library.')
    const { leads, errors } = bulkCallService.parseLeadsFile(String(b.leads || ''))
    if (!leads.length) return bad(res, 400, 'no_leads', errors[0] || 'Add at least one number to call (one per line, optional ",name").')
    if (leads.length > bulkCallService.MAX_BULK_LEADS) return bad(res, 400, 'too_many_leads', `Maximum ${bulkCallService.MAX_BULK_LEADS} numbers per campaign.`)
    // 'menu' = route each key (forward / message / sub-menu); the engine runs it as a transfer campaign.
    const mode = ['transfer', 'menu'].includes(b.mode) ? 'transfer' : 'report_only'
    let transferNumber = null, menu = null, activeKeys = keysOf(b)
    if (b.mode === 'menu') {
      try { menu = cleanMenu(b.menu, c.n.phoneNumber) } catch (e) { return bad(res, 400, 'invalid_menu', e.message) }
      if (!Object.keys(menu).length) return bad(res, 400, 'invalid_menu', 'Add at least one key to the menu.')
      transferNumber = firstForward(menu)
      activeKeys = Object.keys(menu)
    } else if (mode === 'transfer') {
      const t = transferTo({ transferTo: b.transferNumber }, c.n.phoneNumber)
      if (t.err) return bad(res, 400, 'invalid_transfer', t.err)
      transferNumber = t.to
    }
    let scheduledFor = null
    if (b.scheduledFor) {
      const d = new Date(b.scheduledFor)
      if (isNaN(d.getTime()) || d.getTime() < Date.now() + 60000 || d.getTime() > Date.now() + 30 * 86400000) return bad(res, 400, 'invalid_schedule', 'Schedule between 1 minute and 30 days from now.')
      scheduledFor = d
    }
    if (dryRun() && scheduledFor) return bad(res, 400, 'dry_run', 'Scheduling is turned off in preview mode — calls would be dialed for real.')
    const campaign = await bulkCallService.createCampaign({
      chatId, callerId: c.n.phoneNumber, audioUrl: audio.audioUrl, audioName: audio.name, mode, transferNumber, menu,
      activeKeys, concurrency: Math.min(20, Math.max(1, parseInt(b.concurrency, 10) || 5)), holdMusic: !!b.holdMusic,
      leads, scheduledFor, provider: 'telnyx', voicemailAudioUrl: vm?.audioUrl || null, voicemailAudioName: vm?.name || null,
    })
    if (campaign.error) return bad(res, 400, 'create_failed', campaign.error)
    if (dryRun()) await db.collection('bulkCallCampaigns').updateOne({ id: campaign.id }, { $set: { dryRun: true } })
    res.status(201).json({ campaign: publicCampaign({ ...campaign, dryRun: dryRun() }), skipped: errors.length })
  }))

  const withCampaign = (fn) => h(async (req, res) => {
    const c = await bulkCallService.getCampaign(String(req.params.id))
    if (!c || c.chatId !== String(req.webChatId)) return bad(res, 404, 'not_found', 'Campaign not found.')
    req.campaign = c
    return fn(req, res)
  })

  router.get('/campaigns/:id', withCampaign(async (req, res) => res.json({ campaign: publicCampaign(req.campaign, true) })))

  router.post('/campaigns/:id/start', withCampaign(async (req, res) => {
    if (req.campaign.dryRun || dryRun()) return res.status(202).json({ dryRun: true, message: 'Preview mode: the campaign is saved but no numbers were dialed.' })
    const r = await bulkCallService.startCampaign(req.campaign.id)
    if (r?.error) return bad(res, r.lowBalance ? 402 : 400, 'start_failed', String(r.error).replace(/<[^>]+>/g, ''))
    res.json({ started: true })
  }))

  for (const [action, fn] of [['pause', 'pauseCampaign'], ['resume', 'resumeCampaign'], ['cancel', 'cancelCampaign']]) {
    router.post(`/campaigns/:id/${action}`, withCampaign(async (req, res) => {
      if (action === 'resume' && (req.campaign.dryRun || dryRun())) return res.status(202).json({ dryRun: true, message: 'Preview mode: no numbers are dialed.' })
      const r = await bulkCallService[fn](req.campaign.id, ...(action === 'cancel' ? ['Cancelled by user'] : []))
      if (r?.error) return bad(res, r.lowBalance ? 402 : 400, `${action}_failed`, String(r.error).replace(/<[^>]+>/g, ''))
      res.json({ ok: true, campaign: publicCampaign(await bulkCallService.getCampaign(req.campaign.id)) })
    }))
  }
}

module.exports = { routes }
