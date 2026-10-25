'use strict'
// Numbers: catalogue, search, buy (wallet), and every per-number setting. Records use the bot's exact schema in
// phoneNumbersOf so the existing call engine (forwarding, IVR, voicemail, recording, SIP, renewals) serves them.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const lifecycle = require('../plan-lifecycle')
const { walletOps, round2, livePayments } = require('./wallet')
const numberHours = require('../number-hours')
const vmGreeting = require('../voicemail-greeting')
const notes = require('./notes')
const notify = require('./notify')
const referrals = require('./referrals')

const TYPE_NAMES = { local: 'Local', toll_free: 'Toll-free', mobile: 'Mobile', national: 'National' }
const FEATURE_KEYS = ['callForwarding', 'smsToEmail', 'smsWebhook', 'voicemail', 'sipCredentials', 'callRecording', 'ivr', 'ivrOutbound', 'bulkCall', 'otpCollection', 'aiAgent', 'textRelay', 'ringGroup', 'textTriggers', 'aiSummary']
const LOG_TYPES = { sms: ['sms', 'sms_out'], voicemail: ['voicemail'], fax: ['fax'] }
const E164 = /^\+[1-9]\d{7,14}$/
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const webText = (s) => String(s).replace(/Telegram/g, 'your inbox')

const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d ? (d.startsWith('+') ? d : `+${d}`) : '' }
// Numbers typed to dial (forward-to, backups, IVR forward keys): the bot's auto-correct (10-digit US → +1).
const dialNorm = require('../backup-numbers').norm
const bad = (res, status, error, message) => res.status(status).json({ error, message })
// Up to 4 backup numbers rung in order when the main one is busy or doesn't answer → { list } | { error }.
function parseBackups(raw, exclude = []) {
  const tokens = (Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]+|\s+(?=\+)/)).map(t => String(t || '').trim()).filter(Boolean)
  const junk = tokens.find(t => !/^\+?[\d\s().-]+$/.test(t))
  if (junk) return { error: `Backup "${junk.slice(0, 20)}" is not a phone number. Use the country code, e.g. +14155550100.` }
  const items = tokens.map(dialNorm).filter(Boolean)
  const list = [...new Set(items)].filter(n => !exclude.includes(n))
  if (list.length > 4) return { error: 'Add up to 4 backup numbers.' }
  for (const n of list) {
    if (!E164.test(n)) return { error: `Backup ${n}: use the country code, e.g. +14155550100.` }
    if (phoneConfig.isBlockedPrefix(n)) return { error: `Backup ${n} is a blocked premium/satellite destination.` }
  }
  return { list }
}

// Same Telnyx catalogue the bot shows (US/CA + international, incl. countries that need ID checks).
function countries() {
  const intl = phoneConfig.isTelnyxIntlEnabled() ? [...phoneConfig.telnyxIntlCountries, ...phoneConfig.telnyxIntlMore] : []
  return [...phoneConfig.countries, ...intl].filter(c => c.provider === 'telnyx').map(c => {
    const i = c.name.indexOf(' ')
    return { code: c.code, flag: c.name.slice(0, i), name: c.name.slice(i + 1), types: c.types || ['local', 'toll_free'] }
  })
}

// What each plan gets IN THE WEB APP. The bot's plan copy lists Telegram-only extras (redial button, presets,
// sub-numbers…), so plan cards use this list instead. `gate` is the engine feature check; null = every plan.
const WEB_FEATURES = [
  ['inbox', 'SMS inbox — read texts and reply', null],
  ['forwarding', 'Call forwarding to any phone', 'callForwarding'],
  ['hours', 'On/off hours for each number', null],
  ['notes', 'Call notes', null],
  ['private', 'Private mode — hide numbers on screen', null],
  ['voicemail', () => `Voicemail in ${vmGreeting.LANG_CODES.length} languages + transcripts`, 'voicemail'],
  ['browserPhone', 'Browser phone & SIP for softphones', 'sipCredentials'],
  ['smsEmail', 'SMS to email & webhooks', 'smsToEmail'],
  ['quickIvr', 'Quick IVR calls', 'ivrOutbound'],
  ['callMeFirst', 'Call me first — calls through your mobile', 'ivrOutbound'],
  ['bulk', 'Bulk IVR campaigns with scheduling', 'bulkCall'],
  ['textRelay', () => `Text calls for deaf & hard-of-hearing users (+$${Number(require('../relay-call').RELAY_RATE()).toFixed(2)}/min)`, 'textRelay'],
  ['recording', 'Call recording', 'callRecording'],
  ['ringGroup', 'Ring groups — ring several phones at once', 'ringGroup'],
  ['textTriggers', 'Text Triggers — a text starts a callback, a spoken reply or an AI call', 'textTriggers'],
  ['aiSummary', () => `AI summaries & caller mood for voicemails and recorded calls ($${Number(require('./ai-summary').RATE()).toFixed(2)}/min)`, 'aiSummary'],
  ['ivr', 'Keypad menu (IVR) — callers press a key, with key analytics', 'ivr'],
  ['aiAgent', () => `AI voice agent — talks with callers, books and takes messages ($${Number(require('../ai-agent').RATE()).toFixed(2)}/min)`, 'aiAgent'],
  ['priority', 'Priority support', (plan) => plan === 'business'],
]
const webFeatures = (plan) => WEB_FEATURES.map(([key, label, gate]) => ({
  key, label: typeof label === 'function' ? label() : label, included: gate === null ? true : typeof gate === 'function' ? gate(plan) : !!phoneConfig.canAccessFeature(plan, gate),
}))

// Plan pre-selected on the buy page and badged "Recommended" (Pro unless switched off).
function recommendedPlan() {
  const want = String(process.env.CLOUDIVR_RECOMMENDED_PLAN || 'pro')
  return [want, 'pro', 'business', 'starter'].find(id => phoneConfig.plans[id] && phoneConfig.isPlanAvailable(id)) || null
}

