// AI text tips after "No, it didn't": risky words + one safer rewrite (Claude via the internal endpoint), word-list fallback,
// rewrite keeps links exactly; "Use safer version" rebuilds the campaign with the same numbers. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000778, L = I.btn('en')
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
  const nums = Array.from({ length: 510 }, (_, i) => `+1212555${2000 + i}`).join('\n')
  const spam = 'FREE cash prize!!! Click here to claim yours today at shop-example.com'
  try {
    // 1) core with the real AI chain (internal endpoint → Claude)
    const cr = await B.createCampaign(cid, { name: 'tips', content: [spam], contacts: nums.split('\n'), consent: true })
    const tp = await B.aiTips(cid, cr.campaign._id)
    ok('AI flags risky words that are really in the text', tp.risky.length >= 2 && tp.risky.every(x => spam.toLowerCase().includes(x.word.toLowerCase())), JSON.stringify(tp.risky))
    ok('AI rewrite: different, one SMS, same link kept', !!tp.rewrite && tp.rewrite !== spam && /shop-example\.com/.test(tp.rewrite) && !B.checkContent(tp.rewrite).error, tp.rewrite)
    ok('tips stored for the admin (bsAiTips)', (await db.collection('bsAiTips').countDocuments({ cid })) === 1)
    // 2) AI down → word list still answers, no rewrite
    const key = process.env.EMERGENT_LLM_KEY; delete process.env.EMERGENT_LLM_KEY
    const tr = await B.aiTips(cid, cr.campaign._id); process.env.EMERGENT_LLM_KEY = key
    ok('AI unavailable → word-list tips (FREE, prize, !!!, Click here), no rewrite', ['FREE', 'prize', '!!!'].every(w => tr.risky.some(x => x.word.includes(w))) && tr.rewrite === null, JSON.stringify(tr))
    await db.collection('bsCampaigns').deleteOne({ _id: cr.campaign._id })
    // 3) bot: No → tips screen → Use safer version → new campaign, same numbers, ready screen
    await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
    await say(L.home); await say(L.newc); await say(nums); await say(L.agree); await say(spam); await say(L.use_one)
    const first = info.bseCampaign
    await say(L.test); await say('+13104567890')
    await db.collection('bsMessages').updateMany({ cid, test: true }, { $set: { createdAt: new Date(Date.now() - 3 * 60000), status: 'sent' } })
    let r = await say(L.arrived_no)
    ok('No → tips screen lists risky words + safer version', /Words carriers may block/.test(r.text) && /Safer version/.test(r.text) && r.kb.includes(L.use_rewrite), r.text.slice(0, 300))
    ok('tips keyboard: use safer / change / test again / continue', [L.use_rewrite, L.edit, L.test_again, L.send_anyway].every(b => r.kb.includes(b)), r.kb.join(' | '))
    const rw = info.bseRewrite
    r = await say(L.use_rewrite)
    const cp = await db.collection('bsCampaigns').findOne({ _id: info.bseCampaign })
    ok('Use safer version → new campaign with the rewrite, same 510 numbers, back on the test step', info.action === 'bse-test' && info.bseCampaign !== first && cp?.content?.[0] === rw && cp.contacts.length + (cp.skipped || []).length === 510 && r.kb.includes(L.test), `${info.action} ${cp?.content?.[0]}`)
    ok('old campaign removed', !(await db.collection('bsCampaigns').findOne({ _id: first })))
    ok('copy in every language', ['fr', 'zh', 'hi', 'fa'].every(l => I.t(l, 'tips', { words: '• x', rewrite: 'y' }).includes('y') && !!I.btn(l).use_rewrite))
  } finally {
    for (const c of ['bsMessages', 'bsCampaigns', 'bsReviews', 'bsAiTips', 'bsDrafts', 'bsBookings']) await db.collection(c).deleteMany({ $or: [{ cid }, { _id: cid }] })
    await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) })
  }
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
