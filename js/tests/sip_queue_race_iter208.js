#!/usr/bin/env node
// iter208 RACE checks: simulate Telnyx outbound-SIP webhooks against js/voice-service.js with telnyxApi MOCKED.
// User already has 10 live outgoing calls → the 11th call.initiated is answered + spoken to + queued (no transfer,
// no connection fee); transfer happens only after a slot frees. Also: queued caller hangs up → not charged, reservation released;
// queue timeout → "still busy" + hangup; same-destination limit speaks a message instead of silent hangup.
process.env.SIP_QUEUE_MAX_WAIT_MS = '30000'
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
    // RACE A: 9 live calls, 3 SIP calls arrive at the same moment → how many get transferred at once?
    for (let i = 0; i < 9; i++) VS.activeCalls[`live${i}`] = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', startedAt: new Date() }
    initiated('cc_ra_1', '+12025550301'); initiated('cc_ra_2', '+12025550302'); initiated('cc_ra_3', '+12025550303')
    await sleep(4000)
    const tr = ['cc_ra_1', 'cc_ra_2', 'cc_ra_3'].filter(id => tx.some(x => x.id === id && x.m === 'transferCall'))
    const live = Object.values(VS.activeCalls).filter(c => c.chatId === CHAT && c.direction === 'outgoing').length
    console.log('INFO burst: transferred', tr.length, 'live now', live)
    check('RACE-A.burst never exceeds 10 live calls', live <= 10, `live=${live} transferred=${tr.length}`)
    // RACE B: full (10), two queued; one slot frees → only one should connect
    for (const k of Object.keys(VS.activeCalls)) delete VS.activeCalls[k]
    await sleep(6000) // let the RACE-A queued calls drain
    console.log('INFO RACE-A queued calls connected after drain:', ['cc_ra_1', 'cc_ra_2', 'cc_ra_3'].filter(id => tx.some(x => x.id === id && x.m === 'transferCall')).length)
    for (const k of Object.keys(VS.activeCalls)) delete VS.activeCalls[k]
    for (let i = 0; i < 10; i++) VS.activeCalls[`live${i}`] = { chatId: CHAT, direction: 'outgoing', phase: 'outbound_telnyx', startedAt: new Date() }
    initiated('cc_rb_1', '+12025550401'); await sleep(300); initiated('cc_rb_2', '+12025550402')
    await sleep(3000)
    delete VS.activeCalls.live0
    await sleep(5000)
    const trb = ['cc_rb_1', 'cc_rb_2'].filter(id => tx.some(x => x.id === id && x.m === 'transferCall'))
    const liveB = Object.values(VS.activeCalls).filter(c => c.chatId === CHAT && c.direction === 'outgoing').length
    console.log('INFO one slot freed: transferred', JSON.stringify(trb), 'live now', liveB)
    check('RACE-B.one freed slot → exactly one queued call connects (FIFO first)', trb.length === 1 && trb[0] === 'cc_rb_1' && liveB === 10, `transferred=${JSON.stringify(trb)} live=${liveB}`)
  } catch (e) { console.error(e.stack) } finally {
    await walletOf.deleteOne({ _id: CHAT })
    await db.collection('transactions').deleteMany({ chatId: CHAT })
    await mc.close()
  }
  const f = results.filter(r => !r.ok)
  console.log(`\n${results.length - f.length}/${results.length} passed${f.length ? ' FAILED: ' + f.map(x => x.n).join(' | ') : ''}`)
  process.exit(f.length ? 1 : 0)
})()
