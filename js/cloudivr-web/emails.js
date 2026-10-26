'use strict'
// CloudIVR web emails. Every minute a scanner turns new records into emails — sign-ups (welcome), wallet top-ups,
// number purchases / renewals / upgrades, finished campaigns, voicemails and missed calls — and every 5 minutes it checks
// number renewals (3-day reminder, failed renewal, paused) and wallet levels (low / empty). Monday 08:00 UTC: weekly
// summary. Each email has one key in webEmailLog (_id), so it goes out once across restarts and app instances.
// Preview (WEB_CLOUDIVR_DRY_RUN=true) records the email + HTML instead of sending, unless WEB_EMAILS_LIVE=true.
const crypto = require('crypto')
const schedule = require('node-schedule')
const { isWebChatId } = require('./notify')
const { secret, sendMail, isAdmin } = require('./auth')
const { appPathPrefix, parseDomain } = require('./domain-guard')
const { walletOps, round2 } = require('./wallet')
const { supportLink } = require('./support')
const T = require('./email-templates')

const GROUPS = { weekly: 'weekly', campaignDone: 'campaigns', voicemail: 'voicemail', missed: 'missed' }
const OPTIONAL = Object.values(GROUPS)
const DEFAULTS = { weekly: true, campaigns: true, voicemail: true, missed: true, lowBalanceAt: 10 }
const LANGS = ['en', 'fr', 'es']
const EMPTY_AT = 0.5
const RANK = { ok: 0, low: 1, empty: 2 }
const DAY = 86400000
const LOOKBACK = 6 * 3600000
const PTX = { purchase: 'numberLive', purchase_sub: 'numberLive', renew: 'renewed', restore: 'renewed', auto_renew: 'renewed', upgrade: 'upgraded' }
const NOT_CALLS = new Set(['sms', 'sms_out', 'fax', 'connection_fee', 'overage_charge', 'sip_per_minute', 'twilio_bridge_per_minute', 'twilio_per_minute_overage', 'call_recording', 'ivr_transfer_leg'])
const OUT = new Set(['outbound_ivr', 'outbound_ivr_bulk', 'outbound_sip', 'outbound_call'])
const PLAN_RANK = { starter: 1, pro: 2, business: 3 }
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const live = () => !dryRun() || process.env.WEB_EMAILS_LIVE === 'true'
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const firstName = (s) => String(s || '').trim().split(/\s+/)[0].slice(0, 40)

