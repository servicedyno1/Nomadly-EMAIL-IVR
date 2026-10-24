'use strict'
// Referral rewards: every web account has a share code. When a friend who signed up with it buys their first
// number, the referrer gets wallet credit and the friend gets a welcome credit (each referral pays out once).
const crypto = require('crypto')
const notify = require('./notify')
const { walletOps, round2 } = require('./wallet')

const REWARD = () => round2(Number(process.env.REFERRAL_REWARD_USD) || 10)
const FRIEND = () => round2(Number(process.env.REFERRAL_FRIEND_USD) || 5)
const maskEmail = (e) => { const [u, d] = String(e || '').split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : '•••' }

async function codeFor(db, chatId) {
  const accounts = db.collection('webAccounts')
  const acc = await accounts.findOne({ _id: Number(chatId) }, { projection: { refCode: 1 } })
  if (acc?.refCode) return acc.refCode
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    try {
      const r = await accounts.updateOne({ _id: Number(chatId), refCode: { $exists: false } }, { $set: { refCode: code } })
      if (r.modifiedCount) return code
      return (await accounts.findOne({ _id: Number(chatId) }, { projection: { refCode: 1 } })).refCode
    } catch (e) { if (e.code !== 11000) throw e }
  }
  throw new Error('could not create a referral code')
}

// Called after a number purchase succeeds. Pays the referral once (first purchase of a referred account).
async function onPurchase(db, chatId, amount, log = console.log) {
  if (!(Number(amount) > 0)) return
  const accounts = db.collection('webAccounts')
  const r = await accounts.findOneAndUpdate(
    { _id: Number(chatId), referredBy: { $exists: true }, referralPaidAt: { $exists: false } },
    { $set: { referralPaidAt: new Date(), referralReward: REWARD(), referralFriendCredit: FRIEND() } },
  )
  const friend = r && r.value !== undefined ? r.value : r
  if (!friend) return
  const w = walletOps(db), referrer = String(friend.referredBy)
  const tx = db.collection('transactions')
  const row = (id, amt, kind) => ({ _id: `ref-${kind}-${friend._id}`, chatId: id, type: 'referral-reward', amount: amt, currency: 'USD', status: 'completed', metadata: { kind, friend: String(friend._id), channel: 'web' }, createdAt: new Date(), updatedAt: new Date() })
  await w.credit(referrer, REWARD())
  await tx.insertOne(row(referrer, REWARD(), 'referrer')).catch(() => {})
  await notify.push(referrer, `Referral reward: ${maskEmail(friend.email)} bought their first number. $${REWARD().toFixed(2)} was added to your wallet.`, null, { kind: 'referral' }).catch(() => {})
  if (FRIEND() > 0) {
    await w.credit(String(friend._id), FRIEND())
    await tx.insertOne(row(String(friend._id), FRIEND(), 'friend')).catch(() => {})
    await notify.push(String(friend._id), `Welcome gift: $${FRIEND().toFixed(2)} was added to your wallet because a friend invited you.`, null, { kind: 'referral' }).catch(() => {})
  }
  log(`[CloudIVR-Web] referral paid: ${referrer} +$${REWARD()} / friend ${friend._id} +$${FRIEND()}`)
}

function routes(router, { db, h }) {
  db.collection('webAccounts').createIndex({ refCode: 1 }, { unique: true, partialFilterExpression: { refCode: { $type: 'string' } } }).catch(() => {})
  router.get('/referrals', h(async (req, res) => {
    const code = await codeFor(db, req.webChatId)
    const friends = await db.collection('webAccounts').find({ referredBy: Number(req.webChatId) }, { projection: { email: 1, createdAt: 1, referralPaidAt: 1, referralReward: 1 } }).sort({ createdAt: -1 }).limit(50).toArray()
    const paid = friends.filter(f => f.referralPaidAt)
    res.json({
      code, rewardUsd: REWARD(), friendUsd: FRIEND(),
      stats: { signedUp: friends.length, rewarded: paid.length, earned: round2(paid.reduce((s, f) => s + (f.referralReward || 0), 0)) },
      friends: friends.slice(0, 20).map(f => ({ email: maskEmail(f.email), joinedAt: f.createdAt, rewarded: !!f.referralPaidAt })),
    })
  }))
}

module.exports = { routes, onPurchase, codeFor, REWARD, FRIEND }
