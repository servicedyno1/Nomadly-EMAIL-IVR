'use strict'
// Feature suggestions: customers send ideas; the owner (CLOUDIVR_ADMIN_EMAILS) adopts one and gives free wallet credit.
const crypto = require('crypto')
const notify = require('./notify')
const { walletOps, round2 } = require('./wallet')
const { isAdmin } = require('./auth')

const REWARD = () => round2(Number(process.env.SUGGESTION_REWARD_USD) || 10)
const PER_DAY = 5
const pub = (s) => ({ id: s._id, text: s.text, status: s.status, credit: s.credit || 0, reply: s.reply || null, createdAt: s.createdAt, decidedAt: s.decidedAt || null })

function routes(router, { db, h, notifyAdmin = () => {} }) {
  const col = db.collection('webSuggestions')
  col.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const admin = (fn) => h(async (req, res) => (isAdmin(req.webUser) ? fn(req, res) : bad(res, 403, 'admin_only', 'Only the CloudIVR owner can do this.')))

  router.get('/suggestions', h(async (req, res) => {
    res.json({ rewardUsd: REWARD(), suggestions: (await col.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(20).toArray()).map(pub) })
  }))

  router.post('/suggestions', h(async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 2000)
    if (text.length < 10) return bad(res, 400, 'too_short', 'Tell us a bit more (at least 10 characters).')
    if (await col.countDocuments({ chatId: req.webChatId, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= PER_DAY) return bad(res, 429, 'slow_down', `Up to ${PER_DAY} suggestions a day — thank you!`)
    const doc = { _id: crypto.randomUUID(), chatId: req.webChatId, email: req.webUser.email, text, status: 'new', createdAt: new Date() }
    await col.insertOne(doc)
    notifyAdmin(`💡 CloudIVR web suggestion\nfrom: ${req.webUser.email} (${req.webChatId})\n\n${text.slice(0, 1500)}\n\nAdopt it (and give credit) in the web app: Settings → Suggestions inbox.`)
    res.status(201).json({ suggestion: pub(doc) })
  }))

  router.get('/admin/suggestions', admin(async (req, res) => {
    const status = ['new', 'adopted', 'declined'].includes(req.query.status) ? { status: req.query.status } : {}
    const list = await col.find(status).sort({ createdAt: -1 }).limit(100).toArray()
    res.json({ rewardUsd: REWARD(), suggestions: list.map(s => ({ ...pub(s), email: s.email, chatId: s.chatId })) })
  }))

  // Adopt once: credits the author's wallet and tells them in their Inbox.
  router.post('/admin/suggestions/:id/:decision', admin(async (req, res) => {
    const decision = req.params.decision
    if (!['adopt', 'decline'].includes(decision)) return bad(res, 404, 'not_found', 'Unknown action.')
    const credit = decision === 'adopt' ? round2(req.body.credit === undefined ? REWARD() : req.body.credit) : 0
    if (decision === 'adopt' && !(credit >= 0 && credit <= 500)) return bad(res, 400, 'invalid_credit', 'Credit must be between $0 and $500.')
    const reply = String(req.body.reply || '').trim().slice(0, 500) || null
    const r = await col.findOneAndUpdate({ _id: String(req.params.id), status: 'new' }, { $set: { status: decision === 'adopt' ? 'adopted' : 'declined', credit, reply, decidedAt: new Date(), decidedBy: req.webUser.email } }, { returnDocument: 'after' })
    const s = r && r.value !== undefined ? r.value : r
    if (!s) return bad(res, 409, 'already_decided', 'This suggestion was already handled.')
    if (decision === 'adopt' && credit > 0) {
      await walletOps(db).credit(s.chatId, credit)
      await db.collection('transactions').insertOne({ _id: `sugg-${s._id}`, chatId: String(s.chatId), type: 'suggestion-reward', amount: credit, currency: 'USD', status: 'completed', metadata: { suggestion: s._id, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
    }
    const msg = decision === 'adopt'
      ? `We are building your suggestion: "${s.text.slice(0, 80)}${s.text.length > 80 ? '…' : ''}".${credit > 0 ? ` Thank you — $${credit.toFixed(2)} free credit was added to your wallet.` : ''}${reply ? ` ${reply}` : ''}`
      : `Thanks for your suggestion "${s.text.slice(0, 80)}${s.text.length > 80 ? '…' : ''}". We are not adding it right now.${reply ? ` ${reply}` : ''}`
    await notify.push(s.chatId, msg, null, { kind: 'suggestion' }).catch(() => {})
    res.json({ suggestion: pub(s) })
  }))
}

module.exports = { routes, REWARD }
