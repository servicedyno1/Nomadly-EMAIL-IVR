// Read-only investigation: wallet drain for one chatId across all brand DBs.
require('dotenv').config({ path: process.argv[3] || 'backend/.env' })
const { MongoClient } = require('mongodb')
const CHAT = process.argv[2]
;(async () => {
  const c = new MongoClient(process.env.MONGO_URL); await c.connect()
  const db = c.db(process.env.DB_NAME)
  const ids = [CHAT, Number(CHAT)]
  const w = await db.collection('walletOf').findOne({ _id: { $in: ids } })
  if (!w) { console.log('NOT IN', process.env.DB_NAME); process.exit(0) }
  console.log('DB', process.env.DB_NAME, 'wallet', JSON.stringify({ usdIn: w.usdIn, usdOut: w.usdOut, bal: (w.usdIn || 0) - (w.usdOut || 0) }))
  const camps = await db.collection('bulkCallCampaigns').find({ chatId: { $in: ids } }).sort({ createdAt: -1 }).limit(6).toArray()
  for (const k of camps) console.log('CAMP', k.id, k.status, k.createdAt?.toISOString?.() || k.createdAt, 'started', k.startedAt, 'done', k.completedAt, 'cancelled', k.cancelledAt, k.cancelledReason || '', JSON.stringify(k.stats), 'leads', (k.leads || []).length, 'pending', (k.leads || []).filter(l => ['pending', 'calling', 'ringing', 'answered', 'queued', 'dialing'].includes(l.status)).length)
  const since = new Date(Date.now() - 3 * 86400000)
  const nums = (await db.collection('phoneNumbersOf').findOne({ _id: { $in: ids } }))?.val?.numbers || []
  for (const n of nums) console.log('NUM', n.phoneNumber, n.status, n.plan, n.provider, 'min', n.minutesUsed, 'fwd', JSON.stringify(n.features?.callForwarding), 'ivr', !!n.features?.ivr?.enabled, 'exp', n.expiresAt)
  const tx = await db.collection('transactions').find({ chatId: { $in: ids }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(40).toArray()
  for (const t of tx) console.log('TX', new Date(t.createdAt).toISOString(), t.type, t.amount, JSON.stringify(t.metadata || {}).slice(0, 200))
  const cl = await db.collection('callLogs').find({ $or: [{ chatId: { $in: ids } }, { phoneNumber: { $in: nums.map(n => n.phoneNumber) } }] }).sort({ _id: -1 }).limit(40).toArray()
  for (const l of cl) console.log('CALL', l._id.getTimestamp().toISOString(), l.type || l.direction, l.from, '->', l.to, 'dur', l.duration, 'cost', l.cost ?? l.charge ?? l.amount, l.campaignId || '', l.status || '')
  const pl = await db.collection('phoneLogs').find({ phoneNumber: { $in: nums.map(n => n.phoneNumber) } }).sort({ _id: -1 }).limit(30).toArray()
  for (const l of pl) console.log('PLOG', l.timestamp, l.type, l.phoneNumber, l.from, l.to || '', 'dur', l.duration)
  await c.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
