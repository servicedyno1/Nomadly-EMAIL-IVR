'use strict'
// Custom caller ID admin switch (default off) + Landline-to-Texting letter drafts.
delete process.env.CUSTOM_CALLER_ID_ON
const assert = require('assert')
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, e.message) } }

const store = {}
const coll = (n) => {
  store[n] = store[n] || new Map()
  const m = store[n]
  const match = (d, q) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && '$in' in v ? v.$in.includes(d[k]) : v === null ? d[k] == null : d[k] === v))
  return {
    findOne: async (q) => [...m.values()].find(d => match(d, q)) || null,
    find: (q) => ({ toArray: async () => [...m.values()].filter(d => match(d, q)), sort() { return this }, limit() { return this } }),
    updateOne: async (q, u, o = {}) => { let d = [...m.values()].find(x => match(x, q)); if (!d && o.upsert) { d = { ...q }; m.set(d._id, d) } if (!d) return { matchedCount: 0 }; Object.assign(d, u.$set || {}); return { matchedCount: 1 } },
    insertOne: async (d) => { m.set(d._id, d) },
    createIndex: async () => {},
    updateMany: async () => ({}),
  }
}
const db = { collection: coll }

;(async () => {
  const cid = require('../cloudivr-web/caller-ids')
  cid.init(db)
  await cid.loadSwitch()
  await coll('webCallerIds').insertOne({ _id: '+14155550100', chatId: '7', status: 'verified', method: 'code' })
  await coll('callerIdDefaults').insertOne({ _id: '+13335550000', chatId: '7', showAs: '+14155550100' })

  await ok('switch is off by default', async () => assert.strictEqual(cid.enabled(), false))
  await ok('off: resolve gives own number (null)', async () => assert.strictEqual(await cid.resolve('7', '+14155550100'), null))
  await ok('off: isVerified false', async () => assert.strictEqual(await cid.isVerified('7', '+14155550100'), false))
  await ok('off: no presets', async () => assert.deepStrictEqual(await cid.presets('7'), []))
  await ok('off: no softphone default', async () => assert.ok(!(await cid.defaultFor('7', '+13335550000'))))
  const bot = require('../custom-caller-id-bot')
  await ok('off: bot button hidden', async () => { assert.deepStrictEqual(bot.btnRow('en'), []); assert.strictEqual(bot.isBtn(bot.t('en').btn), false); assert.strictEqual(bot.isPreset('🎭 +14155550100'), false) })

  await cid.setEnabled(true, 'admin@test')
  await ok('on: stored and resolve works', async () => { assert.strictEqual((await coll('appSettings').findOne({ _id: 'customCallerId' })).enabled, true); assert.strictEqual(await cid.resolve('7', '+14155550100'), '+14155550100') })
  await ok('on: bot button back', async () => { assert.strictEqual(bot.btnRow('en').length, 1); assert.ok(bot.isBtn(bot.t('en').btn)) })
  await ok('on: softphone default back', async () => assert.strictEqual(await cid.defaultFor('7', '+13335550000'), '+14155550100'))
  await cid.setEnabled(false)
  await ok('off again after reload', async () => assert.strictEqual(await cid.loadSwitch(), false))

  const HS = require('../hosted-sms')
  HS.init({ db, log: () => {}, notifyAdmin: () => {}, mailSupport: async () => {}, brand: () => 'CloudIVR', tell: async () => null })
  await coll('hostedSms').insertOne({ _id: 'hs_1', chatId: '9', phoneNumber: '+19055550100', status: 'loa' })
  await ok('draft saved and returned in order', async () => {
    assert.ok((await HS.saveDraft('9', 'hs_1', { name: 'Mara Tele', city: 'Toronto' })).ok)
    const d = await HS.mine('9', 'hs_1')
    assert.strictEqual(HS.pub(d).draft.name, 'Mara Tele'); assert.strictEqual(HS.pub(d).draft.city, 'Toronto')
  })
  await ok('draft refused for another account', async () => assert.ok((await HS.saveDraft('8', 'hs_1', { name: 'x' })).error))
  await ok('draft refused once signed', async () => {
    await coll('hostedSms').updateOne({ _id: 'hs_1' }, { $set: { holder: { name: 'Mara Tele' }, status: 'documents' } })
    assert.ok((await HS.saveDraft('9', 'hs_1', { name: 'y' })).error)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
