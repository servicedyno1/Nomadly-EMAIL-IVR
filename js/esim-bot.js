'use strict'
// Telegram bots: USA T-Mobile eSIM sold with the same automatic Spenza order as the web (optional ZIP and email,
// auto-renew; the IMEI is sent after payment), paid from the wallet or directly in crypto. Lines live in esimLines (source 'telegram').
const ES = require('./spenza')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const PRODUCT_KEY = 'esim_spenza'
const PRODUCT_NAME = 'USA T-Mobile eSIM'
const PRICE = 75
const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } sum += n } return sum % 10 === 0 }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '—')

const T = {
  en: {
    home: (p, inc) => `📱 <b>USA T-Mobile eSIM — $${p}/month</b>\n\n${inc ? `📦 Each month: ${inc}\n\n` : ''}• A USA phone number on the T-Mobile network\n• Two-way SMS: send and receive texts on your phone\n• Calls and USA data\n• Scan a QR code to install (iPhone and Android with eSIM)\n• Renews monthly from your wallet; turn auto-renew off any time\n\nPay first; you send your phone's IMEI (dial *#06#) right after.`,
    buy: (p) => `🛒 Buy eSIM — $${p}/month`, mine: '📋 My eSIMs', skip: '⏭ Skip',
    askImei: '📟 Send your phone’s <b>15-digit IMEI</b>.\n\nDial <b>*#06#</b> on the phone that will use the eSIM to see it.',
    badImei: '❌ That isn’t a valid IMEI. It has 15 digits — dial *#06# to see it.',
    askZip: '📍 Send a <b>5-digit USA ZIP code</b> so we can ask for a number near it (not guaranteed), or tap Skip.',
    badZip: '❌ Send a 5-digit USA ZIP code, or tap Skip.',
    askEmail: '📧 Send an <b>email address</b> for a copy of your QR code and renewal reminders.\n\nOptional, but we recommend it: if you lose this chat, the email keeps your QR code safe. Or tap Skip.',
    badEmail: '❌ That email doesn’t look right. Send a valid email, or tap Skip.',
    askRenew: '🔁 <b>Auto-renew</b>\n\nWith auto-renew on, the monthly price is taken from your wallet one day before the renewal date. If the wallet is short, the line pauses and ends on its expiry date. You can change this any time under My eSIMs.',
    renewOn: '✅ Auto-renew on (recommended)', renewOff: '⏹ Auto-renew off',
    unavailable: '⚠️ eSIMs are temporarily unavailable. Please try again later.',
    summary: (o, p) => `💰 <b>Order: USA T-Mobile eSIM</b>\n\n💵 Price: <b>$${p}/month</b>\n📟 IMEI: ${o.imei ? `<code>${o.imei}</code>` : 'you send it after paying'}\n📍 ZIP: ${o.zipcode || 'any'}\n📧 Email: ${o.email || 'none'}\n🔁 Auto-renew: ${o.autoRenew ? 'on' : 'off'}\n\nWe set up your eSIM automatically after payment and send the QR code right here.\n\nSelect payment method:`,
    noBank: '⚠️ The eSIM can be paid from your wallet or directly in crypto.',
    paidAskImei: (p) => `✅ <b>Paid $${p}.</b> One last step: send your phone’s <b>15-digit IMEI</b> so we can create the eSIM.\n\nDial <b>*#06#</b> on the phone that will use the eSIM to see it. You can also send it later: type /imei or open 📋 My eSIMs (within 7 days, or the $${p} goes back to your wallet).`,
    sendImei: '📟 Send IMEI',
    sendImeiPaid: '📟 Send IMEI for my paid eSIM',
    waitingNote: '📟 <b>Your paid eSIM is waiting for your IMEI.</b> Tap “📟 Send IMEI for my paid eSIM” below, or type /imei any time.',
    noneWaiting: 'You have no paid eSIM waiting for an IMEI.',
    placed: (p, bal) => `✅ <b>Paid $${p}.</b> Your eSIM is being set up — usually a few minutes, sometimes longer.\n\nWe’ll send the QR code here as soon as it’s ready.\n👛 Wallet balance: $${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 Your $${p} crypto payment was added to your wallet.`,
    none: 'You don’t have any eSIMs yet.',
    pick: '📋 <b>My eSIMs</b>\n\nPick one to manage:',
    settingUp: 'Setting up',
    status: { provisioning: '⏳ Setting up', active: '🟢 Active', suspended: '⏸ Paused (renewal unpaid)', failed: '❌ Failed (refunded)', awaiting_imei: '📟 Paid — waiting for your IMEI' },
    line: (l, s) => `📱 <b>USA T-Mobile eSIM</b>\n\nNumber: ${l.phoneNumber || 'being assigned'}\nStatus: ${s}\nPrice: $${l.price}/month\n${l.expiresAt ? `Active until: ${day(l.expiresAt)}\n` : ''}🔁 Auto-renew: <b>${l.autoRenew ? 'on' : 'off'}</b>${l.autoRenew && l.nextBillAt ? ` (wallet charged on ${day(l.nextBillAt)})` : ''}\n📧 QR email: ${l.qrEmail || 'none'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ Turn auto-renew off', turnOn: '✅ Turn auto-renew on', qr: '📷 Show QR code', emailQr: '📧 Email me the QR code', renewNow: '💳 Renew now from wallet',
    renewSet: (on) => on ? '✅ Auto-renew is on. The monthly price is taken from your wallet one day before renewal.' : '⏹ Auto-renew is off. The line ends on its expiry date unless you turn it back on.',
    qrNotReady: '⏳ The QR code isn’t ready yet. We’ll send it here as soon as the eSIM is set up.',
    askQrEmail: '📧 Send the email address for the QR code.',
    emailed: (e) => `✅ QR code sent to ${e}. Check your inbox and spam folder.`,
    renewed: '✅ Renewed. Your eSIM is active again.',
  },
  fr: {
    home: (p, inc) => `📱 <b>eSIM USA T-Mobile — ${p} $/mois</b>\n\n${inc ? `📦 Chaque mois : ${inc}\n\n` : ''}• Un numéro américain sur le réseau T-Mobile\n• SMS dans les deux sens : envoyez et recevez des textos sur votre téléphone\n• Appels et données aux USA\n• Installation en scannant un QR code (iPhone et Android compatibles eSIM)\n• Renouvellement mensuel depuis votre portefeuille ; désactivable à tout moment\n\nPayez d’abord ; vous envoyez ensuite l’IMEI de votre téléphone (composez *#06#).`,
    buy: (p) => `🛒 Acheter l’eSIM — ${p} $/mois`, mine: '📋 Mes eSIM', skip: '⏭ Passer',
    askImei: '📟 Envoyez l’<b>IMEI à 15 chiffres</b> de votre téléphone.\n\nComposez <b>*#06#</b> sur le téléphone qui utilisera l’eSIM pour le voir.',
    badImei: '❌ Cet IMEI n’est pas valide. Il a 15 chiffres — composez *#06# pour le voir.',
    askZip: '📍 Envoyez un <b>code postal américain à 5 chiffres</b> pour demander un numéro proche (non garanti), ou touchez Passer.',
    badZip: '❌ Envoyez un code postal américain à 5 chiffres, ou touchez Passer.',
    askEmail: '📧 Envoyez une <b>adresse e-mail</b> pour recevoir une copie du QR code et les rappels de renouvellement.\n\nFacultatif, mais conseillé : si vous perdez ce chat, l’e-mail garde votre QR code. Ou touchez Passer.',
    badEmail: '❌ Cet e-mail ne semble pas valide. Envoyez un e-mail valide, ou touchez Passer.',
    askRenew: '🔁 <b>Renouvellement automatique</b>\n\nActivé, le prix mensuel est prélevé sur votre portefeuille la veille du renouvellement. Si le solde est insuffisant, la ligne est suspendue puis se termine à sa date d’expiration. Modifiable à tout moment dans Mes eSIM.',
    renewOn: '✅ Renouvellement auto activé (conseillé)', renewOff: '⏹ Renouvellement auto désactivé',
    unavailable: '⚠️ Les eSIM sont temporairement indisponibles. Réessayez plus tard.',
    summary: (o, p) => `💰 <b>Commande : eSIM USA T-Mobile</b>\n\n💵 Prix : <b>${p} $/mois</b>\n📟 IMEI : ${o.imei ? `<code>${o.imei}</code>` : 'à envoyer après le paiement'}\n📍 Code postal : ${o.zipcode || 'indifférent'}\n📧 E-mail : ${o.email || 'aucun'}\n🔁 Renouvellement auto : ${o.autoRenew ? 'activé' : 'désactivé'}\n\nNous créons votre eSIM automatiquement après le paiement et envoyons le QR code ici.\n\nChoisissez le mode de paiement :`,
    noBank: '⚠️ L’eSIM se paie avec votre portefeuille ou directement en crypto.',
    paidAskImei: (p) => `✅ <b>${p} $ payés.</b> Dernière étape : envoyez l’<b>IMEI à 15 chiffres</b> de votre téléphone pour créer l’eSIM.\n\nComposez <b>*#06#</b> sur le téléphone qui utilisera l’eSIM pour le voir. Vous pouvez aussi l’envoyer plus tard : tapez /imei ou ouvrez 📋 Mes eSIM (sous 7 jours, sinon les ${p} $ reviennent sur votre portefeuille).`,
    sendImei: '📟 Envoyer l’IMEI',
    sendImeiPaid: '📟 Envoyer l’IMEI de mon eSIM payée',
    waitingNote: '📟 <b>Votre eSIM payée attend votre IMEI.</b> Touchez « 📟 Envoyer l’IMEI de mon eSIM payée » ci-dessous, ou tapez /imei à tout moment.',
    noneWaiting: 'Aucune eSIM payée n’attend d’IMEI.',
    placed: (p, bal) => `✅ <b>${p} $ payés.</b> Votre eSIM est en cours de création — en général quelques minutes, parfois plus.\n\nNous enverrons le QR code ici dès qu’il sera prêt.\n👛 Solde du portefeuille : ${bal} $`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 Votre paiement crypto de ${p} $ a été ajouté à votre portefeuille.`,
    none: 'Vous n’avez pas encore d’eSIM.',
    pick: '📋 <b>Mes eSIM</b>\n\nChoisissez-en une à gérer :',
    settingUp: 'En création',
    status: { provisioning: '⏳ En création', active: '🟢 Active', suspended: '⏸ Suspendue (renouvellement impayé)', failed: '❌ Échec (remboursée)', awaiting_imei: '📟 Payée — en attente de votre IMEI' },
    line: (l, s) => `📱 <b>eSIM USA T-Mobile</b>\n\nNuméro : ${l.phoneNumber || 'en attribution'}\nStatut : ${s}\nPrix : ${l.price} $/mois\n${l.expiresAt ? `Active jusqu’au : ${day(l.expiresAt)}\n` : ''}🔁 Renouvellement auto : <b>${l.autoRenew ? 'activé' : 'désactivé'}</b>${l.autoRenew && l.nextBillAt ? ` (prélèvement le ${day(l.nextBillAt)})` : ''}\n📧 E-mail du QR : ${l.qrEmail || 'aucun'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ Désactiver le renouvellement auto', turnOn: '✅ Activer le renouvellement auto', qr: '📷 Voir le QR code', emailQr: '📧 M’envoyer le QR code par e-mail', renewNow: '💳 Renouveler depuis le portefeuille',
    renewSet: (on) => on ? '✅ Renouvellement auto activé. Le prix mensuel est prélevé sur votre portefeuille la veille du renouvellement.' : '⏹ Renouvellement auto désactivé. La ligne se termine à sa date d’expiration sauf si vous le réactivez.',
    qrNotReady: '⏳ Le QR code n’est pas encore prêt. Nous l’enverrons ici dès que l’eSIM sera créée.',
    askQrEmail: '📧 Envoyez l’adresse e-mail pour le QR code.',
    emailed: (e) => `✅ QR code envoyé à ${e}. Vérifiez votre boîte de réception et vos spams.`,
    renewed: '✅ Renouvelée. Votre eSIM est de nouveau active.',
  },
  hi: {
    home: (p, inc) => `📱 <b>USA T-Mobile eSIM — $${p}/माह</b>\n\n${inc ? `📦 हर महीने: ${inc}\n\n` : ''}• T-Mobile नेटवर्क पर एक USA फ़ोन नंबर\n• दो-तरफ़ा SMS: अपने फ़ोन पर टेक्स्ट भेजें और पाएं\n• कॉल और USA डेटा\n• QR कोड स्कैन करके इंस्टॉल करें (eSIM वाले iPhone और Android)\n• हर महीने वॉलेट से रिन्यू; ऑटो-रिन्यू कभी भी बंद करें\n\nपहले भुगतान करें; उसके बाद अपने फ़ोन का IMEI भेजें (*#06# डायल करें)।`,
    buy: (p) => `🛒 eSIM खरीदें — $${p}/माह`, mine: '📋 मेरे eSIM', skip: '⏭ छोड़ें',
    askImei: '📟 अपने फ़ोन का <b>15 अंकों का IMEI</b> भेजें।\n\nजिस फ़ोन में eSIM लगेगा उस पर <b>*#06#</b> डायल करें।',
    badImei: '❌ यह मान्य IMEI नहीं है। इसमें 15 अंक होते हैं — *#06# डायल करें।',
    askZip: '📍 पास का नंबर मांगने के लिए <b>5 अंकों का USA ZIP कोड</b> भेजें (गारंटी नहीं), या छोड़ें दबाएं।',
    badZip: '❌ 5 अंकों का USA ZIP कोड भेजें, या छोड़ें दबाएं।',
    askEmail: '📧 QR कोड की कॉपी और रिन्यूअल रिमाइंडर के लिए <b>ईमेल पता</b> भेजें।\n\nवैकल्पिक, लेकिन सुझाया गया: चैट खो जाने पर भी ईमेल में QR कोड सुरक्षित रहता है। या छोड़ें दबाएं।',
    badEmail: '❌ यह ईमेल सही नहीं लगता। मान्य ईमेल भेजें, या छोड़ें दबाएं।',
    askRenew: '🔁 <b>ऑटो-रिन्यू</b>\n\nचालू होने पर मासिक कीमत रिन्यूअल से एक दिन पहले वॉलेट से ली जाती है। वॉलेट में कम पैसे हों तो लाइन रुक जाती है और समाप्ति तिथि पर बंद हो जाती है। मेरे eSIM में कभी भी बदलें।',
    renewOn: '✅ ऑटो-रिन्यू चालू (सुझाया गया)', renewOff: '⏹ ऑटो-रिन्यू बंद',
    unavailable: '⚠️ eSIM अभी उपलब्ध नहीं हैं। बाद में फिर कोशिश करें।',
    summary: (o, p) => `💰 <b>ऑर्डर: USA T-Mobile eSIM</b>\n\n💵 कीमत: <b>$${p}/माह</b>\n📟 IMEI: ${o.imei ? `<code>${o.imei}</code>` : 'भुगतान के बाद भेजें'}\n📍 ZIP: ${o.zipcode || 'कोई भी'}\n📧 ईमेल: ${o.email || 'नहीं'}\n🔁 ऑटो-रिन्यू: ${o.autoRenew ? 'चालू' : 'बंद'}\n\nभुगतान के बाद हम eSIM अपने-आप बनाते हैं और QR कोड यहीं भेजते हैं।\n\nभुगतान का तरीका चुनें:`,
    noBank: '⚠️ eSIM का भुगतान वॉलेट से या सीधे क्रिप्टो में होता है।',
    paidAskImei: (p) => `✅ <b>$${p} का भुगतान हुआ।</b> आख़िरी कदम: eSIM बनाने के लिए अपने फ़ोन का <b>15 अंकों का IMEI</b> भेजें।\n\nजिस फ़ोन पर eSIM चलेगा उस पर <b>*#06#</b> डायल करें। आप इसे बाद में भी भेज सकते हैं: /imei लिखें या 📋 मेरे eSIM खोलें (7 दिनों के अंदर, वरना $${p} वॉलेट में वापस)।`,
    sendImei: '📟 IMEI भेजें',
    sendImeiPaid: '📟 मेरे भुगतान किए eSIM का IMEI भेजें',
    waitingNote: '📟 <b>आपका भुगतान किया हुआ eSIM आपके IMEI का इंतज़ार कर रहा है।</b> नीचे “📟 मेरे भुगतान किए eSIM का IMEI भेजें” दबाएँ, या कभी भी /imei लिखें।',
    noneWaiting: 'आपका कोई भुगतान किया हुआ eSIM IMEI का इंतज़ार नहीं कर रहा।',
    placed: (p, bal) => `✅ <b>$${p} का भुगतान हुआ।</b> आपका eSIM बन रहा है — आमतौर पर कुछ मिनट, कभी-कभी ज़्यादा।\n\nतैयार होते ही QR कोड यहीं भेजेंगे।\n👛 वॉलेट बैलेंस: $${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 आपका $${p} क्रिप्टो भुगतान वॉलेट में जोड़ दिया गया।`,
    none: 'आपके पास अभी कोई eSIM नहीं है।',
    pick: '📋 <b>मेरे eSIM</b>\n\nप्रबंधित करने के लिए एक चुनें:',
    settingUp: 'बन रहा है',
    status: { provisioning: '⏳ बन रहा है', active: '🟢 सक्रिय', suspended: '⏸ रुका हुआ (रिन्यूअल बाकी)', failed: '❌ विफल (रिफंड)' , awaiting_imei: '📟 भुगतान हुआ — आपके IMEI का इंतज़ार' },
    line: (l, s) => `📱 <b>USA T-Mobile eSIM</b>\n\nनंबर: ${l.phoneNumber || 'दिया जा रहा है'}\nस्थिति: ${s}\nकीमत: $${l.price}/माह\n${l.expiresAt ? `सक्रिय तक: ${day(l.expiresAt)}\n` : ''}🔁 ऑटो-रिन्यू: <b>${l.autoRenew ? 'चालू' : 'बंद'}</b>${l.autoRenew && l.nextBillAt ? ` (वॉलेट से ${day(l.nextBillAt)} को)` : ''}\n📧 QR ईमेल: ${l.qrEmail || 'नहीं'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ ऑटो-रिन्यू बंद करें', turnOn: '✅ ऑटो-रिन्यू चालू करें', qr: '📷 QR कोड दिखाएं', emailQr: '📧 QR कोड ईमेल करें', renewNow: '💳 वॉलेट से अभी रिन्यू करें',
    renewSet: (on) => on ? '✅ ऑटो-रिन्यू चालू है। मासिक कीमत रिन्यूअल से एक दिन पहले वॉलेट से ली जाती है।' : '⏹ ऑटो-रिन्यू बंद है। दोबारा चालू न करने पर लाइन समाप्ति तिथि पर बंद होगी।',
    qrNotReady: '⏳ QR कोड अभी तैयार नहीं है। eSIM बनते ही यहीं भेजेंगे।',
    askQrEmail: '📧 QR कोड के लिए ईमेल पता भेजें।',
    emailed: (e) => `✅ QR कोड ${e} पर भेजा गया। इनबॉक्स और स्पैम देखें।`,
    renewed: '✅ रिन्यू हो गया। आपका eSIM फिर से सक्रिय है।',
  },
  zh: {
    home: (p, inc) => `📱 <b>美国 T-Mobile eSIM — $${p}/月</b>\n\n${inc ? `📦 每月：${inc}\n\n` : ''}• T-Mobile 网络上的美国电话号码\n• 双向短信：在手机上收发短信\n• 通话和美国流量\n• 扫描二维码安装（支持 eSIM 的 iPhone 和安卓）\n• 每月从钱包自动续费；可随时关闭\n\n先付款，然后再发送手机的 IMEI（拨打 *#06#）。`,
    buy: (p) => `🛒 购买 eSIM — $${p}/月`, mine: '📋 我的 eSIM', skip: '⏭ 跳过',
    askImei: '📟 请发送手机的 <b>15 位 IMEI</b>。\n\n在将使用 eSIM 的手机上拨打 <b>*#06#</b> 查看。',
    badImei: '❌ IMEI 无效。IMEI 为 15 位数字 — 拨打 *#06# 查看。',
    askZip: '📍 发送 <b>5 位美国邮编</b>，我们会尽量申请附近的号码（不保证），或点击跳过。',
    badZip: '❌ 请发送 5 位美国邮编，或点击跳过。',
    askEmail: '📧 发送<b>邮箱地址</b>，用于接收二维码副本和续费提醒。\n\n可选但推荐：即使聊天记录丢失，邮件中仍保留您的二维码。或点击跳过。',
    badEmail: '❌ 邮箱格式不正确。请发送有效邮箱，或点击跳过。',
    askRenew: '🔁 <b>自动续费</b>\n\n开启后，每月费用会在续费日前一天从钱包扣除。钱包余额不足时线路暂停，并在到期日结束。可随时在“我的 eSIM”中更改。',
    renewOn: '✅ 开启自动续费（推荐）', renewOff: '⏹ 关闭自动续费',
    unavailable: '⚠️ eSIM 暂时无法购买，请稍后再试。',
    summary: (o, p) => `💰 <b>订单：美国 T-Mobile eSIM</b>\n\n💵 价格：<b>$${p}/月</b>\n📟 IMEI：${o.imei ? `<code>${o.imei}</code>` : '付款后发送'}\n📍 邮编：${o.zipcode || '不限'}\n📧 邮箱：${o.email || '无'}\n🔁 自动续费：${o.autoRenew ? '开启' : '关闭'}\n\n付款后我们会自动开通 eSIM，并在这里发送二维码。\n\n请选择付款方式：`,
    noBank: '⚠️ eSIM 可用钱包或直接用加密货币付款。',
    paidAskImei: (p) => `✅ <b>已支付 $${p}。</b>最后一步：请发送手机的 <b>15 位 IMEI</b>，以便开通 eSIM。\n\n在要使用 eSIM 的手机上拨打 <b>*#06#</b> 查看。也可稍后发送：输入 /imei 或打开 📋 我的 eSIM（7 天内，否则 $${p} 将退回钱包）。`,
    sendImei: '📟 发送 IMEI',
    sendImeiPaid: '📟 为已付款的 eSIM 发送 IMEI',
    waitingNote: '📟 <b>您已付款的 eSIM 正在等待 IMEI。</b>点击下方“📟 为已付款的 eSIM 发送 IMEI”，或随时输入 /imei。',
    noneWaiting: '您没有等待 IMEI 的已付款 eSIM。',
    placed: (p, bal) => `✅ <b>已支付 $${p}。</b>您的 eSIM 正在开通 — 通常几分钟，有时更久。\n\n准备好后我们会在这里发送二维码。\n👛 钱包余额：$${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 您的 $${p} 加密货币付款已存入钱包。`,
    none: '您还没有 eSIM。',
    pick: '📋 <b>我的 eSIM</b>\n\n选择要管理的 eSIM：',
    settingUp: '开通中',
    status: { provisioning: '⏳ 开通中', active: '🟢 使用中', suspended: '⏸ 已暂停（未续费）', failed: '❌ 失败（已退款）', awaiting_imei: '📟 已付款 — 等待您的 IMEI' },
    line: (l, s) => `📱 <b>美国 T-Mobile eSIM</b>\n\n号码：${l.phoneNumber || '分配中'}\n状态：${s}\n价格：$${l.price}/月\n${l.expiresAt ? `有效期至：${day(l.expiresAt)}\n` : ''}🔁 自动续费：<b>${l.autoRenew ? '开启' : '关闭'}</b>${l.autoRenew && l.nextBillAt ? `（${day(l.nextBillAt)} 从钱包扣款）` : ''}\n📧 二维码邮箱：${l.qrEmail || '无'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ 关闭自动续费', turnOn: '✅ 开启自动续费', qr: '📷 查看二维码', emailQr: '📧 将二维码发到邮箱', renewNow: '💳 立即从钱包续费',
    renewSet: (on) => on ? '✅ 自动续费已开启。每月费用会在续费日前一天从钱包扣除。' : '⏹ 自动续费已关闭。除非重新开启，线路将在到期日结束。',
    qrNotReady: '⏳ 二维码尚未就绪。eSIM 开通后我们会在这里发送。',
    askQrEmail: '📧 请发送接收二维码的邮箱地址。',
    emailed: (e) => `✅ 二维码已发送至 ${e}。请查看收件箱和垃圾邮件。`,
    renewed: '✅ 已续费。您的 eSIM 已恢复使用。',
  },
}
const s = (lang) => T[lang] || T.en

// Notices the eSIM engine (spenza.js) sends to bot buyers later on, in the buyer's language.
const INSTALL = {
  en: 'On the phone that will use it: Settings → Mobile / Cellular → Add eSIM → Use QR code, then scan the QR code. Keep the phone on Wi-Fi while it installs. Each QR code can be installed once.',
  fr: 'Sur le téléphone qui l’utilisera : Réglages → Données cellulaires / Réseau mobile → Ajouter une eSIM → Utiliser un QR code, puis scannez le QR code. Restez en Wi-Fi pendant l’installation. Chaque QR code ne s’installe qu’une fois.',
  hi: 'जिस फ़ोन में लगाना है उस पर: Settings → Mobile / Cellular → Add eSIM → Use QR code, फिर QR कोड स्कैन करें। इंस्टॉल होते समय फ़ोन Wi-Fi पर रखें। हर QR कोड एक ही बार इंस्टॉल होता है।',
  zh: '在要使用的手机上：设置 → 蜂窝网络/移动数据 → 添加 eSIM → 使用二维码，然后扫描二维码。安装时请保持 Wi-Fi 连接。每个二维码只能安装一次。',
}
const N = {
  en: {
    imeiRemind: (left, p) => `📟 Your paid USA eSIM is waiting for your phone’s IMEI. Type /imei (or open 📋 My eSIMs → the line → 📟 Send IMEI). If it isn’t sent within ${left} day(s), $${p} goes back to your wallet.`,
    imeiRefund: (p) => `↩️ Your eSIM order was cancelled because no IMEI was sent within 7 days. $${p} was refunded to your wallet.`,
    ready: (ph, mailed, hasEmail) => `✅ Your USA T-Mobile eSIM is ready${ph ? `: ${ph}` : ''}. It has two-way SMS: send and receive texts on that phone.${mailed ? ` We also emailed the QR code to ${mailed}.` : hasEmail ? '' : ' Tip: use “Email me the QR code” under My eSIMs to keep a copy.'}`,
    caption: (ph, code) => `📱 Your USA T-Mobile eSIM${ph ? ` ${ph}` : ''}\n\n${INSTALL.en}${code ? `\n\nManual code: ${code}` : ''}`,
    failed: (p) => `⚠️ Your eSIM couldn’t be created. $${p} was refunded to your wallet.`,
    receipt: (ph, p, until, bal) => `🧾 Your USA eSIM${ph ? ` ${ph}` : ''} renewed: $${p} paid from your wallet. Active until ${until}. Wallet balance: $${bal}.`,
    paused: (ph, p, end) => `⏸️ Your eSIM${ph ? ` ${ph}` : ''} is paused: the $${p} renewal couldn’t be paid from your wallet. Top up before ${end} — we’ll retry automatically — or it ends on that date.`,
    ended: (ph, end, off) => `📴 Your eSIM${ph ? ` ${ph}` : ''} ended on ${end} because ${off ? 'auto-renew was off' : 'the renewal wasn’t paid'}.`,
    renews: (ph, end, p, bal, short) => `🔔 Your eSIM${ph ? ` ${ph}` : ''} renews on ${end}. $${p} will be taken from your wallet a day before. Wallet balance: $${bal}.${short > 0 ? ` Top up $${short} or more so it doesn’t end.` : ''}`,
    ends: (ph, end, bal) => `🔔 Your eSIM${ph ? ` ${ph}` : ''} ends on ${end} because auto-renew is off. Turn auto-renew on under My eSIMs before then to keep it. Wallet balance: $${bal}.`,
  },
  fr: {
    imeiRemind: (left, p) => `📟 Votre eSIM USA payée attend l’IMEI de votre téléphone. Tapez /imei (ou ouvrez 📋 Mes eSIM → la ligne → 📟 Envoyer l’IMEI). S’il n’est pas envoyé sous ${left} jour(s), les ${p} $ reviennent sur votre portefeuille.`,
    imeiRefund: (p) => `↩️ Votre commande eSIM est annulée car aucun IMEI n’a été envoyé sous 7 jours. ${p} $ ont été remboursés sur votre portefeuille.`,
    ready: (ph, mailed, hasEmail) => `✅ Votre eSIM USA T-Mobile est prête${ph ? ` : ${ph}` : ''}. SMS dans les deux sens : envoyez et recevez des textos sur ce téléphone.${mailed ? ` Nous avons aussi envoyé le QR code à ${mailed}.` : hasEmail ? '' : ' Astuce : utilisez « M’envoyer le QR code par e-mail » dans Mes eSIM pour en garder une copie.'}`,
    caption: (ph, code) => `📱 Votre eSIM USA T-Mobile${ph ? ` ${ph}` : ''}\n\n${INSTALL.fr}${code ? `\n\nCode manuel : ${code}` : ''}`,
    failed: (p) => `⚠️ Votre eSIM n’a pas pu être créée. ${p} $ ont été remboursés sur votre portefeuille.`,
    receipt: (ph, p, until, bal) => `🧾 Votre eSIM USA${ph ? ` ${ph}` : ''} est renouvelée : ${p} $ payés depuis votre portefeuille. Active jusqu’au ${until}. Solde : ${bal} $.`,
    paused: (ph, p, end) => `⏸️ Votre eSIM${ph ? ` ${ph}` : ''} est suspendue : le renouvellement de ${p} $ n’a pas pu être payé. Rechargez avant le ${end} — nous réessaierons automatiquement — sinon elle se termine à cette date.`,
    ended: (ph, end, off) => `📴 Votre eSIM${ph ? ` ${ph}` : ''} s’est terminée le ${end} car ${off ? 'le renouvellement auto était désactivé' : 'le renouvellement n’a pas été payé'}.`,
    renews: (ph, end, p, bal, short) => `🔔 Votre eSIM${ph ? ` ${ph}` : ''} se renouvelle le ${end}. ${p} $ seront prélevés sur votre portefeuille la veille. Solde : ${bal} $.${short > 0 ? ` Rechargez au moins ${short} $ pour qu’elle ne s’arrête pas.` : ''}`,
    ends: (ph, end, bal) => `🔔 Votre eSIM${ph ? ` ${ph}` : ''} se termine le ${end} car le renouvellement auto est désactivé. Activez-le dans Mes eSIM avant cette date pour la garder. Solde : ${bal} $.`,
  },
  hi: {
    imeiRemind: (left, p) => `📟 आपका भुगतान किया हुआ USA eSIM आपके फ़ोन के IMEI का इंतज़ार कर रहा है। /imei लिखें (या 📋 मेरे eSIM → लाइन → 📟 IMEI भेजें खोलें)। ${left} दिन में न भेजने पर $${p} वॉलेट में वापस होंगे।`,
    imeiRefund: (p) => `↩️ 7 दिनों में IMEI न मिलने से आपका eSIM ऑर्डर रद्द हुआ। $${p} आपके वॉलेट में वापस कर दिए गए।`,
    ready: (ph, mailed, hasEmail) => `✅ आपका USA T-Mobile eSIM तैयार है${ph ? `: ${ph}` : ''}। दो-तरफ़ा SMS: उस फ़ोन पर टेक्स्ट भेजें और पाएं।${mailed ? ` QR कोड ${mailed} पर भी ईमेल किया गया।` : hasEmail ? '' : ' सुझाव: कॉपी रखने के लिए मेरे eSIM में “QR कोड ईमेल करें” इस्तेमाल करें।'}`,
    caption: (ph, code) => `📱 आपका USA T-Mobile eSIM${ph ? ` ${ph}` : ''}\n\n${INSTALL.hi}${code ? `\n\nमैनुअल कोड: ${code}` : ''}`,
    failed: (p) => `⚠️ आपका eSIM नहीं बन सका। $${p} आपके वॉलेट में वापस कर दिए गए।`,
    receipt: (ph, p, until, bal) => `🧾 आपका USA eSIM${ph ? ` ${ph}` : ''} रिन्यू हुआ: वॉलेट से $${p}। ${until} तक सक्रिय। वॉलेट बैलेंस: $${bal}।`,
    paused: (ph, p, end) => `⏸️ आपका eSIM${ph ? ` ${ph}` : ''} रुका है: $${p} का रिन्यूअल वॉलेट से नहीं हो सका। ${end} से पहले टॉप-अप करें — हम अपने-आप फिर कोशिश करेंगे — वरना उसी दिन बंद होगा।`,
    ended: (ph, end, off) => `📴 आपका eSIM${ph ? ` ${ph}` : ''} ${end} को बंद हुआ क्योंकि ${off ? 'ऑटो-रिन्यू बंद था' : 'रिन्यूअल का भुगतान नहीं हुआ'}।`,
    renews: (ph, end, p, bal, short) => `🔔 आपका eSIM${ph ? ` ${ph}` : ''} ${end} को रिन्यू होगा। एक दिन पहले वॉलेट से $${p} लिए जाएंगे। वॉलेट बैलेंस: $${bal}।${short > 0 ? ` बंद होने से बचाने के लिए कम से कम $${short} टॉप-अप करें।` : ''}`,
    ends: (ph, end, bal) => `🔔 आपका eSIM${ph ? ` ${ph}` : ''} ${end} को बंद होगा क्योंकि ऑटो-रिन्यू बंद है। रखने के लिए उससे पहले मेरे eSIM में ऑटो-रिन्यू चालू करें। वॉलेट बैलेंस: $${bal}।`,
  },
  zh: {
    imeiRemind: (left, p) => `📟 您已付款的美国 eSIM 正在等待手机 IMEI。请输入 /imei（或打开 📋 我的 eSIM → 该线路 → 📟 发送 IMEI）。若 ${left} 天内未发送，$${p} 将退回钱包。`,
    imeiRefund: (p) => `↩️ 由于 7 天内未发送 IMEI，您的 eSIM 订单已取消。$${p} 已退回您的钱包。`,
    ready: (ph, mailed, hasEmail) => `✅ 您的美国 T-Mobile eSIM 已就绪${ph ? `：${ph}` : ''}。支持双向短信：在该手机上收发短信。${mailed ? `二维码也已发送至 ${mailed}。` : hasEmail ? '' : '提示：可在“我的 eSIM”中使用“将二维码发到邮箱”保留一份副本。'}`,
    caption: (ph, code) => `📱 您的美国 T-Mobile eSIM${ph ? ` ${ph}` : ''}\n\n${INSTALL.zh}${code ? `\n\n手动代码：${code}` : ''}`,
    failed: (p) => `⚠️ 您的 eSIM 未能开通。$${p} 已退回您的钱包。`,
    receipt: (ph, p, until, bal) => `🧾 您的美国 eSIM${ph ? ` ${ph}` : ''} 已续费：从钱包支付 $${p}。有效期至 ${until}。钱包余额：$${bal}。`,
    paused: (ph, p, end) => `⏸️ 您的 eSIM${ph ? ` ${ph}` : ''} 已暂停：$${p} 续费无法从钱包扣除。请在 ${end} 前充值（我们会自动重试），否则将在当天结束。`,
    ended: (ph, end, off) => `📴 您的 eSIM${ph ? ` ${ph}` : ''} 已于 ${end} 结束，因为${off ? '自动续费已关闭' : '续费未支付'}。`,
    renews: (ph, end, p, bal, short) => `🔔 您的 eSIM${ph ? ` ${ph}` : ''} 将于 ${end} 续费。前一天会从钱包扣除 $${p}。钱包余额：$${bal}。${short > 0 ? `请至少充值 $${short}，以免线路结束。` : ''}`,
    ends: (ph, end, bal) => `🔔 您的 eSIM${ph ? ` ${ph}` : ''} 将于 ${end} 结束，因为自动续费已关闭。如需保留，请在此之前在“我的 eSIM”中开启自动续费。钱包余额：$${bal}。`,
  },
}
const notice = (lang, key, ...args) => (N[lang] || N.en)[key](...args)

const parseImei = (m) => { const x = String(m || '').replace(/\D/g, ''); return x.length === 15 && luhn(x) ? x : null }
const parseZip = (m) => (/^\d{5}$/.test(String(m || '').trim()) ? String(m).trim() : null)
const parseEmail = (m) => { const x = String(m || '').trim().toLowerCase(); return EMAIL_RE.test(x) ? x : null }

// The plan the web sells (same price); null when none is on sale.
async function plan() {
  const p = (await ES.forSale().catch(() => [])).find(x => x.simId)
  return p ? { planId: p.planId, price: p.price, data: p.data, voiceMinutes: p.voiceMinutes, sms: p.sms } : null
}
// Plan allowance shown as-is from the provider catalog, e.g. "20 MB data · 20 min calls · Unlimited SMS".
const includes = (p) => [p?.data && `${p.data} data`, p?.voiceMinutes != null && `${p.voiceMinutes} min calls`, p?.sms != null && `${p.sms} SMS`].filter(Boolean).join(' · ')
const lineLabel = (l, lang) => `📱 ${l.phoneNumber || (l.status === 'awaiting_imei' ? s(lang).status.awaiting_imei : s(lang).settingUp)} · ${l.id.slice(-6)}`
const lineFromLabel = (lines, m) => lines.find(l => String(m || '').endsWith(`· ${l.id.slice(-6)}`)) || null
const lines = async (chatId) => (await ES.list(chatId)).filter(l => l.status !== 'failed')

// Wallet-paid order. ES.buy debits the wallet and refunds it if Spenza refuses.
async function fulfill(db, chatId, order, lang) {
  const r = await ES.buy(chatId, { ...order, source: 'telegram', lang })
  if (r.error) return { ok: false, text: s(lang).failed(r.error) }
  if (r.awaitingImei) return { ok: true, awaitingImei: true, text: s(lang).paidAskImei(r.item.price), lineId: r.item.id }
  const bal = round2(await walletOps(db).balance(chatId)).toFixed(2)
  return { ok: true, text: s(lang).placed(r.item.price, bal), lineId: r.item.id }
}
// Direct crypto: the confirmed payment goes into the wallet, then the same wallet order runs.
async function fulfillPaid(db, chatId, order, price, lang) {
  await walletOps(db).credit(chatId, price)
  const r = await fulfill(db, chatId, order, lang)
  return r.ok ? r : { ...r, text: `${r.text}\n\n${s(lang).toWallet(price)}` }
}

// IMEI sent after payment for a waiting line.
async function submitImei(db, chatId, lineId, imei, lang) {
  const r = await ES.submitImei(chatId, lineId, imei)
  if (r.error) return { ok: false, text: s(lang).failed(r.error) }
  await db.collection('digitalOrders').updateOne({ esimLineId: lineId }, { $set: { status: 'delivered', deliveredAt: new Date() } }).catch(() => {})
  const bal = round2(await walletOps(db).balance(chatId)).toFixed(2)
  return { ok: true, text: s(lang).placed(r.item.price, bal), lineId: r.item.id }
}
const backKb = { reply_markup: { keyboard: [['↩️ Back']], resize_keyboard: true } }
// After a crypto-paid order: ask for the IMEI next, or leave the flow.
async function afterCryptoPay(state, set, chatId, r) {
  if (!r.awaitingImei) return set(state, chatId, 'action', 'none')
  await set(state, chatId, 'esimPendingLine', r.lineId)
  await set(state, chatId, 'action', 'esim-bot-imei')
}

module.exports = { includes, notice, PRODUCT_KEY, PRODUCT_NAME, PRICE, s, parseImei, parseZip, parseEmail, plan, lines, lineLabel, lineFromLabel, fulfill, fulfillPaid, submitImei, afterCryptoPay, backKb, ES }
