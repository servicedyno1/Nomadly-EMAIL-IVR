'use strict'
// Free SIP test calls work with a $0 wallet + a stale low-balance block, show the chosen caller ID, and are never billed.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.TELNYX_SIP_CONNECTION_ID = 'conn-test-sip'
process.env.TELNYX_DEFAULT_ANI = '+18778570205'
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('freetest_' + Date.now())
  const calls = []
  const telnyxApi = new Proxy({}, { get: (_, k) => async (...a) => { calls.push([k, ...a]); return k === 'transferCall' ? { ok: true } : {} } })
  const user = '700000001'
  await db.collection('phoneNumbersOf').insertOne({ _id: 5168006768, val: { numbers: [] } })
  await db.collection('walletOf').insertOne({ _id: user, usdIn: 0, usdOut: 0 })
  await db.collection('testCredentials').insertOne({ sipUsername: 'gencredFREE1', chatId: user, expired: false, callsMade: 0, showAs: '+13366357716', createdAt: new Date() })
  await db.collection('sipPreDialBlocklist').insertOne({ _id: 'gencredFREE1', chatId: user, reason: 'low_balance', blockedAt: new Date('2026-10-03') })
  const vs = require('../voice-service')
  const sent = []
  vs.initVoiceService({ bot: { sendMessage: async (id, t) => sent.push(t) }, phoneNumbersOf: db.collection('phoneNumbersOf'), phoneLogs: db.collection('phoneLogs'), walletOf: db.collection('walletOf'), payments: db.collection('payments'), telnyxApi, telnyxResources: {}, state: db.collection('state'), db, selfUrl: 'https://x.test' })
  require('../phone-test-routes').initPhoneTestRoutes?.({ get: () => {}, post: () => {} }, db, null, null, null)
  const init = (cc, to) => vs.handleVoiceWebhook({ body: { data: { event_type: 'call.initiated', payload: { call_control_id: cc, call_leg_id: cc, direction: 'outgoing', from: 'sip:gencredFREE1@sip.speechcue.com', from_sip_uri: 'gencredFREE1@sip.speechcue.com', to: to, connection_id: 'conn-test-sip', state: 'parked' } } } }, { sendStatus: () => {}, status: () => ({ send: () => {}, json: () => {} }), json: () => {} })
  // Stale in-memory block like production (loaded from DB at boot)

  await wait(1500)
  await init('cc-free-1', '+14173724608')
  await wait(2500)
  const tr = calls.find(c => c[0] === 'transferCall')
  ok(!!tr, 'test call is transferred to the destination (not rejected)')
  ok(tr && tr[3] === '+13366357716', `shows the chosen caller ID (${tr && tr[3]})`)
  ok(!calls.some(c => c[0] === 'rejectCall'), 'no reject')
  const w = await db.collection('walletOf').findOne({ _id: user })
  ok((w.usdOut || 0) === 0, `wallet untouched — no connection fee (usdOut=${w.usdOut || 0})`)
  ok(vs.activeCalls['cc-free-1']?.isTestCall === true, 'session marked as free test call')
  ok(vs._reservedTotal(user) === 0, 'no funds reserved')

  // A normal (non-test) $0 user is still blocked
  calls.length = 0
  await db.collection('walletOf').insertOne({ _id: '700000002', usdIn: 0, usdOut: 0 })
  await db.collection('phoneNumbersOf').insertOne({ _id: '700000002', val: { numbers: [{ phoneNumber: '+15550009999', provider: 'telnyx', status: 'active', plan: 'pro', sipUsername: 'gencredPAID1', expiresAt: '2099-01-01' }] } })
  await vs.handleVoiceWebhook({ body: { data: { event_type: 'call.initiated', payload: { call_control_id: 'cc-paid-1', call_leg_id: 'cc-paid-1', direction: 'outgoing', from: 'sip:gencredPAID1@sip.speechcue.com', from_sip_uri: 'gencredPAID1@sip.speechcue.com', to: '+14173724608', connection_id: 'conn-test-sip', state: 'parked' } } } }, { sendStatus: () => {}, status: () => ({ send: () => {}, json: () => {} }), json: () => {} })
  await wait(2500)
  ok(!calls.some(c => c[0] === 'transferCall'), 'paid user with $0 still cannot call (unchanged)')

  // Once the boot-time blocklist load has run (stale block now in memory), a free test call still goes through.
  for (let i = 0; i < 20 && !(await db.collection('sipPreDialBlocklist').countDocuments()) ; i++) await wait(500)
  await wait(3000)
  calls.length = 0
  await init('cc-free-2', '+14173724609')
  await wait(2500)
  ok(calls.some(c => c[0] === 'transferCall'), 'free test call goes through with the stale block loaded in memory')
  ok(!(await db.collection('sipPreDialBlocklist').findOne({ _id: 'gencredFREE1' })), 'stale low-balance block cleared')
  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
