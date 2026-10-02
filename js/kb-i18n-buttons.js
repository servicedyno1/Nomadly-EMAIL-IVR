// Hard-coded (non-dictionary) keyboard labels used across js/_index.js, localized centrally by
// js/kb-i18n.js. Keys are the EXACT English labels the code sends; each is a "PURE" label —
// it is NOT a lang-dict value and is matched incoming only by an English string literal
// (e.g. `message === '⏭ Skip & Call'`). js/tg-opts.js localizes them outbound for fr/zh/hi,
// and js/_index.js canonicalizes the localized press back to English before those handlers run.
//
// Scope (2026-10): targeted high-traffic CUSTOMER flows only — IVR outbound-call setup,
// bulk-campaign scheduling, payment, feedback, URL shortener & marketplace/escrow. Admin-only
// buttons stay English by design and are intentionally absent. Brand/technical tokens
// (CSV/TXT, USD, NGN, SIP, IVR, VPS/RDP, Anti-Red, …) are kept untranslated.
//
// Localized values must be unique and must not collide with a lang-dict value of a DIFFERENT
// English canonical (enforced by tests/kb-i18n.test.js).
module.exports = {
  // ── IVR outbound-call setup / preview ──
  '⏭ Skip & Call':        { fr: '⏭ Ignorer & Appeler',          zh: '⏭ 跳过并呼叫',        hi: '⏭ छोड़ें और कॉल करें' },
  '⏭️ Use Defaults':      { fr: '⏭️ Valeurs par défaut',         zh: '⏭️ 使用默认',          hi: '⏭️ डिफ़ॉल्ट उपयोग करें' },
  '✍️ Custom Script':      { fr: '✍️ Script personnalisé',        zh: '✍️ 自定义脚本',        hi: '✍️ कस्टम स्क्रिप्ट' },
  '✍️ Custom Number':      { fr: '✍️ Numéro personnalisé',        zh: '✍️ 自定义号码',        hi: '✍️ कस्टम नंबर' },
  '✍️ Custom Speed':       { fr: '✍️ Vitesse personnalisée',      zh: '✍️ 自定义语速',        hi: '✍️ कस्टम गति' },
  '✍️ Customize Messages': { fr: '✍️ Personnaliser les messages', zh: '✍️ 自定义消息',        hi: '✍️ संदेश अनुकूलित करें' },
  '✅ Use This Audio':     { fr: '✅ Utiliser cet audio',          zh: '✅ 使用此音频',        hi: '✅ यह ऑडियो उपयोग करें' },
  '🎤 Change Voice':       { fr: '🎤 Changer la voix',            zh: '🎤 更改语音',          hi: '🎤 आवाज़ बदलें' },
  '🎚 Change Speed':       { fr: '🎚 Changer la vitesse',         zh: '🎚 更改语速',          hi: '🎚 गति बदलें' },
  '🔊 Preview (5s)':       { fr: '🔊 Aperçu (5s)',                zh: '🔊 预览 (5秒)',        hi: '🔊 पूर्वावलोकन (5 सेकंड)' },
  '📞 New Call':           { fr: '📞 Nouvel appel',               zh: '📞 新通话',            hi: '📞 नई कॉल' },
  '🔁 Redial Same Number': { fr: '🔁 Rappeler le même numéro',    zh: '🔁 重拨同一号码',      hi: '🔁 वही नंबर फिर डायल करें' },

  // ── Bulk campaign scheduling / launch ──
  '⏰ In 1 hour':          { fr: '⏰ Dans 1 heure',               zh: '⏰ 1 小时后',          hi: '⏰ 1 घंटे में' },
  '⏰ In 3 hours':         { fr: '⏰ Dans 3 heures',              zh: '⏰ 3 小时后',          hi: '⏰ 3 घंटे में' },
  '⏰ In 6 hours':         { fr: '⏰ Dans 6 heures',              zh: '⏰ 6 小时后',          hi: '⏰ 6 घंटे में' },
  '⏰ In 12 hours':        { fr: '⏰ Dans 12 heures',             zh: '⏰ 12 小时后',         hi: '⏰ 12 घंटे में' },
  '⏰ In 24 hours':        { fr: '⏰ Dans 24 heures',             zh: '⏰ 24 小时后',         hi: '⏰ 24 घंटे में' },
  // NB: distinct from SMS-flow dict button t.smsScheduleLater (which is matched by its localized
  // value) so canonicalize never cross-wires the bulk-campaign and SMS schedule flows.
  '⏰ Schedule for later': { fr: '⏰ Programmer plus tard',        zh: '⏰ 稍后安排',          hi: '⏰ बाद में शेड्यूल' },
  '🚀 Launch Campaign':    { fr: '🚀 Lancer la campagne',         zh: '🚀 启动活动',          hi: '🚀 अभियान लॉन्च करें' },
  '❌ Cancel scheduled launch': { fr: '❌ Annuler le lancement programmé', zh: '❌ 取消已安排的启动', hi: '❌ निर्धारित लॉन्च रद्द करें' },
  '📤 Upload List (CSV/TXT)': { fr: '📤 Téléverser la liste (CSV/TXT)', zh: '📤 上传列表 (CSV/TXT)', hi: '📤 सूची अपलोड करें (CSV/TXT)' },
  '📋 Paste Emails':       { fr: '📋 Coller les e-mails',         zh: '📋 粘贴邮箱',          hi: '📋 ईमेल पेस्ट करें' },
  '🔗 Transfer':           { fr: '🔗 Transférer',                 zh: '🔗 转移',              hi: '🔗 स्थानांतरण' },
  '🔗 Transfer + Report':  { fr: '🔗 Transférer + Signaler',      zh: '🔗 转移 + 举报',       hi: '🔗 स्थानांतरण + रिपोर्ट' },

  // ── Payment ──
  '✅ Pay & Send':         { fr: '✅ Payer & Envoyer',            zh: '✅ 支付并发送',        hi: '✅ भुगतान करें और भेजें' },
  '💵 Pay USD':            { fr: '💵 Payer en USD',               zh: '💵 用 USD 支付',       hi: '💵 USD में भुगतान' },
  '💵 Pay NGN':            { fr: '💵 Payer en NGN',               zh: '💵 用 NGN 支付',       hi: '💵 NGN में भुगतान' },
  '✅ Continue to Payment Anyway': { fr: '✅ Continuer vers le paiement quand même', zh: '✅ 仍继续付款', hi: '✅ फिर भी भुगतान जारी रखें' },
  '✅ Looks Good — Continue to Payment': { fr: '✅ Parfait — Continuer vers le paiement', zh: '✅ 没问题 — 继续付款', hi: '✅ ठीक है — भुगतान जारी रखें' },
  '❌ Cancel & Refund':    { fr: '❌ Annuler & Rembourser',       zh: '❌ 取消并退款',        hi: '❌ रद्द करें और रिफंड' },

  // ── Feedback / misc customer prompts ──
  '👍 Yes, helpful':       { fr: '👍 Oui, utile',                 zh: '👍 是的，有帮助',      hi: '👍 हाँ, उपयोगी' },
  '👎 Not helpful':        { fr: '👎 Pas utile',                  zh: '👎 没帮助',            hi: '👎 उपयोगी नहीं' },
  '❌ No Thanks':          { fr: '❌ Non merci',                  zh: '❌ 不用了',            hi: '❌ नहीं धन्यवाद' },
  '📧 Send Test Email':    { fr: '📧 Envoyer un e-mail test',     zh: '📧 发送测试邮件',      hi: '📧 परीक्षण ईमेल भेजें' },
  '📧 Send Another Test':  { fr: '📧 Envoyer un autre test',      zh: '📧 再发送一个测试',    hi: '📧 एक और परीक्षण भेजें' },
  '📧 Try Again':          { fr: '📧 Réessayer',                  zh: '📧 重试',              hi: '📧 पुनः प्रयास करें' },

  // ── URL shortener / marketplace & escrow ──
  '✂️ Shorten Now':        { fr: '✂️ Raccourcir maintenant',      zh: '✂️ 立即缩短',          hi: '✂️ अभी छोटा करें' },
  '✂️ Custom Alias':       { fr: '✂️ Alias personnalisé',         zh: '✂️ 自定义别名',        hi: '✂️ कस्टम उपनाम' },
  '🔒 Start Escrow':       { fr: '🔒 Démarrer l\'entiercement',   zh: '🔒 启动托管',          hi: '🔒 एस्क्रो शुरू करें' },
  '💬 Chat with Seller':   { fr: '💬 Discuter avec le vendeur',    zh: '💬 与卖家聊天',        hi: '💬 विक्रेता से चैट करें' },
}
