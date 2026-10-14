// Extra edge-case checks for js/do-stock-watch.js (T1 testing agent, 2026-01).
//   node js/tests/test_do_stock_watch_edge_2026-01.js
// Covers: confirmMs=0 immediate alerts, HTML escaping, empty change lists,
// _scheduleRecheck single-timer semantics.
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.DIGITALOCEAN_API_TOKEN = ''
const { MongoClient } = require('mongodb')
const sizeCatalog = require('../do-size-catalog')
const watch = require('../do-stock-watch')

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }

const REGIONS = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['sfo3', 'San Francisco 3'], ['fra1', 'Frankfurt 1']].map(([slug, name]) => ({ slug, name, available: true }))
const vpsSvc = require('../digitalocean-service')
const ALL_PRODUCTS = [...vpsSvc.PRODUCT_CATALOG_SSD, ...vpsSvc.PRODUCT_CATALOG_NVME]
const S = (slug, vcpus, gb, disk, price, regions, desc) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description: desc, available: true, regions })
const sizeOf = (p, rs) => S(p.productId, p.cpuCores, p.ramMb / 1024, p.diskMb / 1024, p.basePriceUsd, rs, /-intel$/.test(p.productId) ? 'Premium Intel' : 'Basic AMD')
const AMD = (rs) => ALL_PRODUCTS.filter(p => !/-intel$/.test(p.productId)).map(p => sizeOf(p, rs))
const INTEL = (rs) => ALL_PRODUCTS.filter(p => /-intel$/.test(p.productId)).map(p => sizeOf(p, rs))
const live = (sizes) => sizeCatalog._setForTest(sizes, REGIONS, { source: 'live', fetchedAt: new Date() })

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_stock_edge_${Date.now()}`)
  const col = db.collection('doSizeCatalog')
  try {
    console.log('\n── E1: confirmMs=0 → immediate alerts (no 30 min hold) ──')
    live([...AMD(['nyc1', 'nyc2', 'fra1']), ...INTEL(['nyc2', 'fra1'])])
    const t0 = new Date()
    const r0 = await watch.check({ col, notify: () => {}, now: t0, confirmMs: 0 })
    ok('baseline inserted', r0.baseline === true)
    // Drop Intel in nyc2
    live([...AMD(['nyc1', 'nyc2', 'fra1']), ...INTEL(['fra1'])])
    let alerts = []
    const r1 = await watch.check({ col, notify: (m) => alerts.push(m), now: new Date(t0.getTime() + 1000), confirmMs: 0 })
    ok('one check with confirmMs=0 fires alert immediately', (r1.wentOut || []).length >= 1 && alerts.length === 1, { went: r1.wentOut, alerts })
    ok('message is short Stock change header', /^📦 <b>Stock change<\/b>/.test(alerts[0] || ''), alerts[0])
    ok('no pending left (0 ms hold)', r1.pending === 0, r1.pending)

    console.log('\n── E2: HTML escaping on description/places ──')
    // Craft a changeMessage with keys that have special chars via a monkey-patched REGION_DISPLAY
    const rdpSvc = require('../digitalocean-rdp-service')
    const origRdpDisplay = rdpSvc.REGION_DISPLAY
    rdpSvc.REGION_DISPLAY = Object.assign({}, origRdpDisplay, { evil1: { label: 'Evil (<script>)' } })
    try {
      const m = watch.changeMessage(['rdp|evil1|standard'], [])
      ok('<script> in region label is HTML-escaped', m.includes('&lt;script&gt;') && !/<script>/.test(m), m)
    } finally { rdpSvc.REGION_DISPLAY = origRdpDisplay }

    console.log('\n── E3: empty change lists ──')
    const empty = watch.changeMessage([], [])
    ok('empty lists → only header line', empty === '📦 <b>Stock change</b>', empty)
    const emptyBaseline = watch.baselineMessage({ 'rdp|fra1|pro': true, 'vps|EU|s-1vcpu-1gb-amd': true })
    ok('baseline with everything in stock → null', emptyBaseline === null, emptyBaseline)

    console.log('\n── E4: _scheduleRecheck is a single-flight timer ──')
    watch._resetForTest()
    const a = watch._scheduleRecheck(60000)
    const b = watch._scheduleRecheck(60000)
    ok('first call books the timer, second is a no-op', a === true && b === false, { a, b })
    watch._resetForTest()
    const c = watch._scheduleRecheck(60000)
    ok('after reset the timer can be booked again', c === true, c)
    watch._resetForTest()

    console.log('\n── E5: unknown kind token in key is ignored by _lines (via changeMessage) ──')
    const m2 = watch.changeMessage(['bogus|xx|yy', 'rdp|fra1|pro'], [])
    ok('bogus kind dropped, rdp line still rendered', !m2.includes('bogus') && m2.includes('RDP Frankfurt: Pro'), m2)

    const total = pass + fail
    console.log(`\n${fail === 0 ? '✅' : '❌'} edge-case suite: ${pass} passed / ${fail} failed (of ${total})`)
    process.exitCode = fail === 0 ? 0 : 1
  } catch (e) {
    console.error('FATAL', e)
    process.exitCode = 2
  } finally {
    try { await db.dropDatabase() } catch {}
    await client.close()
  }
})()
