/* global process */
// Reseller application — in-bot form behind 💼 Reseller (enabled with RESELLER_APPLY_FORM=true).
// Lifecycle: draft → pending_payment (Priority, unpaid) → pending (in review) → approved | rejected.
//            Side exits: cancelled (draft), withdrawn (by applicant, unpaid only).
// _index.js owns routing, payment rails (wallet / crypto / bank) and the admin alert; this module owns
// steps, validation, copy (en/fr/zh/hi) and every status transition (all atomic).
const crypto = require('crypto')

const PRIORITY_FEE_USD = 200
const STEPS = ['email', 'brand', 'sellMode', 'volume', 'audWhere', 'audSize', 'services', 'note', 'tier', 'review']
const TOTAL = 9
const OPEN = ['pending_payment', 'pending', 'approved']

let col = null
let BRAND = 'Nomadly'
function init({ db, brand }) {
  col = db.collection('resellerApplications')
  col.createIndex({ chatId: 1, status: 1 }).catch(() => {})
  if (brand) BRAND = brand
}

const SVC_KEYS = ['ivr', 'bulkivr', 'sms', 'domains', 'hosting', 'vps', 'short', 'leads']

const L = {
  en: {
    btn: {
      apply: '📝 Apply Now', ask: '💬 Ask a Question', applyAgain: '📝 Apply Again', pay: '💳 Complete Payment',
      switchStd: '🕐 Switch to Standard (Free)', withdraw: '🗑 Withdraw Application', submit: '✅ Submit Application',
      restart: '✏️ Start Over', back: '⬅️ Back', cancel: '❌ Cancel', skip: '⏭ Skip', menu: '🏠 Main Menu',
      cont: n => `➡️ Continue (${n} selected)`,
    },
    opt: {
      sellMode: { bot: '🤖 Own white-label bot', api: '🔌 Reseller API', referral: '🤝 Referral' },
      volume: { v1: '1–10', v2: '11–50', v3: '51–200', v4: '200+' },
      audWhere: { tg: '📣 Telegram channel or group', web: '🌐 Website', social: '📱 Social media', other: '✳️ Other' },
      audSize: { s1: 'Under 1k', s2: '1k–10k', s3: '10k–50k', s4: '50k+' },
      services: { ivr: '📞 Cloud IVR + SIP', bulkivr: '☎️ Bulk IVR Calls', sms: '💬 Bulk SMS', domains: '🌐 Domains', hosting: '🛡️ Anti-Red Hosting', vps: '🖥️ VPS/RDP', short: '🔗 URL Shortener', leads: '🎯 Leads' },
      tier: { standard: '🕐 Standard — Free (3–5 days)', priority: `⚡ Priority — $${PRIORITY_FEE_USD} (24h)` },
    },
    home: b => `💼 <b>Become a ${b} Reseller</b>\n\nSell our full suite under <b>your own brand</b> and keep <b>50%</b> of the profit on every sale.\n\n✓ Your own branded bot, our Reseller API, or simple referrals\n✓ Cloud IVR, Bulk SMS, Domains, Anti-Red Hosting, VPS/RDP & more\n✓ We run the servers, numbers and support — you grow the brand\n\nApplying takes about 2 minutes.`,
    step: (n, title, opt) => `<b>Step ${n} of ${TOTAL} — ${title}</b>${opt ? ' <i>(optional)</i>' : ''}`,
    q: {
      email: ['📧', 'Email', 'Where can we send reseller updates? Type your email, or tap <b>Skip</b>.'],
      brand: ['🏷', 'Brand name', 'What will your customers see? Type the name of your brand.\n<i>e.g. NovaTel, ShadowHost</i>'],
      sellMode: ['🛒', 'How will you sell?', '🤖 <b>Own white-label bot</b> — your brand, your bot, we run everything behind it\n🔌 <b>Reseller API</b> — plug our services into your own site or app\n🤝 <b>Referral</b> — share your link, earn on every sale'],
      volume: ['👥', 'Customers per month', 'How many customers do you expect each month? A rough guess is fine.'],
      audWhere: ['📣', 'Your audience', 'Where do you reach your customers?'],
      audSize: ['📈', 'Audience size', 'Roughly how many people follow you there?'],
      services: ['🧩', 'Services to resell', 'Tap a service to select it — tap again to remove. Pick as many as you like, then tap <b>Continue</b>.'],
      note: ['📝', 'Note to Admin', 'Anything our team should know — your experience, markets, special requests. Type it, or tap <b>Skip</b>.'],
      tier: ['⚡', 'Setup speed', `🕐 <b>Standard — Free</b>\nWe set you up within <b>3–5 business days</b>.\n\n⚡ <b>Priority — $${PRIORITY_FEE_USD}</b>\nSkip the queue. Our team handles you first and your reseller setup is <b>live within 24 hours</b>.`],
    },
    panel: n => `🧩 Selected: <b>${n}</b>`,
    bad: { email: "That doesn't look like an email. Try again, or tap <b>Skip</b>.", brand: 'Please send a brand name between 2 and 40 characters.', pick: 'Please tap one of the buttons below.', services: 'Pick at least one service to continue.', note: 'Please keep your note under 500 characters.' },
    review: s => `📋 <b>Review your application</b>\n\n${s}\n\nAll good? Tap <b>Submit Application</b>.`,
    sum: { tg: 'Telegram', email: 'Email', brand: 'Brand', sell: 'Selling via', vol: 'Customers/month', aud: 'Audience', svc: 'Services', note: 'Note to Admin', tier: 'Setup', std: 'Standard — Free (3–5 business days)', pri: `Priority — $${PRIORITY_FEE_USD} (within 24 hours)` },
    cancelled: '❌ Application cancelled. You can start again anytime from 💼 Reseller.',
    submittedStd: "✅ <b>Application received!</b>\n\nOur team reviews Standard applications within <b>3–5 business days</b>. We'll message you right here with the decision.",
    checkout: `⚡ <b>Priority Reseller Setup — $${PRIORITY_FEE_USD}</b>\n\nYour application is saved. Complete the payment and your reseller setup goes <b>live within 24 hours</b>.`,
    paid: `⚡ <b>Priority confirmed — $${PRIORITY_FEE_USD} received.</b>\n\nYour application is at the front of the queue. We'll message you here within <b>24 hours</b>.`,
    stPendingPay: `⏳ <b>Your reseller application is saved</b>\n\nPriority setup is waiting for payment (<b>$${PRIORITY_FEE_USD}</b>). Complete it to go live within 24 hours — or switch to Standard (free, 3–5 business days).`,
    stPending: (date, pri) => `🕐 <b>Application under review</b>\n\nSubmitted ${date} · ${pri ? '⚡ Priority — decision within 24 hours' : '🕐 Standard — decision within 3–5 business days'}.\n\nWe'll message you here as soon as it's reviewed.`,
    stApproved: b => `🎉 <b>You're an approved ${b} reseller.</b>\n\nOur team will contact you here to finish your setup. Questions? Tap <b>💬 Ask a Question</b>.`,
    switched: "🕐 <b>Switched to Standard (free).</b>\n\nYour application is now in review — expect a decision within <b>3–5 business days</b>.",
    withdrawn: '🗑 Application withdrawn. You can apply again anytime from 💼 Reseller.',
    approved: (b, pri) => `🎉 <b>Approved!</b> Welcome to the ${b} reseller program.\n\nOur team will message you to set up your reseller account within ${pri ? '<b>24 hours</b>' : '<b>3–5 business days</b>'}.`,
    rejected: b => `Thanks for applying to the ${b} reseller program. After review, we can't approve your application right now.\n\nYou're welcome to apply again later from 💼 Reseller.`,
    payClosed: amt => `ℹ️ Your reseller application was already closed, so we added <b>${amt}</b> to your wallet instead.`,
    stale: 'This step is closed.',
    bankPay: ngn => `🏦 <b>Pay ₦${ngn} by bank</b>\n\nTap <b>Make Payment</b> below. As soon as it's confirmed, your Priority setup starts and we'll message you here.`,
  },
  fr: {
    btn: {
      apply: '📝 Postuler', ask: '💬 Poser une question', applyAgain: '📝 Postuler à nouveau', pay: '💳 Finaliser le paiement',
      switchStd: '🕐 Passer en Standard (gratuit)', withdraw: '🗑 Retirer ma candidature', submit: '✅ Envoyer la candidature',
      restart: '✏️ Recommencer', back: '⬅️ Retour', cancel: '❌ Annuler', skip: '⏭ Passer', menu: '🏠 Menu principal',
      cont: n => `➡️ Continuer (${n} choisi${n > 1 ? 's' : ''})`,
    },
    opt: {
      sellMode: { bot: '🤖 Mon bot en marque blanche', api: '🔌 API revendeur', referral: '🤝 Parrainage' },
      volume: { v1: '1–10', v2: '11–50', v3: '51–200', v4: '200+' },
      audWhere: { tg: '📣 Canal ou groupe Telegram', web: '🌐 Site web', social: '📱 Réseaux sociaux', other: '✳️ Autre' },
      audSize: { s1: 'Moins de 1k', s2: '1k–10k', s3: '10k–50k', s4: '50k+' },
      services: { ivr: '📞 Cloud IVR + SIP', bulkivr: '☎️ Appels IVR en masse', sms: '💬 SMS en masse', domains: '🌐 Domaines', hosting: '🛡️ Hébergement Anti-Red', vps: '🖥️ VPS/RDP', short: '🔗 Raccourcisseur d\'URL', leads: '🎯 Leads' },
      tier: { standard: '🕐 Standard — Gratuit (3–5 jours)', priority: `⚡ Prioritaire — ${PRIORITY_FEE_USD} $ (24 h)` },
    },
    home: b => `💼 <b>Devenez revendeur ${b}</b>\n\nVendez toute notre gamme sous <b>votre propre marque</b> et gardez <b>50 %</b> du bénéfice sur chaque vente.\n\n✓ Votre bot à votre marque, notre API revendeur ou du simple parrainage\n✓ Cloud IVR, SMS en masse, domaines, hébergement Anti-Red, VPS/RDP et plus\n✓ Nous gérons serveurs, numéros et support — vous développez la marque\n\nLa candidature prend environ 2 minutes.`,
    step: (n, title, opt) => `<b>Étape ${n} sur ${TOTAL} — ${title}</b>${opt ? ' <i>(facultatif)</i>' : ''}`,
    q: {
      email: ['📧', 'E-mail', 'Où pouvons-nous vous envoyer les nouvelles revendeur ? Tapez votre e-mail ou touchez <b>Passer</b>.'],
      brand: ['🏷', 'Nom de marque', 'Que verront vos clients ? Tapez le nom de votre marque.\n<i>ex. NovaTel, ShadowHost</i>'],
      sellMode: ['🛒', 'Comment allez-vous vendre ?', '🤖 <b>Mon bot en marque blanche</b> — votre marque, votre bot, nous gérons tout derrière\n🔌 <b>API revendeur</b> — intégrez nos services à votre site ou app\n🤝 <b>Parrainage</b> — partagez votre lien, gagnez sur chaque vente'],
      volume: ['👥', 'Clients par mois', 'Combien de clients attendez-vous par mois ? Une estimation suffit.'],
      audWhere: ['📣', 'Votre audience', 'Où touchez-vous vos clients ?'],
      audSize: ['📈', 'Taille de l\'audience', 'Combien de personnes vous suivent à peu près ?'],
      services: ['🧩', 'Services à revendre', 'Touchez un service pour le choisir — touchez à nouveau pour le retirer. Choisissez-en autant que vous voulez, puis touchez <b>Continuer</b>.'],
      note: ['📝', 'Note à l\'admin', 'Ce que notre équipe doit savoir — expérience, marchés, demandes spéciales. Tapez-le ou touchez <b>Passer</b>.'],
      tier: ['⚡', 'Vitesse de mise en place', `🕐 <b>Standard — Gratuit</b>\nMise en place sous <b>3 à 5 jours ouvrés</b>.\n\n⚡ <b>Prioritaire — ${PRIORITY_FEE_USD} $</b>\nPassez devant la file. Notre équipe vous traite en premier et votre activité revendeur est <b>en ligne sous 24 heures</b>.`],
    },
    panel: n => `🧩 Choisis : <b>${n}</b>`,
    bad: { email: 'Cet e-mail ne semble pas valide. Réessayez ou touchez <b>Passer</b>.', brand: 'Envoyez un nom de marque de 2 à 40 caractères.', pick: 'Touchez l\'un des boutons ci-dessous.', services: 'Choisissez au moins un service pour continuer.', note: 'Gardez votre note sous 500 caractères.' },
    review: s => `📋 <b>Vérifiez votre candidature</b>\n\n${s}\n\nTout est bon ? Touchez <b>Envoyer la candidature</b>.`,
    sum: { tg: 'Telegram', email: 'E-mail', brand: 'Marque', sell: 'Vente via', vol: 'Clients/mois', aud: 'Audience', svc: 'Services', note: 'Note à l\'admin', tier: 'Mise en place', std: 'Standard — Gratuit (3–5 jours ouvrés)', pri: `Prioritaire — ${PRIORITY_FEE_USD} $ (sous 24 heures)` },
    cancelled: '❌ Candidature annulée. Vous pouvez recommencer à tout moment depuis 💼 Revendeur.',
    submittedStd: '✅ <b>Candidature reçue !</b>\n\nNotre équipe examine les candidatures Standard sous <b>3 à 5 jours ouvrés</b>. Nous vous répondrons ici.',
    checkout: `⚡ <b>Mise en place prioritaire — ${PRIORITY_FEE_USD} $</b>\n\nVotre candidature est enregistrée. Finalisez le paiement et votre activité revendeur est <b>en ligne sous 24 heures</b>.`,
    paid: `⚡ <b>Priorité confirmée — ${PRIORITY_FEE_USD} $ reçus.</b>\n\nVotre candidature passe en tête de file. Nous vous répondrons ici sous <b>24 heures</b>.`,
    stPendingPay: `⏳ <b>Votre candidature revendeur est enregistrée</b>\n\nLa mise en place prioritaire attend le paiement (<b>${PRIORITY_FEE_USD} $</b>). Payez pour être en ligne sous 24 heures — ou passez en Standard (gratuit, 3 à 5 jours ouvrés).`,
    stPending: (date, pri) => `🕐 <b>Candidature en cours d'examen</b>\n\nEnvoyée le ${date} · ${pri ? '⚡ Prioritaire — réponse sous 24 heures' : '🕐 Standard — réponse sous 3 à 5 jours ouvrés'}.\n\nNous vous répondrons ici dès qu'elle sera examinée.`,
    stApproved: b => `🎉 <b>Vous êtes revendeur ${b} approuvé.</b>\n\nNotre équipe vous contactera ici pour finaliser la mise en place. Une question ? Touchez <b>💬 Poser une question</b>.`,
    switched: '🕐 <b>Passé en Standard (gratuit).</b>\n\nVotre candidature est en cours d\'examen — réponse sous <b>3 à 5 jours ouvrés</b>.',
    withdrawn: '🗑 Candidature retirée. Vous pouvez postuler à nouveau à tout moment depuis 💼 Revendeur.',
    approved: (b, pri) => `🎉 <b>Approuvé !</b> Bienvenue dans le programme revendeur ${b}.\n\nNotre équipe vous contactera pour configurer votre compte revendeur sous ${pri ? '<b>24 heures</b>' : '<b>3 à 5 jours ouvrés</b>'}.`,
    rejected: b => `Merci d'avoir postulé au programme revendeur ${b}. Après examen, nous ne pouvons pas approuver votre candidature pour le moment.\n\nVous pourrez postuler à nouveau plus tard depuis 💼 Revendeur.`,
    payClosed: amt => `ℹ️ Votre candidature revendeur était déjà clôturée, nous avons donc ajouté <b>${amt}</b> à votre portefeuille.`,
    stale: 'Cette étape est terminée.',
    bankPay: ngn => `🏦 <b>Payez ${ngn} ₦ par virement</b>\n\nTouchez <b>Make Payment</b> ci-dessous. Dès confirmation, votre mise en place prioritaire démarre et nous vous écrivons ici.`,
  },
  zh: {
    btn: {
      apply: '📝 立即申请', ask: '💬 咨询问题', applyAgain: '📝 重新申请', pay: '💳 完成付款',
      switchStd: '🕐 改为标准（免费）', withdraw: '🗑 撤回申请', submit: '✅ 提交申请',
      restart: '✏️ 重新开始', back: '⬅️ 返回', cancel: '❌ 取消', skip: '⏭ 跳过', menu: '🏠 主菜单',
      cont: n => `➡️ 继续（已选 ${n} 项）`,
    },
    opt: {
      sellMode: { bot: '🤖 自有白标机器人', api: '🔌 代理商 API', referral: '🤝 推荐' },
      volume: { v1: '1–10', v2: '11–50', v3: '51–200', v4: '200+' },
      audWhere: { tg: '📣 Telegram 频道或群组', web: '🌐 网站', social: '📱 社交媒体', other: '✳️ 其他' },
      audSize: { s1: '少于 1k', s2: '1k–10k', s3: '10k–50k', s4: '50k+' },
      services: { ivr: '📞 云 IVR + SIP', bulkivr: '☎️ 批量 IVR 呼叫', sms: '💬 批量短信', domains: '🌐 域名', hosting: '🛡️ Anti-Red 主机', vps: '🖥️ VPS/RDP', short: '🔗 短链接', leads: '🎯 线索' },
      tier: { standard: '🕐 标准 — 免费（3–5 天）', priority: `⚡ 优先 — $${PRIORITY_FEE_USD}（24 小时）` },
    },
    home: b => `💼 <b>成为 ${b} 代理商</b>\n\n以<b>您自己的品牌</b>销售我们的全套服务，每笔销售保留 <b>50%</b> 利润。\n\n✓ 自有品牌机器人、代理商 API 或简单推荐\n✓ 云 IVR、批量短信、域名、Anti-Red 主机、VPS/RDP 等\n✓ 服务器、号码和客服由我们负责 — 您专注发展品牌\n\n申请大约需要 2 分钟。`,
    step: (n, title, opt) => `<b>第 ${n} 步（共 ${TOTAL} 步）— ${title}</b>${opt ? ' <i>（可选）</i>' : ''}`,
    q: {
      email: ['📧', '邮箱', '我们把代理商通知发到哪里？输入您的邮箱，或点击<b>跳过</b>。'],
      brand: ['🏷', '品牌名称', '您的客户会看到什么名字？输入您的品牌名称。\n<i>例如 NovaTel、ShadowHost</i>'],
      sellMode: ['🛒', '您将如何销售？', '🤖 <b>自有白标机器人</b> — 您的品牌、您的机器人，后台由我们运营\n🔌 <b>代理商 API</b> — 把我们的服务接入您的网站或应用\n🤝 <b>推荐</b> — 分享您的链接，每笔销售都有收益'],
      volume: ['👥', '每月客户数', '您预计每月有多少客户？大概估计即可。'],
      audWhere: ['📣', '您的受众', '您在哪里接触客户？'],
      audSize: ['📈', '受众规模', '大约有多少人关注您？'],
      services: ['🧩', '要代理的服务', '点击服务即可选择，再点一次取消。可多选，选好后点击<b>继续</b>。'],
      note: ['📝', '给管理员的留言', '希望我们团队了解的信息 — 经验、市场、特殊需求。输入内容，或点击<b>跳过</b>。'],
      tier: ['⚡', '开通速度', `🕐 <b>标准 — 免费</b>\n<b>3–5 个工作日</b>内为您开通。\n\n⚡ <b>优先 — $${PRIORITY_FEE_USD}</b>\n免排队，团队优先处理，代理商服务<b>24 小时内上线</b>。`],
    },
    panel: n => `🧩 已选：<b>${n}</b>`,
    bad: { email: '这似乎不是有效的邮箱。请重试，或点击<b>跳过</b>。', brand: '请发送 2 到 40 个字符的品牌名称。', pick: '请点击下方的按钮。', services: '请至少选择一项服务再继续。', note: '留言请控制在 500 个字符以内。' },
    review: s => `📋 <b>请核对您的申请</b>\n\n${s}\n\n确认无误？点击<b>提交申请</b>。`,
    sum: { tg: 'Telegram', email: '邮箱', brand: '品牌', sell: '销售方式', vol: '每月客户', aud: '受众', svc: '服务', note: '给管理员的留言', tier: '开通', std: '标准 — 免费（3–5 个工作日）', pri: `优先 — $${PRIORITY_FEE_USD}（24 小时内）` },
    cancelled: '❌ 申请已取消。您可以随时从 💼 代理商 重新开始。',
    submittedStd: '✅ <b>已收到您的申请！</b>\n\n我们会在 <b>3–5 个工作日</b>内审核标准申请，并在这里通知您结果。',
    checkout: `⚡ <b>优先代理商开通 — $${PRIORITY_FEE_USD}</b>\n\n您的申请已保存。完成付款后，代理商服务将在 <b>24 小时内上线</b>。`,
    paid: `⚡ <b>已确认优先 — 收到 $${PRIORITY_FEE_USD}。</b>\n\n您的申请已排在最前面，我们会在 <b>24 小时</b>内在这里联系您。`,
    stPendingPay: `⏳ <b>您的代理商申请已保存</b>\n\n优先开通正在等待付款（<b>$${PRIORITY_FEE_USD}</b>）。付款后 24 小时内上线 — 或改为标准（免费，3–5 个工作日）。`,
    stPending: (date, pri) => `🕐 <b>申请审核中</b>\n\n提交于 ${date} · ${pri ? '⚡ 优先 — 24 小时内答复' : '🕐 标准 — 3–5 个工作日内答复'}。\n\n审核完成后我们会在这里通知您。`,
    stApproved: b => `🎉 <b>您已成为 ${b} 认证代理商。</b>\n\n我们的团队会在这里联系您完成开通。有问题？点击<b>💬 咨询问题</b>。`,
    switched: '🕐 <b>已改为标准（免费）。</b>\n\n您的申请正在审核中 — 预计 <b>3–5 个工作日</b>内答复。',
    withdrawn: '🗑 申请已撤回。您可以随时从 💼 代理商 重新申请。',
    approved: (b, pri) => `🎉 <b>已通过！</b>欢迎加入 ${b} 代理商计划。\n\n我们的团队会在${pri ? '<b>24 小时</b>' : '<b>3–5 个工作日</b>'}内联系您开通代理商账户。`,
    rejected: b => `感谢您申请 ${b} 代理商计划。经审核，我们暂时无法通过您的申请。\n\n欢迎稍后从 💼 代理商 重新申请。`,
    payClosed: amt => `ℹ️ 您的代理商申请已关闭，因此我们已将 <b>${amt}</b> 存入您的钱包。`,
    stale: '此步骤已结束。',
    bankPay: ngn => `🏦 <b>银行支付 ₦${ngn}</b>\n\n点击下方 <b>Make Payment</b>。确认到账后立即开始优先开通，我们会在这里通知您。`,
  },
  hi: {
    btn: {
      apply: '📝 अभी आवेदन करें', ask: '💬 सवाल पूछें', applyAgain: '📝 फिर से आवेदन करें', pay: '💳 भुगतान पूरा करें',
      switchStd: '🕐 स्टैंडर्ड पर जाएँ (मुफ़्त)', withdraw: '🗑 आवेदन वापस लें', submit: '✅ आवेदन भेजें',
      restart: '✏️ फिर से शुरू करें', back: '⬅️ वापस', cancel: '❌ रद्द करें', skip: '⏭ छोड़ें', menu: '🏠 मुख्य मेनू',
      cont: n => `➡️ आगे बढ़ें (${n} चुने)`,
    },
    opt: {
      sellMode: { bot: '🤖 अपना व्हाइट-लेबल बॉट', api: '🔌 रीसेलर API', referral: '🤝 रेफ़रल' },
      volume: { v1: '1–10', v2: '11–50', v3: '51–200', v4: '200+' },
      audWhere: { tg: '📣 Telegram चैनल या ग्रुप', web: '🌐 वेबसाइट', social: '📱 सोशल मीडिया', other: '✳️ अन्य' },
      audSize: { s1: '1k से कम', s2: '1k–10k', s3: '10k–50k', s4: '50k+' },
      services: { ivr: '📞 Cloud IVR + SIP', bulkivr: '☎️ बल्क IVR कॉल', sms: '💬 बल्क SMS', domains: '🌐 डोमेन', hosting: '🛡️ Anti-Red होस्टिंग', vps: '🖥️ VPS/RDP', short: '🔗 URL शॉर्टनर', leads: '🎯 लीड्स' },
      tier: { standard: '🕐 स्टैंडर्ड — मुफ़्त (3–5 दिन)', priority: `⚡ प्राथमिकता — $${PRIORITY_FEE_USD} (24 घंटे)` },
    },
    home: b => `💼 <b>${b} रीसेलर बनें</b>\n\nहमारी पूरी सर्विस <b>अपने ब्रांड</b> के नाम से बेचें और हर बिक्री पर <b>50%</b> मुनाफ़ा रखें।\n\n✓ अपना ब्रांडेड बॉट, हमारा रीसेलर API, या आसान रेफ़रल\n✓ Cloud IVR, बल्क SMS, डोमेन, Anti-Red होस्टिंग, VPS/RDP और भी बहुत कुछ\n✓ सर्वर, नंबर और सपोर्ट हम संभालते हैं — आप ब्रांड बढ़ाइए\n\nआवेदन में लगभग 2 मिनट लगते हैं।`,
    step: (n, title, opt) => `<b>चरण ${n} / ${TOTAL} — ${title}</b>${opt ? ' <i>(वैकल्पिक)</i>' : ''}`,
    q: {
      email: ['📧', 'ईमेल', 'रीसेलर अपडेट कहाँ भेजें? अपना ईमेल लिखें, या <b>छोड़ें</b> दबाएँ।'],
      brand: ['🏷', 'ब्रांड का नाम', 'आपके ग्राहक कौन-सा नाम देखेंगे? अपने ब्रांड का नाम लिखें।\n<i>जैसे NovaTel, ShadowHost</i>'],
      sellMode: ['🛒', 'आप कैसे बेचेंगे?', '🤖 <b>अपना व्हाइट-लेबल बॉट</b> — आपका ब्रांड, आपका बॉट, पीछे सब हम चलाते हैं\n🔌 <b>रीसेलर API</b> — हमारी सर्विस अपनी साइट या ऐप में जोड़ें\n🤝 <b>रेफ़रल</b> — अपना लिंक शेयर करें, हर बिक्री पर कमाएँ'],
      volume: ['👥', 'हर महीने ग्राहक', 'हर महीने कितने ग्राहकों की उम्मीद है? अंदाज़ा काफ़ी है।'],
      audWhere: ['📣', 'आपकी ऑडियंस', 'आप अपने ग्राहकों तक कहाँ पहुँचते हैं?'],
      audSize: ['📈', 'ऑडियंस का आकार', 'वहाँ लगभग कितने लोग आपको फ़ॉलो करते हैं?'],
      services: ['🧩', 'बेचने वाली सर्विस', 'सर्विस चुनने के लिए दबाएँ — हटाने के लिए फिर दबाएँ। जितनी चाहें चुनें, फिर <b>आगे बढ़ें</b> दबाएँ।'],
      note: ['📝', 'एडमिन के लिए नोट', 'हमारी टीम को क्या जानना चाहिए — अनुभव, मार्केट, खास ज़रूरतें। लिखें, या <b>छोड़ें</b> दबाएँ।'],
      tier: ['⚡', 'सेटअप की गति', `🕐 <b>स्टैंडर्ड — मुफ़्त</b>\n<b>3–5 कार्य दिवसों</b> में सेटअप।\n\n⚡ <b>प्राथमिकता — $${PRIORITY_FEE_USD}</b>\nकतार छोड़ें। हमारी टीम सबसे पहले आपका काम करती है और रीसेलर सेटअप <b>24 घंटे में लाइव</b> होता है।`],
    },
    panel: n => `🧩 चुने गए: <b>${n}</b>`,
    bad: { email: 'यह ईमेल सही नहीं लगता। फिर कोशिश करें, या <b>छोड़ें</b> दबाएँ।', brand: 'कृपया 2 से 40 अक्षरों का ब्रांड नाम भेजें।', pick: 'कृपया नीचे दिए बटनों में से एक दबाएँ।', services: 'आगे बढ़ने के लिए कम से कम एक सर्विस चुनें।', note: 'कृपया नोट 500 अक्षरों से कम रखें।' },
    review: s => `📋 <b>अपना आवेदन जाँचें</b>\n\n${s}\n\nसब ठीक है? <b>आवेदन भेजें</b> दबाएँ।`,
    sum: { tg: 'Telegram', email: 'ईमेल', brand: 'ब्रांड', sell: 'बिक्री का तरीका', vol: 'ग्राहक/महीना', aud: 'ऑडियंस', svc: 'सर्विस', note: 'एडमिन के लिए नोट', tier: 'सेटअप', std: 'स्टैंडर्ड — मुफ़्त (3–5 कार्य दिवस)', pri: `प्राथमिकता — $${PRIORITY_FEE_USD} (24 घंटे में)` },
    cancelled: '❌ आवेदन रद्द। आप कभी भी 💼 रीसेलर से फिर शुरू कर सकते हैं।',
    submittedStd: '✅ <b>आवेदन मिल गया!</b>\n\nहमारी टीम स्टैंडर्ड आवेदनों की समीक्षा <b>3–5 कार्य दिवसों</b> में करती है। फ़ैसला यहीं भेजेंगे।',
    checkout: `⚡ <b>प्राथमिकता रीसेलर सेटअप — $${PRIORITY_FEE_USD}</b>\n\nआपका आवेदन सेव हो गया है। भुगतान पूरा करें और आपका रीसेलर सेटअप <b>24 घंटे में लाइव</b> होगा।`,
    paid: `⚡ <b>प्राथमिकता पक्की — $${PRIORITY_FEE_USD} मिल गए।</b>\n\nआपका आवेदन कतार में सबसे आगे है। हम <b>24 घंटे</b> में यहीं संपर्क करेंगे।`,
    stPendingPay: `⏳ <b>आपका रीसेलर आवेदन सेव है</b>\n\nप्राथमिकता सेटअप भुगतान का इंतज़ार कर रहा है (<b>$${PRIORITY_FEE_USD}</b>)। 24 घंटे में लाइव होने के लिए भुगतान करें — या स्टैंडर्ड पर जाएँ (मुफ़्त, 3–5 कार्य दिवस)।`,
    stPending: (date, pri) => `🕐 <b>आवेदन की समीक्षा जारी</b>\n\n${date} को भेजा · ${pri ? '⚡ प्राथमिकता — 24 घंटे में फ़ैसला' : '🕐 स्टैंडर्ड — 3–5 कार्य दिवसों में फ़ैसला'}।\n\nसमीक्षा होते ही हम यहीं बताएँगे।`,
    stApproved: b => `🎉 <b>आप ${b} के स्वीकृत रीसेलर हैं।</b>\n\nसेटअप पूरा करने के लिए हमारी टीम यहीं संपर्क करेगी। सवाल? <b>💬 सवाल पूछें</b> दबाएँ।`,
    switched: '🕐 <b>स्टैंडर्ड (मुफ़्त) पर बदल दिया।</b>\n\nआपका आवेदन समीक्षा में है — <b>3–5 कार्य दिवसों</b> में फ़ैसला।',
    withdrawn: '🗑 आवेदन वापस ले लिया। आप कभी भी 💼 रीसेलर से फिर आवेदन कर सकते हैं।',
    approved: (b, pri) => `🎉 <b>स्वीकृत!</b> ${b} रीसेलर प्रोग्राम में आपका स्वागत है।\n\nहमारी टीम ${pri ? '<b>24 घंटे</b>' : '<b>3–5 कार्य दिवसों</b>'} में आपका रीसेलर अकाउंट सेट करने के लिए संपर्क करेगी।`,
    rejected: b => `${b} रीसेलर प्रोग्राम के लिए आवेदन करने का धन्यवाद। समीक्षा के बाद, अभी हम आपका आवेदन स्वीकार नहीं कर सकते।\n\nआप बाद में 💼 रीसेलर से फिर आवेदन कर सकते हैं।`,
    payClosed: amt => `ℹ️ आपका रीसेलर आवेदन पहले ही बंद हो चुका था, इसलिए हमने <b>${amt}</b> आपके वॉलेट में जोड़ दिए।`,
    stale: 'यह चरण बंद हो चुका है।',
    bankPay: ngn => `🏦 <b>बैंक से ₦${ngn} भुगतान करें</b>\n\nनीचे <b>Make Payment</b> दबाएँ। पुष्टि होते ही आपका प्राथमिकता सेटअप शुरू होगा और हम यहीं बताएँगे।`,
  },
}
const T = lang => L[lang] || L.en
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const isBtn = (text, pick) => !!text && Object.values(L).some(l => pick(l.btn) === text)
const optKey = (group, text) => {
  for (const l of Object.values(L)) for (const [k, v] of Object.entries(l.opt[group])) if (v === text) return k
  return null
}
// Any keyboard label the form itself shows (so ❌ Cancel etc. are never treated as leaving the form).
const isFormLabel = text => !!text && Object.values(L).some(l => Object.values(l.btn).includes(text) || Object.values(l.opt).some(g => Object.values(g).includes(text)))
const rows2 = arr => arr.reduce((r, x, i) => (i % 2 ? r[r.length - 1].push(x) : r.push([x])) && r, [])
const nav = (t, { back = true, skip = false } = {}) => [...(skip ? [[t.btn.skip]] : []), back ? [t.btn.back, t.btn.cancel] : [t.btn.cancel]]
const fmtDate = d => new Date(d || Date.now()).toISOString().slice(0, 10)

