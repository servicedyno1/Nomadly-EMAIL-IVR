'use strict'
// Telegram bot: standalone fax numbers — list, buy (country → type → area code → number → paperwork → pay), open.
// Buying, renewals and carrier registration live in fax-numbers.js (shared with the web app). Paperwork details are
// saved per customer (botLegal) and reused; ID documents go to the same numberDocs store as the web upload.
const crypto = require('crypto')
const faxNumbers = require('./fax-numbers')

const L = {
  en: {
    menu: '📠 Fax Numbers', buy: '🛒 Get a Fax Number', anyArea: '🌎 Any area code', more: '🔄 Show more', personal: '👤 Personal', business: '🏢 Business',
    pay: (p) => `✅ Pay $${p}/month from wallet`, useSaved: '♻️ Use my saved details', newDetails: '✏️ Enter new details', sameCountry: (c) => `🏠 In ${c}`, otherCountry: '🌍 Another country',
    docsDone: '✅ Done uploading', useDocs: (n) => `♻️ Use my ${n} saved document(s)`, nameAddr: 'name + address', idDocs: 'ID documents',
    head: (p, f, pp, n) => `📠 <b>Fax Numbers</b>\n\nA fax-only number sends and receives faxes (no calls or texts). <b>$${p}/month</b> · ${f} free pages a month, then $${pp}/page.\nAvailable in ${n} countries.`,
    none: 'You have no fax numbers yet.', stPending: '⏳ waiting for carrier approval', stPaused: '⚠️ paused, top up to renew', stActive: '✅ active',
    unavailable: 'Fax numbers are not available right now. Please try again later.',
    where: '🌍 <b>Where should your fax number be?</b>',
    searching: '🔍 Searching fax numbers…', noneFound: 'No fax numbers found there right now. Try another area code or country.', nearby: (ac) => `ℹ️ No fax numbers in area code ${ac} right now — these are nearby.\n\n`,
    pickHead: (c) => `📠 <b>Pick your fax number</b> — ${c}`, assigned: '… (exact number assigned when you buy)', whichType: (c) => `📱 <b>${c}</b> — which kind of number?`,
    askArea: '🏙️ Type a 3-digit area code (e.g. 212), or tap “Any area code”.', tapNumber: 'Tap one of the numbers above to pick it.',
    review: '🧾 <b>Review & pay</b>', perMonth: (p) => `💰 <b>$${p}/month</b>, renews from your wallet`, pages: (f, pp) => `🆓 ${f} free pages a month, then $${pp}/page`,
    approval: '⏳ The carrier approves this number within a few days and your month starts when it’s live. If it says no, you get a full refund.',
    wallet: (b) => `👛 Wallet: <b>$${b}</b>`, short: (s) => ` — <b>$${s} short</b>. Top up with 👛 Wallet first.`,
    pendingOwn: (n) => `⏳ ${n} is waiting for the carrier’s approval. We’ll message you when it’s live.`, pausedOwn: (n) => `⚠️ ${n} is paused — top up your wallet to renew it.`,
    needDetails: (c) => `👤 ${c} needs the details of who uses this number. Is it for a person or a business?`, bizOnly: (c) => `🏢 ${c} fax numbers are sold to businesses only.`,
    savedAsk: (s) => `👤 Use your saved details?\n\n<b>${s}</b>`, company: 'Type your <b>company name</b>:', fullName: 'Type your <b>full legal name</b> (first and last name):',
    street: '🏠 Type your <b>street and house number</b>:', city: 'Type your <b>city</b>:', postcode: 'Type your <b>postcode</b> (or 0 if there is none):',
    addrIn: (c, area) => `Is this address in ${c}?${area ? ' It has to be in the number’s area.' : ''}`, addrMust: (c) => `<i>${c} needs an address in ${c}.</i>`, addrCountry: 'Type the country of your address (e.g. Germany):',
    badCountry: 'Country not recognised — type it in English, e.g. Germany.', phone: '📞 Type a <b>contact phone number</b> with country code (e.g. +49 30 1234567):', badPhone: 'Please type the phone number with its country code, e.g. +49 30 1234567.',
    docs: (c) => `📄 ${c} needs an ID or company document (passport, ID card or company registration) and, if you have one, a recent utility bill.\n\nSend them here as photos or PDFs (up to 4), then tap “Done uploading”.`,
    docSaved: (n) => `✅ Saved (${n} document${n > 1 ? 's' : ''}). Send more or tap “Done uploading”.`, docNeed: 'Send at least one photo or PDF first.', docBad: '⚠️ Send a PDF, JPG or PNG under 10 MB.',
    sign: (n) => `✍️ <b>Sign electronically</b>\n\nType your full name exactly to sign. By signing you agree that your signature and details are sent to the carrier to register your fax number.\n\nName on file: <b>${n}</b>`, signBad: 'Type your full name to sign (at least 3 letters).',
    tooShort: 'Please type it in full.', paidPending: (n) => `✅ Paid. <b>${n}</b> is waiting for the carrier’s approval (usually a few days). We’ll message you when it can send and receive faxes. If it’s refused, you get a full refund.`,
    paidActive: (n) => `✅ <b>${n}</b> is your fax number. It can send and receive faxes now.`, buyFail: 'The fax number could not be bought right now. Please try again.',
    menuText: (n, u) => `📠 <b>Fax number</b> — ${n.phoneNumber}\n\n🆓 Free pages left this month: <b>${u.left}/${u.free}</b>\n💵 After that: <b>$${u.pagePrice}/page</b> (sent or received) from your wallet\n🔁 $${n.price}/month · ${n.autoRenew ? 'renews' : 'ends'} ${String(n.expiresAt || '').slice(0, 10)}\n\n<i>Received faxes arrive here as PDFs.</i>`,
  },
  fr: {
    menu: '📠 Numéros de fax', buy: '🛒 Obtenir un numéro de fax', anyArea: '🌎 N’importe quel indicatif', more: '🔄 Voir plus', personal: '👤 Particulier', business: '🏢 Entreprise',
    pay: (p) => `✅ Payer ${p} $/mois depuis le portefeuille`, useSaved: '♻️ Utiliser mes informations', newDetails: '✏️ Saisir de nouvelles informations', sameCountry: (c) => `🏠 En ${c}`, otherCountry: '🌍 Autre pays',
    docsDone: '✅ Envoi terminé', useDocs: (n) => `♻️ Utiliser mes ${n} document(s)`, nameAddr: 'nom + adresse', idDocs: 'pièces d’identité',
    head: (p, f, pp, n) => `📠 <b>Numéros de fax</b>\n\nUn numéro fax uniquement envoie et reçoit des fax (pas d’appels ni de SMS). <b>${p} $/mois</b> · ${f} pages gratuites par mois, puis ${pp} $/page.\nDisponible dans ${n} pays.`,
    none: 'Vous n’avez pas encore de numéro de fax.', stPending: '⏳ en attente de l’opérateur', stPaused: '⚠️ suspendu, rechargez pour renouveler', stActive: '✅ actif',
    unavailable: 'Les numéros de fax ne sont pas disponibles pour le moment. Réessayez plus tard.',
    where: '🌍 <b>Dans quel pays voulez-vous votre numéro de fax ?</b>',
    searching: '🔍 Recherche de numéros de fax…', noneFound: 'Aucun numéro de fax disponible ici pour le moment. Essayez un autre indicatif ou pays.', nearby: (ac) => `ℹ️ Aucun numéro de fax avec l’indicatif ${ac} pour le moment — voici des numéros proches.\n\n`,
    pickHead: (c) => `📠 <b>Choisissez votre numéro de fax</b> — ${c}`, assigned: '… (numéro exact attribué à l’achat)', whichType: (c) => `📱 <b>${c}</b> — quel type de numéro ?`,
    askArea: '🏙️ Tapez un indicatif à 3 chiffres (ex. 212) ou touchez « N’importe quel indicatif ».', tapNumber: 'Touchez un des numéros ci-dessus pour le choisir.',
    review: '🧾 <b>Vérifier et payer</b>', perMonth: (p) => `💰 <b>${p} $/mois</b>, renouvelé depuis votre portefeuille`, pages: (f, pp) => `🆓 ${f} pages gratuites par mois, puis ${pp} $/page`,
    approval: '⏳ L’opérateur valide ce numéro sous quelques jours ; votre mois commence quand il est actif. En cas de refus, vous êtes remboursé intégralement.',
    wallet: (b) => `👛 Portefeuille : <b>${b} $</b>`, short: (s) => ` — <b>il manque ${s} $</b>. Rechargez d’abord via 👛 Portefeuille.`,
    pendingOwn: (n) => `⏳ ${n} attend la validation de l’opérateur. Nous vous préviendrons dès qu’il sera actif.`, pausedOwn: (n) => `⚠️ ${n} est suspendu — rechargez votre portefeuille pour le renouveler.`,
    needDetails: (c) => `👤 ${c} demande les informations de l’utilisateur du numéro. Est-ce pour un particulier ou une entreprise ?`, bizOnly: (c) => `🏢 Les numéros de fax ${c} sont réservés aux entreprises.`,
    savedAsk: (s) => `👤 Utiliser vos informations enregistrées ?\n\n<b>${s}</b>`, company: 'Tapez le <b>nom de votre entreprise</b> :', fullName: 'Tapez votre <b>nom légal complet</b> (prénom et nom) :',
    street: '🏠 Tapez votre <b>rue et numéro</b> :', city: 'Tapez votre <b>ville</b> :', postcode: 'Tapez votre <b>code postal</b> (ou 0 s’il n’y en a pas) :',
    addrIn: (c, area) => `Cette adresse est-elle en ${c} ?${area ? ' Elle doit être dans la zone du numéro.' : ''}`, addrMust: (c) => `<i>${c} exige une adresse en ${c}.</i>`, addrCountry: 'Tapez le pays de votre adresse (en anglais, ex. Germany) :',
    badCountry: 'Pays non reconnu — tapez-le en anglais, ex. Germany.', phone: '📞 Tapez un <b>numéro de téléphone de contact</b> avec l’indicatif pays (ex. +33 1 23 45 67 89) :', badPhone: 'Tapez le numéro avec l’indicatif pays, ex. +33 1 23 45 67 89.',
    docs: (c) => `📄 ${c} demande une pièce d’identité ou un document d’entreprise (passeport, carte d’identité ou extrait Kbis) et, si possible, une facture récente.\n\nEnvoyez-les ici en photo ou PDF (jusqu’à 4), puis touchez « Envoi terminé ».`,
    docSaved: (n) => `✅ Enregistré (${n} document${n > 1 ? 's' : ''}). Envoyez-en d’autres ou touchez « Envoi terminé ».`, docNeed: 'Envoyez d’abord au moins une photo ou un PDF.', docBad: '⚠️ Envoyez un PDF, JPG ou PNG de moins de 10 Mo.',
    sign: (n) => `✍️ <b>Signature électronique</b>\n\nTapez votre nom complet pour signer. En signant, vous acceptez que votre signature et vos informations soient envoyées à l’opérateur pour enregistrer votre numéro de fax.\n\nNom enregistré : <b>${n}</b>`, signBad: 'Tapez votre nom complet pour signer (au moins 3 lettres).',
    tooShort: 'Merci de le taper en entier.', paidPending: (n) => `✅ Payé. <b>${n}</b> attend la validation de l’opérateur (quelques jours en général). Nous vous préviendrons quand il pourra envoyer et recevoir des fax. En cas de refus, vous êtes remboursé intégralement.`,
    paidActive: (n) => `✅ <b>${n}</b> est votre numéro de fax. Il peut envoyer et recevoir des fax dès maintenant.`, buyFail: 'Le numéro de fax n’a pas pu être acheté pour le moment. Réessayez.',
    menuText: (n, u) => `📠 <b>Numéro de fax</b> — ${n.phoneNumber}\n\n🆓 Pages gratuites restantes ce mois-ci : <b>${u.left}/${u.free}</b>\n💵 Ensuite : <b>${u.pagePrice} $/page</b> (envoyée ou reçue) depuis votre portefeuille\n🔁 ${n.price} $/mois · ${n.autoRenew ? 'renouvellement' : 'fin'} le ${String(n.expiresAt || '').slice(0, 10)}\n\n<i>Les fax reçus arrivent ici en PDF.</i>`,
  },
  zh: {
    menu: '📠 传真号码', buy: '🛒 获取传真号码', anyArea: '🌎 任意区号', more: '🔄 显示更多', personal: '👤 个人', business: '🏢 企业',
    pay: (p) => `✅ 从钱包支付 $${p}/月`, useSaved: '♻️ 使用已保存的资料', newDetails: '✏️ 填写新资料', sameCountry: (c) => `🏠 在${c}`, otherCountry: '🌍 其他国家',
    docsDone: '✅ 上传完成', useDocs: (n) => `♻️ 使用已保存的 ${n} 份文件`, nameAddr: '姓名 + 地址', idDocs: '身份证件',
    head: (p, f, pp, n) => `📠 <b>传真号码</b>\n\n纯传真号码只能收发传真（不能通话或短信）。<b>$${p}/月</b> · 每月 ${f} 页免费，之后 $${pp}/页。\n覆盖 ${n} 个国家。`,
    none: '您还没有传真号码。', stPending: '⏳ 等待运营商审核', stPaused: '⚠️ 已暂停，请充值续费', stActive: '✅ 使用中',
    unavailable: '传真号码暂时不可用，请稍后再试。',
    where: '🌍 <b>您想要哪个国家的传真号码？</b>',
    searching: '🔍 正在搜索传真号码…', noneFound: '这里暂时没有传真号码，请换个区号或国家。', nearby: (ac) => `ℹ️ 区号 ${ac} 暂无传真号码——以下为附近号码。\n\n`,
    pickHead: (c) => `📠 <b>选择您的传真号码</b> — ${c}`, assigned: '…（购买时分配具体号码）', whichType: (c) => `📱 <b>${c}</b> — 选择号码类型？`,
    askArea: '🏙️ 输入 3 位区号（如 212），或点击“任意区号”。', tapNumber: '请点击上方的号码进行选择。',
    review: '🧾 <b>确认并支付</b>', perMonth: (p) => `💰 <b>$${p}/月</b>，从钱包自动续费`, pages: (f, pp) => `🆓 每月 ${f} 页免费，之后 $${pp}/页`,
    approval: '⏳ 运营商会在几天内审核此号码，开通后开始计月。如被拒绝，将全额退款。',
    wallet: (b) => `👛 钱包：<b>$${b}</b>`, short: (s) => ` — <b>还差 $${s}</b>。请先通过 👛 钱包充值。`,
    pendingOwn: (n) => `⏳ ${n} 正在等待运营商审核，开通后我们会通知您。`, pausedOwn: (n) => `⚠️ ${n} 已暂停——请充值钱包以续费。`,
    needDetails: (c) => `👤 ${c}需要号码使用者的资料。是个人还是企业使用？`, bizOnly: (c) => `🏢 ${c}的传真号码仅售予企业。`,
    savedAsk: (s) => `👤 使用已保存的资料？\n\n<b>${s}</b>`, company: '请输入<b>公司名称</b>：', fullName: '请输入您的<b>法定全名</b>（名和姓）：',
    street: '🏠 请输入<b>街道和门牌号</b>：', city: '请输入<b>城市</b>：', postcode: '请输入<b>邮政编码</b>（没有请输入 0）：',
    addrIn: (c, area) => `此地址在${c}吗？${area ? '必须位于号码所在地区。' : ''}`, addrMust: (c) => `<i>${c}要求地址位于${c}。</i>`, addrCountry: '请输入地址所在国家（英文，如 Germany）：',
    badCountry: '无法识别该国家——请用英文输入，如 Germany。', phone: '📞 请输入带国家代码的<b>联系电话</b>（如 +86 10 1234 5678）：', badPhone: '请输入带国家代码的电话号码，如 +86 10 1234 5678。',
    docs: (c) => `📄 ${c}需要身份证件或公司文件（护照、身份证或营业执照），如有请附上近期水电账单。\n\n请以照片或 PDF 发送（最多 4 份），然后点击“上传完成”。`,
    docSaved: (n) => `✅ 已保存（${n} 份文件）。可继续发送或点击“上传完成”。`, docNeed: '请先发送至少一张照片或一份 PDF。', docBad: '⚠️ 请发送 10 MB 以内的 PDF、JPG 或 PNG。',
    sign: (n) => `✍️ <b>电子签名</b>\n\n请输入您的全名进行签名。签名即表示您同意将签名和资料发送给运营商以登记传真号码。\n\n登记姓名：<b>${n}</b>`, signBad: '请输入全名进行签名（至少 3 个字符）。',
    tooShort: '请完整输入。', paidPending: (n) => `✅ 已支付。<b>${n}</b> 正在等待运营商审核（通常几天）。可以收发传真时我们会通知您。如被拒绝，将全额退款。`,
    paidActive: (n) => `✅ <b>${n}</b> 是您的传真号码，现在即可收发传真。`, buyFail: '暂时无法购买传真号码，请重试。',
    menuText: (n, u) => `📠 <b>传真号码</b> — ${n.phoneNumber}\n\n🆓 本月剩余免费页数：<b>${u.left}/${u.free}</b>\n💵 之后：<b>$${u.pagePrice}/页</b>（发送或接收），从钱包扣费\n🔁 $${n.price}/月 · ${String(n.expiresAt || '').slice(0, 10)} ${n.autoRenew ? '续费' : '到期'}\n\n<i>收到的传真会以 PDF 发到这里。</i>`,
  },
  hi: {
    menu: '📠 फैक्स नंबर', buy: '🛒 फैक्स नंबर लें', anyArea: '🌎 कोई भी एरिया कोड', more: '🔄 और दिखाएँ', personal: '👤 व्यक्तिगत', business: '🏢 व्यवसाय',
    pay: (p) => `✅ वॉलेट से $${p}/माह भुगतान करें`, useSaved: '♻️ मेरी सेव की गई जानकारी इस्तेमाल करें', newDetails: '✏️ नई जानकारी दर्ज करें', sameCountry: (c) => `🏠 ${c} में`, otherCountry: '🌍 दूसरा देश',
    docsDone: '✅ अपलोड पूरा', useDocs: (n) => `♻️ मेरे ${n} सेव किए गए दस्तावेज़ इस्तेमाल करें`, nameAddr: 'नाम + पता', idDocs: 'पहचान दस्तावेज़',
    head: (p, f, pp, n) => `📠 <b>फैक्स नंबर</b>\n\nफैक्स-केवल नंबर फैक्स भेजता और प्राप्त करता है (कॉल या SMS नहीं)। <b>$${p}/माह</b> · हर माह ${f} पेज मुफ्त, फिर $${pp}/पेज।\n${n} देशों में उपलब्ध।`,
    none: 'आपके पास अभी कोई फैक्स नंबर नहीं है।', stPending: '⏳ कैरियर की मंज़ूरी का इंतज़ार', stPaused: '⚠️ रुका हुआ, रिन्यू के लिए टॉप अप करें', stActive: '✅ सक्रिय',
    unavailable: 'फैक्स नंबर अभी उपलब्ध नहीं हैं। कृपया बाद में कोशिश करें।',
    where: '🌍 <b>आपका फैक्स नंबर किस देश में हो?</b>',
    searching: '🔍 फैक्स नंबर खोजे जा रहे हैं…', noneFound: 'अभी वहाँ कोई फैक्स नंबर नहीं मिला। दूसरा एरिया कोड या देश आज़माएँ।', nearby: (ac) => `ℹ️ एरिया कोड ${ac} में अभी फैक्स नंबर नहीं हैं — ये पास के नंबर हैं।\n\n`,
    pickHead: (c) => `📠 <b>अपना फैक्स नंबर चुनें</b> — ${c}`, assigned: '… (खरीदते समय सटीक नंबर मिलेगा)', whichType: (c) => `📱 <b>${c}</b> — किस तरह का नंबर?`,
    askArea: '🏙️ 3 अंकों का एरिया कोड लिखें (जैसे 212), या “कोई भी एरिया कोड” दबाएँ।', tapNumber: 'चुनने के लिए ऊपर दिए किसी नंबर पर टैप करें।',
    review: '🧾 <b>जाँचें और भुगतान करें</b>', perMonth: (p) => `💰 <b>$${p}/माह</b>, वॉलेट से रिन्यू`, pages: (f, pp) => `🆓 हर माह ${f} पेज मुफ्त, फिर $${pp}/पेज`,
    approval: '⏳ कैरियर कुछ दिनों में यह नंबर मंज़ूर करता है और चालू होने पर आपका महीना शुरू होता है। मना करने पर पूरा रिफंड मिलेगा।',
    wallet: (b) => `👛 वॉलेट: <b>$${b}</b>`, short: (s) => ` — <b>$${s} कम</b>। पहले 👛 वॉलेट से टॉप अप करें।`,
    pendingOwn: (n) => `⏳ ${n} कैरियर की मंज़ूरी का इंतज़ार कर रहा है। चालू होने पर हम आपको बताएँगे।`, pausedOwn: (n) => `⚠️ ${n} रुका हुआ है — रिन्यू के लिए वॉलेट टॉप अप करें।`,
    needDetails: (c) => `👤 ${c} को इस नंबर के उपयोगकर्ता की जानकारी चाहिए। यह व्यक्ति के लिए है या व्यवसाय के लिए?`, bizOnly: (c) => `🏢 ${c} के फैक्स नंबर केवल व्यवसायों को बेचे जाते हैं।`,
    savedAsk: (s) => `👤 सेव की गई जानकारी इस्तेमाल करें?\n\n<b>${s}</b>`, company: '<b>कंपनी का नाम</b> लिखें:', fullName: 'अपना <b>पूरा कानूनी नाम</b> लिखें (पहला और अंतिम नाम):',
    street: '🏠 <b>गली और मकान नंबर</b> लिखें:', city: '<b>शहर</b> लिखें:', postcode: '<b>पिन/पोस्टकोड</b> लिखें (न हो तो 0):',
    addrIn: (c, area) => `क्या यह पता ${c} में है?${area ? ' यह नंबर के क्षेत्र में होना चाहिए।' : ''}`, addrMust: (c) => `<i>${c} के लिए पता ${c} में होना चाहिए।</i>`, addrCountry: 'अपने पते का देश लिखें (अंग्रेज़ी में, जैसे Germany):',
    badCountry: 'देश पहचाना नहीं गया — अंग्रेज़ी में लिखें, जैसे Germany।', phone: '📞 देश कोड के साथ <b>संपर्क फ़ोन नंबर</b> लिखें (जैसे +91 98765 43210):', badPhone: 'कृपया देश कोड के साथ फ़ोन नंबर लिखें, जैसे +91 98765 43210।',
    docs: (c) => `📄 ${c} को पहचान या कंपनी दस्तावेज़ (पासपोर्ट, पहचान पत्र या कंपनी रजिस्ट्रेशन) और हो सके तो हाल का यूटिलिटी बिल चाहिए।\n\nइन्हें फोटो या PDF के रूप में यहाँ भेजें (4 तक), फिर “अपलोड पूरा” दबाएँ।`,
    docSaved: (n) => `✅ सेव हुआ (${n} दस्तावेज़)। और भेजें या “अपलोड पूरा” दबाएँ।`, docNeed: 'पहले कम से कम एक फोटो या PDF भेजें।', docBad: '⚠️ 10 MB से छोटी PDF, JPG या PNG भेजें।',
    sign: (n) => `✍️ <b>इलेक्ट्रॉनिक हस्ताक्षर</b>\n\nहस्ताक्षर के लिए अपना पूरा नाम लिखें। हस्ताक्षर करके आप सहमत हैं कि आपका हस्ताक्षर और जानकारी फैक्स नंबर रजिस्टर करने के लिए कैरियर को भेजी जाए।\n\nदर्ज नाम: <b>${n}</b>`, signBad: 'हस्ताक्षर के लिए पूरा नाम लिखें (कम से कम 3 अक्षर)।',
    tooShort: 'कृपया पूरा लिखें।', paidPending: (n) => `✅ भुगतान हो गया। <b>${n}</b> कैरियर की मंज़ूरी का इंतज़ार कर रहा है (आमतौर पर कुछ दिन)। फैक्स भेजने/पाने लायक होते ही हम बताएँगे। मना होने पर पूरा रिफंड मिलेगा।`,
    paidActive: (n) => `✅ <b>${n}</b> आपका फैक्स नंबर है। यह अब फैक्स भेज और पा सकता है।`, buyFail: 'अभी फैक्स नंबर नहीं खरीदा जा सका। कृपया फिर कोशिश करें।',
    menuText: (n, u) => `📠 <b>फैक्स नंबर</b> — ${n.phoneNumber}\n\n🆓 इस माह बचे मुफ्त पेज: <b>${u.left}/${u.free}</b>\n💵 उसके बाद: <b>$${u.pagePrice}/पेज</b> (भेजा या पाया) वॉलेट से\n🔁 $${n.price}/माह · ${String(n.expiresAt || '').slice(0, 10)} को ${n.autoRenew ? 'रिन्यू' : 'समाप्त'}\n\n<i>प्राप्त फैक्स यहाँ PDF में आते हैं।</i>`,
  },
  fa: {
    menu: '📠 شماره فکس', buy: '🛒 دریافت شماره فکس', anyArea: '🌎 هر کد منطقه', more: '🔄 بیشتر', personal: '👤 شخصی', business: '🏢 تجاری',
    pay: (p) => `✅ پرداخت ${p}$ در ماه از کیف پول`, useSaved: '♻️ استفاده از اطلاعات ذخیره‌شده', newDetails: '✏️ وارد کردن اطلاعات جدید', sameCountry: (c) => `🏠 در ${c}`, otherCountry: '🌍 کشور دیگر',
    docsDone: '✅ ارسال تمام شد', useDocs: (n) => `♻️ استفاده از ${n} مدرک ذخیره‌شده`, nameAddr: 'نام + نشانی', idDocs: 'مدارک هویتی',
    head: (p, f, pp, n) => `📠 <b>شماره‌های فکس</b>\n\nشماره فقط‌فکس، فکس می‌فرستد و می‌گیرد (بدون تماس یا پیامک). <b>${p}$ در ماه</b> · ${f} صفحه رایگان در ماه، سپس ${pp}$ برای هر صفحه.\nدر ${n} کشور.`,
    none: 'هنوز شماره فکسی ندارید.', stPending: '⏳ در انتظار تأیید اپراتور', stPaused: '⚠️ متوقف، برای تمدید شارژ کنید', stActive: '✅ فعال',
    unavailable: 'شماره‌های فکس فعلاً در دسترس نیستند. لطفاً بعداً تلاش کنید.',
    where: '🌍 <b>شماره فکس شما در کدام کشور باشد؟</b>',
    searching: '🔍 در حال جستجوی شماره فکس…', noneFound: 'فعلاً شماره فکسی آنجا پیدا نشد. کد منطقه یا کشور دیگری را امتحان کنید.', nearby: (ac) => `ℹ️ فعلاً در کد منطقه ${ac} شماره فکسی نیست — این‌ها شماره‌های نزدیک هستند.\n\n`,
    pickHead: (c) => `📠 <b>شماره فکس خود را انتخاب کنید</b> — ${c}`, assigned: '… (شماره دقیق هنگام خرید تعیین می‌شود)', whichType: (c) => `📱 <b>${c}</b> — چه نوع شماره‌ای؟`,
    askArea: '🏙️ یک کد منطقه ۳ رقمی بنویسید (مثلاً 212) یا «هر کد منطقه» را بزنید.', tapNumber: 'برای انتخاب، یکی از شماره‌های بالا را لمس کنید.',
    review: '🧾 <b>بررسی و پرداخت</b>', perMonth: (p) => `💰 <b>${p}$ در ماه</b>، تمدید از کیف پول`, pages: (f, pp) => `🆓 ${f} صفحه رایگان در ماه، سپس ${pp}$ برای هر صفحه`,
    approval: '⏳ اپراتور ظرف چند روز این شماره را تأیید می‌کند و ماه شما از زمان فعال شدن آغاز می‌شود. در صورت رد، کل مبلغ بازگردانده می‌شود.',
    wallet: (b) => `👛 کیف پول: <b>${b}$</b>`, short: (s) => ` — <b>${s}$ کم است</b>. ابتدا از 👛 کیف پول شارژ کنید.`,
    pendingOwn: (n) => `⏳ ${n} در انتظار تأیید اپراتور است. پس از فعال شدن به شما خبر می‌دهیم.`, pausedOwn: (n) => `⚠️ ${n} متوقف است — برای تمدید، کیف پول را شارژ کنید.`,
    needDetails: (c) => `👤 ${c} اطلاعات کاربر این شماره را لازم دارد. برای شخص است یا کسب‌وکار؟`, bizOnly: (c) => `🏢 شماره‌های فکس ${c} فقط به کسب‌وکارها فروخته می‌شوند.`,
    savedAsk: (s) => `👤 از اطلاعات ذخیره‌شده استفاده شود؟\n\n<b>${s}</b>`, company: '<b>نام شرکت</b> را بنویسید:', fullName: '<b>نام کامل قانونی</b> خود را بنویسید (نام و نام خانوادگی):',
    street: '🏠 <b>خیابان و پلاک</b> را بنویسید:', city: '<b>شهر</b> را بنویسید:', postcode: '<b>کد پستی</b> را بنویسید (اگر ندارد 0):',
    addrIn: (c, area) => `آیا این نشانی در ${c} است؟${area ? ' باید در منطقه شماره باشد.' : ''}`, addrMust: (c) => `<i>${c} نشانی در ${c} لازم دارد.</i>`, addrCountry: 'کشور نشانی خود را بنویسید (به انگلیسی، مثلاً Germany):',
    badCountry: 'کشور شناخته نشد — به انگلیسی بنویسید، مثلاً Germany.', phone: '📞 یک <b>شماره تماس</b> با کد کشور بنویسید (مثلاً +49 30 1234567):', badPhone: 'لطفاً شماره را با کد کشور بنویسید، مثلاً +49 30 1234567.',
    docs: (c) => `📄 ${c} یک مدرک هویتی یا شرکتی (گذرنامه، کارت شناسایی یا ثبت شرکت) و در صورت امکان یک قبض اخیر لازم دارد.\n\nآن‌ها را به صورت عکس یا PDF اینجا بفرستید (حداکثر ۴)، سپس «ارسال تمام شد» را بزنید.`,
    docSaved: (n) => `✅ ذخیره شد (${n} مدرک). بیشتر بفرستید یا «ارسال تمام شد» را بزنید.`, docNeed: 'ابتدا حداقل یک عکس یا PDF بفرستید.', docBad: '⚠️ یک PDF، JPG یا PNG کمتر از ۱۰ مگابایت بفرستید.',
    sign: (n) => `✍️ <b>امضای الکترونیکی</b>\n\nبرای امضا نام کامل خود را بنویسید. با امضا موافقت می‌کنید که امضا و اطلاعات شما برای ثبت شماره فکس به اپراتور ارسال شود.\n\nنام ثبت‌شده: <b>${n}</b>`, signBad: 'برای امضا نام کامل خود را بنویسید (حداقل ۳ حرف).',
    tooShort: 'لطفاً کامل بنویسید.', paidPending: (n) => `✅ پرداخت شد. <b>${n}</b> در انتظار تأیید اپراتور است (معمولاً چند روز). وقتی آماده ارسال و دریافت فکس شد خبر می‌دهیم. در صورت رد، کل مبلغ بازگردانده می‌شود.`,
    paidActive: (n) => `✅ <b>${n}</b> شماره فکس شماست و از همین حالا فکس می‌فرستد و می‌گیرد.`, buyFail: 'فعلاً خرید شماره فکس ممکن نشد. لطفاً دوباره تلاش کنید.',
    menuText: (n, u) => `📠 <b>شماره فکس</b> — ${n.phoneNumber}\n\n🆓 صفحات رایگان باقی‌مانده این ماه: <b>${u.left}/${u.free}</b>\n💵 پس از آن: <b>${u.pagePrice}$ برای هر صفحه</b> (ارسالی یا دریافتی) از کیف پول\n🔁 ${n.price}$ در ماه · ${n.autoRenew ? 'تمدید' : 'پایان'} در ${String(n.expiresAt || '').slice(0, 10)}\n\n<i>فکس‌های دریافتی به صورت PDF اینجا می‌آیند.</i>`,
  },
}
const X = {
  en: { paidNext: (n, c) => `✅ Paid — <b>${n}</b> is reserved for you.\n\nOne more step: the carrier in ${c} needs a few details to switch it on (2 minutes). You can also do it later from 📠 Fax numbers, or cancel there for a full refund.`, finish: '📝 Finish details', cancelRefund: '↩️ Cancel for a refund', refunded: (n, a) => `↩️ ${n} is cancelled and $${a} is back in your wallet.`, needsOwn: (n, d) => `📝 ${n} is paid and reserved — the carrier needs a few details to switch it on. Without them it is refunded automatically on ${d}.`, stNeeds: '📝 paid — details needed' },
  fr: { paidNext: (n, c) => `✅ Payé — <b>${n}</b> vous est réservé.\n\nDernière étape : l’opérateur (${c}) a besoin de quelques informations pour l’activer (2 minutes). Vous pouvez aussi le faire plus tard depuis 📠 Numéros de fax, ou annuler pour un remboursement complet.`, finish: '📝 Compléter mes infos', cancelRefund: '↩️ Annuler et rembourser', refunded: (n, a) => `↩️ ${n} est annulé et ${a} $ sont de retour dans votre portefeuille.`, needsOwn: (n, d) => `📝 ${n} est payé et réservé — l’opérateur a besoin de quelques informations pour l’activer. Sans elles, il est remboursé automatiquement le ${d}.`, stNeeds: '📝 payé — infos requises' },
}
const T = (lang) => ({ ...X.en, ...L.en, ...(L[lang] || {}), ...(X[lang] || {}) })
const ALL_MENU = Object.values(L).map(x => x.menu)
const BTN = { menu: L.en.menu, all: ALL_MENU }
let api = null, pushFn = () => {}, dbRef = null
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const flag = (cc) => String(cc).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
const countryBtn = (c) => `${flag(c.code)} ${c.name}`

