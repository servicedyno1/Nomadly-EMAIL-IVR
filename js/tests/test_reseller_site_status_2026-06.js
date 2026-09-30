/**
 * Route-level test for the Reseller API unified site online/offline endpoints:
 *   GET  /reseller/v1/hosting/:user/site-status
 *   POST /reseller/v1/hosting/:user/site-status  { action, mode }
 *
 * Adds Maintenance mode on top of the existing suspend/unsuspend, plus a
 * unified GET status. site-status-service is stubbed (no live WHM); a real
 * isolated local MongoDB is used for the resellerApiKeys + cpanelAccounts seed.
 */

const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')

// Force live mode so the POST branch actually runs (default pod is dry-run).
process.env.RESELLER_API_LIVE = 'true'
process.env.SKIP_WEBHOOK_SYNC = 'false'
process.env.WHM_HOST = 'whm.test.local'

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const TEST_DB = 'reseller_site_status_test'
const API_KEY = 'test-reseller-key'
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

// ── Stub site-status-service (no live WHM) ─────────────────────────────
const ssPath = require.resolve(path.resolve(__dirname, '../site-status-service.js'))
const ssCalls = []
require.cache[ssPath] = {
  id: ssPath, filename: ssPath, loaded: true,
  exports: {
    readStatus: (a) => (a?.suspended ? 'suspended' : (a?.maintenanceMode ? 'maintenance' : 'online')),
    suspend: async () => { ssCalls.push('suspend'); return { ok: true } },
    unsuspend: async () => { ssCalls.push('unsuspend'); return { ok: true } },
    enableMaintenanceMode: async () => { ssCalls.push('enableMaintenance'); return { ok: true } },
    disableMaintenanceMode: async () => { ssCalls.push('disableMaintenance'); return { ok: true } },
  },
}

const { createResellerApi } = require(path.resolve(__dirname, '../reseller-api.js'))

let pass = 0, fail = 0
async function t(name, fn) { try { await fn(); pass++; console.log(`  ✅ ${name}`) } catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`) } }

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(TEST_DB)
  await db.collection('resellerApiKeys').deleteMany({})
  await db.collection('cpanelAccounts').deleteMany({})
  await db.collection('resellerApiKeys').insertOne({ _id: 'k1', keyHash: sha256(API_KEY), enabled: true, ownerChatId: '777', label: 'test' })
  await db.collection('cpanelAccounts').insertOne({
    _id: 'reslr1', cpUser: 'reslr1', domain: 'reseller-site.com', chatId: '777',
    plan: 'Premium Anti-Red (Monthly)', suspended: false, maintenanceMode: false, deleted: false,
  })

  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const port = server.address().port

  function req(method, url, body, withKey = true) {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' }
      if (withKey) headers.Authorization = `Bearer ${API_KEY}`
      const r = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, (res) => {
        let d = ''; res.on('data', c => d += c)
        res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }) } catch { resolve({ status: res.statusCode, body: d }) } })
      })
      r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end()
    })
  }
  const acct = () => db.collection('cpanelAccounts').findOne({ _id: 'reslr1' })

  console.log('\n[Reseller API — /hosting/:user/site-status]')

  await t('GET site-status → online', async () => {
    const r = await req('GET', '/reseller/v1/hosting/reslr1/site-status')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'online')
    assert.strictEqual(r.body.domain, 'reseller-site.com')
  })

  await t('GET unknown user → 404', async () => {
    const r = await req('GET', '/reseller/v1/hosting/nope/site-status')
    assert.strictEqual(r.status, 404)
  })

  await t('POST no api key → 401', async () => {
    const r = await req('GET', '/reseller/v1/hosting/reslr1/site-status', null, false)
    assert.strictEqual(r.status, 401)
  })

  await t('POST bad action → 400', async () => {
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'boom' })
    assert.strictEqual(r.status, 400)
  })

  await t('POST take_offline without mode → 400', async () => {
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'take_offline' })
    assert.strictEqual(r.status, 400)
  })

  await t('POST take_offline mode=maintenance → 200 (maintenance enabled + DB updated)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'take_offline', mode: 'maintenance' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'maintenance')
    assert.strictEqual(r.body.mode, 'live')
    assert.ok(ssCalls.includes('enableMaintenance'), 'enableMaintenanceMode must be called')
    assert.strictEqual((await acct()).maintenanceMode, true)
  })

  await t('POST take_offline again → 409 already_maintenance', async () => {
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'take_offline', mode: 'maintenance' })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.error, 'already_maintenance')
  })

  await t('GET now reports maintenance', async () => {
    const r = await req('GET', '/reseller/v1/hosting/reslr1/site-status')
    assert.strictEqual(r.body.status, 'maintenance')
  })

  await t('POST bring_online (from maintenance) → 200 online', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'online')
    assert.ok(ssCalls.includes('disableMaintenance'), 'disableMaintenanceMode must be called')
    const a = await acct()
    assert.strictEqual(a.maintenanceMode, false)
    assert.ok(a.lastBroughtOnlineAt)
  })

  await t('POST take_offline mode=suspended → 200 suspended', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'take_offline', mode: 'suspended' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'suspended')
    assert.ok(ssCalls.includes('suspend'))
    assert.strictEqual((await acct()).suspended, true)
  })

  await t('POST bring_online (from suspended) → 200 online (unsuspend)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 200)
    assert.ok(ssCalls.includes('unsuspend'))
    assert.strictEqual((await acct()).suspended, false)
  })

  await t('POST bring_online when already online → 409', async () => {
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.error, 'already_online')
  })

  // Dry-run safety: when NOT live, POST must not touch WHM or the DB.
  await t('dry-run mode → 200 dry_run, no WHM call, no DB change', async () => {
    process.env.SKIP_WEBHOOK_SYNC = 'true' // isLive() now false
    ssCalls.length = 0
    const r = await req('POST', '/reseller/v1/hosting/reslr1/site-status', { action: 'take_offline', mode: 'suspended' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.mode, 'dry_run')
    assert.strictEqual(ssCalls.length, 0, 'no WHM/site-status call in dry-run')
    assert.strictEqual((await acct()).suspended, false, 'DB unchanged in dry-run')
    process.env.SKIP_WEBHOOK_SYNC = 'false'
  })

  server.close()
  await db.dropDatabase()
  await client.close()

  console.log(`\n──────────────────────────────`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
