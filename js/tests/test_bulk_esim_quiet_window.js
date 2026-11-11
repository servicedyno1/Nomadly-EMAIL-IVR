// Quiet hours (8am–9pm US) apply to BulkSMS campaigns only: single texts and tests go out at once; outside the window
// "send now / earliest today" is off and BulkSMS shows a notice with today's UTC window.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const { QN, LANGS } = require('../bulk-esim/i18n')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db('test_bse_quiet')
  await db.dropDatabase()
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  process.env.BULK_ESIM_WORKER = ''
  for (let i = 0; i < 2; i++) await B.provisionOne('test')
  await B.healthCheck()
  await B.setConfig({ platformPerMin: 600, esimPerMin: 200, esimDailyLimit: 5000, warmupDays: 1, quietStart: 23, quietEnd: 23 }, 'test') // window never open
  const cid = (await B.customer('Nomadly', '5168006768'))._id
  const s = await B.sendOne(cid, '+13025141000', 'How is it going? Thanks')
  await B.claimWorker(); await B.tick()
  const m = await db.collection('bsMessages').findOne({ _id: s.messageId })
  ok('single text outside quiet window goes out immediately', ['sent', 'submitted', 'delivered'].includes(m.status), m.status)
  const s2 = await B.sendOne(cid, '+13025141002', 'late deferral')
  await db.collection('bsMessages').updateOne({ _id: s2.messageId }, { $set: { nextAt: new Date(Date.now() + 3 * 3600e3) } })
  await B.claimWorker(); await B.tick()
  ok('a single text deferred hours ahead by an older worker is released and sent', ['sent', 'submitted', 'delivered'].includes((await db.collection('bsMessages').findOne({ _id: s2.messageId })).status))
  const w = await B.sendWindow()
  ok('sendWindow reports closed', w.open === false)
  const nb = await B.createBooking(cid, { now: true, volume: 600 })
  ok('"send now" booking is refused outside the window', nb.error === 'err_slot', nb.error)
  await B.setConfig({ quietStart: 6, quietEnd: 21 }, 'test')
  const real = await B.sendWindow()
  ok('real window is 14:00–02:00 UTC in November', real.from === 14 && real.to === 2, JSON.stringify(real))
  ok('notice exists in every language and names the UTC hours', Object.keys(LANGS).every(l => QN[l] && QN[l](real).includes('14:00') && QN[l](real).includes('02:00')))
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
