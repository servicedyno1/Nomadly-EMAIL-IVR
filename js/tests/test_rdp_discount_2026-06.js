// RDP multi-month bundle DISCOUNT visibility — regression.
// Verifies the 2mo/−10% & 3mo/−15% discount is (a) applied in pricing, (b) surfaced as
// discount_pct on the reseller GET /rdp/plans + GET /pricing endpoints (mounted in-process
// with the digitalocean-rdp provider — does NOT touch the running bot), and (c) shown as a
// localized "Save X%" label on the bot duration buttons (all 4 locales).
//   node js/tests/test_rdp_discount_2026-06.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp' // resolve RDP provider to DO in THIS process only
const crypto = require('crypto')
const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const { createResellerApi } = require('../reseller-api')
const svc = require('../digitalocean-rdp-service.js')

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`) } }
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

;(async () => {
  // ---- A. pricing metadata ----
  console.log('\n── A: pricing carries discountPct ──')
  const std = svc.listProducts('US', true).filter(p => p.slug === 'standard')
  const by = Object.fromEntries(std.map(p => [p.durationMonths, p]))
  ok('1mo price 56, discountPct 0', by[1].pricing.totalWithMarkup === 56 && by[1].pricing.discountPct === 0)
  ok('2mo price 100.8, discountPct 10', by[2].pricing.totalWithMarkup === 100.8 && by[2].pricing.discountPct === 10)
  ok('3mo price 142.8, discountPct 15', by[3].pricing.totalWithMarkup === 142.8 && by[3].pricing.discountPct === 15)

  // ---- B. reseller endpoints expose discount_pct ----
  console.log('\n── B: reseller API surfaces discount_pct (digitalocean-rdp provider) ──')
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  const RAW = 'test-discount-raw-key'
  await db.collection('resellerApiKeys').updateOne({ _id: 'test-discount-key' },
    { $set: { _id: 'test-discount-key', keyHash: sha256(RAW), ownerChatId: '999', enabled: true, scopes: ['*'] } }, { upsert: true })

  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }))
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const H = { headers: { 'X-API-Key': RAW } }

  try {
    const plans = (await axios.get(`${base}/rdp/plans?region=US`, H)).data
    const p2 = (plans.plans || []).find(p => p.plan_id === 'standard-2m')
    const p3 = (plans.plans || []).find(p => p.plan_id === 'standard-3m')
    ok('GET /rdp/plans provider is digitalocean', String(plans.provider).includes('digitalocean'), plans.provider)
    ok('GET /rdp/plans standard-2m discount_pct=10 price=100.8', p2 && p2.discount_pct === 10 && p2.price_usd === 100.8 && p2.duration_months === 2, JSON.stringify(p2))
    ok('GET /rdp/plans standard-3m discount_pct=15 price=142.8', p3 && p3.discount_pct === 15 && p3.price_usd === 142.8 && p3.duration_months === 3, JSON.stringify(p3))

    const pricing = (await axios.get(`${base}/pricing?region=US`, H)).data
    const r2 = ((pricing.rdp && pricing.rdp.plans) || []).find(p => p.plan_id === 'standard-2m')
    ok('GET /pricing rdp standard-2m discount_pct=10', r2 && r2.discount_pct === 10, JSON.stringify(r2))
  } catch (e) { fail++; console.log('  ❌ endpoint exception:', e.response ? JSON.stringify(e.response.data) : e.message) }

  // ---- C. bot duration buttons show localized "Save X%" ----
  console.log('\n── C: bot duration buttons show localized Save X% ──')
  const cycles = std.sort((a, b) => a.durationMonths - b.durationMonths).map(p => ({ type: p.durationMonths === 1 ? 'Monthly' : `${p.durationMonths} Months`, price: p.pricing.totalWithMarkup, period: p.durationMonths, productId: p.productId, discountPct: p.pricing.discountPct || 0 }))
  const expect = { en: /Save 10%/, fr: /Économisez 10%/, zh: /省 10%/, hi: /10% बचत/ }
  for (const lng of ['en', 'fr', 'zh', 'hi']) {
    const vp = require(`../lang/${lng}.js`)[lng].vp
    const b1 = vp.rdpDurationBtn(cycles[0]), b2 = vp.rdpDurationBtn(cycles[1]), b3 = vp.rdpDurationBtn(cycles[2])
    ok(`${lng}: 2mo button has localized save label + price`, expect[lng].test(b2) && b2.includes('100.8'), b2)
    ok(`${lng}: 3mo button labelled, 1mo button not`, /15/.test(b3) && !/%/.test(b1), `b1="${b1}" b3="${b3}"`)
  }

  await db.collection('resellerApiKeys').deleteOne({ _id: 'test-discount-key' })
  await new Promise(r => server.close(r)); await client.close()
  console.log(`\n${fail === 0 ? '✅' : '❌'} RDP discount suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(1) })
