/* eslint-disable no-console */
// Unit tests for js/branded-ns.js — run: node js/tests/test_branded_ns_2026-10.js
// Uses a throw-away database on the LOCAL mongod (never the reseller/live DB) and
// mocks Cloudflare, the registrar layer (domain-service), DNS probes and webhooks.
const assert = require('assert')
const { MongoClient } = require('mongodb')

process.env.RESELLER_BRANDED_NS = 'ns1.hosta.sh,ns2.hosta.sh'
delete process.env.RESELLER_BRANDED_NS_ENABLED
const bn = require('../branded-ns')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`) }
}

// ── Mocks ──
const CF_NS = ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']
const state = {
  zoneStatus: 'pending', zoneFound: true, records: [], authIps: ['104.21.1.1'],
  registrarNs: {}, updateCalls: [], updateFail: false, activationChecks: 0, webhooks: [], notifies: [],
}
const cfMock = {
  getZoneByName: async () => (state.zoneFound ? { id: 'zone1', status: state.zoneStatus, name_servers: CF_NS } : null),
  listDNSRecords: async () => state.records,
}
const probesMock = {
  cfGetZone: async () => (state.zoneFound ? { found: true, id: 'zone1', status: state.zoneStatus, nameservers: CF_NS } : { found: false }),
  cfTriggerActivationCheck: async () => { state.activationChecks++; return { ok: true } },
  resolveFirstIpv4: async () => '172.64.35.177',
  rawQuery: async () => ({ ok: true, answers: state.authIps.map((ip) => ({ type: 'A', data: ip })) }),
  isCloudflareIp: (ip) => /^(104\.|172\.6[4-9]\.|172\.7[01]\.)/.test(ip),
}
const dsMock = {
  getDomainMeta: async (d) => ({ nameservers: state.registrarNs[d] || [] }),
  updateAllNameservers: async (d, ns) => {
    state.updateCalls.push({ d, ns })
    if (state.updateFail) return { error: 'registrar said no' }
    state.registrarNs[d] = ns
    return { success: true, nameservers: ns, nameserverType: 'cloudflare' }
  },
}

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const db = client.db(`test_branded_ns_${Date.now()}`)
  bn._setDeps({
    getDb: () => db, cf: cfMock, probes: probesMock, domainService: dsMock,
    emitWebhook: (_db, doc, event, payload) => state.webhooks.push({ domain: doc._id, event, payload }),
    notifyAdmin: (m) => state.notifies.push(m),
    log: () => {},
  })
  const due = async (d) => db.collection(bn.COL).updateOne({ _id: d }, { $set: { nextCheckAt: new Date(Date.now() - 1000) } })
  const doc = async (d) => db.collection(bn.COL).findOne({ _id: d })

  console.log('resolveNsChoice / validation')
  await t('default → branded (registered on cloudflare)', () => {
    const r = bn.resolveNsChoice({})
    assert.deepStrictEqual([r.ok, r.mode, r.registerChoice, r.customNS], [true, 'branded', 'cloudflare', null])
  })
  await t('ns_choice cloudflare', () => assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'Cloudflare' }).mode, 'cloudflare'))
  await t('ns_choice registrar → provider_default', () => assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'registrar' }).registerChoice, 'provider_default'))
  await t('custom nameservers normalised', () => {
    const r = bn.resolveNsChoice({ nameservers: ['NS1.Example.com.', 'ns2.example.com'] })
    assert.deepStrictEqual([r.mode, r.registerChoice, r.customNS], ['custom', 'custom', ['ns1.example.com', 'ns2.example.com']])
  })
  await t('nameservers equal to branded set → branded', () => assert.strictEqual(bn.resolveNsChoice({ nameservers: ['ns2.hosta.sh', 'NS1.HOSTA.SH'] }).mode, 'branded'))
  await t('mixed branded+other → custom', () => assert.strictEqual(bn.resolveNsChoice({ nameservers: ['ns1.hosta.sh', 'ns9.other.net'] }).mode, 'custom'))
  await t('invalid ns_choice → 400', () => assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'banana' }).code, 'invalid_ns_choice'))
  await t('custom without list → error', () => assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'custom' }).ok, false))
  await t('1 nameserver → error', () => assert.strictEqual(bn.resolveNsChoice({ nameservers: ['ns1.x.com'] }).ok, false))
  await t('5 nameservers → error', () => assert.strictEqual(bn.resolveNsChoice({ nameservers: ['a.x.com', 'b.x.com', 'c.x.com', 'd.x.com', 'e.x.com'] }).ok, false))
  await t('bad hostname → error', () => assert.match(bn.resolveNsChoice({ nameservers: ['ns1.x.com', 'not a host'] }).error, /Invalid nameserver/))
  await t('nameservers as string → error', () => assert.strictEqual(bn.resolveNsChoice({ nameservers: 'ns1.x.com,ns2.x.com' }).ok, false))
  await t('hosting rejects nameservers + registrar', () => {
    assert.strictEqual(bn.resolveNsChoice({ nameservers: ['a.x.com', 'b.x.com'], forHosting: true }).code, 'nameservers_not_supported')
    assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'registrar', forHosting: true }).code, 'invalid_ns_choice')
    assert.strictEqual(bn.resolveNsChoice({ forHosting: true }).mode, 'branded')
  })
  await t('flag off → default cloudflare, branded downgraded', () => {
    process.env.RESELLER_BRANDED_NS_ENABLED = 'false'
    try {
      assert.strictEqual(bn.resolveNsChoice({}).mode, 'cloudflare')
      assert.strictEqual(bn.resolveNsChoice({ ns_choice: 'branded' }).mode, 'cloudflare')
      assert.strictEqual(bn.isBrandedSet(['ns1.hosta.sh', 'ns2.hosta.sh']), true) // still recognised
    } finally { delete process.env.RESELLER_BRANDED_NS_ENABLED }
  })

  console.log('lifecycle')
  const D = 'example-branded.com'
  await t('enqueue → activating', async () => {
    await bn.enqueue(db, { domain: D, ownerChatId: '42', source: 'domains/register', cfNameservers: CF_NS })
    const d = await doc(D)
    assert.strictEqual(d.status, 'activating')
    assert.deepStrictEqual(d.brandedNs, ['ns1.hosta.sh', 'ns2.hosta.sh'])
    state.registrarNs[D] = CF_NS
  })
  await t('not due yet → nothing processed', async () => {
    const r = await bn.tick()
    assert.strictEqual(r.processed, 0)
  })
  await t('zone pending → waits, triggers activation check, never switches', async () => {
    await due(D)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'waiting_activation')
    assert.strictEqual(state.activationChecks, 1)
    assert.strictEqual(state.updateCalls.length, 0)
    const d = await doc(D)
    assert.ok(new Date(d.nextCheckAt) > new Date())
    assert.strictEqual(d.lockUntil, null)
  })
  await t('active but proxied record leaks origin → waits (no switch)', async () => {
    state.zoneStatus = 'active'
    state.records = [{ type: 'A', name: D, proxied: true }]
    state.authIps = ['203.0.113.7']
    await due(D)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'waiting_proxy')
    assert.strictEqual(state.updateCalls.length, 0)
  })
  await t('active + proxied → switches registrar to branded + webhook', async () => {
    state.authIps = ['104.21.1.1', '172.67.2.2']
    await due(D)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'switched')
    assert.deepStrictEqual(state.updateCalls.pop(), { d: D, ns: ['ns1.hosta.sh', 'ns2.hosta.sh'] })
    const d = await doc(D)
    assert.strictEqual(d.status, 'branded')
    assert.ok(d.switchedAt)
    assert.strictEqual(state.webhooks.pop().event, 'domain.nameservers_branded')
  })
  await t('display view for branded', async () => {
    const v = bn.displayFromDoc(await doc(D))
    assert.deepStrictEqual([v.nameserver_mode, v.nameserver_status, v.nameservers], ['branded', 'branded', ['ns1.hosta.sh', 'ns2.hosta.sh']])
    const m = await bn.displayMap(db, [D, 'unknown.com'])
    assert.ok(m[D] && !m['unknown.com'])
  })
  await t('monitor: healthy → ok', async () => {
    await due(D)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'ok')
    assert.strictEqual((await doc(D)).status, 'branded')
  })
  await t('monitor: zone moved → auto-revert to CF names + webhook + admin alert', async () => {
    state.zoneStatus = 'moved'
    await due(D)
    const n0 = state.notifies.length
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'reverted')
    assert.deepStrictEqual(state.updateCalls.pop(), { d: D, ns: CF_NS })
    const d = await doc(D)
    assert.strictEqual(d.status, 'reverted')
    assert.match(d.revertReason, /moved/)
    assert.strictEqual(state.webhooks.pop().event, 'domain.nameservers_reverted')
    assert.ok(state.notifies.length > n0)
    const v = bn.displayFromDoc(d)
    assert.deepStrictEqual([v.nameserver_status, v.nameservers], ['reverted', CF_NS])
  })
  await t('reverted docs are not processed again', async () => {
    await due(D)
    const r = await bn.tick()
    assert.strictEqual(r.processed, 0)
  })

  const D2 = 'owner-moved.com'
  await t('owner changed nameservers → cancelled, registrar untouched', async () => {
    state.zoneStatus = 'active'
    await bn.enqueue(db, { domain: D2, ownerChatId: '42', source: 'hosting', cfNameservers: CF_NS })
    state.registrarNs[D2] = ['ns1.someone-else.net', 'ns2.someone-else.net']
    await due(D2)
    const calls = state.updateCalls.length
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'cancelled')
    assert.strictEqual(state.updateCalls.length, calls)
    assert.strictEqual(bn.displayFromDoc(await doc(D2)), null)
  })

  const D3 = 'registrar-refuses.com'
  await t('registrar failure → retries then branding_failed (stays on CF names)', async () => {
    state.updateFail = true
    state.records = []
    await bn.enqueue(db, { domain: D3, ownerChatId: '42', source: 'domains/register', cfNameservers: CF_NS })
    state.registrarNs[D3] = CF_NS
    let last
    for (let i = 0; i < 6; i++) { await due(D3); last = await bn.tick() }
    assert.strictEqual(last.results[0].action, 'failed')
    const d = await doc(D3)
    assert.strictEqual(d.status, 'branding_failed')
    assert.strictEqual(bn.displayFromDoc(d).nameserver_status, 'branding_failed')
    assert.strictEqual(state.webhooks.pop().event, 'domain.nameservers_branding_failed')
    state.updateFail = false
  })

  const D4 = 'never-activates.com'
  await t('activation timeout → branding_failed', async () => {
    state.zoneStatus = 'pending'
    await bn.enqueue(db, { domain: D4, ownerChatId: '42', source: 'domains/register', cfNameservers: CF_NS })
    await db.collection(bn.COL).updateOne({ _id: D4 }, { $set: { createdAt: new Date(Date.now() - 80 * 3600000) } })
    state.registrarNs[D4] = CF_NS
    await due(D4)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'failed')
    assert.match((await doc(D4)).failedReason, /zone_not_activated/)
  })

  const D5 = 'zone-gone.com'
  await t('branded + zone deleted → revert attempted with stored CF names', async () => {
    state.zoneStatus = 'active'
    state.zoneFound = true
    await bn.enqueue(db, { domain: D5, ownerChatId: '42', source: 'domains/register', cfNameservers: CF_NS })
    state.registrarNs[D5] = CF_NS
    await due(D5); await bn.tick()
    assert.strictEqual((await doc(D5)).status, 'branded')
    state.zoneFound = false
    await due(D5)
    const r = await bn.tick()
    assert.strictEqual(r.results[0].action, 'reverted')
    assert.match((await doc(D5)).revertReason, /zone missing/)
    state.zoneFound = true
  })

  await t('cancel() then display is null', async () => {
    await bn.enqueue(db, { domain: 'c.com', ownerChatId: '1', cfNameservers: CF_NS })
    await bn.cancel(db, 'c.com', 'owner_set_nameservers')
    assert.strictEqual((await doc('c.com')).status, 'cancelled')
  })

  await db.dropDatabase()
  await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
