// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cloud IVR Config — Texts, keyboards, state actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 2026-08-03: HTML-escape helper for user-supplied strings ──
// Telegram's parse_mode:'HTML' rejects messages containing raw `<`/`>`/`&`
// with unrecognized tags, and mismatched tags corrupt the render. Every
// user-controlled string (IVR labels, greetings, messages, sub-menu names,
// audio filenames) that gets interpolated into an HTML-parse-mode message
// MUST go through this. See security audit SEC-004 (2026-08-03).
function escapeHtml(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}


// Defaults match current public pricing. If env is missing, we MUST fall back
// to the live prices (not cheap dev defaults) so a misconfigured deploy never
// silently provisions plans at legacy/dev rates. See post-mortem on the $30
// Business / $15 Pro grandfathered numbers (2026-04-30 audit).
const PHONE_STARTER_PRICE = parseFloat(process.env.PHONE_STARTER_PRICE || '50')
const PHONE_PRO_PRICE = parseFloat(process.env.PHONE_PRO_PRICE || '75')
const PHONE_BUSINESS_PRICE = parseFloat(process.env.PHONE_BUSINESS_PRICE || '120')
if (!process.env.PHONE_STARTER_PRICE || !process.env.PHONE_PRO_PRICE || !process.env.PHONE_BUSINESS_PRICE) {
  // Loud warning so missing env is visible in logs and supervisor health checks.
  console.warn(`[phone-config] ⚠️ One or more PHONE_*_PRICE env vars missing; using current public defaults: starter=$${PHONE_STARTER_PRICE} pro=$${PHONE_PRO_PRICE} business=$${PHONE_BUSINESS_PRICE}`)
}
const SIP_DOMAIN = process.env.SIP_DOMAIN || 'sip.speechcue.com'
const CALL_PAGE_URL = process.env.CALL_PAGE_URL || 'https://speechcue.com/call'

// ── Configurable plan minutes & SMS from .env ──
// IMPORTANT: env keys are UN-prefixed (STARTER_MINUTES / PRO_MINUTES / BUSINESS_MINUTES …).
// Included minutes cover INCOMING calls answered via SIP/browser only — call
// forwarding to an external number is billed separately from the wallet.
// Defaults mirror the live public quotas so a missing env never advertises stale numbers.
const STARTER_MINUTES = parseInt(process.env.STARTER_MINUTES || '100', 10)
const STARTER_SMS = parseInt(process.env.STARTER_SMS || '50', 10)
const PRO_MINUTES = parseInt(process.env.PRO_MINUTES || '400', 10)
const PRO_SMS = parseInt(process.env.PRO_SMS || '200', 10)
const BUSINESS_MINUTES = process.env.BUSINESS_MINUTES === 'Unlimited' ? 'Unlimited' : parseInt(process.env.BUSINESS_MINUTES || '600', 10)
const BUSINESS_SMS = parseInt(process.env.BUSINESS_SMS || '300', 10)

// All users always connect to sip.speechcue.com regardless of provider
// Telnyx: DNS A record resolves to Telnyx SIP IP (192.76.120.10)
// Twilio: Dual credentials created on both Telnyx + Twilio so sip.speechcue.com works
function getSipDomainForNumber() {
  return SIP_DOMAIN
}

// ── Sub-Number Pricing ──
const SUB_NUMBER_BASE_PRICE = 25  // Minimum price for a sub-number
const SUB_NUMBER_MARKUP = 0.5     // 50% markup on Twilio number cost
const SUB_NUMBER_LIMITS = { starter: 3, pro: 15, business: 30 }

function getSubNumberLimit(planKey) {
  return SUB_NUMBER_LIMITS[planKey] || 0
}

// ── Plan availability (admin toggle via .env) ──
const PHONE_STARTER_ON = (process.env.PHONE_STARTER_ON || 'true').toLowerCase() === 'true'
const PHONE_PRO_ON = (process.env.PHONE_PRO_ON || 'true').toLowerCase() === 'true'
const PHONE_BUSINESS_ON = (process.env.PHONE_BUSINESS_ON || 'true').toLowerCase() === 'true'

const planAvailability = {
  starter: PHONE_STARTER_ON,
  pro: PHONE_PRO_ON,
  business: PHONE_BUSINESS_ON,
}

const isPlanAvailable = (planKey) => planAvailability[planKey] !== false

const comingSoonFeatures = {
  starter: [
    `${STARTER_MINUTES} inbound minutes/mo + ${STARTER_SMS} SMS`,
    'Call forwarding to any number',
    'SMS forwarded to Telegram',
    'Dedicated local phone number',
    `➕ Add up to ${SUB_NUMBER_LIMITS.starter} extra numbers`,
  ],
  pro: [
    `${PRO_MINUTES} inbound minutes/mo + ${PRO_SMS} SMS`,
    'All Starter features',
    'Voicemail with custom greetings',
    'SIP credentials for softphones',
    'SMS to Telegram & Email',
    'Webhook integrations',
    'Quick IVR Call & Bulk IVR Campaign',
    'OTP Collection via IVR',
    `➕ Add up to ${SUB_NUMBER_LIMITS.pro} extra numbers`,
  ],
  business: [
    `${BUSINESS_MINUTES === 'Unlimited' ? 'Unlimited' : BUSINESS_MINUTES} inbound minutes + ${BUSINESS_SMS} SMS`,
    'All Pro features included',
    'IVR Auto-Attendant with AI voice',
    'Call Recording & Analytics',
    'Quick IVR Presets & Recent Calls',
    'IVR Redial Button',
    'Call Scheduling',
    'Custom OTP Messages & Goodbye',
    'Consistent TTS Voice/Speed',
    'Priority Support',
    `➕ Add up to ${SUB_NUMBER_LIMITS.business} extra numbers`,
  ],
}

const comingSoonText = (planKey) => {
  const plan = plans[planKey] || {}
  const features = comingSoonFeatures[planKey] || []
  const icon = planKey === 'starter' ? '💡' : planKey === 'pro' ? '⭐' : '👑'
  return `${icon} <b>${plan.name || planKey} Plan — Coming Soon!</b>

🚀 We're loading this plan with powerful features:

${features.map(f => `  ✦ ${f}`).join('\n')}

📢 Stay tuned — this plan will be available very soon.
Use /start to check back later!`
}

// ── Overage rates (pay-per-use above plan limits, from .env) ──
const OVERAGE_RATE_SMS = parseFloat(process.env.OVERAGE_RATE_SMS || '0.02')
const OVERAGE_RATE_MIN = parseFloat(process.env.OVERAGE_RATE_MIN || '0.15')
const CALL_FORWARDING_RATE_MIN = parseFloat(process.env.CALL_FORWARDING_RATE_MIN || '0.50')
const CALL_CONNECTION_FEE = parseFloat(process.env.CALL_CONNECTION_FEE || '0.03')

// ── Premium/high-cost prefixes that are blocked for forwarding ──
// These prefixes have extremely high termination rates ($1+/min) on Telnyx
const BLOCKED_FORWARDING_PREFIXES = [
  // Premium rate service numbers
  '900', '901', '906', '908', '909',   // US/International premium
  // Satellite / VSAT
  '870', '871', '872', '873', '874',   // Inmarsat
  '875', '876', '877',                  // Maritime mobile satellite
  '881', '882', '883', '888',           // Iridium / Globalstar / Intl Networks / disaster-relief satellite
  '449',                                // UK premium-rate (+44 9xx, up to ~$1.05/min)
  // Premium Portuguese prefixes (up to $3.62/min on Telnyx)
  '35176', '351760', '351761',
  // Cuban mobile (very high rates)
  '535',
  // Premium Spanish prefixes
  '3480', '3490',
  // Tunisian premium
  '21680', '21681', '21682',
  // Russian premium
  '7809', '7803',
  // African premium/satellite
  '88216',
  // Shared cost / premium across countries
  '878', '879',
]

function isBlockedPrefix(phoneNumber) {
  const clean = phoneNumber.replace(/[^0-9]/g, '')
  return BLOCKED_FORWARDING_PREFIXES.some(prefix => clean.startsWith(prefix))
}

// ── Button labels ──
const btn = {
  cloudPhone: '📞☁️ Cloud IVR — Speechcue',
  buyPhoneNumber: '🛒 Choose a Plan',
  myNumbers: '📋 My Plans',
  sipSettings: '📖 SIP Setup Guide',
  usageBilling: '📊 Usage & Billing',

  // Number types
  localNumber: '📍 Local Number',
  tollFreeNumber: '🆓 Toll-Free Number',
  mobileNumber: '📱 Mobile Number',
  nationalNumber: '🌐 National Number',

  // Plans
  starterPlan: PHONE_STARTER_ON ? `💡 Starter — $${PHONE_STARTER_PRICE}/mo` : `💡 Starter — Coming Soon 🔜`,
  proPlan: PHONE_PRO_ON ? `⭐ Pro — $${PHONE_PRO_PRICE}/mo` : `⭐ Pro — Coming Soon 🔜`,
  businessPlan: PHONE_BUSINESS_ON ? `👑 Business — $${PHONE_BUSINESS_PRICE}/mo` : `👑 Business — Coming Soon 🔜`,

  // Management
  addNumber: '➕ Add Number to Plan',
  callForwarding: '📞 Call Forwarding',
  smsSettings: '📩 SMS Settings',
  smsInbox: '📨 SMS Inbox',
  voicemail: '🎙️ Voicemail',
  sipCredentials: '🔑 SIP Credentials',
  callRecording: '🔴 Call Recording',
  ivrAutoAttendant: '🤖 IVR / Auto-attendant',
  callSmsLogs: '📊 Call & SMS Logs',
  testMyNumber: '📞 Test My Number',
  testOutboundSip: '📤 Test Outbound SIP',
  renewChangePlan: '🔄 Renew / Change Plan',
  releaseNumber: '🗑️ Delete Number',

  // Forwarding modes
  alwaysForward: '📞 Always Forward',
  forwardBusy: '📵 Forward When Busy',
  forwardNoAnswer: '⏰ Forward If No Answer',
  disableForwarding: '🚫 Disable Forwarding',
  holdMusicOn: '🎵 Hold Music: ON',
  holdMusicOff: '🎵 Hold Music: OFF',

  // SMS
  smsToTelegram: '📲 SMS to Telegram',
  smsToEmail: '📧 SMS to Email',
  smsWebhook: '🔗 Webhook URL',

  // Voicemail
  enableVoicemail: '✅ Enable Voicemail',
  disableVoicemail: '🚫 Disable Voicemail',
  vmGreeting: '🔊 Greeting',
  vmCustomGreeting: '🎤 Custom Greeting (Audio)',
  vmDefaultGreeting: '🔄 Default Greeting',
  vmToTelegram: '📲 Send to Telegram',
  vmToEmail: '📧 Send to Email',
  vmRingTime: '⏰ Ring Time',

  // SIP
  revealPassword: '👁️ Reveal Password',
  resetPassword: '🔄 Reset Password',
  softphoneGuide: '📖 SIP Setup Guide',

  // Renew
  renewNow: '🔄 Renew Now',
  changePlan: '📦 Change Plan',
  upgradeToPro: '⬆️ Upgrade to Pro',
  upgradeToBusiness: '⬆️ Upgrade to Business',
  autoRenew: '🔁 Auto-Renew',

  // Misc
  showMore: '🔄 Show More Numbers',
  searchByArea: '🔍 Search by Area Code',
  moreCountries: '🌍 More Countries',
  applyCoupon: '🎟️ Apply Coupon',
  proceedPayment: '✅ Proceed to Payment',
  buyAnother: '🛒 Buy Another Number',
  confirm: '✅ Confirm',
  yesRelease: '⚠️ Yes, Permanently Delete',
  noKeep: '↩️ No, Keep It',
  yesReset: 'Yes, Reset',

  // IVR
  enableIvr: '✅ Enable IVR',
  disableIvr: '🚫 Disable IVR',
  ivrGreeting: '🎤 Set Greeting',
  ivrAddOption: '➕ Add Menu Option',
  ivrRemoveOption: '➖ Remove Option',
  ivrViewOptions: '📋 View Menu Options',
  ivrAnalytics: '📊 IVR Analytics',
  ivrEditSubMenu: '🔧 Edit Sub-Menu',
  ivrUseTemplate: '📋 Start from Template',
  ivrSaveTemplate: '💾 Save as Template',

  // Recording
  enableRecording: '✅ Enable Recording',
  disableRecording: '🚫 Disable Recording',

  // SMS Inbox
  inboxNewerPage: '◀️ Newer',
  inboxOlderPage: '▶️ Older',
  inboxRefresh: '🔄 Refresh',

  // Quick IVR Call (single number)
  ivrOutboundCall: '📢 Quick IVR Call',
  ivrOutboundCallTrial: '📢 Quick IVR Call — 1 Free',
  ivrOutboundBack: '↩️ Back',

  // Bulk IVR Campaign (multiple numbers)
  bulkCallCampaign: '📞 Bulk IVR Campaign',
  audioLibrary: '🎵 Audio Library',

  // Test SIP
  testSipFree: '🆓 Try SIP Call Free',

  // How It Works
  howItWorks: '❓ How It Works',

  back: 'Back',
  cancel: 'Cancel',
}

// ── Countries with flag (compliance-free only — no additional registration needed) ──
const countries = [
  { code: 'US', name: '🇺🇸 United States', provider: 'telnyx' },
  { code: 'CA', name: '🇨🇦 Canada', provider: 'telnyx' },
]

// Twilio countries (verified via live API query — instant activation, some need address)
const twilioCountries = [
  { code: 'GB', name: '🇬🇧 United Kingdom', provider: 'twilio', types: ['mobile'] },
  { code: 'IE', name: '🇮🇪 Ireland', provider: 'twilio', types: ['local'] },
  { code: 'IL', name: '🇮🇱 Israel', provider: 'twilio', types: ['local', 'mobile'] },
  { code: 'AU', name: '🇦🇺 Australia', provider: 'twilio', types: ['toll_free', 'mobile'] },
  { code: 'NZ', name: '🇳🇿 New Zealand', provider: 'twilio', types: ['local', 'toll_free'] },
  { code: 'HK', name: '🇭🇰 Hong Kong', provider: 'twilio', types: ['toll_free', 'mobile'] },
  { code: 'NL', name: '🇳🇱 Netherlands', provider: 'twilio', types: ['mobile'] },
  { code: 'IT', name: '🇮🇹 Italy', provider: 'twilio', types: ['toll_free'] },
]

// Combined list for user selection
const allCountries = [...countries, ...twilioCountries]

// Additional countries (shown after "More Countries" button)
const moreCountries = [
  { code: 'PR', name: '🇵🇷 Puerto Rico', provider: 'twilio', types: ['local'] },
  { code: 'TN', name: '🇹🇳 Tunisia', provider: 'twilio', types: ['local'] },
  { code: 'FI', name: '🇫🇮 Finland', provider: 'twilio', types: ['toll_free', 'mobile'] },
  { code: 'MX', name: '🇲🇽 Mexico', provider: 'twilio', types: ['toll_free'] },
  { code: 'CO', name: '🇨🇴 Colombia', provider: 'twilio', types: ['toll_free'] },
  { code: 'BG', name: '🇧🇬 Bulgaria', provider: 'twilio', types: ['toll_free'] },
  { code: 'CZ', name: '🇨🇿 Czech Republic', provider: 'twilio', types: ['local', 'toll_free'] },
  { code: 'EE', name: '🇪🇪 Estonia', provider: 'twilio', types: ['local', 'toll_free', 'mobile'] },
  { code: 'ID', name: '🇮🇩 Indonesia', provider: 'twilio', types: ['toll_free'] },
  { code: 'KE', name: '🇰🇪 Kenya', provider: 'twilio', types: ['local'] },
  { code: 'MY', name: '🇲🇾 Malaysia', provider: 'twilio', types: ['local'] },
  { code: 'PL', name: '🇵🇱 Poland', provider: 'twilio', types: ['mobile'] },
  { code: 'RO', name: '🇷🇴 Romania', provider: 'twilio', types: ['toll_free'] },
  { code: 'SK', name: '🇸🇰 Slovakia', provider: 'twilio', types: ['toll_free'] },
  { code: 'ZA', name: '🇿🇦 South Africa', provider: 'twilio', types: ['local'] },
  { code: 'TH', name: '🇹🇭 Thailand', provider: 'twilio', types: ['toll_free', 'mobile'] },
]

// US popular area codes
const usAreaCodes = [
  { code: '212', city: 'New York' },
  { code: '310', city: 'Los Angeles' },
  { code: '312', city: 'Chicago' },
  { code: '305', city: 'Miami' },
  { code: '713', city: 'Houston' },
  { code: '214', city: 'Dallas' },
  { code: '415', city: 'San Francisco' },
  { code: '206', city: 'Seattle' },
]

const countryByName = {}
;[...allCountries, ...moreCountries].forEach(c => { countryByName[c.name] = c.code })

const areaByLabel = {}
usAreaCodes.forEach(a => { areaByLabel[`${a.city} (${a.code})`] = a.code })

// ── Plans ──
const plans = {
  starter: { name: 'Starter', price: PHONE_STARTER_PRICE, minutes: STARTER_MINUTES, sms: STARTER_SMS, features: ['Call forwarding to any number', 'SMS forwarded to Telegram', `Add up to ${SUB_NUMBER_LIMITS.starter} extra numbers`] },
  pro: { name: 'Pro', price: PHONE_PRO_PRICE, minutes: PRO_MINUTES, sms: PRO_SMS, features: ['All Starter features', 'Voicemail with custom greetings', 'SIP credentials for softphones', 'SMS to Telegram & Email', 'Webhook integrations', 'Quick IVR Call', 'Bulk IVR Campaign', 'OTP Collection', `Add up to ${SUB_NUMBER_LIMITS.pro} extra numbers`] },
  business: { name: 'Business', price: PHONE_BUSINESS_PRICE, minutes: BUSINESS_MINUTES, sms: BUSINESS_SMS, features: ['All Pro features', 'Call Recording & Analytics', 'IVR Auto-Attendant', 'Quick IVR Presets & Recent Calls', 'IVR Redial Button', 'Call Scheduling', 'Custom OTP Messages', 'Consistent TTS Voice', 'Priority Support', `Add up to ${SUB_NUMBER_LIMITS.business} extra numbers`] },
}

// Language-specific plan features
const plansI18n = {
  en: {
    starter: { features: ['Call forwarding to any number', 'SMS forwarded to Telegram', `Add up to ${SUB_NUMBER_LIMITS.starter} extra numbers`] },
    pro: { features: ['All Starter features', 'Voicemail with custom greetings', 'SIP credentials for softphones', 'SMS to Telegram & Email', 'Webhook integrations', 'Quick IVR Call', 'Bulk IVR Campaign', 'OTP Collection', `Add up to ${SUB_NUMBER_LIMITS.pro} extra numbers`] },
    business: { features: ['All Pro features', 'Call Recording & Analytics', 'IVR Auto-Attendant', 'Quick IVR Presets & Recent Calls', 'IVR Redial Button', 'Call Scheduling', 'Custom OTP Messages', 'Consistent TTS Voice', 'Priority Support', `Add up to ${SUB_NUMBER_LIMITS.business} extra numbers`] },
  },
  fr: {
    starter: { features: ['Transfert d\'appels vers n\'importe quel numéro', 'SMS vers Telegram', `Jusqu'à ${SUB_NUMBER_LIMITS.starter} numéros supplémentaires`] },
    pro: { features: ['Toutes fonctions Starter', 'Messagerie vocale personnalisée', 'Identifiants SIP pour softphones', 'SMS vers Telegram & Email', 'Intégrations Webhook', 'Appel IVR rapide', 'Campagne IVR en masse', 'Collecte OTP', `Jusqu'à ${SUB_NUMBER_LIMITS.pro} numéros supplémentaires`] },
    business: { features: ['Toutes fonctions Pro', 'Enregistrement & Analytiques', 'Standard automatique IVR', 'Préréglages IVR & Appels récents', 'Bouton de rappel IVR', 'Planification d\'appels', 'Messages OTP personnalisés', 'Voix TTS cohérente', 'Support prioritaire', `Jusqu'à ${SUB_NUMBER_LIMITS.business} numéros supplémentaires`] },
  },
  zh: {
    starter: { features: ['呼叫转移至任何号码', '短信转发至Telegram', `添加最多 ${SUB_NUMBER_LIMITS.starter} 个号码`] },
    pro: { features: ['所有入门版功能', '自定义语音信箱', 'SIP 软电话凭据', '短信转Telegram和邮箱', 'Webhook集成', '快速IVR呼叫', '批量IVR活动', 'OTP收集', `添加最多 ${SUB_NUMBER_LIMITS.pro} 个号码`] },
    business: { features: ['所有专业版功能', '通话录音与分析', 'IVR自动应答', 'IVR预设与最近通话', 'IVR重拨按钮', '通话调度', '自定义OTP消息', '一致TTS语音', '优先支持', `添加最多 ${SUB_NUMBER_LIMITS.business} 个号码`] },
  },
  hi: {
    starter: { features: ['किसी भी नंबर पर कॉल फ़ॉरवर्डिंग', 'SMS से Telegram', `${SUB_NUMBER_LIMITS.starter} अतिरिक्त नंबर तक`] },
    pro: { features: ['सभी स्टार्टर सुविधाएँ', 'कस्टम वॉइसमेल', 'सॉफ्टफ़ोन के लिए SIP क्रेडेंशियल्स', 'SMS से Telegram और Email', 'Webhook इंटीग्रेशन', 'त्वरित IVR कॉल', 'बल्क IVR अभियान', 'OTP संग्रह', `${SUB_NUMBER_LIMITS.pro} अतिरिक्त नंबर तक`] },
    business: { features: ['सभी Pro सुविधाएँ', 'कॉल रिकॉर्डिंग और Analytics', 'IVR ऑटो-अटेंडेंट', 'IVR प्रीसेट और हाल की कॉलें', 'IVR रीडायल बटन', 'कॉल शेड्यूलिंग', 'कस्टम OTP संदेश', 'सुसंगत TTS आवाज़', 'प्राथमिकता समर्थन', `${SUB_NUMBER_LIMITS.business} अतिरिक्त नंबर तक`] },
  },
}

// Feature gating per plan — which features each plan unlocks
const planFeatureAccess = {
  starter: {
    callForwarding: true,
    smsToTelegram: true,
    smsToEmail: false,
    smsWebhook: false,
    voicemail: false,
    sipCredentials: false,
    callRecording: false,
    ivr: false,
    ivrOutbound: false,
    bulkCall: false,
    otpCollection: false,
    ivrRedial: false,
    otpCustomMessages: false,
  },
  pro: {
    callForwarding: true,
    smsToTelegram: true,
    smsToEmail: true,
    smsWebhook: true,
    voicemail: true,
    sipCredentials: true,
    callRecording: false,
    ivr: false,
    ivrOutbound: true,
    bulkCall: true,
    otpCollection: true,
    ivrRedial: false,
    otpCustomMessages: false,
  },
  business: {
    callForwarding: true,
    smsToTelegram: true,
    smsToEmail: true,
    smsWebhook: true,
    voicemail: true,
    sipCredentials: true,
    callRecording: true,
    ivr: true,
    ivrOutbound: true,
    bulkCall: true,
    otpCollection: true,
    ivrRedial: true,
    otpCustomMessages: true,
  },
}

const canAccessFeature = (planKey, feature) => {
  return planFeatureAccess[planKey]?.[feature] === true
}

const upgradeMessage = (feature, currentPlan, lang) => {
  const needed = (feature === 'callRecording' || feature === 'ivr' || feature === 'ivrRedial' || feature === 'otpCustomMessages') ? 'Business'
    : (feature === 'ivrOutbound' || feature === 'bulkCall' || feature === 'otpCollection') ? 'Pro'
    : 'Pro'
  // Detect "current plan already meets the required tier" — happens when the
  // gate fires for a non-plan reason (e.g. legacy `sipDisabled` flag stuck
  // from a previous lower plan). Showing "requires Pro or higher. Your
  // current plan: business" is contradictory and confusing — root-caused
  // via @wizardchop 2026-05-05 SIP report. Use a neutral "feature is locked"
  // copy in that case.
  const planRank = { starter: 1, pro: 2, business: 3 }
  const currentRank = planRank[String(currentPlan || '').toLowerCase()] || 0
  const neededRank = planRank[needed.toLowerCase()] || 0
  const planAlreadyMeets = currentRank > 0 && currentRank >= neededRank
  const featureNamesI18n = {
    en: { voicemail: 'Voicemail', sipCredentials: 'SIP Credentials', smsToEmail: 'SMS to Email', smsWebhook: 'SMS Webhook', callRecording: 'Call Recording', ivr: 'IVR / Auto-attendant', ivrOutbound: 'Quick IVR Call', bulkCall: 'Bulk IVR Campaign', otpCollection: 'OTP Collection (IVR)', ivrRedial: 'IVR Redial', otpCustomMessages: 'Custom OTP Messages' },
    fr: { voicemail: 'Messagerie Vocale', sipCredentials: 'Identifiants SIP', smsToEmail: 'SMS par Email', smsWebhook: 'Webhook SMS', callRecording: 'Enregistrement d\'Appels', ivr: 'SVI / Standard Auto', ivrOutbound: 'Appel IVR Rapide', bulkCall: 'Campagne IVR en Masse', otpCollection: 'Collecte OTP (IVR)', ivrRedial: 'Rappel IVR', otpCustomMessages: 'Messages OTP Personnalisés' },
    zh: { voicemail: '语音信箱', sipCredentials: 'SIP 凭据', smsToEmail: '短信转邮箱', smsWebhook: '短信 Webhook', callRecording: '通话录音', ivr: 'IVR / 自动应答', ivrOutbound: '快速IVR呼叫', bulkCall: '批量IVR活动', otpCollection: 'OTP 收集 (IVR)', ivrRedial: 'IVR 重拨', otpCustomMessages: '自定义OTP消息' },
    hi: { voicemail: 'वॉइसमेल', sipCredentials: 'SIP क्रेडेंशियल्स', smsToEmail: 'SMS ईमेल पर', smsWebhook: 'SMS Webhook', callRecording: 'कॉल रिकॉर्डिंग', ivr: 'IVR / ऑटो-अटेंडेंट', ivrOutbound: 'त्वरित IVR कॉल', bulkCall: 'बल्क IVR अभियान', otpCollection: 'OTP संग्रह (IVR)', ivrRedial: 'IVR रीडायल', otpCustomMessages: 'कस्टम OTP संदेश' },
  }
  const upgradeTemplates = {
    en: (fn, nd, cp) => `🔒 <b>${fn}</b> requires the <b>${nd}</b> plan or higher.\n\nYour current plan: <b>${cp || 'Starter'}</b>\n\nUpgrade via 🔄 Renew / Change Plan.`,
    fr: (fn, nd, cp) => `🔒 <b>${fn}</b> nécessite le forfait <b>${nd}</b> ou supérieur.\n\nVotre forfait actuel : <b>${cp || 'Starter'}</b>\n\nMise à niveau via 🔄 Renouveler / Changer.`,
    zh: (fn, nd, cp) => `🔒 <b>${fn}</b> 需要 <b>${nd}</b> 或更高套餐。\n\n当前套餐：<b>${cp || 'Starter'}</b>\n\n通过 🔄 续费 / 更换套餐 升级。`,
    hi: (fn, nd, cp) => `🔒 <b>${fn}</b> के लिए <b>${nd}</b> या उच्चतर प्लान आवश्यक है।\n\nआपका वर्तमान प्लान: <b>${cp || 'Starter'}</b>\n\n🔄 नवीनीकरण / प्लान बदलें से अपग्रेड करें।`,
  }
  // "Already on a qualifying plan" templates — used when the gate fires for
  // a non-plan reason (rare; e.g. admin-disabled, post-abuse lockout, or a
  // legacy data flag that hasn't been cleared yet). Tells the user to
  // contact support instead of trying to upgrade to a plan they're already
  // on (which would do nothing).
  const lockedTemplates = {
    en: (fn, cp) => `🔒 <b>${fn}</b> is temporarily unavailable on this number.\n\nYour current plan: <b>${cp}</b> (already includes this feature).\n\nPlease contact <b>@Hostbay_support</b> — we'll re-enable it for you.`,
    fr: (fn, cp) => `🔒 <b>${fn}</b> est temporairement indisponible sur ce numéro.\n\nVotre forfait actuel : <b>${cp}</b> (inclut déjà cette fonctionnalité).\n\nContactez <b>@Hostbay_support</b> — nous la réactiverons pour vous.`,
    zh: (fn, cp) => `🔒 <b>${fn}</b> 在此号码上暂时不可用。\n\n当前套餐：<b>${cp}</b>（已包含此功能）。\n\n请联系 <b>@Hostbay_support</b> — 我们将为您重新启用。`,
    hi: (fn, cp) => `🔒 इस नंबर पर <b>${fn}</b> अस्थायी रूप से अनुपलब्ध है।\n\nआपका वर्तमान प्लान: <b>${cp}</b> (इस सुविधा को पहले से शामिल करता है)।\n\nकृपया <b>@Hostbay_support</b> से संपर्क करें — हम इसे पुनः सक्षम करेंगे।`,
  }
  // SIP-credentials specific upgrade pitch — for STARTER users who tap the
  // gated menu. Reassures them that credentials already exist on Telnyx
  // (provisioned at purchase regardless of plan — see _index.js:1740-1765)
  // and "ready to use" the moment they upgrade. Stronger CTA than the
  // generic upgrade copy used for other locked features.
  const sipCredsUpgradeTemplates = {
    en: (cp) => `🔐 <b>SIP Credentials — Pro / Business only</b>\n\nGood news: your SIP credentials were <b>already provisioned</b> on our network the moment your number was purchased.\n\nYour current plan: <b>${cp || 'Starter'}</b>\nUpgrade to <b>Pro</b> or <b>Business</b> to view and use them in your softphone (Linphone, Zoiper, Bria, etc.) — no extra setup required.\n\nTap <b>🔄 Renew / Change Plan</b> to upgrade.`,
    fr: (cp) => `🔐 <b>Identifiants SIP — Pro / Business uniquement</b>\n\nBonne nouvelle : vos identifiants SIP ont été <b>déjà provisionnés</b> sur notre réseau dès l'achat de votre numéro.\n\nVotre forfait actuel : <b>${cp || 'Starter'}</b>\nPassez à <b>Pro</b> ou <b>Business</b> pour les afficher et les utiliser dans votre softphone (Linphone, Zoiper, Bria, etc.) — aucune configuration supplémentaire requise.\n\nAppuyez sur <b>🔄 Renouveler / Changer</b> pour mettre à niveau.`,
    zh: (cp) => `🔐 <b>SIP 凭据 — 仅限 Pro / Business</b>\n\n好消息：您的 SIP 凭据在购买号码时<b>已自动配置</b>在我们的网络上。\n\n当前套餐：<b>${cp || 'Starter'}</b>\n升级到 <b>Pro</b> 或 <b>Business</b> 即可在您的软电话 (Linphone, Zoiper, Bria 等) 中查看和使用 — 无需额外设置。\n\n点击 <b>🔄 续费 / 更换套餐</b> 升级。`,
    hi: (cp) => `🔐 <b>SIP क्रेडेंशियल्स — केवल Pro / Business</b>\n\nखुशखबरी: आपके नंबर खरीदते ही आपके SIP क्रेडेंशियल्स हमारे नेटवर्क पर <b>स्वतः कॉन्फ़िगर</b> हो गए थे।\n\nआपका वर्तमान प्लान: <b>${cp || 'Starter'}</b>\nअपने सॉफ्टफ़ोन (Linphone, Zoiper, Bria आदि) में देखने और उपयोग करने के लिए <b>Pro</b> या <b>Business</b> में अपग्रेड करें — कोई अतिरिक्त सेटअप आवश्यक नहीं।\n\nअपग्रेड करने के लिए <b>🔄 नवीनीकरण / प्लान बदलें</b> पर टैप करें।`,
  }
  // Pick the right template family based on context:
  //   1. Plan already meets requirement      → lockedTemplates  (locked-state copy)
  //   2. Feature is `sipCredentials`         → sipCredsUpgrade  (creds-already-exist pitch)
  //   3. Anything else                       → upgradeTemplates (generic)
  let templates
  if (planAlreadyMeets) templates = lockedTemplates
  else if (feature === 'sipCredentials') templates = sipCredsUpgradeTemplates
  else templates = upgradeTemplates
  const l = lang && templates[lang] ? lang : 'en'
  const featureNames = featureNamesI18n[l] || featureNamesI18n.en
  const featureName = featureNames[feature] || feature
  if (planAlreadyMeets) return (templates[l] || templates.en)(featureName, currentPlan)
  if (feature === 'sipCredentials') return (templates[l] || templates.en)(currentPlan)
  return (templates[l] || templates.en)(featureName, needed, currentPlan)
}

// ── One-tap plan upgrades ──
// Maps the natural next-tier upgrade. Business has no next tier (top plan).
const NEXT_PLAN = { starter: 'pro', pro: 'business' }
const PLAN_UPGRADE_CREDIT_PCT = 0.25      // (legacy) cap used as a fallback if dates are missing
const PLAN_UPGRADE_CREDIT_AGE_DAYS = 14   // (legacy) max age for the legacy flat-25% credit
const PLAN_BILLING_CYCLE_DAYS = 30        // assumed plan billing cycle for proration

// computeUpgradeQuote — pure helper used by both the Manage-screen one-tap
// button label AND the upgrade-preview confirmation screen so the two never
// disagree.
//
// FIX (Railway log issue #4 — EIN_5050 / 8541381736 abandoned upgrade because
//      they were charged the full $120 instead of $120 - prorated_unused_starter)
//
// Proration rule:
//   credit = oldPrice × (remainingDays / PLAN_BILLING_CYCLE_DAYS)
//   chargeAmount = max(0, newPrice - credit)
//
// `remainingDays` is derived from the most reliable of (in order):
//   1. num.expiryDate / num.planEndingTime
//   2. PLAN_BILLING_CYCLE_DAYS - ageDays(num.purchaseDate)
// If neither is available we fall back to the legacy 25% / 14-day rule so we
// never over-credit users who lack timestamps.
//
// Returns null if either plan key is unknown.
function computeUpgradeQuote(num, newPlanKey) {
  if (!num || !newPlanKey) return null
  const oldPlanKey = num.plan
  const oldPlanObj = plans[oldPlanKey]
  const newPlanObj = plans[newPlanKey]
  if (!oldPlanObj || !newPlanObj) return null
  const oldPrice = Number(oldPlanObj.price) || Number(num.planPrice) || 0
  const newPrice = Number(newPlanObj.price) || 0

  const purchaseDate = num.purchaseDate ? new Date(num.purchaseDate) : null
  const expiryDate = num.expiryDate
    ? new Date(num.expiryDate)
    : (num.planEndingTime ? new Date(num.planEndingTime) : null)
  const now = Date.now()

  const ageDays = (purchaseDate && !isNaN(purchaseDate.getTime()))
    ? Math.floor((now - purchaseDate.getTime()) / 86400000)
    : null

  let remainingDays = null
  if (expiryDate && !isNaN(expiryDate.getTime())) {
    remainingDays = Math.max(0, Math.ceil((expiryDate.getTime() - now) / 86400000))
  } else if (ageDays !== null) {
    remainingDays = Math.max(0, PLAN_BILLING_CYCLE_DAYS - ageDays)
  }

  // ── PRIMARY: time-based proration ──
  let credit = 0
  let prorationBasis = 'legacy_25pct'
  if (remainingDays !== null && remainingDays > 0) {
    credit = parseFloat(((oldPrice * remainingDays) / PLAN_BILLING_CYCLE_DAYS).toFixed(2))
    prorationBasis = expiryDate ? 'expiry_date' : 'purchase_date'
  } else if (ageDays !== null && ageDays <= PLAN_UPGRADE_CREDIT_AGE_DAYS) {
    // ── FALLBACK 1: legacy flat 25% within first 14 days when we couldn't
    //                compute a per-day proration (shouldn't normally happen).
    credit = parseFloat((oldPrice * PLAN_UPGRADE_CREDIT_PCT).toFixed(2))
    prorationBasis = 'legacy_25pct_fallback'
  } else if (ageDays === null) {
    // ── FALLBACK 2: no timestamps at all → give the user the benefit of the
    //                doubt and apply the legacy 25% credit once.
    credit = parseFloat((oldPrice * PLAN_UPGRADE_CREDIT_PCT).toFixed(2))
    prorationBasis = 'no_timestamps'
  }

  // Safety: credit can never exceed the old plan's price.
  if (credit > oldPrice) credit = oldPrice

  const eligibleForCredit = credit > 0
  const chargeAmount = Math.max(0, parseFloat((newPrice - credit).toFixed(2)))

  return {
    oldPlanKey, newPlanKey,
    oldPrice, newPrice,
    ageDays: ageDays === null ? Infinity : ageDays,
    remainingDays,
    eligibleForCredit,
    credit, chargeAmount,
    creditAgeLimitDays: PLAN_UPGRADE_CREDIT_AGE_DAYS,
    creditPct: PLAN_UPGRADE_CREDIT_PCT,
    billingCycleDays: PLAN_BILLING_CYCLE_DAYS,
    prorationBasis,
  }
}

// nextUpgradePlan — returns the natural next-tier plan key for one-tap
// upgrades, or null if the number is on the top tier / sub-number / current
// plan-key is unknown / next plan is not currently available.
function nextUpgradePlan(num) {
  if (!num || num.isSubNumber) return null
  const next = NEXT_PLAN[num.plan]
  if (!next) return null
  if (!isPlanAvailable(next)) return null
  return next
}


const planByButton = {}
planByButton[btn.starterPlan] = 'starter'
planByButton[btn.proPlan] = 'pro'
planByButton[btn.businessPlan] = 'business'

