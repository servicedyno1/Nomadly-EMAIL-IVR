/* eslint-disable no-console */
// Reseller API: DNS-record endpoints only work on domains the key's account owns, and the new
// IP access rules (allow-only / block) per hosted site. Mocks Cloudflare + DNS layers; throw-away DB.
// Run: node js/tests/test_reseller_dns_owner_ip_rules_2026-11.js
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'

function mockModule(rel, exportsObj) {
  const p = require.resolve(path.resolve(__dirname, '..', rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
const stubProxy = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => ({})) })
const dnsCalls = []
mockModule('domain-service.js', stubProxy({
  viewDNSRecords: async (d) => { dnsCalls.push(['view', d]); return { records: [{ id: 'r1', type: 'A', name: '@', value: '203.0.113.10' }], source: 'cloudflare' } },
  addDNSRecord: async (d) => { dnsCalls.push(['add', d]); return { success: true } },
  updateDNSRecord: async (d) => { dnsCalls.push(['update', d]); return { success: true } },
  deleteDNSRecord: async (d) => { dnsCalls.push(['delete', d]); return { success: true } },
  getDomainMeta: async () => null,
}))
// Real rule helpers (expression building, IP-rule tagging) on top of a fake Cloudflare ruleset.
const realCf = require('../cf-service.js')
const axios = require('axios')
let rules = [{ id: 'platform1', description: 'AntiRed: block scanners', expression: '(ip.src in {192.0.2.1})', action: 'block' }]
const origGet = axios.get, origPost = axios.post, origDel = axios.delete
axios.get = async (url, o) => (url.includes('api.cloudflare.com') ? { data: { success: true, result: { id: 'rs1', rules } } } : origGet(url, o))
axios.post = async (url, body, o) => {
  if (!url.includes('api.cloudflare.com')) return origPost(url, body, o)
  rules = [...rules, { id: 'r' + crypto.randomBytes(3).toString('hex'), ...body }]
  return { data: { success: true, result: { id: 'rs1', rules } } }
}
axios.delete = async (url, o) => {
  if (!url.includes('api.cloudflare.com')) return origDel(url, o)
  const id = url.split('/').pop(); rules = rules.filter(r => r.id !== id)
  return { data: { success: true, result: { id: 'rs1', rules } } }
}
mockModule('cf-service.js', stubProxy({ ...realCf, getZoneByName: async (d) => ({ id: `z_${d}`, name: d }) }))

