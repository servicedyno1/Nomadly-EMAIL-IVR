'use strict'
// Lifecycle alerts pushed to reseller webhooks: expiry reminders (T-7d / T-3d / T-1d), *.renewed,
// hosting.unsuspended, domain.expired and account.low_balance. Renewals / unsuspensions / expiries
// are detected by diffing each resource against the state stored on the previous sweep, so changes
// made through ANY channel (bot, API, scheduler, admin) are reported. Every event is de-duplicated
// in resellerWebhookDeliveries, so overlapping sweeps never double-send.
const webhooks = require('./reseller-webhooks')
const hostingScheduler = require('./hosting-scheduler')
const { getBalance } = require('./utils')

const DAY = 86400000
const STAGES = [7, 3, 1]
const STATE = 'resellerAlertState'
const STATE_TTL_DAYS = 30
const VPS_TERMINAL = ['CANCELLED', 'DESTROYED', 'DELETED', 'FAILED']
const day = (d) => new Date(d).toISOString().slice(0, 10)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const domainExpiry = (d) => d.expiresAt || d.expiryDate || d.renewalDate || d.expiry || (d.val && (d.val.expiresAt || d.val.expiryDate)) || null
const serverExpiry = (v) => v.end_time || v.expiresAt || v.subscriptionEnd || (v.subscription && v.subscription.subscriptionEnd) || null
const _indexed = new WeakSet()

// The reminder stage (7 | 3 | 1 days) whose window `expiresAt` is in, or null. A stage that is not
// shorter than the plan term never fires (a weekly plan would otherwise get "7 days left" at purchase).
function expiryStage(expiresAt, now, termDays = 30) {
  const left = new Date(expiresAt).getTime() - now
  if (!(left > 0)) return null
  const hit = STAGES.filter((s) => left <= s * DAY && s < termDays)
  return hit.length ? Math.min(...hit) : null
}

async function webhookOwners(db) {
  const keys = await db.collection('resellerApiKeys').find({ enabled: true, webhookUrl: { $exists: true, $ne: null } }, { projection: { ownerChatId: 1 } }).toArray()
  return [...new Set(keys.map((k) => String(k.ownerChatId)))]
}

async function ownedResources(db, owner) {
  const out = []
  const hosting = await db.collection('cpanelAccounts').find({
    chatId: owner, deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true },
    provisionState: { $nin: ['provisioning', 'failed'] }, expiryDate: { $exists: true, $ne: null },
  }).toArray()
  for (const a of hosting) {
    const rc = hostingScheduler.getRenewalCharge(a)
    out.push({
      product: 'hosting', id: String(a._id), expiresAt: a.expiryDate, suspended: !!a.suspended, planChangedAt: a.planChangedAt || null,
      termDays: rc.days,
      payload: { username: String(a._id), domain: a.domain || null, plan: a.plan || null, term_months: rc.months, renewal_price_usd: rc.priceUsd || null, auto_renew: a.autoRenew !== false },
    })
  }
  const servers = await db.collection('vpsPlansOf').find({ chatId: owner, deleted: { $ne: true }, provisionState: { $nin: ['provisioning', 'failed'] } }).toArray()
  for (const v of servers) {
    if (VPS_TERMINAL.includes(String(v.status || '').toUpperCase()) || v.cancelReason === 'expired_grace' || v.destroy_reason === 'expired_grace') continue
    const exp = serverExpiry(v)
    if (!exp) continue
    out.push({
      product: v.isRDP ? 'rdp' : 'vps', id: String(v.vpsId || v._id), expiresAt: exp, termDays: 30 * Math.max(1, Number(v.durationMonths) || 1),
      payload: { plan: v.plan || null, region: v.region || null, renewal_price_usd: Number(v.planPrice) || null, auto_renew: v.autoRenewable !== false && v.autoRenew !== false },
    })
  }
  const domains = await db.collection('domainsOf').find({ chatId: owner, domainName: { $exists: true } }).toArray()
  for (const d of domains) {
    const exp = domainExpiry(d)
    if (!exp) continue
    const name = String(d.domainName).toLowerCase()
    out.push({ product: 'domain', id: name, expiresAt: exp, termDays: 365, payload: { domain: name, registrar: d.registrar || null, renewal_price_usd: typeof d.autoRenewPriceUsd === 'number' ? d.autoRenewPriceUsd : null, auto_renew: d.autoRenew === true } })
  }
  return out.filter((r) => !isNaN(new Date(r.expiresAt).getTime()))
}

