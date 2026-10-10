// Plan-change HISTORY for the reseller API (hosting + VPS + RDP) — one normalised entry shape.
//
// Sources (per resource):
//   • cpanelAccounts.planChangeHistory[]  — hosting changes (reseller API + Telegram bot)
//   • vpsPlansOf.planChangeHistory[]      — VPS/RDP in-place resizes: completed AND failed (refunded)
//   • vpsPlansOf.planChange               — the running / last attempt (merged in if not yet in history)
//   • legacy hosting fields upgradedAt / upgradedFrom / downgradedAt / downgradedFrom (+ bot
//     upgradeChargedAmount / upgradeCreditApplied) for changes made before history existed →
//     best-effort entries flagged legacy:true (fewer fields).
//
// Entry (common):  id, product, resource_id, at, status (completed|failed|running), direction,
//                  from_plan, from_plan_name, to_plan, to_plan_name, charged_usd, refund_usd, refunded,
//                  reason, via (api|bot|null), legacy
// Hosting only:    domain, billing (pro_rata|new_term|null), unused_credit_usd, loyalty_credit_usd,
//                  previous_expires_at, expires_at, renewal_price_usd
// VPS / RDP only:  resize_disk, size_slug, disk_gb, renewal_price_usd, started_at
const { planIdOf } = require('./hosting-plan-change')

const iso = (d) => {
  if (!d) return null
  const t = new Date(d)
  return isNaN(t.getTime()) ? null : t.toISOString()
}
const num = (n) => (typeof n === 'number' && isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null)
const ms = (d) => { const t = d ? new Date(d).getTime() : NaN; return isNaN(t) ? null : t }
const STATUSES = ['completed', 'failed', 'running']
const PRODUCTS = ['hosting', 'vps', 'rdp']
const VIAS = ['api', 'bot']

function hostingEntries(acct) {
  if (!acct) return []
  const base = { product: 'hosting', resource_id: acct._id, domain: acct.domain || null }
  const hist = Array.isArray(acct.planChangeHistory) ? acct.planChangeHistory : []
  const out = hist.map((h) => ({
    id: h.id || `hpc_${acct._id}_${ms(h.at) || 0}`,
    ...base,
    at: iso(h.at),
    status: STATUSES.includes(h.status) ? h.status : 'completed',
    direction: h.direction || null,
    from_plan: planIdOf(h.from), from_plan_name: h.from || null,
    to_plan: planIdOf(h.to), to_plan_name: h.to || null,
    billing: h.billing || null,
    charged_usd: num(h.charged_usd) ?? 0,
    unused_credit_usd: num(h.unused_credit_usd),
    loyalty_credit_usd: num(h.loyalty_credit_usd),
    refund_usd: 0, refunded: false, reason: null,
    previous_expires_at: iso(h.previous_expires_at), expires_at: iso(h.expires_at),
    renewal_price_usd: num(h.renewal_price_usd),
    via: VIAS.includes(h.via) ? h.via : null,
    // Entries written before billing details were recorded (pre 2026-10-10) carry no billing/expiry data.
    legacy: !h.billing,
  }))
  // Legacy markers only describe the MOST RECENT upgrade / downgrade. Add one only when no
  // history entry was recorded at that moment (±5 s).
  const recorded = (t) => out.some((e) => Math.abs((ms(e.at) || 0) - t) <= 5000)
  const legacy = (kind, at, from) => {
    const t = ms(at)
    if (t == null || recorded(t)) return
    // "to" = the plan the account moved on from next (earliest later entry), else its current plan.
    const later = out.filter((e) => (ms(e.at) || 0) > t).sort((a, b) => ms(a.at) - ms(b.at))[0]
    const toName = later ? later.from_plan_name : (acct.plan || null)
    const isBot = kind === 'upgrade' && typeof acct.upgradeChargedAmount === 'number'
    out.push({
      id: `hpc_legacy_${acct._id}_${t}`,
      ...base,
      at: iso(at), status: 'completed', direction: kind,
      from_plan: planIdOf(from), from_plan_name: from || null,
      to_plan: planIdOf(toName), to_plan_name: toName,
      billing: null,
      charged_usd: isBot ? num(acct.upgradeChargedAmount) : null,
      unused_credit_usd: null,
      loyalty_credit_usd: isBot ? num(acct.upgradeCreditApplied) : null,
      refund_usd: 0, refunded: false, reason: null,
      previous_expires_at: null, expires_at: null, renewal_price_usd: null,
      via: isBot ? 'bot' : null,
      legacy: true,
    })
  }
  if (acct.upgradedAt) legacy('upgrade', acct.upgradedAt, acct.upgradedFrom)
  if (acct.downgradedAt) legacy('downgrade', acct.downgradedAt, acct.downgradedFrom)
  return out
}

