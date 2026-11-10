// Buttons that send right away only show when a working line can deliver; tester replacement hides tests and alerts the admin.
// Run from /app: node js/tests/test_bulk_esim_ready_gate.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), bot = require('../bulk-esim/bot'), { btn, t } = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsDrafts']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => `+1212555${from + i}`)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = [], since = (n) => alerts.slice(n).join('\n')
  await B.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  const E = db.collection('bsEsims'), L = btn('en'), CHAT = 880011
  // Bot harness: drives flow() directly and records the last message + keyboard.
  const st = { action: 'none', userLanguage: 'en' }; let last = null
  const send = async (_, text, o) => { last = { text, keys: (o?.reply_markup?.keyboard || []).flat() }; return true }
  const say = async (message) => { await bot.handle({ chatId: CHAT, message, info: { ...st }, set: async (_s, _c, k, v) => { st[k] = v }, state: {}, send, saveInfo: async (k, v) => { st[k] = v }, goto: {}, bot: {} }); return last }
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test')

  let r = await B.ready()
  ok('no lines at all → nothing can send', !r.send && !r.test, JSON.stringify(r))
  let m = await say('/esimsms')
  ok('home: "Send one SMS" hidden + short reason shown', !m.keys.includes(L.one) && m.keys.includes(L.convs) && m.text.includes(t('en', 'off_one')))
  m = await say(L.one)
  ok('stale "Send one SMS" tap → reason, stays on home', st.action === 'bse-home' && m.text === t('en', 'off_one'))
  const cid = B.cidOf('Nomadly', CHAT)
  ok('core refuses a single text too', (await B.sendOne(cid, '+12125550100', 'hi')).error === 'off_one')

  await B.bootstrap(); await B.healthCheck()
  const tester = await E.findOne({ role: 'tester' })
  r = await B.ready()
  ok('tester live, no service line → tests on, single texts off', r.test && !r.send && tester.status === 'available', JSON.stringify(r))

  await B.provisionMany(2, 'test', 'test'); await B.healthCheck()
  r = await B.ready()
  ok('service lines live → everything on', r.send && r.test, JSON.stringify(r))
  m = await say('↩️ Back'); m = await say('/esimsms')
  ok('home shows "Send one SMS" again, no reason', m.keys.includes(L.one) && !m.text.includes(t('en', 'off_one')))

  // ---- tester replaced → tests off until the new number passes; admin told ----
  let n0 = alerts.length
  const x = await B.replaceEsim(tester._id, 'auto: suspended by provider', 'system')
  r = await B.ready()
  ok('tester being replaced → tests off even though service lines work', x.ok && !r.test && r.send, JSON.stringify(r))
  const cp = (await B.createCampaign(cid, { content: 'Spring sale this week', contacts: nums(500), consent: true })).campaign
  ok('core refuses a test while the tester is replaced', (await B.testCheck(cid, cp._id, '+13105550111')).error === 'off_test')
  st.action = 'bse-test'; st.bseCampaign = cp._id
  m = await say(L.test)
  ok('stale "Send a test" tap → reason, no test button', m.text === t('en', 'off_test') && !m.keys.includes(L.test) && m.keys.includes(L.cont))
  n0 = alerts.length; await B.healthCheck()
  const nt = await E.findOne({ role: 'tester', status: 'available' })
  ok('new tester number passes → admin told test buttons are back', !!nt && /tester line\) passed checks.*Customer test buttons are back on/.test(since(n0)), since(n0))
  ok('tests on again', (await B.ready()).test)

  // ---- tester replacement fails → new tester line ordered, admin told ----
  process.env.BULK_ESIM_FAKE_RENEW_FAIL = nt.iccid
  n0 = alerts.length; const y = await B.replaceEsim(nt._id, 'auto: provider restricted', 'system')
  ok('replace fails → admin alert names the tester line and the new tester line ordered', !y.ok && /could not replace the number of .*tester line/.test(since(n0)) && /New tester line ESIM-\d+ ordered/.test(since(n0)), since(n0))
  ok('tests off while the new tester line is checked', !(await B.ready()).test)
  delete process.env.BULK_ESIM_FAKE_RENEW_FAIL

  // ---- paused → "Send now" off, schedule stays; conversation replies off ----
  await B.healthCheck(); await B.pause('admin', 'qa')
  const w = await B.whenOptions(cid, cp._id)
  ok('paused → no "Send now", schedule still offered, off flag', !w.now && !w.later && w.off && w.schedule.price > 0, JSON.stringify({ now: w.now, later: w.later, off: w.off }))
  ok('stale "Send now" → refused', (await B.createBooking(cid, { campaignId: cp._id, now: true })).error === 'off_now')
  st.action = 'bse-test'; m = await say(L.cont)
  ok('when screen: no "Send now" key + reason shown', !m.keys.includes(L.now) && m.text.includes(t('en', 'off_now')), m.keys.join('|'))
  const line = await E.findOne({ role: { $nin: ['tester', 'monitor'] }, status: 'available' })
  await db.collection('bsSessions').insertOne({ _id: 'ses_qa', cid, to: '+12125550177', esimId: line._id, status: 'active', lastActivityAt: new Date() })
  st.action = 'bse-conv'; m = await say('💬 +12125550177')
  ok('conversation opens read-only with reason while paused', st.action === 'bse-conv' && m.text.includes(t('en', 'off_reply')))
  ok('core refuses the reply', (await B.sendOne(cid, '+12125550177', 'yo', 'ses_qa')).error === 'off_reply')
  await B.resume('admin')
  m = await say('💬 +12125550177')
  ok('resumed → reply allowed', st.action === 'bse-reply' && m.text.includes(t('en', 'reply_q')))
  ok('fr reason text exists', t('fr', 'off_test') !== 'off_test' && t('fa', 'off_reply') !== 'off_reply')

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