const catalog = () => {
  const rec = recommendedPlan()
  return {
    plans: Object.entries(phoneConfig.plans).map(([id, p]) => ({ id, name: p.name, price: p.price, minutes: p.minutes, sms: p.sms, features: p.features.map(webText), webFeatures: webFeatures(id), recommended: id === rec, available: phoneConfig.isPlanAvailable(id), access: access(id) })),
    recommendedPlan: rec,
    voicemailLanguages: vmGreeting.publicLangs(),
    countries: countries(), typeNames: TYPE_NAMES,
    rates: { forwardingPerMin: phoneConfig.CALL_FORWARDING_RATE_MIN, overagePerMin: phoneConfig.OVERAGE_RATE_MIN, overagePerSms: phoneConfig.OVERAGE_RATE_SMS, aiAgentPerMin: require('../ai-agent').RATE(), aiSummaryPerMin: require('./ai-summary').RATE() },
    sipDomain: phoneConfig.WEB_SIP_DOMAIN, dryRun: dryRun(), livePayments: livePayments(),
    extraNumber: { price: phoneConfig.SUB_NUMBER_BASE_PRICE, limits: Object.fromEntries(Object.keys(phoneConfig.plans).map(id => [id, phoneConfig.getSubNumberLimit(id)])) },
  }
}

function access(plan) {
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, !!phoneConfig.canAccessFeature(plan, k)]))
}

// Web shape of the voicemail settings (the call engine reads customAudioGreetingUrl; older web saves used customGreetingUrl).
function publicVoicemail(vm) {
  const v = vm || {}
  const url = v.customAudioGreetingUrl || v.customGreetingUrl || null
  return { enabled: !!v.enabled, greetingType: v.greetingType === 'custom' && url ? 'custom' : 'default', customGreetingUrl: url, forwardToEmail: v.forwardToEmail || null, ringTimeout: v.ringTimeout || 25, language: vmGreeting.LANGS[v.language] ? v.language : 'en', transcribe: v.transcribe !== false }
}

// What callers get right now, and which settings are skipped because another one answers first.
function routeSummary(n) {
  if (n.features?.aiAgent?.enabled && phoneConfig.canAccessFeature(n.plan, 'aiAgent')) return { primary: 'ai_agent', forwardTo: null, skipped: [], brokenIvr: false }
  const rg = n.features?.ringGroup
  if (rg?.enabled && rg.members?.length && phoneConfig.canAccessFeature(n.plan, 'ringGroup')) return { primary: 'ring_group', forwardTo: null, members: rg.members, skipped: [], brokenIvr: false }
  try {
    const r = phoneConfig.getCallRouteSummary(n) || {}
    return { primary: r.primary?.action || 'missed', forwardTo: r.primary?.forwardTo || null, skipped: r.skippedFeatures || [], brokenIvr: !!r.hasBrokenIvr }
  } catch (_) { return { primary: 'missed', forwardTo: null, skipped: [] } }
}

// `numbers` = the owner's lines, so usage shows the shared allowance of the main line + its extra lines.
function publicNumber(n, numbers) {
  const plan = phoneConfig.plans[n.plan] || {}
  const pool = lifecycle.poolUsage(numbers || [n], n)
  const poolPlan = phoneConfig.plans[pool.main.plan] || plan
  const f = n.features || {}
  return {
    phoneNumber: n.phoneNumber, country: n.country, countryName: n.countryName, type: n.type,
    plan: n.plan, planName: plan.name || n.plan, planPrice: n.planPrice, status: n.status, autoRenew: n.autoRenew !== false,
    renewalPrice: lifecycle.renewalPrice(n), holdUntil: lifecycle.onHold(n) ? n._holdUntil : null, suspendReason: lifecycle.onHold(n) ? n._suspendReason || null : null,
    purchaseDate: n.purchaseDate, expiresAt: n.expiresAt, isSubNumber: !!n.isSubNumber, parentNumber: n.parentNumber || null, dryRun: !!n.dryRun,
    routeSummary: routeSummary(n),
    capabilities: n.capabilities || { voice: true, sms: true, fax: false },
    usage: { minutesUsed: pool.minutesUsed, minutesIncluded: poolPlan.minutes ?? null, smsUsed: pool.smsUsed, smsIncluded: poolPlan.sms ?? null, shared: pool.lines.length > 1 },
    sipUsername: n.telnyxSipUsername || n.sipUsername || null, sipDomain: phoneConfig.WEB_SIP_DOMAIN,
    features: {
      callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false, backups: [], ...(f.callForwarding || {}) },
      voicemail: publicVoicemail(f.voicemail),
      hours: f.hours || numberHours.defaultHours(),
      smsForwarding: f.smsForwarding || { toTelegram: true, toEmail: null, webhookUrl: null },
      fax: { toInbox: f.faxForwarding?.toTelegram !== false },
      recording: !!f.recording,
      ivr: f.ivr || { enabled: false, options: {} },
      aiAgent: f.aiAgent || { enabled: false, agentId: null },
      browserRing: { enabled: false, answerMode: 'ask', lang: 'en', voice: 'female', announce: true, ...(f.browserRing || {}) },
      ringGroup: { ...require('./ring-group').defaults(), ...(f.ringGroup || {}) },
      textTriggers: { enabled: !!f.textTriggers?.enabled, count: (f.textTriggers?.rules || []).length },
      aiSummary: { enabled: !!f.aiSummary?.enabled },
    },
    access: access(n.plan),
  }
}