function prompt(app, lang) {
  const t = T(lang)
  const step = STEPS[app.idx]
  if (step === 'review') return { text: t.review(summary(app, lang)), keyboard: [[t.btn.submit], [t.btn.restart, t.btn.cancel]] }
  const [icon, title, body] = t.q[step]
  const opt = step === 'email' || step === 'note'
  const text = `${icon} ${t.step(app.idx + 1, title, opt)}\n\n${body}`
  if (step === 'email') return { text, keyboard: nav(t, { back: false, skip: true }) }
  if (step === 'brand') return { text, keyboard: nav(t) }
  if (step === 'note') return { text, keyboard: nav(t, { skip: true }) }
  if (step === 'services') return { text, keyboard: nav(t), inline: servicesPanel(app, lang) }
  const opts = Object.values(t.opt[step])
  return { text, keyboard: [...(step === 'tier' || step === 'sellMode' || step === 'audWhere' ? opts.map(o => [o]) : rows2(opts)), ...nav(t)] }
}

function servicesPanel(app, lang) {
  const t = T(lang)
  const sel = new Set(app.answers?.services || [])
  const btns = SVC_KEYS.map(k => ({ text: `${sel.has(k) ? '✅' : '▫️'} ${t.opt.services[k]}`, callback_data: `rsa:t:${k}` }))
  return { text: t.panel(sel.size), inline_keyboard: [...rows2(btns), [{ text: t.btn.cont(sel.size), callback_data: 'rsa:c' }]] }
}

