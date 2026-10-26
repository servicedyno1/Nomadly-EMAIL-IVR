'use strict'
// Web accounts reuse the bot's engine with a reserved chatId range (above Telegram's 52-bit user-id space).
// Every bot send to such an id is captured here as an in-app notification instead of hitting Telegram.
const WEB_ID_BASE = 5e15
const { ObjectId } = require('mongodb')
const isWebChatId = (id) => { const n = Number(id); return Number.isFinite(n) && n >= WEB_ID_BASE && n < Number.MAX_SAFE_INTEGER }

let _col = null
function setDb(db) {
  _col = db.collection('webNotifications')
  _col.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  _col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 }).catch(() => {})
}

const strip = (s) => String(s || '')
  .replace(/\/sipguide/g, 'the SIP tab').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()

function kindOf(t) {
  if (/voicemail/i.test(t)) return 'voicemail'
  if (/\bsms\b|message from/i.test(t)) return 'sms'
  if (/wallet|balance|deposit|top.?up|refund/i.test(t)) return 'wallet'
  if (/campaign/i.test(t)) return 'campaign'
  if (/expir|renew|suspend|deleted/i.test(t)) return 'billing'
  if (/call|ivr/i.test(t)) return 'call'
  return 'info'
}

// extra = { kind, meta } for app-made notices (e.g. a coupon the Inbox can apply).
// Bot promos (they all carry the "/stoppromos" footer) never belong in a web inbox — a backstop for any broadcast path.
async function push(chatId, text, mediaUrl = null, extra = null) {
  if (!_col) return
  const clean = strip(text).slice(0, 4000)
  if (!clean && !mediaUrl) return
  if (/\/stoppromos/.test(clean)) return
  await _col.insertOne({ chatId: String(chatId), text: clean, kind: extra?.kind || kindOf(clean), mediaUrl, meta: extra?.meta || null, read: false, createdAt: new Date() })
}

const FAKE = (chatId) => Promise.resolve({ message_id: 0, chat: { id: chatId }, web: true })
const MEDIA = ['sendAudio', 'sendVoice', 'sendDocument', 'sendPhoto', 'sendVideo']
const SILENT = ['sendChatAction', 'deleteMessage', 'pinChatMessage']

function attach(bot) {
  if (!bot || bot.__webNotify) return
  bot.__webNotify = true
  const wrap = (name, handle) => {
    const orig = bot[name]
    if (typeof orig !== 'function') return
    bot[name] = function (chatId, ...args) {
      if (!isWebChatId(chatId)) return orig.call(this, chatId, ...args)
      try { handle(chatId, ...args) } catch (_) { /* never break the caller */ }
      return FAKE(chatId)
    }
  }
  // "Code collected" prompts carry the bot's Confirm / Reject buttons → keep the call id so the Inbox can show Accept / Decline.
  const otpExtra = (opts) => {
    const cb = (opts?.reply_markup?.inline_keyboard || []).flat().map(b => b?.callback_data || '').find(d => d.startsWith('otp_confirm:'))
    return cb ? { kind: 'call', meta: { otp: { callControlId: cb.slice('otp_confirm:'.length) } } } : null
  }
  wrap('sendMessage', (id, text, opts) => { push(id, text, null, otpExtra(opts)).catch(() => {}) })
  for (const m of MEDIA) {
    wrap(m, (id, file, opts) => {
      const url = typeof file === 'string' && /^https?:\/\//.test(file) ? file : null
      push(id, (opts && opts.caption) || m.replace('send', ''), url).catch(() => {})
    })
  }
  for (const m of SILENT) wrap(m, () => {})
  const edit = bot.editMessageText
  if (typeof edit === 'function') {
    bot.editMessageText = function (text, opts = {}, ...rest) {
      if (isWebChatId(opts.chat_id)) return FAKE(opts.chat_id)
      return edit.call(this, text, opts, ...rest)
    }
  }
}

