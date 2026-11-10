// Live mode: every bot queues BulkSMS admin alerts in the shared DB; only the @Nomadlybot (brand Nomadly) process sends them.
// Run from /app: node js/tests/test_bulk_esim_admin_route.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
delete process.env.WEB_CLOUDIVR_DRY_RUN; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_adminroute`)
  await db.collection('bsNotify').deleteMany({}); await db.collection('bsConfig').deleteMany({ _id: 'state' })
  process.env.CHAT_BOT_BRAND = 'PROSHOP'
  const bot = require('../bulk-esim/bot'), B = require('../bulk-esim/core')
  const direct = []; await bot.init({ db, log: () => {}, notifyAdmin: (t) => direct.push(t) })
  await B.pause('admin', 'route-qa'); await wait(500)
  const q = await db.collection('bsNotify').findOne({ type: 'admin' })
  ok('alert from a non-Nomadly bot is queued for brand Nomadly, not sent by that bot', q?.brand === 'Nomadly' && !q.sent && /PAUSED/.test(q.text) && direct.length === 0, JSON.stringify({ brand: q?.brand, direct: direct.length }))
  bot.startNotices({ sendMessage: async () => {} }, db); await wait(3800)
  ok('PROSHOP bot does not deliver it', !(await db.collection('bsNotify').findOne({ type: 'admin' })).sent && direct.length === 0)
  process.env.CHAT_BOT_BRAND = 'Nomadly'; await wait(3800)
  const after = await db.collection('bsNotify').findOne({ type: 'admin' })
  ok('Nomadly bot delivers it to its admin exactly once', after.sent && direct.length === 1 && /eSIM BulkSMS/.test(direct[0]), String(direct.length))
  await db.collection('bsNotify').deleteMany({}); await db.collection('bsConfig').deleteMany({ _id: 'state' })
  await db.dropDatabase(); console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
