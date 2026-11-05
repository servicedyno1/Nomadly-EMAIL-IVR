// Outbound browser-phone call from a US mobile number: fake Telnyx call.initiated on the SIP connection
// with the mobile line's SIP username → voice-service must resolve the line, check the wallet and dial out from that number.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const VS = require('/app/js/voice-service.js')

;(async () => {
  const cli = await MongoClient.connect(process.env.MONGO_URL); const db = cli.db(process.env.DB_NAME)
  const line = await db.collection('esimLines').findOne({ kind: 'mobile', status: 'active', simulated: true, phoneNumber: { $ne: null } })
  const user = 'mnsiptest' + Date.now()
  await db.collection('esimLines').updateOne({ _id: line._id }, { $set: { sip: { username: user, password: 'x', live: false } } })
  const calls = []
  const telnyxApi = new Proxy({}, { get: (_, k) => async (...a) => { calls.push([k, ...a]); return k === 'createCall' ? { call_control_id: 'leg-b' } : {} } })
  VS.initVoiceService({ db, telnyxApi, phoneLogs: db.collection('phoneLogs') })
  const id = 'test-mobile-out-' + Date.now()
  await VS.handleVoiceWebhook({ body: { data: { event_type: 'call.initiated', payload: { call_control_id: id, direction: 'outgoing', state: 'parked', connection_id: process.env.TELNYX_SIP_CONNECTION_ID, from: line.phoneNumber, from_sip_uri: `sip:${user}@sip.telnyx.com`, to: 'sip:+14155550123@sip.telnyx.com' } } } }, { sendStatus: () => {} })
  await new Promise(r => setTimeout(r, 2500))
  const s = VS.activeCalls[id]
  const out = calls.map(c => [c[0], JSON.stringify(c.slice(1)).slice(0, 160)])
  console.log('session', s ? JSON.stringify({ chatId: s.chatId, from: s.num?.phoneNumber, to: s.destination || s.to, rate: s.rate || s.sipRate }) : null)
  console.log('telnyx', JSON.stringify(out))
  const ok = s && s.chatId === line.chatId && s.num?.phoneNumber === line.phoneNumber && out.some(c => /transfer|createCall|dial/i.test(c[0]) && c[1].includes('+14155550123'))
  await db.collection('esimLines').updateOne({ _id: line._id }, { $unset: { sip: 1 } })
  console.log(ok ? 'PASS' : 'FAIL'); await cli.close(); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