function ensureIndexes(db) {
  if (_indexed.has(db)) return
  _indexed.add(db)
  db.collection(STATE).createIndex({ checkedAt: 1 }, { expireAfterSeconds: STATE_TTL_DAYS * 86400 }).catch(() => { _indexed.delete(db) })
}

// One owner: emit due events, then persist the new baseline. Returns the events emitted (names).
async function sweepOwner(db, owner, now, log) {
  const resources = await ownedResources(db, owner)
  if (!resources.length) return []
  const stateCol = db.collection(STATE)
  const prev = new Map((await stateCol.find({ _id: { $in: resources.map((r) => `${r.product}:${r.id}`) } }).toArray()).map((s) => [s._id, s]))
  let balance = null
  const wallet = async () => (balance != null ? balance : (balance = r2((await getBalance(db.collection('walletOf'), owner)).usdBal)))
  const sent = []
  const pending = []
  const emit = (event, r, payload, dedupKey) => {
    sent.push(event)
    pending.push(webhooks.emit(db, { chatId: owner, event, instanceId: r.id, dedupKey, payload: { ...r.payload, ...payload }, log }))
  }
  const ops = []
  for (const r of resources) {
    const sid = `${r.product}:${r.id}`
    const s = prev.get(sid)
    const exp = new Date(r.expiresAt)
    const expMs = exp.getTime()
    const checkedMs = s && s.checkedAt ? new Date(s.checkedAt).getTime() : null
    // A hosting plan change that starts a fresh term is reported as hosting.plan_changed, not as a renewal.
    const planChanged = r.planChangedAt && checkedMs != null && new Date(r.planChangedAt).getTime() > checkedMs
    if (s && s.expiresAt && expMs > new Date(s.expiresAt).getTime() + 3600000 && !planChanged) {
      emit(`${r.product}.renewed`, r, { previous_expires_at: new Date(s.expiresAt).toISOString(), expires_at: exp.toISOString() }, webhooks.renewedDedupKey(r.id, exp))
    }
    if (r.product === 'hosting' && s && s.suspended && !r.suspended) {
      const since = s.suspendedSince || s.checkedAt
      emit('hosting.unsuspended', r, { expires_at: exp.toISOString(), suspended_since: since ? new Date(since).toISOString() : null }, `${r.id}:unsuspended:${new Date(since).getTime()}`)
    }
    if (r.product === 'domain' && expMs <= now && checkedMs != null && checkedMs < expMs) {
      emit('domain.expired', r, { expires_at: exp.toISOString() }, `${r.id}:expired:${day(exp)}`)
    }
    const stage = expiryStage(exp, now, r.termDays)
    if (stage) {
      const bal = await wallet()
      const price = r.payload.renewal_price_usd
      emit(`${r.product}.expiring`, r, {
        expires_at: exp.toISOString(), days_left: stage, hours_left: Math.max(0, Math.round((expMs - now) / 3600000)),
        wallet_balance_usd: bal, sufficient_balance: price != null ? bal >= price : null,
      }, `${r.id}:expiring:${stage}d:${day(exp)}`)
    }
    const suspendedSince = r.suspended ? ((s && s.suspended && s.suspendedSince) || new Date(now)) : null
    ops.push({ updateOne: { filter: { _id: sid }, update: { $set: { ownerChatId: owner, product: r.product, resourceId: r.id, expiresAt: exp, suspended: !!r.suspended, suspendedSince, checkedAt: new Date(now) } }, upsert: true } })
  }
  if (ops.length) await stateCol.bulkWrite(ops, { ordered: false })
  await Promise.allSettled(pending)
  return sent
}

