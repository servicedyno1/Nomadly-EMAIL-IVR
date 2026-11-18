'use strict'
// One-off "eSIM now $50/month" announcement, sent automatically once after publishing (each brand's app, own DB):
// every bot user in their language (with the 📱 USA eSIM button), every web account by Inbox note + email.
// Each recipient/channel is recorded in `announcements`, so restarts and other pods never send twice.
const ID = 'esim-50-2026-11'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const MSG = {
  en: '📱 <b>USA eSIM now $50/month</b> (was $75)\n\nA real USA T-Mobile line on your phone: unlimited data, unlimited calls and unlimited texts, two-way SMS. Install it with a QR code in minutes.\n\nExisting eSIMs renew at $50 too.\n\nTap <b>📱 USA eSIM</b> to get yours.',
  fr: '📱 <b>eSIM USA à 50 $/mois</b> (au lieu de 75 $)\n\nUne vraie ligne T-Mobile USA sur votre téléphone : données, appels et SMS illimités, SMS dans les deux sens. Installation par QR code en quelques minutes.\n\nLes eSIM existantes se renouvellent aussi à 50 $.\n\nTouchez <b>📱 eSIM USA</b> pour la vôtre.',
  zh: '📱 <b>美国 eSIM 现价 $50/月</b>（原价 $75）\n\n手机上的真实美国 T-Mobile 线路：无限流量、无限通话、无限短信，支持双向短信。扫二维码几分钟即可安装。\n\n现有 eSIM 也按 $50 续费。\n\n点击 <b>📱 美国 eSIM</b> 立即获取。',
  hi: '📱 <b>USA eSIM अब $50/माह</b> (पहले $75)\n\nआपके फ़ोन पर असली USA T-Mobile लाइन: अनलिमिटेड डेटा, कॉल और SMS, दो-तरफ़ा SMS। QR कोड से कुछ ही मिनटों में इंस्टॉल करें।\n\nमौजूदा eSIM भी $50 पर रिन्यू होंगे।\n\nअपना लेने के लिए <b>📱 USA eSIM</b> दबाएँ।',
  fa: '📱 <b>eSIM آمریکا اکنون ۵۰$ در ماه</b> (قبلاً ۷۵$)\n\nیک خط واقعی T-Mobile آمریکا روی گوشی شما: اینترنت، تماس و پیامک نامحدود، پیامک دوطرفه. نصب با کد QR در چند دقیقه.\n\neSIMهای فعلی هم با ۵۰$ تمدید می‌شوند.\n\nبرای دریافت، <b>📱 eSIM آمریکا</b> را بزنید.',
}
const WEB_TEXT = 'USA eSIM is now $50/month (was $75): a real USA T-Mobile line on your phone with unlimited data, calls and texts. Existing eSIMs renew at $50 too. Get one under eSIM.'
const btn = (lang) => { try { return require(`./lang/${lang}.js`)[lang].user.esimMain } catch (_) { return '📱 USA eSIM' } }

async function run({ db, bot, log = console.log, dry = false, brand = process.env.CHAT_BOT_BRAND || 'CloudIVR' }) {
  if (!(await db.collection('esimPlans').findOne({ _id: 'SPENZA_001', enabled: true }))) return log('[eSIM50] eSIM not sold on this brand — skipped')
  const sent = db.collection('announcements')
  const once = async (key) => dry ? !(await sent.findOne({ _id: key })) : (await sent.updateOne({ _id: key }, { $setOnInsert: { at: new Date(), id: ID } }, { upsert: true })).upsertedCount === 1
  const isWeb = require('./cloudivr-web/notify').isWebChatId
  const stats = { tg: 0, tgFail: 0, skip: 0, web: 0, mail: 0 }
  const dead = new Set((await db.collection('promoOptOut').find({ optedOut: true, reason: { $in: ['chat_not_found', 'user_deactivated', 'bot_blocked'] } }).project({ _id: 1 }).toArray()).map(r => String(r._id)))
  const ids = (await db.collection('nameOf').find({}).project({ _id: 1 }).toArray()).map(u => String(u._id)).filter(id => /^\d+$/.test(id) && !isWeb(id))
  for (const chatId of bot ? ids : []) {
    if (dead.has(chatId) || !(await once(`${ID}:tg:${chatId}`))) { stats.skip++; continue }
    const st = await db.collection('state').findOne({ _id: Number(chatId) }, { projection: { userLanguage: 1 } }) || await db.collection('state').findOne({ _id: chatId }, { projection: { userLanguage: 1 } })
    const lang = MSG[st?.userLanguage] ? st.userLanguage : 'en'
    if (dry) { stats.tg++; continue }
    try { await bot.sendMessage(chatId, MSG[lang], { parse_mode: 'HTML', reply_markup: { keyboard: [[btn(lang)]], resize_keyboard: true, one_time_keyboard: true } }); stats.tg++ } catch (e) {
      stats.tgFail++
      const d = e.response?.body?.description || e.message
      if (/blocked|deactivated|chat not found/i.test(d)) await db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: true, reason: /blocked/i.test(d) ? 'bot_blocked' : /deactivated/i.test(d) ? 'user_deactivated' : 'chat_not_found', at: new Date() } }, { upsert: true }).catch(() => {})
      if (/Too Many Requests|429/.test(d)) await sleep(5000)
    }
    await sleep(60)
  }
  if (process.env.CLOUDIVR_WEB_ON === 'true') {
    for (const a of await db.collection('webAccounts').find({ disabledAt: { $exists: false } }).project({ _id: 1, email: 1, name: 1 }).toArray()) {
      const id = String(a._id)
      if (await once(`${ID}:web:${id}`)) { if (!dry) await require('./cloudivr-web/notify').push(id, WEB_TEXT, null, { kind: 'product' }).catch(() => {}); stats.web++ }
      if (!a.email || !(await once(`${ID}:mail:${id}`))) continue
      if (!dry) await require('./cloudivr-web/auth').sendMail(a.email, 'USA eSIM now $50/month',
        `<p>Hi${a.name ? ` ${String(a.name).split(' ')[0]}` : ''},</p><p>Our <b>USA eSIM</b> is now <b>$50/month</b> (was $75): a real USA T-Mobile line on your phone with unlimited data, unlimited calls and unlimited texts, including two-way SMS. It installs with a QR code in minutes.</p><p>eSIMs you already have renew at $50 too.</p><p>Get one in the app under <b>eSIM</b>.</p><p>— The ${brand} team</p>`).catch(e => log(`[eSIM50] mail ${a.email}: ${e.message}`))
      stats.mail++
      await sleep(200)
    }
  }
  log(`[eSIM50] ${brand}${dry ? ' (DRY RUN)' : ''}: ${JSON.stringify(stats)} of ${ids.length} bot users`)
  return stats
}

// Starts 5 minutes after boot so a publish settles first; one pod only.
function start(deps) {
  if (process.env.ESIM_PRICE_ANNOUNCE === 'false') return
  setTimeout(require('./active-slot').singleton('esim-50-announce', () => run({ ...deps, dry: process.env.WEB_CLOUDIVR_DRY_RUN === 'true' }).catch(e => deps.log?.(`[eSIM50] ${e.message}`))), 5 * 60000).unref?.()
}

module.exports = { run, start, ID }