// ── Text messages ──
const txt = {
  hubWelcome: `📞 <b>Cloud IVR</b> <i>by Speechcue</i>

Virtual numbers in 30+ countries · Active in 2 minutes

📞 Call forwarding · 💬 SMS to Telegram · 🌐 Browser calls · 🤖 IVR · 🔗 SIP

Plans from <b>$${PHONE_STARTER_PRICE}/mo</b> (${plans.starter.minutes} inbound min + ${plans.starter.sms} SMS included — incoming calls answered via SIP/browser · call forwarding & outbound billed from wallet)

New? Tap <b>❓ How It Works</b>`,

  howItWorks: `📞 <b>Cloud IVR — How It Works</b>

Virtual phone numbers in 30+ countries, managed from Telegram.

<b>🚀 Quick Start:</b>
1. Choose Plan → Pick Country → Select Number
2. Pay from wallet → Active immediately

<b>📞 Features:</b>
• Forward calls to any phone
• SMS delivered to Telegram
• Browser calls at ${CALL_PAGE_URL}
• SIP softphone support
• Quick IVR & Bulk campaigns
• Auto-attendant menus
• Custom voicemail

<b>💰 Billing:</b>
Incoming calls answered via SIP/browser + SMS included · Call forwarding & outbound charged from wallet

<b>📋 Plans:</b>
💡 Starter $${PHONE_STARTER_PRICE}/mo — ${plans.starter.minutes} inbound min · Forwarding + SMS
⭐ Pro $${PHONE_PRO_PRICE}/mo — ${plans.pro.minutes} inbound min · + Voicemail, SIP, IVR
👑 Business $${PHONE_BUSINESS_PRICE}/mo — ${BUSINESS_MINUTES} inbound min · + Recording, Auto-attendant

🧪 Try SIP free — tap <b>🧪 Test SIP Free</b>`,

  selectCountry: '📍 Select country for your new phone number:',

  selectType: (country) => `📱 Select number type for <b>${country}</b>:

<b>📍 Local</b> — Geographic number with area code
<b>🆓 Toll-Free</b> — 800/888/877 prefix, nationwide`,

  selectArea: '🏙️ Select area or enter your preferred area code:',
  enterAreaCode: 'Enter area code (e.g. 415):',

  searching: '🔍 Searching available numbers...',

  noSearchResults: '❌ No numbers available for this criteria. Try a different area or country.',

  showNumbers: (location, numbers) => {
    let text = `📞 Available numbers in <b>${location}</b>:\n\n`
    numbers.forEach((n, i) => {
      const caps = n._capabilities || n.capabilities || {}
      const voice = caps.voice === true || caps.voice === 'True'
      const sms = caps.sms === true || caps.sms === 'True'
      const fax = caps.fax === true || caps.fax === 'True'
      let capLabel = ''
      if (voice) capLabel += '📞'
      if (sms) capLabel += '💬'
      if (fax) capLabel += '📠'
      text += `${i + 1}️⃣  ${formatPhone(n.phone_number)} ${capLabel}\n`
    })
    text += '\n📞 = Voice  💬 = SMS  📠 = Fax\nTap a number to select it.'
    return text
  },

  selectPlan: (number) => {
    let text = `✅ Selected: <b>${formatPhone(number)}</b>\n\n📋 Choose your plan:\n\n`
    if (PHONE_STARTER_ON) {
      text += `<b>💡 Starter — $${PHONE_STARTER_PRICE}/mo</b>\n📞 ${plans.starter.minutes} inbound min · 📩 ${plans.starter.sms} SMS · Forwarding · Up to ${SUB_NUMBER_LIMITS.starter} extra numbers\n<b>🎙 IVR / SIP softphone:</b> ❌ <i>not included</i>\n🛡️ <i>14-day upgrade credit — get 25% off Pro/Business if you upgrade within 14 days</i>\n\n`
    }
    if (PHONE_PRO_ON) {
      text += `<b>⭐ Pro — $${PHONE_PRO_PRICE}/mo</b>\n📞 ${plans.pro.minutes} inbound min · 📩 ${plans.pro.sms} SMS · All Starter + Voicemail · SIP · Webhooks · IVR\n<b>🎙 IVR / SIP softphone:</b> ✅ <i>Quick IVR + Bulk IVR + OTP</i>\n🛡️ <i>14-day upgrade credit — get 25% off Business if you upgrade within 14 days</i>\n\n`
    }
    if (PHONE_BUSINESS_ON) {
      text += `<b>👑 Business — $${PHONE_BUSINESS_PRICE}/mo</b>\n📞 ${plans.business.minutes} inbound min · 📩 ${plans.business.sms} SMS · All Pro + Recording · Auto-Attendant · Priority Support\n<b>🎙 IVR / SIP softphone:</b> ✅ <i>Pro + Auto-Attendant + Recording</i>\n\n`
    }
    text += `<i>📞 Included minutes cover incoming calls you answer via SIP/browser. Call forwarding to another phone & all outbound calls (incl. IVR/OTP) are billed from your wallet.</i>\n<i>⚠️ Need IVR (Quick IVR Call, Bulk IVR Campaign, OTP, Auto-Attendant)? Choose Pro or Business — Starter does <b>not</b> include IVR.</i>`
    return text
  },

  orderSummary: (number, country, plan, price) => {
    const planKey = (plan.name || '').toLowerCase()
    const ivrLine = planKey === 'starter'
      ? `\n\n<i>⚠️ Starter does <b>not</b> include IVR (Quick IVR Call, Bulk IVR Campaign, OTP, Auto-Attendant) or SIP softphone credentials. Need IVR? Pick Pro or Business instead.</i>`
      : ''
    const creditLine = planKey === 'starter'
      ? `\n<i>🛡️ 14-day upgrade credit — get 25% off if you upgrade to Pro/Business within 14 days</i>`
      : planKey === 'pro'
      ? `\n<i>🛡️ 14-day upgrade credit — get 25% off if you upgrade to Business within 14 days</i>`
      : ''
    return `📋 <b>Order Summary</b>\n\n📞 ${formatPhone(number)} · ${country}\n📦 ${plan.name} — $${price}/mo\n📩 ${plan.sms} SMS · 📞 ${plan.minutes} inbound min\n\n💰 Total: <b>$${price}</b> (first month)\n\n<i>📞 Included minutes cover incoming calls answered via SIP/browser. Call forwarding to another phone & all outbound (incl. IVR/OTP) are billed from your wallet.</i>${creditLine}${ivrLine}`
  },

  paymentPrompt: (price) => `Price: <b>$${price}</b>. Choose payment method:`,

  activated: (number, plan, price, sipUser, sipDomain, expiry) => `🎉 <b>Your Cloud IVR is Active!</b>

📞 Number: ${formatPhone(number)}
📦 Plan: ${plan} ($${price}/mo)
📅 Renewal: ${expiry}

━━━ <b>SIP Credentials</b> ━━━
🌐 Server: ${sipDomain}
👤 Username: ${sipUser}
🔑 Password: ●●●●●●●● (use 🔑 SIP Credentials to reveal)
📡 Port: 5060 (UDP/TCP) | 5061 (TLS)

━━━ <b>Quick Setup</b> ━━━
• Browser: Make & receive calls at <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a> — no sign-up needed
• Softphone: Download Zoiper/Ooma, enter SIP credentials
• SMS: Inbound SMS forwarded to this chat automatically
• Forwarding: Set up via 📱 My Numbers → Call Forwarding`,

  noNumbers: '📱 You don\'t have any phone numbers yet.\n\nTap below to get your first virtual number.',

  // ── Sub-Number Messages ──
  subNumberLimitReached: (plan, limit) => `⚠️ You've reached the sub-number limit for <b>${plan}</b> plan (${limit} numbers).\n\nUpgrade to a higher plan for more sub-numbers.`,
  
  subNumberOrderSummary: (number, country, parentNumber, price, parentPlan) => `📋 <b>Sub-Number Order</b>

📞 New: ${formatPhone(number)} · ${country}
🔗 Added to: ${formatPhone(parentNumber)} (${parentPlan} Plan)
💰 Price: <b>$${typeof price === 'number' ? price.toFixed(2) : price}/mo</b>

⚡ Shares parent plan minutes & SMS pool
🔑 Own SIP credentials included`,

  subActivated: (number, parentNumber, price, sipUser, sipDomain, expiry) => `🎉 <b>Sub-Number Added!</b>

📞 Number: ${formatPhone(number)}
🔗 Linked to: ${formatPhone(parentNumber)}
💰 Price: $${typeof price === 'number' ? price.toFixed(2) : price}/mo
📅 Renewal: ${expiry}

━━━ <b>SIP Credentials</b> ━━━
🌐 Server: ${sipDomain}
👤 Username: ${sipUser}
🔑 Password: ●●●●●●●● (use 🔑 SIP Credentials to reveal)
📡 Port: 5060 (UDP/TCP) | 5061 (TLS)

━━━ <b>Quick Setup</b> ━━━
• Browser: <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>
• Softphone: Download Zoiper/Ooma, enter SIP credentials
• Minutes & SMS shared with parent number's plan pool`,

  adminSubPurchase: (name, number, parentNumber, price, paymentMethod) => `➕ <b>Sub-Number Added</b>\n👤 ${name}\n📞 ${formatPhone(number)} → ${formatPhone(parentNumber)}\n💰 $${price} · ${paymentMethod}`,
  adminSubPurchasePrivate: (name, number, parentNumber, price, paymentMethod) => `➕ <b>Sub-Number Added</b>\n👤 ${name}\n📞 New: ${formatPhone(number)}\n🔗 Parent: ${formatPhone(parentNumber)}\n💰 $${price}/mo · ${paymentMethod}`,
  
  // Sub-number flow messages
  subAddNumberHeader: (plan, parentNumber) => `➕ <b>Add Number to ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan</b>\n📞 Parent: ${formatPhone(parentNumber)}\n\n🌍 Select country for your new number:`,
  subNumbersAvailable: '📱 <b>Sub-Number — Available</b>',
  subNumberArea: (area) => `📱 <b>Sub-Number — Area ${area}</b>`,
  subNumberSelected: (location) => `📱 <b>Sub-Number — ${location}</b>`,
  bulkIvrSupport: '☎️ = Supports Bulk IVR',
  tapToSelect: 'Tap to select:',

  myNumbersList: (numbers) => {
    let text = '📱 <b>Your Cloud IVR Numbers:</b>\n\n'
    // Separate primary and sub numbers
    const primaryNumbers = numbers.filter(n => !n.isSubNumber)
    const subNumbers = numbers.filter(n => n.isSubNumber)
    primaryNumbers.forEach((n, i) => {
      const status = n.status === 'active' ? '✅ Active' : n.status === 'suspended' ? '⚠️ Suspended' : n.status === 'inactive_released' ? '🚫 Inactive (released by provider)' : '🗑️ Deleted'
      text += `${i + 1}️⃣  ${formatPhone(n.phoneNumber)}  ${status}\n`
      text += `    ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} Plan · Renews ${shortDate(n.expiresAt)}\n`
      if (n.status === 'inactive_released') {
        const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
        text += `    <i>Auto-removal in ~${hoursLeft}h · Contact support if this is an error</i>\n`
      }
      // Show sub-numbers under this parent
      const subs = subNumbers.filter(s => s.parentNumber === n.phoneNumber && (s.status === 'active' || s.status === 'suspended'))
      if (subs.length > 0) {
        subs.forEach(s => {
          const subStatus = s.status === 'active' ? '✅' : '⚠️'
          text += `    ├ ${formatPhone(s.phoneNumber)} ${subStatus} (sub · $${s.planPrice}/mo)\n`
        })
      }
      text += '\n'
    })
    return text
  },

  manageNumber: (n, subCount, subLimit, allNumbers) => {
    const plan = plans[n.plan] || (n.isSubNumber && n.parentNumber ? plans[allNumbers?.find(p => p.phoneNumber === n.parentNumber)?.plan] : null)
    const minLimit = plan?.minutes === 'Unlimited' ? 'Unlimited' : (plan?.minutes || 0)
    const smsLimit = plan?.sms || 0
    // Pool usage: parent + all sub-numbers sharing the plan
    let minUsed = n.minutesUsed || 0
    let smsUsed = n.smsUsed || 0
    if (allNumbers && allNumbers.length > 0) {
      if (n.isSubNumber && n.parentNumber) {
        const parent = allNumbers.find(p => p.phoneNumber === n.parentNumber && !p.isSubNumber)
        const siblings = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.parentNumber)
        minUsed = (parent?.minutesUsed || 0) + siblings.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
        smsUsed = (parent?.smsUsed || 0) + siblings.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
      } else {
        const subs = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.phoneNumber)
        minUsed = (n.minutesUsed || 0) + subs.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
        smsUsed = (n.smsUsed || 0) + subs.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
      }
    }
    const minDisplay = minLimit === 'Unlimited' ? `${minUsed} (Unlimited)` : `${minUsed} / ${minLimit}`
    const smsDisplay = `${smsUsed} / ${smsLimit}`
    const minWarning = minLimit !== 'Unlimited' && minUsed >= minLimit ? `\n💰 <b>Overage active</b> — $${OVERAGE_RATE_MIN}/min from wallet` : ''
    const smsWarning = smsUsed >= smsLimit ? `\n💰 <b>Overage active</b> — $${OVERAGE_RATE_SMS}/SMS from wallet` : ''

    // Dynamic capabilities
    const hasSms = n.capabilities?.sms !== false && n.features?.sms !== false
    const hasFax = n.capabilities?.fax === true
    const hasVoice = n.capabilities?.voice !== false

    let text = `⚙️ Managing: <b>${formatPhone(n.phoneNumber)}</b>`
    if (n.isSubNumber) text += ` <i>(sub-number)</i>`
    if (n.status === 'inactive_released') {
      const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
      text += `\n\n🚫 <b>INACTIVE — Released by Provider</b>\nThis number has been removed by the telecom provider and can no longer make or receive calls.\nIt will be auto-removed from your account in ~${hoursLeft}h.\n\nIf this is an error, contact support immediately.`
      return text
    }
    if (n.isSubNumber) {
      text += `\n\nStatus: ${n.status === 'active' ? '✅ Active' : '⚠️ ' + n.status}\nSub-number — $${n.planPrice}/mo (under ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} plan)`
    } else {
      text += `\n\nStatus: ${n.status === 'active' ? '✅ Active' : '⚠️ ' + n.status}\nPlan: ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} ($${n.planPrice}/mo)`
    }
    if (n.isSubNumber && n.parentNumber) text += `\n🔗 Parent: ${formatPhone(n.parentNumber)}`
    if (hasVoice) text += `\n📞 Inbound Minutes: ${minDisplay}${minWarning}`
    if (hasSms) text += `\n📩 Inbound SMS: ${smsDisplay} (receive only)${smsWarning}`
    if (hasFax) text += `\n📠 Fax: Included — inbound faxes forwarded to Telegram`
    if (hasVoice) text += `\n💳 Outbound calls charged from wallet`

    // Capabilities badge
    const caps = []
    if (hasVoice) caps.push('Voice')
    if (hasSms) caps.push('SMS')
    if (hasFax) caps.push('Fax')
    text += `\n📋 Capabilities: ${caps.join(' · ')}`

    // Sub-number count for primary numbers
    if (!n.isSubNumber && subCount !== undefined && subLimit !== undefined) {
      text += `\n➕ Sub-numbers: ${subCount} / ${subLimit}`
    }

    // ⚠️ IVR-incomplete badge — visible BEFORE user opens the IVR submenu
    if (n.features?.ivr?.enabled && Object.keys(n.features.ivr.options || {}).length === 0) {
      text += `\n\n⚠️ <b>IVR enabled but incomplete</b> — no menu options. Callers will skip the menu and go to voicemail. Tap <b>🤖 IVR / Auto-attendant</b> to add options.`
    }

    // Browser call hint
    if (hasVoice) text += `\n\n🌐 <a href="${CALL_PAGE_URL}">Make & receive calls in browser</a>`

    // "Last changed: X ago" — sourced from `n.updatedAt`, stamped by updatePhoneNumberFeature / updatePhoneNumberField
    const lastChanged = formatRelativeTime(n.updatedAt, 'en')
    if (lastChanged) text += `\n<i>🕒 Last changed: ${lastChanged}</i>`

    return text
  },

  // Call Forwarding
  forwardingStatus: (number, config, walletBal) => {
    const status = config?.enabled ? '✅ Active' : '❌ Off'
    let text = `📞 <b>Call Forwarding</b> — ${formatPhone(number)}\n\nStatus: ${status}`
    if (config?.enabled) {
      text += `\n📲 ${formatPhone(config.forwardTo)} · ${config.mode}`
      text += `\n🎵 Hold Music: ${config.holdMusic ? 'ON' : 'OFF'}`
    }
    const rate = config?.forwardTo && config.forwardTo.startsWith('+1') ? OVERAGE_RATE_MIN : CALL_FORWARDING_RATE_MIN
    text += `\n💳 Charged from wallet at $${rate}/min`
    if (walletBal !== undefined) {
      text += ` · 💳 $${walletBal.toFixed(2)}`
    }
    return text
  },
  enterForwardNumber: (walletBal) => {
    let text = `Enter forwarding number with country code (e.g. +14155551234)\n💰 Rate: <b>$${CALL_FORWARDING_RATE_MIN}/min</b>`
    if (walletBal !== undefined) {
      text += ` · 💳 $${walletBal.toFixed(2)}`
      if (walletBal < CALL_FORWARDING_RATE_MIN) text += `\n⚠️ Top up <b>$25</b> via 👛 Wallet first.`
    }
    return text
  },
  forwardingUpdated: (number, forwardTo, mode, walletBal) => {
    let text = `✅ <b>Forwarding Active</b>\n\n📞 ${formatPhone(number)} → ${formatPhone(forwardTo)}\n📋 ${mode} · $${CALL_FORWARDING_RATE_MIN}/min`
    if (walletBal !== undefined) {
      const estMin = Math.floor(walletBal / CALL_FORWARDING_RATE_MIN)
      text += `\n💳 $${walletBal.toFixed(2)} (~${estMin} min)`
      if (walletBal < 25) text += `\n💡 Top up to <b>$25</b> for uninterrupted forwarding.`
    }
    return text
  },
  forwardingBlocked: (number) => `🚫 <b>Blocked</b> — ${formatPhone(number)} is a premium destination.\nTap 💬 <b>Get Support</b> to request activation.`,
  forwardingNotRoutable: (number) => `⚠️ ${formatPhone(number)} is not routable. Check the number or tap 💬 <b>Get Support</b>.`,
  forwardingInsufficientBalance: (walletBal) => `🚫 <b>Insufficient Balance</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · Need $${CALL_FORWARDING_RATE_MIN}/min\n\n👉 Top up <b>$25</b> via 👛 Wallet to activate forwarding.`,
  forwardingDisabled: (number) => `✅ Forwarding disabled for ${formatPhone(number)}.`,

  // SMS Settings
  smsSettingsMenu: (number, config, plan) => {
    const tg = config?.toTelegram ? '✅ ON' : '❌ OFF'
    const em = config?.toEmail ? '✅ ' + config.toEmail : '❌ OFF'
    const wh = config?.webhookUrl ? '✅ Set' : '❌ Not Set'
    const canEmail = canAccessFeature(plan, 'smsToEmail')
    const canWebhook = canAccessFeature(plan, 'smsWebhook')
    const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Unknown'
    return `📩 <b>Inbound SMS Settings</b> for <b>${formatPhone(number)}</b>

📌 SMS is <b>inbound only</b> — you receive SMS to this number but cannot send outbound.

📲 Forward to Telegram: ${tg}
📧 Forward to Email: ${canEmail ? em : `🔒 Requires Pro plan or higher (current: ${planName})`}
🔗 Webhook URL: ${canWebhook ? wh : `🔒 Requires Pro plan or higher (current: ${planName})`}`
  },
  smsToggled: (channel, state) => `${channel} is now ${state ? '✅ ON' : '❌ OFF'}`,

  // Fax Settings
  faxSettingsMenu: (number, config, provider) => {
    const tg = config?.toTelegram !== false ? '✅ ON' : '❌ OFF'
    if (provider === 'twilio') {
      return `📠 <b>Fax Settings</b> for <b>${formatPhone(number)}</b>\n\n⚠️ <b>Fax is not available for this number type.</b>\nThe provider for this number has discontinued fax service. Inbound faxes cannot be received.\n\nTo use fax, purchase a number with fax capability from a supported provider.`
    }
    return `📠 <b>Fax Settings</b> for <b>${formatPhone(number)}</b>\n\nInbound faxes are received as PDF and forwarded to this Telegram chat.\n\n📲 Forward to Telegram: ${tg}`
  },
  faxToggled: (state) => `📠 Fax to Telegram is now ${state ? '✅ ON' : '❌ OFF'}`,
  faxReceived: (from, to, pages) => `📠 <b>Fax Received</b>\nFrom: ${from}\nTo: ${formatPhone(to)}${pages ? `\nPages: ${pages}` : ''}`,
  faxFailed: (from, to, reason) => `📠 <b>Fax Failed</b>\nFrom: ${from}\nTo: ${formatPhone(to)}\nReason: ${reason || 'Unknown'}`,
  enterEmail: 'Enter the email address to forward SMS messages to:',
  emailSet: (email) => `✅ SMS to Email enabled!\nAll inbound SMS will also be sent to <b>${email}</b>.`,
  enterWebhook: 'Enter your webhook URL (inbound SMS will be POSTed as JSON):',
  webhookSet: (url) => `✅ Webhook URL configured!\nSMS will be POSTed to: ${url}`,

  // Voicemail
  voicemailMenu: (number, config) => {
    if (!config?.enabled) {
      return `🎙️ Voicemail for <b>${formatPhone(number)}</b>\n\nStatus: ❌ Disabled\n\nWhen enabled, unanswered calls will hear a greeting and callers can leave a voice message.`
    }
    const tg = config.forwardToTelegram ? '✅ ON' : '❌ OFF'
    const em = config.forwardToEmail ? '✅ ' + config.forwardToEmail : '❌ OFF'
    let greetInfo = ''
    if (config.greetingType === 'custom' && config.customAudioGreetingUrl) {
      greetInfo = '🎤 Custom Audio'
    } else if (config.greetingType === 'custom' && config.customGreetingText) {
      greetInfo = `📝 Custom: "${config.customGreetingText}"`
    } else {
      greetInfo = '🔊 Default: "You have reached ' + formatPhone(number) + '. Please leave a message after the tone."'
    }
    return `🎙️ Voicemail for <b>${formatPhone(number)}</b>\n\nStatus: ✅ Enabled\n🎤 Greeting: ${greetInfo}\n\n📲 Send to Telegram: ${tg}\n📧 Send to Email: ${em}\n⏰ Ring Time: ${config.ringTimeout || 25}s`
  },
  voicemailEnabled: (number) => `✅ Voicemail enabled for ${formatPhone(number)}!\nRecordings will be sent to this Telegram chat.`,
  voicemailDisabled: (number) => `✅ Voicemail disabled for ${formatPhone(number)}.`,

  vmGreetingMenu: (number, vm) => {
    let current = ''
    if (vm?.greetingType === 'custom' && vm?.customAudioGreetingUrl) {
      current = '🎤 Custom Audio\n📎 Audio file uploaded'
    } else if (vm?.greetingType === 'custom' && vm?.customGreetingText) {
      current = `📝 Custom Text: "${vm.customGreetingText}"`
    } else {
      current = `🔊 Default: "You have reached ${formatPhone(number)}. Please leave a message after the tone."`
    }
    return `🔊 <b>Voicemail Greeting</b> for <b>${formatPhone(number)}</b>\n\nCurrent: ${current}\n\nChoose an option below:`
  },
  vmSendAudioPrompt: '🎤 <b>Custom Audio Greeting</b>\n\nSend a voice message or audio file to use as your voicemail greeting.\n\nCallers will hear this audio when they reach your voicemail.\n\n<i>Tip: Record a professional greeting like "Hi, you\'ve reached [name]. I can\'t answer right now. Please leave a message after the tone."</i>',
  vmAudioSaved: '✅ Custom audio greeting saved! Callers will now hear your uploaded greeting.',
  vmDefaultRestored: '✅ Voicemail greeting reset to default text-to-speech.',
  vmTextGreetingPrompt: 'Enter a custom greeting text (will be read aloud by text-to-speech):',
  vmTextGreetingSet: (text) => `✅ Custom text greeting saved!\n\n"${text}"`,

  // SIP
  sipCredentialsMsg: (number, username, domain) => `🔑 SIP Credentials for <b>${formatPhone(number)}</b>

🌐 SIP Server: ${domain}
👤 Username: <code>${username}</code>
🔑 Password: ●●●●●●●●
📡 Ports: 5060 (UDP/TCP) · 5061 (TLS)
🎵 Codecs: G.711μ, G.711a, Opus`,

  sipRevealed: (password) => `🔑 Password: <code>${password}</code>\n\n⚠️ Save this now — this message will be deleted in 30 seconds.`,
  sipReset: (password) => `✅ SIP password has been reset!\n\n🔑 New Password: <code>${password}</code>\n\n⚠️ Save this now. Update this password on all your SIP devices.`,

  // ── Test My Number ──
  testMyNumber: {
    placing: (phone) => `📞 Calling <code>${phone}</code> from a Nomadly test line… pick up on your softphone and press <b>1</b> when it rings (you have ~12 seconds after answer).\n\nResult will appear here within 60 seconds.`,
    successDtmf: (phone) => `✅ <b>Reached your SIP device</b> — calls to <code>${phone}</code> are working end-to-end. The far end answered and a key was pressed.`,
    voicemail: (phone) => `⚠️ <b>Got voicemail / PBX answer</b> on <code>${phone}</code>.\n\nThis usually means a PBX (3CX, FreePBX, Asterisk…) is answering and dumping the call to its own voicemail instead of ringing your extension.\n\nFix: open /sipguide for the SIP TRUNK setup walk-through, or switch to a single-line softphone (Linphone, Zoiper) for an instant fix.`,
    answeredNoDtmf: (phone) => `⚠️ <b>Call answered, but no key was pressed</b> on <code>${phone}</code> within 12 seconds.\n\nIf you didn't pick up, your softphone may not be receiving the call. If you DID pick up but didn't press 1, just retry. If a PBX (3CX/FreePBX) is involved, see /sipguide for SIP TRUNK setup.`,
    noAnswer: (phone) => `❌ <b>No answer</b> on <code>${phone}</code>.\n\nMake sure your softphone (Linphone / Zoiper / 3CX trunk) is registered and online, then run the test again. Open /sipguide for setup help.`,
    throttled: (max) => `⏳ You've already run ${max} tests on this number in the last 24 hours. Please wait before testing again.`,
    inactive: (phone) => `❌ Number <code>${phone}</code> is not active — testing is only available for active numbers.`,
    placeFailed: (err) => `❌ Couldn't place test call: ${err}`,
  },

  // ── Test Outbound SIP ──
  testOutboundSip: {
    listening: (phone, sipUser) => `📤 <b>Outbound SIP Test — listening for 90s</b>\n\n📞 Number: <code>${phone}</code>\n🔑 SIP user: <code>${sipUser}</code>\n\nFrom your softphone, dial <b>any number</b> within the next 90 seconds — your own mobile is ideal.\n\n💡 The call will be intercepted safely: <b>no wallet charges</b>, <b>no PSTN leg</b> will be placed. We just verify your softphone's outbound path reaches our servers with the correct SIP credentials.\n\nResult will appear here as soon as your call arrives.`,
    success: (phone, sipUser, provider, destination, elapsedSec) => `✅ <b>Outbound SIP verified</b>\n\nYour softphone successfully placed an outbound call.\n\n📞 Number: <code>${phone}</code>\n🔑 SIP user: <code>${sipUser}</code>\n🌐 Provider: <code>${provider}</code>\n📍 You dialed: <code>${destination}</code>\n⏱️ Latency to our servers: ${elapsedSec}s\n\n💡 The call was intercepted — no wallet charges, no PSTN leg placed. Your outbound SIP path is working end-to-end.`,
    timeout: (phone) => `❌ <b>No outbound SIP call detected</b> on <code>${phone}</code> in 90 seconds.\n\nLikely causes:\n• <b>SIP 403 Forbidden on register</b> — long <code>gencred…</code> usernames (49 chars) get truncated by some dialers. Copy-paste from 🔑 SIP Credentials; don't retype. Also make sure the domain <code>sip.speechcue.com</code> is in the <i>Domain / SIP Server</i> field, NOT appended to the username.\n• Softphone not registered — check the registration/status light in Linphone/Zoiper/MicroSIP\n• Wrong SIP credentials — verify username + password via <b>🔑 SIP Credentials</b>\n• Firewall blocking UDP 5060 / SIP traffic\n• <b>Predictive / auto-dialer</b> (Ecsow, DialFire, X-Lite) or PBX (3CX / FreePBX) misconfigured as user/extension instead of SIP TRUNK — see /sipguide\n\nOnce you see "Registered" in your softphone, run the test again.`,
    throttled: (max) => `⏳ You've already run ${max} outbound SIP tests on this number in the last 24 hours. Try again later.`,
    inactive: (phone) => `❌ Number <code>${phone}</code> is not active — outbound SIP testing is only available for active numbers.`,
    noSipConfigured: (phone) => `❌ No SIP credentials on <code>${phone}</code>. Set up SIP first via <b>🔑 SIP Credentials</b>, then retry.`,
  },

  softphoneGuide: (domain) => `📖 <b>SIP Setup Guide</b>

<b>🌐 Browser (Easiest)</b>
Make &amp; receive calls directly in your browser:
<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>
No sign-up or app install needed — just enter your SIP credentials.

<b>📱 Softphone Apps — Recommended</b>
Use a single-line softphone (one device per credential):
• <b>Linphone</b> — iOS / Android / Mac / Windows / Linux (free)
• <b>Zoiper</b> — iOS / Android / Desktop (free)
• <b>MicroSIP</b> — Windows (free, lightweight)
• <b>Bria Solo</b> — paid, polished UI

<b>Setup steps</b>
1. Install the app
2. Add Account → SIP / VoIP
3. Username + Password from 🔑 SIP Credentials — <b>copy-paste, don't retype</b> (usernames are 49 chars)
4. Domain / SIP Server: <code>${domain}</code> — put this in the <i>Domain</i> field ONLY, do NOT append it to the username
5. Port 5060 (UDP/TCP) or 5061 (TLS) · DTMF: RFC 2833 · Codec: G.711μ
6. Save and make a test call

⚠️ <b>Getting "403 Forbidden" / registration failed?</b>
The three usual causes:
1. <b>Username got truncated</b> — most SIP dialers accept 50+ char usernames but some old builds truncate. Copy-paste the full <code>gencred…</code> string exactly.
2. <b>Domain in the wrong field</b> — the username is JUST <code>gencred…</code>. Do NOT enter <code>gencred…@${domain}</code> in the username box. The <code>@${domain}</code> part belongs in the "Domain / SIP Server" field.
3. <b>Wrong password</b> — passwords are case-sensitive hex. Tap 🔄 Reset Password if unsure and copy-paste the fresh one.

⚠️ <b>Using Ecsow, DialFire, X-Lite, or another predictive / auto-dialer?</b>
These are <b>NOT</b> single-line softphones — they're built for outbound campaigns and expect a <b>SIP TRUNK</b>. If you added the credentials as a "SIP Account" / "Extension", you'll see registration errors (401/403) or calls that connect but drop instantly. Switch the account type to <b>SIP Trunk</b> and use the same domain / port / username / password.

⚠️ <b>Using 3CX, FreePBX, Asterisk or another PBX?</b>
Don't add the SIP credential as a "user / extension" — a PBX answers the call and dumps it straight to its own voicemail (you'll hear "Record your message and press pound, or press star to contact the operator", then "transfer failed" on star). Configure it as a <b>SIP TRUNK</b> instead:

<b>3CX example</b>
1. SIP Trunks → Add SIP Trunk → "Generic SIP Trunk"
2. Main Trunk No.: your Nomadly number (e.g. <code>+18882437690</code>)
3. Registrar / Server / Outbound Proxy: <code>${domain}</code> · Port <code>5060</code>
4. Authentication: <b>Register/Account based</b>
   Username + Auth ID: your <code>gencred…</code> SIP username
   Password: your SIP password
5. Save → Inbound Rules → New Inbound Rule → <b>Route to your extension</b> (NOT voicemail)
6. Outbound Rules → match your extensions, route via this trunk
7. Apply &amp; reload — make a test call (your extension should ring, not voicemail)

🧪 <b>Free test calls:</b>
Send /testsip here to get your test code.

❓ Still stuck? Tap 💬 Support and we'll help.`,

  // Renew
  renewMenu: (number, plan, price, expiry, autoRenewOn) => `🔄 Plan for <b>${formatPhone(number)}</b>

Current Plan: ${plan} — $${price}/mo
Renewal Date: ${shortDate(expiry)}
Auto-Renew: ${autoRenewOn ? '✅ ON' : '❌ OFF'}`,

  // Delete
  releaseConfirm: (number) => `🗑️ <b>Delete ${formatPhone(number)}?</b>

⚠️ <b>This cannot be undone.</b>

• Number permanently deleted
• Monthly plan cancelled immediately
• All settings (forwarding, voicemail, SIP) removed
• No refund for remaining days

Are you sure?`,
  releaseConfirmDigits: (digits) => `⚠️ <b>Final confirmation</b>\n\nType the last 4 digits of the number to permanently delete it: <b>${digits}</b>`,
  released: (number) => `✅ ${formatPhone(number)} has been permanently deleted.\n\nPlan cancelled. All settings removed.`,

  // Real-time events
  inboundSms: (to, from, body, time) => `📩 <b>SMS Received</b>

📞 To: ${formatPhone(to)}
👤 From: ${formatPhone(from)}
🕐 ${time}

💬 "${body}"`,

  missedCall: (to, from, time) => `📞 <b>Missed Call</b>

📞 To: ${formatPhone(to)}
👤 From: ${formatPhone(from)}
🕐 ${time}`,

  callForwarded: (to, from, forwardedTo, duration, time) => `📞 <b>Call Forwarded</b>

📞 To: ${formatPhone(to)}
👤 From: ${formatPhone(from)}
📲 Forwarded: ${formatPhone(forwardedTo)}
⏱️ Duration: ${formatDuration(duration)}
🕐 ${time}`,

  newVoicemail: (to, from, duration, time) => `🎙️ <b>New Voicemail</b>

📞 To: ${formatPhone(to)}
👤 From: ${formatPhone(from)}
⏱️ Duration: ${formatDuration(duration)}
🕐 ${time}`,

  // Admin notifications
  adminPurchase: (user, number, plan, price, method) => `🎉 <b>New Cloud IVR Purchase!</b>\nUser ${user} bought a new number\nPlan: ${plan} ($${price}/mo)\nPayment: ${method}`,
  adminRelease: (user, number, plan) => `🗑️ <b>Number Released</b>\nUser ${user} released a number\nWas: ${plan} Plan`,
  adminPurchasePrivate: (user, number, plan, price, method) => `🎉 <b>New Cloud IVR Purchase!</b>\nUser ${user} bought ${formatPhone(number)}\nPlan: ${plan} ($${price}/mo)\nPayment: ${method}`,
  adminReleasePrivate: (user, number, plan) => `🗑️ <b>Number Released</b>\nUser ${user} released ${formatPhone(number)}\nWas: ${plan} Plan`,

  // Expiry reminders
  expiryReminder: (number, days, plan, price, balance) => `🔔 <b>Renewal Reminder</b>

Your Cloud IVR number ${formatPhone(number)} (${plan} Plan) expires in <b>${days} day${days !== 1 ? 's' : ''}</b>.

Wallet Balance: $${balance}
Plan Price: $${price}/mo${balance < price ? '\n\n⚠️ Insufficient balance. Please deposit funds.' : ''}`,

  autoRenewed: (number, plan, price, newExpiry, oldBal, newBal) => `✅ <b>Auto-Renewal Successful</b>

📞 ${formatPhone(number)}
📦 Plan: ${plan} ($${price}/mo)
📅 New expiry: ${shortDate(newExpiry)}
Wallet: $${oldBal} → $${newBal}`,

  autoRenewFailed: (number, plan, price, balance) => `❌ <b>Auto-Renewal Failed</b>

📞 ${formatPhone(number)}
📦 Plan: ${plan} ($${price}/mo)
💰 Wallet: $${balance} (need $${price})

⚠️ Your number is now SUSPENDED. Deposit funds and renew within 7 days.`,

  // IVR / Auto-attendant (Business Plan)
  ivrMenu: (number, config) => {
    if (!config?.enabled) {
      return `🤖 <b>IVR / Auto-attendant</b> for <b>${formatPhone(number)}</b>\n\nStatus: ❌ Disabled\n\nWhen enabled, callers hear a greeting menu and can press keys to reach the right destination.`
    }
    const hasOptions = config.options && Object.keys(config.options).length > 0
    let text = `🤖 <b>IVR / Auto-attendant</b> for <b>${formatPhone(number)}</b>\n\nStatus: ${hasOptions ? '✅ Enabled' : '⚠️ Enabled (incomplete)'}\n\n🎤 Greeting: "${escapeHtml(config.greeting || 'Default')}"\n\n📋 <b>Menu Options:</b>\n`
    if (hasOptions) {
      Object.entries(config.options).forEach(([key, opt]) => {
        let desc
        if (opt.action === 'forward') desc = '📲 Forward to ' + formatPhone(opt.forwardTo)
        else if (opt.action === 'voicemail') desc = '🎙️ Voicemail'
        else if (opt.action === 'submenu') {
          const subCount = Object.keys(opt.subMenu?.options || {}).length
          const lbl = opt.label && opt.label.trim() ? opt.label.trim() : `Sub-Menu ${key}`
          desc = `📂 <b>${escapeHtml(lbl)}</b> — sub-menu (${subCount} option${subCount === 1 ? '' : 's'})`
        } else desc = '🔊 ' + escapeHtml(opt.message || 'Play message')
        text += `  Press <b>${escapeHtml(key)}</b> → ${desc}\n`
      })
    } else {
      text += '  ⚠️ <b>No options added yet — IVR will not run.</b>\n  Callers will skip the menu and go straight to voicemail (or hear "unavailable" if voicemail is off).\n  Tap <b>➕ Add Option</b> below to add at least one (e.g. <code>1 forward +14155551234</code>).\n'
    }
    return text
  },
  ivrEnabled: (number) => `✅ IVR / Auto-attendant enabled for ${formatPhone(number)}!\n\nCallers will hear your greeting and can press keys to navigate.`,
  ivrDisabled: (number) => `✅ IVR / Auto-attendant disabled for ${formatPhone(number)}.`,
  ivrSetGreeting: 'Enter the IVR greeting message (what callers will hear):\n\nExample: "Thank you for calling. Press 1 for support, press 2 for sales, or stay on the line."',
  ivrGreetingSet: (greeting) => `✅ IVR greeting updated!\n\n"${greeting}"`,
  ivrAddOption: 'Enter the key and action in this format:\n\n<code>KEY ACTION DESTINATION</code>\n\nExamples:\n• <code>1 forward +14155551234</code>\n• <code>2 voicemail</code>\n• <code>3 message We will call you back</code>\n• <code>0 forward +14155559999</code>',
  ivrOptionAdded: (key, action, destination) => `✅ IVR option added!\n\nPress <b>${key}</b> → ${action === 'forward' ? '📲 Forward to ' + formatPhone(destination) : action === 'voicemail' ? '🎙️ Voicemail' : '🔊 ' + destination}`,
  ivrOptionRemoved: (key) => `✅ IVR option for key <b>${key}</b> removed.`,
  ivrInvalidFormat: '❌ Invalid format. Please use:\n<code>KEY ACTION DESTINATION</code>\n\nExample: <code>1 forward +14155551234</code>',

  ivrAnalyticsReport: (number, data, labels) => {
    let text = `📊 <b>IVR Analytics</b> for <b>${formatPhone(number)}</b>\n(Last 30 days)\n\n`
    text += `📞 Total IVR calls: <b>${data.totalCalls}</b>\n`
    const _labelFor = (d) => (labels && labels[d]) ? ` <i>(${escapeHtml(labels[d])})</i>` : ''
    if (data.topOption) {
      text += `🏆 Most pressed: Key <b>${escapeHtml(data.topOption.digit)}</b>${_labelFor(data.topOption.digit)} (${data.topOption.count} times, ${data.topOption.percent}%)\n`
    }
    text += '\n'
    if (data.optionBreakdown.length > 0) {
      text += '📋 <b>Option Breakdown:</b>\n'
      data.optionBreakdown.forEach(o => {
        const bar = '█'.repeat(Math.max(1, Math.round(o.percent / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(o.percent / 10)))
        text += `  Key <b>${escapeHtml(o.digit)}</b>${_labelFor(o.digit)}: ${bar} ${o.count} (${o.percent}%)\n`
      })
      text += '\n'
    }
    if (data.recentCalls.length > 0) {
      text += '📱 <b>Recent IVR Calls:</b>\n'
      data.recentCalls.forEach(c => {
        text += `  ${formatPhone(c.from)} → Key <b>${escapeHtml(c.digit)}</b>${_labelFor(c.digit)} (${escapeHtml(c.action)}) ${shortDate(c.time)}\n`
      })
    }
    if (data.totalCalls === 0) text += '\nNo IVR calls recorded yet.'
    return text
  },

  // Call Recording (Business Plan)
  recordingMenu: (number, config) => {
    const enabled = config?.recording === true
    return `🔴 <b>Call Recording</b> for <b>${formatPhone(number)}</b>\n\nStatus: ${enabled ? '✅ Enabled' : '❌ Disabled'}\n\nWhen enabled, all incoming and outgoing calls will be automatically recorded. Recordings are sent to your Telegram chat.`
  },
  recordingEnabled: (number) => `✅ Call recording enabled for ${formatPhone(number)}!\n\nAll calls will be recorded and sent to this chat.`,
  recordingDisabled: (number) => `✅ Call recording disabled for ${formatPhone(number)}.`,

  // SMS Inbox
  smsInboxHeader: (number, total) => `📨 <b>SMS Inbox</b> for <b>${formatPhone(number)}</b>\n\n${total === 0 ? 'No messages received yet.' : `${total} message${total > 1 ? 's' : ''} received:`}`,
  smsInboxEntry: (i, from, name, body, time) => {
    const nameDisplay = name && name !== 'None' ? ` (${name})` : ''
    const bodyPreview = body.length > 80 ? body.substring(0, 80) + '...' : body
    return `\n<b>${i}.</b> ${formatPhone(from)}${nameDisplay}\n   💬 "${bodyPreview}"\n   🕐 ${time}\n`
  },
  smsInboxEmpty: 'No inbound SMS received yet for this number.\n\n<i>When someone texts your number, messages will appear here.</i>',
  smsInboxFooter: (page, totalPages) => totalPages > 1 ? `\n📄 Page ${page}/${totalPages}` : '',
}

