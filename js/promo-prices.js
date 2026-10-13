// Live price snapshot for promo copy — every number an ad shows comes from the
// same config/env the checkout flows use, so ads can never drift from the bot.

const usd = n => {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return v < 1 ? `$${v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}` : `$${Number.isInteger(v) ? v : v.toFixed(2)}`
}

function safe(fn, fallback = null) {
  try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

function vpsFromUsd() {
  return safe(() => {
    const d = require('./digitalocean-service.js')
    let min = Infinity
    for (const p of d.PRODUCT_CATALOG || []) {
      for (const region of ['EU', 'US']) {
        const q = d.calculatePrice(p, region, false)
        if (q?.totalWithMarkup && q.totalWithMarkup < min) min = q.totalWithMarkup
      }
    }
    return Number.isFinite(min) ? min : null
  })
}

function rdpFromUsd() {
  return safe(() => {
    const r = require('./digitalocean-rdp-service.js')
    const list = r.listProducts('US', true) || []
    const min = Math.min(...list.map(p => p?.pricing?.totalWithMarkup).filter(Number.isFinite))
    return Number.isFinite(min) ? min : null
  })
}

function getPromoPrices() {
  const phone = safe(() => require('./phone-config.js').plans, {}) || {}
  const cfg = safe(() => require('./config.js'), {}) || {}
  const env = process.env
  const evTiers = [1, 2, 3, 4].map(i => Number(env[`EV_TIER_${i}_PRICE`])).filter(Number.isFinite)
  const vps = vpsFromUsd()
  const rdp = rdpFromUsd()
  return {
    phoneStarter: usd(phone.starter?.price), phoneStarterMin: phone.starter?.minutes, phoneStarterSms: phone.starter?.sms,
    phonePro: usd(phone.pro?.price), phoneProMin: phone.pro?.minutes, phoneProSms: phone.pro?.sms,
    phoneBusiness: usd(phone.business?.price),
    hostingWeekly: usd(env.PREMIUM_ANTIRED_WEEKLY_PRICE), hostingMonthly: usd(env.PREMIUM_ANTIRED_CPANEL_PRICE),
    domainFrom: usd(env.PROMO_DOMAIN_FROM_USD || 30),
    leadRate: usd(env.RATE_LEAD), cnamRate: usd(env.RATE_CNAM), leadsPer1k: usd(Number(env.RATE_LEAD) * 1000),
    vpsFrom: usd(vps), rdpFrom: usd(rdp),
    evRate: usd(evTiers[0]), evRateBulk: usd(evTiers[evTiers.length - 1]), evFreeTrial: 50,
    smsDaily: usd(env.PRICE_DAILY_SUBSCRIPTION), smsWeekly: usd(env.PRICE_WEEKLY_SUBSCRIPTION), smsMonthly: usd(env.PRICE_MONTHLY_SUBSCRIPTION), smsTrial: 100,
    dpEsim: usd(cfg.DP_PRICE_ESIM), dpTwilioSub: usd(cfg.DP_PRICE_TWILIO_SUB), dpTelnyxSub: usd(cfg.DP_PRICE_TELNYX_SUB),
    dpAwsSub: usd(cfg.DP_PRICE_AWS_SUB), dpWorkspace: usd(cfg.DP_PRICE_GWORKSPACE_NEW), dpZoho: usd(cfg.DP_PRICE_ZOHO_NEW),
    freeLinks: Number(env.FREE_LINKS) || 5,
    referReward: usd(5), referSpend: usd(30),
  }
}

module.exports = { getPromoPrices, usd }
