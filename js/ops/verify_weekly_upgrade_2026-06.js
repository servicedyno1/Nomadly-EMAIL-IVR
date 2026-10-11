#!/usr/bin/env node
require('../config-setup')
require('../log-redact.js').installConsoleRedaction && require('../log-redact.js').installConsoleRedaction()
/*
 * READ-ONLY check: did a recent reseller-API WEEKLY → monthly hosting upgrade
 * land correctly in BOTH the reseller DB (cpanelAccounts + resellerApiOrders)
 * AND on the WHM box (account's live package)?
 *
 * No writes. Connects to RESELLER_DB_URL and reads WHM via whm-service.
 */
const { MongoClient } = require('mongodb')
const whmService = require('../whm-service')

const PLAN_MAP = {
  'premium anti-red (1-week)': 'Premium-Anti-Red-1-Week',
  'premium anti-red hostpanel (1-month)': 'Premium-Anti-Red-HostPanel-1-Month',
  'premium anti-red hostpanel (30 days)': 'Premium-Anti-Red-HostPanel-1-Month',
  'golden anti-red hostpanel (1-month)': 'Golden-Anti-Red-HostPanel-1-Month',
  'golden anti-red hostpanel (30 days)': 'Golden-Anti-Red-HostPanel-1-Month',
}
const expectedPkg = (plan) => PLAN_MAP[String(plan || '').toLowerCase()] || '(unmapped)'
const isWeekly = (plan) => /week/i.test(String(plan || ''))