function site() {
  const b = String(process.env.WEB_APP_URL || '').replace(/\/+$/, '')
  if (b) return b
  const d = parseDomain(process.env.CLOUDIVR_WEB_DOMAIN)
  return d ? `https://${d}` : ''
}
const appUrl = (path) => `${site()}${appPathPrefix(site())}${path}`
const sig = (chatId, group) => crypto.createHmac('sha256', secret()).update(`email-off:${chatId}:${group}`).digest('hex').slice(0, 32)
const offUrl = (chatId, group) => `${site()}/api/cloudivr-web/public/email/off?u=${chatId}&g=${group}&t=${sig(chatId, group)}`
const sigOk = (u, g, t) => {
  if (!/^\d{16}$/.test(u) || !OPTIONAL.includes(g)) return false
  const a = Buffer.from(String(t)), b = Buffer.from(sig(u, g))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function createEmails(db, { log = console.log } = {}) {
  const accounts = db.collection('webAccounts'), prefs = db.collection('webPrefs'), sent = db.collection('webEmailLog'), meta = db.collection('webEmailState')
  sent.createIndex({ chatId: 1, at: -1 }).catch(() => {})
  sent.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 86400 }).catch(() => {})
  const w = walletOps(db)

  async function profile(chatId) {
    const [acc, p] = await Promise.all([accounts.findOne({ _id: Number(chatId) }), prefs.findOne({ _id: String(chatId) })])
    return { acc, lang: LANGS.includes(p?.lang) ? p.lang : 'en', email: { ...DEFAULTS, ...(p?.emailPrefs || {}) } }
  }

  function build(type, data, pr) {
    const chatId = String(pr.acc._id), group = GROUPS[type]
    return T.render(type, data, { lang: pr.lang, name: firstName(pr.acc.name), email: pr.acc.email, base: site(), app: appUrl, group, offUrl: group ? offUrl(chatId, group) : null, supportUrl: supportLink() || null })
  }

  // Sends one email for `key` (never twice). `force` = a test email (ignores the on/off switches). → true when sent/recorded.
  async function send(chatId, type, data, key, { force = false } = {}) {
    const pr = await profile(chatId)
    if (!pr.acc?.email || pr.acc.disabled) return false
    const group = GROUPS[type]
    if (!force && group && pr.email[group] === false) return false
    if (!force && type === 'voicemail' && String(data.forwardedTo || '').toLowerCase() === pr.acc.email.toLowerCase()) return false // already gets the MP3 email
    try { await sent.insertOne({ _id: key, chatId: String(chatId), type, at: new Date() }) } catch (e) { if (e.code === 11000) return false; throw e }
    const { subject, html } = build(type, data, pr)
    let ok = 'preview'
    if (live()) {
      const extra = group ? { headers: { 'List-Unsubscribe': `<${offUrl(String(chatId), group)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : undefined
      ok = await sendMail(pr.acc.email, subject, html, undefined, extra).catch(e => { log(`[CloudIVR-Email] ${type} → ${chatId} failed: ${e.message}`); return false })
    }
    await sent.updateOne({ _id: key }, { $set: { to: pr.acc.email, subject, lang: pr.lang, ok, ...(live() ? {} : { html }) } })
    return true
  }

  // Web accounts' numbers: byChat chatId → { createdAt, numbers }, byPhone phone → { chatId, num }.
  async function webNumbers() {
    const accs = await accounts.find({ disabled: { $ne: true } }, { projection: { _id: 1, createdAt: 1 } }).toArray()
    const docs = await db.collection('phoneNumbersOf').find({ _id: { $in: accs.map(a => String(a._id)) } }).toArray()
    const created = new Map(accs.map(a => [String(a._id), a.createdAt]))
    const byChat = new Map(), byPhone = new Map()
    for (const d of docs) {
      const numbers = (d.val?.numbers || []).filter(n => n.status !== 'released')
      byChat.set(String(d._id), { createdAt: created.get(String(d._id)), numbers })
      for (const n of numbers) byPhone.set(n.phoneNumber, { chatId: String(d._id), num: n })
    }
    return { byChat, byPhone }
  }

  let since = null
  async function cursor() {
    if (!since) {
      const r = await meta.findOneAndUpdate({ _id: 'scanner' }, { $setOnInsert: { since: new Date() } }, { upsert: true, returnDocument: 'after' })
      since = new Date((r && r.value !== undefined ? r.value : r).since)
    }
    return new Date(Math.max(since.getTime(), Date.now() - LOOKBACK))
  }

  function ptxData(t, nums) {
    const n = nums.byPhone.get(t.phoneNumber)?.num || {}
    const phone = t.phoneNumber, plan = n.plan || t.plan
    if (t.action === 'upgrade') return async () => ({ phone, from: t.oldPlan, to: t.newPlan, fromName: T.planName(t.oldPlan), toName: T.planName(t.newPlan), amount: Number(t.amount) || 0 })
    if (PTX[t.action] === 'numberLive') return async () => ({ phone, plan, planName: T.planName(plan), country: n.countryName || null, expiresAt: n.expiresAt || null, price: Number(n.planPrice ?? t.amount) || 0 })
    return async () => ({ phone, plan, planName: T.planName(plan), amount: Number(t.amount) || 0, expiresAt: n.expiresAt || null, balance: await w.balance(t.chatId), restore: t.action === 'restore' })
  }

  async function campaignData(id) {
    const c = await db.collection('bulkCallCampaigns').findOne({ id })
    const s = c.stats || {}
    return {
      id, name: c.name || c.agentName || c.audioName || 'Campaign', callerId: c.callerId, cancelled: c.status === 'cancelled', mode: c.mode,
      duration: c.startedAt && c.completedAt ? Math.round((new Date(c.completedAt) - new Date(c.startedAt)) / 1000) : 0,
      stats: s, rate: s.total ? Math.round(((s.answered || 0) / s.total) * 100) : 0, notDialed: (c.leads || []).filter(l => l.notCalled).length,
    }
  }

  // New records since the last look → jobs { chatId, type, key, data() } (missed calls: { items } grouped per number).
  async function events(from, nums) {
    const iso = from.toISOString(), jobs = []
    for (const a of await accounts.find({ createdAt: { $gte: from } }, { projection: { _id: 1 } }).toArray()) {
      jobs.push({ chatId: String(a._id), type: 'welcome', key: `welcome:${a._id}`, data: async () => ({}) })
    }
    for (const t of await db.collection('transactions').find({ type: 'wallet-topup', createdAt: { $gte: from } }, { projection: { chatId: 1, amount: 1 } }).toArray()) {
      if (isWebChatId(t.chatId)) jobs.push({ chatId: String(t.chatId), type: 'topup', key: `topup:${t._id}`, data: async () => ({ amount: Number(t.amount) || 0, balance: await w.balance(t.chatId) }) })
    }
    for (const t of await db.collection('phoneTransactions').find({ timestamp: { $gte: iso }, action: { $in: Object.keys(PTX) } }).toArray()) {
      if (isWebChatId(t.chatId)) jobs.push({ chatId: String(t.chatId), type: PTX[t.action], key: `ptx:${t._id}`, data: ptxData(t, nums) })
    }
    const camps = await db.collection('bulkCallCampaigns').find({ completedAt: { $gte: from }, status: { $in: ['completed', 'cancelled'] }, startedAt: { $ne: null }, reportPending: { $ne: true } }, { projection: { id: 1, chatId: 1 } }).toArray()
    for (const c of camps) if (isWebChatId(c.chatId)) jobs.push({ chatId: String(c.chatId), type: 'campaignDone', key: `campaign:${c.id}`, data: () => campaignData(c.id) })
    const logs = await db.collection('phoneLogs').find({ timestamp: { $gte: iso }, type: { $in: ['voicemail', 'missed'] } }, { projection: { phoneNumber: 1, from: 1, type: 1, duration: 1, transcript: 1, timestamp: 1 } }).toArray()
    const missed = new Map()
    for (const l of logs) {
      const own = nums.byPhone.get(l.phoneNumber)
      if (!own) continue
      if (l.type === 'voicemail') {
        jobs.push({ chatId: own.chatId, type: 'voicemail', key: `vm:${l._id}`, data: async () => ({ from: l.from, to: l.phoneNumber, duration: l.duration || 0, transcript: l.transcript || null, forwardedTo: own.num.features?.voicemail?.forwardToEmail || null }) })
      } else {
        if (!missed.has(l.phoneNumber)) missed.set(l.phoneNumber, { chatId: own.chatId, type: 'missed', items: [] })
        missed.get(l.phoneNumber).items.push({ key: `missed:${l._id}`, from: l.from, at: l.timestamp })
      }
    }
    for (const [to, j] of missed) jobs.push({ ...j, data: async (items) => ({ to, calls: items.map(i => ({ from: i.from, at: i.at })) }) })
    return jobs
  }

  const nextRenewal = (list) => {
    const n = list.filter(x => x.status === 'active' && new Date(x.expiresAt) > new Date()).sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)))[0]
    return n ? { phone: n.phoneNumber, expiresAt: n.expiresAt, price: Number(n.planPrice) || 0 } : null
  }

  // Renewal reminders, failed renewals and paused numbers.
  function numberStates(nums) {
    const now = Date.now(), jobs = []
    for (const [chatId, { numbers }] of nums.byChat) {
      for (const n of numbers) {
        const phone = n.phoneNumber, planName = T.planName(n.plan), price = Number(n.planPrice) || 0
        if (n.status === 'suspended' && n._holdUntil && new Date(n._holdUntil).getTime() - now > 5 * DAY) {
          jobs.push({ chatId, type: 'suspended', key: `suspended:${phone}:${n._holdUntil}`, data: async () => ({ phone, planName, holdUntil: n._holdUntil }) })
        }
        if (n.status !== 'active' || !(price > 0)) continue
        const exp = new Date(n.expiresAt).getTime()
        if (n._graceUntil && new Date(n._graceUntil).getTime() > now) {
          jobs.push({ chatId, type: 'renewFailed', key: `grace:${phone}:${n._graceUntil}`, data: async () => { const balance = await w.balance(chatId); return { phone, price, balance, shortfall: round2(Math.max(0, price - balance)), graceUntil: n._graceUntil } } })
        } else if (exp > now && exp - now <= 3 * DAY) {
          jobs.push({ chatId, type: 'renewSoon', key: `renewsoon:${phone}:${n.expiresAt}`, data: async () => { const balance = await w.balance(chatId); return { phone, planName, price, expiresAt: n.expiresAt, autoRenew: !!n.autoRenew, balance, shortfall: round2(Math.max(0, price - balance)) } } })
        }
      }
    }
    return jobs
  }

  // Low / empty wallet: one email each time the balance drops a level (ok → low → empty); topping up resets it.
  async function walletLevels(nums) {
    const jobs = []
    for (const [chatId, { createdAt, numbers }] of nums.byChat) {
      if (!numbers.some(n => n.status === 'active')) continue
      const p = await prefs.findOne({ _id: chatId }, { projection: { emailPrefs: 1, emailState: 1 } })
      const at = Number(p?.emailPrefs?.lowBalanceAt ?? DEFAULTS.lowBalanceAt)
      const balance = await w.balance(chatId)
      const level = balance < EMPTY_AT ? 'empty' : balance < at ? 'low' : 'ok'
      const stored = p?.emailState?.wallet
      if (stored === level) continue
      let r
      try { r = await prefs.updateOne({ _id: chatId, 'emailState.wallet': stored ?? null }, { $set: { 'emailState.wallet': level } }, { upsert: true }) } catch (_) { continue } // another instance got there first
      if (!(r.modifiedCount || r.upsertedCount)) continue
      // First look at an account from before these emails existed: only remember the level.
      const prev = stored ?? (createdAt && createdAt >= since ? 'ok' : null)
      if (!prev || RANK[level] <= RANK[prev]) continue
      jobs.push({ chatId, type: level === 'empty' ? 'walletEmpty' : 'lowBalance', key: `wallet:${chatId}:${level}:${Date.now()}`, data: async () => ({ balance, threshold: at, next: nextRenewal(numbers) }) })
    }
    return jobs
  }

  async function run(jobs) {
    if (!jobs.length) return 0
    const keys = jobs.flatMap(j => (j.items ? j.items.map(i => i.key) : [j.key]))
    const done = new Set((await sent.find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray()).map(d => d._id))
    let n = 0
    for (const j of jobs) {
      try {
        if (j.items) {
          const items = j.items.filter(i => !done.has(i.key))
          if (!items.length) continue
          if (items.length > 1) await sent.insertMany(items.slice(1).map(i => ({ _id: i.key, chatId: j.chatId, type: 'missed-grouped', at: new Date() })), { ordered: false }).catch(() => {})
          if (await send(j.chatId, j.type, await j.data(items), items[0].key)) n++
        } else if (!done.has(j.key) && await send(j.chatId, j.type, await j.data(), j.key)) n++
      } catch (e) { log(`[CloudIVR-Email] ${j.type} for ${j.chatId} failed: ${e.message}`) }
    }
    return n
  }

  let ticks = 0, busy = false
  async function tick() {
    if (busy) return 0
    busy = true
    try {
      const from = await cursor()
      const nums = await webNumbers()
      const jobs = await events(from, nums)
      if (ticks++ % 5 === 0) jobs.push(...numberStates(nums), ...(await walletLevels(nums)))
      return await run(jobs)
    } catch (e) { log(`[CloudIVR-Email] scan failed: ${e.message}`); return 0 } finally { busy = false }
  }

  async function weeklyFor(chatId, numbers, now = new Date()) {
    const start = new Date(now.getTime() - 7 * DAY), phones = numbers.map(n => n.phoneNumber)
    const [logs, camps, balance] = await Promise.all([
      phones.length ? db.collection('phoneLogs').find({ phoneNumber: { $in: phones }, timestamp: { $gte: start.toISOString(), $lt: now.toISOString() } }, { projection: { phoneNumber: 1, type: 1, duration: 1 } }).toArray() : [],
      db.collection('bulkCallCampaigns').find({ chatId: String(chatId), completedAt: { $gte: start, $lt: now } }, { projection: { stats: 1 } }).toArray(),
      w.balance(chatId),
    ])
    const s = { callsIn: 0, missed: 0, voicemails: 0, smsIn: 0, smsOut: 0, outgoing: 0 }, per = {}
    let secs = 0
    for (const l of logs) {
      if (l.type === 'sms') s.smsIn++
      else if (l.type === 'sms_out') s.smsOut++
      else if (OUT.has(l.type)) { s.outgoing++; secs += l.duration || 0 }
      else if (!NOT_CALLS.has(l.type)) {
        s.callsIn++; secs += l.duration || 0; per[l.phoneNumber] = (per[l.phoneNumber] || 0) + 1
        if (l.type === 'missed') s.missed++
        if (l.type === 'voicemail') s.voicemails++
      }
    }
    const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0]
    const soon = now.getTime() + 7 * DAY
    const renewals = numbers.filter(n => n.status === 'active' && new Date(n.expiresAt).getTime() <= soon && new Date(n.expiresAt).getTime() > now.getTime())
      .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt))).map(n => ({ phone: n.phoneNumber, expiresAt: n.expiresAt, price: Number(n.planPrice) || 0 }))
    const due = renewals.reduce((a, r) => a + r.price, 0)
    const campaigns = camps.length, campaignCalls = camps.reduce((a, c) => a + (c.stats?.total || 0), 0), campaignAnswered = camps.reduce((a, c) => a + (c.stats?.answered || 0), 0)
    const plan = numbers.map(n => n.plan).sort((a, b) => (PLAN_RANK[b] || 0) - (PLAN_RANK[a] || 0))[0] || 'starter'
    return {
      ...s, start, end: now, minutes: Math.round(secs / 60), campaigns, campaignCalls, campaignAnswered, balance, renewals,
      shortfall: round2(Math.max(0, due - balance)), busiest: top && top[1] >= 2 ? { phone: top[0], n: top[1] } : null, plan,
      quiet: s.callsIn + s.outgoing + s.smsIn + s.smsOut + campaigns === 0,
    }
  }

  async function runWeekly(now = new Date()) {
    const nums = await webNumbers(), day = now.toISOString().slice(0, 10)
    let n = 0
    for (const [chatId, { numbers }] of nums.byChat) {
      const mine = numbers.filter(x => x.status === 'active' || x.status === 'suspended')
      if (!mine.length) continue
      try { if (await send(chatId, 'weekly', await weeklyFor(chatId, mine, now), `weekly:${chatId}:${day}`)) n++ } catch (e) { log(`[CloudIVR-Email] weekly for ${chatId} failed: ${e.message}`) }
    }
    log(`[CloudIVR-Email] weekly summaries sent: ${n}`)
    return n
  }

  // Example data for previews and test emails: the account's own number and wallet where it has them.
  async function sample(type, chatId) {
    const list = ((await db.collection('phoneNumbersOf').findOne({ _id: String(chatId) }))?.val?.numbers || []).filter(n => n.status !== 'released')
    const n = list.find(x => x.status === 'active') || { phoneNumber: '+14155550182', plan: 'pro', planPrice: 75, countryName: 'United States', status: 'active', autoRenew: true, expiresAt: new Date(Date.now() + 30 * DAY).toISOString() }
    const balance = await w.balance(chatId), phone = n.phoneNumber, plan = n.plan, planName = T.planName(plan), price = Number(n.planPrice) || 0
    const at = (ms) => new Date(Date.now() + ms).toISOString()
    switch (type) {
      case 'numberLive': return { phone, plan, planName, country: n.countryName, expiresAt: n.expiresAt, price }
      case 'renewed': return { phone, plan, planName, amount: price, expiresAt: n.expiresAt, balance }
      case 'upgraded': return { phone, from: 'pro', to: 'business', fromName: 'Pro', toName: 'Business', amount: 45 }
      case 'renewSoon': return { phone, planName, price, expiresAt: at(3 * DAY), autoRenew: !!n.autoRenew, balance, shortfall: round2(Math.max(0, price - balance)) }
      case 'renewFailed': return { phone, price, balance: round2(price / 3), shortfall: round2(price - price / 3), graceUntil: at(DAY) }
      case 'suspended': return { phone, planName, holdUntil: at(7 * DAY) }
      case 'topup': return { amount: 50, balance: Math.max(balance, 50) }
      case 'lowBalance': return { balance: 6.4, threshold: (await profile(chatId)).email.lowBalanceAt, next: { phone, expiresAt: n.expiresAt, price } }
      case 'walletEmpty': return { balance: 0.12 }
      case 'campaignDone': return { id: 'sample', name: 'Spring offer', callerId: phone, cancelled: false, mode: 'transfer', duration: 1460, rate: 47, notDialed: 0, stats: { total: 250, answered: 118, keyPressed: 64, transferred: 21, noAnswer: 96, hungUp: 12, voicemail: 9, busy: 6, failed: 9 } }
      case 'voicemail': return { from: '+14155550122', to: phone, duration: 38, transcript: 'Hi, it’s Dana from Lakeside Realty — calling about the listing on Elm Street. Call me back when you get a minute.' }
      case 'missed': return { to: phone, calls: [{ from: '+14155550122', at: at(-20 * 60000) }, { from: '+447700900123', at: at(-5 * 60000) }] }
      case 'weekly': return weeklyFor(chatId, list.length ? list : [n])
      default: return {}
    }
  }

  function publicRoutes(router, { h }) {
    const page = (req, res, state) => {
      const u = String(req.query.u || ''), g = String(req.query.g || '')
      return prefs.findOne({ _id: u }).then(p => res.status(state === 'bad' ? 400 : 200).type('html').send(T.offPage(LANGS.includes(p?.lang) ? p.lang : 'en', g, state, { base: site(), app: appUrl, action: `?${new URLSearchParams({ u, g, t: String(req.query.t || '') })}` })))
    }
    // GET asks first (link scanners must not unsubscribe anyone); POST (button / one-click header) turns it off.
    router.get('/public/email/off', h(async (req, res) => page(req, res, sigOk(String(req.query.u || ''), String(req.query.g || ''), req.query.t || '') ? 'ask' : 'bad')))
    router.post('/public/email/off', h(async (req, res) => {
      const u = String(req.query.u || ''), g = String(req.query.g || '')
      if (!sigOk(u, g, req.query.t || '')) return page(req, res, 'bad')
      await prefs.updateOne({ _id: u }, { $set: { [`emailPrefs.${g}`]: false, updatedAt: new Date() } }, { upsert: true })
      return page(req, res, 'done')
    }))
  }

  function routes(router, { h }) {
    router.get('/prefs/email', h(async (req, res) => {
      const pr = await profile(req.webChatId)
      res.json({ prefs: pr.email, lang: pr.lang, email: pr.acc?.email || null, live: live(), types: T.TYPES })
    }))
    router.put('/prefs/email', h(async (req, res) => {
      const b = req.body || {}, set = {}
      for (const k of OPTIONAL) {
        if (!(k in b)) continue
        if (typeof b[k] !== 'boolean') return bad(res, 400, 'invalid_value', 'Turn it on or off.')
        set[`emailPrefs.${k}`] = b[k]
      }
      if ('lowBalanceAt' in b) {
        const v = Number(b.lowBalanceAt)
        if (!Number.isFinite(v) || v < 1 || v > 1000) return bad(res, 400, 'invalid_amount', 'Pick an alert amount between $1 and $1,000.')
        set['emailPrefs.lowBalanceAt'] = round2(v)
        set['emailState.wallet'] = null // re-check the level against the new amount
      }
      if (!Object.keys(set).length) return bad(res, 400, 'nothing_to_save', 'Nothing to save.')
      await prefs.updateOne({ _id: req.webChatId }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true })
      res.json({ prefs: (await profile(req.webChatId)).email })
    }))
    router.get('/emails/preview/:type', h(async (req, res) => {
      const type = String(req.params.type)
      if (!T.TYPES.includes(type)) return bad(res, 404, 'not_found', 'There is no email with that name.')
      const pr = await profile(req.webChatId)
      if (LANGS.includes(req.query.lang)) pr.lang = req.query.lang
      const { subject, html } = build(type, await sample(type, req.webChatId), pr)
      res.type('html').send(html.replace(/<title>[^<]*<\/title>/, `<title>${subject.replace(/[<&]/g, '')}</title>`))
    }))
    router.post('/emails/test', h(async (req, res) => {
      const type = String(req.body?.type || '')
      if (!T.TYPES.includes(type)) return bad(res, 400, 'invalid_type', 'Pick one of the emails in the list.')
      const recent = await sent.countDocuments({ chatId: req.webChatId, _id: { $regex: '^test:' }, at: { $gte: new Date(Date.now() - 3600000) } })
      if (recent >= 10) return bad(res, 429, 'too_many', 'That’s 10 test emails this hour — try again later.')
      const key = `test:${req.webChatId}:${type}:${Date.now()}`
      await send(req.webChatId, type, await sample(type, req.webChatId), key, { force: true })
      const row = await sent.findOne({ _id: key }, { projection: { to: 1, subject: 1, ok: 1 } })
      res.json({ sent: row?.ok === true, preview: row?.ok === 'preview', to: row?.to || null, subject: row?.subject || null })
    }))
    router.get('/emails/log', h(async (req, res) => {
      const rows = await sent.find({ chatId: req.webChatId, type: { $ne: 'missed-grouped' } }, { projection: { html: 0 } }).sort({ at: -1 }).limit(20).toArray()
      res.json({ emails: rows.map(r => ({ id: r._id, type: r.type, subject: r.subject || null, at: r.at, status: r.ok === true ? 'sent' : r.ok === 'preview' ? 'preview' : 'failed', test: String(r._id).startsWith('test:') })) })
    }))
    router.post('/admin/emails/weekly', h(async (req, res) => {
      if (!isAdmin(req.webUser)) return bad(res, 403, 'forbidden', 'Admins only.')
      runWeekly().catch(e => log(`[CloudIVR-Email] weekly run failed: ${e.message}`))
      res.status(202).json({ started: true })
    }))
  }

  let started = false
  function start() {
    if (started) return
    started = true
    const t = setInterval(tick, 60000)
    if (t.unref) t.unref()
    setTimeout(tick, 15000).unref?.()
    schedule.scheduleJob({ rule: '0 8 * * 1', tz: 'Etc/UTC' }, () => runWeekly().catch(e => log(`[CloudIVR-Email] weekly run failed: ${e.message}`)))
    log('[CloudIVR-Email] scanner on (every minute) · weekly summary Mondays 08:00 UTC')
  }

  return { send, tick, runWeekly, weeklyFor, sample, render: build, routes, publicRoutes, start }
}

module.exports = { createEmails, DEFAULTS, GROUPS }
