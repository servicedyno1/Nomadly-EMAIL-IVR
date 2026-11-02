'use strict'
// Saved text templates: one list per account, usable from any number in Messages (max 50, each up to 3 joined texts).
const crypto = require('crypto')
const { smsTooLong, gsmText } = require('./sms-limit')

const MAX = 50

function routes(r, { db, h }) {
  const col = db.collection('webTextTemplates')
  col.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  const pub = (t) => ({ id: t._id, text: t.text, createdAt: t.createdAt })
  const bad = (res, error, message, status = 400) => res.status(status).json({ error, message })

  r.get('/messages/templates', h(async (req, res) => {
    res.json({ items: (await col.find({ chatId: String(req.webChatId) }).sort({ createdAt: -1 }).limit(MAX).toArray()).map(pub) })
  }))
  r.post('/messages/templates', h(async (req, res) => {
    const text = gsmText(String(req.body.text || '').replace(/[^\S\n]+/g, ' ').trim())
    if (!text) return bad(res, 'empty', 'Write the text first.')
    const long = smsTooLong(text)
    if (long) return bad(res, 'too_long', long)
    const chatId = String(req.webChatId)
    if (await col.findOne({ chatId, text })) return bad(res, 'duplicate', 'You already saved this text.', 409)
    if ((await col.countDocuments({ chatId })) >= MAX) return bad(res, 'limit', `You can save up to ${MAX} templates. Delete one first.`)
    const doc = { _id: `tpl_${crypto.randomBytes(6).toString('hex')}`, chatId, text, createdAt: new Date() }
    await col.insertOne(doc)
    res.json({ item: pub(doc) })
  }))
  r.delete('/messages/templates/:id', h(async (req, res) => {
    const d = await col.deleteOne({ _id: String(req.params.id), chatId: String(req.webChatId) })
    if (!d.deletedCount) return bad(res, 'not_found', 'Template not found.', 404)
    res.json({ ok: true })
  }))
}

module.exports = { routes }
