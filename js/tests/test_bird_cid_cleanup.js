// node js/tests/test_bird_cid_cleanup.js — released numbers leave Bird caller ID 3 days after release
const assert = require('assert')
const { runBirdCallerIdCleanup } = require('../bird-cid-cleanup')

function fakeDb(accounts, webVerified = []) {
  const store = { birdCidRemovals: new Map(), birdCallerIdVerify: new Map() }
  const match = (d, f) => Object.entries(f).every(([k, v]) => {
    const x = d[k]
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$in' in v) return v.$in.includes(x)
      if ('$lte' in v) return x <= v.$lte
    }
    return x === v
  })
  const col = (name) => {
    if (name === 'phoneNumbersOf') return { find: () => ({ toArray: async () => accounts }) }
    if (name === 'webCallerIds') return { find: () => ({ toArray: async () => webVerified.map(_id => ({ _id })) }) }
    const m = store[name]
    return {
      updateOne: async (f, u, o) => { let d = m.get(f._id); if (!d) { if (!o?.upsert) return; d = { ...(u.$setOnInsert || {}) }; m.set(f._id, d) } Object.assign(d, u.$set || {}) },
      deleteMany: async (f) => { for (const [k, d] of m) if (match(d, f)) m.delete(k) },
      deleteOne: async (f) => m.delete(f._id),
      find: (f) => ({ toArray: async () => [...m.values()].filter(d => match(d, f)) }),
    }
  }
  return { collection: col, store }
}

;(async () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const old = '2026-11-15T12:00:00Z', recent = '2026-11-19T12:00:00Z'
  const accounts = [
    { val: { numbers: [{ phoneNumber: '+15550000001', status: 'released', releasedAt: old }, { phoneNumber: '+15550000002', status: 'released', releasedAt: recent }] } },
    { val: { numbers: [{ phoneNumber: '+15550000003', status: 'suspended' }, { phoneNumber: '+15550000004', status: 'released', releasedAt: old }] } },
    { val: { numbers: [{ phoneNumber: '+15550000004', status: 'active' }, { phoneNumber: '+15550000005', status: 'released', releasedAt: old }, { phoneNumber: '+15550000006', status: 'released', releasedAt: old }] } },
  ]
  const db = fakeDb(accounts, ['+15550000006'])
  const deleted = []
  const bird = { enabled: () => true, listCallerIds: async () => ['1', '2', '3', '4', '5', '6'].map(i => ({ id: `v${i}`, phone_number: `+1555000000${i}` })), deleteCallerId: async (id) => { deleted.push(id); return true }, forgetCallerIds: () => {} }
  const r = await runBirdCallerIdCleanup({ db, bird, owned: async () => ['+15550000005'], log: () => {}, now })
  assert.deepStrictEqual(deleted, ['v1'], 'only the number released 3+ days ago and not owned/kept is removed')
  assert.strictEqual(r.removed, 1)
  assert.strictEqual(db.store.birdCidRemovals.get('+15550000002').status, 'waiting', 'released 1 day ago waits')
  assert.ok(!db.store.birdCidRemovals.has('+15550000003'), 'suspended lines are not queued')
  assert.ok(!db.store.birdCidRemovals.has('+15550000004'), 'number live on another account is not queued')
  assert.strictEqual(db.store.birdCidRemovals.get('+15550000005').status, 'kept', 'still in carrier inventory → kept')
  assert.strictEqual(db.store.birdCidRemovals.get('+15550000006').status, 'kept', 'customer-verified caller ID → kept')

  // Line pulled from the account later: queue still remembers it and removes it once due.
  deleted.length = 0
  accounts[0].val.numbers = []
  await runBirdCallerIdCleanup({ db, bird, owned: async () => ['+15559999999'], log: () => {}, now: new Date('2026-11-23T12:00:00Z') })
  assert.deepStrictEqual(deleted, ['v2'])

  // Inventory unavailable → nothing removed.
  const db2 = fakeDb([{ val: { numbers: [{ phoneNumber: '+15550000007', status: 'released', releasedAt: old }] } }])
  deleted.length = 0
  const r2 = await runBirdCallerIdCleanup({ db: db2, bird, owned: async () => { throw new Error('down') }, log: () => {}, now })
  assert.strictEqual(r2.skipped, 'inventory'); assert.deepStrictEqual(deleted, [])
  console.log('test_bird_cid_cleanup: all passed')
})().catch(e => { console.error(e); process.exit(1) })
