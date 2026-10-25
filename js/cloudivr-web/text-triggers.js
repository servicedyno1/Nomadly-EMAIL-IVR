'use strict'
// Text Triggers: a text to a number starts ONE action — Auto Callback (ring the owner's own phone, press 1 to reach the
// texter), Text-to-Call message (call the texter and read a typed message) or AI agent calls them back. Rules are checked
// top to bottom; the first that matches runs. Optional conditions: keyword, business hours, once per sender per hour.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const numberHours = require('../number-hours')
const { spokenNumber } = require('../voicemail-greeting')
const { walletOps } = require('./wallet')
const notify = require('./notify')

const ACTIONS = { callback: 'Auto Callback', message: 'Text-to-Call message', ai: 'AI agent calls them back' }
const MAX_RULES = 5
const HOUR = 3600000
const MIN_WALLET = 1
const E164 = /^\+[1-9]\d{7,14}$/
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d ? (d.startsWith('+') ? d : `+${d}`) : '' }
const str = (v, max) => String(v ?? '').trim().slice(0, max)
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').slice(0, 200)
const bad = (res, status, error, message) => res.status(status).json({ error, message })
let ctx = null

const keywordsOf = (s) => [...new Set((Array.isArray(s) ? s : String(s || '').split(',')).map(k => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 10).map(k => k.slice(0, 40))
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasKeyword = (rule, text) => rule.keywords.some(k => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(k)}($|[^\\p{L}\\p{N}])`, 'iu').test(String(text || '')))

const defaults = (myPhone = null) => ({ enabled: false, myPhone, rules: [] })

// Normalizes a saved setup; throws Error(message) on bad input. agentIds = the account's AI agent ids.
function validate(body = {}, num, agentIds = []) {
  const list = Array.isArray(body.rules) ? body.rules : []
  if (list.length > MAX_RULES) throw new Error(`Up to ${MAX_RULES} triggers per number.`)
  const myPhone = normPhone(body.myPhone)
  if (myPhone && !E164.test(myPhone)) throw new Error('Enter your phone with country code, e.g. +14155550100.')
  if (myPhone && phoneConfig.isBlockedPrefix(myPhone)) throw new Error(`${myPhone} is a blocked premium/satellite destination.`)
  if (myPhone && myPhone === num.phoneNumber) throw new Error('Your phone must be a different number from this CloudIVR number.')
  const rules = list.map((r, i) => {
    const where = `Trigger ${i + 1}`
    const action = String(r.action || '')
    if (!ACTIONS[action]) throw new Error(`${where}: pick Auto Callback, Text-to-Call message or AI agent calls them back.`)
    const rule = {
      id: /^[\w-]{6,40}$/.test(String(r.id || '')) ? String(r.id) : crypto.randomUUID(), enabled: r.enabled !== false, action,
      keywordOnly: !!r.keywordOnly, keywords: keywordsOf(r.keywords), businessHoursOnly: !!r.businessHoursOnly, oncePerHour: r.oncePerHour !== false,
      message: null, agentId: null,
    }
    if (rule.keywordOnly && !rule.keywords.length) throw new Error(`${where}: type at least one keyword, or switch "Only when the text has a keyword" off.`)
    if (action === 'callback' && !myPhone) throw new Error(`${where}: Auto Callback rings your phone first — enter your phone number above.`)
    if (action === 'message') {
      rule.message = str(r.message, 500)
      if (!rule.message) throw new Error(`${where}: type the message we read to the person who texted.`)
    }
    if (action === 'ai') {
      if (!phoneConfig.canAccessFeature(num.plan, 'aiAgent')) throw new Error(`${where}: AI agent call backs need the Business plan.`)
      if (!agentIds.includes(String(r.agentId || ''))) throw new Error(`${where}: pick one of your AI agents.`)
      rule.agentId = String(r.agentId)
    }
    return rule
  })
  if (body.enabled && !rules.some(r => r.enabled)) throw new Error('Add at least one trigger that is on, or switch Text Triggers off.')
  return { enabled: !!body.enabled, myPhone: myPhone || null, rules }
}

// Every rule's verdict for this text, plus the first one that runs → { rule, checks }.
function match(cfg, num, text, now = new Date()) {
  const open = numberHours.isOpen(num.features?.hours, now)
  let rule = null
  const checks = (cfg.rules || []).map((r, i) => {
    const why = !r.enabled ? 'off' : r.keywordOnly && !hasKeyword(r, text) ? 'no_keyword' : r.businessHoursOnly && !open ? 'closed' : rule ? 'earlier_rule' : 'match'
    if (why === 'match') rule = r
    return { index: i, id: r.id, action: r.action, result: why }
  })
  return { rule, checks }
}

const runs = () => ctx.db.collection('textTriggerRuns')
const recentRun = (num, rule, from) => runs().findOne({ phoneNumber: num.phoneNumber, ruleId: rule.id, from, status: { $in: ['started', 'preview'] }, test: { $ne: true }, at: { $gt: new Date(Date.now() - HOUR) } })

async function funded(chatId, rate) {
  const bal = await walletOps(ctx.db).balance(chatId)
  return bal >= Math.max(MIN_WALLET, rate) ? null : `Wallet $${bal.toFixed(2)} is too low (needs about $${Math.max(MIN_WALLET, rate).toFixed(2)}).`
}

// Places the call for `rule` (or describes it when `simulate` / preview mode) → { status, detail, rate }.
async function execute(chatId, num, cfg, rule, from, text, simulate) {
  const vs = ctx.voiceService
  const callerId = num.phoneNumber
  const preview = simulate || dryRun()
  if (rule.action === 'callback') {
    const me = cfg.myPhone
    const rate = Math.round((vs.getIvrCallRate(me) + vs.getIvrCallRate(from)) * 100) / 100
    const low = await funded(chatId, rate)
    if (low) return { status: 'skipped', detail: low, rate }
    if (preview) return { status: 'preview', detail: `Would ring ${me}, then connect you to ${from} when you press 1.`, rate }
    const greetingText = `New text on your CloudIVR line from ${spokenNumber(from)}: ${str(text, 300) || 'no words'}. Press 1 to call them back now. To skip, just hang up.`
    const r = await vs.initiateOutboundIvrCall({ chatId, callerId, targetNumber: me, ivrNumber: from, greetingText, activeKeys: ['1'], ivrMode: 'transfer', templateName: ACTIONS.callback, holdMusic: false, provider: 'telnyx' })
    return r?.error ? { status: 'failed', detail: strip(r.error), rate } : { status: 'started', detail: `Ringing ${me} — press 1 to reach ${from}.`, rate }
  }
  if (rule.action === 'message') {
    const rate = vs.getIvrCallRate(from)
    const low = await funded(chatId, rate)
    if (low) return { status: 'skipped', detail: low, rate }
    if (preview) return { status: 'preview', detail: `Would call ${from} and read your message.`, rate }
    const voice = String((await ctx.db.collection('webPrefs').findOne({ _id: chatId }))?.ttsVoice || '') || undefined
    const r = await vs.initiateOutboundIvrCall({ chatId, callerId, targetNumber: from, greetingText: rule.message, messageOnly: true, activeKeys: ['1'], ivrMode: 'transfer', templateName: ACTIONS.message, voiceName: voice, holdMusic: false, provider: 'telnyx' })
    return r?.error ? { status: 'failed', detail: strip(r.error), rate } : { status: 'started', detail: `Calling ${from} with your message.`, rate }
  }
  const ai = require('../ai-agent')
  const agent = await ai.store.getAgent(rule.agentId, chatId)
  if (!agent) return { status: 'skipped', detail: 'The AI agent for this trigger was deleted.' }
  if (await ai.store.onDnc(chatId, from)) return { status: 'skipped', detail: `${from} is on your do-not-call list.` }
  if (!ai.hours.callableNow(from)) return { status: 'skipped', detail: `It is outside 8am–9pm for ${from}, so the AI agent does not call.` }
  const rate = ai.leadRate(from, agent.record !== false)
  const low = await funded(chatId, rate + ai.committed(chatId))
  if (low) return { status: 'skipped', detail: low, rate }
  if (!process.env.APP_OPEN_API_KEY && !preview) return { status: 'failed', detail: 'AI calls are not available right now.', rate }
  if (preview) return { status: 'preview', detail: `Would have ${agent.name} call ${from} about their text.`, rate }
  const reason = `They just texted the business: "${str(text, 300)}". Say you are calling back about their text, then help them with it.`
  const r = await ai.dialLead({ id: null, chatId, agentId: agent.id, callerId }, { number: from, name: null, index: null, reason })
  return r?.error ? { status: 'failed', detail: strip(r.error), rate } : { status: 'started', detail: `${agent.name} is calling ${from}.`, rate }
}

// Checks the rules for one text and runs the first match → the run record (null when nothing matched).
async function evaluate(chatId, num, cfg, from, text, { simulate = false } = {}) {
  const { rule, checks } = match(cfg, num, text)
  if (!rule) return { rule: null, checks, status: 'no_match', detail: 'No trigger matched this text.' }
  let out
  if (rule.oncePerHour && await recentRun(num, rule, from)) out = { status: 'skipped', detail: `Already ran for ${from} in the last hour.` }
  else out = await execute(chatId, num, cfg, rule, from, text, simulate).catch(e => ({ status: 'failed', detail: strip(e.message) }))
  const run = { _id: crypto.randomUUID(), chatId: String(chatId), phoneNumber: num.phoneNumber, ruleId: rule.id, action: rule.action, from, body: str(text, 300), ...out, test: simulate, dryRun: dryRun(), at: new Date() }
  if (!simulate) {
    await runs().insertOne(run).catch(() => {})
    const head = out.status === 'skipped' ? 'Text Trigger skipped' : out.status === 'failed' ? 'Text Trigger failed' : 'Text Trigger ran'
    notify.push(chatId, `⚡ ${head}: ${ACTIONS[rule.action]}\nText from ${from} to ${num.phoneNumber}\n${out.detail}`, null, { kind: 'call' }).catch(() => {})
  }
  return { rule, checks, ...out, runId: run._id }
}

// Inbound SMS hook (sms-service). Never throws.
async function onInboundText({ chatId, num, from, body }) {
  try {
    if (!ctx || !notify.isWebChatId(chatId)) return null
    const cfg = num?.features?.textTriggers
    if (!cfg?.enabled || !cfg.rules?.length || !phoneConfig.canAccessFeature(num.plan, 'textTriggers')) return null
    if ((num.provider || 'telnyx') !== 'telnyx') return null
    const sender = normPhone(from)
    if (!E164.test(sender) || sender === num.phoneNumber || phoneConfig.isBlockedPrefix(sender)) return null
    const r = await evaluate(String(chatId), num, cfg, sender, body)
    ;(ctx.log || console.log)(`[TextTriggers] ${sender} → ${num.phoneNumber}: ${r.rule ? `${r.rule.action} ${r.status}` : 'no match'}`)
    return r
  } catch (e) {
    (ctx?.log || console.log)(`[TextTriggers] error: ${e.message}`)
    return null
  }
}

const publicRun = (r) => ({ id: r._id, action: r.action, from: r.from, body: r.body, status: r.status, detail: r.detail, dryRun: !!r.dryRun, at: r.at })

function routes(router, deps) {
  ctx = deps
  const { db, h, numbersApi } = deps
  runs().createIndex({ phoneNumber: 1, from: 1, at: -1 }).catch(() => {})
  runs().createIndex({ at: 1 }, { expireAfterSeconds: 90 * 86400 }).catch(() => {})
  const prefs = db.collection('webPrefs')
  const withNumber = (fn) => h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!phoneConfig.canAccessFeature(num.plan, 'textTriggers')) return bad(res, 403, 'plan_upgrade_required', 'Text Triggers need the Pro plan or higher on this number.')
    req.num = num
    return fn(req, res)
  })
  const agentsOf = async (chatId) => (await require('../ai-agent').store.listAgents(chatId)).map(a => ({ id: a.id, name: a.name }))

  router.get('/numbers/:phone/text-triggers', withNumber(async (req, res) => {
    const p = await prefs.findOne({ _id: req.webChatId })
    const vs = deps.voiceService
    res.json({
      textTriggers: req.num.features?.textTriggers || defaults(p?.callbackPhone || null),
      agents: phoneConfig.canAccessFeature(req.num.plan, 'aiAgent') ? await agentsOf(req.webChatId) : [],
      canAi: phoneConfig.canAccessFeature(req.num.plan, 'aiAgent'),
      hours: { enabled: !!req.num.features?.hours?.enabled, openNow: numberHours.isOpen(req.num.features?.hours) },
      rates: { call: vs.getIvrCallRate(req.num.phoneNumber), ai: require('../ai-agent').RATE() },
      runs: (await runs().find({ phoneNumber: req.num.phoneNumber, chatId: req.webChatId, test: { $ne: true } }).sort({ at: -1 }).limit(20).toArray()).map(publicRun),
    })
  }))

  router.put('/numbers/:phone/text-triggers', withNumber(async (req, res) => {
    let value
    try { value = validate(req.body, req.num, (await agentsOf(req.webChatId)).map(a => a.id)) } catch (e) { return bad(res, 400, 'invalid_triggers', e.message) }
    await numbersApi.setField(req.webChatId, req.num.phoneNumber, 'features.textTriggers', value)
    if (value.myPhone) await prefs.updateOne({ _id: req.webChatId }, { $set: { callbackPhone: value.myPhone, updatedAt: new Date() } }, { upsert: true })
    res.json({ textTriggers: value })
  }))

  // "Try a text": runs the saved rules on a sample text without dialing or counting toward the hourly limit.
  router.post('/numbers/:phone/text-triggers/test', withNumber(async (req, res) => {
    const from = normPhone(req.body.from)
    if (!E164.test(from)) return bad(res, 400, 'invalid_number', 'Enter the sample sender with country code, e.g. +14155550100.')
    const cfg = req.num.features?.textTriggers || defaults()
    const r = await evaluate(req.webChatId, req.num, { ...cfg, rules: cfg.rules || [] }, from, str(req.body.text, 500), { simulate: true })
    res.json({ matched: r.rule ? { id: r.rule.id, action: r.rule.action } : null, checks: r.checks, status: r.status, detail: r.detail, enabled: !!cfg.enabled })
  }))
}

module.exports = { routes, validate, match, hasKeyword, onInboundText, ACTIONS, MAX_RULES }
