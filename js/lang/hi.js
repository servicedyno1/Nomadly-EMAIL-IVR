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
 ...(process.env.RESELLER_PAYOUT_BOTS ? { resellerPayouts: '💸 रीसेलर भुगतान' } : {}),
}
const user = {
 // main keyboards
 cPanelWebHostingPlans: 'रूस HostPanel होस्टिंग प्लान',
 pleskWebHostingPlans: 'रूस Plesk होस्टिंग प्लान',
 joinChannel: '📢 चैनल जॉइन करें',
 phoneNumberLeads: '🎯 लीड्स खरीदें | अपने सत्यापित करें',
 buyLeads: '🎯 लीड्स खरीदें',
 validateLeads: '✅ नंबर सत्यापित करें',
 leadsValidation: '📱 SMS लीड्स',
 hostingDomainsRedirect: '🛡️ Anti-Red होस्टिंग',
 wallet: '👛 वॉलेट',
 urlShortenerMain: '🔗 URL शॉर्टनर',
 domainNames: '🌐 बुलेटप्रूफ डोमेन',
 viewPlan: '📋 मेरी योजनाएं',
 becomeReseller: '💼 रीसेलर',
 getSupport: '💬 सहायता',
 cloudPhone: '📞 Cloud IVR + SIP',
 testSip: '🧪 SIP मुफ्त टेस्ट',
 vpsPlans: '🖥️ VPS / RDP',
 buyPlan: '⭐ सदस्यता',
 more: '➕ और',
 freeTrialAvailable: '🆓 BulkSMS फ्री ट्रायल',
 smsAppMain: '📱 BulkSMS',
 smsCreateCampaign: '📱 अभियान बनाएं',
 smsMyCampaigns: '📋 मेरे अभियान',
 smsDownloadApp: '📲 ऐप डाउनलोड',
 smsResetLogin: '🔓 लॉगिन रीसेट',
 smsManageDevices: '📱 डिवाइस प्रबंधित करें',
 smsHowItWorks: '❓ कैसे काम करता है',
 smsAppSettings: '⚙️ SMS सेटिंग्स',
 changeSetting: '⚙️ सेटिंग्स',
 changeLanguage: '🌍 भाषा बदलें',

 // Sub Menu 1: urlShortenerMain
 redSelectUrl: '🔀✂️ रीडायरेक्ट और छोटा करें',
 redBitly: '✂️ Bit.ly',
 redShortit: '✂️ Shortit (परीक्षण)',
 urlShortener: '✂️🌐 कस्टम डोमेन शॉर्टनर',
 viewShortLinks: '📊 शॉर्टलिंक एनालिटिक्स देखें',
 activateDomainShortener: '🔗 शॉर्टनर के लिए डोमेन सक्रिय करें',

 // Sub Menu 6: Digital Products
 digitalProducts: '🛒 डिजिटल उत्पाद',
 marketplace: '🏪 मार्केटप्लेस',
 shippingLabel: '📦 शिपिंग और मेल',
 emailBlast: '📧 ईमेल ब्लास्ट',
 emailValidation: '📧 ईमेल सत्यापन',
 serviceBundles: '🎁 सर्विस बंडल',
 referEarn: '🤝 रेफर करें और कमाएं',
 virtualCard: '💳 वर्चुअल कार्ड',

 // Sub Menu 2: domainNames
 buyDomainName: '🛒🌐 डोमेन नाम खरीदें',
 viewDomainNames: '📂 मेरे डोमेन नाम',
 dnsManagement: '🔧 DNS प्रबंधन',

 // Sub Menu 3: cPanel/Plesk WebHostingPlansMain
 freeTrial: '💡 फ्री ट्रायल',
 premiumWeekly: '🔼 Premium Anti-Red (1 सप्ताह)',
 premiumCpanel: '🔷 Premium Anti-Red HostPanel (30 दिन)',
 goldenCpanel: '👑 Golden Anti-Red HostPanel (30 दिन)',
 contactSupport: '📞 समर्थन से संपर्क करें',

 // Sub Menu 4: VPS Plans
 buyVpsPlan: '⚙️ VPS / RDP बनाएँ',
 buyLinuxVpsBtn: '🐧 Linux VPS बनाएँ',
 buyRdpBtn: '🪟 Windows RDP बनाएँ',
 manageVpsPlan: '🖥️ मेरे सर्वर प्रबंधित करें',
 vpsRdpMenuPrompt: `🖥️ <b>क्लाउड VPS / Windows RDP</b>

दो अलग प्रोडक्ट, दो अलग प्लान सूचियाँ:
🐧 <b>Linux VPS</b> — SSH एक्सेस · वेब होस्टिंग · डेव · ऑटोमेशन
🪟 <b>Windows RDP</b> — रिमोट डेस्कटॉप · Windows लाइसेंस शामिल · 1/2/3 महीने प्रीपेड · ~3 मिनट में तैयार

पोर्ट 25 खुला · बुलेटप्रूफ होस्टिंग। कृपया एक विकल्प चुनें:`,
 manageVpsSSH: '🔑 SSH कुंजी',

 // Free Trial
 freeTrialMenuButton: '🚀 फ्री ट्रायल (12 घंटे)',
 getFreeTrialPlanNow: '🛒 अभी ट्रायल प्लान प्राप्त करें',
 continueWithDomainNameSBS: websiteName => `➡️ ${websiteName} के साथ जारी रखें`,
 searchAnotherDomain: '🔍 दूसरा डोमेन खोजें',
 privHostNS: '🏢 PrivHost (तेज़ और सुरक्षित होस्टिंग)',
 cloudflareNS: '🛡️ Cloudflare शील्ड (सुरक्षा और गुप्तता)',
 backToFreeTrial: '⬅️ फ्री ट्रायल पर वापस जाएं',

 // Paid Plans
 buyPremiumWeekly: '🛒 🛒 स्टार्टर प्लान खरीदें',
 buyPremiumCpanel: '🛒 🛒 प्रो प्लान खरीदें',
 buyGoldenCpanel: '🛒 🛒 बिज़नेस प्लान खरीदें',
 viewPremiumWeekly: '🔷 स्टार्टर प्लान देखें',
 viewPremiumCpanel: '🔼 प्रो प्लान देखें',
 viewGoldenCpanel: '👑 बिज़नेस प्लान देखें',
 backToHostingPlans: '⬅️ होस्टिंग प्लान्स पर वापस जाएं',
 registerANewDomain: '🌐 नया डोमेन पंजीकृत करें',
 useMyDomain: '📂 मेरा डोमेन उपयोग करें',
 connectExternalDomain: '🔗 बाहरी डोमेन कनेक्ट करें',
 useExistingDomain: '🔄 मौजूदा डोमेन का उपयोग करें',
 backToPremiumWeeklyDetails: '⬅️ स्टार्टर प्लान विवरण पर वापस जाएं',
 backToPremiumCpanelDetails: '⬅️ प्रो प्लान विवरण पर वापस जाएं',
 backToGoldenCpanelDetails: '⬅️ बिज़नेस प्लान विवरण पर वापस जाएं',
 continueWithDomain: websiteName => `➡️ ${websiteName} के साथ जारी रखें`,
 enterAnotherDomain: '🔍 दूसरा डोमेन दर्ज करें',
 backToPurchaseOptions: '⬅️ खरीद विकल्पों पर वापस जाएं',
 myHostingPlans: '📋 मेरे होस्टिंग प्लान',
 billingMenu: '💳 मेरा प्लान / बिलिंग',
 backToBillingMenu: '⬅️ बिलिंग पर वापस',
 revealCredentials: '🔑 क्रेडेंशियल दिखाएं',
 manageVisitorCaptcha: '🛡️ Captcha चालू/बंद',
 manageVisitorCaptchaLocked: '🔒 Captcha चालू/बंद — केवल Gold प्लान',
 manageHoneypot: '🍯 Honeypot ट्रैप चालू/बंद',
 manageHoneypotLocked: '🔒 Honeypot ट्रैप चालू/बंद — केवल मासिक प्लान',
 renewHostingPlan: '🔄 प्लान नवीनीकरण',
 upgradeHostingPlan: '⬆️ प्लान अपग्रेड',
 backToMyHostingPlans: '⬅️ मेरे प्लान पर वापस',
 buyLeads: '🎯 फ़ोन लीड्स खरीदें',
 validateLeads: '✅ नंबर सत्यापित करें',
 shortenLink: '✂️ लिंक छोटा करें',
 confirmRenewNow: '✅ पुष्टि करें और भुगतान करें',
 cancelRenewNow: '❌ रद्द करें',
 toggleAutoRenew: '🔁 ऑटो-रिन्यू चालू/बंद',
 unlinkDomain: '🗑️ डोमेन अनलिंक करें',
 addDomainToPlan: '➕ प्लान में डोमेन जोड़ें',
 changePrimaryDomain: '🔄 प्राथमिक डोमेन बदलें',
 confirmChangePrimaryBtn: '✅ हाँ, बदलें',
 confirmAttachBtn: '✅ हाँ, जोड़ें',
 cancelHostingPlan: '🚫 होस्टिंग प्लान रद्द करें',
 takeSiteOffline: '🔌 साइट ऑफलाइन करें',
 bringSiteOnline: '🌐 साइट ऑनलाइन लाएँ',
 siteOfflineModeMaintenance: '🛠️ रखरखाव मोड (अनुशंसित)',
 siteOfflineModeSuspend: '🚫 पूर्ण सस्पेंड (HTTP + ईमेल + FTP + DB)',
 confirmTakeOfflineBtn: '✅ हाँ, ऑफलाइन करें',
 confirmBringOnlineBtn: '✅ हाँ, ऑनलाइन लाएँ',
 confirmUnlinkBtn: '✅ हाँ, अनलिंक करें',
 confirmCancelHostingBtn: '🗑️ हाँ, प्लान रद्द करें',
 cancelGoBackBtn: '⬅️ नहीं, वापस जाएँ',
}

const u = {
 // other key boards
 deposit: '➕💵 जमा',
 withdraw: '➖💵 वापस लें',
 myTier: '🏆 मेरा स्तर',
 txHistory: '📜 लेनदेन',

 // wallet
 usd: 'USD',
 ngn: 'NGN',

 // deposit methods
 depositBank: '🏦 बैंक (नायरा)',
 depositCrypto: '₿ क्रिप्टो',
}
const view = num => Number(num).toFixed(2)
const yesNo = ['हाँ', 'नहीं']

const bal = (usd) => `$${view(usd)}`

const dnsEntryFormat = '' // deprecated — A/CNAME now use multi-step wizard

const t = {
 yes: '✅ हाँ',
 no: '❌ नहीं',
 back: 'वापस',
 cancel: '❌ रद्द करें',
 skip: 'छोड़ें',
 becomeReseller: (() => {
 const services = ['URL शॉर्टनिंग', 'डोमेन पंजीकरण']
 if (process.env.PHONE_SERVICE_ON === 'true') services.push('Cloud IVR')
 if (HIDE_SMS_APP !== 'true') services.push('बल्कSMS')
 if (process.env.OFFSHORE_HOSTING_ON !== 'false') services.push('ऑफशोर होस्टिंग')
 return `<b>${CHAT_BOT_BRAND} पुनर्विक्रेता बनें</b>

हमारी पूरी सेवा — ${services.join(', ')} — अपने ब्रांड के तहत बेचें।

हर बिक्री पर <b>50/50</b> लाभ बँटवारा।

🤖 <b>रीसेलिंग के बारे में हमारे AI असिस्टेंट से कुछ भी पूछें</b> — बस नीचे अपना सवाल लिखें। ज़रूरत होने पर हमारी टीम का कोई सदस्य जुड़ जाएगा।

यह चैट बंद करने के लिए /done भेजें।`
 })(),
 resetLoginAdmit: `${CHAT_BOT_BRAND} एसएमएस: आप अपने पिछले डिवाइस से सफलतापूर्वक लॉग आउट हो गए हैं। कृपया अब लॉग इन करें।`,
 resetLoginDeny: 'ठीक है। किसी और कार्रवाई की आवश्यकता नहीं।',
 resetLogin: `${CHAT_BOT_BRAND}SMS: क्या आप अपने पिछले डिवाइस से लॉग आउट करने की कोशिश कर रहे हैं?`,
 select: `कृपया एक विकल्प चुनें:`,
 urlShortenerSelect: `अपने लिंक छोटा करें, ब्रांड करें या ट्रैक करें:`,

 // cPanel/Plesk Plans initial select plan text
 selectPlan: `कृपया एक योजना चुनें:`,
 backButton: '⬅️ वापस',
 skipEmail: 'छोड़ें (कोई ईमेल नहीं)',
 yesProceedWithThisEmail: email => `➡️ ${email} के साथ आगे बढ़ें`,
 proceedWithPayment: '➡️ भुगतान के साथ आगे बढ़ें',
 iHaveSentThePayment: `मैंने भुगतान भेज दिया है ✅`,
 trialAlreadyUsed: `आपने पहले ही अपना मुफ्त ट्रायल उपयोग कर लिया है। यदि आपको अधिक पहुंच की आवश्यकता है, तो कृपया हमारे किसी भुगतान वाले योजना की सदस्यता लेने पर विचार करें।`,
 oneHourLeftToExpireTrialPlan: `आपकी Freedom योजना 1 घंटे में समाप्त होने वाली है। यदि आप हमारी सेवाओं का उपयोग जारी रखना चाहते हैं, तो भुगतान योजना में अपग्रेड करने पर विचार करें!`,
 freePlanExpired: `🚫 आपकी Freedom योजना समाप्त हो गई है। हमें उम्मीद है कि आपने अपना ट्रायल पसंद किया होगा। हमारी सेवाओं का उपयोग जारी रखने के लिए, कृपया हमारे प्रीमियम योजनाओं में से एक खरीदें।`,
 freeTrialPlanSelected: hostingType => `
- हमारे <b>Freedom योजना</b> को निःशुल्क आज़माएं! इस योजना में एक निःशुल्क डोमेन शामिल है, जिसका अंत .sbs पर होता है और यह 12 घंटे के लिए सक्रिय रहेगा।

🚀 <b>Freedom योजना:</b>
<b>- स्टोरेज:</b> 1 GB SSD
<b>- बैंडविड्थ:</b> 10 GB
<b>- डोमेन:</b> 1 निःशुल्क .sbs डोमेन
<b>- ईमेल खाते:</b> 1 ईमेल खाता
<b>- डेटाबेस:</b> 1 MySQL डेटाबेस
<b>- मुफ्त SSL:</b> हां
<b>- HostPanel सुविधाएँ:</b> HostPanel के लिए फ़ाइलें, डेटाबेस और ईमेल प्रबंधित करने हेतु पूर्ण पहुंच।
<b>- अवधि:</b> 12 घंटे तक सक्रिय
<b>- आदर्श उपयोग:</b> परीक्षण और लघुकालीन परियोजनाओं के लिए।
 `,

 getFreeTrialPlan: `कृपया अपनी इच्छित डोमेन नाम (उदा., example.sbs) दर्ज करें और इसे संदेश के रूप में भेजें। यह डोमेन .sbs में समाप्त होगा और आपके ट्रायल प्लान के साथ मुफ्त है।`,
 trialPlanContinueWithDomainNameSBSMatched: websiteName => `डोमेन ${websiteName} उपलब्ध है!`,
 trialPlanSBSDomainNotMatched: `आपके द्वारा दर्ज किया गया डोमेन नहीं मिला। कृपया सही डोमेन सुनिश्चित करें या किसी अन्य का उपयोग करें।`,
 trialPlanSBSDomainIsPremium: `डोमेन प्रीमियम मूल्य पर है और केवल भुगतान योजना के साथ उपलब्ध है। कृपया अन्य डोमेन खोजें।`,
 trialPlanGetNowInvalidDomain: `कृपया एक मान्य डोमेन नाम दर्ज करें जो '.sbs' पर समाप्त होता है। डोमेन 'example.sbs' जैसा दिखना चाहिए और आपके ट्रायल प्लान के साथ मुफ्त है।`,
 trialPlanNameserverSelection: websiteName => `कृपया ${websiteName} के लिए उपयोग करने के लिए नाम सर्वर प्रदाता चुनें।`,
 trialPlanDomainNameMatched: `कृपया अपना खाता बनाने और अपनी रसीद भेजने के लिए अपना ईमेल पता प्रदान करें।`,
 confirmEmailBeforeProceedingSBS: email =>
 `क्या आप निश्चित हैं कि आप इस ${email} ईमेल के साथ Freedom योजना सदस्यता के लिए आगे बढ़ना चाहते हैं?`,
 trialPlanInValidEmail: `कृपया एक मान्य ईमेल प्रदान करें।`,
 trialPlanActivationConfirmation: `धन्यवाद! आपका मुफ्त ट्रायल प्लान जल्द ही सक्रिय होगा। कृपया ध्यान दें, यह योजना केवल 12 घंटे के लिए सक्रिय रहेगी।`,
 trialPlanActivationInProgress: `आपका मुफ्त ट्रायल प्लान सक्रिय हो रहा है। इसमें कुछ क्षण लग सकते हैं...`,

 what: `यह विकल्प अभी उपलब्ध नहीं है। कृपया नीचे दिए बटनों में से चुनें।`,
 whatNum: `कृपया एक मान्य संख्या चुनें।`,
 phoneGenTimeout: `समय समाप्त।`,
 phoneGenNoGoodHits: `कृपया 💬 सहायता प्राप्त करें बटन दबाएं या किसी अन्य क्षेत्र कोड का चयन करें।`,

 subscribeRCS: p =>
 `सदस्यता ली गई! ${p} पर क्लिक करके कभी भी <a href="${SELF_URL}/unsubscribe?a=b&Phone=${p}">लिंक</a> से सदस्यता समाप्त करें।`,
 unsubscribeRCS: p =>
 `आपने सदस्यता समाप्त कर दी है! पुनः सदस्यता लेने के लिए <a href="${SELF_URL}/subscribe?a=b&Phone=${p}">लिंक</a> पर क्लिक करें।`,
 argsErr: `डिव: गलत तर्क भेजे गए।`,
 showDepositNgnInfo:
 ngn => `कृपया नीचे "भुगतान करें" पर क्लिक करके ${ngn} NGN भेजें। एक बार लेन-देन की पुष्टि हो जाने पर, आपको तुरंत सूचित किया जाएगा और आपका वॉलेट अपडेट कर दिया जाएगा।

सादर, 
${CHAT_BOT_NAME}`,
 askEmail: `कृपया भुगतान पुष्टि के लिए एक ईमेल प्रदान करें।`,
 askValidAmount: 'कृपया एक मान्य संख्या प्रदान करें।',
 askValidEmail: 'कृपया एक मान्य ईमेल प्रदान करें।',
 askValidCrypto: 'कृपया एक मान्य क्रिप्टो करेंसी चुनें।',
 askValidPayOption: 'कृपया एक मान्य भुगतान विकल्प चुनें।',
 chooseSubscription: buildChooseSubscription('hi'),

 askCoupon: usd =>
 `मूल्य $${view(usd)} है। क्या आप कूपन कोड लगाना चाहेंगे? यदि आपके पास है, तो कृपया इसे अभी दर्ज करें। अन्यथा, "स्किप" पर क्लिक करें।`,
 planAskCoupon: `क्या आप कूपन कोड लगाना चाहेंगे? यदि आपके पास है, तो कृपया इसे अभी दर्ज करें। अन्यथा, "स्किप" पर क्लिक करें।`,
 enterCoupon: `कृपया एक कूपन कोड दर्ज करें:`,
 planPrice: (plan, price) => `${plan} सब्सक्रिप्शन की कीमत $${price} है। कृपया भुगतान विधि चुनें।`,
 planNewPrice: (plan, price, newPrice) =>
 `${plan} सब्सक्रिप्शन की कीमत अब $${view(newPrice)} <s>($${price})</s> है। कृपया भुगतान विधि चुनें।`,
 domainPrice: (domain, price) => `${domain} डोमेन की कीमत $${price} USD है। भुगतान विधि चुनें।`,
 domainNewPrice: (domain, price, newPrice) =>
 `${domain} डोमेन की कीमत अब $${view(newPrice)} <s>($${price})</s> है। भुगतान विधि चुनें।`,
 couponInvalid: `अमान्य कूपन कोड। कृपया पुनः कूपन कोड दर्ज करें:`,
 lowPrice: `भेजी गई कीमत आवश्यक से कम है।`,
 freeTrialAvailable: (chatId) => `📱 <b>BulkSMS फ्री ट्रायल — 100 मुफ्त SMS</b>\n\nआपका एक्टिवेशन कोड:\n<code>${chatId}</code>\n\n📲 <b>ऐप डाउनलोड करें:</b> ${SMS_APP_LINK}\n\nऐप खोलें → कोड दर्ज करें → भेजना शुरू करें!\n\n⚡ ट्रायल: केवल 1 डिवाइस। अपग्रेड करें — 10 डिवाइस तक।\n\neSIM कार्ड चाहिए? 💬 सहायता प्राप्त करें दबाएं`,
 freeTrialNotAvailable: `आप पहले ही नि:शुल्क परीक्षण का उपयोग कर चुके हैं।`,

 smsAppMenuSubscribed: (chatId) => `📧 <b>BulkSMS — सक्रिय ✅</b>\n\n📱 <i>केवल Android डिवाइस पर काम करता है (iOS / iPhone समर्थित नहीं)।</i>\n\nआपके फोन की SIM कार्ड से SMS भेजता है — उच्च डिलीवरी, असली सेंडर ID।\n\n📲 <b>ऐप:</b> ${SMS_APP_LINK}\n🔑 <b>कोड:</b> <code>${chatId}</code>\n\nनीचे या ऐप में अभियान बनाएं।\nनए हैं? <b>❓ कैसे काम करता है</b> दबाएं`,
 smsAppMenuTrial: (chatId, remaining) => `📧 <b>BulkSMS — फ्री ट्रायल</b> (${remaining} SMS शेष)\n\n📱 <i>केवल Android डिवाइस पर काम करता है (iOS / iPhone समर्थित नहीं)।</i>\n\nआपके फोन की SIM कार्ड से SMS भेजता है — उच्च डिलीवरी, असली सेंडर ID।\n\n📲 <b>ऐप:</b> ${SMS_APP_LINK}\n🔑 <b>कोड:</b> <code>${chatId}</code>\n\nनए हैं? <b>❓ कैसे काम करता है</b> दबाएं`,
 smsAppMenuExpired: `📧 <b>BulkSMS</b>\n\n📱 <i>केवल Android डिवाइस पर काम करता है (iOS / iPhone समर्थित नहीं)।</i>\n\nआपका ट्रायल समाप्त हो गया। <b>⚡ प्लान अपग्रेड करें</b> दबाकर जारी रखें।\n\nनए हैं? <b>❓ कैसे काम करता है</b> दबाएं।`,

 smsHowItWorks: (chatId) => `📧 <b>BulkSMS — कैसे काम करता है</b>\n\nBulkSMS <b>आपके फोन की SIM कार्ड</b> से असली SMS भेजता है — सर्वर से नहीं। उच्च डिलीवरी और असली सेंडर ID।\n\n<b>⚙️ एक बार सेटअप:</b>\n1. ऐप डाउनलोड करें → ${SMS_APP_LINK}\n2. खोलें → कोड दर्ज करें: <code>${chatId}</code>\n3. SMS अनुमति दें\n\n<b>📤 अभियान भेजें:</b>\n• यहां <b>📱 अभियान बनाएं</b> दबाएं या ऐप में बनाएं\n• संदेश + संपर्क जोड़ें (पेस्ट या फ़ाइल अपलोड)\n• अभियान ऐप में सिंक → फोन पर भेजें दबाएं\n\n<b>💡 सुझाव:</b>\n• समर्पित लाइन के लिए <b>eSIM</b> उपयोग करें\n• कई संदेश पंक्तियां = स्वचालित रोटेशन\n• <code>[name]</code> = स्वचालित व्यक्तिगतकरण\n• शेड्यूल करें या तुरंत भेजें\n\n<b>📋 मेरे अभियान</b> सभी अभियान देखें।\n<b>🔓 लॉगिन रीसेट</b> डिवाइस बदलें।\n\neSIM चाहिए? 💬 सहायता दबाएं`,
 smsCreateCampaignIntro: `📱 <b>SMS अभियान बनाएं</b>\n\nइस तरह काम करता है:\n\n<b>चरण 1:</b> अपने अभियान का नाम दें\n<b>चरण 2:</b> अपना/अपने संदेश लिखें\n • व्यक्तिगत बनाने के लिए <code>[name]</code> उपयोग करें\n • कई पंक्तियां = संदेश रोटेशन\n<b>चरण 3:</b> संपर्क अपलोड करें\n • टेक्स्ट में चिपकाएं: <code>+1234567890, राम</code>\n • या .txt / .csv फ़ाइल अपलोड करें\n<b>चरण 4:</b> SMS के बीच विलंब समय सेट करें\n<b>चरण 5:</b> समीक्षा करें और पुष्टि करें — भेजें, शेड्यूल करें, या ड्राफ्ट सहेजें\n\nअभियान भेजने के लिए ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS ऐप में सिंक होता है।\n\n<b>शुरू करें — अभियान का नाम दर्ज करें:</b>`,
 smsSchedulePrompt: '⏰ <b>अभियान शेड्यूल करें?</b>\n\nचुनें कि यह अभियान कब उपलब्ध हो:',
 smsSendNow: '▶️ अभी भेजें',
 smsScheduleLater: '⏰ बाद के लिए शेड्यूल करें',
 smsScheduleTimePrompt: '📅 <b>तारीख और समय दर्ज करें</b>\n\nप्रारूप: <code>YYYY-MM-DD HH:MM</code>\n(UTC समय क्षेत्र)\n\nउदाहरण: <code>2025-07-15 09:30</code>',
 smsSaveDraft: '💾 ड्राफ्ट सहेजें',
 smsDefaultGap: '⏱ डिफ़ॉल्ट (5 सेकंड)',
 smsGapTimePrompt: '⏱ <b>संदेशों के बीच विलंब</b>\n\nप्रत्येक SMS के बीच कितने सेकंड का अंतर?\n\n• डिफ़ॉल्ट: <b>5 सेकंड</b>\n• सीमा: 1–300 सेकंड\n\nसंख्या टाइप करें या डिफ़ॉल्ट बटन दबाएं:',
 smsMyCampaignsEmpty: '📋 <b>मेरे अभियान</b>\n\nअभी तक कोई अभियान नहीं है। शुरू करने के लिए <b>📱 अभियान बनाएं</b> दबाएं!',
 smsMyCampaignsList: (campaigns) => {
 const statusIcons = { draft: '📝', sending: '📤', completed: '✅', paused: '⏸', scheduled: '📅' }
 const lines = campaigns.slice(0, 10).map((c, i) =>
 `${i + 1}. ${statusIcons[c.status] || '📋'} <b>${c.name}</b>\n ${c.sentCount}/${c.totalCount} भेजे · ${c.status}`
 )
 return `📋 <b>मेरे अभियान</b>\n\n${lines.join('\n\n')}\n\n<i>${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS ऐप में अभियान प्रबंधित करें।</i>`
 },
 planSubscribed:
 HIDE_SMS_APP === 'true'
 ? `आपने {{plan}} प्लान को सफलतापूर्वक सब्सक्राइब कर लिया है! मुफ्त , असीमित Shortit लिंक और मुफ्त USA फोन वैलिडेशन (मालिक के नाम सहित) का आनंद लें। E-sim चाहिए? 💬 सहायता प्राप्त करें बटन दबाएं।`
 : `✅ {{plan}} प्लान सब्सक्राइब हो गया!

शामिल:
• मुफ्त 
• असीमित Shortit लिंक
• USA फोन वैलिडेशन
• ${SMS_APP_NAME}

📱 डिवाइस एक्सेस:
 दैनिक — 3 डिवाइस
 साप्ताहिक — 10 डिवाइस
 मासिक — असीमित डिवाइस

📲 डाउनलोड: ${SMS_APP_LINK}
💬 E-sim: सहायता दबाएं
🔓 डिवाइस बदलें: /resetlogin`,
 alreadySubscribedPlan: days => `आपकी सदस्यता सक्रिय है और ${days} दिनों में समाप्त होगी।`,
 payError: `भुगतान सत्र नहीं मिला। कृपया पुनः प्रयास करें या 💬 सहायता प्राप्त करें बटन दबाएं। अधिक जानकारी ${TG_HANDLE} पर प्राप्त करें।`,
 chooseFreeDomainText: `<b>शानदार खबर!</b> यह डोमेन आपके सब्सक्रिप्शन के साथ मुफ्त में उपलब्ध है। क्या आप इसे दावा करना चाहेंगे?`,

 chooseDomainToBuy: text =>
 `<b>वेबसाइट का हिस्सा बनाएं!</b> कृपया वह डोमेन नाम साझा करें जिसे आप खरीदना चाहते हैं, जैसे कि "abcpay.com". ${text}`,
 askDomainToUseWithShortener: `👉 <b>ऊपर अपना डोमेन कन्फ़र्म करें।</b> अभी रजिस्टर करने के लिए <b>नहीं</b> दबाएं, या URL शॉर्टनर भी चालू करने के लिए <b>हाँ</b> दबाएं।\n\n<b>नहीं</b> — केवल रजिस्टर करें <i>(अनुशंसित)</i>। बाद में 🔧 DNS प्रबंधन से शॉर्टनर सक्रिय करें।\n<b>हाँ</b> — DNS भी ऑटो-कॉन्फ़िगर: शॉर्ट लिंक <code>yourdomain.com/abc</code>.`,
 blockUser: `कृपया उस उपयोगकर्ता का उपयोगकर्ता नाम साझा करें जिसे ब्लॉक करना है।`,
 unblockUser: `कृपया उस उपयोगकर्ता का उपयोगकर्ता नाम साझा करें जिसे अनब्लॉक करना है।`,
 blockedUser: `आप फिलहाल बॉट के उपयोग से अवरुद्ध हैं। कृपया 💬 सहायता प्राप्त करें बटन दबाएं. ${TG_HANDLE} पर अधिक जानें।`,
 greet: `${CHAT_BOT_BRAND} — URL छोटा करें, डोमेन रजिस्टर करें, फोन लीड्स खरीदें और Telegram से अपना बिज़नेस बढ़ाएं।

${FREE_LINKS} Shortit ट्रायल लिंक से शुरू करें — /start
सहायता: 💬 सहायता प्राप्त करें बटन दबाएं`,
 linkExpired: `${CHAT_BOT_BRAND} परीक्षण समाप्त हो गया है और आपका संक्षेपित लिंक निष्क्रिय हो गया है। हम URL सेवा और मुफ्त डोमेन नामों तक पहुंच बनाए रखने के लिए सब्सक्राइब करने के लिए आमंत्रित करते हैं। उपयुक्त योजना चुनें और सब्सक्राइब करने के निर्देशों का पालन करें। किसी भी प्रश्न के लिए हमें संपर्क करें।
सादर,
${CHAT_BOT_BRAND} टीम
${TG_CHANNEL} पर अधिक जानें।`,
 successPayment: `भुगतान सफलतापूर्वक संसाधित हो गया! इस विंडो को अब बंद करें।`,
 welcome: `${CHAT_BOT_NAME} को चुनने के लिए धन्यवाद! कृपया नीचे एक विकल्प चुनें :`,
 welcomeFreeTrial: `${CHAT_BOT_BRAND} में आपका स्वागत है! आपके पास ${FREE_LINKS} Shortit ट्रायल लिंक हैं URL छोटा करने के लिए। असीमित Shortit लिंक, मुफ्त और मुफ्त USA फोन वैलिडेशन (मालिक के नाम सहित) के लिए सब्सक्राइब करें। ${CHAT_BOT_BRAND} का अनुभव करें!`,
 unknownCommand: `कमांड नहीं मिला। /start दबाएं या 💬 सहायता प्राप्त करें बटन दबाएं। ${TG_HANDLE} पर अधिक जानें।`,
 support: `कृपया 💬 सहायता प्राप्त करें बटन दबाएं. ${TG_HANDLE} पर अधिक जानें।`,
 joinChannel: `कृपया चैनल ${TG_CHANNEL} में शामिल हों।`,
 dnsPropagated: `{{domain}} के लिए DNS प्रसार समाप्त हो गया है और अनलिमिटेड URL संक्षेपण के लिए उपलब्ध है।`,
 dnsNotPropagated: `{{domain}} के लिए DNS प्रसार जारी है और आपको अपडेट किया जाएगा जब यह समाप्त हो जाए। ✅`,
 domainBoughtSuccess: domain => `डोमेन ${domain} अब आपका है। धन्यवाद कि आपने हमें चुना।

सादर,
${CHAT_BOT_NAME}`,

 domainBought: `आपका डोमेन {{domain}} अब आपके खाते से जोड़ा गया है जबकि DNS प्रसार जारी है। आप जल्द ही स्थिति से स्वचालित रूप से अपडेट हो जाएंगे।🚀`,
 domainLinking: domain =>
 `डोमेन आपके खाते से लिंक कर रहे हैं। कृपया ध्यान दें कि DNS अपडेट में 30 मिनट तक का समय लग सकता है। आप यहां अपने DNS अपडेट स्थिति की जांच कर सकते हैं: https://www.whatsmydns.net/#A/${domain}`,
 errorSavingDomain: `डोमेन को सर्वर पर सहेजने में त्रुटि, समर्थन 💬 सहायता प्राप्त करें बटन दबाएं। ${TG_HANDLE} पर अधिक जानें।`,
 chooseDomainToManage: `कृपया चयन करें यदि आप DNS सेटिंग्स प्रबंधित करना चाहते हैं।`,
 chooseDomainWithShortener: `कृपया वह डोमेन नाम चुनें या खरीदें जिसे आप अपने संक्षेपित लिंक से कनेक्ट करना चाहते हैं।`,
 viewDnsRecords: (records, domain, nameserverType) => {
 let msg = `<b>${domain} के DNS रिकॉर्ड</b>\n`

 // NS section — only show for cloudflare or custom NS (hide provider defaults)
 const nsRecs = records['NS']
 if (nsRecs && nsRecs.length && (nameserverType === 'cloudflare' || nameserverType === 'custom')) {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : 'कस्टम'
 msg += `\n<b>नेमसर्वर</b> <i>(${provider})</i>\n`
 for (let i = 0; i < nsRecs.length; i++) {
 msg += ` NS${i + 1}: <code>${nsRecs[i].recordContent || '—'}</code>\n`
 }
 msg += `<i>"DNS रिकॉर्ड अपडेट करें" से बदलें।</i>\n`
 }

 const otherTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'SRV', 'CAA']
 const typeLabels = {
 A: 'A रिकॉर्ड', AAAA: 'AAAA रिकॉर्ड', CNAME: 'CNAME रिकॉर्ड',
 MX: 'MX रिकॉर्ड', TXT: 'TXT रिकॉर्ड',
 SRV: 'SRV रिकॉर्ड', CAA: 'CAA रिकॉर्ड',
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
 const pri = r.priority !== undefined ? ` (प्राथमिकता:${r.priority})` : ''
 msg += `${idx} MX ${host}${pri} -> ${r.recordContent || 'कोई नहीं'}\n`
 } else if (type === 'TXT') {
 const val = r.recordContent ? (r.recordContent.length > 60 ? r.recordContent.substring(0, 60) + '...' : r.recordContent) : 'कोई नहीं'
 msg += `${idx} TXT ${host} -> ${val}\n`
 } else if (type === 'SRV') {
 msg += `${idx} SRV ${r.recordName || ''} -> ${r.recordContent || 'कोई नहीं'}\n`
 } else if (isShortenerCNAME) {
 msg += `${idx} ${type} ${host} -> 🔗 URL शॉर्टनर <i>(${r.recordContent})</i>\n`
 } else {
 msg += `${idx} ${type} ${host} -> ${r.recordContent || 'कोई नहीं'}\n`
 }
 }
 }
 const hasAny = ['NS', ...otherTypes].some(t => records[t]?.length)
 if (!hasAny) msg += '\nकोई DNS रिकॉर्ड नहीं मिला।\n'
 return msg
 },

 addDns: 'DNS रिकॉर्ड जोड़ें',
 updateDns: 'DNS रिकॉर्ड अपडेट करें',
 deleteDns: 'DNS रिकॉर्ड हटाएं',
 quickActions: 'त्वरित क्रियाएं',
 activateShortener: '🔗 URL शॉर्टनर के लिए सक्रिय करें',
 deactivateShortener: '🔗 URL शॉर्टनर निष्क्रिय करें',

 // DNS Wizard strings (hi)
 mx: 'MX रिकॉर्ड',
 txt: 'TXT रिकॉर्ड',
 'MX रिकॉर्ड': 'MX',
 'TXT रिकॉर्ड': 'TXT',
 dnsQuickActionMenu: 'प्रीसेट कॉन्फ़िगरेशन चुनें:',
 dnsQuickAskIp: 'सर्वर IP पता दर्ज करें (IPv4):',
 dnsQuickAskVerificationTxt: 'अपने प्रदाता से TXT सत्यापन मान चिपकाएं:',
 dnsQuickAskSubdomainName: 'उपडोमेन नाम दर्ज करें (जैसे: api, blog, app):',
 dnsQuickAskSubdomainTargetType: (full) => `आप ${full} को कैसे पॉइंट करना चाहते हैं?`,
 dnsQuickSubdomainIp: 'IP पर पॉइंट करें (A)',
 dnsQuickSubdomainDomain: 'डोमेन पर पॉइंट करें (CNAME)',
 dnsQuickAskSubdomainIp: 'IP पता दर्ज करें:',
 dnsQuickAskSubdomainDomain: 'लक्ष्य डोमेन दर्ज करें:',
 dnsQuickSetupProgress: (step, total) => `सेटअप जारी (${step}/${total})...`,
 dnsQuickSetupError: (what) => `${what} बनाने में त्रुटि। कृपया पुनः प्रयास करें।`,
 dnsQuickGoogleDone: (domain) => `${domain} के लिए Google Workspace कॉन्फ़िगर किया! 5 MX + SPF जोड़े गए।`,
 dnsQuickZohoDone: (domain) => `${domain} के लिए Zoho Mail कॉन्फ़िगर किया! 3 MX + SPF जोड़े गए।`,
 dnsQuickPointToIpDone: (domain, ip) => `${domain} अब ${ip} पर पॉइंट कर रहा है।\nA: ${domain} -> ${ip}\nCNAME: www.${domain} -> ${domain}`,
 dnsQuickVerificationDone: 'TXT सत्यापन रिकॉर्ड जोड़ा गया!',
 dnsQuickSubdomainDone: (sub, target, type) => `${sub} अब ${target} पर पॉइंट कर रहा है (${type})`,
 dnsInvalidIpv4: 'अमान्य IPv4 पता। कृपया सही IP दर्ज करें (जैसे: 192.168.1.1):',
 dnsInvalidHostname: 'अमान्य होस्ट नाम। अक्षरांकीय, हाइफन, अंडरस्कोर और डॉट का उपयोग करें (जैसे: api, _dmarc, neo1._domainkey):',
 dnsHostnameForeignDomain: (zone) => `यह होस्ट नाम किसी अन्य डोमेन का है। <b>${zone}</b> के लिए केवल सब-लेबल दर्ज करें (जैसे <b>www</b>, <b>api</b>) या रूट के लिए <b>@</b>।`,
 dnsFixDuplicatedBtn: (n) => `🛠️ ${n} टूटे रिकॉर्ड ठीक करें`,
 dnsFixDuplicatedHeader: (zone) => `🛠️ <b>सफाई: ${zone} पर दोहराए गए-ज़ोन रिकॉर्ड</b>\n\nहमें ऐसे रिकॉर्ड मिले जहां डोमेन नाम में दो बार आता है (जैसे <code>www.${zone}.${zone}</code>)। यह आमतौर पर तब होता है जब पूरा डोमेन होस्ट नाम के रूप में टाइप किया जाता है।\n\n<b>✅ ऑटो-फिक्स</b> दबाएं ताकि उन्हें सही सब-लेबल (जैसे <code>www</code>) में बदला जा सके और उनके मान बने रहें। <b>🗑️ हटाएं</b> सभी हटाने के लिए।`,
 dnsFixDuplicatedAutoFixBtn: '✅ सभी ऑटो-फिक्स',
 dnsFixDuplicatedDeleteBtn: '🗑️ सभी हटाएं',
 dnsFixDuplicatedDone: (fixed, deleted, failed) => `<b>हो गया।</b>\n\n✅ ऑटो-फिक्स: ${fixed}\n🗑️ हटाए गए: ${deleted}${failed ? `\n⚠️ विफल: ${failed}` : ''}\n\nDNS प्रसार में 24 घंटे तक लग सकते हैं।`,
 dnsInvalidMxPriority: 'अमान्य प्राथमिकता। 1 से 65535 के बीच एक संख्या दर्ज करें:',
 askDnsHostname: {
 A: '<b>A रिकॉर्ड जोड़ें</b>\n\nहोस्ट नाम दर्ज करें:\nउदा. <b>@</b> रूट के लिए, या <b>api</b>, <b>blog</b>, <b>www</b>\n\n<i>सुझाव: केवल सब-लेबल — अपना पूरा डोमेन शामिल न करें।</i>',
 CNAME: '<b>CNAME रिकॉर्ड जोड़ें</b>\n\nउपडोमेन दर्ज करें:\nउदा. <b>www</b>, <b>api</b>, <b>blog</b>\n\nनोट: CNAME रूट (@) के लिए उपयोग नहीं किया जा सकता\n<i>सुझाव: केवल सब-लेबल — अपना पूरा डोमेन शामिल न करें।</i>',
 MX: '<b>MX रिकॉर्ड जोड़ें</b> (चरण 1/3)\n\nहोस्ट नाम दर्ज करें:\nउदा. <b>@</b> रूट ईमेल के लिए, या उपडोमेन\n\n<i>सुझाव: केवल सब-लेबल — अपना पूरा डोमेन शामिल न करें।</i>',
 TXT: '<b>TXT रिकॉर्ड जोड़ें</b> (चरण 1/2)\n\nहोस्ट नाम दर्ज करें:\nउदा. <b>@</b> रूट के लिए, या <b>_dmarc</b>, <b>mail</b>\n\n<i>सुझाव: केवल सब-लेबल — अपना पूरा डोमेन शामिल न करें।</i>',
 NS: '<b>NS रिकॉर्ड जोड़ें</b>\n\nनाम सर्वर दर्ज करें:\nउदा. <b>ns1.cloudflare.com</b>',
 AAAA: '<b>AAAA रिकॉर्ड जोड़ें</b> (चरण 1/2)\n\nहोस्ट नाम दर्ज करें:\nउदा. <b>@</b> रूट के लिए, या <b>api</b>, <b>blog</b>\n\n<i>सुझाव: केवल सब-लेबल — अपना पूरा डोमेन शामिल न करें।</i>',
 },
 askDnsValue: {
 A: 'IPv4 पता दर्ज करें:\nउदा. <b>192.168.1.1</b>',
 CNAME: 'लक्ष्य डोमेन दर्ज करें:\nउदा. <b>myapp.railway.app</b>',
 MX: '<b>चरण 2/3</b> — मेल सर्वर दर्ज करें:\nउदा. <b>ASPMX.L.GOOGLE.COM</b>',
 TXT: '<b>चरण 2/2</b> — TXT मान दर्ज करें:\nउदा. <b>v=spf1 include:_spf.google.com ~all</b>',
 AAAA: '<b>चरण 2/2</b> — IPv6 पता दर्ज करें:\nउदा. <b>2001:db8::1</b>',
 },
 askMxPriority: '<b>चरण 3/3</b> — MX प्राथमिकता दर्ज करें (कम = अधिक प्राथमिकता):\nउदा. <b>10</b> प्राथमिक के लिए, <b>20</b> बैकअप के लिए',
 dnsQuickActions: {
 pointToIp: 'IP पर पॉइंट करें',
 googleEmail: 'Google Workspace ईमेल',
 zohoEmail: 'Zoho ईमेल',
 verification: 'डोमेन सत्यापन (TXT)',
 addSubdomain: 'उपडोमेन जोड़ें',
 },

 // Phase 2: AAAA, SRV, CAA
 aaaa: 'AAAA रिकॉर्ड',
 'AAAA रिकॉर्ड': 'AAAA',
 srvRecord: 'SRV रिकॉर्ड',
 'SRV रिकॉर्ड': 'SRV',
 caaRecord: 'CAA रिकॉर्ड',
 'CAA रिकॉर्ड': 'CAA',
 dnsInvalidIpv6: 'अमान्य IPv6 पता। कृपया सही IPv6 दर्ज करें (जैसे: 2001:db8::1):',
 dnsInvalidPort: 'अमान्य पोर्ट नंबर। 1 से 65535 के बीच एक संख्या दर्ज करें:',
 dnsInvalidWeight: 'अमान्य वज़न। 0 से 65535 के बीच एक संख्या दर्ज करें:',
 dnsSrvCaaNotSupported: 'आपके वर्तमान DNS प्रदाता (ConnectReseller) SRV और CAA रिकॉर्ड का समर्थन नहीं करता। Cloudflare या OpenProvider नेमसर्वर पर स्विच करें।',
 askSrvService: '<b>SRV रिकॉर्ड जोड़ें</b> (चरण 1/5)\n\nसेवा और प्रोटोकॉल दर्ज करें:\nउदा. <b>_sip._tcp</b>, <b>_http._tcp</b>',
 askSrvTarget: '<b>चरण 2/5</b> — लक्ष्य होस्ट नाम दर्ज करें:\nउदा. <b>sipserver.example.com</b>',
 askSrvPort: '<b>चरण 3/5</b> — पोर्ट नंबर दर्ज करें:\nउदा. <b>5060</b>, <b>443</b>',
 askSrvPriority: '<b>चरण 4/5</b> — प्राथमिकता दर्ज करें (कम = अधिक प्राथमिकता):\nउदा. <b>10</b>',
 askSrvWeight: '<b>चरण 5/5</b> — वज़न दर्ज करें (लोड बैलेंसिंग):\nउदा. <b>100</b>',
 askCaaHostname: '<b>CAA रिकॉर्ड जोड़ें</b> (चरण 1/3)\n\nहोस्ट नाम दर्ज करें:\nउदा. <b>@</b> रूट डोमेन के लिए',
 askCaaTag: '<b>चरण 2/3</b> — CAA टैग चुनें:',
 caaTagIssue: 'issue — CA को अधिकृत करें',
 caaTagIssuewild: 'issuewild — वाइल्डकार्ड अधिकृत करें',
 caaTagIodef: 'iodef — उल्लंघन रिपोर्ट URL',
 'issue — CA को अधिकृत करें': 'issue',
 'issuewild — वाइल्डकार्ड अधिकृत करें': 'issuewild',
 'iodef — उल्लंघन रिपोर्ट URL': 'iodef',
 askCaaValue: (tag) => {
 if (tag === 'iodef') return '<b>चरण 3/3</b> — रिपोर्ट URL दर्ज करें:\nउदा. <b>mailto:admin@example.com</b>'
 return '<b>चरण 3/3</b> — अधिकृत CA डोमेन दर्ज करें:\nउदा. <b>letsencrypt.org</b>'
 },
 askDnsHostnameAaaa: 'होस्ट नाम दर्ज करें (@ रूट के लिए, या उपडोमेन जैसे <b>api</b>, <b>blog</b>):',
 askDnsValueAaaa: 'IPv6 पता दर्ज करें (जैसे: <b>2001:db8::1</b>):',

 // DNS Validation Checker
 checkDns: 'DNS जांचें',
 dnsChecking: (domain) => `<b>${domain}</b> के लिए DNS जांच जारी...`,
 dnsRecordLive: (type, value) => `<b>${type}</b> रिकॉर्ड सक्रिय है, <b>${value}</b> पर रिज़ॉल्व हो रहा है।`,
 dnsRecordPropagating: (type) => `<b>${type}</b> रिकॉर्ड अभी प्रसारित हो रहा है। इसमें 24-48 घंटे लग सकते हैं।`,
 dnsHealthTitle: (domain) => `<b>DNS स्वास्थ्य जांच — ${domain}</b>\n`,
 dnsHealthRow: (type, found, count, answers) => {
 if (!found) return ` ${type}: —`
 const vals = answers.slice(0, 2).join(', ')
 const more = answers.length > 2 ? ` +${answers.length - 2} और` : ''
 return ` ${type}: ${count} रिकॉर्ड (${vals}${more})`
 },
 dnsHealthSummary: (resolving, total) => resolving > 0
 ? `\n✅ स्थिति: <b>सक्रिय</b> — ${resolving}/${total} रिकॉर्ड प्रकार रिज़ॉल्व हो रहे हैं।`
 : `\n⚠️ स्थिति: <b>निष्क्रिय</b> — यह डोमेन अभी कहीं भी रिज़ॉल्व नहीं हो रहा। यह रजिस्ट्री पर होल्ड पर हो सकता है या अभी सक्रिय हो रहा है।`,
 dnsCheckError: 'DNS जांच विफल। कृपया बाद में पुनः प्रयास करें।',
 manageNameservers: '🔄 नेमसर्वर प्रबंधित करें',
 manageNsMenu: (domain, nsRecords, nameserverType) => {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : nameserverType === 'custom' ? 'कस्टम' : 'प्रदाता डिफ़ॉल्ट'
 let msg = `<b>🔄 नेमसर्वर — ${domain}</b>\n\n`
 msg += `<b>प्रदाता:</b> ${provider}\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>वर्तमान नेमसर्वर:</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 } else { msg += `<i>कोई NS रिकॉर्ड नहीं मिला।</i>\n` }
 msg += `\nनीचे एक विकल्प चुनें:`
 return msg
 },
 setCustomNs: '✏️ कस्टम नेमसर्वर सेट करें',
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ ${domain} के लिए कस्टम नेमसर्वर सेट करें</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>वर्तमान:</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 msg += '\n'
 }
 msg += `नए नेमसर्वर दर्ज करें (प्रति पंक्ति एक, न्यूनतम 2, अधिकतम 4):\n\n<i>उदाहरण:\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare: डैशबोर्ड में दिखे नाम <b>वैसे ही</b> कॉपी करें (उदा. <code>leanna.ns.cloudflare.com</code>)। अतिरिक्त <code>ns1./ns2.</code> उपसर्ग <b>न जोड़ें</b>।</i>`
 return msg
 },
 switchToCf: '☁️ Cloudflare पर स्विच करें',
 switchToCfConfirm: (domain) => `<b>${domain} को Cloudflare DNS पर स्विच करें?</b>\n\nयह करेगा:\n1. आपके डोमेन के लिए Cloudflare ज़ोन बनाएगा\n2. मौजूदा DNS रिकॉर्ड Cloudflare पर माइग्रेट करेगा\n3. रजिस्ट्रार पर नेमसर्वर अपडेट करेगा\n\nDNS प्रसार में 24-48 घंटे लग सकते हैं।\n\nजारी रखें?`,
 switchToCfProgress: (domain) => `⏳ <b>${domain}</b> को Cloudflare DNS पर स्विच कर रहे हैं…`,
 switchToCfSuccess: (domain, ns) => `<b>हो गया!</b> ${domain} अब Cloudflare DNS पर है।\n\n<b>नए नेमसर्वर:</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToCfError: (error) => `❌ Cloudflare पर स्विच करने में विफल: ${error}`,
 switchToCfAlreadyCf: 'यह डोमेन पहले से Cloudflare DNS का उपयोग कर रहा है।',
 switchToProviderDefault: '🏠 प्रदाता DNS पर स्विच करें',
 switchToProviderConfirm: (domain) => `<b>${domain} को प्रदाता DNS पर वापस स्विच करें?</b>\n\nयह करेगा:\n1. Cloudflare से DNS रिकॉर्ड रजिस्ट्रार पर माइग्रेट करेगा\n2. डिफ़ॉल्ट नेमसर्वर पुनर्स्थापित करेगा\n3. Cloudflare ज़ोन हटाएगा\n\nDNS प्रसार में 24-48 घंटे लग सकते हैं।\n\nजारी रखें?`,
 switchToProviderProgress: (domain) => `⏳ <b>${domain}</b> को प्रदाता DNS पर स्विच कर रहे हैं…`,
 switchToProviderSuccess: (domain, ns) => `<b>हो गया!</b> ${domain} अब प्रदाता DNS पर है।\n\n<b>नए नेमसर्वर:</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToProviderError: (error) => `❌ प्रदाता DNS पर स्विच करने में विफल: ${error}`,
 switchToProviderAlreadyProvider: 'यह डोमेन पहले से प्रदाता DNS का उपयोग कर रहा है।',
 updateNsPrompt: (nsRecords, slotIndex) => {
 let msg = `<b>नेमसर्वर अपडेट — स्लॉट NS${slotIndex}</b>\n\n<b>वर्तमान व्यवस्था:</b>\n`
 for (let i = 0; i < nsRecords.length; i++) {
 const marker = (i + 1) === slotIndex ? ' ← यह अपडेट हो रहा है' : ''
 msg += ` NS${i + 1}: <code>${nsRecords[i].recordContent || '—'}</code>${marker}\n`
 }
 msg += `\n<b>NS${slotIndex}</b> के लिए नया नेमसर्वर दर्ज करें:\nउदा. <b>ns1.cloudflare.com</b>`
 return msg
 },

 // Digital Products
 digitalProductsSelect: `🛒 <b>डिजिटल उत्पाद</b>\n\nसत्यापित खाते इस बॉट के माध्यम से <b>तेज़ी</b> से वितरित किए जाते हैं।\n\n<b>टेलीकॉम</b> — Twilio, Telnyx (SMS, वॉइस, SIP)\n<b>क्लाउड</b> — AWS, Google Cloud (पूर्ण एक्सेस)\n<b>ईमेल</b> — Google Workspace, Zoho Mail, IONOS SMTP\n<b>मोबाइल</b> — eSIM T-Mobile\n\nक्रिप्टो, बैंक या वॉलेट से भुगतान करें। नीचे चुनें:`,
 dpTwilioMain: `📞 Twilio मुख्य खाता — $${DP_PRICE_TWILIO_MAIN}`,
 dpTwilioSub: `📞 Twilio उप-खाता — $${DP_PRICE_TWILIO_SUB}`,
 dpTelnyxMain: `📡 Telnyx मुख्य खाता — $${DP_PRICE_TELNYX_MAIN}`,
 dpTelnyxSub: `📡 Telnyx उप-खाता — $${DP_PRICE_TELNYX_SUB}`,
 dpGworkspaceNew: `📧 Google Workspace Admin (नया डोमेन) — $${DP_PRICE_GWORKSPACE_NEW}`,
 dpGworkspaceAged: `📧 Google Workspace Admin (पुराना डोमेन) — $${DP_PRICE_GWORKSPACE_AGED}`,
 dpEsim: `📱 eSIM T-Mobile — $${DP_PRICE_ESIM}`,
 dpEsimAirvoice: `📱 eSIM Airvoice (AT&T)`,
 dpAirvoiceSelect: `📱 <b>eSIM Airvoice (AT&T)</b>\n\n📶 AT&T नेटवर्क पर अनलिमिटेड कॉल, टेक्स्ट और डेटा।\niOS और Android दोनों पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nप्लान अवधि चुनें:`,
 dpAirvoice1m: `1 महीना — $${DP_PRICE_AIRVOICE_1M}`,
 dpAirvoice3m: `3 महीने — $${DP_PRICE_AIRVOICE_3M}`,
 dpAirvoice6m: `6 महीने — $${DP_PRICE_AIRVOICE_6M}`,
 dpAirvoice1y: `1 साल — $${DP_PRICE_AIRVOICE_1Y}`,
 dpZohoNew: `📧 Zoho Mail (नया डोमेन) — $${DP_PRICE_ZOHO_NEW}`,
 dpZohoAged: `📧 Zoho Mail (पुराना डोमेन) — $${DP_PRICE_ZOHO_AGED}`,
 dpAwsMain: `☁️ AWS मुख्य खाता — $${DP_PRICE_AWS_MAIN}`,
 dpAwsSub: `☁️ AWS उप-खाता — $${DP_PRICE_AWS_SUB}`,
 dpGcloudMain: `🌐 Google Cloud मुख्य — $${DP_PRICE_GCLOUD_MAIN}`,
 dpGcloudSub: `🌐 Google Cloud उप — $${DP_PRICE_GCLOUD_SUB}`,
 dpIonosSmtp: `📧 IONOS SMTP — $${DP_PRICE_IONOS_SMTP}`,
 dpPaymentPrompt: (product, price) => {
 const descriptions = {
 'Twilio Main Account': 'पूर्ण स्वामी-स्तर Twilio खाता, Console एक्सेस, API कुंजियाँ, फ़ोन नंबर, SMS/MMS और वॉइस कॉल।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल + API SID और Auth Token।',
 'Twilio Sub-Account': 'Twilio सब-अकाउंट, Console लॉगिन और समर्पित API क्रेडेंशियल — SMS, वॉइस और नंबर प्रबंधन।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल, Account SID और Auth Token।',
 'Telnyx Main Account': 'पूर्ण स्वामी-स्तर Telnyx खाता, Mission Control Portal एक्सेस। नंबर, SIP, मैसेजिंग और वॉइस।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल + API कुंजी।',
 'Telnyx Sub-Account': 'Telnyx सब-अकाउंट, Mission Control Portal लॉगिन और API एक्सेस — मैसेजिंग, वॉइस और नंबर।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल + API कुंजी।',
 'AWS Main Account': 'पूर्ण root-स्तर AWS खाता, Console एक्सेस — EC2, S3, Lambda, SES आदि।\n\nआपको मिलेगा: root ईमेल, पासवर्ड और MFA सेटअप।',
 'AWS Sub-Account': 'AWS सब-अकाउंट (Organizations सदस्य), पूर्ण Console लॉगिन और मुख्य सेवाओं तक पहुँच — EC2, S3, Lambda आदि।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल और IAM एक्सेस।',
 'Google Cloud Main Account': 'पूर्ण स्वामी-स्तर Google Cloud खाता, बिलिंग सक्रिय। Compute Engine, Cloud Storage, BigQuery और सभी GCP सेवाएँ।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल।',
 'Google Cloud Sub-Account': 'Google Cloud प्रोजेक्ट, पूर्ण Console लॉगिन और एडिटर-स्तर एक्सेस। कंप्यूट, स्टोरेज और API शामिल।\n\nआपको मिलेगा: लॉगिन क्रेडेंशियल और सर्विस अकाउंट कुंजी।',
 'Google Workspace (New Domain)': 'नए डोमेन पर Google Workspace बिज़नेस ईमेल। @आपकाडोमेन ईमेल — Gmail, Drive, Docs और Meet।\n\nआपको मिलेगा: एडमिन लॉगिन + डोमेन क्रेडेंशियल।',
 'Google Workspace (Aged Domain)': 'पुराने डोमेन पर Google Workspace, बेहतर डिलीवरेबिलिटी। बिज़नेस ईमेल + पूर्ण Google सुइट।\n\nआपको मिलेगा: एडमिन लॉगिन + डोमेन क्रेडेंशियल।',
 'Zoho Mail (New Domain)': 'नए डोमेन पर Zoho Mail प्रोफेशनल ईमेल। @आपकाडोमेन ईमेल — कैलेंडर, संपर्क और स्टोरेज।\n\nआपको मिलेगा: एडमिन लॉगिन + डोमेन सेटअप।',
 'Zoho Mail (Aged Domain)': 'पुराने डोमेन पर Zoho Mail, बेहतर प्रतिष्ठा। प्रोफेशनल ईमेल + पूर्ण Zoho सुइट।\n\nआपको मिलेगा: एडमिन लॉगिन + डोमेन क्रेडेंशियल।',
 'eSIM T-Mobile': '📶 <b>1 महीना — अनलिमिटेड कॉल, टेक्स्ट और डेटा</b>\niOS और Android पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nआपको मिलेगा: QR कोड या एक्टिवेशन डिटेल्स।',
 'eSIM Airvoice (AT&T) — 1 Month': '📶 <b>1 महीना — अनलिमिटेड कॉल, टेक्स्ट और डेटा (AT&T)</b>\niOS और Android पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nआपको मिलेगा: QR कोड या एक्टिवेशन डिटेल्स।',
 'eSIM Airvoice (AT&T) — 3 Months': '📶 <b>3 महीने — अनलिमिटेड कॉल, टेक्स्ट और डेटा (AT&T)</b>\niOS और Android पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nआपको मिलेगा: QR कोड या एक्टिवेशन डिटेल्स।',
 'eSIM Airvoice (AT&T) — 6 Months': '📶 <b>6 महीने — अनलिमिटेड कॉल, टेक्स्ट और डेटा (AT&T)</b>\niOS और Android पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nआपको मिलेगा: QR कोड या एक्टिवेशन डिटेल्स।',
 'eSIM Airvoice (AT&T) — 1 Year': '📶 <b>1 साल — अनलिमिटेड कॉल, टेक्स्ट और डेटा (AT&T)</b>\niOS और Android पर काम करता है। QR स्कैन करके एक्टिवेट करें।\n\nआपको मिलेगा: QR कोड या एक्टिवेशन डिटेल्स।',
 }
 const desc = descriptions[product] || ''
 return `💰 <b>ऑर्डर: ${product}</b>\n\n💵 कीमत: <b>$${price}</b>${desc ? '\n\n' + desc : ''}\n\nभुगतान विधि चुनें:`
 },
 dpOrderConfirmed: (product, price, orderId) => `✅ <b>ऑर्डर की पुष्टि!</b>\n\n🛒 उत्पाद: <b>${product}</b>\n💵 राशि: <b>$${price}</b>\n🆔 ऑर्डर आईडी: <code>${orderId}</code>\n\nआपका ऑर्डर इस बॉट के माध्यम से जल्द ही वितरित किया जाएगा।\nकिसी भी प्रश्न के लिए सहायता से संपर्क करें।`,

 // Virtual Card
 vcWelcome: `💳 <b>वर्चुअल डेबिट कार्ड</b>\n\nअपनी राशि से एक वर्चुअल कार्ड लोड करें।\n\n✅ दुनिया भर में ऑनलाइन\n✅ तत्काल डिलीवरी\n✅ $50 – $1,000\n\nराशि चुनें या कस्टम राशि दर्ज करें:`,
 vcInvalidAmount: `❌ कृपया <b>$50</b> और <b>$1,000</b> के बीच एक मान्य राशि दर्ज करें।`,
 vcAskAddress: `📬 <b>शिपिंग पता</b>\n\nअंतर्राष्ट्रीय प्रारूप में अपना पूरा पता दर्ज करें:\n\n<i>उदाहरण:\nराहुल शर्मा\n123 मुख्य सड़क, फ्लैट 4B\nमुंबई, 400001\nभारत</i>`,
 vcAddressTooShort: `❌ पता बहुत छोटा लगता है। कृपया पूरा नाम, सड़क, शहर, पिन कोड और देश शामिल करें।`,
 vcOrderSummary: (amount, fee, total) => `📋 <b>ऑर्डर सारांश</b>\n\n💳 वर्चुअल कार्ड लोड: <b>$${amount}</b>\n💰 सेवा शुल्क: <b>$${fee.toFixed(2)}</b>${amount < 200 ? ' (न्यूनतम $20)' : ' (10%)'}\n━━━━━━━━━━━━━━━━━\n💵 <b>कुल: $${total.toFixed(2)}</b>\n\nभुगतान विधि चुनें:`,
 vcOrderConfirmed: (amount, total, orderId) => `✅ <b>वर्चुअल कार्ड ऑर्डर की पुष्टि!</b>\n\n💳 कार्ड लोड: <b>$${amount}</b>\n💵 भुगतान: <b>$${total.toFixed(2)}</b>\n🆔 ऑर्डर आईडी: <code>${orderId}</code>\n\n⏱ <b>आपके कार्ड विवरण जल्द ही यहां भेजे जाएंगे।</b>`,
 leadsFileNumbersOnly: `📄 <b>फ़ाइल 1 — फ़ोन नंबर</b>\nआपके बैच के सभी सत्यापित नंबर।`,
 leadsFileWithNames: (count) => `📄 <b>फ़ाइल 2 — नंबर + मालिक का नाम (${count} मिलान)</b>\nइन लीड्स में मालिक का असली नाम शामिल है। उन्हें व्यक्तिगत रूप से संबोधित करें — यह तुरंत विश्वास बनाता है और आपकी प्रतिक्रिया दर नाटकीय रूप से बढ़ाता है।`,
 addDnsTxt: 'रिकॉर्ड प्रकार चुनें:',
 updateDnsTxt: 'अपडेट करने के लिए रिकॉर्ड चुनें:',
 deleteDnsTxt: 'हटाने के लिए रिकॉर्ड चुनें:',
 confirmDeleteDnsTxt: 'क्या आप वाकई इस रिकॉर्ड को हटाना चाहते हैं?',
 a: `A रिकॉर्ड`,
 cname: `CNAME रिकॉर्ड`,
 ns: `NS रिकॉर्ड`,
 'A रिकॉर्ड': `A`,
 'CNAME रिकॉर्ड': `CNAME`,
 'NS रिकॉर्ड': `NS`,
 askDnsContent: {
 NS: '<b>NS रिकॉर्ड जोड़ें</b>\n\nनाम सर्वर दर्ज करें:\nउदा. <b>ns1.cloudflare.com</b>',
 'NS Record': '<b>NS रिकॉर्ड जोड़ें</b>\n\nनाम सर्वर दर्ज करें:\nउदा. <b>ns1.cloudflare.com</b>',
 },
 askUpdateDnsContent: {
 A: (current) => `<b>A रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें IPv4 पता:\nउदा. <b>192.168.1.1</b>`,
 'A Record': (current) => `<b>A रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें IPv4 पता:\nउदा. <b>192.168.1.1</b>`,
 CNAME: (current) => `<b>CNAME रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें लक्ष्य डोमेन:\nउदा. <b>myapp.railway.app</b>`,
 'CNAME Record': (current) => `<b>CNAME रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें लक्ष्य डोमेन:\nउदा. <b>myapp.railway.app</b>`,
 NS: (current) => `<b>NS रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें नाम सर्वर:\nउदा. <b>ns1.cloudflare.com</b>`,
 'NS Record': (current) => `<b>NS रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें नाम सर्वर:\nउदा. <b>ns1.cloudflare.com</b>`,
 MX: (current) => `<b>MX रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें मेल सर्वर:\nउदा. <b>ASPMX.L.GOOGLE.COM</b>`,
 'MX Record': (current) => `<b>MX रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें मेल सर्वर:\nउदा. <b>ASPMX.L.GOOGLE.COM</b>`,
 TXT: (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>TXT रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${display}</b>\n\nनया मान दर्ज करें TXT मान:\nउदा. <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 'TXT Record': (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>TXT रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${display}</b>\n\nनया मान दर्ज करें TXT मान:\nउदा. <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 AAAA: (current) => `<b>AAAA रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें IPv6 पता:\nउदा. <b>2001:db8::1</b>`,
 'AAAA Record': (current) => `<b>AAAA रिकॉर्ड अपडेट करें</b>\nवर्तमान: <b>${current || 'N/A'}</b>\n\nनया मान दर्ज करें IPv6 पता:\nउदा. <b>2001:db8::1</b>`,
 },
 dnsRecordSaved: 'रिकॉर्ड सफलतापूर्वक जोड़ा गया। DNS परिवर्तन प्रभावी होने में 24 घंटे तक लग सकते हैं।',
 dnsRecordDeleted: 'रिकॉर्ड सफलतापूर्वक हटाया गया।',
 dnsRecordUpdated: 'रिकॉर्ड सफलतापूर्वक अपडेट किया गया। DNS परिवर्तन प्रभावी होने में 24 घंटे तक लग सकते हैं।',
 provideLink: `कृपया एक वैध यूआरएल प्रदान करें। उदाहरण के लिए https://google.com`,
 comingSoonWithdraw: `निकासी अभी उपलब्ध नहीं है। मदद चाहिए? 💬 सहायता प्राप्त करें बटन दबाएं।`,
 promoOptOut: `आपने प्रचार संदेशों से अनसब्सक्राइब कर दिया है। कभी भी /start_promos टाइप करके फिर से सब्सक्राइब करें।`,
 promoOptIn: `आपने प्रचार संदेशों की फिर से सदस्यता ले ली है। आपको हमारे नवीनतम ऑफर और डील प्राप्त होंगे!`,
 selectCurrencyToDeposit: `💵 जमा राशि (न्यूनतम $10):`,
 depositNGN: `कृपया एनजीएन राशि दर्ज करें (न्यूनतम ≈ $10 USD)।\nआपका नाइरा मौजूदा विनिमय दर पर USD में बदला जाएगा:`,
 askEmailForNGN: `कृपया भुगतान की पुष्टि के लिए ईमेल प्रदान करें`,
 depositUSD: `कृपया USD राशि दर्ज करें, ध्यान दें कि न्यूनतम मूल्य $10 है:`,
 selectCryptoToDeposit: `कृपया एक क्रिप्टो मुद्रा चुनें:\n\n<i>ℹ️ USDT (TRC20) के लिए न्यूनतम जमा $20 आवश्यक है।</i>`,

 trc20MinDepositPrompt: (currentAmount, minAmount) =>
  `⚠️ <b>USDT (TRC20) के लिए न्यूनतम $${minAmount} आवश्यक है</b>\n\n` +
  `आपने दर्ज किया: <b>$${currentAmount}</b>\n` +
  `TRC20 ट्रांसफर के लिए प्राप्तकर्ता पक्ष पर TRX-ऊर्जा शुल्क को आराम से कवर करने के लिए ~$${minAmount}+ की आवश्यकता होती है।\n\n` +
  `आप क्या करना चाहेंगे?`,
 trc20TopUpBtn: (minAmount) => `✅ $${minAmount} तक टॉप अप करें`,
 trc20SwitchCryptoBtn: '🔄 अलग क्रिप्टो चुनें',
 trc20EditAmountBtn: '✏️ अलग राशि दर्ज करें',
 trc20WhyMinBtn: '💡 यह न्यूनतम क्यों?',
 trc20CancelBtn: '❌ रद्द करें',

 trc20WhyMinExplanation: (minAmount) =>
  `💡 <b>TRC20 के लिए $${minAmount} न्यूनतम क्यों आवश्यक है?</b>\n\n` +
  `हर TRC20 USDT ट्रांसफर प्राप्तकर्ता पक्ष पर ~5–15 TRX नेटवर्क "एनर्जी" शुल्क के रूप में जलाता है। छोटी जमा राशि पर, ये शुल्क आपके द्वारा भेजे गए के 30–50% तक खा सकते हैं — $${minAmount} की सीमा रखने से सुनिश्चित होता है कि आपकी लगभग पूरी जमा राशि आपके वॉलेट में पहुंच जाए।\n\n` +
  `अन्य क्रिप्टो (BTC, LTC, ETH) में प्रति-ट्रांसफर ओवरहेड कम है, इसलिए वहां कोई न्यूनतम लागू नहीं होता।\n\n` +
  `अधिक मदद चाहिए? सहायता से संपर्क करें: ${APP_SUPPORT_LINK}`,
 'bank-pay-plan': (priceNGN, plan) =>
 `कृपया "भुगतान करें" पर क्लिक करके ${priceNGN} NGN भेजें। एक बार जब लेनदेन की पुष्टि हो जाती है, तो आप स्वचालित रूप से सूचित किए जाएंगे और आपका ${plan} योजना सुचारू रूप से सक्रिय हो जाएगा।

संपर्क: ${CHAT_BOT_NAME}`,
 bankPayDomain: (priceNGN, domain) =>
 `कृपया "भुगतान करें" पर क्लिक करके ${priceNGN} NGN भेजें। एक बार जब लेनदेन की पुष्टि हो जाती है, तो आप स्वचालित रूप से सूचित किए जाएंगे और आपका डोमेन ${domain} सुचारू रूप से सक्रिय हो जाएगा।

संपर्क: ${CHAT_BOT_NAME}`,
 showDepositCryptoInfoPlan: (priceUsd, priceCrypto, tickerView, address, plan) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपका ${plan} प्लान स्वचालित रूप से सक्रिय हो जाएगा (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,
 showDepositCryptoInfoDomain: (priceUsd, priceCrypto, tickerView, address, domain) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपका डोमेन ${domain} स्वचालित रूप से सक्रिय हो जाएगा (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoLeads: (priceUsd, priceCrypto, tickerView, address, label) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपके ${label} स्वचालित रूप से वितरित किए जाएंगे (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoPhone: (priceUsd, priceCrypto, tickerView, address, phoneNumber) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपका Cloud IVR नंबर ${phoneNumber} स्वचालित रूप से सक्रिय हो जाएगा (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoDigitalProduct: (priceUsd, priceCrypto, tickerView, address, product) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:\n\n<code>${address}</code>\n\n<b>${product}</b> के लिए आपका ऑर्डर प्रोसेस हो रहा है। क्रिप्टो भुगतान तेज़ी से पुष्टि होते हैं — आमतौर पर कुछ ही मिनटों में। पुष्टि होने पर, आपका ऑर्डर जल्द डिलीवर किया जाएगा।\n\nसादर,\n${CHAT_BOT_NAME}`,

 showDepositCryptoInfo: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:\n\n<code>${address}</code>\n\nक्रिप्टो भुगतान तेज़ी से पुष्टि होते हैं — आमतौर पर कुछ ही मिनटों में। पुष्टि होने पर आपको तुरंत सूचना दी जाएगी और आपके वॉलेट को अपडेट किया जाएगा।\n\nसादर,\n${CHAT_BOT_NAME}`,

 showDepositCryptoInfoOpenEnded: (minUsd, tickerView, address) =>
 `💎 <b>कोई भी राशि का ${tickerView} भेजें</b> जिसकी कीमत कम से कम <b>$${Number(minUsd).toFixed(0)} USD</b> हो:\n\n<code>${address}</code>\n\nहम आपके भेजे गए की पूरी बाज़ार-कीमत क्रेडिट करेंगे।\n\n⚠️ <b>$${Number(minUsd).toFixed(0)} USD से कम जमा ज़ब्त हो जाएगी</b> — उन्हें स्वीप करने का नेटवर्क शुल्क जमा से अधिक होता है।\n\nक्रिप्टो भुगतान आमतौर पर कुछ ही मिनटों में पुष्टि होते हैं।\n\nसादर,\n${CHAT_BOT_NAME}`,

 dustDepositNotice: (receivedUsd, minUsd, tickerView) =>
 `⚠️ <b>जमा न्यूनतम से कम — क्रेडिट नहीं हुआ</b>\n\nहमने आपसे ${tickerView} में <b>≈ $${Number(receivedUsd).toFixed(2)} USD</b> प्राप्त किया, लेकिन इस सिक्के के लिए वॉलेट जमा की न्यूनतम राशि <b>$${Number(minUsd).toFixed(0)} USD</b> है।\n\nइतनी छोटी जमा राशि को स्वीप करने का नेटवर्क शुल्क जमा से अधिक है, इसलिए आपके धन को क्रेडिट नहीं किया गया।\n\nयदि सहायता चाहिए, तो 💬 सहायता पर टैप करें — हमारी टीम आपकी सहायता करेगी।\n\n— ${CHAT_BOT_NAME}`,

 confirmationDepositMoney: (amount, usd) =>
 `आपकी ${amount} ($${view(usd)}) की राशि संसाधित हो गई है। हमें चुनने के लिए धन्यवाद।\nसादर,\n${CHAT_BOT_NAME}`,

 showWallet: (usd) => `वॉलेट शेष राशि :\n\n$${view(usd)}`,

 wallet: (usd) => `वॉलेट शेष राशि :\n\n$${view(usd)}\n\nवॉलेट विकल्प का चयन करें :`,

 walletSelectCurrency: (usd) =>
 `वॉलेट शेष राशि: $${view(usd)}`,

 walletBalanceLow: `आपका वॉलेट बैलेंस कम है। "👛 मेरा वॉलेट" → "➕💵 जमा" पर टैप करके रिचार्ज करें।`,

 sentLessMoney: (expected, got) =>
 `⚠️ <b>कम भुगतान</b>\n\nअपेक्षित: <b>${expected}</b>\nप्राप्त: <b>${got}</b>\n\n✅ <b>${got} आपके वॉलेट में जोड़ दिया गया</b> — कुछ भी नहीं खोया।\n\n💳 ऑर्डर पूरा करने के लिए, सेवा फिर से खोलें और चेकआउट पर <b>👛 वॉलेट</b> चुनें (ज़रूरत हो तो छोटा अंतर टॉप-अप करें)। जारी रखने के लिए /start टैप करें।`,

 sentMoreMoney: (expected, got) =>
 `आपने अपेक्षित राशि से अधिक पैसा भेजा, इसलिए हमने अतिरिक्त राशि को आपके वॉलेट में क्रेडिट कर दिया। हमसे ${expected} की उम्मीद थी लेकिन हमने ${got} प्राप्त की।`,

 buyLeadsError: `दुर्भाग्यवश चयनित क्षेत्र कोड उपलब्ध नहीं है और आपका वॉलेट चार्ज नहीं किया गया है।`,
 buyLeadsProgress: (i, total) =>
 `${((i * 100) / total).toFixed()}% लीड्स डाउनलोड किए जा रहे हैं। कृपया प्रतीक्षा करें.`,

 phoneNumberLeads: `सत्यापित फ़ोन लीड खरीदें या अपने नंबर मान्य करें:`,

 buyLeadsSelectCountry: `कृपया देश का चयन करें`,
 buyLeadsSelectSmsVoice: `कृपया एसएमएस / वॉयस चुनें`,
 buyLeadsSelectArea: `कृपया क्षेत्र का चयन करें`,
 buyLeadsSelectAreaCode: `कृपया क्षेत्र कोड का चयन करें`,
 buyLeadsSelectCarrier: `कृपया ऑपरेटर का चयन करें`,
 buyLeadsSelectCnam: `क्या आप हर लीड के साथ <b>फोन मालिक का नाम</b> चाहते हैं? प्रति 1,000 लीड्स $15 अतिरिक्त — और यह इसके लायक है।`,
 buyLeadsSelectAmount: (min, max) =>
 `आप कितनी लीड्स खरीदना चाहते हैं? एक संख्या चुनें या दर्ज करें। न्यूनतम ${min} और अधिकतम ${max}।`,

 buyLeadsSelectFormat: `फॉर्मेट चुनें, जैसे लोकल (212) या इंटरनेशनल (+1212)`,

 buyLeadsSuccess: n => `🎉 <b>हो गया!</b> आपकी ${n} लीड्स तैयार हैं।\n\nआपको दो फाइलें मिलेंगी:\n📄 <b>फाइल 1</b> — सभी फोन नंबर\n📄 <b>फाइल 2</b> — <b>फोन मालिक के नाम</b> के साथ मैच किए गए नंबर\n\nसुझाव: नामों का उपयोग करके अपनी पहुंच को व्यक्तिगत बनाएं। नाम से संबोधित होने पर लोग 2-3 गुना अधिक जवाब देते हैं।`,

 buyLeadsNewPrice: (leads, price, newPrice) => `💰 <b>${leads} लीड्स</b> — अब सिर्फ <b>$${view(newPrice)}</b> <s>($${price})</s>\nफोन मालिक के नाम शामिल हैं। यह मौका न चूकें।`,
 buyLeadsPrice: (leads, price) => `💰 <b>${leads} लीड्स</b> — <b>$${price}</b>\nफोन मालिक के नाम शामिल हैं। जब आप तैयार हों।`,

 walletSelectCurrencyConfirm: `पुष्ट करें?`,

 validatorSelectCountry: `कृपया देश का चयन करें`,
 validatorPhoneNumber: `कृपया अपने नंबर पेस्ट करें या फाइल अपलोड करें जिसमें देश का कोड शामिल हो।`,
 validatorSelectSmsVoice: n =>
 `${n} फ़ोन नंबर पाए गए हैं। कृपया एसएमएस या वॉयस कॉल लीड्स की मान्यता के लिए विकल्प चुनें।`,
 validatorSelectCarrier: `कृपया ऑपरेटर का चयन करें`,
 validatorSelectCnam: `क्या आप अपनी मान्य लीड्स के साथ <b>फोन मालिक का नाम</b> चाहते हैं?\n\nजब आप जानते हैं कि आप किसे संपर्क कर रहे हैं, तो आप अपना संदेश व्यक्तिगत बना सकते हैं — लोग अपने नाम पर प्रतिक्रिया देते हैं। $15 प्रति 1,000 लीड्स। हर पैसा सही।`,
 validatorSelectAmount: (min, max) =>
 `आप कितने नंबरों की मान्यता चाहते हैं? एक संख्या चुनें या दर्ज करें। न्यूनतम ${min} और अधिकतम ${max}`,

 validatorSelectFormat: `फॉर्मेट चुनें, जैसे लोकल (212) या इंटरनेशनल (+1212)`,

 validatorSuccess: (n, m) => `${n} लीड्स की मान्यता हुई। ${m} मान्य फ़ोन नंबर पाए गए हैं।`,
 validatorProgress: (i, total) =>
 `${((i * 100) / total).toFixed()}% लीड्स मान्य किए जा रहे हैं। कृपया प्रतीक्षा करें.`,
 validatorProgressFull: (i, total) => `${((i * 100) / total).toFixed()}% लीड्स मान्य किए जा रहे हैं।`,

 validatorError: `दुर्भाग्यवश चयनित फ़ोन नंबर उपलब्ध नहीं हैं और आपका वॉलेट चार्ज नहीं किया गया है।`,
 validatorErrorFileData: `अवैध देश फ़ोन नंबर पाया गया। कृपया चयनित देश के लिए फ़ोन नंबर अपलोड करें।`,
 validatorErrorNoPhonesFound: `कोई फ़ोन नंबर नहीं मिला। पुनः प्रयास करें।`,

 validatorBulkNumbersStart: `लीड्स मान्यता की शुरुआत हो गई है और जल्द ही समाप्त होगी।`,

 // url re-director
 redSelectUrl: `कृपया वह यूआरएल साझा करें जिसे आप संक्षिप्त और विश्लेषित करना चाहते हैं। उदाहरण के लिए https://cnn.com`,
 redSelectRandomCustom: `कृपया अपने चयन के लिए यादृच्छिक या कस्टम लिंक चुनें`,
 redSelectProvider: `लिंक प्रदाता चुनें`,
 redSelectCustomExt: `कस्टम पिछला भाग दर्ज करें`,

 redValidUrl: `कृपया एक मान्य यूआरएल प्रदान करें। उदाहरण के लिए https://google.com`,
 redTakeUrl: url => `आपका संक्षिप्त यूआरएल है: ${url}`,
 redIssueUrlBitly: `लिंक शॉर्टनिंग विफल हुई। आपका वॉलेट चार्ज नहीं हुआ। कृपया पुनः प्रयास करें या 💬 सहायता प्राप्त करें बटन दबाएं।`,
 redIssueSlugCuttly: `वांछित लिंक नाम पहले से ही लिया गया है, कृपया दूसरा प्रयास करें।`,
 redIssueUrlCuttly: `लिंक शॉर्टनिंग विफल हुई। कृपया पुनः प्रयास करें या 💬 सहायता प्राप्त करें बटन दबाएं।`,
 freeLinksExhausted: `आपके सभी ${FREE_LINKS} ट्रायल लिंक समाप्त हो गए हैं! सब्सक्राइब करें — असीमित लिंक + मुफ्त डोमेन + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ वैलिडेशन मालिक के नाम सहित।`,
 subscriptionLeadsHint: `💡 सब्सक्राइबर्स को प्रत्येक प्लान पर ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ मुफ्त वैलिडेशन मालिक के नाम सहित मिलते हैं। $${PRICE_DAILY}/दिन से शुरू।`,
 linksRemaining: (count, total) => {
 const base = `आपके पास ${count}/${total || FREE_LINKS} Shortit ट्रायल लिंक शेष हैं।`
 if (count <= 2) return `${base}\n\n⚡ <b>सिर्फ ${count} लिंक बचे!</b> सब्सक्राइब करें — असीमित लिंक + मुफ्त डोमेन + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ वैलिडेशन मालिक के नाम सहित। $${PRICE_DAILY}/दिन से।`
 return base
 },
 redNewPrice: (price, newPrice) =>
 `कीमत अब $${view(newPrice)} <s>($${price})</s> है। कृपया भुगतान पद्धति का चयन करें।`,
 customLink: 'कस्टम लिंक',
 randomLink: 'रैंडम लिंक',
 askShortLinkExtension: 'कृपया हमें अपनी पसंदीदा शॉर्ट लिंक एक्सटेंशन बताएं: जैसे payer',
 linkAlreadyExist: `लिंक पहले से मौजूद है। कृपया 'ok' टाइप करें और दूसरा प्रयास करें।`,
 yourShortendUrl: shortUrl => `आपका शॉर्ट किया हुआ URL है: ${shortUrl}`,

 availablefreeDomain: (plan, available, s) =>
 `याद रखें, आपके ${plan} योजना में ${available} फ्री शामिल हैं${s}. आज ही अपना डोमेन प्राप्त करें!`,
 shortenedUrlLink: `कृपया वह यूआरएल साझा करें जिसे आप छोटा और विश्लेषित करना चाहते हैं। ई.g https://cnn.com`,
 selectedTrialPlan: `आपने फ्री ट्रायल योजना चुनी है`,
 userPressedBtn: message => `उपयोगकर्ता ने ${message} बटन दबाया।`,
 userToBlock: userToBlock => `उपयोगकर्ता ${userToBlock} नहीं मिला।`,
 userBlocked: userToBlock => `उपयोगकर्ता ${userToBlock} को ब्लॉक कर दिया गया है।`,
 checkingDomainAvail: `डोमेन उपलब्धता की जांच की जा रही है...`,
 checkingExistingDomainAvail: `मौजूदा डोमेन की उपलब्धता की जांच की जा रही है...`,
 subscribeFirst: `📋 सबसे पहले सदस्यता लें`,
 freeValidationUsed: (amount, remaining) => `${amount} USA फोन नंबर आपकी सब्सक्रिप्शन से वैलिडेट हुए! शेष मुफ्त वैलिडेशन: ${remaining.toLocaleString()}।`,
 partialFreeValidation: (freeAmount, totalAmount, paidAmount, paidPrice) => `आपके पास ${freeAmount.toLocaleString()} मुफ्त वैलिडेशन शेष हैं। आपने ${totalAmount.toLocaleString()} नंबरों का अनुरोध किया है।\n\n${freeAmount.toLocaleString()} मुफ्त में होंगे, और शेष ${paidAmount.toLocaleString()} के लिए $${paidPrice} का भुगतान करना होगा। कृपया नीचे भुगतान करें।`,
 notValidHalf: `एक वैध बैक हाफ दर्ज करें`,
 linkAlreadyExist: `लिंक पहले से मौजूद है। कृपया कोई अन्य आजमाएं।`,
 issueGettingPrice: `मूल्य प्राप्त करने में समस्या`,
 domainInvalid: `डोमेन नाम अमान्य है। कृपया कोई अन्य डोमेन नाम आजमाएं। उपयोग प्रारूप abcpay.com`,
 chooseValidPlan: `कृपया एक वैध योजना चुनें`,
 noDomainFound: `कोई डोमेन नाम नहीं मिला`,
 chooseValidDomain: `कृपया एक वैध डोमेन चुनें`,
 failedAudio: '❌ ऑडियो प्रोसेस करने में विफल। कृपया पुनः प्रयास करें।',
 enterBroadcastMessage: 'संदेश दर्ज करें',
 provide2Nameservers: 'कृपया कम से कम 2 नेमसर्वर स्पेस से अलग करके दें।',
 noDomainSelected: 'कोई डोमेन चयनित नहीं।',
 validInstitutionName: '⚠️ कृपया एक मान्य संस्थान नाम दर्ज करें (2-100 अक्षर)।',
 validCityName: '⚠️ कृपया एक मान्य शहर का नाम दर्ज करें।',
 errorDeletingDns: error => `डीएनएस रिकॉर्ड को हटाने में त्रुटि, ${error}, कृपया फिर से मूल्य प्रदान करें`,
 selectValidOption: `सही विकल्प चुनें`,
 cancelled: 'रद्द किया गया।',
 domainActionsMenu: (domain) => `<b>${domain} के लिए कार्रवाई</b>\n\nएक विकल्प चुनें:`,
 purchaseFailed: '❌ खरीदारी विफल। आपके वॉलेट में राशि वापस कर दी गई। कृपया पुनः प्रयास करें या सहायता से संपर्क करें।',
 maxDnsRecord: `अधिकतम 4 NS रिकॉर्ड जोड़े जा सकते हैं, आप पहले के NS रिकॉर्ड को अपडेट या हटा सकते हैं`,
 errorSavingDns: error => `डीएनएस रिकॉर्ड को बचाने में त्रुटि, ${error}, कृपया फिर से मूल्य प्रदान करें`,
 fileError: `फाइल प्रोसेसिंग के दौरान त्रुटि हुई।`,
 ammountIncorrect: `राशि गलत है`,
 subscriptionExpire: (subscribedPlan, timeEnd) => `आपका ${subscribedPlan} योजना समाप्त हो गया है ${timeEnd}`,
 plansSubscripedtill: (subscribedPlan, timeEnd) =>
 `आप ${subscribedPlan} योजना में सदस्यता ले चुके हैं। आपका प्लान ${timeEnd} तक वैध है`,
 planNotSubscriped: `आपके पास अभी कोई सक्रिय उत्पाद या सदस्यता नहीं है।\n\nखरीदने के बाद आपकी होस्टिंग, Cloud IVR नंबर, VPS और सदस्यता यहाँ दिखाई देंगे। शुरू करने के लिए मुख्य मेनू में किसी उत्पाद पर टैप करें!`,
 noShortenedUrlLink: `आपके पास अभी कोई संक्लिष्ट लिंक नहीं है।`,
 shortenedLinkText: linksText => `यहां आपके संक्लिष्ट लिंक हैं:\n${linksText}`,
 analyticsNotAvailable: provider => `📊 एनालिटिक्स उपलब्ध नहीं (${provider})`,

 qrCodeText: `यह आपका क्यूआर कोड है!`,
 scanQrOrUseChat: chatId => `📱 <b>${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS ऐप</b>\n\nआपका एक्टिवेशन कोड:\n<code>${chatId}</code>\n\n📲 डाउनलोड: ${process.env.SMS_APP_LINK || 'सहायता से संपर्क करें'}`,
 domainPurchasedFailed: (domain) =>
 `❌ डोमेन <b>${domain}</b> का पंजीकरण पूरा नहीं हो सका। कृपया पुनः प्रयास करें या समस्या बनी रहने पर सहायता से संपर्क करें।`,
 noDomainRegistered: 'आपके पास अभी तक कोई खरीदा हुआ डोमेन नहीं है।',
 registeredDomainList: domainsText => `यहाँ आपके खरीदे हुए डोमेन हैं:\n${domainsText}`,
 selectDomainAction: domain => `<b>${domain}</b>\n\nआप इस डोमेन के साथ क्या करना चाहेंगे?`,
 domainActionDns: '🔧 DNS प्रबंधन',
 domainActionShortener: '🔗 URL शॉर्टनर सक्रिय करें',
 domainActionDeactivateShortener: '🔗 URL शॉर्टनर निष्क्रिय करें',
 comingSoon: `जल्द आ रहा है`,

 // --- Missing translations (added for completeness) ---
 Annually: 'वार्षिक',
 Daily: 'दैनिक',
 Hourly: 'प्रति घंटा',
 Monthly: 'मासिक',
 Quarterly: 'तिमाही',
 Weekly: 'साप्ताहिक',
 addSubdomain: 'उप-डोमेन जोड़ें',
 antiRedDisabled: domain => `❌ <b>${domain}</b> के लिए Visitor Captcha <b>अक्षम</b>।\n\n"ब्राउज़र सत्यापित हो रहा है" पेज अब मानव visitors को नहीं दिखेगा।\n\n✅ <b>Anti-Red सुरक्षा पूरी तरह सक्रिय है</b>: Scanner cloaking (Google SafeBrowsing, VirusTotal, McAfee, PhishTank, Sucuri + 25 अन्य), honeypots, IP bans और WAF नियम — हर request के लिए चलते हैं।\n\nकेवल मानव-सामना करने वाला चैलेंज KV flag के माध्यम से छिपाया गया है।`,
 antiRedDisableConfirm: domain => `🛡️ <b>${domain} के लिए Visitor Captcha छुपाएं?</b>\n\nयह केवल मानव visitors के लिए "ब्राउज़र सत्यापित हो रहा है" पेज को छुपाता है (ताकि उन्हें 3-सेकंड का चेक न दिखे)।\n\n✅ Scanner cloaking, honeypots, IP bans और WAF नियम <b>सक्रिय रहेंगे</b> — Anti-Red सुरक्षा बंद नहीं हो रही।\n\nजारी रखें?`,
 antiRedConfirmDisable: '✅ हां, captcha पेज छुपाएं',
 antiRedDisableConfirmWrong: 'पुष्टि के लिए हरा बटन दबाएँ, या रद्द करने के लिए ↩️ वापस।',
 antiRedAutoReenabled: domain => `🛡️ <b>${domain}</b> के लिए Visitor Captcha फिर से सक्रिय।`,
 antiRedRestoredNote: domain => `🛡️ <b>${domain} के लिए Anti-Red पुनर्स्थापित।</b>\n\nहमने एक आंतरिक बग ठीक किया जहां Visitor Captcha बंद करने से scanner cloaking भी हट जाता था। Anti-Red अब फिर से ON है। आपकी "Visitor Captcha OFF" प्राथमिकता संरक्षित है।`,
 antiRedEnabled: domain => `✅ <b>${domain}</b> के लिए Anti-Red सुरक्षा <b>सक्षम</b>।\n\nआगंतुकों को साइट पर जाने से पहले "ब्राउज़र सत्यापन" दिखाई देगा।`,
 antiRedError: '❌ Anti-Red सुरक्षा अपडेट करने में विफल। कृपया पुनः प्रयास करें।',
 honeypotMonthlyOnly: `🍯 <b>Honeypot ट्रैप</b>\n\nयह नियंत्रण <b>मासिक</b> होस्टिंग प्लान (Premium या Golden) पर उपलब्ध है।\n\nHoneypot ट्रैप छिपे हुए चारे होते हैं जो आपकी साइट को स्कैन करने वाले बॉट्स को पकड़कर स्वतः बैन कर देते हैं। कच्चा JSON/API आउटपुट देने वाली कुछ साइटें इन्हें बंद रखना पसंद करती हैं — यह टॉगल मासिक-प्लान सुविधा है।\n\nप्रति-डोमेन Honeypot ट्रैप प्रबंधित करने के लिए मासिक प्लान में अपग्रेड करें।`,
 honeypotStatusOn: domain => `🍯 <b>${domain}</b> के लिए <b>Honeypot ट्रैप</b>\n\nस्थिति: <b>✅ चालू</b>\n\nबॉट्स को पकड़ने और स्वतः बैन करने के लिए आपके HTML पेजों में छिपे हुए चारा लिंक, फ़ॉर्म फ़ील्ड और नकली API इंजेक्ट किए जाते हैं।\n\nℹ️ ट्रैप केवल असली HTML पेजों में ही जोड़े जाते हैं — JSON/API प्रतिक्रियाओं को कभी नहीं छुआ जाता। केवल तभी बंद करें जब आपकी साइट में इनलाइन आउटपुट हो जो सटीक रहना चाहिए।`,
 honeypotStatusOff: domain => `🍯 <b>${domain}</b> के लिए <b>Honeypot ट्रैप</b>\n\nस्थिति: <b>❌ बंद</b>\n\nआपके पेजों में कोई honeypot मार्कअप इंजेक्ट नहीं किया जाता।\n\n✅ <b>अभी भी सक्रिय:</b> विज़िटर Captcha, स्कैनर क्लोकिंग, IP बैन और WAF नियम — honeypot बंद करने से इनमें से कोई भी परत कमज़ोर नहीं होती।\n\nट्रैप वापस चालू करने के लिए नीचे टैप करें।`,
 honeypotTurnOff: '❌ Honeypot ट्रैप बंद करें',
 honeypotTurnOn: '✅ Honeypot ट्रैप चालू करें',
 honeypotTurningOn: domain => `⏳ <b>${domain}</b> के लिए Honeypot ट्रैप चालू किए जा रहे हैं...`,
 honeypotTurningOff: domain => `⏳ <b>${domain}</b> के लिए Honeypot ट्रैप बंद किए जा रहे हैं...`,
 honeypotEnabled: domain => `✅ <b>${domain}</b> के लिए Honeypot ट्रैप <b>चालू</b> कर दिए गए।\n\nअब आपके HTML पेजों में छिपे बॉट चारे इंजेक्ट किए जाते हैं। JSON/API प्रतिक्रियाएँ कभी संशोधित नहीं होतीं।`,
 honeypotDisabled: domain => `❌ <b>${domain}</b> के लिए Honeypot ट्रैप <b>बंद</b> कर दिए गए।\n\nआपके पेजों में कोई ट्रैप मार्कअप इंजेक्ट नहीं किया जाएगा।\n\n✅ विज़िटर Captcha, स्कैनर क्लोकिंग, IP बैन और WAF नियम पूरी तरह सक्रिय रहते हैं।`,
 honeypotError: '❌ Honeypot ट्रैप अपडेट करने में विफल। कृपया पुनः प्रयास करें।',
 honeypotPickDomain: '🍯 <b>Honeypot ट्रैप</b> — एक डोमेन चुनें\n\nइस प्लान में एक से अधिक डोमेन हैं। जिसे टॉगल करना है उस डोमेन पर टैप करें। प्रत्येक नाम के आगे वर्तमान स्थिति दिखाई गई है।',
 honeypotDomainButton: (domain, off, hasCF) => hasCF ? `${off ? '🔴 बंद' : '🟢 चालू'} · ${domain}` : `⚠️ CF नहीं · ${domain}`,
captchaPickDomain: '🛡️ <b>Visitor Captcha</b> — डोमेन चुनें\n\nइस प्लान में एक से अधिक डोमेन हैं। जिस डोमेन के लिए कैप्चा टॉगल करना है उस पर टैप करें। प्रत्येक नाम के बगल में वर्तमान स्थिति दिखाई गई है।',
captchaDomainButton: (domain, isOff, hasCF) => hasCF ? `${isOff ? '🔴 बंद' : '🟢 चालू'} · ${domain}` : `⚠️ CF नहीं · ${domain}`,
 antiRedNoCF: domain => `⚠️ <b>${domain}</b> Cloudflare का उपयोग नहीं कर रहा। Anti-Red सुरक्षा के लिए Cloudflare नेमसर्वर आवश्यक हैं।`,
 antiRedStatusOff: domain => `🛡️ <b>${domain}</b> के लिए <b>Visitor Captcha</b>\n\nस्थिति: <b>❌ बंद (केवल मानव)</b>\n\n"ब्राउज़र सत्यापित हो रहा है" पेज मानव visitors को नहीं दिखेगा।\n\n✅ <b>सक्रिय:</b> Scanner cloaking (Google SafeBrowsing, VirusTotal, McAfee, PhishTank और 25+ अन्य), honeypots, IP bans, WAF नियम — हर request के लिए चलते हैं।\n\nVisitor captcha वापस लाने के लिए नीचे टैप करें।`,
 antiRedStatusOn: domain => `🛡️ <b>${domain}</b> के लिए <b>Anti-Red सुरक्षा</b>\n\nस्थिति: <b>✅ चालू</b>\n\nयह आपके डोमेन को फ़िशिंग स्कैनर्स से बचाता है।\n\n⚠️ <b>सिफारिश:</b> JS Challenge चालू रखें — यह अधिकतम सुरक्षा प्रदान करता है।`,
 antiRedTurnOff: '❌ सुरक्षा बंद करें',
 antiRedTurnOn: '✅ सुरक्षा चालू करें',
 antiRedTurningOff: domain => `⏳ <b>${domain}</b> के लिए Anti-Red सुरक्षा अक्षम कर रहे हैं...`,
 antiRedTurningOn: domain => `⏳ <b>${domain}</b> के लिए Anti-Red सुरक्षा सक्षम कर रहे हैं...`,
 dnsWarningHostedDomain: (domain, plan) => `⚠️ <b>चेतावनी: इस डोमेन पर सक्रिय होस्टिंग प्लान है</b>\n\nडोमेन: <b>${domain}</b>\nप्लान: ${plan}\n\n<b>⚠️ DNS रिकॉर्ड बदलने से आपकी होस्टिंग और anti-red सुरक्षा टूट सकती है!</b>\n\nDNS परिवर्तन केवल तभी करें जब आप प्रभाव को पूरी तरह समझते हों। गलत परिवर्तन आपकी वेबसाइट को अनुपलब्ध बना सकते हैं।\n\n<b>क्या आप सुनिश्चित हैं कि आप जारी रखना चाहते हैं?</b>`,
 dnsProceedAnyway: '⚠️ फिर भी जारी रखें',
 dnsCancel: '❌ रद्द करें',
 domainTypeRegistered: '🏷️ हमारे पास पंजीकृत',
 domainTypeExternal: '🌍 बाहरी',
 buyLeads: '🎯 फ़ोन लीड्स खरीदें',
 cancelRenewNow: '❌ रद्द करें',
 confirmRenewNow: '✅ पुष्टि करें और भुगतान करें',
 domainActionAntiRed: '🛡️ विज़िटर Captcha',
 domainActionVisitorCaptcha: '🛡️ विज़िटर Captcha',
 domainActionVisitorCaptchaLocked: '🔒 विज़िटर Captcha (केवल Gold)',
 visitorCaptchaGoldOnly: (domain, price) => `🔒 <b>${domain}</b> के लिए <b>विज़िटर Captcha</b>\n\nयह सुविधा केवल <b>👑 Golden Anti-Red HostPanel</b> प्लान के लिए है।\n\nप्रति-डोमेन विज़िटर Captcha सक्षम करने के लिए Golden (<b>$${price}/माह</b>) में अपग्रेड करें।`,
 visitorCaptchaNoHosting: (domain, price) => `⚠️ <b>विज़िटर Captcha</b> केवल Golden Anti-Red HostPanel प्लान वाले डोमेन के लिए उपलब्ध है।\n\nडोमेन: <b>${domain}</b>\n\nGolden (<b>$${price}/माह</b>) में अपग्रेड करें।`,
 upgradeToGoldButton: price => `⬆️ Gold में अपग्रेड करें ($${price}/माह)`,
 googleEmail: 'Google Email सेटअप',
 pointToIp: 'डोमेन को IP पर पॉइंट करें',
 shortenLink: '✂️ लिंक छोटा करें',
 toggleAutoRenew: '🔁 ऑटो-रिन्यू टॉगल करें',
 validateLeads: '✅ नंबर सत्यापित करें',
 verification: 'डोमेन सत्यापन (TXT)',
 walletBalanceLowAmount: (needed, balance) => 
 `आपका वॉलेट बैलेंस ($${balance.toFixed(2)}) इस खरीदारी के लिए कम है।\n\nआपको <b>$${(needed - balance).toFixed(2)} और</b> चाहिए। टॉप अप के लिए डिपॉज़िट टैप करें।`,
 zohoEmail: 'Zoho Email सेटअप',
 goBackToCoupon: '❌ वापस जाएं और कूपन लागू करें',
 errorFetchingCryptoAddress: 'क्रिप्टोक्यूरेंसी पता प्राप्त करने में त्रुटि। कृपया बाद में पुनः प्रयास करें।',
 paymentSuccessFul: '✅ भुगतान पुष्टि — अभी आपकी सेवाएं तैयार हो रही हैं।',
 domainProcessingOrder: '⏳ आपका ऑर्डर प्रोसेस हो रहा है — अभी आपका डोमेन रजिस्टर किया जा रहा है।',
 nsVerifying: (tld) => `🔍 .${tld} रजिस्ट्री पर नेमसर्वर सेटअप सत्यापित किया जा रहा है — लगभग 30–60 सेकंड…`,
 nsVerifiedOk: '✅ नेमसर्वर सत्यापित — अब पंजीकरण कर रहे हैं।',
 mpPaywall: (fee, balance) =>
   `🛒 <b>मार्केटप्लेस एक्सेस</b>\n\n` +
   `एकमुश्त सक्रियण शुल्क: <b>$${fee}</b>\n` +
   `एक बार भुगतान करें — हमेशा के लिए एक्सेस रखें (ब्राउज़, लिस्ट, चैट, एस्क्रो)।\n\n` +
   `💳 वॉलेट बैलेंस: <b>$${balance.toFixed(2)}</b>\n\n` +
   (balance >= fee
     ? `सक्रिय करने के लिए नीचे टैप करें।`
     : `⚠️ <i>सक्रिय करने के लिए कम से कम $${(fee - balance).toFixed(2)} और टॉप अप करें।</i>`),
 mpPaywallPayBtn: (fee) => `✅ वॉलेट से $${fee} भुगतान करें`,
 mpPaywallTopupBtn: '👛 वॉलेट टॉप अप करें',
 mpPaywallCancelBtn: '❌ रद्द करें',
 mpPaywallCryptoBtn: '₿ क्रिप्टो से भुगतान करें',
 mpPaywallNgnBtn: '🏦 NGN (बैंक) से भुगतान करें',
 mpPayChooseCrypto: (fee) => `₿ <b>$${fee} मार्केटप्लेस शुल्क क्रिप्टो से भुगतान करें</b>\n\nएक सिक्का चुनें — आपको बिल्कुल शुल्क भेजने के लिए एक पता मिलेगा। भुगतान की पुष्टि होते ही एक्सेस स्वतः सक्रिय हो जाएगा।`,
 mpPayNgnStarting: (fee) => `🏦 <b>$${fee} मार्केटप्लेस शुल्क के लिए आपका NGN भुगतान तैयार किया जा रहा है…</b>`,
 mpAccessActivated: (method) => `🎉 <b>मार्केटप्लेस एक्सेस सक्रिय!</b>\n\n✅ ${method} से भुगतान हुआ।\n\nअब आप कर सकते हैं:\n• 🛍️ अपने सामान और सेवाएं <b>सूचीबद्ध</b> करें\n• 💬 खरीदारों से चैट करें\n• 🔒 सुरक्षित सौदों के लिए एस्क्रो का उपयोग करें\n\nमार्केटप्लेस खोलने के लिए नीचे टैप करें।`,
 mpAccessAlreadyCredited: (usd) => `ℹ️ आपके पास पहले से मार्केटप्लेस एक्सेस है, इसलिए आपका <b>$${Number(usd).toFixed(2)}</b> भुगतान आपके वॉलेट में जमा कर दिया गया।`,
 mpOpenMarketplaceBtn: '🏪 मार्केटप्लेस खोलें',
 mpPaywallInsufficient: (fee, balance) =>
   `🚫 <b>अपर्याप्त वॉलेट बैलेंस</b>\n\n` +
   `आवश्यक: <b>$${fee}</b> · उपलब्ध: <b>$${balance.toFixed(2)}</b>\n\n` +
   `कृपया <b>$${Math.max(fee - balance, 25).toFixed(2)}</b> या अधिक 👛 <b>वॉलेट</b> के माध्यम से टॉप अप करें, फिर पुनः प्रयास करें।`,
 mpPaywallSuccess: (fee, balance) =>
   `🎉 <b>मार्केटप्लेस सक्रिय हो गया!</b>\n\n` +
   `💵 शुल्क: <b>$${fee}</b>\n` +
   `💳 नया बैलेंस: <b>$${balance.toFixed(2)}</b>\n\n` +
   `स्वागत है — मार्केटप्लेस खोला जा रहा है…`,

 // कॉल फॉरवर्डिंग (Cloud IVR)
 fwdInsufficientBalance: (walletBal, rate) => `🚫 <b>अपर्याप्त बैलेंस</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · $${rate}/मिनट आवश्यक\n👉 👛 वॉलेट से <b>$25</b> रिचार्ज करें।`,
 fwdBlocked: (number) => `🚫 <b>अवरुद्ध</b> — ${number} प्रीमियम गंतव्य है।\n💬 <b>सहायता प्राप्त करें</b> दबाएं।`,
 fwdNotRoutable: (number) => `⚠️ ${number} उपलब्ध नहीं। नंबर जांचें या 💬 <b>सहायता प्राप्त करें</b> दबाएं।`,
 fwdValidating: '⏳ सत्यापन हो रहा है...',
 fwdEnterNumber: (rate, walletBal, usRate) => {
 let text = `देश कोड सहित नंबर दर्ज करें (उदा: +14155551234)\n\n💰 <b>फ़ॉरवर्डिंग दरें</b> — वॉलेट से प्रति मिनट चार्ज:\n🇺🇸 US / कनाडा: <b>$${Number(usRate).toFixed(2)}/मिनट</b>\n🌍 अंतरराष्ट्रीय: <b>$${Number(rate).toFixed(2)}/मिनट</b>`
 if (walletBal !== undefined) {
 const estUs = usRate > 0 ? Math.floor(walletBal / usRate) : 0
 const estIntl = rate > 0 ? Math.floor(walletBal / rate) : 0
 text += `\n\n💳 वॉलेट: <b>$${walletBal.toFixed(2)}</b> — लगभग <b>${estUs} मिनट</b> (US/CA) या <b>${estIntl} मिनट</b> (अंतरराष्ट्रीय) तक, फिर टॉप-अप ज़रूरी।`
 if (walletBal < rate) text += `\n⚠️ पहले 👛 वॉलेट से <b>$25</b> रिचार्ज करें।`
 }
 return text
 },
 fwdConfirm: (number, forwardTo, modeLabel, rate, walletBal, estMin) => {
 return `📲 <b>कॉल फ़ॉरवर्डिंग की पुष्टि करें</b>\n\n📞 आपका नंबर: <b>${number}</b>\n➡️ यहाँ फ़ॉरवर्ड करें: <b>${forwardTo}</b>\n⚙️ मोड: <b>${modeLabel}</b>\n💰 दर: <b>$${Number(rate).toFixed(2)}/मिनट</b> — वॉलेट से चार्ज\n💳 वॉलेट: <b>$${walletBal.toFixed(2)}</b> — लगभग <b>${estMin} मिनट</b> तक\n\nसक्रिय करने के लिए <b>✅ पुष्टि करें</b> टैप करें, या ↩️ वापस जाकर नंबर बदलें।`
 },
 fwdConfirmBtn: '✅ पुष्टि करें और चालू करें',
 planNotFound: 'प्लान नहीं मिला।',
 noActivePlans: '📋 <b>मेरे होस्टिंग प्लान</b>\n\nकोई सक्रिय होस्टिंग प्लान नहीं। शुरू करने के लिए प्लान खरीदें!',
 noRegisteredDomains: 'कोई पंजीकृत डोमेन नहीं। कृपया नया डोमेन रजिस्टर करें या बाहरी डोमेन कनेक्ट करें।',
 selectFromDomains: 'अपने पंजीकृत डोमेन में से चुनें:',
 selectDomainFromList: 'कृपया सूची से डोमेन चुनें।',
 enterValidDomain: 'कृपया मान्य डोमेन नाम दर्ज करें (जैसे: example.com)।',
 enterCouponCode: 'कूपन कोड दर्ज करें:',
 invalidCoupon: 'अमान्य कूपन। पुनः प्रयास करें या छोड़ें।',
 couponAlreadyUsed: 'कूपन पहले ही उपयोग हो चुका। दूसरा आज़माएं या छोड़ें।',
 couponUsedToday: '⚠️ आपने आज पहले ही यह कूपन उपयोग कर लिया है।',
 keyboardRefreshed: 'कीबोर्ड रिफ्रेश! कृपया विकल्प चुनें:',
 supportEnded: '✅ सपोर्ट सेशन समाप्त। संपर्क करने के लिए धन्यवाद!',
 noSupportSession: 'कोई सक्रिय सपोर्ट सेशन नहीं।',
 supportMsgReceived: '✉️ संदेश प्राप्त हुआ! एक सहायता एजेंट जल्द ही आपसे संपर्क करेगा।',
 supportMsgSent: '✉️ संदेश सहायता टीम को भेजा गया। हम जल्द ही उत्तर देंगे।',
 someIssue: 'कोई समस्या हुई',
 dbConnecting: 'डेटाबेस कनेक्ट हो रहा है, कृपया कुछ देर बाद प्रयास करें',
 chooseValidDomain: 'कृपया मान्य डोमेन चुनें',
 dnsCustomOnly: 'DNS रिकॉर्ड आपके कस्टम नेमसर्वर द्वारा प्रबंधित हैं। आप केवल नेमसर्वर अपडेट या DNS प्रोवाइडर बदल सकते हैं।',
 noDeleteRecords: 'कोई हटाने योग्य रिकॉर्ड नहीं। NS रिकॉर्ड केवल अपडेट किए जा सकते हैं।',
 invalidSrvFormat: 'अमान्य प्रारूप। <b>_service._protocol</b> उपयोग करें (जैसे: _sip._tcp):',
 insufficientBalance: (usdBal, price) => `⚠️ अपर्याप्त शेष। आपके पास $${usdBal} है, $${price} चाहिए।\nकृपया पहले फंड जमा करें।`,
 leadSelectMetro: (target) => `📍 <b>${target}</b> के लिए मेट्रो क्षेत्र चुनें:\n\nअधिकतम कवरेज के लिए "सभी शहर" चुनें।`,
 leadSelectArea: (target, city) => `📞 <b>${target}</b> — <b>${city}</b> के लिए एरिया कोड चुनें:\n\n"मिक्स्ड कोड" सबसे बड़ा पूल देता है।`,
 leadRequestCustom: '📝 <b>कस्टम लीड अनुरोध</b>\n\nबताएं किस संस्था या कंपनी के लीड चाहिए।\nहम सत्यापित वास्तविक नंबर प्रदान करते हैं:',
 leadCustomCity: (target) => `🏙️ किस शहर से लीड चाहिए?\n\nलक्ष्य: <b>${target}</b>\n\nशहर का नाम टाइप करें या "राष्ट्रव्यापी":`,
 leadCustomDetails: (target, city) => `📋 अतिरिक्त विवरण?\n\nलक्ष्य: <b>${target}</b>\nक्षेत्र: <b>${city}</b>\n\nविवरण टाइप करें या "कुछ नहीं":`,
 leadAllCities: 'सभी शहर',
 leadNationwide: 'राष्ट्रव्यापी',
 leadNone: 'कुछ नहीं',
 leadRequestTarget: '📝 कस्टम लक्ष्य अनुरोध',
 noPendingLeads: '📝 कोई लंबित लीड अनुरोध नहीं।',
 backupCreated: 'बैकअप बनाया गया।',
 dataRestored: 'डेटा पुनर्स्थापित।',
 vpsRefundFailed: (currency, amount, error) => `❌ <b>VPS विफल</b>\n\n✅ ${currency}${amount} वापस।\n\nत्रुटि: ${error}`,
 shortenerConflict: (domain, plan) => `❌ सक्रिय नहीं हो सकता — <b>${domain}</b> पर सक्रिय होस्टिंग (<b>${plan}</b>)। दूसरा डोमेन उपयोग करें।`,
 shortenerLinked: (domain) => `✅ <b>${domain}</b> शॉर्टनर से जुड़ा। DNS ~24 घंटे में लागू होगा।`,
 shortenerError: (domain, error) => `❌ शॉर्टनर त्रुटि <b>${domain}</b>: ${error}`,
 domainSearching: (domain) => `🔍 ${domain} की उपलब्धता खोज रहे हैं...`,
 domainNotAvailable: (domain) => `❌ <b>${domain}</b> उपलब्ध नहीं।`,
 domainSearchAlts: (baseName) => `🔍 <b>${baseName}</b> के विकल्प खोज रहे हैं...`,
 domainAltsFound: (altList) => `✅ उपलब्ध विकल्प:\n\n${altList}\n\nडोमेन टाइप करें:`,
 dnsLinkError: (domain, error) => `❌ <b>${domain}</b> लिंक नहीं हो सका: ${error}`,
 dnsSaveError: (domain, error) => `❌ DNS त्रुटि <b>${domain}</b>: ${error}`,
 selectProceedOrCancel: 'कृपया "आगे बढ़ें" या "रद्द करें" चुनें।',

 // ── Email Blast i18n ──
 ebSendBlast: '📤 ईमेल ब्लास्ट भेजें',
 ebMyCampaigns: '📬 मेरे अभियान',
 ebAdminPanel: '⚙️ एडमिन पैनल',
 ebCancelBtn: '❌ रद्द करें',
 ebCancelled: '❌ रद्द किया गया।',
 ebUploadCsvTxt: '📎 कृपया CSV/TXT फाइल अपलोड करें या ईमेल पते पेस्ट करें (प्रति पंक्ति एक)।',
 ebUploadCsvOnly: '❌ कृपया <b>.csv</b> या <b>.txt</b> फाइल अपलोड करें।',
 ebUploadHtmlFile: '📎 कृपया <b>.html</b> फाइल अपलोड करें, या ❌ रद्द करें दबाएं।',
 ebTypeOrUpload: '📝 कृपया अपना ईमेल संदेश टाइप करें या HTML फाइल अपलोड करें।',
 ebEnterSubject: '✏️ नई <b>विषय</b> पंक्ति दर्ज करें:',
 ebChooseTextOrHtml: 'चुनें: "📝 सादा टेक्स्ट" या "📎 HTML अपलोड"',
 ebTypeText: '📝 सादा टेक्स्ट',
 ebUploadHtml: '📎 HTML अपलोड',
 ebInvalidEmail: '❌ अमान्य ईमेल पता। कृपया वैध ईमेल दर्ज करें (जैसे: you@gmail.com):',
 ebFailedReadHtml: '❌ HTML फाइल पढ़ने में विफल। कृपया पुनः प्रयास करें या अन्य फाइल अपलोड करें।',
 ebBundleNotFound: '❌ बंडल नहीं मिला।',
 ebCampaignNotFound: '❌ अभियान नहीं मिला।',
 ebTestSending: (addr) => `⏳ Brevo के माध्यम से <b>${addr}</b> पर टेस्ट ईमेल भेज रहे हैं...`,
 ebAddDomainBtn: '➕ डोमेन जोड़ें',
 ebRemoveDomainBtn: '❌ डोमेन हटाएं',
 ebDashboardBtn: '📊 डैशबोर्ड',
 ebManageDomainsBtn: '🌐 डोमेन प्रबंधित करें',
 ebManageIpsBtn: '🖥️ IP और वार्मिंग प्रबंधित करें',
 ebPricingBtn: '💰 मूल्य निर्धारण',
 ebSuppressionBtn: '🚫 दमन सूची',
 ebAddIpBtn: '➕ IP जोड़ें',
 ebPauseIpBtn: '⏸ IP रोकें',
 ebResumeIpBtn: '▶️ IP पुनः शुरू करें',
 ebAdminPanelTitle: '⚙️ <b>ईमेल एडमिन पैनल</b>',
 ebNoDomains: '📭 कोई डोमेन कॉन्फ़िगर नहीं है।',
 ebDomainRemoved: (d) => `✅ डोमेन <b>${d}</b> सफलतापूर्वक हटाया गया।\n\nDNS रिकॉर्ड साफ किए गए।`,
 ebDomainRemoveFailed: (err) => `❌ हटाने में विफल: ${err}`,
 ebInvalidDomain: '❌ अमान्य डोमेन नाम। कृपया वैध डोमेन दर्ज करें (जैसे example.com)',
 ebInvalidIp: '❌ अमान्य IP पता। कृपया वैध IPv4 दर्ज करें (जैसे 1.2.3.4)',
 ebSettingUpDomain: (d) => `⏳ <b>${d}</b> सेट अप कर रहे हैं...\n\nDNS रिकॉर्ड बना रहे हैं, DKIM कुंजी जनरेट कर रहे हैं...`,
 ebNoActiveIps: 'रोकने के लिए कोई सक्रिय IP नहीं।',
 ebNoPausedIps: 'कोई रुकी हुई IP नहीं।',
 ebIpPaused: (ip) => `⏸ IP ${ip} रोकी गई।`,
 ebIpResumed: (ip) => `▶️ IP ${ip} पुनः शुरू।`,
 ebRateUpdated: (rate) => `✅ दर अपडेट: <b>$${rate}/ईमेल</b> ($${(rate * 500).toFixed(0)} प्रति 500)`,
 ebMinUpdated: (min) => `✅ न्यूनतम ईमेल अपडेट: <b>${min}</b>`,
 ebInvalidRate: '❌ अमान्य। 0.10 जैसा नंबर दर्ज करें',
 ebInvalidMin: '❌ अमान्य। एक नंबर दर्ज करें।',
 ebSelectIpDomain: (ip) => `🖥️ IP <b>${ip}</b> किस डोमेन को असाइन करें?`,

 // ── Audio Library / IVR i18n ──
 audioLibTitle: '🎵 <b>ऑडियो लाइब्रेरी</b>',
 audioLibEmpty: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nआपके पास कोई सहेजी गई ऑडियो फाइल नहीं है।\n\nIVR अभियानों के लिए ऑडियो फाइल (MP3, WAV, OGG) अपलोड करें।',
 audioLibEmptyShort: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nकोई ऑडियो फाइल नहीं। शुरू करने के लिए एक अपलोड करें।',
 audioUploadBtn: '📎 ऑडियो अपलोड',
 audioUploadNewBtn: '📎 नया ऑडियो अपलोड',
 audioUseTemplateBtn: '📝 IVR टेम्पलेट उपयोग करें',
 audioSelectOption: 'एक विकल्प चुनें:',
 audioSelectIvr: 'IVR ऑडियो चुनें:',
 audioReceived: (size) => `✅ ऑडियो प्राप्त! (${size} KB)\n\nअपनी लाइब्रेरी के लिए इसे नाम दें:`,
 audioReceivedShort: '✅ ऑडियो प्राप्त!\n\nइसे नाम दें:',
 audioSaved: (name) => `✅ ऑडियो सहेजा गया: <b>${name}</b>\n\nअब आप इसे IVR अभियानों में उपयोग कर सकते हैं!`,
 audioDeleted: (name) => `✅ हटाया गया: <b>${name}</b>`,
 audioGenFailed: (err) => `❌ ऑडियो जनरेशन विफल: ${err}`,
 audioFailedSave: '❌ ऑडियो ग्रीटिंग सहेजने में विफल। कृपया पुनः प्रयास करें।',
 audioMaxImages: '📸 अधिकतम 5 छवियां। जारी रखने के लिए ✅ अपलोड पूर्ण दबाएं।',

 // ── Common i18n ──
 chooseOption: 'कृपया एक विकल्प चुनें:',
 refreshStatusBtn: '🔄 स्टेटस रिफ्रेश करें',
 cancelRefundBtn: '❌ रद्द करें और रिफंड',
 dbConnectRetry: 'डेटाबेस कनेक्ट हो रहा है, कृपया कुछ क्षण में पुनः प्रयास करें',
 nsCannotAdd: 'नेमसर्वर रिकॉर्ड जोड़े नहीं जा सकते। नेमसर्वर बदलने के लिए <b>DNS रिकॉर्ड अपडेट करें</b> का उपयोग करें।',
 noSupportSession: 'कोई सक्रिय सपोर्ट सेशन नहीं।',
 noPendingLeads: '📝 कोई लंबित लीड अनुरोध नहीं।',
 invalidAmountPositive: '⚠️ राशि एक सकारात्मक संख्या होनी चाहिए।',

 // ── Marketplace ──
 mpHome: `🏪 <b>${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()} मार्केटप्लेस</b>\n\n💰 <b>अपने डिजिटल उत्पाद बेचें</b> — 60 सेकंड में लिस्ट करें, एस्क्रो से सुरक्षित भुगतान पाएं\n🛍️ <b>विशेष डील खोजें</b> — सत्यापित विक्रेता, वास्तविक लेनदेन\n\n🔒 <b>एस्क्रो अनिवार्य</b> — हर खरीदारी <b>SafeDeal</b> (safedeal.sh) से होती है\n⚠️ विक्रेता को सीधे या उनके बॉट से कभी भुगतान न करें — केवल SafeDeal एस्क्रो।\n\n👇 कमाने या खरीदने के लिए तैयार?`,
 mpBrowse: '🔥 डील ब्राउज़ करें',
 mpListProduct: '💰 बेचना शुरू करें',
 mpMyConversations: '💬 मेरी बातचीत',
 mpMyListings: '📦 मेरी लिस्टिंग',
 mpAiHelper: '🤖 AI सहायक',
 mpAiHelperPrompt: '🤖 <b>मार्केटप्लेस AI सहायक</b>\n\nखरीदारी, बिक्री, एस्क्रो या सुरक्षा के बारे में कुछ भी पूछें।\n\nनीचे अपना सवाल लिखें या ↩️ वापस दबाएं।',
 mpAiThinking: '🤖 सोच रहा हूँ...',
 mpAiScamWarning: `🚨 <b>AI सुरक्षा अलर्ट</b>\n\n⚠️ इस संदेश में संदिग्ध भुगतान अनुरोध हो सकता है। याद रखें:\n\n🔒 <b>हमेशा SafeDeal एस्क्रो से भुगतान करें</b> — केवल https://safedeal.sh से शुरू होने वाले लिंक\n❌ PayPal, CashApp, क्रिप्टो, वायर ट्रांसफर या किसी दूसरे "एस्क्रो" बॉट से कभी भुगतान न करें\n📢 असुरक्षित महसूस करें तो /report टाइप करें\n\nआपकी सुरक्षा हमारी प्राथमिकता है।`,
 mpUploadImages: '📸 उत्पाद की तस्वीरें अपलोड करें (1-5 फोटो)।\nएक-एक करके भेजें। पूरा होने पर ✅ अपलोड पूरा दबाएं।',
 mpDoneUpload: '✅ अपलोड पूरा',
 mpEnterTitle: '📝 उत्पाद का शीर्षक दर्ज करें (अधिकतम 100 अक्षर):',
 mpEnterDesc: '📄 विवरण दर्ज करें (अधिकतम 500 अक्षर):',
 mpEnterPrice: '💰 USD में कीमत सेट करें ($30 - $3,000):',
 mpSelectCategory: '🏷️ श्रेणी चुनें:',
 mpPreview: (title, desc, price, category, imageCount) =>
 `✅ <b>उत्पाद पूर्वावलोकन</b>\n\n📦 <b>${title}</b>\n📄 ${desc}\n💰 <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n📸 ${imageCount} चित्र\n\n🔒 SafeDeal (safedeal.sh) एस्क्रो द्वारा सुरक्षित`,
 mpPublish: '✅ प्रकाशित करें',
 mpCancel: '❌ रद्द करें',
 mpEditProduct: '✏️ संपादित करें',
 mpRemoveProduct: '❌ लिस्टिंग हटाएं',
 mpMarkSold: '✅ बेचा गया चिह्नित करें',
 mpProductPublished: `🎉 आपकी लिस्टिंग लाइव है!\n\nखरीदार अब इसे खोज सकते हैं।\n\n⚠️ <b>याद रखें:</b> सभी बिक्री SafeDeal एस्क्रो (safedeal.sh) से होनी चाहिए। डील <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करें।\n\n💡 <b>तेज़ बिक्री के टिप्स:</b>\n• पूछताछ का जल्दी जवाब दें\n• स्पष्ट फोटो और विस्तृत विवरण जोड़ें\n• प्रतिस्पर्धी मूल्य रखें`,
 mpProductRemoved: '✅ लिस्टिंग हटा दी गई।',
 mpProductSold: '✅ लिस्टिंग बेचा गया चिह्नित।',
 mpMaxListings: '❌ आपने 10 सक्रिय लिस्टिंग की सीमा पूरी कर ली है।',
 mpPriceError: '❌ कीमत $30 से $3,000 USD के बीच होनी चाहिए।',
 mpNoImage: '📸 कृपया कम से कम एक उत्पाद चित्र अपलोड करें।',
 mpImageAsPhoto: '📸 कृपया चित्र को फोटो के रूप में भेजें, फाइल नहीं।',
 mpOwnProduct: '❌ आप अपनी खुद की लिस्टिंग के बारे में पूछताछ नहीं कर सकते।',
 mpNoProducts: '📭 कोई उत्पाद नहीं मिला। बाद में जांचें!',
 mpNoListings: '📭 आपकी कोई लिस्टिंग नहीं है।',
 mpNoConversations: '📭 कोई सक्रिय बातचीत नहीं।',
 mpChatStartBuyer: (title, price) =>
 `💬 आप विक्रेता से <b>${title}</b> ($${price}) के बारे में बात कर रहे हैं\n\n⚠️ <b>एस्क्रो अनिवार्य</b> — खरीदने के लिए तैयार हों तो SafeDeal से सुरक्षित भुगतान के लिए /escrow टाइप करें\n❌ विक्रेता को सीधे या किसी बॉट से कभी भुगतान न करें।\n\n💡 खरीदने से पहले विवरण या सबूत मांगें।\nचैट समाप्त करने के लिए /done भेजें।`,
 mpChatStartSeller: (title) =>
 `💬 🔔 एक खरीदार <b>${title}</b> में रुचि रखता है!\n🔒 SafeDeal एस्क्रो द्वारा सुरक्षित — डील <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करें\n\n💡 टिप: जल्दी जवाब दें — तेज़ विक्रेता ज़्यादा बिक्री करते हैं।\nनीचे जवाब दें। चैट समाप्त करने के लिए /done भेजें।`,
 mpMessageSent: '✅ संदेश भेजा गया',
 mpSellerChatReady: (title) =>
 `💬 आप <b>${title}</b> के लिए चैट में हैं।\nनीचे अपना जवाब लिखें। बाहर निकलने के लिए /done, एस्क्रो शुरू करने के लिए /escrow, मूल्य सुझाने के लिए /price XX भेजें।`,
 mpBuyerSays: (msg) => `💬 <b>खरीदार:</b> ${msg}`,
 mpSellerSays: (msg) => `💬 <b>विक्रेता:</b> ${msg}`,
 mpChatEnded: '💬 बातचीत समाप्त। दोनों पक्षों को सूचित किया गया।',
 mpChatEndedNotify: (title) => `💬 <b>${title}</b> के बारे में बातचीत बंद कर दी गई।`,
 mpChatInactive: (title) => `💬 <b>${title}</b> की बातचीत निष्क्रियता के कारण बंद।`,
 mpSellerOffline: '⏳ विक्रेता ने 24 घंटे से जवाब नहीं दिया।',
 mpRateLimit: '⚠️ संदेश सीमा पूरी। कृपया प्रतीक्षा करें।',
 mpOnlyTextPhoto: '⚠️ मार्केटप्लेस चैट में केवल टेक्स्ट और फोटो भेजे जा सकते हैं।',
 mpPaymentWarning: `🚨 <b>चेतावनी: सीधा भुगतान पकड़ा गया!</b>\n\n❌ विक्रेता को सीधे, किसी वॉलेट पते पर या किसी बॉट से कभी भुगतान न करें।\n🔒 SafeDeal एस्क्रो (safedeal.sh) <b>अनिवार्य</b> है — आपके पैसे की सुरक्षा का यही एकमात्र तरीका है। शुरू करने के लिए /escrow टाइप करें।\n📢 असुरक्षित महसूस करें तो /report टाइप करें।`,
 mpEscrowBuyer: (title, price) =>
 `🔒 <b>SafeDeal एस्क्रो से सुरक्षित भुगतान करें</b>\n\n📦 उत्पाद: <b>${title}</b>\n💰 कीमत: <b>$${Number(price).toFixed(2)}</b>\n\n1. <b>SafeDeal खोलें</b> दबाएं → <b>I'm buying</b> (मैं खरीद रहा हूँ) चुनें\n2. डील का नाम: <code>${title}</code> (कॉपी करने के लिए टैप करें)\n3. कीमत: <code>${Number(price).toFixed(2)}</code> (कॉपी करने के लिए टैप करें)\n4. <b>Share a link</b> (लिंक शेयर करें) चुनें → ईमेल कोड से साइन इन करें\n5. <b>इनवाइट लिंक यहाँ पेस्ट करें</b> ताकि विक्रेता स्वीकार कर सके\n6. SafeDeal पर भुगतान करें — डिलीवरी की पुष्टि करने तक आपका पैसा सुरक्षित रखा जाता है\n\n💡 SafeDeal शुल्क: 5% (न्यूनतम $10), डिफ़ॉल्ट रूप से खरीदार देता है।\n⚠️ विक्रेता को कभी सीधे भुगतान न करें।`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>खरीदार SafeDeal एस्क्रो शुरू कर रहा है</b>\n\n📦 उत्पाद: <b>${title}</b>\n💰 कीमत: <b>$${Number(price).toFixed(2)}</b>\n\n1. इस चैट में खरीदार के <b>safedeal.sh इनवाइट लिंक</b> का इंतज़ार करें\n2. इसे खोलें, ईमेल कोड से साइन इन करें और <b>स्वीकार करें</b>\n3. SafeDeal पर <b>Funded</b> (फ़ंडेड) दिखने के <b>बाद ही</b> डिलीवर करें\n4. खरीदार के रिलीज़ करने पर आपको भुगतान मिलेगा — SafeDeal पर USDT/USDC पेआउट पता जोड़ें\n\n💡 खरीदार अटक गया? खुद बनाएं: <b>SafeDeal खोलें</b> → <b>I'm selling</b> (मैं बेच रहा हूँ) → नाम <code>${title}</code>, कीमत <code>${Number(price).toFixed(2)}</code> → <b>Share a link</b> → यहाँ पेस्ट करें।`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>$${Number(price).toFixed(2)} पर एस्क्रो शुरू नहीं हो सकता</b>\n\nSafeDeal <b>$30 से $3,000</b> तक की डील स्वीकार करता है। इस चैट में इस सीमा में कीमत तय करें — जैसे <code>/price 50</code> टाइप करें — फिर दोबारा /escrow टाइप करें।`,
 mpOpenSafeDeal: '🔒 SafeDeal खोलें',
 mpSafeDealLinkNote: `🔒 <b>यह SafeDeal एस्क्रो इनवाइट है</b> — इस डील का सुरक्षित तरीका।\nइसे खोलें, ईमेल कोड से साइन इन करें और स्वीकार करें। खरीदार SafeDeal पर भुगतान करता है; विक्रेता <b>Funded</b> (फ़ंडेड) दिखने के बाद ही डिलीवर करता है।`,
 mpPriceSuggest: (role, amount) => `💰 <b>${role}</b> सुझाव: <b>$${amount}</b>`,
 mpPriceUsage: 'उपयोग: /price 50 ($50 सुझाव देने के लिए)',
 mpPriceInvalid: '❌ अमान्य राशि। $30 से $3,000 के बीच होनी चाहिए।',
 mpReported: '✅ रिपोर्ट जमा। एडमिन इस बातचीत की समीक्षा करेंगे।',
 mpChatMode: '⚠️ आप मार्केटप्लेस चैट में हैं। बाहर निकलने के लिए /done भेजें।',
 mpExistingConv: '💬 इस उत्पाद पर आपकी पहले से सक्रिय बातचीत है। जारी...',
 mpAllCategories: '📋 सभी श्रेणियां',
 mpEditWhat: '✏️ आप क्या संपादित करना चाहते हैं?',
 mpEditTitle: '📝 शीर्षक संपादित करें',
 mpEditDesc: '📄 विवरण संपादित करें',
 mpEditPrice: '💰 कीमत संपादित करें',
 mpTitleUpdated: '✅ शीर्षक अपडेट किया गया।',
 mpDescUpdated: '✅ विवरण अपडेट किया गया।',
 mpPriceUpdated: '✅ कीमत अपडेट की गई।',
 mpListingRemoved: '📦 [लिस्टिंग हटाई गई]',
 mpSellerStats: (sales, since) => `⭐ विक्रेता: ${sales} बिक्री | ${since} से सदस्य`,
 mpProductCard: (title, price, category, sellerStats) =>
 `🏷️ <b>${title}</b>\n💰 <b>$${Number(price).toFixed(2)}</b> · ${category}\n${sellerStats}\n🔒 ⚠️ एस्क्रो अनिवार्य — केवल SafeDeal से भुगतान`,
 mpProductDetail: (title, desc, price, category, sellerStats, listedAgo) =>
 `📦 <b>${title}</b>\n\n📄 ${desc}\n\n💰 मूल्य: <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n${sellerStats}\n📅 सूचीबद्ध: ${listedAgo}\n\n🔒 <b>एस्क्रो अनिवार्य</b>\nकेवल SafeDeal एस्क्रो (safedeal.sh) से भुगतान करें। विक्रेता को सीधे या उनके बॉट से कभी भुगतान न करें।`,
 mpMyListingsHeader: (count, max) => `📦 <b>मेरी लिस्टिंग</b> (${count}/${max})`,
 mpConvHeader: '💬 <b>मेरी बातचीत</b>',
 mpConvItem: (title, role, lastMsg) => `💬 <b>${title}</b> (${role}) — ${lastMsg}`,
 mpDoneCmd: '/done',
 mpEscrowCmd: '/escrow',
 mpPriceCmd: '/price',
 mpReportCmd: '/report',
 mpEnteredChat: (title, price) => `💬 आप <b>${title}</b> ($${price}) की चैट में हैं\nबाहर निकलने के लिए /done भेजें, एस्क्रो शुरू करने के लिए /escrow, कीमत सुझाने के लिए /price XX भेजें।`,
 mpResumedChat: (title, price, role) => `💬 चैट फिर से शुरू: <b>${title}</b> ($${price}) — आप ${role} हैं\n⚠️ <b>एस्क्रो अनिवार्य</b> — केवल SafeDeal (safedeal.sh) से भुगतान। विक्रेता को सीधे या उनके बॉट से कभी भुगतान न करें।\n\nबाहर निकलने के लिए /done भेजें, एस्क्रो शुरू करने के लिए /escrow, कीमत सुझाने के लिए /price XX भेजें।`,
 mpBuyerPhotoCaption: '💬 खरीदार ने एक फोटो भेजी:',
 mpSellerPhotoCaption: '💬 विक्रेता ने एक फोटो भेजी:',
 mpChatClosedReset: (title) => `💬 <b>${title}</b> के बारे में बातचीत दूसरे पक्ष द्वारा बंद कर दी गई। आपको मार्केटप्लेस पर वापस भेज दिया गया है।`,
 mpSellerBusy: (title) => `🆕 <b>${title}</b> के लिए नई पूछताछ! जब तैयार हों तो जवाब देने के लिए नीचे बटन दबाएं।`,
 mpCatDigitalGoods: '💻 डिजिटल सामान',
 mpCatBnkLogs: '🏦 बैंक लॉग्स',
 mpCatBnkOpening: '🏧 बैंक खाता खुलवाना',
 mpCatTools: '🔧 उपकरण',
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
 cp_nested_1: (count, numberList) => `📞 <b>बैच: ${count} नंबर</b>\n${numberList}\n\nIVR टेम्पलेट श्रेणी चुनें:`,
 cp_nested_2: (icon, firstPh, desc, hint) => `\n${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_3: (icon, firstPh, desc, hint) => `${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_4: (currentPh, value, icon, nextPh, desc, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_5: (target, msg) => `❌ ${target} पर बैच कॉल विफल: ${msg}`,
 cp_nested_6: (refundAmt, walletLine) => `💰 <b>${refundAmt}</b> आपके वॉलेट में वापस कर दिए गए हैं।\n${walletLine}`,
 cp_nested_7: (cleanedMsg, balMsg) => `🔄 <b>नई शुरुआत!</b>\n\n${cleanedMsg}${balMsg}\n\nअब आप शुरू से नया फ़ोन नंबर खरीदना शुरू कर सकते हैं।`,
 cp_nested_8: (msg) => `❌ Win-back त्रुटि: ${msg}`,
 cp_nested_9: (target, city, detailsLine) => `✅ <b>अनुरोध सबमिट हुआ!</b>\n\n🎯 लक्ष्य: <b>${target}</b>\n🏙️ क्षेत्र: <b>${city}</b>${detailsLine}\n\nहमारी टीम आपके अनुरोध की समीक्षा करेगी और ये लीड्स उपलब्ध होते ही आपको सूचित करेगी। धन्यवाद!`,
 cp_nested_hint_default: (ph) => `[${ph}] के लिए मान दर्ज करें`,
 cp_nested_cleared: (count, refunded) => `✅ ${count} अस्वीकृत सत्यापन साफ़\n💰 $${refunded} वॉलेट में वापस\n`,
 // === Voice Service ===
 vs_callDisconnectedWallet: (rate, connFee) => `🚫 <b>कॉल डिस्कनेक्ट</b> — वॉलेट अपर्याप्त ($\${rate}/मिनट + $\${connFee} कनेक्शन)। 👛 वॉलेट से रिचार्ज करें।`,
 vs_callDisconnectedExhausted: '🚫 <b>कॉल डिस्कनेक्ट</b> — वॉलेट खाली।\n👛 वॉलेट से रिचार्ज करें।',
 vs_outboundCallFailed: (from, to, reason) => `🚫 <b>आउटबाउंड कॉल विफल</b>\n📞 \${from} → \${to}\nकारण: \${reason}`,
 vs_planMinutesExhausted: (phone, used, limit, overage) => `⚠️ <b>प्लान मिनट समाप्त</b>\n\n📞 \${phone}\nउपयोग: <b>\${used}/\${limit}</b> मिनट\n\${overage}`,
 vs_planSmsExhausted: (phone, used, limit) => `⚠️ <b>प्लान SMS समाप्त</b>\n\n📞 \${phone}\nउपयोग: <b>\${used}/\${limit}</b> इनबाउंड SMS`,
 vs_orphanedNumber: (to, from) => `⚠️ <b>अनाथ नंबर अलर्ट</b>\n\n📞 <code>\${to}</code> को <code>\${from}</code> से कॉल आई\n\n❌ DB में कोई मालिक नहीं — कॉल अस्वीकृत।`,
 vs_incomingCallBlocked: (to, from) => `🚫 <b>इनकमिंग कॉल ब्लॉक — वॉलेट खाली</b>\n\n📞 \${to}\n👤 कॉलर: \${from}`,
 vs_overageActive: (charged, rateInfo) => `💰 <b>ओवरेज सक्रिय</b> — प्लान मिनट समाप्त। \${charged} (\${rateInfo})`,
 vs_callEndedExhausted: (elapsed) => `🚫 <b>कॉल समाप्त</b> — मिनट + वॉलेट दोनों खाली।\n⏱️ ~\${elapsed} मिनट। वॉलेट रिचार्ज करें या प्लान अपग्रेड करें।`,
 vs_outboundCallBlocked: (from, to, reason) => `🚫 <b>आउटबाउंड कॉल ब्लॉक</b>\n📞 \${from} → \${to}\nकारण: \${reason}`,
 vs_sipCallBlocked: (rate, connFee) => `🚫 <b>SIP कॉल ब्लॉक</b> — वॉलेट अपर्याप्त ($\${rate}/मिनट + $\${connFee} कनेक्शन)। 👛 वॉलेट से रिचार्ज करें।`,
 vs_freeSipTestCall: (from, to) => `📞 <b>मुफ्त SIP टेस्ट कॉल</b>\nसे: \${from}\nको: \${to}`,
 vs_sipOutboundCall: (from, to, planLine) => `📞 <b>SIP आउटबाउंड कॉल</b>\nसे: \${from}\nको: \${to}\n\${planLine}`,
 vs_lowBalance: (bal, estMin) => `⚠️ <b>कम शेष राशि</b> — $\${bal} (~\${estMin} मिनट)। <b>$25</b> 👛 वॉलेट से रिचार्ज करें।`,
 vs_forwardingBlocked: (bal, rate) => `🚫 <b>फ़ॉरवर्डिंग ब्लॉक</b> — वॉलेट $\${bal} ($\${rate}/मिनट चाहिए)। 👛 वॉलेट से रिचार्ज करें।`,
 vs_ivrForwardBlocked: (phone, forwardTo, bal) => `🚫 <b>IVR फ़ॉरवर्ड ब्लॉक — वॉलेट खाली</b>\n\n📞 \${phone}\n📲 को: \${forwardTo}\n💰 शेष: $\${bal}`,
 vs_lowBalanceIvr: (bal, estMin) => `⚠️ <b>कम शेष राशि</b> — $\${bal} (~\${estMin} मिनट IVR)। 👛 वॉलेट से रिचार्ज करें।`,
 vs_callForwarded: (to, forwardTo, from, duration, planLine, time) => `📞 <b>कॉल ट्रांसफर</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 \${from}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_forwardFailed: (to, forwardTo, from, time) => `📞 <b>ट्रांसफर — कोई उत्तर नहीं</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 कॉलर: \${from}\n📲 \${forwardTo} ने उत्तर नहीं दिया\n🕐 \${time}`,
 vs_sipCallFailed: (from, to, time) => `❌ <b>SIP कॉल विफल — ट्रांसफर बिना उत्तर</b>\n\n📞 से: \${from}\n📲 को: \${to}\n🕐 \${time}`,
 vs_sipCallEnded: (from, to, duration, planLine, time) => `📞 <b>SIP कॉल समाप्त</b>\n\n📞 से: \${from}\n📲 को: \${to}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_freeTestCallEnded: (from, to, duration, time) => `📞 <b>मुफ्त टेस्ट कॉल समाप्त</b>\n\n📞 से: \${from}\n📲 को: \${to}\n⏱️ \${duration}\n🕐 \${time}`,
 vs_missedCall: (to, from, time) => `📞 <b>मिस्ड कॉल</b>\n\n📞 को: \${to}\n👤 से: \${from}\n🕐 \${time}`,
 vs_ivrCallRouted: (to, from, digit, forwardTo, time) => `📞 <b>IVR कॉल रूट</b>\n\n📞 को: \${to}\n👤 से: \${from}\nबटन: <b>\${digit}</b> → \${forwardTo} को ट्रांसफर\n🕐 \${time}`,
 vs_ivrCall: (to, from, digit, time) => `📞 <b>IVR कॉल</b>\n\n📞 को: \${to}\n👤 से: \${from}\nबटन: <b>\${digit}</b> → मैसेज प्ले\n🕐 \${time}`,
 vs_newVoicemail: (to, from, duration, time) => `🎙️ <b>नया वॉइसमेल</b>\n\n📞 को: \${to}\n👤 से: \${from}\n⏱️ अवधि: \${duration}\n🕐 \${time}`,
 vs_callRecording: (to, from, duration, time) => `🔴 <b>कॉल रिकॉर्डिंग</b>\n\n📞 को: \${to}\n👤 से: \${from}\n⏱️ अवधि: \${duration}\n🕐 \${time}`,
 vs_listen: 'सुनें',
 adm_error_prefix: '❌ Error: ',
 dom_confirm_prompt: 'पुष्टि करें?',
 adm_5: '⚠️ Usage: /close <chatId>',
 adm_6: (targetName) => `✅ Closed support session for ${targetName}`,
 adm_7: '⚠️ Usage: /deliver <orderId> <product details/credentials>',
 adm_8: (orderId) => `⚠️ Order <code>${orderId}</code> not found.`,
 adm_9: (orderId) => `⚠️ Order <code>${orderId}</code> was already delivered.`,
 cp_1: '⚠️ NGN जमा अस्थायी रूप से उपलब्ध नहीं है (विनिमय दर सेवा बंद है)। कृपया क्रिप्टो आज़माएँ।',
 cp_10: (TRIAL_CALLER_ID) => `📢 <b>क्विक IVR कॉल — मुफ़्त ट्रायल</b>\n\n🎁 आपको <b>1 मुफ़्त ट्रायल कॉल</b> मिलती है!\n📱 कॉलर ID: <b>${TRIAL_CALLER_ID}</b> (साझा)\n\nस्वचालित IVR संदेश के साथ एक नंबर पर कॉल करें।\n\nकॉल करने के लिए फ़ोन नंबर दर्ज करें (देश कोड सहित):\n<i>उदाहरण: +12025551234</i>`,
 cp_100: '🎚 <b>बोलने की गति चुनें</b>:',
 cp_101: '❌ अमान्य गति। <b>0.25</b> और <b>4.0</b> के बीच कोई संख्या दर्ज करें:\n<i>उदाहरण: 0.8 या 1.3</i>',
 cp_102: 'कृपया बटनों में से गति चुनें:',
 cp_103: (voiceName, speedLabelDisplay) => `🎤 आवाज़: <b>${voiceName}</b> | 🎚 गति: <b>${speedLabelDisplay}</b>\n\n⏳ ऑडियो प्रीव्यू बनाया जा रहा है...`,
 cp_104: () => `❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — कृपया बाद में पुनः प्रयास करें।`,
 cp_105: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_106: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_107: '🎚 <b>बोलने की गति चुनें</b>\n\nआवाज़ कितनी तेज़ बोले, चुनें:',
 cp_108: (holdMusic, v1) => `🎵 होल्ड म्यूज़िक: <b>${holdMusic}</b>\n${v1}`,
 cp_109: 'आप क्या करना चाहेंगे?',
 cp_11: (buyLabel) => `📞 <b>बल्क IVR कैंपेन</b>\n\n🔒 इस सुविधा के लिए <b>Pro</b> या उससे ऊपर का प्लान आवश्यक है।\n\nपहले एक Cloud IVR नंबर प्राप्त करें!\n\nशुरू करने के लिए <b>${buyLabel}</b> दबाएँ।`,
 cp_110: 'ऑडियो अभी तैयार नहीं है। कृपया इसके बजाय ✅ पुष्टि करें दबाएँ।',
 cp_111: '⏭ <b>प्रीव्यू छोड़ा गया — कॉल के लिए तैयार!</b>',
 cp_112: 'आगे बढ़ने के लिए <b>✅ पुष्टि करें</b>, <b>🎤 आवाज़ बदलें</b>, या <b>वापस</b> दबाएँ।',
 cp_113: 'आप क्या करना चाहेंगे?',
 cp_114: '🕐 <b>कॉल शेड्यूल करें</b>\n\nअभी से कितने मिनट बाद कॉल जानी चाहिए?\n\n<i>उदाहरण: 5, 15, 30, 60</i>',
 cp_115: 'कृपया 1 से 1440 मिनट के बीच दर्ज करें।',
 cp_116: (targetNumber, minutes, toLocaleTimeString) => `✅ <b>कॉल शेड्यूल हो गई!</b>\n\n📞 किसे: ${targetNumber}\n🕐 कब: ${minutes} मिनट में (${toLocaleTimeString} UTC)\n\nकॉल लगने पर आपको सूचित किया जाएगा।`,
 cp_117: (toFixed, v1) => `⚠️ <b>वॉलेट बैलेंस अपर्याप्त</b>\n\nक्विक IVR कॉल के लिए न्यूनतम <b>$${toFixed}</b> बैलेंस आवश्यक है।\n\nआपका बैलेंस: <b>$${v1}</b>\n\nकृपया वॉलेट टॉप-अप करें और फिर से प्रयास करें।`,
 cp_118: '🚫 <b>कॉल अवरुद्ध</b>\n\nआपके फ़ोन नंबर में सब-अकाउंट क्रेडेंशियल्स नहीं हैं। कृपया सहायता से संपर्क करें।',
 cp_119: (batchCount, length, target) => `📞 बैच ${batchCount}/${length}: ${target} पर कॉल किया जा रहा है...`,
 cp_12: '📞 <b>बल्क IVR कैंपेन</b>\n\nस्वचालित IVR संदेश के साथ कई नंबरों पर कॉल करें।\nलीड्स की CSV अपलोड करें और कैंपेन शुरू करें।\n\n☎️ = बल्क IVR सक्षम नंबर\n\n📱 कॉलर ID चुनें:',
 cp_120: '💾 क्या इसे अगली बार के लिए क्विक डायल प्रीसेट के रूप में सहेजना चाहेंगे?',
 cp_121: 'कॉल करने के लिए <b>/yes</b> या रद्द करने के लिए <b>/cancel</b> दबाएँ।',
 cp_122: (presetName) => `✅ प्रीसेट "<b>${presetName}</b>" सहेजा गया!\n\nअगली बार सेटअप छोड़ने के लिए इसे क्विक IVR मेनू से चुनें।`,
 cp_123: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nकोई ऑडियो फ़ाइल नहीं। शुरू करने के लिए एक अपलोड करें।',
 cp_124: (audioList) => `🎵 <b>ऑडियो लाइब्रेरी</b>\n\n${audioList}`,
 cp_125: 'एक विकल्प चुनें:',
 cp_126: (audioList) => `🎵 <b>ऑडियो लाइब्रेरी</b>\n\n${audioList}`,
 cp_127: '⏳ ऑडियो डाउनलोड और सहेजा जा रहा है...',
 cp_128: 'कृपया एक ऑडियो फ़ाइल (MP3, WAV, OGG) या वॉइस मैसेज भेजें।',
 cp_129: 'मुझे एक ऑडियो फ़ाइल या वॉइस मैसेज भेजें:',
 cp_13: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nआपके पास कोई सहेजी गई ऑडियो फ़ाइल नहीं है।\n\nIVR कैंपेन में उपयोग के लिए एक ऑडियो फ़ाइल (MP3, WAV, OGG) अपलोड करें।',
 cp_130: (name) => `✅ ऑडियो इस नाम से सहेजा गया: <b>${name}</b>\n\nअब आप इसे बल्क IVR कैंपेन में उपयोग कर सकते हैं!`,
 cp_131: 'कृपया सूची से एक कॉलर ID चुनें।',
 cp_132: (phoneNumber) => `📱 कॉलर ID: <b>${phoneNumber}</b>\n\n📋 <b>लीड्स फ़ाइल अपलोड करें</b>\n\nएक टेक्स्ट फ़ाइल (.txt या .csv) भेजें जिसमें प्रति पंक्ति एक फ़ोन नंबर हो।\nवैकल्पिक: प्रति पंक्ति <code>नंबर,नाम</code>।\n\nया नंबर सीधे पेस्ट करें (प्रति पंक्ति एक):`,
 cp_133: 'कॉलर ID चुनें:',
 cp_134: (message) => `❌ फ़ाइल पढ़ने में विफल: ${message}\n\nफिर से प्रयास करें या नंबर सीधे पेस्ट करें।`,
 cp_134b: (fname) => `❌ <b>${fname}</b> एक plain-text फ़ाइल नहीं है।\n\nकृपया <b>.txt</b> या <b>.csv</b> फ़ाइल भेजें (प्रति पंक्ति एक नंबर, या नंबर,नाम), या नंबर सीधे पेस्ट करें।`,
 cp_135: 'कृपया एक फ़ाइल भेजें या फ़ोन नंबर पेस्ट करें।',
 cp_136: (errMsg) => `❌ कोई मान्य फ़ोन नंबर नहीं मिला।${errMsg}\n\nकृपया प्रारूप जाँचें: प्रति पंक्ति एक नंबर, + देश कोड के साथ।`,
 cp_137: (maxLeads, length) => `❌ <b>बहुत अधिक लीड्स!</b>\n\nप्रति कैंपेन अधिकतम <b>${maxLeads}</b> नंबर।\nआपने <b>${length}</b> अपलोड किए।\n\nकृपया अपनी सूची कम करें और फिर से प्रयास करें।`,
 cp_138: (length, preview, more, errNote, estCost, toFixed) => `✅ <b>${length} लीड्स लोड हुईं!</b>\n\n${preview}${more}${errNote}\n\n💰 <b>अनुमानित लागत: $${estCost}</b> ($${toFixed}/मिनट प्रति नंबर, प्रत्येक न्यूनतम 1 मिनट — कॉल उठे या नहीं, शुल्क लगेगा)\n\n🎵 <b>IVR ऑडियो चुनें</b>\n\nअपनी ऑडियो लाइब्रेरी से चुनें, नई रिकॉर्डिंग अपलोड करें, या TTS से टेम्पलेट द्वारा बनाएँ:`,
 cp_139: '📋 लीड्स फ़ाइल भेजें या नंबर पेस्ट करें:',
 cp_14: (audioList) => `🎵 <b>ऑडियो लाइब्रेरी</b>\n\n${audioList}\n\nनया ऑडियो अपलोड करें या मौजूदा हटाएँ:`,
 cp_140: '🎵 एक ऑडियो फ़ाइल (MP3, WAV, OGG) या वॉइस मैसेज भेजें:',
 cp_141: '📝 <b>टेम्पलेट से ऑडियो बनाएँ</b>\n\nटेम्पलेट श्रेणी चुनें, या अपनी कस्टम स्क्रिप्ट लिखें:',
 cp_142: 'ऑडियो नहीं मिला। सूची से चुनें।',
 cp_143: (name) => `🎵 ऑडियो: <b>${name}</b>\n\n📋 <b>कैंपेन मोड चुनें</b>\n\n🔗 <b>ट्रांसफर + रिपोर्ट</b> — लीड के कुंजी दबाने पर कॉल आपके फ़ोन से जुड़ती है + हमेशा रिपोर्ट\n📊 <b>केवल रिपोर्ट</b> — सिर्फ़ ट्रैक करें किसने कुंजी दबाई, कोई ट्रांसफर नहीं + हमेशा रिपोर्ट\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं (किसने दबाया, किसने काटा, आदि)`,
 cp_144: 'एक ऑडियो फ़ाइल चुनें:',
 cp_145: 'IVR ऑडियो चुनें:',
 cp_146: '⏳ ऑडियो सहेजा जा रहा है...',
 cp_147: (message) => `❌ अपलोड विफल: ${message}`,
 cp_148: 'एक ऑडियो फ़ाइल या वॉइस मैसेज भेजें:',
 cp_149: (name) => `✅ इस नाम से सहेजा गया: <b>${name}</b>\n\n📋 <b>कैंपेन मोड चुनें</b>\n\n🔗 <b>ट्रांसफर + रिपोर्ट</b> — 1 दबाने पर कॉल आपके फ़ोन से जुड़ती है\n📊 <b>केवल रिपोर्ट</b> — सिर्फ़ प्रतिक्रियाएँ ट्रैक करें\n\nदोनों मोड हमेशा पूरे परिणाम रिपोर्ट करते हैं।`,
 cp_15: '📞 <b>नई IVR कॉल</b>\n\n📞 <b>चरण 1/2:</b> <b>अपने</b> किस नंबर को कॉल पर <i>कॉलर ID</i> के रूप में दिखाना है, उसे दबाएँ:',
 cp_150: 'IVR ऑडियो चुनें:',
 cp_151: '🔗 <b>ट्रांसफर मोड</b>\n\nजब लीड सक्रिय कुंजी दबाए तो कॉल किस नंबर पर ट्रांसफर करनी है, वह दर्ज करें:\n<i>(आपका SIP नंबर या कोई भी फ़ोन नंबर)</i>\n<i>उदाहरण: +41791234567</i>',
 cp_152: '📊 <b>केवल रिपोर्ट</b> — कोई ट्रांसफर नहीं, सिर्फ़ ट्रैकिंग।\n\n🔘 <b>सक्रिय कुंजियाँ चुनें</b>\n\nकौन सी कुंजियाँ सकारात्मक प्रतिक्रिया मानी जाएँ?\n\nएक प्रीसेट चुनें या कस्टम अंक दर्ज करें:',
 cp_153: 'एक मोड चुनें:',
 cp_154: 'कैंपेन मोड चुनें:',
 cp_155: '+ देश कोड के साथ एक मान्य फ़ोन नंबर दर्ज करें।\n<i>उदाहरण: +41791234567</i>',
 cp_156: (clean) => `🔗 ट्रांसफर करें: <b>${clean}</b>\n\n🔘 <b>सक्रिय कुंजियाँ चुनें</b>\n\nकौन सी कुंजियाँ ट्रांसफर शुरू करें?\n\nएक प्रीसेट चुनें या कस्टम अंक दर्ज करें:`,
 cp_157: 'ट्रांसफर नंबर दर्ज करें:',
 cp_158: 'कैंपेन मोड चुनें:',
 cp_159: 'वे अंक दर्ज करें जो सक्रिय कुंजियाँ मानी जाएँ:\n<i>उदाहरण: 1,3,5 या 1 2 3</i>',
 cp_16: 'हटाने के लिए कोई प्रीसेट नहीं।',
 cp_160: 'कृपया एक प्रीसेट चुनें या अंक दर्ज करें:',
 cp_161: (join) => `🔘 सक्रिय कुंजियाँ: <b>${join}</b>\n\n⚡ <b>एक साथ कॉल सेट करें</b>\n\nएक समय में कितनी कॉल? (1-20)\nडिफ़ॉल्ट: <b>10</b>`,
 cp_162: '🔘 <b>सक्रिय कुंजियाँ चुनें</b>',
 cp_163: 'कम से कम एक अंक (0-9) दर्ज करें:\n<i>उदाहरण: 1,3,5</i>',
 cp_164: (join) => `🔘 सक्रिय कुंजियाँ: <b>${join}</b>\n\n⚡ <b>एक साथ कॉल सेट करें</b>\n\nएक समय में कितनी कॉल? (1-20)\nडिफ़ॉल्ट: <b>10</b>`,
 cp_165: 'IVR ऑडियो चुनें:',
 cp_166: '✍️ <b>कस्टम स्क्रिप्ट</b>\n\nबोला जाने वाला संदेश टाइप करें।\nसक्रिय कुंजियाँ तय करने के लिए टेक्स्ट में "1 दबाएँ", "2 दबाएँ" आदि का उपयोग करें।\n\n<i>उदाहरण: नमस्ते, यह आपकी अपॉइंटमेंट का रिमाइंडर है। पुष्टि के लिए 1 दबाएँ या समय बदलने के लिए 2 दबाएँ।</i>',
 cp_167: 'कृपया एक श्रेणी चुनें:',
 cp_168: 'एक टेम्पलेट चुनें:',
 cp_169: 'टेम्पलेट श्रेणी चुनें:',
 cp_17: '🗑️ <b>प्रीसेट हटाएँ</b>\n\nहटाने के लिए प्रीसेट चुनें:',
 cp_170: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_171: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_172: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_174: (placeholders) => `<b>[${placeholders}]</b> के लिए मान दर्ज करें:`,
 cp_175: (join) => `🔘 सक्रिय कुंजियाँ: <b>${join}</b>\n\n🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:`,
 cp_176: 'टेम्पलेट श्रेणी चुनें:',
 cp_177: 'कृपया बटनों में से एक टेम्पलेट चुनें।',
 cp_178: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 सक्रिय कुंजियाँ: <b>${join}</b>`,
 cp_179: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_18: (presetName) => `✅ प्रीसेट "${presetName}" हटाया गया।`,
 cp_180: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_181: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_183: (placeholders) => `\n<b>[${placeholders}]</b> के लिए मान दर्ज करें:`,
 cp_184: '🎙 <b>आवाज़ चुनें</b>:',
 cp_185: 'टेम्पलेट श्रेणी चुनें:',
 cp_186: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — दोबारा जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_187: (currentPh) => `✍️ <b>[${currentPh}]</b> के लिए अपना कस्टम मान टाइप करें:`,
 cp_188: (currentPh) => `✍️ <b>[${currentPh}]</b> के लिए कॉलबैक नंबर टाइप करें:\n<i>उदाहरण: +12025551234</i>`,
 cp_189: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_19: 'प्रीसेट नहीं मिला।',
 cp_190: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_191: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_193: (currentPh, value, nextPh) => `✅ ${currentPh}: <b>${value}</b>\n\n<b>[${nextPh}]</b> के लिए मान दर्ज करें:`,
 cp_194: '✅ सभी मान भर दिए गए!\n\n🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_195: 'टेम्पलेट श्रेणी चुनें:',
 cp_196: 'कृपया एक वॉइस प्रोवाइडर चुनें:',
 cp_197: '🎙 <b>आवाज़ चुनें</b>:',
 cp_198: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_199: 'कृपया एक आवाज़ चुनें:',
 cp_2: (toLocaleString) => `⚠️ न्यूनतम जमा ₦${toLocaleString} (≈ $10 USD) है। कृपया अधिक राशि दर्ज करें।`,
 cp_20: (presetName, currentPlan) => `🔒 <b>प्रीसेट "${presetName}" OTP संग्रह का उपयोग करता है</b>, जिसके लिए <b>Pro</b> प्लान आवश्यक है।\n\nआपका वर्तमान प्लान: <b>${currentPlan}</b>\n\n🔄 रिन्यू / प्लान बदलें से अपग्रेड करें, या 🔗 ट्रांसफर मोड में नई कॉल बनाएँ।`,
 cp_200: (name) => `🎤 आवाज़: <b>${name}</b>\n\n🎚 <b>बोलने की गति चुनें</b>\n\nआवाज़ कितनी तेज़ बोले, चुनें:`,
 cp_201: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_202: '✍️ एक कस्टम गति गुणक दर्ज करें:\n<i>उदाहरण: 0.6 (बहुत धीमा), 0.9 (थोड़ा धीमा), 1.2 (तेज़), 1.5 (बहुत तेज़)\nसीमा: 0.25 से 4.0</i>',
 cp_203: '🎚 <b>बोलने की गति चुनें</b>:',
 cp_204: '❌ अमान्य गति। <b>0.25</b> और <b>4.0</b> के बीच कोई संख्या दर्ज करें:\n<i>उदाहरण: 0.8 या 1.3</i>',
 cp_205: 'कृपया बटनों में से गति चुनें:',
 cp_206: (voiceName, speedLabel) => `🎤 आवाज़: <b>${voiceName}</b> | 🎚 गति: <b>${speedLabel}</b>\n\n⏳ ऑडियो बनाया जा रहा है...`,
 cp_207: () => `❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — अपनी रिकॉर्डिंग अपलोड करें या बाद में पुनः प्रयास करें।`,
 cp_208: 'टेम्पलेट श्रेणी चुनें:',
 cp_209: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_21: (presetName, callerId, templateName, voiceName) => `💾 <b>प्रीसेट लोड हुआ: ${presetName}</b>\n📱 से: ${callerId}\n🏢 टेम्पलेट: ${templateName}\n🎙 आवाज़: ${voiceName}\n\nकॉल करने के लिए नंबर दर्ज करें (या कई नंबर कॉमा से अलग करके):\n<i>उदाहरण: +12025551234</i>\n<i>बैच: +12025551234, +12025555678</i>`,
 cp_210: '🎚 <b>बोलने की गति चुनें</b>\n\nआवाज़ कितनी तेज़ बोले, चुनें:',
 cp_211: '❌ कोई ऑडियो नहीं बना। फिर से प्रयास करें।',
 cp_212: (audioName, join) => `✅ ऑडियो सहेजा गया: <b>${audioName}</b>\n🔘 सक्रिय कुंजियाँ (टेम्पलेट से): <b>${join}</b>\n\n📋 <b>कैंपेन मोड चुनें</b>\n\n🔗 <b>ट्रांसफर + रिपोर्ट</b> — लीड के कुंजी दबाने पर कॉल आपके फ़ोन से जुड़ती है + हमेशा रिपोर्ट\n📊 <b>केवल रिपोर्ट</b> — सिर्फ़ ट्रैक करें किसने कुंजी दबाई, कोई ट्रांसफर नहीं + हमेशा रिपोर्ट`,
 cp_213: '<b>✅ यह ऑडियो उपयोग करें</b> या <b>🎤 आवाज़ बदलें</b> दबाएँ।',
 cp_214: '🔘 <b>सक्रिय कुंजियाँ चुनें</b>',
 cp_215: '1 और 20 के बीच कोई संख्या दर्ज करें:',
 cp_216: 'एक साथ कॉल की संख्या सेट करें (1-20):',
 cp_217: '❌ कैंपेन डेटा गायब है। कृपया फिर से शुरू करें।',
 cp_218: '⏳ कैंपेन बनाया जा रहा है...',
 cp_219: (errorvoice) => `❌ शुरू करने में विफल: ${errorvoice}`,
 cp_22: 'कोई योग्य कॉलर ID नहीं मिला।',
 cp_220: 'कैंपेन चल रहा है! प्रगति अपडेट आपको यहाँ दिखेंगे।',
 cp_221: (messagevoice) => `❌ कैंपेन लॉन्च विफल: ${messagevoice}`,
 cp_222: '🚀 कैंपेन लॉन्च करें या ↩️ वापस दबाएँ।',
 cp_223: 'विकल्पों के लिए दबाएँ:',
 cp_224: 'कैंपेन जारी है। नीचे दिया बटन उपयोग करें:',
 cp_225: '🛒 <b>प्लान चुनें:</b>',
 cp_226: '🌍 <b>सभी उपलब्ध देश</b>\n\nएक देश चुनें:',
 cp_227: (location, numberLines) => `📱 <b>उपलब्ध नंबर — ${location}</b>\n\n${numberLines}\n\n☎️ = बल्क IVR कैंपेन समर्थित\n\nचुनने के लिए नंबर पर टैप करें:`,
 cp_228: (message, numberLines) => `📱 <b>उपलब्ध नंबर — ${message}</b>\n\n${numberLines}\n\n☎️ = बल्क IVR कैंपेन समर्थित\n\nचुनने के लिए नंबर पर टैप करें:`,
 cp_229: (areaCode, numberLines) => `📱 <b>उपलब्ध नंबर — एरिया ${areaCode}</b>\n\n${numberLines}\n\n☎️ = बल्क IVR कैंपेन समर्थित\n\nचुनने के लिए नंबर पर टैप करें:`,
 cp_23: (phoneNumber, recentNumber) => `📱 से: <b>${phoneNumber}</b>\n📞 किसे: <b>${recentNumber}</b>\n\nIVR टेम्पलेट श्रेणी चुनें:`,
 cp_230: (location, numberLines) => `📱 <b>और नंबर — ${location}</b>\n\n${numberLines}\n\n☎️ = बल्क IVR कैंपेन समर्थित\n\nचुनने के लिए नंबर पर टैप करें:`,
 cp_231: 'यह प्लान अभी उपलब्ध नहीं है। कृपया नीचे दिए उपलब्ध प्लान में से चुनें।',
 cp_232: (planLabel) => `✅ प्लान: <b>${planLabel}</b>\n\n🌍 एक देश चुनें:`,
 cp_233: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 cp_234: (toLocaleString) => `Cloud IVR ₦${toLocaleString}`,
 cp_235: '⚠️ अपग्रेड सत्र समाप्त हो गया। कृपया फिर से शुरू करें।',
 cp_236: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 cp_237: (toLocaleString) => `प्लान अपग्रेड ₦${toLocaleString}`,
 cp_238: '⚠️ अपग्रेड सत्र समाप्त हो गया। कृपया फिर से शुरू करें।',
 cp_239: '⚠️ कोई अस्वीकृत सत्यापन नहीं मिला। कृपया नया नंबर खरीदना शुरू करें।',
 cp_24: '💡 नीचे कीबोर्ड में अपने किसी फ़ोन नंबर पर टैप करें।\n\n<i>जिस नंबर पर कॉल करनी है वह यहाँ न लिखें — वह अगला चरण है। पहले चुनें कि आपका कौन सा नंबर कॉलर ID के रूप में दिखेगा।</i>',
 cp_240: '⚠️ कोई अस्वीकृत सत्यापन नहीं मिला।',
 cp_243: '⬇️ कृपया नीचे से एक विकल्प चुनें:',
 cp_244: '⚠️ कृपया कम से कम यह दर्ज करें: <code>सड़क, शहर, देश</code>\n\nउदाहरण: <i>123 Main St, Sydney, Australia</i>',
 cp_245: (countryName, toFixed, showWallet) => `❌ ${countryName} के लिए नियामक सेटअप विफल।\n\n💰 <b>$${toFixed}</b> वापस किए गए।\n${showWallet}`,
 cp_246: (toFixed, showWallet) => `❌ नियामक सेटअप विफल।\n\n💰 <b>$${toFixed}</b> वापस किए गए।\n${showWallet}`,
 cp_247: (toFixed, showWallet) => `❌ नियामक सेटअप विफल।\n\n💰 <b>$${toFixed}</b> वापस किए गए।\n${showWallet}`,
 cp_248: (showWallet) => `❌ नियामक सेटअप विफल।\n\n💰 राशि आपके वॉलेट में वापस कर दी गई है।\n${showWallet}`,
 cp_249: '💡 <b>अपने नंबर का पूरा लाभ उठाएँ</b>\n\n📲 <b>कॉल फ़ॉरवर्डिंग सेट करें</b> — आपका असली फ़ोन बजे\n🤖 <b>IVR ग्रीटिंग जोड़ें</b> — पेशेवर ऑटो-अटेंडेंट\n💬 <b>SMS सक्षम करें</b> — टेक्स्ट संदेश भेजें और पाएँ\n\nकॉन्फ़िगर करने के लिए नीचे "नंबर प्रबंधित करें" दबाएँ।',
 cp_25: (phoneNumber) => `📞 <b>इस नंबर से कॉल:</b> ${phoneNumber}\n\n📝 वह फ़ोन नंबर दर्ज करें जिस पर <b>कॉल करनी</b> है:\n<i>उदाहरण: +12025551234</i>\n\n<i>📦 एक साथ कई नंबरों पर कॉल करने के लिए उन्हें कॉमा से अलग करें — जैसे +12025551234, +12025555678</i>`,
 cp_250: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 cp_251: (label, toLocaleString) => `${label} ₦${toLocaleString}`,
 cp_252: (numLines) => `📱 <b>चुनें कि किस प्लान में नंबर जोड़ना है:</b>\n\n${numLines}`,
 cp_253: (selectedNumber) => `✅ <b>खुशखबरी! आपका बंडल स्वीकृत हो गया!</b>\n\n🔄 हम अभी आपका नंबर <code>${selectedNumber}</code> सक्रिय कर रहे हैं...`,
 cp_254: '⚠️ स्थिति रीफ़्रेश नहीं हो सकी। कृपया फिर से प्रयास करें।',
 cp_255: '⚠️ यह ऑर्डर रद्द नहीं किया जा सकता — यह पहले से प्रोसेस हो रहा है या पूरा हो चुका है।',
 cp_256: (selectedNumber, toFixed, showWallet) => `✅ <b>ऑर्डर रद्द</b>\n\n<code>${selectedNumber}</code> के लिए आपका लंबित ऑर्डर रद्द कर दिया गया है।\n\n💰 <b>$${toFixed}</b> आपके वॉलेट में वापस कर दिए गए हैं।\n${showWallet}`,
 cp_257: '⚠️ ऑर्डर रद्द नहीं हो सका। कृपया सहायता से संपर्क करें।',
 cp_258: 'कृपया एक विकल्प चुनें:',
 cp_259: '🌍 <b>सभी उपलब्ध देश</b>\n\nएक देश चुनें:',
 cp_26: '📢 <b>क्विक IVR कॉल</b>\n\nस्वचालित IVR संदेश के साथ किसी नंबर पर कॉल करें।\n\n📞 <b>चरण 1/2:</b> <b>अपने</b> किस नंबर को कॉल पर <i>कॉलर ID</i> के रूप में दिखाना है, उसे दबाएँ:',
 cp_260: (subNumbersAvailable, numberLines, bulkIvrSupport, tapToSelect) => `${subNumbersAvailable}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_261: (subNumberSelected, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberSelected}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_262: (subNumberArea, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberArea}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_263: (numberLines) => `📱 <b>और नंबर</b>\n\n${numberLines}\n\n☎️ = बल्क IVR समर्थित\n\nचुनने के लिए टैप करें:`,
 cp_264: (newState, v1) => `🎵 होल्ड म्यूज़िक: <b>${newState}</b>\n${v1}`,
 cp_265: 'http:// या https:// से शुरू होने वाला एक मान्य URL दर्ज करें।',
 cp_266: '📝 वह ग्रीटिंग टाइप करें जो कॉल करने वाले सुनेंगे:',
 cp_267: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें।',
 cp_268: '✅ ऑडियो प्राप्त हुआ। ग्रीटिंग के रूप में सहेजें?',
 cp_269: '🎤 <b>कस्टम ग्रीटिंग</b>\n\nअपनी ग्रीटिंग बनाने का तरीका चुनें:',
 cp_27: 'कृपया + से शुरू होने वाला 10-15 अंकों का मान्य फ़ोन नंबर दर्ज करें।\n<i>उदाहरण: +12025551234</i>\n\n<i>📦 एक साथ कई नंबरों पर कॉल करने के लिए उन्हें कॉमा से अलग करें।</i>',
 cp_270: (message) => `📋 <b>${message}</b>\n\nएक ग्रीटिंग टेम्पलेट चुनें:`,
 cp_271: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ आप इस टेक्स्ट को संपादित कर सकते हैं — बस नीचे अपना संशोधित संस्करण टाइप करें।\nया इस ग्रीटिंग के साथ आगे बढ़ने के लिए <b>✅ जैसा है वैसा उपयोग करें</b> दबाएँ।`,
 cp_272: '📋 <b>ग्रीटिंग टेम्पलेट</b>\n\nएक श्रेणी चुनें:',
 cp_273: '🌐 अपनी वॉइसमेल ग्रीटिंग की भाषा चुनें:\n\n<i>टेम्पलेट आपकी चुनी हुई भाषा में स्वतः अनुवादित हो जाएगा।</i>',
 cp_274: '✅ टेक्स्ट अपडेट हुआ।\n\n🌐 अपनी वॉइसमेल ग्रीटिंग की भाषा चुनें:\n\n<i>ग्रीटिंग आपकी चुनी हुई भाषा में स्वतः अनुवादित हो जाएगी।</i>',
 cp_275: '🎤 <b>कस्टम ग्रीटिंग</b>\n\nचुनें:',
 cp_276: '🔄 ऑडियो प्रीव्यू बनाया जा रहा है...',
 cp_277: (voice) => `✅ प्रीव्यू (${voice})\n\nयह ग्रीटिंग सहेजें?`,
 cp_278: () => `❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — अपनी रिकॉर्डिंग अपलोड करें या बाद में पुनः प्रयास करें।`,
 cp_279: (translatedText) => `🌐 <b>अनुवादित ग्रीटिंग:</b>\n\n<i>${translatedText}</i>\n\n🎙️ एक आवाज़ चुनें:`,
 cp_280: '🎙️ एक आवाज़ चुनें:',
 cp_281: '🎙 एक वॉइस प्रोवाइडर चुनें:',
 cp_282: (message) => `🌐 ${message} में अनुवाद हो रहा है...`,
 cp_283: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_284: '🌐 अपनी ग्रीटिंग की भाषा चुनें:',
 cp_285: '📝 ग्रीटिंग का टेक्स्ट टाइप करें:',
 cp_286: (message) => `🌐 अपनी ग्रीटिंग की भाषा चुनें:\n\n<i>"${message}"</i>`,
 cp_287: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_288: '🌐 अपनी ग्रीटिंग की भाषा चुनें:',
 cp_289: '📝 ग्रीटिंग का टेक्स्ट टाइप करें:',
 cp_29: '🔍 नंबर खोजा जा रहा है...',
 cp_290: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें।',
 cp_291: '✅ ऑडियो प्राप्त हुआ। सहेजें?',
 cp_292: '✅ वॉइसमेल ग्रीटिंग सहेजी गई!',
 cp_293: '🎤 <b>IVR ग्रीटिंग सेट करें</b>\n\nअपनी ग्रीटिंग बनाने का तरीका चुनें:',
 cp_294: (usedKeys) => `➕ <b>मेनू विकल्प जोड़ें</b>\n\nउपयोग की गई कुंजियाँ: ${usedKeys}\n\nइस विकल्प के लिए कुंजी संख्या (0-9) दर्ज करें:`,
 cp_295: ('📝 वह ग्रीटिंग टाइप करें जो कॉल करने वाले सुनेंगे।\n\n<i>उदाहरण: "' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + ' को कॉल करने के लिए धन्यवाद। सेल्स के लिए 1 दबाएँ, सहायता के लिए 2 दबाएँ।"</i>'),
 cp_296: '🎙️ अपनी IVR ग्रीटिंग के लिए एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें।',
 cp_297: '📋 <b>ग्रीटिंग टेम्पलेट</b>\n\nवित्तीय संस्थानों के लिए पेशेवर टेम्पलेट — फ़्रॉड हॉटलाइन, ग्राहक सहायता, कार्य-समय के बाद, और भी बहुत कुछ। एक श्रेणी चुनें:',
 cp_298: 'एक विकल्प चुनें:',
 cp_299: '🎤 <b>IVR ग्रीटिंग सेट करें</b>\n\nअपनी ग्रीटिंग बनाने का तरीका चुनें:',
 cp_3: '🛡️🔥 Anti-Red होस्टिंग फ़िलहाल उपलब्ध नहीं है। हमसे संपर्क करने के लिए कीबोर्ड पर <b>💬 सहायता पाएँ</b> दबाएँ।',
 cp_30: (titleCase) => `📋 मिला: <b>${titleCase}</b>`,
 cp_300: (message) => `📋 <b>${message}</b>\n\nएक ग्रीटिंग टेम्पलेट चुनें:`,
 cp_301: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ आप इस टेक्स्ट को संपादित कर सकते हैं — बस नीचे अपना संशोधित संस्करण टाइप करें।\nया इस ग्रीटिंग के साथ आगे बढ़ने के लिए <b>✅ जैसा है वैसा उपयोग करें</b> दबाएँ।`,
 cp_302: '📋 <b>ग्रीटिंग टेम्पलेट</b>\n\nएक श्रेणी चुनें:',
 cp_303: '🌐 अपनी IVR ग्रीटिंग की भाषा चुनें:\n\n<i>टेम्पलेट आपकी चुनी हुई भाषा में स्वतः अनुवादित हो जाएगा।</i>',
 cp_304: '✅ टेक्स्ट अपडेट हुआ।\n\n🌐 अपनी IVR ग्रीटिंग की भाषा चुनें:\n\n<i>ग्रीटिंग आपकी चुनी हुई भाषा में स्वतः अनुवादित हो जाएगी।</i>',
 cp_305: '🎤 <b>IVR ग्रीटिंग सेट करें</b>\n\nअपनी ग्रीटिंग बनाने का तरीका चुनें:',
 cp_306: '🔄 ऑडियो प्रीव्यू बनाया जा रहा है...',
 cp_307: (voice) => `✅ प्रीव्यू बन गया (${voice})\n\n✅ यह ग्रीटिंग सहेजें?\n🔄 दूसरी आवाज़ आज़माएँ?\n📝 टेक्स्ट दोबारा टाइप करें?`,
 cp_308: () => `❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — अपनी रिकॉर्डिंग अपलोड करें या बाद में पुनः प्रयास करें।`,
 cp_309: (translatedText) => `🌐 <b>अनुवादित ग्रीटिंग:</b>\n\n<i>${translatedText}</i>\n\n🎙️ एक आवाज़ चुनें:`,
 cp_31: '⏳ प्रीसेट के लिए ऑडियो दोबारा बनाया जा रहा है (पिछला ऑडियो समाप्त हो गया)...',
 cp_310: '🎙️ अपनी ग्रीटिंग के लिए एक आवाज़ चुनें:',
 cp_311: '🎙 एक वॉइस प्रोवाइडर चुनें:',
 cp_312: (message) => `🌐 ${message} में अनुवाद हो रहा है...`,
 cp_313: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_314: '🌐 अपनी IVR ग्रीटिंग की भाषा चुनें:',
 cp_315: '📝 वह ग्रीटिंग टाइप करें जो कॉल करने वाले सुनेंगे:',
 cp_316: (message) => `🌐 अपनी IVR ग्रीटिंग की भाषा चुनें:\n\n<i>"${message}"</i>`,
 cp_317: '✅ ऑडियो प्राप्त हुआ। अपनी IVR ग्रीटिंग के रूप में सहेजें?',
 cp_318: '❌ ऑडियो प्रोसेस करने में विफल। फिर से प्रयास करें।',
 cp_319: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें।',
 cp_32: '⚠️ ऑडियो दोबारा बनाने में विफल। कृपया कॉल मैन्युअल रूप से सेट करें।',
 cp_320: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_321: '🌐 अपनी IVR ग्रीटिंग की भाषा चुनें:',
 cp_322: '📝 वह ग्रीटिंग टाइप करें जो कॉल करने वाले सुनेंगे:',
 cp_323: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें।',
 cp_324: '✅ IVR ग्रीटिंग सहेजी गई!',
 cp_325: '✅ ऑडियो प्राप्त हुआ। अपनी IVR ग्रीटिंग के रूप में सहेजें?',
 cp_326: '❌ ऑडियो प्रोसेस करने में विफल। फिर से प्रयास करें।',
 cp_327: 'एक विकल्प चुनें:',
 cp_328: (key) => `जब कोई कॉलर <b>${key}</b> दबाए तो क्या होना चाहिए?`,
 cp_329: (message) => `📋 <b>${message}</b>\n\nएक टेम्पलेट चुनें:`,
 cp_33: '⚠️ प्रीसेट ऑडियो समाप्त हो गया और दोबारा नहीं बनाया जा सकता। कृपया कॉल मैन्युअल रूप से सेट करें।',
 cp_330: '📋 एक श्रेणी चुनें:',
 cp_331: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ अपना संशोधित संस्करण टाइप करें, या <b>✅ जैसा है वैसा उपयोग करें</b> दबाएँ:`,
 cp_332: '🌐 भाषा चुनें:\n\n<i>संदेश स्वतः अनुवादित हो जाएगा।</i>',
 cp_333: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें:',
 cp_334: (message) => `🌐 भाषा चुनें:\n\n<i>"${message}"</i>`,
 cp_335: (text) => `📋 <b>संदेश</b>\n\n<code>${text}</code>\n\n✏️ अपना संशोधित संस्करण टाइप करें, या <b>✅ जैसा है वैसा उपयोग करें</b> दबाएँ:`,
 cp_336: '🔄 ऑडियो प्रीव्यू बनाया जा रहा है...',
 cp_337: (key, voice) => `✅ कुंजी <b>${key}</b> के लिए प्रीव्यू (${voice})\n\nयह विकल्प सहेजें?`,
 cp_338: () => `❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — अपनी रिकॉर्डिंग अपलोड करें या बाद में पुनः प्रयास करें।`,
 cp_339: (translatedText) => `🌐 <b>अनुवादित:</b>\n\n<i>${translatedText}</i>\n\n🎙️ एक आवाज़ चुनें:`,
 cp_34: '💾 <b>प्रीसेट लोड हुआ — कॉल के लिए तैयार!</b>\n\nकॉल करने के लिए <b>/yes</b> या रद्द करने के लिए <b>/cancel</b> दबाएँ।',
 cp_340: '🎙️ एक आवाज़ चुनें:',
 cp_341: '🎙 एक वॉइस प्रोवाइडर चुनें:',
 cp_342: (message) => `🌐 ${message} में अनुवाद हो रहा है...`,
 cp_343: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_344: '🌐 भाषा चुनें:',
 cp_345: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_346: '🌐 भाषा चुनें:',
 cp_347: '📝 संदेश टाइप करें:',
 cp_348: '🎙️ एक वॉइस मैसेज या ऑडियो फ़ाइल भेजें:',
 cp_35: (templateName, callerId, voiceName, join) => `💾 <b>प्रीसेट लोड हुआ: ${templateName}</b>\n📱 से: ${callerId}\n🎙 आवाज़: ${voiceName}\n🔘 सक्रिय कुंजियाँ: <b>${join}</b>`,
 cp_36: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_37: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_38: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_4: (SUPPORT_USERNAME) => `📞 Cloud IVR जल्द आ रहा है! अपडेट के लिए ${SUPPORT_USERNAME} से संपर्क करें।`,
 cp_40: (firstPh) => `\n<b>[${firstPh}]</b> के लिए मान दर्ज करें:`,
 cp_41: '📋 <b>कॉल मोड चुनें</b>\n\n🔗 <b>ट्रांसफर</b> — जब लक्ष्य कुंजी दबाए, उसे आपके नंबर से जोड़ दें\n🔑 <b>OTP संग्रह</b> — कुंजी दबाने के बाद लक्ष्य से स्वतः कोड माँगा जाता है — जो Telegram के ज़रिए आप तक पहुँचता है\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं।',
 cp_42: 'कॉल करने के लिए फ़ोन नंबर दर्ज करें (देश कोड सहित):\n<i>उदाहरण: +12025551234</i>',
 cp_43: '✍️ <b>कस्टम स्क्रिप्ट</b>\n\nअपना IVR संदेश टाइप करें। वेरिएबल के लिए <b>[ब्रैकेट]</b> उपयोग करें:\n\n<b>मानक:</b> [Name], [Company], [Bank], [Amount]\n<b>स्मार्ट (ऑटो-फ़िल):</b> [CardLast4], [CaseID], [ReferenceNum]\n<b>स्मार्ट (चुनें):</b> [Reason], [Location], [CallBack]\n\n<i>उदाहरण: नमस्ते [Name]। यह [Bank] सुरक्षा विभाग है। [CardLast4] पर समाप्त होने वाले कार्ड पर $[Amount] का शुल्क लगा है। केस [CaseID]। आपत्ति दर्ज करने के लिए 1 दबाएँ।</i>\n\nअपनी स्क्रिप्ट टाइप करें:',
 cp_44: 'एक टेम्पलेट चुनें:',
 cp_45: 'कृपया बटनों में से एक श्रेणी चुनें।',
 cp_46: '✍️ <b>कस्टम स्क्रिप्ट</b>\n\nअपना IVR संदेश टाइप करें। वेरिएबल के लिए <b>[ब्रैकेट]</b> उपयोग करें:\n\n<b>मानक:</b> [Name], [Company], [Bank], [Amount]\n<b>स्मार्ट (ऑटो-फ़िल):</b> [CardLast4], [CaseID], [ReferenceNum]\n<b>स्मार्ट (चुनें):</b> [Reason], [Location], [CallBack]\n\n<i>उदाहरण: नमस्ते [Name]। यह [Bank] सुरक्षा विभाग है। [CardLast4] पर समाप्त होने वाले कार्ड पर $[Amount] का शुल्क लगा है। केस [CaseID]। आपत्ति दर्ज करने के लिए 1 दबाएँ।</i>\n\nअपनी स्क्रिप्ट टाइप करें:',
 cp_47: ('📋 <b>प्लेसहोल्डर की पूरी सूची</b>\n\n<b>🔤 मानक (आप मान टाइप करते हैं):</b>\n• <code>[Name]</code> — प्राप्तकर्ता का नाम\n• <code>[Bank]</code> — बैंक या संस्था का नाम\n• <code>[Company]</code> — कंपनी या व्यापारी का नाम\n• <code>[Amount]</code> — डॉलर राशि\n\n<b>🤖 स्मार्ट ऑटो-फ़िल (आपके लिए जनरेट):</b>\n• <code>[CardLast4]</code> — रैंडम 4-अंकीय कार्ड नंबर\n• <code>[CaseID]</code> — रैंडम केस/रेफ़रेंस ID\n• <code>[ReferenceNum]</code> — रैंडम रेफ़रेंस नंबर\n\n<b>📋 स्मार्ट चुनाव (प्रीसेट में से चुनें):</b>\n• <code>[Reason]</code> — फ़्रॉड अलर्ट, खाता निलंबन, असामान्य गतिविधि, आदि\n• <code>[Location]</code> — शहर, राज्य प्रारूप (आप टाइप करते हैं)\n• <code>[CallBack]</code> — आपका ' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + ' फ़ोन नंबर\n\n<b>💡 सुझाव:</b>\n• मानक और स्मार्ट प्लेसहोल्डर को बेझिझक मिलाएँ\n• प्लेसहोल्डर केस-सेंसिटिव हैं: <code>[Bank]</code>, न कि <code>[bank]</code>\n• सक्रिय कुंजियाँ स्वतः पहचानने के लिए स्क्रिप्ट में "1 दबाएँ" शामिल करें\n\nअब अपनी स्क्रिप्ट टाइप करें:'),
 cp_48: (keyNote) => `${keyNote}\n\nइन कुंजियों को रखने के लिए <b>✅ जारी रखें</b> दबाएँ, या नई टाइप करें:\n<i>उदाहरण: 1,2,3 या 1,5,9</i>`,
 cp_49: 'अपनी कस्टम IVR स्क्रिप्ट टाइप करें:',
 cp_5: '⚠️ सत्र समाप्त हो गया। कृपया फिर से खरीदने का प्रयास करें।',
 cp_50: 'कृपया कम से कम एक अंक (0-9) दर्ज करें:\n<i>उदाहरण: 1,2,3</i>',
 cp_51: (join) => `🔘 सक्रिय कुंजियाँ अपडेट हुईं: <b>${join}</b>`,
 cp_52: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_53: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_54: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_56: (firstPh) => `<b>[${firstPh}]</b> के लिए मान दर्ज करें:`,
 cp_57: '📋 <b>कॉल मोड चुनें</b>\n\n🔗 <b>ट्रांसफर</b> — जब लक्ष्य कुंजी दबाए, उसे आपके नंबर से जोड़ दें\n🔑 <b>OTP संग्रह</b> — कुंजी दबाने के बाद लक्ष्य से स्वतः कोड माँगा जाता है — जो Telegram के ज़रिए आप तक पहुँचता है\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं।',
 cp_58: 'कृपया बटनों में से एक टेम्पलेट चुनें।',
 cp_59: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 सक्रिय कुंजियाँ: <b>${join}</b>`,
 cp_6: '⚠️ सत्र समाप्त हो गया। कृपया फिर से खरीदने का प्रयास करें।',
 cp_60: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_61: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_62: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_64: (firstPh) => `\n<b>[${firstPh}]</b> के लिए मान दर्ज करें:`,
 cp_65: '📋 <b>कॉल मोड चुनें</b>\n\n🔗 <b>ट्रांसफर</b> — जब लक्ष्य कुंजी दबाए, उसे आपके नंबर से जोड़ दें\n🔑 <b>OTP संग्रह</b> — कुंजी दबाने के बाद लक्ष्य से स्वतः कोड माँगा जाता है — जो Telegram के ज़रिए आप तक पहुँचता है\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं।',
 cp_66: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — दोबारा जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_67: (currentPh) => `✍️ <b>[${currentPh}]</b> के लिए अपना कस्टम मान टाइप करें:`,
 cp_68: (currentPh) => `✍️ <b>[${currentPh}]</b> के लिए कॉलबैक नंबर टाइप करें:\n<i>उदाहरण: +12025551234</i>`,
 cp_69: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nस्वतः जनरेट: <b>${generated}</b>\nस्वीकार करने, दोबारा बनाने के लिए दबाएँ, या अपना खुद का टाइप करें:`,
 cp_7: '⚠️ कोई लंबित सत्र नहीं मिला।',
 cp_70: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nसूची से चुनें या अपना खुद का टाइप करें:`,
 cp_71: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_73: (currentPh, value, nextPh) => `✅ ${currentPh}: <b>${value}</b>\n\n<b>[${nextPh}]</b> के लिए मान दर्ज करें:`,
 cp_74: '✅ सभी मान सेट हो गए!\n\n📋 <b>कॉल मोड चुनें</b>\n\n🔗 <b>ट्रांसफर</b> — जब लक्ष्य कुंजी दबाए, उसे आपके नंबर से जोड़ दें\n🔑 <b>OTP संग्रह</b> — कुंजी दबाने के बाद लक्ष्य से स्वतः कोड माँगा जाता है — जो Telegram के ज़रिए आप तक पहुँचता है\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं।',
 cp_75: '🔗 <b>ट्रांसफर मोड</b>\n\nकॉलर के कुंजी दबाने पर उसे किस नंबर पर ट्रांसफर करना है, वह दर्ज करें:\n<i>उदाहरण: +17174794833</i>',
 ivrTrialNudge: `🎁 <b>आपके पास 1 मुफ्त त्वरित IVR कॉल है!</b>

एक स्वचालित कॉल करें जो आपका रिकॉर्ड किया संदेश चलाती है और कीप्रेस या OTP कैप्चर करती है — मुफ्त, किसी प्लान की ज़रूरत नहीं।

👉 नीचे <b>📞 Cloud IVR + SIP</b> टैप करें, फिर <b>📢 त्वरित IVR कॉल</b> अभी आज़माएं।`,
 cp_76: '🔒 <b>OTP संग्रह</b> मुफ़्त ट्रायल में उपलब्ध नहीं है।\n\nOTP संग्रह उपयोग करने के लिए <b>Pro</b> या <b>Business</b> प्लान सब्सक्राइब करें।\n\nअपनी ट्रायल कॉल के लिए आप अब भी <b>🔗 ट्रांसफर</b> मोड उपयोग कर सकते हैं।',
 cp_77: '🔑 <b>OTP संग्रह मोड</b>\n\nकोड कितने अंकों का होना चाहिए?\n\n💡 कोड का प्रॉम्प्ट आपकी स्क्रिप्ट के बाद स्वतः जुड़ जाता है — इसे शामिल करने की ज़रूरत नहीं।\n\n<i>डिफ़ॉल्ट: 6 अंक</i>',
 cp_78: 'एक मोड चुनें:',
 cp_79: '📋 <b>कॉल मोड चुनें</b>\n\n🔗 <b>ट्रांसफर</b> — जब लक्ष्य कुंजी दबाए, उसे आपके नंबर से जोड़ दें\n🔑 <b>OTP संग्रह</b> — कुंजी दबाने के बाद लक्ष्य से स्वतः कोड माँगा जाता है — जो Telegram के ज़रिए आप तक पहुँचता है\n\nदोनों मोड पूरे परिणाम रिपोर्ट करते हैं।',
 cp_8: (buyPlansHeader, price, minutes, sms, starter, v5, v6, v7, pro, v9, v10, v11, business) => `${buyPlansHeader}\n\n💡 <b>Starter</b> — $${price}/माह\n📞 ${minutes} मिनट + 📩 ${sms} SMS · कॉल फ़ॉरवर्डिंग · ${starter} नंबर तक\n\n⭐ <b>Pro</b> — $${v5}/माह\n📞 ${v6} मिनट + 📩 ${v7} SMS · Starter का सब कुछ + वॉइसमेल · SIP · Webhooks · IVR · ${pro} नंबर तक\n\n👑 <b>Business</b> — $${v9}/माह\n📞 ${v10} मिनट + 📩 ${v11} SMS · Pro का सब कुछ + रिकॉर्डिंग · ऑटो-अटेंडेंट · OTP · प्राथमिकता सहायता · ${business} नंबर तक\n\n<i>💳 आउटबाउंड कॉल का शुल्क वॉलेट से लिया जाता है</i>`,
 cp_80: 'अंकों की मान्य संख्या (1-10) दर्ज करें:',
 cp_81: (length) => `✅ OTP लंबाई: <b>${length} अंक</b> (अधिकतम 3 प्रयास)\n\n✍️ <b>कॉलर संदेश कस्टमाइज़ करें</b>\n\nक्या आप कस्टमाइज़ करना चाहेंगे कि सत्यापन के बाद कॉलर क्या सुनें?\n\n<b>डिफ़ॉल्ट पुष्टि:</b> <i>"आपका कोड सफलतापूर्वक सत्यापित हो गया है। धन्यवाद। अलविदा।"</i>\n<b>डिफ़ॉल्ट अस्वीकृति:</b> <i>"अधिकतम सत्यापन प्रयास पूरे हो गए। अलविदा।"</i>`,
 cp_82: (length) => `✅ OTP लंबाई: <b>${length} अंक</b> (अधिकतम 3 प्रयास)\n\n🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:`,
 cp_83: '🔑 <b>OTP संग्रह मोड</b>\n\nकोड कितने अंकों का होना चाहिए?\n\n💡 कोड का प्रॉम्प्ट आपकी स्क्रिप्ट के बाद स्वतः जुड़ जाता है — इसे शामिल करने की ज़रूरत नहीं।\n\n<i>डिफ़ॉल्ट: 6 अंक</i>',
 cp_84: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_85: '✅ <b>पुष्टि संदेश</b>\n\nजब आप कॉलर का कोड <b>स्वीकार</b> करें तो वह क्या सुने, टाइप करें:\n\n<i>उदाहरण: "आपका कोड सत्यापित हो गया है। हमने लेन-देन रोक दिया है और आपका खाता सुरक्षित कर दिया है। एक विशेषज्ञ 24 घंटे के भीतर आपसे संपर्क करेगा। हमारे बैंक को चुनने के लिए धन्यवाद। अलविदा।"</i>',
 cp_86: 'एक विकल्प चुनें:',
 cp_87: '✍️ <b>कॉलर संदेश कस्टमाइज़ करें</b>\n\nक्या आप कस्टमाइज़ करना चाहेंगे कि सत्यापन के बाद कॉलर क्या सुनें?',
 cp_88: '❌ <b>अस्वीकृति संदेश</b>\n\nजब आप कॉलर का कोड <b>अस्वीकार</b> करें (अधिकतम प्रयास पूरे) तो वह क्या सुने, टाइप करें:\n\n<i>उदाहरण: "हम आपकी पहचान सत्यापित नहीं कर सके। आपकी सुरक्षा के लिए यह सत्र समाप्त कर दिया गया है। कृपया दोबारा कॉल करें या सहायता के लिए अपनी निकटतम शाखा जाएँ। अलविदा।"</i>',
 cp_89: '✅ <b>पुष्टि संदेश</b>\n\nजब आप कॉलर का कोड <b>स्वीकार</b> करें तो वह क्या सुने, टाइप करें:',
 cp_9: (buyLabel) => `📢 <b>क्विक IVR कॉल</b>\n\nआप अपनी मुफ़्त ट्रायल कॉल पहले ही उपयोग कर चुके हैं।\n\nअपने कॉलर ID के साथ असीमित IVR कॉल करने के लिए Cloud IVR सब्सक्राइब करें!\n\nशुरू करने के लिए <b>${buyLabel}</b> दबाएँ।`,
 cp_90: '✅ कस्टम संदेश सहेजे गए!\n\n🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_91: 'कृपया + से शुरू होने वाला मान्य फ़ोन नंबर दर्ज करें।\n<i>उदाहरण: +17174794833</i>',
 cp_92: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_93: 'कॉलर के कुंजी दबाने पर उसे किस नंबर पर ट्रांसफर करना है, वह दर्ज करें:\n<i>उदाहरण: +17174794833</i>',
 cp_94: 'कृपया एक वॉइस प्रोवाइडर चुनें:',
 cp_95: '🎤 <b>आवाज़ चुनें</b>\n\nIVR ऑडियो के लिए एक आवाज़ चुनें:',
 cp_96: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_97: (name) => `🎤 आवाज़: <b>${name}</b>\n\n🎚 <b>बोलने की गति चुनें</b>\n\nआवाज़ कितनी तेज़ बोले, चुनें:`,
 cp_98: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nअपना TTS इंजन चुनें:',
 cp_99: '✍️ एक कस्टम गति गुणक दर्ज करें:\n<i>उदाहरण: 0.6 (बहुत धीमा), 0.9 (थोड़ा धीमा), 1.2 (तेज़), 1.5 (बहुत तेज़)\nसीमा: 0.25 से 4.0</i>',
 dns_1: (domain) => `🔗 <b>${domain}</b> के लिए शॉर्टनर निष्क्रिय किया जा रहा है…`,
 dns_2: (domain) => `✅ <b>${domain}</b> के लिए शॉर्टनर निष्क्रिय हो गया।`,
 dns_3: '❌ शॉर्टनर निष्क्रिय नहीं हो सका। कृपया फिर से प्रयास करें या सहायता से संपर्क करें।',
 dns_3_busy: '⏳ हमारी शॉर्टनर सेवा अभी थोड़ी व्यस्त है। आपका लिंक फिलहाल चालू है — हम स्वचालित रूप से पुनः प्रयास करेंगे और निष्क्रिय होते ही आपको सूचित करेंगे। आप एक मिनट में फिर से कोशिश भी कर सकते हैं।',
 dns_4: '🔄 विरोधी रिकॉर्ड हटाकर नया जोड़ा जा रहा है...',
 dns_5: 'अमान्य प्रारूप। <b>_service._protocol</b> उपयोग करें (जैसे _sip._tcp, _http._tcp):',
 dns_6: '⚠️ कृपया मान्य USD राशि दर्ज करें (न्यूनतम $10)।',
 dom_1: 'आपके पास कोई पंजीकृत डोमेन नहीं है। कृपया नया डोमेन पंजीकृत करें या बाहरी डोमेन जोड़ें।',
 dom_2: '📋 <b>मेरे होस्टिंग प्लान</b>\n\nआपके पास कोई सक्रिय होस्टिंग प्लान नहीं है। शुरू करने के लिए एक प्लान खरीदें!',
 dom_3: (savings, domain, chargeUsd, shownPrice, v4) => `🎉 <b>आपने $${savings} बचाए!</b> डोमेन <b>${domain}</b> $${shownPrice} के बजाय <b>$${v4}</b> में पंजीकृत हुआ। आपके वॉलेट से केवल $${chargeUsd} काटे गए।`,
 dom_4: (domain, v1) => `💡 <b>${v1} के साथ आगे क्या?</b>\n\n🔗 <b>URL शॉर्टनर के लिए सक्रिय करें</b> — ${domain} को अपने ब्रांडेड शॉर्ट लिंक के रूप में उपयोग करें\n🛡️🔥 <b>Anti-Red होस्टिंग</b> — ${domain} पर एंटी-सस्पेंशन सुरक्षा के साथ वेबसाइट होस्ट करें\n🌐 <b>DNS प्रबंधित करें</b> — इसे अपने सर्वर की ओर पॉइंट करें\n\nजारी रखने के लिए नीचे दिए विकल्पों में से एक दबाएँ।`,
 dom_5: (domain, domainCost, APP_SUPPORT_LINK) => `आपका डोमेन <b>${domain}</b> सफलतापूर्वक पंजीकृत हो गया है, लेकिन होस्टिंग सेटअप विफल रहा। डोमेन लागत ($${domainCost}) ली गई है। होस्टिंग सेटअप पूरा करने के लिए कृपया सहायता से संपर्क करें: ${APP_SUPPORT_LINK}`,
 dom_6: (showWallet) => `❌ नियामक सेटअप विफल।\n\n💰 राशि आपके वॉलेट में वापस कर दी गई है।\n${showWallet}`,
 dom_7: (requested, delivered, requesteddelivered, toFixed, reasonText, v5) => `💰 <b>आंशिक रिफ़ंड</b>\n\n📊 ऑर्डर किए: ${requested} लीड्स\n✅ डिलीवर हुए: ${delivered} लीड्स\n❌ डिलीवर नहीं हुए: ${requesteddelivered} लीड्स\n\n💵 रिफ़ंड: <b>$${toFixed}</b> आपके वॉलेट में वापस\n📝 कारण: ${reasonText}\n\n💰 वॉलेट: $${v5} USD`,
 dom_8: '💡 <b>अपनी लीड्स का पूरा लाभ उठाएँ</b>\n\n📞 <b>Cloud IVR लें</b> — इन लीड्स को लोकल नंबर से कॉल करें\n🎯 <b>और लीड्स खरीदें</b> — किसी दूसरे क्षेत्र या कैरियर को लक्षित करें\n🔗 <b>अपने लिंक छोटे करें</b> — अपने आउटरीच कैंपेन ट्रैक करें\n\nनीचे एक विकल्प दबाएँ।',
 dom_9: (totalPrice, toFixed) => `❌ वॉलेट बैलेंस अपर्याप्त। $${totalPrice} चाहिए, $${toFixed} उपलब्ध।\nअपने वॉलेट में और जमा करें और फिर से प्रयास करें।`,

 // Post-purchase upsells (hosting & VPS)
 host_5d: (domain) => `💡 <b>${domain} के लिए आपकी होस्टिंग लाइव है!</b>\n\n🌐 <b>और डोमेन खरीदें</b> — अधिक साइटें होस्ट करें\n📞 <b>Cloud IVR + SIP</b> — विज़िटर्स को वर्चुअल नंबर से कॉल करने दें\n✂️🌐 <b>कस्टम डोमेन शॉर्टनर</b> — ब्रांडेड शॉर्ट लिंक से इनबाउंड ट्रैफ़िक ट्रैक करें\n\nनीचे एक विकल्प चुनें।`,
 vps_5d: (isRDP = false) => isRDP
  ? '💡 <b>आपका RDP तैयार है!</b>\n\n📧 <b>BulkSMS</b> — अपने नए RDP पर SMS गेटवे चलाएं\n📞 <b>Cloud IVR + SIP</b> — इनबाउंड कॉल्स के लिए वर्चुअल नंबर के साथ जोड़ें\n🌐 <b>बुलेटप्रूफ डोमेन</b> — अपने RDP पर डोमेन पॉइंट करें\n\nनीचे एक विकल्प चुनें।'
  : '💡 <b>आपका VPS तैयार है!</b>\n\n📧 <b>BulkSMS</b> — अपने नए VPS पर SMS गेटवे होस्ट करें\n📞 <b>Cloud IVR + SIP</b> — इनबाउंड कॉल्स के लिए वर्चुअल नंबर के साथ जोड़ें\n🌐 <b>बुलेटप्रूफ डोमेन</b> — अपने VPS पर डोमेन पॉइंट करें\n\nनीचे एक विकल्प चुनें।',
 ev_1: '🚧 ईमेल सत्यापन सेवा फ़िलहाल रखरखाव में है। कृपया बाद में प्रयास करें।',
 ev_10: (message) => `❌ Error: ${message}`,
 ev_11: '❌ Invalid IPv4 format. Send like: <code>1.2.3.4</code>',
 ev_12: (ipInput) => `✅ IP <code>${ipInput}</code> added to pool.`,
 ev_13: (ipInput) => `✅ IP <code>${ipInput}</code> removed from pool.`,
 ev_14: (message) => `❌ त्रुटि: ${message}`,
 ev_15: '❌ रद्द किया गया।',
 ev_16: '❌ रद्द किया गया।',
 ev_17: '❌ कृपया एक <b>.csv</b> या <b>.txt</b> फ़ाइल अपलोड करें।',
 ev_18: (message) => `❌ फ़ाइल पढ़ने में विफल: ${message}`,
 ev_19: '📎 कृपया ईमेल पतों वाली CSV/TXT फ़ाइल अपलोड करें।',
 ev_2: '📧 ईमेल सत्यापन मेनू पर लौट रहे हैं...',
 ev_20: '❌ फ़ाइल में कोई मान्य ईमेल पता नहीं मिला। कृपया प्रारूप जाँचें।',
 ev_21: (minEmails, length) => `❌ न्यूनतम <b>${minEmails}</b> ईमेल आवश्यक। केवल ${length} मिले।`,
 ev_22: (toLocaleString, v1) => `❌ अधिकतम <b>${toLocaleString}</b> ईमेल की अनुमति है। ${v1} मिले।`,
 ev_23: '❌ रद्द किया गया।',
 ev_24: '📋 कृपया ईमेल पते पेस्ट करें (प्रति पंक्ति एक या कॉमा से अलग)।',
 ev_25: '❌ कोई मान्य ईमेल पता नहीं मिला। कृपया प्रारूप जाँचें।',
 ev_26: (maxPasteEmails, length) => `❌ पेस्ट मोड अधिकतम <b>${maxPasteEmails}</b> ईमेल तक समर्थित है। ${length} मिले। बड़ी सूचियों के लिए फ़ाइल अपलोड उपयोग करें।`,
 ev_27: (minEmails, length) => `❌ न्यूनतम <b>${minEmails}</b> ईमेल आवश्यक। केवल ${length} मिले।`,
 ev_28: '❌ रद्द किया गया।',
 ev_29: '❌ सत्र समाप्त हो गया। कृपया फिर से शुरू करें।',
 ev_3: '⚠️ Could not reach worker',
 ev_30: '❌ इस सूची आकार के लिए मुफ़्त ट्रायल उपलब्ध नहीं। कृपया भुगतान विधि चुनें।',
 ev_31: '❌ मुफ़्त ट्रायल पहले ही उपयोग हो चुका है। कृपया भुगतान विधि चुनें।',
 ev_32: '❌ ट्रायल + भुगतान उपलब्ध नहीं। कृपया भुगतान विधि चुनें।',
 ev_33: '❌ मुफ़्त ट्रायल पहले ही उपयोग हो चुका है। कृपया भुगतान विधि चुनें।',
 ev_34: (toFixed, v1) => `⚠️ अतिरिक्त ईमेल के लिए USD बैलेंस अपर्याप्त।\n💰 चाहिए: <b>$${toFixed}</b>\n💳 उपलब्ध: <b>$${v1}</b>\n\nकृपया अपने वॉलेट में और जमा करें, या NGN में पूरी कीमत चुकाएँ।`,
 ev_35: (toFixed, v1) => `⚠️ USD बैलेंस अपर्याप्त।\n💰 चाहिए: <b>$${toFixed}</b>\n💳 उपलब्ध: <b>$${v1}</b>\n\nकृपया अपने वॉलेट में और जमा करें।`,
 ev_36: (toFixed, toLocaleString) => `✅ <b>भुगतान सफल!</b>\n\n💵 शुल्क: <b>$${toFixed}</b>\n📧 सत्यापन: <b>${toLocaleString} ईमेल</b>\n\n⏳ प्रोसेसिंग जल्द शुरू होगी। आपको प्रगति अपडेट मिलेंगे।`,
 ev_37: 'कृपया भुगतान विधि चुनें:',
 ev_4: (message) => `❌ Error: ${message}`,
 ev_5: '⚠️ No IPs found from cloud provider API or credentials missing.',
 ev_6: (message) => `❌ Cloud API error: ${message}`,
 ev_7: '➕ <b>Add IP</b>\\n\\nSend me the IPv4 address to add (e.g. <code>1.2.3.4</code>):',
 ev_8: (message) => `❌ Error: ${message}`,
 ev_9: '♻️ All IP health stats reset to healthy.',
 host_1: '❌ भुगतान प्रोसेसिंग त्रुटि। कृपया सहायता से संपर्क करें।',
 host_10: (startsWith) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 host_11: (startsWith) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 host_12: '❌ शॉर्ट लिंक बनाने में त्रुटि। कृपया फिर से प्रयास करें।',
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
 host_23: (message, plan) => `<b>${message}</b> पहले से ${plan} पर है। कोई दूसरा डोमेन चुनें।`,
 host_24: 'कृपया सूची से एक डोमेन चुनें।',
 host_25: '✅ आप पहले से सबसे ऊँचे प्लान (Golden Anti-Red) पर हैं। कोई अपग्रेड उपलब्ध नहीं।',
 host_26: (toFixed, price) => `⚠️ अपर्याप्त बैलेंस। आपके पास $${toFixed} है लेकिन $${price} चाहिए।`,
 host_27: 'कृपया अपग्रेड विकल्पों में से एक चुनें।',
 host_28: (toFixed, upgradePrice) => `⚠️ अपर्याप्त बैलेंस। आपके पास $${toFixed} है लेकिन $${upgradePrice} चाहिए।`,
 host_29: (error) => `❌ अपग्रेड विफल: ${error}\nराशि आपके वॉलेट में वापस कर दी गई है।`,
 host_3: (toFixed, length) => `💰 ${length} अस्वीकृत सत्यापन से <b>$${toFixed}</b> स्वतः वापस किए गए। आप कभी भी नई खरीद शुरू कर सकते हैं।`,
 host_30: '❌ अपग्रेड विफल। राशि आपके वॉलेट में वापस कर दी गई है। कृपया फिर से प्रयास करें या सहायता से संपर्क करें।',
 host_31: '🚧 VPS सेवा जल्द आ रही है! बने रहें।',
 host_32: '⚠️ रेफ़रल पेज लोड नहीं हो सका। बाद में प्रयास करें।',

// === Hosting Plan / Billing UX (added 2026-02) ===
// Headers
myHostingPlansHeader: '📋 <b>मेरे होस्टिंग प्लान</b>',
billingMenuHeader: '💳 <b>मेरा प्लान / बिलिंग</b>',
billingMenuIntro: 'अपने प्रत्येक होस्टिंग प्लान के लिए नवीनीकरण और ऑटो-रिन्यू प्रबंधित करें।',
billingMenuEmpty: '💳 <b>मेरा प्लान / बिलिंग</b>\n\nआपके पास अभी तक कोई सक्रिय होस्टिंग प्लान नहीं है।',
// Status indicators
statusActive: '✅ सक्रिय',
statusActiveOnline: '✅ सक्रिय (ऑनलाइन)',
statusSuspended: '🚫 निलंबित',
statusSuspendedFull: '🚫 निलंबित (ऑफ़लाइन — पूर्ण)',
statusExpired: '❌ समाप्त',
statusMaintenance: '🛠️ रखरखाव (ऑफ़लाइन — केवल सार्वजनिक)',
// Auto-Renew states
autoRenewOn: '✅ चालू',
autoRenewOff: '❌ बंद',
autoRenewWeeklyOff: '❌ बंद (साप्ताहिक प्लान कभी ऑटो-रिन्यू नहीं होते)',
autoRenewWeeklyShort: '❌ बंद (साप्ताहिक)',
// Field labels
planLabel: 'प्लान:',
statusLabel: 'स्थिति:',
domainTypeFieldLabel: 'डोमेन प्रकार:',
createdLabel: 'बनाया गया:',
expiresLabel: 'समाप्ति:',
autoRenewFieldLabel: 'ऑटो-रिन्यू:',
usernameLabel: 'उपयोगकर्ता नाम:',
priceLabel: 'मूल्य:',
durationLabel: 'अवधि:',
walletBalanceLabel: 'वॉलेट शेष:',
chargedLabel: 'चार्ज किया गया:',
newExpiryLabel: 'नई समाप्ति:',
remainingBalanceLabel: 'शेष बैलेंस:',
domainLabel: 'डोमेन:',
currentLabel: 'वर्तमान:',
// Plan view body
planViewCredentialsHint: 'अपना HostPanel उपयोगकर्ता नाम और PIN देखने के लिए "क्रेडेंशियल दिखाएं" पर टैप करें।',
planViewBillingNudge: '💡 नवीनीकरण या ऑटो-रिन्यू टॉगल करने के लिए, होस्टिंग मेनू से <b>💳 मेरा प्लान / बिलिंग</b> खोलें।',
planViewMultiHostUpsell: '💡 <b>अधिक साइटें होस्ट करना चाहते हैं?</b> मल्टी-साइट होस्टिंग, अधिक संग्रहण और उन्नत Anti-Red सुरक्षा के लिए मासिक प्लान में अपग्रेड करें।',
// Renew modal
renewModalHeader: planName => `<b>प्लान नवीनीकरण — ${planName}</b>`,
renewModalCurrentExpiry: (date, isExpired) => `<b>वर्तमान समाप्ति:</b> ${date}${isExpired ? ' (समाप्त)' : ''}`,
weeklyRenewTooEarly: (domain, expiry, opensAt) => `⏳ <b>रिन्यूअल अभी खुला नहीं है</b>\n\n<b>${domain}</b> साप्ताहिक प्लान पर है, जो 7 दिन या उससे कम बचने पर एक बार में एक सप्ताह के लिए रिन्यू होता है।\n\n<b>वर्तमान समाप्ति:</b> ${expiry}\n<b>रिन्यूअल खुलेगा:</b> ${opensAt}\n\nलंबी अवधि चाहिए? मासिक प्लान पर जाने के लिए <b>⬆️ प्लान अपग्रेड</b> दबाएँ।`,
renewAlreadyApplied: domain => `ℹ️ <b>${domain}</b> को अभी किसी अन्य अनुरोध से रिन्यू या बदला गया है, इसलिए यह भुगतान नहीं लिया गया। नवीनतम समाप्ति देखने के लिए प्लान फिर से खोलें।`,

renewModalDuration: days => `<b>अवधि:</b> ${days} दिन`,
renewModalConfirmHint: '✅ नीचे भुगतान की पुष्टि करें:',
renewModalInsufficient: '⚠️ अपर्याप्त शेष राशि। कृपया पहले जमा करें।',
renewModalPayButton: price => `💵 $${price} USD भुगतान करें`,
// Renew success / failure
renewSuccessTitle: '✅ <b>प्लान सफलतापूर्वक नवीनीकृत!</b>',
renewSuccessAntiRedNote: 'Anti-Red सुरक्षा रिफ्रेश हो गई है।',
renewFailureFallback: '❌ नवीनीकरण विफल। आपका वॉलेट रिफंड हो गया है। कृपया पुनः प्रयास करें या समर्थन से संपर्क करें।',
// Upgrade modal
upgradeModalHeader: '<b>⬆️ प्लान अपग्रेड</b>',
upgradeModalChooseHint: 'अपना नया प्लान चुनें:',
// Upgrade confirm screen
upgradeConfirmTitle: '<b>⬆️ अपग्रेड की पुष्टि करें</b>',
upgradeConfirmTo: name => `<b>अपग्रेड करें:</b> ${name}`,
upgradeConfirmListPrice: price => `<b>सूची मूल्य:</b> $${price}`,
upgradeConfirmCredit: amount => `<b>🎁 लॉयल्टी क्रेडिट:</b> -$${amount}`,
upgradeConfirmYouPay: amount => `<b>आप भुगतान करेंगे:</b> $${amount}`,
upgradeConfirmRenewsAt: (price, days) => `<b>🔁 रिन्यूअल मूल्य:</b> हर ${days} दिन में $${price} (ऑटो-रिन्यू चालू)`,
upgradeConfirmNextRenewal: (date, days) => `<b>📅 अगला रिन्यूअल:</b> ${new Date(date).toLocaleDateString('hi-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} — आज से नई ${days}-दिन की अवधि शुरू होती है`,
// Upgrade receipt + upgrade failures (wallet already refunded)
upgradeSuccessTitle: '✅ <b>प्लान सफलतापूर्वक अपग्रेड हुआ!</b>',
upgradeSuccessOldPlan: name => `<b>पुराना प्लान:</b> ${name}`,
upgradeSuccessNewPlan: name => `<b>नया प्लान:</b> ${name}`,
upgradeSuccessNewExpiry: date => `<b>नई समाप्ति तिथि:</b> ${new Date(date).toLocaleDateString('hi-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
upgradeSuccessFooter: planKey => `${planKey === 'goldenCpanel' ? 'असीमित डोमेन' : 'अधिकतम 5 ऐडऑन डोमेन'} अब उपलब्ध हैं। Anti-Red सुरक्षा रीफ़्रेश कर दी गई है।`,
upgradeFailTerminated: (refund, hostingBtn) => `❌ यह होस्टिंग अकाउंट <b>बंद (टर्मिनेट)</b> कर दिया गया है क्योंकि इसे ग्रेस अवधि में रिन्यू नहीं किया गया।\n\nआपके वॉलेट में <b>$${refund}</b> वापस कर दिए गए हैं।\n\n🛒 अपनी साइट फिर से ऑनलाइन लाने के लिए <b>${hostingBtn}</b> से एक <b>नया होस्टिंग प्लान</b> खरीदें।`,
upgradeFailReactivate: (refund, supportBtn) => `❌ <b>अपग्रेड पूरा नहीं हुआ</b>\n\nहम सर्वर पर आपका होस्टिंग अकाउंट फिर से सक्रिय नहीं कर सके। आपके वॉलेट में <b>$${refund}</b> वापस कर दिए गए हैं।\n\nहमारे एडमिन को सूचित कर दिया गया है — आगे की जानकारी के लिए ${supportBtn} पर टैप करें।`,
upgradeFailServer: (reason, refund, supportBtn) => `❌ <b>अपग्रेड पूरा नहीं हुआ</b>\n\nहमारे होस्टिंग सर्वर ने प्लान बदलाव स्वीकार नहीं किया (<i>${reason}</i>)। आपके वॉलेट में <b>$${refund}</b> वापस कर दिए गए हैं।\n\nहमारे एडमिन को सूचित कर दिया गया है — आगे की जानकारी के लिए ${supportBtn} पर टैप करें।`,
fmtDate: d => new Date(d).toLocaleDateString('hi-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
renewTerminated: hostingBtn => `❌ यह होस्टिंग अकाउंट <b>बंद (टर्मिनेट)</b> कर दिया गया है क्योंकि इसे ग्रेस अवधि में रिन्यू नहीं किया गया।\n\n🛒 अपनी साइट फिर से ऑनलाइन लाने के लिए <b>${hostingBtn}</b> से एक <b>नया होस्टिंग प्लान</b> खरीदें।`,
renewalPriceChangedNotice: (domain, plan, oldPrice, newPrice, nextDate, autoRenew) => `ℹ️ <b>रिन्यूअल मूल्य अपडेट हुआ</b>\n\nआपकी होस्टिंग <b>${domain}</b> <b>${plan}</b> पर है। आपके मौजूदा प्लान से मेल खाने के लिए इसका रिन्यूअल मूल्य अब <b>$${newPrice}</b> है (पहले $${oldPrice})।${nextDate ? `\n\n📅 अगला रिन्यूअल: <b>${new Date(nextDate).toLocaleDateString('hi-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b>${autoRenew ? ' — ऑटो-रिन्यू चालू है, कृपया वॉलेट में पर्याप्त बैलेंस रखें।' : ''}` : ''}\n\nअभी कुछ भी चार्ज नहीं किया गया है, और पिछले रिन्यूअल में कोई बदलाव नहीं है।`,
// Per-domain billing buttons
billingRenewBtn: domain => `🔄 अभी नवीनीकरण — ${domain}`,
billingToggleAutoRenewBtn: domain => `🔁 ऑटो-रिन्यू टॉगल — ${domain}`,
// Auto-Renew toggle status
autoRenewTurnedOn: domain => `✅ <b>${domain}</b> के लिए ऑटो-रिन्यू अब <b>चालू</b> है। समाप्ति पर आपका प्लान स्वतः नवीनीकृत हो जाएगा।`,
autoRenewTurnedOff: domain => `❌ <b>${domain}</b> के लिए ऑटो-रिन्यू अब <b>बंद</b> है। आपका प्लान समाप्त हो जाएगा और अनुग्रह अवधि के बाद निलंबित कर दिया जाएगा।`,
autoRenewNotForWeekly: '❌ साप्ताहिक प्लान पर ऑटो-रिन्यू उपलब्ध नहीं है।',
// Toast strings
siteAlreadyOffline: '⚠️ आपकी साइट पहले से ऑफ़लाइन है। पुनः सक्षम करने के लिए "साइट ऑनलाइन लाएँ" का उपयोग करें।',
siteAlreadyOnline: '✅ आपकी साइट पहले से ऑनलाइन है।',
addonNotOnPlan: '⚠️ वह डोमेन इस प्लान पर एडऑन नहीं है।',
promoMessagesEnabled: '🔔 प्रचार संदेश अब सक्षम हैं।',
promoMessagesDisabled: '✅ प्रचार संदेश अब अक्षम हैं।',
// Credentials reveal
credentialsHeader: domain => `🔑 <b>${domain} के लिए क्रेडेंशियल</b>`,
credentialsPinLabel: 'पिन:',
credentialsPanelUrlLabel: 'पैनल लॉगिन URL:',
credentialsFreshNotice: '⚠️ <i>यह PIN नया जनरेट किया गया है। आपका पुराना PIN अब काम नहीं करता।</i>',
// Hosting Scheduler notifications
schedExpiryWarningTitle: '⏰ <b>होस्टिंग समाप्ति सूचना</b>',
schedExpiryWarningBody: (plan, domain) => `आपका प्लान <b>${plan}</b> (<b>${domain}</b>) 24 घंटे से कम समय में समाप्त होता है।`,
schedRenewTextOn: '✅ ऑटो-रिन्यू <b>चालू</b> है। समाप्ति पर आपका प्लान स्वतः नवीनीकृत हो जाएगा।',
schedRenewTextOff: hours => `ऑटो-रिन्यू <b>बंद</b> है। समाप्ति पर आपकी होस्टिंग <b>तुरंत निलंबित</b> कर दी जाएगी और मैन्युअल रूप से नवीनीकरण न होने पर ${hours} घंटे बाद हटा दी जाएगी।`,
schedRenewTextWeekly: 'साप्ताहिक प्लान ऑटो-रिन्यू नहीं होते। कृपया समाप्ति से पहले मैन्युअल रूप से नवीनीकरण करें।',
schedRenewTextWalletHint: 'वॉलेट शेष: /wallet के माध्यम से जांचें',
schedRenewTextToggleHint: domain => `ऑटो-रिन्यू टॉगल करने के लिए: <b>💳 मेरा प्लान / बिलिंग</b> खोलें`,
schedAutoRenewedTitle: '✅ <b>प्लान ऑटो-नवीनीकृत!</b>',
schedAutoRenewedBody: (plan, domain, price, newExpiry, remBalance) =>
  `<b>${plan}</b> (<b>${domain}</b>) नवीनीकृत हो गया है।\n<b>चार्ज:</b> $${price}\n<b>नई समाप्ति:</b> ${newExpiry}\n<b>शेष राशि:</b> $${remBalance}`,
schedAutoRenewFailedTitle: '⚠️ <b>ऑटो-रिन्यू विफल — अपर्याप्त धन</b>',
schedAutoRenewFailedBody: (plan, domain, price, balance, hours) =>
  `<b>${plan}</b> (<b>${domain}</b>) समाप्त हो गया है।\n<b>नवीनीकरण मूल्य:</b> $${price}\n<b>आपकी शेष राशि:</b> $${balance}\n\nनवीनीकरण के लिए कृपया धनराशि जमा करें।\nआपकी होस्टिंग <b>निलंबित</b> कर दी गई है। पुनः सक्रिय करने के लिए धनराशि जमा करें।\nयदि नवीनीकृत नहीं किया गया तो आपका खाता ${hours} घंटे में <b>हटा</b> दिया जाएगा।`,
schedWeeklyExpiredTitle: '⏰ <b>साप्ताहिक प्लान समाप्त</b>',
schedWeeklyExpiredBody: (plan, domain, hours) =>
  `आपका प्लान <b>${plan}</b> (<b>${domain}</b>) समाप्त हो गया है।\n\n⚠️ साप्ताहिक प्लान <b>ऑटो-रिन्यू नहीं</b> होते।\nआपकी होस्टिंग <b>निलंबित</b> कर दी गई है — वेबसाइट अब ऑफ़लाइन है।\nपुनः सक्रिय करने के लिए कृपया <b>💳 मेरा प्लान / बिलिंग</b> से मैन्युअल रूप से नवीनीकरण करें।\n\nयदि नवीनीकृत नहीं किया गया तो आपका खाता ${hours} घंटे में <b>स्थायी रूप से हटा</b> दिया जाएगा।`,
schedDeletedTitle: '🗑️ <b>होस्टिंग हटा दी गई</b>',
schedDeletedBody: (domain, plan) =>
  `<b>${domain}</b> cPanel खाता स्थायी रूप से हटा दिया गया है।\nप्लान: ${plan}\n\nसभी फ़ाइलें, डेटाबेस और ईमेल हटा दिए गए हैं।\nनए सिरे से शुरू करने के लिए, नया होस्टिंग प्लान खरीदें।`,
schedDeletedBodyHours: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> cPanel खाता स्थायी रूप से हटा दिया गया है।\nप्लान: ${plan} — ${hoursExpired} घंटे पहले समाप्त (${gracePeriod} घंटे की अनुग्रह अवधि पार हो गई)।\n\nसभी फ़ाइलें, डेटाबेस और ईमेल हटा दिए गए हैं।\nनए सिरे से शुरू करने के लिए, नया होस्टिंग प्लान खरीदें।`,
schedSuspendedTitle: '🚫 <b>होस्टिंग निलंबित</b>',
schedSuspendedBody: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> को निलंबित कर दिया गया है — आपका प्लान <b>${plan}</b> ${hoursExpired} घंटे पहले समाप्त हो गया।\n\n⚠️ आपकी साइट अब <b>ऑफ़लाइन</b> है।\nपुनः सक्रिय करने के लिए <b>💳 मेरा प्लान / बिलिंग</b> से नवीनीकरण करें।\nयदि नवीनीकृत नहीं हुआ तो खाता समाप्ति के ${gracePeriod} घंटे बाद <b>स्थायी रूप से हटा</b> दिया जाएगा।`,
// === Phone-monitor / Phone-scheduler ===
phoneCallerIdFlaggedTitle: '⚠️ <b>कॉलर ID फ़्लैग किया गया</b>',
phoneCallerIdFlaggedBody: phoneNumber =>
  `आपका कॉलर ID <b>${phoneNumber}</b> कैरियर द्वारा फ़्लैग और निलंबित कर दिया गया है।\n\nइस नंबर का उपयोग आउटबाउंड कॉल या कैम्पेन के लिए नहीं किया जा सकता।\n\n👉 कृपया कॉल करना जारी रखने के लिए <b>Cloud IVR + SIP</b> मेनू से नया नंबर खरीदें।\n\nयदि कोई प्रश्न हो, तो समर्थन से संपर्क करें।`,
phoneAutoRenewFailedTitle: '❌ <b>ऑटो-नवीनीकरण विफल — नंबर हटा दिया गया</b>',
phoneAutoRenewFailedBody: (phoneNumber, planName, planPrice, buyLabel) =>
  `📞 ${phoneNumber}\n📦 प्लान: ${planName} ($${planPrice}/माह)\n\n⚠️ अपर्याप्त वॉलेट शेष। आगे की बिलिंग रोकने के लिए आपका नंबर <b>स्थायी रूप से हटा</b> दिया गया है।\n\nयह क्रिया अपरिवर्तनीय है। नया नंबर पाने के लिए, 📞☁️ Cloud Phone → ${buyLabel} पर जाएँ।`,
phoneSuspendedTitle: '⚠️ <b>नंबर समाप्त — स्थायी रूप से हटा दिया गया</b>',
phoneSuspendedBody: (phoneNumber, buyLabel) =>
  `📞 ${phoneNumber} समाप्त हो गया है और <b>स्थायी रूप से हटा</b> दिया गया है।\n\nऑटो-रिन्यू बंद था। भविष्य में नंबर खोने से बचने के लिए, अपने अगले नंबर पर ऑटो-रिन्यू सक्षम करें।\n\nनया नंबर प्राप्त करें: 📞☁️ Cloud Phone → ${buyLabel}।`,
phoneUsageAlertTitle: '⚠️ <b>उपयोग चेतावनी</b>',
phoneUsageAlertBody: (phoneNumber, used, limit, type, percent, rate, unit) =>
  `📞 ${phoneNumber}\n\nइस माह आपने <b>${used}/${limit}</b> इनबाउंड ${type} (${percent}%) उपयोग किए हैं।\nसमाप्त होने पर, आपके वॉलेट से <b>$${rate}/${unit}</b> की दर से ओवरेज बिलिंग शुरू हो जाएगी। वॉलेट खाली होने पर सेवा रुक जाती है।`,
phoneUsageLimitTitle: type => `💰 <b>इनबाउंड ${type} — ओवरेज सक्रिय</b>`,
phoneUsageLimitBody: (phoneNumber, type, limit, rate, unit) =>
  `📞 ${phoneNumber}\n\nइस माह आपने अपने प्लान के सभी <b>${limit}</b> इनबाउंड ${type} उपयोग कर लिए हैं।\nओवरेज बिलिंग अब सक्रिय है — प्रति उपयोग आपके वॉलेट से <b>$${rate}/${unit}</b> चार्ज।\nवॉलेट शेष समाप्त होने पर सेवा रुक जाती है। अपना प्लान टॉप अप या अपग्रेड करें।`,
// === Generic error toast (error-handler.js) ===
genericErrorTitle: '❌ <b>त्रुटि</b>',
genericErrorBody: txnId =>
  `कुछ गलत हो गया${txnId ? ` (लेन-देन: ${txnId})` : ''}।\n\nहमारी टीम को सूचित किया गया है और जांच की जाएगी।`,
genericErrorRefundedNote: '✅ आपका भुगतान वापस कर दिया गया है।',
genericErrorContactSupport: 'यदि यह बना रहता है, तो कृपया समर्थन से संपर्क करें।',
// === Bulk-call campaign ===
bulkCallProgressLine: (icon, displayNumber, displayName, statusText, durText, bar, completed, total, pct, kp, missed, failed) =>
  `${icon} <b>${displayNumber}</b>${displayName} — ${statusText}${durText}\n${bar} ${completed}/${total} (${pct}%) | 🔘${kp} 📵${missed} ❌${failed}`,
bulkCallReportTitle: '📊 <b>कैम्पेन पूर्ण!</b>',
bulkCallReportCallerId: 'कॉलर ID:',
bulkCallReportAudio: 'ऑडियो:',
bulkCallReportProvider: 'प्रदाता:',
bulkCallReportDuration: 'अवधि:',
bulkCallReportTotal: 'कुल कॉल:',
bulkCallReportAnswered: 'उत्तरित:',
bulkCallReportKeyPressed: 'कुंजी दबाई:',
bulkCallReportTransferred: 'स्थानांतरित:',
bulkCallReportNoAnswer: 'कोई उत्तर नहीं:',
bulkCallReportHungUp: 'काट दिया:',
bulkCallReportVoicemail: 'वॉइसमेल:',
bulkCallReportBusy: 'व्यस्त:',
bulkCallReportFailed: 'विफल:',
bulkCallReportTitleCancelled: '📊 <b>कैम्पेन रद्द</b>',
bulkCallReportNotDialed: 'डायल नहीं हुए (कैम्पेन रद्द):',
// === SMS App service ===
smsAppTrialCompleteTitle: '📱 <b>BulkSMS मुफ्त परीक्षण पूर्ण!</b>',
smsAppTrialCompleteBody: limit =>
  `आपने अपने ट्रायल के सभी ${limit} मुफ्त SMS उपयोग कर लिए हैं। प्लेटफ़ॉर्म का परीक्षण करने के लिए धन्यवाद!`,
smsAppTrialExpiredTitle: '📱 <b>BulkSMS परीक्षण समाप्त</b>',
smsAppTrialExpiredBody: 'SMS कैम्पेन भेजना जारी रखने के लिए सब्सक्राइब करें।\n👉 अपग्रेड करने के लिए <b>👛 वॉलेट → 📋 सब्सक्रिप्शन देखें</b> पर टैप करें!',
// === cPanel-routes Anti-Red warnings ===
antiRedWarningTitle: '⚠️ <b>Anti-Red सुरक्षा चेतावनी</b>',
antiRedWarningBodyShort: domain =>
  `<b>${domain}</b> के लिए सुरक्षा तैनात की गई लेकिन अभी तक सत्यापित नहीं। सुनिश्चित करें कि नेमसर्वर Cloudflare की ओर इंगित करते हैं।`,
antiRedFailedTitle: '🚨 <b>Anti-Red सुरक्षा विफल</b>',
antiRedFailedBodyShort: (domain, retries) =>
  `${retries} प्रयासों के बाद <b>${domain}</b> के लिए सुरक्षा तैनात नहीं की जा सकी। सुनिश्चित करें कि नेमसर्वर Cloudflare की ओर इंगित करते हैं।`,

host_4: (safeHtml) => `${safeHtml}`,
 host_5: (CHAT_BOT_NAME) => `<b>${CHAT_BOT_NAME} सहायता</b>\n\n<b>त्वरित कमांड:</b>\n• <code>/shorten URL</code> — तुरंत शॉर्ट लिंक\n• <code>/shorten URL alias</code> — कस्टम उपनाम\n• कोई भी URL पेस्ट करें — स्वतः पहचान और छोटा करना\n\n<b>सुविधाएँ:</b>\n• URL शॉर्टनर\n• डोमेन नाम\n• फ़ोन लीड्स\n• वॉलेट और भुगतान\n• वेब होस्टिंग\n\nशुरू करने के लिए नीचे दिए मेनू का उपयोग करें!`,
 host_6: '✂️ <b>त्वरित शॉर्टन कमांड</b>\n\n<b>उपयोग:</b>\n<code>/shorten https://example.com</code> — रैंडम शॉर्ट लिंक\n<code>/shorten https://example.com myalias</code> — कस्टम उपनाम\n\nया बस कोई URL पेस्ट करें और मैं उसे छोटा करने का प्रस्ताव दूँगा!',
 host_7: '❌ अमान्य URL। कृपया http:// या https:// से शुरू होने वाला मान्य URL दें',
 host_8: (customAlias, preferredDomain) => `❌ उपनाम <code>${customAlias}</code> ${preferredDomain} पर पहले से लिया जा चुका है। कोई दूसरा उपनाम आज़माएँ।`,
 host_9: (customAlias) => `❌ उपनाम <code>${customAlias}</code> पहले से लिया जा चुका है। कोई दूसरा उपनाम आज़माएँ।`,
 ld_1: (toFixed) => `💵 $${toFixed} — `,
 ld_2: '🎯 अपना लक्षित संस्थान चुनें।\nफ़ोन मालिक के नाम के साथ असली, सत्यापित लीड्स — उच्च-मूल्य महानगरीय क्षेत्रों से कैरियर के अनुसार मिलान:',
 ld_3: '📝 <b>कस्टम लीड्स का अनुरोध करें</b>\n\nहमें बताएँ कि आप किस संस्थान या कंपनी के लिए लक्षित लीड्स चाहते हैं।\nहम फ़ोन मालिक के नाम के साथ असली, सत्यापित नंबर उपलब्ध कराते हैं — आपकी ज़रूरत के किसी भी महानगरीय क्षेत्र से:',
 sms_1: (toFixed, v1) => `⚠️ <b>अपर्याप्त बैलेंस</b>\n\n💰 चाहिए: <b>$${toFixed}</b>\n👛 उपलब्ध: <b>$${v1}</b>\n\nकृपया टॉप-अप करें या कोई दूसरी भुगतान विधि चुनें।`,
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
 sms_24: '✅ कोई सक्रिय ऐप सत्र नहीं मिला — आप स्वतंत्र रूप से लॉगिन कर सकते हैं।',
 sms_25: '✅ <b>सभी डिवाइस लॉग आउट हो गए!</b>\n\nअब आप नए डिवाइस पर लॉगिन कर सकते हैं।',
 sms_26: (buyPlan) => `❌ <b>सब्सक्रिप्शन आवश्यक</b>\n\nSMS कैंपेन बनाने के लिए आपको सक्रिय सब्सक्रिप्शन चाहिए।\n\nसब्सक्राइब करने के लिए मुख्य मेनू पर <b>${buyPlan}</b> दबाएँ — प्लान में असीमित URL शॉर्टनिंग, BulkSMS, फ़ोन सत्यापन और मुफ़्त डोमेन शामिल हैं!`,
 sms_27: (SMS_APP_LINK, chatId) => `📵 <b>कोई सक्रिय डिवाइस नहीं</b>\n\nकैंपेन बनाने से पहले आपको किसी डिवाइस पर ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS ऐप सक्रिय करना होगा।\n\n1️⃣ ऐप डाउनलोड करें: ${SMS_APP_LINK}\n2️⃣ एक्टिवेशन कोड दर्ज करें: <code>${chatId}</code>\n3️⃣ कैंपेन बनाने के लिए यहाँ वापस आएँ`,
 sms_28: (length) => `📱 <b>डिवाइस चुनें</b>\n\nआपके पास ${length} सक्रिय डिवाइस हैं। चुनें कि यह कैंपेन कौन सा डिवाइस भेजेगा:`,
 sms_29: '❌ कृपया नीचे दिए बटनों में से एक डिवाइस चुनें।',
 sms_3: (minAmount, maxAmount) => `कृपया ${minAmount} और ${maxAmount} लीड्स के बीच मान्य संख्या दर्ज करें।`,
 sms_30: '❌ कैंपेन लोड करने में विफल। कृपया फिर से प्रयास करें।',
 sms_31: '❌ कैंपेन का नाम खाली नहीं हो सकता। कृपया एक नाम दर्ज करें:',
 sms_32: '✍️ <b>कैंपेन सामग्री</b>\n\nअपना SMS संदेश टाइप करें। संपर्क के नाम से निजीकृत करने के लिए <code>[name]</code> उपयोग करें।\n\nसंदेश में लाइन ब्रेक स्पेस के रूप में सुरक्षित रहते हैं।\n\n<b>संदेश रोटेशन</b> (हर संपर्क को अलग संदेश) के लिए, संदेशों को अलग पंक्ति में <code>---</code> से अलग करें:\n<code>नमस्ते [name], हमारा ऑफ़र देखें!\n---\nहाय [name], यह डील न चूकें!</code>',
 sms_33: '📱 <b>SMS कैंपेन बनाएँ</b>\n\nअपने कैंपेन के लिए एक नाम दर्ज करें:',
 sms_34: '❌ संदेश सामग्री खाली नहीं हो सकती। कृपया अपना SMS संदेश टाइप करें:',
 sms_35: '❌ कृपया कम से कम एक गैर-खाली संदेश पंक्ति दर्ज करें।',
 sms_36: '❌ फ़ाइल में कोई मान्य फ़ोन नंबर नहीं मिला।\n\nकृपया फ़ोन नंबरों वाली फ़ाइल अपलोड करें (प्रति पंक्ति एक, + और देश कोड से शुरू)।',
 sms_37: (length, length1, smsGapTimePrompt) => `👥 <b>फ़ाइल से ${length} संपर्क${length1} लोड हुए!</b>\n\n${smsGapTimePrompt}`,
 sms_38: '❌ फ़ाइल प्रोसेस करने में विफल। कृपया फिर से प्रयास करें या संपर्कों को टेक्स्ट के रूप में भेजें।',
 sms_39: '✍️ <b>कैंपेन सामग्री</b>\n\nअपना SMS संदेश टाइप करें। निजीकरण के लिए <code>[name]</code> उपयोग करें।\nरोटेशन के लिए संदेशों को अलग पंक्ति में <code>---</code> से अलग करें।',
 sms_4: (domain, plan) => `❌ URL शॉर्टनर सक्रिय नहीं किया जा सकता — <b>${domain}</b> पर एक सक्रिय होस्टिंग प्लान (<b>${plan}</b>) है।\n\nशॉर्टनर का CNAME आपके होस्टिंग A रिकॉर्ड को बदल देगा और आपकी वेबसाइट ऑफ़लाइन हो जाएगी।\n\nकृपया कोई दूसरा डोमेन उपयोग करें, या पहले अपना होस्टिंग प्लान निष्क्रिय करें।`,
 sms_40: '❌ कृपया संपर्कों को टेक्स्ट के रूप में भेजें या फ़ाइल अपलोड करें।',
 sms_41: '❌ कोई मान्य फ़ोन नंबर नहीं मिला।\n\nफ़ोन नंबर में कम से कम 7 अंक होने चाहिए (अधिमानतः + से शुरू होने वाले देश कोड के साथ)।\n\nउदाहरण:\n<code>+18189279992, John\n+14155551234</code>',
 sms_42: (length, length1, warningLine, smsGapTimePrompt) => `👥 <b>${length} संपर्क${length1} लोड हुए!</b>${warningLine}\n\n${smsGapTimePrompt}`,
 sms_43: '📋 <b>संपर्क अपलोड करें</b>\n\nसंपर्कों को टेक्स्ट के रूप में भेजें या .txt/.csv फ़ाइल अपलोड करें:',
 sms_44: '❌ कृपया 1 और 300 सेकंड के बीच संख्या दर्ज करें, या डिफ़ॉल्ट के लिए बटन दबाएँ।',
 sms_45: (buyPlan) => `❌ <b>मुफ़्त ट्रायल समाप्त</b>\n\nआपने अपने सभी मुफ़्त SMS उपयोग कर लिए हैं। असीमित BulkSMS कैंपेन अनलॉक करने के लिए सब्सक्राइब करें!\n\n👉 सब्सक्राइब करने के लिए <b>${buyPlan}</b> दबाएँ।`,
 sms_46: (campaignName, length, v2, deviceLine) => `💾 <b>कैंपेन ड्राफ़्ट के रूप में सहेजा गया!</b>\n\n📋 नाम: ${campaignName}\n✍️ संदेश: ${length}\n👥 संपर्क: ${v2}${deviceLine}\n\nआप इसे बाद में SMS ऐप या <b>📋 मेरे कैंपेन</b> से संपादित करके भेज सकते हैं।`,
 sms_47: (campaignName, length, v2, gapTime, deviceLine) => `✅ <b>कैंपेन बन गया!</b>\n\n📋 नाम: ${campaignName}\n✍️ संदेश: ${length}\n👥 संपर्क: ${v2}\n⏱ अंतराल: ${gapTime} सेकंड${deviceLine}\n\nआपका कैंपेन स्वतः सिंक होकर आपके कनेक्टेड डिवाइस पर भेजना शुरू कर देगा।`,
 sms_48: '❌ कैंपेन बनाने में विफल। कृपया फिर से प्रयास करें।',
 sms_49: '⚠️ कृपया नीचे दिए विकल्पों में से एक चुनें:',
 sms_5: (domain, error) => `❌ <b>${domain}</b> को लिंक नहीं कर सके: ${error}`,
 sms_50: '❌ कृपया इस प्रारूप में दिनांक और समय दर्ज करें: <code>YYYY-MM-DD HH:MM</code>',
 sms_51: '❌ अमान्य दिनांक या दिनांक बीत चुका है।\n\nकृपया इस प्रारूप में भविष्य का दिनांक दर्ज करें: <code>YYYY-MM-DD HH:MM</code>\n\nउदाहरण: <code>2027-07-15 09:30</code>',
 sms_52: (campaignName, length, v2, gapTime, schedDate, deviceLine) => `✅ <b>कैंपेन शेड्यूल हो गया!</b>\n\n📋 नाम: ${campaignName}\n✍️ संदेश: ${length}\n👥 संपर्क: ${v2}\n⏱ अंतराल: ${gapTime} सेकंड\n📅 शेड्यूल: ${schedDate} UTC${deviceLine}\n\nकैंपेन निर्धारित समय पर स्वतः सिंक होकर भेजना शुरू करेगा। सुनिश्चित करें कि आपका डिवाइस ऑनलाइन रहे।`,
 sms_53: '❌ शेड्यूल्ड कैंपेन बनाने में विफल। कृपया फिर से प्रयास करें।',
 sms_54: (SUPPORT_USERNAME) => `📞 Cloud IVR जल्द आ रहा है! अपडेट के लिए ${SUPPORT_USERNAME} से संपर्क करें।`,
 sms_55: '🛡️🔥 Anti-Red होस्टिंग फ़िलहाल उपलब्ध नहीं है। हमसे संपर्क करने के लिए कीबोर्ड पर <b>💬 सहायता पाएँ</b> दबाएँ।',
 sms_56: (substring, v1) => `🔗 <b>URL मिला!</b>\n\n<code>${substring}${v1}</code>\n\n⚠️ आपके पास कोई लिंक शेष नहीं है।\n\n👉 URL छोटे करने के लिए अपग्रेड करें!`,
 sms_57: (minEmails, length) => `❌ बहुत कम ईमेल। न्यूनतम <b>${minEmails}</b> है, आपने <b>${length}</b> दिए।`,
 sms_58: (maxEmails, length) => `❌ बहुत अधिक ईमेल। अधिकतम <b>${maxEmails}</b> है, आपने <b>${length}</b> दिए।\n\nकृपया अपनी सूची कम करें।`,
 sms_59: (length) => `⏳ ${length} ईमेल सत्यापित हो रहे हैं...\n\nइसमें थोड़ा समय लग सकता है।`,
 sms_6: (sanitizeProviderError) => `❌ DNS त्रुटि: ${sanitizeProviderError}`,
 sms_7: (error) => `❌ DNS त्रुटि: ${error}`,
 sms_8: (message) => `❌ त्रुटि: ${message}`,
 sms_9: (message) => `❌ त्रुटि: ${message}`,
 util_1: (displayName, expiryDate) => `⚠️ <b>VPS समाप्त हो रहा है — कोई ऑटो-रिन्यूअल नहीं</b>\n\n🖥️ <b>${displayName}</b> <b>${expiryDate}</b> को समाप्त हो रहा है।\nऑटो-रिन्यूअल <b>बंद</b> है।\n\n⏰ <b>समय सीमा से पहले मैन्युअल रूप से रिन्यू करें</b> अन्यथा आपका सर्वर स्थायी रूप से हटा दिया जाएगा।\n\nजाएँ: VPS/RDP → प्रबंधित करें → अभी रिन्यू करें`,
 util_10: (toLocaleString, domain, v2, v3, v4) => `🎉 <b>आपने ₦${toLocaleString} बचाए!</b> डोमेन <b>${domain}</b> की लागत ₦${v3} के बजाय ₦${v2} रही। ₦${v4} का अंतर आपके वॉलेट बैलेंस में जमा कर दिया गया है।`,
 util_11: (website_name, round, APP_SUPPORT_LINK) => `आपका डोमेन <b>${website_name}</b> सफलतापूर्वक पंजीकृत हो गया है, लेकिन होस्टिंग सेटअप विफल रहा। डोमेन लागत ली गई — होस्टिंग हिस्सा (₦${round}) आपके वॉलेट में वापस। होस्टिंग सेटअप पूरा करने के लिए कृपया सहायता से संपर्क करें: ${APP_SUPPORT_LINK}`,
 util_12: '✅ भुगतान प्राप्त हुआ!',
 util_13: (countryName) => `✅ बैंक भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रियण के लिए पता सत्यापन आवश्यक है।\n\nकृपया अपना पूरा पता दर्ज करें:\n<code>सड़क, शहर, पोस्टल कोड, देश</code>\n\n<i>उदाहरण: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nसबमिट होने के बाद हम टेलीकॉम सत्यापन संभालेंगे और आपका नंबर स्वतः सक्रिय कर देंगे।`,
 util_14: (countryName, text) => `✅ बैंक भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रिय करने के लिए बिलिंग पता आवश्यक है।\nपता ${text}।\n\nकृपया अपना पता दर्ज करें:\n<code>सड़क, शहर, देश</code>\n\nउदाहरण: <i>123 Main St, Sydney, Australia</i>`,
 util_15: (delivered, requested, toFixed) => `💰 <b>आंशिक रिफ़ंड</b>\n📊 ${delivered}/${requested} लीड्स डिलीवर\n💵 रिफ़ंड: <b>$${toFixed}</b> → वॉलेट`,
 util_16: (targetName, length) => `📄 <b>फ़ाइल 1 — ${targetName} नंबर + असली नाम (${length} मिलान)</b>`,
 util_17: (targetName, length) => `📄 <b>फ़ाइल 2 — सभी ${targetName} फ़ोन नंबर (कुल ${length})</b>`,
 util_18: (ngnIn, toLowerCase) => `✅ भुगतान प्राप्त हुआ! आपके वॉलेट में ₦${ngnIn} जमा किए गए हैं। अपनी ${toLowerCase} खरीद पूरी करने के लिए वॉलेट उपयोग करें।`,
 util_2: (displayName, chargedDisplay, toUpperCase, toLocaleDateString, toFixed, v5) => `✅ <b>VPS स्वतः रिन्यू हुआ</b>\n\n🖥️ <b>${displayName}</b> 1 माह के लिए रिन्यू हुआ।\n💰 ${toUpperCase} वॉलेट से ${chargedDisplay} काटे गए।\n📅 नई समाप्ति: <b>${toLocaleDateString}</b>\n\n💳 बैलेंस: $${toFixed} / ₦${v5}`,
 util_3: (displayName, toFixed, planPrice, expiryDate) => `🚨 <b>तत्काल — VPS रिन्यूअल विफल</b>\n\n🖥️ <b>${displayName}</b> स्वतः रिन्यू नहीं हो सका।\n💰 बैलेंस: $${toFixed}\n💵 आवश्यक: <b>$${planPrice}/माह</b>\n\n⚠️ <b>जब तक आप मैन्युअल रूप से रिन्यू नहीं करते, आपका सर्वर ${expiryDate} को स्थायी रूप से हटा दिया जाएगा।</b>\n\nजाएँ: VPS/RDP → प्रबंधित करें → 📅 अभी रिन्यू करें`,
 util_4: (displayName) => `❌ <b>VPS रद्द — भुगतान प्राप्त नहीं हुआ</b>\n\n🖥️ <b>${displayName}</b> रद्द कर दिया गया है।\n💰 ऑटो-रिन्यूअल विफल रहा और कोई मैन्युअल भुगतान प्राप्त नहीं हुआ।\n\n💡 आप मुख्य मेनू से कभी भी नया VPS खरीद सकते हैं।`,
 util_5: (displayName) => `❌ <b>VPS हटाया गया</b>\n\n🖥️ <b>${displayName}</b> स्थायी रूप से हटा दिया गया है।\n\n💡 कारण: ऑटो-रिन्यूअल विफल रहा और समय सीमा से पहले कोई मैन्युअल रिन्यूअल प्राप्त नहीं हुआ।\n\nआप मुख्य मेनू से कभी भी नया VPS खरीद सकते हैं।`,
 util_6: (displayName, chargedDisplay, toLocaleDateString, toFixed, v4) => `✅ <b>VPS स्वतः रिन्यू हुआ</b>\n\n🖥️ <b>${displayName}</b> 1 माह के लिए रिन्यू हुआ।\n💰 ${chargedDisplay} काटे गए।\n📅 नई समाप्ति: <b>${toLocaleDateString}</b>\n\n💳 बैलेंस: $${toFixed} / ₦${v4}`,
 util_7: (displayName, toFixed) => `🚨 <b>तत्काल — VPS समाप्त</b>\n\n🖥️ <b>${displayName}</b> समाप्त हो गया है।\n💰 बैलेंस: $${toFixed}\n\n⚠️ <b>सर्वर जल्द ही हटा दिया जाएगा।</b>\nअभी रिन्यू करें: VPS/RDP → प्रबंधित करें → 📅 अभी रिन्यू करें`,
 util_8: (displayName, expiryDate, planPrice, toFixed, statusIcon, v5) => `🖥️ <b>VPS 3 दिनों में समाप्त हो रहा है</b>\n\n<b>${displayName}</b> <b>${expiryDate}</b> को समाप्त हो रहा है।\n💵 आवश्यक: <b>$${planPrice}/माह</b>\n💳 बैलेंस: $${toFixed}\n${statusIcon} ${v5}`,
 util_9: (domain, ngnPrice) => `💰 <b>स्वतः रिफ़ंड:</b> <b>${domain}</b> का डोमेन पंजीकरण विफल रहा। आपका ${ngnPrice} NGN का भुगतान आपके वॉलेट बैलेंस में जमा कर दिया गया है।`,

 // === Windows RDP — 2 दिन (48 घंटे) की छूट अवधि ===
 rdpGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> <b>समाप्त</b> हो गया और <b>बंद</b> कर दिया गया।\n\n🗑 नवीनीकरण न करने पर इसे <b>${deleteDate} को स्थायी रूप से हटा दिया जाएगा</b> (2-दिन की छूट अवधि) — सारा डेटा नष्ट हो जाएगा।\n\n♻️ अभी नवीनीकृत करें: 🖥️ VPS/RDP → Manage → Renew`,
 rdpGraceReminder: (displayName, deleteDate) => `⏳ <b>अंतिम अनुस्मारक</b>\n\n🖥 नवीनीकरण न करने पर <b>${displayName}</b> को <b>${deleteDate} को स्थायी रूप से हटा दिया जाएगा</b>।\n\nउसके बाद सर्वर और उसका सारा डेटा हमेशा के लिए चला जाएगा।\n\n♻️ अभी नवीनीकृत करें: 🖥️ VPS/RDP → Manage → Renew`,
 rdpDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> को 2-दिन की छूट अवधि बिना नवीनीकरण के समाप्त होने के बाद <b>स्थायी रूप से हटा दिया गया</b>।\n\nसर्वर का सारा डेटा नष्ट हो गया है। आप मेनू से कभी भी नया Windows RDP ऑर्डर कर सकते हैं।`,
 // === DigitalOcean VPS — 2 दिन (48 घंटे) की छूट अवधि ===
 vpsGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> <b>समाप्त</b> हो गया और <b>बंद</b> कर दिया गया।\n\n🗑 नवीनीकरण न करने पर इसे <b>${deleteDate} को स्थायी रूप से हटा दिया जाएगा</b> (2-दिन की छूट अवधि) — सारा डेटा नष्ट हो जाएगा।\n\n♻️ अभी नवीनीकृत करें: 🖥️ VPS/RDP → Manage → Renew`,
 vpsGraceReminder: (displayName, deleteDate) => `⏳ <b>अंतिम अनुस्मारक</b>\n\n🖥 नवीनीकरण न करने पर <b>${displayName}</b> को <b>${deleteDate} को स्थायी रूप से हटा दिया जाएगा</b>।\n\nउसके बाद सर्वर और उसका सारा डेटा हमेशा के लिए चला जाएगा।\n\n♻️ अभी नवीनीकृत करें: 🖥️ VPS/RDP → Manage → Renew`,
 vpsDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> को 2-दिन की छूट अवधि बिना नवीनीकरण के समाप्त होने के बाद <b>स्थायी रूप से हटा दिया गया</b>।\n\nसर्वर का सारा डेटा नष्ट हो गया है। आप मेनू से कभी भी नया VPS ऑर्डर कर सकते हैं।`,
 vps_1: (message) => `❌ फ़ाइल पढ़ने में विफल: ${message}`,
 vps_10: '✏️ नई <b>विषय</b> पंक्ति दर्ज करें:',
 vps_11: '⚙️ <b>Email Admin Panel</b>',
 vps_12: '📭 No domains configured.',
 vps_13: '🗑 <b>Remove Domain</b>\\n\\nSelect the domain to remove:',
 vps_14: (domainList) => `🌐 <b>Sending Domains</b>\n\n${domainList}`,
 vps_15: (domainToRemove) => `✅ Domain <b>${domainToRemove}</b> removed successfully.\n\nDNS records cleaned up.`,
 vps_16: (error) => `❌ Failed to remove: ${error}`,
 vps_17: (message) => `❌ Error removing domain: ${message}`,
 vps_18: '🌐 Back to domains.',
 vps_19: '❌ Invalid domain name. Please enter a valid domain (e.g., example.com)',
 vps_2: 'कृपया चुनें: "📝 सादा टेक्स्ट टाइप करें" या "📎 HTML फ़ाइल अपलोड करें"',
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
 vps_3: (totalPrice, toFixed) => `❌ अपर्याप्त बैलेंस। आपको $${totalPrice} चाहिए लेकिन आपके पास $${toFixed} है। कृपया पहले जमा करें।`,
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
 vps_4: 'भुगतान विधि चुनें:',
 vps_40: (rate, toFixed) => `✅ Rate updated to <b>$${rate}/email</b> ($${toFixed} per 500)`,
 vps_41: '💰 Back to pricing.',
 vps_42: '❌ Invalid. Enter a number.',
 vps_43: (min) => `✅ Minimum emails updated to <b>${min}</b>`,
 vps_44: '💰 Back to pricing.',
 vps_45: '❌ Invalid. Enter a number.',
 vps_46: (max) => `✅ Maximum emails updated to <b>${max}</b>`,
 vps_47: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_48: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_49: '💵 वह राशि दर्ज करें जो आप लोड करना चाहते हैं ($50 – $1,000):',
 vps_5: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_50: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_51: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_52: (reason) => `🚫 <b>मार्केटप्लेस एक्सेस प्रतिबंधित</b>\n\nआप लिस्टिंग नहीं बना सकते। आपका मार्केटप्लेस एक्सेस निलंबित कर दिया गया है।\nकारण: <i>${reason}</i>`,
 vps_53: (reason) => `🚫 <b>मार्केटप्लेस एक्सेस प्रतिबंधित</b>\n\nआप लिस्टिंग नहीं बना सकते। आपका मार्केटप्लेस एक्सेस निलंबित कर दिया गया है।\nकारण: <i>${reason}</i>`,
 vps_54: '❌ उत्पाद प्रकाशित करने में त्रुटि। कृपया फिर से प्रयास करें।',
 vps_55: '🚧 VPS सेवा जल्द आ रही है! बने रहें।',
 vps_56: '🚧 VPS सेवा जल्द आ रही है! बने रहें।',
 vps_57: 'सत्र समाप्त हो गया। कृपया अपना URL फिर से पेस्ट करें।',
 vps_58: (displayUrl) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 vps_59: (displayUrl) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 vps_6: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_60: '❌ शॉर्ट लिंक बनाने में त्रुटि। कृपया फिर से प्रयास करें।',
 vps_61: 'कृपया एक विकल्प चुनें:',
 vps_62: 'सत्र समाप्त हो गया। कृपया अपना URL फिर से पेस्ट करें।',
 vps_63: '❌ अमान्य उपनाम। केवल अक्षर, अंक और हाइफ़न उपयोग करें।',
 vps_64: '❌ उपनाम 2-30 अक्षरों का होना चाहिए।',
 vps_65: (customAlias) => `❌ उपनाम <code>${customAlias}</code> पहले से लिया जा चुका है। कोई दूसरा आज़माएँ।`,
 vps_66: (displayUrl) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 vps_67: (displayUrl) => `✅ <b>लिंक छोटा हो गया!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 कॉपी करने के लिए टैप करें`,
 vps_68: '❌ शॉर्ट लिंक बनाने में त्रुटि। कृपया फिर से प्रयास करें।',
 vps_69: (domain, plan) => `❌ URL शॉर्टनर सक्रिय नहीं किया जा सकता — <b>${domain}</b> पर एक सक्रिय होस्टिंग प्लान (<b>${plan}</b>) है।\n\nशॉर्टनर का CNAME आपके होस्टिंग A रिकॉर्ड को बदल देगा और आपकी वेबसाइट ऑफ़लाइन हो जाएगी।\n\nकृपया कोई दूसरा डोमेन उपयोग करें, या पहले अपना होस्टिंग प्लान निष्क्रिय करें।`,
 vps_7: (toLocaleString, price, totalEmails) => `📧 <b>ईमेल ब्लास्ट भुगतान</b>\n\n💵 राशि: <b>₦${toLocaleString}</b> (~$${price})\n📬 कैंपेन: ${totalEmails} ईमेल\n\n🏦 नीचे दिए लिंक से अपना भुगतान पूरा करें:`,
 vps_70: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> को लिंक नहीं कर सके: ${sanitizeProviderError}`,
 vps_71: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> के लिए DNS त्रुटि: ${sanitizeProviderError}`,
 vps_72: (domain, error) => `❌ <b>${domain}</b> के लिए DNS त्रुटि: ${error}`,
 vps_73: 'कृपया एक मान्य डोमेन चुनें',
 vps_74: (shortUrl) => `आपका छोटा किया गया URL है: ${shortUrl}`,
 vps_75: (shortUrl) => `आपका छोटा किया गया URL है: ${shortUrl}`,
 vps_76: (domain) => `❌ <b>${domain}</b> दुरुपयोग नीति उल्लंघन के कारण अवरुद्ध है और इसे पंजीकृत या उपयोग नहीं किया जा सकता।`,
 vps_77: (domain) => `🔍 ${domain} की उपलब्धता खोजी जा रही है...`,
 vps_78: (domain) => `❌ <b>${domain}</b> उपलब्ध नहीं है।`,
 vps_79: (baseName) => `🔍 <b>${baseName}</b> के विकल्प खोजे जा रहे हैं...`,
 vps_8: '❌ अमान्य ईमेल पता। कृपया मान्य ईमेल दर्ज करें (जैसे you@gmail.com):',
 vps_80: (altList) => `✅ उपलब्ध विकल्प:\n\n${altList}\n\nजाँचने के लिए कोई भी डोमेन नाम टाइप करें:`,
 vps_81: 'कोई विकल्प नहीं मिला। कोई दूसरा नाम आज़माएँ:',
 vps_82: (ns) => `अमान्य नेमसर्वर: <code>${ns}</code>\nकृपया मान्य नेमसर्वर होस्टनाम दर्ज करें।`,
 vps_83: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_84: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_85: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_86: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_87: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_88: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_89: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_9: (testAddr) => `⏳ Sending test email to <b>${testAddr}</b> via Brevo...`,
 vps_90: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_91: '⚠️ भुगतान प्रोसेसिंग अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया बाद में प्रयास करें या क्रिप्टो उपयोग करें।',
 vps_92: 'बैंक ₦ायरा + कार्ड 🌐︎',
 vps_93: 'DNS रिकॉर्ड आपके कस्टम नेमसर्वर प्रोवाइडर द्वारा प्रबंधित हैं। प्रोवाइडर बदलने के लिए "🔄 नेमसर्वर प्रबंधित करें" उपयोग करें।',
 vps_94: (domain, plan) => `❌ URL शॉर्टनर सक्रिय नहीं किया जा सकता — <b>${domain}</b> पर एक सक्रिय होस्टिंग प्लान (<b>${plan}</b>) है।\n\nशॉर्टनर का CNAME आपके होस्टिंग A रिकॉर्ड को बदल देगा और आपकी वेबसाइट ऑफ़लाइन हो जाएगी।\n\nकृपया कोई दूसरा डोमेन उपयोग करें, या पहले अपना होस्टिंग प्लान निष्क्रिय करें।`,
 vps_95: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> को लिंक नहीं कर सके: ${sanitizeProviderError}`,
 vps_96: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> के लिए DNS त्रुटि: ${sanitizeProviderError}`,
 vps_97: (domain, error) => `❌ <b>${domain}</b> के लिए DNS त्रुटि: ${error}`,
 vps_98: (message) => `❌ त्रुटि: ${message}`,
 wh_1: (toFixed) => `💰 अतिरिक्त ₦ वॉलेट में जमा: <b>$${toFixed}</b>`,
 wh_10: (length) => `📄 <b>फ़ाइल 1 — नंबर + असली नाम (${length} मिलान)</b>`,
 wh_11: (length) => `📄 <b>फ़ाइल 2 — सभी फ़ोन नंबर (कुल ${length})</b>`,
 wh_12: (toFixed, toLowerCase) => `✅ भुगतान प्राप्त हुआ! आपके वॉलेट में $${toFixed} जमा किए गए हैं। अपनी ${toLowerCase} खरीद पूरी करने के लिए वॉलेट उपयोग करें।`,
 wh_13: (toFixed, usdBal) => `❌ VPS प्रोविज़निंग विफल।\n\n💰 <b>$${toFixed}</b> आपके वॉलेट में वापस कर दिए गए हैं।\nवॉलेट बैलेंस: <b>$${usdBal}</b>\n\nकृपया फिर से प्रयास करें या सहायता से संपर्क करें।`,
 wh_14: (domain, price) => `💰 <b>स्वतः रिफ़ंड:</b> <b>${domain}</b> का डोमेन पंजीकरण विफल रहा। $${price} आपके वॉलेट बैलेंस में जमा कर दिए गए हैं।`,
 wh_15: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>आपने $${v4} बचाए!</b> डोमेन <b>${domain}</b> की लागत $${price} के बजाय $${cheaperPrice} रही। $${savingsUsd} का अंतर आपके वॉलेट बैलेंस में जमा कर दिया गया है।`,
 wh_16: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `आपका डोमेन <b>${website_name}</b> सफलतापूर्वक पंजीकृत हो गया है, लेकिन होस्टिंग सेटअप विफल रहा। डोमेन लागत ($${domainPrice}) ली गई — होस्टिंग हिस्सा ($${toFixed}) आपके वॉलेट में वापस। होस्टिंग सेटअप पूरा करने के लिए कृपया सहायता से संपर्क करें: ${APP_SUPPORT_LINK}`,
 wh_17: '✅ क्रिप्टो भुगतान प्राप्त हुआ!',
 wh_18: (countryName) => `✅ क्रिप्टो भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रियण के लिए पता सत्यापन आवश्यक है।\n\nकृपया अपना पूरा पता दर्ज करें:\n<code>सड़क, शहर, पोस्टल कोड, देश</code>\n\n<i>उदाहरण: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nसबमिट होने के बाद हम टेलीकॉम सत्यापन संभालेंगे और आपका नंबर स्वतः सक्रिय कर देंगे।`,
 wh_19: (countryName, text) => `✅ क्रिप्टो भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रिय करने के लिए बिलिंग पता आवश्यक है।\nपता ${text}।\n\nकृपया अपना पता दर्ज करें:\n<code>सड़क, शहर, देश</code>\n\nउदाहरण: <i>123 Main St, Sydney, Australia</i>`,
 wh_2: (domain, price) => `💰 <b>स्वतः रिफ़ंड:</b> <b>${domain}</b> का डोमेन पंजीकरण विफल रहा। $${price} आपके वॉलेट बैलेंस में जमा कर दिए गए हैं।`,
 wh_20: (toFixed) => `💰 अतिरिक्त क्रिप्टो वॉलेट में जमा: <b>$${toFixed}</b>`,
 wh_21: (delivered, requested, toFixed) => `💰 <b>आंशिक रिफ़ंड</b>\n📊 ${delivered}/${requested} लीड्स डिलीवर\n💵 रिफ़ंड: <b>$${toFixed}</b> → वॉलेट`,
 wh_22: (toFixed, toLowerCase) => `✅ भुगतान प्राप्त हुआ! आपके वॉलेट में $${toFixed} जमा किए गए हैं। अपनी ${toLowerCase} खरीद पूरी करने के लिए वॉलेट उपयोग करें।`,
 wh_23: (toFixed, usdBal) => `❌ VPS प्रोविज़निंग विफल।\n\n💰 <b>$${toFixed}</b> आपके वॉलेट में वापस कर दिए गए हैं।\nवॉलेट बैलेंस: <b>$${usdBal}</b>\n\nकृपया फिर से प्रयास करें या सहायता से संपर्क करें।`,
 wh_3: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>आपने $${v4} बचाए!</b> डोमेन <b>${domain}</b> की लागत $${price} के बजाय $${cheaperPrice} रही। $${savingsUsd} का अंतर आपके वॉलेट बैलेंस में जमा कर दिया गया है।`,
 wh_4: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `आपका डोमेन <b>${website_name}</b> सफलतापूर्वक पंजीकृत हो गया है, लेकिन होस्टिंग सेटअप विफल रहा। डोमेन लागत ($${domainPrice}) ली गई — होस्टिंग हिस्सा ($${toFixed}) आपके वॉलेट में वापस। होस्टिंग सेटअप पूरा करने के लिए कृपया सहायता से संपर्क करें: ${APP_SUPPORT_LINK}`,
 wh_5: '✅ क्रिप्टो भुगतान प्राप्त हुआ!',
 wh_6: (countryName) => `✅ क्रिप्टो भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रियण के लिए पता सत्यापन आवश्यक है।\n\nकृपया अपना पूरा पता दर्ज करें:\n<code>सड़क, शहर, पोस्टल कोड, देश</code>\n\n<i>उदाहरण: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nसबमिट होने के बाद हम टेलीकॉम सत्यापन संभालेंगे और आपका नंबर स्वतः सक्रिय कर देंगे।`,
 wh_7: (countryName, text) => `✅ क्रिप्टो भुगतान प्राप्त हुआ!\n\n📍 <b>${countryName}</b> में नंबर सक्रिय करने के लिए बिलिंग पता आवश्यक है।\nपता ${text}।\n\nकृपया अपना पता दर्ज करें:\n<code>सड़क, शहर, देश</code>\n\nउदाहरण: <i>123 Main St, Sydney, Australia</i>`,
 wh_8: (toFixed) => `💰 अतिरिक्त क्रिप्टो वॉलेट में जमा: <b>$${toFixed}</b>`,
 wh_9: (requested, delivered, toFixed, v3) => `💰 <b>आंशिक रिफ़ंड</b>\n\n📊 ऑर्डर किए: ${requested} लीड्स\n✅ डिलीवर हुए: ${delivered}\n💵 रिफ़ंड: <b>$${toFixed}</b> आपके वॉलेट में जमा\n💰 वॉलेट: $${v3} USD`,
 wlt_1: '⏳ भुगतान पहले से जारी है। कृपया प्रतीक्षा करें...',
 wlt_10: '⚠️ लेन-देन इतिहास लोड नहीं हो सका। कृपया बाद में प्रयास करें।',
 wlt_11: (amount) => `💵 <b>$${amount}</b> जमा करें\n\nभुगतान विधि चुनें:`,
 wlt_12: '⚠️ NGN भुगतान अस्थायी रूप से अनुपलब्ध (विनिमय दर सेवा बंद)। कृपया क्रिप्टो आज़माएँ।',
 wlt_13: 'बैंक ₦ायरा + कार्ड 🌐︎',
 wlt_2: (reason) => `🚫 <b>मार्केटप्लेस एक्सेस प्रतिबंधित</b>\n\nआपका मार्केटप्लेस एक्सेस निलंबित कर दिया गया है।\nकारण: <i>${reason}</i>\n\nयदि आपको लगता है कि यह गलती है तो सहायता से संपर्क करें।`,
 wlt_3: (priceText, askDomainToUseWithShortener) => `${priceText}${askDomainToUseWithShortener}`,
 wlt_4: 'लिंक प्रकार चुनें:',
 wlt_5: '✏️ अपना कस्टम उपनाम दर्ज करें (केवल अक्षर, अंक, हाइफ़न):',
 wlt_6: '🔗 <b>URL शॉर्टनर के लिए डोमेन सक्रिय करें</b>\n\nशॉर्टनर से जोड़ने के लिए एक डोमेन चुनें। DNS स्वतः कॉन्फ़िगर हो जाएगा ताकि आप ब्रांडेड शॉर्ट लिंक बना सकें (जैसे <code>yourdomain.com/abc</code>)।',
 wlt_7: (label) => `${label} हटाएँ?`,
 wlt_8: '⏳ लेन-देन लोड हो रहे हैं...',
 wlt_9: '📜 <b>लेन-देन इतिहास</b>\n\nअभी तक कोई लेन-देन नहीं मिला। गतिविधि देखने के लिए जमा या खरीद करें।',

 // Unlink / cancel hosting plan (Hi)
 selectDomainToUnlink: mainDomain => `🗑️ <b>डोमेन अनलिंक करें</b>\n\nइस होस्टिंग प्लान से अनलिंक करने के लिए डोमेन चुनें।\n\n⚠️ अनलिंक करने पर:\n• cPanel से ऐडऑन डोमेन हटा दिया जाएगा\n• Cloudflare पर DNS रिकॉर्ड्स डिलीट होंगे\n• Anti-Red सुरक्षा हटा दी जाएगी\n• <code>public_html/&lt;domain&gt;/</code> की सभी फ़ाइलें <b>स्थायी रूप से डिलीट</b> होंगी\n\nयह क्रिया वापस नहीं होगी।\n\n<i>मुख्य डोमेन (<b>${mainDomain}</b>) यहाँ अनलिंक नहीं किया जा सकता — इसके लिए "होस्टिंग प्लान रद्द करें" का उपयोग करें।</i>`,
 noAddonDomainsToUnlink: '⚠️ इस होस्टिंग प्लान में कोई ऐडऑन डोमेन नहीं है। केवल मुख्य डोमेन जुड़ा है।\n\nमुख्य डोमेन हटाने के लिए "🚫 होस्टिंग प्लान रद्द करें" का उपयोग करें।',
 confirmUnlinkDomain: (addonDomain, mainDomain) => `⚠️ <b>अनलिंक की पुष्टि करें</b>\n\nआप <b>${addonDomain}</b> को होस्टिंग प्लान (<code>${mainDomain}</code>) से अनलिंक करने जा रहे हैं।\n\nयह करेगा:\n• cPanel से ऐडऑन डोमेन हटाएगा\n• <b>${addonDomain}</b> के सभी DNS रिकॉर्ड्स डिलीट करेगा\n• Anti-Red सुरक्षा हटाएगा\n• <code>public_html/${addonDomain.replace(/\./g, '')}/</code> की फ़ाइलें <b>स्थायी रूप से डिलीट</b> करेगा\n\nयह क्रिया <b>वापस नहीं होगी</b> और कोई रिफंड नहीं मिलेगा।\n\nजारी रखें?`,
 unlinkingDomain: addonDomain => `⏳ <b>${addonDomain}</b> को अनलिंक किया जा रहा है...`,
 unlinkDomainSuccess: addonDomain => `✅ <b>${addonDomain}</b> आपके होस्टिंग प्लान से अनलिंक कर दिया गया है।\n\nDNS रिकॉर्ड्स, ऐडऑन डोमेन एंट्री और Anti-Red सुरक्षा हटा दी गई है।`,
 unlinkDomainFailed: addonDomain => `❌ <b>${addonDomain}</b> को अनलिंक करने में विफल। पुनः प्रयास करें या सपोर्ट से संपर्क करें।`,

 // मौजूदा होस्टिंग प्लान में ऐडऑन डोमेन जोड़ना
 selectDomainToAttachHeader: mainDomain => `➕ <b>प्लान में डोमेन जोड़ें</b>\n\nअपने होस्टिंग प्लान (<code>${mainDomain}</code>) में जोड़ने के लिए डोमेन चुनें।\n\nकेवल हमारे यहाँ पंजीकृत और किसी होस्टिंग प्लान पर पहले से न जुड़े डोमेन ही दिखाए जाते हैं।\n\n<i>नए डोमेन की फ़ाइलें <code>public_html/&lt;domain&gt;/</code> में रहेंगी — आपकी प्राथमिक साइट से अलग।</i>`,
 noEligibleDomainsToAttach: '⚠️ कोई पात्र डोमेन नहीं मिला।\n\nइस प्लान में डोमेन जोड़ने के लिए, डोमेन का:\n• हमारे यहाँ पंजीकृत होना, और\n• किसी होस्टिंग प्लान पर पहले से न होना ज़रूरी है।\n\nनया डोमेन पंजीकृत करें, फिर यहाँ वापस आकर इसे जोड़ें।',

 // होस्टिंग प्लान का प्राथमिक डोमेन बदलें
 selectDomainToMakePrimary: mainDomain => `🔄 <b>प्राथमिक डोमेन बदलें</b>\n\nइस होस्टिंग प्लान का नया प्राथमिक डोमेन चुनें (वर्तमान में <code>${mainDomain}</code>)।\n\nकेवल आपके वे डोमेन दिखाए जाते हैं जो किसी अन्य प्लान के प्राथमिक डोमेन नहीं हैं।\n\n<i>आपकी वेबसाइट फ़ाइलें वहीं रहती हैं (<code>public_html/</code>)। आपका cPanel यूज़रनेम और PIN वही रहता है।</i>`,
 noEligibleDomainsToMakePrimary: '⚠️ कोई पात्र डोमेन नहीं मिला।\n\nप्राथमिक डोमेन बदलने के लिए, आपके पास एक और डोमेन होना चाहिए जो:\n• हमारे यहाँ पंजीकृत हो (🌐 बुलेटप्रूफ़ डोमेन में खरीदें), और\n• किसी अन्य होस्टिंग प्लान का प्राथमिक न हो।\n\nएक डोमेन खरीदें या पंजीकृत करें, फिर यहाँ वापस आकर उसे स्विच करें।',
 confirmChangePrimaryDomain: (newDomain, oldDomain) => `⚠️ <b>प्राथमिक डोमेन बदलने की पुष्टि</b>\n\n<b>${newDomain}</b> को इस प्लान का प्राथमिक डोमेन बनाएँ?\n\nक्या होगा:\n• <b>${newDomain}</b> आपकी मुख्य साइट का डोमेन बन जाएगा\n• <b>${oldDomain}</b> इस प्लान से हटा दिया जाएगा — यह आपके नाम पंजीकृत रहेगा, केवल होस्टिंग लिंक हटेगा\n• <code>public_html/</code> की आपकी फ़ाइलें सुरक्षित रहेंगी और अब <b>${newDomain}</b> पर दिखेंगी\n• <b>${newDomain}</b> के लिए DNS + Anti-Red सुरक्षा सेट होगी\n• आपका cPanel यूज़रनेम और PIN वही रहेगा\n\nयह क्रिया <b>पूर्ववत नहीं</b> की जा सकती और कोई रिफ़ंड नहीं मिलेगा।\n\nजारी रखें?`,
 changingPrimaryDomain: newDomain => `⏳ आपका प्राथमिक डोमेन <b>${newDomain}</b> में बदला जा रहा है...`,
 changePrimaryDomainSuccess: (newDomain, oldDomain, panelUrl) => `✅ <b>${newDomain}</b> अब आपका प्राथमिक डोमेन है!\n\n• <b>${oldDomain}</b> इस प्लान से हटा दिया गया है (अब भी आपके नाम पंजीकृत)।\n• <code>public_html/</code> की आपकी मौजूदा फ़ाइलें अब <b>${newDomain}</b> पर दिखती हैं।\n• वही cPanel यूज़रनेम और PIN।\n\n🔧 फ़ाइल मैनेजर खोलें: ${panelUrl}\n\n⏱️ DNS प्रसार: आमतौर पर 5 मिनट में लाइव।\n🛡️ Anti-Red सुरक्षा: तैनात हो रही है (30 सेकंड में सत्यापन)।`,
 changePrimaryDomainFailed: (newDomain, error) => `❌ आपका प्राथमिक डोमेन <b>${newDomain}</b> में नहीं बदला जा सका।\n\n<code>${error}</code>\n\nआपके प्लान में कोई बदलाव नहीं हुआ। कृपया पुनः प्रयास करें या सपोर्ट से संपर्क करें।`,
 confirmAttachDomain: (addonDomain, mainDomain, docRoot) => `🔗 <b>जोड़ने की पुष्टि</b>\n\n<b>${addonDomain}</b> को होस्टिंग प्लान (<code>${mainDomain}</code>) में जोड़ें?\n\nआगे क्या होगा:\n• cPanel ऐडऑन एंट्री बनेगी (प्राथमिक साइट से अलग)\n• डॉक्यूमेंट रूट: <code>${docRoot}/</code>\n• Cloudflare द्वारा DNS स्वतः कॉन्फ़िगर (root + www → tunnel)\n• Anti-Red सुरक्षा तैनात\n• पुराने DNS रिकॉर्ड (जैसे शॉर्टनर) साफ़\n\n<i>इस फ़ोल्डर की मौजूदा फ़ाइलें सुरक्षित रखी जाती हैं।</i>\n\nजारी रखें?`,
 attachingDomain: addonDomain => `⏳ <b>${addonDomain}</b> को आपके प्लान में जोड़ रहे हैं...`,
 attachDomainSuccess: (addonDomain, docRoot, panelUrl) => `✅ <b>${addonDomain}</b> अब आपके होस्टिंग प्लान से जुड़ गया है!\n\n📁 <b>साइट फ़ाइलें कहाँ अपलोड करें</b>\nइस डोमेन की फ़ाइलें यहाँ जाती हैं:\n<code>${docRoot}/</code>\n\n<code>public_html/</code> में नहीं — वहाँ आपकी <i>प्राथमिक</i> डोमेन की फ़ाइलें रहती हैं। हर ऐडऑन डोमेन का अपना अलग फ़ोल्डर होता है ताकि साइटें टकराएँ नहीं।\n\n🔧 फ़ाइल मैनेजर खोलें: ${panelUrl}\n\n⏱️ DNS प्रसार: आमतौर पर 5 मिनट में लाइव।\n🛡️ Anti-Red सुरक्षा: तैनात हो रही है (30 सेकंड में सत्यापन)।`,
 attachDomainFailed: (addonDomain, errorReason) => `❌ <b>${addonDomain}</b> को जोड़ नहीं सके।\n\n<i>कारण:</i> ${errorReason || 'अज्ञात त्रुटि'}\n\nपुनः प्रयास करें, या समस्या बनी रहे तो 💬 सहायता लें।`,
 attachDomainAlreadyOnPlan: addonDomain => `⚠️ <b>${addonDomain}</b> पहले से किसी होस्टिंग प्लान पर है। एक डोमेन एक समय में केवल एक प्लान से जुड़ सकता है।\n\nइसे यहाँ लाने के लिए, पहले दूसरे प्लान पर 🗑️ डोमेन अनलिंक करें।`,
 attachDomainLimitReached: (limit, planLabel) => `⚠️ <b>डोमेन सीमा पूरी</b>\n\nआपका वर्तमान प्लान (<b>${planLabel}</b>) ${limit} ऐडऑन डोमेन तक की अनुमति देता है।\n\nअसीमित ऐडऑन डोमेन के लिए Golden Anti-Red HostPanel पर अपग्रेड करें, या जगह बनाने के लिए मौजूदा ऐडऑन को अनलिंक करें।`,
 attachDomainBlocked: addonDomain => `🚫 <b>${addonDomain}</b> को नहीं जोड़ा जा सकता।\n\nयह डोमेन दुरुपयोग नीति के उल्लंघन के कारण स्थायी रूप से अवरुद्ध है।`,
 attachDomainAlreadyAttached: addonDomain => `ℹ️ <b>${addonDomain}</b> पहले से ही इस प्लान से जुड़ा है — कुछ करने की ज़रूरत नहीं।`,

 confirmCancelHostingPlan: (domain, plan) => `⚠️ <b>होस्टिंग प्लान रद्द करने की पुष्टि करें</b>\n\nआप स्थायी रूप से रद्द करने जा रहे हैं:\n• डोमेन: <b>${domain}</b>\n• प्लान: <b>${plan}</b>\n\nयह <b>स्थायी रूप से डिलीट</b> करेगा:\n• आपका cPanel खाता और सभी फ़ाइलें\n• सभी ईमेल, डेटाबेस और FTP खाते\n• इस प्लान के सभी ऐडऑन डोमेन\n• Anti-Red सुरक्षा\n\nयह वापस नहीं होगा और <b>कोई रिफंड नहीं मिलेगा</b>।\n\nडोमेन आपके नाम पर पंजीकृत रहेगा। केवल होस्टिंग रद्द होगी।\n\nक्या आप निश्चित हैं?`,
 cancellingHostingPlan: domain => `⏳ <b>${domain}</b> के लिए होस्टिंग प्लान रद्द किया जा रहा है...`,
 cancelHostingPlanSuccess: domain => `✅ <b>${domain}</b> के लिए होस्टिंग प्लान रद्द कर दिया गया है।\n\nआपका cPanel खाता, फ़ाइलें और सभी ऐडऑन डोमेन हटा दिए गए हैं। डोमेन पंजीकृत है और अब किसी होस्टिंग प्लान से मुक्त है।`,
 cancelHostingPlanFailed: domain => `❌ <b>${domain}</b> के लिए होस्टिंग प्लान रद्द करने में विफल। पुनः प्रयास करें या सपोर्ट से संपर्क करें।`,

 // Site offline / maintenance toggle (Hi)
 chooseSiteOfflineMode: domain => `🔌 <b>साइट ऑफलाइन करें</b>\n\nडोमेन: <b>${domain}</b>\n\nसाइट ऑफलाइन करने का तरीका चुनें:\n\n🛠️ <b>रखरखाव मोड</b> (अनुशंसित)\nविज़िटर्स को एक साफ "जल्द ही वापस आएंगे" पेज दिखेगा। ईमेल, FTP, डेटाबेस काम करते रहेंगे। छोटे संपादन या छोटी रुकावट के लिए सबसे अच्छा।\n\n🚫 <b>पूर्ण सस्पेंड</b>\nHTTP, FTP, ईमेल, डेटाबेस सभी रुक जाएंगे। विज़िटर्स को cPanel का मानक "खाता निलंबित" नोटिस दिखेगा। अगर पूरी तरह बंद करना है तो इसका उपयोग करें।\n\n⚠️ <b>महत्वपूर्ण — साइट ऑफलाइन करने से ये नहीं रुकेगा:</b>\n• समाप्ति का काउंटडाउन\n• ऑटो-रिन्यूअल बिलिंग\n\nप्लान सामान्य रूप से चलता रहेगा। यह केवल विज़िबिलिटी टॉगल है।`,
 confirmSiteOfflineMode: (domain, mode) => mode === 'suspended'
  ? `⚠️ <b>पूर्ण सस्पेंड की पुष्टि करें</b>\n\nआप <b>${domain}</b> को पूरी तरह सस्पेंड करने जा रहे हैं।\n\nयह रोक देगा:\n• HTTP (आपकी वेबसाइट)\n• FTP\n• ईमेल खाते\n• डेटाबेस\n\nविज़िटर्स को cPanel का मानक "खाता निलंबित" पेज दिखेगा। आप किसी भी समय इसी मेनू से सब कुछ वापस ऑनलाइन ला सकते हैं।\n\n<b>याद रखें — बिलिंग चलती रहेगी:</b>\n• समाप्ति तिथि अपरिवर्तित\n• ऑटो-रिन्यूअल चालू रहेगा\n\nजारी रखें?`
  : `⚠️ <b>रखरखाव मोड की पुष्टि करें</b>\n\nआप <b>${domain}</b> के लिए रखरखाव मोड चालू करने जा रहे हैं।\n\nक्या होगा:\n• विज़िटर्स को "जल्द ही वापस आएंगे" पेज दिखेगा\n• ईमेल, FTP, डेटाबेस काम करते रहेंगे\n• आपके <code>.htaccess</code> में एक छोटा ब्लॉक जोड़ा जाएगा (ऑनलाइन होने पर साफ हटा दिया जाता है)\n• <code>public_html/</code> में <code>maintenance.html</code> फ़ाइल बनेगी\n\n<b>याद रखें — बिलिंग चलती रहेगी:</b>\n• समाप्ति तिथि अपरिवर्तित\n• ऑटो-रिन्यूअल चालू रहेगा\n\nजारी रखें?`,
 takingSiteOffline: (domain, mode) => `⏳ <b>${domain}</b> को ${mode === 'suspended' ? 'सस्पेंड किया जा रहा है' : 'रखरखाव मोड में डाला जा रहा है'}...`,
 takeSiteOfflineSuccess: (domain, mode) => mode === 'suspended'
  ? `✅ <b>${domain}</b> अब ऑफलाइन है (पूर्ण सस्पेंड)। विज़िटर्स को सस्पेंडेड पेज दिखेगा। पुनः चालू करने के लिए "साइट ऑनलाइन लाएँ" टैप करें।\n\n<i>याद रखें: आपका प्लान समाप्ति की ओर गिनती जारी रखता है और ऑटो-रिन्यू अप्रभावित है।</i>`
  : `✅ <b>${domain}</b> अब रखरखाव मोड में है। विज़िटर्स को "जल्द ही वापस आएंगे" पेज दिखेगा। ईमेल और FTP चालू हैं। तैयार होने पर "साइट ऑनलाइन लाएँ" टैप करें।\n\n<i>याद रखें: आपका प्लान समाप्ति की ओर गिनती जारी रखता है और ऑटो-रिन्यू अप्रभावित है।</i>`,
 takeSiteOfflineFailed: (domain, err) => `❌ <b>${domain}</b> को ऑफलाइन करने में विफल।${err ? `\n\nकारण: <code>${err}</code>` : ''}\n\nपुनः प्रयास करें या सपोर्ट से संपर्क करें।`,
 confirmBringSiteOnline: domain => `🌐 <b>साइट को ऑनलाइन लाएँ</b>\n\nडोमेन: <b>${domain}</b>\n\nयह सार्वजनिक एक्सेस तुरंत बहाल करेगा। यदि आपने <i>रखरखाव मोड</i> उपयोग किया था, तो आपके <code>.htaccess</code> से रीडायरेक्ट ब्लॉक हटा दिया जाएगा। यदि <i>पूर्ण सस्पेंड</i> था, तो cPanel खाता अनसस्पेंड हो जाएगा और HTTP/FTP/ईमेल/DB वापस आ जाएंगे।\n\nजारी रखें?`,
 bringingSiteOnline: domain => `⏳ <b>${domain}</b> को वापस ऑनलाइन ला रहे हैं...`,
 bringSiteOnlineSuccess: domain => `✅ <b>${domain}</b> वापस ऑनलाइन है। कैश/CDN पूरी तरह साफ होने में 1 मिनट तक लग सकता है।`,
 bringSiteOnlineFailed: (domain, err) => `❌ <b>${domain}</b> को ऑनलाइन लाने में विफल।${err ? `\n\nकारण: <code>${err}</code>` : ''}\n\nपुनः प्रयास करें या सपोर्ट से संपर्क करें।`,

 // Domain validation errors
 domainMissingTLD: 'डोमेन एक्सटेंशन गायब है। कृपया .com, .net, .org, या अन्य एक्सटेंशन जोड़ें।\n\nउदाहरण: <b>yourname.com</b>',
 domainTooShort: 'डोमेन नाम बहुत छोटा है। डॉट से पहले कम से कम 3 अक्षर होने चाहिए।\n\nउदाहरण: <b>abc.com</b>',
 domainInvalidChars: 'डोमेन में अमान्य अक्षर हैं। केवल अक्षर, अंक और हाइफ़न का उपयोग करें।\n\nउदाहरण: <b>my-site.com</b>',
 domainStartsEndsHyphen: 'डोमेन हाइफ़न से शुरू या समाप्त नहीं हो सकता।\n\nउदाहरण: <b>mysite.com</b> (नहीं -mysite.com या mysite-.com)',
 domainSearchTimeout: (domain) => `⏱️ <b>${domain}</b> की डोमेन खोज अपेक्षा से अधिक समय ले रही है।\n\nकृपया कुछ देर में पुनः प्रयास करें या समस्या बनी रहने पर सपोर्ट से संपर्क करें।`,

 // SMS app activation / device management
 smsAppActivationCode: (chatId, plan, isSubscribed) => {
   if (!isSubscribed) {
     return `📱 <b>BulkSMS मुफ्त ट्रायल — 100 मुफ्त SMS</b>\n\n📲 <b>केवल Android डिवाइस</b> — iOS/iPhone समर्थित नहीं (Apple SMS भेजने वाले ऐप्स को प्रतिबंधित करता है)।\n\nआपका एक्टिवेशन कोड:\n<code>${chatId}</code>\n\n📲 <b>ऐप डाउनलोड करें:</b> ${SMS_APP_LINK}\n\nऐप खोलें → कोड दर्ज करें → भेजना शुरू करें!\n\n⚡ <b>ट्रायल:</b> केवल 1 डिवाइस।\n\n💡 असीमित डिवाइस + BulkSMS + URL शॉर्टनिंग + वैलिडेशन & अधिक अनलॉक करने के लिए मुख्य मेनू में <b>⚡ अपग्रेड प्लान</b> टैप करें!\n\neSIM कार्ड चाहिए? 💬 सपोर्ट टैप करें`
   }
   const deviceLimit = plan === 'Monthly' ? 'असीमित' : (plan === 'Weekly' ? '10' : (plan === 'Daily' ? '3' : '1'))
   return `📱 <b>BulkSMS — ${plan} प्लान सक्रिय ✅</b>\n\n📲 <b>केवल Android डिवाइस</b> — iOS/iPhone समर्थित नहीं (Apple SMS भेजने वाले ऐप्स को प्रतिबंधित करता है)।\n\nआपका एक्टिवेशन कोड:\n<code>${chatId}</code>\n\n📲 <b>ऐप डाउनलोड करें:</b> ${SMS_APP_LINK}\n\nऐप खोलें → कोड दर्ज करें → भेजना शुरू करें!\n\n⚡ <b>डिवाइस:</b> ${deviceLimit} ${deviceLimit === 'असीमित' ? 'डिवाइस' : `डिवाइस${deviceLimit === '1' ? '' : ''}`}\n\nऐप या बॉट में अभियान बनाएं।\n\neSIM कार्ड चाहिए? 💬 सपोर्ट टैप करें`
 },
 smsManageDevices: '📱 डिवाइस प्रबंधित करें',
 smsDevicesList: (devices, chatId) => {
   if (!devices || devices.length === 0) {
     return `📱 <b>कोई डिवाइस कनेक्ट नहीं</b>\n\nऐप डाउनलोड करें और अपने एक्टिवेशन कोड से लॉगिन करें:\n<code>${chatId}</code>\n\n📲 डाउनलोड: ${SMS_APP_LINK}`
   }
   const deviceList = devices.map((d, idx) => {
     const name = d.deviceName || `डिवाइस ${idx + 1}`
     const lastActive = d.lastActive ? new Date(d.lastActive).toLocaleString() : 'कभी नहीं'
     return `${idx + 1}. <b>${name}</b>\n   📱 <code>${d.deviceId}</code>\n   🕒 ${lastActive}`
   }).join('\n\n')
   return `📱 <b>आपके डिवाइस (${devices.length})</b>\n\n${deviceList}\n\n✏️ नीचे डिवाइस बटन टैप करके नाम बदलें, या ऐप में नाम बदलें।`
 },

 // Payment timeout and abandoned cart reminders
 paymentTimeoutReminder: `⏰ <b>आपका भुगतान सत्र समाप्त हो गया</b>\n\nनिष्क्रियता के 6 घंटे बाद आपका चेकआउट सत्र समाप्त हो गया।\n\nचिंता न करें! आप कभी भी उस उत्पाद या सेवा का चयन करके फिर से शुरू कर सकते हैं जो आप चाहते हैं।\n\n💬 मदद चाहिए? <b>सपोर्ट</b> टैप करें`,
 abandonedCartReminder: (productName, price) =>
   `🛒 <b>क्या आप अभी भी ${productName} में रुचि रखते हैं?</b>\n\n` +
   `आपने इसे 2 घंटे पहले अपने कार्ट में छोड़ा था।\n\n` +
   `💳 कीमत: $${price}\n\n` +
   `अभी अपनी खरीदारी पूरी करें! उत्पाद आपका इंतजार कर रहा है। 🎁\n\n` +
   `जारी रखने के लिए /start टैप करें या प्रश्न होने पर 💬 <b>सपोर्ट</b> टैप करें।`,
}

const phoneNumberLeads = ['🎯 प्रीमियम टार्गेटेड लीड्स', '✅📲 फोन लीड्स सत्यापित करें']

const buyLeadsSelectCountry = Object.keys(areasOfCountry)
const buyLeadsSelectSmsVoice = ['एसएमएस (कीमत 20$ प्रति 1000)', 'वॉयस (कीमत 0$ प्रति 1000)']
const buyLeadsSelectArea = country => Object.keys(areasOfCountry?.[country])
const buyLeadsSelectAreaCode = (country, area) => {
 const codes = areasOfCountry?.[country]?.[area].map(c => format(countryCodeOf[country], c))
 return codes.length > 1 ? ['Mixed Area Codes'].concat(codes) : codes
}
const _buyLeadsSelectAreaCode = (country, area) => areasOfCountry?.[country]?.[area]
const buyLeadsSelectCnam = yesNo
const buyLeadsSelectCarrier = country => carriersOf[country]
const buyLeadsSelectAmount = ['1000', '2000', '3000', '4000', '5000']
const buyLeadsSelectFormat = ['स्थानीय प्रारूप', 'अंतर्राष्ट्रीय प्रारूप']

const validatorSelectCountry = Object.keys(areasOfCountry)
const validatorSelectSmsVoice = ['एसएमएस (कीमत 20$ प्रति 1000)', 'वॉयस (कीमत 0$ प्रति 1000)']
const validatorSelectCarrier = country => carriersOf[country]
const validatorSelectCnam = yesNo
const validatorSelectAmount = ['ALL', '1000', '2000', '3000', '4000', '5000']
const validatorSelectFormat = ['स्थानीय प्रारूप', 'अंतर्राष्ट्रीय प्रारूप']

const selectFormatOf = {
 'स्थानीय प्रारूप': 'Local Format',
 'अंतर्राष्ट्रीय प्रारूप': 'International Format',
}

//redSelectRandomCustom

const redSelectRandomCustom = ['यादृच्छिक शॉर्ट लिंक']

const redSelectProvider = ['Bit.ly $10', `Shortit (ट्रायल ${FREE_LINKS})`]

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
 BTC: '₿ बिटकॉइन (BTC)',
 LTC: 'Ł लाइटकॉइन (LTC)',
 DOGE: 'Ð डोजकॉइन (DOGE)',
 BCH: 'Ƀ बिटकॉइन कैश (BCH)',
 ETH: 'Ξ एथेरियम (ETH)',
 TRON: '🌐 ट्रॉन (TRX)',
 'USDT (TRC20)': '₮ टेथर (USDT - TRC20)',
 'USDT (ERC20)': '₮ टेथर (USDT - ERC20)',
}

/////////////////////////////////////////////////////////////////////////////////////
const _bc = ['वापस', 'रद्द करें']
const _mc = ['🏠 Main Menu', 'रद्द करें']
const _isEmojiBack = item => {
  if (typeof item !== 'string') return false
  const s = item.replace(/^[^\p{L}]+/u, '').trim()
  return s === 'Back' || s === 'Retour' || s === '返回' || s === 'वापस'
}

const payIn = {
 crypto: 'क्रिप्टो',
 ...(HIDE_BANK_PAYMENT !== 'true' && { bank: 'बैंक ₦नायरा + कार्ड🏦💳' }),
 wallet: '👛 वॉलेट',
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

 phoneNumberLeads: kOf(phoneNumberLeads),
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
 // ── Main menu (2026-06 simplify): grouped into clear sections; secondary
 // services (Email Validation, Refer, Reseller, Join Channel, Email Blast)
 // moved under "➕ More" to cut top-level clutter. Handlers match by label,
 // so grouping/order changes carry no routing risk.
 ...require('../web-access').webMenuRows('hi'), // 🌐 Use on Web (only when WEBSITE_URL is set)
 [user.cloudPhone, user.hostingDomainsRedirect],
 ...(VPS_ENABLED === 'true' ? [[user.domainNames, user.vpsPlans]] : [[user.domainNames]]),
 ...(HIDE_SMS_APP !== 'true' ? [[user.smsAppMain, user.leadsValidation]] : [[user.leadsValidation]]),
 [user.digitalProducts, user.marketplace],
 [user.urlShortenerMain, user.virtualCard],
 [user.wallet, user.buyPlan],
 [user.changeSetting, user.getSupport],
 [user.more],
 ],
 resize_keyboard: true,
 },
 parse_mode: 'HTML',
 disable_web_page_preview: true,
}

const languages = {
 en: '🇬🇧 अंग्रेज़ी',
 fr: '🇫🇷 फ़्रेंच',
 zh: '🇨🇳 चीनी',
 hi: '🇮🇳 हिंदी',
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
 continueAtHostbay: ('🚀 सभी सेवाएं अब ' + (process.env.CHAT_BOT_NAME || 'Nomadly Bot') + ' पर उपलब्ध हैं — डोमेन, लीड्स, Cloud IVR, डिजिटल उत्पाद और बहुत कुछ।'),
 redirectMessage: ('🚀 सभी सेवाएं अब ' + (process.env.CHAT_BOT_NAME || 'Nomadly Bot') + ' पर उपलब्ध हैं — डोमेन, लीड्स, Cloud IVR, डिजिटल उत्पाद और बहुत कुछ।'),

 serviceAd: `━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>${(process.env.CHAT_BOT_BRAND || 'Nomadly')}</b> — आपका डिजिटल टूलकिट
━━━━━━━━━━━━━━━━━━━━━━

📞 <b>Cloud IVR + SIP</b>
30+ देशों में वर्चुअल नंबर
IVR ऑटो-अटेंडेंट · SMS · वॉइसमेल · SIP
क्विक IVR और बल्क IVR अभियान

🌐 <b>बुलेटप्रूफ डोमेन</b>
1,000+ TLDs · DMCA-मुक्त ऑफशोर पंजीकरण
DNS प्रबंधन · Anti-Red सुरक्षा

🛡️ <b>Anti-Red होस्टिंग</b>
ऑफशोर HostPanel · साप्ताहिक और मासिक
JS Challenge शील्ड · SSL शामिल

🛒 <b>डिजिटल उत्पाद</b>
Twilio · Telnyx · AWS · Google Cloud
Google Workspace · Zoho Mail · eSIM

💳 <b>वर्चुअल डेबिट कार्ड</b>
तत्काल वर्चुअल कार्ड · विश्वव्यापी उपयोग

🎯 <b>सत्यापित फ़ोन लीड्स</b>
देश, कैरियर और एरिया कोड द्वारा फ़िल्टर
मालिक के नाम सहित प्रीमियम लीड्स

🔗 <b>URL शॉर्टनर</b>
ब्रांडेड लिंक · कस्टम डोमेन · एनालिटिक्स

━━━━━━━━━━━━━━━━━━━━━━
💰 भुगतान: <b>क्रिप्टो · बैंक · वॉलेट</b>
━━━━━━━━━━━━━━━━━━━━━━

🤖 <b>अभी शुरू करें →</b> @${(process.env.BOT_USERNAME || 'Nomadlybot')}
💬 <b>मदद चाहिए?</b> बॉट में सहायता पर टैप करें
📢 <b>अपडेट →</b> ${TG_CHANNEL}`,

 askPreferredLanguage: `🌍 सुनिश्चित करें कि सब कुछ आपकी वरीय भाषा में है, नीचे एक का चयन करें:
 
आप हमेशा बाद में अपनी भाषा सेटिंग्स में बदल सकते हैं।`,
 askValidLanguage: 'कृपया एक मान्य भाषा का चयन करें:',
 settingsMenuText: '⚙️ <b>सेटिंग्स</b>\n\nनीचे अपनी प्राथमिकताएं प्रबंधित करें:',
 welcomeMessage: `👋 ${CHAT_BOT_NAME} में आपका स्वागत है!
हम आपको यहाँ पाकर बहुत खुश हैं! 🎉
चलिए शुरू करते हैं ताकि आप हमारी सभी रोमांचक विशेषताओं का अनुभव कर सकें। 🌟

इस सेटअप को जल्दी और आसानी से पूरा करें—आओ कूदते हैं! 🚀`,
 askUserEmail: 'आपका ईमेल क्या है? हमें आपकी व्यक्तिगत अनुभव को अनुकूलित करने दें! (उदाहरण: davidsen@gmail.com)',
 processUserEmail: `धन्यवाद 😊 हम आपके खाते को अब सेट कर रहे हैं।
कृपया कुछ क्षण प्रतीक्षा करें जब हम विवरण को अंतिम रूप दे रहे हैं। ⏳
 
हम बैकएंड में काम कर रहे हैं। बस कदमों का पालन करें!`,
 confirmUserEmail: `✨ बड़ी खबर! आपका खाता तैयार है! 🎉💃🎉

फ्री ट्रायल अवधि के दौरान प्रीमियम विशेषताओं का आनंद लें!`,
 termsAndCond: `📜 आगे बढ़ने से पहले, कृपया हमारे शर्तें और नीतियाँ समीक्षा और स्वीकृत करें।`,
 acceptTermMsg: `कृपया ${CHAT_BOT_NAME} का उपयोग जारी रखने के लिए शर्तें और नीतियों को स्वीकृत करें।`,
 acceptTermButton: '✅ स्वीकृत करें',
 declineTermButton: '❌ अस्वीकार करें',
 viewTermsAgainButton: '🔄 पुनः देखें शर्तें',
 exitSetupButton: '❌ सेटअप छोड़ें',
 acceptedTermsMsg: `✅ आपने सफलतापूर्वक शर्तें और नीतियाँ स्वीकार की हैं! 🎉
आप ${CHAT_BOT_NAME} का उपयोग शुरू करने के लिए तैयार हैं। चलिए मज़ेदार हिस्से में चलते हैं! 🎯`,
 declinedTermsMsg: `⚠️ आपको ${CHAT_BOT_NAME} का उपयोग जारी रखने के लिए शर्तें और नीतियाँ स्वीकार करनी होंगी। 
जब आप तैयार हों, तो उन्हें पुनः समीक्षा करें।`,
 userExitMsg: 'उपयोगकर्ता ने निकास बटन दबाया।',
 termsAndCondMsg: `<h1>${CHAT_BOT_NAME} उपयोग की शर्तें</h1>
 <p><strong>प्रभावी तिथि:</strong> 01/01/2022</p>
 <p>${CHAT_BOT_NAME} का उपयोग करने का अर्थ है कि आप इन उपयोग की शर्तों को स्वीकार करते हैं।</p>

 <h2>1. शर्तों की स्वीकृति</h2>
 <p>आपकी उम्र 18 वर्ष या उससे अधिक होनी चाहिए, या आपके पास अभिभावक की सहमति होनी चाहिए, और आपको इन शर्तों और हमारी गोपनीयता नीति से सहमत होना होगा।</p>

 <h2>2. प्रदान की जाने वाली सेवाएँ</h2>
 <p>हम डोमेन पंजीकरण, वेब होस्टिंग, और साइट/एप्लिकेशन सेटअप सहायता प्रदान करते हैं।</p>

 <h2>3. उपयोगकर्ता की जिम्मेदारियाँ</h2>
 <p>सटीक जानकारी प्रदान करें, अवैध गतिविधियों से बचें, और अपने Telegram खाते को सुरक्षित रखें।</p>

 <h2>4. भुगतान की शर्तें</h2>
 <p>सभी भुगतान अंतिम हैं जब तक कि अन्यथा उल्लेख न किया गया हो। भुगतान न करने पर सेवाएं निलंबित की जा सकती हैं।</p>

 <h2>5. सेवाओं की सीमाएँ</h2>
 <p>हम संसाधन सीमाएँ लगा सकते हैं या रखरखाव या तकनीकी समस्याओं के कारण सेवा में व्यवधान हो सकता है।</p>

 <h2>6. समाप्ति</h2>
 <p>उल्लंघन या भुगतान न करने की स्थिति में हम सेवाएँ समाप्त कर सकते हैं। उपयोगकर्ता किसी भी समय रद्द कर सकते हैं, लेकिन शुल्क वापस नहीं किया जाएगा।</p>

 <h2>7. जिम्मेदारी</h2>
 <p>सेवाएँ "जैसी हैं" के आधार पर प्रदान की जाती हैं। हम डेटा हानि, व्यवधान, या उपयोगकर्ता सुरक्षा उल्लंघनों के लिए उत्तरदायी नहीं हैं।</p>

 <h2>8. गोपनीयता</h2>
 <p>हम आपके डेटा को हमारी गोपनीयता नीति के अनुसार प्रबंधित करते हैं और केवल कानूनी आवश्यकताओं के अनुसार साझा करते हैं।</p>

 <h2>9. शर्तों में बदलाव</h2>
 <p>हम इन शर्तों को अपडेट कर सकते हैं, और निरंतर उपयोग का मतलब है कि आप इसे स्वीकार करते हैं।</p>

 <h2>10. संपर्क करें</h2>
 <p>सहायता के लिए, कृपया <a href="${APP_SUPPORT_LINK}" target="_blank">${APP_SUPPORT_LINK}</a> पर संपर्क करें।</p>

 <p>${CHAT_BOT_NAME} का उपयोग करने का अर्थ है कि आप इन शर्तों से सहमत हैं। धन्यवाद!</p>`,
}

const termsAndConditionType = lang => ({
 reply_markup: {
 inline_keyboard: [
 [
 {
 text: 'नियम और शर्तें देखें',
 web_app: {
 url: `${SELF_URL}/terms-condition?lang=${lang}`,
 },
 },
 ],
 ],
 },
})

const planOptions = ['दैनिक', 'साप्ताहिक', 'मासिक']
const planOptionsOf = {
 दैनिक: 'Daily',
 साप्ताहिक: 'Weekly',
 मासिक: 'Monthly',
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
 text: 'भुगतान करें',
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
 duration: '7 दिन',
 storage: '10 GB SSD',
 bandwidth: '100 GB',
 domains: '2 डोमेन तक',
 ssl: 'मुफ़्त SSL',
 protection: 'IP क्लोकिंग · बॉट पहचान · UA ब्लॉकिंग',
 panel: 'HostPanel — फ़ाइल, DB और ईमेल प्रबंधन',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 दिन',
 storage: '50 GB SSD',
 bandwidth: '500 GB',
 domains: '6 डोमेन तक',
 ssl: 'मुफ़्त SSL',
 protection: 'IP क्लोकिंग · JS चैलेंज · UA और TLS ब्लॉकिंग',
 panel: 'HostPanel — बैकअप, माइग्रेशन और उन्नत टूल',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 दिन',
 storage: '100 GB SSD',
 bandwidth: 'असीमित',
 domains: 'असीमित डोमेन',
 ssl: 'मुफ़्त SSL + वाइल्डकार्ड',
 protection: 'पूर्ण Anti-Red: IP क्लोकिंग · JS चैलेंज · TLS/JA3 · WAF नियम · प्राथमिकता सहायता',
 panel: 'HostPanel — स्टेजिंग, सुरक्षा और सभी उन्नत टूल',
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
 buyText: 'शानदार चयन! आप डोमेन कैसे जोड़ना चाहते हैं?\n\n🌐 <b>नया डोमेन रजिस्टर करें</b>\n📂 <b>मेरा डोमेन उपयोग करें</b> — अपने पंजीकृत डोमेन में से चुनें\n🔗 <b>बाहरी डोमेन कनेक्ट करें</b> — किसी अन्य स्थान पर स्वामित्व वाला डोमेन उपयोग करें',
 registerNewDomainText: 'कृपया वह डोमेन नाम दर्ज करें जिसे आप पंजीकृत करना चाहते हैं (जैसे, example.com)।',
 domainNotFound:
 'आपके द्वारा दर्ज किया गया डोमेन नहीं मिला। कृपया सुनिश्चित करें कि यह सही है या कोई और कोशिश करें।',
 useExistingDomainText: 'कृपया अपना मौजूदा डोमेन नाम दर्ज करें (जैसे, example.com)।',
 connectExternalDomainText: 'कृपया अपना बाहरी डोमेन दर्ज करें (जैसे, example.com)\n\nसेटअप के बाद, आपको नेमसर्वर Cloudflare की ओर इंगित करने होंगे।',
 useExistingDomainNotFound:
 'आपके द्वारा दर्ज किया गया डोमेन आपके खाते से संबद्ध नहीं है। कृपया जांचें या समर्थन से संपर्क करें।',
 enterYourEmail: 'कृपया अपना ईमेल पता प्रदान करें ताकि हम आपका खाता बना सकें और रसीद भेज सकें।',
 invalidEmail: 'कृपया एक वैध ईमेल प्रदान करें।',
 paymentConfirmation: 'कृपया अपना खरीदारी जारी रखने के लिए लेनदेन की पुष्टि करें।',
 paymentSuccess: `हम आपके भुगतान की पुष्टि कर रहे हैं। जैसे ही यह पुष्टि होगी, आपको सूचित किया जाएगा। धन्यवाद!`,
 paymentFailed: 'भुगतान असफल। कृपया पुनः प्रयास करें।',
 }

 return `${commonSteps[step]}`
 },

 generateDomainFoundText: (websiteName, price, hostingPrice, total, planName) => {
   if (hostingPrice && total) {
     return `✅ <b>${websiteName}</b> उपलब्ध है!\n\n` +
       `🌐 डोमेन: <b>$${price}</b>\n` +
       `🛡️ होस्टिंग${planName ? ` (${planName})` : ''}: <b>$${hostingPrice}</b>\n` +
       `━━━━━━━━━━━━\n` +
       `💰 <b>आज कुल: $${total}</b>`
   }
   return `डोमेन ${websiteName} उपलब्ध है! इसकी लागत $${price} है।`
 },
 generateExistingDomainText: websiteName => `आपने ${websiteName} को अपने डोमेन के रूप में चुना है।`,
 connectExternalDomainText: websiteName => `आप <b>${websiteName}</b> को अपने डोमेन के रूप में जोड़ना चाहते हैं।\n\nखरीदारी के बाद, आपको अपने डोमेन के नेमसर्वर Cloudflare की ओर इंगित करने होंगे।`,
 domainNotFound: websiteName => `डोमेन ${websiteName} उपलब्ध नहीं है।`,
 nameserverSelectionText: websiteName =>
 `कृपया ${websiteName} के लिए आप जिस नेमसर्वर प्रदाता का उपयोग करना चाहते हैं, उसे चुनें।`,
 confirmEmailBeforeProceeding: email => `क्या आप वाकई इस ईमेल ${email} के साथ जारी रखना चाहते हैं?`,

 generateInvoiceText: payload => `
<b>डोमेन पंजीकरण</b>
<b>- डोमेन: </b> ${payload.domainName}
<b>- मूल्य: </b> $${payload?.existingDomain ? '0 (मौजूदा डोमेन का उपयोग)' : payload.domainPrice}
 
<b>वेब होस्टिंग</b>
<b>- अवधि: </b> 1 माह
<b>- मूल्य: </b> $${payload.hostingPrice}
 
<b>कुल देय राशि:</b>
<b>- कूपन छूट: </b> $${payload.couponDiscount}
<b>- USD: </b> $${payload?.couponApplied ? payload.newPrice : payload.totalPrice}
<b>- कर: </b> $0.00
 
<b>भुगतान की शर्तें</b>
यह एक अग्रिम भुगतान चालान है। कृपया सुनिश्चित करें कि भुगतान 1 घंटे के भीतर पूरा हो ताकि आपका डोमेन और होस्टिंग सेवाएं सक्रिय हो सकें। भुगतान प्राप्त होने के बाद, हम आपकी सेवा को सक्रिय करेंगे।
`,

 showCryptoPaymentInfo: (priceUsd, priceCrypto, tickerView, address, plan) => `💰 <b>कुल: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपका ${plan} स्वचालित रूप से सक्रिय हो जाएगा (आमतौर पर कुछ ही मिनटों में)।`,

 successText: (info, response) =>
 `आपकी होस्टिंग लाइव है।

<b>डोमेन:</b> ${info.website_name}
${info.email ? `<b>ईमेल:</b> ${info.email}\n` : ''}DNS Cloudflare के माध्यम से स्वतः कॉन्फ़िगर।`,

 support: (plan, statusCode) => `किसी तकनीकी समस्या का सामना हुआ है ${plan} के साथ | ${statusCode}. 
 कृपया 💬 सहायता प्राप्त करें बटन दबाएं।
 अधिक जानकारी के लिए ${TG_HANDLE}.`,

 bankPayDomain: (
 priceNGN,
 plan,
 ) => `कृपया ${priceNGN} NGN का भुगतान करें और “भुगतान करें” पर क्लिक करें। एक बार लेनदेन की पुष्टि हो जाने पर, आपको तुरंत सूचित कर दिया जाएगा और आपका ${plan} बिना किसी परेशानी के सक्रिय कर दिया जाएगा।

सादर,
${CHAT_BOT_NAME}`,
}

const vpsBC = ['🔙 वापस', 'रद्द करें']

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
 hourly: 'प्रति घंटा',
 monthly: 'मासिक',
 quaterly: 'त्रैमासिक',
 annually: 'वार्षिक',
}

const vpsPlanMenu = ['प्रति घंटा', 'मासिक', 'त्रैमासिक', 'वार्षिक']
const vpsConfigurationMenu = ['मूल', 'मानक', 'प्रीमियम', 'एंटरप्राइज़']
const vpsCpanelOptional = ['WHM', 'Plesk', '❌ कंट्रोल पैनल छोड़ें']

const vpsPlanOf = {
 'प्रति घंटा': 'hourly',
 मासिक: 'monthly',
 त्रैमासिक: 'quaterly',
 वार्षिक: 'annually',
}

// Voice Service translations
const vs = {
  callDisconnectedAutoRouted: (usdBal, lowBalTrigger, lowBalResume) => `🚫 <b>कॉल डिस्कनेक्ट</b> (ऑटो-रूटेड)\n\nवॉलेट: <b>$${usdBal}</b> — $${lowBalTrigger} की सीमा से नीचे।\n💰 कॉल फिर से शुरू करने के लिए कम से कम $${lowBalResume} टॉप-अप करें।`,
  callDisconnectedWalletInsufficient: (rate, connFee) => `🚫 <b>कॉल डिस्कनेक्ट</b> — वॉलेट अपर्याप्त ($${rate}/मिनट + $${connFee} कनेक्ट शुल्क चाहिए)।\n👛 वॉलेट से टॉप-अप करें।`,
  callDisconnectedWalletExhausted: '🚫 <b>कॉल डिस्कनेक्ट</b> — वॉलेट खाली हो गया।\n👛 वॉलेट से टॉप-अप करें।',
  outboundCallFailedRouting: (fromPhone, toPhone) => `🚫 <b>आउटबाउंड कॉल विफल</b>\n📞 ${fromPhone} → ${toPhone}\nकारण: कॉल रूटिंग विफल। कृपया फिर से प्रयास करें।`,
  planMinutesExhausted: (phoneNumber, used, limit) => `⚠️ <b>प्लान मिनट समाप्त</b>\n\n📞 ${phoneNumber}\nइस चक्र में उपयोग: <b>${used}/${limit}</b> मिनट।\n\nअब ओवरेज बिलिंग आपके वॉलेट से सक्रिय है। टॉप-अप करें या प्लान अपग्रेड करें।`,
  callTypeCharge: (callType, minutesBilled, rate, chargedStr, region, discountLine) => `💰 <b>${callType}</b>: ${minutesBilled} मिनट × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  overageCharge: (newOverageMin, rate, chargedStr, region, discountLine) => `💰 <b>ओवरेज</b>: ${newOverageMin} मिनट × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  transferEnded: (forwardPhone, duration, planLine) => `📞 <b>ट्रांसफर समाप्त</b>\n${forwardPhone} — ${duration}\n${planLine}`,
  transferFailed: (forwardPhone, reason) => `❌ <b>ट्रांसफर विफल</b>\n📞 ${forwardPhone} — ${reason}`,
  orphanedNumberAlert: (to, from) => `⚠️ <b>Orphaned Number Alert</b>\n\n📞 <code>${to}</code> received inbound call from <code>${from}</code>\n\n❌ No owner found in DB — call rejected.\nThis number may need to be released or re-assigned.`,
 incomingCallBlockedWalletEmpty: '⚠️ <b>आने वाली कॉल अवरुद्ध</b> — आपका वॉलेट खाली है। कॉल प्राप्त करने के लिए रिचार्ज करें।',
  overageActive: (chargedStr, region, currency) => `💰 <b>ओवरेज सक्रिय</b> — प्लान मिनट समाप्त। ${chargedStr} (${region}) ${currency} वॉलेट से।`,
  callEndedPlanWalletExhausted: (elapsedMin) => `🚫 <b>कॉल समाप्त</b> — प्लान मिनट + वॉलेट दोनों समाप्त।\n⏱️ ~${elapsedMin} मिनट। वॉलेट टॉप-अप करें या प्लान अपग्रेड करें।`,
  incomingCall: (fromPhone, toPhone) => `📞 <b>आने वाली कॉल</b>\n${fromPhone} → ${toPhone}\nआपका SIP डिवाइस बज रहा है...`,
  outboundCallingLocked: '🚫 <b>आउटबाउंड कॉलिंग लॉक</b>\n\n',
 testCallsExpired: '⚠️ आपकी टेस्ट कॉल समाप्त हो गई हैं। जारी रखने के लिए प्लान सब्सक्राइब करें।',
  outboundCallBlocked: (fromPhone, toPhone, status) => `🚫 <b>आउटबाउंड कॉल अवरुद्ध</b>\n📞 ${fromPhone} → ${toPhone}\nकारण: नंबर ${status} है। कृपया रिन्यू करें या सहायता से संपर्क करें।`,
  sipCallBlocked: (sipRate, connFee, region, usdBal, ngnBal) => `🚫 <b>SIP कॉल अवरुद्ध</b> — वॉलेट बैलेंस अपर्याप्त ($${sipRate}/मिनट + $${connFee} कनेक्ट शुल्क ${region} चाहिए)।\nबैलेंस: $${usdBal} / NGN: ₦${ngnBal}\nआउटबाउंड कॉल का बिल वॉलेट से लगता है। 👛 वॉलेट से टॉप-अप करें।`,
  freeSipTestCall: (fromPhone, toPhone, remaining, maxDuration) => `📞 <b>मुफ़्त SIP टेस्ट कॉल</b>\nसे: ${fromPhone}\nकिसे: ${toPhone}\n🆓 मुफ़्त टेस्ट कॉल (${remaining} शेष, अधिकतम ${maxDuration} सेकंड)`,
  sipOutboundCall: (fromPhone, toPhone, walletLine) => `📞 <b>SIP आउटबाउंड कॉल</b>\nसे: ${fromPhone}\nकिसे: ${toPhone}\n${walletLine}`,
  outboundCallFailedTempUnavailable: (fromPhone, toPhone) => `🚫 <b>आउटबाउंड कॉल विफल</b>\n📞 ${fromPhone} → ${toPhone}\nकारण: आउटबाउंड कॉलिंग अस्थायी रूप से अनुपलब्ध है। कृपया बाद में प्रयास करें।`,
  sipOutboundCallWithRate: (fromPhone, toPhone, sipRate, connFeeNote, estMinutes) => `📞 <b>SIP आउटबाउंड कॉल</b>\nसे: ${fromPhone}\nकिसे: ${toPhone}\nदर: $${sipRate}/मिनट${connFeeNote} (~${estMinutes} मिनट उपलब्ध)`,
  lowBalanceForward: (usdBal, estMinutes) => `⚠️ <b>कम बैलेंस</b> — $${usdBal} (~${estMinutes} मिनट फ़ॉरवर्ड)। 👛 वॉलेट से <b>$25</b> टॉप-अप करें।`,
  forwardingBlocked: (usdBal, fwdRate) => `🚫 <b>फ़ॉरवर्डिंग अवरुद्ध</b> — वॉलेट $${usdBal} ($${fwdRate}/मिनट चाहिए)।\n👛 वॉलेट से <b>$25</b> टॉप-अप करें।`,
  ivrForwardBlocked: (fromPhone, forwardPhone, usdBal, ivrFwdRate, region) => `🚫 <b>IVR फ़ॉरवर्ड अवरुद्ध — वॉलेट खाली</b>\n\n📞 ${fromPhone}\n📲 फ़ॉरवर्ड: ${forwardPhone}\n\nवॉलेट $${usdBal} ($${ivrFwdRate}/मिनट ${region} चाहिए)।\n👛 वॉलेट से टॉप-अप करें।`,
  lowBalanceIvrForward: (usdBal, estMinutes) => `⚠️ <b>कम बैलेंस</b> — $${usdBal} (~${estMinutes} मिनट IVR फ़ॉरवर्ड)। 👛 वॉलेट से टॉप-अप करें।`,
  sipCallEndedAutoRouted: (fromPhone, toPhone, duration, minutesBilled, rate) => `📞 <b>SIP कॉल समाप्त</b> (ऑटो-रूटेड)\n\nसे: ${fromPhone}\nकिसे: ${toPhone}\n⏱️ ${duration}\n💰 ${minutesBilled} मिनट × $${rate} बिल किए गए`,
  ivrCallEndedWalletExhausted: (usdBal, ivrCallRate) => `🚫 <b>IVR कॉल समाप्त</b> — वॉलेट खाली ($${usdBal})।\nIVR कॉल की लागत $${ivrCallRate}/मिनट है। 👛 वॉलेट से टॉप-अप करें।`,
  callNotConnected: '📞 <b>कॉल कनेक्ट नहीं हुई</b> — प्राप्तकर्ता व्यस्त था या उसने जवाब नहीं दिया।\n\n🎁 आपकी मुफ़्त ट्रायल कॉल अभी भी उपलब्ध है! कभी भी फिर से प्रयास करें।',
  transferTimeout: (toPhone) => `⏱ <b>ट्रांसफर टाइमआउट</b>\n📞 ${toPhone} ने 30 सेकंड में जवाब नहीं दिया`,
  transferConnected: (targetNumber, ivrNumber) => `✅ <b>ट्रांसफर कनेक्ट</b>\n📞 ${targetNumber} ${ivrNumber} से जुड़ा`,
}

const vp = {
 of: vpsOptionsOf,
 back: '🔙 वापस',
 skip: '❌ छोड़ें',
 cancel: '❌ रद्द करें',

 // VPS/RDP choice (Step 1)
 vpsLinuxBtn: '🐧 Linux VPS (SSH)',
 vpsRdpBtn: '🪟 Windows RDP',
 askVpsOrRdp: `🖥️ आपको किस प्रकार का सर्वर चाहिए?

📬 <b>पोर्ट 25 खुला</b> — अपने सर्वर से सीधे ईमेल भेजें

<strong>🐧 Linux VPS</strong> — SSH एक्सेस · वेब होस्टिंग · डेवलपमेंट · ऑटोमेशन
<strong>🪟 Windows RDP</strong> — रिमोट डेस्कटॉप · विंडोज ऐप्स & टूल्स`,

 askCountryForUser: `🌍 अपने उपयोगकर्ताओं के सबसे नज़दीकी क्षेत्र चुनें:`,
 chooseValidCountry: 'कृपया सूची से एक देश चुनें:',
 askRegionForUser: country => `📍 ${country} में एक डेटा सेंटर चुनें (स्थान के अनुसार मूल्य अलग-अलग हो सकता है।)`,
 chooseValidRegion: 'कृपया सूची से एक मान्य क्षेत्र चुनें:',
 askZoneForUser: region => `📍 ${region} के भीतर एक ज़ोन चुनें।`,

 chooseValidZone: 'कृपया सूची से वैध जोन चुनें:',
 confirmZone: (region, zone) =>
 `✅ आपने ${region} (${zone}) का चयन किया है। क्या आप इस चयन के साथ आगे बढ़ना चाहते हैं?`,
 failedFetchingData: 'डेटा प्राप्त करने में त्रुटि, कृपया कुछ समय बाद पुनः प्रयास करें।',
 confirmBtn: `✅ चयन की पुष्टि करें`,

 askVpsDiskType: list => `💾 <b>स्टोरेज प्रकार चुनें</b>

${list?.some(item => item.pricier) ? 'NVMe थोड़ा महंगा है, लेकिन नए CPU और कहीं तेज़ डिस्क के साथ आता है — SSD किफ़ायती विकल्प है:' : 'दोनों विकल्पों की कीमत समान है — जो आपके लिए ज़रूरी हो वह चुनें:'}

${list?.map(item => `${item.description}`).join('\n\n')}

👇 अपनी पसंद पर टैप करें:`,
 chooseValidDiskType: 'कृपया एक वैध डिस्क प्रकार चुनें',

 askPlanType: plans => `💳 बिलिंग चक्र चुनें:

${plans
 .map(
 item =>
 `<strong>• ${item.type === 'Hourly' ? '⏳' : '📅'} ${({ Hourly: 'प्रति घंटा', Monthly: 'मासिक' })[item.type] || item.type.replace(/(\d+) Months/, '$1 महीने')} –</strong> $${item.originalPrice} ${
 item.discount === 0 ? '(कोई छूट नहीं)' : `(${item.discount}% छूट शामिल है)`
 }`,
 )
 .join('\n')}`,

 planTypeMenu: vpsOptionsOf(vpsPlanMenu),
 // Billing (Monthly only)
 hourlyBillingMessage: '',

 askVpsConfig: (list, extras = {}) => {
  const { walletUsd, cheapestName, socialProof } = extras
  const plans = list.map(config => {
   const star = config.name === cheapestName ? '🌟 ' : ''
   const line = `<strong>• ${star}${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB ${config.specs.diskType} — $${config.monthlyPrice}/माह`
   const hw = config.hardware || (config.isRDP ? '⚡ Premium AMD · NVMe SSD' : '')
   return hw ? `${line}\n   <i>${hw}</i>` : line
  }).join('\n')

  let walletLine = ''
  if (typeof walletUsd === 'number') {
   const sorted = [...list].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice))
   const affordable = sorted.filter(p => Number(p.monthlyPrice) <= walletUsd)
   if (affordable.length) {
    const top = affordable[affordable.length - 1]
    walletLine = `\n\n💰 <b>आपका वॉलेट:</b> $${walletUsd.toFixed(2)} — आप <b>${top.name}</b> तक खरीद सकते हैं ✅`
   } else {
    const cheapest = sorted[0]
    const topUp = (Number(cheapest.monthlyPrice) - walletUsd).toFixed(2)
    walletLine = `\n\n💰 <b>आपका वॉलेट:</b> $${walletUsd.toFixed(2)} — <b>${cheapest.name}</b> अनलॉक करने के लिए <b>$${topUp}</b> और जोड़ें`
   }
  }

  const proofLine = socialProof ? `\n\n${socialProof}` : ''
  const header = (Array.isArray(list) && list.some(c => c.isRDP))
   ? '🪟 एक Windows RDP योजना चुनें <i>(Windows Server + रिमोट डेस्कटॉप, लाइसेंस शामिल)</i>:'
   : '⚙️ एक Linux VPS योजना चुनें:'
  return `${header}\n\n${plans}${proofLine}${walletLine}`
 },

 validVpsConfig: 'कृपया एक वैध VPS कॉन्फ़िगरेशन चुनें:',

 configMenu: vpsOptionsOf(vpsConfigurationMenu),

 askForCoupon:
 '🎟️ क्या आपके पास कूपन कोड है? यदि लागू हो तो इसे अतिरिक्त छूट के लिए दर्ज करें, या इस चरण को छोड़ दें। कोई भी बिलिंग चक्र छूट पहले से ही शामिल है।',
 couponInvalid: `❌ अमान्य: कोड समाप्त हो गया है, लागू नहीं है या गलत है। कृपया पुनः प्रयास करें।`,
 couponValid: amt => `✅ वैध: छूट लागू की गई: -$${amt}।`,
 skipCouponwarning: `⚠️ छोड़ने का मतलब है कि आप बाद में छूट लागू नहीं कर सकते।`,
 confirmSkip: '✅ छोड़ने की पुष्टि करें',
 goBackToCoupon: '❌ वापस जाएं और कूपन लागू करें',

 askVpsOS: () => `💻 एक Linux डिस्ट्रो चुनें (डिफ़ॉल्ट: Ubuntu):

<strong>💡 अनुशंसित:</strong>
<strong>• Ubuntu</strong> — सामान्य उपयोग & विकास
<strong>• AlmaLinux / Rocky</strong> — एंटरप्राइज़ स्थिरता
<strong>• Debian</strong> — हल्का & विश्वसनीय`,
 chooseValidOS: `कृपया उपलब्ध सूची से एक वैध OS चुनें:`,
 skipOSBtn: '❌ OS चयन छोड़ें',
 skipOSwarning:
 '⚠️ आपका VPS बिना OS के लॉन्च होगा। आपको इसे मैन्युअली SSH या रिकवरी मोड के माध्यम से इंस्टॉल करना होगा।',

 askVpsCpanel: `🛠️ आसान सर्वर प्रबंधन के लिए एक नियंत्रण पैनल चुनें (वैकल्पिक)।

<strong>• ⚙️ WHM –</strong> कई वेबसाइटों की होस्टिंग के लिए अनुशंसित
<strong>• ⚙️ Plesk –</strong> व्यक्तिगत वेबसाइटों और अनुप्रयोगों के प्रबंधन के लिए उपयुक्त
<strong>• ❌ छोड़ें –</strong> कोई नियंत्रण पैनल नहीं`,

 cpanelMenu: vpsOptionsOf(vpsCpanelOptional),
 noControlPanel: vpsCpanelOptional[2],
 skipPanelMessage: '⚠️ कोई नियंत्रण पैनल स्थापित नहीं किया जाएगा। आप इसे बाद में मैन्युअल रूप से जोड़ सकते हैं।',
 validCpanel: 'कृपया एक मान्य नियंत्रण पैनल चुनें या इसे छोड़ दें।',

 askCpanelOtions: (name, list) => `⚙️ एक ${name == 'whm' ? 'WHM' : 'Plesk Web Host Edition'} लाइसेंस चुनें या ${
 name == 'whm' ? '15' : '7'
 } दिनों के लिए एक निःशुल्क परीक्षण का चयन करें।

💰 ${name == 'whm' ? 'WHM' : 'Plesk'} लाइसेंस मूल्य निर्धारण:

${list.map(item => `${name == 'whm' ? `<strong>• ${item.name} - </strong>` : ''}${item.label}`).join('\n')}`,

 trialCpanelMessage: panel =>
 `✅ ${panel.name == 'whm' ? 'WHM' : 'Plesk'} निःशुल्क परीक्षण (${
 panel.duration
 } दिन) सक्रिय किया गया। आप किसी भी समय समर्थन से संपर्क करके अपग्रेड कर सकते हैं।`,

 vpsWaitingTime: '⚙️ विवरण प्राप्त कर रहे हैं... इसमें बस एक क्षण लगेगा।',
 failedCostRetrieval: 'लागत जानकारी प्राप्त करने में विफल... कृपया कुछ समय बाद पुनः प्रयास करें।',

 errorPurchasingVPS: (plan, isRDP) => `कुछ गलत हो गया जब आप अपना ${plan} ${isRDP ? 'RDP' : 'VPS'} योजना सेटअप कर रहे थे।

कृपया सहायता के लिए 💬 सहायता प्राप्त करें बटन दबाएं।
अधिक जानने के लिए ${TG_HANDLE} पर जाएं।`,

 generateBillSummary: vpsDetails => {
 const planPrice = vpsDetails.couponApplied ? vpsDetails.planNewPrice : vpsDetails.plantotalPrice
 const total = vpsDetails.totalPrice || Number(planPrice).toFixed(2)
 const isRDP = vpsDetails.isRDP
 const months = Number(vpsDetails.durationMonths) || 1
 const osLabel = isRDP
 ? (vpsDetails.os?.id ? `🪟 ${vpsDetails.os.name}${vpsDetails.os.fastDeploy ? ' ⚡ ~3 मिनट में तैयार' : ''}` : '🪟 Windows Server (RDP)')
 : (vpsDetails.os?.name || 'Ubuntu')
 const planEmoji = isRDP ? '🪟' : '🐧'
 const planKind = isRDP ? (/RDP/i.test(String(vpsDetails.config.name)) ? '' : ' <i>(Windows RDP)</i>') : ' <i>(Linux VPS)</i>'
 
 let summary = `<strong>📋 ऑर्डर सारांश:</strong>

<strong>${planEmoji} ${vpsDetails.config.name}</strong>${planKind} — ${vpsDetails.config.specs.vCPU} vCPU · ${vpsDetails.config.specs.RAM}GB RAM · ${vpsDetails.config.specs.disk}GB ${vpsDetails.config.specs.diskType}
${vpsDetails.config.hardware ? `<strong>⚙️ हार्डवेयर:</strong> ${vpsDetails.config.hardware}\n` : ''}<strong>📍 क्षेत्र:</strong> ${vpsDetails.regionName || vpsDetails.country}
<strong>💻 OS:</strong> ${osLabel}`

 if (isRDP) {
 summary += `\n<strong>🪟 Windows लाइसेंस:</strong> शामिल`
 }
 if (isRDP || months > 1) {
 summary += `\n<strong>📅 अवधि:</strong> ${months === 1 ? '1 महीना' : `${months} महीने (प्रीपेड)`}`
 }
 if (vpsDetails.couponApplied && vpsDetails.couponDiscount > 0) {
 summary += `\n<strong>🎟️ कूपन:</strong> -$${Number(vpsDetails.couponDiscount).toFixed(2)} USD`
 }
 summary += `\n<strong>🔄 ऑटो-रिन्यूअल:</strong> ✅ सक्षम`
 summary += `\n\n<strong>💰 कुल: $${total} USD${months > 1 ? ` / ${months} महीने` : '/माह'}</strong>`
 summary += `\n\n<strong>✅ क्या आप ऑर्डर जारी रखना चाहते हैं?</strong>`
 return summary
 },
 no: '❌ आदेश रद्द करें',
 yes: '✅ आदेश की पुष्टि करें',

 askPaymentMethod: 'भुगतान विधि चुनें:',

 showDepositCryptoInfoVps: (priceUsd, priceCrypto, tickerView, address, vpsDetails) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपका ${vpsDetails?.isRDP ? 'Windows RDP' : 'VPS'} स्वचालित रूप से सक्रिय हो जाएगा (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,

 extraMoney: 'आपकी घंटे की योजना के लिए शेष राशि आपके वॉलेट में जमा कर दी गई है।',
 paymentRecieved: (isRDP = false) => `✅ भुगतान सफल!

आपका ${isRDP ? 'RDP' : 'VPS'} सेटअप हो रहा है — इसमें थोड़ा समय लगेगा।
आपके लॉगिन विवरण यहीं इस चैट में दिखाई देंगे।`,
 paymentFailed: `❌ भुगतान विफल। कृपया अपनी भुगतान विधि जांचें या पुनः प्रयास करें।`,

 lowWalletBalance: vpsName => `
आपकी VPS योजना उदाहरण ${vpsName} को कम बैलेंस के कारण रोक दिया गया है।

कृपया अपनी वॉलेट को टॉप-अप करें ताकि आप अपनी VPS योजना का उपयोग जारी रख सकें।`,

 vpsBoughtSuccess: (vpsDetails, response, credentials) => {
 const isRDP = response.isRDP || vpsDetails.isRDP || response.osType === 'Windows'
 const connectInfo = isRDP
 ? `<strong>🔗 कनेक्ट:</strong> 🖥 रिमोट डेस्कटॉप (mstsc) → <code>${response.host}:3389</code>`
 : `<strong>🔗 कनेक्ट:</strong> 💻 <code>ssh ${credentials.username}@${response.host}</code>`

 const readinessNote = isRDP
 ? `\n⏱ <b>5–10 मिनट दें</b> Windows के पहले बूट के लिए। ⚠️ <b>अभी अपना पासवर्ड सहेजें</b> — इसे बाद में प्राप्त नहीं किया जा सकता (खो जाने पर RDP प्रबंधन में "पासवर्ड रीसेट करें" का उपयोग करें)।`
 : `\n⏱ <b>2–5 मिनट दें</b> पहले बूट सेटअप के लिए। ⚠️ <b>अपने क्रेडेंशियल सुरक्षित रूप से सहेजें।</b>`

 return `<strong>🎉 ${isRDP ? 'RDP' : 'VPS'} [${response.label}] सक्रिय हो गया!</strong>

<strong>🔑 लॉगिन विवरण:</strong>
 <strong>• IP:</strong> <code>${response.host}</code>
 <strong>• OS:</strong> ${vpsDetails.os ? vpsDetails.os.name : (isRDP ? 'Windows Server' : 'Linux')}
 <strong>• उपयोगकर्ता नाम:</strong> <code>${credentials.username}</code>
 <strong>• पासवर्ड:</strong> <tg-spoiler><code>${credentials.password}</code></tg-spoiler> (दिखाने व कॉपी के लिए टैप करें)

${connectInfo}
${readinessNote}

${CHAT_BOT_NAME}`
 },
 vpsHourlyPlanRenewed: (vpsName, price) => `
आपकी VPS योजना उदाहरण ${vpsName} को सफलतापूर्वक नवीनीकरण किया गया है।
${price}$ आपके वॉलेट से काटे गए हैं।`,

 vpsMonthlyPlanRenewed: (vpsName, planPrice) =>
 `✅ आपका VPS <b>${vpsName}</b> 1 महीने के लिए स्वचालित रूप से नवीनीकृत हो गया है।\n💰 $${planPrice} वॉलेट से काटे गए।`,

 vpsExpiredNoAutoRenew: (vpsName) =>
 `⚠️ आपका VPS <b>${vpsName}</b> समाप्त हो गया है। स्वचालित नवीनीकरण अक्षम है।\nकृपया सेवा जारी रखने के लिए मैन्युअल रूप से नवीनीकृत करें।`,

 bankPayVPS: (
 priceNGN,
 plan,
 ) => `कृपया “भुगतान करें” पर क्लिक करके ${priceNGN} NGN भेजें। एक बार लेन-देन की पुष्टि हो जाने पर, आपको तुरंत सूचित किया जाएगा और आपकी ${plan} VPS योजना सक्रिय हो जाएगी।

सादर,
${CHAT_BOT_NAME}`,

 askAutoRenewal: `🔄 निर्बाध सेवा के लिए ऑटो-नवीनीकरण सक्षम करें? 

🛑 नवीनीकरण से पहले आपको एक अनुस्मारक मिलेगा। आप इसे किसी भी समय अक्षम कर सकते हैं।`,
 enable: '✅ सक्षम करें',
 skipAutoRenewalWarming: expiresAt =>
 `⚠️ आपका VPS ${new Date(expiresAt).toLocaleDateString('hi-IN').replace(/\//g, '-')} को ${new Date(
 expiresAt,
 ).toLocaleTimeString('hi-IN', {
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
 })} पर समाप्त हो जाएगा, और सेवा बाधित हो सकती है।`,

 generateSSHKeyBtn: '✅ नई कुंजी जेनरेट करें',
 linkSSHKeyBtn: '🗂️ मौजूदा कुंजी लिंक करें',
 skipSSHKeyBtn: '❌ छोड़ें (पासवर्ड लॉगिन का उपयोग करें)',
 noExistingSSHMessage:
 '🔑 कोई SSH कुंजी नहीं मिली। क्या आप सुरक्षित पहुंच के लिए एक नई SSH कुंजी बनाना चाहते हैं, या पासवर्ड लॉगिन (कम सुरक्षित) का उपयोग करना चाहते हैं?',
 existingSSHMessage: '🔑 आपके पास मौजूदा SSH कुंजियाँ हैं। कोई विकल्प चुनें:',
 confirmSkipSSHMsg: `⚠️ चेतावनी: पासवर्ड लॉगिन कम सुरक्षित है और हमलों के लिए संवेदनशील हो सकता है।
🔹 हम SSH कुंजी का उपयोग करने की अत्यधिक अनुशंसा करते हैं। क्या आप वाकई जारी रखना चाहते हैं?`,
 confirmSkipSSHBtn: '✅ फिर भी जारी रखें',
 setUpSSHBtn: '🔄 SSH कुंजी सेटअप करें',
 sshLinkingSkipped: '❌ SSH कुंजी लिंकिंग छोड़ दी गई। कोई परिवर्तन नहीं किया गया।',
 newSSHKeyGeneratedMsg: name => `✅ SSH कुंजी (${name}) बनाई गई।
⚠️ इस कुंजी को सुरक्षित रूप से सहेजें – इसे बाद में भी पुनः प्राप्त किया जा सकता है।`,
 selectSSHKey: '🗂️ अपने VPS से लिंक करने के लिए मौजूदा SSH कुंजी चुनें:',
 uploadNewKeyBtn: '➕ नई कुंजी अपलोड करें',
 cancelLinkingSSHKey: `❌ SSH कुंजी लिंकिंग रद्द कर दी गई। कोई परिवर्तन नहीं किया गया।`,
 selectValidSShKey: 'कृपया सूची से एक वैध SSH कुंजी चुनें।',
 sshKeySavedForVPS: name => `✅ SSH कुंजी (${name}) नए VPS से लिंक की जाएगी।`,
 askToUploadSSHKey: `📤 अपनी SSH सार्वजनिक कुंजी (.pub फ़ाइल) अपलोड करें या नीचे कुंजी पेस्ट करें।`,
 failedGeneratingSSHKey: 'नई SSH कुंजी बनाने में विफल। कृपया पुनः प्रयास करें या कोई अन्य विधि आज़माएँ।',
 newSSHKeyUploadedMsg: name => `✅ SSH कुंजी (${name}) सफलतापूर्वक अपलोड की गई और VPS से लिंक की जाएगी।`,
 fileTypePub: 'फ़ाइल प्रकार .pub होना चाहिए',

 vpsList: list => `<strong>🖥️ आपके सर्वर:</strong>

${list
 .map(vps => `<strong>• ${vps.isRDP || vps.osType === 'Windows' ? '🪟' : '🐧'} ${vps.name}</strong> <i>(${vps.isRDP || vps.osType === 'Windows' ? 'Windows RDP' : 'Linux VPS'})</i> — ${String(vps.status || '').toUpperCase() === 'RUNNING' ? '🟢' : '🔴'} ${vps.status}`)
 .join('\n')}
`,
 noVPSfound: 'आपके पास अभी कोई सर्वर नहीं है। नीचे 🐧 Linux VPS या 🪟 Windows RDP बनाएँ।',
 selectCorrectOption: 'कृपया सूची में से एक विकल्प चुनें',
 selectedVpsData: data => {
 const isRDP = !!(data.isRDP || data.osType === 'Windows')
 const port = isRDP ? 3389 : 22
 const loginUser = data.defaultUser || (isRDP ? 'Administrator' : 'root')
 const running = String(data.status || '').toUpperCase() === 'RUNNING'
 const months = Number(data.durationMonths) || 1
 const panelLine = isRDP ? '' : `\n<strong>• नियंत्रण पैनल:</strong> ${data.cPanelPlanDetails && data.cPanelPlanDetails.type ? data.cPanelPlanDetails.type : 'कोई नहीं'}`
 const billingLine = isRDP ? `\n<strong>• बिलिंग:</strong> ${months === 1 ? 'मासिक' : `${months} महीने (प्रीपेड)`} · Windows लाइसेंस शामिल` : ''
 return `<strong>${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'}:</strong> ${data.name}

<strong>• योजना:</strong> ${data.planDetails.name}
<strong>• vCPUs:</strong> ${data.planDetails.specs.vCPU} | RAM: ${data.planDetails.specs.RAM} GB | डिस्क: ${data.planDetails.specs.disk} GB (${data.diskTypeDetails.type})${data.hardware ? `\n<strong>• हार्डवेयर:</strong> ${data.hardware}` : ''}
<strong>• OS:</strong> ${data.osDetails.name}${panelLine}${billingLine}
<strong>• स्थिति:</strong> ${running ? '🟢' : '🔴'} ${data.status}
<strong>• स्वचालित नवीनीकरण:</strong> ${data.autoRenewable ? 'सक्षम' : 'अक्षम'}

<b>🔌 कनेक्ट कैसे करें</b>
<strong>• आईपी पता:</strong> <code>${data.host}</code>
<strong>• ${isRDP ? 'RDP पोर्ट' : 'SSH पोर्ट'}:</strong> <code>${port}</code>
<strong>• उपयोगकर्ता नाम:</strong> <code>${loginUser}</code>${isRDP ? `
<strong>• रिमोट डेस्कटॉप:</strong> <code>${data.host}:${port}</code>` : `
<strong>• कमांड:</strong> <code>ssh ${loginUser}@${data.host} -p ${port}</code>`}`
 },
 stopVpsBtn: '⏹️ रोकें',
 startVpsBtn: '▶️ शुरू करें',
 restartVpsBtn: '🔄 पुनः प्रारंभ करें',
 deleteVpsBtn: '🗑️ हटाएं',
 subscriptionBtn: '🔄 सदस्यता',
 VpsLinkedKeysBtn: '🔑 SSH कुंजी',
 resetPasswordBtn: '🔑 पासवर्ड रीसेट करें',
 revealPasswordBtn: '🔐 पासवर्ड दिखाएं',
 revealPasswordChecking: name => `🔐 <strong>${name}</strong> के लिए वर्तमान पासवर्ड ढूंढ रहे हैं...

⏱️ बस कुछ सेकंड — हम आपके लिए लॉगिन भी जांचते हैं।`,

 revealPasswordSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const v = opts.verification || null
   let statusLine = ''
   if (v && v.status === 'ok') {
     statusLine = '\n✅ <b>हमने अभी इस पासवर्ड से लॉगिन किया — यह काम करता है।</b>'
   } else if (v && v.status === 'password_wrong') {
     statusLine = '\n⚠️ <b>यह पासवर्ड आपके सर्वर द्वारा अस्वीकार कर दिया गया।</b> नया सेट करने के लिए <b>🔑 पासवर्ड रीसेट करें</b> दबाएं — यह तुरंत लागू होता है और आपका डेटा सुरक्षित रहता है।'
   } else if (v && v.status === 'password_auth_disabled') {
     statusLine = '\n⚠️ <b>आपका सर्वर अभी पासवर्ड लॉगिन अस्वीकार कर रहा है</b> (केवल SSH कुंजी)। <b>🔑 पासवर्ड रीसेट करें</b> दबाएं — यह पासवर्ड लॉगिन फिर से सक्षम करता है और आपको नया पासवर्ड देता है।'
   } else if (v && v.status === 'unreachable') {
     statusLine = '\n💤 हम इस पासवर्ड को जांचने के लिए आपके सर्वर तक नहीं पहुंच सके। यदि यह काम न करे, तो <b>🔑 पासवर्ड रीसेट करें</b> दबाएं।'
   }
   const recoveredLine = opts.recovered
     ? '\n\n♻️ <i>आपके सर्वर के मूल सेटअप से पुनर्प्राप्त — सहेजा गया ताकि अगली बार तुरंत लोड हो।</i>'
     : ''
   const rdpLine = opts.rdpState === 'confirmed' ? '\n✅ <b>आपके RDP ने पुष्टि की है कि यह पासवर्ड लागू है।</b>'
     : opts.rdpState === 'applying' ? `\n⏳ <b>Windows अभी सेट हो रहा है</b> — सेटअप पूरा होने पर यह पासवर्ड काम करने लगेगा${opts.etaMinutes ? ` (लगभग ${opts.etaMinutes} मिनट)` : ''}। तब फिर से प्रयास करें।`
     : opts.rdpState === 'boot' ? '\nℹ️ <b>रीइंस्टॉल का नया पासवर्ड लागू नहीं हो सका</b>, इसलिए Windows अभी भी यही पासवर्ड इस्तेमाल कर रहा है। नया पासवर्ड चाहिए तो <b>🔑 पासवर्ड रीसेट करें</b> दबाएं।'
     : ''
   return `🔐 <strong>वर्तमान VPS पासवर्ड</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'सर्वर'}:</strong> ${name}
🌐 <strong>IP:</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'RDP पोर्ट' : 'SSH पोर्ट'}:</strong> <code>${port}</code>
👤 <strong>उपयोगकर्ता नाम:</strong> <code>${username}</code>
🔑 <strong>पासवर्ड:</strong> <code>${password}</code>

📋 <strong>कनेक्ट करें:</strong> <code>${isRDP ? `${ip}:${port}` : `ssh ${username}@${ip} -p ${port}`}</code>${statusLine}${rdpLine}${recoveredLine}

💡 पासवर्ड को कॉपी करने के लिए क्लिक करें। इसे निजी रखें — जिसके पास यह है उसे पूरा एक्सेस मिल जाता है।`
 },

 revealPasswordNotApplied: name => `🔐 <strong>पासवर्ड रीसेट करना होगा</strong>

<strong>${name}</strong> पर Windows शुरू हो गया, लेकिन सहेजा गया पासवर्ड उस पर लागू नहीं हो सका — इसलिए वह काम नहीं करेगा।

✅ <strong>क्या करें:</strong> <b>🔑 पासवर्ड रीसेट करें</b> दबाएं। यह लगभग एक मिनट में आपके चल रहे RDP पर एक बिल्कुल नया पासवर्ड सेट करता है — <b>आपकी फाइलें और डेटा सुरक्षित रहते हैं</b>।`,

 revealPasswordNotStored: (name, reason) => `🔐 <strong>पासवर्ड उपलब्ध नहीं</strong>

हम <strong>${name}</strong> के लिए वर्तमान पासवर्ड प्राप्त नहीं कर सके।

📋 <i>कारण: ${reason || 'इस सर्वर के लिए कोई सहेजा हुआ पासवर्ड नहीं'}</i>

✅ <strong>क्या करें:</strong> <b>🔑 पासवर्ड रीसेट करें</b> दबाएं। यह लगभग एक मिनट में आपके <b>चल रहे</b> सर्वर पर एक बिल्कुल नया पासवर्ड सेट करता है — <b>आपकी फाइलें और डेटा सुरक्षित रहते हैं</b> — और हम आपको नया पासवर्ड यहां दिखाते हैं और पुष्टि करते हैं कि यह काम करता है।`,

 revealPasswordFailed: name => `❌ <strong>पासवर्ड ढूंढ नहीं सके</strong>

<strong>${name}</strong> के लिए पासवर्ड प्राप्त करते समय कुछ गलत हो गया।

कृपया कुछ देर में पुनः प्रयास करें, या नया सेट करने के लिए <b>🔑 पासवर्ड रीसेट करें</b> दबाएं।`,
 reinstallWindowsBtn: '🔄 Windows पुनः स्थापित करें',
 confirmChangeBtn: '✅ पुष्टि करें',

 confirmStopVpstext: name => `⚠️ क्या आप वास्तव में VPS <strong>${name}</strong> को रोकना चाहते हैं?`,
 vpsBeingStopped: name => `⚙️ कृपया प्रतीक्षा करें, आपका VPS (${name}) रोका जा रहा है`,
 vpsStopped: name => `✅ VPS (${name}) रोक दिया गया है।`,
 failedStoppingVPS: name => `❌ VPS (${name}) को रोकने में विफल।

कृपया कुछ समय बाद पुनः प्रयास करें।`,
 vpsBeingStarted: name => `⚙️ कृपया प्रतीक्षा करें, आपका VPS (${name}) शुरू किया जा रहा है`,
 vpsStarted: name => `✅ VPS (${name}) अब चल रहा है।`,
 failedStartedVPS: name => `❌ VPS (${name}) को शुरू करने में विफल।

कृपया कुछ समय बाद पुनः प्रयास करें।`,
 vpsBeingRestarted: name => `⚙️ कृपया प्रतीक्षा करें, आपका VPS (${name}) पुनः प्रारंभ किया जा रहा है`,
 vpsRestarted: name => `✅ VPS (${name}) सफलतापूर्वक पुनः प्रारंभ हो गया है।`,
 failedRestartingVPS: name => `❌ VPS (${name}) को पुनः प्रारंभ करने में विफल।

कृपया कुछ समय बाद पुनः प्रयास करें।`,
 confirmDeleteVpstext: name =>
 `⚠️ चेतावनी: इस VPS ${name} को हटाना स्थायी है, और सभी डेटा खो जाएगा।
 • अप्रयुक्त सदस्यता समय के लिए कोई धनवापसी नहीं।
 • स्वत: नवीनीकरण रद्द कर दिया जाएगा, और कोई अतिरिक्त शुल्क लागू नहीं होगा।
 
क्या आप आगे बढ़ना चाहते हैं?`,

 confirmResetPasswordText: (name, impact = {}) => {
   const mode = impact.mode || 'in-place'
   const head = `🔑 <strong>${impact.isRDP ? 'RDP' : 'VPS'} पासवर्ड रीसेट करें</strong>

🖥️ <strong>सर्वर:</strong> ${name}
`
   const nudge = `
💡 <i>सिर्फ पासवर्ड भूल गए? ❌ रद्द करें → <b>🔐 पासवर्ड दिखाएं</b> — रीसेट की आवश्यकता नहीं।</i>

क्या आप <strong>${name}</strong> के लिए पासवर्ड रीसेट करना चाहते हैं?`

   if (mode === 'reinstall') return head + `
⚠️ <strong>यह सर्वर को मिटा देता है।</strong> यह प्रदाता चालू मशीन पर पासवर्ड नहीं बदल सकता, इसलिए OS पुनः स्थापित किया जाता है — सभी फाइलें, वेबसाइट, डेटाबेस और सेटिंग्स स्थायी रूप से हटा दी जाती हैं।

• आपको एक बिल्कुल नए पासवर्ड के साथ नई इंस्टॉलेशन मिलती है
• आपका वर्तमान पासवर्ड काम करना बंद कर देता है
• 💾 यदि आपको डेटा चाहिए तो पहले बैकअप/स्नैपशॉट लें
` + nudge

   if (mode === 'rebuild-emailed') return head + `
⚠️ <strong>यह सर्वर को मिटा देता है</strong> और नया पासवर्ड <b>प्रदाता द्वारा ईमेल किया जाता है</b> — हम इसे यहां नहीं दिखा सकते।

• OS पुनर्निर्मित होता है: सभी फाइलें और डेटा स्थायी रूप से हटा दिए जाते हैं
• प्रदाता होस्टिंग खाते पर नया पासवर्ड ईमेल करता है (~5 मिनट)
• तुरंत एक्सेस के लिए, अपनी SSH कुंजी का उपयोग करें
` + nudge

   return head + `
✅ <strong>आपका डेटा सुरक्षित रहता है।</strong> कुछ भी नहीं मिटाया जाता — आपकी फाइलें, वेबसाइट, डेटाबेस और सेटिंग्स बिल्कुल वैसी ही रहती हैं। हम केवल <b>चल रहे</b> सर्वर पर लॉगिन पासवर्ड बदलते हैं (कोई पुनर्स्थापना नहीं, कोई रीबूट नहीं)।

• एक बिल्कुल नया पासवर्ड बनाया जाता है और यहीं दिखाया जाता है
• हम इसे लागू करते हैं, फिर इससे लॉगिन करके पुष्टि करते हैं कि यह काम करता है
• आपका वर्तमान पासवर्ड काम करना बंद कर देता है
• ⏱️ लगभग 20-60 सेकंड लगते हैं
` + nudge
 },

 confirmReinstallWindowsText: name => `🔄 <strong>Windows पुनः स्थापित करें</strong>

⚠️ <strong>गंभीर चेतावनी:</strong>
• यह आपके RDP पर सभी डेटा मिटा देगा
• सभी फाइलें, प्रोग्राम और सेटिंग्स हटा दी जाएंगी
• एक नया Windows इंस्टॉलेशन बनाया जाएगा
• नए क्रेडेंशियल उत्पन्न किए जाएंगे
• आपका पुराना पासवर्ड अब काम नहीं करेगा

💾 <strong>सिफारिश:</strong> आगे बढ़ने से पहले बैकअप/स्नैपशॉट बनाएं।

क्या आप <strong>${name}</strong> पर Windows पुनः स्थापित करना चाहते हैं?`,

 passwordResetInProgress: (name, impact = {}) => `🔄 <strong>${name}</strong> के लिए पासवर्ड रीसेट किया जा रहा है...

⏱️ इसमें आमतौर पर 20-60 सेकंड लगते हैं। कृपया प्रतीक्षा करें।${
   (impact.mode || 'in-place') === 'in-place'
     ? `

🔒 <i>नया पासवर्ड आपके चल रहे सर्वर पर लागू किया जाता है — आपका डेटा बरकरार रहता है।</i>`
     : ''
 }`,

 passwordResetSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const dataPreserved = opts.dataPreserved !== false
   return `✅ <strong>पासवर्ड सफलतापूर्वक रीसेट हो गया!</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'सर्वर'}:</strong> ${name}
🌐 <strong>IP:</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'RDP पोर्ट' : 'SSH पोर्ट'}:</strong> <code>${port}</code>
👤 <strong>उपयोगकर्ता नाम:</strong> <code>${username}</code>
🔑 <strong>नया पासवर्ड:</strong> <code>${password}</code>
${isRDP ? `\n📋 <strong>कनेक्ट करें:</strong> <code>${ip}:${port}</code>` : `\n📋 <strong>कनेक्ट करें:</strong> <code>ssh ${username}@${ip} -p ${port}</code>`}
${opts.verified ? '\n✅ हमने इस पासवर्ड से लॉगिन करके पुष्टि की कि यह काम करता है।' : ''}
${dataPreserved
   ? '💾 <strong>आपके डेटा को छुआ नहीं गया</strong> — पासवर्ड चल रहे सर्वर पर बदला गया।'
   : '⚠️ <strong>OS पुनः स्थापित किया गया</strong>, इसलिए सर्वर पर पिछला डेटा चला गया।'}

⚠️ <strong>आपका पुराना पासवर्ड अब काम नहीं करता।</strong>

🔐 बाद में यह भी खो गया? अपने VPS पर <b>पासवर्ड दिखाएं</b> दबाएं — आप इसे कभी भी देख सकते हैं, रीसेट की आवश्यकता नहीं।

💡 पासवर्ड को कॉपी करने के लिए क्लिक करें।`
 },

 passwordResetEmailed: (name, ip, username, note) => `✅ <strong>पासवर्ड रीसेट शुरू किया गया!</strong>

🖥️ <strong>सर्वर:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>उपयोगकर्ता:</strong> ${username}

📧 ${note || 'प्रदाता ने नया पासवर्ड खाते के ईमेल पर भेज दिया है (~5 मिनट)।'}

🔑 <strong>तुरंत एक्सेस के लिए, अपनी SSH कुंजी का उपयोग करें।</strong>

⚠️ <i>ध्यान दें: इस प्रदाता के साथ हम यहाँ पासवर्ड नहीं दिखा सकते — यह ईमेल द्वारा भेजा जाता है या आप अपनी SSH कुंजी से लॉगिन करते हैं।</i>`,

 windowsReinstallEmailed: (name, ip, username, note) => `🎉 <strong>Windows पुनः स्थापना शुरू!</strong>

🖥️ <strong>RDP:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>उपयोगकर्ता:</strong> ${username}

⏱️ इसमें 5-10 मिनट लगते हैं। ${note || 'नया Administrator पासवर्ड प्रदाता द्वारा खाते के ईमेल पर भेजा जाएगा।'}

⚠️ पिछला सारा डेटा मिटा दिया गया है — यह एक नई Windows स्थापना है।`,

 windowsReinstallInProgress: name => `🔄 <strong>${name}</strong> पर Windows पुनः स्थापित किया जा रहा है...

⏱️ इस प्रक्रिया में 5-10 मिनट लगते हैं।
📧 पूर्ण होने पर आपको नए क्रेडेंशियल प्राप्त होंगे।`,

 windowsReinstallSuccess: (name, ip, username, password) => `🎉 <strong>Windows सफलतापूर्वक पुनः स्थापित हो गया!</strong>

🖥️ <strong>RDP:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>उपयोगकर्ता नाम:</strong> ${username}
🔑 <strong>पासवर्ड:</strong> <code>${password}</code>

⚠️ <strong>गंभीर - अभी यह पासवर्ड सहेजें!</strong>
• सुरक्षा कारणों से हम इसे बाद में पुनः प्राप्त नहीं कर सकते
• सभी पिछले डेटा मिटा दिए गए हैं
• यह एक नया Windows इंस्टॉलेशन है
• यदि आप यह पासवर्ड खो देते हैं, तो आपको इसे रीसेट करना होगा ("पासवर्ड रीसेट करें" बटन का उपयोग करें)

💡 पासवर्ड को कॉपी करने के लिए क्लिक करें।
🚀 आपका RDP इन नए क्रेडेंशियल के साथ उपयोग के लिए तैयार है!`,

 passwordResetFailed: name => `❌ <strong>पासवर्ड रीसेट विफल</strong>

<strong>${name}</strong> के लिए पासवर्ड रीसेट करने में विफल।

कृपया कुछ मिनटों में पुनः प्रयास करें या यदि समस्या बनी रहती है तो सहायता से संपर्क करें।`,

 windowsReinstallFailed: name => `❌ <strong>Windows पुनः स्थापना विफल</strong>

<strong>${name}</strong> पर Windows पुनः स्थापित करने में विफल।

कृपया कुछ मिनटों में पुनः प्रयास करें या यदि समस्या बनी रहती है तो सहायता से संपर्क करें।`,

 rdpNotSupported: `⚠️ यह सुविधा केवल Windows RDP इंस्टेंसेज के लिए उपलब्ध है।

आपका VPS Linux चला रहा है। एक्सेस प्रबंधन के लिए इसके बजाय SSH कुंजी का उपयोग करें।`,

 // ── DigitalOcean Windows RDP: अवधि + संस्करण चयन, इन-प्लेस रीइंस्टॉल ──
 rdpDurationBtn: c => (Number(c.period) === 1 ? `1 महीना — $${c.price}` : `${c.period} महीने — $${c.price}${c.discountPct ? ` (${c.discountPct}% बचत)` : ''}`),
 askRdpDuration: (config, cycles) => `📅 <strong>आप कितने समय के लिए प्रीपे करना चाहते हैं?</strong>

<strong>${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB NVMe
${cycles.map(c => {
  const per = Number(c.period) || 1
  const base = (Number(config.monthlyPrice) || 0) * per
  const save = per > 1 && base > 0 && Number(c.price) < base ? Math.round((1 - Number(c.price) / base) * 100) : 0
  return `• ${per === 1 ? '1 महीना' : `${per} महीने`} — <b>$${c.price}</b>${save > 0 ? ` <i>(${save}% बचत)</i>` : ''}`
}).join('\n')}

लंबी अवधि का भुगतान एक बार में होता है और इसमें बंडल छूट शामिल है; अवधि समाप्त होने पर ऑटो-रिन्यूअल उसी अवधि का शुल्क फिर से लेता है।`,
 rdpEditionBtn: o => `🪟 ${o.name} ${o.fast_deploy ? '⚡' : '⏳'} ~${o.eta_minutes || (o.fast_deploy ? 3 : 45)} मिनट`,
 askRdpEdition: options => `🪟 <strong>अपना Windows संस्करण चुनें</strong>

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ लगभग ${o.eta_minutes || 3} मिनट में तैयार (आपके क्षेत्र में प्री-बिल्ट इमेज)` : '⏳ पूर्ण इंस्टॉल, लगभग 45 मिनट'}`).join('\n')}

सभी संस्करण Windows Server Standard (Desktop Experience) हैं, RDP सक्षम और Administrator खाते के साथ।`,
 askReinstallEdition: (name, options) => `🔄 <strong>${name} पर Windows रीइंस्टॉल करें</strong>

इंस्टॉल करने के लिए संस्करण चुनें। आपका IP पता वही रहेगा।

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ लगभग ${o.eta_minutes || 3} मिनट` : (o.copy_first ? `⏳ लगभग ${o.eta_minutes} मिनट (इमेज पहले आपके सर्वर के डेटासेंटर में कॉपी की जाती है)` : '⏳ लगभग 45 मिनट')}`).join('\n')}`,
 confirmReinstallWindowsRdpText: (name, osName, etaMin, copyFirst) => `🔄 <strong>${name} पर ${osName} रीइंस्टॉल करें</strong>

⚠️ <strong>चेतावनी — डिस्क मिटा दी जाएगी:</strong>
• सर्वर की सभी फ़ाइलें, प्रोग्राम और सेटिंग्स हट जाएंगी
• हमारी प्री-बिल्ट इमेज से नया ${osName} इंस्टॉल होगा (~${etaMin} मिनट)${copyFirst ? `\n• इमेज पहले आपके सर्वर के डेटासेंटर में कॉपी होती है (~20 मिनट) — तब तक आपका सर्वर बिना बदलाव के चलता रहता है` : ''}
• एक नया Administrator पासवर्ड बनेगा — पुराना काम नहीं करेगा
• ✅ आपका IP पता और भुगतान की गई अवधि बनी रहेगी

क्या आप जारी रखना चाहते हैं?`,
 windowsReinstallStarted: (name, ip, username, password, osName, etaMin) => `🔄 <strong>${name} पर ${osName} रीइंस्टॉल हो रहा है</strong>

🌐 <strong>IP:</strong> <code>${ip || 'अपरिवर्तित'}</code>
👤 <strong>यूज़रनेम:</strong> ${username}
🔑 <strong>नया पासवर्ड:</strong> <code>${password}</code>

⏱️ Windows अभी इंस्टॉल हो रहा है — लगभग <b>${etaMin} मिनट</b> में इन क्रेडेंशियल्स से कनेक्ट करें।
💡 कॉपी करने के लिए पासवर्ड पर टैप करें। आप इसे 🔐 पासवर्ड दिखाएँ से कभी भी फिर देख सकते हैं।`,
 rdpActionReason: reason => `\n\n<i>कारण: ${reason}</i>`,
 // ── DigitalOcean Linux VPS: DigitalOcean की लाइव सूची से कोई भी OS रीइंस्टॉल करें (IP + लॉगिन वही) ──
 reinstallOsBtn: '🔄 OS रीइंस्टॉल करें',
 linuxOsBtn: o => `${o.current ? '✅ ' : ''}🐧 ${o.name}${o.requiresSshKey ? ' 🔑' : ''}`,
 askReinstallLinuxOs: (name, options) => `🔄 <b>${name} पर ऑपरेटिंग सिस्टम रीइंस्टॉल करें</b>

इंस्टॉल करने के लिए सिस्टम चुनें। ✅ = अभी इंस्टॉल है। 🔑 = आपके सर्वर पर पहले से मौजूद SSH कुंजी चाहिए।
आपका IP पता, root पासवर्ड और SSH कुंजी वही रहेंगे।`,
 confirmReinstallLinuxText: (name, osName) => `🔄 <b>${name} पर ${osName} रीइंस्टॉल करें</b>

⚠️ <b>चेतावनी — इससे डिस्क मिट जाएगी:</b>
• सर्वर की सभी फ़ाइलें, प्रोग्राम और सेटिंग्स हट जाएँगी
• नया ${osName} इंस्टॉल होगा (~3 मिनट)
• ✅ आपका IP पता, root पासवर्ड, SSH कुंजी और भुगतान अवधि बनी रहेगी

क्या आप जारी रखना चाहते हैं?`,
 linuxReinstallStarted: (name, osName, etaMin) => `🔄 <b>${name} पर ${osName} रीइंस्टॉल हो रहा है</b>

⏱️ लगभग <b>${etaMin} मिनट</b> में तैयार। आपका IP पता, root पासवर्ड और SSH कुंजी वही रहेंगे।
सर्वर ऑनलाइन होते ही हम आपको लॉगिन भेज देंगे।`,
 linuxReinstallDone: (name, ip, username, password, osName) => `✅ <b>${name} पर ${osName} तैयार है</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>यूज़रनेम:</b> ${username}
🔑 <b>पासवर्ड:</b> <code>${password}</code> (अपरिवर्तित)

💡 आपकी SSH कुंजी भी काम करती है। पासवर्ड कभी भी 🔐 Show Password से दोबारा देखें।`,
 linuxReinstallDoneNoPassword: (name, ip, username, osName) => `✅ <b>${name} पर ${osName} तैयार है</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>यूज़रनेम:</b> ${username}

🔑 अपनी SSH कुंजी से लॉगिन करें, या 🔐 Show Password / 🔄 Reset Password दबाएँ।`,
 linuxReinstallDoneUnverified: (name, ip, username, osName) => `✅ <b>${name} पर ${osName} रीइंस्टॉल हो गया</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>यूज़रनेम:</b> ${username}

⚠️ हम अभी आपके पासवर्ड की पुष्टि नहीं कर सके। आपकी SSH कुंजी काम करती है; अन्यथा कुछ मिनट बाद 🔐 Show Password या 🔄 Reset Password दबाएँ। हमारी टीम को सूचित कर दिया गया है।`,
 linuxReinstallFailed: name => `❌ <b>रीइंस्टॉल विफल</b>

हम <b>${name}</b> को रीइंस्टॉल नहीं कर सके। कुछ भी नहीं बदला गया। कृपया कुछ मिनट बाद फिर कोशिश करें या सपोर्ट से संपर्क करें।`,
 linuxReinstallNeedsKey: name => `🔑 <b>इस सिस्टम के लिए SSH कुंजी चाहिए</b>

<b>${name}</b> बिना SSH कुंजी के बनाया गया था, इसलिए उस पर Fedora, CentOS, AlmaLinux और Rocky Linux इंस्टॉल नहीं हो सकते। Ubuntu या Debian चुनें। कुछ भी नहीं बदला गया।`,
 windowsReinstallQueued: (name, osName, copyMin, etaMin) => `⏳ <b>${name} पर ${osName} का रीइंस्टॉल कतार में है</b>

${osName} इमेज पहले आपके सर्वर के डेटासेंटर में कॉपी की जा रही है (~${copyMin} मिनट)। तब तक आपका सर्वर <b>बिना बदलाव</b> के चलता रहेगा और मौजूदा पासवर्ड काम करता रहेगा।

फिर रीइंस्टॉल अपने आप शुरू होगा (डिस्क मिटेगी, IP वही रहेगा) और हम आपको <b>नया पासवर्ड</b> भेजेंगे — अभी से लगभग <b>${etaMin} मिनट</b> में तैयार।`,
 windowsReinstallCopyFailed: (name, osName) => `❌ <b>${name} पर ${osName} का रीइंस्टॉल शुरू नहीं हो सका</b>

आपके सर्वर के डेटासेंटर में Windows इमेज तैयार नहीं हो सकी। <b>कुछ भी नहीं बदला गया</b> — आपका सर्वर और पासवर्ड पहले जैसे ही हैं। कृपया बाद में फिर कोशिश करें या दूसरा एडिशन चुनें। हमारी टीम को सूचित कर दिया गया है।`,
 vpsBeingDeleted: name => `⚙️ कृपया प्रतीक्षा करें, आपका VPS (${name}) हटाया जा रहा है`,
 vpsDeleted: name => `✅ VPS (${name}) स्थायी रूप से हटा दिया गया है।`,
 failedDeletingVPS: name => `❌ VPS (${name}) को हटाने में विफल।

कृपया कुछ समय बाद पुनः प्रयास करें।`,

 upgradeVpsBtn: '⬆️ उन्नत करें',
 doPlanOptionBtn: o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} ${o.name} · $${o.monthly_price_usd}/माह`,
 doPlanOptionsMsg: (cur, opts, days, hidden) => `🔄 <b>प्लान बदलें</b> — उसी सर्वर पर लागू: आपका डेटा, IP और सेटिंग्स बनी रहती हैं।

<b>वर्तमान:</b> ${cur.name} (${cur.vcpus || '?'} vCPU · ${cur.ram_gb || '?'} GB RAM · ${cur.disk_gb} GB ${cur.storage_type}) — $${cur.monthly_price_usd}/माह
<b>इस अवधि में बचे दिन:</b> ${Math.floor(days)}

${opts.map(o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} <b>${o.name}</b> (${o.vcpus} vCPU/${o.ram_gb} GB/${o.disk_gb} GB ${o.storage_type}) $${o.monthly_price_usd}/माह${o.charge_now_usd > 0 ? ` · अभी भुगतान $${o.charge_now_usd.toFixed(2)}` : ''}`).join('\n')}

💡 अपग्रेड: आप केवल बचे दिनों का मूल्य अंतर चुकाते हैं। डाउनग्रेड: मुफ़्त और तुरंत, इस अवधि का कोई रिफंड नहीं। नई कीमत अगले रिन्यूअल से लागू होती है।${hidden ? `\n⚠️ ${hidden} छोटे प्लान छिपाए गए हैं: डिस्क कभी छोटी नहीं की जा सकती।` : ''}`,
 doPlanNoOptions: '⚠️ अभी इस सर्वर पर कोई और प्लान लागू नहीं किया जा सकता (डिस्क कभी छोटी नहीं होती, और कुछ प्लान इस क्षेत्र में स्टॉक में नहीं हो सकते)।',
 doPlanUnavailable: code => ({
 expired: '⚠️ इस सर्वर की अवधि समाप्त हो गई है। पहले रिन्यू करें, फिर प्लान बदलें।',
 term_ending_soon: '⚠️ इस सर्वर की अवधि में 1 घंटे से कम बचा है। पहले रिन्यू करें, फिर प्लान बदलें।',
 not_active: '⚠️ यह सर्वर सक्रिय नहीं है, इसलिए अभी इसका प्लान नहीं बदला जा सकता।',
 plan_change_in_progress: '⏳ इस सर्वर के लिए प्लान बदलाव पहले से चल रहा है। पूरा होने पर आपको संदेश मिलेगा।',
 not_supported: '⚠️ इस सर्वर के लिए प्लान बदलना उपलब्ध नहीं है।',
 }[code] || '⚠️ अभी इस सर्वर के लिए प्लान बदलना उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें या सहायता से संपर्क करें।'),
 doPlanKeepDiskBtn: '💾 वर्तमान डिस्क रखें (वापस बदल सकते हैं)',
 doPlanGrowDiskBtn: gb => `📀 डिस्क ${gb} GB तक बढ़ाएँ (स्थायी)`,
 doPlanDiskAsk: (o, cur) => `💾 <b>डिस्क आकार</b>

${o.name} में ${o.disk_gb} GB डिस्क है। आपके सर्वर में ${cur.disk_gb} GB है।

• <b>वर्तमान डिस्क रखें</b>: केवल CPU और RAM बदलते हैं। आप बाद में छोटे प्लान पर लौट सकते हैं।
• <b>डिस्क ${o.disk_gb} GB तक बढ़ाएँ</b>: ज़्यादा स्टोरेज, लेकिन <b>स्थायी</b>। सर्वर फिर कभी छोटी डिस्क वाले प्लान पर नहीं जा सकेगा।`,
 doPlanSummary: (name, cur, o, grow, bal, end) => `<strong>📜 प्लान बदलाव सारांश</strong>

<strong>• सर्वर:</strong> ${name}
<strong>• से:</strong> ${cur.name} ($${cur.monthly_price_usd}/माह)
<strong>• में:</strong> ${o.name} ($${o.monthly_price_usd}/माह)
<strong>• डिस्क:</strong> ${grow ? `${o.disk_gb} GB (स्थायी)` : `${cur.disk_gb} GB (अपरिवर्तित)`}
<strong>• अभी भुगतान:</strong> $${o.charge_now_usd.toFixed(2)}${o.direction === 'upgrade' ? ' (बचे दिनों का अंतर)' : ' (वर्तमान अवधि का कोई रिफंड नहीं)'}
<strong>• अगला रिन्यूअल:</strong> $${o.renewal_price_usd}${end ? `, ${new Date(end).toLocaleDateString('hi-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} को` : ''}
<strong>• वॉलेट बैलेंस:</strong> $${Number(bal).toFixed(2)}

⏱ सर्वर रीस्टार्ट होगा और लगभग ${grow ? '5-30' : '2-5'} मिनट ऑफ़लाइन रहेगा। डेटा, IP और सेटिंग्स बनी रहेंगी।`,
 doPlanLowBalance: (bal, price) => `⚠️ आपका वॉलेट बैलेंस ($${Number(bal).toFixed(2)}) इस अपग्रेड के लिए आवश्यक $${Number(price).toFixed(2)} से कम है। कृपया टॉप अप करें और पुनः प्रयास करें।`,
 doPlanStarted: (name, o, charged) => `⏳ <b>${name} को ${o.name} में बदला जा रहा है…</b>${charged > 0 ? `\n💳 आपके वॉलेट से $${Number(charged).toFixed(2)} काटे गए।` : ''}

सर्वर अभी रीस्टार्ट हो रहा है और कुछ मिनट ऑफ़लाइन रहेगा। पूरा होने पर हम आपको संदेश भेजेंगे।`,
 doPlanDone: (name, c, r) => `✅ <b>${name} अब ${c.to.name} पर है</b>

डिस्क: ${r && r.disk_gb ? r.disk_gb : '?'} GB · अगला रिन्यूअल: $${c.to.renewal_price_usd}। सर्वर फिर से ऑनलाइन है।`,
 doPlanFailed: (name, refund) => `❌ <b>${name} का प्लान बदलाव पूरा नहीं हुआ।</b> आपका सर्वर वर्तमान प्लान पर ही रहेगा${refund > 0 ? ` और $${Number(refund).toFixed(2)} आपके वॉलेट में वापस कर दिए गए` : ''}। कृपया बाद में पुनः प्रयास करें या सहायता से संपर्क करें।`,
 upgradeVpsPlanBtn: '⬆️ VPS योजना',
 upgradeVpsDiskBtn: '📀 डिस्क प्रकार',
 upgradeVpsDiskTypeBtn: '💾 डिस्क प्रकार उन्नत करें',
 upgradeVPS: 'उन्नयन प्रकार चुनें',
 upgradeOptionVPSBtn: to => {
 return `🔼 ${to} पर उन्नत करें`
 },
 upgradeVpsPlanMsg: options => `⚙️ अपने VPS संसाधनों को स्केल करने के लिए एक नई योजना चुनें।
💡 उन्नयन vCPUs, RAM, और स्टोरेज बढ़ाता है लेकिन इसे वापस नहीं किया जा सकता।

📌 उपलब्ध उन्नयन:
${options
 .map(
 planDetails =>
 `<strong>• ${planDetails.from} ➡ ${planDetails.to} –</strong> $${planDetails.monthlyPrice}/महीना ($${planDetails.hourlyPrice}/घंटा)`,
 )
 .join('\n')}

💰 बिलिंग नोटिस: आपका वर्तमान योजना अप्रयुक्त दिनों के लिए क्रेडिट किया जाएगा, और नया दर बिलिंग चक्र के शेष भाग के लिए लागू होगा (प्रोरेटेड समायोजन)।`,

 alreadyEnterprisePlan: '⚠️ आप पहले से ही उच्चतम उपलब्ध योजना (Enterprise) पर हैं। आगे कोई उन्नयन संभव नहीं है।',

 alreadyHighestDisk: vpsData =>
 `⚠️ आप पहले से ही उच्चतम उपलब्ध डिस्क (${vpsData.diskTypeDetails.type}) पर हैं। आगे कोई उन्नयन संभव नहीं है।`,
 newVpsDiskBtn: type => `उन्नत करें ${type} पर`,
 upgradeVpsDiskMsg: upgrades => `💾 बेहतर प्रदर्शन के लिए अपने स्टोरेज प्रकार को उन्नत करें।
⚠️ डिस्क उन्नयन स्थायी होते हैं और डाउनग्रेड नहीं किए जा सकते।

📌 उपलब्ध विकल्प:
${upgrades.map(val => `<strong>• ${val.from} ➡ ${val.to} –</strong> +$${val.price}/${val.duration}`).join('\n')}

💰 बिलिंग नोटिस: यदि उन्नयन मध्य चक्र में लागू किया जाता है, तो आपके वर्तमान बिलिंग अवधि के अप्रयुक्त भाग के लिए प्रोरेटेड समायोजन लागू किया जाएगा।`,
 upgradePlanSummary: (newData, vpsDetails, lowBal) => `<strong>📜 ऑर्डर सारांश:</strong>

<strong>• VPS ID:</strong> ${vpsDetails.name}
<strong>• पुरानी योजना:</strong> ${newData.upgradeOption.from}
<strong>• नई योजना:</strong> ${newData.upgradeOption.to}
<strong>• बिलिंग चक्र:</strong> ${newData.billingCycle}
<strong>• नई बिलिंग दर:</strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/घंटा' : ' (प्रोरेटेड समायोजन लागू किया गया)'
 }
<strong>• प्रभावी तिथि:</strong> तुरंत लागू
${
 lowBal
 ? `
💡 नोट: आपके कुल शुल्क में $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD की अग्रिम जमा राशि शामिल है। पहले घंटे की कटौती के बाद, शेष जमा राशि आपके वॉलेट में जमा कर दी जाएगी।
`
 : ''
}
<strong>• कुल मूल्य:</strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ क्या आप ऑर्डर जारी रखना चाहते हैं?</strong>`,

 upgradeDiskSummary: (newData, vpsDetails, lowBal) => `<strong>📜 ऑर्डर सारांश:</strong>

<strong>• VPS ID:</strong> ${vpsDetails.name}
<strong>• पुराना डिस्क प्रकार:</strong> ${newData.upgradeOption.from}
<strong>• नया डिस्क प्रकार:</strong> ${newData.upgradeOption.to}
<strong>• बिलिंग चक्र:</strong> ${newData.billingCycle}
<strong>• नई बिलिंग दर:</strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/घंटा' : ' (आनुपातिक समायोजन लागू)'
 }
${
 lowBal
 ? `
नोट: आपके कुल में $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD की जमा राशि शामिल है। पहली घंटे की दर कटने के बाद, शेष जमा राशि आपके वॉलेट में क्रेडिट की जाएगी।
`
 : ''
}
<strong>• कुल मूल्य:</strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ क्या आप ऑर्डर जारी रखना चाहते हैं?</strong>`,

 vpsSubscriptionData: (vpsData, planExpireDate, panelExpireDate) => {
 const isRDP = !!(vpsData.isRDP || vpsData.osType === 'Windows')
 const months = Number(vpsData.durationMonths) || 1
 const panel = isRDP ? '' : `\n<strong>• नियंत्रण पैनल ${vpsData?.cPanelPlanDetails ? vpsData.cPanelPlanDetails.type : ': चयनित नहीं'} </strong> ${
 vpsData?.cPanelPlanDetails
 ? `${
 vpsData?.cPanelPlanDetails.status === 'active' ? '- समाप्ति तिथि: ' : '- समाप्त हो चुका: '
 }${panelExpireDate}`
 : ''
 } `
 return `<strong>🗂️ आपकी सक्रिय सदस्यताएँ:</strong>

<strong>• ${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'} ${vpsData.name} </strong> – ${isRDP ? `${months === 1 ? 'मासिक' : `${months} महीने प्रीपेड`} · ` : ''}समाप्ति तिथि: ${planExpireDate} (स्वचालित नवीनीकरण: ${
 vpsData.autoRenewable ? 'सक्रिय' : 'निष्क्रिय'
 })${panel}`
 },

 manageVpsSubBtn: '📅 सदस्यता प्रबंधित करें',
 manageVpsPanelBtn: '🛠️ नियंत्रण पैनल सदस्यता प्रबंधित करें',

 vpsSubDetails: (data, date) => `<strong>📅 ${data.isRDP || data.osType === 'Windows' ? '🪟 Windows RDP' : '🐧 Linux VPS'} सदस्यता विवरण:</strong>

<strong>• सर्वर:</strong> ${data.name}
<strong>• योजना:</strong> ${data.planDetails.name}${data.isRDP || data.osType === 'Windows' ? `\n<strong>• बिलिंग अवधि:</strong> ${(Number(data.durationMonths) || 1) === 1 ? 'मासिक' : `${data.durationMonths} महीने (प्रीपेड)`}` : ''}
<strong>• वर्तमान समाप्ति तिथि:</strong> ${date}
<strong>• स्वचालित नवीनीकरण:</strong> ${data.autoRenewable ? 'सक्रिय' : 'निष्क्रिय'}`,

 vpsCPanelDetails: (data, date) => `<strong>📅 नियंत्रण पैनल सदस्यता विवरण:</strong>

<strong>• संबंधित VPS आईडी:</strong> ${data.name}
<strong>• नियंत्रण पैनल प्रकार:</strong> ${data.cPanelPlanDetails.type} (${data.cPanelPlanDetails.name})
<strong>• वर्तमान समाप्ति तिथि:</strong> ${date}
<strong>• स्वचालित नवीनीकरण:</strong> ${data.autoRenewable ? 'सक्रिय' : 'निष्क्रिय'}
`,

 vpsEnableRenewalBtn: '🔄 स्वचालित नवीनीकरण सक्षम करें',
 vpsDisableRenewalBtn: '❌ स्वचालित नवीनीकरण निष्क्रिय करें',
 vpsPlanRenewBtn: '📅 अब नवीनीकरण करें',
 unlinkVpsPanelBtn: '❌ VPS से अनलिंक करें',
 bankPayVPSUpgradePlan: (priceNGN, vpsDetails) =>
 `कृपया नीचे दिए गए "भुगतान करें" बटन पर क्लिक करके ${priceNGN} NGN का भुगतान करें। एक बार लेनदेन की पुष्टि हो जाने के बाद, आपको तुरंत सूचित किया जाएगा, और आपकी नई ${vpsDetails.upgradeOption.to} VPS योजना बिना किसी रुकावट के सक्रिय हो जाएगी।`,

 bankPayVPSUpgradeDisk: (priceNGN, vpsDetails) =>
 `कृपया “भुगतान करें” पर क्लिक करके ${priceNGN} NGN जमा करें। एक बार लेन-देन की पुष्टि हो जाने पर, आपको तुरंत सूचित किया जाएगा, और आपका VPS योजना नए डिस्क प्रकार ${vpsDetails.upgradeOption.toType} के साथ सुचारू रूप से सक्रिय हो जाएगा।`,

 showDepositCryptoInfoVpsUpgrade: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>भुगतान राशि: $${Number(priceUsd).toFixed(2)} USD</b>

बिल्कुल <b>${priceCrypto} ${tickerView}</b> भेजें:

<code>${address}</code>

भुगतान की पुष्टि होने पर आपकी उन्नत VPS योजना स्वचालित रूप से सक्रिय हो जाएगी (आमतौर पर कुछ ही मिनटों में)।

सादर,
${CHAT_BOT_NAME}`,

 linkVpsSSHKeyBtn: '➕ नई कुंजी जोड़ें',
 unlinkSSHKeyBtn: '❌ कुंजी हटाएं',
 downloadSSHKeyBtn: '⬇️ कुंजी डाउनलोड करें',

 noLinkedKey: name => `⚠️ वर्तमान में इस VPS [${name}] से कोई SSH कुंजी जुड़ी नहीं है। 

कृपया एक SSH कुंजी को अपने खाते से जोड़ें ताकि सुरक्षित पहुँच सुनिश्चित हो सके।`,

 linkedKeyList: (list, name) => `🗂️ VPS ${name} से जुड़ी SSH कुंजियाँ:

${list.map(val => `<strong>• ${val}</strong>`).join('\n')}`,

 unlinkSSHKeyList: name => `🗂️ VPS [${name}] से SSH कुंजी हटाने के लिए चयन करें:`,

 confirmUnlinkKey: data =>
 `⚠️ क्या आप सुनिश्चित हैं कि आप [${data.keyForUnlink}] को VPS [${data.name}] से अनलिंक करना चाहते हैं?`,
 confirmUnlinkBtn: '✅ अनलिंक की पुष्टि करें',
 keyUnlinkedMsg: data =>
 `✅ SSH कुंजी [${data.keyForUnlink}] को VPS [${data.name}] से सफलतापूर्वक अनलिंक कर दिया गया है।`,
 failedUnlinkingKey: data => `❌ SSH कुंजी को VPS (${data.name}) से अनलिंक करने में विफल। 

कृपया कुछ समय बाद पुनः प्रयास करें।`,

 userSSHKeyList: name => `🗂️ VPS [${name}] से लिंक करने के लिए एक SSH कुंजी चुनें:`,
 noUserKeyList: `🔑 कोई SSH कुंजी नहीं मिली। क्या आप एक नई SSH कुंजी अपलोड करना चाहेंगे?`,
 linkKeyToVpsSuccess: (key, name) => `✅ SSH कुंजी [${key}] को VPS [${name}] से सफलतापूर्वक जोड़ा गया है।`,
 failedLinkingSSHkeyToVps: (key, name) => `❌ SSH कुंजी [${key}] को VPS (${name}) से जोड़ने में विफल। 

कृपया कुछ समय बाद पुनः प्रयास करें।`,

 selectSSHKeyToDownload: '🗂️ वह SSH कुंजी चुनें जिसे आप डाउनलोड करना चाहते हैं:',

 disabledAutoRenewal: (
 data,
 expiryDate,
 ) => `⚠️ स्वत: नवीनीकरण अक्षम कर दिया गया है। यदि मैन्युअल रूप से नवीनीकरण नहीं किया गया, तो आपका VPS ${expiryDate} को समाप्त हो जाएगा।
✅ स्वत: नवीनीकरण सफलतापूर्वक अक्षम कर दिया गया है।`,

 enabledAutoRenewal: (data, expiryDate) =>
 `✅ स्वत: नवीनीकरण सक्षम कर दिया गया है। आपका VPS ${expiryDate} को स्वचालित रूप से नवीनीकृत होगा।`,

 renewVpsPlanConfirmMsg: (data, vpsDetails, expiryDate, low) => `<strong>📜 चालान सारांश</strong>

<strong>• VPS आईडी:</strong> ${vpsDetails.name}
<strong>• प्लान:</strong> ${vpsDetails.planDetails.name}
<strong>• बिलिंग साइकिल:</strong> ${vpsDetails.billingCycleDetails.type}
<strong>• वर्तमान समाप्ति तिथि:</strong> ${expiryDate}
<strong>• देय राशि:</strong> ${data.totalPrice} USD

${
 lowBal
 ? `नोट: आपकी कुल राशि में $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD की जमा राशि शामिल है। पहले घंटे की कटौती के बाद, शेष राशि आपके वॉलेट में क्रेडिट कर दी जाएगी।`
 : ''
}

<strong>• कुल मूल्य:</strong> $${
 lowBal
 ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE
 : data.totalPrice
 } USD

<strong>💳 क्या आप VPS नवीनीकरण जारी रखना चाहते हैं?</strong>`,

 payNowBtn: '✅ अभी भुगतान करें',

 vpsChangePaymentRecieved: `✅ भुगतान सफल! आपका VPS सेट किया जा रहा है। विवरण जल्द ही उपलब्ध होगा।`,
  planOutOfStock: (isRDP, region, suggestions = []) => `😔 <b>${region} में ${isRDP ? 'Windows RDP' : 'VPS'} अभी स्टॉक में नहीं है</b>\n\nउस शहर में हमारे ${isRDP ? 'AMD ' : ''}सर्वर अभी पूरी तरह भरे हुए हैं — आपसे <b>कोई शुल्क नहीं</b> लिया गया।${suggestions.length ? `\n\n✅ अभी यहाँ उपलब्ध:\n${suggestions.map(s => `• ${s}`).join('\n')}` : '\n\n⏳ कृपया थोड़ी देर बाद पुनः प्रयास करें।'}\n\nनीचे कोई दूसरा स्थान चुनें 👇`,
  stockNotifyBtn: '🔔 वापस आने पर मुझे बताएं',
  stockNotifySaved: (isRDP, place, days) => `🔔 <b>हो गया!</b> ${place} में ${isRDP ? 'Windows RDP' : 'VPS'} फिर से उपलब्ध होते ही हम आपको संदेश भेजेंगे।\n\n<i>यह अलर्ट ${days} दिनों तक चालू रहेगा।</i>`,
  stockBackInStock: (isRDP, place, planName) => `🟢 <b>फिर से स्टॉक में!</b>\n\n${place} में ${isRDP ? 'Windows RDP' : 'VPS'}${planName ? ` <b>${planName}</b>` : ''} अब फिर से ऑर्डर किया जा सकता है।\n\nस्टॉक जल्दी खत्म हो सकता है — ऑर्डर करने के लिए नीचे टैप करें।`,
  stockOrderNowBtn: '🛒 अभी ऑर्डर करें',
  rdpLateFailRefund: (amount, reason, balance, cities = []) => `❌ <b>आपका Windows RDP सेट अप नहीं हो सका</b>\n\n${reason}\n\n✅ <b>$${amount} आपके वॉलेट में वापस कर दिए गए हैं</b> (बैलेंस: $${balance})। अधूरा सर्वर हटा दिया गया।${cities.length ? `\n\n🌍 अभी यहाँ उपलब्ध:\n${cities.map(c => `• ${c}`).join('\n')}` : ''}\n\nदूसरे शहर में फिर से ऑर्डर करने के लिए नीचे टैप करें।`,
  rdpTryAnotherCityBtn: '🌍 दूसरा शहर आज़माएं',
  rdpFailReasons: { out_of_stock: 'सेटअप के दौरान DigitalOcean की उस शहर में AMD क्षमता खत्म हो गई।', provisioning_timeout: 'Windows सेटअप समय पर पूरा नहीं हुआ।', provision_failed: 'सर्वर नहीं बनाया जा सका।' },

 bankPayVPSRenewPlan: priceNGN =>
 `कृपया नीचे "भुगतान करें" पर क्लिक करके ${priceNGN} NGN भेजें। जैसे ही लेन-देन की पुष्टि होगी, आपको तुरंत सूचित किया जाएगा, और आपका VPS प्लान सक्रिय और नवीनीकृत कर दिया जाएगा।`,

 renewVpsPanelConfirmMsg: (
 data,
 panelDetails,
 date,
 ) => `<strong>💳 क्या आप नियंत्रण पैनल का नवीनीकरण करना चाहते हैं?</strong>

<strong>📜 चालान सारांश</strong>
 <strong>• संबंधित VPS आईडी:</strong> ${data.name}
 <strong>• नियंत्रण पैनल:</strong> ${panelDetails.type}
 <strong>• नवीनीकरण अवधि:</strong> ${panelDetails.durationValue}${' '}महीने
 <strong>• वर्तमान समाप्ति तिथि:</strong> ${date}
 <strong>• देय राशि:</strong> ${data.totalPrice} USD`,

 bankPayVPSRenewCpanel: (priceNGN, vpsDetails) =>
 `कृपया नीचे "भुगतान करें" पर क्लिक करके ${priceNGN} NGN भेजें। जैसे ही लेन-देन की पुष्टि होगी, आपको तुरंत सूचित किया जाएगा, और आपका VPS प्लान सक्रिय हो जाएगा और ${vpsDetails.cPanelPlanDetails.type} नियंत्रण पैनल नवीनीकृत किया जाएगा।`,

 vpsUnlinkCpanelWarning: vpsDetails =>
 `⚠️ चेतावनी: अलग करने से VPS ${vpsDetails.name} से ${vpsDetails.cPanel} लाइसेंस हटा दिया जाएगा, और आप इसकी सुविधाओं तक पहुंच खो देंगे। क्या आप आगे बढ़ना चाहते हैं?`,

 unlinkCpanelConfirmed: data => `✅ नियंत्रण पैनल ${data.cPanel} को VPS ${data.name} से सफलतापूर्वक हटा दिया गया है।`,

 errorUpgradingVPS: vpsName => `आपके VPS योजना ${vpsName} को अपग्रेड करते समय कुछ गलत हो गया।

कृपया 💬 सहायता प्राप्त करें बटन दबाएं।
अधिक जानकारी प्राप्त करें ${TG_HANDLE}.`,

 vpsUpgradePlanTypeSuccess: vpsDetails => `
✅ VPS ${vpsDetails.name} को ${vpsDetails.upgradeOption.to} में अपग्रेड कर दिया गया है। आपके नए संसाधन अब उपलब्ध हैं।`,

 vpsUpgradeDiskTypeSuccess: vpsDetails =>
 `✅ VPS ${vpsDetails.name} के लिए डिस्क को ${vpsDetails.upgradeOption.to} में अपग्रेड कर दिया गया है। आपका नया डिस्क प्रकार अब सक्रिय है।`,
 vpsRenewPlanSuccess: (vpsDetails, expiryDate) =>
 `✅ ${vpsDetails.name} के लिए VPS सदस्यता सफलतापूर्वक नवीनीकृत हो गई है!

• नई समाप्ति तिथि: ${expiryDate}
`,
 vpsRenewCPanelSuccess: (vpsDetails, expiryDate) =>
 `✅ ${vpsDetails.name} के लिए नियंत्रण पैनल सदस्यता सफलतापूर्वक नवीनीकृत हो गई है!

• नई समाप्ति तिथि: ${expiryDate}
`,
}

const hi = {
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
// Close HI gaps that previously fell back to English mid-flow:
//  • reverse record-type map t[t.a]='A' … keyed by THIS locale's own labels,
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
  dnsProxiedChoiceLabelDnsOnly: '⚪ केवल DNS (अनुशंसित)',
  dnsProxiedChoiceLabelProxied: '🟠 Cloudflare के माध्यम से प्रॉक्सी',
  dnsProxiedChoiceInvalid: 'कृपया इनमें से एक बटन दबाएं: ⚪ केवल DNS या 🟠 Cloudflare के माध्यम से प्रॉक्सी।',
  dnsProxiedChoiceAsk: (recordType, value) =>
    `⚙️ <b>इस ${recordType} रिकॉर्ड के लिए Cloudflare मोड</b>\n\n` +
    `लक्ष्य: <code>${value}</code>\n\n` +
    `⚪  <b>केवल DNS</b> (अनुशंसित)\n` +
    `<i>लुकअप सीधे आपका ओरिजिन IP लौटाते हैं। अपने VPS, मेल सर्वर की ओर इंगित करने या लक्ष्य तक सीधी पहुंच चाहिए, तब सर्वोत्तम।</i>\n\n` +
    `🟠  <b>Cloudflare के माध्यम से प्रॉक्सी</b>\n` +
    `<i>Cloudflare आपके ओरिजिन के सामने रहता है — मुफ्त SSL, CDN कैशिंग, DDoS सुरक्षा, और आपका ओरिजिन IP छिपा रहता है। सार्वजनिक वेबसाइटों के लिए सर्वोत्तम।</i>`,
})
Object.assign(hi, {
  dnsProxiedChoiceKeyboard: {
    parse_mode: 'HTML',
    reply_markup: { keyboard: [[t.dnsProxiedChoiceLabelDnsOnly], [t.dnsProxiedChoiceLabelProxied], _bc], resize_keyboard: true },
    disable_web_page_preview: true,
  },
})
Object.assign(vp, {
  vpsSshBlockedHelp: (name, host, username) =>
    `🟠 <strong>आपका VPS ऑनलाइन है — लेकिन SSH अवरुद्ध है</strong>\n\n` +
    `🖥️ <strong>सर्वर:</strong> ${name}\n` +
    `🌐 <strong>IP:</strong> <code>${host}</code>\n\n` +
    `हम आपके सर्वर तक पहुंच गए (यह चालू है), लेकिन <b>सर्वर के अंदर एक फ़ायरवॉल ने पोर्ट 22 (SSH) बंद कर दिया है</b>। इसीलिए लॉगिन और पासवर्ड रीसेट काम नहीं करते — बंद पोर्ट से कोई पासवर्ड नहीं गुजर सकता।\n\n` +
    `✅ <strong>इसे फिर से कैसे खोलें (2 मिनट):</strong>\n` +
    `1. इस सर्वर के लिए अपने प्रोवाइडर का <b>Recovery / Web Console</b> खोलें (SSH की ज़रूरत नहीं)।\n` +
    `2. <code>${username}</code> के रूप में लॉग इन करें।\n` +
    `3. चलाएं: <code>ufw allow OpenSSH</code>  (या <code>ufw allow 22/tcp</code>)\n` +
    `4. फिर चलाएं: <code>ufw reload</code>\n\n` +
    `पोर्ट 22 खुलने के बाद, वापस आएं और <b>🔑 पासवर्ड रीसेट करें</b> टैप करें — हम चालू सर्वर पर नया पासवर्ड सेट करेंगे और पुष्टि करेंगे कि यह काम करता है, आपका डेटा सुरक्षित रहेगा।\n\n` +
    `💬 अटक गए? <b>💬 सपोर्ट</b> टैप करें और हम इसे आपके लिए फिर से खोल देंगे।`,
})

module.exports = {
 hi,
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ ${domain} के लिए कस्टम नेमसर्वर सेट करें</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>वर्तमान:</b>\n`
 nsRecords.forEach((ns, i) => {
 msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n`
 })
 msg += '\n'
 }
 msg += `नए नेमसर्वर दर्ज करें (प्रति पंक्ति एक, न्यूनतम 2, अधिकतम 4):\n\n<i>उदाहरण:\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare: डैशबोर्ड में दिखे नाम <b>वैसे ही</b> कॉपी करें (उदा. <code>leanna.ns.cloudflare.com</code>)। अतिरिक्त <code>ns1./ns2.</code> उपसर्ग <b>न जोड़ें</b>।</i>`
 return msg
 },
 Hosting: 'होस्टिंग',
}
