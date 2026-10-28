'use strict'
// Welcome email for Telegram bot users, sent once — the first time they give an email (join step or hosting checkout).
// Uses the brand of THIS bot (CHAT_BOT_BRAND): name, logo, accent, bot link, MAIL_SENDER.
const L = require('./cloudivr-web/email-layout')
const B = require('./sms-app-brand')
const mailer = require('./mailer')

const COPY = {
  en: {
    subject: (b) => `Welcome to ${b} — you're all set`,
    preheader: (b) => `Your ${b} account is ready. Here is what you can do next.`,
    eyebrow: 'Welcome aboard',
    title: (n, b) => (n ? `Welcome to ${b}, ${n}.` : `Welcome to ${b}.`),
    intro: (b) => `Thanks for joining ${b}. Receipts, hosting logins and important account notices will come to this address.`,
    steps: [
      { title: 'Top up your wallet', text: 'Pay with crypto in seconds. Your wallet covers every order and renewal.' },
      { title: 'Pick what you need', text: 'Phone numbers & IVR, hosting, domains and digital products — all from the bot menu.' },
      { title: 'Get help anytime', text: 'Message support right inside the bot. Real people, fast answers.' },
    ],
    cta: (b) => `Open ${b} bot`,
    why: (b) => `You're getting this because this address was added to a ${b} account on Telegram.`,
    support: 'Message support',
  },
  fr: {
    subject: (b) => `Bienvenue sur ${b} — tout est prêt`,
    preheader: (b) => `Votre compte ${b} est prêt. Voici la suite.`,
    eyebrow: 'Bienvenue',
    title: (n, b) => (n ? `Bienvenue sur ${b}, ${n}.` : `Bienvenue sur ${b}.`),
    intro: (b) => `Merci d'avoir rejoint ${b}. Reçus, identifiants d'hébergement et avis importants arriveront à cette adresse.`,
    steps: [
      { title: 'Rechargez votre portefeuille', text: 'Payez en crypto en quelques secondes. Le portefeuille couvre commandes et renouvellements.' },
      { title: 'Choisissez votre service', text: 'Numéros & IVR, hébergement, domaines et produits numériques — depuis le menu du bot.' },
      { title: "De l'aide à tout moment", text: 'Écrivez au support directement dans le bot. De vraies personnes, des réponses rapides.' },
    ],
    cta: (b) => `Ouvrir le bot ${b}`,
    why: (b) => `Vous recevez ceci car cette adresse a été ajoutée à un compte ${b} sur Telegram.`,
    support: 'Contacter le support',
  },
  zh: {
    subject: (b) => `欢迎使用 ${b} — 一切就绪`,
    preheader: (b) => `您的 ${b} 账户已就绪。接下来可以这样做。`,
    eyebrow: '欢迎加入',
    title: (n, b) => (n ? `欢迎使用 ${b}，${n}。` : `欢迎使用 ${b}。`),
    intro: (b) => `感谢加入 ${b}。收据、主机登录信息和重要账户通知将发送到此邮箱。`,
    steps: [
      { title: '为钱包充值', text: '几秒钟即可用加密货币支付。钱包可支付所有订单和续费。' },
      { title: '选择所需服务', text: '电话号码和 IVR、主机、域名和数字产品 — 全部在机器人菜单中。' },
      { title: '随时获得帮助', text: '直接在机器人中联系客服。真人服务，快速回复。' },
    ],
    cta: (b) => `打开 ${b} 机器人`,
    why: (b) => `您收到此邮件是因为此邮箱已添加到 Telegram 上的 ${b} 账户。`,
    support: '联系客服',
  },
  hi: {
    subject: (b) => `${b} में आपका स्वागत है — सब तैयार है`,
    preheader: (b) => `आपका ${b} खाता तैयार है। आगे क्या करें, यहाँ देखें।`,
    eyebrow: 'स्वागत है',
    title: (n, b) => (n ? `${b} में आपका स्वागत है, ${n}।` : `${b} में आपका स्वागत है।`),
    intro: (b) => `${b} से जुड़ने के लिए धन्यवाद। रसीदें, होस्टिंग लॉगिन और ज़रूरी खाता सूचनाएँ इसी पते पर आएँगी।`,
    steps: [
      { title: 'वॉलेट टॉप अप करें', text: 'सेकंडों में क्रिप्टो से भुगतान करें। वॉलेट हर ऑर्डर और रिन्यूअल कवर करता है।' },
      { title: 'अपनी ज़रूरत चुनें', text: 'फ़ोन नंबर और IVR, होस्टिंग, डोमेन और डिजिटल प्रोडक्ट — सब बॉट मेनू में।' },
      { title: 'कभी भी मदद पाएँ', text: 'बॉट में ही सपोर्ट को मैसेज करें। असली लोग, तेज़ जवाब।' },
    ],
    cta: (b) => `${b} बॉट खोलें`,
    why: (b) => `आपको यह इसलिए मिला क्योंकि यह पता Telegram पर एक ${b} खाते में जोड़ा गया था।`,
    support: 'सपोर्ट से बात करें',
  },
}

function siteBase() {
  const d = String(process.env.PANEL_DOMAIN || '').trim().replace(/^https?:\/\//, '').split('/')[0]
  return d ? `https://${d}` : String(process.env.SELF_URL_PROD || '').replace(/\/api\/?$/, '').replace(/\/+$/, '')
}

function build({ name, lang } = {}) {
  const c = COPY[lang] || COPY.en
  const brand = B.brandName(), base = siteBase(), accent = B.accent()
  const t = { fg: accent, bg: `${accent}1f`, glow: accent }
  const support = process.env.APP_SUPPORT_LINK
  const body = L.p(L.esc(c.intro(brand))) + L.steps(c.steps, t) + L.button(c.cta(brand), B.botUrl(), t)
  const html = L.layout({
    lang: COPY[lang] ? lang : 'en', preheader: c.preheader(brand), eyebrow: c.eyebrow, title: c.title(name, brand), t, body,
    brand: { name: brand, logo: base ? `${base}/assets/brand/${B.brandSlug()}/logo.png` : null, href: B.botUrl() },
    foot: { why: c.why(brand), support: support ? [c.support, support] : null },
  })
  return { subject: c.subject(brand), html }
}

async function sendBotWelcome(to, opts) {
  const { subject, html } = build(opts)
  return mailer.send({ from: { name: B.brandName(), address: process.env.MAIL_SENDER }, to, subject, html })
}

module.exports = { build, sendBotWelcome }
