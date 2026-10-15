/**
 * AI Support pricing-accuracy harness.
 * Loads the bot env (OPEN_API_KEY etc.), connects to Mongo, and asks the AI
 * the exact hosting/domain questions that previously produced wrong answers.
 * Prints each answer + automated PASS/FAIL assertions.
 *
 * Run:  node scripts/test_ai_support_pricing.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const { MongoClient } = require('mongodb')
const ai = require('../js/ai-support.js')

const CASES = [
  {
    name: 'Domain + cPanel total (the reproduced bug)',
    chatId: 'qa_pricing_1',
    turns: [
      'Does the bulletproof panel come with a domain already',
      'So the total is $105? For domain and cpanel',
    ],
    // evaluate the LAST answer
    mustNotMatch: [/\$?75\s*\/?\s*(per\s*)?wk\b/i, /\$?75\s*\/?\s*(per\s*)?week/i, /weekly[^.]{0,40}\$?75/i, /\$?75[^.]{0,20}(a|per)\s*week/i],
    mustMatch: [/75\s*\/?\s*(per\s*)?month|75\s*\/?\s*mo\b|75[^.]{0,15}month/i],
  },
  {
    name: 'Is Premium $75 weekly?',
    chatId: 'qa_pricing_2',
    turns: ['Is the Premium Anti-Red plan $75 per week?'],
    mustNotMatch: [/yes[^.]{0,30}\$?75\s*\/?\s*(per\s*)?week/i],
    mustMatch: [/30\s*\/?\s*(per\s*)?week|\$?30\b/i, /75[^.]{0,15}month/i],
  },
  {
    name: 'List all hosting plans',
    chatId: 'qa_pricing_3',
    turns: ['What hosting plans do you have and how much?'],
    mustMatch: [/30[^.]{0,15}week/i, /75[^.]{0,15}month/i, /100[^.]{0,15}month/i],
    mustNotMatch: [/75\s*\/?\s*(per\s*)?week/i],
  },
  {
    name: 'Marketplace price range',
    chatId: 'qa_pricing_4',
    turns: ['What price range can I list a product for on the marketplace?'],
    mustMatch: [/\$?30\b/, /\$?3[,.]?000\b/],
    mustNotMatch: [/\$?20\b[^.]{0,20}\$?5[,.]?000/i, /\$?5[,.]?000\b/],
  },
  {
    name: 'Digital product price must still be quoted (reworded-rule regression)',
    chatId: 'qa_pricing_5',
    turns: ['How much is the eSIM T-Mobile?'],
    mustMatch: [/\$?60\b/],
    mustNotMatch: [/check with (the|our) team/i, /i(''|')?ll check/i, /not listed/i],
  },
  {
    name: 'Email Blast price must still be quoted',
    chatId: 'qa_pricing_6',
    turns: ['How much does Email Blast cost per email?'],
    mustMatch: [/0\.10|10\s*cents/i],
    mustNotMatch: [/check with (the|our) team/i],
  },
  {
    name: 'VPS price framed as approximate / varies (not a flat exact promise)',
    chatId: 'qa_pricing_7',
    turns: ['How much is the Cloud VPS 10 per month?'],
    // must signal variability/approximation or point to the selection screen; must not refuse outright
    mustMatch: [/vary|varies|approx|around|starting|from|region|selection screen|before payment|~/i],
    mustNotMatch: [/check with (the|our) team/i],
  },
]

;(async () => {
  const uri = process.env.MONGO_URL || 'mongodb://localhost:27017'
  const dbName = process.env.DB_NAME || 'test'
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(dbName)
  ai.initAiSupport(db)
  console.log(`[harness] DB=${dbName} brand=${process.env.CHAT_BOT_BRAND || 'Nomadly'} key=${process.env.OPEN_API_KEY ? 'present' : 'MISSING'}`)

  let pass = 0, fail = 0
  for (const c of CASES) {
    // clear any prior history for a clean run
    try { await ai.clearHistory(c.chatId) } catch (_) {}
    let last = ''
    for (const t of c.turns) {
      const r = await ai.getAiResponse(c.chatId, t, 'en')
      last = r.response || `[no response / error: ${r.error}]`
    }
    console.log(`\n===== CASE: ${c.name} =====`)
    console.log(`Q: ${c.turns[c.turns.length - 1]}`)
    console.log(`A: ${last.replace(/\n/g, ' ')}`)
    const problems = []
    for (const rx of (c.mustMatch || [])) if (!rx.test(last)) problems.push(`missing expected ${rx}`)
    for (const rx of (c.mustNotMatch || [])) if (rx.test(last)) problems.push(`contains forbidden ${rx}`)
    if (problems.length) { fail++; console.log(`RESULT: ❌ FAIL — ${problems.join('; ')}`) }
    else { pass++; console.log('RESULT: ✅ PASS') }
  }
  console.log(`\n==== SUMMARY: ${pass} passed, ${fail} failed ====`)
  await client.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2) })