function summary(app, lang) {
  const t = T(lang); const s = t.sum; const a = app.answers || {}
  const o = (g, k) => (k ? t.opt[g][k] || k : '—')
  return [
    `👤 ${s.tg}: ${app.username ? '@' + esc(app.username) : esc(app.chatId)}`,
    `📧 ${s.email}: ${a.email ? esc(a.email) : '—'}`,
    `🏷 ${s.brand}: <b>${esc(a.brand)}</b>`,
    `🛒 ${s.sell}: ${o('sellMode', a.sellMode)}`,
    `👥 ${s.vol}: ${o('volume', a.volume)}`,
    `📣 ${s.aud}: ${o('audWhere', a.audWhere)} · ${o('audSize', a.audSize)}`,
    `🧩 ${s.svc}: ${(a.services || []).map(k => t.opt.services[k]).join(', ') || '—'}`,
    `📝 ${s.note}: ${a.note ? esc(a.note) : '—'}`,
    `${app.tier === 'priority' ? '⚡' : '🕐'} ${s.tier}: ${app.tier === 'priority' ? s.pri : s.std}`,
  ].join('\n')
}

async function start(chatId, { username, lang = 'en' } = {}) {
  await col.deleteMany({ chatId: String(chatId), status: 'draft' })
  const now = new Date()
  const app = { _id: crypto.randomUUID(), chatId: String(chatId), username: username || null, lang, status: 'draft', idx: 0, answers: { services: [] }, tier: null, createdAt: now, updatedAt: now }
  await col.insertOne(app)
  return prompt(app, lang)
}
const getDraft = chatId => col.findOne({ chatId: String(chatId), status: 'draft' }, { sort: { updatedAt: -1 } })
const getOpen = chatId => col.findOne({ chatId: String(chatId), status: { $in: OPEN } }, { sort: { createdAt: -1 } })
const getById = id => col.findOne({ _id: String(id) })

