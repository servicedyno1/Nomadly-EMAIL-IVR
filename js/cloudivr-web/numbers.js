'use strict'
// Numbers: catalogue, search, buy (wallet), and every per-number setting. Records use the bot's exact schema in
// phoneNumbersOf so the existing call engine (forwarding, IVR, voicemail, recording, SIP, renewals) serves them.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const { walletOps, round2, livePayments } = require('./wallet')

const TYPE_NAMES = { local: 'Local', toll_free: 'Toll-free', mobile: 'Mobile', national: 'National' }
const FEATURE_KEYS = ['callForwarding', 'smsToEmail', 'smsWebhook', 'voicemail', 'sipCredentials', 'callRecording', 'ivr', 'ivrOutbound', 'bulkCall', 'otpCollection']
const LOG_TYPES = { sms: ['sms'], voicemail: ['voicemail'], fax: ['fax'] }
const E164 = /^\+[1-9]\d{7,14}$/
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const webText = (s) => String(s).replace(/Telegram/g, 'your inbox')

const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d ? (d.startsWith('+') ? d : `+${d}`) : '' }
const bad = (res, status, error, message) => res.status(status).json({ error, message })

// Same Telnyx catalogue the bot shows (US/CA + international, incl. countries that need ID checks).
function countries() {
  const intl = phoneConfig.isTelnyxIntlEnabled() ? [...phoneConfig.telnyxIntlCountries, ...phoneConfig.telnyxIntlMore] : []
  return [...phoneConfig.countries, ...intl].filter(c => c.provider === 'telnyx').map(c => {
    const i = c.name.indexOf(' ')
    return { code: c.code, flag: c.name.slice(0, i), name: c.name.slice(i + 1), types: c.types || ['local', 'toll_free'] }
  })
}

const catalog = () => ({
  plans: Object.entries(phoneConfig.plans).map(([id, p]) => ({ id, name: p.name, price: p.price, minutes: p.minutes, sms: p.sms, features: p.features.map(webText), available: phoneConfig.isPlanAvailable(id), access: access(id) })),
  countries: countries(), typeNames: TYPE_NAMES,
  rates: { forwardingPerMin: phoneConfig.CALL_FORWARDING_RATE_MIN, overagePerMin: phoneConfig.OVERAGE_RATE_MIN, overagePerSms: phoneConfig.OVERAGE_RATE_SMS },
  sipDomain: phoneConfig.SIP_DOMAIN, dryRun: dryRun(), livePayments: livePayments(),
})

function access(plan) {
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, !!phoneConfig.canAccessFeature(plan, k)]))
}

function publicNumber(n) {
  const plan = phoneConfig.plans[n.plan] || {}
  const f = n.features || {}
  return {
    phoneNumber: n.phoneNumber, country: n.country, countryName: n.countryName, type: n.type,
    plan: n.plan, planName: plan.name || n.plan, planPrice: n.planPrice, status: n.status, autoRenew: n.autoRenew !== false,
    purchaseDate: n.purchaseDate, expiresAt: n.expiresAt, isSubNumber: !!n.isSubNumber, dryRun: !!n.dryRun,
    capabilities: n.capabilities || { voice: true, sms: true, fax: false },
    usage: { minutesUsed: n.minutesUsed || 0, minutesIncluded: plan.minutes ?? null, smsUsed: n.smsUsed || 0, smsIncluded: plan.sms ?? null },
    sipUsername: n.telnyxSipUsername || n.sipUsername || null, sipDomain: n.sipDomain || phoneConfig.SIP_DOMAIN,
    features: {
      callForwarding: f.callForwarding || { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
      voicemail: f.voicemail || { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToEmail: null, ringTimeout: 25 },
      smsForwarding: f.smsForwarding || { toTelegram: true, toEmail: null, webhookUrl: null },
      recording: !!f.recording,
      ivr: f.ivr || { enabled: false, options: {} },
    },
    access: access(n.plan),
  }
}

// audioOk(url) → true when the url is one of the account's own library files.
function validateIvr(body, plan, audioOk = () => true) {
  const ivr = body || {}
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
        const to = normPhone(o.forwardTo)
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
        out[digit] = { action, label, subMenu: { greetingType: subAudio ? 'audio' : 'text', greeting: String(sub.greeting || 'Please select an option.').slice(0, 1000), greetingAudioUrl: subAudio, options: clean(sub.options, 1) } }
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
    greeting: String(ivr.greeting || 'Thank you for calling. Please select an option.').slice(0, 1000),
    greetingAudioUrl,
    voice: ivr.voice || null, speed: Number(ivr.speed) || 1,
    options,
  }
}

