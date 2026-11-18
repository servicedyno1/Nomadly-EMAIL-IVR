'use strict'
// SIP status badge, old SIP login sweep (once per old login, Telegram vs Inbox) and the private calendar feed.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const assert = require('assert')
const { MongoClient } = require('mongodb')
const sp = require('../sip-presence')
const sweep = require('../sip-old-login-sweep')
const cal = require('../renewal-calendar')
const notify = require('../cloudivr-web/notify')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, '—', e.message) } }
const now = new Date('2026-12-01T12:00:00Z'), MIN = 60000, DAY = 86400000
const num = (phone, user, extra = {}) => ({ phoneNumber: phone, plan: 'pro', planPrice: 100, status: 'active', autoRenew: true, expiresAt: new Date(now.getTime() + 10 * DAY).toISOString(), telnyxSipUsername: user, sipUsername: user, ...extra })

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL)
  const db = cl.db(`sipsweep_test_${Date.now()}`)
  notify.setDb(db)
  try {
    await db.collection('appSettings').insertOne({ _id: 'sipPresenceSince', at: new Date(now - 5 * DAY) })
    const bot = '6000001', web = '5000000000009001'
    await db.collection('phoneNumbersOf').insertMany([
      { _id: bot, val: { numbers: [num('+15550001111', 'cvnewbot01'), num('+15550002222', 'cvswitched')] } },
      { _id: web, val: { numbers: [num('+15550003333', 'cvnewweb01')] } },
    ])
    await db.collection('sipPresence').insertMany([
      { _id: 'cvoldbot01', chatId: bot, phoneNumber: '+15550001111', at: new Date(now - 2 * DAY), until: new Date(now - 2 * DAY + 600000) },
      { _id: 'cvoldweb01', chatId: web, phoneNumber: '+15550003333', at: new Date(now - 3 * DAY), until: new Date(now - 3 * DAY) },
      { _id: 'cvoldswtch', chatId: bot, phoneNumber: '+15550002222', at: new Date(now - 4 * DAY), until: new Date(now - 4 * DAY) },
      { _id: 'cvswitched', chatId: bot, phoneNumber: '+15550002222', at: new Date(now - MIN), until: new Date(now.getTime() + 9 * MIN), ua: 'Zoiper' },
      { _id: 'cvancient1', chatId: bot, phoneNumber: '+15550001111', at: new Date(now - 60 * DAY), until: new Date(now - 60 * DAY) },
    ])

    await t('badge: signed in while the registration runs, with app and device count', async () => {
      const s = await sp.status(db, num('+15550002222', 'cvswitched'), now)
      assert.strictEqual(s.state, 'signed_in'); assert.strictEqual(s.devices, 1); assert.strictEqual(s.lastApp, 'Zoiper')
      assert.match(sp.statusLine(s, 'en'), /Signed in/)
    })
    await t('badge: not signed in once the registration ran out; never-seen login says so', async () => {
      const later = new Date(now.getTime() + 15 * MIN)
      assert.strictEqual((await sp.status(db, num('+15550002222', 'cvswitched'), later)).state, 'signed_out')
      const s = await sp.status(db, num('+15550001111', 'cvnewbot01'), now)
      assert.strictEqual(s.state, 'signed_out'); assert.match(sp.statusLine(s, 'en'), /No app has signed in/)
    })
    await t('sweep: finds only recent replaced logins whose owner has not switched yet', async () => {
      const c = await sweep.candidates(db, now)
      assert.deepStrictEqual(c.map(x => x.old).sort(), ['cvoldbot01', 'cvoldweb01'])
      assert.strictEqual(c.find(x => x.old === 'cvoldbot01').current, 'cvnewbot01')
    })
    await t('sweep: Telegram message with reset button for bot users, Inbox notice for web users; never the password', async () => {
      const sent = []
      const fake = { sendMessage: async (id, text, opts) => { sent.push({ id, text, opts }); return {} } }
      assert.strictEqual(await sweep.run({ db, bot: fake, now, log: () => {} }), 2)
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0].id, bot)
      assert.strictEqual(sent[0].opts.reply_markup.inline_keyboard[0][0].callback_data, 'sipold:+15550001111')
      assert.match(sent[0].text, /cvnewbot01/); assert.doesNotMatch(sent[0].text, /password:/i)
      const inbox = await db.collection('webNotifications').findOne({ chatId: web })
      assert.strictEqual(inbox.meta.sipReset, '+15550003333'); assert.match(inbox.text, /cvnewweb01/)
    })
    await t('sweep: each old login is told only once', async () => {
      const fake = { sendMessage: async () => ({}) }
      assert.strictEqual(await sweep.run({ db, bot: fake, now: new Date(now.getTime() + DAY), log: () => {} }), 0)
    })
    await t('feed: same private link until reset; old token stops working; unknown token → null', async () => {
      process.env.CLOUDIVR_PUBLIC_URL = 'https://example.test'
      const a = await cal.links(db, bot), b = await cal.links(db, bot)
      assert.strictEqual(a.url, b.url); assert.match(a.webcal, /^webcal:\/\/example\.test\/api\/cloudivr-web\/public\/calendar\/[a-f0-9]{48}\.ics$/); assert.match(a.google, /^https:\/\/calendar\.google\.com\//)
      const token = a.url.match(/([a-f0-9]{48})\.ics$/)[1]
      const ics = await cal.feed(db, token, now)
      assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /BEGIN:VEVENT/); assert.match(ics, /DTSTART;VALUE=DATE:20261211/)
      const c = await cal.links(db, bot, true)
      assert.notStrictEqual(c.url, a.url)
      assert.strictEqual(await cal.feed(db, token, now), null)
      assert.strictEqual(await cal.feed(db, 'nope', now), null)
    })
  } finally {
    await db.dropDatabase(); await cl.close()
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  }
})()
