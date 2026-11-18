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
const safeUrl = require('../safe-url')
const browserCallKey = require('../browser-call-key')

const TYPE_NAMES = { local: 'Local', toll_free: 'Toll-free', mobile: 'Mobile', national: 'National' }
const FEATURE_KEYS = ['callForwarding', 'smsToEmail', 'smsWebhook', 'voicemail', 'sipCredentials', 'browserPhone', 'callRecording', 'ivr', 'ivrOutbound', 'bulkCall', 'otpCollection', 'aiAgent', 'aiCampaigns', 'textRelay', 'ringGroup', 'textTriggers', 'aiSummary', 'browserRing', 'ivrRedial', 'otpCustomMessages', 'ivrSchedule', 'ivrPresets', 'consistentVoice']
const LOG_TYPES = { sms: ['sms', 'sms_out'], voicemail: ['voicemail'], fax: ['fax'] }
const E164 = /^\+[1-9]\d{7,14}$/
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const webText = (s) => String(s).replace(/Telegram/g, 'your inbox')

// Country code required (owner rule 2026-11): 4155550100 / 07911… are rejected instead of guessed.
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+'); if (!d) return ''; if (d.startsWith('+')) return d; return /^1\d{10}$/.test(d) || (d.length > 11 && !d.startsWith('0')) ? `+${d}` : '' }
// Numbers typed to dial (forward-to, backups, IVR forward keys): the bot's auto-correct (10-digit US → +1).
const dialNorm = require('../backup-numbers').norm
const { dialIssue } = require('../dial-check')
const bad = (res, status, error, message, extra) => res.status(status).json({ error, message, ...extra })
// Up to `max` backup numbers rung in order when the main one is busy or doesn't answer → { list } | { error }.
function parseBackups(raw, exclude = [], max = 4) {
  const tokens = (Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]+|\s+(?=\+)/)).map(t => String(t || '').trim()).filter(Boolean)
  const junk = tokens.find(t => !/^\+?[\d\s().-]+$/.test(t))
  if (junk) return { error: `Backup "${junk.slice(0, 20)}" is not a phone number. Use the country code, e.g. +14155550100.` }
  const items = tokens.map(dialNorm).filter(Boolean)
  const list = [...new Set(items)].filter(n => !exclude.includes(n))
  if (list.length > max) return { error: `Add up to ${max} backup numbers.` }
  for (const n of list) {
    if (!E164.test(n)) return { error: `Backup ${n}: use the country code, e.g. +14155550100.` }
    if (dialIssue(n)) return { error: `Backup ${dialIssue(n)}` }
    if (phoneConfig.isBlockedPrefix(n)) return { error: `Backup ${n} is a blocked premium/satellite destination.` }
  }
  return { list }
}

// Saved hours, or the default Mon–Fri schedule (closed message instead of voicemail on plans without voicemail).
const hoursOf = (n) => n.features?.hours || { ...numberHours.defaultHours(), offAction: phoneConfig.canAccessFeature(n.plan, 'voicemail') ? 'voicemail' : 'message' }

// US/CA only while NUMBER_SEARCH_US_CA_ONLY is on (SignalWire sells only these); otherwise the full catalogue.
function countries() {
  const intl = (!phoneConfig.numberSearchUsCaOnly() && phoneConfig.isTelnyxIntlEnabled()) ? [...phoneConfig.telnyxIntlCountries, ...phoneConfig.telnyxIntlMore] : []
  const list = [...phoneConfig.countries, ...intl].map(c => {
    const i = c.name.indexOf(' ')
    return { code: c.code, flag: c.name.slice(0, i), name: c.name.slice(i + 1), types: c.types || ['local', 'toll_free'] }
  })
  const have = new Map(list.map(c => [c.code, c]))
  for (const [code, types] of Object.entries(numberCatalog.sold())) {
    const c = have.get(code)
    if (c) c.types = [...new Set([...c.types, ...types])]
    else list.push({ code, flag: ibCountries.FLAG(code), name: numberCatalog.nameOf(code), types })
  }
  // offers[type] = who sells it and the paperwork it needs (absent = the US/CA provider chain).
  for (const c of list) {
    c.included = phoneConfig.includedTier(c.code)
    c.offers = {}
    for (const t of c.types) {
      const b = numberCatalog.best(c.code, t)
      // caps: what the number can do; smsNeedsApproval: US local texting needs 10DLC, US/CA toll-free needs verification.
      const sms = b ? !!b.sms : ['US', 'CA'].includes(c.code)
      const caps = { voice: true, sms, fax: ['US', 'CA'].includes(c.code) && t !== 'mobile', smsNeedsApproval: sms && c.code === 'US' }
      if (!b) c.offers[t] = { provider: null, level: 0, caps, included: phoneConfig.instantNoId(c.code, t) }
      if (b) c.offers[t] = { caps, included: phoneConfig.instantNoId(c.code, t), provider: b.provider, level: b.level, ...(b.businessOnly ? { businessOnly: true } : {}), ...(b.level && b.address ? { address: b.address } : {}), ...(b.request ? { request: b.request } : {}) }
    }
  }
  return list.sort((a, b) => (['US', 'CA'].indexOf(b.code) - ['US', 'CA'].indexOf(a.code)) || a.name.localeCompare(b.name))
}
const ibCountries = require('../infobip/countries')
const numberCatalog = require('../number-catalog')
const texting = require('../texting-countries')
// US/CA keep the provider chain (area codes, toll-free) — it now tries the cheapest no-paperwork provider first.
const ownProvider = (c, type) => (['US', 'CA'].includes(c?.code) ? null : c?.offers?.[type]?.provider || null)

// What each plan gets IN THE WEB APP. The bot's plan copy lists Telegram-only extras (redial button, presets,
// sub-numbers…), so plan cards use this list instead. `gate` is the engine feature check; null = every plan.
// Grouped for the plan cards: answer (incoming calls), calls (outgoing), ai, account.
const WEB_FEATURES = [
  ['emily', 'Emily — set up menus, calls and campaigns just by chatting', null, 'account'],
  ['forwarding', 'Call forwarding to any phone', 'callForwarding', 'answer'],
  ['voicemail', () => `Voicemail in ${vmGreeting.LANG_CODES.length} languages + transcripts`, 'voicemail', 'answer'],
  ['hours', 'On/off hours for each number', null, 'answer'],
  ['ivr', 'Keypad menu (IVR) — press 1 for sales, with key stats', 'ivr', 'answer'],
  ['ringGroup', 'Ring groups — ring several phones at once', 'ringGroup', 'answer'],
  ['recording', 'Call recording', 'callRecording', 'answer'],
  ['browserPhone', 'Browser phone — make and take calls in any browser tab', 'browserPhone', 'calls'],
  ['sip', 'SIP logins for desk phones and softphone apps, with live signed-in status', 'sipCredentials', 'calls'],
  ['quickIvr', 'Quick IVR — automated calls to up to 10 people', 'ivrOutbound', 'calls'],
  ['callMeFirst', 'Call me first — calls through your mobile', 'ivrOutbound', 'calls'],
  ['bulk', 'Recorded-message campaigns to a whole list', 'bulkCall', 'calls'],
  ['otp', 'Verify your customers identity via OTP', 'otpCollection', 'calls'],
  ['schedulePresets', 'Scheduled calls and saved call presets', 'ivrSchedule', 'calls'],
  ['anyCallerId', 'Custom caller ID — call from any number', (plan) => plan === 'business', 'calls'],
  ['redial', 'Redial and your own accept / decline messages for codes', 'ivrRedial', 'calls'],
  ['aiAgent', 'AI receptionist — real conversations with your callers, books and takes messages (pay as you use)', 'aiAgent', 'ai'],
  ['aiSummary', 'AI summaries & caller mood for voicemails and recorded calls', 'aiSummary', 'ai'],
  ['aiCampaigns', 'AI conversation campaigns — an AI talks with each lead, free test call first (pay as you use)', 'aiCampaigns', 'ai'],
  ['defaultVoice', 'One saved AI voice for all your calls', 'consistentVoice', 'ai'],
  ['textTriggers', 'Text Triggers — a text starts a callback, a spoken reply or an AI call', 'textTriggers', 'ai'],
  ['textRelay', 'Text calls for deaf & hard-of-hearing users', 'textRelay', 'ai'],
  ['inbox', 'SMS inbox — read texts and reply', null, 'account'],
  ['smsEmail', 'SMS to email & webhooks', 'smsToEmail', 'account'],
  ['notes', 'Call notes and private mode', null, 'account'],
  ['calendar', 'Renewal dates in Google or Apple Calendar', null, 'account'],
  ['encryptedCalls', 'Encrypted calls (SRTP) — audio encrypted in transit', (plan) => plan === 'business', 'account'],
  ['priority', 'Priority support', (plan) => plan === 'business', 'account'],
]
const TEXTING_KEYS = ['inbox', 'smsEmail', 'textTriggers']
const webFeatures = (plan) => WEB_FEATURES.filter(([key]) => phoneConfig.PLAN_TEXTING() || !TEXTING_KEYS.includes(key)).map(([key, label, gate, group]) => ({
  key, group, label: typeof label === 'function' ? label() : label, included: gate === null ? true : typeof gate === 'function' ? gate(plan) : !!phoneConfig.canAccessFeature(plan, gate),
}))

// Plan pre-selected on the buy page and badged "Recommended" (Pro unless switched off).
function recommendedPlan() {
  const want = String(process.env.CLOUDIVR_RECOMMENDED_PLAN || 'pro')
  return [want, 'pro', 'standard', 'business', 'starter'].find(id => phoneConfig.plans[id] && phoneConfig.isPlanAvailable(id)) || null
}

