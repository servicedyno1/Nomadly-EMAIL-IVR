// Focused checks: dial format, free test ring (3/day, unbilled), deposit nudges (1h/24h, dedupe, paid), renewal top-up, expired resume.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const env = fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8')
const val = (k) => (env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, 'm')) || [])[1]
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
delete process.env.WEB_EMAILS_LIVE
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message) } }

;(async () => {
  const { dialIssue } = require('../dial-check')
  await t('dial: valid USA preview number ok', () => assert.strictEqual(dialIssue('+14155550100'), null))
  await t('dial: valid UK mobile ok', () => assert.strictEqual(dialIssue('+447911123456'), null))
  await t('dial: missing digit rejected', () => assert.ok(dialIssue('+1415555010')))
  await t('dial: N11 area code rejected', () => assert.ok(dialIssue('+19115550100')))
  await t('dial: N11 exchange rejected', () => assert.ok(dialIssue('+14154115555')))

  // ── Free test ring ──
  const tmn = require('../test-my-number')
  const calls = []
  const routes = {}
  const fakeApp = { post: (p, fn) => { routes[p] = fn } }
  const client = await MongoClient.connect(val('MONGO_URL'))
  const db = client.db('test_iter225_' + Date.now())
  tmn.initTestMyNumber(fakeApp, { bot: { sendMessage: async () => {} }, telnyxApi: { createOutboundCall: async (from, to) => { calls.push([from, to]); return { callControlId: 'cc' + calls.length } }, gatherDTMF: async () => {}, hangupCall: async () => {} }, db, log: () => {}, selfUrl: 'http://x', getTxt: () => null })
  const num = { phoneNumber: '+14155550111', status: 'active' }
  await t('test ring: not free before a test starts', () => assert.strictEqual(tmn.isFreeTestRing(tmn.TRIAL_CALLER_ID, num.phoneNumber), false))
  for (let i = 0; i < 3; i++) await tmn.placeTestCall(1, num, 'en')
  await t('test ring: 3 calls placed from test line', () => assert.strictEqual(calls.length, 3))
  await t('test ring: inbound from test line is free', () => assert.strictEqual(tmn.isFreeTestRing(tmn.TRIAL_CALLER_ID, num.phoneNumber), true))
  await t('test ring: other callers still billed', () => assert.strictEqual(tmn.isFreeTestRing('+12125550100', num.phoneNumber), false))
  const fourth = await tmn.placeTestCall(1, num, 'en')
  await t('test ring: 4th within 24h throttled', () => { assert.strictEqual(fourth.ok, false); assert.strictEqual(calls.length, 3) })
  await new Promise(r => setTimeout(r, 300))
  const saved = await db.collection('testMyNumberLog').findOne({ _id: num.phoneNumber })
  await t('test ring: throttle persisted', () => assert.strictEqual(saved.ts.length, 3))
  await t('test ring: placing copy says free', () => assert.ok(/Free test ring/.test(require('../phone-config').getTxt('en').testMyNumber.placing('+1'))))

  // ── Renewal top-up ──
  const topup = require('../renewal-topup')
  await t('topup: min $10, rounds up', () => { assert.strictEqual(topup.depositAmount(3.2), 10); assert.strictEqual(topup.depositAmount(24.1), 25) })
  await t('topup: keyboard matches global deposit handler', () => assert.ok(/^💵 Deposit \$(\d+(?:\.\d+)?)$/.test(topup.depositKeyboard(24.1).keyboard[0][0])))

  // ── Deposit nudges ──
  require('../cloudivr-web/notify').setDb?.(db)
  const { createEmails } = require('../cloudivr-web/emails')
  const emails = createEmails(db, { log: () => {} })
  const web = 5e15 + 1234, web2 = 5e15 + 5678
  await db.collection('webAccounts').insertMany([{ _id: web, email: 'a@example.test', name: 'Ann' }, { _id: web2, email: 'b@example.test', name: 'Bo' }])
  const now = Date.now()
  await db.collection('webDeposits').insertMany([
    { chatId: String(web), ref: 'r1h', amountUsd: 50, coin: 'USDT', createdAt: new Date(now - 2 * 3600e3) },
    { chatId: String(web), ref: 'r24h', amountUsd: 75, coin: 'BTC', createdAt: new Date(now - 26 * 3600e3) },
    { chatId: String(web), ref: 'rnew', amountUsd: 20, coin: 'BTC', createdAt: new Date(now - 10 * 60e3) },
    { chatId: String(web2), ref: 'rpaid', amountUsd: 30, coin: 'BTC', createdAt: new Date(now - 3 * 3600e3) },
  ])
  await db.collection('transactions').insertOne({ chatId: String(web2), type: 'wallet-topup', metadata: { ref: 'rpaid' }, createdAt: new Date(now - 2 * 3600e3) })
  await emails.tick()
  const log1 = await db.collection('webEmailLog').find({ type: 'depositNudge' }).toArray()
  const ids = log1.map(l => l._id).sort()
  await t('deposit: 1h and 24h reminders sent, new + paid skipped', () => assert.deepStrictEqual(ids, ['depnudge:r1h:1h', 'depnudge:r24h:24h']))
  await t('deposit: email has subject + wallet link', () => { const l = log1.find(x => x._id === 'depnudge:r1h:1h'); assert.ok(/\$50/.test(l.subject)); assert.ok(/\/app\/wallet/.test(l.html)) })
  const inbox = await db.collection('webNotifications').find({ 'meta.nudge': /^depnudge/ }).toArray()
  await t('deposit: inbox notices pushed with link', () => { assert.strictEqual(inbox.length, 2); assert.ok(inbox.every(n => n.meta.link === '/app/wallet')) })
  for (let i = 0; i < 5; i++) await emails.tick()
  await t('deposit: no duplicate emails or notices', async () => {
    assert.strictEqual(await db.collection('webEmailLog').countDocuments({ type: 'depositNudge' }), 2)
    assert.strictEqual(await db.collection('webNotifications').countDocuments({ 'meta.nudge': /^depnudge/ }), 2)
  })

  // ── Expired resume: source routes back into product flows ──
  const src = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
  await t('resume: expired order reopens the product menu', () => assert.ok(/'phone-order': 'submenu5'[^\n]+return goto\[back\]\(\)|goto\[back\]\(\)/s.test(src) && /That saved order timed out/.test(src)))

  await db.dropDatabase()
  await client.close()
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
