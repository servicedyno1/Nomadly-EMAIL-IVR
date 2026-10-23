'use strict'
// Bot features brought to the web: extra numbers on a plan, downgrade, test calls, fax delivery, inbound IVR
// templates, daily coupons (+ in-app notice) and the campaign CSV report.
const fs = require('fs')
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const ivrTpl = require('../ivr-templates')
const notify = require('./notify')
const { publicNumber, webFeatures, validateIvr } = require('./numbers')
const { round2 } = require('./wallet')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const BIZ_TEMPLATES = ['biz_sales_support', 'biz_main_menu', 'biz_billing', 'biz_after_hours', 'biz_solo']
const MAX_TEMPLATES = 20
const html = (s) => notify.strip(s)
const today = () => new Date().toISOString().slice(0, 10)

function routes(router, { db, h, numbersApi, bulkCallService, getTodayCoupons, placeTestMyNumberCall, startTestOutboundSip, notifyAdmin = () => {}, log = console.log }) {
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  const phoneTransactions = db.collection('phoneTransactions')
  const prefs = db.collection('webPrefs')
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const withNumber = (fn) => h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    req.num = num
    return fn(req, res)
  })
  const subsOf = async (chatId, phone) => (await numbersApi.myNumbers(chatId)).filter(n => n.isSubNumber && n.parentNumber === phone)

  // ── Extra numbers on a plan (the bot's sub-numbers): flat price, share the main number's plan ──
  router.get('/numbers/:phone/extra', withNumber(async (req, res) => {
    const n = req.num
    const list = n.isSubNumber ? [] : await subsOf(req.webChatId, n.phoneNumber)
    res.json({ allowed: !n.isSubNumber, limit: phoneConfig.getSubNumberLimit(n.plan), used: list.length, price: phoneConfig.SUB_NUMBER_BASE_PRICE, numbers: list.map(publicNumber) })
  }))
  router.post('/numbers/:phone/extra', withNumber(async (req, res) => {
    const n = req.num, chatId = req.webChatId
    if (n.isSubNumber) return bad(res, 400, 'is_extra', 'This is already an extra number. Add extras from its main number.')
    if (n.status !== 'active') return bad(res, 400, 'not_active', 'The main number must be active to add extra numbers.')
    const limit = phoneConfig.getSubNumberLimit(n.plan)
    if ((await subsOf(chatId, n.phoneNumber)).length >= limit) return bad(res, 400, 'limit_reached', `The ${phoneConfig.plans[n.plan]?.name || n.plan} plan allows ${limit} extra numbers. Upgrade the main number to add more.`)
    const picked = await numbersApi.pickFromSearch(chatId, req.body.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    let coupon = null
    if (req.body.coupon) {
      coupon = await numbersApi.checkCoupon(chatId, req.body.coupon)
      if (coupon.error) return bad(res, 400, 'invalid_coupon', coupon.message)
    }
    const r = await numbersApi.purchase({ chatId, email: req.webUser.email, phone: picked.hit.phoneNumber, planKey: n.plan, autoRenew: req.body.autoRenew !== false, coupon, sub: { parentNumber: n.phoneNumber, plan: n.plan }, ...picked })
    res.status(r.status).json(r.body)
  }))

  // ── Downgrade: switch now, no refund; features the new plan lacks are turned off (same as the bot) ──
  router.post('/numbers/:phone/downgrade', withNumber(async (req, res) => {
    const n = req.num, newPlan = String(req.body.plan || '')
    const order = Object.keys(phoneConfig.plans)
    if (n.isSubNumber) return bad(res, 400, 'is_extra', 'Extra numbers follow the plan of their main number.')
    if (!phoneConfig.plans[newPlan] || !phoneConfig.isPlanAvailable(newPlan) || order.indexOf(newPlan) >= order.indexOf(n.plan)) return bad(res, 400, 'invalid_plan', 'Pick a lower plan than the current one.')
    const cur = phoneConfig.plans[n.plan], next = phoneConfig.plans[newPlan]
    const surcharge = Math.max(0, round2((n.planPrice || cur.price) - cur.price))
    const newPrice = round2(next.price + surcharge)
    const was = new Set(webFeatures(n.plan).filter(f => f.included).map(f => f.key))
    const lost = webFeatures(newPlan).filter(f => !f.included && was.has(f.key)).map(f => f.label)
    const extras = (await subsOf(req.webChatId, n.phoneNumber)).length
    const preview = { plan: newPlan, planName: next.name, newPrice, lost, minutes: [cur.minutes, next.minutes], sms: [cur.sms, next.sms], extras, extraLimit: phoneConfig.getSubNumberLimit(newPlan) }
    if (req.body.confirm !== true) return res.json({ preview })
    const can = (k) => phoneConfig.canAccessFeature(newPlan, k)
    const f = n.features || {}
    const set = { 'val.numbers.$.plan': newPlan, 'val.numbers.$.planPrice': newPrice }
    if (!can('sipCredentials')) set['val.numbers.$.sipDisabled'] = true
    // Settings switched off are remembered so a later upgrade can switch them back on.
    const saved = [...(n.downgradeSaved || [])]
    const off = (key, path, cur, val) => {
      if (can(key) || cur === undefined || cur === null || cur === val) return
      set[`val.numbers.$.${path}`] = val
      if (!saved.some(x => x.path === path)) saved.push({ key, path, value: cur })
    }
    off('ivr', 'features.ivr.enabled', f.ivr?.enabled, false)
    off('callRecording', 'features.recording', f.recording, false)
    off('voicemail', 'features.voicemail.enabled', f.voicemail?.enabled, false)
    off('smsToEmail', 'features.smsForwarding.toEmail', f.smsForwarding?.toEmail, null)
    off('smsWebhook', 'features.smsForwarding.webhookUrl', f.smsForwarding?.webhookUrl, null)
    set['val.numbers.$.downgradeSaved'] = saved
    await phoneNumbersOf.updateOne({ _id: req.webChatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: set })
    await syncExtras(req.webChatId, n.phoneNumber, newPlan)
    await phoneTransactions.insertOne({ chatId: req.webChatId, phoneNumber: n.phoneNumber, action: 'downgrade', oldPlan: n.plan, newPlan, oldPrice: n.planPrice, newPrice, amount: 0, paymentMethod: 'none', channel: 'web', timestamp: new Date().toISOString() })
    notifyAdmin(`🌐 CloudIVR web: ${n.phoneNumber} downgraded ${cur.name} → ${next.name} by web account ${req.webChatId}`)
    res.json({ plan: newPlan, planName: next.name, planPrice: newPrice, turnedOff: lost })
  }))
  // Extra numbers always carry their main number's plan.
  const syncExtras = (chatId, parent, plan) => phoneNumbersOf.updateOne(
    { _id: chatId }, { $set: { 'val.numbers.$[s].plan': plan } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': parent }] },
  ).catch(e => log(`[CloudIVR-Web] extra-number plan sync failed: ${e.message}`))

  // ── Test my number (we call it) · Test outbound SIP (90 s window). Results arrive in the Inbox. ──
  router.post('/numbers/:phone/test-call', withNumber(async (req, res) => {
    if (req.num.status !== 'active') return bad(res, 400, 'not_active', 'Only active numbers can be tested.')
    if (dryRun() || req.num.dryRun) return res.status(202).json({ dryRun: true, message: `Preview mode: we would call ${req.num.phoneNumber} from our test line. Pick up and press 1 — the result lands in your Inbox.` })
    const r = await placeTestMyNumberCall(req.webChatId, req.num, 'en')
    if (!r?.ok) return bad(res, 400, 'test_failed', html(r?.message || 'The test call could not be placed.'))
    res.status(201).json({ started: true, message: 'Calling your number now — pick up and press 1. The result lands in your Inbox within a minute.' })
  }))
  router.post('/numbers/:phone/test-sip', withNumber(async (req, res) => {
    if (!phoneConfig.canAccessFeature(req.num.plan, 'sipCredentials')) return bad(res, 403, 'plan_upgrade_required', 'SIP needs the Pro plan or higher.')
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
  // Once a day every web account gets today's code in its Inbox (one process sends it: unique marker per day).
  const notices = db.collection('webCouponNotices')
  notices.createIndex({ at: 1 }, { expireAfterSeconds: 3 * 86400 }).catch(() => {})
  async function announceCoupon() {
    const c = await todaysCoupon()
    if (!c) return
    // One marker per account per day, so accounts created later in the day get the notice on the next run.
    const day = today()
    const accounts = await db.collection('webAccounts').find({}, { projection: { _id: 1 } }).toArray()
    let sent = 0
    for (const a of accounts) {
      const id = String(a._id)
      if (c.usedBy.includes(id)) continue
      try { await notices.insertOne({ _id: `daily:${day}:${id}`, code: c.code, at: new Date() }) } catch (e) { if (e.code === 11000) continue; throw e }
      await notify.push(id, `Today's coupon: ${c.code} — ${c.discount}% off a new number or extra number. Use it at checkout before midnight UTC.`, null, { kind: 'coupon', meta: { coupon: c.code, discount: c.discount } }).catch(() => {})
      sent++
    }
    if (sent) log(`[CloudIVR-Web] daily coupon ${c.code} sent to ${sent} web account(s)`)
  }
  const timer = setInterval(() => { announceCoupon().catch(e => log(`[CloudIVR-Web] coupon notice: ${e.message}`)) }, 5 * 60000)
  if (timer.unref) timer.unref()
  setTimeout(() => announceCoupon().catch(() => {}), 20000).unref?.()

  // ── Campaign CSV report (same file the bot sends at the end) ──
  router.get('/campaigns/:id/report.csv', h(async (req, res) => {
    const c = await bulkCallService.getCampaign(String(req.params.id))
    if (!c || c.chatId !== String(req.webChatId)) return bad(res, 404, 'not_found', 'Campaign not found.')
    const file = await bulkCallService.generateReportFile(c)
    res.download(file, `campaign-${String(c.id).slice(0, 8)}.csv`, () => fs.unlink(file, () => {}))
  }))

  return { announceCoupon }
}

module.exports = { routes }
