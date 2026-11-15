// One-off fax number launch announcement (run once per brand from its release dir, env loaded):
//   node scripts/fax_launch_announce.js [--dry]
// Telegram: every bot user (skips blocked/deleted chats), in their language, with a "📠 Fax Numbers" button.
// Main brand also: web app notice for every web account + email to web customers who opted in to product news.
// Each recipient/channel is recorded in `announcements`, so re-running never sends twice. No provider names.
require('dotenv').config()
const axios = require('axios')
const { MongoClient } = require('mongodb')
const DRY = process.argv.includes('--dry')
const ID = 'fax-launch-2026-11'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const BTN = { en: '📠 Fax Numbers', fr: '📠 Numéros de fax', zh: '📠 传真号码', hi: '📠 फैक्स नंबर', fa: '📠 شماره فکس' }
const MSG = {
  en: '📠 <b>New: fax numbers in 15+ countries</b>\n\nGet a fax-only number in the USA, Canada, UK, Germany, France, Italy, the Netherlands, Australia and more. Send and receive faxes right here in the chat — received faxes arrive as PDFs.\n\n💰 <b>$50/month</b> · first <b>25 pages free</b> every month, then $0.05 a page.\n\nTap <b>📠 Fax Numbers</b> to pick yours.',
  fr: '📠 <b>Nouveau : numéros de fax dans plus de 15 pays</b>\n\nObtenez un numéro fax uniquement aux États-Unis, au Canada, au Royaume-Uni, en Allemagne, en France, en Italie, aux Pays-Bas, en Australie et plus. Envoyez et recevez des fax directement ici — les fax reçus arrivent en PDF.\n\n💰 <b>50 $/mois</b> · <b>25 pages gratuites</b> chaque mois, puis 0,05 $ la page.\n\nTouchez <b>📠 Numéros de fax</b> pour choisir le vôtre.',
  zh: '📠 <b>新功能：15+ 个国家的传真号码</b>\n\n在美国、加拿大、英国、德国、法国、意大利、荷兰、澳大利亚等地获取纯传真号码。直接在聊天中收发传真——收到的传真以 PDF 发送给您。\n\n💰 <b>$50/月</b> · 每月前 <b>25 页免费</b>，之后每页 $0.05。\n\n点击 <b>📠 传真号码</b> 选择您的号码。',
  hi: '📠 <b>नया: 15+ देशों में फैक्स नंबर</b>\n\nअमेरिका, कनाडा, यूके, जर्मनी, फ्रांस, इटली, नीदरलैंड, ऑस्ट्रेलिया और अन्य देशों में फैक्स-केवल नंबर लें। यहीं चैट में फैक्स भेजें और पाएँ — प्राप्त फैक्स PDF में आते हैं।\n\n💰 <b>$50/माह</b> · हर माह पहले <b>25 पेज मुफ्त</b>, फिर $0.05 प्रति पेज।\n\nअपना नंबर चुनने के लिए <b>📠 फैक्स नंबर</b> दबाएँ।',
  fa: '📠 <b>جدید: شماره فکس در بیش از ۱۵ کشور</b>\n\nدر آمریکا، کانادا، بریتانیا، آلمان، فرانسه، ایتالیا، هلند، استرالیا و کشورهای دیگر شماره فقط‌فکس بگیرید. فکس را همین‌جا در چت بفرستید و بگیرید — فکس‌های دریافتی به صورت PDF می‌آیند.\n\n💰 <b>۵۰$ در ماه</b> · <b>۲۵ صفحه اول رایگان</b> در هر ماه، سپس ۰٫۰۵$ برای هر صفحه.\n\nبرای انتخاب، <b>📠 شماره فکس</b> را بزنید.',
}
const WEB_TEXT = 'New: fax numbers in 15+ countries — USA, Canada, UK, Germany, France, Italy, the Netherlands, Australia and more. $50/month with the first 25 pages free every month, then $0.05 a page. Get one under Get a number → Fax.'
const isWeb = (id) => require('../js/cloudivr-web/notify').isWebChatId(id)

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const sent = db.collection('announcements'), brand = process.env.CHAT_BOT_BRAND || 'CloudIVR'
  const once = async (key) => DRY ? !(await sent.findOne({ _id: key })) : (await sent.updateOne({ _id: key }, { $setOnInsert: { at: new Date(), id: ID } }, { upsert: true })).upsertedCount === 1
  const stats = { tg: 0, tgFail: 0, tgSkip: 0, web: 0, mail: 0 }
  const token = process.env.TELEGRAM_BOT_TOKEN_PROD
  const dead = new Set((await db.collection('promoOptOut').find({ optedOut: true, reason: { $in: ['chat_not_found', 'user_deactivated', 'bot_blocked'] } }).project({ _id: 1 }).toArray()).map(r => String(r._id)))
  const ids = (await db.collection('nameOf').find({}).project({ _id: 1 }).toArray()).map(u => String(u._id)).filter(id => /^-?\d+$/.test(id) && !id.startsWith('-') && !isWeb(id))
  for (const chatId of ids) {
    if (dead.has(chatId)) { stats.tgSkip++; continue }
    if (!(await once(`${ID}:tg:${chatId}`))) { stats.tgSkip++; continue }
    const st = await db.collection('state').findOne({ _id: Number(chatId) }, { projection: { userLanguage: 1 } }) || await db.collection('state').findOne({ _id: chatId }, { projection: { userLanguage: 1 } })
    const lang = MSG[st?.userLanguage] ? st.userLanguage : 'en'
    if (DRY) { stats.tg++; continue }
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: MSG[lang], parse_mode: 'HTML', reply_markup: { keyboard: [[BTN[lang]]], resize_keyboard: true, one_time_keyboard: true } }, { timeout: 15000 })
      stats.tg++
    } catch (e) {
      stats.tgFail++
      const d = e.response?.data?.description || e.message
      if (/blocked|deactivated|chat not found/i.test(d)) await db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: true, reason: /blocked/i.test(d) ? 'bot_blocked' : /deactivated/i.test(d) ? 'user_deactivated' : 'chat_not_found', at: new Date() } }, { upsert: true }).catch(() => {})
      if (e.response?.status === 429) await sleep(((e.response.data?.parameters?.retry_after) || 5) * 1000)
    }
    await sleep(60)
  }
  if (process.env.CLOUDIVR_WEB_ON === 'true') {
    const accs = await db.collection('webAccounts').find({ disabledAt: { $exists: false } }).project({ _id: 1, email: 1, name: 1 }).toArray()
    const prefs = new Map((await db.collection('webPrefs').find({}).project({ emailPrefs: 1 }).toArray()).map(p => [String(p._id), p.emailPrefs || {}]))
    const from = process.env.CLOUDIVR_MAIL_SENDER || process.env.MAIL_SENDER
    for (const a of accs) {
      const id = String(a._id)
      if (await once(`${ID}:web:${id}`)) { if (!DRY) await db.collection('webNotifications').insertOne({ chatId: id, text: WEB_TEXT, kind: 'product', mediaUrl: null, meta: null, read: false, createdAt: new Date() }); stats.web++ }
      if (!a.email || prefs.get(id)?.marketing !== true || !from) continue
      if (!(await once(`${ID}:mail:${id}`))) continue
      if (!DRY) await require('../js/mailer').send({ from: { name: brand, email: from }, to: a.email, subject: 'New: fax numbers in 15+ countries',
        html: `<p>Hi${a.name ? ` ${String(a.name).split(' ')[0]}` : ''},</p><p>You can now get a <b>fax-only number</b> in the USA, Canada, UK, Germany, France, Italy, the Netherlands, Australia and more — and send and receive faxes online.</p><p><b>$50/month</b>, with the first <b>25 pages free</b> every month, then $0.05 a page.</p><p>Get one in the app under <b>Get a number → Fax</b>.</p><p>— The ${brand} team</p><p style="font-size:12px;color:#888">You get this because you opted in to product news. You can turn it off in Settings → Email.</p>` }).catch(e => console.error('mail', a.email, e.message))
      stats.mail++
    }
  }
  console.log(`[FaxLaunch] ${brand}${DRY ? ' (DRY)' : ''}: ${JSON.stringify(stats)} of ${ids.length} bot users`)
  await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
