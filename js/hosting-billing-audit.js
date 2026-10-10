// Weekly admin billing audit for hosting: report only, never changes data.
const { getPlanPrice, isWeeklyPlan } = require('./hosting-scheduler')
const repair = require('./hosting-renewal-price-repair')

const DAY = 24 * 60 * 60 * 1000
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const ms = (d) => { const t = d ? new Date(d).getTime() : NaN; return isNaN(t) ? null : t }
const LIVE = { deleted: { $ne: true }, provisionState: { $ne: 'failed' }, terminatedOnWhm: { $ne: true } }
const PROJECTION = { _id: 1, domain: 1, chatId: 1, plan: 1, source: 1, renewalPriceUsd: 1, expiryDate: 1, suspended: 1, autoRenew: 1, upgradedAt: 1, upgradedFrom: 1, planChangedAt: 1, renewalPriceRepairedAt: 1 }

async function runAudit(cpanelAccounts, now = new Date()) {
  const t = now.getTime()
  const docs = await cpanelAccounts.find(LIVE, { projection: PROJECTION }).toArray()
  const stale = docs.map(repair.assess).filter(Boolean)
  const staleIds = new Set(stale.map((r) => r.username))
  const out = { stale_after_plan_change: stale, price_above_list: [], weekly_term_too_long: [], expired_not_suspended: [], price_locked_below_list: [], no_price_lock: [] }
  for (const a of docs) {
    const exp = ms(a.expiryDate)
    const row = { username: a._id, domain: a.domain || null, plan: a.plan || null, source: a.source || 'bot', renewal_price_usd: typeof a.renewalPriceUsd === 'number' ? a.renewalPriceUsd : null, expires_at: exp ? new Date(exp).toISOString() : null }
    const list = getPlanPrice(String(a.plan || ''))
    if (row.renewal_price_usd == null || row.renewal_price_usd <= 0) out.no_price_lock.push({ ...row, list_price_usd: list })
    else if (!staleIds.has(a._id) && list > 0 && Math.abs(row.renewal_price_usd - list) >= 0.005) {
      const target = row.renewal_price_usd > list ? out.price_above_list : out.price_locked_below_list
      target.push({ ...row, list_price_usd: list, difference_usd: r2(row.renewal_price_usd - list) })
    }
    if (exp && isWeeklyPlan(a.plan) && exp > t + 8 * DAY) out.weekly_term_too_long.push({ ...row, days_left: Math.round((exp - t) / DAY) })
    if (exp && exp < t - 3 * DAY && !a.suspended) out.expired_not_suspended.push({ ...row, days_overdue: Math.round((t - exp) / DAY) })
  }
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))
  return { at: now.toISOString(), checked: docs.length, counts, needs_action: counts.stale_after_plan_change + counts.price_above_list + counts.weekly_term_too_long + counts.expired_not_suspended, ...out }
}

const names = (rows) => rows.slice(0, 8).map((r) => `<code>${r.username}</code>`).join(', ') + (rows.length > 8 ? ` +${rows.length - 8} more` : '')

function formatAdminSummary(res) {
  const line = (label, rows, hint = '') => (rows.length ? `\n• ${label}: <b>${rows.length}</b>${hint} — ${names(rows)}` : '')
  let msg = `🧾 <b>Weekly hosting billing audit</b>\nChecked ${res.checked} live accounts.`
  if (res.needs_action) {
    msg += '\n\n⚠️ <b>Needs action</b>'
      + line('Renewal price not updated after a plan change', res.stale_after_plan_change, ' (fix: /admin/hosting-renewal-price-repair)')
      + line('Renewal price ABOVE the list price', res.price_above_list)
      + line('Weekly plan with more than 8 days left', res.weekly_term_too_long)
      + line('Expired 3+ days but not suspended', res.expired_not_suspended)
  } else {
    msg += '\n\n✅ Nothing needs action.'
  }
  msg += `\n\nℹ️ Price-locked below list: ${res.counts.price_locked_below_list} · no price lock (renews at list): ${res.counts.no_price_lock}`
  return msg
}

module.exports = { runAudit, formatAdminSummary }
