/* global process */
// Route-level test for the customer HostPanel "visitors since linked" endpoint
//   GET /panel/visitors[?domain=<planDomain>]  (cpanel-routes.js)
// Covers: main domain total, per-ADDON-domain total (multi-site), plan_domains list,
// domain_not_associated 404, and no-auth 401.
// Auth mocked via a real JWT (cpanel-auth); cf-service patched (no real Cloudflare);
// hostingVisits history stored in LOCAL Mongo (never the production reseller DB).
require('dotenv').config({ path: '/app/backend/.env' })
const path = require('path')
const assert = require('assert')
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-panel-visitors'

const cpAuth = require(path.resolve(__dirname, '../cpanel-auth.js'))
const cf = require(path.resolve(__dirname, '../cf-service.js'))
const hv = require(path.resolve(__dirname, '../hosting-visits.js'))
const { createCpanelRoutes } = require(path.resolve(__dirname, '../cpanel-routes.js'))

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const USER = 'pvuser'
const DOMAIN = 'pv-site.com'
const ADDON = 'pv-addon.com'
const ZONE = 'zone-pv-main'
const ZONE_ADDON = 'zone-pv-addon'

const enc = cpAuth.encrypt('pw-hash')
const linkedAt = new Date('2026-09-10T00:00:00Z')
const account = {
  _id: USER, cpUser: USER, domain: DOMAIN, chatId: '98765', plan: 'Golden Anti-Red HostPanel (1-Month)',
  whmHost: null, cpPass_encrypted: enc.encrypted, cpPass_iv: enc.iv, cpPass_tag: enc.tag,
  createdAt: linkedAt, addonDomains: [ADDON],
}
const fakeCol = { findOne: async () => ({ ...account }) }

function req(port, token, url) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: url, method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }) } catch { resolve({ status: res.statusCode, body: d }) } })
    })
    r.on('error', reject); r.end()
  })
}

let pass = 0, fail = 0
async function t(name, fn) { try { await fn(); pass++; console.log(`  PASS — ${name}`) } catch (e) { fail++; console.log(`  FAIL — ${name}\n     ${e.message}`) } }

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: { $in: [ZONE, ZONE_ADDON] } })
  // lifetime history (older than CF retention) for each zone
  await hv.storeDays(db, { zoneId: ZONE, domain: DOMAIN, chatId: '98765' }, [
    { date: '2026-09-10', uniques: 200, pageViews: 90, requests: 800 },
    { date: '2026-09-11', uniques: 150, pageViews: 70, requests: 600 },
  ])
  await hv.storeDays(db, { zoneId: ZONE_ADDON, domain: ADDON, chatId: '98765' }, [
    { date: '2026-09-10', uniques: 11, pageViews: 5, requests: 40 },
    { date: '2026-09-11', uniques: 9, pageViews: 3, requests: 30 },
  ])

  const origByName = cf.getZoneByName
  const origRange = cf.getZoneVisitsRange
  cf.getZoneByName = async (name) => (String(name).toLowerCase() === ADDON ? { id: ZONE_ADDON, name: ADDON } : { id: ZONE, name: DOMAIN })
  cf.getZoneVisitsRange = async (zoneId) => ({ success: true, days: [{ date: hv.dayStr(Date.now()),
    uniques: zoneId === ZONE_ADDON ? 5 : 50, pageViews: 2, requests: 15 }] })

  const app = express(); app.use(express.json())
  app.use('/panel', createCpanelRoutes(() => fakeCol, { notifyAdmin: () => {}, getDb: () => db }))
  const server = app.listen(0); const port = server.address().port
  const token = cpAuth.createToken({ cpUser: USER, domain: DOMAIN, chatId: '98765' })

  await t('GET /panel/visitors (main) → 200, total 200+150+50=400', async () => {
    const r = await req(port, token, '/panel/visitors')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.success, true)
    assert.strictEqual(r.body.domain, DOMAIN)
    assert.strictEqual(r.body.is_main, true)
    assert.strictEqual(r.body.total_visitors, 400)
  })

  await t('plan_domains lists main + addon', async () => {
    const r = await req(port, token, '/panel/visitors')
    assert.deepStrictEqual(r.body.plan_domains, [DOMAIN, ADDON])
  })

  await t('GET ?domain=addon → 200, is_main false, total 11+9+5=25', async () => {
    const r = await req(port, token, `/panel/visitors?domain=${ADDON}`)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.domain, ADDON)
    assert.strictEqual(r.body.is_main, false)
    assert.strictEqual(r.body.total_visitors, 25)
  })

  await t('main + addon totals are independent (different numbers)', async () => {
    const m = await req(port, token, '/panel/visitors')
    const a = await req(port, token, `/panel/visitors?domain=${ADDON}`)
    assert.ok(m.body.total_visitors !== a.body.total_visitors)
  })

  await t('unknown domain → 404 domain_not_associated (+ plan_domains)', async () => {
    const r = await req(port, token, '/panel/visitors?domain=not-mine.com')
    assert.strictEqual(r.status, 404)
    assert.strictEqual(r.body.error, 'domain_not_associated')
    assert.deepStrictEqual(r.body.plan_domains, [DOMAIN, ADDON])
  })

  await t('no token → 401', async () => {
    const r = await req(port, null, '/panel/visitors')
    assert.strictEqual(r.status, 401)
  })

  server.close()
  cf.getZoneByName = origByName
  cf.getZoneVisitsRange = origRange
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: { $in: [ZONE, ZONE_ADDON] } })
  await client.close()

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('Fatal:', e); process.exit(1) })