// ── Helpers ──
function formatPhone(num) {
  if (!num) return ''
  const clean = num.replace(/[^+\d]/g, '')
  if (clean.startsWith('+1') && clean.length === 12) {
    return `+1 (${clean.slice(2, 5)}) ${clean.slice(5, 8)}-${clean.slice(8)}`
  }
  return clean
}

/**
 * maskPhone — privacy-safe formatter for group / public broadcast messages.
 *
 * Keeps the country code + first 2 digits of the area/national code AND the
 * last 2 digits, masks the middle with •. Never returns enough to identify a
 * specific subscriber. Examples:
 *   +15105551234            → +1 51• •••• ••34
 *   +447911123456           → +4 47• •••• ••56
 *   12345                   → •••45            (short numbers — keep last 2)
 *   ''                      → ''               (empty stays empty)
 *
 * IMPORTANT: only safe for visible UI / group messages. Internal logs,
 * payment records, and admin-only DMs MUST still use formatPhone(num) (which
 * returns the full number) — there's a separate "private" arg on
 * notifyGroup() that delivers the full number to TELEGRAM_ADMIN_CHAT_ID only.
 *
 * Real bug this prevents (reported 2026-07-01): phone-scheduler.js was
 * passing formatPhone(num.phoneNumber) as the SOLE arg to _notifyGroup(...),
 * so every "Grace Period Started" / "Auto-Renewed" / "Expired + Released"
 * notification leaked the user's full phone number to the public notify
 * group AND every auto-registered group.
 */
function maskPhone(num) {
  if (!num) return ''
  const clean = String(num).replace(/[^+\d]/g, '')
  if (!clean) return ''
  // Short / weird numbers: keep last 2 only
  if (clean.length < 6) return '•••' + clean.slice(-2)
  const hasPlus = clean.startsWith('+')
  const digits = hasPlus ? clean.slice(1) : clean
  // Always reveal first 3 + last 2 of digit body; mask the middle with bullets.
  // For a typical US +1XXXXXXXXXX (11 digits incl. country code) → "1 51• •••• ••34"
  const head = digits.slice(0, 3)
  const tail = digits.slice(-2)
  // For US-style (+1NNNNNNNNNN), present in a familiar block layout
  if (hasPlus && digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${head.slice(1)}•) •••-••${tail}`
  }
  // Default international-style layout
  const masked = digits.slice(3, -2).replace(/\d/g, '•')
  return (hasPlus ? '+' : '') + `${head} ${masked} ${tail}`.replace(/\s+/g, ' ')
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Relative-time formatter ("2 mins ago" / "il y a 2 min" / "2分钟前" / "2 मिनट पहले").
// Shown under each phone number on the Manage screen; sourced from `num.updatedAt`.
function formatRelativeTime(iso, lang) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const L = {
    en: { justNow: 'just now',            min: (n) => `${n} min${n === 1 ? '' : 's'} ago`,      hr: (n) => `${n} hr${n === 1 ? '' : 's'} ago`,  day: (n) => `${n} day${n === 1 ? '' : 's'} ago`,  wk: (n) => `${n} wk${n === 1 ? '' : 's'} ago` },
    fr: { justNow: 'à l’instant',         min: (n) => `il y a ${n} min`,                        hr: (n) => `il y a ${n} h`,                     day: (n) => `il y a ${n} j`,                      wk: (n) => `il y a ${n} sem` },
    zh: { justNow: '刚刚',                 min: (n) => `${n} 分钟前`,                            hr: (n) => `${n} 小时前`,                        day: (n) => `${n} 天前`,                           wk: (n) => `${n} 周前` },
    hi: { justNow: 'अभी अभी',              min: (n) => `${n} मिनट पहले`,                        hr: (n) => `${n} घंटे पहले`,                     day: (n) => `${n} दिन पहले`,                       wk: (n) => `${n} सप्ताह पहले` },
  }
  const l = L[lang] || L.en
  if (secs < 60) return l.justNow
  if (secs < 3600) return l.min(Math.floor(secs / 60))
  if (secs < 86400) return l.hr(Math.floor(secs / 3600))
  if (secs < 604800) return l.day(Math.floor(secs / 86400))
  return l.wk(Math.floor(secs / 604800))
}

function shortDate(dateStr) {
  if (!dateStr) return 'N/A'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function generateSipUsername() {
  // Random seed for Telnyx API — actual sip_username comes from Telnyx response
  const crypto = require('crypto')
  return 'test_' + crypto.randomBytes(8).toString('hex')
}

function generateSipPassword() {
  // Must meet Twilio's requirements: 12+ chars, at least one number, uppercase, lowercase
  const crypto = require('crypto')
  const base = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
  return base + 'Aa1' + crypto.randomBytes(4).toString('hex')
}

// ── Multilingual UI messages for Cloud IVR ──
const msg = {
  en: {
    selectOption: 'Please select an option.',
    selectValidCountry: 'Please select a valid country.',
    selectLocalOrTollFree: 'Please select Local or Toll-Free.',
    selectValidArea: 'Please select a valid area or use Search.',
    enterValidAreaCode: 'Enter a valid area code (e.g. 415).',
    tapNumberToSelect: 'Tap a number (1-5) to select.',
    selectPlan: 'Please select a plan.',
    proceedOrBack: 'Please proceed to payment or go back.',
    selectByIndex: '💡 Tap one of the index numbers (1, 2, 3…) in the keyboard below — typed phone numbers won\'t work at this step.',
    selectForwardMode: 'Select a forwarding mode.',
    enterValidPhone: 'Enter a valid phone number with country code (e.g. +14155551234).',
    enterValidEmail: 'Enter a valid email address.',
    selectValidPlan: 'Select a valid plan.',
    noActiveNumbers: 'No active numbers. Buy one first!',
    purchasingNumber: '🔄 Purchasing your number...',
    purchaseFailed: '❌ Failed to purchase number. Your wallet has been refunded. Please try again or contact support.',
    bundleRequired: '📋 This country requires regulatory approval before activating a number. Approval typically takes 1-3 business days.',
    bundleSubmitted: '📋 Your regulatory bundle has been submitted for review. You will be notified when approved.',
    confirmOrCancel: 'Please confirm or cancel.',
    typeLast4: (digits) => `Type the last 4 digits: ${digits}`,
    noOptionForKey: (key) => `❌ No option found for key "${key}".`,
    enterValidForwardTo: 'Please provide a valid forward-to number. E.g: <code>1 forward +14155551234</code>',
    autoRenewToggled: (state) => `🔁 Auto-Renew is now ${state ? '✅ ON' : '❌ OFF'}`,
    vmTelegramToggled: (state) => `📲 Voicemail to Telegram is now ${state ? '✅ ON' : '❌ OFF'}`,
    ringTimeUpdated: (seconds) => `✅ Ring time updated to ${seconds} seconds.`,
    changePlanHeader: (number, plan, price) => `📦 Change plan for ${formatPhone(number)}\n\nCurrent: ${plan.charAt(0).toUpperCase() + plan.slice(1)} — $${price}/mo`,
    planChanged: (plan, price) => `✅ Plan changed to <b>${plan.charAt(0).toUpperCase() + plan.slice(1)}</b> — $${price}/mo`,
    featuresDisabled: 'Features disabled:',
    noIvrOptions: 'No IVR menu options configured yet.',
    whichKeyRemove: 'Which key do you want to remove?',
    sendVoiceOrText: 'Send a voice message, audio file, or type a custom greeting text.',
    noActivity: 'No activity yet.',
    insufficientBalUpgrade: (needed, bal) => `❌ Insufficient balance. You need $${needed.toFixed(2)} but have $${bal.toFixed(2)}.\n\nPlease top up your wallet first.`,
    sipTestCode: (otp, remaining) => `🔑 <b>Your SIP Test Code</b>\n\n<code>${otp}</code>\n\nEnter this code on the call page to get your free SIP credentials.\n⏱ Expires in 5 minutes.\n📞 ${remaining} test call${remaining !== 1 ? 's' : ''} remaining.\n\n🌐 <a href="${CALL_PAGE_URL}">Open Call Page</a>\n\n💡 <b>Like it?</b> Tap <b>📞 Cloud IVR + SIP</b> below to get your own number with unlimited calls.`,
    sipTestComplete: `📞 <b>SIP Test Complete</b>\n\nYou've used your free test calls. To make unlimited SIP calls, subscribe to a <b>Cloud IVR</b> plan with SIP support.\n\n👉 Tap <b>📞 Cloud IVR + SIP</b> below to browse plans and get your own number with full SIP credentials.\n\n🌐 You can also make & receive calls directly in your browser at <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>`,
    sipTestReferral: (link) => `\n\n🎁 <b>Want 1 more free test call?</b>\nShare this link with a friend. When they send /testsip, you'll get a bonus call:\n\n${link}`,
    sipTestError: '❌ Could not generate test code. Please try again later.',
    sipTestMenuHint: '🆓 <b>Try a free SIP call now!</b> Send /testsip',
    tryBeforeYouBuy: `💡 <b>Did you know?</b> You can try a <b>free SIP test call</b> and a <b>free IVR trial call</b> before choosing a plan!\n\n🆓 Tap <b>🆓 Try SIP Call Free</b> to test calling in your browser\n📢 Tap <b>📢 Quick IVR Call</b> for a free IVR demo\n\nOr continue below to pick a plan 👇`,
    buyPlansHeader: `📞 <b>Choose Your Plan</b>`,
  },
  fr: {
    selectOption: 'Veuillez sélectionner une option.',
    selectValidCountry: 'Veuillez sélectionner un pays valide.',
    selectLocalOrTollFree: 'Veuillez sélectionner Local ou Sans frais.',
    selectValidArea: 'Veuillez sélectionner une zone ou utiliser Recherche.',
    enterValidAreaCode: 'Entrez un indicatif régional valide (ex: 415).',
    tapNumberToSelect: 'Tapez un numéro (1-5) pour sélectionner.',
    selectPlan: 'Veuillez sélectionner un forfait.',
    proceedOrBack: 'Procédez au paiement ou revenez en arrière.',
    selectByIndex: '💡 Touchez l\'un des indices (1, 2, 3…) dans le clavier ci-dessous — les numéros tapés ne fonctionnent pas à cette étape.',
    selectForwardMode: 'Sélectionnez un mode de transfert.',
    enterValidPhone: 'Entrez un numéro valide avec indicatif pays (ex: +14155551234).',
    enterValidEmail: 'Entrez une adresse email valide.',
    selectValidPlan: 'Sélectionnez un forfait valide.',
    noActiveNumbers: 'Aucun numéro actif. Achetez-en un d\'abord !',
    purchasingNumber: '🔄 Achat de votre numéro...',
    purchaseFailed: '❌ Échec de l\'achat. Votre portefeuille a été remboursé. Réessayez ou contactez le support.',
    bundleRequired: '📋 Ce pays nécessite une approbation réglementaire. L\'approbation prend généralement 1 à 3 jours ouvrables.',
    bundleSubmitted: '📋 Votre dossier réglementaire a été soumis. Vous serez notifié une fois approuvé.',
    confirmOrCancel: 'Veuillez confirmer ou annuler.',
    typeLast4: (digits) => `Tapez les 4 derniers chiffres : ${digits}`,
    noOptionForKey: (key) => `❌ Aucune option pour la touche "${key}".`,
    enterValidForwardTo: 'Fournissez un numéro valide. Ex: <code>1 forward +14155551234</code>',
    autoRenewToggled: (state) => `🔁 Renouvellement auto : ${state ? '✅ ACTIVÉ' : '❌ DÉSACTIVÉ'}`,
    vmTelegramToggled: (state) => `📲 Messagerie vocale Telegram : ${state ? '✅ ACTIVÉ' : '❌ DÉSACTIVÉ'}`,
    ringTimeUpdated: (seconds) => `✅ Durée de sonnerie : ${seconds} secondes.`,
    changePlanHeader: (number, plan, price) => `📦 Changer de forfait pour ${formatPhone(number)}\n\nActuel : ${plan.charAt(0).toUpperCase() + plan.slice(1)} — $${price}/mois`,
    planChanged: (plan, price) => `✅ Forfait changé : <b>${plan.charAt(0).toUpperCase() + plan.slice(1)}</b> — $${price}/mois`,
    featuresDisabled: 'Fonctionnalités désactivées :',
    noIvrOptions: 'Aucune option de menu IVR configurée.',
    whichKeyRemove: 'Quelle touche voulez-vous supprimer ?',
    sendVoiceOrText: 'Envoyez un message vocal, un fichier audio, ou tapez un texte personnalisé.',
    noActivity: 'Aucune activité pour le moment.',
    insufficientBalUpgrade: (needed, bal) => `❌ Solde insuffisant. Vous avez besoin de $${needed.toFixed(2)} mais n'avez que $${bal.toFixed(2)}.\n\nVeuillez recharger votre portefeuille.`,
    sipTestCode: (otp, remaining) => `🔑 <b>Votre code de test SIP</b>\n\n<code>${otp}</code>\n\nEntrez ce code sur la page d'appel pour obtenir vos identifiants SIP gratuits.\n⏱ Expire dans 5 minutes.\n📞 ${remaining} appel${remaining !== 1 ? 's' : ''} test restant${remaining !== 1 ? 's' : ''}.\n\n🌐 <a href="${CALL_PAGE_URL}">Ouvrir la page d'appel</a>\n\n💡 <b>Ça vous plaît ?</b> Appuyez sur <b>📞 Cloud IVR + SIP</b> pour obtenir votre propre numéro avec appels illimités.`,
    sipTestComplete: `📞 <b>Test SIP terminé</b>\n\nVous avez utilisé vos appels test gratuits. Pour des appels SIP illimités, souscrivez à un forfait <b>Cloud IVR</b> avec support SIP.\n\n👉 Appuyez sur <b>📞 Cloud IVR + SIP</b> pour parcourir les forfaits.\n\n🌐 Appelez depuis votre navigateur : <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>`,
    sipTestReferral: (link) => `\n\n🎁 <b>Voulez-vous 1 appel test gratuit de plus ?</b>\nPartagez ce lien avec un ami. Quand il enverra /testsip, vous obtiendrez un appel bonus :\n\n${link}`,
    sipTestError: '❌ Impossible de générer le code test. Veuillez réessayer.',
    sipTestMenuHint: '🆓 <b>Essayez un appel SIP gratuit !</b> Envoyez /testsip',
    tryBeforeYouBuy: `💡 <b>Le saviez-vous ?</b> Vous pouvez essayer un <b>appel SIP gratuit</b> et un <b>appel IVR d'essai</b> avant de choisir un forfait !\n\n🆓 Tapez <b>🆓 Essayer SIP Gratuit</b> pour tester\n📢 Tapez <b>📢 Appel IVR Rapide</b> pour une démo\n\nOu continuez ci-dessous 👇`,
    buyPlansHeader: `🛒 <b>Choisir un Forfait Cloud IVR</b>\n\nChoisissez d'abord votre forfait :`,
  },
  zh: {
    selectOption: '请选择一个选项。',
    selectValidCountry: '请选择一个有效的国家。',
    selectLocalOrTollFree: '请选择本地号码或免费号码。',
    selectValidArea: '请选择有效区域或使用搜索。',
    enterValidAreaCode: '输入有效的区号（如 415）。',
    tapNumberToSelect: '点击号码（1-5）进行选择。',
    selectPlan: '请选择一个套餐。',
    proceedOrBack: '请继续付款或返回。',
    selectByIndex: '💡 请点击下方键盘中的序号（1、2、3…）— 此步骤无法直接输入号码。',
    selectForwardMode: '选择转发模式。',
    enterValidPhone: '输入带国家代码的有效号码（如 +14155551234）。',
    enterValidEmail: '输入有效的电子邮件地址。',
    selectValidPlan: '选择有效的套餐。',
    noActiveNumbers: '没有活跃号码。请先购买一个！',
    purchasingNumber: '🔄 正在购买号码...',
    purchaseFailed: '❌ 购买失败。钱包已退款。请重试或联系客服。',
    bundleRequired: '📋 此国家需要监管审批。审批通常需要1-3个工作日。',
    bundleSubmitted: '📋 您的监管文件已提交审核。审批通过后将通知您。',
    confirmOrCancel: '请确认或取消。',
    typeLast4: (digits) => `输入最后4位数字：${digits}`,
    noOptionForKey: (key) => `❌ 未找到按键 "${key}" 的选项。`,
    enterValidForwardTo: '请提供有效的转发号码。例如：<code>1 forward +14155551234</code>',
    autoRenewToggled: (state) => `🔁 自动续费：${state ? '✅ 已开启' : '❌ 已关闭'}`,
    vmTelegramToggled: (state) => `📲 语音邮件转 Telegram：${state ? '✅ 已开启' : '❌ 已关闭'}`,
    ringTimeUpdated: (seconds) => `✅ 响铃时间已更新为 ${seconds} 秒。`,
    changePlanHeader: (number, plan, price) => `📦 更改 ${formatPhone(number)} 的套餐\n\n当前：${plan.charAt(0).toUpperCase() + plan.slice(1)} — $${price}/月`,
    planChanged: (plan, price) => `✅ 套餐已更改为 <b>${plan.charAt(0).toUpperCase() + plan.slice(1)}</b> — $${price}/月`,
    featuresDisabled: '已禁用的功能：',
    noIvrOptions: '尚未配置 IVR 菜单选项。',
    whichKeyRemove: '要删除哪个按键？',
    sendVoiceOrText: '发送语音消息、音频文件，或输入自定义问候语文本。',
    noActivity: '暂无活动记录。',
    insufficientBalUpgrade: (needed, bal) => `❌ 余额不足。需要 $${needed.toFixed(2)}，但仅有 $${bal.toFixed(2)}。\n\n请先充值。`,
    sipTestCode: (otp, remaining) => `🔑 <b>您的SIP测试码</b>\n\n<code>${otp}</code>\n\n在通话页面输入此代码以获取免费SIP凭据。\n⏱ 5分钟后过期。\n📞 剩余 ${remaining} 次测试通话。\n\n🌐 <a href="${CALL_PAGE_URL}">打开通话页面</a>\n\n💡 <b>喜欢吗？</b>点击 <b>📞 Cloud IVR + SIP</b> 获取您自己的号码和无限通话。`,
    sipTestComplete: `📞 <b>SIP测试完成</b>\n\n您已使用完免费测试通话。如需无限SIP通话，请订阅支持SIP的 <b>Cloud IVR</b> 套餐。\n\n👉 点击 <b>📞 Cloud IVR + SIP</b> 浏览套餐。\n\n🌐 在浏览器中拨打电话：<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>`,
    sipTestReferral: (link) => `\n\n🎁 <b>想要再获得1次免费测试通话？</b>\n将此链接分享给朋友。当他们发送 /testsip 时，您将获得一次额外通话：\n\n${link}`,
    sipTestError: '❌ 无法生成测试码。请稍后重试。',
    sipTestMenuHint: '🆓 <b>免费试用SIP通话！</b> 发送 /testsip',
    tryBeforeYouBuy: `💡 <b>您知道吗？</b>您可以在选择套餐之前试用<b>免费SIP测试通话</b>和<b>免费IVR试用通话</b>！\n\n🆓 点击 <b>🆓 免费试用SIP通话</b> 在浏览器中测试\n📢 点击 <b>📢 快速IVR呼叫</b> 免费体验\n\n或继续选择套餐 👇`,
    buyPlansHeader: `🛒 <b>选择云IVR套餐</b>\n\n请先选择您的套餐：`,
  },
  hi: {
    selectOption: 'कृपया एक विकल्प चुनें।',
    selectValidCountry: 'कृपया एक मान्य देश चुनें।',
    selectLocalOrTollFree: 'कृपया लोकल या टोल-फ्री चुनें।',
    selectValidArea: 'कृपया एक मान्य क्षेत्र चुनें या खोज का उपयोग करें।',
    enterValidAreaCode: 'एक मान्य एरिया कोड दर्ज करें (जैसे 415)।',
    tapNumberToSelect: 'चुनने के लिए नंबर (1-5) टैप करें।',
    selectPlan: 'कृपया एक प्लान चुनें।',
    proceedOrBack: 'भुगतान जारी रखें या वापस जाएं।',
    selectByIndex: '💡 नीचे कीबोर्ड में किसी एक इंडेक्स (1, 2, 3…) को टैप करें — इस चरण में टाइप किए गए नंबर काम नहीं करेंगे।',
    selectForwardMode: 'फॉरवर्डिंग मोड चुनें।',
    enterValidPhone: 'देश कोड के साथ मान्य नंबर दर्ज करें (जैसे +14155551234)।',
    enterValidEmail: 'एक मान्य ईमेल पता दर्ज करें।',
    selectValidPlan: 'एक मान्य प्लान चुनें।',
    noActiveNumbers: 'कोई सक्रिय नंबर नहीं। पहले एक खरीदें!',
    purchasingNumber: '🔄 आपका नंबर खरीदा जा रहा है...',
    purchaseFailed: '❌ खरीदारी विफल। वॉलेट में रिफंड हो गया। कृपया पुनः प्रयास करें या सपोर्ट से संपर्क करें।',
    bundleRequired: '📋 इस देश में नियामक अनुमोदन आवश्यक है। अनुमोदन में आमतौर पर 1-3 कार्य दिवस लगते हैं।',
    bundleSubmitted: '📋 आपका नियामक बंडल समीक्षा के लिए जमा किया गया है। अनुमोदन पर आपको सूचित किया जाएगा।',
    confirmOrCancel: 'कृपया पुष्टि करें या रद्द करें।',
    typeLast4: (digits) => `अंतिम 4 अंक टाइप करें: ${digits}`,
    noOptionForKey: (key) => `❌ कुंजी "${key}" के लिए कोई विकल्प नहीं मिला।`,
    enterValidForwardTo: 'एक मान्य फॉरवर्ड नंबर दें। उदा: <code>1 forward +14155551234</code>',
    autoRenewToggled: (state) => `🔁 ऑटो-रिन्यू: ${state ? '✅ चालू' : '❌ बंद'}`,
    vmTelegramToggled: (state) => `📲 वॉइसमेल टेलीग्राम: ${state ? '✅ चालू' : '❌ बंद'}`,
    ringTimeUpdated: (seconds) => `✅ रिंग टाइम ${seconds} सेकंड अपडेट।`,
    changePlanHeader: (number, plan, price) => `📦 ${formatPhone(number)} का प्लान बदलें\n\nवर्तमान: ${plan.charAt(0).toUpperCase() + plan.slice(1)} — $${price}/माह`,
    planChanged: (plan, price) => `✅ प्लान <b>${plan.charAt(0).toUpperCase() + plan.slice(1)}</b> — $${price}/माह में बदला`,
    featuresDisabled: 'अक्षम सुविधाएँ:',
    noIvrOptions: 'कोई IVR मेनू विकल्प कॉन्फ़िगर नहीं किया गया।',
    whichKeyRemove: 'कौन सी कुंजी हटानी है?',
    sendVoiceOrText: 'वॉइस मैसेज, ऑडियो फ़ाइल भेजें, या कस्टम ग्रीटिंग टेक्स्ट टाइप करें।',
    noActivity: 'अभी तक कोई गतिविधि नहीं।',
    insufficientBalUpgrade: (needed, bal) => `❌ अपर्याप्त बैलेंस। आपको $${needed.toFixed(2)} चाहिए लेकिन $${bal.toFixed(2)} है।\n\nकृपया पहले वॉलेट में रिचार्ज करें।`,
    sipTestCode: (otp, remaining) => `🔑 <b>आपका SIP टेस्ट कोड</b>\n\n<code>${otp}</code>\n\nमुफ्त SIP क्रेडेंशियल्स पाने के लिए कॉल पेज पर यह कोड दर्ज करें।\n⏱ 5 मिनट में समाप्त।\n📞 ${remaining} टेस्ट कॉल शेष।\n\n🌐 <a href="${CALL_PAGE_URL}">कॉल पेज खोलें</a>\n\n💡 <b>पसंद आया?</b> अपना खुद का नंबर और असीमित कॉल पाने के लिए <b>📞 Cloud IVR + SIP</b> दबाएं।`,
    sipTestComplete: `📞 <b>SIP टेस्ट पूरा</b>\n\nआपके मुफ्त टेस्ट कॉल समाप्त हो गए। असीमित SIP कॉल के लिए, SIP सपोर्ट वाला <b>Cloud IVR</b> प्लान लें।\n\n👉 प्लान देखने के लिए <b>📞 Cloud IVR + SIP</b> दबाएं।\n\n🌐 ब्राउज़र में कॉल करें: <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>`,
    sipTestReferral: (link) => `\n\n🎁 <b>1 और मुफ्त टेस्ट कॉल चाहिए?</b>\nयह लिंक किसी दोस्त को भेजें। जब वे /testsip भेजेंगे, आपको बोनस कॉल मिलेगा:\n\n${link}`,
    sipTestError: '❌ टेस्ट कोड जनरेट नहीं हो सका। कृपया बाद में पुनः प्रयास करें।',
    sipTestMenuHint: '🆓 <b>मुफ्त SIP कॉल आज़माएं!</b> /testsip भेजें',
    tryBeforeYouBuy: `💡 <b>क्या आप जानते हैं?</b> प्लान चुनने से पहले आप <b>मुफ्त SIP टेस्ट कॉल</b> और <b>मुफ्त IVR ट्रायल कॉल</b> आज़मा सकते हैं!\n\n🆓 <b>🆓 SIP कॉल मुफ्त आज़माएं</b> पर टैप करें\n📢 <b>📢 त्वरित IVR कॉल</b> पर टैप करें\n\nया प्लान चुनने के लिए आगे बढ़ें 👇`,
    buyPlansHeader: `🛒 <b>क्लाउड IVR प्लान चुनें</b>\n\nपहले अपना प्लान चुनें:`,
  },
}

// ── Translated button labels (for multilingual keyboards) ──
const btnI18n = {
  fr: {
    buyPhoneNumber: '🛒 Choisir un Forfait',
    myNumbers: '📋 Mes Forfaits',
    sipSettings: '📖 Guide SIP',
    usageBilling: '📊 Utilisation & Facturation',
    localNumber: '📍 Numéro Local',
    tollFreeNumber: '🆓 Numéro Gratuit',
    mobileNumber: '📱 Numéro Mobile',
    nationalNumber: '🌐 Numéro National',
    starterPlan: PHONE_STARTER_ON ? `💡 Starter — $${PHONE_STARTER_PRICE}/mois` : '💡 Starter — Bientôt 🔜',
    proPlan: PHONE_PRO_ON ? `⭐ Pro — $${PHONE_PRO_PRICE}/mois` : '⭐ Pro — Bientôt 🔜',
    businessPlan: PHONE_BUSINESS_ON ? `👑 Business — $${PHONE_BUSINESS_PRICE}/mois` : '👑 Business — Bientôt 🔜',
    callForwarding: '📞 Transfert d\'Appels',
    smsSettings: '📩 Paramètres SMS',
    smsInbox: '📨 Boîte SMS',
    voicemail: '🎙️ Messagerie Vocale',
    sipCredentials: '🔑 Identifiants SIP',
    callRecording: '🔴 Enregistrement d\'Appels',
    ivrAutoAttendant: '🤖 SVI / Standard Auto',
    callSmsLogs: '📊 Journaux Appels & SMS',
    testMyNumber: '📞 Tester mon numéro',
    testOutboundSip: '📤 Tester SIP sortant',
    renewChangePlan: '🔄 Renouveler / Changer',
    releaseNumber: '🗑️ Supprimer le Numéro',
    alwaysForward: '📞 Toujours Transférer',
    forwardBusy: '📵 Transférer si Occupé',
    forwardNoAnswer: '⏰ Transférer sans Réponse',
    disableForwarding: '🚫 Désactiver le Transfert',
    holdMusicOn: '🎵 Musique d\'Attente: OUI',
    holdMusicOff: '🎵 Musique d\'Attente: NON',
    smsToTelegram: '📲 SMS vers Telegram',
    smsToEmail: '📧 SMS par Email',
    smsWebhook: '🔗 URL Webhook',
    enableVoicemail: '✅ Activer Messagerie',
    disableVoicemail: '🚫 Désactiver Messagerie',
    vmGreeting: '🔊 Message d\'Accueil',
    vmCustomGreeting: '🎤 Accueil Personnalisé',
    vmDefaultGreeting: '🔄 Accueil Par Défaut',
    vmToTelegram: '📲 Envoyer sur Telegram',
    vmToEmail: '📧 Envoyer par Email',
    vmRingTime: '⏰ Temps de Sonnerie',
    revealPassword: '👁️ Révéler le Mot de Passe',
    resetPassword: '🔄 Réinitialiser le Mot de Passe',
    softphoneGuide: '📖 Guide SIP',
    renewNow: '🔄 Renouveler Maintenant',
    changePlan: '📦 Changer de Forfait',
    upgradeToPro: '⬆️ Passer à Pro',
    upgradeToBusiness: '⬆️ Passer à Business',
    autoRenew: '🔁 Renouvellement Auto',
    showMore: '🔄 Plus de Numéros',
    searchByArea: '🔍 Chercher par Zone',
    moreCountries: '🌍 Plus de Pays',
    applyCoupon: '🎟️ Appliquer un Coupon',
    proceedPayment: '✅ Procéder au Paiement',
    buyAnother: '🛒 Acheter un Autre Numéro',
    confirm: '✅ Confirmer',
    yesRelease: '⚠️ Oui, Supprimer Définitivement',
    noKeep: '↩️ Non, Garder',
    yesReset: 'Oui, Réinitialiser',
    enableIvr: '✅ Activer le SVI',
    disableIvr: '🚫 Désactiver le SVI',
    ivrGreeting: '🎤 Message d\'Accueil',
    ivrAddOption: '➕ Ajouter une Option',
    ivrRemoveOption: '➖ Supprimer une Option',
    ivrViewOptions: '📋 Voir les Options',
    ivrAnalytics: '📊 Analytiques SVI',
    ivrEditSubMenu: '🔧 Modifier Sous-Menu',
    ivrUseTemplate: '📋 Partir d\'un Modèle',
    ivrSaveTemplate: '💾 Enregistrer comme Modèle',
    enableRecording: '✅ Activer l\'Enregistrement',
    disableRecording: '🚫 Désactiver l\'Enregistrement',
    inboxNewerPage: '◀️ Plus Récent',
    inboxOlderPage: '▶️ Plus Ancien',
    inboxRefresh: '🔄 Actualiser',
    ivrOutboundCall: '📢 Appel IVR Rapide',
    ivrOutboundCallTrial: '📢 Appel IVR Rapide — 1 Gratuit',
    ivrOutboundBack: '↩️ Retour',
    bulkCallCampaign: '📞 Campagne IVR en Masse',
    audioLibrary: '🎵 Bibliothèque Audio',
    testSipFree: '🆓 Essayer SIP Gratuit',
    howItWorks: '❓ Comment ça marche',
    addNumber: '➕ Ajouter un Numéro au Forfait',
    back: 'Retour',
    cancel: 'Annuler',
  },
  zh: {
    buyPhoneNumber: '🛒 选择套餐',
    myNumbers: '📋 我的套餐',
    sipSettings: '📖 SIP 设置指南',
    usageBilling: '📊 使用量与账单',
    localNumber: '📍 本地号码',
    tollFreeNumber: '🆓 免费号码',
    mobileNumber: '📱 手机号码',
    nationalNumber: '🌐 全国号码',
    starterPlan: PHONE_STARTER_ON ? `💡 入门版 — $${PHONE_STARTER_PRICE}/月` : '💡 入门版 — 即将推出 🔜',
    proPlan: PHONE_PRO_ON ? `⭐ 专业版 — $${PHONE_PRO_PRICE}/月` : '⭐ 专业版 — 即将推出 🔜',
    businessPlan: PHONE_BUSINESS_ON ? `👑 商务版 — $${PHONE_BUSINESS_PRICE}/月` : '👑 商务版 — 即将推出 🔜',
    callForwarding: '📞 呼叫转移',
    smsSettings: '📩 短信设置',
    smsInbox: '📨 短信收件箱',
    voicemail: '🎙️ 语音信箱',
    sipCredentials: '🔑 SIP 凭据',
    callRecording: '🔴 通话录音',
    ivrAutoAttendant: '🤖 IVR / 自动应答',
    callSmsLogs: '📊 通话和短信记录',
    testMyNumber: '📞 测试我的号码',
    testOutboundSip: '📤 测试 SIP 外呼',
    renewChangePlan: '🔄 续费 / 更换套餐',
    releaseNumber: '🗑️ 删除号码',
    alwaysForward: '📞 始终转发',
    forwardBusy: '📵 忙时转发',
    forwardNoAnswer: '⏰ 无人接听时转发',
    disableForwarding: '🚫 关闭转发',
    holdMusicOn: '🎵 等待音乐: 开',
    holdMusicOff: '🎵 等待音乐: 关',
    smsToTelegram: '📲 短信转发到 Telegram',
    smsToEmail: '📧 短信转发到邮箱',
    smsWebhook: '🔗 Webhook URL',
    enableVoicemail: '✅ 启用语音信箱',
    disableVoicemail: '🚫 关闭语音信箱',
    vmGreeting: '🔊 问候语',
    vmCustomGreeting: '🎤 自定义语音问候',
    vmDefaultGreeting: '🔄 默认问候语',
    vmToTelegram: '📲 发送到 Telegram',
    vmToEmail: '📧 发送到邮箱',
    vmRingTime: '⏰ 响铃时间',
    revealPassword: '👁️ 显示密码',
    resetPassword: '🔄 重置密码',
    softphoneGuide: '📖 SIP 设置指南',
    renewNow: '🔄 立即续费',
    changePlan: '📦 更换套餐',
    upgradeToPro: '⬆️ 升级到专业版',
    upgradeToBusiness: '⬆️ 升级到商务版',
    autoRenew: '🔁 自动续费',
    showMore: '🔄 显示更多号码',
    searchByArea: '🔍 按区号搜索',
    moreCountries: '🌍 更多国家',
    applyCoupon: '🎟️ 使用优惠券',
    proceedPayment: '✅ 继续支付',
    buyAnother: '🛒 购买另一个号码',
    confirm: '✅ 确认',
    yesRelease: '⚠️ 是的，永久删除',
    noKeep: '↩️ 不，保留',
    yesReset: '是的，重置',
    enableIvr: '✅ 启用 IVR',
    disableIvr: '🚫 关闭 IVR',
    ivrGreeting: '🎤 设置问候语',
    ivrAddOption: '➕ 添加菜单选项',
    ivrRemoveOption: '➖ 删除选项',
    ivrViewOptions: '📋 查看菜单选项',
    ivrAnalytics: '📊 IVR 分析',
    ivrEditSubMenu: '🔧 编辑子菜单',
    ivrUseTemplate: '📋 从模板开始',
    ivrSaveTemplate: '💾 保存为模板',
    enableRecording: '✅ 启用录音',
    disableRecording: '🚫 关闭录音',
    inboxNewerPage: '◀️ 较新',
    inboxOlderPage: '▶️ 较旧',
    inboxRefresh: '🔄 刷新',
    ivrOutboundCall: '📢 快速IVR呼叫',
    ivrOutboundCallTrial: '📢 快速IVR呼叫 — 1次免费',
    ivrOutboundBack: '↩️ 返回',
    bulkCallCampaign: '📞 批量IVR活动',
    audioLibrary: '🎵 音频库',
    testSipFree: '🆓 免费试用SIP通话',
    howItWorks: '❓ 使用说明',
    addNumber: '➕ 添加号码到套餐',
    back: '返回',
    cancel: '取消',
  },
  hi: {
    buyPhoneNumber: '🛒 प्लान चुनें',
    myNumbers: '📋 मेरे प्लान',
    sipSettings: '📖 SIP सेटअप गाइड',
    usageBilling: '📊 उपयोग और बिलिंग',
    localNumber: '📍 लोकल नंबर',
    tollFreeNumber: '🆓 टोल-फ्री नंबर',
    mobileNumber: '📱 मोबाइल नंबर',
    nationalNumber: '🌐 नेशनल नंबर',
    starterPlan: PHONE_STARTER_ON ? `💡 स्टार्टर — $${PHONE_STARTER_PRICE}/माह` : '💡 स्टार्टर — जल्द आ रहा है 🔜',
    proPlan: PHONE_PRO_ON ? `⭐ प्रो — $${PHONE_PRO_PRICE}/माह` : '⭐ प्रो — जल्द आ रहा है 🔜',
    businessPlan: PHONE_BUSINESS_ON ? `👑 बिज़नेस — $${PHONE_BUSINESS_PRICE}/माह` : '👑 बिज़नेस — जल्द आ रहा है 🔜',
    callForwarding: '📞 कॉल फ़ॉरवर्डिंग',
    smsSettings: '📩 SMS सेटिंग्स',
    smsInbox: '📨 SMS इनबॉक्स',
    voicemail: '🎙️ वॉइसमेल',
    sipCredentials: '🔑 SIP क्रेडेंशियल्स',
    callRecording: '🔴 कॉल रिकॉर्डिंग',
    ivrAutoAttendant: '🤖 IVR / ऑटो-अटेंडेंट',
    callSmsLogs: '📊 कॉल और SMS लॉग',
    testMyNumber: '📞 मेरा नंबर परखें',
    testOutboundSip: '📤 आउटबाउंड SIP परखें',
    renewChangePlan: '🔄 नवीनीकरण / प्लान बदलें',
    releaseNumber: '🗑️ नंबर हटाएं',
    alwaysForward: '📞 हमेशा फ़ॉरवर्ड',
    forwardBusy: '📵 व्यस्त होने पर फ़ॉरवर्ड',
    forwardNoAnswer: '⏰ जवाब न होने पर फ़ॉरवर्ड',
    disableForwarding: '🚫 फ़ॉरवर्डिंग बंद करें',
    holdMusicOn: '🎵 होल्ड म्यूज़िक: चालू',
    holdMusicOff: '🎵 होल्ड म्यूज़िक: बंद',
    smsToTelegram: '📲 SMS टेलीग्राम पर',
    smsToEmail: '📧 SMS ईमेल पर',
    smsWebhook: '🔗 Webhook URL',
    enableVoicemail: '✅ वॉइसमेल चालू करें',
    disableVoicemail: '🚫 वॉइसमेल बंद करें',
    vmGreeting: '🔊 ग्रीटिंग',
    vmCustomGreeting: '🎤 कस्टम ग्रीटिंग (ऑडियो)',
    vmDefaultGreeting: '🔄 डिफ़ॉल्ट ग्रीटिंग',
    vmToTelegram: '📲 टेलीग्राम पर भेजें',
    vmToEmail: '📧 ईमेल पर भेजें',
    vmRingTime: '⏰ रिंग टाइम',
    revealPassword: '👁️ पासवर्ड दिखाएं',
    resetPassword: '🔄 पासवर्ड रीसेट करें',
    softphoneGuide: '📖 SIP सेटअप गाइड',
    renewNow: '🔄 अभी नवीनीकरण करें',
    changePlan: '📦 प्लान बदलें',
    upgradeToPro: '⬆️ प्रो में अपग्रेड करें',
    upgradeToBusiness: '⬆️ बिज़नेस में अपग्रेड करें',
    autoRenew: '🔁 ऑटो-रिन्यू',
    showMore: '🔄 और नंबर दिखाएं',
    searchByArea: '🔍 एरिया कोड से खोजें',
    moreCountries: '🌍 और देश',
    applyCoupon: '🎟️ कूपन लगाएं',
    proceedPayment: '✅ भुगतान करें',
    buyAnother: '🛒 और एक नंबर खरीदें',
    confirm: '✅ पुष्टि करें',
    yesRelease: '⚠️ हाँ, स्थायी रूप से हटाएं',
    noKeep: '↩️ नहीं, रखें',
    yesReset: 'हाँ, रीसेट करें',
    enableIvr: '✅ IVR चालू करें',
    disableIvr: '🚫 IVR बंद करें',
    ivrGreeting: '🎤 ग्रीटिंग सेट करें',
    ivrAddOption: '➕ विकल्प जोड़ें',
    ivrRemoveOption: '➖ विकल्प हटाएं',
    ivrViewOptions: '📋 विकल्प देखें',
    ivrAnalytics: '📊 IVR एनालिटिक्स',
    ivrEditSubMenu: '🔧 सब-मेनू संपादित करें',
    ivrUseTemplate: '📋 टेम्पलेट से शुरू करें',
    ivrSaveTemplate: '💾 टेम्पलेट के रूप में सेव करें',
    enableRecording: '✅ रिकॉर्डिंग चालू करें',
    disableRecording: '🚫 रिकॉर्डिंग बंद करें',
    inboxNewerPage: '◀️ नए',
    inboxOlderPage: '▶️ पुराने',
    inboxRefresh: '🔄 रिफ्रेश',
    ivrOutboundCall: '📢 त्वरित IVR कॉल',
    ivrOutboundCallTrial: '📢 त्वरित IVR कॉल — 1 मुफ्त',
    ivrOutboundBack: '↩️ वापस',
    bulkCallCampaign: '📞 बल्क IVR अभियान',
    audioLibrary: '🎵 ऑडियो लाइब्रेरी',
    testSipFree: '🆓 SIP कॉल मुफ्त आज़माएं',
    howItWorks: '❓ कैसे काम करता है',
    addNumber: '➕ प्लान में नंबर जोड़ें',
    back: 'वापस',
    cancel: 'रद्द करें',
  },
}

