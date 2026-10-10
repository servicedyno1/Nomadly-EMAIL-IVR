// Hosting plan change (upgrade/downgrade) — quote shared by the reseller API.
// RULES (2026-10):
//  • Same cycle length (Premium Monthly ↔ Golden Monthly): only the package/resources change.
//    Upgrade charges (new monthly − current monthly) × days left / 30; downgrade is free, no refund.
//    The expiry date NEVER moves; the new price applies from the next renewal.
//  • Weekly → Monthly (one-way move to a LONGER cycle): the unused weekly days are credited
//    (weekly price × days left / 7), the rest of the monthly price is charged now and a FRESH
//    30-day term starts today ("billing": "new_term"). Safety net for weekly accounts renewed
//    several weeks ahead before the one-week renew cap existed: if the credit is worth more than
//    the monthly price, nothing is charged and the credit is converted into days on the new plan
//    (never less than 30) — the customer never loses paid time.
//  • Monthly → Weekly (any move to a SHORTER cycle) is NEVER allowed: hidden from plan-options and
//    rejected with 409 weekly_downgrade_not_allowed.
//  • Weekly renewals: one week at a time, only once 7 days or fewer are left (weeklyRenewBlock),
//    so a weekly account never holds more than ~14 days.
const DAY_MS = 86400000
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const RANK = { 'premium-weekly': 0, 'premium-monthly': 1, 'golden-monthly': 2 }
const WEEKLY_RENEW_WINDOW_DAYS = 7

class HostingPlanChangeError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

function planIdOf(planName) {
  const n = String(planName || '').toLowerCase()
  if (n.includes('golden') || n.includes('business')) return 'golden-monthly'
  if (n.includes('week') || n.includes('starter') || n.includes('freedom')) return 'premium-weekly'
  if (n.includes('premium') || n.includes('pro')) return 'premium-monthly'
  return null
}

const addonLimit = (p) => (p.addons === 'unlimited' ? Infinity : Number(p.addons) || 0)

// plans = reseller hostingPlans() catalog: [{ id, name, priceUsd, durationDays, addons }]
function hostingPlanOptions(acct, plans, now = new Date()) {
  if (acct.deleted || acct.terminatedOnWhm) throw new HostingPlanChangeError('account_terminated', 'This hosting account was terminated.')
  const exp = acct.expiryDate ? new Date(acct.expiryDate) : null
  if (!exp || isNaN(exp.getTime()) || exp <= now) throw new HostingPlanChangeError('expired', 'The current term has ended — renew first, then change the plan.')
  const cur = plans.find((p) => p.id === planIdOf(acct.plan))
  if (!cur) throw new HostingPlanChangeError('unknown_plan', `Current plan "${acct.plan}" cannot be changed automatically. Contact support.`)
  const remainingDays = (exp.getTime() - now.getTime()) / DAY_MS
  const addons = Array.isArray(acct.addonDomains) ? acct.addonDomains.length : 0
  // Credit basis for a cycle-length change = what THIS account pays per cycle (its price-locked
  // renewal price, e.g. a promo weekly price), falling back to the list price.
  const paidPrice = (typeof acct.renewalPriceUsd === 'number' && acct.renewalPriceUsd > 0) ? acct.renewalPriceUsd : cur.priceUsd
  // Moving to a SHORTER cycle (monthly → weekly) is never offered.
  const options = plans.filter((p) => p.id !== cur.id && p.durationDays >= cur.durationDays).map((p) => {
    const direction = RANK[p.id] > RANK[cur.id] ? 'upgrade' : 'downgrade'
    const fits = addons <= addonLimit(p)
    const newTerm = p.durationDays > cur.durationDays // weekly → monthly
    let charge = 0
    let credit = 0
    let expiresAt = exp
    let termDays = null
    if (newTerm) {
      credit = round2(paidPrice * remainingDays / cur.durationDays)
      charge = Math.max(0, round2(p.priceUsd - credit))
      // Credit worth more than one new cycle (legacy multi-week weekly) → convert it into days.
      const days = credit > p.priceUsd ? Math.max(p.durationDays, credit / (p.priceUsd / p.durationDays)) : p.durationDays
      termDays = round2(days)
      expiresAt = new Date(now.getTime() + days * DAY_MS)
    } else if (direction === 'upgrade') {
      charge = Math.max(0, round2((p.priceUsd / p.durationDays - cur.priceUsd / cur.durationDays) * remainingDays))
    }
    return {
      plan_id: p.id, name: p.name, direction, monthly_price_usd: p.priceUsd, renewal_price_usd: p.priceUsd, renewal_days: p.durationDays,
      billing: newTerm ? 'new_term' : 'pro_rata',
      charge_now_usd: charge, unused_credit_usd: credit, refund_usd: 0,
      effective: 'immediately', new_price_from: newTerm ? 'now' : 'next_renewal',
      expiry_changes: newTerm, expires_at: expiresAt.toISOString(), new_term_days: termDays,
      addon_domains_allowed: p.addons,
      allowed: fits, blocked_reason: fits ? null : 'too_many_addon_domains',
      blocked_message: fits ? null : `This account has ${addons} addon domains; ${p.name} allows ${p.addons}. Remove addon domains first.`,
    }
  })
  return {
    current: { plan_id: cur.id, name: acct.plan, price_usd: cur.priceUsd, renewal_price_usd: paidPrice, duration_days: cur.durationDays, addon_domains: addons },
    remaining_days: round2(remainingDays), term_ends_at: exp.toISOString(), options,
  }
}

