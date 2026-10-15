/* global process */
// "Prefer the web?" entry point: a top-row menu button + a welcome line pointing bot users to the brand's
// website (WEBSITE_URL in the bot's .env — Nomadly → https://hosta.sh). Unset → nothing is shown.

const LABELS = { en: '🌐 Use on Web', fr: '🌐 Utiliser sur le Web', zh: '🌐 网页版', hi: '🌐 वेब पर इस्तेमाल करें' }
const OPEN = { en: 'Open', fr: 'Ouvrir', zh: '打开', hi: 'खोलें' }

const websiteUrl = () => String(process.env.WEBSITE_URL || '').trim()
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

module.exports = { LABELS, websiteUrl, webMenuRows, isWebButton, webWelcomeLine, webAccessMessage }