// Build reverse lookup: for any button value → which key it belongs to
const _allBtnValueToKey = {}
// Add English btn values
for (const [key, val] of Object.entries(btn)) {
  if (typeof val === 'string') _allBtnValueToKey[val] = key
}
// Add translated btn values
for (const [lang, labels] of Object.entries(btnI18n)) {
  for (const [key, val] of Object.entries(labels)) {
    if (typeof val === 'string') _allBtnValueToKey[val] = key
  }
}

/** Get full translated btn object for a language (falls back to English) */
function getBtn(lang) {
  if (!lang || lang === 'en') return btn
  const translations = btnI18n[lang]
  if (!translations) return btn
  return { ...btn, ...translations }
}

/** Get the translated button label for a specific key */
function getBtnLabel(key, lang) {
  if (!lang || lang === 'en') return btn[key]
  return btnI18n[lang]?.[key] || btn[key]
}

/** Check if a message matches ANY language variant of a button key */
function isBtnMatch(message, key) {
  if (message === btn[key]) return true
  for (const lang of Object.keys(btnI18n)) {
    if (btnI18n[lang][key] === message) return true
  }
  return false
}

/** Given a button value in any language, return its key name (or null) */
function btnKeyOf(message) {
  return _allBtnValueToKey[message] || null
}

