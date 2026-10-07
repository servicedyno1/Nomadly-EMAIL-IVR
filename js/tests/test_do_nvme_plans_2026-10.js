/* eslint-disable no-console */
// DigitalOcean NVMe (Premium AMD/Intel) plans + live stock filtering — catalog, bot helpers, reseller API.
// Run: node js/tests/test_do_nvme_plans_2026-10.js
// SAFE: no DO calls (NODE_ENV=test disables the hourly refresh; stock comes from a fixture),
// throw-away local DB, reseller API in dry-run mode (nothing is provisioned or charged).
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.NODE_ENV = 'test'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.VPS_MARKUP_PERCENT = '200'
process.env.RESELLER_API_LIVE = 'false'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const d = require('../digitalocean-service')
const en = require('../lang/en')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}

// Live-like stock: Regular sizes not in nyc1/nyc3/sfo3, Intel not in nyc1/nyc3, AMD everywhere.
const ALL = ['fra1', 'nyc3', 'nyc1', 'sfo3', 'lon1', 'sgp1', 'syd1', 'blr1']
const fixture = [
  ...d.PRODUCT_CATALOG.map((p) => ({ slug: p.productId, available: true, price_monthly: p.basePriceUsd, regions: ['fra1', 'lon1', 'sgp1', 'syd1', 'blr1'] })),
  ...d.PRODUCT_CATALOG_NVME.map((p) => ({ slug: p.productId, available: true, price_monthly: p.basePriceUsd, regions: p.cpuVendor === 'AMD' ? ALL : ALL.filter((r) => !['nyc1', 'nyc3'].includes(r)) })),
]

