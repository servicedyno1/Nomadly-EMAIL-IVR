// Promo copy builder — one tight template for every ad:
//   [coupon line]  ·  emoji + bold hook  ·  3 bullet lines  ·  price line (from config)
// plus a one-tap deep-link button. Keeps every ad < 320 visible chars and ≤ 4 emoji.

const COPY = { en: require('./en.js'), fr: require('./fr.js'), zh: require('./zh.js'), hi: require('./hi.js') }

const THEMES = ['cloudphone', 'antired_hosting', 'leads_validation', 'domains_shortener', 'digital_products', 'cards_bundles', 'email_validation', 'marketplace', 'vps_rdp', 'bulksms_app', 'email_blast', 'refer_earn']

const THEME_META = {
  cloudphone:        { emoji: '📞', hub: 'cloudphone' },
  antired_hosting:   { emoji: '🛡️', hub: 'hosting' },
  leads_validation:  { emoji: '🎯', hub: 'leads' },
  domains_shortener: { emoji: '🌐', hub: 'domains' },
  digital_products:  { emoji: '🛒', hub: 'digital' },
  cards_bundles:     { emoji: '💳', hub: 'vcard' },
  email_validation:  { emoji: '📧', hub: 'emailval' },
  marketplace:       { emoji: '🏪', hub: 'marketplace' },
  vps_rdp:           { emoji: '🖥️', hub: 'vps' },
  bulksms_app:       { emoji: '📱', hub: 'bulksms' },
  email_blast:       { emoji: '✉️', hub: 'emailblast' },
  refer_earn:        { emoji: '🤝', hub: 'refer' },
}

// Owned product → what to cross-sell next (first entry preferred).
const CROSS_SELL = {
  leads_validation:  ['cloudphone', 'bulksms_app'],
  cloudphone:        ['leads_validation', 'digital_products'],
  domains_shortener: ['antired_hosting'],
  antired_hosting:   ['domains_shortener', 'vps_rdp'],
  email_validation:  ['email_blast'],
  email_blast:       ['email_validation', 'vps_rdp'],
  vps_rdp:           ['domains_shortener', 'email_blast'],
  bulksms_app:       ['leads_validation'],
  digital_products:  ['cloudphone'],
  marketplace:       ['refer_earn'],
  cards_bundles:     ['digital_products'],
  refer_earn:        [],
}

const FOOTER = {
  en: 'Unsubscribe: /stoppromos',
  fr: 'Se désabonner : /stoppromos',
  zh: '退订：/stoppromos',
  hi: 'अनसब्सक्राइब: /stoppromos',
}

const MUTE_BUTTON = { en: '🔕 Mute promos', fr: '🔕 Couper les promos', zh: '🔕 停止促销', hi: '🔕 प्रोमो बंद करें' }

function themeEnabled(theme, env = process.env) {
  if (theme === 'vps_rdp') return env.VPS_ENABLED === 'true'
  if (theme === 'bulksms_app') return env.HIDE_SMS_APP !== 'true'
  if (theme === 'email_blast') return env.EMAIL_BLAST_ON === 'true'
  return true
}

function enabledThemes(env = process.env) { return THEMES.filter(t => themeEnabled(t, env)) }

function copyFor(theme, lang) {
  const pack = COPY[lang] || COPY.en
  return pack[theme] || COPY.en[theme]
}

function variantCount(theme, lang, mode = 'hero') {
  const c = copyFor(theme, lang)
  return (mode === 'cross' ? c?.cross : c?.hooks)?.length || 1
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// Assemble the message text. `ai` may override hook/lines (never the price line).
function renderPromo({ theme, lang = 'en', variation = 0, mode = 'hero', prices, couponLine = null, ai = null, footer = true }) {
  const c = copyFor(theme, lang)
  const meta = THEME_META[theme]
  if (!c || !meta) return null
  const hooks = mode === 'cross' && c.cross?.length ? c.cross : c.hooks
  const hook = ai?.hook || hooks[variation % hooks.length]
  const lines = (ai?.lines?.length === 3 ? ai.lines : c.lines(prices)).map(l => `• ${esc(l)}`)
  const price = c.price(prices)
  const parts = []
  if (couponLine) parts.push(couponLine, '')
  parts.push(`${meta.emoji} <b>${esc(hook)}</b>`, ...lines, `💰 ${esc(price)}`)
  if (footer) parts.push('', FOOTER[lang] || FOOTER.en)
  return {
    text: parts.join('\n'),
    buttonLabel: `${meta.emoji} ${c.button} →`,
    hub: meta.hub,
    payload: `open_${meta.hub}`,
  }
}

function deepLink(botUsername, theme) {
  return `https://t.me/${botUsername}?start=open_${THEME_META[theme].hub}`
}

// In-bot inline keyboard: one-tap hub open (callback → synthetic /start open_<hub>) + mute.
function inlineKeyboard(theme, lang, buttonLabel) {
  return {
    inline_keyboard: [
      [{ text: buttonLabel, callback_data: `promo_open:${THEME_META[theme].hub}` }],
      [{ text: MUTE_BUTTON[lang] || MUTE_BUTTON.en, callback_data: 'promo_optout' }],
    ],
  }
}

// Channel / external post: same body, URL button (callbacks don't reach the bot from a channel).
function renderChannelPost({ theme, lang = 'en', variation = 0, prices, couponLine = null, botUsername }) {
  const r = renderPromo({ theme, lang, variation, mode: 'hero', prices, couponLine, footer: false })
  if (!r) return null
  const url = deepLink(botUsername, theme)
  return {
    text: r.text,
    reply_markup: { inline_keyboard: [[{ text: r.buttonLabel, url }]] },
    url,
    buttonLabel: r.buttonLabel,
  }
}

const visibleLength = text => String(text).replace(/<[^>]+>/g, '').length
const emojiCount = text => (String(text).replace(/<[^>]+>/g, '').match(/\p{Extended_Pictographic}/gu) || []).length

// Legacy shape ({ lang: { theme: [text, ...] } }) for anything still reading the old pools.
function legacyPools(prices) {
  const hero = {}, cross = {}
  for (const lang of Object.keys(COPY)) {
    hero[lang] = {}; cross[lang] = {}
    for (const theme of THEMES) {
      hero[lang][theme] = Array.from({ length: variantCount(theme, lang, 'hero') }, (_, i) => renderPromo({ theme, lang, variation: i, mode: 'hero', prices, footer: false }).text)
      cross[lang][theme] = Array.from({ length: variantCount(theme, lang, 'cross') }, (_, i) => renderPromo({ theme, lang, variation: i, mode: 'cross', prices, footer: false }).text)
    }
  }
  return { hero, cross }
}

module.exports = {
  THEMES, THEME_META, CROSS_SELL, FOOTER, MUTE_BUTTON,
  themeEnabled, enabledThemes, copyFor, variantCount,
  renderPromo, renderChannelPost, inlineKeyboard, deepLink,
  visibleLength, emojiCount, legacyPools,
}
