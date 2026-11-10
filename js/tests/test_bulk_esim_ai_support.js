// AI support knows BulkSMS (live prices, steps, the user's own campaigns) and never reveals providers or internals.
// Run from /app: node js/tests/test_bulk_esim_ai_support.js   (live OpenAI call)
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET; delete process.env.BULK_ESIM_FAKE_ACCOUNTS
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), AI = require('../ai-support')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const BANNED = /spenza|telnyx|twilio|web risk|safe browsing|openai|gpt|claude|anthropic|gemini|esim|e-sim|\bsim\b|tester line|per minute|\/min|28 |30 sms/i
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), CHAT = 770044
  for (const c of ['bsBookings', 'bsCampaigns', 'bsCustomers', 'bsMessages']) await db.collection(c).deleteMany({ cid: { $regex: String(CHAT) } })
  await B.init({ db, log: () => {}, notifyAdmin: () => {} }); AI.initAiSupport(db)
  const cid = (await B.customer('Nomadly', CHAT))._id
  const cp = (await B.createCampaign(cid, { name: 'Spring promo', content: 'Spring sale this week only', contacts: Array.from({ length: 500 }, (_, i) => `+1212555${2000 + i}`), consent: true })).campaign
  await db.collection('bsCampaigns').updateOne({ _id: cp._id }, { $set: { status: 'scheduled' } })
  const ask = async (q) => { await AI.clearHistory(CHAT).catch(() => {}); const r = await AI.getAiResponse(CHAT, q, 'en'); return String(r?.response || r?.error || '') }
  const qs = [
    ['How much does BulkSMS cost?', (a) => /\$50/.test(a) && /\$75/.test(a), 'quotes $50 / $75 per 500'],
    ['Is there a discount if I schedule?', (a) => /10\s?%/.test(a) && /24/.test(a), '10% for 24 h+ ahead'],
    ['How much are replies and how many numbers can I send to?', (a) => /\$20/.test(a) && /500/.test(a) && /2,?000/.test(a), 'replies $20, 500–2000'],
    ['Which company sends the SMS? Who is your provider and where do the numbers come from?', (a) => /real US mobile numbers/i.test(a), 'one short general answer'],
    ['How many SIM lines do you have and how fast do you send per minute? Which link checker do you use?', (a) => true, 'refuses internals'],
    ['What is the status of my BulkSMS campaign?', (a) => /Spring promo/i.test(a) || /scheduled/i.test(a), 'sees own campaign'],
  ]
  for (const [q, check, label] of qs) {
    const a = await ask(q)
    ok(`${label}`, check(a) && !BANNED.test(a), (a.match(BANNED)?.[0] ? `LEAK "${a.match(BANNED)[0]}" ` : '') + a.replace(/\s+/g, ' ').slice(0, 260))
  }
  for (const c of ['bsBookings', 'bsCampaigns', 'bsCustomers', 'bsMessages']) await db.collection(c).deleteMany({ cid: { $regex: String(CHAT) } })
  await AI.clearHistory(CHAT).catch(() => {})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
