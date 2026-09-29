/* global process, require, console */
// Ops one-shot: complete the failed smadav hosting order for surpriseforyou.sbs.
// 1) idempotency check (no active cpanelAccount for the domain)
// 2) atomic guarded $75 wallet deduct (mirrors utils.smartWalletDeduct) + walletLedger row
// 3) insert a 'provision' job into cpanelPendingJobs so the RUNNING worker provisions + DMs creds
// Usage: node ops_complete_order.js /path/to/backend.env
const fs = require('fs'); const path = require('path')
const envPath = process.argv[2]
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) { let v = m[2].trim(); if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1); env[m[1]] = v }
}
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))
const { v4: uuidv4 } = require(path.join(process.cwd(), 'node_modules', 'uuid'))

const CHAT_NUM = 1187860699
const CHAT_STR = '1187860699'
const DOMAIN = 'surpriseforyou.sbs'
const PLAN = 'Premium Anti-Red HostPanel (1-Month)'
const EMAIL = 'hybesquare@gmail.com'
const AMOUNT = 75

;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect(); const db = c.db(env.DB_NAME)
  const cp = db.collection('cpanelAccounts')
  const walletOf = db.collection('walletOf')
  const jobs = db.collection('cpanelPendingJobs')

  // 1) idempotency
  const active = await cp.findOne({ domain: DOMAIN, deleted: { $ne: true } })
  if (active) { console.log('ABORT: active cpanelAccount already exists for', DOMAIN, '=>', active.cpUser); await c.close(); return }
  const dupJob = await jobs.findOne({ domain: DOMAIN, status: { $in: ['pending', 'running'] } })
  if (dupJob) { console.log('ABORT: pending/running provision job already exists =>', dupJob._id); await c.close(); return }

  const before = await walletOf.findOne({ _id: { $in: [CHAT_NUM, CHAT_STR] } })
  if (!before) { console.log('ABORT: no wallet doc for', CHAT_STR); await c.close(); return }
  const WALLET_ID = before._id  // use the exact _id type stored (string vs number)
  const bal = (Number(before.usdIn || 0) - Number(before.usdOut || 0))
  console.log('wallet before: _id(%s)=%j usdIn=%s usdOut=%s balance=%s', typeof WALLET_ID, WALLET_ID, before.usdIn, before.usdOut, bal.toFixed(2))
  if (bal < AMOUNT) { console.log('ABORT: insufficient balance', bal, '<', AMOUNT); await c.close(); return }

  // 2) atomic guarded deduct (only if balance >= AMOUNT)
  const res = await walletOf.findOneAndUpdate(
    { _id: WALLET_ID, $expr: { $gte: [{ $subtract: [{ $ifNull: ['$usdIn', 0] }, { $ifNull: ['$usdOut', 0] }] }, AMOUNT] } },
    { $inc: { usdOut: AMOUNT } },
    { returnDocument: 'after', includeResultMetadata: false }
  )
  if (!res) { console.log('ABORT: atomic deduct failed (balance changed?)'); await c.close(); return }
  const newBal = (Number(res.usdIn || 0) - Number(res.usdOut || 0))
  await db.collection('walletLedger').insertOne({
    _id: uuidv4(), chatId: WALLET_ID, type: 'hosting_purchase', amount: -AMOUNT, currency: 'usd',
    balanceAfter: parseFloat(newBal.toFixed(4)),
    description: `Hosting: ${PLAN} — ${DOMAIN} (ops completion of failed order)`,
    callRef: null, timestamp: new Date(),
  })
  console.log('CHARGED $%s -> new balance $%s', AMOUNT, newBal.toFixed(2))

  // 3) enqueue provision job (running worker will drain + DM credentials)
  const now = new Date()
  const info = {
    _id: CHAT_STR, website_name: DOMAIN, plan: PLAN, planName: PLAN, email: EMAIL,
    userLanguage: 'en', existingDomain: true, connectExternalDomain: false,
    nameserver: 'cloudflare', nsChoice: 'cloudflare',
    price: AMOUNT, hostingPrice: AMOUNT, domainPrice: 0, registrar: 'OpenProvider',
    source: 'ops_order_completion',
  }
  const jobDoc = {
    type: 'provision', status: 'pending', chatId: CHAT_STR, lang: 'en',
    params: { info }, dedupeKey: `provision:${DOMAIN}:${CHAT_STR}`,
    domain: DOMAIN, plan: PLAN, createdAt: now, updatedAt: now,
    attempts: 0, lastError: null, completedAt: null, escalated: false,
  }
  const ins = await jobs.insertOne(jobDoc)
  console.log('ENQUEUED provision job:', ins.insertedId.toString())
  console.log('DONE. Running worker will provision + deliver credentials to chat', CHAT_STR)
  await c.close()
})().catch(e => { console.error('ERR', e); process.exit(1) })
