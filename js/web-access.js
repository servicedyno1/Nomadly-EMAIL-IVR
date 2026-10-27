/* global process */
// "Prefer the web?" entry point: a top-row menu button + a welcome line pointing bot users to the brand's
// website (WEBSITE_URL in the bot's .env — Nomadly → https://hosta.sh). Unset → nothing is shown.

const LABELS = { en: '🌐 Use on Web', fr: '🌐 Utiliser sur le Web', zh: '🌐 网页版', hi: '🌐 वेब पर इस्तेमाल करें' }
const OPEN = { en: 'Open', fr: 'Ouvrir', zh: '打开', hi: 'खोलें' }

const websiteUrl = (env = process.env) => String(env.WEBSITE_URL || '').trim()
const websiteHost = () => websiteUrl().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
const pick = (map, lang) => map[lang] || map.en

/** Keyboard rows to prepend to the main menu ([] when no website is configured). */
function webMenuRows(lang) {
  return websiteUrl() ? [[pick(LABELS, lang)]] : []
}

function isWebButton(message) {
  return !!websiteUrl() && Object.values(LABELS).includes(message)
}

/** One-line invite appended to the first-start welcome ('' when no website is configured). */
function webWelcomeLine(lang) {
  const url = websiteUrl()
  if (!url) return ''
  const link = `<a href="${url}">${websiteHost()}</a>`
  const line = {
    en: `🌐 <i>Prefer the web? Use ${link}</i>`,
    fr: `🌐 <i>Vous préférez le web ? Utilisez ${link}</i>`,
    zh: `🌐 <i>更喜欢网页版？请使用 ${link}</i>`,
    hi: `🌐 <i>वेब पसंद है? ${link} इस्तेमाल करें</i>`,
  }
  return `\n\n${pick(line, lang)}`
}

/** Reply for the "🌐 Use on Web" button: short invite + an inline button that opens the website. */
function webAccessMessage(lang) {
  const host = websiteHost()
  const text = {
    en: `🌐 <b>Prefer the web?</b>\n\nUse <b>${host}</b> for domains, hosting, VPS and RDP — right from your browser.\n\n👇 Tap below to open it.`,
    fr: `🌐 <b>Vous préférez le web ?</b>\n\nUtilisez <b>${host}</b> pour vos domaines, hébergement, VPS et RDP — directement depuis votre navigateur.\n\n👇 Touchez ci-dessous pour l'ouvrir.`,
    zh: `🌐 <b>更喜欢网页版？</b>\n\n使用 <b>${host}</b>，在浏览器中直接管理域名、主机、VPS 和 RDP。\n\n👇 点击下方按钮打开。`,
    hi: `🌐 <b>वेब पसंद है?</b>\n\nडोमेन, होस्टिंग, VPS और RDP के लिए <b>${host}</b> इस्तेमाल करें — सीधे अपने ब्राउज़र से।\n\n👇 खोलने के लिए नीचे टैप करें।`,
  }
  return {
    text: pick(text, lang),
    opts: {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: `🌐 ${pick(OPEN, lang)} ${host}`, url: websiteUrl() }]] },
    },
  }
}

// ── CloudIVR on the web (cloudivr.net): only where the web app runs on its own domain (Nomadly app-main) ──
const CIVR_LABELS = { en: '🌐 Use CloudIVR on the web', fr: '🌐 CloudIVR sur le web', zh: '🌐 网页版 CloudIVR', hi: '🌐 वेब पर CloudIVR' }
const isNomadly = (env = process.env) => String(env.CHAT_BOT_BRAND || '').trim().toLowerCase() === 'nomadly'
const cloudivrUrl = (env = process.env) => {
  const d = String(env.CLOUDIVR_WEB_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return isNomadly(env) && env.CLOUDIVR_WEB_ON === 'true' && d ? `https://${d}` : ''
}
const cloudivrHost = () => cloudivrUrl().replace(/^https:\/\//, '')

function cloudivrMenuRows(lang) {
  return cloudivrUrl() ? [[pick(CIVR_LABELS, lang)]] : []
}

function isCloudivrWebButton(message) {
  return !!cloudivrUrl() && Object.values(CIVR_LABELS).includes(message)
}

function cloudivrWelcomeLine(lang) {
  const url = cloudivrUrl()
  if (!url) return ''
  const link = `<a href="${url}">${cloudivrHost()}</a>`
  const line = {
    en: `📞 <i>Cloud IVR on the web: ${link}</i>`,
    fr: `📞 <i>Cloud IVR sur le web : ${link}</i>`,
    zh: `📞 <i>网页版 Cloud IVR：${link}</i>`,
    hi: `📞 <i>वेब पर Cloud IVR: ${link}</i>`,
  }
  return `\n\n${pick(line, lang)}`
}

function cloudivrWebMessage(lang) {
  const host = cloudivrHost()
  const text = {
    en: `📞 <b>CloudIVR on the web</b>\n\nRun phone numbers, keypad menus, voicemail, Bulk IVR campaigns and AI voice agents from your browser at <b>${host}</b>.\n\nSign up free with your email — it is a separate account from this bot.\n\n👇 Tap below to open it.`,
    fr: `📞 <b>CloudIVR sur le web</b>\n\nGérez numéros, menus à touches, messagerie, campagnes Bulk IVR et agents vocaux IA depuis votre navigateur sur <b>${host}</b>.\n\nInscription gratuite avec votre e-mail — c'est un compte séparé de ce bot.\n\n👇 Touchez ci-dessous pour l'ouvrir.`,
    zh: `📞 <b>网页版 CloudIVR</b>\n\n在浏览器中打开 <b>${host}</b>，管理电话号码、按键菜单、语音信箱、批量 IVR 活动和 AI 语音助手。\n\n用邮箱免费注册 — 这是独立于本机器人的账户。\n\n👇 点击下方按钮打开。`,
    hi: `📞 <b>वेब पर CloudIVR</b>\n\nफ़ोन नंबर, कीपैड मेन्यू, वॉइसमेल, Bulk IVR कैंपेन और AI वॉइस एजेंट अपने ब्राउज़र से <b>${host}</b> पर चलाएँ।\n\nईमेल से मुफ़्त साइन अप करें — यह इस बॉट से अलग अकाउंट है।\n\n👇 खोलने के लिए नीचे टैप करें।`,
  }
  return {
    text: pick(text, lang),
    opts: {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: `📞 ${pick(OPEN, lang)} ${host}`, url: cloudivrUrl() }]] },
    },
  }
}

module.exports = {
  LABELS, websiteUrl, webMenuRows, isWebButton, webWelcomeLine, webAccessMessage,
  CIVR_LABELS, isNomadly, cloudivrUrl, cloudivrMenuRows, isCloudivrWebButton, cloudivrWelcomeLine, cloudivrWebMessage,
}
