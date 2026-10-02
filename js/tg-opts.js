// Telegram send-option hygiene. node-telegram-bot-api's _fixReplyMarkup() REPLACES
// opts.reply_markup with a JSON string IN PLACE, so any shared options object (lang-dict
// entries like trans('chooseSubscription'), module-level `bc`/`o`, …) lost its keyboard
// after the first send: later sends logged no keyboard, resize_keyboard/parse_mode
// injection skipped it, and callers that read .keyboard saw a string. (2026-10-01)

const kbI18n = require('./kb-i18n.js')

function cloneTgOpts(o) {
  if (!o || typeof o !== 'object') return o
  const c = { ...o }
  if (c.reply_markup && typeof c.reply_markup === 'object') c.reply_markup = { ...c.reply_markup }
  else if (typeof c.reply_markup === 'string') { try { c.reply_markup = JSON.parse(c.reply_markup) } catch { /* leave as-is */ } }
  return c
}

const OPTS_INDEX = { sendMessage: 2, sendPhoto: 2, sendDocument: 2, editMessageText: 1, editMessageReplyMarkup: 1 }

function traceLine(m, args, i) {
  const rm = args[i]?.reply_markup || {}
  const chat = i === 1 ? args[1]?.chat_id : args[0]
  const text = m === 'sendMessage' ? args[1] : m === 'editMessageText' ? args[0] : (args[i]?.caption || `<${m}>`)
  return '[tg-out] ' + JSON.stringify({
    chat: String(chat), m, text: typeof text === 'string' ? text : String(text),
    kb: Array.isArray(rm.keyboard) ? rm.keyboard.flat().filter(b => typeof b === 'string' || !(b?.request_contact || b?.request_location)).map(b => (typeof b === 'string' ? b : b?.text)).filter(Boolean) : [],
    inline: Array.isArray(rm.inline_keyboard) ? rm.inline_keyboard.flat().filter(b => b?.text).map(b => ({ t: b.text, d: b.callback_data || null, u: b.url ? 1 : 0 })) : [],
    remove: !!rm.remove_keyboard, force: !!rm.force_reply,
  })
}

// Wrap the bot's send/edit methods: clone options at the boundary so no call site can poison a
// shared object, localize hard-coded keyboard labels for the chat's language (js/kb-i18n.js), and
// (sandbox only) emit one `[tg-out]` JSON line per call for scripts/journey_crawler.js.
// `resolveLang(chatId) → Promise<lang>` warms the language cache on a miss (e.g. scheduler sends).
function wrapBotMethods(bot, { trace = false, log = console.log, resolveLang = null } = {}) {
  for (const [m, i] of Object.entries(OPTS_INDEX)) {
    if (typeof bot[m] !== 'function') continue
    const raw = bot[m].bind(bot)
    bot[m] = (...args) => {
      if (args.length > i) {
        args[i] = cloneTgOpts(args[i])
        const chat = i === 1 ? args[1]?.chat_id : args[0]
        const lang = kbI18n.getChatLang(chat)
        if (lang === undefined && resolveLang && chat != null) {
          Promise.resolve().then(() => resolveLang(String(chat))).then(l => l && kbI18n.setChatLang(chat, l)).catch(() => {})
        } else if (lang && lang !== 'en' && args[i]?.reply_markup && typeof args[i].reply_markup === 'object') {
          args[i].reply_markup = kbI18n.localizeReplyMarkup(args[i].reply_markup, lang)
        }
      }
      if (trace) { try { log(traceLine(m, args, i)) } catch { /* trace must never break sends */ } }
      return raw(...args)
    }
  }
  return bot
}

module.exports = { cloneTgOpts, wrapBotMethods, traceLine }
