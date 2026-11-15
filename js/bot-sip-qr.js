// Bot "📲 QR Setup": one photo at a time with a button to switch between the Linphone and other-apps code.
const QR = require('qrcode')
const T = {
  en: { l: '<b>Linphone</b>: open Linphone → Account assistant → <b>Fetch remote configuration</b> / scan QR code. Your account is filled in for you.', g: '<b>Other apps</b> (Zoiper, Groundwire, Acrobits…): scan this if the app offers QR setup; otherwise type the details from 👁️ Reveal Password.', n: (m) => `⏱ This code includes your password and is deleted in 2 minutes. The Linphone code works for ${m} minutes.`, toG: '📷 Code for other apps', toL: '📷 Code for Linphone' },
  fr: { l: '<b>Linphone</b> : ouvrez Linphone → Assistant de compte → <b>Configuration distante</b> / scanner le QR code. Votre compte est rempli automatiquement.', g: '<b>Autres applis</b> (Zoiper, Groundwire, Acrobits…) : scannez-le si l\'appli propose la config. par QR ; sinon saisissez les infos de 👁️ Révéler le mot de passe.', n: (m) => `⏱ Ce code contient votre mot de passe et est supprimé dans 2 minutes. Le code Linphone marche ${m} minutes.`, toG: '📷 Code pour autres applis', toL: '📷 Code pour Linphone' },
  zh: { l: '<b>Linphone</b>：打开 Linphone → 账户助手 → <b>获取远程配置</b>/扫描二维码，账户会自动填好。', g: '<b>其他应用</b>（Zoiper、Groundwire、Acrobits…）：若应用支持扫码设置请扫描；否则请使用 👁️ 显示密码 中的信息手动填写。', n: (m) => `⏱ 二维码含有您的密码，2 分钟后删除。Linphone 二维码 ${m} 分钟内有效。`, toG: '📷 其他应用的二维码', toL: '📷 Linphone 二维码' },
  hi: { l: '<b>Linphone</b>: Linphone खोलें → Account assistant → <b>Fetch remote configuration</b> / QR स्कैन करें। आपका खाता अपने-आप भर जाएगा।', g: '<b>दूसरे ऐप</b> (Zoiper, Groundwire, Acrobits…): अगर ऐप QR सेटअप देता है तो स्कैन करें; नहीं तो 👁️ पासवर्ड दिखाएं से जानकारी भरें।', n: (m) => `⏱ इस कोड में आपका पासवर्ड है, यह 2 मिनट में हट जाएगा। Linphone कोड ${m} मिनट चलता है।`, toG: '📷 दूसरे ऐप का कोड', toL: '📷 Linphone कोड' },
  fa: { l: '<b>Linphone</b>: Linphone را باز کنید ← Account assistant ← <b>Fetch remote configuration</b> / اسکن QR. حساب شما خودکار پر می‌شود.', g: '<b>برنامه‌های دیگر</b> (Zoiper، Groundwire، Acrobits…): اگر برنامه تنظیم با QR دارد اسکن کنید؛ وگرنه اطلاعات را از 👁️ نمایش رمز عبور وارد کنید.', n: (m) => `⏱ این کد رمز شما را دارد و پس از ۲ دقیقه حذف می‌شود. کد Linphone تا ${m} دقیقه کار می‌کند.`, toG: '📷 کد برای برنامه‌های دیگر', toL: '📷 کد برای Linphone' },
}

// which: 'l' (Linphone) or 'g' (other apps). replaceId: the QR message being switched (deleted first).
async function send({ bot, db, phoneNumbersOf, chatId, phone, domain, lang, which = 'l', replaceId, log = console.log }) {
  const t = T[lang] || T.en
  const n = (await phoneNumbersOf.findOne({ _id: chatId }))?.val?.numbers?.find(x => x.phoneNumber === phone)
  if (!n) return false
  await require('./sip-logins').ensure(phoneNumbersOf, chatId, n)
  const c = await require('./sip-provision').codes(db, chatId, n, domain)
  if (replaceId) await bot.deleteMessage(chatId, replaceId).catch(() => {})
  const png = await QR.toBuffer(which === 'g' ? c.generic : c.linphone, { width: 480, margin: 2 })
  const caption = `${which === 'g' ? t.g : t.l}\n\n${t.n(c.expiresInMin)}`
  const m = await bot.sendPhoto(chatId, png, { caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: which === 'g' ? t.toL : t.toG, callback_data: `sipqr:${which === 'g' ? 'l' : 'g'}` }]] } }, { filename: 'sip-qr.png', contentType: 'image/png' })
    .catch(e => { log(`[SipQr] send failed: ${e.message}`); return null })
  if (m?.message_id) setTimeout(() => bot.deleteMessage(chatId, m.message_id).catch(() => {}), 120000)
  return !!m
}

module.exports = { send, T }
