'use strict'
// Per-domain auto-renew (reseller API, OpenProvider domains only). OpenProvider's own autorenew stays
// OFF: this sweep charges the owner's wallet and renews the domain for 1 year from 7 days before the
// expiry date, retrying once a day until the domain expires. Emits domain.renewed on success and
// domain.auto_renew_failed (once a day) when the wallet is short or the registrar refuses.
const crypto = require('crypto')
const webhooks = require('./reseller-webhooks')
const activity = require('./reseller-activity')
const alerts = require('./reseller-alerts')
const { atomicIncrement } = require('./db')
const { getBalance } = require('./utils')

const DAY = 86400000
const WINDOW_DAYS = 7
const LOCK_MS = 15 * 60000
const OPENPROVIDER = 'OpenProvider'
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const iso = (d) => (d ? new Date(d).toISOString() : null)
const validDate = (raw) => { const d = raw ? new Date(raw) : null; return d && !isNaN(d.getTime()) ? d : null }

const isOpenProvider = (registrar) => String(registrar || '').toLowerCase() === 'openprovider'

async function registrarOf(db, d) {
  if (d.registrar) return d.registrar
  const rd = await db.collection('registeredDomains').findOne({ _id: String(d.domainName).toLowerCase() }, { projection: { val: 1 } })
  return (rd && rd.val && (rd.val.registrar || rd.val.provider)) || null
}

// Public auto-renew view of a domainsOf doc (POST /domains/:domain/auto-renew + GET /domains).
function view(d, registrar, now = Date.now()) {
  const exp = validDate(alerts.domainExpiry(d))
  const on = d.autoRenew === true
  let nextCharge = null
  if (on && exp && exp.getTime() > now) {
    const retry = validDate(d.autoRenewNextAttemptAt)
    if (!retry) nextCharge = new Date(Math.max(now, exp.getTime() - WINDOW_DAYS * DAY))
    else if (retry.getTime() < exp.getTime()) nextCharge = retry
  }
  return {
    domain: String(d.domainName).toLowerCase(),
    registrar: registrar || d.registrar || null,
    auto_renew: on,
    auto_renew_supported: isOpenProvider(registrar || d.registrar),
    renewal_period_years: 1,
    renewal_price_usd: typeof d.autoRenewPriceUsd === 'number' ? d.autoRenewPriceUsd : null,
    expires_at: iso(exp),
    next_charge_at: iso(nextCharge),
    auto_renew_last_error: d.autoRenewLastError || null,
    auto_renew_last_attempt_at: iso(d.autoRenewLastAttemptAt),
    auto_renew_next_attempt_at: iso(d.autoRenewNextAttemptAt),
  }
}

async function renewOne(db, d, exp, { now, log, op }) {
  const col = db.collection('domainsOf')
  const wallets = db.collection('walletOf')
  const domain = String(d.domainName).toLowerCase()
  const owner = String(d.chatId)
  const expMs = exp.getTime()
  const balance = async () => r2((await getBalance(wallets, owner)).usdBal)

  // The registrar is the source of truth: renewed elsewhere already → just sync the date.
  const info = await op.getDomainInfo(domain)
  const regExp = validDate(info && info.expiresAt)
  if (regExp && regExp.getTime() > expMs + DAY) {
    await col.updateOne({ _id: d._id }, { $set: { expiresAt: regExp } })
    return 'synced'
  }

  const fail = async (reason, extra = {}) => {
    const next = new Date(now + DAY)
    const nextAttempt = next.getTime() < expMs ? next : null
    await col.updateOne({ _id: d._id }, { $set: { autoRenewLastError: reason, autoRenewLastAttemptAt: new Date(now), autoRenewNextAttemptAt: next } })
    activity.record(db, { ownerChatId: owner, resourceType: 'domain', resourceId: domain, action: 'auto_renew.failed', actor: 'system', details: { reason, ...extra } })
    await webhooks.emit(db, {
      chatId: owner, event: 'domain.auto_renew_failed', instanceId: domain, dedupKey: `${domain}:arf:${new Date(now).toISOString().slice(0, 10)}`, log,
      payload: { domain, registrar: OPENPROVIDER, reason, expires_at: exp.toISOString(), wallet_balance_usd: await balance(), next_attempt_at: iso(nextAttempt), ...extra },
    })
    log(`[DomainAutoRenew] ${domain} (${owner}) failed: ${reason}`)
    return 'failed'
  }

  const quote = await op.getRenewPrice(domain)
  const price = r2(quote && quote.price)
  if (!(price > 0)) return fail('pricing_unavailable', { detail: (quote && quote.error) || null })
  if (!(await atomicIncrement(wallets, owner, 'usdOut', price))) return fail('insufficient_funds', { price_usd: price })
  try { alerts.checkLowBalance(db, owner, { log }).catch(() => {}) } catch (_) { /* best-effort */ }

  let r
  try { r = await op.renewDomain(domain, 1) } catch (e) { r = { error: e.message } }
  if (!r || !r.success) {
    await atomicIncrement(wallets, owner, 'usdIn', price)
    return fail('registrar_error', { price_usd: price, refunded: true, detail: (r && r.error) || null })
  }

  let newExp = validDate(r.expiresAt)
  if (!newExp || newExp.getTime() <= expMs) { newExp = new Date(expMs); newExp.setUTCFullYear(newExp.getUTCFullYear() + 1) }
  await col.updateOne({ _id: d._id }, {
    $set: { expiresAt: newExp, lastRenewedAt: new Date(now), autoRenewPriceUsd: price, autoRenewLastError: null, autoRenewLastAttemptAt: new Date(now), autoRenewNextAttemptAt: null },
    $inc: { renewalCount: 1 },
  })
  await db.collection('resellerApiOrders').insertOne({
    _id: crypto.randomUUID(), createdAt: new Date(), ownerChatId: owner, product: 'domain', action: 'auto_renew',
    request: { domain, period_years: 1 }, priceUsd: price, mode: 'live', status: 'provisioned', result: { expires_at: newExp.toISOString() },
  }).catch(() => {})
  const details = { via: 'auto_renew', charged_usd: price, period_years: 1, previous_expires_at: exp.toISOString(), expires_at: newExp.toISOString() }
  activity.record(db, { ownerChatId: owner, resourceType: 'domain', resourceId: domain, action: 'auto_renew.charged', actor: 'system', details })
  await webhooks.emit(db, {
    chatId: owner, event: 'domain.renewed', instanceId: domain, dedupKey: webhooks.renewedDedupKey(domain, newExp), log,
    payload: { domain, registrar: OPENPROVIDER, ...details, wallet_balance_usd: await balance() },
  })
  log(`[DomainAutoRenew] ${domain} (${owner}) renewed 1y — charged $${price}, expires ${newExp.toISOString()}`)
  return 'renewed'
}

