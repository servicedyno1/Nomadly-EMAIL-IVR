// DO-RDP 3-day grace auto-destroy — unit test (NO real droplet).
// ------------------------------------------------------------------
// Three parts:
//   A) rdp-grace-lifecycle.js — the pure state machine (decideRdpGrace) and the
//      side-effecting executor (applyRdpGrace) driven with spies. This is the path
//      the bot VPS scheduler runs (it OWNS the DO-RDP grace lifecycle + Telegram notices).
//   B) digitalocean-rdp-service.js — the SAFETY-NET processExpiries() sweep + renewInstance,
//      exercised against a FAKE DigitalOcean API (axios stubbed) + an isolated local MongoDB.
//   C) locale-key parity — rdpGraceStart / rdpGraceReminder / rdpDeletedAfterGrace in en/fr/zh/hi.
//
//   node js/tests/test_rdp_grace_destroy_2026-06.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const http = require('http')
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const DAY = 86400000

// ── Fake DigitalOcean API (stub axios BEFORE the service is required) ──
const fake = { droplets: {}, actions: {}, nextId: 9000, calls: [] }
function resetDO() { fake.droplets = {}; fake.actions = {}; fake.nextId = 9000; fake.calls = [] }
function seedDroplet(id) { fake.droplets[id] = { id, status: 'active', networks: { v4: [{ type: 'public', ip_address: '127.0.0.1' }] } } }
async function fakeDO({ method, url, data }) {
  const m = method.toUpperCase()
  const u = url.replace('https://api.digitalocean.com/v2', '')
  fake.calls.push({ m, u, type: data && data.type })
  let mt
  if (m === 'POST' && (mt = u.match(/^\/droplets\/(\d+)\/actions$/))) {
    if (!fake.droplets[mt[1]]) return { status: 404, data: { message: 'not found' } }
    const id = fake.nextId++; fake.actions[id] = { id, status: 'completed', type: data.type }
    return { status: 201, data: { action: fake.actions[id] } }
  }
  if (m === 'DELETE' && (mt = u.match(/^\/droplets\/(\d+)$/))) {
    if (!fake.droplets[mt[1]]) return { status: 404, data: { message: 'not found' } }
    delete fake.droplets[mt[1]]; return { status: 204, data: '' }
  }
  if (m === 'GET' && (mt = u.match(/^\/droplets\/(\d+)$/))) {
    const d = fake.droplets[mt[1]]; return d ? { status: 200, data: { droplet: d } } : { status: 404, data: { message: 'not found' } }
  }
  return { status: 500, data: { message: `unstubbed ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
require(axiosPath)
const realAxios = require.cache[axiosPath].exports
require.cache[axiosPath].exports = fakeDO

process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
process.env.RDP_GRACE_DAYS = '3'

const grace = require('../rdp-grace-lifecycle.js')
const svc = require('../digitalocean-rdp-service.js')
Object.assign(svc._timing, { offPoll: 20, actionPoll: 20 })
const { translation } = require('../translation.js')
const webhooks = require('../reseller-webhooks.js')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const TEST_DB = 'rdp_grace_test'

// A recording spy factory.
function spy(impl) {
  const fn = (...args) => { fn.calls.push(args); return impl ? impl(...args) : undefined }
  fn.calls = []
  return fn
}
function makeDeps(now, over = {}) {
  return {
    now,
    powerOff: spy(() => Promise.resolve()),
    destroy: spy(() => Promise.resolve({ success: true })),
    updatePlan: spy(() => Promise.resolve()),
    mirrorGrace: spy(() => Promise.resolve()),
    mirrorDestroy: spy(() => Promise.resolve()),
    notifyUser: spy(),
    notifyReseller: spy(),
    notifyAdmin: spy(),
    log: () => {},
    ...over,
  }
}

async function partA() {
  console.log('\n── Part A: rdp-grace-lifecycle state machine ──')
  const G = grace.GRACE_DAYS
  ok('GRACE_DAYS reads RDP_GRACE_DAYS (=3)', G === 3, `got ${G}`)
  ok('REMINDER_LEAD_HOURS default 24 (configurable via env)', grace.REMINDER_LEAD_HOURS === 24 && grace.REMINDER_LEAD_MS === 24 * 3600000, `got ${grace.REMINDER_LEAD_HOURS}`)

  // isDigitalOceanRdp
  ok('isDigitalOceanRdp true for provider=digitalocean-rdp', grace.isDigitalOceanRdp({ provider: 'digitalocean-rdp' }) === true)
  ok('isDigitalOceanRdp true for rdp- prefixed instanceId', grace.isDigitalOceanRdp({ contaboInstanceId: 'rdp-abc123' }) === true)
  ok('isDigitalOceanRdp false for contabo record', grace.isDigitalOceanRdp({ provider: 'contabo', contaboInstanceId: '12345' }) === false)

  const now = new Date('2026-06-15T00:00:00Z')

  // a1 — active subscription just past end_time → enter_grace
  const ended = { provider: 'digitalocean-rdp', _id: 'p1', vpsId: 'rdp-p1', chatId: '111', status: 'RUNNING', end_time: new Date(now.getTime() - 60000) }
  const d1 = grace.decideRdpGrace(ended, { now })
  ok('active past end_time → enter_grace', d1.action === 'enter_grace', d1.action)
  ok('enter_grace grace_until = end + 3d', d1.grace_until && Math.abs(d1.grace_until.getTime() - (ended.end_time.getTime() + 3 * DAY)) < 1000)
  ok('enter_grace sets expired_at', !!d1.expired_at)

  // a2 — not yet expired → none
  const future = { provider: 'digitalocean-rdp', _id: 'p2', vpsId: 'rdp-p2', status: 'RUNNING', end_time: new Date(now.getTime() + 5 * DAY) }
  ok('subscription not expired → none', grace.decideRdpGrace(future, { now }).action === 'none')

  // a3 — in grace, deadline far away → wait
  const inGrace = { provider: 'digitalocean-rdp', _id: 'p3', vpsId: 'rdp-p3', status: 'EXPIRED_GRACE', expired_at: new Date(now.getTime() - 1 * DAY), grace_until: new Date(now.getTime() + 2 * DAY) }
  ok('in grace, deadline far → wait', grace.decideRdpGrace(inGrace, { now }).action === 'wait')

  // a4 — in grace, within 24h of deadline, no reminder yet → remind
  const remindable = { provider: 'digitalocean-rdp', _id: 'p4', vpsId: 'rdp-p4', status: 'EXPIRED_GRACE', grace_until: new Date(now.getTime() + 12 * 3600000) }
  ok('within 24h of deadline → remind', grace.decideRdpGrace(remindable, { now }).action === 'remind')
  ok('remind suppressed once _graceReminderSent', grace.decideRdpGrace({ ...remindable, _graceReminderSent: true }, { now }).action === 'wait')

  // a5 — grace elapsed → destroy
  const overdue = { provider: 'digitalocean-rdp', _id: 'p5', vpsId: 'rdp-p5', status: 'EXPIRED_GRACE', grace_until: new Date(now.getTime() - 3600000) }
  ok('grace elapsed → destroy', grace.decideRdpGrace(overdue, { now }).action === 'destroy')

  // a6 — already cancelled → none
  ok('already CANCELLED → none', grace.decideRdpGrace({ provider: 'digitalocean-rdp', status: 'CANCELLED', grace_until: new Date(now.getTime() - DAY) }, { now }).action === 'none')

  // ── applyRdpGrace side-effects ──
  // b1 enter_grace
  const dep1 = makeDeps(now)
  await grace.applyRdpGrace(ended, grace.decideRdpGrace(ended, { now }), dep1)
  ok('enter_grace: powerOff called with instanceId', dep1.powerOff.calls.length === 1 && dep1.powerOff.calls[0][0] === 'rdp-p1')
  const setArg = dep1.updatePlan.calls[0] && dep1.updatePlan.calls[0][1]
  ok('enter_grace: updatePlan status=EXPIRED_GRACE + grace fields', setArg && setArg.status === 'EXPIRED_GRACE' && setArg.expired_at && setArg.grace_until && setArg._graceReminderSent === false)
  ok('enter_grace: mirrorGrace called', dep1.mirrorGrace.calls.length === 1)
  ok('enter_grace: notifyUser(rdpGraceStart) fired', dep1.notifyUser.calls.length === 1 && dep1.notifyUser.calls[0][1] === 't.rdpGraceStart' && dep1.notifyUser.calls[0][0] === '111')
  ok('enter_grace: notifyReseller(rdp.grace_start) fired', dep1.notifyReseller.calls.length === 1 && dep1.notifyReseller.calls[0][0] === 'rdp.grace_start' && dep1.notifyReseller.calls[0][1].delete_at)
  ok('enter_grace: does NOT destroy', dep1.destroy.calls.length === 0)

  // b2 remind
  const dep2 = makeDeps(now)
  await grace.applyRdpGrace(remindable, grace.decideRdpGrace(remindable, { now }), dep2)
  ok('remind: updatePlan sets _graceReminderSent=true', dep2.updatePlan.calls[0] && dep2.updatePlan.calls[0][1]._graceReminderSent === true)
  ok('remind: notifyUser(rdpGraceReminder) fired', dep2.notifyUser.calls.length === 1 && dep2.notifyUser.calls[0][1] === 't.rdpGraceReminder')

  // b3 destroy success
  const overduePlan = { ...overdue, _id: 'p5', vpsId: 'rdp-p5', chatId: '222' }
  const dep3 = makeDeps(now)
  await grace.applyRdpGrace(overduePlan, grace.decideRdpGrace(overduePlan, { now }), dep3)
  ok('destroy: destroy(chatId, vpsId) called', dep3.destroy.calls.length === 1 && dep3.destroy.calls[0][0] === '222' && dep3.destroy.calls[0][1] === 'rdp-p5')
  ok('destroy: updatePlan CANCELLED + cancelReason=expired_grace', dep3.updatePlan.calls[0] && dep3.updatePlan.calls[0][1].status === 'CANCELLED' && dep3.updatePlan.calls[0][1].cancelReason === 'expired_grace')
  ok('destroy: mirrorDestroy called', dep3.mirrorDestroy.calls.length === 1)
  ok('destroy: notifyUser(rdpDeletedAfterGrace) fired', dep3.notifyUser.calls.length === 1 && dep3.notifyUser.calls[0][1] === 't.rdpDeletedAfterGrace')
  ok('destroy: notifyReseller(rdp.deleted) fired', dep3.notifyReseller.calls.length === 1 && dep3.notifyReseller.calls[0][0] === 'rdp.deleted' && dep3.notifyReseller.calls[0][1].reason === 'expired_grace')

  // b4 destroy failure → admin alert + retry counter, NO user "deleted" notice
  const dep4 = makeDeps(now, { destroy: spy(() => Promise.resolve({ success: false, error: 'DO 500' })) })
  await grace.applyRdpGrace(overduePlan, grace.decideRdpGrace(overduePlan, { now }), dep4)
  ok('destroy fail: no rdpDeletedAfterGrace to user', dep4.notifyUser.calls.length === 0)
  ok('destroy fail: admin alerted on attempt 1', dep4.notifyAdmin.calls.length === 1)
  ok('destroy fail: updatePlan deleteRetryCount=1', dep4.updatePlan.calls.some(c => c[1].deleteRetryCount === 1))

  // b5 runRdpGracePass skips non-RDP records
  const dep5 = makeDeps(now)
  const out = await grace.runRdpGracePass([ended, { provider: 'contabo', _id: 'c1', vpsId: 'c1', status: 'RUNNING', end_time: new Date(now.getTime() - DAY) }], dep5)
  ok('runRdpGracePass: non-RDP record skipped', out.some(r => r.action === 'skip_not_rdp'))
  ok('runRdpGracePass: DO-RDP record entered grace', out.some(r => r.action === 'enter_grace'))
}

async function partB(db) {
  console.log('\n── Part B: RDP-service safety-net sweep + renewInstance ──')
  const servers = db.collection('doRdpServers')
  const plans = db.collection('vpsPlansOf')
  ok('init(db) succeeds', svc.init(db) === true)
  await sleep(30)

  const now = Date.now()

  // ---- Sweep-1: active + past expiry → power off + enter grace (+ mirror) ----
  resetDO(); seedDroplet(101)
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'sw1', do_droplet_id: 101, status: 'active', expires_at: new Date(now - 60000), duration_months: 1, volume_id: null })
  await plans.insertOne({ _id: 'vp1', vpsId: 'rdp-sw1', contaboInstanceId: 'rdp-sw1', chatId: '1', isRDP: true, status: 'RUNNING', end_time: new Date(now - 60000) })
  await svc.processExpiries()
  let s1 = await servers.findOne({ server_id: 'sw1' })
  ok('Sweep-1: doRdpServers → expired', s1.status === 'expired', s1.status)
  ok('Sweep-1: expired_at set', !!s1.expired_at)
  ok('Sweep-1: grace_until = expires_at + 3d', s1.grace_until && Math.abs(new Date(s1.grace_until).getTime() - (new Date(s1.expires_at).getTime() + 3 * DAY)) < 2000)
  ok('Sweep-1: power_off action sent to DO', fake.calls.some(c => c.type === 'power_off'))
  let vp1 = await plans.findOne({ _id: 'vp1' })
  ok('Sweep-1: vpsPlansOf mirrored → EXPIRED_GRACE', vp1.status === 'EXPIRED_GRACE' && !!vp1.grace_until)
  ok('Sweep-1: droplet NOT destroyed (still in grace)', !!fake.droplets[101])

  // ---- In grace but deadline not reached → NOT destroyed by Sweep-2 ----
  resetDO(); seedDroplet(102)
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'sw2', do_droplet_id: 102, status: 'expired', expired_at: new Date(now - DAY), grace_until: new Date(now + 2 * DAY), volume_id: null })
  await svc.processExpiries()
  let s2 = await servers.findOne({ server_id: 'sw2' })
  ok('In-grace (deadline future): still expired, not destroyed', s2.status === 'expired')
  ok('In-grace: droplet survives', !!fake.droplets[102])
  ok('In-grace: no DELETE issued', !fake.calls.some(c => c.m === 'DELETE'))

  // ---- Sweep-2: grace elapsed → DESTROY (safety net) + mirror ----
  resetDO(); seedDroplet(103)
  await servers.deleteMany({}); await plans.deleteMany({})
  await servers.insertOne({ server_id: 'sw3', do_droplet_id: 103, status: 'expired', expired_at: new Date(now - 4 * DAY), grace_until: new Date(now - DAY), volume_id: null })
  await plans.insertOne({ _id: 'vp3', vpsId: 'rdp-sw3', contaboInstanceId: 'rdp-sw3', chatId: '3', isRDP: true, status: 'EXPIRED_GRACE', end_time: new Date(now - 4 * DAY), grace_until: new Date(now - DAY) })
  await svc.processExpiries()
  let s3 = await servers.findOne({ server_id: 'sw3' })
  ok('Sweep-2: doRdpServers → destroyed', s3.status === 'destroyed', s3.status)
  ok('Sweep-2: destroy_reason = expired_grace', s3.destroy_reason === 'expired_grace')
  ok('Sweep-2: droplet deleted at DO (404)', !fake.droplets[103])
  ok('Sweep-2: DELETE /droplets sent', fake.calls.some(c => c.m === 'DELETE'))
  let vp3 = await plans.findOne({ _id: 'vp3' })
  ok('Sweep-2: vpsPlansOf mirrored → CANCELLED + expired_grace', vp3.status === 'CANCELLED' && vp3.cancelReason === 'expired_grace')

  // ---- renewInstance clears grace + reactivates ----
  resetDO(); seedDroplet(104)
  await servers.deleteMany({})
  await servers.insertOne({ server_id: 'rn1', do_droplet_id: 104, status: 'expired', expires_at: new Date(now - DAY), expired_at: new Date(now - DAY), grace_until: new Date(now + DAY), volume_id: null })
  const r = await svc.renewInstance('rn1', 1)
  let rn = await servers.findOne({ server_id: 'rn1' })
  ok('renew: expires_at extended ~30d', rn.expires_at && new Date(rn.expires_at).getTime() > now + 25 * DAY)
  ok('renew: expired_at cleared', rn.expired_at === null)
  ok('renew: grace_until cleared', rn.grace_until === null)
  ok('renew: status back to active', rn.status === 'active')
  ok('renew: power_on action sent', fake.calls.some(c => c.type === 'power_on'))
  ok('renew: returns extended expiry', !!(r && r.expires_at))

  // ---- markGrace / markGraceDestroy helpers ----
  resetDO()
  await servers.deleteMany({})
  await servers.insertOne({ server_id: 'mg1', do_droplet_id: null, status: 'active', volume_id: null })
  const gd = new Date(now + 3 * DAY)
  await svc.markGrace('mg1', { expired_at: new Date(now), grace_until: gd })
  let mg = await servers.findOne({ server_id: 'mg1' })
  ok('markGrace: status=expired + grace fields set', mg.status === 'expired' && !!mg.expired_at && !!mg.grace_until)
  await svc.markGraceDestroy('mg1')
  mg = await servers.findOne({ server_id: 'mg1' })
  ok('markGraceDestroy: status=destroyed + expired_grace', mg.status === 'destroyed' && mg.destroy_reason === 'expired_grace')
}

function partC() {
  console.log('\n── Part C: locale-key parity (en/fr/zh/hi) ──')
  const langs = ['en', 'fr', 'zh', 'hi']
  for (const lang of langs) {
    for (const key of ['rdpGraceStart', 'rdpGraceReminder']) {
      const s = translation(`t.${key}`, lang, 'MyRDP', '2026-07-01')
      ok(`${lang}.${key} renders`, typeof s === 'string' && s.length > 5 && s !== `t.${key}` && s.includes('MyRDP'), s)
    }
    const del = translation('t.rdpDeletedAfterGrace', lang, 'MyRDP')
    ok(`${lang}.rdpDeletedAfterGrace renders`, typeof del === 'string' && del.length > 5 && del !== 't.rdpDeletedAfterGrace' && del.includes('MyRDP'), del)
  }
}

async function partD(db) {
  console.log('\n── Part D: reseller push webhooks (emit + dedup + delivery) ──')
  require.cache[axiosPath].exports = realAxios // real HTTP for the local capture server
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { try { received.push(JSON.parse(body)) } catch (_) { received.push(body) } ; res.writeHead(200); res.end('ok') })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/hook`

  const keys = db.collection('resellerApiKeys')
  const deliveries = db.collection('resellerWebhookDeliveries')
  await keys.deleteMany({ _id: { $in: ['wh-key-1', 'wh-key-nourl'] } })
  await deliveries.deleteMany({})
  await keys.insertOne({ _id: 'wh-key-1', ownerChatId: '777', enabled: true, webhookUrl: url })
  await keys.insertOne({ _id: 'wh-key-nourl', ownerChatId: '777', enabled: true })

  // First emit → delivered once.
  const r1 = await webhooks.emit(db, { chatId: '777', event: 'rdp.grace_start', instanceId: 'rdp-wh1', payload: { plan: 'Standard', delete_at: '2026-07-01T00:00:00Z' } })
  await sleep(100)
  ok('webhook: delivered exactly once to the key with a URL', r1.delivered === 1, JSON.stringify(r1))
  ok('webhook: POST body carries event + data.id', received.length === 1 && received[0].event === 'rdp.grace_start' && received[0].data && received[0].data.id === 'rdp-wh1')

  // Second emit for the SAME (key,event,instance) → deduped, no second POST.
  const r2 = await webhooks.emit(db, { chatId: '777', event: 'rdp.grace_start', instanceId: 'rdp-wh1', payload: {} })
  await sleep(50)
  ok('webhook: duplicate (key,event,instance) is NOT re-sent', r2.delivered === 0 && received.length === 1, JSON.stringify(r2))

  // A different event on the same instance IS sent.
  const r3 = await webhooks.emit(db, { chatId: '777', event: 'rdp.deleted', instanceId: 'rdp-wh1', payload: { reason: 'expired_grace' } })
  await sleep(100)
  ok('webhook: a different event IS delivered', r3.delivered === 1 && received.length === 2 && received[1].event === 'rdp.deleted')

  // No keys for an unknown owner → no-op.
  const r4 = await webhooks.emit(db, { chatId: 'nobody', event: 'rdp.deleted', instanceId: 'x' })
  ok('webhook: owner with no keys → no-op', r4.delivered === 0 && r4.skipped === 0)

  // isHttpUrl validation
  ok('webhook: isHttpUrl accepts https, rejects junk', webhooks.isHttpUrl('https://a.com') && !webhooks.isHttpUrl('ftp://a') && !webhooks.isHttpUrl('not-a-url'))

  await keys.deleteMany({ _id: { $in: ['wh-key-1', 'wh-key-nourl'] } })
  await new Promise(r => server.close(r))
}

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(TEST_DB)
  try {
    await partA()
    await partB(db)
    partC()
    await partD(db)
  } catch (e) {
    fail++; console.log('  ❌ EXCEPTION:', e.stack || e.message)
  } finally {
    await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} RDP grace-destroy suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
