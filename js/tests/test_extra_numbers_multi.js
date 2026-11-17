'use strict'
// Extra numbers: new plan limits, several numbers in one wallet payment (web) and the bot's tick-to-pick helpers.
const assert = require('assert')
const pc = require('../phone-config')
const sb = require('../sub-batch')
const extras = require('../cloudivr-web/extras')

let pass = 0, fail = 0
const round = (x) => Math.round(x * 100) / 100
const t = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, '—', e.message) } }

function mockDb(balance) {
  const state = { balance, locks: new Set(), updates: [] }
  const lockCol = { insertOne: async (d) => { if (state.locks.has(d._id)) { const e = new Error('dup'); e.code = 11000; throw e } state.locks.add(d._id) }, deleteOne: async (q) => { state.locks.delete(q._id) }, createIndex: async () => {} }
  const col = () => ({ findOne: async () => null, updateOne: async () => ({}), insertOne: async () => ({}), find: () => ({ toArray: async () => [] }), createIndex: async () => {} })
  return {
    state,
    collection: (name) => name === 'webNumberLocks' ? lockCol : name === 'phoneNumbersOf' ? { ...col(), updateOne: async (q, u) => { state.updates.push([q, u]); return {} } } : name === 'walletOf'
      ? { findOne: async () => ({ _id: 'u1', val: { usdIn: state.balance, usdOut: 0 } }), updateOne: async () => ({}), createIndex: async () => {} }
      : col(),
  }
}

function harness({ subs = 0, plan = 'pro', balance = 500, fail = [], bump = 0 } = {}) {
  const routes = {}
  const router = { get: (p, f) => { routes[`GET ${p}`] = f }, post: (p, f) => { routes[`POST ${p}`] = f }, delete: (p, f) => { routes[`DELETE ${p}`] = f }, put: () => {}, patch: () => {} }
  const h = (fn) => fn
  const parent = { phoneNumber: '+15550000000', plan, status: 'active', expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), features: { callForwarding: { enabled: true, forwardTo: '+15559990000' }, ivr: { enabled: true, menu: 'x' }, voicemail: { enabled: true } } }
  const bought = [], redeems = [], extraNow = { n: 0 }
  const numbersApi = {
    findMine: async (_c, p) => (p === parent.phoneNumber ? parent : (await numbersApi.myNumbers()).find(x => x.phoneNumber === p) || null),
    myNumbers: async () => [parent, ...Array.from({ length: subs + extraNow.n }, (_, i) => ({ phoneNumber: `+1555100000${i}`, isSubNumber: true, parentNumber: parent.phoneNumber, status: 'active' }))],
    pickManyFromSearch: async (_c, phones) => phones.map(p => ({ hit: { phoneNumber: p, capabilities: { voice: true } }, country: 'US', type: 'local' })),
    extraPriceOf: () => 25,
    checkCoupon: async () => ({ error: true, message: 'bad' }),
    purchase: async (a) => { redeems.push(!a.skipRedeem); if (fail.includes(a.phone)) return { status: 409, body: { message: 'Someone just took that number.' } }; bought.push(a.phone); extraNow.n += 1 + bump; return { status: 201, body: { number: { phoneNumber: a.phone } } } },
  }
  const db = mockDb(balance)
  const wallet = require('../cloudivr-web/wallet')
  const orig = wallet.walletOps
  wallet.walletOps = () => ({ balance: async () => db.state.balance })
  extras.routes(router, { db, h, numbersApi })
  wallet.walletOps = orig
  const hit = async (key, phone, body) => {
    let status = 200, json = null
    const res = { status: (s) => { status = s; return res }, json: (j) => { json = j; return res } }
    await routes[key]({ webChatId: 'u1', webUser: { email: 'a@b.c' }, params: { phone }, body }, res)
    return { status, json }
  }
  const call = (body) => hit('POST /numbers/:phone/extra', parent.phoneNumber, body)
  return { call, hit, bought, redeems, db, parent }
}