// Guarded write: only while the draft is still a draft (a stale tap can't resurrect a submitted one).
async function save(app) {
  app.updatedAt = new Date()
  const r = await col.replaceOne({ _id: app._id, status: 'draft' }, app)
  return r.matchedCount > 0
}

// One typed answer / button tap for the open draft. null = no draft (caller falls through).
async function handleInput(chatId, text, lang) {
  const app = await getDraft(chatId)
  if (!app) return null
  const t = T(lang)
  const step = STEPS[app.idx]
  const msg = String(text || '').trim()
  const re = extra => ({ ...prompt(app, lang), text: `${extra}\n\n${prompt(app, lang).text}` })
  // Leaving the services step → tell the caller to clear that inline panel.
  const out = p => (step === 'services' && app.panelMsgId && STEPS[app.idx] !== 'services' ? { ...p, clearPanel: app.panelMsgId } : p)
  const next = async () => { app.idx++; if (!(await save(app))) return { closed: true }; return out(prompt(app, lang)) }

  if (isBtn(msg, b => b.cancel) || msg === '/cancel') {
    const r = await col.updateOne({ _id: app._id, status: 'draft' }, { $set: { status: 'cancelled', updatedAt: new Date() } })
    return r.modifiedCount ? { cancelled: true, text: t.cancelled, panelMsgId: app.panelMsgId || null } : { closed: true }
  }
  if (isBtn(msg, b => b.back) && app.idx > 0) {
    app.idx--
    if (!(await save(app))) return { closed: true }
    return out(prompt(app, lang))
  }
  switch (step) {
    case 'email':
      if (isBtn(msg, b => b.skip)) { app.answers.email = null; return next() }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(msg) || msg.length > 120) return re(t.bad.email)
      app.answers.email = msg.toLowerCase(); return next()
    case 'brand':
      if (msg.length < 2 || msg.length > 40 || !/[\p{L}\p{N}]/u.test(msg)) return re(t.bad.brand)
      app.answers.brand = msg; return next()
    case 'sellMode': case 'volume': case 'audWhere': case 'audSize': {
      const k = optKey(step, msg)
      if (!k) return re(t.bad.pick)
      app.answers[step] = k; return next()
    }
    case 'services':
      if ((app.answers.services || []).length) return next()
      return re(t.bad.services)
    case 'note':
      if (isBtn(msg, b => b.skip)) { app.answers.note = null; return next() }
      if (msg.length > 500) return re(t.bad.note)
      app.answers.note = msg || null; return next()
    case 'tier': {
      const k = optKey('tier', msg)
      if (!k) return re(t.bad.pick)
      app.tier = k; return next()
    }
    case 'review': {
      if (isBtn(msg, b => b.restart)) { app.idx = 0; app.answers = { services: [] }; app.tier = null; if (!(await save(app))) return { closed: true }; return prompt(app, lang) }
      if (!isBtn(msg, b => b.submit)) return re(t.bad.pick)
      const status = app.tier === 'priority' ? 'pending_payment' : 'pending'
      const now = new Date()
      const done = await col.findOneAndUpdate({ _id: app._id, status: 'draft' }, { $set: { status, submittedAt: now, updatedAt: now, lang } }, { returnDocument: 'after' })
      const doc = done?.value !== undefined ? done.value : done
      return doc ? { submitted: doc } : { closed: true }
    }
  }
  return null
}

