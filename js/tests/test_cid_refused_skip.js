// Unverified "show as" caller ID (network D51): refused once → skipped for 24 h (dial straight from the own number),
// bulk campaigns get no message while running, the final report lists refused IDs.
// Run: cd /app && node js/tests/test_cid_refused_skip.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
const { MongoClient } = require('mongodb')
const V = require('/app/js/voice-service.js')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const dials = [], msgs = []
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_cidskip`)
  await db.dropDatabase()
  const telnyxApi = {
    createOutboundCall: async (from, to) => { dials.push(from); return from === '+12272461851' ? { error: 'Unverified origination number D51. The source number is a non-Telnyx number that has not been verified.', code: 'D51' } : { callControlId: `cc_${dials.length}` } },
    isLineLimitError: () => false,
  }
  V.initVoiceService({ bot: { sendMessage: async (id, t) => { msgs.push({ id, t }); return {} } }, db, telnyxApi, state: db.collection('state'), phoneNumbersOf: db.collection('phoneNumbersOf'), phoneLogs: db.collection('phoneLogs'), walletOf: db.collection('walletOf'), translation: () => null, selfUrl: 'https://x' })
  await new Promise(r => setTimeout(r, 500))
  const call = (extra = {}) => V.initiateOutboundIvrCall({ chatId: '777', callerId: '+18667901890', displayCallerId: '+12272461851', targetNumber: '+16787543138', audioUrl: 'https://x/a.mp3', activeKeys: ['1'], campaignId: 'c1', leadIndex: 0, bulkMode: 'report_only', provider: 'telnyx', ...extra })
  const r1 = await call()
  ok('first call: tries the show-as number, refused, redials from own number', dials.join(',') === '+12272461851,+18667901890' && r1.callControlId && r1.refusedCid === '+12272461851', dials.join(','))
  ok('bulk: no customer message while the campaign runs', msgs.length === 0)
  ok('refusal remembered in the database', !!(await db.collection('cidRefused').findOne({ _id: '+12272461851' })))
  dials.length = 0
  const r2 = await call({ leadIndex: 1 })
  ok('next call skips the doomed attempt (one dial, own number)', dials.join(',') === '+18667901890' && r2.refusedCid === '+12272461851', dials.join(','))
  await db.collection('cidRefused').updateOne({ _id: '+12272461851' }, { $set: { at: new Date(Date.now() - 25 * 3600e3) } })
  await new Promise(r => setTimeout(r, 61000))
  dials.length = 0
  await call({ leadIndex: 2 })
  ok('after 24 h it is tried once again', dials[0] === '+12272461851', dials.join(','))
  dials.length = 0
  await call({ leadIndex: 3, displayCallerId: '+14155550123' })
  ok('a working show-as number is used as normal', dials.join(',') === '+14155550123')
  // final-report note
  const B = require('/app/js/bulk-call-service.js')
  const note = B.refusedNote({ refusedCids: ['+12272461851', '+12272461852'], callerId: '+18667901890' }, 'en')
  ok('report note says network carriers refused, no provider name', /Network carriers refused caller IDs/.test(note) && !/telnyx/i.test(note) && note.includes('+18667901890'), note)
  ok('no note when nothing was refused', B.refusedNote({ refusedCids: [] }, 'en') === null)
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
