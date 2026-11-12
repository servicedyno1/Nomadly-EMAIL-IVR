// Delivery review after a customer's 1st and 2nd single text: asked ~3 min later, arrived + stars + comment, admin alerts,
// "No" re-checks the sending line. Run from /app: node js/tests/test_bulk_esim_review.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'; process.env.BULK_ESIM_FAKE_CHECKS = 'manual'
process.env.CHAT_BOT_BRAND = 'Nomadly'; process.env.TELEGRAM_ADMIN_CHAT_ID = '770077'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), bot = require('../bulk-esim/bot'), { btn, t } = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsDrafts', 'bsReviews']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await bot.init({ db, log: () => {}, notifyAdmin: (x) => alerts.push(x) })
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test'); await B.bootstrap(); await B.healthCheck()
  await db.collection('bsTests').updateMany({}, { $set: { result: 'passed' } }); await db.collection('bsEsims').updateMany({}, { $set: { status: 'available', health: 'healthy' } })
  const L = btn('en'), USER = 880033, cid = B.cidOf('Nomadly', USER), st = { action: 'none', userLanguage: 'en' }, sent = [], edits = []
  let nextId = 100
  const fakeBot = { sendMessage: async (chatId, text, o) => { const m = { message_id: ++nextId, chatId, text, o }; sent.push(m); return m }, editMessageText: async (text, o) => edits.push({ text, ...o }), editMessageReplyMarkup: async (k, o) => edits.push({ markup: k, ...o }) }
  const ctxSend = (id, text, o) => fakeBot.sendMessage(id, text, o)
  const say = (message, msg) => bot.handle({ chatId: USER, msg, message, info: { ...st }, set: async (_s, _c, k, v) => { st[k] = v }, state: {}, send: ctxSend, saveInfo: async (k, v) => { st[k] = v }, goto: {}, bot: {} })
  const tap = (data, mid) => bot.onCallback({ data, message: { chat: { id: USER }, message_id: mid, text: 'q' } }, { set: async (_s, _c, k, v) => { st[k] = v }, state: {}, saveInfo: async (k, v) => { st[k] = v }, send: ctxSend, lang: 'en' })
  const sendOne = async (to, text) => { await say('/esimsms'); await say(L.one); await say(to); await say(L.one_opt_no); await say(text) }

  await sendOne('+12125550301', 'first'); await sendOne('+12125550302', 'second')
  const rv = await db.collection('bsReviews').find({ cid }).sort({ seq: 1 }).toArray()
  ok('a review is queued for the 1st and 2nd single text', rv.length === 2 && rv[0].seq === 1 && rv[1].seq === 2)
  const line = await db.collection('bsEsims').findOne({ role: 'tester' })
  await db.collection('bsMessages').updateMany({ cid }, { $set: { status: 'sent', esimId: line._id, from: line.msisdn } })
  await bot.askReviews(fakeBot, db)
  ok('not asked before 3 minutes', !sent.some(m => /Quick check/.test(m.text)))
  await db.collection('bsReviews').updateMany({ cid }, { $set: { dueAt: new Date(Date.now() - 1000), at: new Date(Date.now() - 200000) } })
  await bot.askReviews(fakeBot, db)
  const asks = sent.filter(m => /Quick check/.test(m.text))
  ok('asked after 3 minutes, once per text', asks.length === 2 && /first text/.test(asks[0].text) && /second text/.test(asks[1].text), asks.map(a => a.text.slice(0, 40)).join(' | '))
  const kb = asks[0].o.reply_markup.inline_keyboard.flat().map(b => b.text)
  ok('Yes / No / Not sure buttons', kb.includes(t('en', 'rv_yes')) && kb.includes(t('en', 'rv_no')) && kb.includes(t('en', 'rv_unsure')))
  await bot.askReviews(fakeBot, db)
  ok('not asked twice', sent.filter(m => /Quick check/.test(m.text)).length === 2)

  // Review 1: arrived + 5 stars + comment
  await tap(`bse-rv:${rv[0]._id}:a:y`, asks[0].message_id)
  ok('after "Yes" the message shows the 1–5 star row', edits.some(e => e.reply_markup?.inline_keyboard?.[0]?.length === 5))
  await tap(`bse-rv:${rv[0]._id}:s:5`, asks[0].message_id)
  ok('stars recorded + thank-you button like support', (await db.collection('bsReviews').findOne({ _id: rv[0]._id })).stars === 5 && edits.some(e => /Thank you/.test(e.markup?.inline_keyboard?.[0]?.[0]?.text || '')))
  ok('admin alerted for the review', alerts.some(a => /Single-text review/.test(a) && /arrived/.test(a) && /5\/5/.test(a)))
  const prompt = sent[sent.length - 1]
  ok('optional comment prompt (reply to it)', prompt.o?.reply_markup?.force_reply && st.bseReviewPrompt === prompt.message_id)
  await say('Got it fast, thanks', { reply_to_message: { message_id: prompt.message_id } })
  ok('comment saved + admin alerted', (await db.collection('bsReviews').findOne({ _id: rv[0]._id })).comment === 'Got it fast, thanks' && alerts.some(a => /review comment/.test(a)))

  // Review 2: did NOT arrive → line check started
  await db.collection('bsTests').updateMany({ result: 'pending' }, { $set: { result: 'passed' } })
  const before = await db.collection('bsTests').countDocuments({ type: 'check', kind: 'customer_report' })
  await tap(`bse-rv:${rv[1]._id}:a:n`, asks[1].message_id)
  const r2 = await db.collection('bsReviews').findOne({ _id: rv[1]._id })
  ok('"No" recorded', r2.arrived === 'no')
  ok('"No" starts a two-way check of the sending line', (await db.collection('bsTests').countDocuments({ type: 'check', kind: 'customer_report', esimId: r2.esimId })) === before + 1, `${r2.esimId} check=${r2.check}`)
  ok('admin told the text did not arrive + check started', alerts.some(a => /did NOT arrive/.test(a) && /Line check started/.test(a)))
  ok('customer told we are re-checking', sent.some(m => m.text === t('en', 'rv_no_note')))
  await tap(`bse-rv:${rv[1]._id}:a:n`, asks[1].message_id)
  ok('second "No" tap does not start another check', (await db.collection('bsTests').countDocuments({ type: 'check', kind: 'customer_report' })) === before + 1)
  // The check fails → existing suspect/retire process kicks in
  await db.collection('bsTests').updateMany({ result: 'pending' }, { $set: { at: new Date(Date.now() - 11 * 60000) } })
  await db.collection('bsWebhooks').insertOne({ at: new Date(), qa: true })
  await B.checkTimeouts(await B.cfg())
  const ln = await db.collection('bsEsims').findOne({ _id: r2.esimId })
  ok('failed check → line paused as suspect + admin alerted', ln.health === 'suspect' && alerts.some(a => /didn't arrive — paused from sending/.test(a)), ln.health)

  // Rejected text → no review; a 3rd text (admin) → no review
  await db.collection('bsReviews').insertOne({ _id: 'rv_x', cid, to: '+12125550399', seq: 1, status: 'waiting', at: new Date(Date.now() - 200000), dueAt: new Date(0) })
  await bot.askReviews(fakeBot, db)
  ok('review for a text that does not exist is skipped', (await db.collection('bsReviews').findOne({ _id: 'rv_x' })).status === 'skipped')
  await B.sendOne(B.cidOf('Nomadly', 770077), '+12125550398', 'admin', null, { unlimited: true })
  ok('admin unlimited texts get no review', !(await db.collection('bsReviews').findOne({ cid: B.cidOf('Nomadly', 770077) })))

  // Another bot (VoodooLand): review results go to the Nomadly admin queue only, never to that bot's own admin.
  process.env.CHAT_BOT_BRAND = 'VoodooLand'
  const vcid = B.cidOf('VoodooLand', 990044)
  await db.collection('bsMessages').insertOne({ _id: 'm_vl', cid: vcid, to: '+12125550401', direction: 'out', status: 'sent', esimId: line._id, from: line.msisdn, at: new Date() })
  await db.collection('bsReviews').insertOne({ _id: 'm_vl', cid: vcid, to: '+12125550401', seq: 1, status: 'asked', at: new Date(), dueAt: new Date() })
  await db.collection('bsNotify').deleteMany({}); const nA = alerts.length
  process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
  const vtap = (data) => bot.onCallback({ data, message: { chat: { id: 990044 }, message_id: 1, text: 'q' } }, { set: async () => {}, state: {}, saveInfo: async () => {}, send: ctxSend, lang: 'en' })
  await vtap('bse-rv:m_vl:a:n'); await vtap('bse-rv:m_vl:s:2')
  process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.CHAT_BOT_BRAND = 'Nomadly'
  const q = await db.collection('bsNotify').find({ type: 'admin' }).toArray()
  ok('VoodooLand review → queued for the Nomadly admin', q.length >= 2 && q.every(n => n.brand === 'Nomadly') && q.some(n => /VoodooLand bot/.test(n.text) && /did NOT arrive/.test(n.text)) && q.some(n => /Single-text review/.test(n.text) && /2\/5/.test(n.text)), String(q.length))
  ok('VoodooLand bot\'s own admin not alerted', alerts.length === nA)

  for (const c of [...COLS, 'bsWebhooks']) await db.collection(c).deleteMany({})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
