const { areasOfCountry, carriersOf, countryCodeOf } = require('../areasOfCountry')
const { buildChooseSubscription } = require('./plan-copy')

const format = (cc, n) => `+${cc}(${n.toString().padStart(2, '0')})`

/* global process */
require('dotenv').config()
const HIDE_BANK_PAYMENT = process.env.HIDE_BANK_PAYMENT
const SELF_URL = process.env.SELF_URL
const FREE_LINKS = Number(process.env.FREE_LINKS)
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME

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

// قیمت محصولات دیجیتال
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
 viewAnalytics: '📊 مشاهده آمار',
 viewUsers: '👀 مشاهده کاربران',
 blockUser: '✋ مسدود کردن کاربر',
 unblockUser: '👌 رفع مسدودیت کاربر',
 messageUsers: '👋 پیام به همه کاربران',
 resetDead: '🗑️ حذف کاربران غیرفعال',
 gift5all: '🎁 هدیه $5 به همه کاربران',
 ...(process.env.RESELLER_PAYOUT_BOTS ? { resellerPayouts: '💸 پرداخت‌های نمایندگان' } : {}),
}
const user = {
 // main keyboards
 cPanelWebHostingPlans: '🇷🇺 پلن‌های cPanel',
 pleskWebHostingPlans: '🇷🇺 پلن‌های Plesk',
 joinChannel: '📢 عضویت در کانال',
 buyLeads: '🎯 خرید سرنخ تلفنی',
 validateLeads: '✅ اعتبارسنجی شماره‌ها',
 phoneNumberLeads: '🎯 خرید سرنخ تلفنی',
 leadsValidation: '📱 سرنخ‌های SMS',
 hostingDomainsRedirect: '🛡️ هاستینگ ضد-قرمز',
 wallet: '👛 کیف پول',
 urlShortenerMain: '🔗 کوتاه‌کننده URL',
 vpsPlans: '🖥️ VPS / RDP',
 buyPlan: '⭐ عضویت',
 more: '➕ بیشتر',
 domainNames: '🌐 دامنه‌های ضدضربه',
 viewPlan: '📋 پلن‌های من',
 becomeReseller: '💼 نمایندگی',
 getSupport: '💬 پشتیبانی',
 freeTrialAvailable: '🆓 آزمایش رایگان BulkSMS',
 smsAppMain: '📱 BulkSMS',
 smsCreateCampaign: '📱 ایجاد کمپین',
 smsMyCampaigns: '📋 کمپین‌های من',
smsDownloadApp: '📲 دانلود اپلیکیشن',
 smsResetLogin: '🔓 بازنشانی ورود',
 smsManageDevices: '📱 مدیریت دستگاه‌ها',
 smsHowItWorks: '❓ نحوه کارکرد',
 smsAppSettings: '⚙️ تنظیمات SMS',
 changeSetting: '⚙️ تنظیمات',
 changeLanguage: '🌍 تغییر زبان',
 cloudPhone: '📞 Cloud IVR + SIP',
 testSip: '🧪 تست رایگان SIP',
 digitalProducts: '🛒 محصولات دیجیتال',
 marketplace: '🏪 مارکت‌پلیس',
 shippingLabel: '📦 ارسال و پست',
 emailBlast: '📧 ارسال انبوه ایمیل',
 emailValidation: '📧 اعتبارسنجی ایمیل',
 serviceBundles: '🎁 بسته‌های خدماتی',
 referEarn: '🤝 معرفی و کسب درآمد',

 // Sub Menu 1: urlShortenerMain
 shortenLink: '✂️ کوتاه کردن لینک',
 redSelectUrl: '🔀✂️ تغییر مسیر و کوتاه کردن',
 redBitly: '✂️ Bit.ly',
 redShortit: '✂️ Shortit (آزمایشی)',
 urlShortener: '✂️🌐 کوتاه‌کننده دامنه سفارشی',
 viewShortLinks: '📊 مشاهده آمار لینک‌های کوتاه',
 activateDomainShortener: '🔗 فعال‌سازی دامنه برای کوتاه‌کننده',

 // Sub Menu 6: Digital Products
 virtualCard: '💳 کارت مجازی',

 // Sub Menu 2: domainNames
 buyDomainName: '🛒🌐 خرید دامنه',
 viewDomainNames: '📂 دامنه‌های من',
 dnsManagement: '🔧 مدیریت DNS',

 // Sub Menu 3: cPanel/Plesk WebHostingPlansMain
 freeTrial: '💡 آزمایش رایگان',
 premiumWeekly: '⚡ پریمیوم ضد-ریدایرکت (۱ هفته)',
 premiumCpanel: '🔷 هاست‌پنل پریمیوم ضد-ریدایرکت (۳۰ روز)',
 goldenCpanel: '👑 هاست‌پنل گلدن ضد-ریدایرکت (۳۰ روز)',
 contactSupport: '📞 تماس با پشتیبانی',

 // Sub Menu 4: VPS Plans
 buyVpsPlan: '⚙️ ایجاد VPS / RDP',
 buyLinuxVpsBtn: '🐧 ایجاد VPS لینوکس',
 buyRdpBtn: '🪟 ایجاد Windows RDP',
 manageVpsPlan: '🖥️ مدیریت سرورهای من',
 vpsRdpMenuPrompt: `🖥️ <b>Cloud VPS / Windows RDP</b>

دو محصول متفاوت، دو لیست پلن متفاوت:
🐧 <b>Linux VPS</b> — دسترسی SSH · هاستینگ وب · توسعه · اتوماسیون
🪟 <b>Windows RDP</b> — ریموت دسکتاپ · لایسنس ویندوز شامل می‌شود · پیش‌پرداخت ۱/۲/۳ ماهه · آماده در ~۳ دقیقه

پورت ۲۵ باز · هاستینگ ضد-تعلیق. لطفاً یک گزینه انتخاب کنید:`,
 manageVpsSSH: '🔑 کلیدهای SSH',

 // Free Trial
 freeTrialMenuButton: '🚀 آزمایش رایگان (۱۲ ساعته)',
 getFreeTrialPlanNow: '🛒 دریافت پلن آزمایشی همین الان',
 continueWithDomainNameSBS: websiteName => `➡️ ادامه با ${websiteName}`,
 searchAnotherDomain: `🔍 جستجوی دامنه دیگر`,
privHostNS: `🏢 PrivHost (هاستینگ سریع و امن)`,
 cloudflareNS: `🛡️ Cloudflare Shield (امنیت و مخفی‌سازی)`,
 backToFreeTrial: '⬅️ بازگشت به آزمایش رایگان',

 // Paid Plans
 buyPremiumWeekly: '🛒 خرید پریمیوم آنتی‌رد (۱ هفته)',
 buyPremiumCpanel: '🛒 خرید پریمیوم آنتی‌رد HostPanel',
 buyGoldenCpanel: '🛒 خرید گلدن آنتی‌رد HostPanel',
 viewPremiumWeekly: '⚡ مشاهده پریمیوم هفتگی',
 viewPremiumCpanel: '🔷 مشاهده پریمیوم HostPanel',
 viewGoldenCpanel: '👑 مشاهده گلدن HostPanel',
 backToHostingPlans: '⬅️ بازگشت به پلن‌های هاستینگ',
 registerANewDomain: '🌐 ثبت دامنه جدید',
 useMyDomain: '📂 استفاده از دامنه من',
 connectExternalDomain: '🔗 اتصال دامنه خارجی',
 useExistingDomain: '🔄 استفاده از دامنه موجود',
 backToPremiumWeeklyDetails: '⬅️ بازگشت به جزئیات پریمیوم هفتگی',
 backToPremiumCpanelDetails: '⬅️ بازگشت به جزئیات پریمیوم HostPanel',
 backToGoldenCpanelDetails: '⬅️ بازگشت به جزئیات گلدن HostPanel',
 continueWithDomain: websiteName => `➡️ ادامه با ${websiteName}`,
 enterAnotherDomain: '🔍 وارد کردن دامنه دیگر',
 backToPurchaseOptions: '⬅️ بازگشت به گزینه‌های خرید',
 myHostingPlans: '📋 پلن‌های هاستینگ من',
 billingMenu: '💳 پلن من / صورت‌حساب',
 backToBillingMenu: '⬅️ بازگشت به صورت‌حساب',
 revealCredentials: '🔑 نمایش اطلاعات ورود',
 manageVisitorCaptcha: '🛡️ روشن/خاموش کردن Captcha',
 manageVisitorCaptchaLocked: '🔒 روشن/خاموش Captcha — فقط پلن گلد',
 manageHoneypot: '🍯 روشن/خاموش کردن تله‌های Honeypot',
 manageHoneypotLocked: '🔒 تله‌های Honeypot — فقط پلن ماهانه',
 renewHostingPlan: '🔄 تمدید همین الان',
 upgradeHostingPlan: '⬆️ ارتقاء هاستینگ',
 confirmRenewNow: '✅ تأیید و پرداخت',
 cancelRenewNow: '❌ لغو',
 toggleAutoRenew: '🔁 تغییر وضعیت تمدید خودکار',
 unlinkDomain: '🗑️ جدا کردن یک دامنه',
 addDomainToPlan: '➕ افزودن دامنه به پلن',
 changePrimaryDomain: '🔄 تغییر دامنه اصلی',
 confirmChangePrimaryBtn: '✅ بله، تغییر بده',
 confirmAttachBtn: '✅ بله، متصل کن',
 cancelHostingPlan: '🚫 لغو پلن هاستینگ',
 takeSiteOffline: '🔌 آفلاین کردن سایت',
 bringSiteOnline: '🌐 آنلاین کردن سایت',
 siteOfflineModeMaintenance: '🛠️ حالت تعمیر و نگهداری (پیشنهادی)',
 siteOfflineModeSuspend: '🚫 تعلیق کامل (HTTP + email + FTP + DB)',
 confirmTakeOfflineBtn: '✅ بله، آفلاین کن',
 confirmBringOnlineBtn: '✅ بله، آنلاین کن',
 confirmUnlinkBtn: '✅ بله، جدا کن',
 confirmCancelHostingBtn: '🗑️ بله، پلن را لغو کن',
 cancelGoBackBtn: '⬅️ نه، برگرد',
 backToMyHostingPlans: '⬅️ بازگشت به پلن‌های من',
}
const u = {
 // other key boards
 deposit: '➕💵 واریز',
 withdraw: '➖💵 برداشت',
 myTier: '🏆 سطح من',
 txHistory: '📜 تراکنش‌ها',

 // wallet
usd: 'USD',
 ngn: 'NGN',

 // deposit methods
 depositBank: '🏦 بانک (نایرا)',
 depositCrypto: '₿ کریپتو',
}
const view = num => Number(num).toFixed(2)
const yesNo = ['بله', 'خیر']

const bal = (usd) => `$${view(usd)}`

const dnsEntryFormat = '' // deprecated — A/CNAME now use multi-step wizard

const dnsQuickActions = {
 pointToIp: 'اتصال دامنه به IP',
 googleEmail: 'راه‌اندازی ایمیل Google',
 zohoEmail: 'راه‌اندازی ایمیل Zoho',
 verification: 'تأیید دامنه (TXT)',
 addSubdomain: 'افزودن زیردامنه',
}

const t = {
 yes: '✅ بله',
 no: '❌ خیر',
 back: 'بازگشت',
 cancel: '❌ لغو',
 skip: 'رد شدن',
 becomeReseller: (() => {
 const services = ['کوتاه‌کننده URL', 'ثبت دامنه']
 if (process.env.PHONE_SERVICE_ON === 'true') services.push('Cloud IVR')
 if (HIDE_SMS_APP !== 'true') services.push('BulkSMS')
 if (process.env.OFFSHORE_HOSTING_ON !== 'false') services.push('هاستینگ ضد مسدودی')
 return `<b>نماینده فروش ${CHAT_BOT_BRAND} شوید</b>

تمام خدمات ما را — ${services.join(', ')} — زیر برند خودتان بفروشید.

سهم سود <b>۵۰/۵۰</b> از هر فروش.

🤖 <b>هر سؤالی درباره نمایندگی دارید از دستیار هوش مصنوعی ما بپرسید</b> — کافیست سؤالتان را در زیر تایپ کنید. در صورت نیاز یک نفر از تیم ما وارد می‌شود.

برای بستن این چت /done را ارسال کنید.`
 })(),
 resetLoginAdmit: `✅ از دستگاه قبلی خارج شدید. لطفاً اکنون وارد شوید.`,
 resetLoginDeny: 'باشه. هیچ اقدام دیگری لازم نیست.',
 resetLogin: `${CHAT_BOT_BRAND}SMS: آیا در تلاش هستید از دستگاه قبلی خود خارج شوید؟`,
 select: `لطفاً یک گزینه انتخاب کنید:`,
 urlShortenerSelect: `لینک‌های خود را کوتاه، برند یا ردیابی کنید:`,

 // cPanel/Plesk Plans initial select plan text
 selectPlan: `لطفاً یک پلن انتخاب کنید:`,
 backButton: '⬅️ بازگشت',
 yesProceedWithThisEmail: email => `ادامه با ${email}`,
 skipEmail: 'رد شدن (بدون ایمیل)',
 proceedWithPayment: 'ادامه به پرداخت',
 iHaveSentThePayment: `✅ بررسی وضعیت پرداخت`,
 // Free Plan
 trialAlreadyUsed: `دوره آزمایشی رایگان قبلاً استفاده شده. برای ادامه با ویژگی‌های پریمیوم اشتراک بگیرید.`,
 oneHourLeftToExpireTrialPlan: `⏰ پلن Freedom شما در ۱ ساعت دیگر منقضی می‌شود. برای ادامه ارتقا دهید!`,
 freePlanExpired: `🚫 پلن Freedom شما منقضی شده است. امیدواریم از دوره آزمایشی لذت برده باشید،
برای ادامه استفاده از خدمات ما، لطفاً یکی از پلن‌های پریمیوم ما را خریداری کنید.`,
 freeTrialPlanSelected: hostingType => `
<b>پلن رایگان</b> — رایگان به مدت ۱۲ ساعت

1 GB SSD · 10 GB پهنای باند · 1 دامنه .sbs
1 ایمیل · 1 پایگاه داده MySQL · SSL رایگان · دسترسی به HostPanel

یک دامنه .sbs وارد کنید تا شروع کنید.`,
 getFreeTrialPlan: `دامنه مورد نظر خود را وارد کنید (مثلاً example.sbs). دامنه رایگان .sbs شامل می‌شود.`,
 trialPlanContinueWithDomainNameSBSMatched: websiteName => `<b>${websiteName}</b> در دسترس است.`,
 trialPlanSBSDomainNotMatched: `دامنه پیدا نشد. یک دامنه .sbs دیگر امتحان کنید.`,
 trialPlanSBSDomainIsPremium: `دامنه پریمیوم — فقط با پلن‌های پولی در دسترس است. دامنه دیگری امتحان کنید.`,
 trialPlanGetNowInvalidDomain: `یک دامنه .sbs معتبر وارد کنید (مثلاً example.sbs).`,
 trialPlanNameserverSelection: websiteName =>
 `ارائه‌دهنده nameserver را برای <b>${websiteName}</b> انتخاب کنید`,
trialPlanDomainNameMatched: `برای راه‌اندازی حساب، ایمیل خود را وارد کنید.`,
 confirmEmailBeforeProceedingSBS: email =>
 `آیا مطمئن هستید که می‌خواهید با ایمیل ${email} برای اشتراک پلن Freedom ادامه دهید؟`,
 trialPlanInValidEmail: 'لطفاً یک ایمیل معتبر وارد کنید',
 trialPlanActivationConfirmation: `✅ آزمایش رایگان در حال فعال‌سازی است. به مدت ۱۲ ساعت معتبر می‌باشد.`,
 trialPlanActivationInProgress: `پلن آزمایشی رایگان شما در حال فعال‌سازی است. این ممکن است چند لحظه طول بکشد…`,

 what: `این گزینه در حال حاضر در دسترس نیست. لطفاً از دکمه‌های زیر انتخاب کنید، یا /start را تایپ کنید تا منوی کامل را ببینید.`,
 whatNum: `این عدد معتبر به نظر نمی‌رسد. لطفاً یک عدد معتبر وارد کنید.`,
 phoneGenTimeout: 'Timeout',
 phoneGenNoGoodHits: `لطفاً روی 💬 پشتیبانی ضربه بزنید یا کد منطقه دیگری انتخاب کنید`,

 subscribeRCS: p =>
 `اشتراک ثبت شد! هر زمان که خواستید با کلیک روی <a href="${SELF_URL}/unsubscribe?a=b&Phone=${p}">لینک</a> لغو اشتراک کنید`,
 unsubscribeRCS: p =>
`شما اشتراک خود را لغو کردید! برای اشتراک مجدد روی <a href="${SELF_URL}/subscribe?a=b&Phone=${p}">لینک</a> کلیک کنید`,
 argsErr: `dev: آرگومان‌های اشتباه ارسال شد`,
 showDepositNgnInfo:
 ngn => `لطفاً ${ngn} NGN را با کلیک روی دکمه «پرداخت» در زیر واریز کنید. پس از تأیید تراکنش، بلافاصله به شما اطلاع داده خواهد شد و کیف پول شما به‌روزرسانی می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 askEmail: `لطفاً یک ایمیل برای تأیید پرداخت وارد کنید.`,
 askEmailForNGN: `لطفاً یک ایمیل برای تأیید پرداخت وارد کنید.`,
 askValidAmount: 'لطفاً یک مبلغ معتبر وارد کنید.',
 askValidEmail: 'لطفاً یک ایمیل معتبر وارد کنید',
 askValidCrypto: 'لطفاً یک ارز دیجیتال معتبر انتخاب کنید',
 askValidPayOption: 'لطفاً یک گزینه پرداخت معتبر انتخاب کنید',
 chooseSubscription: buildChooseSubscription('fa'),

 askCoupon: usd =>
 `قیمت $${view(usd)} است. آیا می‌خواهید کد تخفیف اعمال کنید؟ اگر دارید، همین الان وارد کنید. در غیر این صورت می‌توانید 'رد کردن' را فشار دهید.`,
 planAskCoupon: `آیا می‌خواهید کد تخفیف اعمال کنید؟ اگر دارید، همین الان وارد کنید. در غیر این صورت می‌توانید 'رد کردن' را فشار دهید.`,
 enterCoupon: `لطفاً کد تخفیف را وارد کنید:`,
 planPrice: (plan, price) => `قیمت اشتراک ${plan} برابر با $${price} است. لطفاً روش پرداخت را انتخاب کنید.`,
 planNewPrice: (plan, price, newPrice) =>
 `قیمت اشتراک ${plan} اکنون $${view(newPrice)} <s>($${price})</s> است. لطفاً روش پرداخت را انتخاب کنید.`,

 domainPrice: (domain, price) => `قیمت ${domain} برابر با ${price} USD است. روش پرداخت را انتخاب کنید.`,
 domainNewPrice: (domain, price, newPrice) =>
 `قیمت ${domain} اکنون $${view(newPrice)} <s>($${price})</s> است. روش پرداخت را انتخاب کنید.`,

 couponInvalid: `کد تخفیف نامعتبر است، لطفاً دوباره کد تخفیف خود را وارد کنید:`,

lowPrice: `قیمت ارسال شده کمتر از حد مورد نیاز است`,

 freeTrialAvailable: (chatId) => `📱 <b>آزمایش رایگان BulkSMS — ۱۰۰ پیامک رایگان</b>\n\nکد فعال‌سازی شما:\n<code>${chatId}</code>\n\n📲 <b>دانلود اپلیکیشن:</b> ${SMS_APP_LINK}\n\nاپ را باز کنید ← کد خود را وارد کنید ← شروع به ارسال کنید!\n\n⚡ <b>آزمایشی:</b> فقط ۱ دستگاه.\n\n💡 پس از پایان آزمایش، روی <b>⭐ عضویت</b> در منوی اصلی ضربه بزنید تا BulkSMS نامحدود + کوتاه‌سازی لینک + اعتبارسنجی و موارد بیشتر را فعال کنید!\n\nنیاز به سیم‌کارت eSIM دارید؟ روی 💬 پشتیبانی ضربه بزنید`,
 
 smsAppActivationCode: (chatId, plan, isSubscribed) => {
   if (!isSubscribed) {
     return `📱 <b>آزمایش رایگان BulkSMS — ۱۰۰ پیامک رایگان</b>\n\n📲 <b>فقط دستگاه‌های Android</b> — iOS/iPhone پشتیبانی نمی‌شود (Apple از ارسال پیامک توسط اپ‌ها جلوگیری می‌کند).\n\nکد فعال‌سازی شما:\n<code>${chatId}</code>\n\n📲 <b>دانلود اپلیکیشن:</b> ${SMS_APP_LINK}\n\nاپ را باز کنید ← کد خود را وارد کنید ← شروع به ارسال کنید!\n\n⚡ <b>آزمایشی:</b> فقط ۱ دستگاه.\n\n💡 روی <b>⭐ عضویت</b> در منوی اصلی ضربه بزنید تا دستگاه‌های نامحدود + BulkSMS + کوتاه‌سازی لینک + اعتبارسنجی و موارد بیشتر را فعال کنید!\n\nنیاز به سیم‌کارت eSIM دارید؟ روی 💬 پشتیبانی ضربه بزنید`
   }
   const deviceLimit = plan === 'Monthly' ? 'unlimited' : (plan === 'Weekly' ? '10' : (plan === 'Daily' ? '3' : '1'))
   return `📱 <b>BulkSMS — پلن ${plan} فعال است ✅</b>\n\n📲 <b>فقط دستگاه‌های Android</b> — iOS/iPhone پشتیبانی نمی‌شود (Apple از ارسال پیامک توسط اپ‌ها جلوگیری می‌کند).\n\nکد فعال‌سازی شما:\n<code>${chatId}</code>\n\n📲 <b>دانلود اپلیکیشن:</b> ${SMS_APP_LINK}\n\nاپ را باز کنید ← کد خود را وارد کنید ← شروع به ارسال کنید!\n\n⚡ <b>دستگاه‌ها:</b> ${deviceLimit} ${deviceLimit === 'unlimited' ? 'دستگاه نامحدود' : `دستگاه${deviceLimit === '1' ? '' : ''}`}\n\nکمپین‌ها را در اپ یا در ربات ایجاد کنید.\n\nنیاز به سیم‌کارت eSIM دارید؟ روی 💬 پشتیبانی ضربه بزنید`
 },

 freeTrialNotAvailable: 'شما قبلاً از آزمایش رایگان استفاده کرده‌اید.\n\nروی <b>⭐ عضویت</b> ضربه بزنید تا اشتراک بگیرید — شامل BulkSMS نامحدود، کوتاه‌سازی لینک، اعتبارسنجی، دامنه‌های رایگان و موارد بیشتر!',

 smsAppMenuSubscribed: (chatId) => `📧 <b>BulkSMS — فعال ✅</b>\n\n📱 <i>فقط روی دستگاه‌های Android کار می‌کند (iOS پشتیبانی نمی‌شود).</i>\n\nپیامک را از SIM تلفن شما ارسال می‌کند — قابلیت تحویل بالا، شناسه فرستنده واقعی.\n\n📲 <b>اپ:</b> ${SMS_APP_LINK}\n🔑 <b>کد:</b> <code>${chatId}</code>\n\nکمپین‌ها را در زیر یا در اپ ایجاد کنید.\nتازه‌وارد هستید؟ روی <b>❓ نحوه کارکرد</b> ضربه بزنید`,
 smsAppMenuTrial: (chatId, remaining) => `📧 <b>BulkSMS — آزمایش رایگان</b> (${remaining} پیامک باقی‌مانده)\n\n📱 <i>فقط روی دستگاه‌های Android کار می‌کند (iOS پشتیبانی نمی‌شود).</i>\n\nپیامک را از SIM تلفن شما ارسال می‌کند — قابلیت تحویل بالا، شناسه فرستنده واقعی.\n\n📲 <b>اپ:</b> ${SMS_APP_LINK}\n🔑 <b>کد:</b> <code>${chatId}</code>\n\nتازه‌وارد هستید؟ روی <b>❓ نحوه کارکرد</b> ضربه بزنید`,
 smsAppMenuExpired: `📧 <b>BulkSMS</b>\n\n📱 <i>فقط روی دستگاه‌های Android کار می‌کند (iOS پشتیبانی نمی‌شود).</i>\n\nدوره آزمایشی شما به پایان رسیده است. برای ادامه ارسال روی <b>⭐ عضویت</b> ضربه بزنید.\n\nتازه‌وارد هستید؟ روی <b>❓ نحوه کارکرد</b> ضربه بزنید تا نحوه کارکرد BulkSMS را بیاموزید.`,

 smsHowItWorks: (chatId) => `📧 <b>BulkSMS — نحوه کارکرد</b>\n\nBulkSMS پیامک واقعی را <b>از SIM تلفن شما</b> ارسال می‌کند — نه از سرور. این به شما قابلیت تحویل بالا و شناسه فرستنده واقعی می‌دهد.\n\n<b>⚙️ راه‌اندازی یک‌بار:</b>\n1. اپ را دانلود کنید ← ${SMS_APP_LINK}\n2. آن را باز کنید ← کد را وارد کنید: <code>${chatId}</code>\n3. هنگام درخواست، مجوز پیامک را اعطا کنید\n\n<b>📤 ارسال کمپین:</b>\n• اینجا روی <b>📱 ایجاد کمپین</b> ضربه بزنید یا در اپ ایجاد کنید\n• پیام + مخاطبین خود را اضافه کنید (جای‌گذاری یا آپلود فایل)\n• کمپین با اپ همگام‌سازی می‌شود ← روی تلفن خود ارسال را بزنید\n\n<b>💡 نکات:</b>\n• از <b>eSIM</b> برای یک خط ارسال اختصاصی استفاده کنید\n• پیام‌ها را با <code>---</code> در یک خط جداگانه برای چرخش جدا کنید\n• <code>[name]</code> در پیام شما = شخصی‌سازی خودکار\n• کمپین‌ها را برای بعد زمان‌بندی کنید یا فوری ارسال کنید\n\n<b>📋 کمپین‌های من</b> همه کمپین‌ها + وضعیت را نشان می‌دهد.\n<b>🔓 بازنشانی ورود</b> به شما امکان می‌دهد به دستگاه جدید بروید.\n\nنیاز به eSIM دارید؟ روی 💬 پشتیبانی ضربه بزنید`,

 smsCreateCampaignIntro: `📱 <b>ایجاد کمپین پیامکی</b>\n\nاین‌گونه کار می‌کند:\n\n<b>مرحله ۱:</b> نام کمپین خود را وارد کنید\n<b>مرحله ۲:</b> پیام(های) خود را بنویسید\n • از <code>[name]</code> برای شخصی‌سازی استفاده کنید\n • چند خط = چرخش پیام\n<b>مرحله ۳:</b> مخاطبین را آپلود کنید\n • به صورت متن جای‌گذاری کنید: <code>+1234567890, John</code>\n • یا یک فایل .txt / .csv آپلود کنید\n<b>مرحله ۴:</b> فاصله زمانی پیامک را تنظیم کنید (تأخیر بین ارسال‌ها)\n<b>مرحله ۵:</b> بررسی و تأیید کنید — ارسال، زمان‌بندی یا ذخیره به عنوان پیش‌نویس\n\nکمپین با اپ ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS برای ارسال همگام‌سازی می‌شود.\n\n<b>شروع می‌کنیم — نام کمپین را وارد کنید:</b>`,

 smsSchedulePrompt: '⏰ <b>زمان‌بندی کمپین؟</b>\n\nانتخاب کنید این کمپین چه زمانی در دسترس باشد:',
 smsSendNow: '▶️ ارسال همین الان',
 smsScheduleLater: '⏰ زمان‌بندی برای بعد',
 smsScheduleTimePrompt: '📅 <b>تاریخ و زمان زمان‌بندی را وارد کنید</b>\n\nفرمت: <code>YYYY-MM-DD HH:MM</code>\n(منطقه زمانی UTC)\n\nمثال: <code>2025-07-15 09:30</code>',

 smsSaveDraft: '💾 ذخیره پیش‌نویس',
 smsDefaultGap: '⏱ پیش‌فرض (۵ ثانیه)',
 smsGapTimePrompt: '⏱ <b>تأخیر بین پیام‌ها</b>\n\nچند ثانیه بین هر پیامک صبر شود؟\n\n• پیش‌فرض: <b>۵ ثانیه</b>\n• محدوده: ۱ تا ۳۰۰ ثانیه\n\nیک عدد تایپ کنید یا برای پیش‌فرض دکمه را بزنید:',

 smsMyCampaignsEmpty: '📋 <b>کمپین‌های من</b>\n\nهنوز هیچ کمپینی ندارید. برای شروع روی <b>📱 ایجاد کمپین</b> ضربه بزنید!',
 smsMyCampaignsList: (campaigns) => {
 const statusIcons = { draft: '📝', sending: '📤', completed: '✅', paused: '⏸', scheduled: '📅' }
 const lines = campaigns.slice(0, 10).map((c, i) =>
 `${i + 1}. ${statusIcons[c.status] || '📋'} <b>${c.name}</b>\n ${c.sentCount}/${c.totalCount} ارسال شده · ${c.status}`
 )
 return `📋 <b>کمپین‌های من</b>\n\n${lines.join('\n\n')}\n\n<i>کمپین‌ها را در اپ ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS مدیریت کنید.</i>`
 },

 planSubscribed:
 HIDE_SMS_APP === 'true'
 ? `✅ اشتراک پلن {{plan}} فعال شد!

شامل:
• رایگان 
• لینک‌های Shortit نامحدود
• اعتبارسنجی شماره تلفن آمریکا

نیاز به E-sim دارید؟ روی 💬 پشتیبانی ضربه بزنید`
 : `✅ اشتراک پلن {{plan}} فعال شد!

شامل:
• رایگان 
• لینک‌های Shortit نامحدود
• اعتبارسنجی شماره تلفن آمریکا
• اپ ${SMS_APP_NAME}

📱 دسترسی دستگاه:
 روزانه — ۳ دستگاه
הWeekly — 10 دستگاه
 Monthly — دستگاه‌های نامحدود

📲 دانلود: ${SMS_APP_LINK}
💬 دریافت E-sim: روی پشتیبانی ضربه بزنید
🔓 تغییر دستگاه: /resetlogin`,

 alreadySubscribedPlan: days => `اشتراک شما فعال است و در ${days} منقضی می‌شود`,

 payError: `❌ جلسه پرداخت منقضی شده است. لطفاً دوباره امتحان کنید یا روی 💬 پشتیبانی ضربه بزنید.`,

 chooseFreeDomainText: `<b>خبر خوب!</b> این دامنه با اشتراک شما رایگان است. آیا می‌خواهید آن را دریافت کنید؟`,

 chooseDomainToBuy: text =>
 `نام دامنه خود را وارد کنید (مثلاً <code>mysite.com</code>)\n\n💰 قیمت از $30/سال${text}`,
 askDomainToUseWithShortener: `👉 <b>دامنه خود را در بالا تأیید کنید.</b>\n\nآیا می‌خواهید <b>کوتاه‌کننده URL</b> را برای این دامنه فعال کنید (تا لینک‌های کوتاه مثل <code>yourdomain.com/abc</code> به نظر برسند)؟\n\n✅ <b>بله</b> — آن را ثبت کنید <i>و</i> DNS آن را برای لینک‌های کوتاه به‌طور خودکار تنظیم کنید.\n❌ <b>خیر</b> — فقط آن را ثبت کنید <i>(توصیه می‌شود)</i>. می‌توانید کوتاه‌کننده را هر زمان بعداً از 📂 دامنه‌های من فعال کنید.`,
 blockUser: `لطفاً نام کاربری که باید مسدود شود را به اشتراک بگذارید.`,
 unblockUser: `لطفاً نام کاربری که باید رفع انسداد شود را به اشتراک بگذارید.`,
 blockedUser: `در حال حاضر از استفاده از ربات مسدود شده‌اید. لطفاً روی 💬 پشتیبانی ضربه بزنید. بیشتر بدانید ${TG_HANDLE}.`,

 greet: `${CHAT_BOT_BRAND} — کوتاه‌کننده URL، دامنه‌ها، سرنخ‌های تلفنی و بیشتر.

🎁 ${FREE_LINKS} لینک آزمایشی رایگان — /start
💬 پشتیبانی: روی پشتیبانی ضربه بزنید`,

 linkExpired: `این لینک کوتاه منقضی شده و دیگر فعال نیست. لطفاً برای هرگونه سؤال با ما تماس بگیرید.
با احترام،
تیم ${CHAT_BOT_BRAND}
بیشتر بدانید: ${TG_CHANNEL}`,

 successPayment: `پرداخت با موفقیت انجام شد! اکنون می‌توانید این پنجره را ببندید.`,

 welcome: `از انتخاب ${CHAT_BOT_NAME} متشکریم! لطفاً یک گزینه را از زیر انتخاب کنید:`,
 welcomeFreeTrial: `خوش آمدید! 🎉

شما ${FREE_LINKS} لینک رایگان Shortit دارید.

برای اشتراک:
• کوتاه‌سازی URL نامحدود
• رایگان 
• اعتبارسنجی شماره تلفن آمریکا

برای شروع روی زیر ضربه بزنید! ⬇️`,

 unknownCommand: `دستور پیدا نشد. /start را فشار دهید یا روی 💬 پشتیبانی ضربه بزنید. بیشتر بدانید ${TG_HANDLE}.`,

 support: `نیاز به کمک دارید؟ روی 💬 پشتیبانی ضربه بزنید تا با ما چت کنید. بیشتر بدانید ${TG_HANDLE}.`,

 joinChannel: `📢 برای به‌روزرسانی‌های محصول، ویژگی‌های جدید و پیشنهادات ویژه به کانال ما بپیوندید:\n\n${TG_CHANNEL}\n\nروی لینک بالا ضربه بزنید تا بپیوندید — می‌توانید هر زمان برگردید.`,

 dnsPropagated: `انتشار DNS برای {{domain}} کامل شد. اکنون می‌توانید از آن برای کوتاه‌سازی URL استفاده کنید.`,

 dnsNotPropagated: `انتشار DNS برای {{domain}} در حال انجام است و پس از اتمام به شما اطلاع داده خواهد شد. ✅`,

 domainBoughtSuccess: domain => `دامنه ${domain} اکنون متعلق به شماست. از انتخاب ما متشکریم.

با احترام،
${CHAT_BOT_NAME}`,

 domainBought: `✅ <b>مرحله ۳ از ۳ — انجام شد!</b>\n\nدامنه شما <b>{{domain}}</b> به‌طور کامل ثبت شده و به حساب شما متصل است.\n\n<i>انتشار DNS به‌طور خودکار کامل می‌شود — معمولاً ظرف ۵ دقیقه، حداکثر ۳۰ دقیقه. اکنون می‌توانید از آن استفاده کنید.</i> 🚀`,

 domainLinking: domain =>
 `✅ <b>Step 1 of 3 — Registered.</b>\n\n🔄 <b>Step 2 of 3 — Linking DNS now…</b> <i>typically &lt;60 seconds</i>\n\nFull propagation can take up to 30 min in rare cases.\nLive status: https://www.whatsmydns.net/#A/${domain}`,

 errorSavingDomain: `Error saving domain in server, tap 💬 Support. Discover more ${TG_HANDLE}.`,

 chooseDomainToManage: `Please select a domain if you wish to manage its DNS settings.`,

 chooseDomainWithShortener: `Please select or buy the domain name you would like to connect with your shortened link.`,

 viewDnsRecords: (records, domain, nameserverType) => {
 let msg = `<b>${domain}</b> — DNS Records\n`

 // NS section — only show for cloudflare or truly custom NS
 // Hide provider default nameservers (openprovider, connectreseller)
const nsRecs = records['NS']
 if (nsRecs && nsRecs.length) {
 // بررسی کنید آیا اینها نیم‌سرورهای پیش‌فرض ارائه‌دهنده هستند (باید پنهان شوند)
 const firstNS = nsRecs[0]?.recordContent || ''
 const isProviderDefault = 
 firstNS.includes('openprovider') || 
 firstNS.includes('connectreseller') ||
 firstNS.includes('registrar-servers')
 
 // NS را فقط در صورتی نمایش بده که Cloudflare یا واقعاً سفارشی باشد (نه پیش‌فرض ارائه‌دهنده)
 if (!isProviderDefault && (nameserverType === 'cloudflare' || nameserverType === 'custom')) {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : 'سفارشی'
 msg += `\n<b>نیم‌سرورها</b> <i>(${provider})</i>\n`
 for (let i = 0; i < nsRecs.length; i++) {
 msg += ` NS${i + 1}: <code>${nsRecs[i].recordContent || '—'}</code>\n`
}
 msg += `<i>از "🔄 مدیریت نیم‌سرورها" برای تغییر استفاده کنید.</i>\n`
 }
 }

 // انواع رکورد دیگر
 const otherTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'SRV', 'CAA']
 for (const type of otherTypes) {
 let recs = records[type]
 if (!recs || !recs.length) continue
 // رکوردهای Railway CNAME را با برچسب shortener نمایش بده به جای پنهان کردن آنها
 msg += `\n<b>${type}</b>\n`
 for (const r of recs) {
 const idx = `<b>${r.index}.</b>`
 const host = r.recordName && r.recordName !== domain ? r.recordName : '@'
const isShortenerCNAME = type === 'CNAME' && r.recordContent && r.recordContent.includes('.up.railway.app')
 if (type === 'MX') {
 const pri = r.priority !== undefined ? ` [pri:${r.priority}]` : ''
 msg += `${idx} ${host}${pri} → ${r.recordContent || '—'}\n`
 } else if (type === 'TXT') {
 const val = r.recordContent ? (r.recordContent.length > 50 ? r.recordContent.substring(0, 50) + '…' : r.recordContent) : '—'
 msg += `${idx} ${host} → ${val}\n`
 } else if (type === 'SRV') {
 msg += `${idx} ${r.recordName || ''} → ${r.recordContent || '—'}\n`
 } else if (isShortenerCNAME) {
 msg += `${idx} ${host} → 🔗 کوتاه‌کننده URL <i>(${r.recordContent})</i>\n`
 } else {
 msg += `${idx} ${host} → ${r.recordContent || '—'}\n`
 }
 }
}
 const hasAny = ['NS', ...otherTypes].some(t => records[t]?.length)
 if (!hasAny) msg += '\nهیچ رکوردی یافت نشد.\n'
 return msg
 },
 addDns: 'افزودن رکورد DNS',
 updateDns: 'ویرایش رکورد DNS',
 deleteDns: 'حذف رکورد DNS',
 quickActions: 'اقدامات سریع',
 activateShortener: '🔗 فعال‌سازی برای کوتاه‌کننده URL',
 deactivateShortener: '🔗 غیرفعال‌سازی کوتاه‌کننده URL',
 mx: 'رکورد MX',
 txt: 'رکورد TXT',
 'MX Record': 'MX',
 'TXT Record': 'TXT',

 // Digital Products
 digitalProductsSelect: `🛒 <b>محصولات دیجیتال</b>

حساب‌های تأییدشده، فوری تحویل داده می‌شوند.

<b>مخابرات:</b> Twilio · Telnyx (SMS، Voice، SIP)
<b>ابری:</b> AWS · Google Cloud
<b>ایمیل:</b> Google Workspace · Zoho · IONOS SMTP
<b>موبایل:</b> USA T-Mobile eSIM (اتوماتیک، ۷۵ دلار در ماه)

از زیر انتخاب کنید:`,
 dpTwilioMain: `📞 حساب اصلی Twilio — $${DP_PRICE_TWILIO_MAIN}`,
 dpTwilioSub: `📞 حساب فرعی Twilio — $${DP_PRICE_TWILIO_SUB}`,
 dpTelnyxMain: `📡 حساب اصلی Telnyx — $${DP_PRICE_TELNYX_MAIN}`,
 dpTelnyxSub: `📡 حساب فرعی Telnyx — $${DP_PRICE_TELNYX_SUB}`,
 dpGworkspaceNew: `📧 ادمین Google Workspace (دامنه جدید) — $${DP_PRICE_GWORKSPACE_NEW}`,
 dpGworkspaceAged: `📧 ادمین Google Workspace (دامنه قدیمی) — $${DP_PRICE_GWORKSPACE_AGED}`,
 dpEsim: `📱 USA T-Mobile eSIM — $75/month`,
 dpZohoNew: `📧 Zoho Mail (دامنه جدید) — $${DP_PRICE_ZOHO_NEW}`,
 dpZohoAged: `📧 Zoho Mail (دامنه قدیمی) — $${DP_PRICE_ZOHO_AGED}`,
 dpAwsMain: `☁️ حساب اصلی AWS — $${DP_PRICE_AWS_MAIN}`,
 dpAwsSub: `☁️ حساب فرعی AWS — $${DP_PRICE_AWS_SUB}`,
 dpGcloudMain: `🌐 حساب اصلی Google Cloud — $${DP_PRICE_GCLOUD_MAIN}`,
 dpGcloudSub: `🌐 حساب فرعی Google Cloud — $${DP_PRICE_GCLOUD_SUB}`,
 dpIonosSmtp: `📧 IONOS SMTP — $${DP_PRICE_IONOS_SMTP}`,
 dpPaymentPrompt: (product, price) => {
 const descriptions = {
 'Twilio Main Account': 'حساب کامل Twilio در سطح مالک با دسترسی به کنسول، کلیدهای API و امکان تخصیص شماره تلفن، ارسال SMS/MMS و برقراری تماس صوتی. شامل ۲ Sender ID و ۲۰ دلار اعتبار.\n\nدریافتی شما: اطلاعات ورود + API SID و Auth Token.',
 'Twilio Sub-Account': 'حساب فرعی Twilio با ورود به کنسول و اعتبارنامه‌های API اختصاصی برای SMS، صوت و تخصیص شماره تلفن. شامل ۲ Sender ID و ۲۰ دلار اعتبار.\n\nدریافتی شما: اطلاعات ورود، Account SID و Auth Token.',
 'Telnyx Main Account': 'حساب کامل Telnyx در سطح مالک با دسترسی به Mission Control Portal. تخصیص شماره، پیکربندی SIP trunking، پیام‌رسانی و صوت. شامل ۲ Sender ID و ۲۰ دلار اعتبار.\n\nدریافتی شما: اطلاعات ورود + کلید API.',
 'Telnyx Sub-Account': 'حساب فرعی Telnyx با ورود به Mission Control Portal و دسترسی API برای پیام‌رسانی، صوت و مدیریت شماره. شامل ۲ Sender ID و ۲۰ دلار اعتبار.\n\nدریافتی شما: اطلاعات ورود + کلید API.',
 'AWS Main Account': 'حساب کامل AWS در سطح root با دسترسی کنسولی به تمامی سرویس‌ها — EC2، S3، Lambda، SES و بیشتر.\n\nدریافتی شما: ایمیل root، رمز عبور و راه‌اندازی MFA.',
 'AWS Sub-Account': 'حساب فرعی AWS (عضو Organizations) با ورود کامل به کنسول و دسترسی به سرویس‌های اصلی — EC2، S3، Lambda و بیشتر.\n\nدریافتی شما: اطلاعات ورود و دسترسی IAM.',
 'Google Cloud Main Account': 'حساب کامل Google Cloud در سطح مالک با فعال‌سازی پرداخت. دسترسی به Compute Engine، Cloud Storage، BigQuery و تمامی سرویس‌های GCP.\n\nدریافتی شما: اطلاعات ورود.',
 'Google Cloud Sub-Account': 'پروژه Google Cloud با ورود کامل به کنسول و دسترسی در سطح ویرایشگر. شامل Compute، ذخیره‌سازی و دسترسی API.\n\nدریافتی شما: اطلاعات ورود و کلید service account.',
 'Google Workspace (New Domain)': 'راه‌اندازی ایمیل سازمانی Google Workspace روی دامنه‌ای تازه ثبت‌شده. ایمیل سفارشی @yourdomain با Gmail، Drive، Docs و Meet.\n\nدریافتی شما: ورود ادمین + اطلاعات دامنه.',
 'Google Workspace (Aged Domain)': 'Google Workspace روی دامنه‌ای قدیمی/معتبر برای تحویل‌پذیری بهتر. ایمیل سازمانی با مجموعه کامل Google.\n\nدریافتی شما: ورود ادمین + اطلاعات دامنه.',
 'Zoho Mail (New Domain)': 'ایمیل حرفه‌ای Zoho Mail روی دامنه جدید. ایمیل سفارشی @yourdomain با تقویم، مخاطبین و فضای ذخیره‌سازی فایل.\n\nدریافتی شما: ورود ادمین + راه‌اندازی دامنه.',
 'Zoho Mail (Aged Domain)': 'Zoho Mail روی دامنه قدیمی برای بهبود اعتبار فرستنده. ایمیل حرفه‌ای با مجموعه کامل Zoho.\n\nدریافتی شما: ورود ادمین + اطلاعات دامنه.',
 }
 const desc = descriptions[product] || ''
 return `💰 <b>سفارش: ${product}</b>\n\n💵 قیمت: <b>$${price}</b>${desc ? '\n\n' + desc : ''}\n\nروش پرداخت را انتخاب کنید:\n\n<i>💡 با ₿ رمزارز مبلغ کامل را بپردازید، یا از 👛 کیف پول خود استفاده کنید (در صورت کمبود موجودی، ابتدا 💵 واریز کنید).</i>`
 },
 dpOrderConfirmed: (product, price, orderId) => `✅ <b>سفارش تأیید شد!</b>\n\n🛒 محصول: <b>${product}</b>\n💵 مبلغ: <b>$${price}</b>\n🆔 شناسه سفارش: <code>${orderId}</code>\n\n⏱ <b>به زودی همین‌جا در این چت تحویل می‌دهیم.</b>\nبرای درخواست‌های فوری، روی 💬 پشتیبانی ضربه بزنید.\n\n💡 <b>به حساب‌های بیشتری نیاز دارید؟</b> کاتالوگ کامل ما را در 🛒 محصولات دیجیتال مرور کنید.`,

 // Virtual Card
 vcWelcome: `💳 <b>کارت دبیت مجازی</b>\n\nکارت مجازی خود را با مبلغ دلخواه شارژ کنید.\n\n✅ در سراسر جهان به صورت آنلاین کار می‌کند\n✅ تحویل فوری\n✅ $50 – $1,000\n\nیک مبلغ انتخاب کنید یا مبلغ دلخواه وارد نمایید:`,
 vcInvalidAmount: `❌ لطفاً مبلغی معتبر بین <b>$50</b> و <b>$1,000</b> وارد کنید.`,
 vcAskAddress: `📬 <b>آدرس ارسال</b>\n\nآدرس کامل خود را به فرمت بین‌المللی وارد کنید:\n\n<i>مثال:\nJohn Doe\n123 Main Street, Apt 4B\nNew York, NY 10001\nUnited States</i>`,
 vcAddressTooShort: `❌ آدرس بسیار کوتاه به نظر می‌رسد. لطفاً نام کامل، خیابان، شهر، کد پستی و کشور را وارد کنید.`,
 vcOrderSummary: (amount, fee, total) => `📋 <b>خلاصه سفارش</b>\n\n💳 شارژ کارت مجازی: <b>$${amount}</b>\n💰 کارمزد خدمات: <b>$${fee.toFixed(2)}</b>${amount < 200 ? ' (حداقل $20)' : ' (10%)'}\n━━━━━━━━━━━━━━━━━\n💵 <b>مجموع: $${total.toFixed(2)}</b>\n\nروش پرداخت را انتخاب کنید:\n\n<i>💡 با ₿ رمزارز مبلغ کامل را پرداخت کنید، یا از 👛 کیف پول خود استفاده کنید (در صورت کمبود موجودی، ابتدا 💵 واریز کنید).</i>`,
 vcOrderConfirmed: (amount, total, orderId) => `✅ <b>سفارش کارت مجازی تأیید شد!</b>\n\n💳 شارژ کارت: <b>$${amount}</b>\n💵 مجموع پرداخت‌شده: <b>$${total.toFixed(2)}</b>\n🆔 شناسه سفارش: <code>${orderId}</code>\n\n⏱ <b>جزئیات کارت شما به زودی همین‌جا ارسال می‌شود.</b>\nبرای درخواست‌های فوری، روی 💬 پشتیبانی ضربه بزنید.`,
 leadsFileNumbersOnly: `📄 <b>فایل ۱ — شماره‌های تلفن</b>\nتمام شماره‌های تأییدشده در دسته شما.`,
 leadsFileWithNames: (count) => `📄 <b>فایل ۲ — شماره‌ها + نام صاحب تلفن (${count} مورد مطابقت)</b>\nاین لیدها شامل نام واقعی صاحب شماره هستند. آن‌ها را به صورت شخصی خطاب کنید — این کار اعتماد فوری ایجاد می‌کند و نرخ پاسخ شما را به طور چشمگیری افزایش می‌دهد.`,
 addDnsTxt: 'نوع رکورد را انتخاب کنید:',
 updateDnsTxt: 'رکوردی که می‌خواهید به‌روزرسانی کنید را انتخاب کنید:',
 deleteDnsTxt: 'رکوردی که می‌خواهید حذف کنید را انتخاب کنید:',
 confirmDeleteDnsTxt: 'آیا مطمئن هستید که می‌خواهید این رکورد را حذف کنید؟',
 a: 'A Record',
cname: 'رکورد CNAME',
 ns: 'رکورد NS',
 'A Record': 'A',
 'CNAME Record': 'CNAME',
 'NS Record': 'NS',
 askDnsHostname: {
 A: '<b>افزودن رکورد A</b>\n\nنام هاست را وارد کنید:\nمثال: <b>@</b> برای ریشه، یا <b>api</b>، <b>blog</b>، <b>www</b>\n\n<i>نکته: فقط زیربرچسب را وارد کنید — دامنه کامل را ننویسید.</i>',
 CNAME: '<b>افزودن رکورد CNAME</b>\n\nنام هاست زیردامنه را وارد کنید:\nمثال: <b>www</b>، <b>api</b>، <b>blog</b>\n\nتوجه: CNAME برای ریشه (@) قابل استفاده نیست\n<i>نکته: فقط زیربرچسب را وارد کنید — دامنه کامل را ننویسید.</i>',
 MX: '<b>افزودن رکورد MX</b> (مرحله ۱/۳)\n\nنام هاست را وارد کنید:\nمثال: <b>@</b> برای ایمیل ریشه، یا یک زیردامنه\n\n<i>نکته: فقط زیربرچسب را وارد کنید — دامنه کامل را ننویسید.</i>',
 TXT: '<b>افزودن رکورد TXT</b> (مرحله ۱/۲)\n\nنام هاست را وارد کنید:\nمثال: <b>@</b> برای ریشه، یا <b>_dmarc</b>، <b>mail</b>\n\n<i>نکته: فقط زیربرچسب را وارد کنید — دامنه کامل را ننویسید.</i>',
 NS: '<b>افزودن رکورد NS</b>\n\nنام‌سرور را وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>',
 AAAA: '<b>افزودن رکورد AAAA</b> (مرحله ۱/۲)\n\nنام هاست را وارد کنید:\nمثال: <b>@</b> برای ریشه، یا <b>api</b>، <b>blog</b>\n\n<i>نکته: فقط زیربرچسب را وارد کنید — دامنه کامل را ننویسید.</i>',
 },
 askDnsValue: {
 A: 'آدرس IPv4 را وارد کنید:\nمثال: <b>192.168.1.1</b>',
CNAME: 'دامنه مقصد را وارد کنید:\nمثال: <b>myapp.railway.app</b>',
 MX: '<b>مرحله ۲ از ۳</b> — سرور ایمیل را وارد کنید:\nمثال: <b>ASPMX.L.GOOGLE.COM</b>',
 TXT: '<b>مرحله ۲ از ۲</b> — مقدار TXT را وارد کنید:\nمثال: <b>v=spf1 include:_spf.google.com ~all</b>',
 AAAA: '<b>مرحله ۲ از ۲</b> — آدرس IPv6 را وارد کنید:\nمثال: <b>2001:db8::1</b>',
 },
 askMxPriority: '<b>مرحله ۳ از ۳</b> — اولویت MX را وارد کنید (عدد کمتر = اولویت بالاتر):\nمثال: <b>10</b> برای اصلی، <b>20</b> برای پشتیبان',
 askDnsContent: {
 NS: '<b>افزودن رکورد NS</b>\n\nهاست‌نام nameserver را وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>',
 'NS Record': '<b>افزودن رکورد NS</b>\n\nهاست‌نام nameserver را وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>\n\nتوجه: حداکثر ۴ رکورد NS مجاز است. اگر به سقف رسیده‌اید از به‌روزرسانی استفاده کنید.',
 },
 askUpdateDnsContent: {
 A: (current) => `<b>به‌روزرسانی رکورد A</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nآدرس IPv4 جدید را وارد کنید:\nمثال: <b>192.168.1.1</b>`,
 'A Record': (current) => `<b>به‌روزرسانی رکورد A</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nآدرس IPv4 جدید را وارد کنید:\nمثال: <b>192.168.1.1</b>`,
 CNAME: (current) => `<b>به‌روزرسانی رکورد CNAME</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nدامنه مقصد جدید را وارد کنید:\nمثال: <b>myapp.railway.app</b>`,
 'CNAME Record': (current) => `<b>به‌روزرسانی رکورد CNAME</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nدامنه مقصد جدید را وارد کنید:\nمثال: <b>myapp.railway.app</b>`,
NS: (current) => `<b>به‌روزرسانی رکورد NS</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nنام‌سرور جدید را وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>`,
 'NS Record': (current) => `<b>به‌روزرسانی رکورد NS</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nنام‌سرور جدید را وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>`,
 MX: (current) => `<b>به‌روزرسانی رکورد MX</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nسرور ایمیل جدید را وارد کنید:\nمثال: <b>ASPMX.L.GOOGLE.COM</b>`,
 'MX Record': (current) => `<b>به‌روزرسانی رکورد MX</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nسرور ایمیل جدید را وارد کنید:\nمثال: <b>ASPMX.L.GOOGLE.COM</b>`,
 TXT: (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>به‌روزرسانی رکورد TXT</b>\nفعلی: <b>${display}</b>\n\nمقدار TXT جدید را وارد کنید:\nمثال: <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 'TXT Record': (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>به‌روزرسانی رکورد TXT</b>\nفعلی: <b>${display}</b>\n\nمقدار TXT جدید را وارد کنید:\nمثال: <b>v=spf1 include:_spf.google.com ~all</b>`
 },
 AAAA: (current) => `<b>به‌روزرسانی رکورد AAAA</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nآدرس IPv6 جدید را وارد کنید:\nمثال: <b>2001:db8::1</b>`,
 'AAAA Record': (current) => `<b>به‌روزرسانی رکورد AAAA</b>\nفعلی: <b>${current || 'N/A'}</b>\n\nآدرس IPv6 جدید را وارد کنید:\nمثال: <b>2001:db8::1</b>`,
 },

 dnsRecordSaved: 'رکورد با موفقیت اضافه شد. تغییرات DNS ممکن است تا ۲۴ ساعت برای انتشار زمان ببرد.',
 dnsRecordDeleted: 'رکورد با موفقیت حذف شد.',
 dnsRecordUpdated: 'رکورد با موفقیت به‌روزرسانی شد. تغییرات DNS ممکن است تا ۲۴ ساعت برای انتشار زمان ببرد.',
 // DNS proxied-choice (per-record CF orange/grey cloud) — @LevelupwithME 2026-07-06
 dnsProxiedChoiceLabelDnsOnly: '⚪ فقط DNS (پیشنهادی)',
 dnsProxiedChoiceLabelProxied: '🟠 پروکسی از طریق Cloudflare',
 dnsProxiedChoiceAsk: (recordType, value) => (
   `⚙️ <b>حالت Cloudflare برای این رکورد ${recordType}</b>\n\n` +
   `Target: <code>${value}</code>\n\n` +
   '⚪  <b>DNS Only</b> (توصیه شده)\n' +
   '<i>جستجوها مستقیماً IP اصلی شما را برمی‌گردانند. بهترین گزینه برای اشاره به VPS شخصی، سرور ایمیل، یا زمانی که به دسترسی مستقیم به هدف نیاز دارید.</i>\n\n' +
   '🟠  <b>پروکسی از طریق Cloudflare</b>\n' +
   '<i>Cloudflare جلوی سرور اصلی شما قرار می‌گیرد — SSL رایگان، کش CDN، محافظت در برابر DDoS، و IP اصلی شما پنهان می‌ماند. بهترین گزینه برای وب‌سایت‌های عمومی.</i>'
 ),
dnsProxiedChoiceInvalid: 'لطفاً یکی از دکمه‌ها را انتخاب کنید: ⚪ DNS Only یا 🟠 Proxied through Cloudflare.',
 // اقدامات سریع DNS
 dnsQuickActionMenu: 'یک پیکربندی از پیش تعریف‌شده انتخاب کنید:',
 dnsQuickAskIp: 'آدرس IPv4 سرور خود را وارد کنید:\nمثال: <b>192.168.1.1</b>',
 dnsQuickAskSubdomainName: 'نام زیردامنه را وارد کنید:\nمثال: <b>blog</b>، <b>api</b>، <b>shop</b>',
 dnsQuickAskSubdomainTargetType: domain => `<b>${domain}</b> باید به کجا اشاره کند؟`,
 dnsQuickSubdomainIp: 'آدرس IP',
 dnsQuickSubdomainDomain: 'نام دامنه',
 dnsQuickAskSubdomainIp: 'آدرس IPv4 مربوط به زیردامنه را وارد کنید:',
 dnsQuickAskSubdomainDomain: 'دامنه مقصد را وارد کنید (مثال: <b>myapp.railway.app</b>):',
 dnsQuickAskVerificationTxt: 'مقدار TXT تأیید ارائه‌شده توسط سرویس خود را وارد کنید:',
 dnsQuickGoogleDone: domain => `<b>تنظیمات DNS ایمیل Google Workspace برای ${domain} انجام شد!</b>\n\n۵ رکورد MX و یک رکورد TXT برای SPF اضافه شدند.\nانتشار تغییرات ۲۴ تا ۴۸ ساعت زمان می‌برد.`,
 dnsQuickZohoDone: domain => `<b>تنظیمات DNS ایمیل Zoho Mail برای ${domain} انجام شد!</b>\n\n۳ رکورد MX و یک رکورد TXT برای SPF اضافه شدند.\nانتشار تغییرات ۲۴ تا ۴۸ ساعت زمان می‌برد.`,
 dnsQuickPointToIpDone: (domain, ip) => `<b>انجام شد!</b>\n\nرکورد A: ${domain} → ${ip}\nرکورد CNAME: www.${domain} → ${domain}`,
 dnsQuickVerificationDone: 'رکورد TXT تأیید اضافه شد!',
dnsQuickSubdomainDone: (sub, target, type) => `<b>انجام شد!</b> رکورد ${type} ایجاد شد:\n${sub} → ${target}`,
 dnsQuickSetupProgress: (step, total) => `در حال راه‌اندازی... (${step}/${total})`,
 dnsQuickSetupError: (step) => `خطا در مرحله: ${step}. ممکن است برخی رکوردها ایجاد شده باشند. لطفاً رکوردهای DNS را بررسی و دوباره امتحان کنید.`,
 dnsInvalidIpv4: 'آدرس IPv4 نامعتبر است. لطفاً یک IP معتبر وارد کنید (مثلاً 192.168.1.1):',
 dnsInvalidHostname: 'نام هاست نامعتبر است. از حروف و اعداد، خط تیره، زیرخط و نقطه استفاده کنید (مثلاً api، _dmarc، neo1._domainkey):',
 dnsHostnameForeignDomain: (zone) => `این نام هاست به دامنه دیگری تعلق دارد. برای <b>${zone}</b> فقط زیربرچسب را وارد کنید (مثلاً <b>www</b>، <b>api</b>) یا <b>@</b> برای ریشه.`,
 dnsFixDuplicatedBtn: (n) => `🛠️ رفع ${n} رکورد${n > 1 ? ' معیوب' : ' معیوب'}`,
 dnsFixDuplicatedHeader: (zone) => `🛠️ <b>پاکسازی: رکوردهای تکراری دامنه در ${zone}</b>\n\nرکوردهایی یافتیم که نام دامنه دو بار در آن‌ها تکرار شده است (مثلاً <code>www.${zone}.${zone}</code>). این معمولاً زمانی اتفاق می‌افتد که نام کامل دامنه به عنوان هاست وارد شده باشد.\n\nروی <b>✅ رفع خودکار</b> ضربه بزنید تا به زیربرچسب صحیح تغییر نام داده شوند (مثلاً <code>www</code>) و مقادیرشان حفظ شود. روی <b>🗑️ حذف</b> ضربه بزنید تا کاملاً حذف شوند.`,
 dnsFixDuplicatedAutoFixBtn: '✅ رفع خودکار همه',
 dnsFixDuplicatedDeleteBtn: '🗑️ حذف همه',
 dnsFixDuplicatedDone: (fixed, deleted, failed) => `<b>انجام شد.</b>\n\n✅ رفع خودکار: ${fixed}\n🗑️ حذف شده: ${deleted}${failed ? `\n⚠️ ناموفق: ${failed}` : ''}\n\nتغییرات DNS ممکن است تا ۲۴ ساعت زمان ببرد تا اعمال شود.`,
 dnsInvalidMxPriority: 'اولویت نامعتبر است. یک عدد بین ۱ و ۶۵۵۳۵ وارد کنید:',
 dnsQuickActions,

 // فاز ۲: AAAA، SRV، CAA
aaaa: 'AAAA Record',
 'AAAA Record': 'AAAA',
 srvRecord: 'SRV Record',
 'SRV Record': 'SRV',
 caaRecord: 'CAA Record',
 'CAA Record': 'CAA',
 dnsInvalidIpv6: 'آدرس IPv6 نامعتبر است. لطفاً یک IPv6 معتبر وارد کنید (مثلاً 2001:db8::1):',
 dnsInvalidPort: 'شماره پورت نامعتبر است. عددی بین 1 تا 65535 وارد کنید:',
 dnsInvalidWeight: 'وزن نامعتبر است. عددی بین 0 تا 65535 وارد کنید:',
 dnsSrvCaaNotSupported: 'رکوردهای SRV و CAA توسط DNS فعلی دامنه شما پشتیبانی نمی‌شوند. برای استفاده از این نوع رکوردها به Cloudflare DNS سوئیچ کنید (🔄 مدیریت نیم‌سرورها).',
 // راهنمای گام‌به‌گام SRV
 askSrvService: '<b>افزودن رکورد SRV</b> (مرحله 1/5)\n\nسرویس و پروتکل را وارد کنید:\nمثلاً <b>_sip._tcp</b>، <b>_http._tcp</b>، <b>_minecraft._tcp</b>',
 askSrvTarget: '<b>مرحله 2/5</b> — هاست‌نیم مقصد را وارد کنید:\nمثلاً <b>sipserver.example.com</b>',
 askSrvPort: '<b>مرحله 3/5</b> — شماره پورت را وارد کنید:\nمثلاً <b>5060</b>، <b>443</b>، <b>25565</b>',
 askSrvPriority: '<b>مرحله 4/5</b> — اولویت را وارد کنید (کمتر = اولویت بالاتر):\nمثلاً <b>10</b>',
askSrvWeight: '<b>مرحله ۵/۵</b> — وزن را وارد کنید (برای توازن بار):\nمثال: <b>100</b>',
 // راهنمای گام‌به‌گام CAA
 askCaaHostname: '<b>افزودن رکورد CAA</b> (مرحله ۱/۳)\n\nنام میزبان را وارد کنید:\nمثال: <b>@</b> برای دامنه اصلی',
 askCaaTag: '<b>مرحله ۲/۳</b> — تگ CAA را انتخاب کنید:',
 caaTagIssue: 'issue — مجوز دادن به یک CA',
 caaTagIssuewild: 'issuewild — مجوز دادن به wildcard',
 caaTagIodef: 'iodef — آدرس URL گزارش تخلف',
 'issue — Authorize a CA': 'issue',
 'issuewild — Authorize wildcard': 'issuewild',
 'iodef — Violation report URL': 'iodef',
 askCaaValue: (tag) => {
 if (tag === 'iodef') return '<b>مرحله ۳/۳</b> — آدرس URL گزارش را وارد کنید:\nمثال: <b>mailto:admin@example.com</b>'
 return '<b>مرحله ۳/۳</b> — دامنه CA مجاز را وارد کنید:\nمثال: <b>letsencrypt.org</b>، <b>digicert.com</b>'
 },
 // راهنمای چند مرحله‌ای hostname برای انواع جدید
 askDnsHostnameAaaa: 'نام میزبان را وارد کنید (@ برای ریشه، یا زیردامنه مثل <b>api</b>، <b>blog</b>):',
 askDnsValueAaaa: 'آدرس IPv6 را وارد کنید (مثال: <b>2001:db8::1</b>):',

 // بررسی اعتبارسنجی DNS
 checkDns: 'بررسی DNS',
 dnsChecking: (domain) => `در حال بررسی DNS برای <b>${domain}</b>...`,
 dnsRecordLive: (type, value) => `رکورد <b>${type}</b> فعال است و به <b>${value}</b> اشاره می‌کند.`,
 dnsRecordPropagating: (type) => `رکورد <b>${type}</b> هنوز در حال انتشار است. این ممکن است تا ۲۴ تا ۴۸ ساعت طول بکشد.`,
 dnsHealthTitle: (domain) => `<b>بررسی سلامت DNS — ${domain}</b>\n`,
 dnsHealthRow: (type, found, count, answers) => {
 if (!found) return ` ${type}: —`
 const vals = answers.slice(0, 2).join(', ')
 const more = answers.length > 2 ? ` +${answers.length - 2} مورد دیگر` : ''
 return ` ${type}: ${count} رکورد${count > 1 ? '' : ''} (${vals}${more})`
 },
 dnsHealthSummary: (resolving, total) => resolving > 0
 ? `\n✅ وضعیت: <b>فعال</b> — ${resolving}/${total} نوع رکورد در حال تفسیر است.`
 : `\n⚠️ وضعیت: <b>غیرفعال</b> — این دامنه هنوز در هیچ جایی تفسیر نمی‌شود. ممکن است در رجیستری معلق باشد یا هنوز در حال فعال‌سازی باشد.`,
 dnsCheckError: 'جستجوی DNS ناموفق بود. لطفاً بعداً دوباره امتحان کنید.',

 // مدیریت Nameserverها (منوی یکپارچه NS)
 manageNameservers: '🔄 مدیریت Nameserverها',
 manageNsMenu: (domain, nsRecords, nameserverType) => {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : nameserverType === 'custom' ? 'سفارشی' : 'پیش‌فرض ارائه‌دهنده'
 let msg = `<b>🔄 Nameserverها — ${domain}</b>\n\n`
 msg += `<b>ارائه‌دهنده:</b> ${provider}\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>Nameserverهای فعلی:</b>\n`
 nsRecords.forEach((ns, i) => {
 msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n`
 })
 } else {
 msg += `<i>هیچ رکورد nameserver‌ای یافت نشد.</i>\n`
 }
 msg += `\nیک عملیات را از زیر انتخاب کنید:`
 return msg
 },
 setCustomNs: '✏️ تنظیم Nameserverهای سفارشی',
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ تنظیم Nameserverهای سفارشی برای ${domain}</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>فعلی:</b>\n`
 nsRecords.forEach((ns, i) => {
 msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n`
 })
msg += '\n'
 }
 msg += `نیم‌سرورهای جدید را وارد کنید (یک در هر خط، حداقل ۲، حداکثر ۴):\n\n<i>مثال:\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare: نام‌ها را <b>دقیقاً همان‌طور که</b> در داشبورد نمایش داده می‌شود کپی کنید (مثلاً <code>leanna.ns.cloudflare.com</code>). پیشوند اضافی <code>ns1./ns2.</code> <b>اضافه نکنید</b>.</i>`
 return msg
 },

 // Switch to Cloudflare
 switchToCf: '☁️ تغییر به Cloudflare',
 switchToCfConfirm: (domain) => `<b>تغییر ${domain} به DNS Cloudflare؟</b>\n\nاین کار موارد زیر را انجام می‌دهد:\n1. ایجاد یک zone در Cloudflare برای دامنه شما\n2. انتقال رکوردهای DNS موجود به Cloudflare\n3. به‌روزرسانی نیم‌سرورهای شما در ثبت‌کننده\n\nانتشار DNS ممکن است تا ۲۴ تا ۴۸ ساعت طول بکشد.\n\nادامه می‌دهید؟`,
 switchToCfProgress: (domain) => `⏳ در حال تغییر <b>${domain}</b> به DNS Cloudflare…`,
 switchToCfSuccess: (domain, ns) => `<b>انجام شد!</b> ${domain} اکنون روی DNS Cloudflare است.\n\n<b>نیم‌سرورهای جدید:</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToCfError: (error) => `❌ تغییر به Cloudflare ناموفق بود: ${error}`,
 switchToCfAlreadyCf: 'این دامنه در حال حاضر از DNS Cloudflare استفاده می‌کند.',

 // تغییر به پیش‌فرض ارائه‌دهنده
switchToProviderDefault: '🏠 تغییر به DNS ارائه‌دهنده',
 switchToProviderConfirm: (domain) => `<b>بازگشت ${domain} به DNS ارائه‌دهنده؟</b>\n\nاین عملیات:\n1. رکوردهای DNS موجود را از Cloudflare به رجیسترار منتقل می‌کند\n2. نیم‌سرورهای پیش‌فرض را در رجیسترار بازیابی می‌کند\n3. زون Cloudflare را حذف می‌کند\n\nانتشار DNS ممکن است تا ۲۴ تا ۴۸ ساعت طول بکشد.\n\nادامه می‌دهید؟`,
 switchToProviderProgress: (domain) => `⏳ در حال تغییر <b>${domain}</b> به DNS ارائه‌دهنده…`,
 switchToProviderSuccess: (domain, ns) => `<b>انجام شد!</b> ${domain} اکنون از DNS ارائه‌دهنده استفاده می‌کند.\n\n<b>نیم‌سرورهای جدید:</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToProviderError: (error) => `❌ تغییر به DNS ارائه‌دهنده ناموفق بود: ${error}`,
 switchToProviderAlreadyProvider: 'این دامنه در حال حاضر از DNS پیش‌فرض ارائه‌دهنده استفاده می‌کند.',

 // درخواست تنظیم به‌روزرسانی NS
 updateNsPrompt: (nsRecords, slotIndex) => {
 let msg = `<b>به‌روزرسانی نیم‌سرور — اسلات NS${slotIndex}</b>\n\n<b>چیدمان فعلی:</b>\n`
 for (let i = 0; i < nsRecords.length; i++) {
 const marker = (i + 1) === slotIndex ? ' ← در حال به‌روزرسانی' : ''
 msg += ` NS${i + 1}: <code>${nsRecords[i].recordContent || '—'}</code>${marker}\n`
 }
 msg += `\nنیم‌سرور جدید را برای <b>NS${slotIndex}</b> وارد کنید:\nمثال: <b>ns1.cloudflare.com</b>`
return msg
 },

 provideLink: 'لطفاً یک URL معتبر وارد کنید. مثال: https://google.com',

 comingSoonWithdraw: `برداشت وجه هنوز در دسترس نیست. نیاز به کمک دارید؟ روی 💬 پشتیبانی ضربه بزنید.`,
 promoOptOut: `شما از پیام‌های تبلیغاتی لغو اشتراک شدید. برای اشتراک مجدد در هر زمان /start_promos را تایپ کنید.`,
 promoOptIn: `شما مجدداً در پیام‌های تبلیغاتی مشترک شدید. جدیدترین پیشنهادات و تخفیف‌های ما را دریافت خواهید کرد!`,

 selectCurrencyToDeposit: `💵 مبلغ واریز (حداقل $10):`,

 depositNGN: `💵 مبلغ NGN را وارد کنید (حداقل ≈ $10 USD)
به طور خودکار با نرخ جاری به USD تبدیل می‌شود.`,

 depositUSD: `لطفاً مبلغ USD را وارد کنید، توجه داشته باشید که حداقل مقدار $10 است:`,
 selectCryptoToDeposit: `لطفاً یک ارز دیجیتال انتخاب کنید:\n\n<i>ℹ️ USDT (TRC20) حداقل واریز $20 نیاز دارد.</i>`,

 // نمایش زمانی که کاربر USDT-TRC20 را با مبلغ کمتر از $20 انتخاب می‌کند. امکان شارژ با
 // یک ضربه، تغییر ارز، ویرایش مبلغ یا لغو را بدون تایپ مجدد فراهم می‌کند.
 trc20MinDepositPrompt: (currentAmount, minAmount) =>
  `⚠️ <b>USDT (TRC20) حداقل $${minAmount} نیاز دارد</b>\n\n` +
  `You entered: <b>$${currentAmount}</b>\n` +
  `انتقال‌های TRC20 به ~$${minAmount}+ نیاز دارند تا کارمزدهای TRX-انرژی در سمت دریافت‌کننده به راحتی پوشش داده شود.\n\n` +
  `چه کاری می‌خواهید انجام دهید؟`,
 trc20TopUpBtn: (minAmount) => `✅ Top up to $${minAmount}`,
 trc20SwitchCryptoBtn: '🔄 انتخاب ارز دیجیتال دیگر',
 trc20EditAmountBtn: '✏️ وارد کردن مبلغ دیگر',
 trc20WhyMinBtn: '💡 چرا این حداقل مبلغ؟',
 trc20CancelBtn: '❌ Cancel',

trc20WhyMinExplanation: (minAmount) =>
  `💡 <b>چرا TRC20 به حداقل $${minAmount} نیاز دارد؟</b>\n\n` +
  `هر انتقال TRC20 USDT حدود ۵ تا ۱۵ TRX از کارمزدهای «انرژی» شبکه در سمت دریافت‌کننده می‌سوزاند. در واریزهای کوچک، کارمزدها می‌توانند ۳۰ تا ۵۰ درصد مبلغ ارسالی را ببلعند — نگه داشتن حداقل $${minAmount} تضمین می‌کند که تقریباً تمام واریز شما به کیف پولتان برسد و اعتبار نیز سریع‌تر ثبت شود.\n\n` +
  `سایر ارزها (BTC، LTC، ETH) سربار کمتری در هر انتقال دارند، بنابراین حداقلی برای آن‌ها اعمال نمی‌شود.\n\n` +
  `هنوز به کمک نیاز دارید؟ با پشتیبانی تماس بگیرید: ${APP_SUPPORT_LINK}`,

 'bank-pay-plan': (
 priceNGN,
 plan,
 ) => `لطفاً ${priceNGN} NGN را با کلیک روی دکمه «پرداخت» در زیر واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن ${plan} شما بدون هیچ مشکلی فعال خواهد شد.

با احترام،
${CHAT_BOT_NAME}`,

 bankPayDomain: (
 priceNGN,
 domain,
 ) => `لطفاً ${priceNGN} NGN را با کلیک روی دکمه «پرداخت» در زیر واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و دامنه ${domain} شما بدون هیچ مشکلی فعال خواهد شد.

با احترام،
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoPlan: (priceUsd, priceCrypto, tickerView, address, plan) =>
 `💰 <b>مبلغ پرداختی: $${Number(priceUsd).toFixed(2)} USD</b>

دقیقاً <b>${priceCrypto} ${tickerView}</b> را به آدرس زیر ارسال کنید:

<code>${address}</code>

پلن ${plan} شما پس از تأیید پرداخت (معمولاً ظرف چند دقیقه) به‌طور خودکار فعال می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoDomain: (priceUsd, priceCrypto, tickerView, address, domain) =>
 `💰 <b>مبلغ پرداختی: $${Number(priceUsd).toFixed(2)} USD</b>

دقیقاً <b>${priceCrypto} ${tickerView}</b> را به آدرس زیر ارسال کنید:

<code>${address}</code>

دامنه ${domain} شما پس از تأیید پرداخت (معمولاً ظرف چند دقیقه) به‌طور خودکار فعال می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoLeads: (priceUsd, priceCrypto, tickerView, address, label) =>
 `💰 <b>مبلغ پرداختی: $${Number(priceUsd).toFixed(2)} USD</b>

دقیقاً <b>${priceCrypto} ${tickerView}</b> را به آدرس زیر ارسال کنید:

<code>${address}</code>

${label} شما پس از تأیید پرداخت (معمولاً ظرف چند دقیقه) به‌طور خودکار تحویل داده می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoPhone: (priceUsd, priceCrypto, tickerView, address, phoneNumber) =>
 `💰 <b>مبلغ پرداختی: $${Number(priceUsd).toFixed(2)} USD</b>

Send exactly <b>${priceCrypto} ${tickerView}</b> to:

<code>${address}</code>

شماره Cloud IVR شما ${phoneNumber} به محض تأیید پرداخت به‌طور خودکار فعال می‌شود (معمولاً ظرف چند دقیقه).

Best regards,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoDigitalProduct: (priceUsd, priceCrypto, tickerView, address, product) =>
 `💰 <b>مبلغ پرداخت: $${Number(priceUsd).toFixed(2)} USD</b>

Send exactly <b>${priceCrypto} ${tickerView}</b> to:

<code>${address}</code>

سفارش شما برای <b>${product}</b> به محض تأیید پرداخت به‌طور خودکار تحویل داده می‌شود (معمولاً ظرف چند دقیقه).

Best regards,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfo: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>مبلغ پرداخت: $${Number(priceUsd).toFixed(2)} USD</b>

Send exactly <b>${priceCrypto} ${tickerView}</b> to:

<code>${address}</code>

پرداخت‌های رمزارزی به سرعت تأیید می‌شوند — معمولاً ظرف چند دقیقه. پس از تأیید، فوراً مطلع خواهید شد و کیف پول شما به‌روزرسانی می‌گردد.

Best regards,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoOpenEnded: (minUsd, tickerView, address) =>
 `💎 <b>هر مقداری از ${tickerView}</b> به ارزش حداقل <b>$${Number(minUsd).toFixed(0)} USD</b> ارسال کنید به:

<code>${address}</code>

ما ارزش کامل بازار هر مقداری که ارسال کنید را اعتبار می‌دهیم.

⚠️ <b>واریزی‌های زیر $${Number(minUsd).toFixed(0)} USD از دست می‌روند</b> — هزینه شبکه برای جمع‌آوری آن‌ها بیشتر از خود واریزی است.

پرداخت‌های رمزارزی به سرعت تأیید می‌شوند — معمولاً ظرف چند دقیقه. پس از تأیید، فوراً مطلع خواهید شد و کیف پول شما به‌روزرسانی می‌گردد.

Best regards,
${CHAT_BOT_NAME}`,

 dustDepositNotice: (receivedUsd, minUsd, tickerView) =>
 `⚠️ <b>واریز زیر حداقل مقدار — تأیید نشد</b>

ما <b>≈ $${Number(receivedUsd).toFixed(2)} USD</b> به صورت ${tickerView} از شما دریافت کردیم، اما حداقل واریز کیف پول برای این ارز <b>$${Number(minUsd).toFixed(0)} USD</b> است.

کارمزد شبکه برای پردازش واریزهای این‌چنین کوچک بیشتر از خود مبلغ واریزی است، بنابراین وجه شما تأیید نشد.

اگر نیاز به کمک دارید، لطفاً روی 💬 پشتیبانی ضربه بزنید و تیم ما به شما کمک خواهد کرد.

— ${CHAT_BOT_NAME}`,

 confirmationDepositMoney: (
amount,
 usd,
 ) => `پرداخت شما به مبلغ ${amount} ($${view(usd)}) پردازش شد. ممنون از انتخاب شما.
با احترام،
${CHAT_BOT_NAME}`,

 showWallet: (usd) => `موجودی کیف پول:

$${view(usd)}`,

 wallet: (usd) => `موجودی کیف پول:

$${view(usd)}

یک گزینه را انتخاب کنید:`,

 walletSelectCurrency: (usd) => `موجودی کیف پول شما: $${view(usd)}`,

 walletBalanceLow: `💰 موجودی کیف پول کافی نیست. برای شارژ، روی واریز ضربه بزنید.`,

 walletBalanceLowAmount: (needed, balance) =>
 `💰 Balance: $${balance.toFixed(2)}
Need: <b>$${(needed - balance).toFixed(2)} more</b>

Tap Deposit ⬇️`,

 sentLessMoney: (expected, got) =>
 `⚠️ <b>Underpayment</b>

Expected: <b>${expected}</b>
Received: <b>${got}</b>

✅ <b>${got} به کیف پول شما اضافه شد</b> — هیچ چیز از دست نرفته است.

💳 برای تکمیل این سفارش، سرویس را دوباره باز کنید و در هنگام پرداخت <b>👛 کیف پول</b> را انتخاب کنید (در صورت نیاز تفاوت کوچک را شارژ کنید). برای ادامه /start را بزنید.`,
 sentMoreMoney: (expected, got) =>
 `💰 پرداخت اضافی شناسایی شد

مورد انتظار: <b>${expected}</b>
دریافت شده: <b>${got}</b>

مبلغ اضافی به کیف پول بازگردانده شد.
سرویس ارائه شد.`,

 buyLeadsError: 'متأسفانه پیش‌شماره منتخب در دسترس نیست و کیف پول شما کسر نشده است',
 buyLeadsProgress: (i, total) => `${((i * 100) / total).toFixed()}% لیدها دانلود شدند. لطفاً صبر کنید.`,

 phoneNumberLeads: 'دریافت سرنخ‌های تأیید شده ممتاز بر اساس هدف یا اعتبارسنجی شماره‌های خودتان:',

 buyLeadsSelectCountry: 'لطفاً کشور را انتخاب کنید',
 buyLeadsSelectSmsVoice: 'لطفاً SMS / Voice را انتخاب کنید',
 buyLeadsSelectArea: 'لطفاً منطقه را انتخاب کنید',
 buyLeadsSelectAreaCode: 'لطفاً کد منطقه را انتخاب کنید',
 buyLeadsSelectCarrier: 'لطفاً اپراتور را انتخاب کنید',
 buyLeadsSelectCnam: `آیا می‌خواهید <b>نام صاحب شماره</b> را با هر سرنخ دریافت کنید؟ هزینه اضافی $15 به ازای هر ۱٬۰۰۰ سرنخ است — و ارزشش را دارد.`,
 buyLeadsSelectAmount: (min, max) =>
 `چه تعداد سرنخ می‌خواهید؟ یک عدد انتخاب کنید یا تایپ کنید.\nحداقل: ${min} | حداکثر: ${max}\n\n💡 تعداد بیشتر = پوشش بهتر. بزرگ فکر کنید.`,
 buyLeadsSelectFormat: 'فرمت را انتخاب کنید، مثلاً محلی (212) یا بین‌المللی (+1212)',
 buyLeadsSuccess: n => `🎉 <b>انجام شد!</b> ${n} سرنخ شما آماده است.\n\nدو فایل دریافت خواهید کرد:\n📄 <b>فایل ۱</b> — تمام شماره‌های تلفن\n📄 <b>فایل ۲</b> — شماره‌ها همراه با <b>نام صاحب شماره</b>\n\nنکته حرفه‌ای: از نام‌ها برای شخصی‌سازی ارتباطتان استفاده کنید. احتمال پاسخ‌دهی افراد وقتی با نامشان خطاب می‌شوند ۲ تا ۳ برابر بیشتر است.`,

buyLeadsNewPrice: (leads, price, newPrice) => `💰 <b>${leads} سرنخ</b> — اکنون فقط <b>$${view(newPrice)}</b> <s>($${price})</s>\nشامل نام صاحبان شماره تلفن. این فرصت را از دست ندهید.`,
 buyLeadsPrice: (leads, price) => `💰 <b>${leads} سرنخ</b> — <b>$${price}</b>\nشامل نام صاحبان شماره تلفن. هر زمان که آماده بودید.`,

 walletSelectCurrencyConfirm: `تأیید می‌کنید؟`,

 // اعتبارسنج شماره تلفن
 validatorSelectCountry: 'لطفاً کشور را انتخاب کنید',
 validatorPhoneNumber: 'لطفاً شماره‌های خود را همراه با کد کشور وارد کنید یا فایل مربوطه را آپلود کنید.',
 validatorSelectSmsVoice: n =>
 `${n} شماره تلفن یافت شد. لطفاً گزینه اعتبارسنجی برای پیامک یا تماس صوتی را انتخاب کنید.`,
 validatorSelectCarrier: 'لطفاً اپراتور را انتخاب کنید',
 validatorSelectCnam: `آیا می‌خواهید <b>نام صاحب شماره تلفن</b> را همراه با سرنخ‌های تأییدشده داشته باشید؟\n\nدانستن اینکه با چه کسی در تماس هستید به شما امکان می‌دهد پیام خود را شخصی‌سازی کنید — و مردم به نام خودشان پاسخ می‌دهند. هزینه آن $15 به ازای هر 1,000 سرنخ است. ارزش هر سنت را دارد.`,
 validatorSelectAmount: (min, max) =>
 `چه مقدار از شماره‌ها را می‌خواهید اعتبارسنجی کنید؟ یک عدد انتخاب کنید یا تایپ کنید. حداقل ${min} و حداکثر ${max}`,
 validatorSelectFormat: 'فرمت را انتخاب کنید، مثلاً محلی (212) یا بین‌المللی (+1212)',

 validatorSuccess: (n, m) => `${n} سرنخ اعتبارسنجی شد. ${m} شماره تلفن معتبر یافت شد.`,
 validatorProgress: (i, total) => `${((i * 100) / total).toFixed()}% سرنخ‌ها اعتبارسنجی شدند. لطفاً صبر کنید.`,
 validatorProgressFull: (i, total) => `${((i * 100) / total).toFixed()}% سرنخ‌ها اعتبارسنجی شدند.`,

 validatorError: `متأسفانه شماره تلفن‌های انتخاب‌شده در دسترس نیستند و کیف پول شما شارژ نشده است`,
 validatorErrorFileData: `شماره تلفن نامعتبر برای کشور انتخاب‌شده یافت شد. لطفاً شماره تلفن مربوط به کشور انتخاب‌شده را آپلود کنید`,
 validatorErrorNoPhonesFound: `هیچ شماره تلفنی یافت نشد. دوباره امتحان کنید.`,

 validatorBulkNumbersStart: 'اعتبارسنجی سرنخ‌ها شروع شد و به زودی تکمیل می‌شود.',

 // url re-director
 redSelectUrl: 'لطفاً URL مورد نظر برای کوتاه‌سازی و تحلیل را وارد کنید. مثلاً https://cnn.com',
 redSelectRandomCustom: 'لطفاً گزینه لینک تصادفی یا سفارشی را انتخاب کنید',
 redSelectProvider: 'ارائه‌دهنده لینک را انتخاب کنید',
 redSelectCustomExt: 'پسوند سفارشی را وارد کنید',

 redValidUrl: 'لطفاً یک URL معتبر وارد کنید. مثلاً https://google.com',
 redTakeUrl: url => `URL کوتاه‌شده شما: ${url}`,
 redIssueUrlBitly: `کوتاه‌سازی لینک ناموفق بود. کیف پول شما شارژ نشده است. لطفاً دوباره امتحان کنید یا روی 💬 پشتیبانی ضربه بزنید.`,
 redIssueSlugCuttly: `نام لینک مورد نظر قبلاً گرفته شده است، نام دیگری امتحان کنید.`,
 redIssueUrlCuttly: `کوتاه‌سازی لینک ناموفق بود. لطفاً دوباره امتحان کنید یا روی 💬 پشتیبانی ضربه بزنید.`,
 freeLinksExhausted: `${FREE_LINKS} لینک آزمایشی شما تمام شده است!\n\nبرای <b>لینک‌های نامحدود</b> + دامنه رایگان + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ اعتبارسنجی اشتراک بگیرید.\n\nپلن‌ها از <b>$${PRICE_DAILY}/روز</b>. برای شروع روی ⭐ عضویت ضربه بزنید.`,
 subscriptionLeadsHint: `💡 مشترکان در هر پلن ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ اعتبارسنجی رایگان همراه با نام صاحب شماره دریافت می‌کنند. پلن‌ها از $${PRICE_DAILY}/روز.`,
 linksRemaining: (count, total) => {
 const base = `شما ${count} از ${total || FREE_LINKS} لینک آزمایشی Shortit باقی‌مانده دارید.`
 if (count <= 2) return `${base}\n\n⚡ <b>${count} لینک باقی مانده!</b> مشترکان لینک‌های نامحدود + دامنه رایگان + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+ اعتبارسنجی دریافت می‌کنند. پلن‌ها از $${PRICE_DAILY}/روز.`
 return base
 },
 redNewPrice: (price, newPrice) => `قیمت اکنون $${view(newPrice)} <s>($${price})</s> است. لطفاً روش پرداخت را انتخاب کنید.`,
 customLink: 'لینک سفارشی',
 randomLink: 'لینک تصادفی',
 askShortLinkExtension: 'لطفاً پسوند لینک کوتاه مورد نظر خود را به ما بگویید: مثلاً payer',
 linkAlreadyExist: `لینک از قبل وجود دارد. لطفاً \'ok\' را تایپ کنید تا دوباره امتحان کنید.`,
 yourShortendUrl: shortUrl => `URL کوتاه‌شده شما: ${shortUrl}`,

 availablefreeDomain: (plan, available, s) =>
 ` به یاد داشته باشید، پلن ${plan} شما شامل ${available} دامنه رایگان${s} می‌شود. بیایید امروز دامنه شما را تهیه کنیم!`,
 shortenedUrlLink: `لطفاً URL مورد نظر برای کوتاه‌سازی و تحلیل را وارد کنید. مثلاً https://cnn.com`,
 selectedTrialPlan: 'شما پلن آزمایشی رایگان را انتخاب کرده‌اید',
 userPressedBtn: message => `کاربر دکمه ${message} را فشار داده است.`,
 userToBlock: userToBlock => `کاربر ${userToBlock} یافت نشد`,
 userBlocked: userToBlock => `کاربر ${userToBlock} مسدود شد.`,
 checkingDomainAvail: `در حال بررسی دسترس‌پذیری دامنه...`,
 checkingExistingDomainAvail: `در حال بررسی دسترس‌پذیری دامنه موجود...`,
subscribeFirst: `📋 اول اشتراک بگیرید`,
 freeValidationUsed: (amount, remaining) => `${amount} شماره تلفن آمریکایی با اشتراک شما اعتبارسنجی شد! اعتبارسنجی‌های رایگان باقیمانده: ${remaining.toLocaleString()}.`,
 partialFreeValidation: (freeAmount, totalAmount, paidAmount, paidPrice) => `شما ${freeAmount.toLocaleString()} اعتبارسنجی رایگان باقیمانده دارید. درخواست شما برای ${totalAmount.toLocaleString()} شماره است.\n\n${freeAmount.toLocaleString()} مورد رایگان پوشش داده می‌شود و ${paidAmount.toLocaleString()} مورد باقیمانده $${paidPrice} هزینه دارد. لطفاً از طریق پرداخت زیر اقدام کنید.`,
 notValidHalf: `یک نیمه پشتی معتبر وارد کنید`,
 linkAlreadyExist: `لینک از قبل وجود دارد. لطفاً لینک دیگری امتحان کنید.`,
 issueGettingPrice: `در حال حاضر نمی‌توانیم قیمت را دریافت کنیم. لطفاً دوباره امتحان کنید یا روی 💬 پشتیبانی ضربه بزنید.`,
 domainInvalid: 'نام دامنه نامعتبر است. لطفاً نام دامنه دیگری امتحان کنید. از فرمت abcpay.com استفاده کنید',
 domainMissingTLD: 'پسوند دامنه وارد نشده است. لطفاً .com، .net، .org یا پسوند دیگری اضافه کنید.\n\nمثال: <b>yourname.com</b>',
 domainTooShort: 'نام دامنه خیلی کوتاه است. باید حداقل ۳ کاراکتر قبل از نقطه باشد.\n\nمثال: <b>abc.com</b>',
 domainInvalidChars: 'دامنه شامل کاراکترهای نامعتبر است. فقط از حروف، اعداد و خط تیره استفاده کنید.\n\nمثال: <b>my-site.com</b>',
 domainStartsEndsHyphen: 'دامنه نمی‌تواند با خط تیره شروع یا تمام شود.\n\nمثال: <b>mysite.com</b> (نه -mysite.com یا mysite-.com)',
 domainSearchTimeout: (domain) => `⏱️ جستجوی دامنه <b>${domain}</b> بیشتر از حد انتظار طول می‌کشد.\n\nلطفاً لحظه‌ای دیگر دوباره امتحان کنید یا اگر این مشکل ادامه داشت با پشتیبانی تماس بگیرید.`,
 chooseValidPlan: 'لطفاً یک پلن معتبر انتخاب کنید',
 noDomainFound: 'هیچ نام دامنه‌ای یافت نشد',
 chooseValidDomain: 'لطفاً یک دامنه معتبر انتخاب کنید',
 failedAudio: '❌ پردازش صدا ناموفق بود. لطفاً دوباره امتحان کنید.',
 enterBroadcastMessage: 'پیام را وارد کنید',
 provide2Nameservers: 'لطفاً حداقل ۲ نیم‌سرور با فاصله از هم وارد کنید.',
 noDomainSelected: 'هیچ دامنه‌ای انتخاب نشده است.',
 validInstitutionName: '⚠️ لطفاً یک نام مؤسسه معتبر وارد کنید (۲ تا ۱۰۰ کاراکتر).',
 validCityName: '⚠️ لطفاً یک نام شهر معتبر وارد کنید.',
 errorDeletingDns: error => `خطا: ${error}. لطفاً دوباره امتحان کنید.`,
 selectValidOption: 'لطفاً یک گزینه معتبر انتخاب کنید.',
 cancelled: 'لغو شد.',
 domainActionsMenu: (domain) => `<b>عملیات برای ${domain}</b>\n\nیک گزینه انتخاب کنید:`,
 purchaseFailed: '❌ خرید ناموفق بود. کیف پول شما بازپرداخت شده است. لطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.',
 maxDnsRecord: 'حداکثر ۴ رکورد NS تعیین شده است. لطفاً یک رکورد موجود را به‌روزرسانی یا حذف کنید.',
 errorSavingDns: error => `خطا: ${error}. لطفاً دوباره امتحان کنید.`,
 fileError: 'خطایی در پردازش فایل رخ داد.',
 ammountIncorrect: 'مبلغ نادرست است',
 subscriptionExpire: (subscribedPlan, timeEnd) => `اشتراک ${subscribedPlan} شما در تاریخ ${timeEnd} منقضی شده است`,
 plansSubscripedtill: (subscribedPlan, timeEnd) =>
 `شما در حال حاضر در پلن ${subscribedPlan} اشتراک دارید. پلن شما تا تاریخ ${timeEnd} معتبر است`,
 planNotSubscriped: `شما هنوز هیچ محصول یا اشتراک فعالی ندارید.\n\nهاستینگ، شماره‌های Cloud IVR، VPS و عضویت پس از خرید اینجا نمایش داده می‌شوند. برای شروع روی یک محصول در منوی اصلی ضربه بزنید!`,
 noShortenedUrlLink: 'شما هنوز هیچ لینک کوتاه‌شده‌ای ندارید.',
 shortenedLinkText: linksText => `لینک‌های کوتاه‌شده شما:\n${linksText}`,
 analyticsNotAvailable: () => `📊 آمار در دسترس نیست`,

 qrCodeText: 'کد QR شما اینجاست!',
 scanQrOrUseChat: chatId => `📱 <b>${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS App</b>\n\nکد فعال‌سازی شما:\n<code>${chatId}</code>\n\n📲 دانلود: ${process.env.SMS_APP_LINK || 'با پشتیبانی تماس بگیرید'}`,
 smsManageDevices: '📱 مدیریت دستگاه‌ها',

 smsDevicesList: (devices, chatId) => {
   if (!devices || devices.length === 0) {
     return `📱 <b>هیچ دستگاهی متصل نیست</b>\n\nاپلیکیشن را دانلود کنید و با کد فعال‌سازی خود وارد شوید:\n<code>${chatId}</code>\n\n📲 دانلود: ${SMS_APP_LINK}`
   }
   const deviceList = devices.map((d, idx) => {
     const name = d.deviceName || `دستگاه ${idx + 1}`
     const lastActive = d.lastActive ? new Date(d.lastActive).toLocaleString() : 'هرگز'
     return `${idx + 1}. <b>${name}</b>\n   📱 <code>${d.deviceId}</code>\n   🕒 ${lastActive}`
   }).join('\n\n')
   return `📱 <b>دستگاه‌های شما (${devices.length})</b>\n\n${deviceList}\n\n✏️ برای تغییر نام، روی دکمه دستگاه ضربه بزنید یا در اپلیکیشن نام را تغییر دهید.`
 },

 domainPurchasedFailed: (domain) =>
 `❌ ثبت دامنه <b>${domain}</b> تکمیل نشد. لطفاً دوباره امتحان کنید یا اگر مشکل ادامه داشت با پشتیبانی تماس بگیرید.`,

 noDomainRegistered: 'شما هنوز هیچ دامنه خریداری‌شده‌ای ندارید.',
 registeredDomainList: domainsText => `دامنه‌های خریداری‌شده شما:\n${domainsText}`,
 selectDomainAction: domain => `<b>${domain}</b>\n\nمی‌خواهید با این دامنه چه کاری انجام دهید؟`,
domainActionDns: '🔧 مدیریت DNS',
 domainActionShortener: '🔗 فعال‌سازی برای کوتاه‌کننده URL',
 domainActionDeactivateShortener: '🔗 غیرفعال‌سازی کوتاه‌کننده URL',
 domainActionAntiRed: '🛡️ کپچای بازدیدکننده',
 domainActionVisitorCaptcha: '🛡️ کپچای بازدیدکننده',
 domainActionVisitorCaptchaLocked: '🔒 کپچای بازدیدکننده (فقط Gold)',
 
 // هشدار مدیریت DNS برای دامنه‌های میزبانی‌شده
 dnsWarningHostedDomain: (domain, plan) => `⚠️ <b>هشدار: این دامنه یک پلن هاستینگ فعال دارد</b>\n\nدامنه: <b>${domain}</b>\nپلن: ${plan}\n\n<b>⚠️ تغییر رکوردهای DNS می‌تواند هاستینگ و محافظت ضد قرمز شما را خراب کند!</b>\n\nتغییرات DNS فقط در صورتی باید انجام شود که کاملاً از تأثیر آن آگاه باشید. تغییرات نادرست ممکن است وب‌سایت شما را غیرقابل دسترس کند یا محافظت‌های امنیتی را از بین ببرد.\n\n<b>آیا مطمئن هستید که می‌خواهید ادامه دهید؟</b>`,
 dnsProceedAnyway: '⚠️ ادامه به هر حال',
 dnsCancel: '❌ لغو',
 
 // نشانگر منشأ دامنه
 domainTypeRegistered: '🏷️ ثبت‌شده نزد ما',
 domainTypeExternal: '🌍 خارجی',
 
 antiRedStatusOn: domain => `🛡️ <b>کپچای بازدیدکننده</b> برای <b>${domain}</b>\n\nوضعیت: <b>✅ روشن</b>\n\nبازدیدکنندگان انسانی قبل از ورود به سایت شما یک بررسی کوتاه «تأیید مرورگر» می‌بینند. پنهان‌سازی اسکنر، تله‌های هانی‌پات، ممنوعیت IP و قوانین WAF نیز فعال هستند.\n\n⚠️ <b>توصیه:</b> برای بهترین محافظت در برابر محرک‌های قرمز، آن را روشن نگه دارید.`,
 antiRedStatusOff: domain => `🛡️ <b>کپچای بازدیدکننده</b> برای <b>${domain}</b>\n\nوضعیت: <b>❌ خاموش (فقط انسان‌ها)</b>\n\nصفحه میانی «تأیید مرورگر» برای بازدیدکنندگان انسانی پنهان است.\n\n✅ <b>هنوز فعال:</b> پنهان‌سازی اسکنر (Google SafeBrowsing، VirusTotal، McAfee، Norton، Sucuri و ۲۵ مورد دیگر)، تله‌های هانی‌پات، ممنوعیت IP و قوانین WAF — این‌ها برای هر درخواستی صرف‌نظر از این کلید اجرا می‌شوند.\n\nبرای بازگرداندن کپچای بازدیدکننده روی دکمه زیر ضربه بزنید.`,
 antiRedTurnOff: '❌ خاموش کردن کپچای بازدیدکننده',
 antiRedTurnOn: '✅ روشن کردن کپچای بازدیدکننده',
 antiRedConfirmDisable: '✅ بله، صفحه کپچا را پنهان کن',
 antiRedTurningOn: domain => `⏳ در حال فعال‌سازی کپچای بازدیدکننده برای <b>${domain}</b>...`,
 antiRedTurningOff: domain => `⏳ در حال غیرفعال‌سازی کپچای بازدیدکننده برای <b>${domain}</b>...`,
 antiRedEnabled: domain => `✅ کپچای بازدیدکننده برای <b>${domain}</b> <b>فعال</b> شد.\n\nبازدیدکنندگان انسانی قبل از ورود به سایت شما بررسی «تأیید مرورگر» را خواهند دید.`,
 antiRedDisabled: domain => `❌ کپچای بازدیدکننده برای <b>${domain}</b> <b>غیرفعال</b> شد.\n\nصفحه «تأیید مرورگر» اکنون برای بازدیدکنندگان انسانی پنهان است.\n\n✅ <b>محافظت ضد قرمز کاملاً فعال باقی می‌ماند</b>:\n• پنهان‌سازی اسکنر (Google SafeBrowsing، VirusTotal، McAfee، PhishTank، Sucuri و ۲۵ مورد دیگر) ← همچنان صفحه جایگزین تمیز را نشان می‌دهد\n• تله‌های هانی‌پات و لیست ممنوعیت IP ← همچنان فعال\n• قوانین WAF ضد ربات Cloudflare ← همچنان فعال\n• مسدودسازی IP/UA اسکنر در .htaccess ← همچنان فعال\n\nفقط صفحه میانی چالش برای انسان‌ها از طریق فلگ KV در سمت Worker سرکوب می‌شود.`,
 antiRedDisableConfirm: domain => `🛡️ <b>پنهان کردن کپچای بازدیدکننده برای ${domain}؟</b>\n\nاین فقط صفحه میانی «تأیید مرورگر» را برای بازدیدکنندگان انسانی پنهان می‌کند (تا بررسی ۳ ثانیه‌ای را نبینند).\n\n✅ پنهان‌سازی اسکنر، تله‌های هانی‌پات، ممنوعیت IP و قوانین WAF برای همه <b>فعال می‌مانند</b> — محافظت ضد قرمز غیرفعال نمی‌شود.\n\nادامه می‌دهید؟`,
 antiRedDisableConfirmWrong: 'برای تأیید دکمه سبز را بزنید، یا ↩️ بازگشت برای لغو.',
 antiRedRestoredNote: domain => `🛡️ <b>محافظت ضد قرمز برای ${domain} بازگردانده شد.</b>\n\nما یک باگ داخلی برطرف کردیم که خاموش کردن کپچای بازدیدکننده همچنین پنهان‌سازی اسکنر را حذف می‌کرد. محافظت ضد قرمز اکنون دوباره روشن است (پنهان‌سازی اسکنر، تله‌های هانی‌پات، ممنوعیت IP، WAF).\n\nتنظیم «کپچای بازدیدکننده خاموش» شما حفظ شده است — بازدیدکنندگان انسانی همچنان صفحه «تأیید مرورگر» را نمی‌بینند.`,
 antiRedNoCF: domain => `⚠️ <b>${domain}</b> از Cloudflare استفاده نمی‌کند. کپچای بازدیدکننده به nameserver های Cloudflare نیاز دارد.\n\nابتدا به مدیریت DNS بروید ← به NS های Cloudflare تغییر دهید.`,
 antiRedError: '❌ به‌روزرسانی کپچای بازدیدکننده ناموفق بود. لطفاً دوباره امتحان کنید.',
 honeypotMonthlyOnly: `🍯 <b>تله‌های هانی‌پات</b>\n\nاین کنترل در پلن‌های هاستینگ <b>ماهانه</b> (Premium یا Golden) در دسترس است.\n\nتله‌های هانی‌پات طعمه‌های پنهانی هستند که ربات‌های در حال بررسی سایت شما را شناسایی و به‌صورت خودکار مسدود می‌کنند. برخی سایت‌هایی که خروجی JSON/API خام ارائه می‌دهند ترجیح می‌دهند آن‌ها را خاموش کنند — این کلید امتیاز پلن ماهانه است.\n\nبرای مدیریت تله‌های هانی‌پات به ازای هر دامنه، به پلن ماهانه ارتقا دهید.`,
 honeypotStatusOn: domain => `🍯 <b>تله‌های هانی‌پات</b> برای <b>${domain}</b>\n\nوضعیت: <b>✅ روشن</b>\n\nلینک‌های طعمه پنهان، فیلدهای فرم و API های جعلی به صفحات HTML شما تزریق می‌شوند تا ربات‌ها را شناسایی و به‌صورت خودکار مسدود کنند.\n\nℹ️ تله‌ها فقط به صفحات HTML واقعی اضافه می‌شوند — پاسخ‌های JSON/API هرگز دست نمی‌خورند. فقط در صورتی خاموش کنید که سایت شما خروجی inline دارد که باید دقیقاً بایت به بایت باقی بماند.`,
 honeypotStatusOff: domain => `🍯 <b>تله‌های هانی‌پات</b> برای <b>${domain}</b>\n\nوضعیت: <b>❌ خاموش</b>\n\nهیچ نشانه‌گذاری هانی‌پاتی به صفحات شما تزریق نمی‌شود.\n\n✅ <b>هنوز فعال:</b> کپچای بازدیدکننده، پنهان‌سازی اسکنر، ممنوعیت IP و قوانین WAF — خاموش کردن هانی‌پات‌ها هیچ‌کدام از این لایه‌ها را ضعیف نمی‌کند.\n\nبرای روشن کردن دوباره تله‌ها روی دکمه زیر ضربه بزنید.`,
 honeypotTurnOff: '❌ خاموش کردن تله‌های هانی‌پات',
 honeypotTurnOn: '✅ روشن کردن تله‌های هانی‌پات',
 honeypotTurningOn: domain => `⏳ در حال فعال‌سازی تله‌های هانی‌پات برای <b>${domain}</b>...`,
 honeypotTurningOff: domain => `⏳ در حال غیرفعال‌سازی تله‌های هانی‌پات برای <b>${domain}</b>...`,
 honeypotEnabled: domain => `✅ تله‌های هانی‌پات برای <b>${domain}</b> <b>فعال</b> شدند.\n\nطعمه‌های پنهان ربات اکنون به صفحات HTML شما تزریق می‌شوند. پاسخ‌های JSON/API هرگز تغییر نمی‌کنند.`,
 honeypotDisabled: domain => `❌ تله‌های هانی‌پات برای <b>${domain}</b> <b>غیرفعال</b> شدند.\n\nهیچ نشانه‌گذاری تله‌ای به صفحات شما تزریق نخواهد شد.\n\n✅ کپچای بازدیدکننده، پنهان‌سازی اسکنر، ممنوعیت IP و قوانین WAF کاملاً فعال باقی می‌مانند.`,
 honeypotError: '❌ به‌روزرسانی تله‌های هانی‌پات ناموفق بود. لطفاً دوباره امتحان کنید.',
 honeypotPickDomain: '🍯 <b>تله‌های هانی‌پات</b> — یک دامنه انتخاب کنید\n\nاین پلن بیش از یک دامنه دارد. روی دامنه‌ای که می‌خواهید کلید آن را تغییر دهید ضربه بزنید. وضعیت فعلی کنار هر نام نشان داده شده است.',
 honeypotDomainButton: (domain, off, hasCF) => hasCF ? `${off ? '🔴 خاموش' : '🟢 روشن'} · ${domain}` : `⚠️ بدون CF · ${domain}`,
captchaPickDomain: '🛡️ <b>کپچای بازدیدکننده</b> — یک دامنه انتخاب کنید\n\nاین پلن بیش از یک دامنه دارد. روی دامنه‌ای که می‌خواهید کپچای آن را تغییر دهید ضربه بزنید. وضعیت فعلی کنار هر نام نشان داده شده است.',
captchaDomainButton: (domain, isOff, hasCF) => hasCF ? `${isOff ? '🔴 خاموش' : '🟢 روشن'} · ${domain}` : `⚠️ بدون CF · ${domain}`,
 visitorCaptchaGoldOnly: (domain, price) => `🔒 <b>کپچای بازدیدکننده</b> برای <b>${domain}</b>\n\nاین ویژگی منحصراً برای پلن‌های <b>👑 Golden Anti-Red HostPanel</b> است.\n\nپلن فعلی شما شامل کلید کپچای بازدیدکننده نمی‌شود. برای فعال‌سازی محافظت ربات به ازای هر دامنه، به Golden Anti-Red HostPanel (<b>$${price}/mo</b>) ارتقا دهید.\n\nروی دکمه ارتقا در زیر ضربه بزنید تا فوراً تغییر دهید.`,
 visitorCaptchaNoHosting: (domain, price) => `⚠️ <b>کپچای بازدیدکننده</b> فقط برای دامنه‌های متصل به پلن Golden Anti-Red HostPanel در دسترس است.\n\nدامنه: <b>${domain}</b> در پلن Golden نیست.\n\nبرای فعال‌سازی کپچای بازدیدکننده برای این دامنه، به Golden Anti-Red HostPanel (<b>$${price}/mo</b>) ارتقا دهید.`,
 upgradeToGoldButton: price => `⬆️ ارتقا به Gold ($${price}/mo)`,
 comingSoon: `به زودی`,
 goBackToCoupon: '❌ بازگشت و اعمال کوپن',
 errorFetchingCryptoAddress: `خطا در دریافت آدرس ارز دیجیتال. لطفاً بعداً دوباره امتحان کنید.`,
 paymentSuccessFul: '✅ پرداخت تأیید شد — در حال راه‌اندازی سرویس‌های شما.',
 domainProcessingOrder: '⏳ در حال پردازش سفارش شما — در حال ثبت دامنه.',
 // پیشرفت TLD پیش از واگذاری (.de/.nl/.se/.eu و غیره به NS معتبر
 // در زمان ثبت رجیستری نیاز دارند، پس ابتدا منتظر فعال‌شدن Cloudflare می‌مانیم)
 nsVerifying: (tld) => `🔍 در حال تأیید تنظیمات nameserver در رجیستری .${tld} — این حدود ۳۰ تا ۶۰ ثانیه طول می‌کشد…`,
 nsVerifiedOk: '✅ Nameserver ها تأیید شدند — در حال ثبت.',
 // ── هزینه دسترسی یک‌بار به Marketplace ───────────────────────────────────
 mpPaywall: (fee, balance) =>
   `🛒 <b>دسترسی به مارکت‌پلیس</b>\n\n` +
   `هزینه فعال‌سازی یک‌بار: <b>$${fee}</b>\n` +
`یک بار بپرداز — دسترسی برای همیشه (مرور، فهرست‌گذاری، چت، امانت‌داری).\n\n` +
   `💳 موجودی کیف پول: <b>$${balance.toFixed(2)}</b>\n\n` +
   (balance >= fee
     ? `برای فعال‌سازی روی دکمه زیر بزنید.`
     : `⚠️ <i>حداقل $${(fee - balance).toFixed(2)} دیگر شارژ کنید تا فعال شود.</i>`),
 mpPaywallPayBtn: (fee) => `✅ پرداخت $${fee} از کیف پول`,
 mpPaywallTopupBtn: '👛 شارژ کیف پول',
 mpPaywallCancelBtn: '❌ لغو',
 mpPaywallCryptoBtn: '₿ پرداخت با کریپتو',
 mpPaywallNgnBtn: '🏦 پرداخت با NGN (بانک)',
 mpPayChooseCrypto: (fee) => `₿ <b>پرداخت هزینه $${fee} مارکت‌پلیس با کریپتو</b>\n\nیک ارز انتخاب کنید — آدرس کیف پول برای ارسال دقیق مبلغ دریافت می‌کنید. دسترسی پس از تأیید پرداخت به‌طور خودکار فعال می‌شود.`,
 mpPayNgnStarting: (fee) => `🏦 <b>در حال آماده‌سازی پرداخت NGN برای هزینه $${fee} مارکت‌پلیس…</b>`,
 mpAccessActivated: (method) => `🎉 <b>دسترسی به مارکت‌پلیس فعال شد!</b>\n\n✅ پرداخت از طریق ${method}.\n\nاکنون می‌توانید:\n• 🛍️ <b>فهرست‌گذاری</b> کالا و خدمات خود\n• 💬 چت با خریداران\n• 🔒 استفاده از امانت‌داری برای معاملات ایمن\n\nبرای باز کردن مارکت‌پلیس روی دکمه زیر بزنید.`,
 mpAccessAlreadyCredited: (usd) => `ℹ️ شما از قبل دسترسی به مارکت‌پلیس دارید، بنابراین پرداخت <b>$${Number(usd).toFixed(2)}</b> شما به کیف پولتان اضافه شد.`,
 mpOpenMarketplaceBtn: '🏪 باز کردن مارکت‌پلیس',
 mpPaywallInsufficient: (fee, balance) =>
   `🚫 <b>موجودی کیف پول کافی نیست</b>\n\n` +
   `نیاز: <b>$${fee}</b> · موجودی: <b>$${balance.toFixed(2)}</b>\n\n` +
   `<b>$${Math.max(fee - balance, 25).toFixed(2)}</b> یا بیشتر از طریق 👛 <b>کیف پول</b> شارژ کنید، سپس دوباره امتحان کنید.`,
 mpPaywallSuccess: (fee, balance) =>
   `🎉 <b>مارکت‌پلیس فعال شد!</b>\n\n` +
   `💵 کسر شده: <b>$${fee}</b>\n` +
   `💳 موجودی جدید: <b>$${balance.toFixed(2)}</b>\n\n` +
   `خوش آمدید — در حال باز کردن مارکت‌پلیس…`,

 // انتقال تماس (Cloud IVR)
 fwdInsufficientBalance: (walletBal, rate) => `🚫 <b>موجودی کافی نیست</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · نیاز به $${rate}/دقیقه\n👉 <b>$25</b> از طریق 👛 کیف پول شارژ کنید تا ارسال تماس فعال شود.`,
 fwdBlocked: (number) => `🚫 <b>مسدود شده</b> — ${number} یک مقصد ممتاز است.\nبرای درخواست فعال‌سازی روی 💬 <b>پشتیبانی</b> بزنید.`,
 fwdNotRoutable: (number) => `⚠️ ${number} قابل مسیریابی نیست. شماره را بررسی کنید یا روی 💬 <b>پشتیبانی</b> بزنید.`,
 fwdValidating: '⏳ در حال اعتبارسنجی مقصد...',
 fwdEnterNumber: (rate, walletBal, usRate) => {
 let text = `شماره ارسال با کد کشور وارد کنید (مثلاً +14155551234)\n\n💰 <b>نرخ‌های ارسال تماس</b> — به ازای هر دقیقه از کیف پول کسر می‌شود:\n🇺🇸 آمریکا / کانادا: <b>$${Number(usRate).toFixed(2)}/دقیقه</b>\n🌍 بین‌الملل: <b>$${Number(rate).toFixed(2)}/دقیقه</b>`
 if (walletBal !== undefined) {
 const estUs = usRate > 0 ? Math.floor(walletBal / usRate) : 0
 const estIntl = rate > 0 ? Math.floor(walletBal / rate) : 0
 text += `\n\n💳 کیف پول: <b>$${walletBal.toFixed(2)}</b> — حدود <b>${estUs} دقیقه</b> به آمریکا/کانادا یا <b>${estIntl} دقیقه</b> بین‌الملل پوشش می‌دهد.`
 if (walletBal < rate) text += `\n⚠️ ابتدا <b>$25</b> از طریق 👛 کیف پول شارژ کنید.`
 }
 return text
 },
 fwdConfirm: (number, forwardTo, modeLabel, rate, walletBal, estMin) => {
 return `📲 <b>تأیید ارسال تماس</b>\n\n📞 شماره شما: <b>${number}</b>\n➡️ ارسال تماس به: <b>${forwardTo}</b>\n⚙️ حالت: <b>${modeLabel}</b>\n💰 نرخ: <b>$${Number(rate).toFixed(2)}/دقیقه</b> — از کیف پول کسر می‌شود\n💳 کیف پول: <b>$${walletBal.toFixed(2)}</b> — حدود <b>${estMin} دقیقه</b> پوشش می‌دهد\n\nروی <b>✅ تأیید</b> بزنید تا ارسال فعال شود، یا ↩️ بازگشت برای تغییر شماره.`
 },
 fwdConfirmBtn: '✅ تأیید و فعال‌سازی',
 // ── ترجمه‌های درون‌خطی عمومی ──
 planNotFound: 'پلن یافت نشد.',
 noActivePlans: '📋 <b>پلن‌های هاستینگ من</b>\n\nشما هیچ پلن هاستینگ فعالی ندارید. برای شروع یک پلن خریداری کنید!',
 noRegisteredDomains: 'شما هیچ دامنه ثبت‌شده‌ای ندارید. لطفاً یک دامنه جدید ثبت کنید یا یک دامنه خارجی متصل کنید.',
 selectFromDomains: 'یک دامنه از دامنه‌های ثبت‌شده خود انتخاب کنید:',
 selectDomainFromList: 'لطفاً یک دامنه از لیست انتخاب کنید.',
 enterValidDomain: 'لطفاً یک نام دامنه معتبر وارد کنید (مثلاً example.com).',
 enterCouponCode: 'کد تخفیف را وارد کنید:',
 invalidCoupon: 'کد تخفیف نامعتبر است. دوباره امتحان کنید یا روی رد کردن بزنید.',
 couponAlreadyUsed: 'کد تخفیف قبلاً استفاده شده. یکی دیگر امتحان کنید یا روی رد کردن بزنید.',
 couponUsedToday: '⚠️ شما امروز از این کد تخفیف استفاده کرده‌اید.',
 keyboardRefreshed: 'کیبورد بازنشانی شد! لطفاً یک گزینه انتخاب کنید:',
 supportEnded: '✅ جلسه پشتیبانی پایان یافت. ممنون از تماس شما!',
 noSupportSession: 'هیچ جلسه پشتیبانی فعالی وجود ندارد.',
 supportMsgReceived: '✉️ پیام دریافت شد! یک کارشناس پشتیبانی به زودی پاسخ خواهد داد.',
 supportMsgSent: '✉️ پیام به پشتیبانی ارسال شد. به زودی پاسخ می‌دهیم.',
someIssue: 'مشکلی پیش آمد',
 dbConnecting: 'پایگاه داده در حال اتصال است، لطفاً لحظه‌ای دیگر دوباره امتحان کنید',
 chooseValidDomain: 'لطفاً یک دامنه معتبر انتخاب کنید',
 dnsCustomOnly: 'رکوردهای DNS توسط ارائه‌دهنده nameserver سفارشی شما مدیریت می‌شوند. شما فقط می‌توانید nameserverها را به‌روزرسانی کنید یا ارائه‌دهنده DNS را تغییر دهید.',
 noDeleteRecords: 'هیچ رکورد قابل حذفی یافت نشد. رکوردهای Nameserver فقط قابل به‌روزرسانی هستند.',
 invalidSrvFormat: 'فرمت نامعتبر. از <b>_service._protocol</b> استفاده کنید (مثلاً _sip._tcp، _http._tcp):',
 insufficientBalance: (usdBal, price) => `⚠️ موجودی کیف پول کافی نیست. شما $${usdBal} دارید اما به $${price} نیاز دارید.\nلطفاً ابتدا موجودی واریز کنید.`,
 leadSelectMetro: (target) => `📍 منطقه متروپولیتن را برای <b>${target}</b> انتخاب کنید:\n\nبرای بیشترین پوشش در تمام مناطق، «همه شهرها» را انتخاب کنید.`,
 leadSelectArea: (target, city) => `📞 کد منطقه را برای <b>${target}</b> — <b>${city}</b> انتخاب کنید:\n\n«کدهای منطقه ترکیبی» بیشترین مجموعه از شماره‌های تأییدشده را به شما می‌دهد.`,
 leadRequestCustom: '📝 <b>درخواست لیدهای سفارشی</b>\n\nنهاد یا شرکتی که می‌خواهید لیدهای هدفمند برای آن داشته باشید را به ما بگویید.\nما شماره‌های واقعی و تأییدشده با نام صاحب تلفن را از هر منطقه متروپولیتنی که نیاز دارید تأمین می‌کنیم:',
 leadCustomCity: (target) => `🏙️ از کدام شهر یا منطقه می‌خواهید لید دریافت کنید?\n\nهدف: <b>${target}</b>\n\nنام شهر را تایپ کنید یا «سراسری» برای همه مناطق:`,
 leadCustomDetails: (target, city) => `📋 جزئیات اضافی؟ (مثلاً کدهای منطقه ترجیحی، اپراتور، حجم مورد نیاز)\n\nهدف: <b>${target}</b>\nمنطقه: <b>${city}</b>\n\nجزئیات را تایپ کنید یا «هیچکدام» برای رد کردن:`,
 leadAllCities: 'همه شهرها',
 leadNationwide: 'سراسری',
 leadNone: 'هیچکدام',
 leadRequestTarget: '📝 درخواست هدف سفارشی',
 noPendingLeads: '📝 هیچ درخواست لید در انتظاری وجود ندارد.',
 backupCreated: 'پشتیبان‌گیری با موفقیت انجام شد.',
 dataRestored: 'داده‌ها با موفقیت بازیابی شدند.',
 vpsRefundFailed: (currency, amount, error) => `❌ <b>راه‌اندازی VPS ناموفق بود</b>\n\n✅ استرداد ${currency}${amount} به کیف پول شما انجام شد.\n\nخطا: ${error}\n\nاگر مشکل ادامه داشت با پشتیبانی تماس بگیرید.`,
 shortenerConflict: (domain, plan) => `❌ امکان فعال‌سازی کوتاه‌کننده URL وجود ندارد — <b>${domain}</b> دارای یک پلن هاستینگ فعال (<b>${plan}</b>) است.\n\nCNAME کوتاه‌کننده رکوردهای A هاستینگ شما را جایگزین کرده و وب‌سایت شما را آفلاین می‌کند.\n\nلطفاً از دامنه دیگری استفاده کنید، یا ابتدا پلن هاستینگ خود را غیرفعال کنید.`,
 shortenerLinked: (domain) => `✅ <b>${domain}</b> به کوتاه‌کننده URL متصل شد. انتشار DNS ممکن است تا ۲۴ ساعت طول بکشد.`,
 shortenerError: (domain, error) => `❌ خطا در فعال‌سازی کوتاه‌کننده برای <b>${domain}</b>: ${error}\n\nلطفاً بعداً دوباره امتحان کنید.`,
 domainSearching: (domain) => `🔍 در حال بررسی دسترس‌پذیری ${domain} ...`,
 domainNotAvailable: (domain) => `❌ <b>${domain}</b> در دسترس نیست.`,
 domainSearchAlts: (baseName) => `🔍 در حال جستجوی جایگزین‌ها برای <b>${baseName}</b> ...`,
 domainAltsFound: (altList) => `✅ جایگزین‌های موجود:\n\n${altList}\n\nهر نام دامنه‌ای را برای بررسی تایپ کنید:`,
 dnsLinkError: (domain, error) => `❌ امکان اتصال <b>${domain}</b> وجود ندارد: ${error}`,
 dnsSaveError: (domain, error) => `❌ خطای DNS برای <b>${domain}</b>: ${error}`,
 selectProceedOrCancel: 'لطفاً «ادامه به هر حال» یا «لغو» را انتخاب کنید.',

 // ── Email Blast i18n ──
 ebSendBlast: '📤 ارسال ایمیل انبوه',
 ebMyCampaigns: '📬 کمپین‌های من',
 ebAdminPanel: '⚙️ پنل مدیریت',
 ebCancelBtn: '❌ لغو',
 ebCancelled: '❌ لغو شد.',
 ebUploadCsvTxt: '📎 لطفاً یک فایل CSV/TXT آپلود کنید یا آدرس‌های ایمیل را جای‌گذاری کنید (یکی در هر خط).',
 ebUploadCsvOnly: '❌ لطفاً یک فایل <b>.csv</b> یا <b>.txt</b> آپلود کنید.',
 ebUploadHtmlFile: '📎 لطفاً یک فایل <b>.html</b> آپلود کنید، یا ❌ لغو را بزنید تا از ابتدا شروع کنید.',
 ebTypeOrUpload: '📝 لطفاً پیام ایمیل خود را تایپ کنید یا یک فایل HTML آپلود کنید.',
 ebEnterSubject: '✏️ خط <b>موضوع</b> جدید را وارد کنید:',
 ebChooseTextOrHtml: 'لطفاً انتخاب کنید: «📝 تایپ متن ساده» یا «📎 آپلود فایل HTML»',
 ebTypeText: '📝 تایپ متن ساده',
 ebUploadHtml: '📎 آپلود فایل HTML',
 ebInvalidEmail: '❌ آدرس ایمیل نامعتبر است. لطفاً یک ایمیل معتبر وارد کنید (مثلاً you@gmail.com):',
 ebFailedReadHtml: '❌ خواندن فایل HTML ناموفق بود. لطفاً دوباره امتحان کنید یا فایل دیگری آپلود کنید.',
 ebBundleNotFound: '❌ بسته یافت نشد.',
 ebCampaignNotFound: '❌ کمپین یافت نشد.',
 ebTestSending: (addr) => `⏳ در حال ارسال ایمیل آزمایشی به <b>${addr}</b>...`,
 ebAddDomainBtn: '➕ افزودن دامنه',
 ebRemoveDomainBtn: '❌ حذف دامنه',
 ebDashboardBtn: '📊 داشبورد',
 ebManageDomainsBtn: '🌐 مدیریت دامنه‌ها',
 ebManageIpsBtn: '🖥️ مدیریت IPها و گرم‌کردن',
 ebPricingBtn: '💰 تنظیمات قیمت‌گذاری',
 ebSuppressionBtn: '🚫 لیست مسدودی',
 ebAddIpBtn: '➕ افزودن IP',
 ebPauseIpBtn: '⏸ توقف IP',
 ebResumeIpBtn: '▶️ از سرگیری IP',
ebAdminPanelTitle: '⚙️ <b>پنل مدیریت ایمیل</b>',
 ebNoDomains: '📭 هیچ دامنه‌ای تنظیم نشده است.',
 ebDomainRemoved: (d) => `✅ دامنه <b>${d}</b> با موفقیت حذف شد.\n\nرکوردهای DNS پاک‌سازی شدند.`,
 ebDomainRemoveFailed: (err) => `❌ حذف انجام نشد: ${err}`,
 ebInvalidDomain: '❌ نام دامنه نامعتبر است. لطفاً یک دامنه معتبر وارد کنید (مثلاً example.com)',
 ebInvalidIp: '❌ آدرس IP نامعتبر است. لطفاً یک IPv4 معتبر وارد کنید (مثلاً 1.2.3.4)',
 ebSettingUpDomain: (d) => `⏳ در حال راه‌اندازی <b>${d}</b>...\n\nدر حال ایجاد رکوردهای DNS و تولید کلیدهای DKIM...`,
 ebNoActiveIps: 'هیچ IP فعالی برای توقف وجود ندارد.',
 ebNoPausedIps: 'هیچ IP متوقفی وجود ندارد.',
 ebIpPaused: (ip) => `⏸ IP ${ip} متوقف شد.`,
 ebIpResumed: (ip) => `▶️ IP ${ip} از سر گرفته شد.`,
 ebRateUpdated: (rate) => `✅ نرخ به <b>$${rate}/email</b> به‌روزرسانی شد ($${(rate * 500).toFixed(0)} به ازای هر ۵۰۰)`,
 ebMinUpdated: (min) => `✅ حداقل ایمیل‌ها به <b>${min}</b> به‌روزرسانی شد`,
 ebInvalidRate: '❌ نامعتبر. یک عدد مانند 0.10 وارد کنید',
 ebInvalidMin: '❌ نامعتبر. یک عدد وارد کنید.',
 ebSelectIpDomain: (ip) => `🖥️ IP <b>${ip}</b> را به کدام دامنه اختصاص دهم؟`,

 // ── کتابخانه صوتی / بومی‌سازی IVR ──
 audioLibTitle: '🎵 <b>کتابخانه صوتی</b>',
 audioLibEmpty: '🎵 <b>کتابخانه صوتی</b>\n\nهیچ فایل صوتی ذخیره‌شده‌ای ندارید.\n\nیک فایل صوتی (MP3، WAV، OGG) برای استفاده در کمپین‌های IVR آپلود کنید.',
 audioLibEmptyShort: '🎵 <b>کتابخانه صوتی</b>\n\nهیچ فایل صوتی وجود ندارد. برای شروع یکی آپلود کنید.',
 audioUploadBtn: '📎 آپلود صدا',
 audioUploadNewBtn: '📎 آپلود صدای جدید',
 audioUseTemplateBtn: '📝 استفاده از قالب IVR',
 audioSelectOption: 'یک گزینه انتخاب کنید:',
 audioSelectIvr: 'صدای IVR را انتخاب کنید:',
 audioReceived: (size) => `✅ فایل صوتی دریافت شد! (${size} KB)\n\nیک نام برای کتابخانه‌تان به آن بدهید:`,
 audioReceivedShort: '✅ فایل صوتی دریافت شد!\n\nیک نام بگذارید:',
 audioSaved: (name) => `✅ صدا با نام <b>${name}</b> ذخیره شد.\n\nاکنون می‌توانید از آن در کمپین‌های IVR استفاده کنید!`,
 audioDeleted: (name) => `✅ حذف شد: <b>${name}</b>`,
 audioGenFailed: (err) => `❌ تولید صدا ناموفق بود: ${err}`,
 audioFailedSave: '❌ ذخیره پیام صوتی ناموفق بود. لطفاً دوباره امتحان کنید.',
 audioMaxImages: '📸 حداکثر ۵ تصویر. برای ادامه روی ✅ اتمام آپلود ضربه بزنید.',

 // ── Common i18n ──
 chooseOption: 'لطفاً یک گزینه انتخاب کنید:',
 refreshStatusBtn: '🔄 به‌روزرسانی وضعیت',
 cancelRefundBtn: '❌ لغو و بازپرداخت',
 dbConnectRetry: 'پایگاه داده در حال اتصال است، لطفاً لحظه‌ای دیگر دوباره امتحان کنید',
 nsCannotAdd: 'رکوردهای Nameserver قابل افزودن نیستند. برای تغییر نیم‌سرورها از <b>به‌روزرسانی رکورد DNS</b> استفاده کنید.',
 noSupportSession: 'هیچ جلسه پشتیبانی فعالی وجود ندارد.',
 noPendingLeads: '📝 هیچ درخواست سرنخ در انتظاری وجود ندارد.',
 invalidAmountPositive: '⚠️ مبلغ باید یک عدد مثبت باشد.',

 // ── Marketplace ──
 mpHome: `🏪 <b>${(CHAT_BOT_BRAND || 'Nomadly').toUpperCase()} MARKETPLACE</b>\n\n💰 <b>کالاهای دیجیتال خود را بفروشید</b> — در ۶۰ ثانیه فهرست کنید، از طریق امانت‌داری با خیال راحت پول دریافت کنید\n🛍️ <b>معاملات انحصاری پیدا کنید</b> — فروشندگان تأییدشده، تراکنش‌های واقعی\n\n🔒 <b>امانت‌داری اجباری است</b> — هر خریدی از طریق <b>SafeDeal</b> (safedeal.sh) انجام می‌شود\n⚠️ هرگز مستقیم یا از طریق ربات‌های فروشندگان پول پرداخت نکنید — فقط از SafeDeal استفاده کنید.\n\n👇 آماده کسب درآمد یا خرید هستید؟`,
 mpBrowse: '🔥 مرور معاملات',
 mpListProduct: '💰 شروع به فروش',
 mpMyConversations: '💬 مکالمات من',
 mpMyListings: '📦 فهرست‌های من',
 mpAiHelper: '🤖 از AI بپرسید',
 mpAiHelperPrompt: '🤖 <b>دستیار هوش مصنوعی بازار</b>\n\nهر چیزی درباره خرید، فروش، امانت‌داری یا امنیت بازار از من بپرسید.\n\nسؤال خود را در زیر تایپ کنید یا روی ↩️ بازگشت ضربه بزنید.',
 mpAiThinking: '🤖 در حال فکر کردن...',
 mpAiScamWarning: `🚨 <b>هشدار امنیتی هوش مصنوعی</b>\n\n⚠️ این پیام ممکن است حاوی درخواست پرداخت مشکوک باشد. به یاد داشته باشید:\n\n🔒 <b>همیشه از طریق امانت‌داری SafeDeal پرداخت کنید</b> — فقط لینک‌هایی که با https://safedeal.sh شروع می‌شوند\n❌ هرگز از طریق PayPal، CashApp، رمزارز، حواله بانکی یا هر ربات «امانت‌دار» دیگری پول نفرستید\n📢 اگر احساس ناامنی کردید /report تایپ کنید\n\nحفاظت از شما اولویت ماست.`,
 mpUploadImages: '📸 تصاویر محصول را آپلود کنید (۱ تا ۵ عکس).\nعکس‌ها را یکی یکی ارسال کنید. وقتی تمام شد، روی ✅ اتمام آپلود ضربه بزنید.',
 mpDoneUpload: '✅ اتمام آپلود',
 mpEnterTitle: '📝 عنوان محصول را وارد کنید (حداکثر ۱۰۰ کاراکتر):',
 mpEnterDesc: '📄 توضیحات محصول را وارد کنید (حداکثر ۵۰۰ کاراکتر):',
 mpEnterPrice: '💰 قیمت را به دلار تعیین کنید ($30 - $3,000):',
 mpSelectCategory: '🏷️ یک دسته‌بندی انتخاب کنید:',
mpPreview: (title, desc, price, category, imageCount) =>
 `✅ <b>پیش‌نمایش محصول</b>\n\n📦 <b>${title}</b>\n📄 ${desc}\n💰 <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n📸 ${imageCount} تصویر\n\n🔒 محافظت‌شده با امانت‌داری SafeDeal (safedeal.sh)`,
 mpPublish: '✅ انتشار',
 mpCancel: '❌ لغو',
 mpEditProduct: '✏️ ویرایش',
 mpRemoveProduct: '❌ حذف آگهی',
 mpMarkSold: '✅ علامت‌گذاری به عنوان فروخته‌شده',
 mpProductPublished: `🎉 آگهی شما منتشر شد!\n\nخریداران می‌توانند آن را در بازار پیدا کنند.\n\n⚠️ <b>یادآوری:</b> تمام فروش‌ها باید از طریق امانت‌داری SafeDeal (safedeal.sh) انجام شود. فقط پس از اینکه SafeDeal وضعیت معامله را <b>تأمین‌شده</b> نشان داد، تحویل دهید.\n\n💡 <b>نکاتی برای فروش سریع‌تر:</b>\n• در عرض چند دقیقه به سؤالات پاسخ دهید\n• عکس‌های واضح و توضیحات دقیق اضافه کنید\n• قیمت رقابتی تعیین کنید`,
 mpProductRemoved: '✅ آگهی حذف شد.',
 mpProductSold: '✅ آگهی به عنوان فروخته‌شده علامت‌گذاری شد.',
 mpMaxListings: "❌ به حداکثر ۱۰ آگهی فعال رسیده‌اید. برخی را حذف کنید یا به عنوان فروخته‌شده علامت بزنید.",
 mpPriceError: '❌ قیمت باید بین $30 تا $3,000 دلار باشد.',
 mpNoImage: '📸 لطفاً حداقل یک تصویر از محصول آپلود کنید.',
 mpImageAsPhoto: '📸 لطفاً تصویر را به صورت عکس ارسال کنید، نه فایل.',
 mpOwnProduct: '❌ شما نمی‌توانید درباره آگهی خودتان استعلام کنید.',
 mpNoProducts: '📭 محصولی یافت نشد. بعداً دوباره بررسی کنید!',
 mpNoListings: '📭 هنوز هیچ آگهی‌ای ندارید.',
 mpNoConversations: '📭 هیچ مکالمه فعالی وجود ندارد.',
 mpChatStartBuyer: (title, price) =>
 `💬 شما در حال گفتگو با فروشنده درباره <b>${title}</b> ($${price}) هستید\n\n⚠️ <b>استفاده از امانت‌داری اجباری است</b> — وقتی آماده خرید شدید، برای پرداخت امن از طریق SafeDeal دستور /escrow را وارد کنید\n❌ مستقیماً به فروشنده یا از طریق هیچ ربات دیگری پرداخت نکنید.\n\n💡 قبل از خرید جزئیات یا مدرک بخواهید.\nبرای پایان چت /done را ارسال کنید.`,
 mpChatStartSeller: (title) =>
 `💬 🔔 یک خریدار به <b>${title}</b> علاقه‌مند است!\n🔒 محافظت‌شده با امانت‌داری SafeDeal — فقط پس از نمایش وضعیت <b>تأمین‌شده</b> تحویل دهید\n\n💡 نکته: سریع پاسخ دهید — فروشندگان سریع معاملات بیشتری می‌بندند.\nزیر پاسخ بدهید. برای پایان چت /done را ارسال کنید.`,
 mpMessageSent: '✅ پیام ارسال شد',
 mpSellerChatReady: (title) =>
 `💬 شما اکنون در چت مربوط به <b>${title}</b> هستید.\nپاسخ خود را تایپ کنید. برای خروج /done، برای شروع امانت‌داری /escrow، برای پیشنهاد قیمت /price XX را ارسال کنید.`,
 mpBuyerSays: (msg) => `💬 <b>خریدار:</b> ${msg}`,
 mpSellerSays: (msg) => `💬 <b>فروشنده:</b> ${msg}`,
 mpChatEnded: '💬 مکالمه پایان یافت. هر دو طرف مطلع شدند.',
 mpChatEndedNotify: (title) => `💬 مکالمه درباره <b>${title}</b> بسته شد.`,
 mpChatInactive: (title) => `💬 مکالمه درباره <b>${title}</b> به دلیل عدم فعالیت بسته شد.`,
 mpSellerOffline: "⏳ فروشنده در ۲۴ ساعت گذشته پاسخ نداده است. می‌توانید آگهی‌های دیگر را مرور کنید.",
 mpRateLimit: '⚠️ محدودیت پیام به پایان رسید. لطفاً قبل از ارسال بیشتر صبر کنید.',
 mpOnlyTextPhoto: '⚠️ در چت بازار فقط متن و عکس قابل ارسال است.',
 mpPaymentWarning: `🚨 <b>هشدار: پرداخت مستقیم شناسایی شد!</b>\n\n❌ هرگز مستقیماً به فروشنده، به آدرس کیف پول یا از طریق هیچ ربات دیگری پول نفرستید.\n🔒 امانت‌داری SafeDeal (safedeal.sh) <b>اجباری است</b> — این تنها راه محافظت از پول شماست. برای شروع /escrow را وارد کنید.\n📢 اگر احساس ناامنی کردید /report را وارد کنید.`,
 mpEscrowBuyer: (title, price) =>
 `🔒 <b>با امانت‌داری SafeDeal به‌صورت امن پرداخت کنید</b>\n\n📦 محصول: <b>${title}</b>\n💰 قیمت: <b>$${Number(price).toFixed(2)}</b>\n\n1. روی <b>باز کردن SafeDeal</b> بزنید ← <b>من خریدارم</b> را انتخاب کنید\n2. نام معامله: <code>${title}</code> (برای کپی بزنید)\n3. قیمت: <code>${Number(price).toFixed(2)}</code> (برای کپی بزنید)\n4. <b>اشتراک‌گذاری لینک</b> را انتخاب کنید ← با کد ایمیل وارد شوید\n5. <b>لینک دعوت را اینجا بفرستید</b> تا فروشنده بپذیرد\n6. در SafeDeal پرداخت کنید — پول شما تا تأیید تحویل نگه‌داشته می‌شود\n\n💡 کارمزد SafeDeal: ۵٪ (حداقل $10)، به‌صورت پیش‌فرض توسط خریدار پرداخت می‌شود.\n⚠️ هرگز مستقیماً به فروشنده پرداخت نکنید.`,
 mpEscrowSeller: (title, price) =>
 `🔒 <b>خریدار در حال شروع امانت‌داری SafeDeal است</b>\n\n📦 محصول: <b>${title}</b>\n💰 قیمت: <b>$${Number(price).toFixed(2)}</b>\n\n1. منتظر <b>لینک دعوت safedeal.sh</b> از خریدار در این چت باشید\n2. آن را باز کنید، با کد ایمیل وارد شوید و <b>بپذیرید</b>\n3. <b>فقط پس از</b> نمایش وضعیت <b>تأمین‌شده</b> در SafeDeal تحویل دهید\n4. پس از آزادسازی توسط خریدار پرداخت می‌شوید — یک آدرس پرداخت USDT/USDC در SafeDeal اضافه کنید\n\n💡 خریدار گیر کرده؟ خودتان بسازید: <b>SafeDeal را باز کنید</b> ← <b>من فروشنده‌ام</b> ← نام <code>${title}</code>، قیمت <code>${Number(price).toFixed(2)}</code> ← <b>اشتراک‌گذاری لینک</b> ← اینجا بفرستید.`,
 mpEscrowOutOfRange: (price) =>
 `⚠️ <b>امانت‌داری نمی‌تواند با $${Number(price).toFixed(2)} شروع شود</b>\n\nSafeDeal معاملات بین <b>$30 تا $3,000</b> را می‌پذیرد. در این چت بر سر قیمتی در این بازه توافق کنید — مثلاً <code>/price 50</code> را تایپ کنید — سپس دوباره /escrow را وارد کنید.`,
 mpOpenSafeDeal: '🔒 باز کردن SafeDeal',
 mpSafeDealLinkNote: `🔒 <b>این یک دعوت‌نامه امانت‌داری SafeDeal است</b> — روش امن برای انجام این معامله.\nآن را باز کنید، با کد ایمیل وارد شوید و بپذیرید. خریدار در SafeDeal پرداخت می‌کند؛ فروشنده فقط پس از نمایش وضعیت <b>تأمین‌شده</b> تحویل می‌دهد.`,
 mpPriceSuggest: (role, amount) => `💰 <b>${role}</b> پیشنهاد می‌دهد: <b>$${amount}</b>`,
 mpPriceUsage: 'روش استفاده: /price 50 برای پیشنهاد $50',
 mpPriceInvalid: '❌ مبلغ نامعتبر است. باید بین $30 تا $3,000 باشد.',
 mpReported: '✅ گزارش ثبت شد. مدیر این مکالمه را بررسی خواهد کرد.',
 mpChatMode: '⚠️ شما در یک چت بازار هستید. ابتدا /done را ارسال کنید تا خارج شوید.',
 mpExistingConv: '💬 شما قبلاً یک مکالمه فعال درباره این محصول دارید. در حال از سرگیری...',
 mpAllCategories: '📋 همه دسته‌بندی‌ها',
 mpEditWhat: '✏️ چه چیزی را می‌خواهید ویرایش کنید؟',
 mpEditTitle: '📝 ویرایش عنوان',
 mpEditDesc: '📄 ویرایش توضیحات',
 mpEditPrice: '💰 ویرایش قیمت',
 mpTitleUpdated: '✅ عنوان به‌روز شد.',
 mpDescUpdated: '✅ توضیحات به‌روز شد.',
 mpPriceUpdated: '✅ قیمت به‌روز شد.',
 mpListingRemoved: '📦 [آگهی حذف شد]',
 mpSellerStats: (sales, since) => `⭐ فروشنده: ${sales} فروش | عضویت از ${since}`,
 mpProductCard: (title, price, category, sellerStats) =>
 `🏷️ <b>${title}</b>\n💰 <b>$${Number(price).toFixed(2)}</b> · ${category}\n${sellerStats}\n🔒 ⚠️ امانت‌داری اجباری است — فقط از طریق SafeDeal پرداخت کنید`,
mpProductDetail: (title, desc, price, category, sellerStats, listedAgo) =>
 `📦 <b>${title}</b>\n\n📄 ${desc}\n\n💰 قیمت: <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n${sellerStats}\n📅 تاریخ ثبت: ${listedAgo}\n\n🔒 <b>استفاده از اسکرو اجباری است</b>\nفقط از طریق اسکرو SafeDeal (safedeal.sh) پرداخت کنید. هرگز مستقیم به فروشنده یا از طریق ربات آن‌ها پرداخت نکنید.`,
 mpMyListingsHeader: (count, max) => `📦 <b>آگهی‌های من</b> (${count}/${max})`,
 mpConvHeader: '💬 <b>مکالمات من</b>',
 mpConvItem: (title, role, lastMsg) => `💬 <b>${title}</b> (${role}) — ${lastMsg}`,
 mpDoneCmd: '/done',
 mpEscrowCmd: '/escrow',
 mpPriceCmd: '/price',
 mpReportCmd: '/report',
 mpEnteredChat: (title, price) => `💬 وارد چت برای <b>${title}</b> شدید ($${price})\nبرای خروج /done، برای شروع اسکرو /escrow، برای پیشنهاد قیمت /price XX را ارسال کنید.`,
 mpResumedChat: (title, price, role) => `💬 چت ادامه یافت: <b>${title}</b> ($${price}) — شما ${role} هستید\n⚠️ <b>اسکرو اجباری است</b> — فقط از طریق SafeDeal (safedeal.sh) پرداخت کنید. هرگز مستقیم به فروشنده یا از طریق ربات آن‌ها پرداخت نکنید.\n\nبرای خروج /done، برای شروع اسکرو /escrow، برای پیشنهاد قیمت /price XX را ارسال کنید.`,
 mpBuyerPhotoCaption: '💬 خریدار یک عکس ارسال کرد:',
 mpSellerPhotoCaption: '💬 فروشنده یک عکس ارسال کرد:',
 mpChatClosedReset: (title) => `💬 مکالمه درباره <b>${title}</b> توسط طرف مقابل بسته شد. شما به بازار بازگشتید.`,
 mpSellerBusy: (title) => `🆕 استعلام جدید برای <b>${title}</b>! وقتی آماده شدید روی دکمه زیر ضربه بزنید تا پاسخ دهید.`,
 mpCatDigitalGoods: '💻 کالاهای دیجیتال',
 mpCatBnkLogs: '🏦 لاگ‌های بانکی',
 mpCatBnkOpening: '🏧 افتتاح حساب بانکی',
 mpCatTools: '🔧 ابزارها',

 // === Cloud Phone/IVR ===
 cp_1: '⚠️ واریز NGN موقتاً در دسترس نیست (سرویس نرخ ارز خاموش است). لطفاً از رمزارز استفاده کنید.',
 cp_10: (TRIAL_CALLER_ID) => `📢 <b>تماس سریع IVR — آزمایش رایگان</b>\n\n🎁 شما <b>۱ تماس آزمایشی رایگان</b> دارید!\n📱 شناسه تماس‌گیرنده: <b>${TRIAL_CALLER_ID}</b> (مشترک)\n\nبا یک شماره با پیام IVR خودکار تماس بگیرید.\n\nشماره تلفن برای تماس را وارد کنید (با کد کشور):\n<i>مثال: +12025551234</i>`,
 cp_100: '🎚 <b>سرعت صحبت را انتخاب کنید</b>:',
 cp_101: '❌ سرعت نامعتبر است. یک عدد بین <b>0.25</b> و <b>4.0</b> وارد کنید:\\n<i>مثال: 0.8 یا 1.3</i>',
 cp_102: 'لطفاً یک سرعت از دکمه‌ها انتخاب کنید:',
 cp_103: (voiceName, speedLabelDisplay) => `🎤 صدا: <b>${voiceName}</b> | 🎚 سرعت: <b>${speedLabelDisplay}</b>\n\n⏳ در حال تولید پیش‌نمایش صدا...`,
 cp_104: () => `❌ تولید صدا موقتاً در دسترس نیست — لطفاً بعداً دوباره امتحان کنید.`,
 cp_105: '🎙 <b>ارائه‌دهنده صدا را انتخاب کنید</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_106: '🎙 <b>ارائه‌دهنده صدا را انتخاب کنید</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_107: '🎚 <b>سرعت صحبت را انتخاب کنید</b>\\n\\nانتخاب کنید صدا چقدر سریع صحبت کند:',
 cp_108: (holdMusic, v1) => `🎵 موسیقی انتظار: <b>${holdMusic}</b>\n${v1}`,
 cp_109: 'می‌خواهید چه کاری انجام دهید؟',
 cp_11: (buyLabel) => `📞 <b>کمپین IVR انبوه</b>\n\n🔒 این ویژگی نیازمند پلن <b>Pro</b> یا بالاتر است.\n\nابتدا یک شماره Cloud IVR دریافت کنید!\n\nروی <b>${buyLabel}</b> ضربه بزنید تا شروع کنید.`,
 cp_110: 'صدا آماده نیست. لطفاً روی ✅ تأیید ضربه بزنید.',
 cp_111: '⏭ <b>پیش‌نمایش نادیده گرفته شد — آماده تماس!</b>',
 cp_112: 'روی <b>✅ تأیید</b> ضربه بزنید تا ادامه دهید، <b>🎤 تغییر صدا</b>، یا <b>بازگشت</b>.',
 cp_113: 'می‌خواهید چه کاری انجام دهید؟',
 cp_114: '🕐 <b>زمان‌بندی تماس</b>\\n\\nتماس چند دقیقه دیگر باید برقرار شود؟\\n\\n<i>مثال‌ها: 5، 15، 30، 60</i>',
 cp_115: 'لطفاً بین ۱ تا ۱۴۴۰ دقیقه وارد کنید.',
 cp_116: (targetNumber, minutes, toLocaleTimeString) => `✅ <b>تماس زمان‌بندی شد!</b>\n\n📞 به: ${targetNumber}\n🕐 در: ${minutes} دقیقه (${toLocaleTimeString} UTC)\n\nوقتی تماس برقرار شد به شما اطلاع داده می‌شود.`,
 cp_117: (toFixed, v1) => `⚠️ <b>موجودی کیف پول کافی نیست</b>\n\nتماس‌های سریع IVR نیازمند حداقل موجودی <b>$${toFixed}</b> هستند.\n\nموجودی شما: <b>$${v1}</b>\n\nلطفاً کیف پول خود را شارژ کنید و دوباره امتحان کنید.`,
 cp_118: '🚫 <b>تماس مسدود شد</b>\\n\\nشماره تلفن شما فاقد اعتبارنامه زیرحساب است. لطفاً با پشتیبانی تماس بگیرید.',
 cp_119: (batchCount, length, target) => `📞 دسته ${batchCount}/${length}: در حال تماس با ${target}...`,
 cp_12: '📞 <b>کمپین IVR انبوه</b>\\n\\nبا چندین شماره با پیام IVR خودکار تماس بگیرید.\\nیک CSV از مخاطبان آپلود کنید و یک کمپین راه‌اندازی کنید.\\n\\n☎️ = شماره‌های مناسب برای IVR انبوه\\n\\n📱 شناسه تماس‌گیرنده را انتخاب کنید:',
 cp_120: '💾 آیا می‌خواهید این را به عنوان پیش‌تنظیم تماس سریع برای دفعه بعد ذخیره کنید؟',
 cp_121: '<b>/yes</b> را برای برقراری تماس یا <b>/cancel</b> را برای لغو فشار دهید.',
 cp_122: (presetName) => `✅ پیش‌تنظیم "<b>${presetName}</b>" ذخیره شد!\n\nدفعه بعد، آن را از منوی تماس سریع IVR انتخاب کنید تا تنظیمات را رد کنید.`,
 cp_123: '🎵 <b>کتابخانه صدا</b>\\n\\nهیچ فایل صدایی وجود ندارد. یکی آپلود کنید تا شروع کنید.',
 cp_124: (audioList) => `🎵 <b>کتابخانه صدا</b>\n\n${audioList}`,
 cp_125: 'یک گزینه انتخاب کنید:',
 cp_126: (audioList) => `🎵 <b>کتابخانه صدا</b>\n\n${audioList}`,
 cp_127: '⏳ در حال دانلود و ذخیره صدا...',
 cp_128: 'لطفاً یک فایل صدا (MP3، WAV، OGG) یا یک پیام صوتی ارسال کنید.',
 cp_129: 'یک فایل صدا یا پیام صوتی برای من ارسال کنید:',
 cp_13: '🎵 <b>کتابخانه صدا</b>\\n\\nهیچ فایل صدایی ذخیره نشده است.\\n\\nیک فایل صدا (MP3، WAV، OGG) برای استفاده در کمپین‌های IVR انبوه آپلود کنید.',
 cp_130: (name) => `✅ صدا با نام: <b>${name}</b> ذخیره شد\n\nاکنون می‌توانید از آن در کمپین‌های IVR انبوه استفاده کنید!`,
 cp_131: 'لطفاً یک شناسه تماس‌گیرنده از لیست انتخاب کنید.',
 cp_132: (phoneNumber) => `📱 شناسه تماس‌گیرنده: <b>${phoneNumber}</b>\n\n📋 <b>فایل مخاطبان را آپلود کنید</b>\n\nیک فایل <b>Excel (.xlsx)</b>، <b>.csv</b> یا <b>.txt</b> ارسال کنید. ما ستون‌های تلفن و نام را برای شما پیدا می‌کنیم (سرستون‌هایی مثل Phone، Mobile، Name یا First name کار می‌کنند)، یا از یک شماره در هر خط استفاده کنید.\nاختیاری: <code>number,name</code> در هر خط.\n\nیا شماره‌ها را مستقیماً جای‌گذاری کنید (یک شماره در هر خط):`,
 cp_133: 'شناسه تماس‌گیرنده را انتخاب کنید:',
cp_134: (message) => `❌ خواندن فایل با خطا مواجه شد: ${message}\n\nدوباره امتحان کنید یا اعداد را مستقیماً وارد کنید.`,
 cp_134b: (fname) => `❌ نمی‌توانیم <b>${fname}</b> را بخوانیم.\n\nلطفاً یک فایل <b>Excel (.xlsx)</b>، <b>.csv</b> یا <b>.txt</b> آپلود کنید (فایل‌های قدیمی .xls: ابتدا آن‌ها را به .xlsx ذخیره کنید)، یا شماره‌ها را مستقیماً وارد کنید.`,
 cp_135: 'لطفاً یک فایل ارسال کنید یا شماره تلفن‌ها را وارد کنید.',
 cp_136: (errMsg) => `❌ هیچ شماره تلفن معتبری یافت نشد.${errMsg}\n\nلطفاً فرمت را بررسی کنید: یک شماره در هر خط، با کد کشور +.`,
 cp_137: (maxLeads, length) => `❌ <b>تعداد مخاطبان بیش از حد است!</b>\n\nحداکثر <b>${maxLeads}</b> شماره در هر کمپین.\nشما <b>${length}</b> شماره آپلود کرده‌اید.\n\nلطفاً لیست خود را کاهش داده و دوباره امتحان کنید.`,
 cp_138: (length, preview, more, errNote, estCost, toFixed) => `✅ <b>${length} مخاطب بارگذاری شد!</b>\n\n${preview}${more}${errNote}\n\n💰 <b>هزینه تخمینی: $${estCost}</b> ($${toFixed}/دقیقه برای هر شماره، حداقل ۱ دقیقه — چه پاسخ داده شود چه نه)\n\n🎵 <b>انتخاب صدای IVR</b>\n\nاز کتابخانه صوتی خود انتخاب کنید، یک ضبط جدید آپلود کنید، یا با TTS از یک قالب تولید کنید:`,
 cp_138cols: (phoneCol, nameCol) => `🔎 شماره تلفن‌ها از ستون <b>${phoneCol}</b>${nameCol ? `، نام‌ها از <b>${nameCol}</b>` : ''}`,
 cp_139: '📋 یک فایل مخاطبان ارسال کنید یا شماره‌ها را وارد کنید:',
 cp_14: (audioList) => `🎵 <b>کتابخانه صوتی</b>\n\n${audioList}\n\nیک فایل صوتی جدید آپلود کنید یا یک مورد موجود را حذف کنید:`,
 cp_140: '🎵 یک فایل صوتی (MP3, WAV, OGG) یا پیام صوتی ارسال کنید:',
 cp_141: '📝 <b>تولید صدا از قالب</b>\\n\\nیک دسته قالب انتخاب کنید، یا اسکریپت سفارشی خود را بنویسید:',
 cp_142: 'صدا پیدا نشد. از لیست انتخاب کنید.',
 cp_143: (name) => `🎵 صدا: <b>${name}</b>\n\n📋 <b>انتخاب حالت کمپین</b>\n\n🔗 <b>انتقال + گزارش</b> — وقتی مخاطب کلیدی را فشار می‌دهد، به تلفن شما وصل می‌شود + همیشه گزارش می‌دهد\n📊 <b>فقط گزارش</b> — فقط ردیابی کسانی که کلیدی فشار دادند، بدون انتقال + همیشه گزارش می‌دهد\n\nهر دو حالت نتایج کامل را گزارش می‌دهند (چه کسی فشار داد، چه کسی قطع کرد و غیره)`,
 cp_144: 'یک فایل صوتی انتخاب کنید:',
 cp_145: 'صدای IVR را انتخاب کنید:',
 cp_146: '⏳ در حال ذخیره صدا...',
 cp_147: (message) => `❌ آپلود با خطا مواجه شد: ${message}`,
 cp_148: 'یک فایل صوتی یا پیام صوتی ارسال کنید:',
 cp_149: (name) => `✅ با نام ذخیره شد: <b>${name}</b>\n\n📋 <b>انتخاب حالت کمپین</b>\n\n🔗 <b>انتقال + گزارش</b> — فشار دادن ۱ به تلفن شما وصل می‌شود\n📊 <b>فقط گزارش</b> — فقط ردیابی پاسخ‌ها\n\nهر دو حالت همیشه نتایج کامل را گزارش می‌دهند.`,
 cp_15: '📞 <b>تماس IVR جدید</b>\\n\\n📞 <b>مرحله ۱/۲:</b> انتخاب کنید کدام یک از شماره‌های <b>شما</b> به عنوان <i>شناسه تماس‌گیرنده</i> نمایش داده شود:',
 cp_150: 'صدای IVR را انتخاب کنید:',
 cp_151: '🔗 <b>حالت انتقال</b>\\n\\nشماره‌ای را وارد کنید که تماس‌ها هنگام فشار دادن کلید فعال توسط مخاطب به آن منتقل شود:\\n<i>(شماره SIP یا هر شماره تلفنی)</i>\\n<i>مثال: +41791234567</i>',
 cp_152: '📊 <b>فقط گزارش</b> — بدون انتقال، فقط ردیابی.\\n\\n🔘 <b>انتخاب کلیدهای فعال</b>\\n\\nکدام کلیدها باید به عنوان پاسخ مثبت محسوب شوند؟\\n\\nیک پیش‌تنظیم انتخاب کنید یا ارقام سفارشی وارد کنید:',
 cp_153: 'یک حالت انتخاب کنید:',
 cp_154: 'حالت کمپین را انتخاب کنید:',
 cp_155: 'یک شماره تلفن معتبر با کد کشور + وارد کنید.\\n<i>مثال: +41791234567</i>',
 cp_156: (clean) => `🔗 انتقال به: <b>${clean}</b>\n\n🔘 <b>انتخاب کلیدهای فعال</b>\n\nکدام کلیدها انتقال را فعال می‌کنند؟\n\nیک پیش‌تنظیم انتخاب کنید یا ارقام سفارشی وارد کنید:`,
 cp_157: 'شماره انتقال را وارد کنید:',
 cp_158: 'حالت کمپین را انتخاب کنید:',
 cp_159: 'ارقامی که به عنوان کلید فعال محسوب می‌شوند را وارد کنید:\\n<i>مثال: 1,3,5 یا 1 2 3</i>',
 cp_16: 'هیچ پیش‌تنظیمی برای حذف وجود ندارد.',
 cp_160: 'لطفاً یک پیش‌تنظیم انتخاب کنید یا ارقام را وارد کنید:',
 cp_161: (join) => `🔘 کلیدهای فعال: <b>${join}</b>\n\n⚡ <b>تنظیم همزمانی</b>\n\nچند تماس همزمان؟ (۱-۲۰)\nپیش‌فرض: <b>10</b>`,
 cp_162: '🔘 <b>انتخاب کلیدهای فعال</b>',
 cp_163: 'حداقل یک رقم وارد کنید (0-9):\\n<i>مثال: 1,3,5</i>',
 cp_164: (join) => `🔘 کلیدهای فعال: <b>${join}</b>\n\n⚡ <b>تنظیم همزمانی</b>\n\nچند تماس همزمان؟ (۱-۲۰)\nپیش‌فرض: <b>10</b>`,
 cp_165: 'صدای IVR را انتخاب کنید:',
 cp_166: '✍️ <b>اسکریپت سفارشی</b>\\n\\nپیامی که باید گفته شود را تایپ کنید.\\nاز «دکمه ۱ را فشار دهید»، «دکمه ۲ را فشار دهید» و غیره در متن خود برای تعریف کلیدهای فعال استفاده کنید.\\n\\n<i>مثال: سلام، این یک یادآوری درباره قرار ملاقات شماست. برای تأیید ۱ را فشار دهید یا برای تغییر وقت ۲ را فشار دهید.</i>',
 cp_167: 'لطفاً یک دسته انتخاب کنید:',
 cp_168: 'یک قالب انتخاب کنید:',
 cp_169: 'یک دسته قالب انتخاب کنید:',
 cp_17: '🗑️ <b>حذف پیش‌تنظیم</b>\\n\\nیک پیش‌تنظیم برای حذف انتخاب کنید:',
 cp_170: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید ضربه بزنید، دوباره تولید کنید، یا خودتان تایپ کنید:`,
 cp_171: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا خودتان تایپ کنید:`,
 cp_172: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_174: (placeholders) => `مقدار <b>[${placeholders}]</b> را وارد کنید:`,
 cp_175: (join) => `🔘 کلیدهای فعال: <b>${join}</b>\n\n🎙 <b>انتخاب ارائه‌دهنده صدا</b>\n\nموتور TTS خود را انتخاب کنید:`,
 cp_176: 'یک دسته قالب انتخاب کنید:',
 cp_177: 'لطفاً یک قالب از دکمه‌ها انتخاب کنید.',
 cp_178: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>«${text}»</i>\n\n🔘 کلیدهای فعال: <b>${join}</b>`,
 cp_179: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید ضربه بزنید، دوباره تولید کنید، یا خودتان تایپ کنید:`,
 cp_18: (presetName) => `✅ پیش‌تنظیم «${presetName}» حذف شد.`,
 cp_180: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا خودتان تایپ کنید:`,
 cp_181: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_183: (placeholders) => `\nمقدار <b>[${placeholders}]</b> را وارد کنید:`,
 cp_184: '🎙 <b>انتخاب صدا</b>:',
 cp_185: 'یک دسته قالب انتخاب کنید:',
 cp_186: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — دوباره تولید شد: <b>${generated}</b>\nبرای تأیید ضربه بزنید، دوباره تولید کنید، یا خودتان تایپ کنید:`,
 cp_187: (currentPh) => `✍️ مقدار سفارشی خود را برای <b>[${currentPh}]</b> تایپ کنید:`,
 cp_188: (currentPh) => `✍️ شماره بازگشت تماس را برای <b>[${currentPh}]</b> تایپ کنید:\n<i>مثال: +12025551234</i>`,
cp_189: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید، تولید مجدد یا تایپ مقدار خودتان ضربه بزنید:`,
 cp_19: 'پیش‌تنظیم پیدا نشد.',
 cp_190: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا مقدار خودتان را تایپ کنید:`,
 cp_191: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_193: (currentPh, value, nextPh) => `✅ ${currentPh}: <b>${value}</b>\n\nمقدار <b>[${nextPh}]</b> را وارد کنید:`,
 cp_194: '✅ همه مقادیر پر شدند!\\n\\n🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_195: 'یک دسته قالب انتخاب کنید:',
 cp_196: 'لطفاً یک ارائه‌دهنده صدا انتخاب کنید:',
 cp_197: '🎙 <b>انتخاب صدا</b>:',
 cp_198: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_199: 'لطفاً یک صدا انتخاب کنید:',
 cp_2: (toLocaleString) => `⚠️ حداقل واریز ₦${toLocaleString} (≈ $10 USD) است. لطفاً مبلغ بیشتری وارد کنید.`,
 cp_20: (presetName, currentPlan) => `🔒 <b>پیش‌تنظیم "${presetName}" از OTP Collection استفاده می‌کند</b> که نیاز به پلن <b>Pro</b> دارد.\n\nپلن فعلی شما: <b>${currentPlan}</b>\n\nاز طریق 🔄 تمدید / تغییر پلن ارتقا دهید، یا با حالت 🔗 Transfer یک تماس جدید بسازید.`,
 cp_200: (name) => `🎤 صدا: <b>${name}</b>\n\n🎚 <b>انتخاب سرعت صحبت</b>\n\nانتخاب کنید صدا چقدر سریع صحبت کند:`,
 cp_201: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_202: '✍️ یک ضریب سرعت سفارشی وارد کنید:\\n<i>مثال‌ها: 0.6 (خیلی کند)، 0.9 (کمی کند)، 1.2 (سریع‌تر)، 1.5 (خیلی سریع)\\nمحدوده: 0.25 تا 4.0</i>',
 cp_203: '🎚 <b>انتخاب سرعت صحبت</b>:',
 cp_204: '❌ سرعت نامعتبر. یک عدد بین <b>0.25</b> و <b>4.0</b> وارد کنید:\\n<i>مثال: 0.8 یا 1.3</i>',
 cp_205: 'لطفاً یک سرعت از دکمه‌ها انتخاب کنید:',
 cp_206: (voiceName, speedLabel) => `🎤 صدا: <b>${voiceName}</b> | 🎚 سرعت: <b>${speedLabel}</b>\n\n⏳ در حال تولید صدا...`,
 cp_207: () => `❌ تولید صدا موقتاً در دسترس نیست — ضبط خودتان را آپلود کنید یا بعداً دوباره امتحان کنید.`,
 cp_208: 'یک دسته قالب انتخاب کنید:',
 cp_209: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_21: (presetName, callerId, templateName, voiceName) => `💾 <b>پیش‌تنظیم بارگذاری شد: ${presetName}</b>\n📱 از: ${callerId}\n🏢 قالب: ${templateName}\n🎙 صدا: ${voiceName}\n\nشماره مورد نظر برای تماس را وارد کنید (یا چند شماره با کاما جدا کنید):\n<i>مثال: +12025551234</i>\n<i>دسته‌ای: +12025551234, +12025555678</i>`,
 cp_210: '🎚 <b>انتخاب سرعت صحبت</b>\\n\\nانتخاب کنید صدا چقدر سریع صحبت کند:',
 cp_211: '❌ هیچ صدایی تولید نشد. دوباره امتحان کنید.',
 cp_212: (audioName, join) => `✅ صدا ذخیره شد: <b>${audioName}</b>\n🔘 کلیدهای فعال (از قالب): <b>${join}</b>\n\n📋 <b>انتخاب حالت کمپین</b>\n\n🔗 <b>Transfer + Report</b> — وقتی مشتری کلیدی فشار می‌دهد، به تلفن شما وصل می‌شود + همیشه گزارش می‌دهد\n📊 <b>Report Only</b> — فقط ردیابی می‌کند چه کسی کلید فشار داد، بدون انتقال + همیشه گزارش می‌دهد`,
 cp_213: 'روی <b>✅ استفاده از این صدا</b> یا <b>🎤 تغییر صدا</b> ضربه بزنید.',
 cp_214: '🔘 <b>انتخاب کلیدهای فعال</b>',
 cp_215: 'یک عدد بین 1 و 20 وارد کنید:',
 cp_216: 'همزمانی را تنظیم کنید (1-20):',
 cp_217: '❌ داده‌های کمپین ناقص است. لطفاً از ابتدا شروع کنید.',
 cp_218: '⏳ در حال ایجاد کمپین...',
 cp_219: (errorvoice) => `❌ شروع ناموفق بود: ${errorvoice}`,
 cp_22: 'هیچ شناسه تماس‌گیرنده واجد شرایطی پیدا نشد.',
 cp_220: 'کمپین در حال اجراست! به‌زودی به‌روزرسانی‌های پیشرفت را اینجا خواهید دید.',
 cp_221: (messagevoice) => `❌ راه‌اندازی کمپین ناموفق بود: ${messagevoice}`,
 cp_222: 'روی 🚀 راه‌اندازی کمپین یا ↩️ بازگشت ضربه بزنید.',
 cp_223: 'برای گزینه‌ها ضربه بزنید:',
 cp_224: 'کمپین در حال اجراست. از دکمه زیر استفاده کنید:',
 cp_225: '🛒 <b>انتخاب پلن:</b>',
 cp_226: '🌍 <b>همه کشورهای موجود</b>\\n\\nیک کشور انتخاب کنید:',
 cp_227: (location, numberLines) => `📱 <b>شماره‌های موجود — ${location}</b>\n\n${numberLines}\n\n☎️ = از کمپین‌های IVR دسته‌ای پشتیبانی می‌کند\n\nبرای انتخاب روی یک شماره ضربه بزنید:`,
 cp_228: (message, numberLines) => `📱 <b>شماره‌های موجود — ${message}</b>\n\n${numberLines}\n\n☎️ = از کمپین‌های IVR دسته‌ای پشتیبانی می‌کند\n\nبرای انتخاب روی یک شماره ضربه بزنید:`,
 cp_229: (areaCode, numberLines) => `📱 <b>شماره‌های موجود — منطقه ${areaCode}</b>\n\n${numberLines}\n\n☎️ = از کمپین‌های IVR دسته‌ای پشتیبانی می‌کند\n\nبرای انتخاب روی یک شماره ضربه بزنید:`,
 cp_23: (phoneNumber, recentNumber) => `📱 از: <b>${phoneNumber}</b>\n📞 به: <b>${recentNumber}</b>\n\nیک دسته قالب IVR انتخاب کنید:`,
 cp_230: (location, numberLines) => `📱 <b>شماره‌های بیشتر — ${location}</b>\n\n${numberLines}\n\n☎️ = از کمپین‌های IVR دسته‌ای پشتیبانی می‌کند\n\nبرای انتخاب روی یک شماره ضربه بزنید:`,
 cp_231: 'این پلن هنوز در دسترس نیست. لطفاً از پلن‌های موجود زیر انتخاب کنید.',
 cp_232: (planLabel) => `✅ پلن: <b>${planLabel}</b>\n\n🌍 یک کشور انتخاب کنید:`,
 cp_233: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز از کار افتاده). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 cp_234: (toLocaleString) => `Cloud IVR ₦${toLocaleString}`,
 cp_235: '⚠️ جلسه ارتقا منقضی شده. لطفاً دوباره شروع کنید.',
 cp_236: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز از کار افتاده). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 cp_237: (toLocaleString) => `ارتقای پلن ₦${toLocaleString}`,
 cp_238: '⚠️ جلسه ارتقا منقضی شده. لطفاً دوباره شروع کنید.',
 cp_239: '⚠️ هیچ تأییدیه رد شده‌ای پیدا نشد. لطفاً یک خرید شماره جدید شروع کنید.',
 cp_24: '💡 روی یکی از شماره‌های تلفن خود در صفحه‌کلید زیر ضربه بزنید.\\n\\n<i>شماره‌ای که می‌خواهید با آن تماس بگیرید را اینجا تایپ نکنید — این مرحله بعدی است. ابتدا مشخص کنید کدام شماره شما به عنوان شناسه تماس‌گیرنده نمایش داده شود.</i>',
 cp_240: '⚠️ هیچ تأییدیه رد شده‌ای پیدا نشد.',
 cp_243: '⬇️ لطفاً یک گزینه از زیر انتخاب کنید:',
 cp_244: '⚠️ لطفاً حداقل وارد کنید: <code>خیابان، شهر، کشور</code>\\n\\nمثال: <i>123 Main St, Sydney, Australia</i>',
cp_245: (countryName, toFixed, showWallet) => `❌ تنظیمات نظارتی برای ${countryName} ناموفق بود.\n\n💰 <b>$${toFixed}</b> بازگردانده شد.\n${showWallet}`,
 cp_246: (toFixed, showWallet) => `❌ تنظیمات نظارتی ناموفق بود.\n\n💰 <b>$${toFixed}</b> بازگردانده شد.\n${showWallet}`,
 cp_247: (toFixed, showWallet) => `❌ تنظیمات نظارتی ناموفق بود.\n\n💰 <b>$${toFixed}</b> بازگردانده شد.\n${showWallet}`,
 cp_248: (showWallet) => `❌ تنظیمات نظارتی ناموفق بود.\n\n💰 کیف پول شما بازگردانده شد.\n${showWallet}`,
 cp_249: '💡 <b>بیشترین استفاده را از شماره خود ببرید</b>\\n\\n📲 <b>انتقال تماس را تنظیم کنید</b> — روی تلفن واقعی‌تان زنگ بزند\\n🤖 <b>خوشامدگویی IVR اضافه کنید</b> — پاسخگوی خودکار حرفه‌ای\\n💬 <b>SMS را فعال کنید</b> — ارسال و دریافت پیامک\\n\\nبرای پیکربندی روی مدیریت شماره‌ها ضربه بزنید.',
 cp_25: (phoneNumber) => `📞 <b>تماس از:</b> ${phoneNumber}\n\n📝 شماره تلفنی که می‌خواهید <b>با آن تماس بگیرید</b> را وارد کنید:\n<i>مثال: +12025551234</i>\n\n<i>📦 برای تماس با چند شماره به طور همزمان، آن‌ها را با کاما جدا کنید — مثلاً +12025551234, +12025555678</i>`,
 cp_250: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 cp_251: (label, toLocaleString) => `${label} ₦${toLocaleString}`,
 cp_252: (numLines) => `📱 <b>انتخاب کنید کدام طرح را برای افزودن شماره می‌خواهید:</b>\n\n${numLines}`,
 cp_253: (selectedNumber) => `✅ <b>خبر خوب! بسته شما تأیید شد!</b>\n\n🔄 در حال فعال‌سازی شماره <code>${selectedNumber}</code> شما هستیم...`,
 cp_254: '⚠️ نمی‌توان وضعیت را به‌روز کرد. لطفاً دوباره امتحان کنید.',
 cp_255: '⚠️ این سفارش قابل لغو نیست — در حال پردازش یا تکمیل است.',
 cp_256: (selectedNumber, toFixed, showWallet) => `✅ <b>سفارش لغو شد</b>\n\nسفارش در انتظار شما برای <code>${selectedNumber}</code> لغو شده است.\n\n💰 <b>$${toFixed}</b> به کیف پول شما بازگردانده شد.\n${showWallet}`,
 cp_257: '⚠️ نمی‌توان سفارش را لغو کرد. لطفاً با پشتیبانی تماس بگیرید.',
 cp_258: 'لطفاً یک گزینه را انتخاب کنید:',
 cp_259: '🌍 <b>همه کشورهای موجود</b>\\n\\nیک کشور را انتخاب کنید:',
 cp_26: '📢 <b>تماس سریع IVR</b>\\n\\nبا یک پیام IVR خودکار با یک شماره تماس بگیرید.\\n\\n📞 <b>مرحله ۱/۲:</b> روی کدام شماره <b>خودتان</b> ضربه بزنید تا به عنوان <i>شناسه تماس</i> نمایش داده شود:',
 cp_260: (subNumbersAvailable, numberLines, bulkIvrSupport, tapToSelect) => `${subNumbersAvailable}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_261: (subNumberSelected, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberSelected}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_262: (subNumberArea, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberArea}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_263: (numberLines) => `📱 <b>شماره‌های بیشتر</b>\n\n${numberLines}\n\n☎️ = پشتیبانی از IVR انبوه\n\nبرای انتخاب ضربه بزنید:`,
 cp_264: (newState, v1) => `🎵 موسیقی انتظار: <b>${newState}</b>\n${v1}`,
 cp_265: 'یک URL معتبر که با http:// یا https:// شروع می‌شود وارد کنید.',
 cp_265b: 'این آدرس به یک شبکه خصوصی یا داخلی اشاره دارد. یک آدرس وب عمومی (http:// یا https://) ارسال کنید.',
 cp_266: '📝 متن خوشامدگویی که تماس‌گیرندگان می‌شنوند را تایپ کنید:',
 cp_267: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید.',
 cp_268: '✅ صدا دریافت شد. به عنوان خوشامدگویی ذخیره شود؟',
 cp_269: '🎤 <b>خوشامدگویی سفارشی</b>\\n\\nنحوه ایجاد خوشامدگویی را انتخاب کنید:',
 cp_27: 'لطفاً یک شماره تلفن معتبر که با + شروع می‌شود و ۱۰ تا ۱۵ رقم دارد وارد کنید.\\n<i>مثال: +12025551234</i>\\n\\n<i>📦 برای تماس با چند شماره به طور همزمان، آن‌ها را با کاما جدا کنید.</i>',
 cp_270: (message) => `📋 <b>${message}</b>\n\nیک قالب خوشامدگویی انتخاب کنید:`,
 cp_271: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ می‌توانید این متن را ویرایش کنید — فقط نسخه تغییر یافته را در زیر تایپ کنید.\nیا روی <b>✅ همین‌طور استفاده شود</b> ضربه بزنید تا با این خوشامدگویی ادامه دهید.`,
 cp_272: '📋 <b>قالب‌های خوشامدگویی</b>\\n\\nیک دسته‌بندی انتخاب کنید:',
 cp_273: '🌐 زبان خوشامدگویی پست صوتی خود را انتخاب کنید:\\n\\n<i>قالب به طور خودکار به زبان انتخابی شما ترجمه می‌شود.</i>',
 cp_274: '✅ متن به‌روز شد.\\n\\n🌐 زبان خوشامدگویی پست صوتی خود را انتخاب کنید:\\n\\n<i>خوشامدگویی به طور خودکار به زبان انتخابی شما ترجمه می‌شود.</i>',
 cp_275: '🎤 <b>خوشامدگویی سفارشی</b>\\n\\nانتخاب کنید:',
 cp_276: '🔄 در حال تولید پیش‌نمایش صوتی...',
 cp_277: (voice) => `✅ پیش‌نمایش (${voice})\n\nاین خوشامدگویی ذخیره شود؟`,
 cp_278: () => `❌ تولید صدا موقتاً در دسترس نیست — ضبط خود را آپلود کنید یا بعداً دوباره امتحان کنید.`,
 cp_279: (translatedText) => `🌐 <b>خوشامدگویی ترجمه شده:</b>\n\n<i>${translatedText}</i>\n\n🎙️ یک صدا انتخاب کنید:`,
 cp_280: '🎙️ یک صدا انتخاب کنید:',
 cp_281: '🎙 یک ارائه‌دهنده صدا انتخاب کنید:',
 cp_282: (message) => `🌐 در حال ترجمه به ${message}...`,
 cp_283: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_284: '🌐 زبان خوشامدگویی خود را انتخاب کنید:',
 cp_285: '📝 متن خوشامدگویی را تایپ کنید:',
 cp_286: (message) => `🌐 زبان خوشامدگویی خود را انتخاب کنید:\n\n<i>«${message}»</i>`,
 cp_287: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_288: '🌐 زبان خوشامدگویی خود را انتخاب کنید:',
 cp_289: '📝 متن خوشامدگویی را تایپ کنید:',
 cp_29: '🔍 در حال جستجوی شماره...',
 cp_290: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید.',
 cp_291: '✅ صدا دریافت شد. ذخیره شود؟',
 cp_292: '✅ خوشامدگویی پست صوتی ذخیره شد!',
 cp_293: '🎤 <b>تنظیم خوشامدگویی IVR</b>\\n\\nنحوه ایجاد خوشامدگویی را انتخاب کنید:',
 cp_294: (usedKeys) => `➕ <b>افزودن گزینه منو</b>\n\nکلیدهای استفاده شده: ${usedKeys}\n\nشماره کلید (۰-۹) برای این گزینه را وارد کنید:`,
 cp_295: ('📝 متن خوشامدگویی که تماس‌گیرندگان می‌شنوند را تایپ کنید.\\n\\n<i>مثال: «ممنون از تماس با ' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + '. برای فروش ۱ را فشار دهید، برای پشتیبانی ۲ را فشار دهید.»</i>'),
 cp_296: '🎙️ یک پیام صوتی یا فایل صوتی برای خوشامدگویی IVR خود ارسال کنید.',
 cp_297: '📋 <b>قالب‌های خوشامدگویی</b>\\n\\nقالب‌های حرفه‌ای برای مؤسسات مالی — خطوط کلاهبرداری، پشتیبانی مشتری، خارج از ساعت کاری و موارد دیگر. یک دسته‌بندی انتخاب کنید:',
 cp_298: 'یک گزینه را انتخاب کنید:',
 cp_299: '🎤 <b>تنظیم خوشامدگویی IVR</b>\\n\\nانتخاب کنید:',
cp_3: '🛡️🔥 هاستینگ Anti-Red در حال حاضر در دسترس نیست. لطفاً روی <b>💬 پشتیبانی</b> در کیبورد ضربه بزنید تا با ما در تماس باشید.',
 cp_30: (titleCase) => `📋 یافت شد: <b>${titleCase}</b>`,
 cp_300: (message) => `📋 <b>${message}</b>\n\nیک قالب خوش‌آمدگویی انتخاب کنید:`,
 cp_301: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ می‌توانید این متن را ویرایش کنید — نسخه تغییریافته را در زیر تایپ کنید.\nیا روی <b>✅ استفاده همین‌طور</b> ضربه بزنید تا با این خوش‌آمدگویی ادامه دهید.`,
 cp_302: '📋 <b>قالب‌های خوش‌آمدگویی</b>\\n\\nیک دسته‌بندی انتخاب کنید:',
 cp_303: '🌐 زبان خوش‌آمدگویی IVR خود را انتخاب کنید:\\n\\n<i>قالب به‌طور خودکار به زبان انتخابی شما ترجمه می‌شود.</i>',
 cp_304: '✅ متن به‌روزرسانی شد.\\n\\n🌐 زبان خوش‌آمدگویی IVR خود را انتخاب کنید:\\n\\n<i>خوش‌آمدگویی به‌طور خودکار به زبان انتخابی ترجمه می‌شود.</i>',
 cp_305: '🎤 <b>تنظیم خوش‌آمدگویی IVR</b>\\n\\nنحوه ایجاد خوش‌آمدگویی را انتخاب کنید:',
 cp_306: '🔄 در حال تولید پیش‌نمایش صوتی...',
 cp_307: (voice) => `✅ پیش‌نمایش تولید شد (${voice})\n\n✅ این خوش‌آمدگویی را ذخیره کنید؟\n🔄 صدای دیگری امتحان کنید؟\n📝 متن را دوباره تایپ کنید؟`,
 cp_308: () => `❌ تولید صدا موقتاً در دسترس نیست — ضبط خود را آپلود کنید یا بعداً دوباره امتحان کنید.`,
 cp_309: (translatedText) => `🌐 <b>خوش‌آمدگویی ترجمه‌شده:</b>\n\n<i>${translatedText}</i>\n\n🎙️ یک صدا انتخاب کنید:`,
 cp_31: '⏳ در حال تولید مجدد صدا برای پیش‌تنظیم (صدای قبلی منقضی شده)...',
 cp_310: '🎙️ یک صدا برای خوش‌آمدگویی خود انتخاب کنید:',
 cp_311: '🎙 یک ارائه‌دهنده صدا انتخاب کنید:',
 cp_312: (message) => `🌐 در حال ترجمه به ${message}...`,
 cp_313: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_314: '🌐 زبان خوش‌آمدگویی IVR خود را انتخاب کنید:',
 cp_315: '📝 خوش‌آمدگویی‌ای که تماس‌گیرندگان می‌شنوند را تایپ کنید:',
 cp_316: (message) => `🌐 زبان خوش‌آمدگویی IVR خود را انتخاب کنید:\n\n<i>«${message}»</i>`,
 cp_317: '✅ صدا دریافت شد. به‌عنوان خوش‌آمدگویی IVR ذخیره شود؟',
 cp_318: '❌ پردازش صدا ناموفق بود. دوباره امتحان کنید.',
 cp_319: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید.',
 cp_32: '⚠️ تولید مجدد صدا ناموفق بود. لطفاً تماس را به‌صورت دستی تنظیم کنید.',
 cp_320: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_321: '🌐 زبان خوش‌آمدگویی IVR خود را انتخاب کنید:',
 cp_322: '📝 خوش‌آمدگویی‌ای که تماس‌گیرندگان می‌شنوند را تایپ کنید.',
 cp_323: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید.',
 cp_324: '✅ خوش‌آمدگویی IVR ذخیره شد!',
 cp_325: '✅ صدا دریافت شد. به‌عنوان خوش‌آمدگویی IVR ذخیره شود؟',
 cp_326: '❌ پردازش صدا ناموفق بود. دوباره امتحان کنید.',
 cp_327: 'یک گزینه انتخاب کنید:',
 cp_328: (key) => `وقتی تماس‌گیرنده <b>${key}</b> را فشار می‌دهد چه اتفاقی باید بیفتد؟`,
 cp_329: (message) => `📋 <b>${message}</b>\n\nیک قالب انتخاب کنید:`,
 cp_33: '⚠️ صدای پیش‌تنظیم منقضی شده و قابل تولید مجدد نیست. لطفاً تماس را به‌صورت دستی تنظیم کنید.',
 cp_330: '📋 یک دسته‌بندی انتخاب کنید:',
 cp_331: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ نسخه تغییریافته را تایپ کنید، یا روی <b>✅ استفاده همین‌طور</b> ضربه بزنید:`,
 cp_332: '🌐 زبان را انتخاب کنید:\\n\\n<i>پیام به‌طور خودکار ترجمه می‌شود.</i>',
 cp_333: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید:',
 cp_334: (message) => `🌐 زبان را انتخاب کنید:\n\n<i>«${message}»</i>`,
 cp_335: (text) => `📋 <b>پیام</b>\n\n<code>${text}</code>\n\n✏️ نسخه تغییریافته را تایپ کنید، یا روی <b>✅ استفاده همین‌طور</b> ضربه بزنید:`,
 cp_336: '🔄 در حال تولید پیش‌نمایش صوتی...',
 cp_337: (key, voice) => `✅ پیش‌نمایش برای کلید <b>${key}</b> (${voice})\n\nاین گزینه را ذخیره کنید؟`,
 cp_338: () => `❌ تولید صدا موقتاً در دسترس نیست — ضبط خود را آپلود کنید یا بعداً دوباره امتحان کنید.`,
 cp_339: (translatedText) => `🌐 <b>ترجمه‌شده:</b>\n\n<i>${translatedText}</i>\n\n🎙️ یک صدا انتخاب کنید:`,
 cp_34: '💾 <b>پیش‌تنظیم بارگذاری شد — آماده تماس!</b>\\n\\n<b>/yes</b> را برای تماس یا <b>/cancel</b> را برای لغو فشار دهید.',
 cp_340: '🎙️ یک صدا انتخاب کنید:',
 cp_341: '🎙 یک ارائه‌دهنده صدا انتخاب کنید:',
 cp_342: (message) => `🌐 در حال ترجمه به ${message}...`,
 cp_343: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_344: '🌐 زبان را انتخاب کنید:',
 cp_345: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_346: '🌐 زبان را انتخاب کنید:',
 cp_347: '📝 پیام را تایپ کنید:',
 cp_348: '🎙️ یک پیام صوتی یا فایل صوتی ارسال کنید:',
 cp_35: (templateName, callerId, voiceName, join) => `💾 <b>پیش‌تنظیم بارگذاری‌شده: ${templateName}</b>\n📱 از: ${callerId}\n🎙 صدا: ${voiceName}\n🔘 کلیدهای فعال: <b>${join}</b>`,
 cp_36: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nتولیدشده خودکار: <b>${generated}</b>\nبرای پذیرش، تولید مجدد یا تایپ خودتان ضربه بزنید:`,
 cp_37: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا خودتان تایپ کنید:`,
 cp_38: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_4: (SUPPORT_USERNAME) => `📞 Cloud IVR به زودی می‌آید! برای اطلاعات بیشتر با ${SUPPORT_USERNAME} تماس بگیرید.`,
cp_40: (firstPh) => `\nمقدار <b>[${firstPh}]</b> را وارد کنید:`,
 cp_41: '📋 <b>انتخاب حالت تماس</b>\\n\\n🔗 <b>انتقال</b> — وقتی هدف کلید را فشار می‌دهد، او را به شماره شما وصل می‌کند\\n🔑 <b>دریافت OTP</b> — پس از فشردن کلید، از هدف به‌طور خودکار کد درخواست می‌شود — از طریق Telegram به شما تحویل داده می‌شود\\n\\nهر دو حالت نتایج کامل را گزارش می‌دهند.',
 cp_42: 'شماره تلفن برای تماس را وارد کنید (با کد کشور):\\n<i>مثال: +12025551234</i>',
 cp_43: '✍️ <b>اسکریپت سفارشی</b>\\n\\nپیام IVR خود را تایپ کنید. از <b>[براکت]</b> برای متغیرها استفاده کنید:\\n\\n<b>استاندارد:</b> [Name], [Company], [Bank], [Amount]\\n<b>هوشمند (پر شدن خودکار):</b> [CardLast4], [CaseID], [ReferenceNum]\\n<b>هوشمند (انتخابی):</b> [Reason], [Location], [CallBack]\\n\\n<i>مثال: Hello [Name]. This is [Bank] security. A charge of $[Amount] was made on card ending [CardLast4]. Case [CaseID]. Press 1 to dispute.</i>\\n\\nاسکریپت خود را تایپ کنید:',
 cp_44: 'یک قالب انتخاب کنید:',
 cp_45: 'لطفاً یک دسته‌بندی از دکمه‌ها انتخاب کنید.',
 cp_46: '✍️ <b>اسکریپت سفارشی</b>\\n\\nپیام IVR خود را تایپ کنید. از <b>[براکت]</b> برای متغیرها استفاده کنید:\\n\\n<b>استاندارد:</b> [Name], [Company], [Bank], [Amount]\\n<b>هوشمند (پر شدن خودکار):</b> [CardLast4], [CaseID], [ReferenceNum]\\n<b>هوشمند (انتخابی):</b> [Reason], [Location], [CallBack]\\n\\n<i>مثال: Hello [Name]. This is [Bank] security. A charge of $[Amount] was made on card ending [CardLast4]. Case [CaseID]. Press 1 to dispute.</i>\\n\\nاسکریپت خود را تایپ کنید:',
 cp_47: ('📋 <b>راهنمای کامل متغیرها</b>\\n\\n<b>🔤 استاندارد (مقدار را خودتان تایپ می‌کنید):</b>\\n• <code>[Name]</code> — نام گیرنده\\n• <code>[Bank]</code> — نام بانک یا مؤسسه\\n• <code>[Company]</code> — نام شرکت یا فروشنده\\n• <code>[Amount]</code> — مبلغ دلاری\\n\\n<b>🤖 هوشمند خودکار (برای شما تولید می‌شود):</b>\\n• <code>[CardLast4]</code> — ۴ رقم آخر کارت تصادفی\\n• <code>[CaseID]</code> — شناسه پرونده/مرجع تصادفی\\n• <code>[ReferenceNum]</code> — شماره مرجع تصادفی\\n\\n<b>📋 هوشمند انتخابی (از پیش‌تنظیمات انتخاب کنید):</b>\\n• <code>[Reason]</code> — هشدار تقلب، تعلیق حساب، فعالیت غیرمعمول و غیره\\n• <code>[Location]</code> — فرمت شهر، استان (خودتان تایپ می‌کنید)\\n• <code>[CallBack]</code> — شماره تلفن ' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + ' شما\\n\\n<b>💡 نکات:</b>\\n• متغیرهای استاندارد و هوشمند را آزادانه ترکیب کنید\\n• متغیرها به حروف بزرگ و کوچک حساسند: <code>[Bank]</code> نه <code>[bank]</code>\\n• عبارت "press 1" را در اسکریپت خود بگنجانید تا کلیدهای فعال به‌طور خودکار شناسایی شوند\\n\\nاکنون اسکریپت خود را تایپ کنید:'),
 cp_48: (keyNote) => `${keyNote}\n\nروی <b>✅ ادامه</b> ضربه بزنید تا این کلیدها حفظ شوند، یا کلیدهای جدید تایپ کنید:\n<i>مثال: 1,2,3 یا 1,5,9</i>`,
 cp_49: 'اسکریپت IVR سفارشی خود را تایپ کنید:',
 cp_5: '⚠️ نشست منقضی شده. لطفاً دوباره خرید را امتحان کنید.',
 cp_50: 'لطفاً حداقل یک رقم (0-9) وارد کنید:\\n<i>مثال: 1,2,3</i>',
 cp_51: (join) => `🔘 کلیدهای فعال به‌روز شد: <b>${join}</b>`,
 cp_52: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید، تولید مجدد یا تایپ مقدار خود ضربه بزنید:`,
 cp_53: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا مقدار خود را تایپ کنید:`,
 cp_54: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_56: (firstPh) => `مقدار <b>[${firstPh}]</b> را وارد کنید:`,
 cp_57: '📋 <b>انتخاب حالت تماس</b>\\n\\n🔗 <b>انتقال</b> — وقتی هدف کلید را فشار می‌دهد، او را به شماره شما وصل می‌کند\\n🔑 <b>دریافت OTP</b> — پس از فشردن کلید، از هدف به‌طور خودکار کد درخواست می‌شود — از طریق Telegram به شما تحویل داده می‌شود\\n\\nهر دو حالت نتایج کامل را گزارش می‌دهند.',
 cp_58: 'لطفاً یک قالب از دکمه‌ها انتخاب کنید.',
 cp_59: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 کلیدهای فعال: <b>${join}</b>`,
 cp_6: '⚠️ نشست منقضی شده. لطفاً دوباره خرید را امتحان کنید.',
 cp_60: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید، تولید مجدد یا تایپ مقدار خود ضربه بزنید:`,
 cp_61: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا مقدار خود را تایپ کنید:`,
 cp_62: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_64: (firstPh) => `\nمقدار <b>[${firstPh}]</b> را وارد کنید:`,
 cp_65: '📋 <b>انتخاب حالت تماس</b>\\n\\n🔗 <b>انتقال</b> — وقتی هدف کلید را فشار می‌دهد، او را به شماره شما وصل می‌کند\\n🔑 <b>دریافت OTP</b> — پس از فشردن کلید، از هدف به‌طور خودکار کد درخواست می‌شود — از طریق Telegram به شما تحویل داده می‌شود\\n\\nهر دو حالت نتایج کامل را گزارش می‌دهند.',
 cp_66: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — تولید مجدد: <b>${generated}</b>\nبرای تأیید، تولید مجدد یا تایپ مقدار خود ضربه بزنید:`,
 cp_67: (currentPh) => `✍️ مقدار سفارشی خود را برای <b>[${currentPh}]</b> تایپ کنید:`,
 cp_68: (currentPh) => `✍️ شماره بازگشت تماس را برای <b>[${currentPh}]</b> تایپ کنید:\n<i>مثال: +12025551234</i>`,
 cp_69: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nتولید خودکار: <b>${generated}</b>\nبرای تأیید، تولید مجدد یا تایپ مقدار خود ضربه بزنید:`,
 cp_7: '⚠️ هیچ نشست در انتظاری یافت نشد.',
 cp_70: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\nاز لیست انتخاب کنید یا مقدار خود را تایپ کنید:`,
 cp_71: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_73: (currentPh, value, nextPh) => `✅ ${currentPh}: <b>${value}</b>\n\nمقدار <b>[${nextPh}]</b> را وارد کنید:`,
 cp_74: '✅ همه مقادیر تنظیم شد!\\n\\n📋 <b>انتخاب حالت تماس</b>\\n\\n🔗 <b>انتقال</b> — وقتی هدف کلید را فشار می‌دهد، او را به شماره شما وصل می‌کند\\n🔑 <b>دریافت OTP</b> — پس از فشردن کلید، از هدف به‌طور خودکار کد درخواست می‌شود — از طریق Telegram به شما تحویل داده می‌شود\\n\\nهر دو حالت نتایج کامل را گزارش می‌دهند.',
 cp_75: '🔗 <b>حالت انتقال</b>\\n\\nشماره‌ای که هنگام فشردن کلید توسط تماس‌گیرنده باید به آن منتقل شود را وارد کنید:\\n<i>مثال: +17174794833</i>',
 ivrTrialNudge: `🎁 <b>شما ۱ تماس رایگان Quick IVR دارید!</b>

یک تماس خودکار برقرار کنید که پیام ضبط‌شده شما را پخش می‌کند و فشردن کلید یا OTP را دریافت می‌کند — رایگان، بدون نیاز به پلن.

👉 روی <b>📞 Cloud IVR + SIP</b> در پایین ضربه بزنید، سپس <b>📢 Quick IVR Call</b> را برای امتحان انتخاب کنید.`,
 cp_76: '🔒 <b>دریافت OTP</b> در آزمایش رایگان در دسترس نیست.\\n\\nبرای استفاده از دریافت OTP به پلن <b>Pro</b> یا <b>Business</b> مشترک شوید.\\n\\nهنوز می‌توانید از حالت <b>🔗 انتقال</b> برای تماس آزمایشی خود استفاده کنید.',
 cp_77: '🔑 <b>حالت دریافت OTP</b>\\n\\nکد باید چند رقم باشد؟\\n\\n💡 درخواست کد به‌طور خودکار پس از اسکریپت شما اضافه می‌شود — نیازی به درج آن نیست.\\n\\n<i>پیش‌فرض: ۶ رقم</i>',
 cp_78: 'یک حالت انتخاب کنید:',
 cp_79: '📋 <b>انتخاب حالت تماس</b>\\n\\n🔗 <b>انتقال</b> — وقتی هدف کلید را فشار می‌دهد، او را به شماره شما وصل می‌کند\\n🔑 <b>دریافت OTP</b> — پس از فشردن کلید، از هدف به‌طور خودکار کد درخواست می‌شود — از طریق Telegram به شما تحویل داده می‌شود\\n\\nهر دو حالت نتایج کامل را گزارش می‌دهند.',
 cp_8: (buyPlansHeader, price, minutes, sms, starter, v5, v6, v7, pro, v9, v10, v11, business) => `${buyPlansHeader}\n\n💡 <b>Starter</b> — $${price}/ماه\n📞 ${minutes} دقیقه + 📩 ${sms} پیامک · انتقال تماس · تا ${starter} شماره\n\n⭐ <b>Pro</b> — $${v5}/ماه\n📞 ${v6} دقیقه + 📩 ${v7} پیامک · همه امکانات Starter + پست صوتی · SIP · Webhooks · ضبط · پاسخگوی خودکار · Quick & Bulk IVR · OTP · تا ${pro} شماره\n\n👑 <b>Business</b> — $${v9}/ماه\n📞 ${v10} دقیقه + 📩 ${v11} پیامک · همه امکانات Pro + دستیار صوتی هوش مصنوعی · تماس مجدد IVR · پیام‌های OTP سفارشی · پشتیبانی اولویت‌دار · تا ${business} شماره\n\n<i>💳 تماس‌های خروجی از کیف پول کسر می‌شود</i>`,
 cp_80: 'یک تعداد رقم معتبر (1-10) وارد کنید:',
 cp_81: (length) => `✅ طول OTP: <b>${length} رقم</b> (حداکثر ۳ تلاش)\n\n✍️ <b>سفارشی‌سازی پیام‌های تماس‌گیرنده</b>\n\nآیا می‌خواهید پیامی که تماس‌گیرندگان پس از تأیید می‌شنوند را سفارشی کنید؟\n\n<b>تأیید پیش‌فرض:</b> <i>"Your code has been verified successfully. Thank you. Goodbye."</i>\n<b>رد پیش‌فرض:</b> <i>"Maximum verification attempts reached. Goodbye."</i>`,
 cp_82: (length) => `✅ طول OTP: <b>${length} رقم</b> (حداکثر ۳ تلاش)\n\n🎙 <b>انتخاب ارائه‌دهنده صدا</b>\n\nموتور TTS خود را انتخاب کنید:`,
 cp_83: '🔑 <b>حالت دریافت OTP</b>\\n\\nکد باید چند رقم باشد؟\\n\\n💡 درخواست کد به‌طور خودکار پس از اسکریپت شما اضافه می‌شود — نیازی به درج آن نیست.\\n\\n<i>پیش‌فرض: ۶ رقم</i>',
 cp_84: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_85: '✅ <b>پیام تأیید</b>\\n\\nمتنی که تماس‌گیرنده هنگام <b>تأیید</b> کد خود می‌شنود را تایپ کنید:\\n\\n<i>مثال: "Your code has been verified. We\'ve blocked the transaction and secured your account. A specialist will contact you within 24 hours. Thank you for choosing our bank. Goodbye."</i>',
 cp_86: 'یک گزینه انتخاب کنید:',
 cp_87: '✍️ <b>سفارشی‌سازی پیام‌های تماس‌گیرنده</b>\\n\\nآیا می‌خواهید پیامی که تماس‌گیرندگان پس از تأیید می‌شنوند را سفارشی کنید؟',
 cp_88: '❌ <b>پیام رد</b>\\n\\nمتنی که تماس‌گیرنده هنگام <b>رد</b> کد (رسیدن به حداکثر تلاش) می‌شنود را تایپ کنید:\\n\\n<i>مثال: "We were unable to verify your identity. For your security, this session has ended. Please call back or visit your nearest branch for assistance. Goodbye."</i>',
 cp_89: '✅ <b>پیام تأیید</b>\\n\\nمتنی که تماس‌گیرنده هنگام <b>تأیید</b> کد خود می‌شنود را تایپ کنید:',
 cp_9: (buyLabel) => `📢 <b>Quick IVR Call</b>\n\nتماس آزمایشی رایگان خود را استفاده کرده‌اید.\n\nبرای برقراری تماس‌های نامحدود IVR با شناسه تماس‌گیرنده خودتان به Cloud IVR مشترک شوید!\n\nروی <b>${buyLabel}</b> ضربه بزنید تا شروع کنید.`,
 cp_90: '✅ پیام‌های سفارشی ذخیره شد!\\n\\n🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_91: 'لطفاً یک شماره تلفن معتبر که با + شروع می‌شود وارد کنید.\\n<i>مثال: +17174794833</i>',
 cp_92: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
cp_93: 'شماره‌ای را وارد کنید که تماس‌گیرنده با فشار دادن یک کلید به آن منتقل می‌شود:\\n<i>مثال: +17174794833</i>',
 cp_94: 'لطفاً یک ارائه‌دهنده صدا انتخاب کنید:',
 cp_95: '🎤 <b>انتخاب صدا</b>\\n\\nیک صدا برای صوت IVR انتخاب کنید:',
 cp_96: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_97: (name) => `🎤 صدا: <b>${name}</b>\n\n🎚 <b>انتخاب سرعت صحبت</b>\n\nانتخاب کنید صدا با چه سرعتی صحبت کند:`,
 cp_98: '🎙 <b>انتخاب ارائه‌دهنده صدا</b>\\n\\nموتور TTS خود را انتخاب کنید:',
 cp_99: '✍️ یک ضریب سرعت سفارشی وارد کنید:\\n<i>مثال‌ها: 0.6 (خیلی کند)، 0.9 (کمی کند)، 1.2 (سریع‌تر)، 1.5 (خیلی سریع)\\nمحدوده: 0.25 تا 4.0</i>',

 // === VPS/RDP ===
 vps_1: (message) => `❌ خواندن فایل ناموفق بود: ${message}`,
 vps_10: '✏️ خط <b>موضوع</b> جدید را وارد کنید:',
 vps_11: '⚙️ <b>پنل مدیریت ایمیل</b>',
 vps_12: '📭 هیچ دامنه‌ای تنظیم نشده است.',
 vps_13: '🗑 <b>حذف دامنه</b>\\n\\nدامنه‌ای را که می‌خواهید حذف کنید انتخاب کنید:',
 vps_14: (domainList) => `🌐 <b>دامنه‌های ارسال</b>\n\n${domainList}`,
 vps_15: (domainToRemove) => `✅ دامنه <b>${domainToRemove}</b> با موفقیت حذف شد.\n\nرکوردهای DNS پاک‌سازی شدند.`,
 vps_16: (error) => `❌ حذف ناموفق بود: ${error}`,
 vps_17: (message) => `❌ خطا در حذف دامنه: ${message}`,
 vps_18: '🌐 بازگشت به دامنه‌ها.',
 vps_19: '❌ نام دامنه نامعتبر است. لطفاً یک دامنه معتبر وارد کنید (مثلاً example.com)',
 vps_2: 'لطفاً انتخاب کنید: «📝 تایپ متن ساده» یا «📎 آپلود فایل HTML»',
 vps_20: (domain) => `⏳ در حال راه‌اندازی <b>${domain}</b>...\n\nایجاد رکوردهای DNS، تولید کلیدهای DKIM...`,
 vps_21: (error) => `❌ ناموفق بود: ${error}`,
 vps_22: '⚙️ <b>پنل مدیریت ایمیل</b>',
 vps_23: 'هیچ IP فعالی برای توقف وجود ندارد.',
 vps_24: 'IP مورد نظر برای توقف را انتخاب کنید:',
 vps_25: (ip) => `⏸ IP ${ip} متوقف شد.`,
 vps_26: 'هیچ IP متوقفی وجود ندارد.',
 vps_27: 'IP مورد نظر برای از سرگیری را انتخاب کنید:',
 vps_28: (ip) => `▶️ IP ${ip} از سر گرفته شد.`,
 vps_29: '🖥️ بازگشت به IP‌ها.',
 vps_3: (totalPrice, toFixed) => `❌ موجودی کافی نیست. شما به $${totalPrice} نیاز دارید اما $${toFixed} دارید. لطفاً ابتدا واریز کنید.`,
 vps_30: '❌ آدرس IP نامعتبر است. لطفاً یک IPv4 معتبر وارد کنید (مثلاً 1.2.3.4)',
 vps_31: (trim) => `🖥️ IP <b>${trim}</b> را به کدام دامنه اختصاص دهم؟`,
 vps_32: '🖥️ بازگشت به IP‌ها.',
 vps_33: (ip, domain) => `⏳ در حال افزودن IP ${ip} به ${domain} و شروع گرم‌کردن...`,
 vps_34: '⚙️ <b>پنل مدیریت ایمیل</b>',
 vps_35: '💲 نرخ جدید به ازای هر ایمیل را وارد کنید (مثلاً 0.10):',
 vps_36: '📉 حداقل تعداد ایمیل جدید در هر کمپین را وارد کنید:',
 vps_37: '📈 حداکثر تعداد ایمیل جدید در هر کمپین را وارد کنید:',
 vps_38: '💰 بازگشت به قیمت‌گذاری.',
 vps_39: '❌ نامعتبر. یک عدد مانند 0.10 وارد کنید',
 vps_4: 'روش پرداخت را انتخاب کنید:',
 vps_40: (rate, toFixed) => `✅ نرخ به <b>$${rate}/ایمیل</b> ($${toFixed} به ازای هر 500) به‌روزرسانی شد`,
 vps_41: '💰 بازگشت به قیمت‌گذاری.',
 vps_42: '❌ نامعتبر. یک عدد وارد کنید.',
 vps_43: (min) => `✅ حداقل تعداد ایمیل به <b>${min}</b> به‌روزرسانی شد`,
 vps_44: '💰 بازگشت به قیمت‌گذاری.',
 vps_45: '❌ نامعتبر. یک عدد وارد کنید.',
 vps_46: (max) => `✅ حداکثر تعداد ایمیل به <b>${max}</b> به‌روزرسانی شد`,
 vps_47: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 vps_48: 'بانک ₦aira + کارت 🌐︎',
 vps_49: '💵 مبلغی که می‌خواهید شارژ کنید را وارد کنید ($50 – $1,000):',
 vps_5: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 vps_50: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره امتحان کنید یا از رمزارز استفاده کنید.',
 vps_51: 'بانک ₦aira + کارت 🌐︎',
 vps_52: (reason) => `🚫 <b>دسترسی به مارکت‌پلیس محدود شده است</b>\n\nشما نمی‌توانید آگهی ایجاد کنید. دسترسی شما به مارکت‌پلیس تعلیق شده است.\nدلیل: <i>${reason}</i>`,
 vps_53: (reason) => `🚫 <b>دسترسی به مارکت‌پلیس محدود شده است</b>\n\nشما نمی‌توانید آگهی ایجاد کنید. دسترسی شما به مارکت‌پلیس تعلیق شده است.\nدلیل: <i>${reason}</i>`,
 vps_54: '❌ خطا در انتشار محصول. لطفاً دوباره امتحان کنید.',
 vps_55: '🚧 سرویس VPS به زودی در دسترس خواهد بود! منتظر بمانید.',
vps_56: '🚧 سرویس VPS به زودی راه‌اندازی می‌شود! همراه ما باشید.',
 vps_57: 'نشست منقضی شد. لطفاً URL خود را دوباره وارد کنید.',
 vps_58: (displayUrl) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 برای کپی ضربه بزنید`,
 vps_59: (displayUrl) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 برای کپی ضربه بزنید`,
 vps_6: 'بانک ₦aira + کارت 🌐︎',
 vps_60: '❌ خطا در ایجاد لینک کوتاه. لطفاً دوباره تلاش کنید.',
 vps_61: 'لطفاً یک گزینه انتخاب کنید:',
 vps_62: 'نشست منقضی شد. لطفاً URL خود را دوباره وارد کنید.',
 vps_63: '❌ نام مستعار نامعتبر است. فقط از حروف، اعداد و خط تیره استفاده کنید.',
 vps_64: '❌ نام مستعار باید بین ۲ تا ۳۰ کاراکتر باشد.',
 vps_65: (customAlias) => `❌ نام مستعار <code>${customAlias}</code> قبلاً گرفته شده است. یک نام دیگر امتحان کنید.`,
 vps_66: (displayUrl) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 برای کپی ضربه بزنید`,
 vps_67: (displayUrl) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 برای کپی ضربه بزنید`,
 vps_68: '❌ خطا در ایجاد لینک کوتاه. لطفاً دوباره تلاش کنید.',
 vps_69: (domain, plan) => `❌ امکان فعال‌سازی کوتاه‌کننده URL وجود ندارد — <b>${domain}</b> دارای یک پلن هاستینگ فعال (<b>${plan}</b>) است.\n\nCNAME کوتاه‌کننده رکوردهای A هاستینگ شما را جایگزین کرده و وب‌سایت شما را آفلاین می‌کند.\n\nلطفاً از دامنه دیگری استفاده کنید یا ابتدا پلن هاستینگ خود را غیرفعال کنید.`,
 vps_7: (toLocaleString, price, totalEmails) => `📧 <b>پرداخت ارسال انبوه ایمیل</b>\n\n💵 مبلغ: <b>₦${toLocaleString}</b> (~$${price})\n📬 کمپین: ${totalEmails} ایمیل\n\n🏦 پرداخت خود را از طریق لینک زیر تکمیل کنید:`,
 vps_70: (domain, sanitizeProviderError) => `❌ امکان اتصال <b>${domain}</b> وجود ندارد: ${sanitizeProviderError}`,
 vps_71: (domain, sanitizeProviderError) => `❌ خطای DNS برای <b>${domain}</b>: ${sanitizeProviderError}`,
 vps_72: (domain, error) => `❌ خطای DNS برای <b>${domain}</b>: ${error}`,
 vps_73: 'لطفاً یک دامنه معتبر انتخاب کنید',
 vps_74: (shortUrl) => `URL کوتاه‌شده شما: ${shortUrl}`,
 vps_75: (shortUrl) => `URL کوتاه‌شده شما: ${shortUrl}`,
 vps_76: (domain) => `❌ <b>${domain}</b> مسدود شده و به دلیل نقض سیاست‌های سوءاستفاده قابل ثبت یا استفاده نیست.`,
 vps_77: (domain) => `🔍 در حال جستجوی دسترس‌پذیری برای ${domain} ...`,
 vps_78: (domain) => `❌ <b>${domain}</b> در دسترس نیست.`,
 vps_79: (baseName) => `🔍 در حال جستجوی گزینه‌های جایگزین برای <b>${baseName}</b> ...`,
 vps_8: '❌ آدرس ایمیل نامعتبر است. لطفاً یک ایمیل معتبر وارد کنید (مثال: you@gmail.com):',
 vps_80: (altList) => `✅ گزینه‌های جایگزین موجود:\n\n${altList}\n\nهر نام دامنه‌ای را برای بررسی تایپ کنید:`,
 vps_81: 'گزینه جایگزینی یافت نشد. یک نام دیگر امتحان کنید:',
 vps_82: (ns) => `نیم‌سرور نامعتبر: <code>${ns}</code>\nلطفاً هاست‌نیم‌های معتبر نیم‌سرور وارد کنید.`,
 vps_83: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره تلاش کنید یا از ارز دیجیتال استفاده کنید.',
 vps_84: 'بانک ₦aira + کارت 🌐︎',
 vps_85: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره تلاش کنید یا از ارز دیجیتال استفاده کنید.',
 vps_86: 'بانک ₦aira + کارت 🌐︎',
 vps_87: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره تلاش کنید یا از ارز دیجیتال استفاده کنید.',
 vps_88: 'بانک ₦aira + کارت 🌐︎',
 vps_89: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره تلاش کنید یا از ارز دیجیتال استفاده کنید.',
 vps_9: (testAddr) => `⏳ در حال ارسال ایمیل آزمایشی به <b>${testAddr}</b>...`,
 vps_90: 'بانک ₦aira + کارت 🌐︎',
 vps_91: '⚠️ پردازش پرداخت موقتاً در دسترس نیست (سرویس نرخ ارز در دسترس نیست). لطفاً بعداً دوباره تلاش کنید یا از ارز دیجیتال استفاده کنید.',
 vps_92: 'بانک ₦aira + کارت 🌐︎',
 vps_93: 'رکوردهای DNS توسط ارائه‌دهنده نیم‌سرور سفارشی شما مدیریت می‌شوند. از «🔄 مدیریت نیم‌سرورها» برای تغییر ارائه‌دهنده استفاده کنید.',
 vps_94: (domain, plan) => `❌ امکان فعال‌سازی کوتاه‌کننده URL وجود ندارد — <b>${domain}</b> دارای یک پلن هاستینگ فعال (<b>${plan}</b>) است.\n\nCNAME کوتاه‌کننده رکوردهای A هاستینگ شما را جایگزین کرده و وب‌سایت شما را آفلاین می‌کند.\n\nلطفاً از دامنه دیگری استفاده کنید یا ابتدا پلن هاستینگ خود را غیرفعال کنید.`,
 vps_95: (domain, sanitizeProviderError) => `❌ امکان اتصال <b>${domain}</b> وجود ندارد: ${sanitizeProviderError}`,
 vps_96: (domain, sanitizeProviderError) => `❌ خطای DNS برای <b>${domain}</b>: ${sanitizeProviderError}`,
 vps_97: (domain, error) => `❌ خطای DNS برای <b>${domain}</b>: ${error}`,
 vps_98: (message) => `❌ خطا: ${message}`,

 // === Email Validation ===
 ev_1: '🚧 سرویس اعتبارسنجی ایمیل در حال حاضر در دست تعمیر است. لطفاً بعداً دوباره تلاش کنید.',
 ev_10: (message) => `❌ خطا: ${message}`,
 ev_11: '❌ فرمت IPv4 نامعتبر است. مانند این ارسال کنید: <code>1.2.3.4</code>',
 ev_12: (ipInput) => `✅ IP <code>${ipInput}</code> به مجموعه اضافه شد.`,
 ev_13: (ipInput) => `✅ IP <code>${ipInput}</code> از مجموعه حذف شد.`,
 ev_14: (message) => `❌ خطا: ${message}`,
 ev_15: '❌ لغو شد.',
 ev_16: '❌ لغو شد.',
 ev_17: '❌ لطفاً یک فایل <b>.csv</b> یا <b>.txt</b> آپلود کنید.',
 ev_18: (message) => `❌ خواندن فایل ناموفق بود: ${message}`,
 ev_19: '📎 لطفاً یک فایل CSV/TXT حاوی آدرس‌های ایمیل آپلود کنید.',
ev_2: '📧 بازگشت به منوی اعتبارسنجی ایمیل...',
 ev_20: '❌ هیچ آدرس ایمیل معتبری در فایل یافت نشد. لطفاً فرمت را بررسی کنید.',
 ev_21: (minEmails, length) => `❌ حداقل <b>${minEmails}</b> ایمیل مورد نیاز است. فقط ${length} مورد یافت شد.`,
 ev_22: (toLocaleString, v1) => `❌ حداکثر <b>${toLocaleString}</b> ایمیل مجاز است. ${v1} مورد یافت شد.`,
 ev_23: '❌ لغو شد.',
 ev_24: '📋 لطفاً آدرس‌های ایمیل را وارد کنید (هر خط یک ایمیل یا با کاما جدا شده).',
 ev_25: '❌ هیچ آدرس ایمیل معتبری یافت نشد. لطفاً فرمت را بررسی کنید.',
 ev_26: (maxPasteEmails, length) => `❌ حالت چسباندن تا <b>${maxPasteEmails}</b> ایمیل را پشتیبانی می‌کند. ${length} مورد یافت شد. برای لیست‌های بزرگ‌تر از آپلود فایل استفاده کنید.`,
 ev_27: (minEmails, length) => `❌ حداقل <b>${minEmails}</b> ایمیل مورد نیاز است. فقط ${length} مورد یافت شد.`,
 ev_28: '❌ لغو شد.',
 ev_29: '❌ نشست منقضی شده. لطفاً دوباره شروع کنید.',
 ev_3: '⚠️ ارتباط با worker برقرار نشد',
 ev_30: '❌ آزمایش رایگان برای این اندازه لیست در دسترس نیست. لطفاً یک روش پرداخت انتخاب کنید.',
 ev_31: '❌ آزمایش رایگان قبلاً استفاده شده. لطفاً یک روش پرداخت انتخاب کنید.',
 ev_32: '❌ Trial + Pay در دسترس نیست. لطفاً یک روش پرداخت انتخاب کنید.',
 ev_33: '❌ آزمایش رایگان قبلاً استفاده شده. لطفاً یک روش پرداخت انتخاب کنید.',
 ev_34: (toFixed, v1) => `⚠️ موجودی USD برای ایمیل‌های اضافی کافی نیست.\n💰 نیاز: <b>$${toFixed}</b>\n💳 موجودی: <b>$${v1}</b>\n\nلطفاً کیف پول خود را شارژ کنید یا با NGN قیمت کامل را پرداخت نمایید.`,
 ev_35: (toFixed, v1) => `⚠️ موجودی USD کافی نیست.\n💰 نیاز: <b>$${toFixed}</b>\n💳 موجودی: <b>$${v1}</b>\n\nلطفاً کیف پول خود را شارژ کنید.`,
 ev_36: (toFixed, toLocaleString) => `✅ <b>پرداخت موفق!</b>\n\n💵 کسر شده: <b>$${toFixed}</b>\n📧 در حال اعتبارسنجی: <b>${toLocaleString} ایمیل</b>\n\n⏳ پردازش به زودی شروع می‌شود. به‌روزرسانی‌های پیشرفت را دریافت خواهید کرد.`,
 ev_37: 'لطفاً یک روش پرداخت انتخاب کنید:',
 ev_4: (message) => `❌ خطا: ${message}`,
 ev_5: '⚠️ هیچ IP از API ارائه‌دهنده ابری یافت نشد یا اعتبارنامه‌ها ناقص هستند.',
 ev_6: (message) => `❌ خطای Cloud API: ${message}`,
 ev_7: '➕ <b>افزودن IP</b>\\n\\nآدرس IPv4 مورد نظر برای افزودن را ارسال کنید (مثال: <code>1.2.3.4</code>):',
 ev_8: (message) => `❌ خطا: ${message}`,
 ev_9: '♻️ تمام آمار سلامت IP به حالت سالم بازنشانی شد.',

 // === Hosting ===
 host_1: '❌ خطا در پردازش پرداخت. لطفاً با پشتیبانی تماس بگیرید.',
 host_10: (startsWith) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 برای کپی کردن ضربه بزنید`,
 host_11: (startsWith) => `✅ <b>لینک کوتاه شد!</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 برای کپی کردن ضربه بزنید`,
 host_12: '❌ خطا در ایجاد لینک کوتاه. لطفاً دوباره امتحان کنید.',
 host_13: 'مجاز نیست',
 host_14: 'مجاز نیست',
 host_15: (userToUnblock) => `کاربر ${userToUnblock} یافت نشد`,
 host_16: (userToUnblock) => `کاربر ${userToUnblock} رفع انسداد شد.`,
 host_17: 'مجاز نیست',
 host_18: 'مجاز نیست',
 host_19: (previewText, statsText) => `${previewText}\n\n${statsText}\n\nآماده ارسال همگانی هستید؟`,
 host_2: 'سلام، ادمین! لطفاً یک گزینه انتخاب کنید:',
 host_20: '🚀 شروع ارسال همگانی... این ممکن است برای پایگاه‌های کاربری بزرگ مدتی طول بکشد.',
 host_21: (message) => `❌ ارسال همگانی ناموفق بود: ${message}`,
 host_22: '📤 ارسال همگانی آغاز شد! به‌روزرسانی‌های پیشرفت را دریافت خواهید کرد.',
 host_23: (message, plan) => `<b>${message}</b> قبلاً روی پلن ${plan} است. یک دامنه دیگر انتخاب کنید.`,
 host_24: 'لطفاً یک دامنه از لیست انتخاب کنید.',
 host_25: '✅ شما در حال حاضر روی بالاترین پلن (Golden Anti-Red) هستید. ارتقایی در دسترس نیست.',
 host_26: (toFixed, price) => `⚠️ موجودی کافی نیست. موجودی شما $${toFixed} است اما $${price} نیاز دارید.`,
 host_27: 'لطفاً یکی از گزینه‌های ارتقا را انتخاب کنید.',
 host_28: (toFixed, upgradePrice) => `⚠️ موجودی کافی نیست. موجودی شما $${toFixed} است اما $${upgradePrice} نیاز دارید.`,
 host_29: (error) => `❌ ارتقا ناموفق بود: ${error}\nکیف پول شما بازپرداخت شده است.`,
 host_3: (toFixed, length) => `💰 مبلغ <b>$${toFixed}</b> از ${length} تأیید رد شده به‌طور خودکار بازپرداخت شد. می‌توانید هر زمان خرید جدیدی شروع کنید.`,
 host_30: '❌ ارتقا ناموفق بود. کیف پول شما بازپرداخت شده است. لطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.',
 host_31: '🚧 سرویس VPS به زودی راه‌اندازی می‌شود! همراه ما باشید.',
 host_32: '⚠️ بارگذاری صفحه معرفی امکان‌پذیر نیست. بعداً دوباره امتحان کنید.',

// === طرح هاستینگ / تجربه صورت‌حساب (اضافه‌شده ۲۰۲۶-۰۲) ===
// Headers
myHostingPlansHeader: '📋 <b>پلن‌های هاستینگ من</b>',
billingMenuHeader: '💳 <b>پلن / صورتحساب من</b>',
billingMenuIntro: 'تمدید و تمدید خودکار هر یک از پلن‌های هاستینگ خود را مدیریت کنید.',
billingMenuEmpty: '💳 <b>پلن من / صورت‌حساب</b>\n\nشما هنوز هیچ پلن هاستینگ فعالی ندارید.',
// Status indicators
statusActive: '✅ فعال',
statusActiveOnline: '✅ فعال (آنلاین)',
statusSuspended: '🚫 معلق',
statusSuspendedFull: '🚫 معلق (آفلاین — کامل)',
statusExpired: '❌ منقضی',
statusMaintenance: '🛠️ تعمیر و نگهداری (آفلاین — فقط عمومی)',
// حالت‌های تمدید خودکار
autoRenewOn: '✅ روشن',
autoRenewOff: '❌ خاموش',
autoRenewWeeklyOff: '❌ خاموش (پلن‌های هفتگی هرگز تمدید خودکار ندارند)',
autoRenewWeeklyShort: '❌ خاموش (هفتگی)',
// Field labels
planLabel: 'پلن:',
statusLabel: 'وضعیت:',
domainTypeFieldLabel: 'نوع دامنه:',
createdLabel: 'ایجاد شده:',
expiresLabel: 'انقضا:',
autoRenewFieldLabel: 'تمدید خودکار:',
usernameLabel: 'نام کاربری:',
priceLabel: 'قیمت:',
durationLabel: 'مدت:',
walletBalanceLabel: 'موجودی کیف پول:',
chargedLabel: 'کسر شده:',
newExpiryLabel: 'تاریخ انقضای جدید:',
remainingBalanceLabel: 'موجودی باقی‌مانده:',
domainLabel: 'دامنه:',
currentLabel: 'فعلی:',
// بدنه نمای طرح
planViewCredentialsHint: 'روی «نمایش اطلاعات ورود» بزنید تا نام کاربری و PIN پنل هاست شما نمایش داده شود.',
planViewBillingNudge: '💡 برای تمدید یا تغییر تمدید خودکار، از منوی هاستینگ وارد <b>💳 پلن من / صورت‌حساب</b> شوید.',
planViewMultiHostUpsell: '💡 <b>می‌خواهید سایت‌های بیشتری هاست کنید؟</b> به پلن ماهانه ارتقا دهید تا از هاستینگ چند سایته، فضای بیشتر و حفاظت پیشرفته Anti-Red بهره‌مند شوید.',
// Renew modal
renewModalHeader: planName => `<b>تمدید پلن — ${planName}</b>`,
renewModalCurrentExpiry: (date, isExpired) => `<b>تاریخ انقضای فعلی:</b> ${date}${isExpired ? ' (منقضی شده)' : ''}`,
weeklyRenewTooEarly: (domain, expiry, opensAt) => `⏳ <b>تمدید هنوز باز نشده</b>\n\n<b>${domain}</b> در پلن هفتگی است که هر بار یک هفته تمدید می‌شود و فقط وقتی ۷ روز یا کمتر مانده باشد باز می‌شود.\n\n<b>تاریخ انقضای فعلی:</b> ${expiry}\n<b>تمدید باز می‌شود:</b> ${opensAt}\n\nمی‌خواهید مدت بیشتری داشته باشید؟ روی <b>⬆️ ارتقای هاستینگ</b> بزنید تا به پلن ماهانه منتقل شوید.`,
renewAlreadyApplied: domain => `ℹ️ <b>${domain}</b> همین الان توسط درخواست دیگری تمدید یا تغییر یافته، بنابراین این پرداخت انجام نشد. پلن را دوباره باز کنید تا آخرین تاریخ انقضا را ببینید.`,

renewModalDuration: days => `<b>مدت:</b> ${days} روز`,
renewModalConfirmHint: '✅ پرداخت را در زیر تأیید کنید:',
renewModalInsufficient: '⚠️ موجودی کافی نیست. لطفاً ابتدا واریز کنید.',
renewModalPayButton: price => `💵 پرداخت $${price} USD`,
// موفقیت / شکست تمدید
renewSuccessTitle: '✅ <b>پلن با موفقیت تمدید شد!</b>',
renewSuccessAntiRedNote: 'حفاظت Anti-Red بازنشانی شده است.',
renewFailureFallback: '❌ تمدید ناموفق بود. موجودی کیف پول شما بازگشت داده شد. لطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.',
// Upgrade modal
upgradeModalHeader: '<b>⬆️ ارتقای هاستینگ</b>',
upgradeModalChooseHint: 'پلن جدید خود را انتخاب کنید:',
// صفحه تأیید ارتقا
upgradeConfirmTitle: '<b>⬆️ تأیید ارتقا</b>',
upgradeConfirmTo: name => `<b>ارتقا به:</b> ${name}`,
upgradeConfirmListPrice: price => `<b>قیمت اصلی:</b> $${price}`,
upgradeConfirmYouPay: amount => `<b>شما پرداخت می‌کنید:</b> $${amount}`,
upgradeConfirmRenewsAt: (price, days) => `<b>🔁 تمدید با:</b> $${price} هر ${days} روز`,
upgradeConfirmNextRenewal: (date, days) => `<b>📅 تمدید بعدی:</b> ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} — یک دوره ${days} روزه جدید از امروز شروع می‌شود`,
upgradeModalKeepsExpiry: date => `📅 تاریخ انقضای شما (<b>${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b>) بدون تغییر می‌ماند — اکنون فقط تفاوت قیمت بین پلن‌های ماهانه را پرداخت می‌کنید.`,
upgradeConfirmKeepsExpiry: date => `<b>📅 تاریخ انقضا:</b> ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} — بدون تغییر، سپس با قیمت جدید تمدید می‌شود`,
upgradeQuoteChanged: 'ℹ️ قیمت ارتقا از زمان نمایش تغییر کرده است (تاریخ یا قیمت پلن شما تغییر کرده). هیچ مبلغی کسر نشده — روی ⬆️ ارتقای پلن بزنید تا قیمت فعلی را ببینید.',
// رسید ارتقا + خطاهای ارتقا (کیف پول قبلاً بازپرداخت شده)
upgradeSuccessTitle: '✅ <b>ارتقای پلن با موفقیت انجام شد!</b>',
upgradeSuccessOldPlan: name => `<b>پلن قبلی:</b> ${name}`,
upgradeSuccessNewPlan: name => `<b>پلن جدید:</b> ${name}`,
upgradeSuccessNewExpiry: date => `<b>انقضای جدید:</b> ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
upgradeSuccessFooter: planKey => `${planKey === 'goldenCpanel' ? 'دامنه‌های نامحدود' : 'تا ۵ دامنه addon'} اکنون در دسترس است. حفاظت Anti-Red تازه‌سازی شد.`,
upgradeFailTerminated: (refund, hostingBtn) => `❌ این حساب هاستینگ به دلیل عدم تمدید در مهلت مقرر <b>حذف شده</b> است.\n\nمبلغ <b>$${refund}</b> به کیف پول شما بازگردانده شد.\n\n🛒 برای راه‌اندازی مجدد سایت، لطفاً یک <b>پلن هاستینگ جدید</b> از <b>${hostingBtn}</b> خریداری کنید.`,
upgradeFailReactivate: (refund, supportBtn) => `❌ <b>ارتقا انجام نشد</b>\n\nامکان فعال‌سازی مجدد حساب هاستینگ شما روی سرور وجود نداشت. مبلغ <b>$${refund}</b> به کیف پول شما بازگردانده شد.\n\nمدیر سیستم مطلع شده است — لطفاً روی ${supportBtn} ضربه بزنید تا پیگیری کنید.`,
upgradeFailServer: (reason, refund, supportBtn) => `❌ <b>ارتقا انجام نشد</b>\n\nسرور هاستینگ تغییر پلن را نپذیرفت (<i>${reason}</i>). مبلغ <b>$${refund}</b> به کیف پول شما بازگردانده شد.\n\nمدیر سیستم مطلع شده است — لطفاً روی ${supportBtn} ضربه بزنید تا پیگیری کنید.`,
fmtDate: d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
renewTerminated: hostingBtn => `❌ این حساب هاستینگ به دلیل عدم تمدید در مهلت مقرر <b>حذف شده</b> است.\n\n🛒 برای راه‌اندازی مجدد سایت، لطفاً یک <b>پلن هاستینگ جدید</b> از <b>${hostingBtn}</b> خریداری کنید.`,
renewalPriceChangedNotice: (domain, plan, oldPrice, newPrice, nextDate, autoRenew) => `ℹ️ <b>قیمت تمدید به‌روز شد</b>\n\nهاستینگ <b>${domain}</b> شما روی <b>${plan}</b> است. قیمت تمدید آن اکنون <b>$${newPrice}</b> (قبلاً $${oldPrice}) است تا با پلن فعلی شما مطابقت داشته باشد.${nextDate ? `\n\n📅 تمدید بعدی: <b>${new Date(nextDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b>${autoRenew ? ' — تمدید خودکار فعال است، لطفاً موجودی کافی در کیف پول داشته باشید.' : ''}` : ''}\n\nهیچ مبلغی اکنون کسر نشده و تمدیدهای قبلی تغییری نکرده‌اند.`,
// دکمه‌های صورت‌حساب هر دامنه
billingRenewBtn: domain => `🔄 تمدید الان — ${domain}`,
billingToggleAutoRenewBtn: domain => `🔁 تغییر وضعیت تمدید خودکار — ${domain}`,
// وضعیت تغییر تمدید خودکار
autoRenewTurnedOn: domain => `✅ تمدید خودکار برای <b>${domain}</b> اکنون <b>فعال</b> است. پلن شما به صورت خودکار پس از انقضا تمدید خواهد شد.`,
autoRenewTurnedOff: domain => `❌ تمدید خودکار برای <b>${domain}</b> اکنون <b>غیرفعال</b> است. پلن شما منقضی شده و پس از مهلت مقرر تعلیق خواهد شد.`,
autoRenewNotForWeekly: '❌ تمدید خودکار برای پلن‌های هفتگی در دسترس نیست.',
// Toast strings
siteAlreadyOffline: '⚠️ سایت شما از قبل آفلاین است. از «آنلاین کردن سایت» برای فعال‌سازی مجدد استفاده کنید.',
siteAlreadyOnline: '✅ سایت شما در حال حاضر آنلاین است.',
addonNotOnPlan: '⚠️ آن دامنه در این پلن به عنوان addon ثبت نشده است.',
promoMessagesEnabled: '🔔 پیام‌های تبلیغاتی اکنون فعال شدند.',
promoMessagesDisabled: '✅ پیام‌های تبلیغاتی اکنون غیرفعال شدند.',
// Credentials reveal
credentialsHeader: domain => `🔑 <b>اطلاعات ورود برای ${domain}</b>`,
credentialsPinLabel: 'PIN:',
credentialsPanelUrlLabel: 'آدرس ورود به پنل:',
credentialsFreshNotice: '⚠️ <i>این PIN به تازگی تولید شده است. PIN قدیمی شما دیگر معتبر نیست.</i>',
// اعلان‌های زمان‌بند هاستینگ
schedExpiryWarningTitle: '⏰ <b>اطلاعیه انقضای هاستینگ</b>',
schedExpiryWarningBody: (plan, domain) => `پلن <b>${plan}</b> برای <b>${domain}</b> کمتر از ۲۴ ساعت دیگر منقضی می‌شود.`,
schedExpiry3dBody: (plan, domain, date) => `پلن <b>${plan}</b> برای <b>${domain}</b> در <b>۳ روز</b> دیگر (${date}) منقضی می‌شود.`,
schedRenewTextOnPrice: price => `تمدید خودکار <b>فعال</b> است — مبلغ <b>$${price}</b> در زمان انقضا از کیف پول شما کسر خواهد شد.`,
schedRenewTextOn: '✅ تمدید خودکار <b>فعال</b> است. پلن شما به صورت خودکار پس از انقضا تمدید خواهد شد.',
schedRenewTextOff: hours => `تمدید خودکار <b>غیرفعال</b> است. هاستینگ شما <b>بلافاصله پس از انقضا تعلیق</b> شده و در صورت عدم تمدید دستی پس از ${hours} ساعت حذف خواهد شد.`,
schedRenewTextWeekly: 'پلن‌های هفتگی به صورت خودکار تمدید نمی‌شوند. لطفاً قبل از انقضا به صورت دستی تمدید کنید.',
schedRenewTextWalletHint: 'موجودی کیف پول: بررسی از طریق /wallet',
schedRenewTextToggleHint: domain => `برای تغییر وضعیت تمدید خودکار: <b>💳 پلن من / صورتحساب</b> را باز کنید`,
schedAutoRenewedTitle: '✅ <b>پلن به صورت خودکار تمدید شد!</b>',
schedAutoRenewedBody: (plan, domain, price, newExpiry, remBalance) =>
  `<b>${plan}</b> برای <b>${domain}</b> تمدید شد.\n<b>مبلغ کسر شده:</b> $${price}\n<b>انقضای جدید:</b> ${newExpiry}\n<b>موجودی باقی‌مانده:</b> $${remBalance}`,
schedAutoRenewFailedTitle: '⚠️ <b>تمدید خودکار ناموفق بود — موجودی کافی نیست</b>',
schedAutoRenewFailedBody: (plan, domain, price, balance, hours) =>
  `<b>${plan}</b> برای <b>${domain}</b> منقضی شده است.\n<b>قیمت تمدید:</b> $${price}\n<b>موجودی شما:</b> $${balance}\n\nلطفاً برای تمدید، موجودی واریز کنید.\nهاستینگ شما <b>تعلیق شده</b> است. برای فعال‌سازی مجدد موجودی واریز کنید.\nحساب شما در صورت عدم تمدید ظرف ${hours} ساعت <b>حذف خواهد شد</b>.`,
schedWeeklyExpiredTitle: '⏰ <b>پلن هفتگی منقضی شد</b>',
schedWeeklyExpiredBody: (plan, domain, hours) =>
  `پلن <b>${plan}</b> برای <b>${domain}</b> منقضی شده است.\n\n⚠️ پلن‌های هفتگی به صورت خودکار تمدید <b>نمی‌شوند</b>.\nهاستینگ شما <b>تعلیق شده</b> است — وب‌سایت اکنون آفلاین است.\nلطفاً از <b>💳 پلن من / صورتحساب</b> به صورت دستی تمدید کنید.\n\nحساب شما در صورت عدم تمدید ظرف ${hours} ساعت <b>به طور دائمی حذف خواهد شد</b>.`,
schedDeletedTitle: '🗑️ <b>هاستینگ حذف شد</b>',
schedDeletedBody: (domain, plan) =>
  `حساب cPanel مربوط به <b>${domain}</b> به طور دائمی حذف شد.\nپلن: ${plan}\n\nتمام فایل‌ها، پایگاه‌های داده و ایمیل‌ها حذف شده‌اند.\nبرای شروع مجدد، یک پلن هاستینگ جدید خریداری کنید.`,
schedDeletedBodyHours: (domain, plan, hoursExpired, gracePeriod) =>
  `حساب cPanel مربوط به <b>${domain}</b> به طور دائمی حذف شد.\nپلن: ${plan} — ${hoursExpired} ساعت پیش منقضی شد (مهلت ${gracePeriod} ساعته رد شد).\n\nتمام فایل‌ها، پایگاه‌های داده و ایمیل‌ها حذف شده‌اند.\nبرای شروع مجدد، یک پلن هاستینگ جدید خریداری کنید.`,
schedSuspendedTitle: '🚫 <b>هاستینگ تعلیق شد</b>',
schedSuspendedBody: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> تعلیق شده است — پلن <b>${plan}</b> شما ${hoursExpired} ساعت پیش منقضی شد.\n\n⚠️ سایت شما اکنون <b>آفلاین</b> است.\nبرای فعال‌سازی مجدد از <b>💳 پلن من / صورتحساب</b> تمدید کنید.\nحساب در صورت عدم تمدید ${gracePeriod} ساعت پس از انقضا <b>به طور دائمی حذف خواهد شد</b>.`,
// === مانیتور تلفن / زمان‌بند تلفن ===
phoneCallerIdFlaggedTitle: '⚠️ <b>شناسه تماس‌گیرنده علامت‌گذاری شد</b>',
phoneCallerIdFlaggedBody: phoneNumber =>
`شماره تلفن شناسه تماس‌گیرنده <b>${phoneNumber}</b> توسط اپراتور علامت‌گذاری و تعلیق شده است.\n\nاین شماره دیگر نمی‌تواند برای تماس‌های خروجی یا کمپین‌ها استفاده شود.\n\n👉 لطفاً از منوی <b>Cloud IVR + SIP</b> یک شماره جدید خریداری کنید تا بتوانید تماس‌های خود را ادامه دهید.\n\nاگر سؤالی دارید، با پشتیبانی تماس بگیرید.`,
phoneAutoRenewFailedTitle: '❌ <b>تمدید خودکار ناموفق — شماره حذف شد</b>',
phoneAutoRenewFailedBody: (phoneNumber, planName, planPrice, buyLabel) =>
  `📞 ${phoneNumber}\n📦 پلن: ${planName} ($${planPrice}/ماه)\n\n⚠️ موجودی کیف پول کافی نیست. شماره شما به صورت <b>دائمی حذف شده</b> تا از صدور صورتحساب بیشتر جلوگیری شود.\n\nاین عملیات غیرقابل بازگشت است. برای دریافت شماره جدید، به 📞☁️ Cloud Phone → ${buyLabel} مراجعه کنید.`,
phoneSuspendedTitle: '⚠️ <b>شماره منقضی شد — به طور دائمی حذف شد</b>',
phoneSuspendedBody: (phoneNumber, buyLabel) =>
  `📞 ${phoneNumber} منقضی شده و به صورت <b>دائمی حذف شده</b> است.\n\nتمدید خودکار غیرفعال بود. برای جلوگیری از از دست دادن شماره‌ها در آینده، تمدید خودکار را روی شماره بعدی خود فعال کنید.\n\nدریافت شماره جدید: 📞☁️ Cloud Phone → ${buyLabel}.`,
phoneUsageAlertTitle: '⚠️ <b>هشدار مصرف</b>',
phoneUsageAlertBody: (phoneNumber, used, limit, type, percent, rate, unit) =>
  `📞 ${phoneNumber}\n\nشما <b>${used}/${limit}</b> ${type} ورودی این ماه را مصرف کرده‌اید (${percent}%).\nپس از اتمام، صدور صورتحساب اضافه‌مصرف با نرخ <b>$${rate}/${unit}</b> از کیف پول شما فعال می‌شود. در صورت خالی بودن کیف پول، سرویس متوقف می‌شود.`,
phoneUsageLimitTitle: type => `💰 <b>${type} ورودی — اضافه‌مصرف فعال است</b>`,
phoneUsageLimitBody: (phoneNumber, type, limit, rate, unit) =>
  `📞 ${phoneNumber}\n\nشما تمام <b>${limit}</b> ${type} ورودی پلن خود را در این ماه مصرف کرده‌اید.\nصدور صورتحساب اضافه‌مصرف اکنون فعال است — <b>$${rate}/${unit}</b> به ازای هر استفاده از کیف پول شما کسر می‌شود.\nدر صورت اتمام موجودی کیف پول، سرویس متوقف می‌شود. کیف پول را شارژ کنید یا پلن خود را ارتقا دهید.`,
// === خطای عمومی (error-handler.js) ===
genericErrorTitle: '❌ <b>خطا</b>',
genericErrorBody: txnId =>
  `مشکلی پیش آمد${txnId ? ` (تراکنش: ${txnId})` : ''}.\n\nتیم ما مطلع شده و بررسی خواهد کرد.`,
genericErrorRefundedNote: '✅ پرداخت شما بازگردانده شده است.',
genericErrorContactSupport: 'لطفاً در صورت ادامه مشکل با پشتیبانی تماس بگیرید.',
// === کمپین تماس گروهی ===
bulkCallProgressLine: (icon, displayNumber, displayName, statusText, durText, bar, completed, total, pct, kp, missed, failed) =>
  `${icon} <b>${displayNumber}</b>${displayName} — ${statusText}${durText}\n${bar} ${completed}/${total} (${pct}%) | 🔘${kp} 📵${missed} ❌${failed}`,
bulkCallReportTitle: '📊 <b>کمپین کامل شد!</b>',
bulkCallReportCallerId: 'شناسه تماس‌گیرنده:',
bulkCallReportAudio: 'صدا:',
bulkCallReportProvider: 'ارائه‌دهنده:',
bulkCallReportDuration: 'مدت زمان:',
bulkCallReportTotal: 'کل تماس‌ها:',
bulkCallReportAnswered: 'پاسخ داده شده:',
bulkCallReportKeyPressed: 'کلید فشرده شده:',
bulkCallReportTransferred: 'انتقال داده شده:',
bulkCallReportNoAnswer: 'بی‌پاسخ:',
bulkCallReportHungUp: 'قطع شده:',
bulkCallReportVoicemail: 'پیغام‌گیر:',
bulkCallReportBusy: 'مشغول:',
bulkCallReportFailed: 'ناموفق:',
bulkCallReportTitleCancelled: '📊 <b>کمپین لغو شد</b>',
bulkCallReportNotDialed: 'شماره‌گیری نشده (کمپین لغو شد):',
// === سرویس پیام‌رسان SMS ===
smsAppTrialCompleteTitle: '📱 <b>آزمایش رایگان BulkSMS کامل شد!</b>',
smsAppTrialCompleteBody: limit =>
  `شما تمام ${limit} پیامک رایگان دوره آزمایشی را مصرف کردید. عالی بود که پلتفرم را آزمایش کردید!`,
smsAppTrialExpiredTitle: '📱 <b>دوره آزمایشی BulkSMS منقضی شد</b>',
smsAppTrialExpiredBody: 'برای ادامه ارسال کمپین‌های SMS اشتراک تهیه کنید.\n👉 روی <b>👛 کیف پول → 📋 مشاهده اشتراک‌ها</b> ضربه بزنید تا ارتقا دهید!',
// === هشدارهای ضد قرمز cPanel-routes ===
antiRedWarningTitle: '⚠️ <b>هشدار حفاظت Anti-Red</b>',
antiRedWarningBodyShort: domain =>
  `حفاظت برای <b>${domain}</b> اعمال شد اما هنوز تأیید نشده است. مطمئن شوید نیم‌سرورها به Cloudflare اشاره می‌کنند.`,
antiRedFailedTitle: '🚨 <b>حفاظت Anti-Red ناموفق بود</b>',
antiRedFailedBodyShort: (domain, retries) =>
  `حفاظت پس از ${retries} تلاش نتوانست برای <b>${domain}</b> اعمال شود. مطمئن شوید نیم‌سرورها به Cloudflare اشاره می‌کنند.`,

host_4: (safeHtml) => `${safeHtml}`,
 host_5: (CHAT_BOT_NAME) => `<b>راهنمای ${CHAT_BOT_NAME}</b>\n\n<b>دستورات سریع:</b>\n• <code>/start</code> — منوی اصلی\n• <code>/shorten URL</code> — لینک کوتاه فوری\n• <code>/shorten URL alias</code> — نام مستعار سفارشی\n• فقط هر URL را جای‌گذاری کنید — کوتاه‌سازی خودکار\n\n<b>کارهایی که می‌توانید انجام دهید:</b>\n📞 Cloud IVR + SIP — شماره‌های مجازی و منشی خودکار\n🌐 Bulletproof Domains — ثبت و مدیریت دامنه\n🛡️ Anti-Red Hosting — هاستینگ وب آفشور\n🖥️ VPS / RDP — سرورهای ابری Linux و Windows\n🔗 URL Shortener — لینک‌های کوتاه برند‌شده\n📱 BulkSMS — ارسال پیامک انبوه\n🎯 SMS Leads — سرنخ‌های تلفنی تأییدشده\n💳 Virtual Card — کارت‌های دبیت مجازی\n🏪 Marketplace — خرید و فروش با امانت‌داری\n👛 کیف پول — شارژ با رمزارز یا کارت\n\n💬 نیاز به انسان دارید؟ روی <b>💬 پشتیبانی</b> ضربه بزنید.\n\nبرای شروع از منوی زیر استفاده کنید!`,
 host_6: '✂️ <b>دستور کوتاه‌سازی سریع</b>\\n\\n<b>نحوه استفاده:</b>\\n<code>/shorten https://example.com</code> — لینک کوتاه تصادفی\\n<code>/shorten https://example.com myalias</code> — نام مستعار سفارشی\\n\\nیا فقط هر URL را جای‌گذاری کنید تا پیشنهاد کوتاه‌سازی بدهم!',
 host_7: '❌ URL نامعتبر است. لطفاً یک URL معتبر که با http:// یا https:// شروع می‌شود وارد کنید.',
 host_8: (customAlias, preferredDomain) => `❌ نام مستعار <code>${customAlias}</code> در ${preferredDomain} قبلاً گرفته شده است. نام مستعار دیگری امتحان کنید.`,
 host_9: (customAlias) => `❌ نام مستعار <code>${customAlias}</code> قبلاً گرفته شده است. نام مستعار دیگری امتحان کنید.`,

 // === SMS Campaign ===
sms_1: (toFixed, v1) => `⚠️ <b>موجودی ناکافی</b>\n\n💰 نیاز: <b>$${toFixed}</b>\n👛 موجودی: <b>$${v1}</b>\n\nلطفاً حساب خود را شارژ کنید یا روش پرداخت دیگری انتخاب کنید.`,
 sms_10: 'مجاز نیست',
 sms_11: 'پشتیبان‌گیری با موفقیت انجام شد.',
 sms_12: 'مجاز نیست',
 sms_13: 'داده‌ها با موفقیت بازیابی شدند.',
 sms_14: 'مجاز نیست',
 sms_15: (length, join) => `کاربران: ${length}\n${join}`,
 sms_16: 'مجاز نیست',
 sms_17: (join) => `داده‌های آماری:\n${join}`,
 sms_18: 'مجاز نیست',
 sms_19: (totalDead, chatNotFound, userDeactivated, botBlocked, other) => `📊 <b>گزارش کاربران غیرفعال</b>\n\nمجموع علامت‌گذاری‌شده: <b>${totalDead}</b>\n• chat_not_found: ${chatNotFound}\n• user_deactivated: ${userDeactivated}\n• bot_blocked: ${botBlocked}\n• other: ${other}\n\n<b>عملیات:</b>\n/resetdead all — پاک‌کردن همه\n/resetdead blocked — پاک‌کردن bot_blocked\n/resetdead notfound — پاک‌کردن chat_not_found`,
 sms_20: 'مجاز نیست',
 sms_21: (WELCOME_BONUS_USD) => `🎁 در حال ارسال هدیه $${WELCOME_BONUS_USD} به تمام کاربرانی که هنوز دریافت نکرده‌اند...\nاین ممکن است کمی طول بکشد.`,
 sms_22: (gifted, skipped, failed, total) => `✅ <b>هدیه‌دهی کامل شد!</b>\n\n🎁 هدیه‌داده‌شده: ${gifted}\n⏭ رد‌شده (قبلاً دریافت کرده): ${skipped}\n❌ ناموفق: ${failed}\n📊 مجموع کاربران: ${total}`,
 sms_23: (message) => `❌ هدیه‌دهی ناموفق بود: ${message}`,
 sms_24: '✅ هیچ نشست فعالی یافت نشد — می‌توانید آزادانه وارد شوید.',
 sms_25: '✅ <b>تمام دستگاه‌ها خارج شدند!</b>\\n\\nاکنون می‌توانید با دستگاه جدیدی وارد شوید.',
 sms_26: (buyPlan) => `❌ <b>اشتراک لازم است</b>\n\nبرای ایجاد کمپین پیامکی به اشتراک فعال نیاز دارید.\n\nروی <b>${buyPlan}</b> در منوی اصلی ضربه بزنید تا مشترک شوید — پلان‌ها شامل کوتاه‌کننده URL نامحدود، BulkSMS، اعتبارسنجی شماره تلفن و دامنه‌های رایگان هستند!`,
 sms_27: (SMS_APP_LINK, chatId) => `📵 <b>دستگاه فعالی وجود ندارد</b>\n\nقبل از ایجاد کمپین باید اپلیکیشن ${(process.env.CHAT_BOT_BRAND || 'Nomadly')} SMS را روی یک دستگاه فعال کنید.\n\n1️⃣ دانلود اپ: ${SMS_APP_LINK}\n2️⃣ کد فعال‌سازی را وارد کنید: <code>${chatId}</code>\n3️⃣ برگردید و کمپین ایجاد کنید`,
 sms_28: (length) => `📱 <b>انتخاب دستگاه</b>\n\nشما ${length} دستگاه فعال دارید. انتخاب کنید کدام دستگاه این کمپین را ارسال کند:`,
 sms_29: '❌ لطفاً یک دستگاه را از دکمه‌های زیر انتخاب کنید.',
 sms_3: (minAmount, maxAmount) => `لطفاً یک عدد معتبر بین ${minAmount} و ${maxAmount} سرنخ وارد کنید.`,
 sms_30: '❌ بارگذاری کمپین‌ها ناموفق بود. لطفاً دوباره امتحان کنید.',
 sms_31: '❌ نام کمپین نمی‌تواند خالی باشد. لطفاً یک نام وارد کنید:',
 sms_32: '✍️ <b>محتوای کمپین</b>\\n\\nپیام SMS خود را تایپ کنید. از <code>[name]</code> برای شخصی‌سازی با نام مخاطب استفاده کنید.\\n\\nشکست خط در پیام شما به صورت فاصله حفظ می‌شود.\\n\\nبرای <b>چرخش پیام</b> (پیام متفاوت برای هر مخاطب)، پیام‌ها را با <code>---</code> در یک خط جداگانه از هم جدا کنید:\\n<code>سلام [name]، پیشنهاد ما را ببینید!\\n---\\nهی [name]، این فرصت را از دست نده!</code>',
 sms_33: '📱 <b>ایجاد کمپین پیامکی</b>\\n\\nیک نام برای کمپین خود وارد کنید:',
 sms_34: '❌ محتوای پیام نمی‌تواند خالی باشد. لطفاً پیام SMS خود را تایپ کنید:',
 sms_35: '❌ لطفاً حداقل یک خط پیام غیرخالی وارد کنید.',
 sms_36: '❌ هیچ شماره تلفن معتبری در فایل یافت نشد.\\n\\nلطفاً فایلی با شماره تلفن‌ها آپلود کنید (یکی در هر خط، با + و کد کشور شروع شود).',
 sms_37: (length, length1, smsGapTimePrompt) => `👥 <b>${length} مخاطب${length1} از فایل بارگذاری شد!</b>\n\n${smsGapTimePrompt}`,
 sms_38: '❌ پردازش فایل ناموفق بود. لطفاً دوباره امتحان کنید یا مخاطبین را به صورت متن ارسال کنید.',
 sms_39: '✍️ <b>محتوای کمپین</b>\\n\\nپیام SMS خود را تایپ کنید. از <code>[name]</code> برای شخصی‌سازی استفاده کنید.\\nبرای چرخش، پیام‌ها را با <code>---</code> در یک خط جداگانه از هم جدا کنید.',
 sms_4: (domain, plan) => `❌ امکان فعال‌سازی کوتاه‌کننده URL وجود ندارد — <b>${domain}</b> دارای پلان هاستینگ فعال (<b>${plan}</b>) است.\n\nCNAME کوتاه‌کننده رکوردهای A هاستینگ شما را جایگزین کرده و وب‌سایت را آفلاین می‌کند.\n\nلطفاً از دامنه دیگری استفاده کنید یا ابتدا پلان هاستینگ خود را غیرفعال کنید.`,
 sms_40: '❌ لطفاً مخاطبین را به صورت متن ارسال کنید یا یک فایل آپلود کنید.',
 sms_41: '❌ هیچ شماره تلفن معتبری یافت نشد.\\n\\nشماره تلفن‌ها باید حداقل ۷ رقم داشته باشند (ترجیحاً با کد کشور و + شروع شوند).\\n\\nمثال‌ها:\\n<code>+18189279992, John\\n+14155551234</code>',
 sms_42: (length, length1, warningLine, smsGapTimePrompt) => `👥 <b>${length} مخاطب${length1} بارگذاری شد!</b>${warningLine}\n\n${smsGapTimePrompt}`,
 sms_43: '📋 <b>آپلود مخاطبین</b>\\n\\nمخاطبین را به صورت متن ارسال کنید یا یک فایل .txt/.csv آپلود کنید:',
 sms_44: '❌ لطفاً یک عدد بین ۱ تا ۳۰۰ ثانیه وارد کنید یا دکمه پیش‌فرض را بزنید.',
 sms_45: (buyPlan) => `❌ <b>آزمایش رایگان تمام شد</b>\n\nتمام پیامک‌های رایگان شما استفاده شده است. مشترک شوید تا کمپین‌های BulkSMS نامحدود داشته باشید!\n\n👉 روی <b>${buyPlan}</b> ضربه بزنید تا مشترک شوید.`,
 sms_46: (campaignName, length, v2, deviceLine) => `💾 <b>کمپین به عنوان پیش‌نویس ذخیره شد!</b>\n\n📋 نام: ${campaignName}\n✍️ پیام‌ها: ${length}\n👥 مخاطبین: ${v2}${deviceLine}\n\nمی‌توانید بعداً از اپ SMS یا <b>📋 کمپین‌های من</b> آن را ویرایش و ارسال کنید.`,
 sms_47: (campaignName, length, v2, gapTime, deviceLine) => `✅ <b>کمپین ایجاد شد!</b>\n\n📋 نام: ${campaignName}\n✍️ پیام‌ها: ${length}\n👥 مخاطبین: ${v2}\n⏱ فاصله: ${gapTime} ثانیه${deviceLine}\n\nکمپین شما به طور خودکار همگام‌سازی شده و ارسال روی دستگاه متصل شروع می‌شود.`,
 sms_48: '❌ ایجاد کمپین ناموفق بود. لطفاً دوباره امتحان کنید.',
 sms_49: '⚠️ لطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
 sms_5: (domain, error) => `❌ امکان اتصال <b>${domain}</b> وجود ندارد: ${error}`,
 sms_50: '❌ لطفاً تاریخ و زمان را به فرمت زیر وارد کنید: <code>YYYY-MM-DD HH:MM</code>',
 sms_51: '❌ تاریخ نامعتبر است یا در گذشته می‌باشد.\\n\\nلطفاً یک تاریخ آینده به فرمت زیر وارد کنید: <code>YYYY-MM-DD HH:MM</code>\\n\\nمثال: <code>2027-07-15 09:30</code>',
 sms_52: (campaignName, length, v2, gapTime, schedDate, deviceLine) => `✅ <b>کمپین زمان‌بندی شد!</b>\n\n📋 نام: ${campaignName}\n✍️ پیام‌ها: ${length}\n👥 مخاطبین: ${v2}\n⏱ فاصله: ${gapTime} ثانیه\n📅 زمان‌بندی: ${schedDate} UTC${deviceLine}\n\nکمپین به طور خودکار همگام‌سازی شده و در زمان تعیین‌شده شروع به ارسال می‌کند. مطمئن شوید دستگاه شما آنلاین باشد.`,
 sms_53: '❌ ایجاد کمپین زمان‌بندی‌شده ناموفق بود. لطفاً دوباره امتحان کنید.',
 sms_54: (SUPPORT_USERNAME) => `📞 Cloud IVR به زودی می‌آید! برای اطلاعات بیشتر با ${SUPPORT_USERNAME} تماس بگیرید.`,
 sms_55: '🛡️🔥 هاستینگ Anti-Red در حال حاضر در دسترس نیست. لطفاً روی <b>💬 پشتیبانی</b> در کیبورد ضربه بزنید تا با ما در تماس باشید.',
 sms_56: (substring, v1) => `🔗 <b>لینک شناسایی شد!</b>\n\n<code>${substring}${v1}</code>\n\n⚠️ هیچ لینکی برای شما باقی نمانده است.\n\n👉 ارتقا دهید تا بتوانید URL کوتاه کنید!`,
 sms_57: (minEmails, length) => `❌ تعداد ایمیل‌ها خیلی کم است. حداقل <b>${minEmails}</b> مورد نیاز است، شما <b>${length}</b> وارد کرده‌اید.`,
 sms_58: (maxEmails, length) => `❌ تعداد ایمیل‌ها خیلی زیاد است. حداکثر <b>${maxEmails}</b> مجاز است، شما <b>${length}</b> وارد کرده‌اید.\n\nلطفاً لیست خود را کاهش دهید.`,
 sms_59: (length) => `⏳ در حال اعتبارسنجی ${length} ایمیل...\n\nاین ممکن است کمی طول بکشد.`,
 sms_6: (sanitizeProviderError) => `❌ خطای DNS: ${sanitizeProviderError}`,
 sms_7: (error) => `❌ خطای DNS: ${error}`,
 sms_8: (message) => `❌ خطا: ${message}`,
 sms_9: (message) => `❌ خطا: ${message}`,

 // === Wallet ===
wlt_1: '⏳ پرداخت در حال انجام است. لطفاً صبر کنید...',
 wlt_10: '⚠️ بارگذاری تاریخچه تراکنش‌ها امکان‌پذیر نیست. لطفاً بعداً دوباره امتحان کنید.',
 wlt_11: (amount) => `💵 واریز <b>$${amount}</b>\n\nروش پرداخت را انتخاب کنید:`,
 wlt_12: '⚠️ پرداخت‌های NGN موقتاً در دسترس نیستند (سرویس نرخ ارز در دسترس نیست). لطفاً از ارز دیجیتال استفاده کنید.',
 wlt_13: 'بانک ₦اira + کارت 🌐︎',
 wlt_2: (reason) => `🚫 <b>دسترسی به مارکت‌پلیس محدود شده است</b>\n\nدسترسی شما به مارکت‌پلیس تعلیق شده است.\nدلیل: <i>${reason}</i>\n\nاگر فکر می‌کنید این اشتباه است با پشتیبانی تماس بگیرید.`,
 wlt_3: (priceText, askDomainToUseWithShortener) => `${priceText}${askDomainToUseWithShortener}`,
 wlt_4: 'نوع لینک را انتخاب کنید:',
 wlt_5: '✏️ نام مستعار دلخواه خود را وارد کنید (فقط حروف، اعداد و خط تیره):',
 wlt_6: '🔗 <b>فعال‌سازی دامنه برای کوتاه‌کننده URL</b>\\n\\nیک دامنه برای اتصال به کوتاه‌کننده انتخاب کنید. DNS به‌صورت خودکار تنظیم می‌شود تا بتوانید لینک‌های کوتاه سفارشی بسازید (مثلاً <code>yourdomain.com/abc</code>).',
 wlt_7: (label) => `آیا ${label} حذف شود؟`,
 wlt_8: '⏳ در حال بارگذاری تراکنش‌ها...',
 wlt_9: '📜 <b>تاریخچه تراکنش‌ها</b>\\n\\nهنوز هیچ تراکنشی یافت نشد. برای مشاهده فعالیت‌ها واریز انجام دهید یا خریدی داشته باشید.',

 // === Domains ===
 dom_1: 'شما هیچ دامنه ثبت‌شده‌ای ندارید. لطفاً یک دامنه جدید ثبت کنید یا یک دامنه خارجی متصل کنید.',
 dom_2: '📋 <b>پلن‌های هاستینگ من</b>\\n\\nشما هیچ پلن هاستینگ فعالی ندارید. برای شروع یک پلن خریداری کنید!',
 dom_3: (savings, domain, chargeUsd, shownPrice, v4) => `🎉 <b>شما $${savings} صرفه‌جویی کردید!</b> دامنه <b>${domain}</b> به قیمت <b>$${v4}</b> به جای $${shownPrice} ثبت شد. فقط $${chargeUsd} از کیف پول شما کسر شد.`,
 dom_4: (domain, v1) => `💡 <b>با ${v1} چه کاری می‌توان کرد؟</b>\n\n🔗 <b>فعال‌سازی برای کوتاه‌کننده URL</b> — از ${domain} به عنوان لینک کوتاه سفارشی استفاده کنید\n🛡️🔥 <b>هاستینگ ضد مسدودسازی</b> — یک وب‌سایت روی ${domain} با محافظت در برابر تعلیق راه‌اندازی کنید\n🌐 <b>مدیریت DNS</b> — آن را به سرور خود اشاره دهید\n\nیکی از گزینه‌های زیر را برای ادامه انتخاب کنید.`,
 dom_5: (domain, domainCost, APP_SUPPORT_LINK) => `دامنه <b>${domain}</b> شما با موفقیت ثبت شد، اما راه‌اندازی هاستینگ ناموفق بود. هزینه دامنه ($${domainCost}) کسر شده است. لطفاً برای تکمیل راه‌اندازی هاستینگ با پشتیبانی تماس بگیرید: ${APP_SUPPORT_LINK}`,
 dom_6: (showWallet) => `❌ راه‌اندازی مقرراتی ناموفق بود.\n\n💰 کیف پول شما بازپرداخت شده است.\n${showWallet}`,
 dom_7: (requested, delivered, requesteddelivered, toFixed, reasonText, v5) => `💰 <b>بازپرداخت جزئی</b>\n\n📊 سفارش داده شده: ${requested} سرنخ\n✅ تحویل داده شده: ${delivered} سرنخ\n❌ تحویل نشده: ${requesteddelivered} سرنخ\n\n💵 بازپرداخت: <b>$${toFixed}</b> به کیف پول شما برگشت داده شد\n📝 دلیل: ${reasonText}\n\n💰 کیف پول: $${v5} USD`,
 dom_8: '💡 <b>سرنخ‌های خود را به حداکثر برسانید</b>\\n\\n📞 <b>دریافت Cloud IVR</b> — با این سرنخ‌ها با یک شماره محلی تماس بگیرید\\n🎯 <b>خرید سرنخ‌های بیشتر</b> — منطقه یا اپراتور دیگری را هدف قرار دهید\\n🔗 <b>کوتاه کردن لینک‌ها</b> — کمپین‌های ارتباطی خود را ردیابی کنید\\n\\nیک گزینه را در زیر انتخاب کنید.',
 dom_9: (totalPrice, toFixed) => `❌ موجودی کیف پول کافی نیست. $${totalPrice} نیاز است، $${toFixed} موجود است.\nبرای ادامه کیف پول خود را شارژ کنید و دوباره امتحان کنید.`,

 // پیشنهادهای پس از خرید (هاستینگ و VPS)
 host_5d: (domain) => `💡 <b>هاستینگ شما برای ${domain} فعال است!</b>\n\n🌐 <b>خرید دامنه‌های بیشتر</b> — سایت‌های اضافی میزبانی کنید\n📞 <b>Cloud IVR + SIP</b> — به بازدیدکنندگان اجازه دهید با یک شماره مجازی با شما تماس بگیرند\n✂️🌐 <b>کوتاه‌کننده دامنه سفارشی</b> — ترافیک ورودی را با لینک‌های کوتاه سفارشی ردیابی کنید\n\nیک گزینه را در زیر انتخاب کنید.`,
 vps_5d: (isRDP = false) => isRDP
  ? '💡 <b>RDP شما آماده است!</b>\n\n📧 <b>BulkSMS</b> — دروازه SMS را روی RDP جدید خود اجرا کنید\n📞 <b>Cloud IVR + SIP</b> — با یک شماره مجازی برای تماس‌های ورودی جفت کنید\n🌐 <b>دامنه‌های ضدمسدودسازی</b> — یک دامنه را به RDP خود اشاره دهید\n\nیک گزینه را در زیر انتخاب کنید.'
  : '💡 <b>VPS شما آماده است!</b>\n\n📧 <b>BulkSMS</b> — دروازه SMS را روی VPS جدید خود میزبانی کنید\n📞 <b>Cloud IVR + SIP</b> — با یک شماره مجازی برای تماس‌های ورودی جفت کنید\n🌐 <b>دامنه‌های ضدمسدودسازی</b> — یک دامنه را به VPS خود اشاره دهید\n\nیک گزینه را در زیر انتخاب کنید.',

 // === Leads ===
 ld_1: (toFixed) => `💵 $${toFixed} — `,
 ld_2: '🎯 نهاد هدف خود را انتخاب کنید.\\nسرنخ‌های واقعی و تأیید شده با نام صاحب تلفن — مطابقت یافته با اپراتور از مناطق شهری پرارزش:',
 ld_3: '📝 <b>درخواست سرنخ سفارشی</b>\\n\\nنهاد یا شرکتی که می‌خواهید سرنخ‌های هدفمند برای آن داشته باشید را به ما بگویید.\\nما اعداد واقعی و تأیید شده با نام صاحب تلفن را از هر منطقه شهری که نیاز دارید تأمین می‌کنیم:',

 // === DNS ===
 dns_1: (domain) => `🔗 در حال غیرفعال‌سازی کوتاه‌کننده برای <b>${domain}</b>…`,
 dns_2: (domain) => `✅ کوتاه‌کننده برای <b>${domain}</b> غیرفعال شد.`,
 dns_3: '❌ غیرفعال‌سازی کوتاه‌کننده امکان‌پذیر نبود. لطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.',
 dns_3_busy: '⏳ سرویس کوتاه‌کننده ما به طور موقت مشغول است. لینک شما فعلاً هنوز فعال است — به‌صورت خودکار دوباره تلاش می‌کنیم و پس از تکمیل غیرفعال‌سازی به شما اطلاع می‌دهیم. همچنین می‌توانید یک دقیقه دیگر دوباره امتحان کنید.',
 dns_4: '🔄 در حال حذف رکورد متضاد و افزودن رکورد جدید...',
 dns_5: 'فرمت نامعتبر. از <b>_service._protocol</b> استفاده کنید (مثلاً _sip._tcp، _http._tcp):',
 dns_6: '⚠️ لطفاً یک مقدار معتبر USD وارد کنید (حداقل $10).',

 // === Webhooks ===
 wh_1: (toFixed) => `💰 مازاد ₦ به کیف پول واریز شد: <b>$${toFixed}</b>`,
 wh_10: (length) => `📄 <b>فایل ۱ — اعداد + نام واقعی شخص (${length} مورد تطابق)</b>`,
 wh_11: (length) => `📄 <b>فایل ۲ — تمام شماره‌های تلفن (${length} مورد کل)</b>`,
 wh_12: (toFixed, toLowerCase) => `✅ پرداخت دریافت شد! کیف پول شما $${toFixed} شارژ شد. از کیف پول برای تکمیل خرید ${toLowerCase} خود استفاده کنید.`,
 wh_13: (toFixed, usdBal) => `❌ راه‌اندازی VPS ناموفق بود.\n\n💰 <b>$${toFixed}</b> به کیف پول شما بازگردانده شد.\nموجودی کیف پول: <b>$${usdBal}</b>\n\nلطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.`,
 wh_14: (domain, price) => `💰 <b>بازپرداخت خودکار:</b> ثبت دامنه <b>${domain}</b> ناموفق بود. $${price} به موجودی کیف پول شما اضافه شد.`,
 wh_15: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>شما $${v4} صرفه‌جویی کردید!</b> دامنه <b>${domain}</b> به قیمت $${cheaperPrice} به جای $${price} هزینه داشت. مابه‌التفاوت $${savingsUsd} به موجودی کیف پول شما اضافه شد.`,
 wh_16: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `دامنه <b>${website_name}</b> شما با موفقیت ثبت شد، اما راه‌اندازی هاستینگ ناموفق بود. هزینه دامنه ($${domainPrice}) کسر شد — بخش هاستینگ ($${toFixed}) به کیف پول شما بازگردانده شد. لطفاً برای تکمیل راه‌اندازی هاستینگ با پشتیبانی تماس بگیرید: ${APP_SUPPORT_LINK}`,
 wh_17: '✅ پرداخت ارز دیجیتال دریافت شد!',
 wh_18: (countryName) => `✅ پرداخت ارز دیجیتال دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به تأیید آدرس دارد.\n\nلطفاً آدرس کامل خود را وارد کنید:\n<code>خیابان، شهر، کد پستی، کشور</code>\n\n<i>مثال: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nپس از ارسال، فرآیند تأیید مخابراتی را انجام می‌دهیم و شماره شما را به‌صورت خودکار فعال می‌کنیم.`,
 wh_19: (countryName, text) => `✅ پرداخت ارز دیجیتال دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به آدرس صورت‌حساب دارد.\nآدرس ${text}.\n\nلطفاً آدرس خود را وارد کنید:\n<code>خیابان، شهر، کشور</code>\n\nمثال: <i>123 Main St, Sydney, Australia</i>`,
 wh_2: (domain, price) => `💰 <b>بازپرداخت خودکار:</b> ثبت دامنه <b>${domain}</b> ناموفق بود. $${price} به موجودی کیف پول شما اضافه شد.`,
 wh_20: (toFixed) => `💰 مازاد ارز دیجیتال به کیف پول واریز شد: <b>$${toFixed}</b>`,
 wh_21: (delivered, requested, toFixed) => `💰 <b>بازپرداخت جزئی</b>\n📊 ${delivered}/${requested} سرنخ تحویل داده شد\n💵 بازپرداخت: <b>$${toFixed}</b> → کیف پول`,
wh_22: (toFixed, toLowerCase) => `✅ پرداخت دریافت شد! کیف پول شما به مقدار $${toFixed} شارژ شد. برای تکمیل خرید ${toLowerCase} خود از کیف پول استفاده کنید.`,
 wh_23: (toFixed, usdBal) => `❌ راه‌اندازی VPS با شکست مواجه شد.\n\n💰 <b>$${toFixed}</b> به کیف پول شما بازگردانده شد.\nموجودی کیف پول: <b>$${usdBal}</b>\n\nلطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.`,
 wh_3: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>شما $${v4} صرفه‌جویی کردید!</b> دامنه <b>${domain}</b> به جای $${price}، با قیمت $${cheaperPrice} ثبت شد. مابه‌التفاوت $${savingsUsd} به موجودی کیف پول شما اضافه شد.`,
 wh_4: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `دامنه <b>${website_name}</b> شما با موفقیت ثبت شد، اما راه‌اندازی هاستینگ با شکست مواجه شد. هزینه دامنه ($${domainPrice}) کسر شد — بخش هاستینگ ($${toFixed}) به کیف پول شما بازگردانده شد. لطفاً برای تکمیل راه‌اندازی هاستینگ با پشتیبانی تماس بگیرید: ${APP_SUPPORT_LINK}`,
 wh_5: '✅ پرداخت رمزارز دریافت شد!',
 wh_6: (countryName) => `✅ پرداخت رمزارز دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به تأیید آدرس دارد.\n\nلطفاً آدرس کامل خود را وارد کنید:\n<code>خیابان، شهر، کد پستی، کشور</code>\n\n<i>مثال: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nپس از ارسال، ما فرآیند تأیید مخابراتی را انجام داده و شماره شما را به‌صورت خودکار فعال می‌کنیم.`,
 wh_7: (countryName, text) => `✅ پرداخت رمزارز دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به آدرس صورت‌حساب دارد.\nآدرس ${text}.\n\nلطفاً آدرس خود را وارد کنید:\n<code>خیابان، شهر، کشور</code>\n\nمثال: <i>123 Main St, Sydney, Australia</i>`,
 wh_8: (toFixed) => `💰 مازاد رمزارز به کیف پول اضافه شد: <b>$${toFixed}</b>`,
 wh_9: (requested, delivered, toFixed, v3) => `💰 <b>بازپرداخت جزئی</b>\n\n📊 سفارش داده شده: ${requested} لید\n✅ تحویل داده شده: ${delivered}\n💵 بازپرداخت: <b>$${toFixed}</b> به کیف پول شما اضافه شد\n💰 کیف پول: $${v3} USD`,

 // === Utility ===
 util_1: (displayName, expiryDate) => `⚠️ <b>VPS در حال انقضا — بدون تمدید خودکار</b>\n\n🖥️ <b>${displayName}</b> در تاریخ <b>${expiryDate}</b> منقضی می‌شود.\nتمدید خودکار <b>خاموش</b> است.\n\n⏰ <b>قبل از موعد مقرر به‌صورت دستی تمدید کنید</b> وگرنه سرور شما به‌طور دائم حذف خواهد شد.\n\nبروید به: VPS/RDP → مدیریت → تمدید اکنون`,
 util_10: (toLocaleString, domain, v2, v3, v4) => `🎉 <b>شما ₦${toLocaleString} صرفه‌جویی کردید!</b> دامنه <b>${domain}</b> به جای ₦${v3}، با قیمت ₦${v2} ثبت شد. مابه‌التفاوت ₦${v4} به موجودی کیف پول شما اضافه شد.`,
 util_11: (website_name, round, APP_SUPPORT_LINK) => `دامنه <b>${website_name}</b> شما با موفقیت ثبت شد، اما راه‌اندازی هاستینگ با شکست مواجه شد. هزینه دامنه کسر شد — بخش هاستینگ (₦${round}) به کیف پول شما بازگردانده شد. لطفاً برای تکمیل راه‌اندازی هاستینگ با پشتیبانی تماس بگیرید: ${APP_SUPPORT_LINK}`,
 util_12: '✅ پرداخت دریافت شد!',
 util_13: (countryName) => `✅ پرداخت بانکی دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به تأیید آدرس دارد.\n\nلطفاً آدرس کامل خود را وارد کنید:\n<code>خیابان، شهر، کد پستی، کشور</code>\n\n<i>مثال: 42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\nپس از ارسال، ما فرآیند تأیید مخابراتی را انجام داده و شماره شما را به‌صورت خودکار فعال می‌کنیم.`,
 util_14: (countryName, text) => `✅ پرداخت بانکی دریافت شد!\n\n📍 <b>${countryName}</b> برای فعال‌سازی شماره نیاز به آدرس صورت‌حساب دارد.\nآدرس ${text}.\n\nلطفاً آدرس خود را وارد کنید:\n<code>خیابان، شهر، کشور</code>\n\nمثال: <i>123 Main St, Sydney, Australia</i>`,
 util_15: (delivered, requested, toFixed) => `💰 <b>بازپرداخت جزئی</b>\n📊 ${delivered}/${requested} لید تحویل داده شد\n💵 بازپرداخت: <b>$${toFixed}</b> → کیف پول`,
 util_16: (targetName, length) => `📄 <b>فایل ۱ — شماره‌های ${targetName} + نام واقعی شخص (${length} مورد منطبق)</b>`,
 util_17: (targetName, length) => `📄 <b>فایل ۲ — تمام شماره‌های تلفن ${targetName} (${length} مورد در کل)</b>`,
 util_18: (ngnIn, toLowerCase) => `✅ پرداخت دریافت شد! کیف پول شما به مقدار ₦${ngnIn} شارژ شد. برای تکمیل خرید ${toLowerCase} خود از کیف پول استفاده کنید.`,
 util_2: (displayName, chargedDisplay, toUpperCase, toLocaleDateString, toFixed, v5) => `✅ <b>VPS به‌صورت خودکار تمدید شد</b>\n\n🖥️ <b>${displayName}</b> برای ۱ ماه تمدید شد.\n💰 ${chargedDisplay} از کیف پول ${toUpperCase} کسر شد.\n📅 تاریخ انقضای جدید: <b>${toLocaleDateString}</b>\n\n💳 موجودی: $${toFixed} / ₦${v5}`,
 util_3: (displayName, toFixed, planPrice, expiryDate) => `🚨 <b>فوری — تمدید VPS با شکست مواجه شد</b>\n\n🖥️ <b>${displayName}</b> نتوانست به‌صورت خودکار تمدید شود.\n💰 موجودی: $${toFixed}\n💵 مورد نیاز: <b>$${planPrice}/ماه</b>\n\n⚠️ <b>سرور شما در تاریخ ${expiryDate} به‌طور دائم حذف خواهد شد</b> مگر اینکه به‌صورت دستی تمدید کنید.\n\nبروید به: VPS/RDP → مدیریت → 📅 تمدید اکنون`,
 util_4: (displayName) => `❌ <b>VPS لغو شد — پرداخت دریافت نشد</b>\n\n🖥️ <b>${displayName}</b> لغو شده است.\n💰 تمدید خودکار با شکست مواجه شد و هیچ پرداخت دستی دریافت نشد.\n\n💡 می‌توانید در هر زمان از منوی اصلی VPS جدیدی خریداری کنید.`,
 util_5: (displayName) => `❌ <b>VPS حذف شد</b>\n\n🖥️ <b>${displayName}</b> به‌طور دائم حذف شده است.\n\n💡 دلیل: تمدید خودکار با شکست مواجه شد و قبل از موعد مقرر هیچ تمدید دستی دریافت نشد.\n\nمی‌توانید در هر زمان از منوی اصلی VPS جدیدی خریداری کنید.`,
 util_6: (displayName, chargedDisplay, toLocaleDateString, toFixed, v4) => `✅ <b>VPS به‌صورت خودکار تمدید شد</b>\n\n🖥️ <b>${displayName}</b> برای ۱ ماه تمدید شد.\n💰 ${chargedDisplay} کسر شد.\n📅 تاریخ انقضای جدید: <b>${toLocaleDateString}</b>\n\n💳 موجودی: $${toFixed} / ₦${v4}`,
 util_7: (displayName, toFixed) => `🚨 <b>فوری — VPS منقضی شد</b>\n\n🖥️ <b>${displayName}</b> منقضی شده است.\n💰 موجودی: $${toFixed}\n\n⚠️ <b>سرور به زودی حذف خواهد شد.</b>\nهم‌اکنون تمدید کنید: VPS/RDP → مدیریت → 📅 تمدید اکنون`,
 util_8: (displayName, expiryDate, planPrice, toFixed, statusIcon, v5) => `🖥️ <b>VPS در ۳ روز دیگر منقضی می‌شود</b>\n\n<b>${displayName}</b> در تاریخ <b>${expiryDate}</b> منقضی می‌شود.\n💵 مورد نیاز: <b>$${planPrice}/ماه</b>\n💳 موجودی: $${toFixed}\n${statusIcon} ${v5}`,
 util_9: (domain, ngnPrice) => `💰 <b>بازپرداخت خودکار:</b> ثبت دامنه <b>${domain}</b> با شکست مواجه شد. پرداخت شما به مقدار ${ngnPrice} NGN به موجودی کیف پول شما اضافه شد.`,

 // === چرخه عمر دوره رایگان ۲ روزه Windows RDP ===
 rdpGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> <b>منقضی</b> شده و <b>خاموش</b> شده است.\n\n🗑 در صورت عدم تمدید، <b>به‌طور دائم در تاریخ ${deleteDate}</b> (دوره رعایت ۲ روزه) حذف خواهد شد — تمام داده‌ها از بین خواهند رفت.\n\n♻️ هم‌اکنون تمدید کنید: 🖥️ VPS/RDP → مدیریت → تمدید`,
 rdpGraceReminder: (displayName, deleteDate) => `⏳ <b>یادآوری نهایی</b>\n\n🖥 <b>${displayName}</b> در صورت عدم تمدید، <b>به‌طور دائم در تاریخ ${deleteDate}</b> حذف خواهد شد.\n\nپس از آن، سرور و تمام داده‌های آن برای همیشه از بین خواهند رفت.\n\n♻️ هم‌اکنون تمدید کنید: 🖥️ VPS/RDP → مدیریت → تمدید`,
 rdpDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> پس از پایان دوره رعایت ۲ روزه بدون تمدید، <b>به‌طور دائم حذف شد</b>.\n\nتمام داده‌های روی سرور از بین رفته‌اند. می‌توانید در هر زمان از منو یک Windows RDP جدید سفارش دهید.`,

 // === چرخه عمر دوره رایگان ۲ روزه DigitalOcean VPS ===
 vpsGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> <b>منقضی</b> شده و <b>خاموش</b> شده است.\n\n🗑 در صورت عدم تمدید، <b>به‌طور دائم در تاریخ ${deleteDate}</b> (دوره رعایت ۲ روزه) حذف خواهد شد — تمام داده‌ها از بین خواهند رفت.\n\n♻️ هم‌اکنون تمدید کنید: 🖥️ VPS/RDP → مدیریت → تمدید`,
 vpsGraceReminder: (displayName, deleteDate) => `⏳ <b>یادآوری نهایی</b>\n\n🖥 <b>${displayName}</b> در صورت عدم تمدید، <b>به‌طور دائم در تاریخ ${deleteDate}</b> حذف خواهد شد.\n\nپس از آن، سرور و تمام داده‌های آن برای همیشه از بین خواهند رفت.\n\n♻️ هم‌اکنون تمدید کنید: 🖥️ VPS/RDP → مدیریت → تمدید`,
 vpsDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> پس از پایان دوره رعایت ۲ روزه بدون تمدید، <b>به‌طور دائم حذف شد</b>.\n\nتمام داده‌های روی سرور از بین رفته‌اند. می‌توانید در هر زمان از منو یک VPS جدید سفارش دهید.`,

 // === Admin ===
 adm_1: '📸 حداکثر ۵ تصویر. برای ادامه روی ✅ بارگذاری انجام شد ضربه بزنید.',
 adm_10: (orderId, buyerName, chatId, product) => `✅ سفارش <code>${orderId}</code> به ${buyerName} (${chatId}) تحویل داده شد.\nمحصول: ${product}`,
 adm_11: (message) => `❌ خطا در تحویل سفارش: ${message}`,
 adm_12: (TG_CHANNEL) => `👆 <b>پیش‌نمایش آگهی</b>\n\n<b>/ad post</b> را تایپ کنید تا این را به ${TG_CHANNEL} ارسال کنید`,
 adm_13: (totalDead, chatNotFound, userDeactivated, botBlocked, other) => `📊 <b>گزارش کاربران غیرفعال</b>\n\nمجموع علامت‌گذاری شده به عنوان غیرفعال: <b>${totalDead}</b>\n• chat_not_found: ${chatNotFound}\n• user_deactivated: ${userDeactivated}\n• bot_blocked: ${botBlocked}\n• سایر: ${other}\n\nدستورات:\n<code>/resetdead all</code> — پاک کردن تمام ورودی‌های غیرفعال\n<code>/resetdead blocked</code> — پاک کردن فقط bot_blocked\n<code>/resetdead notfound</code> — پاک کردن فقط chat_not_found`,
 adm_14: '❌ نحوه استفاده: /resetdead all | blocked | notfound',
 adm_15: (modifiedCount, sub) => `✅ <b>${modifiedCount}</b> ورودی کاربر غیرفعال بازنشانی شد (${sub}).`,
 adm_16: '🔄 در حال اجرای اسکن کمپین بازگشت کاربران...',
 adm_17: (sent, errors) => `✅ کمپین بازگشت کاربران کامل شد: ${sent} ارسال شد، ${errors} خطا`,
 adm_18: '✅ آگهی در کانال منتشر شد!',
 adm_19: '❌ شناسه کانال پیکربندی نشده است.',
 adm_2: (length) => `📸 تصویر ${length}/5 دریافت شد. بیشتر ارسال کنید یا روی ✅ بارگذاری انجام شد ضربه بزنید.`,
 adm_20: '📦 هیچ سفارش محصول دیجیتال در انتظاری وجود ندارد.',
 adm_21: (message) => `❌ خطا: ${message}`,
 adm_22: (message) => `خطا در دریافت درخواست‌ها: ${message}`,
 adm_23: '⚠️ نحوه استفاده: /credit <@username or chatId> <amount>\\n\\nمثال‌ها:\\n<code>/credit @john 50</code>\\n<code>/credit 5590563715 25.50</code>',
 adm_24: '⚠️ مقدار باید یک عدد مثبت باشد.',
 adm_25: (userRef) => `⚠️ کاربر <b>${userRef}</b> یافت نشد.`,
 adm_26: (toFixed, targetName, targetChatId, v3) => `✅ <b>$${toFixed} USD</b> به <b>${targetName}</b> (${targetChatId}) اعتبار داده شد\n\n💳 موجودی آن‌ها: $${v3} USD`,
adm_27: (message) => `❌ خطا در شارژ کیف پول: ${message}`,
 adm_28: (WELCOME_BONUS_USD) => `🎁 در حال ارسال هدیه شروع $${WELCOME_BONUS_USD} به تمام کاربرانی که هنوز دریافت نکرده‌اند...\nاین ممکن است کمی طول بکشد.`,
 adm_29: (gifted, skipped, failed, total) => `✅ <b>هدیه‌دهی کامل شد!</b>\n\n🎁 هدیه داده شده: ${gifted}\n⏭ رد شده (قبلاً دریافت کرده): ${skipped}\n❌ ناموفق: ${failed}\n📊 مجموع کاربران: ${total}`,
 adm_3: '⚠️ نحوه استفاده: /reply <chatId> <message>',
 adm_30: (message) => `❌ هدیه‌دهی ناموفق بود: ${message}`,
 adm_31: '⚠️ نحوه استفاده: /bal <@username or chatId>\\n\\nمثال‌ها:\\n<code>/bal @john</code>\\n<code>/bal 7193881404</code>',
 adm_32: (userRef) => `⚠️ کاربر <b>${userRef}</b> یافت نشد.`,
 adm_33: (message) => `❌ خطا در بررسی موجودی: ${message}`,
 adm_34: '⚠️ نحوه استفاده: /mpban <@username or chatId> [reason]\\n\\nمثال‌ها:\\n<code>/mpban @john spamming</code>\\n<code>/mpban 8317455811 policy violation</code>',
 adm_35: (userRef) => `⚠️ کاربر <b>${userRef}</b> یافت نشد.`,
 adm_36: (targetName, targetChatId, listingsRemoved, reason) => `🚫 <b>مسدودسازی در مارکت‌پلیس اعمال شد</b>\n\n👤 کاربر: <b>${targetName}</b> (${targetChatId})\n📦 آگهی‌های حذف شده: <b>${listingsRemoved}</b>\n📝 دلیل: <i>${reason}</i>\n\nکاربر دیگر نمی‌تواند به مارکت‌پلیس دسترسی داشته باشد یا در آن آگهی بگذارد.`,
 adm_37: (message) => `❌ خطا: ${message}`,
 adm_38: '⚠️ نحوه استفاده: /mpunban <@username or chatId>\\n\\nمثال‌ها:\\n<code>/mpunban @john</code>\\n<code>/mpunban 8317455811</code>',
 adm_39: (userRef) => `⚠️ کاربر <b>${userRef}</b> یافت نشد.`,
 adm_4: (targetName) => `✅ پاسخ به ${targetName} ارسال شد`,
 adm_40: (targetName, targetChatId) => `✅ <b>مسدودسازی مارکت‌پلیس برداشته شد</b>\n\n👤 کاربر: <b>${targetName}</b> (${targetChatId})\n\nکاربر اکنون می‌تواند دوباره به مارکت‌پلیس دسترسی داشته باشد.`,
 adm_41: (targetName) => `ℹ️ کاربر <b>${targetName}</b> از مارکت‌پلیس مسدود نشده بود.`,
 adm_42: (message) => `❌ خطا: ${message}`,
 adm_5: '⚠️ نحوه استفاده: /close <chatId>',
 adm_6: (targetName) => `✅ جلسه پشتیبانی برای ${targetName} بسته شد`,
 adm_7: '⚠️ نحوه استفاده: /deliver <orderId> <product details/credentials>',
 adm_8: (orderId) => `⚠️ سفارش <code>${orderId}</code> یافت نشد.`,
 adm_9: (orderId) => `⚠️ سفارش <code>${orderId}</code> قبلاً تحویل داده شده است.`,
 // === کلیدهای قالب تودرتو ===
 cp_nested_1: (count, numberList) => `📞 <b>دسته: ${count} شماره</b>\n${numberList}\n\nیک دسته‌بندی قالب IVR انتخاب کنید:`,
 cp_nested_2: (icon, firstPh, desc, hint) => `\n${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_3: (icon, firstPh, desc, hint) => `${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_4: (currentPh, value, icon, nextPh, desc, hint) => `✅ ${currentPh}: <b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_5: (target, msg) => `❌ تماس دسته‌ای با ${target} ناموفق بود: ${msg}`,
 cp_nested_6: (refundAmt, walletLine) => `💰 <b>${refundAmt}</b> به کیف پول شما بازگشت داده شد.\n${walletLine}`,
 cp_nested_7: (cleanedMsg, balMsg) => `🔄 <b>شروع تازه!</b>\n\n${cleanedMsg}${balMsg}\n\nاکنون می‌توانید خرید شماره تلفن جدیدی را از ابتدا شروع کنید.`,
 cp_nested_8: (msg) => `❌ خطای بازگشت: ${msg}`,
 cp_nested_9: (target, city, detailsLine) => `✅ <b>درخواست ثبت شد!</b>\n\n🎯 هدف: <b>${target}</b>\n🏙️ منطقه: <b>${city}</b>${detailsLine}\n\nتیم ما درخواست شما را بررسی کرده و پس از آماده شدن این سرنخ‌ها به شما اطلاع خواهد داد. ممنون!`,
 cp_nested_hint_default: (ph) => `مقدار [${ph}] را وارد کنید`,
 cp_nested_cleared: (count, refunded) => `✅ ${count} تأیید رد شده پاک شد\n💰 $${refunded} به کیف پول شما بازگشت داده شد\n`,
 // === Voice Service ===
 vs_callDisconnectedWallet: (rate, connFee) => `🚫 <b>تماس قطع شد</b> — موجودی کیف پول کافی نیست (نیاز به $\${rate}/دقیقه + $\${connFee} هزینه اتصال). از طریق 👛 کیف پول شارژ کنید.`,
 vs_callDisconnectedExhausted: '🚫 <b>تماس قطع شد</b> — موجودی کیف پول تمام شد.\nاز طریق 👛 کیف پول شارژ کنید.',
 vs_outboundCallFailed: (from, to, reason) => `🚫 <b>تماس خروجی ناموفق بود</b>\n📞 \${from} → \${to}\nدلیل: \${reason}`,
 vs_planMinutesExhausted: (phone, used, limit, overage) => `⚠️ <b>دقیقه‌های طرح تمام شد</b>\n\n📞 \${phone}\nاستفاده شده: <b>\${used}/\${limit}</b> دقیقه\n\${overage}`,
 vs_planSmsExhausted: (phone, used, limit) => `⚠️ <b>SMS طرح تمام شد</b>\n\n📞 \${phone}\nاستفاده شده: <b>\${used}/\${limit}</b> SMS طرح (دریافتی + پاسخ وب، مشترک با خطوط اضافی)`,
 vs_orphanedNumber: (to, from) => `⚠️ <b>هشدار شماره بی‌صاحب</b>\n\n📞 <code>\${to}</code> تماس ورودی از <code>\${from}</code> دریافت کرد\n\n❌ هیچ صاحبی در پایگاه داده یافت نشد — تماس رد شد.`,
 vs_incomingCallBlocked: (to, from) => `🚫 <b>تماس ورودی مسدود شد — کیف پول خالی است</b>\n\n📞 \${to}\n👤 تماس‌گیرنده: \${from}`,
 vs_overageActive: (charged, rateInfo) => `💰 <b>مازاد فعال است</b> — دقیقه‌های طرح تمام شد. \${charged} (\${rateInfo})`,
 vs_callEndedExhausted: (elapsed) => `🚫 <b>تماس پایان یافت</b> — دقیقه‌های طرح + موجودی کیف پول تمام شد.\n⏱️ ~\${elapsed} دقیقه. کیف پول را شارژ کنید یا طرح را ارتقا دهید.`,
 vs_outboundCallBlocked: (from, to, reason) => `🚫 <b>تماس خروجی مسدود شد</b>\n📞 \${from} → \${to}\nدلیل: \${reason}`,
 vs_sipCallBlocked: (rate, connFee) => `🚫 <b>تماس SIP مسدود شد</b> — موجودی کیف پول کافی نیست (نیاز به $\${rate}/دقیقه + $\${connFee} هزینه اتصال). از طریق 👛 کیف پول شارژ کنید.`,
 vs_freeSipTestCall: (from, to) => `📞 <b>تماس آزمایشی رایگان SIP</b>\nاز: \${from}\nبه: \${to}`,
 vs_sipOutboundCall: (from, to, planLine) => `📞 <b>تماس خروجی SIP</b>\nاز: \${from}\nبه: \${to}\n\${planLine}`,
 vs_lowBalance: (bal, estMin) => `⚠️ <b>موجودی کم</b> — $\${bal} (~\${estMin} دقیقه انتقال). از طریق 👛 کیف پول <b>$25</b> شارژ کنید.`,
 vs_forwardingBlocked: (bal, rate) => `🚫 <b>انتقال مسدود شد</b> — کیف پول $\${bal} (نیاز به $\${rate}/دقیقه). از طریق 👛 کیف پول شارژ کنید.`,
 vs_ivrForwardBlocked: (phone, forwardTo, bal) => `🚫 <b>انتقال IVR مسدود شد — کیف پول خالی است</b>\n\n📞 \${phone}\n📲 انتقال به: \${forwardTo}\n💰 موجودی: $\${bal}`,
 vs_lowBalanceIvr: (bal, estMin) => `⚠️ <b>موجودی کم</b> — $\${bal} (~\${estMin} دقیقه انتقال IVR). از طریق 👛 کیف پول شارژ کنید.`,
 vs_callForwarded: (to, forwardTo, from, duration, planLine, time) => `📞 <b>تماس انتقال داده شد</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 \${from}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_forwardFailed: (to, forwardTo, from, time) => `📞 <b>انتقال — پاسخی دریافت نشد</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 تماس‌گیرنده: \${from}\n📲 \${forwardTo} پاسخ نداد\n🕐 \${time}`,
 vs_sipCallFailed: (from, to, time) => `❌ <b>تماس SIP ناموفق بود — انتقال بی‌پاسخ</b>\n\n📞 از: \${from}\n📲 به: \${to}\n🕐 \${time}`,
 vs_sipCallEnded: (from, to, duration, planLine, time) => `📞 <b>تماس SIP پایان یافت</b>\n\n📞 از: \${from}\n📲 به: \${to}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_freeTestCallEnded: (from, to, duration, time) => `📞 <b>تماس آزمایشی رایگان پایان یافت</b>\n\n📞 از: \${from}\n📲 به: \${to}\n⏱️ \${duration}\n🕐 \${time}`,
 vs_missedCall: (to, from, time) => `📞 <b>تماس از دست رفته</b>\n\n📞 به: \${to}\n👤 از: \${from}\n🕐 \${time}`,
 vs_ivrCallRouted: (to, from, digit, forwardTo, time) => `📞 <b>تماس IVR مسیریابی شد</b>\n\n📞 به: \${to}\n👤 از: \${from}\nفشرده شده: <b>\${digit}</b> → انتقال به \${forwardTo}\n🕐 \${time}`,
vs_ivrCall: (to, from, digit, time) => `📞 <b>تماس IVR</b>\n\n📞 به: \${to}\n👤 از: \${from}\nفشرده شده: <b>\${digit}</b> → پیام پخش شد\n🕐 \${time}`,
 vs_newVoicemail: (to, from, duration, time) => `🎙️ <b>پیام صوتی جدید</b>\n\n📞 به: \${to}\n👤 از: \${from}\n⏱️ مدت: \${duration}\n🕐 \${time}`,
 vs_callRecording: (to, from, duration, time) => `🔴 <b>ضبط تماس</b>\n\n📞 به: \${to}\n👤 از: \${from}\n⏱️ مدت: \${duration}\n🕐 \${time}`,
 vs_listen: 'گوش دادن',
 adm_error_prefix: '❌ خطا: ',
 dom_confirm_prompt: 'تأیید می‌کنید؟',

 // یادآوری پایان زمان پرداخت و سبد خرید رهاشده
 paymentTimeoutReminder: `⏰ <b>زمان جلسه پرداخت شما به پایان رسید</b>\n\nجلسه پرداخت شما پس از ۶ ساعت عدم فعالیت منقضی شد.\n\nنگران نباشید! هر زمان که خواستید می‌توانید دوباره شروع کنید و محصول یا سرویس مورد نظر خود را انتخاب کنید.\n\n💬 نیاز به کمک دارید؟ روی <b>پشتیبانی</b> ضربه بزنید`,
 abandonedCartReminder: (productName, price) =>
   `🛒 <b>هنوز به ${productName} علاقه دارید؟</b>\n\n` +
   `۲ ساعت پیش آن را در سبد خرید رها کردید.\n\n` +
   `💳 قیمت: $${price}\n\n` +
   `همین الان خرید خود را تکمیل کنید! محصول منتظر شماست. 🎁\n\n` +
   `برای ادامه /start را بزنید یا در صورت داشتن سؤال روی 💬 <b>پشتیبانی</b> ضربه بزنید.`,

 // لغو اتصال / لغو پلن هاستینگ
 selectDomainToUnlink: mainDomain => `🗑️ <b>حذف اتصال دامنه</b>\n\nدامنه‌ای را که می‌خواهید از این پلن هاستینگ جدا کنید انتخاب کنید.\n\n⚠️ جدا کردن موارد زیر را انجام می‌دهد:\n• حذف addon domain از cPanel\n• حذف رکوردهای DNS آن در Cloudflare\n• حذف محافظت Anti-Red\n• <b>حذف دائمی</b> تمام فایل‌های موجود در <code>public_html/&lt;domain&gt;/</code>\n\nاین عمل قابل بازگشت نیست.\n\n<i>دامنه اصلی (<b>${mainDomain}</b>) را نمی‌توان اینجا جدا کرد — به جای آن از «لغو پلن هاستینگ» استفاده کنید.</i>`,
 noAddonDomainsToUnlink: '⚠️ این پلن هاستینگ هیچ addon domain برای جداسازی ندارد. فقط دامنه اصلی متصل است.\n\nاگر می‌خواهید دامنه اصلی را حذف کنید، به جای آن از «🚫 لغو پلن هاستینگ» استفاده کنید.',
 confirmUnlinkDomain: (addonDomain, mainDomain) => `⚠️ <b>تأیید جداسازی</b>\n\nشما در حال جدا کردن <b>${addonDomain}</b> از پلن هاستینگ خود (<code>${mainDomain}</code>) هستید.\n\nاین عمل موارد زیر را انجام می‌دهد:\n• حذف addon domain از cPanel\n• حذف تمام رکوردهای DNS برای <b>${addonDomain}</b>\n• حذف محافظت Anti-Red\n• <b>حذف دائمی</b> فایل‌های موجود در <code>public_html/${addonDomain.replace(/\./g, '')}/</code>\n\nاین عمل <b>قابل بازگشت نیست</b> و هیچ استردادی صورت نمی‌گیرد.\n\nادامه می‌دهید؟`,
 unlinkingDomain: addonDomain => `⏳ در حال جداسازی <b>${addonDomain}</b>...`,
 unlinkDomainSuccess: addonDomain => `✅ <b>${addonDomain}</b> از پلن هاستینگ شما جدا شد.\n\nرکوردهای DNS، ورودی addon domain و محافظت Anti-Red همگی حذف شدند.`,
 unlinkDomainFailed: addonDomain => `❌ جداسازی <b>${addonDomain}</b> با شکست مواجه شد. لطفاً دوباره امتحان کنید، یا در صورت ادامه مشکل با پشتیبانی تماس بگیرید.`,

 // افزودن دامنه جانبی به پلن هاستینگ موجود
 selectDomainToAttachHeader: mainDomain => `➕ <b>افزودن دامنه به پلن</b>\n\nدامنه‌ای را که می‌خواهید به پلن هاستینگ خود (<code>${mainDomain}</code>) متصل کنید انتخاب کنید.\n\nفقط دامنه‌هایی که نزد ما ثبت شده و هنوز روی هیچ پلن هاستینگی نیستند نمایش داده می‌شوند.\n\n<i>فایل‌های دامنه جدید در <code>public_html/&lt;domain&gt;/</code> قرار می‌گیرند — جدا از سایت اصلی شما.</i>`,
 noEligibleDomainsToAttach: '⚠️ هیچ دامنه واجد شرایطی یافت نشد.\n\nبرای اتصال یک دامنه به این پلن، دامنه باید:\n• نزد ما ثبت شده باشد، و\n• روی هیچ پلن هاستینگی نباشد.\n\nیک دامنه جدید ثبت یا خریداری کنید، سپس به اینجا برگردید تا آن را متصل کنید.',

 // تغییر دامنه اصلی یک پلن هاستینگ
 selectDomainToMakePrimary: mainDomain => `🔄 <b>تغییر دامنه اصلی</b>\n\nدامنه‌ای را انتخاب کنید که باید دامنه اصلی جدید این پلن هاستینگ شود (در حال حاضر <code>${mainDomain}</code>).\n\nفقط دامنه‌هایی که متعلق به شما هستند و دامنه اصلی پلن دیگری نیستند نمایش داده می‌شوند.\n\n<i>فایل‌های وب‌سایت شما دقیقاً همانجا که هستند باقی می‌مانند (<code>public_html/</code>). نام کاربری و PIN یکسان cPanel را حفظ می‌کنید.</i>`,
 noEligibleDomainsToMakePrimary: '⚠️ هیچ دامنه واجد شرایطی یافت نشد.\n\nبرای تغییر دامنه اصلی به دامنه دیگری نیاز دارید که:\n• نزد ما ثبت شده باشد (یکی را در 🌐 Bulletproof Domains بخرید)، و\n• دامنه اصلی پلن هاستینگ دیگری نباشد.\n\nیک دامنه بخرید یا ثبت کنید، سپس به اینجا برگردید تا آن را جایگزین کنید.',
 confirmChangePrimaryDomain: (newDomain, oldDomain) => `⚠️ <b>تأیید تغییر دامنه اصلی</b>\n\n<b>${newDomain}</b> را به دامنه اصلی این پلن هاستینگ تبدیل کنیم؟\n\nاتفاقاتی که می‌افتد:\n• <b>${newDomain}</b> دامنه اصلی سایت شما می‌شود\n• <b>${oldDomain}</b> از این پلن هاستینگ حذف می‌شود — همچنان نزد شما ثبت است، فقط اتصال هاستینگ قطع می‌شود\n• فایل‌های شما در <code>public_html/</code> حفظ شده و اکنون روی <b>${newDomain}</b> سرو می‌شوند\n• DNS و محافظت Anti-Red برای <b>${newDomain}</b> تنظیم می‌شوند\n• نام کاربری و PIN یکسان cPanel را حفظ می‌کنید\n\nاین عمل <b>قابل بازگشت نیست</b> و هیچ استردادی صورت نمی‌گیرد.\n\nادامه می‌دهید؟`,
 changingPrimaryDomain: newDomain => `⏳ در حال تغییر دامنه اصلی به <b>${newDomain}</b>...`,
 changePrimaryDomainSuccess: (newDomain, oldDomain, panelUrl) => `✅ <b>${newDomain}</b> اکنون دامنه اصلی شماست!\n\n• <b>${oldDomain}</b> از این پلن هاستینگ حذف شد (همچنان نزد شما ثبت است).\n• فایل‌های موجود شما در <code>public_html/</code> اکنون روی <b>${newDomain}</b> سرو می‌شوند.\n• همان نام کاربری و PIN cPanel — چیزی برای یادگیری مجدد نیست.\n\n🔧 باز کردن File Manager: ${panelUrl}\n\n⏱️ انتشار DNS: معمولاً ظرف ۵ دقیقه فعال می‌شود.\n🛡️ محافظت Anti-Red: در حال راه‌اندازی (تأیید در ۳۰ ثانیه).`,
 changePrimaryDomainFailed: (newDomain, error) => `❌ تغییر دامنه اصلی به <b>${newDomain}</b> امکان‌پذیر نبود.\n\n<code>${error}</code>\n\nهیچ تغییری در پلن شما اعمال نشد. لطفاً دوباره امتحان کنید، یا با پشتیبانی تماس بگیرید تا برای شما انجامش دهیم.`,
 confirmAttachDomain: (addonDomain, mainDomain, docRoot) => `🔗 <b>تأیید اتصال</b>\n\n<b>${addonDomain}</b> را به پلن هاستینگ شما (<code>${mainDomain}</code>) متصل کنیم؟\n\nاتفاقاتی که بعد از آن می‌افتد:\n• ورودی addon در cPanel ایجاد می‌شود (به صورت خودکار از سایت اصلی جدا می‌شود)\n• مسیر اسناد: <code>${docRoot}/</code>\n• DNS به صورت خودکار از طریق Cloudflare پیکربندی می‌شود (root + www → تانل)\n• محافظت Anti-Red راه‌اندازی می‌شود\n• رکوردهای DNS قدیمی (مانند shortener) پاکسازی می‌شوند\n\n<i>فایل‌های موجود داخل این پوشه دست نخورده باقی می‌مانند.</i>\n\nادامه می‌دهید؟`,
 attachingDomain: addonDomain => `⏳ در حال اتصال <b>${addonDomain}</b> به پلن هاستینگ شما...`,
 attachDomainSuccess: (addonDomain, docRoot, panelUrl) => `✅ <b>${addonDomain}</b> اکنون به پلن هاستینگ شما متصل شد!\n\n📁 <b>محل آپلود فایل‌های سایت</b>\nفایل‌های این دامنه در اینجا قرار می‌گیرند:\n<code>${docRoot}/</code>\n\nنه در <code>public_html/</code> — آنجا جایی است که فایل‌های دامنه <i>اصلی</i> شما قرار دارند. هر addon domain پوشه جداگانه‌ای دارد تا سایت‌ها با هم تداخل نداشته باشند.\n\n🔧 باز کردن File Manager: ${panelUrl}\n\n⏱️ انتشار DNS: معمولاً ظرف ۵ دقیقه فعال می‌شود.\n🛡️ محافظت Anti-Red: در حال راه‌اندازی (تأیید در ۳۰ ثانیه).`,
 attachDomainFailed: (addonDomain, errorReason) => `❌ اتصال <b>${addonDomain}</b> امکان‌پذیر نبود.\n\n<i>دلیل:</i> ${errorReason || 'خطای ناشناخته'}\n\nلطفاً دوباره امتحان کنید، یا در صورت ادامه مشکل روی 💬 پشتیبانی ضربه بزنید.`,
 attachDomainAlreadyOnPlan: addonDomain => `⚠️ <b>${addonDomain}</b> قبلاً روی یک پلن هاستینگ است. یک دامنه فقط می‌تواند به یک پلن در هر زمان متصل باشد.\n\nاگر می‌خواهید آن را به این پلن منتقل کنید، ابتدا از 🗑️ جداسازی دامنه در پلن دیگر استفاده کنید.`,
 attachDomainLimitReached: (limit, planLabel) => `⚠️ <b>به سقف دامنه رسیدید</b>\n\nپلن فعلی شما (<b>${planLabel}</b>) حداکثر ${limit} addon domain${limit !== 1 ? '' : ''} را مجاز می‌داند.\n\nبرای addon domain های نامحدود به Golden Anti-Red HostPanel ارتقا دهید، یا یک addon موجود را جدا کنید تا یک جایگاه آزاد شود.`,
 attachDomainBlocked: addonDomain => `🚫 <b>${addonDomain}</b> قابل اتصال نیست.\n\nاین دامنه به دلیل نقض سیاست‌های استفاده پرچم‌گذاری شده و به طور دائمی از هاستینگ ما مسدود شده است.`,
 attachDomainAlreadyAttached: addonDomain => `ℹ️ <b>${addonDomain}</b> قبلاً به این پلن هاستینگ متصل است — کاری برای انجام وجود ندارد.`,

 confirmCancelHostingPlan: (domain, plan) => `⚠️ <b>تأیید لغو پلن هاستینگ</b>\n\nشما در حال لغو دائمی موارد زیر هستید:\n• دامنه: <b>${domain}</b>\n• پلن: <b>${plan}</b>\n\nاین عمل موارد زیر را <b>به طور دائم حذف</b> می‌کند:\n• حساب cPanel و تمام فایل‌های شما\n• تمام ایمیل‌ها، پایگاه‌های داده و حساب‌های FTP\n• تمام addon domain های این پلن\n• محافظت Anti-Red\n\nاین عمل قابل بازگشت نیست و <b>هیچ استردادی صورت نمی‌گیرد</b>.\n\nخود دامنه همچنان نزد شما ثبت باقی می‌ماند. فقط هاستینگ لغو می‌شود.\n\nمطمئن هستید؟`,
 cancellingHostingPlan: domain => `⏳ در حال لغو پلن هاستینگ برای <b>${domain}</b>...`,
 cancelHostingPlanSuccess: domain => `✅ پلن هاستینگ <b>${domain}</b> لغو شد.\n\nحساب cPanel، فایل‌ها و تمام addon domain های شما حذف شدند. دامنه شما همچنان ثبت شده و اکنون از هر پلن هاستینگی آزاد است.`,
 cancelHostingPlanFailed: domain => `❌ لغو پلن هاستینگ برای <b>${domain}</b> با شکست مواجه شد. لطفاً دوباره امتحان کنید، یا در صورت ادامه مشکل با پشتیبانی تماس بگیرید.`,

 // روشن/خاموش کردن سایت / حالت نگهداری
 chooseSiteOfflineMode: domain => `🔌 <b>آفلاین کردن سایت</b>\n\nدامنه: <b>${domain}</b>\n\nروش آفلاین کردن سایت را انتخاب کنید:\n\n🛠️ <b>حالت تعمیر و نگهداری</b> (توصیه شده)\nبازدیدکنندگان یک صفحه تمیز «به زودی برمی‌گردیم» می‌بینند. ایمیل، FTP و پایگاه‌های داده به کار خود ادامه می‌دهند. برای ویرایش‌های سریع یا قطعی‌های کوتاه بهترین گزینه است.\n\n🚫 <b>تعلیق کامل</b>\nHTTP، FTP، ایمیل و پایگاه‌های داده همگی متوقف می‌شوند. بازدیدکنندگان اطلاعیه استاندارد «حساب معلق» cPanel را می‌بینند. اگر می‌خواهید همه چیز را کاملاً خاموش کنید از این استفاده کنید.\n\n⚠️ <b>مهم — آفلاین کردن سایت موارد زیر را متوقف نمی‌کند:</b>\n• شمارش معکوس انقضا\n• صورت‌حساب تمدید خودکار\n\nپلن مثل همیشه به کار خود ادامه می‌دهد. این فقط یک تغییر وضعیت نمایش است.`,
 confirmSiteOfflineMode: (domain, mode) => mode === 'suspended'
  ? `⚠️ <b>تأیید تعلیق کامل</b>\n\nشما در حال تعلیق کامل <b>${domain}</b> هستید.\n\nاین عمل موارد زیر را متوقف می‌کند:\n• HTTP (وب‌سایت شما)\n• FTP\n• حساب‌های ایمیل\n• پایگاه‌های داده\n\nبازدیدکنندگان صفحه استاندارد «حساب معلق» cPanel را می‌بینند. می‌توانید هر زمان همه چیز را از همین منو آنلاین کنید.\n\n<b>یادآوری — صورت‌حساب ادامه دارد:</b>\n• تاریخ انقضا تغییر نمی‌کند\n• تمدید خودکار همچنان انجام می‌شود\n\nادامه می‌دهید؟`
  : `⚠️ <b>تأیید حالت تعمیر و نگهداری</b>\n\nشما در حال فعال کردن حالت تعمیر و نگهداری برای <b>${domain}</b> هستید.\n\nاتفاقاتی که می‌افتد:\n• بازدیدکنندگان صفحه «به زودی برمی‌گردیم» می‌بینند\n• ایمیل، FTP و پایگاه‌های داده به کار خود ادامه می‌دهند\n• یک بلوک کوچک به <code>.htaccess</code> شما اضافه می‌شود (هنگام آنلاین شدن به صورت تمیز حذف می‌شود)\n• یک فایل <code>maintenance.html</code> در <code>public_html/</code> ایجاد می‌شود\n\n<b>یادآوری — صورت‌حساب ادامه دارد:</b>\n• تاریخ انقضا تغییر نمی‌کند\n• تمدید خودکار همچنان انجام می‌شود\n\nادامه می‌دهید؟`,
 takingSiteOffline: (domain, mode) => `⏳ ${mode === 'suspended' ? 'در حال تعلیق' : 'در حال فعال‌سازی حالت تعمیر و نگهداری برای'} <b>${domain}</b>...`,
 takeSiteOfflineSuccess: (domain, mode) => mode === 'suspended'
  ? `✅ <b>${domain}</b> اکنون آفلاین است (تعلیق کامل). بازدیدکنندگان صفحه معلق را می‌بینند. برای بازگردانی روی «آنلاین کردن سایت» ضربه بزنید.\n\n<i>یادآوری: پلن شما به شمارش معکوس به سمت انقضا ادامه می‌دهد و تمدید خودکار تحت تأثیر قرار نمی‌گیرد.</i>`
  : `✅ <b>${domain}</b> اکنون در حالت تعمیر و نگهداری است. بازدیدکنندگان صفحه «به زودی برمی‌گردیم» می‌بینند. ایمیل و FTP همچنان کار می‌کنند. وقتی آماده راه‌اندازی مجدد شدید روی «آنلاین کردن سایت» ضربه بزنید.\n\n<i>یادآوری: پلن شما به شمارش معکوس به سمت انقضا ادامه می‌دهد و تمدید خودکار تحت تأثیر قرار نمی‌گیرد.</i>`,
 takeSiteOfflineFailed: (domain, err) => `❌ آفلاین کردن <b>${domain}</b> با شکست مواجه شد.${err ? `\n\nدلیل: <code>${err}</code>` : ''}\n\nلطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.`,
 confirmBringSiteOnline: domain => `🌐 <b>آنلاین کردن مجدد سایت</b>\n\nدامنه: <b>${domain}</b>\n\nاین عمل دسترسی عمومی را فوری بازگردانی می‌کند. اگر از <i>حالت تعمیر و نگهداری</i> استفاده کردید، بلوک redirect از <code>.htaccess</code> شما حذف می‌شود. اگر از <i>تعلیق کامل</i> استفاده کردید، حساب cPanel از حالت تعلیق خارج شده و HTTP/FTP/ایمیل/DB همگی برمی‌گردند.\n\nادامه می‌دهید؟`,
bringingSiteOnline: domain => `⏳ در حال بازگرداندن <b>${domain}</b> به حالت آنلاین...`,
 bringSiteOnlineSuccess: domain => `✅ <b>${domain}</b> دوباره آنلاین شد. تا ۱ دقیقه صبر کنید تا کش/CDN به طور کامل پاک شود.`,
 bringSiteOnlineFailed: (domain, err) => `❌ بازگرداندن <b>${domain}</b> به حالت آنلاین با شکست مواجه شد.${err ? `\n\nدلیل: <code>${err}</code>` : ''}\n\nلطفاً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.`,
}

const phoneNumberLeads = ['🎯 لیدهای هدفمند ویژه', '✅📲 اعتبارسنجی شماره تلفن']

const buyLeadsSelectCountry = Object.keys(areasOfCountry)
const buyLeadsSelectSmsVoice = ['SMS (قیمت 20$ برای 1000)', 'Voice (قیمت 0$ برای 1000)']
const buyLeadsSelectArea = country => Object.keys(areasOfCountry?.[country])
const buyLeadsSelectAreaCode = (country, area) => {
 const codes = areasOfCountry?.[country]?.[area].map(c => format(countryCodeOf[country], c))
 return codes.length > 1 ? ['کدهای منطقه ترکیبی'].concat(codes) : codes
}
const _buyLeadsSelectAreaCode = (country, area) => areasOfCountry?.[country]?.[area]
const buyLeadsSelectCnam = yesNo
const buyLeadsSelectCarrier = country => carriersOf[country]
const buyLeadsSelectAmount = ['1000', '2000', '3000', '4000', '5000']
const buyLeadsSelectFormat = ['فرمت محلی', 'فرمت بین‌المللی']

const validatorSelectCountry = Object.keys(areasOfCountry)
const validatorSelectSmsVoice = ['SMS (قیمت 15$ برای 1000)', 'Voice (قیمت 0$ برای 1000)']
const validatorSelectCarrier = country => carriersOf[country]
const validatorSelectCnam = yesNo
const validatorSelectAmount = ['ALL', '1000', '2000', '3000', '4000', '5000']
const validatorSelectFormat = ['فرمت محلی', 'فرمت بین‌المللی']

const selectFormatOf = {
 'فرمت محلی': 'Local Format',
 'فرمت بین‌المللی': 'International Format',
}

//redSelectRandomCustom

const redSelectRandomCustom = ['لینک کوتاه تصادفی']

const redSelectProvider = ['Bit.ly $10', `Shortit (آزمایشی ${FREE_LINKS})`]

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
const _bc = ['Back', 'Cancel']
const _bcm = ['Back', '🏠 Main Menu', 'Cancel']
const _mc = ['🏠 Main Menu', 'Cancel']
const _isEmojiBack = item => {
  if (typeof item !== 'string') return false
  const s = item.replace(/^[^\p{L}]+/u, '').trim()
  return s === 'Back' || s === 'Retour' || s === '返回' || s === 'वापस' || s === 'بازگشت'
}

const payIn = {
 crypto: 'Crypto',
 ...(HIDE_BANK_PAYMENT !== 'true' && { bank: 'Bank ₦aira + Card🏦💳' }),
 wallet: '👛 Wallet',
}

const tickerViews = Object.keys(tickerOf)
const reverseObject = o => Object.fromEntries(Object.entries(o).map(([key, val]) => [val, key]))
const tickerViewOf = reverseObject(tickerOf)
const supportedCryptoView = reverseObject(supportedCrypto)
const supportedCryptoViewOf = Object.keys(supportedCryptoView)

const kOf = list => ({
 reply_markup: {
 // اگر چندین دکمه در یک ردیف وجود داشته باشد مدیریت کن
 keyboard: [
 ...list.map(a => (Array.isArray(a) ? a : [a])),
 ...((list.some(a => Array.isArray(a) && a.some(i => typeof i === 'string' && i.includes('🏠 Main Menu'))))
 ? []
: list.some(
 a =>
 Array.isArray(a) &&
 a.some(
 item =>
 typeof item === 'string' &&
 (item.includes(t.backButton) ||
 item.includes(user.backToHostingPlans) ||
 item.includes(user.backToStarterPlanDetails) ||
 item.includes(user.backToPurchaseOptions)),
 ),
 )
 ? [['🏠 Main Menu']]
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
 keyboard: [Object.values(payIn), ['💬 پرسیدن سوال'], _bcm],
 },
 parse_mode: 'HTML',
 },

 vcAmount: {
 reply_markup: {
 keyboard: [
 ['$50', '$100', '$200'],
 ['$500', '$1000'],
 ['✏️ مقدار دلخواه'],
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
 // تغییر اینجا برای validatorSelectCountry
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
 // ── منوی اصلی (ساده‌سازی ۲۰۲۶-۰۶): گروه‌بندی شده در بخش‌های مشخص؛ خدمات ثانویه
 // (تأیید ایمیل، معرفی، فروشنده، عضویت در کانال، ارسال انبوه ایمیل)
 // به زیر «➕ بیشتر» منتقل شده‌اند تا شلوغی سطح اول کاهش یابد. هندلرها بر اساس برچسب تطبیق می‌دهند،
 // بنابراین تغییر گروه‌بندی/ترتیب هیچ خطری برای مسیریابی ندارد.
...require('../web-access').webMenuRows('en'), // 🌐 Hosting/RDP/VPS on Web (NomadlyBot only, WEBSITE_URL set)
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
 en: '🇬🇧 English',
 fr: '🇫🇷 French',
 zh: '🇨🇳 Chinese',
 hi: '🇮🇳 Hindi',
 fa: '🇮🇷 فارسی (Persian)',
}
const supportedLanguages = reverseObject(languages)

const languageMenu = {
 reply_markup: {
 keyboard: [[languages.en], [languages.fr], [languages.zh], [languages.hi], [languages.fa]],
 },
 parse_mode: 'HTML',
 disable_web_page_preview: true,
}

const l = {
 continueAtHostbay: ('🚀 تمام خدمات اکنون مستقیماً در ' + (process.env.CHAT_BOT_NAME || 'Nomadly Bot') + ' در دسترس هستند — دامنه، لیدز، Cloud IVR، محصولات دیجیتال و بیشتر.'),
 redirectMessage: ('🚀 تمام خدمات اکنون مستقیماً در ' + (process.env.CHAT_BOT_NAME || 'Nomadly Bot') + ' در دسترس هستند — دامنه، لیدز، Cloud IVR، محصولات دیجیتال و بیشتر.'),

 serviceAd: `━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>${(process.env.CHAT_BOT_BRAND || 'Nomadly')}</b> — جعبه‌ابزار دیجیتال شما
━━━━━━━━━━━━━━━━━━━━━━

📞 <b>Cloud IVR + SIP</b>
شماره مجازی در ${require('../phone-config').CLOUD_COUNTRY_COUNT} کشور
IVR Auto-Attendant · SMS · پست صوتی · SIP
کمپین‌های IVR سریع و انبوه

🌐 <b>دامنه‌های ضدضربه</b>
بیش از ۱٬۰۰۰ TLD · آفشور بدون محدودیت DMCA
مدیریت DNS · محافظت ضد-Red

🛡️ <b>هاستینگ ضدضربه</b>
HostPanel آفشور · هفتگی و ماهانه
سپر JS Challenge · SSL رایگان

🛒 <b>محصولات دیجیتال</b>
Twilio · Telnyx · AWS · Google Cloud
Google Workspace · Zoho Mail · eSIM

💳 <b>کارت‌های دبیت مجازی</b>
کارت مجازی فوری · استفاده جهانی

🎯 <b>سرنخ‌های تلفنی تأییدشده</b>
فیلتر بر اساس کشور، اپراتور و پیش‌شماره
سرنخ‌های ممتاز با نام صاحبان

🔗 <b>URL Shortener</b>
لینک‌های برندشده · دامنه‌های سفارشی · آمار و تحلیل

━━━━━━━━━━━━━━━━━━━━━━
💰 پرداخت با <b>Crypto · Bank · Wallet</b>
━━━━━━━━━━━━━━━━━━━━━━

🤖 <b>Start Now →</b> @${(process.env.BOT_USERNAME || 'Nomadlybot')}
💬 <b>نیاز به کمک دارید؟</b> روی پشتیبانی در ربات بزنید
📢 <b>Updates →</b> ${TG_CHANNEL}`,

 askPreferredLanguage: `🌍 برای اطمینان از نمایش همه چیز به زبان دلخواه شما، لطفاً یکی از گزینه‌های زیر را انتخاب کنید:
 
شما می‌توانید زبان خود را بعداً در تنظیمات تغییر دهید.`,
 askValidLanguage: 'لطفاً یک زبان معتبر انتخاب کنید:',
 settingsMenuText: '⚙️ <b>تنظیمات</b>\n\nتنظیمات برگزیده خود را در زیر مدیریت کنید:',
 welcomeMessage: `Welcome to ${CHAT_BOT_NAME}!

جعبه‌ابزار دیجیتال همه‌کاره شما:

<b>Cloud IVR</b> — Virtual numbers in ${require('../phone-config').CLOUD_COUNTRY_COUNT} countries, IVR, SMS, SIP
<b>Domains</b> — بیش از ۴۰۰ پسوند دامنه، ثبت آفشور با نادیده‌گرفتن DMCA
<b>URL Shortener</b> — ${FREE_LINKS} لینک برندشده رایگان برای شروع
<b>Phone Leads</b> — تأییدشده بر اساس کشور، اپراتور و منطقه
<b>Digital Products</b> — Twilio، Telnyx، AWS، Workspace و موارد بیشتر

بیایید در ۳۰ ثانیه راه‌اندازی‌تان کنیم.`,
 askUserEmail: 'ایمیل شما چیست؟ بیایید تجربه شما را شخصی‌سازی کنیم! (مثال: davidsen@gmail.com)',
 processUserEmail: ` ممنون 😊 در حال راه‌اندازی حساب شما هستیم.
لطفاً چند لحظه صبر کنید تا جزئیات نهایی شود. ⏳
 
ما پشت صحنه در حال کار هستیم. فقط مراحل را دنبال کنید!`,
 confirmUserEmail: `✨ خبر خوب! حساب شما آماده است! 🎉💃🎉

از ویژگی‌های ممتاز در دوره آزمایشی رایگان خود لذت ببرید!
`,
 termsAndCond: `📜 قبل از ادامه، لطفاً شرایط و ضوابط ما را مرور و قبول کنید.`,
 acceptTermMsg: `لطفاً شرایط و ضوابط را برای ادامه استفاده از ${CHAT_BOT_NAME} بپذیرید`,

 acceptTermButton: '✅ Accept',
declineTermButton: '❌ رد کردن',
 viewTermsAgainButton: '🔄 مشاهده مجدد شرایط',
 exitSetupButton: '❌ خروج از تنظیمات',
 acceptedTermsMsg: `همه چیز آماده است! برای شروع:

<b>1.</b> <b>${FREE_LINKS} لینک کوتاه رایگان</b> خود را امتحان کنید — روی کوتاه‌کننده URL ضربه بزنید
<b>2.</b> یک <b>شماره تلفن مجازی</b> دریافت کنید — روی Cloud IVR ضربه بزنید
<b>3.</b> <b>محصولات دیجیتال تأیید شده</b> را مرور کنید — روی محصولات دیجیتال ضربه بزنید

همه چیز در منوی زیر موجود است.`,
 declinedTermsMsg: `⚠️ برای ادامه استفاده از ${CHAT_BOT_NAME} باید شرایط و ضوابط را بپذیرید. 
هر زمان که آماده شدید، دوباره آن‌ها را مرور کنید.`,
 userExitMsg: 'کاربر دکمه خروج را فشار داده است.',
 termsAndCondMsg: `<h1>شرایط و ضوابط برای ${CHAT_BOT_NAME}</h1>
 <p><strong>تاریخ مؤثر:</strong> 01/01/2022</p>
<p>با استفاده از ${CHAT_BOT_NAME}، شما با این شرایط و ضوابط موافقت می‌کنید.</p>

 <h2>۱. پذیرش شرایط</h2>
 <p>شما باید ۱۸ سال یا بیشتر داشته باشید یا رضایت سرپرست داشته باشید و با این شرایط و سیاست حریم خصوصی ما موافقت کنید.</p>

 <h2>۲. خدمات ارائه‌شده</h2>
 <p>ما ثبت دامنه، هاستینگ وب و پشتیبانی راه‌اندازی سایت/اپلیکیشن ارائه می‌دهیم.</p>

 <h2>۳. مسئولیت‌های کاربر</h2>
 <p>اطلاعات دقیق ارائه دهید، از فعالیت‌های غیرقانونی خودداری کنید و حساب تلگرام خود را ایمن نگه دارید.</p>

 <h2>۴. شرایط پرداخت</h2>
 <p>تمام پرداخت‌ها قطعی هستند مگر اینکه خلاف آن ذکر شده باشد. عدم پرداخت ممکن است منجر به تعلیق سرویس شود.</p>

 <h2>۵. محدودیت‌های سرویس</h2>
 <p>ممکن است محدودیت‌های منابع اعمال کنیم یا به دلیل نگهداری یا مشکلات فنی دچار اختلال شویم.</p>

 <h2>۶. خاتمه</h2>
 <p>ما می‌توانیم در صورت تخلف یا عدم پرداخت، سرویس‌ها را خاتمه دهیم. کاربران می‌توانند در هر زمان لغو کنند، اما هزینه‌ها قابل بازگشت نیستند.</p>

 <h2>۷. مسئولیت</h2>
 <p>سرویس‌ها «همان‌طور که هستند» ارائه می‌شوند. ما در قبال از دست رفتن داده، قطعی‌ها یا نقض امنیت کاربر مسئول نیستیم.</p>

 <h2>۸. حریم خصوصی</h2>
 <p>ما داده‌های شما را طبق سیاست حریم خصوصی خود مدیریت می‌کنیم و تنها در صورت الزام قانونی آن را به اشتراک می‌گذاریم.</p>

 <h2>۹. تغییرات در شرایط</h2>
 <p>ممکن است این شرایط را به‌روزرسانی کنیم و ادامه استفاده به معنای پذیرش آن است.</p>

 <h2>۱۰. تماس</h2>
 <p>برای پشتیبانی، با ما از طریق <a href="${APP_SUPPORT_LINK}" target="_blank">${APP_SUPPORT_LINK}</a> در تماس باشید.</p>

 <p>با استفاده از ${CHAT_BOT_NAME}، شما با این شرایط موافقت می‌کنید. متشکریم!</p>`,
}

const termsAndConditionType = lang => ({
 reply_markup: {
 inline_keyboard: [
 [
 {
 text: 'مشاهده شرایط و ضوابط',
 web_app: {
 url: `${SELF_URL}/terms-condition?lang=${lang}`,
 },
 },
 ],
 ],
 },
})

const planOptions = ['روزانه', 'هفتگی', 'ماهانه']
const planOptionsOf = {
 'روزانه': 'Daily',
 'هفتگی': 'Weekly',
 'ماهانه': 'Monthly',
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
 keyboard: [_bc, ['پشتیبان‌گیری از داده‌ها'], ['بازیابی داده‌ها']],
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
 [dnsQuickActions.pointToIp],
 [dnsQuickActions.googleEmail],
 [dnsQuickActions.zohoEmail],
 [dnsQuickActions.verification],
 [dnsQuickActions.addSubdomain],
 _bc,
 ],
 },
 disable_web_page_preview: true,
}
const dnsMxPriorityKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [['1'], ['5'], ['10'], ['20'], ['30'], _bc],
 },
 disable_web_page_preview: true,
}
const dnsProxiedChoiceKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.dnsProxiedChoiceLabelDnsOnly], [t.dnsProxiedChoiceLabelProxied], _bc],
 resize_keyboard: true,
},
 disable_web_page_preview: true,
}
const dnsSubdomainTargetTypeKeyboard = {
 parse_mode: 'HTML',
 reply_markup: {
 keyboard: [[t.dnsQuickSubdomainIp, t.dnsQuickSubdomainDomain], _bc],
 },
 disable_web_page_preview: true,
}

// فاز ۲: کیبورد نوع رکورد آگاه از ارائه‌دهنده (NS حذف شده — فقط به‌روزرسانی)
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
 text: 'پرداخت کنید',
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
 name: 'Premium Anti-Red (1 هفته)',
 price: PREMIUM_ANTIRED_WEEKLY_PRICE,
 duration: '۷ روز',
 storage: '۱۰ گیگابایت SSD',
 bandwidth: '۱۰۰ گیگابایت',
 domains: 'تا ۲ دامنه',
 ssl: 'SSL رایگان',
 protection: 'پنهان‌سازی IP · تشخیص ربات · مسدودسازی UA',
 panel: 'HostPanel — مدیریت فایل، پایگاه داده و ایمیل',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 روز)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '۳۰ روز',
 storage: '۵۰ گیگابایت SSD',
 bandwidth: '۵۰۰ گیگابایت',
 domains: 'تا ۶ دامنه',
 ssl: 'SSL رایگان',
 protection: 'پنهان‌سازی IP · چالش JS · مسدودسازی UA و TLS',
 panel: 'HostPanel — پشتیبان‌گیری، مهاجرت و ابزارهای پیشرفته',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 روز)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '۳۰ روز',
 storage: '۱۰۰ گیگابایت SSD',
 bandwidth: 'نامحدود',
 domains: 'دامنه نامحدود',
 ssl: 'SSL رایگان + Wildcard',
 protection: 'Anti-Red کامل: پنهان‌سازی IP · چالش JS · TLS/JA3 · قوانین WAF · پشتیبانی اولویت‌دار',
 panel: 'HostPanel — استیجینگ، امنیت و تمام ابزارهای پیشرفته',
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
 buyText: 'چطور می‌خواهید دامنه متصل کنید؟\n\n🌐 <b>ثبت دامنه جدید</b>\n📂 <b>استفاده از دامنه من</b> — از دامنه‌های خود انتخاب کنید\n🔗 <b>اتصال دامنه خارجی</b> — از دامنه‌ای که دارید استفاده کنید',
 registerNewDomainText: 'دامنه مورد نظر خود را وارد کنید (مثال: example.com)',
 domainNotFound: 'دامنه پیدا نشد. یکی دیگر امتحان کنید.',
 useExistingDomainText: 'دامنه خود را وارد کنید (مثال: example.com)',
 connectExternalDomainText: 'دامنه خارجی خود را وارد کنید (مثال: example.com)\n\nپس از راه‌اندازی باید nameserver ها را به Cloudflare هدایت کنید.',
 useExistingDomainNotFound: 'این دامنه به حساب شما متصل نیست. دامنه دیگری امتحان کنید یا با پشتیبانی تماس بگیرید.',
 enterYourEmail: 'ایمیل خود را برای راه‌اندازی حساب و دریافت رسید وارد کنید.\n\nروی «رد کردن» بزنید تا بدون ایمیل ادامه دهید.',
 invalidEmail: 'ایمیل نامعتبر است. دوباره تلاش کنید.',
 paymentConfirmation: 'پرداخت را برای فعال‌سازی هاستینگ تأیید کنید.',
 paymentSuccess: 'پرداخت دریافت شد — در حال راه‌اندازی هاستینگ شما هستیم.',
 paymentFailed: 'پرداخت ناموفق بود. لطفاً دوباره تلاش کنید.',
 }

 return `${commonSteps[step]}`
 },
 generateDomainFoundText: (websiteName, price, hostingPrice, total, planName) => {
   if (hostingPrice && total) {
     return `✅ <b>${websiteName}</b> در دسترس است!\n\n` +
       `🌐 دامنه: <b>$${price}</b>\n` +
       `🛡️ هاستینگ${planName ? ` (${planName})` : ''}: <b>$${hostingPrice}</b>\n` +
       `━━━━━━━━━━━━\n` +
       `💰 <b>مجموع امروز: $${total}</b>`
   }
   return `<b>${websiteName}</b> در دسترس است — $${price}`
 },
 generateExistingDomainText: websiteName => `دامنه تنظیم شد: <b>${websiteName}</b>`,
 connectExternalDomainText: websiteName => `دامنه: <b>${websiteName}</b>\n\nNameserver ها به Cloudflare هدایت خواهند شد. رکوردهای DNS به‌صورت خودکار پیکربندی می‌شوند.`,
 domainNotFound: websiteName => `<b>${websiteName}</b> در دسترس نیست. یکی دیگر امتحان کنید.`,
 nameserverSelectionText: websiteName =>
 `ارائه‌دهنده nameserver را برای <b>${websiteName}</b> انتخاب کنید`,
 confirmEmailBeforeProceeding: email => `آیا از <b>${email}</b> برای این حساب استفاده شود؟`,

 generateInvoiceText: payload => {
 const domain = payload.existingDomain ? `${payload.domainName} (موجود)` : `${payload.domainName} — $${payload.domainPrice}`
 const total = payload.couponApplied ? payload.newPrice : payload.totalPrice
 let text = `<b>${payload.planName || 'Anti-Red HostPanel'}</b> · ${payload.duration || '۱ ماه'}

دامنه: ${domain}
هاستینگ: $${payload.hostingPrice}`
 if (payload.couponApplied && payload.couponDiscount > 0) {
 text += `\nتخفیف: -$${payload.couponDiscount}`
 }
 text += `\n\n<b>مجموع: $${total}</b>

ظرف ۱ ساعت پرداخت کنید تا فعال شود. هاستینگ شما به‌صورت خودکار راه‌اندازی می‌شود.`
 return text
 },

 showCryptoPaymentInfo: (priceUsd, priceCrypto, tickerView, address, plan) => `💰 <b>مجموع: $${Number(priceUsd).toFixed(2)} USD</b>

دقیقاً <b>${priceCrypto} ${tickerView}</b> به این آدرس ارسال کنید:

<code>${address}</code>

${plan} شما پس از تأیید پرداخت به‌صورت خودکار فعال می‌شود (معمولاً ظرف چند دقیقه).`,

 successText: (info, response) =>
 `هاستینگ شما فعال است.

<b>Domain:</b> ${info.website_name}
${info.email ? `<b>Email:</b> ${info.email}\n` : ''}DNS auto-configured via Cloudflare.`,

 support: (plan, statusCode) => `راه‌اندازی ${plan} (${statusCode}) با شکست مواجه شد. برای کمک روی 💬 پشتیبانی ضربه بزنید.`,

 bankPayDomain: (
 priceNGN,
 plan,
 ) => `از طریق دکمه زیر <b>${priceNGN} NGN</b> پرداخت کنید. ${plan} شما پس از تأیید به‌طور خودکار فعال می‌شود.`,
}

const vpsBC = ['🔙 Back', 'Cancel']

const vpsOptionsOf = list => ({
reply_markup: {
 // در صورت وجود چند دکمه در یک ردیف مدیریت می‌شود
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
hourly: 'ساعتی',
 monthly: 'ماهانه',
 quaterly: 'فصلی',
 annually: 'سالانه',
}

const vpsPlanMenu = ['ساعتی', 'ماهانه', 'فصلی', 'سالانه']
const vpsConfigurationMenu = ['پایه', 'استاندارد', 'پریمیوم', 'سازمانی']
const vpsCpanelOptional = ['WHM', 'Plesk', '❌ رد کردن کنترل پنل']

const vpsPlanOf = {
 'ساعتی': 'hourly',
 'ماهانه': 'monthly',
 'فصلی': 'quaterly',
 'سالانه': 'annually',
}

// ترجمه‌های سرویس صوتی
const vs = {
  callDisconnectedAutoRouted: (usdBal, lowBalTrigger, lowBalResume) => `🚫 <b>تماس قطع شد</b> (مسیریابی خودکار)\n\nکیف پول: <b>$${usdBal}</b> — زیر آستانه $${lowBalTrigger}.\n💰 حداقل $${lowBalResume} شارژ کنید تا تماس از سر گرفته شود.`,
  callDisconnectedWalletInsufficient: (rate, connFee) => `🚫 <b>تماس قطع شد</b> — موجودی کیف پول کافی نیست (نیاز به $${rate}/دقیقه + $${connFee} هزینه اتصال).\nاز طریق 👛 کیف پول شارژ کنید.`,
  sipCallQueued: (to, max) => `⏳ <b>تماس در صف قرار گرفت</b> — ${to}\nشما در حال حاضر ${max} تماس متصل دارید. این تماس به محض پایان یافتن یکی از تماس‌ها به طور خودکار متصل می‌شود (تا ۲ دقیقه). در حین انتظار هیچ هزینه‌ای کسر نمی‌شود.`,
  callDisconnectedWalletExhausted: `🚫 <b>تماس قطع شد</b> — موجودی کیف پول تمام شد.\nاز طریق 👛 کیف پول شارژ کنید.`,
  outboundCallFailedRouting: (fromPhone, toPhone) => `🚫 <b>تماس خروجی ناموفق بود</b>\n📞 ${fromPhone} → ${toPhone}\nدلیل: مسیریابی تماس با خطا مواجه شد. لطفاً دوباره امتحان کنید.`,
  planMinutesExhausted: (phoneNumber, used, limit) => `⚠️ <b>دقیقه‌های پلن تمام شد</b>\n\n📞 ${phoneNumber}\nمصرف‌شده: <b>${used}/${limit}</b> دقیقه در این دوره.\n\nاکنون صورت‌حساب اضافه‌مصرف از کیف پول شما فعال است. شارژ کنید یا پلن خود را ارتقا دهید.`,
  callTypeCharge: (callType, minutesBilled, rate, chargedStr, region, discountLine) => `💰 <b>${callType}</b>: ${minutesBilled} دقیقه × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  overageCharge: (newOverageMin, rate, chargedStr, region, discountLine) => `💰 <b>اضافه‌مصرف</b>: ${newOverageMin} دقیقه × $${rate} = <b>${chargedStr}</b> (${region})${discountLine}`,
  transferEnded: (forwardPhone, duration, planLine) => `📞 <b>انتقال پایان یافت</b>\n${forwardPhone} — ${duration}\n${planLine}`,
  transferFailed: (forwardPhone, reason) => `❌ <b>انتقال ناموفق بود</b>\n📞 ${forwardPhone} — ${reason}`,
  orphanedNumberAlert: (to, from) => `⚠️ <b>هشدار شماره بی‌صاحب</b>\n\n📞 <code>${to}</code> تماس ورودی از <code>${from}</code> دریافت کرد\n\n❌ هیچ مالکی در پایگاه داده یافت نشد — تماس رد شد.\nممکن است این شماره نیاز به آزادسازی یا واگذاری مجدد داشته باشد.`,
incomingCallBlockedWalletEmpty: (toPhone, fromPhone, inboundRate, region) => `🚫 <b>تماس ورودی مسدود شد — کیف پول خالی است</b>\n\n📞 ${toPhone}\n👤 تماس‌گیرنده: ${fromPhone}\n\nدقایق پلن تمام شده و موجودی کیف پول برای مازاد کافی نیست ($${inboundRate}/دقیقه ${region}). کیف پول خود را شارژ کنید یا پلن را ارتقا دهید تا دریافت تماس از سر گرفته شود.`,
  overageActive: (chargedStr, region, currency) => `💰 <b>مازاد فعال است</b> — دقایق پلن تمام شد. ${chargedStr} (${region}) از کیف پول ${currency}.`,
  callEndedPlanWalletExhausted: (elapsedMin) => `🚫 <b>تماس پایان یافت</b> — دقایق پلن + کیف پول تمام شد.\n⏱️ ~${elapsedMin} دقیقه. کیف پول را شارژ کنید یا پلن را ارتقا دهید.`,
  incomingCall: (fromPhone, toPhone) => `📞 <b>تماس ورودی</b>\n${fromPhone} → ${toPhone}\nدر حال زنگ زدن روی دستگاه SIP شما...`,
  outboundCallingLocked: `🚫 <b>تماس خروجی قفل شده است</b>\n\n`,
  testCallsExpired: `⏰ <b>تماس‌های آزمایشی منقضی شدند</b>\n\nتست رایگان SIP شما به پایان رسید. لطفاً کلاینت SIP خود را قطع کنید تا تلاش مجدد متوقف شود.\n\n💡 برای برقراری تماس بیشتر، یک پلن Cloud Phone از منوی اصلی خریداری کنید.`,
  outboundCallBlocked: (fromPhone, toPhone, status) => `🚫 <b>تماس خروجی مسدود شد</b>\n📞 ${fromPhone} → ${toPhone}\nدلیل: شماره ${status} است. لطفاً تمدید کنید یا با پشتیبانی تماس بگیرید.`,
  sipPlanBlocked: (fromPhone, toPhone) => `🚫 <b>تماس مسدود شد — اپلیکیشن تلفن در پلن شما نیست</b>\n📞 ${fromPhone} → ${toPhone}\nتماس از طریق اپ‌های SIP و تلفن‌های رومیزی نیازمند پلن Pro یا بالاتر روی این شماره است. شماره را ارتقا دهید تا دوباره استفاده کنید.`,
  sipCallBlocked: (sipRate, connFee, region, usdBal, ngnBal) => `🚫 <b>تماس SIP مسدود شد</b> — موجودی کیف پول کافی نیست (نیاز به $${sipRate}/دقیقه + $${connFee} هزینه اتصال ${region}).\nموجودی: $${usdBal} / NGN: ₦${ngnBal}\nتماس‌های خروجی از کیف پول کسر می‌شوند. از طریق 👛 کیف پول شارژ کنید.`,
  freeSipTestCall: (fromPhone, toPhone, remaining, maxDuration) => `📞 <b>تماس آزمایشی رایگان SIP</b>\nاز: ${fromPhone}\nبه: ${toPhone}\n🆓 تماس آزمایشی رایگان (${remaining} باقی‌مانده، حداکثر ${maxDuration} ثانیه)`,
  sipOutboundCall: (fromPhone, toPhone, walletLine) => `📞 <b>تماس خروجی SIP</b>\nاز: ${fromPhone}\nبه: ${toPhone}\n${walletLine}`,
  outboundCallFailedTempUnavailable: (fromPhone, toPhone) => `🚫 <b>تماس خروجی ناموفق بود</b>\n📞 ${fromPhone} → ${toPhone}\nدلیل: تماس خروجی موقتاً در دسترس نیست. لطفاً بعداً دوباره امتحان کنید.`,
  sipOutboundCallWithRate: (fromPhone, toPhone, sipRate, connFeeNote, estMinutes) => `📞 <b>تماس خروجی SIP</b>\nاز: ${fromPhone}\nبه: ${toPhone}\nنرخ: $${sipRate}/دقیقه${connFeeNote} (~${estMinutes} دقیقه در دسترس)`,
  lowBalanceForward: (usdBal, estMinutes) => `⚠️ <b>موجودی کم است</b> — $${usdBal} (~${estMinutes} دقیقه انتقال). از طریق 👛 کیف پول <b>$25</b> شارژ کنید.`,
  forwardingBlocked: (usdBal, fwdRate) => `🚫 <b>انتقال مسدود شد</b> — کیف پول $${usdBal} (نیاز به $${fwdRate}/دقیقه).\nاز طریق 👛 کیف پول <b>$25</b> شارژ کنید.`,
  ivrForwardBlocked: (fromPhone, forwardPhone, usdBal, ivrFwdRate, region) => `🚫 <b>ارسال IVR مسدود شد — کیف پول خالی است</b>\n\n📞 ${fromPhone}\n📲 ارسال به: ${forwardPhone}\n\nکیف پول $${usdBal} (نیاز به $${ivrFwdRate}/دقیقه ${region} دارید).\nاز طریق 👛 کیف پول شارژ کنید.`,
  lowBalanceIvrForward: (usdBal, estMinutes) => `⚠️ <b>موجودی کم</b> — $${usdBal} (~${estMinutes} دقیقه ارسال IVR). از طریق 👛 کیف‌پول شارژ کنید.`,
  sipCallEndedAutoRouted: (fromPhone, toPhone, duration, minutesBilled, rate) => `📞 <b>تماس SIP پایان یافت</b> (مسیریابی خودکار)\n\nاز: ${fromPhone}\nبه: ${toPhone}\n⏱️ ${duration}\n💰 ${minutesBilled} دقیقه × $${rate} محاسبه شد`,
  ivrCallEndedWalletExhausted: (usdBal, ivrCallRate) => `🚫 <b>تماس IVR پایان یافت</b> — کیف‌پول خالی شد ($${usdBal}).\nتماس‌های IVR $${ivrCallRate}/دقیقه هزینه دارند. از طریق 👛 کیف‌پول شارژ کنید.`,
  callNotConnected: `📞 <b>تماس برقرار نشد</b> — گیرنده مشغول بود یا پاسخ نداد.\n\n🎁 تماس آزمایشی رایگان شما هنوز در دسترس است! هر زمان دوباره امتحان کنید.`,
  transferTimeout: (toPhone) => `⏱ <b>زمان انتقال به پایان رسید</b>\n📞 ${toPhone} پس از ۳۰ ثانیه پاسخ نداد`,
  transferConnected: (targetNumber, ivrNumber) => `✅ <b>انتقال برقرار شد</b>\n📞 ${targetNumber} به ${ivrNumber} متصل شد`,
}

const vp = {
 of: vpsOptionsOf,
 back: '🔙 Back',
 skip: '❌ Skip',
 cancel: '❌ Cancel',

// انتخاب VPS/RDP (مرحله ۱)
 vpsLinuxBtn: '🐧 لینوکس VPS (SSH)',
 vpsRdpBtn: '🪟 Windows RDP',
 askVpsOrRdp: `🖥️ چه نوع سروری نیاز دارید؟

📬 <b>پورت 25 باز</b> — ارسال ایمیل مستقیم از سرور شما

<strong>🐧 Linux VPS</strong> — دسترسی SSH · میزبانی وب · توسعه · اتوماسیون
<strong>🪟 Windows RDP</strong> — دسکتاپ از راه دور · برنامه‌ها و ابزارهای Windows`,

 //region selection
 askCountryForUser: `🌍 منطقه‌ای را که به کاربران شما نزدیک‌تر است انتخاب کنید:`,
 chooseValidCountry: 'لطفاً کشور را از لیست انتخاب کنید:',
 askRegionForUser: country => `📍 یک دیتاسنتر در ${country} انتخاب کنید (قیمت ممکن است بر اساس موقعیت متفاوت باشد.)`,
 chooseValidRegion: 'لطفاً یک منطقه معتبر از لیست انتخاب کنید:',
 askZoneForUser: region => `📍 منطقه را در ${region} انتخاب کنید.`,
 chooseValidZone: 'لطفاً یک منطقه معتبر از لیست انتخاب کنید:',
 confirmZone: (region, zone) => `✅ شما ${region} (${zone}) را انتخاب کردید. آیا می‌خواهید با این انتخاب ادامه دهید؟`,
 failedFetchingData: 'خطا در دریافت اطلاعات، لطفاً پس از مدتی دوباره تلاش کنید.',
 confirmBtn: `✅ Confirm Selection`,

 // disk type
 askVpsDiskType: list => `💾 <b>نوع فضای ذخیره‌سازی را انتخاب کنید</b>

${list?.some(item => item.pricier) ? 'NVMe گران‌تر است اما روی پردازنده‌های جدیدتر با دیسک بسیار سریع‌تر اجرا می‌شود — SSD گزینه اقتصادی است:' : 'هر دو گزینه هزینه یکسانی دارند — آنچه برایتان مهم‌تر است را انتخاب کنید:'}

${list?.map(item => `${item.description}`).join('\n\n')}

👇 گزینه خود را در زیر انتخاب کنید:`,

chooseValidDiskType: 'لطفاً یک نوع دیسک معتبر انتخاب کنید',

 // plans
 askPlanType: plans => `💳 چرخه صورت‌حساب را انتخاب کنید:

${plans
 .map(
 item =>
 `<strong>• ${item.type === 'Hourly' ? '⏳' : '📅'} ${item.type} –</strong> $${item.originalPrice} ${
 item.discount === 0 ? '(بدون تخفیف)' : `(شامل ${item.discount}% تخفیف)`
 }`,
 )
 .join('\n')}`,

 planTypeMenu: vpsOptionsOf(vpsPlanMenu),
 // صورت‌حساب (فقط ماهانه)
 hourlyBillingMessage: '',

 // configs
 askVpsConfig: (list, extras = {}) => {
  const { walletUsd, cheapestName, socialProof } = extras
  const isRDP = Array.isArray(list) && list.some(c => c.isRDP)
  const plans = list.map(config => {
   const star = config.name === cheapestName ? '🌟 ' : ''
   const line = `<strong>• ${star}${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB ${config.specs.diskType} — $${config.monthlyPrice}/mo`
   const hw = config.hardware || (config.isRDP ? '⚡ Premium AMD · NVMe SSD' : '')
   return hw ? `${line}\n   <i>${hw}</i>` : line
  }).join('\n')

  // پاورقی مقرون‌به‌صرفه — گران‌ترین پلنی که کاربر می‌تواند بپردازد را انتخاب می‌کند،
  // یا نشان می‌دهد چقدر باید برای ارزان‌ترین گزینه شارژ کند.
  let walletLine = ''
  if (typeof walletUsd === 'number') {
   const sorted = [...list].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice))
   const affordable = sorted.filter(p => Number(p.monthlyPrice) <= walletUsd)
   if (affordable.length) {
    const top = affordable[affordable.length - 1]
    walletLine = `\n\n💰 <b>کیف پول شما:</b> $${walletUsd.toFixed(2)} — می‌توانید تا <b>${top.name}</b> را تهیه کنید ✅`
   } else {
    const cheapest = sorted[0]
    const topUp = (Number(cheapest.monthlyPrice) - walletUsd).toFixed(2)
    walletLine = `\n\n💰 <b>کیف پول شما:</b> $${walletUsd.toFixed(2)} — <b>$${topUp}</b> دیگر شارژ کنید تا <b>${cheapest.name}</b> را فعال کنید`
   }
  }

  const proofLine = socialProof ? `\n\n${socialProof}` : ''
  const header = isRDP
   ? '🪟 یک پلن Windows RDP انتخاب کنید <i>(Windows Server + Remote Desktop، لایسنس شامل می‌شود)</i>:'
   : '⚙️ یک پلن Linux VPS انتخاب کنید:'
  return `${header}\n\n${plans}${proofLine}${walletLine}`
 },
 validVpsConfig: 'لطفاً یک پیکربندی VPS معتبر انتخاب کنید:',
 configMenu: vpsOptionsOf(vpsConfigurationMenu),

 //discount
 askForCoupon: `🎟️ کد تخفیف دارید؟ برای دریافت تخفیف اضافی (در صورت اعمال) آن را وارد کنید، یا این مرحله را رد کنید. تخفیف‌های چرخه صورت‌حساب از قبل اعمال شده‌اند.`,
 couponInvalid: `❌ نامعتبر: کد منقضی شده، قابل اعمال نیست یا اشتباه است. دوباره امتحان کنید.`,
 couponValid: amt => `✅ معتبر: تخفیف اعمال شد: -$${amt}.`,
 skipCouponwarning: `⚠️ رد کردن به این معنی است که نمی‌توانید بعداً تخفیف اعمال کنید.`,
 confirmSkip: '✅ تأیید رد کردن',
goBackToCoupon: '❌ بازگشت و اعمال کوپن',

 // os
 askVpsOS: () => `💻 یک توزیع لینوکس انتخاب کنید (پیش‌فرض: Ubuntu):

<strong>💡 پیشنهادی:</strong>
<strong>• Ubuntu</strong> — استفاده عمومی و توسعه
<strong>• AlmaLinux / Rocky</strong> — پایداری سازمانی
<strong>• Debian</strong> — سبک و قابل اعتماد`,
 chooseValidOS: `لطفاً یک سیستم‌عامل معتبر از لیست موجود انتخاب کنید:`,
 skipOSBtn: '❌ رد کردن انتخاب سیستم‌عامل',
 skipOSwarning: '⚠️ VPS شما بدون سیستم‌عامل راه‌اندازی می‌شود. باید آن را به صورت دستی از طریق SSH یا حالت بازیابی نصب کنید.',

 // cpanel
 askVpsCpanel: `🛠️ یک کنترل پنل برای مدیریت آسان‌تر سرور انتخاب کنید (اختیاری).

<strong>• ⚙️ WHM –</strong> پیشنهادی برای میزبانی چندین وب‌سایت
<strong>• ⚙️ Plesk –</strong> ایده‌آل برای مدیریت وب‌سایت‌ها و اپلیکیشن‌های مجزا
<strong>• ❌ رد کردن –</strong> بدون کنترل پنل
`,
 cpanelMenu: vpsOptionsOf(vpsCpanelOptional),
 noControlPanel: vpsCpanelOptional[2],
 skipPanelMessage: '⚠️ هیچ کنترل پنلی نصب نخواهد شد. می‌توانید بعداً به صورت دستی یکی نصب کنید.',
 validCpanel: 'لطفاً یک کنترل پنل معتبر انتخاب کنید یا آن را رد کنید.',
 askCpanelOtions: (name, list) => `⚙️ یک لایسنس ${
 name == 'whm' ? 'WHM' : 'Plesk Web Host Edition'
 } انتخاب کنید یا نسخه آزمایشی رایگان را انتخاب کنید (معتبر برای ${name == 'whm' ? '15' : '7'} روز).

💰 قیمت‌گذاری لایسنس ${name == 'whm' ? 'WHM' : 'Plesk'}:

${list.map(item => `${name == 'whm' ? `<strong>• ${item.name} - </strong>` : ''}${item.label}`).join('\n')}`,
 trialCpanelMessage: panel =>
 `✅ نسخه آزمایشی رایگان ${panel.name == 'whm' ? 'WHM' : 'Plesk'} (${
 panel.duration
 } روز) فعال شد. می‌توانید هر زمان با تماس با پشتیبانی ارتقا دهید.`,

 vpsWaitingTime: '⚙️ در حال دریافت اطلاعات... این فقط یک لحظه طول می‌کشد.',
 failedCostRetrieval: 'خطا در دریافت اطلاعات هزینه... لطفاً بعد از مدتی دوباره تلاش کنید.',

 errorPurchasingVPS: (plan, isRDP) => `در حین راه‌اندازی پلن ${plan} ${isRDP ? 'RDP' : 'VPS'} شما مشکلی پیش آمد.

 لطفاً روی 💬 پشتیبانی ضربه بزنید تا کمک دریافت کنید.
 بیشتر کشف کنید ${TG_HANDLE}.`,

 generateBillSummary: vpsDetails => {
 const planPrice = vpsDetails.couponApplied ? vpsDetails.planNewPrice : vpsDetails.plantotalPrice
 const total = vpsDetails.totalPrice || Number(planPrice).toFixed(2)
 const isRDP = vpsDetails.isRDP
 const months = Number(vpsDetails.durationMonths) || 1
 const osLabel = isRDP
 ? (vpsDetails.os?.id ? `🪟 ${vpsDetails.os.name}${vpsDetails.os.fastDeploy ? ' ⚡ آماده در ~۳ دقیقه' : ''}` : '🪟 Windows Server (RDP)')
 : (vpsDetails.os?.name || 'Ubuntu')
 const planEmoji = isRDP ? '🪟' : '🐧'
 const planKind = isRDP ? (/RDP/i.test(String(vpsDetails.config.name)) ? '' : ' <i>(Windows RDP)</i>') : ' <i>(Linux VPS)</i>'

 let summary = `<strong>📋 خلاصه سفارش:</strong>

<strong>${planEmoji} ${vpsDetails.config.name}</strong>${planKind} — ${vpsDetails.config.specs.vCPU} vCPU · ${vpsDetails.config.specs.RAM}GB RAM · ${vpsDetails.config.specs.disk}GB ${vpsDetails.config.specs.diskType}
${vpsDetails.config.hardware ? `<strong>⚙️ سخت‌افزار:</strong> ${vpsDetails.config.hardware}\n` : ''}<strong>📍 منطقه:</strong> ${vpsDetails.regionName || vpsDetails.country}
<strong>💻 سیستم‌عامل:</strong> ${osLabel}`

 if (isRDP) {
 summary += `\n<strong>🪟 لایسنس ویندوز:</strong> شامل می‌شود`
 }
 if (isRDP || months > 1) {
 summary += `\n<strong>📅 Duration:</strong> ${months === 1 ? '1 month' : `${months} months (prepaid)`}`
 }
 if (vpsDetails.couponApplied && vpsDetails.couponDiscount > 0) {
 summary += `\n<strong>🎟️ Coupon:</strong> -$${Number(vpsDetails.couponDiscount).toFixed(2)} USD`
 }
 summary += `\n<strong>🔄 تمدید خودکار:</strong> ✅ فعال`
 summary += `\n\n<strong>💰 Total: $${total} USD${months > 1 ? ` / ${months} months` : '/mo'}</strong>`
 summary += `\n\n<strong>✅ آیا با سفارش ادامه می‌دهید؟</strong>`
 return summary
 },

 no: '❌ Cancel Order',
 yes: '✅ Confirm Order',

 askPaymentMethod: 'یک روش پرداخت انتخاب کنید:',

 showDepositCryptoInfoVps: (priceUsd, priceCrypto, tickerView, address, vpsDetails) =>
 `💰 <b>مبلغ پرداخت: $${Number(priceUsd).toFixed(2)} USD</b>

Send exactly <b>${priceCrypto} ${tickerView}</b> to:

<code>${address}</code>

پس از تأیید پرداخت، ${vpsDetails?.isRDP ? 'Windows RDP' : 'VPS'} شما به‌طور خودکار فعال می‌شود (معمولاً ظرف چند دقیقه).

با احترام،
${CHAT_BOT_NAME}`,

 extraMoney: 'مبلغ باقی‌مانده طرح ساعتی شما به کیف پول واریز شد.',
 paymentRecieved: (isRDP = false) => `✅ پرداخت موفق!

${isRDP ? 'RDP' : 'VPS'} شما در حال راه‌اندازی است — این کار لحظه‌ای طول می‌کشد.
اطلاعات ورود شما همین‌جا در چت نمایش داده خواهد شد.`,
 paymentFailed: `❌ پرداخت ناموفق بود. لطفاً روش پرداخت خود را بررسی کنید یا دوباره تلاش کنید.`,

 lowWalletBalance: vpsName => `
طرح VPS شما برای نمونه ${vpsName} به دلیل موجودی کم متوقف شده است.

لطفاً کیف پول خود را شارژ کنید تا بتوانید از طرح VPS خود استفاده کنید.
`,

 vpsBoughtSuccess: (vpsDetails, response, credentials) => {
 const isRDP = response.isRDP || vpsDetails.isRDP || response.osType === 'Windows'
 const connectInfo = isRDP
 ? `<strong>🔗 اتصال:</strong> 🖥 Remote Desktop (mstsc) → <code>${response.host}:3389</code>`
 : `<strong>🔗 Connect:</strong> 💻 <code>ssh ${credentials.username}@${response.host}</code>`

 const readinessNote = isRDP
 ? `\n⏱ <b>۵ تا ۱۰ دقیقه</b> برای اولین راه‌اندازی Windows صبر کنید. ⚠️ <b>رمز عبور خود را همین الان ذخیره کنید</b> — بعداً قابل بازیابی نیست (در صورت فراموشی از «بازنشانی رمز» در مدیریت RDP استفاده کنید).`
 : `\n⏱ <b>۲ تا ۵ دقیقه</b> برای راه‌اندازی اولیه صبر کنید. ⚠️ <b>اطلاعات ورود خود را در جای امنی ذخیره کنید.</b>`

 return `<strong>🎉 ${isRDP ? 'RDP' : 'VPS'} [${response.label}] is active!</strong>

<strong>🔑 Login Credentials:</strong>
 <strong>• IP:</strong> <code>${response.host}</code>
<strong>• سیستم‌عامل:</strong> ${vpsDetails.os ? vpsDetails.os.name : (isRDP ? 'Windows Server' : 'Linux')}
 <strong>• Username:</strong> <code>${credentials.username}</code>
 <strong>• Password:</strong> <tg-spoiler><code>${credentials.password}</code></tg-spoiler> (برای مشاهده و کپی لمس کنید)

${connectInfo}
${readinessNote}

${CHAT_BOT_NAME}`
 },
 vpsHourlyPlanRenewed: (vpsName, price) => `
پلن VPS شما برای سرویس ${vpsName} با موفقیت تمدید شد.
${price}$ از کیف پول شما کسر شد.`,

 vpsMonthlyPlanRenewed: (vpsName, planPrice) =>
 `✅ VPS <b>${vpsName}</b> شما به مدت ۱ ماه به‌صورت خودکار تمدید شد.\n💰 $${planPrice} از کیف پول کسر شد.`,

 vpsExpiredNoAutoRenew: (vpsName) =>
 `⚠️ VPS <b>${vpsName}</b> شما منقضی شده است. تمدید خودکار غیرفعال است.\nلطفاً برای ادامه سرویس به‌صورت دستی تمدید کنید.`,

 bankPayVPS: (
 priceNGN,
 plan,
 ) => `لطفاً مبلغ ${priceNGN} NGN را با کلیک روی دکمه «پرداخت» واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن ${plan} VPS شما بدون وقفه فعال می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 askAutoRenewal: `🔄 آیا می‌خواهید تمدید خودکار را برای سرویس بدون وقفه فعال کنید؟
 
🛑 قبل از تمدید یک یادآوری دریافت خواهید کرد. می‌توانید این گزینه را هر زمان غیرفعال کنید.`,
 enable: '✅ فعال‌سازی',
 skipAutoRenewalWarming: expiresAt =>
 `⚠️ VPS شما در تاریخ ${new Date(expiresAt).toLocaleDateString('en-GB').replace(/\//g, '-')} ساعت ${new Date(
 expiresAt,
 ).toLocaleTimeString('en-GB', {
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
 })} منقضی می‌شود و ممکن است سرویس قطع شود.`,

 generateSSHKeyBtn: '✅ ایجاد کلید جدید',
 linkSSHKeyBtn: '🗂️ اتصال کلید موجود',
 skipSSHKeyBtn: '❌ رد کردن (ورود با رمز عبور)',
 noExistingSSHMessage:
 '🔑 هیچ کلید SSH‌ای یافت نشد. آیا می‌خواهید یک کلید SSH جدید برای دسترسی امن ایجاد کنید، یا از ورود با رمز عبور (کمتر امن) استفاده کنید؟',
 existingSSHMessage: '🔑 شما کلیدهای SSH موجود دارید. یک گزینه را انتخاب کنید:',
 confirmSkipSSHMsg: `⚠️ هشدار: ورود با رمز عبور کمتر امن است و در برابر حملات آسیب‌پذیر می‌باشد.
🔹 استفاده از کلیدهای SSH را توصیه می‌کنیم. آیا مطمئن هستید که می‌خواهید ادامه دهید؟`,
 confirmSkipSSHBtn: '✅ ادامه به هر حال',
 setUpSSHBtn: '🔄 راه‌اندازی کلید SSH',
 sshLinkingSkipped: '❌ اتصال کلید SSH لغو شد. هیچ تغییری اعمال نشد.',
 newSSHKeyGeneratedMsg: name => `✅ کلید SSH (${name}) ایجاد شد.
⚠️ این کلید را در جای امنی ذخیره کنید – بعداً نیز قابل بازیابی است.`,
 selectSSHKey: '🗂️ یک کلید SSH موجود برای اتصال به VPS خود انتخاب کنید:',
 uploadNewKeyBtn: '➕ آپلود کلید جدید',
 cancelLinkingSSHKey: `❌ اتصال کلید SSH لغو شد. هیچ تغییری اعمال نشد.`,
 selectValidSShKey: 'لطفاً یک کلید SSH معتبر از لیست انتخاب کنید.',
 sshKeySavedForVPS: name => `✅ کلید SSH ( ${name} ) به VPS جدید متصل خواهد شد.`,
 askToUploadSSHKey: `📤 کلید عمومی SSH خود را (فایل .pub) آپلود کنید یا کلید را در زیر paste کنید.`,
 failedGeneratingSSHKey: 'ایجاد کلید SSH جدید با شکست مواجه شد. لطفاً دوباره امتحان کنید یا روش دیگری را انتخاب کنید.',
newSSHKeyUploadedMsg: name => `✅ کلید SSH (${name}) با موفقیت آپلود شد و به VPS متصل خواهد شد.`,
 fileTypePub: 'نوع فایل باید .pub باشد',

 // VPS Management
 vpsList: list => `<strong>🖥️ سرورهای شما:</strong>

${list
 .map(vps => `<strong>• ${vps.isRDP || vps.osType === 'Windows' ? '🪟' : '🐧'} ${vps.name}</strong> <i>(${vps.isRDP || vps.osType === 'Windows' ? 'Windows RDP' : 'Linux VPS'})</i> — ${String(vps.status || '').toUpperCase() === 'RUNNING' ? '🟢' : '🔴'} ${vps.status}`)
 .join('\n')}
`,
 noVPSfound: 'هنوز سروری ندارید. یک 🐧 Linux VPS یا یک 🪟 Windows RDP در زیر ایجاد کنید.',
 selectCorrectOption: 'لطفاً یک گزینه از لیست انتخاب کنید',
 selectedVpsData: data => {
   const isRDP = !!(data.isRDP || data.osType === 'Windows')
   const port = isRDP ? 3389 : 22
   const loginUser = data.defaultUser || (isRDP ? 'Administrator' : 'root')
   const running = String(data.status || '').toUpperCase() === 'RUNNING'
   const months = Number(data.durationMonths) || 1
   const panelLine = isRDP ? '' : `\n<strong>• پنل کنترل:</strong> ${data.cPanelPlanDetails && data.cPanelPlanDetails.type ? data.cPanelPlanDetails.type : 'ندارد'}`
   const billingLine = isRDP ? `\n<strong>• صورت‌حساب:</strong> ${months === 1 ? 'ماهانه' : `${months} ماه (پیش‌پرداخت)`} · لایسنس Windows شامل می‌شود` : ''
   return `<strong>${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'}:</strong> ${data.name}

<strong>• پلن:</strong> ${data.planDetails.name}
<strong>• vCPUs:</strong> ${data.planDetails.specs.vCPU} | RAM: ${data.planDetails.specs.RAM} GB | Disk: ${
   data.planDetails.specs.disk
 } GB (${data.diskTypeDetails.type})${data.hardware ? `\n<strong>• سخت‌افزار:</strong> ${data.hardware}` : ''}
<strong>• سیستم‌عامل:</strong> ${data.osDetails.name}${panelLine}${billingLine}
<strong>• وضعیت:</strong> ${running ? '🟢' : '🔴'} ${data.status}
<strong>• تمدید خودکار:</strong> ${data.autoRenewable ? 'فعال' : 'غیرفعال'}

<b>🔌 نحوه اتصال</b>
<strong>• آدرس IP:</strong> <code>${data.host}</code>
<strong>• ${isRDP ? 'پورت RDP' : 'پورت SSH'}:</strong> <code>${port}</code>
<strong>• نام کاربری:</strong> <code>${loginUser}</code>${
   isRDP
     ? `
<strong>• دسکتاپ از راه دور:</strong> <code>${data.host}:${port}</code>`
     : `
<strong>• دستور:</strong> <code>ssh ${loginUser}@${data.host} -p ${port}</code>`
 }

🔑 رمز عبور خود را فراموش کرده‌اید؟ روی <b>بازنشانی رمز عبور</b> بزنید — روی سرور در حال اجرا اعمال می‌شود و داده‌های شما حفظ خواهند شد.`
 },
 stopVpsBtn: '⏹️ توقف',
 startVpsBtn: '▶️ شروع',
 restartVpsBtn: '🔄 راه‌اندازی مجدد',
 deleteVpsBtn: '🗑️ حذف',
 subscriptionBtn: '🔄 اشتراک‌ها',
 VpsLinkedKeysBtn: '🔑 کلیدهای SSH',
 resetPasswordBtn: '🔑 بازنشانی رمز عبور',
 revealPasswordBtn: '🔐 نمایش رمز عبور',
 revealPasswordChecking: name => `🔐 در حال جستجوی رمز عبور فعلی برای <strong>${name}</strong>...

⏱️ فقط چند ثانیه — ما همچنین ورود را برای شما آزمایش می‌کنیم.`,

 revealPasswordSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const v = opts.verification || null
   let statusLine = ''
if (v && v.status === 'ok') {
     statusLine = '\n✅ <b>ما همین الان با این رمز عبور وارد شدیم — کار می‌کند.</b>'
   } else if (v && v.status === 'password_wrong') {
     statusLine = '\n⚠️ <b>این رمز عبور توسط سرور شما رد شد.</b> روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید تا یک رمز جدید تنظیم کنید — فوری اعمال می‌شود و داده‌های شما حفظ می‌شوند.'
   } else if (v && v.status === 'password_auth_disabled') {
     statusLine = '\n⚠️ <b>سرور شما در حال حاضر ورود با رمز عبور را رد می‌کند</b> (فقط کلید SSH). روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید — این ورود با رمز عبور را مجدداً فعال کرده و یک رمز جدید به شما می‌دهد.'
   } else if (v && v.status === 'unreachable') {
     statusLine = '\n💤 نتوانستیم به سرور شما دسترسی پیدا کنیم تا این رمز عبور را آزمایش کنیم. اگر کار نکرد، روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید.'
   }
   const recoveredLine = opts.recovered
     ? '\n\n♻️ <i>از تنظیمات اولیه سرور شما بازیابی شد — ذخیره شده تا دفعه بعد فوری بارگذاری شود.</i>'
     : ''
   const rdpLine = opts.rdpState === 'confirmed' ? '\n✅ <b>RDP شما تأیید کرد که این رمز عبور تنظیم شده است.</b>'
     : opts.rdpState === 'applying' ? `\n⏳ <b>ویندوز هنوز در حال راه‌اندازی است</b> — این رمز عبور پس از اتمام راه‌اندازی کار می‌کند${opts.etaMinutes ? ` (حدود ${opts.etaMinutes} دقیقه)` : ''}. بعداً دوباره امتحان کنید.`
     : opts.rdpState === 'boot' ? '\nℹ️ <b>رمز عبور جدید از نصب مجدد شما قابل اعمال نبود</b>، بنابراین ویندوز همچنان از این رمز استفاده می‌کند. اگر رمز جدیدی می‌خواهید روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید.'
     : ''
   return `🔐 <strong>رمز عبور فعلی VPS</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'سرور'}:</strong> ${name}
🌐 <strong>IP:</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'پورت RDP' : 'پورت SSH'}:</strong> <code>${port}</code>
👤 <strong>نام کاربری:</strong> <code>${username}</code>
🔑 <strong>رمز عبور:</strong> <code>${password}</code>

📋 <strong>اتصال:</strong> <code>${isRDP ? `${ip}:${port}` : `ssh ${username}@${ip} -p ${port}`}</code>${statusLine}${rdpLine}${recoveredLine}

💡 روی رمز عبور کلیک کنید تا کپی شود. آن را محرمانه نگه دارید — هر کسی که آن را داشته باشد دسترسی کامل دارد.`
 },

 revealPasswordNotApplied: name => `🔐 <strong>رمز عبور نیاز به تنظیم مجدد دارد</strong>

ویندوز روی <strong>${name}</strong> راه‌اندازی شد، اما رمز عبور ذخیره‌شده نتوانست روی آن اعمال شود — بنابراین کار نمی‌کند.

✅ <strong>چه باید کرد:</strong> روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید. در عرض حدود یک دقیقه یک رمز عبور کاملاً جدید روی RDP در حال اجرای شما تنظیم می‌کند — <b>فایل‌ها و داده‌های شما حفظ می‌شوند</b>.`,

 revealPasswordNotStored: (name, reason) => `🔐 <strong>رمز عبور در دسترس نیست</strong>

نتوانستیم رمز عبور فعلی <strong>${name}</strong> را بازیابی کنیم.

📋 <i>دلیل: ${reason || 'رمز عبوری برای این سرور ذخیره نشده است'}</i>

✅ <strong>چه باید کرد:</strong> روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید. در عرض حدود یک دقیقه یک رمز عبور کاملاً جدید روی سرور <b>در حال اجرای</b> شما تنظیم می‌کند — <b>فایل‌ها و داده‌های شما حفظ می‌شوند</b> — و رمز عبور جدید را اینجا نشان می‌دهیم و تأیید می‌کنیم که کار می‌کند.`,

 revealPasswordFailed: name => `❌ <strong>رمز عبور پیدا نشد</strong>

هنگام دریافت رمز عبور برای <strong>${name}</strong> مشکلی پیش آمد.

لطفاً لحظه‌ای دیگر دوباره امتحان کنید، یا روی <b>🔑 تنظیم مجدد رمز عبور</b> ضربه بزنید تا یک رمز جدید تنظیم کنید.`,

 reinstallWindowsBtn: '🔄 نصب مجدد ویندوز',
 confirmChangeBtn: '✅ تأیید',

 confirmStopVpstext: name => `⚠️ آیا مطمئن هستید که می‌خواهید VPS <strong>${name}</strong> را متوقف کنید؟`,
 vpsBeingStopped: name => `⚙️ لطفاً صبر کنید در حالی که VPS شما (${name}) در حال توقف است`,
 vpsStopped: name => `✅ VPS (${name}) متوقف شد.`,
 failedStoppingVPS: name => `❌ توقف VPS (${name}) ناموفق بود. 

لطفاً کمی بعد دوباره امتحان کنید.`,
 vpsBeingStarted: name => `⚙️ لطفاً صبر کنید در حالی که VPS شما (${name}) در حال راه‌اندازی است`,
 vpsStarted: name => `✅ VPS (${name}) اکنون در حال اجرا است.`,
failedStartedVPS: name => `❌ راه‌اندازی VPS (${name}) با شکست مواجه شد. 

لطفاً پس از مدتی دوباره تلاش کنید.`,
 vpsBeingRestarted: name => `⚙️ لطفاً صبر کنید تا VPS (${name}) ری‌استارت شود`,
 vpsRestarted: name => `✅ VPS (${name}) با موفقیت ری‌استارت شد.`,
 failedRestartingVPS: name => `❌ ری‌استارت VPS (${name}) با شکست مواجه شد. 

لطفاً پس از مدتی دوباره تلاش کنید.`,
 confirmDeleteVpstext: name =>
 `⚠️ هشدار: حذف این VPS ${name} دائمی است و تمام داده‌ها از بین خواهند رفت.
 • هیچ استردادی برای زمان اشتراک استفاده‌نشده انجام نمی‌شود.
 • تمدید خودکار لغو می‌شود و هیچ هزینه‌ای دیگر اعمال نخواهد شد.

آیا می‌خواهید ادامه دهید؟`,
 
 // آگاه از ارائه‌دهنده: DigitalOcean/Azure/Contabo-root رمز را روی سرور
 // در حال اجرا اعمال می‌کنند (هیچ چیز پاک نمی‌شود)، در حالی که Vultr/OVH/Contabo-non-root فقط می‌توانند
 // نصب مجدد کنند. هرگز وعده «داده‌های شما حفظ می‌شود» ندهید مگر اینکه واقعاً درست باشد.
 confirmResetPasswordText: (name, impact = {}) => {
   const mode = impact.mode || 'in-place'
   const head = `🔑 <strong>بازنشانی رمز عبور ${impact.isRDP ? 'RDP' : 'VPS'}</strong>

🖥️ <strong>سرور:</strong> ${name}
`
   const nudge = `
💡 <i>فقط رمز عبور را فراموش کرده‌اید؟ روی ❌ انصراف بزنید ← <b>🔐 نمایش رمز عبور</b> — نیازی به بازنشانی نیست.</i>

بازنشانی رمز عبور برای <strong>${name}</strong>؟`

   if (mode === 'reinstall') return head + `
⚠️ <strong>این عمل سرور را پاک می‌کند.</strong> این ارائه‌دهنده نمی‌تواند رمز عبور را روی دستگاه در حال اجرا تغییر دهد، بنابراین سیستم‌عامل دوباره نصب می‌شود — تمام فایل‌ها، وب‌سایت‌ها، پایگاه‌های داده و تنظیمات برای همیشه حذف می‌شوند.

• یک نصب تازه با رمز عبور جدید دریافت می‌کنید
• رمز عبور فعلی شما دیگر کار نخواهد کرد
• 💾 اگر به داده‌ها نیاز دارید، ابتدا یک پشتیبان/اسنپ‌شات تهیه کنید
` + nudge

   if (mode === 'rebuild-emailed') return head + `
⚠️ <strong>این عمل سرور را پاک می‌کند</strong> و رمز عبور جدید توسط ارائه‌دهنده <b>از طریق ایمیل ارسال می‌شود</b> — ما نمی‌توانیم آن را اینجا به شما نشان دهیم.

• سیستم‌عامل بازسازی می‌شود: تمام فایل‌ها و داده‌ها برای همیشه حذف می‌شوند
• ارائه‌دهنده رمز عبور جدید را به حساب میزبانی ایمیل می‌کند (~۵ دقیقه)
• برای دسترسی فوری، از کلید SSH خود استفاده کنید
` + nudge

   return head + `
✅ <strong>داده‌های شما حفظ می‌شوند.</strong> هیچ چیز پاک نمی‌شود — فایل‌ها، وب‌سایت‌ها، پایگاه‌های داده و تنظیمات شما دقیقاً همان‌طور باقی می‌مانند. ما فقط رمز عبور ورود را روی سرور <b>در حال اجرا</b> تغییر می‌دهیم (بدون نصب مجدد، بدون ری‌استارت).

• یک رمز عبور کاملاً جدید تولید شده و همین‌جا به شما نشان داده می‌شود
• ما آن را اعمال می‌کنیم، سپس با آن وارد می‌شویم تا تأیید کنیم که کار می‌کند
• رمز عبور فعلی شما دیگر کار نخواهد کرد
• ⏱️ حدود ۲۰ تا ۶۰ ثانیه طول می‌کشد
` + nudge
 },

 confirmReinstallWindowsText: name => `🔄 <strong>نصب مجدد Windows</strong>

⚠️ <strong>هشدار بحرانی:</strong>
• این عمل تمام داده‌های RDP شما را پاک خواهد کرد
• تمام فایل‌ها، برنامه‌ها و تنظیمات حذف خواهند شد
• یک نصب جدید ویندوز ایجاد خواهد شد
• اطلاعات ورود جدید تولید خواهد شد
• رمز عبور قدیمی شما دیگر کار نخواهد کرد

💾 <strong>توصیه:</strong> قبل از ادامه یک پشتیبان/اسنپ‌شات ایجاد کنید.

آیا می‌خواهید ویندوز را روی <strong>${name}</strong> مجدداً نصب کنید؟`,

 passwordResetInProgress: (name, impact = {}) => `🔄 در حال بازنشانی رمز عبور برای <strong>${name}</strong>...

⏱️ این معمولاً ۲۰ تا ۶۰ ثانیه طول می‌کشد. لطفاً صبر کنید.${
   (impact.mode || 'in-place') === 'in-place'
     ? `

🔒 <i>رمز عبور جدید روی سرور در حال اجرای شما اعمال می‌شود — داده‌های شما دست نخورده باقی می‌مانند.</i>`
    : ''
 }`,

 passwordResetSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   // `dataPreserved` is true whenever the provider applied the password on the
   // سرور در حال اجرا (مسیر DigitalOcean/SSH) به جای نصب مجدد آن.
   const dataPreserved = opts.dataPreserved !== false
   return `✅ <strong>بازنشانی رمز عبور موفق بود!</strong>

🖥️ <strong>${isRDP ? 'RDP' : 'سرور'}:</strong> ${name}
🌐 <strong>آی‌پی:</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'پورت RDP' : 'پورت SSH'}:</strong> <code>${port}</code>
👤 <strong>نام کاربری:</strong> <code>${username}</code>
🔑 <strong>رمز عبور جدید:</strong> <code>${password}</code>
${isRDP ? `\n📋 <strong>اتصال:</strong> <code>${ip}:${port}</code>` : `\n📋 <strong>اتصال:</strong> <code>ssh ${username}@${ip} -p ${port}</code>`}
${opts.verified ? '\n✅ ما با این رمز عبور وارد شدیم تا تأیید کنیم که کار می‌کند.' : ''}
${dataPreserved
   ? '💾 <strong>داده‌های شما دست نخورده باقی ماند</strong> — رمز عبور روی سرور در حال اجرا تغییر کرد.'
   : '⚠️ <strong>سیستم‌عامل مجدداً نصب شد</strong>، بنابراین داده‌های قبلی روی سرور از بین رفته است.'}

⚠️ <strong>رمز عبور قدیمی شما دیگر کار نمی‌کند.</strong>

🔐 بعداً این رمز را گم کردید؟ روی <b>نمایش رمز عبور</b> در VPS خود ضربه بزنید — می‌توانید آن را هر زمان جستجو کنید، بدون نیاز به بازنشانی.

💡 روی رمز عبور کلیک کنید تا کپی شود.`
 },

 passwordResetEmailed: (name, ip, username, note) => `✅ <strong>بازنشانی رمز عبور آغاز شد!</strong>

🖥️ <strong>Server:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>Username:</strong> ${username}

📧 ${note || 'یک رمز عبور جدید توسط ارائه‌دهنده به ایمیل حساب ارسال شده است (~۵ دقیقه).'}

🔑 <strong>برای دسترسی فوری، از کلید SSH خود استفاده کنید.</strong>

⚠️ <i>توجه: با این ارائه‌دهنده به دلایل امنیتی نمی‌توانیم رمز عبور را اینجا نمایش دهیم — رمز توسط ارائه‌دهنده ایمیل می‌شود یا با کلید SSH احراز هویت می‌کنید.</i>`,

 // سرور آنلاین است اما پورت SSH 22 توسط فایروال (ufw) روی خود سرور بسته شده است.
 // بازنشانی رمز عبور تا زمان باز شدن مجدد پورت کمکی نمی‌کند، پس کاربر را راهنمایی کنید.
 vpsSshBlockedHelp: (name, ip, username = 'root') => `🟠 <strong>Your VPS is online — but SSH is blocked</strong>

🖥️ <strong>Server:</strong> ${name}
🌐 <strong>IP:</strong> <code>${ip}</code>

ما به سرور شما دسترسی داشتیم (در حال اجراست)، اما <b>پورت 22 (SSH) توسط فایروال داخل سرور بسته است</b>. به همین دلیل ورود و بازنشانی رمز عبور کار نمی‌کند — هیچ رمزی نمی‌تواند از یک پورت بسته عبور کند.

✅ <strong>چگونه آن را دوباره باز کنید (۲ دقیقه):</strong>
1. <b>Recovery / Web Console</b> ارائه‌دهنده‌تان را برای این سرور باز کنید (بدون نیاز به SSH).
2. Log in as <code>${username}</code>.
3. اجرا کنید: <code>ufw allow OpenSSH</code>  (یا <code>ufw allow 22/tcp</code>)
4. سپس اجرا کنید: <code>ufw reload</code>

پس از باز شدن پورت 22، برگردید و روی <b>🔑 بازنشانی رمز عبور</b> ضربه بزنید — ما یک رمز تازه روی سرور در حال اجرا تنظیم می‌کنیم و تأیید می‌کنیم که کار می‌کند، با حفظ اطلاعات شما.

💬 گیر کردید؟ روی <b>💬 پشتیبانی</b> ضربه بزنید تا ما آن را برایتان باز کنیم.`,

 windowsReinstallEmailed: (name, ip, username, note) => `🎉 <strong>نصب مجدد Windows شروع شد!</strong>

🖥️ <strong>RDP:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>Username:</strong> ${username}

⏱️ این فرآیند ۵ تا ۱۰ دقیقه طول می‌کشد. ${note || 'رمز عبور جدید Administrator توسط ارائه‌دهنده به ایمیل حساب ارسال خواهد شد.'}

⚠️ تمام داده‌های قبلی پاک شده‌اند — این یک نصب تازه Windows است.`,

 windowsReinstallInProgress: name => `🔄 در حال نصب مجدد Windows روی <strong>${name}</strong>...

⏱️ این فرآیند ۵ تا ۱۰ دقیقه طول می‌کشد. 
📧 پس از اتمام، اطلاعات ورودی جدید را دریافت خواهید کرد.`,

windowsReinstallSuccess: (name, ip, username, password) => `🎉 <strong>ویندوز با موفقیت نصب مجدد شد!</strong>

🖥️ <strong>RDP:</strong> ${name}
🌐 <strong>IP:</strong> ${ip}
👤 <strong>نام کاربری:</strong> ${username}
🔑 <strong>رمز عبور:</strong> <code>${password}</code>

⚠️ <strong>مهم - همین الان رمز عبور را ذخیره کنید!</strong>
• ما به دلایل امنیتی <strong>قادر به بازیابی</strong> آن نخواهیم بود
• تمام اطلاعات قبلی پاک شده است
• این یک نصب جدید ویندوز است
• اگر رمز عبور را فراموش کردید، باید آن را بازنشانی کنید (از دکمه «بازنشانی رمز عبور» استفاده کنید)

💡 روی رمز عبور کلیک کنید تا کپی شود.
🚀 RDP شما با این اطلاعات ورود جدید آماده استفاده است!`,

 passwordResetFailed: name => `❌ <strong>بازنشانی رمز عبور ناموفق بود</strong>

بازنشانی رمز عبور برای <strong>${name}</strong> انجام نشد.

لطفاً چند دقیقه دیگر دوباره امتحان کنید یا در صورت ادامه مشکل با پشتیبانی تماس بگیرید.`,

 windowsReinstallFailed: name => `❌ <strong>نصب مجدد Windows ناموفق بود</strong>

نصب مجدد Windows روی <strong>${name}</strong> انجام نشد.

لطفاً چند دقیقه دیگر دوباره امتحان کنید یا در صورت ادامه مشکل با پشتیبانی تماس بگیرید.`,

 rdpNotSupported: `⚠️ این ویژگی فقط برای نمونه‌های Windows RDP در دسترس است.

VPS شما روی لینوکس اجرا می‌شود. به جای آن از کلیدهای SSH برای مدیریت دسترسی استفاده کنید.`,

 // ── DigitalOcean Windows RDP: duration + edition pickers, in-place reinstall ──
 rdpDurationBtn: c => (Number(c.period) === 1 ? `1 ماه — $${c.price}` : `${c.period} ماه — $${c.price}${c.discountPct ? ` (صرفه‌جویی ${c.discountPct}%)` : ''}`),
 askRdpDuration: (config, cycles) => `📅 <strong>چه مدت می‌خواهید پیش‌پرداخت کنید؟</strong>

<strong>${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB NVMe
${cycles.map(c => {
  const per = Number(c.period) || 1
  const base = (Number(config.monthlyPrice) || 0) * per
  const save = per > 1 && base > 0 && Number(c.price) < base ? Math.round((1 - Number(c.price) / base) * 100) : 0
  return `• ${per === 1 ? '1 ماه' : `${per} ماه`} — <b>$${c.price}</b>${save > 0 ? ` <i>(صرفه‌جویی ${save}%)</i>` : ''}`
}).join('\n')}

دوره‌های طولانی‌تر یک‌جا پرداخت می‌شوند و شامل تخفیف بسته می‌شوند؛ تمدید خودکار همان دوره را مجدداً شارژ می‌کند.`,
 rdpEditionBtn: o => `🪟 ${o.name} ${o.fast_deploy ? '⚡' : '⏳'} ~${o.eta_minutes || (o.fast_deploy ? 3 : 45)} دقیقه`,
 askRdpEdition: options => `🪟 <strong>نسخه ویندوز خود را انتخاب کنید</strong>

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ آماده در حدود ${o.eta_minutes || 3} دقیقه (تصویر پیش‌ساخته در منطقه شما)` : '⏳ نصب کامل، حدود ۴۵ دقیقه'}`).join('\n')}

تمام نسخه‌ها Windows Server Standard (Desktop Experience) با RDP فعال و حساب Administrator هستند.`,
 askReinstallEdition: (name, options) => `🔄 <strong>نصب مجدد ویندوز روی ${name}</strong>

نسخه‌ای را برای نصب انتخاب کنید. آدرس IP شما ثابت می‌ماند.

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ حدود ${o.eta_minutes || 3} دقیقه` : (o.copy_first ? `⏳ حدود ${o.eta_minutes} دقیقه (تصویر ابتدا به دیتاسنتر سرور شما کپی می‌شود)` : '⏳ حدود ۴۵ دقیقه')}`).join('\n')}`,
 confirmReinstallWindowsRdpText: (name, osName, etaMin, copyFirst) => `🔄 <strong>نصب مجدد ${osName} روی ${name}</strong>

⚠️ <strong>هشدار — این عمل دیسک را پاک می‌کند:</strong>
• تمام فایل‌ها، برنامه‌ها و تنظیمات سرور حذف می‌شوند
• یک نسخه تازه ${osName} از تصویر پیش‌ساخته ما نصب می‌شود (~${etaMin} دقیقه)${copyFirst ? `\n• ابتدا تصویر به دیتاسنتر سرور شما کپی می‌شود (~۲۰ دقیقه) — سرور شما تا آن زمان بدون تغییر به کار ادامه می‌دهد` : ''}
• یک رمز عبور Administrator جدید تولید می‌شود — رمز قدیمی دیگر کار نمی‌کند
• ✅ آدرس IP و دوره پرداختی شما حفظ می‌شوند

آیا می‌خواهید ادامه دهید؟`,
 windowsReinstallStarted: (name, ip, username, password, osName, etaMin) => `🔄 <strong>نصب مجدد ${osName} روی ${name}</strong>

🌐 <strong>IP:</strong> <code>${ip || 'بدون تغییر'}</code>
👤 <strong>نام کاربری:</strong> ${username}
🔑 <strong>رمز عبور جدید:</strong> <code>${password}</code>

⏱️ ویندوز در حال نصب است — در حدود <b>${etaMin} دقیقه</b> با این اطلاعات متصل شوید.
💡 روی رمز عبور بزنید تا کپی شود. همیشه می‌توانید با 🔐 نمایش رمز عبور آن را دوباره ببینید.`,
 rdpActionReason: reason => `\n\n<i>دلیل: ${reason}</i>`,
 // ── DigitalOcean Linux VPS: reinstall any OS from DigitalOcean's live list (IP + login kept) ──
 reinstallOsBtn: '🔄 نصب مجدد سیستم‌عامل',
 linuxOsBtn: o => `${o.current ? '✅ ' : ''}🐧 ${o.name}${o.requiresSshKey ? ' 🔑' : ''}`,
 askReinstallLinuxOs: (name, options) => `🔄 <b>نصب مجدد سیستم‌عامل روی ${name}</b>

سیستم مورد نظر برای نصب را انتخاب کنید. ✅ = نصب فعلی. 🔑 = به کلید SSH که سرور شما از قبل دارد نیاز دارد.
آدرس IP، رمز root و کلید SSH شما ثابت می‌مانند.`,
 confirmReinstallLinuxText: (name, osName) => `🔄 <b>نصب مجدد ${osName} روی ${name}</b>

⚠️ <b>هشدار — این عمل دیسک را پاک می‌کند:</b>
• تمام فایل‌ها، برنامه‌ها و تنظیمات سرور حذف می‌شوند
• یک نسخه تازه ${osName} نصب می‌شود (~۳ دقیقه)
• ✅ آدرس IP، رمز root، کلید SSH و دوره پرداختی شما حفظ می‌شوند

آیا می‌خواهید ادامه دهید؟`,
 linuxReinstallStarted: (name, osName, etaMin) => `🔄 <b>نصب مجدد ${osName} روی ${name}</b>

⏱️ ظرف حدود <b>${etaMin} دقیقه</b> آماده می‌شود. آدرس IP، رمز عبور root و کلید SSH شما تغییر نمی‌کنند.
به محض آنلاین شدن، اطلاعات ورود را برای شما ارسال می‌کنیم.`,
 linuxReinstallDone: (name, ip, username, password, osName) => `✅ <b>${osName} روی ${name} آماده است</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>Username:</b> ${username}
🔑 <b>Password:</b> <code>${password}</code> (unchanged)

💡 کلید SSH شما نیز کار می‌کند. همیشه می‌توانید رمز عبور را با 🔐 نمایش رمز عبور دوباره مشاهده کنید.`,
 linuxReinstallDoneNoPassword: (name, ip, username, osName) => `✅ <b>${osName} روی ${name} آماده است</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>Username:</b> ${username}

🔑 با کلید SSH خود وارد شوید، یا روی 🔐 نمایش رمز عبور / 🔄 بازنشانی رمز عبور ضربه بزنید.`,
 linuxReinstallDoneUnverified: (name, ip, username, osName) => `✅ <b>${osName} روی ${name} مجدداً نصب شده است</b>

🌐 <b>IP:</b> <code>${ip}</code>
👤 <b>Username:</b> ${username}

⚠️ هنوز نتوانستیم رمز عبور شما را تأیید کنیم. کلید SSH شما کار می‌کند؛ در غیر این صورت چند دقیقه دیگر روی 🔐 نمایش رمز عبور یا 🔄 بازنشانی رمز عبور ضربه بزنید. تیم ما مطلع شده است.`,
 linuxReinstallFailed: name => `❌ <b>نصب مجدد ناموفق بود</b>

نتوانستیم <b>${name}</b> را مجدداً نصب کنیم. هیچ تغییری اعمال نشد. لطفاً چند دقیقه دیگر دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.`,
 linuxReinstallNeedsKey: name => `🔑 <b>این سیستم به کلید SSH نیاز دارد</b>

<b>${name}</b> بدون کلید SSH ایجاد شده، بنابراین Fedora، CentOS، AlmaLinux و Rocky Linux نمی‌توانند روی آن نصب شوند. به جای آن Ubuntu یا Debian را انتخاب کنید. هیچ تغییری اعمال نشد.`,
 windowsReinstallQueued: (name, osName, copyMin, etaMin) => `⏳ <b>نصب مجدد ${osName} روی ${name} در صف قرار گرفت</b>

تصویر ${osName} در حال کپی شدن به دیتاسنتر سرور شما است (~${copyMin} دقیقه). سرور شما تا آن زمان <b>بدون تغییر</b> به کار خود ادامه می‌دهد و رمز عبور فعلی همچنان معتبر است.

سپس نصب مجدد به صورت خودکار شروع می‌شود (دیسک پاک می‌شود، IP حفظ می‌شود) و <b>رمز عبور جدید</b> برای شما ارسال خواهد شد — تقریباً <b>${etaMin} دقیقه</b> دیگر آماده است.`,
 windowsReinstallCopyFailed: (name, osName) => `❌ <b>نصب مجدد ${osName} بر روی ${name} قادر به شروع نشد</b>

تصویر ویندوز نتوانست در دیتاسنتر سرور شما آماده شود. <b>هیچ تغییری اعمال نشده</b> — سرور و رمز عبور شما دقیقاً مثل قبل هستند. لطفاً بعداً دوباره امتحان کنید یا نسخه دیگری را انتخاب کنید. تیم ما مطلع شده است.`,
 vpsBeingDeleted: name => `⚙️ لطفاً صبر کنید در حالی که VPS شما (${name}) در حال حذف است`,
 vpsDeleted: name => `✅ VPS (${name}) به طور دائمی حذف شد.`,
 failedDeletingVPS: name => `❌ حذف VPS (${name}) با شکست مواجه شد.

لطفاً کمی بعد دوباره امتحان کنید.`,
 upgradeVpsBtn: '⬆️ Upgrade',
 doPlanOptionBtn: o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} ${o.name} · $${o.monthly_price_usd}/mo`,
 doPlanOptionsMsg: (cur, opts, days, hidden) => `🔄 <b>تغییر پلن</b> — در همان سرور اعمال می‌شود: داده‌ها، IP و تنظیمات شما حفظ می‌شوند.

<b>Current:</b> ${cur.name} (${cur.vcpus || '?'} vCPU · ${cur.ram_gb || '?'} GB RAM · ${cur.disk_gb} GB ${cur.storage_type}) — $${cur.monthly_price_usd}/mo
<b>روزهای باقی‌مانده در این دوره:</b> ${Math.floor(days)}

${opts.map(o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} <b>${o.name}</b> (${o.vcpus} vCPU/${o.ram_gb} GB/${o.disk_gb} GB ${o.storage_type}) $${o.monthly_price_usd}/mo${o.charge_now_usd > 0 ? ` · pay now $${o.charge_now_usd.toFixed(2)}` : ''}`).join('\n')}

💡 ارتقاء: فقط تفاوت قیمت برای روزهای باقی‌مانده پرداخت می‌کنید. تنزل: رایگان و فوری، بدون بازپرداخت برای این دوره. قیمت جدید از تمدید بعدی شما شروع می‌شود.${hidden ? `\n⚠️ ${hidden} پلن(های) کوچکتر پنهان شده‌اند: دیسک هرگز نمی‌تواند کوچک شود.` : ''}`,
 doPlanNoOptions: '⚠️ در حال حاضر هیچ پلن دیگری نمی‌تواند به این سرور اعمال شود (دیسک هرگز نمی‌تواند کوچک شود و برخی پلن‌ها ممکن است در این منطقه موجود نباشند).',
 doPlanUnavailable: code => ({
 expired: '⚠️ This server\'s term has ended. Renew it first, then change the plan.',
 term_ending_soon: '⚠️ کمتر از ۱ ساعت تا پایان دوره این سرور باقی مانده. ابتدا آن را تمدید کنید، سپس پلن را تغییر دهید.',
 not_active: '⚠️ این سرور فعال نیست، بنابراین در حال حاضر نمی‌توان پلن آن را تغییر داد.',
 plan_change_in_progress: '⏳ یک تغییر پلن در حال اجرا برای این سرور وجود دارد. پس از اتمام، پیامی دریافت خواهید کرد.',
 not_supported: '⚠️ تغییر پلن برای این سرور در دسترس نیست.',
 }[code] || '⚠️ تغییر پلن در حال حاضر برای این سرور در دسترس نیست. لطفاً بعداً دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.'),
 doPlanKeepDiskBtn: '💾 نگه داشتن دیسک فعلی (قابل بازگشت)',
doPlanGrowDiskBtn: gb => `📀 افزایش دیسک به ${gb} گیگابایت (دائمی)`,
 doPlanDiskAsk: (o, cur) => `💾 <b>اندازه دیسک</b>

${o.name} شامل یک دیسک ${o.disk_gb} گیگابایتی است. سرور شما ${cur.disk_gb} گیگابایت دارد.

• <b>نگه داشتن دیسک فعلی</b>: فقط CPU و RAM تغییر می‌کنند. بعداً می‌توانید به پلن کوچک‌تری برگردید.
• <b>افزایش دیسک به ${o.disk_gb} گیگابایت</b>: فضای بیشتر، اما <b>دائمی</b> است. سرور هرگز نمی‌تواند به پلنی با دیسک کوچک‌تر منتقل شود.`,
 doPlanSummary: (name, cur, o, grow, bal, end) => `<strong>📜 خلاصه تغییر پلن</strong>

<strong>• سرور:</strong> ${name}
<strong>• از:</strong> ${cur.name} ($${cur.monthly_price_usd} در ماه)
<strong>• به:</strong> ${o.name} ($${o.monthly_price_usd} در ماه)
<strong>• دیسک:</strong> ${grow ? `${o.disk_gb} گیگابایت (دائمی)` : `${cur.disk_gb} گیگابایت (بدون تغییر)`}
<strong>• پرداخت اکنون:</strong> $${o.charge_now_usd.toFixed(2)}${o.direction === 'upgrade' ? ' (تفاوت برای روزهای باقی‌مانده)' : ' (بدون بازپرداخت برای دوره جاری)'}
<strong>• تمدید بعدی:</strong> $${o.renewal_price_usd}${end ? ` در ${new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}
<strong>• موجودی کیف پول:</strong> $${Number(bal).toFixed(2)}

⏱ سرور راه‌اندازی مجدد می‌شود و حدود ${grow ? '۵ تا ۳۰' : '۲ تا ۵'} دقیقه آفلاین خواهد بود. داده‌ها، IP و تنظیمات حفظ می‌شوند.`,
 doPlanLowBalance: (bal, price) => `⚠️ موجودی کیف پول شما ($${Number(bal).toFixed(2)}) کمتر از $${Number(price).toFixed(2)} مورد نیاز برای این ارتقا است. لطفاً شارژ کنید و دوباره تلاش نمایید.`,
 doPlanStarted: (name, o, charged) => `⏳ <b>در حال تغییر ${name} به ${o.name}…</b>${charged > 0 ? `\n💳 $${Number(charged).toFixed(2)} از کیف پول شما کسر شد.` : ''}

سرور در حال راه‌اندازی مجدد است و چند دقیقه آفلاین خواهد بود. پس از اتمام به شما اطلاع می‌دهیم.`,
 doPlanDone: (name, c, r) => `✅ <b>${name} اکنون روی ${c.to.name} است</b>

دیسک: ${r && r.disk_gb ? r.disk_gb : '?'} گیگابایت · تمدید بعدی: $${c.to.renewal_price_usd}. سرور دوباره آنلاین است.`,
 doPlanFailed: (name, refund) => `❌ <b>تغییر پلن برای ${name} تکمیل نشد.</b> سرور شما روی پلن فعلی باقی می‌ماند${refund > 0 ? ` و $${Number(refund).toFixed(2)} به کیف پول شما بازگردانده شد` : ''}. لطفاً بعداً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.`,
 upgradeVpsPlanBtn: '⬆️ پلن VPS',
 upgradeVpsDiskBtn: '📀 نوع دیسک',
 upgradeVpsDiskTypeBtn: '💾 ارتقای نوع دیسک',
 upgradeVPS: 'نوع ارتقا را انتخاب کنید',
 upgradeOptionVPSBtn: to => {
 return `🔼 ارتقا به ${to}`
 },
 upgradeVpsPlanMsg: options => `⚙️ یک پلن جدید برای افزایش منابع VPS خود انتخاب کنید.
💡 ارتقا باعث افزایش vCPU، RAM و فضای ذخیره‌سازی می‌شود و قابل بازگشت نیست.

📌 ارتقاهای موجود:
${options
 .map(
 planDetails =>
 `<strong>• ${planDetails.from} ➡ ${planDetails.to} –</strong> $${planDetails.monthlyPrice} در ماه ($${planDetails.hourlyPrice} در ساعت)`,
 )
 .join('\n')}
 
💰 توجه صورت‌حساب: پلن فعلی شما برای روزهای استفاده‌نشده اعتبار می‌گیرد و نرخ جدید برای باقی‌مانده دوره صورت‌حساب اعمال می‌شود (تعدیل نسبی).`,

 alreadyEnterprisePlan:
 '⚠️ شما در حال حاضر روی بالاترین پلن موجود (Enterprise) هستید. هیچ ارتقای بیشتری امکان‌پذیر نیست.',

 alreadyHighestDisk: vpsData =>
 `⚠️ شما در حال حاضر روی بالاترین دیسک موجود (${vpsData.diskTypeDetails.type}) هستید. هیچ ارتقای بیشتری امکان‌پذیر نیست.`,
 newVpsDiskBtn: type => `ارتقا به ${type}`,
 upgradeVpsDiskMsg: upgrades => `💾 نوع فضای ذخیره‌سازی خود را برای عملکرد بهتر ارتقا دهید.
⚠️ ارتقای دیسک دائمی است و قابل بازگشت نیست.

📌 گزینه‌های موجود:
${upgrades.map(val => `<strong>• ${val.from} ➡ ${val.to} –</strong> +$${val.price}/${val.duration}`).join('\n')}
 
💰 توجه صورت‌حساب: در صورت اعمال ارتقا در میانه دوره، تعدیل نسبی برای بخش استفاده‌نشده دوره صورت‌حساب جاری اعمال خواهد شد.`,
 upgradePlanSummary: (newData, vpsDetails, lowBal) => `<strong>📜 خلاصه سفارش:</strong>

<strong>• VPS ID: </strong> ${vpsDetails.name}
<strong>• Old Plan: </strong> ${newData.upgradeOption.from}
<strong>• New Plan: </strong> ${newData.upgradeOption.to}
<strong>• Billing Cycle: </strong> ${newData.billingCycle}
<strong>• نرخ صورت‌حساب جدید: </strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/ساعت' : ' (تعدیل نسبی اعمال شده)'
 }
<strong>• تاریخ اجرا: </strong> فوری
${
 lowBal
 ? `
توجه: یک سپرده $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} دلاری در مجموع شما لحاظ شده است. پس از کسر اولین نرخ ساعتی، مانده سپرده به کیف پول شما اعتبار داده می‌شود.
`
 : ''
}
<strong>• قیمت کل: </strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ آیا با سفارش ادامه می‌دهید؟</strong>`,
 upgradeDiskSummary: (newData, vpsDetails, lowBal) => `<strong>📜 خلاصه سفارش:</strong>

<strong>• شناسه VPS: </strong> ${vpsDetails.name}
<strong>• نوع دیسک قدیمی: </strong> ${newData.upgradeOption.from}
<strong>• نوع دیسک جدید: </strong> ${newData.upgradeOption.to}
<strong>• چرخه صورتحساب: </strong> ${newData.billingCycle}
<strong>• نرخ صورتحساب جدید: </strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/ساعت' : ' (تعدیل تسهیم‌شده اعمال شد)'
 }
${
 lowBal
 ? `
توجه: یک سپرده $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} دلاری در مجموع شما لحاظ شده است. پس از کسر اولین نرخ ساعتی، مانده سپرده به کیف پول شما اعتبار داده می‌شود.
`
 : ''
}
<strong>• قیمت کل: </strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ آیا با سفارش ادامه می‌دهید?</strong>`,

 vpsSubscriptionData: (vpsData, planExpireDate, panelExpireDate) => {
 const isRDP = !!(vpsData.isRDP || vpsData.osType === 'Windows')
 const months = Number(vpsData.durationMonths) || 1
 const panel = isRDP ? '' : `\n<strong>• Control Panel ${vpsData?.cPanelPlanDetails ? vpsData.cPanelPlanDetails.type : ': Not Selected'} </strong> ${
 vpsData?.cPanelPlanDetails
 ? `${vpsData?.cPanelPlanDetails.status === 'active' ? '- Expires: ' : '- Expired: '}${panelExpireDate}`
: ''
 } `
 return `<strong>🗂️ اشتراک‌های فعال شما:</strong>

<strong>• ${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'} ${vpsData.name} </strong>– ${isRDP ? `${months === 1 ? 'ماهانه' : `${months} ماهه پیش‌پرداخت`} · ` : ''}انقضا: ${planExpireDate} (تمدید خودکار: ${
 vpsData.autoRenewable ? 'فعال' : 'غیرفعال'
 })${panel}`
 },

 manageVpsSubBtn: '📅 مدیریت اشتراک',
 manageVpsPanelBtn: '🛠️ مدیریت اشتراک کنترل پنل',

 vpsSubDetails: (data, date) => `<strong>📅 ${data.isRDP || data.osType === 'Windows' ? '🪟 Windows RDP' : '🐧 Linux VPS'} جزئیات اشتراک:</strong>

<strong>• سرور:</strong> ${data.name}
<strong>• Plan:</strong> ${data.planDetails.name}${data.isRDP || data.osType === 'Windows' ? `\n<strong>• Billing period:</strong> ${(Number(data.durationMonths) || 1) === 1 ? 'ماهانه' : `${data.durationMonths} ماه (پیش‌پرداخت)`}` : ''}
<strong>• تاریخ انقضای فعلی:</strong> ${date}
<strong>• Auto-Renewal:</strong> ${data.autoRenewable ? 'فعال' : 'غیرفعال'}`,

 vpsCPanelDetails: (data, date) => `<strong>📅 جزئیات اشتراک کنترل پنل:</strong>

<strong>• شناسه VPS مرتبط:</strong> ${data.name}
<strong>• نوع کنترل پنل:</strong> ${data.cPanelPlanDetails.type} (${data.cPanelPlanDetails.name})
<strong>• تاریخ انقضای فعلی:</strong> ${date}
<strong>• تمدید خودکار:</strong> ${data.autoRenewable ? 'فعال' : 'غیرفعال'}
`,

 vpsEnableRenewalBtn: '🔄 فعال‌سازی تمدید خودکار',
 vpsDisableRenewalBtn: '❌ غیرفعال‌سازی تمدید خودکار',
 vpsPlanRenewBtn: '📅 تمدید اکنون',
 unlinkVpsPanelBtn: '❌ جداکردن از VPS',
 bankPayVPSUpgradePlan: (priceNGN, vpsDetails) =>
 `لطفاً با کلیک روی «پرداخت» مبلغ ${priceNGN} NGN را واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن جدید VPS ${vpsDetails.upgradeOption.to} شما به‌طور یکپارچه فعال می‌شود.`,

 bankPayVPSUpgradeDisk: (priceNGN, vpsDetails) =>
 `لطفاً با کلیک روی «پرداخت» مبلغ ${priceNGN} NGN را واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن VPS شما با نوع دیسک جدید ${vpsDetails.upgradeOption.toType} به‌طور یکپارچه فعال می‌شود.`,

 showDepositCryptoInfoVpsUpgrade: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>مبلغ پرداختی: $${Number(priceUsd).toFixed(2)} USD</b>

دقیقاً <b>${priceCrypto} ${tickerView}</b> را به آدرس زیر ارسال کنید:

<code>${address}</code>

پلن ارتقایافته VPS شما پس از تأیید پرداخت (معمولاً ظرف چند دقیقه) به‌طور خودکار فعال می‌شود.

با احترام،
${CHAT_BOT_NAME}`,

 linkVpsSSHKeyBtn: '➕ افزودن کلید جدید',
 unlinkSSHKeyBtn: '❌ جداکردن کلید',
 downloadSSHKeyBtn: '⬇️ دانلود کلید',

 noLinkedKey: name => `⚠️ در حال حاضر هیچ کلید SSH‌ای با این VPS [${name}] مرتبط نیست. 
 
لطفاً یک کلید SSH به حساب خود متصل کنید تا دسترسی امن فعال شود.`,
 linkedKeyList: (list, name) => `🗂️ کلیدهای SSH متصل به VPS ${name}:

${list.map(val => `<strong>• ${val}</strong>`).join('\n')}`,

 unlinkSSHKeyList: name => `🗂️ یک کلید SSH را برای حذف از VPS [${name}] انتخاب کنید:`,
 confirmUnlinkKey: data => `⚠️ آیا مطمئن هستید که می‌خواهید [${data.keyForUnlink}] را از VPS [${data.name}] جدا کنید؟`,
 confirmUnlinkBtn: '✅ تأیید جداسازی',
 keyUnlinkedMsg: data => `✅ کلید SSH [${data.keyForUnlink}] از VPS [${data.name}] جدا شد.`,
 failedUnlinkingKey: data => `❌ جداسازی کلید SSH از VPS (${data.name}) با شکست مواجه شد. 

لطفاً کمی بعد دوباره امتحان کنید.`,

 userSSHKeyList: name => `🗂️ یک کلید SSH را برای اتصال به VPS [${name}] انتخاب کنید:`,
 noUserKeyList: `🔑 هیچ کلید SSH‌ای یافت نشد. آیا می‌خواهید یک کلید SSH جدید آپلود کنید؟`,
 linkKeyToVpsSuccess: (key, name) => `✅ کلید SSH [${key}] با موفقیت به VPS [${name}] متصل شد.`,
 failedLinkingSSHkeyToVps: (key, name) => `❌ اتصال کلید SSH [${key}] به VPS (${name}) با شکست مواجه شد. 

لطفاً کمی بعد دوباره امتحان کنید.`,
 selectSSHKeyToDownload: '🗂️ کلید SSH مورد نظر برای دانلود را انتخاب کنید:',
disabledAutoRenewal: (
 data,
 expiryDate,
 ) => `⚠️ تمدید خودکار غیرفعال شد. VPS شما در تاریخ ${expiryDate} منقضی می‌شود مگر اینکه به صورت دستی تمدید شود.
✅ تمدید خودکار با موفقیت غیرفعال شد.`,
 enabledAutoRenewal: (data, expiryDate) =>
 `✅ تمدید خودکار فعال شد. VPS شما به صورت خودکار در تاریخ ${expiryDate} تمدید خواهد شد.`,

 renewVpsPlanConfirmMsg: (data, vpsDetails, expiryDate, lowBal) => `<strong>📜 خلاصه فاکتور</strong>

<strong>• شناسه VPS:</strong> ${vpsDetails.name}
<strong>• پلن:</strong> ${vpsDetails.planDetails.name}
<strong>• دوره صورتحساب:</strong> ${vpsDetails.billingCycleDetails.type}
<strong>• تاریخ انقضای فعلی:</strong> ${expiryDate}
<strong>• مبلغ قابل پرداخت:</strong> ${data.totalPrice} USD

${
 lowBal
 ? `توجه: یک واریز $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD در مجموع شما لحاظ شده است. پس از کسر اولین نرخ ساعتی، مانده واریز به کیف پول شما اعتبار داده می‌شود.`
 : ''
}

<strong>• قیمت کل: </strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : data.totalPrice} USD

<strong>💳 آیا با تمدید VPS موافقید؟</strong>`,

 payNowBtn: '✅ پرداخت کن',

 vpsChangePaymentRecieved: `✅ پرداخت موفق! VPS شما در حال راه‌اندازی است. جزئیات به زودی در دسترس خواهد بود.`,
  planOutOfStock: (isRDP, region, suggestions = []) => `😔 <b>${isRDP ? 'Windows RDP' : 'VPS'} در حال حاضر در ${region} موجود نیست</b>\n\nسرورهای ${isRDP ? 'AMD' : ''} ما در آن شهر در حال حاضر کاملاً رزرو شده‌اند — هیچ مبلغی از شما <b>کسر نشده</b> است.${suggestions.length ? `\n\n✅ در حال حاضر موجود در:\n${suggestions.map(s => `• ${s}`).join('\n')}` : '\n\n⏳ لطفاً کمی بعد دوباره امتحان کنید.'}\n\nیک موقعیت دیگر را از زیر انتخاب کنید 👇`,
  stockNotifyBtn: '🔔 وقتی موجود شد به من اطلاع بده',
  stockNotifySaved: (isRDP, place, days) => `🔔 <b>انجام شد!</b> به محض اینکه ${isRDP ? 'Windows RDP' : 'VPS'} در ${place} قابل سفارش شود به شما پیام می‌دهیم.\n\n<i>این هشدار به مدت ${days} روز فعال می‌ماند.</i>`,
  stockBackInStock: (isRDP, place, planName) => `🟢 <b>موجود شد!</b>\n\n${isRDP ? 'Windows RDP' : 'VPS'}${planName ? ` <b>${planName}</b>` : ''} در ${place} دوباره قابل سفارش است.\n\nموجودی ممکن است سریع تمام شود — برای سفارش روی دکمه زیر بزنید.`,
  stockOrderNowBtn: '🛒 سفارش الان',
  rdpLateFailRefund: (amount, reason, balance, cities = []) => `❌ <b>Windows RDP شما راه‌اندازی نشد</b>\n\n${reason}\n\n✅ <b>$${amount} به کیف پول شما بازگردانده شد</b> (موجودی: $${balance}). سرور ناتمام حذف شد.${cities.length ? `\n\n🌍 در حال حاضر موجود در:\n${cities.map(c => `• ${c}`).join('\n')}` : ''}\n\nبرای سفارش مجدد در شهر دیگری روی دکمه زیر بزنید.`,
  rdpTryAnotherCityBtn: '🌍 شهر دیگری را امتحان کن',
  rdpFailReasons: { out_of_stock: 'DigitalOcean در حین ساخت سرور، ظرفیت AMD آن شهر را تمام کرد.', provisioning_timeout: 'راه‌اندازی Windows در زمان مقرر تمام نشد.', provision_failed: 'سرور ساخته نشد.' },

 bankPayVPSRenewPlan: priceNGN =>
 `لطفاً ${priceNGN} NGN را با کلیک روی «پرداخت» واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن VPS شما به صورت یکپارچه فعال و تمدید می‌شود.`,

 renewVpsPanelConfirmMsg: (data, panelDetails, date) => `<strong>💳 آیا با تمدید کنترل پنل موافقید؟</strong>

<strong>📜 خلاصه فاکتور</strong>
 <strong>• شناسه VPS مرتبط:</strong> ${data.name}
 <strong>• کنترل پنل:</strong> ${panelDetails.type}
 <strong>• دوره تمدید:</strong> ${panelDetails.durationValue}${' '}ماه
 <strong>• تاریخ انقضای فعلی:</strong> ${date}
 <strong>• مبلغ قابل پرداخت:</strong> ${data.totalPrice} USD`,

 bankPayVPSRenewCpanel: (priceNGN, vpsDetails) =>
 `لطفاً ${priceNGN} NGN را با کلیک روی «پرداخت» واریز کنید. پس از تأیید تراکنش، بلافاصله اطلاع‌رسانی خواهید شد و پلن VPS و کنترل پنل ${vpsDetails.cPanelPlanDetails.type} شما تمدید می‌شود.`,
 vpsUnlinkCpanelWarning: vpsDetails =>
 `⚠️ هشدار: جداسازی، لایسنس ${vpsDetails.cPanel} را از VPS ${vpsDetails.name} حذف می‌کند و شما دسترسی به امکانات آن را از دست خواهید داد. آیا می‌خواهید ادامه دهید؟`,
 unlinkCpanelConfirmed: data => `✅ کنترل پنل ${data.cPanel} با موفقیت از VPS ${data.name} جدا شد.`,

 errorUpgradingVPS: vpsName => `هنگام ارتقای پلن VPS ${vpsName} خطایی رخ داد.

 لطفاً روی 💬 پشتیبانی بزنید تا کمک دریافت کنید.
 اطلاعات بیشتر ${TG_HANDLE}.`,

 vpsUpgradePlanTypeSuccess: vpsDetails => `
 ✅ VPS ${vpsDetails.name} به ${vpsDetails.upgradeOption.to} ارتقا یافت. منابع جدید شما اکنون در دسترس هستند.`,

 vpsUpgradeDiskTypeSuccess: vpsDetails =>
 `✅ دیسک برای VPS ${vpsDetails.name} به ${vpsDetails.upgradeOption.to} ارتقا یافت. نوع دیسک به‌روز شده شما اکنون فعال است.`,

 vpsRenewPlanSuccess: (vpsDetails, expiryDate) =>
 `✅ اشتراک VPS برای ${vpsDetails.name} با موفقیت تمدید شد!

• تاریخ انقضای جدید: ${expiryDate}
`,
 vpsRenewCPanelSuccess: (vpsDetails, expiryDate) =>
 `✅ اشتراک پنل کنترل برای ${vpsDetails.name} با موفقیت تمدید شد!

• تاریخ انقضای جدید: ${expiryDate}
`,
}

const fa = {
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
 tickerOf,
 linkType,
 tickerViews,
 linkOptions,
 planOptions,
 tickerViewOf,
 dnsRecordType,
dnsQuickActionKeyboard,
 dnsMxPriorityKeyboard,
 dnsProxiedChoiceKeyboard,
 dnsSubdomainTargetTypeKeyboard,
 dnsQuickActions,
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
 planOptionsOf,
 hP: hostingPlansText,
 selectFormatOf,
 vs,
 vp,
 vpsPlanOf,
 vpsCpanelOptional,
}

// Values that did not translate cleanly fall back to English.
const _en = require('./en.js').en
for (const p of []) {
  let t = fa, s = _en
  for (const k of p.slice(0, -1)) { t = t?.[k]; s = s?.[k] }
  if (t && s) t[p[p.length - 1]] = s[p[p.length - 1]]
}

// Persian text for entries the first pass left in English.
const _faText = {
 "t␟phoneGenTimeout": "تایم‌اوت",
 "t␟argsErr": "dev: آرگومان‌های اشتباه ارسال شد",
 "t␟planAskCoupon": "آیا می‌خواهید کد تخفیف اعمال کنید؟ اگر کد دارید، آن را وارد کنید. در غیر این صورت می‌توانید 'رد کردن' را بزنید.",
 "t␟enterCoupon": "لطفاً کد تخفیف را وارد کنید:",
 "t␟couponInvalid": "کد تخفیف نامعتبر است. لطفاً دوباره کد تخفیف خود را وارد کنید:",
 "t␟chooseDomainToManage": "لطفاً یک دامنه انتخاب کنید تا تنظیمات DNS آن را مدیریت کنید.",
 "t␟chooseDomainWithShortener": "لطفاً دامنه‌ای را که می‌خواهید با لینک کوتاه‌شده‌تان متصل کنید انتخاب یا خریداری کنید.",
 "t␟dpEsim": "📱 USA T-Mobile eSIM — $75/month",
 "t␟vcWelcome": "💳 <b>کارت دبیت مجازی</b>\n\nکارت مجازی خود را با مبلغ دلخواه شارژ کنید.\n\n✅ در سراسر جهان به صورت آنلاین کار می‌کند\n✅ تحویل فوری\n✅ $50 – $1,000\n\nیک مبلغ انتخاب کنید یا مبلغ دلخواه وارد کنید:",
 "t␟vcInvalidAmount": "❌ لطفاً یک مبلغ معتبر بین <b>$50</b> و <b>$1,000</b> وارد کنید.",
 "t␟vcAskAddress": "📬 <b>آدرس ارسال</b>\n\nآدرس کامل خود را به فرمت بین‌المللی وارد کنید:\n\n<i>مثال:\nJohn Doe\n123 Main Street, Apt 4B\nNew York, NY 10001\nUnited States</i>",
 "t␟vcAddressTooShort": "❌ آدرس خیلی کوتاه به نظر می‌رسد. لطفاً نام کامل، خیابان، شهر، کد پستی و کشور را وارد کنید.",
 "t␟leadsFileNumbersOnly": "📄 <b>فایل ۱ — شماره تلفن‌ها</b>\nتمام شماره‌های تأییدشده در دسته شما.",
 "t␟addDnsTxt": "نوع رکورد را انتخاب کنید:",
 "t␟updateDnsTxt": "رکوردی که می‌خواهید به‌روزرسانی کنید را انتخاب کنید:",
 "t␟deleteDnsTxt": "رکوردی که می‌خواهید حذف کنید را انتخاب کنید:",
 "t␟confirmDeleteDnsTxt": "آیا مطمئن هستید که می‌خواهید این رکورد را حذف کنید؟",
 "t␟dnsRecordSaved": "رکورد با موفقیت اضافه شد. تغییرات DNS ممکن است تا ۲۴ ساعت طول بکشد تا اعمال شود.",
 "t␟dnsRecordDeleted": "رکورد با موفقیت حذف شد.",
 "t␟dnsRecordUpdated": "رکورد با موفقیت به‌روزرسانی شد. تغییرات DNS ممکن است تا ۲۴ ساعت طول بکشد تا اعمال شود.",
 "t␟dnsProxiedChoiceLabelDnsOnly": "⚪ DNS Only (Recommended)",
 "t␟dnsProxiedChoiceLabelProxied": "🟠 Proxied through Cloudflare",
 "t␟selectCryptoToDeposit": "لطفاً یک ارز دیجیتال انتخاب کنید:\n\n<i>ℹ️ USDT (TRC20) حداقل واریز $20 نیاز دارد.</i>",
 "t␟trc20SwitchCryptoBtn": "🔄 انتخاب ارز دیگر",
 "t␟trc20EditAmountBtn": "✏️ وارد کردن مبلغ دیگر",
 "t␟trc20WhyMinBtn": "💡 چرا این حداقل مقدار؟",
 "t␟trc20CancelBtn": "❌ لغو",
 "t␟walletBalanceLow": "💰 موجودی کیف پول کم است. برای شارژ، روی واریز ضربه بزنید.",
 "t␟phoneNumberLeads": "لیدهای تأیید شده ممتاز را بر اساس هدف دریافت کنید یا شماره‌های خود را اعتبارسنجی کنید:",
 "t␟buyLeadsSelectCountry": "لطفاً کشور را انتخاب کنید",
 "t␟buyLeadsSelectSmsVoice": "لطفاً SMS / تماس صوتی را انتخاب کنید",
 "t␟buyLeadsSelectArea": "لطفاً منطقه را انتخاب کنید",
 "t␟buyLeadsSelectAreaCode": "لطفاً کد منطقه را انتخاب کنید",
 "t␟buyLeadsSelectCarrier": "لطفاً اپراتور را انتخاب کنید",
 "t␟buyLeadsSelectCnam": "آیا می‌خواهید <b>نام صاحب شماره</b> را با هر لید دریافت کنید؟ هزینه اضافی $15 به ازای هر ۱٬۰۰۰ لید است — و ارزشش را دارد.",
 "t␟buyLeadsSelectFormat": "فرمت را انتخاب کنید، مثلاً محلی (212) یا بین‌المللی (+1212)",
 "t␟vps_48": "Bank ₦aira + Card 🌐︎",
 "t␟vps_51": "Bank ₦aira + Card 🌐︎",
 "l␟askPreferredLanguage": "🌍 برای اطمینان از نمایش همه چیز به زبان دلخواه شما، لطفاً یکی از گزینه‌های زیر را انتخاب کنید:\n \nهر زمان می‌توانید زبان خود را در تنظیمات تغییر دهید.",
 "l␟askValidLanguage": "لطفاً یک زبان معتبر انتخاب کنید:",
 "l␟settingsMenuText": "⚙️ <b>تنظیمات</b>\n\nترجیحات خود را در زیر مدیریت کنید:",
 "l␟askUserEmail": "ایمیل شما چیست؟ بیایید تجربه شما را شخصی‌سازی کنیم! (مثال: davidsen@gmail.com)",
 "l␟processUserEmail": " متشکرم 😊 در حال راه‌اندازی حساب شما هستیم.\nلطفاً لحظه‌ای صبر کنید تا جزئیات نهایی شود. ⏳\n \nما در پشت صحنه کار می‌کنیم. فقط مراحل را دنبال کنید!",
 "l␟confirmUserEmail": "✨ خبر خوب! حساب شما آماده است! 🎉💃🎉\n\nاز ویژگی‌های ممتاز در دوره آزمایشی رایگان خود لذت ببرید!\n",
 "l␟termsAndCond": "📜 قبل از ادامه، لطفاً شرایط و ضوابط ما را مطالعه و قبول کنید.",
 "l␟acceptTermButton": "✅ قبول می‌کنم",
 "vs␟callNotConnected": "📞 <b>تماس برقرار نشد</b> — مخاطب مشغول بود یا پاسخ نداد.\n\n🎁 تماس آزمایشی رایگان شما هنوز موجود است! هر زمان دوباره امتحان کنید.",
 "vp␟vpsLinuxBtn": "🐧 Linux VPS (SSH)",
 "vp␟vpsRdpBtn": "🪟 Windows RDP",
 "vp␟chooseValidZone": "لطفاً یک منطقه معتبر از لیست انتخاب کنید:",
 "vp␟failedFetchingData": "خطا در دریافت اطلاعات، لطفاً پس از مدتی دوباره تلاش کنید.",
 "vp␟confirmBtn": "✅ تأیید انتخاب",
 "vp␟askPaymentMethod": "یک روش پرداخت انتخاب کنید:",
 "vp␟rdpNotSupported": "⚠️ این قابلیت فقط برای نمونه‌های Windows RDP در دسترس است.\n\nVPS شما در حال اجرای Linux است. به جای آن از کلیدهای SSH برای مدیریت دسترسی استفاده کنید.",
 "vp␟upgradeVpsBtn": "⬆️ ارتقاء",
 "vp␟doPlanNoOptions": "⚠️ در حال حاضر هیچ پلن دیگری قابل اعمال به این سرور نیست (فضای دیسک هرگز کاهش نمی‌یابد و برخی پلن‌ها ممکن است در این منطقه موجود نباشند).",
 "vp␟doPlanKeepDiskBtn": "💾 نگه داشتن دیسک فعلی (قابل بازگشت)"
}
for (const [p, v] of Object.entries(_faText)) {
  const ks = p.split('␟'); let o = fa
  for (const k of ks.slice(0, -1)) o = o?.[k]
  if (o && typeof o[ks[ks.length - 1]] === 'string') o[ks[ks.length - 1]] = v
}
module.exports = {
 fa,
}
