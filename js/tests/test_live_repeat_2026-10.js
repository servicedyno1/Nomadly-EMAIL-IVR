// Harness — repeat runs, daily call limit and do-not-call on every campaign. Uses a throwaway DB on the LOCAL Mongo.
//   node js/tests/test_live_repeat_2026-10.js
const URL = 'mongodb://127.0.0.1:27017'
process.env.MONGO_URL = URL
process.env.DB_NAME = 'civr_live_repeat_harness'
process.env.BULK_TELNYX_DIAL_GAP_MS = '0'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const { MongoClient } = require('mongodb')
const { DateTime } = require('luxon')
const voice = require('../voice-service.js')
const bulk = require('../bulk-call-service.js')
const sched = require('../campaign-schedule.js')
const live = require('../cloudivr-web/campaign-live.js')
const dncStore = require('../ai-agent/store.js')
const { translation } = require('../translation.js')

const results = []
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const dials = []
let seq = 0
const telnyxStub = {
  async createOutboundCall(from, to) { const id = `v3:cc-${++seq}`; dials.push({ id, to }); return { callControlId: id } },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} }, async gatherStop() { return {} },
  async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} }, async hangupCall() { return {} },
}
const botStub = { sendMessage: async () => ({}), sendDocument: async () => ({}) }
const L = (i) => `+1415555${String(2000 + i)}`
const leadsN = (n) => Array.from({ length: n }, (_, i) => ({ number: L(i), name: `P${i}` }))

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), camps = db.collection('bulkCallCampaigns')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf: db.collection('phoneNumbersOf'), phoneLogs: db.collection('phoneLogs'), telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  await bulk.initBulkCallService(db, botStub, null, walletOf, null)
  dncStore.init(db)
  const A = '9000000700', caller = '+18885550700'
  await walletOf.insertOne({ _id: A, usdIn: 100, usdOut: 0 })

  // 1. next run keeps the local time across a DST change (New York, Nov 1 2026)
  const ny = (s) => DateTime.fromISO(s, { zone: 'America/New_York' }).toJSDate()
  const n1 = sched.nextRunAt({ repeat: 'daily', tz: 'America/New_York', scheduledFor: ny('2026-10-31T09:00') }, ny('2026-10-31T09:01'))
  ok('daily repeat keeps 9:00 local across DST', DateTime.fromJSDate(n1).setZone('America/New_York').toFormat('yyyy-MM-dd HH:mm') === '2026-11-01 09:00', n1.toISOString())
  const n2 = sched.nextRunAt({ repeat: 'weekly', tz: 'America/New_York', scheduledFor: ny('2026-10-20T14:30') }, ny('2026-10-29T10:00'))
  ok('weekly repeat skips past weeks', DateTime.fromJSDate(n2).setZone('America/New_York').toFormat('yyyy-MM-dd HH:mm') === '2026-11-03 14:30', n2.toISOString())

  // 2. repeat campaign → series + exactly one next run
  const c = await bulk.createCampaign({ chatId: A, callerId: caller, audioUrl: 'https://x.invalid/a.mp3', audioName: 'Msg', name: 'Daily follow-ups', mode: 'report_only', leads: leadsN(3), provider: 'telnyx', repeat: 'daily', tz: 'America/New_York', concurrency: 5 })
  ok('repeat campaign starts a series', c.seriesId === c.id && c.runNumber === 1 && c.repeat === 'daily')
  await camps.updateOne({ id: c.id }, { $set: { leads: c.leads.map(l => ({ ...l, status: 'completed', duration: 12 })) } })
  const doc = await camps.findOne({ id: c.id })
  const [a, b] = await Promise.all([bulk.spawnNextRun({ ...doc, startedAt: new Date() }), bulk.spawnNextRun({ ...doc, startedAt: new Date() })])
  const runs = await camps.find({ seriesId: c.id, autoRun: true }).toArray()
  ok('next run is made once', runs.length === 1 && [a, b].filter(Boolean).length === 1, `${runs.length} runs`)
  const r2 = runs[0]
  ok('next run: same numbers, fresh results, scheduled', r2.status === 'scheduled' && r2.runNumber === 2 && r2.leads.length === 3 && r2.leads.every(l => l.status === 'pending' && !l.duration) && r2.name === 'Daily follow-ups' && r2.scheduledFor > new Date())

  // 3. a due run waits while the previous run is still calling
  await camps.updateOne({ id: c.id }, { $set: { status: 'running' } })
  await camps.updateOne({ id: r2.id }, { $set: { scheduledFor: new Date(Date.now() - 60000) } })
  await bulk.launchDueScheduledCampaigns()
  const r2b = await camps.findOne({ id: r2.id })
  ok('due run moved while the previous one is calling', r2b.status === 'scheduled' && r2b.scheduledFor > new Date() && !!r2b.lastSkippedAt, r2b.status)

  // 4. stop repeating cancels the upcoming run, current run keeps going
  const sr = await bulk.stopRepeat(c.id)
  const [c4, r24] = await Promise.all([camps.findOne({ id: c.id }), camps.findOne({ id: r2.id })])
  ok('stop repeating cancels the upcoming run', sr.success && sr.cancelledRuns === 1 && r24.status === 'cancelled' && r24.cancelledReason === 'Repeat stopped' && c4.status === 'running' && c4.repeat === null)
  await camps.updateOne({ id: c.id }, { $set: { status: 'completed' } })

  // 5. daily slots are exact under concurrent batches
  await camps.insertOne({ id: 'slot-test', dailyLimit: 3, tz: 'UTC' })
  const got = await Promise.all(Array.from({ length: 10 }, () => sched.reserveDailySlot(camps, { id: 'slot-test', dailyLimit: 3, tz: 'UTC' })))
  ok('daily limit: 10 parallel tries → 3 calls', got.filter(Boolean).length === 3, JSON.stringify(got))

  // 6. daily limit pauses dialing for the day, next day continues
  const d = await bulk.createCampaign({ chatId: A, callerId: caller, audioUrl: 'https://x.invalid/a.mp3', audioName: 'Msg', mode: 'report_only', leads: leadsN(5), provider: 'telnyx', dailyLimit: 2, tz: 'UTC', concurrency: 5 })
  dials.length = 0
  await bulk.startCampaign(d.id); await sleep(400)
  let dd = await camps.findOne({ id: d.id })
  ok('daily limit 2 → 2 dials, waiting for tomorrow', dials.length === 2 && dd.waitingForDailyLimit === true && dd.dailyCount.n === 2 && dd.leads.filter(l => l.status === 'pending').length === 3, `${dials.length} dials`)
  const lv = live.liveView(dd, voice)
  ok('live view: 2 ringing, 3 waiting, no ETA while waiting', lv.pipeline.ringing === 2 && lv.pipeline.waiting === 3 && lv.etaSec === null && lv.linesInUse === 2, JSON.stringify(lv))
  await camps.updateOne({ id: d.id }, { $set: { 'dailyCount.day': '2000-01-01' } })
  await bulk.fireNextBatch(d.id); await sleep(300)
  dd = await camps.findOne({ id: d.id })
  ok('next day: 2 more dials', dials.length === 4 && dd.dailyCount.n === 2, `${dials.length} dials`)
  await bulk.cancelCampaign(d.id, 'test', { sendReport: false })

  // 7. do-not-call skips numbers in a regular (non-AI) campaign
  await dncStore.addDnc(A, L(1))
  const e = await bulk.createCampaign({ chatId: A, callerId: caller, audioUrl: 'https://x.invalid/a.mp3', audioName: 'Msg', mode: 'report_only', leads: leadsN(3), provider: 'telnyx', concurrency: 5 })
  dials.length = 0
  await bulk.startCampaign(e.id); await sleep(400)
  const ee = await camps.findOne({ id: e.id })
  ok('do-not-call number skipped in a Bulk IVR campaign', !dials.some(x => x.to === L(1)) && dials.length === 2 && ee.leads[1].status === 'skipped' && ee.stats.skipped === 1, JSON.stringify(dials.map(x => x.to)))
  ok('countDnc finds it', (await dncStore.countDnc(A, [L(0), L(1), L(1)])) === 1)

  // 8. feed + areas
  const fakeC = { id: 'f', name: 'F', status: 'running', leads: [
    { number: '+13055550001', status: 'completed', duration: 20, digitPressed: '1', completedAt: new Date(Date.now() - 1000) },
    { number: '+13055550002', status: 'no_answer', completedAt: new Date(Date.now() - 5000) },
    { number: '+12125550003', status: 'calling', startedAt: new Date(), callSid: 'none' },
    { number: '+447700900004', status: 'pending' },
  ] }
  const feed = live.feedOf([fakeC], voice)
  ok('feed: calling first, then newest finished', feed.length === 3 && feed[0].phase === 'ringing' && feed[0].area === 'New York' && feed[1].digitPressed === '1' && feed[1].area === 'Florida')
  const areas = live.areasOf(fakeC)
  ok('areas: Florida 2 numbers, 1 answered', areas[0].area === 'Florida' && areas[0].numbers === 2 && areas[0].answered === 1 && areas[0].called === 2, JSON.stringify(areas))

  await db.dropDatabase(); await client.close()
  for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.pass || !r.detail ? '' : ` — ${r.detail}`}`)
  const failed = results.filter(r => !r.pass).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
