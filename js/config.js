const { areasOfCountry, carriersOf, countryCodeOf } = require('./areasOfCountry')
const { buildChooseSubscription } = require('./lang/plan-copy')

const format = (cc, n) => `+${cc}(${n.toString().padStart(2, '0')})`

/* global process */
require('dotenv').config()
const HIDE_BANK_PAYMENT = process.env.HIDE_BANK_PAYMENT
const SELF_URL = process.env.SELF_URL
const FREE_LINKS = Number(process.env.FREE_LINKS)
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME
const PRICE_BITLY_LINK = Number(process.env.PRICE_BITLY_LINK) || 0.1

// USDT (TRC20) requires a higher minimum to comfortably cover the network's
// TRX-energy fees the customer pays on the receiving side. Below this floor a
// meaningful chunk of the deposit is consumed by network fees alone — so we
// intercept the wallet-deposit flow and offer a one-tap top-up to this value.
// Applies ONLY to wallet deposits (not direct-product TRC20 payments).
const TRC20_MIN_DEPOSIT_USD = 20

// Per-coin minimum wallet-deposit floor (USD). 2026-06-18 open-ended deposit
// flow: user no longer types an amount — they just send whatever they want.
// We enforce these minimums at WEBHOOK RECEIPT time:
//   • receivedUsd >= floor → credit at actual market value (full amount)
//   • receivedUsd <  floor → FORFEIT (logged to `dustDeposits`, no wallet
//                              credit, no user notification). Operator can
//                              elect to refund manually if desired.
//
// Keys are the internal ticker strings (see lang/en.js tickerOf values).
// Anything not in the map falls back to `WALLET_DEPOSIT_MIN_DEFAULT_USD`.
const WALLET_DEPOSIT_MIN_DEFAULT_USD = 10
const WALLET_DEPOSIT_MIN_PER_COIN = {
  btc:         10,
  ltc:         10,
  doge:        10,
  bch:         10,
  eth:         10,
  trx:         10,
  trc20_usdt:  TRC20_MIN_DEPOSIT_USD,  // $20 — TRX-energy fee
  erc20_usdt:  10,
}

const walletDepositMinFor = (internalTicker) => {
  return WALLET_DEPOSIT_MIN_PER_COIN[internalTicker] || WALLET_DEPOSIT_MIN_DEFAULT_USD
}

const HIDE_SMS_APP = process.env.HIDE_SMS_APP
const HIDE_BECOME_RESELLER = process.env.HIDE_BECOME_RESELLER
const TG_HANDLE = process.env.TG_HANDLE
const TG_CHANNEL = process.env.TG_CHANNEL
const SMS_APP_NAME = process.env.SMS_APP_NAME
const SMS_APP_LINK = process.env.SMS_APP_LINK
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

const discountOn = {}
discountOn['SA0'] = 10 // Percent
discountOn['BU0'] = 5 // Percent
discountOn['STA158'] = 15 // Percent
discountOn['FR10'] = 10 // Percent
discountOn['GLK5'] = 5 // Percent

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
  broadcastSettings: '⚙️ Broadcast Settings',
}
const user = {
  // main keyboards
  cPanelWebHostingPlans: 'Russia HostPanel Hosting Plans 🔒',
  pleskWebHostingPlans: 'Russia Plesk Hosting Plans 🔒',
  joinChannel: '📢 Join Channel',
  phoneNumberLeads: '🎯 Targeted Leads & Validation',
  wallet: '👛 My Wallet',
  urlShortenerMain: `🔗✂️ URL Shortener - ${FREE_LINKS} Trial Links`,
  buyPlan: '⚡ Upgrade Plan',
  domainNames: '🌐 Domain Names',
  viewPlan: '🔔 My Plan',
  becomeReseller: '💼 Become A Reseller',
  getSupport: '💬 Get Support',
  freeTrialAvailable: '📧🆓 BulkSMS -Trial',
  changeSetting: '🌍 Change Settings',
  hostingDomainsRedirect: '🛡️🔥 Anti-Red Hosting',
  cloudPhone: '📞☁️ Cloud Phone + SIP',

  // Sub Menu 1: urlShortenerMain
  redSelectUrl: '🔀✂️ Redirect & Shorten',
  redBitly: `✂️ Bit.ly $${PRICE_BITLY_LINK}`,
  redShortit: '✂️ Shortit (Trial)',
  urlShortener: '✂️🌐 Custom Domain Shortener',
  viewShortLinks: '📊 View Shortlink Analytics',
  activateDomainShortener: '🔗 Activate Domain for Shortener',

  // Sub Menu 6: Digital Products
  digitalProducts: '🛒 Digital Products',

  // Sub Menu 2: domainNames
  buyDomainName: '🛒🌐 Buy Domain Names',
  viewDomainNames: '📂 My Domain Names',
  dnsManagement: '🔧 DNS Management',

  // Nameserver selection for standalone domain purchase
  nsProviderDefault: '🔒 Standard DNS',
  nsCloudflare: '🛡️ Cloudflare DNS',
  nsCustom: '⚙️ Custom DNS',

  // Sub Menu 3: cPanel/Plesk WebHostingPlansMain
  freeTrial: '💡 Free Trial',
  premiumWeekly: '⚡ Premium Anti-Red (1-Week)',
  premiumCpanel: '🔷 Premium Anti-Red HostPanel (30 Days)',
  goldenCpanel: '👑 Golden Anti-Red HostPanel (30 Days)',
  contactSupport: '📞 Contact Support',

  // Free Trial
  freeTrialMenuButton: '🚀 Free Trial (12 Hours)',
  getFreeTrialPlanNow: '🛒 Get Trial Plan Now',
  continueWithDomainNameSBS: (websiteName) => `➡️ Continue with ${websiteName}`,
  searchAnotherDomain: `🔍 Search Another Domain`,
  privHostNS: `🏢 PrivHost (Fast & Secure Hosting)`,
  cloudflareNS: `🛡️ Cloudflare Shield (Security & Stealth)`,
  backToFreeTrial: '⬅️ Back To Free Trial',

  // Paid Plans
  buyPremiumWeekly: '🛒 Buy Premium Anti-Red (1-Week)',
  buyPremiumCpanel: '🛒 Buy Premium Anti-Red HostPanel',
  buyGoldenCpanel: '🛒 Buy Golden Anti-Red HostPanel',
  viewPremiumWeekly: '⚡ View Premium Weekly',
  viewPremiumCpanel: '🔷 View Premium HostPanel',
  viewGoldenCpanel: '👑 View Golden HostPanel',
  backToHostingPlans: '⬅️ Back To Hosting Plans',
  registerANewDomain: '🌐 Register a New Domain',
  useMyDomain: '📂 Use My Domain',
  connectExternalDomain: '🔗 Connect External Domain',
  useExistingDomain: '🔄 Use Existing Domain',
  backToStarterPlanDetails: '⬅️ Back to Starter Plan Details',
  backToProPlanDetails: '⬅️ Back to Pro Plan Details',
  backToBusinessPlanDetails: '⬅️ Back to Business Plan Details',
  continueWithDomain: (websiteName) => `➡️ Continue with ${websiteName}`,
  enterAnotherDomain: '🔍 Enter Another Domain',
  backToPurchaseOptions: '⬅️ Back to Purchase Options',
  myHostingPlans: '📋 My Hosting Plans',
  viewHostingPlan: (domain) => `🔍 ${domain}`,
  revealCredentials: '🔑 Show Credentials',
  renewHostingPlan: '🔄 Renew Plan',
  backToMyHostingPlans: '⬅️ Back to My Plans',
}
const u = {
  // other key boards
  deposit: '➕💵 Deposit',
  withdraw: '➖💵 Withdraw',
  txHistory: '📜 Transactions',

  // wallet
  usd: 'USD',
  ngn: 'NGN',
}
const view = num => Number(num).toFixed(2)
const yesNo = ['Yes', 'No']