const express = require('express')
const { MongoClient } = require('mongodb')
const { createResellerApi } = require('../reseller-api')
let passed = 0, failed = 0
async function t(name, fn) { try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 3).join('\n     ')}`) } }

;(async () => {
  const client = await MongoClient.connect('mongodb://127.0.0.1:27017')
  const DB = client.db(`test_reseller_dnsip_${Date.now()}`)
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const OWNER = '777000778'
  await DB.collection('resellerApiKeys').insertOne({ _id: crypto.randomUUID(), keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true, ownerChatId: OWNER })
  await DB.collection('domainsOf').insertMany([{ domainName: 'mine.com', chatId: OWNER }, { domainName: 'victim.com', chatId: '1' }])
  await DB.collection('cpanelAccounts').insertMany([
    { _id: 'gold01', chatId: OWNER, domain: 'goldsite.com', plan: 'Golden Anti-Red HostPanel (1-Month)', addonDomains: [{ domain: 'addon-mine.com' }] },
    { _id: 'prem01', chatId: OWNER, domain: 'premsite.com', plan: 'Premium Anti-Red HostPanel (1-Month)', addonDomains: ['addon-str.com'] },
    { _id: 'other01', chatId: '1', domain: 'othersite.com', plan: 'Golden Anti-Red HostPanel (1-Month)' },
  ])
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {}, notifyAdmin: async () => {} }))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/reseller/v1`
  const http = axios.create()
  const api = (method, url, data) => http.request({ method, url: base + url, data, headers: { Authorization: `Bearer ${KEY}` }, validateStatus: () => true })

  console.log('DNS records — ownership')
  for (const [verb, m] of [['get', 'view'], ['post', 'add'], ['put', 'update'], ['delete', 'delete']]) {
    await t(`${verb.toUpperCase()} on another owner's domain → 404, provider never called`, async () => {
      dnsCalls.length = 0
      const r = await api(verb, '/dns/victim.com/records', verb === 'get' ? undefined : { type: 'TXT', name: '@', value: 'x', id: 'r1' })
      assert.strictEqual(r.status, 404, JSON.stringify(r.data)); assert.strictEqual(r.data.error, 'domain_not_found'); assert.strictEqual(dnsCalls.length, 0)
    })
    await t(`${verb.toUpperCase()} on own registered domain → ok`, async () => {
      dnsCalls.length = 0
      const r = await api(verb, '/dns/mine.com/records', verb === 'get' ? undefined : { type: 'TXT', name: '@', value: 'x', id: 'r1' })
      assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.deepStrictEqual(dnsCalls[0], [m, 'mine.com'])
    })
  }
  await t('primary + addon (object and string) domains of own hosting accounts → ok', async () => {
    for (const d of ['goldsite.com', 'addon-mine.com', 'addon-str.com']) assert.strictEqual((await api('get', `/dns/${d}/records`)).status, 200, d)
  })
  await t("another owner's hosted domain → 404", async () => { assert.strictEqual((await api('get', '/dns/othersite.com/records')).status, 404) })

  console.log('IP access rules')
  await t('available on non-Golden plans too', async () => {
    const r = await api('get', '/hosting/prem01/security/ip-rules'); assert.strictEqual(r.status, 200, JSON.stringify(r.data))
  })
  await t("another owner's account → 404", async () => { assert.strictEqual((await api('get', '/hosting/other01/security/ip-rules')).status, 404) })
  await t('list hides platform rules', async () => {
    const r = await api('get', '/hosting/gold01/security/ip-rules'); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.data.rules, [])
  })
  await t('invalid mode / IPs rejected', async () => {
    assert.strictEqual((await api('post', '/hosting/gold01/security/ip-rules', { mode: 'deny', ips: ['1.2.3.4'] })).data.error, 'invalid_mode')
    const r = await api('post', '/hosting/gold01/security/ip-rules', { mode: 'block', ips: ['1.2.3.4', '999.1.1.1', '10.0.0.0/4', 'abc'] })
    assert.strictEqual(r.status, 400); assert.deepStrictEqual(r.data.invalid, ['999.1.1.1', '10.0.0.0/4', 'abc'])
    assert.strictEqual((await api('post', '/hosting/gold01/security/ip-rules', { mode: 'block', ips: [] })).status, 400)
  })
  let blockId, allowId
  await t('create block rule → expression ip.src in {…}', async () => {
    const r = await api('post', '/hosting/gold01/security/ip-rules', { mode: 'block', ips: ['198.51.100.7', '203.0.113.0/24', '2001:db8::/32'], note: 'scanners' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); blockId = r.data.rule.id
    assert.deepStrictEqual(r.data.rule.ips, ['198.51.100.7', '203.0.113.0/24', '2001:db8::/32']); assert.strictEqual(r.data.rule.mode, 'block'); assert.strictEqual(r.data.rule.note, 'scanners')
    const raw = rules.find(x => x.id === blockId); assert.strictEqual(raw.expression, '(ip.src in {198.51.100.7 203.0.113.0/24 2001:db8::/32})'); assert.strictEqual(raw.action, 'block')
  })
  await t('create allow-only rule → expression not ip.src in {…}', async () => {
    const r = await api('post', '/hosting/gold01/security/ip-rules', { mode: 'allow', ips: ['198.51.100.9'] })
    allowId = r.data.rule.id
    assert.strictEqual(rules.find(x => x.id === allowId).expression, '(not (ip.src in {198.51.100.9}))'); assert.strictEqual(r.data.rule.mode, 'allow')
  })
  await t('list shows both API rules only', async () => {
    const r = await api('get', '/hosting/gold01/security/ip-rules'); assert.deepStrictEqual(r.data.rules.map(x => x.mode).sort(), ['allow', 'block'])
  })
  await t('delete refuses platform rule id', async () => {
    const r = await api('delete', '/hosting/gold01/security/ip-rules', { ruleId: 'platform1' }); assert.strictEqual(r.status, 404); assert.ok(rules.some(x => x.id === 'platform1'))
  })
  await t('delete own IP rule', async () => {
    const r = await api('delete', '/hosting/gold01/security/ip-rules', { ruleId: blockId }); assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.ok(!rules.some(x => x.id === blockId))
  })

  server.close(); await DB.dropDatabase(); await client.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