// Inline service toggles (edit in place). Returns the new panel, or null when the step is closed.
// Only the newest panel is live (an older copy left in the chat is stale).
const livePanel = (app, mid) => app && STEPS[app.idx] === 'services' && !(mid && app.panelMsgId && mid !== app.panelMsgId)
async function toggleService(chatId, key, lang, mid) {
  if (!SVC_KEYS.includes(key)) return null
  const app = await getDraft(chatId)
  if (!livePanel(app, mid)) return null
  const sel = new Set(app.answers.services || [])
  sel.has(key) ? sel.delete(key) : sel.add(key)
  app.answers.services = SVC_KEYS.filter(k => sel.has(k))
  if (!(await save(app))) return null
  return servicesPanel(app, lang)
}
async function continueServices(chatId, lang, mid) {
  const app = await getDraft(chatId)
  if (!livePanel(app, mid)) return null
  if (!(app.answers.services || []).length) return { error: T(lang).bad.services }
  app.idx++
  if (!(await save(app))) return null
  return { prompt: prompt(app, lang) }
}

const transition = async (filter, set) => {
  const r = await col.findOneAndUpdate(filter, { $set: { ...set, updatedAt: new Date() } }, { returnDocument: 'after' })
  return r?.value !== undefined ? r.value : r
}
// Priority fee received. Unpaid Priority → in review; a Standard app still in review is upgraded.
const markPaid = (id, payment) => transition(
  { _id: String(id), 'payment.status': { $ne: 'paid' }, $or: [{ status: 'pending_payment' }, { status: 'pending', tier: 'standard' }] },
  { status: 'pending', tier: 'priority', payment: { ...payment, status: 'paid', paidAt: new Date() } })
