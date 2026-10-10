// One-off repair (2026-10): hosting accounts upgraded in the Telegram bot BEFORE the billing fix kept
// their OLD price-locked renewalPriceUsd (e.g. weekly $30 → Golden still renewing at $30 instead of
// $100). This finds those accounts (preview) and sets renewalPriceUsd to the CURRENT plan's current
// list price (apply) — the same rule the fixed bot upgrade now uses.
//
// Affected = not deleted/terminated, has a numeric renewalPriceUsd, its LAST upgrade (upgradedAt) did
// not go through a path that already set the renewal price (reseller API / fixed bot both stamp
// planChangedAt = upgradedAt), not already repaired since that upgrade, and renewalPriceUsd differs
// from the current plan's list price. Promo customers who never upgraded are never touched.
const { getPlanPrice } = require('./hosting-scheduler')

const ms = (d) => { const t = d ? new Date(d).getTime() : NaN; return isNaN(t) ? null : t }
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const PROJECTION = { _id: 1, domain: 1, chatId: 1, source: 1, plan: 1, upgradedFrom: 1, upgradedAt: 1, planChangedAt: 1, renewalPriceUsd: 1, renewalPriceRepairedAt: 1, expiryDate: 1, autoRenew: 1, suspended: 1 }

function assess(acct) {
  const up = ms(acct.upgradedAt)
  if (up == null) return null
  const changedAt = ms(acct.planChangedAt)
  if (changedAt != null && changedAt >= up - 1000) return null // last upgrade already set the price
  const repairedAt = ms(acct.renewalPriceRepairedAt)
  if (repairedAt != null && repairedAt >= up) return null
  if (!(typeof acct.renewalPriceUsd === 'number' && acct.renewalPriceUsd > 0)) return null
  const correct = getPlanPrice(String(acct.plan || ''))
  if (!(correct > 0)) return null
  if (Math.abs(acct.renewalPriceUsd - correct) < 0.005) return null
  return {
    username: acct._id, domain: acct.domain || null, chat_id: acct.chatId != null ? String(acct.chatId) : null, source: acct.source || 'bot',
    plan: acct.plan, upgraded_from: acct.upgradedFrom || null, upgraded_at: new Date(up).toISOString(),
    current_renewal_price_usd: acct.renewalPriceUsd, correct_renewal_price_usd: r2(correct),
    difference_per_renewal_usd: r2(correct - acct.renewalPriceUsd),
    expires_at: acct.expiryDate ? new Date(acct.expiryDate).toISOString() : null,
    auto_renew: acct.autoRenew !== false, suspended: !!acct.suspended,
  }
}

async function findAffected(cpanelAccounts) {
  const docs = await cpanelAccounts.find(
    { upgradedAt: { $exists: true }, renewalPriceUsd: { $type: 'number' }, deleted: { $ne: true }, terminatedOnWhm: { $ne: true } },
    { projection: PROJECTION },
  ).toArray()
  return docs.map(assess).filter(Boolean).sort((a, b) => b.difference_per_renewal_usd - a.difference_per_renewal_usd)
}

function summarize(rows) {
  return {
    affected_count: rows.length,
    undercharged_count: rows.filter((r) => r.difference_per_renewal_usd > 0).length,
    overcharged_count: rows.filter((r) => r.difference_per_renewal_usd < 0).length,
    total_difference_per_renewal_usd: r2(rows.reduce((s, r) => s + r.difference_per_renewal_usd, 0)),
  }
}

// Apply to every affected account, or only `usernames` (from the preview). Compare-and-set on the
// previewed price + plan, so an account that changed since the preview is skipped, never overwritten.
async function applyRepair(cpanelAccounts, { usernames = null, now = new Date() } = {}) {
  const rows = await findAffected(cpanelAccounts)
  const wanted = Array.isArray(usernames) && usernames.length ? new Set(usernames.map((u) => String(u).toLowerCase())) : null
  const target = wanted ? rows.filter((r) => wanted.has(String(r.username).toLowerCase())) : rows
  const applied = []
  const skipped = []
  for (const r of target) {
    const res = await cpanelAccounts.updateOne(
      { _id: r.username, renewalPriceUsd: r.current_renewal_price_usd, plan: r.plan },
      { $set: { renewalPriceUsd: r.correct_renewal_price_usd, renewalPriceRepairedAt: now, renewalPriceRepair: { from_usd: r.current_renewal_price_usd, to_usd: r.correct_renewal_price_usd, plan: r.plan, at: now, reason: 'bot_upgrade_kept_old_price_lock' } } },
    )
    if (res && res.modifiedCount === 1) applied.push(r)
    else skipped.push({ ...r, skipped_reason: 'changed_since_preview' })
  }
  const notFound = wanted ? [...wanted].filter((u) => !rows.some((r) => String(r.username).toLowerCase() === u)) : []
  return { applied_count: applied.length, applied, skipped, not_affected: notFound, ...summarize(applied) }
}

module.exports = { findAffected, applyRepair, summarize, assess }
