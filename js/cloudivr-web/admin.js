'use strict'
// CloudIVR admin dashboard API (/admin/*, owner only): overview, users & wallets, Landline-to-Texting queue,
// numbers / campaigns / AI agents, white-label resellers (read-only). Every change needs a reason and is audited.
const multer = require('multer')
const { MongoClient } = require('mongodb')
const { walletOps } = require('./wallet')
const HS = require('../hosted-sms.js')
const aiStore = require('../ai-agent/store')
const notify = require('./notify')
const { mobileLines, LIVE_MOBILE, LIVE_TEXTING } = require('./numbers')

const DAY = 864e5
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const num = (x) => Math.round(Number(x || 0) * 100) / 100

function createAdmin(db, { log = console.log, bulkCallService, adminAuth }) {
  const w = walletOps(db)
  const audit = db.collection('adminAudit')
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 6 } })
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const need = (req, res) => { const r = String(req.body?.reason || '').trim(); if (r.length < 3) { bad(res, 400, 'reason', 'Add a short reason — it goes in the admin log.'); return null } return r.slice(0, 300) }
  const log1 = (req, action, target, reason, details) => audit.insertOne({ at: new Date(), admin: req.admin.email, ip: req.admin.ip, action, target: String(target || ''), reason: reason || null, details: details || null })
  const balanceOf = async (ids) => Object.fromEntries((await db.collection('walletOf').find({ _id: { $in: ids.map(String) } }).toArray()).map(x => [x._id, num((x.usdIn || 0) - (x.usdOut || 0))]))
  const blockedOf = async (ids) => new Set((await db.collection('chatIdBlocked').find({ _id: { $in: ids.map(String) }, val: true }).toArray()).map(x => String(x._id)))

  // White-label bots keep their own databases: RESELLER_DBS = JSON [{ key, name, url, db }].
  const resellers = (() => { try { return JSON.parse(process.env.RESELLER_DBS || '[]') } catch (_) { return [] } })()
  const clients = {}
  const resellerDb = async (r) => { if (!clients[r.key]) clients[r.key] = MongoClient.connect(r.url, { serverSelectionTimeoutMS: 8000 }); return (await clients[r.key]).db(r.db) }
  const sumTx = (d, since, types) => d.collection('transactions').aggregate([{ $match: { createdAt: { $gt: since }, ...(types ? { type: { $in: types } } : {}) } }, { $group: { _id: '$type', n: { $sum: 1 }, usd: { $sum: '$amount' } } }, { $sort: { usd: -1 } }]).toArray()

  function routes(r, h) {
    const A = adminAuth.require
    r.get('/admin/fax-sales', A, h(async (req, res) => res.json(await require('../fax-sales').report(db))))
    r.get('/admin/msg-watch', A, h(async (req, res) => res.json(await require('../msg-watch').status())))
    r.put('/admin/msg-watch', A, h(async (req, res) => res.json(await require('../msg-watch').setHold(req.body?.hold === true, 'web admin'))))
    r.get('/admin/channel-posts', A, h(async (req, res) => res.json({ targets: require('../channel-ads').targets(), items: (await require('../channel-ads').recentPosts(20)).map(({ _id, ...x }) => ({ slot: _id, ...x })) })))
    r.post('/admin/channel-posts/now', A, h(async (req, res) => { const ca = require('../channel-ads'), chat = ca.targets().find(t => t.chat === req.body?.chat)?.chat; if (req.body?.chat && !chat) return res.status(400).json({ error: 'Unknown channel' }); ca.postNow(chat).catch(() => {}); res.json({ started: true, chat: chat || ca.targets()[0]?.chat }) }))
    r.get('/admin/emily-misuse', A, h(async (req, res) => res.json({ items: await require('../emily-guard').list({ limit: Number(req.query.limit) || 100 }) })))
    r.get('/admin/bird-spend', A, h(async (req, res) => res.json(await require('../bird-spend').status())))
    // 2Chat UK numbers: orders the supplier couldn't fill (admin finishes them by hand) and numbers waiting for their forward.
    r.get('/admin/twochat', A, h(async (req, res) => {
      const orders = (await require('../pending-orders').waiting('2chat')).map(o => ({ id: o._id, chatId: o.chatId, placeholder: o.phoneNumber, where: o.meta?.label || o.phoneNumber, type: o.meta?.type || 'local', amount: o.amount, why: o.meta?.why || null, bought: o.meta?.bought?.phone_number || null, tries: o.tries || 0, createdAt: o.createdAt }))
      const setup = []
      for (const d of await db.collection('phoneNumbersOf').find({ 'val.numbers': { $elemMatch: { provider: '2chat', awaitingForward: true } } }).toArray())
        for (const n of d.val.numbers.filter(x => x.provider === '2chat' && x.awaitingForward)) setup.push({ chatId: d._id, phoneNumber: n.phoneNumber, landingNumber: n.landingNumber, tries: n.forwardSetup?.tries || 0, lastTry: n.forwardSetup?.armedAt || null, nextTry: n.forwardSetup?.nextTryAt || null, since: n.purchaseDate })
      res.json({ orders, setup })
    }))
    r.post('/admin/twochat/orders/:id/complete', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const number = String(req.body?.number || '').replace(/[^\d+]/g, ''), landing = String(req.body?.landing || '').replace(/[^\d+]/g, '') || null
      if (!/^\+?44\d{9,10}$/.test(number)) return bad(res, 400, 'number', 'Enter the UK number you bought on 2Chat, e.g. +442012345678.')
      if (landing && !/^\+?1\d{10}$/.test(landing)) return bad(res, 400, 'landing', 'The landing number must be a US/Canada number on our Infobip account, e.g. +17635550123.')
      try {
        const got = await require('../pending-orders').completeManual(req.params.id, number, landing)
        await log1(req, 'twochat-complete', req.params.id, reason, got)
        res.json(got)
      } catch (e) { bad(res, 400, 'twochat', e.message) }
    }))
    r.post('/admin/twochat/check/:number', A, h(async (req, res) => res.json(await require('../twochat').checkNow(decodeURIComponent(req.params.number)))))
    r.post('/admin/bird-spend/topup', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      try {
        const s = await require('../bird-spend').topUp(req.body?.amount)
        await log1(req, 'bird-topup', 'bird', reason, { amount: s.budget })
        res.json(s)
      } catch (e) { bad(res, 400, 'invalid_amount', e.message) }
    }))
    r.get('/admin/overview', A, h(async (req, res) => {
      const now = Date.now(), d30 = new Date(now - 30 * DAY), d1 = new Date(now - DAY)
      const [byType, today, series, botUsers, webUsers, newWeb, numbers, running, hosted, agents, mobileCount] = await Promise.all([
        sumTx(db, d30),
        sumTx(db, d1, ['wallet-topup']),
        db.collection('transactions').aggregate([{ $match: { type: 'wallet-topup', createdAt: { $gt: new Date(now - 14 * DAY) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, usd: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
        db.collection('nameOf').estimatedDocumentCount(),
        db.collection('webAccounts').estimatedDocumentCount(),
        db.collection('webAccounts').countDocuments({ createdAt: { $gt: new Date(now - 7 * DAY) } }),
        db.collection('phoneNumbersOf').aggregate([{ $project: { n: { $size: { $filter: { input: { $ifNull: ['$val.numbers', []] }, cond: { $ne: ['$$this.status', 'released'] } } } } } }, { $group: { _id: null, n: { $sum: '$n' } } }]).toArray(),
        db.collection('bulkCallCampaigns').countDocuments({ status: 'running' }),
        db.collection('hostedSms').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
        db.collection('aiAgents').find({}, { projection: { name: 1, goal: 1, firstMessage: 1, greeting: 1, knowledge: 1 } }).toArray(),
        db.collection('esimLines').countDocuments({ kind: 'mobile', status: { $in: LIVE_MOBILE } }),
      ])
      const deposits = byType.find(x => x._id === 'wallet-topup')
      const sales = byType.filter(x => !/topup|bonus|credit|refund|overpayment/.test(x._id))
      const refunds = byType.filter(x => /refund/.test(x._id)).reduce((t, x) => t + x.usd, 0)
      res.json({
        deposits30: num(deposits?.usd), depositCount30: deposits?.n || 0, depositsToday: num(today[0]?.usd), sales30: num(sales.reduce((a, x) => a + x.usd, 0)), refunds30: num(refunds), netSales30: num(sales.reduce((a, x) => a + x.usd, 0) - refunds),
        byType: byType.map(x => ({ type: x._id, n: x.n, usd: num(x.usd) })), series: series.map(x => ({ day: x._id, usd: num(x.usd), n: x.n })),
        botUsers, webUsers, newWeb7: newWeb, numbers: (numbers[0]?.n || 0) + mobileCount + hosted.filter(x => LIVE_TEXTING.includes(x._id)).reduce((a, x) => a + x.n, 0), runningCampaigns: running,
        hosted: Object.fromEntries(hosted.map(x => [x._id, x.n])), flaggedAgents: agents.filter(a => aiStore.flagOf(a)).length,
      })
    }))

    // Free-call funnel (web): sign-ups → tried a free call → answered → pressed a key → paid, last 30 days + per day.
    r.get('/admin/funnel', A, h(async (req, res) => {
      const since = new Date(Date.now() - 30 * DAY)
      const day = (d) => new Date(d).toISOString().slice(0, 10)
      const [accs, quick, landing] = await Promise.all([
        db.collection('webAccounts').find({ createdAt: { $gt: since } }, { projection: { _id: 1, createdAt: 1 } }).toArray(),
        db.collection('webQuickCalls').find({ trial: true, at: { $gt: since } }, { projection: { chatId: 1, at: 1 } }).toArray(),
        db.collection('webTryCalls').find({ createdAt: { $gt: since } }, { projection: { chatId: 1, createdAt: 1, noAnswer: 1, email: 1, triedEmail: 1 } }).toArray(),
      ])
      const quickIds = [...new Set(quick.map(q => String(q.chatId)))]
      const answeredQ = (await db.collection('state').find({ _id: { $in: quickIds.map(id => `ivrTrialUsed_${id}`) }, val: true }).toArray()).length
      const callIds = [...quickIds, ...landing.map(l => String(l.chatId))]
      const pressed = new Set((await db.collection('ivrAnalytics').find({ chatId: { $in: [...callIds, ...callIds.map(Number).filter(Boolean)] }, digit: { $nin: [null, ''] } }, { projection: { chatId: 1 } }).toArray()).map(x => String(x.chatId))).size
      const ids = accs.map(a => String(a._id))
      const tops = await db.collection('transactions').find({ type: 'wallet-topup', chatId: { $in: ids } }, { projection: { chatId: 1, createdAt: 1 } }).toArray()
      const rows = {}
      const bump = (d, k) => { const x = (rows[day(d)] = rows[day(d)] || { day: day(d), signups: 0, trials: 0, firstDeposits: 0 }); x[k] += 1 }
      accs.forEach(a => bump(a.createdAt, 'signups'))
      quick.forEach(q => bump(q.at, 'trials')); landing.forEach(l => bump(l.createdAt, 'trials'))
      const first = {}; tops.forEach(t => { if (!first[t.chatId] || t.createdAt < first[t.chatId]) first[t.chatId] = t.createdAt })
      Object.values(first).forEach(d => bump(d, 'firstDeposits'))
      res.json({
        signups: accs.length, quickTried: quickIds.length, quickAnswered: answeredQ, landingTried: landing.length, landingAnswered: landing.filter(l => !l.noAnswer).length,
        pressed, paid: Object.keys(first).length,
        days: Object.values(rows).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14),
      })
    }))

    // Signup insights: where sign-ups come from, what they need, where visitors and new users stop.
    r.get('/admin/signup-insights', A, h(async (req, res) => {
      const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
      const since = new Date(Date.now() - days * DAY)
      const accs = await db.collection('webAccounts').find({ createdAt: { $gt: since } }, { projection: { _id: 1, source: 1, marketingOptIn: 1, signupDevice: 1 } }).toArray()
      const ids = accs.map(a => String(a._id))
      const [prefs, tops, events] = await Promise.all([
        db.collection('webPrefs').find({ _id: { $in: ids } }, { projection: { purposes: 1, onboardedAt: 1 } }).toArray(),
        db.collection('transactions').find({ type: 'wallet-topup', chatId: { $in: ids } }, { projection: { chatId: 1 } }).toArray(),
        db.collection('webEvents').find({ at: { $gt: since } }, { projection: { name: 1, anon: 1, chatId: 1, path: 1, at: 1 } }).sort({ at: -1 }).limit(200000).toArray().then(l => l.reverse()),
      ])
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch (_) { return null } }
      const count = (list) => { const o = {}; for (const k of list) o[k] = (o[k] || 0) + 1; return Object.entries(o).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n) }
      const src = (s) => s?.utm_source || (s?.gclid && 'google ads') || (s?.fbclid && 'facebook ads') || host(s?.referrer) || (s?.ref && 'referral') || 'Direct / unknown'
      const paid = new Set(tops.map(t => String(t.chatId)))
      const bySource = Object.values(accs.reduce((o, a) => { const k = src(a.source); const x = (o[k] = o[k] || { key: k, n: 0, paid: 0 }); x.n += 1; if (paid.has(String(a._id))) x.paid += 1; return o }, {})).sort((a, b) => b.n - a.n)
      const answered = prefs.filter(p => p.onboardedAt)
      const anonOf = {}, lastAnon = {}, lastUser = {}, seen = { visit: new Set(), started: new Set(), done: new Set() }
      for (const e of events) {
        if (e.anon && e.chatId) anonOf[e.anon] = e.chatId
        if (/\/admin(\/|$)/.test(e.path || '')) continue
        if (e.anon && e.name === 'page_view') { seen.visit.add(e.anon); if (!e.chatId) lastAnon[e.anon] = e.path }
        if (e.anon && e.name === 'signup_started') seen.started.add(e.anon)
        if (e.anon && e.name === 'signup_done') seen.done.add(e.anon)
        if (e.chatId && e.name === 'page_view') lastUser[e.chatId] = e.path
      }
      const visitorExits = count(Object.entries(lastAnon).filter(([a]) => !anonOf[a] && !seen.done.has(a)).map(([, p]) => p || '/')).slice(0, 10)
      const userExits = count(ids.filter(id => !paid.has(id) && lastUser[id]).map(id => lastUser[id])).slice(0, 10)
      res.json({
        days, signups: accs.length, optIn: accs.filter(a => a.marketingOptIn).length, paid: ids.filter(id => paid.has(id)).length,
        bySource, byCampaign: count(accs.filter(a => a.source?.utm_campaign).map(a => a.source.utm_campaign)).slice(0, 10),
        byDevice: count(accs.map(a => (/mobile|iphone|android/i.test(a.signupDevice || '') ? 'Phone' : a.signupDevice ? 'Computer' : 'Unknown'))),
        purposes: count(answered.flatMap(p => p.purposes || [])), skipped: answered.filter(p => !(p.purposes || []).length).length, unanswered: accs.length - answered.length,
        funnel: [['Visited the site', seen.visit.size], ['Opened sign-up', seen.started.size], ['Signed up (tracked visits)', seen.done.size], ['Said what they need', answered.filter(p => (p.purposes || []).length).length], ['Added money', ids.filter(id => paid.has(id)).length]],
        visitorExits, userExits,
      })
    }))

    // Users: web accounts + bot users (nameOf). q = chat id, email or name.
    r.get('/admin/users', A, h(async (req, res) => {
      const q = String(req.query.q || '').trim(), kind = ['web', 'bot'].includes(req.query.kind) ? req.query.kind : 'all', withPlan = req.query.plan === '1'
      const P = { projection: { passwordHash: 0, twoFactor: 0 } }
      let web = [], bot = []
      if (!q && withPlan) {
        // "Has a plan": accounts that own at least one number/plan. Web ids are matched directly (a sorted owner list would be all bot ids).
        const has = { 'val.numbers.0': { $exists: true } }
        const wids = (await db.collection('webAccounts').find({}, { projection: { _id: 1 } }).sort({ createdAt: -1 }).limit(5000).toArray()).map(x => String(x._id))
        if (kind !== 'bot') {
          const own = (await db.collection('phoneNumbersOf').find({ ...has, _id: { $in: wids } }, { projection: { _id: 1 } }).toArray()).map(o => Number(o._id))
          web = await db.collection('webAccounts').find({ _id: { $in: own } }, P).sort({ createdAt: -1 }).limit(50).toArray()
        }
        if (kind !== 'web') {
          const own = (await db.collection('phoneNumbersOf').find({ ...has, _id: { $nin: wids } }, { projection: { _id: 1 } }).limit(50).toArray()).map(o => String(o._id))
          bot = await db.collection('nameOf').find({ _id: { $in: own } }).toArray()
          const named = new Set(bot.map(b => String(b._id))); bot.push(...own.filter(id => !named.has(id)).map(id => ({ _id: id, val: '' })))
        }
      } else if (!q) {
        if (kind !== 'bot') web = await db.collection('webAccounts').find({}, P).sort({ createdAt: -1 }).limit(50).toArray()
        if (kind === 'bot') bot = await db.collection('nameOf').find({}).sort({ $natural: -1 }).limit(50).toArray()
      }
      else if (/^\d{5,}$/.test(q)) {
        web = await db.collection('webAccounts').find({ _id: Number(q) }, { projection: { passwordHash: 0, twoFactor: 0 } }).toArray()
        bot = await db.collection('nameOf').find({ _id: q }).toArray()
      } else {
        const rx = new RegExp(esc(q), 'i')
        web = await db.collection('webAccounts').find({ $or: [{ email: rx }, { name: rx }] }, { projection: { passwordHash: 0, twoFactor: 0 } }).limit(25).toArray()
        bot = await db.collection('nameOf').find({ val: rx }).limit(25).toArray()
      }
      if (kind === 'web') bot = []; if (kind === 'bot') web = []
      const ids = [...web.map(x => String(x._id)), ...bot.map(x => String(x._id))]
      const [bal, blocked, owned] = await Promise.all([balanceOf(ids), blockedOf(ids), db.collection('phoneNumbersOf').find({ _id: { $in: ids } }, { projection: { 'val.numbers.plan': 1, 'val.numbers.status': 1, 'val.numbers.expiresAt': 1 } }).toArray()])
      const plans = Object.fromEntries(owned.map(o => [String(o._id), (o.val?.numbers || []).map(n => ({ plan: n.plan || 'number', status: n.status || 'active', expiresAt: n.expiresAt || null }))]))
      res.json({ items: [
        ...web.map(a => ({ chatId: String(a._id), kind: 'web', name: a.name || '', email: a.email, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt, balance: bal[String(a._id)] || 0, suspended: !!a.disabled, plans: plans[String(a._id)] || [] })),
        ...bot.filter(b => !web.some(x => String(x._id) === String(b._id))).map(b => ({ chatId: String(b._id), kind: 'bot', name: b.val || '', email: null, balance: bal[String(b._id)] || 0, suspended: blocked.has(String(b._id)), plans: plans[String(b._id)] || [] })),
      ] })
    }))
    r.get('/admin/users/:chatId', A, h(async (req, res) => {
      const id = String(req.params.chatId)
      const [acct, name, wal, tx, nums, camps, hosted, agents, blocked, mobile] = await Promise.all([
        /^\d+$/.test(id) ? db.collection('webAccounts').findOne({ _id: Number(id) }, { projection: { passwordHash: 0, twoFactor: 0 } }) : null,
        db.collection('nameOf').findOne({ _id: id }),
        db.collection('walletOf').findOne({ _id: id }),
        db.collection('transactions').find({ chatId: id }).sort({ createdAt: -1 }).limit(60).toArray(),
        db.collection('phoneNumbersOf').findOne({ _id: id }),
        db.collection('bulkCallCampaigns').find({ chatId: id }, { projection: { leads: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
        db.collection('hostedSms').find({ chatId: id }).sort({ createdAt: -1 }).toArray(),
        db.collection('aiAgents').find({ chatId: id }).toArray(),
        db.collection('chatIdBlocked').findOne({ _id: id, val: true }),
        mobileLines(db, id),
      ])
      if (!acct && !name && !wal) return bad(res, 404, 'not_found', 'No user with that id.')
      const resale = await db.collection('numberResaleRecords').find({ chatId: id }).sort({ at: -1 }).limit(50).toArray()
      res.json({
        legalProfile: acct?.legalProfile || null, resale: resale.map(x => ({ phoneNumber: x.phoneNumber, provider: x.provider, at: x.at, note: x.note })),
        chatId: id, kind: acct ? 'web' : 'bot', name: acct?.name || name?.val || '', email: acct?.email || null, createdAt: acct?.createdAt || null, lastLoginAt: acct?.lastLoginAt || null,
        suspended: acct ? !!acct.disabled : !!blocked, balance: num((wal?.usdIn || 0) - (wal?.usdOut || 0)), totalIn: num(wal?.usdIn), totalOut: num(wal?.usdOut),
        transactions: tx.map(t => ({ id: String(t._id), type: t.type, amount: num(t.amount), at: t.createdAt, meta: t.metadata || null })),
        numbers: [...(nums?.val?.numbers || []).map(n => ({ phoneNumber: n.phoneNumber, plan: n.plan, status: n.status || 'active', expiresAt: n.expiresAt, country: n.country })),
          ...mobile.map(d => ({ phoneNumber: d.phoneNumber || 'Assigning…', plan: 'mobile', status: d.status, expiresAt: d.expiresAt || null, country: 'US' })),
          ...hosted.filter(d => LIVE_TEXTING.includes(d.status)).map(d => ({ phoneNumber: d.phoneNumber, plan: 'texting', status: d.status, expiresAt: d.planNumber ? null : d.nextBillAt || null, country: d.phoneNumber?.startsWith('+1') ? 'US' : null }))],
        campaigns: camps.map(c => ({ id: c.id, name: c.name || c.audioName, mode: c.mode, status: c.status, createdAt: c.createdAt, stats: c.stats || null })),
        hosted: hosted.map(HS.pub), agents: agents.map(a => ({ id: a.id, name: a.name, disabled: !!a.disabled, flag: aiStore.flagOf(a) })),
      })
    }))
    r.post('/admin/users/:chatId/wallet', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const id = String(req.params.chatId), amount = num(req.body?.amount)
      if (!amount || Math.abs(amount) > 10000) return bad(res, 400, 'amount', 'Enter an amount between -10000 and 10000 (minus = take from the wallet).')
      if (amount > 0) await w.credit(id, amount)
      else if (!(await w.debit(id, -amount))) return bad(res, 400, 'insufficient', 'The wallet doesn’t have that much.')
      await db.collection('transactions').insertOne({ _id: `ADM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, chatId: id, type: amount > 0 ? 'admin-credit' : 'admin-debit', amount: Math.abs(amount), currency: 'USD', status: 'completed', metadata: { reason, admin: req.admin.email }, createdAt: new Date(), updatedAt: new Date() })
      await log1(req, amount > 0 ? 'wallet_credit' : 'wallet_debit', id, reason, { amount })
      res.json({ ok: true, balance: (await balanceOf([id]))[id] || 0 })
    }))
    r.post('/admin/users/:chatId/suspend', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const id = String(req.params.chatId), on = req.body?.suspended !== false
      if (/^\d+$/.test(id)) await db.collection('webAccounts').updateOne({ _id: Number(id) }, on ? { $set: { disabled: true, disabledReason: reason }, $inc: { tokenVersion: 1 } } : { $unset: { disabled: '', disabledReason: '' } })
      await db.collection('chatIdBlocked').updateOne({ _id: id }, { $set: { val: on } }, { upsert: on })
      await log1(req, on ? 'suspend' : 'unsuspend', id, reason)
      res.json({ ok: true, suspended: on })
    }))

    // Landline to Texting queue.
    r.get('/admin/hosted', A, h(async (req, res) => {
      const st = String(req.query.status || '')
      const items = await db.collection('hostedSms').find(st ? { status: st } : { status: { $ne: 'starting' } }).sort({ updatedAt: -1 }).limit(100).toArray()
      const emails = Object.fromEntries((await db.collection('webAccounts').find({ _id: { $in: items.map(x => Number(x.chatId)).filter(Boolean) } }, { projection: { email: 1 } }).toArray()).map(a => [String(a._id), a.email]))
      res.json({ items: items.map(d => ({ ...HS.pub(d), chatId: d.chatId, email: emails[d.chatId] || null, telnyxOrderId: d.telnyxOrderId, handoffAt: d.handoffAt || null, submittedBy: d.submittedBy || null })) })
    }))
    r.post('/admin/hosted/:id/documents', A, upload.array('files', 6), h(async (req, res) => {
      const out = await HS.adminSubmitDocs(req.params.id, req.files || [], { admin: req.admin.email })
      if (out.error) return bad(res, 400, 'hosted', out.error)
      await log1(req, 'hosted_submit_docs', req.params.id, null, { files: (req.files || []).map(f => f.originalname) })
      res.json(out)
    }))
    r.post('/admin/hosted/:id/message', A, h(async (req, res) => {
      const text = String(req.body?.text || '').trim()
      if (text.length < 3) return bad(res, 400, 'text', 'Write the message for the customer.')
      const out = await HS.adminMessage(req.params.id, text)
      if (out.error) return bad(res, 400, 'hosted', out.error)
      await log1(req, 'hosted_message', req.params.id, null, { text: text.slice(0, 300) })
      res.json(out)
    }))
    r.post('/admin/hosted/:id/reject', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const out = await HS.adminReject(req.params.id, req.body?.note || reason)
      if (out.error) return bad(res, 400, 'hosted', out.error)
      await log1(req, 'hosted_reject_refund', req.params.id, reason)
      res.json(out)
    }))

    // CloudIVR: numbers, campaigns, AI agents.
    r.get('/admin/numbers', A, h(async (req, res) => {
      const q = String(req.query.q || '').replace(/[^\d+]/g, '')
      const docs = await db.collection('phoneNumbersOf').find(q ? { 'val.numbers.phoneNumber': new RegExp(esc(q)) } : {}).limit(200).toArray()
      const items = docs.flatMap(d => (d.val?.numbers || []).map(n => ({ chatId: String(d._id), phoneNumber: n.phoneNumber, plan: n.plan, status: n.status || 'active', country: n.country, type: n.type, expiresAt: n.expiresAt, autoRenew: n.autoRenew !== false })))
      res.json({ items: (q ? items.filter(n => n.phoneNumber.includes(q)) : items).slice(0, 300) })
    }))
    r.get('/admin/campaigns', A, h(async (req, res) => {
      const st = String(req.query.status || '')
      const items = await db.collection('bulkCallCampaigns').find(st ? { status: st } : {}, { projection: { leads: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()
      res.json({ items: items.map(c => ({ id: c.id, chatId: c.chatId, name: c.name || c.audioName, mode: c.mode, agentName: c.agentName || null, callerId: c.callerId, status: c.status, createdAt: c.createdAt, stats: c.stats || null, total: c.totalLeads || c.stats?.total || null })) })
    }))
    r.post('/admin/campaigns/:id/:action', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const fn = { pause: 'pauseCampaign', resume: 'resumeCampaign', cancel: 'cancelCampaign' }[req.params.action]
      if (!fn || !bulkCallService?.[fn]) return bad(res, 400, 'action', 'Unknown action.')
      const out = await bulkCallService[fn](req.params.id, ...(fn === 'cancelCampaign' ? ['Cancelled by CloudIVR'] : []))
      if (out?.error) return bad(res, 400, 'campaign', out.error)
      await log1(req, `campaign_${req.params.action}`, req.params.id, reason)
      res.json({ ok: true })
    }))
    r.get('/admin/ai-agents', A, h(async (req, res) => {
      const items = await db.collection('aiAgents').find({}).sort({ updatedAt: -1 }).limit(300).toArray()
      const out = items.map(a => ({ id: a.id, chatId: a.chatId, name: a.name, businessName: a.businessName || '', disabled: !!a.disabled, flag: aiStore.flagOf(a), goal: String(a.goal || '').slice(0, 600), updatedAt: a.updatedAt }))
      res.json({ items: req.query.flagged === '1' ? out.filter(a => a.flag) : out })
    }))
    r.post('/admin/ai-agents/:id/disable', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const on = req.body?.disabled !== false
      const r2 = await db.collection('aiAgents').updateOne({ id: String(req.params.id) }, on ? { $set: { disabled: true, disabledReason: reason } } : { $unset: { disabled: '', disabledReason: '' } })
      if (!r2.matchedCount) return bad(res, 404, 'not_found', 'Agent not found.')
      await log1(req, on ? 'ai_agent_stop' : 'ai_agent_allow', req.params.id, reason)
      res.json({ ok: true, disabled: on })
    }))

    // White-label resellers (read-only).
    r.get('/admin/resellers', A, h(async (req, res) => {
      const since = new Date(Date.now() - 30 * DAY)
      const items = await Promise.all(resellers.map(async (x) => {
        try {
          const d = await resellerDb(x)
          const [users, wal, tx, nums] = await Promise.all([
            d.collection('nameOf').estimatedDocumentCount(),
            d.collection('walletOf').aggregate([{ $group: { _id: null, in: { $sum: '$usdIn' }, out: { $sum: '$usdOut' } } }]).toArray(),
            sumTx(d, since),
            d.collection('phoneNumbersOf').aggregate([{ $project: { n: { $size: { $ifNull: ['$val.numbers', []] } } } }, { $group: { _id: null, n: { $sum: '$n' } } }]).toArray(),
          ])
          const dep = tx.find(t => t._id === 'wallet-topup')
          return { key: x.key, name: x.name, ok: true, users, numbers: nums[0]?.n || 0, deposits30: num(dep?.usd), sales30: num(tx.filter(t => !/topup|bonus|credit|refund|overpayment/.test(t._id)).reduce((a, t) => a + t.usd, 0)), walletHeld: num((wal[0]?.in || 0) - (wal[0]?.out || 0)), byType: tx.slice(0, 8).map(t => ({ type: t._id, n: t.n, usd: num(t.usd) })) }
        } catch (e) { return { key: x.key, name: x.name, ok: false, error: e.message.slice(0, 120) } }
      }))
      res.json({ items, configured: resellers.length > 0 })
    }))

    r.get('/admin/audit', A, h(async (req, res) => res.json({ items: await audit.find({}).sort({ at: -1 }).limit(150).toArray() })))

    // Softphone sign-in state for every number with a SIP login.
    r.get('/admin/softphones', A, h(async (req, res) => res.json(await require('../sip-presence').overview(db))))

    // Customer-requested caller IDs waiting for approval (no code — admin vouches; Telnyx still filters the call).
    const callerIdsAdmin = require('./caller-ids').adminApi(db)
    const { sendMail } = require('./auth')
    const emailOf = async (chatId) => (/^\d+$/.test(String(chatId)) ? (await db.collection('webAccounts').findOne({ _id: Number(chatId) }, { projection: { email: 1 } }))?.email : null)
    const decide = async (req, number, approve, reason) => {
      const d = await (approve ? callerIdsAdmin.approve(number) : callerIdsAdmin.reject(number))
      if (!d) return false
      await log1(req, approve ? 'caller_id_approve' : 'caller_id_reject', number, reason, { chatId: d.chatId })
      notify.push(d.chatId, approve
        ? `✅ Your caller ID ${number} was approved. You can now show it on your outgoing calls.`
        : `❌ Your caller ID request for ${number} wasn’t approved, so the $${(d.charged || 0).toFixed(2)} was refunded. Reason: ${reason}`).catch(() => {})
      const to = await emailOf(d.chatId).catch(() => null)
      if (to) sendMail(to, approve ? `Your caller ID ${number} is approved` : `Your caller ID ${number} wasn’t approved`, approve
        ? `<p>Good news — <b>${number}</b> is approved as a caller ID on your CloudIVR account.</p><p>Pick it under “Show as” on Quick IVR calls, campaigns, Call me first, text triggers or the browser phone. Calls are still billed from your CloudIVR number, and carriers may still filter some calls.</p>`
        : `<p>We couldn’t approve <b>${number}</b> as your caller ID, so the $${(d.charged || 0).toFixed(2)} was refunded to your wallet.</p><p><b>Reason:</b> ${String(reason).replace(/[<>]/g, '')}</p><p>If this number is yours, reply with proof and we’ll take another look.</p>`).catch(() => {})
      return true
    }
    const cidSwitch = require('./caller-ids')
    r.get('/admin/caller-ids', A, h(async (req, res) => res.json({ enabled: await cidSwitch.loadSwitch(), items: await callerIdsAdmin.list() })))
    r.put('/admin/caller-ids/switch', A, h(async (req, res) => {
      const on = req.body?.enabled === true
      await cidSwitch.setEnabled(on, req.admin.email)
      await log1(req, on ? 'caller_id_switch_on' : 'caller_id_switch_off', 'customCallerId', on ? 'Custom caller IDs turned on' : 'Custom caller IDs turned off', {})
      res.json({ enabled: on })
    }))
    r.post('/admin/caller-ids/bulk', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const approve = req.body?.action === 'approve'
      const numbers = [...new Set((Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(String))].slice(0, 100)
      if (!numbers.length) return bad(res, 400, 'no_numbers', 'Pick at least one request.')
      let done = 0
      for (const n of numbers) if (await decide(req, n, approve, reason)) done++
      res.json({ ok: true, done })
    }))
    r.post('/admin/caller-ids/:number/:action', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      if (await decide(req, String(req.params.number), req.params.action === 'approve', reason)) return res.json({ ok: true })
      bad(res, 404, 'not_found', 'That request is no longer waiting for review.')
    }))
  }
  return { routes }
}

module.exports = { createAdmin }
