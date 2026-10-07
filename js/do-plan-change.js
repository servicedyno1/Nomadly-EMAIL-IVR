// DigitalOcean plan change (resize) for Linux VPS + Windows RDP — options, pro-rata quote, safe resize.
// Shared by the reseller API and the Telegram bot. DigitalOcean only (provider 'digitalocean' /
// 'digitalocean-rdp'). Rules: upgrades charge (new monthly − current monthly) × days left / 30 now;
// downgrades/switches are free (no refund); the new price applies from the next renewal. CPU/RAM-only
// resize by default (reversible); disk growth only on request (permanent); DO never shrinks a disk,
// so a target whose disk is smaller than the droplet's current disk is not allowed.
const crypto = require('crypto')
const { atomicIncrement } = require('./db')
const doVps = require('./digitalocean-service')
const doRdp = require('./digitalocean-rdp-service')

const DAY_MS = 86400000
const T = {
  poll: Number(process.env.DO_RESIZE_POLL_MS) || 5000,
  shutdownMs: 120000,
  powerOffMs: 90000,
  resizeMs: 60 * 60000,
  powerOnMs: 300000,
  staleMs: 90 * 60000,
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = (method, path, body) => doVps.apiRequest(method, path, body)

class PlanChangeError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

function isDoRecord(rec) {
  if (!rec) return false
  const p = String(rec.provider || '').toLowerCase()
  const id = instanceIdOf(rec)
  if (rec.isRDP) return p === 'digitalocean-rdp' || /^rdp-/i.test(id)
  return p === 'digitalocean' || /^do-\d+$/i.test(id)
}

function instanceIdOf(rec) { return String(rec.instanceId || rec.contaboInstanceId || rec.vpsId || '') }

async function _rdpServer(rec) {
  const col = doRdp.serversCollection()
  if (!col) throw new PlanChangeError('provider_unavailable', 'RDP service is not initialised.', 503)
  const s = await col.findOne({ server_id: doRdp.normId(instanceIdOf(rec)) })
  if (!s || !s.do_droplet_id) throw new PlanChangeError('not_ready', 'This server has no running droplet yet.')
  return s
}

async function _getDroplet(id) {
  let d
  try { d = (await api('GET', `/droplets/${id}`)).droplet } catch (e) {
    if (e.status === 404) throw new PlanChangeError('not_found', 'Server not found at the provider.', 404)
    throw new PlanChangeError('provider_error', `Provider unavailable: ${e.message}`, 502)
  }
  if (!d) throw new PlanChangeError('not_found', 'Server not found at the provider.', 404)
  return { id: d.id, size_slug: d.size_slug, disk_gb: Number(d.disk) || 0, status: d.status, region: d.region && d.region.slug }
}

const rdpTier = (slug) => (doRdp.TIERS || []).find((t) => t.slug === slug) || null
const rdpMonthly = (tier) => doRdp.getProduct(`${tier.slug}-1m`).pricing.totalWithMarkup
const family = (slug) => (/-amd$/.test(slug) ? 'amd' : /-intel$/.test(slug) ? 'intel' : 'basic')
const storageOf = (slug) => (family(slug) === 'basic' ? 'SSD' : 'NVMe SSD')
const cpuOf = (slug) => ({ amd: 'AMD', intel: 'Intel', basic: 'Standard' })[family(slug)]

function _checkRecord(rec, now) {
  if (!isDoRecord(rec)) throw new PlanChangeError('not_supported', 'Plan changes are available for DigitalOcean servers only.', 501)
  const status = String(rec.status || '').toUpperCase()
  if (['PROVISIONING', 'FAILED', 'DELETED', 'DESTROYED', 'CANCELLED', 'PENDING_CANCELLATION'].includes(status) || rec.provisionState === 'provisioning' || rec.deleted) {
    throw new PlanChangeError('not_active', `This server is ${String(rec.status || 'not active').toLowerCase()} — plan changes need an active server.`)
  }
  if (rec.planChange && ['running', 'reconciling'].includes(rec.planChange.status)) throw new PlanChangeError('plan_change_in_progress', 'A plan change is already running for this server.')
  const end = rec.end_time ? new Date(rec.end_time) : null
  if (!end || isNaN(end.getTime()) || end <= now) throw new PlanChangeError('expired', 'The current term has ended — renew first, then change the plan.')
  return end
}

// Everything needed to price + validate a change for this record.
async function loadContext(rec, now = new Date()) {
  const end = _checkRecord(rec, now)
  const remainingDays = Math.max(0, (end.getTime() - now.getTime()) / DAY_MS)
  if (rec.isRDP) {
    const server = await _rdpServer(rec)
    const droplet = await _getDroplet(server.do_droplet_id)
    const curSlug = server.tier_slug || String(rec.productId || '').replace(/-\d+m$/i, '')
    const tier = rdpTier(curSlug)
    const months = Number(server.duration_months || rec.durationMonths) || 1
    return {
      kind: 'rdp', rec, server, droplet, months, remainingDays, end, region: server.region || droplet.region,
      current: {
        plan_id: curSlug, name: tier ? tier.name : curSlug, vcpus: tier ? tier.vcpu : null, ram_gb: tier ? tier.ram_gb : null,
        disk_gb: droplet.disk_gb, storage_type: storageOf(droplet.size_slug), cpu: cpuOf(droplet.size_slug), size_slug: droplet.size_slug,
        monthly_price_usd: tier ? rdpMonthly(tier) : round2((Number(rec.planPrice) || 0) / months),
      },
    }
  }
  const droplet = await _getDroplet(instanceIdOf(rec).replace(/^do-/i, ''))
  const cur = doVps.getProduct(droplet.size_slug)
  const region = droplet.region || rec.region
  const curPrice = cur ? doVps.calculatePrice(cur, region) : null
  return {
    kind: 'vps', rec, droplet, months: 1, remainingDays, end, region,
    current: {
      plan_id: droplet.size_slug, name: cur ? cur.name : droplet.size_slug,
      vcpus: cur ? cur.cpuCores : null, ram_gb: cur ? Math.round(cur.ramMb / 1024) : null, disk_gb: droplet.disk_gb,
      storage_type: storageOf(droplet.size_slug), cpu: cpuOf(droplet.size_slug), size_slug: droplet.size_slug,
      monthly_price_usd: curPrice ? curPrice.totalWithMarkup : round2(Number(rec.planPrice) || 0),
    },
  }
}

function _option(ctx, t) {
  const cur = ctx.current
  const diff = round2(t.monthly - cur.monthly_price_usd)
  const direction = diff > 0 ? 'upgrade' : diff < 0 ? 'downgrade' : 'switch'
  const diskOk = t.disk_gb >= ctx.droplet.disk_gb
  return {
    plan_id: t.plan_id, name: t.name, vcpus: t.vcpus, ram_gb: t.ram_gb, disk_gb: t.disk_gb,
    storage_type: storageOf(t.size_slug), cpu: cpuOf(t.size_slug), size_slug: t.size_slug,
    direction, monthly_price_usd: t.monthly, monthly_difference_usd: diff, renewal_price_usd: t.renewal,
    charge_now_usd: direction === 'upgrade' ? round2(diff * ctx.remainingDays / 30) : 0,
    refund_usd: 0, effective: 'immediately', new_price_from: 'next_renewal',
    disk_after_gb: ctx.droplet.disk_gb, can_resize_disk: t.disk_gb > ctx.droplet.disk_gb,
    allowed: diskOk, blocked_reason: diskOk ? null : 'disk_too_small',
    blocked_message: diskOk ? null : `This plan's ${t.disk_gb} GB disk is smaller than the server's current ${ctx.droplet.disk_gb} GB disk (disks can never shrink).`,
    downtime_minutes: '2-5',
  }
}

function _targets(ctx) {
  if (ctx.kind === 'rdp') {
    const fam = family(ctx.current.size_slug)
    return (doRdp.TIERS || []).filter((t) => t.slug !== ctx.current.plan_id).map((t) => {
      const sizes = doRdp.sizeCandidatesFor(t, ctx.region).sort((a, b) => (family(b) === fam) - (family(a) === fam))
      const size = sizes.find((s) => doVps.isProductAvailable(s, ctx.region))
      if (!size) return null
      const renewal = doRdp.getProduct(`${t.slug}-${ctx.months}m`)
      return {
        plan_id: t.slug, name: t.name, vcpus: t.vcpu, ram_gb: t.ram_gb, disk_gb: t.disk_gb, size_slug: size,
        monthly: rdpMonthly(t), renewal: renewal ? renewal.pricing.totalWithMarkup : round2(rdpMonthly(t) * ctx.months),
      }
    }).filter(Boolean)
  }
  return doVps.listProducts(ctx.region, false).filter((p) => p.productId !== ctx.current.size_slug).map((p) => ({
    plan_id: p.productId, name: p.name, vcpus: p.cpuCores, ram_gb: p.ramGb, disk_gb: p.diskGb, size_slug: p.productId,
    monthly: p.pricing.totalWithMarkup, renewal: p.pricing.totalWithMarkup,
  }))
}

async function planOptions(rec, now = new Date()) {
  const ctx = await loadContext(rec, now)
  const options = _targets(ctx).map((t) => _option(ctx, t))
    .sort((a, b) => a.monthly_price_usd - b.monthly_price_usd || a.disk_gb - b.disk_gb)
  return { ctx, current: ctx.current, remaining_days: round2(ctx.remainingDays), term_ends_at: ctx.end.toISOString(), options }
}

async function quote(rec, planId, { resizeDisk = false, now = new Date() } = {}) {
  const { ctx, options } = await planOptions(rec, now)
  const opt = options.find((o) => o.plan_id === String(planId || ''))
  if (!opt) {
    if (String(planId || '') === ctx.current.plan_id) throw new PlanChangeError('same_plan', 'The server is already on this plan.', 400)
    throw new PlanChangeError('invalid_plan', 'plan_id is not an available target for this server (unknown or out of stock). Call plan-options first.', 400)
  }
  if (!opt.allowed) throw new PlanChangeError(opt.blocked_reason, opt.blocked_message)
  const disk = !!resizeDisk && opt.can_resize_disk
  return { ctx, option: { ...opt, resize_disk: disk, disk_after_gb: disk ? opt.disk_gb : opt.disk_after_gb, downtime_minutes: disk ? '5-30' : opt.downtime_minutes } }
}

async function _waitStatus(id, want, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const d = await _getDroplet(id).catch(() => null)
    if (d && d.status === want) return d
    await sleep(T.poll)
  }
  return null
}

