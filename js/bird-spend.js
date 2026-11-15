'use strict'
// Bird has no balance API, so we estimate what was spent with Bird since the admin's last top-up
// (calls, lookups, eSIMs) and alert the admin once a day while the estimate is at 80%+ of that top-up.
const DEFAULT_BUDGET = 50
const ALERT_AT = 0.8
const COST = () => ({ callMin: Number(process.env.BIRD_CALL_COST_PER_MIN || 0.01), lookup: 0.005, emailLookup: 0.0005 })
let col = null, pending = { total: 0, calls: 0, lookups: 0, esims: 0 }, timer = null

const day = (d = new Date()) => d.toISOString().slice(0, 10)
function init(db) { col = db.collection('birdSpend') }

function add(kind, usd) {
  if (!(usd > 0) || !col) return
  pending.total += usd; pending[kind] = (pending[kind] || 0) + usd
  if (!timer) timer = setTimeout(flush, 5000)
}
async function flush() {
  timer = null
  const p = pending; pending = { total: 0, calls: 0, lookups: 0, esims: 0 }
  if (!p.total) return
  const inc = { spent: p.total, [`days.${day()}`]: p.total }
  for (const k of ['calls', 'lookups', 'esims']) if (p[k]) inc[`by.${k}`] = p[k]
  await col.updateOne({ _id: 'current' }, { $inc: inc, $setOnInsert: { budget: DEFAULT_BUDGET, since: new Date() } }, { upsert: true })
    .catch(() => { for (const k of Object.keys(p)) pending[k] += p[k] })
}

const call = (seconds) => add('calls', Math.max(1, Math.ceil(seconds / 60)) * COST().callMin)
const lookup = (n = 1) => add('lookups', n * COST().lookup)
const emailLookup = (n = 1) => add('lookups', n * COST().emailLookup)
const esim = (usd) => add('esims', Number(usd) || 0)

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100
async function status() {
  await flush()
  const d = (col && await col.findOne({ _id: 'current' })) || { spent: 0, budget: DEFAULT_BUDGET, since: null }
  const spent = r2(d.spent), budget = r2(d.budget || DEFAULT_BUDGET)
  const last7 = [...Array(7)].map((_, i) => { const k = day(new Date(Date.now() - i * 864e5)); return { day: k, usd: r2(d.days?.[k]) } }).reverse()
  return { spent, budget, left: r2(Math.max(0, budget - spent)), pct: budget ? Math.round((spent / budget) * 100) : 0, since: d.since, by: { calls: r2(d.by?.calls), lookups: r2(d.by?.lookups), esims: r2(d.by?.esims) }, today: r2(d.days?.[day()]), last7, callCostPerMin: COST().callMin }
}

// The admin topped Bird up: start counting again from zero against the new amount.
async function topUp(amount) {
  const budget = r2(amount)
  if (!(budget > 0) || budget > 100000) throw new Error('Enter the amount you added to Bird, in USD.')
  await flush()
  await col.updateOne({ _id: 'current' }, { $set: { spent: 0, budget, since: new Date(), days: {}, by: {}, alertedOn: null } }, { upsert: true })
  return status()
}

// Called by provider-health every 5 min → alert text once a day while at 80%+, else null.
async function check() {
  if (!col || !process.env.BIRD_API_KEY) return null
  const s = await status()
  if (s.spent < s.budget * ALERT_AT) return null
  const r = await col.updateOne({ _id: 'current', alertedOn: { $ne: day() } }, { $set: { alertedOn: day() } })
  if (!r.modifiedCount) return null
  return `⚠️ [Providers] Bird balance estimate: about $${s.spent.toFixed(2)} of your $${s.budget.toFixed(2)} top-up is used (${s.pct}%), ~$${s.left.toFixed(2)} left. Today: $${s.today.toFixed(2)}. Top up Bird, then press "I topped up Bird" on the admin page to reset the estimate.`
}

module.exports = { init, call, lookup, emailLookup, esim, status, topUp, check, flush, DEFAULT_BUDGET }
