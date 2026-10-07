// Hosting plan change (upgrade/downgrade) — pro-rata quote shared by the reseller API.
// Upgrades charge (new daily rate − current daily rate) × days left (= monthly diff × days/30 for
// monthly plans); downgrades apply immediately with no refund. The expiry date never moves — the
// new plan's price (and cycle length) applies from the next renewal.
const DAY_MS = 86400000
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const RANK = { 'premium-weekly': 0, 'premium-monthly': 1, 'golden-monthly': 2 }

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
  const options = plans.filter((p) => p.id !== cur.id).map((p) => {
    const direction = RANK[p.id] > RANK[cur.id] ? 'upgrade' : 'downgrade'
    const daily = p.priceUsd / p.durationDays - cur.priceUsd / cur.durationDays
    const fits = addons <= addonLimit(p)
    return {
      plan_id: p.id, name: p.name, direction, monthly_price_usd: p.priceUsd, renewal_price_usd: p.priceUsd, renewal_days: p.durationDays,
      charge_now_usd: direction === 'upgrade' ? Math.max(0, round2(daily * remainingDays)) : 0, refund_usd: 0,
      effective: 'immediately', new_price_from: 'next_renewal', expires_at: exp.toISOString(), addon_domains_allowed: p.addons,
      allowed: fits, blocked_reason: fits ? null : 'too_many_addon_domains',
      blocked_message: fits ? null : `This account has ${addons} addon domains; ${p.name} allows ${p.addons}. Remove addon domains first.`,
    }
  })
  return {
    current: { plan_id: cur.id, name: acct.plan, price_usd: cur.priceUsd, duration_days: cur.durationDays, addon_domains: addons },
    remaining_days: round2(remainingDays), term_ends_at: exp.toISOString(), options,
  }
}

function hostingQuote(acct, plans, planId, now = new Date()) {
  const po = hostingPlanOptions(acct, plans, now)
  const opt = po.options.find((o) => o.plan_id === String(planId || ''))
  if (!opt) {
    if (String(planId || '') === po.current.plan_id) throw new HostingPlanChangeError('same_plan', 'The account is already on this plan.', 400)
    throw new HostingPlanChangeError('invalid_plan', 'plan_id must be one of the options from GET /hosting/:user/plan-options.', 400)
  }
  if (!opt.allowed) throw new HostingPlanChangeError(opt.blocked_reason, opt.blocked_message)
  return { ...po, option: opt }
}

module.exports = { hostingPlanOptions, hostingQuote, planIdOf, HostingPlanChangeError }