async function _waitAction(actionId, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const a = await api('GET', `/actions/${actionId}`).then((r) => r.action).catch(() => null)
    if (a && (a.status === 'completed' || a.status === 'errored')) return a.status
    await sleep(T.poll)
  }
  return 'timeout'
}

// Power off (graceful → hard), resize, restore the previous power state. Never leaves an
// originally running server powered off, even when the resize itself fails.
async function resizeDroplet(dropletId, sizeSlug, resizeDisk, { log = () => {}, onPhase = () => {} } = {}) {
  let d = await _getDroplet(dropletId)
  if (d.size_slug === sizeSlug) return { success: true, already: true, size_slug: d.size_slug, disk_gb: d.disk_gb, status: d.status }
  const wasOn = d.status !== 'off'
  const act = (type, extra) => api('POST', `/droplets/${dropletId}/actions`, { type, ...extra })
  if (wasOn) {
    await onPhase('powering_off')
    await act('shutdown').catch((e) => log(`shutdown request failed: ${e.message}`))
    if (!(await _waitStatus(dropletId, 'off', T.shutdownMs))) {
      await act('power_off').catch((e) => log(`power_off request failed: ${e.message}`))
      if (!(await _waitStatus(dropletId, 'off', T.powerOffMs))) {
        await act('power_on').catch(() => {})
        return { success: false, error: 'Could not power the server off for the resize.' }
      }
    }
  }
  let err = null
  try {
    await onPhase('resizing')
    const a = await act('resize', { size: sizeSlug, disk: !!resizeDisk })
    const st = await _waitAction(a.action.id, T.resizeMs)
    if (st !== 'completed') err = `Resize ${st}.`
  } catch (e) { err = e.message }
  if (wasOn) {
    await onPhase('powering_on')
    await act('power_on').catch((e) => log(`power_on request failed: ${e.message}`))
    await _waitStatus(dropletId, 'active', T.powerOnMs)
  }
  d = await _getDroplet(dropletId).catch(() => d)
  if (err || d.size_slug !== sizeSlug) return { success: false, error: err || `Server is still on ${d.size_slug}.`, size_slug: d.size_slug, disk_gb: d.disk_gb }
  return { success: true, size_slug: d.size_slug, disk_gb: d.disk_gb, status: d.status }
}

