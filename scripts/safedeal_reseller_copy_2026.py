"""Marketplace escrow → SafeDeal (safedeal.sh) + Reseller 50/50 copy for js/lang/{en,fr,hi,zh}.js."""
import re, sys

LANG_DIR = '/app/js/lang'
N = '${Number(price).toFixed(2)}'

FULL = {
 'en': {
  'mpHome': r""" mpHome: `🏪 <b>${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()} MARKETPLACE</b>\n\n💰 <b>Sell your digital goods</b> — list in 60 seconds, get paid safely through escrow\n🛍️ <b>Find exclusive deals</b> — verified sellers, real transactions\n\n🔒 <b>ESCROW IS MANDATORY</b> — every purchase goes through <b>SafeDeal</b> (safedeal.sh)\n⚠️ NEVER pay sellers directly or through their bots — use SafeDeal escrow ONLY.\n\n👇 Ready to earn or shop?`,""",
  'mpAiScamWarning': r""" mpAiScamWarning: `🚨 <b>AI Safety Alert</b>\n\n⚠️ This message may contain a suspicious payment request. Remember:\n\n🔒 <b>ALWAYS pay through SafeDeal escrow</b> — only links starting with https://safedeal.sh\n❌ NEVER send money via PayPal, CashApp, crypto, wire transfer or any other "escrow" bot\n📢 Type /report if you feel unsafe\n\nYour protection is our priority.`,""",
  'mpProductPublished': r""" mpProductPublished: `🎉 Your listing is LIVE!\n\nBuyers can now discover it in the marketplace.\n\n⚠️ <b>Reminder:</b> All sales must go through SafeDeal escrow (safedeal.sh). Deliver only after SafeDeal shows the deal as <b>Funded</b>.\n\n💡 <b>Tips to sell faster:</b>\n• Respond to inquiries within minutes\n• Add clear photos & detailed descriptions\n• Price competitively`,""",
  'mpChatStartBuyer': r""" mpChatStartBuyer: (title, price) =>
 `💬 You're chatting with the seller about <b>${title}</b> ($${price})\n\n⚠️ <b>ESCROW IS MANDATORY</b> — when you're ready to buy, type /escrow to pay safely through SafeDeal\n❌ Do NOT pay the seller directly or through any bot.\n\n💡 Ask for details or proof before purchasing.\nSend /done to end chat.`,""",
  'mpChatStartSeller': r""" mpChatStartSeller: (title) =>
 `💬 🔔 A buyer is interested in <b>${title}</b>!\n🔒 Escrow-protected via SafeDeal — deliver only after the deal shows <b>Funded</b>\n\n💡 Tip: Respond quickly — fast sellers close more deals.\nReply below. Send /done to end chat.`,""",
  'mpPaymentWarning': r""" mpPaymentWarning: `🚨 <b>WARNING: Direct payment detected!</b>\n\n❌ NEVER send money directly to the seller, to a wallet address, or through any bot.\n🔒 SafeDeal escrow (safedeal.sh) is <b>MANDATORY</b> — it's the only way to protect your money. Type /escrow to start.\n📢 Type /report if you feel unsafe.`,""",
  'mpResumedChat': r""" mpResumedChat: (title, price, role) => `💬 Resumed chat: <b>${title}</b> ($${price}) — You are the ${role}\n⚠️ <b>ESCROW MANDATORY</b> — pay only through SafeDeal (safedeal.sh). Never pay the seller directly or through their bot.\n\nSend /done to exit, /escrow to start escrow, /price XX to suggest price.`,""",
  'mpEscrowMsg': r""" mpEscrowBuyer: (title, price) =>
 `🔒 <b>Pay safely with SafeDeal escrow</b>\n\n📦 Product: <b>${title}</b>\n💰 Price: <b>$N</b>\n\n1. Tap <b>Open SafeDeal</b> → choose <b>I'm buying</b>\n2. Deal name: <code>${title}</code> (tap to copy)\n3. Price: <code>N</code> (tap to copy)\n4. Choose <b>Share a link</b> → sign in with your email code\n5. <b>Paste the invite link here</b> so the seller can accept\n6. Pay on SafeDeal — your money is held until you confirm delivery\n\n💡 SafeDeal fee: 5% (min $10), paid by the buyer by default.\n⚠️ Never pay the seller directly.`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>The buyer is starting SafeDeal escrow</b>\n\n📦 Product: <b>${title}</b>\n💰 Price: <b>$N</b>\n\n1. Wait for the buyer's <b>safedeal.sh invite link</b> in this chat\n2. Open it, sign in with your email code and <b>accept</b>\n3. Deliver <b>only after</b> SafeDeal shows <b>Funded</b>\n4. You're paid when the buyer releases — add a USDT/USDC payout address on SafeDeal\n\n💡 Buyer stuck? Create it yourself: <b>Open SafeDeal</b> → <b>I'm selling</b> → name <code>${title}</code>, price <code>N</code> → <b>Share a link</b> → paste it here.`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>Escrow can't start at $N</b>\n\nSafeDeal accepts deals from <b>$30 to $3,000</b>. Agree a price in that range in this chat — e.g. type <code>/price 50</code> — then type /escrow again.`,
 mpOpenSafeDeal: '🔒 Open SafeDeal',
 mpSafeDealLinkNote: `🔒 <b>That's a SafeDeal escrow invite</b> — the safe way to do this deal.\nOpen it, sign in with your email code and accept. The buyer pays on SafeDeal; the seller delivers only after it shows <b>Funded</b>.`,""",
 },
 'fr': {
  'mpHome': r""" mpHome: `🏪 <b>MARCHÉ ${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()}</b>\n\n💰 <b>Vendez vos produits numériques</b> — publiez en 60 secondes, soyez payé en toute sécurité via l'escrow\n🛍️ <b>Trouvez des offres exclusives</b> — vendeurs vérifiés, transactions réelles\n\n🔒 <b>ESCROW OBLIGATOIRE</b> — chaque achat passe par <b>SafeDeal</b> (safedeal.sh)\n⚠️ Ne payez JAMAIS le vendeur directement ou via son bot — utilisez UNIQUEMENT l'escrow SafeDeal.\n\n👇 Prêt à gagner ou acheter ?`,""",
  'mpAiScamWarning': r""" mpAiScamWarning: `🚨 <b>Alerte Sécurité IA</b>\n\n⚠️ Ce message peut contenir une demande de paiement suspecte. Rappel :\n\n🔒 <b>Payez TOUJOURS via l'escrow SafeDeal</b> — uniquement les liens commençant par https://safedeal.sh\n❌ N'envoyez JAMAIS d'argent via PayPal, CashApp, crypto, virement ou tout autre bot « escrow »\n📢 Tapez /report si vous vous sentez en danger\n\nVotre protection est notre priorité.`,""",
  'mpProductPublished': r""" mpProductPublished: `🎉 Votre annonce est EN LIGNE !\n\nLes acheteurs peuvent maintenant la découvrir.\n\n⚠️ <b>Rappel :</b> Toutes les ventes doivent passer par l'escrow SafeDeal (safedeal.sh). Livrez uniquement quand SafeDeal affiche l'accord comme <b>Funded</b> (financé).\n\n💡 <b>Conseils pour vendre plus vite :</b>\n• Répondez rapidement aux demandes\n• Ajoutez des photos claires et descriptions détaillées\n• Fixez un prix compétitif`,""",
  'mpChatStartBuyer': r""" mpChatStartBuyer: (title, price) =>
 `💬 Vous discutez avec le vendeur de <b>${title}</b> ($${price})\n\n⚠️ <b>ESCROW OBLIGATOIRE</b> — quand vous êtes prêt à acheter, tapez /escrow pour payer en sécurité via SafeDeal\n❌ Ne payez JAMAIS le vendeur directement ou via un bot.\n\n💡 Demandez des détails ou preuves avant d'acheter.\nEnvoyez /done pour quitter.`,""",
  'mpChatStartSeller': r""" mpChatStartSeller: (title) =>
 `💬 🔔 Un acheteur s'intéresse à <b>${title}</b> !\n🔒 Protégé par escrow via SafeDeal — livrez uniquement quand l'accord affiche <b>Funded</b> (financé)\n\n💡 Conseil : Répondez vite — les vendeurs rapides concluent plus de ventes.\nRépondez ci-dessous. Envoyez /done pour quitter.`,""",
  'mpPaymentWarning': r""" mpPaymentWarning: `🚨 <b>ATTENTION : Paiement direct détecté !</b>\n\n❌ N'envoyez JAMAIS d'argent directement au vendeur, à une adresse de portefeuille ou via un bot.\n🔒 L'escrow SafeDeal (safedeal.sh) est <b>OBLIGATOIRE</b> — c'est la seule façon de protéger votre argent. Tapez /escrow pour commencer.\n📢 Tapez /report si vous êtes en danger.`,""",
  'mpResumedChat': r""" mpResumedChat: (title, price, role) => `💬 Chat repris : <b>${title}</b> (${price} $) — Vous êtes ${role}\n⚠️ <b>ESCROW OBLIGATOIRE</b> — payez uniquement via SafeDeal (safedeal.sh). Ne payez jamais le vendeur directement ou via son bot.\n\nEnvoyez /done pour quitter, /escrow pour démarrer l'escrow, /price XX pour proposer un prix.`,""",
  'mpEscrowMsg': r""" mpEscrowBuyer: (title, price) =>
 `🔒 <b>Payez en sécurité avec l'escrow SafeDeal</b>\n\n📦 Produit : <b>${title}</b>\n💰 Prix : <b>$N</b>\n\n1. Touchez <b>Ouvrir SafeDeal</b> → choisissez <b>I'm buying</b> (j'achète)\n2. Nom de l'accord : <code>${title}</code> (touchez pour copier)\n3. Prix : <code>N</code> (touchez pour copier)\n4. Choisissez <b>Share a link</b> (partager un lien) → connectez-vous avec le code reçu par e-mail\n5. <b>Collez le lien d'invitation ici</b> pour que le vendeur accepte\n6. Payez sur SafeDeal — votre argent est bloqué jusqu'à ce que vous confirmiez la livraison\n\n💡 Frais SafeDeal : 5 % (min. 10 $), payés par l'acheteur par défaut.\n⚠️ Ne payez jamais le vendeur directement.`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>L'acheteur lance l'escrow SafeDeal</b>\n\n📦 Produit : <b>${title}</b>\n💰 Prix : <b>$N</b>\n\n1. Attendez le <b>lien d'invitation safedeal.sh</b> de l'acheteur dans ce chat\n2. Ouvrez-le, connectez-vous avec le code reçu par e-mail et <b>acceptez</b>\n3. Livrez <b>uniquement</b> quand SafeDeal affiche <b>Funded</b> (financé)\n4. Vous êtes payé quand l'acheteur libère les fonds — ajoutez une adresse de paiement USDT/USDC sur SafeDeal\n\n💡 L'acheteur est bloqué ? Créez-le vous-même : <b>Ouvrir SafeDeal</b> → <b>I'm selling</b> (je vends) → nom <code>${title}</code>, prix <code>N</code> → <b>Share a link</b> → collez-le ici.`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>Impossible de lancer l'escrow à $N</b>\n\nSafeDeal accepte les accords de <b>30 $ à 3 000 $</b>. Convenez d'un prix dans cette fourchette dans ce chat — par ex. tapez <code>/price 50</code> — puis tapez à nouveau /escrow.`,
 mpOpenSafeDeal: '🔒 Ouvrir SafeDeal',
 mpSafeDealLinkNote: `🔒 <b>C'est une invitation escrow SafeDeal</b> — la façon sûre de conclure cet accord.\nOuvrez-la, connectez-vous avec le code reçu par e-mail et acceptez. L'acheteur paie sur SafeDeal ; le vendeur livre uniquement quand l'accord affiche <b>Funded</b> (financé).`,""",
 },
 'hi': {
  'mpHome': r""" mpHome: `🏪 <b>${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()} मार्केटप्लेस</b>\n\n💰 <b>अपने डिजिटल उत्पाद बेचें</b> — 60 सेकंड में लिस्ट करें, एस्क्रो से सुरक्षित भुगतान पाएं\n🛍️ <b>विशेष डील खोजें</b> — सत्यापित विक्रेता, वास्तविक लेनदेन\n\n🔒 <b>एस्क्रो अनिवार्य</b> — हर खरीदारी <b>SafeDeal</b> (safedeal.sh) से होती है\n⚠️ विक्रेता को सीधे या उनके बॉट से कभी भुगतान न करें — केवल SafeDeal एस्क्रो।\n\n👇 कमाने या खरीदने के लिए तैयार?`,""",
  'mpAiScamWarning': r""" mpAiScamWarning: `🚨 <b>AI सुरक्षा अलर्ट</b>\n\n⚠️ इस संदेश में संदिग्ध भुगतान अनुरोध हो सकता है। याद रखें:\n\n🔒 <b>हमेशा SafeDeal एस्क्रो से भुगतान करें</b> — केवल https://safedeal.sh से शुरू होने वाले लिंक\n❌ PayPal, CashApp, क्रिप्टो, वायर ट्रांसफर या किसी दूसरे "एस्क्रो" बॉट से कभी भुगतान न करें\n📢 असुरक्षित महसूस करें तो /report टाइप करें\n\nआपकी सुरक्षा हमारी प्राथमिकता है।`,""",
  'mpProductPublished': r""" mpProductPublished: `🎉 आपकी लिस्टिंग लाइव है!\n\nखरीदार अब इसे खोज सकते हैं।\n\n⚠️ <b>याद रखें:</b> सभी बिक्री SafeDeal एस्क्रो (safedeal.sh) से होनी चाहिए। डील <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करें।\n\n💡 <b>तेज़ बिक्री के टिप्स:</b>\n• पूछताछ का जल्दी जवाब दें\n• स्पष्ट फोटो और विस्तृत विवरण जोड़ें\n• प्रतिस्पर्धी मूल्य रखें`,""",
  'mpChatStartBuyer': r""" mpChatStartBuyer: (title, price) =>
 `💬 आप विक्रेता से <b>${title}</b> ($${price}) के बारे में बात कर रहे हैं\n\n⚠️ <b>एस्क्रो अनिवार्य</b> — खरीदने के लिए तैयार हों तो SafeDeal से सुरक्षित भुगतान के लिए /escrow टाइप करें\n❌ विक्रेता को सीधे या किसी बॉट से कभी भुगतान न करें।\n\n💡 खरीदने से पहले विवरण या सबूत मांगें।\nचैट समाप्त करने के लिए /done भेजें।`,""",
  'mpChatStartSeller': r""" mpChatStartSeller: (title) =>
 `💬 🔔 एक खरीदार <b>${title}</b> में रुचि रखता है!\n🔒 SafeDeal एस्क्रो द्वारा सुरक्षित — डील <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करें\n\n💡 टिप: जल्दी जवाब दें — तेज़ विक्रेता ज़्यादा बिक्री करते हैं।\nनीचे जवाब दें। चैट समाप्त करने के लिए /done भेजें।`,""",
  'mpPaymentWarning': r""" mpPaymentWarning: `🚨 <b>चेतावनी: सीधा भुगतान पकड़ा गया!</b>\n\n❌ विक्रेता को सीधे, किसी वॉलेट पते पर या किसी बॉट से कभी भुगतान न करें।\n🔒 SafeDeal एस्क्रो (safedeal.sh) <b>अनिवार्य</b> है — आपके पैसे की सुरक्षा का यही एकमात्र तरीका है। शुरू करने के लिए /escrow टाइप करें।\n📢 असुरक्षित महसूस करें तो /report टाइप करें।`,""",
  'mpResumedChat': r""" mpResumedChat: (title, price, role) => `💬 चैट फिर से शुरू: <b>${title}</b> ($${price}) — आप ${role} हैं\n⚠️ <b>एस्क्रो अनिवार्य</b> — केवल SafeDeal (safedeal.sh) से भुगतान। विक्रेता को सीधे या उनके बॉट से कभी भुगतान न करें।\n\nबाहर निकलने के लिए /done भेजें, एस्क्रो शुरू करने के लिए /escrow, कीमत सुझाने के लिए /price XX भेजें।`,""",
  'mpEscrowMsg': r""" mpEscrowBuyer: (title, price) =>
 `🔒 <b>SafeDeal एस्क्रो से सुरक्षित भुगतान करें</b>\n\n📦 उत्पाद: <b>${title}</b>\n💰 कीमत: <b>$N</b>\n\n1. <b>SafeDeal खोलें</b> दबाएं → <b>I'm buying</b> (मैं खरीद रहा हूँ) चुनें\n2. डील का नाम: <code>${title}</code> (कॉपी करने के लिए टैप करें)\n3. कीमत: <code>N</code> (कॉपी करने के लिए टैप करें)\n4. <b>Share a link</b> (लिंक शेयर करें) चुनें → ईमेल कोड से साइन इन करें\n5. <b>इनवाइट लिंक यहाँ पेस्ट करें</b> ताकि विक्रेता स्वीकार कर सके\n6. SafeDeal पर भुगतान करें — डिलीवरी की पुष्टि करने तक आपका पैसा सुरक्षित रखा जाता है\n\n💡 SafeDeal शुल्क: 5% (न्यूनतम $10), डिफ़ॉल्ट रूप से खरीदार देता है।\n⚠️ विक्रेता को कभी सीधे भुगतान न करें।`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>खरीदार SafeDeal एस्क्रो शुरू कर रहा है</b>\n\n📦 उत्पाद: <b>${title}</b>\n💰 कीमत: <b>$N</b>\n\n1. इस चैट में खरीदार के <b>safedeal.sh इनवाइट लिंक</b> का इंतज़ार करें\n2. इसे खोलें, ईमेल कोड से साइन इन करें और <b>स्वीकार करें</b>\n3. SafeDeal पर <b>Funded</b> (फ़ंडेड) दिखने के <b>बाद ही</b> डिलीवर करें\n4. खरीदार के रिलीज़ करने पर आपको भुगतान मिलेगा — SafeDeal पर USDT/USDC पेआउट पता जोड़ें\n\n💡 खरीदार अटक गया? खुद बनाएं: <b>SafeDeal खोलें</b> → <b>I'm selling</b> (मैं बेच रहा हूँ) → नाम <code>${title}</code>, कीमत <code>N</code> → <b>Share a link</b> → यहाँ पेस्ट करें।`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>$N पर एस्क्रो शुरू नहीं हो सकता</b>\n\nSafeDeal <b>$30 से $3,000</b> तक की डील स्वीकार करता है। इस चैट में इस सीमा में कीमत तय करें — जैसे <code>/price 50</code> टाइप करें — फिर दोबारा /escrow टाइप करें।`,
 mpOpenSafeDeal: '🔒 SafeDeal खोलें',
 mpSafeDealLinkNote: `🔒 <b>यह SafeDeal एस्क्रो इनवाइट है</b> — इस डील का सुरक्षित तरीका।\nइसे खोलें, ईमेल कोड से साइन इन करें और स्वीकार करें। खरीदार SafeDeal पर भुगतान करता है; विक्रेता <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करता है।`,""",
 },
 'zh': {
  'mpHome': r""" mpHome: `🏪 <b>${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()} 市场</b>\n\n💰 <b>出售你的数字商品</b> — 60秒发布，通过托管安全收款\n🛍️ <b>发现独家优惠</b> — 经验证的卖家，真实交易\n\n🔒 <b>必须使用托管</b> — 所有购买都通过 <b>SafeDeal</b>（safedeal.sh）完成\n⚠️ 切勿直接向卖家或通过卖家的机器人付款 — 仅限 SafeDeal 托管。\n\n👇 准备好赚钱或购物了吗？`,""",
  'mpAiScamWarning': r""" mpAiScamWarning: `🚨 <b>AI安全警报</b>\n\n⚠️ 此消息可能包含可疑的付款请求。请记住：\n\n🔒 <b>始终通过 SafeDeal 托管付款</b> — 仅限以 https://safedeal.sh 开头的链接\n❌ 切勿通过 PayPal、CashApp、加密货币、电汇或任何其他"托管"机器人付款\n📢 如果您感到不安全，请输入 /report\n\n您的安全是我们的首要任务。`,""",
  'mpProductPublished': r""" mpProductPublished: `🎉 您的商品已上线！\n\n买家现在可以发现它。\n\n⚠️ <b>提醒：</b>所有销售必须通过 SafeDeal 托管（safedeal.sh）。只有在 SafeDeal 显示 <b>Funded</b>（已注资）后才交付。\n\n💡 <b>快速出售技巧：</b>\n• 快速回复咨询\n• 添加清晰的照片和详细描述\n• 设定有竞争力的价格`,""",
  'mpChatStartBuyer': r""" mpChatStartBuyer: (title, price) =>
 `💬 您正在与卖家讨论 <b>${title}</b>（$${price}）\n\n⚠️ <b>必须使用托管</b> — 准备购买时，输入 /escrow 通过 SafeDeal 安全支付\n❌ 切勿直接向卖家或通过任何机器人付款。\n\n💡 购买前请索要详情或证明。\n发送 /done 结束聊天。`,""",
  'mpChatStartSeller': r""" mpChatStartSeller: (title) =>
 `💬 🔔 一位买家对 <b>${title}</b> 感兴趣！\n🔒 通过 SafeDeal 托管保护 — 仅在交易显示 <b>Funded</b>（已注资）后交付\n\n💡 提示：快速回复 — 响应快的卖家成交更多。\n在下方回复。发送 /done 结束聊天。`,""",
  'mpPaymentWarning': r""" mpPaymentWarning: `🚨 <b>警告：检测到直接付款请求！</b>\n\n❌ 切勿直接向卖家、钱包地址或通过任何机器人付款。\n🔒 SafeDeal 托管（safedeal.sh）是<b>强制性的</b> — 这是保护您资金的唯一方式。输入 /escrow 开始。\n📢 如感到不安全，请输入 /report。`,""",
  'mpResumedChat': r""" mpResumedChat: (title, price, role) => `💬 恢复聊天：<b>${title}</b>（$${price}）— 您是${role}\n⚠️ <b>必须使用托管</b> — 仅通过 SafeDeal（safedeal.sh）付款。切勿直接向卖家或通过其机器人付款。\n\n发送 /done 退出，/escrow 开始托管，/price XX 建议价格。`,""",
  'mpEscrowMsg': r""" mpEscrowBuyer: (title, price) =>
 `🔒 <b>通过 SafeDeal 托管安全付款</b>\n\n📦 商品：<b>${title}</b>\n💰 价格：<b>$N</b>\n\n1. 点击 <b>打开 SafeDeal</b> → 选择 <b>I'm buying</b>（我是买家）\n2. 交易名称：<code>${title}</code>（点击复制）\n3. 价格：<code>N</code>（点击复制）\n4. 选择 <b>Share a link</b>（分享链接）→ 用邮箱验证码登录\n5. <b>把邀请链接粘贴到这里</b>，方便卖家接受\n6. 在 SafeDeal 付款 — 资金会被托管，直到您确认收货\n\n💡 SafeDeal 手续费：5%（最低 $10），默认由买家支付。\n⚠️ 切勿直接向卖家付款。`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>买家正在发起 SafeDeal 托管</b>\n\n📦 商品：<b>${title}</b>\n💰 价格：<b>$N</b>\n\n1. 在此聊天中等待买家的 <b>safedeal.sh 邀请链接</b>\n2. 打开链接，用邮箱验证码登录并<b>接受</b>\n3. <b>只有在</b> SafeDeal 显示 <b>Funded</b>（已注资）后才交付\n4. 买家放款后您即可收款 — 请在 SafeDeal 上添加 USDT/USDC 收款地址\n\n💡 买家卡住了？您也可以自己创建：<b>打开 SafeDeal</b> → <b>I'm selling</b>（我是卖家）→ 名称 <code>${title}</code>，价格 <code>N</code> → <b>Share a link</b> → 粘贴到这里。`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>无法以 $N 发起托管</b>\n\nSafeDeal 接受 <b>$30 至 $3,000</b> 的交易。请在此聊天中商定该范围内的价格 — 例如输入 <code>/price 50</code> — 然后再次输入 /escrow。`,
 mpOpenSafeDeal: '🔒 打开 SafeDeal',
 mpSafeDealLinkNote: `🔒 <b>这是 SafeDeal 托管邀请</b> — 完成这笔交易的安全方式。\n打开链接，用邮箱验证码登录并接受。买家在 SafeDeal 付款；卖家在显示 <b>Funded</b>（已注资）后才交付。`,""",
 },
}

