'use strict'
// Usage-threshold webhooks: hosting disk / bandwidth / inodes at 80% and 95% (checked hourly);
// VPS/RDP CPU over 90% averaged over 15 minutes, RAM over 90% and disk over 85% (every sweep).
// Each (resource, metric, level) fires once; a metric re-arms after dropping REARM_GAP points
// below its lowest level, so a value hovering at a threshold never floods the webhook.
const webhooks = require('./reseller-webhooks')
const whmService = require('./whm-service')
const doUsage = require('./do-usage')
const { isDoRecord } = require('./do-plan-change')

const HOSTING_LEVELS = { disk: [80, 95], bandwidth: [80, 95], inodes: [80, 95] }
const SERVER_LEVELS = { cpu: [90], memory: [90], disk: [85] }
const REARM_GAP = 5
const STATE = 'resellerUsageAlerts'
const HOSTING_EVERY_MS = 60 * 60000
const INACTIVE = ['CANCELLED', 'DESTROYED', 'DELETED', 'FAILED', 'STOPPED', 'OFF', 'PENDING_CANCELLATION', 'PROVISIONING', 'REINSTALLING']
const pct = (used, limit) => (Number(limit) > 0 && used != null ? Math.round((Number(used) / Number(limit)) * 1000) / 10 : null)
let _lastHostingAt = 0

// metrics: { name: { percent, ...extra } } → emits for newly crossed levels. Returns events emitted.
async function evaluate(db, { owner, product, id, metrics, levels, payload, now, log }) {
  const col = db.collection(STATE)
  const sid = `${product}:${id}`
  const prev = (await col.findOne({ _id: sid })) || {}
  const lv = { ...(prev.levels || {}) }
  const ep = { ...(prev.episodes || {}) }
  const sends = []
  for (const [metric, m] of Object.entries(metrics)) {
    if (!m || m.percent == null || !levels[metric]) continue
    const hit = levels[metric].filter((l) => m.percent >= l).pop() || 0
    const cur = Number(lv[metric]) || 0
    if (hit > cur) {
      lv[metric] = hit
      const { percent, ...extra } = m
      sends.push(webhooks.emit(db, { chatId: owner, event: `${product}.usage_threshold`, instanceId: id, dedupKey: `${id}:usage:${metric}:${hit}:${ep[metric] || 0}`, payload: { ...payload, metric, percent, threshold_pct: hit, ...extra }, log }))
    } else if (cur && m.percent < Math.min(...levels[metric]) - REARM_GAP) {
      lv[metric] = 0
      ep[metric] = (Number(ep[metric]) || 0) + 1
    }
  }
  await col.updateOne({ _id: sid }, { $set: { ownerChatId: owner, product, resourceId: id, levels: lv, episodes: ep, checkedAt: new Date(now) } }, { upsert: true })
  await Promise.allSettled(sends)
  return sends.length
}

async function hostingMetrics(acct, bwByUser) {
  const user = String(acct.cpUser || acct._id)
  const info = await whmService.getAccountInfo(user)
  if (!info || !info.success) return null
  const u = require('./reseller-api').parseHostingUsage(info.data) || {}
  const bw = bwByUser.get(user.toLowerCase())
  const bwUsed = bw ? Number(bw.totalbytes) || 0 : null
  const bwLimit = bw ? Number(bw.limit) || 0 : 0
  const mb = (b) => (b == null ? null : Math.round((b / 1048576) * 10) / 10)
  return {
    disk: { percent: u.disk_used_pct, used_mb: u.disk_used_mb, limit_mb: u.disk_limit_mb },
    bandwidth: { percent: pct(bwUsed, bwLimit), used_mb: mb(bwUsed), limit_mb: bwLimit > 0 ? mb(bwLimit) : null, period: 'current_month' },
    inodes: { percent: typeof u.inodes_limit === 'number' ? pct(u.inodes_used, u.inodes_limit) : null, used: u.inodes_used, limit: u.inodes_limit },
  }
}

async function hostingSweep(db, owners, now, log) {
  const accounts = await db.collection('cpanelAccounts').find({
    chatId: { $in: owners }, deleted: { $ne: true }, terminatedOnWhm: { $ne: true }, archived: { $ne: true },
    provisionState: { $nin: ['provisioning', 'failed'] }, suspended: { $ne: true },
  }).toArray()
  if (!accounts.length) return 0
  const bw = await whmService.listAccountBandwidth().catch(() => null)
  const bwByUser = new Map(((bw && bw.success && bw.data) || []).map((a) => [String(a.user).toLowerCase(), a]))
  let n = 0
  for (const a of accounts) {
    try {
      const metrics = await hostingMetrics(a, bwByUser)
      if (metrics) n += await evaluate(db, { owner: String(a.chatId), product: 'hosting', id: String(a._id), metrics, levels: HOSTING_LEVELS, payload: { username: String(a._id), domain: a.domain || null, plan: a.plan || null }, now, log })
    } catch (e) { log(`[UsageAlerts] hosting ${a._id}: ${e.message}`) }
  }
  return n
}

async function serverSweep(db, owners, now, log) {
  const recs = await db.collection('vpsPlansOf').find({ chatId: { $in: owners }, deleted: { $ne: true }, provisionState: { $nin: ['provisioning', 'failed'] } }).toArray()
  let n = 0
  for (const r of recs) {
    if (INACTIVE.includes(String(r.status || '').toUpperCase()) || !isDoRecord(r)) continue
    const product = r.isRDP ? 'rdp' : 'vps'
    try {
      const s = await doUsage.alertSnapshot(r)
      const metrics = {
        cpu: s.cpu != null ? { percent: s.cpu, window_minutes: 15 } : null,
        memory: s.memory != null ? { percent: s.memory, window_minutes: 15 } : null,
        disk: s.disk != null ? { percent: s.disk } : null,
      }
      n += await evaluate(db, { owner: String(r.chatId), product, id: String(r.vpsId || r._id), metrics, levels: SERVER_LEVELS, payload: { plan: r.plan || null, region: r.region || null }, now, log })
    } catch (e) { log(`[UsageAlerts] ${product} ${r.vpsId || r._id}: ${e.message}`) }
  }
  return n
}

async function runUsageSweep(db, { now = Date.now(), log = () => {}, includeHosting } = {}) {
  const keys = await db.collection('resellerApiKeys').find({ enabled: true, webhookUrl: { $exists: true, $ne: null } }, { projection: { ownerChatId: 1 } }).toArray()
  const owners = [...new Set(keys.map((k) => String(k.ownerChatId)))]
  if (!owners.length) return { hosting: 0, servers: 0 }
  const doHosting = includeHosting != null ? includeHosting : now - _lastHostingAt >= HOSTING_EVERY_MS
  if (doHosting) _lastHostingAt = now
  return {
    hosting: doHosting ? await hostingSweep(db, owners, now, log) : 0,
    servers: await serverSweep(db, owners, now, log),
  }
}

module.exports = { runUsageSweep, evaluate, HOSTING_LEVELS, SERVER_LEVELS, REARM_GAP, STATE }