// Persist the new plan on the record(s) after a successful resize. Driven by the stored change doc
// so the stale-change reconciler can finish a change after a restart.
async function applyRecord(vpsPlansOf, recId, change, result) {
  const at = new Date()
  const to = change.to
  const set = {
    productId: to.product_id, planPrice: to.renewal_price_usd, do_size_slug: result.size_slug, diskGb: result.disk_gb, planChangedAt: at,
    planChange: { ...change, status: 'completed', phase: null, finished_at: at, disk_after_gb: result.disk_gb },
  }
  if (change.source === 'reseller_api') set.plan = to.name
  await vpsPlansOf.updateOne({ _id: recId }, {
    $set: set,
    $push: { planChangeHistory: { id: change.id, at, from: change.from.plan_id, to: to.plan_id, direction: change.direction, charged_usd: change.charged_usd, size_slug: result.size_slug, disk_gb: result.disk_gb, resize_disk: change.resize_disk, via: change.via } },
  })
  if (change.kind === 'rdp') {
    await doRdp.serversCollection().updateOne({ server_id: change.server_id }, {
      $set: { tier_slug: to.plan_id, product_id: to.product_id, do_size_slug: result.size_slug, disk_gb: result.disk_gb, updated_at: at },
    })
  }
}

async function _fail(vpsPlansOf, walletOf, recId, change, error) {
  const refunded = change.charged_usd > 0 ? await atomicIncrement(walletOf, change.chat_id, 'usdIn', change.charged_usd) : false
  await vpsPlansOf.updateOne({ _id: recId }, { $set: { planChange: { ...change, status: 'failed', phase: null, error, refunded: !!refunded, refund_usd: refunded ? change.charged_usd : 0, finished_at: new Date() } } })
  return { success: false, error, refunded: !!refunded, refund_usd: refunded ? change.charged_usd : 0 }
}

