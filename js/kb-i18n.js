// Central keyboard-button localization (2026-10). Hundreds of call sites hard-code English
// labels like '↩️ Back' / '❌ Cancel' / '🏠 Main Menu' in reply keyboards. Instead of editing
// every site, js/tg-opts.js localizes outgoing keyboards here using a chatId→language cache
// that the message/callback handlers keep fresh.
//
// GENERIC labels are outbound-only: incoming presses are matched by isBackPress /
// isCancelPress / isMainMenuPress in _index.js (they accept every locale variant).
// BUTTONS (hard-coded feature labels) are localized outbound AND mapped back to the English
// canonical on the way in (`canonicalizeIncoming`), so `message === '🔗 Transfer'` style handlers
// keep working. Their localized values must never collide with a lang-dict value — see
// tests/kb-i18n.test.js.

const LANGS = ['fr', 'zh', 'hi']

const BACK = { fr: 'Retour', zh: '返回', hi: 'वापस' }
const CANCEL = { fr: 'Annuler', zh: '取消', hi: 'रद्द करें' }
const MAIN_MENU = { fr: 'Menu principal', zh: '主菜单', hi: 'मुख्य मेनू' }
const withEmoji = (emoji, m) => Object.fromEntries(LANGS.map(l => [l, emoji ? `${emoji} ${m[l]}` : m[l]]))

const GENERIC = {
  '↩️ Back': withEmoji('↩️', BACK),
  '🔙 Back': withEmoji('🔙', BACK),
  '⬅️ Back': withEmoji('⬅️', BACK),
  'Back': withEmoji('', BACK),
  '❌ Cancel': withEmoji('❌', CANCEL),
  'Cancel': withEmoji('', CANCEL),
  '🏠 Main Menu': withEmoji('🏠', MAIN_MENU),
}

const BUTTONS = require('./kb-i18n-buttons.js')

const OUT = { ...GENERIC, ...BUTTONS }

// lang → localized label → English canonical (BUTTONS only)
const IN = Object.fromEntries(LANGS.map(l => [l, new Map()]))
for (const [en, tr] of Object.entries(BUTTONS)) {
  for (const l of LANGS) if (tr[l] && tr[l] !== en) IN[l].set(tr[l], en)
}

const chatLang = new Map()
const MAX_CACHE = 50000
function setChatLang(chatId, lang) {
  if (chatId == null) return
  const id = String(chatId)
  const l = LANGS.includes(lang) ? lang : 'en'
  if (chatLang.size >= MAX_CACHE && !chatLang.has(id)) chatLang.delete(chatLang.keys().next().value)
  chatLang.set(id, l)
}
const getChatLang = chatId => (chatId == null ? undefined : chatLang.get(String(chatId)))

function localizeLabel(label, lang) {
  return (typeof label === 'string' && OUT[label]?.[lang]) || label
}

function localizeButton(b, lang) {
  if (typeof b === 'string') return localizeLabel(b, lang)
  if (b && typeof b === 'object' && typeof b.text === 'string') {
    const t = localizeLabel(b.text, lang)
    return t === b.text ? b : { ...b, text: t }
  }
  return b
}

// Returns a NEW reply_markup with localized button labels (never mutates the input).
function localizeReplyMarkup(rm, lang) {
  if (!rm || typeof rm !== 'object' || !LANGS.includes(lang)) return rm
  const out = { ...rm }
  if (Array.isArray(rm.keyboard)) out.keyboard = rm.keyboard.map(row => (Array.isArray(row) ? row.map(b => localizeButton(b, lang)) : row))
  if (Array.isArray(rm.inline_keyboard)) out.inline_keyboard = rm.inline_keyboard.map(row => (Array.isArray(row) ? row.map(b => localizeButton(b, lang)) : row))
  return out
}

// Localized hard-coded feature label → English canonical (so literal handlers still match).
function canonicalizeIncoming(text, lang) {
  if (typeof text !== 'string' || !LANGS.includes(lang)) return text
  return IN[lang].get(text.trim()) || text
}

module.exports = { LANGS, GENERIC, BUTTONS, setChatLang, getChatLang, localizeReplyMarkup, canonicalizeIncoming, localizeLabel }