// One domain: returns renewed | failed | synced | skipped.
async function processDomain(db, d, { now = Date.now(), log = () => {}, op = require('./op-service') } = {}) {
  const col = db.collection('domainsOf')
  if (d.autoRenew !== true || !d.chatId) return 'skipped'
  const retry = validDate(d.autoRenewNextAttemptAt)
  if (retry && retry.getTime() > now) return 'skipped'
  if (!isOpenProvider(await registrarOf(db, d))) return 'skipped'
  let exp = validDate(alerts.domainExpiry(d))
  if (!exp) {
    const info = await op.getDomainInfo(String(d.domainName).toLowerCase())
    exp = validDate(info && info.expiresAt)
    if (!exp) return 'skipped'
    await col.updateOne({ _id: d._id }, { $set: { expiresAt: exp } })
  }
  if (now < exp.getTime() - WINDOW_DAYS * DAY || now >= exp.getTime()) return 'skipped'

  // Per-domain lock so two sweeps (or pods) can never charge the same renewal twice.
  const lockId = crypto.randomUUID()
  const claimed = await col.findOneAndUpdate(
    { _id: d._id, autoRenew: true, $or: [{ autoRenewLock: { $exists: false } }, { autoRenewLock: null }, { 'autoRenewLock.at': { $lt: new Date(now - LOCK_MS) } }] },
    { $set: { autoRenewLock: { id: lockId, at: new Date(now) } } },
    { returnDocument: 'after', includeResultMetadata: false },
  )
  if (!claimed) return 'skipped'
  try {
    const fresh = validDate(alerts.domainExpiry(claimed))
    if (fresh && fresh.getTime() > exp.getTime()) return 'skipped'
    return await renewOne(db, claimed, exp, { now, log, op })
  } finally {
    await col.updateOne({ _id: d._id, 'autoRenewLock.id': lockId }, { $unset: { autoRenewLock: '' } }).catch(() => {})
  }
}

async function runSweep(db, { now = Date.now(), log = () => {}, op } = {}) {
  const docs = await db.collection('domainsOf').find({ autoRenew: true, domainName: { $exists: true } }).limit(2000).toArray()
  const out = { checked: docs.length, renewed: 0, failed: 0, synced: 0, skipped: 0 }
  for (const d of docs) {
    try { out[await processDomain(db, d, { now, log, op })]++ } catch (e) { log(`[DomainAutoRenew] ${d.domainName} error: ${e.message}`) }
  }
  if (out.renewed || out.failed) log(`[DomainAutoRenew] sweep: ${out.renewed} renewed, ${out.failed} failed of ${out.checked}`)
  return out
}

// Charges real wallets + calls the registrar → production bot only (dev pods share live data).
function enabled() {
  const v = process.env.RESELLER_DOMAIN_AUTORENEW_ENABLED
  if (v === 'true' || v === 'false') return v === 'true'
  return String(process.env.BOT_ENVIRONMENT || '').toLowerCase() === 'production'
}

function start({ getDb, log = console.log } = {}) {
  if (!enabled()) { log('[DomainAutoRenew] sweep OFF (BOT_ENVIRONMENT!=production; set RESELLER_DOMAIN_AUTORENEW_ENABLED=true to force)'); return null }
  let running = false
  const t = require('./active-slot').singletonInterval('reseller-domain-auto-renew', async () => {
    const db = getDb()
    if (running || !db) return
    running = true
    try { await runSweep(db, { log }) } catch (e) { log(`[DomainAutoRenew] sweep error: ${e.message}`) } finally { running = false }
  }, Math.max(5, Number(process.env.RESELLER_DOMAIN_AUTORENEW_MIN) || 60) * 60000)
  if (t && typeof t.unref === 'function') t.unref()
  log('[DomainAutoRenew] scheduled: hourly (renews from 7 days before expiry, retries daily)')
  return t
}

module.exports = { isOpenProvider, registrarOf, view, processDomain, runSweep, enabled, start, WINDOW_DAYS, OPENPROVIDER }