function serverEntries(rec) {
  if (!rec) return []
  const product = rec.isRDP ? 'rdp' : 'vps'
  const base = { product, resource_id: rec.vpsId || rec._id }
  const hist = Array.isArray(rec.planChangeHistory) ? rec.planChangeHistory : []
  const out = hist.map((h) => ({
    id: h.id || `pc_${base.resource_id}_${ms(h.at) || 0}`,
    ...base,
    at: iso(h.at),
    status: STATUSES.includes(h.status) ? h.status : 'completed',
    direction: h.direction || null,
    from_plan: h.from || null, from_plan_name: h.from_name || null,
    to_plan: h.to || null, to_plan_name: h.to_name || null,
    charged_usd: num(h.charged_usd) ?? 0,
    refund_usd: num(h.refund_usd) ?? 0, refunded: !!h.refunded,
    reason: h.reason || null,
    resize_disk: !!h.resize_disk, size_slug: h.size_slug || null, disk_gb: typeof h.disk_gb === 'number' ? h.disk_gb : null,
    renewal_price_usd: num(h.renewal_price_usd),
    started_at: iso(h.started_at),
    via: VIAS.includes(h.via) ? h.via : null,
    legacy: false,
  }))
  // Running / last attempt not in history yet (in-flight, or a failure from before failures were
  // recorded in history → legacy:true).
  const pc = rec.planChange
  if (pc && pc.id && !out.some((e) => e.id === pc.id)) {
    const status = ['running', 'reconciling'].includes(pc.status) ? 'running' : (pc.status === 'failed' ? 'failed' : 'completed')
    const from = pc.from || {}
    const to = pc.to || {}
    out.push({
      id: pc.id, ...base,
      at: iso(pc.finished_at || pc.started_at),
      status, direction: pc.direction || null,
      from_plan: from.plan_id || null, from_plan_name: from.name || null,
      to_plan: to.plan_id || null, to_plan_name: to.name || null,
      charged_usd: num(pc.charged_usd) ?? 0,
      refund_usd: num(pc.refund_usd) ?? 0, refunded: !!pc.refunded,
      reason: status === 'failed' ? (pc.error || null) : null,
      resize_disk: !!pc.resize_disk, size_slug: status === 'running' ? null : (to.size_slug || null),
      disk_gb: typeof pc.disk_after_gb === 'number' ? pc.disk_after_gb : null,
      renewal_price_usd: num(to.renewal_price_usd),
      started_at: iso(pc.started_at),
      via: VIAS.includes(pc.via) ? pc.via : null,
      legacy: status !== 'running',
    })
  }
  return out
}

// Newest first; ties broken by id (stable for cursor paging).
const cmp = (a, b) => ((ms(b.at) || 0) - (ms(a.at) || 0)) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0)
const sortEntries = (list) => list.slice().sort(cmp)

const encodeCursor = (e) => Buffer.from(JSON.stringify({ at: ms(e.at) || 0, id: String(e.id) })).toString('base64url')
function decodeCursor(c) {
  try {
    const o = JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8'))
    if (typeof o.at !== 'number' || typeof o.id !== 'string') return null
    return o
  } catch (_) { return null }
}

class HistoryQueryError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 400 }
}

// Validate + normalise list filters from a query string.
function parseFilters(q = {}) {
  const f = { products: null, since: null, until: null, status: null, via: null, limit: 50, cursor: null }
  if (q.product != null && q.product !== '') {
    const ps = String(q.product).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
    if (!ps.length || ps.some((p) => !PRODUCTS.includes(p))) throw new HistoryQueryError('invalid_product', 'product must be hosting, vps or rdp (comma-separated for several).')
    f.products = ps
  }
  for (const k of ['since', 'until']) {
    if (q[k] != null && q[k] !== '') {
      const d = new Date(String(q[k]))
      if (isNaN(d.getTime())) throw new HistoryQueryError('invalid_date', `${k} must be an ISO-8601 date/time (e.g. 2026-10-01 or 2026-10-01T00:00:00Z).`)
      f[k] = d
    }
  }
  if (f.since && f.until && f.since > f.until) throw new HistoryQueryError('invalid_date', 'since must be before until.')
  if (q.status != null && q.status !== '') {
    const s = String(q.status).toLowerCase()
    if (!STATUSES.includes(s)) throw new HistoryQueryError('invalid_status', 'status must be completed, failed or running.')
    f.status = s
  }
  if (q.via != null && q.via !== '') {
    const v = String(q.via).toLowerCase()
    if (!VIAS.includes(v)) throw new HistoryQueryError('invalid_via', 'via must be api or bot.')
    f.via = v
  }
  if (q.limit != null && q.limit !== '') {
    const n = Number(q.limit)
    if (!Number.isInteger(n) || n < 1) throw new HistoryQueryError('invalid_limit', 'limit must be a whole number from 1 to 200.')
    f.limit = Math.min(200, n)
  }
  if (q.cursor != null && q.cursor !== '') {
    f.cursor = decodeCursor(q.cursor)
    if (!f.cursor) throw new HistoryQueryError('invalid_cursor', 'cursor is not valid — pass next_cursor from the previous page unchanged.')
  }
  return f
}

// Filter + sort + paginate a list of entries.
function page(entries, f) {
  let list = entries.filter((e) => {
    const t = ms(e.at) || 0
    if (f.products && !f.products.includes(e.product)) return false
    if (f.since && t < f.since.getTime()) return false
    if (f.until && t > f.until.getTime()) return false
    if (f.status && e.status !== f.status) return false
    if (f.via && e.via !== f.via) return false
    return true
  })
  list = sortEntries(list)
  const total = list.length
  if (f.cursor) {
    const c = f.cursor
    list = list.filter((e) => { const t = ms(e.at) || 0; return t < c.at || (t === c.at && String(e.id) < c.id) })
  }
  const items = list.slice(0, f.limit)
  const hasMore = list.length > items.length
  return { items, total, has_more: hasMore, next_cursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null }
}

module.exports = { hostingEntries, serverEntries, sortEntries, parseFilters, page, encodeCursor, decodeCursor, HistoryQueryError, PRODUCTS, STATUSES }
