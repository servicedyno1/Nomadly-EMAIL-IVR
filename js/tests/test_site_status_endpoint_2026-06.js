/**
 * Route-level test for the hosting "site online / offline" endpoints
 *   GET  /panel/account/site-status         → current status
 *   POST /panel/account/site-status         → take_offline | bring_online
 *
 * These endpoints ALREADY EXIST in cpanel-routes.js (customer HostPanel).
 * This test proves the full online↔offline lifecycle works, with the
 * WHM/cPanel calls stubbed via site-status-service so no live server is needed.
 */

const path = require('path')
const assert = require('assert')
const express = require('express')
const http = require('http')

process.env.WHM_HOST = 'whm.test.local'
process.env.JWT_SECRET = 'test-secret-for-site-status'

// ── Stub site-status-service (no live WHM/cPanel) ──────────────────────
const ssPath = require.resolve(path.resolve(__dirname, '../site-status-service.js'))
const ssCalls = []
const fakeSiteStatus = {
  readStatus: (a) => (a?.suspended ? 'suspended' : (a?.maintenanceMode ? 'maintenance' : 'online')),
  suspend: async () => { ssCalls.push('suspend'); return { ok: true } },
  unsuspend: async () => { ssCalls.push('unsuspend'); return { ok: true } },
  enableMaintenanceMode: async () => { ssCalls.push('enableMaintenance'); return { ok: true } },
  disableMaintenanceMode: async () => { ssCalls.push('disableMaintenance'); return { ok: true } },
}
require.cache[ssPath] = { id: ssPath, filename: ssPath, loaded: true, exports: fakeSiteStatus }

const cpAuth = require(path.resolve(__dirname, '../cpanel-auth.js'))
const { createCpanelRoutes } = require(path.resolve(__dirname, '../cpanel-routes.js'))

// ── Stateful fake cpanelAccounts collection ────────────────────────────
const encPass = cpAuth.encrypt('pw-hash')
const account = {
  _id: 'sitecp', cpUser: 'sitecp', domain: 'mysite.com', chatId: '55555',
  plan: 'Premium Anti-Red (1-Week)', whmHost: null,
  cpPass_encrypted: encPass.encrypted, cpPass_iv: encPass.iv, cpPass_tag: encPass.tag,
  suspended: false, maintenanceMode: false, deleted: false,
}
function applyUpdate(doc, upd) {
  if (upd.$set) for (const [k, v] of Object.entries(upd.$set)) doc[k] = v
  if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete doc[k]
}
const fakeCol = {
  findOne: async () => ({ ...account }),   // snapshot each read
  updateOne: async (_q, upd) => { applyUpdate(account, upd); return { modifiedCount: 1 } },
}

const token = cpAuth.createToken({ cpUser: 'sitecp', domain: 'mysite.com', chatId: '55555' })

const app = express()
app.use(express.json())
app.use('/panel', createCpanelRoutes(() => fakeCol, { notifyAdmin: () => {} }))
const server = app.listen(0)
const port = server.address().port

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port, path: url, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }) } catch { resolve({ status: res.statusCode, body: d }) } })
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

let pass = 0, fail = 0
async function t(name, fn) { try { await fn(); pass++; console.log(`  ✅ ${name}`) } catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`) } }

(async () => {
  console.log('\n[Site online/offline endpoint — /panel/account/site-status]')

  await t('GET returns online initially', async () => {
    const r = await req('GET', '/panel/account/site-status')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'online')
    assert.strictEqual(r.body.domain, 'mysite.com')
  })

  await t('POST unknown action → 400', async () => {
    const r = await req('POST', '/panel/account/site-status', { action: 'nuke' })
    assert.strictEqual(r.status, 400)
  })

  await t('POST take_offline without mode → 400', async () => {
    const r = await req('POST', '/panel/account/site-status', { action: 'take_offline' })
    assert.strictEqual(r.status, 400)
  })

  await t('POST take_offline mode=suspended → 200 suspended (WHM suspend called)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/panel/account/site-status', { action: 'take_offline', mode: 'suspended' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'suspended')
    assert.ok(ssCalls.includes('suspend'), 'suspend() must be called')
    assert.strictEqual(account.suspended, true)
  })

  await t('POST take_offline again → 409 already offline', async () => {
    const r = await req('POST', '/panel/account/site-status', { action: 'take_offline', mode: 'suspended' })
    assert.strictEqual(r.status, 409)
  })

  await t('GET now reports suspended', async () => {
    const r = await req('GET', '/panel/account/site-status')
    assert.strictEqual(r.body.status, 'suspended')
  })

  await t('POST bring_online → 200 online (WHM unsuspend called, lastBroughtOnlineAt set)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/panel/account/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'online')
    assert.ok(ssCalls.includes('unsuspend'), 'unsuspend() must be called')
    assert.strictEqual(account.suspended, false)
    assert.ok(account.lastBroughtOnlineAt, 'lastBroughtOnlineAt must be stamped')
  })

  await t('POST bring_online again → 409 already online', async () => {
    const r = await req('POST', '/panel/account/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 409)
  })

  await t('POST take_offline mode=maintenance → 200 maintenance (maintenance enabled)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/panel/account/site-status', { action: 'take_offline', mode: 'maintenance' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'maintenance')
    assert.ok(ssCalls.includes('enableMaintenance'), 'enableMaintenanceMode() must be called')
    assert.strictEqual(account.maintenanceMode, true)
  })

  await t('POST bring_online (from maintenance) → 200 online (maintenance disabled)', async () => {
    ssCalls.length = 0
    const r = await req('POST', '/panel/account/site-status', { action: 'bring_online' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 'online')
    assert.ok(ssCalls.includes('disableMaintenance'), 'disableMaintenanceMode() must be called')
    assert.strictEqual(account.maintenanceMode, false)
  })

  await t('cancelled (deleted) plan → 409', async () => {
    account.deleted = true
    const r = await req('POST', '/panel/account/site-status', { action: 'take_offline', mode: 'suspended' })
    assert.strictEqual(r.status, 409)
    account.deleted = false
  })

  await t('no auth token → 401', async () => {
    const r = await new Promise((resolve, reject) => {
      const rr = http.request({ hostname: '127.0.0.1', port, path: '/panel/account/site-status', method: 'GET' },
        (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode })) })
      rr.on('error', reject); rr.end()
    })
    assert.strictEqual(r.status, 401)
  })

  server.close()
  console.log(`\n──────────────────────────────`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('Fatal:', e); server.close(); process.exit(1) })