// ── Translated txt (user-facing message texts) ──
const txtI18n = {
  fr: {
    hubWelcome: `📞 <b>Cloud IVR</b> <i>par Speechcue</i>

Obtenez un numéro virtuel dans plus de 30 pays — en moins de 2 minutes.

📞 Transférez les appels vers votre vrai téléphone
💬 Recevez les SMS directement dans Telegram
🌐 Appelez et recevez des appels dans votre navigateur — sans application
🤖 Configurez un standard automatique IVR
🔗 Connectez via un softphone SIP

Forfaits à partir de <b>$${PHONE_STARTER_PRICE}/mois</b> avec ${plans.starter.minutes} min entrantes + ${plans.starter.sms} SMS entrants inclus.
💳 Les appels sortants sont facturés depuis votre portefeuille.

Nouveau ? Appuyez sur <b>❓ Comment ça marche</b> pour un guide complet.`,

    howItWorks: `📞 <b>Cloud IVR — Comment ça marche</b>

Votre propre numéro virtuel dans plus de 30 pays. Recevez des appels, envoyez des SMS, créez des menus IVR — tout depuis Telegram.

<b>🚀 Pour commencer :</b>
1. Appuyez sur <b>🛒 Choisir un Forfait</b> → choisissez un pays → sélectionnez un numéro
2. Payez depuis votre portefeuille (crypto, banque ou carte)
3. Votre numéro est actif immédiatement

<b>📞 Ce que vous pouvez faire :</b>
• <b>Transférer les appels</b> vers votre vrai téléphone
• <b>SMS vers Telegram</b> — recevez les textos ici
• <b>Appels navigateur</b> — appelez/recevez à ${CALL_PAGE_URL} (sans appli)
• <b>Softphone SIP</b> — connectez avec n'importe quelle appli SIP
• <b>📢 Appel IVR Rapide</b> — appelez un numéro avec un message vocal
• <b>📞 Campagne IVR en Masse</b> — appelez des centaines de numéros
• <b>🤖 Standard Auto IVR</b> — menus "Appuyez 1 pour ventes, 2 pour support"
• <b>🎙️ Messagerie vocale</b> — messages personnalisés, livrés sur Telegram/Email

<b>💰 Facturation :</b>
• <b>Entrant</b> — appels & SMS inclus dans le forfait
• <b>Sortant</b> — appels & transferts facturés par minute depuis le portefeuille
• Renouvellement mensuel. Auto-renouvellement disponible.

<b>📋 Forfaits :</b>
💡 <b>Starter $${PHONE_STARTER_PRICE}/mois</b> — ${plans.starter.minutes} min, transfert + SMS vers Telegram
⭐ <b>Pro $${PHONE_PRO_PRICE}/mois</b> — ${plans.pro.minutes} min, + messagerie, SIP, IVR, OTP
👑 <b>Business $${PHONE_BUSINESS_PRICE}/mois</b> — ${BUSINESS_MINUTES} min, + enregistrement, standard auto

🧪 Essayez SIP gratuitement — appuyez sur <b>🧪 Tester SIP Gratuit</b>`,

    selectCountry: '📍 Sélectionnez le pays pour votre nouveau numéro :',
    searching: '🔍 Recherche de numéros disponibles...',
    noSearchResults: '❌ Aucun numéro disponible. Essayez une autre zone ou un autre pays.',
    noNumbers: '📱 Vous n\'avez pas encore de numéro.\n\nAppuyez ci-dessous pour obtenir votre premier numéro virtuel.',
    enterEmail: 'Entrez l\'adresse email pour recevoir les SMS :',
    enterWebhook: 'Entrez votre URL webhook (les SMS seront envoyés en JSON) :',
    ivrTrialUsed: (buyLabel) => `📢 <b>Appel IVR Sortant</b>\n\nVous avez déjà utilisé votre appel d'essai gratuit.\n\nAbonnez-vous à Cloud IVR pour des appels IVR illimités avec votre propre Caller ID !\n\nAppuyez sur <b>${buyLabel}</b> pour commencer.`,
    ivrTrialOffer: (callerId) => `📢 <b>Appel IVR Sortant — Essai Gratuit</b>\n\n🎁 Vous avez <b>1 appel d'essai gratuit !</b>\n📱 Caller ID: <b>${callerId}</b> (partagé)\n\nEntrez le numéro à appeler (avec indicatif pays) :\n<i>Exemple : +33612345678</i>`,
    ivrSelectCallerId: '📢 <b>Appel IVR Sortant</b>\n\nSélectionnez le numéro pour l\'appel (Caller ID) :',
    ivrEnterNumber: (phone) => `📱 Caller ID: <b>${phone}</b>\n\nEntrez le numéro à appeler (avec indicatif pays) :\n<i>Exemple : +33612345678</i>`,
    ivrFoundCnam: (name) => `📋 Trouvé : <b>${name}</b>`,
    ivrSelectCategory: (number) => `📞 Cible : <b>${number}</b>\n\nChoisissez une catégorie de modèle IVR :`,
    ivrCustomScript: `✍️ <b>Script Personnalisé</b>\n\nTapez votre message IVR. Utilisez des <b>[Crochets]</b> pour les variables :\n\n<i>Exemple : Bonjour [Nom]. Ici [Entreprise]. Un paiement de $[Montant] a été débité. Appuyez sur 1 pour contester.</i>\n\nTapez votre script :`,
    ivrEnterValue: (ph) => `Entrez la valeur pour <b>[${ph}]</b> :`,
    ivrValueSaved: (name, value, nextPh) => `✅ ${name} : <b>${value}</b>\n\nEntrez la valeur pour <b>[${nextPh}]</b> :`,
    ivrSelectVoiceProvider: '🎙 <b>Sélectionner le Fournisseur Vocal</b>\n\nChoisissez votre moteur TTS :',
    ivrSelectVoice: '🎤 <b>Sélectionner la Voix</b>\n\nChoisissez une voix pour l\'audio IVR :',
    ivrGeneratingPreview: (voice) => `🎤 Voix : <b>${voice}</b>\n\n⏳ Génération de l'aperçu audio...`,
    ivrHoldMusicStatus: (on) => `🎵 Musique d'Attente : <b>${on ? 'OUI' : 'NON'}</b>\n${on ? 'La cible entendra "Veuillez patienter" + musique avant le transfert.' : 'La cible entend la sonnerie standard pendant le transfert.'}`,
    ivrConfirmPrompt: 'Appuyez sur <b>✅ Confirmer</b> pour continuer, <b>🎤 Changer la Voix</b>, ou <b>Retour</b>.',
    ivrTemplatePreview: (icon, name, text, keys) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 Touches actives : <b>${keys}</b>`,
    bulkCallNoPlan: (buyLabel) => `📞 <b>Campagne IVR en Masse</b>\n\n🔒 Cette fonctionnalité nécessite le forfait <b>Pro</b> ou supérieur.\n\nObtenez d'abord un numéro Cloud IVR !\n\nAppuyez sur <b>${buyLabel}</b> pour commencer.`,
    bulkCallNoNumber: (buyLabel) => `📞 <b>Campagne IVR en Masse</b>\n\nVous avez besoin d'un numéro ☎️ capable IVR en masse.\n\nAppuyez sur <b>${buyLabel}</b> et choisissez un numéro avec le badge ☎️.`,
    bulkCallSelect: '📞 <b>Campagne d\'Appels en Masse</b>\n\nLancez des appels IVR automatisés vers plusieurs leads.\n\n☎️ = Numéros capables IVR en masse\n\n📱 Sélectionnez le Caller ID :',
    audioLibEmpty: '🎵 <b>Bibliothèque Audio</b>\n\nVous n\'avez pas de fichiers audio enregistrés.\n\nUploadez un fichier audio (MP3, WAV, OGG) pour les campagnes IVR.',
    audioLibTitle: (list) => `🎵 <b>Bibliothèque Audio</b>\n\n${list}\n\nUploadez un nouveau fichier ou supprimez-en un :`,
    audioUploadPrompt: '🎵 <b>Uploader Audio</b>\n\nEnvoyez-moi un fichier audio (MP3, WAV, OGG) ou un message vocal.\n\nIl sera sauvegardé dans votre bibliothèque pour les campagnes IVR.',
    audioSaved: (name) => `✅ Audio enregistré : <b>${name}</b>\n\nVous pouvez maintenant l'utiliser dans les Campagnes d'Appels en Masse !`,
    audioDeleted: (name) => `✅ Supprimé : <b>${name}</b>`,
    audioNamePrompt: (defaultName) => `✅ Audio reçu !\n\nDonnez-lui un nom :`,
    audioNamePromptLib: (size, defaultName) => `✅ Audio reçu ! (${size} KB)\n\nDonnez-lui un nom pour votre bibliothèque :`,
    audioLibEmptyShort: '🎵 <b>Bibliothèque Audio</b>\n\nAucun fichier audio. Uploadez-en un pour commencer.',
    vmRingPrompt: 'Combien de temps le téléphone doit-il sonner avant la messagerie vocale ?',
    enterValidUrl: 'Entrez une URL valide commençant par http:// ou https://.',
    enterAddress: (countryName, addrText) => `✅ Paiement reçu !\n\n📍 <b>${countryName}</b> nécessite une adresse de facturation pour activer le numéro.\nAdresse ${addrText || 'requise'}.\n\nVeuillez entrer votre adresse :\n<code>Rue, Ville, Pays</code>\n\n<i>Exemple : 123 Rue Principale, Paris, France</i>`,
    invalidAddress: '⚠️ Veuillez entrer au minimum : <code>Rue, Ville, Pays</code>\n\n<i>Exemple : 123 Rue Principale, Paris, France</i>',
    bulkUploadLeads: (phone) => `📱 Caller ID: <b>${phone}</b>\n\n📋 <b>Uploader les Leads</b>\n\nEnvoyez un fichier (.txt ou .csv) avec un numéro par ligne.\nOptionnel : <code>numéro,nom</code> par ligne.\n\nOu collez les numéros directement (un par ligne) :`,
    bulkLeadsLoaded: (count, preview, more, errNote) => `✅ <b>${count} leads chargés !</b>\n\n${preview}${more}${errNote}\n\n🎵 <b>Sélectionner Audio IVR</b>\n\nChoisissez un fichier audio, uploadez-en un, ou générez avec TTS :`,
    bulkTtsHint: '💡 Pour utiliser le TTS, générez d\'abord l\'audio via le flux <b>📢 Appel IVR Sortant</b>, ou uploadez un fichier audio.\n\nSélectionnez dans votre bibliothèque ou uploadez :',
    bulkAudioSelected: (name) => `🎵 Audio : <b>${name}</b>\n\n📋 <b>Mode de Campagne</b>\n\n🔗 <b>Transfert + Rapport</b> — Quand le lead appuie sur 1, pont vers votre SIP/téléphone + rapport\n📊 <b>Rapport Seul</b> — Suivi uniquement + rapport\n\nLes deux modes rapportent les résultats complets.`,
    bulkAudioSavedMode: (name) => `✅ Enregistré : <b>${name}</b>\n\n📋 <b>Mode de Campagne</b>\n\n🔗 <b>Transfert + Rapport</b> — Appuyer sur 1 fait le pont vers votre téléphone\n📊 <b>Rapport Seul</b> — Suivi uniquement\n\nLes deux modes rapportent les résultats.`,
    bulkTransferPrompt: '🔗 <b>Mode Transfert</b>\n\nEntrez le numéro pour transférer quand le lead appuie sur 1 :\n<i>(Votre numéro SIP ou tout numéro de téléphone)</i>',
    bulkConcurrency: (transferTo) => `${transferTo ? `🔗 Transfert vers : <b>${transferTo}</b>\n\n` : `📊 <b>Rapport Seul</b> — pas de transferts.\n\n`}⚡ <b>Concurrence</b>\n\nCombien d'appels simultanés ? (1-20)\nDéfaut : <b>10</b>`,
    bulkRunning: 'La campagne est en cours ! Vous verrez les mises à jour ici.\n\nAppuyez sur <b>🛑 Arrêter</b> pour annuler.',
    bulkCancelled: '🛑 <b>Campagne annulée.</b>\n\nLes appels actifs se termineront, aucun nouvel appel ne sera lancé.',
    // ── Phone number selection & management ──
    selectType: (country) => `📱 Sélectionnez le type de numéro pour <b>${country}</b> :\n\n<b>📍 Local</b> — Numéro géographique avec indicatif régional\n<b>🆓 Sans frais</b> — Préfixe 800/888/877, national`,
    selectArea: '🏙️ Sélectionnez la zone ou entrez votre indicatif régional :',
    enterAreaCode: 'Entrez l\'indicatif régional (ex : 415) :',
    showNumbers: (location, numbers) => {
      let text = `📞 Numéros disponibles à <b>${location}</b> :\n\n`
      numbers.forEach((n, i) => {
        const caps = n._capabilities || n.capabilities || {}
        const voice = caps.voice === true || caps.voice === 'True'
        const sms = caps.sms === true || caps.sms === 'True'
        const fax = caps.fax === true || caps.fax === 'True'
        let capLabel = ''
        if (voice) capLabel += '📞'
        if (sms) capLabel += '💬'
        if (fax) capLabel += '📠'
        text += `${i + 1}️⃣  ${formatPhone(n.phone_number)} ${capLabel}\n`
      })
      text += '\n📞 = Voix  💬 = SMS  📠 = Fax\nAppuyez sur un numéro pour le sélectionner.'
      return text
    },
    selectPlan: (number) => {
      let text = `✅ Sélectionné : <b>${formatPhone(number)}</b>\n\n📋 Choisissez votre forfait :\n\n`
      if (PHONE_STARTER_ON) text += `<b>💡 Starter — $${PHONE_STARTER_PRICE}/mois</b>\n📞 ${plans.starter.minutes} min entrantes · 📩 ${plans.starter.sms} SMS entrants · ${plansI18n.fr.starter.features.join(' · ')}\n<b>🎙 IVR / SIP :</b> ❌ <i>non inclus</i>\n🛡️ <i>Crédit de surclassement 14 jours — 25 % de remise sur Pro/Business si vous passez à un forfait supérieur dans les 14 jours</i>\n➕ Ajoutez jusqu'à ${SUB_NUMBER_LIMITS.starter} numéros supplémentaires (à partir de $${SUB_NUMBER_BASE_PRICE}/mois chacun)\n\n`
      if (PHONE_PRO_ON) text += `<b>⭐ Pro — $${PHONE_PRO_PRICE}/mois</b>\n📞 ${plans.pro.minutes} min entrantes · 📩 ${plans.pro.sms} SMS entrants · ${plansI18n.fr.pro.features.join(' · ')}\n<b>🎙 IVR / SIP :</b> ✅ <i>Quick IVR + Bulk IVR + OTP</i>\n🛡️ <i>Crédit de surclassement 14 jours — 25 % de remise sur Business si vous passez à un forfait supérieur dans les 14 jours</i>\n➕ Ajoutez jusqu'à ${SUB_NUMBER_LIMITS.pro} numéros supplémentaires (à partir de $${SUB_NUMBER_BASE_PRICE}/mois chacun)\n\n`
      if (PHONE_BUSINESS_ON) text += `<b>👑 Business — $${PHONE_BUSINESS_PRICE}/mois</b>\n📞 ${plans.business.minutes} min entrantes · 📩 ${plans.business.sms} SMS entrants · ${plansI18n.fr.business.features.join(' · ')}\n<b>🎙 IVR / SIP :</b> ✅ <i>Pro + Auto-Attendant + Enregistrement</i>\n➕ Ajoutez jusqu'à ${SUB_NUMBER_LIMITS.business} numéros supplémentaires (à partir de $${SUB_NUMBER_BASE_PRICE}/mois chacun)\n\n`
      text += `<i>📞 Les minutes du forfait sont pour les appels entrants uniquement.\n💳 Les appels sortants et transferts sont facturés depuis votre portefeuille.\n⚠️ Besoin d'IVR (Quick IVR, Bulk IVR, OTP, Auto-Attendant) ? Choisissez Pro ou Business — Starter n'inclut <b>pas</b> l'IVR.</i>`
      return text
    },
    orderSummary: (number, country, plan, price) => {
      const planKey = plan.name.toLowerCase()
      const features = plansI18n.fr[planKey]?.features || plan.features
      const ivrLine = planKey === 'starter'
        ? `\n\n<i>⚠️ Starter n'inclut <b>pas</b> l'IVR (Quick IVR, Bulk IVR, OTP, Auto-Attendant) ni les identifiants SIP. Besoin d'IVR ? Choisissez Pro ou Business.</i>`
        : ''
      const creditLine = planKey === 'starter'
        ? `\n<i>🛡️ Crédit de surclassement 14 jours — 25 % de remise si vous passez à Pro/Business dans les 14 jours</i>`
        : planKey === 'pro'
        ? `\n<i>🛡️ Crédit de surclassement 14 jours — 25 % de remise si vous passez à Business dans les 14 jours</i>`
        : ''
      return `📋 <b>Récapitulatif</b>\n\n📞 ${formatPhone(number)} · ${country}\n📦 ${plan.name} — $${price}/mois\n📩 ${plan.sms} SMS entrants · 📞 ${plan.minutes} min entrantes\n💳 Appels sortants et transferts facturés depuis le portefeuille\n⚡ ${features.join(', ')}\n\n💰 Total : <b>$${price}</b> (premier mois)${creditLine}${ivrLine}`
    },
    paymentPrompt: (price) => `Prix : <b>$${price}</b>. Choisissez le mode de paiement :`,
    activated: (number, plan, price, sipUser, sipDomain, expiry) => `🎉 <b>Votre Cloud IVR est Actif !</b>\n\n📞 Numéro : ${formatPhone(number)}\n📦 Forfait : ${plan} ($${price}/mois)\n📅 Renouvellement : ${expiry}\n\n━━━ <b>Identifiants SIP</b> ━━━\n🌐 Serveur : ${sipDomain}\n👤 Utilisateur : ${sipUser}\n🔑 Mot de passe : ●●●●●●●● (utilisez 🔑 Identifiants SIP pour révéler)\n📡 Port : 5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>Configuration Rapide</b> ━━━\n• Navigateur : Appelez sur <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>\n• Softphone : Téléchargez Zoiper/Ooma, entrez les identifiants SIP\n• SMS : Les SMS entrants sont transférés ici automatiquement\n• Transfert : Configurez via 📱 Mes Numéros → Transfert d'Appels`,
    myNumbersList: (numbers) => {
      let text = '📱 <b>Vos Numéros Cloud IVR :</b>\n\n'
      const primaryNumbers = numbers.filter(n => !n.isSubNumber)
      const subNumbers = numbers.filter(n => n.isSubNumber)
      primaryNumbers.forEach((n, i) => {
        const status = n.status === 'active' ? '✅ Actif' : n.status === 'suspended' ? '⚠️ Suspendu' : n.status === 'inactive_released' ? '🚫 Inactif (libéré par le fournisseur)' : '🗑️ Supprimé'
        text += `${i + 1}️⃣  ${formatPhone(n.phoneNumber)}  ${status}\n`
        text += `    Forfait ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} · Renouvellement ${shortDate(n.expiresAt)}\n`
        if (n.status === 'inactive_released') {
          const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
          text += `    <i>Suppression auto dans ~${hoursLeft}h · Contactez le support en cas d'erreur</i>\n`
        }
        const subs = subNumbers.filter(s => s.parentNumber === n.phoneNumber && (s.status === 'active' || s.status === 'suspended'))
        if (subs.length > 0) {
          subs.forEach(s => {
            const subStatus = s.status === 'active' ? '✅' : '⚠️'
            text += `    ├ ${formatPhone(s.phoneNumber)} ${subStatus} (ajouté · $${s.planPrice}/mois)\n`
          })
        }
        text += '\n'
      })
      return text
    },
    manageNumber: (n, subCount, subLimit, allNumbers) => {
      const plan = plans[n.plan] || (n.isSubNumber && n.parentNumber ? plans[allNumbers?.find(p => p.phoneNumber === n.parentNumber)?.plan] : null)
      const minLimit = plan?.minutes === 'Unlimited' ? 'Illimité' : (plan?.minutes || 0)
      const smsLimit = plan?.sms || 0
      let minUsed = n.minutesUsed || 0
      let smsUsed = n.smsUsed || 0
      if (allNumbers && allNumbers.length > 0) {
        if (n.isSubNumber && n.parentNumber) {
          const parent = allNumbers.find(p => p.phoneNumber === n.parentNumber && !p.isSubNumber)
          const siblings = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.parentNumber)
          minUsed = (parent?.minutesUsed || 0) + siblings.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (parent?.smsUsed || 0) + siblings.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        } else {
          const subs = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.phoneNumber)
          minUsed = (n.minutesUsed || 0) + subs.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (n.smsUsed || 0) + subs.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        }
      }
      const minDisplay = minLimit === 'Illimité' ? `${minUsed} (Illimité)` : `${minUsed} / ${minLimit}`
      const smsDisplay = `${smsUsed} / ${smsLimit}`
      const minWarning = minLimit !== 'Illimité' && minUsed >= minLimit ? `\n💰 <b>Dépassement actif</b> — $${OVERAGE_RATE_MIN}/min depuis le portefeuille` : ''
      const smsWarning = smsUsed >= smsLimit ? `\n💰 <b>Dépassement actif</b> — $${OVERAGE_RATE_SMS}/SMS depuis le portefeuille` : ''
      const hasSms = n.capabilities?.sms !== false && n.features?.sms !== false
      const hasFax = n.capabilities?.fax === true
      const hasVoice = n.capabilities?.voice !== false
      let text = `⚙️ Gestion : <b>${formatPhone(n.phoneNumber)}</b>`
      if (n.isSubNumber) text += ` <i>(numéro ajouté)</i>`
      if (n.status === 'inactive_released') {
        const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
        text += `\n\n🚫 <b>INACTIF — Libéré par le fournisseur</b>\nCe numéro a été supprimé par l'opérateur et ne peut plus passer ni recevoir d'appels.\nSuppression auto dans ~${hoursLeft}h.\n\nSi c'est une erreur, contactez le support immédiatement.`
        return text
      }
      if (n.isSubNumber) {
        text += `\n\nStatut : ${n.status === 'active' ? '✅ Actif' : '⚠️ ' + n.status}\nNuméro ajouté — $${n.planPrice}/mois (sous le forfait ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)})`
      } else {
        text += `\n\nStatut : ${n.status === 'active' ? '✅ Actif' : '⚠️ ' + n.status}\nForfait : ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} ($${n.planPrice}/mois)`
      }
      if (n.isSubNumber && n.parentNumber) text += `\n🔗 Parent : ${formatPhone(n.parentNumber)}`
      if (hasVoice) text += `\n📞 Minutes entrantes : ${minDisplay}${minWarning}`
      if (hasSms) text += `\n📩 SMS entrants : ${smsDisplay} (réception seule)${smsWarning}`
      if (hasFax) text += `\n📠 Fax : Inclus — fax entrants transférés vers Telegram`
      if (hasVoice) text += `\n💳 Appels sortants facturés depuis le portefeuille`
      const caps = []
      if (hasVoice) caps.push('Voix')
      if (hasSms) caps.push('SMS')
      if (hasFax) caps.push('Fax')
      text += `\n📋 Capacités : ${caps.join(' · ')}`
      if (!n.isSubNumber && subCount !== undefined && subLimit !== undefined) {
        text += `\n➕ Numéros ajoutés : ${subCount} / ${subLimit}`
      }
      if (n.features?.ivr?.enabled && Object.keys(n.features.ivr.options || {}).length === 0) {
        text += `\n\n⚠️ <b>SVI activé mais incomplet</b> — aucune option de menu. Les appelants ignoreront le menu et iront vers la messagerie. Touchez <b>🤖 SVI / Standard Auto</b> pour ajouter des options.`
      }
      if (hasVoice) text += `\n\n🌐 <a href="${CALL_PAGE_URL}">Appeler et recevoir dans le navigateur</a>`
      const lastChanged = formatRelativeTime(n.updatedAt, 'fr')
      if (lastChanged) text += `\n<i>🕒 Dernière modif. : ${lastChanged}</i>`
      return text
    },
    // ── Sub-number texts ──
    subNumberLimitReached: (plan, limit) => `⚠️ Vous avez atteint la limite de numéros ajoutés pour le forfait <b>${plan}</b> (${limit} numéros).\n\nPassez à un forfait supérieur pour plus de numéros.`,
    subNumberOrderSummary: (number, country, parentNumber, price, parentPlan) => `📋 <b>Commande Numéro Supplémentaire</b>\n\n📞 Nouveau : ${formatPhone(number)} · ${country}\n🔗 Ajouté à : ${formatPhone(parentNumber)} (Forfait ${parentPlan})\n💰 Prix : <b>$${typeof price === 'number' ? price.toFixed(2) : price}/mois</b>\n\n⚡ Partage les minutes & SMS du forfait parent\n🔑 Identifiants SIP propres inclus`,
    subActivated: (number, parentNumber, price, sipUser, sipDomain, expiry) => `🎉 <b>Numéro Supplémentaire Ajouté !</b>\n\n📞 Numéro : ${formatPhone(number)}\n🔗 Lié à : ${formatPhone(parentNumber)}\n💰 Prix : $${typeof price === 'number' ? price.toFixed(2) : price}/mois\n📅 Renouvellement : ${expiry}\n\n━━━ <b>Identifiants SIP</b> ━━━\n🌐 Serveur : ${sipDomain}\n👤 Utilisateur : ${sipUser}\n🔑 Mot de passe : ●●●●●●●● (utilisez 🔑 Identifiants SIP pour révéler)\n📡 Port : 5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>Configuration Rapide</b> ━━━\n• Navigateur : <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>\n• Softphone : Zoiper/Ooma avec identifiants SIP\n• Minutes & SMS partagés avec le forfait parent`,
    adminSubPurchase: (name, number, parentNumber, price, paymentMethod) => `➕ <b>Numéro Ajouté</b>\n👤 ${name}\n📞 ${formatPhone(number)} → ${formatPhone(parentNumber)}\n💰 $${price} · ${paymentMethod}`,
    adminSubPurchasePrivate: (name, number, parentNumber, price, paymentMethod) => `➕ <b>Numéro Ajouté</b>\n👤 ${name}\n📞 Nouveau : ${formatPhone(number)}\n🔗 Parent : ${formatPhone(parentNumber)}\n💰 $${price}/mois · ${paymentMethod}`,
    
    // Sub-number flow messages
    subAddNumberHeader: (plan, parentNumber) => `➕ <b>Ajouter un Numéro au Forfait ${plan.charAt(0).toUpperCase() + plan.slice(1)}</b>\n📞 Parent : ${formatPhone(parentNumber)}\n\n🌍 Sélectionnez le pays pour votre nouveau numéro :`,
    subNumbersAvailable: '📱 <b>Numéro Supplémentaire — Disponible</b>',
    subNumberArea: (area) => `📱 <b>Numéro Supplémentaire — Zone ${area}</b>`,
    subNumberSelected: (location) => `📱 <b>Numéro Supplémentaire — ${location}</b>`,
    bulkIvrSupport: '☎️ = Prend en charge IVR en Masse',
    tapToSelect: 'Tapez pour sélectionner :',
    
    // Call Forwarding
    forwardingStatus: (number, config, walletBal) => {
      const status = config?.enabled ? '✅ Actif' : '❌ Désactivé'
      let text = `📞 <b>Transfert d'Appels</b> — ${formatPhone(number)}\n\nStatut : ${status}`
      if (config?.enabled) {
        text += `\n📲 ${formatPhone(config.forwardTo)} · ${config.mode}`
        text += `\n🎵 Musique d'attente : ${config.holdMusic ? 'OUI' : 'NON'}`
      }
      const rate = config?.forwardTo && config.forwardTo.startsWith('+1') ? OVERAGE_RATE_MIN : CALL_FORWARDING_RATE_MIN
      text += `\n💳 Facturé depuis le portefeuille à $${rate}/min`
      if (walletBal !== undefined) text += ` · 💳 $${walletBal.toFixed(2)}`
      return text
    },
    enterForwardNumber: (walletBal) => {
      let text = `Entrez le numéro de transfert avec l'indicatif pays (ex : +14155551234)\n💰 Tarif : <b>$${CALL_FORWARDING_RATE_MIN}/min</b>`
      if (walletBal !== undefined) {
        text += ` · 💳 $${walletBal.toFixed(2)}`
        if (walletBal < CALL_FORWARDING_RATE_MIN) text += `\n⚠️ Rechargez <b>25$</b> via 👛 Portefeuille d'abord.`
      }
      return text
    },
    forwardingUpdated: (number, forwardTo, mode, walletBal) => {
      let text = `✅ <b>Transfert Actif</b>\n\n📞 ${formatPhone(number)} → ${formatPhone(forwardTo)}\n📋 ${mode} · $${CALL_FORWARDING_RATE_MIN}/min`
      if (walletBal !== undefined) {
        const estMin = Math.floor(walletBal / CALL_FORWARDING_RATE_MIN)
        text += `\n💳 $${walletBal.toFixed(2)} (~${estMin} min)`
        if (walletBal < 25) text += `\n💡 Rechargez à <b>25$</b> pour un transfert ininterrompu.`
      }
      return text
    },
    forwardingBlocked: (number) => `🚫 <b>Bloqué</b> — ${formatPhone(number)} est une destination premium.\nAppuyez sur 💬 <b>Support</b> pour demander l'activation.`,
    forwardingNotRoutable: (number) => `⚠️ ${formatPhone(number)} n'est pas routable. Vérifiez le numéro ou appuyez sur 💬 <b>Support</b>.`,
    forwardingInsufficientBalance: (walletBal) => `🚫 <b>Solde Insuffisant</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · Nécessaire $${CALL_FORWARDING_RATE_MIN}/min\n\n👉 Rechargez <b>25$</b> via 👛 Portefeuille pour activer le transfert.`,
    forwardingDisabled: (number) => `✅ Transfert désactivé pour ${formatPhone(number)}.`,
    // SMS Settings
    smsSettingsMenu: (number, config, plan) => {
      const tg = config?.toTelegram ? '✅ OUI' : '❌ NON'
      const em = config?.toEmail ? '✅ ' + config.toEmail : '❌ NON'
      const wh = config?.webhookUrl ? '✅ Configuré' : '❌ Non configuré'
      const canEmail = canAccessFeature(plan, 'smsToEmail')
      const canWebhook = canAccessFeature(plan, 'smsWebhook')
      const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Inconnu'
      return `📩 <b>Paramètres SMS Entrants</b> pour <b>${formatPhone(number)}</b>\n\n📌 Les SMS sont <b>entrants uniquement</b> — vous recevez les SMS mais ne pouvez pas en envoyer.\n\n📲 Transférer sur Telegram : ${tg}\n📧 Transférer par Email : ${canEmail ? em : `🔒 Nécessite le forfait Pro ou supérieur (actuel : ${planName})`}\n🔗 URL Webhook : ${canWebhook ? wh : `🔒 Nécessite le forfait Pro ou supérieur (actuel : ${planName})`}`
    },
    smsToggled: (channel, state) => `${channel} est maintenant ${state ? '✅ ACTIVÉ' : '❌ DÉSACTIVÉ'}`,
    // Fax Settings
    faxSettingsMenu: (number, config, provider) => {
      const tg = config?.toTelegram !== false ? '✅ OUI' : '❌ NON'
      if (provider === 'twilio') {
        return `📠 <b>Paramètres Fax</b> pour <b>${formatPhone(number)}</b>\n\n⚠️ <b>Le fax n'est pas disponible pour ce type de numéro.</b>\nLe fournisseur a arrêté le service fax. Les fax entrants ne peuvent pas être reçus.\n\nPour utiliser le fax, achetez un numéro compatible fax auprès d'un fournisseur pris en charge.`
      }
      return `📠 <b>Paramètres Fax</b> pour <b>${formatPhone(number)}</b>\n\nLes fax entrants sont reçus en PDF et transférés sur ce chat Telegram.\n\n📲 Transférer sur Telegram : ${tg}`
    },
    faxToggled: (state) => `📠 Fax vers Telegram est maintenant ${state ? '✅ OUI' : '❌ NON'}`,
    faxReceived: (from, to, pages) => `📠 <b>Fax Reçu</b>\nDe : ${from}\nÀ : ${formatPhone(to)}${pages ? `\nPages : ${pages}` : ''}`,
    faxFailed: (from, to, reason) => `📠 <b>Échec du Fax</b>\nDe : ${from}\nÀ : ${formatPhone(to)}\nRaison : ${reason || 'Inconnue'}`,
    enterEmail: 'Entrez l\'adresse email pour transférer les SMS :',
    emailSet: (email) => `✅ SMS par email activé !\nTous les SMS entrants seront aussi envoyés à <b>${email}</b>.`,
    enterWebhook: 'Entrez votre URL webhook (les SMS entrants seront envoyés en JSON) :',
    webhookSet: (url) => `✅ URL Webhook configurée !\nLes SMS seront envoyés à : ${url}`,
    // Voicemail
    voicemailMenu: (number, config) => {
      if (!config?.enabled) {
        return `🎙️ Messagerie vocale pour <b>${formatPhone(number)}</b>\n\nStatut : ❌ Désactivée\n\nLorsqu'elle est activée, les appels sans réponse entendront un message d'accueil et les appelants pourront laisser un message.`
      }
      const tg = config.forwardToTelegram ? '✅ OUI' : '❌ NON'
      const em = config.forwardToEmail ? '✅ ' + config.forwardToEmail : '❌ NON'
      let greetInfo = ''
      if (config.greetingType === 'custom' && config.customAudioGreetingUrl) {
        greetInfo = '🎤 Audio personnalisé'
      } else if (config.greetingType === 'custom' && config.customGreetingText) {
        greetInfo = `📝 Personnalisé : "${config.customGreetingText}"`
      } else {
        greetInfo = '🔊 Par défaut : "Vous avez joint le ' + formatPhone(number) + '. Veuillez laisser un message après le bip."'
      }
      return `🎙️ Messagerie vocale pour <b>${formatPhone(number)}</b>\n\nStatut : ✅ Activée\n🎤 Message : ${greetInfo}\n\n📲 Envoyer sur Telegram : ${tg}\n📧 Envoyer par Email : ${em}\n⏰ Temps de sonnerie : ${config.ringTimeout || 25}s`
    },
    voicemailEnabled: (number) => `✅ Messagerie vocale activée pour ${formatPhone(number)} !\nLes enregistrements seront envoyés sur ce chat Telegram.`,
    voicemailDisabled: (number) => `✅ Messagerie vocale désactivée pour ${formatPhone(number)}.`,
    vmGreetingMenu: (number, vm) => {
      let current = ''
      if (vm?.greetingType === 'custom' && vm?.customAudioGreetingUrl) {
        current = '🎤 Audio personnalisé\n📎 Fichier audio chargé'
      } else if (vm?.greetingType === 'custom' && vm?.customGreetingText) {
        current = `📝 Texte personnalisé : "${vm.customGreetingText}"`
      } else {
        current = `🔊 Par défaut : "Vous avez joint le ${formatPhone(number)}. Veuillez laisser un message après le bip."`
      }
      return `🔊 <b>Message d'Accueil</b> pour <b>${formatPhone(number)}</b>\n\nActuel : ${current}\n\nChoisissez une option :`
    },
    vmSendAudioPrompt: '🎤 <b>Message Audio Personnalisé</b>\n\nEnvoyez un message vocal ou un fichier audio comme message d\'accueil.\n\nLes appelants entendront cet audio quand ils atteindront votre messagerie.\n\n<i>Conseil : Enregistrez un message professionnel comme "Bonjour, vous avez joint [nom]. Je ne peux pas répondre pour le moment. Laissez un message après le bip."</i>',
    vmAudioSaved: '✅ Message audio personnalisé enregistré ! Les appelants entendront maintenant votre message.',
    vmDefaultRestored: '✅ Message d\'accueil réinitialisé au texte par défaut.',
    vmTextGreetingPrompt: 'Entrez un texte de message d\'accueil personnalisé (sera lu par synthèse vocale) :',
    vmTextGreetingSet: (text) => `✅ Message texte personnalisé enregistré !\n\n"${text}"`,
    // SIP
    sipCredentialsMsg: (number, username, domain) => `🔑 Identifiants SIP pour <b>${formatPhone(number)}</b>\n\n🌐 Serveur SIP : ${domain}\n👤 Utilisateur : <code>${username}</code>\n🔑 Mot de passe : ●●●●●●●●\n📡 Ports : 5060 (UDP/TCP) · 5061 (TLS)\n🎵 Codecs : G.711μ, G.711a, Opus`,
    sipRevealed: (password) => `🔑 Mot de passe : <code>${password}</code>\n\n⚠️ Sauvegardez maintenant — ce message sera supprimé dans 30 secondes.`,
    sipReset: (password) => `✅ Mot de passe SIP réinitialisé !\n\n🔑 Nouveau mot de passe : <code>${password}</code>\n\n⚠️ Sauvegardez maintenant. Mettez à jour ce mot de passe sur tous vos appareils SIP.`,
    softphoneGuide: (domain) => `📖 <b>Guide de Configuration SIP</b>

<b>🌐 Navigateur (Le plus simple)</b>
Appelez directement depuis votre navigateur :
<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>
Aucune inscription ni application nécessaire.

<b>📱 Apps Softphone — Recommandé</b>
Utilisez un softphone mono-ligne (un appareil par identifiant) :
• <b>Linphone</b> — iOS / Android / Mac / Windows / Linux (gratuit)
• <b>Zoiper</b> — iOS / Android / Bureau (gratuit)
• <b>MicroSIP</b> — Windows (gratuit, léger)
• <b>Bria Solo</b> — payant, interface soignée

<b>Étapes</b>
1. Installer l'app
2. Ajouter un compte → SIP / VoIP
3. Nom d'utilisateur + mot de passe depuis 🔑 Identifiants SIP
4. Domaine / Serveur SIP : <code>${domain}</code>
5. Port 5060 (UDP/TCP) ou 5061 (TLS) · DTMF : RFC 2833 · Codec : G.711μ
6. Enregistrez et faites un appel test

⚠️ <b>Vous utilisez 3CX, FreePBX, Asterisk ou un autre PBX ?</b>
N'ajoutez pas l'identifiant SIP comme "utilisateur / extension" — un PBX répond à l'appel et l'envoie directement vers sa propre messagerie (vous entendrez "Record your message and press pound, or press star to contact the operator", puis "transfer failed" sur étoile). Configurez-le comme <b>TRUNK SIP</b> :

<b>Exemple 3CX</b>
1. SIP Trunks → Add SIP Trunk → "Generic SIP Trunk"
2. Main Trunk No. : votre numéro Nomadly (ex. <code>+18882437690</code>)
3. Registrar / Serveur / Outbound Proxy : <code>${domain}</code> · Port <code>5060</code>
4. Authentification : <b>Register/Account based</b>
   Username + Auth ID : votre identifiant SIP <code>gencred…</code>
   Mot de passe : votre mot de passe SIP
5. Enregistrer → Inbound Rules → New Inbound Rule → <b>Router vers votre extension</b> (PAS messagerie)
6. Outbound Rules → routez vos extensions via ce trunk
7. Appliquer &amp; recharger — faites un appel test

🧪 <b>Appels test gratuits :</b>
Envoyez /testsip ici pour obtenir votre code test.

❓ Bloqué ? Touchez 💬 Support, nous vous aiderons.`,
    // Renew
    renewMenu: (number, plan, price, expiry, autoRenewOn) => `🔄 Forfait pour <b>${formatPhone(number)}</b>\n\nForfait actuel : ${plan} — $${price}/mois\nDate de renouvellement : ${shortDate(expiry)}\nRenouvellement auto : ${autoRenewOn ? '✅ OUI' : '❌ NON'}`,
    // Delete
    releaseConfirm: (number) => `🗑️ <b>Supprimer ${formatPhone(number)} ?</b>\n\n⚠️ <b>Cette action est irréversible.</b>\n\n• Numéro supprimé définitivement\n• Forfait mensuel annulé immédiatement\n• Tous les paramètres supprimés\n• Aucun remboursement pour les jours restants\n\nÊtes-vous sûr ?`,
    releaseConfirmDigits: (digits) => `⚠️ <b>Confirmation finale</b>\n\nTapez les 4 derniers chiffres du numéro pour le supprimer : <b>${digits}</b>`,
    released: (number) => `✅ ${formatPhone(number)} a été supprimé définitivement.\n\nForfait annulé. Tous les paramètres supprimés.`,
    // Real-time events
    inboundSms: (to, from, body, time) => `📩 <b>SMS Reçu</b>\n\n📞 À : ${formatPhone(to)}\n👤 De : ${formatPhone(from)}\n🕐 ${time}\n\n💬 "${body}"`,
    missedCall: (to, from, time) => `📞 <b>Appel Manqué</b>\n\n📞 À : ${formatPhone(to)}\n👤 De : ${formatPhone(from)}\n🕐 ${time}`,
    callForwarded: (to, from, forwardedTo, duration, time) => `📞 <b>Appel Transféré</b>\n\n📞 À : ${formatPhone(to)}\n👤 De : ${formatPhone(from)}\n📲 Transféré : ${formatPhone(forwardedTo)}\n⏱️ Durée : ${formatDuration(duration)}\n🕐 ${time}`,
    newVoicemail: (to, from, duration, time) => `🎙️ <b>Nouveau Message Vocal</b>\n\n📞 À : ${formatPhone(to)}\n👤 De : ${formatPhone(from)}\n⏱️ Durée : ${formatDuration(duration)}\n🕐 ${time}`,
    // Expiry
    expiryReminder: (number, days, plan, price, balance) => `🔔 <b>Rappel de Renouvellement</b>\n\nVotre numéro ${formatPhone(number)} (Forfait ${plan}) expire dans <b>${days} jour${days !== 1 ? 's' : ''}</b>.\n\nSolde portefeuille : $${balance}\nPrix du forfait : $${price}/mois${balance < price ? '\n\n⚠️ Solde insuffisant. Veuillez recharger.' : ''}`,
    autoRenewed: (number, plan, price, newExpiry, oldBal, newBal) => `✅ <b>Renouvellement Automatique Réussi</b>\n\n📞 ${formatPhone(number)}\n📦 Forfait : ${plan} ($${price}/mois)\n📅 Nouvelle expiration : ${shortDate(newExpiry)}\nPortefeuille : $${oldBal} → $${newBal}`,
    autoRenewFailed: (number, plan, price, balance) => `❌ <b>Échec du Renouvellement Automatique</b>\n\n📞 ${formatPhone(number)}\n📦 Forfait : ${plan} ($${price}/mois)\n💰 Portefeuille : $${balance} (nécessaire $${price})\n\n⚠️ Votre numéro est maintenant SUSPENDU. Rechargez et renouvelez sous 7 jours.`,
    // IVR
    ivrMenu: (number, config) => {
      if (!config?.enabled) {
        return `🤖 <b>SVI / Standard Auto</b> pour <b>${formatPhone(number)}</b>\n\nStatut : ❌ Désactivé\n\nLorsqu'il est activé, les appelants entendent un menu d'accueil et peuvent appuyer sur des touches pour atteindre la bonne destination.`
      }
      const hasOptions = config.options && Object.keys(config.options).length > 0
      let text = `🤖 <b>SVI / Standard Auto</b> pour <b>${formatPhone(number)}</b>\n\nStatut : ${hasOptions ? '✅ Activé' : '⚠️ Activé (incomplet)'}\n\n🎤 Message : "${escapeHtml(config.greeting || 'Par défaut')}"\n\n📋 <b>Options du Menu :</b>\n`
      if (hasOptions) {
        Object.entries(config.options).forEach(([key, opt]) => {
          let desc
          if (opt.action === 'forward') desc = '📲 Transférer vers ' + formatPhone(opt.forwardTo)
          else if (opt.action === 'voicemail') desc = '🎙️ Messagerie vocale'
          else if (opt.action === 'submenu') {
            const subCount = Object.keys(opt.subMenu?.options || {}).length
            const lbl = opt.label && opt.label.trim() ? opt.label.trim() : `Sous-Menu ${key}`
            desc = `📂 <b>${escapeHtml(lbl)}</b> — sous-menu (${subCount} option${subCount === 1 ? '' : 's'})`
          } else desc = '🔊 ' + escapeHtml(opt.message || 'Lire le message')
          text += `  Appuyez <b>${escapeHtml(key)}</b> → ${desc}\n`
        })
      } else {
        text += '  ⚠️ <b>Aucune option ajoutée — le SVI ne se déclenchera pas.</b>\n  Les appelants ignoreront le menu et iront directement à la messagerie vocale (ou entendront "indisponible" si la messagerie est désactivée).\n  Appuyez sur <b>➕ Ajouter une Option</b> ci-dessous pour en ajouter au moins une (ex. <code>1 forward +14155551234</code>).\n'
      }
      return text
    },
    ivrEnabled: (number) => `✅ SVI / Standard auto activé pour ${formatPhone(number)} !\n\nLes appelants entendront votre message d'accueil et pourront naviguer avec les touches.`,
    ivrDisabled: (number) => `✅ SVI / Standard auto désactivé pour ${formatPhone(number)}.`,
    ivrSetGreeting: 'Entrez le message d\'accueil du SVI (ce que les appelants entendront) :\n\nExemple : "Merci d\'appeler. Appuyez sur 1 pour le support, sur 2 pour les ventes, ou restez en ligne."',
    ivrGreetingSet: (greeting) => `✅ Message d'accueil du SVI mis à jour !\n\n"${greeting}"`,
    ivrAddOption: 'Entrez la touche et l\'action dans ce format :\n\n<code>TOUCHE ACTION DESTINATION</code>\n\nExemples :\n• <code>1 forward +14155551234</code>\n• <code>2 voicemail</code>\n• <code>3 message Nous vous rappellerons</code>\n• <code>0 forward +14155559999</code>',
    ivrOptionAdded: (key, action, destination) => `✅ Option SVI ajoutée !\n\nAppuyez <b>${key}</b> → ${action === 'forward' ? '📲 Transférer vers ' + formatPhone(destination) : action === 'voicemail' ? '🎙️ Messagerie vocale' : '🔊 ' + destination}`,
    ivrOptionRemoved: (key) => `✅ Option SVI pour la touche <b>${key}</b> supprimée.`,
    ivrInvalidFormat: '❌ Format invalide. Utilisez :\n<code>TOUCHE ACTION DESTINATION</code>\n\nExemple : <code>1 forward +14155551234</code>',
    ivrAnalyticsReport: (number, data, labels) => {
      let text = `📊 <b>Analytiques SVI</b> pour <b>${formatPhone(number)}</b>\n(30 derniers jours)\n\n`
      text += `📞 Total appels SVI : <b>${data.totalCalls}</b>\n`
      const _labelFor = (d) => (labels && labels[d]) ? ` <i>(${escapeHtml(labels[d])})</i>` : ''
      if (data.topOption) text += `🏆 Plus pressée : Touche <b>${escapeHtml(data.topOption.digit)}</b>${_labelFor(data.topOption.digit)} (${data.topOption.count} fois, ${data.topOption.percent}%)\n`
      text += '\n'
      if (data.optionBreakdown.length > 0) {
        text += '📋 <b>Répartition :</b>\n'
        data.optionBreakdown.forEach(o => {
          const bar = '█'.repeat(Math.max(1, Math.round(o.percent / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(o.percent / 10)))
          text += `  Touche <b>${escapeHtml(o.digit)}</b>${_labelFor(o.digit)} : ${bar} ${o.count} (${o.percent}%)\n`
        })
        text += '\n'
      }
      if (data.recentCalls.length > 0) {
        text += '📱 <b>Appels SVI Récents :</b>\n'
        data.recentCalls.forEach(c => {
          text += `  ${formatPhone(c.from)} → Touche <b>${escapeHtml(c.digit)}</b>${_labelFor(c.digit)} (${escapeHtml(c.action)}) ${shortDate(c.time)}\n`
        })
      }
      if (data.totalCalls === 0) text += '\nAucun appel SVI enregistré.'
      return text
    },
    // Recording
    recordingMenu: (number, config) => {
      const enabled = config?.recording === true
      return `🔴 <b>Enregistrement d'Appels</b> pour <b>${formatPhone(number)}</b>\n\nStatut : ${enabled ? '✅ Activé' : '❌ Désactivé'}\n\nLorsqu'il est activé, tous les appels entrants et sortants sont automatiquement enregistrés. Les enregistrements sont envoyés sur votre chat Telegram.`
    },
    recordingEnabled: (number) => `✅ Enregistrement d'appels activé pour ${formatPhone(number)} !\n\nTous les appels seront enregistrés et envoyés sur ce chat.`,
    recordingDisabled: (number) => `✅ Enregistrement d'appels désactivé pour ${formatPhone(number)}.`,
    // SMS Inbox
    smsInboxHeader: (number, total) => `📨 <b>Boîte SMS</b> pour <b>${formatPhone(number)}</b>\n\n${total === 0 ? 'Aucun message reçu.' : `${total} message${total > 1 ? 's' : ''} reçu${total > 1 ? 's' : ''} :`}`,
    smsInboxEntry: (i, from, name, body, time) => {
      const nameDisplay = name && name !== 'None' ? ` (${name})` : ''
      const bodyPreview = body.length > 80 ? body.substring(0, 80) + '...' : body
      return `\n<b>${i}.</b> ${formatPhone(from)}${nameDisplay}\n   💬 "${bodyPreview}"\n   🕐 ${time}\n`
    },
    smsInboxEmpty: 'Aucun SMS entrant reçu pour ce numéro.\n\n<i>Quand quelqu\'un envoie un SMS à votre numéro, les messages apparaîtront ici.</i>',
    smsInboxFooter: (page, totalPages) => totalPages > 1 ? `\n📄 Page ${page}/${totalPages}` : '',
    btnUploadAudio: '📎 Uploader Audio',
    btnConfirm: '✅ Confirmer',
    btnChangeVoice: '🎤 Changer la Voix',
    btnTransferReport: '🔗 Transfert + Rapport',
    btnReportOnly: '📊 Rapport Seul',
    btnStopCampaign: '🛑 Arrêter la Campagne',
    btnShowStatus: '📊 Afficher le Statut',
    btnUploadNewAudio: '📎 Uploader Nouveau',
    btnBack: '↩️ Retour',
    testMyNumber: {
      placing: (phone) => `📞 Appel vers <code>${phone}</code> depuis une ligne de test Nomadly… décrochez sur votre softphone et appuyez sur <b>1</b> quand ça sonne (vous avez ~12 secondes après décrochage).\n\nLe résultat apparaîtra ici dans les 60 secondes.`,
      successDtmf: (phone) => `✅ <b>Votre appareil SIP a répondu</b> — les appels vers <code>${phone}</code> fonctionnent de bout en bout. Le destinataire a répondu et une touche a été pressée.`,
      voicemail: (phone) => `⚠️ <b>Messagerie vocale / PBX a répondu</b> sur <code>${phone}</code>.\n\nCela signifie généralement qu'un PBX (3CX, FreePBX, Asterisk…) répond et bascule l'appel vers sa propre messagerie au lieu de faire sonner votre extension.\n\nSolution : ouvrez /sipguide pour la configuration SIP TRUNK, ou passez à un softphone monoligne (Linphone, Zoiper) pour une solution immédiate.`,
      answeredNoDtmf: (phone) => `⚠️ <b>Appel répondu, mais aucune touche pressée</b> sur <code>${phone}</code> dans les 12 secondes.\n\nSi vous n'avez pas décroché, votre softphone ne reçoit peut-être pas l'appel. Si vous avez décroché mais pas appuyé sur 1, réessayez. Si un PBX (3CX/FreePBX) est impliqué, consultez /sipguide pour la configuration SIP TRUNK.`,
      noAnswer: (phone) => `❌ <b>Pas de réponse</b> sur <code>${phone}</code>.\n\nAssurez-vous que votre softphone (Linphone / Zoiper / trunk 3CX) est enregistré et en ligne, puis relancez le test. Ouvrez /sipguide pour l'aide à la configuration.`,
      throttled: (max) => `⏳ Vous avez déjà effectué ${max} tests sur ce numéro dans les dernières 24 heures. Patientez avant de retester.`,
      inactive: (phone) => `❌ Le numéro <code>${phone}</code> n'est pas actif — le test est réservé aux numéros actifs.`,
      placeFailed: (err) => `❌ Impossible de passer l'appel de test : ${err}`,
    },
    testOutboundSip: {
      listening: (phone, sipUser) => `📤 <b>Test SIP sortant — écoute pendant 90s</b>\n\n📞 Numéro : <code>${phone}</code>\n🔑 Utilisateur SIP : <code>${sipUser}</code>\n\nDepuis votre softphone, composez <b>n'importe quel numéro</b> dans les 90 prochaines secondes — votre propre mobile est idéal.\n\n💡 L'appel sera intercepté en toute sécurité : <b>aucun débit du portefeuille</b>, <b>aucune branche PSTN</b> ne sera établie. Nous vérifions simplement que le chemin sortant de votre softphone atteint nos serveurs avec les bons identifiants SIP.\n\nLe résultat apparaîtra dès que votre appel arrivera.`,
      success: (phone, sipUser, provider, destination, elapsedSec) => `✅ <b>SIP sortant vérifié</b>\n\nVotre softphone a placé un appel sortant avec succès.\n\n📞 Numéro : <code>${phone}</code>\n🔑 Utilisateur SIP : <code>${sipUser}</code>\n🌐 Opérateur : <code>${provider}</code>\n📍 Vous avez composé : <code>${destination}</code>\n⏱️ Latence vers nos serveurs : ${elapsedSec}s\n\n💡 L'appel a été intercepté — aucun débit, aucune branche PSTN. Votre chemin SIP sortant fonctionne de bout en bout.`,
      timeout: (phone) => `❌ <b>Aucun appel SIP sortant détecté</b> sur <code>${phone}</code> en 90 secondes.\n\nCauses probables :\n• Softphone non enregistré — vérifiez le voyant d'enregistrement dans Linphone/Zoiper\n• Mauvais identifiants SIP — vérifiez nom d'utilisateur + mot de passe via <b>🔑 Identifiants SIP</b>\n• Pare-feu bloquant le UDP 5060 / trafic SIP\n• PBX (3CX / FreePBX) mal configuré comme utilisateur/extension au lieu de SIP TRUNK — consultez /sipguide\n\nUne fois "Enregistré" visible dans votre softphone, relancez le test.`,
      throttled: (max) => `⏳ Vous avez déjà effectué ${max} tests SIP sortants sur ce numéro dans les dernières 24 heures. Réessayez plus tard.`,
      inactive: (phone) => `❌ Le numéro <code>${phone}</code> n'est pas actif — le test SIP sortant est réservé aux numéros actifs.`,
      noSipConfigured: (phone) => `❌ Aucun identifiant SIP sur <code>${phone}</code>. Configurez d'abord SIP via <b>🔑 Identifiants SIP</b>, puis réessayez.`,
    },
  },
  zh: {
    hubWelcome: `📞 <b>Cloud IVR</b> <i>由 Speechcue 提供</i>

在30多个国家获取虚拟号码 — 不到2分钟。

📞 将来电转接到您的真实手机
💬 在 Telegram 中直接接收短信
🌐 在浏览器中拨打和接听电话 — 无需安装应用
🤖 设置 IVR 自动应答
🔗 通过 SIP 软电话连接

套餐起价 <b>$${PHONE_STARTER_PRICE}/月</b>，含 ${plans.starter.minutes} 来电分钟 + ${plans.starter.sms} 来电短信。
💳 外呼通话从钱包余额扣费。

新用户？点击 <b>❓ 使用说明</b> 查看完整指南。`,

    howItWorks: `📞 <b>Cloud IVR — 使用说明</b>

在30多个国家拥有您的虚拟号码。接听电话、发送短信、创建IVR菜单 — 全部通过Telegram管理。

<b>🚀 开始使用：</b>
1. 点击 <b>🛒 选择套餐</b> → 选择国家 → 选择号码
2. 从钱包支付（加密货币、银行或卡）
3. 号码立即激活

<b>📞 功能：</b>
• <b>来电转接</b> — 转到您的真实手机
• <b>短信到Telegram</b> — 在这里接收短信
• <b>浏览器通话</b> — 在 ${CALL_PAGE_URL} 拨打/接听（无需应用）
• <b>SIP软电话</b> — 使用任何SIP应用连接
• <b>📢 快速IVR呼叫</b> — 用自定义语音消息拨打号码
• <b>📞 批量IVR活动</b> — 一次拨打数百个号码
• <b>🤖 IVR自动应答</b> — "按1转销售，按2转支持"菜单
• <b>🎙️ 语音信箱</b> — 自定义问候语，发送到Telegram/Email

<b>💰 计费：</b>
• <b>来电</b> — 通话和短信包含在套餐中
• <b>外呼</b> — 按分钟从钱包扣费
• 按月续费。可设置自动续费。

<b>📋 套餐：</b>
💡 <b>入门 $${PHONE_STARTER_PRICE}/月</b> — ${plans.starter.minutes}分钟，转接 + 短信到Telegram
⭐ <b>专业 $${PHONE_PRO_PRICE}/月</b> — ${plans.pro.minutes}分钟，+ 语音信箱、SIP、IVR、OTP
👑 <b>商务 $${PHONE_BUSINESS_PRICE}/月</b> — ${BUSINESS_MINUTES}分钟，+ 录音、自动应答、调度

🧪 免费试用SIP通话 — 点击 <b>🧪 免费测试 SIP</b>`,

    selectCountry: '📍 为您的新号码选择国家：',
    searching: '🔍 正在搜索可用号码...',
    noSearchResults: '❌ 没有可用号码。请尝试其他区域或国家。',
    noNumbers: '📱 您还没有电话号码。\n\n点击下方获取您的第一个虚拟号码。',
    enterEmail: '输入用于接收短信的电子邮件地址：',
    enterWebhook: '输入您的 Webhook URL（短信将以 JSON 格式发送）：',
    ivrTrialUsed: (buyLabel) => `📢 <b>IVR 外呼</b>\n\n您已使用了免费试用通话。\n\n订阅 Cloud IVR 即可使用您自己的来电显示进行无限 IVR 通话！\n\n点击 <b>${buyLabel}</b> 开始。`,
    ivrTrialOffer: (callerId) => `📢 <b>IVR 外呼 — 免费试用</b>\n\n🎁 您有 <b>1 次免费试用通话！</b>\n📱 来电显示：<b>${callerId}</b>（共享）\n\n输入要拨打的电话号码（含国际区号）：\n<i>示例：+8613812345678</i>`,
    ivrSelectCallerId: '📢 <b>IVR 外呼</b>\n\n选择拨出号码（来电显示）：',
    ivrEnterNumber: (phone) => `📱 来电显示：<b>${phone}</b>\n\n输入要拨打的电话号码（含国际区号）：\n<i>示例：+8613812345678</i>`,
    ivrFoundCnam: (name) => `📋 查询结果：<b>${name}</b>`,
    ivrSelectCategory: (number) => `📞 目标：<b>${number}</b>\n\n选择 IVR 模板类别：`,
    ivrCustomScript: '✍️ <b>自定义脚本</b>\n\n输入您的 IVR 消息。使用 <b>[方括号]</b> 表示变量：\n\n<i>示例：您好 [姓名]。这里是 [公司]。一笔 $[金额] 的付款已扣除。按 1 争议。</i>\n\n输入您的脚本：',
    ivrEnterValue: (ph) => `输入 <b>[${ph}]</b> 的值：`,
    ivrValueSaved: (name, value, nextPh) => `✅ ${name}：<b>${value}</b>\n\n输入 <b>[${nextPh}]</b> 的值：`,
    ivrSelectVoiceProvider: '🎙 <b>选择语音引擎</b>\n\n选择您的 TTS 引擎：',
    ivrSelectVoice: '🎤 <b>选择语音</b>\n\n为 IVR 音频选择语音：',
    ivrGeneratingPreview: (voice) => `🎤 语音：<b>${voice}</b>\n\n⏳ 正在生成音频预览...`,
    ivrHoldMusicStatus: (on) => `🎵 等待音乐：<b>${on ? '开' : '关'}</b>\n${on ? '目标将听到"请稍候"+ 音乐。' : '目标听到标准回铃音。'}`,
    ivrConfirmPrompt: '点击 <b>✅ 确认</b> 继续，<b>🎤 更换语音</b>，或 <b>返回</b>。',
    ivrTemplatePreview: (icon, name, text, keys) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 活动按键：<b>${keys}</b>`,
    bulkCallNoPlan: (buyLabel) => `📞 <b>批量IVR活动</b>\n\n🔒 此功能需要 <b>Pro</b> 或更高套餐。\n\n请先获取 Cloud IVR 号码！\n\n点击 <b>${buyLabel}</b> 开始。`,
    bulkCallNoNumber: (buyLabel) => `📞 <b>批量IVR活动</b>\n\n您需要一个 ☎️ 支持批量 IVR 的号码。\n\n点击 <b>${buyLabel}</b> 并选择带有 ☎️ 标记的号码。`,
    bulkCallSelect: '📞 <b>批量呼叫活动</b>\n\n向多个线索发起自动 IVR 通话。\n\n☎️ = 支持批量 IVR 的号码\n\n📱 选择来电显示：',
    audioLibEmpty: '🎵 <b>音频库</b>\n\n您没有保存的音频文件。\n\n上传音频文件（MP3、WAV、OGG）用于 IVR 活动。',
    audioLibTitle: (list) => `🎵 <b>音频库</b>\n\n${list}\n\n上传新音频或删除现有音频：`,
    audioUploadPrompt: '🎵 <b>上传音频</b>\n\n发送音频文件（MP3、WAV、OGG）或语音消息。\n\n将保存到您的库中用于 IVR 活动。',
    audioSaved: (name) => `✅ 音频已保存：<b>${name}</b>\n\n现在可以在批量呼叫活动中使用！`,
    audioDeleted: (name) => `✅ 已删除：<b>${name}</b>`,
    audioNamePrompt: () => '✅ 收到音频！\n\n请命名：',
    audioNamePromptLib: (size) => `✅ 收到音频！（${size} KB）\n\n为您的库命名：`,
    audioLibEmptyShort: '🎵 <b>音频库</b>\n\n没有音频文件。上传一个开始。',
    vmRingPrompt: '电话应响铃多长时间后转到语音信箱？',
    enterValidUrl: '请输入有效的 URL，以 http:// 或 https:// 开头。',
    enterAddress: (countryName, addrText) => `✅ 已收到付款！\n\n📍 <b>${countryName}</b> 需要账单地址才能激活号码。\n地址 ${addrText || '必填'}。\n\n请输入您的地址：\n<code>街道, 城市, 国家</code>\n\n<i>示例：中山路123号, 上海, 中国</i>`,
    invalidAddress: '⚠️ 请至少输入：<code>街道, 城市, 国家</code>\n\n<i>示例：中山路123号, 上海, 中国</i>',
    bulkUploadLeads: (phone) => `📱 来电显示：<b>${phone}</b>\n\n📋 <b>上传线索</b>\n\n发送文件（.txt 或 .csv），每行一个号码。\n可选：<code>号码,姓名</code>\n\n或直接粘贴号码（每行一个）：`,
    bulkLeadsLoaded: (count, preview, more, errNote) => `✅ <b>已加载 ${count} 条线索！</b>\n\n${preview}${more}${errNote}\n\n🎵 <b>选择 IVR 音频</b>\n\n从库中选择、上传新文件或使用 TTS 生成：`,
    bulkTtsHint: '💡 要使用 TTS，请先通过 <b>📢 IVR 外呼</b> 生成音频，或上传预录音频。\n\n从库中选择或上传新文件：',
    bulkAudioSelected: (name) => `🎵 音频：<b>${name}</b>\n\n📋 <b>活动模式</b>\n\n🔗 <b>转接 + 报告</b> — 线索按 1 时桥接到您的 SIP/电话 + 报告\n📊 <b>仅报告</b> — 仅追踪 + 报告\n\n两种模式均报告完整结果。`,
    bulkAudioSavedMode: (name) => `✅ 已保存：<b>${name}</b>\n\n📋 <b>活动模式</b>\n\n🔗 <b>转接 + 报告</b> — 按 1 桥接到您的电话\n📊 <b>仅报告</b> — 仅追踪\n\n两种模式均报告完整结果。`,
    bulkTransferPrompt: '🔗 <b>转接模式</b>\n\n输入线索按 1 时转接到的号码：\n<i>（您的 SIP 号码或任何电话号码）</i>',
    bulkConcurrency: (transferTo) => `${transferTo ? `🔗 转接到：<b>${transferTo}</b>\n\n` : '📊 <b>仅报告</b> — 不转接。\n\n'}⚡ <b>并发设置</b>\n\n同时拨打多少通电话？（1-20）\n默认：<b>10</b>`,
    bulkRunning: '活动正在运行！您将看到进度更新。\n\n点击 <b>🛑 停止</b> 取消。',
    bulkCancelled: '🛑 <b>活动已取消。</b>\n\n进行中的通话将完成，不会发起新通话。',
    // ── 电话号码选择与管理 ──
    selectType: (country) => `📱 选择 <b>${country}</b> 的号码类型：\n\n<b>📍 本地</b> — 带区号的地理号码\n<b>🆓 免费</b> — 800/888/877 前缀，全国通用`,
    selectArea: '🏙️ 选择地区或输入区号：',
    enterAreaCode: '输入区号（如 415）：',
    showNumbers: (location, numbers) => {
      let text = `📞 <b>${location}</b> 的可用号码：\n\n`
      numbers.forEach((n, i) => {
        const caps = n._capabilities || n.capabilities || {}
        const voice = caps.voice === true || caps.voice === 'True'
        const sms = caps.sms === true || caps.sms === 'True'
        const fax = caps.fax === true || caps.fax === 'True'
        let capLabel = ''
        if (voice) capLabel += '📞'
        if (sms) capLabel += '💬'
        if (fax) capLabel += '📠'
        text += `${i + 1}️⃣  ${formatPhone(n.phone_number)} ${capLabel}\n`
      })
      text += '\n📞 = 语音  💬 = 短信  📠 = 传真\n点击号码进行选择。'
      return text
    },
    selectPlan: (number) => {
      let text = `✅ 已选择：<b>${formatPhone(number)}</b>\n\n📋 选择您的套餐：\n\n`
      if (PHONE_STARTER_ON) text += `<b>💡 入门版 — $${PHONE_STARTER_PRICE}/月</b>\n📞 ${plans.starter.minutes} 来电分钟 · 📩 ${plans.starter.sms} 来电短信 · ${plansI18n.zh.starter.features.join(' · ')}\n<b>🎙 IVR / SIP：</b> ❌ <i>不包含</i>\n🛡️ <i>14天升级抵扣 — 14天内升级到专业版/商务版可享 25% 抵扣</i>\n➕ 可添加最多 ${SUB_NUMBER_LIMITS.starter} 个额外号码（每个 $${SUB_NUMBER_BASE_PRICE}/月起）\n\n`
      if (PHONE_PRO_ON) text += `<b>⭐ 专业版 — $${PHONE_PRO_PRICE}/月</b>\n📞 ${plans.pro.minutes} 来电分钟 · 📩 ${plans.pro.sms} 来电短信 · ${plansI18n.zh.pro.features.join(' · ')}\n<b>🎙 IVR / SIP：</b> ✅ <i>快速IVR + 批量IVR + OTP</i>\n🛡️ <i>14天升级抵扣 — 14天内升级到商务版可享 25% 抵扣</i>\n➕ 可添加最多 ${SUB_NUMBER_LIMITS.pro} 个额外号码（每个 $${SUB_NUMBER_BASE_PRICE}/月起）\n\n`
      if (PHONE_BUSINESS_ON) text += `<b>👑 商务版 — $${PHONE_BUSINESS_PRICE}/月</b>\n📞 ${plans.business.minutes} 来电分钟 · 📩 ${plans.business.sms} 来电短信 · ${plansI18n.zh.business.features.join(' · ')}\n<b>🎙 IVR / SIP：</b> ✅ <i>专业版 + 自动接待 + 录音</i>\n➕ 可添加最多 ${SUB_NUMBER_LIMITS.business} 个额外号码（每个 $${SUB_NUMBER_BASE_PRICE}/月起）\n\n`
      text += `<i>📞 套餐分钟仅用于来电。\n💳 外呼通话和转发从钱包余额扣费。\n⚠️ 需要IVR(快速IVR、批量IVR、OTP、自动接待)? 请选择专业版或商务版 —— 入门版<b>不</b>包含IVR。</i>`
      return text
    },
    orderSummary: (number, country, plan, price) => {
      const planKey = plan.name.toLowerCase()
      const features = plansI18n.zh[planKey]?.features || plan.features
      const ivrLine = planKey === 'starter'
        ? `\n\n<i>⚠️ 入门版<b>不</b>包含IVR（快速IVR、批量IVR、OTP、自动接待）和SIP凭据。需要IVR？请选择专业版或商务版。</i>`
        : ''
      const creditLine = planKey === 'starter'
        ? `\n<i>🛡️ 14天升级抵扣 — 14天内升级到专业版/商务版可享 25% 抵扣</i>`
        : planKey === 'pro'
        ? `\n<i>🛡️ 14天升级抵扣 — 14天内升级到商务版可享 25% 抵扣</i>`
        : ''
      return `📋 <b>订单摘要</b>\n\n📞 ${formatPhone(number)} · ${country}\n📦 ${plan.name} — $${price}/月\n📩 ${plan.sms} 来电短信 · 📞 ${plan.minutes} 来电分钟\n💳 外呼通话和转发从钱包扣费\n⚡ ${features.join(', ')}\n\n💰 合计：<b>$${price}</b>（首月）${creditLine}${ivrLine}`
    },
    paymentPrompt: (price) => `价格：<b>$${price}</b>。选择支付方式：`,
    activated: (number, plan, price, sipUser, sipDomain, expiry) => `🎉 <b>您的 Cloud IVR 已激活！</b>\n\n📞 号码：${formatPhone(number)}\n📦 套餐：${plan}（$${price}/月）\n📅 续费日期：${expiry}\n\n━━━ <b>SIP 凭据</b> ━━━\n🌐 服务器：${sipDomain}\n👤 用户名：${sipUser}\n🔑 密码：●●●●●●●●（使用 🔑 SIP 凭据 查看）\n📡 端口：5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>快速设置</b> ━━━\n• 浏览器：在 <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a> 拨打电话\n• 软电话：下载 Zoiper/Ooma，输入 SIP 凭据\n• 短信：来电短信自动转发到此聊天\n• 转发：通过 📱 我的号码 → 呼叫转移 设置`,
    myNumbersList: (numbers) => {
      let text = '📱 <b>您的 Cloud IVR 号码：</b>\n\n'
      const primaryNumbers = numbers.filter(n => !n.isSubNumber)
      const subNumbers = numbers.filter(n => n.isSubNumber)
      primaryNumbers.forEach((n, i) => {
        const status = n.status === 'active' ? '✅ 活跃' : n.status === 'suspended' ? '⚠️ 已暂停' : n.status === 'inactive_released' ? '🚫 不活跃 (已被运营商释放)' : '🗑️ 已删除'
        text += `${i + 1}️⃣  ${formatPhone(n.phoneNumber)}  ${status}\n`
        text += `    ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} 套餐 · 续费 ${shortDate(n.expiresAt)}\n`
        if (n.status === 'inactive_released') {
          const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
          text += `    <i>~${hoursLeft}小时后自动移除 · 如有错误请联系客服</i>\n`
        }
        const subs = subNumbers.filter(s => s.parentNumber === n.phoneNumber && (s.status === 'active' || s.status === 'suspended'))
        if (subs.length > 0) {
          subs.forEach(s => {
            const subStatus = s.status === 'active' ? '✅' : '⚠️'
            text += `    ├ ${formatPhone(s.phoneNumber)} ${subStatus} (附加 · $${s.planPrice}/月)\n`
          })
        }
        text += '\n'
      })
      return text
    },
    manageNumber: (n, subCount, subLimit, allNumbers) => {
      const plan = plans[n.plan] || (n.isSubNumber && n.parentNumber ? plans[allNumbers?.find(p => p.phoneNumber === n.parentNumber)?.plan] : null)
      const minLimit = plan?.minutes === 'Unlimited' ? '无限' : (plan?.minutes || 0)
      const smsLimit = plan?.sms || 0
      let minUsed = n.minutesUsed || 0
      let smsUsed = n.smsUsed || 0
      if (allNumbers && allNumbers.length > 0) {
        if (n.isSubNumber && n.parentNumber) {
          const parent = allNumbers.find(p => p.phoneNumber === n.parentNumber && !p.isSubNumber)
          const siblings = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.parentNumber)
          minUsed = (parent?.minutesUsed || 0) + siblings.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (parent?.smsUsed || 0) + siblings.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        } else {
          const subs = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.phoneNumber)
          minUsed = (n.minutesUsed || 0) + subs.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (n.smsUsed || 0) + subs.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        }
      }
      const minDisplay = minLimit === '无限' ? `${minUsed}（无限）` : `${minUsed} / ${minLimit}`
      const smsDisplay = `${smsUsed} / ${smsLimit}`
      const minWarning = minLimit !== '无限' && minUsed >= minLimit ? `\n💰 <b>超额计费中</b> — $${OVERAGE_RATE_MIN}/分钟（从钱包扣费）` : ''
      const smsWarning = smsUsed >= smsLimit ? `\n💰 <b>超额计费中</b> — $${OVERAGE_RATE_SMS}/条（从钱包扣费）` : ''
      const hasSms = n.capabilities?.sms !== false && n.features?.sms !== false
      const hasFax = n.capabilities?.fax === true
      const hasVoice = n.capabilities?.voice !== false
      let text = `⚙️ 管理：<b>${formatPhone(n.phoneNumber)}</b>`
      if (n.isSubNumber) text += ` <i>(附加号码)</i>`
      if (n.status === 'inactive_released') {
        const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
        text += `\n\n🚫 <b>不活跃 — 已被运营商释放</b>\n此号码已被电信运营商停用，无法再拨打或接听电话。\n将在约 ${hoursLeft} 小时后自动移除。\n\n如有错误，请立即联系客服。`
        return text
      }
      if (n.isSubNumber) {
        text += `\n\n状态：${n.status === 'active' ? '✅ 活跃' : '⚠️ ' + n.status}\n附加号码 — $${n.planPrice}/月（在 ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} 套餐下）`
      } else {
        text += `\n\n状态：${n.status === 'active' ? '✅ 活跃' : '⚠️ ' + n.status}\n套餐：${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)}（$${n.planPrice}/月）`
      }
      if (n.isSubNumber && n.parentNumber) text += `\n🔗 主号码：${formatPhone(n.parentNumber)}`
      if (hasVoice) text += `\n📞 来电分钟：${minDisplay}${minWarning}`
      if (hasSms) text += `\n📩 来电短信：${smsDisplay}（仅接收）${smsWarning}`
      if (hasFax) text += `\n📠 传真：已包含 — 来电传真转发到 Telegram`
      if (hasVoice) text += `\n💳 外呼通话从钱包扣费`
      const caps = []
      if (hasVoice) caps.push('语音')
      if (hasSms) caps.push('短信')
      if (hasFax) caps.push('传真')
      text += `\n📋 功能：${caps.join(' · ')}`
      if (!n.isSubNumber && subCount !== undefined && subLimit !== undefined) {
        text += `\n➕ 附加号码：${subCount} / ${subLimit}`
      }
      if (n.features?.ivr?.enabled && Object.keys(n.features.ivr.options || {}).length === 0) {
        text += `\n\n⚠️ <b>IVR 已启用但不完整</b> — 没有菜单选项。来电者将跳过菜单直接进入语音信箱。点击 <b>🤖 IVR / 自动应答</b> 添加选项。`
      }
      if (hasVoice) text += `\n\n🌐 <a href="${CALL_PAGE_URL}">在浏览器中拨打电话</a>`
      const lastChanged = formatRelativeTime(n.updatedAt, 'zh')
      if (lastChanged) text += `\n<i>🕒 上次修改：${lastChanged}</i>`
      return text
    },
    // ── 附加号码 ──
    subNumberLimitReached: (plan, limit) => `⚠️ 您已达到 <b>${plan}</b> 套餐的附加号码上限（${limit} 个）。\n\n升级到更高套餐以获取更多号码。`,
    subNumberOrderSummary: (number, country, parentNumber, price, parentPlan) => `📋 <b>附加号码订单</b>\n\n📞 新号码：${formatPhone(number)} · ${country}\n🔗 添加到：${formatPhone(parentNumber)}（${parentPlan} 套餐）\n💰 价格：<b>$${typeof price === 'number' ? price.toFixed(2) : price}/月</b>\n\n⚡ 共享主号码的通话分钟和短信\n🔑 独立 SIP 凭据`,
    subActivated: (number, parentNumber, price, sipUser, sipDomain, expiry) => `🎉 <b>附加号码已添加！</b>\n\n📞 号码：${formatPhone(number)}\n🔗 关联到：${formatPhone(parentNumber)}\n💰 价格：$${typeof price === 'number' ? price.toFixed(2) : price}/月\n📅 续费：${expiry}\n\n━━━ <b>SIP 凭据</b> ━━━\n🌐 服务器：${sipDomain}\n👤 用户名：${sipUser}\n🔑 密码：●●●●●●●●（使用 🔑 SIP 凭据 查看）\n📡 端口：5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>快速设置</b> ━━━\n• 浏览器：<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>\n• 软电话：使用 Zoiper/Ooma 配置 SIP\n• 分钟和短信与主号码共享`,
    adminSubPurchase: (name, number, parentNumber, price, paymentMethod) => `➕ <b>附加号码</b>\n👤 ${name}\n📞 ${formatPhone(number)} → ${formatPhone(parentNumber)}\n💰 $${price} · ${paymentMethod}`,
    adminSubPurchasePrivate: (name, number, parentNumber, price, paymentMethod) => `➕ <b>附加号码</b>\n👤 ${name}\n📞 新：${formatPhone(number)}\n🔗 主：${formatPhone(parentNumber)}\n💰 $${price}/月 · ${paymentMethod}`,
    
    // Sub-number flow messages
    subAddNumberHeader: (plan, parentNumber) => `➕ <b>添加号码到 ${plan.charAt(0).toUpperCase() + plan.slice(1)} 套餐</b>\n📞 主号码：${formatPhone(parentNumber)}\n\n🌍 选择新号码的国家：`,
    subNumbersAvailable: '📱 <b>附加号码 — 可用</b>',
    subNumberArea: (area) => `📱 <b>附加号码 — 区域 ${area}</b>`,
    subNumberSelected: (location) => `📱 <b>附加号码 — ${location}</b>`,
    bulkIvrSupport: '☎️ = 支持批量IVR',
    tapToSelect: '点击选择：',
    
    // 呼叫转移
    forwardingStatus: (number, config, walletBal) => {
      const status = config?.enabled ? '✅ 已启用' : '❌ 已关闭'
      let text = `📞 <b>呼叫转移</b> — ${formatPhone(number)}\n\n状态：${status}`
      if (config?.enabled) {
        text += `\n📲 ${formatPhone(config.forwardTo)} · ${config.mode}`
        text += `\n🎵 等待音乐：${config.holdMusic ? '开' : '关'}`
      }
      const rate = config?.forwardTo && config.forwardTo.startsWith('+1') ? OVERAGE_RATE_MIN : CALL_FORWARDING_RATE_MIN
      text += `\n💳 从钱包扣费 $${rate}/分钟`
      if (walletBal !== undefined) text += ` · 💳 $${walletBal.toFixed(2)}`
      return text
    },
    enterForwardNumber: (walletBal) => {
      let text = `输入带国家代码的转发号码（如 +14155551234）\n💰 费率：<b>$${CALL_FORWARDING_RATE_MIN}/分钟</b>`
      if (walletBal !== undefined) {
        text += ` · 💳 $${walletBal.toFixed(2)}`
        if (walletBal < CALL_FORWARDING_RATE_MIN) text += `\n⚠️ 请先通过 👛 钱包 充值 <b>$25</b>。`
      }
      return text
    },
    forwardingUpdated: (number, forwardTo, mode, walletBal) => {
      let text = `✅ <b>转发已启用</b>\n\n📞 ${formatPhone(number)} → ${formatPhone(forwardTo)}\n📋 ${mode} · $${CALL_FORWARDING_RATE_MIN}/分钟`
      if (walletBal !== undefined) {
        const estMin = Math.floor(walletBal / CALL_FORWARDING_RATE_MIN)
        text += `\n💳 $${walletBal.toFixed(2)}（约 ${estMin} 分钟）`
        if (walletBal < 25) text += `\n💡 充值到 <b>$25</b> 以确保不间断转发。`
      }
      return text
    },
    forwardingBlocked: (number) => `🚫 <b>已阻止</b> — ${formatPhone(number)} 是高级目的地。\n点击 💬 <b>获取支持</b> 申请开通。`,
    forwardingNotRoutable: (number) => `⚠️ ${formatPhone(number)} 无法路由。请检查号码或点击 💬 <b>获取支持</b>。`,
    forwardingInsufficientBalance: (walletBal) => `🚫 <b>余额不足</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · 需要 $${CALL_FORWARDING_RATE_MIN}/分钟\n\n👉 通过 👛 钱包 充值 <b>$25</b> 以启用转发。`,
    forwardingDisabled: (number) => `✅ 已关闭 ${formatPhone(number)} 的呼叫转移。`,
    // 短信设置
    smsSettingsMenu: (number, config, plan) => {
      const tg = config?.toTelegram ? '✅ 开' : '❌ 关'
      const em = config?.toEmail ? '✅ ' + config.toEmail : '❌ 关'
      const wh = config?.webhookUrl ? '✅ 已设置' : '❌ 未设置'
      const canEmail = canAccessFeature(plan, 'smsToEmail')
      const canWebhook = canAccessFeature(plan, 'smsWebhook')
      const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '未知'
      return `📩 <b>来电短信设置</b> — <b>${formatPhone(number)}</b>\n\n📌 短信为 <b>仅接收</b> — 您可以接收短信但不能发送。\n\n📲 转发到 Telegram：${tg}\n📧 转发到邮箱：${canEmail ? em : `🔒 需要 Pro 或更高套餐（当前：${planName}）`}\n🔗 Webhook URL：${canWebhook ? wh : `🔒 需要 Pro 或更高套餐（当前：${planName}）`}`
    },
    smsToggled: (channel, state) => `${channel} 现在 ${state ? '✅ 已开启' : '❌ 已关闭'}`,
    // 传真设置
    faxSettingsMenu: (number, config, provider) => {
      const tg = config?.toTelegram !== false ? '✅ 开' : '❌ 关'
      if (provider === 'twilio') {
        return `📠 <b>传真设置</b> — <b>${formatPhone(number)}</b>\n\n⚠️ <b>此号码类型不支持传真。</b>\n该号码的服务商已停止传真服务。此号码无法接收传真。\n\n如需使用传真，请购买支持传真的号码。`
      }
      return `📠 <b>传真设置</b> — <b>${formatPhone(number)}</b>\n\n来电传真以 PDF 格式接收并转发到此 Telegram 聊天。\n\n📲 转发到 Telegram：${tg}`
    },
    faxToggled: (state) => `📠 传真转发到 Telegram 现在 ${state ? '✅ 已开启' : '❌ 已关闭'}`,
    faxReceived: (from, to, pages) => `📠 <b>收到传真</b>\n发件人：${from}\n收件人：${formatPhone(to)}${pages ? `\n页数：${pages}` : ''}`,
    faxFailed: (from, to, reason) => `📠 <b>传真失败</b>\n发件人：${from}\n收件人：${formatPhone(to)}\n原因：${reason || '未知'}`,
    enterEmail: '输入用于转发短信的电子邮件地址：',
    emailSet: (email) => `✅ 短信转发到邮箱已启用！\n所有来电短信也将发送到 <b>${email}</b>。`,
    enterWebhook: '输入您的 Webhook URL（来电短信将以 JSON 格式 POST）：',
    webhookSet: (url) => `✅ Webhook URL 已配置！\n短信将 POST 到：${url}`,
    // 语音信箱
    voicemailMenu: (number, config) => {
      if (!config?.enabled) {
        return `🎙️ <b>${formatPhone(number)}</b> 的语音信箱\n\n状态：❌ 已关闭\n\n启用后，未接来电将听到问候语，来电者可以留言。`
      }
      const tg = config.forwardToTelegram ? '✅ 开' : '❌ 关'
      const em = config.forwardToEmail ? '✅ ' + config.forwardToEmail : '❌ 关'
      let greetInfo = ''
      if (config.greetingType === 'custom' && config.customAudioGreetingUrl) {
        greetInfo = '🎤 自定义音频'
      } else if (config.greetingType === 'custom' && config.customGreetingText) {
        greetInfo = `📝 自定义："${config.customGreetingText}"`
      } else {
        greetInfo = '🔊 默认："您已接通 ' + formatPhone(number) + '。请在提示音后留言。"'
      }
      return `🎙️ <b>${formatPhone(number)}</b> 的语音信箱\n\n状态：✅ 已启用\n🎤 问候语：${greetInfo}\n\n📲 发送到 Telegram：${tg}\n📧 发送到邮箱：${em}\n⏰ 响铃时间：${config.ringTimeout || 25}秒`
    },
    voicemailEnabled: (number) => `✅ 已为 ${formatPhone(number)} 启用语音信箱！\n录音将发送到此 Telegram 聊天。`,
    voicemailDisabled: (number) => `✅ 已为 ${formatPhone(number)} 关闭语音信箱。`,
    vmGreetingMenu: (number, vm) => {
      let current = ''
      if (vm?.greetingType === 'custom' && vm?.customAudioGreetingUrl) {
        current = '🎤 自定义音频\n📎 已上传音频文件'
      } else if (vm?.greetingType === 'custom' && vm?.customGreetingText) {
        current = `📝 自定义文本："${vm.customGreetingText}"`
      } else {
        current = `🔊 默认："您已接通 ${formatPhone(number)}。请在提示音后留言。"`
      }
      return `🔊 <b>语音信箱问候语</b> — <b>${formatPhone(number)}</b>\n\n当前：${current}\n\n请选择一个选项：`
    },
    vmSendAudioPrompt: '🎤 <b>自定义音频问候语</b>\n\n发送语音消息或音频文件作为语音信箱问候语。\n\n来电者将在到达语音信箱时听到此音频。\n\n<i>提示：录制专业问候语，如"您好，这里是[姓名]。我暂时无法接听。请在提示音后留言。"</i>',
    vmAudioSaved: '✅ 自定义音频问候语已保存！来电者现在将听到您上传的问候语。',
    vmDefaultRestored: '✅ 语音信箱问候语已恢复为默认。',
    vmTextGreetingPrompt: '输入自定义问候语文本（将通过文字转语音朗读）：',
    vmTextGreetingSet: (text) => `✅ 自定义文本问候语已保存！\n\n"${text}"`,
    // SIP
    sipCredentialsMsg: (number, username, domain) => `🔑 <b>${formatPhone(number)}</b> 的 SIP 凭据\n\n🌐 SIP 服务器：${domain}\n👤 用户名：<code>${username}</code>\n🔑 密码：●●●●●●●●\n📡 端口：5060 (UDP/TCP) · 5061 (TLS)\n🎵 编解码器：G.711μ, G.711a, Opus`,
    sipRevealed: (password) => `🔑 密码：<code>${password}</code>\n\n⚠️ 请立即保存 — 此消息将在 30 秒后删除。`,
    sipReset: (password) => `✅ SIP 密码已重置！\n\n🔑 新密码：<code>${password}</code>\n\n⚠️ 请立即保存。请在所有 SIP 设备上更新此密码。`,
    softphoneGuide: (domain) => `📖 <b>SIP 设置指南</b>

