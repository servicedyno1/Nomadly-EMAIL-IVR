#!/usr/bin/env node
// iter208: simulate Telnyx outbound-SIP webhooks against js/voice-service.js with telnyxApi MOCKED.
// User already has 10 live outgoing calls → the 11th call.initiated is answered + spoken to + queued (no transfer,
// no connection fee); transfer happens only after a slot frees. Also: queued caller hangs up → not charged, reservation released;
// queue timeout → "still busy" + hangup; same-destination limit speaks a message instead of silent hangup.
process.env.SIP_QUEUE_MAX_WAIT_MS = '20000'
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CHAT = '990208050', SIPU = 'TESTsipq208', NUM = '+15550208050'
const results = []
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${!ok ? ' :: ' + String(d).slice(0, 600) : ''}`) }

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const walletOf = db.collection('walletOf')
  await walletOf.deleteOne({ _id: CHAT }); await walletOf.insertOne({ _id: CHAT, usdIn: 500, usdOut: 0 })
  const tx = []
  const telnyxApi = new Proxy({}, { get: (_, m) => async (...a) => { tx.push({ m, id: a[0], a: a.slice(1), t: Date.now() }); return { data: {} } } })
  const msgs = []
  const bot = { sendMessage: async (id, text) => { msgs.push({ id: String(id), text }); return {} } }
  const phoneNumbersOf = { find: () => ({ toArray: async () => [{ _id: CHAT, val: { numbers: [{ phoneNumber: NUM, provider: 'telnyx', status: 'active', plan: 'business', sipUsername: SIPU, features: {} }] } }] }), findOne: async () => null, updateOne: async () => ({}) }
  const VS = require('/app/js/voice-service.js')
  const { translation } = require('/app/js/translation.js')
  VS.initVoiceService({ bot, phoneNumbersOf, phoneLogs: { insertOne: async () => ({}), updateOne: async () => ({}) }, telnyxApi, translation, walletOf, payments: null, nanoid: () => 'n' + Date.now() + Math.random() })
  const hook = (event_type, payload) => VS.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus: () => {} })
  const initiated = (ccid, to) => hook('call.initiated', { call_control_id: ccid, direction: 'outgoing', from: `sip:${SIPU}@sip.telnyx.com`, to: `sip:${to}@sip.telnyx.com`, connection_id: 'conn_test_208', state: 'parked' })
  const fees = async () => (await db.collection('walletOf').findOne({ _id: CHAT })).usdOut
  try {
    // 10 live outgoing calls for this user
    for (let i = 0; i < 10; i++) VS.activeCalls[`live${i}`] = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', to: '+1202555010' + i, startedAt: new Date() }
    const usd0 = await fees()
    // 11th call → queued
    const c11 = 'cc_q_11'
    initiated(c11, '+12025550199')
    await sleep(3000)
    const on = m => tx.filter(x => x.id === c11 && x.m === m)
    console.log('INFO telnyx calls for c11:', JSON.stringify(tx.filter(x => x.id === c11).map(x => x.m)))
    check('Q1.queued call answered', on('answerCall').length === 1)
    check('Q1.queued message spoken', on('speakOnCall').some(x => /lines are busy.*queued/i.test(x.a[0])), JSON.stringify(on('speakOnCall')))
    check('Q1.no transfer while queued', on('transferCall').length === 0)
    check('Q1.no connection fee while queued', (await fees()) === usd0, `${usd0} → ${await fees()}`)
    check('Q1.Telegram queued notice', msgs.some(m => m.id === CHAT && /queued/i.test(m.text)), JSON.stringify(msgs))
    check('Q1.reservation held while queued', VS._reservedTotal(CHAT) > 0, VS._reservedTotal(CHAT))
    await sleep(5500)
    check('Q2.hold music after ~7s', on('playbackStart').length === 1, JSON.stringify(on('playbackStart')))
    // free a slot
    delete VS.activeCalls.live0
    await sleep(3500)
    console.log('INFO telnyx calls for c11 after slot freed:', JSON.stringify(tx.filter(x => x.id === c11).map(x => x.m)))
    check('Q3.slot freed → playback stopped + transferCall', on('playbackStop').length >= 1 && on('transferCall').length === 1, JSON.stringify(tx.filter(x => x.id === c11).map(x => x.m)))
    check('Q3.connection fee charged only after dequeue', (await fees()) > usd0, `${usd0} → ${await fees()}`)
    check('Q3.c11 now an active outgoing call', VS.activeCalls[c11]?.direction === 'outgoing')

    // queued call where the caller hangs up first
    const c12 = 'cc_q_12'
    VS.activeCalls.live0 = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', startedAt: new Date() } // full again (10 live incl. c11)
    delete VS.activeCalls.live9
    const f1 = await fees()
    initiated(c12, '+12025550198')
    await sleep(2500)
    check('H1.12th call queued (answered, no transfer)', tx.some(x => x.id === c12 && x.m === 'answerCall') && !tx.some(x => x.id === c12 && x.m === 'transferCall'))
    const resBefore = VS._reservedTotal(CHAT)
    await hook('call.hangup', { call_control_id: c12, direction: 'incoming', from: `sip:${SIPU}@sip.telnyx.com`, to: `sip:+12025550198@sip.telnyx.com`, connection_id: 'conn_test_208', hangup_cause: 'normal_clearing' })
    await sleep(2500)
    delete VS.activeCalls.live1 // a slot frees later — c12 must NOT connect
    await sleep(3000)
    check('H2.hung-up queued call never transferred', !tx.some(x => x.id === c12 && x.m === 'transferCall'))
    check('H2.no fee for hung-up queued call', (await fees()) === f1, `${f1} → ${await fees()}`)
    check('H2.reservation released', VS._reservedTotal(CHAT) < resBefore, `${resBefore} → ${VS._reservedTotal(CHAT)}`)

    // timeout: fill back up and queue one that never gets a slot
    VS.activeCalls.live1 = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', startedAt: new Date() }
    const c13 = 'cc_q_13'; const f2 = await fees()
    initiated(c13, '+12025550197')
    await sleep(22000)
    const s13 = tx.filter(x => x.id === c13)
    console.log('INFO c13:', JSON.stringify(s13.map(x => x.m + (x.m === 'speakOnCall' ? ':' + x.a[0] : ''))))
    check('T1.timeout → "still busy" spoken, no transfer', s13.some(x => x.m === 'speakOnCall' && /still busy/i.test(x.a[0])) && !s13.some(x => x.m === 'transferCall'))
    check('T1.no fee on timeout', (await fees()) === f2)
    await sleep(9500)
    check('T1.hung up after message', tx.some(x => x.id === c13 && x.m === 'hangupCall'))

    // same-destination anti-spam: 4th call to the same number within a minute speaks a message
    for (const k of Object.keys(VS.activeCalls)) delete VS.activeCalls[k]
    for (let i = 1; i <= 4; i++) { initiated('cc_rl_' + i, '+12025550111'); await sleep(1200) }
    await sleep(2000)
    const rl = tx.filter(x => x.id === 'cc_rl_4')
    console.log('INFO cc_rl_4:', JSON.stringify(rl.map(x => x.m + (x.m === 'speakOnCall' ? ':' + x.a[0] : ''))))
    check('R1.4th same-number call → answered + explained, no transfer', rl.some(x => x.m === 'answerCall') && rl.some(x => x.m === 'speakOnCall' && /called this number 3 times/.test(x.a[0])) && !rl.some(x => x.m === 'transferCall'))
    check('R1.calls 1-3 transferred', [1, 2, 3].every(i => tx.some(x => x.id === 'cc_rl_' + i && x.m === 'transferCall')))
  } catch (e) { console.error(e.stack) } finally {
    await walletOf.deleteOne({ _id: CHAT })
    await db.collection('transactions').deleteMany({ chatId: CHAT })
    await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.n).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})()