;(async () => {
  console.log('catalog')
  await t('24 NVMe plans (9 AMD + 15 Intel), priced at DO × 3, tiers in price order', () => {
    const n = d.PRODUCT_CATALOG_NVME
    assert.strictEqual(n.length, 24)
    assert.strictEqual(n.filter((p) => p.cpuVendor === 'AMD').length, 9)
    assert.strictEqual(n.filter((p) => p.cpuVendor === 'Intel').length, 15)
    assert.ok(n.every((p) => p.diskType === 'nvme' && p.do_size_slug === p.productId && /-(amd|intel)$/.test(p.productId)))
    assert.deepStrictEqual(n.map((p) => p.tier), n.map((_, i) => i + 1))
    for (let i = 1; i < n.length; i++) assert.ok(n[i].basePriceUsd >= n[i - 1].basePriceUsd, n[i].productId)
    assert.strictEqual(d.calculatePrice(d.getProduct('s-1vcpu-1gb-amd'), 'EU').totalWithMarkup, 21)
    assert.strictEqual(d.calculatePrice(d.getProduct('s-8vcpu-32gb-640gb-intel'), 'EU').totalWithMarkup, 576)
    assert.strictEqual(d.getProduct('s-2vcpu-4gb-120gb-intel').name, 'NVMe Intel 2vCPU/4GB/120GB')
    assert.strictEqual(d.PRODUCT_CATALOG.length, 6) // regular SSD catalog unchanged
    assert.strictEqual(d.isNVMeProduct('s-2vcpu-4gb-amd'), true)
    assert.strictEqual(d.isNVMeProduct('s-2vcpu-4gb'), false)
  })
  await t('before the first stock fetch everything is listed (no outage-induced empty catalog)', () => {
    assert.strictEqual(d.listProducts('US-east').length, 30)
    assert.strictEqual(d.isProductAvailable('s-1vcpu-1gb', 'US-east'), true)
  })

  d._applySizes(fixture)
  console.log('live stock filter')
  await t('EU: 6 SSD + 24 NVMe; storage preference filters', () => {
    assert.strictEqual(d.listProducts('EU', false, 'ssd').length, 6)
    assert.strictEqual(d.listProducts('EU', false, 'nvme').length, 24)
    assert.strictEqual(d.listProducts('EU').length, 30)
    assert.deepStrictEqual(d.listProducts('EU', true), []) // no Windows on DO Linux
  })
  await t('US-east / US-central: no SSD, AMD-only NVMe; US-west: no SSD, all NVMe', () => {
    for (const r of ['US-east', 'US-central']) {
      assert.strictEqual(d.listProducts(r, false, 'ssd').length, 0, r)
      const n = d.listProducts(r, false, 'nvme')
      assert.strictEqual(n.length, 9, r)
      assert.ok(n.every((p) => p.cpuVendor === 'AMD'), r)
    }
    assert.strictEqual(d.listProducts('US-west', false, 'ssd').length, 0)
    assert.strictEqual(d.listProducts('US-west', false, 'nvme').length, 24)
  })
  await t('unavailable flag at DO hides the size; unknown slug hidden', () => {
    d._applySizes(fixture.map((s) => (s.slug === 's-2vcpu-4gb-amd' ? { ...s, available: false } : s)))
    assert.strictEqual(d.isProductAvailable('s-2vcpu-4gb-amd', 'EU'), false)
    assert.ok(!d.listProducts('EU', false, 'nvme').some((p) => p.productId === 's-2vcpu-4gb-amd'))
    d._applySizes(fixture)
    assert.strictEqual(d.isProductAvailable('nope', 'EU'), false)
  })
  await t('DO region slugs (live records) are accepted for pricing + stock', () => {
    assert.strictEqual(d.calculatePrice(d.getProduct('s-2vcpu-4gb'), 'fra1').totalWithMarkup, 72)
    assert.strictEqual(d.isProductAvailable('s-1vcpu-1gb', 'nyc1'), false)
    assert.strictEqual(d.isProductAvailable('s-1vcpu-1gb-amd', 'nyc1'), true)
    assert.strictEqual(d.listProducts('fra1', false, 'ssd').length, 6)
  })
  await t('disk switch SSD ↔ NVMe picks the same size that is in stock', () => {
    assert.strictEqual(d.diskSwitchTarget(d.getProduct('s-2vcpu-4gb'), 'EU').productId, 's-2vcpu-4gb-amd')
    assert.strictEqual(d.diskSwitchTarget(d.getProduct('s-2vcpu-4gb-amd'), 'EU').productId, 's-2vcpu-4gb')
    assert.strictEqual(d.diskSwitchTarget(d.getProduct('s-2vcpu-4gb-amd'), 'US-east'), null) // no SSD stock there
    assert.strictEqual(d.diskSwitchTarget(d.getProduct('s-2vcpu-4gb-120gb-intel'), 'EU'), null) // no same-disk SSD size
  })

  console.log('bot helpers')
  const vm = require('../vm-instance-setup')
  await t('storage step: EU offers NVMe (pricier) + SSD; US-east auto-picks NVMe', async () => {
    const eu = await vm.fetchAvailableDiskTpes('EU', false)
    assert.deepStrictEqual(eu.map((x) => x.value), ['nvme', 'ssd'])
    assert.strictEqual(eu[0].pricier, true)
    const txt = en.en ? en.en.vp.askVpsDiskType(eu) : null
    if (txt) { assert.match(txt, /NVMe costs more/); assert.doesNotMatch(txt, /cost the same/) }
    const us = await vm.fetchAvailableDiskTpes('US-east', false)
    assert.deepStrictEqual(us.map((x) => x.value), ['nvme'])
  })
  await t('plan list: NVMe choice returns 24 priced plans in EU, SSD 6', async () => {
    const n = await vm.fetchAvailableVPSConfigs('1', { region: 'EU', diskType: 'nvme' })
    assert.strictEqual(n.length, 24)
    assert.strictEqual(n[0].name, 'NVMe AMD 1vCPU/1GB/25GB')
    assert.strictEqual(n[0].monthlyPrice, 21)
    assert.strictEqual(n[0].specs.diskType, 'NVME')
    const s = await vm.fetchAvailableVPSConfigs('1', { region: 'EU', diskType: 'ssd' })
    assert.deepStrictEqual(s.map((x) => x._id), d.PRODUCT_CATALOG.map((p) => p.productId))
  })

  console.log('reseller API')
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_do_nvme_${Date.now()}`)
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const OWNER = '777000778'
  await DB.collection('resellerApiKeys').insertOne({ _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER, label: 'test' })
  await DB.collection('walletOf').insertOne({ _id: OWNER, usdIn: 1000, usdOut: 0 })
  const { createResellerApi } = require('../reseller-api')
  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const api = (method, url, data) => axios({ method, url: base + url, data, headers: { Authorization: `Bearer ${KEY}` }, validateStatus: () => true })

  await t('GET /vps/plans EU → 30 plans, NVMe ones labelled with vendor + NVMe SSD, vcpus filled', async () => {
    const r = await api('get', '/vps/plans?region=EU')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.plans.length, 30)
    const amd = r.data.plans.find((p) => p.plan_id === 's-2vcpu-4gb-amd')
    assert.deepStrictEqual([amd.cpu, amd.storage_type, amd.vcpus, amd.ram_gb, amd.disk_gb, amd.price_usd], ['AMD', 'NVMe SSD', 2, 4, 80, 84])
    const intel = r.data.plans.find((p) => p.plan_id === 's-8vcpu-32gb-640gb-intel')
    assert.deepStrictEqual([intel.cpu, intel.storage_type, intel.price_usd], ['Intel', 'NVMe SSD', 576])
    const ssd = r.data.plans.find((p) => p.plan_id === 's-1vcpu-1gb')
    assert.deepStrictEqual([ssd.cpu, ssd.storage_type, ssd.vcpus, ssd.price_usd], ['Standard', 'SSD', 1, 18])
  })
  await t('?storage=nvme / ssd filters; bad value → 400', async () => {
    let r = await api('get', '/vps/plans?region=EU&storage=nvme')
    assert.strictEqual(r.data.plans.length, 24)
    assert.ok(r.data.plans.every((p) => p.storage_type === 'NVMe SSD'))
    r = await api('get', '/vps/plans?region=EU&storage=SSD')
    assert.strictEqual(r.data.plans.length, 6)
    r = await api('get', '/vps/plans?region=EU&storage=hdd')
    assert.deepStrictEqual([r.status, r.data.error], [400, 'invalid_storage'])
  })
  await t('US-east lists only the 9 in-stock AMD NVMe plans', async () => {
    const r = await api('get', '/vps/plans?region=US-east')
    assert.strictEqual(r.data.plans.length, 9)
    assert.ok(r.data.plans.every((p) => p.cpu === 'AMD'))
  })
  await t('POST /vps with an out-of-stock plan → 409 out_of_stock, wallet untouched', async () => {
    const r = await api('post', '/vps', { plan_id: 's-1vcpu-1gb', region: 'US-east' })
    assert.deepStrictEqual([r.status, r.data.error], [409, 'out_of_stock'], JSON.stringify(r.data))
    const r2 = await api('post', '/vps', { plan_id: 's-2vcpu-4gb-intel', region: 'US-central' })
    assert.deepStrictEqual([r2.status, r2.data.error], [409, 'out_of_stock'])
    const w = await DB.collection('walletOf').findOne({ _id: OWNER })
    assert.strictEqual(w.usdOut || 0, 0)
  })
  await t('POST /vps with an in-stock NVMe plan passes validation (dry-run, nothing provisioned)', async () => {
    const r = await api('post', '/vps', { plan_id: 's-2vcpu-4gb-amd', region: 'US-east' })
    assert.ok([200, 202].includes(r.status), JSON.stringify(r.data))
    assert.notStrictEqual(r.data.error, 'out_of_stock')
    assert.strictEqual(r.data.mode, 'dry_run')
  })
  await t('/pricing includes NVMe plans', async () => {
    const r = await api('get', '/pricing?region=EU')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.data.vps.plans.filter((p) => p.storage_type === 'NVMe SSD').length, 24)
  })
  await t('/apidoc documents the storage filter + NVMe example', () => {
    const html = require('../apidoc-page').renderApiDocPage('https://x/api/reseller/v1')
    assert.match(html, /storage=nvme/)
    assert.match(html, /NVMe AMD 2vCPU\/4GB\/80GB/)
    assert.match(html, /out_of_stock/)
  })

  server.close()
  await DB.dropDatabase()
  await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