<b>🌐 浏览器（最简单）</b>
直接在浏览器中拨打和接听电话：
<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>
无需注册或安装应用。

<b>📱 软电话应用 — 推荐</b>
使用单线软电话（每个凭据对应一个设备）：
• <b>Linphone</b> — iOS / Android / Mac / Windows / Linux（免费）
• <b>Zoiper</b> — iOS / Android / 桌面（免费）
• <b>MicroSIP</b> — Windows（免费，轻量）
• <b>Bria Solo</b> — 付费，界面精美

<b>设置步骤</b>
1. 安装应用
2. 添加账户 → SIP / VoIP
3. 用户名 + 密码（来自 🔑 SIP 凭据）
4. 域名 / SIP 服务器：<code>${domain}</code>
5. 端口 5060 (UDP/TCP) 或 5061 (TLS) · DTMF：RFC 2833 · 编解码器：G.711μ
6. 保存并拨打测试电话

⚠️ <b>使用 3CX、FreePBX、Asterisk 或其他 PBX？</b>
不要将 SIP 凭据添加为"用户/分机"——PBX 会接听呼叫并直接转入其语音信箱（您会听到 "Record your message and press pound, or press star to contact the operator"，按星号后听到 "transfer failed"）。请将其配置为 <b>SIP 中继 (SIP TRUNK)</b>：

<b>3CX 示例</b>
1. SIP Trunks → Add SIP Trunk → "Generic SIP Trunk"
2. Main Trunk No.：您的 Nomadly 号码（如 <code>+18882437690</code>）
3. Registrar / 服务器 / Outbound Proxy：<code>${domain}</code> · 端口 <code>5060</code>
4. 认证：<b>Register/Account based</b>
   Username + Auth ID：您的 <code>gencred…</code> SIP 用户名
   密码：您的 SIP 密码
5. 保存 → Inbound Rules → New Inbound Rule → <b>路由到您的分机</b>（而非语音信箱）
6. Outbound Rules → 将分机路由通过此中继
7. 应用并重新加载——拨打测试电话

🧪 <b>免费测试通话：</b>
在此发送 /testsip 获取测试码。

❓ 仍有问题？点击 💬 支持，我们会帮助您。`,
    // 续费
    renewMenu: (number, plan, price, expiry, autoRenewOn) => `🔄 <b>${formatPhone(number)}</b> 的套餐\n\n当前套餐：${plan} — $${price}/月\n续费日期：${shortDate(expiry)}\n自动续费：${autoRenewOn ? '✅ 已开启' : '❌ 已关闭'}`,
    // 删除
    releaseConfirm: (number) => `🗑️ <b>删除 ${formatPhone(number)}？</b>\n\n⚠️ <b>此操作不可撤销。</b>\n\n• 号码将被永久删除\n• 月度套餐立即取消\n• 所有设置（转发、语音信箱、SIP）将被移除\n• 剩余天数不予退款\n\n确定要删除吗？`,
    releaseConfirmDigits: (digits) => `⚠️ <b>最终确认</b>\n\n输入号码的最后 4 位以永久删除：<b>${digits}</b>`,
    released: (number) => `✅ ${formatPhone(number)} 已被永久删除。\n\n套餐已取消。所有设置已移除。`,
    // 实时事件
    inboundSms: (to, from, body, time) => `📩 <b>收到短信</b>\n\n📞 收件人：${formatPhone(to)}\n👤 发件人：${formatPhone(from)}\n🕐 ${time}\n\n💬 "${body}"`,
    missedCall: (to, from, time) => `📞 <b>未接来电</b>\n\n📞 被叫：${formatPhone(to)}\n👤 主叫：${formatPhone(from)}\n🕐 ${time}`,
    callForwarded: (to, from, forwardedTo, duration, time) => `📞 <b>已转接来电</b>\n\n📞 被叫：${formatPhone(to)}\n👤 主叫：${formatPhone(from)}\n📲 转接到：${formatPhone(forwardedTo)}\n⏱️ 时长：${formatDuration(duration)}\n🕐 ${time}`,
    newVoicemail: (to, from, duration, time) => `🎙️ <b>新语音留言</b>\n\n📞 被叫：${formatPhone(to)}\n👤 主叫：${formatPhone(from)}\n⏱️ 时长：${formatDuration(duration)}\n🕐 ${time}`,
    // 到期提醒
    expiryReminder: (number, days, plan, price, balance) => `🔔 <b>续费提醒</b>\n\n您的 Cloud IVR 号码 ${formatPhone(number)}（${plan} 套餐）将在 <b>${days} 天</b>后到期。\n\n钱包余额：$${balance}\n套餐价格：$${price}/月${balance < price ? '\n\n⚠️ 余额不足。请充值。' : ''}`,
    autoRenewed: (number, plan, price, newExpiry, oldBal, newBal) => `✅ <b>自动续费成功</b>\n\n📞 ${formatPhone(number)}\n📦 套餐：${plan}（$${price}/月）\n📅 新到期日：${shortDate(newExpiry)}\n钱包：$${oldBal} → $${newBal}`,
    autoRenewFailed: (number, plan, price, balance) => `❌ <b>自动续费失败</b>\n\n📞 ${formatPhone(number)}\n📦 套餐：${plan}（$${price}/月）\n💰 钱包：$${balance}（需要 $${price}）\n\n⚠️ 您的号码已被暂停。请在 7 天内充值并续费。`,
    // IVR
    ivrMenu: (number, config) => {
      if (!config?.enabled) {
        return `🤖 <b>IVR / 自动应答</b> — <b>${formatPhone(number)}</b>\n\n状态：❌ 已关闭\n\n启用后，来电者将听到问候菜单并可按键到达相应目的地。`
      }
      const hasOptions = config.options && Object.keys(config.options).length > 0
      let text = `🤖 <b>IVR / 自动应答</b> — <b>${formatPhone(number)}</b>\n\n状态：${hasOptions ? '✅ 已启用' : '⚠️ 已启用（不完整）'}\n\n🎤 问候语："${escapeHtml(config.greeting || '默认')}"\n\n📋 <b>菜单选项：</b>\n`
      if (hasOptions) {
        Object.entries(config.options).forEach(([key, opt]) => {
          let desc
          if (opt.action === 'forward') desc = '📲 转接到 ' + formatPhone(opt.forwardTo)
          else if (opt.action === 'voicemail') desc = '🎙️ 语音信箱'
          else if (opt.action === 'submenu') {
            const subCount = Object.keys(opt.subMenu?.options || {}).length
            const lbl = opt.label && opt.label.trim() ? opt.label.trim() : `子菜单 ${key}`
            desc = `📂 <b>${escapeHtml(lbl)}</b> — 子菜单（${subCount} 个选项）`
          } else desc = '🔊 ' + escapeHtml(opt.message || '播放消息')
          text += `  按 <b>${escapeHtml(key)}</b> → ${desc}\n`
        })
      } else {
        text += '  ⚠️ <b>尚未添加任何选项 — IVR 不会运行。</b>\n  来电者将跳过菜单直接进入语音信箱（如果语音信箱已关闭，则听到"不可用"）。\n  请在下方点击 <b>➕ 添加选项</b> 至少添加一个（例如 <code>1 forward +14155551234</code>）。\n'
      }
      return text
    },
    ivrEnabled: (number) => `✅ 已为 ${formatPhone(number)} 启用 IVR / 自动应答！\n\n来电者将听到您的问候语并可按键导航。`,
    ivrDisabled: (number) => `✅ 已为 ${formatPhone(number)} 关闭 IVR / 自动应答。`,
    ivrSetGreeting: '输入 IVR 问候语（来电者将听到的内容）：\n\n示例："感谢来电。按 1 转支持，按 2 转销售，或继续等待。"',
    ivrGreetingSet: (greeting) => `✅ IVR 问候语已更新！\n\n"${greeting}"`,
    ivrAddOption: '输入按键和操作，格式如下：\n\n<code>按键 操作 目标</code>\n\n示例：\n• <code>1 forward +14155551234</code>\n• <code>2 voicemail</code>\n• <code>3 message 我们会回电给您</code>\n• <code>0 forward +14155559999</code>',
    ivrOptionAdded: (key, action, destination) => `✅ IVR 选项已添加！\n\n按 <b>${key}</b> → ${action === 'forward' ? '📲 转接到 ' + formatPhone(destination) : action === 'voicemail' ? '🎙️ 语音信箱' : '🔊 ' + destination}`,
    ivrOptionRemoved: (key) => `✅ 按键 <b>${key}</b> 的 IVR 选项已删除。`,
    ivrInvalidFormat: '❌ 格式无效。请使用：\n<code>按键 操作 目标</code>\n\n示例：<code>1 forward +14155551234</code>',
    ivrAnalyticsReport: (number, data, labels) => {
      let text = `📊 <b>IVR 分析</b> — <b>${formatPhone(number)}</b>\n（最近 30 天）\n\n`
      text += `📞 IVR 总来电：<b>${data.totalCalls}</b>\n`
      const _labelFor = (d) => (labels && labels[d]) ? ` <i>(${escapeHtml(labels[d])})</i>` : ''
      if (data.topOption) text += `🏆 最常按键：<b>${escapeHtml(data.topOption.digit)}</b>${_labelFor(data.topOption.digit)}（${data.topOption.count} 次，${data.topOption.percent}%）\n`
      text += '\n'
      if (data.optionBreakdown.length > 0) {
        text += '📋 <b>选项分布：</b>\n'
        data.optionBreakdown.forEach(o => {
          const bar = '█'.repeat(Math.max(1, Math.round(o.percent / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(o.percent / 10)))
          text += `  按键 <b>${escapeHtml(o.digit)}</b>${_labelFor(o.digit)}：${bar} ${o.count}（${o.percent}%）\n`
        })
        text += '\n'
      }
      if (data.recentCalls.length > 0) {
        text += '📱 <b>最近 IVR 来电：</b>\n'
        data.recentCalls.forEach(c => {
          text += `  ${formatPhone(c.from)} → 按键 <b>${escapeHtml(c.digit)}</b>${_labelFor(c.digit)}（${escapeHtml(c.action)}）${shortDate(c.time)}\n`
        })
      }
      if (data.totalCalls === 0) text += '\n暂无 IVR 通话记录。'
      return text
    },
    // 录音
    recordingMenu: (number, config) => {
      const enabled = config?.recording === true
      return `🔴 <b>通话录音</b> — <b>${formatPhone(number)}</b>\n\n状态：${enabled ? '✅ 已启用' : '❌ 已关闭'}\n\n启用后，所有来电和去电将自动录音。录音将发送到您的 Telegram 聊天。`
    },
    recordingEnabled: (number) => `✅ 已为 ${formatPhone(number)} 启用通话录音！\n\n所有通话将被录音并发送到此聊天。`,
    recordingDisabled: (number) => `✅ 已为 ${formatPhone(number)} 关闭通话录音。`,
    // 短信收件箱
    smsInboxHeader: (number, total) => `📨 <b>短信收件箱</b> — <b>${formatPhone(number)}</b>\n\n${total === 0 ? '暂无收到的消息。' : `收到 ${total} 条消息：`}`,
    smsInboxEntry: (i, from, name, body, time) => {
      const nameDisplay = name && name !== 'None' ? `（${name}）` : ''
      const bodyPreview = body.length > 80 ? body.substring(0, 80) + '...' : body
      return `\n<b>${i}.</b> ${formatPhone(from)}${nameDisplay}\n   💬 "${bodyPreview}"\n   🕐 ${time}\n`
    },
    smsInboxEmpty: '此号码暂未收到来电短信。\n\n<i>当有人给您的号码发短信时，消息将显示在这里。</i>',
    smsInboxFooter: (page, totalPages) => totalPages > 1 ? `\n📄 第 ${page}/${totalPages} 页` : '',
    btnUploadAudio: '📎 上传音频',
    btnConfirm: '✅ 确认',
    btnChangeVoice: '🎤 更换语音',
    btnTransferReport: '🔗 转接 + 报告',
    btnReportOnly: '📊 仅报告',
    btnStopCampaign: '🛑 停止活动',
    btnShowStatus: '📊 显示状态',
    btnUploadNewAudio: '📎 上传新音频',
    btnBack: '↩️ 返回',
    testMyNumber: {
      placing: (phone) => `📞 正在从 Nomadly 测试线路呼叫 <code>${phone}</code>… 请用您的软电话接听并在响铃时按 <b>1</b>（接听后约 12 秒内有效）。\n\n结果将在 60 秒内显示在这里。`,
      successDtmf: (phone) => `✅ <b>已接通您的 SIP 设备</b> — 拨往 <code>${phone}</code> 的来电端到端畅通。对方已接听并按键。`,
      voicemail: (phone) => `⚠️ <b>进入了语音信箱 / PBX 应答</b> <code>${phone}</code>。\n\n这通常表示 PBX（3CX、FreePBX、Asterisk 等）接管了来电并转到自己的语音信箱，而不是让您的分机振铃。\n\n解决方法：打开 /sipguide 查看 SIP TRUNK 配置指南，或切换到单线软电话（Linphone、Zoiper）即刻解决。`,
      answeredNoDtmf: (phone) => `⚠️ <b>来电已接听，但 12 秒内未按键</b> <code>${phone}</code>。\n\n如果您没接听，您的软电话可能未收到来电。如果您接听了但未按 1，请重试。如使用了 PBX（3CX/FreePBX），请参阅 /sipguide 进行 SIP TRUNK 配置。`,
      noAnswer: (phone) => `❌ <b>无人接听</b> <code>${phone}</code>。\n\n请确认您的软电话（Linphone / Zoiper / 3CX trunk）已注册并在线，然后重新测试。打开 /sipguide 查看配置帮助。`,
      throttled: (max) => `⏳ 24 小时内您已对该号码运行了 ${max} 次测试。请稍后再试。`,
      inactive: (phone) => `❌ 号码 <code>${phone}</code> 未激活 — 测试仅适用于已激活的号码。`,
      placeFailed: (err) => `❌ 无法发起测试呼叫：${err}`,
    },
    testOutboundSip: {
      listening: (phone, sipUser) => `📤 <b>SIP 外呼测试 — 监听 90 秒</b>\n\n📞 号码：<code>${phone}</code>\n🔑 SIP 用户：<code>${sipUser}</code>\n\n请在 90 秒内从您的软电话拨打<b>任意号码</b> — 拨打您自己的手机最理想。\n\n💡 该呼叫将被安全拦截：<b>不扣钱包余额</b>、<b>不建立 PSTN 线路</b>。我们仅验证您软电话的外呼路径是否能以正确的 SIP 凭据到达我们的服务器。\n\n一旦您的呼叫到达，结果将显示在此处。`,
      success: (phone, sipUser, provider, destination, elapsedSec) => `✅ <b>SIP 外呼已验证</b>\n\n您的软电话成功发起了一次外呼。\n\n📞 号码：<code>${phone}</code>\n🔑 SIP 用户：<code>${sipUser}</code>\n🌐 运营商：<code>${provider}</code>\n📍 您拨打了：<code>${destination}</code>\n⏱️ 到我们服务器的延迟：${elapsedSec}秒\n\n💡 该呼叫被拦截 — 不扣余额，不建立 PSTN 线路。您的 SIP 外呼路径运行正常。`,
      timeout: (phone) => `❌ <b>90 秒内未检测到 SIP 外呼</b> <code>${phone}</code>。\n\n可能原因：\n• 软电话未注册 — 检查 Linphone/Zoiper 的注册/状态指示灯\n• SIP 凭据错误 — 通过 <b>🔑 SIP 凭据</b> 核对用户名和密码\n• 防火墙阻止 UDP 5060 / SIP 流量\n• PBX（3CX / FreePBX）配置为分机而非 SIP TRUNK — 请参阅 /sipguide\n\n在软电话显示"已注册"后，再次运行测试。`,
      throttled: (max) => `⏳ 24 小时内您已对该号码运行了 ${max} 次 SIP 外呼测试。请稍后再试。`,
      inactive: (phone) => `❌ 号码 <code>${phone}</code> 未激活 — SIP 外呼测试仅适用于已激活的号码。`,
      noSipConfigured: (phone) => `❌ <code>${phone}</code> 未配置 SIP 凭据。请先通过 <b>🔑 SIP 凭据</b> 设置 SIP，然后重试。`,
    },
  },
  hi: {
    hubWelcome: `📞 <b>Cloud IVR</b> <i>Speechcue द्वारा</i>

30 से अधिक देशों में वर्चुअल नंबर प्राप्त करें — 2 मिनट से भी कम में।

📞 कॉल अपने असली फ़ोन पर फ़ॉरवर्ड करें
💬 टेलीग्राम में सीधे SMS प्राप्त करें
🌐 ब्राउज़र में कॉल करें और प्राप्त करें — कोई ऐप नहीं चाहिए
🤖 IVR ऑटो-अटेंडेंट सेट करें
🔗 SIP सॉफ्टफोन से कनेक्ट करें

प्लान <b>$${PHONE_STARTER_PRICE}/माह</b> से शुरू, ${plans.starter.minutes} इनबाउंड मिनट + ${plans.starter.sms} इनबाउंड SMS शामिल।
💳 आउटबाउंड कॉल वॉलेट बैलेंस से चार्ज होते हैं।

नए हैं? <b>❓ कैसे काम करता है</b> दबाएं — पूरी गाइड देखें।`,

    howItWorks: `📞 <b>Cloud IVR — कैसे काम करता है</b>

30+ देशों में अपना वर्चुअल फ़ोन नंबर। कॉल प्राप्त करें, SMS भेजें, IVR मेनू बनाएं — सब Telegram से।

<b>🚀 शुरू करें:</b>
1. <b>🛒 प्लान चुनें</b> दबाएं → देश चुनें → नंबर चुनें
2. वॉलेट से भुगतान करें (क्रिप्टो, बैंक या कार्ड)
3. नंबर तुरंत सक्रिय

<b>📞 क्या कर सकते हैं:</b>
• <b>कॉल फ़ॉरवर्ड</b> — अपने असली फ़ोन पर
• <b>SMS से Telegram</b> — यहीं मैसेज प्राप्त करें
• <b>ब्राउज़र कॉलिंग</b> — ${CALL_PAGE_URL} पर कॉल करें (कोई ऐप नहीं)
• <b>SIP सॉफ्टफोन</b> — किसी भी SIP ऐप से कनेक्ट
• <b>📢 त्वरित IVR कॉल</b> — कस्टम वॉइस मैसेज से कॉल करें
• <b>📞 बल्क IVR</b> — सैकड़ों नंबर एक साथ कॉल करें
• <b>🤖 IVR ऑटो-अटेंडेंट</b> — "1 दबाएं सेल्स, 2 दबाएं सपोर्ट" मेनू
• <b>🎙️ वॉइसमेल</b> — कस्टम ग्रीटिंग, Telegram/Email पर डिलीवरी

<b>💰 बिलिंग:</b>
• <b>इनबाउंड</b> — कॉल और SMS प्लान में शामिल
• <b>आउटबाउंड</b> — वॉलेट से प्रति मिनट चार्ज
• मासिक नवीनीकरण। ऑटो-रिन्यू उपलब्ध।

<b>📋 प्लान:</b>
💡 <b>स्टार्टर $${PHONE_STARTER_PRICE}/माह</b> — ${plans.starter.minutes} मिनट, फ़ॉरवर्डिंग + SMS
⭐ <b>प्रो $${PHONE_PRO_PRICE}/माह</b> — ${plans.pro.minutes} मिनट, + वॉइसमेल, SIP, IVR, OTP
👑 <b>बिज़नेस $${PHONE_BUSINESS_PRICE}/माह</b> — ${BUSINESS_MINUTES} मिनट, + रिकॉर्डिंग, ऑटो-अटेंडेंट

