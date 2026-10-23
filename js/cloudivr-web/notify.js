'use strict'
// Web accounts reuse the bot's engine with a reserved chatId range (above Telegram's 52-bit user-id space).
// Every bot send to such an id is captured here as an in-app notification instead of hitting Telegram.
const WEB_ID_BASE = 5e15
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
async function push(chatId, text, mediaUrl = null, extra = null) {
  if (!_col) return
  const clean = strip(text).slice(0, 4000)
  if (!clean && !mediaUrl) return
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
  wrap('sendMessage', (id, text) => { push(id, text).catch(() => {}) })
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

function routes(router, { h }) {
  router.get('/notifications', h(async (req, res) => {
    const q = { chatId: req.webChatId, ...(req.query.kind ? { kind: String(req.query.kind) } : {}) }
    const [items, unread] = await Promise.all([
      _col.find(q).sort({ createdAt: -1 }).limit(Math.min(200, parseInt(req.query.limit, 10) || 50)).toArray(),
      _col.countDocuments({ chatId: req.webChatId, read: false }),
    ])
    res.json({ unread, notifications: items.map(n => ({ id: String(n._id), text: n.text, kind: n.kind, mediaUrl: n.mediaUrl, meta: n.meta || null, read: n.read, createdAt: n.createdAt })) })
  }))
  router.post('/notifications/read', h(async (req, res) => {
    await _col.updateMany({ chatId: req.webChatId, read: false }, { $set: { read: true } })
    res.json({ unread: 0 })
  }))
}

module.exports = { WEB_ID_BASE, isWebChatId, setDb, attach, push, strip, routes }
