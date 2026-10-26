// Seeds demo campaigns for the Live page / call feed / top areas on the PREVIEW (local) DB. Never dials (dryRun campaigns).
//   node scripts/seed_civr_live_demo.js [email]      (default civr.alice@example.com)   ·   --clean removes them
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: '/app/backend/.env' })
const URL = process.env.MONGO_URL
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(URL || '')) { console.error('REFUSING: not a local Mongo'); process.exit(2) }

const ago = (min) => new Date(Date.now() - min * 60000)
const lead = (i, number, name, extra = {}) => ({ index: i, number, name, status: 'pending', digitPressed: null, transferred: false, transferConnected: false, duration: 0, callSid: null, startedAt: null, answeredAt: null, completedAt: null, hangupCause: null, ...extra })
const stats = (leads) => {
  const s = { total: leads.length, completed: 0, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0, voicemail: 0, voicemailLeft: 0, skipped: 0 }
  for (const l of leads) {
    if (['pending', 'calling', 'ringing'].includes(l.status)) continue
    s.completed++
    if (l.status === 'skipped') s.skipped++
    else if (l.status === 'no_answer') s.noAnswer++
    else if (l.status === 'busy') s.busy++
    else if (l.status === 'failed') s.failed++
    else if (l.status === 'voicemail') { s.voicemail++; if (l.voicemailDropped) s.voicemailLeft++ }
    else { s.answered++; if (l.digitPressed) s.keyPressed++; else s.hungUp++; if (l.transferred) s.transferred++ }
  }
  return s
}

;(async () => {
  const email = process.argv.find(a => a.includes('@')) || 'civr.alice@example.com'
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME)
  const camps = db.collection('bulkCallCampaigns')
  await camps.deleteMany({ seed: 'civr-live-demo' })
  if (process.argv.includes('--clean')) { console.log('removed demo campaigns'); return client.close() }
  const acct = await db.collection('webAccounts').findOne({ email })
  if (!acct) throw new Error(`no web account ${email}`)
  const chatId = String(acct._id)
  const num = await db.collection('phoneNumbersOf').findOne({ _id: chatId })
  const callerId = num?.val?.numbers?.find(n => n.status === 'active' && n.plan === 'business')?.phoneNumber || num?.val?.numbers?.[0]?.phoneNumber || '+17377031678'
  const base = { chatId, callerId, audioUrl: 'https://example.invalid/demo.mp3', audioName: 'Demo message', mode: 'report_only', activeKeys: ['1'], holdMusic: false, provider: 'telnyx', dryRun: true, seed: 'civr-live-demo', transferBackups: [], menu: null, transferNumber: null, voicemailAudioUrl: null }

  const runLeads = [
    lead(0, '+13055550101', 'Ann', { status: 'completed', duration: 34, digitPressed: '1', startedAt: ago(4), answeredAt: ago(3.9), completedAt: ago(3.3) }),
    lead(1, '+13055550102', 'Ben', { status: 'no_answer', startedAt: ago(3), completedAt: ago(2.5) }),
    lead(2, '+12125550103', 'Cara', { status: 'completed', duration: 18, startedAt: ago(2.6), answeredAt: ago(2.5), completedAt: ago(2.2) }),
    lead(3, '+14695550104', 'Dev', { status: 'voicemail', duration: 22, voicemailDropped: true, answeredBy: 'machine', startedAt: ago(2), completedAt: ago(1.6) }),
    lead(4, '+17135550105', 'Eve', { status: 'completed', duration: 41, digitPressed: '1', transferred: true, startedAt: ago(1.8), completedAt: ago(1) }),
    lead(5, '+14155550199', 'Do not call', { status: 'skipped', hangupCause: 'On your do-not-call list', completedAt: ago(1.5) }),
    lead(6, '+13125550106', 'Finn', { status: 'answered', answeredAt: ago(0.5), startedAt: ago(0.7), callSid: 'CAseed-talking' }),
    lead(7, '+16175550107', 'Gia', { status: 'calling', startedAt: ago(0.2), callSid: 'CAseed-ringing' }),
    lead(8, '+447700900108', 'Hal', { status: 'busy', startedAt: ago(1.2), completedAt: ago(1.1) }),
    ...['+13055550109', '+12125550110', '+15125550111', '+14045550112', '+2348031234513', '+16045550114'].map((n, i) => lead(9 + i, n, null)),
  ]
  const running = { ...base, id: 'seed-live-running', name: 'Real estate leads — demo', concurrency: 5, status: 'running', leads: runLeads, stats: stats(runLeads), startedAt: ago(12), createdAt: ago(15), repeat: 'daily', seriesId: 'seed-live-running', runNumber: 1, nextRunId: 'seed-live-next', tz: 'America/New_York' }
  const pausedLeads = [lead(0, '+12145550201', 'Ivy', { status: 'completed', duration: 12, startedAt: ago(30), completedAt: ago(29) }), lead(1, '+12145550202', 'Jo', { status: 'completed', duration: 9, digitPressed: '2', startedAt: ago(28), completedAt: ago(27) }), lead(2, '+12145550203'), lead(3, '+12145550204')]
  const limited = { ...base, id: 'seed-live-limited', name: 'Insurance follow-ups — demo', concurrency: 2, status: 'running', leads: pausedLeads, stats: stats(pausedLeads), startedAt: ago(40), createdAt: ago(45), dailyLimit: 2, dailyCount: { day: new Date().toISOString().slice(0, 10), n: 2 }, waitingForDailyLimit: true, tz: 'UTC' }
  const nextLeads = runLeads.map((l, i) => lead(i, l.number, l.name))
  const next = { ...base, id: 'seed-live-next', name: 'Real estate leads — demo', concurrency: 5, status: 'scheduled', leads: nextLeads, stats: stats(nextLeads), scheduledFor: new Date(Date.now() + 86400000), createdAt: ago(12), repeat: 'daily', seriesId: 'seed-live-running', runNumber: 2, autoRun: true, tz: 'America/New_York' }
  await camps.insertMany([running, limited, next])
  console.log(`seeded 3 demo campaigns for ${email} (${chatId}): seed-live-running, seed-live-limited, seed-live-next`)
  await client.close()
})().catch(e => { console.error(e.message); process.exit(1) })
