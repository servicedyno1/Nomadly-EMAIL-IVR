// Spam-folder answers: retry from another line, promote the good line to test line, renumber the flagged one;
// daily midnight renumber of the test line (once per day). Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000779, L = I.btn('en')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), E = db.collection('bsEsims'), M = db.collection('bsMessages')
  const alerts = []
  await BOT.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  await db.collection('bsConfig').deleteMany({ _id: /^(promote:|tester-renumber:|spam-flag:)/ })
  if (!(await B.ready()).send || !(await B.ready()).test) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() }
  const cid = B.cidOf(BOT.brand(), CHAT), info = { action: 'none', userLanguage: 'en' }, out = []
  const send = async (id, text, o) => { out.push({ text: String(text), kb: (o?.reply_markup?.keyboard || []).flat().map(String) }); return true }
  const ctx = (message) => ({ chatId: CHAT, msg: { text: message, from: { id: CHAT, first_name: 'Qa' } }, message, info, state: {}, set: async (_s, _c, k, v) => { info[k] = v }, saveInfo: async (k, v) => { info[k] = v }, send, goto: { 'digital-product-pay': async () => {}, submenu7: async () => {} }, bot: null })
  const say = async (m) => { out.length = 0; await BOT.handle(ctx(m)); return out[out.length - 1] || { text: '', kb: [] } }
  const since = (n) => alerts.slice(n).join('\n---\n')
  try {
    // Shared preview DB: make sure there is a test line plus at least one other healthy line to retry from.
    if (!(await E.findOne({ role: 'tester', status: { $in: ['available', 'active', 'in_use'] }, msisdn: { $ne: null } }))) await E.updateOne({ role: { $ne: 'tester' }, status: 'available', msisdn: { $ne: null } }, { $set: { role: 'tester' } })
    if ((await E.countDocuments({ role: { $nin: ['tester', 'monitor'] }, status: 'available', health: 'healthy' })) < 2) { for (let i = 0; i < 2; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() }
    const tester = await E.findOne({ role: 'tester', status: { $in: ['available', 'active', 'in_use'] }, msisdn: { $ne: null } })
    ok('there is a test line', !!tester, JSON.stringify(await E.find({}).project({ role: 1, status: 1, health: 1 }).toArray()))
    // 1) bot: test → "Yes, but in spam"
    await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
    await say(L.home); await say(L.newc); await say(Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n')); await say(L.agree); await say('Hello from the QA spam check team'); await say(L.use_one)
    await say(L.test); let r = await say('+13104567890')
    ok('test asks "Did it arrive?" with inbox / spam / no', r.kb.includes(L.arrived_yes) && r.kb.includes(L.arrived_spam) && r.kb.includes(L.arrived_no), r.kb.join(' | '))
    await M.updateOne({ _id: info.bseTestMsg }, { $set: { esimId: tester._id, status: 'sent', from: tester.msisdn } })
    let n0 = alerts.length
    r = await say(L.arrived_spam)
    ok('spam answer → "next test from a different line" + Test from another line', /different line/.test(r.text) && r.kb.includes(L.test_other_line), r.text.slice(0, 160))
    ok('spam saved on the review + the line (lastSpamAt, spamReports)', (await db.collection('bsReviews').findOne({ _id: info.bseTestMsg }))?.arrived === 'spam' && !!(await E.findOne({ _id: tester._id }))?.lastSpamAt)
    ok('admin alert: SPAM + 14-day usage of the line', /landed in SPAM/.test(since(n0)) && /Last 14 days/.test(since(n0)), since(n0).slice(0, 200))
    // 2) retry from another line
    await say(L.test_other_line); r = await say('+13104567890')
    const alt = await M.findOne({ _id: info.bseTestMsg })
    ok('retry goes from a different healthy service line', alt?.esimId && alt.esimId !== tester._id && alt.altFor === tester._id, `${alt?.esimId} altFor ${alt?.altFor}`)
    await M.updateOne({ _id: alt._id }, { $set: { status: 'sent' } })
    n0 = alerts.length
    r = await say(L.arrived_yes)
    const [nw, old] = await Promise.all([E.findOne({ _id: alt.esimId }), E.findOne({ _id: tester._id })])
    ok('inbox on the retry → that line is the new test line', nw.role === 'tester' && info.action === 'bse-when', `${nw.role} ${info.action}`)
    ok('old test line → renumbered (replaced), new number joins as a service line', old.status === 'replaced' && old.role === 'service' && !!old.replacedBy && (await E.findOne({ _id: old.replacedBy }))?.role === 'service', `${old.status} ${old.role}`)
    ok('admin told the test line switched', /Test line switched/.test(since(n0)), since(n0).slice(0, 200))
    // 3) daily renumber once per day
    n0 = alerts.length
    const d1 = await B.dailyTesterRenumber(), d2 = await B.dailyTesterRenumber()
    ok('daily renumber runs once per day (2nd call skipped)', !!d1 && d2 === null, JSON.stringify(d1).slice(0, 120))
    ok('daily renumber alert shows old → new number + 14-day usage', /Daily test-line renumber/.test(since(n0)) && /last 14 days/.test(since(n0)), since(n0).slice(0, 220))
    ok('renumbered test line keeps the tester role', (await E.findOne({ _id: d1.newEsimId }))?.role === 'tester')
    // 4) spam reports from 2 customers on a service line → suspect
    const svc = await E.findOne({ role: { $ne: 'tester' }, status: { $in: ['available', 'active', 'in_use'] }, health: { $in: ['healthy', 'ok'] }, msisdn: { $ne: null } })
    for (const [k, c2] of ['qa:spam1', 'qa:spam2'].entries()) {
      const m = { _id: `m_spam_${k}`, cid: c2, to: `+1310456${7000 + k}`, esimId: svc._id, direction: 'out', status: 'sent', test: false, createdAt: new Date() }
      await M.insertOne(m); await db.collection('bsReviews').insertOne({ _id: m._id, cid: c2, to: m.to, kind: 'one', seq: 1, status: 'asked', at: new Date() })
      await B.reviewAnswer(m._id, c2, 'arrived', 's')
    }
    ok('2 customers report spam on a service line → suspect (out of pool)', (await E.findOne({ _id: svc._id }))?.health === 'suspect')
    ok('review buttons offer "In spam" in every language', ['en', 'fr', 'zh', 'hi', 'fa'].every(l => !!I.t(l, 'rv_spam') && !!I.btn(l).arrived_spam && !!I.btn(l).test_other_line))
  } finally {
    for (const c of ['bsMessages', 'bsCampaigns', 'bsReviews', 'bsAiTips', 'bsDrafts', 'bsBookings']) await db.collection(c).deleteMany({ $or: [{ cid }, { _id: cid }, { cid: /^qa:spam/ }] })
    await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  }
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
