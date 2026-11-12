// Nomadly admin: unlimited free single texts + main-menu shortcut; customers keep the 2-text limit.
// Run from /app: node js/tests/test_bulk_esim_admin_one.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
process.env.CHAT_BOT_BRAND = 'Nomadly'; process.env.TELEGRAM_ADMIN_CHAT_ID = '770077'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS; delete process.env.BULK_ESIM_FAKE_PROVISION_FAIL
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), bot = require('../bulk-esim/bot'), { btn } = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsDrafts']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test'); await B.bootstrap(); await B.healthCheck()
  const L = btn('en'), ADMIN = 770077, USER = 880022
  const mk = (chatId) => { const st = { action: 'none', userLanguage: 'en' }; let last = null
    const send = async (_, text, o) => { last = { text, keys: (o?.reply_markup?.keyboard || []).flat() }; return true }
    return { st, say: async (message) => { await bot.handle({ chatId, message, info: { ...st }, set: async (_s, _c, k, v) => { st[k] = v }, state: {}, send, saveInfo: async (k, v) => { st[k] = v }, goto: {}, bot: {} }); return last } } }
  const sendVia = async (u, to, text, fromMenu) => { await u.say(fromMenu ? L.one : '/esimsms'); if (!fromMenu) await u.say(L.one); await u.say(to); await u.say(L.one_opt_no); return u.say(text) }

  delete require.cache[require.resolve('../lang/en.js')]
  const en = require('../lang/en.js'), adminKeys = JSON.stringify(en.en?.aO || en.aO || '')
  ok('admin main keyboard has the "Send one SMS" shortcut on Nomadly', adminKeys.includes(L.one), adminKeys.slice(0, 80))

  const a = mk(ADMIN)
  let m = await a.say(L.one)
  ok('main-menu shortcut opens the number step for the admin', a.st.action === 'bse-one-to', m?.text)
  for (let i = 0; i < 5; i++) {
    m = i === 0 ? (await a.say('+12125550100'), await a.say(L.one_opt_no), await a.say('admin text 0')) : await sendVia(a, `+1212555010${i}`, `admin text ${i}`, i % 2 === 0)
    ok(`admin single text #${i + 1} queued`, /queued|Queued|sent|on its way/i.test(m.text) && !/⚠️/.test(m.text), m.text.slice(0, 80))
  }
  ok('admin home always shows "Send one SMS"', (await a.say('/esimsms')).keys.includes(L.one))
  const msgs = await db.collection('bsMessages').find({ cid: B.cidOf('Nomadly', ADMIN) }).toArray()
  ok('5 admin texts stored, marked unlimited', msgs.length === 5 && msgs.every(x => x.unlimited), String(msgs.length))
  await B.setCustomer?.(B.cidOf('Nomadly', ADMIN), { dailyLimit: 1 }, 'test').catch?.(() => {})
  await db.collection('bsCustomers').updateOne({ _id: B.cidOf('Nomadly', ADMIN) }, { $set: { dailyLimit: 1 } })
  ok('daily allowance does not block the admin', !(await B.sendOne(B.cidOf('Nomadly', ADMIN), '+12125550199', 'over limit', null, { unlimited: true })).error)
  process.env.BULK_ESIM_WORKER = ''; await B.creditWatch()
  for (let i = 0; i < 10; i++) { await B.claimWorker(); await B.tick(); await new Promise(r => setTimeout(r, 50)) }
  const rej = await db.collection('bsMessages').countDocuments({ cid: B.cidOf('Nomadly', ADMIN), status: 'rejected' })
  ok('worker does not reject admin texts for daily allowance', rej === 0, String(rej))
  ok('admin texts actually sent despite a daily allowance of 1', (await db.collection('bsMessages').countDocuments({ cid: B.cidOf('Nomadly', ADMIN), status: { $in: ['sent', 'submitted', 'delivered'] } })) >= 6)
  const wallet = await db.collection('bsPayments').countDocuments({ cid: B.cidOf('Nomadly', ADMIN) })
  ok('no charge recorded for admin texts', wallet === 0)

  // Number already in another customer's conversation on every line: admin still sends; replies stay with that customer.
  const busyTo = '+12125550777', other = B.cidOf('Nomadly', 990099)
  await db.collection('bsCustomers').updateOne({ _id: B.cidOf('Nomadly', ADMIN) }, { $unset: { dailyLimit: 1 } })
  const lines = await db.collection('bsEsims').find({ msisdn: { $ne: null } }).toArray()
  for (const e of lines) await db.collection('bsSessions').insertOne({ _id: `s_qa_${e._id}`, cid: other, to: busyTo, esimId: e._id, status: 'active', expiresAt: new Date(Date.now() + 3600e3), lastActivityAt: new Date() })
  ok('customer would be refused (number busy)', !!(await B.numberBusy(B.cidOf('Nomadly', USER), busyTo)))
  m = await sendVia(a, busyTo, 'admin to busy number', true)
  ok('admin: busy number accepted + queued', /On its way/.test(m.text) && !/already in a conversation/.test(m.text), m.text.slice(0, 80))
  await db.collection('bsMessages').updateMany({}, { $set: { nextAt: new Date(0) } }); await B.creditWatch()
  for (let i = 0; i < 10; i++) { await B.claimWorker(); await B.tick(); await new Promise(r => setTimeout(r, 50)) }
  const bm = await db.collection('bsMessages').findOne({ cid: B.cidOf('Nomadly', ADMIN), to: busyTo })
  ok('admin text to busy number is sent', ['sent', 'submitted', 'delivered'].includes(bm?.status), bm?.status)
  ok('no admin session opened → replies stay with the other customer', !(await db.collection('bsSessions').findOne({ cid: B.cidOf('Nomadly', ADMIN), to: busyTo })) && (await db.collection('bsSessions').countDocuments({ cid: other, to: busyTo, status: 'active' })) === lines.length)

  const u = mk(USER)
  for (let i = 0; i < 2; i++) m = await sendVia(u, `+1212555020${i}`, `user text ${i}`)
  m = await u.say('/esimsms')
  ok('customer: "Send one SMS" hidden after 2 free texts', !m.keys.includes(L.one))
  ok('customer: core still refuses a 3rd text', (await B.sendOne(B.cidOf('Nomadly', USER), '+12125550299', 'third')).error === 'err_one_used')
  const u2 = mk(USER); m = await u2.say(L.one)
  ok('customer: shortcut label from main menu is not unlimited', u2.st.action !== 'bse-one-to')

  for (const c of COLS) await db.collection(c).deleteMany({})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
