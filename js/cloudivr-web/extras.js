'use strict'
// Bot features brought to the web: extra numbers on a plan, downgrade, test calls, fax delivery, inbound IVR
// templates, daily coupons (+ in-app notice) and the campaign CSV report.
const fs = require('fs')
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const lifecycle = require('../plan-lifecycle')
const ivrTpl = require('../ivr-templates')
const vmGreeting = require('../voicemail-greeting')
const notify = require('./notify')
const { publicNumber, webFeatures, validateIvr } = require('./numbers')
const { round2 } = require('./wallet')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const BIZ_TEMPLATES = ['biz_sales_support', 'biz_main_menu', 'biz_billing', 'biz_after_hours', 'biz_solo']
const MAX_TEMPLATES = 20
const html = (s) => notify.strip(s)
const today = () => new Date().toISOString().slice(0, 10)

// Numbers asked for in one extra-number order: `phoneNumbers` (several) or `phoneNumber` (one), de-duplicated.
const extraPicks = (body) => [...new Set((Array.isArray(body?.phoneNumbers) ? body.phoneNumbers : [body?.phoneNumber]).filter(Boolean).map(String))].slice(0, 100)
const extraSummary = (parent, added, failed) => [
  added.length ? `${added.length} extra number${added.length === 1 ? '' : 's'} added to ${parent}: ${added.join(', ')}.` : 'None of the extra numbers could be added.',
  failed.length ? `Not added (nothing charged for ${failed.length === 1 ? 'it' : 'them'} — the money stays in your wallet): ${failed.map(f => `${f.phoneNumber} (${f.message})`).join('; ')}` : '',
].filter(Boolean).join(' ')