function hostingQuote(acct, plans, planId, now = new Date()) {
  const po = hostingPlanOptions(acct, plans, now)
  const id = String(planId || '')
  const opt = po.options.find((o) => o.plan_id === id)
  if (!opt) {
    if (id === po.current.plan_id) throw new HostingPlanChangeError('same_plan', 'The account is already on this plan.', 400)
    const target = plans.find((p) => p.id === id)
    if (target && target.durationDays < po.current.duration_days) {
      throw new HostingPlanChangeError('weekly_downgrade_not_allowed', 'A monthly plan can never be switched to the weekly plan. Premium Monthly <-> Golden Monthly switches are available.', 409)
    }
    throw new HostingPlanChangeError('invalid_plan', 'plan_id must be one of the options from GET /hosting/:user/plan-options.', 400)
  }
  if (!opt.allowed) throw new HostingPlanChangeError(opt.blocked_reason, opt.blocked_message)
  return { ...po, option: opt }
}

// Weekly plans renew ONE week at a time and only inside the last 7 days of the term (applies to the
// reseller API and the Telegram bot; the post-expiry auto-renew is unaffected). Returns null when the
// renewal is allowed, else { status, error, renew_blocked_reason, message, renew_available_at? }.
function weeklyRenewBlock(acct, { durationDays, periods = 1, now = new Date() } = {}) {
  if (Number(durationDays) !== 7) return null
  if (Number(periods) > 1) {
    return { status: 400, error: 'weekly_single_period_only', renew_blocked_reason: 'weekly_single_period_only', message: 'Weekly plans renew one week at a time. Send periods: 1 (or leave it out).' }
  }
  const exp = acct && acct.expiryDate ? new Date(acct.expiryDate) : null
  if (exp && !isNaN(exp.getTime()) && exp.getTime() - now.getTime() > WEEKLY_RENEW_WINDOW_DAYS * DAY_MS) {
    const at = new Date(exp.getTime() - WEEKLY_RENEW_WINDOW_DAYS * DAY_MS)
    return {
      status: 409, error: 'weekly_renew_too_early', renew_blocked_reason: 'weekly_renew_too_early', renew_available_at: at.toISOString(),
      message: `Weekly plans can be renewed once 7 days or fewer are left in the term. Renewal opens at ${at.toISOString()}.`,
    }
  }
  return null
}

module.exports = { hostingPlanOptions, hostingQuote, weeklyRenewBlock, planIdOf, HostingPlanChangeError, WEEKLY_RENEW_WINDOW_DAYS }
