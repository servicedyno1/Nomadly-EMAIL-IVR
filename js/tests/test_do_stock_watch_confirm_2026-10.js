// Admin stock alerts: confirmed changes only + short text (2026-10-14 RCA — DigitalOcean flapping
// Premium Intel stock in New York produced out/back alert pairs every few minutes on all three bots).
// No network: catalogue injected with sizeCatalog._setForTest, isolated local MongoDB DB.
//   node js/tests/test_do_stock_watch_confirm_2026-10.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.DIGITALOCEAN_API_TOKEN = ''
delete process.env.DO_STOCK_CONFIRM_MIN
delete process.env.DO_STOCK_RECHECK_MIN
const { MongoClient } = require('mongodb')
const sizeCatalog = require('../do-size-catalog')
const watch = require('../do-stock-watch')

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }

const REGIONS = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['nyc3', 'New York 3'], ['sfo2', 'San Francisco 2'], ['sfo3', 'San Francisco 3'], ['tor1', 'Toronto 1'], ['lon1', 'London 1'], ['fra1', 'Frankfurt 1'],
  ['ams3', 'Amsterdam 3'], ['blr1', 'Bangalore 1'], ['sgp1', 'Singapore 1'], ['syd1', 'Sydney 1']].map(([slug, name]) => ({ slug, name, available: true }))
