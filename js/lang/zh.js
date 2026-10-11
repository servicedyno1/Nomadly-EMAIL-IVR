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
const APP_SUPPORT_LINK = process.env.APP_SUPPORT_LINK

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
 cPanelWebHostingPlans: '俄罗斯 HostPanel 托管计划',
 pleskWebHostingPlans: '俄罗斯 Plesk 托管计划',
 joinChannel: '📢 加入频道',
 phoneNumberLeads: '🎯 购买线索 | 验证您的号码',
 buyLeads: '🎯 购买线索',
 validateLeads: '✅ 验证号码',
 leadsValidation: '📱 短信线索',
 hostingDomainsRedirect: '🛡️ Anti-Red 托管',
 wallet: '👛 钱包',
 urlShortenerMain: '🔗 URL 缩短器',
 domainNames: '🌐 防弹域名',
 viewPlan: '📋 我的计划',
 becomeReseller: '💼 经销商',
 getSupport: '💬 支持',
 cloudPhone: '📞 Cloud IVR + SIP',
 testSip: '🧪 免费测试 SIP',
 vpsPlans: '🖥️ VPS / RDP',
 buyPlan: '⭐ 会员订阅',
 more: '➕ 更多',
 freeTrialAvailable: '🆓 BulkSMS 免费试用',
 smsAppMain: '📱 BulkSMS',
 smsCreateCampaign: '📱 创建活动',
 smsMyCampaigns: '📋 我的活动',
 smsDownloadApp: '📲 下载应用',
 smsResetLogin: '🔓 重置登录',
 smsManageDevices: '📱 管理设备',
 smsHowItWorks: '❓ 使用说明',
 smsAppSettings: '⚙️ SMS 设置',
 changeSetting: '⚙️ 设置',
 changeLanguage: '🌍 更改语言',

 // Sub Menu 1: urlShortenerMain
 redSelectUrl: '🔀✂️ 重定向并缩短',
 redBitly: '✂️ Bit.ly',
 redShortit: '✂️ Shortit (试用)',
 urlShortener: '✂️🌐 自定义域名缩短器',
 viewShortLinks: '📊 查看短链接分析',
 activateDomainShortener: '🔗 激活域名用于短链接',

 // Sub Menu 6: Digital Products
 digitalProducts: '🛒 数字产品',
 marketplace: '🏪 市场',
 shippingLabel: '📦 寄件与邮寄',
 emailBlast: '📧 群发邮件',
 emailValidation: '📧 邮箱验证',
 serviceBundles: '🎁 服务套餐',
 referEarn: '🤝 推荐赚钱',
 virtualCard: '💳 虚拟卡',

 // Sub Menu 2: domainNames
 buyDomainName: '🛒🌐 购买域名',
 viewDomainNames: '📂 我的域名',
 dnsManagement: '🔧 DNS 管理',

 // Sub Menu 3: cPanel/Plesk WebHostingPlansMain
 freeTrial: '💡 免费试用',
 premiumWeekly: '⚡ Premium Anti-Red (1周)',
 premiumCpanel: '🔷 Premium Anti-Red HostPanel（30 天）',
 goldenCpanel: '👑 Golden Anti-Red HostPanel（30 天）',
 contactSupport: '📞 联系支持',

 // Sub Menu 4: VPS Plans
 buyVpsPlan: '⚙️ 创建 VPS / RDP',
 buyLinuxVpsBtn: '🐧 创建 Linux VPS',
 buyRdpBtn: '🪟 创建 Windows RDP',
 manageVpsPlan: '🖥️ 管理我的服务器',
 vpsRdpMenuPrompt: `🖥️ <b>云 VPS / Windows RDP</b>

两种不同的产品，两套不同的套餐：
🐧 <b>Linux VPS</b> — SSH 访问 · 网站托管 · 开发 · 自动化
🪟 <b>Windows RDP</b> — 远程桌面 · 含 Windows 许可证 · 预付 1/2/3 个月 · 约 3 分钟就绪

开放 25 端口 · 防弹托管。请选择一个选项：`,
 manageVpsSSH: '🔑 SSH密钥',

 // Free Trial
 freeTrialMenuButton: '🚀 免费试用（12小时）',
 getFreeTrialPlanNow: '🛒 立即获取试用计划',
 continueWithDomainNameSBS: websiteName => `➡️ 继续使用 ${websiteName}`,
 searchAnotherDomain: '🔍 搜索其他域名',
 privHostNS: '🏢 PrivHost（快速安全的主机）',
 cloudflareNS: '🛡️ Cloudflare 防护（安全和隐私）',
 backToFreeTrial: '⬅️ 返回免费试用',

 // Paid Plans
 buyPremiumWeekly: '🛒 🛒 购买初级计划',
 buyPremiumCpanel: '🛒 🛒 购买专业计划',
 buyGoldenCpanel: '🛒 🛒 购买商业计划',
 viewPremiumWeekly: '🔷 查看初级计划',
 viewPremiumCpanel: '🔼 查看专业计划',
 viewGoldenCpanel: '👑 查看商业计划',
 backToHostingPlans: '⬅️ 返回主机计划',
 registerANewDomain: '🌐 注册新域名',
 useMyDomain: '📂 使用我的域名',
 connectExternalDomain: '🔗 连接外部域名',
 useExistingDomain: '🔄 使用现有域名',
 backToPremiumWeeklyDetails: '⬅️ 返回初级计划详情',
 backToPremiumCpanelDetails: '⬅️ 返回专业计划详情',
 backToGoldenCpanelDetails: '⬅️ 返回商业计划详情',
 continueWithDomain: websiteName => `➡️ 继续使用 ${websiteName}`,
 enterAnotherDomain: '🔍 输入另一个域名',
 backToPurchaseOptions: '⬅️ 返回购买选项',
 myHostingPlans: '📋 我的托管计划',
 billingMenu: '💳 我的计划 / 账单',
 backToBillingMenu: '⬅️ 返回账单',
 revealCredentials: '🔑 显示凭证',
 manageVisitorCaptcha: '🛡️ 验证码 开/关',
 manageVisitorCaptchaLocked: '🔒 验证码 开/关 — 仅限 Gold 套餐',
 manageHoneypot: '🍯 蜜罐陷阱 开/关',
 manageHoneypotLocked: '🔒 蜜罐陷阱 开/关 — 仅限月付套餐',
 renewHostingPlan: '🔄 续费计划',
 upgradeHostingPlan: '⬆️ 升级计划',
 backToMyHostingPlans: '⬅️ 返回我的计划',
 buyLeads: '🎯 购买电话线索',
 validateLeads: '✅ 验证号码',
 shortenLink: '✂️ 缩短链接',
 confirmRenewNow: '✅ 确认并支付',
 cancelRenewNow: '❌ 取消',
 toggleAutoRenew: '🔁 切换自动续费',
 unlinkDomain: '🗑️ 解除域名绑定',
 addDomainToPlan: '➕ 添加域名到方案',
 changePrimaryDomain: '🔄 更换主域名',
 confirmChangePrimaryBtn: '✅ 是的，更换',
 confirmAttachBtn: '✅ 是的，添加',
 cancelHostingPlan: '🚫 取消主机方案',
 takeSiteOffline: '🔌 让网站下线',
 bringSiteOnline: '🌐 让网站上线',
 siteOfflineModeMaintenance: '🛠️ 维护模式（推荐）',
 siteOfflineModeSuspend: '🚫 完全暂停（HTTP + 邮箱 + FTP + 数据库）',
 confirmTakeOfflineBtn: '✅ 是的，让其下线',
 confirmBringOnlineBtn: '✅ 是的，让其上线',
 confirmUnlinkBtn: '✅ 是的，解除绑定',
 confirmCancelHostingBtn: '🗑️ 是的，取消方案',
 cancelGoBackBtn: '⬅️ 否，返回',
}

const u = {
 // other key boards
 deposit: '➕💵 存款',
 withdraw: '➖💵 撤回',
 myTier: '🏆 我的等级',
 txHistory: '📜 交易记录',

 // wallet
 usd: '美元',
 ngn: 'NGN',

 // deposit methods
 depositBank: '🏦 银行（奈拉）',
 depositCrypto: '₿ 加密货币',
}
const view = num => Number(num).toFixed(2)
const yesNo = ['是', '否']

const bal = (usd) => `$${view(usd)}`

const dnsEntryFormat = '' // deprecated — A/CNAME now use multi-step wizard