// audioOk(url) → true when the url is one of the account's own library files.
function validateIvr(body, plan, audioOk = () => true) {
  const ivr = body || {}
  // Spoken menu language = the web app's language when saved (unset/other = English).
  const language = vmGreeting.IVR_LANGS.includes(ivr.language) ? ivr.language : 'en'
  const speech = vmGreeting.ivrSpeech(language)
  const audio = (url, where) => {
    if (!url) return null
    if (!audioOk(url)) throw new Error(`${where}: pick an audio file from your library.`)
    return String(url)
  }
  const clean = (opts, depth) => {
    const out = {}
    for (const [digit, o] of Object.entries(opts || {})) {
      if (!/^[0-9]$/.test(digit)) throw new Error(`Menu key "${digit}" must be a single digit 0-9.`)
      const action = String(o.action || '')
      const label = String(o.label || '').slice(0, 60)
      if (action === 'forward') {
        const to = dialNorm(o.forwardTo)
        if (!E164.test(to)) throw new Error(`Key ${digit}: enter the forward number with country code, e.g. +14155550100.`)
        if (phoneConfig.isBlockedPrefix(to)) throw new Error(`Key ${digit}: ${to} is a blocked premium/satellite destination.`)
        out[digit] = { action, forwardTo: to, label }
      } else if (action === 'message') {
        if (!o.message && !o.audioUrl) throw new Error(`Key ${digit}: add a message or pick an audio file.`)
        out[digit] = { action, message: String(o.message || '').slice(0, 1000), audioUrl: audio(o.audioUrl, `Key ${digit}`), label }
      } else if (action === 'voicemail') {
        if (!phoneConfig.canAccessFeature(plan, 'voicemail')) throw new Error('Voicemail needs the Pro plan or higher.')
        out[digit] = { action, label }
      } else if (action === 'submenu') {
        if (depth > 0) throw new Error('Sub-menus can only be one level deep.')
        const sub = o.subMenu || {}
        const subAudio = audio(sub.greetingAudioUrl, `Key ${digit} sub-menu`)
        out[digit] = { action, label, subMenu: { greetingType: subAudio ? 'audio' : 'text', greeting: String(sub.greeting || speech.sub).slice(0, 1000), greetingAudioUrl: subAudio, options: clean(sub.options, 1) } }
      } else throw new Error(`Key ${digit}: unknown action "${action}".`)
    }
    return out
  }
  const options = clean(ivr.options, 0)
  if (ivr.enabled && !Object.keys(options).length) throw new Error('Add at least one menu option before turning the IVR on.')
  const greetingAudioUrl = audio(ivr.greetingAudioUrl, 'Greeting')
  return {
    enabled: !!ivr.enabled,
    greetingType: greetingAudioUrl ? 'audio' : 'text',
    greeting: String(ivr.greeting || speech.greeting).slice(0, 1000),
    greetingAudioUrl, language,
    voice: ivr.voice || null, speed: Number(ivr.speed) || 1,
    options,
  }
}

const smsReplyMod = require('./sms-reply')
const publicLog = (l) => ({
  id: String(l._id), type: l.type, direction: l.direction || (String(l.type || '').startsWith('outbound') ? 'outbound' : 'inbound'),
  from: l.from || null, to: l.to || l.phoneNumber || null, phoneNumber: l.phoneNumber || null, duration: l.duration || 0,
  body: l.body || null, recordingUrl: l.recordingUrl || null, digit: l.digitPressed || null, forwardTo: l.forwardTo || null, timestamp: l.timestamp,
  transcript: l.transcript || null, transcriptStatus: l.transcriptStatus || null, reply: l.reply || null, canReply: smsReplyMod.canReply(l),
  aiSummary: l.aiSummary ? { status: l.aiSummary.status, summary: l.aiSummary.summary || null, sentiment: l.aiSummary.sentiment || null, mood: l.aiSummary.mood || null, actionItems: l.aiSummary.actionItems || [], charge: l.aiSummary.charge || 0, detail: l.aiSummary.detail || null } : null,
  canSummarize: ['voicemail', 'call_recording'].includes(l.type) && !!(l.transcript || l.recordingUrl),
})