function init(db, { notifyAdmin = () => {}, push } = {}) {
  if (push) pushFn = push
  dbRef = db
  // The web app runs its own copy for routes only; this one renews numbers and checks carrier registrations.
  api = faxNumbers.create(db, { notifyAdmin, push: (id, text) => pushFn(id, text), sweep: true })
  return api
}
const isMenu = (m) => ALL_MENU.includes(m)
const faxMenuText = (n, u, lang) => T(lang).menuText({ ...n, phoneNumber: esc(n.phoneNumber) }, u)
const legal = () => dbRef.collection('botLegal')
const docsOf = async (chatId, cc) => ((await dbRef.collection('numberDocs').findOne({ _id: `${chatId}:${cc}` }))?.files || []).filter(f => !f.deleted)

// Photo / PDF sent while the bot waits for ID documents → saved to the shared document store.
async function saveDoc(chatId, cc, buffer, mime, name) {
  const { put, MIME } = require('./cloudivr-web/number-docs')
  const ext = MIME[mime]
  if (!ext || buffer.length > 10 * 1024 * 1024) return null
  const id = crypto.randomUUID()
  const out = await put(`cloudivr/number-docs/${chatId}/${id}.${ext}`, buffer, mime)
  await dbRef.collection('numberDocs').updateOne({ _id: `${chatId}:${cc}` }, { $set: { chatId: String(chatId), country: cc, updatedAt: new Date() }, $push: { files: { id, path: out.path, name: String(name || `document.${ext}`).slice(0, 120), type: mime, size: buffer.length, at: new Date(), deleted: false, source: 'telegram' } } }, { upsert: true })
  return (await docsOf(chatId, cc)).length
}