const t = {
 yes: '✅ 是',
 no: '❌ 否',
 back: '返回',
 cancel: '❌ 取消',
 skip: '跳过',
 becomeReseller: (() => {
 const services = ['URL缩短', '域名注册']
 if (process.env.PHONE_SERVICE_ON === 'true') services.push('Cloud IVR')
 if (HIDE_SMS_APP !== 'true') services.push('群发短信')
 if (process.env.OFFSHORE_HOSTING_ON !== 'false') services.push('离岸托管')
 return `<b>成为${CHAT_BOT_BRAND}经销商</b>

以您自己的品牌转售我们的全套服务 — ${services.join('、')}。

每笔销售<b>65/35%</b>利润分成。点击 💬 <b>获取支持</b> 开始合作。`
 })(),
 resetLoginAdmit: `${CHAT_BOT_BRAND} SMS: 您已成功退出您之前的设备。请立即登录。`,
 resetLoginDeny: '好的。无需进一步操作。',
 resetLogin: `${CHAT_BOT_BRAND}SMS：您是否要退出之前的设备？`,
 select: `请选择一个选项：`,
 urlShortenerSelect: `缩短、品牌化或追踪您的链接：`,

 // cPanel/Plesk Plans initial select plan text
 selectPlan: `请选择一个计划：`,
 backButton: '⬅️ 返回',
 skipEmail: '跳过（无电子邮件）',
 yesProceedWithThisEmail: email => `➡️ 使用 ${email} 继续`,
 proceedWithPayment: '➡️ 继续付款',
 iHaveSentThePayment: `我已发送付款 ✅`,
 trialAlreadyUsed: `您已经使用了您的免费试用。如果您需要更多的访问权限，请考虑订阅我们的付费计划之一。`,
 oneHourLeftToExpireTrialPlan: `您的 Freedom 计划将在 1 小时后到期。如果您想继续使用我们的服务，请考虑升级到付费计划！`,
 freePlanExpired: `🚫 您的 Freedom 计划已过期。希望您享受了试用期！要继续使用我们的服务，请购买我们的高级计划之一。`,
 freeTrialPlanSelected: hostingType => `
- 免费试用我们的 <b>Freedom 计划</b>！此计划包括一个以 .sbs 结尾的免费域名，有效期为 12 小时。

🚀 <b>Freedom 计划：</b>
<b>- 存储：</b> 1 GB SSD
<b>- 带宽：</b> 10 GB
<b>- 域名：</b> 1 个免费的 .sbs 域名
<b>- 邮箱账户：</b> 1 个邮箱账户
<b>- 数据库：</b> 1 个 MySQL 数据库
<b>- 免费 SSL：</b> 是
<b>- HostPanel 功能：</b> 完全访问 HostPanel，用于管理文件、数据库和邮箱等。
<b>- 时长：</b> 有效期 12 小时
<b>- 适合：</b> 测试和短期项目。
 `,
 getFreeTrialPlan: `请输入您想要的域名（例如：example.sbs）并将其作为消息发送。此域名以 .sbs 结尾，并且在您的试用计划中免费提供。`,
 trialPlanContinueWithDomainNameSBSMatched: websiteName => `域名 ${websiteName} 可用！`,
 trialPlanSBSDomainNotMatched: `您输入的域名未找到。请确保域名正确或尝试使用其他域名。`,
 trialPlanSBSDomainIsPremium: `此域名为高级价格，仅适用于付费计划。请搜索其他域名。`,
 trialPlanGetNowInvalidDomain: `请输入有效的域名，必须以 '.sbs' 结尾。域名应类似于 'example.sbs'，并且在您的试用计划中免费提供。`,
 trialPlanNameserverSelection: websiteName => `请选择您希望为 ${websiteName} 使用的名称服务器提供商。`,
 trialPlanDomainNameMatched: `请提供您的电子邮件地址以创建您的账户并发送您的收据。`,
 confirmEmailBeforeProceedingSBS: email => `您确定要使用此电子邮件 ${email} 订阅 Freedom 计划吗？`,
 trialPlanInValidEmail: `请输入有效的电子邮件。`,
 trialPlanActivationConfirmation: `谢谢！您的免费试用计划将很快激活。请注意，此计划仅在 12 小时内有效。`,
 trialPlanActivationInProgress: `您的免费试用计划正在激活。这可能需要一些时间……`,

 what: `该选项目前不可用。请从下方按钮中选择。`,
 whatNum: `请选择一个有效的数字。`,
 phoneGenTimeout: `超时。`,
 phoneGenNoGoodHits: `请点击 💬 获取支持 或选择其他区号。`,

 subscribeRCS: p => `已订阅！随时通过点击<a href="${SELF_URL}/unsubscribe?a=b&Phone=${p}">链接</a>取消订阅。`,
 unsubscribeRCS: p => `您已取消订阅！要重新订阅，请点击<a href="${SELF_URL}/subscribe?a=b&Phone=${p}">链接</a>。`,
 argsErr: `开发：发送了错误的参数。`,
 showDepositNgnInfo:
 ngn => `请通过点击下方的“付款”按钮汇款 ${ngn} NGN。一旦交易确认，您将立即收到通知，并且您的钱包将更新。

此致, 
${CHAT_BOT_NAME}`,
 askEmail: `请提供用于支付确认的电子邮件。`,
 askValidAmount: '请提供一个有效的数字。',
 askValidEmail: '请提供一个有效的电子邮件。',
 askValidCrypto: '请选择一种有效的加密货币。',
 askValidPayOption: '请选择一个有效的支付选项。',
 chooseSubscription: buildChooseSubscription('zh'),

 askCoupon: usd => `价格是 $${view(usd)}。您是否想使用优惠券代码？如果有，请立即输入。否则，您可以按“跳过”。`,
 planAskCoupon: `您是否想使用优惠券代码？如果有，请立即输入。否则，您可以按“跳过”。`,
 enterCoupon: `请输入优惠券代码：`,
 planPrice: (plan, price) => `${plan} 订阅的价格是 $${price}。请选择支付方式。`,
 planNewPrice: (plan, price, newPrice) =>
 `${plan} 订阅的价格现在是 $${view(newPrice)} <s>($${price})</s>。请选择支付方式。`,
 domainPrice: (domain, price) => `${domain} 域名的价格是 $${price} USD。请选择支付方式。`,
 domainNewPrice: (domain, price, newPrice) =>
 `${domain} 域名的价格现在是 $${view(newPrice)} <s>($${price})</s>。请选择支付方式。`,
 couponInvalid: `优惠券代码无效，请重新输入：`,
 lowPrice: `提供的价格低于所需金额。`,
 freeTrialAvailable: (chatId) => `📱 <b>BulkSMS 免费试用 — 100条免费短信</b>\n\n您的激活码：\n<code>${chatId}</code>\n\n📲 <b>下载应用：</b> ${SMS_APP_LINK}\n\n打开应用 → 输入激活码 → 开始发送！\n\n⚡ 试用：仅限1台设备。升级可使用多达10台设备。\n\n需要 eSIM 卡？点击 💬 获取支持`,
 freeTrialNotAvailable: `您已使用过免费试用。`,

 smsAppMenuSubscribed: (chatId) => `📧 <b>BulkSMS — 已激活 ✅</b>\n\n📱 <i>仅支持 Android 设备（不支持 iOS / iPhone）。</i>\n\n通过手机SIM卡发送短信 — 高送达率，真实发送人ID。\n\n📲 <b>应用：</b> ${SMS_APP_LINK}\n🔑 <b>激活码：</b> <code>${chatId}</code>\n\n在下方或应用中创建活动。\n新用户？点击 <b>❓ 使用说明</b>`,
 smsAppMenuTrial: (chatId, remaining) => `📧 <b>BulkSMS — 免费试用</b>（剩余 ${remaining} 条）\n\n📱 <i>仅支持 Android 设备（不支持 iOS / iPhone）。</i>\n\n通过手机SIM卡发送短信 — 高送达率，真实发送人ID。\n\n📲 <b>应用：</b> ${SMS_APP_LINK}\n🔑 <b>激活码：</b> <code>${chatId}</code>\n\n新用户？点击 <b>❓ 使用说明</b>`,
 smsAppMenuExpired: `📧 <b>BulkSMS</b>\n\n📱 <i>仅支持 Android 设备（不支持 iOS / iPhone）。</i>\n\n试用已结束。点击 <b>⚡ 升级计划</b> 继续发送。\n\n新用户？点击 <b>❓ 使用说明</b> 了解BulkSMS。`,

 smsHowItWorks: (chatId) => `📧 <b>BulkSMS — 使用说明</b>\n\nBulkSMS通过<b>您手机的SIM卡</b>发送真实短信 — 不是服务器。高送达率和真实发送人ID。\n\n<b>⚙️ 一次性设置：</b>\n1. 下载应用 → ${SMS_APP_LINK}\n2. 打开 → 输入激活码：<code>${chatId}</code>\n3. 允许短信权限\n\n<b>📤 发送活动：</b>\n• 在这里点击 <b>📱 创建活动</b> 或在应用中创建\n• 添加消息 + 联系人（粘贴或上传文件）\n• 活动同步到应用 → 在手机上点击发送\n\n<b>💡 技巧：</b>\n• 使用 <b>eSIM</b> 作为专用发送线路\n• 多行消息 = 自动轮换\n• <code>[name]</code> = 自动个性化\n• 可以定时发送或立即发送\n\n<b>📋 我的活动</b> 查看所有活动状态。\n<b>🔓 重置登录</b> 切换设备。\n\n需要eSIM？点击 💬 支持`,
 smsCreateCampaignIntro: `📱 <b>创建短信活动</b>\n\n操作步骤：\n\n<b>步骤1：</b>为您的活动命名\n<b>步骤2：</b>编写您的消息\n • 使用 <code>[name]</code> 进行个性化\n • 多行 = 消息轮换\n<b>步骤3：</b>上传联系人\n • 粘贴文本：<code>+1234567890, 张三</code>\n • 或上传 .txt / .csv 文件\n<b>步骤4：</b>设置短信间隔时间\n<b>步骤5：</b>检查并确认 — 发送、定时或保存草稿\n\n活动将同步到 Nomadly SMS 应用进行发送。\n\n<b>开始吧 — 输入活动名称：</b>`,
 smsSchedulePrompt: '⏰ <b>定时活动？</b>\n\n选择此活动何时可用：',
 smsSendNow: '▶️ 立即发送',
 smsScheduleLater: '⏰ 稍后定时',
 smsScheduleTimePrompt: '📅 <b>输入日期和时间</b>\n\n格式：<code>YYYY-MM-DD HH:MM</code>\n（UTC时区）\n\n示例：<code>2025-07-15 09:30</code>',
 smsSaveDraft: '💾 保存草稿',
 smsDefaultGap: '⏱ 默认（5秒）',
 smsGapTimePrompt: '⏱ <b>消息间隔时间</b>\n\n每条短信之间等待多少秒？\n\n• 默认：<b>5秒</b>\n• 范围：1–300秒\n\n输入数字或点击默认按钮：',
 smsMyCampaignsEmpty: '📋 <b>我的活动</b>\n\n暂无活动。点击 <b>📱 创建活动</b> 开始！',
 smsMyCampaignsList: (campaigns) => {
 const statusIcons = { draft: '📝', sending: '📤', completed: '✅', paused: '⏸', scheduled: '📅' }
 const lines = campaigns.slice(0, 10).map((c, i) =>
 `${i + 1}. ${statusIcons[c.status] || '📋'} <b>${c.name}</b>\n ${c.sentCount}/${c.totalCount} 已发送 · ${c.status}`
 )
 return `📋 <b>我的活动</b>\n\n${lines.join('\n\n')}\n\n<i>在 Nomadly SMS 应用中管理活动。</i>`
 },
 planSubscribed:
 HIDE_SMS_APP === 'true'
 ? `您已成功订阅 {{plan}} 计划！享受免费 、无限Shortit链接和免费USA电话号码验证（含机主姓名）。需要 E-sim 卡？请点击 💬 获取支持。`
 : `✅ 已订阅 {{plan}} 计划！

包含：
• 免费 
• 无限 Shortit 链接
• USA 电话验证
• ${SMS_APP_NAME}

📱 设备访问：
 每日 — 3台设备
 每周 — 10台设备
 每月 — 无限设备

📲 下载：${SMS_APP_LINK}
💬 E-sim：点击支持
🔓 切换设备：/resetlogin`,
 alreadySubscribedPlan: days => `您的订阅已激活，并将在 ${days} 天后到期。`,
 payError: `未找到支付会话，请重试或点击 💬 获取支持。了解更多信息，请访问 ${TG_HANDLE}。`,
 chooseFreeDomainText: `<b>好消息！</b> 此域名可随您的订阅免费提供。您想领取吗？`,

 chooseDomainToBuy: text => `<b>获取你的网络角落！</b> 请分享你希望购买的域名，例如“abcpay.com”。${text}`,
 askDomainToUseWithShortener: `👉 <b>确认上方的域名。</b> 点击<b>否</b>立即注册，或点击<b>是</b>同时开启短链接。\n\n<b>否</b> — 仅注册<i>（推荐）</i>。可随时从 🔧 DNS 管理中启用短链接。\n<b>是</b> — 同时自动配置 DNS，短链接变为 <code>yourdomain.com/abc</code>。`,
 blockUser: `请分享需要被封锁的用户的用户名。`,
 unblockUser: `请分享需要解封的用户的用户名。`,
 blockedUser: `你目前被封锁，无法使用机器人。请点击 💬 获取支持。更多信息 ${TG_HANDLE}。`,
 greet: `${CHAT_BOT_BRAND} — 缩短URL、注册域名、购买电话线索，从Telegram发展您的业务。

使用${FREE_LINKS}次Shortit试用链接开始 — /start
支持: 点击 💬 获取支持`,

 linkExpired: `您的 ${CHAT_BOT_BRAND} 测试期已结束，您的短链接已停用。我们邀请您订阅以继续访问我们的URL服务和免费域名。选择适当的计划并按照说明订阅。请联系我们的任何问题。
敬启者，
${CHAT_BOT_BRAND}团队
了解更多： ${TG_CHANNEL}`,
 successPayment: `支付成功处理！现在可以关闭此窗口。`,
 welcome: `感谢选择 ${CHAT_BOT_NAME}！请在下面选择一个选项：`,
 welcomeFreeTrial: `${CHAT_BOT_BRAND}欢迎您！您有${FREE_LINKS}次Shortit试用链接来缩短URL。订阅可获得无限Shortit链接、免费 和免费USA电话验证（含机主姓名）。体验${CHAT_BOT_BRAND}的不同！`,
 unknownCommand: `找不到命令。按 /start 或点击 💬 获取支持。了解更多 ${TG_HANDLE}。`,
 support: `请点击 💬 获取支持。了解更多 ${TG_HANDLE}。`,
 joinChannel: `请加入频道 ${TG_CHANNEL}。`,
 dnsPropagated: `{{domain}}的DNS传播已完成，进行无限链接简化。`,
 dnsNotPropagated: `{{domain}}的DNS传播正在进行，您将会在完成后更新。 ✅`,
 domainBoughtSuccess: domain => `域名 ${domain} 现在属于您。谢谢选择我们。

敬启者，
${CHAT_BOT_NAME}`,

 domainBought: `您的域名 {{domain}} 已成功链接到您的账户，DNS传播即将完成。稍后您将自动收到更新。🚀`,
 domainLinking: domain =>
 `正在将域名与您的账户链接中。请注意，DNS更新可能需要最长 30 分钟。您可以在此处检查 DNS 更新状态：https://www.whatsmydns.net/#A/${domain}`,
 errorSavingDomain: `保存域名时出错，请点击 💬 获取支持。更多信息请访问 ${TG_HANDLE}。`,
 chooseDomainToManage: `请选择您要管理的域名。`,
 chooseDomainWithShortener: `请选择或购买您想要连接到短链接的域名。`,
 viewDnsRecords: (records, domain, nameserverType) => {
 let msg = `<b>${domain} 的 DNS 记录</b>\n`

 // NS section — only show for cloudflare or custom NS (hide provider defaults)
 const nsRecs = records['NS']
 if (nsRecs && nsRecs.length && (nameserverType === 'cloudflare' || nameserverType === 'custom')) {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : '自定义'
 msg += `\n<b>域名服务器</b> <i>(${provider})</i>\n`
 for (let i = 0; i < nsRecs.length; i++) {
 msg += ` NS${i + 1}: <code>${nsRecs[i].recordContent || '—'}</code>\n`
 }
 msg += `<i>使用"更新 DNS 记录"来更改。</i>\n`
 }

 const otherTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'SRV', 'CAA']
 const typeLabels = {
 A: 'A 记录', AAAA: 'AAAA 记录', CNAME: 'CNAME 记录',
 MX: 'MX 记录', TXT: 'TXT 记录',
 SRV: 'SRV 记录', CAA: 'CAA 记录',
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
 const pri = r.priority !== undefined ? ` (优先级:${r.priority})` : ''
 msg += `${idx} MX ${host}${pri} -> ${r.recordContent || '无'}\n`
 } else if (type === 'TXT') {
 const val = r.recordContent ? (r.recordContent.length > 60 ? r.recordContent.substring(0, 60) + '...' : r.recordContent) : '无'
 msg += `${idx} TXT ${host} -> ${val}\n`
 } else if (type === 'SRV') {
 msg += `${idx} SRV ${r.recordName || ''} -> ${r.recordContent || '无'}\n`
 } else if (isShortenerCNAME) {
 msg += `${idx} ${type} ${host} -> 🔗 URL缩短器 <i>(${r.recordContent})</i>\n`
 } else {
 msg += `${idx} ${type} ${host} -> ${r.recordContent || '无'}\n`
 }
 }
 }
 const hasAny = ['NS', ...otherTypes].some(t => records[t]?.length)
 if (!hasAny) msg += '\n未找到 DNS 记录。\n'
 return msg
 },

 addDns: '添加 DNS 记录',
 updateDns: '更新 DNS 记录',
 deleteDns: '删除 DNS 记录',
 quickActions: '快速操作',
 activateShortener: '🔗 激活 URL 短链接',
 deactivateShortener: '🔗 停用 URL 短链接',

 // DNS Wizard strings (zh)
 mx: 'MX 记录',
 txt: 'TXT 记录',
 'MX 记录': 'MX',
 'TXT 记录': 'TXT',
 dnsQuickActionMenu: '选择预设配置：',
 dnsQuickAskIp: '请输入服务器 IP 地址 (IPv4)：',
 dnsQuickAskVerificationTxt: '请粘贴提供商给您的 TXT 验证值：',
 dnsQuickAskSubdomainName: '请输入子域名名称（如：api、blog、app）：',
 dnsQuickAskSubdomainTargetType: (full) => `您想如何指向 ${full}？`,
 dnsQuickSubdomainIp: '指向 IP (A)',
 dnsQuickSubdomainDomain: '指向域名 (CNAME)',
 dnsQuickAskSubdomainIp: '请输入 IP 地址：',
 dnsQuickAskSubdomainDomain: '请输入目标域名：',
 dnsQuickSetupProgress: (step, total) => `正在配置 (${step}/${total})...`,
 dnsQuickSetupError: (what) => `创建 ${what} 时出错，请重试。`,
 dnsQuickGoogleDone: (domain) => `已为 ${domain} 配置 Google Workspace！5 条 MX + SPF 已添加。`,
 dnsQuickZohoDone: (domain) => `已为 ${domain} 配置 Zoho Mail！3 条 MX + SPF 已添加。`,
 dnsQuickPointToIpDone: (domain, ip) => `${domain} 现在指向 ${ip}。\nA: ${domain} -> ${ip}\nCNAME: www.${domain} -> ${domain}`,
 dnsQuickVerificationDone: 'TXT 验证记录已添加！',
 dnsQuickSubdomainDone: (sub, target, type) => `${sub} 现在指向 ${target} (${type})`,
 dnsInvalidIpv4: '无效的 IPv4 地址。请输入有效 IP（如：192.168.1.1）：',
 dnsInvalidHostname: '无效的主机名。可使用字母数字、连字符、下划线和点（例如：api、_dmarc、neo1._domainkey）：',
 dnsHostnameForeignDomain: (zone) => `该主机名属于其他域名。对于 <b>${zone}</b>，仅输入子标签（如 <b>www</b>、<b>api</b>）或 <b>@</b> 表示根域名。`,
 dnsFixDuplicatedBtn: (n) => `🛠️ 修复 ${n} 条损坏记录`,
 dnsFixDuplicatedHeader: (zone) => `🛠️ <b>清理：${zone} 上的重复域名记录</b>\n\n检测到记录名中域名重复（如 <code>www.${zone}.${zone}</code>）。这通常发生在用户将完整域名作为主机名输入时。\n\n点击 <b>✅ 自动修复</b> 重命名为正确的子标签（如 <code>www</code>）并保留值。点击 <b>🗑️ 删除</b> 全部移除。`,
 dnsFixDuplicatedAutoFixBtn: '✅ 自动修复全部',
 dnsFixDuplicatedDeleteBtn: '🗑️ 全部删除',
 dnsFixDuplicatedDone: (fixed, deleted, failed) => `<b>完成。</b>\n\n✅ 已自动修复：${fixed}\n🗑️ 已删除：${deleted}${failed ? `\n⚠️ 失败：${failed}` : ''}\n\nDNS 传播可能需要 24 小时。`,
 dnsInvalidMxPriority: '无效的优先级。请输入 1 到 65535 之间的数字：',
 askDnsHostname: {
 A: '<b>添加 A 记录</b>\n\n输入主机名：\n例如：<b>@</b> 表示根域名，或 <b>api</b>, <b>blog</b>, <b>www</b>\n\n<i>提示：只输入子标签 — 不要包含完整域名。</i>',
 CNAME: '<b>添加 CNAME 记录</b>\n\n输入子域名：\n例如：<b>www</b>, <b>api</b>, <b>blog</b>\n\n注意：CNAME 不能用于根域名 (@)\n<i>提示：只输入子标签 — 不要包含完整域名。</i>',
 MX: '<b>添加 MX 记录</b>（步骤 1/3）\n\n输入主机名：\n例如：<b>@</b> 表示根邮箱，或子域名\n\n<i>提示：只输入子标签 — 不要包含完整域名。</i>',
 TXT: '<b>添加 TXT 记录</b>（步骤 1/2）\n\n输入主机名：\n例如：<b>@</b> 表示根域名，或 <b>_dmarc</b>, <b>mail</b>\n\n<i>提示：只输入子标签 — 不要包含完整域名。</i>',
 NS: '<b>添加 NS 记录</b>\n\n输入域名服务器：\n例如：<b>ns1.cloudflare.com</b>',
 AAAA: '<b>添加 AAAA 记录</b>（步骤 1/2）\n\n输入主机名：\n例如：<b>@</b> 表示根域名，或 <b>api</b>, <b>blog</b>\n\n<i>提示：只输入子标签 — 不要包含完整域名。</i>',
 },
 askDnsValue: {
 A: '输入 IPv4 地址：\n例如：<b>192.168.1.1</b>',
 CNAME: '输入目标域名：\n例如：<b>myapp.railway.app</b>',
 MX: '<b>步骤 2/3</b> — 输入邮件服务器：\n例如：<b>ASPMX.L.GOOGLE.COM</b>',
 TXT: '<b>步骤 2/2</b> — 输入 TXT 值：\n例如：<b>v=spf1 include:_spf.google.com ~all</b>',
 AAAA: '<b>步骤 2/2</b> — 输入 IPv6 地址：\n例如：<b>2001:db8::1</b>',
 },
 askMxPriority: '<b>步骤 3/3</b> — 输入 MX 优先级（数值越小优先级越高）：\n例如：<b>10</b> 为主要，<b>20</b> 为备用',
 dnsQuickActions: {
 pointToIp: '指向 IP',
 googleEmail: 'Google Workspace 邮箱',
 zohoEmail: 'Zoho 邮箱',
 verification: '域名验证 (TXT)',
 addSubdomain: '添加子域名',
 },

 // Phase 2: AAAA, SRV, CAA
 aaaa: 'AAAA 记录',
 'AAAA 记录': 'AAAA',
 srvRecord: 'SRV 记录',
 'SRV 记录': 'SRV',
 caaRecord: 'CAA 记录',
 'CAA 记录': 'CAA',
 dnsInvalidIpv6: '无效的 IPv6 地址。请输入有效 IPv6（如：2001:db8::1）：',
 dnsInvalidPort: '无效的端口号。请输入 1 到 65535 之间的数字：',
 dnsInvalidWeight: '无效的权重。请输入 0 到 65535 之间的数字：',
 dnsSrvCaaNotSupported: '您当前的 DNS 提供商（ConnectReseller）不支持 SRV 和 CAA 记录。请切换到 Cloudflare 或 OpenProvider 域名服务器。',
 askSrvService: '<b>添加 SRV 记录</b>（步骤 1/5）\n\n输入服务和协议：\n例如：<b>_sip._tcp</b>, <b>_http._tcp</b>',
 askSrvTarget: '<b>步骤 2/5</b> — 输入目标主机名：\n例如：<b>sipserver.example.com</b>',
 askSrvPort: '<b>步骤 3/5</b> — 输入端口号：\n例如：<b>5060</b>, <b>443</b>',
 askSrvPriority: '<b>步骤 4/5</b> — 输入优先级（数值越小优先级越高）：\n例如：<b>10</b>',
 askSrvWeight: '<b>步骤 5/5</b> — 输入权重（负载均衡）：\n例如：<b>100</b>',
 askCaaHostname: '<b>添加 CAA 记录</b>（步骤 1/3）\n\n输入主机名：\n例如：<b>@</b> 表示根域名',
 askCaaTag: '<b>步骤 2/3</b> — 选择 CAA 标签：',
 caaTagIssue: 'issue — 授权 CA',
 caaTagIssuewild: 'issuewild — 授权通配符',
 caaTagIodef: 'iodef — 违规报告 URL',
 'issue — 授权 CA': 'issue',
 'issuewild — 授权通配符': 'issuewild',
 'iodef — 违规报告 URL': 'iodef',
 askCaaValue: (tag) => {
 if (tag === 'iodef') return '<b>步骤 3/3</b> — 输入报告 URL：\n例如：<b>mailto:admin@example.com</b>'
 return '<b>步骤 3/3</b> — 输入授权 CA 域名：\n例如：<b>letsencrypt.org</b>'
 },
 askDnsHostnameAaaa: '请输入主机名（@ 表示根域名，或子域名如 <b>api</b>、<b>blog</b>）：',
 askDnsValueAaaa: '请输入 IPv6 地址（如：<b>2001:db8::1</b>）：',

 // DNS Validation Checker
 checkDns: '检查 DNS',
 dnsChecking: (domain) => `正在检查 <b>${domain}</b> 的 DNS...`,
 dnsRecordLive: (type, value) => `<b>${type}</b> 已生效，解析到 <b>${value}</b>。`,
 dnsRecordPropagating: (type) => `<b>${type}</b> 正在传播中，可能需要 24-48 小时。`,
 dnsHealthTitle: (domain) => `<b>DNS 健康检查 — ${domain}</b>\n`,
 dnsHealthRow: (type, found, count, answers) => {
 if (!found) return ` ${type}: —`
 const vals = answers.slice(0, 2).join(', ')
 const more = answers.length > 2 ? ` +${answers.length - 2} 条` : ''
 return ` ${type}: ${count} 条记录 (${vals}${more})`
 },
 dnsHealthSummary: (resolving, total) => resolving > 0
 ? `\n✅ 状态：<b>有效</b> — ${resolving}/${total} 种记录类型已解析。`
 : `\n⚠️ 状态：<b>无效</b> — 此域名尚未在任何地方解析。可能被注册局暂停或仍在激活中。`,
 dnsCheckError: 'DNS 查询失败，请稍后重试。',
 manageNameservers: '🔄 管理域名服务器',
 manageNsMenu: (domain, nsRecords, nameserverType) => {
 const provider = nameserverType === 'cloudflare' ? 'Cloudflare' : nameserverType === 'custom' ? '自定义' : '提供商默认'
 let msg = `<b>🔄 域名服务器 — ${domain}</b>\n\n`
 msg += `<b>提供商：</b> ${provider}\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>当前域名服务器：</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 } else { msg += `<i>未找到 NS 记录。</i>\n` }
 msg += `\n请选择操作：`
 return msg
 },
 setCustomNs: '✏️ 自定义域名服务器',
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ 设置 ${domain} 的自定义域名服务器</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>当前：</b>\n`
 nsRecords.forEach((ns, i) => { msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n` })
 msg += '\n'
 }
 msg += `输入新的域名服务器（每行一个，最少2个，最多4个）：\n\n<i>示例：\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare：请<b>原样</b>复制控制台显示的名称（例如 <code>leanna.ns.cloudflare.com</code>），<b>不要</b>额外添加 <code>ns1./ns2.</code> 前缀。</i>`
 return msg
 },
 switchToCf: '☁️ 切换到 Cloudflare',
 switchToCfConfirm: (domain) => `<b>将 ${domain} 切换到 Cloudflare DNS？</b>\n\n这将：\n1. 为您的域名创建 Cloudflare 区域\n2. 将现有 DNS 记录迁移到 Cloudflare\n3. 在注册商处更新域名服务器\n\nDNS 传播可能需要 24-48 小时。\n\n继续？`,
 switchToCfProgress: (domain) => `⏳ 正在将 <b>${domain}</b> 切换到 Cloudflare DNS…`,
 switchToCfSuccess: (domain, ns) => `<b>完成！</b> ${domain} 现在使用 Cloudflare DNS。\n\n<b>新域名服务器：</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToCfError: (error) => `❌ 切换到 Cloudflare 失败：${error}`,
 switchToCfAlreadyCf: '此域名已在使用 Cloudflare DNS。',
 switchToProviderDefault: '🏠 切换到提供商 DNS',
 switchToProviderConfirm: (domain) => `<b>将 ${domain} 切换回提供商 DNS？</b>\n\n这将：\n1. 将 DNS 记录从 Cloudflare 迁移到注册商\n2. 恢复默认域名服务器\n3. 删除 Cloudflare 区域\n\nDNS 传播可能需要 24-48 小时。\n\n继续？`,
 switchToProviderProgress: (domain) => `⏳ 正在将 <b>${domain}</b> 切换到提供商 DNS…`,
 switchToProviderSuccess: (domain, ns) => `<b>完成！</b> ${domain} 现在使用提供商 DNS。\n\n<b>新域名服务器：</b>\n${ns.map((n, i) => `NS${i + 1}: <code>${n}</code>`).join('\n')}`,
 switchToProviderError: (error) => `❌ 切换到提供商 DNS 失败：${error}`,
 switchToProviderAlreadyProvider: '此域名已在使用提供商 DNS。',
 updateNsPrompt: (nsRecords, slotIndex) => {
 let msg = `<b>更新域名服务器 — 插槽 NS${slotIndex}</b>\n\n<b>当前排列：</b>\n`
 for (let i = 0; i < nsRecords.length; i++) {
 const marker = (i + 1) === slotIndex ? ' ← 正在更新' : ''
 msg += ` NS${i + 1}: <code>${nsRecords[i].recordContent || '—'}</code>${marker}\n`
 }
 msg += `\n请输入 <b>NS${slotIndex}</b> 的新域名服务器：\n例如 <b>ns1.cloudflare.com</b>`
 return msg
 },

 // Digital Products
 digitalProductsSelect: `🛒 <b>数字产品</b>\n\n经验证的账户通过此机器人<b>快速</b>交付。\n\n<b>电信</b> — Twilio, Telnyx (短信, 语音, SIP)\n<b>云服务</b> — AWS, Google Cloud (完全访问)\n<b>电子邮件</b> — Google Workspace, Zoho Mail, IONOS SMTP\n<b>移动</b> — eSIM T-Mobile\n\n使用加密货币、银行转账或钱包支付。请在下方选择：`,
 dpTwilioMain: `📞 Twilio 主账号 — $${DP_PRICE_TWILIO_MAIN}`,
 dpTwilioSub: `📞 Twilio 子账号 — $${DP_PRICE_TWILIO_SUB}`,
 dpTelnyxMain: `📡 Telnyx 主账号 — $${DP_PRICE_TELNYX_MAIN}`,
 dpTelnyxSub: `📡 Telnyx 子账号 — $${DP_PRICE_TELNYX_SUB}`,
 dpGworkspaceNew: `📧 Google Workspace Admin（新域名）— $${DP_PRICE_GWORKSPACE_NEW}`,
 dpGworkspaceAged: `📧 Google Workspace Admin（老域名）— $${DP_PRICE_GWORKSPACE_AGED}`,
 dpEsim: `📱 eSIM T-Mobile — $${DP_PRICE_ESIM}`,
 dpEsimAirvoice: `📱 eSIM Airvoice (AT&T)`,
 dpAirvoiceSelect: `📱 <b>eSIM Airvoice (AT&T)</b>\n\n📶 AT&T 网络无限通话、短信和数据。\n支持 iOS 和 Android。扫码即可激活。\n\n选择套餐时长：`,
 dpAirvoice1m: `1个月 — $${DP_PRICE_AIRVOICE_1M}`,
 dpAirvoice3m: `3个月 — $${DP_PRICE_AIRVOICE_3M}`,
 dpAirvoice6m: `6个月 — $${DP_PRICE_AIRVOICE_6M}`,
 dpAirvoice1y: `1年 — $${DP_PRICE_AIRVOICE_1Y}`,
 dpZohoNew: `📧 Zoho Mail（新域名）— $${DP_PRICE_ZOHO_NEW}`,
 dpZohoAged: `📧 Zoho Mail（老域名）— $${DP_PRICE_ZOHO_AGED}`,
 dpAwsMain: `☁️ AWS 主账号 — $${DP_PRICE_AWS_MAIN}`,
 dpAwsSub: `☁️ AWS 子账号 — $${DP_PRICE_AWS_SUB}`,
 dpGcloudMain: `🌐 Google Cloud 主账号 — $${DP_PRICE_GCLOUD_MAIN}`,
 dpGcloudSub: `🌐 Google Cloud 子账号 — $${DP_PRICE_GCLOUD_SUB}`,
 dpIonosSmtp: `📧 IONOS SMTP — $${DP_PRICE_IONOS_SMTP}`,
 dpPaymentPrompt: (product, price) => {
 const descriptions = {
 'Twilio Main Account': '完整的 Twilio 主账户，含控制台访问、API 密钥，可开通电话号码、发送 SMS/MMS 和语音通话。\n\n您将收到：登录凭据 + API SID 和 Auth Token。',
 'Twilio Sub-Account': 'Twilio 子账户，含控制台登录和专用 API 凭据，支持 SMS、语音和号码管理。\n\n您将收到：登录凭据、Account SID 和 Auth Token。',
 'Telnyx Main Account': '完整的 Telnyx 主账户，含 Mission Control Portal 访问。开通号码、配置 SIP、消息和语音。\n\n您将收到：登录凭据 + API 密钥。',
 'Telnyx Sub-Account': 'Telnyx 子账户，含 Mission Control Portal 登录和 API 访问，支持消息、语音和号码管理。\n\n您将收到：登录凭据 + API 密钥。',
 'AWS Main Account': '完整的 AWS 根账户，含控制台访问所有服务 — EC2、S3、Lambda、SES 等。\n\n您将收到：根邮箱、密码和 MFA 设置。',
 'AWS Sub-Account': 'AWS 子账户（Organizations 成员），含完整控制台登录和核心服务访问 — EC2、S3、Lambda 等。\n\n您将收到：登录凭据和 IAM 访问。',
 'Google Cloud Main Account': '完整的 Google Cloud 主账户，已启用计费。Compute Engine、Cloud Storage、BigQuery 等全部 GCP 服务。\n\n您将收到：登录凭据。',
 'Google Cloud Sub-Account': 'Google Cloud 项目，含完整控制台登录和编辑器级访问。包含计算、存储和 API 访问。\n\n您将收到：登录凭据和服务账户密钥。',
 'Google Workspace (New Domain)': '在新注册域名上设置 Google Workspace 企业邮箱。@您的域名 邮箱含 Gmail、Drive、Docs 和 Meet。\n\n您将收到：管理员登录 + 域名凭据。',
 'Google Workspace (Aged Domain)': '在老域名上设置 Google Workspace，提升邮件送达率。企业邮箱含完整 Google 套件。\n\n您将收到：管理员登录 + 域名凭据。',
 'Zoho Mail (New Domain)': '在新域名上设置 Zoho Mail 专业邮箱。@您的域名 邮箱含日历、联系人和文件存储。\n\n您将收到：管理员登录 + 域名设置。',
 'Zoho Mail (Aged Domain)': '在老域名上设置 Zoho Mail，提升发件人信誉。专业邮箱含完整 Zoho 套件。\n\n您将收到：管理员登录 + 域名凭据。',
 'eSIM T-Mobile': '📶 <b>1个月 — 无限通话、短信和数据</b>\n支持 iOS 和 Android。扫码即可激活。\n\n您将收到：QR 码或激活详情。',
 'eSIM Airvoice (AT&T) — 1 Month': '📶 <b>1个月 — 无限通话、短信和数据 (AT&T)</b>\n支持 iOS 和 Android。扫码即可激活。\n\n您将收到：QR 码或激活详情。',
 'eSIM Airvoice (AT&T) — 3 Months': '📶 <b>3个月 — 无限通话、短信和数据 (AT&T)</b>\n支持 iOS 和 Android。扫码即可激活。\n\n您将收到：QR 码或激活详情。',
 'eSIM Airvoice (AT&T) — 6 Months': '📶 <b>6个月 — 无限通话、短信和数据 (AT&T)</b>\n支持 iOS 和 Android。扫码即可激活。\n\n您将收到：QR 码或激活详情。',
 'eSIM Airvoice (AT&T) — 1 Year': '📶 <b>1年 — 无限通话、短信和数据 (AT&T)</b>\n支持 iOS 和 Android。扫码即可激活。\n\n您将收到：QR 码或激活详情。',
 }
 const desc = descriptions[product] || ''
 return `💰 <b>订单：${product}</b>\n\n💵 价格：<b>$${price}</b>${desc ? '\n\n' + desc : ''}\n\n请选择支付方式：`
 },
 dpOrderConfirmed: (product, price, orderId) => `✅ <b>订单已确认！</b>\n\n🛒 产品：<b>${product}</b>\n💵 金额：<b>$${price}</b>\n🆔 订单号：<code>${orderId}</code>\n\n您的订单将很快通过此机器人送达。\n如有问题，请联系客服。`,

 // Virtual Card
 vcWelcome: `💳 <b>虚拟借记卡</b>\n\n充值一张虚拟卡。\n\n✅ 全球在线使用\n✅ 即时交付\n✅ $50 – $1,000\n\n选择金额或输入自定义金额：`,
 vcInvalidAmount: `❌ 请输入 <b>$50</b> 到 <b>$1,000</b> 之间的有效金额。`,
 vcAskAddress: `📬 <b>收件地址</b>\n\n请输入完整的国际格式地址：\n\n<i>示例：\n张三\n北京市朝阳区建国路123号\n100022\n中国</i>`,
 vcAddressTooShort: `❌ 地址过短，请填写完整地址，包括姓名、街道、城市、邮编和国家。`,
 vcOrderSummary: (amount, fee, total) => `📋 <b>订单摘要</b>\n\n💳 虚拟卡充值：<b>$${amount}</b>\n💰 服务费：<b>$${fee.toFixed(2)}</b>${amount < 200 ? '（最低$20）' : '（10%）'}\n━━━━━━━━━━━━━━━━━\n💵 <b>总计：$${total.toFixed(2)}</b>\n\n请选择支付方式：`,
 vcOrderConfirmed: (amount, total, orderId) => `✅ <b>虚拟卡订单已确认！</b>\n\n💳 充值金额：<b>$${amount}</b>\n💵 已支付：<b>$${total.toFixed(2)}</b>\n🆔 订单号：<code>${orderId}</code>\n\n⏱ <b>卡片信息将很快在此发送。</b>`,
 leadsFileNumbersOnly: `📄 <b>文件 1 — 电话号码</b>\n您批次中所有已验证的号码。`,
 leadsFileWithNames: (count) => `📄 <b>文件 2 — 号码 + 机主姓名（${count} 条匹配）</b>\n这些线索包含机主的真实姓名。用名字称呼对方——立刻建立信任，大幅提高回复率。`,
 addDnsTxt: '选择记录类型：',
 updateDnsTxt: '选择要更新的记录：',
 deleteDnsTxt: '选择要删除的记录：',
 confirmDeleteDnsTxt: '确定要删除此记录吗？',
 a: `A 记录`,
 cname: `CNAME 记录`,
 ns: `NS 记录`,
 'A 记录': `A`,
 'CNAME 记录': `CNAME`,
 'NS 记录': `NS`,
 askDnsContent: {
 NS: '<b>添加 NS 记录</b>\n\n输入域名服务器：\n例如：<b>ns1.cloudflare.com</b>',
 'NS Record': '<b>添加 NS 记录</b>\n\n输入域名服务器：\n例如：<b>ns1.cloudflare.com</b>',
 },
 askUpdateDnsContent: {
 A: (current) => `<b>更新 A 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 IPv4 地址:\n例如：<b>192.168.1.1</b>`,
 'A Record': (current) => `<b>更新 A 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 IPv4 地址:\n例如：<b>192.168.1.1</b>`,
 CNAME: (current) => `<b>更新 CNAME 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 目标域名:\n例如：<b>myapp.railway.app</b>`,
 'CNAME Record': (current) => `<b>更新 CNAME 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 目标域名:\n例如：<b>myapp.railway.app</b>`,
 NS: (current) => `<b>更新 NS 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 域名服务器:\n例如：<b>ns1.cloudflare.com</b>`,
 'NS Record': (current) => `<b>更新 NS 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 域名服务器:\n例如：<b>ns1.cloudflare.com</b>`,
 MX: (current) => `<b>更新 MX 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 邮件服务器:\n例如：<b>ASPMX.L.GOOGLE.COM</b>`,
 'MX Record': (current) => `<b>更新 MX 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 邮件服务器:\n例如：<b>ASPMX.L.GOOGLE.COM</b>`,
 TXT: (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>更新 TXT 记录</b>\n当前: <b>${display}</b>\n\n输入新值 TXT 值:\n例如：<b>v=spf1 include:_spf.google.com ~all</b>`
 },
 'TXT Record': (current) => {
 const display = current ? (current.length > 50 ? current.substring(0, 50) + '...' : current) : 'N/A'
 return `<b>更新 TXT 记录</b>\n当前: <b>${display}</b>\n\n输入新值 TXT 值:\n例如：<b>v=spf1 include:_spf.google.com ~all</b>`
 },
 AAAA: (current) => `<b>更新 AAAA 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 IPv6 地址:\n例如：<b>2001:db8::1</b>`,
 'AAAA Record': (current) => `<b>更新 AAAA 记录</b>\n当前: <b>${current || 'N/A'}</b>\n\n输入新值 IPv6 地址:\n例如：<b>2001:db8::1</b>`,
 },
 dnsRecordSaved: 'DNS 记录添加成功。DNS 更改可能需要最多 24 小时生效。',
 dnsRecordDeleted: '记录已成功删除。',
 dnsRecordUpdated: 'DNS 记录更新成功。DNS 更改可能需要最多 24 小时生效。',
 provideLink: `请输入有效的 URL。例如：https://google.com`,
 comingSoonWithdraw: `提现功能暂未开放。需要帮助？请点击 💬 获取支持。`,
 promoOptOut: `您已取消订阅促销消息。输入 /start_promos 随时重新订阅。`,
 promoOptIn: `您已重新订阅促销消息。您将收到我们最新的优惠和活动！`,
 selectCurrencyToDeposit: `💵 充值金额（最低 $10）：`,
 depositNGN: `请输入 NGN 金额（最低 ≈ 10 美元）。\n您的奈拉将按当前汇率转换为美元：`,
 askEmailForNGN: `请输入支付确认邮件`,
 depositUSD: `请输入 USD 金额，注意最小值为 $10：`,
 selectCryptoToDeposit: `请选择加密货币：\n\n<i>ℹ️ USDT (TRC20) 最低存款额为 $20。</i>`,

 trc20MinDepositPrompt: (currentAmount, minAmount) =>
  `⚠️ <b>USDT (TRC20) 最低需要 $${minAmount}</b>\n\n` +
  `您输入的金额：<b>$${currentAmount}</b>\n` +
  `TRC20 转账需要约 $${minAmount}+ 以舒适地覆盖接收方的 TRX 能量费用。\n\n` +
  `您想怎么做？`,
 trc20TopUpBtn: (minAmount) => `✅ 充值到 $${minAmount}`,
 trc20SwitchCryptoBtn: '🔄 选择其他加密货币',
 trc20EditAmountBtn: '✏️ 输入其他金额',
 trc20WhyMinBtn: '💡 为什么需要这个最低额？',
 trc20CancelBtn: '❌ 取消',

 trc20WhyMinExplanation: (minAmount) =>
  `💡 <b>为什么 TRC20 需要 $${minAmount} 最低额？</b>\n\n` +
  `每笔 TRC20 USDT 转账在接收方需要消耗约 5–15 TRX 的网络"能量"费。对于小额存款，这些费用可能会吃掉您发送金额的 30–50%——保持 $${minAmount} 的下限可确保您的存款几乎全部到达您的钱包，到账也更快。\n\n` +
  `其他币种（BTC、LTC、ETH）每笔转账开销较低，因此没有最低限额。\n\n` +
  `还需要帮助？联系客服：${APP_SUPPORT_LINK}`,
 'bank-pay-plan': (priceNGN, plan) =>
 `请点击“付款”按钮，发送 ${priceNGN} NGN。一旦交易确认，您将立即收到通知，您的 ${plan} 计划将顺利激活。

问候，
${CHAT_BOT_NAME}`,
 bankPayDomain: (priceNGN, domain) =>
 `请点击“付款”按钮，发送 ${priceNGN} NGN。一旦交易确认，您将立即收到通知，您的域名 ${domain} 将顺利激活。

问候，
${CHAT_BOT_NAME}`,
 showDepositCryptoInfoPlan: (priceUsd, priceCrypto, tickerView, address, plan) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的 ${plan} 计划将在支付确认后自动激活（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,
 showDepositCryptoInfoDomain: (priceUsd, priceCrypto, tickerView, address, domain) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的域名 ${domain} 将在支付确认后自动激活（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoLeads: (priceUsd, priceCrypto, tickerView, address, label) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的 ${label} 将在支付确认后自动交付（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoPhone: (priceUsd, priceCrypto, tickerView, address, phoneNumber) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的 Cloud IVR 号码 ${phoneNumber} 将在支付确认后自动激活（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfoDigitalProduct: (priceUsd, priceCrypto, tickerView, address, product) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的 <b>${product}</b> 订单将在支付确认后自动交付（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 showDepositCryptoInfo: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>\n\n请发送 <b>${priceCrypto} ${tickerView}</b> 至:\n\n<code>${address}</code>\n\n加密支付确认速度很快——通常只需几分钟。确认后，您将立即收到通知，并且您的钱包将更新。\n\n问候,\n${CHAT_BOT_NAME}`,

 showDepositCryptoInfoOpenEnded: (minUsd, tickerView, address) =>
 `💎 <b>发送任意金额的 ${tickerView}</b>，价值至少 <b>$${Number(minUsd).toFixed(0)} USD</b> 至：\n\n<code>${address}</code>\n\n我们将按照您发送金额的完整市场价值入账。\n\n⚠️ <b>低于 $${Number(minUsd).toFixed(0)} USD 的存款将被没收</b> — 清扫它们的网络费用超过存款本身。\n\n加密支付通常在几分钟内确认。\n\n问候,\n${CHAT_BOT_NAME}`,

 dustDepositNotice: (receivedUsd, minUsd, tickerView) =>
 `⚠️ <b>存款低于最低限额 — 未入账</b>\n\n我们收到了您 <b>≈ $${Number(receivedUsd).toFixed(2)} USD</b> 等值的 ${tickerView}，但该币种的钱包充值最低限额是 <b>$${Number(minUsd).toFixed(0)} USD</b>。\n\n清扫如此小额存款的网络费用超过存款本身，因此您的资金未入账。\n\n如需帮助，请点击 💬 支持，我们的团队将为您提供协助。\n\n— ${CHAT_BOT_NAME}`,

 confirmationDepositMoney: (amount, usd) =>
 `您的 ${amount}（$${view(usd)}）支付已处理。感谢您选择我们。\n问候,\n${CHAT_BOT_NAME}`,

 showWallet: (usd) => `钱包余额 :\n\n$${view(usd)}`,

 wallet: (usd) => `钱包余额 :\n\n$${view(usd)}\n\n请选择钱包选项:`,

 walletSelectCurrency: (usd) => `钱包余额: $${view(usd)}`,

 walletBalanceLow: `您的钱包余额不足。点击"👛 我的钱包" → "➕💵 充值"进行充值。`,

 sentLessMoney: (expected, got) =>
 `⚠️ <b>付款不足</b>\n\n应付：<b>${expected}</b>\n收到：<b>${got}</b>\n\n✅ <b>${got} 已存入您的钱包</b> — 分文未失。\n\n💳 完成此订单：重新打开该服务，在结账时选择 <b>👛 钱包</b>（如有小额差额请补足）。输入 /start 继续。`,

 sentMoreMoney: (expected, got) =>
 `您发送的金额多于预期，因此我们将多余的金额存入您的钱包。我们预期 ${expected} 但收到 ${got}`,

 buyLeadsError: `抱歉，选择的区号不可用，并且您的钱包未收费`,
 buyLeadsProgress: (i, total) => `${((i * 100) / total).toFixed()}% leads 下载中。请稍候。`,

 phoneNumberLeads: `购买经验证的电话线索或验证您自己的号码：`,

 buyLeadsSelectCountry: `请选择国家`,
 buyLeadsSelectSmsVoice: `请选择短信/语音`,
 buyLeadsSelectArea: `请选择区域`,
 buyLeadsSelectAreaCode: `请选择区号`,
 buyLeadsSelectCarrier: `请选择运营商`,
 buyLeadsSelectCnam: `需要每条线索附带<b>电话号码机主姓名</b>吗？每 1,000 条额外 $15 — 绝对值得。`,
 buyLeadsSelectAmount: (min, max) => `您想购买多少 leads？选择或输入一个数量。最小值为 ${min} 最大值为 ${max}`,

 buyLeadsSelectFormat: `选择格式，例如本地 (212) 或国际 (+1212)`,

 buyLeadsSuccess: n => `🎉 <b>完成！</b> 您的 ${n} 条线索已准备好。\n\n您将获得两个文件：\n📄 <b>文件 1</b> — 所有电话号码\n📄 <b>文件 2</b> — 匹配了<b>机主姓名</b>的号码\n\n提示：用姓名个性化您的推广，被称呼姓名的人回复率高2-3倍。`,

 buyLeadsNewPrice: (leads, price, newPrice) => `💰 <b>${leads} 条线索</b> — 仅需 <b>$${view(newPrice)}</b> <s>($${price})</s>\n包含机主姓名。不要错过。`,
 buyLeadsPrice: (leads, price) => `💰 <b>${leads} 条线索</b> — <b>$${price}</b>\n包含机主姓名。随时为您准备。`,

 walletSelectCurrencyConfirm: `确认？`,

 validatorSelectCountry: `请选择国家`,
 validatorPhoneNumber: `请粘贴您的号码或上传包含国家代码的文件。`,
 validatorSelectSmsVoice: n => `${n} 个电话号码找到。请选择短信或语音拨号的选项。`,
 validatorSelectCarrier: `请选择运营商`,
 validatorSelectCnam: `需要验证后的线索附带<b>电话号码机主姓名</b>吗？\n\n知道对方是谁，您就能个性化您的消息——人们会回应自己的名字。每 1,000 条 $15，物超所值。`,
 validatorSelectAmount: (min, max) => `您想验证多少个电话号码？选择或输入一个数量。最小值为 ${min} 最大值为 ${max}`,

 validatorSelectFormat: `选择格式，例如本地 (212) 或国际 (+1212)`,

 validatorSuccess: (n, m) => `${n} 个 leads 被验证了。${m} 个有效的电话号码找到。`,
 validatorProgress: (i, total) => `${((i * 100) / total).toFixed()}% leads 验证中。请稍候。`,
 validatorProgressFull: (i, total) => `${((i * 100) / total).toFixed()}% leads 验证。`,

 validatorError: `抱歉，选择的电话号码不可用，并且您的钱包未收费`,
 validatorErrorFileData: `找到无效的国家电话号码。请上传选定国家的电话号码`,
 validatorErrorNoPhonesFound: `找不到电话号码。请重试。`,

 validatorBulkNumbersStart: `lead 验证已开始，很快就会完成。`,

 // url re-director
 redSelectUrl: `请分享您想要缩短和分析的 URL，例如 https://cnn.com`,
 redSelectRandomCustom: `请选择您的选择，随机或自定义链接`,
 redSelectProvider: `选择链接提供商`,
 redSelectCustomExt: `输入自定义后缀`,

 redValidUrl: `请提供一个有效的 URL，例如 https://google.com`,
 redTakeUrl: url => `您的缩短后的 URL 是: ${url}`,
 redIssueUrlBitly: `链接缩短失败。您的钱包未被扣费。请重试或点击 💬 获取支持。`,
 redIssueSlugCuttly: `您选择的链接名称已被使用，请尝试另一个`,
 redIssueUrlCuttly: `链接缩短失败。请重试或点击 💬 获取支持。`,
 freeLinksExhausted: `您的${FREE_LINKS}次试用链接已用完！订阅即可享受无限链接+免费域名+${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+次验证（含机主姓名）。`,
 subscriptionLeadsHint: `💡 订阅者每个计划可获得${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+次免费验证（含机主姓名）。每天仅需$${PRICE_DAILY}起。`,
 linksRemaining: (count, total) => {
 const base = `您还剩 ${count}/${total || FREE_LINKS} 次Shortit试用链接。`
 if (count <= 2) return `${base}\n\n⚡ <b>仅剩${count}次！</b>订阅即享无限链接 + 免费域名 + ${DAILY_PLAN_FREE_VALIDATIONS.toLocaleString()}+次验证（含机主姓名）。每天仅需$${PRICE_DAILY}起。`
 return base
 },
 redNewPrice: (price, newPrice) => `价格现在为 $${view(newPrice)} <s>($${price})</s>。请选择支付方式。`,
 customLink: '自定义链接',
 randomLink: '随机链接',
 askShortLinkExtension: '请告诉我们您偏好的短链接扩展名：例如 payer',
 linkAlreadyExist: `链接已存在。请键入 'ok' 尝试另一个。`,
 yourShortendUrl: shortUrl => `您的短链接是：${shortUrl}`,

 availablefreeDomain: (plan, available, s) =>
 `请记住，您的 ${plan} 计划包括 ${available} 个免费的${s}。今天就获取您的域名！`,
 shortenedUrlLink: `请分享您希望缩短和分析的URL。例如 https://cnn.com`,
 selectedTrialPlan: `您已选择免费试用计划`,
 userPressedBtn: message => `用户点击了 ${message} 按钮。`,
 userToBlock: userToBlock => `未找到用户 ${userToBlock}。`,
 userBlocked: userToBlock => `用户 ${userToBlock} 已被屏蔽。`,
 checkingDomainAvail: `检查域名可用性...`,
 checkingExistingDomainAvail: `检查现有域名的可用性...`,
 subscribeFirst: `📋 先订阅`,
 freeValidationUsed: (amount, remaining) => `已使用订阅验证了 ${amount} 个USA电话号码！剩余免费验证: ${remaining.toLocaleString()}。`,
 partialFreeValidation: (freeAmount, totalAmount, paidAmount, paidPrice) => `您还有 ${freeAmount.toLocaleString()} 次免费验证。您请求了 ${totalAmount.toLocaleString()} 个号码。\n\n${freeAmount.toLocaleString()} 个将免费处理，剩余 ${paidAmount.toLocaleString()} 个需支付 $${paidPrice}。请在下方完成付款。`,
 notValidHalf: `输入一个有效的后半部分`,
 linkAlreadyExist: `链接已经存在。请尝试其他。`,
 issueGettingPrice: `获取价格时遇到问题`,
 domainInvalid: `域名无效。请尝试其他域名。使用格式 abcpay.com`,
 domainMissingTLD: '缺少域名扩展名。请添加 .com、.net、.org 或其他扩展名。\n\n示例：<b>yourname.com</b>',
 domainTooShort: '域名太短。点前至少需要3个字符。\n\n示例：<b>abc.com</b>',
 domainInvalidChars: '域名包含无效字符。仅使用字母、数字和连字符。\n\n示例：<b>my-site.com</b>',
 domainStartsEndsHyphen: '域名不能以连字符开头或结尾。\n\n示例：<b>mysite.com</b>（不是 -mysite.com 或 mysite-.com）',
 domainSearchTimeout: (domain) => `⏱️ 搜索域名 <b>${domain}</b> 所需时间超过预期。\n\n请稍后重试，如果问题持续存在，请联系客服。`,
 chooseValidPlan: `请选择一个有效的计划`,
 noDomainFound: `未找到域名`,
 chooseValidDomain: `请选择一个有效的域名`,
 failedAudio: '❌ 音频处理失败。请重试。',
 enterBroadcastMessage: '输入消息',
 provide2Nameservers: '请提供至少2个域名服务器，用空格分隔。',
 noDomainSelected: '未选择域名。',
 validInstitutionName: '⚠️ 请输入有效的机构名称（2-100个字符）。',
 validCityName: '⚠️ 请输入有效的城市名称。',
 errorDeletingDns: error => `删除DNS记录时出错，${error}，请再次提供值`,
 selectValidOption: `选择有效选项`,
 cancelled: '已取消。',
 domainActionsMenu: (domain) => `<b>${domain} 的操作</b>\n\n请选择一个选项：`,
 purchaseFailed: '❌ 购买失败。您的钱包已退款。请重试或联系支持。',
 maxDnsRecord: `最多可以添加4个NS记录，您可以更新或删除以前的NS记录`,
 errorSavingDns: error => `保存DNS记录时出错，${error}，请再次提供值`,
 fileError: `处理文件时出错。`,
 ammountIncorrect: `金额不正确`,
 subscriptionExpire: (subscribedPlan, timeEnd) => `您的 ${subscribedPlan} 订阅已过期 ${timeEnd}`,
 plansSubscripedtill: (subscribedPlan, timeEnd) =>
 `您当前订阅的是 ${subscribedPlan} 计划。您的计划有效期至 ${timeEnd}`,
 planNotSubscriped: `您当前没有任何有效的产品或订阅。\n\n购买后，您的托管、Cloud IVR 号码、VPS 和会员订阅都会显示在这里。点击主菜单中的产品即可开始！`,
 noShortenedUrlLink: `您还没有缩短的链接。`,
 shortenedLinkText: linksText => `这是您的缩短链接：\n${linksText}`,
 analyticsNotAvailable: provider => `📊 暂不支持分析数据 (${provider})`,

 qrCodeText: `这是您的二维码！`,
 scanQrOrUseChat: chatId => `📱 <b>Nomadly SMS 应用</b>\n\n您的激活码：\n<code>${chatId}</code>\n\n📲 下载：${process.env.SMS_APP_LINK || '联系支持'}`,
 domainPurchasedFailed: (domain) => `❌ 域名 <b>${domain}</b> 注册未能完成。请重试，如果问题仍然存在，请联系支持。`,
 noDomainRegistered: '您还没有购买任何域名。',
 registeredDomainList: domainsText => `以下是您购买的域名：\n${domainsText}`,
 selectDomainAction: domain => `<b>${domain}</b>\n\n您想对此域名执行什么操作？`,
 domainActionDns: '🔧 DNS 管理',
 domainActionShortener: '🔗 激活 URL 短链接',
 domainActionDeactivateShortener: '🔗 停用 URL 短链接',
 comingSoon: `即将推出`,

 // --- Missing translations (added for completeness) ---
 Annually: '年度',
 Daily: '每日',
 Hourly: '每小时',
 Monthly: '每月',
 Quarterly: '每季度',
 Weekly: '每周',
 addSubdomain: '添加子域名',
 antiRedDisabled: domain => `❌ <b>${domain}</b> 的 Visitor Captcha 已<b>禁用</b>。\n\n"正在验证您的浏览器"页面已对人类访客隐藏。\n\n✅ <b>Anti-Red 保护完全有效</b>：扫描器伪装（Google SafeBrowsing、VirusTotal、McAfee、PhishTank、Sucuri 等 25+ 项）、蜜罐、IP 封禁、Cloudflare WAF 规则 — 仍对每个请求运行。\n\n仅通过 Worker KV 标志隐藏面向人类的挑战页。`,
 antiRedDisableConfirm: domain => `🛡️ <b>隐藏 ${domain} 的 Visitor Captcha？</b>\n\n这只会对人类访客隐藏 "正在验证您的浏览器" 插页（让他们免去 3 秒等待）。\n\n✅ 扫描器伪装、蜜罐、IP 封禁、WAF 规则<b>仍然有效</b> — Anti-Red 保护未被关闭。\n\n继续？`,
 antiRedConfirmDisable: '✅ 是的，隐藏 captcha 页面',
 antiRedDisableConfirmWrong: '点击绿色按钮确认，或 ↩️ 返回 取消。',
 antiRedAutoReenabled: domain => `🛡️ <b>${domain}</b> 的 Visitor Captcha 已重新启用。`,
 antiRedRestoredNote: domain => `🛡️ <b>${domain} 的 Anti-Red 已恢复。</b>\n\n我们刚修复了一个内部 bug：关闭 Visitor Captcha 时同时移除了扫描器伪装。Anti-Red 现已重新启用。您的 "Visitor Captcha OFF" 偏好已保留 — 人类访客仍看不到 "正在验证您的浏览器" 页面。`,
 antiRedEnabled: domain => `✅ <b>${domain}</b> 的 Anti-Red 保护已<b>启用</b>。\n\n访问者在进入您的网站前会看到短暂的"正在验证浏览器"检查。`,
 antiRedError: '❌ 更新 Anti-Red 保护失败。请重试。',
 honeypotMonthlyOnly: `🍯 <b>蜜罐陷阱</b>\n\n此功能仅适用于<b>月付</b>托管套餐（Premium 或 Golden）。\n\n蜜罐陷阱是隐藏的诱饵，可捕获并自动封禁探测您网站的机器人。某些提供原始 JSON/API 输出的网站希望将其关闭——该开关为月付套餐专属。\n\n升级到月付套餐即可按域名管理蜜罐陷阱。`,
 honeypotStatusOn: domain => `🍯 <b>${domain}</b> 的<b>蜜罐陷阱</b>\n\n状态：<b>✅ 开启</b>\n\n隐藏的诱饵链接、表单字段和虚假 API 会被注入到您的 HTML 页面中，以捕获并自动封禁机器人。\n\nℹ️ 陷阱只会添加到真正的 HTML 页面——JSON/API 响应永不受影响。仅当您的网站嵌入必须保持精确的内联输出时才关闭。`,
 honeypotStatusOff: domain => `🍯 <b>${domain}</b> 的<b>蜜罐陷阱</b>\n\n状态：<b>❌ 关闭</b>\n\n不会向您的页面注入任何蜜罐代码。\n\n✅ <b>仍然有效：</b>访客验证码、扫描器伪装、IP 封禁和 WAF 规则——关闭蜜罐不会削弱任何这些防护层。\n\n点击下方重新开启陷阱。`,
 honeypotTurnOff: '❌ 关闭蜜罐陷阱',
 honeypotTurnOn: '✅ 开启蜜罐陷阱',
 honeypotTurningOn: domain => `⏳ 正在为 <b>${domain}</b> 开启蜜罐陷阱...`,
 honeypotTurningOff: domain => `⏳ 正在为 <b>${domain}</b> 关闭蜜罐陷阱...`,
 honeypotEnabled: domain => `✅ 已为 <b>${domain}</b> <b>开启</b>蜜罐陷阱。\n\n隐藏的机器人诱饵现已注入到您的 HTML 页面中。JSON/API 响应永不被修改。`,
 honeypotDisabled: domain => `❌ 已为 <b>${domain}</b> <b>关闭</b>蜜罐陷阱。\n\n不会向您的页面注入任何陷阱代码。\n\n✅ 访客验证码、扫描器伪装、IP 封禁和 WAF 规则仍完全有效。`,
 honeypotError: '❌ 更新蜜罐陷阱失败。请重试。',
 honeypotPickDomain: '🍯 <b>蜜罐陷阱</b> — 选择一个域名\n\n此套餐包含多个域名。点击您要切换的域名。每个名称旁会显示当前状态。',
 honeypotDomainButton: (domain, off, hasCF) => hasCF ? `${off ? '🔴 关闭' : '🟢 开启'} · ${domain}` : `⚠️ 未启用 CF · ${domain}`,
captchaPickDomain: '🛡️ <b>访客验证码</b> — 选择一个域名\n\n此套餐包含多个域名。请点击要切换验证码的域名。每个名称旁边显示当前状态。',
captchaDomainButton: (domain, isOff, hasCF) => hasCF ? `${isOff ? '🔴 关闭' : '🟢 开启'} · ${domain}` : `⚠️ 未启用 CF · ${domain}`,
 antiRedNoCF: domain => `⚠️ <b>${domain}</b> 未使用 Cloudflare。Anti-Red 保护需要 Cloudflare 域名服务器。`,
 antiRedStatusOff: domain => `🛡️ <b>${domain}</b> 的 <b>Visitor Captcha</b>\n\n状态：<b>❌ 关闭（仅对人类）</b>\n\n"正在验证您的浏览器" 插页对人类访客已隐藏。\n\n✅ <b>仍然有效：</b>扫描器伪装（Google SafeBrowsing、VirusTotal、McAfee、PhishTank 及 25+ 其他）、蜜罐、IP 封禁、WAF 规则 — 对每个请求运行。\n\n点击下方可让访客重新看到 captcha。`,
 antiRedStatusOn: domain => `🛡️ <b>${domain}</b> 的 <b>Anti-Red 保护</b>\n\n状态：<b>✅ 开启</b>\n\n这可以保护您的域名免受钓鱼扫描器的侵害。\n\n⚠️ <b>建议：</b>保持 JS Challenge 启用——它提供最大的安全保护。`,
 antiRedTurnOff: '❌ 关闭保护',
 antiRedTurnOn: '✅ 开启保护',
 antiRedTurningOff: domain => `⏳ 正在为 <b>${domain}</b> 禁用 Anti-Red 保护...`,
 antiRedTurningOn: domain => `⏳ 正在为 <b>${domain}</b> 启用 Anti-Red 保护...`,
 dnsWarningHostedDomain: (domain, plan) => `⚠️ <b>警告：此域名有活跃的托管计划</b>\n\n域名：<b>${domain}</b>\n计划：${plan}\n\n<b>⚠️ 修改 DNS 记录可能会导致您的托管和 Anti-Red 保护失效！</b>\n\nDNS 更改仅在您完全了解影响的情况下进行。错误的更改可能导致您的网站无法访问或丢失安全保护。\n\n<b>您确定要继续吗？</b>`,
 dnsProceedAnyway: '⚠️ 仍然继续',
 dnsCancel: '❌ 取消',
 domainTypeRegistered: '🏷️ 在我们这注册',
 domainTypeExternal: '🌍 外部',
 buyLeads: '🎯 购买电话线索',
 cancelRenewNow: '❌ 取消',
 confirmRenewNow: '✅ 确认并支付',
 domainActionAntiRed: '🛡️ 访客验证码',
 domainActionVisitorCaptcha: '🛡️ 访客验证码',
 domainActionVisitorCaptchaLocked: '🔒 访客验证码 (仅限 Gold)',
 visitorCaptchaGoldOnly: (domain, price) => `🔒 <b>访客验证码</b> 用于 <b>${domain}</b>\n\n此功能仅限 <b>👑 Golden Anti-Red HostPanel</b> 套餐。\n\n升级到 Golden (<b>$${price}/月</b>) 以启用按域名访客验证码控制。`,
 visitorCaptchaNoHosting: (domain, price) => `⚠️ <b>访客验证码</b> 仅适用于 Golden Anti-Red HostPanel 套餐的域名。\n\n域名：<b>${domain}</b>\n\n请升级到 Golden (<b>$${price}/月</b>)。`,
 upgradeToGoldButton: price => `⬆️ 升级到 Gold ($${price}/月)`,
 googleEmail: '设置 Google 邮箱',
 pointToIp: '将域名指向IP',
 shortenLink: '✂️ 缩短链接',
 toggleAutoRenew: '🔁 切换自动续费',
 validateLeads: '✅ 验证号码',
 verification: '域名验证 (TXT)',
 walletBalanceLowAmount: (needed, balance) => 
 `您的钱包余额 ($${balance.toFixed(2)}) 不足。\n\n您还需要 <b>$${(needed - balance).toFixed(2)}</b>。点击充值按钮充值。`,
 zohoEmail: '设置 Zoho 邮箱',
 goBackToCoupon: '❌ 返回并应用优惠券',
 errorFetchingCryptoAddress: '获取加密货币地址时出错。请稍后再试。',
 paymentSuccessFul: '✅ 付款已确认 — 正在配置您的服务。',
 domainProcessingOrder: '⏳ 正在处理您的订单 — 正在注册您的域名。',
 nsVerifying: (tld) => `🔍 正在向 .${tld} 注册局验证域名服务器配置 — 大约需要 30–60 秒…`,
 nsVerifiedOk: '✅ 域名服务器验证通过 — 正在注册。',
 mpPaywall: (fee, balance) =>
   `🛒 <b>市场访问权限</b>\n\n` +
   `一次性激活费用: <b>$${fee}</b>\n` +
   `支付一次 — 永久访问 (浏览、上架、聊天、托管)。\n\n` +
   `💳 钱包余额: <b>$${balance.toFixed(2)}</b>\n\n` +
   (balance >= fee
     ? `点击下方激活。`
     : `⚠️ <i>请至少充值 $${(fee - balance).toFixed(2)} 以激活。</i>`),
 mpPaywallPayBtn: (fee) => `✅ 用钱包支付 $${fee}`,
 mpPaywallTopupBtn: '👛 充值钱包',
 mpPaywallCancelBtn: '❌ 取消',
 mpPaywallCryptoBtn: '₿ 加密货币支付',
 mpPaywallNgnBtn: '🏦 NGN（银行）支付',
 mpPayChooseCrypto: (fee) => `₿ <b>用加密货币支付 $${fee} 市场费用</b>\n\n请选择一种币种 — 您将获得一个钱包地址以发送准确的费用。付款确认后将自动解锁访问权限。`,
 mpPayNgnStarting: (fee) => `🏦 <b>正在为 $${fee} 市场费用准备您的 NGN 付款…</b>`,
 mpAccessActivated: (method) => `🎉 <b>市场访问权限已激活！</b>\n\n✅ 通过 ${method} 支付。\n\n您现在可以：\n• 🛍️ <b>上架</b>您的商品和服务\n• 💬 与买家聊天\n• 🔒 使用托管进行安全交易\n\n点击下方打开市场。`,
 mpAccessAlreadyCredited: (usd) => `ℹ️ 您已拥有市场访问权限，因此您的 <b>$${Number(usd).toFixed(2)}</b> 付款已存入您的钱包。`,
 mpOpenMarketplaceBtn: '🏪 打开市场',
 mpPaywallInsufficient: (fee, balance) =>
   `🚫 <b>钱包余额不足</b>\n\n` +
   `需要: <b>$${fee}</b> · 现有: <b>$${balance.toFixed(2)}</b>\n\n` +
   `请通过 👛 <b>钱包</b> 充值 <b>$${Math.max(fee - balance, 25).toFixed(2)}</b> 或更多，然后重试。`,
 mpPaywallSuccess: (fee, balance) =>
   `🎉 <b>市场已激活！</b>\n\n` +
   `💵 已扣款: <b>$${fee}</b>\n` +
   `💳 新余额: <b>$${balance.toFixed(2)}</b>\n\n` +
   `欢迎 — 正在打开市场…`,

 // 呼叫转移 (Cloud IVR)
 fwdInsufficientBalance: (walletBal, rate) => `🚫 <b>余额不足</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · 需要 $${rate}/分钟\n👉 通过 👛 钱包 充值 <b>$25</b>。`,
 fwdBlocked: (number) => `🚫 <b>已阻止</b> — ${number} 是高费率目的地。\n点击 💬 <b>获取支持</b> 申请激活。`,
 fwdNotRoutable: (number) => `⚠️ ${number} 不可达。请检查号码或点击 💬 <b>获取支持</b>。`,
 fwdValidating: '⏳ 验证中...',
 fwdEnterNumber: (rate, walletBal, usRate) => {
 let text = `输入含国家代码的号码（例：+14155551234）\n\n💰 <b>转接费率</b> — 按分钟从钱包扣费：\n🇺🇸 美国/加拿大：<b>$${Number(usRate).toFixed(2)}/分钟</b>\n🌍 国际：<b>$${Number(rate).toFixed(2)}/分钟</b>`
 if (walletBal !== undefined) {
 const estUs = usRate > 0 ? Math.floor(walletBal / usRate) : 0
 const estIntl = rate > 0 ? Math.floor(walletBal / rate) : 0
 text += `\n\n💳 钱包：<b>$${walletBal.toFixed(2)}</b> — 约可用 <b>${estUs} 分钟</b>（美加）或 <b>${estIntl} 分钟</b>（国际），之后需充值。`
 if (walletBal < rate) text += `\n⚠️ 请先通过 👛 钱包 充值 <b>$25</b>。`
 }
 return text
 },
 fwdConfirm: (number, forwardTo, modeLabel, rate, walletBal, estMin) => {
 return `📲 <b>确认呼叫转接</b>\n\n📞 您的号码：<b>${number}</b>\n➡️ 转接至：<b>${forwardTo}</b>\n⚙️ 模式：<b>${modeLabel}</b>\n💰 费率：<b>$${Number(rate).toFixed(2)}/分钟</b> — 从钱包扣费\n💳 钱包：<b>$${walletBal.toFixed(2)}</b> — 约可用 <b>${estMin} 分钟</b>\n\n点击 <b>✅ 确认</b> 启用转接，或 ↩️ 返回 修改号码。`
 },
 fwdConfirmBtn: '✅ 确认并启用',
 planNotFound: '找不到套餐。',
 noActivePlans: '📋 <b>我的托管计划</b>\n\n您没有活跃的托管计划。购买一个计划开始使用！',
 noRegisteredDomains: '您没有注册域名。请注册新域名或连接外部域名。',
 selectFromDomains: '从已注册的域名中选择：',
 selectDomainFromList: '请从列表中选择域名。',
 enterValidDomain: '请输入有效的域名（例：example.com）。',
 enterCouponCode: '输入优惠码：',
 invalidCoupon: '优惠码无效。请重试或点击跳过。',
 couponAlreadyUsed: '优惠码已使用。请换一个或点击跳过。',
 couponUsedToday: '⚠️ 您今天已使用过此优惠码。',
 keyboardRefreshed: '键盘已刷新！请选择一个选项：',
 supportEnded: '✅ 支持会话已结束。感谢您的联系！',
 noSupportSession: '没有活跃的支持会话。',
 supportMsgReceived: '✉️ 消息已收到！支持人员将尽快回复您。',
 supportMsgSent: '✉️ 消息已发送至支持团队，我们将尽快回复。',
 someIssue: '出现问题',
 dbConnecting: '数据库连接中，请稍后重试',
 chooseValidDomain: '请选择有效的域名',
 dnsCustomOnly: 'DNS记录由您的自定义域名服务器管理。您只能更新域名服务器或切换DNS提供商。',
 noDeleteRecords: '没有可删除的记录。域名服务器记录只能更新。',
 invalidSrvFormat: '格式无效。请使用 <b>_service._protocol</b>（例：_sip._tcp）：',
 insufficientBalance: (usdBal, price) => `⚠️ 钱包余额不足。您有 $${usdBal}，需要 $${price}。\n请先充值。`,
 leadSelectMetro: (target) => `📍 选择 <b>${target}</b> 的城市区域：\n\n选择"所有城市"以获得最大覆盖。`,
 leadSelectArea: (target, city) => `📞 选择 <b>${target}</b> — <b>${city}</b> 的区号：\n\n"混合区号"提供最大号码池。`,
 leadRequestCustom: '📝 <b>自定义线索请求</b>\n\n告诉我们您想要哪个机构或公司的线索。\n我们提供经过验证的真实号码：',
 leadCustomCity: (target) => `🏙️ 您想要哪个城市的线索？\n\n目标：<b>${target}</b>\n\n输入城市名或"全国"：`,
 leadCustomDetails: (target, city) => `📋 其他详细信息？\n\n目标：<b>${target}</b>\n区域：<b>${city}</b>\n\n输入详情或"无"跳过：`,
 leadAllCities: '所有城市',
 leadNationwide: '全国',
 leadNone: '无',
 leadRequestTarget: '📝 自定义目标请求',
 noPendingLeads: '📝 没有待处理的线索请求。',
 backupCreated: '备份创建成功。',
 dataRestored: '数据恢复成功。',
 vpsRefundFailed: (currency, amount, error) => `❌ <b>VPS 部署失败</b>\n\n✅ 已退款 ${currency}${amount}。\n\n错误：${error}`,
 shortenerConflict: (domain, plan) => `❌ 无法激活 — <b>${domain}</b> 有活跃的托管计划（<b>${plan}</b>）。请使用其他域名。`,
 shortenerLinked: (domain) => `✅ <b>${domain}</b> 已关联到短链接。DNS传播约24小时。`,
 shortenerError: (domain, error) => `❌ 短链接激活错误 <b>${domain}</b>：${error}`,
 domainSearching: (domain) => `🔍 搜索 ${domain} 的可用性...`,
 domainNotAvailable: (domain) => `❌ <b>${domain}</b> 不可用。`,
 domainSearchAlts: (baseName) => `🔍 搜索 <b>${baseName}</b> 的替代方案...`,
 domainAltsFound: (altList) => `✅ 可用替代方案：\n\n${altList}\n\n输入域名检查：`,
 dnsLinkError: (domain, error) => `❌ 无法关联 <b>${domain}</b>：${error}`,
 dnsSaveError: (domain, error) => `❌ DNS错误 <b>${domain}</b>：${error}`,
 selectProceedOrCancel: '请选择"继续"或"取消"。',

 // ── Email Blast i18n ──
 ebSendBlast: '📤 发送群发邮件',
 ebMyCampaigns: '📬 我的活动',
 ebAdminPanel: '⚙️ 管理面板',
 ebCancelBtn: '❌ 取消',
 ebCancelled: '❌ 已取消。',
 ebUploadCsvTxt: '📎 请上传 CSV/TXT 文件或粘贴电子邮件地址（每行一个）。',
 ebUploadCsvOnly: '❌ 请上传 <b>.csv</b> 或 <b>.txt</b> 文件。',
 ebUploadHtmlFile: '📎 请上传 <b>.html</b> 文件，或点击 ❌ 取消重新开始。',
 ebTypeOrUpload: '📝 请输入您的邮件内容或上传 HTML 文件。',
 ebEnterSubject: '✏️ 输入新的<b>主题</b>行：',
 ebChooseTextOrHtml: '请选择："📝 输入纯文本" 或 "📎 上传 HTML"',
 ebTypeText: '📝 输入纯文本',
 ebUploadHtml: '📎 上传 HTML',
 ebInvalidEmail: '❌ 无效的电子邮件地址。请输入有效邮箱（例如：you@gmail.com）：',
 ebFailedReadHtml: '❌ 无法读取 HTML 文件。请重试或上传其他文件。',
 ebBundleNotFound: '❌ 未找到套餐。',
 ebCampaignNotFound: '❌ 未找到活动。',
 ebTestSending: (addr) => `⏳ 正在通过 Brevo 发送测试邮件到 <b>${addr}</b>...`,
 ebAddDomainBtn: '➕ 添加域名',
 ebRemoveDomainBtn: '❌ 移除域名',
 ebDashboardBtn: '📊 仪表盘',
 ebManageDomainsBtn: '🌐 管理域名',
 ebManageIpsBtn: '🖥️ 管理IP和预热',
 ebPricingBtn: '💰 定价设置',
 ebSuppressionBtn: '🚫 屏蔽列表',
 ebAddIpBtn: '➕ 添加IP',
 ebPauseIpBtn: '⏸ 暂停IP',
 ebResumeIpBtn: '▶️ 恢复IP',
 ebAdminPanelTitle: '⚙️ <b>邮件管理面板</b>',
 ebNoDomains: '📭 未配置域名。',
 ebDomainRemoved: (d) => `✅ 域名 <b>${d}</b> 已成功移除。\n\nDNS 记录已清理。`,
 ebDomainRemoveFailed: (err) => `❌ 移除失败：${err}`,
 ebInvalidDomain: '❌ 无效的域名。请输入有效域名（例如 example.com）',
 ebInvalidIp: '❌ 无效的IP地址。请输入有效的 IPv4（例如 1.2.3.4）',
 ebSettingUpDomain: (d) => `⏳ 正在设置 <b>${d}</b>...\n\n创建 DNS 记录，生成 DKIM 密钥...`,
 ebNoActiveIps: '没有活跃的IP可以暂停。',
 ebNoPausedIps: '没有已暂停的IP。',
 ebIpPaused: (ip) => `⏸ IP ${ip} 已暂停。`,
 ebIpResumed: (ip) => `▶️ IP ${ip} 已恢复。`,
 ebRateUpdated: (rate) => `✅ 费率已更新为 <b>$${rate}/封</b> （$${(rate * 500).toFixed(0)}/500封）`,
 ebMinUpdated: (min) => `✅ 最低邮件数已更新为 <b>${min}</b>`,
 ebInvalidRate: '❌ 无效。请输入数字，例如 0.10',
 ebInvalidMin: '❌ 无效。请输入数字。',
 ebSelectIpDomain: (ip) => `🖥️ 将IP <b>${ip}</b> 分配到哪个域名？`,

 // ── Audio Library / IVR i18n ──
 audioLibTitle: '🎵 <b>音频库</b>',
 audioLibEmpty: '🎵 <b>音频库</b>\n\n您没有已保存的音频文件。\n\n上传音频文件（MP3、WAV、OGG）用于 IVR 活动。',
 audioLibEmptyShort: '🎵 <b>音频库</b>\n\n没有音频文件。上传一个开始使用。',
 audioUploadBtn: '📎 上传音频',
 audioUploadNewBtn: '📎 上传新音频',
 audioUseTemplateBtn: '📝 使用 IVR 模板',
 audioSelectOption: '请选择一个选项：',
 audioSelectIvr: '选择 IVR 音频：',
 audioReceived: (size) => `✅ 音频已接收！(${size} KB)\n\n为其命名：`,
 audioReceivedShort: '✅ 音频已接收！\n\n请命名：',
 audioSaved: (name) => `✅ 音频已保存为：<b>${name}</b>\n\n您现在可以在 IVR 活动中使用它！`,
 audioDeleted: (name) => `✅ 已删除：<b>${name}</b>`,
 audioGenFailed: (err) => `❌ 音频生成失败：${err}`,
 audioFailedSave: '❌ 无法保存音频问候。请重试。',
 audioMaxImages: '📸 最多5张图片。点击 ✅ 完成上传 继续。',

 // ── Common i18n ──
 chooseOption: '请选择一个选项：',
 refreshStatusBtn: '🔄 刷新状态',
 cancelRefundBtn: '❌ 取消并退款',
 dbConnectRetry: '数据库正在连接中，请稍后重试',
 nsCannotAdd: '无法添加域名服务器记录。使用<b>更新 DNS 记录</b>来更改域名服务器。',
 noSupportSession: '没有活跃的支持会话。',
 noPendingLeads: '📝 没有待处理的潜在客户请求。',
 invalidAmountPositive: '⚠️ 金额必须是正数。',

 // ── Marketplace ──
 mpHome: '🏪 <b>NOMADLY 市场</b>\n\n💰 <b>出售你的数字商品</b> — 60秒发布，即时收款\n🛍️ <b>发现独家优惠</b> — 经验证的卖家，真实交易\n\n🔒 所有购买<b>必须使用</b> @Lockbaybot <b>托管</b>\n⚠️ 切勿直接向卖家或通过卖家的机器人付款 — 仅限托管。\n\n👇 准备好赚钱或购物了吗？',
 mpBrowse: '🔥 浏览优惠',
 mpListProduct: '💰 开始出售',
 mpMyConversations: '💬 我的对话',
 mpMyListings: '📦 我的商品',
 mpAiHelper: '🤖 AI助手',
 mpAiHelperPrompt: '🤖 <b>市场AI助手</b>\n\n询问我有关购买、出售、托管或市场安全的任何问题。\n\n在下方输入您的问题，或点击 ↩️ 返回。',
 mpAiThinking: '🤖 思考中...',
 mpAiScamWarning: '🚨 <b>AI安全警报</b>\n\n⚠️ 此消息可能包含可疑的付款请求。请记住：\n\n🔒 <b>始终使用 @Lockbaybot 托管</b>\n❌ 切勿通过PayPal、CashApp、加密货币或电汇付款\n📢 如果您感到不安全，请输入 /report\n\n您的安全是我们的首要任务。',
 mpUploadImages: '📸 上传产品图片（1-5张）。\n逐张发送。完成后点击 ✅ 上传完成。',
 mpDoneUpload: '✅ 上传完成',
 mpEnterTitle: '📝 输入产品标题（最多100个字符）：',
 mpEnterDesc: '📄 输入产品描述（最多500个字符）：',
 mpEnterPrice: '💰 设置价格（$20 - $5,000 美元）：',
 mpSelectCategory: '🏷️ 选择类别：',
 mpPreview: (title, desc, price, category, imageCount) =>
 `✅ <b>产品预览</b>\n\n📦 <b>${title}</b>\n📄 ${desc}\n💰 <b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n📸 ${imageCount} 张图片\n\n🔒 通过 @Lockbaybot 托管保护`,
 mpPublish: '✅ 发布',
 mpCancel: '❌ 取消',
 mpEditProduct: '✏️ 编辑',
 mpRemoveProduct: '❌ 删除商品',
 mpMarkSold: '✅ 标记为已售',
 mpProductPublished: '🎉 您的商品已上线！\n\n买家现在可以发现它。\n\n⚠️ <b>提醒：</b>所有销售必须通过 @Lockbaybot 托管。\n\n💡 <b>快速出售技巧：</b>\n• 快速回复咨询\n• 添加清晰的照片和详细描述\n• 设定有竞争力的价格',
 mpProductRemoved: '✅ 商品已删除。',
 mpProductSold: '✅ 商品已标记为已售。',
 mpMaxListings: '❌ 您已达到10个活跃商品的上限。请删除或标记为已售。',
 mpPriceError: '❌ 价格必须在 $20 到 $5,000 美元之间。',
 mpNoImage: '📸 请至少上传一张产品图片。',
 mpImageAsPhoto: '📸 请以照片形式发送，而不是文件。',
 mpOwnProduct: '❌ 您不能咨询自己的商品。',
 mpNoProducts: '📭 未找到产品。稍后再来看看！',
 mpNoListings: '📭 您还没有商品。',
 mpNoConversations: '📭 没有活跃的对话。',
 mpChatStartBuyer: (title, price) =>
 `💬 您正在与卖家讨论 <b>${title}</b>（$${price}）\n\n⚠️ <b>必须使用托管</b> — 输入 /escrow 通过 @Lockbaybot 安全支付\n❌ 切勿直接向卖家或通过其机器人付款。\n\n💡 购买前请索要详情或证明。\n发送 /done 结束聊天。`,
 mpChatStartSeller: (title) =>
 `💬 🔔 一位买家对 <b>${title}</b> 感兴趣！\n🔒 通过 @Lockbaybot 托管保护\n\n💡 提示：快速回复 — 响应快的卖家成交更多。\n在下方回复。发送 /done 结束聊天。`,
 mpMessageSent: '✅ 消息已发送',
 mpSellerChatReady: (title) =>
 `💬 您已进入 <b>${title}</b> 的聊天。\n在下方输入回复。发送 /done 退出, /escrow 开始托管, /price XX 建议价格。`,
 mpBuyerSays: (msg) => `💬 <b>买家：</b> ${msg}`,
 mpSellerSays: (msg) => `💬 <b>卖家：</b> ${msg}`,
 mpChatEnded: '💬 对话已结束。双方已收到通知。',
 mpChatEndedNotify: (title) => `💬 关于 <b>${title}</b> 的对话已关闭。`,
 mpChatInactive: (title) => `💬 关于 <b>${title}</b> 的对话因不活跃已关闭。`,
 mpSellerOffline: '⏳ 卖家24小时未回复。您可以浏览其他商品。',
 mpRateLimit: '⚠️ 消息限制已达到。请稍后再发送。',
 mpOnlyTextPhoto: '⚠️ 市场聊天中只能发送文字和照片。',
 mpPaymentWarning: '🚨 <b>警告：检测到直接付款请求！</b>\n\n❌ 切勿直接向卖家或通过其机器人付款。\n🔒 通过 @Lockbaybot 托管是<b>强制性的</b>。\n📢 如感到不安全，请输入 /report。',
 mpEscrowMsg: (title, price, sellerRef) =>
 `🔒 <b>托管 — 强制性购买</b>\n\n📦 产品：<b>${title}</b>\n💰 价格：<b>$${Number(price).toFixed(2)}</b>\n👤 卖家：<b>${sellerRef}</b>\n\n1. 打开 @Lockbaybot\n2. 与 <b>${sellerRef}</b> 创建 <b>$${Number(price).toFixed(2)}</b> 的托管\n3. 双方确认\n\n⚠️ 切勿在托管之外或通过卖家的机器人付款`,
 mpPriceSuggest: (role, amount) => `💰 <b>${role}</b> 建议：<b>$${amount}</b>`,
 mpPriceUsage: '用法：/price 50 建议 $50',
 mpPriceInvalid: '❌ 金额无效。必须在 $20 到 $5,000 之间。',
 mpReported: '✅ 举报已提交。管理员将审查此对话。',
 mpChatMode: '⚠️ 您正在市场聊天中。发送 /done 退出。',
 mpExistingConv: '💬 您已有关于此产品的活跃对话。恢复中...',
 mpAllCategories: '📋 所有类别',
 mpEditWhat: '✏️ 您想编辑什么？',
 mpEditTitle: '📝 编辑标题',
 mpEditDesc: '📄 编辑描述',
 mpEditPrice: '💰 编辑价格',
 mpTitleUpdated: '✅ 标题已更新。',
 mpDescUpdated: '✅ 描述已更新。',
 mpPriceUpdated: '✅ 价格已更新。',
 mpListingRemoved: '📦 [商品已删除]',
 mpSellerStats: (sales, since) => `⭐ 卖家：${sales} 笔交易 | 加入于 ${since}`,
 mpProductCard: (title, price, category, sellerStats) =>
 `🏷️ <b>${title}</b>\n💰 <b>$${Number(price).toFixed(2)}</b> · ${category}\n${sellerStats}\n🔒 ⚠️ 必须使用托管 — 仅通过 @Lockbaybot 付款`,
 mpProductDetail: (title, desc, price, category, sellerStats, listedAgo) =>
 `📦 <b>${title}</b>\n\n📄 ${desc}\n\n💰 价格：<b>$${Number(price).toFixed(2)}</b>\n📂 ${category}\n${sellerStats}\n📅 发布：${listedAgo}\n\n🔒 <b>必须使用托管</b>\n仅通过 @Lockbaybot 托管付款。切勿直接向卖家或通过其机器人付款。`,
 mpMyListingsHeader: (count, max) => `📦 <b>我的商品</b>（${count}/${max}）`,
 mpConvHeader: '💬 <b>我的对话</b>',
 mpConvItem: (title, role, lastMsg) => `💬 <b>${title}</b>（${role}）— ${lastMsg}`,
 mpDoneCmd: '/done',
 mpEscrowCmd: '/escrow',
 mpPriceCmd: '/price',
 mpReportCmd: '/report',
 mpEnteredChat: (title, price) => `💬 您已进入 <b>${title}</b>（$${price}）的聊天\n发送 /done 退出，/escrow 开始托管，/price XX 建议价格。`,
 mpResumedChat: (title, price, role) => `💬 恢复聊天：<b>${title}</b>（$${price}）— 您是${role}\n⚠️ <b>必须使用托管</b> — 仅通过 @Lockbaybot 付款。切勿直接向卖家或通过其机器人付款。\n\n发送 /done 退出，/escrow 开始托管，/price XX 建议价格。`,
 mpBuyerPhotoCaption: '💬 买家发送了一张照片：',
 mpSellerPhotoCaption: '💬 卖家发送了一张照片：',
 mpChatClosedReset: (title) => `💬 关于 <b>${title}</b> 的对话已被对方关闭。您已返回市场。`,
 mpSellerBusy: (title) => `🆕 <b>${title}</b> 有新的咨询！准备好后点击下方按钮回复。`,
 mpCatDigitalGoods: '💻 数字商品',
 mpCatBnkLogs: '🏦 银行日志',
 mpCatBnkOpening: '🏧 银行开户',
 mpCatTools: '🔧 工具',
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
 cp_nested_1: (count, numberList) => `📞 <b>批量：${count} 个号码</b>\n${numberList}\n\n请选择 IVR 模板类别：`,
 cp_nested_2: (icon, firstPh, desc, hint) => `\n${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_3: (icon, firstPh, desc, hint) => `${icon} <b>[${firstPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_4: (currentPh, value, icon, nextPh, desc, hint) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${desc}\n\n<i>${hint}</i>`,
 cp_nested_5: (target, msg) => `❌ 对 ${target} 的批量呼叫失败：${msg}`,
 cp_nested_6: (refundAmt, walletLine) => `💰 <b>${refundAmt}</b> 已退回您的钱包。\n${walletLine}`,
 cp_nested_7: (cleanedMsg, balMsg) => `🔄 <b>重新开始！</b>\n\n${cleanedMsg}${balMsg}\n\n您现在可以从头开始购买新的电话号码。`,
 cp_nested_8: (msg) => `❌ 赢回错误：${msg}`,
 cp_nested_9: (target, city, detailsLine) => `✅ <b>申请已提交！</b>\n\n🎯 目标：<b>${target}</b>\n🏙️ 地区：<b>${city}</b>${detailsLine}\n\n我们的团队将审核您的申请，并在这些线索可用时通知您。谢谢！`,
 cp_nested_hint_default: (ph) => `输入 [${ph}] 的值`,
 cp_nested_cleared: (count, refunded) => `✅ 清除了 ${count} 个被拒绝的验证\n💰 $${refunded} 已退还至钱包\n`,
 // === Voice Service ===
 vs_callDisconnectedWallet: (rate, connFee) => `🚫 <b>通话断开</b> — 余额不足（需要$\${rate}/分钟 + $\${connFee}连接费）。通过 👛 钱包充值。`,
 vs_callDisconnectedExhausted: '🚫 <b>通话断开</b> — 余额耗尽。\n通过 👛 钱包充值。',
 vs_outboundCallFailed: (from, to, reason) => `🚫 <b>外呼失败</b>\n📞 \${from} → \${to}\n原因：\${reason}`,
 vs_planMinutesExhausted: (phone, used, limit, overage) => `⚠️ <b>套餐分钟耗尽</b>\n\n📞 \${phone}\n已用：<b>\${used}/\${limit}</b> 分钟\n\${overage}`,
 vs_planSmsExhausted: (phone, used, limit) => `⚠️ <b>套餐短信耗尽</b>\n\n📞 \${phone}\n已用：<b>\${used}/\${limit}</b> 条来电短信`,
 vs_orphanedNumber: (to, from) => `⚠️ <b>孤立号码警报</b>\n\n📞 <code>\${to}</code> 收到来自 <code>\${from}</code> 的来电\n\n❌ 数据库中无所有者 — 来电拒绝。`,
 vs_incomingCallBlocked: (to, from) => `🚫 <b>来电拦截 — 余额为空</b>\n\n📞 \${to}\n👤 来电者：\${from}`,
 vs_overageActive: (charged, rateInfo) => `💰 <b>超额使用</b> — 套餐分钟耗尽。\${charged}（\${rateInfo}）`,
 vs_callEndedExhausted: (elapsed) => `🚫 <b>通话结束</b> — 分钟+余额均耗尽。\n⏱️ ~\${elapsed} 分钟。请充值或升级套餐。`,
 vs_outboundCallBlocked: (from, to, reason) => `🚫 <b>外呼拦截</b>\n📞 \${from} → \${to}\n原因：\${reason}`,
 vs_sipCallBlocked: (rate, connFee) => `🚫 <b>SIP呼叫拦截</b> — 余额不足（需要$\${rate}/分钟 + $\${connFee}连接费）。通过 👛 钱包充值。`,
 vs_freeSipTestCall: (from, to) => `📞 <b>免费SIP测试呼叫</b>\n发起：\${from}\n接收：\${to}`,
 vs_sipOutboundCall: (from, to, planLine) => `📞 <b>SIP外呼</b>\n发起：\${from}\n接收：\${to}\n\${planLine}`,
 vs_lowBalance: (bal, estMin) => `⚠️ <b>余额不足</b> — $\${bal}（约\${estMin}分钟）。通过 👛 钱包充值 <b>$25</b>。`,
 vs_forwardingBlocked: (bal, rate) => `🚫 <b>转接拦截</b> — 余额 $\${bal}（需要$\${rate}/分钟）。通过 👛 钱包充值。`,
 vs_ivrForwardBlocked: (phone, forwardTo, bal) => `🚫 <b>IVR转接拦截 — 余额为空</b>\n\n📞 \${phone}\n📲 转接至：\${forwardTo}\n💰 余额：$\${bal}`,
 vs_lowBalanceIvr: (bal, estMin) => `⚠️ <b>余额不足</b> — $\${bal}（约\${estMin}分钟IVR）。通过 👛 钱包充值。`,
 vs_callForwarded: (to, forwardTo, from, duration, planLine, time) => `📞 <b>来电已转接</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 \${from}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_forwardFailed: (to, forwardTo, from, time) => `📞 <b>转接 — 无应答</b>\n\n📞 \${to} → 📲 \${forwardTo}\n👤 来电者：\${from}\n📲 \${forwardTo} 未接听\n🕐 \${time}`,
 vs_sipCallFailed: (from, to, time) => `❌ <b>SIP呼叫失败 — 转接无应答</b>\n\n📞 发起：\${from}\n📲 接收：\${to}\n🕐 \${time}`,
 vs_sipCallEnded: (from, to, duration, planLine, time) => `📞 <b>SIP通话结束</b>\n\n📞 发起：\${from}\n📲 接收：\${to}\n⏱️ \${duration}\n\${planLine}\n🕐 \${time}`,
 vs_freeTestCallEnded: (from, to, duration, time) => `📞 <b>免费测试通话结束</b>\n\n📞 发起：\${from}\n📲 接收：\${to}\n⏱️ \${duration}\n🕐 \${time}`,
 vs_missedCall: (to, from, time) => `📞 <b>未接来电</b>\n\n📞 号码：\${to}\n👤 来自：\${from}\n🕐 \${time}`,
 vs_ivrCallRouted: (to, from, digit, forwardTo, time) => `📞 <b>IVR来电路由</b>\n\n📞 号码：\${to}\n👤 来自：\${from}\n按键：<b>\${digit}</b> → 转接至 \${forwardTo}\n🕐 \${time}`,
 vs_ivrCall: (to, from, digit, time) => `📞 <b>IVR来电</b>\n\n📞 号码：\${to}\n👤 来自：\${from}\n按键：<b>\${digit}</b> → 播放消息\n🕐 \${time}`,
 vs_newVoicemail: (to, from, duration, time) => `🎙️ <b>新语音信箱</b>\n\n📞 号码：\${to}\n👤 来自：\${from}\n⏱️ 时长：\${duration}\n🕐 \${time}`,
 vs_callRecording: (to, from, duration, time) => `🔴 <b>通话录音</b>\n\n📞 号码：\${to}\n👤 来自：\${from}\n⏱️ 时长：\${duration}\n🕐 \${time}`,
 vs_listen: '收听',
 adm_error_prefix: '❌ Error: ',
 dom_confirm_prompt: '确认？',
 adm_5: '⚠️ Usage: /close <chatId>',
 adm_6: (targetName) => `✅ Closed support session for ${targetName}`,
 adm_7: '⚠️ Usage: /deliver <orderId> <product details/credentials>',
 adm_8: (orderId) => `⚠️ Order <code>${orderId}</code> not found.`,
 adm_9: (orderId) => `⚠️ Order <code>${orderId}</code> was already delivered.`,
 cp_1: '⚠️ NGN 充值暂时不可用（汇率服务中断）。请尝试使用加密货币。',
 cp_10: (TRIAL_CALLER_ID) => `📢 <b>快速 IVR 呼叫 — 免费试用</b>\n\n🎁 您可获得 <b>1 次免费试用呼叫！</b>\n📱 来电显示：<b>${TRIAL_CALLER_ID}</b>（共享）\n\n使用自动 IVR 消息呼叫单个号码。\n\n请输入要呼叫的电话号码（含国家代码）：\n<i>示例：+12025551234</i>`,
 cp_100: '🎚 <b>选择语速</b>：',
 cp_101: '❌ 语速无效。请输入 <b>0.25</b> 到 <b>4.0</b> 之间的数字：\n<i>示例：0.8 或 1.3</i>',
 cp_102: '请从按钮中选择语速：',
 cp_103: (voiceName, speedLabelDisplay) => `🎤 语音：<b>${voiceName}</b> | 🎚 语速：<b>${speedLabelDisplay}</b>\n\n⏳ 正在生成音频预览...`,
 cp_104: (message) => `❌ 音频生成失败。\n\n💡 <b>提示：</b>请尝试选择 <b>ElevenLabs</b> 作为语音提供商 — 通常更稳定。\n\n<i>错误：${message}</i>`,
 cp_105: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_106: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_107: '🎚 <b>选择语速</b>\n\n请选择语音的朗读速度：',
 cp_108: (holdMusic, v1) => `🎵 等待音乐：<b>${holdMusic}</b>\n${v1}`,
 cp_109: '您想做什么？',
 cp_11: (buyLabel) => `📞 <b>批量 IVR 活动</b>\n\n🔒 此功能需要 <b>Pro</b> 或更高套餐。\n\n请先获取一个 Cloud IVR 号码！\n\n点击 <b>${buyLabel}</b> 开始。`,
 cp_110: '音频尚未就绪。请改为点击 ✅ 确认。',
 cp_111: '⏭ <b>已跳过预览 — 准备呼叫！</b>',
 cp_112: '点击 <b>✅ 确认</b> 继续，<b>🎤 更换语音</b>，或 <b>返回</b>。',
 cp_113: '您想做什么？',
 cp_114: '🕐 <b>定时呼叫</b>\n\n从现在起多少分钟后拨出呼叫？\n\n<i>示例：5、15、30、60</i>',
 cp_115: '请输入 1 到 1440 之间的分钟数。',
 cp_116: (targetNumber, minutes, toLocaleTimeString) => `✅ <b>呼叫已安排！</b>\n\n📞 呼叫至：${targetNumber}\n🕐 时间：${minutes} 分钟后（${toLocaleTimeString} UTC）\n\n呼叫拨出时将通知您。`,
 cp_117: (toFixed, v1) => `⚠️ <b>钱包余额不足</b>\n\n快速 IVR 呼叫需要至少 <b>$${toFixed}</b> 的余额。\n\n您的余额：<b>$${v1}</b>\n\n请为钱包充值后重试。`,
 cp_118: '🚫 <b>呼叫已拦截</b>\n\n您的电话号码缺少子账户凭据。请联系支持。',
 cp_119: (batchCount, length, target) => `📞 批次 ${batchCount}/${length}：正在呼叫 ${target}...`,
 cp_12: '📞 <b>批量 IVR 活动</b>\n\n使用自动 IVR 消息呼叫多个号码。\n上传线索 CSV 并启动活动。\n\n☎️ = 支持批量 IVR 的号码\n\n📱 请选择来电显示：',
 cp_120: '💾 要将此保存为快速拨号预设以便下次使用吗？',
 cp_121: '按 <b>/yes</b> 拨打电话，或按 <b>/cancel</b> 取消。',
 cp_122: (presetName) => `✅ 预设「<b>${presetName}</b>」已保存！\n\n下次在快速 IVR 菜单中选择它即可跳过设置。`,
 cp_123: '🎵 <b>音频库</b>\n\n暂无音频文件。上传一个以开始。',
 cp_124: (audioList) => `🎵 <b>音频库</b>\n\n${audioList}`,
 cp_125: '请选择一个选项：',
 cp_126: (audioList) => `🎵 <b>音频库</b>\n\n${audioList}`,
 cp_127: '⏳ 正在下载并保存音频...',
 cp_128: '请发送音频文件（MP3、WAV、OGG）或语音消息。',
 cp_129: '请发送音频文件或语音消息：',
 cp_13: '🎵 <b>音频库</b>\n\n您还没有保存的音频文件。\n\n上传音频文件（MP3、WAV、OGG）以用于 IVR 活动。',
 cp_130: (name) => `✅ 音频已保存为：<b>${name}</b>\n\n您现在可以在批量 IVR 活动中使用它了！`,
 cp_131: '请从列表中选择来电显示。',
 cp_132: (phoneNumber) => `📱 来电显示：<b>${phoneNumber}</b>\n\n📋 <b>上传线索文件</b>\n\n发送文本文件（.txt 或 .csv），每行一个电话号码。\n可选：每行 <code>号码,姓名</code>。\n\n或直接粘贴号码（每行一个）：`,
 cp_133: '请选择来电显示：',
 cp_134: (message) => `❌ 读取文件失败：${message}\n\n请重试或直接粘贴号码。`,
 cp_134b: (fname) => `❌ <b>${fname}</b> 不是纯文本文件。\n\n请上传 <b>.txt</b> 或 <b>.csv</b> 文件（每行一个号码，或 号码,姓名），或直接粘贴号码。`,
 cp_135: '请发送文件或粘贴电话号码。',
 cp_136: (errMsg) => `❌ 未找到有效的电话号码。${errMsg}\n\n请检查格式：每行一个号码，并带有 + 国家代码。`,
 cp_137: (maxLeads, length) => `❌ <b>线索过多！</b>\n\n每个活动最多 <b>${maxLeads}</b> 个号码。\n您上传了 <b>${length}</b> 个。\n\n请缩减列表后重试。`,
 cp_138: (length, preview, more, errNote, estCost, toFixed) => `✅ <b>已加载 ${length} 条线索！</b>\n\n${preview}${more}${errNote}\n\n💰 <b>预估费用：$${estCost}</b>（每个号码 $${toFixed}/分钟，每个至少 1 分钟 — 无论是否接听均计费）\n\n🎵 <b>选择 IVR 音频</b>\n\n从音频库中选择、上传新录音，或通过 TTS 从模板生成：`,
 cp_139: '📋 请发送线索文件或粘贴号码：',
 cp_14: (audioList) => `🎵 <b>音频库</b>\n\n${audioList}\n\n上传新音频或删除现有音频：`,
 cp_140: '🎵 请发送音频文件（MP3、WAV、OGG）或语音消息：',
 cp_141: '📝 <b>从模板生成音频</b>\n\n选择一个模板类别，或编写您自己的脚本：',
 cp_142: '未找到音频。请从列表中选择。',
 cp_143: (name) => `🎵 音频：<b>${name}</b>\n\n📋 <b>选择活动模式</b>\n\n🔗 <b>转接 + 报告</b> — 线索按键时转接到您的电话 + 始终生成报告\n📊 <b>仅报告</b> — 仅跟踪谁按了键，不转接 + 始终生成报告\n\n两种模式均提供完整结果报告（谁按键、谁挂断等）`,
 cp_144: '请选择一个音频文件：',
 cp_145: '选择 IVR 音频：',
 cp_146: '⏳ 正在保存音频...',
 cp_147: (message) => `❌ 上传失败：${message}`,
 cp_148: '请发送音频文件或语音消息：',
 cp_149: (name) => `✅ 已保存为：<b>${name}</b>\n\n📋 <b>选择活动模式</b>\n\n🔗 <b>转接 + 报告</b> — 按 1 转接到您的电话\n📊 <b>仅报告</b> — 仅跟踪响应\n\n两种模式都会提供完整结果报告。`,
 cp_15: '📞 <b>新 IVR 呼叫</b>\n\n📞 <b>第 1/2 步：</b>点击<b>您的</b>哪个号码将在通话中显示为<i>来电显示</i>：',
 cp_150: '选择 IVR 音频：',
 cp_151: '🔗 <b>转接模式</b>\n\n请输入当线索按下有效按键时转接呼叫的号码：\n<i>（您的 SIP 号码或任意电话号码）</i>\n<i>示例：+41791234567</i>',
 cp_152: '📊 <b>仅报告</b> — 不转接，仅跟踪。\n\n🔘 <b>选择有效按键</b>\n\n哪些按键算作积极响应？\n\n选择一个预设或输入自定义数字：',
 cp_153: '请选择一种模式：',
 cp_154: '选择活动模式：',
 cp_155: '请输入带 + 国家代码的有效电话号码。\n<i>示例：+41791234567</i>',
 cp_156: (clean) => `🔗 转接至：<b>${clean}</b>\n\n🔘 <b>选择有效按键</b>\n\n哪些按键触发转接？\n\n选择一个预设或输入自定义数字：`,
 cp_157: '请输入转接号码：',
 cp_158: '选择活动模式：',
 cp_159: '请输入算作有效按键的数字：\n<i>示例：1,3,5 或 1 2 3</i>',
 cp_16: '没有可删除的预设。',
 cp_160: '请选择一个预设或输入数字：',
 cp_161: (join) => `🔘 有效按键：<b>${join}</b>\n\n⚡ <b>设置并发数</b>\n\n同时拨打多少个电话？（1-20）\n默认：<b>10</b>`,
 cp_162: '🔘 <b>选择有效按键</b>',
 cp_163: '请输入至少一个数字（0-9）：\n<i>示例：1,3,5</i>',
 cp_164: (join) => `🔘 有效按键：<b>${join}</b>\n\n⚡ <b>设置并发数</b>\n\n同时拨打多少个电话？（1-20）\n默认：<b>10</b>`,
 cp_165: '选择 IVR 音频：',
 cp_166: '✍️ <b>自定义脚本</b>\n\n请输入要朗读的消息。\n在文本中使用「按 1」「按 2」等来定义有效按键。\n\n<i>示例：您好，这是您的预约提醒。按 1 确认，或按 2 重新安排。</i>',
 cp_167: '请选择一个类别：',
 cp_168: '请选择一个模板：',
 cp_169: '请选择模板类别：',
 cp_17: '🗑️ <b>删除预设</b>\n\n请选择要删除的预设：',
 cp_170: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_171: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_172: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_174: (placeholders) => `请输入 <b>[${placeholders}]</b> 的值：`,
 cp_175: (join) => `🔘 有效按键：<b>${join}</b>\n\n🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：`,
 cp_176: '请选择模板类别：',
 cp_177: '请从按钮中选择一个模板。',
 cp_178: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 有效按键：<b>${join}</b>`,
 cp_179: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_18: (presetName) => `✅ 预设「${presetName}」已删除。`,
 cp_180: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_181: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_183: (placeholders) => `\n请输入 <b>[${placeholders}]</b> 的值：`,
 cp_184: '🎙 <b>选择语音</b>：',
 cp_185: '请选择模板类别：',
 cp_186: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — 已重新生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_187: (currentPh) => `✍️ 请输入 <b>[${currentPh}]</b> 的自定义值：`,
 cp_188: (currentPh) => `✍️ 请输入 <b>[${currentPh}]</b> 的回拨号码：\n<i>示例：+12025551234</i>`,
 cp_189: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_19: '未找到预设。',
 cp_190: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_191: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_193: (currentPh, value, nextPh) => `✅ ${currentPh}：<b>${value}</b>\n\n请输入 <b>[${nextPh}]</b> 的值：`,
 cp_194: '✅ 所有值已填写完毕！\n\n🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_195: '请选择模板类别：',
 cp_196: '请选择语音提供商：',
 cp_197: '🎙 <b>选择语音</b>：',
 cp_198: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_199: '请选择一个语音：',
 cp_2: (toLocaleString) => `⚠️ 最低充值金额为 ₦${toLocaleString}（≈ $10 USD）。请输入更高的金额。`,
 cp_20: (presetName, currentPlan) => `🔒 <b>预设「${presetName}」使用 OTP 收集</b>，需要 <b>Pro</b> 套餐。\n\n您当前的套餐：<b>${currentPlan}</b>\n\n请通过 🔄 续费 / 更换套餐 升级，或使用 🔗 转接模式创建新呼叫。`,
 cp_200: (name) => `🎤 语音：<b>${name}</b>\n\n🎚 <b>选择语速</b>\n\n请选择语音的朗读速度：`,
 cp_201: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_202: '✍️ 请输入自定义语速倍数：\n<i>示例：0.6（很慢）、0.9（稍慢）、1.2（较快）、1.5（很快）\n范围：0.25 到 4.0</i>',
 cp_203: '🎚 <b>选择语速</b>：',
 cp_204: '❌ 语速无效。请输入 <b>0.25</b> 到 <b>4.0</b> 之间的数字：\n<i>示例：0.8 或 1.3</i>',
 cp_205: '请从按钮中选择语速：',
 cp_206: (voiceName, speedLabel) => `🎤 语音：<b>${voiceName}</b> | 🎚 语速：<b>${speedLabel}</b>\n\n⏳ 正在生成音频...`,
 cp_207: (message) => `❌ 音频生成失败。\n\n💡 <b>提示：</b>请尝试选择 <b>ElevenLabs</b> 作为语音提供商 — 通常更稳定。\n\n<i>错误：${message}</i>`,
 cp_208: '请选择模板类别：',
 cp_209: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_21: (presetName, callerId, templateName, voiceName) => `💾 <b>已加载预设：${presetName}</b>\n📱 来自：${callerId}\n🏢 模板：${templateName}\n🎙 语音：${voiceName}\n\n请输入要呼叫的号码（多个号码用逗号分隔）：\n<i>示例：+12025551234</i>\n<i>批量：+12025551234, +12025555678</i>`,
 cp_210: '🎚 <b>选择语速</b>\n\n请选择语音的朗读速度：',
 cp_211: '❌ 未生成音频。请重试。',
 cp_212: (audioName, join) => `✅ 音频已保存：<b>${audioName}</b>\n🔘 有效按键（来自模板）：<b>${join}</b>\n\n📋 <b>选择活动模式</b>\n\n🔗 <b>转接 + 报告</b> — 线索按键时转接到您的电话 + 始终生成报告\n📊 <b>仅报告</b> — 仅跟踪谁按了键，不转接 + 始终生成报告`,
 cp_213: '点击 <b>✅ 使用此音频</b> 或 <b>🎤 更换语音</b>。',
 cp_214: '🔘 <b>选择有效按键</b>',
 cp_215: '请输入 1 到 20 之间的数字：',
 cp_216: '设置并发数（1-20）：',
 cp_217: '❌ 缺少活动数据。请重新开始。',
 cp_218: '⏳ 正在创建活动...',
 cp_219: (errorvoice) => `❌ 启动失败：${errorvoice}`,
 cp_22: '未找到符合条件的来电显示。',
 cp_220: '活动正在运行！您将在此处看到进度更新。',
 cp_221: (messagevoice) => `❌ 活动启动失败：${messagevoice}`,
 cp_222: '点击 🚀 启动活动 或 ↩️ 返回。',
 cp_223: '点击查看选项：',
 cp_224: '活动进行中。请使用下方按钮：',
 cp_225: '🛒 <b>选择套餐：</b>',
 cp_226: '🌍 <b>所有可用国家</b>\n\n请选择一个国家：',
 cp_227: (location, numberLines) => `📱 <b>可用号码 — ${location}</b>\n\n${numberLines}\n\n☎️ = 支持批量 IVR 活动\n\n点击号码进行选择：`,
 cp_228: (message, numberLines) => `📱 <b>可用号码 — ${message}</b>\n\n${numberLines}\n\n☎️ = 支持批量 IVR 活动\n\n点击号码进行选择：`,
 cp_229: (areaCode, numberLines) => `📱 <b>可用号码 — 区号 ${areaCode}</b>\n\n${numberLines}\n\n☎️ = 支持批量 IVR 活动\n\n点击号码进行选择：`,
 cp_23: (phoneNumber, recentNumber) => `📱 来自：<b>${phoneNumber}</b>\n📞 呼叫至：<b>${recentNumber}</b>\n\n请选择 IVR 模板类别：`,
 cp_230: (location, numberLines) => `📱 <b>更多号码 — ${location}</b>\n\n${numberLines}\n\n☎️ = 支持批量 IVR 活动\n\n点击号码进行选择：`,
 cp_231: '此套餐尚未推出。请从下方可用套餐中选择。',
 cp_232: (planLabel) => `✅ 套餐：<b>${planLabel}</b>\n\n🌍 请选择一个国家：`,
 cp_233: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 cp_234: (toLocaleString) => `Cloud IVR ₦${toLocaleString}`,
 cp_235: '⚠️ 升级会话已过期。请重新开始。',
 cp_236: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 cp_237: (toLocaleString) => `套餐升级 ₦${toLocaleString}`,
 cp_238: '⚠️ 升级会话已过期。请重新开始。',
 cp_239: '⚠️ 未找到被拒绝的验证。请重新购买号码。',
 cp_24: '💡 请点击下方键盘中您的某个电话号码。\n\n<i>请勿在此输入您要拨打的号码 — 那是下一步。请先选择您的哪个号码将显示为来电显示。</i>',
 cp_240: '⚠️ 未找到被拒绝的验证。',
 cp_243: '⬇️ 请选择下方选项：',
 cp_244: '⚠️ 请至少输入：<code>街道, 城市, 国家</code>\n\n示例：<i>123 Main St, Sydney, Australia</i>',
 cp_245: (countryName, toFixed, showWallet) => `❌ ${countryName} 的合规设置失败。\n\n💰 已退款 <b>$${toFixed}</b>。\n${showWallet}`,
 cp_246: (toFixed, showWallet) => `❌ 合规设置失败。\n\n💰 已退款 <b>$${toFixed}</b>。\n${showWallet}`,
 cp_247: (toFixed, showWallet) => `❌ 合规设置失败。\n\n💰 已退款 <b>$${toFixed}</b>。\n${showWallet}`,
 cp_248: (showWallet) => `❌ 合规设置失败。\n\n💰 款项已退回您的钱包。\n${showWallet}`,
 cp_249: '💡 <b>充分利用您的号码</b>\n\n📲 <b>设置呼叫转移</b> — 让您的真实手机响铃\n🤖 <b>添加 IVR 问候语</b> — 专业的自动话务员\n💬 <b>启用短信</b> — 收发短信\n\n点击下方「管理号码」进行配置。',
 cp_25: (phoneNumber) => `📞 <b>呼出号码：</b>${phoneNumber}\n\n📝 请输入您要<b>呼叫</b>的电话号码：\n<i>示例：+12025551234</i>\n\n<i>📦 如需同时呼叫多个号码，请用逗号分隔 — 例如 +12025551234, +12025555678</i>`,
 cp_250: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 cp_251: (label, toLocaleString) => `${label} ₦${toLocaleString}`,
 cp_252: (numLines) => `📱 <b>请选择要添加号码的套餐：</b>\n\n${numLines}`,
 cp_253: (selectedNumber) => `✅ <b>好消息！您的资料已获批准！</b>\n\n🔄 正在为您激活号码 <code>${selectedNumber}</code>...`,
 cp_254: '⚠️ 无法刷新状态。请重试。',
 cp_255: '⚠️ 此订单无法取消 — 它已在处理中或已完成。',
 cp_256: (selectedNumber, toFixed, showWallet) => `✅ <b>订单已取消</b>\n\n您对 <code>${selectedNumber}</code> 的待处理订单已取消。\n\n💰 <b>$${toFixed}</b> 已退回您的钱包。\n${showWallet}`,
 cp_257: '⚠️ 无法取消订单。请联系支持。',
 cp_258: '请选择一个选项：',
 cp_259: '🌍 <b>所有可用国家</b>\n\n请选择一个国家：',
 cp_26: '📢 <b>快速 IVR 呼叫</b>\n\n使用自动 IVR 消息呼叫一个号码。\n\n📞 <b>第 1/2 步：</b>点击<b>您的</b>哪个号码将在通话中显示为<i>来电显示</i>：',
 cp_260: (subNumbersAvailable, numberLines, bulkIvrSupport, tapToSelect) => `${subNumbersAvailable}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_261: (subNumberSelected, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberSelected}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_262: (subNumberArea, numberLines, bulkIvrSupport, tapToSelect) => `${subNumberArea}\n\n${numberLines}\n\n${bulkIvrSupport}\n\n${tapToSelect}`,
 cp_263: (numberLines) => `📱 <b>更多号码</b>\n\n${numberLines}\n\n☎️ = 支持批量 IVR\n\n点击选择：`,
 cp_264: (newState, v1) => `🎵 等待音乐：<b>${newState}</b>\n${v1}`,
 cp_265: '请输入以 http:// 或 https:// 开头的有效 URL。',
 cp_266: '📝 请输入来电者将听到的问候语：',
 cp_267: '🎙️ 请发送语音消息或音频文件。',
 cp_268: '✅ 已收到音频。保存为问候语？',
 cp_269: '🎤 <b>自定义问候语</b>\n\n请选择创建问候语的方式：',
 cp_27: '请输入以 + 开头、10-15 位数字的有效电话号码。\n<i>示例：+12025551234</i>\n\n<i>📦 如需同时呼叫多个号码，请用逗号分隔。</i>',
 cp_270: (message) => `📋 <b>${message}</b>\n\n请选择一个问候语模板：`,
 cp_271: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ 您可以编辑此文本 — 直接在下方输入修改后的版本。\n或点击 <b>✅ 直接使用</b> 以继续使用此问候语。`,
 cp_272: '📋 <b>问候语模板</b>\n\n请选择一个类别：',
 cp_273: '🌐 请选择语音信箱问候语的语言：\n\n<i>模板将自动翻译为您选择的语言。</i>',
 cp_274: '✅ 文本已更新。\n\n🌐 请选择语音信箱问候语的语言：\n\n<i>问候语将自动翻译为您选择的语言。</i>',
 cp_275: '🎤 <b>自定义问候语</b>\n\n请选择：',
 cp_276: '🔄 正在生成音频预览...',
 cp_277: (voice) => `✅ 预览（${voice}）\n\n保存此问候语？`,
 cp_278: (message) => `❌ 音频生成失败：${message}`,
 cp_279: (translatedText) => `🌐 <b>翻译后的问候语：</b>\n\n<i>${translatedText}</i>\n\n🎙️ 请选择一个语音：`,
 cp_280: '🎙️ 请选择一个语音：',
 cp_281: '🎙 请选择语音提供商：',
 cp_282: (message) => `🌐 正在翻译为${message}...`,
 cp_283: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_284: '🌐 请选择问候语的语言：',
 cp_285: '📝 请输入问候语文本：',
 cp_286: (message) => `🌐 请选择问候语的语言：\n\n<i>"${message}"</i>`,
 cp_287: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_288: '🌐 请选择问候语的语言：',
 cp_289: '📝 请输入问候语文本：',
 cp_29: '🔍 正在查询号码...',
 cp_290: '🎙️ 请发送语音消息或音频文件。',
 cp_291: '✅ 已收到音频。保存？',
 cp_292: '✅ 语音信箱问候语已保存！',
 cp_293: '🎤 <b>设置 IVR 问候语</b>\n\n请选择创建问候语的方式：',
 cp_294: (usedKeys) => `➕ <b>添加菜单选项</b>\n\n已使用的按键：${usedKeys}\n\n请输入此选项的按键数字（0-9）：`,
 cp_295: '📝 请输入来电者将听到的问候语。\n\n<i>示例："感谢致电 Nomadly。销售请按 1，客服请按 2。"</i>',
 cp_296: '🎙️ 请发送用作 IVR 问候语的语音消息或音频文件。',
 cp_297: '📋 <b>问候语模板</b>\n\n面向金融机构的专业模板 — 反欺诈热线、客户支持、非工作时间等。请选择一个类别：',
 cp_298: '请选择一个选项：',
 cp_299: '🎤 <b>设置 IVR 问候语</b>\n\n请选择创建问候语的方式：',
 cp_3: '🛡️🔥 Anti-Red 托管目前不可用。请点击键盘上的 <b>💬 获取支持</b> 联系我们。',
 cp_30: (titleCase) => `📋 已找到：<b>${titleCase}</b>`,
 cp_300: (message) => `📋 <b>${message}</b>\n\n请选择一个问候语模板：`,
 cp_301: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ 您可以编辑此文本 — 直接在下方输入修改后的版本。\n或点击 <b>✅ 直接使用</b> 以继续使用此问候语。`,
 cp_302: '📋 <b>问候语模板</b>\n\n请选择一个类别：',
 cp_303: '🌐 请选择 IVR 问候语的语言：\n\n<i>模板将自动翻译为您选择的语言。</i>',
 cp_304: '✅ 文本已更新。\n\n🌐 请选择 IVR 问候语的语言：\n\n<i>问候语将自动翻译为您选择的语言。</i>',
 cp_305: '🎤 <b>设置 IVR 问候语</b>\n\n请选择创建问候语的方式：',
 cp_306: '🔄 正在生成音频预览...',
 cp_307: (voice) => `✅ 预览已生成（${voice}）\n\n✅ 保存此问候语？\n🔄 尝试其他语音？\n📝 重新输入文本？`,
 cp_308: (message) => `❌ 音频生成失败：${message}\n\n请重试或上传您自己的音频。`,
 cp_309: (translatedText) => `🌐 <b>翻译后的问候语：</b>\n\n<i>${translatedText}</i>\n\n🎙️ 请选择一个语音：`,
 cp_31: '⏳ 正在为预设重新生成音频（之前的音频已过期）...',
 cp_310: '🎙️ 请为您的问候语选择一个语音：',
 cp_311: '🎙 请选择语音提供商：',
 cp_312: (message) => `🌐 正在翻译为${message}...`,
 cp_313: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_314: '🌐 请选择 IVR 问候语的语言：',
 cp_315: '📝 请输入来电者将听到的问候语：',
 cp_316: (message) => `🌐 请选择 IVR 问候语的语言：\n\n<i>"${message}"</i>`,
 cp_317: '✅ 已收到音频。保存为您的 IVR 问候语？',
 cp_318: '❌ 音频处理失败。请重试。',
 cp_319: '🎙️ 请发送语音消息或音频文件。',
 cp_32: '⚠️ 音频重新生成失败。请手动设置呼叫。',
 cp_320: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_321: '🌐 请选择 IVR 问候语的语言：',
 cp_322: '📝 请输入来电者将听到的问候语：',
 cp_323: '🎙️ 请发送语音消息或音频文件。',
 cp_324: '✅ IVR 问候语已保存！',
 cp_325: '✅ 已收到音频。保存为您的 IVR 问候语？',
 cp_326: '❌ 音频处理失败。请重试。',
 cp_327: '请选择一个选项：',
 cp_328: (key) => `当来电者按下 <b>${key}</b> 时应该发生什么？`,
 cp_329: (message) => `📋 <b>${message}</b>\n\n请选择一个模板：`,
 cp_33: '⚠️ 预设音频已过期且无法重新生成。请手动设置呼叫。',
 cp_330: '📋 请选择一个类别：',
 cp_331: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ 输入修改后的版本，或点击 <b>✅ 直接使用</b>：`,
 cp_332: '🌐 请选择语言：\n\n<i>消息将自动翻译。</i>',
 cp_333: '🎙️ 请发送语音消息或音频文件：',
 cp_334: (message) => `🌐 请选择语言：\n\n<i>"${message}"</i>`,
 cp_335: (text) => `📋 <b>消息</b>\n\n<code>${text}</code>\n\n✏️ 输入修改后的版本，或点击 <b>✅ 直接使用</b>：`,
 cp_336: '🔄 正在生成音频预览...',
 cp_337: (key, voice) => `✅ 按键 <b>${key}</b> 的预览（${voice}）\n\n保存此选项？`,
 cp_338: (message) => `❌ 音频生成失败：${message}`,
 cp_339: (translatedText) => `🌐 <b>翻译结果：</b>\n\n<i>${translatedText}</i>\n\n🎙️ 请选择一个语音：`,
 cp_34: '💾 <b>预设已加载 — 准备呼叫！</b>\n\n按 <b>/yes</b> 拨打电话，或按 <b>/cancel</b> 取消。',
 cp_340: '🎙️ 请选择一个语音：',
 cp_341: '🎙 请选择语音提供商：',
 cp_342: (message) => `🌐 正在翻译为${message}...`,
 cp_343: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_344: '🌐 请选择语言：',
 cp_345: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_346: '🌐 请选择语言：',
 cp_347: '📝 请输入消息：',
 cp_348: '🎙️ 请发送语音消息或音频文件：',
 cp_35: (templateName, callerId, voiceName, join) => `💾 <b>已加载预设：${templateName}</b>\n📱 来自：${callerId}\n🎙 语音：${voiceName}\n🔘 有效按键：<b>${join}</b>`,
 cp_36: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_37: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_38: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_4: (SUPPORT_USERNAME) => `📞 Cloud IVR 即将推出！请联系 ${SUPPORT_USERNAME} 了解最新动态。`,
 cp_40: (firstPh) => `\n请输入 <b>[${firstPh}]</b> 的值：`,
 cp_41: '📋 <b>选择呼叫模式</b>\n\n🔗 <b>转接</b> — 目标按键后，将其接通到您的号码\n🔑 <b>OTP 收集</b> — 按键后，系统自动提示目标输入验证码 — 并通过 Telegram 发送给您\n\n两种模式都会提供完整结果报告。',
 cp_42: '请输入要呼叫的电话号码（含国家代码）：\n<i>示例：+12025551234</i>',
 cp_43: '✍️ <b>自定义脚本</b>\n\n请输入您的 IVR 消息。使用 <b>[方括号]</b> 表示变量：\n\n<b>标准：</b>[Name]、[Company]、[Bank]、[Amount]\n<b>智能（自动填充）：</b>[CardLast4]、[CaseID]、[ReferenceNum]\n<b>智能（选择）：</b>[Reason]、[Location]、[CallBack]\n\n<i>示例：您好 [Name]。这里是 [Bank] 安全部门。尾号 [CardLast4] 的卡产生了 $[Amount] 的消费。案件编号 [CaseID]。如有异议请按 1。</i>\n\n请输入您的脚本：',
 cp_44: '请选择一个模板：',
 cp_45: '请从按钮中选择一个类别。',
 cp_46: '✍️ <b>自定义脚本</b>\n\n请输入您的 IVR 消息。使用 <b>[方括号]</b> 表示变量：\n\n<b>标准：</b>[Name]、[Company]、[Bank]、[Amount]\n<b>智能（自动填充）：</b>[CardLast4]、[CaseID]、[ReferenceNum]\n<b>智能（选择）：</b>[Reason]、[Location]、[CallBack]\n\n<i>示例：您好 [Name]。这里是 [Bank] 安全部门。尾号 [CardLast4] 的卡产生了 $[Amount] 的消费。案件编号 [CaseID]。如有异议请按 1。</i>\n\n请输入您的脚本：',
 cp_47: '📋 <b>占位符完整参考</b>\n\n<b>🔤 标准（由您输入值）：</b>\n• <code>[Name]</code> — 收件人姓名\n• <code>[Bank]</code> — 银行或机构名称\n• <code>[Company]</code> — 公司或商户名称\n• <code>[Amount]</code> — 美元金额\n\n<b>🤖 智能自动填充（为您生成）：</b>\n• <code>[CardLast4]</code> — 随机 4 位卡号\n• <code>[CaseID]</code> — 随机案件/参考编号\n• <code>[ReferenceNum]</code> — 随机参考号\n\n<b>📋 智能选择（从预设中选择）：</b>\n• <code>[Reason]</code> — 欺诈警报、账户冻结、异常活动等\n• <code>[Location]</code> — 城市, 州 格式（由您输入）\n• <code>[CallBack]</code> — 您的 Nomadly 电话号码\n\n<b>💡 提示：</b>\n• 可自由混用标准和智能占位符\n• 占位符区分大小写：<code>[Bank]</code> 而非 <code>[bank]</code>\n• 在脚本中包含「按 1」可自动检测有效按键\n\n现在请输入您的脚本：',
 cp_48: (keyNote) => `${keyNote}\n\n点击 <b>✅ 继续</b> 保留这些按键，或输入新的按键：\n<i>示例：1,2,3 或 1,5,9</i>`,
 cp_49: '请输入您的自定义 IVR 脚本：',
 cp_5: '⚠️ 会话已过期。请重新尝试购买。',
 cp_50: '请输入至少一个数字（0-9）：\n<i>示例：1,2,3</i>',
 cp_51: (join) => `🔘 有效按键已更新：<b>${join}</b>`,
 cp_52: (icon, firstPh, description, generated) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_53: (icon, firstPh, description) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_54: (icon, firstPh, description, hint) => `${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_56: (firstPh) => `请输入 <b>[${firstPh}]</b> 的值：`,
 cp_57: '📋 <b>选择呼叫模式</b>\n\n🔗 <b>转接</b> — 目标按键后，将其接通到您的号码\n🔑 <b>OTP 收集</b> — 按键后，系统自动提示目标输入验证码 — 并通过 Telegram 发送给您\n\n两种模式都会提供完整结果报告。',
 cp_58: '请从按钮中选择一个模板。',
 cp_59: (icon, name, text, join) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 有效按键：<b>${join}</b>`,
 cp_6: '⚠️ 会话已过期。请重新尝试购买。',
 cp_60: (icon, firstPh, description, generated) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_61: (icon, firstPh, description) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_62: (icon, firstPh, description, hint) => `\n${icon} <b>[${firstPh}]</b> — ${description}\n\n${hint}`,
 cp_64: (firstPh) => `\n请输入 <b>[${firstPh}]</b> 的值：`,
 cp_65: '📋 <b>选择呼叫模式</b>\n\n🔗 <b>转接</b> — 目标按键后，将其接通到您的号码\n🔑 <b>OTP 收集</b> — 按键后，系统自动提示目标输入验证码 — 并通过 Telegram 发送给您\n\n两种模式都会提供完整结果报告。',
 cp_66: (icon, currentPh, generated) => `${icon} <b>[${currentPh}]</b> — 已重新生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_67: (currentPh) => `✍️ 请输入 <b>[${currentPh}]</b> 的自定义值：`,
 cp_68: (currentPh) => `✍️ 请输入 <b>[${currentPh}]</b> 的回拨号码：\n<i>示例：+12025551234</i>`,
 cp_69: (currentPh, value, icon, nextPh, description, generated) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n自动生成：<b>${generated}</b>\n点击接受、重新生成，或输入您自己的内容：`,
 cp_7: '⚠️ 未找到待处理的会话。',
 cp_70: (currentPh, value, icon, nextPh, description) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n从列表中选择或输入您自己的内容：`,
 cp_71: (currentPh, value, icon, nextPh, description, hint) => `✅ ${currentPh}：<b>${value}</b>\n\n${icon} <b>[${nextPh}]</b> — ${description}\n\n${hint}`,
 cp_73: (currentPh, value, nextPh) => `✅ ${currentPh}：<b>${value}</b>\n\n请输入 <b>[${nextPh}]</b> 的值：`,
 cp_74: '✅ 所有值已设置！\n\n📋 <b>选择呼叫模式</b>\n\n🔗 <b>转接</b> — 目标按键后，将其接通到您的号码\n🔑 <b>OTP 收集</b> — 按键后，系统自动提示目标输入验证码 — 并通过 Telegram 发送给您\n\n两种模式都会提供完整结果报告。',
 cp_75: '🔗 <b>转接模式</b>\n\n请输入来电者按键后要转接到的号码：\n<i>示例：+17174794833</i>',
 ivrTrialNudge: `🎁 <b>您有 1 次免费快速IVR呼叫！</b>

拨打自动呼叫，播放您录制的消息并捕获按键或 OTP — 免费，无需套餐。

👉 点击下方 <b>📞 Cloud IVR + SIP</b>，然后选择 <b>📢 快速IVR呼叫</b> 立即试用。`,
 cp_76: '🔒 免费试用不支持 <b>OTP 收集</b>。\n\n订阅 <b>Pro</b> 或 <b>Business</b> 套餐即可使用 OTP 收集。\n\n试用呼叫仍可使用 <b>🔗 转接</b> 模式。',
 cp_77: '🔑 <b>OTP 收集模式</b>\n\n验证码应为几位数？\n\n💡 验证码提示会自动添加在脚本之后 — 无需手动包含。\n\n<i>默认：6 位</i>',
 cp_78: '请选择一种模式：',
 cp_79: '📋 <b>选择呼叫模式</b>\n\n🔗 <b>转接</b> — 目标按键后，将其接通到您的号码\n🔑 <b>OTP 收集</b> — 按键后，系统自动提示目标输入验证码 — 并通过 Telegram 发送给您\n\n两种模式都会提供完整结果报告。',
 cp_8: (buyPlansHeader, price, minutes, sms, starter, v5, v6, v7, pro, v9, v10, v11, business) => `${buyPlansHeader}\n\n💡 <b>Starter</b> — $${price}/月\n📞 ${minutes} 分钟 + 📩 ${sms} 条短信 · 呼叫转移 · 最多 ${starter} 个号码\n\n⭐ <b>Pro</b> — $${v5}/月\n📞 ${v6} 分钟 + 📩 ${v7} 条短信 · 包含 Starter 全部功能 + 语音信箱 · SIP · Webhooks · IVR · 最多 ${pro} 个号码\n\n👑 <b>Business</b> — $${v9}/月\n📞 ${v10} 分钟 + 📩 ${v11} 条短信 · 包含 Pro 全部功能 + 通话录音 · 自动话务员 · OTP · 优先支持 · 最多 ${business} 个号码\n\n<i>💳 呼出通话从钱包扣费</i>`,
 cp_80: '请输入有效的位数（1-10）：',
 cp_81: (length) => `✅ OTP 长度：<b>${length} 位</b>（最多 3 次尝试）\n\n✍️ <b>自定义来电者提示语</b>\n\n是否要自定义来电者在验证后听到的内容？\n\n<b>默认确认：</b><i>"您的验证码已成功验证。谢谢，再见。"</i>\n<b>默认拒绝：</b><i>"已达到最大验证尝试次数。再见。"</i>`,
 cp_82: (length) => `✅ OTP 长度：<b>${length} 位</b>（最多 3 次尝试）\n\n🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：`,
 cp_83: '🔑 <b>OTP 收集模式</b>\n\n验证码应为几位数？\n\n💡 验证码提示会自动添加在脚本之后 — 无需手动包含。\n\n<i>默认：6 位</i>',
 cp_84: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_85: '✅ <b>确认提示语</b>\n\n请输入当您<b>确认</b>来电者的验证码时其听到的内容：\n\n<i>示例："您的验证码已验证。我们已拦截该交易并保护了您的账户。专员将在 24 小时内与您联系。感谢您选择我们的银行。再见。"</i>',
 cp_86: '请选择一个选项：',
 cp_87: '✍️ <b>自定义来电者提示语</b>\n\n是否要自定义来电者在验证后听到的内容？',
 cp_88: '❌ <b>拒绝提示语</b>\n\n请输入当您<b>拒绝</b>来电者的验证码（已达最大尝试次数）时其听到的内容：\n\n<i>示例："我们无法验证您的身份。为了您的安全，本次通话已结束。请回拨或前往最近的网点寻求帮助。再见。"</i>',
 cp_89: '✅ <b>确认提示语</b>\n\n请输入当您<b>确认</b>来电者的验证码时其听到的内容：',
 cp_9: (buyLabel) => `📢 <b>快速 IVR 呼叫</b>\n\n您已使用过免费试用呼叫。\n\n订阅 Cloud IVR，即可使用您自己的来电显示进行无限次 IVR 呼叫！\n\n点击 <b>${buyLabel}</b> 开始。`,
 cp_90: '✅ 自定义提示语已保存！\n\n🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_91: '请输入以 + 开头的有效电话号码。\n<i>示例：+17174794833</i>',
 cp_92: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_93: '请输入来电者按键后要转接到的号码：\n<i>示例：+17174794833</i>',
 cp_94: '请选择语音提供商：',
 cp_95: '🎤 <b>选择语音</b>\n\n请为 IVR 音频选择一个语音：',
 cp_96: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_97: (name) => `🎤 语音：<b>${name}</b>\n\n🎚 <b>选择语速</b>\n\n请选择语音的朗读速度：`,
 cp_98: '🎙 <b>选择语音提供商</b>\n\n请选择您的 TTS 引擎：',
 cp_99: '✍️ 请输入自定义语速倍数：\n<i>示例：0.6（很慢）、0.9（稍慢）、1.2（较快）、1.5（很快）\n范围：0.25 到 4.0</i>',
 dns_1: (domain) => `🔗 正在停用 <b>${domain}</b> 的缩短器…`,
 dns_2: (domain) => `✅ <b>${domain}</b> 的缩短器已停用。`,
 dns_3: '❌ 无法停用缩短器。请重试或联系支持。',
 dns_3_busy: '⏳ 我们的短链接服务暂时繁忙。您的链接目前仍然有效——我们将自动重试，并在停用完成后通知您。您也可以稍后再试一次。',
 dns_4: '🔄 正在移除冲突记录并添加新记录...',
 dns_5: '格式无效。请使用 <b>_service._protocol</b>（例如 _sip._tcp、_http._tcp）：',
 dns_6: '⚠️ 请输入有效的 USD 金额（最低 $10）。',
 dom_1: '您没有已注册的域名。请注册新域名或连接外部域名。',
 dom_2: '📋 <b>我的托管套餐</b>\n\n您没有活跃的托管套餐。购买套餐即可开始！',
 dom_3: (savings, domain, chargeUsd, shownPrice, v4) => `🎉 <b>您节省了 $${savings}！</b>域名 <b>${domain}</b> 以 <b>$${v4}</b> 注册，而非 $${shownPrice}。您的钱包仅扣除了 $${chargeUsd}。`,
 dom_4: (domain, v1) => `💡 <b>${v1} 接下来可以做什么？</b>\n\n🔗 <b>激活 URL 缩短器</b> — 将 ${domain} 用作您的品牌短链接\n🛡️🔥 <b>Anti-Red 托管</b> — 在 ${domain} 上托管网站，享受防封保护\n🌐 <b>管理 DNS</b> — 将其指向您的服务器\n\n点击下方选项之一继续。`,
 dom_5: (domain, domainCost, APP_SUPPORT_LINK) => `您的域名 <b>${domain}</b> 已成功注册，但托管设置失败。域名费用（$${domainCost}）已扣除。请联系支持以完成托管设置：${APP_SUPPORT_LINK}`,
 dom_6: (showWallet) => `❌ 合规设置失败。\n\n💰 款项已退回您的钱包。\n${showWallet}`,
 dom_7: (requested, delivered, requesteddelivered, toFixed, reasonText, v5) => `💰 <b>部分退款</b>\n\n📊 已订购：${requested} 条线索\n✅ 已交付：${delivered} 条线索\n❌ 未交付：${requesteddelivered} 条线索\n\n💵 退款：<b>$${toFixed}</b> 已退回您的钱包\n📝 原因：${reasonText}\n\n💰 钱包：$${v5} USD`,
 dom_8: '💡 <b>充分利用您的线索</b>\n\n📞 <b>获取 Cloud IVR</b> — 用本地号码呼叫这些线索\n🎯 <b>购买更多线索</b> — 定位其他地区或运营商\n🔗 <b>缩短您的链接</b> — 跟踪您的推广活动\n\n点击下方选项。',
 dom_9: (totalPrice, toFixed) => `❌ 钱包余额不足。需要 $${totalPrice}，现有 $${toFixed}。\n请为钱包充值后重试。`,

 // Post-purchase upsells (hosting & VPS)
 host_5d: (domain) => `💡 <b>您的 ${domain} 主机已上线！</b>\n\n🌐 <b>购买更多域名</b> — 托管更多网站\n📞 <b>Cloud IVR + SIP</b> — 让访客通过虚拟号码致电您\n✂️🌐 <b>自定义域名短链</b> — 用品牌短链跟踪入站流量\n\n请在下方选择一个选项。`,
 vps_5d: (isRDP = false) => isRDP
  ? '💡 <b>您的 RDP 已就绪！</b>\n\n📧 <b>BulkSMS</b> — 在新 RDP 上运行短信网关\n📞 <b>Cloud IVR + SIP</b> — 配对虚拟号码接收来电\n🌐 <b>防屏蔽域名</b> — 将域名指向您的 RDP\n\n请在下方选择一个选项。'
  : '💡 <b>您的 VPS 已就绪！</b>\n\n📧 <b>BulkSMS</b> — 在新 VPS 上托管短信网关\n📞 <b>Cloud IVR + SIP</b> — 配对虚拟号码接收来电\n🌐 <b>防屏蔽域名</b> — 将域名指向您的 VPS\n\n请在下方选择一个选项。',
 ev_1: '🚧 邮箱验证服务正在维护中。请稍后重试。',
 ev_10: (message) => `❌ Error: ${message}`,
 ev_11: '❌ Invalid IPv4 format. Send like: <code>1.2.3.4</code>',
 ev_12: (ipInput) => `✅ IP <code>${ipInput}</code> added to pool.`,
 ev_13: (ipInput) => `✅ IP <code>${ipInput}</code> removed from pool.`,
 ev_14: (message) => `❌ 错误: ${message}`,
 ev_15: '❌ 已取消。',
 ev_16: '❌ 已取消。',
 ev_17: '❌ 请上传 <b>.csv</b> 或 <b>.txt</b> 文件。',
 ev_18: (message) => `❌ 读取文件失败：${message}`,
 ev_19: '📎 请上传包含邮箱地址的 CSV/TXT 文件。',
 ev_2: '📧 正在返回邮箱验证菜单...',
 ev_20: '❌ 文件中未找到有效的邮箱地址。请检查格式。',
 ev_21: (minEmails, length) => `❌ 至少需要 <b>${minEmails}</b> 个邮箱。仅找到 ${length} 个。`,
 ev_22: (toLocaleString, v1) => `❌ 最多允许 <b>${toLocaleString}</b> 个邮箱。找到 ${v1} 个。`,
 ev_23: '❌ 已取消。',
 ev_24: '📋 请粘贴邮箱地址（每行一个或用逗号分隔）。',
 ev_25: '❌ 未找到有效的邮箱地址。请检查格式。',
 ev_26: (maxPasteEmails, length) => `❌ 粘贴模式最多支持 <b>${maxPasteEmails}</b> 个邮箱。找到 ${length} 个。更大的列表请使用文件上传。`,
 ev_27: (minEmails, length) => `❌ 至少需要 <b>${minEmails}</b> 个邮箱。仅找到 ${length} 个。`,
 ev_28: '❌ 已取消。',
 ev_29: '❌ 会话已过期。请重新开始。',
 ev_3: '⚠️ Could not reach worker',
 ev_30: '❌ 此列表大小不支持免费试用。请选择支付方式。',
 ev_31: '❌ 免费试用已使用。请选择支付方式。',
 ev_32: '❌ 试用 + 付费不可用。请选择支付方式。',
 ev_33: '❌ 免费试用已使用。请选择支付方式。',
 ev_34: (toFixed, v1) => `⚠️ USD 余额不足以支付额外邮箱。\n💰 需要：<b>$${toFixed}</b>\n💳 现有：<b>$${v1}</b>\n\n请为钱包充值，或使用 NGN 支付全价。`,
 ev_35: (toFixed, v1) => `⚠️ USD 余额不足。\n💰 需要：<b>$${toFixed}</b>\n💳 现有：<b>$${v1}</b>\n\n请为钱包充值。`,
 ev_36: (toFixed, toLocaleString) => `✅ <b>支付成功！</b>\n\n💵 已扣款：<b>$${toFixed}</b>\n📧 正在验证：<b>${toLocaleString} 个邮箱</b>\n\n⏳ 处理即将开始。您将收到进度更新。`,
 ev_37: '请选择支付方式：',
 ev_4: (message) => `❌ Error: ${message}`,
 ev_5: '⚠️ No IPs found from cloud provider API or credentials missing.',
 ev_6: (message) => `❌ Cloud API error: ${message}`,
 ev_7: '➕ <b>Add IP</b>\\n\\nSend me the IPv4 address to add (e.g. <code>1.2.3.4</code>):',
 ev_8: (message) => `❌ Error: ${message}`,
 ev_9: '♻️ All IP health stats reset to healthy.',
 host_1: '❌ 支付处理出错。请联系支持。',
 host_10: (startsWith) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 点击复制`,
 host_11: (startsWith) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${startsWith}</code>\n\n📋 点击复制`,
 host_12: '❌ 创建短链接出错。请重试。',
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
 host_23: (message, plan) => `<b>${message}</b> 已在使用 ${plan}。请选择其他域名。`,
 host_24: '请从列表中选择一个域名。',
 host_25: '✅ 您已是最高套餐（Golden Anti-Red）。没有可用的升级。',
 host_26: (toFixed, price) => `⚠️ 余额不足。您有 $${toFixed}，但需要 $${price}。`,
 host_27: '请选择一个升级选项。',
 host_28: (toFixed, upgradePrice) => `⚠️ 余额不足。您有 $${toFixed}，但需要 $${upgradePrice}。`,
 host_29: (error) => `❌ 升级失败：${error}\n款项已退回您的钱包。`,
 host_3: (toFixed, length) => `💰 已自动退款 <b>$${toFixed}</b>（来自 ${length} 次被拒绝的验证）。您可以随时重新购买。`,
 host_30: '❌ 升级失败。款项已退回您的钱包。请重试或联系支持。',
 host_31: '🚧 VPS 服务即将推出！敬请期待。',
 host_32: '⚠️ 无法加载推荐页面。请稍后重试。',

// === Hosting Plan / Billing UX (added 2026-02) ===
// Headers
myHostingPlansHeader: '📋 <b>我的托管计划</b>',
billingMenuHeader: '💳 <b>我的计划 / 账单</b>',
billingMenuIntro: '管理每个托管计划的续费和自动续费。',
billingMenuEmpty: '💳 <b>我的计划 / 账单</b>\n\n您还没有任何活跃的托管计划。',
// Status indicators
statusActive: '✅ 活跃',
statusActiveOnline: '✅ 活跃（在线）',
statusSuspended: '🚫 已暂停',
statusSuspendedFull: '🚫 已暂停（完全离线）',
statusExpired: '❌ 已过期',
statusMaintenance: '🛠️ 维护中（仅公开离线）',
// Auto-Renew states
autoRenewOn: '✅ 已开启',
autoRenewOff: '❌ 已关闭',
autoRenewWeeklyOff: '❌ 已关闭（周计划永不自动续费）',
autoRenewWeeklyShort: '❌ 已关闭（周计划）',
// Field labels
planLabel: '计划：',
statusLabel: '状态：',
domainTypeFieldLabel: '域名类型：',
createdLabel: '创建于：',
expiresLabel: '到期：',
autoRenewFieldLabel: '自动续费：',
usernameLabel: '用户名：',
priceLabel: '价格：',
durationLabel: '时长：',
walletBalanceLabel: '钱包余额：',
chargedLabel: '已扣费：',
newExpiryLabel: '新到期日：',
remainingBalanceLabel: '剩余余额：',
domainLabel: '域名：',
currentLabel: '当前：',
// Plan view body
planViewCredentialsHint: '点击"显示凭证"以查看您的 HostPanel 用户名和 PIN 码。',
planViewBillingNudge: '💡 要续费或切换自动续费，请从托管菜单打开 <b>💳 我的计划 / 账单</b>。',
planViewMultiHostUpsell: '💡 <b>想托管更多网站？</b> 升级到月度计划，享受多站点托管、更大存储和高级 Anti-Red 保护。',
// Renew modal
renewModalHeader: planName => `<b>续费计划 — ${planName}</b>`,
renewModalCurrentExpiry: (date, isExpired) => `<b>当前到期日：</b> ${date}${isExpired ? '（已过期）' : ''}`,
weeklyRenewTooEarly: (domain, expiry, opensAt) => `⏳ <b>暂未开放续费</b>\n\n<b>${domain}</b> 使用的是周付套餐，仅在剩余 7 天或更少时才能续费，每次续费一周。\n\n<b>当前到期日：</b> ${expiry}\n<b>续费开放时间：</b> ${opensAt}\n\n想要更长时间？点击 <b>⬆️ 升级计划</b> 升级到月付套餐。`,
renewAlreadyApplied: domain => `ℹ️ <b>${domain}</b> 刚刚已被其他请求续费或更改，因此本次未扣款。请重新打开该套餐查看最新到期日。`,

renewModalDuration: days => `<b>时长：</b> ${days} 天`,
renewModalConfirmHint: '✅ 在下方确认付款：',
renewModalInsufficient: '⚠️ 资金不足。请先充值。',
renewModalPayButton: price => `💵 支付 $${price} USD`,
// Renew success / failure
renewSuccessTitle: '✅ <b>计划续费成功！</b>',
renewSuccessAntiRedNote: 'Anti-Red 保护已刷新。',
renewFailureFallback: '❌ 续费失败。您的钱包已退款。请重试或联系支持。',
// Upgrade modal
upgradeModalHeader: '<b>⬆️ 升级计划</b>',
upgradeModalChooseHint: '选择您的新计划：',
// Upgrade confirm screen
upgradeConfirmTitle: '<b>⬆️ 确认升级</b>',
upgradeConfirmTo: name => `<b>升级到：</b> ${name}`,
upgradeConfirmListPrice: price => `<b>标价：</b> $${price}`,
upgradeConfirmCredit: amount => `<b>🎁 忠诚度抵扣：</b> -$${amount}`,
upgradeConfirmYouPay: amount => `<b>您需支付：</b> $${amount}`,
upgradeConfirmRenewsAt: (price, days) => `<b>🔁 续费价格：</b> 每 ${days} 天 $${price}（已开启自动续费）`,
upgradeConfirmNextRenewal: (date, days) => `<b>📅 下次续费：</b> ${new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} — 今天开始新的 ${days} 天周期`,
// Upgrade receipt + upgrade failures (wallet already refunded)
upgradeSuccessTitle: '✅ <b>套餐升级成功！</b>',
upgradeSuccessOldPlan: name => `<b>原套餐：</b> ${name}`,
upgradeSuccessNewPlan: name => `<b>新套餐：</b> ${name}`,
upgradeSuccessNewExpiry: date => `<b>新到期日：</b> ${new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
upgradeSuccessFooter: planKey => `${planKey === 'goldenCpanel' ? '无限域名' : '最多 5 个附加域名'}现已可用。Anti-Red 防护已刷新。`,
upgradeFailTerminated: (refund, hostingBtn) => `❌ 此托管账户因未在宽限期内续费，已被<b>终止</b>。\n\n已向您的钱包退款 <b>$${refund}</b>。\n\n🛒 如需让网站重新上线，请在 <b>${hostingBtn}</b> 中购买<b>新的托管套餐</b>。`,
upgradeFailReactivate: (refund, supportBtn) => `❌ <b>升级未完成</b>\n\n我们无法在服务器上重新激活您的托管账户。已向您的钱包退款 <b>$${refund}</b>。\n\n已通知管理员 — 请点击 ${supportBtn} 跟进。`,
upgradeFailServer: (reason, refund, supportBtn) => `❌ <b>升级未完成</b>\n\n我们的托管服务器未接受此次套餐更改（<i>${reason}</i>）。已向您的钱包退款 <b>$${refund}</b>。\n\n已通知管理员 — 请点击 ${supportBtn} 跟进。`,
fmtDate: d => new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
renewTerminated: hostingBtn => `❌ 此托管账户因未在宽限期内续费，已被<b>终止</b>。\n\n🛒 如需让网站重新上线，请在 <b>${hostingBtn}</b> 中购买<b>新的托管套餐</b>。`,
renewalPriceChangedNotice: (domain, plan, oldPrice, newPrice, nextDate, autoRenew) => `ℹ️ <b>续费价格已更新</b>\n\n您的托管 <b>${domain}</b> 使用的是 <b>${plan}</b>。为与当前套餐一致，其续费价格现为 <b>$${newPrice}</b>（原为 $${oldPrice}）。${nextDate ? `\n\n📅 下次续费：<b>${new Date(nextDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b>${autoRenew ? ' — 已开启自动续费，请保持钱包余额充足。' : ''}` : ''}\n\n现在不会扣费，过去的续费也不受影响。`,
// Per-domain billing buttons
billingRenewBtn: domain => `🔄 立即续费 — ${domain}`,
billingToggleAutoRenewBtn: domain => `🔁 切换自动续费 — ${domain}`,
// Auto-Renew toggle status
autoRenewTurnedOn: domain => `✅ <b>${domain}</b> 的自动续费已 <b>开启</b>。您的计划将在到期时自动续费。`,
autoRenewTurnedOff: domain => `❌ <b>${domain}</b> 的自动续费已 <b>关闭</b>。您的计划将在到期后过期，并在宽限期后被暂停。`,
autoRenewNotForWeekly: '❌ 周计划不支持自动续费。',
// Toast strings
siteAlreadyOffline: '⚠️ 您的网站已离线。使用"让网站上线"重新启用。',
siteAlreadyOnline: '✅ 您的网站已在线。',
addonNotOnPlan: '⚠️ 该域名不是此计划的附加域名。',
promoMessagesEnabled: '🔔 促销消息已启用。',
promoMessagesDisabled: '✅ 促销消息已禁用。',
// Credentials reveal
credentialsHeader: domain => `🔑 <b>${domain} 的凭证</b>`,
credentialsPinLabel: 'PIN 码：',
credentialsPanelUrlLabel: '面板登录 URL：',
credentialsFreshNotice: '⚠️ <i>此 PIN 码已新生成。您的旧 PIN 码不再有效。</i>',
// Hosting Scheduler notifications
schedExpiryWarningTitle: '⏰ <b>托管即将到期通知</b>',
schedExpiryWarningBody: (plan, domain) => `您的计划 <b>${plan}</b>（<b>${domain}</b>）将在 24 小时内到期。`,
schedRenewTextOn: '✅ 自动续费 <b>已开启</b>。您的计划将在到期时自动续费。',
schedRenewTextOff: hours => `自动续费 <b>已关闭</b>。您的托管将在到期时 <b>立即暂停</b>，并在 ${hours} 小时后删除（如未手动续费）。`,
schedRenewTextWeekly: '周计划不会自动续费。请在到期前手动续费。',
schedRenewTextWalletHint: '钱包余额：通过 /wallet 查看',
schedRenewTextToggleHint: domain => `要切换自动续费：打开 <b>💳 我的计划 / 账单</b>`,
schedAutoRenewedTitle: '✅ <b>计划自动续费完成！</b>',
schedAutoRenewedBody: (plan, domain, price, newExpiry, remBalance) =>
  `<b>${plan}</b>（<b>${domain}</b>）已续费。\n<b>已扣费：</b> $${price}\n<b>新到期日：</b> ${newExpiry}\n<b>剩余余额：</b> $${remBalance}`,
schedAutoRenewFailedTitle: '⚠️ <b>自动续费失败 — 资金不足</b>',
schedAutoRenewFailedBody: (plan, domain, price, balance, hours) =>
  `<b>${plan}</b>（<b>${domain}</b>）已过期。\n<b>续费价格：</b> $${price}\n<b>您的余额：</b> $${balance}\n\n请充值以续费。\n您的托管已被 <b>暂停</b>。请充值以重新激活。\n如未续费，您的账户将在 ${hours} 小时后被 <b>删除</b>。`,
schedWeeklyExpiredTitle: '⏰ <b>周计划已过期</b>',
schedWeeklyExpiredBody: (plan, domain, hours) =>
  `您的计划 <b>${plan}</b>（<b>${domain}</b>）已过期。\n\n⚠️ 周计划 <b>不会</b> 自动续费。\n您的托管已被 <b>暂停</b> — 网站现已离线。\n请从 <b>💳 我的计划 / 账单</b> 手动续费以重新激活。\n\n如未续费，您的账户将在 ${hours} 小时后被 <b>永久删除</b>。`,
schedDeletedTitle: '🗑️ <b>托管已删除</b>',
schedDeletedBody: (domain, plan) =>
  `<b>${domain}</b> 的 cPanel 账户已被永久删除。\n计划：${plan}\n\n所有文件、数据库和电子邮件均已删除。\n如需重新开始，请购买新的托管计划。`,
schedDeletedBodyHours: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> 的 cPanel 账户已被永久删除。\n计划：${plan} — 已过期 ${hoursExpired} 小时（已超过 ${gracePeriod} 小时宽限期）。\n\n所有文件、数据库和电子邮件均已删除。\n如需重新开始，请购买新的托管计划。`,
schedSuspendedTitle: '🚫 <b>托管已暂停</b>',
schedSuspendedBody: (domain, plan, hoursExpired, gracePeriod) =>
  `<b>${domain}</b> 已被暂停 — 您的计划 <b>${plan}</b> 已过期 ${hoursExpired} 小时。\n\n⚠️ 您的网站现已 <b>离线</b>。\n从 <b>💳 我的计划 / 账单</b> 续费以重新激活。\n如未续费，账户将在到期后 ${gracePeriod} 小时被 <b>永久删除</b>。`,
// === Phone-monitor / Phone-scheduler ===
phoneCallerIdFlaggedTitle: '⚠️ <b>呼叫方 ID 被标记</b>',
phoneCallerIdFlaggedBody: phoneNumber =>
  `您的呼叫方 ID <b>${phoneNumber}</b> 已被运营商标记并暂停。\n\n该号码不再可用于外呼或营销活动。\n\n👉 请从 <b>云 IVR + SIP</b> 菜单购买新号码以继续呼叫。\n\n如有疑问，请联系支持。`,
phoneAutoRenewFailedTitle: '❌ <b>自动续费失败 — 号码已删除</b>',
phoneAutoRenewFailedBody: (phoneNumber, planName, planPrice, buyLabel) =>
  `📞 ${phoneNumber}\n📦 计划：${planName}（$${planPrice}/月）\n\n⚠️ 钱包余额不足。您的号码已被 <b>永久删除</b> 以防止进一步计费。\n\n此操作不可逆。如需新号码，请访问 📞☁️ 云电话 → ${buyLabel}。`,
phoneSuspendedTitle: '⚠️ <b>号码过期 — 永久删除</b>',
phoneSuspendedBody: (phoneNumber, buyLabel) =>
  `📞 ${phoneNumber} 已过期并被 <b>永久删除</b>。\n\n自动续费已关闭。为避免今后丢失号码，请在新号码上启用自动续费。\n\n获取新号码：📞☁️ 云电话 → ${buyLabel}。`,
phoneUsageAlertTitle: '⚠️ <b>使用量警报</b>',
phoneUsageAlertBody: (phoneNumber, used, limit, type, percent, rate, unit) =>
  `📞 ${phoneNumber}\n\n本月您已使用 <b>${used}/${limit}</b> 入站${type}（${percent}%）。\n额度用尽后，超额计费将以 <b>$${rate}/${unit}</b> 从您的钱包扣费。如果钱包为空，服务将暂停。`,
phoneUsageLimitTitle: type => `💰 <b>入站${type} — 超额已激活</b>`,
phoneUsageLimitBody: (phoneNumber, type, limit, rate, unit) =>
  `📞 ${phoneNumber}\n\n您已用完本月计划中的全部 <b>${limit}</b> 入站${type}。\n超额计费现已激活 — 每次使用从您的钱包扣 <b>$${rate}/${unit}</b>。\n如果钱包余额耗尽，服务将暂停。请充值或升级您的计划。`,
// === Generic error toast (error-handler.js) ===
genericErrorTitle: '❌ <b>错误</b>',
genericErrorBody: txnId =>
  `出现错误${txnId ? `（交易：${txnId}）` : ''}。\n\n我们的团队已收到通知并将进行调查。`,
genericErrorRefundedNote: '✅ 您的付款已退款。',
genericErrorContactSupport: '如果问题持续存在，请联系支持。',
// === Bulk-call campaign ===
bulkCallProgressLine: (icon, displayNumber, displayName, statusText, durText, bar, completed, total, pct, kp, missed, failed) =>
  `${icon} <b>${displayNumber}</b>${displayName} — ${statusText}${durText}\n${bar} ${completed}/${total} (${pct}%) | 🔘${kp} 📵${missed} ❌${failed}`,
bulkCallReportTitle: '📊 <b>营销活动完成！</b>',
bulkCallReportCallerId: '呼叫方 ID：',
bulkCallReportAudio: '音频：',
bulkCallReportProvider: '提供商：',
bulkCallReportDuration: '时长：',
bulkCallReportTotal: '总通话数：',
bulkCallReportAnswered: '已接听：',
bulkCallReportKeyPressed: '按键操作：',
bulkCallReportTransferred: '已转接：',
bulkCallReportNoAnswer: '无人接听：',
bulkCallReportHungUp: '已挂断：',
bulkCallReportBusy: '忙线：',
bulkCallReportFailed: '失败：',
// === SMS App service ===
smsAppTrialCompleteTitle: '📱 <b>BulkSMS 免费试用完成！</b>',
smsAppTrialCompleteBody: limit =>
  `您已使用完试用中的全部 ${limit} 条免费短信。感谢您测试该平台！`,
smsAppTrialExpiredTitle: '📱 <b>BulkSMS 试用已过期</b>',
smsAppTrialExpiredBody: '订阅以继续发送 SMS 营销活动。\n👉 点击 <b>👛 钱包 → 📋 查看订阅</b> 进行升级！',
// === cPanel-routes Anti-Red warnings ===
antiRedWarningTitle: '⚠️ <b>Anti-Red 保护警告</b>',
antiRedWarningBodyShort: domain =>
  `<b>${domain}</b> 的保护已部署但尚未验证。请确保域名服务器指向 Cloudflare。`,
antiRedFailedTitle: '🚨 <b>Anti-Red 保护失败</b>',
antiRedFailedBodyShort: (domain, retries) =>
  `经过 ${retries} 次尝试后无法为 <b>${domain}</b> 部署保护。请确保域名服务器指向 Cloudflare。`,

host_4: (safeHtml) => `${safeHtml}`,
 host_5: (CHAT_BOT_NAME) => `<b>${CHAT_BOT_NAME} 帮助</b>\n\n<b>快捷命令：</b>\n• <code>/shorten URL</code> — 即时生成短链接\n• <code>/shorten URL alias</code> — 自定义别名\n• 直接粘贴任意 URL — 自动识别并缩短\n\n<b>功能：</b>\n• URL 缩短器\n• 域名\n• 电话线索\n• 钱包与支付\n• 网站托管\n\n使用下方菜单开始！`,
 host_6: '✂️ <b>快捷缩短命令</b>\n\n<b>用法：</b>\n<code>/shorten https://example.com</code> — 随机短链接\n<code>/shorten https://example.com myalias</code> — 自定义别名\n\n或直接粘贴任意 URL，我会为您缩短！',
 host_7: '❌ URL 无效。请提供以 http:// 或 https:// 开头的有效 URL',
 host_8: (customAlias, preferredDomain) => `❌ 别名 <code>${customAlias}</code> 在 ${preferredDomain} 上已被占用。请尝试其他别名。`,
 host_9: (customAlias) => `❌ 别名 <code>${customAlias}</code> 已被占用。请尝试其他别名。`,
 ld_1: (toFixed) => `💵 $${toFixed} — `,
 ld_2: '🎯 请选择目标机构。\n真实、经过验证的线索，含机主姓名 — 按运营商从高价值都市区匹配：',
 ld_3: '📝 <b>申请定制线索</b>\n\n告诉我们您想要定向线索的机构或公司。\n我们提供真实、经过验证的号码及机主姓名 — 覆盖您需要的任何都市区：',
 sms_1: (toFixed, v1) => `⚠️ <b>余额不足</b>\n\n💰 需要：<b>$${toFixed}</b>\n👛 现有：<b>$${v1}</b>\n\n请充值或选择其他支付方式。`,
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
 sms_24: '✅ 未找到活跃的应用会话 — 您可以自由登录。',
 sms_25: '✅ <b>所有设备已登出！</b>\n\n您现在可以在新设备上登录。',
 sms_26: (buyPlan) => `❌ <b>需要订阅</b>\n\n创建短信活动需要有效的订阅。\n\n点击主菜单中的 <b>${buyPlan}</b> 进行订阅 — 套餐包含无限 URL 缩短、BulkSMS、电话验证和免费域名！`,
 sms_27: (SMS_APP_LINK, chatId) => `📵 <b>没有活跃设备</b>\n\n创建活动前，您需要在设备上激活 Nomadly SMS 应用。\n\n1️⃣ 下载应用：${SMS_APP_LINK}\n2️⃣ 输入激活码：<code>${chatId}</code>\n3️⃣ 回到这里创建活动`,
 sms_28: (length) => `📱 <b>选择设备</b>\n\n您有 ${length} 台活跃设备。请选择用哪台设备发送此活动：`,
 sms_29: '❌ 请从下方按钮中选择一台设备。',
 sms_3: (minAmount, maxAmount) => `请输入 ${minAmount} 到 ${maxAmount} 条线索之间的有效数量。`,
 sms_30: '❌ 加载活动失败。请重试。',
 sms_31: '❌ 活动名称不能为空。请输入名称：',
 sms_32: '✍️ <b>活动内容</b>\n\n请输入您的短信内容。使用 <code>[name]</code> 以联系人姓名进行个性化。\n\n消息中的换行将保留为空格。\n\n如需<b>消息轮换</b>（每个联系人收到不同消息），请用单独一行的 <code>---</code> 分隔消息：\n<code>您好 [name]，看看我们的优惠！\n---\n嗨 [name]，别错过这个好机会！</code>',
 sms_33: '📱 <b>创建短信活动</b>\n\n请输入活动名称：',
 sms_34: '❌ 消息内容不能为空。请输入您的短信内容：',
 sms_35: '❌ 请至少输入一行非空消息。',
 sms_36: '❌ 文件中未找到有效的电话号码。\n\n请上传包含电话号码的文件（每行一个，以 + 和国家代码开头）。',
 sms_37: (length, length1, smsGapTimePrompt) => `👥 <b>已从文件加载 ${length} 个联系人${length1}！</b>\n\n${smsGapTimePrompt}`,
 sms_38: '❌ 文件处理失败。请重试或以文本形式发送联系人。',
 sms_39: '✍️ <b>活动内容</b>\n\n请输入您的短信内容。使用 <code>[name]</code> 进行个性化。\n如需轮换，请用单独一行的 <code>---</code> 分隔消息。',
 sms_4: (domain, plan) => `❌ 无法激活 URL 缩短器 — <b>${domain}</b> 有一个活跃的托管套餐（<b>${plan}</b>）。\n\n缩短器的 CNAME 会替换您的托管 A 记录，导致网站离线。\n\n请使用其他域名，或先停用您的托管套餐。`,
 sms_40: '❌ 请以文本形式发送联系人或上传文件。',
 sms_41: '❌ 未找到有效的电话号码。\n\n电话号码必须至少包含 7 位数字（最好带有以 + 开头的国家代码）。\n\n示例：\n<code>+18189279992, John\n+14155551234</code>',
 sms_42: (length, length1, warningLine, smsGapTimePrompt) => `👥 <b>已加载 ${length} 个联系人${length1}！</b>${warningLine}\n\n${smsGapTimePrompt}`,
 sms_43: '📋 <b>上传联系人</b>\n\n以文本形式发送联系人或上传 .txt/.csv 文件：',
 sms_44: '❌ 请输入 1 到 300 秒之间的数字，或点击按钮使用默认值。',
 sms_45: (buyPlan) => `❌ <b>免费试用已用完</b>\n\n您已用完所有免费短信。订阅即可解锁无限 BulkSMS 活动！\n\n👉 点击 <b>${buyPlan}</b> 订阅。`,
 sms_46: (campaignName, length, v2, deviceLine) => `💾 <b>活动已保存为草稿！</b>\n\n📋 名称：${campaignName}\n✍️ 消息数：${length}\n👥 联系人：${v2}${deviceLine}\n\n您可以稍后在 SMS 应用或 <b>📋 我的活动</b> 中编辑并发送。`,
 sms_47: (campaignName, length, v2, gapTime, deviceLine) => `✅ <b>活动已创建！</b>\n\n📋 名称：${campaignName}\n✍️ 消息数：${length}\n👥 联系人：${v2}\n⏱ 间隔：${gapTime} 秒${deviceLine}\n\n您的活动将自动同步并在已连接的设备上开始发送。`,
 sms_48: '❌ 创建活动失败。请重试。',
 sms_49: '⚠️ 请选择下方选项之一：',
 sms_5: (domain, error) => `❌ 无法关联 <b>${domain}</b>：${error}`,
 sms_50: '❌ 请按以下格式输入日期和时间：<code>YYYY-MM-DD HH:MM</code>',
 sms_51: '❌ 日期无效或已过期。\n\n请按以下格式输入未来的日期：<code>YYYY-MM-DD HH:MM</code>\n\n示例：<code>2027-07-15 09:30</code>',
 sms_52: (campaignName, length, v2, gapTime, schedDate, deviceLine) => `✅ <b>活动已安排！</b>\n\n📋 名称：${campaignName}\n✍️ 消息数：${length}\n👥 联系人：${v2}\n⏱ 间隔：${gapTime} 秒\n📅 计划时间：${schedDate} UTC${deviceLine}\n\n活动将在计划时间自动同步并开始发送。请确保您的设备保持在线。`,
 sms_53: '❌ 创建定时活动失败。请重试。',
 sms_54: (SUPPORT_USERNAME) => `📞 Cloud IVR 即将推出！请联系 ${SUPPORT_USERNAME} 了解最新动态。`,
 sms_55: '🛡️🔥 Anti-Red 托管目前不可用。请点击键盘上的 <b>💬 获取支持</b> 联系我们。',
 sms_56: (substring, v1) => `🔗 <b>检测到 URL！</b>\n\n<code>${substring}${v1}</code>\n\n⚠️ 您已没有剩余链接额度。\n\n👉 升级以缩短 URL！`,
 sms_57: (minEmails, length) => `❌ 邮箱太少。至少需要 <b>${minEmails}</b> 个，您提供了 <b>${length}</b> 个。`,
 sms_58: (maxEmails, length) => `❌ 邮箱太多。最多 <b>${maxEmails}</b> 个，您提供了 <b>${length}</b> 个。\n\n请缩减列表。`,
 sms_59: (length) => `⏳ 正在验证 ${length} 个邮箱...\n\n这可能需要一些时间。`,
 sms_6: (sanitizeProviderError) => `❌ DNS 错误：${sanitizeProviderError}`,
 sms_7: (error) => `❌ DNS 错误：${error}`,
 sms_8: (message) => `❌ 错误：${message}`,
 sms_9: (message) => `❌ 错误：${message}`,
 util_1: (displayName, expiryDate) => `⚠️ <b>VPS 即将到期 — 未开启自动续费</b>\n\n🖥️ <b>${displayName}</b> 将于 <b>${expiryDate}</b> 到期。\n自动续费已<b>关闭</b>。\n\n⏰ <b>请在截止日期前手动续费</b>，否则您的服务器将被永久删除。\n\n前往：VPS/RDP → 管理 → 立即续费`,
 util_10: (toLocaleString, domain, v2, v3, v4) => `🎉 <b>您节省了 ₦${toLocaleString}！</b>域名 <b>${domain}</b> 花费 ₦${v2}，而非 ₦${v3}。差额 ₦${v4} 已存入您的钱包余额。`,
 util_11: (website_name, round, APP_SUPPORT_LINK) => `您的域名 <b>${website_name}</b> 已成功注册，但托管设置失败。域名费用已扣除 — 托管部分（₦${round}）已退回您的钱包。请联系支持以完成托管设置：${APP_SUPPORT_LINK}`,
 util_12: '✅ 已收到付款！',
 util_13: (countryName) => `✅ 已收到银行付款！\n\n📍 <b>${countryName}</b> 要求进行地址验证才能激活号码。\n\n请输入您的完整地址：\n<code>街道, 城市, 邮编, 国家</code>\n\n<i>示例：42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\n提交后，我们将处理电信验证流程并自动激活您的号码。`,
 util_14: (countryName, text) => `✅ 已收到银行付款！\n\n📍 <b>${countryName}</b> 需要账单地址才能激活号码。\n地址${text}。\n\n请输入您的地址：\n<code>街道, 城市, 国家</code>\n\n示例：<i>123 Main St, Sydney, Australia</i>`,
 util_15: (delivered, requested, toFixed) => `💰 <b>部分退款</b>\n📊 已交付 ${delivered}/${requested} 条线索\n💵 退款：<b>$${toFixed}</b> → 钱包`,
 util_16: (targetName, length) => `📄 <b>文件 1 — ${targetName} 号码 + 真实姓名（匹配 ${length} 条）</b>`,
 util_17: (targetName, length) => `📄 <b>文件 2 — 所有 ${targetName} 电话号码（共 ${length} 条）</b>`,
 util_18: (ngnIn, toLowerCase) => `✅ 已收到付款！您的钱包已入账 ₦${ngnIn}。请使用钱包完成您的${toLowerCase}购买。`,
 util_2: (displayName, chargedDisplay, toUpperCase, toLocaleDateString, toFixed, v5) => `✅ <b>VPS 已自动续费</b>\n\n🖥️ <b>${displayName}</b> 已续费 1 个月。\n💰 已从 ${toUpperCase} 钱包扣除 ${chargedDisplay}。\n📅 新到期日：<b>${toLocaleDateString}</b>\n\n💳 余额：$${toFixed} / ₦${v5}`,
 util_3: (displayName, toFixed, planPrice, expiryDate) => `🚨 <b>紧急 — VPS 续费失败</b>\n\n🖥️ <b>${displayName}</b> 无法自动续费。\n💰 余额：$${toFixed}\n💵 需要：<b>$${planPrice}/月</b>\n\n⚠️ <b>除非您手动续费，否则服务器将于 ${expiryDate} 被永久删除</b>。\n\n前往：VPS/RDP → 管理 → 📅 立即续费`,
 util_4: (displayName) => `❌ <b>VPS 已取消 — 未收到付款</b>\n\n🖥️ <b>${displayName}</b> 已被取消。\n💰 自动续费失败且未收到手动付款。\n\n💡 您可以随时从主菜单购买新的 VPS。`,
 util_5: (displayName) => `❌ <b>VPS 已删除</b>\n\n🖥️ <b>${displayName}</b> 已被永久删除。\n\n💡 原因：自动续费失败，且在截止日期前未收到手动续费。\n\n您可以随时从主菜单购买新的 VPS。`,
 util_6: (displayName, chargedDisplay, toLocaleDateString, toFixed, v4) => `✅ <b>VPS 已自动续费</b>\n\n🖥️ <b>${displayName}</b> 已续费 1 个月。\n💰 已扣除 ${chargedDisplay}。\n📅 新到期日：<b>${toLocaleDateString}</b>\n\n💳 余额：$${toFixed} / ₦${v4}`,
 util_7: (displayName, toFixed) => `🚨 <b>紧急 — VPS 已到期</b>\n\n🖥️ <b>${displayName}</b> 已到期。\n💰 余额：$${toFixed}\n\n⚠️ <b>服务器即将被删除。</b>\n立即续费：VPS/RDP → 管理 → 📅 立即续费`,
 util_8: (displayName, expiryDate, planPrice, toFixed, statusIcon, v5) => `🖥️ <b>VPS 将在 3 天后到期</b>\n\n<b>${displayName}</b> 将于 <b>${expiryDate}</b> 到期。\n💵 需要：<b>$${planPrice}/月</b>\n💳 余额：$${toFixed}\n${statusIcon} ${v5}`,
 util_9: (domain, ngnPrice) => `💰 <b>自动退款：</b>域名 <b>${domain}</b> 注册失败。您支付的 ${ngnPrice} NGN 已存入您的钱包余额。`,

 // === Windows RDP 3 天宽限期 ===
 rdpGraceStart: (displayName, deleteDate) => `🖥 <b>${displayName}</b> 已<b>到期</b>并已<b>关机</b>。\n\n🗑 除非续订，否则将于 <b>${deleteDate}</b> <b>永久删除</b>（3 天宽限期）——所有数据都将丢失。\n\n♻️ 立即续订：🖥️ VPS/RDP → 管理 → 续订`,
 rdpGraceReminder: (displayName, deleteDate) => `⏳ <b>最后提醒</b>\n\n🖥 除非续订，<b>${displayName}</b> 将于 <b>${deleteDate}</b> <b>永久删除</b>。\n\n之后服务器及其所有数据将无法恢复。\n\n♻️ 立即续订：🖥️ VPS/RDP → 管理 → 续订`,
 rdpDeletedAfterGrace: (displayName) => `🗑 <b>${displayName}</b> 在 3 天宽限期结束且未续订后已被<b>永久删除</b>。\n\n服务器上的所有数据均已丢失。您可以随时从菜单订购新的 Windows RDP。`,
 vps_1: (message) => `❌ 读取文件失败：${message}`,
 vps_10: '✏️ 请输入新的<b>主题</b>行：',
 vps_11: '⚙️ <b>Email Admin Panel</b>',
 vps_12: '📭 No domains configured.',
 vps_13: '🗑 <b>Remove Domain</b>\\n\\nSelect the domain to remove:',
 vps_14: (domainList) => `🌐 <b>Sending Domains</b>\n\n${domainList}`,
 vps_15: (domainToRemove) => `✅ Domain <b>${domainToRemove}</b> removed successfully.\n\nDNS records cleaned up.`,
 vps_16: (error) => `❌ Failed to remove: ${error}`,
 vps_17: (message) => `❌ Error removing domain: ${message}`,
 vps_18: '🌐 Back to domains.',
 vps_19: '❌ Invalid domain name. Please enter a valid domain (e.g., example.com)',
 vps_2: '请选择："📝 输入纯文本" 或 "📎 上传 HTML 文件"',
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
 vps_3: (totalPrice, toFixed) => `❌ 余额不足。需要 $${totalPrice}，但您只有 $${toFixed}。请先充值。`,
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
 vps_4: '请选择支付方式：',
 vps_40: (rate, toFixed) => `✅ Rate updated to <b>$${rate}/email</b> ($${toFixed} per 500)`,
 vps_41: '💰 Back to pricing.',
 vps_42: '❌ Invalid. Enter a number.',
 vps_43: (min) => `✅ Minimum emails updated to <b>${min}</b>`,
 vps_44: '💰 Back to pricing.',
 vps_45: '❌ Invalid. Enter a number.',
 vps_46: (max) => `✅ Maximum emails updated to <b>${max}</b>`,
 vps_47: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_48: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_49: '💵 请输入您要充值的金额（$50 – $1,000）：',
 vps_5: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_50: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_51: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_52: (reason) => `🚫 <b>市场访问受限</b>\n\n您无法创建商品。您的市场访问权限已被暂停。\n原因：<i>${reason}</i>`,
 vps_53: (reason) => `🚫 <b>市场访问受限</b>\n\n您无法创建商品。您的市场访问权限已被暂停。\n原因：<i>${reason}</i>`,
 vps_54: '❌ 发布商品出错。请重试。',
 vps_55: '🚧 VPS 服务即将推出！敬请期待。',
 vps_56: '🚧 VPS 服务即将推出！敬请期待。',
 vps_57: '会话已过期。请重新粘贴您的 URL。',
 vps_58: (displayUrl) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 点击复制`,
 vps_59: (displayUrl) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 点击复制`,
 vps_6: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_60: '❌ 创建短链接出错。请重试。',
 vps_61: '请选择一个选项：',
 vps_62: '会话已过期。请重新粘贴您的 URL。',
 vps_63: '❌ 别名无效。仅可使用字母、数字和连字符。',
 vps_64: '❌ 别名长度必须为 2-30 个字符。',
 vps_65: (customAlias) => `❌ 别名 <code>${customAlias}</code> 已被占用。请尝试其他别名。`,
 vps_66: (displayUrl) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 点击复制`,
 vps_67: (displayUrl) => `✅ <b>链接已缩短！</b>\n\n🔗 <code>${displayUrl}</code>\n\n📋 点击复制`,
 vps_68: '❌ 创建短链接出错。请重试。',
 vps_69: (domain, plan) => `❌ 无法激活 URL 缩短器 — <b>${domain}</b> 有一个活跃的托管套餐（<b>${plan}</b>）。\n\n缩短器的 CNAME 会替换您的托管 A 记录，导致网站离线。\n\n请使用其他域名，或先停用您的托管套餐。`,
 vps_7: (toLocaleString, price, totalEmails) => `📧 <b>邮件群发付款</b>\n\n💵 金额：<b>₦${toLocaleString}</b>（约 $${price}）\n📬 活动：${totalEmails} 封邮件\n\n🏦 请通过下方链接完成付款：`,
 vps_70: (domain, sanitizeProviderError) => `❌ 无法关联 <b>${domain}</b>：${sanitizeProviderError}`,
 vps_71: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> 的 DNS 错误：${sanitizeProviderError}`,
 vps_72: (domain, error) => `❌ <b>${domain}</b> 的 DNS 错误：${error}`,
 vps_73: '请选择一个有效的域名',
 vps_74: (shortUrl) => `您的短链接是：${shortUrl}`,
 vps_75: (shortUrl) => `您的短链接是：${shortUrl}`,
 vps_76: (domain) => `❌ <b>${domain}</b> 因违反滥用政策已被封禁，无法注册或使用。`,
 vps_77: (domain) => `🔍 正在查询 ${domain} 的可用性...`,
 vps_78: (domain) => `❌ <b>${domain}</b> 不可用。`,
 vps_79: (baseName) => `🔍 正在为 <b>${baseName}</b> 搜索替代域名...`,
 vps_8: '❌ 邮箱地址无效。请输入有效邮箱（例如 you@gmail.com）：',
 vps_80: (altList) => `✅ 可用的替代域名：\n\n${altList}\n\n输入任意域名进行查询：`,
 vps_81: '未找到替代域名。请尝试其他名称：',
 vps_82: (ns) => `域名服务器无效：<code>${ns}</code>\n请输入有效的域名服务器主机名。`,
 vps_83: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_84: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_85: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_86: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_87: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_88: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_89: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_9: (testAddr) => `⏳ Sending test email to <b>${testAddr}</b> via Brevo...`,
 vps_90: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_91: '⚠️ 支付处理暂时不可用（汇率服务中断）。请稍后重试或使用加密货币。',
 vps_92: '银行 ₦奈拉 + 银行卡 🌐︎',
 vps_93: 'DNS 记录由您的自定义域名服务器提供商管理。请使用"🔄 管理域名服务器"更换提供商。',
 vps_94: (domain, plan) => `❌ 无法激活 URL 缩短器 — <b>${domain}</b> 有一个活跃的托管套餐（<b>${plan}</b>）。\n\n缩短器的 CNAME 会替换您的托管 A 记录，导致网站离线。\n\n请使用其他域名，或先停用您的托管套餐。`,
 vps_95: (domain, sanitizeProviderError) => `❌ 无法关联 <b>${domain}</b>：${sanitizeProviderError}`,
 vps_96: (domain, sanitizeProviderError) => `❌ <b>${domain}</b> 的 DNS 错误：${sanitizeProviderError}`,
 vps_97: (domain, error) => `❌ <b>${domain}</b> 的 DNS 错误：${error}`,
 vps_98: (message) => `❌ 错误：${message}`,
 wh_1: (toFixed) => `💰 多余的 ₦ 已存入钱包：<b>$${toFixed}</b>`,
 wh_10: (length) => `📄 <b>文件 1 — 号码 + 真实姓名（匹配 ${length} 条）</b>`,
 wh_11: (length) => `📄 <b>文件 2 — 所有电话号码（共 ${length} 条）</b>`,
 wh_12: (toFixed, toLowerCase) => `✅ 已收到付款！您的钱包已入账 $${toFixed}。请使用钱包完成您的${toLowerCase}购买。`,
 wh_13: (toFixed, usdBal) => `❌ VPS 开通失败。\n\n💰 <b>$${toFixed}</b> 已退回您的钱包。\n钱包余额：<b>$${usdBal}</b>\n\n请重试或联系支持。`,
 wh_14: (domain, price) => `💰 <b>自动退款：</b>域名 <b>${domain}</b> 注册失败。$${price} 已存入您的钱包余额。`,
 wh_15: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>您节省了 $${v4}！</b>域名 <b>${domain}</b> 花费 $${cheaperPrice}，而非 $${price}。差额 $${savingsUsd} 已存入您的钱包余额。`,
 wh_16: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `您的域名 <b>${website_name}</b> 已成功注册，但托管设置失败。域名费用（$${domainPrice}）已扣除 — 托管部分（$${toFixed}）已退回您的钱包。请联系支持以完成托管设置：${APP_SUPPORT_LINK}`,
 wh_17: '✅ 已收到加密货币付款！',
 wh_18: (countryName) => `✅ 已收到加密货币付款！\n\n📍 <b>${countryName}</b> 要求进行地址验证才能激活号码。\n\n请输入您的完整地址：\n<code>街道, 城市, 邮编, 国家</code>\n\n<i>示例：42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\n提交后，我们将处理电信验证流程并自动激活您的号码。`,
 wh_19: (countryName, text) => `✅ 已收到加密货币付款！\n\n📍 <b>${countryName}</b> 需要账单地址才能激活号码。\n地址${text}。\n\n请输入您的地址：\n<code>街道, 城市, 国家</code>\n\n示例：<i>123 Main St, Sydney, Australia</i>`,
 wh_2: (domain, price) => `💰 <b>自动退款：</b>域名 <b>${domain}</b> 注册失败。$${price} 已存入您的钱包余额。`,
 wh_20: (toFixed) => `💰 多余的加密货币已存入钱包：<b>$${toFixed}</b>`,
 wh_21: (delivered, requested, toFixed) => `💰 <b>部分退款</b>\n📊 已交付 ${delivered}/${requested} 条线索\n💵 退款：<b>$${toFixed}</b> → 钱包`,
 wh_22: (toFixed, toLowerCase) => `✅ 已收到付款！您的钱包已入账 $${toFixed}。请使用钱包完成您的${toLowerCase}购买。`,
 wh_23: (toFixed, usdBal) => `❌ VPS 开通失败。\n\n💰 <b>$${toFixed}</b> 已退回您的钱包。\n钱包余额：<b>$${usdBal}</b>\n\n请重试或联系支持。`,
 wh_3: (savingsUsd, domain, cheaperPrice, price, v4) => `🎉 <b>您节省了 $${v4}！</b>域名 <b>${domain}</b> 花费 $${cheaperPrice}，而非 $${price}。差额 $${savingsUsd} 已存入您的钱包余额。`,
 wh_4: (website_name, domainPrice, toFixed, APP_SUPPORT_LINK) => `您的域名 <b>${website_name}</b> 已成功注册，但托管设置失败。域名费用（$${domainPrice}）已扣除 — 托管部分（$${toFixed}）已退回您的钱包。请联系支持以完成托管设置：${APP_SUPPORT_LINK}`,
 wh_5: '✅ 已收到加密货币付款！',
 wh_6: (countryName) => `✅ 已收到加密货币付款！\n\n📍 <b>${countryName}</b> 要求进行地址验证才能激活号码。\n\n请输入您的完整地址：\n<code>街道, 城市, 邮编, 国家</code>\n\n<i>示例：42 Hamilton Ave, Bryanston, 2191, South Africa</i>\n\n提交后，我们将处理电信验证流程并自动激活您的号码。`,
 wh_7: (countryName, text) => `✅ 已收到加密货币付款！\n\n📍 <b>${countryName}</b> 需要账单地址才能激活号码。\n地址${text}。\n\n请输入您的地址：\n<code>街道, 城市, 国家</code>\n\n示例：<i>123 Main St, Sydney, Australia</i>`,
 wh_8: (toFixed) => `💰 多余的加密货币已存入钱包：<b>$${toFixed}</b>`,
 wh_9: (requested, delivered, toFixed, v3) => `💰 <b>部分退款</b>\n\n📊 已订购：${requested} 条线索\n✅ 已交付：${delivered}\n💵 退款：<b>$${toFixed}</b> 已存入您的钱包\n💰 钱包：$${v3} USD`,
 wlt_1: '⏳ 支付已在进行中。请稍候...',
 wlt_10: '⚠️ 无法加载交易记录。请稍后重试。',
 wlt_11: (amount) => `💵 充值 <b>$${amount}</b>\n\n请选择支付方式：`,
 wlt_12: '⚠️ NGN 支付暂时不可用（汇率服务中断）。请尝试加密货币。',
 wlt_13: '银行 ₦奈拉 + 银行卡 🌐︎',
 wlt_2: (reason) => `🚫 <b>市场访问受限</b>\n\n您的市场访问权限已被暂停。\n原因：<i>${reason}</i>\n\n如果您认为这是误判，请联系支持。`,
 wlt_3: (priceText, askDomainToUseWithShortener) => `${priceText}${askDomainToUseWithShortener}`,
 wlt_4: '请选择链接类型：',
 wlt_5: '✏️ 请输入自定义别名（仅限字母、数字和连字符）：',
 wlt_6: '🔗 <b>为 URL 缩短器激活域名</b>\n\n请选择要与缩短器关联的域名。DNS 将自动配置，以便您创建品牌短链接（例如 <code>yourdomain.com/abc</code>）。',
 wlt_7: (label) => `删除 ${label}？`,
 wlt_8: '⏳ 正在加载交易记录...',
 wlt_9: '📜 <b>交易记录</b>\n\n暂无交易。充值或购买后即可在此查看活动。',

 // Unlink / cancel hosting plan (Zh)
 selectDomainToUnlink: mainDomain => `🗑️ <b>解除域名绑定</b>\n\n选择要从此主机方案解除的域名。\n\n⚠️ 解除将会：\n• 从 cPanel 中移除附加域名\n• 删除 Cloudflare 上的 DNS 记录\n• 移除 Anti-Red 保护\n• <b>永久删除</b> <code>public_html/&lt;域名&gt;/</code> 中的所有文件\n\n此操作无法撤销。\n\n<i>主域名（<b>${mainDomain}</b>）无法在此处解除 — 请使用"取消主机方案"。</i>`,
 noAddonDomainsToUnlink: '⚠️ 此主机方案没有可解除的附加域名。仅主域名已连接。\n\n如需移除主域名，请使用"🚫 取消主机方案"。',
 confirmUnlinkDomain: (addonDomain, mainDomain) => `⚠️ <b>确认解除绑定</b>\n\n您即将从主机方案（<code>${mainDomain}</code>）中解除 <b>${addonDomain}</b>。\n\n这将：\n• 从 cPanel 移除附加域名\n• 删除 <b>${addonDomain}</b> 的所有 DNS 记录\n• 移除 Anti-Red 保护\n• <b>永久删除</b> <code>public_html/${addonDomain.replace(/\./g, '')}/</code> 下的文件\n\n此操作<b>无法撤销</b>，且不予退款。\n\n继续？`,
 unlinkingDomain: addonDomain => `⏳ 正在解除 <b>${addonDomain}</b>...`,
 unlinkDomainSuccess: addonDomain => `✅ <b>${addonDomain}</b> 已从您的主机方案解除。\n\nDNS 记录、附加域名条目以及 Anti-Red 保护均已移除。`,
 unlinkDomainFailed: addonDomain => `❌ 解除 <b>${addonDomain}</b> 失败。请重试或联系支持。`,

 // 添加附加域名到现有主机方案
 selectDomainToAttachHeader: mainDomain => `➕ <b>添加域名到方案</b>\n\n选择要附加到主机方案 (<code>${mainDomain}</code>) 的域名。\n\n仅显示在我们处注册且未关联到任何主机方案的域名。\n\n<i>新域名的文件将存放在 <code>public_html/&lt;域名&gt;/</code> 中，与主站独立。</i>`,
 noEligibleDomainsToAttach: '⚠️ 没有可用的域名。\n\n要附加域名到此方案，域名必须：\n• 在我们处注册，且\n• 尚未关联到任何主机方案。\n\n请注册新域名，然后返回此处附加。',

 // 更换主机方案的主域名
 selectDomainToMakePrimary: mainDomain => `🔄 <b>更换主域名</b>\n\n选择要成为此主机方案新主域名的域名（当前为 <code>${mainDomain}</code>）。\n\n仅显示您拥有且不是其他方案主域名的域名。\n\n<i>您的网站文件保持原位（<code>public_html/</code>）。cPanel 用户名和 PIN 保持不变。</i>`,
 noEligibleDomainsToMakePrimary: '⚠️ 没有可用的域名。\n\n要更换主域名，您需要另一个域名，且该域名：\n• 在我们处注册（可在 🌐 防弹域名 购买），且\n• 尚未作为其他主机方案的主域名。\n\n请购买或注册一个域名，然后返回此处切换。',
 confirmChangePrimaryDomain: (newDomain, oldDomain) => `⚠️ <b>确认更换主域名</b>\n\n将 <b>${newDomain}</b> 设为此方案的主域名？\n\n将会发生：\n• <b>${newDomain}</b> 成为您的主站域名\n• <b>${oldDomain}</b> 将从此主机方案移除 — 仍归您注册所有，仅解除主机关联\n• <code>public_html/</code> 中的文件保留，现由 <b>${newDomain}</b> 提供\n• 为 <b>${newDomain}</b> 配置 DNS + Anti-Red 保护\n• cPanel 用户名和 PIN 保持不变\n\n此操作<b>无法撤销</b>，且不予退款。\n\n继续？`,
 changingPrimaryDomain: newDomain => `⏳ 正在将您的主域名切换为 <b>${newDomain}</b>...`,
 changePrimaryDomainSuccess: (newDomain, oldDomain, panelUrl) => `✅ <b>${newDomain}</b> 现在是您的主域名！\n\n• <b>${oldDomain}</b> 已从此主机方案移除（仍归您注册）。\n• <code>public_html/</code> 中的现有文件现由 <b>${newDomain}</b> 提供。\n• cPanel 用户名和 PIN 不变。\n\n🔧 打开文件管理器：${panelUrl}\n\n⏱️ DNS 传播：通常 5 分钟内生效。\n🛡️ Anti-Red 保护：部署中（30 秒后验证）。`,
 changePrimaryDomainFailed: (newDomain, error) => `❌ 无法将您的主域名切换为 <b>${newDomain}</b>。\n\n<code>${error}</code>\n\n您的方案未做任何更改。请重试或联系客服。`,
 confirmAttachDomain: (addonDomain, mainDomain, docRoot) => `🔗 <b>确认附加</b>\n\n将 <b>${addonDomain}</b> 附加到主机方案 (<code>${mainDomain}</code>)？\n\n后续步骤：\n• 创建 cPanel 附加域名条目（与主站隔离）\n• 文档根目录：<code>${docRoot}/</code>\n• 通过 Cloudflare 自动配置 DNS（根域+www → 隧道）\n• 部署 Anti-Red 保护\n• 清理旧 DNS（例如缩短器记录）\n\n<i>该文件夹内现有文件将保留。</i>\n\n继续？`,
 attachingDomain: addonDomain => `⏳ 正在将 <b>${addonDomain}</b> 附加到您的主机方案...`,
 attachDomainSuccess: (addonDomain, docRoot, panelUrl) => `✅ <b>${addonDomain}</b> 已连接到您的主机方案！\n\n📁 <b>网站文件上传位置</b>\n此域名的文件存放在：\n<code>${docRoot}/</code>\n\n不是 <code>public_html/</code> — 那是<i>主</i>域名文件的位置。每个附加域名有独立文件夹避免冲突。\n\n🔧 打开文件管理器：${panelUrl}\n\n⏱️ DNS 传播：通常 5 分钟内生效。\n🛡️ Anti-Red 保护：部署中（30 秒后验证）。`,
 attachDomainFailed: (addonDomain, errorReason) => `❌ 无法附加 <b>${addonDomain}</b>。\n\n<i>原因：</i> ${errorReason || '未知错误'}\n\n请重试，如问题仍存在，请点击 💬 获取支持。`,
 attachDomainAlreadyOnPlan: addonDomain => `⚠️ <b>${addonDomain}</b> 已关联到主机方案。一个域名同一时间只能关联到一个方案。\n\n如需移到此方案，请先在另一方案上使用 🗑️ 解除域名绑定。`,
 attachDomainLimitReached: (limit, planLabel) => `⚠️ <b>已达域名上限</b>\n\n您当前方案 (<b>${planLabel}</b>) 最多允许 ${limit} 个附加域名。\n\n升级到 Golden Anti-Red HostPanel 享无限附加域名，或解除现有附加域名以腾出位置。`,
 attachDomainBlocked: addonDomain => `🚫 <b>${addonDomain}</b> 无法附加。\n\n此域名因违反滥用政策已被永久封禁。`,
 attachDomainAlreadyAttached: addonDomain => `ℹ️ <b>${addonDomain}</b> 已附加到此方案 — 无需操作。`,

 confirmCancelHostingPlan: (domain, plan) => `⚠️ <b>确认取消主机方案</b>\n\n您即将永久取消：\n• 域名：<b>${domain}</b>\n• 方案：<b>${plan}</b>\n\n这将<b>永久删除</b>：\n• 您的 cPanel 帐号及所有文件\n• 所有邮箱、数据库和 FTP 帐号\n• 此方案下的所有附加域名\n• Anti-Red 保护\n\n无法撤销，<b>不予退款</b>。\n\n域名仍归您注册所有，仅主机方案被取消。\n\n确定吗？`,
 cancellingHostingPlan: domain => `⏳ 正在取消 <b>${domain}</b> 的主机方案...`,
 cancelHostingPlanSuccess: domain => `✅ <b>${domain}</b> 的主机方案已取消。\n\n您的 cPanel 帐号、文件和所有附加域名已被移除。域名仍归您注册所有，且现已不绑定任何主机方案。`,
 cancelHostingPlanFailed: domain => `❌ 取消 <b>${domain}</b> 的主机方案失败。请重试或联系支持。`,

 // Site offline / maintenance toggle (Zh)
 chooseSiteOfflineMode: domain => `🔌 <b>让网站下线</b>\n\n域名：<b>${domain}</b>\n\n请选择下线方式：\n\n🛠️ <b>维护模式</b>（推荐）\n访客看到一个干净的"我们很快回来"页面。邮箱、FTP、数据库继续工作。适合快速编辑或短时间下线。\n\n🚫 <b>完全暂停</b>\nHTTP、FTP、邮箱、数据库全部停止。访客看到 cPanel 标准的"账户已暂停"通知。如需完全停掉所有服务请使用此项。\n\n⚠️ <b>重要 — 让网站下线不会暂停：</b>\n• 到期倒计时\n• 自动续费扣款\n\n方案仍然正常计时。这只是可见性开关。`,
 confirmSiteOfflineMode: (domain, mode) => mode === 'suspended'
  ? `⚠️ <b>确认完全暂停</b>\n\n您即将完全暂停 <b>${domain}</b>。\n\n这将停止：\n• HTTP（您的网站）\n• FTP\n• 邮箱账户\n• 数据库\n\n访客将看到 cPanel 标准的"账户已暂停"页面。您随时可以从同一菜单恢复全部服务。\n\n<b>提醒 — 计费照常进行：</b>\n• 到期日期不变\n• 自动续费仍会触发\n\n继续？`
  : `⚠️ <b>确认维护模式</b>\n\n您即将为 <b>${domain}</b> 启用维护模式。\n\n将会发生：\n• 访客看到"我们很快回来"页面\n• 邮箱、FTP、数据库继续工作\n• 在您的 <code>.htaccess</code> 中添加一小段代码块（恢复在线时会被干净移除）\n• 在 <code>public_html/</code> 中创建 <code>maintenance.html</code> 文件\n\n<b>提醒 — 计费照常进行：</b>\n• 到期日期不变\n• 自动续费仍会触发\n\n继续？`,
 takingSiteOffline: (domain, mode) => `⏳ ${mode === 'suspended' ? '正在暂停' : '正在为以下域名启用维护模式'} <b>${domain}</b>...`,
 takeSiteOfflineSuccess: (domain, mode) => mode === 'suspended'
  ? `✅ <b>${domain}</b> 已下线（完全暂停）。访客看到暂停页面。点击"让网站上线"以恢复。\n\n<i>提醒：您的方案继续向到期日倒计时，自动续费不受影响。</i>`
  : `✅ <b>${domain}</b> 已进入维护模式。访客看到"我们很快回来"页面。邮箱与 FTP 仍正常工作。准备就绪后点击"让网站上线"。\n\n<i>提醒：您的方案继续向到期日倒计时，自动续费不受影响。</i>`,
 takeSiteOfflineFailed: (domain, err) => `❌ 让 <b>${domain}</b> 下线失败。${err ? `\n\n原因：<code>${err}</code>` : ''}\n\n请重试或联系支持。`,
 confirmBringSiteOnline: domain => `🌐 <b>让网站重新上线</b>\n\n域名：<b>${domain}</b>\n\n这将立即恢复公共访问。如果您使用的是<i>维护模式</i>，<code>.htaccess</code> 中的重定向块将被移除。如果您使用的是<i>完全暂停</i>，cPanel 账户将取消暂停，HTTP/FTP/邮箱/DB 全部恢复。\n\n继续？`,
 bringingSiteOnline: domain => `⏳ 正在让 <b>${domain}</b> 重新上线...`,
 bringSiteOnlineSuccess: domain => `✅ <b>${domain}</b> 已重新上线。请等待最多 1 分钟以让缓存/CDN 完全清除。`,
 bringSiteOnlineFailed: (domain, err) => `❌ 让 <b>${domain}</b> 重新上线失败。${err ? `\n\n原因：<code>${err}</code>` : ''}\n\n请重试或联系支持。`,

 // SMS app activation / device management
 smsAppActivationCode: (chatId, plan, isSubscribed) => {
   if (!isSubscribed) {
     return `📱 <b>BulkSMS 免费试用 — 100 条免费 SMS</b>\n\n📲 <b>仅限 Android 设备</b> — 不支持 iOS/iPhone（Apple 限制应用发送 SMS）。\n\n您的激活码：\n<code>${chatId}</code>\n\n📲 <b>下载应用：</b>${SMS_APP_LINK}\n\n打开应用 → 输入您的代码 → 开始发送！\n\n⚡ <b>试用：</b>仅限 1 台设备。\n\n💡 在主菜单点击 <b>⚡ 升级计划</b> 解锁无限设备 + BulkSMS + URL 缩短 + 验证 & 更多！\n\n需要 eSIM 卡？点击 💬 支持`
   }
   const deviceLimit = plan === 'Monthly' ? '无限' : (plan === 'Weekly' ? '10' : (plan === 'Daily' ? '3' : '1'))
   return `📱 <b>BulkSMS — ${plan} 计划已激活 ✅</b>\n\n📲 <b>仅限 Android 设备</b> — 不支持 iOS/iPhone（Apple 限制应用发送 SMS）。\n\n您的激活码：\n<code>${chatId}</code>\n\n📲 <b>下载应用：</b>${SMS_APP_LINK}\n\n打开应用 → 输入您的代码 → 开始发送！\n\n⚡ <b>设备：</b>${deviceLimit} ${deviceLimit === '无限' ? '台设备' : '台设备'}\n\n在应用或机器人中创建活动。\n\n需要 eSIM 卡？点击 💬 支持`
 },
 smsManageDevices: '📱 管理设备',
 smsDevicesList: (devices, chatId) => {
   if (!devices || devices.length === 0) {
     return `📱 <b>没有连接的设备</b>\n\n下载应用并使用您的激活码登录：\n<code>${chatId}</code>\n\n📲 下载：${SMS_APP_LINK}`
   }
   const deviceList = devices.map((d, idx) => {
     const name = d.deviceName || `设备 ${idx + 1}`
     const lastActive = d.lastActive ? new Date(d.lastActive).toLocaleString() : '从未'
     return `${idx + 1}. <b>${name}</b>\n   📱 <code>${d.deviceId}</code>\n   🕒 ${lastActive}`
   }).join('\n\n')
   return `📱 <b>您的设备 (${devices.length})</b>\n\n${deviceList}\n\n✏️ 点击下面的设备按钮重命名，或在应用中重命名。`
 },

 // Payment timeout and abandoned cart reminders
 paymentTimeoutReminder: `⏰ <b>您的付款会话已超时</b>\n\n您的结账会话在 6 小时无活动后已过期。\n\n别担心！您可以随时通过选择您想要的产品或服务重新开始。\n\n💬 需要帮助？点击 <b>支持</b>`,
 abandonedCartReminder: (productName, price) =>
   `🛒 <b>仍然对 ${productName} 感兴趣吗？</b>\n\n` +
   `2 小时前您将其留在了购物车中。\n\n` +
   `💳 价格：$${price}\n\n` +
   `立即完成购买！产品正在等待您。🎁\n\n` +
   `点击 /start 继续或如有疑问请点击 💬 <b>支持</b>。`,
}

const phoneNumberLeads = ['🎯 精准目标线索', '✅📲 验证电话线索']

const buyLeadsSelectCountry = Object.keys(areasOfCountry)
const buyLeadsSelectSmsVoice = ['短信 (价格为 20$/1000)', '语音 (价格为 0$/1000)']
const buyLeadsSelectArea = country => Object.keys(areasOfCountry?.[country])
const buyLeadsSelectAreaCode = (country, area) => {
 const codes = areasOfCountry?.[country]?.[area].map(c => format(countryCodeOf[country], c))
 return codes.length > 1 ? ['Mixed Area Codes'].concat(codes) : codes
}
const _buyLeadsSelectAreaCode = (country, area) => areasOfCountry?.[country]?.[area]
const buyLeadsSelectCnam = yesNo
const buyLeadsSelectCarrier = country => carriersOf[country]
const buyLeadsSelectAmount = ['1000', '2000', '3000', '4000', '5000']
const buyLeadsSelectFormat = ['本地格式', '国际格式']

const validatorSelectCountry = Object.keys(areasOfCountry)
const validatorSelectSmsVoice = ['短信 (价格为 20$/1000)', '语音 (价格为 0$/1000)']
const validatorSelectCarrier = country => carriersOf[country]
const validatorSelectCnam = yesNo
const validatorSelectAmount = ['ALL', '1000', '2000', '3000', '4000', '5000']
const validatorSelectFormat = ['本地格式', '国际格式']

const selectFormatOf = {
 本地格式: 'Local Format',
 国际格式: 'International Format',
}

//redSelectRandomCustom

const redSelectRandomCustom = ['随机短链接']

const redSelectProvider = ['Bit.ly $10', `Shortit（试用 ${FREE_LINKS}）`]

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
 BTC: '₿ 比特币 (BTC)',
 LTC: 'Ł 莱特币 (LTC)',
 DOGE: 'Ð 狗狗币 (DOGE)',
 BCH: 'Ƀ 比特币现金 (BCH)',
 ETH: 'Ξ 以太坊 (ETH)',
 TRON: '🌐 波场 (TRX)',
 'USDT (TRC20)': '₮ 泰达币 (USDT - TRC20)',
 'USDT (ERC20)': '₮ 泰达币 (USDT - ERC20)',
}

/////////////////////////////////////////////////////////////////////////////////////
const _bc = ['返回', '取消']
const _mc = ['🏠 Main Menu', '取消']
const _isEmojiBack = item => {
  if (typeof item !== 'string') return false
  const s = item.replace(/^[^\p{L}]+/u, '').trim()
  return s === 'Back' || s === 'Retour' || s === '返回' || s === 'वापस'
}

const payIn = {
 crypto: '加密货币',
 ...(HIDE_BANK_PAYMENT !== 'true' && { bank: '银行 ₦奈拉 + 卡🏦💳' }),
 wallet: '👛 钱包',
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
 en: '🇬🇧 英语',
 fr: '🇫🇷 法语',
 zh: '🇨🇳 中国人',
 hi: '🇮🇳 印地语',
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
 continueAtHostbay: '🚀 所有服务现已在 Nomadly Bot 上提供 — 域名、线索、Cloud IVR、数字产品等。',
 redirectMessage: '🚀 所有服务现已在 Nomadly Bot 上提供 — 域名、线索、Cloud IVR、数字产品等。',

 serviceAd: `━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>Nomadly</b> — 您的数字工具箱
━━━━━━━━━━━━━━━━━━━━━━

📞 <b>Cloud IVR + SIP</b>
30+ 国家虚拟号码
IVR 自动应答 · 短信 · 语音信箱 · SIP
快速IVR和批量IVR活动

🌐 <b>防弹域名</b>
1,000+ TLDs · DMCA 豁免离岸注册
DNS 管理 · Anti-Red 保护

🛡️ <b>Anti-Red 托管</b>
离岸 HostPanel · 按周和按月
JS Challenge 防护 · SSL 包含

🛒 <b>数字产品</b>
Twilio · Telnyx · AWS · Google Cloud
Google Workspace · Zoho Mail · eSIM

💳 <b>虚拟借记卡</b>
即时虚拟卡 · 全球使用

🎯 <b>验证电话线索</b>
按国家、运营商和区号筛选
高级线索含机主姓名

🔗 <b>短链接服务</b>
品牌链接 · 自定义域名 · 数据分析

━━━━━━━━━━━━━━━━━━━━━━
💰 支付方式：<b>加密货币 · 银行转账 · 钱包</b>
━━━━━━━━━━━━━━━━━━━━━━

🤖 <b>立即开始 →</b> @Nomadlybot
💬 <b>需要帮助？</b> 在机器人中点击获取支持
📢 <b>更新 →</b> ${TG_CHANNEL}`,

 askPreferredLanguage: `🌍 为了确保一切都符合您的首选语言，请在下面选择一种：
 
 您随时可以在设置中更改您的语言。`,
 askValidLanguage: '请选择一个有效的语言：',
 settingsMenuText: '⚙️ <b>设置</b>\n\n在下方管理您的偏好：',
 welcomeMessage: `👋 欢迎来到 ${CHAT_BOT_NAME}！
我们很高兴您来到这里！🎉
让我们帮您快速开始，探索我们提供的所有精彩功能吧！🌟

设置过程简单快捷——让我们开始吧！🚀`,
 askUserEmail: '你的电子邮件是什么？让我们个性化您的体验吧！（例如，davidsen@gmail.com）',
 processUserEmail: `谢谢 😊 我们正在为您设置帐户。
 请稍等片刻，我们正在最终处理细节。 ⏳
 
 我们在后台工作。请按步骤操作！`,
 confirmUserEmail: `✨ 好消息！您的帐户已准备好！ 🎉💃🎉
 
 享受免费试用期的高级功能！`,
 termsAndCond: `📜 进行之前，请查看并接受我们的条款和条件。`,
 acceptTermMsg: `请接受 ${CHAT_BOT_NAME} 的条款和条件以继续使用。`,
 acceptTermButton: '✅ 接受',
 declineTermButton: '❌ 拒绝',
 viewTermsAgainButton: '🔄 查看条款',
 exitSetupButton: '❌ 退出设置',
 acceptedTermsMsg: `✅ 您已成功接受条款和条件！ 🎉
 您已准备好开始使用 ${CHAT_BOT_NAME}。让我们进入有趣的部分！ 🎯`,
 declinedTermsMsg: `⚠️ 您需要接受条款和条件才能继续使用 ${CHAT_BOT_NAME}。 
 请在您准备好的时候再次查看。`,
 userExitMsg: '用户按下了退出按钮。',
 termsAndCondMsg: `<h1>${CHAT_BOT_NAME} 使用条款</h1>
 <p><strong>生效日期：</strong>2022年1月1日</p>
 <p>使用 ${CHAT_BOT_NAME} 即表示您同意这些使用条款。</p>

 <h2>1. 条款接受</h2>
 <p>您必须年满 18 岁或获得监护人同意，并同意这些条款以及我们的隐私政策。</p>

 <h2>2. 提供的服务</h2>
 <p>我们提供域名注册、网站托管以及网站/应用程序设置支持。</p>

 <h2>3. 用户责任</h2>
 <p>提供准确的信息，避免非法活动，并保护您的 Telegram 账户安全。</p>

 <h2>4. 支付条款</h2>
 <p>所有支付均为最终支付，除非另有说明。未支付可能导致服务暂停。</p>

 <h2>5. 服务限制</h2>
 <p>我们可能会施加资源限制或因维护或技术问题而中断服务。</p>

 <h2>6. 终止</h2>
 <p>如有违规或未支付费用，我们可以终止服务。用户可以随时取消，但费用不予退还。</p>

 <h2>7. 责任</h2>
 <p>服务按“现状”提供。我们对数据丢失、中断或用户安全漏洞不承担责任。</p>

 <h2>8. 隐私</h2>
 <p>我们按照隐私政策管理您的数据，仅在法律要求时共享。</p>

 <h2>9. 条款变更</h2>
 <p>我们可能会更新这些条款，继续使用即表示您接受。</p>

 <h2>10. 联系</h2>
 <p>如需支持，请通过 <a href="${APP_SUPPORT_LINK}" target="_blank">${APP_SUPPORT_LINK}</a> 联系我们。</p>

 <p>使用 ${CHAT_BOT_NAME} 即表示您同意这些条款。谢谢！</p>`,
}

const termsAndConditionType = lang => ({
 reply_markup: {
 inline_keyboard: [
 [
 {
 text: '查看条款和条件',
 web_app: {
 url: `${SELF_URL}/terms-condition?lang=${lang}`,
 },
 },
 ],
 ],
 },
})

const planOptions = ['每日', '每周', '每月']
const planOptionsOf = {
 每日: 'Daily',
 每周: 'Weekly',
 每月: 'Monthly',
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
 text: '进行支付',
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
 duration: '7 天',
 storage: '10 GB SSD',
 bandwidth: '100 GB',
 domains: '最多 2 个域名',
 ssl: '免费 SSL',
 protection: 'IP 伪装 · 机器人检测 · UA 拦截',
 panel: 'HostPanel — 文件、数据库和邮箱管理',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 天',
 storage: '50 GB SSD',
 bandwidth: '500 GB',
 domains: '最多 6 个域名',
 ssl: '免费 SSL',
 protection: 'IP 伪装 · JS 挑战 · UA 与 TLS 拦截',
 panel: 'HostPanel — 备份、迁移和高级工具',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 天',
 storage: '100 GB SSD',
 bandwidth: '不限流量',
 domains: '不限域名',
 ssl: '免费 SSL + 通配符',
 protection: '完整 Anti-Red：IP 伪装 · JS 挑战 · TLS/JA3 · WAF 规则 · 优先支持',
 panel: 'HostPanel — 预发布环境、安全与全部高级工具',
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
 buyText: '不错的选择！您想如何连接域名？\n\n🌐 <b>注册新域名</b>\n📂 <b>使用我的域名</b> — 从您已注册的域名中选择\n🔗 <b>连接外部域名</b> — 使用您在别处拥有的域名',
 registerNewDomainText: '请输入您要注册的域名（例如：example.com）。',
 domainNotFound: '您输入的域名未找到。请确保输入正确或尝试使用其他域名。',
 useExistingDomainText: '请输入您的现有域名（例如：example.com）。',
 connectExternalDomainText: '请输入您的外部域名（例如：example.com）\n\n设置完成后，您需要将域名服务器指向 Cloudflare。',
 useExistingDomainNotFound: '您输入的域名与您的账户无关联。请检查输入是否正确或联系支持。',
 enterYourEmail: '请提供您的电子邮件地址以创建账户并发送收据。',
 invalidEmail: '请提供一个有效的电子邮件地址。',
 paymentConfirmation: '请确认交易以继续购买。',
 paymentSuccess: `我们正在验证您的付款。一旦确认，您将立即收到通知。感谢您的选择！`,
 paymentFailed: '付款失败，请重试。',
 }

 return `${commonSteps[step]}`
 },

 generateDomainFoundText: (websiteName, price, hostingPrice, total, planName) => {
   if (hostingPrice && total) {
     return `✅ <b>${websiteName}</b> 可用！\n\n` +
       `🌐 域名：<b>$${price}</b>\n` +
       `🛡️ 主机${planName ? `（${planName}）` : ''}：<b>$${hostingPrice}</b>\n` +
       `━━━━━━━━━━━━\n` +
       `💰 <b>今日合计：$${total}</b>`
   }
   return `域名 ${websiteName} 可用！费用为 $${price}。`
 },
 generateExistingDomainText: websiteName => `您选择了 ${websiteName} 作为您的域名。`,
 connectExternalDomainText: websiteName => `您想将 <b>${websiteName}</b> 连接为您的域名。\n\n购买后，您需要将域名的名称服务器指向 Cloudflare。`,
 domainNotFound: websiteName => `域名 ${websiteName} 不可用。`,
 nameserverSelectionText: websiteName => `请选择您想为 ${websiteName} 使用的域名服务器提供商。`,
 confirmEmailBeforeProceeding: email => `您确定要继续使用此电子邮件 ${email} 吗？`,

 generateInvoiceText: payload => `
<b>域名注册</b>
<b>- 域名： </b> ${payload.domainName}
<b>- 费用： </b> $${payload?.existingDomain ? '0（使用现有域名）' : payload.domainPrice}
 
<b>网站托管</b>
<b>- 时长： </b> 1 个月
<b>- 费用： </b> $${payload.hostingPrice}
 
<b>总金额：</b>
<b>- 优惠券折扣： </b> $${payload.couponDiscount}
<b>- USD： </b> $${payload?.couponApplied ? payload.newPrice : payload.totalPrice}
<b>- 税费： </b> $0.00
 
<b>付款条款</b>
这是一份预付款发票。请确保在 1 小时内完成付款，以便激活您的域名和托管服务。收到付款后，我们将立即为您激活服务。
`,

 showCryptoPaymentInfo: (priceUsd, priceCrypto, tickerView, address, plan) => `💰 <b>合计: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

支付确认后，您的 ${plan} 将自动激活（通常只需几分钟）。`,

 successText: (info, response) =>
 `您的托管已上线。

<b>域名：</b> ${info.website_name}
${info.email ? `<b>电子邮件：</b> ${info.email}\n` : ''}DNS 已通过 Cloudflare 自动配置。`,

 support: (plan, statusCode) => `设置过程中出现问题 ${plan} | ${statusCode}. 
 请点击 💬 获取支持.
 更多信息 ${TG_HANDLE}.`,

 bankPayDomain: (
 priceNGN,
 plan,
 ) => `请支付 ${priceNGN} NGN 并点击“付款”按钮。交易确认后，您将立即收到通知，并且您的 ${plan} 将无缝激活。

此致，
${CHAT_BOT_NAME}`,
}

const vpsBC = ['🔙 返回', '取消']

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
 hourly: '按小时',
 monthly: '每月',
 quaterly: '季度',
 annually: '每年',
}

const vpsPlanMenu = ['按小时', '每月', '季度', '每年']
const vpsConfigurationMenu = ['基本', '标准', '高级', '企业']
const vpsCpanelOptional = ['WHM', 'Plesk', '❌ 跳过控制面板']

const vpsPlanOf = {
 按小时: 'hourly',
 每月: 'monthly',
 季度: 'quaterly',
 每年: 'annually',
}

// Voice Service translations
const vs = {
  callDisconnectedAutoRouted: (usdBal, lowBalTrigger, lowBalResume) => `🚫 <b>通话已断开</b>（自动路由）\n\n钱包：<b>$${usdBal}</b> — 低于 $${lowBalTrigger} 阈值。\n💰 请至少充值 $${lowBalResume} 以恢复通话。`,
  callDisconnectedWalletInsufficient: (rate, connFee) => `🚫 <b>通话已断开</b> — 钱包余额不足（需要 $${rate}/分钟 + $${connFee} 接通费）。\n请通过 👛 钱包 充值。`,
  callDisconnectedWalletExhausted: '🚫 <b>通话已断开</b> — 钱包余额已用尽。\n请通过 👛 钱包 充值。',
  outboundCallFailedRouting: (fromPhone, toPhone) => `🚫 <b>呼出失败</b>\n📞 ${fromPhone} → ${toPhone}\n原因：呼叫路由失败。请重试。`,
  planMinutesExhausted: (phoneNumber, used, limit) => `⚠️ <b>套餐分钟数已用尽</b>\n\n📞 ${phoneNumber}\n本周期已用：<b>${used}/${limit}</b> 分钟。\n\n超额部分现在将从您的钱包计费。请充值或升级套餐。`,
  callTypeCharge: (callType, minutesBilled, rate, chargedStr, region, discountLine) => `💰 <b>${callType}</b>：${minutesBilled} 分钟 × $${rate} = <b>${chargedStr}</b>（${region}）${discountLine}`,
  overageCharge: (newOverageMin, rate, chargedStr, region, discountLine) => `💰 <b>超额</b>：${newOverageMin} 分钟 × $${rate} = <b>${chargedStr}</b>（${region}）${discountLine}`,
  transferEnded: (forwardPhone, duration, planLine) => `📞 <b>转接已结束</b>\n${forwardPhone} — ${duration}\n${planLine}`,
  transferFailed: (forwardPhone, reason) => `❌ <b>转接失败</b>\n📞 ${forwardPhone} — ${reason}`,
  orphanedNumberAlert: (to, from) => `⚠️ <b>Orphaned Number Alert</b>\n\n📞 <code>${to}</code> received inbound call from <code>${from}</code>\n\n❌ No owner found in DB — call rejected.\nThis number may need to be released or re-assigned.`,
 incomingCallBlockedWalletEmpty: '⚠️ <b>来电已拦截</b> — 您的钱包为空。请充值以接听电话。',
  overageActive: (chargedStr, region, currency) => `💰 <b>超额计费中</b> — 套餐分钟数已用尽。${chargedStr}（${region}）从 ${currency} 钱包扣除。`,
  callEndedPlanWalletExhausted: (elapsedMin) => `🚫 <b>通话已结束</b> — 套餐分钟数 + 钱包余额均已用尽。\n⏱️ 约 ${elapsedMin} 分钟。请充值钱包或升级套餐。`,
  incomingCall: (fromPhone, toPhone) => `📞 <b>来电</b>\n${fromPhone} → ${toPhone}\n正在呼叫您的 SIP 设备...`,
  outboundCallingLocked: '🚫 <b>呼出功能已锁定</b>\n\n',
 testCallsExpired: '⚠️ 您的测试通话已过期。请订阅套餐以继续。',
  outboundCallBlocked: (fromPhone, toPhone, status) => `🚫 <b>呼出已拦截</b>\n📞 ${fromPhone} → ${toPhone}\n原因：号码状态为 ${status}。请续费或联系支持。`,
  sipCallBlocked: (sipRate, connFee, region, usdBal, ngnBal) => `🚫 <b>SIP 通话已拦截</b> — 钱包余额不足（需要 $${sipRate}/分钟 + $${connFee} 接通费 ${region}）。\n余额：$${usdBal} / NGN：₦${ngnBal}\n呼出通话从钱包计费。请通过 👛 钱包 充值。`,
  freeSipTestCall: (fromPhone, toPhone, remaining, maxDuration) => `📞 <b>免费 SIP 测试通话</b>\n来自：${fromPhone}\n呼叫至：${toPhone}\n🆓 免费测试通话（剩余 ${remaining} 次，最长 ${maxDuration} 秒）`,
  sipOutboundCall: (fromPhone, toPhone, walletLine) => `📞 <b>SIP 呼出通话</b>\n来自：${fromPhone}\n呼叫至：${toPhone}\n${walletLine}`,
  outboundCallFailedTempUnavailable: (fromPhone, toPhone) => `🚫 <b>呼出失败</b>\n📞 ${fromPhone} → ${toPhone}\n原因：呼出功能暂时不可用。请稍后重试。`,
  sipOutboundCallWithRate: (fromPhone, toPhone, sipRate, connFeeNote, estMinutes) => `📞 <b>SIP 呼出通话</b>\n来自：${fromPhone}\n呼叫至：${toPhone}\n费率：$${sipRate}/分钟${connFeeNote}（约可用 ${estMinutes} 分钟）`,
  lowBalanceForward: (usdBal, estMinutes) => `⚠️ <b>余额偏低</b> — $${usdBal}（约 ${estMinutes} 分钟转接）。请通过 👛 钱包 充值 <b>$25</b>。`,
  forwardingBlocked: (usdBal, fwdRate) => `🚫 <b>转接已拦截</b> — 钱包 $${usdBal}（需要 $${fwdRate}/分钟）。\n请通过 👛 钱包 充值 <b>$25</b>。`,
  ivrForwardBlocked: (fromPhone, forwardPhone, usdBal, ivrFwdRate, region) => `🚫 <b>IVR 转接已拦截 — 钱包为空</b>\n\n📞 ${fromPhone}\n📲 转接至：${forwardPhone}\n\n钱包 $${usdBal}（需要 $${ivrFwdRate}/分钟 ${region}）。\n请通过 👛 钱包 充值。`,
  lowBalanceIvrForward: (usdBal, estMinutes) => `⚠️ <b>余额偏低</b> — $${usdBal}（约 ${estMinutes} 分钟 IVR 转接）。请通过 👛 钱包 充值。`,
  sipCallEndedAutoRouted: (fromPhone, toPhone, duration, minutesBilled, rate) => `📞 <b>SIP 通话已结束</b>（自动路由）\n\n来自：${fromPhone}\n呼叫至：${toPhone}\n⏱️ ${duration}\n💰 已计费 ${minutesBilled} 分钟 × $${rate}`,
  ivrCallEndedWalletExhausted: (usdBal, ivrCallRate) => `🚫 <b>IVR 通话已结束</b> — 钱包余额已用尽（$${usdBal}）。\nIVR 通话费用为 $${ivrCallRate}/分钟。请通过 👛 钱包 充值。`,
  callNotConnected: '📞 <b>通话未接通</b> — 对方忙线或未接听。\n\n🎁 您的免费试用呼叫仍然可用！随时可以再试。',
  transferTimeout: (toPhone) => `⏱ <b>转接超时</b>\n📞 ${toPhone} 在 30 秒内未接听`,
  transferConnected: (targetNumber, ivrNumber) => `✅ <b>转接已接通</b>\n📞 ${targetNumber} 已连接至 ${ivrNumber}`,
}

const vp = {
 of: vpsOptionsOf,
 back: '🔙 返回',
 skip: '❌ 跳过',
 cancel: '❌ 取消',

 // VPS/RDP choice (Step 1)
 vpsLinuxBtn: '🐧 Linux VPS (SSH)',
 vpsRdpBtn: '🪟 Windows RDP',
 askVpsOrRdp: `🖥️ 您需要什么类型的服务器？

📬 <b>端口25开放</b> — 直接从服务器发送邮件

<strong>🐧 Linux VPS</strong> — SSH访问 · 网站托管 · 开发 · 自动化
<strong>🪟 Windows RDP</strong> — 远程桌面 · Windows 应用和工具`,

 askCountryForUser: `🌍 选择最接近用户的区域：`,
 chooseValidCountry: '请从列表中选择一个国家：',
 askRegionForUser: country => `📍 选择 ${country} 内的数据中心（价格可能因位置而异）。`,
 chooseValidRegion: '请从列表中选择有效的地区：',
 askZoneForUser: region => `📍 选择 ${region} 内的可用区。`,

 chooseValidZone: '请选择列表中的有效区域：',
 confirmZone: (region, zone) => `✅ 您选择了${region}（${zone}）。您要继续选择此项吗？`,
 failedFetchingData: '获取数据时出错，请稍后再试。',
 confirmBtn: `✅ 确认选择`,

 askVpsDiskType: list => `💾 <b>选择存储类型</b>

${list?.some(item => item.pricier) ? 'NVMe 价格更高，但采用更新的 CPU 和快得多的磁盘 — SSD 是经济之选：' : '两种选项价格相同 — 选择对您更重要的：'}

${list?.map(item => `${item.description}`).join('\n\n')}

👇 点击您的选择：`,

 chooseValidDiskType: '请选择有效的磁盘类型',

 askPlanType: plans => `💳 选择账单周期：

${plans
 .map(
 item =>
 `<strong>• ${item.type === 'Hourly' ? '⏳' : '📅'} ${({ Hourly: '按小时', Monthly: '按月' })[item.type] || item.type.replace(/(\d+) Months/, '$1 个月')} –</strong> $${item.originalPrice} ${
 item.discount === 0 ? '（无折扣）' : `（含 ${item.discount}% 折扣）`
 }`,
 )
 .join('\n')}`,
 planTypeMenu: vpsOptionsOf(vpsPlanMenu),
 // Billing (Monthly only)
 hourlyBillingMessage: '',

 // 配置
 askVpsConfig: (list, extras = {}) => {
  const { walletUsd, cheapestName, socialProof } = extras
  const plans = list.map(config => {
   const star = config.name === cheapestName ? '🌟 ' : ''
   const line = `<strong>• ${star}${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB ${config.specs.diskType} — $${config.monthlyPrice}/月`
   return config.isRDP ? `${line}\n   ⚡ <i>Premium AMD · NVMe SSD</i>` : line
  }).join('\n')

  let walletLine = ''
  if (typeof walletUsd === 'number') {
   const sorted = [...list].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice))
   const affordable = sorted.filter(p => Number(p.monthlyPrice) <= walletUsd)
   if (affordable.length) {
    const top = affordable[affordable.length - 1]
    walletLine = `\n\n💰 <b>您的钱包:</b> $${walletUsd.toFixed(2)} — 您最高可购 <b>${top.name}</b> ✅`
   } else {
    const cheapest = sorted[0]
    const topUp = (Number(cheapest.monthlyPrice) - walletUsd).toFixed(2)
    walletLine = `\n\n💰 <b>您的钱包:</b> $${walletUsd.toFixed(2)} — 再充值 <b>$${topUp}</b> 即可解锁 <b>${cheapest.name}</b>`
   }
  }

  const proofLine = socialProof ? `\n\n${socialProof}` : ''
  const header = (Array.isArray(list) && list.some(c => c.isRDP))
   ? '🪟 选择 Windows RDP 方案 <i>(Windows Server + 远程桌面，含许可证)</i>：'
   : '⚙️ 选择 Linux VPS 方案：'
  return `${header}\n\n${plans}${proofLine}${walletLine}`
 },

 validVpsConfig: '请选择一个有效的VPS配置：',

 configMenu: vpsOptionsOf(vpsConfigurationMenu),

 askForCoupon: '🎟️ 有优惠券代码吗？输入它可享受额外折扣（如适用），或者跳过此步骤。任何计费周期折扣已包含在内。',
 couponInvalid: `❌ 无效：代码已过期、不适用或输入错误。请重试。`,
 couponValid: amt => `✅ 有效：应用的折扣：-$${amt}。`,
 skipCouponwarning: `⚠️ 跳过意味着您以后无法再应用折扣。`,
 confirmSkip: '✅ 确认跳过',
 goBackToCoupon: '❌ 返回并应用优惠券',

 askVpsOS: () => `💻 选择 Linux 发行版（默认：Ubuntu）：

<strong>💡 推荐：</strong>
<strong>• Ubuntu</strong> — 通用 & 开发
<strong>• AlmaLinux / Rocky</strong> — 企业级稳定
<strong>• Debian</strong> — 轻量 & 可靠`,
 chooseValidOS: `请选择可用列表中的有效操作系统：`,
 skipOSBtn: '❌ 跳过操作系统选择',
 skipOSwarning: '⚠️ 您的VPS将没有操作系统启动。您需要通过SSH或恢复模式手动安装一个。',

 askVpsCpanel: `🛠️ 选择控制面板以更轻松地管理服务器（可选.

<strong>• ⚙️ WHM –</strong> 推荐用于托管多个网站
<strong>• ⚙️ Plesk –</strong> 适用于管理个人网站和应用程序
<strong>• ❌ 跳过 –</strong> 不安装控制面板`,

 cpanelMenu: vpsOptionsOf(vpsCpanelOptional),
 noControlPanel: vpsCpanelOptional[2],
 skipPanelMessage: '⚠️ 将不会安装控制面板。您可以稍后手动安装。',
 validCpanel: '请选择一个有效的控制面板或跳过。',

 askCpanelOtions: (name, list) => `⚙️ 选择 ${
 name == 'whm' ? 'WHM' : 'Plesk Web Host Edition'
 } 许可证，或选择免费试用（有效期 ${name == 'whm' ? '15' : '7'} 天）。
 
💰 ${name == 'whm' ? 'WHM' : 'Plesk'} 许可证定价：

${list.map(item => `${name == 'whm' ? `<strong>• ${item.name} - </strong>` : ''}${item.label}`).join('\n')}`,

 trialCpanelMessage: panel =>
 `✅ ${panel.name == 'whm' ? 'WHM' : 'Plesk'} 免费试用（${panel.duration} 天）已激活。您可以随时联系支持进行升级。`,

 vpsWaitingTime: '⚙️ 正在获取详细信息... 这只需要一点时间。',
 failedCostRetrieval: '获取成本信息失败... 请稍后再试。',

 errorPurchasingVPS: (plan, isRDP) => `在设置您的 ${plan} ${isRDP ? 'RDP' : 'VPS'} 计划时出现问题。

请点击 💬 获取支持。
了解更多 ${TG_HANDLE}。`,

 generateBillSummary: vpsDetails => {
 const planPrice = vpsDetails.couponApplied ? vpsDetails.planNewPrice : vpsDetails.plantotalPrice
 const total = vpsDetails.totalPrice || Number(planPrice).toFixed(2)
 const isRDP = vpsDetails.isRDP
 const months = Number(vpsDetails.durationMonths) || 1
 const osLabel = isRDP
 ? (vpsDetails.os?.id ? `🪟 ${vpsDetails.os.name}${vpsDetails.os.fastDeploy ? ' ⚡ 约 3 分钟就绪' : ''}` : '🪟 Windows Server (RDP)')
 : (vpsDetails.os?.name || 'Ubuntu')
 const planEmoji = isRDP ? '🪟' : '🐧'
 const planKind = isRDP ? (/RDP/i.test(String(vpsDetails.config.name)) ? '' : ' <i>(Windows RDP)</i>') : ' <i>(Linux VPS)</i>'
 
 let summary = `<strong>📋 订单摘要：</strong>

<strong>${planEmoji} ${vpsDetails.config.name}</strong>${planKind} — ${vpsDetails.config.specs.vCPU} vCPU · ${vpsDetails.config.specs.RAM}GB RAM · ${vpsDetails.config.specs.disk}GB ${vpsDetails.config.specs.diskType}
<strong>📍 区域：</strong> ${vpsDetails.regionName || vpsDetails.country}
<strong>💻 OS：</strong> ${osLabel}`

 if (isRDP) {
 summary += `\n<strong>🪟 Windows 许可证：</strong> 已包含`
 }
 if (isRDP || months > 1) {
 summary += `\n<strong>📅 时长：</strong> ${months === 1 ? '1 个月' : `${months} 个月（预付）`}`
 }
 if (vpsDetails.couponApplied && vpsDetails.couponDiscount > 0) {
 summary += `\n<strong>🎟️ 优惠券：</strong> -$${Number(vpsDetails.couponDiscount).toFixed(2)} USD`
 }
 summary += `\n<strong>🔄 自动续费：</strong> ✅ 启用`
 summary += `\n\n<strong>💰 总计：$${total} USD${months > 1 ? ` / ${months} 个月` : '/月'}</strong>`
 summary += `\n\n<strong>✅ 是否继续下单？</strong>`
 return summary
 },
 no: '❌ 取消订单',
 yes: '✅ 确认订单',
 askPaymentMethod: '选择支付方式：',

 showDepositCryptoInfoVps: (priceUsd, priceCrypto, tickerView, address, vpsDetails) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您的 ${vpsDetails?.isRDP ? 'Windows RDP' : 'VPS'} 将在支付确认后自动激活（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 extraMoney: '您的按小时计费计划的剩余金额已存入钱包。',
 paymentRecieved: (isRDP = false) => `✅ 支付成功！

您的 ${isRDP ? 'RDP' : 'VPS'} 正在设置中 — 稍等片刻。
您的登录凭据将直接显示在此对话中。`,
 paymentFailed: `❌ 支付失败。请检查您的支付方式或重试。`,

 lowWalletBalance: vpsName => `
您的 VPS 计划实例 ${vpsName} 已因余额不足而停止。

请充值您的钱包以继续使用 VPS 计划。`,

 vpsBoughtSuccess: (vpsDetails, response, credentials) => {
 const isRDP = response.isRDP || vpsDetails.isRDP || response.osType === 'Windows'
 const connectInfo = isRDP
 ? `<strong>🔗 连接:</strong> 🖥 远程桌面 (mstsc) → <code>${response.host}:3389</code>`
 : `<strong>🔗 连接:</strong> 💻 <code>ssh ${credentials.username}@${response.host}</code>`

 const readinessNote = isRDP
 ? `\n⏱ <b>请预留 5–10 分钟</b>用于 Windows 首次启动。⚠️ <b>请立即保存您的密码</b> — 之后无法找回（如丢失，请在 RDP 管理中使用"重置密码"）。`
 : `\n⏱ <b>请预留 2–5 分钟</b>用于首次启动设置。⚠️ <b>请安全保存您的凭据。</b>`

 return `<strong>🎉 ${isRDP ? 'RDP' : 'VPS'} [${response.label}] 已激活！</strong>

<strong>🔑 登录凭据:</strong>
 <strong>• IP:</strong> <code>${response.host}</code>
 <strong>• 操作系统:</strong> ${vpsDetails.os ? vpsDetails.os.name : (isRDP ? 'Windows Server' : 'Linux')}
 <strong>• 用户名:</strong> <code>${credentials.username}</code>
 <strong>• 密码:</strong> <tg-spoiler><code>${credentials.password}</code></tg-spoiler>（点击查看并复制）

${connectInfo}
${readinessNote}

${CHAT_BOT_NAME}`
 },
 vpsHourlyPlanRenewed: (vpsName, price) => `
您的 VPS 计划实例 ${vpsName} 已成功续订。
${price}$ 已从您的钱包中扣除。`,

 vpsMonthlyPlanRenewed: (vpsName, planPrice) =>
 `✅ 您的 VPS <b>${vpsName}</b> 已自动续订 1 个月。\n💰 $${planPrice} 已从钱包中扣除。`,

 vpsExpiredNoAutoRenew: (vpsName) =>
 `⚠️ 您的 VPS <b>${vpsName}</b> 已过期。自动续订已禁用。\n请手动续订以继续使用服务。`,

 bankPayVPS: (
 priceNGN,
 plan,
 ) => `请点击“进行支付”以汇款 ${priceNGN} NGN。交易确认后，您将及时收到通知，您的 ${plan} VPS 计划将顺利激活。

此致,
${CHAT_BOT_NAME}`,

 askAutoRenewal: `🔄 启用自动续订，以确保服务不中断？ 

🛑 续订前您将收到提醒，您可以随时禁用。`,
 enable: '✅ 启用',
 skipAutoRenewalWarming: expiresAt =>
 `⚠️ 您的 VPS 将于 ${new Date(expiresAt).toLocaleDateString('zh-CN').replace(/\//g, '-')} ${new Date(
 expiresAt,
 ).toLocaleTimeString('zh-CN', {
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
 })} 到期，服务可能会中断。`,

 generateSSHKeyBtn: '✅ 生成新密钥',
 linkSSHKeyBtn: '🗂️ 关联现有密钥',
 skipSSHKeyBtn: '❌ 跳过（使用密码登录）',
 noExistingSSHMessage: '🔑 未检测到 SSH 密钥。您想生成新的 SSH 密钥以确保安全访问，还是使用密码登录（安全性较低）？',
 existingSSHMessage: '🔑 您已有 SSH 密钥。请选择一个选项：',
 confirmSkipSSHMsg: `⚠️ 警告：密码登录的安全性较低，容易受到攻击。
🔹 我们强烈建议使用 SSH 密钥。您确定要继续吗？`,
 confirmSkipSSHBtn: '✅ 仍然继续',
 setUpSSHBtn: '🔄 设置 SSH 密钥',
 sshLinkingSkipped: '❌ SSH 密钥关联已跳过，未进行任何更改。',
 newSSHKeyGeneratedMsg: name => `✅ SSH 密钥（${name}）已创建。
⚠️ 请妥善保存此密钥 – 以后可以再次检索。`,
 selectSSHKey: '🗂️ 选择一个现有的 SSH 密钥以关联到您的 VPS：',
 uploadNewKeyBtn: '➕ 上传新密钥',
 cancelLinkingSSHKey: `❌ SSH 密钥关联已取消，未进行任何更改。`,
 selectValidSShKey: '请选择列表中的有效 SSH 密钥。',
 sshKeySavedForVPS: name => `✅ SSH 密钥（${name}）将关联到新的 VPS。`,
 askToUploadSSHKey: `📤 请上传您的 SSH 公钥（.pub 文件）或在下方粘贴密钥。`,
 failedGeneratingSSHKey: '无法生成新的 SSH 密钥。请重试或使用其他方法。',
 newSSHKeyUploadedMsg: name => `✅ SSH 密钥（${name}）已成功上传并将关联到 VPS。`,
 fileTypePub: '文件类型应为 .pub',

 vpsList: list => `<strong>🖥️ 您的服务器：</strong>

${list
 .map(vps => `<strong>• ${vps.isRDP || vps.osType === 'Windows' ? '🪟' : '🐧'} ${vps.name}</strong> <i>(${vps.isRDP || vps.osType === 'Windows' ? 'Windows RDP' : 'Linux VPS'})</i> — ${String(vps.status || '').toUpperCase() === 'RUNNING' ? '🟢' : '🔴'} ${vps.status}`)
 .join('\n')}
`,
 noVPSfound: '您还没有服务器。请在下方创建 🐧 Linux VPS 或 🪟 Windows RDP。',
 selectCorrectOption: '请选择列表中的一个选项',
 selectedVpsData: data => {
 const isRDP = !!(data.isRDP || data.osType === 'Windows')
 const port = isRDP ? 3389 : 22
 const loginUser = data.defaultUser || (isRDP ? 'Administrator' : 'root')
 const running = String(data.status || '').toUpperCase() === 'RUNNING'
 const months = Number(data.durationMonths) || 1
 const panelLine = isRDP ? '' : `\n<strong>• 控制面板：</strong> ${data.cPanelPlanDetails && data.cPanelPlanDetails.type ? data.cPanelPlanDetails.type : '无'}`
 const billingLine = isRDP ? `\n<strong>• 计费：</strong> ${months === 1 ? '按月' : `${months} 个月（预付）`} · 含 Windows 许可证` : ''
 return `<strong>${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'}：</strong> ${data.name}

<strong>• 计划：</strong> ${data.planDetails.name}
<strong>• vCPUs：</strong> ${data.planDetails.specs.vCPU} | RAM: ${data.planDetails.specs.RAM} GB | 硬盘：${data.planDetails.specs.disk} GB (${data.diskTypeDetails.type})
<strong>• 操作系统：</strong> ${data.osDetails.name}${panelLine}${billingLine}
<strong>• 状态：</strong> ${running ? '🟢' : '🔴'} ${data.status}
<strong>• 自动续费：</strong> ${data.autoRenewable ? '已启用' : '已禁用'}

<b>🔌 如何连接</b>
<strong>• IP 地址：</strong> <code>${data.host}</code>
<strong>• ${isRDP ? 'RDP 端口' : 'SSH 端口'}：</strong> <code>${port}</code>
<strong>• 用户名：</strong> <code>${loginUser}</code>${isRDP ? `
<strong>• 远程桌面：</strong> <code>${data.host}:${port}</code>` : `
<strong>• 命令：</strong> <code>ssh ${loginUser}@${data.host} -p ${port}</code>`}`
 },
 stopVpsBtn: '⏹️ 停止',
 startVpsBtn: '▶️ 启动',
 restartVpsBtn: '🔄 重启',
 deleteVpsBtn: '🗑️ 删除',
 subscriptionBtn: '🔄 订阅',
 VpsLinkedKeysBtn: '🔑 SSH 密钥',
 resetPasswordBtn: '🔑 重置密码',
 revealPasswordBtn: '🔐 显示密码',
 revealPasswordChecking: name => `🔐 正在查找 <strong>${name}</strong> 的当前密码...

⏱️ 只需几秒 — 我们还会为您测试登录。`,

 revealPasswordSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const v = opts.verification || null
   let statusLine = ''
   if (v && v.status === 'ok') {
     statusLine = '\n✅ <b>我们刚刚用此密码登录成功 — 它有效。</b>'
   } else if (v && v.status === 'password_wrong') {
     statusLine = '\n⚠️ <b>此密码被您的服务器拒绝。</b> 点击 <b>🔑 重置密码</b> 设置新密码 — 即时生效，您的数据将保留。'
   } else if (v && v.status === 'password_auth_disabled') {
     statusLine = '\n⚠️ <b>您的服务器当前拒绝密码登录</b>（仅限 SSH 密钥）。点击 <b>🔑 重置密码</b> — 这将重新启用密码登录并为您提供新密码。'
   } else if (v && v.status === 'unreachable') {
     statusLine = '\n💤 我们无法连接到您的服务器来测试此密码。如果无效，请点击 <b>🔑 重置密码</b>。'
   }
   const recoveredLine = opts.recovered
     ? '\n\n♻️ <i>从您服务器的原始设置中恢复 — 已保存，下次将即时加载。</i>'
     : ''
   return `🔐 <strong>当前 VPS 密码</strong>

🖥️ <strong>${isRDP ? 'RDP' : '服务器'}：</strong> ${name}
🌐 <strong>IP：</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'RDP 端口' : 'SSH 端口'}：</strong> <code>${port}</code>
👤 <strong>用户名：</strong> <code>${username}</code>
🔑 <strong>密码：</strong> <code>${password}</code>

📋 <strong>连接：</strong> <code>${isRDP ? `${ip}:${port}` : `ssh ${username}@${ip} -p ${port}`}</code>${statusLine}${recoveredLine}

💡 点击密码即可复制。请妥善保管 — 任何拥有它的人都能完全访问。`
 },

 revealPasswordNotStored: (name, reason) => `🔐 <strong>密码不可用</strong>

我们无法获取 <strong>${name}</strong> 的当前密码。

📋 <i>原因：${reason || '此服务器没有已存储的密码'}</i>

✅ <strong>该怎么做：</strong> 点击 <b>🔑 重置密码</b>。它会在约一分钟内在您<b>正在运行</b>的服务器上设置一个全新密码 — <b>您的文件和数据会被保留</b> — 然后我们在此显示新密码并确认其有效。`,

 revealPasswordFailed: name => `❌ <strong>无法查询密码</strong>

获取 <strong>${name}</strong> 的密码时出错。

请稍后重试，或点击 <b>🔑 重置密码</b> 设置一个新密码。`,
 reinstallWindowsBtn: '🔄 重装 Windows',
 confirmChangeBtn: '✅ 确认',

 confirmStopVpstext: name => `⚠️ 您确定要停止 VPS <strong>${name}</strong> 吗？`,
 vpsBeingStopped: name => `⚙️ 请稍等，您的 VPS (${name}) 正在停止中`,
 vpsStopped: name => `✅ VPS (${name}) 已停止。`,
 failedStoppingVPS: name => `❌ 停止 VPS (${name}) 失败。

请稍后再试。`,
 vpsBeingStarted: name => `⚙️ 请稍等，您的 VPS (${name}) 正在启动中`,
 vpsStarted: name => `✅ VPS (${name}) 现已运行。`,
 failedStartedVPS: name => `❌ 启动 VPS (${name}) 失败。

请稍后再试。`,
 vpsBeingRestarted: name => `⚙️ 请稍等，您的 VPS (${name}) 正在重启中`,
 vpsRestarted: name => `✅ VPS (${name}) 已成功重启。`,
 failedRestartingVPS: name => `❌ 重启 VPS (${name}) 失败。

请稍后再试。`,
 confirmDeleteVpstext: name => `⚠️ 警告：删除此 VPS ${name} 是永久性的，所有数据将丢失。
 • 未使用的订阅时间不予退款。
 • 自动续订将被取消，不会产生额外费用。
 
您确定要继续吗？`,

 confirmResetPasswordText: (name, impact = {}) => {
   const mode = impact.mode || 'in-place'
   const head = `🔑 <strong>重置${impact.isRDP ? ' RDP' : ' VPS'} 密码</strong>

🖥️ <strong>服务器：</strong> ${name}
`
   const nudge = `
💡 <i>只是忘记了密码？点击 ❌ 取消 → <b>🔐 显示密码</b> — 无需重置。</i>

您确定要重置 <strong>${name}</strong> 的密码吗？`

   if (mode === 'reinstall') return head + `
⚠️ <strong>这会清空服务器。</strong> 此提供商无法在运行中的机器上更改密码，因此会重装操作系统 — 所有文件、网站、数据库和设置将被永久删除。

• 您将获得一个全新安装和一个全新密码
• 您当前的密码将停止工作
• 💾 如果需要数据，请先创建备份/快照
` + nudge

   if (mode === 'rebuild-emailed') return head + `
⚠️ <strong>这会清空服务器</strong>，并且新密码由<b>提供商通过邮件发送</b> — 我们无法在此向您显示。

• 操作系统将被重建：所有文件和数据将被永久删除
• 提供商会将新密码发送到托管账户邮箱（约5分钟）
• 如需立即访问，请使用您的 SSH 密钥
` + nudge

   return head + `
✅ <strong>您的数据将保留。</strong> 什么都不会被删除 — 您的文件、网站、数据库和设置将保持原样。我们只更改<b>正在运行</b>的服务器上的登录密码（不重装、不重启）。

• 生成一个全新密码并在此直接显示
• 我们应用它，然后用它登录以确认其有效
• 您当前的密码将停止工作
• ⏱️ 大约需要 20-60 秒
` + nudge
 },

 confirmReinstallWindowsText: name => `🔄 <strong>重装 Windows</strong>

⚠️ <strong>严重警告：</strong>
• 这将删除您 RDP 上的所有数据
• 所有文件、程序和设置将被删除
• 将创建全新的 Windows 安装
• 将生成新凭据
• 您的旧密码将不再有效

💾 <strong>建议：</strong> 继续之前请创建备份/快照。

您确定要在 <strong>${name}</strong> 上重装 Windows 吗？`,

 passwordResetInProgress: (name, impact = {}) => `🔄 正在重置 <strong>${name}</strong> 的密码...

⏱️ 通常需要 20-60 秒。请稍候。${
   (impact.mode || 'in-place') === 'in-place'
     ? `

🔒 <i>新密码将应用于您正在运行的服务器 — 您的数据保持完好。</i>`
     : ''
 }`,

 passwordResetSuccess: (name, ip, username, password, opts = {}) => {
   const isRDP = !!opts.isRDP
   const port = isRDP ? 3389 : 22
   const dataPreserved = opts.dataPreserved !== false
   return `✅ <strong>密码重置成功！</strong>

🖥️ <strong>${isRDP ? 'RDP' : '服务器'}：</strong> ${name}
🌐 <strong>IP：</strong> <code>${ip}</code>
🔌 <strong>${isRDP ? 'RDP 端口' : 'SSH 端口'}：</strong> <code>${port}</code>
👤 <strong>用户名：</strong> <code>${username}</code>
🔑 <strong>新密码：</strong> <code>${password}</code>
${isRDP ? `\n📋 <strong>连接：</strong> <code>${ip}:${port}</code>` : `\n📋 <strong>连接：</strong> <code>ssh ${username}@${ip} -p ${port}</code>`}
${opts.verified ? '\n✅ 我们已用此密码登录以确认其有效。' : ''}
${dataPreserved
   ? '💾 <strong>您的数据未被改动</strong> — 密码是在正在运行的服务器上更改的。'
   : '⚠️ <strong>操作系统已被重装</strong>，因此服务器上先前的数据已丢失。'}

⚠️ <strong>您的旧密码不再有效。</strong>

🔐 以后又忘了？在您的 VPS 上点击 <b>显示密码</b> — 您可以随时查看，无需重置。

💡 点击密码即可复制。`
 },

 passwordResetEmailed: (name, ip, username, note) => `✅ <strong>密码重置已启动！</strong>

🖥️ <strong>服务器：</strong> ${name}
🌐 <strong>IP：</strong> ${ip}
👤 <strong>用户名：</strong> ${username}

📧 ${note || '提供商已将新密码发送至账户邮箱（约5分钟）。'}

🔑 <strong>如需立即访问，请使用您的 SSH 密钥。</strong>

⚠️ <i>注意：此提供商无法在此显示密码——密码由提供商通过邮件发送，或使用 SSH 密钥登录。</i>`,

 windowsReinstallEmailed: (name, ip, username, note) => `🎉 <strong>Windows 重装已开始！</strong>

🖥️ <strong>RDP：</strong> ${name}
🌐 <strong>IP：</strong> ${ip}
👤 <strong>用户名：</strong> ${username}

⏱️ 此过程需要 5-10 分钟。${note || '新的 Administrator 密码将由提供商通过邮件发送至账户。'}

⚠️ 所有先前的数据均已清除——这是全新的 Windows 安装。`,

 windowsReinstallInProgress: name => `🔄 正在 <strong>${name}</strong> 上重装 Windows...

⏱️ 此过程需要 5-10 分钟。
📧 完成后您将收到新凭据。`,

 windowsReinstallSuccess: (name, ip, username, password) => `🎉 <strong>Windows 重装成功！</strong>

🖥️ <strong>RDP：</strong> ${name}
🌐 <strong>IP：</strong> ${ip}
👤 <strong>用户名：</strong> ${username}
🔑 <strong>密码：</strong> <code>${password}</code>

⚠️ <strong>严重警告 - 立即保存此密码！</strong>
• 出于安全原因，我们以后无法检索它
• 所有以前的数据已被删除
• 这是全新的 Windows 安装
• 如果丢失此密码，您必须重置它（使用"重置密码"按钮）

💡 点击密码即可复制。
🚀 您的 RDP 已准备好使用这些新凭据！`,

 passwordResetFailed: name => `❌ <strong>密码重置失败</strong>

重置 <strong>${name}</strong> 的密码失败。

请几分钟后重试，如果问题仍然存在，请联系支持。`,

 windowsReinstallFailed: name => `❌ <strong>Windows 重装失败</strong>

在 <strong>${name}</strong> 上重装 Windows 失败。

请几分钟后重试，如果问题仍然存在，请联系支持。`,

 rdpNotSupported: `⚠️ 此功能仅适用于 Windows RDP 实例。

您的 VPS 运行 Linux。请改用 SSH 密钥进行访问管理。`,

 // ── DigitalOcean Windows RDP：时长 + 版本选择，原地重装 ──
 rdpDurationBtn: c => `${c.period} 个月 — $${c.price}${c.discountPct ? ` (省 ${c.discountPct}%)` : ''}`,
 askRdpDuration: (config, cycles) => `📅 <strong>您想预付多长时间？</strong>

<strong>${config.name}</strong> — ${config.specs.vCPU} vCPU · ${config.specs.RAM}GB RAM · ${config.specs.disk}GB NVMe
${cycles.map(c => {
  const per = Number(c.period) || 1
  const base = (Number(config.monthlyPrice) || 0) * per
  const save = per > 1 && base > 0 && Number(c.price) < base ? Math.round((1 - Number(c.price) / base) * 100) : 0
  return `• ${per === 1 ? '1 个月' : `${per} 个月`} — <b>$${c.price}</b>${save > 0 ? ` <i>(省 ${save}%)</i>` : ''}`
}).join('\n')}

更长的周期一次性付费并享受套餐折扣；到期时自动续费将按同一周期再次扣费。`,
 rdpEditionBtn: o => `🪟 ${o.name}${o.fast_deploy ? ` ⚡ 约 ${o.eta_minutes || 3} 分钟` : ' ⏳ 约 45 分钟'}`,
 askRdpEdition: options => `🪟 <strong>选择您的 Windows 版本</strong>

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ 约 ${o.eta_minutes || 3} 分钟就绪（您所在区域已有预构建镜像）` : '⏳ 完整安装，约 45 分钟'}`).join('\n')}

所有版本均为 Windows Server Standard（桌面体验），已启用 RDP 并使用 Administrator 账户。`,
 askReinstallEdition: (name, options) => `🔄 <strong>在 ${name} 上重装 Windows</strong>

请选择要安装的版本。您的 IP 地址保持不变。

${options.map(o => `• <b>${o.name}</b> — ${o.fast_deploy ? `⚡ 约 ${o.eta_minutes || 3} 分钟` : '⏳ 约 45 分钟'}`).join('\n')}`,
 confirmReinstallWindowsRdpText: (name, osName, etaMin) => `🔄 <strong>在 ${name} 上重装 ${osName}</strong>

⚠️ <strong>警告 — 将清空磁盘：</strong>
• 服务器上的所有文件、程序和设置都会被删除
• 将从我们的预构建镜像全新安装 ${osName}（约 ${etaMin} 分钟）
• 将生成新的 Administrator 密码 — 旧密码失效
• ✅ 您的 IP 地址和已付费周期保持不变

是否继续？`,
 windowsReinstallStarted: (name, ip, username, password, osName, etaMin) => `🔄 <strong>正在 ${name} 上重装 ${osName}</strong>

🌐 <strong>IP：</strong> <code>${ip || '不变'}</code>
👤 <strong>用户名：</strong> ${username}
🔑 <strong>新密码：</strong> <code>${password}</code>

⏱️ Windows 正在安装 — 约 <b>${etaMin} 分钟</b> 后即可使用这些凭据连接。
💡 点击密码即可复制。您随时可以通过 🔐 显示密码 再次查看。`,
 rdpActionReason: reason => `\n\n<i>原因：${reason}</i>`,
 vpsBeingDeleted: name => `⚙️ 请稍等，您的 VPS (${name}) 正在删除中`,
 vpsDeleted: name => `✅ VPS (${name}) 已永久删除。`,
 failedDeletingVPS: name => `❌ 删除 VPS (${name}) 失败。

请稍后再试。`,

 upgradeVpsBtn: '⬆️ 升级',
 doPlanOptionBtn: o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} ${o.name} · $${o.monthly_price_usd}/月`,
 doPlanOptionsMsg: (cur, opts, days, hidden) => `🔄 <b>更改套餐</b> — 原地调整：您的数据、IP 和设置都会保留。

<b>当前：</b> ${cur.name} (${cur.vcpus || '?'} vCPU · ${cur.ram_gb || '?'} GB 内存 · ${cur.disk_gb} GB ${cur.storage_type}) — $${cur.monthly_price_usd}/月
<b>本期剩余天数：</b> ${Math.floor(days)}

${opts.map(o => `${o.direction === 'upgrade' ? '⬆️' : o.direction === 'downgrade' ? '⬇️' : '🔄'} <b>${o.name}</b> (${o.vcpus} vCPU/${o.ram_gb} GB/${o.disk_gb} GB ${o.storage_type}) $${o.monthly_price_usd}/月${o.charge_now_usd > 0 ? ` · 现在支付 $${o.charge_now_usd.toFixed(2)}` : ''}`).join('\n')}

💡 升级：只需支付剩余天数的差价。降级：免费并立即生效，本期不退款。新价格从下次续费开始。${hidden ? `\n⚠️ 已隐藏 ${hidden} 个更小的套餐：磁盘永远无法缩小。` : ''}`,
 doPlanNoOptions: '⚠️ 目前没有其他套餐可应用于此服务器（磁盘无法缩小，且部分套餐在该地区可能缺货）。',
 doPlanUnavailable: code => ({
 expired: '⚠️ 此服务器的本期已结束。请先续费，然后再更改套餐。',
 term_ending_soon: '⚠️ 此服务器本期剩余不足 1 小时。请先续费，然后再更改套餐。',
 not_active: '⚠️ 此服务器未处于活动状态，暂时无法更改套餐。',
 plan_change_in_progress: '⏳ 此服务器已有套餐更改正在进行。完成后您会收到消息。',
 not_supported: '⚠️ 此服务器不支持更改套餐。',
 }[code] || '⚠️ 此服务器暂时无法更改套餐。请稍后重试或联系客服。'),
 doPlanKeepDiskBtn: '💾 保留当前磁盘（可逆）',
 doPlanGrowDiskBtn: gb => `📀 将磁盘扩大到 ${gb} GB（永久）`,
 doPlanDiskAsk: (o, cur) => `💾 <b>磁盘大小</b>

${o.name} 包含 ${o.disk_gb} GB 磁盘。您的服务器当前为 ${cur.disk_gb} GB。

• <b>保留当前磁盘</b>：只更改 CPU 和内存。以后可以换回更小的套餐。
• <b>将磁盘扩大到 ${o.disk_gb} GB</b>：存储更多，但<b>永久</b>生效。服务器将永远无法再换到磁盘更小的套餐。`,
 doPlanSummary: (name, cur, o, grow, bal, end) => `<strong>📜 套餐更改摘要</strong>

<strong>• 服务器：</strong> ${name}
<strong>• 从：</strong> ${cur.name} ($${cur.monthly_price_usd}/月)
<strong>• 到：</strong> ${o.name} ($${o.monthly_price_usd}/月)
<strong>• 磁盘：</strong> ${grow ? `${o.disk_gb} GB（永久）` : `${cur.disk_gb} GB（不变）`}
<strong>• 现在支付：</strong> $${o.charge_now_usd.toFixed(2)}${o.direction === 'upgrade' ? '（剩余天数的差价）' : '（本期不退款）'}
<strong>• 下次续费：</strong> $${o.renewal_price_usd}${end ? `（${new Date(end).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}）` : ''}
<strong>• 钱包余额：</strong> $${Number(bal).toFixed(2)}

⏱ 服务器将重启，离线约 ${grow ? '5-30' : '2-5'} 分钟。数据、IP 和设置都会保留。`,
 doPlanLowBalance: (bal, price) => `⚠️ 您的钱包余额（$${Number(bal).toFixed(2)}）低于此次升级所需的 $${Number(price).toFixed(2)}。请充值后重试。`,
 doPlanStarted: (name, o, charged) => `⏳ <b>正在将 ${name} 更改为 ${o.name}…</b>${charged > 0 ? `\n💳 已从您的钱包扣除 $${Number(charged).toFixed(2)}。` : ''}

服务器正在重启，将离线几分钟。完成后我们会通知您。`,
 doPlanDone: (name, c, r) => `✅ <b>${name} 现已使用 ${c.to.name}</b>

磁盘：${r && r.disk_gb ? r.disk_gb : '?'} GB · 下次续费：$${c.to.renewal_price_usd}。服务器已恢复在线。`,
 doPlanFailed: (name, refund) => `❌ <b>${name} 的套餐更改未完成。</b>您的服务器保持当前套餐${refund > 0 ? `，$${Number(refund).toFixed(2)} 已退回您的钱包` : ''}。请稍后重试或联系客服。`,
 upgradeVpsPlanBtn: '⬆️ VPS 计划',
 upgradeVpsDiskBtn: '📀 磁盘类型',
 upgradeVpsDiskTypeBtn: '💾 升级磁盘类型',
 upgradeVPS: '选择升级类型',
 upgradeOptionVPSBtn: to => {
 return `🔼 升级到 ${to}`
 },
 upgradeVpsPlanMsg: options => `⚙️ 选择一个新计划以扩展您的 VPS 资源。
💡 升级增加 vCPUs、RAM 和存储，但无法撤销。

📌 可用的升级：
${options
 .map(
 planDetails =>
 `<strong>• ${planDetails.from} ➡ ${planDetails.to} –</strong> $${planDetails.monthlyPrice}/月 ($${planDetails.hourlyPrice}/小时)`,
 )
 .join('\n')}

💰 账单通知：您的当前计划将因未使用的天数而获得信用，并且新费率将在账单周期的其余部分应用（按比例调整）。`,

 alreadyEnterprisePlan: '⚠️ 您已在最高可用计划（企业版）上。无法进行进一步的升级。',

 alreadyHighestDisk: vpsData => `⚠️ 您已在最高可用磁盘（${vpsData.diskTypeDetails.type}）上。无法进行进一步的升级。`,
 newVpsDiskBtn: type => `升级到 ${type}`,
 upgradeVpsDiskMsg: upgrades => `💾 升级您的存储类型以获得更好的性能。
⚠️ 磁盘升级是永久性的，不能降级。

📌 可用选项：
${upgrades.map(val => `<strong>• ${val.from} ➡ ${val.to} –</strong> +$${val.price}/${val.duration}`).join('\n')}

💰 账单通知：如果在账单周期中途应用升级，将按比例调整当前账单周期未使用的部分。`,
 upgradePlanSummary: (newData, vpsDetails, lowBal) => `<strong>📜 订单摘要：</strong>

<strong>• VPS ID：</strong> ${vpsDetails.name}
<strong>• 旧计划：</strong> ${newData.upgradeOption.from}
<strong>• 新计划：</strong> ${newData.upgradeOption.to}
<strong>• 计费周期：</strong> ${newData.billingCycle}
<strong>• 新计费费率：</strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/小时' : '（已应用按比例调整）'
 }
<strong>• 生效日期：</strong> 立即生效
${
 lowBal
 ? `
💡 注意：您的总费用中包含 $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD 预存款。在扣除首小时费用后，剩余的预存款将存入您的钱包。
`
 : ''
}
<strong>• 总价格：</strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ 是否继续下单？</strong>`,

 upgradeDiskSummary: (newData, vpsDetails, lowBal) => `<strong>📜 订单摘要：</strong>

<strong>• VPS ID：</strong> ${vpsDetails.name}
<strong>• 旧磁盘类型：</strong> ${newData.upgradeOption.from}
<strong>• 新磁盘类型：</strong> ${newData.upgradeOption.to}
<strong>• 计费周期：</strong> ${newData.billingCycle}
<strong>• 新计费费率：</strong> $${newData.totalPrice} USD${
 newData.billingCycle === 'Hourly' ? '/小时' : '（已应用按比例调整）'
 }
${
 lowBal
 ? `
注意：您的总额包含 $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD 的押金。扣除第一个小时费率后，剩余押金将计入您的钱包。
`
 : ''
}
<strong>• 总价格：</strong> $${lowBal ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE : newData.totalPrice} USD

<strong>✅ 是否继续下单？</strong>`,

 vpsSubscriptionData: (vpsData, planExpireDate, panelExpireDate) => {
 const isRDP = !!(vpsData.isRDP || vpsData.osType === 'Windows')
 const months = Number(vpsData.durationMonths) || 1
 const panel = isRDP ? '' : `\n<strong>• 控制面板 ${vpsData?.cPanelPlanDetails ? vpsData.cPanelPlanDetails.type : '：未选择'} </strong> ${
 vpsData?.cPanelPlanDetails
 ? `${vpsData?.cPanelPlanDetails.status === 'active' ? '- 到期日期：' : '- 已过期：'}${panelExpireDate}`
 : ''
 } `
 return `<strong>🗂️ 您的有效订阅：</strong>

<strong>• ${isRDP ? '🪟 Windows RDP' : '🐧 Linux VPS'} ${vpsData.name} </strong> – ${isRDP ? `${months === 1 ? '按月' : `预付 ${months} 个月`} · ` : ''}到期日期：${planExpireDate} (自动续订：${
 vpsData.autoRenewable ? '已启用' : '已禁用'
 })${panel}`
 },

 manageVpsSubBtn: '📅 管理订阅',
 manageVpsPanelBtn: '🛠️ 管理控制面板订阅',

 vpsSubDetails: (data, date) => `<strong>📅 ${data.isRDP || data.osType === 'Windows' ? '🪟 Windows RDP' : '🐧 Linux VPS'} 订阅详情：</strong>

<strong>• 服务器：</strong> ${data.name}
<strong>• 计划：</strong> ${data.planDetails.name}${data.isRDP || data.osType === 'Windows' ? `\n<strong>• 计费周期：</strong> ${(Number(data.durationMonths) || 1) === 1 ? '按月' : `${data.durationMonths} 个月（预付）`}` : ''}
<strong>• 当前到期日期：</strong> ${date}
<strong>• 自动续订：</strong> ${data.autoRenewable ? '启用' : '禁用'}`,

 vpsCPanelDetails: (data, date) => `<strong>📅 控制面板订阅详情：</strong>

<strong>• 关联的 VPS ID：</strong> ${data.name}
<strong>• 控制面板类型：</strong> ${data.cPanelPlanDetails.type} (${data.cPanelPlanDetails.name})
<strong>• 当前到期日期：</strong> ${date}
<strong>• 自动续订：</strong> ${data.autoRenewable ? '已启用' : '已禁用'}
`,

 vpsEnableRenewalBtn: '🔄 启用自动续订',
 vpsDisableRenewalBtn: '❌ 禁用自动续订',
 vpsPlanRenewBtn: '📅 立即续订',
 unlinkVpsPanelBtn: '❌ 取消与VPS的链接',
 bankPayVPSUpgradePlan: (priceNGN, vpsDetails) =>
 `请点击下方的“付款”按钮支付 ${priceNGN} NGN。一旦交易确认，您将立即收到通知，您的新 ${vpsDetails.upgradeOption.to} VPS 方案将无缝激活。`,

 bankPayVPSUpgradeDisk: (priceNGN, vpsDetails) =>
 `请通过点击“付款”来支付 ${priceNGN} NGN。交易确认后，您将立即收到通知，您的VPS计划将以新磁盘类型 ${vpsDetails.upgradeOption.toType} 配置无缝激活。`,

 showDepositCryptoInfoVpsUpgrade: (priceUsd, priceCrypto, tickerView, address) =>
 `💰 <b>支付金额: $${Number(priceUsd).toFixed(2)} USD</b>

请发送 <b>${priceCrypto} ${tickerView}</b> 至:

<code>${address}</code>

您升级的 VPS 计划将在支付确认后自动激活（通常只需几分钟）。

此致,
${CHAT_BOT_NAME}`,

 linkVpsSSHKeyBtn: '➕ 关联新密钥',
 unlinkSSHKeyBtn: '❌ 取消关联密钥',
 downloadSSHKeyBtn: '⬇️ 下载密钥',

 noLinkedKey: name => `⚠️ 当前没有SSH密钥与该VPS [${name}] 关联。

请将SSH密钥关联到您的账户，以启用安全访问。`,

 linkedKeyList: (list, name) => `🗂️ 与VPS ${name} 关联的SSH密钥：

${list.map(val => `<strong>• ${val}</strong>`).join('\n')}`,

 unlinkSSHKeyList: name => `🗂️ 选择一个SSH密钥从VPS [${name}] 中移除：`,

 confirmUnlinkKey: data => `⚠️ 确定要将 [${data.keyForUnlink}] 从 VPS [${data.name}] 解绑吗？`,
 confirmUnlinkBtn: '✅ 确认解绑',
 keyUnlinkedMsg: data => `✅ SSH 密钥 [${data.keyForUnlink}] 已成功从 VPS [${data.name}] 解绑。`,
 failedUnlinkingKey: data => `❌ SSH 密钥解绑失败（VPS: ${data.name}）。 

请稍后重试。`,

 userSSHKeyList: name => `🗂️ 选择一个 SSH 密钥以链接到 VPS [${name}]：`,
 noUserKeyList: `🔑 未检测到 SSH 密钥。是否要上传新的 SSH 密钥？`,
 linkKeyToVpsSuccess: (key, name) => `✅ SSH 密钥 [${key}] 成功链接到 VPS [${name}]。`,
 failedLinkingSSHkeyToVps: (key, name) => `❌ SSH 密钥 [${key}] 绑定到 VPS (${name}) 失败。 

请稍后重试。`,

 selectSSHKeyToDownload: '🗂️ 请选择要下载的 SSH 密钥：',

 disabledAutoRenewal: (data, expiryDate) => `⚠️ 自动续订已禁用。您的 VPS 将于 ${expiryDate} 过期，除非手动续订。
✅ 自动续订已成功禁用。`,

 enabledAutoRenewal: (data, expiryDate) => `✅ 自动续订已启用。您的 VPS 将于 ${expiryDate} 自动续订。`,

 renewVpsPlanConfirmMsg: (data, vpsDetails, expiryDate, lowBal) => `<strong>📜 发票摘要</strong>

<strong>• VPS ID：</strong> ${vpsDetails.name}
<strong>• 计划：</strong> ${vpsDetails.planDetails.name}
<strong>• 计费周期：</strong> ${vpsDetails.billingCycleDetails.type}
<strong>• 当前到期日期：</strong> ${expiryDate}
<strong>• 应付金额：</strong> ${data.totalPrice} USD

${
 lowBal
 ? `注意：您的总金额中包含 $${VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE} USD 的押金。第一小时费用扣除后，剩余押金将退还到您的钱包。`
 : ''
}

<strong>• 总价：</strong> $${
 lowBal
 ? VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE
 : data.totalPrice
 } USD

<strong>💳 是否继续续订 VPS？</strong>`,

 payNowBtn: '✅ 立即支付',

 vpsChangePaymentRecieved: `✅ 付款成功！您的 VPS 正在配置中，详细信息将很快提供。`,

 bankPayVPSRenewPlan: priceNGN =>
 `请点击下方的“支付”按钮支付 ${priceNGN} NGN。一旦交易确认，您将立即收到通知，您的 VPS 计划将被激活并续订。`,

 renewVpsPanelConfirmMsg: (data, panelDetails, date) => `<strong>💳 是否继续续订控制面板？</strong>

<strong>📜 发票摘要</strong>
 <strong>• 关联的 VPS ID：</strong> ${data.name}
 <strong>• 控制面板：</strong> ${panelDetails.type}
 <strong>• 续订周期：</strong> ${panelDetails.durationValue}${' '}个月
 <strong>• 当前到期日期：</strong> ${date}
 <strong>• 应付金额：</strong> ${data.totalPrice} USD`,

 bankPayVPSRenewCpanel: (priceNGN, vpsDetails) =>
 `请点击下方的“支付”按钮支付 ${priceNGN} NGN。一旦交易确认，您将立即收到通知，您的 VPS 计划将被激活，并且 ${vpsDetails.cPanelPlanDetails.type} 控制面板将被续订。`,

 vpsUnlinkCpanelWarning: vpsDetails =>
 `⚠️ 警告：取消关联将从 VPS ${vpsDetails.name} 中移除 ${vpsDetails.cPanel} 许可证，您将无法使用其功能。是否继续？`,

 unlinkCpanelConfirmed: data => `✅ 控制面板 ${data.cPanel} 已成功从 VPS ${data.name} 取消关联。`,

 errorUpgradingVPS: vpsName => `升级 VPS 计划 ${vpsName} 时出现错误。

请点击 💬 获取支持。
了解更多信息 ${TG_HANDLE}。`,

 vpsUpgradePlanTypeSuccess: vpsDetails => `
✅ VPS ${vpsDetails.name} 已成功升级至 ${vpsDetails.upgradeOption.to}。您的新资源现已可用。`,

 vpsUpgradeDiskTypeSuccess: vpsDetails =>
 `✅ VPS ${vpsDetails.name} 的磁盘已成功升级至 ${vpsDetails.upgradeOption.to}。您的新磁盘类型现已激活。`,

 vpsRenewPlanSuccess: (vpsDetails, expiryDate) =>
 `✅ VPS订阅 ${vpsDetails.name} 已成功续订！

• 新到期日期：${expiryDate}
`,
 vpsRenewCPanelSuccess: (vpsDetails, expiryDate) =>
 `✅ ${vpsDetails.name} 的控制面板订阅已成功续订！

• 新到期日期：${expiryDate}
`,
}

const zh = {
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
// Close ZH gaps that previously fell back to English mid-flow:
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
  dnsProxiedChoiceLabelDnsOnly: '⚪ 仅 DNS（推荐）',
  dnsProxiedChoiceLabelProxied: '🟠 通过 Cloudflare 代理',
  dnsProxiedChoiceInvalid: '请点击其中一个按钮：⚪ 仅 DNS（推荐）或 🟠 通过 Cloudflare 代理。',
  dnsProxiedChoiceAsk: (recordType, value) =>
    `⚙️ <b>此 ${recordType} 记录的 Cloudflare 模式</b>\n\n` +
    `目标：<code>${value}</code>\n\n` +
    `⚪  <b>仅 DNS</b>（推荐）\n` +
    `<i>查询直接返回您的源站 IP。适合指向您自己的 VPS、邮件服务器，或需要直接访问目标时使用。</i>\n\n` +
    `🟠  <b>通过 Cloudflare 代理</b>\n` +
    `<i>Cloudflare 代理您的源站——免费 SSL、CDN 缓存、DDoS 防护，且您的源站 IP 保持隐藏。适合公开网站。</i>`,
})
Object.assign(zh, {
  dnsProxiedChoiceKeyboard: {
    parse_mode: 'HTML',
    reply_markup: { keyboard: [[t.dnsProxiedChoiceLabelDnsOnly], [t.dnsProxiedChoiceLabelProxied], _bc], resize_keyboard: true },
    disable_web_page_preview: true,
  },
})
Object.assign(vp, {
  vpsSshBlockedHelp: (name, host, username) =>
    `🟠 <strong>您的 VPS 在线 — 但 SSH 被阻止</strong>\n\n` +
    `🖥️ <strong>服务器：</strong> ${name}\n` +
    `🌐 <strong>IP：</strong> <code>${host}</code>\n\n` +
    `我们已连接到您的服务器（它正在运行），但<b>服务器内部的防火墙关闭了 22 端口（SSH）</b>。因此登录和密码重置无法工作——密码无法通过已关闭的端口。\n\n` +
    `✅ <strong>如何重新打开（2 分钟）：</strong>\n` +
    `1. 打开您的服务商为此服务器提供的<b>恢复 / 网页控制台</b>（无需 SSH）。\n` +
    `2. 以 <code>${username}</code> 身份登录。\n` +
    `3. 运行：<code>ufw allow OpenSSH</code>（或 <code>ufw allow 22/tcp</code>）\n` +
    `4. 然后运行：<code>ufw reload</code>\n\n` +
    `22 端口打开后，返回并点击 <b>🔑 重置密码</b> — 我们将在运行中的服务器上设置新密码并确认其可用，同时保留您的数据。\n\n` +
    `💬 遇到问题？点击 <b>💬 支持</b>，我们将为您重新打开。`,
})

module.exports = {
 zh,
 setCustomNsPrompt: (domain, nsRecords) => {
 let msg = `<b>✏️ 为 ${domain} 设置自定义名称服务器</b>\n\n`
 if (nsRecords && nsRecords.length) {
 msg += `<b>当前:</b>\n`
 nsRecords.forEach((ns, i) => {
 msg += ` NS${i + 1}: <code>${ns.recordContent || '—'}</code>\n`
 })
 msg += '\n'
 }
 msg += `输入新的名称服务器（每行一个，最少2个，最多4个）:\n\n<i>示例:\nns1.example.com\nns2.example.com</i>\n\n<i>⚠️ Cloudflare：请<b>原样</b>复制控制台显示的名称（例如 <code>leanna.ns.cloudflare.com</code>），<b>不要</b>额外添加 <code>ns1./ns2.</code> 前缀。</i>`
 return msg
 },
 Hosting: '托管',
}