const switchToStandard = id => transition({ _id: String(id), status: 'pending_payment' }, { status: 'pending', tier: 'standard' })
const withdraw = id => transition({ _id: String(id), 'payment.status': { $ne: 'paid' }, status: { $in: ['pending_payment', 'pending'] } }, { status: 'withdrawn', withdrawnAt: new Date() })
const decide = (id, approve, by) => transition({ _id: String(id), status: 'pending' }, { status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedBy: by || null })
const setAdminMsg = (id, msg) => col.updateOne({ _id: String(id) }, { $set: { adminMsg: msg } })
const setPanelMsg = (chatId, messageId) => col.updateOne({ chatId: String(chatId), status: 'draft' }, { $set: { panelMsgId: messageId } })
// Applicant left the form via a menu button or /start: the draft is cancelled (returned so the caller can clear its panel).
const abandon = chatId => transition({ chatId: String(chatId), status: 'draft' }, { status: 'cancelled', cancelReason: 'left_form' })

// Status screen for 💼 Reseller when an application is open.
function statusScreen(app, lang) {
  const t = T(lang)
  if (app.status === 'pending_payment') return { text: t.stPendingPay, keyboard: [[t.btn.pay], [t.btn.switchStd], [t.btn.withdraw], [t.btn.ask, t.btn.menu]] }
  if (app.status === 'pending') {
    const rows = app.payment?.status === 'paid' ? [] : [[t.btn.withdraw]]
    return { text: t.stPending(fmtDate(app.submittedAt), app.tier === 'priority'), keyboard: [...rows, [t.btn.ask, t.btn.menu]] }
  }
  return { text: t.stApproved(BRAND), keyboard: [[t.btn.ask, t.btn.menu]] }
}
function homeScreen(lang, { again = false } = {}) {
  const t = T(lang)
  return { text: t.home(BRAND), keyboard: [[again ? t.btn.applyAgain : t.btn.apply], [t.btn.ask, t.btn.menu]] }
}

