// One-off "40+ countries, no ID needed" launch broadcast to every bot user (run from the brand's release dir):
//   node scripts/numbers_launch_announce.js [--dry] [--only=<chatId>]
// In the user's language, with a one-tap "🌍 Get my number" button (deep link → bot number shop).
// Each recipient is recorded in `announcements`, so re-running never sends twice. Skips blocked/deleted chats.
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const DRY = process.argv.includes('--dry')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)
const ID = 'numbers-40-countries-2026-11'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const BTN = { en: '🌍 Get my number', fr: '🌍 Obtenir mon numéro', zh: '🌍 获取我的号码', hi: '🌍 मेरा नंबर लें', fa: '🌍 دریافت شماره من' }
const MSG = {
  en: '🌍 <b>New: numbers in 40+ countries — no ID needed</b>\n\nGet a local, mobile or toll-free number in the UK, Germany, Israel, Australia, Austria, Colombia, New Zealand and 30+ more countries. No ID or document upload — many are ready instantly.\n\nCalls ring straight through to your phone, wherever you are.\n\nTap <b>🌍 Get my number</b> to pick yours.',
  fr: '🌍 <b>Nouveau : des numéros dans plus de 40 pays — sans pièce d’identité</b>\n\nObtenez un numéro local, mobile ou gratuit au Royaume-Uni, en Allemagne, en Israël, en Australie, en Autriche, en Colombie, en Nouvelle-Zélande et dans plus de 30 autres pays. Aucune pièce d’identité ni document à envoyer — beaucoup sont prêts immédiatement.\n\nLes appels sonnent directement sur votre téléphone, où que vous soyez.\n\nTouchez <b>🌍 Obtenir mon numéro</b> pour choisir le vôtre.',
  zh: '🌍 <b>新功能：40+ 个国家的号码 — 无需身份证件</b>\n\n在英国、德国、以色列、澳大利亚、奥地利、哥伦比亚、新西兰等 30 多个国家获取本地、手机或免费号码。无需身份证件或上传文件 — 许多号码即刻可用。\n\n无论您身在何处，来电都会直接转到您的手机。\n\n点击 <b>🌍 获取我的号码</b> 选择您的号码。',
  hi: '🌍 <b>नया: 40+ देशों में नंबर — कोई ID ज़रूरी नहीं</b>\n\nयूके, जर्मनी, इज़राइल, ऑस्ट्रेलिया, ऑस्ट्रिया, कोलंबिया, न्यूज़ीलैंड और 30+ अन्य देशों में लोकल, मोबाइल या टोल-फ़्री नंबर लें। कोई ID या दस्तावेज़ अपलोड नहीं — कई नंबर तुरंत तैयार।\n\nआप कहीं भी हों, कॉल सीधे आपके फ़ोन पर आती हैं।\n\nअपना नंबर चुनने के लिए <b>🌍 मेरा नंबर लें</b> दबाएँ।',
  fa: '🌍 <b>جدید: شماره در بیش از ۴۰ کشور — بدون نیاز به مدرک شناسایی</b>\n\nشماره محلی، موبایل یا رایگان در بریتانیا، آلمان، اسرائیل، استرالیا، اتریش، کلمبیا، نیوزیلند و بیش از ۳۰ کشور دیگر بگیرید. بدون مدرک شناسایی یا آپلود سند — بسیاری فوراً آماده‌اند.\n\nهر کجا باشید، تماس‌ها مستقیم به گوشی شما می‌رسند.\n\nبرای انتخاب، <b>🌍 دریافت شماره من</b> را بزنید.',
}
const isWeb = (id) => require('../js/cloudivr-web/notify').isWebChatId(id)

;(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN_PROD
  const me = (await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 15000 })).data.result
  const link = `https://t.me/${me.username}?start=open_numbers`
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const sent = db.collection('announcements')
  const once = async (key) => DRY ? !(await sent.findOne({ _id: key })) : (await sent.updateOne({ _id: key }, { $setOnInsert: { at: new Date(), id: ID } }, { upsert: true })).upsertedCount === 1
  const stats = { sent: 0, failed: 0, skipped: 0 }
  const dead = new Set((await db.collection('promoOptOut').find({ optedOut: true }).project({ _id: 1 }).toArray()).map(r => String(r._id)))
  const all = (await db.collection('nameOf').find({}).project({ _id: 1 }).toArray()).map(u => String(u._id)).filter(id => /^\d+$/.test(id) && !isWeb(id))
  const ids = ONLY ? [ONLY] : all
  for (const chatId of ids) {
    if (!ONLY && dead.has(chatId)) { stats.skipped++; continue }
    if (!ONLY && !(await once(`${ID}:tg:${chatId}`))) { stats.skipped++; continue }
    const st = await db.collection('state').findOne({ _id: Number(chatId) }, { projection: { userLanguage: 1 } }) || await db.collection('state').findOne({ _id: chatId }, { projection: { userLanguage: 1 } })
    const lang = MSG[st?.userLanguage] ? st.userLanguage : 'en'
    if (DRY) { stats.sent++; continue }
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: MSG[lang], parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: BTN[lang], url: link }]] } }, { timeout: 15000 })
      stats.sent++
    } catch (e) {
      stats.failed++
      const d = e.response?.data?.description || e.message
      if (/blocked|deactivated|chat not found/i.test(d)) await db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: true, reason: /blocked/i.test(d) ? 'bot_blocked' : /deactivated/i.test(d) ? 'user_deactivated' : 'chat_not_found', at: new Date() } }, { upsert: true }).catch(() => {})
      if (e.response?.status === 429) await sleep(((e.response.data?.parameters?.retry_after) || 5) * 1000)
    }
    await sleep(60)
  }
  const summary = `[NumbersLaunch] @${me.username}${DRY ? ' (DRY)' : ''}${ONLY ? ` only=${ONLY}` : ''}: ${JSON.stringify(stats)} of ${ids.length} bot users`
  console.log(summary)
  if (!DRY && !ONLY && process.env.TELEGRAM_ADMIN_CHAT_ID) await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID, text: `📣 Launch broadcast done — ${stats.sent} delivered, ${stats.failed} failed, ${stats.skipped} skipped.` }).catch(() => {})
  await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