🧪 मुफ्त SIP ट्राई करें — <b>🧪 SIP मुफ्त टेस्ट</b> दबाएं`,

    selectCountry: '📍 अपने नए नंबर के लिए देश चुनें:',
    searching: '🔍 उपलब्ध नंबर खोज रहे हैं...',
    noSearchResults: '❌ कोई नंबर उपलब्ध नहीं। कोई और क्षेत्र या देश आज़माएं।',
    noNumbers: '📱 आपके पास अभी तक कोई फ़ोन नंबर नहीं है।\n\nअपना पहला वर्चुअल नंबर पाने के लिए नीचे टैप करें।',
    enterEmail: 'SMS प्राप्त करने के लिए ईमेल पता दर्ज करें:',
    enterWebhook: 'अपना Webhook URL दर्ज करें (SMS JSON में भेजा जाएगा):',
    ivrTrialUsed: (buyLabel) => `📢 <b>IVR आउटबाउंड कॉल</b>\n\nआपने अपना मुफ्त ट्रायल कॉल पहले ही उपयोग कर लिया है।\n\nCloud IVR की सदस्यता लें और अपनी Caller ID से असीमित IVR कॉल करें!\n\n<b>${buyLabel}</b> पर टैप करें।`,
    ivrTrialOffer: (callerId) => `📢 <b>IVR आउटबाउंड कॉल — मुफ्त ट्रायल</b>\n\n🎁 आपके पास <b>1 मुफ्त ट्रायल कॉल है!</b>\n📱 Caller ID: <b>${callerId}</b> (साझा)\n\nकॉल करने के लिए फ़ोन नंबर दर्ज करें (देश कोड के साथ):\n<i>उदाहरण: +919876543210</i>`,
    ivrSelectCallerId: '📢 <b>IVR आउटबाउंड कॉल</b>\n\nकॉल करने के लिए नंबर चुनें (Caller ID):',
    ivrEnterNumber: (phone) => `📱 Caller ID: <b>${phone}</b>\n\nकॉल करने के लिए फ़ोन नंबर दर्ज करें (देश कोड के साथ):\n<i>उदाहरण: +919876543210</i>`,
    ivrFoundCnam: (name) => `📋 मिला: <b>${name}</b>`,
    ivrSelectCategory: (number) => `📞 लक्ष्य: <b>${number}</b>\n\nIVR टेम्पलेट श्रेणी चुनें:`,
    ivrCustomScript: '✍️ <b>कस्टम स्क्रिप्ट</b>\n\nअपना IVR संदेश टाइप करें। वेरिएबल के लिए <b>[कोष्ठक]</b> का उपयोग करें:\n\n<i>उदाहरण: नमस्ते [नाम]। यह [कंपनी] है। $[राशि] का भुगतान चार्ज हुआ। विवाद के लिए 1 दबाएं।</i>\n\nअपनी स्क्रिप्ट टाइप करें:',
    ivrEnterValue: (ph) => `<b>[${ph}]</b> का मान दर्ज करें:`,
    ivrValueSaved: (name, value, nextPh) => `✅ ${name}: <b>${value}</b>\n\n<b>[${nextPh}]</b> का मान दर्ज करें:`,
    ivrSelectVoiceProvider: '🎙 <b>वॉइस प्रोवाइडर चुनें</b>\n\nTTS इंजन चुनें:',
    ivrSelectVoice: '🎤 <b>आवाज़ चुनें</b>\n\nIVR ऑडियो के लिए आवाज़ चुनें:',
    ivrGeneratingPreview: (voice) => `🎤 आवाज़: <b>${voice}</b>\n\n⏳ ऑडियो प्रीव्यू बनाया जा रहा है...`,
    ivrHoldMusicStatus: (on) => `🎵 होल्ड म्यूज़िक: <b>${on ? 'चालू' : 'बंद'}</b>\n${on ? 'लक्ष्य को "कृपया प्रतीक्षा करें" + संगीत सुनाई देगा।' : 'लक्ष्य को स्टैंडर्ड रिंगबैक सुनाई देगी।'}`,
    ivrConfirmPrompt: '<b>✅ पुष्टि करें</b> जारी रखने के लिए, <b>🎤 आवाज़ बदलें</b>, या <b>वापस</b>।',
    ivrTemplatePreview: (icon, name, text, keys) => `📋 <b>${icon} ${name}</b>\n\n<i>"${text}"</i>\n\n🔘 सक्रिय कुंजियाँ: <b>${keys}</b>`,
    bulkCallNoPlan: (buyLabel) => `📞 <b>बल्क IVR अभियान</b>\n\n🔒 इस सुविधा के लिए <b>Pro</b> या उससे ऊपर का प्लान चाहिए।\n\nपहले Cloud IVR नंबर लें!\n\n<b>${buyLabel}</b> पर टैप करें।`,
    bulkCallNoNumber: (buyLabel) => `📞 <b>बल्क IVR अभियान</b>\n\nआपको ☎️ बल्क IVR सक्षम नंबर चाहिए।\n\n<b>${buyLabel}</b> पर टैप करें और ☎️ बैज वाला नंबर चुनें।`,
    bulkCallSelect: '📞 <b>बल्क कॉल अभियान</b>\n\nएकाधिक लीड्स पर ऑटोमेटेड IVR कॉल लॉन्च करें।\n\n☎️ = बल्क IVR सक्षम नंबर\n\n📱 Caller ID चुनें:',
    audioLibEmpty: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nकोई ऑडियो फ़ाइल नहीं।\n\nIVR अभियानों के लिए ऑडियो फ़ाइल (MP3, WAV, OGG) अपलोड करें।',
    audioLibTitle: (list) => `🎵 <b>ऑडियो लाइब्रेरी</b>\n\n${list}\n\nनया अपलोड करें या मौजूदा हटाएं:`,
    audioUploadPrompt: '🎵 <b>ऑडियो अपलोड</b>\n\nमुझे ऑडियो फ़ाइल (MP3, WAV, OGG) या वॉइस मैसेज भेजें।\n\nIVR अभियानों के लिए आपकी लाइब्रेरी में सेव होगी।',
    audioSaved: (name) => `✅ ऑडियो सेव: <b>${name}</b>\n\nअब आप इसे बल्क कॉल अभियानों में उपयोग कर सकते हैं!`,
    audioDeleted: (name) => `✅ हटाया गया: <b>${name}</b>`,
    audioNamePrompt: () => '✅ ऑडियो प्राप्त!\n\nइसे एक नाम दें:',
    audioNamePromptLib: (size) => `✅ ऑडियो प्राप्त! (${size} KB)\n\nलाइब्रेरी के लिए नाम दें:`,
    audioLibEmptyShort: '🎵 <b>ऑडियो लाइब्रेरी</b>\n\nकोई ऑडियो नहीं। शुरू करने के लिए अपलोड करें।',
    vmRingPrompt: 'वॉइसमेल से पहले फ़ोन कितनी देर बजे?',
    enterValidUrl: 'कृपया http:// या https:// से शुरू होने वाला मान्य URL दर्ज करें।',
    enterAddress: (countryName, addrText) => `✅ भुगतान प्राप्त!\n\n📍 <b>${countryName}</b> में नंबर सक्रिय करने के लिए बिलिंग पता आवश्यक है।\nपता ${addrText || 'आवश्यक'}।\n\nकृपया अपना पता दर्ज करें:\n<code>सड़क, शहर, देश</code>\n\n<i>उदाहरण: 123 मुख्य सड़क, मुंबई, भारत</i>`,
    invalidAddress: '⚠️ कृपया कम से कम दर्ज करें: <code>सड़क, शहर, देश</code>\n\n<i>उदाहरण: 123 मुख्य सड़क, मुंबई, भारत</i>',
    bulkUploadLeads: (phone) => `📱 Caller ID: <b>${phone}</b>\n\n📋 <b>लीड्स अपलोड</b>\n\nएक फ़ाइल (.txt या .csv) भेजें, प्रति पंक्ति एक नंबर।\nवैकल्पिक: <code>नंबर,नाम</code>\n\nया सीधे नंबर पेस्ट करें (प्रति पंक्ति एक):`,
    bulkLeadsLoaded: (count, preview, more, errNote) => `✅ <b>${count} लीड्स लोड!</b>\n\n${preview}${more}${errNote}\n\n🎵 <b>IVR ऑडियो चुनें</b>\n\nलाइब्रेरी से चुनें, नया अपलोड करें, या TTS से बनाएं:`,
    bulkTtsHint: '💡 TTS उपयोग करने के लिए, पहले <b>📢 IVR आउटबाउंड कॉल</b> से ऑडियो बनाएं, या प्री-रिकॉर्डेड अपलोड करें।\n\nलाइब्रेरी से चुनें या अपलोड करें:',
    bulkAudioSelected: (name) => `🎵 ऑडियो: <b>${name}</b>\n\n📋 <b>अभियान मोड</b>\n\n🔗 <b>ट्रांसफर + रिपोर्ट</b> — लीड 1 दबाए तो SIP/फ़ोन पर ब्रिज + रिपोर्ट\n📊 <b>केवल रिपोर्ट</b> — ट्रैकिंग + रिपोर्ट\n\nदोनों मोड पूर्ण परिणाम रिपोर्ट करते हैं।`,
    bulkAudioSavedMode: (name) => `✅ सेव: <b>${name}</b>\n\n📋 <b>अभियान मोड</b>\n\n🔗 <b>ट्रांसफर + रिपोर्ट</b> — 1 दबाने पर आपके फ़ोन पर ब्रिज\n📊 <b>केवल रिपोर्ट</b> — ट्रैकिंग\n\nदोनों मोड रिपोर्ट करते हैं।`,
    bulkTransferPrompt: '🔗 <b>ट्रांसफर मोड</b>\n\nलीड 1 दबाए तो कॉल ट्रांसफर के लिए नंबर दर्ज करें:\n<i>(आपका SIP या कोई भी फ़ोन नंबर)</i>',
    bulkConcurrency: (transferTo) => `${transferTo ? `🔗 ट्रांसफर: <b>${transferTo}</b>\n\n` : '📊 <b>केवल रिपोर्ट</b> — कोई ट्रांसफर नहीं।\n\n'}⚡ <b>कॉनकरेंसी</b>\n\nएक साथ कितने कॉल? (1-20)\nडिफ़ॉल्ट: <b>10</b>`,
    bulkRunning: 'अभियान चल रहा है! आपको यहाँ अपडेट दिखेंगे।\n\n<b>🛑 रोकें</b> पर टैप करें।',
    bulkCancelled: '🛑 <b>अभियान रद्द।</b>\n\nसक्रिय कॉल पूरे होंगे, नए कॉल नहीं होंगे।',
    // ── फ़ोन नंबर चयन और प्रबंधन ──
    selectType: (country) => `📱 <b>${country}</b> के लिए नंबर प्रकार चुनें:\n\n<b>📍 लोकल</b> — एरिया कोड वाला भौगोलिक नंबर\n<b>🆓 टोल-फ्री</b> — 800/888/877 प्रीफिक्स, राष्ट्रीय`,
    selectArea: '🏙️ क्षेत्र चुनें या अपना एरिया कोड दर्ज करें:',
    enterAreaCode: 'एरिया कोड दर्ज करें (जैसे 415):',
    showNumbers: (location, numbers) => {
      let text = `📞 <b>${location}</b> में उपलब्ध नंबर:\n\n`
      numbers.forEach((n, i) => {
        const caps = n._capabilities || n.capabilities || {}
        const voice = caps.voice === true || caps.voice === 'True'
        const sms = caps.sms === true || caps.sms === 'True'
        const fax = caps.fax === true || caps.fax === 'True'
        let capLabel = ''
        if (voice) capLabel += '📞'
        if (sms) capLabel += '💬'
        if (fax) capLabel += '📠'
        text += `${i + 1}️⃣  ${formatPhone(n.phone_number)} ${capLabel}\n`
      })
      text += '\n📞 = वॉइस  💬 = SMS  📠 = फैक्स\nचुनने के लिए नंबर पर टैप करें।'
      return text
    },
    selectPlan: (number) => {
      let text = `✅ चयनित: <b>${formatPhone(number)}</b>\n\n📋 अपना प्लान चुनें:\n\n`
      if (PHONE_STARTER_ON) text += `<b>💡 स्टार्टर — $${PHONE_STARTER_PRICE}/माह</b>\n📞 ${plans.starter.minutes} इनबाउंड मिनट · 📩 ${plans.starter.sms} इनबाउंड SMS · ${plansI18n.hi.starter.features.join(' · ')}\n<b>🎙 IVR / SIP:</b> ❌ <i>शामिल नहीं</i>\n🛡️ <i>14-दिन अपग्रेड क्रेडिट — 14 दिनों में प्रो/बिज़नेस पर अपग्रेड करें और 25% छूट पाएं</i>\n➕ ${SUB_NUMBER_LIMITS.starter} अतिरिक्त नंबर जोड़ें ($${SUB_NUMBER_BASE_PRICE}/माह प्रत्येक से)\n\n`
      if (PHONE_PRO_ON) text += `<b>⭐ प्रो — $${PHONE_PRO_PRICE}/माह</b>\n📞 ${plans.pro.minutes} इनबाउंड मिनट · 📩 ${plans.pro.sms} इनबाउंड SMS · ${plansI18n.hi.pro.features.join(' · ')}\n<b>🎙 IVR / SIP:</b> ✅ <i>त्वरित IVR + बल्क IVR + OTP</i>\n🛡️ <i>14-दिन अपग्रेड क्रेडिट — 14 दिनों में बिज़नेस पर अपग्रेड करें और 25% छूट पाएं</i>\n➕ ${SUB_NUMBER_LIMITS.pro} अतिरिक्त नंबर जोड़ें ($${SUB_NUMBER_BASE_PRICE}/माह प्रत्येक से)\n\n`
      if (PHONE_BUSINESS_ON) text += `<b>👑 बिज़नेस — $${PHONE_BUSINESS_PRICE}/माह</b>\n📞 ${plans.business.minutes} इनबाउंड मिनट · 📩 ${plans.business.sms} इनबाउंड SMS · ${plansI18n.hi.business.features.join(' · ')}\n<b>🎙 IVR / SIP:</b> ✅ <i>प्रो + ऑटो-अटेंडेंट + रिकॉर्डिंग</i>\n➕ ${SUB_NUMBER_LIMITS.business} अतिरिक्त नंबर जोड़ें ($${SUB_NUMBER_BASE_PRICE}/माह प्रत्येक से)\n\n`
      text += `<i>📞 प्लान मिनट केवल इनबाउंड कॉल के लिए हैं।\n💳 आउटबाउंड कॉल और फ़ॉरवर्डिंग वॉलेट से चार्ज होते हैं।\n⚠️ IVR (त्वरित IVR, बल्क IVR, OTP, ऑटो-अटेंडेंट) चाहिए? प्रो या बिज़नेस चुनें — स्टार्टर में IVR शामिल <b>नहीं</b> है।</i>`
      return text
    },
    orderSummary: (number, country, plan, price) => {
      const planKey = plan.name.toLowerCase()
      const features = plansI18n.hi[planKey]?.features || plan.features
      const ivrLine = planKey === 'starter'
        ? `\n\n<i>⚠️ स्टार्टर में IVR (त्वरित IVR, बल्क IVR, OTP, ऑटो-अटेंडेंट) और SIP क्रेडेंशियल्स शामिल <b>नहीं</b> हैं। IVR चाहिए? प्रो या बिज़नेस चुनें।</i>`
        : ''
      const creditLine = planKey === 'starter'
        ? `\n<i>🛡️ 14-दिन अपग्रेड क्रेडिट — 14 दिनों में प्रो/बिज़नेस पर अपग्रेड करें और 25% छूट पाएं</i>`
        : planKey === 'pro'
        ? `\n<i>🛡️ 14-दिन अपग्रेड क्रेडिट — 14 दिनों में बिज़नेस पर अपग्रेड करें और 25% छूट पाएं</i>`
        : ''
      return `📋 <b>ऑर्डर सारांश</b>\n\n📞 ${formatPhone(number)} · ${country}\n📦 ${plan.name} — $${price}/माह\n📩 ${plan.sms} इनबाउंड SMS · 📞 ${plan.minutes} इनबाउंड मिनट\n💳 आउटबाउंड कॉल और फ़ॉरवर्डिंग वॉलेट से चार्ज\n⚡ ${features.join(', ')}\n\n💰 कुल: <b>$${price}</b> (पहला महीना)${creditLine}${ivrLine}`
    },
    paymentPrompt: (price) => `मूल्य: <b>$${price}</b>। भुगतान विधि चुनें:`,
    activated: (number, plan, price, sipUser, sipDomain, expiry) => `🎉 <b>आपका Cloud IVR सक्रिय है!</b>\n\n📞 नंबर: ${formatPhone(number)}\n📦 प्लान: ${plan} ($${price}/माह)\n📅 नवीनीकरण: ${expiry}\n\n━━━ <b>SIP क्रेडेंशियल्स</b> ━━━\n🌐 सर्वर: ${sipDomain}\n👤 उपयोगकर्ता: ${sipUser}\n🔑 पासवर्ड: ●●●●●●●● (देखने के लिए 🔑 SIP क्रेडेंशियल्स उपयोग करें)\n📡 पोर्ट: 5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>त्वरित सेटअप</b> ━━━\n• ब्राउज़र: <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a> पर कॉल करें\n• सॉफ्टफ़ोन: Zoiper/Ooma डाउनलोड करें, SIP क्रेडेंशियल्स दर्ज करें\n• SMS: इनबाउंड SMS स्वचालित रूप से यहाँ फ़ॉरवर्ड होते हैं\n• फ़ॉरवर्डिंग: 📱 मेरे नंबर → कॉल फ़ॉरवर्डिंग से सेट करें`,
    myNumbersList: (numbers) => {
      let text = '📱 <b>आपके Cloud IVR नंबर:</b>\n\n'
      const primaryNumbers = numbers.filter(n => !n.isSubNumber)
      const subNumbers = numbers.filter(n => n.isSubNumber)
      primaryNumbers.forEach((n, i) => {
        const status = n.status === 'active' ? '✅ सक्रिय' : n.status === 'suspended' ? '⚠️ निलंबित' : n.status === 'inactive_released' ? '🚫 निष्क्रिय (प्रदाता द्वारा जारी)' : '🗑️ हटाया गया'
        text += `${i + 1}️⃣  ${formatPhone(n.phoneNumber)}  ${status}\n`
        text += `    ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} प्लान · नवीनीकरण ${shortDate(n.expiresAt)}\n`
        if (n.status === 'inactive_released') {
          const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
          text += `    <i>~${hoursLeft} घंटे में स्वतः हटाया जाएगा · त्रुटि होने पर सहायता से संपर्क करें</i>\n`
        }
        const subs = subNumbers.filter(s => s.parentNumber === n.phoneNumber && (s.status === 'active' || s.status === 'suspended'))
        if (subs.length > 0) {
          subs.forEach(s => {
            const subStatus = s.status === 'active' ? '✅' : '⚠️'
            text += `    ├ ${formatPhone(s.phoneNumber)} ${subStatus} (अतिरिक्त · $${s.planPrice}/माह)\n`
          })
        }
        text += '\n'
      })
      return text
    },
    manageNumber: (n, subCount, subLimit, allNumbers) => {
      const plan = plans[n.plan] || (n.isSubNumber && n.parentNumber ? plans[allNumbers?.find(p => p.phoneNumber === n.parentNumber)?.plan] : null)
      const minLimit = plan?.minutes === 'Unlimited' ? 'असीमित' : (plan?.minutes || 0)
      const smsLimit = plan?.sms || 0
      let minUsed = n.minutesUsed || 0
      let smsUsed = n.smsUsed || 0
      if (allNumbers && allNumbers.length > 0) {
        if (n.isSubNumber && n.parentNumber) {
          const parent = allNumbers.find(p => p.phoneNumber === n.parentNumber && !p.isSubNumber)
          const siblings = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.parentNumber)
          minUsed = (parent?.minutesUsed || 0) + siblings.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (parent?.smsUsed || 0) + siblings.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        } else {
          const subs = allNumbers.filter(s => s.isSubNumber && s.parentNumber === n.phoneNumber)
          minUsed = (n.minutesUsed || 0) + subs.reduce((sum, s) => sum + (s.minutesUsed || 0), 0)
          smsUsed = (n.smsUsed || 0) + subs.reduce((sum, s) => sum + (s.smsUsed || 0), 0)
        }
      }
      const minDisplay = minLimit === 'असीमित' ? `${minUsed} (असीमित)` : `${minUsed} / ${minLimit}`
      const smsDisplay = `${smsUsed} / ${smsLimit}`
      const minWarning = minLimit !== 'असीमित' && minUsed >= minLimit ? `\n💰 <b>अतिरिक्त शुल्क सक्रिय</b> — $${OVERAGE_RATE_MIN}/मिनट (वॉलेट से)` : ''
      const smsWarning = smsUsed >= smsLimit ? `\n💰 <b>अतिरिक्त शुल्क सक्रिय</b> — $${OVERAGE_RATE_SMS}/SMS (वॉलेट से)` : ''
      const hasSms = n.capabilities?.sms !== false && n.features?.sms !== false
      const hasFax = n.capabilities?.fax === true
      const hasVoice = n.capabilities?.voice !== false
      let text = `⚙️ प्रबंधन: <b>${formatPhone(n.phoneNumber)}</b>`
      if (n.isSubNumber) text += ` <i>(अतिरिक्त नंबर)</i>`
      if (n.status === 'inactive_released') {
        const hoursLeft = n._inactiveSince ? Math.max(0, 48 - Math.round((Date.now() - new Date(n._inactiveSince).getTime()) / 3600000)) : '?'
        text += `\n\n🚫 <b>निष्क्रिय — प्रदाता द्वारा जारी</b>\nयह नंबर टेलीकॉम प्रदाता द्वारा हटा दिया गया है और अब कॉल नहीं कर सकता।\nलगभग ${hoursLeft} घंटे में स्वतः हटाया जाएगा।\n\nगलती होने पर तुरंत सहायता से संपर्क करें।`
        return text
      }
      if (n.isSubNumber) {
        text += `\n\nस्थिति: ${n.status === 'active' ? '✅ सक्रिय' : '⚠️ ' + n.status}\nअतिरिक्त नंबर — $${n.planPrice}/माह (${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} प्लान के तहत)`
      } else {
        text += `\n\nस्थिति: ${n.status === 'active' ? '✅ सक्रिय' : '⚠️ ' + n.status}\nप्लान: ${n.plan.charAt(0).toUpperCase() + n.plan.slice(1)} ($${n.planPrice}/माह)`
      }
      if (n.isSubNumber && n.parentNumber) text += `\n🔗 मुख्य नंबर: ${formatPhone(n.parentNumber)}`
      if (hasVoice) text += `\n📞 इनबाउंड मिनट: ${minDisplay}${minWarning}`
      if (hasSms) text += `\n📩 इनबाउंड SMS: ${smsDisplay} (केवल प्राप्ति)${smsWarning}`
      if (hasFax) text += `\n📠 फैक्स: शामिल — इनबाउंड फैक्स Telegram पर फ़ॉरवर्ड`
      if (hasVoice) text += `\n💳 आउटबाउंड कॉल वॉलेट से चार्ज`
      const caps = []
      if (hasVoice) caps.push('वॉइस')
      if (hasSms) caps.push('SMS')
      if (hasFax) caps.push('फैक्स')
      text += `\n📋 क्षमताएँ: ${caps.join(' · ')}`
      if (!n.isSubNumber && subCount !== undefined && subLimit !== undefined) {
        text += `\n➕ अतिरिक्त नंबर: ${subCount} / ${subLimit}`
      }
      if (n.features?.ivr?.enabled && Object.keys(n.features.ivr.options || {}).length === 0) {
        text += `\n\n⚠️ <b>IVR सक्रिय है लेकिन अधूरा</b> — कोई मेनू विकल्प नहीं। कॉलर मेनू को छोड़कर सीधे वॉइसमेल पर चले जाएंगे। विकल्प जोड़ने के लिए <b>🤖 IVR / ऑटो-अटेंडेंट</b> पर टैप करें।`
      }
      if (hasVoice) text += `\n\n🌐 <a href="${CALL_PAGE_URL}">ब्राउज़र में कॉल करें</a>`
      const lastChanged = formatRelativeTime(n.updatedAt, 'hi')
      if (lastChanged) text += `\n<i>🕒 अंतिम बदलाव: ${lastChanged}</i>`
      return text
    },
    // ── अतिरिक्त नंबर ──
    subNumberLimitReached: (plan, limit) => `⚠️ आपने <b>${plan}</b> प्लान की अतिरिक्त नंबर सीमा (${limit} नंबर) पूरी कर ली है।\n\nअधिक नंबरों के लिए उच्च प्लान में अपग्रेड करें।`,
    subNumberOrderSummary: (number, country, parentNumber, price, parentPlan) => `📋 <b>अतिरिक्त नंबर ऑर्डर</b>\n\n📞 नया: ${formatPhone(number)} · ${country}\n🔗 जोड़ा गया: ${formatPhone(parentNumber)} (${parentPlan} प्लान)\n💰 मूल्य: <b>$${typeof price === 'number' ? price.toFixed(2) : price}/माह</b>\n\n⚡ मुख्य प्लान के मिनट और SMS साझा\n🔑 अपने SIP क्रेडेंशियल्स शामिल`,
    subActivated: (number, parentNumber, price, sipUser, sipDomain, expiry) => `🎉 <b>अतिरिक्त नंबर जोड़ा गया!</b>\n\n📞 नंबर: ${formatPhone(number)}\n🔗 जुड़ा हुआ: ${formatPhone(parentNumber)}\n💰 मूल्य: $${typeof price === 'number' ? price.toFixed(2) : price}/माह\n📅 नवीनीकरण: ${expiry}\n\n━━━ <b>SIP क्रेडेंशियल्स</b> ━━━\n🌐 सर्वर: ${sipDomain}\n👤 उपयोगकर्ता: ${sipUser}\n🔑 पासवर्ड: ●●●●●●●● (देखने के लिए 🔑 SIP क्रेडेंशियल्स उपयोग करें)\n📡 पोर्ट: 5060 (UDP/TCP) | 5061 (TLS)\n\n━━━ <b>त्वरित सेटअप</b> ━━━\n• ब्राउज़र: <a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>\n• सॉफ्टफ़ोन: Zoiper/Ooma में SIP सेट करें\n• मिनट और SMS मुख्य नंबर के साथ साझा`,
    adminSubPurchase: (name, number, parentNumber, price, paymentMethod) => `➕ <b>अतिरिक्त नंबर</b>\n👤 ${name}\n📞 ${formatPhone(number)} → ${formatPhone(parentNumber)}\n💰 $${price} · ${paymentMethod}`,
    adminSubPurchasePrivate: (name, number, parentNumber, price, paymentMethod) => `➕ <b>अतिरिक्त नंबर</b>\n👤 ${name}\n📞 नया: ${formatPhone(number)}\n🔗 मुख्य: ${formatPhone(parentNumber)}\n💰 $${price}/माह · ${paymentMethod}`,
    
    // Sub-number flow messages
    subAddNumberHeader: (plan, parentNumber) => `➕ <b>${plan.charAt(0).toUpperCase() + plan.slice(1)} प्लान में नंबर जोड़ें</b>\n📞 मुख्य: ${formatPhone(parentNumber)}\n\n🌍 अपने नए नंबर के लिए देश चुनें:`,
    subNumbersAvailable: '📱 <b>अतिरिक्त नंबर — उपलब्ध</b>',
    subNumberArea: (area) => `📱 <b>अतिरिक्त नंबर — क्षेत्र ${area}</b>`,
    subNumberSelected: (location) => `📱 <b>अतिरिक्त नंबर — ${location}</b>`,
    bulkIvrSupport: '☎️ = बल्क IVR समर्थन',
    tapToSelect: 'चुनने के लिए टैप करें:',
    
    // कॉल फ़ॉरवर्डिंग
    forwardingStatus: (number, config, walletBal) => {
      const status = config?.enabled ? '✅ सक्रिय' : '❌ बंद'
      let text = `📞 <b>कॉल फ़ॉरवर्डिंग</b> — ${formatPhone(number)}\n\nस्थिति: ${status}`
      if (config?.enabled) {
        text += `\n📲 ${formatPhone(config.forwardTo)} · ${config.mode}`
        text += `\n🎵 होल्ड म्यूज़िक: ${config.holdMusic ? 'चालू' : 'बंद'}`
      }
      const rate = config?.forwardTo && config.forwardTo.startsWith('+1') ? OVERAGE_RATE_MIN : CALL_FORWARDING_RATE_MIN
      text += `\n💳 वॉलेट से $${rate}/मिनट चार्ज`
      if (walletBal !== undefined) text += ` · 💳 $${walletBal.toFixed(2)}`
      return text
    },
    enterForwardNumber: (walletBal) => {
      let text = `देश कोड के साथ फ़ॉरवर्डिंग नंबर दर्ज करें (जैसे +14155551234)\n💰 दर: <b>$${CALL_FORWARDING_RATE_MIN}/मिनट</b>`
      if (walletBal !== undefined) {
        text += ` · 💳 $${walletBal.toFixed(2)}`
        if (walletBal < CALL_FORWARDING_RATE_MIN) text += `\n⚠️ पहले 👛 वॉलेट से <b>$25</b> रिचार्ज करें।`
      }
      return text
    },
    forwardingUpdated: (number, forwardTo, mode, walletBal) => {
      let text = `✅ <b>फ़ॉरवर्डिंग सक्रिय</b>\n\n📞 ${formatPhone(number)} → ${formatPhone(forwardTo)}\n📋 ${mode} · $${CALL_FORWARDING_RATE_MIN}/मिनट`
      if (walletBal !== undefined) {
        const estMin = Math.floor(walletBal / CALL_FORWARDING_RATE_MIN)
        text += `\n💳 $${walletBal.toFixed(2)} (~${estMin} मिनट)`
        if (walletBal < 25) text += `\n💡 निर्बाध फ़ॉरवर्डिंग के लिए <b>$25</b> तक रिचार्ज करें।`
      }
      return text
    },
    forwardingBlocked: (number) => `🚫 <b>अवरुद्ध</b> — ${formatPhone(number)} प्रीमियम गंतव्य है।\n💬 <b>सहायता प्राप्त करें</b> पर टैप करके सक्रियण का अनुरोध करें।`,
    forwardingNotRoutable: (number) => `⚠️ ${formatPhone(number)} रूट करने योग्य नहीं है। नंबर जाँचें या 💬 <b>सहायता प्राप्त करें</b> पर टैप करें।`,
    forwardingInsufficientBalance: (walletBal) => `🚫 <b>अपर्याप्त बैलेंस</b>\n\n💳 $${(walletBal || 0).toFixed(2)} · आवश्यक $${CALL_FORWARDING_RATE_MIN}/मिनट\n\n👉 फ़ॉरवर्डिंग सक्रिय करने के लिए 👛 वॉलेट से <b>$25</b> रिचार्ज करें।`,
    forwardingDisabled: (number) => `✅ ${formatPhone(number)} के लिए फ़ॉरवर्डिंग बंद।`,
    // SMS सेटिंग्स
    smsSettingsMenu: (number, config, plan) => {
      const tg = config?.toTelegram ? '✅ चालू' : '❌ बंद'
      const em = config?.toEmail ? '✅ ' + config.toEmail : '❌ बंद'
      const wh = config?.webhookUrl ? '✅ सेट' : '❌ सेट नहीं'
      const canEmail = canAccessFeature(plan, 'smsToEmail')
      const canWebhook = canAccessFeature(plan, 'smsWebhook')
      const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'अज्ञात'
      return `📩 <b>इनबाउंड SMS सेटिंग्स</b> — <b>${formatPhone(number)}</b>\n\n📌 SMS <b>केवल इनबाउंड</b> है — आप SMS प्राप्त कर सकते हैं लेकिन भेज नहीं सकते।\n\n📲 Telegram पर फ़ॉरवर्ड: ${tg}\n📧 ईमेल पर फ़ॉरवर्ड: ${canEmail ? em : `🔒 Pro या उच्चतर प्लान आवश्यक (वर्तमान: ${planName})`}\n🔗 Webhook URL: ${canWebhook ? wh : `🔒 Pro या उच्चतर प्लान आवश्यक (वर्तमान: ${planName})`}`
    },
    smsToggled: (channel, state) => `${channel} अब ${state ? '✅ चालू' : '❌ बंद'} है`,
    // फैक्स सेटिंग्स
    faxSettingsMenu: (number, config, provider) => {
      const tg = config?.toTelegram !== false ? '✅ चालू' : '❌ बंद'
      if (provider === 'twilio') {
        return `📠 <b>फैक्स सेटिंग्स</b> — <b>${formatPhone(number)}</b>\n\n⚠️ <b>इस नंबर प्रकार पर फैक्स उपलब्ध नहीं है।</b>\nइस नंबर के प्रदाता ने फैक्स सेवा बंद कर दी है। इस नंबर पर फैक्स प्राप्त नहीं हो सकते।\n\nफैक्स उपयोग के लिए, समर्थित प्रदाता से फैक्स-सक्षम नंबर खरीदें।`
      }
      return `📠 <b>फैक्स सेटिंग्स</b> — <b>${formatPhone(number)}</b>\n\nइनबाउंड फैक्स PDF के रूप में प्राप्त होते हैं और इस Telegram चैट पर फ़ॉरवर्ड होते हैं।\n\n📲 Telegram पर फ़ॉरवर्ड: ${tg}`
    },
    faxToggled: (state) => `📠 Telegram पर फैक्स अब ${state ? '✅ चालू' : '❌ बंद'} है`,
    faxReceived: (from, to, pages) => `📠 <b>फैक्स प्राप्त</b>\nप्रेषक: ${from}\nप्राप्तकर्ता: ${formatPhone(to)}${pages ? `\nपृष्ठ: ${pages}` : ''}`,
    faxFailed: (from, to, reason) => `📠 <b>फैक्स विफल</b>\nप्रेषक: ${from}\nप्राप्तकर्ता: ${formatPhone(to)}\nकारण: ${reason || 'अज्ञात'}`,
    enterEmail: 'SMS फ़ॉरवर्ड करने के लिए ईमेल पता दर्ज करें:',
    emailSet: (email) => `✅ SMS ईमेल पर फ़ॉरवर्ड सक्रिय!\nसभी इनबाउंड SMS <b>${email}</b> पर भी भेजे जाएँगे।`,
    enterWebhook: 'अपना Webhook URL दर्ज करें (इनबाउंड SMS JSON के रूप में POST होंगे):',
    webhookSet: (url) => `✅ Webhook URL कॉन्फ़िगर!\nSMS POST होंगे: ${url}`,
    // वॉइसमेल
    voicemailMenu: (number, config) => {
      if (!config?.enabled) {
        return `🎙️ <b>${formatPhone(number)}</b> का वॉइसमेल\n\nस्थिति: ❌ बंद\n\nसक्रिय होने पर, अनुत्तरित कॉल पर ग्रीटिंग बजेगी और कॉलर मैसेज छोड़ सकते हैं।`
      }
      const tg = config.forwardToTelegram ? '✅ चालू' : '❌ बंद'
      const em = config.forwardToEmail ? '✅ ' + config.forwardToEmail : '❌ बंद'
      let greetInfo = ''
      if (config.greetingType === 'custom' && config.customAudioGreetingUrl) {
        greetInfo = '🎤 कस्टम ऑडियो'
      } else if (config.greetingType === 'custom' && config.customGreetingText) {
        greetInfo = `📝 कस्टम: "${config.customGreetingText}"`
      } else {
        greetInfo = '🔊 डिफ़ॉल्ट: "आप ' + formatPhone(number) + ' से जुड़े हैं। कृपया बीप के बाद मैसेज छोड़ें।"'
      }
      return `🎙️ <b>${formatPhone(number)}</b> का वॉइसमेल\n\nस्थिति: ✅ सक्रिय\n🎤 ग्रीटिंग: ${greetInfo}\n\n📲 Telegram पर भेजें: ${tg}\n📧 ईमेल पर भेजें: ${em}\n⏰ रिंग टाइम: ${config.ringTimeout || 25}s`
    },
    voicemailEnabled: (number) => `✅ ${formatPhone(number)} के लिए वॉइसमेल सक्रिय!\nरिकॉर्डिंग इस Telegram चैट पर भेजी जाएँगी।`,
    voicemailDisabled: (number) => `✅ ${formatPhone(number)} के लिए वॉइसमेल बंद।`,
    vmGreetingMenu: (number, vm) => {
      let current = ''
      if (vm?.greetingType === 'custom' && vm?.customAudioGreetingUrl) {
        current = '🎤 कस्टम ऑडियो\n📎 ऑडियो फ़ाइल अपलोड'
      } else if (vm?.greetingType === 'custom' && vm?.customGreetingText) {
        current = `📝 कस्टम टेक्स्ट: "${vm.customGreetingText}"`
      } else {
        current = `🔊 डिफ़ॉल्ट: "आप ${formatPhone(number)} से जुड़े हैं। कृपया बीप के बाद मैसेज छोड़ें।"`
      }
      return `🔊 <b>वॉइसमेल ग्रीटिंग</b> — <b>${formatPhone(number)}</b>\n\nवर्तमान: ${current}\n\nएक विकल्प चुनें:`
    },
    vmSendAudioPrompt: '🎤 <b>कस्टम ऑडियो ग्रीटिंग</b>\n\nवॉइसमेल ग्रीटिंग के रूप में वॉइस मैसेज या ऑडियो फ़ाइल भेजें।\n\nकॉलर वॉइसमेल पर पहुँचने पर यह ऑडियो सुनेंगे।\n\n<i>सुझाव: प्रोफेशनल ग्रीटिंग रिकॉर्ड करें जैसे "नमस्ते, आप [नाम] से जुड़े हैं। मैं अभी उत्तर नहीं दे सकता। कृपया बीप के बाद मैसेज छोड़ें।"</i>',
    vmAudioSaved: '✅ कस्टम ऑडियो ग्रीटिंग सेव! कॉलर अब आपकी अपलोड की गई ग्रीटिंग सुनेंगे।',
    vmDefaultRestored: '✅ वॉइसमेल ग्रीटिंग डिफ़ॉल्ट पर रीसेट।',
    vmTextGreetingPrompt: 'कस्टम ग्रीटिंग टेक्स्ट दर्ज करें (टेक्स्ट-टू-स्पीच द्वारा पढ़ा जाएगा):',
    vmTextGreetingSet: (text) => `✅ कस्टम टेक्स्ट ग्रीटिंग सेव!\n\n"${text}"`,
    // SIP
    sipCredentialsMsg: (number, username, domain) => `🔑 <b>${formatPhone(number)}</b> के SIP क्रेडेंशियल्स\n\n🌐 SIP सर्वर: ${domain}\n👤 उपयोगकर्ता: <code>${username}</code>\n🔑 पासवर्ड: ●●●●●●●●\n📡 पोर्ट: 5060 (UDP/TCP) · 5061 (TLS)\n🎵 कोडेक: G.711μ, G.711a, Opus`,
    sipRevealed: (password) => `🔑 पासवर्ड: <code>${password}</code>\n\n⚠️ अभी सेव करें — यह मैसेज 30 सेकंड में हटा दिया जाएगा।`,
    sipReset: (password) => `✅ SIP पासवर्ड रीसेट!\n\n🔑 नया पासवर्ड: <code>${password}</code>\n\n⚠️ अभी सेव करें। अपने सभी SIP डिवाइस पर यह पासवर्ड अपडेट करें।`,
    softphoneGuide: (domain) => `📖 <b>SIP सेटअप गाइड</b>

<b>🌐 ब्राउज़र (सबसे आसान)</b>
सीधे ब्राउज़र में कॉल करें:
<a href="${CALL_PAGE_URL}">${CALL_PAGE_URL.replace('https://', '')}</a>
कोई साइन-अप या ऐप इंस्टॉल नहीं।