;(async () => {
  await t('plan limits are 5 / 10 / 25 / 50 and Enterprise unlimited', () => {
    assert.deepStrictEqual([pc.getSubNumberLimit('starter'), pc.getSubNumberLimit('standard'), pc.getSubNumberLimit('pro'), pc.getSubNumberLimit('business')], [5, 10, 25, 50])
    assert.strictEqual(pc.getSubNumberLimit('enterprise'), Infinity)
    assert.strictEqual(pc.subSlotsLeft('pro', 20), 5)
    assert.strictEqual(pc.subSlotsLeft('starter', 9), 0)
  })
  await t('plan feature text shows the new limits', () => {
    assert.ok(pc.plans.business.features.some(f => f.includes('50 extra numbers')))
    assert.ok(pc.plans.starter.features.some(f => f.includes('5 extra numbers')))
  })
  await t('web: several numbers added in one payment', async () => {
    const { call, bought } = harness({ balance: 100 })
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002', '+15552220003'] })
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual(r.json.added, ['+15552220001', '+15552220002', '+15552220003'])
    assert.strictEqual(bought.length, 3)
  })
  await t('web: a taken number is skipped, the rest are activated, message says it stays in the wallet', async () => {
    const { call } = harness({ balance: 100, fail: ['+15552220002'] })
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002'] })
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual(r.json.added, ['+15552220001'])
    assert.strictEqual(r.json.failed[0].phoneNumber, '+15552220002')
    assert.ok(/stays in your wallet/.test(r.json.message))
  })
  await t('web: more picks than free slots is refused before anything is bought', async () => {
    const { call, bought } = harness({ plan: 'starter', subs: 4 })
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002'] })
    assert.strictEqual(r.status, 400)
    assert.strictEqual(r.json.error, 'too_many')
    assert.strictEqual(bought.length, 0)
  })
  await t('web: short wallet → 402 with cost / balance / need for the pay-the-difference dialog', async () => {
    const { call, bought } = harness({ balance: 30 })
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002'] })
    assert.strictEqual(r.status, 402)
    assert.deepStrictEqual([r.json.cost, r.json.balance, r.json.need], [50, 30, 20])
    assert.strictEqual(bought.length, 0)
  })
  await t('web: a single number still works with the old phoneNumber field', async () => {
    const { call } = harness()
    const r = await call({ phoneNumber: '+15552220009' })
    assert.strictEqual(r.status, 201)
    assert.strictEqual(r.json.number.phoneNumber, '+15552220009')
  })
  await t('bot: tick, untick and the room limit', () => {
    let r = sb.toggle([], { phone_number: '+1' }, 2)
    r = sb.toggle(r.picks, { phone_number: '+2' }, 2)
    assert.strictEqual(r.picks.length, 2)
    assert.strictEqual(sb.toggle(r.picks, { phone_number: '+3' }, 2).error, 'full')
    assert.strictEqual(sb.toggle(r.picks, { phone_number: '+1' }, 2).picks.length, 1)
  })
  await t('bot: keyboard marks picks and shows Continue; Continue is recognised in every language', () => {
    const rows = sb.rows([{ phone_number: '+15550001' }, { phone_number: '+15550002' }], [{ phone_number: '+15550002' }], 'en', 'More', x => x)
    assert.deepStrictEqual(rows, [['📞 +15550001'], ['✅ +15550002'], ['➡️ Continue with 1 number'], ['More']])
    for (const l of ['en', 'fr', 'zh', 'hi', 'fa']) assert.ok(sb.isContinue(sb.T(l).continueBtn(3)), l)
    assert.ok(!sb.isContinue('📞 +15550001'))
    assert.strictEqual(sb.total([{ price: 25 }, { price: 25.5 }]), 50.5)
  })
  await t('one bill: a new extra pays only the days until the plan date; renewal day total = plan + extras on auto-renew', () => {
    const lc = require('../plan-lifecycle')
    const until = new Date(Date.now() + 15 * 864e5).toISOString()
    assert.strictEqual(lc.proratedTo(25, until), 12.5)
    assert.strictEqual(lc.proratedTo(25, new Date(Date.now() + 40 * 864e5)), 25)
    const main = { phoneNumber: '+1', plan: 'pro', planPrice: 100, status: 'active', expiresAt: until }
    const nums = [main, { phoneNumber: '+2', isSubNumber: true, parentNumber: '+1', status: 'active', planPrice: 25, expiresAt: until }, { phoneNumber: '+3', isSubNumber: true, parentNumber: '+1', status: 'active', planPrice: 25, autoRenew: false, expiresAt: until }]
    const g = lc.groupRenewal(nums, main)
    assert.strictEqual(g.renewing, 1)
    assert.strictEqual(g.total, round(lc.renewalPrice(main) + 25))
    assert.strictEqual(lc.cotermDate(nums, nums[1]), until)
    assert.strictEqual(lc.groupRenewal(nums, { ...main, autoRenew: false }).total, 0)
  })
  await t('web: multi-add price is prorated to the plan date', async () => {
    const { call, parent } = harness({ balance: 30 })
    parent.expiresAt = new Date(Date.now() + 15 * 864e5).toISOString()
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002', '+15552220003'] })
    assert.strictEqual(r.status, 402)
    assert.strictEqual(r.json.cost, 37.5)
  })
  await t('web: a second multi-add on the same plan at the same moment is refused (busy)', async () => {
    const { call, db } = harness()
    db.state.locks.add('extras:u1:+15550000000')
    const r = await call({ phoneNumbers: ['+15552220001', '+15552220002'] })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.json.error, 'busy')
  })
  await t('web: free slots re-checked during the loop (another purchase took the last slot)', async () => {
    const h = harness({ plan: 'starter', subs: 3, bump: 1 })
    const r = await h.call({ phoneNumbers: ['+15552220001', '+15552220002'] })
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual(r.json.added, ['+15552220001'])
    assert.ok(/no free extra-number slot/.test(r.json.failed[0].message))
  })
  await t('web: a coupon covers the whole order and is redeemed once', async () => {
    const h = harness()
    const r = await h.call({ phoneNumbers: ['+15552220001', '+15552220002', '+15552220003'] })
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual(h.redeems, [true, false, false])
  })
  await t('web: delete one extra number now (needs the number typed to confirm)', async () => {
    const h = harness({ subs: 1 })
    const bad = await h.hit('DELETE /numbers/:phone/extra-line', '+15551000000', {})
    assert.strictEqual(bad.json.error, 'confirm')
    const ok = await h.hit('DELETE /numbers/:phone/extra-line', '+15551000000', { confirm: '+15551000000' })
    assert.strictEqual(ok.json.deleted, '+15551000000')
    const upd = h.db.state.updates.find(u => u[1].$set?.['val.numbers.$.status'] === 'released')
    assert.ok(upd)
    const main = await h.hit('DELETE /numbers/:phone/extra-line', '+15550000000', { confirm: '+15550000000' })
    assert.strictEqual(main.json.error, 'not_extra')
  })
  await t('web: copy forwarding / IVR / voicemail from one number to others', async () => {
    const h = harness({ subs: 2 })
    const r = await h.hit('POST /numbers/:phone/copy-settings', '+15550000000', { to: ['+15551000000', '+15551000001'], parts: ['forwarding', 'ivr', 'voicemail'] })
    assert.deepStrictEqual(r.json.to, ['+15551000000', '+15551000001'])
    const u = h.db.state.updates.filter(x => x[1].$set?.['val.numbers.$.features.callForwarding'])
    assert.strictEqual(u.length, 2)
    assert.strictEqual(u[0][1].$set['val.numbers.$.features.callForwarding'].forwardTo, '+15559990000')
    const none = await h.hit('POST /numbers/:phone/copy-settings', '+15550000000', { to: [], parts: ['ivr'] })
    assert.strictEqual(none.json.error, 'pick_numbers')
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
