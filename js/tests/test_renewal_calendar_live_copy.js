'use strict'
// Renewal calendar + low-wallet reminders, writes landing on the live copy of a re-bought number, extra-number plan
// lock on single buys, and the SIP login facts / old-login notice. Uses a scratch database on the local Mongo.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const assert = require('assert')
const { MongoClient } = require('mongodb')
const cal = require('../renewal-calendar')
const live = require('../live-number')
const sp = require('../sip-presence')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, '—', e.message) } }
const DAY = 86400000
const now = new Date('2026-12-01T12:00:00Z')
const inDays = (d) => new Date(now.getTime() + d * DAY)
const num = (phone, days, extra = {}) => ({ phoneNumber: phone, plan: 'pro', planPrice: 100, status: 'active', autoRenew: true, expiresAt: inDays(days).toISOString(), ...extra })
const sub = (phone, days, extra = {}) => num(phone, days, { isSubNumber: true, parentNumber: '+15550000001', planPrice: 25, ...extra })

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL)
  const db = cl.db(`rcal_test_${Date.now()}`)
  try {
    const main = num('+15550000001', 10)
    const src = { numbers: [main, sub('+15550000002', 10), sub('+15550000003', 4), sub('+15550000004', 10, { autoRenew: false })], lines: [{ _id: 'es_1', kind: 'mobile', phoneNumber: '+12025550111', price: 50, autoRenew: true, expiresAt: inDays(21), nextBillAt: inDays(20), status: 'active' }], hosted: [], fax: [{ phoneNumber: '+15557770000', price: 50, autoRenew: false, expiresAt: inDays(6).toISOString(), status: 'active' }] }
    const price = require('../plan-lifecycle').renewalPrice(main)

    await t('calendar: one plan bill on the main date with only the extras already on that date', () => {
      const e = cal.entries(src, now).filter(x => !x.projected)
      const plan = e.find(x => x.kind === 'plan' && x.type === 'charge')
      assert.strictEqual(plan.amount, price + 25)
      assert.strictEqual(plan.parts.length, 2)
      assert.strictEqual(plan.date.slice(0, 10), inDays(10).toISOString().slice(0, 10))
    })
    await t('calendar: an extra still on its own date is a separate, prorated charge', () => {
      const x = cal.entries(src, now).find(e => e.phone === '+15550000003' && e.type === 'charge')
      assert.strictEqual(x.date.slice(0, 10), inDays(4).toISOString().slice(0, 10))
      assert.strictEqual(x.amount, 5) // 6 of 30 days of $25
    })
    await t('calendar: lines with auto-renew off show as ending, with no charge', () => {
      const ends = cal.entries(src, now).filter(e => e.type === 'ends').map(e => e.phone).sort()
      assert.deepStrictEqual(ends, ['+15550000004', '+15557770000'])
    })
    await t('calendar: Texting Number is charged on its bill date; later months are estimates incl. the joined extra', () => {
      const e = cal.entries(src, now)
      assert.strictEqual(e.find(x => x.kind === 'texting').date.slice(0, 10), inDays(20).toISOString().slice(0, 10))
      const next = e.find(x => x.kind === 'plan' && x.projected)
      assert.strictEqual(next.amount, price + 50)
    })
    await t('calendar: a suspended number shows its release date and a main with auto-renew off ends with its extras', () => {
      const e = cal.entries({ numbers: [num('+15550000001', 5, { autoRenew: false }), sub('+15550000002', 5), num('+15550000009', -2, { status: 'suspended', _holdUntil: inDays(5).toISOString() })] }, now)
      assert.strictEqual(e.filter(x => x.type === 'charge').length, 0)
      assert.ok(e.find(x => x.phone === '+15550000001').title.includes('1 extra number'))
      assert.ok(e.find(x => x.phone === '+15550000009').title.includes('On hold'))
    })
    await t('wallet cover: charges are walked in date order and the first uncovered one is named', () => {
      const s = cal.summarize(cal.entries(src, now), 20, now)
      assert.strictEqual(s.entries.find(e => e.phone === '+15550000003').covered, true)
      assert.strictEqual(s.firstShort.phone, '+15550000001')
      assert.strictEqual(s.due30, 5 + price + 25 + 50)
      assert.strictEqual(s.shortBy30, s.due30 - 20)
      assert.ok(s.months.length >= 1 && s.months[0].total > 0)
    })
    await t('low wallet: nothing when the wallet covers the next 3 days', () => {
      assert.strictEqual(cal.shortSoon(cal.summarize(cal.entries(src, now), 20, now), now), null)
      assert.strictEqual(cal.shortSoon(cal.summarize(cal.entries({ numbers: [num('+15550000001', 2)] }, now), 500, now), now), null)
    })
    await t('low wallet: 3-day stage, then 1-day stage, with the missing amount', () => {
      const a = cal.shortSoon(cal.summarize(cal.entries({ numbers: [num('+15550000001', 2.5)] }, now), 30, now), now)
      assert.deepStrictEqual([a.stage, a.due, a.shortBy], [3, price, price - 30])
      const b = cal.shortSoon(cal.summarize(cal.entries({ numbers: [num('+15550000001', 0.8)] }, now), 30, now), now)
      assert.strictEqual(b.stage, 1)
    })
    await t('bot calendar text lists dated charges, wallet and the shortfall', () => {
      const txt = cal.botText(cal.summarize(cal.entries(src, now), 20, now), 'en', now)
      assert.ok(txt.includes('Renewal calendar') && txt.includes('+15550000001') && txt.includes('short'))
      assert.ok(cal.botText(cal.summarize([], 0, now), 'fr', now).includes('Aucun renouvellement'))
      assert.ok(cal.isButton('📅 Renewal Calendar') && cal.isButton('/renewals') && !cal.isButton('hello'))
    })

    await t('reminder job: sent once per stage only to accounts whose wallet is short (bot + web ids)', async () => {
      const soon = (d) => new Date(Date.now() + d * DAY)
      await db.collection('phoneNumbersOf').insertMany([
        { _id: 111, val: { numbers: [{ ...num('+15550000001', 0), expiresAt: soon(2.6).toISOString() }] } },
        { _id: '222', val: { numbers: [{ ...num('+15550000011', 0), expiresAt: soon(2.6).toISOString() }] } },
        { _id: '333', val: { numbers: [{ ...num('+15550000021', 0), expiresAt: soon(2.6).toISOString(), autoRenew: false }] } },
      ])
      await db.collection('faxNumbers').insertOne({ _id: '+15557770001', phoneNumber: '+15557770001', chatId: '444', status: 'active', price: 50, autoRenew: true, expiresAt: soon(0.5).toISOString() })
      await db.collection('walletOf').insertMany([{ _id: 111, usdIn: 10, usdOut: 0 }, { _id: '222', usdIn: 900, usdOut: 0 }, { _id: '444', usdIn: 5, usdOut: 0 }])
      const sent = []
      const bot = { sendMessage: async (id, text, o) => { sent.push({ id: String(id), text, o }) } }
      assert.strictEqual(await cal.remind({ db, bot, log: () => {} }), 2)
      assert.deepStrictEqual(sent.map(s => s.id).sort(), ['111', '444'])
      assert.ok(sent.find(s => s.id === '111').text.includes('3 days') && sent.find(s => s.id === '444').text.includes('tomorrow'))
      assert.ok(sent[0].o.reply_markup.keyboard[0][0].includes('Deposit'))
      assert.strictEqual(await cal.remind({ db, bot, log: () => {} }), 0)
      await db.collection('walletOf').updateOne({ _id: 111 }, { $set: { usdIn: 1000 } })
      await db.collection('renewalShortNotices').deleteMany({})
      assert.strictEqual(await cal.remind({ db, bot, log: () => {} }), 1) // only 444 is still short
    })

    await t('live copy: a write on a re-bought number lands on the live entry, not the old released one', async () => {
      const col = db.collection('liveTest')
      await col.insertOne({ _id: 'u1', val: { numbers: [{ phoneNumber: '+1700', status: 'released', features: {} }, { phoneNumber: '+1700', status: 'active', features: {} }, { phoneNumber: '+1800', status: 'released' }] } })
      await live.updateLive(col, 'u1', '+1700', { $set: { 'val.numbers.$.features.recording': true } })
      const n = (await col.findOne({ _id: 'u1' })).val.numbers
      assert.strictEqual(n[0].features.recording, undefined)
      assert.strictEqual(n[1].features.recording, true)
      await live.updateLive(col, 'u1', '+1800', { $set: { 'val.numbers.$.note': 'x' } }) // released only → plain match still works
      assert.strictEqual((await col.findOne({ _id: 'u1' })).val.numbers[2].note, 'x')
    })
    await t('live copy: no positional write by phone number alone is left in the app code', () => {
      const { execSync } = require('child_process')
      const out = execSync(`grep -rnE "updateOne\\(\\s*\\{ _id: [^,{}]+, 'val\\.numbers\\.phoneNumber'" --include=*.js ${__dirname}/.. | grep -v node_modules | grep -v "/tests/\\|/ops/\\|live-number.js" || true`).toString().trim()
      assert.strictEqual(out, '')
    })

    await t('single extra buy takes the plan lock and re-checks the free slots', async () => {
      const src2 = require('fs').readFileSync(require('path').join(__dirname, '../cloudivr-web/numbers.js'), 'utf8')
      assert.ok(/planLock = args\.sub && !args\.planLocked/.test(src2) && /subSlotsLeft\(args\.sub\.plan, used\)/.test(src2))
      const ex = require('fs').readFileSync(require('path').join(__dirname, '../cloudivr-web/extras.js'), 'utf8')
      assert.ok(ex.includes('planLocked: picks.length > 1'))
    })

    await t('SIP: sign-in remembers the owner; an old login trying again tells the owner the current username (once per 6 h)', async () => {
      await db.collection('phoneNumbersOf').insertOne({ _id: 'own1', val: { numbers: [{ phoneNumber: '+15551230000', plan: 'pro', status: 'active', telnyxSipUsername: 'cvolduser01', sipUsername: 'cvolduser01', sipPassword: 'x' }] } })
      await sp.record(db, 'cvolduser01', 300, 'Zoiper v2')
      assert.strictEqual((await db.collection('sipPresence').findOne({ _id: 'cvolduser01' })).chatId, 'own1')
      await db.collection('phoneNumbersOf').updateOne({ _id: 'own1' }, { $set: { 'val.numbers.0.telnyxSipUsername': 'cvnewuser02', 'val.numbers.0.sipUsername': 'cvnewuser02' } })
      const sent = []
      const bot = { sendMessage: async (id, text) => { sent.push([id, text]) } }
      assert.strictEqual(await sp.noteStale({ db, bot, user: 'cvolduser01', log: () => {} }), true)
      assert.ok(sent[0][0] === 'own1' && sent[0][1].includes('cvolduser01') && sent[0][1].includes('cvnewuser02'))
      assert.strictEqual(await sp.noteStale({ db, bot, user: 'cvolduser01', log: () => {} }), false)
      assert.strictEqual(await sp.noteStale({ db, bot, user: 'cvneverseen', log: () => {} }), false)
    })
    await t('SIP facts for support: wrong password, old login, never tried, signed in', async () => {
      const n = (await db.collection('phoneNumbersOf').findOne({ _id: 'own1' })).val.numbers[0]
      let f = await sp.facts(db, 'own1', n)
      assert.ok(f.includes('no app has ever signed in') && f.includes('no sign-in attempt') && f.includes('OLD replaced username cvolduser01'))
      await sp.noteAsk(db, 'cvnewuser02', true)
      f = await sp.facts(db, 'own1', n)
      assert.ok(f.includes('PASSWORD typed in the app is wrong'))
      await db.collection('sipAuthAsks').updateOne({ _id: 'cvnewuser02' }, { $set: { selfAt: new Date() } })
      assert.ok(!(await sp.facts(db, 'own1', n)).includes('PASSWORD typed'))
      await sp.record(db, 'cvnewuser02', 300, 'Zoiper v2')
      assert.ok((await sp.facts(db, 'own1', n)).includes('signed in RIGHT NOW'))
    })
  } finally { await db.dropDatabase().catch(() => {}); await cl.close() }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
