// Ops: add credit to a CloudIVR web account's wallet (shows as "Credit from CloudIVR" in their wallet history).
// Idempotent per tag. Run on the droplet from the live release:
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node /root/civr_wallet_credit.js <email> <amount> <tag> [--notify] [--go]
// Without --go it only shows the account and what it would do.
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')

const args = process.argv.slice(2)
const [email, amountArg, tag] = args.filter(a => !a.startsWith('--'))
const GO = args.includes('--go'), NOTIFY = args.includes('--notify')
const AMOUNT = Math.round(Number(amountArg) * 100) / 100
const round2 = (n) => Math.round(Number(n) * 100) / 100

;(async () => {
  if (!email || !(AMOUNT > 0) || AMOUNT > 500 || !tag) throw new Error('usage: <email> <amount 0-500> <tag> [--notify] [--go]')
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  const acc = await db.collection('webAccounts').findOne({ email: email.trim().toLowerCase() }, { projection: { _id: 1, name: 1, disabled: 1, createdAt: 1 } })
  if (!acc) { console.log(`NO web account for ${email}`); return client.close() }
  const chatId = String(acc._id)
  const w0 = await db.collection('walletOf').findOne({ _id: chatId })
  const bal0 = round2((w0?.usdIn || 0) - (w0?.usdOut || 0))
  const credits = await db.collection('transactions').find({ chatId, type: 'admin-credit' }).project({ amount: 1, createdAt: 1, metadata: 1 }).toArray()
  console.log(`account ${chatId} (${acc.name || '-'})${acc.disabled ? ' DISABLED' : ''} · wallet $${bal0.toFixed(2)} · earlier admin credits: ${credits.map(c => `$${c.amount} ${c.metadata?.reason || ''}`.trim()).join(', ') || 'none'}`)
  const id = `admin-credit-${chatId}-${tag}`
  if (await db.collection('transactions').findOne({ _id: id })) { console.log(`already credited (${id})`); return client.close() }
  if (!GO) { console.log(`(dry) would add $${AMOUNT.toFixed(2)} → $${round2(bal0 + AMOUNT).toFixed(2)}${NOTIFY ? ' + inbox notice' : ''}`); return client.close() }
  await db.collection('transactions').insertOne({ _id: id, chatId, type: 'admin-credit', amount: AMOUNT, currency: 'USD', status: 'completed', metadata: { reason: 'Credit from CloudIVR', tag, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() })
  await db.collection('walletOf').updateOne({ _id: chatId }, { $inc: { usdIn: AMOUNT } }, { upsert: true })
  const w = await db.collection('walletOf').findOne({ _id: chatId })
  const bal = round2((w?.usdIn || 0) - (w?.usdOut || 0))
  if (NOTIFY) await db.collection('webNotifications').insertOne({ chatId, kind: 'wallet', mediaUrl: null, meta: { tag, amount: AMOUNT }, read: false, createdAt: new Date(), text: `We added $${AMOUNT.toFixed(2)} credit to your wallet. New balance: $${bal.toFixed(2)}.` })
  console.log(`DONE wallet $${bal0.toFixed(2)} → $${bal.toFixed(2)} (+$${AMOUNT.toFixed(2)}), txn ${id}${NOTIFY ? ', inbox notice added' : ''}`)
  await client.close()
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
