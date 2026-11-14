'use strict'
// Telnyx SIP-trunk numbers (search/buy/release, brand routing) + early campaign-failure alert. No network: axios is stubbed.
const assert = require('assert')
const path = require('path')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✅', name) } catch (e) { fail++; console.log('  ❌', name, '—', e.message) } }

const calls = []
let routes = {}
const fake = async (cfg) => {
  calls.push(cfg)
  const key = `${cfg.method.toUpperCase()} ${cfg.url.replace(/^https:\/\/api\.telnyx\.com\/v2/, '')}`
  const h = Object.entries(routes).find(([k]) => key.startsWith(k))
  if (!h) throw Object.assign(new Error('no route ' + key), { response: { status: 404 } })
  return { data: typeof h[1] === 'function' ? h[1](cfg) : h[1] }
}
fake.get = (url, o = {}) => fake({ method: 'get', url, ...o }); fake.post = (url, data, o = {}) => fake({ method: 'post', url, data, ...o }); fake.create = () => fake
require.cache[require.resolve('axios')] = { id: 'axios', filename: 'axios', loaded: true, exports: fake }
process.env.TELNYX_SIP_API_KEY = 'k'
const txs = require(path.join(__dirname, '../telnyx-sip'))

;(async () => {
  console.log('telnyx-sip')
  const CONN = { data: [{ id: 'C1', connection_name: 'CloudIVR SIP server' }] }
  await t('search: area code hit → voice-only rows tagged telnyx, remembered for buying', async () => {
    routes = { 'GET /available_phone_numbers': (c) => ({ data: c.params['filter[national_destination_code]'] === '207' ? [{ phone_number: '+12075550100', region_information: [] }] : [] }) }
    const r = await txs.searchNumbers('US', 'local', '207', 5, 'ME')
    assert.strictEqual(r.length, 1); assert.strictEqual(r[0]._provider, 'telnyx'); assert.deepStrictEqual(r[0]._capabilities, { voice: true, sms: false, mms: false, fax: false })
    assert.ok(txs.isTxSearched('+12075550100')); assert.ok(!r[0]._areaFallback)
  })
  await t('search: empty area code → same state, flagged as fallback', async () => {
    routes = { 'GET /available_phone_numbers': (c) => ({ data: c.params['filter[administrative_area]'] === 'OH' ? [{ phone_number: '+12165550100' }] : [] }) }
    const r = await txs.searchNumbers('US', 'local', '937', 5, 'OH')
    assert.strictEqual(r[0]._fallbackRegion, 'OH'); assert.ok(r[0]._areaFallback)
  })
  await t('search: toll-free asks quickship, never the area code', async () => {
    calls.length = 0
    routes = { 'GET /available_phone_numbers': { data: [{ phone_number: '+18445550100' }] } }
    await txs.searchNumbers('US', 'toll_free', null, 3)
    assert.strictEqual(calls[0].params['filter[phone_number_type]'], 'toll_free'); assert.strictEqual(calls[0].params['filter[quickship]'], true)
  })
  await t('search: other countries → none', async () => { assert.deepStrictEqual(await txs.searchNumbers('GB', 'local', null), []) })
  await t('buy: order on our SIP trunk, waits for success → tx: id', async () => {
    let polls = 0
    routes = { 'GET /fqdn_connections': CONN, 'POST /number_orders': { data: { id: 'O1', status: 'pending' } }, 'GET /number_orders/O1': () => ({ data: { id: 'O1', status: ++polls > 1 ? 'success' : 'pending' } }), 'GET /phone_numbers': { data: [{ id: 'N1', phone_number: '+12075550100' }], meta: { total_pages: 1 } } }
    calls.length = 0
    const r = await txs.buyNumber('+12075550100')
    assert.strictEqual(r.id, 'tx:+12075550100'); assert.strictEqual(r.phone_numbers[0].status, 'success')
    assert.strictEqual(calls.find(c => c.url.endsWith('/number_orders')).data.connection_id, 'C1')
    assert.ok(txs.ownsNumber('+12075550100'))
  }, 15000)
  await t('buy: order not successful (e.g. paperwork) → null, nothing claimed', async () => {
    txs.isTxSearched('+12075550199')
    routes = { 'GET /fqdn_connections': CONN, 'POST /number_orders': { data: { id: 'O2', status: 'failure', phone_numbers: [{ requirements_status: 'requirement-info-pending' }] } } }
    assert.strictEqual(await txs.buyNumber('+12075550199'), null)
  })
  await t('release: deletes only numbers on our SIP trunk (fax numbers untouched)', async () => {
    const del = []
    routes = { 'GET /fqdn_connections': CONN, 'GET /phone_numbers': (c) => ({ data: [{ id: c.params['filter[phone_number]'] === '+1fax' ? 'F' : 'N1', connection_id: c.params['filter[phone_number]'] === '+1fax' ? 'FAXAPP' : 'C1' }] }), 'DELETE /phone_numbers/': (c) => { del.push(c.url); return {} } }
    assert.strictEqual(await txs.releaseByPhoneNumber('+1fax'), false)
    assert.strictEqual(await txs.releaseNumber('tx:+12075550100'), true)
    assert.ok(del.length === 1 && del[0].endsWith('/N1'))
  })

  console.log('router')
  await t('router: Telnyx search first; buying sets the brand route on the SIP server', async () => {
    const ce = require(path.join(__dirname, '../callengine'))
    const set = []; const orig = ce.setDidApps; ce.setDidApps = async (n) => { set.push(...n); return n.length }
    const sw = require(path.join(__dirname, '../signalwire'))
    const w = sw.wrap({ searchNumbers: async () => { throw new Error('old Telnyx must not be asked') } })
    routes = { 'GET /available_phone_numbers': { data: [{ phone_number: '+12075550111' }] }, 'GET /fqdn_connections': CONN, 'POST /number_orders': { data: { id: 'O3', status: 'success' } }, 'GET /phone_numbers': { data: [], meta: { total_pages: 1 } } }
    const r = await w.searchNumbers('US', 'local', '207', 3)
    assert.strictEqual(r[0].phone_number, '+12075550111')
    const o = await w.buyNumber('+12075550111')
    assert.strictEqual(o.id, 'tx:+12075550111'); assert.deepStrictEqual(set, ['+12075550111'])
    ce.setDidApps = orig
  })

  console.log('call engine')
  await t('setDidApps: one ARI global per number = this brand app', async () => {
    const ce = require(path.join(__dirname, '../callengine'))
    process.env.ASTERISK_ARI_URL = 'https://ari'; process.env.ASTERISK_ARI_PASSWORD = 'p'; process.env.CHAT_BOT_BRAND = 'VoodooLand'; process.env.BOT_ENVIRONMENT = 'production'
    const posted = []; const orig = ce.ari; ce.ari = () => ({ request: async (r) => { posted.push(r); return { data: '' } } })
    const n = await ce.setDidApps(['+18445550100', '+12075550100'])
    ce.ari = orig
    assert.strictEqual(n, 2); assert.deepStrictEqual(posted[0].params, { variable: 'DIDAPP_18445550100', value: 'voodooland' }); assert.strictEqual(posted[0].url, '/asterisk/variable')
  })

  console.log('early failure alert')
  const bcs = require(path.join(__dirname, '../bulk-call-service'))
  const sent = [], upd = []
  bcs._setForTest({ updateOne: async (...a) => { upd.push(a) } }, { sendMessage: async (...a) => { sent.push(a) } })
  const start = new Date(Date.now() - 600000)
  const lead = (i, status, cause) => ({ status, hangupCause: cause, completedAt: new Date(start.getTime() + 1000 * (i + 1)) })
  const camp = (leads, extra = {}) => ({ name: 'C', chatId: 5, startedAt: start, callerId: '+12075550100', leads, ...extra })
  await t('6 of the first 10 failed → one admin alert with top reasons', async () => {
    const st = {}
    const leads = [...Array(6)].map((_, i) => lead(i, 'failed', 'This user has been marked as blocked.')).concat([...Array(4)].map((_, i) => lead(6 + i, 'completed')))
    await bcs._earlyFailAlert('c1', st, camp(leads), 'ADMIN')
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0][0], 'ADMIN'); assert.ok(/6 of the first 10/.test(sent[0][1])); assert.ok(/marked as blocked\.? ×6/.test(sent[0][1]))
    await bcs._earlyFailAlert('c1', st, camp(leads), 'ADMIN')
    assert.strictEqual(sent.length, 1, 'no repeat'); assert.strictEqual(upd.length, 1)
  })
  await t('5 of 10 failed → no alert; fewer than 10 finished → wait', async () => {
    sent.length = 0
    const half = [...Array(5)].map((_, i) => lead(i, 'failed')).concat([...Array(5)].map((_, i) => lead(5 + i, 'completed')))
    await bcs._earlyFailAlert('c2', {}, camp(half), 'ADMIN')
    await bcs._earlyFailAlert('c3', {}, camp([...Array(8)].map((_, i) => lead(i, 'failed'))), 'ADMIN')
    assert.strictEqual(sent.length, 0)
  })
  await t('resumed campaign: failures from before the restart do not count; earlier alert is not repeated', async () => {
    sent.length = 0
    const old = [...Array(10)].map((_, i) => lead(i, 'failed'))
    await bcs._earlyFailAlert('c4', {}, camp(old, { resumedAt: new Date() }), 'ADMIN')
    await bcs._earlyFailAlert('c5', {}, camp(old, { earlyFailAlertedAt: new Date() }), 'ADMIN')
    assert.strictEqual(sent.length, 0)
  })

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
