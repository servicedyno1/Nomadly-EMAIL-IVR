/* eslint-disable no-console */
// In-process HTTP integration test for the reseller API branded-nameserver flow.
// Run: node js/tests/test_reseller_branded_ns_api_2026-10.js
//
// SAFE BY CONSTRUCTION: registrar/Cloudflare/WHM layers are replaced with mocks via
// require.cache BEFORE reseller-api loads, and all data lives in a throw-away DB on
// the LOCAL mongod. No real domain is registered, no real wallet is touched.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })

process.env.RESELLER_API_LIVE = 'true'          // exercise the LIVE code path (against mocks)
process.env.RESELLER_BRANDED_NS = 'ns1.hosta.sh,ns2.hosta.sh'
delete process.env.RESELLER_BRANDED_NS_ENABLED
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'

const CF_NS = ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']
const BRANDED = ['ns1.hosta.sh', 'ns2.hosta.sh']
const calls = { checkDomainPrice: 0, registerDomain: [], updateAllNameservers: [], hostingBuild: [] }
const zones = {} // domain → status
let registerError = null

function mockModule(rel, exportsObj) {
  const p = require.resolve(path.resolve(__dirname, '..', rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
const stubProxy = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => ({})) })

let DB = null
mockModule('domain-service.js', stubProxy({
  checkDomainPrice: async (d) => { calls.checkDomainPrice++; return { available: !d.startsWith('taken'), price: 10, registrar: 'ConnectReseller' } },
  registerDomain: async (domain, registrar, nsChoice, db, chatId, customNS) => {
    calls.registerDomain.push({ domain, nsChoice, customNS })
    if (registerError) return { error: registerError }
    const ns = nsChoice === 'cloudflare' ? CF_NS : (customNS || [])
    await db.collection('domainsOf').updateOne({ domainName: domain, chatId: String(chatId) }, { $set: { nameservers: ns, nameserverType: nsChoice, registrar } }, { upsert: true })
    if (nsChoice === 'cloudflare') zones[domain] = 'pending'
    return { success: true, registrar, nameservers: ns, cfZoneId: nsChoice === 'cloudflare' ? `z_${domain}` : null }
  },
  updateAllNameservers: async (domain, ns, db) => {
    calls.updateAllNameservers.push({ domain, ns })
    await db.collection('domainsOf').updateOne({ domainName: domain }, { $set: { nameservers: ns } })
    return { success: true, nameservers: ns }
  },
  getDomainMeta: async (domain, db) => db.collection('domainsOf').findOne({ domainName: domain }),
}))
mockModule('cf-service.js', stubProxy({
  getZoneByName: async (d) => (zones[d] ? { id: `z_${d}`, status: zones[d], name_servers: CF_NS } : null),
  listDNSRecords: async () => [],
}))
mockModule('cr-register-domain-&-create-cpanel.js', {
  registerDomainAndCreateCpanel: async (_send, info) => {
    calls.hostingBuild.push({ domain: info.website_name, nsChoice: info.nsChoice })
    zones[info.website_name] = 'pending'
    return { success: true, username: info.customUsername, password: 'Sup3r-Secret!', nameservers: CF_NS }
  },
})

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const { createResellerApi } = require('../reseller-api')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  DB = client.db(`test_reseller_branded_${Date.now()}`)
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const OWNER = '777000777'
  await DB.collection('resellerApiKeys').insertOne({ _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER, label: 'test' })
  await DB.collection('walletOf').insertOne({ _id: OWNER, usdIn: 1000, usdOut: 0 })
  // another owner's domain (ownership check)
  await DB.collection('domainsOf').insertOne({ domainName: 'not-mine.com', chatId: '1', nameservers: CF_NS })

  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const H = { Authorization: `Bearer ${KEY}` }
  const api = (method, url, data) => axios({ method, url: base + url, data, headers: H, validateStatus: () => true })
  const bdoc = (d) => DB.collection('brandedNsDomains').findOne({ _id: d })
  const balance = async () => { const w = await DB.collection('walletOf').findOne({ _id: OWNER }); return (w.usdIn || 0) - (w.usdOut || 0) }

  console.log('POST /domains/register')
  await t('default → branded: registered on CF names, queued, response shows branded NS + activating', async () => {
    const r = await api('post', '/domains/register', { domain: 'brand-one.com' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.mode, 'live')
    const res = r.data.result
    assert.deepStrictEqual([res.nameserver_mode, res.nameserver_status], ['branded', 'activating'])
    assert.deepStrictEqual(res.nameservers, BRANDED)
    assert.deepStrictEqual(res.current_nameservers, CF_NS)
    assert.strictEqual(calls.registerDomain.pop().nsChoice, 'cloudflare')
    const d = await bdoc('brand-one.com')
    assert.strictEqual(d.status, 'activating')
    assert.strictEqual(d.ownerChatId, OWNER)
    assert.strictEqual(d.source, 'domains/register')
  })
  await t('ns_choice cloudflare → CF names, not queued', async () => {
    const r = await api('post', '/domains/register', { domain: 'cf-one.com', ns_choice: 'cloudflare' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.data.result.nameserver_mode, 'cloudflare')
    assert.deepStrictEqual(r.data.result.nameservers, CF_NS)
    assert.strictEqual(await bdoc('cf-one.com'), null)
  })
  await t('custom nameservers → registered with them (normalised), not queued', async () => {
    const r = await api('post', '/domains/register', { domain: 'custom-one.com', nameservers: ['NS1.MyDns.net.', 'ns2.mydns.net'] })
    assert.strictEqual(r.status, 200)
    const c = calls.registerDomain.pop()
    assert.deepStrictEqual([c.nsChoice, c.customNS], ['custom', ['ns1.mydns.net', 'ns2.mydns.net']])
    assert.strictEqual(r.data.result.nameserver_mode, 'custom')
    assert.strictEqual(await bdoc('custom-one.com'), null)
  })
  await t('nameservers = branded pair → branded', async () => {
    const r = await api('post', '/domains/register', { domain: 'brand-two.com', nameservers: ['ns2.hosta.sh', 'ns1.hosta.sh'] })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(calls.registerDomain.pop().nsChoice, 'cloudflare')
    assert.strictEqual((await bdoc('brand-two.com')).status, 'activating')
  })
  await t('ns_choice registrar → provider_default', async () => {
    const r = await api('post', '/domains/register', { domain: 'reg-one.com', ns_choice: 'registrar' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(calls.registerDomain.pop().nsChoice, 'provider_default')
  })
  await t('invalid ns_choice → 400 before any price lookup or charge', async () => {
    const before = calls.checkDomainPrice
    const bal = await balance()
    const r = await api('post', '/domains/register', { domain: 'x-one.com', ns_choice: 'banana' })
    assert.strictEqual(r.status, 400)
    assert.strictEqual(r.data.error, 'invalid_ns_choice')
    assert.strictEqual(calls.checkDomainPrice, before)
    assert.strictEqual(await balance(), bal)
  })
  await t('bad nameserver list → 400 invalid_nameservers', async () => {
    for (const ns of [['only-one.net'], ['a.x.com', 'bad host'], 'ns1.a.com,ns2.a.com', ['a.x.com', 'b.x.com', 'c.x.com', 'd.x.com', 'e.x.com']]) {
      const r = await api('post', '/domains/register', { domain: 'x-two.com', nameservers: ns })
      assert.strictEqual(r.status, 400, `ns=${JSON.stringify(ns)} → ${r.status}`)
      assert.strictEqual(r.data.error, 'invalid_nameservers')
    }
  })
  await t('registrar {error} → 502 + refund (no silent charge)', async () => {
    registerError = 'Registrar exploded'
    const bal = await balance()
    const r = await api('post', '/domains/register', { domain: 'fail-one.com' })
    registerError = null
    assert.strictEqual(r.status, 502, JSON.stringify(r.data))
    assert.strictEqual(r.data.refunded, true)
    assert.strictEqual(await balance(), bal)
    assert.strictEqual(await bdoc('fail-one.com'), null)
  })

  console.log('reads')
  await t('GET /domains shows branded fields', async () => {
    const r = await api('get', '/domains')
    assert.strictEqual(r.status, 200)
    const one = r.data.domains.find((d) => d.domain === 'brand-one.com')
    assert.ok(one, 'brand-one.com listed')
    assert.deepStrictEqual([one.nameserver_mode, one.nameserver_status, one.nameservers, one.current_nameservers], ['branded', 'activating', BRANDED, CF_NS])
    const cf = r.data.domains.find((d) => d.domain === 'cf-one.com')
    assert.deepStrictEqual(cf.nameservers, CF_NS)
    assert.strictEqual(cf.nameserver_status, undefined)
  })
  await t('GET /dns/:domain/nameservers (branded, cloudflare, custom, not-owned 404)', async () => {
    let r = await api('get', '/dns/brand-one.com/nameservers')
    assert.strictEqual(r.status, 200)
    assert.deepStrictEqual([r.data.nameserver_mode, r.data.nameserver_status], ['branded', 'activating'])
    r = await api('get', '/dns/cf-one.com/nameservers')
    assert.deepStrictEqual([r.status, r.data.nameserver_mode], [200, 'cloudflare'])
    r = await api('get', '/dns/custom-one.com/nameservers')
    assert.deepStrictEqual([r.status, r.data.nameserver_mode], [200, 'custom'])
    r = await api('get', '/dns/not-mine.com/nameservers')
    assert.strictEqual(r.status, 404)
  })

  console.log('PUT /dns/:domain/nameservers')
  await t('custom set → applied + branded management cancelled', async () => {
    const r = await api('put', '/dns/brand-two.com/nameservers', { nameservers: ['ns1.other.org', 'ns2.other.org'] })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual(calls.updateAllNameservers.pop(), { domain: 'brand-two.com', ns: ['ns1.other.org', 'ns2.other.org'] })
    assert.strictEqual((await bdoc('brand-two.com')).status, 'cancelled')
  })
  await t('branded set, zone ACTIVE → switched now + monitoring queued', async () => {
    zones['cf-one.com'] = 'active'
    const r = await api('put', '/dns/cf-one.com/nameservers', { nameservers: ['ns1.hosta.sh', 'ns2.hosta.sh'] })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual(calls.updateAllNameservers.pop(), { domain: 'cf-one.com', ns: BRANDED })
    assert.strictEqual(r.data.nameserver_status, 'branded')
    assert.ok(await bdoc('cf-one.com'))
  })
  await t('branded set, zone PENDING → registrar kept on CF names, switch queued', async () => {
    zones['custom-one.com'] = 'pending'
    const r = await api('put', '/dns/custom-one.com/nameservers', { nameservers: ['ns1.hosta.sh', 'ns2.hosta.sh'] })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.deepStrictEqual(calls.updateAllNameservers.pop(), { domain: 'custom-one.com', ns: CF_NS })
    assert.strictEqual(r.data.nameserver_status, 'activating')
    assert.strictEqual((await bdoc('custom-one.com')).status, 'activating')
  })
  await t('branded set, no Cloudflare zone → 409', async () => {
    const r = await api('put', '/dns/reg-one.com/nameservers', { nameservers: ['ns1.hosta.sh', 'ns2.hosta.sh'] })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.data.error, 'branded_requires_cloudflare')
  })
  await t('invalid list → 400', async () => {
    const r = await api('put', '/dns/reg-one.com/nameservers', { nameservers: ['one.only.com'] })
    assert.strictEqual(r.status, 400)
  })

  console.log('POST /hosting (domain_mode=buy)')
  await t('ns_choice registrar / custom nameservers rejected (400) before charge', async () => {
    const bal = await balance()
    let r = await api('post', '/hosting', { plan_id: 'premium-weekly', domain: 'host-x.com', domain_mode: 'buy', ns_choice: 'registrar' })
    assert.deepStrictEqual([r.status, r.data.error], [400, 'invalid_ns_choice'])
    r = await api('post', '/hosting', { plan_id: 'premium-weekly', domain: 'host-x.com', domain_mode: 'buy', nameservers: ['a.b.com', 'c.d.com'] })
    assert.deepStrictEqual([r.status, r.data.error], [400, 'nameservers_not_supported'])
    assert.strictEqual(await balance(), bal)
  })
  await t('default → 202 with nameserver_mode branded; build done → queued + deliverables branded', async () => {
    const r = await api('post', '/hosting', { plan_id: 'premium-weekly', domain: 'host-one.com', domain_mode: 'buy' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    assert.strictEqual(r.data.nameserver_mode, 'branded')
    assert.deepStrictEqual(r.data.nameservers, BRANDED)
    const username = r.data.username
    // wait for the inline background build
    let job
    for (let i = 0; i < 40; i++) {
      job = await DB.collection('resellerProvisionJobs').findOne({ _id: r.data.job_id })
      if (job && job.status === 'done') break
      await new Promise((ok) => setTimeout(ok, 150))
    }
    assert.strictEqual(job.status, 'done', `job status ${job && job.status} ${job && job.error}`)
    assert.strictEqual(job.request.ns_choice, 'branded')
    assert.strictEqual(calls.hostingBuild.pop().nsChoice, 'cloudflare')
    assert.deepStrictEqual(job.result.nameservers, BRANDED)
    assert.strictEqual(job.result.nameserver_status, 'activating')
    const d = await bdoc('host-one.com')
    assert.deepStrictEqual([d.status, d.source, d.username], ['activating', 'hosting', username])
    const g = await api('get', `/hosting/${username}`)
    assert.strictEqual(g.status, 200, JSON.stringify(g.data).slice(0, 300))
    assert.deepStrictEqual(g.data.deliverables.nameservers, BRANDED)
    assert.strictEqual(g.data.deliverables.nameserver_status, 'activating')
  })
  await t('ns_choice cloudflare → not queued', async () => {
    const r = await api('post', '/hosting', { plan_id: 'premium-weekly', domain: 'host-two.com', domain_mode: 'buy', ns_choice: 'cloudflare' })
    assert.strictEqual(r.status, 202)
    assert.strictEqual(r.data.nameserver_mode, 'cloudflare')
    for (let i = 0; i < 40; i++) {
      const job = await DB.collection('resellerProvisionJobs').findOne({ _id: r.data.job_id })
      if (job && job.status === 'done') break
      await new Promise((ok) => setTimeout(ok, 150))
    }
    assert.strictEqual(await bdoc('host-two.com'), null)
  })
  await t('domain_mode external ignores ns_choice (unchanged behaviour)', async () => {
    const r = await api('post', '/hosting', { plan_id: 'premium-weekly', domain: 'host-ext.com', domain_mode: 'external', ns_choice: 'banana' })
    assert.strictEqual(r.status, 202)
    assert.strictEqual(r.data.nameserver_mode, undefined)
  })

  console.log('webhooks list')
  await t('GET /account/webhook lists branded events', async () => {
    const r = await api('get', '/account/webhook')
    assert.strictEqual(r.status, 200)
    for (const ev of ['domain.nameservers_branded', 'domain.nameservers_reverted', 'domain.nameservers_branding_failed']) assert.ok(r.data.events.includes(ev), ev)
  })

  server.close()
  await DB.dropDatabase()
  await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
