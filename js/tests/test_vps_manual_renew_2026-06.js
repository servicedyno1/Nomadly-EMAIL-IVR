// renewVPSPlan (manual renew) with fake providers + throwaway Mongo — T1 iteration 131.
process.env.SKIP_WEBHOOK_SYNC = 'true'
const { MongoClient } = require('mongodb')
const fs = require('fs')
const path = require('path')
const vpsProvider = require('../vps-provider')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const DAY = 86400000
const calls = { start: [], renew: [] }
const fake = { startInstance: async (i) => calls.start.push(i), renewInstance: async (i, m) => calls.renew.push([i, m]) }
vpsProvider.getProviderForRecord = () => fake

;(async () => {
  const vm = require('../vm-instance-setup')
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('vps_manual_renew_t1_' + Date.now())
  try {
    vm.initVpsDb(db)
    const col = db.collection('vpsPlansOf')
    const now = Date.now()
    await col.insertMany([
      { _id: 'a', vpsId: 'a', chatId: '1', provider: 'digitalocean', contaboInstanceId: 'do-1', status: 'RUNNING', end_time: new Date(now + 5 * DAY), _autoRenewAttempted: true, _renewLockUntil: new Date(now + 60000) },
      { _id: 'b', vpsId: 'b', chatId: '1', provider: 'digitalocean', contaboInstanceId: 'do-2', status: 'EXPIRED_GRACE', end_time: new Date(now - DAY), expired_at: new Date(now - DAY), grace_until: new Date(now + DAY) },
      { _id: 'c', vpsId: 'c', chatId: '1', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-3', isRDP: true, durationMonths: 3, status: 'RUNNING', end_time: new Date(now + 2 * DAY) },
      { _id: 'd', vpsId: 'd', chatId: '1', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-4', isRDP: true, durationMonths: 2, status: 'EXPIRED_GRACE', end_time: new Date(now - DAY), grace_until: new Date(now + DAY) },
    ])
    const ra = await vm.renewVPSPlan('1', 'a')
    const a = await col.findOne({ _id: 'a' })
    const exp = new Date(now + 5 * DAY); exp.setMonth(exp.getMonth() + 1)
    ok(ra.success && Math.abs(new Date(a.end_time) - exp) < 5000, 'active VPS: end_time = old end + 1 month')
    ok(a._autoRenewAttempted === false && !a._renewLockUntil, 'flags/lock cleared')
    ok(calls.start.length === 0, 'active DO VPS: no startInstance')
    await vm.renewVPSPlan('1', 'b')
    const b = await col.findOne({ _id: 'b' })
    ok(b.status === 'RUNNING' && !b.grace_until && !b.expired_at, 'grace VPS: RUNNING, grace cleared')
    ok(new Date(b.end_time) > new Date(now + 27 * DAY) && new Date(b.end_time) < new Date(now + 32 * DAY), 'grace VPS: from now + 1 month')
    ok(calls.start.includes('do-2'), 'grace DO VPS: startInstance called')
    await vm.renewVPSPlan('1', 'c')
    const c = await col.findOne({ _id: 'c' })
    const expc = new Date(now + 2 * DAY); expc.setMonth(expc.getMonth() + 3)
    ok(Math.abs(new Date(c.end_time) - expc) < 5000, 'RDP durationMonths 3: +3 months')
    ok(calls.renew.some(([i, m]) => i === 'rdp-3' && m === 3), 'RDP renewInstance(inst,3)')
    await vm.renewVPSPlan('1', 'd')
    ok(calls.renew.some(([i, m]) => i === 'rdp-4' && m === 2) && !(await col.findOne({ _id: 'd' })).grace_until, 'RDP in grace: renewInstance(inst,2) + grace cleared')

    // Reseller renew static check
    const src = fs.readFileSync(path.join(__dirname, '../reseller-api.js'), 'utf8')
    const seg = src.slice(src.indexOf("action: 'renew', priceUsd"), src.indexOf("action: 'renew', priceUsd") + 2500)
    ok(/_autoRenewAttempted: false/.test(seg) && /_renewLockUntil: ''/.test(seg) && /_adminNotifyHistory: ''/.test(seg), 'reseller VPS renew clears _autoRenewAttempted/_renewLockUntil/_adminNotifyHistory')
  } catch (e) { fail++; console.error('CRASH', e) }
  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