const unreadCounts = async (chatId) => {
  const rows = await _col.aggregate([{ $match: { chatId, read: false } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray()
  const unreadByKind = Object.fromEntries(rows.map(r => [r._id || 'info', r.n]))
  return { unread: rows.reduce((a, r) => a + r.n, 0), unreadByKind }
}

const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g
const digits = (s) => String(s || '').replace(/\D/g, '')
// Where an item leads when tapped: the number's logs (texts, voicemails, calls) or billing, the wallet, campaigns.
function linkOf(n, mine) {
  const found = (n.meta?.to && mine.find(p => digits(p) === digits(n.meta.to)))
    || mine.find(p => (String(n.text).match(PHONE_RE) || []).some(t => digits(t) === digits(p)))
  const num = (tab) => (found ? `/app/numbers/${encodeURIComponent(found)}?tab=${tab}` : '/app/numbers')
  if (n.meta?.otp) return '/app/quick-call'
  switch (n.kind) {
    case 'sms': case 'voicemail': case 'call': return num('logs')
    case 'billing': return num('billing')
    case 'wallet': return '/app/wallet'
    case 'campaign': return n.meta?.campaignId ? `/app/campaigns/${n.meta.campaignId}` : '/app/campaigns'
    default: return null
  }
}

const oid = (s) => { try { return new ObjectId(String(s)) } catch (_) { return null } }

function routes(router, { h, numbersApi, smsReply }) {
  router.get('/notifications', h(async (req, res) => {
    const q = { chatId: req.webChatId, ...(req.query.kind ? { kind: String(req.query.kind) } : {}) }
    const [items, counts, nums] = await Promise.all([
      _col.find(q).sort({ createdAt: -1 }).limit(Math.min(200, parseInt(req.query.limit, 10) || 50)).toArray(),
      unreadCounts(req.webChatId),
      numbersApi.myNumbers(req.webChatId).catch(() => []),
    ])
    const mine = nums.map(n => n.phoneNumber)
    res.json({ ...counts, notifications: items.map(n => ({ id: String(n._id), text: n.text, kind: n.kind, mediaUrl: n.mediaUrl, meta: n.meta || null, read: n.read, createdAt: n.createdAt, link: linkOf(n, mine), canReply: n.kind === 'sms' && !!n.meta?.from && !!n.meta?.to })) })
  }))
  // body { id } marks one item read; { kind } marks only that filter's items read; nothing = everything.
  router.post('/notifications/read', h(async (req, res) => {
    const { kind, id } = req.body || {}
    if (id != null) {
      const _id = oid(id)
      if (!_id) return res.status(404).json({ error: 'not_found', message: 'Message not found.' })
      const r = await _col.updateOne({ _id, chatId: req.webChatId }, { $set: { read: true } })
      return res.json({ marked: r.modifiedCount, ...(await unreadCounts(req.webChatId)) })
    }
    if (kind != null && (typeof kind !== 'string' || !/^[a-z_]{1,20}$/.test(kind))) return res.status(400).json({ error: 'bad_kind' })
    const r = await _col.updateMany({ chatId: req.webChatId, read: false, ...(kind ? { kind } : {}) }, { $set: { read: true } })
    res.json({ marked: r.modifiedCount, ...(await unreadCounts(req.webChatId)) })
  }))
  // Reply to a text right from the inbox: one SMS from the number that received it back to the sender.
  router.post('/notifications/:id/reply', h(async (req, res) => {
    const _id = oid(req.params.id)
    const n = _id && await _col.findOne({ _id, chatId: req.webChatId })
    if (!n) return res.status(404).json({ error: 'not_found', message: 'Message not found.' })
    if (n.kind !== 'sms' || !n.meta?.from || !n.meta?.to) return res.status(400).json({ error: 'cannot_reply', message: 'This message can’t be answered from here. Open the number’s Logs tab.' })
    const num = await numbersApi.findMine(req.webChatId, n.meta.to)
    if (!num) return res.status(404).json({ error: 'not_found', message: 'That number is no longer on your account.' })
    const r = await smsReply.send({ chatId: req.webChatId, num, to: n.meta.from, text: req.body?.text, inboxId: String(_id) })
    if (r.error) return res.status(r.error[0]).json({ error: r.error[1], message: r.error[2] })
    const reply = { text: r.log.body, at: r.log.timestamp, status: r.log.status }
    await _col.updateOne({ _id }, { $set: { 'meta.reply': reply, read: true } })
    res.json({ reply, charge: r.charge })
  }))
}

module.exports = { WEB_ID_BASE, isWebChatId, setDb, attach, push, strip, routes }