const bal = (usd, ngn) =>
  HIDE_BANK_PAYMENT !== 'true'
    ? `$${view(usd)}
₦${view(ngn)}`
    : `$${view(usd)}`

const t = {
  becomeReseller: (() => {
    const services = ['URL Shortening', 'Domain Registration']
    if (process.env.PHONE_SERVICE_ON === 'true') services.push('Cloud Phone')
    if (HIDE_SMS_APP !== 'true') services.push('BulkSMS')
    if (process.env.OFFSHORE_HOSTING_ON !== 'false') services.push('Anti-Red Hosting')
    return `<b>Become a ${CHAT_BOT_BRAND} Reseller</b>

Resell our full suite — ${services.join(', ')} — under your brand.

<b>65/35%</b> profit share on every sale. Tap 💬 <b>Get Support</b> to get started.`
  })(),
  resetLoginAdmit: `${CHAT_BOT_BRAND} SMS: You have been successfully logged out of your previous device.Please login now`,
  resetLoginDeny: 'Ok sure. No further action required.',
  resetLogin: `${CHAT_BOT_BRAND}SMS: Are you trying to log out of your previous device?`,
  select: `Please select an option:`,
  urlShortenerSelect: `Shorten, brand, or track your links:`,

// cPanel/Plesk Plans initial select plan text
  selectPlan: `Please select a plan:`,
  backButton: '⬅️ Back',
  yesProceedWithThisEmail: (email) => `➡️ Proceed with ${email}`,
  proceedWithPayment: '➡️ Proceed with Payment',
  iHaveSentThePayment: `I Have Sent the Payment ✅`,
// Free Plan
  trialAlreadyUsed: `You have already utilized your free trial. If you need more access, please consider subscribing to one of our paid plans.`,
  oneHourLeftToExpireTrialPlan: `Your Freedom Plan will expire in 1 hour. If you’d like to continue using our services, consider upgrading to a paid plan!`,
  freePlanExpired: `🚫 Your Freedom Plan has expired. We hope you enjoyed your trial,
To continue using our services, please buy one of our premium plans.`,
  freeTrialPlanSelected: (hostingType) => `
- Try our <b>Freedom Plan</b> for free! This plan includes a free domain
  ending in .sbs and will be active for 12 hours.

🚀 <b>Freedom Plan:</b>
<b>- Storage:</b> 1 GB SSD
<b>- Bandwidth:</b> 10 GB
<b>- Domains:</b> 1 free .sbs domain
<b>- Email Accounts:</b> 1 email account
<b>- Databases:</b> 1 MySQL database
<b>- Free SSL:</b> Yes
<b>- HostPanel Features:</b> Full access to HostPanel for managing files,
  database & emails etc.
<b>- Duration:</b> Active for 12 hours
<b>- Ideal for:</b> Testing and short-term projects.
  `,
  getFreeTrialPlan: `Please enter your desired domain name (e.g., example.sbs) and send it as a message. This domain will end in .sbs and is free with your trial plan.`,
  trialPlanContinueWithDomainNameSBSMatched: (websiteName) => `The domain ${websiteName} is available!`,
  trialPlanSBSDomainNotMatched: `The domain you entered could not be found. Please ensure the right domain or try using a different one.`,
  trialPlanSBSDomainIsPremium: `Domain is premium price and available only with a paid plan. Please search for another domain.`,
  trialPlanGetNowInvalidDomain: 'Please enter a valid domain name that ends with \'.sbs\'. The domain should look like \'example.sbs\' and is free with your trial plan.',
  trialPlanNameserverSelection: (websiteName) => `Please select the nameserver provider you would like to use for ${websiteName}.`,
  trialPlanDomainNameMatched: `Please provide your email address to create your account and send your receipt.`,
  confirmEmailBeforeProceedingSBS: (email) => `Are you sure you want to proceed with this ${email} email for the Freedom Plan subscription?`,
  trialPlanInValidEmail: 'Please provide a valid email',
  trialPlanActivationConfirmation: `Thank you! Your free trial plan will be activated shortly. Please note, this plan will be active for 12 hours only.`,
  trialPlanActivationInProgress: `Your free trial plan is being activated. This may take a few moments…`,

  what: `That option isn't available right now. Please pick from the buttons below.`,
  whatNum: `That doesn't look right. Please enter a valid number.`,
  phoneGenTimeout: 'Timeout',
  phoneGenNoGoodHits: `Please contact support ${SUPPORT_HANDLE} or select another area code`,

  subscribeRCS: p =>
    `Subscribed! Unsubscribe anytime by clicking the <a href="${SELF_URL}/unsubscribe?a=b&Phone=${p}">link</a>`,
  unsubscribeRCS: p =>
    `You are unsubscribed! To subscribe again click on the <a href="${SELF_URL}/subscribe?a=b&Phone=${p}">link</a>`,
  argsErr: `dev: sent wrong args`,
  showDepositNgnInfo:
    ngn => `Please remit ${ngn} NGN by clicking “Make Payment” below. Once the transaction has been confirmed, you will be promptly notified, and your wallet will be updated.

Best regards,
${CHAT_BOT_NAME}`,

  askEmail: `Please provide an email for payment confirmation.`,
  askValidAmount: 'Please enter a valid amount.',
  askValidEmail: 'Please provide a valid email',
  askValidCrypto: 'Please choose a valid crypto currency',
  askValidPayOption: 'Please choose a valid payment option',
  chooseSubscription: buildChooseSubscription('en'),

  askCoupon: usd =>
    `The price is $${view(usd)}. Would you like to apply a coupon code? If you have one, please enter it now. Otherwise, you can press 'Skip'.`,
  planAskCoupon: `Would you like to apply a coupon code? If you have one, please enter it now. Otherwise, you can press 'Skip'.`,
  enterCoupon: `Please enter a coupon code:`,
  planPrice: (plan, price) => `Price of ${plan} subscription is $${price} Please choose payment method.`,
  planNewPrice: (plan, price, newPrice) =>
    `Price of ${plan} subscription is now $${view(newPrice)} <s>($${price})</s> Please choose payment method.`,

  domainPrice: (domain, price) => `Price of ${domain} is ${price} USD. Choose payment method.`,
  domainNewPrice: (domain, price, newPrice) =>
    `Price of ${domain} is now $${view(newPrice)} <s>($${price})</s> Choose payment method.`,

  couponInvalid: `Invalid coupon code, Please enter your coupon code again:`,

  lowPrice: `Sent price less than needed`,

  freeTrialAvailable: `Your BulkSMS free trial is now enabled. Please download the ${SMS_APP_NAME} Android App here: ${SMS_APP_LINK}. Need E-sim cards? Contact ${SUPPORT_HANDLE}`,

  freeTrialNotAvailable: 'You have already used the free trial',

  planSubscribed:
    HIDE_SMS_APP === 'true'
      ? `You have successfully subscribed to our {{plan}} plan! Enjoy free USA phone number validations and unlimited URL shortening. Need E-sim card? contact ${SUPPORT_HANDLE}`
      : `You have successfully subscribed to our {{plan}} plan! Enjoy free USA phone validations, unlimited URL shortening, and ${SMS_APP_NAME}. Please download the app here: ${SMS_APP_LINK}. Need E-sim card? contact ${SUPPORT_HANDLE}`,

  alreadySubscribedPlan: days => `Your subscription is active and expires in ${days}`,

  payError: `Payment session not found, please try again or contact support ${SUPPORT_USERNAME}. Discover more ${TG_HANDLE}.`,

  chooseFreeDomainText: `<b>Great News!</b> This domain is available for free with your subscription. Would you like to claim it?`,

  chooseDomainToBuy: text =>
    `<b>Claim Your Corner of the Web!</b>  Please share the domain name you wish to purchase, like "abcpay.com".${text}`,
  askDomainToUseWithShortener: `Use this domain as a <b>custom URL shortener</b>?

<b>Yes</b> — Auto-configure DNS. Short links become <code>yourdomain.com/abc</code>.

<b>No</b> — Register only. Enable shortener anytime from Manage Domains.`,
  blockUser: `Please share the username of the user that needs to be blocked.`,
  unblockUser: `Please share the username of the user that needs to be unblocked.`,
  blockedUser: `You are currently blocked from using the bot. Please contact support ${SUPPORT_USERNAME}. Discover more ${TG_HANDLE}.`,

  greet: `${CHAT_BOT_BRAND} — shorten URLs, register domains, buy phone leads, digital products (Twilio, Telnyx, Google Workspace, Zoho Mail, eSIM) and grow your business. All from Telegram.

Get started with ${FREE_LINKS} trial Shortit links — /start
Support: ${SUPPORT_USERNAME}`,

  linkExpired: `Your ${CHAT_BOT_BRAND} trial has ended and your short link is deactivated. We invite you to subscribe to maintain access to our URL service and free domain names. Choose a suitable plan and follow the instructions to subscribe. Please Contact us for any queries.
Best,
${CHAT_BOT_BRAND} Team
Discover more: ${TG_CHANNEL}`,

  successPayment: `Payment Processed Successfully! You can now close this window.`,

  welcome: `Thank you for choosing ${CHAT_BOT_NAME}! Please choose an option below:`,
  welcomeFreeTrial: `Welcome to ${CHAT_BOT_BRAND}! You have ${FREE_LINKS} trial Shortit links to shorten URLs. Subscribe for unlimited Shortit links, free USA phone validations, and more. Experience the ${CHAT_BOT_BRAND} difference!`,

  unknownCommand: `Command not found. Press /start or Please contact support ${SUPPORT_USERNAME}. Discover more ${TG_HANDLE}.`,

  support: `Please contact support ${SUPPORT_USERNAME}. Discover more ${TG_HANDLE}.`,

  joinChannel: `Please Join Channel ${TG_CHANNEL}`,

  dnsPropagated: `DNS Propagation for {{domain}} is completed for unlimited URL Shortening.`,

  dnsNotPropagated: `DNS propagation for {{domain}} is in progress and you will be updated once it completes. ✅`,

  domainBoughtSuccess: domain => `Domain ${domain} is now yours. Thank you for choosing us.

Best,
${CHAT_BOT_NAME}`,

  domainBought: `Your domain {{domain}} is now linked to your account while DNS propagates. You will be updated automatically about the status momentarily.🚀`,

  domainLinking: domain =>
    `Linking domain with your account. Please note that DNS updates can take up to 30 minutes. You can check your DNS update status here: https://www.whatsmydns.net/#A/${domain}`,

  errorSavingDomain: `Error saving domain in server, contact support ${SUPPORT_USERNAME}. Discover more ${TG_HANDLE}.`,

  chooseDomainToManage: `Please select a domain if you wish to manage its DNS settings.`,

  chooseDomainWithShortener: `Please select or buy the domain name you would like to connect with your shortened link.`,

  viewDnsRecords: `Here are DNS Records for {{domain}}`,
  addDns: 'Add DNS Record',
  updateDns: 'Update DNS Record',
  deleteDns: 'Delete DNS Record',
  activateShortener: '🔗 Activate for URL Shortener',
  addDnsTxt: 'Please select record type you want to add:',
  updateDnsTxt: 'Please type the record id you wish to update. i.e 3',
  deleteDnsTxt: 'Please type the record id you wish to delete. i.e 3',
  confirmDeleteDnsTxt: 'Are you sure? Yes or No',
  a: 'A Record',
  cname: 'CNAME Record',
  ns: 'NS Record',
  'A Record': 'A',
  'CNAME Record': 'CNAME',
  'NS Record': 'NS',
  askDnsContent: {
    A: `Please provide A record. i.e, 108.0.56.98`,
    'A Record': `Please provide A record. i.e, 108.0.56.98`,

    CNAME: `Please provide CNAME record. i.e, abc.hello.org`,
    'CNAME Record': `Please provide CNAME record. i.e, abc.hello.org`,

    NS: `Please enter your NS record. i.e., dell.ns.cloudflare.com. A new NS record will be added to the current ones.`,
    'NS Record': `Please enter your NS record. i.e., dell.ns.cloudflare.com .If N1-N4 already exists, please update record instead`,
  },
  askUpdateDnsContent: {
    A: `Please provide A record. i.e, 108.0.56.98`,
    'A Record': `Please provide A record. i.e, 108.0.56.98`,

    CNAME: `Please provide CNAME record. i.e, abc.hello.org`,
    'CNAME Record': `Please provide CNAME record. i.e, abc.hello.org`,

    NS: `A new NS record will be updated for the selected id. To Add a new record, please choose “Add DNS Record”`,
    'NS Record': `A new NS record will be updated for the selected id. To Add a new record, please choose “Add DNS Record”`,
  },

  dnsRecordSaved: `Record Added`,
  dnsRecordDeleted: `Record Deleted`,
  dnsRecordUpdated: `Record Updated`,

  provideLink: 'Please provide a valid URL. e.g https://google.com',

  comingSoonWithdraw: `Withdrawals are not available yet. Need help? Contact ${SUPPORT_USERNAME}.`,

  selectCurrencyToDeposit: `Please select currency to deposit`,

  depositNGN: `Please enter NGN Amount:`,
  askEmailForNGN: `Please provide an email for payment confirmation`,

  depositUSD: `Please enter USD Amount, note that minimum value is $10:`,
  selectCryptoToDeposit: `Please choose a crypto currency:`,

  'bank-pay-plan': (
    priceNGN,
    plan,
  ) => `Please remit ${priceNGN} NGN by clicking “Make Payment” below. Once the transaction has been confirmed, you will be promptly notified, and your ${plan} plan will be seamlessly activated.

Best regards,
${CHAT_BOT_NAME}`,

  bankPayDomain: (
    priceNGN,
    domain,
  ) => `Please remit ${priceNGN} NGN by clicking “Make Payment” below. Once the transaction has been confirmed, you will be promptly notified, and your ${domain} domain will be seamlessly activated.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfoPlan: (priceCrypto, tickerView, address, plan) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Please note, crypto transactions can take up to 30 minutes to complete. Once the transaction has been confirmed, you will be promptly notified, and your ${plan} plan will be seamlessly activated.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfoDomain: (priceCrypto, tickerView, address, domain) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Please note, crypto transactions can take up to 30 minutes to complete. Once the transaction has been confirmed, you will be promptly notified, and your ${domain} domain will be seamlessly activated.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfoLeads: (priceCrypto, tickerView, address, label) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Please note, crypto transactions can take up to 30 minutes to complete. Once the transaction has been confirmed, you will be promptly notified, and your ${label} will be delivered.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfoPhone: (priceCrypto, tickerView, address, phoneNumber) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Please note, crypto transactions can take up to 30 minutes to complete. Once the transaction has been confirmed, you will be promptly notified, and your Cloud Phone number ${phoneNumber} will be activated.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfoDigitalProduct: (priceCrypto, tickerView, address, product) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Your order for <b>${product}</b> is being processed. Crypto transactions can take up to 30 minutes. Once confirmed, your order will be delivered within <b>30 minutes</b>.

Best regards,
${CHAT_BOT_NAME}`,

  showDepositCryptoInfo: (priceCrypto, tickerView, address) =>
    `Please remit ${priceCrypto} ${tickerView} to\n\n<code>${address}</code>

Please note, crypto transactions can take up to 30 minutes to complete. Once the transaction has been confirmed, you will be promptly notified, and your wallet will be updated.

Best regards,
${CHAT_BOT_NAME}`,

  confirmationDepositMoney: (
    amount,
    usd,
  ) => `Your payment of ${amount} ($${view(usd)}) is processed. Thank you for choosing us.
Best,
${CHAT_BOT_NAME}`,

  showWallet: (usd, ngn) => `Wallet Balance:

${bal(usd, ngn)}`,

  wallet: (usd, ngn) => `Wallet Balance:

${bal(usd, ngn)}

Select wallet option:`,

  walletSelectCurrency: (usd, ngn) => `Please select currency to pay from your Wallet Balance:

${bal(usd, ngn)}`,

  walletBalanceLow: `Your wallet balance is too low. Tap "👛 My Wallet" → "➕💵 Deposit" to top up.`,

  sentLessMoney: (expected, got) =>
    `You sent less money than expected so we credited amount received into your wallet. We expected ${expected} but received ${got}`,
  sentMoreMoney: (expected, got) =>
    `You sent more money than expected so we credited the extra amount into your wallet. We expected ${expected} but received ${got}`,

  buyLeadsError: 'Unfortunately the selected area code is unavailable and your wallet has not been charged',
  buyLeadsProgress: (i, total) => `${((i * 100) / total).toFixed()}% leads downloaded. Please wait.`,

  phoneNumberLeads: 'Get premium verified leads by target or validate your own numbers:',

  buyLeadsSelectCountry: 'Please select country',
  buyLeadsSelectSmsVoice: 'Please select SMS / Voice',
  buyLeadsSelectArea: 'Please select area',
  buyLeadsSelectAreaCode: 'Please select area code',
  buyLeadsSelectCarrier: 'Please select carrier',
  buyLeadsSelectCnam: 'You want to search the owners name? CNAME costs extra 15$ per 1000 leads',
  buyLeadsSelectAmount: (min, max) =>
    `How much leads do you want to purchase? Select or type a number. Minimum is ${min} and Maximum is ${max}`,
  buyLeadsSelectFormat: 'Choose format i.e Local (212) or International (+1212)',
  buyLeadsSuccess: n => `Congrats your ${n} leads are downloaded.`,

  buyLeadsNewPrice: (leads, price, newPrice) => `Price of ${leads} leads is now $${view(newPrice)} <s>($${price})</s>`,
  buyLeadsPrice: (leads, price) => `Price of ${leads} leads is $${price}.`,

  confirmNgn: (usd, ngn) => `${usd} USD ≈ ${ngn} NGN `,
  walletSelectCurrencyConfirm: `Confirm?`,

  // Phone Number validator
  validatorSelectCountry: 'Please select country',
  validatorPhoneNumber: 'Please paste your numbers or upload a file including the country code.',
  validatorSelectSmsVoice: n =>
    `${n} phone numbers found. Please choose the option for SMS or voice call leads validation.`,
  validatorSelectCarrier: 'Please select carrier',
  validatorSelectCnam: 'You want to search the owners name? CNAME costs extra 15$ per 1000 leads',
  validatorSelectAmount: (min, max) =>
    `How much from the numbers you want to validate? Select or type a number. Minimum is ${min} and Maximum is ${max}`,
  validatorSelectFormat: 'Choose format i.e Local (212) or International (+1212)',

  validatorSuccess: (n, m) => `${n} leads are validated. ${m} valid phone numbers found.`,
  validatorProgress: (i, total) => `${((i * 100) / total).toFixed()}% leads validate. Please wait.`,
  validatorProgressFull: (i, total) => `${((i * 100) / total).toFixed()}% leads validate.`,

  validatorError: `Unfortunately the selected phone numbers are unavailable and your wallet has not been charged`,
  validatorErrorFileData: `Invalid country phone # found. Please upload phone number for selected country`,
  validatorErrorNoPhonesFound: `No phone numbers found. Try again.`,

  validatorBulkNumbersStart: 'Leads validation has started and will complete soon.',

  // url re-director
  redSelectUrl: 'Kindly share the URL that you would like shortened and analyzed. e.g https://cnn.com',
  redSelectRandomCustom: 'Please select your choice for random or custom link',
  redSelectProvider: 'Choose link provider',
  redSelectCustomExt: 'Enter custom back half',

  redValidUrl: 'Please provide a valid URL. e.g https://google.com',
  redTakeUrl: url => `Your shortened URL is: ${url}`,
  redIssueUrlBitly: `Link shortening failed. Your wallet was not charged. Please try again or contact ${SUPPORT_USERNAME}.`,
  redIssueSlugCuttly: `The preferred link name is already taken, try another.`,
  redIssueUrlCuttly: `Link shortening failed. Please try again or contact ${SUPPORT_USERNAME}.`,
  redNewPrice: (price, newPrice) => `Price is now $${view(newPrice)} <s>($${price})</s> Please choose payment method.`,
}

