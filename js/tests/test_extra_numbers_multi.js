'use strict'
// Extra numbers: new plan limits, several numbers in one wallet payment (web) and the bot's tick-to-pick helpers.
const assert = require('assert')
const pc = require('../phone-config')
const sb = require('../sub-batch')
const extras = require('../cloudivr-web/extras')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, '—', e.message) } }

function mockDb(balance) {
  const state = { balance }
  const col = () => ({ findOne: async () => null, updateOne: async () => ({}), insertOne: async () => ({}), find: () => ({ toArray: async () => [] }), createIndex: async () => {} })
  return {
    state,
    collection: (name) => name === 'walletOf'
      ? { findOne: async () => ({ _id: 'u1', val: { usdIn: state.balance, usdOut: 0 } }), updateOne: async () => ({}), createIndex: async () => {} }
      : col(),
  }
}

function harness({ subs = 0, plan = 'pro', balance = 500, fail = [] } = {}) {
  const routes = {}
  const router = { get: (p, f) => { routes[`GET ${p}`] = f }, post: (p, f) => { routes[`POST ${p}`] = f }, delete: () => {}, put: () => {}, patch: () => {} }
  const h = (fn) => fn
  const parent = { phoneNumber: '+15550000000', plan, status: 'active' }
  const bought = []
  const numbersApi = {
    findMine: async () => parent,
    myNumbers: async () => [parent, ...Array.from({ length: subs }, (_, i) => ({ phoneNumber: `+1555100000${i}`, isSubNumber: true, parentNumber: parent.phoneNumber, status: 'active' }))],
    pickManyFromSearch: async (_c, phones) => phones.map(p => ({ hit: { phoneNumber: p, capabilities: { voice: true } }, country: 'US', type: 'local' })),
    extraPriceOf: () => 25,
    checkCoupon: async () => ({ error: true, message: 'bad' }),
    purchase: async (a) => { if (fail.includes(a.phone)) return { status: 409, body: { message: 'Someone just took that number.' } }; bought.push(a.phone); return { status: 201, body: { number: { phoneNumber: a.phone } } } },
  }
  const db = mockDb(balance)
  const wallet = require('../cloudivr-web/wallet')
  const orig = wallet.walletOps
  wallet.walletOps = () => ({ balance: async () => db.state.balance })
  extras.routes(router, { db, h, numbersApi })
  wallet.walletOps = orig
  const call = async (body) => {
    let status = 200, json = null
    const res = { status: (s) => { status = s; return res }, json: (j) => { json = j; return res } }
    await routes['POST /numbers/:phone/extra']({ webChatId: 'u1', webUser: { email: 'a@b.c' }, params: { phone: parent.phoneNumber }, body }, res)
    return { status, json }
  }
  return { call, bought }
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
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