# Lockbay tails inside otherwise-unchanged strings
SUBS = {
 'en': [('🔒 Escrow Protected via @Lockbaybot', '🔒 Escrow protected via SafeDeal (safedeal.sh)'),
        ('🔒 ⚠️ Escrow Mandatory — pay via @Lockbaybot only', '🔒 ⚠️ Escrow mandatory — pay through SafeDeal only'),
        ('Pay ONLY via @Lockbaybot escrow.', 'Pay ONLY through SafeDeal escrow (safedeal.sh).')],
 'fr': [('🔒 Protégé par escrow via @Lockbaybot', '🔒 Protégé par escrow via SafeDeal (safedeal.sh)'),
        ('🔒 ⚠️ Escrow obligatoire — payez via @Lockbaybot uniquement', '🔒 ⚠️ Escrow obligatoire — payez uniquement via SafeDeal'),
        ('Payez UNIQUEMENT via @Lockbaybot.', "Payez UNIQUEMENT via l'escrow SafeDeal (safedeal.sh).")],
 'hi': [('🔒 @Lockbaybot एस्क्रो द्वारा सुरक्षित', '🔒 SafeDeal (safedeal.sh) एस्क्रो द्वारा सुरक्षित'),
        ('🔒 ⚠️ एस्क्रो अनिवार्य — केवल @Lockbaybot से भुगतान', '🔒 ⚠️ एस्क्रो अनिवार्य — केवल SafeDeal से भुगतान'),
        ('केवल @Lockbaybot एस्क्रो से भुगतान करें।', 'केवल SafeDeal एस्क्रो (safedeal.sh) से भुगतान करें।')],
 'zh': [('🔒 通过 @Lockbaybot 托管保护', '🔒 通过 SafeDeal（safedeal.sh）托管保护'),
        ('🔒 ⚠️ 必须使用托管 — 仅通过 @Lockbaybot 付款', '🔒 ⚠️ 必须使用托管 — 仅通过 SafeDeal 付款'),
        ('仅通过 @Lockbaybot 托管付款。', '仅通过 SafeDeal 托管（safedeal.sh）付款。')],
}

