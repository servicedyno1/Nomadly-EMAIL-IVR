// v2.8.0 SMS-app update notice: app-users-only while BulkSMS is hidden, then upgraded to ALL
// users (minus those already told) once BulkSMS is visible. Isolated local test DB, stub bot.
// Run: node js/tests/test_sms_app_announcement_scope_2026-10.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

const realSetTimeout = global.setTimeout
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 30000 && ms <= 30000 ? 0 : ms, ...a)
const realSetInterval = global.setInterval
global.setInterval = () => 0 // no watchdog loops in the harness

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅', n) } else { fail++; console.log('  ❌', n, x !== undefined ? JSON.stringify(x) : '') } }
const wait = ms => new Promise(r => realSetTimeout(r, ms))

;(async () => {
  const dbName = `sms_announce_test_${Date.now()}`
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(dbName)
  const nameOf = db.collection('nameOf'), loginCountOf = db.collection('loginCountOf')
  await nameOf.insertMany(['101', '102', '103', '104', '105'].map(id => ({ _id: id, val: `user${id}` })))
  await loginCountOf.insertMany([{ _id: '101', val: { appVersion: '2.7.5' } }, { _id: '102', val: { devices: [{ deviceId: 'd' }] } }])
  await db.collection('smsCampaigns').insertOne({ chatId: '103', status: 'completed' })
  await db.collection('promoOptOut').insertOne({ _id: '105', optedOut: true })

  process.env.CHAT_BOT_BRAND = 'Smadav'
  process.env.SELF_URL_PROD = 'https://1.smadavspeech.com'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '999'
  const svc = require('../sms-app-service.js')

  async function boot(hide) {
    process.env.HIDE_SMS_APP = hide ? 'true' : 'false'
    const sent = []
    const bot = { getMe: async () => ({ username: 'smadavv_bot' }), sendMessage: async (id, text) => { sent.push({ id: String(id), text }); return {} } }
    svc.initSmsAppService(db, nameOf, db.collection('planEndingTime'), db.collection('freeSmsCountOf'), loginCountOf, db.collection('planOf'), bot)
    await wait(2500)
    return { users: sent.filter(m => m.id !== '999').map(m => m.id).sort(), all: sent }
  }
  const doc = () => db.collection('appAnnouncements').findOne({ _id: 'sms_app_version' })

  console.log('\n1. BulkSMS hidden → only app users')
  let r = await boot(true)
  ok('1a notice sent to app users 101,102,103 only', JSON.stringify(r.users) === '["101","102","103"]', r.users)
  let d = await doc()
  ok('1b doc scope app-users + notifiedIds stored', d.scope === 'app-users' && d.notifiedIds.sort().join() === '101,102,103' && d.version === '2.8.0', d)
  ok('1c copy names the Smadav bot + link', r.all.some(m => m.text.includes('@smadavv_bot') && m.text.includes('https://1.smadavspeech.com/sms-app/download')))

  console.log('\n2. Restart, still hidden → nothing sent')
  r = await boot(true)
  ok('2a no duplicates', r.users.length === 0, r.users)

  console.log('\n3. BulkSMS enabled → everyone else (minus already told, minus opted-out)')
  r = await boot(false)
  ok('3a only 104 gets it (101-103 already told, 105 opted out)', JSON.stringify(r.users) === '["104"]', r.users)
  d = await doc()
  ok('3b doc upgraded to scope all', d.scope === 'all', d)

  console.log('\n4. Restart, visible → nothing sent')
  r = await boot(false)
  ok('4a no duplicates', r.users.length === 0, r.users)

  console.log('\n5. Legacy doc (no scope) = earlier all-users broadcast → skip')
  await db.collection('appAnnouncements').replaceOne({ _id: 'sms_app_version' }, { version: '2.8.0', announcedAt: new Date() })
  r = await boot(false)
  ok('5a legacy doc not re-broadcast', r.users.length === 0, r.users)

  await client.db(dbName).dropDatabase()
  await client.close()
  console.log(`\nResult: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
