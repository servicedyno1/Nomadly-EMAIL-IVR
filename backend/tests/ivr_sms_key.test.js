// IVR "send the caller a text" key: drives a fake call.gather.ended through voice-service with a mocked Telnyx.
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const VS = require('../../js/voice-service.js')
const ES = require('../../js/spenza.js')

;(async () => {
  const cli = await MongoClient.connect(process.env.MONGO_URL); const db = cli.db(process.env.DB_NAME)
  const calls = []
  const telnyxApi = new Proxy({}, { get: (_, k) => async (...a) => { calls.push([k, ...a]); return {} } })
  ES.init({ db, log: () => {}, tell: async () => null })
  VS.initVoiceService({ db, telnyxApi, phoneNumbersOf: null, phoneLogs: db.collection('phoneLogs'), bot: null })
  const line = await db.collection('esimLines').findOne({ kind: 'mobile', status: 'active' })
  const chatId = line.chatId
  const start = new Date()
  const wallet = await db.collection('walletOf').findOne({ _id: chatId })
  const run = async (opt, digits = '1') => {
    calls.length = 0
    const id = 'test-ivr-' + Date.now()
    VS.activeCalls[id] = { num: { phoneNumber: '+13346972125', plan: 'business', features: { ivr: { enabled: true, greeting: 'Main menu', options: { 1: opt, 2: { action: 'voicemail' } } } } }, chatId, from: '+14155550199', to: '+13346972125', phase: 'ivr' }
    const before = await db.collection('phoneLogs').countDocuments({ esim: line._id, to: '+14155550199' })
    await VS.handleVoiceWebhook({ body: { data: { event_type: 'call.gather.ended', payload: { call_control_id: id, digits } } } }, { sendStatus: () => {} })
    await new Promise(r => setTimeout(r, 1500))
    const after = await db.collection('phoneLogs').countDocuments({ esim: line._id, to: '+14155550199' })
    return { sent: after - before, telnyx: calls.map(c => [c[0], typeof c[2] === 'string' ? c[2] : '']) }
  }
  const a = await run({ action: 'sms', smsFrom: line._id, smsText: 'Our address: 1 Main St', message: 'Check your phone.', after: 'hangup' })
  console.log('hangup', JSON.stringify(a))
  const b = await run({ action: 'sms', smsFrom: line._id, smsText: 'Second press', after: 'menu' })
  console.log('menu', JSON.stringify(b))
  const c = await run({ action: 'sms', smsFrom: 'mn_000000000000', smsText: 'x', after: 'hangup' })
  console.log('bad line', JSON.stringify(c))
  const ok = a.sent === 1 && a.telnyx.some(t => t[0] === 'speakOnCall' && t[1] === 'Check your phone.') &&
    b.sent === 1 && b.telnyx.some(t => t[0] === 'gatherDTMF' && /We have sent you a text message\. Main menu/.test(t[1])) &&
    c.sent === 0 && c.telnyx.some(t => t[0] === 'speakOnCall' && /could not send/.test(t[1]))
  console.log(ok ? 'PASS' : 'FAIL')
  if (wallet) await db.collection('walletOf').replaceOne({ _id: chatId }, wallet)
  await db.collection('phoneLogs').deleteMany({ esim: line._id, to: '+14155550199', timestamp: { $gte: start } })
  await db.collection('transactions').deleteMany({ chatId, type: 'esim-sms', 'metadata.to': '+14155550199', createdAt: { $gte: start } })
  await cli.close(); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
