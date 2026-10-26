// Web text delivery results (2026-10): Telnyx message.finalized → Delivered / Not delivered + plain reason on the text,
// the missed call / inbox item it answered, a give-back (plan text + extra-text charge) and an Inbox alert on failure.
// SANDBOX MONGO ONLY (mongod --port 27999). Telnyx stubbed — no real texts.
//   node js/tests/test_sms_delivery_2026-10.js
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
delete process.env.WEB_CLOUDIVR_DRY_RUN

const assert = require('assert')
const axios = require('axios')
const { MongoClient, ObjectId } = require('mongodb')
const notify = require('../cloudivr-web/notify')
const sms = require('../cloudivr-web/sms-reply')

const CHAT = '5000000000000777', PHONE = '+18335550100', CALLER = '+19375550111'
const results = []
const t = async (name, fn) => { try { await fn(); results.push([name, true]) } catch (e) { results.push([name, false, e.message]) } }
const report = (id, status, code) => ({ id, to: [{ phone_number: CALLER, status }], errors: code ? [{ code, title: 'x', detail: 'y' }] : [] })

;(async () => {
  const client = await MongoClient.connect(URL)
  const db = client.db('sms_delivery_sandbox')
  await db.dropDatabase()
  notify.setDb(db)
  const logs = db.collection('phoneLogs'), nums = db.collection('phoneNumbersOf'), wallet = db.collection('walletOf'), inbox = db.collection('webNotifications')
  const seed = async (smsUsed = 3) => {
    await nums.deleteMany({}); await wallet.deleteMany({})
    await nums.insertOne({ _id: CHAT, val: { numbers: [{ phoneNumber: PHONE, status: 'active', plan: 'pro', smsUsed, smsLimit: 100 }] } })
    await wallet.insertOne({ _id: CHAT, usdIn: 10, usdOut: 0 })
  }
  const ctx = { db, notify, log: () => {} }
  const used = async () => (await nums.findOne({ _id: CHAT })).val.numbers[0].smsUsed
  const bal = async () => { const w = await wallet.findOne({ _id: CHAT }); return Math.round((w.usdIn - w.usdOut) * 100) / 100 }

  await t('reasons: toll-free, 10DLC, STOP, landline, unknown', async () => {
    assert.match(sms.reasonOf('40329'), /toll-free number needs texting approval/)
    assert.match(sms.reasonOf(40010), /10DLC/)
    assert.match(sms.reasonOf('40300'), /STOP/)
    assert.match(sms.reasonOf('40001'), /landline/)
    assert.match(sms.reasonOf('', 'Toll-free number not verified'), /toll-free/)
    assert.strictEqual(sms.reasonOf('49999', 'whatever'), null)
  })

  await t('delivered: status on the text and on the missed call it answered; nothing given back, no alert', async () => {
    await seed()
    const call = await logs.insertOne({ phoneNumber: PHONE, from: CALLER, type: 'missed', timestamp: new Date().toISOString(), reply: { text: 'hi', at: 'x', status: 'sent' } })
    await logs.insertOne({ chatId: CHAT, phoneNumber: PHONE, from: PHONE, to: CALLER, type: 'sms_out', body: 'hi', messageId: 'm-ok', status: 'sent', webReply: true, replyTo: String(call.insertedId), timestamp: new Date().toISOString() })
    const r = await sms.applyDeliveryReport(ctx, report('m-ok', 'delivered'))
    assert.deepStrictEqual(r, { status: 'delivered', reason: null })
    assert.strictEqual((await logs.findOne({ messageId: 'm-ok' })).status, 'delivered')
    assert.strictEqual((await logs.findOne({ _id: call.insertedId })).reply.status, 'delivered')
    assert.strictEqual(await used(), 3)
    assert.strictEqual(await inbox.countDocuments({}), 0)
  })

  let failedId
  await t('failed (unverified toll-free): reason saved, plan text + $0.05 given back, refund row, inbox copy + alert', async () => {
    await seed(3)
    const item = await inbox.insertOne({ chatId: CHAT, kind: 'sms', text: 'SMS from x', meta: { from: CALLER, to: PHONE, reply: { text: 'ok', status: 'sent' } }, read: true, createdAt: new Date() })
    failedId = (await logs.insertOne({ chatId: CHAT, phoneNumber: PHONE, from: PHONE, to: CALLER, type: 'sms_out', body: 'ok', messageId: 'm-bad', status: 'sent', webReply: true, charge: 0.05, inboxId: String(item.insertedId), timestamp: new Date().toISOString() })).insertedId
    const r = await sms.applyDeliveryReport(ctx, report('m-bad', 'delivery_failed', '40329'))
    assert.strictEqual(r.status, 'failed'); assert.match(r.reason, /toll-free/)
    const doc = await logs.findOne({ _id: failedId })
    assert.strictEqual(doc.status, 'failed'); assert.strictEqual(doc.smsErrorCode, '40329'); assert.match(doc.smsReason, /toll-free/)
    assert.strictEqual(await used(), 2)
    assert.strictEqual(await bal(), 10.05)
    const tx = await db.collection('transactions').findOne({ _id: `smsref-${failedId}` })
    assert.ok(tx && tx.type === 'sms-refund' && tx.amount === 0.05 && tx.chatId === CHAT)
    const copy = await inbox.findOne({ _id: item.insertedId })
    assert.strictEqual(copy.meta.reply.status, 'failed'); assert.match(copy.meta.reply.reason, /toll-free/)
    const alert = await inbox.findOne({ 'meta.smsFailed': { $exists: true } })
    assert.ok(alert, 'inbox alert'); assert.strictEqual(alert.kind, 'sms'); assert.strictEqual(alert.chatId, CHAT); assert.strictEqual(alert.read, false)
    assert.strictEqual(alert.text, `Your text from ${PHONE} to ${CALLER} wasn’t delivered. ${sms.reasonOf('40329')} You weren’t charged for it.`)
  })

  await t('duplicate failed report: no second give-back or alert', async () => {
    assert.strictEqual(await sms.applyDeliveryReport(ctx, report('m-bad', 'delivery_failed', '40329')), null)
    assert.strictEqual(await used(), 2); assert.strictEqual(await bal(), 10.05)
    assert.strictEqual(await inbox.countDocuments({ 'meta.smsFailed': { $exists: true } }), 1)
  })

  await t('unknown id / not a web text / non-final status: ignored', async () => {
    await logs.insertOne({ phoneNumber: PHONE, to: CALLER, type: 'sms_out', messageId: 'm-bot', status: 'sent' })
    assert.strictEqual(await sms.applyDeliveryReport(ctx, report('nope', 'delivered')), null)
    assert.strictEqual(await sms.applyDeliveryReport(ctx, report('m-bot', 'delivery_failed', '40010')), null)
    assert.strictEqual(await sms.applyDeliveryReport(ctx, report('m-ok', 'sending')), null)
    assert.strictEqual((await logs.findOne({ messageId: 'm-bot' })).status, 'sent')
  })

  await t('failed with no code + plan count at 0 + no chatId on the doc: generic reason, count stays 0, owner found by number', async () => {
    await seed(0)
    await logs.insertOne({ phoneNumber: PHONE, from: PHONE, to: CALLER, type: 'sms_out', messageId: 'm-old', status: 'sent', webReply: true, timestamp: new Date().toISOString() })
    const r = await sms.applyDeliveryReport(ctx, report('m-old', 'sending_failed'))
    assert.strictEqual(r.reason, 'The carrier didn’t deliver this text.')
    assert.strictEqual(await used(), 0)
    assert.strictEqual(await inbox.countDocuments({ 'meta.smsFailed': { $exists: true } }), 2)
  })

  await t('unconfirmed → shown as sent (no give-back)', async () => {
    await seed(1)
    await logs.insertOne({ chatId: CHAT, phoneNumber: PHONE, from: PHONE, to: CALLER, type: 'sms_out', messageId: 'm-unc', status: 'sent', webReply: true, timestamp: new Date().toISOString() })
    assert.strictEqual((await sms.applyDeliveryReport(ctx, report('m-unc', 'delivery_unconfirmed'))).status, 'unconfirmed')
    assert.strictEqual(await used(), 1)
  })

  await t('markReplied carries the reason of a "decline with a text" reply', async () => {
    const calls = [{ _id: new ObjectId(), phoneNumber: PHONE, from: CALLER, type: 'missed', timestamp: new Date().toISOString() }]
    const texts = [{ type: 'sms_out', phoneNumber: PHONE, to: CALLER, body: 'b', timestamp: new Date().toISOString(), status: 'failed', smsReason: 'R' }]
    const [m] = sms.markReplied(calls, texts)
    assert.deepStrictEqual({ status: m.reply.status, reason: m.reply.reason }, { status: 'failed', reason: 'R' })
  })

  const voiceService = { isSmsLimitReached: () => true, incrementSmsUsed: async (c, p) => nums.updateOne({ _id: c, 'val.numbers.phoneNumber': p }, { $inc: { 'val.numbers.$.smsUsed': 1 } }) }
  const sender = sms.createSmsReply({ db, voiceService, log: () => {} })
  const num = { phoneNumber: PHONE, status: 'active', capabilities: { sms: true } }

  await t('send: saves chatId, charge and inbox id on the text', async () => {
    await seed(100)
    const orig = axios.post
    axios.post = async () => ({ data: { data: { id: 'm-new' } } })
    try {
      const r = await sender.send({ chatId: CHAT, num, to: CALLER, text: 'hello', inboxId: 'abc' })
      assert.ok(r.log, JSON.stringify(r.error))
      const doc = await logs.findOne({ messageId: 'm-new' })
      assert.strictEqual(doc.chatId, CHAT); assert.ok(doc.charge > 0); assert.strictEqual(doc.inboxId, 'abc'); assert.strictEqual(doc.status, 'sent')
    } finally { axios.post = orig }
  })

  await t('send refused at once (toll-free not verified): plain reason, nothing charged or counted', async () => {
    await seed(100)
    const orig = axios.post
    axios.post = async () => { const e = new Error('422'); e.response = { data: { errors: [{ code: '40329', title: 'Toll-free not verified', detail: 'nope' }] } }; throw e }
    try {
      const before = await logs.countDocuments({})
      const r = await sender.send({ chatId: CHAT, num, to: CALLER, text: 'hello' })
      assert.deepStrictEqual(r.error, [424, 'sms_failed', sms.reasonOf('40329')])
      assert.strictEqual(await logs.countDocuments({}), before)
      assert.strictEqual(await used(), 100); assert.strictEqual(await bal(), 10)
    } finally { axios.post = orig }
  })

  await db.dropDatabase()
  await client.close()
  for (const [n, p, e] of results) console.log(`${p ? '  ✓' : '  ✗'} ${n}${e ? `\n    ${e}` : ''}`)
  const bad = results.filter(r => !r[1]).length
  console.log(`\n${results.length - bad}/${results.length} passed`)
  process.exit(bad ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