// US/Canada per-minute rate for outgoing calls (browser phone, softphone, Quick IVR, campaigns); other countries use the forwarding rate.
const outboundRate = () => { try { return require('../voice-service').IVR_CALL_RATE } catch (_) { return parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15') } }

const catalog = () => {
  const rec = recommendedPlan()
  return {
    plans: Object.entries(phoneConfig.plans).map(([id, p]) => ({ id, name: p.name, price: p.price, minutes: p.minutes, sms: p.sms, features: p.features.map(webText), webFeatures: webFeatures(id), recommended: id === rec, available: phoneConfig.isPlanAvailable(id), access: access(id) })),
    recommendedPlan: rec,
    voicemailLanguages: vmGreeting.publicLangs(),
    countries: countries(), typeNames: TYPE_NAMES,
    rates: { forwardingPerMin: phoneConfig.CALL_FORWARDING_RATE_MIN, overagePerMin: phoneConfig.OVERAGE_RATE_MIN, overagePerSms: phoneConfig.OVERAGE_RATE_SMS, aiAgentPerMin: require('../ai-agent').RATE(), aiReceptionPerMin: require('../ai-agent').RECEPTION_RATE(), aiSummaryPerMin: require('./ai-summary').RATE(), outboundPerMinUsCa: outboundRate(), outboundPerMinIntl: phoneConfig.CALL_FORWARDING_RATE_MIN },
    sipDomain: phoneConfig.WEB_SIP_DOMAIN, dryRun: dryRun(), livePayments: livePayments(), planTexting: phoneConfig.PLAN_TEXTING(),
    // Cards show as "coming soon" on the site until this is true (the checkout's card option is still disabled too).
    cardPayments: String(process.env.CLOUDIVR_CARD_PAYMENTS || '').toLowerCase() === 'true',
    texting: { ...require('../hosted-sms.js').TEXTING, available: require('../hosted-sms.js').AVAILABLE, numberPrice: phoneConfig.plans?.starter?.price ?? null },
    enterprise: { price: phoneConfig.ENTERPRISE_PRICE },
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
  const _fa = n.features?.callForwarding
  if (n.features?.aiAgent?.enabled && phoneConfig.canAccessFeature(n.plan, 'aiAgent') && !(_fa?.enabled && _fa.mode === 'always' && _fa.forwardTo)) return { primary: 'ai_agent', forwardTo: null, skipped: [], brokenIvr: false }
  const rg = n.features?.ringGroup
  if (rg?.enabled && rg.members?.length && phoneConfig.canAccessFeature(n.plan, 'ringGroup')) return { primary: 'ring_group', forwardTo: null, members: rg.members, skipped: [], brokenIvr: false }
  try {
    const r = phoneConfig.getCallRouteSummary(n) || {}
    return { primary: r.primary?.action || 'missed', forwardTo: r.primary?.forwardTo || null, skipped: r.skippedFeatures || [], brokenIvr: !!r.hasBrokenIvr }
  } catch (_) { return { primary: 'missed', forwardTo: null, skipped: [] } }
}

// `numbers` = the owner's lines, so usage shows the shared allowance of the main line + its extra lines.
function publicNumber(n, numbers) {
  return { ..._publicNumber(n, numbers), callFlow: require('../call-flow').callFlow(n) }
}
function _publicNumber(n, numbers) {
  const plan = phoneConfig.plans[n.plan] || {}
  const pool = lifecycle.poolUsage(numbers || [n], n)
  const poolPlan = phoneConfig.plans[pool.main.plan] || plan
  const f = n.features || {}
  return {
    phoneNumber: n.phoneNumber, country: n.country, countryName: n.countryName, type: n.type,
    plan: n.plan, planName: plan.name || n.plan, planPrice: n.planPrice, status: n.status, autoRenew: n.autoRenew !== false,
    registration: n.registration ? { status: n.registration.status, documentsSent: !!n.registration.documentsSent, needsDetails: n.registration.status === 'needs_details', ...(n.registration.status === 'needs_details' ? { level: n.registration.level || 0, refundBy: new Date(new Date(n.registration.since).getTime() + 14 * 864e5).toISOString() } : {}) } : null,
    renewalPrice: lifecycle.renewalPrice(n), holdUntil: lifecycle.onHold(n) ? n._holdUntil : null, suspendReason: lifecycle.onHold(n) ? n._suspendReason || null : null,
    purchaseDate: n.purchaseDate, expiresAt: n.expiresAt, isSubNumber: !!n.isSubNumber, parentNumber: n.parentNumber || null, dryRun: !!n.dryRun,
    extraLines: n.isSubNumber ? [] : lifecycle.extrasOf(numbers || [], n).filter(x => x.status === 'active').map(x => x.phoneNumber),
    replacedBy: n.replacedBy || null, releaseAt: n.releaseAt || null, replaces: n.replaces || null,
    routeSummary: routeSummary(n),
    capabilities: n.capabilities || { voice: true, sms: true, fax: false },
    usage: { minutesUsed: pool.minutesUsed, minutesIncluded: poolPlan.minutes ?? null, smsUsed: pool.smsUsed, smsIncluded: poolPlan.sms ?? null, shared: pool.lines.length > 1 },
    sipUsername: n.telnyxSipUsername || n.sipUsername || null, sipDomain: phoneConfig.WEB_SIP_DOMAIN,
    features: {
      callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false, backups: [], ...(f.callForwarding || {}) },
      voicemail: publicVoicemail(f.voicemail),
      hours: hoursOf(n),
      smsForwarding: f.smsForwarding || { toTelegram: true, toEmail: null, webhookUrl: null },
      fax: { toInbox: f.faxForwarding?.toTelegram !== false, line: f.faxLine?.enabled === true },
      recording: !!f.recording,
      ivr: f.ivr || { enabled: false, options: {} },
      aiAgent: f.aiAgent || { enabled: false, agentId: null },
      browserRing: { enabled: false, answerMode: 'ask', lang: 'en', voice: 'female', announce: true, ...(f.browserRing || {}) },
      ringGroup: { ...require('./ring-group').defaults(), ...(f.ringGroup || {}) },
      textTriggers: { enabled: !!f.textTriggers?.enabled, count: (f.textTriggers?.rules || []).length },
      aiSummary: { enabled: !!f.aiSummary?.enabled },
      missedTextBack: f.missedTextBack || { enabled: false, text: null },
      texting: { available: (!!(n.capabilities || { sms: true }).sms || require('./ten-dlc').needs10dlc(n) || require('./tollfree').needsTfv(n)) && phoneConfig.PLAN_TEXTING(), enabled: f.sms === true && (n.capabilities || { sms: true }).sms !== false, mode: require('./tollfree').needsTfv(n) ? 'tollfree' : require('./ten-dlc').needs10dlc(n) ? 'tendlc' : (n.capabilities || { sms: true }).sms ? 'direct' : 'none', textPrice: texting.localTextPrice(n) || texting.TEXT_MIN },
    },
    access: access(n.plan),
  }
}

// audioOk(url) → true when the url is one of the account's own library files.
function validateIvr(body, plan, audioOk = () => true, ctx = {}) {
  const ivr = body || {}
  // Spoken menu language = the web app's language when saved (unset/other = English).
  const language = vmGreeting.IVR_LANGS.includes(ivr.language) ? ivr.language : 'en'
  const speech = vmGreeting.ivrSpeech(language)
  const audio = (url, where) => {
    if (!url) return null
    if (!audioOk(url)) throw new Error(`${where}: pick an audio file from your library.`)
    return String(url)
  }
  const hookUrl = (raw, digit) => {
    const u = String(raw || '').trim().slice(0, 300)
    const q = safeUrl.quickCheck(u)
    if (!q.ok) throw new Error(`Key ${digit}: ${q.reason === 'private_address' ? 'that address leads to a private or internal network — use a public https:// address.' : 'enter a web address that starts with https://'}`)
    return u
  }
  const fwd = (raw, digit) => {
    const to = dialNorm(raw)
    if (!E164.test(to)) throw new Error(`Key ${digit}: enter the number with country code, e.g. +14155550100.`)
    if (dialIssue(to)) throw new Error(`Key ${digit}: ${dialIssue(to)}`)
    if (phoneConfig.isBlockedPrefix(to)) throw new Error(`Key ${digit}: ${to} is a blocked premium/satellite destination.`)
    return to
  }
  // Live data: where a key checks what the caller typed (your database or your system's reply), and whether you confirm by hand.
  const txt = (v, n) => String(v || '').trim().slice(0, n)
  const checkOf = (o, digit, { url, amount } = {}) => {
    const c = o.check || {}
    if (c.source === 'reply') { if (!url) throw new Error(`Key ${digit}: add the https address of your system, so it can answer.`); return { source: 'reply', notFound: txt(c.notFound, 300) } }
    if (c.source !== 'db') return null
    if (!/^ic_[0-9a-f]+$/.test(String(c.connId || ''))) throw new Error(`Key ${digit}: connect your database first.`)
    if (!txt(c.table, 120) || !txt(c.match, 120)) throw new Error(`Key ${digit}: pick the table and the column to look in.`)
    if (amount && !txt(c.amountColumn, 120)) throw new Error(`Key ${digit}: pick the column that holds the amount to pay.`)
    return { source: 'db', connId: String(c.connId), table: txt(c.table, 120), match: txt(c.match, 120), say: txt(c.say, 500), routeColumn: txt(c.routeColumn, 120), amountColumn: txt(c.amountColumn, 120), notFound: txt(c.notFound, 300) }
  }
  // Department mailbox on a voicemail: its name (said in the Inbox) and who gets the email copy.
  const boxOf = (b, digit) => {
    const name = txt(b?.name, 40), email = txt(b?.email, 120).toLowerCase(), greeting = txt(b?.greeting, 300)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Key ${digit}: the mailbox email address does not look right.`)
    return name || email || greeting ? { name, email, greeting } : null
  }
  const outcomeOf = (v, digit, which) => {
    const a = ['message', 'forward', 'menu', 'voicemail', 'end'].includes(v?.action) ? v.action : null
    if (!a) return null
    if (a === 'voicemail' && !phoneConfig.canAccessFeature(plan, 'voicemail')) throw new Error(`Key ${digit}: voicemail after ${which} needs the Starter plan or higher.`)
    return { action: a, message: txt(v.message, 300), forwardTo: a === 'forward' ? fwd(v.forwardTo, `${digit} (when you press ${which})`) : '' }
  }
  const confirmOf = (o, digit) => {
    if (o.confirm !== true) return {}
    const onAccept = outcomeOf(o.onAccept, digit, 'Accept'), onDecline = outcomeOf(o.onDecline, digit, 'Decline')
    return { confirm: true, confirmTimeout: o.confirmTimeout === 'voicemail' && phoneConfig.canAccessFeature(plan, 'voicemail') ? 'voicemail' : 'decline', declineMessage: txt(o.declineMessage, 300), ...(['pin', 'collect'].includes(o.action) && txt(o.replayMessage, 300) ? { replayMessage: txt(o.replayMessage, 300) } : {}), ...(onAccept ? { onAccept } : {}), ...(onDecline ? { onDecline } : {}) }
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
        if (dialIssue(to)) throw new Error(`Key ${digit}: ${dialIssue(to)}`)
        if (phoneConfig.isBlockedPrefix(to)) throw new Error(`Key ${digit}: ${to} is a blocked premium/satellite destination.`)
        out[digit] = { action, forwardTo: to, label }
      } else if (action === 'message') {
        if (!o.message && !o.audioUrl) throw new Error(`Key ${digit}: add a message or pick an audio file.`)
        out[digit] = { action, message: String(o.message || '').slice(0, 1000), audioUrl: audio(o.audioUrl, `Key ${digit}`), label }
      } else if (action === 'sms') {
        const smsFrom = String(o.smsFrom || '')
        const sl = require('./sms-limit')
        const texts = (Array.isArray(o.smsTexts) && o.smsTexts.length ? o.smsTexts : [o.smsText]).map(t => sl.gsmText(String(t || '').trim()).slice(0, 1000)).filter(Boolean).slice(0, 5)
        const smsText = texts[0] || ''
        if (!/^(es|mn)_[0-9a-f]+$/.test(smsFrom)) throw new Error(`Key ${digit}: pick the number the text is sent from.`)
        if (!smsText) throw new Error(`Key ${digit}: write the text to send.`)
        const long = texts.map(t => sl.smsTooLong(t)).find(Boolean)
        if (long) throw new Error(`Key ${digit}: ${long}`)
        out[digit] = { action, smsFrom, smsText, ...(texts.length > 1 ? { smsTexts: texts } : {}), message: String(o.message || '').slice(0, 500), after: o.after === 'menu' ? 'menu' : 'hangup', label }
      } else if (action === 'voicemail') {
        if (!phoneConfig.canAccessFeature(plan, 'voicemail')) throw new Error('Voicemail needs the Starter plan or higher.')
        const box = boxOf(o.box, digit)
        out[digit] = { action, label, ...(box ? { box } : {}) }
      } else if (action === 'devices') {
        if (!ctx.sipLogin) throw new Error(`Key ${digit}: this number has no browser phone / phone app login yet — set one up in the Phone apps tab first.`)
        const noAnswer = ['voicemail', 'menu', 'message'].includes(o.noAnswer) ? o.noAnswer : 'voicemail'
        if (noAnswer === 'voicemail' && !phoneConfig.canAccessFeature(plan, 'voicemail')) throw new Error(`Key ${digit}: voicemail when nobody answers needs the Starter plan or higher.`)
        const box = noAnswer === 'voicemail' ? boxOf(o.box, digit) : null
        out[digit] = { action, label, ringSecs: Math.min(60, Math.max(10, Math.round(Number(o.ringSecs)) || 25)), noAnswer, noAnswerMessage: noAnswer === 'message' ? txt(o.noAnswerMessage, 300) : '', ...(box ? { box } : {}) }
      } else if (action === 'ringgroup') {
        if (!phoneConfig.canAccessFeature(plan, 'ringGroup')) throw new Error(`Key ${digit}: the team group needs the Pro plan or higher.`)
        if (!ctx.ringGroupMembers) throw new Error(`Key ${digit}: add your team's phones in the Ring group tab first (it can stay switched off).`)
        out[digit] = { action, label }
      } else if (action === 'ai') {
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(o.agentId || ''))) throw new Error(`Key ${digit}: pick the AI agent that should take these calls.`)
        out[digit] = { action, label, agentId: String(o.agentId), message: txt(o.message, 300), unavailableMessage: txt(o.unavailableMessage, 300) }
      } else if (action === 'fax') {
        if (!E164.test(String(o.faxFrom || ''))) throw new Error(`Key ${digit}: pick the fax number that sends the document (get one in Fax if you have none).`)
        if (!/^[0-9a-f]{24}$/.test(String(o.fileId || ''))) throw new Error(`Key ${digit}: upload the document callers should receive.`)
        out[digit] = { action, label, faxFrom: String(o.faxFrom), fileId: String(o.fileId), pages: Math.min(20, Math.max(1, Math.round(Number(o.pages)) || 1)), docName: txt(o.docName, 80) || 'document.pdf', prompt: txt(o.prompt, 300), message: txt(o.message, 300), after: o.after === 'menu' ? 'menu' : 'hangup' }
      } else if (action === 'callback') {
        const auto = o.auto === true
        out[digit] = { action, label, message: txt(o.message, 300), auto, callbackTo: auto ? fwd(o.callbackTo, digit) : '' }
      } else if (action === 'queue') {
        const agents = [...new Set((Array.isArray(o.agents) ? o.agents : String(o.agents || '').split(/[\s,;]+/)).filter(Boolean).map(a => fwd(a, digit)))]
        if (!agents.length) throw new Error(`Key ${digit}: add at least one phone for the queue to ring.`)
        if (agents.length > 5) throw new Error(`Key ${digit}: a queue can ring up to 5 phones.`)
        const ov = o.overflow || {}
        const ovAction = ['voicemail', 'forward', 'message'].includes(ov.action) ? ov.action : 'message'
        if (ovAction === 'voicemail' && !phoneConfig.canAccessFeature(plan, 'voicemail')) throw new Error(`Key ${digit}: voicemail as the queue's last resort needs the Starter plan or higher.`)
        out[digit] = { action, agents, maxWait: Math.min(900, Math.max(30, Math.round(Number(o.maxWait)) || 180)), ringSecs: Math.min(40, Math.max(10, Math.round(Number(o.ringSecs)) || 20)), announcePosition: o.announcePosition !== false, callback: o.callback === true, message: String(o.message || '').slice(0, 300),
          overflow: { action: ovAction, forwardTo: ovAction === 'forward' ? fwd(ov.forwardTo, digit) : '', message: ovAction === 'message' ? String(ov.message || '').slice(0, 300) : '' }, label }
      } else if (action === 'pay') {
        const sl = require('./sms-limit')
        const smsFrom = String(o.smsFrom || '')
        if (!/^(es|mn)_[0-9a-f]+$/.test(smsFrom)) throw new Error(`Key ${digit}: pick the number the payment link is texted from.`)
        const payNote = sl.gsmText(String(o.payNote || '').trim()).slice(0, 300)
        const rest = { payNote, smsFrom, message: String(o.message || '').slice(0, 500), after: o.after === 'menu' ? 'menu' : 'hangup', label }
        if (o.payVia === 'provider') {
          if (!/^ic_[0-9a-f]+$/.test(String(o.connId || ''))) throw new Error(`Key ${digit}: connect your payment provider first.`)
          const currency = String(o.currency || 'USD').toUpperCase()
          if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Key ${digit}: enter a 3-letter currency, e.g. USD.`)
          const lookup = o.amountFrom === 'lookup'
          const amount = lookup ? 0 : Math.round(Number(o.amount) * 100) / 100
          if (!lookup && !(amount > 0 && amount < 1000000)) throw new Error(`Key ${digit}: enter the amount to charge.`)
          const prompt = txt(o.prompt, 500), url = lookup && o.check?.source === 'reply' ? hookUrl(o.url, digit) : ''
          if (lookup && !prompt) throw new Error(`Key ${digit}: say what the caller should type so we can find what they owe (e.g. "enter your account number").`)
          const check = lookup ? checkOf(o, digit, { url, amount: true }) : null
          if (lookup && !check) throw new Error(`Key ${digit}: choose where the amount comes from — your database or your system.`)
          out[digit] = { action, payVia: 'provider', connId: String(o.connId), amountFrom: lookup ? 'lookup' : 'fixed', amount, currency, description: txt(o.description, 80) || 'Payment', waitPaid: o.waitPaid === true, paidMessage: txt(o.paidMessage, 300), ...(lookup ? { prompt, length: Math.min(20, Math.max(1, Math.round(Number(o.length)) || 6)), url, check } : {}), ...rest }
        } else {
          const payUrl = hookUrl(o.payUrl, digit)
          const smsText = `${payNote || 'Pay securely here:'} ${payUrl}`
          if (sl.smsTooLong(smsText)) throw new Error(`Key ${digit}: ${sl.smsTooLong(smsText)}`)
          out[digit] = { action, payUrl, smsText, ...rest }
        }
      } else if (action === 'webhook') {
        const db = o.check?.source === 'db'
        const url = db && !String(o.url || '').trim() ? '' : hookUrl(o.url, digit)
        const check = checkOf(o, digit, { url })
        out[digit] = { action, url, message: String(o.message || '').slice(0, 500), after: o.after === 'menu' ? 'menu' : 'hangup', label, ...(check ? { check } : {}), ...confirmOf(o, digit) }
      } else if (action === 'collect') {
        const prompt = String(o.prompt || '').trim().slice(0, 500)
        if (!prompt) throw new Error(`Key ${digit}: say what the caller should type.`)
        const to = o.forwardTo ? fwd(o.forwardTo, digit) : ''
        const webhook = o.webhook ? hookUrl(o.webhook, digit) : ''
        const message = String(o.message || '').slice(0, 500)
        const check = checkOf(o, digit, { url: webhook })
        if (!to && !webhook && !message && !check && o.confirm !== true) throw new Error(`Key ${digit}: choose what happens with the digits — send to your system, connect the call, or a confirmation message.`)
        out[digit] = { action, prompt, length: Math.min(20, Math.max(1, Math.round(Number(o.length)) || 6)), webhook, forwardTo: to, message, label, ...(check ? { check } : {}), ...confirmOf(o, digit) }
      } else if (action === 'pin') {
        const url = o.check?.source === 'reply' ? hookUrl(o.url, digit) : ''
        const check = checkOf(o, digit, { url })
        const pin = check ? '' : String(o.pin || '').replace(/\D/g, '').slice(0, 12)
        if (!check && pin.length < 3) throw new Error(`Key ${digit}: the PIN needs at least 3 digits.`)
        const okTo = o.onOk?.forwardTo ? fwd(o.onOk.forwardTo, digit) : ''
        out[digit] = { action, prompt: String(o.prompt || '').slice(0, 500), pin, onOk: { action: okTo ? 'forward' : 'message', forwardTo: okTo, message: String(o.onOk?.message || '').slice(0, 500) }, failMessage: String(o.failMessage || '').slice(0, 500), label, ...(check ? { check, url, length: Math.min(12, Math.max(3, Math.round(Number(o.length)) || 6)) } : {}), ...confirmOf(o, digit) }
      } else if (action === 'submenu') {
        if (depth >= 3) throw new Error('Sub-menus can only go 3 levels deep.')
        const sub = o.subMenu || {}
        const subAudio = audio(sub.greetingAudioUrl, `Key ${digit} sub-menu`)
        const subLang = vmGreeting.IVR_LANGS.includes(sub.language) && sub.language !== language ? sub.language : null
        out[digit] = { action, label, subMenu: { greetingType: subAudio ? 'audio' : 'text', greeting: String(sub.greeting || (subLang ? vmGreeting.ivrSpeech(subLang).sub : speech.sub)).slice(0, 1000), greetingAudioUrl: subAudio, ...(subLang ? { language: subLang } : {}), options: clean(sub.options, depth + 1) } }
      } else throw new Error(`Key ${digit}: unknown action "${action}".`)
    }
    return out
  }
  const options = clean(ivr.options, 0)
  if (ivr.enabled && !Object.keys(options).length) throw new Error('Add at least one menu option before turning the IVR on.')
  const greetingAudioUrl = audio(ivr.greetingAudioUrl, 'Greeting')
  // After-hours menu (outside the Hours schedule) and staff extensions typed at the top of the main menu.
  const ah = ivr.afterHours || {}
  const ahOptions = ah.enabled || Object.keys(ah.options || {}).length ? clean(ah.options, 0) : {}
  if (ah.enabled && !Object.keys(ahOptions).length) throw new Error('After-hours menu: add at least one key, or switch it off.')
  const ahAudio = audio(ah.greetingAudioUrl, 'After-hours greeting')
  const afterHours = { enabled: !!ah.enabled && Object.keys(ahOptions).length > 0, greeting: txt(ah.greeting, 1000), greetingAudioUrl: ahAudio, options: ahOptions }
  const seenExt = new Set()
  const extensions = (Array.isArray(ivr.extensions) ? ivr.extensions : []).filter(e => e && (e.code || e.forwardTo || e.name)).slice(0, 30).map((e, i) => {
    const code = String(e.code || '').replace(/\D/g, '')
    const where = `Extension ${code || i + 1}`
    if (code.length < 2 || code.length > 5) throw new Error(`${where}: use 2 to 5 digits, e.g. 101.`)
    if (seenExt.has(code)) throw new Error(`${where}: two extensions use the same code.`)
    seenExt.add(code)
    if (e.action === 'devices') { if (!ctx.sipLogin) throw new Error(`${where}: this number has no browser phone / phone app login yet.`); return { code, name: txt(e.name, 40), action: 'devices', noAnswer: phoneConfig.canAccessFeature(plan, 'voicemail') ? 'voicemail' : 'message' } }
    return { code, name: txt(e.name, 40), action: 'forward', forwardTo: fwd(e.forwardTo, where.replace('Extension', 'ext')) }
  })
  return {
    enabled: !!ivr.enabled,
    greetingType: greetingAudioUrl ? 'audio' : 'text',
    greeting: String(ivr.greeting || speech.greeting).slice(0, 1000),
    greetingAudioUrl, language,
    voice: ivr.voice || null, speed: Number(ivr.speed) || 1,
    options, afterHours, extensions,
  }
}

const smsReplyMod = require('./sms-reply')
const publicLog = (l) => ({
  id: String(l._id), type: l.type, direction: l.direction || (String(l.type || '').startsWith('outbound') ? 'outbound' : 'inbound'),
  from: l.from || null, to: l.to || l.phoneNumber || null, phoneNumber: l.phoneNumber || null, duration: l.duration || 0,
  body: l.body || null, recordingUrl: l.recordingUrl || null, digit: l.digitPressed || null, forwardTo: l.forwardTo || null, timestamp: l.timestamp,
  transcript: l.transcript || null, transcriptStatus: l.transcriptStatus || null, reply: l.reply || null, canReply: smsReplyMod.canReply(l),
  smsStatus: l.type === 'sms_out' ? (l.status || 'sent') : null, smsReason: l.smsReason || null,
  aiSummary: !l.aiSummary ? null : require('./ai-summary').isStale(l.aiSummary)
    ? { status: 'failed', summary: null, sentiment: null, mood: null, actionItems: [], charge: 0, detail: 'The last summary did not finish. You can run it again.' }
    : { status: l.aiSummary.status, summary: l.aiSummary.summary || null, sentiment: l.aiSummary.sentiment || null, mood: l.aiSummary.mood || null, actionItems: l.aiSummary.actionItems || [], charge: l.aiSummary.charge || 0, detail: l.aiSummary.detail || null },
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
  // $elemMatch skips an older released copy of the same number (bought again after a delete).
  const setField = (chatId, phone, path, value) => phoneNumbersOf.updateOne({ _id: chatId, 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } }, { $set: { [`val.numbers.$.${path}`]: value } })
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
  // A replaced number is released after its overlap week: no renewing, upgrading or extra lines on it.
  const notReplaced = (fn) => withNumber(async (req, res) => (req.num.replacedBy ? bad(res, 409, 'replaced', `This number was replaced by ${req.num.replacedBy} and is released on ${String(req.num.releaseAt || '').slice(0, 10)}. Manage the plan on the new number.`) : fn(req, res)))
  const gate = (req, res, feature, label) => {
    if (phoneConfig.canAccessFeature(req.num.plan, feature)) return true
    bad(res, 403, 'plan_upgrade_required', `${label} needs a higher plan. Upgrade this number to use it.`)
    return false
  }

  // Infobip / MultiTEL countries search that provider directly; US/CA go through the provider chain.
  const rawSearch = async ({ country, type, areaCode, texting: sms, own }) => {
    const found = own === 'infobip' ? await require('../infobip').searchNumbers(country, type, areaCode, 12, { sms: sms && !!texting.offerOf(country, type) })
      : own === 'multitel' ? await require('../multitel').searchNumbers(country, type, areaCode, 12)
        : await telnyxApi.searchNumbers(country, type, areaCode, 12)
    // Nothing listable from the main provider (e.g. MultiTEL Germany/France only assigns on order): try the other one.
    if (['multitel', 'infobip'].includes(own) && !found.length && !areaCode) {
      const other = own === 'multitel' ? 'infobip' : 'multitel'
      const ok = require(`../${other}`).enabled() && !require('../provider-health').isDown(other)
      if (ok) found.push(...(other === 'infobip' ? await require('../infobip').searchNumbers(country, type, null, 12).catch(() => []) : await require('../multitel').searchNumbers(country, type, null, 12).catch(() => [])))
    }
    return found
  }
  const searchArgs = (country, type, areaCode, sms) => ({ country, type, areaCode: areaCode || null, texting: !!sms, own: ownProvider(countries().find(x => x.code === country), type) })
  const hot = require('./search-warm').create(rawSearch, { log: (m) => log(`[CloudIVR-Web] number search cache: ${m}`) })
  // A cached hit the provider no longer remembers (bought or refused since) can't be ordered any more.
  const stillOffered = (n) => (n._signalwire || n._provider === 'signalwire' ? require('../signalwire').sells('signalwire') && !require('../signalwire/rest').isFull() : n._provider === 'telnyx' ? require('../signalwire').sells('telnyx') : n._provider === 'multitel' ? require('../multitel').isMtSearched(n.phone_number) : n._provider === 'infobip' ? require('../infobip').isIbSearched(n.phone_number) : true)
  if (String(process.env.NUMBER_SEARCH_WARM || 'true').toLowerCase() !== 'false') hot.start(searchArgs)

  // Typed a full area code: start that search now so pressing Search answers straight away.
  router.get('/numbers/search/warm', (req, res) => {
    const country = String(req.query.country || 'US').toUpperCase()
    const c = countries().find(x => x.code === country)
    const type = String(req.query.type || c?.types?.[0] || 'local')
    const areaCode = /^\d{3}$/.test(String(req.query.areaCode || '')) ? String(req.query.areaCode) : null
    if (c && c.types.includes(type) && !c.offers?.[type]?.request) hot.prefetch(searchArgs(country, type, ['US', 'CA'].includes(country) && type === 'local' ? areaCode : null, req.query.texting === '1'))
    res.status(202).json({ ok: true })
  })

  router.get('/catalog', (req, res) => res.json(catalog()))

  router.get('/numbers/search', h(async (req, res) => {
    const country = String(req.query.country || 'US').toUpperCase()
    const c = countries().find(x => x.code === country)
    if (!c) return bad(res, 400, 'invalid_country', 'Pick a country from the list.')
    const type = String(req.query.type || c.types[0])
    if (!c.types.includes(type)) return bad(res, 400, 'invalid_type', `${c.name} offers: ${c.types.map(t => TYPE_NAMES[t] || t).join(', ')}.`)
    const areaCode = ['US', 'CA'].includes(country) && type === 'local' && /^\d{3}$/.test(String(req.query.areaCode || '')) ? String(req.query.areaCode) : null
    const offer = c.offers?.[type] || null
    if (offer?.request) return res.json({ numbers: [], request: { ...offer.request, country: c.code, name: c.name, flag: c.flag, planAddons: Object.fromEntries(Object.keys(phoneConfig.plans).map(k => [k, phoneConfig.planAddon(k, c.code, type, require('../number-addons').get(c.code, type))])) } })
    const own = ownProvider(c, type)
    const verification = own || offer ? { required: false } : await verificationInfo(country, type, `${c.flag} ${c.name}`)
    if (verification.error) return bad(res, 424, 'lookup_failed', verification.error)
    if (verification.required && !verification.supported) return bad(res, 400, 'unsupported', `${c.name} ${TYPE_NAMES[type] || type} numbers can't be ordered online right now. Pick another country or type.`)
    const found = await unheld((await hot.get(searchArgs(country, type, areaCode, req.query.texting === '1'))).list.filter(stillOffered))
    if (own === 'multitel' && !found.length && require('../multitel').isBlocked()) return bad(res, 503, 'provider_unavailable', 'Numbers in this country are temporarily unavailable. Please try again later.')
    if (own && !found.length) return res.json({ numbers: [], fallback: null, unavailable: true, message: `No ${c.name} ${TYPE_NAMES[type] || type} numbers can be picked online right now. Try another type, or message support and we'll order one for you.` })
    const results = found.map(n => ({
      phoneNumber: n.phone_number,
      region: (n.region_information || []).map(r => r.region_name).filter(Boolean).join(', '),
      capabilities: { ...(n._capabilities || { voice: true, sms: false, fax: false }), ...(n._signalwire ? { fax: false } : {}) },
      surcharge: ['infobip', 'multitel'].includes(n._provider) ? require('../number-addons').get(country, type) : round2(numberSurcharge(country, type, n)),
      provider: n._provider || null,
      ...(n._assigned ? { assigned: true } : {}),
      ...(texting.offerOf(country, type) ? { extraPrice: texting.offerOf(country, type).extraPrice, textPrice: texting.offerOf(country, type).textPrice } : {}),
      cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
    })).map(r => ({ ...r, planAddons: Object.fromEntries(Object.keys(phoneConfig.plans).map(k => [k, phoneConfig.planAddon(k, country, type, r.surcharge)])) }))
    const fb = found.find(n => n._areaFallback)
    await searchCache.updateOne({ _id: req.webChatId }, { $set: { country, type, areaCode, results, at: new Date() } }, { upsert: true })
    // Paperwork is never shown while choosing — it is asked for after payment, on the number's page.
    const paperwork = null
    res.json({ numbers: results.map(({ cost, ...r }) => r), fallback: fb ? { areaCode: fb._requestedAreaCode, region: fb._fallbackRegion } : null, paperwork })
  }))

  // What the line can really do: calls in, calls out (needs the number linked on Bird), texts, fax.
  const withCapacity = async (n) => {
    const c = n.capabilities || {}, bird = require('../bird')
    const out = c.voice !== false && ['multitel', 'infobip'].includes(n.provider) && n.status === 'active' && !n.dryRun && bird.enabled() ? await bird.presentable(n.phoneNumber).catch(() => false) : null
    return { ...publicNumber(n, n._all), capacity: { callsIn: c.voice !== false, callsOut: c.voice === false ? false : out === null ? c.voice !== false : out ? true : 'pending', texts: !!c.sms && n.features?.sms === true, fax: !!c.fax } }
  }
  router.get('/numbers', h(async (req, res) => { const all = await myNumbers(req.webChatId); res.json({ numbers: await Promise.all(all.map(n => withCapacity({ ...n, _all: all }))) }) }))
  router.get('/numbers/:phone', withNumber(async (req, res) => res.json({ number: await withCapacity({ ...req.num, _all: (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val?.numbers }) })))

  // Picked number from the account's last search (null when it is no longer there).
  const pickFromSearch = async (chatId, phone) => {
    const cache = await searchCache.findOne({ _id: chatId })
    const hit = cache?.results?.find(r => r.phoneNumber === normPhone(phone))
    return hit ? { hit, country: cache.country, type: cache.type, areaCode: cache.areaCode } : null
  }
  // Several picks from the same search (null when any is no longer there).
  const pickManyFromSearch = async (chatId, phones) => {
    const cache = await searchCache.findOne({ _id: chatId })
    const out = phones.map(p => cache?.results?.find(r => r.phoneNumber === normPhone(p))).map(hit => hit && { hit, country: cache.country, type: cache.type, areaCode: cache.areaCode })
    return out.length && out.every(Boolean) ? out : null
  }
  const extraPriceOf = (country, type) => texting.offerOf(country, type)?.extraPrice ?? phoneConfig.SUB_NUMBER_BASE_PRICE
  const searchSimilar = async (country, type, areaCode) => (await unheld(await telnyxApi.searchNumbers(country, type, areaCode, 6))).map(n => ({
    phoneNumber: n.phone_number, capabilities: n._capabilities || { voice: true, sms: false, fax: false },
    surcharge: ['infobip', 'multitel'].includes(n._provider) ? require('../number-addons').get(country, type) : round2(numberSurcharge(country, type, n)), cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
  }))

  // Account currently holding this number (anyone, including the buyer), or null.
  const holderOf = async (phone) => (await phoneNumbersOf.findOne({ 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } }, { projection: { _id: 1 } }))?._id ?? null

  // One buyer at a time per number: the lock closes the gap between the holder check and saving the number
  // (TTL frees it if the process dies mid-purchase).
  const locks = db.collection('webNumberLocks')
  locks.createIndex({ at: 1 }, { expireAfterSeconds: 900 }).catch(() => {}) // a lock left by a crash clears itself
  locks.createIndex({ at: 1 }, { expireAfterSeconds: 600 }).catch(() => {})
  // MultiTEL details / documents rules for this account → message, or null when it can buy.
  async function paperworkIssue(chatId, country, name, offer) {
    const eu = await deps.legalProfile?.endUserOf(chatId)
    if (!eu) return `${name} numbers need your name and address. Add them in Settings → Legal details first.`
    if (offer.businessOnly && eu.type !== 'business') return `${name} numbers of this type are sold to businesses only. Switch your legal details to a business to buy one.`
    if (offer.address !== 'any' && eu.countryCode !== country) return `${name} numbers of this type need an address in ${name}. Your saved address is in ${eu.countryCode}.`
    if (offer.level === 2) { const why = await deps.compliance?.idIssue(chatId, eu.type === 'business'); if (why) return why }
    if (offer.level === 2 && !(await deps.numberDocs?.status(chatId, country))?.ready) return `${name} numbers need documents. Upload them on this number's page.`
    return null
  }

  // Extra numbers: one buy per plan at a time, and the plan's free slots are checked again under that lock,
  // so two buys at the same moment can never go over the plan's limit.
  async function purchase(args) {
    const planLock = args.sub && !args.planLocked ? `extras:${args.chatId}:${args.sub.parentNumber}` : null
    if (planLock) {
      let got = false
      for (let i = 0; i < 40 && !got; i++) {
        try { await locks.insertOne({ _id: planLock, at: new Date() }); got = true } catch (e) { if (e.code !== 11000) throw e; await new Promise(r => setTimeout(r, 250)) }
      }
      if (!got) return { status: 409, body: { error: 'busy', message: 'Extra numbers are already being added to this plan. Wait a moment and try again.' } }
    }
    try {
      if (planLock) {
        const used = (await myNumbers(args.chatId)).filter(n => n.isSubNumber && n.parentNumber === args.sub.parentNumber).length
        if (!phoneConfig.subSlotsLeft(args.sub.plan, used)) return { status: 400, body: { error: 'limit_reached', message: `The ${phoneConfig.plans[args.sub.plan]?.name || args.sub.plan} plan allows ${phoneConfig.getSubNumberLimit(args.sub.plan)} extra numbers. Upgrade the main number to add more.` } }
      }
      try { await locks.insertOne({ _id: args.phone, chatId: args.chatId, at: new Date() }) } catch (e) {
        if (e.code === 11000) return { status: 409, body: { error: 'number_taken', message: 'Someone is buying that number right now. Pick another one.' } }
        throw e
      }
      try { return await purchaseLocked(args) } finally { await locks.deleteOne({ _id: args.phone }).catch(() => {}) }
    } finally { if (planLock) await locks.deleteOne({ _id: planLock }).catch(() => {}) }
  }

  // Debits the wallet and activates the number → { status, body } (HTTP-style; refunds on failure).
  // `sub` = { parentNumber, plan } adds the number to an existing plan (flat extra-number price, parent's plan features).
  // `coupon` = { code, type, discount } from deps.resolveCoupon (percent off; redeemed only after success).
  async function purchaseLocked({ chatId, email, phone, planKey, hit, country, type, areaCode, autoRenew = true, viaOrder = null, sub = null, coupon = null, prepaid = null, presetOrder = null, withTexting = false, skipRedeem = false }) {
    if (sub) planKey = sub.plan
    const plan = phoneConfig.plans[planKey]
    if (!plan || !phoneConfig.isPlanAvailable(planKey)) return { status: 400, body: { error: 'invalid_plan', message: 'That plan is not available.' } }
    // A plan's own number can come from any country (outside the plan it costs the country add-on); already-paid crypto orders were checked at checkout.
    const incl = !sub && !viaOrder && !presetOrder ? phoneConfig.planNumberIssue(country, type) : null
    if (incl) return { status: 400, body: { error: 'extra_number_only', message: incl } }
    const holder = await holderOf(phone)
    if (holder !== null) {
      return { status: 409, body: String(holder) === String(chatId)
        ? { error: 'already_yours', message: 'You already have this number. Pick another one.' }
        : { error: 'number_taken', message: 'Someone just took that number. Pick another one.' } }
    }
    const c = countries().find(x => x.code === country)
    // Infobip / MultiTEL paperwork is handled here (details from the legal profile, uploaded documents), not by Telnyx's check.
    const offer = c?.offers?.[type] || null
    const ver = offer || hit?.provider === 'multitel' ? { required: false } : await verificationInfo(country, type, `${c.flag} ${c.name}`)
    if (ver.error) return { status: 424, body: { error: 'lookup_failed', message: ver.error } }
    // The usage rules are part of the Terms accepted at sign-up (no separate policy pop-up).
    // Paperwork never blocks the order: missing details / documents are asked for after payment (number page).
    const regIssue = hit?.provider === 'multitel' && offer?.level && !presetOrder ? await paperworkIssue(chatId, country, c.name, offer) : null
    const base = sub ? extraPriceOf(country, type) : plan.price + phoneConfig.planAddon(planKey, country, type, hit.surcharge || 0)
    // Extra numbers join the main line's renewal date: the first charge covers only the days until then.
    const parentExp = sub ? (await myNumbers(chatId)).find(x => x.phoneNumber === sub.parentNumber && x.status === 'active')?.expiresAt : null
    const coterm = parentExp && new Date(parentExp) > new Date() ? parentExp : null
    const firstBase = coterm ? lifecycle.proratedTo(base, coterm) : base
    const price = prepaid ? prepaid.amount : round2(firstBase * (1 - (Number(coupon?.discount) || 0) / 100))
    if (!prepaid && !(await w.debit(chatId, price))) return { status: 402, body: { error: 'insufficient_balance', message: `This number costs $${price.toFixed(2)}. Your wallet has $${(await w.balance(chatId)).toFixed(2)}.`, cost: price } }

    let selected = phone
    try {
      const tr = getTelnyxResources() || {}
      // hold: web verifications never expire or auto-refund — the number waits until the owner finishes.
      const ctx = { countryCode: country, numberType: type, areaCode, planKey, price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', refund: { currency: 'usd', amount: price }, capabilities: hit.capabilities, numberCost: hit.cost, countryName: `${c.flag} ${c.name}`, lang: 'en', hold: true, isSubNumber: !!sub }
      const eu = await deps.legalProfile?.endUserOf(chatId)
      if (eu) require('../infobip').setResaleNote(phone, require('./legal-profile').resaleNote(eu))
      let order
      if (presetOrder) order = presetOrder
      else if (!ver.required && dryRun()) order = { id: `dryrun-${crypto.randomUUID().slice(0, 8)}`, ...(['infobip', 'multitel'].includes(hit?.provider) ? { _provider: hit.provider, _needsRegistration: hit.provider === 'multitel' && offer?.level === 2 } : {}) }
      else order = await paidCheckout(chatId, phone, ctx)
      if (order?._verification) {
        await phoneTransactions.insertOne({ chatId, phoneNumber: phone, action: 'purchase_verification', plan: planKey, amount: price, paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
        notifyAdmin(`🌐 CloudIVR web: paid ${country} number ${phone} — collecting verification\nweb account: ${chatId} (${email})\nplan: ${plan.name} $${price}`)
        return { status: 202, body: { verification: true, sessionId: order.sessionId, phoneNumber: phone, substitutedFrom: null, balance: await w.balance(chatId) } }
      }
      if (!order) throw new Error(hit?.provider === 'signalwire' && require('../signalwire/rest').isFull() ? 'We can’t activate numbers in this area right now. Search again to see the numbers we can switch on today.' : 'The number could not be reserved — it may have just been taken. Pick another one.')
      if (order._retriedNumber) selected = order._retriedNumber
      const viaMultitel = order._provider === 'multitel' || String(order.id || '').startsWith('mt:')
      const viaInfobip = viaMultitel || order._provider === 'infobip' || String(order.id || '').startsWith('ib:') // own routing, no Telnyx steps
      if (!dryRun() && !viaInfobip && tr.callControlAppId) await telnyxApi.assignNumberToCallControlApp(selected, tr.callControlAppId)

      let sipUsername = phoneConfig.generateSipUsername(), sipPassword = phoneConfig.generateSipPassword()
      let tUser = null, tPass = null, tCredId = null
      if (!dryRun() && !viaInfobip && tr.sipConnectionId) {
        const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword, selected)
        if (cred?.sip_username) { tUser = sipUsername = cred.sip_username; tPass = sipPassword = cred.sip_password || sipPassword; tCredId = cred.id || null }
      }
      const caps = { voice: hit.capabilities.voice !== false, sms: !!hit.capabilities.sms, mms: !!hit.capabilities.mms, fax: !!hit.capabilities.fax }
      const expiresAt = coterm ? new Date(coterm) : new Date(); if (!coterm) expiresAt.setMonth(expiresAt.getMonth() + 1)
      const doc = {
        phoneNumber: selected, telnyxOrderId: order.id, provider: viaMultitel ? 'multitel' : viaInfobip ? 'infobip' : 'telnyx', country, countryName: c.name,
        ...(order._needsRegistration || regIssue ? { registration: { status: regIssue ? 'needs_details' : 'pending', level: offer?.level || 0, since: new Date().toISOString(), paid: price } } : {}),
        type, plan: planKey, planPrice: round2(base), ...(!sub && phoneConfig.planAddon(planKey, country, type, hit.surcharge || 0) ? { numberSurcharge: round2(phoneConfig.planAddon(planKey, country, type, hit.surcharge || 0)) } : {}), purchaseDate: new Date().toISOString(), expiresAt: expiresAt.toISOString(), autoRenew: autoRenew !== false, status: order._pending ? 'provisioning' : 'active',
        sipUsername, sipPassword, telnyxSipUsername: tUser, telnyxSipPassword: tPass, telnyxCredentialId: tCredId, sipDomain: phoneConfig.WEB_SIP_DOMAIN,
        messagingProfileId: caps.sms ? tr.messagingProfileId || null : null, connectionId: tr.sipConnectionId || null, smsUsed: 0, minutesUsed: 0,
        capabilities: caps, channel: 'web', resold: true, ...(eu ? { endUser: eu } : {}), ...(dryRun() ? { dryRun: true } : {}), ...(sub ? { isSubNumber: true, parentNumber: sub.parentNumber } : {}),
        features: {
          sms: !!caps.sms && !!withTexting,
          callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
          voicemail: { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, forwardToEmail: null, ringTimeout: 25 },
          smsForwarding: { toTelegram: true, toEmail: null, webhookUrl: null },
          faxForwarding: { toTelegram: true }, recording: false,
        },
      }
      await phoneNumbersOf.updateOne({ _id: chatId }, { $push: { 'val.numbers': doc } }, { upsert: true })
      // Give it a complete brand-SIP login immediately (kam: credential + brand domain) so the softphone can REGISTER
      // from the first minute — don't wait for the customer to open the SIP page.
      if (doc.status === 'active' && phoneConfig.canAccessFeature(planKey, 'sipCredentials')) await require('../sip-logins').ensure(phoneNumbersOf, chatId, doc).catch(e => log(`[CloudIVR-Web] SIP login setup for ${selected}: ${e.message}`))
      if (order._pending) await require('../pending-orders').enqueue({ chatId, phoneNumber: selected, order, amount: price, email })
      await deps.legalProfile?.recordResale({ chatId, phoneNumber: selected, provider: doc.provider, country })
      if (doc.registration?.status === 'pending') deps.numberDocs?.submit({ chatId, email, phoneNumber: selected, country, countryName: c.name, type }).catch(e => log(`[CloudIVR-Web] MultiTEL documents for ${selected}: ${e.message}`))
      await phoneTransactions.insertOne({ chatId, phoneNumber: selected, action: sub ? 'purchase_sub' : 'purchase', plan: planKey, amount: price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', ...(viaOrder ? { orderRef: viaOrder } : {}), ...(sub ? { parentNumber: sub.parentNumber } : {}), ...(coupon ? { coupon: coupon.code, discountPct: coupon.discount } : {}), channel: 'web', timestamp: new Date().toISOString() })
      if (coupon?.code && !skipRedeem) {
        if (coupon.type === 'web-offer') await deps.offers?.markCodeUsed(chatId, coupon.code).catch(() => {})
        else if (deps.redeemCoupon) await Promise.resolve(deps.redeemCoupon(chatId, coupon.code, coupon.type)).catch(() => {})
        await notify.push(chatId, `Coupon ${coupon.code} applied: ${coupon.discount}% off ${selected}. You saved $${round2(base - price).toFixed(2)}.`, null, { kind: 'coupon', meta: { coupon: coupon.code, discount: coupon.discount, used: true } }).catch(() => {})
      }
      await txn(chatId, 'phone-number', price, { phoneNumber: selected, plan: planKey, provider: doc.provider, country })
      if (!sub) await referrals.onPurchase(db, chatId, price, log).catch(e => log(`[CloudIVR-Web] referral payout failed: ${e.message}`))
      notifyAdmin(`🌐 CloudIVR web purchase${dryRun() ? ' (DRY RUN)' : ''}${viaOrder ? ' · crypto checkout' : ''}\nweb account: ${chatId} (${email})\nnumber: ${selected} (${country})${sub ? `\nextra number on ${sub.parentNumber}` : ''}\nplan: ${plan.name} $${price}${coupon ? ` (coupon ${coupon.code} −${coupon.discount}%)` : ''}`)
      await searchCache.deleteOne({ _id: chatId })
      if (order._pending) await notify.push(chatId, require('../pending-orders').pendingMsg(selected), null, { kind: 'billing' }).catch(() => {})
      return { status: 201, body: { number: publicNumber(doc), pending: !!order._pending, substitutedFrom: selected !== phone && !order._assigned ? phone : null, balance: await w.balance(chatId) } }
    } catch (e) {
      if (prepaid) { log(`[CloudIVR-Web] activating requested number ${phone} for ${chatId} failed: ${e.message}`); return { status: 424, body: { error: 'purchase_failed', message: e.message } } }
      await w.credit(chatId, price)
      log(`[CloudIVR-Web] purchase failed for ${chatId} ${phone}: ${e.message} — refunded $${price}`)
      return { status: 424, body: { error: 'purchase_failed', message: `${e.message && e.message.length < 160 ? e.message : 'The number could not be activated.'} You were refunded $${price.toFixed(2)}.` } }
    }
  }

  // Same coupon codes as the bot (static, daily, win-back, welcome) → { code, type, discount } or { error, message }.
  async function checkCoupon(chatId, raw) {
    const code = String(raw || '').trim().toUpperCase().slice(0, 40)
    if (!code) return { error: true, message: 'Enter a coupon code.' }
    const offer = deps.offers ? await deps.offers.checkCode(chatId, code).catch(() => null) : null
    if (offer?.error === 'expired') return { error: true, message: 'This offer has ended.' }
    const r = offer || (deps.resolveCoupon ? await deps.resolveCoupon(code, chatId).catch(() => null) : null)
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
      if (dialIssue(to)) return bad(res, 400, 'invalid_number', dialIssue(to))
      if (phoneConfig.isBlockedPrefix(to)) return bad(res, 400, 'blocked_destination', `${to} is a blocked premium/satellite destination.`)
      if (to === req.num.phoneNumber) return bad(res, 400, 'self_forward', 'A number cannot forward to itself.')
    }
    const ringTimeout = Math.min(60, Math.max(10, parseInt(req.body.ringTimeout, 10) || 25))
    const bk = mode === 'disabled' ? { list: [] } : parseBackups(req.body.backups, [to, req.num.phoneNumber])
    if (bk.error) return bad(res, 400, 'invalid_backup', bk.error)
    const value = { enabled: mode !== 'disabled', mode, forwardTo: to, ringTimeout, holdMusic: !!req.body.holdMusic, backups: bk.list, showCallerId: !!req.body.showCallerId }
    await setField(req.webChatId, req.num.phoneNumber, 'features.callForwarding', value)
    // Only one answers: "forward every call" switches the AI agent off.
    const ai = req.num.features?.aiAgent
    const aiAgentTurnedOff = !!(value.enabled && mode === 'always' && ai?.enabled)
    if (aiAgentTurnedOff) await setField(req.webChatId, req.num.phoneNumber, 'features.aiAgent', { ...ai, enabled: false })
    res.json({ callForwarding: value, aiAgentTurnedOff })
  }))

  // "Ring me in the browser" (Pro+): inbound calls ring the open web app, which answers them by voice (browser phone)
  // or, on plans with text calls (Business), as text. answerMode = what happens when it rings; lang/voice/announce =
  // the text-call defaults used when answering as text.
  router.patch('/numbers/:phone/browser-ring', withNumber(async (req, res) => {
    if (!gate(req, res, 'browserRing', 'Ringing in the browser')) return
    const b = req.body || {}, cur = req.num.features?.browserRing || {}
    const answerMode = phoneConfig.canAccessFeature(req.num.plan, 'textRelay') ? String(b.answerMode ?? cur.answerMode ?? 'ask') : 'voice'
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
    if (hook && !(await safeUrl.checkUrl(hook)).ok) return bad(res, 400, 'private_webhook', 'That address leads to a private or internal network. Use a public web address that starts with https://')
    const value = { toTelegram: true, toEmail: email || null, webhookUrl: hook || null }
    await setField(req.webChatId, req.num.phoneNumber, 'features.smsForwarding', value)
    res.json({ smsForwarding: value })
  }))

  router.patch('/numbers/:phone/recording', withNumber(async (req, res) => {
    if (!gate(req, res, 'callRecording', 'Call recording')) return
    await setField(req.webChatId, req.num.phoneNumber, 'features.recording', !!req.body.enabled)
    res.json({ recording: !!req.body.enabled })
  }))

  // One switch per feature, saved at once (number cards and the tab toggles): flips `enabled`, keeps every other setting.
  const SWITCHES = {
    callForwarding: { gate: ['callForwarding', 'Call forwarding'], need: (f) => (E164.test(String(f.callForwarding?.forwardTo || '')) ? null : 'Set a forward-to number in the Forwarding tab first.') },
    ivr: { gate: ['ivr', 'The keypad menu'], need: (f) => (Object.keys(f.ivr?.options || {}).length ? null : 'Add at least one menu key in the Keypad menu tab first.') },
    // Never-saved hours = the default Mon–Fri 09:00–17:00 the Hours tab shows.
    hours: { need: (f) => (numberHours.DAYS.some(d => (f.hours || numberHours.defaultHours()).days?.[d]?.on) ? null : 'Turn on at least one day in the Hours tab first.') },
    voicemail: { gate: ['voicemail', 'Voicemail'] },
    transcribe: { gate: ['voicemail', 'Voicemail'] },
    recording: { gate: ['callRecording', 'Call recording'] },
    browserRing: { gate: ['browserRing', 'Ringing in the browser'] },
    ringGroup: { gate: ['ringGroup', 'Ring groups'], need: (f) => ((f.ringGroup?.members || []).length ? null : 'Add at least one phone in the Ring group tab first.') },
    textTriggers: { gate: ['textTriggers', 'Text Triggers'], need: (f) => ((f.textTriggers?.rules || []).length ? null : 'Add a trigger in the Text Triggers tab first.') },
    aiAgent: { gate: ['aiAgent', 'The AI voice agent'], need: (f) => (f.aiAgent?.agentId ? null : 'Pick an AI agent in the AI voice agent tab first.') },
    autoRenew: {},
    texting: {},
  }
  router.patch('/numbers/:phone/switch', withNumber(async (req, res) => {
    const feature = String(req.body?.feature || '')
    const sw = SWITCHES[feature]
    if (!sw) return bad(res, 400, 'unknown_switch', 'Unknown switch.')
    if (feature === 'autoRenew' && req.num.replacedBy) return bad(res, 409, 'replaced', `This number was replaced by ${req.num.replacedBy}. It’s released at the end of its overlap week.`)
    if (sw.gate && !gate(req, res, ...sw.gate)) return
    const enabled = !!req.body?.enabled
    const f = req.num.features || {}
    const why = enabled && sw.need ? sw.need(f) : null
    if (why) return bad(res, 400, 'not_configured', why)
    const phone = req.num.phoneNumber, id = req.webChatId
    const extra = {}
    const tendlc = feature === 'texting' && require('./ten-dlc').needs10dlc(req.num)
    const tf = feature === 'texting' && require('./tollfree').needsTfv(req.num)
    // Toll-free: texting switches on once the toll-free verification is active (or MultiTEL already shows it verified).
    if (tf && enabled && !(await require('./tollfree').canText(db, id, req.num.phoneNumber))) return bad(res, 409, 'tollfree_needed', 'Toll-free numbers need a texting verification first. Fill it in below.')
    if (tf && enabled && req.num.capabilities?.sms === false) await setField(id, phone, 'capabilities', { ...req.num.capabilities, sms: true })
    if (feature === 'texting' && req.num.capabilities?.sms === false && !tendlc && !tf) return bad(res, 400, 'no_texting', 'This number can’t send or receive texts.')
    // US local numbers: texting can only be switched on once the account's 10DLC registration is active.
    if (tendlc && enabled && (await db.collection('tenDlc').findOne({ _id: String(id) }, { projection: { status: 1 } }))?.status !== 'active') return bad(res, 409, 'tendlc_needed', 'US numbers need an approved 10DLC texting registration first. Start it below.')
    if (tendlc && enabled && req.num.capabilities?.sms === false) await setField(id, phone, 'capabilities', { ...req.num.capabilities, sms: true })
    if (feature === 'autoRenew') await setField(id, phone, 'autoRenew', enabled)
    else if (feature === 'texting') await setField(id, phone, 'features.sms', enabled)
    else if (feature === 'recording') await setField(id, phone, 'features.recording', enabled)
    else if (feature === 'transcribe') await setField(id, phone, 'features.voicemail', { ...(f.voicemail || {}), transcribe: enabled })
    else if (feature === 'hours') await setField(id, phone, 'features.hours', { ...numberHours.defaultHours(), ...(f.hours || {}), enabled })
    else if (feature === 'callForwarding') {
      const cf = f.callForwarding || {}
      const live = cf.mode && cf.mode !== 'disabled' ? cf.mode : null
      const mode = live || cf.lastMode || 'always'
      await setField(id, phone, 'features.callForwarding', enabled ? { ...cf, enabled: true, mode } : { ...cf, enabled: false, mode: 'disabled', lastMode: mode })
      if (enabled && mode === 'always' && f.aiAgent?.enabled) { await setField(id, phone, 'features.aiAgent', { ...f.aiAgent, enabled: false }); extra.aiAgentTurnedOff = true }
    } else {
      await setField(id, phone, `features.${feature}`, { ...(f[feature] || {}), enabled })
      // One answers a number: the keypad menu and the AI voice agent are never both on.
      if (enabled && feature === 'ivr' && f.aiAgent?.enabled) { await setField(id, phone, 'features.aiAgent', { ...f.aiAgent, enabled: false }); extra.aiAgentTurnedOff = true }
      if (enabled && feature === 'aiAgent' && f.ivr?.enabled) { await setField(id, phone, 'features.ivr', { ...f.ivr, enabled: false }); extra.ivrTurnedOff = true }
      if (enabled && feature === 'aiAgent' && f.callForwarding?.enabled && f.callForwarding.mode === 'always') { await setField(id, phone, 'features.callForwarding', { ...f.callForwarding, enabled: false, mode: 'disabled', lastMode: 'always' }); extra.forwardingTurnedOff = true }
    }
    const all = (await phoneNumbersOf.findOne({ _id: id }))?.val?.numbers || []
    res.json({ feature, enabled, ...extra, number: publicNumber(all.find(x => x.phoneNumber === phone) || req.num, all) })
  }))

  // On/off hours (every plan). Outside the hours the number doesn't ring: voicemail, a closed message or up to 5 backup numbers.
  router.put('/numbers/:phone/hours', withNumber(async (req, res) => {
    let value
    try { value = numberHours.validateHours(req.body) } catch (e) { return bad(res, 400, 'invalid_hours', e.message) }
    if (value.offAction === 'voicemail' && !phoneConfig.canAccessFeature(req.num.plan, 'voicemail')) value.offAction = 'message'
    const bk = parseBackups(req.body.offForward, [req.num.phoneNumber], 5)
    if (value.offAction === 'forward' && bk.error) return bad(res, 400, 'invalid_backup', bk.error)
    if (value.offAction === 'forward' && !bk.list.length) return bad(res, 400, 'no_backup', 'Add at least one backup number to forward to.')
    // Other off actions keep the list for later; a half-typed (hidden) list never blocks saving them.
    value.offForward = bk.error ? (req.num.features?.hours?.offForward || []) : bk.list
    await setField(req.webChatId, req.num.phoneNumber, 'features.hours', value)
    res.json({ hours: value, openNow: numberHours.isOpen(value) })
  }))

  router.get('/numbers/:phone/hours', withNumber(async (req, res) => {
    const hours = hoursOf(req.num)
    res.json({ hours, openNow: numberHours.isOpen(hours) })
  }))

  router.put('/numbers/:phone/ivr', withNumber(async (req, res) => {
    if (!gate(req, res, 'ivr', 'The keypad menu')) return
    const urls = await ownAudioUrls(req.webChatId)
    let value
    const rgMembers = (req.num.features?.ringGroup?.members || []).filter(Boolean).length
    try { value = validateIvr(req.body, req.num.plan, (u) => urls.has(u), { sipLogin: !!req.num.sipUsername, ringGroupMembers: rgMembers }) } catch (e) { return bad(res, 400, 'invalid_ivr', e.message) }
    const every = (opts) => Object.values(opts || {}).flatMap(o => [o, ...every(o.subMenu?.options)])
    const keys = [...every(value.options), ...every(value.afterHours?.options)], liveData = require('../ivr-live-data')
    const ai = require('../ai-agent')
    for (const o of keys.filter(k => k.action === 'ai')) if (!(await ai.store.getAgent(o.agentId, req.webChatId).catch(() => null))) return bad(res, 400, 'invalid_ivr', 'A key uses an AI agent that was removed. Pick one of your agents again.')
    const faxKeys = keys.filter(k => k.action === 'fax')
    if (faxKeys.length) {
      const fax = require('../fax-service'), { ObjectId } = require('mongodb')
      for (const o of faxKeys) {
        if (!fax.eligible(await fax.findMine(req.webChatId, o.faxFrom))) return bad(res, 400, 'invalid_ivr', `The fax number ${o.faxFrom} is not one of your active fax numbers. Pick another, or get a fax number first.`)
        if (!(await deps.db.collection('faxFiles.files').findOne({ _id: new ObjectId(o.fileId), 'metadata.chatId': req.webChatId, 'metadata.kind': 'ivr' }))) return bad(res, 400, 'invalid_ivr', 'Upload the fax document again.')
      }
    }
    if (!(await liveData.owns(req.webChatId, keys.map(o => o.check?.connId), 'database'))) return bad(res, 400, 'invalid_ivr', 'A key uses a database connection that was removed. Pick it again.')
    if (!(await liveData.owns(req.webChatId, keys.filter(o => o.action === 'pay').map(o => o.connId), 'payments'))) return bad(res, 400, 'invalid_ivr', 'A key uses a payment provider that was removed. Pick it again.')
    const lines = keys.filter(o => o.action === 'sms').map(o => o.smsFrom)
    if (lines.length) {
      const ok = await deps.db.collection('esimLines').countDocuments({ _id: { $in: [...new Set(lines)] }, kind: 'mobile', chatId: String(req.webChatId), status: { $in: ['provisioning', 'active', 'suspended'] } })
      if (ok !== new Set(lines).size) return bad(res, 400, 'invalid_ivr', 'Pick one of your own texting numbers to send the text from.')
    }
    const faxSvc = require('../fax-service'), dropped = faxSvc.ivrDocIds([req.num])
    await setField(req.webChatId, req.num.phoneNumber, 'features.ivr', value)
    // Fax documents no menu uses any more are cleaned up (any of the owner's numbers may still use one).
    deps.db.collection('phoneNumbersOf').findOne({ _id: req.webChatId }).then(d => faxSvc.sweepIvrDocs(req.webChatId, faxSvc.ivrDocIds(d?.val?.numbers), dropped)).catch(e => console.log(`[IVR] fax doc sweep: ${e.message}`))
    // One answers a number: the keypad menu going on switches the AI voice agent off.
    const aiCfg = req.num.features?.aiAgent
    const aiAgentTurnedOff = !!(value.enabled && aiCfg?.enabled)
    if (aiAgentTurnedOff) await setField(req.webChatId, req.num.phoneNumber, 'features.aiAgent', { ...aiCfg, enabled: false })
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

  // Calling numbers + USA mobile numbers. Mobile texts store timestamp as a Date, calling numbers as ISO text: sort on $toDate.
  router.get('/activity', h(async (req, res) => {
    const [mine, mobile, texting] = await Promise.all([myNumbers(req.webChatId), mobileLines(deps.db, req.webChatId), textingLines(deps.db, req.webChatId)])
    const phones = [...mine.map(n => n.phoneNumber), ...mobile.map(d => d.phoneNumber).filter(Boolean), ...texting.map(d => d.phoneNumber)]
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30)
    const logs = phones.length ? await phoneLogs.aggregate([{ $match: { phoneNumber: { $in: phones } } }, { $addFields: { _at: { $convert: { input: '$timestamp', to: 'date', onError: null } } } }, { $sort: { _at: -1 } }, { $limit: limit }, { $project: { _at: 0 } }]).toArray() : []
    res.json({ logs: logs.map(publicLog) })
  }))

  // ?browser=1 = the built-in browser phone (every plan); without it = SIP apps / desk phones (plans with SIP).
  // browserKey = the signed header the browser phone adds to its calls (needed on plans without SIP apps).
  // US mobile numbers (esimLines kind 'mobile') get a browser-phone login too; calling numbers fall through.
  router.get('/numbers/:phone/sip', async (req, res, next) => {
    try {
      const sip = req.query.browser ? await require('../spenza').mobileSip(req.webChatId, req.params.phone) : null
      if (!sip) return next()
      if (sip.error) return bad(res, 424, 'sip_failed', sip.error)
      res.json({ username: sip.username, password: sip.password, live: !!sip.live, browserOnly: true, mobile: true, browserKey: browserCallKey.mint(req.params.phone) })
    } catch (e) { next(e) }
  })
  router.get('/numbers/:phone/sip', withNumber(async (req, res) => {
    const n = req.num, sip = phoneConfig.canAccessFeature(n.plan, 'sipCredentials')
    if (!sip && !(req.query.browser && phoneConfig.canAccessFeature(n.plan, 'browserPhone'))) return gate(req, res, 'sipCredentials', 'SIP credentials')
    if (sip) await require('../sip-logins').ensure(phoneNumbersOf, req.webChatId, n)
    const user = n.telnyxSipUsername || n.sipUsername
    res.json({ username: user, password: n.telnyxSipPassword || n.sipPassword, domain: phoneConfig.WEB_SIP_DOMAIN, port: 5060, transport: 'UDP/TCP', live: !!n.telnyxSipUsername, browserOnly: !sip, browserKey: browserCallKey.mint(n.phoneNumber), webrtc: require('./webrtc-config').browserWebrtc(user) })
  }))

  // "Test my SIP registration": is the login accepted by our SIP server, and is any device signed in right now?
  router.post('/numbers/:phone/sip/check', withNumber(async (req, res) => {
    if (!phoneConfig.canAccessFeature(req.num.plan, 'sipCredentials')) return gate(req, res, 'sipCredentials', 'SIP credentials')
    const selftest = require('../sip-selftest')
    const n = await require('../sip-logins').ensure(phoneNumbersOf, req.webChatId, req.num)
    const r = await selftest.run({ db, num: n || req.num, domain: phoneConfig.WEB_SIP_DOMAIN })
    log(`[SipSelfTest] web ${req.webChatId} ${req.num.phoneNumber}: ${r.code} devices=${r.devices}`)
    res.json({ code: r.code, devices: r.devices, server: r.server, lastSeenAt: r.lastSeenAt, lastApp: r.lastApp, ...selftest.explain(r) })
  }))

  // Live badge: is a phone app signed in to this number's SIP login right now?
  router.get('/numbers/:phone/sip/status', withNumber(async (req, res) => {
    if (!phoneConfig.canAccessFeature(req.num.plan, 'sipCredentials')) return gate(req, res, 'sipCredentials', 'SIP credentials')
    res.json(await require('../sip-presence').status(db, req.num))
  }))

  router.post('/numbers/:phone/sip/qr', withNumber(async (req, res) => {
    if (!phoneConfig.canAccessFeature(req.num.plan, 'sipCredentials')) return gate(req, res, 'sipCredentials', 'SIP credentials')
    await require('../sip-logins').ensure(phoneNumbersOf, req.webChatId, req.num)
    res.json(await require('../sip-provision').codes(db, req.webChatId, req.num, phoneConfig.WEB_SIP_DOMAIN))
  }))

  // New SIP login for a number (devices on the old one stop working) → { username, password } or null if the network refused.
  async function rotateSip(chatId, n) {
    const tr = getTelnyxResources() || {}
    let user = phoneConfig.generateSipUsername(), pass = phoneConfig.generateSipPassword(), credId = null
    if (!dryRun() && !n.dryRun && tr.sipConnectionId) {
      const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, user, pass, n.phoneNumber)
      if (!cred?.sip_username) return null
      user = cred.sip_username; pass = cred.sip_password || pass; credId = cred.id || null
      if (n.telnyxCredentialId) await telnyxApi.deleteSIPCredential(n.telnyxCredentialId).catch(() => {})
    }
    const live = !dryRun() && !n.dryRun
    await require('../live-number').updateLive(phoneNumbersOf, chatId, n.phoneNumber, { $set: { 'val.numbers.$.sipUsername': user, 'val.numbers.$.sipPassword': pass, 'val.numbers.$.telnyxSipUsername': live || process.env.SIP_SERVER_SECRET ? user : n.telnyxSipUsername || null, 'val.numbers.$.telnyxSipPassword': live || process.env.SIP_SERVER_SECRET ? pass : n.telnyxSipPassword || null, 'val.numbers.$.telnyxCredentialId': credId || (process.env.SIP_SERVER_SECRET ? `kam:${user}` : n.telnyxCredentialId || null) } })
    return { username: user, password: pass }
  }

  // After payment: send the carrier details for a number that needs them, or cancel it for a full refund.
  const regOffer = (n) => countries().find(x => x.code === n.country)?.offers?.[n.type] || null
  router.post('/numbers/:phone/registration', withNumber(async (req, res) => {
    const n = req.num, c = countries().find(x => x.code === n.country), offer = regOffer(n)
    if (n.registration?.status !== 'needs_details' || !offer) return bad(res, 409, 'not_waiting', 'This number is not waiting for your details.')
    const why = await paperworkIssue(req.webChatId, n.country, c?.name || n.country, offer)
    if (why) return bad(res, 400, 'paperwork_needed', why)
    await require('../live-number').updateLive(phoneNumbersOf, req.webChatId, n.phoneNumber, { $set: { 'val.numbers.$.registration.status': 'pending', 'val.numbers.$.registration.detailsAt': new Date().toISOString() } })
    if (!n.dryRun) await deps.numberDocs?.submit({ chatId: req.webChatId, email: req.webUser?.email, phoneNumber: n.phoneNumber, country: n.country, countryName: c?.name || n.country, type: n.type }).catch(e => log(`[CloudIVR-Web] MultiTEL documents for ${n.phoneNumber}: ${e.message}`))
    res.json({ ok: true })
  }))
  async function cancelForRefund(chatId, n, why) {
    const ok = await phoneNumbersOf.updateOne({ _id: chatId, 'val.numbers': { $elemMatch: { phoneNumber: n.phoneNumber, 'registration.status': { $in: ['needs_details', 'pending'] } } } }, { $set: { 'val.numbers.$.status': 'released', 'val.numbers.$.releasedAt': new Date().toISOString(), 'val.numbers.$._releasedReason': why, 'val.numbers.$.registration.status': why, 'val.numbers.$.autoRenew': false } })
    if (!ok.modifiedCount) return null
    if (!dryRun() && !n.dryRun && n.telnyxOrderId) await telnyxApi.releaseNumber(n.telnyxOrderId).catch(e => log(`[CloudIVR-Web] release ${n.phoneNumber}: ${e.message}`))
    const paid = round2(Number(n.registration?.paid) || (Number(n.planPrice) || 0) + (Number(n.numberSurcharge) || 0))
    if (paid > 0) await w.credit(chatId, paid)
    notifyAdmin(`↩️ CloudIVR web: ${n.phoneNumber} cancelled before carrier approval (${why}) — refunded $${paid} to ${chatId}`)
    return paid
  }
  router.post('/numbers/:phone/registration/cancel', withNumber(async (req, res) => {
    const paid = await cancelForRefund(req.webChatId, req.num, 'cancelled_by_customer')
    if (paid === null) return bad(res, 409, 'not_cancellable', 'Only a number that is not approved yet can be cancelled for a refund.')
    res.json({ refunded: paid, balance: await w.balance(req.webChatId) })
  }))
  // Same reminder by email (web accounts have no Telegram chat; the in-app Inbox gets it too).
  async function mailDetails(chatId, n) {
    const a = await db.collection('webAccounts').findOne({ _id: Number(chatId) }, { projection: { email: 1 } }).catch(() => null)
    if (!a?.email) return
    const site = String(process.env.CLOUDIVR_PUBLIC_URL || 'https://cloudivr.net').replace(/\/+$/, '')
    await require('./auth').sendMail(a.email, `Finish switching on ${n.phoneNumber}`, `<p>Your number <b>${n.phoneNumber}</b> is paid and reserved. The carrier just needs your details and documents to switch it on.</p><p><a href="${site}/app/numbers">Open My numbers to finish</a> — it takes a couple of minutes. You can also cancel it there for a full refund.</p><p>Without the details the number is released and refunded to your wallet 14 days after purchase.</p>`).catch(e => log(`[CloudIVR-Web] details mail: ${e.message}`))
  }
  // Paid but details never sent: reminders after 1 and 3 days, refund after 14.
  async function chaseDetails(now = Date.now()) {
    const push = (id, text) => require('./notify').push(id, text, null, { kind: 'number', meta: { link: '/app/numbers' } }).catch(() => {})
    for (const d of await phoneNumbersOf.find({ 'val.numbers.registration.status': 'needs_details' }).toArray()) for (const n of d.val.numbers.filter(x => x.registration?.status === 'needs_details')) {
      const age = now - new Date(n.registration.since).getTime()
      if (age >= 14 * 864e5) { const paid = await cancelForRefund(d._id, n, 'details_missing'); if (paid !== null) await push(d._id, `We didn't receive the carrier details for ${n.phoneNumber}, so we released it and refunded $${paid.toFixed(2)} to your wallet.`); continue }
      const k = age >= 3 * 864e5 ? 'remind2' : age >= 864e5 ? 'remind1' : null
      if (!k || n.registration[k]) continue
      const u = await phoneNumbersOf.updateOne({ _id: d._id, 'val.numbers': { $elemMatch: { phoneNumber: n.phoneNumber, [`registration.${k}`]: { $exists: false } } } }, { $set: { 'val.numbers.$.registration.remind1': true, [`val.numbers.$.registration.${k}`]: true } })
      if (u.modifiedCount) await mailDetails(d._id, n)
      if (u.modifiedCount) await push(d._id, `${n.phoneNumber} is paid and reserved — the carrier just needs a few details to switch it on. Open the number in My numbers to finish, or cancel it there for a full refund. Without the details it is refunded automatically after 14 days.`)
    }
  }
  require('../active-slot').singletonInterval('web-number-details', () => chaseDetails().catch(e => log(`[CloudIVR-Web] details chase: ${e.message}`)), 30 * 60000)

  // Numbers that can send and receive texts with no carrier approval (no ID, no 10DLC) — sold on the Texting Number page.
  // Instant no-ID two-way texting countries, sold on the Basic plan; the USA is the Spenza Texting Number (assigned after payment).
  router.get('/texting/ready', h(async (req, res) => {
    const sold = countries()
    const items = texting.list().filter(o => sold.find(c => c.code === o.iso)?.types.includes(o.type)).map(o => ({ country: o.iso, name: o.name, flag: o.flag, type: o.type, typeName: o.type === 'local' ? 'Local' : 'Mobile', included: phoneConfig.includedCountries('starter').includes(o.iso), needs10dlc: o.iso === 'US', caps: { sms: true, voice: o.voice }, textPrice: o.textPrice, extraPrice: o.extraPrice }))
    res.json({ items, available: phoneConfig.PLAN_TEXTING(), plan: 'starter', price: phoneConfig.plans?.starter?.price ?? null, usa: { caps: { sms: true, voice: false }, assigned: true } })
  }))
  router.post('/texting/suggest', h(async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 500)
    if (text.length < 8) return bad(res, 400, 'too_short', 'Tell Emily a little more — who will you text, and where are they?')
    if (!process.env.APP_OPEN_API_KEY) return bad(res, 503, 'unavailable', 'Emily can’t suggest right now — pick a country below.')
    const ps = require('./plan-suggest')
    if (ps.limited(`t:${req.webChatId}`)) return bad(res, 429, 'rate_limited', 'That’s a lot of questions! Try again in a little while, or pick a country below.')
    const sold = countries()
    const items = texting.list().filter(o => sold.find(c => c.code === o.iso)?.types.includes(o.type)).map(o => ({ country: o.iso, name: o.name, flag: o.flag, type: o.type, typeName: o.type === 'local' ? 'Local' : 'Mobile', included: phoneConfig.includedCountries('starter').includes(o.iso), needs10dlc: o.iso === 'US', caps: { sms: true, voice: o.voice }, textPrice: o.textPrice, extraPrice: o.extraPrice }))
    try {
      const out = await ps.suggestTexting(text, items)
      if (out.offTopic) { require('../emily-guard').record('texting-suggest', { text, chatId: req.webChatId, reply: out.reason }); return bad(res, 422, 'off_topic', out.reason) }
      res.json(out)
    } catch (e) { log(`[CloudIVR-Web] texting suggest failed: ${e.message}`); bad(res, 503, 'unavailable', 'Emily couldn’t answer just now — try again, or pick a country below.') }
  }))

  // Extra SIP logins: free ones come with Pro (2) and Business (5); more on any plan with SIP cost $5/month each.
  const FREE = lifecycle.EXTRA_SIP_FREE
  const extraOk = (n) => phoneConfig.canAccessFeature(n.plan, 'sipCredentials')
  const freeLeft = (n) => Math.max(0, (FREE[n.plan] || 0) - (n.extraSip || []).filter(x => !x.paid).length)
  const pubExtra = (n) => (n.extraSip || []).map(x => ({ id: x.id, label: x.label, username: x.username, createdAt: x.createdAt, paid: !!x.paid, active: lifecycle.sipLoginOk(n, x), callerId: x.callerId || null }))
  // Which of your numbers a SIP login calls from (and is billed to). Empty = the number the login belongs to.
  router.get('/numbers/:phone/sip/caller-id', withNumber(async (req, res) => {
    const all = (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val?.numbers || []
    res.json({ main: req.num.sipCallerId || null, options: all.filter(x => x.status === 'active' && x.provider !== 'signalwire_fax' && x.capabilities?.voice !== false).map(x => x.phoneNumber) })
  }))
  router.put('/numbers/:phone/sip/caller-id', withNumber(async (req, res) => {
    const pick = req.body?.callerId ? String(req.body.callerId) : null, loginId = req.body?.loginId ? String(req.body.loginId) : null
    const doc = await phoneNumbersOf.findOne({ _id: req.webChatId })
    const all = doc?.val?.numbers || []
    if (pick && pick !== req.num.phoneNumber && !all.some(x => x.phoneNumber === pick && x.status === 'active' && x.provider !== 'signalwire_fax' && x.capabilities?.voice !== false)) return bad(res, 400, 'invalid_caller', 'Pick one of your active numbers that can make calls.')
    if (loginId && !(req.num.extraSip || []).some(e => e.id === loginId)) return bad(res, 404, 'not_found', 'SIP login not found on this number.')
    const value = pick === req.num.phoneNumber ? null : pick
    const nums = all.map(x => (x.phoneNumber !== req.num.phoneNumber ? x : loginId ? { ...x, extraSip: (x.extraSip || []).map(e => (e.id === loginId ? { ...e, callerId: value } : e)) } : { ...x, sipCallerId: value }))
    await phoneNumbersOf.updateOne({ _id: req.webChatId }, { $set: { 'val.numbers': nums } })
    log(`[CloudIVR-Web] ${req.webChatId} SIP login ${loginId || 'main'} on ${req.num.phoneNumber} now calls from ${value || req.num.phoneNumber}`)
    res.json({ ok: true, callerId: value || req.num.phoneNumber })
  }))
  router.get('/numbers/:phone/sip/extra', withNumber(async (req, res) => res.json({ allowed: extraOk(req.num), free: FREE[req.num.plan] || 0, freeLeft: freeLeft(req.num), price: lifecycle.EXTRA_SIP_PRICE(), max: lifecycle.EXTRA_SIP_MAX, logins: pubExtra(req.num), domain: phoneConfig.WEB_SIP_DOMAIN })))
  router.post('/numbers/:phone/sip/extra', withNumber(async (req, res) => {
    const n = req.num, MAX = lifecycle.EXTRA_SIP_MAX
    if (!extraOk(n)) return bad(res, 403, 'plan_required', 'Extra SIP logins need a plan with SIP (Starter, Pro or Business). Upgrade this number to add them.')
    if ((n.extraSip || []).length >= MAX) return bad(res, 400, 'limit_reached', `This number already has ${MAX} extra SIP logins. Remove one to add another.`)
    const paid = freeLeft(n) === 0, price = lifecycle.EXTRA_SIP_PRICE()
    if (paid && req.body?.confirmPaid !== true) return bad(res, 402, 'confirm_paid', `No free extra logins left on this plan. Each extra one costs $${price}/month, charged now and with each renewal.`)
    if (paid && !(await walletOps(db).debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `An extra SIP login costs $${price}/month.`, { cost: Number(price) })
    const label = String(req.body?.label || '').trim().slice(0, 40) || `Device ${(n.extraSip || []).length + 1}`
    const login = { id: crypto.randomUUID().slice(0, 8), label, username: phoneConfig.generateSipUsername(), password: phoneConfig.generateSipPassword(), createdAt: new Date().toISOString(), ...(paid ? { paid: true, price } : {}) }
    const u = await phoneNumbersOf.updateOne({ _id: req.webChatId, val: { $exists: true }, 'val.numbers': { $elemMatch: { phoneNumber: n.phoneNumber, [`extraSip.${MAX - 1}`]: { $exists: false } } } }, { $push: { 'val.numbers.$.extraSip': login } })
    if (!u.modifiedCount) { if (paid) await walletOps(db).credit(req.webChatId, price); return bad(res, 400, 'limit_reached', `This number already has ${MAX} extra SIP logins. Remove one to add another.`) }
    if (paid) await db.collection('transactions').insertOne({ _id: `sip-extra-${req.webChatId}-${login.id}`, chatId: String(req.webChatId), type: 'extra-sip-login', amount: price, currency: 'USD', status: 'completed', ref: n.phoneNumber, createdAt: new Date() })
    log(`[CloudIVR-Web] ${req.webChatId} added ${paid ? 'paid' : 'free'} extra SIP login ${login.username} (${label}) to ${n.phoneNumber}`)
    res.json({ ...login, domain: phoneConfig.WEB_SIP_DOMAIN, port: 5060, transport: 'UDP/TCP' })
  }))
  router.delete('/numbers/:phone/sip/extra/:id', withNumber(async (req, res) => {
    await require('../live-number').updateLive(phoneNumbersOf, req.webChatId, req.num.phoneNumber, { $pull: { 'val.numbers.$.extraSip': { id: req.params.id } } })
    res.json({ ok: true })
  }))

  router.post('/numbers/:phone/sip/reset', withNumber(async (req, res) => {
    if (!gate(req, res, 'sipCredentials', 'SIP credentials')) return
    const c = await rotateSip(req.webChatId, req.num)
    if (!c) return bad(res, 424, 'sip_reset_failed', 'Could not create new SIP credentials. Your current ones still work.')
    res.json({ ...c, domain: phoneConfig.WEB_SIP_DOMAIN })
  }))

  router.post('/numbers/:phone/auto-renew', notReplaced(async (req, res) => {
    await setField(req.webChatId, req.num.phoneNumber, 'autoRenew', !!req.body.enabled)
    res.json({ autoRenew: !!req.body.enabled })
  }))

  // Wallet renewal; restoring a suspended main line also brings back its extra lines (see plan-lifecycle.js).
  router.post('/numbers/:phone/renew', notReplaced(async (req, res) => {
    const numbers = (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val?.numbers || []
    const n = numbers.find(x => x.phoneNumber === req.num.phoneNumber && x.status !== 'released') || req.num
    const block = lifecycle.renewBlock(numbers, n)
    if (block === 'main_line_suspended') return bad(res, 409, block, 'This extra line comes back when its main line is restored. Renew the main line first.')
    if (block) return bad(res, 409, block, block === 'released' ? 'This number has been released and can no longer be renewed.' : 'We could not work out the renewal price for this line. Please contact support.')
    const offer = deps.offers ? await deps.offers.renewOffer(req.webChatId, n.phoneNumber).catch(() => null) : null
    const full = round2(lifecycle.renewalPrice(n))
    const price = offer ? round2(full * (1 - offer.discount / 100)) : full
    if (price > 0 && !(await w.debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `Renewal costs $${price.toFixed(2)}.`, { cost: price })
    const r = lifecycle.renewPatches(numbers, n)
    await lifecycle.applyDb(phoneNumbersOf, req.webChatId, r.patches)
    const action = r.wasSuspended ? 'restore' : 'renew'
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action, plan: n.plan, amount: price, paymentMethod: 'wallet_usd', channel: 'web', restoredExtras: r.restored, ...(offer ? { offer: offer._id, discountPct: offer.discount } : {}), timestamp: new Date().toISOString() })
    await txn(req.webChatId, 'phone-renewal', price, { phoneNumber: n.phoneNumber, plan: n.plan, action })
    if (offer) await deps.offers.markUsed(offer._id).catch(() => {})
    res.json({ expiresAt: r.expiresAt, price, discount: offer ? offer.discount : 0, restored: r.restored, waiting: r.waiting, balance: await w.balance(req.webChatId) })
  }))

  // Price to move `n` up to `newPlan` now → { charge, credit, newPrice } or { error } (HTTP-style).
  function upgradeQuote(n, newPlan, pct = 0, diff = false) {
    const order = Object.keys(phoneConfig.plans)
    if (n.isSubNumber) return { error: { status: 400, error: 'is_extra', message: 'Extra numbers follow the plan of their main number.' } }
    if (lifecycle.onHold(n)) return { error: { status: 409, error: 'suspended', message: 'Restore this number first (Renew now), then change its plan.' } }
    if (!phoneConfig.plans[newPlan] || order.indexOf(newPlan) <= order.indexOf(n.plan)) return { error: { status: 400, error: 'invalid_plan', message: 'Pick a higher plan than the current one.' } }
    const q = diff && newPlan === 'business' ? phoneConfig.callerIdUpgradeQuote(n) : phoneConfig.computeUpgradeQuote(n, newPlan)
    // Keep the number's surcharge (e.g. international) on top of the new plan price, as downgrade does.
    const surcharge = Math.max(0, round2((n.planPrice || lifecycle.listPrice(n)) - lifecycle.listPrice(n)))
    const full = round2(q && Number.isFinite(q.chargeAmount) ? q.chargeAmount : phoneConfig.plans[newPlan].price)
    return { charge: round2(full * (1 - pct / 100)), fullCharge: full, discount: pct, credit: round2(q?.credit || 0), newPrice: round2(phoneConfig.plans[newPlan].price + surcharge) }
  }

  // Charges the wallet and switches the plan → { status, body }. viaOrder = crypto order ref that paid for it.
  const upgradeOffer = (chatId, n, plan) => (deps.offers ? deps.offers.upgradeOffer(chatId, n.phoneNumber, plan).catch(() => null) : null)
  // pct = offer discount already fixed on a crypto order (null → today's offer, if any).
  async function upgradeNumber(chatId, n, newPlan, viaOrder = null, pct = null, diff = false) {
    const offer = pct === null ? await upgradeOffer(chatId, n, newPlan) : null
    const q = upgradeQuote(n, newPlan, pct === null ? (offer?.discount || 0) : pct, diff)
    if (q.error) return { status: q.error.status, body: { error: q.error.error, message: q.error.message } }
    if (!(await w.debit(chatId, q.charge))) return { status: 402, body: { error: 'insufficient_balance', message: `The upgrade costs $${q.charge.toFixed(2)}.`, cost: q.charge } }
    // Switch back on what a downgrade turned off, when the new plan includes it.
    const set = lifecycle.numberSet({ plan: newPlan, planPrice: q.newPrice, ...lifecycle.upgradePatch(n, newPlan) })
    await require('../live-number').updateLive(phoneNumbersOf, chatId, n.phoneNumber, { $set: set, $unset: { 'val.numbers.$.priceLock': '' } })
    await phoneNumbersOf.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].plan': newPlan } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': n.phoneNumber }] }).catch(() => {})
    await phoneTransactions.insertOne({ chatId, phoneNumber: n.phoneNumber, action: 'upgrade', oldPlan: n.plan, newPlan, oldPrice: n.planPrice, newPrice: q.newPrice, amount: q.charge.toFixed(2), credit: q.credit.toFixed(2), paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', ...(viaOrder ? { orderRef: viaOrder } : {}), channel: 'web', timestamp: new Date().toISOString() })
    await txn(chatId, 'phone-upgrade', q.charge, { phoneNumber: n.phoneNumber, plan: newPlan })
    if (offer) await deps.offers.markUsed(offer._id).catch(() => {})
    if (viaOrder) notifyAdmin(`🌐 CloudIVR web: ${n.phoneNumber} upgraded ${phoneConfig.plans[n.plan]?.name} → ${phoneConfig.plans[newPlan].name} · crypto checkout $${q.charge}\nweb account: ${chatId}`)
    return { status: 200, body: { plan: newPlan, charged: q.charge, balance: await w.balance(chatId) } }
  }

  router.post('/numbers/:phone/upgrade', notReplaced(async (req, res) => {
    const newPlan = String(req.body.plan || '')
    const offer = await upgradeOffer(req.webChatId, req.num, newPlan)
    const q = upgradeQuote(req.num, newPlan, offer?.discount || 0)
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

  // ---------- Replace a number ($25): same country + type, settings move over, the old one keeps working 7 days ----------
  const REPLACE_PRICE = 25, OVERLAP_DAYS = 7
  router.post('/numbers/:phone/replace', withNumber(async (req, res) => {
    const old = req.num, chatId = req.webChatId
    if (old.replacedBy) return bad(res, 409, 'already_replaced', `This number was already replaced by ${old.replacedBy}.`)
    if (old.status !== 'active') return bad(res, 409, 'not_active', 'Only active numbers can be replaced. Renew it first.')
    const picked = await pickFromSearch(chatId, req.body?.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    if (picked.country !== old.country || picked.type !== old.type) return bad(res, 400, 'same_kind', `Pick a ${old.countryName || old.country} ${TYPE_NAMES[old.type] || old.type} number, the same kind as the one you have.`)
    const phone = normPhone(req.body.phoneNumber)
    try { await locks.insertOne({ _id: phone, chatId, at: new Date() }) } catch (e) { if (e.code === 11000) return bad(res, 409, 'number_taken', 'Someone is buying that number right now. Pick another one.'); throw e }
    try {
      if (await holderOf(phone) !== null) return bad(res, 409, 'number_taken', 'Someone just took that number. Pick another one.')
      const c = countries().find(x => x.code === old.country)
      const ver = await verificationInfo(old.country, old.type, `${c?.flag || ''} ${c?.name || old.country}`)
      if (ver.error) return bad(res, 424, 'lookup_failed', ver.error)
      if (ver.required) return bad(res, 400, 'needs_documents', 'Numbers in this country need ID documents, so they can’t be replaced online. Message support and we’ll help.')
      if (!(await w.debit(chatId, REPLACE_PRICE))) return bad(res, 402, 'insufficient_balance', `Replacing a number costs $${REPLACE_PRICE}. Your wallet has $${(await w.balance(chatId)).toFixed(2)}.`, { cost: REPLACE_PRICE })
      try {
        const live = !dryRun() && !old.dryRun
        const tr = getTelnyxResources() || {}
        const order = live ? await paidCheckout(chatId, phone, { countryCode: old.country, numberType: old.type, areaCode: picked.areaCode, planKey: old.plan, price: REPLACE_PRICE, paymentMethod: 'wallet_usd', refund: { currency: 'usd', amount: REPLACE_PRICE }, capabilities: picked.hit.capabilities, numberCost: picked.hit.cost, countryName: c?.name, lang: 'en', hold: true }) : { id: `dryrun-${crypto.randomUUID().slice(0, 8)}` }
        if (!order || order._verification) throw new Error('The new number could not be reserved — it may have just been taken. Pick another one.')
        const selected = order._retriedNumber || phone
        if (live && tr.callControlAppId) await telnyxApi.assignNumberToCallControlApp(selected, tr.callControlAppId)
        // SIP apps keep their login: the credential moves to the new number.
        let sip = { telnyxSipUsername: old.telnyxSipUsername || null, telnyxSipPassword: old.telnyxSipPassword || null, telnyxCredentialId: old.telnyxCredentialId || null }
        if (live && tr.sipConnectionId) {
          if (old.telnyxCredentialId) await telnyxApi.deleteSIPCredential(old.telnyxCredentialId).catch(() => {})
          const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, old.sipUsername, old.sipPassword, selected)
          if (cred?.sip_username) sip = { telnyxSipUsername: cred.sip_username, telnyxSipPassword: cred.sip_password || old.sipPassword, telnyxCredentialId: cred.id || null }
        }
        const caps = { voice: picked.hit.capabilities.voice !== false, sms: !!picked.hit.capabilities.sms, mms: !!picked.hit.capabilities.mms, fax: !!picked.hit.capabilities.fax }
        const { _reminder3Sent, _reminder1Sent, ...keep } = old
        const doc = { ...keep, ...sip, phoneNumber: selected, telnyxOrderId: order.id, provider: order._provider || (String(order.id || '').startsWith('mt:') ? 'multitel' : String(order.id || '').startsWith('ib:') ? 'infobip' : keep.provider || 'telnyx'), capabilities: caps, purchaseDate: new Date().toISOString(), replaces: old.phoneNumber, messagingProfileId: caps.sms ? tr.messagingProfileId || old.messagingProfileId || null : null, features: { ...(old.features || {}), sms: !!caps.sms && old.features?.sms === true }, ...(live ? {} : { dryRun: true }) }
        const releaseAt = new Date(Date.now() + OVERLAP_DAYS * 86400000).toISOString()
        await require('../live-number').updateLive(phoneNumbersOf, chatId, old.phoneNumber, { $set: { 'val.numbers.$.replacedBy': selected, 'val.numbers.$.releaseAt': releaseAt, 'val.numbers.$.autoRenew': false, 'val.numbers.$.telnyxCredentialId': null, 'val.numbers.$.telnyxSipUsername': null, 'val.numbers.$.telnyxSipPassword': null, 'val.numbers.$.sipUsername': null, 'val.numbers.$.sipPassword': null } })
        const eu = await deps.legalProfile?.recordResale({ chatId, phoneNumber: selected, provider: order._provider || 'telnyx', country: old.country })
        if (eu) doc.endUser = eu
        doc.resold = true
        await phoneNumbersOf.updateOne({ _id: chatId }, { $push: { 'val.numbers': doc } })
        await phoneNumbersOf.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].parentNumber': selected } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': old.phoneNumber }] }).catch(() => {})
        await phoneTransactions.insertOne({ chatId, phoneNumber: selected, action: 'replace', oldNumber: old.phoneNumber, plan: old.plan, amount: REPLACE_PRICE, paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
        await txn(chatId, 'number-replace', REPLACE_PRICE, { phoneNumber: selected, oldNumber: old.phoneNumber })
        await notify.push(chatId, `🔁 ${old.phoneNumber} was replaced by ${selected} for $${REPLACE_PRICE}. Your plan, renewal date and settings moved over. The old number keeps working until ${releaseAt.slice(0, 10)}, then it’s released.`, null, { kind: 'billing', meta: { replaced: { old: old.phoneNumber, new: selected } } }).catch(() => {})
        notifyAdmin(`🔁 CloudIVR web: ${old.phoneNumber} replaced by ${selected}${live ? '' : ' (DRY RUN)'} · $${REPLACE_PRICE}\nweb account: ${chatId}`)
        await searchCache.deleteOne({ _id: chatId })
        res.status(201).json({ number: publicNumber(doc), oldNumber: old.phoneNumber, releaseAt, charged: REPLACE_PRICE, balance: await w.balance(chatId) })
      } catch (e) {
        await w.credit(chatId, REPLACE_PRICE)
        log(`[CloudIVR-Web] replace ${old.phoneNumber} → ${phone} failed: ${e.message} — refunded`)
        bad(res, 424, 'replace_failed', `${e.message && e.message.length < 160 ? e.message : 'The new number could not be activated.'} You were refunded $${REPLACE_PRICE}.`)
      }
    } finally { await locks.deleteOne({ _id: phone }).catch(() => {}) }
  }))
  // After the overlap the old number is released.
  async function releaseReplaced() {
    const now = new Date().toISOString()
    for (const acct of await phoneNumbersOf.find({ 'val.numbers': { $elemMatch: { replacedBy: { $ne: null }, status: 'active', releaseAt: { $lte: now } } } }).toArray()) {
      for (const n of (acct.val?.numbers || []).filter(x => x.replacedBy && x.status === 'active' && x.releaseAt <= now)) {
        if (!dryRun() && !n.dryRun) { const ok = n.telnyxOrderId ? await telnyxApi.releaseNumber(n.telnyxOrderId).catch(() => false) : false; if (!ok) await telnyxApi.releaseByPhoneNumber(n.phoneNumber).catch(() => {}) }
        await setField(acct._id, n.phoneNumber, 'status', 'released')
        await notify.push(acct._id, `${n.phoneNumber} was released. Calls and texts now reach ${n.replacedBy} only.`, null, { kind: 'billing' }).catch(() => {})
        log(`[CloudIVR-Web] released replaced number ${n.phoneNumber} (now ${n.replacedBy})`)
      }
    }
  }
  const relT = setInterval(() => releaseReplaced().catch(e => log(`[CloudIVR-Web] release replaced: ${e.message}`)), 10 * 60000)
  relT.unref?.()

  return { myNumbers, findMine, purchase, REPLACE_PRICE, releaseReplaced, pickFromSearch, pickManyFromSearch, extraPriceOf, searchSimilar, setField, checkCoupon, unheld, ownAudioUrls, upgradeQuote, upgradeNumber, upgradeOffer, rotateSip }
}

// USA mobile numbers (two-way SMS lines, esimLines kind 'mobile') are numbers too; plain eSIMs are not.
const LIVE_MOBILE = ['provisioning', 'awaiting_imei', 'active', 'suspended']
const mobileLines = (db, chatId) => db.collection('esimLines').find({ chatId: String(chatId), kind: 'mobile', status: { $in: LIVE_MOBILE } }).toArray()

// Landline to Texting numbers past checkout (setup underway, live or paused); expiresAt = next monthly bill (plan-attached ones have none).
const LIVE_TEXTING = ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused']
const textingLines = async (db, chatId) => (await db.collection('hostedSms').find({ chatId: String(chatId), status: { $in: LIVE_TEXTING } }).toArray())
  .map(d => ({ ...d, plan: 'texting', expiresAt: d.planNumber ? null : d.nextBillAt || null, texting: true }))

module.exports = { textingLines, LIVE_TEXTING, mobileLines, LIVE_MOBILE, parseBackups, routes, catalog, routeSummary, publicNumber, publicVoicemail, validateIvr, normPhone, countries, E164, webFeatures, recommendedPlan, WEB_FEATURES }
