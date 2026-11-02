'use strict'
// Telegram bots: USA T-Mobile eSIM sold with the same automatic Spenza order as the web (IMEI, ZIP, optional email,
// auto-renew), paid from the wallet or directly in crypto. Lines live in esimLines (source 'telegram').
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
    home: (p) => `📱 <b>USA T-Mobile eSIM — $${p}/month</b>\n\n• A USA phone number on the T-Mobile network\n• Two-way SMS: send and receive texts on your phone\n• Calls and USA data\n• Scan a QR code to install (iPhone and Android with eSIM)\n• Renews monthly from your wallet; turn auto-renew off any time\n\nYou'll need your phone's IMEI (dial *#06#).`,
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
    summary: (o, p) => `💰 <b>Order: USA T-Mobile eSIM</b>\n\n💵 Price: <b>$${p}/month</b>\n📟 IMEI: <code>${o.imei}</code>\n📍 ZIP: ${o.zipcode || 'any'}\n📧 Email: ${o.email || 'none'}\n🔁 Auto-renew: ${o.autoRenew ? 'on' : 'off'}\n\nWe set up your eSIM automatically after payment and send the QR code right here.\n\nSelect payment method:`,
    noBank: '⚠️ The eSIM can be paid from your wallet or directly in crypto.',
    placed: (p, bal) => `✅ <b>Paid $${p}.</b> Your eSIM is being set up — usually a few minutes, sometimes longer.\n\nWe’ll send the QR code here as soon as it’s ready.\n👛 Wallet balance: $${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 Your $${p} crypto payment was added to your wallet.`,
    none: 'You don’t have any eSIMs yet.',
    pick: '📋 <b>My eSIMs</b>\n\nPick one to manage:',
    settingUp: 'Setting up',
    status: { provisioning: '⏳ Setting up', active: '🟢 Active', suspended: '⏸ Paused (renewal unpaid)', failed: '❌ Failed (refunded)' },
    line: (l, s) => `📱 <b>USA T-Mobile eSIM</b>\n\nNumber: ${l.phoneNumber || 'being assigned'}\nStatus: ${s}\nPrice: $${l.price}/month\n${l.expiresAt ? `Active until: ${day(l.expiresAt)}\n` : ''}🔁 Auto-renew: <b>${l.autoRenew ? 'on' : 'off'}</b>${l.autoRenew && l.nextBillAt ? ` (wallet charged on ${day(l.nextBillAt)})` : ''}\n📧 QR email: ${l.qrEmail || 'none'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ Turn auto-renew off', turnOn: '✅ Turn auto-renew on', qr: '📷 Show QR code', emailQr: '📧 Email me the QR code', renewNow: '💳 Renew now from wallet',
    renewSet: (on) => on ? '✅ Auto-renew is on. The monthly price is taken from your wallet one day before renewal.' : '⏹ Auto-renew is off. The line ends on its expiry date unless you turn it back on.',
    qrNotReady: '⏳ The QR code isn’t ready yet. We’ll send it here as soon as the eSIM is set up.',
    askQrEmail: '📧 Send the email address for the QR code.',
    emailed: (e) => `✅ QR code sent to ${e}. Check your inbox and spam folder.`,
    renewed: '✅ Renewed. Your eSIM is active again.',
  },
  fr: {
    home: (p) => `📱 <b>eSIM USA T-Mobile — ${p} $/mois</b>\n\n• Un numéro américain sur le réseau T-Mobile\n• SMS dans les deux sens : envoyez et recevez des textos sur votre téléphone\n• Appels et données aux USA\n• Installation en scannant un QR code (iPhone et Android compatibles eSIM)\n• Renouvellement mensuel depuis votre portefeuille ; désactivable à tout moment\n\nIl vous faut l’IMEI de votre téléphone (composez *#06#).`,
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
    summary: (o, p) => `💰 <b>Commande : eSIM USA T-Mobile</b>\n\n💵 Prix : <b>${p} $/mois</b>\n📟 IMEI : <code>${o.imei}</code>\n📍 Code postal : ${o.zipcode || 'indifférent'}\n📧 E-mail : ${o.email || 'aucun'}\n🔁 Renouvellement auto : ${o.autoRenew ? 'activé' : 'désactivé'}\n\nNous créons votre eSIM automatiquement après le paiement et envoyons le QR code ici.\n\nChoisissez le mode de paiement :`,
    noBank: '⚠️ L’eSIM se paie avec votre portefeuille ou directement en crypto.',
    placed: (p, bal) => `✅ <b>${p} $ payés.</b> Votre eSIM est en cours de création — en général quelques minutes, parfois plus.\n\nNous enverrons le QR code ici dès qu’il sera prêt.\n👛 Solde du portefeuille : ${bal} $`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 Votre paiement crypto de ${p} $ a été ajouté à votre portefeuille.`,
    none: 'Vous n’avez pas encore d’eSIM.',
    pick: '📋 <b>Mes eSIM</b>\n\nChoisissez-en une à gérer :',
    settingUp: 'En création',
    status: { provisioning: '⏳ En création', active: '🟢 Active', suspended: '⏸ Suspendue (renouvellement impayé)', failed: '❌ Échec (remboursée)' },
    line: (l, s) => `📱 <b>eSIM USA T-Mobile</b>\n\nNuméro : ${l.phoneNumber || 'en attribution'}\nStatut : ${s}\nPrix : ${l.price} $/mois\n${l.expiresAt ? `Active jusqu’au : ${day(l.expiresAt)}\n` : ''}🔁 Renouvellement auto : <b>${l.autoRenew ? 'activé' : 'désactivé'}</b>${l.autoRenew && l.nextBillAt ? ` (prélèvement le ${day(l.nextBillAt)})` : ''}\n📧 E-mail du QR : ${l.qrEmail || 'aucun'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ Désactiver le renouvellement auto', turnOn: '✅ Activer le renouvellement auto', qr: '📷 Voir le QR code', emailQr: '📧 M’envoyer le QR code par e-mail', renewNow: '💳 Renouveler depuis le portefeuille',
    renewSet: (on) => on ? '✅ Renouvellement auto activé. Le prix mensuel est prélevé sur votre portefeuille la veille du renouvellement.' : '⏹ Renouvellement auto désactivé. La ligne se termine à sa date d’expiration sauf si vous le réactivez.',
    qrNotReady: '⏳ Le QR code n’est pas encore prêt. Nous l’enverrons ici dès que l’eSIM sera créée.',
    askQrEmail: '📧 Envoyez l’adresse e-mail pour le QR code.',
    emailed: (e) => `✅ QR code envoyé à ${e}. Vérifiez votre boîte de réception et vos spams.`,
    renewed: '✅ Renouvelée. Votre eSIM est de nouveau active.',
  },
  hi: {
    home: (p) => `📱 <b>USA T-Mobile eSIM — $${p}/माह</b>\n\n• T-Mobile नेटवर्क पर एक USA फ़ोन नंबर\n• दो-तरफ़ा SMS: अपने फ़ोन पर टेक्स्ट भेजें और पाएं\n• कॉल और USA डेटा\n• QR कोड स्कैन करके इंस्टॉल करें (eSIM वाले iPhone और Android)\n• हर महीने वॉलेट से रिन्यू; ऑटो-रिन्यू कभी भी बंद करें\n\nआपको अपने फ़ोन का IMEI चाहिए (*#06# डायल करें)।`,
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
    summary: (o, p) => `💰 <b>ऑर्डर: USA T-Mobile eSIM</b>\n\n💵 कीमत: <b>$${p}/माह</b>\n📟 IMEI: <code>${o.imei}</code>\n📍 ZIP: ${o.zipcode || 'कोई भी'}\n📧 ईमेल: ${o.email || 'नहीं'}\n🔁 ऑटो-रिन्यू: ${o.autoRenew ? 'चालू' : 'बंद'}\n\nभुगतान के बाद हम eSIM अपने-आप बनाते हैं और QR कोड यहीं भेजते हैं।\n\nभुगतान का तरीका चुनें:`,
    noBank: '⚠️ eSIM का भुगतान वॉलेट से या सीधे क्रिप्टो में होता है।',
    placed: (p, bal) => `✅ <b>$${p} का भुगतान हुआ।</b> आपका eSIM बन रहा है — आमतौर पर कुछ मिनट, कभी-कभी ज़्यादा।\n\nतैयार होते ही QR कोड यहीं भेजेंगे।\n👛 वॉलेट बैलेंस: $${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 आपका $${p} क्रिप्टो भुगतान वॉलेट में जोड़ दिया गया।`,
    none: 'आपके पास अभी कोई eSIM नहीं है।',
    pick: '📋 <b>मेरे eSIM</b>\n\nप्रबंधित करने के लिए एक चुनें:',
    settingUp: 'बन रहा है',
    status: { provisioning: '⏳ बन रहा है', active: '🟢 सक्रिय', suspended: '⏸ रुका हुआ (रिन्यूअल बाकी)', failed: '❌ विफल (रिफंड)' },
    line: (l, s) => `📱 <b>USA T-Mobile eSIM</b>\n\nनंबर: ${l.phoneNumber || 'दिया जा रहा है'}\nस्थिति: ${s}\nकीमत: $${l.price}/माह\n${l.expiresAt ? `सक्रिय तक: ${day(l.expiresAt)}\n` : ''}🔁 ऑटो-रिन्यू: <b>${l.autoRenew ? 'चालू' : 'बंद'}</b>${l.autoRenew && l.nextBillAt ? ` (वॉलेट से ${day(l.nextBillAt)} को)` : ''}\n📧 QR ईमेल: ${l.qrEmail || 'नहीं'}${l.note ? `\n\nℹ️ ${l.note}` : ''}`,
    turnOff: '⏹ ऑटो-रिन्यू बंद करें', turnOn: '✅ ऑटो-रिन्यू चालू करें', qr: '📷 QR कोड दिखाएं', emailQr: '📧 QR कोड ईमेल करें', renewNow: '💳 वॉलेट से अभी रिन्यू करें',
    renewSet: (on) => on ? '✅ ऑटो-रिन्यू चालू है। मासिक कीमत रिन्यूअल से एक दिन पहले वॉलेट से ली जाती है।' : '⏹ ऑटो-रिन्यू बंद है। दोबारा चालू न करने पर लाइन समाप्ति तिथि पर बंद होगी।',
    qrNotReady: '⏳ QR कोड अभी तैयार नहीं है। eSIM बनते ही यहीं भेजेंगे।',
    askQrEmail: '📧 QR कोड के लिए ईमेल पता भेजें।',
    emailed: (e) => `✅ QR कोड ${e} पर भेजा गया। इनबॉक्स और स्पैम देखें।`,
    renewed: '✅ रिन्यू हो गया। आपका eSIM फिर से सक्रिय है।',
  },
  zh: {
    home: (p) => `📱 <b>美国 T-Mobile eSIM — $${p}/月</b>\n\n• T-Mobile 网络上的美国电话号码\n• 双向短信：在手机上收发短信\n• 通话和美国流量\n• 扫描二维码安装（支持 eSIM 的 iPhone 和安卓）\n• 每月从钱包自动续费；可随时关闭\n\n您需要手机的 IMEI（拨打 *#06#）。`,
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
    summary: (o, p) => `💰 <b>订单：美国 T-Mobile eSIM</b>\n\n💵 价格：<b>$${p}/月</b>\n📟 IMEI：<code>${o.imei}</code>\n📍 邮编：${o.zipcode || '不限'}\n📧 邮箱：${o.email || '无'}\n🔁 自动续费：${o.autoRenew ? '开启' : '关闭'}\n\n付款后我们会自动开通 eSIM，并在这里发送二维码。\n\n请选择付款方式：`,
    noBank: '⚠️ eSIM 可用钱包或直接用加密货币付款。',
    placed: (p, bal) => `✅ <b>已支付 $${p}。</b>您的 eSIM 正在开通 — 通常几分钟，有时更久。\n\n准备好后我们会在这里发送二维码。\n👛 钱包余额：$${bal}`,
    failed: (m) => `⚠️ ${m}`,
    toWallet: (p) => `💵 您的 $${p} 加密货币付款已存入钱包。`,
    none: '您还没有 eSIM。',
    pick: '📋 <b>我的 eSIM</b>\n\n选择要管理的 eSIM：',
    settingUp: '开通中',
    status: { provisioning: '⏳ 开通中', active: '🟢 使用中', suspended: '⏸ 已暂停（未续费）', failed: '❌ 失败（已退款）' },
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

const parseImei = (m) => { const x = String(m || '').replace(/\D/g, ''); return x.length === 15 && luhn(x) ? x : null }
const parseZip = (m) => (/^\d{5}$/.test(String(m || '').trim()) ? String(m).trim() : null)
const parseEmail = (m) => { const x = String(m || '').trim().toLowerCase(); return EMAIL_RE.test(x) ? x : null }

// The plan the web sells (same price); null when none is on sale.
async function plan() {
  const p = (await ES.forSale().catch(() => [])).find(x => x.simId)
  return p ? { planId: p.planId, price: p.price } : null
}
const lineLabel = (l, lang) => `📱 ${l.phoneNumber || s(lang).settingUp} · ${l.id.slice(-6)}`
const lineFromLabel = (lines, m) => lines.find(l => String(m || '').endsWith(`· ${l.id.slice(-6)}`)) || null
const lines = async (chatId) => (await ES.list(chatId)).filter(l => l.status !== 'failed')

// Wallet-paid order. ES.buy debits the wallet and refunds it if Spenza refuses.
async function fulfill(db, chatId, order, lang) {
  const r = await ES.buy(chatId, { ...order, source: 'telegram' })
  if (r.error) return { ok: false, text: s(lang).failed(r.error) }
  const bal = round2(await walletOps(db).balance(chatId)).toFixed(2)
  return { ok: true, text: s(lang).placed(r.item.price, bal), lineId: r.item.id }
}
// Direct crypto: the confirmed payment goes into the wallet, then the same wallet order runs.
async function fulfillPaid(db, chatId, order, price, lang) {
  await walletOps(db).credit(chatId, price)
  const r = await fulfill(db, chatId, order, lang)
  return r.ok ? r : { ...r, text: `${r.text}\n\n${s(lang).toWallet(price)}` }
}

module.exports = { PRODUCT_KEY, PRODUCT_NAME, PRICE, s, parseImei, parseZip, parseEmail, plan, lines, lineLabel, lineFromLabel, fulfill, fulfillPaid, ES }