<b>📱 सॉफ्टफोन ऐप — अनुशंसित</b>
सिंगल-लाइन सॉफ्टफोन का उपयोग करें (प्रति क्रेडेंशियल एक डिवाइस):
• <b>Linphone</b> — iOS / Android / Mac / Windows / Linux (मुफ्त)
• <b>Zoiper</b> — iOS / Android / डेस्कटॉप (मुफ्त)
• <b>MicroSIP</b> — Windows (मुफ्त, हल्का)
• <b>Bria Solo</b> — सशुल्क, बेहतरीन UI

<b>सेटअप चरण</b>
1. ऐप इंस्टॉल करें
2. अकाउंट जोड़ें → SIP / VoIP
3. उपयोगकर्ता नाम + पासवर्ड (🔑 SIP क्रेडेंशियल्स से)
4. डोमेन / SIP सर्वर: <code>${domain}</code>
5. पोर्ट 5060 (UDP/TCP) या 5061 (TLS) · DTMF: RFC 2833 · कोडेक: G.711μ
6. सेव करें और टेस्ट कॉल करें

⚠️ <b>3CX, FreePBX, Asterisk या अन्य PBX का उपयोग कर रहे हैं?</b>
SIP क्रेडेंशियल को "user / extension" के रूप में न जोड़ें — PBX कॉल को उत्तर देता है और सीधे अपने वॉइसमेल पर भेज देता है (आप "Record your message and press pound, or press star to contact the operator" सुनेंगे, फिर स्टार दबाने पर "transfer failed")। इसके बजाय इसे <b>SIP TRUNK</b> के रूप में कॉन्फ़िगर करें:

<b>3CX उदाहरण</b>
1. SIP Trunks → Add SIP Trunk → "Generic SIP Trunk"
2. Main Trunk No.: आपका Nomadly नंबर (जैसे <code>+18882437690</code>)
3. Registrar / Server / Outbound Proxy: <code>${domain}</code> · पोर्ट <code>5060</code>
4. प्रमाणीकरण: <b>Register/Account based</b>
   Username + Auth ID: आपका <code>gencred…</code> SIP उपयोगकर्ता नाम
   पासवर्ड: आपका SIP पासवर्ड
5. सेव → Inbound Rules → New Inbound Rule → <b>अपने एक्सटेंशन पर रूट करें</b> (वॉइसमेल पर नहीं)
6. Outbound Rules → अपने एक्सटेंशन को इस ट्रंक के माध्यम से रूट करें
7. Apply &amp; reload — टेस्ट कॉल करें

🧪 <b>मुफ्त टेस्ट कॉल:</b>
टेस्ट कोड पाने के लिए यहाँ /testsip भेजें।

❓ अभी भी अटके हैं? 💬 Support पर टैप करें, हम सहायता करेंगे।`,
    // नवीनीकरण
    renewMenu: (number, plan, price, expiry, autoRenewOn) => `🔄 <b>${formatPhone(number)}</b> का प्लान\n\nवर्तमान प्लान: ${plan} — $${price}/माह\nनवीनीकरण तिथि: ${shortDate(expiry)}\nऑटो-रिन्यू: ${autoRenewOn ? '✅ चालू' : '❌ बंद'}`,
    // हटाना
    releaseConfirm: (number) => `🗑️ <b>${formatPhone(number)} हटाएं?</b>\n\n⚠️ <b>यह पूर्ववत नहीं किया जा सकता।</b>\n\n• नंबर स्थायी रूप से हटा दिया जाएगा\n• मासिक प्लान तुरंत रद्द\n• सभी सेटिंग्स (फ़ॉरवर्डिंग, वॉइसमेल, SIP) हटा दी जाएँगी\n• शेष दिनों का कोई रिफंड नहीं\n\nक्या आप सुनिश्चित हैं?`,
    releaseConfirmDigits: (digits) => `⚠️ <b>अंतिम पुष्टि</b>\n\nस्थायी रूप से हटाने के लिए नंबर के अंतिम 4 अंक टाइप करें: <b>${digits}</b>`,
    released: (number) => `✅ ${formatPhone(number)} स्थायी रूप से हटा दिया गया।\n\nप्लान रद्द। सभी सेटिंग्स हटाई गईं।`,
    // रियल-टाइम इवेंट
    inboundSms: (to, from, body, time) => `📩 <b>SMS प्राप्त</b>\n\n📞 प्राप्तकर्ता: ${formatPhone(to)}\n👤 प्रेषक: ${formatPhone(from)}\n🕐 ${time}\n\n💬 "${body}"`,
    missedCall: (to, from, time) => `📞 <b>मिस्ड कॉल</b>\n\n📞 प्राप्तकर्ता: ${formatPhone(to)}\n👤 कॉलर: ${formatPhone(from)}\n🕐 ${time}`,
    callForwarded: (to, from, forwardedTo, duration, time) => `📞 <b>कॉल फ़ॉरवर्ड</b>\n\n📞 प्राप्तकर्ता: ${formatPhone(to)}\n👤 कॉलर: ${formatPhone(from)}\n📲 फ़ॉरवर्ड: ${formatPhone(forwardedTo)}\n⏱️ अवधि: ${formatDuration(duration)}\n🕐 ${time}`,
    newVoicemail: (to, from, duration, time) => `🎙️ <b>नया वॉइसमेल</b>\n\n📞 प्राप्तकर्ता: ${formatPhone(to)}\n👤 कॉलर: ${formatPhone(from)}\n⏱️ अवधि: ${formatDuration(duration)}\n🕐 ${time}`,
    // समाप्ति अनुस्मारक
    expiryReminder: (number, days, plan, price, balance) => `🔔 <b>नवीनीकरण अनुस्मारक</b>\n\nआपका Cloud IVR नंबर ${formatPhone(number)} (${plan} प्लान) <b>${days} दिन</b> में समाप्त हो रहा है।\n\nवॉलेट बैलेंस: $${balance}\nप्लान मूल्य: $${price}/माह${balance < price ? '\n\n⚠️ अपर्याप्त बैलेंस। कृपया रिचार्ज करें।' : ''}`,
    autoRenewed: (number, plan, price, newExpiry, oldBal, newBal) => `✅ <b>ऑटो-नवीनीकरण सफल</b>\n\n📞 ${formatPhone(number)}\n📦 प्लान: ${plan} ($${price}/माह)\n📅 नई समाप्ति: ${shortDate(newExpiry)}\nवॉलेट: $${oldBal} → $${newBal}`,
    autoRenewFailed: (number, plan, price, balance) => `❌ <b>ऑटो-नवीनीकरण विफल</b>\n\n📞 ${formatPhone(number)}\n📦 प्लान: ${plan} ($${price}/माह)\n💰 वॉलेट: $${balance} (आवश्यक $${price})\n\n⚠️ आपका नंबर अब निलंबित है। 7 दिनों के भीतर रिचार्ज करें और नवीनीकरण करें।`,
    // IVR
    ivrMenu: (number, config) => {
      if (!config?.enabled) {
        return `🤖 <b>IVR / ऑटो-अटेंडेंट</b> — <b>${formatPhone(number)}</b>\n\nस्थिति: ❌ बंद\n\nसक्रिय होने पर, कॉलर ग्रीटिंग मेनू सुनेंगे और कुंजी दबाकर सही गंतव्य तक पहुँच सकते हैं।`
      }
      const hasOptions = config.options && Object.keys(config.options).length > 0
      let text = `🤖 <b>IVR / ऑटो-अटेंडेंट</b> — <b>${formatPhone(number)}</b>\n\nस्थिति: ${hasOptions ? '✅ सक्रिय' : '⚠️ सक्रिय (अधूरा)'}\n\n🎤 ग्रीटिंग: "${escapeHtml(config.greeting || 'डिफ़ॉल्ट')}"\n\n📋 <b>मेनू विकल्प:</b>\n`
      if (hasOptions) {
        Object.entries(config.options).forEach(([key, opt]) => {
          let desc
          if (opt.action === 'forward') desc = '📲 फ़ॉरवर्ड ' + formatPhone(opt.forwardTo)
          else if (opt.action === 'voicemail') desc = '🎙️ वॉइसमेल'
          else if (opt.action === 'submenu') {
            const subCount = Object.keys(opt.subMenu?.options || {}).length
            const lbl = opt.label && opt.label.trim() ? opt.label.trim() : `सब-मेनू ${key}`
            desc = `📂 <b>${escapeHtml(lbl)}</b> — सब-मेनू (${subCount} विकल्प)`
          } else desc = '🔊 ' + escapeHtml(opt.message || 'मैसेज चलाएं')
          text += `  <b>${escapeHtml(key)}</b> दबाएं → ${desc}\n`
        })
      } else {
        text += '  ⚠️ <b>अभी तक कोई विकल्प नहीं जोड़ा गया — IVR नहीं चलेगा।</b>\n  कॉलर मेनू को छोड़कर सीधे वॉइसमेल पर चले जाएंगे (या वॉइसमेल बंद होने पर "अनुपलब्ध" सुनेंगे)।\n  कम से कम एक विकल्प जोड़ने के लिए नीचे <b>➕ विकल्प जोड़ें</b> टैप करें (जैसे <code>1 forward +14155551234</code>)।\n'
      }
      return text
    },
    ivrEnabled: (number) => `✅ ${formatPhone(number)} के लिए IVR / ऑटो-अटेंडेंट सक्रिय!\n\nकॉलर आपकी ग्रीटिंग सुनेंगे और कुंजी दबाकर नेविगेट कर सकते हैं।`,
    ivrDisabled: (number) => `✅ ${formatPhone(number)} के लिए IVR / ऑटो-अटेंडेंट बंद।`,
    ivrSetGreeting: 'IVR ग्रीटिंग मैसेज दर्ज करें (कॉलर यही सुनेंगे):\n\nउदाहरण: "कॉल करने के लिए धन्यवाद। सहायता के लिए 1 दबाएं, सेल्स के लिए 2, या लाइन पर रहें।"',
    ivrGreetingSet: (greeting) => `✅ IVR ग्रीटिंग अपडेट!\n\n"${greeting}"`,
    ivrAddOption: 'कुंजी और कार्रवाई इस प्रारूप में दर्ज करें:\n\n<code>कुंजी कार्रवाई गंतव्य</code>\n\nउदाहरण:\n• <code>1 forward +14155551234</code>\n• <code>2 voicemail</code>\n• <code>3 message हम आपको वापस कॉल करेंगे</code>\n• <code>0 forward +14155559999</code>',
    ivrOptionAdded: (key, action, destination) => `✅ IVR विकल्प जोड़ा!\n\n<b>${key}</b> दबाएं → ${action === 'forward' ? '📲 फ़ॉरवर्ड ' + formatPhone(destination) : action === 'voicemail' ? '🎙️ वॉइसमेल' : '🔊 ' + destination}`,
    ivrOptionRemoved: (key) => `✅ कुंजी <b>${key}</b> का IVR विकल्प हटाया।`,
    ivrInvalidFormat: '❌ अमान्य प्रारूप। इस्तेमाल करें:\n<code>कुंजी कार्रवाई गंतव्य</code>\n\nउदाहरण: <code>1 forward +14155551234</code>',
    ivrAnalyticsReport: (number, data, labels) => {
      let text = `📊 <b>IVR एनालिटिक्स</b> — <b>${formatPhone(number)}</b>\n(पिछले 30 दिन)\n\n`
      text += `📞 कुल IVR कॉल: <b>${data.totalCalls}</b>\n`
      const _labelFor = (d) => (labels && labels[d]) ? ` <i>(${escapeHtml(labels[d])})</i>` : ''
      if (data.topOption) text += `🏆 सबसे अधिक दबाई: कुंजी <b>${escapeHtml(data.topOption.digit)}</b>${_labelFor(data.topOption.digit)} (${data.topOption.count} बार, ${data.topOption.percent}%)\n`
      text += '\n'
      if (data.optionBreakdown.length > 0) {
        text += '📋 <b>विकल्प विवरण:</b>\n'
        data.optionBreakdown.forEach(o => {
          const bar = '█'.repeat(Math.max(1, Math.round(o.percent / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(o.percent / 10)))
          text += `  कुंजी <b>${escapeHtml(o.digit)}</b>${_labelFor(o.digit)}: ${bar} ${o.count} (${o.percent}%)\n`
        })
        text += '\n'
      }
      if (data.recentCalls.length > 0) {
        text += '📱 <b>हालिया IVR कॉल:</b>\n'
        data.recentCalls.forEach(c => {
          text += `  ${formatPhone(c.from)} → कुंजी <b>${escapeHtml(c.digit)}</b>${_labelFor(c.digit)} (${escapeHtml(c.action)}) ${shortDate(c.time)}\n`
        })
      }
      if (data.totalCalls === 0) text += '\nकोई IVR कॉल रिकॉर्ड नहीं।'
      return text
    },
    // रिकॉर्डिंग
    recordingMenu: (number, config) => {
      const enabled = config?.recording === true
      return `🔴 <b>कॉल रिकॉर्डिंग</b> — <b>${formatPhone(number)}</b>\n\nस्थिति: ${enabled ? '✅ सक्रिय' : '❌ बंद'}\n\nसक्रिय होने पर, सभी इनकमिंग और आउटगोइंग कॉल स्वचालित रूप से रिकॉर्ड होंगे। रिकॉर्डिंग आपके Telegram चैट पर भेजी जाएँगी।`
    },
    recordingEnabled: (number) => `✅ ${formatPhone(number)} के लिए कॉल रिकॉर्डिंग सक्रिय!\n\nसभी कॉल रिकॉर्ड होंगे और इस चैट पर भेजे जाएँगे।`,
    recordingDisabled: (number) => `✅ ${formatPhone(number)} के लिए कॉल रिकॉर्डिंग बंद।`,
    // SMS इनबॉक्स
    smsInboxHeader: (number, total) => `📨 <b>SMS इनबॉक्स</b> — <b>${formatPhone(number)}</b>\n\n${total === 0 ? 'अभी तक कोई मैसेज नहीं।' : `${total} मैसेज प्राप्त:`}`,
    smsInboxEntry: (i, from, name, body, time) => {
      const nameDisplay = name && name !== 'None' ? ` (${name})` : ''
      const bodyPreview = body.length > 80 ? body.substring(0, 80) + '...' : body
      return `\n<b>${i}.</b> ${formatPhone(from)}${nameDisplay}\n   💬 "${bodyPreview}"\n   🕐 ${time}\n`
    },
    smsInboxEmpty: 'इस नंबर पर अभी तक कोई इनबाउंड SMS नहीं।\n\n<i>जब कोई आपके नंबर पर SMS भेजेगा, मैसेज यहाँ दिखेंगे।</i>',
    smsInboxFooter: (page, totalPages) => totalPages > 1 ? `\n📄 पृष्ठ ${page}/${totalPages}` : '',
    btnUploadAudio: '📎 ऑडियो अपलोड',
    btnConfirm: '✅ पुष्टि करें',
    btnChangeVoice: '🎤 आवाज़ बदलें',
    btnTransferReport: '🔗 ट्रांसफर + रिपोर्ट',
    btnReportOnly: '📊 केवल रिपोर्ट',
    btnStopCampaign: '🛑 अभियान रोकें',
    btnShowStatus: '📊 स्थिति दिखाएं',
    btnUploadNewAudio: '📎 नया अपलोड',
    btnBack: '↩️ वापस',
    testMyNumber: {
      placing: (phone) => `📞 Nomadly टेस्ट लाइन से <code>${phone}</code> पर कॉल कर रहे हैं… अपने सॉफ्टफ़ोन पर उठाएं और घंटी बजने पर <b>1</b> दबाएं (उठाने के बाद ~12 सेकंड का समय है)।\n\nपरिणाम 60 सेकंड के अंदर यहाँ दिखेगा।`,
      successDtmf: (phone) => `✅ <b>आपका SIP डिवाइस चालू है</b> — <code>${phone}</code> पर कॉल एंड-टू-एंड काम कर रही हैं। दूसरे छोर ने कॉल उठाई और एक कुंजी दबाई गई।`,
      voicemail: (phone) => `⚠️ <b>वॉइसमेल / PBX ने कॉल उठाई</b> <code>${phone}</code> पर।\n\nआमतौर पर इसका मतलब है कि कोई PBX (3CX, FreePBX, Asterisk…) कॉल उठा रहा है और आपके एक्सटेंशन को घंटी बजाने के बजाय अपने वॉइसमेल में भेज रहा है।\n\nउपाय: SIP TRUNK सेटअप के लिए /sipguide खोलें, या तुरंत समाधान के लिए सिंगल-लाइन सॉफ्टफ़ोन (Linphone, Zoiper) पर स्विच करें।`,
      answeredNoDtmf: (phone) => `⚠️ <b>कॉल उठी, लेकिन 12 सेकंड में कोई कुंजी नहीं दबाई</b> <code>${phone}</code> पर।\n\nअगर आपने कॉल नहीं उठाई, तो आपके सॉफ्टफ़ोन पर कॉल नहीं पहुंच रही। अगर उठाई पर 1 नहीं दबाया, तो बस फिर से कोशिश करें। अगर PBX (3CX/FreePBX) शामिल है, तो /sipguide देखें।`,
      noAnswer: (phone) => `❌ <b>कोई जवाब नहीं</b> <code>${phone}</code> पर।\n\nसुनिश्चित करें कि आपका सॉफ्टफ़ोन (Linphone / Zoiper / 3CX trunk) रजिस्टर्ड और ऑनलाइन है, फिर दोबारा टेस्ट चलाएं। सेटअप सहायता के लिए /sipguide खोलें।`,
      throttled: (max) => `⏳ आप पिछले 24 घंटों में इस नंबर पर ${max} टेस्ट पहले ही चला चुके हैं। दोबारा टेस्ट करने से पहले कुछ देर रुकें।`,
      inactive: (phone) => `❌ नंबर <code>${phone}</code> सक्रिय नहीं है — टेस्टिंग केवल सक्रिय नंबरों के लिए उपलब्ध है।`,
      placeFailed: (err) => `❌ टेस्ट कॉल नहीं की जा सकी: ${err}`,
    },
    testOutboundSip: {
      listening: (phone, sipUser) => `📤 <b>आउटबाउंड SIP टेस्ट — 90 सेकंड तक सुन रहे हैं</b>\n\n📞 नंबर: <code>${phone}</code>\n🔑 SIP यूज़र: <code>${sipUser}</code>\n\nअपने सॉफ्टफ़ोन से अगले 90 सेकंड में <b>कोई भी नंबर</b> डायल करें — अपना मोबाइल सबसे अच्छा विकल्प है।\n\n💡 कॉल को सुरक्षित रूप से इंटरसेप्ट किया जाएगा: <b>वॉलेट से कोई पैसा नहीं कटेगा</b>, <b>कोई PSTN लेग नहीं बनेगी</b>। हम बस यह सत्यापित करते हैं कि आपके सॉफ्टफ़ोन का आउटबाउंड रास्ता सही SIP क्रेडेंशियल्स के साथ हमारे सर्वर तक पहुंच रहा है।\n\nआपकी कॉल आते ही परिणाम यहाँ दिखेगा।`,
      success: (phone, sipUser, provider, destination, elapsedSec) => `✅ <b>आउटबाउंड SIP सत्यापित</b>\n\nआपके सॉफ्टफ़ोन ने सफलतापूर्वक आउटबाउंड कॉल की।\n\n📞 नंबर: <code>${phone}</code>\n🔑 SIP यूज़र: <code>${sipUser}</code>\n🌐 प्रदाता: <code>${provider}</code>\n📍 आपने डायल किया: <code>${destination}</code>\n⏱️ हमारे सर्वर तक विलंब: ${elapsedSec}s\n\n💡 कॉल को इंटरसेप्ट किया गया — कोई वॉलेट कटौती नहीं, कोई PSTN लेग नहीं। आपका आउटबाउंड SIP रास्ता एंड-टू-एंड काम कर रहा है।`,
      timeout: (phone) => `❌ <b>90 सेकंड में कोई आउटबाउंड SIP कॉल नहीं मिली</b> <code>${phone}</code> पर।\n\nसंभावित कारण:\n• सॉफ्टफ़ोन रजिस्टर नहीं है — Linphone/Zoiper में रजिस्ट्रेशन स्टेटस लाइट जांचें\n• गलत SIP क्रेडेंशियल्स — <b>🔑 SIP क्रेडेंशियल्स</b> के ज़रिए यूज़रनेम + पासवर्ड सत्यापित करें\n• फ़ायरवॉल UDP 5060 / SIP ट्रैफ़िक ब्लॉक कर रहा है\n• PBX (3CX / FreePBX) SIP TRUNK के बजाय यूज़र/एक्सटेंशन के रूप में कॉन्फ़िगर — /sipguide देखें\n\nसॉफ्टफ़ोन में "Registered" दिखने के बाद, दोबारा टेस्ट चलाएं।`,
      throttled: (max) => `⏳ आप पिछले 24 घंटों में इस नंबर पर ${max} आउटबाउंड SIP टेस्ट पहले ही चला चुके हैं। बाद में पुनः प्रयास करें।`,
      inactive: (phone) => `❌ नंबर <code>${phone}</code> सक्रिय नहीं है — आउटबाउंड SIP टेस्ट केवल सक्रिय नंबरों के लिए उपलब्ध है।`,
      noSipConfigured: (phone) => `❌ <code>${phone}</code> पर कोई SIP क्रेडेंशियल्स नहीं। पहले <b>🔑 SIP क्रेडेंशियल्स</b> के ज़रिए SIP सेट करें, फिर पुनः प्रयास करें।`,
    },
  },
}

/** Get translated txt object for a language (falls back to English for missing keys) */
function getTxt(lang) {
  if (!lang || lang === 'en') return txt
  const translations = txtI18n[lang]
  if (!translations) return txt
  // Return a proxy-like merged object: translated values override English
  return new Proxy(txt, {
    get(target, prop) {
      if (translations.hasOwnProperty(prop)) return translations[prop]
      return target[prop]
    }
  })
}

function getMsg(lang) {
  return msg[lang] || msg.en
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Call-flow summary — single source of truth for "what happens when someone calls?"
// Mirrors the priority order in voice-service.js → handleCallAnswered():
//   1. Forwarding(always) — overrides everything (IVR, SIP, VM all skipped)
//   2. IVR — runs if enabled (with options) and forwarding is not "always"
//   3. Forwarding(busy/no_answer) — only reached when IVR is NOT primary
//   4. SIP ring — only reached when IVR is NOT primary
//   5. Voicemail — only reached when nothing else handled the call
//   6. Missed
// Returns: { primary, secondary, skippedFeatures, dormantFeatures, ... }
//   primary    — dominant routing action ('forward_always','ivr','forward_busy',
//                'forward_no_answer','sip_ring','voicemail','missed')
//   secondary  — deterministic fall-throughs after primary (e.g. SIP→Voicemail)
//   skippedFeatures — features ENABLED but FULLY OVERRIDDEN by primary (e.g. IVR while
//                     Always-Forward is on — they are pre-empted by an unconditional override)
//   dormantFeatures — features ENABLED but PRE-EMPTED by primary's routing logic so their
//                     trigger conditions never get checked (e.g. forward(busy) while IVR is on —
//                     IVR returns first, the busy check is never reached). These are softer
//                     warnings than 'skipped' — the user might still want to keep them for
//                     when they later toggle off the primary.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getCallRouteSummary(num) {
  const f = num?.features || {}
  const fwd = f.callForwarding || {}
  const ivr = f.ivr || {}
  const vm = f.voicemail || {}
  const plan = num?.plan || 'starter'
  const hasFwd = !!(fwd.enabled && fwd.forwardTo)
  const fwdMode = fwd.mode || 'always'
  const ivrOptionCount = ivr.options ? Object.keys(ivr.options).length : 0
  const hasIvr = !!(ivr.enabled && canAccessFeature(plan, 'ivr') && ivrOptionCount > 0)
  // IVR is "broken" if enabled but has no options — it's a misconfig, not a primary action
  const hasBrokenIvr = !!(ivr.enabled && canAccessFeature(plan, 'ivr') && ivrOptionCount === 0)
  const hasSip = !!num?.sipUsername && !num?.sipDisabled
  const hasVm = !!(vm.enabled && canAccessFeature(plan, 'voicemail'))

  const skipped = []
  const dormant = []
  let primary, secondary = []

  if (hasFwd && fwdMode === 'always') {
    primary = { action: 'forward_always', forwardTo: fwd.forwardTo }
    if (hasIvr || hasBrokenIvr) skipped.push('ivr')
    if (hasSip) skipped.push('sip_ring')
    if (hasVm) skipped.push('voicemail')
  } else if (hasIvr) {
    primary = { action: 'ivr', options: ivr.options, optionCount: ivrOptionCount }
    // Top-level forward(busy/no_answer) — DORMANT under IVR (IVR returns before the busy/no-answer
    // check is reached in handleCallAnswered). Surface as dormant so user knows it doesn't fire.
    if (hasFwd && fwdMode === 'busy') dormant.push({ feature: 'forward_busy', forwardTo: fwd.forwardTo })
    if (hasFwd && fwdMode === 'no_answer') dormant.push({ feature: 'forward_no_answer', forwardTo: fwd.forwardTo, ringTimeout: fwd.ringTimeout || 25 })
    // SIP ring & voicemail — also dormant under IVR (IVR returns; they only fire if user later disables IVR)
    if (hasSip) dormant.push({ feature: 'sip_ring' })
    if (hasVm) dormant.push({ feature: 'voicemail' })
  } else if (hasFwd && fwdMode === 'busy') {
    primary = { action: 'forward_busy', forwardTo: fwd.forwardTo }
    if (hasSip) secondary.push({ action: 'sip_ring' })
    if (hasVm) secondary.push({ action: 'voicemail' })
  } else if (hasFwd && fwdMode === 'no_answer') {
    primary = { action: 'forward_no_answer', forwardTo: fwd.forwardTo, ringTimeout: fwd.ringTimeout || 25 }
    if (hasSip) secondary.push({ action: 'sip_ring' })
    if (hasVm) secondary.push({ action: 'voicemail' })
  } else if (hasSip) {
    primary = { action: 'sip_ring' }
    if (hasVm) secondary.push({ action: 'voicemail' })
  } else if (hasVm) {
    primary = { action: 'voicemail' }
  } else {
    primary = { action: 'missed' }
  }

  return {
    primary, secondary,
    skippedFeatures: skipped,
    dormantFeatures: dormant,
    hasFwd, hasIvr, hasBrokenIvr, hasSip, hasVm, fwdMode,
    ivrOptionCount,
  }
}

// Short label for a single IVR option's action — used inline in the call-flow preview.
// Example: { '1': {action:'forward', forwardTo:'+1...'} } → "Forward"
function _ivrOptionShortLabel(opt, lang) {
  const labels = {
    en: { forward: 'Forward', message: 'Message', voicemail: 'Voicemail' },
    fr: { forward: 'Transfert', message: 'Message', voicemail: 'Messagerie' },
    zh: { forward: '转接', message: '消息', voicemail: '语音信箱' },
    hi: { forward: 'फ़ॉरवर्ड', message: 'मैसेज', voicemail: 'वॉइसमेल' },
  }
  const tr = labels[lang] || labels.en
  return tr[opt?.action] || opt?.action || '?'
}

// "Press 1→Forward, Press 2→Message, Press 3→Voicemail" — used inside the IVR preview line.
// Caps at 3 enumerated options when there are more, e.g. "Press 1→Forward, Press 2→Message, +3 more"
function formatIvrOptionsInline(options, lang = 'en') {
  if (!options || typeof options !== 'object') return ''
  const keys = Object.keys(options).sort()
  if (keys.length === 0) return ''
  const verbs = { en: 'Press', fr: 'Touche', zh: '按', hi: 'दबाएँ' }
  const press = verbs[lang] || verbs.en
  const more = { en: 'more', fr: 'autres', zh: '更多', hi: 'और' }
  const moreLabel = more[lang] || more.en
  const cap = 3
  const shown = keys.slice(0, cap).map(k => `${press} <b>${k}</b>→${_ivrOptionShortLabel(options[k], lang)}`).join(', ')
  if (keys.length > cap) return `${shown}, +${keys.length - cap} ${moreLabel}`
  return shown
}

// Plain-English (or localized) one-liner preview of the call flow.
// Used at the top of Forwarding/IVR/Voicemail screens so users see exactly what callers experience.
function formatCallFlowPreview(num, lang = 'en') {
  const summary = getCallRouteSummary(num)
  const p = summary.primary
  const fmt = formatPhone

  const L = {
    en: {
      forwardAlways: (n) => `🧭 <b>Currently:</b> All calls auto-forward to <b>${fmt(n)}</b>. IVR & voicemail won't play.`,
      ivrFirst: () => `🧭 <b>Currently:</b> Callers hear your IVR menu first.`,
      ivrWithOptions: (opts) => `🧭 <b>Currently:</b> Callers hear your IVR menu (${opts}).`,
      ivrBroken: () => `🧭 <b>Currently:</b> IVR is enabled but has no menu options yet — callers will hang up. Add options or disable IVR.`,
      fwdBusy: (n) => `🧭 <b>Currently:</b> Calls forward to <b>${fmt(n)}</b> only when busy.`,
      fwdNoAns: (n, t) => `🧭 <b>Currently:</b> Calls forward to <b>${fmt(n)}</b> if no answer in ${t}s.`,
      sipRing: () => `🧭 <b>Currently:</b> Calls ring your SIP/softphone device.`,
      voicemail: () => `🧭 <b>Currently:</b> Callers go straight to voicemail.`,
      missed: () => `🧭 <b>Currently:</b> No features enabled — callers hear "number unavailable".`,
      skippedLabels: { ivr: 'IVR', sip_ring: 'SIP', voicemail: 'voicemail' },
      skipsLine: (labels) => `\n⚠️ ${labels.join(', ')} ${labels.length === 1 ? 'is' : 'are'} enabled but skipped.`,
      dormantLabels: { forward_busy: 'Forward-when-busy', forward_no_answer: 'Forward-on-no-answer', sip_ring: 'SIP ring', voicemail: 'Voicemail' },
      dormantLine: (labels) => `\n💤 ${labels.join(', ')} ${labels.length === 1 ? 'is' : 'are'} dormant — IVR catches every call first.`,
    },
    fr: {
      forwardAlways: (n) => `🧭 <b>Actuellement :</b> Tous les appels sont transférés vers <b>${fmt(n)}</b>. SVI et messagerie ne se déclenchent pas.`,
      ivrFirst: () => `🧭 <b>Actuellement :</b> Les appelants entendent votre menu SVI en premier.`,
      ivrWithOptions: (opts) => `🧭 <b>Actuellement :</b> Les appelants entendent votre menu SVI (${opts}).`,
      ivrBroken: () => `🧭 <b>Actuellement :</b> SVI activé mais sans option — les appelants raccrocheront. Ajoutez des options ou désactivez le SVI.`,
      fwdBusy: (n) => `🧭 <b>Actuellement :</b> Transfert vers <b>${fmt(n)}</b> en cas d'occupation.`,
      fwdNoAns: (n, t) => `🧭 <b>Actuellement :</b> Transfert vers <b>${fmt(n)}</b> sans réponse en ${t}s.`,
      sipRing: () => `🧭 <b>Actuellement :</b> Les appels font sonner votre poste SIP.`,
      voicemail: () => `🧭 <b>Actuellement :</b> Les appelants tombent directement sur la messagerie.`,
      missed: () => `🧭 <b>Actuellement :</b> Aucune fonction activée — les appelants entendent « numéro indisponible ».`,
      skippedLabels: { ivr: 'SVI', sip_ring: 'SIP', voicemail: 'messagerie' },
      skipsLine: (labels) => `\n⚠️ ${labels.join(', ')} activé(e) mais ignoré(e).`,
      dormantLabels: { forward_busy: 'Transfert-si-occupé', forward_no_answer: 'Transfert-sans-réponse', sip_ring: 'Sonnerie SIP', voicemail: 'Messagerie' },
      dormantLine: (labels) => `\n💤 ${labels.join(', ')} dormant — le SVI intercepte tous les appels.`,
    },
    zh: {
      forwardAlways: (n) => `🧭 <b>当前：</b>所有来电自动转接至 <b>${fmt(n)}</b>。IVR 与语音信箱不会播放。`,
      ivrFirst: () => `🧭 <b>当前：</b>来电首先听到您的 IVR 菜单。`,
      ivrWithOptions: (opts) => `🧭 <b>当前：</b>来电听到您的 IVR 菜单（${opts}）。`,
      ivrBroken: () => `🧭 <b>当前：</b>IVR 已启用但没有菜单选项 — 来电会直接挂断。请添加选项或关闭 IVR。`,
      fwdBusy: (n) => `🧭 <b>当前：</b>占线时转接至 <b>${fmt(n)}</b>。`,
      fwdNoAns: (n, t) => `🧭 <b>当前：</b>${t}秒未接听则转接至 <b>${fmt(n)}</b>。`,
      sipRing: () => `🧭 <b>当前：</b>来电响铃您的 SIP/软电话。`,
      voicemail: () => `🧭 <b>当前：</b>来电直接进入语音信箱。`,
      missed: () => `🧭 <b>当前：</b>未启用任何功能 — 来电将听到 "号码不可用"。`,
      skippedLabels: { ivr: 'IVR', sip_ring: 'SIP', voicemail: '语音信箱' },
      skipsLine: (labels) => `\n⚠️ 已启用但被跳过：${labels.join('、')}。`,
      dormantLabels: { forward_busy: '占线转接', forward_no_answer: '无应答转接', sip_ring: 'SIP 振铃', voicemail: '语音信箱' },
      dormantLine: (labels) => `\n💤 ${labels.join('、')}处于休眠 — IVR 拦截所有来电。`,
    },
    hi: {
      forwardAlways: (n) => `🧭 <b>अभी:</b> सभी कॉल <b>${fmt(n)}</b> पर ऑटो-फ़ॉरवर्ड होंगे। IVR और वॉइसमेल नहीं चलेंगे।`,
      ivrFirst: () => `🧭 <b>अभी:</b> कॉलर पहले आपका IVR मेनू सुनेंगे।`,
      ivrWithOptions: (opts) => `🧭 <b>अभी:</b> कॉलर आपका IVR मेनू सुनेंगे (${opts})।`,
      ivrBroken: () => `🧭 <b>अभी:</b> IVR चालू पर कोई विकल्प नहीं — कॉलर कट जाएंगे। विकल्प जोड़ें या IVR बंद करें।`,
      fwdBusy: (n) => `🧭 <b>अभी:</b> व्यस्त होने पर <b>${fmt(n)}</b> पर फ़ॉरवर्ड।`,
      fwdNoAns: (n, t) => `🧭 <b>अभी:</b> ${t}s तक उत्तर न मिले तो <b>${fmt(n)}</b> पर फ़ॉरवर्ड।`,
      sipRing: () => `🧭 <b>अभी:</b> कॉल आपके SIP/सॉफ्टफ़ोन पर बजेगा।`,
      voicemail: () => `🧭 <b>अभी:</b> कॉलर सीधे वॉइसमेल पर जाएंगे।`,
      missed: () => `🧭 <b>अभी:</b> कोई फीचर सक्रिय नहीं — "नंबर अनुपलब्ध" सुनाई देगा।`,
      skippedLabels: { ivr: 'IVR', sip_ring: 'SIP', voicemail: 'वॉइसमेल' },
      skipsLine: (labels) => `\n⚠️ चालू है पर छोड़ा जाएगा: ${labels.join(', ')}।`,
      dormantLabels: { forward_busy: 'Forward-व्यस्त', forward_no_answer: 'Forward-no-answer', sip_ring: 'SIP रिंग', voicemail: 'वॉइसमेल' },
      dormantLine: (labels) => `\n💤 ${labels.join(', ')} सुप्त — IVR सभी कॉल पहले पकड़ता है।`,
    },
  }
  const tr = L[lang] || L.en

  let line
  switch (p.action) {
    case 'forward_always': line = tr.forwardAlways(p.forwardTo); break
    case 'ivr': {
      const optsInline = formatIvrOptionsInline(p.options, lang)
      line = optsInline ? tr.ivrWithOptions(optsInline) : tr.ivrFirst()
      break
    }
    case 'forward_busy': line = tr.fwdBusy(p.forwardTo); break
    case 'forward_no_answer': line = tr.fwdNoAns(p.forwardTo, p.ringTimeout); break
    case 'sip_ring': line = tr.sipRing(); break
    case 'voicemail': line = tr.voicemail(); break
    default: line = summary.hasBrokenIvr ? tr.ivrBroken() : tr.missed()
  }

  // Skipped features (fully overridden — Always-Forward case)
  if (summary.skippedFeatures.length > 0) {
    const labels = summary.skippedFeatures.map(s => tr.skippedLabels[s] || s)
    line += tr.skipsLine(labels)
  }
  // Dormant features (pre-empted by IVR — softer warning, doesn't fire but isn't a misconfig)
  if (summary.dormantFeatures.length > 0) {
    const labels = summary.dormantFeatures.map(d => tr.dormantLabels[d.feature] || d.feature)
    line += tr.dormantLine(labels)
  }
  return line
}

module.exports = {
  btn,
  txt,
  msg,
  getMsg,
  getBtn,
  getTxt,
  getBtnLabel,
  isBtnMatch,
  btnKeyOf,
  escapeHtml,
  plans,
  plansI18n,
  planByButton,
  planFeatureAccess,
  canAccessFeature,
  upgradeMessage,
  isPlanAvailable,
  comingSoonText,
  planAvailability,
  countries,
  twilioCountries,
  allCountries,
  moreCountries,
  countryByName,
  usAreaCodes,
  areaByLabel,
  formatPhone,
  maskPhone,
  formatDuration,
  shortDate,
  generateSipUsername,
  generateSipPassword,
  PHONE_STARTER_PRICE,
  PHONE_PRO_PRICE,
  PHONE_BUSINESS_PRICE,
  SIP_DOMAIN,
  getSipDomainForNumber,
  OVERAGE_RATE_SMS,
  OVERAGE_RATE_MIN,
  CALL_FORWARDING_RATE_MIN,
  CALL_CONNECTION_FEE,
  BLOCKED_FORWARDING_PREFIXES,
  isBlockedPrefix,
  SUB_NUMBER_BASE_PRICE,
  SUB_NUMBER_MARKUP,
  SUB_NUMBER_LIMITS,
  getSubNumberLimit,
  getCallRouteSummary,
  formatCallFlowPreview,
  formatIvrOptionsInline,
  computeUpgradeQuote,
  nextUpgradePlan,
  PLAN_UPGRADE_CREDIT_AGE_DAYS,
  PLAN_UPGRADE_CREDIT_PCT,
}