function routes(router, deps) {
  const { db, h, telnyxApi, getTelnyxResources, paidCheckout, numberSurcharge, verificationInfo, audioLibraryService, notifyAdmin = () => {}, logTransaction, generateTransactionId, log = console.log } = deps
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  const phoneTransactions = db.collection('phoneTransactions')
  const phoneLogs = db.collection('phoneLogs')
  const searchCache = db.collection('webSearchCache')
  searchCache.createIndex({ at: 1 }, { expireAfterSeconds: 7200 }).catch(() => {})
  const w = walletOps(db)

  const myNumbers = async (chatId) => ((await phoneNumbersOf.findOne({ _id: chatId }))?.val?.numbers || []).filter(n => n.status !== 'released')
  const findMine = async (chatId, phone) => (await myNumbers(chatId)).find(n => n.phoneNumber === normPhone(phone)) || null
  const setField = (chatId, phone, path, value) => phoneNumbersOf.updateOne({ _id: chatId, 'val.numbers.phoneNumber': phone }, { $set: { [`val.numbers.$.${path}`]: value } })
  // One answers a number: where both were on, the AI agent already took every call, so the keypad menu goes off.
  const both = { 'features.aiAgent.enabled': true, 'features.ivr.enabled': true }
  phoneNumbersOf.updateMany({ 'val.numbers': { $elemMatch: both } }, { $set: { 'val.numbers.$[n].features.ivr.enabled': false } }, { arrayFilters: [{ 'n.features.aiAgent.enabled': true, 'n.features.ivr.enabled': true }] })
    .then(r => r.modifiedCount && log(`[CloudIVR] keypad menu switched off on ${r.modifiedCount} account(s) where the AI agent also answered`)).catch(() => {})
  const ownAudioUrls = async (chatId) => new Set((await audioLibraryService.listAudios(chatId)).map(a => a.audioUrl))
  const txn = (chatId, type, amount, metadata) => {
    try { return logTransaction && logTransaction(db, { transactionId: generateTransactionId ? generateTransactionId() : crypto.randomUUID(), chatId, type, amount, currency: 'USD', status: 'completed', metadata: { ...metadata, channel: 'web' } }) } catch (_) { return null }
  }
  // Drops search hits that some account already holds (the dry-run preview never really buys, so they come back).
  const unheld = async (found) => {
    const list = found || []
    const phones = list.map(n => n.phone_number)
    if (!phones.length) return list
    const docs = await phoneNumbersOf.find({ 'val.numbers': { $elemMatch: { phoneNumber: { $in: phones }, status: { $ne: 'released' } } } }, { projection: { 'val.numbers.phoneNumber': 1, 'val.numbers.status': 1 } }).toArray()
    const held = new Set(docs.flatMap(d => (d.val?.numbers || []).filter(n => n.status !== 'released').map(n => n.phoneNumber)))
    return list.filter(n => !held.has(n.phone_number))
  }

  // Loads the caller's number into req.num (404 when it isn't theirs).
  const withNumber = (fn) => h(async (req, res) => {
    const num = await findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    req.num = num
    return fn(req, res)
  })
  const gate = (req, res, feature, label) => {
    if (phoneConfig.canAccessFeature(req.num.plan, feature)) return true
    bad(res, 403, 'plan_upgrade_required', `${label} needs a higher plan. Upgrade this number to use it.`)
    return false
  }

  router.get('/catalog', (req, res) => res.json(catalog()))

  router.get('/numbers/search', h(async (req, res) => {
    const country = String(req.query.country || 'US').toUpperCase()
    const c = countries().find(x => x.code === country)
    if (!c) return bad(res, 400, 'invalid_country', 'Pick a country from the list.')
    const type = String(req.query.type || c.types[0])
    if (!c.types.includes(type)) return bad(res, 400, 'invalid_type', `${c.name} offers: ${c.types.map(t => TYPE_NAMES[t] || t).join(', ')}.`)
    const areaCode = ['US', 'CA'].includes(country) && type === 'local' && /^\d{3}$/.test(String(req.query.areaCode || '')) ? String(req.query.areaCode) : null
    const verification = await verificationInfo(country, type, `${c.flag} ${c.name}`)
    if (verification.error) return bad(res, 424, 'lookup_failed', verification.error)
    if (verification.required && !verification.supported) return bad(res, 400, 'unsupported', `${c.name} ${TYPE_NAMES[type] || type} numbers can't be ordered online right now. Pick another country or type.`)
    const found = await unheld(await telnyxApi.searchNumbers(country, type, areaCode, 12))
    const results = found.map(n => ({
      phoneNumber: n.phone_number,
      region: (n.region_information || []).map(r => r.region_name).filter(Boolean).join(', '),
      capabilities: n._capabilities || { voice: true, sms: false, fax: false },
      surcharge: round2(numberSurcharge(country, type, n)),
      cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
    }))
    await searchCache.updateOne({ _id: req.webChatId }, { $set: { country, type, areaCode, results, at: new Date() } }, { upsert: true })
    res.json({ numbers: results.map(({ cost, ...r }) => r) })
  }))

  router.get('/numbers', h(async (req, res) => res.json({ numbers: (await myNumbers(req.webChatId)).map((n, _, all) => publicNumber(n, all)) })))
  router.get('/numbers/:phone', withNumber(async (req, res) => res.json({ number: publicNumber(req.num, (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val?.numbers) })))

  // Picked number from the account's last search (null when it is no longer there).
  const pickFromSearch = async (chatId, phone) => {
    const cache = await searchCache.findOne({ _id: chatId })
    const hit = cache?.results?.find(r => r.phoneNumber === normPhone(phone))
    return hit ? { hit, country: cache.country, type: cache.type, areaCode: cache.areaCode } : null
  }
  const searchSimilar = async (country, type, areaCode) => (await unheld(await telnyxApi.searchNumbers(country, type, areaCode, 6))).map(n => ({
    phoneNumber: n.phone_number, capabilities: n._capabilities || { voice: true, sms: false, fax: false },
    surcharge: round2(numberSurcharge(country, type, n)), cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
  }))

  // Account currently holding this number (anyone, including the buyer), or null.
  const holderOf = async (phone) => (await phoneNumbersOf.findOne({ 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } }, { projection: { _id: 1 } }))?._id ?? null

  // One buyer at a time per number: the lock closes the gap between the holder check and saving the number
  // (TTL frees it if the process dies mid-purchase).
  const locks = db.collection('webNumberLocks')
  locks.createIndex({ at: 1 }, { expireAfterSeconds: 600 }).catch(() => {})
  async function purchase(args) {
    try { await locks.insertOne({ _id: args.phone, chatId: args.chatId, at: new Date() }) } catch (e) {
      if (e.code === 11000) return { status: 409, body: { error: 'number_taken', message: 'Someone is buying that number right now. Pick another one.' } }
      throw e
    }
    try { return await purchaseLocked(args) } finally { await locks.deleteOne({ _id: args.phone }).catch(() => {}) }
  }

  // Debits the wallet and activates the number → { status, body } (HTTP-style; refunds on failure).
  // `sub` = { parentNumber, plan } adds the number to an existing plan (flat extra-number price, parent's plan features).
  // `coupon` = { code, type, discount } from deps.resolveCoupon (percent off; redeemed only after success).
  async function purchaseLocked({ chatId, email, phone, planKey, hit, country, type, areaCode, autoRenew = true, viaOrder = null, sub = null, coupon = null }) {
    if (sub) planKey = sub.plan
    const plan = phoneConfig.plans[planKey]
    if (!plan || !phoneConfig.isPlanAvailable(planKey)) return { status: 400, body: { error: 'invalid_plan', message: 'That plan is not available.' } }
    const holder = await holderOf(phone)
    if (holder !== null) {
      return { status: 409, body: String(holder) === String(chatId)
        ? { error: 'already_yours', message: 'You already have this number. Pick another one.' }
        : { error: 'number_taken', message: 'Someone just took that number. Pick another one.' } }
    }
    const c = countries().find(x => x.code === country)
    const ver = await verificationInfo(country, type, `${c.flag} ${c.name}`)
    if (ver.error) return { status: 424, body: { error: 'lookup_failed', message: ver.error } }
    const base = sub ? phoneConfig.SUB_NUMBER_BASE_PRICE : plan.price + (hit.surcharge || 0)
    const price = round2(base * (1 - (Number(coupon?.discount) || 0) / 100))
    if (!(await w.debit(chatId, price))) return { status: 402, body: { error: 'insufficient_balance', message: `This number costs $${price.toFixed(2)}. Your wallet has $${(await w.balance(chatId)).toFixed(2)} — top up first.` } }

    let selected = phone
    try {
      const tr = getTelnyxResources() || {}
      // hold: web verifications never expire or auto-refund — the number waits until the owner finishes.
      const ctx = { countryCode: country, numberType: type, areaCode, planKey, price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', refund: { currency: 'usd', amount: price }, capabilities: hit.capabilities, numberCost: hit.cost, countryName: `${c.flag} ${c.name}`, lang: 'en', hold: true, isSubNumber: !!sub }
      let order
      if (!ver.required && dryRun()) order = { id: `dryrun-${crypto.randomUUID().slice(0, 8)}` }
      else order = await paidCheckout(chatId, phone, ctx)
      if (order?._verification) {
        await phoneTransactions.insertOne({ chatId, phoneNumber: phone, action: 'purchase_verification', plan: planKey, amount: price, paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
        notifyAdmin(`🌐 CloudIVR web: paid ${country} number ${phone} — collecting verification\nweb account: ${chatId} (${email})\nplan: ${plan.name} $${price}`)
        return { status: 202, body: { verification: true, sessionId: order.sessionId, phoneNumber: phone, substitutedFrom: null, balance: await w.balance(chatId) } }
      }
      if (!order) throw new Error('The number could not be reserved — it may have just been taken. Pick another one.')
      if (order._retriedNumber) selected = order._retriedNumber
      if (!dryRun() && tr.callControlAppId) await telnyxApi.assignNumberToCallControlApp(selected, tr.callControlAppId)

      let sipUsername = phoneConfig.generateSipUsername(), sipPassword = phoneConfig.generateSipPassword()
      let tUser = null, tPass = null, tCredId = null
      if (!dryRun() && tr.sipConnectionId) {
        const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword, selected)
        if (cred?.sip_username) { tUser = sipUsername = cred.sip_username; tPass = sipPassword = cred.sip_password || sipPassword; tCredId = cred.id || null }
      }
      const caps = { voice: true, sms: !!hit.capabilities.sms, fax: !!hit.capabilities.fax }
      const expiresAt = new Date(); expiresAt.setMonth(expiresAt.getMonth() + 1)
      const doc = {
        phoneNumber: selected, telnyxOrderId: order.id, provider: 'telnyx', country, countryName: c.name,
        type, plan: planKey, planPrice: round2(base), ...(!sub && hit.surcharge ? { numberSurcharge: round2(hit.surcharge) } : {}), purchaseDate: new Date().toISOString(), expiresAt: expiresAt.toISOString(), autoRenew: autoRenew !== false, status: 'active',
        sipUsername, sipPassword, telnyxSipUsername: tUser, telnyxSipPassword: tPass, telnyxCredentialId: tCredId, sipDomain: phoneConfig.WEB_SIP_DOMAIN,
        messagingProfileId: caps.sms ? tr.messagingProfileId || null : null, connectionId: tr.sipConnectionId || null, smsUsed: 0, minutesUsed: 0,
        capabilities: caps, channel: 'web', ...(dryRun() ? { dryRun: true } : {}), ...(sub ? { isSubNumber: true, parentNumber: sub.parentNumber } : {}),
        features: {
          sms: caps.sms,
          callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
          voicemail: { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, forwardToEmail: null, ringTimeout: 25 },
          smsForwarding: { toTelegram: true, toEmail: null, webhookUrl: null },
          faxForwarding: { toTelegram: true }, recording: false,
        },
      }
      await phoneNumbersOf.updateOne({ _id: chatId }, { $push: { 'val.numbers': doc } }, { upsert: true })
      await phoneTransactions.insertOne({ chatId, phoneNumber: selected, action: sub ? 'purchase_sub' : 'purchase', plan: planKey, amount: price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', ...(viaOrder ? { orderRef: viaOrder } : {}), ...(sub ? { parentNumber: sub.parentNumber } : {}), ...(coupon ? { coupon: coupon.code, discountPct: coupon.discount } : {}), channel: 'web', timestamp: new Date().toISOString() })
      if (coupon?.code) {
        if (deps.redeemCoupon) await Promise.resolve(deps.redeemCoupon(chatId, coupon.code, coupon.type)).catch(() => {})
        await notify.push(chatId, `Coupon ${coupon.code} applied: ${coupon.discount}% off ${selected}. You saved $${round2(base - price).toFixed(2)}.`, null, { kind: 'coupon', meta: { coupon: coupon.code, discount: coupon.discount, used: true } }).catch(() => {})
      }
      await txn(chatId, 'phone-number', price, { phoneNumber: selected, plan: planKey, provider: 'telnyx', country })
      if (!sub) await referrals.onPurchase(db, chatId, price, log).catch(e => log(`[CloudIVR-Web] referral payout failed: ${e.message}`))
      notifyAdmin(`🌐 CloudIVR web purchase${dryRun() ? ' (DRY RUN)' : ''}${viaOrder ? ' · crypto checkout' : ''}\nweb account: ${chatId} (${email})\nnumber: ${selected} (${country})${sub ? `\nextra number on ${sub.parentNumber}` : ''}\nplan: ${plan.name} $${price}${coupon ? ` (coupon ${coupon.code} −${coupon.discount}%)` : ''}`)
      await searchCache.deleteOne({ _id: chatId })
      return { status: 201, body: { number: publicNumber(doc), substitutedFrom: selected !== phone ? phone : null, balance: await w.balance(chatId) } }
    } catch (e) {
      await w.credit(chatId, price)
      log(`[CloudIVR-Web] purchase failed for ${chatId} ${phone}: ${e.message} — refunded $${price}`)
      return { status: 424, body: { error: 'purchase_failed', message: `${e.message && e.message.length < 160 ? e.message : 'The number could not be activated.'} You were refunded $${price.toFixed(2)}.` } }
    }
  }

  // Same coupon codes as the bot (static, daily, win-back, welcome) → { code, type, discount } or { error, message }.
  async function checkCoupon(chatId, raw) {
    const code = String(raw || '').trim().toUpperCase().slice(0, 40)
    if (!code) return { error: true, message: 'Enter a coupon code.' }
    const r = deps.resolveCoupon ? await deps.resolveCoupon(code, chatId).catch(() => null) : null
    if (r?.error === 'already_used') return { error: true, message: 'You have already used this coupon.' }
    if (!r || !(Number(r.discount) > 0)) return { error: true, message: 'That coupon code is not valid.' }
    return { code: String(r.code || code).toUpperCase(), type: r.type || 'static', discount: Math.min(90, Number(r.discount)) }
  }
  router.post('/coupons/check', h(async (req, res) => {
    const c = await checkCoupon(req.webChatId, req.body.code)
    if (c.error) return bad(res, 400, 'invalid_coupon', c.message)
    const amount = Number(req.body.amount) || 0
    res.json({ code: c.code, discount: c.discount, ...(amount > 0 ? { newPrice: round2(amount * (1 - c.discount / 100)) } : {}) })
  }))

  router.post('/numbers/buy', h(async (req, res) => {
    const picked = await pickFromSearch(req.webChatId, req.body.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    let coupon = null
    if (req.body.coupon) {
      coupon = await checkCoupon(req.webChatId, req.body.coupon)
      if (coupon.error) return bad(res, 400, 'invalid_coupon', coupon.message)
    }
    const r = await purchase({ chatId: req.webChatId, email: req.webUser.email, phone: normPhone(req.body.phoneNumber), planKey: String(req.body.plan || ''), autoRenew: req.body.autoRenew !== false, coupon, ...picked })
    res.status(r.status).json(r.body)
  }))

  router.patch('/numbers/:phone/forwarding', withNumber(async (req, res) => {
    if (!gate(req, res, 'callForwarding', 'Call forwarding')) return
    const mode = String(req.body.mode || 'disabled')
    if (!['always', 'busy', 'no_answer', 'disabled'].includes(mode)) return bad(res, 400, 'invalid_mode', 'Pick always, busy, no answer or off.')
    const to = mode === 'disabled' ? null : dialNorm(req.body.forwardTo)
    if (mode !== 'disabled') {
      if (!E164.test(to)) return bad(res, 400, 'invalid_number', 'Enter the forward number with country code, e.g. +14155550100.')
      if (phoneConfig.isBlockedPrefix(to)) return bad(res, 400, 'blocked_destination', `${to} is a blocked premium/satellite destination.`)
      if (to === req.num.phoneNumber) return bad(res, 400, 'self_forward', 'A number cannot forward to itself.')
    }
    const ringTimeout = Math.min(60, Math.max(10, parseInt(req.body.ringTimeout, 10) || 25))
    const bk = mode === 'disabled' ? { list: [] } : parseBackups(req.body.backups, [to, req.num.phoneNumber])
    if (bk.error) return bad(res, 400, 'invalid_backup', bk.error)
    const value = { enabled: mode !== 'disabled', mode, forwardTo: to, ringTimeout, holdMusic: !!req.body.holdMusic, backups: bk.list }
    await setField(req.webChatId, req.num.phoneNumber, 'features.callForwarding', value)
    res.json({ callForwarding: value })
  }))

  // "Ring me in the browser" (Pro+, same plans as text calls): inbound calls ring the open web app, which answers
  // them as text or by voice (browser phone). answerMode = what happens when it rings; lang/voice/announce = the
  // text-call defaults used when answering as text.
  router.patch('/numbers/:phone/browser-ring', withNumber(async (req, res) => {
    if (!gate(req, res, 'textRelay', 'Ringing in the browser')) return
    const b = req.body || {}, cur = req.num.features?.browserRing || {}
    const answerMode = String(b.answerMode ?? cur.answerMode ?? 'ask')
    if (!['ask', 'voice', 'text'].includes(answerMode)) return bad(res, 400, 'invalid_mode', 'Pick ask each time, always voice or always text.')
    const lang = String(b.lang ?? cur.lang ?? 'en')
    if (!['en', 'es', 'fr'].includes(lang)) return bad(res, 400, 'invalid_lang', 'Pick English, Spanish or French.')
    const voice = String(b.voice ?? cur.voice ?? 'female')
    if (!['female', 'male'].includes(voice)) return bad(res, 400, 'invalid_voice', 'Pick a female or male voice.')
    const value = { enabled: !!(b.enabled ?? cur.enabled), answerMode, lang, voice, announce: (b.announce ?? cur.announce) !== false }
    await setField(req.webChatId, req.num.phoneNumber, 'features.browserRing', value)
    res.json({ browserRing: value })
  }))

  router.patch('/numbers/:phone/voicemail', withNumber(async (req, res) => {
    if (!gate(req, res, 'voicemail', 'Voicemail')) return
    const email = String(req.body.forwardToEmail || '').trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return bad(res, 400, 'invalid_email', 'Enter a valid email for voicemail delivery.')
    const url = req.body.greetingType === 'custom' ? String(req.body.customGreetingUrl || '') : ''
    if (url && !(await ownAudioUrls(req.webChatId)).has(url)) return bad(res, 400, 'invalid_audio', 'Pick a greeting from your audio library.')
    const language = req.body.language === undefined ? (req.num.features?.voicemail?.language || 'en') : String(req.body.language)
    if (!vmGreeting.LANGS[language]) return bad(res, 400, 'invalid_language', 'Pick English, French, Spanish, Portuguese or Arabic.')
    const value = {
      ...(req.num.features?.voicemail || {}), enabled: !!req.body.enabled, greetingType: url ? 'custom' : 'default',
      // The call engine plays customAudioGreetingUrl; customGreetingUrl is kept for older readers.
      customGreetingUrl: url || null, customAudioGreetingUrl: url || null, customGreetingText: null,
      language, transcribe: req.body.transcribe !== false,
      forwardToTelegram: true, forwardToEmail: email || null, ringTimeout: Math.min(60, Math.max(10, parseInt(req.body.ringTimeout, 10) || 25)),
    }
    await setField(req.webChatId, req.num.phoneNumber, 'features.voicemail', value)
    res.json({ voicemail: publicVoicemail(value) })
  }))

  router.patch('/numbers/:phone/sms', withNumber(async (req, res) => {
    const email = String(req.body.toEmail || '').trim(), hook = String(req.body.webhookUrl || '').trim()
    if (email && !phoneConfig.canAccessFeature(req.num.plan, 'smsToEmail')) return bad(res, 403, 'plan_upgrade_required', 'SMS to email needs the Pro plan or higher.')
    if (hook && !phoneConfig.canAccessFeature(req.num.plan, 'smsWebhook')) return bad(res, 403, 'plan_upgrade_required', 'SMS webhooks need the Pro plan or higher.')
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return bad(res, 400, 'invalid_email', 'Enter a valid email.')
    if (hook && !/^https:\/\/[^\s]{4,500}$/i.test(hook)) return bad(res, 400, 'invalid_webhook', 'Webhook URL must start with https://')
    const value = { toTelegram: true, toEmail: email || null, webhookUrl: hook || null }
    await setField(req.webChatId, req.num.phoneNumber, 'features.smsForwarding', value)
    res.json({ smsForwarding: value })
  }))

  router.patch('/numbers/:phone/recording', withNumber(async (req, res) => {
    if (!gate(req, res, 'callRecording', 'Call recording')) return
    await setField(req.webChatId, req.num.phoneNumber, 'features.recording', !!req.body.enabled)
    res.json({ recording: !!req.body.enabled })
  }))

  // On/off hours (every plan). Outside the hours the number doesn't ring or forward.
  router.put('/numbers/:phone/hours', withNumber(async (req, res) => {
    let value
    try { value = numberHours.validateHours(req.body) } catch (e) { return bad(res, 400, 'invalid_hours', e.message) }
    if (value.offAction === 'voicemail' && !phoneConfig.canAccessFeature(req.num.plan, 'voicemail')) value.offAction = 'message'
    await setField(req.webChatId, req.num.phoneNumber, 'features.hours', value)
    res.json({ hours: value, openNow: numberHours.isOpen(value) })
  }))

  router.get('/numbers/:phone/hours', withNumber(async (req, res) => {
    const hours = req.num.features?.hours || numberHours.defaultHours()
    res.json({ hours, openNow: numberHours.isOpen(hours) })
  }))

  router.put('/numbers/:phone/ivr', withNumber(async (req, res) => {
    if (!gate(req, res, 'ivr', 'The keypad menu')) return
    const urls = await ownAudioUrls(req.webChatId)
    let value
    try { value = validateIvr(req.body, req.num.plan, (u) => urls.has(u)) } catch (e) { return bad(res, 400, 'invalid_ivr', e.message) }
    await setField(req.webChatId, req.num.phoneNumber, 'features.ivr', value)
    // One answers a number: the keypad menu going on switches the AI voice agent off.
    const ai = req.num.features?.aiAgent
    const aiAgentTurnedOff = !!(value.enabled && ai?.enabled)
    if (aiAgentTurnedOff) await setField(req.webChatId, req.num.phoneNumber, 'features.aiAgent', { ...ai, enabled: false })
    res.json({ ivr: value, aiAgentTurnedOff })
  }))

  router.get('/numbers/:phone/ivr/analytics', withNumber(async (req, res) => {
    if (!gate(req, res, 'ivr', 'IVR analytics')) return
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const rows = await db.collection('ivrAnalytics').aggregate([
      { $match: { phoneNumber: req.num.phoneNumber, timestamp: { $gte: since } } },
      { $group: { _id: { digit: '$digit', action: '$action' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray()
    res.json({ since, keys: rows.map(r => ({ digit: r._id.digit, action: r._id.action, count: r.count })) })
  }))

  router.get('/numbers/:phone/logs', withNumber(async (req, res) => {
    const kind = String(req.query.kind || 'all')
    const q = { phoneNumber: req.num.phoneNumber }
    if (LOG_TYPES[kind]) q.type = { $in: LOG_TYPES[kind] }
    else if (kind === 'calls') q.type = { $nin: ['sms', 'sms_out', 'fax'] }
    else if (kind === 'recordings') q.recordingUrl = { $nin: [null, ''] }
    const rows = await phoneLogs.find(q).sort({ timestamp: -1 }).limit(100).toArray()
    const texts = rows.some(l => smsReplyMod.canReply(l)) ? await phoneLogs.find({ phoneNumber: req.num.phoneNumber, type: 'sms_out', timestamp: { $gte: new Date(Date.now() - 8 * 86400000).toISOString() } }).toArray() : []
    const logs = smsReplyMod.markReplied(rows, texts).map(publicLog)
    res.json({ logs: await notes.attachNotes(db, req.webChatId, req.num.phoneNumber, logs) })
  }))

  router.get('/activity', h(async (req, res) => {
    const phones = (await myNumbers(req.webChatId)).map(n => n.phoneNumber)
    const logs = phones.length ? await phoneLogs.find({ phoneNumber: { $in: phones } }).sort({ timestamp: -1 }).limit(Math.min(100, parseInt(req.query.limit, 10) || 30)).toArray() : []
    res.json({ logs: logs.map(publicLog) })
  }))

  router.get('/numbers/:phone/sip', withNumber(async (req, res) => {
    if (!gate(req, res, 'sipCredentials', 'SIP credentials')) return
    const n = req.num
    res.json({ username: n.telnyxSipUsername || n.sipUsername, password: n.telnyxSipPassword || n.sipPassword, domain: phoneConfig.WEB_SIP_DOMAIN, port: 5060, transport: 'UDP/TCP/TLS', live: !!n.telnyxSipUsername })
  }))

  router.post('/numbers/:phone/sip/reset', withNumber(async (req, res) => {
    if (!gate(req, res, 'sipCredentials', 'SIP credentials')) return
    const n = req.num, tr = getTelnyxResources() || {}
    let user = phoneConfig.generateSipUsername(), pass = phoneConfig.generateSipPassword(), credId = null
    if (!dryRun() && tr.sipConnectionId) {
      const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, user, pass, n.phoneNumber)
      if (!cred?.sip_username) return bad(res, 424, 'sip_reset_failed', 'Could not create new SIP credentials. Your current ones still work.')
      user = cred.sip_username; pass = cred.sip_password || pass; credId = cred.id || null
      if (n.telnyxCredentialId) await telnyxApi.deleteSIPCredential(n.telnyxCredentialId).catch(() => {})
    }
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.sipUsername': user, 'val.numbers.$.sipPassword': pass, 'val.numbers.$.telnyxSipUsername': dryRun() ? n.telnyxSipUsername || null : user, 'val.numbers.$.telnyxSipPassword': dryRun() ? n.telnyxSipPassword || null : pass, 'val.numbers.$.telnyxCredentialId': credId || n.telnyxCredentialId || null } })
    res.json({ username: user, password: pass, domain: phoneConfig.WEB_SIP_DOMAIN })
  }))

  router.post('/numbers/:phone/auto-renew', withNumber(async (req, res) => {
    await setField(req.webChatId, req.num.phoneNumber, 'autoRenew', !!req.body.enabled)
    res.json({ autoRenew: !!req.body.enabled })
  }))

  // Wallet renewal; restoring a suspended main line also brings back its extra lines (see plan-lifecycle.js).
  router.post('/numbers/:phone/renew', withNumber(async (req, res) => {
    const numbers = (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val?.numbers || []
    const n = numbers.find(x => x.phoneNumber === req.num.phoneNumber && x.status !== 'released') || req.num
    const block = lifecycle.renewBlock(numbers, n)
    if (block === 'main_line_suspended') return bad(res, 409, block, 'This extra line comes back when its main line is restored. Renew the main line first.')
    if (block) return bad(res, 409, block, block === 'released' ? 'This number has been released and can no longer be renewed.' : 'We could not work out the renewal price for this line. Please contact support.')
    const price = round2(lifecycle.renewalPrice(n))
    if (price > 0 && !(await w.debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `Renewal costs $${price.toFixed(2)}. Top up your wallet first.`)
    const r = lifecycle.renewPatches(numbers, n)
    await lifecycle.applyDb(phoneNumbersOf, req.webChatId, r.patches)
    const action = r.wasSuspended ? 'restore' : 'renew'
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action, plan: n.plan, amount: price, paymentMethod: 'wallet_usd', channel: 'web', restoredExtras: r.restored, timestamp: new Date().toISOString() })
    await txn(req.webChatId, 'phone-renewal', price, { phoneNumber: n.phoneNumber, plan: n.plan, action })
    res.json({ expiresAt: r.expiresAt, price, restored: r.restored, waiting: r.waiting, balance: await w.balance(req.webChatId) })
  }))

  // Price to move `n` up to `newPlan` now → { charge, credit, newPrice } or { error } (HTTP-style).
  function upgradeQuote(n, newPlan) {
    const order = Object.keys(phoneConfig.plans)
    if (n.isSubNumber) return { error: { status: 400, error: 'is_extra', message: 'Extra numbers follow the plan of their main number.' } }
    if (lifecycle.onHold(n)) return { error: { status: 409, error: 'suspended', message: 'Restore this number first (Renew now), then change its plan.' } }
    if (!phoneConfig.plans[newPlan] || order.indexOf(newPlan) <= order.indexOf(n.plan)) return { error: { status: 400, error: 'invalid_plan', message: 'Pick a higher plan than the current one.' } }
    const q = phoneConfig.computeUpgradeQuote(n, newPlan)
    // Keep the number's surcharge (e.g. international) on top of the new plan price, as downgrade does.
    const surcharge = Math.max(0, round2((n.planPrice || phoneConfig.plans[n.plan].price) - phoneConfig.plans[n.plan].price))
    return { charge: round2(q && Number.isFinite(q.chargeAmount) ? q.chargeAmount : phoneConfig.plans[newPlan].price), credit: round2(q?.credit || 0), newPrice: round2(phoneConfig.plans[newPlan].price + surcharge) }
  }

  // Charges the wallet and switches the plan → { status, body }. viaOrder = crypto order ref that paid for it.
  async function upgradeNumber(chatId, n, newPlan, viaOrder = null) {
    const q = upgradeQuote(n, newPlan)
    if (q.error) return { status: q.error.status, body: { error: q.error.error, message: q.error.message } }
    if (!(await w.debit(chatId, q.charge))) return { status: 402, body: { error: 'insufficient_balance', message: `The upgrade costs $${q.charge.toFixed(2)}. Top up your wallet first.` } }
    // Switch back on what a downgrade turned off, when the new plan includes it.
    const set = { 'val.numbers.$.plan': newPlan, 'val.numbers.$.planPrice': q.newPrice, 'val.numbers.$.sipDisabled': false }
    const saved = n.downgradeSaved || []
    for (const x of saved) if (phoneConfig.canAccessFeature(newPlan, x.key)) set[`val.numbers.$.${x.path}`] = x.value
    set['val.numbers.$.downgradeSaved'] = saved.filter(x => !phoneConfig.canAccessFeature(newPlan, x.key))
    await phoneNumbersOf.updateOne({ _id: chatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: set })
    await phoneNumbersOf.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].plan': newPlan } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': n.phoneNumber }] }).catch(() => {})
    await phoneTransactions.insertOne({ chatId, phoneNumber: n.phoneNumber, action: 'upgrade', oldPlan: n.plan, newPlan, oldPrice: n.planPrice, newPrice: q.newPrice, amount: q.charge.toFixed(2), credit: q.credit.toFixed(2), paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', ...(viaOrder ? { orderRef: viaOrder } : {}), channel: 'web', timestamp: new Date().toISOString() })
    await txn(chatId, 'phone-upgrade', q.charge, { phoneNumber: n.phoneNumber, plan: newPlan })
    if (viaOrder) notifyAdmin(`🌐 CloudIVR web: ${n.phoneNumber} upgraded ${phoneConfig.plans[n.plan]?.name} → ${phoneConfig.plans[newPlan].name} · crypto checkout $${q.charge}\nweb account: ${chatId}`)
    return { status: 200, body: { plan: newPlan, charged: q.charge, balance: await w.balance(chatId) } }
  }

  router.post('/numbers/:phone/upgrade', withNumber(async (req, res) => {
    const newPlan = String(req.body.plan || '')
    const q = upgradeQuote(req.num, newPlan)
    if (q.error) return bad(res, q.error.status, q.error.error, q.error.message)
    if (req.body.confirm !== true) return res.json({ quote: q })
    const r = await upgradeNumber(req.webChatId, req.num, newPlan)
    res.status(r.status).json(r.body)
  }))

  router.delete('/numbers/:phone', withNumber(async (req, res) => {
    const n = req.num
    if (req.body?.confirm !== n.phoneNumber) return bad(res, 400, 'confirm_required', 'Type the number to confirm deletion.')
    if (!dryRun() && !n.dryRun) {
      const ok = n.telnyxOrderId ? await telnyxApi.releaseNumber(n.telnyxOrderId) : false
      if (!ok) await telnyxApi.releaseByPhoneNumber(n.phoneNumber)
      if (n.telnyxCredentialId) await telnyxApi.deleteSIPCredential(n.telnyxCredentialId).catch(() => {})
    }
    await setField(req.webChatId, n.phoneNumber, 'status', 'released')
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'release', plan: n.plan, amount: 0, paymentMethod: 'none', channel: 'web', timestamp: new Date().toISOString() })
    notifyAdmin(`🌐 CloudIVR web: number deleted ${n.phoneNumber} by web account ${req.webChatId}`)
    res.json({ released: true })
  }))

  return { myNumbers, findMine, purchase, pickFromSearch, searchSimilar, setField, checkCoupon, unheld, ownAudioUrls, upgradeQuote, upgradeNumber }
}

module.exports = { parseBackups, routes, catalog, routeSummary, publicNumber, publicVoicemail, validateIvr, normPhone, countries, E164, webFeatures, recommendedPlan, WEB_FEATURES }
