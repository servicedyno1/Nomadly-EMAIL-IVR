// "Show Password" always reveals the password Windows really uses (DO RDP, 2026-10-15).
// Fake DO API + isolated local MongoDB + the real provision router (callback / agent result) over HTTP.
//   node js/tests/test_rdp_password_truth_2026-10.js
const path = require('path')
const fs = require('fs')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }

const fake = { calls: [] }
async function fakeDO({ method, url, data }) {
  const m = method.toUpperCase(), u = url.replace('https://api.digitalocean.com/v2', '')
  fake.calls.push({ m, u, type: data && data.type })
  if (m === 'POST' && /^\/droplets\/\d+\/actions$/.test(u)) return { status: 201, data: { action: { id: 77, status: 'in-progress', type: data.type } } }
  if (m === 'GET' && /^\/actions\/\d+$/.test(u)) return { status: 200, data: { action: { id: 77, status: 'in-progress' } } }
  if (m === 'GET' && /^\/droplets\/\d+$/.test(u)) return { status: 200, data: { droplet: { id: 1, status: 'active', networks: { v4: [] } } } }
  return { status: 500, data: { message: `unstubbed ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
require(axiosPath)
require.cache[axiosPath].exports = fakeDO
process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'

const secretStore = require('../vps-secret-store')
const svc = require('../digitalocean-rdp-service.js')
Object.assign(svc._timing, { actionPoll: 60000, commandPoll: 20 })
const { revealVpsPassword } = require('../vps-password-reveal')
const MIN = 60000

async function main() {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017')
  await client.connect()
  const db = client.db('rdp_password_truth_test')
  await db.dropDatabase()
  const servers = db.collection('doRdpServers'), plans = db.collection('vpsPlansOf')
  const alerts = []
  secretStore.initSecretStore(db)
  svc.init(db, { notifyAdmin: (t) => alerts.push(t) })
  await new Promise(r => setTimeout(r, 50))
  await db.collection('doRdpOsOptions').updateOne({ _id: 'ws2022' }, { $set: { golden_status: 'available', golden_image_id: 999, golden_regions: ['fra1'] } }, { upsert: true })

  const express = require('express')
  const app = express(); app.use('/provision', svc.provisionRouter())
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}/provision`
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status)

  const mkServer = async (id, extra = {}) => {
    await servers.insertOne({ server_id: id, status: 'active', do_droplet_id: 5001, ip_address: '10.0.0.1', region: 'fra1', os_id: 'ws2022', tier_slug: 'power', callback_token: `tok-${id}`, password_confirmed: true, commands: [], logs: [], agent_seen_at: new Date(), ...extra })
  }
  try {
    console.log('\n── passwordStatus basics ──')
    await mkServer('s-ok')
    ok('confirmed box → confirmed', (await svc.passwordStatus('rdp-s-ok')).state === 'confirmed')
    await mkServer('s-boot', { status: 'booting', password_confirmed: null, eta_minutes: 4 })
    const st1 = await svc.passwordStatus('rdp-s-boot')
    ok('still provisioning → applying (+eta)', st1.state === 'applying' && st1.etaMinutes === 4, JSON.stringify(st1))
    await mkServer('s-fail', { password_confirmed: false })
    ok('password_failed at setup → failed', (await svc.passwordStatus('rdp-s-fail')).state === 'failed')
    await mkServer('s-legacy', { password_confirmed: undefined })
    ok('legacy record → unknown', (await svc.passwordStatus('rdp-s-legacy')).state === 'unknown')
    ok('no record → unknown', (await svc.passwordStatus('rdp-nope')).state === 'unknown')

    console.log('\n── reinstall: new password does NOT land (agent fails) ──')
    await mkServer('r1')
    await secretStore.putSecret('r1', 'Orig#Pw-1', {})
    await secretStore.putSecret('pwd-u1-old', 'Orig#Pw-1', {})
    await plans.insertOne({ _id: 'p-r1', chatId: '11', vpsId: 'rdp-r1', contaboInstanceId: 'rdp-r1', provider: 'digitalocean-rdp', isRDP: true, osType: 'Windows', rootPasswordSecretId: 'pwd-u1-old', status: 'RUNNING' })
    await secretStore.putSecret('pwd-u1-new', 'New#Pw-2', {})
    const re = await svc.reinstallInstance('rdp-r1', { osId: 'ws2022', rootPassword: 'pwd-u1-new' })
    ok('reinstall started with the new password', re.success && re.password === 'New#Pw-2', JSON.stringify(re))
    await plans.updateOne({ _id: 'p-r1' }, { $set: { rootPasswordSecretId: re.secretId } }) // what the bot's reinstall event does
    ok('older server: create-time password kept as boot secret', (await secretStore.getSecretPassword('r1:boot')) === 'Orig#Pw-1')
    let r1 = await servers.findOne({ server_id: 'r1' })
    ok('reinstall remembers its set_password command', r1.reinstall_password_cmd && r1.commands.some(c => c.id === r1.reinstall_password_cmd && c.status === 'pending'))
    ok('during the rebuild → applying', (await svc.passwordStatus('rdp-r1')).state === 'applying')
    ok('rdp_ready callback accepted', (await post('/callback', { server_id: 'r1', token: 'tok-r1', stage: 'rdp_ready', progress: 100 })) === 200)
    r1 = await servers.findOne({ server_id: 'r1' })
    ok('rdp_ready with password still queued → boot_password_applied_at set, NOT confirmed', r1.boot_password_applied_at && r1.password_confirmed !== true)
    ok('agent window (<10 min) → applying', (await svc.passwordStatus('rdp-r1')).state === 'applying')
    await servers.updateOne({ server_id: 'r1' }, { $set: { boot_password_applied_at: new Date(Date.now() - 15 * MIN) } })
    const st2 = await svc.passwordStatus('rdp-r1')
    ok('agent silent for 15 min → boot, reveals the ORIGINAL password', st2.state === 'boot' && st2.password === 'Orig#Pw-1', JSON.stringify(st2))
    alerts.length = 0
    ok('agent reports set_password FAILED', (await post('/commands/result', { server_id: 'r1', token: 'tok-r1', id: r1.reinstall_password_cmd, ok: false, message: 'access denied' })) === 200)
    secretStore._clearCache()
    ok('server secret reverted to the password Windows kept', (await secretStore.getSecretPassword('r1')) === 'Orig#Pw-1')
    ok("plan's secret reverted too (Show Password + reseller credentials)", (await secretStore.getSecretPassword('pwd-u1-new')) === 'Orig#Pw-1')
    ok('box now confirmed (on the original password)', (await svc.passwordStatus('rdp-r1')).state === 'confirmed')
    ok('admin alerted about the revert', alerts.some(t => t.includes('Windows kept the original password')), alerts.join(' | '))
    const plan = await plans.findOne({ _id: 'p-r1' })
    const shown = await revealVpsPassword(plan, {})
    ok('Show Password resolver returns the working (original) password', shown.status === 'ok' && shown.password === 'Orig#Pw-1', JSON.stringify(shown))

    console.log('\n── reinstall: new password lands (agent ok) ──')
    await mkServer('r2')
    await secretStore.putSecret('r2', 'Orig#Pw-A', {})
    const re2 = await svc.reinstallInstance('rdp-r2', { osId: 'ws2022' })
    await post('/callback', { server_id: 'r2', token: 'tok-r2', stage: 'rdp_ready', progress: 100 })
    const r2 = await servers.findOne({ server_id: 'r2' })
    await post('/commands/result', { server_id: 'r2', token: 'tok-r2', id: r2.reinstall_password_cmd, ok: true, message: 'password applied (ADSI)' })
    secretStore._clearCache()
    ok('agent ok → confirmed', (await svc.passwordStatus('rdp-r2')).state === 'confirmed')
    ok('stored password = the new one', (await secretStore.getSecretPassword('r2')) === re2.password && re2.password !== 'Orig#Pw-A')
    ok('boot secret still the create-time one (for the next reinstall)', (await secretStore.getSecretPassword('r2:boot')) === 'Orig#Pw-A')

    console.log('\n── older server already reset in place: original unknown ──')
    await mkServer('r3', { password_reset_at: new Date(Date.now() - 86400000) })
    await secretStore.putSecret('r3', 'Reset#Pw-9', {})
    await svc.reinstallInstance('rdp-r3', { osId: 'ws2022' })
    ok('no boot secret invented (create-time password unknown)', !(await secretStore.getSecretPassword('r3:boot')))
    await post('/callback', { server_id: 'r3', token: 'tok-r3', stage: 'rdp_ready', progress: 100 })
    const r3 = await servers.findOne({ server_id: 'r3' })
    alerts.length = 0
    await post('/commands/result', { server_id: 'r3', token: 'tok-r3', id: r3.reinstall_password_cmd, ok: false, message: 'boom' })
    ok('failure → admin told the original is unknown (no fake revert)', alerts.some(t => t.includes('original one is unknown')), alerts.join(' | '))
    ok('…and nothing reverted / confirmed', (await servers.findOne({ server_id: 'r3' })).password_confirmed !== true)

    console.log('\n── in-place reset failure never reverts ──')
    await mkServer('r4')
    await secretStore.putSecret('r4', 'Keep#Pw', {})
    await servers.updateOne({ server_id: 'r4' }, { $push: { commands: { id: 'manual1', type: 'set_password', payload: { password: 'x' }, status: 'pending', created_at: new Date() } } })
    await post('/commands/result', { server_id: 'r4', token: 'tok-r4', id: 'manual1', ok: false, message: 'denied' })
    ok('reset command failure leaves the stored password alone', (await secretStore.getSecretPassword('r4')) === 'Keep#Pw' && (await servers.findOne({ server_id: 'r4' })).password_confirmed === true)

    console.log('\n── wiring + copy ──')
    const svcSrc = fs.readFileSync(path.join(__dirname, '../digitalocean-rdp-service.js'), 'utf8')
    ok('createInstance stores the boot secret', /putSecret\(bootSecretId\(serverId\), adminPassword/.test(svcSrc))
    ok('cancel deletes the boot secret', /deleteSecret\(bootSecretId\(id\)\)/.test(svcSrc))
    const idx = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
    const h = idx.slice(idx.indexOf('revealVpsPassword: async () => {'), idx.indexOf('confirmReinstallWindows: async () => {'))
    ok('bot handler consults passwordStatus for DO RDP', /passwordStatus\(record\.contaboInstanceId \|\| record\.instanceId/.test(h))
    ok("bot handler: 'failed' → revealPasswordNotApplied (no wrong password shown)", /rdpPw\?\.state === 'failed'[\s\S]{0,300}revealPasswordNotApplied\(record\.name\)/.test(h))
    ok("bot handler: 'boot' → shows the working password", /rdpPw\?\.state === 'boot' && rdpPw\.password\) Object\.assign\(res, \{ status: 'ok', password: rdpPw\.password/.test(h))
    ok('bot handler passes rdpState + eta to the template', /rdpState: rdpPw\?\.state, etaMinutes: rdpPw\?\.etaMinutes/.test(h))
    for (const l of ['en', 'fr', 'zh', 'hi']) {
      const vp = require(`../lang/${l}.js`)[l].vp
      const lines = ['confirmed', 'applying', 'boot'].map(st => vp.revealPasswordSuccess('box', '1.2.3.4', 'Administrator', 'Pw#1', { isRDP: true, rdpState: st, etaMinutes: 4 }))
      const plain = vp.revealPasswordSuccess('box', '1.2.3.4', 'Administrator', 'Pw#1', { isRDP: true })
      ok(`${l}: 3 RDP states add distinct notes; no state = unchanged copy`, new Set(lines).size === 3 && lines.every(t => t.length > plain.length && t.includes('<code>Pw#1</code>')) && lines[1].includes('4'))
      ok(`${l}: revealPasswordNotApplied names the box + Reset Password, no password`, /box/.test(vp.revealPasswordNotApplied('box')) && /🔑/.test(vp.revealPasswordNotApplied('box')) && !/<code>/.test(vp.revealPasswordNotApplied('box')))
    }
  } catch (e) { fail++; console.log('  ❌ EXCEPTION:', e.stack || e.message) } finally {
    srv.close(); await db.dropDatabase().catch(() => {}); await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} RDP password truth: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
