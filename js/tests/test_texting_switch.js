// Texting on/off switch: off → no texts in or out, on every number type. Local Mongo, temp DB, no real texts.
//   node js/tests/test_texting_switch.js
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`) }

;(async () => {
  const cl = await MongoClient.connect('mongodb://127.0.0.1:27017')
  const db = cl.db('texting_switch_' + Date.now())
  const nums = db.collection('phoneNumbersOf'), logs = db.collection('phoneLogs')
  const N = (phoneNumber, sms, cap = true, extra = {}) => ({ phoneNumber, status: 'active', provider: 'multitel', plan: 'pro', capabilities: { voice: true, sms: cap }, features: { sms }, ...extra })
  await nums.insertOne({ _id: '5000000000000901', val: { numbers: [N('+3197010000001', false), N('+3197010000002', true), N('+16805550001', false, false, { country: 'US', type: 'local' }), N('+16805550002', undefined)] } })

  const S = require('../sms-service.js')
  const inbound = (to) => S.handleInboundSms({ data: { payload: { from: { phone_number: '+31612345678' }, to: [{ phone_number: to }], text: 'hello' } } }, { sendMessage: async () => {} }, nums, logs)
  await inbound('+3197010000001'); await inbound('+3197010000002'); await inbound('+16805550001')
  const got = async (p) => logs.countDocuments({ phoneNumber: p, direction: 'inbound' })
  ok('texting off (NL) → incoming text not delivered', (await got('+3197010000001')) === 0)
  ok('texting on (NL) → incoming text delivered', (await got('+3197010000002')) === 1)
  ok('calls-only US local → incoming text not delivered', (await got('+16805550001')) === 0)

  const sms = require('../cloudivr-web/sms-reply').createSmsReply({ db, log: () => {} })
  const send = (n) => sms.send({ chatId: '5000000000000901', num: n, to: '+31612345678', text: 'hi', simulated: true })
  const doc = (await nums.findOne({})).val.numbers
  ok('texting off → can’t send', (await send(doc[0])).error?.[1] === 'texting_off')
  ok('switch never set → can’t send', (await send(doc[3])).error?.[1] === 'texting_off')
  ok('calls-only number → can’t send', (await send(doc[2])).error?.[1] === 'no_sms')
  const on = await send(doc[1])
  ok('texting on → passes the switch', !['texting_off', 'no_sms'].includes(on.error?.[1]))

  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
