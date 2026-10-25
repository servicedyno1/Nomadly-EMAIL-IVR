// Extended simulated DO VPS/RDP auto-renew lifecycle (fake providers, throwaway Mongo DB) — T1 iteration 131.
// Covers: 3 cycles VPS + RDP(3 months), hour-stepped long simulation, concurrent runs, legacy _autoRenewAttempted,
// short wallet → grace → top-up (VPS startInstance / RDP renewInstance), grace expiry → destroy, auto-renew OFF.
const { MongoClient } = require('mongodb')
const sched = require('../vps-expiry-scheduler')
const rdpGrace = require('../rdp-grace-lifecycle')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const DAY = 86400000, H = 3600000
const DBNAME = 'vps_autorenew_ext_t1_' + Date.now()

;(async () => {
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db(DBNAME)
  const vpsPlansOf = db.collection('vpsPlansOf'), walletOf = db.collection('walletOf'), state = db.collection('state')
  const calls = { stop: [], start: [], destroy: [], renew: [], msgs: [], deducts: [] }
  const provider = { stopInstance: async (i) => calls.stop.push(i), startInstance: async (i) => calls.start.push(i), renewInstance: async (i, m) => calls.renew.push([i, m]) }
  const doVpsProvider = { stopInstance: provider.stopInstance, startInstance: provider.startInstance } // DO Linux service has no renewInstance
  const smartWalletDeduct = async (w, chatId, amt) => {
    await new Promise((r) => setTimeout(r, 5)) // widen race window
    const r = await w.findOneAndUpdate({ _id: String(chatId), $expr: { $gte: [{ $subtract: ['$usdIn', '$usdOut'] }, amt] } }, { $inc: { usdOut: amt } }, { returnDocument: 'after', includeResultMetadata: false })
    if (r) calls.deducts.push([chatId, amt])
    return r ? { success: true, currency: 'usd' } : { success: false, usdBal: 0 }
  }
  const getBalance = async (w, chatId) => { const x = await w.findOne({ _id: String(chatId) }); return { usdBal: (x?.usdIn || 0) - (x?.usdOut || 0) } }
  const bal = async (c) => (await getBalance(walletOf, c)).usdBal
  const deps = (now) => ({
    vpsPlansOf, state, walletOf, payments: db.collection('payments'), nameOf: db.collection('nameOf'), db, bot: null,
    send: (c, m) => calls.msgs.push([c, m]), translation: (k) => k, asKind: (m) => m, isRdpRecord: (p) => !!p.isRDP,
    vpsRenewalPrice: async (p) => p.planPrice, deleteVPSinstance: async (c, v) => { calls.destroy.push(v); await vpsPlansOf.updateOne({ vpsId: v }, { $set: { status: 'CANCELLED' } }); return { success: true } },
    smartWalletDeduct, getBalance, set: async () => {}, get: async () => null, nanoid: () => String(Math.random()),
    adminUserTag: () => 'u', adminMsgOpts: () => ({}), adminChatId: 'admin', log: () => {},
    providerForRecord: (p) => (String(p.provider) === 'digitalocean' ? doVpsProvider : provider), rdpSvc: { markGrace: async () => {}, markGraceDestroy: async () => {} }, now,
  })
  const reset = () => { for (const k of Object.keys(calls)) calls[k] = [] }
  const t0 = new Date('2026-06-01T00:00:00Z')

  try {
    // ── 1. VPS + RDP(3mo), 3 cycles at T-24h window ──
    console.log('1. DO VPS (1mo) + DO RDP (3mo) — cycles 1/2/3 at T-20h:')
    await walletOf.insertMany([{ _id: 'A', usdIn: 1000, usdOut: 0 }, { _id: 'AR', usdIn: 1000, usdOut: 0 }])
    await vpsPlansOf.insertMany([
      { _id: 'vps1', chatId: 'A', vpsId: 'vps1', provider: 'digitalocean', contaboInstanceId: 'do-1001', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 20 * H), _autoRenewAttempted: true },
      { _id: 'rdp1', chatId: 'AR', vpsId: 'rdp1', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-2001', isRDP: true, durationMonths: 3, status: 'RUNNING', autoRenewable: true, planPrice: 90, end_time: new Date(t0.getTime() + 20 * H) },
    ])
    let expected = 1000, expectedR = 1000
    for (let cycle = 1; cycle <= 3; cycle++) {
      const v = await vpsPlansOf.findOne({ _id: 'vps1' }), r = await vpsPlansOf.findOne({ _id: 'rdp1' })
      const vNow = new Date(new Date(v.end_time).getTime() - 20 * H)
      await sched.runVpsExpiryCheck(deps(vNow))
      expected -= 20
      const v2 = await vpsPlansOf.findOne({ _id: 'vps1' })
      const vMonths = (new Date(v2.end_time).getUTCMonth() - new Date(v.end_time).getUTCMonth() + 12) % 12
      ok(v2.status === 'RUNNING' && vMonths === 1 && v2._autoRenewAttempted === false && !v2._renewLockUntil, `VPS cycle ${cycle}: renewed +1 month, flags cleared`)
      const rNow = new Date(new Date(r.end_time).getTime() - 20 * H)
      const vBefore = await bal('A')
      await sched.runVpsExpiryCheck(deps(rNow))
      expected = await bal('A') // VPS may legitimately late-renew in this run if its own term ended (separate wallet)
      if (cycle === 1) ok(expected === vBefore, 'RDP run does not touch the VPS wallet when VPS not due')
      expectedR -= 90
      const r2 = await vpsPlansOf.findOne({ _id: 'rdp1' })
      const rMonths = (new Date(r2.end_time).getUTCFullYear() - new Date(r.end_time).getUTCFullYear()) * 12 + new Date(r2.end_time).getUTCMonth() - new Date(r.end_time).getUTCMonth()
      ok(r2.status === 'RUNNING' && rMonths === 3, `RDP cycle ${cycle}: renewed +3 months (got +${rMonths})`)
      ok((await bal('AR')) === expectedR, `RDP wallet after cycle ${cycle} = ${expectedR} (got ${await bal('AR')})`)
      ok(calls.deducts.filter(([c]) => c === 'AR').length === cycle, `RDP charged exactly ${cycle} times so far`)
    }
    ok(calls.renew.length === 3 && calls.renew.every(([i, m]) => i === 'rdp-2001' && m === 3), 'RDP renewInstance(inst, 3) called once per cycle')
    ok(calls.stop.length === 0 && calls.destroy.length === 0, 'never stopped / destroyed across 3 cycles')
    // Runs days past the OLD expiry
    const v = await vpsPlansOf.findOne({ _id: 'vps1' })
    for (let d = 1; d <= 5; d++) await sched.runVpsExpiryCheck(deps(new Date(t0.getTime() + d * DAY)))
    ok(calls.stop.length === 0 && calls.destroy.length === 0 && (await bal('A')) === expected && (await bal('AR')) === expectedR, 'runs 1-5 days past original expiry: no stop/destroy/extra charge')
    ok(String((await vpsPlansOf.findOne({ _id: 'vps1' })).end_time) === String(v.end_time), 'end_time unchanged by extra runs')

    // ── 2. Long hour-stepped simulation (every 3h for ~200 days) ──
    console.log('2. Every-3h simulation for 200 days (VPS + RDP 1mo + RDP 2mo):')
    await db.collection('vpsPlansOf').deleteMany({}); await walletOf.deleteMany({}); reset()
    await walletOf.insertOne({ _id: 'B', usdIn: 5000, usdOut: 0 })
    await vpsPlansOf.insertMany([
      { _id: 'vB', chatId: 'B', vpsId: 'vB', provider: 'digitalocean', contaboInstanceId: 'do-3001', status: 'RUNNING', autoRenewable: true, planPrice: 10, end_time: new Date(t0.getTime() + 2 * DAY) },
      { _id: 'rB1', chatId: 'B', vpsId: 'rB1', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-3002', isRDP: true, durationMonths: 1, status: 'RUNNING', autoRenewable: true, planPrice: 30, end_time: new Date(t0.getTime() + 2 * DAY) },
      { _id: 'rB2', chatId: 'B', vpsId: 'rB2', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-3003', isRDP: true, durationMonths: 2, status: 'RUNNING', autoRenewable: true, planPrice: 55, end_time: new Date(t0.getTime() + 2 * DAY) },
    ])
    for (let t = t0.getTime(); t < t0.getTime() + 200 * DAY; t += 3 * H) await sched.runVpsExpiryCheck(deps(new Date(t)))
    const cnt = (amt) => calls.deducts.filter(([, a]) => a === amt).length
    ok(cnt(10) === 7, `VPS charged 7 times in 200 days (got ${cnt(10)})`)
    ok(cnt(30) === 7, `RDP 1mo charged 7 times (got ${cnt(30)})`)
    ok(cnt(55) === 4, `RDP 2mo charged 4 times (got ${cnt(55)})`)
    ok(calls.stop.length === 0 && calls.destroy.length === 0, 'never stopped / destroyed over 200 days')
    const all = await vpsPlansOf.find({}).toArray()
    ok(all.every((p) => p.status === 'RUNNING' && new Date(p.end_time) > new Date(t0.getTime() + 200 * DAY)), 'all still RUNNING and paid ahead')

    // ── 3. Concurrency ──
    console.log('3. Concurrent runs (Promise.all x3) charge once:')
    await vpsPlansOf.deleteMany({}); await walletOf.deleteMany({}); reset()
    await walletOf.insertOne({ _id: 'C', usdIn: 100, usdOut: 0 })
    await vpsPlansOf.insertMany([
      { _id: 'vC', chatId: 'C', vpsId: 'vC', provider: 'digitalocean', contaboInstanceId: 'do-4001', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 10 * H) },
      { _id: 'rC', chatId: 'C', vpsId: 'rC', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-4002', isRDP: true, durationMonths: 1, status: 'RUNNING', autoRenewable: true, planPrice: 25, end_time: new Date(t0.getTime() + 10 * H) },
    ])
    await Promise.all([sched.runVpsExpiryCheck(deps(t0)), sched.runVpsExpiryCheck(deps(t0)), sched.runVpsExpiryCheck(deps(new Date(t0.getTime() + 60000)))])
    ok((await bal('C')) === 55, `charged exactly once each (balance 55, got ${await bal('C')})`)
    ok(calls.renew.length === 1, `RDP renewInstance called once (got ${calls.renew.length})`)
    // Concurrent at the retry phase (past expiry, status RUNNING)
    await vpsPlansOf.updateOne({ _id: 'vC' }, { $set: { end_time: new Date(t0.getTime() - H) } })
    const before = await bal('C')
    await Promise.all([sched.runVpsExpiryCheck(deps(t0)), sched.runVpsExpiryCheck(deps(t0))])
    ok((await bal('C')) === before - 20, 'Phase 1.1 late-renew concurrent → charged once')

    // ── 4. Short wallet → grace → top-up ──
    console.log('4. Short wallet → grace → top-up (VPS startInstance, RDP renewInstance):')
    await vpsPlansOf.deleteMany({}); await walletOf.deleteMany({}); reset()
    await walletOf.insertOne({ _id: 'D', usdIn: 5, usdOut: 0 })
    await vpsPlansOf.insertMany([
      { _id: 'vD', chatId: 'D', vpsId: 'vD', provider: 'digitalocean', contaboInstanceId: 'do-5001', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 10 * H) },
      { _id: 'rD', chatId: 'D', vpsId: 'rD', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-5002', isRDP: true, durationMonths: 3, status: 'RUNNING', autoRenewable: true, planPrice: 60, end_time: new Date(t0.getTime() + 10 * H) },
    ])
    await sched.runVpsExpiryCheck(deps(t0))
    ok((await vpsPlansOf.findOne({ _id: 'vD' })).status === 'PENDING_CANCELLATION' && (await vpsPlansOf.findOne({ _id: 'rD' })).status === 'PENDING_CANCELLATION', 'both PENDING_CANCELLATION')
    const tE = new Date(t0.getTime() + 11 * H)
    await sched.runVpsExpiryCheck(deps(tE))
    ok(calls.stop.includes('do-5001') && calls.stop.includes('rdp-5002'), 'both powered off at expiry')
    ok(calls.destroy.length === 0, 'not destroyed at grace start')
    await walletOf.updateOne({ _id: 'D' }, { $inc: { usdIn: 200 } })
    await sched.runVpsExpiryCheck(deps(new Date(tE.getTime() + DAY)))
    const vD = await vpsPlansOf.findOne({ _id: 'vD' }), rD = await vpsPlansOf.findOne({ _id: 'rD' })
    ok(vD.status === 'RUNNING' && !vD.grace_until && !vD.expired_at, 'VPS renewed in grace, grace fields cleared')
    ok(rD.status === 'RUNNING' && !rD.grace_until && !rD.expired_at, 'RDP renewed in grace, grace fields cleared')
    ok((await bal('D')) === 205 - 80, `charged once each (bal 125, got ${await bal('D')})`)
    ok(calls.start.includes('do-5001'), 'VPS startInstance called')
    ok(calls.renew.some(([i, m]) => i === 'rdp-5002' && m === 3), 'RDP renewInstance(inst,3) called')
    ok(new Date(vD.end_time) > new Date(tE.getTime() + 28 * DAY), 'VPS new end_time from max(end,now)+1mo')
    for (let d = 2; d <= 6; d++) await sched.runVpsExpiryCheck(deps(new Date(tE.getTime() + d * DAY)))
    ok(calls.destroy.length === 0, 'never destroyed after renewal in grace')
    ok((await bal('D')) === 125, 'no extra charges afterwards')

    // ── 5. Short wallet through the whole grace → destroyed ──
    console.log('5. Wallet still short after grace → destroyed:')
    reset()
    await walletOf.insertOne({ _id: 'E', usdIn: 1, usdOut: 0 })
    await vpsPlansOf.insertMany([
      { _id: 'vE', chatId: 'E', vpsId: 'vE', provider: 'digitalocean', contaboInstanceId: 'do-6001', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 10 * H) },
      { _id: 'rE', chatId: 'E', vpsId: 'rE', provider: 'digitalocean-rdp', contaboInstanceId: 'rdp-6002', isRDP: true, status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 10 * H) },
      { _id: 'vOff', chatId: 'A2', vpsId: 'vOff', provider: 'digitalocean', contaboInstanceId: 'do-6003', status: 'RUNNING', autoRenewable: false, planPrice: 20, end_time: new Date(t0.getTime() + 10 * H) },
    ])
    await walletOf.insertOne({ _id: 'A2', usdIn: 500, usdOut: 0 })
    await sched.runVpsExpiryCheck(deps(t0))
    ok((await bal('A2')) === 500 && (await vpsPlansOf.findOne({ _id: 'vOff' })).status === 'PENDING_CANCELLATION', 'auto-renew OFF: not charged, PENDING_CANCELLATION')
    await sched.runVpsExpiryCheck(deps(new Date(t0.getTime() + 11 * H)))
    ok(['do-6001', 'rdp-6002', 'do-6003'].every((i) => calls.stop.includes(i)), 'all three powered off at expiry')
    await sched.runVpsExpiryCheck(deps(new Date(t0.getTime() + 10 * H + (sched.VPS_GRACE_DAYS * DAY) - H)))
    ok(calls.destroy.length === 0, 'not destroyed 1h before grace end')
    await sched.runVpsExpiryCheck(deps(new Date(t0.getTime() + 10 * H + Math.max(sched.VPS_GRACE_DAYS, rdpGrace.GRACE_DAYS) * DAY + H)))
    ok(['vE', 'rE', 'vOff'].every((i) => calls.destroy.includes(i)), `all destroyed after grace (got ${calls.destroy})`)
    ok((await bal('A2')) === 500, 'auto-renew OFF never charged')
  } catch (e) { fail++; console.error('CRASH', e) }

  await db.dropDatabase()
  await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
