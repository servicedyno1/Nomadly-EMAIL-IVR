// T1 iter258: guided test step screens (texts + keyboards) via BOT.handle in-process with a capturing send():
// ready → Skip test → when; test → "Did it arrive?" → No(wait) → No(tips) → Test again (last number button) → Change the text (numbers restored);
// home path line in 5 langs; Continue button inside the test-number prompt after an error.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000777, L = I.btn('en')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await BOT.init({ db, log: () => {}, notifyAdmin: () => {} })
  if (!(await B.ready()).send || !(await B.ready()).test) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); for (let i = 0; i < 3; i++) await B.healthCheck() }
  const cid = B.cidOf(BOT.brand(), CHAT)
  const info = { action: 'none', userLanguage: 'en' }, out = []
  const send = async (id, text, o) => { out.push({ text: String(text), kb: (o?.reply_markup?.keyboard || []).flat().map(String) }); return true }
  const ctx = (message) => ({ chatId: CHAT, msg: { text: message, from: { id: CHAT, first_name: 'Qa' } }, message, info, state: {}, set: async (_s, _c, k, v) => { info[k] = v }, saveInfo: async (k, v) => { info[k] = v }, send, goto: { 'digital-product-pay': async () => {}, submenu7: async () => {} }, bot: null })
  const say = async (m) => { out.length = 0; await BOT.handle(ctx(m)); return out[out.length - 1] || { text: '', kb: [] } }
  await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
  const nums = Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n')
  try {
    // Home: path line + single $50/500 price, every language
    for (const lang of ['en', 'fr', 'zh', 'hi', 'fa']) {
      info.userLanguage = lang; info.action = 'none'
      const r = await say(I.btn(lang).home)
      ok(`[${lang}] home shows 🧭 path line`, r.text.includes('🧭'), r.text.split('\n').find(l => l.includes('🧭')))
      ok(`[${lang}] home shows $50 and no $75`, r.text.includes('50') && !r.text.includes('75'), (r.text.match(/\$?\d+[.,]?\d*\s?\$?/g) || []).slice(0, 6).join(' '))
    }
    info.userLanguage = 'en'
    const toReady = async (text) => { await say(L.newc); await say(nums); await say(L.agree); await say(text); return say(L.use_one) }
    // A) ready → Skip test → when
    await say(L.home)
    let r = await toReady('Hi from QA guided A')
    ok('ready screen in bse-test', info.action === 'bse-test', info.action)
    ok('ready keyboard: Send a test SMS + Skip test', r.kb.includes(L.test) && r.kb.includes(L.test_skip), r.kb.join(' | '))
    console.log('   ready text:', JSON.stringify(r.text))
    r = await say(L.test_skip)
    ok('Skip test → bse-when with Schedule button', info.action === 'bse-when' && r.kb.includes(L.sched), `${info.action} ${r.kb.join(' | ')}`)
    // B) test → Did it arrive?
    await say(L.back); r = await toReady('Hi from QA guided B')
    r = await say(L.test)
    ok('Send a test → bse-test-to', info.action === 'bse-test-to', `${info.action} ${r.text.slice(0, 80)}`)
    r = await say('+13104567890')
    ok('test sent → bse-test-check, "Did it arrive?" + Yes/No', info.action === 'bse-test-check' && /Did it arrive/.test(r.text) && r.kb.includes(L.arrived_yes) && r.kb.includes(L.arrived_no), `${info.action} ${JSON.stringify(r.text)} ${r.kb.join(' | ')}`)
    const m1 = await db.collection('bsMessages').findOne({ _id: info.bseTestMsg })
    r = await say(L.arrived_no)
    ok('No right away (still queued) → Still on its way, stays', info.action === 'bse-test-check' && /Still on its way/.test(r.text), `msg status ${m1?.status} · ${info.action} · ${r.text.slice(0, 50)}`)
    await db.collection('bsMessages').updateMany({ cid, test: true }, { $set: { createdAt: new Date(Date.now() - 3 * 60000) } })
    r = await say(L.arrived_no)
    ok('No later → tips + Change the text / Test again / Continue anyway', /checking the line/.test(r.text) && r.kb.includes(L.edit) && r.kb.includes(L.test_again) && r.kb.includes(L.send_anyway), r.kb.join(' | '))
    const rv = await db.collection('bsReviews').findOne({ _id: info.bseTestMsg })
    ok('bsReviews {kind:test, arrived:no} stored', rv?.kind === 'test' && rv?.arrived === 'no', JSON.stringify(rv && { kind: rv.kind, arrived: rv.arrived, status: rv.status }))
    r = await say(L.test_again)
    ok('Test again → number prompt offering last number', info.action === 'bse-test-to' && r.kb.includes('+13104567890'), r.kb.join(' | '))
    r = await say('+13104567890')
    ok('re-test to last number → bse-test-check', info.action === 'bse-test-check', `${info.action} ${r.text.slice(0, 80)}`)
    await db.collection('bsMessages').updateMany({ cid, test: true }, { $set: { createdAt: new Date(Date.now() - 3 * 60000) } })
    await say(L.arrived_no)
    const oldCp = info.bseCampaign
    r = await say(L.edit)
    const d = await db.collection('bsDrafts').findOne({ _id: cid })
    ok('Change the text → bse-content, 510 numbers restored to draft', info.action === 'bse-content' && d?.contacts?.length === 510, `${info.action} contacts=${d?.contacts?.length}`)
    r = await say('Hi from QA guided B2'); r = await say(L.use_one)
    ok('new text → new ready screen (bse-test)', info.action === 'bse-test' && info.bseCampaign !== oldCp, info.action)
    const orphan = await db.collection('bsCampaigns').findOne({ _id: oldCp })
    console.log(`   previous campaign after Change the text: status=${orphan?.status} (left behind: ${!!orphan})`)
    // C) error inside number prompt → Continue button
    await say(L.test)
    r = await say('abc')
    ok('bad test number → error shown with Continue button', r.kb.includes(L.cont), `${info.action} ${r.text.slice(0, 80)} [${r.kb.join(' | ')}]`)
    r = await say(L.cont)
    ok('pressing that Continue → when screen (bse-when)', info.action === 'bse-when', `${info.action} · ${r.text.slice(0, 100)}`)
    // D) Yes → great + when
    await say(L.back); await toReady('Hi from QA guided D')
    await say(L.test); await say('+13104567890')
    out.length = 0; await BOT.handle(ctx(L.arrived_yes))
    ok('Yes → "Great — your message works" then when screen', out.some(x => /Great — your message works/.test(x.text)) && info.action === 'bse-when' && out[out.length - 1].kb.includes(L.sched), `${info.action} msgs=${out.length}`)
    const cpD = await db.collection('bsCampaigns').findOne({ _id: info.bseCampaign })
    ok('campaign.testArrived = true', cpD?.testArrived === true)
  } catch (e) { fail++; console.log('❌ exception', e.stack) }
  // cleanup (only this chat's records)
  for (const b of await db.collection('bsBookings').find({ cid }).toArray()) await B.cancelBooking(b._id, { by: 'admin' }).catch(() => {})
  for (const c of ['bsMessages', 'bsBookings', 'bsCampaigns', 'bsDaily', 'bsPayments', 'bsReviews']) await db.collection(c).deleteMany({ cid })
  await db.collection('bsNotify').deleteMany({ chatId: String(CHAT) }); await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('bsDrafts').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
