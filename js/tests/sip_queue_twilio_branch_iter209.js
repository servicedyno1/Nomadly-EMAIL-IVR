#!/usr/bin/env node
// iter209 HIGH-2 retest: outbound SIP from a TWILIO-provider number, user at 10 live calls → 11th is queued.
// Mock Telnyx answerCall THROWS on a second answer of the same leg (like real Telnyx 90018).
// After a slot frees the queued call must proceed to the Twilio bridge transfer (sip:bridge_*@domain), never _abandonBridge.
process.env.SIP_QUEUE_MAX_WAIT_MS = '30000'
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CHAT = '990209070', SIPU = 'TESTsipq209tw', NUM = '+15550209070'
const results = []
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${!ok ? ' :: ' + String(d).slice(0, 800) : ''}`) }

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const walletOf = db.collection('walletOf')
  await walletOf.deleteOne({ _id: CHAT }); await walletOf.insertOne({ _id: CHAT, usdIn: 500, usdOut: 0 })
  const tx = []; const answered = new Set()
  const telnyxApi = new Proxy({}, { get: (_, m) => async (...a) => {
    tx.push({ m, id: a[0], a: a.slice(1), t: Date.now() })
    if (m === 'answerCall') { if (answered.has(a[0])) throw new Error('Call has already been answered (90018)'); answered.add(a[0]) }
    if (m === 'listNumbers') return []
    return { data: {} }
  } })
  const msgs = []
  const bot = { sendMessage: async (id, text) => { msgs.push({ id: String(id), text }); return {} } }
  const numRec = { phoneNumber: NUM, provider: 'twilio', status: 'active', plan: 'business', sipUsername: SIPU, features: {}, twilioSubAccountSid: 'ACtest', twilioSubAccountToken: 'tok', subAccountAuthToken: 'tok' }
  const phoneNumbersOf = { find: () => ({ toArray: async () => [{ _id: CHAT, val: { numbers: [numRec] } }] }), findOne: async () => null, updateOne: async () => ({}) }
  const VS = require('/app/js/voice-service.js')
  const { translation } = require('/app/js/translation.js')
  VS.initVoiceService({ bot, phoneNumbersOf, phoneLogs: { insertOne: async () => ({}), updateOne: async () => ({}) }, telnyxApi, translation, walletOf, payments: null, twilioSipDomainName: 'test209.sip.twilio.com', selfUrl: 'https://x.test', nanoid: () => 'n' + Date.now() + Math.random() })
  const hook = (event_type, payload) => VS.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus: () => {} })
  const initiated = (ccid, to) => hook('call.initiated', { call_control_id: ccid, direction: 'outgoing', from: `sip:${SIPU}@sip.telnyx.com`, to: `sip:${to}@sip.telnyx.com`, connection_id: 'conn_test_209', state: 'parked' })
  const of = id => tx.filter(x => x.id === id).map(x => x.m + (x.m === 'transferCall' ? ':' + x.a[0] : ''))
  try {
    // Baseline: not full → Twilio branch answers once + bridges
    initiated('cc_tw_0', '+12025550500'); await sleep(2500)
    check('T0.unqueued twilio call: single answer + bridge transfer', of('cc_tw_0').filter(m => m === 'answerCall').length === 1 && of('cc_tw_0').some(m => /transferCall:sip:bridge_.*@test209/.test(m)), JSON.stringify(of('cc_tw_0')))
    for (const k of Object.keys(VS.activeCalls)) delete VS.activeCalls[k]
    for (let i = 0; i < 10; i++) VS.activeCalls[`live${i}`] = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', startedAt: new Date() }
    initiated('cc_tw_1', '+12025550501'); await sleep(3000)
    check('T1.queued: answered + spoken, no transfer yet', of('cc_tw_1').includes('answerCall') && of('cc_tw_1').some(m => m === 'speakOnCall') && !of('cc_tw_1').some(m => m.startsWith('transferCall')), JSON.stringify(of('cc_tw_1')))
    delete VS.activeCalls.live0
    await sleep(4500)
    const ops = of('cc_tw_1')
    console.log('INFO cc_tw_1 ops', JSON.stringify(ops))
    check('T2.after slot frees: bridge transfer to Twilio SIP', ops.some(m => /transferCall:sip:bridge_.*@test209/.test(m)), JSON.stringify(ops))
    check('T3.only one answerCall (no second answer)', ops.filter(m => m === 'answerCall').length === 1, JSON.stringify(ops))
    check('T4.no hangup / no abandon', !ops.includes('hangupCall') && !msgs.some(x => /fail|routing/i.test(x.text || '')), JSON.stringify({ ops, msgs: msgs.map(m => m.text.slice(0, 80)) }))
    check('T5.session is outbound_twilio_bridge', VS.activeCalls.cc_tw_1?.phase === 'outbound_twilio_bridge', JSON.stringify(VS.activeCalls.cc_tw_1 && VS.activeCalls.cc_tw_1.phase))
    const usdOut = (await walletOf.findOne({ _id: CHAT })).usdOut
    console.log('INFO usdOut', usdOut)
  } catch (e) { console.error(e.stack) } finally {
    for (const k of Object.keys(VS.activeCalls)) { const s = VS.activeCalls[k]; if (s?._limitTimer) clearInterval(s._limitTimer); delete VS.activeCalls[k] }
    await walletOf.deleteOne({ _id: CHAT })
    await db.collection('transactions').deleteMany({ chatId: CHAT })
    await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.n).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})()
