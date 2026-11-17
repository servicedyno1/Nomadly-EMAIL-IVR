// One-off: tell every bot user the bulk texting daily limit went from 2,000 to 20,000 (run once per brand, env loaded):
//   node scripts/sms_limit_announce.js [--dry]
// Telegram only, user's language, skips blocked/deleted chats; each user recorded in `announcements` so re-runs never resend.
require('dotenv').config()
const axios = require('axios')
const { MongoClient } = require('mongodb')
const DRY = process.argv.includes('--dry')
const ID = 'sms-limit-20k-2026-11'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const MSG = {
  en: '📈 <b>Daily texting limit removed</b>\n\nThe old 2,000-a-day cap is gone — you can now send up to <b>20,000 texts a day</b>.',
  fr: '📈 <b>Limite quotidienne de SMS levée</b>\n\nL’ancienne limite de 2 000 par jour a disparu — vous pouvez maintenant envoyer jusqu’à <b>20 000 SMS par jour</b>.',
  zh: '📈 <b>每日短信上限已取消</b>\n\n原来每天 2,000 条的限制已取消——现在每天最多可发送 <b>20,000 条短信</b>。',
  hi: '📈 <b>रोज़ाना SMS सीमा हटा दी गई</b>\n\nपुरानी 2,000 प्रति दिन की सीमा अब नहीं है — अब आप रोज़ <b>20,000 SMS</b> तक भेज सकते हैं।',
  fa: '📈 <b>محدودیت روزانه پیامک برداشته شد</b>\n\nسقف قبلی ۲٬۰۰۰ در روز حذف شد — اکنون می‌توانید روزانه تا <b>۲۰٬۰۰۰ پیامک</b> بفرستید.',
}
const isWeb = (id) => require('../js/cloudivr-web/notify').isWebChatId(id)

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const sent = db.collection('announcements')
  const once = async (key) => DRY ? !(await sent.findOne({ _id: key })) : (await sent.updateOne({ _id: key }, { $setOnInsert: { at: new Date(), id: ID } }, { upsert: true })).upsertedCount === 1
  const stats = { sent: 0, fail: 0, skip: 0 }
  const token = process.env.TELEGRAM_BOT_TOKEN_PROD
  const dead = new Set((await db.collection('promoOptOut').find({ optedOut: true, reason: { $in: ['chat_not_found', 'user_deactivated', 'bot_blocked'] } }).project({ _id: 1 }).toArray()).map(r => String(r._id)))
  const ids = (await db.collection('nameOf').find({}).project({ _id: 1 }).toArray()).map(u => String(u._id)).filter(id => /^\d+$/.test(id) && !isWeb(id))
  for (const chatId of ids) {
    if (dead.has(chatId) || !(await once(`${ID}:tg:${chatId}`))) { stats.skip++; continue }
    const st = await db.collection('state').findOne({ _id: Number(chatId) }, { projection: { userLanguage: 1 } }) || await db.collection('state').findOne({ _id: chatId }, { projection: { userLanguage: 1 } })
    const lang = MSG[st?.userLanguage] ? st.userLanguage : 'en'
    if (DRY) { stats.sent++; continue }
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: MSG[lang], parse_mode: 'HTML' }, { timeout: 15000 })
      stats.sent++
    } catch (e) {
      stats.fail++
      const d = e.response?.data?.description || e.message
      if (/blocked|deactivated|chat not found/i.test(d)) await db.collection('promoOptOut').updateOne({ _id: chatId }, { $set: { optedOut: true, reason: /blocked/i.test(d) ? 'bot_blocked' : /deactivated/i.test(d) ? 'user_deactivated' : 'chat_not_found', at: new Date() } }, { upsert: true }).catch(() => {})
      if (e.response?.status === 429) await sleep(((e.response.data?.parameters?.retry_after) || 5) * 1000)
    }
    await sleep(60)
  }
  console.log(`[SmsLimit20k] ${process.env.CHAT_BOT_NAME || ''}${DRY ? ' (DRY)' : ''}: ${JSON.stringify(stats)} of ${ids.length} bot users`)
  await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