;(async () => {
  const url = process.env.RESELLER_DB_URL || process.env.MONGO_URL
  if (!url) throw new Error('RESELLER_DB_URL / MONGO_URL not set')
  const dbName = process.env.RESELLER_DB_NAME || process.env.DB_NAME
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 20000 })
  await client.connect()
  const db = client.db(dbName)
  console.log(`[verify] connected reseller DB=${db.databaseName}`)
  console.log(`[verify] WHM target: WHM_API_URL=${process.env.WHM_API_URL || '(direct)'} WHM_HOST=${process.env.WHM_HOST || '(none)'}`)

  const cpanel = db.collection('cpanelAccounts')
  const orders = db.collection('resellerApiOrders')

  // 1) Recent reseller-API plan-change orders (any direction), newest first.
  const recentOrders = await orders.find({ product: 'hosting', action: { $in: ['upgrade', 'downgrade'] } })
    .sort({ createdAt: -1 }).limit(15).toArray()
  console.log(`\n[verify] recent hosting plan-change API orders: ${recentOrders.length}`)
  recentOrders.forEach(o => console.log('   ', JSON.stringify({
    at: o.createdAt, action: o.action, status: o.status, mode: o.mode, price: o.priceUsd,
    from: o.request && o.request.from_plan, to: o.request && o.request.to_plan,
    user: o.request && o.request.username, domain: o.request && o.request.domain,
    billing: o.request && o.request.billing, error: o.error,
  })))

  // 2) Accounts whose most-recent plan-change came FROM a weekly plan (the ask), newest first.
  const upgraded = await cpanel.find({
    source: 'reseller_api',
    $or: [
      { upgradedFrom: { $regex: 'week', $options: 'i' } },
      { 'planChangeHistory.from': { $regex: 'week', $options: 'i' } },
    ],
  }).sort({ planChangedAt: -1, upgradedAt: -1 }).limit(10).toArray()

  console.log(`\n[verify] reseller cpanel accounts upgraded FROM a weekly plan: ${upgraded.length}`)

  // Pick the single most recent weekly→monthly change to deep-verify.
  let target = null
  let targetChange = null
  for (const a of upgraded) {
    const hist = Array.isArray(a.planChangeHistory) ? a.planChangeHistory : []
    const weeklyChanges = hist.filter(h => isWeekly(h.from)).sort((x, y) => new Date(y.at) - new Date(x.at))
    const ch = weeklyChanges[0]
    const at = ch ? new Date(ch.at) : (a.planChangedAt ? new Date(a.planChangedAt) : new Date(0))
    if (!target || at > targetChange._at) { target = a; targetChange = ch ? { ...ch, _at: at } : { _at: at, from: a.upgradedFrom, to: a.plan } }
  }

  if (!target) {
    console.log('[verify] No reseller-API account found whose plan change came from a weekly plan.')
    await client.close()
    return
  }

  console.log('\n[verify] ===== DEEP-VERIFY most recent weekly upgrade =====')
  console.log(`[verify] cpanel user: ${target._id}  domain: ${target.domain}`)
  console.log('[verify] --- Reseller DB state (cpanelAccounts) ---')
  console.log(JSON.stringify({
    _id: target._id, chatId: target.chatId, domain: target.domain,
    plan: target.plan, renewalPriceUsd: target.renewalPriceUsd,
    termMonths: target.termMonths, autoRenew: target.autoRenew,
    expiryDate: target.expiryDate, planChangedAt: target.planChangedAt,
    upgradedFrom: target.upgradedFrom, upgradedAt: target.upgradedAt,
    provisionState: target.provisionState, suspended: target.suspended,
    deleted: target.deleted, terminatedOnWhm: target.terminatedOnWhm,
  }, null, 2))

  const hist = Array.isArray(target.planChangeHistory) ? target.planChangeHistory : []
  console.log('[verify] --- planChangeHistory (last 5) ---')
  hist.slice(-5).forEach(h => console.log('   ', JSON.stringify({
    at: h.at, status: h.status, from: h.from, to: h.to, direction: h.direction,
    billing: h.billing, charged_usd: h.charged_usd, unused_credit_usd: h.unused_credit_usd,
    previous_expires_at: h.previous_expires_at, expires_at: h.expires_at,
    renewal_price_usd: h.renewal_price_usd, term_months: h.term_months, via: h.via,
  })))

  const dbExpectedPkg = expectedPkg(target.plan)
  console.log(`\n[verify] DB plan "${target.plan}" → expected WHM package: ${dbExpectedPkg}`)

  // 3) WHM live state
  console.log('[verify] --- WHM live account state ---')
  let acct = null
  try {
    const info = await whmService.getAccountInfo(target._id)
    if (!info || !info.success) {
      console.log(`[verify] WHM getAccountInfo: NOT FOUND / failed (${info && info.error ? info.error : 'no success'})`)
    } else {
      acct = info.data
      console.log(JSON.stringify({
        user: acct.user, domain: acct.domain, plan: acct.plan,
        suspended: acct.suspended, suspendreason: acct.suspendreason,
        startdate: acct.startdate, maxsql: acct.maxsql, maxaddons: acct.maxaddon || acct.maxaddons,
        diskused: acct.diskused, disklimit: acct.disklimit,
      }, null, 2))
    }
  } catch (e) {
    console.log(`[verify] WHM getAccountInfo threw: ${e.message}`)
  }

  // 4) Verdict
  console.log('\n[verify] ===== VERDICT =====')
  if (acct) {
    const whmPkg = String(acct.plan || '')
    const match = whmPkg === dbExpectedPkg
    console.log(`[verify] WHM package = "${whmPkg}"`)
    console.log(`[verify] DB expected  = "${dbExpectedPkg}"`)
    console.log(`[verify] WHM↔DB package match: ${match ? 'YES ✅' : 'NO ❌ (MISMATCH — WHM not upgraded)'}`)
    const lastCompleted = hist.filter(h => h.status === 'completed').slice(-1)[0]
    console.log(`[verify] DB plan-change history recorded: ${lastCompleted ? 'YES ✅' : 'NO ❌'}`)
    if (target.expiryDate) console.log(`[verify] DB expiry (fresh 30d term expected for weekly→monthly): ${new Date(target.expiryDate).toISOString()}`)
    console.log(`[verify] DB renewalPriceUsd: ${target.renewalPriceUsd}`)
  } else {
    console.log('[verify] Could not read WHM account — cannot confirm the WHM-side package.')
  }

  await client.close()
  console.log('\n[verify] done.')
})().catch(e => { console.error('[verify] FATAL', e); process.exit(1) })
