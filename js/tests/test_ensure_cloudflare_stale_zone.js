/**
 * tests/test_ensure_cloudflare_stale_zone.js
 * ensureCloudflare must not trust a cfZoneId that no longer exists in our CF account (2026-10-01).
 */
const Module = require('module')
const calls = []
let zoneExists = false
let zoneByName = null
let createZoneCalls = 0
const origRequire = Module.prototype.require
Module.prototype.require = function (req) {
  if (/cf-service(\.js)?$/.test(req)) {
    return {
      zoneExistsInAccount: async (id) => { calls.push(['exists', id]); return zoneExists },
      getZoneByName: async (name) => { calls.push(['byName', name]); return zoneByName },
      createZone: async (name) => { createZoneCalls++; return { success: true, zoneId: 'newzone', nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] } },
      listDNSRecords: async () => [],
      createDNSRecord: async () => ({ success: true }),
      getZoneName: async () => null,
    }
  }
  if (/op-service(\.js)?$/.test(req)) return { updateNameservers: async () => ({ success: true }), getDomainInfo: async () => ({}) }
  return origRequire.apply(this, arguments)
}
process.env.API_KEY_CONNECT_RESELLER = process.env.API_KEY_CONNECT_RESELLER || 'x'

const ds = require('../domain-service.js')

const docs = { registeredDomains: { _id: 'accesslog45security.com', val: { cfZoneId: 'stale911', chatId: '840923854', nameserverType: 'cloudflare', nameservers: ['peter.ns.cloudflare.com', 'rachel.ns.cloudflare.com'], registrar: 'OpenProvider', provider: 'OpenProvider' } } }
const updates = []
const db = {
  collection: (name) => ({
    findOne: async (q) => (name === 'registeredDomains' && (q._id === 'accesslog45security.com' || q.domain === 'accesslog45security.com')) ? docs.registeredDomains : null,
    updateOne: async (f, u) => { updates.push([name, JSON.stringify(u)]); return { matchedCount: 1 } },
    find: () => ({ toArray: async () => [] }),
  }),
}

;(async () => {
  let allOk = true
  // 1. zone still ours → trusted, no DB writes
  zoneExists = 'accesslog45security.com'
  const r1 = await ds.ensureCloudflare('accesslog45security.com', db)
  const ok1 = r1.success && r1.alreadyActive && r1.cfZoneId === 'stale911' && updates.length === 0
  console.log('TEST 1 — live zone trusted:', JSON.stringify(r1), ok1 ? '✅' : '❌'); if (!ok1) allOk = false

  // 2. transient/unknown → still trusted (no destructive action)
  zoneExists = null
  const r2 = await ds.ensureCloudflare('accesslog45security.com', db)
  const ok2 = r2.success && r2.alreadyActive && updates.length === 0
  console.log('TEST 2 — unknown → trusted:', ok2 ? '✅' : '❌'); if (!ok2) allOk = false

  // 3. definitively gone, same-name zone exists in account → relink
  zoneExists = false
  zoneByName = { id: 'relinked42', name_servers: ['x.ns.cloudflare.com', 'y.ns.cloudflare.com'] }
  const r3 = await ds.ensureCloudflare('accesslog45security.com', db)
  const ok3 = r3.success && r3.relinked && r3.cfZoneId === 'relinked42' && updates.some(([c, u]) => c === 'registeredDomains' && u.includes('relinked42'))
  console.log('TEST 3 — stale → relinked:', JSON.stringify(r3), ok3 ? '✅' : '❌'); if (!ok3) allOk = false

  // 4. definitively gone, no zone → clear id + create new zone
  updates.length = 0; zoneByName = null
  const r4 = await ds.ensureCloudflare('accesslog45security.com', db)
  const cleared = updates.some(([c, u]) => c === 'registeredDomains' && u.includes('$unset') && u.includes('cfZoneId'))
  const ok4 = r4.success && r4.alreadyActive === false && r4.cfZoneId === 'newzone' && cleared && createZoneCalls === 1
  console.log('TEST 4 — stale → cleared + recreated:', JSON.stringify(r4).slice(0, 160), 'cleared=' + cleared, ok4 ? '✅' : '❌'); if (!ok4) allOk = false

  console.log('\n══ FINAL: ' + (allOk ? '✅ ALL TESTS PASS' : '❌ SOMETHING FAILED'))
  process.exit(allOk ? 0 : 1)
})().catch(e => { console.error('ERR', e); process.exit(1) })
