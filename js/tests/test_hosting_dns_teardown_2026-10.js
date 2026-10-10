/* eslint-disable no-console */
// Hosting DNS teardown safety + DNS self-heal (2026-10 namewords.sbs RCA).
// Prod incident: DELETE /hosting/nameb594 (a FAILED duplicate record) ran cleanupAllHostingRecords
// for namewords.sbs and wiped the LIVE account name65fb's tunnel CNAMEs.
// Run: node js/tests/test_hosting_dns_teardown_2026-10.js
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { MongoClient } = require('mongodb')
const axios = require('axios')
const cfService = require('../cf-service')
const antiRed = require('../anti-red-service')
const { teardownHostingDomain } = require('../hosting-dns-teardown')
const repair = require('../hosting-dns-repair')
const pch = require('../plan-change-history')

let passed = 0
let failed = 0
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.stack.split('\n').slice(0, 2).join('\n     ')}`) }
}

// ── Cloudflare stubs (record every mutating call) ──
let calls = []
let zones = {}      // domain -> zoneId
let records = {}    // zoneId -> [{type,name,content}]
let listFails = false
cfService.getZoneByName = async (d) => (zones[d] ? { id: zones[d] } : null)
cfService.cleanupAllHostingRecords = async (zoneId, d) => { calls.push(`cleanup:${d}`); return { success: true, deleted: [] } }
cfService.createDNSRecord = async (zoneId, type, name, content, ttl, proxied) => { calls.push(`create:${type}:${name}:${content}:${proxied}`); (records[zoneId] = records[zoneId] || []).push({ type, name, content }); return { success: true } }
antiRed.removeWorkerRoutes = async (d) => { calls.push(`routes:${d}`); return { success: true } }
axios.get = async (url, opts) => {
  if (listFails) throw new Error('cf 403')
  const zoneId = url.split('/zones/')[1].split('/')[0]
  return { data: { success: true, result: (records[zoneId] || []).filter(r => r.name === opts.params.name) } }
}
process.env.CF_TUNNEL_CNAME = 'tun-1.cfargotunnel.com'
const reset = () => { calls = []; zones = {}; records = {}; listFails = false }

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017')
  const col = mc.db('test').collection('tdtest_cpanelAccounts')
  await col.deleteMany({})
  const seed = (docs) => col.deleteMany({}).then(() => (docs.length ? col.insertMany(docs) : null))

  console.log('\n=== teardownHostingDomain — whole-account delete (excludeId) ===')
  await t('RCA: deleting FAILED nameb594 keeps live name65fb DNS + worker routes (no CF calls)', async () => {
    reset(); zones['namewords.sbs'] = 'z1'
    await seed([
      { _id: 'name65fb', domain: 'namewords.sbs', provisionState: 'active', cpUser: 'name65fb' },
      { _id: 'nameb594', domain: 'namewords.sbs', provisionState: 'failed', provisionFailedReason: 'duplicate_provisioning_prevented' },
    ])
    const r = await teardownHostingDomain({ col, domain: 'namewords.sbs', excludeId: 'nameb594' })
    assert.deepStrictEqual(r, { domain: 'namewords.sbs', skipped: 'in_use', by: 'name65fb' })
    assert.deepStrictEqual(calls, [])
  })
  await t('deleting the LAST live account removes routes + DNS', async () => {
    reset(); zones['solo.com'] = 'z2'
    await seed([{ _id: 'acc1', domain: 'solo.com', provisionState: 'active' }])
    const r = await teardownHostingDomain({ col, domain: 'solo.com', excludeId: 'acc1' })
    assert.ok(r.removed); assert.deepStrictEqual(calls, ['routes:solo.com', 'cleanup:solo.com'])
  })
  await t('other records that are failed / deleted / terminatedOnWhm do NOT block cleanup', async () => {
    reset(); zones['x.com'] = 'z3'
    await seed([
      { _id: 'me', domain: 'x.com', provisionState: 'active' },
      { _id: 'f1', domain: 'x.com', provisionState: 'failed' },
      { _id: 'd1', domain: 'x.com', deleted: true },
      { _id: 't1', domain: 'x.com', terminatedOnWhm: true },
    ])
    const r = await teardownHostingDomain({ col, domain: 'x.com', excludeId: 'me' })
    assert.ok(r.removed, JSON.stringify(r))
  })
  await t('legacy bot accounts without provisionState count as live', async () => {
    reset(); zones['old.com'] = 'z4'
    await seed([{ _id: 'legacy1', domain: 'old.com' }, { _id: 'dup', domain: 'old.com', provisionState: 'failed' }])
    const r = await teardownHostingDomain({ col, domain: 'old.com', excludeId: 'dup' })
    assert.strictEqual(r.skipped, 'in_use'); assert.deepStrictEqual(calls, [])
  })
  await t('domain used as an ADDON (string or legacy {domain} object) by another live account → kept', async () => {
    reset(); zones['shop.com'] = 'z5'
    await seed([{ _id: 'a', domain: 'main-a.com', addonDomains: ['shop.com'] }, { _id: 'b', domain: 'shop.com' }])
    assert.strictEqual((await teardownHostingDomain({ col, domain: 'shop.com', excludeId: 'b' })).by, 'a')
    await seed([{ _id: 'a', domain: 'main-a.com', addonDomains: [{ domain: 'shop.com', createdAt: new Date() }] }, { _id: 'b', domain: 'shop.com' }])
    assert.strictEqual((await teardownHostingDomain({ col, domain: 'shop.com', excludeId: 'b' })).by, 'a')
    assert.deepStrictEqual(calls, [])
  })
  await t('match is case-insensitive and regex-safe (a.b.com never matches axb.com)', async () => {
    reset(); zones['a.b.com'] = 'z6'
    await seed([{ _id: 'live', domain: 'NameWords.SBS' }, { _id: 'other', domain: 'axb.com' }, { _id: 'me', domain: 'a.b.com' }])
    assert.strictEqual((await teardownHostingDomain({ col, domain: 'namewords.sbs', excludeId: 'x' })).by, 'live')
    assert.ok((await teardownHostingDomain({ col, domain: 'a.b.com', excludeId: 'me' })).removed)
  })

  console.log('\n=== teardownHostingDomain — domain detached from a live account (no excludeId) ===')
  await t('addon already pulled from the owner → removed', async () => {
    reset(); zones['addon.com'] = 'z7'
    await seed([{ _id: 'owner', domain: 'main.com', addonDomains: [] }])
    assert.ok((await teardownHostingDomain({ col, domain: 'addon.com' })).removed)
  })
  await t('owner STILL lists the addon (e.g. cPanel unlink / DB update failed) → kept', async () => {
    reset(); zones['addon.com'] = 'z7'
    await seed([{ _id: 'owner', domain: 'main.com', addonDomains: ['addon.com'] }])
    const r = await teardownHostingDomain({ col, domain: 'addon.com' })
    assert.strictEqual(r.skipped, 'in_use'); assert.deepStrictEqual(calls, [])
  })
  await t('no Cloudflare zone → no_zone, nothing deleted', async () => {
    reset(); await seed([])
    assert.strictEqual((await teardownHostingDomain({ col, domain: 'external.com' })).skipped, 'no_zone')
    assert.deepStrictEqual(calls, [])
  })

  console.log('\n=== hosting-dns-repair ===')
  const live = { _id: 'name65fb', domain: 'namewords.sbs', addonDomains: ['addon1.com', { domain: 'Addon2.com' }], provisionState: 'active' }
  await t('isLiveAccount: failed / deleted / terminated are not live; legacy (no provisionState) is', async () => {
    assert.ok(repair.isLiveAccount(live)); assert.ok(repair.isLiveAccount({ _id: 'l', domain: 'a.com' }))
    assert.ok(!repair.isLiveAccount({ provisionState: 'failed' })); assert.ok(!repair.isLiveAccount({ deleted: true })); assert.ok(!repair.isLiveAccount({ terminatedOnWhm: true }))
  })
  await t('dry run reports missing apex/www (primary + addons incl. legacy object shape), creates nothing', async () => {
    reset(); zones = { 'namewords.sbs': 'z1', 'addon1.com': 'z2', 'addon2.com': 'z3' }
    records.z2 = [{ type: 'A', name: 'addon1.com', content: '1.2.3.4' }, { type: 'CNAME', name: 'www.addon1.com', content: 'x' }]
    records.z3 = [{ type: 'TXT', name: 'addon2.com', content: 'v=spf1' }, { type: 'CNAME', name: 'www.addon2.com', content: 'x' }]
    const r = await repair.repairAccount(live, { apply: false })
    const by = Object.fromEntries(r.domains.map(d => [d.domain, d]))
    assert.deepStrictEqual(by['namewords.sbs'].missing, ['namewords.sbs', 'www.namewords.sbs'])
    assert.strictEqual(by['addon1.com'].status, 'ok')
    assert.deepStrictEqual(by['addon2.com'].missing, ['addon2.com'], 'TXT is not a web record')
    assert.deepStrictEqual(calls, [])
  })
  await t('apply re-creates ONLY the missing names as proxied tunnel CNAMEs; second run is a no-op', async () => {
    reset(); zones = { 'namewords.sbs': 'z1' }
    records.z1 = [{ type: 'A', name: 'go.namewords.sbs', content: '146.190.238.190' }]
    const r = await repair.repairAccount({ _id: 'name65fb', domain: 'namewords.sbs' }, { apply: true })
    assert.strictEqual(r.domains[0].status, 'repaired')
    assert.deepStrictEqual(calls, ['create:CNAME:namewords.sbs:tun-1.cfargotunnel.com:true', 'create:CNAME:www.namewords.sbs:tun-1.cfargotunnel.com:true'])
    calls = []
    const again = await repair.repairAccount({ _id: 'name65fb', domain: 'namewords.sbs' }, { apply: true })
    assert.strictEqual(again.domains[0].status, 'ok'); assert.deepStrictEqual(calls, [])
  })
  await t('a Cloudflare lookup error is reported as error and NEVER treated as missing', async () => {
    reset(); zones = { 'namewords.sbs': 'z1' }; listFails = true
    const r = await repair.repairAccount({ _id: 'u', domain: 'namewords.sbs' }, { apply: true })
    assert.strictEqual(r.domains[0].status, 'error'); assert.deepStrictEqual(calls, [])
  })
  await t('external DNS (no zone) → no_zone, nothing created', async () => {
    reset()
    const r = await repair.repairAccount({ _id: 'u', domain: 'ext.com' }, { apply: true })
    assert.strictEqual(r.domains[0].status, 'no_zone'); assert.deepStrictEqual(calls, [])
  })

  console.log('\n=== plan-change history legacy flag ===')
  await t('history entries without billing (written before 2026-10-10) are legacy:true; new ones legacy:false', async () => {
    const e = pch.hostingEntries({ _id: 'name65fb', domain: 'namewords.sbs', plan: 'Premium Anti-Red (1-Week)', planChangeHistory: [
      { id: 'hpc_old', at: '2026-10-09T00:41:59.926Z', from: 'Golden Anti-Red HostPanel (1-Month)', to: 'Premium Anti-Red (1-Week)', direction: 'downgrade' },
      { id: 'hpc_new', at: '2026-10-10T10:00:00.000Z', from: 'Premium Anti-Red (1-Week)', to: 'Premium Anti-Red HostPanel (30 Days)', direction: 'upgrade', billing: 'new_term', expires_at: '2026-11-09T10:00:00.000Z' },
    ] })
    const by = Object.fromEntries(e.map(x => [x.id, x]))
    assert.strictEqual(by.hpc_old.legacy, true); assert.strictEqual(by.hpc_new.legacy, false)
  })

  console.log('\n=== wiring (static) ===')
  const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8')
  await t('cleanupAllHostingRecords / removeWorkerRoutes are only called through the guarded helper', async () => {
    for (const f of fs.readdirSync(path.resolve(__dirname, '..')).filter(f => f.endsWith('.js'))) {
      if (['cf-service.js', 'anti-red-service.js', 'hosting-dns-teardown.js'].includes(f)) continue
      const src = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      assert.ok(!/cleanupAllHostingRecords\(|removeWorkerRoutes\(/.test(src), `${f} calls cleanup directly`)
    }
  })
  await t('whole-account teardowns pass excludeId (bot cancel x2, panel cancel, reseller DELETE)', async () => {
    assert.strictEqual((read('_index.js').match(/teardownHostingDomain\(\{ col: cpanelAccounts, domain: d, excludeId: plan\._id/g) || []).length, 2)
    assert.ok(read('cpanel-routes.js').includes('teardownHostingDomain({ col, domain: d, excludeId: account._id'))
    assert.ok(read('reseller-api.js').includes("teardownHostingDomain({ col: col('cpanelAccounts'), domain: d, excludeId: acct._id"))
  })
  await t('domain-detach paths use the guard without excludeId (bot unlink x2 + change primary, panel x2, reseller x3)', async () => {
    assert.strictEqual((read('_index.js').match(/teardownHostingDomain\(\{ col: cpanelAccounts, domain: (addonDomain|oldDomain), tag/g) || []).length, 3)
    assert.strictEqual((read('cpanel-routes.js').match(/teardownHostingDomain\(\{ col: getCpanelCol\(\), domain/g) || []).length, 2)
    assert.strictEqual((read('reseller-hosting-mgmt.js').match(/teardownHostingDomain\(\{ col: col\('cpanelAccounts'\), domain(: oldDomain)?, tag/g) || []).length, 3)
  })
  await t('reseller: domain lookups skip failed records; repair endpoint + anti-red/deploy DNS check + suspend_at', async () => {
    const api = read('reseller-api.js')
    assert.strictEqual((api.match(/chatId, deleted: \{ \$ne: true \}, provisionState: \{ \$ne: 'failed' \}/g) || []).length, 2)
    assert.ok(api.includes("router.post('/hosting/:user/dns/repair'"))
    assert.ok(api.includes("suspended: true, suspendedAt: new Date(), suspendedBy: 'reseller_api'"))
    assert.ok(api.includes('suspended: false, suspendedReason: null, suspendedAt: null'))
    assert.ok(read('reseller-hosting-mgmt.js').includes('hostingDnsRepair.repairAccount(acct, { apply: true })'))
  })

  await col.drop().catch(() => {})
  await mc.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
