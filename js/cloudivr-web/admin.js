'use strict'
// CloudIVR admin dashboard API (/admin/*, owner only): overview, users & wallets, Landline-to-Texting queue,
// numbers / campaigns / AI agents, white-label resellers (read-only). Every change needs a reason and is audited.
const multer = require('multer')
const { MongoClient } = require('mongodb')
const { walletOps } = require('./wallet')
const HS = require('../hosted-sms.js')
const aiStore = require('../ai-agent/store')
const notify = require('./notify')

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
    r.get('/admin/overview', A, h(async (req, res) => {
      const now = Date.now(), d30 = new Date(now - 30 * DAY), d1 = new Date(now - DAY)
      const [byType, today, series, botUsers, webUsers, newWeb, numbers, running, hosted, agents] = await Promise.all([
        sumTx(db, d30),
        sumTx(db, d1, ['wallet-topup']),
        db.collection('transactions').aggregate([{ $match: { type: 'wallet-topup', createdAt: { $gt: new Date(now - 14 * DAY) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, usd: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
        db.collection('nameOf').estimatedDocumentCount(),
        db.collection('webAccounts').estimatedDocumentCount(),
        db.collection('webAccounts').countDocuments({ createdAt: { $gt: new Date(now - 7 * DAY) } }),
        db.collection('phoneNumbersOf').aggregate([{ $project: { n: { $size: { $ifNull: ['$val.numbers', []] } } } }, { $group: { _id: null, n: { $sum: '$n' } } }]).toArray(),
        db.collection('bulkCallCampaigns').countDocuments({ status: 'running' }),
        db.collection('hostedSms').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
        db.collection('aiAgents').find({}, { projection: { name: 1, goal: 1, firstMessage: 1, greeting: 1, knowledge: 1 } }).toArray(),
      ])
      const deposits = byType.find(x => x._id === 'wallet-topup')
      const sales = byType.filter(x => !/topup|bonus|credit|refund|overpayment/.test(x._id))
      const refunds = byType.filter(x => /refund/.test(x._id)).reduce((t, x) => t + x.usd, 0)
      res.json({
        deposits30: num(deposits?.usd), depositCount30: deposits?.n || 0, depositsToday: num(today[0]?.usd), sales30: num(sales.reduce((a, x) => a + x.usd, 0)), refunds30: num(refunds), netSales30: num(sales.reduce((a, x) => a + x.usd, 0) - refunds),
        byType: byType.map(x => ({ type: x._id, n: x.n, usd: num(x.usd) })), series: series.map(x => ({ day: x._id, usd: num(x.usd), n: x.n })),
        botUsers, webUsers, newWeb7: newWeb, numbers: numbers[0]?.n || 0, runningCampaigns: running,
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

    // Users: web accounts + bot users (nameOf). q = chat id, email or name.
    r.get('/admin/users', A, h(async (req, res) => {
      const q = String(req.query.q || '').trim()
      let web = [], bot = []
      if (!q) { web = await db.collection('webAccounts').find({}, { projection: { passwordHash: 0, twoFactor: 0 } }).sort({ createdAt: -1 }).limit(25).toArray() }
      else if (/^\d{5,}$/.test(q)) {
        web = await db.collection('webAccounts').find({ _id: Number(q) }, { projection: { passwordHash: 0, twoFactor: 0 } }).toArray()
        bot = await db.collection('nameOf').find({ _id: q }).toArray()
      } else {
        const rx = new RegExp(esc(q), 'i')
        web = await db.collection('webAccounts').find({ $or: [{ email: rx }, { name: rx }] }, { projection: { passwordHash: 0, twoFactor: 0 } }).limit(25).toArray()
        bot = await db.collection('nameOf').find({ val: rx }).limit(25).toArray()
      }
      const ids = [...web.map(x => String(x._id)), ...bot.map(x => String(x._id))]
      const [bal, blocked] = await Promise.all([balanceOf(ids), blockedOf(ids)])
      res.json({ items: [
        ...web.map(a => ({ chatId: String(a._id), kind: 'web', name: a.name || '', email: a.email, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt, balance: bal[String(a._id)] || 0, suspended: !!a.disabled })),
        ...bot.filter(b => !web.some(x => String(x._id) === String(b._id))).map(b => ({ chatId: String(b._id), kind: 'bot', name: b.val || '', email: null, balance: bal[String(b._id)] || 0, suspended: blocked.has(String(b._id)) })),
      ] })
    }))
    r.get('/admin/users/:chatId', A, h(async (req, res) => {
      const id = String(req.params.chatId)
      const [acct, name, wal, tx, nums, camps, hosted, agents, blocked] = await Promise.all([
        /^\d+$/.test(id) ? db.collection('webAccounts').findOne({ _id: Number(id) }, { projection: { passwordHash: 0, twoFactor: 0 } }) : null,
        db.collection('nameOf').findOne({ _id: id }),
        db.collection('walletOf').findOne({ _id: id }),
        db.collection('transactions').find({ chatId: id }).sort({ createdAt: -1 }).limit(60).toArray(),
        db.collection('phoneNumbersOf').findOne({ _id: id }),
        db.collection('bulkCallCampaigns').find({ chatId: id }, { projection: { leads: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
        db.collection('hostedSms').find({ chatId: id }).sort({ createdAt: -1 }).toArray(),
        db.collection('aiAgents').find({ chatId: id }).toArray(),
        db.collection('chatIdBlocked').findOne({ _id: id, val: true }),
      ])
      if (!acct && !name && !wal) return bad(res, 404, 'not_found', 'No user with that id.')
      res.json({
        chatId: id, kind: acct ? 'web' : 'bot', name: acct?.name || name?.val || '', email: acct?.email || null, createdAt: acct?.createdAt || null, lastLoginAt: acct?.lastLoginAt || null,
        suspended: acct ? !!acct.disabled : !!blocked, balance: num((wal?.usdIn || 0) - (wal?.usdOut || 0)), totalIn: num(wal?.usdIn), totalOut: num(wal?.usdOut),
        transactions: tx.map(t => ({ id: String(t._id), type: t.type, amount: num(t.amount), at: t.createdAt, meta: t.metadata || null })),
        numbers: (nums?.val?.numbers || []).map(n => ({ phoneNumber: n.phoneNumber, plan: n.plan, status: n.status || 'active', expiresAt: n.expiresAt, country: n.country })),
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

    // Customer-requested caller IDs waiting for approval (no code — admin vouches; Telnyx still filters the call).
    const callerIdsAdmin = require('./caller-ids').adminApi(db)
    r.get('/admin/caller-ids', A, h(async (req, res) => res.json({ items: await callerIdsAdmin.list() })))
    r.post('/admin/caller-ids/:number/:action', A, h(async (req, res) => {
      const reason = need(req, res); if (!reason) return
      const number = String(req.params.number), approve = req.params.action === 'approve'
      const d = await (approve ? callerIdsAdmin.approve(number) : callerIdsAdmin.reject(number))
      if (!d) return bad(res, 404, 'not_found', 'That request is no longer waiting for review.')
      await log1(req, approve ? 'caller_id_approve' : 'caller_id_reject', number, reason, { chatId: d.chatId })
      notify.push(d.chatId, approve
        ? `✅ Your caller ID ${number} was approved. You can now show it on your outgoing calls.`
        : `❌ Your caller ID request for ${number} wasn’t approved, so the $${(d.charged || 0).toFixed(2)} was refunded. Reason: ${reason}`).catch(() => {})
      res.json({ ok: true })
    }))
  }
  return { routes }
}

module.exports = { createAdmin }