RESELLER = {
 'en': ("<b>65/35%</b> profit share on every sale. Tap 💬 <b>Support</b> to get started.`",
        "<b>50/50</b> profit share on every sale.\n\n🤖 <b>Ask our AI assistant anything about reselling</b> — just type your question below. A human from our team joins if needed.\n\nSend /done to close this chat.`"),
 'fr': ("<b>65/35%</b> de partage des bénéfices. Appuyez sur 💬 <b>Obtenir de l'aide</b> pour commencer.`",
        "<b>50/50</b> de partage des bénéfices sur chaque vente.\n\n🤖 <b>Posez toutes vos questions sur la revente à notre assistant IA</b> — écrivez simplement ci-dessous. Un membre de notre équipe prend le relais si besoin.\n\nEnvoyez /done pour fermer ce chat.`"),
 'hi': ("हर बिक्री पर <b>65/35%</b> लाभ। शुरू करने के लिए 💬 <b>सहायता प्राप्त करें</b> दबाएं।`",
        "हर बिक्री पर <b>50/50</b> लाभ बँटवारा।\n\n🤖 <b>रीसेलिंग के बारे में हमारे AI असिस्टेंट से कुछ भी पूछें</b> — बस नीचे अपना सवाल लिखें। ज़रूरत होने पर हमारी टीम का कोई सदस्य जुड़ जाएगा।\n\nयह चैट बंद करने के लिए /done भेजें।`"),
 'zh': ("每笔销售<b>65/35%</b>利润分成。点击 💬 <b>获取支持</b> 开始合作。`",
        "每笔销售 <b>50/50</b> 利润分成。\n\n🤖 <b>关于经销的任何问题都可以问我们的 AI 助手</b> — 直接在下方输入问题即可。如有需要，我们的团队成员会加入。\n\n发送 /done 结束此对话。`"),
}