const phoneNumberLeads = ['🎯 Premium Targeted Leads', '✅📲 Validate PhoneLeads']

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TARGET LEADS CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const targetLeadsData = {
  'JPMorgan C': {
    'New York metro': ['212', '347', '646', '718', '917'],
    'Chicago': ['312', '773', '872'],
    'Los Angeles': ['213', '323', '310', '424'],
    'Dallas': ['214', '469', '972'],
  },
  'BOA': {
    'Charlotte': ['704', '980'],
    'Los Angeles': ['213', '323', '310', '424'],
    'Miami': ['305', '786'],
    'Atlanta': ['404', '678', '770'],
  },
  'Wfargo Bnk': {
    'SF Bay Area': ['415', '628', '510', '925'],
    'Los Angeles': ['213', '323', '310', '424'],
    'Minneapolis': ['612', '763', '952'],
    'Washington DC': ['202', '301', '703'],
  },
  'Citi Bnk': {
    'New York': ['212', '347', '646', '718', '917'],
    'Chicago': ['312', '773', '872'],
    'Los Angeles': ['213', '323', '310', '424'],
  },
  'U.S Bnk': {
    'Minneapolis': ['612', '763', '952'],
    'Portland OR': ['503', '971'],
    'Seattle': ['206', '425', '564'],
    'Denver': ['303', '720'],
  },
  'Capital One': {
    'New York': ['212', '347', '646', '718', '917'],
    'Richmond VA': ['804'],
    'Charlotte': ['704', '980'],
  },
  'U$AA': {
    'San Antonio TX': ['210', '726'],
    'Phoenix AZ': ['602', '480', '623'],
  },
  'Citizen$ Bnk': {
    'Boston': ['617', '857'],
    'Philadelphia': ['215', '267'],
    'Providence RI': ['401'],
  },
  'PNCBNK': {
    'Minneapolis': ['612', '763', '952'],
    'Portland OR': ['503', '971'],
    'Seattle': ['206', '425', '564'],
  },
  'AlliantCU': {
    'Chicago': ['312', '773', '872'],
    'Los Angeles': ['213', '323', '310'],
    'San Francisco': ['415', '628'],
  },
  'NavyFedCU': {
    'Virginia / DC': ['703', '571', '202', '301'],
    'San Diego': ['619', '858', '760'],
    'Jacksonville FL': ['904'],
  },
  'USALLIANCE Fin': {
    'New York metro': ['212', '347', '646', '718', '917'],
    'Albany': ['518', '838'],
  },
  'AssociatedCU': {
    'Atlanta': ['404', '678', '770'],
    'Georgia': ['912'],
    'South Carolina': ['864'],
  },
  'AlturaCU': {
    'Riverside': ['951'],
    'LA-adjacent': ['909', '626'],
  },
  'LakeMichig$n CU': {
    'Florida': ['407', '305', '786'],
    'Michigan statewide': ['269', '517'],
    'Grand Rapids / Western MI': ['616', '231'],
  },
  'Arvest Bnk': {
    'Arkansas (NW AR)': ['479', '501', '870'],
    'Oklahoma (Tulsa)': ['918', '539'],
    'Oklahoma (OKC/Norman)': ['405', '572', '580'],
    'Missouri (SW MO)': ['417', '816', '975'],
    'Kansas (Eastern)': ['913', '785'],
  },
  'NymeoFCU': {
    'Frederick MD': ['301', '240'],
    'Gaithersburg / Montgomery Co': ['301', '240'],
  },
  'Huntington Bnk': {
    'Columbus OH': ['614'],
    'Cleveland OH': ['216', '440', '234'],
    'Cincinnati OH': ['513'],
    'Akron / Youngstown OH': ['330', '234'],
    'Toledo OH': ['419'],
    'Dayton OH': ['937'],
    'Detroit MI': ['313', '734', '248', '586'],
    'Grand Rapids MI': ['616'],
    'Ann Arbor MI': ['734'],
    'Flint MI': ['810'],
    'Indianapolis IN': ['317', '463'],
    'Fort Wayne IN': ['260'],
    'South Bend IN': ['574'],
    'Chicago IL': ['312', '773', '872'],
    'Chicago suburbs IL': ['630', '847'],
    'Pittsburgh PA': ['412', '724'],
    'Philadelphia PA': ['215', '267', '484'],
    'West Virginia': ['304', '681'],
    'Louisville KY': ['502'],
    'Lexington KY': ['859'],
    'Minneapolis MN': ['612', '763', '952'],
    'St. Paul MN': ['651'],
    'Milwaukee WI': ['414', '262'],
    'Tampa FL': ['813'],
    'Orlando FL': ['407'],
    'Miami FL': ['305', '786'],
    'Dallas TX': ['214', '469'],
    'Houston TX': ['713', '281'],
    'Charlotte NC': ['704', '980'],
    'Denver CO': ['303', '720'],
  },
  'Comerica Bnk': {
    'Dallas TX': ['214', '469', '972'],
    'Fort Worth TX': ['817'],
    'Austin TX': ['512'],
    'Houston TX': ['713', '281', '832'],
    'San Antonio TX': ['210'],
    'Detroit MI': ['313', '734', '248', '586'],
    'Ann Arbor MI': ['734'],
    'Grand Rapids MI': ['616'],
    'Troy / Bloomfield MI': ['248'],
    'Phoenix AZ': ['602', '480', '623'],
    'Scottsdale / Tempe AZ': ['480'],
    'Central Phoenix AZ': ['602'],
    'Los Angeles CA': ['213', '323', '310', '424'],
    'San Francisco CA': ['415', '628'],
    'Orange County CA': ['714', '949'],
    'San Jose / Silicon Valley CA': ['408'],
    'Fort Lauderdale FL': ['954'],
    'Miami FL': ['305', '786'],
    'Tampa FL': ['813'],
  },
}
const targetLeadsTargets = Object.keys(targetLeadsData)
const targetLeadsCities = (target) => Object.keys(targetLeadsData[target] || {})
const targetLeadsAreaCodes = (target, city) => {
  if (city === 'All Cities') {
    // Flatten all area codes for this target
    return Object.values(targetLeadsData[target] || {}).flat()
  }
  return targetLeadsData[target]?.[city] || []
}
const targetLeadsAreaCodeButtons = (target, city) => {
  const codes = targetLeadsAreaCodes(target, city)
  const formatted = codes.map(c => format('1', c))
  return formatted.length > 1 ? ['Mixed Area Codes'].concat(formatted) : formatted
}