function adminText(app) {
  const e = L.en; const a = app.answers || {}
  const pri = app.tier === 'priority'
  const paid = app.payment?.status === 'paid' ? ` — paid $${app.payment.amountUsd} via ${esc(app.payment.method)}` : ''
  return [
    `💼 <b>Reseller Application</b> ${pri ? '⚡ <b>PRIORITY</b>' + paid : '🕐 Standard (free)'}`,
    '',
    `👤 ${app.username ? '@' + esc(app.username) : 'no username'} (<code>${esc(app.chatId)}</code>)`,
    `📧 ${a.email ? esc(a.email) : '—'}`,
    `🏷 Brand: <b>${esc(a.brand)}</b>`,
    `🛒 Sells via: ${e.opt.sellMode[a.sellMode] || '—'}`,
    `👥 Customers/month: ${e.opt.volume[a.volume] || '—'}`,
    `📣 Audience: ${e.opt.audWhere[a.audWhere] || '—'} · ${e.opt.audSize[a.audSize] || '—'}`,
    `🧩 Services: ${(a.services || []).map(k => e.opt.services[k]).join(', ') || '—'}`,
    `📝 Note to Admin: ${a.note ? esc(a.note) : '—'}`,
    `🌐 Language: ${esc(app.lang || 'en')} · 🆔 <code>${esc(String(app._id).slice(0, 8))}</code>`,
  ].join('\n')
}
const adminButtons = app => ({ inline_keyboard: [[{ text: '✅ Approve', callback_data: `rsa:ok:${app._id}` }, { text: '❌ Reject', callback_data: `rsa:no:${app._id}` }]] })

module.exports = {
  init, T, isBtn, isFormLabel, start, getDraft, getOpen, getById, handleInput, toggleService, continueServices, prompt,
  markPaid, switchToStandard, withdraw, decide, setAdminMsg, setPanelMsg, abandon, statusScreen, homeScreen, summary, adminText, adminButtons,
  PRIORITY_FEE_USD, STEPS, SVC_KEYS, esc, brand: () => BRAND,
}
