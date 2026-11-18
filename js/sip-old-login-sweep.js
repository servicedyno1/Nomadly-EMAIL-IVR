'use strict'
// Old SIP login sweep: a phone app whose last sign-in (past 30 days) used a login that has since been replaced, and whose
// owner hasn't signed in with the current login since → told once per old login: Telegram (bot users) or the in-app
// Inbox (web users), with the current username and a reset-password button. Emails for web users go via cloudivr-web/emails.
const { isWebChatId } = require('./cloudivr-web/notify')
const { loginsOf } = require('./sip-presence')

const DAY = 86400000
const WINDOW_DAYS = 30

async function candidates(db, now = new Date()) {
  const rows = await db.collection('sipPresence').find({ chatId: { $exists: true }, at: { $gt: new Date(now - WINDOW_DAYS * DAY) } }).toArray()
  const out = []
  for (const p of rows) {
    const doc = await db.collection('phoneNumbersOf').findOne({ _id: p.chatId }, { projection: { 'val.numbers': 1 } })
    const num = (doc?.val?.numbers || []).find(n => n.phoneNumber === p.phoneNumber && n.status === 'active')
    if (!num || num.sipDisabled) continue
    const logins = loginsOf(num).filter(Boolean).map(String)
    const current = num.telnyxSipUsername || num.sipUsername
    if (!current || logins.includes(String(p._id))) continue
    const now2 = await db.collection('sipPresence').find({ _id: { $in: logins }, at: { $gte: new Date(p.at) } }).limit(1).toArray()
    if (now2.length) continue // already signed in with a current login after the old one
    out.push({ old: String(p._id), chatId: String(p.chatId), phone: num.phoneNumber, current, lastAt: p.at })
  }
  return out
}

const fmtDay = (d) => new Date(d).toISOString().slice(0, 10)
const L = {
  en: { btn: '🔄 Reset SIP password', text: (c) => `🔑 <b>Your SIP app is using an old login</b>\n\nA phone app last signed in to <code>${c.phone}</code> on ${fmtDay(c.lastAt)} with the username <code>${c.old}</code>. That login was replaced and no longer works, so the app shows "unauthorized" / "not registered" and won't ring.\n\nCurrent username: <code>${c.current}</code>\n\nTap <b>Reset SIP password</b> to get a fresh password for this username, then put both into your app. We never send passwords in messages like this one.` },
  fr: { btn: '🔄 Réinitialiser le mot de passe SIP', text: (c) => `🔑 <b>Votre application SIP utilise un ancien identifiant</b>\n\nUne application s’est connectée pour la dernière fois à <code>${c.phone}</code> le ${fmtDay(c.lastAt)} avec l’identifiant <code>${c.old}</code>. Cet identifiant a été remplacé et ne fonctionne plus : l’application affiche « unauthorized » / « non enregistré » et ne sonne pas.\n\nIdentifiant actuel : <code>${c.current}</code>\n\nAppuyez sur <b>Réinitialiser le mot de passe SIP</b> pour obtenir un nouveau mot de passe pour cet identifiant, puis saisissez les deux dans votre application. Nous n’envoyons jamais de mot de passe dans ce type de message.` },
  zh: { btn: '🔄 重置 SIP 密码', text: (c) => `🔑 <b>您的 SIP 应用正在使用旧账号</b>\n\n一个电话应用最后一次于 ${fmtDay(c.lastAt)} 使用用户名 <code>${c.old}</code> 登录 <code>${c.phone}</code>。该账号已被替换，无法再使用，所以应用显示“unauthorized / 未注册”，来电不会响铃。\n\n当前用户名：<code>${c.current}</code>\n\n点击 <b>重置 SIP 密码</b> 获取此用户名的新密码，然后把两者填入应用。我们绝不会在此类消息中发送密码。` },
  hi: { btn: '🔄 SIP पासवर्ड रीसेट करें', text: (c) => `🔑 <b>आपका SIP ऐप पुराना लॉगिन इस्तेमाल कर रहा है</b>\n\nएक फ़ोन ऐप ने आख़िरी बार ${fmtDay(c.lastAt)} को <code>${c.phone}</code> पर यूज़रनेम <code>${c.old}</code> से साइन इन किया था। वह लॉगिन बदल दिया गया है और अब काम नहीं करता, इसलिए ऐप "unauthorized" / "not registered" दिखाता है और कॉल नहीं बजेगी।\n\nमौजूदा यूज़रनेम: <code>${c.current}</code>\n\nइस यूज़रनेम का नया पासवर्ड पाने के लिए <b>SIP पासवर्ड रीसेट करें</b> दबाएँ, फिर दोनों अपने ऐप में डालें। हम ऐसे संदेशों में कभी पासवर्ड नहीं भेजते।` },
  fa: { btn: '🔄 بازنشانی رمز SIP', text: (c) => `🔑 <b>برنامه SIP شما از ورود قدیمی استفاده می‌کند</b>\n\nیک برنامه تلفن آخرین بار در ${fmtDay(c.lastAt)} با نام کاربری <code>${c.old}</code> به <code>${c.phone}</code> وارد شد. این ورود جایگزین شده و دیگر کار نمی‌کند، بنابراین برنامه «unauthorized / ثبت نشده» نشان می‌دهد و زنگ نمی‌زند.\n\nنام کاربری فعلی: <code>${c.current}</code>\n\nروی <b>بازنشانی رمز SIP</b> بزنید تا رمز تازه‌ای برای این نام کاربری بگیرید، سپس هر دو را در برنامه وارد کنید. ما هرگز در چنین پیام‌هایی رمز نمی‌فرستیم.` },
}
const T = (lang) => L[lang] || L.en

async function run({ db, bot, lang = async () => 'en', log = console.log, now = new Date() }) {
  const notices = db.collection('sipOldLoginNotices')
  let sent = 0
  for (const c of await candidates(db, now)) {
    try {
      try { await notices.insertOne({ _id: c.old, chatId: c.chatId, phoneNumber: c.phone, current: c.current, at: now }) } catch (e) { if (e.code === 11000) continue; throw e }
      if (isWebChatId(c.chatId)) {
        await require('./cloudivr-web/notify').push(c.chatId, L.en.text(c), null, { kind: 'info', meta: { sipReset: c.phone, link: `/app/numbers/${encodeURIComponent(c.phone)}?tab=sip` } })
      } else if (bot) {
        const t = T(await lang(c.chatId))
        await bot.sendMessage(c.chatId, t.text(c), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: t.btn, callback_data: `sipold:${c.phone}` }]] } })?.catch?.(e => log(`[SipOldLogin] send to ${c.chatId}: ${e.message}`))
      }
      sent++
    } catch (e) { log(`[SipOldLogin] ${c.chatId}: ${e.message}`) }
  }
  if (sent) log(`[SipOldLogin] ${sent} old-login notice(s) sent`)
  return sent
}

module.exports = { candidates, run, text: (c, lang) => T(lang).text(c), WINDOW_DAYS }