const buyLeadsSelectCountry = Object.keys(areasOfCountry)
const buyLeadsSelectSmsVoice = ['SMS (Price 20$ for 1000)']
const buyLeadsSelectArea = country => Object.keys(areasOfCountry?.[country])
const buyLeadsSelectAreaCode = (country, area) => {
  const codes = areasOfCountry?.[country]?.[area].map(c => format(countryCodeOf[country], c))
  return codes.length > 1 ? ['Mixed Area Codes'].concat(codes) : codes
}
const _buyLeadsSelectAreaCode = (country, area) => areasOfCountry?.[country]?.[area]
const buyLeadsSelectCnam = yesNo
const buyLeadsSelectCarrier = country => carriersOf[country]
const buyLeadsSelectAmount = ['1000', '2000', '3000', '4000', '5000']
const buyLeadsSelectFormat = ['Local Format', 'International Format']

const validatorSelectCountry = Object.keys(areasOfCountry)
const validatorSelectSmsVoice = ['SMS (Price 15$ for 1000)']
const validatorSelectCarrier = country => carriersOf[country]
const validatorSelectCnam = yesNo
const validatorSelectAmount = ['ALL', '1000', '2000', '3000', '4000', '5000']
const validatorSelectFormat = ['Local Format', 'International Format']

