// End-to-end RDP checkout / discount MATH audit (1 / 2 / 3-month bundles).
// Proves the same price flows correctly through EVERY surface:
//   A. Provider source of truth  — digitalocean-rdp sellPrice (all tiers × durations)
//   B. Bot flow                  — fetchAvailableVPSConfigs.billingCycles (the duration buttons)
//   C. Bot coupon composition    — coupon % applied ON TOP of the bundle-discounted price
//   D. Reseller API              — GET /rdp/plans, GET /pricing, POST /rdp/:id/renew {months}
// Formula: monthly_do_cost × months × 2 × (1 − bundleDiscount)   (2mo −10%, 3mo −15%)
//   node js/tests/test_rdp_checkout_math_2026-06.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp' // resolve RDP provider to DO in THIS process only
const crypto = require('crypto')
const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const { createResellerApi } = require('../reseller-api')
const svc = require('../digitalocean-rdp-service.js')
const vmSetup = require('../vm-instance-setup.js')

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`) } }
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

// Expected end-to-end totals for the whole prepaid period (not per-month).
const EXPECT = {
  standard: { 1: 56,  2: 100.8, 3: 142.8 },
  pro:      { 1: 112, 2: 201.6, 3: 285.6 },
  power:    { 1: 224, 2: 403.2, 3: 571.2 },
}
const DISC = { 1: 0, 2: 10, 3: 15 }

;(async () => {
  // ── A. Provider pricing = single source of truth ──
  console.log('\n── A: provider sellPrice (all tiers × 1/2/3 months) ──')
  const all = svc.listProducts('US', true)
  for (const slug of ['standard', 'pro', 'power']) {
    const by = Object.fromEntries(all.filter(p => p.slug === slug).map(p => [p.durationMonths, p]))
    for (const m of [1, 2, 3]) {
      const got = by[m] && by[m].pricing
      ok(`${slug} ${m}mo → $${EXPECT[slug][m]} (disc ${DISC[m]}%)`,
        got && got.totalWithMarkup === EXPECT[slug][m] && got.discountPct === DISC[m],
        got && `got $${got.totalWithMarkup} / ${got.discountPct}%`)
    }
  }
  // Discount is a real saving vs 1-month × N (never more than the un-bundled price).
  for (const slug of ['standard', 'pro', 'power']) {
    ok(`${slug} 2mo cheaper than 2× 1mo`, EXPECT[slug][2] < EXPECT[slug][1] * 2)
    ok(`${slug} 3mo cheaper than 3× 1mo`, EXPECT[slug][3] < EXPECT[slug][1] * 3)
  }

  // ── B. Bot flow: the real fetchAvailableVPSConfigs → billingCycles the duration step charges ──
  console.log('\n── B: bot fetchAvailableVPSConfigs billingCycles ──')
  const configs = await vmSetup.fetchAvailableVPSConfigs('test-chat', { region: 'US', isRDP: true })
  ok('fetchAvailableVPSConfigs returned 3 RDP tiers', Array.isArray(configs) && configs.length === 3, configs && `len=${configs.length}`)
  for (const cfg of (configs || [])) {
    const slug = String(cfg._id || '').replace(/-\d+m$/i, '')
    const cyclesByMonth = Object.fromEntries((cfg.billingCycles || []).map(c => [c.period, c]))
    ok(`${slug}: has 1/2/3-month billing cycles`, [1, 2, 3].every(m => cyclesByMonth[m]), JSON.stringify((cfg.billingCycles || []).map(c => c.period)))
    for (const m of [1, 2, 3]) {
      const c = cyclesByMonth[m]
      ok(`${slug}: ${m}mo cycle price $${EXPECT[slug][m]} discount ${DISC[m]}%`,
        c && c.price === EXPECT[slug][m] && (c.discountPct || 0) === DISC[m], c && `got $${c.price}/${c.discountPct || 0}%`)
    }
    ok(`${slug}: config.isRDP flag set (drives AMD descriptor)`, cfg.isRDP === true)
  }

  // ── C. Bot coupon composition: coupon % applies ON TOP of the bundle-discounted total ──
  console.log('\n── C: coupon composition on the bundle price (mirrors askCouponForVPSPlan) ──')
  const applyCoupon = (plantotalPrice, pct) => {
    const couponDiscount = (plantotalPrice * pct) / 100
    const newPrice = Math.max(1, plantotalPrice - couponDiscount)
    return { couponDiscount, newPrice }
  }
  // 2-month Standard ($100.8) + 10% coupon → $90.72
  const c1 = applyCoupon(EXPECT.standard[2], 10)
  ok('Standard 2mo + 10% coupon → $90.72', Math.round(c1.newPrice * 100) / 100 === 90.72, `got $${c1.newPrice}`)
  // 3-month Power ($571.2) + 25% coupon → $428.40
  const c2 = applyCoupon(EXPECT.power[3], 25)
  ok('Power 3mo + 25% coupon → $428.40', Math.round(c2.newPrice * 100) / 100 === 428.4, `got $${c2.newPrice}`)
  // A 100% coupon never charges below the $1 floor.
  const c3 = applyCoupon(EXPECT.standard[1], 100)
  ok('100% coupon floors the charge at $1 (never $0/negative)', c3.newPrice === 1, `got $${c3.newPrice}`)

  // ── D. Reseller API surfaces + bills the same numbers ──
  console.log('\n── D: reseller API (/rdp/plans, /pricing, POST /rdp/:id/renew) ──')
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const RAW = 'test-ckmath-raw-key'
  const OWNER = '900900900'
  await db.collection('resellerApiKeys').updateOne({ _id: 'test-ckmath-key' },
    { $set: { _id: 'test-ckmath-key', keyHash: sha256(RAW), ownerChatId: OWNER, enabled: true, scopes: ['*'] } }, { upsert: true })
  await db.collection('walletOf').updateOne({ _id: OWNER }, { $set: { _id: OWNER, usdIn: 5000, usdOut: 0 } }, { upsert: true })
  await db.collection('vpsPlansOf').updateOne({ _id: 'ckmath-rdp-1' }, { $set: {
    _id: 'ckmath-rdp-1', vpsId: 'ckmath-rdp-1', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp',
    instanceId: 'rdp-ckmath-0001', productId: 'standard-1m', plan: 'Standard — Windows RDP (1 month)',
    osId: 'ws2022', osType: 'windows', status: 'RUNNING', do_size_slug: 's-2vcpu-4gb-amd',
  } }, { upsert: true })

  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }))
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const H = { headers: { 'X-API-Key': RAW } }

  try {
    const plans = (await axios.get(`${base}/rdp/plans?region=US`, H)).data
    ok('GET /rdp/plans provider digitalocean', String(plans.provider).includes('digitalocean'), plans.provider)
    for (const slug of ['standard', 'pro', 'power']) {
      for (const m of [1, 2, 3]) {
        const p = (plans.plans || []).find(x => x.plan_id === `${slug}-${m}m`)
        ok(`/rdp/plans ${slug}-${m}m → $${EXPECT[slug][m]} disc ${DISC[m]}% dur ${m}`,
          p && p.price_usd === EXPECT[slug][m] && p.discount_pct === DISC[m] && p.duration_months === m, JSON.stringify(p))
        ok(`/rdp/plans ${slug}-${m}m carries cpu+storage_type`, p && p.cpu === 'AMD' && p.storage_type === 'NVMe SSD', p && `${p.cpu}/${p.storage_type}`)
      }
    }

    const pricing = (await axios.get(`${base}/pricing?region=US`, H)).data
    const pr3 = ((pricing.rdp && pricing.rdp.plans) || []).find(p => p.plan_id === 'power-3m')
    ok('GET /pricing rdp power-3m → $571.2 disc 15%', pr3 && pr3.price_usd === 571.2 && pr3.discount_pct === 15, JSON.stringify(pr3))

    // POST /rdp/:id/renew — dry_run returns the exact billable price (no charge on sandbox).
    for (const m of [1, 2, 3]) {
      const r = (await axios.post(`${base}/rdp/ckmath-rdp-1/renew`, { months: m }, H)).data
      ok(`POST /rdp/:id/renew {months:${m}} → price_usd $${EXPECT.standard[m]} (dry_run)`,
        r && r.mode === 'dry_run' && r.price_usd === EXPECT.standard[m], JSON.stringify(r))
    }
    // months clamps to 1..3
    const rClamp = (await axios.post(`${base}/rdp/ckmath-rdp-1/renew`, { months: 9 }, H)).data
    ok('renew months clamps 9 → 3mo price $142.8', rClamp && rClamp.price_usd === EXPECT.standard[3], JSON.stringify(rClamp))
    const rFloor = (await axios.post(`${base}/rdp/ckmath-rdp-1/renew`, { months: 0 }, H)).data
    ok('renew months clamps 0 → 1mo price $56', rFloor && rFloor.price_usd === EXPECT.standard[1], JSON.stringify(rFloor))

    // Insufficient-balance guard: drop wallet below the 3-month price → order refused, not charged.
    await db.collection('walletOf').updateOne({ _id: OWNER }, { $set: { usdIn: 50, usdOut: 0 } })
    let refused = null
    try { await axios.post(`${base}/rdp/ckmath-rdp-1/renew`, { months: 3 }, H) } catch (e) { refused = e.response }
    ok('renew refused when wallet < price (402 insufficient_wallet_balance)',
      refused && refused.status === 402 && refused.data.error === 'insufficient_wallet_balance', refused && JSON.stringify(refused.data))
  } catch (e) {
    fail++; console.log('  ❌ endpoint exception:', e.response ? JSON.stringify(e.response.data) : e.message)
  }

  // cleanup
  await db.collection('resellerApiKeys').deleteOne({ _id: 'test-ckmath-key' })
  await db.collection('walletOf').deleteOne({ _id: OWNER })
  await db.collection('vpsPlansOf').deleteOne({ _id: 'ckmath-rdp-1' })
  await new Promise(r => server.close(r)); await client.close()

  console.log(`\n${fail === 0 ? '✅' : '❌'} RDP checkout-math suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(1) })