// account.low_balance: fires once when the wallet drops below a key's threshold; re-arms once it is back above.
async function checkLowBalance(db, owner, { log = () => {} } = {}) {
  const keysCol = db.collection('resellerApiKeys')
  const keys = await keysCol.find({ ownerChatId: String(owner), enabled: true, 'alerts.lowBalanceUsd': { $gt: 0 }, webhookUrl: { $exists: true, $ne: null } }).toArray()
  if (!keys.length) return { checked: 0, alerted: 0 }
  const bal = r2((await getBalance(db.collection('walletOf'), String(owner))).usdBal)
  let alerted = 0
  for (const k of keys) {
    const threshold = Number(k.alerts.lowBalanceUsd)
    if (bal >= threshold) {
      if (k.alerts.lowBalanceAlertedAt) await keysCol.updateOne({ _id: k._id }, { $unset: { 'alerts.lowBalanceAlertedAt': '' } })
      continue
    }
    if (k.alerts.lowBalanceAlertedAt) continue
    const at = new Date()
    const claim = await keysCol.updateOne({ _id: k._id, 'alerts.lowBalanceAlertedAt': null }, { $set: { 'alerts.lowBalanceAlertedAt': at } })
    if (!claim.modifiedCount) continue
    alerted++
    await webhooks.emit(db, { chatId: owner, keyIds: [k._id], event: 'account.low_balance', instanceId: null, dedupKey: `lowbal:${at.getTime()}`, payload: { wallet_balance_usd: bal, threshold_usd: threshold, currency: 'usd' }, log })
  }
  return { checked: keys.length, balance: bal, alerted }
}

async function runLifecycleSweep(db, { now = Date.now(), log = () => {} } = {}) {
  ensureIndexes(db)
  const owners = await webhookOwners(db)
  const out = { owners: owners.length, events: [] }
  for (const o of owners) {
    try {
      out.events.push(...await sweepOwner(db, o, now, log))
      await checkLowBalance(db, o, { log })
    } catch (e) { log(`[ResellerAlerts] lifecycle sweep for ${o} failed: ${e.message}`) }
  }
  if (out.events.length) log(`[ResellerAlerts] lifecycle sweep: ${out.events.length} event(s) for ${owners.length} owner(s)`)
  return out
}

// Background sweeps run on the production bot only (dev pods share live data) and on the active slot.
function enabled() {
  const v = process.env.RESELLER_ALERTS_ENABLED
  if (v === 'true' || v === 'false') return v === 'true'
  return String(process.env.BOT_ENVIRONMENT || '').toLowerCase() === 'production'
}

function start({ getDb, log = console.log } = {}) {
  if (!enabled()) { log('[ResellerAlerts] background sweeps OFF (BOT_ENVIRONMENT!=production; set RESELLER_ALERTS_ENABLED=true to force)'); return [] }
  const activeSlot = require('./active-slot')
  const siteHealth = require('./reseller-site-health')
  const usage = require('./reseller-usage-alerts')
  const minutes = (name, d) => Math.max(1, Number(process.env[name]) || d) * 60000
  const every = (label, ms, fn) => {
    let running = false
    const t = activeSlot.singletonInterval(label, async () => {
      const db = getDb()
      if (running || !db) return
      running = true
      try { await fn(db) } catch (e) { log(`[ResellerAlerts] ${label} error: ${e.message}`) } finally { running = false }
    }, ms)
    if (t && typeof t.unref === 'function') t.unref()
    return t
  }
  log('[ResellerAlerts] scheduled: lifecycle every 10 min, site health every 5 min, usage every 15 min')
  return [
    every('reseller-lifecycle-alerts', minutes('RESELLER_ALERTS_LIFECYCLE_MIN', 10), (db) => runLifecycleSweep(db, { log })),
    every('reseller-site-health', minutes('RESELLER_HEALTH_CHECK_MIN', 5), (db) => siteHealth.runHealthSweep(db, { log })),
    every('reseller-usage-alerts', minutes('RESELLER_USAGE_ALERTS_MIN', 15), (db) => usage.runUsageSweep(db, { log })),
  ]
}

module.exports = { expiryStage, ownedResources, sweepOwner, runLifecycleSweep, checkLowBalance, webhookOwners, enabled, start, domainExpiry, STAGES, STATE }