//redSelectRandomCustom

const redSelectRandomCustom = ['Random Short Link']

const redSelectProvider = ['Bit.ly $10', `Shortit (Trial ${FREE_LINKS})`]

const tickerOf = {
  BTC: 'btc',
  LTC: 'ltc',
  ETH: 'eth',
  'USDT (TRC20)': 'trc20_usdt',
  'BCH': 'bch',
  'USDT (ERC20)': 'erc20_usdt',
  DOGE: 'doge',
  TRON: 'trx'
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
  'USDT (ERC20)': '₮ Tether (USDT - ERC20)'
}

const tickerOfDyno = {
  BTC: 'BTC',
  LTC: 'LTC',
  ETH: 'ETH',
  'USDT (TRC20)': 'USDT-TRC20',
  'USDT (ERC20)': 'USDT-ERC20',
  DOGE: 'DOGE',
  BCH: 'BCH',
  TRON: 'TRX'
}

const tickerViewOfDyno = {
  BTC: 'btc',
  LTC: 'ltc',
  ETH: 'eth',
  'USDT-TRC20': 'trc20_usdt',
  DOGE: 'doge',
  BCH: 'bch',
  'USDT-ERC20': 'erc20_usdt',
  'TRX': 'trx',
}
/////////////////////////////////////////////////////////////////////////////////////
const _bc = ['Back', 'Cancel']

