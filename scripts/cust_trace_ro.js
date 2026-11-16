// Read-only trace of one customer. Run on the droplet from a release dir.
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const CID = Number(process.argv[2] || 5828254066)
const HOURS = Number(process.argv[3] || 72)
const ids = [CID, String(CID)]
const since = new Date(Date.now() - HOURS * 3600e3)
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v))
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const names = (await db.listCollections().toArray()).map((x) => x.name)
  console.log('## collections matching', names.filter((n) => /support|chat|call|phoneLog|wallet|ledger|sip|error|escal|message/i.test(n)).join(', '))
  for (const n of ['aiSupportChats', 'supportSessions', 'supportChats', 'escalations', 'userErrors', 'supportRatings', 'adminReplies', 'chatLogs', 'messagesLog']) {
    if (!names.includes(n)) continue
    const col = db.collection(n)
    const q = { $or: [{ chatId: { $in: ids } }, { _id: { $in: ids } }, { cid: { $in: ids } }, { userId: { $in: ids } }] }
    const rows = await col.find(q).sort({ _id: -1 }).limit(n === 'aiSupportChats' ? 120 : 30).toArray()
    console.log(`\n## ${n}: ${rows.length}`)
    rows.reverse().forEach((r) => console.log(j(r)))
  }
  const pn = await db.collection('phoneNumbersOf').findOne({ _id: { $in: ids } })
  console.log('\n## phoneNumbersOf')
  const nums = pn?.val?.numbers || pn?.numbers || []
  nums.forEach((n) => console.log(j(n)))
  const w = await db.collection('walletOf').findOne({ _id: { $in: ids } })
  console.log('\n## wallet', j(w))
  for (const n of ['phoneLogs', 'callLogs', 'sipCalls', 'callRecon', 'walletLedger', 'walletTransactions', 'payments', 'phoneTransactions']) {
    if (!names.includes(n)) continue
    const col = db.collection(n)
    const s = await col.findOne({})
    const tf = ['timestamp', 'createdAt', 'at', 'ts', 'date', 'time'].find((f) => s && s[f] !== undefined)
    const q = { $or: [{ chatId: { $in: ids } }, { cid: { $in: ids } }, { userId: { $in: ids } }, { owner: { $in: ids } }] }
    const rows = await col.find(q).sort({ _id: -1 }).limit(150).toArray()
    console.log(`\n## ${n}: ${rows.length} (timeField ${tf})`)
    rows.reverse().filter((r) => { const t = r[tf]; return !t || new Date(t) >= since }).forEach((r) => console.log(j(r)))
  }
  await c.close()
})().catch((e) => { console.error(e); process.exit(1) })
