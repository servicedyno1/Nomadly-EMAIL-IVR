// Simulated VPS/RDP auto-renew lifecycle (no real servers): DigitalOcean box with auto-renew ON + funds must be
// charged, extended, and NEVER powered off / deleted — on every cycle, not only the first.
const { MongoClient } = require('mongodb')
const sched = require('../vps-expiry-scheduler')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const DAY = 86400000

;(async () => {
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('vps_autorenew_selftest')
  await db.dropDatabase()
  const vpsPlansOf = db.collection('vpsPlansOf'), walletOf = db.collection('walletOf'), state = db.collection('state')
  const calls = { stop: [], start: [], destroy: [], renew: [], msgs: [] }
  const provider = { stopInstance: async (i) => calls.stop.push(i), startInstance: async (i) => calls.start.push(i), renewInstance: async (i, m) => calls.renew.push([i, m]) }
  const smartWalletDeduct = async (w, chatId, amt) => {
    const r = await w.findOneAndUpdate({ _id: String(chatId), $expr: { $gte: [{ $subtract: ['$usdIn', '$usdOut'] }, amt] } }, { $inc: { usdOut: amt } }, { returnDocument: 'after', includeResultMetadata: false })
    return r ? { success: true, currency: 'usd' } : { success: false, usdBal: 0 }
  }
  const getBalance = async (w, chatId) => { const x = await w.findOne({ _id: String(chatId) }); return { usdBal: (x?.usdIn || 0) - (x?.usdOut || 0) } }
  const deps = (now) => ({
    vpsPlansOf, state, walletOf, payments: db.collection('payments'), nameOf: db.collection('nameOf'), db, bot: null,
    send: (c, m) => calls.msgs.push([c, m]), translation: (k) => k, asKind: (m) => m, isRdpRecord: (p) => !!p.isRDP,
    vpsRenewalPrice: async (p) => p.planPrice, deleteVPSinstance: async (c, v) => { calls.destroy.push(v); return { success: true } },
    smartWalletDeduct, getBalance, set: async () => {}, get: async () => null, nanoid: () => String(Math.random()),
    adminUserTag: () => 'u', adminMsgOpts: () => ({}), adminChatId: 'admin', log: () => {},
    providerForRecord: () => provider, rdpSvc: {}, now,
  })

  const t0 = new Date('2026-06-01T00:00:00Z')
  await walletOf.insertOne({ _id: '111', usdIn: 100, usdOut: 0 })
  await vpsPlansOf.insertOne({ _id: 'p1', chatId: '111', vpsId: 'v1', provider: 'digitalocean', contaboInstanceId: 'do-123', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 12 * 3600000), label: 'box' })

  console.log('Cycle 1 (T-12h):')
  await sched.runVpsExpiryCheck(deps(t0))
  let p = await vpsPlansOf.findOne({ _id: 'p1' })
  ok(p.status === 'RUNNING', 'still RUNNING after renewal')
  ok(new Date(p.end_time) > new Date(t0.getTime() + 25 * DAY), 'end_time extended ~1 month')
  ok(p._autoRenewAttempted === false, '_autoRenewAttempted cleared')
  ok((await getBalance(walletOf, '111')).usdBal === 80, 'wallet charged $20 once')

  console.log('Overlapping run, same moment (no double charge):')
  await sched.runVpsExpiryCheck(deps(t0))
  ok((await getBalance(walletOf, '111')).usdBal === 80, 'no second charge')

  console.log('Cycle 2 (next month, T-12h):')
  const t1 = new Date(new Date(p.end_time).getTime() - 12 * 3600000)
  await sched.runVpsExpiryCheck(deps(t1))
  p = await vpsPlansOf.findOne({ _id: 'p1' })
  ok((await getBalance(walletOf, '111')).usdBal === 60, 'second cycle charged again (auto-renew works more than once)')
  ok(p.status === 'RUNNING' && new Date(p.end_time) > new Date(t1.getTime() + 25 * DAY), 'second cycle extended')

  console.log('Run past expiry + 3 days later (grace window would have deleted it):')
  const t2 = new Date(t1.getTime() + 3 * DAY)
  await sched.runVpsExpiryCheck(deps(t2))
  ok(calls.stop.length === 0, 'never powered off')
  ok(calls.destroy.length === 0, 'never deleted')

  console.log('Short wallet → grace → top-up during grace → renewed + powered back on:')
  await walletOf.insertOne({ _id: '222', usdIn: 5, usdOut: 0 })
  await vpsPlansOf.insertOne({ _id: 'p2', chatId: '222', vpsId: 'v2', provider: 'digitalocean', contaboInstanceId: 'do-456', status: 'RUNNING', autoRenewable: true, planPrice: 20, end_time: new Date(t0.getTime() + 12 * 3600000) })
  await sched.runVpsExpiryCheck(deps(t0))
  p = await vpsPlansOf.findOne({ _id: 'p2' })
  ok(p.status === 'PENDING_CANCELLATION', 'insufficient funds → PENDING_CANCELLATION')
  const tExp = new Date(t0.getTime() + 13 * 3600000)
  await sched.runVpsExpiryCheck(deps(tExp))
  p = await vpsPlansOf.findOne({ _id: 'p2' })
  ok(calls.stop.includes('do-456'), 'powered off at expiry (grace starts)')
  ok(calls.destroy.length === 0, 'not deleted during grace')
  await walletOf.updateOne({ _id: '222' }, { $inc: { usdIn: 50 } })
  await sched.runVpsExpiryCheck(deps(new Date(tExp.getTime() + DAY)))
  p = await vpsPlansOf.findOne({ _id: 'p2' })
  ok(p.status === 'RUNNING' && !p.grace_until && !p.expired_at, 'renewed during grace, grace flags cleared')
  ok(calls.start.includes('do-456'), 'powered back on')
  await sched.runVpsExpiryCheck(deps(new Date(tExp.getTime() + 3 * DAY)))
  ok(calls.destroy.length === 0, 'not deleted after grace end once renewed')

  console.log('Auto-renew OFF still ends the box (default unchanged):')
  await vpsPlansOf.insertOne({ _id: 'p3', chatId: '111', vpsId: 'v3', provider: 'digitalocean', contaboInstanceId: 'do-789', status: 'RUNNING', autoRenewable: false, planPrice: 20, end_time: new Date(t0.getTime() + 12 * 3600000) })
  const bal = (await getBalance(walletOf, '111')).usdBal
  await sched.runVpsExpiryCheck(deps(t0))
  ok((await getBalance(walletOf, '111')).usdBal === bal, 'auto-renew OFF → not charged')
  ok((await vpsPlansOf.findOne({ _id: 'p3' })).status === 'PENDING_CANCELLATION', 'auto-renew OFF → pending cancellation')

  await db.dropDatabase()
  await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