const payIn = {
  crypto: 'Crypto',
  ...(HIDE_BANK_PAYMENT !== 'true' && { bank: 'Bank ₦aira + Card🏦💳' }),
  wallet: '👛 Wallet',
}

const reverseObject = o => Object.fromEntries(Object.entries(o).map(([key, val]) => [val, key]))
const tickerViewOf = reverseObject(tickerOf)
const supportedCryptoView = reverseObject(supportedCrypto)
const supportedCryptoViewOf = Object.keys(supportedCryptoView)

const kOf = list => ({
  reply_markup: {
    // Handle if there are multiples buttons in a row
    keyboard: [
      ...list.map(a => Array.isArray(a) ? a : [a]),
      ...(list.some(a => Array.isArray(a)
        && a.some(item => typeof item === 'string' && (item === 'Back' || item === 'Cancel' || item.includes(t.backButton) || item.includes(user.backToHostingPlans) || item.includes(user.backToStarterPlanDetails) || item.includes(user.backToPurchaseOptions))),
      ) ? [] : [_bc]),
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
const payOpts = HIDE_BANK_PAYMENT !== 'true' ? k.of([u.usd, u.ngn]) : k.of([u.usd])

const adminKeyboard = {
  reply_markup: {
    keyboard: Object.values(admin).map(b => [b]),
  },
}

const userKeyboard = {
  reply_markup: {
    keyboard: [
      [user.domainNames],
      [user.urlShortenerMain, user.buyPlan],
      [user.cloudPhone],
      [user.phoneNumberLeads],
      [user.digitalProducts],
      HIDE_SMS_APP === 'true' ? [user.hostingDomainsRedirect] : [user.freeTrialAvailable, user.hostingDomainsRedirect],
      [user.wallet, user.viewPlan],
      HIDE_BECOME_RESELLER === 'true'
        ? [user.changeSetting, user.getSupport, user.joinChannel]
        : [user.changeSetting, user.becomeReseller, user.getSupport],
    ],
  },
  parse_mode: 'HTML',
  disable_web_page_preview: true,
}

const priceOf = {
  Daily: PRICE_DAILY,
  Weekly: PRICE_WEEKLY,
  Monthly: PRICE_MONTHLY,
}

const freeDomainsOf = {
  Daily: 0,
  Weekly: 0,
  Monthly: 0,
}

const freeValidationsOf = {
  Daily: DAILY_PLAN_FREE_VALIDATIONS,
  Weekly: WEEKLY_PLAN_FREE_VALIDATIONS,
  Monthly: MONTHLY_PLAN_FREE_VALIDATIONS,
}

const timeOf = {
  Daily: 86400 * 1000,
  Weekly: 7 * 86400 * 1000,
  Monthly: 30 * 86400 * 1000,
}

const planOptions = ['Daily', 'Weekly', 'Monthly']

const linkOptions = ['Random Link', 'Custom Link']

const chooseSubscription = {
  parse_mode: 'HTML',
  reply_markup: {
    keyboard: [...planOptions.map(a => [a]), _bc],
  },
}

const rem = {
  reply_markup: {
    remove_keyboard: true,
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
    keyboard: [[t.addDns], [t.updateDns], [t.deleteDns], [t.activateShortener], _bc],
  },
  disable_web_page_preview: true,
}
const dnsRecordType = {
  parse_mode: 'HTML',
  reply_markup: {
    keyboard: [[t.cname], [t.ns], [t.a], _bc],
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

const continueAtHostbayKeyboard = (trans) => ({
  reply_markup: {
    keyboard: [[trans('l.continueAtHostbay')]],
  },
  parse_mode: 'HTML',
  disable_web_page_preview: true,
})

const payBank = url => ({
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: 'Make Payment',
          web_app: {
            url,
          },
        },
      ],
    ],
  },
})

const html = (text = t.successPayment) => {
  const brand = String(process.env.CHAT_BOT_BRAND || 'Nomadly')
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'nomadly'
  const accent = slug === 'smadav' ? '#3b82f6' : '#10d9a0'
  return `
        <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${brand}</title></head>
            <body style="margin:0;background:#0b0f1a;color:#e6e8ee;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">
                <div style="max-width:640px;margin:0 auto;padding:48px 24px;">
                  <img src="/brand/wordmark.png" alt="${brand}" style="height:44px;display:block;margin-bottom:28px" onerror="this.outerHTML='<div style=\\'font-weight:800;font-size:28px;letter-spacing:.08em;color:${accent};margin-bottom:28px\\'>${brand.toUpperCase()}</div>'">
                  <p style="font-size:16px;line-height:1.6;white-space:pre-wrap;">${text}</p>
                </div>
            </body>
        </html>
    `
}

const dynopayActions = {
  walletFund: 'walletFund',
  payHosting: 'payHosting',
  payDomain: 'payDomain',
  payPlan: 'payPlan',
  payVps: 'payVps',
  payPhone: 'payPhone',
  payLeads: 'payLeads',
  payMarketplaceAccess: 'payMarketplaceAccess'
}

module.exports = {
  k,
  t,
  u,
  
  bc,
  npl,
  dns,
  kOf,
  rem,
  user,
  show,
  yesNo,
  html,
  payIn,
  admin,
  payOpts,
  yes_no,
  timeOf,
  payBank,
  alcazar,
  priceOf,
  tickerOf,
  linkType,
  discountOn,
  
  linkOptions,
  planOptions,
  tickerViewOf,
  dnsRecordType,
  freeDomainsOf,
  freeValidationsOf,
  o: userKeyboard,
  phoneNumberLeads,
  aO: adminKeyboard,
  continueAtHostbayKeyboard,
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
  dynopayActions,
  tickerOfDyno,
  tickerViewOfDyno,
  supportedCrypto,
  supportedCryptoView,
  supportedCryptoViewOf,
  targetLeadsData,
  targetLeadsTargets,
  targetLeadsCities,
  targetLeadsAreaCodes,
  targetLeadsAreaCodeButtons,
  view,
  DP_PRICE_TWILIO_MAIN,
  DP_PRICE_TWILIO_SUB,
  DP_PRICE_TELNYX_MAIN,
  DP_PRICE_TELNYX_SUB,
  DP_PRICE_GWORKSPACE_NEW,
  DP_PRICE_GWORKSPACE_AGED,
  DP_PRICE_ZOHO_NEW,
  DP_PRICE_ZOHO_AGED,
  DP_PRICE_ESIM,
  DP_PRICE_AWS_MAIN,
  DP_PRICE_AWS_SUB,
  DP_PRICE_GCLOUD_MAIN,
  DP_PRICE_GCLOUD_SUB,
  DP_PRICE_IONOS_SMTP,
  DP_PRICE_AIRVOICE_1M,
  DP_PRICE_AIRVOICE_3M,
  DP_PRICE_AIRVOICE_6M,
  DP_PRICE_AIRVOICE_1Y,
  TRC20_MIN_DEPOSIT_USD,
  WALLET_DEPOSIT_MIN_DEFAULT_USD,
  WALLET_DEPOSIT_MIN_PER_COIN,
  walletDepositMinFor,
}