function routes(router, { db, h, numbersApi, offers = null, bulkCallService, getTodayCoupons, placeTestMyNumberCall, startTestOutboundSip, notifyAdmin = () => {}, log = console.log }) {
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  const phoneTransactions = db.collection('phoneTransactions')
  const prefs = db.collection('webPrefs')
  const bad = (res, status, error, message, extra) => res.status(status).json({ error, message, ...extra })
  const wallet = require('./wallet').walletOps(db)
  const locks = db.collection('webNumberLocks')
  const withNumber = (fn) => h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    req.num = num
    return fn(req, res)
  })
  const subsOf = async (chatId, phone) => (await numbersApi.myNumbers(chatId)).filter(n => n.isSubNumber && n.parentNumber === phone)

  // ── Extra numbers on a plan (the bot's sub-numbers): flat price, share the main number's plan ──
  const limitJson = (plan) => { const l = phoneConfig.getSubNumberLimit(plan); return Number.isFinite(l) ? l : null }
  router.get('/numbers/:phone/extra', withNumber(async (req, res) => {
    const n = req.num
    const list = n.isSubNumber ? [] : await subsOf(req.webChatId, n.phoneNumber)
    const group = [n, ...list]
    const left = phoneConfig.subSlotsLeft(n.plan, list.length)
    const all = await numbersApi.myNumbers(req.webChatId)
    const renewal = n.isSubNumber ? null : lifecycle.groupRenewal(all, n)
    const renewsOn = !n.isSubNumber && n.status === 'active' && new Date(n.expiresAt) > new Date() ? n.expiresAt : null
    res.json({ allowed: !n.isSubNumber, limit: limitJson(n.plan), unlimited: !Number.isFinite(left), used: list.length, left: Number.isFinite(left) ? left : null, price: phoneConfig.SUB_NUMBER_BASE_PRICE,
      renewsOn, prorate: renewsOn ? lifecycle.prorateRatio(renewsOn) : 1, renewal, numbers: list.map(x => ({ ...publicNumber(x, group), renewalPrice: lifecycle.renewalPrice(x), onPlanDate: lifecycle.sameDate(x.expiresAt, n.expiresAt) })) })
  }))
  // One or several picked numbers (`phoneNumbers`) join the plan in one payment from the wallet.
  router.post('/numbers/:phone/extra', withNumber(async (req, res) => {
    const n = req.num, chatId = req.webChatId
    if (n.isSubNumber) return bad(res, 400, 'is_extra', 'This is already an extra number. Add extras from its main number.')
    if (n.replacedBy) return bad(res, 409, 'replaced', `This number was replaced by ${n.replacedBy}. Add extra numbers there.`)
    if (n.status !== 'active') return bad(res, 400, 'not_active', 'The main number must be active to add extra numbers.')
    const phones = extraPicks(req.body)
    if (!phones.length) return bad(res, 400, 'pick_number', 'Pick at least one number.')
    const left = phoneConfig.subSlotsLeft(n.plan, (await subsOf(chatId, n.phoneNumber)).length)
    const planName = phoneConfig.plans[n.plan]?.name || n.plan
    if (!left) return bad(res, 400, 'limit_reached', `The ${planName} plan allows ${phoneConfig.getSubNumberLimit(n.plan)} extra numbers. Upgrade the main number to add more.`)
    if (phones.length > left) return bad(res, 400, 'too_many', `The ${planName} plan has room for ${left} more extra number${left === 1 ? '' : 's'}. Untick ${phones.length - left} and try again.`)
    const picks = await numbersApi.pickManyFromSearch(chatId, phones)
    if (!picks) return bad(res, 400, 'search_again', 'A number you picked is no longer in your search results. Search again and pick your numbers.')
    let coupon = null
    if (req.body.coupon) {
      coupon = await numbersApi.checkCoupon(chatId, req.body.coupon)
      if (coupon.error) return bad(res, 400, 'invalid_coupon', coupon.message)
    }
    const sub = { parentNumber: n.phoneNumber, plan: n.plan }
    let redeemed = false
    const buyOne = async (p) => {
      const r = await numbersApi.purchase({ chatId, email: req.webUser.email, phone: p.hit.phoneNumber, planKey: n.plan, autoRenew: req.body.autoRenew !== false, coupon, skipRedeem: redeemed, sub, planLocked: picks.length > 1, ...p })
      if (r.status === 201 || r.status === 202) redeemed = true
      return r
    }
    if (picks.length === 1) { const r = await buyOne(picks[0]); return res.status(r.status).json(r.body) }
    const ratio = new Date(n.expiresAt) > new Date() ? lifecycle.prorateRatio(n.expiresAt) : 1
    const each = (p) => round2(Math.max(0.5, numbersApi.extraPriceOf(p.country, p.type) * ratio) * (1 - (coupon ? coupon.discount : 0) / 100))
    const total = round2(picks.reduce((t, p) => t + each(p), 0))
    const bal = await wallet.balance(chatId)
    if (bal < total) return bad(res, 402, 'insufficient_balance', `These ${picks.length} numbers come to $${total.toFixed(2)}. Your wallet has $${bal.toFixed(2)}.`, { cost: total, balance: round2(bal), need: round2(total - bal) })
    // One multi-number order per plan at a time, and the free slots are re-checked before every number.
    const lockId = `extras:${chatId}:${n.phoneNumber}`
    try { await locks.insertOne({ _id: lockId, at: new Date() }) } catch (e) {
      if (e.code === 11000) return bad(res, 409, 'busy', 'Extra numbers are already being added to this plan. Wait a moment and check the plan again.')
      throw e
    }
    const added = [], failed = []
    try {
      for (const p of picks) {
        if (!phoneConfig.subSlotsLeft(n.plan, (await subsOf(chatId, n.phoneNumber)).length)) { failed.push({ phoneNumber: p.hit.phoneNumber, message: 'the plan has no free extra-number slot left' }); continue }
        const r = await buyOne(p)
        if (r.status === 201 || r.status === 202) added.push(r.body.number?.phoneNumber || p.hit.phoneNumber)
        else failed.push({ phoneNumber: p.hit.phoneNumber, message: r.body.message })
      }
    } finally { await locks.deleteOne({ _id: lockId }).catch(() => {}) }
    const balance = await wallet.balance(chatId)
    const message = extraSummary(n.phoneNumber, added, failed)
    if (!added.length) return res.status(409).json({ error: 'none_added', message, added, failed, balance })
    if (failed.length) notify.push(chatId, message).catch(() => {})
    res.status(201).json({ added, failed, balance, message })
  }))

  // Delete one extra number now: released with the carrier, no refund, its slot frees at once.
  router.delete('/numbers/:phone/extra-line', withNumber(async (req, res) => {
    const n = req.num
    if (!n.isSubNumber) return bad(res, 400, 'not_extra', 'Only extra numbers can be deleted here.')
    if (req.body?.confirm !== n.phoneNumber) return bad(res, 400, 'confirm', `Type ${n.phoneNumber} to confirm.`)
    if (!dryRun() && !n.dryRun) {
      const acct = (await phoneNumbersOf.findOne({ _id: req.webChatId }))?.val
      await require('../phone-scheduler').releaseFromProvider(n, acct, req.webChatId).catch(e => log(`[CloudIVR-Web] release ${n.phoneNumber}: ${e.message}`))
    }
    const now = new Date().toISOString()
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers': { $elemMatch: { phoneNumber: n.phoneNumber, status: { $ne: 'released' } } } }, { $set: { 'val.numbers.$.status': 'released', 'val.numbers.$.releasedAt': now, 'val.numbers.$._releasedReason': 'deleted_by_owner', 'val.numbers.$.autoRenew': false } })
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'delete_extra', parentNumber: n.parentNumber, amount: 0, channel: 'web', timestamp: now })
    notifyAdmin(`🗑️ CloudIVR web: extra number ${n.phoneNumber} (on ${n.parentNumber}) deleted by web account ${req.webChatId}`)
    res.json({ deleted: n.phoneNumber, parentNumber: n.parentNumber })
  }))

  // Copy forwarding / keypad menu / voicemail from one number to others on the account in one go.
  const COPY_PARTS = { forwarding: 'callForwarding', ivr: 'ivr', voicemail: 'voicemail' }
  router.post('/numbers/:phone/copy-settings', withNumber(async (req, res) => {
    const src = req.num
    const parts = [...new Set((Array.isArray(req.body?.parts) ? req.body.parts : []).filter(p => COPY_PARTS[p]))]
    if (!parts.length) return bad(res, 400, 'pick_parts', 'Pick at least one setting to copy.')
    const mine = await numbersApi.myNumbers(req.webChatId)
    const targets = [...new Set(Array.isArray(req.body?.to) ? req.body.to.map(String) : [])].map(p => mine.find(x => x.phoneNumber === p)).filter(x => x && x.phoneNumber !== src.phoneNumber)
    if (!targets.length) return bad(res, 400, 'pick_numbers', 'Pick at least one number to copy to.')
    const set = {}
    for (const p of parts) set[COPY_PARTS[p]] = src.features?.[COPY_PARTS[p]] ?? null
    const done = [], skipped = []
    for (const t of targets) {
      const ok = parts.filter(p => p !== 'ivr' || phoneConfig.canAccessFeature(t.plan, 'ivr'))
      if (!ok.length) { skipped.push({ phoneNumber: t.phoneNumber, message: 'its plan has none of these features' }); continue }
      await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers': { $elemMatch: { phoneNumber: t.phoneNumber, status: { $ne: 'released' } } } }, { $set: Object.fromEntries(ok.map(p => [`val.numbers.$.features.${COPY_PARTS[p]}`, set[COPY_PARTS[p]]])) })
      done.push(t.phoneNumber)
    }
    res.json({ copied: parts, to: done, skipped })
  }))

  // ── Renewal calendar: every upcoming charge by date and what the wallet covers ──
  router.get('/renewals/calendar', h(async (req, res) => res.json(await require('../renewal-calendar').forAccount(db, req.webChatId))))
  // Private live calendar link for Google / Apple calendars; reset makes the old link stop working.
  router.get('/renewals/calendar/feed', h(async (req, res) => res.json(await require('../renewal-calendar').links(db, req.webChatId))))
  router.post('/renewals/calendar/feed/reset', h(async (req, res) => res.json(await require('../renewal-calendar').links(db, req.webChatId, true))))

  // ── Downgrade: switch now, no refund; features the new plan lacks are turned off (same as the bot) ──
  router.post('/numbers/:phone/downgrade', withNumber(async (req, res) => {
    const n = req.num, newPlan = String(req.body.plan || '')
    const order = Object.keys(phoneConfig.plans)
    if (n.isSubNumber) return bad(res, 400, 'is_extra', 'Extra numbers follow the plan of their main number.')
    if (n.replacedBy) return bad(res, 409, 'replaced', `This number was replaced by ${n.replacedBy}. Change the plan there.`)
    if (n.status === 'suspended' && n._holdUntil) return bad(res, 409, 'suspended', 'Restore this number first (Renew now), then change its plan.')
    if (!phoneConfig.plans[newPlan] || !phoneConfig.isPlanAvailable(newPlan) || order.indexOf(newPlan) >= order.indexOf(n.plan)) return bad(res, 400, 'invalid_plan', 'Pick a lower plan than the current one.')
    const cur = phoneConfig.plans[n.plan], next = phoneConfig.plans[newPlan]
    const surcharge = Math.max(0, round2((n.planPrice || cur.price) - cur.price))
    const newPrice = round2(next.price + surcharge)
    const was = new Set(webFeatures(n.plan).filter(f => f.included).map(f => f.key))
    const lost = webFeatures(newPlan).filter(f => !f.included && was.has(f.key)).map(f => f.label)
    const subs = await subsOf(req.webChatId, n.phoneNumber)
    // SIP apps / desk phones are signed out (new logins); the browser phone keeps working on every plan.
    const sipSignOut = phoneConfig.canAccessFeature(n.plan, 'sipCredentials') && !phoneConfig.canAccessFeature(newPlan, 'sipCredentials')
    const preview = { plan: newPlan, planName: next.name, newPrice, lost, minutes: [cur.minutes, next.minutes], sms: [cur.sms, next.sms], extras: subs.length, extraLimit: phoneConfig.getSubNumberLimit(newPlan), sipSignOut, settingsKept: true }
    if (req.body.confirm !== true) return res.json({ preview })
    // Settings switched off are remembered so a later upgrade can switch them back on. Running campaigns and
    // scheduled calls are not touched — they finish as planned.
    const { set } = lifecycle.downgradePatch(n, newPlan)
    await require('../live-number').updateLive(phoneNumbersOf, req.webChatId, n.phoneNumber, { $set: lifecycle.numberSet({ plan: newPlan, planPrice: newPrice, ...set }) })
    await syncExtras(req.webChatId, n.phoneNumber, newPlan)
    if (sipSignOut) Promise.all([n, ...subs.filter(x => x.status !== 'released')].map(x => numbersApi.rotateSip(req.webChatId, x)))
      .catch(e => log(`[CloudIVR-Web] SIP sign-out after downgrade failed for ${n.phoneNumber}: ${e.message}`))
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'downgrade', oldPlan: n.plan, newPlan, oldPrice: n.planPrice, newPrice, amount: 0, paymentMethod: 'none', channel: 'web', timestamp: new Date().toISOString() })
    notifyAdmin(`🌐 CloudIVR web: ${n.phoneNumber} downgraded ${cur.name} → ${next.name} by web account ${req.webChatId}`)
    res.json({ plan: newPlan, planName: next.name, planPrice: newPrice, turnedOff: lost })
  }))
  // Extra numbers always carry their main number's plan.
  const syncExtras = (chatId, parent, plan) => phoneNumbersOf.updateOne(
    { _id: chatId }, { $set: { 'val.numbers.$[s].plan': plan } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': parent }] },
  ).catch(e => log(`[CloudIVR-Web] extra-number plan sync failed: ${e.message}`))

  // ── Test my number (we call it) · Test outbound SIP (90 s window). Results arrive in the Inbox. ──
  // Free test ring: rings this number (SIP phone / browser phone) or, with `to`, another phone. 3 a day, max 1 minute, never billed.
  const testStatus = () => require('../test-my-number').testStatus
  router.get('/numbers/:phone/test-call', withNumber(async (req, res) => {
    const s = testStatus()(req.num.phoneNumber)
    res.json({ ...s, outcome: s.outcome ? html(s.outcome) : null })
  }))
  router.post('/numbers/:phone/test-call', withNumber(async (req, res) => {
    if (req.num.status !== 'active') return bad(res, 400, 'not_active', 'Only active numbers can be tested.')
    let to = null
    if (req.body?.to) {
      const raw = String(req.body.to).replace(/[^\d+]/g, '')
      to = require('./numbers').normPhone(raw)
      if (!/^\+[1-9]\d{7,14}$/.test(to)) return bad(res, 400, 'invalid_number', 'Enter the phone number with country code, e.g. +14155550100.')
      const issue = require('../dial-check').dialIssue(to)
      if (issue) return bad(res, 400, 'invalid_number', issue)
      if (to === req.num.phoneNumber) to = null
    }
    const where = to ? to : 'your number'
    if (dryRun() || req.num.dryRun) return res.status(202).json({ dryRun: true, to, message: `Preview mode: we would ring ${where} for free from our test line (up to 1 minute). Pick up and press 1 — the result shows here and in your Inbox.` })
    const r = await placeTestMyNumberCall(req.webChatId, req.num, 'en', { to })
    if (!r?.ok) return bad(res, 400, 'test_failed', html(r?.message || 'The test call could not be placed.'))
    res.status(201).json({ started: true, to, message: `Ringing ${where} now — pick up and press 1. The result shows here within a minute.` })
  }))
  router.post('/numbers/:phone/test-sip', withNumber(async (req, res) => {
    if (!phoneConfig.canAccessFeature(req.num.plan, 'sipCredentials')) return bad(res, 403, 'plan_upgrade_required', 'SIP isn’t included on this number’s plan.')
    if (dryRun() || req.num.dryRun) return res.status(202).json({ dryRun: true, message: 'Preview mode: within 90 seconds you would dial any number from your softphone; we would catch the call, hang it up for free and report the result in your Inbox.' })
    const r = await startTestOutboundSip(req.webChatId, req.num, 'en')
    if (!r?.ok) return bad(res, 400, 'test_failed', html(r?.message || 'The test could not start.'))
    res.status(201).json({ started: true, seconds: 90, message: 'Dial any number from your softphone within 90 seconds. We catch the call (free, it is hung up) and post the result in your Inbox.' })
  }))

  // ── Fax delivery (fax-capable numbers) ──
  router.patch('/numbers/:phone/fax', withNumber(async (req, res) => {
    if (!req.num.capabilities?.fax) return bad(res, 400, 'no_fax', 'This number cannot receive faxes.')
    const value = { ...(req.num.features?.faxForwarding || {}), toTelegram: !!req.body.toInbox }
    await numbersApi.setField(req.webChatId, req.num.phoneNumber, 'features.faxForwarding', value)
    res.json({ fax: { toInbox: value.toTelegram } })
  }))

  // ── Inbound IVR templates: built-in business menus + the account's saved menus ──
  router.get('/ivr/templates', h(async (req, res) => {
    const builtin = BIZ_TEMPLATES.map(k => ivrTpl.getTemplateByKey(k)).filter(Boolean)
      .map(t => ({ id: t.key, name: t.name, config: { greeting: t.greeting, options: JSON.parse(JSON.stringify(t.options)) } }))
    res.json({ builtin, mine: (await prefs.findOne({ _id: req.webChatId }))?.ivrTemplates || [] })
  }))
  router.post('/ivr/templates', h(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 40)
    if (!name) return bad(res, 400, 'invalid_name', 'Name the template, e.g. "Sales line".')
    const own = new Set((await numbersApi.ownAudioUrls(req.webChatId)))
    let config
    try { config = validateIvr({ ...(req.body.ivr || {}), enabled: false }, 'business', (u) => own.has(u)) } catch (e) { return bad(res, 400, 'invalid_ivr', e.message) }
    if (!Object.keys(config.options).length) return bad(res, 400, 'invalid_ivr', 'Nothing to save — add a menu option first.')
    const list = ((await prefs.findOne({ _id: req.webChatId }))?.ivrTemplates || []).filter(t => t.name.toLowerCase() !== name.toLowerCase())
    if (list.length >= MAX_TEMPLATES) return bad(res, 400, 'too_many_templates', `Up to ${MAX_TEMPLATES} saved templates — delete one first.`)
    const tpl = { id: `ut_${crypto.randomUUID().slice(0, 8)}`, name, createdAt: new Date(), config: { greeting: config.greeting, greetingAudioUrl: config.greetingAudioUrl, options: config.options } }
    await prefs.updateOne({ _id: req.webChatId }, { $set: { ivrTemplates: [tpl, ...list], updatedAt: new Date() } }, { upsert: true })
    res.status(201).json({ template: tpl })
  }))
  router.delete('/ivr/templates/:id', h(async (req, res) => {
    const list = (await prefs.findOne({ _id: req.webChatId }))?.ivrTemplates || []
    const next = list.filter(t => t.id !== String(req.params.id))
    if (next.length === list.length) return bad(res, 404, 'not_found', 'Template not found.')
    await prefs.updateOne({ _id: req.webChatId }, { $set: { ivrTemplates: next } })
    res.json({ deleted: true })
  }))

  // ── App language: spoken IVR menus follow it (greetings still on a default text switch language too) ──
  // ── Saved "wrong code" replies for the Accept / Decline pop-up (owner keeps a list; the pop-up adds to it) ──
  const DEFAULT_OTP_REPLIES = ['That code is not correct. Please check and try again.', 'That code has expired. We can send you a new one.', 'We could not verify that. Please try once more.']
  const cleanReply = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  router.get('/prefs/otp-replies', h(async (req, res) => {
    const p = await prefs.findOne({ _id: req.webChatId }, { projection: { otpReplies: 1 } })
    res.json({ replies: Array.isArray(p?.otpReplies) ? p.otpReplies : DEFAULT_OTP_REPLIES })
  }))
  router.put('/prefs/otp-replies', h(async (req, res) => {
    const list = [...new Set((Array.isArray(req.body?.replies) ? req.body.replies : []).map(cleanReply).filter(Boolean))].slice(0, 12)
    await prefs.updateOne({ _id: req.webChatId }, { $set: { otpReplies: list, updatedAt: new Date() } }, { upsert: true })
    res.json({ replies: list })
  }))


  router.put('/prefs/lang', h(async (req, res) => {
    const lang = String(req.body.lang || '')
    if (!vmGreeting.IVR_LANGS.includes(lang)) return bad(res, 400, 'invalid_lang', 'Pick English, French or Spanish.')
    const chatId = req.webChatId
    if ((await prefs.findOne({ _id: chatId }))?.lang === lang) return res.json({ lang, updated: 0 })
    await prefs.updateOne({ _id: chatId }, { $set: { lang, updatedAt: new Date() } }, { upsert: true })
    let updated = 0
    for (const n of await numbersApi.myNumbers(chatId)) {
      if (!n.features?.ivr || n.features.ivr.language === lang) continue
      await numbersApi.setField(chatId, n.phoneNumber, 'features.ivr', vmGreeting.relocalizeIvr(n.features.ivr, lang))
      updated++
    }
    res.json({ lang, updated })
  }))

  // ── Texting: sender name for brand-name countries + where each number can text ──
  const SR = require('../sms-rules.js')
  const senderOf = async (chatId) => (await prefs.findOne({ _id: chatId }, { projection: { senderName: 1 } }))?.senderName || null
  const ownSender = async (chatId, phone) => {
    const mineNum = await numbersApi.findMine(chatId, phone)
    if (mineNum) return { hosted: false, num: mineNum }
    const h = (await require('../hosted-sms.js').list(chatId)).find(x => x.phoneNumber === phone && x.status === 'active')
    return h ? { hosted: true } : null
  }
  router.get('/prefs/sender-name', h(async (req, res) => res.json({ senderName: await senderOf(req.webChatId) })))
  router.put('/prefs/sender-name', h(async (req, res) => {
    const v = String(req.body.senderName || '').trim()
    if (v && !/^(?=.*[A-Za-z])[A-Za-z0-9 ]{3,11}$/.test(v)) return bad(res, 400, 'invalid_sender', 'Use 3–11 letters or numbers (spaces allowed), with at least one letter.')
    await prefs.updateOne({ _id: req.webChatId }, { $set: { senderName: v || null, updatedAt: new Date() } }, { upsert: true })
    res.json({ senderName: v || null })
  }))
  router.get('/sms-reach', h(async (req, res) => {
    const phone = String(req.query.phone || '')
    const own = await ownSender(req.webChatId, phone)
    if (!own) return bad(res, 404, 'not_found', 'Number not found.')
    res.json(await SR.reach(phone, await senderOf(req.webChatId), own.hosted, own.num ? await SR.ownFacts(db, req.webChatId, own.num) : {}))
  }))
  router.post('/sms-reach/check', h(async (req, res) => {
    const phone = String(req.body.phone || '')
    const own = await ownSender(req.webChatId, phone)
    if (!own) return bad(res, 404, 'not_found', 'Number not found.')
    res.json(await SR.check(phone, String(req.body.to || '').replace(/[^\d+]/g, ''), await senderOf(req.webChatId), own.hosted, own.num ? await SR.ownFacts(db, req.webChatId, own.num) : {}))
  }))

  // ── Daily coupon (same codes as the bot) ──
  const todaysCoupon = async () => {
    const codes = getTodayCoupons ? await getTodayCoupons().catch(() => ({})) : {}
    const [code, c] = Object.entries(codes || {})[0] || []
    return code ? { code, discount: Number(c.discount) || 0, usedBy: (c.usedBy || []).map(String) } : null
  }
  router.get('/coupons/today', h(async (req, res) => {
    const c = await todaysCoupon()
    if (!c) return res.json({ coupon: null })
    const end = new Date(); end.setUTCHours(23, 59, 59, 0)
    res.json({ coupon: { code: c.code, discount: c.discount, used: c.usedBy.includes(String(req.webChatId)), expiresAt: end } })
  }))
  // Once a day every web account gets its own offer in its Inbox (one marker per account per day, so accounts created
  // later in the day get it on the next run). Top-up bonuses are paid by the same timer once deposits confirm.
  const notices = db.collection('webCouponNotices')
  notices.createIndex({ at: 1 }, { expireAfterSeconds: 3 * 86400 }).catch(() => {})
  async function announceCoupon() {
    if (!offers) return
    const day = today()
    const accounts = await db.collection('webAccounts').find({}, { projection: { _id: 1 } }).toArray()
    let sent = 0
    for (const a of accounts) {
      const id = String(a._id)
      if (await notices.findOne({ _id: `offer:${day}:${id}` }, { projection: { _id: 1 } })) continue
      const o = await offers.current(id)
      try { await notices.insertOne({ _id: `offer:${day}:${id}`, offer: o._id, at: new Date() }) } catch (e) { if (e.code === 11000) continue; throw e }
      if (o.used) continue
      const p = offers.present(o)
      await notify.push(id, `Today's offer: ${p.title}. ${p.text} Ends at midnight UTC.`, null, { kind: 'coupon', meta: { ...(o.code ? { coupon: o.code } : {}), discount: o.discount || null, offer: o.kind, cta: p.cta } }).catch(() => {})
      sent++
    }
    if (sent) log(`[CloudIVR-Web] daily offer sent to ${sent} web account(s)`)
  }
  const tick = () => {
    announceCoupon().catch(e => log(`[CloudIVR-Web] offer notice: ${e.message}`))
    offers?.payBonuses((id, text) => notify.push(id, text, null, { kind: 'coupon', meta: { offer: 'bonus', used: true } })).catch(e => log(`[CloudIVR-Web] top-up bonus: ${e.message}`))
  }
  const timer = setInterval(tick, 60000)
  if (timer.unref) timer.unref()
  setTimeout(tick, 20000).unref?.()

  // ── Campaign CSV report (same file the bot sends at the end) ──
  router.get('/campaigns/:id/report.csv', h(async (req, res) => {
    const c = await bulkCallService.getCampaign(String(req.params.id))
    if (!c || c.chatId !== String(req.webChatId)) return bad(res, 404, 'not_found', 'Campaign not found.')
    const file = await bulkCallService.generateReportFile(c)
    res.download(file, `campaign-${String(c.id).slice(0, 8)}.csv`, () => fs.unlink(file, () => {}))
  }))

  return { announceCoupon }
}

module.exports = { extraPicks, extraSummary, routes }