PRICE_KEYS = ('mpEnterPrice', 'mpPriceError', 'mpPriceInvalid')


def fix_price(line):
    line = re.sub(r'(?<![\d.,])20(?![\d])', '30', line)
    return re.sub(r'5([ ,.\u202f]?)000', lambda m: '3' + m.group(1) + '000', line)


for lang in ['en', 'fr', 'hi', 'zh']:
    p = f'{LANG_DIR}/{lang}.js'
    lines = open(p, encoding='utf-8').read().split('\n')
    out, i, done = [], 0, set()
    while i < len(lines):
        ln = lines[i]
        m = re.match(r'^\s*(\w+):', ln)
        key = m.group(1) if m else None
        span = 2 if (key and ln.rstrip().endswith('=>')) else 1
        if key in FULL[lang] and key not in done:
            out.extend(FULL[lang][key].replace('$N', '$' + N).replace('>N<', '>' + N + '<').split('\n'))
            done.add(key); i += span; continue
        if key in PRICE_KEYS and key not in done:
            out.append(fix_price(ln)); done.add(key); i += 1; continue
        out.append(ln); i += 1
    missing = (set(FULL[lang]) | set(PRICE_KEYS)) - done
    assert not missing, (lang, missing)
    s = '\n'.join(out)
    for a, b in SUBS[lang]:
        assert s.count(a) == 1, (lang, a); s = s.replace(a, b)
    a, b = RESELLER[lang]
    assert s.count(a) == 1, (lang, 'reseller'); s = s.replace(a, b)
    assert 'Lockbay' not in s, (lang, 'lockbay left')
    open(p, 'w', encoding='utf-8').write(s)
    print(lang, 'ok')