const S = (slug, vcpus, gb, disk, price, regions, description) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description, available: true, regions })
const NOT_NY = ['sfo3', 'tor1', 'lon1', 'fra1', 'ams3', 'blr1', 'sgp1', 'syd1']
const vpsSvc = require('../digitalocean-service')
// Every VPS product the bot sells (+ the RDP AMD tiers, same slugs/specs) — AMD/Basic everywhere, Intel per scenario
const ALL_PRODUCTS = [...vpsSvc.PRODUCT_CATALOG_SSD, ...vpsSvc.PRODUCT_CATALOG_NVME]
const sizeOf = (p, rs) => S(p.productId, p.cpuCores, p.ramMb / 1024, p.diskMb / 1024, p.basePriceUsd, rs, /-amd$/.test(p.productId) ? 'Basic AMD' : /-intel$/.test(p.productId) ? 'Premium Intel' : 'Basic')
const AMD = (rs) => ALL_PRODUCTS.filter(p => !/-intel$/.test(p.productId)).map(p => sizeOf(p, rs))
const INTEL = (rs) => ALL_PRODUCTS.filter(p => /-intel$/.test(p.productId)).map(p => sizeOf(p, rs))
const live = (sizes) => sizeCatalog._setForTest(sizes, REGIONS, { source: 'live', fetchedAt: new Date() })
// Production on 2026-10-14: Intel only in nyc2 (New York) → flips US-central + US-east together
const WITH_NY_INTEL = () => [...AMD([...NOT_NY, 'nyc1', 'nyc2']), ...INTEL([...NOT_NY, 'nyc2'])]
const WITHOUT_NY_INTEL = () => [...AMD([...NOT_NY, 'nyc1', 'nyc2']), ...INTEL(NOT_NY)]

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_stock_confirm_${Date.now()}`)
  const col = db.collection('doSizeCatalog')
  try {
    console.log('\n── 1: defaults ──')
    ok('confirm window 30 min, re-check every 5 min while unconfirmed', watch._timing.confirmMs === 30 * 60000 && watch._timing.recheckMs === 5 * 60000, watch._timing)

    console.log('\n── 2: short text ──')
    live(WITHOUT_NY_INTEL())
    const snap = watch.snapshot()
    const flapKeys = Object.keys(snap).filter(k => /^vps\|US-(central|east)\|.*-intel$/.test(k))
    ok('the 2026-10-14 flap = 30 keys (15 Intel sizes × US Central + US East)', flapKeys.length === 30 && flapKeys.every(k => snap[k] === false), flapKeys.length)
    const m1 = watch.changeMessage(flapKeys, [])
    ok('…now ONE line: "🔴 VPS US Central, US East: all Intel" (was 2 long slug lists + footer)', m1 === '📦 <b>Stock change</b>\n🔴 VPS US Central, US East: all Intel', m1)
    const m2 = watch.changeMessage(['rdp|fra1|pro', 'rdp|fra1|power', 'vps|UK|s-2vcpu-4gb-amd'], ['rdp|tor1|standard', 'rdp|tor1|pro', 'rdp|tor1|power', 'rdp|syd1|standard', 'rdp|syd1|pro', 'rdp|syd1|power', 'vps|EU|s-1vcpu-1gb-intel', 'vps|EU|s-2vcpu-4gb-intel', 'vps|EU|s-4vcpu-8gb-intel'])
    ok('mixed: out first, RDP before VPS, same change shares a line, plan names / counts', m2 === ['📦 <b>Stock change</b>', '🔴 RDP Frankfurt: Pro, Power', '🔴 VPS United Kingdom: AMD 2vcpu-4gb', '🟢 RDP Toronto, Sydney: all plans', '🟢 VPS Europe: 3 Intel'].join('\n'), m2)
    ok('no footer / no "orders blocked" boilerplate', !/refreshed every|orders blocked|AMD only/.test(m1 + m2))
    const b = watch.baselineMessage(snap)
    ok('baseline is short too', /^📦 <b>Stock watch on<\/b> — sold out now:\n/.test(b) && /🔴 VPS US Central, US East: all Intel/.test(b) && b.split('\n').length <= 4, b)

    console.log('\n── 3: legacy state doc (written by the old immediate-alert code) ──')
    const t0 = Date.now(), at = (min) => new Date(t0 + min * 60000)
    live(WITH_NY_INTEL())
    const legacy = watch.snapshot()
    const crypto = require('crypto')
    const hash = crypto.createHash('sha1').update(JSON.stringify(Object.keys(legacy).sort().map(k => [k, legacy[k]]))).digest('hex')
    await col.insertOne({ _id: 'stock_state', matrix: legacy, hash, at: at(-60) }) // no rev, no pending
    const sent = [], notify = (m) => sent.push(m)
    let w = await watch.check({ col, notify, now: at(0) })
    ok('same stock → no write, no alert', w.changed === 0 && w.pending === 0 && !sent.length, w)
    live(WITHOUT_NY_INTEL())
    w = await watch.check({ col, notify, now: at(1) })
    let doc = await col.findOne({ _id: 'stock_state' })
    ok('legacy doc upgraded in place: rev 1, 30 pending, confirmed matrix unchanged', doc.rev === 1 && Object.keys(doc.pending).length === 30 && doc.matrix['vps|US-east|s-1vcpu-1gb-intel'] === true && w.pending === 30 && !sent.length, { rev: doc.rev, w })

    console.log('\n── 4: replay of the Nomadly 2026-10-14 sequence (out/back every 2-35 min) ──')
    // pulls every ~2-5 min like a busy bot; flips at the real gaps from the prod log
    const seq = [[1, false], [3, true], [6, false], [8, true], [18, false], [22, true], [26, false], [30, false], [40, false], [50, false]]
    for (const [min, inStock] of seq) { live(inStock ? WITH_NY_INTEL() : WITHOUT_NY_INTEL()); w = await watch.check({ col, notify, now: at(min) }) }
    ok('flips that reversed within 2-10 min → no alerts at all', sent.length === 0, sent)
    live(WITHOUT_NY_INTEL()); w = await watch.check({ col, notify, now: at(55) })
    ok('the only out-state that held 30 min (since min 26) → ONE short alert at min 55 (29 min + slack counts)', sent.length === 1 && sent[0] === m1 && w.wentOut.length === 30, { sent, w })
    w = await watch.check({ col, notify, now: at(60) })
    ok('…not repeated', sent.length === 1 && w.changed === 0 && w.pending === 0)

    console.log('\n── 5: new / retired products ──')
    doc = await col.findOne({ _id: 'stock_state' })
    const m = { ...doc.matrix, 'vps|EU|s-retired': true }
    delete m['vps|EU|s-1vcpu-1gb-intel']
    await col.updateOne({ _id: 'stock_state' }, { $set: { matrix: m } })
    w = await watch.check({ col, notify, now: at(61) })
    doc = await col.findOne({ _id: 'stock_state' })
    ok('a key new in the snapshot is adopted silently, a retired key is dropped silently', sent.length === 1 && w.changed === 0 && !('vps|EU|s-retired' in doc.matrix) && doc.matrix['vps|EU|s-1vcpu-1gb-intel'] === true && w.pending === 0, w)

    console.log('\n── 6: two pods confirm at the same moment → one alert ──')
    live(WITH_NY_INTEL())
    await watch.check({ col, notify, now: at(70) })
    const [a, c] = await Promise.all([watch.check({ col, notify, now: at(101) }), watch.check({ col, notify, now: at(101) })])
    ok('exactly one 🟢 alert', sent.length === 2 && /🟢 VPS US Central, US East: all Intel/.test(sent[1]) && [a, c].filter(x => x.cameBack && x.cameBack.length).length === 1, { sent, a, c })

    console.log('\n── 7: stale / recovery notices are short ──')
    watch._resetForTest()
    ok('no stale notice while the catalogue is fine', watch.staleCheck(notify) === null)
  } catch (e) {
    fail++; console.log('  ❌ suite crashed:', e.stack || e.message)
  } finally {
    watch._resetForTest()
    await db.dropDatabase().catch(() => {})
    await client.close()
  }
  console.log(`\n${fail ? '❌' : '✅'} stock-watch confirm suite: ${pass} passed / ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
