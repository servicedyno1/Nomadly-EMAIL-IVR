// DO-RDP lifecycle fixes (2026-10-14) — NO real droplet, fake DO API + isolated local MongoDB.
//   A) log-redact.redactSecrets — RDP/VPS/cPanel passwords + PINs never reach PM2 logs
//   B) rdp-grace-lifecycle — reseller records route by `instanceId`; destroy backs off after 10 failures
//   C) deleteVPSinstance — DO-RDP record with a bare-uuid vpsId is NOT sent to Vultr
//   D) processExpiries — paid-until (vpsPlansOf.end_time) wins over expires_at; vanished droplet → DELETED
//   node js/tests/test_rdp_lifecycle_fixes_2026-10.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const DAY = 86400000

const fake = { droplets: {}, calls: [], getStatus: null }
function resetDO() { fake.droplets = {}; fake.calls = []; fake.getStatus = null }
function seedDroplet(id) { fake.droplets[id] = { id, status: 'active', networks: { v4: [{ type: 'public', ip_address: '127.0.0.1' }] } } }
async function fakeDO({ method, url, data }) {
  const m = method.toUpperCase()
  const u = url.replace('https://api.digitalocean.com/v2', '')
  fake.calls.push({ m, u, type: data && data.type })
  let mt
  if (/vultr/i.test(url)) return { status: 401, data: { error: 'Unauthorized' } }
  if (m === 'POST' && (mt = u.match(/^\/droplets\/(\d+)\/actions$/))) {
    if (!fake.droplets[mt[1]]) return { status: 404, data: { message: 'not found' } }
    return { status: 201, data: { action: { id: 1, status: 'completed', type: data.type } } }
  }
  if (m === 'DELETE' && (mt = u.match(/^\/droplets\/(\d+)$/))) {
    if (!fake.droplets[mt[1]]) return { status: 404, data: { message: 'not found' } }
    delete fake.droplets[mt[1]]; return { status: 204, data: '' }
  }
  if (m === 'GET' && (mt = u.match(/^\/droplets\/(\d+)$/))) {
    if (fake.getStatus) return { status: fake.getStatus, data: { message: 'upstream error' } }
    const d = fake.droplets[mt[1]]; return d ? { status: 200, data: { droplet: d } } : { status: 404, data: { message: 'not found' } }
  }
  return { status: 500, data: { message: `unstubbed ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
require(axiosPath)
// Other providers loaded by the smart proxy call axios.create at require time; any of their calls fail loudly.
fakeDO.create = () => {
  const inst = (cfg) => fakeDO({ method: 'GET', ...cfg, url: `vultr-or-other:${cfg.url}` })
  for (const m of ['get', 'delete', 'post', 'put', 'patch']) inst[m] = (url, a, b) => fakeDO({ method: m, url: `vultr-or-other:${url}`, data: ['post', 'put', 'patch'].includes(m) ? a : undefined, ...(b || {}) })
  inst.request = (cfg) => inst(cfg)
  inst.interceptors = { request: { use: () => {} }, response: { use: () => {} } }
  inst.defaults = { headers: { common: {} } }
  return inst
}
require.cache[axiosPath].exports = fakeDO

process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'

const { redactSecrets, redactDomains } = require('../log-redact.js')
const grace = require('../rdp-grace-lifecycle.js')
const svc = require('../digitalocean-rdp-service.js')
Object.assign(svc._timing, { offPoll: 20, actionPoll: 20, goneRecheckMs: 10 })
const en = require('../lang/en.js')

function partA() {
  console.log('\n── A: password / PIN redaction in logs ──')
  const rdp = 'reply: 🔐 <strong>Current VPS Password</strong>\n\n🖥️ <strong>RDP:</strong> nomadly-twsagc\n🌐 <strong>IP:</strong> <code>164.90.171.80</code>\n👤 <strong>Username:</strong> <code>Administrator</code>\n🔑 <strong>Password:</strong> <code>Xk9#mQ2v!pLz</code>\n\n📋 <strong>Connect:</strong> <code>164.90.171.80:3389</code>\tto: 7706803914'
  const r = redactSecrets(rdp)
  ok('RDP password masked', !r.includes('Xk9#mQ2v!pLz') && r.includes('🔑 <strong>Password:</strong> <code>***</code>'))
  ok('IP / username / connect lines untouched', r.includes('<code>164.90.171.80</code>') && r.includes('<code>Administrator</code>') && r.includes('<code>164.90.171.80:3389</code>'))
  ok('chat id kept for debugging', r.endsWith('to: 7706803914'))
  const spoiler = '<strong>• Password:</strong> <tg-spoiler><code>S3cr3t-Pw</code></tg-spoiler>'
  ok('tg-spoiler password masked', !redactSecrets(spoiler).includes('S3cr3t-Pw'))
  const cases = [
    ['fr', '🔑 <strong>Mot de passe :</strong> <code>abcDEF123</code>', 'abcDEF123'],
    ['zh', '🔑 <strong>密码：</strong> <code>zhPass99</code>', 'zhPass99'],
    ['hi', '🔑 <strong>पासवर्ड:</strong> <code>hiPass77</code>', 'hiPass77'],
    ['pin', '<b>PIN:</b> <code>482913</code>', '482913'],
    ['pin-hi', '<b>पिन:</b> <code>551200</code>', '551200'],
    ['sip', '🔒 SIP Pass: <code>sipSecret1</code>', 'sipSecret1'],
    ['new pw', '🔑 <strong>New Password:</strong> <code>N3wPw!</code>', 'N3wPw!'],
    ['json', '{"username":"root","password":"plainJsonPw"}', 'plainJsonPw'],
    ['kv', 'reset ok password=kvPw123 for vps', 'kvPw123'],
  ]
  for (const [n, line, secret] of cases) ok(`${n}: secret masked`, !redactSecrets(line).includes(secret), redactSecrets(line))
  const plain = ['[VPS] Password revealed - ChatId: 1, Instance: rdp-abc', 'Order 123 passed checks', 'reply: Select an option <code>MENU</code> to: 5', 'RDP Port: <code>3389</code>']
  for (const l of plain) ok(`untouched: ${l.slice(0, 40)}`, redactSecrets(l) === l, redactSecrets(l))
  ok('non-strings pass through', redactSecrets(42) === 42 && redactSecrets(null) === null)
  // Real template: the bot's credential message goes through send() → console.log → shim.
  const tpl = en.en && en.en.vp && typeof en.en.vp.windowsReinstallStarted === 'function'
    ? en.en.vp.windowsReinstallStarted('box', '1.2.3.4', 'Administrator', 'TplPw#2026', 'Windows', 3) : null
  if (tpl) ok('real vp.windowsReinstallStarted template: password masked', !redactSecrets(tpl).includes('TplPw#2026'))
  // Console shim chains both redactions.
  const out = []
  const orig = console.log
  console.log = (...a) => out.push(a.join(' '))
  const lr = require('../log-redact.js')
  delete require.cache[require.resolve('../log-redact.js')]
  const fresh = require('../log-redact.js')
  fresh.installConsoleRedaction()
  console.log('🔑 <b>Password:</b> <code>ShimPw1</code> for mshop.store')
  const shimmed = out[0] || ''
  console.log = orig
  ok('console shim masks password AND customer domain', shimmed && !shimmed.includes('ShimPw1') && !shimmed.includes('mshop.store'), shimmed)
  void lr; void redactDomains
}

function spy(impl) { const fn = (...a) => { fn.calls.push(a); return impl ? impl(...a) : undefined }; fn.calls = []; return fn }
function deps(now, over = {}) {
  return { now, powerOff: spy(() => Promise.resolve()), destroy: spy(() => Promise.resolve({ success: true })), updatePlan: spy(() => Promise.resolve()),
    mirrorGrace: spy(() => Promise.resolve()), mirrorDestroy: spy(() => Promise.resolve()), notifyUser: spy(), notifyReseller: spy(), notifyAdmin: spy(), log: () => {}, ...over }
}

async function partB() {
  console.log('\n── B: grace lifecycle — reseller instanceId + destroy backoff ──')
  const now = new Date('2026-10-14T20:00:00Z')
  const reseller = { _id: '227de9e3-c9da-4d38-aa06-8ff31b216057', vpsId: '227de9e3-c9da-4d38-aa06-8ff31b216057', instanceId: 'rdp-d2ae47d3-1d32-4557-86d5-78dfef35dacf', provider: 'digitalocean-rdp', chatId: '9', status: 'RUNNING', end_time: new Date(now - 60000) }
  ok('instanceIdOf prefers instanceId over bare-uuid vpsId', grace.instanceIdOf(reseller) === 'rdp-d2ae47d3-1d32-4557-86d5-78dfef35dacf')
  ok('instanceIdOf keeps contaboInstanceId first (bot records)', grace.instanceIdOf({ contaboInstanceId: 'rdp-x', instanceId: 'rdp-y', vpsId: 'rdp-x' }) === 'rdp-x')
  ok('reseller record (no provider) detected as DO-RDP via instanceId', grace.isDigitalOceanRdp({ vpsId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', instanceId: 'rdp-z' }) === true)
  const d1 = deps(now)
  await grace.applyRdpGrace(reseller, grace.decideRdpGrace(reseller, { now }), d1)
  ok('enter_grace powers off the rdp- instance (not the uuid)', d1.powerOff.calls[0] && d1.powerOff.calls[0][0] === reseller.instanceId)
  ok('enter_grace mirrors onto the rdp- instance', d1.mirrorGrace.calls[0] && d1.mirrorGrace.calls[0][0] === reseller.instanceId)

  const overdue = { ...reseller, status: 'EXPIRED_GRACE', grace_until: new Date(now - DAY) }
  const failing = () => spy(() => Promise.resolve({ success: false, error: 'boom' }))
  const d2 = deps(now, { destroy: failing() })
  await grace.applyRdpGrace({ ...overdue, deleteRetryCount: 3 }, { action: 'destroy' }, d2)
  ok('retry 4: destroy still attempted', d2.destroy.calls.length === 1)
  ok('failed destroy records lastDeleteAttemptAt', d2.updatePlan.calls.some(c => c[1].lastDeleteAttemptAt instanceof Date && c[1].deleteRetryCount === 4))
  const d3 = deps(now, { destroy: failing() })
  const r3 = await grace.applyRdpGrace({ ...overdue, deleteRetryCount: 10, lastDeleteAttemptAt: new Date(now - 3600000) }, { action: 'destroy' }, d3)
  ok('after 10 failures, <6h since last try → destroy skipped', d3.destroy.calls.length === 0 && r3.skipped === 'backoff')
  ok('backoff writes nothing + no admin alert', d3.updatePlan.calls.length === 0 && d3.notifyAdmin.calls.length === 0)
  const d4 = deps(now, { destroy: failing() })
  await grace.applyRdpGrace({ ...overdue, deleteRetryCount: 580 }, { action: 'destroy' }, d4)
  ok('after 10 failures with no lastDeleteAttemptAt → one attempt (then backs off)', d4.destroy.calls.length === 1 && d4.updatePlan.calls.some(c => c[1].lastDeleteAttemptAt))
  const d5 = deps(now, { destroy: failing() })
  await grace.applyRdpGrace({ ...overdue, deleteRetryCount: 12, lastDeleteAttemptAt: new Date(now - 7 * 3600000) }, { action: 'destroy' }, d5)
  ok('after 10 failures, ≥6h since last try → destroy retried', d5.destroy.calls.length === 1)
  const d6 = deps(now)
  await grace.applyRdpGrace({ ...overdue, deleteRetryCount: 12, lastDeleteAttemptAt: new Date(now - 7 * 3600000) }, { action: 'destroy' }, d6)
  ok('late success → CANCELLED', d6.updatePlan.calls.some(c => c[1].status === 'CANCELLED'))
}

async function partC(db) {
  console.log('\n── C: deleteVPSinstance routing for DO-RDP records ──')
  const vm = require('../vm-instance-setup.js')
  vm.initVpsDb(db)
  const plans = db.collection('vpsPlansOf'), servers = db.collection('doRdpServers')
  await plans.deleteMany({}); await servers.deleteMany({})
  resetDO(); seedDroplet(701)
  await servers.insertOne({ server_id: 'd2ae47d3-1d32-4557-86d5-78dfef35dacf', do_droplet_id: 701, status: 'expired' })
  await plans.insertOne({ _id: '227de9e3-c9da-4d38-aa06-8ff31b216057', vpsId: '227de9e3-c9da-4d38-aa06-8ff31b216057', instanceId: 'rdp-d2ae47d3-1d32-4557-86d5-78dfef35dacf', provider: 'digitalocean-rdp', chatId: '5590563715', status: 'EXPIRED_GRACE' })
  svc.init(db)
  const r1 = await vm.deleteVPSinstance('5590563715', '227de9e3-c9da-4d38-aa06-8ff31b216057')
  ok('reseller record: delete succeeds', r1 && r1.success === true, JSON.stringify(r1))
  ok('reseller record: no Vultr DELETE', !fake.calls.some(c => c.m === 'DELETE' && /vultr/i.test(c.u)), JSON.stringify(fake.calls))
  ok('reseller record: DO droplet deleted', !fake.droplets[701] && fake.calls.some(c => c.m === 'DELETE' && c.u === '/droplets/701'))
  ok('reseller record: vpsPlansOf DELETED', (await plans.findOne({ _id: '227de9e3-c9da-4d38-aa06-8ff31b216057' })).status === 'DELETED')
  // Box already gone, no doRdpServers row (the live 227de9e3 case) → still resolves, never Vultr.
  resetDO()
  await plans.insertOne({ _id: 'b-uuid-0000-0000-0000-000000000001', vpsId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', provider: 'digitalocean-rdp', chatId: '1', status: 'EXPIRED_GRACE' })
  const r2 = await vm.deleteVPSinstance('1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  ok('DO-RDP bare uuid, no instanceId → routed to DO-RDP (rdp- prefix), succeeds', r2 && r2.success === true && !fake.calls.some(c => c.m === 'DELETE' && /vultr/i.test(c.u)), JSON.stringify(r2))
}

async function partD(db) {
  console.log('\n── D: processExpiries — paid-until wins + vanished droplets ──')
  const servers = db.collection('doRdpServers'), plans = db.collection('vpsPlansOf')
  const alerts = []
  svc.init(db, { notifyAdmin: (t) => { alerts.push(t) } })
  await new Promise(r => setTimeout(r, 30))
  const now = Date.now()

  // D1 — expires_at (30 days) passed but end_time (calendar month) is tomorrow → stays on.
  resetDO(); seedDroplet(801)
  await servers.deleteMany({}); await plans.deleteMany({})
  const paidUntil = new Date(now + DAY)
  await servers.insertOne({ server_id: 'mm1', do_droplet_id: 801, status: 'active', expires_at: new Date(now - 60000) })
  await plans.insertOne({ _id: 'p-mm1', vpsId: 'rdp-mm1', contaboInstanceId: 'rdp-mm1', chatId: '1', status: 'RUNNING', end_time: paidUntil })
  await svc.processExpiries()
  const s1 = await servers.findOne({ server_id: 'mm1' })
  ok('paid until tomorrow → NOT powered off', s1.status === 'active' && !fake.calls.some(c => c.type === 'power_off'), s1.status)
  ok('expires_at synced to end_time', new Date(s1.expires_at).getTime() === paidUntil.getTime())
  ok('vpsPlansOf untouched (RUNNING)', (await plans.findOne({ _id: 'p-mm1' })).status === 'RUNNING')

  // D2 — both past → normal grace (regression).
  resetDO(); seedDroplet(802)
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'mm2', do_droplet_id: 802, status: 'active', expires_at: new Date(now - 60000) })
  await plans.insertOne({ _id: 'p-mm2', vpsId: 'rdp-mm2', contaboInstanceId: 'rdp-mm2', chatId: '2', status: 'RUNNING', end_time: new Date(now - 30000) })
  await svc.processExpiries()
  ok('end_time also past → expired + powered off', (await servers.findOne({ server_id: 'mm2' })).status === 'expired' && fake.calls.some(c => c.type === 'power_off'))
  ok('vpsPlansOf → EXPIRED_GRACE', (await plans.findOne({ _id: 'p-mm2' })).status === 'EXPIRED_GRACE')

  // D3 — reseller record (RDP id in `instanceId`) is mirrored too.
  resetDO(); seedDroplet(803)
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'rs3', do_droplet_id: 803, status: 'active', expires_at: new Date(now - 60000) })
  await plans.insertOne({ _id: 'uuid-rs3', vpsId: 'uuid-rs3', instanceId: 'rdp-rs3', provider: 'digitalocean-rdp', chatId: '3', status: 'RUNNING', end_time: new Date(now - 60000) })
  await svc.processExpiries()
  ok('reseller record mirrored → EXPIRED_GRACE', (await plans.findOne({ _id: 'uuid-rs3' })).status === 'EXPIRED_GRACE')

  // D4 — droplet deleted outside the bot → destroyed + DELETED + admin alert.
  resetDO(); alerts.length = 0
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: '60811b81-70e9-47d8-807c-c5dc8616423c', do_droplet_id: 605654801, status: 'active', ip_address: '164.90.171.80', expires_at: new Date(now + 10 * DAY), region: 'fra1', tier_slug: 'power', os_id: 'ws2022' })
  await plans.insertOne({ _id: 'p-gone', vpsId: 'rdp-60811b81-70e9-47d8-807c-c5dc8616423c', contaboInstanceId: 'rdp-60811b81-70e9-47d8-807c-c5dc8616423c', chatId: '7706803914', status: 'RUNNING', end_time: new Date(now + 11 * DAY), planPrice: 156 })
  await svc.processExpiries()
  const g = await servers.findOne({ server_id: '60811b81-70e9-47d8-807c-c5dc8616423c' })
  ok('vanished droplet → doRdpServers destroyed / droplet_gone_external', g.status === 'destroyed' && g.destroy_reason === 'droplet_gone_external' && g.gone_droplet_id === 605654801 && g.do_droplet_id === null)
  ok('vanished droplet → GET checked twice before acting', fake.calls.filter(c => c.m === 'GET' && c.u === '/droplets/605654801').length === 2)
  const gp = await plans.findOne({ _id: 'p-gone' })
  ok('vanished droplet → vpsPlansOf DELETED', gp.status === 'DELETED' && gp.cancelReason === 'droplet_gone_external')
  ok('admin alerted with customer chat + paid-until', alerts.some(t => t.includes('7706803914') && t.includes('deleted outside the bot')), alerts.join(' | '))
  ok('no DELETE / power action sent for a gone box', !fake.calls.some(c => c.m !== 'GET'))

  // D5 — DO API error (500) is NOT treated as gone.
  resetDO(); fake.getStatus = 500; alerts.length = 0
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'blip', do_droplet_id: 999, status: 'active', expires_at: new Date(now + DAY) })
  await svc.processExpiries()
  ok('DO 500 → box left active, no alert', (await servers.findOne({ server_id: 'blip' })).status === 'active' && alerts.length === 0)

  // D6 — live droplet untouched; already-destroyed rows not re-checked.
  resetDO(); seedDroplet(1001)
  await servers.deleteMany({})
  await servers.insertMany([
    { server_id: 'live', do_droplet_id: 1001, status: 'active', expires_at: new Date(now + DAY) },
    { server_id: 'dead', do_droplet_id: null, status: 'destroyed' },
    { server_id: 'prov', do_droplet_id: 1002, status: 'provisioning' },
  ])
  await svc.processExpiries()
  ok('live droplet stays active', (await servers.findOne({ server_id: 'live' })).status === 'active')
  ok('provisioning row not judged by the vanished check', (await servers.findOne({ server_id: 'prov' })).status === 'provisioning' && !fake.calls.some(c => c.u === '/droplets/1002'))
}

async function main() {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017')
  await client.connect()
  const db = client.db('rdp_lifecycle_fix_test')
  try {
    partA()
    await partB()
    await partC(db)
    await partD(db)
  } catch (e) { fail++; console.log('  ❌ EXCEPTION:', e.stack || e.message) } finally { await db.dropDatabase().catch(() => {}); await client.close() }
  console.log(`\n${fail === 0 ? '✅' : '❌'} RDP lifecycle fixes: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
