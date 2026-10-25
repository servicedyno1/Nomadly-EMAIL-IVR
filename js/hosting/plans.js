const CHAT_BOT_NAME = process.env.CHAT_BOT_NAME
const TG_HANDLE = process.env.TG_HANDLE
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME

const PREMIUM_ANTIRED_WEEKLY_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE)
const PREMIUM_ANTIRED_CPANEL_PRICE = parseFloat(process.env.PREMIUM_ANTIRED_CPANEL_PRICE)
const GOLDEN_ANTIRED_CPANEL_PRICE = parseFloat(process.env.GOLDEN_ANTIRED_CPANEL_PRICE)

const plans = (hostingType) => {
  return {
    premiumWeekly: {
      name: 'Premium Anti-Red (1-Week)',
      price: PREMIUM_ANTIRED_WEEKLY_PRICE,
      duration: '7 days',
      storage: '10 GB SSD',
      bandwidth: '100 GB',
      domains: 'Up to 2 domains (1 addon)',
      ssl: 'Free SSL',
      protection: 'IP cloaking · Bot detection · UA blocking',
      panel: 'HostPanel — file, DB & email management',
      support: 'Standard support',
      captcha: '🔒 Visitor Captcha toggle — not included',
    },
    premiumCpanel: {
      name: 'Premium Anti-Red HostPanel (30 Days)',
      price: PREMIUM_ANTIRED_CPANEL_PRICE,
      duration: '30 days',
      storage: '50 GB SSD',
      bandwidth: '500 GB',
      domains: 'Up to 6 domains (5 addons)',
      ssl: 'Free SSL',
      protection: 'IP cloaking · JS challenge · UA & TLS blocking',
      panel: 'HostPanel — backups, migration & advanced tools',
      support: 'Standard support',
      captcha: '🔒 Visitor Captcha toggle — not included',
    },
    goldenCpanel: {
      name: 'Golden Anti-Red HostPanel (30 Days)',
      price: GOLDEN_ANTIRED_CPANEL_PRICE,
      duration: '30 days',
      storage: '100 GB SSD',
      bandwidth: 'Unlimited bandwidth ✨ Gold-exclusive',
      domains: 'Unlimited domains',
      ssl: 'Free SSL + Wildcard SSL ✨ Gold-exclusive',
      protection: 'Full Anti-Red: IP cloaking · JS challenge · TLS/JA3 · WAF rules',
      support: '🚀 Priority support ✨ Gold-exclusive',
      panel: 'HostPanel — staging, security & all advanced tools',
      captcha: '🛡️ Visitor Captcha toggle ON/OFF per domain ✨ Gold-exclusive',
    },
  }
}

const generatePlanText = (hostingType, planKey) => {
  const plan = plans(hostingType)[planKey]
  const isGold = planKey === 'goldenCpanel'
  if (isGold) {
    return `<b>${plan.name} — $${plan.price}</b>

• 📦 ${plan.storage}
• 🌐 ${plan.bandwidth}
• 🔗 ${plan.domains}
• 🔐 ${plan.ssl}
• 🛡️ ${plan.protection}
• ${plan.support}
• 🖥️ ${plan.panel}
• ${plan.captcha}`
  }
  return `<b>${plan.name} — $${plan.price}</b>

${plan.storage} · ${plan.bandwidth} · ${plan.domains}
${plan.ssl} · ${plan.protection}
${plan.panel}
${plan.captcha}`
}

const generatePlanStepText = step => {
  const commonSteps = {
    buyText: 'Great choice! How would you like to connect a domain?\n\n<b>Register a New Domain</b> — Search and register a new domain\n<b>Use My Domain</b> — Pick from your registered domains\n<b>Connect External Domain</b> — Use a domain you own elsewhere',
    registerNewDomainText: 'Enter your desired domain (e.g., example.com)',
    domainNotFound: 'Domain not found. Try a different one.',
    useExistingDomainText: 'Enter your domain (e.g., example.com)',
    connectExternalDomainText: 'Enter your external domain (e.g., example.com)\n\nYou\'ll need to point nameservers to Cloudflare after setup.',
    useExistingDomainNotFound: 'This domain isn\'t linked to your account. Try another or contact support.',
    enterYourEmail: 'Enter your email for account setup and receipt.\n\nTap "Skip" to continue without one.',
    invalidEmail: 'Invalid email. Try again.',
    paymentConfirmation: 'Confirm payment to activate your hosting.',
    paymentSuccess: 'Payment received — setting up your hosting now.',
    paymentFailed: 'Payment failed. Please try again.',
  }

  return `${commonSteps[step]}`
}

const generateDomainFoundText = (websiteName, price) =>
  `<b>${websiteName}</b> is available — $${price}`
const generateExistingDomainText = websiteName => `Domain set: <b>${websiteName}</b>`
const connectExternalDomainText = websiteName => `Domain: <b>${websiteName}</b>\n\nNameservers will be pointed to Cloudflare. DNS records auto-configured.`
const domainNotFound = websiteName => `<b>${websiteName}</b> is not available. Try another.`

const confirmEmailBeforeProceeding = email => `Use <b>${email}</b> for this account?`

const generateInvoiceText = payload => {
  const isOwnDomain = payload.existingDomain || payload.connectExternalDomain
  const domain = isOwnDomain ? `${payload.domainName} (your domain)` : `${payload.domainName} — $${payload.domainPrice}`
  const total = payload.couponApplied ? payload.newPrice : payload.totalPrice
  let text = `<b>${payload.planName || 'Anti-Red HostPanel'}</b> · ${payload.duration || '1 Month'}

Domain: ${domain}
Hosting: $${payload.hostingPrice}`
  if (payload.couponApplied && payload.couponDiscount > 0) {
    text += `\nDiscount: -$${payload.couponDiscount}`
  }
  text += `\n\n<b>Total: $${total}</b>

Pay within 1 hr to activate. Your hosting will be provisioned automatically.`
  return text
}

const showCryptoPaymentInfo = (priceCrypto, tickerView, address, plan) => `Send <b>${priceCrypto} ${tickerView}</b> to:

<code>${address}</code>

Confirmation may take up to 30 min. Your ${plan} activates automatically once confirmed.`

const support = (plan, statusCode) => `Setup failed for ${plan} (${statusCode}). Tap 💬 Get Support for help.`

const bankPayDomain = (priceNGN, plan) => `Pay <b>${priceNGN} NGN</b> via the button below. Your ${plan} activates automatically once confirmed.`

module.exports = {
  generatePlanText,
  generatePlanStepText,
  generateDomainFoundText,
  generateExistingDomainText,
  connectExternalDomainText,
  generateInvoiceText,
  
  confirmEmailBeforeProceeding,
  showCryptoPaymentInfo,
  domainNotFound,
  
  support,
  bankPayDomain,
}