function _changeDoc(rec, ctx, option, via) {
  return {
    id: crypto.randomUUID(), status: 'running', phase: 'queued', kind: ctx.kind, via, source: rec.source || 'bot',
    chat_id: String(rec.chatId), direction: option.direction, resize_disk: !!option.resize_disk, charged_usd: 0,
    droplet_id: ctx.kind === 'rdp' ? ctx.server.do_droplet_id : ctx.droplet.id, server_id: ctx.server ? ctx.server.server_id : null,
    was_on: ctx.droplet.status !== 'off',
    from: { plan_id: ctx.current.plan_id, name: ctx.current.name, size_slug: ctx.current.size_slug, disk_gb: ctx.current.disk_gb, monthly_price_usd: ctx.current.monthly_price_usd },
    to: {
      plan_id: option.plan_id, name: option.name, size_slug: option.size_slug, disk_gb: option.disk_gb, monthly_price_usd: option.monthly_price_usd,
      renewal_price_usd: option.renewal_price_usd, product_id: ctx.kind === 'rdp' ? `${option.plan_id}-${ctx.months}m` : option.plan_id,
    },
    started_at: new Date(),
  }
}

async function _run(vpsPlansOf, walletOf, recId, change, log) {
  try {
    const onPhase = (phase) => vpsPlansOf.updateOne({ _id: recId, 'planChange.id': change.id }, { $set: { 'planChange.phase': phase } }).catch(() => {})
    const result = await resizeDroplet(change.droplet_id, change.to.size_slug, change.resize_disk, { log, onPhase })
    if (!result.success) return await _fail(vpsPlansOf, walletOf, recId, change, result.error)
    await applyRecord(vpsPlansOf, recId, change, result)
    return { success: true, result }
  } catch (e) {
    log(`[DoPlanChange] ${change.id} crashed: ${e.message}`)
    return _fail(vpsPlansOf, walletOf, recId, change, e.message).catch(() => ({ success: false, error: e.message }))
  }
}

