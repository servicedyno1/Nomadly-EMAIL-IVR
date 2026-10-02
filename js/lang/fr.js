const { areasOfCountry, carriersOf, countryCodeOf } = require('../areasOfCountry')
const { buildChooseSubscription } = require('./plan-copy')

const format = (cc, n) => `+${cc}(${n.toString().padStart(2, '0')})`

/* global process */
require('dotenv').config()
const HIDE_BANK_PAYMENT = process.env.HIDE_BANK_PAYMENT
const SELF_URL = process.env.SELF_URL
const FREE_LINKS = Number(process.env.FREE_LINKS)
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME

// Digital Product Prices (from .env)
const DP_PRICE_TWILIO_MAIN = Number(process.env.DP_PRICE_TWILIO_MAIN) || 450
const DP_PRICE_TWILIO_SUB = Number(process.env.DP_PRICE_TWILIO_SUB) || 200
const DP_PRICE_TELNYX_MAIN = Number(process.env.DP_PRICE_TELNYX_MAIN) || 400
const DP_PRICE_TELNYX_SUB = Number(process.env.DP_PRICE_TELNYX_SUB) || 150
const DP_PRICE_GWORKSPACE_NEW = Number(process.env.DP_PRICE_GWORKSPACE_NEW) || 100
const DP_PRICE_GWORKSPACE_AGED = Number(process.env.DP_PRICE_GWORKSPACE_AGED) || 150
const DP_PRICE_ZOHO_NEW = Number(process.env.DP_PRICE_ZOHO_NEW) || 100
const DP_PRICE_ZOHO_AGED = Number(process.env.DP_PRICE_ZOHO_AGED) || 150
const DP_PRICE_ESIM = Number(process.env.DP_PRICE_ESIM) || 60
const DP_PRICE_AWS_MAIN = Number(process.env.DP_PRICE_AWS_MAIN) || 400
const DP_PRICE_AWS_SUB = Number(process.env.DP_PRICE_AWS_SUB) || 150
const DP_PRICE_GCLOUD_MAIN = Number(process.env.DP_PRICE_GCLOUD_MAIN) || 300
const DP_PRICE_GCLOUD_SUB = Number(process.env.DP_PRICE_GCLOUD_SUB) || 300
const DP_PRICE_IONOS_SMTP = Number(process.env.DP_PRICE_IONOS_SMTP) || 150
const DP_PRICE_AIRVOICE_1M = Number(process.env.DP_PRICE_AIRVOICE_1M) || 70
const DP_PRICE_AIRVOICE_3M = Number(process.env.DP_PRICE_AIRVOICE_3M) || 120
const DP_PRICE_AIRVOICE_6M = Number(process.env.DP_PRICE_AIRVOICE_6M) || 150
const DP_PRICE_AIRVOICE_1Y = Number(process.env.DP_PRICE_AIRVOICE_1Y) || 180

const HIDE_SMS_APP = process.env.HIDE_SMS_APP
const HIDE_BECOME_RESELLER = process.env.HIDE_BECOME_RESELLER
const HIDE_BUNDLES = process.env.HIDE_BUNDLES
const EMAIL_BLAST_ON = process.env.EMAIL_BLAST_ON
const VPS_ENABLED = process.env.VPS_ENABLED
const TG_HANDLE = process.env.TG_HANDLE
const TG_CHANNEL = process.env.TG_CHANNEL
const SMS_APP_NAME = process.env.SMS_APP_NAME
const SMS_APP_LINK = require('../sms-app-link').resolveSmsAppLink()
const CHAT_BOT_NAME = process.env.CHAT_BOT_NAME
const CHAT_BOT_BRAND = process.env.CHAT_BOT_BRAND
const SUPPORT_HANDLE = process.env.SUPPORT_HANDLE
const APP_SUPPORT_LINK = process.env.APP_SUPPORT_LINK

const PRICE_DAILY = Number(process.env.PRICE_DAILY_SUBSCRIPTION)
const PRICE_WEEKLY = Number(process.env.PRICE_WEEKLY_SUBSCRIPTION)
const PRICE_MONTHLY = Number(process.env.PRICE_MONTHLY_SUBSCRIPTION)
const DAILY_PLAN_FREE_DOMAINS = Number(process.env.DAILY_PLAN_FREE_DOMAINS)
const WEEKLY_PLAN_FREE_DOMAINS = Number(process.env.WEEKLY_PLAN_FREE_DOMAINS)
const FREE_LINKS_HOURS = Number(process.env.FREE_LINKS_TIME_SECONDS) / 60 / 60
const MONTHLY_PLAN_FREE_DOMAINS = Number(process.env.MONTHLY_PLAN_FREE_DOMAINS)
const DAILY_PLAN_FREE_VALIDATIONS = Number(process.env.DAILY_PLAN_FREE_VALIDATIONS)
const WEEKLY_PLAN_FREE_VALIDATIONS = Number(process.env.WEEKLY_PLAN_FREE_VALIDATIONS)
const MONTHLY_PLAN_FREE_VALIDATIONS = Number(process.env.MONTHLY_PLAN_FREE_VALIDATIONS)

const PREMIUM_ANTIRED_WEEKLY_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE)
const PREMIUM_ANTIRED_CPANEL_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_CPANEL_PRICE)
const GOLDEN_ANTIRED_CPANEL_PRICE = parseFloat(process.env.GOLDEN_ANTIRED_CPANEL_PRICE)
const VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE = parseFloat(process.env.VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE) || 50

const npl = {
 // New Zealand
 Spark: ['Spark'],
 Vocus: ['Vocus'],
 '2Degrees/Voyager': ['Voyager'],
 'Skinny Mobile': ['Skinny Mobile'],
 // Australia
 Telstra: ['Telstra'],
 Optus: ['Optus'],
 Vodafone: ['VODAFONE', 'Vodafone'],
 // UK
 EE: ['EE'],
 Three: ['Three'],
 'Virgin/O2': ['Virgin'],
}

const alcazar = {
 'T-mobile': ['T-MOBILE', 'OMNIPOINT', 'METROPCS', 'SPRINT', 'AERIAL'],
 'Metro PCS': ['T-MOBILE', 'OMNIPOINT', 'METROPCS', 'SPRINT', 'AERIAL'],
 Sprint: ['T-MOBILE', 'OMNIPOINT', 'METROPCS', 'SPRINT', 'AERIAL'],
 'Verizon Wireless': ['CELLCO', 'ONVOY'],
 'AT&T': ['CINGULAR'],
}

// Note: these button labels must not mix with each other, other wise it may mess up bot
const admin = {
 viewAnalytics: '📊 View Analytics',
 viewUsers: '👀 View Users',
 blockUser: '✋ Block User',
 unblockUser: '👌 Unblock User',
 messageUsers: '👋 Message all users',
 resetDead: '🗑️ Reset Dead Users',
 gift5all: '🎁 Gift $5 All Users',
}

const user = {
 // main keyboards
 cPanelWebHostingPlans: "Plans d'hébergement HostPanel en Russie",
 pleskWebHostingPlans: "Plans d'hébergement Plesk en Russie",
 joinChannel: '📢 Rejoindre le canal',
 phoneNumberLeads: '🎯 Acheter des Leads | Vérifier les Vôtres',
 buyLeads: '🎯 Acheter des Leads',
 validateLeads: '✅ Valider les numéros',
 leadsValidation: '📱 Leads SMS',
 hostingDomainsRedirect: '🛡️ Hébergement Anti-Red',
 wallet: '👛 Portefeuille',
 urlShortenerMain: "🔗 Raccourcisseur d'URL",
 vpsPlans: '🖥️ VPS / RDP',
 buyPlan: '⚡ Améliorer le plan',
 domainNames: '🌐 Domaines Blindés',
 viewPlan: '📋 Mes Plans',
 becomeReseller: '💼 Revendeur',
 getSupport: '💬 Support',
 cloudPhone: '📞 Cloud IVR + SIP',
 testSip: '🧪 Tester SIP Gratuit',
 freeTrialAvailable: '🆓 Essai SMS en masse',
 smsAppMain: '📱 SMS en masse',
 smsCreateCampaign: '📱 Créer une campagne',
 smsMyCampaigns: '📋 Mes campagnes',
 smsDownloadApp: '📲 Télécharger l\'appli',
 smsResetLogin: '🔓 Réinitialiser la connexion',
 smsManageDevices: '📱 Gérer les appareils',
 smsHowItWorks: '❓ Comment ça marche',
 smsAppSettings: '⚙️ Paramètres SMS',
 changeSetting: '⚙️ Paramètres',
 changeLanguage: '🌍 Changer de langue',

 // Sub Menu 1: urlShortenerMain
 redSelectUrl: '🔀✂️ Rediriger et raccourcir',
 redBitly: '✂️ Bit.ly',
 redShortit: '✂️ Shortit (Essai)',
 urlShortener: '✂️🌐 Raccourcisseur de domaine personnalisé',
 viewShortLinks: '📊 Voir les analyses des raccourcis',
 activateDomainShortener: '🔗 Activer un domaine pour le raccourcisseur',

 // Sub Menu 6: Digital Products
 digitalProducts: '🛒 Produits numériques',
 marketplace: '🏪 Marché',
 shippingLabel: '📦 Expédition & Courrier',
 emailBlast: '📧 Email en Masse',
 emailValidation: '📧 Validation d\'Email',
 serviceBundles: '🎁 Packs de Services',
 referEarn: '🤝 Parrainez & Gagnez',
 virtualCard: '💳 Carte Virtuelle',

 // Sub Menu 2: domainNames
 buyDomainName: '🛒🌐 Acheter des noms de domaine',
 viewDomainNames: '📂 Mes noms de domaine',
 dnsManagement: '🔧 Gestion DNS',

 // Sub Menu 3: cPanel/Plesk WebHostingPlansMain
 freeTrial: '💡 Essai gratuit',
 premiumWeekly: '⚡ Premium Anti-Red (1 Semaine)',
 premiumCpanel: '🔷 HostPanel Anti-Red Premium (30 jours)',
 goldenCpanel: '👑 HostPanel Anti-Red Golden (30 jours)',
 contactSupport: '📞 Contacter le support',

 // Sub Menu 4: VPS Plans
 buyVpsPlan: '⚙️ Créer VPS / RDP',
 buyLinuxVpsBtn: '🐧 Créer un VPS Linux',
 buyRdpBtn: '🪟 Créer un RDP Windows',
 manageVpsPlan: '🖥️ Gérer mes serveurs',
 vpsRdpMenuPrompt: `🖥️ <b>VPS Cloud / RDP Windows</b>

Deux produits différents, deux listes de plans différentes :
🐧 <b>VPS Linux</b> — accès SSH · hébergement web · dev · automatisation
🪟 <b>RDP Windows</b> — Bureau à distance · licence Windows incluse · prépayé 1/2/3 mois · prêt en ~3 min

Port 25 ouvert · hébergement blindé. Veuillez choisir une option :`,
 manageVpsSSH: '🔑 Clés SSH',

 // Free Trial
 freeTrialMenuButton: '🚀 Essai gratuit (12 heures)',
 getFreeTrialPlanNow: "🛒 Obtenir le plan d'essai maintenant",
 continueWithDomainNameSBS: websiteName => `➡️ Continuer avec ${websiteName}`,
 searchAnotherDomain: '🔍 Rechercher un autre domaine',
 privHostNS: '🏢 PrivHost (Hébergement rapide et sécurisé)',
 cloudflareNS: '🛡️ Bouclier Cloudflare (Sécurité et discrétion)',
 backToFreeTrial: "⬅️ Retour à l'essai gratuit",

 // Paid Plans
 buyPremiumWeekly: '🛒 Acheter Premium Anti-Red (1 Semaine)',
 buyPremiumCpanel: '🛒 Acheter Premium Anti-Red HostPanel (30 Days)',
 buyGoldenCpanel: '🛒 Acheter Golden Anti-Red HostPanel (30 Days)',
 viewPremiumWeekly: '🔷 Voir Premium Weekly',
 viewPremiumCpanel: '🔼 Voir Premium HostPanel',
 viewGoldenCpanel: '👑 Voir Golden HostPanel',
 backToHostingPlans: "⬅️ Retour aux plans d'hébergement",
 registerANewDomain: '🌐 Enregistrer un nouveau domaine',
 useMyDomain: '📂 Utiliser Mon Domaine',
 connectExternalDomain: '🔗 Connecter un Domaine Externe',
 useExistingDomain: '🔄 Utiliser un domaine existant',
 backToPremiumWeeklyDetails: '⬅️ Retour aux détails Premium Weekly',
 backToPremiumCpanelDetails: '⬅️ Retour aux détails Premium HostPanel',
 backToGoldenCpanelDetails: '⬅️ Retour aux détails Golden HostPanel',
 continueWithDomain: websiteName => `➡️ Continuer avec ${websiteName}`,
 enterAnotherDomain: '🔍 Entrer un autre domaine',
 backToPurchaseOptions: "⬅️ Retour aux options d'achat",
 myHostingPlans: '📋 Mes Plans d\'Hébergement',
 billingMenu: '💳 Mon Plan / Facturation',
 backToBillingMenu: '⬅️ Retour à la Facturation',
 revealCredentials: '🔑 Afficher les Identifiants',
 manageVisitorCaptcha: '🛡️ Activer/Désactiver Captcha',
 manageVisitorCaptchaLocked: '🔒 Activer/Désactiver Captcha — Plan Gold uniquement',
 manageHoneypot: '🍯 Activer/Désactiver Pièges Honeypot',
 manageHoneypotLocked: '🔒 Pièges Honeypot — Plan Mensuel uniquement',
 renewHostingPlan: '🔄 Renouveler le Plan',
 upgradeHostingPlan: '⬆️ Mise à niveau',
 backToMyHostingPlans: '⬅️ Retour à Mes Plans',
 buyLeads: '🎯 Acheter des Leads Téléphoniques',
 validateLeads: '✅ Valider les Numéros',
 shortenLink: '✂️ Raccourcir un Lien',
 confirmRenewNow: '✅ Confirmer & Payer',
 cancelRenewNow: '❌ Annuler',
 toggleAutoRenew: '🔁 Activer/Désactiver le Renouvellement Auto',
 unlinkDomain: '🗑️ Détacher un Domaine',
 addDomainToPlan: '➕ Ajouter un Domaine au Plan',
 changePrimaryDomain: '🔄 Changer le Domaine Principal',
 confirmChangePrimaryBtn: '✅ Oui, changer',
 confirmAttachBtn: '✅ Oui, l\'attacher',
 cancelHostingPlan: '🚫 Annuler le Plan d\'Hébergement',
 takeSiteOffline: '🔌 Mettre le Site Hors Ligne',
 bringSiteOnline: '🌐 Remettre le Site En Ligne',
 siteOfflineModeMaintenance: '🛠️ Mode Maintenance (recommandé)',
 siteOfflineModeSuspend: '🚫 Suspension Complète (HTTP + email + FTP + DB)',
 confirmTakeOfflineBtn: '✅ Oui, le mettre hors ligne',
 confirmBringOnlineBtn: '✅ Oui, le remettre en ligne',
 confirmUnlinkBtn: '✅ Oui, le détacher',
 confirmCancelHostingBtn: '🗑️ Oui, annuler le plan',
 cancelGoBackBtn: '⬅️ Non, retour',
}

const u = {
 // other key boards
 deposit: '➕💵 Dépôt',
 withdraw: '➖💵 Retirer',
 myTier: '🏆 Mon Niveau',
 txHistory: '📜 Transactions',

 // wallet
 usd: 'USD',
 ngn: 'NGN',

 // deposit methods
 depositBank: '🏦 Banque (Naira)',
 depositCrypto: '₿ Crypto',
}
const view = num => Number(num).toFixed(2)
const yesNo = ['Oui', 'Non']

const bal = (usd) => `$${view(usd)}`

const dnsEntryFormat = '' // deprecated — A/CNAME now use multi-step wizard

const t = {
 yes: '✅ Oui',
 no: '❌ Non',
 back: 'Retour',
 cancel: '❌ Annuler',
 skip: 'Ignorer',
 becomeReseller: (() => {
 const services = ['Raccourcissement URL', 'Enregistrement de domaines']
 if (process.env.PHONE_SERVICE_ON === 'true') services.push('Cloud IVR')
 if (HIDE_SMS_APP !== 'true') services.push('BulkSMS')
 if (process.env.OFFSHORE_HOSTING_ON !== 'false') services.push('Hébergement Anti-Red')
 return `<b>Devenez revendeur ${CHAT_BOT_BRAND}</b>

Revendez notre suite complète — ${services.join(', ')} — sous votre marque.

<b>65/35%</b> de partage des bénéfices. Appuyez sur 💬 <b>Obtenir de l'aide</b> pour commencer.`
 })(),
 resetLoginAdmit: `${CHAT_BOT_BRAND} SMS : Vous avez été déconnecté de votre appareil précédent et connecté avec succès à celui-ci.`,
 resetLoginDeny: 'D\'accord. Aucune action supplémentaire requise.',
 resetLogin: `${CHAT_BOT_BRAND}SMS : Essayez-vous de vous déconnecter de votre appareil précédent ?`,
 select: `Veuillez sélectionner une option :`,
 urlShortenerSelect: `Raccourcir, personnaliser ou suivre vos liens :`,
 selectPlan: `Veuillez sélectionner un plan :`,
 backButton: '⬅️ Retour',
 yesProceedWithThisEmail: email => `Continuer avec ${email}`,
 skipEmail: 'Ignorer (pas d\'email)',
 proceedWithPayment: 'Continuer avec le paiement',
 iHaveSentThePayment: `J'ai envoyé le paiement ✅`,
 trialAlreadyUsed: `Vous avez déjà utilisé votre essai gratuit. Si vous avez besoin de plus d'accès, veuillez envisager de souscrire à l'un de nos plans payants.`,
 oneHourLeftToExpireTrialPlan: `Votre plan Freedom expirera dans 1 heure. Si vous souhaitez continuer à utiliser nos services, envisagez de passer à un plan payant !`,
 freePlanExpired: `🚫 Votre plan Freedom a expiré. Nous espérons que vous avez apprécié votre essai. Pour continuer à utiliser nos services, veuillez acheter l'un de nos plans premium.`,
 freeTrialPlanSelected: hostingType => `
- Essayez notre <b>Plan Freedom</b> gratuitement ! Ce plan comprend un domaine gratuit se terminant par .sbs et sera actif pendant 12 heures.

🚀 <b>Plan Freedom :</b>
<b>- Stockage :</b> 1 Go SSD
<b>- Bande passante :</b> 10 Go
<b>- Domaines :</b> 1 domaine gratuit .sbs
<b>- Comptes email :</b> 1 compte email
<b>- Bases de données :</b> 1 base de données MySQL
<b>- SSL gratuit :</b> Oui
<b>- Fonctionnalités HostPanel :</b> Accès complet à HostPanel pour gérer les fichiers, la base de données et les emails, etc.
<b>- Durée :</b> Actif pendant 12 heures
<b>- Idéal pour :</b> Tests et projets de courte durée.
`,

 getFreeTrialPlan: `Veuillez entrer le nom de domaine souhaité (par exemple, example.sbs) et l'envoyer en tant que message. Ce domaine se terminera par .sbs et est gratuit avec votre plan d'essai.`,
 trialPlanContinueWithDomainNameSBSMatched: websiteName => `Le domaine ${websiteName} est disponible !`,
 trialPlanSBSDomainNotMatched: `Le domaine que vous avez entré est introuvable. Veuillez vérifier le domaine ou en essayer un autre.`,
 trialPlanSBSDomainIsPremium: `Le domaine est à prix premium et uniquement disponible avec un plan payant. Veuillez rechercher un autre domaine.`,
 trialPlanGetNowInvalidDomain: `Veuillez entrer un nom de domaine valide qui se termine par '.sbs'. Le domaine devrait ressembler à 'example.sbs' et est gratuit avec votre plan d'essai.`,
 trialPlanNameserverSelection: websiteName =>
 `Veuillez sélectionner le fournisseur de serveur de noms que vous souhaitez utiliser pour ${websiteName}.`,
 trialPlanDomainNameMatched: `Veuillez fournir votre adresse e-mail pour créer votre compte et recevoir votre reçu.`,
 confirmEmailBeforeProceedingSBS: email =>
 `Êtes-vous sûr de vouloir continuer avec cet e-mail ${email} pour l'abonnement au Plan Freedom ?`,
 trialPlanInValidEmail: `Veuillez fournir une adresse e-mail valide.`,
 trialPlanActivationConfirmation: `Merci ! Votre plan d'essai gratuit sera activé sous peu. Veuillez noter que ce plan sera actif uniquement pendant 12 heures.`,
 trialPlanActivationInProgress: `Votre plan d'essai gratuit est en cours d'activation. Cela peut prendre quelques instants...`,
 what: `Cette option n'est pas disponible. Veuillez choisir parmi les boutons ci-dessous, ou tapez /start pour le menu complet.`,
 whatNum: `Veuillez choisir un numéro valide.`,
 phoneGenTimeout: `Délai expiré.`,
 phoneGenNoGoodHits: `Veuillez appuyer sur 💬 Obtenir de l'aide ou sélectionner un autre indicatif régional.`,

 subscribeRCS: p =>
 `Abonné ! Désabonnez-vous à tout moment en cliquant sur le <a href="${SELF_URL}/unsubscribe?a=b&Phone=${p}">lien</a>.`,
 unsubscribeRCS: p =>
 `Vous êtes désabonné ! Pour vous abonner à nouveau, cliquez sur le <a href="${SELF_URL}/subscribe?a=b&Phone=${p}">lien</a>.`,
 argsErr: `dev : arguments incorrects envoyés`,
 showDepositNgnInfo:
 ngn => `Veuillez envoyer ${ngn} NGN en cliquant sur “Effectuer le paiement” ci-dessous. Une fois la transaction confirmée, vous serez rapidement notifié, et votre portefeuille sera mis à jour.

Cordialement, 
${CHAT_BOT_NAME}`,
 askEmail: `Veuillez fournir un e-mail pour la confirmation du paiement.`,
 askValidAmount: 'Veuillez fournir un montant valide.',
 askValidEmail: 'Veuillez fournir un e-mail valide.',
 askValidCrypto: 'Veuillez choisir une crypto-monnaie valide.',
 askValidPayOption: 'Veuillez choisir une option de paiement valide.',
 chooseSubscription: buildChooseSubscription('fr'),

 askCoupon: usd =>
 `Le prix est de $${view(usd)}. Souhaitez-vous utiliser un code promo ? Si vous en avez un, veuillez l'entrer maintenant. Sinon, appuyez sur "Passer".`,
 planAskCoupon: `Souhaitez-vous utiliser un code promo ? Si vous en avez un, veuillez l'entrer maintenant. Sinon, appuyez sur "Passer".`,
 enterCoupon: `Veuillez entrer un code promo :`,
 planPrice: (plan, price) =>
 `Le prix de l'abonnement ${plan} est de $${price}. Veuillez choisir une méthode de paiement.`,
 planNewPrice: (plan, price, newPrice) =>
 `Le prix de l'abonnement ${plan} est désormais $${view(
 newPrice,
 )} <s>($${price})</s>. Veuillez choisir une méthode de paiement.`,
 domainPrice: (domain, price) =>
 `Le prix du domaine ${domain} est de $${price} USD. Veuillez choisir une méthode de paiement.`,
 domainNewPrice: (domain, price, newPrice) =>
 `Le prix du domaine ${domain} est désormais $${view(
 newPrice,
 )} <s>($${price})</s>. Veuillez choisir une méthode de paiement.`,
 couponInvalid: `Code promo invalide. Veuillez entrer un autre code promo :`,
 lowPrice: `Prix inférieur au minimum requis.`,
 freeTrialAvailable: (chatId) => `📱 <b>Essai gratuit BulkSMS — 100 SMS gratuits</b>\n\nVotre code d'activation :\n<code>${chatId}</code>\n\n📲 <b>Téléchargez l'appli :</b> ${SMS_APP_LINK}\n\nOuvrez l'appli → Entrez votre code → Commencez à envoyer !\n\n⚡ Essai : 1 appareil uniquement. Abonnez-vous pour accès multi-appareils (jusqu'à 10).\n\nBesoin de cartes eSIM ? Appuyez sur 💬 Obtenir de l'aide`,
 freeTrialNotAvailable: `Vous avez déjà utilisé l'essai gratuit.`,

 smsAppMenuSubscribed: (chatId) => `📧 <b>BulkSMS — Actif ✅</b>\n\n📱 <i>Fonctionne uniquement sur Android (iOS non pris en charge).</i>\n\nEnvoie des SMS depuis la SIM de votre téléphone — haute délivrabilité, vrai ID expéditeur.\n\n📲 <b>Appli :</b> ${SMS_APP_LINK}\n🔑 <b>Code :</b> <code>${chatId}</code>\n\nCréez des campagnes ci-dessous ou dans l'appli.\nNouveau ? Appuyez sur <b>❓ Comment ça marche</b>`,
 smsAppMenuTrial: (chatId, remaining) => `📧 <b>BulkSMS — Essai gratuit</b> (${remaining} SMS restants)\n\n📱 <i>Fonctionne uniquement sur Android (iOS non pris en charge).</i>\n\nEnvoie des SMS depuis la SIM de votre téléphone — haute délivrabilité, vrai ID expéditeur.\n\n📲 <b>Appli :</b> ${SMS_APP_LINK}\n🔑 <b>Code :</b> <code>${chatId}</code>\n\nNouveau ? Appuyez sur <b>❓ Comment ça marche</b>`,
 smsAppMenuExpired: `📧 <b>BulkSMS</b>\n\n📱 <i>Fonctionne uniquement sur Android (iOS non pris en charge).</i>\n\nVotre essai est terminé. Appuyez sur <b>⚡ Améliorer le plan</b> pour continuer.\n\nNouveau ? Appuyez sur <b>❓ Comment ça marche</b> pour découvrir BulkSMS.`,

 smsHowItWorks: (chatId) => `📧 <b>BulkSMS — Comment ça marche</b>\n\nBulkSMS envoie de vrais SMS <b>depuis la carte SIM de votre téléphone</b> — pas un serveur. Haute délivrabilité et vrai ID expéditeur.\n\n<b>⚙️ Configuration (une seule fois) :</b>\n1. Téléchargez l'appli → ${SMS_APP_LINK}\n2. Ouvrez → entrez le code : <code>${chatId}</code>\n3. Autorisez les permissions SMS\n\n<b>📤 Envoyer une campagne :</b>\n• Appuyez sur <b>📱 Créer une campagne</b> ici ou dans l'appli\n• Ajoutez message + contacts (coller ou fichier)\n• La campagne se synchronise → appuyez sur Envoyer sur votre téléphone\n\n<b>💡 Astuces :</b>\n• Utilisez une <b>eSIM</b> pour une ligne dédiée\n• Plusieurs lignes de message = rotation automatique\n• <code>[name]</code> = personnalisation automatique\n• Planifiez ou envoyez immédiatement\n\n<b>📋 Mes campagnes</b> affiche toutes vos campagnes.\n<b>🔓 Réinitialiser</b> pour changer d'appareil.\n\nBesoin d'eSIM ? Appuyez sur 💬 Support`,
 smsCreateCampaignIntro: `📱 <b>Créer une campagne SMS</b>\n\nVoici comment ça marche :\n\n<b>Étape 1 :</b> Nommez votre campagne\n<b>Étape 2 :</b> Rédigez votre/vos message(s)\n • Utilisez <code>[name]</code> pour personnaliser\n • Plusieurs lignes = rotation de messages\n<b>Étape 3 :</b> Importez les contacts\n • Collez en texte : <code>+1234567890, Jean</code>\n • Ou téléchargez un fichier .txt / .csv\n<b>Étape 4 :</b> Réglez le délai entre SMS\n<b>Étape 5 :</b> Vérifiez & confirmez — envoyez, planifiez ou enregistrez comme brouillon\n\nLa campagne se synchronise avec l'appli Nomadly SMS pour l'envoi.\n\n<b>Commençons — entrez un nom de campagne :</b>`,
 smsSchedulePrompt: '⏰ <b>Planifier la campagne ?</b>\n\nChoisissez quand rendre cette campagne disponible :',
 smsSendNow: '▶️ Envoyer maintenant',
 smsScheduleLater: '⏰ Planifier pour plus tard',
 smsScheduleTimePrompt: '📅 <b>Entrez la date et l\'heure</b>\n\nFormat : <code>AAAA-MM-JJ HH:MM</code>\n(fuseau UTC)\n\nExemple : <code>2025-07-15 09:30</code>',
 smsSaveDraft: '💾 Enregistrer le brouillon',
 smsDefaultGap: '⏱ Par défaut (5 sec)',
 smsGapTimePrompt: '⏱ <b>Délai entre les messages</b>\n\nCombien de secondes entre chaque SMS ?\n\n• Par défaut : <b>5 secondes</b>\n• Plage : 1–300 secondes\n\nTapez un nombre ou appuyez sur le bouton par défaut :',
 smsMyCampaignsEmpty: '📋 <b>Mes campagnes</b>\n\nVous n\'avez pas encore de campagnes. Appuyez sur <b>📱 Créer une campagne</b> pour commencer !',
 smsMyCampaignsList: (campaigns) => {
 const statusIcons = { draft: '📝', sending: '📤', completed: '✅', paused: '⏸', scheduled: '📅' }
 const lines = campaigns.slice(0, 10).map((c, i) =>
 `${i + 1}. ${statusIcons[c.status] || '📋'} <b>${c.name}</b>\n ${c.sentCount}/${c.totalCount} envoyés · ${c.status}`
 )
 return `📋 <b>Mes campagnes</b>\n\n${lines.join('\n\n')}\n\n<i>Gérez vos campagnes dans l'appli Nomadly SMS.</i>`
 },
 planSubscribed:
 HIDE_SMS_APP === 'true'
 ? `Vous vous êtes abonné avec succès au plan {{plan}} ! Profitez de domaines gratuits, de liens Shortit illimités et de validations de numéros USA gratuites avec noms des propriétaires inclus. Besoin d'une carte E-sim ? Appuyez sur 💬 Obtenir de l'aide.`
 : `✅ Abonné au plan {{plan}} !

Inclus :
• Liens Shortit illimités
• Validation USA avec noms
• \${SMS_APP_NAME}

📱 Accès appareils :
 Quotidien — 3 appareils
 Hebdomadaire — 10 appareils
 Mensuel — Appareils illimités

📲 Télécharger : \${SMS_APP_LINK}
💬 E-sim : Appuyez sur Support
🔓 Changer d'appareil : /resetlogin`,
 alreadySubscribedPlan: days => `Votre abonnement est actif et expire dans ${days} jours.`,
 payError: `Session de paiement introuvable. Veuillez réessayer ou appuyer sur 💬 Obtenir de l'aide. Découvrez plus sur ${TG_HANDLE}.`,
 chooseFreeDomainText: `<b>Bonne nouvelle !</b> Ce domaine est disponible gratuitement avec votre abonnement. Souhaitez-vous le réclamer ?`,

 chooseDomainToBuy: text =>
 `<b>Réclamez votre coin du web !</b> Veuillez partager le nom de domaine que vous souhaitez acheter, par exemple "abcpay.com". ${text}`,
 askDomainToUseWithShortener: `👉 <b>Confirmez votre domaine ci-dessus.</b> Tapez <b>Non</b> pour l'enregistrer maintenant, ou <b>Oui</b> pour activer aussi le raccourcisseur d'URL.\n\n<b>Non</b> — Enregistrement seul <i>(recommandé)</i>. Activable plus tard depuis 🔧 Gestion DNS.\n<b>Oui</b> — Configure aussi le DNS : liens courts <code>votredomaine.com/abc</code>.`,
 blockUser: `Veuillez partager le nom d'utilisateur de l'utilisateur à bloquer.`,
 unblockUser: `Veuillez partager le nom d'utilisateur de l'utilisateur à débloquer.`,
 blockedUser: `Vous êtes actuellement bloqué d'utiliser le bot. Veuillez appuyer sur 💬 Obtenir de l'aide. Découvrez plus ${TG_HANDLE}.`,
 greet: `${CHAT_BOT_BRAND} — raccourcissez vos URLs, enregistrez des domaines, achetez des leads et developpez votre activite. Directement depuis Telegram.
Commencez avec ${FREE_LINKS} liens Shortit d'essai — /start
Support: Appuyez sur 💬 Obtenir de l'aide`,
 linkExpired: `Votre essai ${CHAT_BOT_BRAND} a pris fin et votre lien raccourci est désactivé. Nous vous invitons à vous abonner pour maintenir l'accès à notre service d'URL et aux noms de domaine gratuits. Choisissez un plan approprié et suivez les instructions pour vous abonner. Veuillez nous contacter pour toute question.
Cordialement,
L'équipe ${CHAT_BOT_BRAND}
Découvrez plus : ${TG_CHANNEL}`,
 successPayment: `Paiement traité avec succès ! Vous pouvez maintenant fermer cette fenêtre.`,
 welcome: `Merci d'avoir choisi ${CHAT_BOT_NAME} ! Veuillez choisir une option ci-dessous :`,
 welcomeFreeTrial: `Bienvenue sur ${CHAT_BOT_BRAND} ! Vous avez ${FREE_LINKS} liens Shortit d'essai pour raccourcir vos URLs. Abonnez-vous pour des liens Shortit illimités, des domaines gratuits et des validations de numéros USA gratuites avec noms des propriétaires. Découvrez la différence ${CHAT_BOT_BRAND} !`,
 unknownCommand: `Commande introuvable. Appuyez sur /start ou veuillez appuyer sur 💬 Obtenir de l'aide. Découvrez plus ${TG_HANDLE}.`,
 support: `Veuillez appuyer sur 💬 Obtenir de l'aide. Découvrez plus ${TG_HANDLE}.`,
 joinChannel: `Veuillez rejoindre la chaîne ${TG_CHANNEL}.`,
 dnsPropagated: `La propagation DNS pour {{domain}} est terminée pour un raccourcissement d'URL illimité.`,
 dnsNotPropagated: `La propagation DNS pour {{domain}} est en cours et vous serez mis à jour une fois terminée. ✅`,
 domainBoughtSuccess: domain => `Le domaine ${domain} est maintenant à vous. Merci de nous avoir choisi.

Cordialement,
${CHAT_BOT_NAME}`,

 domainBought: `Votre domaine {{domain}} est désormais lié à votre compte tandis que la propagation DNS est en cours. Vous serez mis à jour automatiquement très bientôt.🚀`,
 domainLinking: domain =>
 `Lien du domaine avec votre compte. Veuillez noter que la mise à jour DNS peut prendre jusqu'à 30 minutes. Vous pouvez vérifier le statut de votre mise à jour DNS ici : https://www.whatsmydns.net/#A/${domain}`,
 errorSavingDomain: `Erreur lors de l'enregistrement du domaine sur le serveur, veuillez appuyer sur 💬 Obtenir de l'aide. Découvrez plus ${TG_HANDLE}.`,
 chooseDomainToManage: `Veuillez sélectionner un domaine si vous souhaitez gérer ses paramètres DNS.`,
 chooseDomainWithShortener: `Veuillez sélectionner ou acheter le nom de domaine que vous souhaitez relier à votre lien raccourci.`,
 viewDnsRecords: (records, domain, nameserverType) => {
 let msg = `<b>Enregistrements DNS pour ${domain}</b>\n`

 // NS section — only show for cloudflare or custom NS (hide provider defaults)
 const nsRecs = records['NS']
 if (nsRecs && nsRecs.length && (nameserverType === 'cloudflare' || nameserverType === 'custom')) {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : 'Personnalisé'
 msg += `\n<b>SERVEURS DE NOMS</b> <i>(${provider})</i>\n`
 for (let i = 0; i < nsRecs.length; i++) {
 msg += ` NS${i + 1}: <code>${nsRecs[i].recordContent || '—'}</code>\n`
 }
 msg += `<i>Utilisez "Modifier DNS" pour changer.</i>\n`
 }

 const otherTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'SRV', 'CAA']
 const typeLabels = {
 A: 'Enregistrements A', AAAA: 'Enregistrements AAAA', CNAME: 'Enregistrements CNAME',
 MX: 'Enregistrements MX', TXT: 'Enregistrements TXT',
 SRV: 'Enregistrements SRV', CAA: 'Enregistrements CAA',
 }
 for (const type of otherTypes) {
 let recs = records[type]
 if (!recs || !recs.length) continue
 // Show Railway CNAME records with shortener label instead of hiding them
 msg += `\n<b>${typeLabels[type]}</b>\n`
 for (const r of recs) {
 const idx = `<b>${r.index}.</b>`
 const host = r.recordName && r.recordName !== domain ? r.recordName : '@'
 const isShortenerCNAME = type === 'CNAME' && r.recordContent && r.recordContent.includes('.up.railway.app')
 if (type === 'MX') {
 const pri = r.priority !== undefined ? ` (pri:${r.priority})` : ''
 msg += `${idx} MX ${host}${pri} -> ${r.recordContent || 'AUCUN'}\n`
 } else if (type === 'TXT') {
 const val = r.recordContent ? (r.recordContent.length > 60 ? r.recordContent.substring(0, 60) + '...' : r.recordContent) : 'AUCUN'
 msg += `${idx} TXT ${host} -> ${val}\n`
 } else if (type === 'SRV') {
 msg += `${idx} SRV ${r.recordName || ''} -> ${r.recordContent || 'AUCUN'}\n`
 } else if (isShortenerCNAME) {
 msg += `${idx} ${type} ${host} -> 🔗 Raccourcisseur URL <i>(${r.recordContent})</i>\n`
 } else {
 msg += `${idx} ${type} ${host} -> ${r.recordContent || 'AUCUN'}\n`
 }
 }
 }
 const hasAny = ['NS', ...otherTypes].some(t => records[t]?.length)
 if (!hasAny) msg += '\nAucun enregistrement DNS trouve.\n'
 return msg
 },

 addDns: `Ajouter un enregistrement DNS`,
 updateDns: `Mettre à jour un enregistrement DNS`,
 deleteDns: `Supprimer un enregistrement DNS`,
 activateShortener: '🔗 Activer pour le raccourcisseur d\'URL',
 deactivateShortener: '🔗 Désactiver le raccourcisseur d\'URL',
 quickActions: 'Actions rapides',

 // DNS Wizard strings (fr)
 mx: 'Enregistrement MX',
 txt: 'Enregistrement TXT',
 'Enregistrement MX': 'MX',
 'Enregistrement TXT': 'TXT',
 dnsQuickActionMenu: 'Choisissez une configuration prédéfinie :',
 dnsQuickAskIp: 'Entrez l\'adresse IP du serveur (IPv4) :',
 dnsQuickAskVerificationTxt: 'Collez la valeur TXT de vérification de votre fournisseur :',
 dnsQuickAskSubdomainName: 'Entrez le nom du sous-domaine (ex: api, blog, app) :',
 dnsQuickAskSubdomainTargetType: (full) => `Comment souhaitez-vous pointer ${full} ?`,
 dnsQuickSubdomainIp: 'Pointer vers une IP (A)',
 dnsQuickSubdomainDomain: 'Pointer vers un domaine (CNAME)',
 dnsQuickAskSubdomainIp: 'Entrez l\'adresse IP :',
 dnsQuickAskSubdomainDomain: 'Entrez le domaine cible :',
 dnsQuickSetupProgress: (step, total) => `Configuration en cours (${step}/${total})...`,
 dnsQuickSetupError: (what) => `Erreur lors de la création de ${what}. Veuillez réessayer.`,
 dnsQuickGoogleDone: (domain) => `Google Workspace configuré pour ${domain} ! 5 enregistrements MX + SPF ajoutés.`,
 dnsQuickZohoDone: (domain) => `Zoho Mail configuré pour ${domain} ! 3 enregistrements MX + SPF ajoutés.`,
 dnsQuickPointToIpDone: (domain, ip) => `${domain} pointe maintenant vers ${ip}.\nA: ${domain} → ${ip}\nCNAME: www.${domain} → ${domain}`,
 dnsQuickVerificationDone: 'Enregistrement TXT de vérification ajouté !',
 dnsQuickSubdomainDone: (sub, target, type) => `${sub} pointe maintenant vers ${target} (${type})`,
 dnsInvalidIpv4: 'Adresse IPv4 invalide. Entrez une IP valide (ex: 192.168.1.1) :',
 dnsInvalidHostname: 'Nom d\'hôte invalide. Utilisez des caractères alphanumériques, tirets, underscores et points (ex: api, _dmarc, neo1._domainkey) :',
 dnsHostnameForeignDomain: (zone) => `Ce nom d\'hôte appartient à un autre domaine. Pour <b>${zone}</b>, entrez juste le sous-label (ex: <b>www</b>, <b>api</b>) ou <b>@</b> pour la racine.`,
 dnsFixDuplicatedBtn: (n) => `🛠️ Corriger ${n} enregistrement${n > 1 ? 's' : ''} cassé${n > 1 ? 's' : ''}`,
 dnsFixDuplicatedHeader: (zone) => `🛠️ <b>Nettoyage : enregistrements à zone dupliquée sur ${zone}</b>\n\nDes enregistrements où le domaine apparaît deux fois (ex : <code>www.${zone}.${zone}</code>) ont été détectés. Cela arrive quand le domaine complet est saisi comme nom d\'hôte.\n\nAppuyez sur <b>✅ Correction auto</b> pour les renommer correctement (ex : <code>www</code>) en conservant leurs valeurs. Ou <b>🗑️ Supprimer</b> pour tout effacer.`,
 dnsFixDuplicatedAutoFixBtn: '✅ Correction auto',
 dnsFixDuplicatedDeleteBtn: '🗑️ Tout supprimer',
 dnsFixDuplicatedDone: (fixed, deleted, failed) => `<b>Terminé.</b>\n\n✅ Auto-corrigés : ${fixed}\n🗑️ Supprimés : ${deleted}${failed ? `\n⚠️ Échecs : ${failed}` : ''}\n\nLa propagation DNS peut prendre jusqu\'à 24h.`,
 dnsInvalidMxPriority: 'Priorité invalide. Entrez un nombre entre 1 et 65535 :',
 askDnsHostname: {
 A: '<b>Ajouter un enregistrement A</b>\n\nEntrez le nom d\'hôte :\nex. <b>@</b> pour racine, ou <b>api</b>, <b>blog</b>, <b>www</b>\n\n<i>Astuce : juste le sous-label — n\'incluez pas votre domaine complet.</i>',
 CNAME: '<b>Ajouter un enregistrement CNAME</b>\n\nEntrez le sous-domaine :\nex. <b>www</b>, <b>api</b>, <b>blog</b>\n\nNote : CNAME ne peut pas être utilisé pour la racine (@)\n<i>Astuce : juste le sous-label — n\'incluez pas votre domaine complet.</i>',
 MX: '<b>Ajouter un enregistrement MX</b> (Étape 1/3)\n\nEntrez le nom d\'hôte :\nex. <b>@</b> pour email racine, ou un sous-domaine\n\n<i>Astuce : juste le sous-label — n\'incluez pas votre domaine complet.</i>',
 TXT: '<b>Ajouter un enregistrement TXT</b> (Étape 1/2)\n\nEntrez le nom d\'hôte :\nex. <b>@</b> pour racine, ou <b>_dmarc</b>, <b>mail</b>\n\n<i>Astuce : juste le sous-label — n\'incluez pas votre domaine complet.</i>',
 NS: '<b>Ajouter un enregistrement NS</b>\n\nEntrez le serveur de noms :\nex. <b>ns1.cloudflare.com</b>',
 AAAA: '<b>Ajouter un enregistrement AAAA</b> (Étape 1/2)\n\nEntrez le nom d\'hôte :\nex. <b>@</b> pour racine, ou <b>api</b>, <b>blog</b>\n\n<i>Astuce : juste le sous-label — n\'incluez pas votre domaine complet.</i>',
 },
 askDnsValue: {
 A: 'Entrez l\'adresse IPv4 :\nex. <b>192.168.1.1</b>',
 CNAME: 'Entrez le domaine cible :\nex. <b>myapp.railway.app</b>',
 MX: '<b>Étape 2/3</b> — Entrez le serveur de messagerie :\nex. <b>ASPMX.L.GOOGLE.COM</b>',
 TXT: '<b>Étape 2/2</b> — Entrez la valeur TXT :\nex. <b>v=spf1 include:_spf.google.com ~all</b>',
 AAAA: '<b>Étape 2/2</b> — Entrez l\'adresse IPv6 :\nex. <b>2001:db8::1</b>',
 },
 askMxPriority: '<b>Étape 3/3</b> — Entrez la priorité MX (plus bas = plus prioritaire) :\nex. <b>10</b> pour primaire, <b>20</b> pour sauvegarde',
 dnsQuickActions: {
 pointToIp: 'Pointer vers une IP',
 googleEmail: 'Email Google Workspace',
 zohoEmail: 'Email Zoho',
 verification: 'Vérification de domaine (TXT)',
 addSubdomain: 'Ajouter un sous-domaine',
 },

 // Phase 2: AAAA, SRV, CAA
 aaaa: 'Enregistrement AAAA',
 'Enregistrement AAAA': 'AAAA',
 srvRecord: 'Enregistrement SRV',
 'Enregistrement SRV': 'SRV',
 caaRecord: 'Enregistrement CAA',
 'Enregistrement CAA': 'CAA',
 dnsInvalidIpv6: 'Adresse IPv6 invalide. Entrez une IPv6 valide (ex: 2001:db8::1) :',
 dnsInvalidPort: 'Numéro de port invalide. Entrez un nombre entre 1 et 65535 :',
 dnsInvalidWeight: 'Poids invalide. Entrez un nombre entre 0 et 65535 :',
 dnsSrvCaaNotSupported: 'Les enregistrements SRV et CAA ne sont pas pris en charge par votre fournisseur DNS actuel (ConnectReseller). Passez aux serveurs de noms Cloudflare ou OpenProvider.',
 askSrvService: '<b>Ajouter un enregistrement SRV</b> (Étape 1/5)\n\nEntrez le service et le protocole :\nex. <b>_sip._tcp</b>, <b>_http._tcp</b>',
 askSrvTarget: '<b>Étape 2/5</b> — Entrez le nom d\'hôte cible :\nex. <b>sipserver.example.com</b>',
 askSrvPort: '<b>Étape 3/5</b> — Entrez le numéro de port :\nex. <b>5060</b>, <b>443</b>',
 askSrvPriority: '<b>Étape 4/5</b> — Entrez la priorité (plus bas = plus prioritaire) :\nex. <b>10</b>',
 askSrvWeight: '<b>Étape 5/5</b> — Entrez le poids (équilibrage de charge) :\nex. <b>100</b>',
 askCaaHostname: '<b>Ajouter un enregistrement CAA</b> (Étape 1/3)\n\nEntrez le nom d\'hôte :\nex. <b>@</b> pour le domaine racine',
 askCaaTag: '<b>Étape 2/3</b> — Sélectionnez le tag CAA :',
 caaTagIssue: 'issue — Autoriser une AC',
 caaTagIssuewild: 'issuewild — Autoriser wildcard',
 caaTagIodef: 'iodef — URL de rapport de violation',
 'issue — Autoriser une AC': 'issue',
 'issuewild — Autoriser wildcard': 'issuewild',
 'iodef — URL de rapport de violation': 'iodef',
 askCaaValue: (tag) => {
 if (tag === 'iodef') return '<b>Étape 3/3</b> — Entrez l\'URL de rapport :\nex. <b>mailto:admin@example.com</b>'
 return '<b>Étape 3/3</b> — Entrez le domaine de l\'AC autorisée :\nex. <b>letsencrypt.org</b>'
 },
 askDnsHostnameAaaa: 'Entrez le nom d\'hôte (@ pour racine, ou sous-domaine comme <b>api</b>, <b>blog</b>) :',
 askDnsValueAaaa: 'Entrez l\'adresse IPv6 (ex: <b>2001:db8::1</b>) :',

 // DNS Validation Checker
 checkDns: 'Vérifier DNS',
 dnsChecking: (domain) => `Vérification DNS pour <b>${domain}</b>...`,
 dnsRecordLive: (type, value) => `<b>${type}</b> est actif, résolution vers <b>${value}</b>.`,
 dnsRecordPropagating: (type) => `<b>${type}</b> est en cours de propagation. Cela peut prendre 24-48h.`,
 dnsHealthTitle: (domain) => `<b>Bilan DNS — ${domain}</b>\n`,
 dnsHealthRow: (type, found, count, answers) => {
 if (!found) return ` ${type}: —`
 const vals = answers.slice(0, 2).join(', ')
 const more = answers.length > 2 ? ` +${answers.length - 2} de plus` : ''
 return ` ${type}: ${count} enregistrement${count > 1 ? 's' : ''} (${vals}${more})`
 },
 dnsHealthSummary: (resolving, total) => resolving > 0
 ? `\n✅ Statut : <b>Actif</b> — ${resolving}/${total} types d'enregistrements résolus.`
 : `\n⚠️ Statut : <b>Inactif</b> — ce domaine ne résout encore nulle part. Il est peut-être suspendu au registre ou en cours d'activation.`,
 dnsCheckError: 'La vérification DNS a échoué. Réessayez plus tard.',
 manageNameservers: '🔄 Gérer les serveurs de noms',
 manageNsMenu: (domain, nsRecords, nameserverType) => {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : nameserverType === 'custom' ? 'Personnalisé' : 'Fournisseur par défaut'
 let msg = `<b>🔄 Serveurs de noms — ${domain}</b>\n\n`
 msg += `<b>Fournisseur :</b> ${provider}\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>Serveurs de noms actuels :</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 } else { msg += `<i>Aucun enregistrement NS trouvé.</i>\n` }
 msg += `\nSélectionnez une action :`
 return msg
 },
 setCustomNs: '✏️ Serveurs de noms personnalisés',
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ Serveurs de noms personnalisés pour ${domain}</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>Actuels :</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 msg += '\n'
 }
 msg += `Entrez les nouveaux serveurs de noms (un par ligne, min 2, max 4) :\n\n<i>Exemple :\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare : copiez les noms <b>tels quels</b> depuis votre tableau de bord (ex. <code>leanna.ns.cloudflare.com</code>). N'<b>ajoutez pas</b> de préfixe <code>ns1./ns2.</code>.</i>`
 return msg
 },
 switchToCf: '☁️ Passer à Cloudflare',
 switchToCfConfirm: (domain) => `<b>Basculer ${domain} vers Cloudflare DNS ?</b>\n\nCela va :\n1. Créer une zone Cloudflare pour votre domaine\n2. Migrer les enregistrements DNS existants vers Cloudflare\n3. Mettre à jour vos serveurs de noms chez le registraire\n\nLa propagation DNS peut prendre 24-48h.\n\nContinuer ?`,
 switchToCfProgress: (domain) => `⏳ Basculement de <b>${domain}</b> vers Cloudflare DNS…`,
 switchToCfSuccess: (domain, ns) => `<b>Terminé !</b> ${domain} utilise maintenant Cloudflare DNS.\n\n<b>Nouveaux serveurs de noms :</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToCfError: (error) => `❌ Échec du basculement vers Cloudflare : ${error}`,
 switchToCfAlreadyCf: 'Ce domaine utilise déjà Cloudflare DNS.',
 switchToProviderDefault: '🏠 Passer au DNS du fournisseur',
 switchToProviderConfirm: (domain) => `<b>Basculer ${domain} vers le DNS du fournisseur ?</b>\n\nCela va :\n1. Migrer les enregistrements DNS de Cloudflare vers votre registraire\n2. Restaurer les serveurs de noms par défaut\n3. Supprimer la zone Cloudflare\n\nLa propagation DNS peut prendre 24-48h.\n\nContinuer ?`,
 switchToProviderProgress: (domain) => `⏳ Basculement de <b>${domain}</b> vers le DNS du fournisseur…`,
 switchToProviderSuccess: (domain, ns) => `<b>Terminé !</b> ${domain} utilise maintenant le DNS du fournisseur.\n\n<b>Nouveaux serveurs de noms :</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToProviderError: (error) => `❌ Échec du basculement vers le DNS du fournisseur : ${error}`,
 switchToProviderAlreadyProvider: 'Ce domaine utilise déjà le DNS du fournisseur.',
 updateNsPrompt: (nsRecords, slotIndex) => {
 let msg = `<b>Modifier Serveur de Noms — Slot NS${slotIndex}</b>\n\n<b>Disposition actuelle :</b>\n`
 for (let i = 0; i < nsRecords.length; i++) {
 const marker = (i + 1) === slotIndex ? ' ← modification' : ''
 msg += ` NS${i + 1}: <code>${nsRecords[i].recordContent || '—'}</code>${marker}\n`
 }
 msg += `\nEntrez le nouveau serveur de noms pour <b>NS${slotIndex}</b> :\nex. <b>ns1.cloudflare.com</b>`
 return msg
 },

 // Digital Products
 digitalProductsSelect: `🛒 <b>Produits numériques</b>\n\nComptes vérifiés livrés <b>rapidement</b> via ce bot.\n\n<b>Télécom</b> — Twilio, Telnyx (SMS, Voix, SIP)\n<b>Cloud</b> — AWS, Google Cloud (Accès complet)\n<b>Email</b> — Google Workspace, Zoho Mail, IONOS SMTP\n<b>Mobile</b> — eSIM T-Mobile\n\nPayez par crypto, virement bancaire ou portefeuille. Sélectionnez ci-dessous :`,
 dpTwilioMain: `📞 Compte Twilio Principal — $${DP_PRICE_TWILIO_MAIN}`,
 dpTwilioSub: `📞 Sous-compte Twilio — $${DP_PRICE_TWILIO_SUB}`,
 dpTelnyxMain: `📡 Compte Telnyx Principal — $${DP_PRICE_TELNYX_MAIN}`,
 dpTelnyxSub: `📡 Sous-compte Telnyx — $${DP_PRICE_TELNYX_SUB}`,
 dpGworkspaceNew: `📧 Google Workspace Admin (Nouveau domaine) — $${DP_PRICE_GWORKSPACE_NEW}`,
 dpGworkspaceAged: `📧 Google Workspace Admin (Domaine ancien) — $${DP_PRICE_GWORKSPACE_AGED}`,
 dpEsim: `📱 eSIM T-Mobile — $${DP_PRICE_ESIM}`,
 dpEsimAirvoice: `📱 eSIM Airvoice (AT&T)`,
 dpAirvoiceSelect: `📱 <b>eSIM Airvoice (AT&T)</b>\n\n📶 Appels, SMS & data illimites sur le reseau AT&T.\nCompatible iOS & Android. Scannez le QR pour activer.\n\nChoisissez la duree :`,
 dpAirvoice1m: `1 Mois — $${DP_PRICE_AIRVOICE_1M}`,
 dpAirvoice3m: `3 Mois — $${DP_PRICE_AIRVOICE_3M}`,
 dpAirvoice6m: `6 Mois — $${DP_PRICE_AIRVOICE_6M}`,
 dpAirvoice1y: `1 An — $${DP_PRICE_AIRVOICE_1Y}`,
 dpZohoNew: `📧 Zoho Mail (Nouveau domaine) — $${DP_PRICE_ZOHO_NEW}`,
 dpZohoAged: `📧 Zoho Mail (Domaine ancien) — $${DP_PRICE_ZOHO_AGED}`,
 dpAwsMain: `☁️ Compte AWS Principal — $${DP_PRICE_AWS_MAIN}`,
 dpAwsSub: `☁️ Sous-compte AWS — $${DP_PRICE_AWS_SUB}`,
 dpGcloudMain: `🌐 Google Cloud Principal — $${DP_PRICE_GCLOUD_MAIN}`,
 dpGcloudSub: `🌐 Google Cloud Sous-compte — $${DP_PRICE_GCLOUD_SUB}`,
 dpIonosSmtp: `📧 IONOS SMTP — $${DP_PRICE_IONOS_SMTP}`,
 dpPaymentPrompt: (product, price) => {
 const descriptions = {
 'Twilio Main Account': 'Compte Twilio principal avec accès Console, clés API, numéros de téléphone, SMS/MMS et appels vocaux. Comprend 2 Sender IDs et $20 de crédit.\n\nVous recevez : identifiants de connexion + API SID & Auth Token.',
 'Twilio Sub-Account': 'Sous-compte Twilio avec connexion Console et identifiants API pour SMS, voix et numéros. Comprend 2 Sender IDs et $20 de crédit.\n\nVous recevez : identifiants de connexion, Account SID & Auth Token.',
 'Telnyx Main Account': 'Compte Telnyx principal avec accès Mission Control Portal. Numeros, SIP, messagerie et voix. Comprend 2 Sender IDs et $20 de crédit.\n\nVous recevez : identifiants de connexion + clé API.',
 'Telnyx Sub-Account': 'Sous-compte Telnyx avec connexion Mission Control Portal et accès API pour messagerie, voix et numéros. Comprend 2 Sender IDs et $20 de crédit.\n\nVous recevez : identifiants de connexion + clé API.',
 'AWS Main Account': 'Compte AWS root avec accès Console a tous les services — EC2, S3, Lambda, SES, etc.\n\nVous recevez : email root, mot de passe et configuration MFA.',
 'AWS Sub-Account': 'Sous-compte AWS (Organizations) avec connexion Console et accès aux services principaux — EC2, S3, Lambda, etc.\n\nVous recevez : identifiants de connexion et accès IAM.',
 'Google Cloud Main Account': 'Compte Google Cloud principal avec facturation activée. Compute Engine, Cloud Storage, BigQuery et tous les services GCP.\n\nVous recevez : identifiants de connexion.',
 'Google Cloud Sub-Account': 'Projet Google Cloud avec connexion Console et accès éditeur. Compute, stockage et API inclus.\n\nVous recevez : identifiants de connexion et clé de compte de service.',
 'Google Workspace (New Domain)': 'Email professionnel Google Workspace sur un nouveau domaine. Email @votredomaine avec Gmail, Drive, Docs et Meet.\n\nVous recevez : connexion admin + identifiants domaine.',
 'Google Workspace (Aged Domain)': 'Google Workspace sur un domaine âgé pour une meilleure délivrabilité. Email avec suite Google complète.\n\nVous recevez : connexion admin + identifiants domaine.',
 'Zoho Mail (New Domain)': 'Email professionnel Zoho Mail sur un nouveau domaine. Email @votredomaine avec calendrier, contacts et stockage.\n\nVous recevez : connexion admin + configuration domaine.',
 'Zoho Mail (Aged Domain)': 'Zoho Mail sur un domaine âgé pour une meilleure réputation. Email avec suite Zoho complète.\n\nVous recevez : connexion admin + identifiants domaine.',
 'eSIM T-Mobile': '📶 <b>1 mois — Appels, SMS & data illimités</b>\nCompatible iOS & Android. Scannez le QR pour activer.\n\nVous recevez : QR code ou détails d\'activation.',
 'eSIM Airvoice (AT&T) — 1 Month': '📶 <b>1 mois — Appels, SMS & data illimités (AT&T)</b>\nCompatible iOS & Android. Scannez le QR pour activer.\n\nVous recevez : QR code ou détails d\'activation.',
 'eSIM Airvoice (AT&T) — 3 Months': '📶 <b>3 mois — Appels, SMS & data illimités (AT&T)</b>\nCompatible iOS & Android. Scannez le QR pour activer.\n\nVous recevez : QR code ou détails d\'activation.',
 'eSIM Airvoice (AT&T) — 6 Months': '📶 <b>6 mois — Appels, SMS & data illimités (AT&T)</b>\nCompatible iOS & Android. Scannez le QR pour activer.\n\nVous recevez : QR code ou détails d\'activation.',
 'eSIM Airvoice (AT&T) — 1 Year': '📶 <b>1 an — Appels, SMS & data illimités (AT&T)</b>\nCompatible iOS & Android. Scannez le QR pour activer.\n\nVous recevez : QR code ou détails d\'activation.',
 }
 const desc = descriptions[product] || ''
 return `💰 <b>Commande : ${product}</b>\n\n💵 Prix : <b>$${price}</b>${desc ? '\n\n' + desc : ''}\n\nSélectionnez le mode de paiement :`
 },
 dpOrderConfirmed: (product, price, orderId) => `✅ <b>Commande confirmée !</b>\n\n🛒 Produit : <b>${product}</b>\n💵 Montant : <b>$${price}</b>\n🆔 ID de commande : <code>${orderId}</code>\n\nVotre commande sera livrée via ce bot sous peu.\nPour toute question, contactez le support.`,

 // Virtual Card
 vcWelcome: `💳 <b>Carte de Débit Virtuelle</b>\n\nChargez une carte virtuelle du montant de votre choix.\n\n✅ Fonctionne en ligne dans le monde entier\n✅ Livraison instantanée\n✅ 50$ – 1 000$\n\nSélectionnez un montant ou entrez un montant personnalisé :`,
 vcInvalidAmount: `❌ Veuillez entrer un montant valide entre <b>50$</b> et <b>1 000$</b>.`,
 vcAskAddress: `📬 <b>Adresse de livraison</b>\n\nEntrez votre adresse complète au format international :\n\n<i>Exemple :\nJean Dupont\n123 Rue Principale, Apt 4B\nParis, 75001\nFrance</i>`,
 vcAddressTooShort: `❌ L'adresse semble trop courte. Veuillez inclure nom, rue, ville, code postal et pays.`,
 vcOrderSummary: (amount, fee, total) => `📋 <b>Récapitulatif</b>\n\n💳 Charge carte virtuelle : <b>${amount}$</b>\n💰 Frais de service : <b>${fee.toFixed(2)}$</b>${amount < 200 ? ' (min. 20$)' : ' (10%)'}\n━━━━━━━━━━━━━━━━━\n💵 <b>Total : ${total.toFixed(2)}$</b>\n\nChoisissez le mode de paiement :`,
 vcOrderConfirmed: (amount, total, orderId) => `✅ <b>Commande de carte virtuelle confirmée !</b>\n\n💳 Charge : <b>${amount}$</b>\n💵 Total payé : <b>${total.toFixed(2)}$</b>\n🆔 ID : <code>${orderId}</code>\n\n⏱ <b>Les détails de votre carte seront livrés ici sous peu.</b>`,
 leadsFileNumbersOnly: `📄 <b>Fichier 1 — Numéros de téléphone</b>\nTous les numéros vérifiés de votre lot.`,
 leadsFileWithNames: (count) => `📄 <b>Fichier 2 — Numéros + Nom du propriétaire (${count} correspondances)</b>\nCes leads incluent le vrai nom du propriétaire. Adressez-vous à eux personnellement — cela crée une confiance instantanée et augmente considérablement votre taux de réponse.`,
 addDnsTxt: "Sélectionnez le type d'enregistrement :",
 updateDnsTxt: "Sélectionnez l'enregistrement à modifier :",
 deleteDnsTxt: "Sélectionnez l'enregistrement à supprimer :",
 confirmDeleteDnsTxt: "Êtes-vous sûr de vouloir supprimer cet enregistrement ?",
 a: `Enregistrement A`,
 cname: `Enregistrement CNAME`,
 ns: `Enregistrement NS`,
 'Enregistrement A': `A`,
 'Enregistrement CNAME': `CNAME`,
 'Enregistrement NS': `NS`,
 askDnsContent: {
 NS: '<b>Ajouter un enregistrement NS</b>\n\nEntrez le serveur de noms :\nex. <b>ns1.cloudflare.com</b>',
 'NS Record': '<b>Ajouter un enregistrement NS</b>\n\nEntrez le serveur de noms :\nex. <b>ns1.cloudflare.com</b>',
 },
 askUpdateDnsContent: {
 A: (current) => `<b>Mettre à jour l'enregistrement A</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur adresse IPv4:\nex. <b>192.168.1.1</b>`,
 'A Record': (current) => `<b>Mettre à jour l'enregistrement A</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur adresse IPv4:\nex. <b>192.168.1.1</b>`,
 CNAME: (current) => `<b>Mettre à jour l'enregistrement CNAME</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur domaine cible:\nex. <b>myapp.railway.app</b>`,
 'CNAME Record': (current) => `<b>Mettre à jour l'enregistrement CNAME</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur domaine cible:\nex. <b>myapp.railway.app</b>`,
 NS: (current) => `<b>Mettre à jour l'enregistrement NS</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur serveur de noms:\nex. <b>ns1.cloudflare.com</b>`,
 'NS Record': (current) => `<b>Mettre à jour l'enregistrement NS</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur serveur de noms:\nex. <b>ns1.cloudflare.com</b>`,
 MX: (current) => `<b>Mettre à jour l'enregistrement MX</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur serveur de messagerie:\nex. <b>ASPMX.L.GOOGLE.COM</b>`,
 'MX Record': (current) => `<b>Mettre à jour l'enregistrement MX</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur serveur de messagerie:\nex. <b>ASPMX.L.GOOGLE.COM</b>`,
 TXT: (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>Mettre à jour l'enregistrement TXT</b>\nActuel: <b>${display}</b>\n\nEntrez la nouvelle valeur valeur TXT:\nex. <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 'TXT Record': (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>Mettre à jour l'enregistrement TXT</b>\nActuel: <b>${display}</b>\n\nEntrez la nouvelle valeur valeur TXT:\nex. <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 AAAA: (current) => `<b>Mettre à jour l'enregistrement AAAA</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur adresse IPv6:\nex. <b>2001:db8::1</b>`,
 'AAAA Record': (current) => `<b>Mettre à jour l'enregistrement AAAA</b>\nActuel: <b>${current || 'N/A'}</b>\n\nEntrez la nouvelle valeur adresse IPv6:\nex. <b>2001:db8::1</b>`,
 },
 dnsRecordSaved: "Enregistrement ajouté avec succès. Les modifications DNS peuvent prendre jusqu'à 24h pour se propager.",
 dnsRecordDeleted: 'Enregistrement supprimé avec succès.',
 dnsRecordUpdated: "Enregistrement mis à jour avec succès. Les modifications DNS peuvent prendre jusqu'à 24h pour se propager.",
 provideLink: `Veuillez fournir une URL valide. ex https://google.com`,
 comingSoonWithdraw: `Les retraits ne sont pas encore disponibles. Besoin d'aide ? Appuyez sur 💬 Obtenir de l'aide.`,
 promoOptOut: `Vous avez été désabonné des messages promotionnels. Tapez /start_promos pour vous réabonner à tout moment.`,
 promoOptIn: `Vous êtes de nouveau abonné aux messages promotionnels. Vous recevrez nos dernières offres et promotions !`,
 selectCurrencyToDeposit: `💵 Montant du dépôt (min. $10) :`,
 depositNGN: `Veuillez entrer le montant NGN (minimum ≈ 10 USD).\nVotre Naira sera converti en USD au taux de change actuel :`,
 askEmailForNGN: `Veuillez fournir un email pour la confirmation du paiement`,
 depositUSD: `Veuillez entrer le montant USD, notez que la valeur minimum est de 10 USD :`,
 selectCryptoToDeposit: `Veuillez choisir une cryptomonnaie :\n\n<i>ℹ️ USDT (TRC20) nécessite un dépôt minimum de 20 $.</i>`,

 trc20MinDepositPrompt: (currentAmount, minAmount) =>
  `⚠️ <b>USDT (TRC20) nécessite un minimum de ${minAmount} $</b>\n\n` +
  `Vous avez saisi : <b>${currentAmount} $</b>\n` +
  `Les transferts TRC20 nécessitent ~${minAmount} $+ pour couvrir confortablement les frais d'énergie TRX du côté du destinataire.\n\n` +
  `Que souhaitez-vous faire ?`,
 trc20TopUpBtn: (minAmount) => `✅ Augmenter à ${minAmount} $`,
 trc20SwitchCryptoBtn: '🔄 Choisir une autre crypto',
 trc20EditAmountBtn: '✏️ Saisir un autre montant',
 trc20WhyMinBtn: '💡 Pourquoi ce minimum ?',
 trc20CancelBtn: '❌ Annuler',

 trc20WhyMinExplanation: (minAmount) =>
  `💡 <b>Pourquoi TRC20 nécessite un minimum de ${minAmount} $ ?</b>\n\n` +
  `Chaque transfert USDT TRC20 brûle ~5–15 TRX en frais d'"énergie" réseau côté destinataire. Sur les petits dépôts, ces frais peuvent consommer 30–50 % de ce que vous envoyez — maintenir un seuil de ${minAmount} $ garantit que presque tout votre dépôt arrive dans votre portefeuille.\n\n` +
  `Les autres cryptos (BTC, LTC, ETH) ont moins de frais par transfert, donc aucun minimum ne s'applique.\n\n` +
  `Besoin d'aide ? Contactez le support : ${APP_SUPPORT_LINK}`,
 'bank-pay-plan': (priceNGN, plan) =>
 `Veuillez envoyer ${priceNGN} NGN en cliquant sur "Faire le paiement" ci-dessous. Une fois la transaction confirmée, vous serez notifié immédiatement et votre plan ${plan} sera activé sans encombre.

Cordialement,
${CHAT_BOT_NAME}`,
 bankPayDomain: (priceNGN, domain) =>
 `Veuillez envoyer ${priceNGN} NGN en cliquant sur "Faire le paiement" ci-dessous. Une fois la transaction confirmée, vous serez notifié immédiatement et votre domaine ${domain} sera activé sans encombre.

Cordialement,
${CHAT_BOT_NAME}`,
 showDepositCryptoInfoPlan: (priceUsd, priceCrypto, tickerView, address, plan) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre plan ${plan} sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,
 showDepositCryptoInfoDomain: (priceUsd, priceCrypto, tickerView, address, domain) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre domaine ${domain} sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoLeads: (priceUsd, priceCrypto, tickerView, address, label) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Vos ${label} seront livrés automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoPhone: (priceUsd, priceCrypto, tickerView, address, phoneNumber) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre numéro Cloud IVR ${phoneNumber} sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoDigitalProduct: (priceUsd, priceCrypto, tickerView, address, product) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre commande pour <b>${product}</b> sera livrée automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfo: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>Montant du paiement : $${Number(priceUsd).toFixed(2)} USD</b>\n\nEnvoyez exactement <b>${priceCrypto} ${tickerView}</b> à :\n\n<code>${address}</code>\n\nLes paiements crypto sont confirmés rapidement — généralement en quelques minutes. Une fois confirmé, vous serez notifié rapidement et votre portefeuille sera mis à jour.\n\nCordialement,\n${CHAT_BOT_NAME}`,

 showDepositCryptoInfoOpenEnded: (minUsd, tickerView, address) =>
 `💎 <b>Envoyez n'importe quel montant de ${tickerView}</b> d'une valeur minimale de <b>$${Number(minUsd).toFixed(0)} USD</b> à :\n\n<code>${address}</code>\n\nNous créditerons la valeur marchande complète de ce que vous envoyez.\n\n⚠️ <b>Les dépôts inférieurs à $${Number(minUsd).toFixed(0)} USD sont perdus</b> — les frais réseau pour les balayer coûtent plus que le dépôt lui-même.\n\nLes paiements crypto sont confirmés rapidement — généralement en quelques minutes.\n\nCordialement,\n${CHAT_BOT_NAME}`,

 dustDepositNotice: (receivedUsd, minUsd, tickerView) =>
 `⚠️ <b>Dépôt inférieur au minimum — non crédité</b>\n\nNous avons reçu <b>≈ $${Number(receivedUsd).toFixed(2)} USD</b> en ${tickerView} de votre part, mais le dépôt minimum pour cette monnaie est de <b>$${Number(minUsd).toFixed(0)} USD</b>.\n\nLes frais réseau pour balayer des dépôts aussi petits dépassent le dépôt lui-même, donc vos fonds n'ont pas été crédités.\n\nSi vous avez besoin d'aide, appuyez sur 💬 Support et notre équipe vous assistera.\n\n— ${CHAT_BOT_NAME}`,

 confirmationDepositMoney: (amount, usd) =>
 `Votre paiement de ${amount} ($${view(usd)}) a été traité. Merci de nous avoir choisi.\nCordialement,\n${CHAT_BOT_NAME}`,

 showWallet: (usd) => `Solde du portefeuille :\n\n$${view(usd)}`,

 wallet: (usd) => `Solde du portefeuille :\n\n$${view(usd)}\n\nSélectionnez l'option du portefeuille :`,

 walletSelectCurrency: (usd) =>
 `Solde du portefeuille : $${view(usd)}`,

 walletBalanceLow: `Votre solde est insuffisant. Appuyez sur "👛 Mon portefeuille" → "➕💵 Déposer" pour recharger.`,

 sentLessMoney: (expected, got) =>
 `⚠️ <b>Paiement insuffisant</b>\n\nAttendu : <b>${expected}</b>\nReçu : <b>${got}</b>\n\n✅ <b>${got} a été crédité sur votre portefeuille</b> — rien n'est perdu.\n\n💳 Pour finaliser, rouvrez le service et choisissez <b>👛 Portefeuille</b> au paiement (rechargez la petite différence si besoin). Tapez /start pour continuer.`,

 sentMoreMoney: (expected, got) =>
 `Vous avez envoyé plus d'argent que prévu, donc nous avons crédité le montant supplémentaire dans votre portefeuille. Nous attendions ${expected} mais nous avons reçu ${got}`,

 buyLeadsError: `Malheureusement, le code régional sélectionné est indisponible et votre portefeuille n'a pas été facturé`,
 buyLeadsProgress: (i, total) => `${((i * 100) / total).toFixed()}% de leads téléchargés. Veuillez patienter.`,

 phoneNumberLeads: `Obtenez des leads premium vérifiés par cible ou validez vos propres numéros :`,

 buyLeadsSelectCountry: `Veuillez sélectionner un pays`,
 buyLeadsSelectSmsVoice: `Veuillez sélectionner SMS / Voix`,
 buyLeadsSelectArea: `Veuillez sélectionner une zone`,
 buyLeadsSelectAreaCode: `Veuillez sélectionner un code régional`,
 buyLeadsSelectCarrier: `Veuillez sélectionner un opérateur`,
 buyLeadsSelectCnam: `Voulez-vous le <b>nom du propriétaire du téléphone</b> avec chaque lead ? C'est 15 $ de plus par 1 000 leads — et ça vaut le coup.`,
 buyLeadsSelectAmount: (min, max) =>
 `Combien de leads souhaitez-vous acheter ? Sélectionnez ou saisissez un nombre. Le minimum est de ${min} et le maximum est de ${max}`,

 buyLeadsSelectFormat: `Choisissez le format, par exemple Local (212) ou International (+1212)`,

 buyLeadsSuccess: n => `🎉 <b>Terminé !</b> Vos ${n} leads sont prêts.\n\nVous recevez deux fichiers :\n📄 <b>Fichier 1</b> — Tous les numéros de téléphone\n📄 <b>Fichier 2</b> — Numéros avec le <b>nom du propriétaire</b>\n\nAstuce : Utilisez les noms pour personnaliser votre approche. Les gens répondent 2 à 3 fois plus quand on les appelle par leur nom.`,

 buyLeadsNewPrice: (leads, price, newPrice) =>
 `💰 <b>${leads} leads</b> — maintenant seulement <b>$${view(newPrice)}</b> <s>($${price})</s>\nInclut les noms des propriétaires. Ne ratez pas cette offre.`,
 buyLeadsPrice: (leads, price) => `💰 <b>${leads} leads</b> — <b>$${price}</b>\nInclut les noms des propriétaires. Prêt quand vous l'êtes.`,

 walletSelectCurrencyConfirm: `Confirmer ?`,

 validatorSelectCountry: `Veuillez sélectionner un pays`,
 validatorPhoneNumber: `Veuillez coller vos numéros ou télécharger un fichier incluant le code du pays.`,
 validatorSelectSmsVoice: n =>
 `${n} numéros de téléphone trouvés. Veuillez choisir l'option pour la validation des leads par SMS ou appel vocal.`,
 validatorSelectCarrier: `Veuillez sélectionner un opérateur`,
 validatorSelectCnam: `Voulez-vous le <b>nom du propriétaire du téléphone</b> avec vos leads validés ?\n\nConnaître qui vous contactez permet de personnaliser votre message — les gens répondent à leur propre nom. 15 $ par 1 000 leads. Ça vaut chaque centime.`,
 validatorSelectAmount: (min, max) =>
 `Combien de numéros souhaitez-vous valider ? Sélectionnez ou saisissez un nombre. Le minimum est de ${min} et le maximum est de ${max}`,

 validatorSelectFormat: `Choisissez le format, par exemple Local (212) ou International (+1212)`,

 validatorSuccess: (n, m) => `${n} leads sont validés. ${m} numéros de téléphone valides trouvés.`,
 validatorProgress: (i, total) => `${((i * 100) / total).toFixed()}% de leads validés. Veuillez patienter.`,
 validatorProgressFull: (i, total) => `${((i * 100) / total).toFixed()}% de leads validés.`,

 validatorError: `Malheureusement, les numéros de téléphone sélectionnés sont indisponibles et votre portefeuille n'a pas été facturé`,
 validatorErrorFileData: `Numéro de téléphone de pays invalide trouvé. Veuillez télécharger le numéro de téléphone pour le pays sélectionné`,
 validatorErrorNoPhonesFound: `Aucun numéro de téléphone trouvé. Réessayez.`,

 validatorBulkNumbersStart: `La validation des leads a commencé et sera bientôt terminée.`,

 // url re-director
 redSelectUrl: `Veuillez partager l'URL que vous souhaitez raccourcir et analyser. ex : https://cnn.com`,
 redSelectRandomCustom: `Veuillez sélectionner votre choix pour un lien aléatoire ou personnalisé`,
 redSelectProvider: `Choisissez le fournisseur de lien`,
 redSelectCustomExt: `Entrez le suffixe personnalisé`,

 redValidUrl: `Veuillez fournir une URL valide. ex : https://google.com`,
 redTakeUrl: url => `Votre URL raccourcie est : ${url}`,
 redIssueUrlBitly: `Le raccourcissement a échoué. Votre portefeuille n'a pas été débité. Réessayez ou appuyez sur 💬 Obtenir de l'aide.`,
 redIssueSlugCuttly: `Le nom de lien préféré est déjà pris, essayez un autre.`,
 redIssueUrlCuttly: `Le raccourcissement a échoué. Réessayez ou appuyez sur 💬 Obtenir de l'aide.`,
 freeLinksExhausted: `Vos ${FREE_LINKS} liens d'essai sont épuisés ! Abonnez-vous pour des liens illimités + domaines gratuits + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ validations avec noms des propriétaires.`,
 subscriptionLeadsHint: `💡 Les abonnés obtiennent ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ validations gratuites avec noms des propriétaires par plan. À partir de $${PRICE_DAILY}/jour.`,
 linksRemaining: (count, total) => {
 const base = `Il vous reste ${count} sur ${total || FREE_LINKS} lien${count !== 1 ? 's' : ''} Shortit d'essai.`
 if (count <= 2) return `${base}\n\n⚡ <b>Plus que ${count} lien${count !== 1 ? 's' : ''} !</b> Abonnez-vous pour des liens illimités + domaines gratuits + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ validations avec noms des propriétaires. Dès $${PRICE_DAILY}/jour.`
 return base
 },
 redNewPrice: (price, newPrice) =>
 `Le prix est maintenant de $${view(newPrice)} <s>($${price})</s>. Veuillez choisir la méthode de paiement.`,
 customLink: 'Lien personnalisé',
 randomLink: 'Lien aléatoire',
 askShortLinkExtension: 'Veuillez nous indiquer votre extension de lien court préférée : par exemple payer',
 linkAlreadyExist: `Le lien existe déjà. Veuillez taper 'ok' pour essayer un autre.`,
 yourShortendUrl: shortUrl => `Votre URL raccourcie est : ${shortUrl}`,

 availablefreeDomain: (plan, available, s) =>
 `Rappelez-vous, votre plan ${plan} comprend ${available} domaine gratuit${s}. Obtenez votre domaine dès aujourd'hui !`,
 shortenedUrlLink: `Veuillez partager l'URL que vous souhaitez raccourcir et analyser. e.g https://cnn.com`,
 selectedTrialPlan: `Vous avez sélectionné le plan d'essai gratuit`,
 userPressedBtn: message => `L'utilisateur a appuyé sur le bouton ${message}.`,
 userToBlock: userToBlock => `L'utilisateur ${userToBlock} n'a pas été trouvé.`,
 userBlocked: userToBlock => `L'utilisateur ${userToBlock} a été bloqué.`,
 checkingDomainAvail: `Vérification de la disponibilité du domaine...`,
 checkingExistingDomainAvail: `Vérification de la disponibilité du domaine existant...`,
 subscribeFirst: `📋 Abonnez-vous d'abord`,
 freeValidationUsed: (amount, remaining) => `${amount} numéros USA validés avec votre abonnement ! Validations gratuites restantes : ${remaining.toLocaleString()}.`,
 partialFreeValidation: (freeAmount, totalAmount, paidAmount, paidPrice) => `Il vous reste ${freeAmount.toLocaleString()} validations gratuites. Votre demande porte sur ${totalAmount.toLocaleString()} numéros.\n\n${freeAmount.toLocaleString()} seront couverts gratuitement, et les ${paidAmount.toLocaleString()} restants coûteront $${paidPrice}. Veuillez procéder au paiement ci-dessous.`,
 notValidHalf: `Entrez une partie arrière valide`,
 linkAlreadyExist: `Le lien existe déjà. Veuillez en essayer un autre.`,
 issueGettingPrice: `Problème pour obtenir le prix`,
 domainInvalid: `Le nom de domaine est invalide. Veuillez en essayer un autre. Utilisez le format abcpay.com`,
 domainMissingTLD: 'Extension de domaine manquante. Veuillez ajouter .com, .net, .org ou une autre extension.\n\nExemple: <b>votrenom.com</b>',
 domainTooShort: 'Le nom de domaine est trop court. Doit contenir au moins 3 caractères avant le point.\n\nExemple: <b>abc.com</b>',
 domainInvalidChars: 'Le domaine contient des caractères invalides. Utilisez uniquement des lettres, chiffres et traits d\'union.\n\nExemple: <b>mon-site.com</b>',
 domainStartsEndsHyphen: 'Le domaine ne peut pas commencer ou finir par un trait d\'union.\n\nExemple: <b>monsite.com</b> (pas -monsite.com ou monsite-.com)',
 domainSearchTimeout: (domaine) => `⏱️ La recherche du domaine <b>${domaine}</b> prend plus de temps que prévu.\n\nVeuillez réessayer dans un instant ou contacter le support si cela persiste.`,
 chooseValidPlan: `Veuillez choisir un plan valide`,
 noDomainFound: `Aucun nom de domaine trouvé`,
 chooseValidDomain: `Veuillez choisir un domaine valide`,
 failedAudio: '❌ Échec du traitement audio. Veuillez réessayer.',
 enterBroadcastMessage: 'Entrez le message',
 provide2Nameservers: 'Veuillez fournir au moins 2 serveurs DNS séparés par un espace.',
 noDomainSelected: 'Aucun domaine sélectionné.',
 validInstitutionName: '⚠️ Veuillez entrer un nom d\'institution valide (2-100 caractères).',
 validCityName: '⚠️ Veuillez entrer un nom de ville valide.',
 errorDeletingDns: error =>
 `Erreur lors de la suppression de l'enregistrement DNS, ${error}, Veuillez fournir à nouveau la valeur`,
 selectValidOption: `sélectionnez une option valide`,
 cancelled: 'Annulé.',
 domainActionsMenu: (domain) => `<b>Actions pour ${domain}</b>\n\nSélectionnez une option :`,
 purchaseFailed: '❌ Achat échoué. Votre portefeuille a été remboursé. Veuillez réessayer ou contacter le support.',
 maxDnsRecord: `Un maximum de 4 enregistrements NS peut être ajouté, vous pouvez mettre à jour ou supprimer les enregistrements NS précédents`,
 errorSavingDns: error =>
 `Erreur lors de la sauvegarde de l'enregistrement DNS, ${error}, Veuillez fournir à nouveau la valeur`,
 fileError: `Erreur lors du traitement du fichier.`,
 ammountIncorrect: `Montant incorrect`,
 subscriptionExpire: (subscribedPlan, timeEnd) => `Votre abonnement ${subscribedPlan} est expiré le ${timeEnd}`,
 plansSubscripedtill: (subscribedPlan, timeEnd) =>
 `Vous êtes actuellement abonné au plan ${subscribedPlan}. Votre plan est valide jusqu'au ${timeEnd}`,
 planNotSubscriped: `Vous n'êtes actuellement abonné à aucun plan.`,
 noShortenedUrlLink: `Vous n'avez encore aucun lien raccourci.`,
 shortenedLinkText: linksText => `Voici vos liens raccourcis :\n${linksText}`,
 analyticsNotAvailable: provider => `📊 statistiques indisponibles (${provider})`,
 qrCodeText: `Voici votre code QR !`,
 scanQrOrUseChat: chatId => `📱 <b>Nomadly SMS App</b>\n\nVotre code d'activation :\n<code>${chatId}</code>\n\n📲 Téléchargez : ${process.env.SMS_APP_LINK || 'Contactez le support'}`,
 domainPurchasedFailed: (domain) =>
 `❌ L'enregistrement du domaine <b>${domain}</b> n'a pas pu être complété. Veuillez réessayer ou contacter le support si le problème persiste.`,
 noDomainRegistered: `Vous n'avez pas encore acheté de domaines.`,
 registeredDomainList: domainsText => `Voici vos domaines achetés :\n${domainsText}`,
 selectDomainAction: domain => `<b>${domain}</b>\n\nQue souhaitez-vous faire avec ce domaine ?`,
 domainActionDns: '🔧 Gestion DNS',
 domainActionShortener: '🔗 Activer pour le raccourcisseur',
 domainActionDeactivateShortener: '🔗 Désactiver le raccourcisseur',
 comingSoon: `Bientôt disponible`,

 // --- Missing translations (added for completeness) ---
 Annually: 'annuellement',
 Daily: 'Quotidien',
 Hourly: 'par heure',
 Monthly: 'Mensuel',
 Quarterly: 'trimestriel',
 Weekly: 'Hebdomadaire',
 addSubdomain: 'Ajouter un sous-domaine',
 antiRedDisabled: domain => `❌ Visitor Captcha <b>désactivée</b> pour <b>${domain}</b>.\n\nLa page "Vérification de votre navigateur" est maintenant masquée pour les visiteurs humains.\n\n✅ <b>La protection Anti-Red reste totalement active</b> : masquage des scanners (Google Safe Browsing, VirusTotal, McAfee, PhishTank, Sucuri et 25 autres), honeypots, bannissements d'IP, et règles WAF Cloudflare s'exécutent toujours pour chaque requête.\n\nSeule l'interstice humaine est supprimée via le flag KV côté Worker.`,
 antiRedDisableConfirm: domain => `🛡️ <b>Masquer Visitor Captcha pour ${domain} ?</b>\n\nCela masque uniquement l'interstice "Vérification de votre navigateur" pour les visiteurs humains (pour qu'ils n'aient pas à attendre 3 secondes).\n\n✅ Masquage des scanners, honeypots, bannissements d'IP et règles WAF <b>restent actifs</b> pour tout le monde — la protection Anti-Red n'est PAS désactivée.\n\nContinuer ?`,
 antiRedConfirmDisable: '✅ Oui, masquer la page captcha',
 antiRedDisableConfirmWrong: 'Appuyez sur le bouton vert pour confirmer, ou ↩️ Retour pour annuler.',
 antiRedAutoReenabled: domain => `🛡️ Visitor Captcha réactivée pour <b>${domain}</b>.`,
 antiRedRestoredNote: domain => `🛡️ <b>Anti-Red restauré pour ${domain}.</b>\n\nNous venons de corriger un bug interne où désactiver Visitor Captcha supprimait aussi le masquage des scanners. Anti-Red est de nouveau ON (masquage des scanners, honeypots, bannissements d'IP, WAF).\n\nVotre préférence "Visitor Captcha OFF" est préservée — les visiteurs humains ne voient toujours pas la page "Vérification de votre navigateur".`,
 antiRedEnabled: domain => `✅ Protection Anti-Red <b>activée</b> pour <b>${domain}</b>.\n\nLes visiteurs verront une brève vérification "Vérification de votre navigateur" avant d'accéder à votre site.`,
 antiRedError: '❌ Échec de la mise à jour de la protection Anti-Red. Veuillez réessayer.',
 honeypotMonthlyOnly: `🍯 <b>Pièges Honeypot</b>\n\nCette option est disponible sur les plans d'hébergement <b>mensuels</b> (Premium ou Golden).\n\nLes pièges honeypot sont des leurres cachés qui détectent et bannissent automatiquement les bots qui sondent votre site. Certains sites diffusant du JSON/API brut préfèrent les désactiver — ce réglage est réservé aux plans mensuels.\n\nPassez à un plan mensuel pour gérer les pièges Honeypot par domaine.`,
 honeypotStatusOn: domain => `🍯 <b>Pièges Honeypot</b> pour <b>${domain}</b>\n\nÉtat : <b>✅ ACTIVÉ</b>\n\nDes liens leurres, champs de formulaire et fausses API cachés sont injectés dans vos pages HTML pour piéger et bannir les bots.\n\nℹ️ Les pièges ne sont ajoutés qu'aux vraies pages HTML — les réponses JSON/API ne sont jamais modifiées. Désactivez uniquement si votre site intègre une sortie en ligne qui doit rester exacte.`,
 honeypotStatusOff: domain => `🍯 <b>Pièges Honeypot</b> pour <b>${domain}</b>\n\nÉtat : <b>❌ DÉSACTIVÉ</b>\n\nAucun code honeypot n'est injecté dans vos pages.\n\n✅ <b>Toujours actifs :</b> Captcha Visiteur, masquage anti-scanner, bannissements d'IP et règles WAF — désactiver les honeypots n'affaiblit aucune de ces couches.\n\nAppuyez ci-dessous pour réactiver les pièges.`,
 honeypotTurnOff: '❌ Désactiver les pièges Honeypot',
 honeypotTurnOn: '✅ Activer les pièges Honeypot',
 honeypotTurningOn: domain => `⏳ Activation des pièges Honeypot pour <b>${domain}</b>...`,
 honeypotTurningOff: domain => `⏳ Désactivation des pièges Honeypot pour <b>${domain}</b>...`,
 honeypotEnabled: domain => `✅ Pièges Honeypot <b>activés</b> pour <b>${domain}</b>.\n\nDes leurres anti-bots sont désormais injectés dans vos pages HTML. Les réponses JSON/API ne sont jamais modifiées.`,
 honeypotDisabled: domain => `❌ Pièges Honeypot <b>désactivés</b> pour <b>${domain}</b>.\n\nAucun code piège ne sera injecté dans vos pages.\n\n✅ Captcha Visiteur, masquage anti-scanner, bannissements d'IP et règles WAF restent pleinement actifs.`,
 honeypotError: '❌ Échec de la mise à jour des pièges Honeypot. Veuillez réessayer.',
 honeypotPickDomain: `🍯 <b>Pièges Honeypot</b> — choisissez un domaine\n\nCe plan inclut plusieurs domaines. Appuyez sur le domaine à basculer. L'état actuel est indiqué à côté de chaque nom.`,
 honeypotDomainButton: (domain, off, hasCF) => hasCF ? `${off ? '🔴 OFF' : '🟢 ON'} · ${domain}` : `⚠️ Pas de CF · ${domain}`,
captchaPickDomain: '🛡️ <b>Captcha Visiteur</b> — choisissez un domaine\n\nCe plan comprend plusieurs domaines. Touchez le domaine pour lequel vous voulez basculer le captcha. L\'état actuel est indiqué à côté de chaque nom.',
captchaDomainButton: (domain, isOff, hasCF) => hasCF ? `${isOff ? '🔴 OFF' : '🟢 ON'} · ${domain}` : `⚠️ Pas de CF · ${domain}`,
 antiRedNoCF: domain => `⚠️ <b>${domain}</b> n'utilise pas Cloudflare. La protection Anti-Red nécessite les serveurs de noms Cloudflare.\n\nAllez dans Gestion DNS → Passez d'abord aux NS Cloudflare.`,
 antiRedStatusOff: domain => `🛡️ <b>Visitor Captcha</b> pour <b>${domain}</b>\n\nStatut : <b>❌ DÉSACTIVÉ (humains uniquement)</b>\n\nL'interstice "Vérification de votre navigateur" est masqué pour les visiteurs humains.\n\n✅ <b>Toujours actif :</b> masquage des scanners (Google SafeBrowsing, VirusTotal, McAfee, PhishTank et 25+ autres), honeypots, bannissements d'IP, règles WAF — exécutés pour chaque requête.\n\nTouchez ci-dessous pour réafficher la captcha aux visiteurs.`,
 antiRedStatusOn: domain => `🛡️ <b>Protection Anti-Red</b> pour <b>${domain}</b>\n\nStatut : <b>✅ ACTIVÉ</b>\n\nCela protège votre domaine contre les scanners de phishing.\n\n⚠️ <b>Recommandation :</b> Gardez le JS Challenge activé pour une protection maximale.`,
 antiRedTurnOff: '❌ Désactiver la protection',
 antiRedTurnOn: '✅ Activer la protection',
 antiRedTurningOff: domain => `⏳ Désactivation de la protection Anti-Red pour <b>${domain}</b>...`,
 antiRedTurningOn: domain => `⏳ Activation de la protection Anti-Red pour <b>${domain}</b>...`,
 dnsWarningHostedDomain: (domain, plan) => `⚠️ <b>ATTENTION : Ce domaine a un plan d'hébergement actif</b>\n\nDomaine : <b>${domain}</b>\nPlan : ${plan}\n\n<b>⚠️ La modification des enregistrements DNS peut casser votre hébergement et la protection anti-red !</b>\n\nLes modifications DNS ne doivent être effectuées que si vous comprenez parfaitement l'impact. Des modifications incorrectes peuvent rendre votre site inaccessible ou supprimer les protections de sécurité.\n\n<b>Êtes-vous sûr de vouloir continuer ?</b>`,
 dnsProceedAnyway: '⚠️ Continuer quand même',
 dnsCancel: '❌ Annuler',
 domainTypeRegistered: '🏷️ Enregistré chez nous',
 domainTypeExternal: '🌍 Externe',
 buyLeads: '🎯 Acheter des leads téléphoniques',
 cancelRenewNow: '❌ Annuler',
 confirmRenewNow: '✅ Confirmer & Payer',
 domainActionAntiRed: '🛡️ Captcha Visiteur',
 domainActionVisitorCaptcha: '🛡️ Captcha Visiteur',
 domainActionVisitorCaptchaLocked: '🔒 Captcha Visiteur (Gold uniquement)',
 visitorCaptchaGoldOnly: (domain, price) => `🔒 <b>Captcha Visiteur</b> pour <b>${domain}</b>\n\nCette fonctionnalité est exclusive aux plans <b>👑 Golden Anti-Red HostPanel</b>.\n\nMettez à niveau vers Golden (<b>$${price}/mois</b>) pour activer le Captcha Visiteur par domaine.`,
 visitorCaptchaNoHosting: (domain, price) => `⚠️ <b>Captcha Visiteur</b> est uniquement disponible pour les domaines avec un plan Golden Anti-Red HostPanel.\n\nDomaine : <b>${domain}</b>\n\nMettez à niveau vers Golden (<b>$${price}/mois</b>).`,
 upgradeToGoldButton: price => `⬆️ Passer à Gold ($${price}/mois)`,
 googleEmail: 'Configurer Google Email',
 pointToIp: 'Pointer le domaine vers IP',
 shortenLink: '✂️ Raccourcir un lien',
 toggleAutoRenew: '🔁 Activer/Désactiver le renouvellement automatique',
 validateLeads: '✅ Valider les numéros',
 verification: 'Vérification du domaine (TXT)',
 walletBalanceLowAmount: (needed, balance) => 
 `Votre solde ($${balance.toFixed(2)}) est insuffisant.\n\nIl vous manque <b>$${(needed - balance).toFixed(2)}</b>. Appuyez sur Dépôt pour recharger.`,
 zohoEmail: 'Configurer Zoho Email',
 goBackToCoupon: '❌ Retourner & Appliquer le Coupon',
 errorFetchingCryptoAddress:
 "Erreur lors de la récupération de l'adresse de la cryptomonnaie. Veuillez réessayer plus tard.",
 paymentSuccessFul: '✅ Paiement confirmé — provisionnement de vos services en cours.',
 domainProcessingOrder: '⏳ Traitement de votre commande — enregistrement de votre domaine en cours.',
 nsVerifying: (tld) => `🔍 Vérification de la configuration des serveurs de noms auprès du registre .${tld} — environ 30 à 60 secondes…`,
 nsVerifiedOk: '✅ Serveurs de noms vérifiés — enregistrement en cours.',
 mpPaywall: (fee, balance) =>
   `🛒 <b>Accès Marketplace</b>\n\n` +
   `Frais d'activation unique : <b>$${fee}</b>\n` +
   `Payez une fois — accès permanent (parcourir, vendre, discuter, séquestre).\n\n` +
   `💳 Solde du portefeuille : <b>$${balance.toFixed(2)}</b>\n\n` +
   (balance >= fee
     ? `Touchez ci-dessous pour activer.`
     : `⚠️ <i>Rechargez d'au moins $${(fee - balance).toFixed(2)} de plus pour activer.</i>`),
 mpPaywallPayBtn: (fee) => `✅ Payer $${fee} via portefeuille`,
 mpPaywallTopupBtn: '👛 Recharger le portefeuille',
 mpPaywallCancelBtn: '❌ Annuler',
 mpPaywallCryptoBtn: '₿ Payer en crypto',
 mpPaywallNgnBtn: '🏦 Payer en NGN (banque)',
 mpPayChooseCrypto: (fee) => `₿ <b>Payer les frais Marketplace de $${fee} en crypto</b>\n\nChoisissez une pièce — vous recevrez une adresse pour envoyer exactement les frais. L'accès s'active automatiquement dès la confirmation du paiement.`,
 mpPayNgnStarting: (fee) => `🏦 <b>Préparation de votre paiement NGN pour les frais Marketplace de $${fee}…</b>`,
 mpAccessActivated: (method) => `🎉 <b>Accès Marketplace activé !</b>\n\n✅ Payé via ${method}.\n\nVous pouvez maintenant :\n• 🛍️ <b>Lister</b> vos biens et services\n• 💬 Discuter avec les acheteurs\n• 🔒 Utiliser l'escrow pour des transactions sûres\n\nAppuyez ci-dessous pour ouvrir le marché.`,
 mpAccessAlreadyCredited: (usd) => `ℹ️ Vous avez déjà accès au marché, donc votre paiement de <b>$${Number(usd).toFixed(2)}</b> a été crédité sur votre portefeuille.`,
 mpOpenMarketplaceBtn: '🏪 Ouvrir le marché',
 mpPaywallInsufficient: (fee, balance) =>
   `🚫 <b>Solde insuffisant</b>\n\n` +
   `Besoin : <b>$${fee}</b> · Disponible : <b>$${balance.toFixed(2)}</b>\n\n` +
   `Rechargez <b>$${Math.max(fee - balance, 25).toFixed(2)}</b> ou plus via 👛 <b>Portefeuille</b>, puis réessayez.`,
 mpPaywallSuccess: (fee, balance) =>
   `🎉 <b>Marketplace activé !</b>\n\n` +
   `💵 Débité : <b>$${fee}</b>\n` +
   `💳 Nouveau solde : <b>$${balance.toFixed(2)}</b>\n\n` +
   `Bienvenue — ouverture du marketplace…`,

 // Renvoi d'appels (Cloud IVR)
 fwdInsufficientBalance: (walletBal, rate) => `🚫 <b>Solde insuffisant</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · Requis $${rate}/min\n👉 Rechargez <b>$25</b> via 👛 Portefeuille.`,
 fwdBlocked: (number) => `🚫 <b>Bloqué</b> — ${number} est une destination premium.\nAppuyez 💬 <b>Obtenir de l'aide</b>.`,
 fwdNotRoutable: (number) => `⚠️ ${number} non joignable. Vérifiez ou appuyez 💬 <b>Obtenir de l'aide</b>.`,
 fwdValidating: '⏳ Validation en cours...',
 fwdEnterNumber: (rate, walletBal, usRate) => {
 let text = `Entrez le numéro avec indicatif pays (ex: +14155551234)\n\n💰 <b>Tarifs de transfert</b> — facturés à la minute depuis votre portefeuille :\n🇺🇸 US / Canada : <b>$${Number(usRate).toFixed(2)}/min</b>\n🌍 International : <b>$${Number(rate).toFixed(2)}/min</b>`
 if (walletBal !== undefined) {
 const estUs = usRate > 0 ? Math.floor(walletBal / usRate) : 0
 const estIntl = rate > 0 ? Math.floor(walletBal / rate) : 0
 text += `\n\n💳 Portefeuille : <b>$${walletBal.toFixed(2)}</b> — couvre environ <b>${estUs} min</b> vers US/CA ou <b>${estIntl} min</b> à l'international avant recharge.`
 if (walletBal < rate) text += `\n⚠️ Rechargez <b>$25</b> via 👛 Portefeuille d'abord.`
 }
 return text
 },
 fwdConfirm: (number, forwardTo, modeLabel, rate, walletBal, estMin) => {
 return `📲 <b>Confirmer le transfert d'appel</b>\n\n📞 Votre numéro : <b>${number}</b>\n➡️ Transférer vers : <b>${forwardTo}</b>\n⚙️ Mode : <b>${modeLabel}</b>\n💰 Tarif : <b>$${Number(rate).toFixed(2)}/min</b> — facturé depuis votre portefeuille\n💳 Portefeuille : <b>$${walletBal.toFixed(2)}</b> — couvre environ <b>${estMin} min</b>\n\nAppuyez sur <b>✅ Confirmer</b> pour activer, ou ↩️ Retour pour modifier.`
 },
 fwdConfirmBtn: '✅ Confirmer et activer',
 planNotFound: 'Forfait introuvable.',
 noActivePlans: '📋 <b>Mes Forfaits Hébergement</b>\n\nVous n\'avez aucun forfait actif. Achetez un forfait pour commencer !',
 noRegisteredDomains: 'Vous n\'avez aucun domaine enregistré. Veuillez enregistrer un nouveau domaine ou connecter un domaine externe.',
 selectFromDomains: 'Sélectionnez un domaine parmi vos domaines enregistrés :',
 selectDomainFromList: 'Veuillez sélectionner un domaine dans la liste.',
 enterValidDomain: 'Veuillez entrer un nom de domaine valide (ex : example.com).',
 enterCouponCode: 'Entrez le code coupon :',
 invalidCoupon: 'Coupon invalide. Réessayez ou appuyez sur Passer.',
 couponAlreadyUsed: 'Coupon déjà utilisé. Essayez-en un autre ou appuyez sur Passer.',
 couponUsedToday: '⚠️ Vous avez déjà utilisé ce coupon aujourd\'hui.',
 keyboardRefreshed: 'Clavier actualisé ! Veuillez sélectionner une option :',
 supportEnded: '✅ Session de support terminée. Merci de nous avoir contactés !',
 noSupportSession: 'Aucune session de support active.',
 supportMsgReceived: '✉️ Message reçu ! Un agent de support vous répondra sous peu.',
 supportMsgSent: '✉️ Message envoyé au support. Nous vous répondrons sous peu.',
 someIssue: 'Un problème est survenu',
 dbConnecting: 'La base de données se connecte, veuillez réessayer dans un instant',
 chooseValidDomain: 'Veuillez choisir un domaine valide',
 dnsCustomOnly: 'Les enregistrements DNS sont gérés par votre fournisseur personnalisé. Vous pouvez uniquement mettre à jour les serveurs de noms ou changer de fournisseur.',
 noDeleteRecords: 'Aucun enregistrement supprimable. Les enregistrements NS ne peuvent être que mis à jour.',
 invalidSrvFormat: 'Format invalide. Utilisez <b>_service._protocol</b> (ex : _sip._tcp) :',
 insufficientBalance: (usdBal, price) => `⚠️ Solde insuffisant. Vous avez $${usdBal} mais il faut $${price}.\nDéposez des fonds d'abord.`,
 leadSelectMetro: (target) => `📍 Zone métro pour <b>${target}</b> :\n\nChoisissez "Toutes les Villes" pour une couverture maximale.`,
 leadSelectArea: (target, city) => `📞 Indicatif pour <b>${target}</b> — <b>${city}</b> :\n\n"Indicatifs Mixtes" donne le plus grand pool.`,
 leadRequestCustom: '📝 <b>Leads Personnalisés</b>\n\nIndiquez l\'institution ou entreprise cible.\nNous fournissons des numéros vérifiés avec le nom du propriétaire :',
 leadCustomCity: (target) => `🏙️ Quelle ville ?\n\nCible : <b>${target}</b>\n\nTapez le nom ou "National" :`,
 leadCustomDetails: (target, city) => `📋 Détails supplémentaires ?\n\nCible : <b>${target}</b>\nZone : <b>${city}</b>\n\nTapez ou "Aucun" :`,
 leadAllCities: 'Toutes les Villes',
 leadNationwide: 'National',
 leadNone: 'Aucun',
 leadRequestTarget: '📝 Demande Cible Perso',
 noPendingLeads: '📝 Aucune demande en attente.',
 backupCreated: 'Sauvegarde créée.',
 dataRestored: 'Données restaurées.',
 vpsRefundFailed: (currency, amount, error) => `❌ <b>VPS échoué</b>\n\n✅ Remboursement ${currency}${amount}.\n\nErreur : ${error}`,
 shortenerConflict: (domain, plan) => `❌ Impossible — <b>${domain}</b> a un hébergement actif (<b>${plan}</b>). Utilisez un autre domaine.`,
 shortenerLinked: (domain) => `✅ <b>${domain}</b> lié au raccourcisseur. Propagation DNS ~24h.`,
 shortenerError: (domain, error) => `❌ Erreur raccourcisseur <b>${domain}</b> : ${error}`,
 domainSearching: (domain) => `🔍 Recherche pour ${domain}...`,
 domainNotAvailable: (domain) => `❌ <b>${domain}</b> indisponible.`,
 domainSearchAlts: (baseName) => `🔍 Recherche d'alternatives pour <b>${baseName}</b>...`,
 domainAltsFound: (altList) => `✅ Alternatives :\n\n${altList}\n\nTapez un domaine :`,
 dnsLinkError: (domain, error) => `❌ Impossible de lier <b>${domain}</b> : ${error}`,
 dnsSaveError: (domain, error) => `❌ Erreur DNS <b>${domain}</b> : ${error}`,
 selectProceedOrCancel: 'Sélectionnez "Continuer" ou "Annuler".',

 // ── Email Blast i18n ──
 ebSendBlast: '📤 Envoyer Email en Masse',
 ebMyCampaigns: '📬 Mes Campagnes',
 ebAdminPanel: '⚙️ Panneau Admin',
 ebCancelBtn: '❌ Annuler',
 ebCancelled: '❌ Annulé.',
 ebUploadCsvTxt: '📎 Téléchargez un fichier CSV/TXT ou collez les adresses email (une par ligne).',
 ebUploadCsvOnly: '❌ Veuillez télécharger un fichier <b>.csv</b> ou <b>.txt</b>.',
 ebUploadHtmlFile: '📎 Veuillez télécharger un fichier <b>.html</b>, ou appuyez sur ❌ Annuler.',
 ebTypeOrUpload: '📝 Tapez votre message ou téléchargez un fichier HTML.',
 ebEnterSubject: '✏️ Entrez le nouvel <b>Objet</b> :',
 ebChooseTextOrHtml: 'Choisissez : "📝 Texte brut" ou "📎 Télécharger HTML"',
 ebTypeText: '📝 Texte brut',
 ebUploadHtml: '📎 Télécharger HTML',
 ebInvalidEmail: '❌ Adresse email invalide. Entrez un email valide (ex: vous@gmail.com) :',
 ebFailedReadHtml: '❌ Impossible de lire le fichier HTML. Réessayez ou téléchargez un autre fichier.',
 ebBundleNotFound: '❌ Bundle introuvable.',
 ebCampaignNotFound: '❌ Campagne introuvable.',
 ebTestSending: (addr) => `⏳ Envoi d'un email test à <b>${addr}</b> via Brevo...`,
 ebAddDomainBtn: '➕ Ajouter Domaine',
 ebRemoveDomainBtn: '❌ Supprimer Domaine',
 ebDashboardBtn: '📊 Tableau de Bord',
 ebManageDomainsBtn: '🌐 Gérer Domaines',
 ebManageIpsBtn: '🖥️ Gérer IPs & Chauffage',
 ebPricingBtn: '💰 Tarification',
 ebSuppressionBtn: '🚫 Liste de Suppression',
 ebAddIpBtn: '➕ Ajouter IP',
 ebPauseIpBtn: '⏸ Suspendre IP',
 ebResumeIpBtn: '▶️ Reprendre IP',
 ebAdminPanelTitle: '⚙️ <b>Panneau Admin Email</b>',
 ebNoDomains: '📭 Aucun domaine configuré.',
 ebDomainRemoved: (d) => `✅ Domaine <b>${d}</b> supprimé avec succès.\n\nEnregistrements DNS nettoyés.`,
 ebDomainRemoveFailed: (err) => `❌ Échec de la suppression : ${err}`,
 ebInvalidDomain: '❌ Nom de domaine invalide. Entrez un domaine valide (ex: example.com)',
 ebInvalidIp: '❌ Adresse IP invalide. Entrez une IPv4 valide (ex: 1.2.3.4)',
 ebSettingUpDomain: (d) => `⏳ Configuration de <b>${d}</b>...\n\nCréation des enregistrements DNS, génération des clés DKIM...`,
 ebNoActiveIps: 'Aucune IP active à suspendre.',
 ebNoPausedIps: 'Aucune IP en pause.',
 ebIpPaused: (ip) => `⏸ IP ${ip} suspendue.`,
 ebIpResumed: (ip) => `▶️ IP ${ip} reprise.`,
 ebRateUpdated: (rate) => `✅ Tarif mis à jour : <b>$${rate}/email</b> ($${(rate * 500).toFixed(0)} par 500)`,
 ebMinUpdated: (min) => `✅ Minimum d'emails mis à jour : <b>${min}</b>`,
 ebInvalidRate: '❌ Invalide. Entrez un nombre comme 0.10',
 ebInvalidMin: '❌ Invalide. Entrez un nombre.',
 ebSelectIpDomain: (ip) => `🖥️ Assigner l'IP <b>${ip}</b> à quel domaine ?`,

 // ── Audio Library / IVR i18n ──
 audioLibTitle: '🎵 <b>Bibliothèque Audio</b>',
 audioLibEmpty: '🎵 <b>Bibliothèque Audio</b>\n\nVous n\'avez aucun fichier audio.\n\nTéléchargez un fichier audio (MP3, WAV, OGG) pour les campagnes IVR.',
 audioLibEmptyShort: '🎵 <b>Bibliothèque Audio</b>\n\nAucun fichier audio. Téléchargez-en un pour commencer.',
 audioUploadBtn: '📎 Télécharger Audio',
 audioUploadNewBtn: '📎 Nouveau Audio',
 audioUseTemplateBtn: '📝 Utiliser Modèle IVR',
 audioSelectOption: 'Sélectionnez une option :',
 audioSelectIvr: 'Sélectionnez l\'audio IVR :',
 audioReceived: (size) => `✅ Audio reçu ! (${size} Ko)\n\nDonnez-lui un nom pour votre bibliothèque :`,
 audioReceivedShort: '✅ Audio reçu !\n\nDonnez-lui un nom :',
 audioSaved: (name) => `✅ Audio enregistré sous : <b>${name}</b>\n\nVous pouvez maintenant l'utiliser dans les campagnes IVR !`,
 audioDeleted: (name) => `✅ Supprimé : <b>${name}</b>`,
 audioGenFailed: (err) => `❌ Échec de la génération audio : ${err}`,
 audioFailedSave: '❌ Impossible d\'enregistrer le message d\'accueil. Veuillez réessayer.',
 audioMaxImages: '📸 Maximum 5 images. Appuyez sur ✅ Téléchargement terminé pour continuer.',

 // ── Common i18n ──
 chooseOption: 'Veuillez choisir une option :',
 refreshStatusBtn: '🔄 Actualiser le Statut',
 cancelRefundBtn: '❌ Annuler & Rembourser',
 dbConnectRetry: 'La base de données se connecte, veuillez réessayer dans un instant',
 nsCannotAdd: 'Les enregistrements NS ne peuvent pas être ajoutés. Utilisez <b>Mettre à jour les DNS</b> pour changer les serveurs de noms.',
 noSupportSession: 'Aucune session de support active.',
 noPendingLeads: '📝 Aucune demande de leads en attente.',
 invalidAmountPositive: '⚠️ Le montant doit être un nombre positif.',

 // ── Marketplace ──
 mpHome: '🏪 <b>MARCHÉ NOMADLY</b>\n\n💰 <b>Vendez vos produits numériques</b> — publiez en 60 secondes, soyez payé instantanément\n🛍️ <b>Trouvez des offres exclusives</b> — vendeurs vérifiés, transactions réelles\n\n🔒 <b>ESCROW OBLIGATOIRE</b> pour tout achat via @Lockbaybot\n⚠️ Ne payez JAMAIS le vendeur directement ou via son bot — utilisez UNIQUEMENT l\'escrow.\n\n👇 Prêt à gagner ou acheter ?',
 mpBrowse: '🔥 Parcourir les offres',
 mpListProduct: '💰 Commencer à vendre',
 mpMyConversations: '💬 Mes conversations',
 mpMyListings: '📦 Mes annonces',
 mpAiHelper: '🤖 Aide IA',
 mpAiHelperPrompt: '🤖 <b>Assistant IA du Marché</b>\n\nPosez-moi toute question sur l\'achat, la vente, l\'escrow ou la sécurité.\n\nÉcrivez votre question ci-dessous ou appuyez sur ↩️ Retour.',
 mpAiThinking: '🤖 Réflexion en cours...',
 mpAiScamWarning: '🚨 <b>Alerte Sécurité IA</b>\n\n⚠️ Ce message peut contenir une demande de paiement suspecte. Rappel :\n\n🔒 <b>TOUJOURS utiliser l\'escrow @Lockbaybot</b>\n❌ NE JAMAIS envoyer d\'argent via PayPal, CashApp, crypto ou virement\n📢 Tapez /report si vous vous sentez en danger\n\nVotre protection est notre priorité.',
 mpUploadImages: '📸 Téléchargez les images du produit (1 à 5 photos).\nEnvoyez les photos une par une. Appuyez sur ✅ Téléchargement terminé quand c\'est fait.',
 mpDoneUpload: '✅ Téléchargement terminé',
 mpEnterTitle: '📝 Entrez le titre du produit (max 100 caractères) :',
 mpEnterDesc: '📄 Entrez la description (max 500 caractères) :',
 mpEnterPrice: '💰 Fixez le prix en USD (20 $ - 5 000 $) :',
 mpSelectCategory: '🏷️ Sélectionnez une catégorie :',
 mpPreview: (title, desc, price, category, imageCount) =>
 `✅ <b>Aperçu du produit</b>\n\n📦 <b>${title}</b>\n📄 ${desc}\n💰 <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n📸 ${imageCount} image(s)\n\n🔒 Protégé par escrow via @Lockbaybot`,
 mpPublish: '✅ Publier',
 mpCancel: '❌ Annuler',
 mpEditProduct: '✏️ Modifier',
 mpRemoveProduct: '❌ Supprimer l\'annonce',
 mpMarkSold: '✅ Marquer comme vendu',
 mpProductPublished: '🎉 Votre annonce est EN LIGNE !\n\nLes acheteurs peuvent maintenant la découvrir.\n\n⚠️ <b>Rappel :</b> Toutes les ventes doivent passer par l\'escrow @Lockbaybot.\n\n💡 <b>Conseils pour vendre plus vite :</b>\n• Répondez rapidement aux demandes\n• Ajoutez des photos claires et descriptions détaillées\n• Fixez un prix compétitif',
 mpProductRemoved: '✅ Annonce supprimée.',
 mpProductSold: '✅ Annonce marquée comme vendue.',
 mpMaxListings: '❌ Vous avez atteint le maximum de 10 annonces actives. Supprimez-en ou marquez-en comme vendues.',
 mpPriceError: '❌ Le prix doit être entre 20 $ et 5 000 $ USD.',
 mpNoImage: '📸 Veuillez télécharger au moins une image.',
 mpImageAsPhoto: '📸 Envoyez l\'image comme photo, pas comme fichier.',
 mpOwnProduct: '❌ Vous ne pouvez pas contacter votre propre annonce.',
 mpNoProducts: '📭 Aucun produit trouvé. Revenez plus tard !',
 mpNoListings: '📭 Vous n\'avez pas encore d\'annonces.',
 mpNoConversations: '📭 Aucune conversation active.',
 mpChatStartBuyer: (title, price) =>
 `💬 Vous discutez avec le vendeur de <b>${title}</b> ($${price})\n\n⚠️ <b>ESCROW OBLIGATOIRE</b> — tapez /escrow pour payer via @Lockbaybot\n❌ Ne payez JAMAIS le vendeur directement ou via son bot.\n\n💡 Demandez des détails ou preuves avant d'acheter.\nEnvoyez /done pour quitter.`,
 mpChatStartSeller: (title) =>
 `💬 🔔 Un acheteur s'intéresse à <b>${title}</b> !\n🔒 Protégé par escrow via @Lockbaybot\n\n💡 Conseil : Répondez vite — les vendeurs rapides concluent plus de ventes.\nRépondez ci-dessous. Envoyez /done pour quitter.`,
 mpMessageSent: '✅ Message envoyé',
 mpSellerChatReady: (title) =>
 `💬 Vous êtes en chat pour <b>${title}</b>.\nÉcrivez votre réponse. Envoyez /done pour quitter, /escrow pour démarrer l'escrow, /price XX pour proposer un prix.`,
 mpBuyerSays: (msg) => `💬 <b>Acheteur :</b> ${msg}`,
 mpSellerSays: (msg) => `💬 <b>Vendeur :</b> ${msg}`,
 mpChatEnded: '💬 Conversation terminée. Les deux parties ont été notifiées.',
 mpChatEndedNotify: (title) => `💬 La conversation sur <b>${title}</b> a été fermée.`,
 mpChatInactive: (title) => `💬 La conversation sur <b>${title}</b> a été fermée pour inactivité.`,
 mpSellerOffline: '⏳ Le vendeur n\'a pas répondu depuis 24 heures.',
 mpRateLimit: '⚠️ Limite de messages atteinte. Veuillez patienter.',
 mpOnlyTextPhoto: '⚠️ Seuls le texte et les photos sont autorisés.',
 mpPaymentWarning: '🚨 <b>ATTENTION : Paiement direct détecté !</b>\n\n❌ N\'envoyez JAMAIS d\'argent au vendeur directement ou via son bot.\n🔒 L\'escrow via @Lockbaybot est <b>OBLIGATOIRE</b>.\n📢 Tapez /report si vous êtes en danger.',
 mpEscrowMsg: (title, price, sellerRef) =>
 `🔒 <b>ESCROW — ACHAT OBLIGATOIRE</b>\n\n📦 Produit : <b>${title}</b>\n💰 Prix : <b>$${Number(price).toFixed(2)}</b>\n👤 Vendeur : <b>${sellerRef}</b>\n\n1. Ouvrez @Lockbaybot\n2. Créez un escrow avec <b>${sellerRef}</b> pour <b>$${Number(price).toFixed(2)}</b>\n3. Les deux parties confirment\n\n⚠️ Ne payez JAMAIS en dehors de l\'escrow ou via le bot du vendeur`,
 mpPriceSuggest: (role, amount) => `💰 <b>${role}</b> propose : <b>$${amount}</b>`,
 mpPriceUsage: 'Usage : /price 50 pour proposer 50 $',
 mpPriceInvalid: '❌ Montant invalide. Doit être entre 20 $ et 5 000 $.',
 mpReported: '✅ Signalement envoyé. L\'admin examinera cette conversation.',
 mpChatMode: '⚠️ Vous êtes dans un chat marketplace. Envoyez /done pour quitter.',
 mpExistingConv: '💬 Vous avez déjà une conversation active. Reprise...',
 mpAllCategories: '📋 Toutes les catégories',
 mpEditWhat: '✏️ Que souhaitez-vous modifier ?',
 mpEditTitle: '📝 Modifier le titre',
 mpEditDesc: '📄 Modifier la description',
 mpEditPrice: '💰 Modifier le prix',
 mpTitleUpdated: '✅ Titre mis à jour.',
 mpDescUpdated: '✅ Description mise à jour.',
 mpPriceUpdated: '✅ Prix mis à jour.',
 mpListingRemoved: '📦 [Annonce supprimée]',
 mpSellerStats: (sales, since) => `⭐ Vendeur : ${sales} vente${sales !== 1 ? 's' : ''} | Inscrit ${since}`,
 mpProductCard: (title, price, category, sellerStats) =>
 `🏷️ <b>${title}</b>\n💰 <b>$${Number(price).toFixed(2)}</b> · ${category}\n${sellerStats}\n🔒 ⚠️ Escrow obligatoire — payez via @Lockbaybot uniquement`,
 mpProductDetail: (title, desc, price, category, sellerStats, listedAgo) =>
 `📦 <b>${title}</b>\n\n📄 ${desc}\n\n💰 Prix : <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n${sellerStats}\n📅 Publié : ${listedAgo}\n\n🔒 <b>ESCROW OBLIGATOIRE</b>\nPayez UNIQUEMENT via @Lockbaybot. Ne payez jamais le vendeur directement ou via son bot.`,
 mpMyListingsHeader: (count, max) => `📦 <b>MES ANNONCES</b> (${count}/${max})`,
 mpConvHeader: '💬 <b>MES CONVERSATIONS</b>',
 mpConvItem: (title, role, lastMsg) => `💬 <b>${title}</b> (${role}) — ${lastMsg}`,
 mpDoneCmd: '/done',
 mpEscrowCmd: '/escrow',
 mpPriceCmd: '/price',
 mpReportCmd: '/report',
 mpEnteredChat: (title, price) => `💬 Vous êtes dans le chat pour <b>${title}</b> (${price} $)\nEnvoyez /done pour quitter, /escrow pour démarrer l'escrow, /price XX pour proposer un prix.`,
 mpResumedChat: (title, price, role) => `💬 Chat repris : <b>${title}</b> (${price} $) — Vous êtes ${role}\n⚠️ <b>ESCROW OBLIGATOIRE</b> — payez uniquement via @Lockbaybot. Ne payez jamais le vendeur directement ou via son bot.\n\nEnvoyez /done pour quitter, /escrow pour démarrer l'escrow, /price XX pour proposer un prix.`,
 mpBuyerPhotoCaption: '💬 L\'acheteur a envoyé une photo :',
 mpSellerPhotoCaption: '💬 Le vendeur a envoyé une photo :',
 mpChatClosedReset: (title) => `💬 La conversation sur <b>${title}</b> a été fermée par l'autre partie. Vous avez été redirigé vers le marché.`,
 mpSellerBusy: (title) => `🆕 Nouvelle demande pour <b>${title}</b> ! Appuyez sur le bouton ci-dessous pour répondre quand vous êtes prêt.`,
 mpCatDigitalGoods: '💻 Produits Numériques',
 mpCatBnkLogs: '🏦 Logs Bancaires',
 mpCatBnkOpening: '🏧 Ouverture Bancaire',
 mpCatTools: '🔧 Outils',
 adm_1: '📸 Maximum 5 images. Tap ✅ Done Uploading to continue.',
 adm_10: (orderId, buyerName, chatId, product) => `✅ Order <code>${orderId}</code> delivered to ${buyerName} (${chatId}).\nProduct: ${product}`,
 adm_11: (message) => `❌ Error delivering order: ${message}`,
 adm_12: (TG_CHANNEL) => `👆 <b>Ad Preview</b>\n\nType <b>/ad post</b> to send this to ${TG_CHANNEL}`,
 adm_13: (totalDead, chatNotFound, userDeactivated, botBlocked, other) => `📊 <b>Dead Users Report</b>\n\nTotal marked dead: <b>${totalDead}</b>\n• chat_not_found: ${chatNotFound}\n• user_deactivated: ${userDeactivated}\n• bot_blocked: ${botBlocked}\n• other: ${other}\n\nCommands:\n<code>/resetdead all</code> — Clear ALL dead entries\n<code>/resetdead blocked</code> — Clear only bot_blocked\n<code>/resetdead notfound</code> — Clear only chat_not_found`,
 adm_14: '❌ Usage: /resetdead all | blocked | notfound',
 adm_15: (modifiedCount, sub) => `✅ Reset <b>${modifiedCount}</b> dead user entries (${sub}).`,
 adm_16: '🔄 Running win-back campaign scan...',
 adm_17: (sent, errors) => `✅ Win-back complete: ${sent} sent, ${errors} errors`,
 adm_18: '✅ Ad posted to channel!',
 adm_19: '❌ Channel ID not configured.',
 adm_2: (length) => `📸 Image ${length}/5 received. Send more or tap ✅ Done Uploading.`,
 adm_20: '📦 No pending digital product orders.',
 adm_21: (message) => `❌ Error: ${message}`,
 adm_22: (message) => `Error fetching requests: ${message}`,
 adm_23: '⚠️ Usage: /credit <@username or chatId> <amount>\\n\\nExamples:\\n<code>/credit @john 50</code>\\n<code>/credit 5590563715 25.50</code>',
 adm_24: '⚠️ Amount must be a positive number.',
 adm_25: (userRef) => `⚠️ User <b>${userRef}</b> not found.`,
 adm_26: (toFixed, targetName, targetChatId, v3) => `✅ Credited <b>$${toFixed} USD</b> to <b>${targetName}</b> (${targetChatId})\n\n💳 Their balance: $${v3} USD`,
 adm_27: (message) => `❌ Error crediting wallet: ${message}`,
 adm_28: (WELCOME_BONUS_USD) => `🎁 Starting gift of $${WELCOME_BONUS_USD} to all users who haven't received it yet...\nThis may take a while.`,
 adm_29: (gifted, skipped, failed, total) => `✅ <b>Gift Complete!</b>\n\n🎁 Gifted: ${gifted}\n⏭ Skipped (already had): ${skipped}\n❌ Failed: ${failed}\n📊 Total users: ${total}`,
 adm_3: '⚠️ Usage: /reply <chatId> <message>',
 adm_30: (message) => `❌ Gift failed: ${message}`,
 adm_31: '⚠️ Usage: /bal <@username or chatId>\\n\\nExamples:\\n<code>/bal @john</code>\\n<code>/bal 7193881404</code>',
 adm_32: (userRef) => `⚠️ User <b>${userRef}</b> not found.`,
 adm_33: (message) => `❌ Error checking balance: ${message}`,
 adm_34: '⚠️ Usage: /mpban <@username or chatId> [reason]\\n\\nExamples:\\n<code>/mpban @john spamming</code>\\n<code>/mpban 8317455811 policy violation</code>',
 adm_35: (userRef) => `⚠️ User <b>${userRef}</b> not found.`,
 adm_36: (targetName, targetChatId, listingsRemoved, reason) => `🚫 <b>Marketplace Ban Applied</b>\n\n👤 User: <b>${targetName}</b> (${targetChatId})\n📦 Listings removed: <b>${listingsRemoved}</b>\n📝 Reason: <i>${reason}</i>\n\nUser can no longer access or post in marketplace.`,
 adm_37: (message) => `❌ Error: ${message}`,
 adm_38: '⚠️ Usage: /mpunban <@username or chatId>\\n\\nExamples:\\n<code>/mpunban @john</code>\\n<code>/mpunban 8317455811</code>',
 adm_39: (userRef) => `⚠️ User <b>${userRef}</b> not found.`,
 adm_4: (targetName) => `✅ Reply sent to ${targetName}`,
 adm_40: (targetName, targetChatId) => `✅ <b>Marketplace Ban Removed</b>\n\n👤 User: <b>${targetName}</b> (${targetChatId})\n\nUser can now access marketplace again.`,
 adm_41: (targetName) => `ℹ️ User <b>${targetName}</b> was not banned from marketplace.`,
 adm_42: (message) => `❌ Error: ${message}`,
 // === Nested Template Keys ===
 cp_nested_1: (count, numberList) => `📞 <b>Lot : ${count} numéros</b>\n${numberList}\n\nChoisissez une catégorie de modèle IVR :`,
 cp_nested_2: (icon, firstPh, desc, hint) => `\n${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_3: (icon, firstPh, desc, hint) => `${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_4: (currentPh, value, icon, nextPh, desc, hint) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_5: (target, msg) => `❌ L'appel groupé vers ${target} a échoué : ${msg}`,
 cp_nested_6: (refundAmt, walletLine) => `💰 <b>${refundAmt}</b> ont été remboursés sur votre portefeuille.\n${walletLine}`,
 cp_nested_7: (cleanedMsg, balMsg) => `🔄 <b>Nouveau départ !</b>\n\n${cleanedMsg}${balMsg}\n\nVous pouvez maintenant relancer un achat de numéro depuis le début.`,
 cp_nested_8: (msg) => `❌ Erreur de reconquête : ${msg}`,
 cp_nested_9: (target, city, detailsLine) => `✅ <b>Demande envoyée !</b>\n\n🎯 Cible : <b>${target}</b>\n🏙️ Zone : <b>${city}</b>${detailsLine}\n\nNotre équipe examinera votre demande et vous préviendra dès que ces leads seront disponibles. Merci !`,
 cp_nested_hint_default: (ph) => `Entrez une valeur pour [${ph}]`,
 cp_nested_cleared: (count, refunded) => `✅ ${count} vérification(s) rejetée(s) effacée(s)\n💰 $${refunded} remboursé\n`,
 // === Voice Service ===
 vs_callDisconnectedWallet: (rate, connFee) => `🚫 <b>Appel déconnecté</b> — Solde insuffisant (besoin de $\${rate}/min + $\${connFee} connexion). Rechargez via 👛 Portefeuille.`,
 vs_callDisconnectedExhausted: '🚫 <b>Appel déconnecté</b> — Solde épuisé.\nRechargez via 👛 Portefeuille.',
 vs_outboundCallFailed: (from, to, reason) => `🚫 <b>Appel sortant échoué</b>\n📞 \${from} → \${to}\nRaison : \${reason}`,
 vs_planMinutesExhausted: (phone, used, limit, overage) => `⚠️ <b>Minutes du forfait épuisées</b>\n\n📞 \${phone}\nUtilisées : <b>\${used}/\${limit}</b> min\n\${overage}`,
 vs_planSmsExhausted: (phone, used, limit) => `⚠️ <b>SMS du forfait épuisés</b>\n\n📞 \${phone}\nUtilisés : <b>\${used}/\${limit}</b> SMS entrants`,
 vs_orphanedNumber: (to, from) => `⚠️ <b>Alerte numéro orphelin</b>\n\n📞 <code>\${to}</code> a reçu un appel de <code>\${from}</code>\n\n❌ Aucun propriétaire trouvé — appel rejeté.`,
 vs_incomingCallBlocked: (to, from) => `🚫 <b>Appel entrant bloqué — Solde vide</b>\n\n📞 \${to}\n👤 Appelant : \${from}`,
 vs_overageActive: (charged, rateInfo) => `💰 <b>Hors forfait actif</b> — Minutes épuisées. \${charged} (\${rateInfo})`,
 vs_callEndedExhausted: (elapsed) => `🚫 <b>Appel terminé</b> — Minutes + solde épuisés.\n⏱️ ~\${elapsed} min. Rechargez ou améliorez votre forfait.`,
 vs_outboundCallBlocked: (from, to, reason) => `🚫 <b>Appel sortant bloqué</b>\n📞 \${from} → \${to}\nRaison : \${reason}`,
 vs_sipCallBlocked: (rate, connFee) => `🚫 <b>Appel SIP bloqué</b> — Solde insuffisant (besoin de $\${rate}/min + $\${connFee} connexion). Rechargez via 👛 Portefeuille.`,
 vs_freeSipTestCall: (from, to) => `📞 <b>Appel test SIP gratuit</b>\nDe : \${from}\nVers : \${to}`,
 vs_sipOutboundCall: (from, to, planLine) => `📞 <b>Appel SIP sortant</b>\nDe : \${from}\nVers : \${to}\n\${planLine}`,
 vs_lowBalance: (bal, estMin) => `⚠️ <b>Solde faible</b> — $\${bal} (~\${estMin} min transfert). Rechargez <b>$25</b> via 👛 Portefeuille.`,
 vs_forwardingBlocked: (bal, rate) => `🚫 <b>Transfert bloqué</b> — Solde $\${bal} (besoin de $\${rate}/min). Rechargez via 👛 Portefeuille.`,
 vs_ivrForwardBlocked: (phone, forwardTo, bal) => `🚫 <b>Transfert SVI bloqué — Solde vide</b>\n\n📞 \${phone}\n📲 Vers : \${forwardTo}\n💰 Solde : $\${bal}`,
 vs_lowBalanceIvr: (bal, estMin) => `⚠️ <b>Solde faible</b> — $\${bal} (~\${estMin} min SVI). Rechargez via 👛 Portefeuille.`,
 vs_callForwarded: (to, forwardTo, from, duration, planLine, time) => `📞 <b>Appel transféré</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 \${from}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_forwardFailed: (to, forwardTo, from, time) => `📞 <b>Transfert — Pas de réponse</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 Appelant : \${from}\n📲 \${forwardTo} n'a pas répondu\n🕐 \${time}`,
 vs_sipCallFailed: (from, to, time) => `❌ <b>Appel SIP échoué — Transfert sans réponse</b>\n\n📞 De : \${from}\n📲 Vers : \${to}\n🕐 \${time}`,
 vs_sipCallEnded: (from, to, duration, planLine, time) => `📞 <b>Appel SIP terminé</b>\n\n📞 De : \${from}\n📲 Vers : \${to}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_freeTestCallEnded: (from, to, duration, time) => `📞 <b>Appel test gratuit terminé</b>\n\n📞 De : \${from}\n📲 Vers : \${to}\n⏱️ \${duration}\n🕐 \${time}`,
 vs_missedCall: (to, from, time) => `📞 <b>Appel manqué</b>\n\n📞 Vers : \${to}\n👤 De : \${from}\n🕐 \${time}`,
 vs_ivrCallRouted: (to, from, digit, forwardTo, time) => `📞 <b>Appel SVI routé</b>\n\n📞 Vers : \${to}\n👤 De : \${from}\nTouche : <b>\${digit}</b> → Transféré vers \${forwardTo}\n🕐 \${time}`,
 vs_ivrCall: (to, from, digit, time) => `📞 <b>Appel SVI</b>\n\n📞 Vers : \${to}\n👤 De : \${from}\nTouche : <b>\${digit}</b> → Message joué\n🕐 \${time}`,
 vs_newVoicemail: (to, from, duration, time) => `🎙️ <b>Nouveau message vocal</b>\n\n📞 Vers : \${to}\n👤 De : \${from}\n⏱️ Durée : \${duration}\n🕐 \${time}`,
 vs_callRecording: (to, from, duration, time) => `🔴 <b>Enregistrement d'appel</b>\n\n📞 Vers : \${to}\n👤 De : \${from}\n⏱️ Durée : \${duration}\n🕐 \${time}`,
 vs_listen: 'Écouter',
 adm_error_prefix: '❌ Error: ',
 dom_confirm_prompt: 'Confirmer ?',
 adm_5: '⚠️ Usage: /close <chatId>',
 adm_6: (targetName) => `✅ Closed support session for ${targetName}`,
 adm_7: '⚠️ Usage: /deliver <orderId> <product details/credentials>',
 adm_8: (orderId) => `⚠️ Order <code>${orderId}</code> not found.`,
 adm_9: (orderId) => `⚠️ Order <code>${orderId}</code> was already delivered.`,
 cp_1: '⚠️ Dépôts en NGN temporairement indisponibles (service de taux de change hors ligne). Veuillez essayer la crypto.',
 cp_10: (TRIAL_CALLER_ID) => `📢 <b>Appel IVR rapide — Essai gratuit</b>\n\n🎁 Vous avez droit à <b>1 appel d'essai gratuit !</b>\n📱 ID appelant : <b>${TRIAL_CALLER_ID}</b> (partagé)\n\nAppelez un seul numéro avec un message IVR automatisé.\n\nEntrez le numéro à appeler (avec l'indicatif pays) :\n<i>Exemple : +12025551234</i>`,
 cp_100: '🎚 <b>Choisissez la vitesse de parole</b> :',
 cp_101: '❌ Vitesse invalide. Entrez un nombre entre <b>0.25</b> et <b>4.0</b> :\n<i>Exemple : 0.8 ou 1.3</i>',
 cp_102: 'Veuillez choisir une vitesse parmi les boutons :',
 cp_103: (voiceName, speedLabelDisplay) => `🎤 Voix : <b>${voiceName}</b> | 🎚 Vitesse : <b>${speedLabelDisplay}</b>\n\n⏳ Génération de l'aperçu audio...`,
 cp_104: (message) => `❌ Échec de la génération audio.\n\n💡 <b>Astuce :</b> essayez <b>ElevenLabs</b> comme fournisseur de voix — il est généralement plus fiable.\n\n<i>Erreur : ${message}</i>`,
 cp_105: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_106: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_107: '🎚 <b>Choisissez la vitesse de parole</b>\n\nÀ quelle vitesse la voix doit-elle parler ?',
 cp_108: (holdMusic, v1) => `🎵 Musique d'attente : <b>${holdMusic}</b>\n${v1}`,
 cp_109: 'Que souhaitez-vous faire ?',
 cp_11: (buyLabel) => `📞 <b>Campagne IVR en masse</b>\n\n🔒 Cette fonctionnalité nécessite le forfait <b>Pro</b> ou supérieur.\n\nObtenez d'abord un numéro Cloud IVR !\n\nAppuyez sur <b>${buyLabel}</b> pour commencer.`,
 cp_110: 'Audio pas encore prêt. Appuyez plutôt sur ✅ Confirmer.',
 cp_111: '⏭ <b>Aperçu ignoré — Prêt à appeler !</b>',
 cp_112: 'Appuyez sur <b>✅ Confirmer</b> pour continuer, <b>🎤 Changer de voix</b>, ou <b>Retour</b>.',
 cp_113: 'Que souhaitez-vous faire ?',
 cp_114: '🕐 <b>Programmer l\'appel</b>\n\nDans combien de minutes l\'appel doit-il partir ?\n\n<i>Exemples : 5, 15, 30, 60</i>',
 cp_115: 'Veuillez entrer une valeur entre 1 et 1440 minutes.',
 cp_116: (targetNumber, minutes, toLocaleTimeString) => `✅ <b>Appel programmé !</b>\n\n📞 Vers : ${targetNumber}\n🕐 Dans : ${minutes} minutes (${toLocaleTimeString} UTC)\n\nVous serez notifié lorsque l'appel sera passé.`,
 cp_117: (toFixed, v1) => `⚠️ <b>Solde du portefeuille insuffisant</b>\n\nLes appels IVR rapides nécessitent un solde minimum de <b>$${toFixed}</b>.\n\nVotre solde : <b>$${v1}</b>\n\nVeuillez recharger votre portefeuille et réessayer.`,
 cp_118: '🚫 <b>Appel bloqué</b>\n\nVotre numéro de téléphone ne possède pas d\'identifiants de sous-compte. Veuillez contacter le support.',
 cp_119: (batchCount, length, target) => `📞 Lot ${batchCount}/${length} : appel de ${target}...`,
 cp_12: '📞 <b>Campagne IVR en masse</b>\n\nAppelez plusieurs numéros avec un message IVR automatisé.\nImportez un CSV de leads et lancez une campagne.\n\n☎️ = numéros compatibles IVR en masse\n\n📱 Sélectionnez l\'ID appelant :',
 cp_120: 'Voulez-vous enregistrer ceci comme préréglage Appel rapide pour la prochaine fois ?',
 cp_121: 'Appuyez sur <b>/yes</b> pour lancer l\'appel ou <b>/cancel</b> pour annuler.',
 cp_122: (presetName) => `✅ Préréglage « <b>${presetName}</b> » enregistré !\n\nLa prochaine fois, sélectionnez-le dans le menu IVR rapide pour sauter la configuration.`,
 cp_123: '🎵 <b>Bibliothèque audio</b>\n\nAucun fichier audio. Importez-en un pour commencer.',
 cp_124: (audioList) => `🎵 <b>Bibliothèque audio</b>\n\n${audioList}`,
 cp_125: 'Sélectionnez une option :',
 cp_126: (audioList) => `🎵 <b>Bibliothèque audio</b>\n\n${audioList}`,
 cp_127: '⏳ Téléchargement et enregistrement de l\'audio...',
 cp_128: 'Veuillez envoyer un fichier audio (MP3, WAV, OGG) ou un message vocal.',
 cp_129: 'Envoyez-moi un fichier audio ou un message vocal :',
 cp_13: '🎵 <b>Bibliothèque audio</b>\n\nVous n\'avez aucun fichier audio enregistré.\n\nImportez un fichier audio (MP3, WAV, OGG) à utiliser dans vos campagnes IVR.',
 cp_130: (name) => `✅ Audio enregistré sous : <b>${name}</b>\n\nVous pouvez maintenant l'utiliser dans vos campagnes IVR en masse !`,
 cp_131: 'Veuillez sélectionner un ID appelant dans la liste.',
 cp_132: (phoneNumber) => `📱 ID appelant : <b>${phoneNumber}</b>\n\n📋 <b>Importer le fichier de leads</b>\n\nEnvoyez un fichier texte (.txt ou .csv) avec un numéro par ligne.\nFacultatif : <code>numéro,nom</code> par ligne.\n\nOu collez directement les numéros (un par ligne) :`,
 cp_133: 'Sélectionnez l\'ID appelant :',
 cp_134: (message) => `❌ Lecture du fichier impossible : ${message}\n\nRéessayez ou collez les numéros directement.`,
 cp_134b: (fname) => `❌ <b>${fname}</b> n'est pas un fichier texte.\n\nVeuillez envoyer un fichier <b>.txt</b> ou <b>.csv</b> (un numéro par ligne, ou numéro,nom), ou collez les numéros directement.`,
 cp_135: 'Veuillez envoyer un fichier ou coller des numéros de téléphone.',
 cp_136: (errMsg) => `❌ Aucun numéro de téléphone valide trouvé.${errMsg}\n\nVérifiez le format : un numéro par ligne, avec l'indicatif pays (+).`,
 cp_137: (maxLeads, length) => `❌ <b>Trop de leads !</b>\n\nMaximum <b>${maxLeads}</b> numéros par campagne.\nVous en avez importé <b>${length}</b>.\n\nVeuillez réduire votre liste et réessayer.`,
 cp_138: (length, preview, more, errNote, estCost, toFixed) => `✅ <b>${length} leads chargés !</b>\n\n${preview}${more}${errNote}\n\n💰 <b>Coût estimé : $${estCost}</b> ($${toFixed}/min par numéro, min 1 min chacun — facturé que l'appel soit décroché ou non)\n\n🎵 <b>Choisissez l'audio IVR</b>\n\nChoisissez dans votre bibliothèque audio, importez un nouvel enregistrement, ou générez-le à partir d'un modèle avec TTS :`,
 cp_139: '📋 Envoyez un fichier de leads ou collez des numéros :',
 cp_14: (audioList) => `🎵 <b>Bibliothèque audio</b>\n\n${audioList}\n\nImportez un nouvel audio ou supprimez-en un existant :`,
 cp_140: '🎵 Envoyez un fichier audio (MP3, WAV, OGG) ou un message vocal :',
 cp_141: '📝 <b>Générer l\'audio à partir d\'un modèle</b>\n\nChoisissez une catégorie de modèle, ou rédigez votre propre script :',
 cp_142: 'Audio introuvable. Sélectionnez dans la liste.',
 cp_143: (name) => `🎵 Audio : <b>${name}</b>\n\n📋 <b>Choisissez le mode de campagne</b>\n\n🔗 <b>Transfert + Rapport</b> — Quand le lead appuie sur une touche, l'appel est basculé vers votre téléphone + rapport systématique\n📊 <b>Rapport seul</b> — Suivi des touches pressées uniquement, sans transfert + rapport systématique\n\nLes deux modes fournissent un rapport complet (qui a appuyé, qui a raccroché, etc.)`,
 cp_144: 'Sélectionnez un fichier audio :',
 cp_145: 'Choisissez l\'audio IVR :',
 cp_146: '⏳ Enregistrement de l\'audio...',
 cp_147: (message) => `❌ Échec de l'import : ${message}`,
 cp_148: 'Envoyez un fichier audio ou un message vocal :',
 cp_149: (name) => `✅ Enregistré sous : <b>${name}</b>\n\n📋 <b>Choisissez le mode de campagne</b>\n\n🔗 <b>Transfert + Rapport</b> — Appuyer sur 1 bascule l'appel vers votre téléphone\n📊 <b>Rapport seul</b> — Suivi des réponses uniquement\n\nLes deux modes fournissent toujours un rapport complet.`,
 cp_15: '📞 <b>Nouvel appel IVR</b>\n\n📞 <b>Étape 1/2 :</b> appuyez sur celui de <b>vos</b> numéros qui doit apparaître comme <i>ID appelant</i> :',
 cp_150: 'Choisissez l\'audio IVR :',
 cp_151: '🔗 <b>Mode transfert</b>\n\nEntrez le numéro vers lequel transférer les appels quand le lead appuie sur la touche active :\n<i>(Votre numéro SIP ou tout autre numéro)</i>\n<i>Exemple : +41791234567</i>',
 cp_152: '📊 <b>Rapport seul</b> — pas de transfert, suivi uniquement.\n\n🔘 <b>Choisissez les touches actives</b>\n\nQuelles touches comptent comme réponse positive ?\n\nChoisissez un préréglage ou entrez des chiffres :',
 cp_153: 'Sélectionnez un mode :',
 cp_154: 'Choisissez le mode de campagne :',
 cp_155: 'Entrez un numéro de téléphone valide avec l\'indicatif pays (+).\n<i>Exemple : +41791234567</i>',
 cp_156: (clean) => `🔗 Transfert vers : <b>${clean}</b>\n\n🔘 <b>Choisissez les touches actives</b>\n\nQuelles touches déclenchent le transfert ?\n\nChoisissez un préréglage ou entrez des chiffres :`,
 cp_157: 'Entrez le numéro de transfert :',
 cp_158: 'Choisissez le mode de campagne :',
 cp_159: 'Entrez les chiffres qui comptent comme touches actives :\n<i>Exemple : 1,3,5 ou 1 2 3</i>',
 cp_16: 'Aucun préréglage à supprimer.',
 cp_160: 'Veuillez choisir un préréglage ou entrer des chiffres :',
 cp_161: (join) => `🔘 Touches actives : <b>${join}</b>\n\n⚡ <b>Appels simultanés</b>\n\nCombien d'appels en parallèle ? (1-20)\nPar défaut : <b>10</b>`,
 cp_162: '🔘 <b>Choisissez les touches actives</b>',
 cp_163: 'Entrez au moins un chiffre (0-9) :\n<i>Exemple : 1,3,5</i>',
 cp_164: (join) => `🔘 Touches actives : <b>${join}</b>\n\n⚡ <b>Appels simultanés</b>\n\nCombien d'appels en parallèle ? (1-20)\nPar défaut : <b>10</b>`,
 cp_165: 'Choisissez l\'audio IVR :',
 cp_166: '✍️ <b>Script personnalisé</b>\n\nTapez le message à prononcer.\nUtilisez « appuyez sur 1 », « appuyez sur 2 », etc. dans votre texte pour définir les touches actives.\n\n<i>Exemple : Bonjour, ceci est un rappel pour votre rendez-vous. Appuyez sur 1 pour confirmer ou sur 2 pour reprogrammer.</i>',
 cp_167: 'Veuillez sélectionner une catégorie :',
 cp_168: 'Sélectionnez un modèle :',
 cp_169: 'Choisissez une catégorie de modèle :',
 cp_17: '🗑️ <b>Supprimer un préréglage</b>\n\nSélectionnez le préréglage à supprimer :',
 cp_170: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_171: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_172: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_174: (placeholders) => `Entrez la valeur pour <b>[${placeholders}]</b> :`,
 cp_175: (join) => `🔘 Touches actives : <b>${join}</b>\n\n🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :`,
 cp_176: 'Choisissez une catégorie de modèle :',
 cp_177: 'Veuillez sélectionner un modèle parmi les boutons.',
 cp_178: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 Touches actives : <b>${join}</b>`,
 cp_179: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_18: (presetName) => `✅ Préréglage « ${presetName} » supprimé.`,
 cp_180: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_181: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_183: (placeholders) => `\nEntrez la valeur pour <b>[${placeholders}]</b> :`,
 cp_184: '🎙 <b>Choisissez la voix</b> :',
 cp_185: 'Choisissez une catégorie de modèle :',
 cp_186: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — régénéré : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_187: (currentPh) => `✍️ Tapez votre valeur personnalisée pour <b>[${currentPh}]</b> :`,
 cp_188: (currentPh) => `✍️ Tapez le numéro de rappel pour <b>[${currentPh}]</b> :\n<i>Exemple : +12025551234</i>`,
 cp_189: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_19: 'Préréglage introuvable.',
 cp_190: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_191: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_193: (currentPh, value, nextPh) => `✅ ${currentPh} : <b>${value}</b>\n\nEntrez la valeur pour <b>[${nextPh}]</b> :`,
 cp_194: '✅ Toutes les valeurs sont renseignées !\n\n🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_195: 'Choisissez une catégorie de modèle :',
 cp_196: 'Veuillez sélectionner un fournisseur de voix :',
 cp_197: '🎙 <b>Choisissez la voix</b> :',
 cp_198: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_199: 'Veuillez sélectionner une voix :',
 cp_2: (toLocaleString) => `⚠️ Le dépôt minimum est de ₦${toLocaleString} (≈ 10 $ USD). Veuillez entrer un montant plus élevé.`,
 cp_20: (presetName, currentPlan) => `🔒 <b>Le préréglage « ${presetName} » utilise la collecte OTP</b>, qui nécessite le forfait <b>Pro</b>.\n\nVotre forfait actuel : <b>${currentPlan}</b>\n\nPassez au niveau supérieur via 🔄 Renouveler / Changer de forfait, ou créez un nouvel appel en mode 🔗 Transfert.`,
 cp_200: (name) => `🎤 Voix : <b>${name}</b>\n\n🎚 <b>Choisissez la vitesse de parole</b>\n\nÀ quelle vitesse la voix doit-elle parler ?`,
 cp_201: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_202: '✍️ Entrez un multiplicateur de vitesse personnalisé :\n<i>Exemples : 0.6 (très lent), 0.9 (un peu lent), 1.2 (plus rapide), 1.5 (très rapide)\nPlage : 0.25 à 4.0</i>',
 cp_203: '🎚 <b>Choisissez la vitesse de parole</b> :',
 cp_204: '❌ Vitesse invalide. Entrez un nombre entre <b>0.25</b> et <b>4.0</b> :\n<i>Exemple : 0.8 ou 1.3</i>',
 cp_205: 'Veuillez choisir une vitesse parmi les boutons :',
 cp_206: (voiceName, speedLabel) => `🎤 Voix : <b>${voiceName}</b> | 🎚 Vitesse : <b>${speedLabel}</b>\n\n⏳ Génération de l'audio...`,
 cp_207: (message) => `❌ Échec de la génération audio.\n\n💡 <b>Astuce :</b> essayez <b>ElevenLabs</b> comme fournisseur de voix — il est généralement plus fiable.\n\n<i>Erreur : ${message}</i>`,
 cp_208: 'Choisissez une catégorie de modèle :',
 cp_209: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_21: (presetName, callerId, templateName, voiceName) => `💾 <b>Préréglage chargé : ${presetName}</b>\n📱 De : ${callerId}\n🏢 Modèle : ${templateName}\n🎙 Voix : ${voiceName}\n\nEntrez le numéro à appeler (ou plusieurs séparés par des virgules) :\n<i>Exemple : +12025551234</i>\n<i>Lot : +12025551234, +12025555678</i>`,
 cp_210: '🎚 <b>Choisissez la vitesse de parole</b>\n\nÀ quelle vitesse la voix doit-elle parler ?',
 cp_211: '❌ Aucun audio généré. Réessayez.',
 cp_212: (audioName, join) => `✅ Audio enregistré : <b>${audioName}</b>\n🔘 Touches actives (depuis le modèle) : <b>${join}</b>\n\n📋 <b>Choisissez le mode de campagne</b>\n\n🔗 <b>Transfert + Rapport</b> — Quand le lead appuie sur une touche, l'appel est basculé vers votre téléphone + rapport systématique\n📊 <b>Rapport seul</b> — Suivi des touches pressées uniquement, sans transfert + rapport systématique`,
 cp_213: 'Appuyez sur <b>✅ Utiliser cet audio</b> ou <b>🎤 Changer de voix</b>.',
 cp_214: '🔘 <b>Choisissez les touches actives</b>',
 cp_215: 'Entrez un nombre entre 1 et 20 :',
 cp_216: 'Définissez le nombre d\'appels simultanés (1-20) :',
 cp_217: '❌ Données de campagne manquantes. Veuillez recommencer.',
 cp_218: '⏳ Création de la campagne...',
 cp_219: (errorvoice) => `❌ Échec du démarrage : ${errorvoice}`,
 cp_22: 'Aucun ID appelant éligible trouvé.',
 cp_220: 'La campagne est en cours ! Vous verrez les mises à jour de progression ici.',
 cp_221: (messagevoice) => `❌ Échec du lancement de la campagne : ${messagevoice}`,
 cp_222: 'Appuyez sur 🚀 Lancer la campagne ou ↩️ Retour.',
 cp_223: 'Appuyez pour voir les options :',
 cp_224: 'Campagne en cours. Utilisez le bouton ci-dessous :',
 cp_225: '🛒 <b>Choisissez un forfait :</b>',
 cp_226: '🌍 <b>Tous les pays disponibles</b>\n\nSélectionnez un pays :',
 cp_227: (location, numberLines) => `📱 <b>Numéros disponibles — ${location}</b>\n\n${numberLines}\n\n☎️ = Compatible campagnes IVR en masse\n\nAppuyez sur un numéro pour le sélectionner :`,
 cp_228: (message, numberLines) => `📱 <b>Numéros disponibles — ${message}</b>\n\n${numberLines}\n\n☎️ = Compatible campagnes IVR en masse\n\nAppuyez sur un numéro pour le sélectionner :`,
 cp_229: (areaCode, numberLines) => `📱 <b>Numéros disponibles — Indicatif ${areaCode}</b>\n\n${numberLines}\n\n☎️ = Compatible campagnes IVR en masse\n\nAppuyez sur un numéro pour le sélectionner :`,
 cp_23: (phoneNumber, recentNumber) => `📱 De : <b>${phoneNumber}</b>\n📞 Vers : <b>${recentNumber}</b>\n\nChoisissez une catégorie de modèle IVR :`,
 cp_230: (location, numberLines) => `📱 <b>Plus de numéros — ${location}</b>\n\n${numberLines}\n\n☎️ = Compatible campagnes IVR en masse\n\nAppuyez sur un numéro pour le sélectionner :`,
 cp_231: 'Ce forfait n\'est pas encore disponible. Veuillez choisir parmi les forfaits disponibles ci-dessous.',
 cp_232: (planLabel) => `✅ Forfait : <b>${planLabel}</b>\n\n🌍 Sélectionnez un pays :`,
 cp_233: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 cp_234: (toLocaleString) => `SVI Cloud ₦${toLocaleString}`,
 cp_235: '⚠️ Session de mise à niveau expirée. Veuillez recommencer.',
 cp_236: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 cp_237: (toLocaleString) => `Mise à niveau du forfait ₦${toLocaleString}`,
 cp_238: '⚠️ Session de mise à niveau expirée. Veuillez recommencer.',
 cp_239: '⚠️ Aucune vérification refusée trouvée. Veuillez lancer un nouvel achat de numéro.',
 cp_24: '💡 Appuyez sur l\'un de vos numéros dans le clavier ci-dessous.\n\n<i>Ne tapez pas ici le numéro à appeler — ce sera l\'étape suivante. Choisissez d\'abord lequel de VOS numéros s\'affichera comme ID appelant.</i>',
 cp_240: '⚠️ Aucune vérification refusée trouvée.',
 cp_243: '⬇️ Veuillez choisir une option ci-dessous :',
 cp_244: '⚠️ Veuillez saisir au minimum : <code>Rue, Ville, Pays</code>\n\nExemple : <i>123 Main St, Sydney, Australia</i>',
 cp_245: (countryName, toFixed, showWallet) => `❌ Échec de la configuration réglementaire pour ${countryName}.\n\n💰 <b>$${toFixed}</b> remboursés.\n${showWallet}`,
 cp_246: (toFixed, showWallet) => `❌ Échec de la configuration réglementaire.\n\n💰 <b>$${toFixed}</b> remboursés.\n${showWallet}`,
 cp_247: (toFixed, showWallet) => `❌ Échec de la configuration réglementaire.\n\n💰 <b>$${toFixed}</b> remboursés.\n${showWallet}`,
 cp_248: (showWallet) => `❌ Échec de la configuration réglementaire.\n\n💰 Votre portefeuille a été remboursé.\n${showWallet}`,
 cp_249: '💡 <b>Tirez le meilleur de votre numéro</b>\n\n📲 <b>Configurez le renvoi d\'appel</b> — faites sonner votre vrai téléphone\n🤖 <b>Ajoutez un message d\'accueil IVR</b> — standard automatique professionnel\n💬 <b>Activez les SMS</b> — envoyez et recevez des textos\n\nAppuyez sur Gérer les numéros ci-dessous pour configurer.',
 cp_25: (phoneNumber) => `📞 <b>Appel depuis :</b> ${phoneNumber}\n\n📝 Entrez le numéro que vous souhaitez <b>appeler</b> :\n<i>Exemple : +12025551234</i>\n\n<i>📦 Pour appeler plusieurs numéros à la fois, séparez-les par des virgules — ex. +12025551234, +12025555678</i>`,
 cp_250: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 cp_251: (label, toLocaleString) => `${label} ₦${toLocaleString}`,
 cp_252: (numLines) => `📱 <b>Choisissez le forfait auquel ajouter un numéro :</b>\n\n${numLines}`,
 cp_253: (selectedNumber) => `✅ <b>Bonne nouvelle ! Votre dossier a été approuvé !</b>\n\n🔄 Nous activons votre numéro <code>${selectedNumber}</code> maintenant...`,
 cp_254: '⚠️ Impossible d\'actualiser le statut. Veuillez réessayer.',
 cp_255: '⚠️ Cette commande ne peut pas être annulée — elle est déjà en cours de traitement ou terminée.',
 cp_256: (selectedNumber, toFixed, showWallet) => `✅ <b>Commande annulée</b>\n\nVotre commande en attente pour <code>${selectedNumber}</code> a été annulée.\n\n💰 <b>$${toFixed}</b> ont été remboursés sur votre portefeuille.\n${showWallet}`,
 cp_257: '⚠️ Impossible d\'annuler la commande. Veuillez contacter le support.',
 cp_258: 'Veuillez choisir une option :',
 cp_259: '🌍 <b>Tous les pays disponibles</b>\n\nSélectionnez un pays :',
 cp_26: '📢 <b>Appel IVR rapide</b>\n\nAppelez un numéro avec un message IVR automatisé.\n\n📞 <b>Étape 1/2 :</b> appuyez sur celui de <b>vos</b> numéros qui doit apparaître comme <i>ID appelant</i> :',
 cp_260: (subNumbersAvailable, numberLines, bulkIvrSupport, tapToSelect) => `${subNumbersAvailable}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_261: (subNumberSelected, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberSelected}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_262: (subNumberArea, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberArea}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_263: (numberLines) => `📱 <b>Plus de numéros</b>\n\n${numberLines}\n\n☎️ = Compatible IVR en masse\n\nAppuyez pour sélectionner :`,
 cp_264: (newState, v1) => `🎵 Musique d'attente : <b>${newState}</b>\n${v1}`,
 cp_265: 'Entrez une URL valide commençant par http:// ou https://.',
 cp_266: '📝 Tapez le message d\'accueil que les appelants entendront :',
 cp_267: '🎙️ Envoyez un message vocal ou un fichier audio.',
 cp_268: '✅ Audio reçu. L\'enregistrer comme message d\'accueil ?',
 cp_269: '🎤 <b>Message d\'accueil personnalisé</b>\n\nChoisissez comment créer votre message :',
 cp_27: 'Veuillez entrer un numéro valide commençant par + et comportant 10 à 15 chiffres.\n<i>Exemple : +12025551234</i>\n\n<i>📦 Pour appeler plusieurs numéros à la fois, séparez-les par des virgules.</i>',
 cp_270: (message) => `📋 <b>${message}</b>\n\nSélectionnez un modèle de message d'accueil :`,
 cp_271: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ Vous pouvez modifier ce texte — tapez simplement votre version ci-dessous.\nOu appuyez sur <b>✅ Utiliser tel quel</b> pour continuer avec ce message.`,
 cp_272: '📋 <b>Modèles de message d\'accueil</b>\n\nSélectionnez une catégorie :',
 cp_273: '🌐 Sélectionnez la langue de votre message de répondeur :\n\n<i>Le modèle sera automatiquement traduit dans la langue choisie.</i>',
 cp_274: '✅ Texte mis à jour.\n\n🌐 Sélectionnez la langue de votre message de répondeur :\n\n<i>Le message sera automatiquement traduit dans la langue choisie.</i>',
 cp_275: '🎤 <b>Message d\'accueil personnalisé</b>\n\nChoisissez :',
 cp_276: '🔄 Génération de l\'aperçu audio...',
 cp_277: (voice) => `✅ Aperçu (${voice})\n\nEnregistrer ce message d'accueil ?`,
 cp_278: (message) => `❌ Échec de la génération audio : ${message}`,
 cp_279: (translatedText) => `🌐 <b>Message d'accueil traduit :</b>\n\n<i>${translatedText}</i>\n\n🎙️ Choisissez une voix :`,
 cp_280: '🎙️ Choisissez une voix :',
 cp_281: '🎙 Sélectionnez un fournisseur de voix :',
 cp_282: (message) => `🌐 Traduction en ${message}...`,
 cp_283: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_284: '🌐 Sélectionnez la langue de votre message d\'accueil :',
 cp_285: '📝 Tapez le texte du message d\'accueil :',
 cp_286: (message) => `🌐 Sélectionnez la langue de votre message d'accueil :\n\n<i>"${message}"</i>`,
 cp_287: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_288: '🌐 Sélectionnez la langue de votre message d\'accueil :',
 cp_289: '📝 Tapez le texte du message d\'accueil :',
 cp_29: '🔍 Recherche du numéro...',
 cp_290: '🎙️ Envoyez un message vocal ou un fichier audio.',
 cp_291: '✅ Audio reçu. Enregistrer ?',
 cp_292: '✅ Message de répondeur enregistré !',
 cp_293: '🎤 <b>Définir le message d\'accueil IVR</b>\n\nChoisissez comment créer votre message :',
 cp_294: (usedKeys) => `➕ <b>Ajouter une option de menu</b>\n\nTouches utilisées : ${usedKeys}\n\nEntrez le numéro de touche (0-9) pour cette option :`,
 cp_295: '📝 Tapez le message d\'accueil que les appelants entendront.\n\n<i>Exemple : « Merci d\'appeler Nomadly. Appuyez sur 1 pour les ventes, sur 2 pour le support. »</i>',
 cp_296: '🎙️ Envoyez un message vocal ou un fichier audio pour votre message d\'accueil IVR.',
 cp_297: '📋 <b>Modèles de message d\'accueil</b>\n\nModèles professionnels pour institutions financières — lignes anti-fraude, service client, hors horaires, et plus. Sélectionnez une catégorie :',
 cp_298: 'Choisissez une option :',
 cp_299: '🎤 <b>Définir le message d\'accueil IVR</b>\n\nChoisissez comment créer votre message :',
 cp_3: '🛡️🔥 L\'hébergement Anti-Red est actuellement indisponible. Appuyez sur <b>💬 Support</b> sur le clavier pour nous contacter.',
 cp_30: (titleCase) => `📋 Trouvé : <b>${titleCase}</b>`,
 cp_300: (message) => `📋 <b>${message}</b>\n\nSélectionnez un modèle de message d'accueil :`,
 cp_301: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ Vous pouvez modifier ce texte — tapez simplement votre version ci-dessous.\nOu appuyez sur <b>✅ Utiliser tel quel</b> pour continuer avec ce message.`,
 cp_302: '📋 <b>Modèles de message d\'accueil</b>\n\nSélectionnez une catégorie :',
 cp_303: '🌐 Sélectionnez la langue de votre message d\'accueil IVR :\n\n<i>Le modèle sera automatiquement traduit dans la langue choisie.</i>',
 cp_304: '✅ Texte mis à jour.\n\n🌐 Sélectionnez la langue de votre message d\'accueil IVR :\n\n<i>Le message sera automatiquement traduit dans la langue choisie.</i>',
 cp_305: '🎤 <b>Définir le message d\'accueil IVR</b>\n\nChoisissez comment créer votre message :',
 cp_306: '🔄 Génération de l\'aperçu audio...',
 cp_307: (voice) => `✅ Aperçu généré (${voice})\n\n✅ Enregistrer ce message ?\n🔄 Essayer une autre voix ?\n📝 Retaper le texte ?`,
 cp_308: (message) => `❌ Échec de la génération audio : ${message}\n\nRéessayez ou importez votre propre audio.`,
 cp_309: (translatedText) => `🌐 <b>Message d'accueil traduit :</b>\n\n<i>${translatedText}</i>\n\n🎙️ Choisissez une voix :`,
 cp_31: '⏳ Régénération de l\'audio du préréglage (l\'audio précédent a expiré)...',
 cp_310: '🎙️ Choisissez une voix pour votre message d\'accueil :',
 cp_311: '🎙 Sélectionnez un fournisseur de voix :',
 cp_312: (message) => `🌐 Traduction en ${message}...`,
 cp_313: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_314: '🌐 Sélectionnez la langue de votre message d\'accueil IVR :',
 cp_315: '📝 Tapez le message d\'accueil que les appelants entendront :',
 cp_316: (message) => `🌐 Sélectionnez la langue de votre message d'accueil IVR :\n\n<i>"${message}"</i>`,
 cp_317: '✅ Audio reçu. L\'enregistrer comme message d\'accueil IVR ?',
 cp_318: '❌ Échec du traitement de l\'audio. Réessayez.',
 cp_319: '🎙️ Envoyez un message vocal ou un fichier audio.',
 cp_32: '⚠️ Échec de la régénération audio. Veuillez configurer l\'appel manuellement.',
 cp_320: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_321: '🌐 Sélectionnez la langue de votre message d\'accueil IVR :',
 cp_322: '📝 Tapez le message d\'accueil que les appelants entendront :',
 cp_323: '🎙️ Envoyez un message vocal ou un fichier audio.',
 cp_324: '✅ Message d\'accueil IVR enregistré !',
 cp_325: '✅ Audio reçu. L\'enregistrer comme message d\'accueil IVR ?',
 cp_326: '❌ Échec du traitement de l\'audio. Réessayez.',
 cp_327: 'Choisissez une option :',
 cp_328: (key) => `Que doit-il se passer quand un appelant appuie sur <b>${key}</b> ?`,
 cp_329: (message) => `📋 <b>${message}</b>\n\nSélectionnez un modèle :`,
 cp_33: '⚠️ L\'audio du préréglage a expiré et ne peut pas être régénéré. Veuillez configurer l\'appel manuellement.',
 cp_330: '📋 Sélectionnez une catégorie :',
 cp_331: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ Tapez votre version modifiée, ou appuyez sur <b>✅ Utiliser tel quel</b> :`,
 cp_332: '🌐 Sélectionnez la langue :\n\n<i>Le message sera traduit automatiquement.</i>',
 cp_333: '🎙️ Envoyez un message vocal ou un fichier audio :',
 cp_334: (message) => `🌐 Sélectionnez la langue :\n\n<i>"${message}"</i>`,
 cp_335: (text) => `📋 <b>Message</b>\n\n<code>${text}</code>\n\n✏️ Tapez votre version modifiée, ou appuyez sur <b>✅ Utiliser tel quel</b> :`,
 cp_336: '🔄 Génération de l\'aperçu audio...',
 cp_337: (key, voice) => `✅ Aperçu pour la touche <b>${key}</b> (${voice})\n\nEnregistrer cette option ?`,
 cp_338: (message) => `❌ Échec de la génération audio : ${message}`,
 cp_339: (translatedText) => `🌐 <b>Traduction :</b>\n\n<i>${translatedText}</i>\n\n🎙️ Choisissez une voix :`,
 cp_34: '💾 <b>Préréglage chargé — Prêt à appeler !</b>\n\nAppuyez sur <b>/yes</b> pour appeler ou <b>/cancel</b> pour annuler.',
 cp_340: '🎙️ Choisissez une voix :',
 cp_341: '🎙 Sélectionnez un fournisseur de voix :',
 cp_342: (message) => `🌐 Traduction en ${message}...`,
 cp_343: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_344: '🌐 Sélectionnez la langue :',
 cp_345: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_346: '🌐 Sélectionnez la langue :',
 cp_347: '📝 Tapez le message :',
 cp_348: '🎙️ Envoyez un message vocal ou un fichier audio :',
 cp_35: (templateName, callerId, voiceName, join) => `💾 <b>Préréglage chargé : ${templateName}</b>\n📱 De : ${callerId}\n🎙 Voix : ${voiceName}\n🔘 Touches actives : <b>${join}</b>`,
 cp_36: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_37: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_38: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_4: (SUPPORT_USERNAME) => `📞 Cloud IVR arrive bientôt ! Contactez ${SUPPORT_USERNAME} pour en savoir plus.`,
 cp_40: (firstPh) => `\nEntrez la valeur pour <b>[${firstPh}]</b> :`,
 cp_41: '📋 <b>Choisissez le mode d\'appel</b>\n\n🔗 <b>Transfert</b> — Quand la cible appuie sur la touche, elle est mise en relation avec votre numéro\n🔑 <b>Collecte OTP</b> — Après la touche, la cible est invitée à saisir un code — qui vous est transmis via Telegram\n\nLes deux modes fournissent un rapport complet.',
 cp_42: 'Entrez le numéro à appeler (avec l\'indicatif pays) :\n<i>Exemple : +12025551234</i>',
 cp_43: '✍️ <b>Script personnalisé</b>\n\nTapez votre message IVR. Utilisez des <b>[Crochets]</b> pour les variables :\n\n<b>Standard :</b> [Name], [Company], [Bank], [Amount]\n<b>Intelligent (auto) :</b> [CardLast4], [CaseID], [ReferenceNum]\n<b>Intelligent (choix) :</b> [Reason], [Location], [CallBack]\n\n<i>Exemple : Bonjour [Name]. Ici la sécurité de [Bank]. Un débit de $[Amount] a été effectué sur la carte se terminant par [CardLast4]. Dossier [CaseID]. Appuyez sur 1 pour contester.</i>\n\nTapez votre script :',
 cp_44: 'Sélectionnez un modèle :',
 cp_45: 'Veuillez sélectionner une catégorie parmi les boutons.',
 cp_46: '✍️ <b>Script personnalisé</b>\n\nTapez votre message IVR. Utilisez des <b>[Crochets]</b> pour les variables :\n\n<b>Standard :</b> [Name], [Company], [Bank], [Amount]\n<b>Intelligent (auto) :</b> [CardLast4], [CaseID], [ReferenceNum]\n<b>Intelligent (choix) :</b> [Reason], [Location], [CallBack]\n\n<i>Exemple : Bonjour [Name]. Ici la sécurité de [Bank]. Un débit de $[Amount] a été effectué sur la carte se terminant par [CardLast4]. Dossier [CaseID]. Appuyez sur 1 pour contester.</i>\n\nTapez votre script :',
 cp_47: '📋 <b>Référence complète des variables</b>\n\n<b>🔤 Standard (vous saisissez la valeur) :</b>\n• <code>[Name]</code> — Nom du destinataire\n• <code>[Bank]</code> — Nom de la banque ou de l\'institution\n• <code>[Company]</code> — Nom de l\'entreprise ou du marchand\n• <code>[Amount]</code> — Montant en dollars\n\n<b>🤖 Auto-remplissage intelligent (généré pour vous) :</b>\n• <code>[CardLast4]</code> — 4 chiffres de carte aléatoires\n• <code>[CaseID]</code> — ID de dossier/référence aléatoire\n• <code>[ReferenceNum]</code> — Numéro de référence aléatoire\n\n<b>📋 Choix intelligent (parmi des préréglages) :</b>\n• <code>[Reason]</code> — alerte fraude, suspension de compte, activité inhabituelle, etc.\n• <code>[Location]</code> — Format Ville, État (vous saisissez)\n• <code>[CallBack]</code> — Votre numéro Nomadly\n\n<b>💡 Conseils :</b>\n• Mélangez librement variables standard et intelligentes\n• Les variables sont sensibles à la casse : <code>[Bank]</code> et non <code>[bank]</code>\n• Incluez « appuyez sur 1 » dans votre script pour détecter automatiquement les touches actives\n\nTapez maintenant votre script :',
 cp_48: (keyNote) => `${keyNote}\n\nAppuyez sur <b>✅ Continuer</b> pour garder ces touches, ou tapez-en de nouvelles :\n<i>Exemple : 1,2,3 ou 1,5,9</i>`,
 cp_49: 'Tapez votre script IVR personnalisé :',
 cp_5: '⚠️ Session expirée. Veuillez réessayer l\'achat.',
 cp_50: 'Veuillez entrer au moins un chiffre (0-9) :\n<i>Exemple : 1,2,3</i>',
 cp_51: (join) => `🔘 Touches actives mises à jour : <b>${join}</b>`,
 cp_52: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_53: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_54: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_56: (firstPh) => `Entrez la valeur pour <b>[${firstPh}]</b> :`,
 cp_57: '📋 <b>Choisissez le mode d\'appel</b>\n\n🔗 <b>Transfert</b> — Quand la cible appuie sur la touche, elle est mise en relation avec votre numéro\n🔑 <b>Collecte OTP</b> — Après la touche, la cible est invitée à saisir un code — qui vous est transmis via Telegram\n\nLes deux modes fournissent un rapport complet.',
 cp_58: 'Veuillez sélectionner un modèle parmi les boutons.',
 cp_59: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 Touches actives : <b>${join}</b>`,
 cp_6: '⚠️ Session expirée. Veuillez réessayer l\'achat.',
 cp_60: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_61: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_62: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_64: (firstPh) => `\nEntrez la valeur pour <b>[${firstPh}]</b> :`,
 cp_65: '📋 <b>Choisissez le mode d\'appel</b>\n\n🔗 <b>Transfert</b> — Quand la cible appuie sur la touche, elle est mise en relation avec votre numéro\n🔑 <b>Collecte OTP</b> — Après la touche, la cible est invitée à saisir un code — qui vous est transmis via Telegram\n\nLes deux modes fournissent un rapport complet.',
 cp_66: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — régénéré : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_67: (currentPh) => `✍️ Tapez votre valeur personnalisée pour <b>[${currentPh}]</b> :`,
 cp_68: (currentPh) => `✍️ Tapez le numéro de rappel pour <b>[${currentPh}]</b> :\n<i>Exemple : +12025551234</i>`,
 cp_69: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nGénéré automatiquement : <b>${generated}</b>\nAppuyez pour accepter, régénérer, ou tapez votre propre valeur :`,
 cp_7: '⚠️ Aucune session en attente trouvée.',
 cp_70: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nChoisissez dans la liste ou tapez votre propre valeur :`,
 cp_71: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh} : <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_73: (currentPh, value, nextPh) => `✅ ${currentPh} : <b>${value}</b>\n\nEntrez la valeur pour <b>[${nextPh}]</b> :`,
 cp_74: '✅ Toutes les valeurs sont définies !\n\n📋 <b>Choisissez le mode d\'appel</b>\n\n🔗 <b>Transfert</b> — Quand la cible appuie sur la touche, elle est mise en relation avec votre numéro\n🔑 <b>Collecte OTP</b> — Après la touche, la cible est invitée à saisir un code — qui vous est transmis via Telegram\n\nLes deux modes fournissent un rapport complet.',
 cp_75: '🔗 <b>Mode transfert</b>\n\nEntrez le numéro vers lequel transférer l\'appelant lorsqu\'il appuie sur une touche :\n<i>Exemple : +17174794833</i>',
 ivrTrialNudge: `🎁 <b>Vous avez 1 Appel IVR Rapide gratuit !</b>

Passez un appel automatisé qui diffuse votre message enregistré et capture une touche ou un OTP — gratuit, sans forfait.

👉 Appuyez sur <b>📞 Cloud IVR + SIP</b> ci-dessous, puis <b>📢 Appel IVR Rapide</b> pour l'essayer maintenant.`,
 cp_76: '🔒 La <b>collecte OTP</b> n\'est pas disponible pendant l\'essai gratuit.\n\nAbonnez-vous à un forfait <b>Pro</b> ou <b>Business</b> pour utiliser la collecte OTP.\n\nVous pouvez toujours utiliser le mode <b>🔗 Transfert</b> pour votre appel d\'essai.',
 cp_77: '🔑 <b>Mode collecte OTP</b>\n\nCombien de chiffres doit comporter le code ?\n\n💡 L\'invite de saisie du code est ajoutée automatiquement après votre script — inutile de l\'inclure.\n\n<i>Par défaut : 6 chiffres</i>',
 cp_78: 'Sélectionnez un mode :',
 cp_79: '📋 <b>Choisissez le mode d\'appel</b>\n\n🔗 <b>Transfert</b> — Quand la cible appuie sur la touche, elle est mise en relation avec votre numéro\n🔑 <b>Collecte OTP</b> — Après la touche, la cible est invitée à saisir un code — qui vous est transmis via Telegram\n\nLes deux modes fournissent un rapport complet.',
 cp_8: (buyPlansHeader, price, minutes, sms, starter, v5, v6, v7, pro, v9, v10, v11, business) => `${buyPlansHeader}\n\n💡 <b>Starter</b> — $${price}/mois\n📞 ${minutes} min + 📩 ${sms} SMS · Renvoi d'appel · Jusqu'à ${starter} numéros\n\n⭐ <b>Pro</b> — $${v5}/mois\n📞 ${v6} min + 📩 ${v7} SMS · Tout Starter + Répondeur · SIP · Webhooks · IVR · Jusqu'à ${pro} numéros\n\n👑 <b>Business</b> — $${v9}/mois\n📞 ${v10} min + 📩 ${v11} SMS · Tout Pro + Enregistrement · Standard automatique · OTP · Support prioritaire · Jusqu'à ${business} numéros\n\n<i>💳 Appels sortants facturés depuis le portefeuille</i>`,
 cp_80: 'Entrez un nombre de chiffres valide (1-10) :',
 cp_81: (length) => `✅ Longueur OTP : <b>${length} chiffres</b> (3 tentatives max)\n\n✍️ <b>Personnaliser les messages</b>\n\nSouhaitez-vous personnaliser ce que les appelants entendent après la vérification ?\n\n<b>Confirmation par défaut :</b> <i>« Votre code a été vérifié avec succès. Merci. Au revoir. »</i>\n<b>Refus par défaut :</b> <i>« Nombre maximal de tentatives atteint. Au revoir. »</i>`,
 cp_82: (length) => `✅ Longueur OTP : <b>${length} chiffres</b> (3 tentatives max)\n\n🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :`,
 cp_83: '🔑 <b>Mode collecte OTP</b>\n\nCombien de chiffres doit comporter le code ?\n\n💡 L\'invite de saisie du code est ajoutée automatiquement après votre script — inutile de l\'inclure.\n\n<i>Par défaut : 6 chiffres</i>',
 cp_84: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_85: '✅ <b>Message de confirmation</b>\n\nTapez ce que l\'appelant entend quand vous <b>CONFIRMEZ</b> son code :\n\n<i>Exemple : « Votre code a été vérifié. Nous avons bloqué la transaction et sécurisé votre compte. Un spécialiste vous contactera sous 24 heures. Merci d\'avoir choisi notre banque. Au revoir. »</i>',
 cp_86: 'Choisissez une option :',
 cp_87: '✍️ <b>Personnaliser les messages</b>\n\nSouhaitez-vous personnaliser ce que les appelants entendent après la vérification ?',
 cp_88: '❌ <b>Message de refus</b>\n\nTapez ce que l\'appelant entend quand vous <b>REFUSEZ</b> son code (tentatives max atteintes) :\n\n<i>Exemple : « Nous n\'avons pas pu vérifier votre identité. Pour votre sécurité, cette session est terminée. Veuillez rappeler ou vous rendre dans l\'agence la plus proche. Au revoir. »</i>',
 cp_89: '✅ <b>Message de confirmation</b>\n\nTapez ce que l\'appelant entend quand vous <b>CONFIRMEZ</b> son code :',
 cp_9: (buyLabel) => `📢 <b>Appel IVR rapide</b>\n\nVous avez déjà utilisé votre appel d'essai gratuit.\n\nAbonnez-vous à Cloud IVR pour passer des appels IVR illimités avec votre propre ID appelant !\n\nAppuyez sur <b>${buyLabel}</b> pour commencer.`,
 cp_90: '✅ Messages personnalisés enregistrés !\n\n🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_91: 'Veuillez entrer un numéro de téléphone valide commençant par +.\n<i>Exemple : +17174794833</i>',
 cp_92: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_93: 'Entrez le numéro vers lequel transférer l\'appelant lorsqu\'il appuie sur une touche :\n<i>Exemple : +17174794833</i>',
 cp_94: 'Veuillez sélectionner un fournisseur de voix :',
 cp_95: '🎤 <b>Choisissez la voix</b>\n\nChoisissez une voix pour l\'audio IVR :',
 cp_96: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_97: (name) => `🎤 Voix : <b>${name}</b>\n\n🎚 <b>Choisissez la vitesse de parole</b>\n\nÀ quelle vitesse la voix doit-elle parler ?`,
 cp_98: '🎙 <b>Choisissez le fournisseur de voix</b>\n\nSélectionnez votre moteur TTS :',
 cp_99: '✍️ Entrez un multiplicateur de vitesse personnalisé :\n<i>Exemples : 0.6 (très lent), 0.9 (un peu lent), 1.2 (plus rapide), 1.5 (très rapide)\nPlage : 0.25 à 4.0</i>',
 dns_1: (domain) => `🔗 Désactivation du raccourcisseur pour <b>${domain}</b>…`,
 dns_2: (domain) => `✅ Raccourcisseur désactivé pour <b>${domain}</b>.`,
 dns_3: '❌ Impossible de désactiver le raccourcisseur. Veuillez réessayer ou contacter le support.',
 dns_3_busy: '⏳ Notre service de raccourcisseur est momentanément occupé. Votre lien reste actif pour l\'instant — nous réessaierons automatiquement et vous préviendrons une fois la désactivation terminée. Vous pouvez aussi réessayer dans une minute.',
 dns_4: '🔄 Suppression de l\'enregistrement en conflit et ajout du nouveau...',
 dns_5: 'Format invalide. Utilisez <b>_service._protocole</b> (ex. _sip._tcp, _http._tcp) :',
 dns_6: '⚠️ Veuillez entrer un montant USD valide (minimum 10 $).',
 dom_1: 'Vous n\'avez aucun domaine enregistré. Veuillez enregistrer un nouveau domaine ou connecter un domaine externe.',
 dom_2: '📋 <b>Mes plans d\'hébergement</b>\n\nVous n\'avez aucun plan d\'hébergement actif. Achetez un plan pour commencer !',
 dom_3: (savings, domain, chargeUsd, shownPrice, v4) => `🎉 <b>Vous avez économisé $${savings} !</b> Le domaine <b>${domain}</b> a été enregistré pour <b>$${v4}</b> au lieu de $${shownPrice}. Seuls $${chargeUsd} ont été débités de votre portefeuille.`,
 dom_4: (domain, v1) => `💡 <b>Et maintenant, avec ${v1} ?</b>\n\n🔗 <b>Activer pour le raccourcisseur d'URL</b> — utilisez ${domain} comme lien court personnalisé\n🛡️🔥 <b>Hébergement Anti-Red</b> — hébergez un site sur ${domain} avec protection anti-suspension\n🌐 <b>Gérer le DNS</b> — pointez-le vers votre serveur\n\nAppuyez sur l'une des options ci-dessous pour continuer.`,
 dom_5: (domain, domainCost, APP_SUPPORT_LINK) => `Votre domaine <b>${domain}</b> a été enregistré avec succès, mais la configuration de l'hébergement a échoué. Le coût du domaine ($${domainCost}) a été débité. Veuillez contacter le support pour finaliser votre hébergement : ${APP_SUPPORT_LINK}`,
 dom_6: (showWallet) => `❌ Échec de la configuration réglementaire.\n\n💰 Votre portefeuille a été remboursé.\n${showWallet}`,
 dom_7: (requested, delivered, requesteddelivered, toFixed, reasonText, v5) => `💰 <b>Remboursement partiel</b>\n\n📊 Commandés : ${requested} leads\n✅ Livrés : ${delivered} leads\n❌ Non livrés : ${requesteddelivered} leads\n\n💵 Remboursement : <b>$${toFixed}</b> reversés sur votre portefeuille\n📝 Motif : ${reasonText}\n\n💰 Portefeuille : $${v5} USD`,
 dom_8: '💡 <b>Maximisez vos leads</b>\n\n📞 <b>Obtenez un Cloud IVR</b> — appelez ces leads avec un numéro local\n🎯 <b>Achetez plus de leads</b> — ciblez une autre zone ou un autre opérateur\n🔗 <b>Raccourcissez vos liens</b> — suivez vos campagnes\n\nAppuyez sur une option ci-dessous.',
 dom_9: (totalPrice, toFixed) => `❌ Solde du portefeuille insuffisant. Requis $${totalPrice}, disponible $${toFixed}.\nApprovisionnez votre portefeuille et réessayez.`,

 // Post-purchase upsells (hosting & VPS)
 host_5d: (domain) => `💡 <b>Votre hébergement pour ${domain} est en ligne !</b>\n\n🌐 <b>Achetez plus de domaines</b> — hébergez d'autres sites\n📞 <b>Cloud IVR + SIP</b> — laissez vos visiteurs vous appeler avec un numéro virtuel\n✂️🌐 <b>Raccourcisseur de domaine personnalisé</b> — suivez le trafic entrant avec des liens courts personnalisés\n\nTouchez une option ci-dessous.`,
 vps_5d: (isRDP = false) => isRDP
  ? '💡 <b>Votre RDP est prêt !</b>\n\n📧 <b>BulkSMS</b> — exécutez la passerelle SMS sur votre nouveau RDP\n📞 <b>Cloud IVR + SIP</b> — associez avec un numéro virtuel pour les appels entrants\n🌐 <b>Domaines anti-blocage</b> — pointez un domaine vers votre RDP\n\nTouchez une option ci-dessous.'
  : '💡 <b>Votre VPS est prêt !</b>\n\n📧 <b>BulkSMS</b> — hébergez la passerelle SMS sur votre nouveau VPS\n📞 <b>Cloud IVR + SIP</b> — associez avec un numéro virtuel pour les appels entrants\n🌐 <b>Domaines anti-blocage</b> — pointez un domaine vers votre VPS\n\nTouchez une option ci-dessous.',
 ev_1: '🚧 Le service de validation d\'emails est en maintenance. Veuillez réessayer plus tard.',
 ev_10: (message) => `❌ Error: ${message}`,
 ev_11: '❌ Invalid IPv4 format. Send like: <code>1.2.3.4</code>',
 ev_12: (ipInput) => `✅ IP <code>${ipInput}</code> added to pool.`,
 ev_13: (ipInput) => `✅ IP <code>${ipInput}</code> removed from pool.`,
 ev_14: (message) => `❌ Erreur: ${message}`,
 ev_15: '❌ Annulé.',
 ev_16: '❌ Annulé.',
 ev_17: '❌ Veuillez importer un fichier <b>.csv</b> ou <b>.txt</b>.',
 ev_18: (message) => `❌ Lecture du fichier impossible : ${message}`,
 ev_19: '📎 Veuillez importer un fichier CSV/TXT contenant des adresses email.',
 ev_2: '📧 Retour au menu Validation d\'emails...',
 ev_20: '❌ Aucune adresse email valide trouvée dans le fichier. Veuillez vérifier le format.',
 ev_21: (minEmails, length) => `❌ Minimum <b>${minEmails}</b> emails requis. Seulement ${length} trouvés.`,
 ev_22: (toLocaleString, v1) => `❌ Maximum <b>${toLocaleString}</b> emails autorisés. ${v1} trouvés.`,
 ev_23: '❌ Annulé.',
 ev_24: '📋 Veuillez coller les adresses email (une par ligne ou séparées par des virgules).',
 ev_25: '❌ Aucune adresse email valide trouvée. Veuillez vérifier le format.',
 ev_26: (maxPasteEmails, length) => `❌ Le mode collage accepte jusqu'à <b>${maxPasteEmails}</b> emails. ${length} trouvés. Utilisez l'import de fichier pour les listes plus grandes.`,
 ev_27: (minEmails, length) => `❌ Minimum <b>${minEmails}</b> emails requis. Seulement ${length} trouvés.`,
 ev_28: '❌ Annulé.',
 ev_29: '❌ Session expirée. Veuillez recommencer.',
 ev_3: '⚠️ Could not reach worker',
 ev_30: '❌ Essai gratuit non disponible pour cette taille de liste. Veuillez choisir un mode de paiement.',
 ev_31: '❌ Essai gratuit déjà utilisé. Veuillez choisir un mode de paiement.',
 ev_32: '❌ Essai + Paiement non disponible. Veuillez choisir un mode de paiement.',
 ev_33: '❌ Essai gratuit déjà utilisé. Veuillez choisir un mode de paiement.',
 ev_34: (toFixed, v1) => `⚠️ Solde USD insuffisant pour les emails supplémentaires.\n💰 Requis : <b>$${toFixed}</b>\n💳 Disponible : <b>$${v1}</b>\n\nVeuillez approvisionner votre portefeuille, ou payer le prix complet en NGN.`,
 ev_35: (toFixed, v1) => `⚠️ Solde USD insuffisant.\n💰 Requis : <b>$${toFixed}</b>\n💳 Disponible : <b>$${v1}</b>\n\nVeuillez approvisionner votre portefeuille.`,
 ev_36: (toFixed, toLocaleString) => `✅ <b>Paiement réussi !</b>\n\n💵 Débité : <b>$${toFixed}</b>\n📧 Validation : <b>${toLocaleString} emails</b>\n\n⏳ Le traitement commencera sous peu. Vous recevrez des mises à jour de progression.`,
 ev_37: 'Veuillez choisir un mode de paiement :',
 ev_4: (message) => `❌ Error: ${message}`,
 ev_5: '⚠️ No IPs found from cloud provider API or credentials missing.',
 ev_6: (message) => `❌ Cloud API error: ${message}`,
 ev_7: '➕ <b>Add IP</b>\\n\\nSend me the IPv4 address to add (e.g. <code>1.2.3.4</code>):',
 ev_8: (message) => `❌ Error: ${message}`,
 ev_9: '♻️ All IP health stats reset to healthy.',
 host_1: '❌ Erreur de traitement du paiement. Veuillez contacter le support.',
 host_10: (startsWith) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 Appuyez pour copier`,
 host_11: (startsWith) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 Appuyez pour copier`,
 host_12: '❌ Erreur lors de la création du lien court. Veuillez réessayer.',
 host_13: 'not authorized',
 host_14: 'not authorized',
 host_15: (userToUnblock) => `User ${userToUnblock} not found`,
 host_16: (userToUnblock) => `User ${userToUnblock} has been unblocked.`,
 host_17: 'not authorized',
 host_18: 'not authorized',
 host_19: (previewText, statsText) => `${previewText}\n\n${statsText}\n\nReady to broadcast?`,
 host_2: 'Hello, Admin! Please select an option:',
 host_20: '🚀 Starting broadcast... This may take a while for large user bases.',
 host_21: (message) => `❌ Broadcast failed: ${message}`,
 host_22: '📤 Broadcast initiated! You\\\'ll receive progress updates.',
 host_23: (message, plan) => `<b>${message}</b> est déjà sur un ${plan}. Choisissez un autre domaine.`,
 host_24: 'Veuillez sélectionner un domaine dans la liste.',
 host_25: '✅ Vous êtes déjà sur le forfait le plus élevé (Golden Anti-Red). Aucune mise à niveau disponible.',
 host_26: (toFixed, price) => `⚠️ Solde insuffisant. Vous avez $${toFixed} mais il vous faut $${price}.`,
 host_27: 'Veuillez sélectionner l\'une des options de mise à niveau.',
 host_28: (toFixed, upgradePrice) => `⚠️ Solde insuffisant. Vous avez $${toFixed} mais il vous faut $${upgradePrice}.`,
 host_29: (error) => `❌ Échec de la mise à niveau : ${error}\nVotre portefeuille a été remboursé.`,
 host_3: (toFixed, length) => `💰 Remboursement automatique de <b>$${toFixed}</b> pour ${length} vérification(s) refusée(s). Vous pouvez relancer un achat à tout moment.`,
 host_30: '❌ Échec de la mise à niveau. Votre portefeuille a été remboursé. Veuillez réessayer ou contacter le support.',
 host_31: '🚧 Le service VPS arrive bientôt ! Restez à l\'écoute.',
 host_32: '⚠️ Impossible de charger la page de parrainage. Réessayez plus tard.',

// === Hosting Plan / Billing UX (added 2026-02) ===
// Headers
myHostingPlansHeader: '📋 <b>Mes Plans d\'Hébergement</b>',
billingMenuHeader: '💳 <b>Mon Plan / Facturation</b>',
billingMenuIntro: 'Gérez les renouvellements et le renouvellement automatique de chacun de vos plans d\'hébergement.',
billingMenuEmpty: '💳 <b>Mon Plan / Facturation</b>\n\nVous n\'avez pas encore de plan d\'hébergement actif.',
// Status indicators
statusActive: '✅ Actif',
statusActiveOnline: '✅ Actif (en ligne)',
statusSuspended: '🚫 Suspendu',
statusSuspendedFull: '🚫 Suspendu (hors ligne — complet)',
statusExpired: '❌ Expiré',
statusMaintenance: '🛠️ Maintenance (hors ligne — public uniquement)',
// Auto-Renew states
autoRenewOn: '✅ ACTIVÉ',
autoRenewOff: '❌ DÉSACTIVÉ',
autoRenewWeeklyOff: '❌ DÉSACTIVÉ (les plans hebdomadaires ne se renouvellent jamais automatiquement)',
autoRenewWeeklyShort: '❌ DÉSACTIVÉ (hebdomadaire)',
// Field labels
planLabel: 'Plan :',
statusLabel: 'Statut :',
domainTypeFieldLabel: 'Type de domaine :',
createdLabel: 'Créé :',
expiresLabel: 'Expire :',
autoRenewFieldLabel: 'Renouvellement auto :',
usernameLabel: 'Nom d\'utilisateur :',
priceLabel: 'Prix :',
durationLabel: 'Durée :',
walletBalanceLabel: 'Solde du portefeuille :',
chargedLabel: 'Débité :',
newExpiryLabel: 'Nouvelle expiration :',
remainingBalanceLabel: 'Solde restant :',
domainLabel: 'Domaine :',
currentLabel: 'Actuel :',
// Plan view body
planViewCredentialsHint: 'Appuyez sur "Afficher les Identifiants" pour révéler votre nom d\'utilisateur HostPanel et votre PIN.',
planViewBillingNudge: '💡 Pour renouveler ou activer/désactiver le renouvellement automatique, ouvrez <b>💳 Mon Plan / Facturation</b> depuis le menu Hébergement.',
planViewMultiHostUpsell: '💡 <b>Vous voulez héberger plus de sites ?</b> Passez à un plan mensuel pour l\'hébergement multi-sites, plus de stockage et une protection Anti-Red avancée.',
// Renew modal
renewModalHeader: planName => `<b>Renouveler le plan — ${planName}</b>`,
renewModalCurrentExpiry: (date, isExpired) => `<b>Expiration actuelle :</b> ${date}${isExpired ? ' (EXPIRÉ)' : ''}`,
renewModalDuration: days => `<b>Durée :</b> ${days} jours`,
renewModalConfirmHint: '✅ Confirmez le paiement ci-dessous :',
renewModalInsufficient: '⚠️ Solde insuffisant. Veuillez d\'abord déposer.',
renewModalPayButton: price => `💵 Payer $${price} USD`,
// Renew success / failure
renewSuccessTitle: '✅ <b>Plan renouvelé avec succès !</b>',
renewSuccessAntiRedNote: 'La protection Anti-Red a été actualisée.',
renewFailureFallback: '❌ Le renouvellement a échoué. Votre portefeuille a été remboursé. Veuillez réessayer ou contacter le support.',
// Upgrade modal
upgradeModalHeader: '<b>⬆️ Mise à niveau du plan</b>',
upgradeModalChooseHint: 'Choisissez votre nouveau plan :',
// Per-domain billing buttons
billingRenewBtn: domain => `🔄 Renouveler — ${domain}`,
billingToggleAutoRenewBtn: domain => `🔁 Activer/Désactiver Renouv. Auto — ${domain}`,
// Auto-Renew toggle status
autoRenewTurnedOn: domain => `✅ Le renouvellement auto est maintenant <b>ACTIVÉ</b> pour <b>${domain}</b>. Votre plan sera renouvelé automatiquement à l'expiration.`,
autoRenewTurnedOff: domain => `❌ Le renouvellement auto est maintenant <b>DÉSACTIVÉ</b> pour <b>${domain}</b>. Votre plan expirera et sera suspendu après la période de grâce.`,
autoRenewNotForWeekly: '❌ Le renouvellement automatique n\'est pas disponible sur les plans hebdomadaires.',
// Toast strings
siteAlreadyOffline: '⚠️ Votre site est déjà hors ligne. Utilisez "Remettre le Site En Ligne" pour le réactiver.',
siteAlreadyOnline: '✅ Votre site est déjà en ligne.',
addonNotOnPlan: '⚠️ Ce domaine n\'est pas un domaine additionnel sur ce plan.',
promoMessagesEnabled: '🔔 Les messages promotionnels sont maintenant activés.',
promoMessagesDisabled: '✅ Les messages promotionnels sont maintenant désactivés.',
// Credentials reveal
credentialsHeader: domain => `🔑 <b>Identifiants pour ${domain}</b>`,
credentialsPinLabel: 'PIN :',
credentialsPanelUrlLabel: 'URL de connexion au panneau :',
credentialsFreshNotice: '⚠️ <i>Ce PIN vient d\'être généré. Votre ancien PIN ne fonctionne plus.</i>',
// Hosting Scheduler notifications
schedExpiryWarningTitle: '⏰ <b>Avis d\'expiration d\'hébergement</b>',
schedExpiryWarningBody: (plan, domain) => `Votre plan <b>${plan}</b> pour <b>${domain}</b> expire dans moins de 24 heures.`,
schedRenewTextOn: '✅ Le renouvellement auto est <b>ACTIVÉ</b>. Votre plan sera renouvelé automatiquement à l\'expiration.',
schedRenewTextOff: hours => `Le renouvellement auto est <b>DÉSACTIVÉ</b>. Votre hébergement sera <b>suspendu immédiatement</b> à l\'expiration et supprimé après ${hours}h s\'il n\'est pas renouvelé manuellement.`,
schedRenewTextWeekly: 'Les plans hebdomadaires ne se renouvellent pas automatiquement. Veuillez renouveler manuellement avant l\'expiration.',
schedRenewTextWalletHint: 'Solde du portefeuille : Vérifiez via /wallet',
schedRenewTextToggleHint: domain => `Pour activer/désactiver le renouvellement auto : ouvrez <b>💳 Mon Plan / Facturation</b>`,
schedAutoRenewedTitle: '✅ <b>Plan renouvelé automatiquement !</b>',
schedAutoRenewedBody: (plan, domain, price, newExpiry, remBalance) =>
  `<b>${plan}</b> pour <b>${domain}</b> a été renouvelé.\n<b>Débité :</b> $${price}\n<b>Nouvelle expiration :</b> ${newExpiry}\n<b>Solde restant :</b> $${remBalance}`,
schedAutoRenewFailedTitle: '⚠️ <b>Renouvellement auto échoué — Solde insuffisant</b>',
schedAutoRenewFailedBody: (plan, domain, price, balance, hours) =>
  `<b>${plan}</b> pour <b>${domain}</b> a expiré.\n<b>Prix de renouvellement :</b> $${price}\n<b>Votre solde :</b> $${balance}\n\nVeuillez déposer des fonds pour renouveler.\nVotre hébergement a été <b>suspendu</b>. Déposez des fonds pour le réactiver.\nVotre compte sera <b>supprimé</b> dans ${hours}h s'il n'est pas renouvelé.`,
schedWeeklyExpiredTitle: '⏰ <b>Plan hebdomadaire expiré</b>',
schedWeeklyExpiredBody: (plan, domain, hours) =>
  `Votre plan <b>${plan}</b> pour <b>${domain}</b> a expiré.\n\n⚠️ Les plans hebdomadaires ne se renouvellent <b>pas</b> automatiquement.\nVotre hébergement a été <b>suspendu</b> — le site est maintenant hors ligne.\nVeuillez renouveler manuellement depuis <b>💳 Mon Plan / Facturation</b> pour réactiver.\n\nVotre compte sera <b>définitivement supprimé</b> dans ${hours}h s'il n'est pas renouvelé.`,
schedDeletedTitle: '🗑️ <b>Hébergement supprimé</b>',
schedDeletedBody: (domain, plan) =>
  `Le compte cPanel <b>${domain}</b> a été définitivement supprimé.\nPlan : ${plan}\n\nTous les fichiers, bases de données et e-mails ont été supprimés.\nPour recommencer, achetez un nouveau plan d'hébergement.`,
schedDeletedBodyHours: (domain, plan, hoursExpired, gracePeriod) =>
  `Le compte cPanel <b>${domain}</b> a été définitivement supprimé.\nPlan : ${plan} — expiré il y a ${hoursExpired}h (période de grâce de ${gracePeriod}h dépassée).\n\nTous les fichiers, bases de données et e-mails ont été supprimés.\nPour recommencer, achetez un nouveau plan d'hébergement.`,
schedSuspendedTitle: '🚫 <b>Hébergement suspendu</b>',
schedSuspendedBody: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> a été suspendu — votre plan <b>${plan}</b> a expiré il y a ${hoursExpired}h.\n\n⚠️ Votre site est maintenant <b>hors ligne</b>.\nRenouvelez depuis <b>💳 Mon Plan / Facturation</b> pour réactiver.\nLe compte sera <b>définitivement supprimé</b> ${gracePeriod}h après l'expiration s'il n'est pas renouvelé.`,
// === Phone-monitor / Phone-scheduler ===
phoneCallerIdFlaggedTitle: '⚠️ <b>Numéro signalé</b>',
phoneCallerIdFlaggedBody: phoneNumber =>
  `Votre numéro <b>${phoneNumber}</b> a été signalé et suspendu par l'opérateur.\n\nCe numéro ne peut plus être utilisé pour les appels sortants ou les campagnes.\n\n👉 Veuillez acheter un nouveau numéro depuis le menu <b>Cloud IVR + SIP</b> pour continuer à passer des appels.\n\nPour toute question, contactez le support.`,
phoneAutoRenewFailedTitle: '❌ <b>Échec du renouvellement auto — Numéro supprimé</b>',
phoneAutoRenewFailedBody: (phoneNumber, planName, planPrice, buyLabel) =>
  `📞 ${phoneNumber}\n📦 Plan : ${planName} ($${planPrice}/mois)\n\n⚠️ Solde du portefeuille insuffisant. Votre numéro a été <b>définitivement supprimé</b> pour éviter toute facturation supplémentaire.\n\nCette action est irréversible. Pour obtenir un nouveau numéro, visitez 📞☁️ Cloud Phone → ${buyLabel}.`,
phoneSuspendedTitle: '⚠️ <b>Numéro expiré — Définitivement supprimé</b>',
phoneSuspendedBody: (phoneNumber, buyLabel) =>
  `📞 ${phoneNumber} a expiré et a été <b>définitivement supprimé</b>.\n\nLe renouvellement auto était DÉSACTIVÉ. Pour éviter de perdre des numéros à l'avenir, activez le renouvellement auto sur votre prochain numéro.\n\nObtenez un nouveau numéro : 📞☁️ Cloud Phone → ${buyLabel}.`,
phoneUsageAlertTitle: '⚠️ <b>Alerte d\'utilisation</b>',
phoneUsageAlertBody: (phoneNumber, used, limit, type, percent, rate, unit) =>
  `📞 ${phoneNumber}\n\nVous avez utilisé <b>${used}/${limit}</b> ${type} entrants ce mois (${percent}%).\nUne fois épuisé, la facturation des dépassements démarre à <b>$${rate}/${unit}</b> depuis votre portefeuille. Le service s'interrompt si le portefeuille est vide.`,
phoneUsageLimitTitle: type => `💰 <b>${type} entrants — Dépassement actif</b>`,
phoneUsageLimitBody: (phoneNumber, type, limit, rate, unit) =>
  `📞 ${phoneNumber}\n\nVous avez utilisé tous les <b>${limit}</b> ${type} entrants de votre plan ce mois.\nLa facturation des dépassements est maintenant active — <b>$${rate}/${unit}</b> débité de votre portefeuille par utilisation.\nLe service s'interrompt si le solde du portefeuille est épuisé. Rechargez ou améliorez votre plan.`,
// === Generic error toast (error-handler.js) ===
genericErrorTitle: '❌ <b>Erreur</b>',
genericErrorBody: txnId =>
  `Une erreur est survenue${txnId ? ` (Transaction : ${txnId})` : ''}.\n\nNotre équipe a été notifiée et enquêtera.`,
genericErrorRefundedNote: '✅ Votre paiement a été remboursé.',
genericErrorContactSupport: 'Veuillez contacter le support si cela persiste.',
// === Bulk-call campaign ===
bulkCallProgressLine: (icon, displayNumber, displayName, statusText, durText, bar, completed, total, pct, kp, missed, failed) =>
  `${icon} <b>${displayNumber}</b>${displayName} — ${statusText}${durText}\n${bar} ${completed}/${total} (${pct}%) | 🔘${kp} 📵${missed} ❌${failed}`,
bulkCallReportTitle: '📊 <b>Campagne terminée !</b>',
bulkCallReportCallerId: 'ID Appelant :',
bulkCallReportAudio: 'Audio :',
bulkCallReportProvider: 'Fournisseur :',
bulkCallReportDuration: 'Durée :',
bulkCallReportTotal: 'Total des appels :',
bulkCallReportAnswered: 'Répondu :',
bulkCallReportKeyPressed: 'Touche pressée :',
bulkCallReportTransferred: 'Transféré :',
bulkCallReportNoAnswer: 'Sans réponse :',
bulkCallReportHungUp: 'Raccroché :',
bulkCallReportBusy: 'Occupé :',
bulkCallReportFailed: 'Échec :',
// === SMS App service ===
smsAppTrialCompleteTitle: '📱 <b>Essai gratuit BulkSMS terminé !</b>',
smsAppTrialCompleteBody: limit =>
  `Vous avez utilisé tous les ${limit} SMS gratuits de votre essai. Bravo pour avoir testé la plateforme !`,
smsAppTrialExpiredTitle: '📱 <b>Essai BulkSMS expiré</b>',
smsAppTrialExpiredBody: 'Abonnez-vous pour continuer à envoyer des campagnes SMS.\n👉 Appuyez sur <b>👛 Portefeuille → 📋 Voir les abonnements</b> pour mettre à niveau !',
// === cPanel-routes Anti-Red warnings ===
antiRedWarningTitle: '⚠️ <b>Avertissement de protection Anti-Red</b>',
antiRedWarningBodyShort: domain =>
  `Protection déployée pour <b>${domain}</b> mais pas encore vérifiée. Assurez-vous que les serveurs de noms pointent vers Cloudflare.`,
antiRedFailedTitle: '🚨 <b>Protection Anti-Red échouée</b>',
antiRedFailedBodyShort: (domain, retries) =>
  `La protection n'a pas pu être déployée pour <b>${domain}</b> après ${retries} tentatives. Assurez-vous que les serveurs de noms pointent vers Cloudflare.`,

host_4: (safeHtml) => `${safeHtml}`,
 host_5: (CHAT_BOT_NAME) => `<b>Aide ${CHAT_BOT_NAME}</b>\n\n<b>Commandes rapides :</b>\n• <code>/shorten URL</code> — Lien court instantané\n• <code>/shorten URL alias</code> — Alias personnalisé\n• Collez simplement une URL — Détection et raccourcissement automatiques\n\n<b>Fonctionnalités :</b>\n• Raccourcisseur d'URL\n• Noms de domaine\n• Leads téléphoniques\n• Portefeuille et paiements\n• Hébergement web\n\nUtilisez le menu ci-dessous pour commencer !`,
 host_6: '✂️ <b>Commande de raccourcissement rapide</b>\n\n<b>Utilisation :</b>\n<code>/shorten https://example.com</code> — Lien court aléatoire\n<code>/shorten https://example.com monalias</code> — Alias personnalisé\n\nOu collez simplement une URL et je vous proposerai de la raccourcir !',
 host_7: '❌ URL invalide. Veuillez fournir une URL valide commençant par http:// ou https://',
 host_8: (customAlias, preferredDomain) => `❌ L'alias <code>${customAlias}</code> est déjà pris sur ${preferredDomain}. Essayez un autre alias.`,
 host_9: (customAlias) => `❌ L'alias <code>${customAlias}</code> est déjà pris. Essayez un autre alias.`,
 ld_1: (toFixed) => `💵 $${toFixed} — `,
 ld_2: '🎯 Sélectionnez l\'institution ciblée.\nLeads réels et vérifiés avec le nom du propriétaire du numéro — triés par opérateur dans des zones métropolitaines à forte valeur :',
 ld_3: '📝 <b>Demander des leads personnalisés</b>\n\nIndiquez-nous l\'institution ou l\'entreprise pour laquelle vous souhaitez des leads ciblés.\nNous fournissons des numéros réels et vérifiés avec le nom du propriétaire — dans la zone métropolitaine de votre choix :',
 sms_1: (toFixed, v1) => `⚠️ <b>Solde insuffisant</b>\n\n💰 Requis : <b>$${toFixed}</b>\n👛 Disponible : <b>$${v1}</b>\n\nVeuillez recharger ou choisir un autre mode de paiement.`,
 sms_10: 'not authorized',
 sms_11: 'Backup created successfully.',
 sms_12: 'not authorized',
 sms_13: 'Data restored successfully.',
 sms_14: 'not authorized',
 sms_15: (length, join) => `Users: ${length}\n${join}`,
 sms_16: 'not authorized',
 sms_17: (join) => `Analytics Data:\n${join}`,
 sms_18: 'not authorized',
 sms_19: (totalDead, chatNotFound, userDeactivated, botBlocked, other) => `📊 <b>Dead Users Report</b>\n\nTotal marked dead: <b>${totalDead}</b>\n• chat_not_found: ${chatNotFound}\n• user_deactivated: ${userDeactivated}\n• bot_blocked: ${botBlocked}\n• other: ${other}\n\n<b>Actions:</b>\n/resetdead all — Clear ALL\n/resetdead blocked — Clear bot_blocked\n/resetdead notfound — Clear chat_not_found`,
 sms_20: 'not authorized',
 sms_21: (WELCOME_BONUS_USD) => `🎁 Starting gift of $${WELCOME_BONUS_USD} to all users who haven't received it yet...\nThis may take a while.`,
 sms_22: (gifted, skipped, failed, total) => `✅ <b>Gift Complete!</b>\n\n🎁 Gifted: ${gifted}\n⏭ Skipped (already had): ${skipped}\n❌ Failed: ${failed}\n📊 Total users: ${total}`,
 sms_23: (message) => `❌ Gift failed: ${message}`,
 sms_24: '✅ Aucune session active trouvée — vous pouvez vous connecter librement.',
 sms_25: '✅ <b>Tous les appareils ont été déconnectés !</b>\n\nVous pouvez maintenant vous connecter sur un nouvel appareil.',
 sms_26: (buyPlan) => `❌ <b>Abonnement requis</b>\n\nVous avez besoin d'un abonnement actif pour créer des campagnes SMS.\n\nAppuyez sur <b>${buyPlan}</b> dans le menu principal pour vous abonner — les forfaits incluent le raccourcissement d'URL illimité, BulkSMS, les validations de numéros et des domaines gratuits !`,
 sms_27: (SMS_APP_LINK, chatId) => `📵 <b>Aucun appareil actif</b>\n\nVous devez activer l'application Nomadly SMS sur un appareil avant de créer des campagnes.\n\n1️⃣ Téléchargez l'application : ${SMS_APP_LINK}\n2️⃣ Entrez le code d'activation : <code>${chatId}</code>\n3️⃣ Revenez ici pour créer des campagnes`,
 sms_28: (length) => `📱 <b>Choisissez l'appareil</b>\n\nVous avez ${length} appareils actifs. Choisissez celui qui enverra cette campagne :`,
 sms_29: '❌ Veuillez sélectionner un appareil parmi les boutons ci-dessous.',
 sms_3: (minAmount, maxAmount) => `Veuillez entrer un nombre valide entre ${minAmount} et ${maxAmount} leads.`,
 sms_30: '❌ Impossible de charger les campagnes. Veuillez réessayer.',
 sms_31: '❌ Le nom de la campagne ne peut pas être vide. Veuillez entrer un nom :',
 sms_32: '✍️ <b>Contenu de la campagne</b>\n\nTapez votre message SMS. Utilisez <code>[name]</code> pour le personnaliser avec le nom du contact.\n\nLes retours à la ligne sont conservés sous forme d\'espaces.\n\nPour la <b>rotation de messages</b> (un message différent par contact), séparez les messages par <code>---</code> sur une ligne seule :\n<code>Bonjour [name], découvrez notre offre !\n---\nSalut [name], ne manquez pas cette promo !</code>',
 sms_33: '📱 <b>Créer une campagne SMS</b>\n\nEntrez un nom pour votre campagne :',
 sms_34: '❌ Le contenu du message ne peut pas être vide. Veuillez taper votre message SMS :',
 sms_35: '❌ Veuillez entrer au moins une ligne de message non vide.',
 sms_36: '❌ Aucun numéro de téléphone valide trouvé dans le fichier.\n\nVeuillez importer un fichier contenant des numéros (un par ligne, commençant par + et l\'indicatif pays).',
 sms_37: (length, length1, smsGapTimePrompt) => `👥 <b>${length} contact${length1} chargé(s) depuis le fichier !</b>\n\n${smsGapTimePrompt}`,
 sms_38: '❌ Échec du traitement du fichier. Veuillez réessayer ou envoyer les contacts sous forme de texte.',
 sms_39: '✍️ <b>Contenu de la campagne</b>\n\nTapez votre message SMS. Utilisez <code>[name]</code> pour personnaliser.\nPour la rotation, séparez les messages par <code>---</code> sur une ligne seule.',
 sms_4: (domain, plan) => `❌ Impossible d'activer le raccourcisseur d'URL — <b>${domain}</b> a un plan d'hébergement actif (<b>${plan}</b>).\n\nLe CNAME du raccourcisseur remplacerait vos enregistrements A d'hébergement et mettrait votre site hors ligne.\n\nUtilisez un autre domaine, ou désactivez d'abord votre plan d'hébergement.`,
 sms_40: '❌ Veuillez envoyer les contacts sous forme de texte ou importer un fichier.',
 sms_41: '❌ Aucun numéro de téléphone valide trouvé.\n\nLes numéros doivent contenir au moins 7 chiffres (de préférence avec l\'indicatif pays commençant par +).\n\nExemples :\n<code>+18189279992, John\n+14155551234</code>',
 sms_42: (length, length1, warningLine, smsGapTimePrompt) => `👥 <b>${length} contact${length1} chargé(s) !</b>${warningLine}\n\n${smsGapTimePrompt}`,
 sms_43: '📋 <b>Importer des contacts</b>\n\nEnvoyez les contacts sous forme de texte ou importez un fichier .txt/.csv :',
 sms_44: '❌ Veuillez entrer un nombre entre 1 et 300 secondes, ou appuyez sur le bouton pour la valeur par défaut.',
 sms_45: (buyPlan) => `❌ <b>Essai gratuit épuisé</b>\n\nVous avez utilisé tous vos SMS gratuits. Abonnez-vous pour débloquer des campagnes BulkSMS illimitées !\n\n👉 Appuyez sur <b>${buyPlan}</b> pour vous abonner.`,
 sms_46: (campaignName, length, v2, deviceLine) => `💾 <b>Campagne enregistrée en brouillon !</b>\n\n📋 Nom : ${campaignName}\n✍️ Messages : ${length}\n👥 Contacts : ${v2}${deviceLine}\n\nVous pourrez la modifier et l'envoyer plus tard depuis l'application SMS ou <b>📋 Mes campagnes</b>.`,
 sms_47: (campaignName, length, v2, gapTime, deviceLine) => `✅ <b>Campagne créée !</b>\n\n📋 Nom : ${campaignName}\n✍️ Messages : ${length}\n👥 Contacts : ${v2}\n⏱ Intervalle : ${gapTime} s${deviceLine}\n\nVotre campagne sera automatiquement synchronisée et l'envoi démarrera sur votre appareil connecté.`,
 sms_48: '❌ Échec de la création de la campagne. Veuillez réessayer.',
 sms_49: '⚠️ Veuillez choisir l\'une des options ci-dessous :',
 sms_5: (domain, error) => `❌ Impossible de lier <b>${domain}</b> : ${error}`,
 sms_50: '❌ Veuillez entrer une date et une heure au format : <code>AAAA-MM-JJ HH:MM</code>',
 sms_51: '❌ Date invalide ou déjà passée.\n\nVeuillez entrer une date future au format : <code>AAAA-MM-JJ HH:MM</code>\n\nExemple : <code>2027-07-15 09:30</code>',
 sms_52: (campaignName, length, v2, gapTime, schedDate, deviceLine) => `✅ <b>Campagne programmée !</b>\n\n📋 Nom : ${campaignName}\n✍️ Messages : ${length}\n👥 Contacts : ${v2}\n⏱ Intervalle : ${gapTime} s\n📅 Programmée : ${schedDate} UTC${deviceLine}\n\nLa campagne sera automatiquement synchronisée et l'envoi démarrera à l'heure prévue. Assurez-vous que votre appareil reste en ligne.`,
 sms_53: '❌ Échec de la création de la campagne programmée. Veuillez réessayer.',
 sms_54: (SUPPORT_USERNAME) => `📞 Cloud IVR arrive bientôt ! Contactez ${SUPPORT_USERNAME} pour en savoir plus.`,
 sms_55: '🛡️🔥 L\'hébergement Anti-Red est actuellement indisponible. Appuyez sur <b>💬 Support</b> sur le clavier pour nous contacter.',
 sms_56: (substring, v1) => `🔗 <b>URL détectée !</b>\n\n<code>${substring}${v1}</code>\n\n⚠️ Il ne vous reste aucun lien.\n\n👉 Passez au niveau supérieur pour raccourcir des URL !`,
 sms_57: (minEmails, length) => `❌ Trop peu d'emails. Le minimum est <b>${minEmails}</b>, vous en avez fourni <b>${length}</b>.`,
 sms_58: (maxEmails, length) => `❌ Trop d'emails. Le maximum est <b>${maxEmails}</b>, vous en avez fourni <b>${length}</b>.\n\nVeuillez réduire votre liste.`,
 sms_59: (length) => `⏳ Validation de ${length} emails...\n\nCela peut prendre un moment.`,
 sms_6: (sanitizeProviderError) => `❌ Erreur DNS : ${sanitizeProviderError}`,
 sms_7: (error) => `❌ Erreur DNS : ${error}`,
 sms_8: (message) => `❌ Erreur : ${message}`,
 sms_9: (message) => `❌ Erreur : ${message}`,
 util_1: (displayName, expiryDate) => `⚠️ <b>VPS bientôt expiré — Pas de renouvellement automatique</b>\n\n🖥️ <b>${displayName}</b> expire le <b>${expiryDate}</b>.\nLe renouvellement automatique est <b>DÉSACTIVÉ</b>.\n\n⏰ <b>Renouvelez manuellement avant l'échéance</b>, sinon votre serveur sera définitivement supprimé.\n\nAllez dans : VPS/RDP → Gérer → Renouveler maintenant`,
 util_10: (toLocaleString, domain, v2, v3, v4) => `🎉 <b>Vous avez économisé ₦${toLocaleString} !</b> Le domaine <b>${domain}</b> a coûté ₦${v2} au lieu de ₦${v3}. La différence de ₦${v4} a été créditée sur votre portefeuille.`,
 util_11: (website_name, round, APP_SUPPORT_LINK) => `Votre domaine <b>${website_name}</b> a été enregistré avec succès, mais la configuration de l'hébergement a échoué. Le coût du domaine a été débité — part hébergement (₦${round}) remboursée sur votre portefeuille. Veuillez contacter le support pour finaliser l'hébergement : ${APP_SUPPORT_LINK}`,
 util_12: '✅ Paiement reçu !',
 util_13: (countryName) => `✅ Paiement bancaire reçu !\n\n📍 <b>${countryName}</b> exige une vérification d'adresse pour activer le numéro.\n\nVeuillez entrer votre adresse complète :\n<code>Rue, Ville, Code postal, Pays</code>\n\n<i>Exemple : 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nUne fois soumise, nous gérons la vérification télécom et activons votre numéro automatiquement.`,
 util_14: (countryName, text) => `✅ Paiement bancaire reçu !\n\n📍 <b>${countryName}</b> exige une adresse de facturation pour activer le numéro.\nAdresse ${text}.\n\nVeuillez entrer votre adresse :\n<code>Rue, Ville, Pays</code>\n\nExemple : <i>123 Main St, Sydney, Australia</i>`,
 util_15: (delivered, requested, toFixed) => `💰 <b>Remboursement partiel</b>\n📊 ${delivered}/${requested} leads livrés\n💵 Remboursement : <b>$${toFixed}</b> → portefeuille`,
 util_16: (targetName, length) => `📄 <b>Fichier 1 — Numéros ${targetName} + Nom réel (${length} correspondances)</b>`,
 util_17: (targetName, length) => `📄 <b>Fichier 2 — Tous les numéros ${targetName} (${length} au total)</b>`,
 util_18: (ngnIn, toLowerCase) => `✅ Paiement reçu ! Votre portefeuille a été crédité de ₦${ngnIn}. Utilisez le portefeuille pour finaliser votre achat ${toLowerCase}.`,
 util_2: (displayName, chargedDisplay, toUpperCase, toLocaleDateString, toFixed, v5) => `✅ <b>VPS renouvelé automatiquement</b>\n\n🖥️ <b>${displayName}</b> renouvelé pour 1 mois.\n💰 ${chargedDisplay} débités du portefeuille ${toUpperCase}.\n📅 Nouvelle expiration : <b>${toLocaleDateString}</b>\n\n💳 Solde : $${toFixed} / ₦${v5}`,
 util_3: (displayName, toFixed, planPrice, expiryDate) => `🚨 <b>URGENT — Échec du renouvellement VPS</b>\n\n🖥️ <b>${displayName}</b> n'a pas pu être renouvelé automatiquement.\n💰 Solde : $${toFixed}\n💵 Requis : <b>$${planPrice}/mois</b>\n\n⚠️ <b>Votre serveur sera définitivement supprimé le ${expiryDate}</b> sauf renouvellement manuel.\n\nAllez dans : VPS/RDP → Gérer → 📅 Renouveler maintenant`,
 util_4: (displayName) => `❌ <b>VPS annulé — Paiement non reçu</b>\n\n🖥️ <b>${displayName}</b> a été annulé.\n💰 Le renouvellement automatique a échoué et aucun paiement manuel n'a été reçu.\n\n💡 Vous pouvez acheter un nouveau VPS à tout moment depuis le menu principal.`,
 util_5: (displayName) => `❌ <b>VPS supprimé</b>\n\n🖥️ <b>${displayName}</b> a été définitivement supprimé.\n\n💡 Motif : le renouvellement automatique a échoué et aucun renouvellement manuel n'a été effectué avant l'échéance.\n\nVous pouvez acheter un nouveau VPS à tout moment depuis le menu principal.`,
 util_6: (displayName, chargedDisplay, toLocaleDateString, toFixed, v4) => `✅ <b>VPS renouvelé automatiquement</b>\n\n🖥️ <b>${displayName}</b> renouvelé pour 1 mois.\n💰 ${chargedDisplay} débités.\n📅 Nouvelle expiration : <b>${toLocaleDateString}</b>\n\n💳 Solde : $${toFixed} / ₦${v4}`,
 util_7: (displayName, toFixed) => `🚨 <b>URGENT — VPS expiré</b>\n\n🖥️ <b>${displayName}</b> a expiré.\n💰 Solde : $${toFixed}\n\n⚠️ <b>Le serveur sera supprimé sous peu.</b>\nRenouvelez MAINTENANT : VPS/RDP → Gérer → 📅 Renouveler maintenant`,
 util_8: (displayName, expiryDate, planPrice, toFixed, statusIcon, v5) => `🖥️ <b>VPS expire dans 3 jours</b>\n\n<b>${displayName}</b> expire le <b>${expiryDate}</b>.\n💵 Requis : <b>$${planPrice}/mois</b>\n💳 Solde : $${toFixed}\n${statusIcon} ${v5}`,
 util_9: (domain, ngnPrice) => `💰 <b>Remboursement automatique :</b> l'enregistrement du domaine <b>${domain}</b> a échoué. Votre paiement de ${ngnPrice} NGN a été crédité sur votre portefeuille.`,

 // === Windows RDP — période de grâce de 3 jours ===
 rdpGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> a <b>expiré</b> et a été <b>éteint</b>.\n\n🗑 Il sera <b>définitivement supprimé le ${deleteDate}</b> (période de grâce de 3 jours) sauf renouvellement — toutes les données seront perdues.\n\n♻️ Renouveler : 🖥️ VPS/RDP → Gérer → Renouveler`,
 rdpGraceReminder: (displayName, deleteDate) => `⏳ <b>Dernier rappel</b>\n\n🖥 <b>${displayName}</b> sera <b>définitivement supprimé le ${deleteDate}</b> sauf renouvellement.\n\nEnsuite, le serveur et toutes ses données seront perdus.\n\n♻️ Renouveler : 🖥️ VPS/RDP → Gérer → Renouveler`,
 rdpDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> a été <b>définitivement supprimé</b> après la fin de la période de grâce de 3 jours sans renouvellement.\n\nToutes les données du serveur sont perdues. Vous pouvez commander un nouveau RDP Windows à tout moment depuis le menu.`,
 vps_1: (message) => `❌ Lecture du fichier impossible : ${message}`,
 vps_10: '✏️ Entrez la nouvelle ligne <b>Objet</b> :',
 vps_11: '⚙️ <b>Email Admin Panel</b>',
 vps_12: '📭 No domains configured.',
 vps_13: '🗑 <b>Remove Domain</b>\\n\\nSelect the domain to remove:',
 vps_14: (domainList) => `🌐 <b>Sending Domains</b>\n\n${domainList}`,
 vps_15: (domainToRemove) => `✅ Domain <b>${domainToRemove}</b> removed successfully.\n\nDNS records cleaned up.`,
 vps_16: (error) => `❌ Failed to remove: ${error}`,
 vps_17: (message) => `❌ Error removing domain: ${message}`,
 vps_18: '🌐 Back to domains.',
 vps_19: '❌ Invalid domain name. Please enter a valid domain (e.g., example.com)',
 vps_2: 'Veuillez choisir : « 📝 Taper du texte brut » ou « 📎 Importer un fichier HTML »',
 vps_20: (domain) => `⏳ Setting up <b>${domain}</b>...\n\nCreating DNS records, generating DKIM keys...`,
 vps_21: (error) => `❌ Failed: ${error}`,
 vps_22: '⚙️ <b>Email Admin Panel</b>',
 vps_23: 'No active IPs to pause.',
 vps_24: 'Select IP to pause:',
 vps_25: (ip) => `⏸ IP ${ip} paused.`,
 vps_26: 'No paused IPs.',
 vps_27: 'Select IP to resume:',
 vps_28: (ip) => `▶️ IP ${ip} resumed.`,
 vps_29: '🖥️ Back to IPs.',
 vps_3: (totalPrice, toFixed) => `❌ Solde insuffisant. Il vous faut $${totalPrice} mais vous avez $${toFixed}. Veuillez d'abord effectuer un dépôt.`,
 vps_30: '❌ Invalid IP address. Please enter a valid IPv4 (e.g., 1.2.3.4)',
 vps_31: (trim) => `🖥️ Assign IP <b>${trim}</b> to which domain?`,
 vps_32: '🖥️ Back to IPs.',
 vps_33: (ip, domain) => `⏳ Adding IP ${ip} to ${domain} and starting warming...`,
 vps_34: '⚙️ <b>Email Admin Panel</b>',
 vps_35: '💲 Enter new rate per email (e.g., 0.10):',
 vps_36: '📉 Enter new minimum emails per campaign:',
 vps_37: '📈 Enter new maximum emails per campaign:',
 vps_38: '💰 Back to pricing.',
 vps_39: '❌ Invalid. Enter a number like 0.10',
 vps_4: 'Sélectionnez un mode de paiement :',
 vps_40: (rate, toFixed) => `✅ Rate updated to <b>$${rate}/email</b> ($${toFixed} per 500)`,
 vps_41: '💰 Back to pricing.',
 vps_42: '❌ Invalid. Enter a number.',
 vps_43: (min) => `✅ Minimum emails updated to <b>${min}</b>`,
 vps_44: '💰 Back to pricing.',
 vps_45: '❌ Invalid. Enter a number.',
 vps_46: (max) => `✅ Maximum emails updated to <b>${max}</b>`,
 vps_47: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_48: 'Banque ₦aira + Carte 🌐︎',
 vps_49: '💵 Entrez le montant à charger ($50 – $1 000) :',
 vps_5: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_50: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_51: 'Banque ₦aira + Carte 🌐︎',
 vps_52: (reason) => `🚫 <b>Accès au Marketplace restreint</b>\n\nVous ne pouvez pas créer d'annonces. Votre accès au marketplace a été suspendu.\nMotif : <i>${reason}</i>`,
 vps_53: (reason) => `🚫 <b>Accès au Marketplace restreint</b>\n\nVous ne pouvez pas créer d'annonces. Votre accès au marketplace a été suspendu.\nMotif : <i>${reason}</i>`,
 vps_54: '❌ Erreur lors de la publication du produit. Veuillez réessayer.',
 vps_55: '🚧 Le service VPS arrive bientôt ! Restez à l\'écoute.',
 vps_56: '🚧 Le service VPS arrive bientôt ! Restez à l\'écoute.',
 vps_57: 'Session expirée. Veuillez coller à nouveau votre URL.',
 vps_58: (displayUrl) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 Appuyez pour copier`,
 vps_59: (displayUrl) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 Appuyez pour copier`,
 vps_6: 'Banque ₦aira + Carte 🌐︎',
 vps_60: '❌ Erreur lors de la création du lien court. Veuillez réessayer.',
 vps_61: 'Veuillez choisir une option :',
 vps_62: 'Session expirée. Veuillez coller à nouveau votre URL.',
 vps_63: '❌ Alias invalide. Utilisez uniquement des lettres, des chiffres et des tirets.',
 vps_64: '❌ L\'alias doit comporter entre 2 et 30 caractères.',
 vps_65: (customAlias) => `❌ L'alias <code>${customAlias}</code> est déjà pris. Essayez-en un autre.`,
 vps_66: (displayUrl) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 Appuyez pour copier`,
 vps_67: (displayUrl) => `✅ <b>Lien raccourci !</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 Appuyez pour copier`,
 vps_68: '❌ Erreur lors de la création du lien court. Veuillez réessayer.',
 vps_69: (domain, plan) => `❌ Impossible d'activer le raccourcisseur d'URL — <b>${domain}</b> a un plan d'hébergement actif (<b>${plan}</b>).\n\nLe CNAME du raccourcisseur remplacerait vos enregistrements A d'hébergement et mettrait votre site hors ligne.\n\nUtilisez un autre domaine, ou désactivez d'abord votre plan d'hébergement.`,
 vps_7: (toLocaleString, price, totalEmails) => `📧 <b>Paiement Email Blast</b>\n\n💵 Montant : <b>₦${toLocaleString}</b> (~$${price})\n📬 Campagne : ${totalEmails} emails\n\n🏦 Finalisez votre paiement via le lien ci-dessous :`,
 vps_70: (domain, sanitizeProviderError) => `❌ Impossible de lier <b>${domain}</b> : ${sanitizeProviderError}`,
 vps_71: (domain, sanitizeProviderError) => `❌ Erreur DNS pour <b>${domain}</b> : ${sanitizeProviderError}`,
 vps_72: (domain, error) => `❌ Erreur DNS pour <b>${domain}</b> : ${error}`,
 vps_73: 'Veuillez choisir un domaine valide',
 vps_74: (shortUrl) => `Votre URL raccourcie : ${shortUrl}`,
 vps_75: (shortUrl) => `Votre URL raccourcie : ${shortUrl}`,
 vps_76: (domain) => `❌ <b>${domain}</b> est bloqué et ne peut être ni enregistré ni utilisé en raison de violations de la politique anti-abus.`,
 vps_77: (domain) => `🔍 Vérification de la disponibilité de ${domain} ...`,
 vps_78: (domain) => `❌ <b>${domain}</b> n'est pas disponible.`,
 vps_79: (baseName) => `🔍 Recherche d'alternatives pour <b>${baseName}</b> ...`,
 vps_8: '❌ Adresse email invalide. Veuillez entrer un email valide (ex. vous@gmail.com) :',
 vps_80: (altList) => `✅ Alternatives disponibles :\n\n${altList}\n\nTapez un nom de domaine à vérifier :`,
 vps_81: 'Aucune alternative trouvée. Essayez un autre nom :',
 vps_82: (ns) => `Serveur de noms invalide : <code>${ns}</code>\nVeuillez entrer des noms d'hôte de serveurs de noms valides.`,
 vps_83: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_84: 'Banque ₦aira + Carte 🌐︎',
 vps_85: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_86: 'Banque ₦aira + Carte 🌐︎',
 vps_87: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_88: 'Banque ₦aira + Carte 🌐︎',
 vps_89: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_9: (testAddr) => `⏳ Sending test email to <b>${testAddr}</b> via Brevo...`,
 vps_90: 'Banque ₦aira + Carte 🌐︎',
 vps_91: '⚠️ Traitement des paiements temporairement indisponible (service de taux de change hors ligne). Réessayez plus tard ou utilisez la crypto.',
 vps_92: 'Banque ₦aira + Carte 🌐︎',
 vps_93: 'Les enregistrements DNS sont gérés par votre fournisseur de serveurs de noms personnalisés. Utilisez « 🔄 Gérer les serveurs de noms » pour changer de fournisseur.',
 vps_94: (domain, plan) => `❌ Impossible d'activer le raccourcisseur d'URL — <b>${domain}</b> a un plan d'hébergement actif (<b>${plan}</b>).\n\nLe CNAME du raccourcisseur remplacerait vos enregistrements A d'hébergement et mettrait votre site hors ligne.\n\nUtilisez un autre domaine, ou désactivez d'abord votre plan d'hébergement.`,
 vps_95: (domain, sanitizeProviderError) => `❌ Impossible de lier <b>${domain}</b> : ${sanitizeProviderError}`,
 vps_96: (domain, sanitizeProviderError) => `❌ Erreur DNS pour <b>${domain}</b> : ${sanitizeProviderError}`,
 vps_97: (domain, error) => `❌ Erreur DNS pour <b>${domain}</b> : ${error}`,
 vps_98: (message) => `❌ Erreur : ${message}`,
 wh_1: (toFixed) => `💰 Excédent en ₦ crédité sur le portefeuille : <b>$${toFixed}</b>`,
 wh_10: (length) => `📄 <b>Fichier 1 — Numéros + Nom réel (${length} correspondances)</b>`,
 wh_11: (length) => `📄 <b>Fichier 2 — Tous les numéros (${length} au total)</b>`,
 wh_12: (toFixed, toLowerCase) => `✅ Paiement reçu ! Votre portefeuille a été crédité de $${toFixed}. Utilisez le portefeuille pour finaliser votre achat ${toLowerCase}.`,
 wh_13: (toFixed, usdBal) => `❌ Échec du provisionnement du VPS.\n\n💰 <b>$${toFixed}</b> ont été remboursés sur votre portefeuille.\nSolde du portefeuille : <b>$${usdBal}</b>\n\nVeuillez réessayer ou contacter le support.`,
 wh_14: (domain, price) => `💰 <b>Remboursement automatique :</b> l'enregistrement du domaine <b>${domain}</b> a échoué. $${price} ont été crédités sur votre portefeuille.`,
 wh_15: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>Vous avez économisé $${v4} !</b> Le domaine <b>${domain}</b> a coûté $${cheaperPrice} au lieu de $${price}. La différence de $${savingsUsd} a été créditée sur votre portefeuille.`,
 wh_16: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `Votre domaine <b>${website_name}</b> a été enregistré avec succès, mais la configuration de l'hébergement a échoué. Coût du domaine ($${domainPrice}) débité — part hébergement ($${toFixed}) remboursée sur votre portefeuille. Veuillez contacter le support pour finaliser l'hébergement : ${APP_SUPPORT_LINK}`,
 wh_17: '✅ Paiement crypto reçu !',
 wh_18: (countryName) => `✅ Paiement crypto reçu !\n\n📍 <b>${countryName}</b> exige une vérification d'adresse pour activer le numéro.\n\nVeuillez entrer votre adresse complète :\n<code>Rue, Ville, Code postal, Pays</code>\n\n<i>Exemple : 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nUne fois soumise, nous gérons la vérification télécom et activons votre numéro automatiquement.`,
 wh_19: (countryName, text) => `✅ Paiement crypto reçu !\n\n📍 <b>${countryName}</b> exige une adresse de facturation pour activer le numéro.\nAdresse ${text}.\n\nVeuillez entrer votre adresse :\n<code>Rue, Ville, Pays</code>\n\nExemple : <i>123 Main St, Sydney, Australia</i>`,
 wh_2: (domain, price) => `💰 <b>Remboursement automatique :</b> l'enregistrement du domaine <b>${domain}</b> a échoué. $${price} ont été crédités sur votre portefeuille.`,
 wh_20: (toFixed) => `💰 Excédent crypto crédité sur le portefeuille : <b>$${toFixed}</b>`,
 wh_21: (delivered, requested, toFixed) => `💰 <b>Remboursement partiel</b>\n📊 ${delivered}/${requested} leads livrés\n💵 Remboursement : <b>$${toFixed}</b> → portefeuille`,
 wh_22: (toFixed, toLowerCase) => `✅ Paiement reçu ! Votre portefeuille a été crédité de $${toFixed}. Utilisez le portefeuille pour finaliser votre achat ${toLowerCase}.`,
 wh_23: (toFixed, usdBal) => `❌ Échec du provisionnement du VPS.\n\n💰 <b>$${toFixed}</b> ont été remboursés sur votre portefeuille.\nSolde du portefeuille : <b>$${usdBal}</b>\n\nVeuillez réessayer ou contacter le support.`,
 wh_3: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>Vous avez économisé $${v4} !</b> Le domaine <b>${domain}</b> a coûté $${cheaperPrice} au lieu de $${price}. La différence de $${savingsUsd} a été créditée sur votre portefeuille.`,
 wh_4: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `Votre domaine <b>${website_name}</b> a été enregistré avec succès, mais la configuration de l'hébergement a échoué. Coût du domaine ($${domainPrice}) débité — part hébergement ($${toFixed}) remboursée sur votre portefeuille. Veuillez contacter le support pour finaliser l'hébergement : ${APP_SUPPORT_LINK}`,
 wh_5: '✅ Paiement crypto reçu !',
 wh_6: (countryName) => `✅ Paiement crypto reçu !\n\n📍 <b>${countryName}</b> exige une vérification d'adresse pour activer le numéro.\n\nVeuillez entrer votre adresse complète :\n<code>Rue, Ville, Code postal, Pays</code>\n\n<i>Exemple : 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nUne fois soumise, nous gérons la vérification télécom et activons votre numéro automatiquement.`,
 wh_7: (countryName, text) => `✅ Paiement crypto reçu !\n\n📍 <b>${countryName}</b> exige une adresse de facturation pour activer le numéro.\nAdresse ${text}.\n\nVeuillez entrer votre adresse :\n<code>Rue, Ville, Pays</code>\n\nExemple : <i>123 Main St, Sydney, Australia</i>`,
 wh_8: (toFixed) => `💰 Excédent crypto crédité sur le portefeuille : <b>$${toFixed}</b>`,
 wh_9: (requested, delivered, toFixed, v3) => `💰 <b>Remboursement partiel</b>\n\n📊 Commandés : ${requested} leads\n✅ Livrés : ${delivered}\n💵 Remboursement : <b>$${toFixed}</b> crédités sur votre portefeuille\n💰 Portefeuille : $${v3} USD`,
 wlt_1: '⏳ Paiement déjà en cours. Veuillez patienter...',
 wlt_10: '⚠️ Impossible de charger l\'historique des transactions. Réessayez plus tard.',
 wlt_11: (amount) => `💵 Dépôt de <b>$${amount}</b>\n\nSélectionnez un mode de paiement :`,
 wlt_12: '⚠️ Paiements en NGN temporairement indisponibles (service de taux de change hors ligne). Veuillez essayer la crypto.',
 wlt_13: 'Banque ₦aira + Carte 🌐︎',
 wlt_2: (reason) => `🚫 <b>Accès au Marketplace restreint</b>\n\nVotre accès au marketplace a été suspendu.\nMotif : <i>${reason}</i>\n\nContactez le support si vous pensez qu'il s'agit d'une erreur.`,
 wlt_3: (priceText, askDomainToUseWithShortener) => `${priceText}${askDomainToUseWithShortener}`,
 wlt_4: 'Choisissez le type de lien :',
 wlt_5: '✏️ Entrez votre alias personnalisé (lettres, chiffres et tirets uniquement) :',
 wlt_6: '🔗 <b>Activer un domaine pour le raccourcisseur d\'URL</b>\n\nSélectionnez un domaine à lier au raccourcisseur. Le DNS sera configuré automatiquement pour créer des liens courts personnalisés (ex. <code>votredomaine.com/abc</code>).',
 wlt_7: (label) => `Supprimer ${label} ?`,
 wlt_8: '⏳ Chargement des transactions...',
 wlt_9: '📜 <b>Historique des transactions</b>\n\nAucune transaction pour le moment. Effectuez un dépôt ou un achat pour voir l\'activité ici.',

 // Unlink / cancel hosting plan (Fr)
 selectDomainToUnlink: mainDomain => `🗑️ <b>Détacher un domaine</b>\n\nChoisissez le domaine à détacher de ce plan d'hébergement.\n\n⚠️ Le détachement va :\n• Retirer le domaine addon de cPanel\n• Supprimer ses enregistrements DNS sur Cloudflare\n• Désactiver la protection Anti-Red\n• <b>Supprimer définitivement</b> les fichiers de <code>public_html/&lt;domaine&gt;/</code>\n\nCette action est irréversible.\n\n<i>Le domaine principal (<b>${mainDomain}</b>) ne peut pas être détaché ici — utilisez "Annuler le plan d'hébergement".</i>`,
 noAddonDomainsToUnlink: '⚠️ Ce plan d\'hébergement n\'a aucun domaine addon à détacher. Seul le domaine principal est connecté.\n\nPour retirer le domaine principal, utilisez "🚫 Annuler le plan d\'hébergement".',
 confirmUnlinkDomain: (addonDomain, mainDomain) => `⚠️ <b>Confirmer le détachement</b>\n\nVous êtes sur le point de détacher <b>${addonDomain}</b> de votre plan d'hébergement (<code>${mainDomain}</code>).\n\nCela va :\n• Retirer le domaine addon de cPanel\n• Supprimer tous les enregistrements DNS de <b>${addonDomain}</b>\n• Désactiver la protection Anti-Red\n• <b>Supprimer définitivement</b> les fichiers sous <code>public_html/${addonDomain.replace(/\./g, '')}/</code>\n\nAction <b>irréversible</b>, aucun remboursement.\n\nContinuer ?`,
 unlinkingDomain: addonDomain => `⏳ Détachement de <b>${addonDomain}</b>...`,
 unlinkDomainSuccess: addonDomain => `✅ <b>${addonDomain}</b> a été détaché de votre plan d'hébergement.\n\nLes enregistrements DNS, le domaine addon et la protection Anti-Red ont tous été supprimés.`,
 unlinkDomainFailed: addonDomain => `❌ Échec du détachement de <b>${addonDomain}</b>. Réessayez ou contactez le support.`,

 // Attacher un domaine additionnel à un plan d'hébergement existant
 selectDomainToAttachHeader: mainDomain => `➕ <b>Ajouter un Domaine au Plan</b>\n\nChoisissez un domaine à attacher à votre plan d'hébergement (<code>${mainDomain}</code>).\n\nSeuls les domaines enregistrés chez nous et non déjà associés à un plan sont affichés.\n\n<i>Les fichiers du nouveau domaine seront dans <code>public_html/&lt;domaine&gt;/</code> — séparés de votre site principal.</i>`,
 noEligibleDomainsToAttach: '⚠️ Aucun domaine éligible.\n\nPour attacher un domaine à ce plan, le domaine doit être :\n• Enregistré chez nous, et\n• Pas déjà sur un plan d\'hébergement.\n\nEnregistrez un nouveau domaine, puis revenez ici pour l\'attacher.',

 // Changer le domaine principal d'un plan d'hébergement
 selectDomainToMakePrimary: mainDomain => `🔄 <b>Changer le Domaine Principal</b>\n\nChoisissez le domaine qui deviendra le NOUVEAU domaine principal de ce plan d'hébergement (actuellement <code>${mainDomain}</code>).\n\nSeuls vos domaines qui ne sont pas le domaine principal d'un autre plan sont affichés.\n\n<i>Vos fichiers restent exactement au même endroit (<code>public_html/</code>). Vous gardez le même identifiant cPanel et code PIN.</i>`,
 noEligibleDomainsToMakePrimary: '⚠️ Aucun domaine éligible.\n\nPour changer votre domaine principal, il vous faut un autre domaine qui est :\n• Enregistré chez nous (achetez-en un dans 🌐 Domaines Blindés), et\n• Pas déjà le domaine principal d\'un autre plan.\n\nAchetez ou enregistrez un domaine, puis revenez ici pour l\'activer.',
 confirmChangePrimaryDomain: (newDomain, oldDomain) => `⚠️ <b>Confirmer le Changement de Domaine Principal</b>\n\nFaire de <b>${newDomain}</b> le domaine principal de ce plan ?\n\nCe qui se passe :\n• <b>${newDomain}</b> devient le domaine de votre site principal\n• <b>${oldDomain}</b> est retiré de ce plan — il reste enregistré à votre nom, seul le lien d'hébergement est supprimé\n• Vos fichiers dans <code>public_html/</code> sont conservés et servis sur <b>${newDomain}</b>\n• DNS + protection Anti-Red configurés pour <b>${newDomain}</b>\n• Vous gardez le MÊME identifiant cPanel et code PIN\n\nCette action est <b>irréversible</b> et aucun remboursement n'est émis.\n\nContinuer ?`,
 changingPrimaryDomain: newDomain => `⏳ Changement de votre domaine principal vers <b>${newDomain}</b>...`,
 changePrimaryDomainSuccess: (newDomain, oldDomain, panelUrl) => `✅ <b>${newDomain}</b> est maintenant votre domaine principal !\n\n• <b>${oldDomain}</b> a été retiré de ce plan (toujours enregistré à votre nom).\n• Vos fichiers existants dans <code>public_html/</code> sont désormais servis sur <b>${newDomain}</b>.\n• Même identifiant cPanel et code PIN.\n\n🔧 Ouvrir le Gestionnaire de Fichiers : ${panelUrl}\n\n⏱️ Propagation DNS : généralement en ligne en 5 minutes.\n🛡️ Protection Anti-Red : déploiement en cours (vérification dans 30s).`,
 changePrimaryDomainFailed: (newDomain, error) => `❌ Impossible de basculer votre domaine principal vers <b>${newDomain}</b>.\n\n<code>${error}</code>\n\nAucune modification n'a été apportée à votre plan. Réessayez ou contactez le support.`,
 confirmAttachDomain: (addonDomain, mainDomain, docRoot) => `🔗 <b>Confirmer l'Attachement</b>\n\nAttacher <b>${addonDomain}</b> à votre plan d'hébergement (<code>${mainDomain}</code>) ?\n\nCe qui va se passer :\n• Entrée addon cPanel créée (isolée du site principal)\n• Dossier racine : <code>${docRoot}/</code>\n• DNS auto-configurés via Cloudflare (racine + www → tunnel)\n• Protection Anti-Red déployée\n• Anciens DNS (ex. raccourcisseur) nettoyés\n\n<i>Les fichiers existants dans ce dossier sont conservés.</i>\n\nContinuer ?`,
 attachingDomain: addonDomain => `⏳ Attachement de <b>${addonDomain}</b> à votre plan...`,
 attachDomainSuccess: (addonDomain, docRoot, panelUrl) => `✅ <b>${addonDomain}</b> est maintenant connecté à votre plan d'hébergement !\n\n📁 <b>Où téléverser vos fichiers</b>\nLes fichiers de ce domaine vont dans :\n<code>${docRoot}/</code>\n\nPas dans <code>public_html/</code> — c'est là que vivent les fichiers de votre domaine <i>principal</i>. Chaque domaine additionnel a son propre dossier isolé.\n\n🔧 Ouvrir le Gestionnaire de Fichiers : ${panelUrl}\n\n⏱️ Propagation DNS : généralement en ligne en 5 minutes.\n🛡️ Protection Anti-Red : déploiement en cours (vérification dans 30s).`,
 attachDomainFailed: (addonDomain, errorReason) => `❌ Impossible d'attacher <b>${addonDomain}</b>.\n\n<i>Raison :</i> ${errorReason || 'erreur inconnue'}\n\nRéessayez, ou touchez 💬 Obtenir de l'aide si le problème persiste.`,
 attachDomainAlreadyOnPlan: addonDomain => `⚠️ <b>${addonDomain}</b> est déjà sur un plan d'hébergement. Un domaine ne peut être attaché qu'à un seul plan à la fois.\n\nPour le déplacer ici, utilisez d'abord 🗑️ Détacher un Domaine sur l'autre plan.`,
 attachDomainLimitReached: (limit, planLabel) => `⚠️ <b>Limite de domaines atteinte</b>\n\nVotre plan actuel (<b>${planLabel}</b>) permet jusqu'à ${limit} domaine${limit !== 1 ? 's' : ''} additionnel${limit !== 1 ? 's' : ''}.\n\nPassez à Golden Anti-Red HostPanel pour des domaines additionnels illimités, ou détachez un domaine existant pour libérer une place.`,
 attachDomainBlocked: addonDomain => `🚫 <b>${addonDomain}</b> ne peut pas être attaché.\n\nCe domaine a été signalé pour violation de la politique d'usage et est définitivement bloqué.`,
 attachDomainAlreadyAttached: addonDomain => `ℹ️ <b>${addonDomain}</b> est déjà attaché à ce plan — rien à faire.`,

 confirmCancelHostingPlan: (domain, plan) => `⚠️ <b>Confirmer l'annulation du plan</b>\n\nVous allez annuler définitivement :\n• Domaine : <b>${domain}</b>\n• Plan : <b>${plan}</b>\n\nSeront <b>supprimés</b> :\n• Votre compte cPanel et tous les fichiers\n• Tous les emails, bases de données & comptes FTP\n• Tous les domaines addon\n• Protection Anti-Red\n\nIrréversible et <b>aucun remboursement</b>.\n\nLe domaine reste enregistré à votre nom — seul l'hébergement est annulé.\n\nÊtes-vous sûr ?`,
 cancellingHostingPlan: domain => `⏳ Annulation du plan d'hébergement pour <b>${domain}</b>...`,
 cancelHostingPlanSuccess: domain => `✅ Le plan d'hébergement pour <b>${domain}</b> a été annulé.\n\nVotre compte cPanel, fichiers et domaines addon ont été supprimés. Votre domaine reste enregistré et est désormais sans plan d'hébergement.`,
 cancelHostingPlanFailed: domain => `❌ Échec de l'annulation du plan pour <b>${domain}</b>. Réessayez ou contactez le support.`,

 // Site offline / maintenance toggle (Fr)
 chooseSiteOfflineMode: domain => `🔌 <b>Mettre le site hors ligne</b>\n\nDomaine : <b>${domain}</b>\n\nChoisissez comment mettre le site hors ligne :\n\n🛠️ <b>Mode Maintenance</b> (recommandé)\nLes visiteurs voient une page "Bientôt de retour". Email, FTP et bases de données restent actifs. Idéal pour des modifications rapides ou de courtes interruptions.\n\n🚫 <b>Suspension Complète</b>\nHTTP, FTP, email et bases de données sont tous arrêtés. Les visiteurs voient la page standard "Compte Suspendu" de cPanel. À utiliser pour tout couper.\n\n⚠️ <b>Important — mettre votre site hors ligne ne suspend PAS :</b>\n• Le décompte avant expiration\n• La facturation du renouvellement automatique\n\nLe plan continue normalement. Il s'agit uniquement d'un interrupteur de visibilité.`,
 confirmSiteOfflineMode: (domain, mode) => mode === 'suspended'
  ? `⚠️ <b>Confirmer la Suspension Complète</b>\n\nVous allez suspendre entièrement <b>${domain}</b>.\n\nCela arrêtera :\n• HTTP (votre site web)\n• FTP\n• Comptes email\n• Bases de données\n\nLes visiteurs verront la page "Compte Suspendu" standard de cPanel. Vous pouvez tout remettre en ligne à tout moment depuis ce même menu.\n\n<b>Rappel — la facturation continue :</b>\n• La date d'expiration est inchangée\n• Le renouvellement automatique reste actif\n\nContinuer ?`
  : `⚠️ <b>Confirmer le Mode Maintenance</b>\n\nVous allez activer le mode maintenance pour <b>${domain}</b>.\n\nCe qui se passe :\n• Les visiteurs voient une page "Bientôt de retour"\n• Email, FTP, bases de données restent actifs\n• Un petit bloc est ajouté à votre <code>.htaccess</code> (proprement retiré quand vous redevenez en ligne)\n• Un fichier <code>maintenance.html</code> est créé dans <code>public_html/</code>\n\n<b>Rappel — la facturation continue :</b>\n• La date d'expiration est inchangée\n• Le renouvellement automatique reste actif\n\nContinuer ?`,
 takingSiteOffline: (domain, mode) => `⏳ ${mode === 'suspended' ? 'Suspension de' : 'Activation du mode maintenance pour'} <b>${domain}</b>...`,
 takeSiteOfflineSuccess: (domain, mode) => mode === 'suspended'
  ? `✅ <b>${domain}</b> est maintenant hors ligne (suspension complète). Les visiteurs voient la page de suspension. Tapez "Remettre le Site En Ligne" pour restaurer.\n\n<i>Rappel : votre plan continue à compter jusqu'à expiration et le renouvellement automatique n'est pas affecté.</i>`
  : `✅ <b>${domain}</b> est maintenant en mode maintenance. Les visiteurs voient une page "Bientôt de retour". Email & FTP fonctionnent toujours. Tapez "Remettre le Site En Ligne" quand vous êtes prêt.\n\n<i>Rappel : votre plan continue à compter jusqu'à expiration et le renouvellement automatique n'est pas affecté.</i>`,
 takeSiteOfflineFailed: (domain, err) => `❌ Échec de la mise hors ligne de <b>${domain}</b>.${err ? `\n\nRaison : <code>${err}</code>` : ''}\n\nRéessayez ou contactez le support.`,
 confirmBringSiteOnline: domain => `🌐 <b>Remettre le site en ligne</b>\n\nDomaine : <b>${domain}</b>\n\nCela restaurera l'accès public immédiatement. Si vous avez utilisé le <i>Mode Maintenance</i>, le bloc de redirection est retiré de votre <code>.htaccess</code>. Si vous avez utilisé la <i>Suspension Complète</i>, le compte cPanel est réactivé et HTTP/FTP/email/DB reviennent.\n\nContinuer ?`,
 bringingSiteOnline: domain => `⏳ Remise en ligne de <b>${domain}</b>...`,
 bringSiteOnlineSuccess: domain => `✅ <b>${domain}</b> est de nouveau en ligne. Comptez jusqu'à 1 minute pour que le cache/CDN se vide complètement.`,
 bringSiteOnlineFailed: (domain, err) => `❌ Échec de la remise en ligne de <b>${domain}</b>.${err ? `\n\nRaison : <code>${err}</code>` : ''}\n\nRéessayez ou contactez le support.`,

 // SMS app activation / device management
 smsAppActivationCode: (chatId, plan, isSubscribed) => {
   if (!isSubscribed) {
     return `📱 <b>Essai gratuit BulkSMS — 100 SMS gratuits</b>\n\n📲 <b>Appareils Android uniquement</b> — iOS/iPhone non pris en charge (Apple bloque l'envoi de SMS).\n\nVotre code d'activation :\n<code>${chatId}</code>\n\n📲 <b>Téléchargez l'appli :</b> ${SMS_APP_LINK}\n\nOuvrez l'appli → Entrez votre code → Commencez à envoyer !\n\n⚡ <b>Essai :</b> 1 appareil uniquement.\n\n💡 Appuyez sur <b>⚡ Améliorer le plan</b> pour débloquer multi-appareils + BulkSMS illimité + raccourcissement d'URL + validations & plus !\n\nBesoin de cartes eSIM ? Appuyez sur 💬 Support`
   }
   const deviceLimit = plan === 'Monthly' ? 'illimité' : (plan === 'Weekly' ? '10' : (plan === 'Daily' ? '3' : '1'))
   return `📱 <b>BulkSMS — Plan ${plan} actif ✅</b>\n\n📲 <b>Appareils Android uniquement</b> — iOS/iPhone non pris en charge (Apple bloque l'envoi de SMS).\n\nVotre code d'activation :\n<code>${chatId}</code>\n\n📲 <b>Téléchargez l'appli :</b> ${SMS_APP_LINK}\n\nOuvrez l'appli → Entrez votre code → Commencez à envoyer !\n\n⚡ <b>Appareils :</b> ${deviceLimit} ${deviceLimit === 'illimité' ? 'appareils' : `appareil${deviceLimit === '1' ? '' : 's'}`}\n\nCréez des campagnes dans l'appli ou sur le bot.\n\nBesoin de cartes eSIM ? Appuyez sur 💬 Support`
 },
 smsManageDevices: '📱 Gérer les appareils',
 smsDevicesList: (devices, chatId) => {
   if (!devices || devices.length === 0) {
     return `📱 <b>Aucun appareil connecté</b>\n\nTéléchargez l'appli et connectez-vous avec votre code d'activation :\n<code>${chatId}</code>\n\n📲 Télécharger : ${SMS_APP_LINK}`
   }
   const deviceList = devices.map((d, idx) => {
     const name = d.deviceName || `Appareil ${idx + 1}`
     const lastActive = d.lastActive ? new Date(d.lastActive).toLocaleString() : 'Jamais'
     return `${idx + 1}. <b>${name}</b>\n   📱 <code>${d.deviceId}</code>\n   🕒 ${lastActive}`
   }).join('\n\n')
   return `📱 <b>Vos appareils (${devices.length})</b>\n\n${deviceList}\n\n✏️ Appuyez sur le bouton d'un appareil ci-dessous pour le renommer, ou renommez-le dans l'appli.`
 },

 // Payment timeout and abandoned cart reminders
 paymentTimeoutReminder: `⏰ <b>Votre session de paiement a expiré</b>\n\nVotre session de paiement a expiré après 6 heures d'inactivité.\n\nPas d'inquiétude ! Vous pouvez recommencer à tout moment en sélectionnant le produit ou service souhaité.\n\n💬 Besoin d'aide ? Appuyez sur <b>Support</b>`,
 abandonedCartReminder: (productName, price) =>
   `🛒 <b>Toujours intéressé par ${productName} ?</b>\n\n` +
   `Vous l'avez laissé dans votre panier il y a 2 heures.\n\n` +
   `💳 Prix : $${price}\n\n` +
   `Finalisez votre achat maintenant ! Le produit vous attend. 🎁\n\n` +
   `Appuyez sur /start pour continuer ou 💬 <b>Support</b> si vous avez des questions.`,
}

const phoneNumberLeads = ['🎯 Leads Premium Ciblés', '✅📲 Valider les leads téléphoniques']

const buyLeadsSelectCountry = Object.keys(areasOfCountry)
const buyLeadsSelectSmsVoice = ['SMS (Prix 20$ pour 1000)', 'Voix (Prix 0$ pour 1000)']
const buyLeadsSelectArea = country => Object.keys(areasOfCountry?.[country])
const buyLeadsSelectAreaCode = (country, area) => {
 const codes = areasOfCountry?.[country]?.[area].map(c => format(countryCodeOf[country], c))
 return codes.length > 1 ? ['Mixed Area Codes'].concat(codes) : codes
}
const _buyLeadsSelectAreaCode = (country, area) => areasOfCountry?.[country]?.[area]
const buyLeadsSelectCnam = yesNo
const buyLeadsSelectCarrier = country => carriersOf[country]
const buyLeadsSelectAmount = ['1000', '2000', '3000', '4000', '5000']
const buyLeadsSelectFormat = ['Format Local', 'Format International']

const validatorSelectCountry = Object.keys(areasOfCountry)
const validatorSelectSmsVoice = ['SMS (Prix 20$ pour 1000)', 'Voix (Prix 0$ pour 1000)']
const validatorSelectCarrier = country => carriersOf[country]
const validatorSelectCnam = yesNo
const validatorSelectAmount = ['ALL', '1000', '2000', '3000', '4000', '5000']
const validatorSelectFormat = ['Format Local', 'Format International']

const selectFormatOf = {
 'Format Local': 'Local Format',
 'Format International': 'International Format',
}

//redSelectRandomCustom

const redSelectRandomCustom = ['Lien court aléatoire']

const redSelectProvider = ['Bit.ly 10 $', `Shortit (Essai ${FREE_LINKS})`]

const tickerOf = {
 BTC: 'btc',
 LTC: 'ltc',
 ETH: 'eth',
 'USDT (TRC20)': 'trc20_usdt',
 BCH: 'bch',
 'USDT (ERC20)': 'erc20_usdt',
 DOGE: 'doge',
 TRON: 'trx',
 // Matic: 'polygon_matic',
}

const supportedCrypto = {
 BTC: '₿ Bitcoin (BTC)',
 LTC: 'Ł Litecoin (LTC)',
 DOGE: 'Ð Dogecoin (DOGE)',
 BCH: 'Ƀ Bitcoin Cash (BCH)',
 ETH: 'Ξ Ethereum (ETH)',
 TRON: '🌐 Tron (TRX)',
 'USDT (TRC20)': '₮ Tether (USDT - TRC20)',
 'USDT (ERC20)': '₮ Tether (USDT - ERC20)',
}

/////////////////////////////////////////////////////////////////////////////////////
const _bc = ['Retour', 'Annuler']
const _mc = ['🏠 Main Menu', 'Annuler']
const _isEmojiBack = item => {
  if (typeof item !== 'string') return false
  const s = item.replace(/^[^\p{L}]+/u, '').trim()
  return s === 'Back' || s === 'Retour' || s === '返回' || s === 'वापस'
}

const payIn = {
 crypto: 'Crypto',
 ...(HIDE_BANK_PAYMENT !== 'true' && { bank: 'Banque ₦aira + Carte🏦💳' }),
 wallet: '👛 Portefeuille',
}

const tickerViews = Object.keys(tickerOf)
const reverseObject = o => Object.fromEntries(Object.entries(o).map(([key, val]) => [val, key]))
const tickerViewOf = reverseObject(tickerOf)
const supportedCryptoView = reverseObject(supportedCrypto)
const supportedCryptoViewOf = Object.keys(supportedCryptoView)

const kOf = list => ({
 reply_markup: {
 // Handle if there are multiples buttons in a row
 keyboard: [
 ...list.map(a => (Array.isArray(a) ? a : [a])),
 ...(list.some(
 a =>
 Array.isArray(a) &&
 a.some(
 item =>
 typeof item === 'string' &&
 (item.includes(t.backButton) ||
 item.includes(user.backToHostingPlans) ||
 item.includes(user.backToPremiumWeeklyDetails) ||
 item.includes(user.backToPurchaseOptions)),
 ),
 )
 ? (list.some(a => Array.isArray(a) && a.some(i => typeof i === 'string' && i.includes('🏠 Main Menu'))) ? [] : [['🏠 Main Menu']])
 : (list.some(a => Array.isArray(a) && a.some(item => _isEmojiBack(item))) ? [_mc] : [_bc])),
 ],
 },
 parse_mode: 'HTML',
})
const yes_no = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [yesNo, _bc],
 },
 disable_web_page_preview: true,
}
const k = {
 of: kOf,

 wallet: {
 reply_markup: {
 keyboard: [[u.deposit], _bc],
 },
 },

 pay: {
 reply_markup: {
 keyboard: [Object.values(payIn), _bc],
 },
 parse_mode: 'HTML',
 },

 vcAmount: {
 reply_markup: {
 keyboard: [
 ['$50', '$100', '$200'],
 ['$500', '$1000'],
 ['✏️ Custom Amount'],
 _bc,
 ],
 },
 parse_mode: 'HTML',
 },
 buyLeadsSelectCountry: kOf(buyLeadsSelectCountry),
 buyLeadsSelectSmsVoice: kOf(buyLeadsSelectSmsVoice),
 buyLeadsSelectArea: country => kOf(buyLeadsSelectArea(country)),
 buyLeadsSelectAreaCode: (country, area) => kOf(buyLeadsSelectAreaCode(country, area)),
 buyLeadsSelectCarrier: country => kOf(buyLeadsSelectCarrier(country)),
 buyLeadsSelectCnam: kOf(yesNo),
 buyLeadsSelectAmount: kOf(buyLeadsSelectAmount),
 buyLeadsSelectFormat: kOf(buyLeadsSelectFormat),
 // changing here for validatorSelectCountry
 validatorSelectCountry: kOf(validatorSelectCountry),
 validatorSelectSmsVoice: kOf(validatorSelectSmsVoice),
 validatorSelectCarrier: country => kOf(validatorSelectCarrier(country)),
 validatorSelectCnam: kOf(validatorSelectCnam),
 validatorSelectAmount: kOf(validatorSelectAmount),
 validatorSelectFormat: kOf(validatorSelectFormat),

 //url shortening
 redSelectRandomCustom: kOf(redSelectRandomCustom),

 redSelectProvider: kOf(redSelectProvider),
 phoneNumberLeads: kOf(phoneNumberLeads),
}
const payOpts = k.of([u.usd])

const adminKeyboard = {
 reply_markup: {
 keyboard: Object.values(admin).map(b => [b]),
 },
}

const userKeyboard = {
 reply_markup: {
 keyboard: [
 [user.cloudPhone, user.hostingDomainsRedirect],
 [user.domainNames, user.digitalProducts],
 [user.marketplace, user.referEarn],
 ...(VPS_ENABLED === 'true'
 ? (HIDE_SMS_APP !== 'true' ? [[user.vpsPlans, user.smsAppMain]] : [[user.vpsPlans]])
 : (HIDE_SMS_APP !== 'true' ? [[user.smsAppMain]] : [])),
 [user.emailValidation, user.virtualCard],
 [user.wallet, user.leadsValidation],
 [user.urlShortenerMain, user.buyPlan],
 ...(EMAIL_BLAST_ON === 'true' ? [[user.emailBlast]] : []),
 // Service Bundles removed from the main menu to save space (still reachable
 // via contextual upsell prompts). Join Channel remains on its own row.
 [user.joinChannel],
 HIDE_BECOME_RESELLER === 'true'
 ? [user.changeSetting, user.getSupport]
 : [user.becomeReseller, user.changeSetting, user.getSupport],
 ],
 resize_keyboard: true,
 },
 parse_mode: 'HTML',
 disable_web_page_preview: true,
}

const languages = {
 en: '🇬🇧 Anglais',
 fr: '🇫🇷 Français',
 zh: '🇨🇳 Chinois',
 hi: '🇮🇳 Hindi',
}
const supportedLanguages = reverseObject(languages)

const languageMenu = {
 reply_markup: {
 keyboard: [[languages.en], [languages.fr], [languages.zh], [languages.hi]],
 },
 parse_mode: 'HTML',
 disable_web_page_preview: true,
}

const l = {
 continueAtHostbay: '🚀 Tous les services sont maintenant disponibles ici sur Nomadly Bot — domaines, leads, Cloud IVR, produits digitaux et plus.',
 redirectMessage: '🚀 Tous les services sont maintenant disponibles ici sur Nomadly Bot — domaines, leads, Cloud IVR, produits digitaux et plus.',

 serviceAd: `━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>Nomadly</b> — Votre Boîte à Outils Numérique
━━━━━━━━━━━━━━━━━━━━━━

📞 <b>Cloud IVR + SIP</b>
Numéros virtuels dans 30+ pays
Standard auto · SMS · Messagerie vocale · SIP
Campagnes IVR rapide et en masse

🌐 <b>Domaines Blindés</b>
1 000+ TLDs · Enregistrement offshore DMCA-ignoré
Gestion DNS · Protection Anti-Red

🛡️ <b>Hébergement Anti-Red</b>
HostPanel offshore · Hebdomadaire et mensuel
Bouclier JS Challenge · SSL inclus

🛒 <b>Produits Numériques</b>
Twilio · Telnyx · AWS · Google Cloud
Google Workspace · Zoho Mail · eSIM

💳 <b>Cartes Virtuelles</b>
Cartes virtuelles instantanées · Utilisation mondiale

🎯 <b>Leads Téléphoniques Vérifiés</b>
Filtrer par pays, opérateur et indicatif
Leads premium avec noms des propriétaires

🔗 <b>Raccourcisseur d'URL</b>
Liens de marque · Domaines personnalisés · Analyses

━━━━━━━━━━━━━━━━━━━━━━
💰 Payez avec <b>Crypto · Virement · Portefeuille</b>
━━━━━━━━━━━━━━━━━━━━━━

🤖 <b>Commencer →</b> @Nomadlybot
💬 <b>Besoin d'aide ?</b> Appuyez sur Obtenir de l'aide
📢 <b>Mises à jour →</b> ${TG_CHANNEL}`,

 askPreferredLanguage: `🌍 Pour garantir que tout est dans votre langue préférée, veuillez en sélectionner une ci-dessous :
 
 Vous pouvez toujours changer votre langue plus tard dans les paramètres.`,
 askValidLanguage: 'Veuillez choisir une langue valide :',
 settingsMenuText: '⚙️ <b>Paramètres</b>\n\nGérez vos préférences ci-dessous :',
 welcomeMessage: `👋 Bienvenue sur le ${CHAT_BOT_NAME} !
 Nous sommes ravis de vous avoir ici ! 🎉
 Commençons afin que vous puissiez explorer toutes les fonctionnalités passionnantes que nous proposons. 🌟
 
 Ce setup est rapide et facile—plongeons dedans ! 🚀`,
 askUserEmail: 'Quel est votre email ? Personnalisons votre expérience ! (par exemple, davidsen@gmail.com)',
 processUserEmail: ` Merci 😊 Nous configurons votre compte maintenant.
 Veuillez patienter un instant pendant que nous finalisons les détails. ⏳
 
 Nous faisons le travail en arrière-plan. Suivez simplement les étapes !`,
 confirmUserEmail: `✨ Excellente nouvelle ! Votre compte est prêt ! 🎉💃🎉
 
 Profitez des fonctionnalités premium pendant votre période d'essai gratuite !`,
 termsAndCond: `📜 Avant de continuer, veuillez examiner et accepter nos conditions générales.`,
 acceptTermButton: '✅ Accepter',
 declineTermButton: '❌ Refuser',
 viewTermsAgainButton: '🔄 Revoir les termes',
 exitSetupButton: '❌ Quitter le setup',
 acceptedTermsMsg: `✅ Vous avez accepté avec succès les conditions générales ! 🎉
 Vous êtes prêt à commencer à utiliser ${CHAT_BOT_NAME}. Passons à la partie amusante ! 🎯`,
 declinedTermsMsg: `⚠️ Vous devez accepter les conditions générales pour continuer à utiliser ${CHAT_BOT_NAME}. 
 Veuillez les revoir quand vous serez prêt.`,
 userExitMsg: 'L’utilisateur a appuyé sur le bouton de sortie.',

 acceptTermMsg: `Veuillez accepter les conditions générales pour continuer à utiliser ${CHAT_BOT_NAME}`,
 termsAndCondMsg: `<h1>Conditions Générales pour ${CHAT_BOT_NAME}</h1>
 <p><strong>Date d’effet :</strong> 01/01/2022</p>
 <p>En utilisant ${CHAT_BOT_NAME}, vous acceptez ces Conditions Générales.</p>

 <h2>1. Acceptation des Conditions</h2>
 <p>Vous devez avoir 18 ans ou plus, ou avoir le consentement d’un tuteur, et accepter ces conditions ainsi que notre Politique de Confidentialité.</p>

 <h2>2. Services Fournis</h2>
 <p>Nous proposons l’enregistrement de domaines, l’hébergement web et le support pour la configuration de sites/applications.</p>

 <h2>3. Responsabilités de l’Utilisateur</h2>
 <p>Fournir des informations exactes, éviter les activités illégales et sécuriser votre compte Telegram.</p>

 <h2>4. Conditions de Paiement</h2>
 <p>Tous les paiements sont définitifs sauf indication contraire. Le non-paiement peut entraîner la suspension des services.</p>

 <h2>5. Limitations des Services</h2>
 <p>Nous pouvons imposer des limites de ressources ou subir des interruptions dues à la maintenance ou à des problèmes techniques.</p>

 <h2>6. Résiliation</h2>
 <p>Nous pouvons résilier les services en cas de violation ou de non-paiement. Les utilisateurs peuvent annuler à tout moment, mais les frais ne sont pas remboursables.</p>

 <h2>7. Responsabilité</h2>
 <p>Les services sont fournis « en l’état ». Nous ne sommes pas responsables des pertes de données, des pannes ou des violations de sécurité des utilisateurs.</p>

 <h2>8. Confidentialité</h2>
 <p>Nous gérons vos données conformément à notre Politique de Confidentialité et ne les partageons que si la loi l’exige.</p>

 <h2>9. Modifications des Conditions</h2>
 <p>Nous pouvons mettre à jour ces conditions, et l’utilisation continue implique votre acceptation.</p>

 <h2>10. Contact</h2>
 <p>Pour toute assistance, contactez-nous à <a href="${APP_SUPPORT_LINK}" target="_blank">${APP_SUPPORT_LINK}</a>.</p>

 <p>En utilisant ${CHAT_BOT_NAME}, vous acceptez ces conditions. Merci !</p>
`,
}

const termsAndConditionType = lang => ({
 reply_markup: {
 inline_keyboard: [
 [
 {
 text: 'Voir les termes et conditions',
 web_app: {
 url: `${SELF_URL}/terms-condition?lang=${lang}`,
 },
 },
 ],
 ],
 },
})

const planOptions = ['Quotidien', 'Hebdomadaire', 'Mensuel']
const planOptionsOf = {
 Quotidien: 'Daily',
 Hebdomadaire: 'Weekly',
 Mensuel: 'Monthly',
}

const linkOptions = [t.randomLink, t.customLink]

const chooseSubscription = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [...planOptions.map(a => [a]), _bc],
 },
}

const dO = {
 reply_markup: {
 keyboard: [_bc, ['Backup Data'], ['Restore Data']],
 },
}

const bc = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [_bc],
 },
 disable_web_page_preview: true,
}

const dns = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.quickActions], [t.checkDns], [t.addDns], [t.updateDns], [t.deleteDns], [t.switchToCf], [t.activateShortener], _bc],
 },
 disable_web_page_preview: true,
}
const dnsRecordType = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.a], [t.cname], [t.mx], [t.txt], _bc],
 },
 disable_web_page_preview: true,
}

const dnsQuickActionKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [
 [t.dnsQuickActions.pointToIp],
 [t.dnsQuickActions.googleEmail],
 [t.dnsQuickActions.zohoEmail],
 [t.dnsQuickActions.verification],
 [t.dnsQuickActions.addSubdomain],
 _bc,
 ],
 },
 disable_web_page_preview: true,
}

const dnsMxPriorityKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [['1'], ['5'], ['10'], ['20'], ['50'], _bc],
 },
 disable_web_page_preview: true,
}

const dnsSubdomainTargetTypeKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.dnsQuickSubdomainIp], [t.dnsQuickSubdomainDomain], _bc],
 },
 disable_web_page_preview: true,
}

const getRecordTypeKeyboard = (dnsSource) => {
 const base = [[t.a], [t.aaaa], [t.cname], [t.mx], [t.txt]]
 if (dnsSource !== 'connectreseller') {
 base.push([t.srvRecord], [t.caaRecord])
 }
 base.push(_bc)
 return { parse_mode: 'HTML', reply_markup: { keyboard: base }, disable_web_page_preview: true }
}

const dnsCaaTagKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.caaTagIssue], [t.caaTagIssuewild], [t.caaTagIodef], _bc],
 },
 disable_web_page_preview: true,
}

const dnsSrvDefaultsKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [['10'], ['20'], ['50'], _bc],
 },
 disable_web_page_preview: true,
}

const linkType = {
 reply_markup: {
 keyboard: [linkOptions, _bc],
 },
}

const show = domains => ({
 reply_markup: {
 keyboard: [[user.buyDomainName], ...domains.map(d => [d]), _bc],
 },
})

const payBank = url => ({
 reply_markup: {
 inline_keyboard: [
 [
 {
 text: 'Effectuer le paiement',
 web_app: {
 url,
 },
 },
 ],
 ],
 },
})

const html = (text = t.successPayment) => {
 return `
 <html>
 <body>
 <p style="font-family: 'system-ui';" >${text}</p>
 </body>
 </html>
 `
}
const plans = hostingType => {
 return {
 premiumWeekly: {
 name: 'Premium Anti-Red (1-Week)',
 price: PREMIUM_ANTIRED_WEEKLY_PRICE,
 duration: '7 jours',
 storage: '10 Go SSD',
 bandwidth: '100 Go',
 domains: "Jusqu'à 2 domaines",
 ssl: 'SSL gratuit',
 protection: 'Masquage IP · Détection de bots · Blocage UA',
 panel: 'HostPanel — gestion des fichiers, BDD & e-mails',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 jours',
 storage: '50 Go SSD',
 bandwidth: '500 Go',
 domains: "Jusqu'à 6 domaines",
 ssl: 'SSL gratuit',
 protection: 'Masquage IP · Défi JS · Blocage UA & TLS',
 panel: 'HostPanel — sauvegardes, migration & outils avancés',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 jours',
 storage: '100 Go SSD',
 bandwidth: 'Illimitée',
 domains: 'Domaines illimités',
 ssl: 'SSL gratuit + Wildcard',
 protection: 'Anti-Red complet : masquage IP · défi JS · TLS/JA3 · règles WAF · support prioritaire',
 panel: 'HostPanel — staging, sécurité & tous les outils avancés',
 },
 }
}
const hostingPlansText = {
 plans: plans,

 generatePlanText: (hostingType, planKey) => {
 const plan = plans(hostingType)[planKey]
 return `<b>${plan.name} — $${plan.price}</b>

${plan.storage} · ${plan.bandwidth} · ${plan.domains}
${plan.ssl} · ${plan.protection}
${plan.panel}`
 },
 generatePlanStepText: step => {
 const commonSteps = {
 buyText: 'Comment souhaitez-vous connecter un domaine ?\n\n🌐 Enregistrer un nouveau domaine\n📂 Utiliser mon domaine\n🔗 Connecter un domaine externe',
 registerNewDomainText: 'Veuillez entrer le nom de domaine que vous souhaitez enregistrer (ex. : exemple.com).',
 domainNotFound: 'Le domaine que vous avez entré est introuvable. Veuillez vérifier ou essayer un autre.',
 useExistingDomainText: 'Veuillez entrer le nom de votre domaine existant (ex. : exemple.com).',
 connectExternalDomainText: 'Veuillez entrer votre domaine externe (ex. : exemple.com)\n\nAprès la configuration, vous devrez pointer les serveurs de noms vers Cloudflare.',
 useExistingDomainNotFound:
 'Le domaine que vous avez entré n’est pas associé à votre compte. Veuillez vérifier ou contacter le support.',
 enterYourEmail: 'Veuillez fournir votre adresse email pour créer votre compte et recevoir votre reçu.',
 invalidEmail: 'Veuillez fournir une adresse email valide.',
 paymentConfirmation: 'Veuillez confirmer la transaction pour continuer votre achat.',
 paymentSuccess: `Nous vérifions votre paiement. Vous serez informé dès que celui-ci sera confirmé. Merci de nous avoir choisi !`,
 paymentFailed: 'Le paiement a échoué. Veuillez réessayer.',
 }

 return `${commonSteps[step]}`
 },

 generateDomainFoundText: (websiteName, price, hostingPrice, total, planName) => {
   if (hostingPrice && total) {
     return `✅ <b>${websiteName}</b> est disponible !\n\n` +
       `🌐 Domaine : <b>$${price}</b>\n` +
       `🛡️ Hébergement${planName ? ` (${planName})` : ''} : <b>$${hostingPrice}</b>\n` +
       `━━━━━━━━━━━━\n` +
       `💰 <b>Total aujourd'hui : $${total}</b>`
   }
   return `Le domaine ${websiteName} est disponible ! Le coût est de $${price}.`
 },
 generateExistingDomainText: websiteName => `Vous avez sélectionné ${websiteName} comme votre domaine.`,
 connectExternalDomainText: websiteName => `Vous souhaitez connecter <b>${websiteName}</b> comme votre domaine.\n\nAprès l'achat, vous devrez pointer les serveurs de noms de votre domaine vers Cloudflare.`,
 domainNotFound: websiteName => `Le domaine ${websiteName} n'est pas disponible.`,
 nameserverSelectionText: websiteName =>
 `Veuillez sélectionner le fournisseur de serveur de noms que vous souhaitez utiliser pour ${websiteName}.`,
 confirmEmailBeforeProceeding: email => `Êtes-vous sûr de vouloir continuer avec cet email : ${email} ?`,

 generateInvoiceText: payload => `
<b>Enregistrement de domaine</b>
<b>- Domaine : </b> ${payload.domainName}
<b>- Prix : </b> $${payload?.existingDomain ? '0 (utilisation d’un domaine existant)' : payload.domainPrice}
 
<b>Hébergement Web</b>
<b>- Durée : </b> 1 mois
<b>- Prix : </b> $${payload.hostingPrice}
 
<b>Montant total dû :</b>
<b>- Réduction par coupon : </b> $${payload.couponDiscount}
<b>- USD : </b> $${payload?.couponApplied ? payload.newPrice : payload.totalPrice}
<b>- Taxe : </b> $0.00
 
<b>Conditions de paiement</b>
Ceci est une facture de prépaiement. Veuillez vous assurer que le paiement est effectué dans l'heure afin d'activer vos services de domaine et d'hébergement. Une fois le paiement reçu, nous procéderons à l'activation de votre service.
`,

 showCryptoPaymentInfo: (priceUsd, priceCrypto, tickerView, address, plan) => `💰 <b>Total : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre ${plan} sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).`,

 successText: (info, response) =>
 `Votre hébergement est en ligne.

<b>Domaine :</b> ${info.website_name}
${info.email ? `<b>Email :</b> ${info.email}\n` : ''}DNS auto-configuré via Cloudflare.`,

 support: (
 plan,
 statusCode,
 ) => `Quelque chose s'est mal passé lors de la configuration de votre ${plan} | ${statusCode}. 
 Veuillez appuyer sur 💬 Obtenir de l'aide.
 Découvrez plus sur ${TG_HANDLE}.`,

 bankPayDomain: (
 priceNGN,
 plan,
 ) => `Veuillez virer ${priceNGN} NGN en cliquant sur “Faire le paiement” ci-dessous. Une fois la transaction confirmée, vous serez immédiatement notifié, et votre ${plan} sera activé sans problème.

Cordialement,
${CHAT_BOT_NAME}`,
}

const vpsBC = ['🔙 Retour', 'Annuler']

const vpsOptionsOf = list => ({
 reply_markup: {
 // Handle if there are multiples buttons in a row
 keyboard: [
 ...list.map(a => (Array.isArray(a) ? a : [a])),
 ...(list.some(
 a => Array.isArray(a) && a.some(item => typeof item === 'string' && item.includes(t.goBackToCoupon)),
 )
 ? []
 : [vpsBC]),
 ],
 },
 parse_mode: 'HTML',
})

const vpsPlans = {
 hourly: "À l'heure",
 monthly: 'Mensuel',
 quaterly: 'Trimestriel',
 annually: 'Annuel',
}

const vpsPlanOf = {
 "À l'heure": 'hourly',
 Mensuel: 'monthly',
 Trimestriel: 'quaterly',
 Annuel: 'annually',
}

// Voice Service translations
const vs = {
  callDisconnectedAutoRouted: (usdBal, lowBalTrigger, lowBalResume) => `🚫 <b>Appel coupé</b> (routage automatique)\n\nPortefeuille : <b>$${usdBal}</b> — sous le seuil de $${lowBalTrigger}.\n💰 Rechargez au moins $${lowBalResume} pour reprendre les appels.`,
  callDisconnectedWalletInsufficient: (rate, connFee) => `🚫 <b>Appel coupé</b> — Portefeuille insuffisant (requis $${rate}/min + $${connFee} de frais de connexion).\nRechargez via 👛 Portefeuille.`,
  callDisconnectedWalletExhausted: '🚫 <b>Appel coupé</b> — Portefeuille épuisé.\nRechargez via 👛 Portefeuille.',
  outboundCallFailedRouting: (fromPhone, toPhone) => `🚫 <b>Échec de l'appel sortant</b>\n📞 ${fromPhone} → ${toPhone}\nMotif : échec du routage. Veuillez réessayer.`,
  planMinutesExhausted: (phoneNumber, used, limit) => `⚠️ <b>Minutes du forfait épuisées</b>\n\n📞 ${phoneNumber}\nUtilisées : <b>${used}/${limit}</b> minutes ce cycle.\n\nLa facturation du dépassement est désormais active depuis votre portefeuille. Rechargez ou changez de forfait.`,
  callTypeCharge: (callType, minutesBilled, rate, chargedStr, region, discountLine) => `💰 <b>${callType}</b> : ${minutesBilled} min × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  overageCharge: (newOverageMin, rate, chargedStr, region, discountLine) => `💰 <b>Dépassement</b> : ${newOverageMin} min × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  transferEnded: (forwardPhone, duration, planLine) => `📞 <b>Transfert terminé</b>\n${forwardPhone} — ${duration}\n${planLine}`,
  transferFailed: (forwardPhone, reason) => `❌ <b>Échec du transfert</b>\n📞 ${forwardPhone} — ${reason}`,
  orphanedNumberAlert: (to, from) => `⚠️ <b>Orphaned Number Alert</b>\n\n📞 <code>${to}</code> received inbound call from <code>${from}</code>\n\n❌ No owner found in DB — call rejected.\nThis number may need to be released or re-assigned.`,
 incomingCallBlockedWalletEmpty: '⚠️ <b>Appel entrant bloqué</b> — Votre portefeuille est vide. Rechargez pour recevoir des appels.',
  overageActive: (chargedStr, region, currency) => `💰 <b>Dépassement actif</b> — Minutes du forfait épuisées. ${chargedStr} (${region}) depuis le portefeuille ${currency}.`,
  callEndedPlanWalletExhausted: (elapsedMin) => `🚫 <b>Appel terminé</b> — Minutes du forfait + portefeuille épuisés.\n⏱️ ~${elapsedMin} min. Rechargez le portefeuille ou changez de forfait.`,
  incomingCall: (fromPhone, toPhone) => `📞 <b>Appel entrant</b>\n${fromPhone} → ${toPhone}\nVotre appareil SIP sonne...`,
  outboundCallingLocked: '🚫 <b>Appels sortants verrouillés</b>\n\n',
 testCallsExpired: '⚠️ Vos appels de test ont expiré. Souscrivez un forfait pour continuer.',
  outboundCallBlocked: (fromPhone, toPhone, status) => `🚫 <b>Appel sortant bloqué</b>\n📞 ${fromPhone} → ${toPhone}\nMotif : le numéro est ${status}. Veuillez renouveler ou contacter le support.`,
  sipCallBlocked: (sipRate, connFee, region, usdBal, ngnBal) => `🚫 <b>Appel SIP bloqué</b> — Solde du portefeuille insuffisant (requis $${sipRate}/min + $${connFee} de frais de connexion ${region}).\nSolde : $${usdBal} / NGN : ₦${ngnBal}\nLes appels sortants sont facturés depuis le portefeuille. Rechargez via 👛 Portefeuille.`,
  freeSipTestCall: (fromPhone, toPhone, remaining, maxDuration) => `📞 <b>Appel test SIP gratuit</b>\nDe : ${fromPhone}\nVers : ${toPhone}\n🆓 Appel test gratuit (${remaining} restant(s), max ${maxDuration}s)`,
  sipOutboundCall: (fromPhone, toPhone, walletLine) => `📞 <b>Appel SIP sortant</b>\nDe : ${fromPhone}\nVers : ${toPhone}\n${walletLine}`,
  outboundCallFailedTempUnavailable: (fromPhone, toPhone) => `🚫 <b>Échec de l'appel sortant</b>\n📞 ${fromPhone} → ${toPhone}\nMotif : les appels sortants sont temporairement indisponibles. Veuillez réessayer plus tard.`,
  sipOutboundCallWithRate: (fromPhone, toPhone, sipRate, connFeeNote, estMinutes) => `📞 <b>Appel SIP sortant</b>\nDe : ${fromPhone}\nVers : ${toPhone}\nTarif : $${sipRate}/min${connFeeNote} (~${estMinutes} min disponibles)`,
  lowBalanceForward: (usdBal, estMinutes) => `⚠️ <b>Solde faible</b> — $${usdBal} (~${estMinutes} min de transfert). Rechargez <b>$25</b> via 👛 Portefeuille.`,
  forwardingBlocked: (usdBal, fwdRate) => `🚫 <b>Transfert bloqué</b> — Portefeuille $${usdBal} (requis $${fwdRate}/min).\nRechargez <b>$25</b> via 👛 Portefeuille.`,
  ivrForwardBlocked: (fromPhone, forwardPhone, usdBal, ivrFwdRate, region) => `🚫 <b>Transfert IVR bloqué — Portefeuille vide</b>\n\n📞 ${fromPhone}\n📲 Transfert vers : ${forwardPhone}\n\nPortefeuille $${usdBal} (requis $${ivrFwdRate}/min ${region}).\nRechargez via 👛 Portefeuille.`,
  lowBalanceIvrForward: (usdBal, estMinutes) => `⚠️ <b>Solde faible</b> — $${usdBal} (~${estMinutes} min de transfert IVR). Rechargez via 👛 Portefeuille.`,
  sipCallEndedAutoRouted: (fromPhone, toPhone, duration, minutesBilled, rate) => `📞 <b>Appel SIP terminé</b> (routage automatique)\n\nDe : ${fromPhone}\nVers : ${toPhone}\n⏱️ ${duration}\n💰 ${minutesBilled} min × $${rate} facturés`,
  ivrCallEndedWalletExhausted: (usdBal, ivrCallRate) => `🚫 <b>Appel IVR terminé</b> — Portefeuille épuisé ($${usdBal}).\nLes appels IVR coûtent $${ivrCallRate}/min. Rechargez via 👛 Portefeuille.`,
  callNotConnected: '📞 <b>Appel non connecté</b> — le destinataire était occupé ou n\'a pas répondu.\n\n🎁 Votre appel d\'essai gratuit est toujours disponible ! Réessayez quand vous voulez.',
  transferTimeout: (toPhone) => `⏱ <b>Délai de transfert dépassé</b>\n📞 ${toPhone} n'a pas répondu après 30 secondes`,
  transferConnected: (targetNumber, ivrNumber) => `✅ <b>Transfert connecté</b>\n📞 ${targetNumber} connecté à ${ivrNumber}`,
}

const vpsPlanMenu = ["À l'heure", 'Mensuel', 'Trimestriel', 'Annuel']
const vpsConfigurationMenu = ['De base', 'Standard', 'Premium', 'Entreprise']
const vpsCpanelOptional = ['WHM', 'Plesk', '❌ Passer le panneau de contrôle']

const vp = {
 of: vpsOptionsOf,
 back: '🔙 Retour',
 skip: '❌ Passer',
 cancel: '❌ Annuler',

 // VPS/RDP choice (Step 1)
 vpsLinuxBtn: '🐧 Linux VPS (SSH)',
 vpsRdpBtn: '🪟 Windows RDP',
 askVpsOrRdp: `🖥️ De quel type de serveur avez-vous besoin ?

📬 <b>Port 25 Ouvert</b> — Envoyez des emails directement depuis votre serveur

<strong>🐧 Linux VPS</strong> — Accès SSH · hébergement web · dev · automatisation
<strong>🪟 Windows RDP</strong> — Bureau à distance · apps & outils Windows`,

 askCountryForUser: `🌍 Sélectionnez une région proche de vos utilisateurs :`,
 chooseValidCountry: 'Veuillez choisir un pays dans la liste :',
 askRegionForUser: country =>
 `📍 Sélectionnez un centre de données dans ${country} (Les prix peuvent varier selon l’emplacement.)`,
 chooseValidRegion: 'Veuillez choisir une région valide dans la liste :',
 askZoneForUser: region => `📍 Choisissez la zone dans ${region}.`,

 chooseValidZone: 'Veuillez choisir une zone valide dans la liste :',
 confirmZone: (region, zone) => `✅ Vous avez sélectionné ${region} (${zone}). Voulez-vous continuer avec ce choix ?`,
 failedFetchingData: 'Erreur lors de la récupération, veuillez réessayer dans quelques instants.',
 confirmBtn: `✅ Confirmer la sélection`,

 askVpsDiskType: list => `💾 <b>Choisissez le type de stockage</b>

Les deux options coûtent le même prix — choisissez ce qui compte le plus :

${list?.map(item => `${item.description}`).join('\n\n')}

👇 Appuyez sur votre choix :`,

 chooseValidDiskType: 'Veuillez choisir un type de disque valide',

 askPlanType: plans => `💳 Choisissez un cycle de facturation :

${plans
 .map(
 item =>
 `<strong>• ${item.type === 'Hourly' ? '⏳' : '📅'} ${({ Hourly: 'Horaire', Monthly: 'Mensuel' })[item.type] || item.type.replace(/(\d+) Months/, '$1 mois')} –</strong> $${item.originalPrice} ${
 item.discount === 0 ? '(Aucune réduction)' : `(Inclut ${item.discount}% de réduction)`
 }`,
 )
 .join('\n')}`,
 planTypeMenu: vpsOptionsOf(vpsPlanMenu),
 // Billing (Monthly only)
 hourlyBillingMessage: '',

 askVpsConfig:
 (list, extras = {}) => {
  const { walletUsd, cheapestName, socialProof } = extras
  const plans = list.map(config => {
   const star = config.name === cheapestName ? '🌟 ' : ''
   const line = `<strong>• ${star}${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB ${config.specs.diskType} — $${config.monthlyPrice}/mois`
   return config.isRDP ? `${line}\n   ⚡ <i>Premium AMD · NVMe SSD</i>` : line
  }).join('\n')

  let walletLine = ''
  if (typeof walletUsd === 'number') {
   const sorted = [...list].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice))
   const affordable = sorted.filter(p => Number(p.monthlyPrice) <= walletUsd)
   if (affordable.length) {
    const top = affordable[affordable.length - 1]
    walletLine = `\n\n💰 <b>Votre portefeuille :</b> $${walletUsd.toFixed(2)} — vous pouvez choisir jusqu'à <b>${top.name}</b> ✅`
   } else {
    const cheapest = sorted[0]
    const topUp = (Number(cheapest.monthlyPrice) - walletUsd).toFixed(2)
    walletLine = `\n\n💰 <b>Votre portefeuille :</b> $${walletUsd.toFixed(2)} — rechargez <b>$${topUp}</b> de plus pour débloquer <b>${cheapest.name}</b>`
   }
  }

  const proofLine = socialProof ? `\n\n${socialProof}` : ''
  const header = (Array.isArray(list) && list.some(c => c.isRDP))
   ? '🪟 Choisissez un plan Windows RDP <i>(Windows Server + Bureau à distance, licence incluse)</i> :'
   : '⚙️ Choisissez un plan VPS Linux :'
  return `${header}\n\n${plans}${proofLine}${walletLine}`
 },

 validVpsConfig: 'Veuillez sélectionner une configuration VPS valide :',

 configMenu: vpsOptionsOf(vpsConfigurationMenu),

 askForCoupon:
 '🎟️ Vous avez un code promo ? Entrez-le pour une réduction supplémentaire si applicable, ou passez cette étape. Les réductions du cycle de facturation sont déjà incluses.',
 couponInvalid: `❌ Invalide : Code expiré, non applicable ou incorrect. Veuillez réessayer.`,
 couponValid: amt => `✅ Valide : réduction appliquée : -$${amt}.`,
 skipCouponwarning: `⚠️ Passer cette étape signifie que vous ne pourrez pas appliquer de réduction plus tard.`,
 confirmSkip: "✅ Confirmer l'ignorance",
 goBackToCoupon: '❌ Retourner et appliquer le coupon',

 askVpsOS: () => `💻 Sélectionnez une distribution Linux (par défaut : Ubuntu) :

<strong>💡 Recommandé :</strong>
<strong>• Ubuntu</strong> — Usage général & développement
<strong>• AlmaLinux / Rocky</strong> — Stabilité entreprise
<strong>• Debian</strong> — Léger & fiable`,
 chooseValidOS: `Veuillez sélectionner un OS valide dans la liste disponible :`,
 skipOSBtn: "❌ Passer la sélection de l'OS",
 skipOSwarning:
 '⚠️ Votre VPS sera lancé sans OS. Vous devrez en installer un manuellement via SSH ou en mode de récupération.',

 askVpsCpanel: `🛠️ Sélectionnez un panneau de contrôle pour une gestion plus facile du serveur (optionnel).

<strong>• ⚙️ WHM –</strong> Recommandé pour l'hébergement de plusieurs sites web
<strong>• ⚙️ Plesk –</strong> Idéal pour gérer des sites et applications individuels
<strong>• ❌ Ignorer –</strong> Aucun panneau de contrôle`,

 cpanelMenu: vpsOptionsOf(vpsCpanelOptional),
 noControlPanel: vpsCpanelOptional[2],
 skipPanelMessage: '⚠️ Aucun panneau de contrôle ne sera installé. Vous pourrez en ajouter un manuellement plus tard.',
 validCpanel: 'Veuillez choisir un panneau de contrôle valide ou l’ignorer.',

 askCpanelOtions: (name, list) => `⚙️ Choisissez une ${
 name == 'whm' ? 'WHM' : 'Plesk Web Host Edition'
 } licence ou sélectionnez un essai gratuit (valable ${name == 'whm' ? '15' : '7'} jours).

💰 Tarification de la licence ${name == 'whm' ? 'WHM' : 'Plesk'} :

${list.map(item => `${name == 'whm' ? `<strong>• ${item.name} - </strong>` : ''}${item.label}`).join('\n')}`,

 trialCpanelMessage: panel =>
 `✅ ${panel.name == 'whm' ? 'WHM' : 'Plesk'} Essai gratuit (${
 panel.duration
 } jours) activé. Vous pouvez passer à une version payante à tout moment en contactant le support.`,

 vpsWaitingTime: "⚙️ Récupération des détails... Cela ne prendra qu'un instant.",
 failedCostRetrieval: 'Échec de la récupération des informations de coût... Veuillez réessayer après un moment.',

 errorPurchasingVPS: (plan, isRDP) => `Une erreur est survenue lors de la configuration de votre plan ${isRDP ? 'RDP' : 'VPS'} ${plan}.

Veuillez appuyer sur 💬 Obtenir de l'aide.
Découvrez-en plus sur ${TG_HANDLE}.`,

 generateBillSummary: vpsDetails => {
 const planPrice = vpsDetails.couponApplied ? vpsDetails.planNewPrice : vpsDetails.plantotalPrice
 const total = vpsDetails.totalPrice || Number(planPrice).toFixed(2)
 const isRDP = vpsDetails.isRDP
 const months = Number(vpsDetails.durationMonths) || 1
 const osLabel = isRDP
 ? (vpsDetails.os?.id ? `🪟 ${vpsDetails.os.name}${vpsDetails.os.fastDeploy ? ' ⚡ prêt en ~3 min' : ''}` : '🪟 Windows Server (RDP)')
 : (vpsDetails.os?.name || 'Ubuntu')
 const planEmoji = isRDP ? '🪟' : '🐧'
 const planKind = isRDP ? (/RDP/i.test(String(vpsDetails.config.name)) ? '' : ' <i>(RDP Windows)</i>') : ' <i>(VPS Linux)</i>'
 
 let summary = `<strong>📋 Résumé de commande :</strong>

<strong>${planEmoji} ${vpsDetails.config.name}</strong>${planKind} — ${vpsDetails.config.specs.vCPU} vCPU · ${vpsDetails.config.specs.RAM}GB RAM · ${vpsDetails.config.specs.disk}GB ${vpsDetails.config.specs.diskType}
<strong>📍 Région :</strong> ${vpsDetails.regionName || vpsDetails.country}
<strong>💻 OS :</strong> ${osLabel}`

 if (isRDP) {
 summary += `\n<strong>🪟 Licence Windows :</strong> Incluse`
 }
 if (isRDP || months > 1) {
 summary += `\n<strong>📅 Durée :</strong> ${months === 1 ? '1 mois' : `${months} mois (prépayés)`}`
 }
 if (vpsDetails.couponApplied && vpsDetails.couponDiscount > 0) {
 summary += `\n<strong>🎟️ Coupon :</strong> -$${Number(vpsDetails.couponDiscount).toFixed(2)} USD`
 }
 summary += `\n<strong>🔄 Renouvellement auto :</strong> ✅ Activé`
 summary += `\n\n<strong>💰 Total : $${total} USD${months > 1 ? ` / ${months} mois` : '/mo'}</strong>`
 summary += `\n\n<strong>✅ Procéder à la commande ?</strong>`
 return summary
 },

 no: '❌ Annuler la commande',
 yes: '✅ Confirmer la commande',

 askPaymentMethod: 'Choisissez une méthode de paiement :',

 showDepositCryptoInfoVps: (priceUsd, priceCrypto, tickerView, address, vpsDetails) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre ${vpsDetails?.isRDP ? 'RDP Windows' : 'VPS'} sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 extraMoney: 'Le montant restant pour votre plan horaire a été déposé dans votre portefeuille.',
 paymentRecieved: (isRDP = false) => `✅ Paiement réussi !

Votre ${isRDP ? 'RDP' : 'VPS'} est en cours de configuration — cela prend un instant.
Vos identifiants de connexion s'afficheront ici même dans le chat.`,
 paymentFailed: `❌ Échec du paiement. Veuillez vérifier votre méthode de paiement ou réessayer.`,

 lowWalletBalance: vpsName => `
Votre plan VPS pour l'instance ${vpsName} a été arrêté en raison d'un solde insuffisant.

Veuillez recharger votre portefeuille pour continuer à utiliser votre plan VPS.`,

 vpsBoughtSuccess: (vpsDetails, response, credentials) => {
 const isRDP = response.isRDP || vpsDetails.isRDP || response.osType === 'Windows'
 const connectInfo = isRDP
 ? `<strong>🔗 Connexion:</strong> 🖥 Bureau à distance (mstsc) → <code>${response.host}:3389</code>`
 : `<strong>🔗 Connexion:</strong> 💻 <code>ssh ${credentials.username}@${response.host}</code>`

 const readinessNote = isRDP
 ? `\n⏱ <b>Comptez 5–10 minutes</b> pour le premier démarrage Windows. ⚠️ <b>Enregistrez votre mot de passe maintenant</b> — il ne peut pas être récupéré ensuite (en cas de perte, utilisez "Réinitialiser le mot de passe" dans la gestion RDP).`
 : `\n⏱ <b>Comptez 2–5 minutes</b> pour la configuration initiale. ⚠️ <b>Enregistrez vos identifiants en lieu sûr.</b>`

 return `<strong>🎉 ${isRDP ? 'RDP' : 'VPS'} [${response.label}] est actif !</strong>

<strong>🔑 Informations de connexion:</strong>
 <strong>• IP:</strong> <code>${response.host}</code>
 <strong>• OS:</strong> ${vpsDetails.os ? vpsDetails.os.name : (isRDP ? 'Windows Server' : 'Linux')}
 <strong>• Nom d'utilisateur:</strong> <code>${credentials.username}</code>
 <strong>• Mot de passe:</strong> <tg-spoiler><code>${credentials.password}</code></tg-spoiler> (touchez pour révéler & copier)

${connectInfo}
${readinessNote}

${CHAT_BOT_NAME}`
 },
 vpsHourlyPlanRenewed: (vpsName, price) => `
Votre plan VPS pour l'instance ${vpsName} a été renouvelé avec succès.
${price}$ ont été débités de votre portefeuille.`,

 vpsMonthlyPlanRenewed: (vpsName, planPrice) =>
 `✅ Votre VPS <b>${vpsName}</b> a été renouvelé automatiquement pour 1 mois.\n💰 $${planPrice} débités de votre portefeuille.`,

 vpsExpiredNoAutoRenew: (vpsName) =>
 `⚠️ Votre VPS <b>${vpsName}</b> a expiré. Le renouvellement automatique est désactivé.\nVeuillez renouveler manuellement pour continuer le service.`,

 bankPayVPS: (
 priceNGN,
 plan,
 ) => `Veuillez envoyer ${priceNGN} NGN en cliquant sur "Effectuer le paiement" ci-dessous. Une fois la transaction confirmée, vous serez rapidement notifié et votre ${plan} plan VPS sera activé.

Cordialement,
${CHAT_BOT_NAME}`,

 askAutoRenewal: `🔄 Activer le renouvellement automatique pour un service ininterrompu ? 

🛑 Vous recevrez un rappel avant le renouvellement. Vous pouvez le désactiver à tout moment.`,
 enable: '✅ Activer',
 skipAutoRenewalWarming: expiresAt =>
 `⚠️ Votre VPS expirera le ${new Date(expiresAt).toLocaleDateString('fr-FR').replace(/\//g, '-')} à ${new Date(
 expiresAt,
 ).toLocaleTimeString('fr-FR', {
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
 })}, et le service pourrait être interrompu.`,

 generateSSHKeyBtn: '✅ Générer une nouvelle clé',
 linkSSHKeyBtn: '🗂️ Lier une clé existante',
 skipSSHKeyBtn: '❌ Ignorer (Utiliser la connexion par mot de passe)',
 noExistingSSHMessage:
 '🔑 Aucune clé SSH détectée. Souhaitez-vous générer une nouvelle clé SSH pour un accès sécurisé, ou utiliser la connexion par mot de passe (moins sécurisée) ?',
 existingSSHMessage: '🔑 Vous avez des clés SSH existantes. Choisissez une option :',
 confirmSkipSSHMsg: `⚠️ Avertissement : Les connexions par mot de passe sont moins sécurisées et vulnérables aux attaques.
 🔹 Nous vous recommandons fortement d'utiliser des clés SSH. Êtes-vous sûr de vouloir continuer ?`,
 confirmSkipSSHBtn: '✅ Continuer quand même',
 setUpSSHBtn: '🔄 Configurer la clé SSH',
 sshLinkingSkipped: '❌ Liaison de clé SSH ignorée. Aucun changement effectué.',
 newSSHKeyGeneratedMsg: name => `✅ Clé SSH (${name}) créée.
⚠️ Enregistrez cette clé en toute sécurité – elle peut être récupérée plus tard.`,
 selectSSHKey: '🗂️ Sélectionnez une clé SSH existante à lier à votre VPS :',
 uploadNewKeyBtn: '➕ Télécharger une nouvelle clé',
 cancelLinkingSSHKey: `❌ Liaison de clé SSH annulée. Aucun changement effectué.`,
 selectValidSShKey: 'Veuillez sélectionner une clé SSH valide dans la liste.',
 sshKeySavedForVPS: name => `✅ La clé SSH (${name}) sera liée au nouveau VPS.`,
 askToUploadSSHKey: `📤 Téléchargez votre clé publique SSH (.pub) ou collez la clé ci-dessous.`,
 failedGeneratingSSHKey:
 'Échec de la génération d’une nouvelle clé SSH. Veuillez réessayer ou utiliser une autre méthode.',
 newSSHKeyUploadedMsg: name => `✅ Clé SSH (${name}) téléchargée avec succès et sera liée au VPS.`,
 fileTypePub: 'Le type de fichier doit être .pub',

 vpsList: list => `<strong>🖥️ Vos serveurs :</strong>

${list
 .map(vps => `<strong>• ${vps.isRDP || vps.osType === 'Windows' ? '🪟' : '🐧'} ${vps.name}</strong> <i>(${vps.isRDP || vps.osType === 'Windows' ? 'RDP Windows' : 'VPS Linux'})</i> — ${String(vps.status || '').toUpperCase() === 'RUNNING' ? '🟢' : '🔴'} ${vps.status}`)
 .join('\n')}
`,
 noVPSfound: "Vous n'avez encore aucun serveur. Créez un 🐧 VPS Linux ou un 🪟 RDP Windows ci-dessous.",
 selectCorrectOption: 'Veuillez sélectionner une option dans la liste',
 selectedVpsData: data => {
 const isRDP = !!(data.isRDP || data.osType === 'Windows')
 const port = isRDP ? 3389 : 22
 const loginUser = data.defaultUser || (isRDP ? 'Administrator' : 'root')
 const running = String(data.status || '').toUpperCase() === 'RUNNING'
 const months = Number(data.durationMonths) || 1
 const panelLine = isRDP ? '' : `\n<strong>• Panneau de contrôle :</strong> ${data.cPanelPlanDetails && data.cPanelPlanDetails.type ? data.cPanelPlanDetails.type : 'Aucun'}`
 const billingLine = isRDP ? `\n<strong>• Facturation :</strong> ${months === 1 ? 'Mensuelle' : `${months} mois (prépayés)`} · licence Windows incluse` : ''
 return `<strong>${isRDP ? '🪟 RDP Windows' : '🐧 VPS Linux'} :</strong> ${data.name}

<strong>• Plan :</strong> ${data.planDetails.name}
<strong>• vCPUs :</strong> ${data.planDetails.specs.vCPU} | RAM : ${data.planDetails.specs.RAM} Go | Disque : ${data.planDetails.specs.disk} Go (${data.diskTypeDetails.type})
<strong>• OS :</strong> ${data.osDetails.name}${panelLine}${billingLine}
<strong>• Statut :</strong> ${running ? '🟢' : '🔴'} ${data.status}
<strong>• Renouvellement automatique :</strong> ${data.autoRenewable ? 'Activé' : 'Désactivé'}

<b>🔌 Comment se connecter</b>
<strong>• Adresse IP :</strong> <code>${data.host}</code>
<strong>• ${isRDP ? 'Port RDP' : 'Port SSH'} :</strong> <code>${port}</code>
<strong>• Utilisateur :</strong> <code>${loginUser}</code>${isRDP ? `
<strong>• Bureau à distance :</strong> <code>${data.host}:${port}</code>` : `
<strong>• Commande :</strong> <code>ssh ${loginUser}@${data.host} -p ${port}</code>`}`
 },
 stopVpsBtn: '⏹️ Arrêter',
 startVpsBtn: '▶️ Démarrer',
 restartVpsBtn: '🔄 Redémarrer',
 deleteVpsBtn: '🗑️ Supprimer',
 subscriptionBtn: '🔄 Abonnements',
 VpsLinkedKeysBtn: '🔑 Clés SSH',
 resetPasswordBtn: '🔑 Réinitialiser le mot de passe',
 revealPasswordBtn: '🔐 Afficher le mot de passe',
 revealPasswordChecking: name => `🔐 Recherche du mot de passe actuel pour <strong>${name}</strong>...

⏱️ Juste quelques secondes — nous testons aussi la connexion pour vous.`,

 revealPasswordSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const v = opts.verification || null
   let statusLine = ''
   if (v && v.status === 'ok') {
     statusLine = '\n✅ <b>Nous venons de nous connecter avec ce mot de passe — il fonctionne.</b>'
   } else if (v && v.status === 'password_wrong') {
     statusLine = '\n⚠️ <b>Ce mot de passe a été rejeté par votre serveur.</b> Appuyez sur <b>🔑 Réinitialiser le mot de passe</b> pour en définir un nouveau — il est appliqué immédiatement et vos données sont conservées.'
   } else if (v && v.status === 'password_auth_disabled') {
     statusLine = '\n⚠️ <b>Votre serveur refuse actuellement les connexions par mot de passe</b> (clé SSH uniquement). Appuyez sur <b>🔑 Réinitialiser le mot de passe</b> — cela réactive la connexion par mot de passe et vous donne un nouveau mot de passe.'
   } else if (v && v.status === 'unreachable') {
     statusLine = '\n💤 Nous n\'avons pas pu joindre votre serveur pour tester ce mot de passe. S\'il ne fonctionne pas, appuyez sur <b>🔑 Réinitialiser le mot de passe</b>.'
   }
   const recoveredLine = opts.recovered
     ? '\n\n♻️ <i>Récupéré depuis la configuration d\'origine de votre serveur — enregistré pour un chargement instantané la prochaine fois.</i>'
     : ''
   return `🔐 <strong>Mot de passe VPS actuel</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'Serveur'} :</strong> ${name}
🌐 <strong>IP :</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'Port RDP' : 'Port SSH'} :</strong> <code>${port}</code>
👤 <strong>Nom d'utilisateur :</strong> <code>${username}</code>
🔑 <strong>Mot de passe :</strong> <code>${password}</code>

📋 <strong>Connexion :</strong> <code>${isRDP ? `${ip}:${port}` : `ssh ${username}@${ip} -p ${port}`}</code>${statusLine}${recoveredLine}

💡 Cliquez sur le mot de passe pour le copier. Gardez-le privé — quiconque le possède a un accès complet.`
 },

 revealPasswordNotStored: (name, reason) => `🔐 <strong>Mot de passe non disponible</strong>

Nous n'avons pas pu récupérer le mot de passe actuel pour <strong>${name}</strong>.

📋 <i>Raison : ${reason || 'aucun mot de passe enregistré pour ce serveur'}</i>

✅ <strong>Que faire :</strong> appuyez sur <b>🔑 Réinitialiser le mot de passe</b>. Cela définit un tout nouveau mot de passe sur votre serveur <b>en cours d'exécution</b> en environ une minute — <b>vos fichiers et données sont conservés</b> — puis nous vous affichons le nouveau mot de passe ici et confirmons qu'il fonctionne.`,

 revealPasswordFailed: name => `❌ <strong>Impossible de récupérer le mot de passe</strong>

Une erreur s'est produite lors de la récupération du mot de passe pour <strong>${name}</strong>.

Veuillez réessayer dans un instant, ou appuyez sur <b>🔑 Réinitialiser le mot de passe</b> pour en définir un nouveau.`,
 reinstallWindowsBtn: '🔄 Réinstaller Windows',
 confirmChangeBtn: '✅ Confirmer',

 confirmStopVpstext: name => `⚠️ Êtes-vous sûr de vouloir arrêter le VPS <strong>${name}</strong> ?`,
 vpsBeingStopped: name => `⚙️ Veuillez patienter pendant que votre VPS (${name}) est en cours d\'arrêt`,
 vpsStopped: name => `✅ Le VPS (${name}) a été arrêté.`,
 failedStoppingVPS: name => `❌ Échec de l\'arrêt du VPS (${name}).

Veuillez réessayer après un certain temps.`,
 vpsBeingStarted: name => `⚙️ Veuillez patienter pendant que votre VPS (${name}) est en cours de démarrage`,
 vpsStarted: name => `✅ Le VPS (${name}) est maintenant en cours d\'exécution.`,
 failedStartedVPS: name => `❌ Échec du démarrage du VPS (${name}).

Veuillez réessayer après un certain temps.`,
 vpsBeingRestarted: name => `⚙️ Veuillez patienter pendant que votre VPS (${name}) est en cours de redémarrage`,
 vpsRestarted: name => `✅ Le VPS (${name}) a été redémarré avec succès.`,
 failedRestartingVPS: name => `❌ Échec du redémarrage du VPS (${name}).

Veuillez réessayer après un certain temps.`,
 confirmDeleteVpstext: name =>
 `⚠️ Avertissement : La suppression de ce VPS ${name} est permanente et toutes les données seront perdues.
 • Aucun remboursement pour le temps d'abonnement non utilisé.
 • Le renouvellement automatique sera annulé et aucun frais supplémentaire ne s'appliquera.
 
 Voulez-vous continuer ?`,
 
 confirmResetPasswordText: (name, impact = {}) => {
   const mode = impact.mode || 'in-place'
   const head = `🔑 <strong>Réinitialiser le mot de passe ${impact.isRDP ? 'RDP' : 'VPS'}</strong>

🖥️ <strong>Serveur :</strong> ${name}
`
   const nudge = `
💡 <i>Vous avez seulement perdu le mot de passe ? Faites ❌ Annuler → <b>🔐 Afficher le mot de passe</b> — aucune réinitialisation nécessaire.</i>

Voulez-vous réinitialiser le mot de passe pour <strong>${name}</strong> ?`

   if (mode === 'reinstall') return head + `
⚠️ <strong>CELA EFFACE LE SERVEUR.</strong> Ce fournisseur ne peut pas changer le mot de passe sur une machine en cours d'exécution, donc l'OS est réinstallé — tous les fichiers, sites web, bases de données et paramètres sont définitivement supprimés.

• Vous obtenez une nouvelle installation avec un tout nouveau mot de passe
• Votre mot de passe actuel cesse de fonctionner
• 💾 Faites d'abord une sauvegarde/instantané si vous avez besoin des données
` + nudge

   if (mode === 'rebuild-emailed') return head + `
⚠️ <strong>CELA EFFACE LE SERVEUR</strong> et le nouveau mot de passe est <b>envoyé par e-mail par le fournisseur</b> — nous ne pouvons pas vous l'afficher ici.

• L'OS est reconstruit : tous les fichiers et données sont définitivement supprimés
• Le fournisseur envoie un nouveau mot de passe au compte d'hébergement (~5 min)
• Pour un accès instantané, utilisez votre clé SSH
` + nudge

   return head + `
✅ <strong>Vos données sont conservées.</strong> Rien n'est effacé — vos fichiers, sites web, bases de données et paramètres restent exactement tels quels. Nous changeons uniquement le mot de passe de connexion sur le serveur <b>en cours d'exécution</b> (pas de réinstallation, pas de redémarrage).

• Un tout nouveau mot de passe est généré et affiché ici même
• Nous l'appliquons, puis nous connectons avec pour confirmer qu'il fonctionne
• Votre mot de passe actuel cesse de fonctionner
• ⏱️ Cela prend environ 20 à 60 secondes
` + nudge
 },

 confirmReinstallWindowsText: name => `🔄 <strong>Réinstaller Windows</strong>

⚠️ <strong>AVERTISSEMENT CRITIQUE :</strong>
• Cela EFFACERA TOUTES LES DONNÉES sur votre RDP
• Tous les fichiers, programmes et paramètres seront supprimés
• Une installation Windows fraîche sera créée
• De nouvelles informations d'identification seront générées
• Votre ancien mot de passe ne fonctionnera PLUS

💾 <strong>Recommandation :</strong> Créez une sauvegarde/instantané avant de continuer.

Voulez-vous réinstaller Windows sur <strong>${name}</strong> ?`,

 passwordResetInProgress: (name, impact = {}) => `🔄 Réinitialisation du mot de passe pour <strong>${name}</strong>...

⏱️ Cela prend généralement 20 à 60 secondes. Veuillez patienter.${
   (impact.mode || 'in-place') === 'in-place'
     ? `

🔒 <i>Le nouveau mot de passe est appliqué sur votre serveur en cours d'exécution — vos données restent intactes.</i>`
     : ''
 }`,

 passwordResetSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const dataPreserved = opts.dataPreserved !== false
   return `✅ <strong>Mot de passe réinitialisé avec succès !</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'Serveur'} :</strong> ${name}
🌐 <strong>IP :</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'Port RDP' : 'Port SSH'} :</strong> <code>${port}</code>
👤 <strong>Nom d'utilisateur :</strong> <code>${username}</code>
🔑 <strong>Nouveau mot de passe :</strong> <code>${password}</code>
${isRDP ? `\n📋 <strong>Connexion :</strong> <code>${ip}:${port}</code>` : `\n📋 <strong>Connexion :</strong> <code>ssh ${username}@${ip} -p ${port}</code>`}
${opts.verified ? '\n✅ Nous nous sommes connectés avec ce mot de passe pour confirmer qu\'il fonctionne.' : ''}
${dataPreserved
   ? '💾 <strong>Vos données n\'ont PAS été touchées</strong> — le mot de passe a été changé sur le serveur en cours d\'exécution.'
   : '⚠️ <strong>L\'OS a été réinstallé</strong>, donc les données précédentes sur le serveur ont disparu.'}

⚠️ <strong>Votre ancien mot de passe ne fonctionne plus.</strong>

🔐 Vous perdez celui-ci plus tard ? Appuyez sur <b>Afficher le mot de passe</b> sur votre VPS — vous pouvez le consulter à tout moment, sans réinitialisation.

💡 Cliquez sur le mot de passe pour le copier.`
 },

 passwordResetEmailed: (name, ip, username, note) => `✅ <strong>Réinitialisation du mot de passe lancée !</strong>

🖥️ <strong>Serveur :</strong> ${name}
🌐 <strong>IP :</strong> ${ip}
👤 <strong>Utilisateur :</strong> ${username}

📧 ${note || 'Un nouveau mot de passe a été envoyé à l’e-mail du compte par le fournisseur (~5 min).'}

🔑 <strong>Pour un accès immédiat, utilisez votre clé SSH.</strong>

⚠️ <i>Remarque : avec ce fournisseur, nous ne pouvons pas afficher le mot de passe ici — il est envoyé par e-mail ou vous vous connectez avec votre clé SSH.</i>`,

 windowsReinstallEmailed: (name, ip, username, note) => `🎉 <strong>Réinstallation de Windows démarrée !</strong>

🖥️ <strong>RDP :</strong> ${name}
🌐 <strong>IP :</strong> ${ip}
👤 <strong>Utilisateur :</strong> ${username}

⏱️ Cela prend 5 à 10 minutes. ${note || 'Le nouveau mot de passe Administrateur sera envoyé par e-mail au compte par le fournisseur.'}

⚠️ Toutes les données précédentes ont été effacées — il s’agit d’une nouvelle installation de Windows.`,

 windowsReinstallInProgress: name => `🔄 Réinstallation de Windows sur <strong>${name}</strong>...

⏱️ Ce processus prend 5 à 10 minutes.
📧 Vous recevrez de nouvelles informations d'identification une fois terminé.`,

 windowsReinstallSuccess: (name, ip, username, password) => `🎉 <strong>Windows réinstallé avec succès !</strong>

🖥️ <strong>RDP :</strong> ${name}
🌐 <strong>IP :</strong> ${ip}
👤 <strong>Nom d'utilisateur :</strong> ${username}
🔑 <strong>Mot de passe :</strong> <code>${password}</code>

⚠️ <strong>CRITIQUE - Enregistrez ce mot de passe maintenant !</strong>
• Nous NE POUVONS PAS le récupérer plus tard pour des raisons de sécurité
• Toutes les données précédentes ont été effacées
• Ceci est une installation Windows fraîche
• Si vous perdez ce mot de passe, vous devez le réinitialiser (utilisez le bouton "Réinitialiser le mot de passe")

💡 Cliquez sur le mot de passe pour le copier.
🚀 Votre RDP est prêt à être utilisé avec ces nouvelles informations d'identification !`,

 passwordResetFailed: name => `❌ <strong>Échec de la réinitialisation du mot de passe</strong>

Échec de la réinitialisation du mot de passe pour <strong>${name}</strong>.

Veuillez réessayer dans quelques minutes ou contacter le support si le problème persiste.`,

 windowsReinstallFailed: name => `❌ <strong>Échec de la réinstallation de Windows</strong>

Échec de la réinstallation de Windows sur <strong>${name}</strong>.

Veuillez réessayer dans quelques minutes ou contacter le support si le problème persiste.`,

 rdpNotSupported: `⚠️ Cette fonctionnalité n'est disponible que pour les instances Windows RDP.

Votre VPS exécute Linux. Utilisez plutôt les clés SSH pour la gestion des accès.`,

 // ── DigitalOcean Windows RDP : durée + édition, réinstallation sur place ──
 rdpDurationBtn: c => (Number(c.period) === 1 ? `1 mois — $${c.price}` : `${c.period} mois — $${c.price}${c.discountPct ? ` (Économisez ${c.discountPct}%)` : ''}`),
 askRdpDuration: (config, cycles) => `📅 <strong>Quelle durée souhaitez-vous prépayer ?</strong>

<strong>${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB NVMe
${cycles.map(c => {
  const per = Number(c.period) || 1
  const base = (Number(config.monthlyPrice) || 0) * per
  const save = per > 1 && base > 0 && Number(c.price) < base ? Math.round((1 - Number(c.price) / base) * 100) : 0
  return `• ${per === 1 ? '1 mois' : `${per} mois`} — <b>$${c.price}</b>${save > 0 ? ` <i>(−${save} %)</i>` : ''}`
}).join('\n')}

Les périodes plus longues sont facturées en une fois et incluent une remise ; le renouvellement automatique refacture la même période à l'échéance.`,
 rdpEditionBtn: o => `🪟 ${o.name}${o.fast_deploy ? ` ⚡ ~${o.eta_minutes || 3} min` : ' ⏳ ~45 min'}`,
 askRdpEdition: options => `🪟 <strong>Choisissez votre édition Windows</strong>

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ prêt en environ ${o.eta_minutes || 3} minutes (image pré-construite dans votre région)` : '⏳ installation complète, environ 45 minutes'}`).join('\n')}

Toutes les éditions sont Windows Server Standard (Expérience utilisateur) avec RDP activé et le compte Administrator.`,
 askReinstallEdition: (name, options) => `🔄 <strong>Réinstaller Windows sur ${name}</strong>

Choisissez l'édition à installer. Votre adresse IP reste la même.

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ environ ${o.eta_minutes || 3} minutes` : '⏳ environ 45 minutes'}`).join('\n')}`,
 confirmReinstallWindowsRdpText: (name, osName, etaMin) => `🔄 <strong>Réinstaller ${osName} sur ${name}</strong>

⚠️ <strong>ATTENTION — le disque sera effacé :</strong>
• Tous les fichiers, programmes et paramètres du serveur sont supprimés
• Un ${osName} neuf est installé depuis notre image pré-construite (~${etaMin} min)
• Un NOUVEAU mot de passe Administrator est généré — l'ancien ne fonctionne plus
• ✅ Votre adresse IP et votre période payée sont conservées

Voulez-vous continuer ?`,
 windowsReinstallStarted: (name, ip, username, password, osName, etaMin) => `🔄 <strong>Réinstallation de ${osName} sur ${name}</strong>

🌐 <strong>IP :</strong> <code>${ip || 'inchangée'}</code>
👤 <strong>Utilisateur :</strong> ${username}
🔑 <strong>Nouveau mot de passe :</strong> <code>${password}</code>

⏱️ Windows s'installe maintenant — connectez-vous avec ces identifiants dans environ <b>${etaMin} minutes</b>.
💡 Touchez le mot de passe pour le copier. Vous pouvez le réafficher à tout moment avec 🔐 Afficher le mot de passe.`,
 rdpActionReason: reason => `\n\n<i>Raison : ${reason}</i>`,
 vpsBeingDeleted: name => `⚙️ Veuillez patienter pendant que votre VPS (${name}) est en cours de suppression`,
 vpsDeleted: name => `✅ Le VPS (${name}) a été supprimé de manière permanente.`,
 failedDeletingVPS: name => `❌ Échec de la suppression du VPS (${name}).

Veuillez réessayer après un certain temps.`,

 upgradeVpsBtn: '⬆️ Mettre à niveau',
 upgradeVpsPlanBtn: '⬆️ Plan VPS',
 upgradeVpsDiskBtn: '📀 Type de disque',
 upgradeVpsDiskTypeBtn: '💾 Mettre à niveau le type de disque',
 upgradeVPS: 'Choisissez le type de mise à niveau',
 upgradeOptionVPSBtn: to => {
 return `🔼 Mettre à niveau vers ${to}`
 },
 upgradeVpsPlanMsg: options => `⚙️ Choisissez un nouveau plan pour augmenter les ressources de votre VPS.
💡 La mise à niveau augmente les vCPUs, la RAM et le stockage, mais elle ne peut pas être annulée.

📌 Mises à niveau disponibles :
${options
 .map(
 planDetails =>
 `<strong>• ${planDetails.from} ➡ ${planDetails.to} –</strong> $${planDetails.monthlyPrice}/mois ($${planDetails.hourlyPrice}/heure)`,
 )
 .join('\n')}

💰 Avis de facturation : Votre plan actuel sera crédité pour les jours inutilisés, et le nouveau tarif s'appliquera pour le reste du cycle de facturation (ajustement au prorata).`,

 alreadyEnterprisePlan:
 "⚠️ Vous êtes déjà sur le plan le plus élevé (Entreprise). Aucune autre mise à niveau n'est possible.",

 alreadyHighestDisk: vpsData =>
 `⚠️ Vous êtes déjà sur le disque le plus élevé disponible (${vpsData.diskTypeDetails.type}). Aucune autre mise à niveau n\'est possible.`,
 newVpsDiskBtn: type => `Mettre à niveau vers ${type}`,
 upgradeVpsDiskMsg: upgrades => `💾 Mettez à niveau votre type de stockage pour de meilleures performances.
⚠️ Les mises à niveau de disque sont permanentes et ne peuvent pas être rétrogradées.

📌 Options disponibles :
${upgrades.map(val => `<strong>• ${val.from} ➡ ${val.to} –</strong> +$${val.price}/${val.duration}`).join('\n')}

💰 Avis de facturation : Si la mise à niveau est appliquée en cours de cycle, un ajustement au prorata sera appliqué pour la portion inutilisée de votre période de facturation actuelle.`,
 upgradePlanSummary: (newData, vpsDetails, lowBal) => `<strong>📜 Résumé de la commande :</strong>

<strong>• ID VPS : </strong> ${vpsDetails.name}
<strong>• Ancien plan : </strong> ${newData.upgradeOption.from}
<strong>• Nouveau plan : </strong> ${newData.upgradeOption.to}
<strong>• Cycle de facturation : </strong> ${newData.billingCycle}
<strong>• Nouveau tarif de facturation : </strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/heure' : ' (ajustement proratisé appliqué)'
 }
<strong>• Date d'effet : </strong> Immédiatement
${
 lowBal
 ? `
💡 Remarque : Un dépôt de $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD est inclus dans votre total. Après la première déduction du tarif horaire, le dépôt restant sera crédité sur votre portefeuille.
`
 : ''
}
<strong>• Prix total : </strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ Confirmer la commande ?</strong>`,

 upgradeDiskSummary: (newData, vpsDetails, lowBal) => `<strong>📜 Résumé de la commande :</strong>

<strong>• VPS ID :</strong> ${vpsDetails.name}
<strong>• Ancien type de disque :</strong> ${newData.upgradeOption.from}
<strong>• Nouveau type de disque :</strong> ${newData.upgradeOption.to}
<strong>• Cycle de facturation :</strong> ${newData.billingCycle}
<strong>• Nouveau tarif :</strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/heure' : ' (ajustement au prorata appliqué)'
 }
${
 lowBal
 ? `
Note : Un dépôt de $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD est inclus dans votre total. Après la première déduction horaire, le dépôt restant sera crédité dans votre portefeuille.
`
 : ''
}
<strong>• Prix total :</strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ Confirmer la commande ?</strong>`,

 vpsSubscriptionData: (vpsData, planExpireDate, panelExpireDate) => {
 const isRDP = !!(vpsData.isRDP || vpsData.osType === 'Windows')
 const months = Number(vpsData.durationMonths) || 1
 const panel = isRDP ? '' : `\n<strong>• Panneau de contrôle ${
 vpsData?.cPanelPlanDetails ? vpsData.cPanelPlanDetails.type : ': Non sélectionné'
 } </strong> ${
 vpsData?.cPanelPlanDetails
 ? `${vpsData?.cPanelPlanDetails.status === 'active' ? '- Expire le : ' : '- Expiré le : '}${panelExpireDate}`
 : ''
 } `
 return `<strong>🗂️ Vos abonnements actifs :</strong>

<strong>• ${isRDP ? '🪟 RDP Windows' : '🐧 VPS Linux'} ${vpsData.name} </strong> – ${isRDP ? `${months === 1 ? 'mensuel' : `${months} mois prépayés`} · ` : ''}Expire le : ${planExpireDate} (Renouvellement automatique : ${
 vpsData.autoRenewable ? 'Activé' : 'Désactivé'
 })${panel}`
 },

 manageVpsSubBtn: "📅 Gérer l'abonnement",
 manageVpsPanelBtn: "🛠️ Gérer l'abonnement au panneau de contrôle",

 vpsSubDetails: (data, date) => `<strong>📅 Détails de l\'abonnement ${data.isRDP || data.osType === 'Windows' ? '🪟 RDP Windows' : '🐧 VPS Linux'} :</strong>

<strong>• Serveur :</strong> ${data.name}
<strong>• Plan :</strong> ${data.planDetails.name}${data.isRDP || data.osType === 'Windows' ? `\n<strong>• Période de facturation :</strong> ${(Number(data.durationMonths) || 1) === 1 ? 'Mensuelle' : `${data.durationMonths} mois (prépayés)`}` : ''}
<strong>• Date d\'expiration actuelle :</strong> ${date}
<strong>• Renouvellement automatique :</strong> ${data.autoRenewable ? 'Activé' : 'Désactivé'}`,

 vpsCPanelDetails: (data, date) => `<strong>📅 Détails de l'abonnement au panneau de contrôle :</strong>

<strong>• ID VPS lié :</strong> ${data.name}
<strong>• Type de panneau de contrôle :</strong> ${data.cPanelPlanDetails.type} (${data.cPanelPlanDetails.name})
<strong>• Date d'expiration actuelle :</strong> ${date}
<strong>• Renouvellement automatique :</strong> ${data.autoRenewable ? 'Activé' : 'Désactivé'}
`,

 vpsEnableRenewalBtn: '🔄 Activer le renouvellement automatique',
 vpsDisableRenewalBtn: '❌ Désactiver le renouvellement automatique',
 vpsPlanRenewBtn: '📅 Renouveler maintenant',
 unlinkVpsPanelBtn: '❌ Dissocier du VPS',
 bankPayVPSUpgradePlan: (priceNGN, vpsDetails) =>
 `Veuillez effectuer un paiement de ${priceNGN} NGN en cliquant sur "Effectuer le paiement" ci-dessous. Une fois la transaction confirmée, vous serez immédiatement informé, et votre nouveau plan VPS ${vpsDetails.upgradeOption.to} sera activé sans interruption.`,

 bankPayVPSUpgradeDisk: (priceNGN, vpsDetails) =>
 `Veuillez verser ${priceNGN} NGN en cliquant sur “Effectuer le paiement” ci-dessous. Une fois la transaction confirmée, vous serez rapidement informé, et votre plan VPS avec le nouveau type de disque ${vpsDetails.upgradeOption.toType} sera activé sans problème.`,

 showDepositCryptoInfoVpsUpgrade: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>Montant du paiement : ${Number(priceUsd).toFixed(2)} $ USD</b>

Envoyez exactement <b>${priceCrypto} ${tickerView}</b> à :

<code>${address}</code>

Votre plan VPS mis à niveau sera activé automatiquement une fois le paiement confirmé (généralement en quelques minutes).

Cordialement,
${CHAT_BOT_NAME}`,

 linkVpsSSHKeyBtn: '➕ Lier une nouvelle clé',
 unlinkSSHKeyBtn: '❌ Dissocier la clé',
 downloadSSHKeyBtn: '⬇️ Télécharger la clé',

 noLinkedKey: name => `⚠️ Il n\'y a actuellement aucune clé SSH associée à ce VPS [${name}]. 

Veuillez lier une clé SSH à votre compte pour permettre un accès sécurisé.`,

 linkedKeyList: (list, name) => `🗂️ Clés SSH liées au VPS ${name} :

${list.map(val => `<strong>• ${val}</strong>`).join('\n')}`,

 unlinkSSHKeyList: name => `🗂️ Sélectionnez une clé SSH à supprimer du VPS [${name}] :`,
 confirmUnlinkKey: data => `⚠️ Êtes-vous sûr de vouloir dissocier [${data.keyForUnlink}] du VPS [${data.name}] ?`,
 confirmUnlinkBtn: '✅ Confirmer la dissociation',
 keyUnlinkedMsg: data => `✅ La clé SSH [${data.keyForUnlink}] a été dissociée du VPS [${data.name}].`,
 failedUnlinkingKey: data => `❌ Échec de la dissociation de la clé SSH du VPS (${data.name}). 

Veuillez réessayer plus tard.`,

 userSSHKeyList: name => `🗂️ Sélectionnez une clé SSH à lier au VPS [${name}] :`,
 noUserKeyList: `🔑 Aucune clé SSH détectée. Voulez-vous en télécharger une nouvelle ?`,
 linkKeyToVpsSuccess: (key, name) => `✅ La clé SSH [${key}] a été liée avec succès au VPS [${name}].`,
 failedLinkingSSHkeyToVps: (key, name) => `❌ Échec de la liaison de la clé SSH [${key}] au VPS (${name}). 

Veuillez réessayer plus tard.`,

 selectSSHKeyToDownload: '🗂️ Sélectionnez la clé SSH que vous souhaitez télécharger :',

 disabledAutoRenewal: (
 data,
 expiryDate,
 ) => `⚠️ Le renouvellement automatique est désactivé. Votre VPS expirera le ${expiryDate} à moins d'un renouvellement manuel.
✅ Renouvellement automatique désactivé avec succès.`,

 enabledAutoRenewal: (data, expiryDate) =>
 `✅ Renouvellement automatique activé. Votre VPS sera automatiquement renouvelé le ${expiryDate}.`,

 renewVpsPlanConfirmMsg: (data, vpsDetails, expiryDate, lowBal) => `<strong>📜 Résumé de la facture</strong>

<strong>• ID VPS :</strong> ${vpsDetails.name}
<strong>• Plan :</strong> ${vpsDetails.planDetails.name}
<strong>• Cycle de facturation :</strong> ${vpsDetails.billingCycleDetails.type}
<strong>• Date d'expiration actuelle :</strong> ${expiryDate}
<strong>• Montant dû :</strong> ${data.totalPrice} USD

${
 lowBal
 ? `Remarque : Un dépôt de $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD est inclus dans votre total. Après la déduction du premier tarif horaire, le reste du dépôt sera crédité sur votre portefeuille.`
 : ''
}

<strong>• Prix total :</strong> $${
 lowBal
 ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE
 : data.totalPrice
 } USD

<strong>💳 Procéder au renouvellement du VPS ?</strong>`,

 payNowBtn: '✅ Payer maintenant',

 vpsChangePaymentRecieved: `✅ Paiement réussi ! Votre VPS est en cours de configuration. Les détails seront bientôt disponibles.`,

 bankPayVPSRenewPlan: priceNGN =>
 `Veuillez envoyer ${priceNGN} NGN en cliquant sur "Effectuer le paiement" ci-dessous. Une fois la transaction confirmée, vous serez immédiatement notifié et votre plan VPS sera activé et renouvelé.`,

 renewVpsPanelConfirmMsg: (
 data,
 panelDetails,
 date,
 ) => `<strong>💳 Procéder au renouvellement du panneau de contrôle ?</strong>

<strong>📜 Résumé de la facture</strong>
 <strong>• ID VPS lié :</strong> ${data.name}
 <strong>• Panneau de contrôle :</strong> ${panelDetails.type}
 <strong>• Période de renouvellement :</strong> ${panelDetails.durationValue}${' '}Mois
 <strong>• Date d'expiration actuelle :</strong> ${date}
 <strong>• Montant dû :</strong> ${data.totalPrice} USD`,

 bankPayVPSRenewCpanel: (priceNGN, vpsDetails) =>
 `Veuillez envoyer ${priceNGN} NGN en cliquant sur "Effectuer le paiement" ci-dessous. Une fois la transaction confirmée, vous serez immédiatement notifié et votre plan VPS sera activé et le panneau de contrôle ${vpsDetails.cPanelPlanDetails.type} sera renouvelé.`,

 vpsUnlinkCpanelWarning: vpsDetails =>
 `⚠️ Avertissement : Dissocier supprimera la licence ${vpsDetails.cPanel} du VPS ${vpsDetails.name}, et vous perdrez l'accès à ses fonctionnalités. Voulez-vous continuer ?`,

 unlinkCpanelConfirmed: data => `✅ Panneau de contrôle ${data.cPanel} dissocié avec succès du VPS ${data.name}.`,

 errorUpgradingVPS: vpsName => `Une erreur s'est produite lors de la mise à niveau de votre plan VPS ${vpsName}.

Veuillez appuyer sur 💬 Obtenir de l'aide.
En savoir plus ${TG_HANDLE}.`,

 vpsUpgradePlanTypeSuccess: vpsDetails => `
✅ VPS ${vpsDetails.name} mis à niveau vers ${vpsDetails.upgradeOption.to}. Vos nouvelles ressources sont maintenant disponibles.`,

 vpsUpgradeDiskTypeSuccess: vpsDetails =>
 `✅ Disque mis à niveau vers ${vpsDetails.upgradeOption.to} pour le VPS ${vpsDetails.name}. Votre nouveau type de disque est maintenant actif.`,
 vpsRenewPlanSuccess: (vpsDetails, expiryDate) =>
 `✅ L'abonnement VPS pour ${vpsDetails.name} a été renouvelé avec succès !

• Nouvelle date d'expiration : ${expiryDate}
`,
 vpsRenewCPanelSuccess: (vpsDetails, expiryDate) =>
 `✅ Abonnement au panneau de contrôle pour ${vpsDetails.name} renouvelé avec succès !

• Nouvelle date d'expiration : ${expiryDate}
`,
}

const fr = {
 k,
 t,
 u,
 dO,
 bc,
 npl,
 dns,
 kOf,
 user,
 show,
 yesNo,
 html,
 payIn,
 admin,
 payOpts,
 yes_no,
 payBank,
 alcazar,
 planOptionsOf,
 tickerOf,
 linkType,
 tickerViews,
 linkOptions,
 planOptions,
 tickerViewOf,
 dnsRecordType,
 dnsQuickActionKeyboard,
 dnsMxPriorityKeyboard,
 dnsSubdomainTargetTypeKeyboard,
 dnsQuickActions: t.dnsQuickActions,
 getRecordTypeKeyboard,
 dnsCaaTagKeyboard,
 dnsSrvDefaultsKeyboard,
 o: userKeyboard,
 phoneNumberLeads,
 aO: adminKeyboard,
 chooseSubscription,
 buyLeadsSelectArea,
 buyLeadsSelectCnam,
 buyLeadsSelectAmount,
 buyLeadsSelectFormat,
 buyLeadsSelectCountry,
 buyLeadsSelectCarrier,
 buyLeadsSelectSmsVoice,
 buyLeadsSelectAreaCode,
 _buyLeadsSelectAreaCode,
 validatorSelectCountry,
 validatorSelectSmsVoice,
 validatorSelectCarrier,
 validatorSelectCnam,
 validatorSelectAmount,
 validatorSelectFormat,
 redSelectRandomCustom,
 redSelectProvider,
 supportedCrypto,
 supportedCryptoView,
 supportedCryptoViewOf,
 languageMenu,
 supportedLanguages,
 l,
 termsAndConditionType,
 hP: hostingPlansText,
 selectFormatOf,
 vs,
 vp,
 vpsPlanOf,
 vpsCpanelOptional,
}

// ── Localization parity (#21, 2026-06) ────────────────────────────────
// Close FR gaps that previously fell back to English mid-flow:
//  • reverse record-type map t[t.a]='A' … keyed by THIS locale's own labels
//    (the DNS "add record" wizard reads t[recordType]; without these, FR users
//    got undefined and the flow broke),
//  • Cloudflare proxied-mode strings + keyboard,
//  • VPS "SSH blocked" help.
Object.assign(t, {
  [t.a]: 'A',
  [t.aaaa]: 'AAAA',
  [t.cname]: 'CNAME',
  [t.mx]: 'MX',
  [t.txt]: 'TXT',
  [t.ns]: 'NS',
  [t.srvRecord]: 'SRV',
  [t.caaRecord]: 'CAA',
  [t.caaTagIssue]: 'issue',
  [t.caaTagIssuewild]: 'issuewild',
  [t.caaTagIodef]: 'iodef',
  dnsProxiedChoiceLabelDnsOnly: '⚪ DNS uniquement (Recommandé)',
  dnsProxiedChoiceLabelProxied: '🟠 Proxifié via Cloudflare',
  dnsProxiedChoiceInvalid: "Veuillez appuyer sur l'un des boutons : ⚪ DNS uniquement ou 🟠 Proxifié via Cloudflare.",
  dnsProxiedChoiceAsk: (recordType, value) =>
    `⚙️ <b>Mode Cloudflare pour cet enregistrement ${recordType}</b>\n\n` +
    `Cible : <code>${value}</code>\n\n` +
    `⚪  <b>DNS uniquement</b> (recommandé)\n` +
    `<i>Les requêtes renvoient directement votre IP d'origine. Idéal pour pointer vers votre propre VPS, serveur mail, ou lorsqu'un accès direct à la cible est nécessaire.</i>\n\n` +
    `🟠  <b>Proxifié via Cloudflare</b>\n` +
    `<i>Cloudflare protège votre origine — SSL gratuit, cache CDN, protection DDoS, et votre IP d'origine reste masquée. Idéal pour les sites publics.</i>`,
})
Object.assign(fr, {
  dnsProxiedChoiceKeyboard: {
    parse_mode: 'HTML',
    reply_markup: { keyboard: [[t.dnsProxiedChoiceLabelDnsOnly], [t.dnsProxiedChoiceLabelProxied], _bc], resize_keyboard: true },
    disable_web_page_preview: true,
  },
})
Object.assign(vp, {
  vpsSshBlockedHelp: (name, host, username) =>
    `🟠 <strong>Votre VPS est en ligne — mais SSH est bloqué</strong>\n\n` +
    `🖥️ <strong>Serveur :</strong> ${name}\n` +
    `🌐 <strong>IP :</strong> <code>${host}</code>\n\n` +
    `Nous avons atteint votre serveur (il fonctionne), mais <b>le port 22 (SSH) est fermé par un pare-feu à l'intérieur du serveur</b>. C'est pourquoi la connexion et la réinitialisation du mot de passe ne fonctionnent pas — aucun mot de passe ne peut passer par un port fermé.\n\n` +
    `✅ <strong>Comment le rouvrir (2 minutes) :</strong>\n` +
    `1. Ouvrez la <b>Console de récupération / Web</b> de votre fournisseur pour ce serveur (sans SSH).\n` +
    `2. Connectez-vous en tant que <code>${username}</code>.\n` +
    `3. Exécutez : <code>ufw allow OpenSSH</code>  (ou <code>ufw allow 22/tcp</code>)\n` +
    `4. Puis exécutez : <code>ufw reload</code>\n\n` +
    `Une fois le port 22 ouvert, revenez et appuyez sur <b>🔑 Réinitialiser le mot de passe</b> — nous définirons un nouveau mot de passe sur le serveur en marche et confirmerons qu'il fonctionne, vos données conservées.\n\n` +
    `💬 Bloqué ? Appuyez sur <b>💬 Support</b> et nous le rouvrirons pour vous.`,
})

module.exports = {
 fr,
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ Définir des serveurs de noms personnalisés pour ${domain}</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>Actuel:</b>\n`
 nsRecords.forEach((ns, i) => {
 msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n`
 })
 msg += '\n'
 }
 msg += `Entrez les nouveaux serveurs de noms (un par ligne, min 2, max 4):\n\n<i>Exemple:\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare : copiez les noms <b>tels quels</b> depuis votre tableau de bord (ex. <code>leanna.ns.cloudflare.com</code>). N'<b>ajoutez pas</b> de préfixe <code>ns1./ns2.</code>.</i>`
 return msg
 },
 Hosting: 'Hébergement',
}
