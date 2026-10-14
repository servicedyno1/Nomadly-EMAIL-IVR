// Test suite for AutoPromo per-blast Lift Metric (#18):
// recordPromoLift() attribution window + dedup, and evaluateBlastLift() scoring
// + zero-lift admin alert. Runs against an isolated local MongoDB database.

const { MongoClient } = require('mongodb')

process.env.TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '999999'
process.env.TELEGRAM_BOT_ON = 'false' // don't need real scheduling

const { initAutoPromo } = require('../auto-promo.js')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const TEST_DB = 'autopromo_lift_test'
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(TEST_DB)
  await db.collection('promoStats').deleteMany({})
  await db.collection('state').deleteMany({})

  // Seed user languages
  await db.collection('state').insertOne({ _id: 'en1', userLanguage: 'en' })
  await db.collection('state').insertOne({ _id: 'en2', userLanguage: 'en' })
  await db.collection('state').insertOne({ _id: 'fr1', userLanguage: 'fr' })

  // Fake bot — captures admin alerts
  const adminMsgs = []
  const bot = {
    sendMessage: async (chatId, text) => { adminMsgs.push({ chatId, text }); return {} },
    getChat: async () => { throw new Error('n/a') },
  }
  const nameOf = db.collection('nameOf')
  const state = db.collection('state')

  const ap = initAutoPromo(bot, db, nameOf, state, null)

  // ── 1. recordPromoLift attribution + dedup ────────────────────────
  console.log('\n[1] recordPromoLift attribution + dedup')
  const enBlast = await db.collection('promoStats').insertOne({
    theme: 'cloudphone', lang: 'en', slot: 'morning', success: 50,
    sentAt: new Date(Date.now() - 5 * MIN), liftStartCount: 0, liftHubTapCount: 0,
    liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })
  const frBlast = await db.collection('promoStats').insertOne({
    theme: 'antired_hosting', lang: 'fr', slot: 'morning', success: 20,
    sentAt: new Date(Date.now() - 5 * MIN), liftStartCount: 0, liftHubTapCount: 0,
    liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })

  await ap.recordPromoLift('en1', 'start')
  let d = await db.collection('promoStats').findOne({ _id: enBlast.insertedId })
  ok('en1 /start counted on EN blast', d.liftStartCount === 1 && d.liftUserIds.includes('en1'))

  await ap.recordPromoLift('en1', 'start') // duplicate — should NOT double count
  d = await db.collection('promoStats').findOne({ _id: enBlast.insertedId })
  ok('duplicate /start deduped (still 1)', d.liftStartCount === 1 && d.liftUserIds.length === 1)

  await ap.recordPromoLift('en2', 'hubtap')
  d = await db.collection('promoStats').findOne({ _id: enBlast.insertedId })
  ok('en2 hubtap counted', d.liftHubTapCount === 1 && d.liftUserIds.includes('en2'))
  ok('EN blast now has 2 unique returners', d.liftUserIds.length === 2)

  // fr1 attributed only to FR blast, not EN
  await ap.recordPromoLift('fr1', 'start')
  const dfr = await db.collection('promoStats').findOne({ _id: frBlast.insertedId })
  const den = await db.collection('promoStats').findOne({ _id: enBlast.insertedId })
  ok('fr1 counted on FR blast', dfr.liftStartCount === 1 && dfr.liftUserIds.includes('fr1'))
  ok('fr1 did NOT leak into EN blast', !den.liftUserIds.includes('fr1'))

  // ── 2. outside the 45-min window → not attributed ─────────────────
  console.log('\n[2] stale blast (>45m) → not attributed')
  const oldBlast = await db.collection('promoStats').insertOne({
    theme: 'domains_shortener', lang: 'en', slot: 'morning', success: 40,
    sentAt: new Date(Date.now() - 90 * MIN), liftStartCount: 0, liftHubTapCount: 0,
    liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })
  // New EN blast is the most recent within window; make the recent one stale too:
  await db.collection('promoStats').updateOne({ _id: enBlast.insertedId }, { $set: { sentAt: new Date(Date.now() - 90 * MIN) } })
  await ap.recordPromoLift('en2', 'start') // both EN blasts now stale → no attribution
  const dOld = await db.collection('promoStats').findOne({ _id: oldBlast.insertedId })
  ok('stale EN blast got no new lift', dOld.liftStartCount === 0)

  // ── 3. evaluateBlastLift scoring + zero-lift alert ────────────────
  console.log('\n[3] evaluateBlastLift scoring')
  // Blast with 3 returners of 30 delivered → 10% lift
  const scored = await db.collection('promoStats').insertOne({
    theme: 'marketplace', lang: 'en', slot: 'evening', success: 30,
    sentAt: new Date(), liftStartCount: 2, liftHubTapCount: 1,
    liftUserIds: ['a', 'b', 'c'], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })
  await ap.evaluateBlastLift(scored.insertedId)
  const ds = await db.collection('promoStats').findOne({ _id: scored.insertedId })
  ok('liftEvaluated set true', ds.liftEvaluated === true)
  ok('liftReturnedUsers = 3', ds.liftReturnedUsers === 3)
  ok('liftRate = 10%', ds.liftRate === 10)

  // Zero-lift blast (0 returners, 25 delivered) → admin alert
  adminMsgs.length = 0
  const zero = await db.collection('promoStats').insertOne({
    theme: 'email_validation', lang: 'en', slot: 'morning', success: 25,
    sentAt: new Date(), liftStartCount: 0, liftHubTapCount: 0,
    liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })
  await ap.evaluateBlastLift(zero.insertedId)
  const dz = await db.collection('promoStats').findOne({ _id: zero.insertedId })
  ok('zero-lift blast evaluated', dz.liftEvaluated === true && dz.liftReturnedUsers === 0)
  // 2026-10-14: one small zero-return blast is normal noise (~0.2% return rates) → no alert without history
  ok('single 25-user zero-lift blast with no history → NOT alerted (normal noise)', !adminMsgs.some(m => /Zero-lift/i.test(m.text)))

  // …but a theme/slot that stays at zero over enough deliveries to be surprising → alerted
  const now = Date.now()
  for (let i = 0; i < 5; i++) await db.collection('promoStats').insertOne({ theme: 'marketplace', lang: 'en', slot: 'morning', success: 1000, sentAt: new Date(now - (i + 1) * 86400000), liftUserIds: [], liftReturnedUsers: 3, liftEvaluated: true })
  for (let i = 0; i < 3; i++) await db.collection('promoStats').insertOne({ theme: 'email_validation', lang: 'en', slot: 'morning', success: 500, sentAt: new Date(now - (i + 1) * 86400000), liftUserIds: [], liftReturnedUsers: 0, liftEvaluated: true })
  adminMsgs.length = 0
  const zero2 = await db.collection('promoStats').insertOne({ theme: 'email_validation', lang: 'en', slot: 'morning', success: 25, sentAt: new Date(), liftStartCount: 0, liftHubTapCount: 0, liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false })
  await ap.evaluateBlastLift(zero2.insertedId)
  ok('theme/slot at 0 over 1550 delivered (≈5.5 expected at 0.36%) → admin alerted once', adminMsgs.some(m => m.chatId === '999999' && /Zero-lift theme/i.test(m.text) && /0 returns from 1550 delivered over 5 blast/.test(m.text)))
  adminMsgs.length = 0
  const zero3 = await db.collection('promoStats').insertOne({ theme: 'email_validation', lang: 'en', slot: 'morning', success: 25, sentAt: new Date(), liftUserIds: [], liftEvaluated: false })
  await ap.evaluateBlastLift(zero3.insertedId)
  ok('…and not again within 7 days (cooldown)', !adminMsgs.some(m => /Zero-lift/i.test(m.text)))

  // Zero-lift but tiny audience (<20) → NO alert (avoid noise)
  adminMsgs.length = 0
  const tiny = await db.collection('promoStats').insertOne({
    theme: 'vps_rdp', lang: 'en', slot: 'morning', success: 5,
    sentAt: new Date(), liftStartCount: 0, liftHubTapCount: 0,
    liftUserIds: [], liftWindowMs: 45 * MIN, liftEvaluated: false,
  })
  await ap.evaluateBlastLift(tiny.insertedId)
  ok('tiny zero-lift blast → no admin noise', adminMsgs.length === 0)

  await db.dropDatabase()
  await client.close()

  console.log(`\n──────────────────────────────`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