// Fresh quote → lock the record → charge the pro-rata amount → resize in the background.
// Returns immediately; `done` resolves with { success, change, ... } once the resize finishes.
async function start({ vpsPlansOf, walletOf, rec, planId, resizeDisk = false, via = 'bot', log = () => {}, onDone = () => {} }) {
  const { ctx, option } = await quote(rec, planId, { resizeDisk })
  const change = _changeDoc(rec, ctx, option, via)
  const locked = await vpsPlansOf.findOneAndUpdate(
    { _id: rec._id, 'planChange.status': { $nin: ['running', 'reconciling'] } },
    { $set: { planChange: change } },
    { returnDocument: 'after', includeResultMetadata: false },
  )
  if (!locked) throw new PlanChangeError('plan_change_in_progress', 'A plan change is already running for this server.')
  const amount = option.charge_now_usd
  if (amount > 0) {
    if (!(await atomicIncrement(walletOf, change.chat_id, 'usdOut', amount))) {
      await vpsPlansOf.updateOne({ _id: rec._id, 'planChange.id': change.id }, rec.planChange ? { $set: { planChange: rec.planChange } } : { $unset: { planChange: '' } })
      throw new PlanChangeError('insufficient_wallet_balance', `Wallet balance is below the $${amount.toFixed(2)} pro-rata charge.`, 402)
    }
    change.charged_usd = amount
    await vpsPlansOf.updateOne({ _id: rec._id, 'planChange.id': change.id }, { $set: { 'planChange.charged_usd': amount } })
  }
  const done = _run(vpsPlansOf, walletOf, rec._id, change, log).then(async (r) => {
    const out = { ...r, change: { ...change, status: r.success ? 'completed' : 'failed' } }
    try { await onDone(out) } catch (e) { log(`[DoPlanChange] onDone error: ${e.message}`) }
    return out
  })
  return { change, option, current: ctx.current, remaining_days: round2(ctx.remainingDays), done }
}

// Finish changes orphaned by a restart: resized → persist; otherwise refund. Restores power.
async function reconcileStale({ vpsPlansOf, walletOf, log = () => {}, onDone = () => {} }) {
  const cutoff = new Date(Date.now() - T.staleMs)
  const stale = await vpsPlansOf.find({ 'planChange.status': 'running', 'planChange.started_at': { $lt: cutoff } }).limit(10).toArray()
  for (const s of stale) {
    const rec = await vpsPlansOf.findOneAndUpdate(
      { _id: s._id, 'planChange.id': s.planChange.id, 'planChange.status': 'running' },
      { $set: { 'planChange.status': 'reconciling' } },
      { returnDocument: 'after', includeResultMetadata: false },
    )
    if (!rec) continue
    const change = { ...rec.planChange, status: 'running' }
    let out
    try {
      const d = await _getDroplet(change.droplet_id)
      if (change.was_on && d.status === 'off') await api('POST', `/droplets/${change.droplet_id}/actions`, { type: 'power_on' }).catch(() => {})
      if (d.size_slug === change.to.size_slug) {
        await applyRecord(vpsPlansOf, rec._id, change, { size_slug: d.size_slug, disk_gb: d.disk_gb })
        out = { success: true, reconciled: true }
      } else out = { ...(await _fail(vpsPlansOf, walletOf, rec._id, change, 'plan_change_interrupted')), reconciled: true }
    } catch (e) {
      log(`[DoPlanChange] reconcile ${change.id}: ${e.message}`)
      out = { ...(await _fail(vpsPlansOf, walletOf, rec._id, change, 'plan_change_interrupted')), reconciled: true }
    }
    try { await onDone({ ...out, change: { ...change, status: out.success ? 'completed' : 'failed' }, rec }) } catch (_) { /* best-effort */ }
  }
  return stale.length
}

// Public shape of a record's current/last plan change (API responses).
function publicView(pc) {
  if (!pc) return null
  return {
    id: pc.id, status: pc.status === 'reconciling' ? 'running' : pc.status, phase: pc.phase || null, direction: pc.direction,
    from_plan: pc.from && pc.from.plan_id, to_plan: pc.to && pc.to.plan_id, to_plan_name: pc.to && pc.to.name,
    resize_disk: !!pc.resize_disk, charged_usd: pc.charged_usd || 0, refunded: !!pc.refunded, refund_usd: pc.refund_usd || 0,
    disk_after_gb: pc.disk_after_gb || null, error: pc.error || null,
    started_at: pc.started_at ? new Date(pc.started_at).toISOString() : null,
    finished_at: pc.finished_at ? new Date(pc.finished_at).toISOString() : null,
  }
}

module.exports = { isDoRecord, instanceIdOf, rdpServerOf: _rdpServer, loadContext, planOptions, quote, start, reconcileStale, resizeDroplet, applyRecord, publicView, PlanChangeError, _timing: T }
