'use strict'
// The first question when buying a number in the bot: what is it for? Same three kinds as the web app.
const L = {
  en: {
    textingOn: '💬 Turn on texting', textingOnDone: '✅ Texting is on for this number. You pay per text sent; receiving is free.',
    ask: '🛒 <b>What is the number for?</b>\n\n📞 <b>Calls</b> — answer, forward, menus, voicemail. Texting can be added later where the number supports it.\n💬 <b>Calls + texting</b> — two-way texts and calls on one number. You pay per text sent.\n📠 <b>Fax only</b> — sends and receives faxes. No calls or texts.',
    calls: '📞 Calls', texting: '💬 Calls + texting', fax: '📠 Fax only',
    pickCountry: (price) => `💬 <b>Calls + texting</b>\n\nPick a country. $${price}/month, plus a small fee per text you send. Receiving is free. No ID needed.`,
    none: '💬 Calls + texting numbers are not available right now. Please try again later, or pick Calls.',
    plansExtra: (texting, fax = true) => `${texting ? '\n💬 <b>Calls + texting</b> · two-way texts and calls on one number, pay per text sent' : ''}${fax ? '\n📠 <b>Fax only</b> · send and receive faxes' : ''}`,
    helpBtn: '🤔 Help me choose',
    help: '🤔 <b>Which plan fits?</b>\n\n• Forward calls, voicemail, an AI receptionist → <b>Basic</b>\n• A keypad menu (press 1, press 2), ring groups, call recording → <b>Plus</b>\n• Calling lists with IVR or AI, OTP calls → <b>Pro</b>\n• Any caller ID, many numbers, encrypted calls → <b>Business</b>\n• Texting people from your number → <b>Calls + texting</b>\n• Faxes only → <b>Fax only</b>\n\nYou can upgrade any time. Tap a plan 👇',
  },
  fr: {
    textingOn: '💬 Activer les SMS', textingOnDone: '✅ Les SMS sont activés pour ce numéro. Vous payez par SMS envoyé ; la réception est gratuite.',
    ask: '🛒 <b>À quoi servira le numéro ?</b>\n\n📞 <b>Appels</b> — répondre, transférer, menus, messagerie vocale. Les SMS peuvent être ajoutés plus tard si le numéro le permet.\n💬 <b>Appels + SMS</b> — SMS dans les deux sens et appels sur un seul numéro. Vous payez par SMS envoyé.\n📠 <b>Fax uniquement</b> — envoie et reçoit des fax. Ni appels ni SMS.',
    calls: '📞 Appels', texting: '💬 Appels + SMS', fax: '📠 Fax uniquement',
    pickCountry: (price) => `💬 <b>Appels + SMS</b>\n\nChoisissez un pays. ${price} $/mois, plus un petit tarif par SMS envoyé. La réception est gratuite. Aucune pièce d’identité.`,
    none: '💬 Les numéros Appels + SMS ne sont pas disponibles pour le moment. Réessayez plus tard ou choisissez Appels.',
    plansExtra: (texting, fax = true) => `${texting ? '\n💬 <b>Appels + SMS</b> · SMS dans les deux sens et appels sur un numéro, payé par SMS envoyé' : ''}${fax ? '\n📠 <b>Fax uniquement</b> · envoyer et recevoir des fax' : ''}`,
    helpBtn: '🤔 Aidez-moi à choisir',
    help: '🤔 <b>Quel forfait choisir ?</b>\n\n• Transfert d’appels, messagerie, réceptionniste IA → <b>Basic</b>\n• Menu à touches (tapez 1, tapez 2), groupes d’appel, enregistrement → <b>Plus</b>\n• Appels de listes avec IVR ou IA, appels OTP → <b>Pro</b>\n• N’importe quel numéro affiché, beaucoup de numéros, appels chiffrés → <b>Business</b>\n• Envoyer des SMS depuis votre numéro → <b>Appels + SMS</b>\n• Uniquement des fax → <b>Fax uniquement</b>\n\nVous pouvez changer de forfait à tout moment. Choisissez 👇',
  },
  zh: {
    textingOn: '💬 开通短信', textingOnDone: '✅ 此号码已开通短信。按发送的短信计费，接收免费。',
    ask: '🛒 <b>这个号码用来做什么？</b>\n\n📞 <b>通话</b> — 接听、转接、按键菜单、语音信箱。支持的号码以后可以开通短信。\n💬 <b>通话 + 短信</b> — 一个号码收发短信并通话。按发送的短信计费。\n📠 <b>仅传真</b> — 收发传真。不能通话或发短信。',
    calls: '📞 通话', texting: '💬 通话 + 短信', fax: '📠 仅传真',
    pickCountry: (price) => `💬 <b>通话 + 短信</b>\n\n请选择国家。每月 $${price}，每发送一条短信另收少量费用。接收免费。无需身份证件。`,
    none: '💬 通话 + 短信号码暂时无法购买。请稍后再试，或选择“通话”。',
    plansExtra: (texting, fax = true) => `${texting ? '\n💬 <b>通话 + 短信</b> · 一个号码收发短信并通话，按发送短信计费' : ''}${fax ? '\n📠 <b>仅传真</b> · 收发传真' : ''}`,
    helpBtn: '🤔 帮我选择',
    help: '🤔 <b>哪个套餐适合我？</b>\n\n• 转接来电、语音信箱、AI 接待 → <b>Basic</b>\n• 按键菜单（按 1、按 2）、振铃组、通话录音 → <b>Plus</b>\n• 用 IVR 或 AI 批量拨打名单、OTP 来电 → <b>Pro</b>\n• 任意来电显示、大量号码、加密通话 → <b>Business</b>\n• 用号码给别人发短信 → <b>通话 + 短信</b>\n• 只收发传真 → <b>仅传真</b>\n\n随时可以升级。请选择套餐 👇',
  },
  hi: {
    textingOn: '💬 टेक्स्टिंग चालू करें', textingOnDone: '✅ इस नंबर पर टेक्स्टिंग चालू है। भेजे गए हर टेक्स्ट का शुल्क लगता है; पाना मुफ़्त है।',
    ask: '🛒 <b>नंबर किस काम के लिए चाहिए?</b>\n\n📞 <b>कॉल</b> — जवाब देना, फ़ॉरवर्ड, मेनू, वॉइसमेल। जहाँ नंबर सपोर्ट करता है, टेक्स्टिंग बाद में जोड़ी जा सकती है।\n💬 <b>कॉल + टेक्स्टिंग</b> — एक ही नंबर पर दोतरफ़ा टेक्स्ट और कॉल। भेजे गए हर टेक्स्ट का शुल्क लगता है।\n📠 <b>केवल फ़ैक्स</b> — फ़ैक्स भेजता और पाता है। कॉल या टेक्स्ट नहीं।',
    calls: '📞 कॉल', texting: '💬 कॉल + टेक्स्टिंग', fax: '📠 केवल फ़ैक्स',
    pickCountry: (price) => `💬 <b>कॉल + टेक्स्टिंग</b>\n\nदेश चुनें। $${price}/माह, और भेजे गए हर टेक्स्ट पर थोड़ा शुल्क। पाना मुफ़्त है। कोई आईडी नहीं चाहिए।`,
    none: '💬 कॉल + टेक्स्टिंग नंबर अभी उपलब्ध नहीं हैं। बाद में फिर कोशिश करें, या कॉल चुनें।',
    plansExtra: (texting, fax = true) => `${texting ? '\n💬 <b>कॉल + टेक्स्टिंग</b> · एक नंबर पर दोतरफ़ा टेक्स्ट और कॉल, हर भेजे टेक्स्ट का शुल्क' : ''}${fax ? '\n📠 <b>केवल फ़ैक्स</b> · फ़ैक्स भेजें और पाएँ' : ''}`,
    helpBtn: '🤔 चुनने में मदद करें',
    help: '🤔 <b>कौन सा प्लान सही है?</b>\n\n• कॉल फ़ॉरवर्ड, वॉइसमेल, AI रिसेप्शनिस्ट → <b>Basic</b>\n• कीपैड मेनू (1 दबाएँ, 2 दबाएँ), रिंग ग्रुप, कॉल रिकॉर्डिंग → <b>Plus</b>\n• IVR या AI से लिस्ट पर कॉल, OTP कॉल → <b>Pro</b>\n• कोई भी कॉलर ID, कई नंबर, एन्क्रिप्टेड कॉल → <b>Business</b>\n• अपने नंबर से टेक्स्ट भेजना → <b>कॉल + टेक्स्टिंग</b>\n• सिर्फ़ फ़ैक्स → <b>केवल फ़ैक्स</b>\n\nआप कभी भी अपग्रेड कर सकते हैं। प्लान चुनें 👇',
  },
  fa: {
    textingOn: '💬 فعال‌سازی پیامک', textingOnDone: '✅ پیامک برای این شماره فعال شد. برای هر پیامک ارسالی هزینه می‌پردازید؛ دریافت رایگان است.',
    ask: '🛒 <b>شماره را برای چه کاری می‌خواهید؟</b>\n\n📞 <b>تماس</b> — پاسخ‌گویی، انتقال تماس، منو، پیام‌گیر صوتی. اگر شماره پشتیبانی کند، پیامک را بعداً می‌توانید اضافه کنید.\n💬 <b>تماس + پیامک</b> — پیامک دوطرفه و تماس روی یک شماره. برای هر پیامک ارسالی هزینه می‌پردازید.\n📠 <b>فقط فکس</b> — فکس می‌فرستد و می‌گیرد. بدون تماس و پیامک.',
    calls: '📞 تماس', texting: '💬 تماس + پیامک', fax: '📠 فقط فکس',
    pickCountry: (price) => `💬 <b>تماس + پیامک</b>\n\nیک کشور انتخاب کنید. ماهانه $${price} به‌علاوهٔ هزینهٔ کمی برای هر پیامک ارسالی. دریافت رایگان است. مدرک شناسایی لازم نیست.`,
    none: '💬 شماره‌های تماس + پیامک فعلاً در دسترس نیستند. بعداً دوباره امتحان کنید یا «تماس» را انتخاب کنید.',
    plansExtra: (texting, fax = true) => `${texting ? '\n💬 <b>تماس + پیامک</b> · پیامک دوطرفه و تماس روی یک شماره، پرداخت برای هر پیامک ارسالی' : ''}${fax ? '\n📠 <b>فقط فکس</b> · ارسال و دریافت فکس' : ''}`,
    helpBtn: '🤔 کمکم کن انتخاب کنم',
    help: '🤔 <b>کدام پلن مناسب است؟</b>\n\n• انتقال تماس، پیام‌گیر، منشی هوش مصنوعی → <b>Basic</b>\n• منوی کلیدی (۱ را بزنید، ۲ را بزنید)، گروه زنگ، ضبط تماس → <b>Plus</b>\n• تماس با فهرست‌ها با IVR یا هوش مصنوعی، تماس OTP → <b>Pro</b>\n• هر شماره نمایشی، شماره‌های زیاد، تماس رمزگذاری‌شده → <b>Business</b>\n• پیامک از شماره خودتان → <b>تماس + پیامک</b>\n• فقط فکس → <b>فقط فکس</b>\n\nهر زمان می‌توانید ارتقا دهید. یک پلن انتخاب کنید 👇',
  },
}
const T = (lang) => L[lang] || L.en
const keyboard = (lang) => { const t = T(lang); return [[t.calls], [t.texting], [t.fax]] }
// Which kind a pressed button means, in any language (keyboards can be stale after a language change).
const kindOf = (message) => { for (const t of Object.values(L)) for (const k of ['calls', 'texting', 'fax']) if (t[k] === message) return k; return null }
// Countries the bot sells for calls + texting: instant two-way texting offers that are also in the bot catalogue.
function textingCountries(phoneConfig) {
  if (!phoneConfig.PLAN_TEXTING()) return []
  const cat = phoneConfig.botExtraCountries()
  // USA texting needs the web 10DLC registration, so the bots sell it only outside the USA.
  return require('./texting-countries').list().filter(o => o.iso !== 'US').map(o => { const c = cat.find(x => x.code === o.iso && x.types.includes(o.type)); return c ? { ...c, type: o.type } : null }).filter(Boolean)
}

const isTextingOn = (message) => Object.values(L).some(t => t.textingOn === message)
const isHelp = (message) => Object.values(L).some(t => t.helpBtn === message)

module.exports = { T, keyboard, kindOf, textingCountries, isTextingOn, isHelp }
