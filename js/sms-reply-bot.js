'use strict'
// Telegram: swipe-reply on a forwarded inbound text → text back from the Cloud Phone number that received it
// (same plan quota / overage rules as the web "text back").
async function handle({ bot, db, chatId, msg, message }) {
  const rt = msg?.reply_to_message?.message_id
  if (!rt || !message || message.startsWith('/')) return false
  const th = await db.collection('hostedSmsThreads').findOne({ _id: `${chatId}:${rt}` })
  if (!th || th.hostedId) return false
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const nums = (await db.collection('phoneNumbersOf').findOne({ _id: String(chatId) }))?.val?.numbers || []
  const num = nums.find(n => n.phoneNumber === th.phone && n.status === 'active')
  let r
  if (!num) r = { error: [404, 'not_found', 'That number is no longer active on your account.'] }
  else {
    const { createSmsReply } = require('./cloudivr-web/sms-reply.js')
    r = await createSmsReply({ db, voiceService: require('./voice-service.js') }).send({ chatId: String(chatId), num, to: th.to, text: message })
  }
  await bot.sendMessage(chatId, r.error ? `⚠️ ${esc(r.error[2])}` : `✅ Sent to ${esc(th.to)}${r.charge ? ` · $${Number(r.charge).toFixed(2)}` : ''}`, { parse_mode: 'HTML' }).catch(() => {})
  return true
}

module.exports = { handle }