// ctx: { chatId, message, action, info, lang, setAction, save, send, kb, openFax(phone), hub(), wallet() } → handled?
async function handle(ctx) {
  const { chatId, message, action, info, setAction, save, send, kb } = ctx
  if (!api) return false
  const t = T(ctx.lang), offer = api.offer({ withPaperwork: true })
  const back = /^(⬅️ )?(Back|Retour|返回|वापस|بازگشت)$/i.test(String(message || ''))
  const paperLbl = () => '' // paperwork is only mentioned after payment
  const typeBtn = (x) => `${x.label}${paperLbl(x.paperwork)}`
  const list = async () => {
    const mine = await api.list(chatId)
    await setAction('fxnList')
    const lines = mine.map(n => `• <b>${esc(n.phoneNumber)}</b> (${n.country}) — ${n.registration?.needsDetails ? t.stNeeds : n.status === 'pending_registration' ? t.stPending : n.status === 'past_due' ? t.stPaused : t.stActive}`)
    return send(`${t.head(offer.price, offer.freePages, offer.pagePrice, offer.countries.length)}\n\n${lines.length ? lines.join('\n') : `<i>${t.none}</i>`}`, kb([...mine.filter(n => n.status !== 'released').map(n => [`📠 ${n.phoneNumber}`]), [t.buy]]))
  }
  if (isMenu(message)) return list()
  if (!String(action || '').startsWith('fxn')) return false
  if (!offer.available) { await send(t.unavailable); return true }

  const pickCountry = async () => { await setAction('fxnCountry'); return send(t.where, kb(offer.countries.map(c => [countryBtn(c)]))) }
  const country = offer.countries.find(c => c.code === info?.fxnCountry)
  const type = country?.types.find(x => x.type === info?.fxnType) || country?.types[0]
  const P = info?.fxnPerson || {}
  const setP = async (patch) => { info.fxnPerson = { ...P, ...(info.fxnPerson || {}), ...patch }; await save('fxnPerson', info.fxnPerson) }
  const doSearch = async (areaCode) => {
    await send(t.searching)
    let r
    try { r = await api.search(chatId, country.code, areaCode, type.type) } catch (e) { return send(`⚠️ ${e.message}`, kb([])) }
    await setAction('fxnPick')
    await save('fxnResults', r.numbers.map(n => n.phoneNumber))
    if (!r.numbers.length) return send(t.noneFound, kb([]))
    const note = r.nearbyOnly ? t.nearby(r.areaCode) : ''
    return send(`${note}${t.pickHead(esc(country.name))}\n\n${r.numbers.slice(0, 8).map((n, i) => `${i + 1}. <code>${n.phoneNumber}</code>${n.assigned ? t.assigned : ''}${n.region && n.region.length > 2 ? ` · ${esc(n.region)}` : ''}`).join('\n')}`, kb([...r.numbers.slice(0, 8).map(n => [`📠 ${n.phoneNumber}`]), [t.more]]))
  }
  const askType = async () => {
    if (country.types.length > 1) { await setAction('fxnType'); return send(t.whichType(esc(country.name)), kb(country.types.map(x => [typeBtn(x)]))) }
    await save('fxnType', country.types[0].type)
    if (country.areaCodes) { await setAction('fxnArea'); return send(t.askArea, kb([[t.anyArea]])) }
    return doSearch(null)
  }
  const confirm = async () => {
    const bal = await ctx.wallet()
    await setAction('fxnConfirm')
    const who = ''
    return send(`${t.review}\n\n📠 <b>${esc(info.fxnPick)}</b> · ${esc(country.name)} ${type.label.toLowerCase()}\n${t.perMonth(offer.price)}\n${t.pages(offer.freePages, offer.pagePrice)}${who}\n\n${t.wallet(bal.toFixed(2))}${bal < offer.price ? t.short((offer.price - bal).toFixed(2)) : ''}`, kb(bal >= offer.price ? [[t.pay(offer.price)]] : []))
  }
  // Paperwork chain: who → company → name → street → city → postcode → address country → phone → documents → signature.
  const askWho = async () => {
    const saved = await legal().findOne({ _id: String(chatId) })
    if (saved?.person && !info.fxnFresh && (!type.businessOnly || saved.person.type === 'business')) { await setAction('fxnSaved'); return send(t.savedAsk(esc(`${saved.person.companyName || `${saved.person.firstName} ${saved.person.lastName}`} · ${saved.person.city}, ${saved.person.countryCode}`)), kb([[t.useSaved], [t.newDetails]])) }
    if (type.businessOnly) { await setP({ type: 'business' }); await setAction('fxnCompany'); return send(`${t.bizOnly(esc(country.name))}\n\n${t.company}`, kb([])) }
    await setAction('fxnWho'); return send(t.needDetails(esc(country.name)), kb([[t.personal], [t.business]]))
  }
  const askAddrCountry = async () => {
    if (type.address !== 'any') { await setP({ countryCode: country.code }); return askPhone() }
    await setAction('fxnAddrCountry'); return send(t.addrIn(esc(country.name), false), kb([[t.sameCountry(country.name)], [t.otherCountry]]))
  }
  const askPhone = async () => { await setAction('fxnPhone'); return send(t.phone, kb([])) }
  const askDocs = async () => {
    if (type.paperwork !== 'documents') return askSign()
    const have = (await docsOf(chatId, country.code)).length
    await setAction('fxnDocs')
    return send(t.docs(esc(country.name)), kb(have ? [[t.useDocs(have)], [t.docsDone]] : [[t.docsDone]]))
  }
  const askSign = async () => { const p = info.fxnPerson || {}; await setAction('fxnSign'); return send(t.sign(esc(`${p.firstName || ''} ${p.lastName || ''}`.trim())), kb([])) }
  const text = String(message || '').trim()
  // After payment: the collected details go to the carrier for the paid number.
  const submitDetails = async () => {
    const p = info.fxnPerson || {}
    const endUser = { type: p.type, name: p.companyName || `${p.firstName} ${p.lastName}`, contact: p.companyName ? `${p.firstName} ${p.lastName}` : '', address: [p.address, p.postalCode, p.city, p.countryCode].filter(Boolean).join(', '), countryCode: p.countryCode }
    const person = { ...p, signature: p.signature?.typedName ? require('./multitel/identity').signaturePng(p.signature.typedName) : null }
    try { const n = await api.submitDetails(chatId, info.fxnPaid, { endUser, person }); await save('fxnPaid', null); await send(t.paidPending(esc(n.phoneNumber))) } catch (e) { await send(`⚠️ ${e.message}`) }
    return list()
  }

  if (action === 'fxnList') {
    if (back) return ctx.hub()
    if (message === t.buy) return pickCountry()
    const own = (await api.list(chatId)).find(n => `📠 ${n.phoneNumber}` === message)
    if (own) {
      if (own.status === 'pending_registration') {
        await save('fxnPaid', own.phoneNumber); await save('fxnCountry', own.country); await save('fxnType', own.type); await save('fxnFresh', false)
        await setAction('fxnPend')
        return send(own.registration?.needsDetails ? t.needsOwn(own.phoneNumber, String(own.registration.refundBy || '').slice(0, 10)) : t.pendingOwn(own.phoneNumber), kb([...(own.registration?.needsDetails ? [[t.finish]] : []), [t.cancelRefund]]))
      }
      if (own.status !== 'active') return send(t.pausedOwn(own.phoneNumber))
      return ctx.openFax(own.phoneNumber)
    }
    return list()
  }
  if (action === 'fxnPend') {
    if (back) return list()
    if (message === t.finish) return askWho()
    if (message === t.cancelRefund) {
      try { const r = await api.cancelPending(chatId, info.fxnPaid); await save('fxnPaid', null); await send(t.refunded(esc(info.fxnPaid), r.refunded.toFixed(2))) } catch (e) { await send(`⚠️ ${e.message}`) }
      return list()
    }
    return list()
  }
  if (action === 'fxnCountry') {
    if (back) return list()
    const c = offer.countries.find(x => text.startsWith(countryBtn(x)))
    if (!c) return pickCountry()
    await save('fxnCountry', c.code); await save('fxnType', null); await save('fxnFresh', false)
    return handle({ ...ctx, action: 'fxnCountryChosen', info: { ...info, fxnCountry: c.code, fxnType: null, fxnFresh: false } })
  }
  if (action === 'fxnCountryChosen') return askType()
  if (action === 'fxnType') {
    if (back) return pickCountry()
    const x = country.types.find(y => typeBtn(y) === message)
    if (!x) return askType()
    await save('fxnType', x.type)
    return handle({ ...ctx, action: 'fxnSearchNow', info: { ...info, fxnType: x.type } })
  }
  if (action === 'fxnSearchNow') return doSearch(null)
  if (action === 'fxnArea') {
    if (back) return pickCountry()
    if (message === t.anyArea) return doSearch(null)
    const ac = text.replace(/\D/g, '')
    if (ac.length !== 3) return send(t.askArea, kb([[t.anyArea]]))
    return doSearch(ac)
  }
  if (action === 'fxnPick') {
    if (back) return askType()
    if (message === t.more) return doSearch(null)
    const phone = text.replace(/^📠\s*/, '').trim()
    if (!(info?.fxnResults || []).includes(phone)) return send(t.tapNumber)
    await save('fxnPick', phone); info.fxnPick = phone
    return confirm()
  }
  if (back && /^fxn(Saved|Who|Company|Name|Street|City|Postcode|AddrCountry|AddrType|Phone|Docs|Sign)$/.test(action)) return list()
  if (action === 'fxnSaved') {
    if (message === t.newDetails) { await save('fxnFresh', true); info.fxnFresh = true; info.fxnPerson = {}; await save('fxnPerson', {}); return askWho() }
    if (message !== t.useSaved) return askWho()
    const saved = await legal().findOne({ _id: String(chatId) })
    info.fxnPerson = saved.person; await save('fxnPerson', saved.person)
    if (type.address !== 'any' && saved.person.countryCode !== country.code) { await save('fxnFresh', true); info.fxnFresh = true; return send(t.addrMust(esc(country.name)), kb([])).then(() => askWho()) }
    return askDocs()
  }
  if (action === 'fxnWho') {
    if (message !== t.personal && message !== t.business) return send(t.needDetails(esc(country.name)), kb([[t.personal], [t.business]]))
    await setP({ type: message === t.business ? 'business' : 'personal' })
    if (message === t.business) { await setAction('fxnCompany'); return send(t.company, kb([])) }
    await setAction('fxnName'); return send(t.fullName, kb([]))
  }
  if (action === 'fxnCompany') { if (text.length < 2) return send(t.tooShort); await setP({ companyName: text.slice(0, 120) }); await setAction('fxnName'); return send(t.fullName, kb([])) }
  if (action === 'fxnName') {
    const parts = text.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return send(t.fullName)
    await setP({ firstName: parts[0].slice(0, 60), lastName: parts.slice(1).join(' ').slice(0, 80) }); await setAction('fxnStreet')
    return send(type.address === 'any' ? t.street : `${t.addrMust(esc(country.name))}\n\n${t.street}`, kb([]))
  }
  if (action === 'fxnStreet') { if (text.length < 4) return send(t.tooShort); await setP({ address: text.slice(0, 200) }); await setAction('fxnCity'); return send(t.city, kb([])) }
  if (action === 'fxnCity') { if (text.length < 2) return send(t.tooShort); await setP({ city: text.slice(0, 80) }); await setAction('fxnPostcode'); return send(t.postcode, kb([])) }
  if (action === 'fxnPostcode') { if (!text) return send(t.postcode); await setP({ postalCode: text.slice(0, 20) }); return askAddrCountry() }
  if (action === 'fxnAddrCountry') {
    if (message === t.sameCountry(country.name)) { await setP({ countryCode: country.code }); return askPhone() }
    await setAction('fxnAddrType'); return send(t.addrCountry, kb([]))
  }
  if (action === 'fxnAddrType') {
    const { NAMES } = require('./multitel/countries')
    const cc = Object.keys(NAMES).find(k => NAMES[k].toLowerCase() === text.toLowerCase() || k === text.toUpperCase())
    if (!cc) return send(t.badCountry)
    await setP({ countryCode: cc }); return askPhone()
  }
  if (action === 'fxnPhone') {
    const d = text.replace(/[^\d+]/g, '')
    if (!/^\+?\d{8,15}$/.test(d)) return send(t.badPhone)
    await setP({ phone: d.startsWith('+') ? d : `+${d}`, nationality: (info.fxnPerson || P).countryCode }); return askDocs()
  }
  if (action === 'fxnDocs') {
    if (message === t.docsDone || /^♻️/.test(text)) { if (!(await docsOf(chatId, country.code)).length) return send(t.docNeed); return askSign() }
    return send(t.docNeed)
  }
  if (action === 'fxnSign') {
    if (require('./multitel/identity').latin(text).length < 3 && text.length < 3) return send(t.signBad)
    const p = { ...(info.fxnPerson || {}) }
    p.signature = { mode: 'typed', typedName: text.slice(0, 80), consentAt: new Date(), via: 'telegram' }
    info.fxnPerson = p; await save('fxnPerson', p)
    await legal().updateOne({ _id: String(chatId) }, { $set: { person: p, updatedAt: new Date() } }, { upsert: true })
    return submitDetails()
  }
  if (action === 'fxnConfirm') {
    if (back) return doSearch(null)
    if (message !== t.pay(offer.price)) return confirm()
    try {
      const r = await api.buy(chatId, { phoneNumber: info.fxnPick, autoRenew: true })
      await save('fxnPick', null)
      if (r.number.registration?.needsDetails) { await save('fxnPaid', r.number.phoneNumber); info.fxnPaid = r.number.phoneNumber; await send(t.paidNext(esc(r.number.phoneNumber), esc(country.name))); return askWho() }
      await send(r.number.status === 'pending_registration' ? t.paidPending(esc(r.number.phoneNumber)) : t.paidActive(esc(r.number.phoneNumber)))
      return list()
    } catch (e) {
      await send(`⚠️ ${e.status ? e.message : t.buyFail}`)
      return e.code === 'search_again' ? pickCountry() : list()
    }
  }
  return false
}

module.exports = { BTN, init, handle, faxMenuText, saveDoc, docsOf, isMenu, T, api: () => api }
