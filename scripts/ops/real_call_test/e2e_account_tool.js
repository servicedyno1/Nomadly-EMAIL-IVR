// LIVE test helper for the e2e test web account only (run on the droplet inside /opt/nomadly/current/app-main):
//   node e2e_account_tool.js plan <pro|business> <webChatId> <phone>   → set that number's plan (no charge; test account only)
//   node e2e_account_tool.js credit <usd> <webChatId>                    → add test wallet credit
// Prints one JSON line (prefix RESULT=).
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')

;(async () => {
  const [cmd, a, chatId, phone] = process.argv.slice(2)
  const id = cmd === 'credit' ? chatId : chatId
  if (!/^5\d{15}$/.test(String(id || ''))) throw new Error('web chat id required')
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const acc = await db.collection('webAccounts').findOne({ _id: Number(id) })
  if (!acc || !/^e2e-ring-test/.test(acc.email)) throw new Error('not the e2e test account')
  let out
  if (cmd === 'plan') {
    if (!['pro', 'business'].includes(a)) throw new Error('plan must be pro or business')
    const r = await db.collection('phoneNumbersOf').updateOne({ _id: String(id), 'val.numbers.phoneNumber': phone }, { $set: { 'val.numbers.$.plan': a } })
    out = { plan: a, matched: r.matchedCount, modified: r.modifiedCount }
  } else if (cmd === 'credit') {
    const usd = Number(a)
    if (!(usd > 0 && usd <= 10)) throw new Error('credit must be 0–10 USD')
    await db.collection('walletOf').updateOne({ _id: String(id) }, { $inc: { usdIn: usd } }, { upsert: true })
    out = { credited: usd }
  } else throw new Error('unknown command')
  console.log('RESULT=' + JSON.stringify(out))
  await c.close()
})().catch(e => { console.log('RESULT=' + JSON.stringify({ error: e.message })); process.exit(1) })