const publicLog = (l) => ({
  id: String(l._id), type: l.type, direction: l.direction || (String(l.type || '').startsWith('outbound') ? 'outbound' : 'inbound'),
  from: l.from || null, to: l.to || l.phoneNumber || null, phoneNumber: l.phoneNumber || null, duration: l.duration || 0,
  body: l.body || null, recordingUrl: l.recordingUrl || null, digit: l.digitPressed || null, forwardTo: l.forwardTo || null, timestamp: l.timestamp,
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
  const ownAudioUrls = async (chatId) => new Set((await audioLibraryService.listAudios(chatId)).map(a => a.audioUrl))
  const txn = (chatId, type, amount, metadata) => {
    try { return logTransaction && logTransaction(db, { transactionId: generateTransactionId ? generateTransactionId() : crypto.randomUUID(), chatId, type, amount, currency: 'USD', status: 'completed', metadata: { ...metadata, channel: 'web' } }) } catch (_) { return null }
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
    const found = await telnyxApi.searchNumbers(country, type, areaCode, 12)
    const results = (found || []).map(n => ({
      phoneNumber: n.phone_number,
      region: (n.region_information || []).map(r => r.region_name).filter(Boolean).join(', '),
      capabilities: n._capabilities || { voice: true, sms: false, fax: false },
      surcharge: round2(numberSurcharge(country, type, n)),
      cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
    }))
    await searchCache.updateOne({ _id: req.webChatId }, { $set: { country, type, areaCode, results, at: new Date() } }, { upsert: true })
    res.json({ numbers: results.map(({ cost, ...r }) => r) })
  }))

  router.get('/numbers', h(async (req, res) => res.json({ numbers: (await myNumbers(req.webChatId)).map(publicNumber) })))
  router.get('/numbers/:phone', withNumber(async (req, res) => res.json({ number: publicNumber(req.num) })))

  // Picked number from the account's last search (null when it is no longer there).
  const pickFromSearch = async (chatId, phone) => {
    const cache = await searchCache.findOne({ _id: chatId })
    const hit = cache?.results?.find(r => r.phoneNumber === normPhone(phone))
    return hit ? { hit, country: cache.country, type: cache.type, areaCode: cache.areaCode } : null
  }
  const searchSimilar = async (country, type, areaCode) => (await telnyxApi.searchNumbers(country, type, areaCode, 6) || []).map(n => ({
    phoneNumber: n.phone_number, capabilities: n._capabilities || { voice: true, sms: false, fax: false },
    surcharge: round2(numberSurcharge(country, type, n)), cost: { monthly: parseFloat(n.cost_information?.monthly_cost) || 0, upfront: parseFloat(n.cost_information?.upfront_cost) || 0 },
  }))

  // True when another account already holds this number (e.g. bought while a crypto payment was confirming).
  const takenByOther = async (chatId, phone) => !!(await phoneNumbersOf.findOne({ _id: { $ne: chatId }, 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } }, { projection: { _id: 1 } }))

  // Debits the wallet and activates the number → { status, body } (HTTP-style; refunds on failure).
  async function purchase({ chatId, email, phone, planKey, hit, country, type, areaCode, autoRenew = true, viaOrder = null }) {
    const plan = phoneConfig.plans[planKey]
    if (!plan || !phoneConfig.isPlanAvailable(planKey)) return { status: 400, body: { error: 'invalid_plan', message: 'That plan is not available.' } }
    if (await takenByOther(chatId, phone)) return { status: 409, body: { error: 'number_taken', message: 'Someone just took that number. Pick another one.' } }
    const c = countries().find(x => x.code === country)
    const ver = await verificationInfo(country, type, `${c.flag} ${c.name}`)
    if (ver.error) return { status: 424, body: { error: 'lookup_failed', message: ver.error } }
    const price = round2(plan.price + (hit.surcharge || 0))
    if (!(await w.debit(chatId, price))) return { status: 402, body: { error: 'insufficient_balance', message: `This number costs $${price.toFixed(2)}. Your wallet has $${(await w.balance(chatId)).toFixed(2)} — top up first.` } }

    let selected = phone
    try {
      const tr = getTelnyxResources() || {}
      // hold: web verifications never expire or auto-refund — the number waits until the owner finishes.
      const ctx = { countryCode: country, numberType: type, areaCode, planKey, price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', refund: { currency: 'usd', amount: price }, capabilities: hit.capabilities, numberCost: hit.cost, countryName: `${c.flag} ${c.name}`, lang: 'en', hold: true }
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
        const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword)
        if (cred?.sip_username) { tUser = sipUsername = cred.sip_username; tPass = sipPassword = cred.sip_password || sipPassword; tCredId = cred.id || null }
      }
      const caps = { voice: true, sms: !!hit.capabilities.sms, fax: !!hit.capabilities.fax }
      const expiresAt = new Date(); expiresAt.setMonth(expiresAt.getMonth() + 1)
      const doc = {
        phoneNumber: selected, telnyxOrderId: order.id, provider: 'telnyx', country, countryName: c.name,
        type, plan: planKey, planPrice: price, purchaseDate: new Date().toISOString(), expiresAt: expiresAt.toISOString(), autoRenew: autoRenew !== false, status: 'active',
        sipUsername, sipPassword, telnyxSipUsername: tUser, telnyxSipPassword: tPass, telnyxCredentialId: tCredId, sipDomain: phoneConfig.SIP_DOMAIN,
        messagingProfileId: caps.sms ? tr.messagingProfileId || null : null, connectionId: tr.sipConnectionId || null, smsUsed: 0, minutesUsed: 0,
        capabilities: caps, channel: 'web', ...(dryRun() ? { dryRun: true } : {}),
        features: {
          sms: caps.sms,
          callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
          voicemail: { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, forwardToEmail: null, ringTimeout: 25 },
          smsForwarding: { toTelegram: true, toEmail: null, webhookUrl: null },
          faxForwarding: { toTelegram: true }, recording: false,
        },
      }
      await phoneNumbersOf.updateOne({ _id: chatId }, { $push: { 'val.numbers': doc } }, { upsert: true })
      await phoneTransactions.insertOne({ chatId, phoneNumber: selected, action: 'purchase', plan: planKey, amount: price, paymentMethod: viaOrder ? 'crypto_order' : 'wallet_usd', ...(viaOrder ? { orderRef: viaOrder } : {}), channel: 'web', timestamp: new Date().toISOString() })
      await txn(chatId, 'phone-number', price, { phoneNumber: selected, plan: planKey, provider: 'telnyx', country })
      notifyAdmin(`🌐 CloudIVR web purchase${dryRun() ? ' (DRY RUN)' : ''}${viaOrder ? ' · crypto checkout' : ''}\nweb account: ${chatId} (${email})\nnumber: ${selected} (${country})\nplan: ${plan.name} $${price}`)
      await searchCache.deleteOne({ _id: chatId })
      return { status: 201, body: { number: publicNumber(doc), substitutedFrom: selected !== phone ? phone : null, balance: await w.balance(chatId) } }
    } catch (e) {
      await w.credit(chatId, price)
      log(`[CloudIVR-Web] purchase failed for ${chatId} ${phone}: ${e.message} — refunded $${price}`)
      return { status: 424, body: { error: 'purchase_failed', message: `${e.message && e.message.length < 160 ? e.message : 'The number could not be activated.'} You were refunded $${price.toFixed(2)}.` } }
    }
  }

  router.post('/numbers/buy', h(async (req, res) => {
    const picked = await pickFromSearch(req.webChatId, req.body.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    const r = await purchase({ chatId: req.webChatId, email: req.webUser.email, phone: normPhone(req.body.phoneNumber), planKey: String(req.body.plan || ''), autoRenew: req.body.autoRenew !== false, ...picked })
    res.status(r.status).json(r.body)
  }))

  router.patch('/numbers/:phone/forwarding', withNumber(async (req, res) => {
    if (!gate(req, res, 'callForwarding', 'Call forwarding')) return
    const mode = String(req.body.mode || 'disabled')
    if (!['always', 'busy', 'no_answer', 'disabled'].includes(mode)) return bad(res, 400, 'invalid_mode', 'Pick always, busy, no answer or off.')
    const to = mode === 'disabled' ? null : normPhone(req.body.forwardTo)
    if (mode !== 'disabled') {
      if (!E164.test(to)) return bad(res, 400, 'invalid_number', 'Enter the forward number with country code, e.g. +14155550100.')
      if (phoneConfig.isBlockedPrefix(to)) return bad(res, 400, 'blocked_destination', `${to} is a blocked premium/satellite destination.`)
      if (to === req.num.phoneNumber) return bad(res, 400, 'self_forward', 'A number cannot forward to itself.')
    }
    const ringTimeout = Math.min(60, Math.max(10, parseInt(req.body.ringTimeout, 10) || 25))
    const value = { enabled: mode !== 'disabled', mode, forwardTo: to, ringTimeout, holdMusic: !!req.body.holdMusic }
    await setField(req.webChatId, req.num.phoneNumber, 'features.callForwarding', value)
    res.json({ callForwarding: value })
  }))

  router.patch('/numbers/:phone/voicemail', withNumber(async (req, res) => {
    if (!gate(req, res, 'voicemail', 'Voicemail')) return
    const email = String(req.body.forwardToEmail || '').trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return bad(res, 400, 'invalid_email', 'Enter a valid email for voicemail delivery.')
    const url = req.body.greetingType === 'custom' ? String(req.body.customGreetingUrl || '') : ''
    if (url && !(await ownAudioUrls(req.webChatId)).has(url)) return bad(res, 400, 'invalid_audio', 'Pick a greeting from your audio library.')
    const value = { ...(req.num.features?.voicemail || {}), enabled: !!req.body.enabled, greetingType: url ? 'custom' : 'default', customGreetingUrl: url || null, forwardToTelegram: true, forwardToEmail: email || null, ringTimeout: Math.min(60, Math.max(10, parseInt(req.body.ringTimeout, 10) || 25)) }
    await setField(req.webChatId, req.num.phoneNumber, 'features.voicemail', value)
    res.json({ voicemail: value })
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

  router.put('/numbers/:phone/ivr', withNumber(async (req, res) => {
    if (!gate(req, res, 'ivr', 'The IVR auto-attendant')) return
    const urls = await ownAudioUrls(req.webChatId)
    let value
    try { value = validateIvr(req.body, req.num.plan, (u) => urls.has(u)) } catch (e) { return bad(res, 400, 'invalid_ivr', e.message) }
    await setField(req.webChatId, req.num.phoneNumber, 'features.ivr', value)
    res.json({ ivr: value })
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
    else if (kind === 'calls') q.type = { $nin: ['sms', 'fax'] }
    else if (kind === 'recordings') q.recordingUrl = { $nin: [null, ''] }
    const logs = await phoneLogs.find(q).sort({ timestamp: -1 }).limit(100).toArray()
    res.json({ logs: logs.map(publicLog) })
  }))

  router.get('/activity', h(async (req, res) => {
    const phones = (await myNumbers(req.webChatId)).map(n => n.phoneNumber)
    const logs = phones.length ? await phoneLogs.find({ phoneNumber: { $in: phones } }).sort({ timestamp: -1 }).limit(Math.min(100, parseInt(req.query.limit, 10) || 30)).toArray() : []
    res.json({ logs: logs.map(publicLog) })
  }))

  router.get('/numbers/:phone/sip', withNumber(async (req, res) => {
    if (!gate(req, res, 'sipCredentials', 'SIP credentials')) return
    const n = req.num
    res.json({ username: n.telnyxSipUsername || n.sipUsername, password: n.telnyxSipPassword || n.sipPassword, domain: n.sipDomain || phoneConfig.SIP_DOMAIN, port: 5060, transport: 'UDP/TCP/TLS', live: !!n.telnyxSipUsername })
  }))

  router.post('/numbers/:phone/sip/reset', withNumber(async (req, res) => {
    if (!gate(req, res, 'sipCredentials', 'SIP credentials')) return
    const n = req.num, tr = getTelnyxResources() || {}
    let user = phoneConfig.generateSipUsername(), pass = phoneConfig.generateSipPassword(), credId = null
    if (!dryRun() && tr.sipConnectionId) {
      const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, user, pass)
      if (!cred?.sip_username) return bad(res, 424, 'sip_reset_failed', 'Could not create new SIP credentials. Your current ones still work.')
      user = cred.sip_username; pass = cred.sip_password || pass; credId = cred.id || null
      if (n.telnyxCredentialId) await telnyxApi.deleteSIPCredential(n.telnyxCredentialId).catch(() => {})
    }
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.sipUsername': user, 'val.numbers.$.sipPassword': pass, 'val.numbers.$.telnyxSipUsername': dryRun() ? n.telnyxSipUsername || null : user, 'val.numbers.$.telnyxSipPassword': dryRun() ? n.telnyxSipPassword || null : pass, 'val.numbers.$.telnyxCredentialId': credId || n.telnyxCredentialId || null } })
    res.json({ username: user, password: pass, domain: n.sipDomain || phoneConfig.SIP_DOMAIN })
  }))

  router.post('/numbers/:phone/auto-renew', withNumber(async (req, res) => {
    await setField(req.webChatId, req.num.phoneNumber, 'autoRenew', !!req.body.enabled)
    res.json({ autoRenew: !!req.body.enabled })
  }))

  router.post('/numbers/:phone/renew', withNumber(async (req, res) => {
    const n = req.num, price = round2(n.planPrice || phoneConfig.plans[n.plan]?.price)
    if (!(await w.debit(req.webChatId, price))) return bad(res, 402, 'insufficient_balance', `Renewal costs $${price.toFixed(2)}. Top up your wallet first.`)
    const lapsed = new Date(n.expiresAt || 0).getTime() <= Date.now()
    const base = new Date(Math.max(Date.now(), new Date(n.expiresAt || Date.now()).getTime()))
    base.setMonth(base.getMonth() + 1)
    // Early renewal only adds a month; the monthly allowance resets when a lapsed number starts a new cycle.
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.expiresAt': base.toISOString(), 'val.numbers.$.status': 'active', ...(lapsed ? { 'val.numbers.$.minutesUsed': 0, 'val.numbers.$.smsUsed': 0 } : {}) } })
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'renew', plan: n.plan, amount: price, paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
    await txn(req.webChatId, 'phone-renewal', price, { phoneNumber: n.phoneNumber, plan: n.plan })
    res.json({ expiresAt: base.toISOString(), balance: await w.balance(req.webChatId) })
  }))

  router.post('/numbers/:phone/upgrade', withNumber(async (req, res) => {
    const n = req.num, newPlan = String(req.body.plan || '')
    const order = Object.keys(phoneConfig.plans)
    if (!phoneConfig.plans[newPlan] || order.indexOf(newPlan) <= order.indexOf(n.plan)) return bad(res, 400, 'invalid_plan', 'Pick a higher plan than the current one.')
    const q = phoneConfig.computeUpgradeQuote(n, newPlan)
    const charge = round2(q && Number.isFinite(q.chargeAmount) ? q.chargeAmount : phoneConfig.plans[newPlan].price)
    if (req.body.confirm !== true) return res.json({ quote: { charge, credit: round2(q?.credit || 0), newPrice: phoneConfig.plans[newPlan].price } })
    if (!(await w.debit(req.webChatId, charge))) return bad(res, 402, 'insufficient_balance', `The upgrade costs $${charge.toFixed(2)}. Top up your wallet first.`)
    const newPrice = phoneConfig.plans[newPlan].price
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.plan': newPlan, 'val.numbers.$.planPrice': newPrice, 'val.numbers.$.sipDisabled': false } })
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'upgrade', oldPlan: n.plan, newPlan, oldPrice: n.planPrice, newPrice, amount: charge.toFixed(2), credit: round2(q?.credit || 0).toFixed(2), paymentMethod: 'wallet_usd', channel: 'web', timestamp: new Date().toISOString() })
    await txn(req.webChatId, 'phone-upgrade', charge, { phoneNumber: n.phoneNumber, plan: newPlan })
    res.json({ plan: newPlan, charged: charge, balance: await w.balance(req.webChatId) })
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

  return { myNumbers, findMine, purchase, pickFromSearch, searchSimilar }
}

module.exports = { routes, catalog, publicNumber, validateIvr, normPhone, countries, E164 }
